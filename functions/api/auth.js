import { json, sha256Hex, sessionToken, SESSION_COOKIE } from './_lib.js';

// POST /api/auth  { password }        -> set session cookie on success
// POST /api/auth  { action:'logout' } -> clear the cookie
export async function onRequestPost({ request, env }) {
  const body = await request.json();

  if (body.action === 'logout') {
    return json({ ok: true }, 200, {
      'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    });
  }

  const row = await env.DB.prepare('SELECT password_enabled, password_hash FROM settings WHERE id = 1').first();
  if (!row || !row.password_enabled) return json({ ok: true }); // gate off — nothing to do
  if (!body.password || (await sha256Hex(body.password)) !== row.password_hash) {
    return json({ error: { message: 'Incorrect password.' } }, 401);
  }
  const token = await sessionToken(env);
  return json({ ok: true }, 200, {
    'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`,
  });
}
