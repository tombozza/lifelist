/* COPY of sites/_shared/ai-protocol/protocol.js — edit the source there and run node _shared/sync.mjs */
// AI Updates: the shared protocol. Source: sites/_shared/ai-protocol/ (edit there, then
// node _shared/sync.mjs). The design is sites/ai-updates/design/ARCHITECTURE.md; the
// rules the model follows are in sites/ai-updates/protocol/.
//
// ChatGPT (or any model) replies with ONE envelope holding a section per app:
//
//   {"protocol":"ai-updates","v":1,"id":"2026-11-12-pasta-week","summary":"…",
//    "apps":{"food_planner":{"v":6,"actions":[…]},"life_list":{"v":1,"actions":[…]}},
//    "still_open":["…"]}
//
// Every app pastes the whole reply into its own sheet and processReply() does the shared,
// fail-safe part: find the envelope, check it, take only this app's section, check each
// action against the app's schema, and flag anything already applied. The app then
// resolves names to its own records and applies the ticked actions with its own code.
// Nothing here writes app data.

import { validate } from './validate.js';

export const PROTOCOL = 'ai-updates';
export const ENVELOPE_VERSION = 1;
export const MAX_REPLY_CHARS = 500_000;

/** Display names for app ids, for "Also in this block: …". Add new apps here. */
export const APP_NAMES = {
  food_planner: 'Food Planner', finance_centre: 'Finance Centre', life_list: 'Life List', dad_hq: 'Dad HQ',
  champ_dash: 'Champ Dash', content_hub: 'Content Hub', bozza_hq: 'Bozza HQ', adhd_guide: 'ADHD Field Guide',
  storage_log: 'Storage Log', media_tracker: 'Media Tracker', app_hub: 'App Hub', hd_checklist: 'HD Checklist',
  diary: 'Diary', golf_tracker: 'Golf Tracker', filofax: 'Filofax', swipefy: 'Swipefy', holiday_tracker: 'Holiday Tracker',
};

/** Apps ChatGPT only reads (they take no changes), so nothing is passed to them. */
export const CONTEXT_ONLY = new Set(['diary', 'filofax', 'swipefy', 'golf_tracker', 'holiday_tracker']);

/** The envelope's own schema (the apps' sections are checked separately, by each app). */
export const ENVELOPE_SCHEMA = {
  type: 'object',
  required: ['protocol', 'v', 'apps'],
  additionalProperties: false,
  properties: {
    protocol: { const: PROTOCOL },
    v: { type: 'integer' },
    id: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]{2,40}$', hint: 'should be the date plus a few words, like 2026-11-12-pasta-week' },
    summary: { type: 'string', maxLength: 300 },
    apps: {
      type: 'object',
      minProperties: 1,
      propertyNames: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,30}$' },
      additionalProperties: {
        type: 'object',
        required: ['v', 'actions'],
        additionalProperties: false,
        properties: {
          v: { type: 'integer', minimum: 1 },
          actions: { type: 'array', minItems: 1, maxItems: 200 },
        },
      },
    },
    still_open: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 300 } },
  },
};

// ---------------------------------------------------------------------------------------
// Finding JSON in a chatty reply

const tidy = text => String(text ?? '')
  .replace(/[“”„‟″]/g, '"')
  .replace(/[‘’‚‛′]/g, "'")
  .replace(/ /g, ' ');

