/* COPY of sites/_shared/chassis/help.js — edit the source there and run node _shared/sync.mjs */
/* The shared Help sheet: step-by-step how-to guides inside every app, uiHelp.

   Source: sites/_shared/chassis/help.js (copied into each app with the chassis by node _shared/sync.mjs).
   Tom, 21 Nov 2026: help so he never needs Claude Code to remember how his own app works, "more how-to than FAQ",
   with fuzzy search, "super user friendly and easy to use on both desktop and mobile". The plan and the
   per-app lists: briefs/help-audit-2026-11-21.html. Its look is .ui-help and .ui-steps in components.css.

   Load as a plain script after fuzzy.js (and icons.js if the app has it). Then:

     uiHelp.open({
       title: 'Help',                                   // the sheet's title
       groups: [{ id: 'back', name: 'Money back' }],     // the topic chips and headings, in this order
       guides: [{
         id: 'cash-back',                               // stable: links and "related" use it
         group: 'back',
         title: 'Log money a friend paid you back in cash',   // the job, starting with a verb
         words: 'owed paid me back cash friend split',  // what people might type instead (searched, never shown)
         where: 'Header › Payment › Money in',          // where it starts, as the person sees it
         steps: ['Tap Payment in the header, then Money in.', 'Say who it’s from and how much.'],
         done: 'That bill now counts only your share.', // what you'll see when it's worked
         tip: 'No receipt? It still works.',            // optional: one extra thing worth knowing
         go: 'payment',                                  // optional: "Take me there" calls o.go(guide)
         related: ['bank-back'],                         // optional: other guides' ids
         isNew: true,                                    // optional: a New badge
       }],
       start: 'cash-back',     // optional: open straight on a guide (Back still goes to the list)
       query: 'refund',        // optional: open the list already searched
       go: (guide) => {},      // "Take me there": the sheet closes first, then this runs
       ask: {                  // optional: "Ask about something", the app's AI helper (see below)
         icon: sparkle(),      //   the magic mark (from magic.js), since this is the one AI part
         run: async (question) => ({ answer, found, cant, guide, act }),   // or null if they gave up
       },
     });                        // resolves when the sheet closes

     uiHelp.search(guides, 'frend payed me bak')        // the ranked matches, for an app's own use

   What it does, so every app behaves the same:
   - One labelled search box ("What do you want to do?") filters as you type. It forgives typos and half words
     (uiFuzzy), skips little words (how, do, I, my…), and ranks guides by how many of your words they match,
     titles first, so a whole question like "how do I log cash a friend gave me" still finds the guide.
   - Topic chips narrow the list; with no search and All, the guides sit under their topic headings.
   - A guide shows where it starts, numbered steps, what you'll see when it's worked, an optional tip,
     "Take me there" when the app can open that screen, and related guides.
   - Back (or Esc) returns to the list exactly as it was: same search, same topic, same scroll.
   - It opens as its own sheet on top of whatever was open, keeps one height while open, and sits above a
     phone's keyboard, so nothing jumps while you type. Enter opens the top match (or asks, when nothing matches).

   Ask (22 Nov 2026, Tom: an assistant "that can help diagnose the help I want but also maybe even do the task for
   me"). With o.ask, the list ends with "Ask about …" (and opens with it before anything is typed). Tapping it
   steps the Help sheet aside, so the app's magic sheet (paid or free route) has the screen, and calls
   o.ask.run(question). It resolves to what to show: answer (a few plain sentences), found (what it saw in the
   person's data), cant (what the app can't do yet), guide (a guide id to open from the answer) and act
   ({ label, run, items, heading }: the one primary button, e.g. "Check and log it", which closes Help first,
   with items listing what it would do; whatever it does must still ask for a tick before anything changes). Null puts the list back as it was. */
