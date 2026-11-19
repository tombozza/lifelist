/* COPY of sites/_shared/safety/save-queue.js — edit the source there and run node _shared/sync.mjs */
// No more silent save loss (Round 2 of the 18 Nov 2026 app review). A save that fails (offline, locked, a
// server hiccup) is kept on the device and retried, and the screen says "Not saved yet" until it lands.
// Before, several apps ignored the error and then let the server's copy replace the local one.
//
//   import { createSaveQueue, saveStatus } from './vendor/safety/save-queue.js';
//   const q = createSaveQueue({
//     name: 'dad-hq',                                   // localStorage key sq:dad-hq
//     send: async (op) => { const r = await fetch(op.url, { method: op.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(op.body) });
//                           if (!r.ok) throw Object.assign(new Error(await r.text()), { status: r.status }); },
//   });
//   q.push({ url: '/api/places/12', method: 'PATCH', body: { done: 1 }, key: 'place:12' });  // key: a newer op replaces a waiting one
//   document.querySelector('.ui-bar').append(saveStatus(q));   // nothing while saved; "Saving…"; "Not saved yet · Retry"
//   q.pending()  // true while anything is waiting: don't let the server's copy replace local edits then
//
// Ops are sent one at a time, in order. A failure stops the queue and retries after 2s, 5s, 15s, 30s, 60s…
// and whenever the device comes back online or the app is opened again. A 4xx other than 401/403/408/429
// means the server refused that op for good: it's dropped and reported (onDrop), so one bad op can't block
// the rest forever.

const WAITS = [2000, 5000, 15000, 30000, 60000];

export function createSaveQueue({ name, send, onChange, onDrop, storage }) {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const KEY = `sq:${name}`;
  const load = () => { try { return JSON.parse(store?.getItem(KEY) ?? '[]'); } catch { return []; } };
  let ops = load();
  let sending = false, failing = false, lastError = '', timer = null, tries = 0;
  const listeners = new Set(onChange ? [onChange] : []);
  const save = () => { try { store?.setItem(KEY, JSON.stringify(ops)); } catch { /* full or blocked: kept in memory */ } };
  const state = () => ({ waiting: ops.length, sending, failing, lastError });
  const emit = () => { for (const f of listeners) { try { f(state()); } catch { /* a listener's problem */ } } };

  async function flush() {
    if (sending || !ops.length) { emit(); return; }
    clearTimeout(timer); timer = null;
    sending = true; emit();
    while (ops.length) {
      const op = ops[0];
      try {
        await send(op.op);
        ops = ops.filter((x) => x !== op); save(); failing = false; lastError = ''; tries = 0;
      } catch (e) {
        const s = Number(e?.status);
        if (s >= 400 && s < 500 && ![401, 403, 408, 429].includes(s)) {
          ops = ops.filter((x) => x !== op); save();
          try { onDrop?.(op.op, e); } catch { /* ignore */ }
          continue;
        }
        failing = true;
        lastError = s === 401 || s === 403 ? 'Locked: unlock the app to save' : 'Not saved yet';
        timer = setTimeout(flush, WAITS[Math.min(tries, WAITS.length - 1)]);
        tries++;
        break;
      }
    }
    sending = false; emit();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => flush());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
  }
  if (ops.length) setTimeout(flush, 0);   // something from last time

  return {
    push(op) {
      // A newer op replaces a waiting one with the same key, but never the one being sent right now: that one
      // is removed by identity when its send finishes, so the newer op must stay behind it.
      if (op && op.key != null) ops = ops.filter((x, i) => (sending && i === 0) || x.op.key !== op.key);
      ops.push({ op, at: Date.now() });
      save(); flush();
    },
    flush: () => { tries = 0; return flush(); },
    pending: () => ops.length > 0,
    waiting: () => ops.map((x) => x.op),
    state,
    subscribe(f) { listeners.add(f); f(state()); return () => listeners.delete(f); },
    stop() { clearTimeout(timer); timer = null; },   // tests; an app never needs it
  };
}

/** A small status for a top bar: empty while saved, "Saving…", or "Not saved yet" with Retry. */
export function saveStatus(queue) {
  const el = document.createElement('span');
  el.className = 'ui-actions';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  let shown = '';
  queue.subscribe((s) => {
    const html = !s.waiting ? ''
      : s.failing ? `<span class="ui-badge warn">${s.lastError || 'Not saved yet'}</span><button type="button" class="ui-btn small" data-sq-retry>Retry</button>`
      : '<span class="ui-hint">Saving…</span>';
    if (html !== shown) { el.innerHTML = html; shown = html; }
  });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-sq-retry]')) queue.flush(); });
  return el;
}
