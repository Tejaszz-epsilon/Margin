# Margin

A floating panel that lets you ask questions about long articles. Answers run
**on your device** by default. Add your own API key and it reads the whole page
at once and can look beyond it.

---

## Install (unpacked)

1. `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → select this folder
3. Open any long article. A small pill appears bottom-right. `Alt+M` toggles it.

Requires Chrome 138+ for the on-device tier. Without it, Margin still works
once you add a key in Settings.

---

## Toolbar

Six tools sit under the header. Three work on any tier, three need a key:

| Tool | Tier | What it does |
|---|---|---|
| **Find** | either | Highlights and steps through matches on the live page — plain DOM search, no model involved |
| **Sources** | either | Lists the page's outbound links, extracted from the DOM before Readability strips them |
| **Export MD** | either | Downloads the Q&A thread (plus the source list) as a `.md` file |
| **Web** | cloud | Forces the next question through Anthropic with `web_search` on, for that one turn only |
| **Chart** | cloud | Asks the model to pull real numbers from the page as JSON, then draws a small SVG bar chart in the panel's own palette — no charting library |
| **Doc** | cloud | Structures the article into headings/sections (+ a table if one genuinely exists), then builds a real `.docx` / `.xlsx` / `.pptx` client-side |
| **Compare** | cloud | Pick something read earlier; returns what's **only here**, **only there**, shared ground, and direct contradictions |
| **Suggest** | cloud | Recommends further reading pitched at your learned depth level |

Cloud-only tools stay visible but dimmed on Tier 1, and clicking one opens
Settings rather than silently failing — the point is to make the ceiling
visible, not hide it.

**Why the office exports don't bloat every page load.** `docx`, `xlsx`, and
`pptxgenjs` are ~2.4MB combined. They are *not* declared in
`content_scripts` — they're injected on demand via
`chrome.scripting.executeScript` the moment someone actually clicks
Word/Excel/PowerPoint, straight into the same isolated world `content.js`
already runs in. Every other page pays nothing for a feature it never uses.

**Why Chart doesn't use Chart.js.** The panel already has a signature visual
language — the spine. A bolted-on charting library would look like two
different products stitched together. The bars are hand-drawn SVG in the
same ink/brass palette, which is maybe 80 lines instead of a dependency.

---

## Spatial surfaces

The panel is glass, not a slab. Four depth tiers, expressed as translucency +
backdrop blur + shadow scale rather than as size:

| Tier | Used by | Reads as |
|---|---|---|
| `--glass-1` | spine, header, footer, toolbar cells | recessed into the panel |
| `--glass-2` | panel body, Ask button | the base surface |
| `--glass-3` | launcher pill, tool hover | raised off the page |
| `--glass-4` | peek, flyout menus | frontmost, floating clear |

Rim light (`--rim-1..3`) brightens with depth, so a surface that sits forward
catches more edge light. Dragging the panel adds `.lifted`: brighter rim, a 1.2%
scale bump, and a much larger softer shadow — the panel comes toward you.

**Fallbacks are not optional here.** `backdrop-filter` is doing the work, so
there are two escape hatches: an `@supports not` block for browsers without it,
and `prefers-reduced-transparency` for people who have asked their OS for less
of exactly this. Both drop to opaque surfaces; the depth ordering still reads
through shadow and rim alone.

---

## Spatial navigation

The spine is not a readout — it's a map you can steer.

- **Click a lit segment** and the page scrolls to that exact passage in the live
  DOM and flashes it. The panel's answer and the document become the same space.
- **Hover a segment** to peek at the passage text without leaving the panel.
- **The shuttle** — the faint bracket sliding down the spine — is your real
  viewport position, so you can see where you are versus where the answer came from.
- **Drag the header** to move the panel; it lifts on higher shadow layers while
  moving, so depth is feedback rather than decoration.

Passage lookup works by searching the live DOM for the first ~28 characters of a
retrieved chunk. It's approximate — heavily re-rendered pages can miss — but it
needs no ID injection and survives the page mutating underneath it.

---

## The reading profile

Margin scores each article's **technicality locally** — a heuristic over sentence
length, long-word ratio, jargon density, numerals, math symbols and citation
markers, producing 0 (plain) to 1 (specialist). No model call, so it works on
both tiers, costs nothing, and is deterministic: the same article always scores
the same, so the profile drifts only when reading habits actually drift.

Calibration check: casual prose ≈ 0.12, popular-science ≈ 0.46, a methods
section ≈ 0.79.

**Suggest** blends the learned profile with the current page (60/40, once there
are 3+ articles of history) and tells the model to aim there deliberately —
explicitly instructed *not* to default to the most technical source available,
nor to oversimplify when the level is high. The gauge under each result shows
where you sit on plain↔specialist.

**What's stored:** title, URL, word count, technicality score, ~18 keywords, and
a **gist** (opening ~1400 chars + section headings) for the last 40 articles, in
`chrome.storage.local`. Never the full body.

The gist exists specifically to make "what does this cover that the other
doesn't" answerable — keywords alone couldn't support a coverage claim. But the
evidence is still asymmetric: full text on one side, a gist on the other. The
prompt states this explicitly and instructs the model that `onlyThis` is more
reliable than `onlyOther`, and that gaps in the second article's evidence mean
*uncertain*, not *absent*. A tool that quietly presented both directions as
equally confident would be lying by omission.

Toggle it off or clear it in Settings.

---

## Providers

| | Web search | Notes |
|---|---|---|
| **Anthropic** | yes | `console.anthropic.com` → Settings → API keys. Needs billing credit. |
| **Gemini** | yes | `aistudio.google.com` → Get API key. Free tier, no card. **Free-tier prompts and article text may be used by Google for training** — paid tier removes this. |
| **OpenAI** | not yet | `platform.openai.com` → API keys. Needs billing credit. |

---

## The two tiers

|  | Tier 1 — on-device | Tier 2 — your key |
|---|---|---|
| Model | Gemini Nano, via Chrome's Prompt API | Anthropic or OpenAI |
| Cost | free | your account |
| Network | none | provider only |
| Context | top passages, retrieved | whole article |
| Web search | no | yes (Anthropic) |

The panel says which one answered, and the **spine** — the vertical gauge on the
left edge — is a scale model of the article. On-device, it lights only the
passages the answer was built from. With a key, it lights the whole column,
because the whole article went in. The tier difference is visible, not just
stated in a badge.

---

## How it fits together

```
content.js        extraction + shadow-DOM panel      (no network, ever)
    │ port
