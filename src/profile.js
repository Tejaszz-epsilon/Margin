/* The reading profile.

   Technicality is scored locally with a heuristic rather than by asking a model.
   Three reasons: it costs nothing, it works identically on both tiers, and it's
   deterministic — the same article always scores the same, so the profile drifts
   only when reading habits actually drift. */

const LIB_KEY = "library";
const LIB_MAX = 40;

const JARGON = new Set(
  ("algorithm coefficient parameter variance gradient tensor matrix vector regression latency throughput " +
   "compiler runtime kernel schema protocol topology heuristic asymptotic stochastic entropy quantum isotope " +
   "enzyme protein genome molecular thermodynamic voltage impedance amplitude wavelength derivative integral " +
   "theorem lemma polynomial spline eigenvalue covariance bayesian inference dataset benchmark").split(" ")
);

const COMMON = new Set(
  ("the a an and or but if then than that this these those is are was were be been being of to in on at by for " +
   "with from as it its he she they we you i do does did have has had not no so such about into over under out " +
   "up down what which who when where why how all any both each more most other some can will just should now " +
   "also there their them his her our your one two first new like get make said says year years time people " +
   "would could may many much very well back much good way even").split(" ")
);

/** 0 = plain language, 1 = dense technical prose. */
export function technicality(text) {
  const sample = text.slice(0, 40000);
  const words = sample.toLowerCase().match(/[a-z][a-z'-]*/g) || [];
  if (words.length < 50) return 0.5;

  const sentences = sample.split(/[.!?]+\s/).filter((s) => s.trim().length > 20);
  const avgSentLen = sentences.length ? words.length / sentences.length : 20;

  const longWords = words.filter((w) => w.length >= 9).length / words.length;
  const jargonHits = words.filter((w) => JARGON.has(w)).length / words.length;
  const digits = (sample.match(/\d/g) || []).length / sample.length;
  const symbols = (sample.match(/[=<>+×÷^%∑∫≈≤≥μσλ]/g) || []).length / sample.length;
  const citations = (sample.match(/\[\d+\]|et al\.|\(\d{4}\)/g) || []).length / Math.max(1, sentences.length);

  // Each term is squashed into 0..1 before weighting so one spiky signal
  // (a page full of dates, say) can't dominate the score.
  const n = (v, cap) => Math.min(1, v / cap);
  const score =
    0.22 * n(avgSentLen, 34) +
    0.24 * n(longWords, 0.20) +
    0.24 * n(jargonHits, 0.012) +
    0.10 * n(digits, 0.030) +
    0.10 * n(symbols, 0.0016) +
    0.10 * n(citations, 0.55);

  return Math.max(0, Math.min(1, score));
}

/** Distinctive content words, most frequent first. */
export function topTerms(text, k = 18) {
  const words = (text.slice(0, 40000).toLowerCase().match(/[a-z][a-z'-]{3,}/g) || [])
    .filter((w) => !COMMON.has(w));
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([w]) => w);
}

/** A compact stand-in for the article: opening framing plus section headings.
    Enough for coverage comparison without storing the whole body. */
export function gistOf(text, headings = []) {
  const opening = text.slice(0, 1400).replace(/\s+/g, " ").trim();
  return { opening, headings: headings.slice(0, 24) };
}

/* ---------------- library ---------------- */

export async function getLibrary() {
  const got = await chrome.storage.local.get(LIB_KEY);
  return Array.isArray(got[LIB_KEY]) ? got[LIB_KEY] : [];
}

/** Records an article. Stores only metadata and terms — never the body text. */
export async function remember({ url, title, text, words, headings }) {
  const lib = await getLibrary();
  const existing = lib.findIndex((e) => e.url === url);
  const entry = {
    url,
    title,
    words,
    tech: Number(technicality(text).toFixed(3)),
    terms: topTerms(text),
    gist: gistOf(text, headings || []),
    seenAt: Date.now(),
  };
  if (existing !== -1) lib[existing] = entry;
  else lib.unshift(entry);

  lib.sort((a, b) => b.seenAt - a.seenAt);
  await chrome.storage.local.set({ [LIB_KEY]: lib.slice(0, LIB_MAX) });
  return entry;
}

export async function clearLibrary() {
  await chrome.storage.local.set({ [LIB_KEY]: [] });
}

/** Weighted toward recent reading, so the profile tracks current interests. */
export async function readingProfile() {
  const lib = await getLibrary();
  if (!lib.length) return { tech: 0.5, terms: [], count: 0 };

  let wsum = 0, tsum = 0;
  const termScore = new Map();
  lib.forEach((e, i) => {
    const w = 1 / (1 + i * 0.12); // recency decay
    wsum += w;
    tsum += e.tech * w;
    (e.terms || []).forEach((t, ti) => {
      termScore.set(t, (termScore.get(t) || 0) + w * (1 - ti / 40));
    });
  });

  const terms = [...termScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([t]) => t);

  return { tech: tsum / wsum, terms, count: lib.length };
}

export function describeDepth(tech) {
  if (tech < 0.30) return "plain-language";
  if (tech < 0.48) return "general-audience";
  if (tech < 0.66) return "informed-but-not-specialist";
  if (tech < 0.82) return "technical";
  return "specialist / research-level";
}
