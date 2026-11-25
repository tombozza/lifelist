import { json, sha256Hex, getRecoveryHash, setRecoveryHash } from './_lib.js';
import { makeRecoveryCode, hashRecoveryCode } from '../../vendor/safety/recovery.js';
import { patternText, hashPattern, getPatternHash, setPatternHash } from './_pattern.js';

// GET /api/settings -> { password_enabled, has_recovery_code, has_pattern } (never exposes a hash).
export async function onRequestGet({ env }) {
  const row = await env.DB.prepare('SELECT password_enabled FROM settings WHERE id = 1').first();
  const on = !!(row && row.password_enabled);
  return json({
    password_enabled: on,
    has_recovery_code: on && !!(await getRecoveryHash(env.DB)),
    has_pattern: on && !!(await getPatternHash(env.DB)),
  });
}

// A new recovery code: its hash is stored, the code itself goes back once for the screen to show.
async function freshCode(db) {
  const code = makeRecoveryCode();
  await setRecoveryHash(db, await hashRecoveryCode(code));
  return code;
}

// PUT /api/settings  { password_enabled, password? }  or  { new_recovery_code: true }  or  { pattern: [dots] | null }
//  - pattern: draw-a-pattern unlock on top of the password (set, changed, or null to remove); the lock must be on
//  - enabling requires a password (stored as a SHA-256 hash); a blank password
//    keeps the one already set, and is refused when none is set yet
//  - a new password (or new_recovery_code) makes a new recovery code: { recovery_code }
//  - disabling clears the gate, the recovery code and the pattern
// (Gated by _middleware.js when the lock is on.)
export async function onRequestPut({ request, env }) {
  const body = await request.json();
  if (body.new_recovery_code) {
    const row = await env.DB.prepare('SELECT password_enabled FROM settings WHERE id = 1').first();
    if (!row || !row.password_enabled) return json({ error: { message: 'Turn the password on first.' } }, 400);
    return json({ password_enabled: true, recovery_code: await freshCode(env.DB) });
  }
  if ('pattern' in body) {
    const row = await env.DB.prepare('SELECT password_enabled FROM settings WHERE id = 1').first();
    if (!row || !row.password_enabled) return json({ error: { message: 'Turn the password on first.' } }, 400);
    if (body.pattern === null) {
      await setPatternHash(env.DB, null);
      return json({ password_enabled: true, has_pattern: false });
    }
    const text = patternText(body.pattern);
    if (!text) return json({ error: { message: 'Join at least 4 dots.' } }, 400);
    await setPatternHash(env.DB, await hashPattern(text));
    return json({ password_enabled: true, has_pattern: true });
  }
  const { password_enabled, password } = body;
  if (password_enabled) {
    if (password) {
      // A new password: replace the stored hash.
      if (password.length < 4) {
        return json({ error: { message: 'A password of at least 4 characters is required to enable the lock.' } }, 400);
      }
      await env.DB.prepare('UPDATE settings SET password_enabled = 1, password_hash = ? WHERE id = 1')
        .bind(await sha256Hex(password)).run();
      return json({ password_enabled: true, recovery_code: await freshCode(env.DB) });
    }
    // Blank box: keep the current password if there is one, otherwise ask for one.
    const row = await env.DB.prepare('SELECT password_hash FROM settings WHERE id = 1').first();
    if (!row || !row.password_hash) {
      return json({ error: { message: 'Choose a password (at least 4 characters) to turn the lock on.' } }, 400);
    }
    await env.DB.prepare('UPDATE settings SET password_enabled = 1 WHERE id = 1').run();
  } else {
    await env.DB.prepare('UPDATE settings SET password_enabled = 0, password_hash = NULL WHERE id = 1').run();
    if (await getRecoveryHash(env.DB)) await setRecoveryHash(env.DB, null);
    if (await getPatternHash(env.DB)) await setPatternHash(env.DB, null);
  }
  return json({ password_enabled: !!password_enabled });
}
