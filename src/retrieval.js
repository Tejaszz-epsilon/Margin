/* Lexical retrieval. Deliberately not embeddings: no model to load, no index to
   persist, and on a single article of a few hundred chunks the quality gap is
   small next to the complexity gap. Revisit only if Margin ever spans pages. */

const STOP = new Set(
  ("the a an and or but if then than that this these those is are was were be been being of to in on at by for with from as it its it's he she they we you i " +
   "do does did have has had not no so such about into over under out up down what which who whom when where why how all any both each more most other some " +
   "can will just should now").split(" ")
);

function tokenize(s) {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || []).filter(
    (t) => t.length > 2 && !STOP.has(t)
  );
}

/** Split into ~targetChars chunks, never mid-paragraph unless a paragraph is huge. */
export function chunk(text, targetChars = 1100) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let buf = "";

  const flush = () => { if (buf.trim()) { out.push(buf.trim()); buf = ""; } };

  for (const p of paras) {
    if (p.length > targetChars * 1.8) {
      flush();
      const sents = p.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [p];
      let s = "";
      for (const sent of sents) {
        if ((s + sent).length > targetChars) { if (s) out.push(s.trim()); s = sent; }
        else s += sent;
      }
      if (s.trim()) out.push(s.trim());
      continue;
    }
    if ((buf + "\n\n" + p).length > targetChars) flush();
    buf = buf ? buf + "\n\n" + p : p;
  }
  flush();
  return out;
}

/** Returns [{ index, text, score }] sorted by relevance, best first. */
export function rank(chunks, query, k = 4) {
  const q = [...new Set(tokenize(query))];
  if (!q.length) return chunks.slice(0, k).map((text, index) => ({ index, text, score: 0 }));

  const docs = chunks.map(tokenize);
  const N = docs.length;

  const df = new Map();
  for (const d of docs) {
    for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  }

  const avgLen = docs.reduce((a, d) => a + d.length, 0) / N || 1;
  const k1 = 1.4, b = 0.72;

  const scored = docs.map((d, index) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);

    let score = 0;
    for (const term of q) {
      const f = tf.get(term);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgLen)));
    }
    return { index, text: chunks[index], score };
  });

  scored.sort((x, y) => y.score - x.score);
  const top = scored.slice(0, k).filter((s, i) => s.score > 0 || i === 0);
  // Read in document order — the model should see the article's own sequence.
  return top.sort((x, y) => x.index - y.index);
}

/** Rough token estimate; good enough for budgeting against a small context window. */
export const estTokens = (s) => Math.ceil(s.length / 3.8);