(function () {
  'use strict';
  if (window.uiHelp) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const icon = (n, cls) => (window.uiIcon ? window.uiIcon(n, cls ? { cls } : undefined) : '');
  const fz = () => window.uiFuzzy;

  // Little words that say nothing about which guide you want.
  const STOP = new Set(('a an the i me my mine we our you your it its is are was be been am do does did done how what when where ' +
    'why which who can could should would will want need to of for in on at by with from and or but so if this that these those ' +
    'there here get got just some any into out up about please help app').split(' '));
  const words = (s) => (fz() ? fz().norm(s) : String(s).toLowerCase()).split(/[^a-z0-9]+/).filter(Boolean);

  // Rank guides for a typed search. Each meaningful word typed scores where it matches: the title counts most,
  // then the search words, then where and the steps. A guide must match at least half the words (all of them
  // when one or two are typed), so a long question still finds the guide that matches most of it.
  function search(guides, query) {
    const F = fz();
    const all = words(query);
    let q = all.filter((w) => !STOP.has(w));
    if (!q.length) q = all;
    if (!q.length) return guides.slice();
    const need = q.length <= 2 ? q.length : Math.ceil(q.length / 2);
    const exact = (w, text) => new RegExp('(^|[^a-z0-9])' + w.replace(/[^a-z0-9]/g, '\\$&')).test(String(text).toLowerCase());
    const hit = (w, text) => (F ? F.match(w, text) : String(text).toLowerCase().includes(w));
    const scored = [];
    guides.forEach((g, i) => {
      let n = 0, score = 0;
      for (const w of q) {
        const s = hit(w, g.title) ? 4 : hit(w, g.words || '') ? 3 : hit(w, [g.where, g.group]) ? 2 : hit(w, [g.steps, g.done, g.tip]) ? 1 : 0;
        // The word as typed (a word, or the start of one) beats a near miss: "tie" finds "Break a tie" before "the".
        if (s) { n++; score += s + (exact(w, [g.title, g.words]) ? 2 : 0); }
      }
      if (n >= need) scored.push({ g, i, score: n * 10 + score });
    });
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored.map((x) => x.g);
  }

  let seq = 0;
  function open(o) {
    o = o || {};
    const guides = (o.guides || []).filter((g) => g && g.id && g.title);
    const groups = (o.groups || []).filter((g) => guides.some((x) => x.group === g.id));
    const byId = new Map(guides.map((g) => [g.id, g]));
    const groupName = (id) => (groups.find((g) => g.id === id) || {}).name || '';

    return new Promise((resolve) => {
      const id = 'ui-help-' + ++seq;
      const d = document.createElement('dialog');
      d.className = 'ui-sheet ui-help';
      d.setAttribute('aria-labelledby', id + '-t');
      d.innerHTML = `<header><h2 id="${id}-t"></h2>
          <button class="ui-btn quiet icon small" type="button" data-close aria-label="Close">${icon('x') || '×'}</button></header>
        <div class="ui-help-top">
          <label class="ui-field"><span>What do you want to do?</span>
            <input class="ui-input" type="search" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go"></label>
          ${groups.length > 1 ? `<div class="ui-chips scroll" role="group" aria-label="Topics">
            <button type="button" class="ui-chip" data-topic="" aria-pressed="true">All</button>
            ${groups.map((g) => `<button type="button" class="ui-chip" data-topic="${esc(g.id)}" aria-pressed="false">${esc(g.name)}</button>`).join('')}
          </div>` : ''}
        </div>
        <div class="body" data-list aria-live="polite"></div>
        <div class="body" data-guide hidden></div>
        <footer class="ui-actions" hidden></footer>`;
      document.body.appendChild(d);

      const title = d.querySelector('h2'), top = d.querySelector('.ui-help-top'), q = top.querySelector('input');
      const list = d.querySelector('[data-list]'), page = d.querySelector('[data-guide]'), foot = d.querySelector('footer');
      let topic = '', current = null, from = [], hiding = false;

      // Keep the sheet above a phone's keyboard (the same way as uiPick).
      const vv = window.visualViewport;
      const fit = () => {
        if (!vv) return;
        d.style.setProperty('--help-vh', vv.height + 'px');
        d.style.setProperty('--help-kb', Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px');
      };
      if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }

      let done = false;
      const finish = (after) => {
        if (done) return; done = true;
        if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
        if (d.open) d.close();
        d.remove();
        resolve();
        if (after) after();
      };
      d.addEventListener('cancel', (e) => { e.preventDefault(); if (current) back(); else finish(); });
      d.addEventListener('close', () => { if (!hiding) finish(); });
      d.addEventListener('click', (e) => { if (e.target === d) finish(); });
      d.querySelector('[data-close]').addEventListener('click', () => finish());

      const row = (g, showGroup) => `<button type="button" class="ui-row" data-open="${esc(g.id)}">
          <span class="main"><span>${esc(g.title)}${g.isNew ? ' <span class="ui-badge accent">New</span>' : ''}</span>
          ${g.where || showGroup ? `<span class="sub">${esc(showGroup && groupName(g.group) ? groupName(g.group) + (g.where ? ' · ' : '') : '')}${esc(g.where || '')}</span>` : ''}</span></button>`;
      const card = (rows) => `<div class="ui-card flat"><div class="ui-list">${rows}</div></div>`;
      const askRow = (text) => o.ask ? card(`<button type="button" class="ui-row" data-ask>
          <span class="ui-help-mark" aria-hidden="true">${o.ask.icon || icon('sparkles')}</span>
          <span class="main"><span>${text ? `Ask about “${esc(text)}”` : 'Ask about something'}</span>
          <span class="sub">${text ? 'Get an answer, and help doing it' : 'Describe it in your own words'}</span></span></button>`) : '';

      function drawList() {
        const text = q.value.trim();
        const pool = topic ? guides.filter((g) => g.group === topic) : guides;
        let html;
        if (text) {
          const hits = search(pool, text);
          html = hits.length
            ? `<p class="ui-hint">${hits.length === 1 ? '1 guide' : hits.length + ' guides'}${topic ? ' in ' + esc(groupName(topic)) : ''}</p>${card(hits.map((g) => row(g, !topic)).join(''))}${askRow(text)}`
            : `<div class="ui-empty"><span class="icon">${icon('zoom-question')}</span><strong>No guide for “${esc(text)}”</strong>
                <span>Try fewer or different words${topic ? ', or look in All topics' : ', or pick a topic'}.</span>
                ${topic ? '<button type="button" class="ui-btn small" data-alltopics>Search all topics</button>' : ''}</div>` + askRow(text);
        } else if (topic || !groups.length) {
          html = (topic ? '' : askRow('')) + card(pool.map((g) => row(g)).join(''));
        } else {
          html = askRow('') + groups.map((gr) => `<section class="ui-help-group"><div class="ui-label">${esc(gr.name)}</div>
            ${card(guides.filter((g) => g.group === gr.id).map((g) => row(g)).join(''))}</section>`).join('')
            + (guides.some((g) => !groups.find((x) => x.id === g.group)) ? card(guides.filter((g) => !groups.find((x) => x.id === g.group)).map((g) => row(g)).join('')) : '');
        }
        list.innerHTML = html;
      }

      function showList() {
        current = null; from = [];
        title.textContent = o.title || 'Help';
        top.hidden = false; list.hidden = false; page.hidden = true; foot.hidden = true;
        d.classList.remove('reading');
      }

      function showGuide(g, push) {
        if (push && current) from.push(current);
        if (!current) list.dataset.scroll = String(list.scrollTop);   // leaving the list: remember where it was
        current = g;
        if (g.asked) return drawAnswer(g);
        title.textContent = g.title;
        top.hidden = true; list.hidden = true; page.hidden = false;
        d.classList.add('reading');
        const rel = (g.related || []).map((r) => byId.get(r)).filter(Boolean);
        page.innerHTML = `
          ${g.where ? `<p class="ui-help-where">${icon('map-pin')}<span>${esc(g.where)}</span></p>` : ''}
          ${g.steps && g.steps.length ? `<ol class="ui-steps">${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
          ${g.done ? `<div class="ui-note good">${icon('circle-check')}<span><b>When it’s worked:</b> ${esc(g.done)}</span></div>` : ''}
          ${g.tip ? `<div class="ui-note">${icon('bulb')}<span>${esc(g.tip)}</span></div>` : ''}
          ${rel.length ? `<section class="ui-help-group"><div class="ui-label">Related</div>${card(rel.map((r) => row(r)).join(''))}</section>` : ''}`;
        foot.hidden = false;
        foot.innerHTML = `<button type="button" class="ui-btn" data-back>${icon('arrow-left')}<span>${from.length ? 'Back' : 'All guides'}</span></button>
          ${g.go && o.go ? `<button type="button" class="ui-btn primary" data-go><span>Take me there</span>${icon('arrow-right')}</button>` : ''}`;
        foot.querySelector('[data-back]').addEventListener('click', back);
        foot.querySelector('[data-go]')?.addEventListener('click', () => finish(() => o.go(g)));
        page.scrollTop = 0;
        (foot.querySelector('[data-go]') || foot.querySelector('[data-back]')).focus({ preventScroll: true });
      }

      // The answer to an Ask: what it said, what it found, what it can't do, the guide it points to, and one button.
      function drawAnswer(a) {
        const r = a.result, g = r.guide && byId.get(r.guide);
        title.textContent = 'Your answer';
        top.hidden = true; list.hidden = true; page.hidden = false;
        d.classList.add('reading');
        page.innerHTML = `
          <section class="ui-help-group"><div class="ui-label">You asked</div><p class="ui-help-asked">${esc(a.asked)}</p></section>
          ${r.answer ? `<div class="ui-card flat"><p class="ui-help-answer">${esc(r.answer)}</p></div>` : ''}
          ${r.found ? `<div class="ui-note info">${icon('search')}<span><b>What I found:</b> ${esc(r.found)}</span></div>` : ''}
          ${r.cant ? `<div class="ui-note warn">${icon('alert-triangle')}<span><b>The app can’t do this yet:</b> ${esc(r.cant)}</span></div>` : ''}
          ${g ? `<section class="ui-help-group"><div class="ui-label">How to do it</div>${card(row(g))}</section>` : ''}`;
        const act = r.act && r.act.label && typeof r.act.run === 'function' ? r.act : null;
        if (act && act.items && act.items.length) page.insertAdjacentHTML('beforeend', `<section class="ui-help-group"><div class="ui-label">${esc(act.heading || 'It can do this for you')}</div>
          ${card(act.items.map((t) => `<div class="ui-row"><span class="main"><span>${esc(t)}</span></span></div>`).join(''))}
          <p class="ui-hint">You tick each one before anything changes.</p></section>`);
        foot.hidden = false;
        foot.innerHTML = `<button type="button" class="ui-btn" data-back>${icon('arrow-left')}<span>${from.length ? 'Back' : 'All guides'}</span></button>
          ${act ? `<button type="button" class="ui-btn primary" data-act><span>${esc(act.label)}</span>${icon('arrow-right')}</button>`
            : g && g.go && o.go ? `<button type="button" class="ui-btn primary" data-go><span>Take me there</span>${icon('arrow-right')}</button>` : ''}`;
        foot.querySelector('[data-back]').addEventListener('click', back);
        foot.querySelector('[data-act]')?.addEventListener('click', () => finish(() => act.run()));
        foot.querySelector('[data-go]')?.addEventListener('click', () => finish(() => o.go(g)));
        page.scrollTop = 0;
        (foot.querySelector('[data-act], [data-go]') || foot.querySelector('[data-back]')).focus({ preventScroll: true });
      }

      // Step aside for the app's magic sheet (a modal Help sheet would sit on top of it), then come back.
      async function ask(text) {
        if (!text) { q.focus(); return; }
        list.dataset.scroll = String(list.scrollTop);
        hiding = true; d.close();
        let result = null;
        try { result = await o.ask.run(text); } catch (e) { result = null; }
        hiding = false;
        if (done) return;
        fit(); d.showModal();
        if (result && (result.answer || result.found || result.cant || result.guide)) showGuide({ asked: text, result }, false);
        else { list.scrollTop = Number(list.dataset.scroll || 0); q.focus({ preventScroll: true }); }
      }

      function back() {
        const prev = from.pop();
        if (prev) { current = null; showGuide(prev, false); return; }
        showList();
        list.scrollTop = Number(list.dataset.scroll || 0);   // the list exactly where it was
        if (matchMedia('(pointer: fine)').matches) q.focus({ preventScroll: true });
      }

      // Filtering redraws only the list, which keeps its own scroll; the search box never moves.
      q.addEventListener('input', () => { list.scrollTop = 0; drawList(); });
      q.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const first = list.querySelector('[data-open]');
        if (first) showGuide(byId.get(first.dataset.open), false);
        else if (o.ask && q.value.trim()) ask(q.value.trim());   // no guide: Enter asks
      });
      top.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-topic]');
        if (!chip) return;
        topic = chip.dataset.topic;
        top.querySelectorAll('[data-topic]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
        list.scrollTop = 0;
        drawList();
      });
      d.addEventListener('click', (e) => {
        const t = e.target.closest('[data-open]');
        if (t) { showGuide(byId.get(t.dataset.open), !!current); return; }
        if (e.target.closest('[data-ask]')) { ask(q.value.trim()); return; }
        if (e.target.closest('[data-alltopics]')) top.querySelector('[data-topic=""]')?.click();
      });

      if (o.query) q.value = o.query;
      showList();
      drawList();
      fit();
      d.showModal();
      const start = o.start && byId.get(o.start);
      if (start) showGuide(start, false);
      else if (matchMedia('(pointer: fine)').matches) q.focus();
      else d.querySelector('[data-close]').focus();
    });
  }

  window.uiHelp = { open, search };
})();
