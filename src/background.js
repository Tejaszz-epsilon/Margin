/* Margin — service worker. The only place that talks to a model or the network. */

import { chunk, rank, estTokens } from "./retrieval.js";
import { PROVIDERS } from "./providers.js";
import {
  remember, getLibrary, readingProfile, describeDepth, technicality, topTerms,
} from "./profile.js";

const DEFAULTS = {
  mode: "auto",        // auto | local | cloud
  provider: "anthropic",
  key: "",
  model: "",
  search: true,        // let the cloud tier look beyond the page
  depth: "auto",       // auto | plain | balanced | technical — overrides the learned profile
  remember: true,      // keep a local library of what's been read
};

const getSettings = async () => ({ ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) });

/* Nano's window is small. Keep the retrieved context well inside it so the
   question and the answer both still fit. */
const LOCAL_CONTEXT_TOKENS = 1100;
const CLOUD_ARTICLE_CHARS = 160000;

/* ---------------- routing ---------------- */

async function resolveTier(settings) {
  const hasKey = !!settings.key;

  if (settings.mode === "cloud") {
    return hasKey
      ? { tier: "cloud", detail: `${settings.provider} · your key` }
      : { tier: "none", detail: "No key saved" };
  }

  let local = "unavailable";
  try {
    if (typeof LanguageModel !== "undefined") local = await LanguageModel.availability();
  } catch { /* not exposed on this build */ }

  if (settings.mode === "local") {
    return local === "unavailable"
      ? { tier: "none", detail: "On-device model unavailable" }
      : { tier: "local", detail: local === "available" ? "Gemini Nano · private" : "Model needs downloading", local };
  }

  // auto: prefer the user's key when they've bothered to add one
  if (hasKey) return { tier: "cloud", detail: `${settings.provider} · your key`, local };
  if (local !== "unavailable") {
    return { tier: "local", detail: local === "available" ? "Gemini Nano · private" : "Model needs downloading", local };
  }
  return { tier: "none", detail: "No model available" };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "open-options") { chrome.runtime.openOptionsPage(); return; }
  if (msg.type === "tier-check") {
    getSettings().then(resolveTier).then(reply);
    return true; // async
  }
  if (msg.type === "library") {
    Promise.all([getLibrary(), readingProfile()])
      .then(([lib, profile]) =>
        reply({ lib, profile: { ...profile, label: describeDepth(profile.tech) } })
      )
      .catch(() => reply({ lib: [], profile: null }));
    return true; // async
  }
  if (msg.type === "load-lib") {
    const tabId = sender.tab?.id;
    if (!tabId) { reply({ ok: false, error: "No active tab." }); return; }
    chrome.scripting
      .executeScript({ target: { tabId }, files: [`vendor/${msg.file}`] })
      .then(() => reply({ ok: true }))
      .catch((err) => reply({ ok: false, error: err.message }));
    return true; // async
  }
});

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: "toggle" }).catch(() => {});
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "toggle-margin") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: "toggle" }).catch(() => {});
});

/* ---------------- prompts ---------------- */

const RULES = [
  "You answer questions about one web page the reader is currently on.",
  "Ground every claim in the supplied passages. Quote sparingly and briefly.",
  "If the passages do not settle the question, say so in one sentence rather than guessing.",
  "Be direct. No preamble, no restating the question.",
].join(" ");

const SEARCH_RULES =
  " If you search the web, mark those sentences by starting them with 'Beyond the page:' so the reader can tell what came from elsewhere.";

/* ---------------- on-device session ----------------

   The model is downloaded once by Chrome and cached on disk. Creating a session
   does not re-download it — but attaching a `monitor` unconditionally makes it
   look like it does, because the callback fires on every create(). So the monitor
   is attached only when availability() says the bytes aren't there yet.

   A base session is kept warm and cloned per question. Cloning inherits the
   system prompt without replaying it, and keeps each question independent —
   no context bleeding from the previous answer into the next. */

let baseSession = null;
let baseSessionPromise = null;

