// Forgiving search: "udom" finds udon, "korna" finds korma, "chiken thigh" finds chicken thigh.
//
// Every word typed must match some word in the text, where a match is: the text word starts
// with it, contains it, or is within a small number of typos of it (1 for short words, 2 for
// words of 7+ letters). Plain substrings still win first, so exact searches behave as before.

const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ');
const words = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

/** Damerau–Levenshtein distance, stopping early once it exceeds `max`. */
function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
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
  // compare against the word, and against its start (typing "chik" for chicken)
  return distance(q, w, max) <= max || (w.length > q.length && distance(q, w.slice(0, q.length), max) <= max);
}

/** Does the query match this text (or any of several texts)? */
function fuzzyMatch(query, ...texts) {
  const q = words(query);
  if (!q.length) return true;
  const hay = norm(texts.flat().join(' '));
  if (hay.includes(norm(query).trim())) return true;
  const ws = words(hay);
  return q.every(qw => ws.some(w => wordMatches(qw, w)));
}
