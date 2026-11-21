import { json } from '../_lib.js';

// GET /api/sync/:code  -> { data: <parsed JSON blob> | null, version: <updated_at> | null }
// The client stores its whole app state as one blob per sync_code (the main code
// and a sibling "<code>-inbox" row for external capture), so this is a plain KV store.
export async function onRequestGet({ params, env }) {
  const row = await env.DB.prepare('SELECT data, updated_at FROM kanban_sync WHERE sync_code = ?')
    .bind(params.code).first();
  if (!row) return json({ data: null, version: null });
  let data;
  try { data = JSON.parse(row.data); } catch { data = null; }
  return json({ data, version: row.updated_at });
}

// PUT /api/sync/:code  body: <JSON blob> -> save the blob for this code.
// D1 refuses a value over 2,000,000 bytes. Say so plainly (413, too_big) rather
// than a bare 500, so the app can tell Tom it's full instead of "Sync failed".
//
// No blind overwrites (20 Nov 2026). A save used to replace the whole blob, so a
// device that hadn't caught up wiped whatever another device had just saved (new
// tasks, ticks). The app now sends the version it last read in `x-base-version`
// ("none" when there was no row). If the row has moved on since, the save is
// refused with 409 and the app pulls, merges and saves again. A request without
// the header is refused (an older cached app), except for the inbox row.
const CAP_BYTES = 2000000;

export async function onRequestPut({ params, request, env }) {
  const body = await request.json();
  const data = JSON.stringify(body);
  const bytes = new TextEncoder().encode(data).length;
  if (bytes > CAP_BYTES) return json({ error: 'too_big', bytes, cap: CAP_BYTES }, 413);
  const base = request.headers.get('x-base-version');
  // An app from before the version check (a tab or phone still running old
  // cached code) may not save the board at all: it saved stale copies over
  // newer work twice (20 and 21 Nov 2026). It reloads to the new app on its own;
  // until then its saves are refused and its pulls still work. The inbox row
  // (written by Shortcuts) is exempt.
  if (base === null && !params.code.endsWith('-inbox')) return json({ error: 'conflict', reason: 'old_app' }, 409);
  const updated_at = new Date().toISOString();
  try {
    if (base === null) {
      await env.DB.prepare(
        `INSERT INTO kanban_sync (sync_code, data, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(sync_code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
      ).bind(params.code, data, updated_at).run();
    } else {
      const res = base === 'none'
        ? await env.DB.prepare(
            `INSERT INTO kanban_sync (sync_code, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(sync_code) DO NOTHING`
          ).bind(params.code, data, updated_at).run()
        : await env.DB.prepare(
            `UPDATE kanban_sync SET data = ?, updated_at = ? WHERE sync_code = ? AND updated_at = ?`
          ).bind(data, updated_at, params.code, base).run();
      if (!res.meta || !res.meta.changes) {
        const row = await env.DB.prepare('SELECT updated_at FROM kanban_sync WHERE sync_code = ?').bind(params.code).first();
        return json({ error: 'conflict', version: row ? row.updated_at : null }, 409);
      }
    }
  } catch (e) {
    if (/too big|TOOBIG/i.test(String(e && e.message))) return json({ error: 'too_big', bytes, cap: CAP_BYTES }, 413);
    throw e;
  }
  return json({ ok: true, updated_at, version: updated_at });
}
