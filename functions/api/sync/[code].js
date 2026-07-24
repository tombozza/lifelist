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
export async function onRequestPut({ params, request, env }) {
  const body = await request.json();
  const updated_at = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO kanban_sync (sync_code, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(sync_code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).bind(params.code, JSON.stringify(body), updated_at).run();
  return json({ ok: true, updated_at });
}
