/* COPY of sites/_shared/ai-protocol/updates-sheet.js — edit the source there and run node _shared/sync.mjs */
// The AI Updates page every app shares (ARCHITECTURE §8c): the same four cards everywhere.
// Source: sites/_shared/ai-protocol/ (edit there, then node _shared/sync.mjs).
// Uses the magic sheet's look (load magic.css and updates-sheet.css).
//
//   import { openUpdates, mountAiButton } from './vendor/ai-protocol/updates-sheet.js';
//   const open = () => openUpdates({
//     schema,                            // the app's ai/schema.js
//     context: () => ({ data }),         // the app's current state (synchronous, for iOS)
//     resolve: async item => ({ ok: true, text: 'Book MOT → House' })
//                       // or ({ ok: false, reason: 'Which recipe?', options: [{ value, label }] }),
//     apply: async (item, choice) => {}, // write it with the app's own functions; throw to report a failure
//     done: results => {},               // optional: redraw the app
//   });
//   mountAiButton(topBarElement, { app: schema.app, open });   // the ✨ AI button, with a badge
//
// The page, top to bottom (24 Nov 2026):
//   Waiting      parts of a reply pasted into another app, for this one (from the App Hub inbox)
//   Overall document update   "Update needed" (first, with Download, then Uploaded) or "Up to date"
//                             (after the app's card). Kept on the App Hub, so every device agrees.
//   <App> update this app's state, paste-sized (Copy, or Part 1, Part 2 …). With allApps (the App
//                Hub), every app, Food Planner and Life List first.
//   Paste        any reply: this app's part is checked here; every other app's part is sent on
// Linked to the App Hub (a hub key on this device) for 1, 2 and sending on; without it, the page
// offers this app's own state to copy, and the set-up.
//
// Rules it enforces: nothing is written until Apply; only ticked, valid, resolved actions
// run, in the block's order; a failure is reported and the rest still run; what applied is
// remembered on this device, so a second paste shows it as already applied (unticked).

import { processReply, appliedLog, contextBlock, APP_NAMES, shareContext, hubKey, setHubKey, lastShared,
  fetchPack, fetchInbox, clearInbox, forwardParts, inboxReply, downloadText, markUploaded } from './protocol.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = d => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SPARK = svg('<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/>');
