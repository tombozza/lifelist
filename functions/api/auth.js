import { json, sha256Hex, sessionToken, SESSION_COOKIE, getRecoveryHash } from './_lib.js';
import { checkRecoveryCode } from '../../vendor/safety/recovery.js';
import { patternText, checkPattern, getPatternHash, ipOf, waitLeft, fail, clearFails, waitMessage, WAIT_MINUTES } from './_pattern.js';

// POST /api/auth  { password }        -> set session cookie on success. The recovery code works in place
//                                        of the password and answers { recovered: true }.
// POST /api/auth  { dots:[1,4,7,8] }  -> the drawn pattern instead of the password, once one is set
// POST /api/auth  { action:'logout' } -> clear the cookie
// Wrong passwords and patterns both count towards the wait (_pattern.js): 5 tries, then 15 minutes.
export async function onRequestPost({ request, env }) {
  const body = await request.json();

  if (body.action === 'logout') {
    return json({ ok: true }, 200, {
      'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    });
  }

  const row = await env.DB.prepare('SELECT password_enabled, password_hash FROM settings WHERE id = 1').first();
  if (!row || !row.password_enabled) return json({ ok: true }); // gate off — nothing to do
  const ip = ipOf(request);
  const mins = await waitLeft(env.DB, ip);
  if (mins) return json({ error: { message: waitMessage(mins) } }, 429);
  const wrong = async (what) => {
    const left = await fail(env.DB, ip);
    return json({ error: { message: left === 0 ? waitMessage(WAIT_MINUTES) : `That ${what} isn’t right.` } }, left === 0 ? 429 : 401);
  };
  let recovered = false;
  if (body.dots != null) {
    const stored = await getPatternHash(env.DB);
    if (!stored) return json({ error: { message: 'No pattern is set. Use the password.' } }, 409);
    if (!(await checkPattern(patternText(body.dots), stored))) return wrong('pattern');
  } else if (!body.password || (await sha256Hex(body.password)) !== row.password_hash) {
    recovered = await checkRecoveryCode(body.password, await getRecoveryHash(env.DB));
    if (!recovered) return wrong('password');
  }
  await clearFails(env.DB, ip);
  if (!env.AUTH_SECRET) return json({ error: { message: "The lock can't sign you in: the server's AUTH_SECRET isn't set. Set it and redeploy." } }, 503);
  const token = await sessionToken(env, row.password_hash);
  return json({ ok: true, recovered }, 200, {
    'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`,
  });
}
