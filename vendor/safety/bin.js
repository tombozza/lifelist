/* COPY of sites/_shared/safety/bin.js — edit the source there and run node _shared/sync.mjs */
// The safety net's pure part (Round 2 of the 18 Nov 2026 app review): no DOM, no fetch, no database.
// Runs in the browser, a Worker or Node, and is tested by _shared/safety/test/bin.test.mjs.
//
// Two ideas, the same in every app:
// 1. Recently deleted. Deleting something keeps a copy for BIN_DAYS (30) days: one entry per thing deleted,
//    { id, kind, label, deleted_at, data }. `data` is whatever the app needs to put it back (for a D1 app,
//    the rows it deleted: { table: [row, …] }, see bin-d1.js). Restore puts it back and drops the entry.
// 2. Restore from backup only ever ADDS what's missing. It never overwrites or deletes anything, so loading
//    an old backup by mistake can't undo newer work. restoreMissing() works out what would be added.

export const BIN_DAYS = 30;

const DAY = 86400000;
const isoNow = (now) => new Date(now ?? Date.now()).toISOString();

/** A short random id for a bin entry (not a secret). */
export function binId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** One bin entry. label = what Tom sees ("Heat (1995)", "Tesco £12.40"); kind = "film", "payment"… */
export function binEntry(kind, label, data, { now, id } = {}) {
  return { id: id ?? binId(), kind: String(kind), label: String(label ?? '').slice(0, 200), deleted_at: isoNow(now), data };
}

/** Entries still inside the window, newest first. */
export function pruneBin(entries, { now = Date.now(), days = BIN_DAYS } = {}) {
  const cutoff = now - days * DAY;
  return (entries ?? [])
    .filter(e => e && Date.parse(e.deleted_at) >= cutoff)
    .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
}

/** "today", "yesterday", "3 days ago"; and how long until it's gone for good. */
export function binAge(entry, { now = Date.now(), days = BIN_DAYS } = {}) {
  const t = Date.parse(entry.deleted_at);
  const ago = Math.max(0, Math.floor((now - t) / DAY));
  const left = Math.max(0, days - ago);
  return {
    ago: ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`,
    left: left <= 1 ? 'goes for good tomorrow' : `kept ${left} more days`,
  };
}

/**
 * What restoring a backup would add. Never overwrites: anything whose key is already there is left alone,
 * even if the backup's copy differs.
 * @param {object[]} current  what the app has now
 * @param {object[]} backup   what the backup file has
 * @param {(item:object)=>string} key  the identity of an item (usually its id)
 * @returns {{ add: object[], already: number }}
 */
export function restoreMissing(current, backup, key) {
  const have = new Set((current ?? []).map(key).map(String));
  const add = [];
  let already = 0;
  const seen = new Set();
  for (const item of backup ?? []) {
    const k = String(key(item));
    if (have.has(k)) { already++; continue; }
    if (seen.has(k)) continue;           // a backup listing the same thing twice adds it once
    seen.add(k);
    add.push(item);
  }
  return { add, already };
}

/**
 * Several collections at once: { places: [...], events: [...] } against the same shape now.
 * keys: { places: p => p.id, … }. Collections without a key are ignored (never restored blind).
 */
export function restoreMissingAll(current, backup, keys) {
  const out = {};
  for (const [name, key] of Object.entries(keys)) {
    out[name] = restoreMissing(current?.[name] ?? [], backup?.[name] ?? [], key);
  }
  return out;
}

/** "3 places and 1 event" from a restoreMissingAll() result or plain counts. */
export function countWords(counts, names = {}) {
  const parts = [];
  for (const [k, v] of Object.entries(counts)) {
    const n = typeof v === 'number' ? v : v.add.length;
    if (!n) continue;
    const [one, many] = names[k] ?? [k.replace(/s$/, ''), k];
    parts.push(`${n} ${n === 1 ? one : many}`);
  }
  if (!parts.length) return 'nothing';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