/** The end index of the {…} that opens at `start`, respecting strings; -1 if it never closes. */
function matchBrace(s, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Drop trailing commas before } or ], outside strings. */
function dropTrailingCommas(s) {
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === ',') {
      let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '}' || s[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

/** Every top-level JSON object in the text that parses, in order. */
export function findObjects(text) {
  const s = tidy(text);
  const found = [];
  for (let i = s.indexOf('{'); i !== -1; ) {
    const end = matchBrace(s, i);
    if (end === -1) break;
    let obj;
    try { obj = JSON.parse(dropTrailingCommas(s.slice(i, end + 1))); } catch { obj = undefined; }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) { found.push(obj); i = s.indexOf('{', end + 1); }
    else i = s.indexOf('{', i + 1);
  }
  return found;
}

/** A v6 Food Planner/Finance Centre block ({"v":6,"food":[…],"finance":[…]}) as an envelope. */
export function fromLegacy(obj) {
  const apps = {};
  if (Array.isArray(obj.food) && obj.food.length) apps.food_planner = { v: Number.isInteger(obj.v) ? obj.v : 6, actions: obj.food };
  if (Array.isArray(obj.finance) && obj.finance.length) apps.finance_centre = { v: 1, actions: obj.finance };
  return { protocol: PROTOCOL, v: ENVELOPE_VERSION, apps, still_open: [] };
}

const isLegacy = o => o && !('protocol' in o) && (Array.isArray(o.food) || Array.isArray(o.finance));

/**
 * Find the envelope in a reply.
 * @returns {{envelope:object, legacy:boolean} | {error:string}}
 */
export function extractEnvelope(text) {
  if (!String(text ?? '').trim()) return { error: 'Paste the reply first.' };
  if (String(text).length > MAX_REPLY_CHARS) return { error: 'That’s far too long to be one reply. Paste just the block.' };
  const objs = findObjects(text);
  const env = objs.find(o => o.protocol === PROTOCOL && o.kind !== 'context' && o.kind !== 'daily');
  if (env) return { envelope: env, legacy: false };
  if (objs.some(o => o.protocol === PROTOCOL && (o.kind === 'context' || o.kind === 'daily'))) {
    return { error: 'That’s a context block, for pasting into ChatGPT. Paste ChatGPT’s reply here instead.' };
  }
  const old = objs.find(isLegacy);
  if (old) return { envelope: fromLegacy(old), legacy: true };
  return { error: 'No AI Updates block found. Paste the whole reply, including the code block. If ChatGPT didn’t send one, ask it for “the AI Updates block”.' };
}

// ---------------------------------------------------------------------------------------
// Fingerprints, so a second paste doesn't apply things twice

/** JSON with keys sorted, so the same action always gives the same text. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

function fnv(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** A short stable id for one action in one block. */
export function fingerprint(app, envelopeId, action) {
  const s = `${app}|${envelopeId ?? ''}|${canonical(action)}`;
  return fnv(s, 0x811c9dc5) + fnv(s, 0x01000193);
}

const KEEP_MS = 90 * 24 * 3600 * 1000;
const memoryStore = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const defaultStore = () => { try { if (typeof localStorage !== 'undefined') { localStorage.getItem('x'); return localStorage; } } catch { /* blocked */ } return memoryStore(); };

/**
 * What this device has already applied, kept for 90 days.
 * @param {string} app
 * @param {{getItem, setItem, removeItem}} [store]  localStorage by default
 */
export function appliedLog(app, store = defaultStore(), now = () => Date.now()) {
  const key = `ai-updates-applied:${app}`;
  const read = () => {
    let m = {};
    try { m = JSON.parse(store.getItem(key) || '{}') || {}; } catch { m = {}; }
    const cut = now() - KEEP_MS;
    for (const k of Object.keys(m)) if (!(m[k] > cut)) delete m[k];
    return m;
  };
  return {
    has: fp => fp in read(),
    add: fps => { const m = read(); for (const fp of [].concat(fps)) m[fp] = now(); try { store.setItem(key, JSON.stringify(m)); } catch { /* full or blocked */ } },
    clear: () => { try { store.removeItem(key); } catch { /* blocked */ } },
  };
}

// ---------------------------------------------------------------------------------------
// The whole check, for one app

/**
 * An app's schema module (ai/schema.js in each app) looks like:
 *   { app: 'life_list', name: 'Life List', v: 1, accepts: [1],
 *     defs: { … shared sub-schemas … },
 *     actions: { add_task: { title: 'Add a task', schema: { …JSON Schema… }, describe: a => 'Add “Book MOT”' }, … },
 *     upgrade?: (fromV, actions) => actions }
 */
export function checkAppSchema(s) {
  const bad = m => { throw new Error(`AI schema for ${s?.app ?? '?'}: ${m}`); };
  if (!s || typeof s !== 'object') bad('missing');
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(s.app ?? '')) bad('app id should be snake_case');
  if (!Number.isInteger(s.v)) bad('v should be a whole number');
  if (!Array.isArray(s.accepts) || !s.accepts.includes(s.v)) bad('accepts should list v');
  // A context-only app gives ChatGPT its state to answer questions from, and takes no actions.
  if (s.contextOnly) { if (!s.actions || Object.keys(s.actions).length) bad('a contextOnly app has actions: {}'); return s; }
  if (!s.actions || !Object.keys(s.actions).length) bad('no actions');
  for (const [type, a] of Object.entries(s.actions)) {
    if (!a.schema || a.schema.type !== 'object') bad(`${type}: schema should be an object schema`);
    if (a.schema.properties?.type?.const !== type) bad(`${type}: schema should have properties.type.const = "${type}"`);
  }
  return s;
}