const IC = {
  inbox: svg('<path d="M4 13h4l2 3h4l2-3h4"/><path d="M4 13l2.5-7h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>'),
  book: svg('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M8 7h7"/>'),
  day: svg('<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/><path d="M9 15h3v3"/>'),
  paste: svg('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12h6M9 16h4"/>'),
  down: svg('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  chev: svg('<path d="m6 9 6 6 6-6"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
};
/** "today", "yesterday" or "on Tue 11 Nov", by the device's own calendar. */
const day = iso => {
  const d = new Date(iso); if (!iso || Number.isNaN(+d)) return '';
  const n = Math.round((new Date().setHours(12, 0, 0, 0) - new Date(+d).setHours(12, 0, 0, 0)) / 864e5);
  return n === 0 ? 'today' : n === 1 ? 'yesterday' : `on ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
};
const names = ids => ids.map(a => APP_NAMES[a] ?? a);
const andList = l => l.length < 2 ? l.join('') : `${l.slice(0, -1).join(', ')} and ${l.at(-1)}`;

/**
 * The top of the AI Updates page, the same in every app: Waiting, 1 Reference, 2 Daily, the paste
 * card the caller passes in, and the App Hub link line. The sheet uses it, and so does an app with
 * a page of its own (Food Planner), so they look and behave the same.
 *   const home = aiHome({ schema, context, takes, render, onReview: item => … });
 *   el.innerHTML = home.html(pasteCardHtml);   el.onclick = e => home.click(e.target.closest('[data-au]'));
 *   home.load();                               // share this app's state, then fetch version, daily, waiting
 * @returns {{ html:(paste?:string)=>string, click:(b:Element|null)=>Promise<boolean>, load:()=>Promise<void>, drop:(id:string)=>Promise<void>, state:object }}
 */
export function aiHome(o) {
  const name = o.schema.name ?? o.schema.app;
  const app = o.schema.app;
  const takes = o.takes ?? !o.schema.contextOnly;
  const canShare = !!o.context && o.share !== false;
  const st = { linked: !!hubKey(), loading: true, meta: null, apps: [], waiting: [], packError: '', copied: '', downloaded: false, othersOpen: false, keyOpen: false, error: '', flash: '' };
  const render = () => o.render?.();
  const hub = o.hubBase ? { base: o.hubBase } : {};   // the App Hub's own page calls itself

  async function load() {
    st.linked = !!hubKey();
    if (!st.linked) { st.loading = false; return render(); }
    st.loading = true; st.packError = ''; render();
    if (canShare) await shareContext(o.schema, o.context, { force: true, notify: () => {} });
    try { await o.beforeDaily?.(); } catch { /* reference data is a nice-to-have */ }
    try {
      if (o.allApps) {
        const [all, waiting] = await Promise.all([fetchPack('apps', hub), takes ? fetchInbox(app, hub) : []]);
        st.meta = all; st.apps = all.apps ?? []; st.waiting = waiting;
      } else {
        const [meta, one, waiting] = await Promise.all([fetchPack('meta', hub), fetchPack('app', { ...hub, app }), takes ? fetchInbox(app, hub) : []]);
        st.meta = meta; st.apps = one.app ? [one.app] : []; st.waiting = waiting;
      }
    } catch (err) { st.packError = err?.message ?? String(err); }
    st.loading = false;
    render();
  }

  const card = (icon, title, text, action, extra = '', cls = '') => `<section class="au-card ${cls}">
      <span class="au-card-ic">${icon}</span>
      <div class="au-card-main"><h3>${title}</h3>${text ? `<p>${text}</p>` : ''}${extra}</div>
      ${action ? `<div class="au-card-act">${action}</div>` : ''}</section>`;

  const waitingView = () => st.waiting.map(w => card(IC.inbox, `Waiting for ${esc(name)}`,
    `${esc(w.summary || `${w.section?.actions?.length ?? 0} changes`)} · pasted in ${esc(APP_NAMES[w.from] ?? 'another app')} ${esc(day(w.received_at))}`,
    `<button type="button" class="mg-go" data-au="review" data-id="${esc(w.id)}">Review</button>`, '', 'au-wait')).join('');

  const needed = () => !!st.meta?.needed;

  /** "Overall document update": whether ChatGPT's file is current, and the steps when it isn't. */
  function overallView() {
    const title = 'Overall document update';
    if (!st.linked) return card(IC.book, title, 'Not linked', '');
    const m = st.meta;
    if (!m) return card(IC.book, title, st.loading ? 'Checking…' : '', '');
    if (!m.needed) {
      return card(IC.book, title, '', '', `<p class="au-status-ok">${IC.check}<span>Up to date</span></p>
        <p class="au-meta">Version ${esc(m.version)} · uploaded ${esc(day(m.uploaded?.at))}</p>`, 'au-overall');
    }
    const step = (n, text, btn = '') => `<li class="au-step"><span class="au-step-n">${n}</span><span class="au-step-t">${text}</span>${btn}</li>`;
    const steps = [
      step(1, 'Download the file', `<button type="button" class="${st.downloaded ? 'mg-ghost' : 'mg-go'}" data-au="download">${st.downloaded ? IC.check : IC.down}<span>${st.downloaded ? 'Downloaded' : 'Download'}</span></button>`),
      step(2, 'Replace it in ChatGPT’s AI Updates project'),
      ...(m.instructionsChanged && m.instructions ? [step(3, 'Paste into the project’s Instructions',
        `<button type="button" class="mg-ghost" data-au="instructions">${st.copied === 'instructions' ? IC.check : IC.copy}<span>${st.copied === 'instructions' ? 'Copied' : 'Copy'}</span></button>`)] : []),
    ];
    steps.push(step(steps.length + 1, 'Start a new chat', `<button type="button" class="${st.downloaded ? 'mg-go' : 'mg-ghost'}" data-au="uploaded">Done</button>`));
    return card(IC.book, title, '', '', `<p class="au-status-need">Update needed</p><ol class="au-steps">${steps.join('')}</ol>`, 'au-overall au-need');
  }

  /** One row per app: its name, when it last shared, and a Copy (or Part 1, Part 2 …). */
  function appRow(a) {
    const btn = (i, label) => {
      const key = `${a.id}:${i}`;
      return `<button type="button" class="mg-ghost" data-au="copy-part" data-app="${esc(a.id)}" data-i="${i}">${st.copied === key ? IC.check : IC.copy}<span>${st.copied === key ? 'Copied' : label}</span></button>`;
    };
    const btns = !a.parts.length ? '<span class="au-meta" data-state>Not shared yet</span>'
      : a.parts.length === 1 ? btn(0, 'Copy') : a.parts.map((_, i) => btn(i, `Part ${i + 1}`)).join('');
    const age = a.as_of ? day(a.as_of) : '';
    return `<li class="au-arow"><span class="au-arow-name">${esc(a.name)}${age ? `<small>${esc(age)}</small>` : ''}</span><span class="au-arow-btns">${btns}</span></li>`;
  }

  /** "<App> update" (one app), or "Individual app updates" (every app, on the App Hub). */
  function updatesView() {
    const title = o.allApps ? 'Individual app updates' : `${esc(name)} update`;
    if (!st.linked) {
      return card(IC.day, title, '',
        o.context ? `<button type="button" class="mg-go" data-au="copy-app">${IC.copy}<span>${st.copied === 'app' ? 'Copied' : 'Copy'}</span></button>` : '');
    }
    if (!st.apps.length) return card(IC.day, title, st.loading ? 'Getting…' : '', '');
    const first = st.apps.slice(0, o.allApps ? 2 : 1), rest = o.allApps ? st.apps.slice(2) : [];
    const list = `<ul class="au-apps">${first.map(appRow).join('')}</ul>${rest.length
      ? `<button type="button" class="au-more" data-au="others" aria-expanded="${st.othersOpen ? 'true' : 'false'}"><span>Other apps</span><small>${rest.length}</small>${IC.chev}</button>${
        st.othersOpen ? `<ul class="au-apps">${rest.map(appRow).join('')}</ul>` : ''}` : ''}`;
    return card(IC.day, title, '', '', list, 'au-updates');
  }

  /** The paste card's frame, for a caller that keeps its own textarea and button inside it. */
  const pasteCard = inner => card(IC.paste, 'Paste reply', '', '', inner, 'au-paste');

  function footView() {
    const last = canShare ? lastShared(app) : null;
    const line = !st.linked ? 'Not linked'
      : st.packError ? st.packError
      : last && !last.ok ? 'Last share failed, will retry'
      : 'Linked to the App Hub ✓';
    const form = st.keyOpen ? `<div class="au-key">
        <label class="mg-stack" for="au-key">App Hub key<input id="au-key" type="password" autocomplete="off" spellcheck="false" value=""></label>
        <div class="mg-actions">${st.linked ? '<button type="button" class="mg-ghost" data-au="key-forget">Unlink</button>' : ''}<button type="button" class="mg-go" data-au="key-save">Save key</button></div></div>` : '';
    return `<div class="au-foot"><span>${esc(line)}</span><span class="au-foot-btns">
        <button type="button" class="mg-link" data-au="key">${st.keyOpen ? 'Close' : st.linked ? 'Link settings' : 'Set up'}</button></span></div>${form}`;
  }

  const html = (paste = '') => `<div class="au-home">${st.flash ? `<p class="mg-note au-flash" role="status">${esc(st.flash)}</p>` : ''}${waitingView()}${
      needed() ? overallView() + updatesView() : updatesView() + overallView()}${paste}
      ${st.error ? `<p class="mg-error" role="alert">${esc(st.error)}</p>` : ''}${footView()}</div>`;

  async function drop(id) {
    st.waiting = st.waiting.filter(w => w.id !== id);
    try { await clearInbox(app, id, hub); } catch { /* it shows again next time; Dismiss clears it */ }
  }

  /** Handle a tap on one of the cards' buttons. true when it was one of ours. */
  async function click(b) {
    if (!b || b.disabled) return false;
    const a = b.dataset.au;
    const root = b.closest('.au-home') ?? document;
    const copy = async (text, what) => {
      try { await navigator.clipboard.writeText(text); st.copied = what; st.error = ''; }
      catch { st.error = 'Couldn’t copy. Your browser blocked it; try again.'; }
      render();
      setTimeout(() => { if (st.copied === what) { st.copied = ''; render(); } }, 2000);
    };
    if (a === 'copy-app') {
      try { const c = o.context(); await copy(contextBlock({ app, name, v: o.schema.v, data: c.data, note: c.note, contextOnly: !!o.schema.contextOnly }), 'app'); }
      catch (err) { st.error = err?.message ?? String(err); render(); }
      return true;
    }
    if (a === 'copy-part') {
      const it = st.apps.find(x => x.id === b.dataset.app), i = Number(b.dataset.i);
      if (it?.parts[i]) await copy(it.parts[i], `${it.id}:${i}`);
      return true;
    }
    if (a === 'others') { st.othersOpen = !st.othersOpen; render(); return true; }
    if (a === 'instructions') { if (st.meta?.instructions) await copy(st.meta.instructions, 'instructions'); return true; }
    if (a === 'download') {
      b.disabled = true;
      try {
        const ref = await fetchPack('reference', hub);
        downloadText(`AI-Updates-reference-${ref.version}.md`, ref.text);
        st.downloaded = ref.version; st.error = '';
        if (st.meta && st.meta.version !== ref.version) st.meta = { ...st.meta, version: ref.version };
      } catch (err) { st.error = err?.message ?? String(err); }
      render(); return true;
    }
    if (a === 'uploaded') {
      b.disabled = true;
      try {
        const v = typeof st.downloaded === 'string' ? st.downloaded : st.meta?.version;
        const r = await markUploaded(v, hub);
        st.meta = { ...st.meta, version: v, needed: r.needed, uploaded: r.uploaded, instructionsChanged: r.instructionsChanged };
        st.downloaded = false; st.error = '';
      } catch (err) { st.error = err?.message ?? String(err); }
      render(); return true;
    }
    if (a === 'review') { const w = st.waiting.find(x => x.id === b.dataset.id); if (w) await o.onReview?.(w); return true; }
    if (a === 'key') { st.keyOpen = !st.keyOpen; render(); if (st.keyOpen) document.querySelector('#au-key')?.focus({ preventScroll: true }); return true; }
    if (a === 'key-save') {
      const k = root.querySelector('#au-key')?.value ?? '';
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(k.trim())) { st.error = 'That doesn’t look like the App Hub key. Copy it again from the App Hub.'; render(); return true; }
      setHubKey(k); st.keyOpen = false; st.error = ''; await load(); return true;
    }
    if (a === 'key-forget') { setHubKey(''); st.keyOpen = false; st.meta = null; st.apps = []; st.waiting = []; await load(); return true; }
    return false;
  }

  return { html, pasteCard, click, load, drop, state: st };
}

/**
 * @param {object} o
 * @param {object} o.schema
 * @param {() => {data:object, note?:string}} [o.context]
 * @param {(item:object) => Promise<{ok:boolean, text?:string, reason?:string, options?:{value:string,label:string}[]}>} [o.resolve]
 * @param {(item:object, choice?:string) => Promise<any>} [o.apply]
 * @param {(results:object[]) => void} [o.done]
 * @param {string} [o.text]  a reply to start with (e.g. from a share or link)
 * @param {boolean} [o.share]  false: don't share this app's state with the App Hub (the App Hub itself)
 * @param {() => Promise<any>} [o.beforeDaily]  optional: anything else to send the App Hub first (e.g. reference data)
 * @param {object} [o.log]   appliedLog override (tests)
 * @returns {Promise<object[]|null>}
 */
export function openUpdates(o) {
  const name = o.schema.name ?? o.schema.app;
  const app = o.schema.app;
  const log = o.log ?? appliedLog(app);
  const takes = !o.schema.contextOnly && typeof o.apply === 'function';
  return new Promise(resolveSheet => {
    const opener = document.activeElement;
    const st = { reply: o.text ?? '', result: null, error: '', busy: false, rows: [], results: null, fromInbox: null, forwarded: null };
    const canShare = !!o.context && o.share !== false;

    const wrap = document.createElement('div');
    wrap.className = 'mg-scrim';
    wrap.innerHTML = `<div class="mg-sheet au-sheet" role="dialog" aria-modal="true" aria-labelledby="au-title">
      <div class="mg-head"><span class="mg-badge">${SPARK}</span><h2 id="au-title">AI Updates <span class="au-app">· ${esc(name)}</span></h2>
        <button type="button" class="mg-x" data-au="close" aria-label="Close">${(window.uiIcon && window.uiIcon('x')) || '✕'}</button></div>
      <div class="mg-body"></div></div>`;
    document.body.append(wrap);
    const body = wrap.querySelector('.mg-body');

    let closed = false;
    const close = (val = null) => {
      if (closed) return; closed = true;
      wrap.remove(); document.removeEventListener('keydown', onKey, true);
      if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
      resolveSheet(val);
    };
    const onKey = e => { if (e.key === 'Escape' && !st.busy) { e.stopPropagation(); close(st.results); } };
    document.addEventListener('keydown', onKey, true);

    const home = aiHome({ ...o, takes, render: () => { if (!closed) render(); }, onReview: w => check(w, inboxReply(app, w)) });
    const load = () => home.load();

    const statusLabel = { ready: '', duplicate: 'Already applied on this device', invalid: 'Can’t apply', unknown: 'Not something this app does' };

    function rowHtml(r, i) {
      const it = r.item;
      const can = r.selectable;
      const status = it.status !== 'ready' ? statusLabel[it.status] : (r.resolved && !r.resolved.ok && !r.choice ? (r.resolved.reason || 'Needs a choice') : '');
      const lines = [];
      if (it.text || r.resolved?.text) lines.push(esc(r.resolved?.text || it.text));
      if (it.errors.length) lines.push(...it.errors.map(e => `<span class="au-err">${esc(e)}</span>`));
      const pick = r.resolved && !r.resolved.ok && r.resolved.options?.length
        ? `<select data-au-choice="${i}" aria-label="Choose for this action"><option value="">Choose…</option>${r.resolved.options.map(op =>
            `<option value="${esc(op.value)}" ${String(op.value) === String(r.choice ?? '') ? 'selected' : ''}>${esc(op.label)}</option>`).join('')}</select>` : '';
      const res = st.results?.[i];
      const outcome = res ? `<span class="${res.ok ? 'au-ok' : 'au-err'}">${res.ok ? 'Applied ✓' : esc(`Failed: ${res.error}`)}</span>` : '';
      return `<li class="au-row ${can ? '' : 'au-off'}">
        <label class="check top"><input type="checkbox" data-au-tick="${i}" ${r.ticked ? 'checked' : ''} ${can && !st.results ? '' : 'disabled'}>
          <span><b>${esc(it.title || it.type)}</b>${status ? ` <span class="au-status">${esc(status)}</span>` : ''}
          ${lines.length ? `<small>${lines.join('<br>')}</small>` : ''}${pick}${outcome}</span></label></li>`;
    }

    function othersView() {
      const f = st.forwarded;
      if (!f) return '';
      const out = [];
      if (f.sent.length) out.push(`Sent to ${esc(andList(names(f.sent)))}`);
      if (f.failed.length) out.push(f.reason === 'no-key'
        ? `Also for ${esc(andList(names(f.failed)))}: paste it there`
        : `Couldn’t send on to ${esc(andList(names(f.failed)))}. Paste the same reply there.`);
      return out.length ? `<p class="mg-note au-sent">${out.join('<br>')}</p>` : '';
    }

    function resultView() {
      const r = st.result;
      const n = st.rows.filter(x => x.ticked).length;
      const applied = !!st.results;
      return `${r.summary ? `<p class="au-summary">${esc(r.summary)}</p>` : ''}
        ${st.fromInbox ? `<p class="mg-note">Pasted in ${esc(APP_NAMES[st.fromInbox.from] ?? 'another app')} ${esc(day(st.fromInbox.received_at))}.</p>` : ''}
        ${r.stillOpen.length ? `<div class="au-open"><b>Still open</b><ul>${r.stillOpen.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${r.note ? `<p class="mg-note au-note">${esc(r.note)}</p>` : ''}
        ${st.rows.length ? `<ul class="au-list">${st.rows.map(rowHtml).join('')}</ul>` : ''}
        ${othersView()}
        ${st.error ? `<p class="mg-error" role="alert">${esc(st.error)}</p>` : ''}
        ${st.busy ? '<p class="mg-status" role="status"><i></i><span>Applying…</span></p>' : ''}
        <div class="mg-actions">${applied || !st.rows.length
          ? `${st.fromInbox && !applied ? '<button type="button" class="mg-ghost" data-au="dismiss">Dismiss it</button>' : ''}<button type="button" class="mg-go" data-au="${applied ? 'finish' : 'back'}">${applied ? 'Done' : 'Back'}</button>`
          : `<button type="button" class="mg-ghost" data-au="${st.fromInbox ? 'dismiss' : 'back'}">${st.fromInbox ? 'Dismiss it' : 'Back'}</button>
             <button type="button" class="mg-go" data-au="apply" ${n && !st.busy ? '' : 'disabled'}>Apply ${n} ${n === 1 ? 'change' : 'changes'}</button>`}</div>`;
    }

    function render() {
      const sheet = wrap.querySelector('.mg-sheet');
      const y = sheet.scrollTop;
      body.innerHTML = st.result ? resultView() : home.html(home.pasteCard(`<textarea id="au-reply" rows="5" aria-label="Reply">${esc(st.reply)}</textarea>
          <div class="mg-actions"><button type="button" class="mg-go" data-au="check">Check it</button></div>`));
      sheet.scrollTop = y;
    }

    async function check(fromInbox = null, text = st.reply) {
      st.error = ''; st.forwarded = null; st.fromInbox = fromInbox; home.state.flash = '';
      let r;
      try { r = processReply(text, o.schema, { log }); }
      catch (err) { st.error = err?.message ?? String(err); return render(); }
      if (!r.ok) { st.error = r.error; return render(); }
      if (!takes && !r.note) r.note = `${name} takes no changes itself.`;
      st.result = r;
      st.rows = takes ? r.items.map(item => ({ item, resolved: null, choice: undefined, ticked: false, selectable: false })) : [];
      render();
      if (!fromInbox && !r.legacy) {
        forwardParts(r.envelope, app).then(f => { st.forwarded = f; if (!closed) render(); });
      }
      for (const row of st.rows) {
        if (row.item.status === 'invalid' || row.item.status === 'unknown') continue;
        try { row.resolved = o.resolve ? await o.resolve(row.item) : { ok: true }; }
        catch (err) { row.resolved = { ok: false, reason: err?.message ?? String(err) }; }
        row.selectable = row.resolved.ok || !!row.resolved.options?.length;
        row.ticked = row.resolved.ok && row.item.status === 'ready';
      }
      render();
    }

    const dropWaiting = id => home.drop(id);

    async function apply() {
      st.busy = true; st.error = ''; render();
      const results = [];
      for (const row of st.rows) {
        if (!row.ticked) { results.push(null); continue; }
        try {
          const value = await o.apply(row.item, row.choice);
          log.add(row.item.fingerprint);
          results.push({ ok: true, item: row.item, value });
        } catch (err) {
          results.push({ ok: false, item: row.item, error: err?.message ?? String(err) });
        }
      }
      st.busy = false; st.results = results;
      const failed = results.filter(x => x && !x.ok).length;
      if (failed) st.error = `${failed} didn’t apply. The rest did.`;
      if (st.fromInbox && !failed) dropWaiting(st.fromInbox.id);
      render();
      try { o.done?.(results.filter(Boolean)); } catch { /* the app's redraw shouldn't break the sheet */ }
      if (results.some(x => x?.ok) && canShare) shareContext(o.schema, o.context, { force: true, notify: () => {} });
    }

    const goHome = (flash = '') => { st.result = null; st.rows = []; st.results = null; st.error = ''; st.fromInbox = null; st.forwarded = null; home.state.flash = flash; render(); };

    wrap.addEventListener('click', async e => {
      if (e.target === wrap && !st.busy) return close(st.results);
      const b = e.target.closest('[data-au]'); if (!b || b.disabled) return;
      const a = b.dataset.au;
      if (a === 'close') return close(st.results);
      if (a === 'finish') { if (st.results?.some(x => x?.ok)) load(); return goHome(); }
      if (await home.click(b)) return;
      if (a === 'dismiss') { const id = st.fromInbox?.id; if (id) await dropWaiting(id); return goHome('Dismissed. Nothing was changed.'); }
      if (a === 'check') { st.reply = body.querySelector('#au-reply')?.value ?? ''; return check(); }
      if (a === 'back') return goHome();
      if (a === 'apply') return apply();
    });
    wrap.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.auTick !== undefined) {
        const row = st.rows[+t.dataset.auTick];
        if (row.resolved && !row.resolved.ok && !row.choice) { t.checked = false; st.error = 'Choose which one first.'; return render(); }
        row.ticked = t.checked; st.error = ''; return render();
      }
      if (t.dataset.auChoice !== undefined) {
        const row = st.rows[+t.dataset.auChoice];
        row.choice = t.value || undefined; row.ticked = !!row.choice; st.error = ''; return render();
      }
    });
    wrap.addEventListener('input', e => { if (e.target.id === 'au-reply') st.reply = e.target.value; });

    render();
    load();
    if (st.reply.trim()) check();
  });
}

