/* COPY of sites/_shared/ai-protocol/updates-sheet.js — edit the source there and run node _shared/sync.mjs */
// The AI Updates sheet: paste ChatGPT's reply, check what it would do, tick, Apply.
// Source: sites/_shared/ai-protocol/ (edit there, then node _shared/sync.mjs).
// Uses the magic sheet's look (load magic.css and updates-sheet.css).
//
//   import { openUpdates } from './vendor/ai-protocol/updates-sheet.js';
//   openUpdates({
//     schema,                            // the app's ai/schema.js
//     context: () => ({ data }),         // optional: shows "Copy for ChatGPT" (synchronous, for iOS)
//     resolve: async item => ({ ok: true, text: 'Book MOT → House' })
//                       // or ({ ok: false, reason: 'Which recipe?', options: [{ value, label }] }),
//     apply: async (item, choice) => {}, // write it with the app's own functions; throw to report a failure
//     done: results => {},               // optional: redraw the app
//   });
//
// Rules it enforces: nothing is written until Apply; only ticked, valid, resolved actions
// run, in the block's order; a failure is reported and the rest still run; what applied is
// remembered on this device, so a second paste shows it as already applied (unticked).

import { processReply, appliedLog, contextBlock, APP_NAMES } from './protocol.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';

/**
 * @param {object} o
 * @param {object} o.schema
 * @param {() => {data:object, note?:string}} [o.context]
 * @param {(item:object) => Promise<{ok:boolean, text?:string, reason?:string, options?:{value:string,label:string}[]}>} [o.resolve]
 * @param {(item:object, choice?:string) => Promise<any>} o.apply
 * @param {(results:object[]) => void} [o.done]
 * @param {string} [o.text]  a reply to start with (e.g. from a share or link)
 * @param {object} [o.log]   appliedLog override (tests)
 * @returns {Promise<object[]|null>}
 */
