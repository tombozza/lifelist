// The site password: functions/_middleware.js + api/{auth,settings}.js on a fake one-row settings table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as gate } from '../functions/_middleware.js';
import { onRequestPost as auth } from '../functions/api/auth.js';
import { onRequestPut as putSettings } from '../functions/api/settings.js';

function fakeDB() {
  const row = { password_enabled: 0, password_hash: null };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => ({ ...row }),
    run: async () => {
      if (/password_enabled = 1, password_hash = \?/.test(sql)) Object.assign(row, { password_enabled: 1, password_hash: args[0] });
      else if (/password_enabled = 1/.test(sql)) row.password_enabled = 1;
      else if (/password_enabled = 0/.test(sql)) Object.assign(row, { password_enabled: 0, password_hash: null });
    },
  });
  return { prepare: (sql) => stmt(sql), row };
}
const env = () => ({ DB: fakeDB(), AUTH_SECRET: 'test-secret' });
const req = (method, path, { body, cookie } = {}) => new Request('https://life.example' + path, {
  method, headers: { 'content-type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body && JSON.stringify(body),
});
const passes = async (e, r) => {
  let reached = false;
  const res = await gate({ request: r, env: e, next: async () => { reached = true; return new Response('ok'); } });
  return reached ? true : res.status;
};
const signIn = async (e, password) => (await auth({ request: req('POST', '/api/auth', { body: { password } }), env: e })).headers.get('Set-Cookie')?.split(';')[0];
const setPw = (e, password, on = true) => putSettings({ request: req('PUT', '/api/settings', { body: { password_enabled: on, password } }), env: e });

test('off: the sync route is open; on: it needs the cookie', async () => {
  const e = env();
  assert.equal(await passes(e, req('PUT', '/api/sync/abc')), true);
  await setPw(e, 'first-pw');
  assert.equal(await passes(e, req('GET', '/api/sync/abc')), 401);
  assert.equal(await passes(e, req('GET', '/api/settings')), true);
  assert.equal((await auth({ request: req('POST', '/api/auth', { body: { password: 'nope' } }), env: e })).status, 401);
  assert.equal(await passes(e, req('PUT', '/api/sync/abc', { cookie: await signIn(e, 'first-pw') })), true);
});

test('a new password signs every old cookie out', async () => {
  const e = env();
  await setPw(e, 'first-pw');
  const old = await signIn(e, 'first-pw');
  await setPw(e, 'second-pw');
  assert.equal(await passes(e, req('GET', '/api/sync/abc', { cookie: old })), 401);
  assert.equal(await passes(e, req('GET', '/api/sync/abc', { cookie: await signIn(e, 'second-pw') })), true);
  await setPw(e, undefined, false);
  assert.equal(await passes(e, req('GET', '/api/sync/abc')), true, 'off again: open');
});
