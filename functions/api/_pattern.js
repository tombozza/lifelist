// Draw-a-pattern unlock for the site password gate (Tom, 25 Nov 2026: "Any apps that you think needs password can
// you add the shoebox style swipe to unlock option."). Copied from House Book's People lock (house-book/src/lock.js).
// The same file is in golf-tracker/functions/api/_pattern.js: change one, change both.
//
// The browser only ever sends the list of dots (1–9, from vendor/chassis/pattern.js). Only a PBKDF2 hash of
// "pattern:1-4-7-8" is kept, in settings.pattern_hash (the column is added on first use). The pattern is an extra
// way in: the typed password (and its recovery code) always still works, as "Forgot pattern?".
//
// Wrong tries, by password or pattern, are counted per IP in auth_throttle (created on first use): 5, then
// 15 minutes' wait.

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array((s.match(/../g) || []).map((h) => parseInt(h, 16)));
const ITER = 100000; // the Workers runtime caps PBKDF2 at 100k iterations

async function pbkdf2(secret, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A pattern is 4–9 distinct dots, 1–9. Returns the text that gets hashed, or null. */
export function patternText(dots) {
  if (!Array.isArray(dots)) return null;
  const d = dots.map(Number);
  if (d.length < 4 || d.length > 9 || new Set(d).size !== d.length || d.some((n) => !(n >= 1 && n <= 9 && Number.isInteger(n)))) return null;
  return 'pattern:' + d.join('-');
}
export async function hashPattern(text) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${hex(salt)}$${await pbkdf2(text, salt, ITER)}`;
}
export async function checkPattern(text, stored) {
  const [kind, iter, salt, hash] = String(stored || '').split('$');
  if (!text || kind !== 'pbkdf2' || !hash) return false;
  return same(await pbkdf2(text, unhex(salt), Number(iter)), hash);
}

export async function getPatternHash(db) {
  try {
    const row = await db.prepare('SELECT pattern_hash FROM settings WHERE id = 1').first();
    return (row && row.pattern_hash) || null;
  } catch { return null; }   // no column yet
}
export async function setPatternHash(db, hash) {
  try { await db.prepare('ALTER TABLE settings ADD COLUMN pattern_hash TEXT').run(); } catch { /* already there */ }
  await db.prepare('UPDATE settings SET pattern_hash = ? WHERE id = 1').bind(hash).run();
}

// ---- wrong tries: 5 per IP, then 15 minutes ----
const TRIES = 5;
const WAIT_MIN = 15;
export const ipOf = (request) => request.headers.get('CF-Connecting-IP') || 'local';
const ensureThrottle = (db) => db.prepare(
  'CREATE TABLE IF NOT EXISTS auth_throttle (ip TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, locked_until TEXT)').run().catch(() => {});

/** Minutes this IP still has to wait, or 0. */
export async function waitLeft(db, ip) {
  try {
    const r = await db.prepare('SELECT locked_until FROM auth_throttle WHERE ip = ?').bind(ip).first();
    const until = r && r.locked_until ? Date.parse(r.locked_until) : 0;
    return until > Date.now() ? Math.ceil((until - Date.now()) / 60000) : 0;
  } catch { return 0; }   // no table yet
}
/** Count a wrong try. Returns the tries left (0 = now made to wait). */
export async function fail(db, ip) {
  await ensureThrottle(db);
  try {
    const r = await db.prepare(
      `INSERT INTO auth_throttle (ip, fails) VALUES (?, 1)
       ON CONFLICT(ip) DO UPDATE SET fails = fails + 1 RETURNING fails`).bind(ip).first();
    const fails = Number(r && r.fails) || 1;
    if (fails >= TRIES) {
      await db.prepare('UPDATE auth_throttle SET fails = 0, locked_until = ? WHERE ip = ?')
        .bind(new Date(Date.now() + WAIT_MIN * 60000).toISOString(), ip).run();
      return 0;
    }
    return TRIES - fails;
  } catch { return TRIES; }
}
export const clearFails = (db, ip) => db.prepare('DELETE FROM auth_throttle WHERE ip = ?').bind(ip).run().catch(() => {});
export const waitMessage = (mins) => `Too many wrong tries. Wait ${mins} minute${mins === 1 ? '' : 's'}.`;
export const WAIT_MINUTES = WAIT_MIN;