async function borrowSession(port, availability) {
  if (!baseSession && !baseSessionPromise) {
    const needsDownload = availability !== "available";
    baseSessionPromise = LanguageModel.create({
      initialPrompts: [{ role: "system", content: RULES }],
      ...(needsDownload
        ? {
            monitor(m) {
              m.addEventListener("downloadprogress", (e) => {
                const pct = Math.round((e.loaded ?? 0) * 100);
                port.postMessage({
                  type: "status",
                  text: `Downloading the on-device model — ${pct}%. This happens once.`,
                });
              });
            },
          }
        : {}),
    })
      .then((s) => { baseSession = s; baseSessionPromise = null; return s; })
      .catch((err) => { baseSessionPromise = null; throw err; });
  }

  const base = baseSession || (await baseSessionPromise);
  try {
    return await base.clone();
  } catch {
    // Session died (quota, crash, or worker restart) — rebuild once.
    baseSession = null;
    const fresh = await LanguageModel.create({
      initialPrompts: [{ role: "system", content: RULES }],
    });
    baseSession = fresh;
    return fresh.clone();
  }
}

/* ---------------- on-device tier ---------------- */

async function runLocal(port, { question, title, text }, availability) {
  const chunks = chunk(text);
  const hits = rank(chunks, question, 6);

  const picked = [];
  let budget = LOCAL_CONTEXT_TOKENS;
  for (const h of hits) {
    const cost = estTokens(h.text);
    if (cost > budget && picked.length) break;
    picked.push(h);
    budget -= cost;
  }

  port.postMessage({
    type: "chunks",
    total: chunks.length,
    hits: picked.map((p) => p.index),
    // First words of each passage, so the panel can find it in the live DOM
    // and scroll there. Cheap: the text is already in hand.
    snippets: picked.map((p) => ({ index: p.index, head: p.text.slice(0, 90) })),
  });

  const context = picked
    .map((p) => `[passage ${p.index + 1} of ${chunks.length}]\n${p.text}`)
    .join("\n\n");

  let session;
  try {
    session = await borrowSession(port, availability);
  } catch (err) {
    port.postMessage({
      type: "error",
      message:
        availability === "unavailable"
          ? "This browser can't run the on-device model. Add your own API key in Settings to use the cloud tier."
          : `Couldn't start the on-device model: ${err.message}`,
    });
    return;
  }

  try {
    const prompt =
      `Page: ${title}\n\nRelevant passages:\n\n${context}\n\nQuestion: ${question}`;
    const stream = session.promptStreaming(prompt);

    let seen = "";
    for await (const piece of stream) {
      // Chrome has shipped both cumulative and delta chunks across versions.
      const delta = piece.startsWith(seen) ? piece.slice(seen.length) : piece;
      seen = piece.startsWith(seen) ? piece : seen + piece;
      if (delta) port.postMessage({ type: "delta", text: delta });
    }
    port.postMessage({ type: "done" });
  } catch (err) {
    port.postMessage({ type: "error", message: `The on-device model stopped: ${err.message}` });
  } finally {
    // Only the per-question clone is discarded. The base session stays warm so
    // the next question doesn't pay session-setup cost all over again.
    session.destroy?.();
  }
}

/* ---------------- cloud tier ---------------- */

async function runCloud(port, { question, title, url, text }, settings) {
  const chunks = chunk(text);
  // The whole article goes in, so the spine shows the whole article as read.
  port.postMessage({
    type: "chunks",
    total: chunks.length,
    hits: chunks.map((_, i) => i),
  });

  const body = text.length > CLOUD_ARTICLE_CHARS ? text.slice(0, CLOUD_ARTICLE_CHARS) : text;
  const system =
    RULES + (settings.search ? SEARCH_RULES : "") +
    `\n\n---\nPage: ${title}\nURL: ${url}\n\n${body}`;

  const call = PROVIDERS[settings.provider] || PROVIDERS.anthropic;
  const citations = new Map();

  try {
    await call(
      { system, question, key: settings.key, model: settings.model, search: settings.search },
      (ev) => {
        if (ev.text) port.postMessage({ type: "delta", text: ev.text });
        if (ev.citation?.url && !citations.has(ev.citation.url)) {
          citations.set(ev.citation.url, ev.citation);
        }
      }
    );
    if (citations.size) port.postMessage({ type: "citations", items: [...citations.values()] });
    port.postMessage({ type: "done" });
  } catch (err) {
    port.postMessage({ type: "error", message: err.message });
  }
}

/* ---------------- ask the web, regardless of the person's default tier ---------------- */

async function runWeb(port, msg, settings) {
  if (!settings.key) {
    port.postMessage({
      type: "error",
      message: "Searching the web needs your own API key. Add one in Settings.",
    });
    return;
  }
  if (settings.provider === "openai") {
    port.postMessage({
      type: "error",
      message: "Web search isn't wired up for OpenAI yet — switch to Anthropic or Gemini in Settings.",
    });
    return;
  }
  port.postMessage({ type: "tier", tier: "cloud", detail: `${settings.provider} · web search` });
  await runCloud(port, msg, { ...settings, search: true });
}

