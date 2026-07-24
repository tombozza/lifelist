// One-off: export the kanban_sync rows from Supabase to scripts/seed-data.json.
// The blobs are ~200KB, which exceeds SQLite's single-statement limit, so they
// are NOT emitted as a SQL migration — seed-d1.mjs loads them through the
// parameterized /api/sync PUT (which binds the value and sidesteps the limit).
// Usage: node scripts/export-supabase.mjs
//
// life-kanban stores its whole app state as a single JSON blob per sync_code
// (the main row + a sibling "<code>-inbox" row), so this is a 1-2 row export.
// Reads creds straight from app.js (they were the browser anon key) via env or
// the constants below.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Pull the anon URL/key out of app.js so we never hardcode a second copy.
const appjs = readFileSync(join(root, 'app.js'), 'utf8');
const grab = (re) => (appjs.match(re) || [])[1];
const SUPABASE_URL = process.env.SUPABASE_URL || grab(/SUPABASE_URL\s*=\s*'([^']+)'/);
const SUPABASE_KEY = process.env.SUPABASE_KEY || grab(/SUPABASE_KEY\s*=\s*'([^']+)'/);
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Could not find Supabase URL/key.');

async function fetchRows() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kanban_sync?select=sync_code,data,updated_at`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

const rows = (await fetchRows()).map((r) => ({
  sync_code: r.sync_code,
  data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
  updated_at: r.updated_at || new Date().toISOString(),
}));

writeFileSync(join(root, 'scripts/seed-data.json'), JSON.stringify(rows, null, 2));
const summary = rows.map((r) => {
  const d = r.data;
  const tasks = Array.isArray(d?.tasks) ? `${d.tasks.length} tasks` : (d?.pending !== undefined ? 'inbox' : '?');
  return `${r.sync_code}: ${tasks}`;
}).join(', ');
console.log(`Wrote scripts/seed-data.json: ${rows.length} row(s) [${summary}].`);