/**
 * Process a pasted reply for one app. Pure: writes nothing.
 *
 * @param {string} text  the whole reply
 * @param {object} schema  the app's schema module
 * @param {{log?: {has:(fp:string)=>boolean}}} [opts]
 * @returns {{ok:false, error:string} | {
 *   ok:true, legacy:boolean, envelope:object, id:string|null, summary:string, stillOpen:string[],
 *   others:string[], section:{v:number}|null, note:string|null,
 *   items:{index:number, action:any, type:string, status:'ready'|'duplicate'|'invalid'|'unknown', errors:string[], fingerprint:string, title:string, text:string}[] }}
 */
export function processReply(text, schema, opts = {}) {
  checkAppSchema(schema);
  const found = extractEnvelope(text);
  if (found.error) return { ok: false, error: found.error };
  const { envelope, legacy } = found;

  if (!legacy) {
    if (envelope.v !== ENVELOPE_VERSION) {
      return { ok: false, error: Number.isInteger(envelope.v) && envelope.v > ENVELOPE_VERSION
        ? `This block uses AI Updates version ${envelope.v}; this app reads version ${ENVELOPE_VERSION}. Update the app first.`
        : `This block’s version (${JSON.stringify(envelope.v)}) isn’t one this app reads.` };
    }
    const errs = validate(envelope, ENVELOPE_SCHEMA, { path: '' });
    if (errs.length) return { ok: false, error: `The block isn’t valid, so nothing was changed: ${errs.slice(0, 3).join('; ')}${errs.length > 3 ? ` (and ${errs.length - 3} more)` : ''}.` };
  }

  const apps = envelope.apps ?? {};
  const others = Object.keys(apps).filter(a => a !== schema.app);
  const base = {
    ok: true, legacy, envelope, id: envelope.id ?? null, summary: envelope.summary ?? '',
    stillOpen: Array.isArray(envelope.still_open) ? envelope.still_open : [], others, section: null, note: null, items: [],
  };
  const sec = apps[schema.app];
  if (sec && schema.contextOnly) return { ...base, note: `${schema.name ?? schema.app} takes no AI Updates changes; ChatGPT only reads its context. Nothing was changed.` };
  if (!sec) return { ...base, note: `Nothing for ${schema.name ?? schema.app} in this block.` };
  if (legacy && !Array.isArray(sec.actions)) return { ...base, note: `Nothing for ${schema.name ?? schema.app} in this block.` };

  if (!schema.accepts.includes(sec.v)) {
    const newer = sec.v > schema.v;
    return { ...base, section: sec, note: newer
      ? `This block uses ${schema.name ?? schema.app} format v${sec.v}, but this app reads v${schema.v}. Update the app, then paste again. Nothing was changed.`
      : `This block uses an old ${schema.name ?? schema.app} format (v${sec.v}). Upload the latest docs to the ChatGPT project and ask for the block again. Nothing was changed.` };
  }
  const actions = sec.v !== schema.v && schema.upgrade ? schema.upgrade(sec.v, sec.actions) : sec.actions;

  base.section = sec;
  base.items = actions.map((action, index) => {
    const fp = fingerprint(schema.app, envelope.id, action);
    const item = { index, action, type: action?.type ?? '', status: 'ready', errors: [], fingerprint: fp, title: '', text: '' };
    if (!action || typeof action !== 'object' || Array.isArray(action) || typeof action.type !== 'string') {
      return { ...item, status: 'invalid', errors: ['each action needs a "type"'], title: 'Unreadable action' };
    }
    const def = schema.actions[action.type];
    if (!def) return { ...item, status: 'unknown', errors: [`“${action.type}” isn’t something ${schema.name ?? schema.app} does`], title: action.type };
    item.title = def.title ?? action.type;
    const errors = validate(action, def.schema, { defs: schema.defs ?? {} });
    if (errors.length) return { ...item, status: 'invalid', errors };
    try { item.text = def.describe ? String(def.describe(action)) : ''; } catch { item.text = ''; }
    if (opts.log?.has(fp)) item.status = 'duplicate';
    return item;
  });
  return base;
}

