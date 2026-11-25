// Draw-a-pattern unlock (25 Nov 2026): functions/api/_pattern.js through auth.js and settings.js, on a fake D1
// that knows the one-row settings table and auth_throttle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as gate } from '../functions/_middleware.js';
import { onRequestPost as auth } from '../functions/api/auth.js';
import { onRequestGet as getSettings, onRequestPut as putSettings } from '../functions/api/settings.js';
import { patternText } from '../functions/api/_pattern.js';

function fakeDB() {
  const row = { password_enabled: 0, password_hash: null, pattern_hash: null, recovery_hash: null };
  const throttle = new Map();
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => {
      if (/FROM auth_throttle/.test(sql)) { const t = throttle.get(args[0]); return t ? { ...t } : null; }
      if (/INTO auth_throttle/.test(sql)) {
        const t = throttle.get(args[0]) || { fails: 0, locked_until: null };
        t.fails += 1; throttle.set(args[0], t); return { fails: t.fails };
      }
      return { ...row };
    },
    run: async () => {
      if (/UPDATE auth_throttle/.test(sql)) throttle.set(args[1], { fails: 0, locked_until: args[0] });
      else if (/DELETE FROM auth_throttle/.test(sql)) throttle.delete(args[0]);
      else if (/password_enabled = 1, password_hash = \?/.test(sql)) Object.assign(row, { password_enabled: 1, password_hash: args[0] });
      else if (/password_enabled = 1/.test(sql)) row.password_enabled = 1;
      else if (/password_enabled = 0/.test(sql)) Object.assign(row, { password_enabled: 0, password_hash: null });
      else if (/SET recovery_hash = \?/.test(sql)) row.recovery_hash = args[0];
      else if (/SET pattern_hash = \?/.test(sql)) row.pattern_hash = args[0];
    },
  });
  return { prepare: (sql) => stmt(sql), row, throttle };
}
const env = () => ({ DB: fakeDB(), AUTH_SECRET: 'test-secret' });
const req = (method, path, { body, cookie } = {}) => new Request('https://life.example' + path, {
  method, headers: { 'content-type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body && JSON.stringify(body),
});
const post = (e, body) => auth({ request: req('POST', '/api/auth', { body }), env: e });
const put = (e, body) => putSettings({ request: req('PUT', '/api/settings', { body }), env: e });
const settings = async (e) => (await getSettings({ env: e })).json();
const passes = async (e, cookie) => {
  let reached = false;
  await gate({ request: req('GET', '/api/sync/abc', { cookie }), env: e, next: async () => { reached = true; return new Response('ok'); } });
  return reached;
};
const PAT = [1, 4, 7, 8];

test('patternText: 4–9 distinct dots from 1–9', () => {
  assert.equal(patternText([1, 4, 7, 8]), 'pattern:1-4-7-8');
  for (const bad of [[1, 2, 3], [1, 1, 2, 3], [0, 1, 2, 3], [1, 2, 3, 10], 'abcd', null]) assert.equal(patternText(bad), null);
});

test('a pattern needs the lock on, then unlocks like the password; only a hash is kept', async () => {
  const e = env();
  assert.equal((await put(e, { pattern: PAT })).status, 400, 'lock off: refused');
  await put(e, { password_enabled: true, password: 'first-pw' });
  assert.equal((await settings(e)).has_pattern, false);
  assert.equal((await put(e, { pattern: [1, 2] })).status, 400, 'too short');
  assert.equal((await put(e, { pattern: PAT })).status, 200);
  assert.equal((await settings(e)).has_pattern, true);
  assert.match(e.DB.row.pattern_hash, /^pbkdf2\$/);
  assert.ok(!e.DB.row.pattern_hash.includes('1-4-7-8'));
  const res = await post(e, { dots: PAT });
  assert.equal(res.status, 200);
  assert.equal(await passes(e, res.headers.get('Set-Cookie').split(';')[0]), true);
  assert.equal((await post(e, { dots: [1, 2, 3, 6] })).status, 401);
  assert.equal((await post(e, { password: 'first-pw' })).status, 200, 'the password still works (Forgot pattern?)');
});

test('wrong tries: 5 (password or pattern), then a wait; a right one clears the count', async () => {
  const e = env();
  await put(e, { password_enabled: true, password: 'first-pw' });
  await put(e, { pattern: PAT });
  for (let i = 0; i < 2; i++) assert.equal((await post(e, { dots: [9, 8, 7, 6] })).status, 401);
  assert.equal((await post(e, { dots: PAT })).status, 200);
  assert.equal(e.DB.throttle.size, 0, 'cleared');
  for (let i = 0; i < 4; i++) assert.equal((await post(e, { password: 'nope' })).status, 401);
  const fifth = await post(e, { dots: [9, 8, 7, 6] });
  assert.equal(fifth.status, 429);
  const waiting = await post(e, { dots: PAT });
  assert.equal(waiting.status, 429, 'even the right pattern waits');
  assert.match((await waiting.json()).error.message, /Wait 15 minutes/);
});

test('remove the pattern, and turning the lock off clears it', async () => {
  const e = env();
  await put(e, { password_enabled: true, password: 'first-pw' });
  await put(e, { pattern: PAT });
  await put(e, { pattern: null });
  assert.equal((await settings(e)).has_pattern, false);
  assert.equal((await post(e, { dots: PAT })).status, 409);
  await put(e, { pattern: PAT });
  await put(e, { password_enabled: false });
  assert.equal(e.DB.row.pattern_hash, null);
  assert.equal((await settings(e)).has_pattern, false);
});
