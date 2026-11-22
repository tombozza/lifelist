/* COPY of sites/_shared/chassis/fuzzy.js — edit the source there and run node _shared/sync.mjs */
/* Forgiving search, the same in every app: uiFuzzy.

   Source: sites/_shared/chassis/fuzzy.js (copied into each app with the chassis by node _shared/sync.mjs).
   Food Planner's lib/fuzzy.js, made shared on 21 Nov 2026: the behaviour audit (briefs/same-job-audit.html)
   found eight other copies (Golf, Media, Finance, ADHD Field Guide, Listing Helper, Bozza HQ, Cottage
   Olympics, Dad HQ), each forgiving in a different way.

   "udom" finds udon, "korna" finds korma, "chiken thigh" finds chicken thigh. Every word typed must match
   some word in the text: the text word starts with it, contains it (3+ letters), or is within 1 typo of it
   (2 for words of 7+ letters). Plain substrings still win first, so exact searches behave as before.

   Load as a plain script, or import once for its side effect in a bundled app. Then:

     uiFuzzy.match('chiken', item.name, item.tags)         true / false
     uiFuzzy.find(items, query, (x) => [x.name, x.note])    the matches; only the as-typed ones when there are any
     uiFuzzy.plain('pas', 'Pasta bake')                     every word starts a word in the text
     uiFuzzy.distance('korna', 'korma')                     1 (Damerau–Levenshtein, stops early past max)

   Use it for every search box and for "already have this?" suggestions under an add box. */
(function (g) {
  'use strict';
  if (g.uiFuzzy) return;
  const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ');
  const words = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

  function distance(a, b, max) {
    if (max == null) max = 2;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i].concat(Array(b.length).fill(0)));
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      let rowMin = Infinity;
      for (let j = 1; j <= b.length; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        rowMin = Math.min(rowMin, d[i][j]);
      }
      if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
  }
  function wordMatches(q, w) {
    if (w.startsWith(q) || (q.length >= 3 && w.includes(q))) return true;
    if (q.length < 3) return false;
    const max = q.length >= 7 ? 2 : 1;
    return distance(q, w, max) <= max || (w.length > q.length && distance(q, w.slice(0, q.length), max) <= max);
  }
  const flat = (texts) => texts.flat(Infinity).filter((t) => t != null).join(' ');
  function match(query, ...texts) {
    const q = words(query);
    if (!q.length) return true;
    const hay = norm(flat(texts));
    if (hay.includes(norm(query).trim())) return true;
    const ws = words(hay);
    return q.every((qw) => ws.some((w) => wordMatches(qw, w)));
  }
  function plain(query, ...texts) {
    const q = words(query);
    if (!q.length) return true;
    const ws = words(flat(texts));
    return q.every((qw) => ws.some((w) => w.startsWith(qw)));
  }
  function find(items, query, textsOf) {
    textsOf = textsOf || ((x) => [typeof x === 'string' ? x : x && x.name]);
    const hits = items.filter((x) => match(query, textsOf(x)));
    const asTyped = hits.filter((x) => plain(query, textsOf(x)));
    return asTyped.length ? asTyped : hits;
  }
  g.uiFuzzy = { match, plain, find, distance, norm };
})(typeof window !== 'undefined' ? window : globalThis);