/* ---------------- structured extraction for charts and document exports ---------------- */

const CHART_SCHEMA =
  `{"title": string, "kind": "bar"|"line", "labels": string[], ` +
  `"series": [{"name": string, "values": number[]}]}`;

const DOC_SCHEMA =
  `{"title": string, "sections": [{"heading": string, "body": string}], ` +
  `"table": {"headers": string[], "rows": string[][]} | null}`;

async function runStructured(port, { question, title, url, text }, settings, kind) {
  if (!settings.key) {
    port.postMessage({
      type: "error",
      message: "This needs your own API key, since it asks the model to do real structuring work. Add one in Settings.",
    });
    return;
  }

  const schema = kind === "chart" ? CHART_SCHEMA : DOC_SCHEMA;
  const system =
    `You extract structured data from one web page and reply with ONLY valid JSON — ` +
    `no prose, no markdown fences, no explanation. Match this shape exactly:\n${schema}\n\n` +
    (kind === "chart"
      ? `Only pick numbers that are actually stated in the page. If nothing in the page is chartable, ` +
        `return an empty "labels" and "series" array rather than inventing numbers.\n\n`
      : `Base every section on the page's actual content. Include a "table" only if the page contains ` +
        `genuinely tabular data; otherwise set it to null.\n\n`) +
    `Page: ${title}\nURL: ${url}\n\n${text.slice(0, 120000)}`;

  const call = PROVIDERS[settings.provider] || PROVIDERS.anthropic;
  let raw = "";

  try {
    await call(
      { system, question: question || "Extract it.", key: settings.key, model: settings.model, search: false },
      (ev) => { if (ev.text) raw += ev.text; }
    );
    const cleaned = raw.trim().replace(/^```json\s*|^```\s*|```$/g, "");
    const data = JSON.parse(cleaned);
    port.postMessage({ type: "structured-result", kind, data });
  } catch (err) {
    port.postMessage({
      type: "error",
      message: `Couldn't build that: ${err.message.includes("JSON") ? "the model's output wasn't valid JSON. Try again." : err.message}`,
    });
  }
}

/* ---------------- compare against something already read ---------------- */

async function runCompare(port, { title, url, text, headings, againstUrl }, settings) {
  const lib = await getLibrary();
  const other = lib.find((e) => e.url === againstUrl);
  if (!other) {
    port.postMessage({ type: "error", message: "That article is no longer in the library." });
    return;
  }

  const mine = topTerms(text, 30);
  const theirs = other.terms || [];
  const sharedTerms = mine.filter((t) => theirs.includes(t));
  const onlyMine = mine.filter((t) => !theirs.includes(t));
  const onlyTheirs = theirs.filter((t) => !mine.includes(t));

  const g = other.gist || { opening: "", headings: [] };
  const myHeadings = (headings || []).slice(0, 24);

  const system =
    `Two articles on a related topic. Compare their COVERAGE — who covers what — ` +
    `not just their conclusions. Reply with ONLY valid JSON, no prose or fences:\n` +
    `{"shared": [string], "onlyThis": [string], "onlyOther": [string], ` +
    `"contradictions": [{"point": string, "thisSays": string, "otherSays": string}], ` +
    `"note": string}\n\n` +
    `"shared" = ground both cover. "onlyThis" = substantive things THIS article covers that the ` +
    `other appears not to. "onlyOther" = the reverse. "contradictions" = where they appear to ` +
    `disagree on the same point (empty array if none). "note" = one sentence on how reliable this is.\n\n` +
    `EVIDENCE ASYMMETRY — state this plainly in "note": you have the FULL text of article one, ` +
    `but for article two only its opening, section headings and keywords. So "onlyThis" is more ` +
    `reliable than "onlyOther"; treat gaps in article two's evidence as uncertain rather than ` +
    `asserting it omits something. Never invent content for article two.\n\n` +
    `=== ARTICLE ONE (full text) ===\n${title}\n` +
    `Section headings: ${myHeadings.join(" | ") || "(none found)"}\n\n` +
    `${text.slice(0, 85000)}\n\n` +
    `=== ARTICLE TWO (partial) ===\n${other.title}\nURL: ${other.url}\n` +
    `Section headings: ${(g.headings || []).join(" | ") || "(none captured)"}\n` +
    `Opening: ${g.opening || "(not captured)"}\n` +
    `Keywords: ${theirs.join(", ")}\n\n` +
    `Term overlap: shared [${sharedTerms.join(", ") || "none"}] | ` +
    `only in one [${onlyMine.slice(0, 15).join(", ")}] | ` +
    `only in two [${onlyTheirs.slice(0, 15).join(", ")}]`;

  await runJson(port, system, "Compare their coverage.", settings, "compare");
}

