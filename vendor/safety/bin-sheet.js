/* COPY of sites/_shared/safety/bin-sheet.js — edit the source there and run node _shared/sync.mjs */
// The safety net's two sheets, the same in every app (Round 2 of the 18 Nov 2026 app review):
//   openBin()     — Recently deleted: what was deleted in the last 30 days, each with Restore.
//   openRestore() — Restore from backup: pick a backup file, see what it would ADD, add it. Never overwrites.
// Both are <dialog class="ui-sheet"> built from the shared ui- classes (chassis/components.css), with the
// shared icons when the app has them (uiIcon). They redraw only their own body, so the page behind never
// moves. An ES module; a classic-script app loads it with <script type="module"> and puts it on window.
//
//   import { openBin, openRestore } from './vendor/safety/bin-sheet.js';
//   const n = await openBin({
//     load: () => fetch('/api/bin').then(r => r.json()),                  // [{ id, kind, label, deleted_at }]
//     restore: (e) => fetch(`/api/bin/${e.id}/restore`, { method: 'POST' }).then(r => r.json()), // { ok } | { error }
//     forget: (e) => fetch(`/api/bin/${e.id}`, { method: 'DELETE' }).then(r => r.json()),       // optional
//     kinds: { round: 'Round' },                                           // optional nicer kind names
//   });
//   if (n) refresh();   // n = how many were restored
//
//   await openRestore({
//     read: async (file) => JSON.parse(await file.text()),                  // the backup, as the app wrote it
//     plan: async (backup) => restoreMissingAll(await current(), backup, { places: p => p.id }),
//     names: { places: ['place', 'places'] },
//     apply: async (plan) => post('/api/restore', { places: plan.places.add }),  // { ok } | { error }
//   });

import { binAge, countWords } from './bin.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name) => (typeof window !== 'undefined' && typeof window.uiIcon === 'function' ? window.uiIcon(name) : '');
const fail = (e) => (e && e.message && !/fetch|network|load failed/i.test(e.message) ? e.message : "Couldn't reach the app. Check your connection and try again.");

function sheet(title) {
  const d = document.createElement('dialog');
  d.className = 'ui-sheet';
  d.innerHTML = `<header><h2>${esc(title)}</h2><button type="button" class="ui-btn quiet icon small" data-x aria-label="Close">${icon('x') || '✕'}</button></header>
    <div class="body"></div>`;
  document.body.append(d);
  const opener = document.activeElement;
  const done = new Promise((resolve) => {
    d.addEventListener('close', () => {
      d.remove();
      if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
      resolve();
    });
  });
  d.querySelector('[data-x]').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });   // tap outside
  d.showModal();
  return { d, body: d.querySelector('.body'), done };
}

/** Recently deleted. Resolves with how many things were restored. */
export async function openBin({ title = 'Recently deleted', load, restore, forget, kinds = {} }) {
  const { body, done } = sheet(title);
  const st = { list: null, error: '', busy: null, restored: 0, note: '' };
  const draw = () => {
    if (st.list === null && !st.error) { body.innerHTML = `<p class="ui-hint">Loading…</p>`; return; }
    const top = `<p class="ui-hint">Things you delete are kept here for 30 days, then they go for good.</p>
      ${st.note ? `<p class="ui-note good">${esc(st.note)}</p>` : ''}${st.error ? `<p class="ui-note bad">${esc(st.error)}</p>` : ''}`;
    if (!st.list?.length) {
      body.innerHTML = `${top}<div class="ui-empty"><span class="icon">${icon('trash')}</span><strong>Nothing deleted lately</strong><span>Anything deleted in the last 30 days shows here.</span></div>`;
      return;
    }
    body.innerHTML = `${top}<ul class="ui-list">${st.list.map((e) => {
      const age = binAge(e);
      const kind = kinds[e.kind] ?? (e.kind ? e.kind[0].toUpperCase() + e.kind.slice(1) : '');
      const busy = st.busy === e.id;
      return `<li class="ui-row"><span class="main"><span>${esc(e.label || kind)}</span>
        <span class="sub">${esc(kind)}${kind ? ' · ' : ''}deleted ${esc(age.ago)} · ${esc(age.left)}</span></span>
        ${forget ? `<button type="button" class="ui-btn quiet icon small" data-forget="${esc(e.id)}" aria-label="Delete for good" title="Delete for good" ${st.busy ? 'disabled' : ''}>${icon('trash') || '×'}</button>` : ''}
        <button type="button" class="ui-btn small" data-restore="${esc(e.id)}" ${st.busy ? 'disabled' : ''}>${busy ? 'Restoring…' : 'Restore'}</button></li>`;
    }).join('')}</ul>`;
  };
  const refresh = async () => {
    try { st.list = await load(); st.error = ''; } catch (e) { st.list = st.list ?? []; st.error = fail(e); }
    draw();
  };
  body.addEventListener('click', async (ev) => {
    const r = ev.target.closest('[data-restore]'), f = ev.target.closest('[data-forget]');
    const id = r?.dataset.restore ?? f?.dataset.forget;
    if (!id || st.busy) return;
    const e = st.list.find((x) => String(x.id) === id);
    if (!e) return;
    if (f) {
      const name = e.label || e.kind;
      // The shared sheet when the app loads chassis ui.js (RULES K5); the browser's box only where it doesn't.
      const sure = typeof globalThis.uiConfirm === 'function'
        ? await globalThis.uiConfirm({ title: `Delete "${name}" for good?`, body: 'It can\'t be brought back.', ok: 'Delete for good', cancel: 'Keep it', danger: true })
        : confirm(`Delete "${name}" for good? It can't be brought back.`);
      if (!sure) return;
    }
    st.busy = id; st.error = ''; st.note = ''; draw();
    try {
      const res = await (r ? restore(e) : forget(e));
      if (res && res.error) throw new Error(res.error);
      st.list = st.list.filter((x) => x !== e);
      if (r) { st.restored++; st.note = `Restored: ${e.label || e.kind}.`; }
    } catch (err) { st.error = fail(err); }
    st.busy = null; draw();
  });
  draw();
  refresh();
  await done;
  return st.restored;
}

