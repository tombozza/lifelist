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
export function contextBlock({ app, name, v, data, now = new Date(), note }) {
  const when = now.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const body = { protocol: PROTOCOL, kind: 'context', app, v, as_of: now.toISOString(), data };
  return `AI Updates context: ${name} (copied ${when}). Use it for ${name} actions in this conversation.${note ? ` ${note}` : ''}\n${JSON.stringify(body)}`;
}

// ---------------------------------------------------------------------------------------
// The daily copy: each app shares its context with the App Hub (design/ARCHITECTURE.md §8b)

export const HUB_URL = 'https://app-hub-865.pages.dev';
const HUB_KEY = 'ai-updates-hub-key';
const SHARED = app => `ai-updates-shared:${app}`;
const RESHARE_MS = 6 * 3600 * 1000;

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
export async function shareContext(schema, context, { store = defaultStore(), fetch: f = globalThis.fetch, now = () => Date.now(), force = false } = {}) {
  try {
    captureHubKey(undefined, undefined, store);
    const key = hubKey(store);
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
    if (ok) return { shared: true };
    return { shared: false, reason: res?.status === 401 || res?.status === 403 ? 'bad-key' : `http-${res?.status}` };
  } catch (err) {
    return { shared: false, reason: err?.message ?? 'failed' };
  }
}
