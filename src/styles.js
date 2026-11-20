/* Injected into a shadow root, so the host page can never reach these rules
   and these rules can never reach the host page. */
var RP_STYLES = `
:host {
  --ink-900: #0F1216;
  --ink-800: #171B21;
  --ink-700: #212630;
  --line:    #2C323D;
  --paper:   #E6E4DF;
  --muted:   #878F9B;
  --brass:   #C79A3E;   /* on-device tier */
  --slate:   #6E9DC4;   /* cloud tier */

  /* spatial surfaces: translucent glass layered by depth */
  --glass-1: rgba(247, 245, 240, 0.055);   /* recessed  */
  --glass-2: rgba(247, 245, 240, 0.085);   /* base      */
  --glass-3: rgba(247, 245, 240, 0.130);   /* raised    */
  --glass-4: rgba(247, 245, 240, 0.180);   /* frontmost */
  --rim-1: rgba(255, 255, 255, 0.10);
  --rim-2: rgba(255, 255, 255, 0.16);
  --rim-3: rgba(255, 255, 255, 0.22);
  --tint: rgba(15, 18, 22, 0.72);

  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --mono: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;

  all: initial;
  font-family: var(--serif);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

/* ---------- launcher ---------- */

.launcher {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 17px 10px 14px;
  background: linear-gradient(var(--tint), var(--tint)), var(--glass-3);
  -webkit-backdrop-filter: blur(26px) saturate(150%);
  backdrop-filter: blur(26px) saturate(150%);
  color: var(--paper);
  border: 1px solid var(--rim-2);
  border-radius: 22px;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.12) inset,
    0 8px 30px rgba(0, 0, 0, 0.38);
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 140ms ease, border-color 140ms ease;
}
.launcher:hover { transform: translateY(-2px); border-color: var(--brass); }
.launcher:focus-visible { outline: 2px solid var(--brass); outline-offset: 3px; }
.launcher .rule { width: 16px; height: 1px; background: var(--brass); }
.launcher .count { color: var(--muted); }

/* ---------- panel ---------- */

.panel {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 2147483647;
  width: 388px;
  max-width: calc(100vw - 32px);
  height: 560px;
  max-height: calc(100vh - 44px);
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: linear-gradient(var(--tint), var(--tint)), var(--glass-2);
  -webkit-backdrop-filter: blur(30px) saturate(150%);
  backdrop-filter: blur(30px) saturate(150%);
  border: 1px solid var(--rim-2);
  border-radius: 22px;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.10) inset,
    0 2px 8px rgba(0,0,0,0.26),
    0 14px 30px rgba(0,0,0,0.34),
    0 40px 80px rgba(0,0,0,0.44);
  overflow: visible;
  transition: box-shadow 220ms ease, transform 220ms ease;
}
/* dragging pulls the panel forward: bigger, softer shadow and a brighter rim */
.panel.lifted {
  border-color: var(--rim-3);
  transform: scale(1.012);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.14) inset,
    0 8px 18px rgba(0,0,0,0.32),
    0 34px 64px rgba(0,0,0,0.44),
    0 80px 140px rgba(0,0,0,0.52);
}
.panel > .body { overflow: hidden; }
.thread { border-radius: 0; }

.head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  cursor: grab;
  user-select: none;
  padding: 14px 16px 13px;
  border-bottom: 1px solid var(--rim-1);
  border-radius: 22px 22px 0 0;
  background: var(--glass-1);
}
.head.dragging { cursor: grabbing; }
.head .doc {
  flex: 1;
  min-width: 0;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.head .x {
  font-family: var(--mono);
  font-size: 15px;
  line-height: 1;
  color: var(--muted);
  background: none;
  border: 0;
  cursor: pointer;
  padding: 2px 4px;
}
.head .x:hover { color: var(--paper); }

.badge {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  padding: 3px 6px;
  border: 1px solid currentColor;
  border-radius: 1px;
  white-space: nowrap;
}
.badge.local { color: var(--brass); }
.badge.cloud { color: var(--slate); }

/* ---------- toolbar ---------- */

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 7px 9px;
  background: transparent;
  border-bottom: 1px solid var(--rim-1);
}
.tool {
  flex: 1;
  min-width: 0;
  padding: 7px 4px;
  background: var(--glass-1);
  border-radius: 13px;
  color: var(--muted);
  border: 1px solid transparent;
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  white-space: nowrap;
}
.tool:hover:not(:disabled) { color: var(--paper); background: var(--glass-3); border-color: var(--rim-1); }
.tool.active { color: var(--ink-900); background: var(--brass); border-color: transparent; }
.tool:disabled { color: #4A5058; cursor: default; }
.tool.locked { position: relative; }

.toolflyout {
  position: absolute;
  z-index: 5;
  background: linear-gradient(var(--tint), var(--tint)), var(--glass-4);
  -webkit-backdrop-filter: blur(40px) saturate(160%);
  backdrop-filter: blur(40px) saturate(160%);
  border: 1px solid var(--rim-3);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 12px 34px rgba(0,0,0,0.44), 0 40px 80px rgba(0,0,0,0.4);
  min-width: 160px;
}
.toolflyout button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 9px 11px;
  background: none;
  border: 0;
  border-bottom: 1px solid var(--line);
  color: var(--paper);
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.05em;
  cursor: pointer;
}
.toolflyout button:last-child { border-bottom: 0; }
.toolflyout button:hover { background: var(--ink-700); color: var(--brass); }
.toolflyout .note {
  padding: 9px 11px;
  font-family: var(--serif);
  font-size: 12.5px;
  font-style: italic;
  color: var(--muted);
  line-height: 1.4;
}

/* ---------- find bar ---------- */

.findbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 12px;
  background: var(--glass-1);
  border-bottom: 1px solid var(--rim-1);
}
.findbar input {
  flex: 1;
  min-width: 0;
  padding: 7px 11px;
  background: var(--glass-1);
  color: var(--paper);
  border: 1px solid var(--rim-1);
  border-radius: 14px;
  font-family: var(--serif);
  font-size: 13.5px;
}
.findbar input:focus { outline: none; border-color: var(--brass); }
.findbar .count {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
  min-width: 40px;
  text-align: center;
}
.findbar button {
  background: none;
  border: 1px solid var(--line);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
  padding: 5px 8px;
  cursor: pointer;
}
.findbar button:hover { color: var(--brass); border-color: var(--brass); }

/* highlight marks injected into the host page */
mark[data-margin-hl] {
  background: rgba(199, 154, 62, 0.38);
  color: inherit;
  border-radius: 1px;
}
mark[data-margin-hl].current {
  background: var(--brass);
  color: var(--ink-900);
}

/* ---------- sources list ---------- */

.sources {
  list-style: none;
  margin-top: 4px;
}
.sources li { margin-bottom: 9px; }
.sources a {
  color: var(--slate);
  font-size: 13.5px;
  text-decoration: none;
  border-bottom: 1px solid var(--line);
  word-break: break-word;
}
.sources a:hover { border-color: var(--slate); }
.sources .host {
  display: block;
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--muted);
  letter-spacing: 0.04em;
  margin-top: 2px;
}

/* ---------- chart ---------- */

.chartwrap { margin-top: 4px; }
.chartwrap svg { width: 100%; height: auto; display: block; }
.chartwrap .savepng {
  margin-top: 6px;
  background: none;
  border: 1px solid var(--line);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  padding: 5px 9px;
  cursor: pointer;
}
.chartwrap .savepng:hover { color: var(--brass); border-color: var(--brass); }

/* ---------- compare / suggest cards ---------- */

.card { margin-top: 4px; }
.card .grouphead {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--brass);
  margin: 12px 0 6px;
}
.card .grouphead.alt { color: var(--slate); }
.card ul { list-style: none; }
.card li {
  font-size: 14px;
  line-height: 1.5;
  color: var(--paper);
  padding-left: 12px;
  border-left: 1px solid var(--line);
  margin-bottom: 7px;
}
.card li .side {
  display: block;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 2px;
}
.card .foot-note {
  margin-top: 10px;
  font-size: 12.5px;
  font-style: italic;
  color: var(--muted);
  line-height: 1.45;
}

.pick {
  display: block;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
  text-decoration: none;
}
.pick:last-of-type { border-bottom: 0; }
.pick .t { font-size: 14.5px; color: var(--paper); line-height: 1.35; }
.pick:hover .t { color: var(--brass); }
.pick .w { font-size: 13px; color: var(--muted); line-height: 1.45; margin-top: 3px; }
.pick .d {
  display: inline-block;
  margin-top: 5px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--slate);
  border: 1px solid var(--line);
  padding: 2px 5px;
}

/* the depth gauge — where this reader sits on plain↔specialist */
.gauge { margin: 8px 0 2px; }
.gauge .rail {
  position: relative;
  height: 3px;
  background: var(--line);
}
.gauge .dot {
  position: absolute;
  top: -3px;
  width: 3px;
  height: 9px;
  background: var(--brass);
}
.gauge .ends {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

/* library picker */
.picker { max-height: 190px; overflow-y: auto; margin-top: 4px; }
.picker button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  margin-bottom: 5px;
  background: var(--glass-1);
  border: 1px solid var(--rim-1);
  border-radius: 14px;
  color: var(--paper);
  font-family: var(--serif);
  font-size: 13.5px;
  line-height: 1.35;
  cursor: pointer;
}
.picker button:hover { border-color: var(--brass); color: var(--brass); }
.picker button .meta2 {
  display: block;
  font-family: var(--mono);
  font-size: 9px;
  color: var(--muted);
  letter-spacing: 0.05em;
  margin-top: 3px;
}

/* ---------- body: spine + thread ---------- */

.body {
  display: grid;
  grid-template-columns: 34px 1fr;
  min-height: 0;
}

/* the signature element: a scale model of the article.
   lit segments = the passages the answer was actually built from. */
.spine {
  position: relative;
  border-right: 1px solid var(--rim-1);
  background: var(--glass-1);
  box-shadow: 1px 0 0 rgba(255,255,255,0.04) inset;
}
.spine .track {
  position: absolute;
  left: 12px;
  top: 14px;
  bottom: 14px;
  width: 1px;
  background: var(--line);
}
.spine .seg {
  position: absolute;
  left: 9px;
  width: 7px;
  min-height: 3px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: var(--brass);
  opacity: 0;
  cursor: pointer;
  transition: opacity 320ms ease, transform 140ms ease, box-shadow 140ms ease;
}
.spine.cloud .seg { background: var(--slate); }
.spine .seg.on { opacity: 0.85; }
.spine .seg:hover {
  opacity: 1;
  transform: scaleX(1.5);
  box-shadow: 0 0 18px 1px rgba(199,154,62,0.75);
}
.spine .seg:focus-visible { outline: 1px solid var(--paper); outline-offset: 2px; }
.spine .seg.reading {
  opacity: 1;
  transform: scaleX(1.8);
}

/* viewport shuttle: where you actually are in the document */
.spine .shuttle {
  position: absolute;
  left: 5px;
  width: 15px;
  border: 1px solid rgba(230,228,223,0.28);
  border-left: 0;
  border-right: 0;
  background: rgba(230,228,223,0.05);
  pointer-events: none;
  transition: top 120ms linear, height 120ms linear;
}

/* peek: passage text on hover, hovering above the panel surface */
.peek {
  position: absolute;
  left: 42px;
  z-index: 8;
  max-width: 250px;
  padding: 13px 15px;
  background: linear-gradient(var(--tint), var(--tint)), var(--glass-4);
  -webkit-backdrop-filter: blur(44px) saturate(160%);
  backdrop-filter: blur(44px) saturate(160%);
  border: 1px solid var(--rim-3);
  border-left: 2px solid var(--brass);
  border-radius: 16px;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.14) inset,
    0 10px 24px rgba(0,0,0,0.34),
    0 40px 80px rgba(0,0,0,0.5);
  font-size: 12.5px;
  line-height: 1.45;
  color: #C9CFD8;
  pointer-events: none;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 130ms ease, transform 130ms ease;
}
.peek.on { opacity: 1; transform: translateX(0); }

/* in-page passage flash when a spine segment is clicked */
mark[data-margin-passage] {
  background: rgba(199,154,62,0.30);
  box-shadow: 0 0 0 6px rgba(199,154,62,0.30);
  border-radius: 1px;
  transition: background 900ms ease, box-shadow 900ms ease;
}
mark[data-margin-passage].fade {
  background: transparent;
  box-shadow: 0 0 0 0 rgba(199,154,62,0);
}

.thread {
  overflow-y: auto;
  padding: 16px 15px 18px;
  scrollbar-width: thin;
  scrollbar-color: var(--line) transparent;
}
.thread::-webkit-scrollbar { width: 8px; }
.thread::-webkit-scrollbar-thumb { background: var(--line); }

.turn { margin-bottom: 18px; }
.turn .who {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 6px;
}
.turn .text {
  font-size: 15px;
  line-height: 1.58;
  color: var(--paper);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.turn.you .text { color: #B9C0CA; font-style: italic; }
.turn .cite {
  margin-top: 8px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.turn .cite a { color: var(--slate); text-decoration: none; border-bottom: 1px solid var(--line); }

.empty {
  font-size: 14px;
  line-height: 1.6;
  color: var(--muted);
  font-style: italic;
}
.empty b { color: var(--paper); font-style: normal; font-weight: 400; }

.caret {
  display: inline-block;
  width: 7px;
  height: 15px;
  vertical-align: -2px;
  background: var(--brass);
  animation: blink 1.05s steps(2, start) infinite;
}
@keyframes blink { to { visibility: hidden; } }

/* ---------- composer ---------- */

.foot {
  border-top: 1px solid var(--rim-1);
  background: var(--glass-1);
  border-radius: 0 0 22px 22px;
  padding: 11px 13px 12px;
}
.row { display: flex; align-items: flex-end; gap: 8px; }
.ask {
  flex: 1;
  resize: none;
  max-height: 96px;
  padding: 9px 12px;
  background: var(--glass-1);
  color: var(--paper);
  border: 1px solid var(--rim-1);
  border-radius: 16px;
  font-family: var(--serif);
  font-size: 14px;
  line-height: 1.45;
}
.ask:focus { outline: none; border-color: var(--brass); }
.ask::placeholder { color: var(--muted); font-style: italic; }

.send {
  padding: 9px 14px;
  background: var(--glass-2);
  color: var(--paper);
  border: 1px solid var(--rim-1);
  border-radius: 16px;
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}
.send:hover:not(:disabled) { border-color: var(--brass); color: var(--brass); }
.send:disabled { opacity: 0.4; cursor: default; }

.meta {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.07em;
  color: var(--muted);
}
.meta button {
  background: none;
  border: 0;
  padding: 0;
  color: var(--muted);
  font: inherit;
  letter-spacing: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.meta button:hover { color: var(--paper); }

.notice {
  margin-top: 8px;
  padding: 10px 12px;
  border-left: 2px solid var(--brass);
  border-radius: 12px;
  background: var(--glass-2);
  font-size: 13px;
  line-height: 1.5;
  color: #C3C9D2;
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}

/* Glass depends on backdrop-filter. Where it is unsupported or the person has
   asked for less transparency, fall back to opaque surfaces — the layout and
   the depth ordering still read, they just stop being see-through. */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .panel, .peek, .toolflyout, .launcher { background: var(--ink-900); }
  .head, .foot, .spine, .toolbar { background: var(--ink-800); }
}
@media (prefers-reduced-transparency: reduce) {
  .panel, .peek, .toolflyout, .launcher {
    background: var(--ink-900);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .head, .foot, .spine { background: var(--ink-800); }
}
`;
