/* COPY of sites/_shared/chassis/picker.js — edit the source there and run node _shared/sync.mjs */
/* The shared picker sheet: pick one of the person's own things, or add a new one.

   Source: sites/_shared/chassis/picker.js (copied into each app by node _shared/sync.mjs, with the
   chassis). Tom, 21 Nov 2026: "I hate using like native drop downs … there's always going to be
   chances where the option I need isn't there and I need the option to add it." Modelled on House
   Book's spot picker. Its look is .ui-pick in components.css.

   Load as a plain script: <script src="vendor/chassis/picker.js"></script> (after icons.js if the app
   has it; without icons the chosen row still shows as chosen, just with no tick).

     const r = await uiPick({
       title: 'Where’s it kept?',
       label: 'Find or add a spot',              // the search box's label (no placeholder text)
       items: [{ id: 3, name: 'Chest of drawers', group: 'Bedroom', groupId: 1, sub: 'Top drawer', keywords: 'socks' }],
       current: 3,                               // the row shown as chosen
       isKnown: (text) => false,                 // optional: true hides Add "…" for a name that's there under another row
       extras: [{ id: '', name: 'Not filed' }],  // under the list, hidden while searching
       add: async (name, groupId) => newId,      // make it and answer its id; leave out for a list with no Add
       addHint: 'A new spot. Next, which room.', // the line under Add "…"
       step: {                                   // optional second step after Add "…": which room
         title: (name) => `Which room is ${name} in?`,
         label: 'Find or add a room',
         items: [{ id: 1, name: 'Bedroom' }],    // or an async () => items, fetched when the step opens
         add: async (roomName) => newRoomId,     // a new room typed here; leave out for no Add
       },
       // Optional: the groups are things too (rooms), and people think of them first (Tom, 21 Nov 2026:
       // he typed "Living room" to find a spot in it). With groups, rows join their group by groupId.
       groups: [{ id: 1, name: 'Ground floor › Living room', short: 'Living room' }],  // every group, even empty ones; short names it in labels
       inGroup: {                                // adding a row inside a group
         label: (g) => `Add a spot in ${g}`,
         title: (g) => `A new spot in ${g}`,
         field: 'What’s the spot called?',
         partOf: true,                           // offer "Black unit — top right cupboard" for things inside a spot
       },
       addGroup: async (name) => newGroupId,     // Add a room "…" when nothing matches; then names the spot in it
       addGroupLabel: (t) => `Add a room “${t}”`,
     });
     // r = { id, item, added } once picked, or null when closed or Back was tapped.

   Rows keep the order they're given: each run of rows with the same group gets one heading and card, so
   sort them by group first. A run with no group is a card with no heading. With `groups`, the groups'
   order wins.

   What it does, so every app behaves the same:
   - The search box filters the rows in place as you type (no redraw, so nothing jumps); a group whose
     rows are all hidden hides its heading too. A group whose name matches shows all its rows.
   - Add "…" appears once something is typed that doesn't exactly match a row. Enter adds it, or picks
     the only row left.
   - The sheet keeps one height while it's open and sits above the phone's keyboard, so filtering down
     to one row doesn't shrink it and the search box never moves.
   - It opens as its own sheet ON TOP of whatever was open, so Back (or ✕, Esc, the backdrop) closes it
     and the sheet or page underneath is exactly as it was: same place, same scroll, nothing redrawn.
     In the next steps Back returns to the list with the typed text still there.
   - A failed add shows its message under the box; nothing closes.
   - Only rows that lead somewhere (Add "…" with a next step) carry the › chevron. */
