/* Tier 2 adapters. Both expose the same shape:
     stream({ system, question, key, model, search }, emit) -> Promise<void>
   `emit` is called with { text } deltas and { citation } objects. */

async function* sse(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try { yield JSON.parse(payload); } catch { /* keepalive or partial */ }
      }
    }
  }
}

async function assertOk(res, provider) {
  if (res.ok) return;
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message || "";
  } catch { /* non-JSON error body */ }
  const hint =
    res.status === 401 ? "That key was rejected. Check it in Settings."
    : res.status === 429 ? "Rate limited by the provider. Wait a moment and ask again."
    : res.status === 400 ? `The request was refused: ${detail || "check the model name in Settings."}`
    : `${provider} returned ${res.status}. ${detail}`;
  const err = new Error(hint);
  err.status = res.status;
  throw err;
}

/* ---------------- Anthropic ---------------- */

export async function anthropic({ system, question, key, model, search }, emit) {
  const body = {
    model: model || "claude-sonnet-5",
    max_tokens: 1200,
    system,
    stream: true,
    messages: [{ role: "user", content: question }],
  };
  if (search) {
    body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      // required for calls originating from a browser/extension context
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  await assertOk(res, "Anthropic");

  for await (const ev of sse(res)) {
    if (ev.type === "content_block_delta") {
      if (ev.delta?.type === "text_delta") emit({ text: ev.delta.text });
      if (ev.delta?.type === "citations_delta" && ev.delta.citation?.url) {
        emit({ citation: { url: ev.delta.citation.url, title: ev.delta.citation.title } });
      }
    }
    if (ev.type === "content_block_start" && ev.content_block?.type === "web_search_tool_result") {
      for (const r of ev.content_block.content || []) {
        if (r.url) emit({ citation: { url: r.url, title: r.title } });
      }
    }
    if (ev.type === "error") throw new Error(ev.error?.message || "Stream failed.");
  }
}

/* ---------------- OpenAI ---------------- */

export async function openai({ system, question, key, model }, emit) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      max_tokens: 1200,
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: question },
      ],
    }),
  });
  await assertOk(res, "OpenAI");

  for await (const ev of sse(res)) {
    const t = ev.choices?.[0]?.delta?.content;
    if (t) emit({ text: t });
  }
}

/* ---------------- Google Gemini ---------------- */

export async function gemini({ system, question, key, model, search }, emit) {
  const id = model || "gemini-2.5-flash";
  const body = {
    contents: [{ role: "user", parts: [{ text: question }] }],
    systemInstruction: { parts: [{ text: system }] },
    generationConfig: { maxOutputTokens: 1200 },
  };
  if (search) body.tools = [{ google_search: {} }];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    }
  );
  await assertOk(res, "Gemini");

  for await (const ev of sse(res)) {
    const cand = ev.candidates?.[0];
    if (!cand) continue;

    for (const part of cand.content?.parts || []) {
      if (part.text) emit({ text: part.text });
    }

    // Grounding sources arrive alongside the answer when google_search runs.
    for (const g of cand.groundingMetadata?.groundingChunks || []) {
      if (g.web?.uri) emit({ citation: { url: g.web.uri, title: g.web.title } });
    }
  }
}

export const PROVIDERS = { anthropic, openai, gemini };
