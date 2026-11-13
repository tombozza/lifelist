/* COPY of sites/_shared/magic/magic.js — edit the source there and run node _shared/sync.mjs */
// The magic button — one way to do an AI job, in every app.
//
// Source of truth: sites/_shared/magic/. Apps get a COPY in their own vendor folder
// (node _shared/sync.mjs) — edit here, then sync. See sites/_shared/README.md.
//
// The mark (sparkle) means "AI does this", and nothing else. It always opens the same
// sheet, which offers two routes to the same result:
//   Run it  — the app calls Claude itself (paid, about a penny), when the site has a key
//   Free    — copy the prompt, paste it into ChatGPT or claude.ai, paste the reply back
// Both routes end in parse(); nothing is saved until the app's apply() runs.

const SPARK = '<svg class="mg-mark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M10 2.5c.3 0 .5.2.6.5l1.1 3.9a5 5 0 0 0 3.4 3.4l3.9 1.1a.6.6 0 0 1 0 1.2l-3.9 1.1a5 5 0 0 0-3.4 3.4l-1.1 3.9a.6.6 0 0 1-1.2 0l-1.1-3.9a5 5 0 0 0-3.4-3.4L1 12.6a.6.6 0 0 1 0-1.2l3.9-1.1a5 5 0 0 0 3.4-3.4L9.4 3c.1-.3.3-.5.6-.5Z"/><path d="M19 1.5c.2 0 .3.1.4.3l.4 1.3c.2.6.6 1 1.2 1.2l1.3.4a.4.4 0 0 1 0 .8l-1.3.4c-.6.2-1 .6-1.2 1.2l-.4 1.3a.4.4 0 0 1-.8 0l-.4-1.3c-.2-.6-.6-1-1.2-1.2l-1.3-.4a.4.4 0 0 1 0-.8l1.3-.4c.6-.2 1-.6 1.2-1.2l.4-1.3c.1-.2.2-.3.4-.3Z"/></svg>';

/** The mark as an HTML string, for template literals: `<button class="btn">${sparkle()} Get ideas</button>`. */
export const sparkle = () => SPARK;

