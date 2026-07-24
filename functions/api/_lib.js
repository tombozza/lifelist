// Shared helpers for the life-kanban Pages Functions API.

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders },
  });
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Stateless session token = HMAC(AUTH_SECRET, "authenticated"). Single-user site.
export async function sessionToken(env) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.AUTH_SECRET || 'dev-insecure-secret'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('authenticated'));
  return hex(sig);
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export const SESSION_COOKIE = 'lk_session';

// Returns true when the site is either open, or password-gated and the caller holds a valid cookie.
export async function isAuthorized(context) {
  const { request, env } = context;
  const row = await env.DB.prepare('SELECT password_enabled FROM settings WHERE id = 1').first();
  if (!row || !row.password_enabled) return true;
  const token = getCookie(request, SESSION_COOKIE);
  return !!token && token === (await sessionToken(env));
}
