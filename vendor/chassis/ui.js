/* COPY of sites/_shared/chassis/ui.js — edit the source there and run node _shared/sync.mjs */
/* The small jobs every app does, done one way: toasts, questions, busy buttons, copy, share, download.

   Source: sites/_shared/chassis/ui.js (copied into each app with the chassis by node _shared/sync.mjs).
   From the behaviour audit of 21 Nov 2026 (briefs/same-job-audit.html): about 20 apps had written their own
   toast(), nine their own confirm sheet (askConfirm, confirmModal, dialog, ask, ConfirmModal, dlg…), and
   113 calls to the browser's own confirm()/alert()/prompt() were left, which a home-screen app can
   suppress and which read OK/Cancel when Cancel means something. Built from Life Kanban's showToast (works
   over an open sheet), Holiday Tracker's askConfirm (type the name for a big delete) and Food Planner's
   ask() (every choice a labelled button). The rules for when to use which are in _shared/README.md,
   "Same job, same way".

   Load as a plain script after icons.js (<script src="vendor/chassis/ui.js"></script>), or import it once
   for its side effect in a bundled app. Its look is all existing ui- classes; it adds no CSS.

     uiToast('Saved')                                       a quiet note, about 2.5s
     uiToast('Deleted Swim shorts', { undo: () => put(back) })   with Undo, about 6s
     uiToast("Couldn't save. Are you offline?", { bad: true })   red, read out, about 5s
     uiToast('Copied the list', { action: { label: 'Open', fn } })

     if (await uiConfirm({ title: 'Delete Harry?', body: 'This removes Harry and all 12 bookings…',
                           ok: 'Delete person', type: 'Harry' })) …   // type: they type the name first

     const v = await uiAsk({ title: 'Leave without saving?', buttons: [
       { label: 'Keep editing', value: null }, { label: 'Throw away changes', value: 'drop', danger: true } ] });
     const name = await uiAsk({ title: 'Rename list', input: { label: 'Name', value: list.name },
       buttons: [{ label: 'Cancel', value: null }, { label: 'Save', value: true, primary: true }] });   // → the text

     await uiBusy(button, () => api.save(x), { doing: 'Saving…', done: 'Saved' })
     await uiCopy(text, { button })                          // the button says "Copied" for a moment
     await uiShare({ title, text, url, files })              // the share sheet, else download / copy
     uiDownload('house-book-backup-2026-11-21.json', data)   // an object becomes pretty JSON
*/
(function (g) {
  'use strict';
  if (g.uiToast) return;
  const doc = g.document;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const icon = (n) => (g.uiIcon ? g.uiIcon(n) : '');
  const topSheet = () => { const open = [...doc.querySelectorAll('dialog[open]')]; return open[open.length - 1] || null; };

  // ── Toast ────────────────────────────────────────────────────────────────────
  // One at a time. While a sheet is open it goes INSIDE the sheet as a manual popover, or it would sit
  // under the sheet and its Undo couldn't be tapped (components.css, "A toast while a sheet is open").
  let toastTimer = 0;
  function uiToast(msg, o) {
    o = o || {};
    doc.querySelectorAll('.ui-toast[data-ui-toast]').forEach((t) => t.remove());
    clearTimeout(toastTimer);
    const el = doc.createElement('div');
    el.className = 'ui-toast' + (o.bad ? ' bad' : '');
    el.dataset.uiToast = '';
    el.setAttribute('role', o.bad ? 'alert' : 'status');
    el.append(doc.createTextNode(msg));
    const action = o.undo ? { label: 'Undo', fn: o.undo } : o.action;
    if (action) {
      const b = doc.createElement('button');
      b.type = 'button'; b.textContent = action.label;
      b.addEventListener('click', () => { el.remove(); clearTimeout(toastTimer); action.fn(); });
      el.append(b);
    }
    const sheet = topSheet();
    if (sheet && el.showPopover) { el.popover = 'manual'; sheet.append(el); el.showPopover(); }
    else doc.body.append(el);
    toastTimer = setTimeout(() => el.remove(), o.ms || (action ? 6000 : o.bad ? 5000 : 2500));
    return el;
  }

  // ── Questions ────────────────────────────────────────────────────────────────
  // A sheet of its own, on top of whatever is open, so closing it leaves the sheet underneath as it was.
  // Every answer is a button that says what it does. Esc, ✕ and the backdrop answer null.
  let seq = 0;
  function uiAsk(o) {
    o = o || {};
    const buttons = o.buttons || [{ label: 'OK', value: true, primary: true }];
    return new Promise((resolve) => {
      const id = 'ui-ask-' + ++seq;
      const d = doc.createElement('dialog');
      d.className = 'ui-sheet ui-ask';
      d.setAttribute('aria-labelledby', id + '-t');
      const choice = buttons.some((b) => b.sub);
      const btn = (b, i) => `<button type="button" class="ui-btn${choice ? ' choice' : ''}${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}" data-i="${i}">${
        choice ? `<strong>${esc(b.label)}</strong>${b.sub ? `<small>${esc(b.sub)}</small>` : ''}` : esc(b.label)}</button>`;
      const inp = o.input;
      const typed = o.type ? `<label class="ui-field"><span>Type “${esc(o.type)}” to confirm</span><input class="ui-input" data-type autocomplete="off" autocapitalize="off" spellcheck="false"></label>` : '';
      d.innerHTML = `<header><h2 id="${id}-t">${esc(o.title || '')}</h2>
          <button class="ui-btn quiet icon small" type="button" data-x aria-label="Close">${icon('x') || '×'}</button></header>
        <div class="body">${o.body ? `<p>${esc(o.body)}</p>` : ''}
          ${inp ? `<label class="ui-field"><span>${esc(inp.label || 'Name')}</span><input class="ui-input" data-in value="${esc(inp.value || '')}" autocomplete="off"${inp.inputmode ? ` inputmode="${esc(inp.inputmode)}"` : ''}></label>` : ''}
          ${typed}${choice ? `<div class="ui-stack">${buttons.map(btn).join('')}</div>` : ''}</div>
        ${choice ? '' : `<footer class="ui-actions end">${buttons.map(btn).join('')}</footer>`}`;
      let done = false;
      const finish = (v) => { if (done) return; done = true; if (d.open) d.close(); d.remove(); resolve(v); };
      const field = d.querySelector('[data-in]'), check = d.querySelector('[data-type]');
      const answer = (b) => {
        if (b.value == null) return finish(null);
        if (field) { const t = field.value.trim(); return finish(t ? t : null); }
        finish(b.value);
      };
      d.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
      d.addEventListener('click', (e) => {
        if (e.target === d || e.target.closest('[data-x]')) return finish(null);
        const b = e.target.closest('[data-i]'); if (b && !b.disabled) answer(buttons[+b.dataset.i]);
      });
      if (check) {
        const gated = [...d.querySelectorAll('[data-i]')].filter((b) => buttons[+b.dataset.i].value != null);
        const sync = () => gated.forEach((b) => { b.disabled = check.value.trim().toLowerCase() !== String(o.type).trim().toLowerCase(); });
        check.addEventListener('input', sync); sync();
      }
      (field || check)?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const i = buttons.findIndex((b) => b.primary || b.danger);
        const el = d.querySelector(`[data-i="${i}"]`);
        if (el && !el.disabled) answer(buttons[i]);
      });
      doc.body.append(d);
      d.showModal();
      if (field) { field.focus(); field.select(); }
      else if (check && g.matchMedia && g.matchMedia('(pointer: fine)').matches) check.focus();
      else d.querySelector('[data-x]').focus();
    });
  }

  // Yes or no, worded. Resolves true or false. ok defaults to "Delete" (danger); pass danger: false for a
  // question that isn't a delete. type: the word (a name) they must type first, for the biggest deletes.
  function uiConfirm(o) {
    o = o || {};
    const danger = o.danger != null ? o.danger : !o.ok || /delete|remove|clear|empty|replace|reset|throw away/i.test(o.ok);
    return uiAsk({
      title: o.title || 'Delete this?', body: o.body, type: o.type,
      buttons: [{ label: o.cancel || 'Cancel', value: null }, { label: o.ok || 'Delete', value: true, danger, primary: !danger }],
    }).then((v) => v === true);
  }

  // ── A button that starts a job ───────────────────────────────────────────────
  // Can't be tapped twice; says what it's doing; says it worked for a moment, or puts its words back and
  // passes the error on (the caller shows it, usually as a bad toast).
  async function uiBusy(button, job, o) {
    o = o || {};
    if (!button) return job();
    if (button.dataset.busy) return;
    const words = button.innerHTML;
    button.dataset.busy = ''; button.disabled = true; button.setAttribute('aria-busy', 'true');
    button.innerHTML = `<span class="ui-spinner" aria-hidden="true"></span><span>${esc(o.doing || 'Working…')}</span>`;
    const reset = () => { button.innerHTML = words; button.disabled = false; button.removeAttribute('aria-busy'); delete button.dataset.busy; };
    try {
      const r = await job();
      if (o.done && button.isConnected) {
        button.innerHTML = `${icon('check')}<span>${esc(o.done)}</span>`;
        setTimeout(reset, 1500);
      } else reset();
      return r;
    } catch (e) { reset(); throw e; }
  }

  // ── Copy, share, download ────────────────────────────────────────────────────
  function flash(button, text) {
    if (!button) return;
    if (button.dataset.flash) return;
    const words = button.innerHTML;
    button.dataset.flash = '';
    button.innerHTML = `${icon('check')}<span>${esc(text)}</span>`;
    setTimeout(() => { button.innerHTML = words; delete button.dataset.flash; }, 1500);
  }
  async function uiCopy(text, o) {
    o = o || {};
    let ok = false;
    try { await g.navigator.clipboard.writeText(text); ok = true; }
    catch {
      const t = doc.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      (topSheet() || doc.body).append(t); t.select();
      try { ok = doc.execCommand('copy'); } catch { ok = false; }
      t.remove();
    }
    if (!ok) uiToast("Couldn't copy. Select the text and copy it by hand.", { bad: true });
    else if (o.button) flash(o.button, o.done || 'Copied');
    else if (o.toast !== false) uiToast(o.done || 'Copied');
    return ok;
  }
  function uiDownload(name, data, type) {
    const blob = data instanceof Blob ? data
      : new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: type || (typeof data === 'string' ? 'text/plain' : 'application/json') });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(doc.createElement('a'), { href: url, download: name });
    a.style.display = 'none';
    doc.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  // The phone's share sheet when it can take this; else files download and words or a link are copied.
  // Closing the share sheet without sharing is not an error. Resolves 'shared', 'downloaded', 'copied' or null.
  async function uiShare(o) {
    o = o || {};
    const data = {};
    if (o.title) data.title = o.title;
    if (o.text) data.text = o.text;
    if (o.url) data.url = o.url;
    if (o.files && o.files.length) data.files = o.files;
    const nav = g.navigator;
    if (nav.share && (!data.files || (nav.canShare && nav.canShare(data)))) {
      try { await nav.share(data); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return null; }
    }
    if (data.files) { data.files.forEach((f) => uiDownload(f.name, f)); uiToast(data.files.length > 1 ? `Saved ${data.files.length} files` : 'Saved the file'); return 'downloaded'; }
    const words = [o.text, o.url].filter(Boolean).join(' ');
    if (words && await uiCopy(words, { done: o.url ? 'Copied the link' : 'Copied' })) return 'copied';
    return null;
  }

  Object.assign(g, { uiToast, uiAsk, uiConfirm, uiBusy, uiCopy, uiShare, uiDownload });
})(window);