background.js     tier routing                       (only place with the key)
    ├── retrieval.js   chunk + BM25 → on-device tier
    └── providers.js   SSE streaming → cloud tier
```

**Why a shadow root.** The panel lives in a closed shadow DOM, so no host page's
CSS can wreck the UI and none of Margin's styling can leak onto the page it's
sitting on.

**Why the key lives in the service worker.** Content scripts run in the page's
process and hit CORS walls. The worker holds the key, makes the request, and
streams deltas back over a `Port` — a fresh one per question, so a sleeping
worker can never strand a half-finished answer.

**Why lexical retrieval and not embeddings.** One article is a few hundred
chunks. BM25 costs nothing to run, needs no model download and no index to
persist, and the quality gap is small next to the complexity gap. That trade
flips only if Margin ever searches across pages.

**Why Readability.** `document.body.innerText` gives you nav menus, cookie
banners and comment sections. `isProbablyReaderable()` also doubles as the gate
for whether the pill appears at all.

---

## Known rough edges

- Chrome shipped both cumulative and delta chunks from `promptStreaming()`
  across versions; `runLocal` handles both, but it's worth deleting once you
  pin a minimum version.
- OpenAI has no web search wired up — the `search` setting is Anthropic-only.
- Nano's context is tight. If answers feel thin, lower `LOCAL_CONTEXT_TOKENS`
  and raise the chunk count instead — more, smaller passages usually beat fewer
  long ones.
- No conversation memory. Each question is independent. Adding history means
  budgeting it against Nano's window, which is the interesting part.

---

`vendor/` contains Mozilla Readability (Apache 2.0) — see `vendor/LICENSE.md`.
