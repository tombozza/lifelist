import { json, sha256Hex } from './_lib.js';

// GET /api/settings -> { password_enabled } (never exposes the hash).
export async function onRequestGet({ env }) {
  const row = await env.DB.prepare('SELECT password_enabled FROM settings WHERE id = 1').first();
  return json({ password_enabled: !!(row && row.password_enabled) });
}

// PUT /api/settings  { password_enabled, password? }
//  - enabling requires a password (stored as a SHA-256 hash)
//  - disabling clears the gate
export async function onRequestPut({ request, env }) {
  const { password_enabled, password } = await request.json();
  if (password_enabled) {
    if (!password || password.length < 4) {
      return json({ error: { message: 'A password of at least 4 characters is required to enable the lock.' } }, 400);
    }
    await env.DB.prepare('UPDATE settings SET password_enabled = 1, password_hash = ? WHERE id = 1')
      .bind(await sha256Hex(password)).run();
  } else {
    await env.DB.prepare('UPDATE settings SET password_enabled = 0, password_hash = NULL WHERE id = 1').run();
  }
  return json({ password_enabled: !!password_enabled });
}
