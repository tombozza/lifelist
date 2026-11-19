/* COPY of sites/_shared/safety/recovery.js — edit the source there and run node _shared/sync.mjs */
// Never locked out (Round 3 of the 18 Nov 2026 app review). Whenever a lock is set, the server makes a
// recovery code, keeps only its hash, and sends the code back ONCE for the screen to show. On the lock
// screen the code works in place of the password, so a forgotten password is never the end. Choosing a new
// password (or "New recovery code" in Settings) makes a new code; the old one stops working.
//
// Server (Pages Function or Worker):
//   import { makeRecoveryCode, hashRecoveryCode, checkRecoveryCode } from '.../vendor/safety/recovery.js';
//   const code = makeRecoveryCode();                     // "K7QM-3XRP-9WTD-H2FA"
//   store recovery_hash = await hashRecoveryCode(code);  // and answer { ..., recovery_code: code } once
//   // at sign-in, when the password doesn't match:
//   if (await checkRecoveryCode(input, stored.recovery_hash)) -> unlock, { recovered: true }
//
// Client: recovery-sheet.js shows the code (Copy, "I've saved it").
//
// 16 characters from 30 that can't be misread (no 0/O, 1/I/L, U): about 78 bits, so a plain SHA-256 is
// enough and nothing can be guessed by trying. Typing is forgiving: case, spaces and dashes are ignored.

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 16;

export function makeRecoveryCode() {
  const out = [];
  while (out.length < LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(LENGTH * 2));
    for (const b of bytes) {
      if (b < 240 && out.length < LENGTH) out.push(ALPHABET[b % 30]);   // 240 = 8 × 30: no bias
    }
  }
  return out.join('').match(/.{4}/g).join('-');
}

/** Upper case, no spaces or dashes. */
export function normaliseRecoveryCode(s) {
  return String(s ?? '').toUpperCase().replace(/[\s-]/g, '');
}

/** True when the text has the shape of a recovery code (so a password box can tell the two apart). */
export function isRecoveryCode(s) {
  const n = normaliseRecoveryCode(s);
  return n.length === LENGTH && [...n].every((c) => ALPHABET.includes(c));
}

export async function hashRecoveryCode(code) {
  const data = new TextEncoder().encode(`recovery:${normaliseRecoveryCode(code)}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare of a typed code against a stored hash. False when there's no stored hash. */
export async function checkRecoveryCode(input, storedHash) {
  if (!storedHash || !isRecoveryCode(input)) return false;
  const h = await hashRecoveryCode(input);
  if (h.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return diff === 0;
}