// ---------------------------------------------------------------------------------------
// Context: what an app hands to ChatGPT

/**
 * The "Copy for ChatGPT" text: a labelled, dated, compact JSON block.
 * @param {{app:string, name:string, v:number, data:object, now?:Date, note?:string}} o
 */
export function contextBlock({ app, name, v, data, now = new Date(), note, contextOnly = false }) {
  const when = now.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const body = { protocol: PROTOCOL, kind: 'context', app, v, as_of: now.toISOString(), ...(contextOnly ? { context_only: true } : {}), data };
  const use = contextOnly
    ? `Use it to answer questions and plan; ${name} takes no AI Updates block.`
    : `Use it for ${name} actions in this conversation.`;
  return `AI Updates context: ${name} (copied ${when}). ${use}${note ? ` ${note}` : ''}\n${JSON.stringify(body)}`;
}

// ---------------------------------------------------------------------------------------
// The daily copy: each app shares its context with the App Hub (design/ARCHITECTURE.md §8b)

export const HUB_URL = 'https://app-hub-865.pages.dev';
const HUB_KEY = 'ai-updates-hub-key';
const SHARED = app => `ai-updates-shared:${app}`;
const RESHARE_MS = 6 * 3600 * 1000;
const JUST_LINKED = 'ai-updates-hub-linked';

/** A short message at the bottom of the page, gone after a few seconds. Never moves the page. */
export function showHubMessage(text, doc = globalThis.document) {
  try {
    if (!doc?.body) return;
    const el = doc.createElement('div');
    el.setAttribute('role', 'status');
    el.textContent = text;
    el.style.cssText = 'position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);'
      + 'z-index:2147483647;max-width:calc(100vw - 32px);box-sizing:border-box;padding:10px 16px;border-radius:12px;'
      + 'background:#1f2328;color:#fff;font:500 15px/1.35 system-ui,-apple-system,sans-serif;text-align:center;'
      + 'box-shadow:0 4px 18px rgba(0,0,0,.25);pointer-events:none;';
    doc.body.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  } catch { /* no page */ }
}

/** The App Hub key kept on this device ('' when sharing isn't set up). */
export function hubKey(store = defaultStore()) { try { return store.getItem(HUB_KEY) || ''; } catch { return ''; } }

/** Keep (or with '' forget) the App Hub key on this device. */
export function setHubKey(key, store = defaultStore()) {
  const k = String(key ?? '').trim();
  try { if (k) store.setItem(HUB_KEY, k); else store.removeItem(HUB_KEY); } catch { /* blocked */ }
  return !!k;
}

/**
 * The App Hub's "Set up" link opens the app with #ai-hub-key=… . Keep the key and tidy the
 * address, so it isn't left in the bar or bookmarked. Returns true when a key was taken.
 */