(function () {
  'use strict';
  if (window.uiPick) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const icon = (n, cls) => (window.uiIcon ? window.uiIcon(n, cls ? { cls } : undefined) : '');
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  const OOPS = 'Couldn’t add it. Are you offline?';
  // "Top right cupboard" inside "Black unit" → "Black unit — top right cupboard" (like "Wardrobe — right side").
  const joinPart = (base, part) => {
    part = part.trim();
    if (/^[A-Z][a-z]/.test(part)) part = part[0].toLowerCase() + part.slice(1);
    return `${base} — ${part}`;
  };
  // A search box that types what you typed: no autocorrect ("Top" became "Too"), still a capital first.
  const searchBox = (cls) => `<input class="ui-input${cls ? ' ' + cls : ''}" type="search" autocomplete="off" autocorrect="off"
    spellcheck="false" autocapitalize="sentences" enterkeyhint="go">`;
  let seq = 0;

  function uiPick(o) {
    o = o || {};
    return new Promise((resolve) => {
      const id = 'ui-pick-' + ++seq;
      const d = document.createElement('dialog');
      d.className = 'ui-sheet ui-pick';
      d.setAttribute('aria-labelledby', id + '-t');
      const over = !!document.querySelector('dialog[open]');
      const showBack = o.back != null ? !!o.back : over;
      const groups = o.groups ? o.groups.map((g) => ({ ...g })) : null;

      // Keep the sheet above the keyboard: the visual viewport is the part of the page you can see.
      const vv = window.visualViewport;
      const fit = () => {
        if (!vv) return;
        d.style.setProperty('--pick-vh', vv.height + 'px');
        d.style.setProperty('--pick-kb', Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px');
      };
      if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }

      let done = false;
      const finish = (val) => {
        if (done) return; done = true;
        if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
        if (d.open) d.close();
        d.remove();
        resolve(val);
      };
      d.addEventListener('cancel', (e) => { e.preventDefault(); back(); });
      d.addEventListener('close', () => finish(null));   // closed from outside (another script): tidy up
      d.addEventListener('click', (e) => { if (e.target === d) finish(null); });

      let view = 'list', listValue = '';
      function back() { if (view !== 'list') drawList(listValue); else finish(null); }

      // The frame every view shares: title, ✕, the search box (outside the scrolling part, so it stays
      // put), the list, and Back.
      function frame(v, body) {
        d.innerHTML = `<header><h2 id="${id}-t">${esc(v.title || 'Pick one')}</h2>
            <button class="ui-btn quiet icon small" type="button" data-close aria-label="Close">${icon('x') || '×'}</button></header>
          <label class="ui-field ui-pick-search"><span>${esc(v.label || 'Find or add')}</span>${searchBox()}<small hidden></small></label>
          <div class="body">${body}</div>
          ${v.showBack ? '<footer class="ui-actions"><button class="ui-btn" type="button" data-back>' + icon('arrow-left') + '<span>Back</span></button></footer>' : ''}`;
        d.querySelector('[data-close]').addEventListener('click', () => finish(null));
        d.querySelector('[data-back]')?.addEventListener('click', back);
        const q = d.querySelector('.ui-pick-search input'), field = d.querySelector('.ui-pick-search'), msg = field.querySelector('small');
        if (v.value) q.value = v.value;
        const clear = () => { field.classList.remove('error'); msg.hidden = true; };
        const fail = (e) => { field.classList.add('error'); msg.hidden = false; msg.textContent = (e && e.message) || OOPS; };
        return { q, clear, fail };
      }
      function show(q) {
        fit();
        if (!d.open) d.showModal();
        d.querySelector(':scope > .body').scrollTop = 0;
        // Keyboard straight into the box on a computer; on a phone it would cover the list.
        if (matchMedia('(pointer: fine)').matches) q.focus(); else d.querySelector('[data-close]').focus();
      }
      // Run an add once at a time, with its row greyed while it works; a failure shows under the box.
      function runner(fail) {
        let busy = false;
        return async (btn, job) => {
          if (busy) return; busy = true; btn?.setAttribute('disabled', '');
          try { await job(); } catch (e) { fail(e); }
          busy = false; btn?.removeAttribute('disabled');
        };
      }
      const pickRow = (it, i, cur, extra) => `<button type="button" class="ui-row no-chevron" data-i="${i}"${extra ? ' data-extra' : ''}
          data-q="${esc(norm([it.name, it.sub, it.group, it.keywords].filter(Boolean).join(' ')))}"${cur ? ' aria-selected="true"' : ''}>
          <span class="main"><span>${esc(it.name)}</span>${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''}</span>${cur ? icon('check', 'tick') : ''}</button>`;
      const addRow = (attr, hint, next) => `<button type="button" class="ui-row add${next ? '' : ' no-chevron'}" ${attr}>
          ${icon('plus')}<span class="main"><span data-addname></span>${hint ? `<span class="sub">${esc(hint)}</span>` : ''}</span></button>`;

      // One list view: used for the main list and for the second step.
      function drawView(v) {
        const items = v.items || [];
        let runs = [];
        if (v.groups) {
          // Every group in its own order, even with no rows yet; rows with no known group go last.
          const known = new Set(v.groups.map((g) => String(g.id)));
          runs = v.groups.map((g) => ({ name: g.name, g, rows: items.filter((it) => String(it.groupId) === String(g.id)) }));
          const rest = items.filter((it) => !known.has(String(it.groupId)));
          for (const it of rest) {
            let r = runs[runs.length - 1];
            if (!r || r.g || r.name !== (it.group || '')) runs.push((r = { name: it.group || '', rows: [] }));
            r.rows.push(it);
          }
        } else {
          // Rows keep the order given; each run of rows with the same group shares one heading and card.
          for (const it of items) {
            const g = it.group || '';
            let r = runs[runs.length - 1];
            if (!r || r.name !== g) runs.push((r = { name: g, rows: [] }));
            r.rows.push(it);
          }
        }
        const isCur = (it) => v.current != null && String(v.current) === String(it.id);
        const all = items.concat(v.extras || []);
        const inG = v.inGroup;
        const body = `
          ${runs.map((r, ri) => `<div class="ui-pick-group" data-group data-gq="${esc(norm([r.name, r.g && r.g.keywords].filter(Boolean).join(' ')))}"${r.rows.length ? '' : ' data-empty'}>
            ${r.name ? `<div class="ui-label">${esc(r.name)}</div>` : ''}
            <div class="ui-card flat"><div class="ui-list">${r.rows.map((it) => pickRow(it, all.indexOf(it), isCur(it))).join('')}
            ${inG && r.g ? `<button type="button" class="ui-row add" data-ingroup="${ri}">${icon('plus')}<span class="main"><span>${esc(inG.label ? inG.label(r.g.short || r.name, r.g) : `Add one in ${r.name}`)}</span></span></button>` : ''}
            </div></div></div>`).join('')}
          ${v.add ? `<div class="ui-card flat" data-addwrap hidden><div class="ui-list">${addRow('data-add', v.addHint, v.addNext)}
            ${v.addGroup ? addRow('data-addgroup', v.addGroupHint, true) : ''}</div></div>` : ''}
          ${(v.extras || []).length ? `<div class="ui-card flat" data-extras><div class="ui-list">${v.extras.map((it) => pickRow(it, all.indexOf(it), isCur(it), true)).join('')}</div></div>` : ''}
          ${!items.length && !v.add && !runs.length ? '<p class="ui-hint">Nothing to pick yet.</p>' : ''}`;
        const { q, clear, fail } = frame(v, body);

        const wrap = d.querySelector('[data-addwrap]'), extras = d.querySelector('[data-extras]');
        const exact = (t) => all.some((it) => norm(it.name) === t) || (v.isKnown ? !!v.isKnown(t) : false);
        const exactGroup = (t) => runs.some((r) => r.g && norm(r.name) === t);
        const filter = () => {
          const t = norm(q.value);
          d.querySelectorAll('[data-group]').forEach((g) => {
            const whole = !!t && g.dataset.gq.includes(t);          // the group's own name matches: show it all
            g.querySelectorAll('[data-q]').forEach((el) => { el.hidden = !!t && !whole && !el.dataset.q.includes(t); });
            const ing = g.querySelector('[data-ingroup]');
            // "Add a spot in Living room": for an empty room, or once you've searched for the room.
            if (ing) ing.hidden = !(whole || ('empty' in g.dataset && !t));
            g.hidden = !g.querySelector('.ui-row:not([hidden])');
          });
          if (extras) extras.hidden = !!t;
          if (wrap) {
            const known = exact(t) || exactGroup(t);
            wrap.hidden = !t || known;
            wrap.querySelector('[data-add] [data-addname]').textContent = `Add “${q.value.trim()}”`;
            const ag = wrap.querySelector('[data-addgroup]');
            // A room that already matches is shown above with its own "Add a spot in …", so no new room.
            if (ag) ag.hidden = runs.some((r) => r.g && norm(r.name).includes(t));
            if (ag) ag.querySelector('[data-addname]').textContent = v.addGroupLabel ? v.addGroupLabel(q.value.trim()) : `Add a group “${q.value.trim()}”`;
          }
          clear();
        };
        const run = runner(fail);
        const doAdd = () => { const name = q.value.trim(); if (name) run(d.querySelector('[data-add]'), () => v.onAdd(name)); };
        q.addEventListener('input', filter);
        q.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (wrap && !wrap.hidden) { doAdd(); return; }
          const left = [...d.querySelectorAll('[data-q]')].filter((el) => !el.hidden && !el.closest('[hidden]'));
          if (left.length === 1) left[0].click();
        });
        d.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => v.onPick(all[+b.dataset.i])));
        d.querySelector('[data-add]')?.addEventListener('click', doAdd);
        d.querySelector('[data-addgroup]')?.addEventListener('click', (e) => {
          const name = q.value.trim(); if (name) run(e.currentTarget, () => v.onAddGroup(name));
        });
        d.querySelectorAll('[data-ingroup]').forEach((b) => b.addEventListener('click', () => {
          listValue = q.value; drawName(runs[+b.dataset.ingroup].g, '');
        }));
        filter();
        show(q);
      }

      function drawList(value) {
        view = 'list';
        drawView({
          title: o.title, label: o.label, items: o.items, extras: o.extras, current: o.current, showBack,
          value, add: !!o.add, addHint: o.addHint, addNext: !!o.step, isKnown: o.isKnown,
          groups, inGroup: o.add && groups ? (o.inGroup || {}) : null,
          addGroup: !!(o.add && groups && o.addGroup), addGroupHint: o.addGroupHint,
          addGroupLabel: o.addGroupLabel,
          onPick: (it) => finish({ id: it.id, item: it, added: false }),
          onAdd: async (name) => {
            if (o.step) { listValue = name; return drawStep(name); }
            const nid = await o.add(name);
            finish({ id: nid, item: { id: nid, name }, added: true });
          },
          onAddGroup: async (name) => {
            const gid = await o.addGroup(name);
            const g = { id: gid, name };
            groups.push(g);
            listValue = name;
            drawName(g, '');
          },
        });
      }

      async function drawStep(name) {
        view = 'step';
        const s = o.step;
        let items = s.items;
        if (typeof items === 'function') items = await items();
        const make = async (stepId) => {
          const nid = await o.add(name, stepId);
          finish({ id: nid, item: { id: nid, name }, added: true });
        };
        drawView({
          title: typeof s.title === 'function' ? s.title(name) : (s.title || `Where does ${name} go?`),
          label: s.label, items: items || [], showBack: true, add: !!s.add, addHint: s.addHint,
          onPick: (it) => make(it.id).catch((e) => {
            const f = d.querySelector('.ui-pick-search'); f.classList.add('error');
            const m = f.querySelector('small'); m.hidden = false; m.textContent = (e && e.message) || OOPS;
          }),
          onAdd: async (stepName) => { const sid = await s.add(stepName); await make(sid); },
        });
      }

      // Name a new row inside one group (a new spot in the Living room). The group's rows show as you
      // type, so an existing one is picked rather than made twice, and with partOf each can be the
      // thing it's inside: "Black unit — top right cupboard".
      function drawName(g, value) {
        view = 'name';
        const inG = o.inGroup || {};
        const gn = g.short || g.name;
        const rows = (o.items || []).filter((it) => String(it.groupId) === String(g.id));
        const all = rows;
        // The pieces of furniture already here: "Wardrobe — right side" counts as Wardrobe.
        const bases = [...new Set(rows.map((it) => it.name.split(' — ')[0].trim()))];
        const body = `
          <div class="ui-card flat" data-addwrap hidden><div class="ui-list">
            <button type="button" class="ui-row add no-chevron" data-addjoin hidden>${icon('plus')}<span class="main"><span data-addname></span><span class="sub" data-addsub></span></span></button>
            <button type="button" class="ui-row add no-chevron" data-add>${icon('plus')}<span class="main"><span data-addname></span><span class="sub">${esc(`New in ${gn}`)}</span></span></button>
          </div></div>
          ${rows.length ? `<div class="ui-pick-group" data-group data-have><div class="ui-label">${esc(`Already in ${gn}`)}</div>
            <div class="ui-card flat"><div class="ui-list">${rows.map((it, i) => pickRow({ ...it, group: '' }, i, String(o.current) === String(it.id))).join('')}</div></div></div>` : ''}
          ${bases.length && inG.partOf ? `<div class="ui-pick-group" data-group data-parts hidden><div class="ui-label">Or part of one of these</div>
            <div class="ui-card flat"><div class="ui-list">${bases.map((b, i) => `<button type="button" class="ui-row add no-chevron" data-part="${i}">${icon('plus')}
              <span class="main"><span data-addname></span><span class="sub">${esc(`Inside ${b}`)}</span></span></button>`).join('')}</div></div></div>` : ''}
          ${!rows.length && inG.partOf ? '<p class="ui-hint">Inside a piece of furniture? Start with it, like “Wardrobe — right side”.</p>' : ''}`;
        const { q, clear, fail } = frame({
          title: inG.title ? inG.title(gn, g) : `A new one in ${gn}`,
          label: inG.field || 'What’s it called?', showBack: true, value,
        }, body);
        const wrap = d.querySelector('[data-addwrap]'), join = d.querySelector('[data-addjoin]');
        const parts = d.querySelector('[data-parts]'), have = d.querySelector('[data-have]');
        let joined = '';
        const filter = () => {
          const typed = q.value.trim(), t = norm(typed);
          const same = rows.some((it) => norm(it.name) === t);
          // Typed the thing it's inside first ("black unit top right cupboard"): offer the joined name.
          const base = inG.partOf && bases.filter((b) => t.startsWith(norm(b) + ' '))
            .sort((a, b) => b.length - a.length)[0];
          joined = base ? joinPart(base, typed.slice(base.length).replace(/^[\s—–-]+/, '')) : '';
          wrap.hidden = !t || same;
          join.hidden = !joined || rows.some((it) => norm(it.name) === norm(joined));
          join.querySelector('[data-addname]').textContent = `Add “${joined}”`;
          if (base) join.querySelector('[data-addsub]').textContent = `Inside ${base}`;
          wrap.querySelector('[data-add] [data-addname]').textContent = `Add “${typed}”`;
          if (have) {
            have.querySelectorAll('[data-q]').forEach((el) => { el.hidden = !!t && !el.dataset.q.includes(t) && !t.startsWith(norm(rows[+el.dataset.i].name.split(' — ')[0])); });
            have.hidden = !have.querySelector('[data-q]:not([hidden])');
          }
          if (parts) {
            parts.hidden = !t || !!base;
            parts.querySelectorAll('[data-part]').forEach((b) => {
              b.querySelector('[data-addname]').textContent = `Add “${joinPart(bases[+b.dataset.part], typed)}”`;
            });
          }
          clear();
        };
        const run = runner(fail);
        const make = (btn, name) => run(btn, async () => {
          const nid = await o.add(name, g.id);
          finish({ id: nid, item: { id: nid, name, groupId: g.id }, added: true });
        });
        q.addEventListener('input', filter);
        q.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (!wrap.hidden) make(d.querySelector('[data-add]'), q.value.trim());
        });
        d.querySelector('[data-add]').addEventListener('click', (e) => make(e.currentTarget, q.value.trim()));
        join.addEventListener('click', (e) => make(e.currentTarget, joined));
        d.querySelectorAll('[data-part]').forEach((b) => b.addEventListener('click', () => make(b, joinPart(bases[+b.dataset.part], q.value))));
        d.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => finish({ id: all[+b.dataset.i].id, item: all[+b.dataset.i], added: false })));
        filter();
        show(q);
      }

      document.body.appendChild(d);
      drawList('');
    });
  }
  window.uiPick = uiPick;

  /* The icon chooser (21 Nov 2026, from Diary, where themes, questions and calendars used to take a typed
     emoji). Tom doesn't want emoji as icons, so a thing he names picks one of the shared icons instead.

       const name = await uiPickIcon({ title: 'Icon for Sport', current: 'ball-football',
                                       names: ['ball-football', 'golf', …],   // leave out for every icon
                                       none: 'No icon' });                     // leave out: no "No icon"
       // name = the icon picked, '' for "No icon", or null when closed.

     A search box (label, no placeholder) filters by the icon's name as you type ("ball" finds the balls);
     the grid shows the matches, the current one ringed. It opens on top like uiPick, so closing it leaves
     what's underneath as it was. */
  function uiPickIcon(o) {
    o = o || {};
    const all = (o.names || (window.uiIcon && window.uiIcon.names) || []).filter((n) => !window.uiIcon || window.uiIcon.has(n));
    return new Promise((resolve) => {
      const id = 'ui-pick-' + ++seq;
      const d = document.createElement('dialog');
      d.className = 'ui-sheet ui-pick ui-iconpick';
      d.setAttribute('aria-labelledby', id + '-t');
      let done = false;
      const finish = (v) => { if (done) return; done = true; if (d.open) d.close(); d.remove(); resolve(v); };
      d.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
      d.addEventListener('close', () => finish(null));
      d.addEventListener('click', (e) => { if (e.target === d) finish(null); });
      const words = (n) => n.replace(/-/g, ' ');
      d.innerHTML = `<header><h2 id="${id}-t">${esc(o.title || 'Pick an icon')}</h2>
          <button class="ui-btn quiet icon small" type="button" data-close aria-label="Close">${icon('x') || '×'}</button></header>
        <label class="ui-field ui-pick-search"><span>${esc(o.label || 'Find an icon')}</span>${searchBox()}</label>
        <div class="body"><div class="ui-iconpick-grid">${all.map((n) =>
          `<button type="button" class="ui-btn quiet icon" data-icon="${esc(n)}" aria-label="${esc(words(n))}" title="${esc(words(n))}" aria-pressed="${n === o.current}">${icon(n, 'lg')}</button>`).join('')}</div>
          <p class="ui-hint" data-nothing hidden>No icon called that.</p>
          ${o.none ? `<div class="ui-actions"><button type="button" class="ui-btn" data-icon="">${esc(o.none)}</button></div>` : ''}</div>`;
      d.querySelector('[data-close]').addEventListener('click', () => finish(null));
      d.querySelectorAll('[data-icon]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.icon)));
      const q = d.querySelector('.ui-pick-search input'), btns = [...d.querySelectorAll('.ui-iconpick-grid [data-icon]')], none = d.querySelector('[data-nothing]');
      q.addEventListener('input', () => {
        const t = q.value.trim().toLowerCase();
        let shown = 0;
        btns.forEach((b) => { const hit = !t || words(b.dataset.icon).includes(t); b.hidden = !hit; if (hit) shown++; });
        none.hidden = shown > 0;
      });
      q.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const left = btns.filter((b) => !b.hidden);
        if (left.length === 1) finish(left[0].dataset.icon);
      });
      document.body.appendChild(d);
      d.showModal();
      if (matchMedia('(pointer: fine)').matches) q.focus(); else d.querySelector('[data-close]').focus();
    });
  }
  window.uiPickIcon = uiPickIcon;
})();