/* ---------------- suggest further reading ---------------- */

async function runSuggest(port, { title, text, want }, settings) {
  const profile = await readingProfile();

  const pageTech = technicality(text);
  const depthMap = { plain: 0.20, balanced: 0.50, technical: 0.85 };
  const targetTech = settings.depth === "auto"
    ? (profile.count >= 3 ? profile.tech * 0.6 + pageTech * 0.4 : pageTech)
    : depthMap[settings.depth];

  const level = describeDepth(targetTech);
  const interests = [...new Set([...topTerms(text, 12), ...profile.terms])].slice(0, 18);

  const system =
    `You recommend further reading. Search the web, then reply with ONLY valid JSON, no fences:\n` +
    `{"picks": [{"title": string, "url": string, "why": string, "depth": string}], "calibration": string}\n\n` +
    `The reader wants material pitched at this level: ${level} (${targetTech.toFixed(2)} on a 0–1 ` +
    `plain-to-specialist scale). Match that level deliberately — do not default to the most technical ` +
    `source available, and do not oversimplify if the level is high.\n` +
    `Give 3–5 picks. Every URL must be one you actually found by searching; never invent a link.\n` +
    `"why" = one sentence tying it to what they've been reading. "depth" = a short label for its level.\n` +
    `"calibration" = one sentence naming the level you aimed at and why.\n\n` +
    `Currently reading: ${title}\n` +
    `Recurring interests across ${profile.count} article(s) read: ${interests.join(", ") || "(not enough history yet)"}\n` +
    (want ? `They specifically asked for: ${want}\n` : "");

  await runJson(port, system, want || "Suggest what to read next.", { ...settings, search: true }, "suggest");
}

/* ---------------- shared JSON-returning call ---------------- */

async function runJson(port, system, question, settings, kind) {
  if (!settings.key) {
    port.postMessage({
      type: "error",
      message: "This needs your own API key — it involves reasoning across sources. Add one in Settings.",
    });
    return;
  }
  const call = PROVIDERS[settings.provider] || PROVIDERS.anthropic;
  let raw = "";
  try {
    await call(
      { system, question, key: settings.key, model: settings.model, search: !!settings.search },
      (ev) => { if (ev.text) raw += ev.text; }
    );
    const cleaned = raw.trim().replace(/^```json\s*|^```\s*|```$/g, "");
    port.postMessage({ type: "structured-result", kind, data: JSON.parse(cleaned) });
  } catch (err) {
    port.postMessage({
      type: "error",
      message: err.message.includes("JSON")
        ? "The model's reply wasn't valid JSON. Try that again."
        : `Couldn't finish: ${err.message}`,
    });
  }
}

/* ---------------- port ---------------- */

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "margin") return;

  port.onMessage.addListener(async (msg) => {
    if (!["ask", "ask-web", "structure", "compare", "suggest"].includes(msg.type)) return;

    const settings = await getSettings();

    // Record what's being read, so comparisons and suggestions have history to work from.
    if (settings.remember && msg.text) {
      remember({
        url: msg.url, title: msg.title, text: msg.text,
        words: msg.text.split(/\s+/).length, headings: msg.headings,
      }).catch(() => {});
    }

    if (msg.type === "compare") {
      try { await runCompare(port, msg, settings); } finally { port.disconnect(); }
      return;
    }
    if (msg.type === "suggest") {
      try { await runSuggest(port, msg, settings); } finally { port.disconnect(); }
      return;
    }
    if (msg.type === "ask-web") {
      try { await runWeb(port, msg, settings); } finally { port.disconnect(); }
      return;
    }
    if (msg.type === "structure") {
      try { await runStructured(port, msg, settings, msg.kind); } finally { port.disconnect(); }
      return;
    }

    const { tier, detail, local } = await resolveTier(settings);
    port.postMessage({ type: "tier", tier, detail });

    try {
      if (tier === "cloud") await runCloud(port, msg, settings);
      else if (tier === "local") await runLocal(port, msg, local);
      else {
        port.postMessage({
          type: "error",
          message:
            "No model available. Chrome 138+ can run the on-device model, or you can add your own API key in Settings.",
        });
      }
    } finally {
      port.disconnect();
    }
  });
});