export function openUpdates(o) {
  const name = o.schema.name ?? o.schema.app;
  const log = o.log ?? appliedLog(o.schema.app);
  return new Promise(resolveSheet => {
    const opener = document.activeElement;
    const st = { reply: o.text ?? '', result: null, error: '', copied: false, busy: false, rows: [], results: null };

    const wrap = document.createElement('div');
    wrap.className = 'mg-scrim';
    wrap.innerHTML = `<div class="mg-sheet au-sheet" role="dialog" aria-modal="true" aria-labelledby="au-title">
      <div class="mg-head"><span class="mg-badge">${ICON}</span><h2 id="au-title">AI Updates for ${esc(name)}</h2>
        <button type="button" class="mg-x" data-au="close" aria-label="Close">✕</button></div>
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

    const statusLabel = { ready: '', duplicate: 'Already applied on this device', invalid: 'Can’t apply', unknown: 'Not something this app does' };

    function pasteView() {
      return `${o.context ? `<div class="mg-actions mg-split"><span class="mg-note">Starting a conversation? Give ChatGPT ${esc(name)}’s current state first.</span>
          <button type="button" class="mg-ghost" data-au="copy">${st.copied ? 'Copied ✓' : 'Copy for ChatGPT'}</button></div>` : ''}
        <label class="mg-stack" for="au-reply">Paste ChatGPT’s whole reply<textarea id="au-reply" rows="6" placeholder="The reply with the AI Updates block…">${esc(st.reply)}</textarea></label>
        <div class="mg-actions mg-split"><span class="mg-note">Nothing changes until you tick and apply.</span>
          <button type="button" class="mg-go" data-au="check">Check it</button></div>`;
    }

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

    function resultView() {
      const r = st.result;
      const others = r.others.map(a => APP_NAMES[a] ?? a);
      const n = st.rows.filter(x => x.ticked).length;
      const applied = !!st.results;
      return `${r.summary ? `<p class="au-summary">${esc(r.summary)}</p>` : ''}
        ${r.legacy ? '<p class="mg-note">This is an older-style block (v6). It still works.</p>' : ''}
        ${r.stillOpen.length ? `<div class="au-open"><b>Still open</b><ul>${r.stillOpen.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${r.note ? `<p class="mg-note au-note">${esc(r.note)}</p>` : ''}
        ${st.rows.length ? `<ul class="au-list">${st.rows.map(rowHtml).join('')}</ul>` : ''}
        ${others.length ? `<p class="mg-note">Also in this block: ${esc(others.join(', '))}. Paste the same reply there.</p>` : ''}
        ${st.error ? `<p class="mg-error" role="alert">${esc(st.error)}</p>` : ''}
        ${st.busy ? '<p class="mg-status" role="status"><i></i><span>Applying…</span></p>' : ''}
        <div class="mg-actions">${applied
          ? `<button type="button" class="mg-go" data-au="finish">Done</button>`
          : `<button type="button" class="mg-ghost" data-au="back">Paste another</button>
             ${st.rows.length ? `<button type="button" class="mg-go" data-au="apply" ${n && !st.busy ? '' : 'disabled'}>Apply ${n} ${n === 1 ? 'change' : 'changes'}</button>` : ''}`}</div>`;
    }

    function render() {
      const y = wrap.querySelector('.mg-sheet').scrollTop;
      body.innerHTML = st.result ? resultView() : `${pasteView()}${st.error ? `<p class="mg-error" role="alert">${esc(st.error)}</p>` : ''}`;
      wrap.querySelector('.mg-sheet').scrollTop = y;
    }

    async function check() {
      st.error = '';
      let r;
      try { r = processReply(st.reply, o.schema, { log }); }
      catch (err) { st.error = err?.message ?? String(err); return render(); }
      if (!r.ok) { st.error = r.error; return render(); }
      st.result = r;
      st.rows = r.items.map(item => ({ item, resolved: null, choice: undefined, ticked: false, selectable: false }));
      render();
      for (const row of st.rows) {
        if (row.item.status === 'invalid' || row.item.status === 'unknown') continue;
        try { row.resolved = o.resolve ? await o.resolve(row.item) : { ok: true }; }
        catch (err) { row.resolved = { ok: false, reason: err?.message ?? String(err) }; }
        row.selectable = row.resolved.ok || !!row.resolved.options?.length;
        row.ticked = row.resolved.ok && row.item.status === 'ready';
      }
      render();
    }

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
      render();
      try { o.done?.(results.filter(Boolean)); } catch { /* the app's redraw shouldn't break the sheet */ }
    }

    wrap.addEventListener('click', async e => {
      if (e.target === wrap && !st.busy) return close(st.results);
      const b = e.target.closest('[data-au]'); if (!b || b.disabled) return;
      const a = b.dataset.au;
      if (a === 'close' || a === 'finish') return close(st.results);
      if (a === 'copy') {
        let text;
        try { const c = o.context(); text = contextBlock({ app: o.schema.app, name, v: o.schema.v, data: c.data, note: c.note }); }
        catch (err) { st.error = err?.message ?? String(err); return render(); }
        try { await navigator.clipboard.writeText(text); st.copied = true; st.error = ''; }
        catch { st.error = 'Couldn’t copy. Your browser blocked it; try again.'; }
        return render();
      }
      if (a === 'check') { st.reply = body.querySelector('#au-reply')?.value ?? ''; return check(); }
      if (a === 'back') { st.result = null; st.rows = []; st.error = ''; return render(); }
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
    if (st.reply.trim()) check();
    else body.querySelector('#au-reply')?.focus({ preventScroll: true });
  });
}

/** Copy an app's context to the clipboard without opening the sheet. Call inside the tap. */
export async function copyContext(schema, context) {
  const c = context();
  await navigator.clipboard.writeText(contextBlock({ app: schema.app, name: schema.name ?? schema.app, v: schema.v, data: c.data, note: c.note }));
}
