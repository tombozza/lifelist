// Load scripts/seed-data.json into D1 by PUTting each blob through the
// /api/sync/:code endpoint (parameterized bind, so it avoids SQLite's
// single-statement size limit that a SQL seed would hit).
//
// Usage:
//   node scripts/seed-d1.mjs                       # -> http://localhost:8788 (wrangler pages dev)
//   node scripts/seed-d1.mjs https://life-kanban.pages.dev   # -> production
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.argv[2] || 'http://localhost:8788').replace(/\/$/, '');
const rows = JSON.parse(readFileSync(join(root, 'scripts/seed-data.json'), 'utf8'));

for (const r of rows) {
  const res = await fetch(`${base}/api/sync/${encodeURIComponent(r.sync_code)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(r.data),
  });
  const tasks = Array.isArray(r.data?.tasks) ? `${r.data.tasks.length} tasks` : 'inbox/other';
  if (!res.ok) throw new Error(`PUT ${r.sync_code} -> ${res.status}: ${await res.text()}`);
  console.log(`Seeded ${r.sync_code} (${tasks}) -> ${base}`);
}
console.log('Done.');
