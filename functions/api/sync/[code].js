import { json } from '../_lib.js';

// GET /api/sync/:code  -> { data: <parsed JSON blob> | null }
// The client stores its whole app state as one blob per sync_code (the main code
// and a sibling "<code>-inbox" row for external capture), so this is a plain KV store.
export async function onRequestGet({ params, env }) {
  const row = await env.DB.prepare('SELECT data FROM kanban_sync WHERE sync_code = ?')
    .bind(params.code).first();
  if (!row) return json({ data: null });
  let data;
  try { data = JSON.parse(row.data); } catch { data = null; }
  return json({ data });
}

// PUT /api/sync/:code  body: <JSON blob> -> upsert the blob for this code.
// D1 refuses a value over 2,000,000 bytes. Say so plainly (413, too_big) rather
// than a bare 500, so the app can tell Tom it's full instead of "Sync failed".
const CAP_BYTES = 2000000;

export async function onRequestPut({ params, request, env }) {
  const body = await request.json();
  const data = JSON.stringify(body);
  const bytes = new TextEncoder().encode(data).length;
  if (bytes > CAP_BYTES) return json({ error: 'too_big', bytes, cap: CAP_BYTES }, 413);
  const updated_at = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO kanban_sync (sync_code, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(sync_code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    ).bind(params.code, data, updated_at).run();
  } catch (e) {
    if (/too big|TOOBIG/i.test(String(e && e.message))) return json({ error: 'too_big', bytes, cap: CAP_BYTES }, 413);
    throw e;
  }
  return json({ ok: true, updated_at });
}