/** Restore from backup: adds only what's missing. Resolves true if anything was added. */
export async function openRestore({ title = 'Restore from a backup', read, plan, apply, names = {}, accept = '.json,application/json' }) {
  const { body, done } = sheet(title);
  const st = { step: 'pick', plan: null, error: '', busy: false, added: false };
  const total = () => Object.values(st.plan ?? {}).reduce((a, v) => a + v.add.length, 0);
  const already = () => Object.values(st.plan ?? {}).reduce((a, v) => a + v.already, 0);
  const draw = () => {
    const err = st.error ? `<p class="ui-note bad">${esc(st.error)}</p>` : '';
    if (st.step === 'pick') {
      body.innerHTML = `<p>Pick a backup file this app made. You'll see what it would add before anything changes.</p>
        <p class="ui-hint">It only adds things that aren't here now. Nothing here is changed or deleted, so an old backup can't undo newer work.</p>
        ${err}<div class="ui-actions"><label class="ui-btn primary">${icon('upload')}Choose backup file<input type="file" accept="${esc(accept)}" hidden data-file></label></div>`;
    } else if (st.step === 'plan') {
      const n = total();
      body.innerHTML = n
        ? `<p>This backup has <strong>${esc(countWords(st.plan, names))}</strong> that ${n === 1 ? "isn't" : "aren't"} here now.</p>
           <p class="ui-hint">${already()} already here ${already() === 1 ? 'is' : 'are'} left exactly as ${already() === 1 ? 'it is' : 'they are'}.</p>
           ${err}<div class="ui-actions"><button type="button" class="ui-btn primary" data-apply ${st.busy ? 'disabled' : ''}>${st.busy ? 'Adding…' : `Add ${n === 1 ? 'it' : `these ${n}`}`}</button>
           <button type="button" class="ui-btn" data-back ${st.busy ? 'disabled' : ''}>Pick another file</button></div>`
        : `<p class="ui-note good">Everything in this backup is already here. Nothing to add.</p>
           <div class="ui-actions"><button type="button" class="ui-btn" data-back>Pick another file</button></div>`;
    } else {
      body.innerHTML = `<p class="ui-note good">Added ${esc(countWords(st.plan, names))}.</p>
        <div class="ui-actions"><button type="button" class="ui-btn primary" data-close>Done</button></div>`;
    }
  };
  body.addEventListener('change', async (ev) => {
    const input = ev.target.closest('[data-file]');
    if (!input?.files?.[0]) return;
    st.error = '';
    try {
      const backup = await read(input.files[0]);
      st.plan = await plan(backup);
      st.step = 'plan';
    } catch (e) { st.error = e?.message ? `That file can't be used: ${e.message}` : "That file can't be used."; }
    draw();
  });
  body.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-back]')) { st.step = 'pick'; st.plan = null; st.error = ''; draw(); return; }
    if (ev.target.closest('[data-close]')) { body.closest('dialog').close(); return; }
    if (!ev.target.closest('[data-apply]') || st.busy) return;
    st.busy = true; st.error = ''; draw();
    try {
      const res = await apply(st.plan);
      if (res && res.error) throw new Error(res.error);
      st.step = 'done'; st.added = true;
    } catch (e) { st.error = fail(e); }
    st.busy = false; draw();
  });
  draw();
  await done;
  return st.added;
}