export function captureHubKey(loc = globalThis.location, hist = globalThis.history, store = defaultStore()) {
  try {
    const m = /(?:^#|&)ai-hub-key=([A-Za-z0-9_-]{16,128})(?=&|$)/.exec(loc?.hash || '');
    if (!m) return false;
    setHubKey(m[1], store);
    try { store.setItem(JUST_LINKED, '1'); } catch { /* blocked */ }
    const rest = loc.hash.replace(/(^#|&)ai-hub-key=[^&]*/, '$1').replace(/^#&/, '#').replace(/&$/, '');
    hist?.replaceState?.(hist.state, '', `${loc.pathname}${loc.search}${rest === '#' ? '' : rest}`);
    return true;
  } catch { return false; }
}

/** When this app last shared its context from this device ({at, ok} or null). */
export function lastShared(app, store = defaultStore()) {
  try { return JSON.parse(store.getItem(SHARED(app)) || 'null'); } catch { return null; }
}

/**
 * Send this app's context to the App Hub, for the daily copy. Never throws, never blocks the app.
 * Skipped when this device has no key, or when the same data went in the last 6 hours (unless force).
 * @returns {Promise<{shared:boolean, reason?:string}>}
 */
export async function shareContext(schema, context, { store = defaultStore(), fetch: f = globalThis.fetch, now = () => Date.now(), force = false, notify = showHubMessage } = {}) {
  try {
    captureHubKey(undefined, undefined, store);
    const key = hubKey(store);
    let linked = false;
    try { linked = store.getItem(JUST_LINKED) === '1'; } catch { /* blocked */ }
    if (linked) force = true;
    if (!key) return { shared: false, reason: 'no-key' };
    if (typeof f !== 'function') return { shared: false, reason: 'no-fetch' };
    const c = context();
    if (!c || c.data === undefined) return { shared: false, reason: 'no-context' };
    const sig = fingerprint(schema.app, String(schema.v), c.data);
    const last = lastShared(schema.app, store);
    if (!force && last?.ok && last.sig === sig && now() - last.at < RESHARE_MS) return { shared: false, reason: 'unchanged' };
    const body = { v: schema.v, name: schema.name ?? schema.app, as_of: new Date(now()).toISOString(), data: c.data, ...(c.note ? { note: c.note } : {}) };
    const res = await f(`${HUB_URL}/api/ai-context/${schema.app}`, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-hub-key': key }, body: JSON.stringify(body),
    });
    const ok = !!res?.ok;
    try { store.setItem(SHARED(schema.app), JSON.stringify({ at: now(), ok, sig, status: res?.status ?? 0 })); } catch { /* blocked */ }
    const bad = res?.status === 401 || res?.status === 403;
    if (linked && (ok || bad)) {
      try { store.removeItem(JUST_LINKED); } catch { /* blocked */ }
      notify(ok ? 'Linked to the App Hub ✓ This app is now in the daily copy.'
        : 'The App Hub didn’t accept that key. Tap Set up on the App Hub’s AI tab again.');
    }
    if (ok) return { shared: true };
    return { shared: false, reason: bad ? 'bad-key' : `http-${res?.status}` };
  } catch (err) {
    return { shared: false, reason: err?.message ?? 'failed' };
  }
}

// ---------------------------------------------------------------------------------------
// One page in every app (ARCHITECTURE §8c): the reference document, the daily update, any paste,
// and the inbox of parts pasted into another app. All through the App Hub, with the hub key.

/** Call the App Hub with this device's key. Resolves to the parsed JSON; throws a plain message. */
export async function hubCall(path, { method = 'GET', body, store = defaultStore(), fetch: f = globalThis.fetch } = {}) {
  const key = hubKey(store);
  if (!key) throw new Error('This device isn’t linked to the App Hub yet.');
  const res = await f(`${HUB_URL}${path}`, {
    method, cache: 'no-store',
    headers: { 'x-hub-key': key, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error('The App Hub didn’t accept this device’s key. Set it up again.');
  if (!res.ok) throw new Error(data.error || `The App Hub answered ${res.status}.`);
  return data;
}

/** The reference document's {version, since, apps} (part 'meta'), or with its text ('reference'), or the daily update ('daily'). */
export const fetchPack = (part = 'meta', o) => hubCall(`/api/ai-pack?part=${part}`, o);

/** Parts of this app's AI Updates pasted elsewhere, waiting here: [{id, summary, from, section, received_at}]. */
export const fetchInbox = async (app, o) => (await hubCall(`/api/ai-inbox/${app}`, o)).items ?? [];

/** Forget a waiting part once it's been applied or dismissed. */
export const clearInbox = (app, id, o) => hubCall(`/api/ai-inbox/${app}?id=${encodeURIComponent(id)}`, { ...o, method: 'DELETE' });

/** A short hash of a text, to tell whether it changed without keeping it. */
function textHash(t) {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${t.length}:${(h >>> 0).toString(36)}`;
}

/**
 * Send an app's stable reference data (Markdown) for the reference document. Never throws.
 * Sent only when it changed since this device last sent it (a recipe book is ~600 KB), unless `force`.
 */
export async function shareReference(app, { title, text }, o = {}) {
  const store = o.store ?? defaultStore();
  const key = `ai-updates-reference-sent:${app}`;
  const sig = textHash(`${title}\n${text}`);
  let last = ''; try { last = store.getItem(key) || ''; } catch { /* blocked */ }
  if (!o.force && last === sig) return { shared: false, reason: 'unchanged' };
  try {
    await hubCall(`/api/ai-reference/${app}`, { ...o, method: 'PUT', body: { title, text } });
    try { store.setItem(key, sig); } catch { /* blocked: sent again next time */ }
    return { shared: true };
  } catch (err) { return { shared: false, reason: err?.message ?? 'failed' }; }
}

/**
 * Pass every other app's part of a pasted reply to that app's inbox, so it's waiting there.
 * Apps that take no changes, or that this library doesn't know, are left out.
 * @returns {Promise<{sent:string[], failed:string[], reason?:string}>}  app ids
 */
export async function forwardParts(envelope, fromApp, o = {}) {
  const sent = [], failed = [];
  const parts = Object.entries(envelope?.apps ?? {}).filter(([app, s]) => app !== fromApp && APP_NAMES[app] && !CONTEXT_ONLY.has(app) && Array.isArray(s?.actions) && s.actions.length);
  if (!parts.length) return { sent, failed };
  if (!hubKey(o.store ?? defaultStore())) return { sent, failed: parts.map(([a]) => a), reason: 'no-key' };
  const id = String(envelope.id || `pasted-${fingerprint('any', '', envelope)}`);
  await Promise.all(parts.map(async ([app, section]) => {
    try { await hubCall(`/api/ai-inbox/${app}`, { ...o, method: 'POST', body: { id, summary: envelope.summary ?? '', from: fromApp, section } }); sent.push(app); }
    catch { failed.push(app); }
  }));
  return { sent, failed };
}

/** A waiting part as a one-app reply, so the usual check and preview read it. */
export const inboxReply = (app, item) => JSON.stringify({ protocol: PROTOCOL, v: ENVELOPE_VERSION, id: item.id, summary: item.summary || undefined, apps: { [app]: item.section } });

/** Save text as a file on this device (the reference document). Call inside the tap. */
export function downloadText(name, text, doc = globalThis.document) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = doc.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  doc.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const REF_SEEN = 'ai-updates-reference-downloaded';
/** The reference version this device last downloaded ('' if never). */
export const referenceSeen = (store = defaultStore()) => { try { return store.getItem(REF_SEEN) || ''; } catch { return ''; } };
export const markReferenceSeen = (version, store = defaultStore()) => { try { store.setItem(REF_SEEN, version); } catch { /* blocked */ } };
