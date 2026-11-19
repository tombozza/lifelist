/* COPY of sites/_shared/safety/bin-d1.js — edit the source there and run node _shared/sync.mjs */
// Recently deleted for a D1 app (Workers and Pages Functions). Copy of the idea in bin.js, server side.
//
//   import { binAdd, binList, binRestore, binForget } from '../vendor/safety/bin-d1.js';
//   // when deleting: read the rows first, delete them, then keep them
//   await binAdd(env.DB, 'gt_bin', { kind: 'round', label: 'Prestbury, 12 Oct', rows: { rounds: [r], round_holes: holes } });
//   GET  /api/bin             -> binList(env.DB, 'gt_bin')
//   POST /api/bin/:id/restore -> binRestore(env.DB, 'gt_bin', id)   (INSERT OR IGNORE: never overwrites)
//   DELETE /api/bin/:id       -> binForget(env.DB, 'gt_bin', id)
//
// The table is the app's own (prefix it if the database is shared, like storage-log's). It's created on
// first use. Entries older than 30 days are cleared whenever one is added or listed. Restore puts the rows
// back with their own ids, parents first (the order the app gave them), and skips any row whose id is back
// already, so it's safe to tap twice.

import { BIN_DAYS, binId } from './bin.js';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const check = (name) => { if (!IDENT.test(name)) throw new Error(`Not a table or column name: ${name}`); return name; };

async function ensure(db, table) {
  check(table);
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT, data TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`).run();
}

async function prune(db, table) {
  await db.prepare(`DELETE FROM ${table} WHERE deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`).bind(`-${BIN_DAYS} days`).run();
}

/**
 * Keep deleted rows. rows = { tableName: [rowObject, …], … } in the order they should come back
 * (parents first). Returns the entry id.
 */
export async function binAdd(db, table, { kind, label, rows }) {
  await ensure(db, table);
  const id = binId();
  for (const t of Object.keys(rows ?? {})) check(t);
  await db.prepare(`INSERT INTO ${table} (id, kind, label, data) VALUES (?, ?, ?, ?)`)
    .bind(id, String(kind), String(label ?? '').slice(0, 200), JSON.stringify({ rows })).run();
  await prune(db, table);
  return id;
}

/** The entries, newest first, without their data (small). */
export async function binList(db, table) {
  await ensure(db, table);
  await prune(db, table);
  const res = await db.prepare(`SELECT id, kind, label, deleted_at FROM ${table} ORDER BY deleted_at DESC LIMIT 500`).all();
  return res.results ?? [];
}

/** Put an entry's rows back (INSERT OR IGNORE) and drop it from the bin. { ok, restored } or { error }. */
export async function binRestore(db, table, id) {
  await ensure(db, table);
  const e = await db.prepare(`SELECT data FROM ${table} WHERE id = ?`).bind(String(id)).first();
  if (!e) return { error: 'That has gone from Recently deleted.' };
  let rows;
  try { rows = JSON.parse(e.data).rows ?? {}; } catch { return { error: "That entry can't be read." }; }
  const stmts = [];
  let restored = 0;
  for (const [t, list] of Object.entries(rows)) {
    check(t);
    for (const row of list ?? []) {
      const cols = Object.keys(row).map(check);
      if (!cols.length) continue;
      stmts.push(db.prepare(`INSERT OR IGNORE INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .bind(...cols.map((c) => row[c])));
      restored++;
    }
  }
  stmts.push(db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(String(id)));
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return { ok: true, restored };
}

/** Delete an entry for good (Tom chose to). */
export async function binForget(db, table, id) {
  await ensure(db, table);
  await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(String(id)).run();
  return { ok: true };
}

/**
 * Read rows before deleting them, as plain objects for binAdd. where/binds pick them, e.g.
 * await rowsOf(db, 'round_holes', 'round_id = ?', [id]).
 */
export async function rowsOf(db, table, where, binds = []) {
  check(table);
  const res = await db.prepare(`SELECT * FROM ${table} WHERE ${where}`).bind(...binds).all();
  return res.results ?? [];
}