/** <magic-mark></magic-mark> — the same mark as an element, for React or plain HTML. */
if (typeof customElements !== 'undefined' && !customElements.get('magic-mark')) {
  customElements.define('magic-mark', class extends HTMLElement {
    connectedCallback() { if (!this.firstChild) this.innerHTML = SPARK; }
  });
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Run it's cost note, short: no model name, "about" as "~" ("Claude · about 0.3¢" → "~0.3¢"). */
const costNote = s => String(s).replace(/^\s*(Claude|Haiku|Sonnet|Opus)\s*·\s*/i, '').replace(/\babout\s+/gi, '~');
const ROUTE_KEY = 'magic-route';
const getRoute = () => { try { return localStorage.getItem(ROUTE_KEY); } catch { return null; } };
const setRoute = v => { try { localStorage.setItem(ROUTE_KEY, v); } catch { /* private mode */ } };

/**
 * Open the magic sheet.
 *
 * @param {object} o
 * @param {string|(()=>string)} o.title  The job in plain words: "Write up 5 meals". Never "AI" or a model name.
 * @param {string[]|(()=>string[])} [o.using]  What gets sent, shown as chips before anything leaves the app.
 *                                    title and using may be functions, so they can follow the choices below.
 * @param {{key:string, label:string, value:any, choices:(any|{value:any,label:string})[]}[]} [o.choices]
 *                                    A few dropdowns at the top of the sheet ("Harry's age", "How many"), so a job
 *                                    with settings opens straight into the sheet instead of a form first.
 * @param {(key:string, value:string) => (void|Promise<void>)} [o.choose]  Called when one changes. The app updates
 *                                    what prompt()/run() use; while a returned promise is pending, Copy and Run wait.
 * @param {boolean|(() => Promise<boolean>)} [o.canRun]  Is the paid route available (the site has a key)?
 * @param {(status:(s:string)=>void) => Promise<string>} [o.run]  Paid route: returns the reply text.
 * @param {string} [o.runNote]        e.g. "~1p" (a model name or "about" is shortened away).
 * @param {string} [o.runOff]         The paid route is switched off for this job on purpose (it costs too much):
 *                                    Run it shows greyed out with this note, e.g. "Switched off: too costly". Leave
 *                                    out `run`. Without it a job with no `run` says one-tap isn't set up.
 * @param {{has:()=>boolean, save:(key:string)=>void, clear:()=>void}} [o.key]
 *                                    Bring your own key (opt-in). With it, Run it shows even when the site has no
 *                                    key: tapping it asks for the person's Anthropic API key, which the app keeps on
 *                                    this device (save/clear) and sends with run(). "Change key" edits it later.
 *                                    The site's own key, when canRun says there is one, still wins.
 * @param {(prepared?:string) => string} o.prompt  Free route: the full prompt to copy (synchronous — the copy
 *                                    must happen inside the tap, or iOS refuses it).
 * @param {{label:string, note?:string, check?:boolean, again?:string, run:(status:(s:string)=>void)=>Promise<string>}} [o.prepare]
 *                                    Free route, optional first step done on the device (e.g. read a photo's
 *                                    text). Its text is shown for checking, then passed to prompt().
 *                                    With check: false its result is a one-line note, not text to check — for a
 *                                    step like "Share the photos" (Finance Centre's receipts); `again` relabels its
 *                                    button once done ("Share again"). run() starts inside the tap, so it can open
 *                                    a share sheet — have the files ready before the sheet opens.
 * @param {string} [o.freeNote]       One line under the Free steps.
 * @param {(text:string) => any} o.parse  Turns a reply into a result; throw an Error with a helpful message.
 * @param {(result:any) => string} [o.preview]  HTML to check before applying. Without it, apply() runs straight away.
 * @param {(result:any) => (void|false|Promise<void|false>)} o.apply  Use the result. Return false to keep the sheet open.
 * @param {string} [o.applyLabel]     Button text on the preview: "Add 5 meals".
 * @returns {Promise<any|null>}       The applied result, or null if closed without one.
 */
export function openMagic(o) {
  return new Promise(resolve => {
    const opener = document.activeElement;
    const val = x => (typeof x === 'function' ? x() : x);
    const st = { updating: false, route: null, canRun: false, offer: false, editingKey: false, busy: false, status: '', error: '', copied: false, prepared: null, preparing: false, result: undefined, reply: '' };

    const wrap = document.createElement('div');
    wrap.className = 'mg-scrim';
    wrap.innerHTML = `<div class="mg-sheet" role="dialog" aria-modal="true" aria-labelledby="mg-title">
      <div class="mg-head"><span class="mg-badge">${SPARK}</span><h2 id="mg-title">${esc(val(o.title))}</h2>
        <button type="button" class="mg-x" data-mg="close" aria-label="Close">✕</button></div>
      <div class="mg-using" hidden></div>
      ${o.choices?.length ? '<div class="mg-opts"></div>' : ''}
      <div class="mg-body"></div></div>`;
    document.body.append(wrap);
    const body = wrap.querySelector('.mg-body');
    const usingEl = wrap.querySelector('.mg-using'), optsEl = wrap.querySelector('.mg-opts');
    function renderHead() {
      wrap.querySelector('#mg-title').textContent = val(o.title);
      const using = val(o.using) ?? [];
      usingEl.hidden = !using.length;
      usingEl.innerHTML = `<span>Using</span>${using.map(u => `<span class="mg-chip">${esc(u)}</span>`).join('')}`;
    }
    function renderChoices() {
      if (!optsEl) return;
      optsEl.innerHTML = o.choices.map(c => `<label class="mg-opt">${esc(c.label)}<select data-mg-choice="${esc(c.key)}">${c.choices.map(ch => {
        const v = typeof ch === 'object' ? ch.value : ch, l = typeof ch === 'object' ? ch.label : ch;
        return `<option value="${esc(v)}" ${String(v) === String(c.value) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select></label>`).join('');
    }
    renderHead(); renderChoices();
    // Choices sit outside the body, so redraws don't steal focus from them; only the view stays put.
    if (optsEl) optsEl.addEventListener('change', async e => {
      const key = e.target.dataset.mgChoice; if (!key) return;
      const c = o.choices.find(x => x.key === key); c.value = e.target.value;
      st.updating = true; st.copied = false; st.error = ''; st.result = undefined; render();
      try { await o.choose?.(key, e.target.value); }
      catch (err) { st.error = err?.message ?? String(err); }
      st.updating = false; renderHead(); render();
    });

    let closed = false;
    const close = (val = null) => {
      if (closed) return; closed = true;
      wrap.remove(); document.removeEventListener('keydown', onKey, true);
      if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
      resolve(val);
    };
    const onKey = e => { if (e.key === 'Escape' && !st.busy) { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);

    const setStatus = s => { st.status = s; const el = body.querySelector('.mg-status-text'); if (el) el.textContent = s; };

    // Paid route usable right now: the site has a key, or this device has one saved.
    const paid = () => st.canRun || !!o.key?.has();
    function keyForm() {
      const has = !!o.key.has();
      return `<div class="mg-stack">
        <p class="mg-note">API key · <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com ↗</a></p>
        <label class="mg-stack" for="mg-key">Your API key<input id="mg-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…"></label>
        <div class="mg-actions">${has ? `<button type="button" class="mg-ghost" data-mg="key-clear">Remove key</button><button type="button" class="mg-ghost" data-mg="key-cancel">Cancel</button>` : ''}
          <button type="button" class="mg-go" data-mg="key-save">Save key</button></div></div>`;
    }

    function routes() {
      if (o.runOff) return `<div class="mg-seg" role="group" aria-label="How to do it">
        <button type="button" disabled aria-pressed="false">Run it<small>${esc(o.runOff)}</small></button>
        <button type="button" data-mg="route" data-r="free" aria-pressed="true">Free</button></div>`;
      if (!st.offer) return '';
      const on = r => st.route === r ? 'true' : 'false';
      return `<div class="mg-seg" role="group" aria-label="How to do it">
        <button type="button" data-mg="route" data-r="run" aria-pressed="${on('run')}">Run it<small>${paid() ? esc(costNote(o.runNote ?? '~1p')) : 'Needs an API key'}</small></button>
        <button type="button" data-mg="route" data-r="free" aria-pressed="${on('free')}">Free</button></div>`;
    }

    function freeSteps() {
      const needPrep = o.prepare && st.prepared == null;
      let n = 0;
      const step = (html, done = false) => `<li class="${done ? 'mg-done' : ''}"><span>${++n}</span><div>${html}</div></li>`;
      return `<ol class="mg-steps">
        ${o.prepare ? step(st.prepared == null
          ? `<div class="mg-stack">${esc(o.prepare.note ?? '')}<div><button type="button" class="mg-ghost" data-mg="prepare" ${st.preparing ? 'disabled' : ''}>${esc(o.prepare.label)}</button></div></div>`
          : o.prepare.check === false
            ? `<div class="mg-stack">${esc(st.prepared)}<div><button type="button" class="mg-ghost" data-mg="prepare" ${st.preparing ? 'disabled' : ''}>${esc(o.prepare.again ?? o.prepare.label)}</button></div></div>`
            : `<label class="mg-stack" for="mg-prep">Check<textarea id="mg-prep" rows="5">${esc(st.prepared)}</textarea></label>`, st.prepared != null) : ''}
        ${step(`<div class="mg-stack">Copy the prompt<div><button type="button" class="${needPrep ? 'mg-ghost' : 'mg-go'}" data-mg="copy" ${needPrep || st.updating ? 'disabled' : ''}>${st.copied ? 'Copied ✓' : 'Copy prompt'}</button></div></div>`, st.copied)}
        ${step(`Send it: <a href="https://chatgpt.com/" target="_blank" rel="noopener">ChatGPT ↗</a> · <a href="https://claude.ai/new" target="_blank" rel="noopener">claude.ai ↗</a>`)}
        ${step(`<label class="mg-stack" for="mg-reply">Reply<textarea id="mg-reply" rows="5">${esc(st.reply)}</textarea></label>`)}
      </ol>
      ${o.freeNote ? `<p class="mg-note">${esc(o.freeNote)}</p>` : ''}
      <div class="mg-actions"><button type="button" class="mg-go" data-mg="read">Use this reply</button></div>`;
    }

    function render() {
      if (st.result !== undefined && o.preview) {
        body.innerHTML = `<div class="mg-preview">${o.preview(st.result)}</div>
          ${st.error ? `<p class="mg-error" role="alert">${esc(st.error)}</p>` : ''}
          <div class="mg-actions"><button type="button" class="mg-ghost" data-mg="again">Try again</button>
          <button type="button" class="mg-go" data-mg="apply">${esc(o.applyLabel ?? 'Apply')}</button></div>`;
        return;
      }
      const working = st.busy || st.preparing || st.updating;
      body.innerHTML = `${routes()}
        ${st.route === 'run'
          ? (o.key && (st.editingKey || !paid())) ? keyForm()
          : `<div class="mg-actions"><button type="button" class="mg-go" data-mg="run" ${working ? 'disabled' : ''}>Run it</button></div>
             ${o.key && !st.canRun ? `<p class="mg-note"><button type="button" class="mg-link" data-mg="key-edit">Change key</button></p>` : ''}`
          : freeSteps()}
        ${working ? `<p class="mg-status" role="status"><i></i><span class="mg-status-text">${esc(st.updating ? 'Updating…' : st.status || 'Working…')}</span></p>` : ''}
        ${st.error ? `<p class="mg-error" role="alert">${esc(st.error)}</p>` : ''}`;
    }

    async function accept(text) {
      st.error = '';
      let result;
      try { result = await o.parse(text); }
      catch (err) { st.error = err?.message ?? String(err); return render(); }
      st.result = result;
      if (o.preview) return render();
      return doApply();
    }
    async function doApply() {
      try { if ((await o.apply(st.result)) === false) return render(); }
      catch (err) { st.error = err?.message ?? String(err); return render(); }
      close(st.result);
    }

    wrap.addEventListener('click', async e => {
      if (e.target === wrap && !st.busy) return close();
      const b = e.target.closest('[data-mg]'); if (!b || b.disabled) return;
      const a = b.dataset.mg;
      if (a === 'close') return close();
      if (a === 'key-save') {
        const v = (body.querySelector('#mg-key')?.value ?? '').trim();
        if (!/^sk-ant-\S{20,}$/.test(v)) { st.error = 'That doesn’t look like an Anthropic API key — they start sk-ant-.'; return render(); }
        try { o.key.save(v); } catch (err) { st.error = err?.message ?? String(err); return render(); }
        st.editingKey = false; st.error = ''; setRoute('run'); render();
        return body.querySelector('[data-mg="run"]')?.focus({ preventScroll: true });
      }
      if (a === 'key-clear') { o.key.clear(); st.editingKey = false; st.error = ''; return render(); }
      if (a === 'key-edit') { st.editingKey = true; st.error = ''; render(); return body.querySelector('#mg-key')?.focus({ preventScroll: true }); }
      if (a === 'key-cancel') { st.editingKey = false; st.error = ''; return render(); }
      if (a === 'route') { st.route = b.dataset.r; setRoute(st.route); st.error = ''; return render(); }
      if (a === 'copy') {
        const prep = body.querySelector('#mg-prep'); if (prep) st.prepared = prep.value;
        const reply = body.querySelector('#mg-reply'); if (reply) st.reply = reply.value;
        let text; try { text = o.prompt(st.prepared ?? undefined); } catch (err) { st.error = err?.message ?? String(err); return render(); }
        try { await navigator.clipboard.writeText(text); st.copied = true; st.error = ''; }
        catch { st.error = 'Couldn’t copy — your browser blocked it. Try again, or use the other route.'; }
        return render();
      }
      if (a === 'prepare') {
        st.preparing = true; st.error = ''; st.status = ''; render();
        try { st.prepared = await o.prepare.run(setStatus); }
        catch (err) { st.error = err?.message ?? String(err); }
        st.preparing = false; return render();
      }
      if (a === 'read') {
        const t = body.querySelector('#mg-reply')?.value ?? '';
        st.reply = t;
        if (!t.trim()) { st.error = 'Paste the reply first.'; return render(); }
        return accept(t);
      }
      if (a === 'run') {
        st.busy = true; st.error = ''; st.status = ''; render();
        let text;
        try { text = await o.run(setStatus); }
        catch (err) { st.busy = false; st.error = `${err?.message ?? err} — the Free route still works.`; return render(); }
        st.busy = false;
        return accept(text);
      }
      if (a === 'again') { st.result = undefined; st.error = ''; st.copied = false; return render(); }
      if (a === 'apply') return doApply();
    });
    wrap.addEventListener('input', e => { if (e.target.id === 'mg-reply') st.reply = e.target.value; if (e.target.id === 'mg-prep') st.prepared = e.target.value; });

    // first paint, then find out whether the paid route exists
    const decide = can => {
      st.canRun = !!can && typeof o.run === 'function';
      st.offer = typeof o.run === 'function' && (st.canRun || !!o.key);
      const saved = getRoute();
      // With no key anywhere, start on Free; Run it is one tap away and asks for a key.
      st.route = paid() ? (saved === 'free' ? 'free' : 'run') : 'free';
      render();
      body.querySelector('[aria-pressed="true"], .mg-go:not([disabled]), .mg-ghost:not([disabled])')?.focus({ preventScroll: true });
    };
    const c = typeof o.canRun === 'function' ? o.canRun() : o.canRun;
    if (c && typeof c.then === 'function') { st.route = 'free'; render(); c.then(decide, () => decide(false)); }
    else decide(c);
  });
}
