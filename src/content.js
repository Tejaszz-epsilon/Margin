/* Margin — content script.
   Runs in the isolated world. Owns extraction + UI; network only via the background port. */

(() => {
  if (window.__marginLoaded) return;
  window.__marginLoaded = true;

  const MIN_WORDS = 700;

  let article = null;   // { title, text, words, sources }
  let host = null;      // shadow host element
  let root = null;      // shadow root
  let ui = null;        // cached element refs
  let open = false;
  let busy = false;
  let currentTier = "unknown";
  let history = [];     // { role: 'you'|'margin', text, citations? } — for markdown export
  let forceWeb = false;
  let pendingAction = null; // 'chart' | null — 'doc' is dispatched immediately, no pending state needed
  let sourcesShown = false;
  const loadedLibs = new Set();

  /* ---------------- extraction ---------------- */

  function extractSources() {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll("a[href^='http']")) {
      let u;
      try { u = new URL(a.href); } catch { continue; }
      if (u.hostname === location.hostname) continue;
      if (seen.has(u.href)) continue;
      const text = (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 90);
      if (!text) continue;
      seen.add(u.href);
      out.push({ text, url: u.href, host: u.hostname.replace(/^www\./, "") });
      if (out.length >= 40) break;
    }
    return out;
  }

  function extract() {
    try {
      if (typeof isProbablyReaderable === "function" && !isProbablyReaderable(document)) {
        return null;
      }
      const sources = extractSources(); // run before Readability touches a clone
      const headings = [...document.querySelectorAll("h1,h2,h3")]
        .map((h) => (h.textContent || "").trim().replace(/\s+/g, " "))
        .filter((t) => t && t.length < 120)
        .slice(0, 24);
      const clone = document.cloneNode(true);
      const parsed = new Readability(clone, { charThreshold: 500 }).parse();
      if (!parsed || !parsed.textContent) return null;

      const text = parsed.textContent.replace(/\n{3,}/g, "\n\n").trim();
      const words = text.split(/\s+/).length;
      if (words < MIN_WORDS) return null;

      return { title: parsed.title || document.title, text, words, sources, headings };
    } catch {
      return null;
    }
  }

  /* ---------------- shadow host ---------------- */

  function mount() {
    if (host) return;
    host = document.createElement("div");
    host.id = "margin-root";
    root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = RP_STYLES;
    root.appendChild(style);
    document.documentElement.appendChild(host);
    renderLauncher();
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------------- launcher ---------------- */

  function renderLauncher() {
    const b = el("button", "launcher");
    b.append(el("span", "rule"), el("span", null, "Margin"),
             el("span", "count", `${Math.round(article.words / 100) / 10}k words`));
    b.addEventListener("click", openPanel);
    root.appendChild(b);
  }

  function removeLauncher() {
    const l = root.querySelector(".launcher");
    if (l) l.remove();
  }

  /* ---------------- panel ---------------- */

  function openPanel() {
    if (open) return;
    open = true;
    removeLauncher();

    const panel = el("div", "panel");

    const head = el("div", "head");
    const badge = el("span", "badge local", "checking");
    const doc = el("div", "doc", article.title);
    const close = el("button", "x", "\u00d7");
    close.title = "Close";
    close.addEventListener("click", closePanel);
    head.append(badge, doc, close);

    const toolbar = buildToolbar();

    const body = el("div", "body");
    const spine = el("div", "spine");
    spine.appendChild(el("div", "track"));
    const thread = el("div", "thread");

    const empty = el("p", "empty");
    empty.append(
      "Ask anything about this page. Answers run ",
      Object.assign(el("b"), { textContent: "on your device" }),
      " unless you add a key."
    );
    thread.appendChild(empty);
    body.append(spine, thread);

    const foot = el("div", "foot");
    const row = el("div", "row");
    const ask = el("textarea", "ask");
    ask.rows = 1;
    ask.placeholder = "What does this argue?";
    const send = el("button", "send", "Ask");
    row.append(ask, send);

    const meta = el("div", "meta");
    const tierNote = el("span", null, "");
    const settingsBtn = el("button", null, "Settings");
    settingsBtn.addEventListener("click", openSettings);
    meta.append(tierNote, settingsBtn);
    foot.append(row, meta);

    panel.append(head, toolbar, body, foot);
    root.appendChild(panel);

    ui = { panel, badge, spine, thread, ask, send, tierNote, toolbar };

    ask.addEventListener("input", () => {
      ask.style.height = "auto";
      ask.style.height = Math.min(ask.scrollHeight, 96) + "px";
    });
    ask.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
      if (e.key === "Escape") closePanel();
    });
    send.addEventListener("click", submit);
    makeDraggable(panel, head);
    mountShuttle();
    ask.focus();

    chrome.runtime.sendMessage({ type: "tier-check" }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      paintTier(res.tier, res.detail);
    });
  }

  function closePanel() {
    if (!open) return;
    open = false;
    clearFind();
    hidePeek();
    if (ui?._onScroll) {
      window.removeEventListener("scroll", ui._onScroll);
      window.removeEventListener("resize", ui._onScroll);
    }
    document.querySelectorAll("mark[data-margin-passage]").forEach((m) => {
      m.replaceWith(document.createTextNode(m.textContent));
    });
    if (ui) ui.panel.remove();
    ui = null;
    renderLauncher();
  }

  /* Drag by the header. The panel lifts while moving — depth as feedback,
     so it reads as an object over the page rather than a pinned box. */
  function makeDraggable(panel, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      panel.style.left = r.left + "px";
      panel.style.top = r.top + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      handle.classList.add("dragging");
      panel.classList.add("lifted");
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const w = panel.offsetWidth, h = panel.offsetHeight;
      const nx = Math.min(window.innerWidth - w - 4, Math.max(4, ox + e.clientX - sx));
      const ny = Math.min(window.innerHeight - h - 4, Math.max(4, oy + e.clientY - sy));
      panel.style.left = nx + "px";
      panel.style.top = ny + "px";
    });

    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("dragging");
      panel.classList.remove("lifted");
      try { handle.releasePointerCapture(e.pointerId); } catch {}
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function openSettings() {
    chrome.runtime.sendMessage({ type: "open-options" });
  }

  function paintTier(tier, detail) {
    currentTier = tier;
    if (!ui) return;
    ui.badge.className = "badge " + (tier === "cloud" ? "cloud" : "local");
    ui.badge.textContent = tier === "cloud" ? "cloud" : "on-device";
    ui.spine.classList.toggle("cloud", tier === "cloud");
    ui.tierNote.textContent = detail || "";
    paintLocks();
  }

  function paintLocks() {
    if (!ui) return;
    ui.toolbar.querySelectorAll("[data-cloud]").forEach((b) => {
      b.classList.toggle("locked", currentTier !== "cloud");
    });
  }

  /* ---------------- toolbar ---------------- */

  function buildToolbar() {
    const bar = el("div", "toolbar");

    const findBtn = tool("Find", () => toggleFind());
    const srcBtn = tool("Sources", () => toggleSources());
    const mdBtn = tool("Export MD", () => exportMarkdown());
    const webBtn = tool("Web", () => toggleWeb(webBtn), true);
    const chartBtn = tool("Chart", () => toggleChart(chartBtn), true);
    const docBtn = tool("Doc", (e) => toggleDocMenu(e, docBtn), true);
    const cmpBtn = tool("Compare", () => openCompare(), true);
    const sugBtn = tool("Suggest", () => toggleSuggest(sugBtn), true);

    bar.append(findBtn, srcBtn, mdBtn, webBtn, chartBtn, docBtn, cmpBtn, sugBtn);
    return bar;
  }

  function tool(label, onClick, cloud) {
    const b = el("button", "tool", label);
    if (cloud) b.dataset.cloud = "1";
    b.addEventListener("click", (e) => {
      if (cloud && currentTier !== "cloud") { openSettings(); return; }
      onClick(e);
    });
    return b;
  }

  /* ---------------- find in page ---------------- */

  let findState = null; // { marks: [], idx: 0 }

  function toggleFind() {
    if (ui.toolbar.parentElement.querySelector(".findbar")) { clearFind(); return; }
    const bar = el("div", "findbar");
    const input = el("input");
    input.type = "text";
    input.placeholder = "Find on page…";
    const count = el("span", "count", "");
    const prev = el("button", null, "\u2191");
    const next = el("button", null, "\u2193");
    const done = el("button", null, "Done");

    bar.append(input, count, prev, next, done);
    ui.toolbar.after(bar);

    input.addEventListener("input", () => doFind(input.value, count));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1, count); }
      if (e.key === "Escape") clearFind();
    });
    prev.addEventListener("click", () => step(-1, count));
    next.addEventListener("click", () => step(1, count));
    done.addEventListener("click", clearFind);
    input.focus();
  }

  function doFind(query, countEl) {
    clearMarks();
    findState = { marks: [], idx: 0 };
    const q = query.trim();
    if (!q) { countEl.textContent = ""; return; }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (n.parentElement?.closest("#margin-root, script, style, noscript")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const lower = q.toLowerCase();
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    for (const node of nodes) {
      const text = node.nodeValue;
      const low = text.toLowerCase();
      let from = 0;
      let idx;
      const frag = document.createDocumentFragment();
      let any = false;
      while ((idx = low.indexOf(lower, from)) !== -1) {
        any = true;
        frag.appendChild(document.createTextNode(text.slice(from, idx)));
        const mark = document.createElement("mark");
        mark.dataset.marginHl = "1";
        mark.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(mark);
        findState.marks.push(mark);
        from = idx + q.length;
      }
      if (any) {
        frag.appendChild(document.createTextNode(text.slice(from)));
        node.parentNode.replaceChild(frag, node);
      }
    }

    countEl.textContent = findState.marks.length ? `1 / ${findState.marks.length}` : "0";
    if (findState.marks.length) focusMark(0, countEl);
  }

  function step(dir, countEl) {
    if (!findState || !findState.marks.length) return;
    findState.idx = (findState.idx + dir + findState.marks.length) % findState.marks.length;
    focusMark(findState.idx, countEl);
  }

  function focusMark(i, countEl) {
    findState.marks.forEach((m) => m.classList.remove("current"));
    const m = findState.marks[i];
    m.classList.add("current");
    m.scrollIntoView({ block: "center", behavior: "smooth" });
    countEl.textContent = `${i + 1} / ${findState.marks.length}`;
  }

  function clearMarks() {
    if (!findState) return;
    findState.marks.forEach((m) => {
      const t = document.createTextNode(m.textContent);
      m.replaceWith(t);
    });
    findState = null;
  }

  function clearFind() {
    clearMarks();
    const bar = ui?.toolbar.parentElement?.querySelector(".findbar");
    if (bar) bar.remove();
  }

  /* ---------------- sources ---------------- */

  function toggleSources() {
    if (sourcesShown) {
      ui.thread.querySelector(".turn.sources")?.remove();
      sourcesShown = false;
      return;
    }
    const e = ui.thread.querySelector(".empty");
    if (e) e.remove();

    const turn = el("div", "turn margin sources");
    turn.append(el("div", "who", "Sources on this page"));
    if (!article.sources.length) {
      turn.append(el("div", "text", "No outbound links found on this page."));
    } else {
      const list = el("ul", "sources");
      article.sources.forEach((s) => {
        const li = el("li");
        const a = el("a", null, s.text);
        a.href = s.url; a.target = "_blank"; a.rel = "noreferrer";
        const hostSpan = el("span", "host", s.host);
        li.append(a, hostSpan);
        list.appendChild(li);
      });
      turn.appendChild(list);
    }
    ui.thread.appendChild(turn);
    ui.thread.scrollTop = ui.thread.scrollHeight;
    sourcesShown = true;
  }

  /* ---------------- markdown export ---------------- */

  function exportMarkdown() {
    const lines = [`# ${article.title}`, "", `Source: ${location.href}`, ""];
    if (!history.length) {
      lines.push("_No questions asked yet._");
    } else {
      for (const turn of history) {
        lines.push(turn.role === "you" ? "**You**" : "**Margin**");
        lines.push("");
        lines.push(turn.text || "");
        if (turn.citations?.length) {
          lines.push("");
          lines.push("Beyond this page: " + turn.citations.map((c) => `[${c.title || c.url}](${c.url})`).join(" · "));
        }
        lines.push("");
      }
    }
    if (article.sources?.length) {
      lines.push("---", "", "## Sources on this page", "");
      article.sources.forEach((s) => lines.push(`- [${s.text}](${s.url})`));
    }
    downloadBlob(new Blob([lines.join("\n")], { type: "text/markdown" }), slug(article.title) + ".md");
  }

  function slug(s) {
    return (s || "page").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ---------------- web-search toggle ---------------- */

  function toggleWeb(btn) {
    forceWeb = !forceWeb;
    pendingAction = null;
    ui.toolbar.querySelectorAll(".tool").forEach((b) => { if (b !== btn) b.classList.remove("active"); });
    btn.classList.toggle("active", forceWeb);
    ui.ask.placeholder = forceWeb ? "Ask, searching the web…" : "What does this argue?";
    ui.ask.focus();
  }

  /* ---------------- chart ---------------- */

  function toggleChart(btn) {
    pendingAction = pendingAction === "chart" ? null : "chart";
    forceWeb = false;
    ui.toolbar.querySelectorAll(".tool").forEach((b) => b.classList.remove("active"));
    btn.classList.toggle("active", pendingAction === "chart");
    ui.ask.placeholder = pendingAction === "chart" ? "What should the chart show?" : "What does this argue?";
    ui.ask.focus();
  }

  function renderChart(data) {
    const e = ui.thread.querySelector(".empty");
    if (e) e.remove();
    const turn = el("div", "turn margin");
    turn.append(el("div", "who", "Chart"));

    if (!data.labels?.length || !data.series?.length) {
      turn.append(el("div", "text", "Nothing chartable was stated numerically on this page."));
      ui.thread.appendChild(turn);
      ui.thread.scrollTop = ui.thread.scrollHeight;
      return;
    }

    const wrap = el("div", "chartwrap");
    const svg = buildChartSVG(data);
    wrap.appendChild(svg);
    const save = el("button", "savepng", "Save as PNG");
    save.addEventListener("click", () => savePng(svg, slug(data.title || article.title) + "-chart.png"));
    wrap.appendChild(save);
    turn.appendChild(wrap);
    ui.thread.appendChild(turn);
    ui.thread.scrollTop = ui.thread.scrollHeight;
  }

  function buildChartSVG(data) {
    const W = 420, H = 220, padL = 34, padB = 24, padT = 22, padR = 12;
    const colors = ["#C79A3E", "#6E9DC4", "#8A8FA6", "#B9C0CA"];
    const labels = data.labels;
    const series = data.series;
    const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => Number(v) || 0)));

    const plotW = W - padL - padR, plotH = H - padT - padB;
    const groupW = plotW / labels.length;
    const barW = Math.max(4, (groupW * 0.7) / series.length);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.title || "Chart");

    const ns = "http://www.w3.org/2000/svg";
    const mk = (tag, attrs) => {
      const n = document.createElementNS(ns, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    };

    svg.appendChild(mk("line", { x1: padL, y1: H - padB, x2: W - padR, y2: H - padB, stroke: "#2C323D" }));

    labels.forEach((label, i) => {
      const gx = padL + i * groupW + groupW / 2;
      series.forEach((s, si) => {
        const v = Number(s.values[i]) || 0;
        const bh = (v / max) * plotH;
        const bx = gx - (series.length * barW) / 2 + si * barW;
        const rect = mk("rect", {
          x: bx.toFixed(1), y: (H - padB - bh).toFixed(1),
          width: (barW - 1.5).toFixed(1), height: bh.toFixed(1),
          fill: colors[si % colors.length],
        });
        svg.appendChild(rect);
      });
      const t = mk("text", {
        x: gx.toFixed(1), y: H - 8, "text-anchor": "middle",
        "font-size": "8.5", fill: "#878F9B", "font-family": "ui-monospace, monospace",
      });
      t.textContent = label.length > 12 ? label.slice(0, 11) + "\u2026" : label;
      svg.appendChild(t);
    });

    const title = mk("text", {
      x: 4, y: 13, "font-size": "10", fill: "#E6E4DF", "font-family": "ui-monospace, monospace",
    });
    title.textContent = data.title || "";
    svg.appendChild(title);

    return svg;
  }

  function savePng(svg, filename) {
    const xml = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const vb = svg.viewBox.baseVal;
      const canvas = document.createElement("canvas");
      canvas.width = vb.width * scale; canvas.height = vb.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#0F1216";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => downloadBlob(blob, filename), "image/png");
    };
    img.src = url;
  }

  /* ---------------- document export (docx / xlsx / pptx) ---------------- */

  function toggleDocMenu(e, btn) {
    const existing = ui.panel.querySelector(".toolflyout");
    if (existing) { existing.remove(); return; }

    const menu = el("div", "toolflyout");
    menu.style.position = "absolute";
    menu.style.top = (btn.getBoundingClientRect().bottom - ui.panel.getBoundingClientRect().top) + "px";
    menu.style.right = "10px";

    const note = el("div", "note", "Builds the whole article into a file.");
    menu.appendChild(note);
    [["Word (.docx)", "docx"], ["Excel (.xlsx)", "xlsx"], ["Slides (.pptx)", "pptx"]].forEach(([label, fmt]) => {
      const b = el("button", null, label);
      b.addEventListener("click", () => { menu.remove(); requestDoc(fmt); });
      menu.appendChild(b);
    });
    ui.panel.appendChild(menu);

    const away = (ev) => {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("click", away, true); }
    };
    setTimeout(() => document.addEventListener("click", away, true), 0);
  }

  function requestDoc(format) {
    if (busy) return;
    setBusy(true);

    const turn = el("div", "turn margin");
    turn.append(el("div", "who", "Preparing " + format.toUpperCase()));
    const textNode = el("div", "text", "Structuring the article\u2026");
    turn.appendChild(textNode);
    const e = ui.thread.querySelector(".empty");
    if (e) e.remove();
    ui.thread.appendChild(turn);
    ui.thread.scrollTop = ui.thread.scrollHeight;

    const port = chrome.runtime.connect({ name: "margin" });
    port.onMessage.addListener((msg) => {
      if (msg.type === "structured-result" && msg.kind === "doc") {
        buildAndDownload(format, msg.data, textNode);
      } else if (msg.type === "error") {
        textNode.textContent = msg.message;
      }
    });
    port.onDisconnect.addListener(() => setBusy(false));
    port.postMessage({
      type: "structure", kind: "doc", question: "",
      title: article.title, url: location.href, text: article.text,
    });
  }

  async function ensureLib(file, globalName) {
    if (loadedLibs.has(file) && window[globalName]) return;
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "load-lib", file }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) reject(new Error(res?.error || "Couldn't load the export library."));
        else resolve();
      });
    });
    loadedLibs.add(file);
  }

  async function buildAndDownload(format, data, statusNode) {
    try {
      let blob, filename;
      if (format === "docx") {
        await ensureLib("docx.iife.js", "docx");
        blob = await buildDocxBlob(data);
        filename = slug(data.title || article.title) + ".docx";
      } else if (format === "xlsx") {
        await ensureLib("xlsx.full.min.js", "XLSX");
        blob = buildXlsxBlob(data);
        filename = slug(data.title || article.title) + ".xlsx";
      } else {
        await ensureLib("pptxgen.bundle.js", "PptxGenJS");
        blob = await buildPptxBlob(data);
        filename = slug(data.title || article.title) + ".pptx";
      }
      downloadBlob(blob, filename);
      statusNode.textContent = `Saved ${filename}.`;
    } catch (err) {
      statusNode.textContent = "Couldn't build the file: " + err.message;
    } finally {
      setBusy(false);
    }
  }

  function buildDocxBlob(data) {
    const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell } = window.docx;
    const children = [new Paragraph({ text: data.title || article.title, heading: HeadingLevel.TITLE })];
    (data.sections || []).forEach((s) => {
      children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1 }));
      children.push(new Paragraph({ text: s.body }));
    });
    if (data.table?.headers?.length) {
      const rows = [data.table.headers, ...(data.table.rows || [])].map(
        (r) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph(String(c))] })) })
      );
      children.push(new Table({ rows }));
    }
    const doc = new Document({ sections: [{ children }] });
    return Packer.toBlob(doc);
  }

  function buildXlsxBlob(data) {
    const wb = XLSX.utils.book_new();
    if (data.table?.headers?.length) {
      const ws = XLSX.utils.aoa_to_sheet([data.table.headers, ...(data.table.rows || [])]);
      XLSX.utils.book_append_sheet(wb, ws, "Data");
    } else {
      const rows = (data.sections || []).map((s) => [s.heading, s.body]);
      const ws = XLSX.utils.aoa_to_sheet([["Section", "Content"], ...rows]);
      XLSX.utils.book_append_sheet(wb, ws, "Summary");
    }
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function buildPptxBlob(data) {
    const p = new PptxGenJS();
    const title = p.addSlide();
    title.addText(data.title || article.title, { x: 0.6, y: 2.2, w: 8.8, fontSize: 32, bold: true, color: "17181C" });
    (data.sections || []).forEach((s) => {
      const slide = p.addSlide();
      slide.addText(s.heading, { x: 0.5, y: 0.35, w: 9, fontSize: 22, bold: true, color: "17181C" });
      slide.addText(s.body, { x: 0.5, y: 1.2, w: 9, h: 4, fontSize: 14, color: "333333", valign: "top" });
    });
    return p.write({ outputType: "blob" });
  }

  /* ---------------- thread rendering ---------------- */

  function addTurn(who, text) {
    const e = ui.thread.querySelector(".empty");
    if (e) e.remove();
    const turn = el("div", "turn " + (who === "you" ? "you" : "margin"));
    turn.append(el("div", "who", who === "you" ? "You" : "Margin"),
                el("div", "text", text || ""));
    ui.thread.appendChild(turn);
    ui.thread.scrollTop = ui.thread.scrollHeight;
    return turn;
  }

  function paintSpine(total, hits, snippets) {
    ui.spine.querySelectorAll(".seg").forEach((s) => s.remove());
    if (!total) return;

    const heads = new Map((snippets || []).map((s) => [s.index, s.head]));
    const trackH = 100;

    hits.forEach((i) => {
      const seg = el("button", "seg");
      seg.style.top = `calc(14px + ${(i / total) * trackH}%)`;
      seg.style.height = `calc(${(1 / total) * trackH}% - 2px)`;
      seg.title = "Jump to this passage";
      seg.setAttribute("aria-label", `Passage ${i + 1} of ${total}`);

      const head = heads.get(i);
      if (head) {
        seg.addEventListener("mouseenter", () => showPeek(seg, head));
        seg.addEventListener("mouseleave", hidePeek);
        seg.addEventListener("focus", () => showPeek(seg, head));
        seg.addEventListener("blur", hidePeek);
        seg.addEventListener("click", () => {
          ui.spine.querySelectorAll(".seg").forEach((x) => x.classList.remove("reading"));
          seg.classList.add("reading");
          jumpToPassage(head);
        });
      }

      ui.spine.appendChild(seg);
      requestAnimationFrame(() => seg.classList.add("on"));
    });
  }

  /* hover a segment, see the passage without leaving the panel */
  function showPeek(seg, text) {
    hidePeek();
    const peek = el("div", "peek", text.length > 190 ? text.slice(0, 190) + "\u2026" : text);
    const segTop = seg.offsetTop;
    peek.style.top = Math.max(4, segTop - 8) + "px";
    ui.spine.parentElement.appendChild(peek);
    requestAnimationFrame(() => peek.classList.add("on"));
    ui._peek = peek;
  }

  function hidePeek() {
    if (ui?._peek) { ui._peek.remove(); ui._peek = null; }
  }

  /* Find the passage in the live DOM and scroll to it. The spine stops being a
     readout and becomes a map of the document you can actually navigate. */
  function jumpToPassage(head) {
    document.querySelectorAll("mark[data-margin-passage]").forEach((m) => {
      m.replaceWith(document.createTextNode(m.textContent));
    });

    const needle = head.replace(/\s+/g, " ").trim().slice(0, 45).toLowerCase();
    if (!needle) return;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (n.parentElement?.closest("#margin-root, script, style, noscript")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node;
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue.toLowerCase().indexOf(needle.slice(0, 28));
      if (idx === -1) continue;

      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, Math.min(node.nodeValue.length, idx + needle.length));
      const mark = document.createElement("mark");
      mark.dataset.marginPassage = "1";
      try { range.surroundContents(mark); } catch { return; }

      mark.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => mark.classList.add("fade"), 900);
      setTimeout(() => {
        if (mark.parentNode) mark.replaceWith(document.createTextNode(mark.textContent));
      }, 2400);
      return;
    }
  }

  /* the shuttle mirrors the real viewport onto the spine */
  function mountShuttle() {
    const shuttle = el("div", "shuttle");
    ui.spine.appendChild(shuttle);
    ui._shuttle = shuttle;

    const paint = () => {
      if (!ui?._shuttle) return;
      const doc = document.documentElement;
      const total = Math.max(1, doc.scrollHeight - doc.clientHeight);
      const frac = Math.min(1, Math.max(0, window.scrollY / total));
      const visible = Math.min(1, doc.clientHeight / doc.scrollHeight);
      shuttle.style.top = `calc(14px + ${frac * (1 - visible) * 100}%)`;
      shuttle.style.height = `calc(${visible * 100}%)`;
    };
    paint();
    ui._onScroll = () => requestAnimationFrame(paint);
    window.addEventListener("scroll", ui._onScroll, { passive: true });
    window.addEventListener("resize", ui._onScroll, { passive: true });
  }

  function setBusy(b) {
    busy = b;
    if (!ui) return;
    ui.send.disabled = b;
  }

  /* ---------------- ask ---------------- */

  function submit() {
    if (busy || !ui) return;
    const q = ui.ask.value.trim();
    if (!q) return;

    const useWeb = forceWeb;
    const useChart = pendingAction === "chart";
    const useSuggest = pendingAction === "suggest";
    ui.ask.value = "";
    ui.ask.style.height = "auto";
    forceWeb = false;
    pendingAction = null;
    ui.ask.placeholder = "What does this argue?";
    ui.toolbar.querySelectorAll(".tool").forEach((b) => b.classList.remove("active"));

    addTurn("you", q);
    history.push({ role: "you", text: q });

    if (useChart) { requestChart(q); return; }
    if (useSuggest) { requestSuggest(q); return; }

    const turn = addTurn("margin", "");
    const textNode = turn.querySelector(".text");
    const caret = el("span", "caret");
    textNode.appendChild(caret);

    setBusy(true);

    const port = chrome.runtime.connect({ name: "margin" });
    let answer = "";
    let turnCitations = [];

    port.onMessage.addListener((msg) => {
      if (!ui) return;
      switch (msg.type) {
        case "tier":
          paintTier(msg.tier, msg.detail);
          break;
        case "chunks":
          paintSpine(msg.total, msg.hits, msg.snippets);
          break;
        case "status":
          textNode.textContent = msg.text;
          textNode.appendChild(caret);
          break;
        case "delta":
          if (!answer) textNode.textContent = "";
          answer += msg.text;
          textNode.textContent = answer;
          textNode.appendChild(caret);
          ui.thread.scrollTop = ui.thread.scrollHeight;
          break;
        case "citations":
          if (msg.items && msg.items.length) {
            turnCitations = msg.items;
            const cite = el("div", "cite");
            cite.appendChild(el("span", null, "Beyond this page: "));
            msg.items.slice(0, 4).forEach((c, i) => {
              const a = el("a", null, c.title || new URL(c.url).hostname);
              a.href = c.url;
              a.target = "_blank";
              a.rel = "noreferrer";
              cite.appendChild(a);
              if (i < Math.min(msg.items.length, 4) - 1) cite.appendChild(el("span", null, " · "));
            });
            turn.appendChild(cite);
          }
          break;
        case "error":
          caret.remove();
          textNode.remove();
          turn.appendChild(Object.assign(el("div", "notice"), { textContent: msg.message }));
          break;
        case "done":
          caret.remove();
          history.push({ role: "margin", text: answer, citations: turnCitations });
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      caret.remove();
      setBusy(false);
      if (ui) ui.ask.focus();
    });

    port.postMessage({
      type: useWeb ? "ask-web" : "ask",
      question: q,
      title: article.title,
      url: location.href,
      text: article.text,
      headings: article.headings,
    });
  }

  function requestChart(question) {
    const turn = addTurn("margin", "Reading the numbers on this page\u2026");
    setBusy(true);

    const port = chrome.runtime.connect({ name: "margin" });
    port.onMessage.addListener((msg) => {
      if (msg.type === "structured-result" && msg.kind === "chart") {
        turn.remove();
        renderChart(msg.data);
      } else if (msg.type === "error") {
        turn.querySelector(".text").textContent = msg.message;
      }
    });
    port.onDisconnect.addListener(() => setBusy(false));
    port.postMessage({
      type: "structure", kind: "chart", question,
      title: article.title, url: location.href, text: article.text,
    });
  }


  /* ---------------- compare with something already read ---------------- */

  function openCompare() {
    chrome.runtime.sendMessage({ type: "library" }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      const others = (res.lib || []).filter((e) => e.url !== location.href);

      const e = ui.thread.querySelector(".empty");
      if (e) e.remove();

      const turn = el("div", "turn margin");
      turn.append(el("div", "who", "Compare with"));

      if (!others.length) {
        turn.append(el("div", "text",
          "Nothing else read yet. Open another long article and ask a question there \u2014 Margin will remember it, and you can come back to compare."));
        ui.thread.appendChild(turn);
        ui.thread.scrollTop = ui.thread.scrollHeight;
        return;
      }

      const picker = el("div", "picker");
      others.slice(0, 12).forEach((entry) => {
        const b = el("button");
        b.appendChild(document.createTextNode(entry.title || entry.url));
        const meta = el("span", "meta2",
          `${describeDepthLocal(entry.tech)} \u00b7 ${Math.round(entry.words / 100) / 10}k words`);
        b.appendChild(meta);
        b.addEventListener("click", () => { picker.remove(); requestCompare(entry, turn); });
        picker.appendChild(b);
      });
      turn.appendChild(picker);
      ui.thread.appendChild(turn);
      ui.thread.scrollTop = ui.thread.scrollHeight;
    });
  }

  function describeDepthLocal(t) {
    if (t == null) return "unknown";
    if (t < 0.30) return "plain-language";
    if (t < 0.48) return "general-audience";
    if (t < 0.66) return "informed";
    if (t < 0.82) return "technical";
    return "specialist";
  }

  function requestCompare(entry, turn) {
    setBusy(true);
    const status = el("div", "text", `Comparing with \u201c${entry.title}\u201d\u2026`);
    turn.appendChild(status);

    const port = chrome.runtime.connect({ name: "margin" });
    port.onMessage.addListener((msg) => {
      if (msg.type === "structured-result" && msg.kind === "compare") {
        status.remove();
        renderCompare(turn, msg.data, entry);
      } else if (msg.type === "error") {
        status.textContent = msg.message;
      }
    });
    port.onDisconnect.addListener(() => setBusy(false));
    port.postMessage({
      type: "compare",
      title: article.title, url: location.href, text: article.text,
      headings: article.headings, againstUrl: entry.url,
    });
  }

  function renderCompare(turn, data, entry) {
    const card = el("div", "card");
    const otherName = (entry.title || "the other article").slice(0, 46);

    const group = (label, items, alt) => {
      if (!items?.length) return;
      card.appendChild(el("div", "grouphead" + (alt ? " alt" : ""), label));
      const ul = el("ul");
      items.forEach((p) => ul.appendChild(el("li", null, p)));
      card.appendChild(ul);
    };

    group("Only here", data.onlyThis);
    group(`Only in \u201c${otherName}\u201d`, data.onlyOther, true);
    group("Both cover", data.shared);

    if (data.contradictions?.length) {
      card.appendChild(el("div", "grouphead alt", "They disagree on"));
      const ul = el("ul");
      data.contradictions.forEach((c) => {
        const li = el("li");
        li.appendChild(el("span", "side", c.point));
        li.appendChild(document.createTextNode(`This page: ${c.thisSays} \u2014 ${otherName}: ${c.otherSays}`));
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }

    if (data.note) card.appendChild(el("div", "foot-note", data.note));
    turn.appendChild(card);
    ui.thread.scrollTop = ui.thread.scrollHeight;
  }

  /* ---------------- suggest further reading ---------------- */

  function toggleSuggest(btn) {
    pendingAction = pendingAction === "suggest" ? null : "suggest";
    forceWeb = false;
    ui.toolbar.querySelectorAll(".tool").forEach((b) => b.classList.remove("active"));
    btn.classList.toggle("active", pendingAction === "suggest");
    ui.ask.placeholder = pendingAction === "suggest"
      ? "What kind of thing? (or leave blank)"
      : "What does this argue?";
    ui.ask.focus();
  }

  function requestSuggest(want) {
    const turn = addTurn("margin", "Looking for something to read next\u2026");
    setBusy(true);

    const port = chrome.runtime.connect({ name: "margin" });
    port.onMessage.addListener((msg) => {
      if (msg.type === "structured-result" && msg.kind === "suggest") {
        turn.remove();
        renderSuggest(msg.data, want);
      } else if (msg.type === "error") {
        turn.querySelector(".text").textContent = msg.message;
      }
    });
    port.onDisconnect.addListener(() => setBusy(false));
    port.postMessage({
      type: "suggest", want,
      title: article.title, url: location.href, text: article.text,
    });
  }

  function renderSuggest(data, want) {
    const e = ui.thread.querySelector(".empty");
    if (e) e.remove();

    const turn = el("div", "turn margin");
    turn.append(el("div", "who", "Read next"));
    const card = el("div", "card");

    if (!data.picks?.length) {
      card.appendChild(el("div", "text", "Nothing solid came back. Try naming a angle you want."));
    } else {
      data.picks.forEach((p) => {
        if (!p.url) return;
        const a = el("a", "pick");
        a.href = p.url; a.target = "_blank"; a.rel = "noreferrer";
        a.appendChild(el("span", "t", p.title || p.url));
        if (p.why) a.appendChild(el("span", "w", p.why));
        if (p.depth) a.appendChild(el("span", "d", p.depth));
        card.appendChild(a);
      });
    }

    if (data.calibration) card.appendChild(el("div", "foot-note", data.calibration));
    turn.appendChild(card);
    renderGauge(turn);
    ui.thread.appendChild(turn);
    ui.thread.scrollTop = ui.thread.scrollHeight;
  }

  function renderGauge(turn) {
    chrome.runtime.sendMessage({ type: "library" }, (res) => {
      if (chrome.runtime.lastError || !res?.profile) return;
      const g = el("div", "gauge");
      const rail = el("div", "rail");
      const dot = el("div", "dot");
      dot.style.left = `${Math.round(res.profile.tech * 100)}%`;
      rail.appendChild(dot);
      const ends = el("div", "ends");
      ends.append(el("span", null, "plain"), 
                  el("span", null, `${res.profile.label} \u00b7 ${res.profile.count} read`),
                  el("span", null, "specialist"));
      g.append(rail, ends);
      turn.appendChild(g);
    });
  }

  /* ---------------- boot ---------------- */

  article = extract();
  if (article) mount();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "toggle") return;
    if (!article) {
      article = extract();
      if (!article) return;
      mount();
    }
    open ? closePanel() : openPanel();
  });
})();
