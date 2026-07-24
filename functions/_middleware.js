import { isAuthorized, json } from './api/_lib.js';

// Gate the data API when the site password is enabled. The static app itself always
// loads and shows a password screen (driven by GET /api/settings); only the data
// endpoints are protected at the edge.
const ALWAYS_OPEN = [
  { method: 'POST', path: '/api/auth' },
  { method: 'GET', path: '/api/settings' },
];

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (!url.pathname.startsWith('/api/')) return next();
  if (ALWAYS_OPEN.some((r) => r.method === request.method && r.path === url.pathname)) return next();

  if (await isAuthorized(context)) return next();
  return json({ error: { code: 'locked', message: 'This site is locked.' } }, 401);
}