/**
 * The ✨ AI button for an app's top bar: opens the page, and shows a count when parts of a reply
 * pasted elsewhere are waiting for this app. Same look in every app (updates-sheet.css).
 * @returns {{button: HTMLButtonElement, refresh: () => Promise<number>}}
 */
export function mountAiButton(container, { app, open, label = 'AI', className = '' }) {
  const button = document.createElement('button');
  button.type = 'button';
  // className: the app's own button classes (e.g. 'ui-btn', 'ui-btn small') so the ✨ AI button is the same size and
  // shape as the buttons beside it (18 Nov 2026, Finance Centre's header). Without it, the old pill below.
  button.className = ('au-btn ' + className).trim();
  button.setAttribute('aria-label', 'AI Updates');
  button.innerHTML = `${SPARK}<span>${esc(label)}</span><b class="au-dot" hidden></b>`;
  const dot = button.querySelector('.au-dot');
  const refresh = async () => {
    let n = 0;
    if (hubKey()) { try { n = (await fetchInbox(app)).length; } catch { /* offline: no badge */ } }
    dot.hidden = !n; dot.textContent = String(n);
    button.setAttribute('aria-label', n ? `AI Updates, ${n} waiting` : 'AI Updates');
    return n;
  };
  button.addEventListener('click', async () => { await open(); refresh(); });
  container.append(button);
  refresh();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  return { button, refresh };
}

/** Copy an app's context to the clipboard without opening the sheet. Call inside the tap. */
export async function copyContext(schema, context) {
  const c = context();
  await navigator.clipboard.writeText(contextBlock({ app: schema.app, name: schema.name ?? schema.app, v: schema.v, data: c.data, note: c.note, contextOnly: !!schema.contextOnly }));
}
