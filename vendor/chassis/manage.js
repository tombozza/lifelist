/* COPY of sites/_shared/chassis/manage.js — edit the source there and run node _shared/sync.mjs */
/* The manage list: add, rename, rearrange, move and delete the person's own things, the same way in every app.

   Source: sites/_shared/chassis/manage.js (copied into each app with the chassis by node _shared/sync.mjs).
   Tom, 21 Nov 2026: "I'm really frustrated with being on an app and having to default to Claude to add something
   I need in the app", and "make sure the solution is reusable across all apps as part of the component library".
   The audit that day (briefs/manage-audit-2026-11-21.html) found the same gaps in nearly every app: things you can
   add but never rename, groups fixed in the code, no order of your own, no way to move a thing to another group,
   and deletes with no undo. This is the one answer. Built from House Book's Packing Organise page (drag by the
   handle with a finger, ⋯ to rename/move/delete, tick several) and the chassis's uiAsk, uiPick, uiToast, uiFuzzy.

   Load as a plain script after icons.js, picker.js, ui.js and fuzzy.js:
     <script src="vendor/chassis/manage.js"></script>
   Its look is .ui-manage in components.css.

   The app owns the data and saves it; the list draws it and calls back. Every callback may be async; when it
   finishes the list draws again from groups()/items(), so pass functions that read the app's current data.
   Leave a callback out and that action isn't offered.

     const list = uiManage(el, {
       noun: 'thing', nouns: 'things',              // words for the rows ("Add thing", "3 things")
       groupNoun: 'category',                       // words for the groups
       groups: () => [{ id: 'clothes', name: 'Clothes', fixed: true,   // fixed: can be renamed, not deleted (noRename: not that either)
                        items: [{ id: 7, name: 'Swim shorts', sub: 'Kept in the chest of drawers' }] }],
       // or, for one list with no groups:   items: () => [{ id, name, sub }],
       order: true,                                 // the person's own order: drag handle, Move up/down/to top
       groupOrder: true,                            // the same for the groups
       add: async (name, groupId) => {},            // a new thing in that group
       addGroup: async (name) => newGroupId,        // a new group (also offered inside Move to…)
       rename: async (item, name) => {},
       renameGroup: async (group, name) => {},
       move: async (ids, toGroupId, index) => {},   // reorder and move between groups. index is the place in the
                                                    // target group's list once the moved ones are taken out
       moveGroup: async (groupId, index) => {},
       remove: async (items) => undoFn,             // answer a function to put them back: the toast offers Undo
       removeGroup: async (group, { moveTo, loose }) => undoFn,   // moveTo: the group its things go to; loose: they stay
                                                    // in no group; neither: they're deleted too
       loose: { label, sub },                       // things can live in no group (trips, tags): deleting a group offers
                                                    // "Keep the places" (Bozza HQ's trips, 22 Nov 2026)
       permanent: false,                            // true when the app has no bin and no undo: deleting asks first
       open: (item) => {},                          // tapping a row opens the app's own sheet (default: rename)
       actions: [{ label: 'Kept in…', icon: 'map-pin', fn: async (items) => {} }],   // extra jobs, one or many
       select: true,                                // Select button: tick several, then move or delete them together
       empty: 'Nothing here yet',
     });
     list.refresh();       // after the app changed the data itself
     list.destroy();

     await uiManage.sheet({ title: 'Organise', ...same options });   // the whole list in its own page-sized sheet,
                                                                     // so a busy screen keeps just an Organise button

   What it does, so every app behaves the same:
   - Add: in a list with groups, each group has a quiet "Add thing" button that opens a field and its button in
     place; a list with no groups shows the field all the time. Enter adds and keeps the cursor there for the next.
     As you type, things you already have show under the box; a name you already have in this group says so
     instead of making a copy, and one in another group can be moved here with a tap.
   - Rename: ⋯ › Rename, or tap the row when there's no open().
   - Rearrange: drag the handle (finger or mouse; the page or sheet scrolls near its edges). A line shows where
     it will land; dropping on another group's heading or empty box moves it there. Keyboard: arrow keys on the
     handle, or ⋯ › Move up / Move down / Move to top.
   - Move to…: the picker sheet, every group, with Add "…" for a new one.
   - Delete: goes at once, with Undo when remove() answers one (rule 1 of "Same job, same way"). Asks first only
     when permanent is set. A group with things in it asks where they should go.
   - Select: tick boxes on the rows and the action bar (Move to…, Delete, the extra actions, Select all, Done).
   - Redraws keep the scroll position and the focus (a click never moves the page). */
(function (g) {
  'use strict';
  if (g.uiManage) return;
  const doc = g.document;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const icon = (n) => (g.uiIcon ? g.uiIcon(n) : '');
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
  const toast = (m, o) => (g.uiToast ? g.uiToast(m, o) : null);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const scrollParent = (el) => {
    for (let p = el && el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p).overflowY;
      if ((s === 'auto' || s === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
  };
  let seq = 0;

  function uiManage(el, o) {
    o = Object.assign({ noun: 'thing', groupNoun: 'group', select: true, empty: 'Nothing here yet' }, o || {});
    const nouns = o.nouns || o.noun + 's', groupNouns = o.groupNouns || o.groupNoun + 's';
    const grouped = !!o.groups;
    const uid = 'ui-m' + ++seq;
    const st = { selecting: false, sel: new Set(), addOpen: grouped ? null : '', addText: {}, busy: false };

    const data = () => {
      if (grouped) return (typeof o.groups === 'function' ? o.groups() : o.groups) || [];
      const items = (typeof o.items === 'function' ? o.items() : o.items) || [];
      return [{ id: '', name: '', items }];
    };
    const allItems = () => data().flatMap((gr) => (gr.items || []).map((it) => ({ it, gr })));
    const find = (id) => allItems().find((x) => String(x.it.id) === String(id));
    const groupOf = (id) => data().find((gr) => String(gr.id) === String(id));
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const canMoveGroups = () => grouped && o.move && (data().length > 1 || o.addGroup);
    const canPick = () => o.select && (o.remove || canMoveGroups() || (o.actions || []).length);

    // ── Drawing ─────────────────────────────────────────────────────────────────
    function rowHTML(it, gr) {
      const id = esc(it.id), name = esc(it.name);
      const sub = it.sub ? `<span class="sub">${esc(it.sub)}</span>` : '';
      const main = st.selecting
        ? `<label class="check main"><input type="checkbox" data-tick="${id}" ${st.sel.has(String(it.id)) ? 'checked' : ''}><span class="ui-mname"><span>${name}</span>${sub}</span></label>`
        : (o.open || o.rename) && !(it.noRename && !o.open)
          ? `<button type="button" class="main" data-open="${id}"><span>${name}</span>${sub}</button>`
          : `<span class="main"><span>${name}</span>${sub}</span>`;
      const grip = !st.selecting && (o.order || canMoveGroups())
        ? `<button type="button" class="ui-btn quiet icon small ui-grip" data-grip="${id}" aria-label="Move ${name}. Drag, or use the arrow keys" aria-describedby="${uid}-hint">${icon('grip-vertical') || '⋮⋮'}</button>` : '';
      const menu = !st.selecting && hasRowMenu(it, gr)
        ? `<button type="button" class="ui-btn quiet icon small" data-menu="${id}" aria-label="More for ${name}">${icon('dots') || '…'}</button>` : '';
      return `<li class="ui-row ui-mrow" data-id="${id}">${main}${grip}${menu}</li>`;
    }
    function hasRowMenu(it) {
      return !!(o.open || (o.rename && !it.noRename) || canMoveGroups() || o.order || (o.remove && !it.fixed) || (o.actions || []).length);
    }
    function addHTML(gr) {
      if (!o.add || gr.noAdd) return '';
      const gid = esc(gr.id);
      if (st.addOpen !== String(gr.id)) {
        return `<div class="ui-actions"><button type="button" class="ui-btn quiet small" data-addopen="${gid}">${icon('plus')}<span>Add ${esc(o.noun)}</span></button></div>`;
      }
      return `<form class="ui-madd" data-addform="${gid}">
          <div class="ui-actions"><label class="ui-field"><span>New ${esc(o.noun)}${grouped ? ` in ${esc(gr.name)}` : ''}</span>
            <input class="ui-input" data-addin="${gid}" value="${esc(st.addText[gr.id] || '')}" autocomplete="off" enterkeyhint="done"></label>
            <button type="submit" class="ui-btn primary">Add</button>
            ${grouped ? `<button type="button" class="ui-btn quiet icon" data-addclose aria-label="Close">${icon('x') || '×'}</button>` : ''}</div>
          <div class="ui-mmatches" data-matches="${gid}" aria-live="polite"></div></form>`;
    }
    function groupHTML(gr) {
      const items = gr.items || [];
      const list = items.length
        ? `<div class="ui-card flat"><ul class="ui-list" data-drop="${esc(gr.id)}">${items.map((it) => rowHTML(it, gr)).join('')}</ul></div>`
        : `<div class="ui-mempty" data-drop="${esc(gr.id)}">${esc(gr.empty || o.empty)}</div>`;
      if (!grouped) return `<section class="ui-stack ui-mgroup" data-g="">${list}${addHTML(gr)}</section>`;
      const name = esc(gr.name);
      const ggrip = !st.selecting && o.groupOrder && o.moveGroup && data().length > 1
        ? `<button type="button" class="ui-btn quiet icon small ui-grip" data-ggrip="${esc(gr.id)}" aria-label="Move ${name}. Drag, or use the arrow keys" aria-describedby="${uid}-hint">${icon('grip-vertical') || '⋮⋮'}</button>` : '';
      const gmenu = !st.selecting && ((o.renameGroup && !gr.noRename) || (o.groupOrder && o.moveGroup) || (o.removeGroup && !gr.fixed))
        ? `<button type="button" class="ui-btn quiet icon small" data-gmenu="${esc(gr.id)}" aria-label="More for ${name}">${icon('dots') || '…'}</button>` : '';
      return `<section class="ui-stack ui-mgroup" data-g="${esc(gr.id)}">
          <div class="ui-head ui-mhead" data-drop="${esc(gr.id)}"><h3 class="ui-label">${name} <span class="ui-mcount">${items.length}</span></h3>
            <span class="ui-spacer"></span>${ggrip}${gmenu}</div>
          ${list}${st.selecting ? '' : addHTML(gr)}</section>`;
    }
    function html() {
      const groups = data();
      const tools = canPick() && !st.selecting
        ? `<div class="ui-actions end ui-mtools"><button type="button" class="ui-btn quiet small" data-select>${icon('list-check')}<span>Select</span></button></div>` : '';
      const addGroup = grouped && o.addGroup && !st.selecting
        ? `<div class="ui-actions"><button type="button" class="ui-btn" data-addgroup>${icon('plus')}<span>New ${esc(o.groupNoun)}</span></button></div>` : '';
      const n = st.sel.size;
      const bar = st.selecting ? `<div class="ui-actionbar"><span class="count">${n ? `${count(n, o.noun, nouns)} picked` : `Pick ${nouns}`}</span>
          <button type="button" class="ui-btn quiet small" data-selall>Select all</button>
          ${n && canMoveGroups() ? '<button type="button" class="ui-btn small" data-selmove>Move to…</button>' : ''}
          ${n ? (o.actions || []).map((a, i) => `<button type="button" class="ui-btn small" data-selact="${i}">${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span></button>`).join('') : ''}
          ${n && o.remove ? '<button type="button" class="ui-btn small danger" data-seldel>Delete</button>' : ''}
          <button type="button" class="ui-btn primary small" data-seldone>Done</button></div>` : '';
      const hint = o.order || o.move ? `<p class="ui-mhidden" id="${uid}-hint">Arrow up or down moves it one place.</p>` : '';   // only where order or moving is offered
      return `${tools}${groups.map(groupHTML).join('')}${addGroup}${hint}${bar}`;
    }

    // Draw again, keeping the scroll position and what had the focus.
    function draw() {
      const sp = scrollParent(el), y = sp ? sp.scrollTop : g.scrollY;
      const a = doc.activeElement, inside = a && el.contains(a);
      const key = inside ? ['data-addin', 'data-tick', 'data-grip', 'data-ggrip', 'data-menu', 'data-gmenu', 'data-addopen', 'data-select', 'data-seldone']
        .map((k) => (a.hasAttribute(k) ? `[${k}="${CSS.escape(a.getAttribute(k))}"]` : null)).find(Boolean) : null;
      const caret = a && a.matches && a.matches('[data-addin]') ? a.selectionStart : null;
      el.classList.add('ui-manage');
      el.classList.toggle('selecting', st.selecting);
      el.innerHTML = html();
      if (sp) sp.scrollTop = y; else if (g.scrollY !== y) g.scrollTo(g.scrollX, y);
      if (key) {
        const f = el.querySelector(key);
        if (f) { f.focus({ preventScroll: true }); if (caret != null && f.setSelectionRange) f.setSelectionRange(caret, caret); }
      }
      el.querySelectorAll('[data-addin]').forEach(showMatches);
    }

    // Run one of the app's callbacks, then draw again. A failure says so and leaves things as they were.
    // A failed save answers FAILED, so the caller doesn't also say "Deleted" or "moved" over the error toast.
    const FAILED = {};
    async function run(fn) {
      try { return await fn(); }
      catch (e) { toast((e && e.message) || "Couldn't save that. Try again.", { bad: true }); return FAILED; }
      finally { draw(); }
    }

    // ── Adding ──────────────────────────────────────────────────────────────────
    function showMatches(input) {
      const gid = input.dataset.addin, box = el.querySelector(`[data-matches="${CSS.escape(gid)}"]`);
      if (!box) return;
      const t = input.value.trim();
      if (!t) { box.innerHTML = ''; return; }
      const all = allItems();
      const hits = (g.uiFuzzy ? g.uiFuzzy.find(all, t, (x) => [x.it.name]) : all.filter((x) => norm(x.it.name).includes(norm(t)))).slice(0, 4);
      if (!hits.length) { box.innerHTML = ''; return; }
      box.innerHTML = `<span class="ui-hint">Already have:</span>${hits.map((x) => {
        const here = String(x.gr.id) === gid;
        const where = grouped ? (here ? ' · here' : ` · ${esc(x.gr.name)}`) : '';
        const movable = !here && grouped && o.move;
        return `<button type="button" class="ui-chip small" data-match="${esc(x.it.id)}" ${movable ? '' : 'aria-disabled="true"'}
          title="${movable ? `Move it to this ${esc(o.groupNoun)}` : ''}">${esc(x.it.name)}${where}</button>`;
      }).join('')}`;
    }
    async function addFrom(gid) {
      const input = el.querySelector(`[data-addin="${CSS.escape(gid)}"]`);
      const name = input ? input.value.trim() : '';
      if (!name || st.busy) return;
      const gr = groupOf(gid) || data()[0];
      const dup = (gr.items || []).find((it) => norm(it.name) === norm(name));
      if (dup && !o.duplicates) { toast(`${dup.name} is already ${grouped ? `in ${gr.name}` : 'in the list'}`); flash(dup.id); return; }
      st.busy = true;
      st.addText[gid] = '';
      await run(async () => { await o.add(name, grouped ? gr.id : undefined); });
      st.busy = false;
      const again = el.querySelector(`[data-addin="${CSS.escape(gid)}"]`);
      if (again) { again.value = ''; again.focus({ preventScroll: true }); showMatches(again); }
    }
    function flash(id) {
      const r = el.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
      if (!r) return;
      r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      r.classList.remove('ui-mflash'); void r.offsetWidth; r.classList.add('ui-mflash');
    }

    // ── Row and group jobs ──────────────────────────────────────────────────────
    async function rename(it) {
      const name = await g.uiAsk({ title: `Rename ${it.name}`, input: { label: 'Name', value: it.name },
        buttons: [{ label: 'Cancel', value: null }, { label: 'Save', value: true, primary: true }] });
      if (!name || name === it.name) return;
      await run(() => o.rename(it, name));
    }
    async function renameGroup(gr) {
      const name = await g.uiAsk({ title: `Rename ${gr.name}`, input: { label: 'Name', value: gr.name },
        buttons: [{ label: 'Cancel', value: null }, { label: 'Save', value: true, primary: true }] });
      if (!name || name === gr.name) return;
      await run(() => o.renameGroup(gr, name));
    }
    // Pick a group (the picker sheet). Add "…" makes a new one when the app can.
    async function pickGroup(title, current, not) {
      const items = data().filter((gr) => String(gr.id) !== String(not)).map((gr) => ({ id: gr.id, name: gr.name, sub: count((gr.items || []).length, o.noun, nouns) }));
      const r = await g.uiPick({ title, label: `Find or add a ${o.groupNoun}`, items, current,
        add: o.addGroup ? async (name) => o.addGroup(name) : undefined, addHint: `A new ${o.groupNoun}` });
      return r ? r.id : null;
    }
    async function moveTo(ids) {
      const first = find(ids[0]);
      const to = await pickGroup(ids.length === 1 && first ? `Move ${first.it.name} to` : `Move ${count(ids.length, o.noun, nouns)} to`,
        ids.length === 1 && first ? first.gr.id : null);
      if (to == null) { draw(); return; }
      const target = groupOf(to);
      if (await run(() => o.move(ids, to, target ? (target.items || []).filter((it) => !ids.includes(String(it.id))).length : 0)) === FAILED) return;
      st.sel.clear();
      const gr = groupOf(to);
      toast(`${ids.length === 1 && first ? first.it.name : count(ids.length, o.noun, nouns)} moved to ${gr ? gr.name : 'the new one'}`);
    }
    async function step(id, by) {
      const x = find(id); if (!x) return;
      const list = x.gr.items || [], i = list.findIndex((it) => String(it.id) === String(id));
      const to = by === 'top' ? 0 : i + by;
      if (to < 0 || to >= list.length || to === i) return;
      await run(() => o.move([String(id)], x.gr.id, to));
    }
    async function stepGroup(id, by) {
      const list = data(), i = list.findIndex((gr) => String(gr.id) === String(id));
      const to = by === 'top' ? 0 : i + by;
      if (i < 0 || to < 0 || to >= list.length || to === i) return;
      await run(() => o.moveGroup(list[i].id, to));
    }
    async function remove(ids) {
      const xs = ids.map(find).filter(Boolean).filter((x) => !x.it.fixed);
      if (!xs.length) return;
      const what = xs.length === 1 ? xs[0].it.name : count(xs.length, o.noun, nouns);
      if (o.permanent && !(await g.uiConfirm({ title: `Delete ${what}?`, body: 'This can’t be undone.', ok: 'Delete' }))) return;
      const undo = await run(() => o.remove(xs.map((x) => x.it)));
      st.sel.clear();
      if (st.selecting && !allItems().length) st.selecting = false;
      draw();
      if (undo === FAILED) return;
      toast(`Deleted ${what}`, typeof undo === 'function' ? { undo: () => run(undo) } : undefined);
    }
    async function removeGroup(gr) {
      const n = (gr.items || []).length;
      let moveTo = null, loose = false;
      if (n) {
        const buttons = [];
        if (o.move && data().length > 1) buttons.push({ label: 'Move them to…', sub: `Pick another ${o.groupNoun} first`, value: 'move' });
        if (o.loose) buttons.push({ label: o.loose.label || `Keep the ${nouns}`, sub: o.loose.sub || `They stay, in no ${o.groupNoun}`, value: 'loose' });
        if (o.remove) buttons.push({ label: `Delete them too`, sub: `The ${nouns} go as well`, value: 'delete', danger: true });
        buttons.push({ label: `Keep ${gr.name}`, value: null });
        const v = await g.uiAsk({ title: `Delete ${gr.name}?`, body: `It has ${count(n, o.noun, nouns)} in it.`, buttons });
        if (!v) return;
        loose = v === 'loose';
        if (v === 'move') { moveTo = await pickGroup(`Move ${count(n, o.noun, nouns)} to`, null, gr.id); if (moveTo == null) return; }
      } else if (o.permanent && !(await g.uiConfirm({ title: `Delete ${gr.name}?`, body: 'This can’t be undone.', ok: 'Delete' }))) return;
      const undo = await run(() => o.removeGroup(gr, { moveTo, loose }));
      if (undo === FAILED) return;
      const to = moveTo != null && groupOf(moveTo);
      toast(`Deleted ${gr.name}${to ? `, ${count(n, o.noun, nouns)} moved to ${to.name}` : ''}`, typeof undo === 'function' ? { undo: () => run(undo) } : undefined);
    }
    async function rowMenu(id) {
      const x = find(id); if (!x) return;
      const { it, gr } = x, list = gr.items || [], i = list.indexOf(it);
      const b = [];
      if (o.open) b.push({ label: 'Open', sub: 'See and change everything about it', value: 'open' });
      if (o.rename && !it.noRename) b.push({ label: 'Rename', sub: 'Change its name', value: 'rename' });
      if (canMoveGroups()) b.push({ label: 'Move to…', sub: `Another ${o.groupNoun}`, value: 'moveto' });
      if (o.order && list.length > 1) {
        if (i > 0) b.push({ label: 'Move up', value: 'up' });
        if (i < list.length - 1) b.push({ label: 'Move down', value: 'down' });
        if (i > 1) b.push({ label: 'Move to the top', value: 'top' });
      }
      (o.actions || []).forEach((a, k) => { if (!a.when || a.when(it)) b.push({ label: a.label, sub: a.sub, value: 'act' + k }); });
      if (o.remove && !it.fixed) b.push({ label: 'Delete', sub: o.permanent ? 'For good' : 'You can undo it straight after', value: 'delete', danger: true });
      // say why, so a missing Rename or Delete isn't a mystery (fixedWhy, like a group's)
      if (it.fixedWhy && ((o.remove && it.fixed) || (o.rename && it.noRename))) b.push({ label: o.remove && it.fixed ? (o.rename && it.noRename ? 'Can’t be renamed or deleted' : 'Can’t be deleted') : 'Can’t be renamed', sub: it.fixedWhy, value: null });
      if (!b.length) return;
      b.forEach((x2) => { if (!x2.sub) x2.sub = ' '; });
      const v = await g.uiAsk({ title: it.name, buttons: b });
      if (!v) return;
      if (v === 'open') o.open(it);
      else if (v === 'rename') rename(it);
      else if (v === 'moveto') moveTo([String(it.id)]);
      else if (v === 'up') step(it.id, -1);
      else if (v === 'down') step(it.id, 1);
      else if (v === 'top') step(it.id, 'top');
      else if (v === 'delete') remove([String(it.id)]);
      else if (v.startsWith('act')) run(() => o.actions[+v.slice(3)].fn([it]));
    }
    async function groupMenu(id) {
      const gr = groupOf(id); if (!gr) return;
      const list = data(), i = list.findIndex((x) => String(x.id) === String(gr.id)), b = [];   // by id: groups() may build new objects each call
      if (o.renameGroup && !gr.noRename) b.push({ label: 'Rename', sub: 'Change its name', value: 'rename' });
      if (o.groupOrder && o.moveGroup && list.length > 1) {
        if (i > 0) b.push({ label: 'Move up', sub: ' ', value: 'up' });
        if (i < list.length - 1) b.push({ label: 'Move down', sub: ' ', value: 'down' });
        if (i > 1) b.push({ label: 'Move to the top', sub: ' ', value: 'top' });
      }
      if (o.removeGroup && !gr.fixed) b.push({ label: 'Delete', sub: (gr.items || []).length ? `You choose where its ${nouns} go` : 'It’s empty', value: 'delete', danger: true });
      if (gr.fixed && o.removeGroup) b.push({ label: gr.noRename ? 'Can’t be renamed or deleted' : 'Can’t be deleted', sub: gr.fixedWhy || (gr.noRename ? 'The app needs this one as it is.' : 'The app needs this one. You can rename it.'), value: null });
      const v = await g.uiAsk({ title: gr.name, buttons: b });
      if (v === 'rename') renameGroup(gr);
      else if (v === 'up') stepGroup(id, -1);
      else if (v === 'down') stepGroup(id, 1);
      else if (v === 'top') stepGroup(id, 'top');
      else if (v === 'delete') removeGroup(gr);
    }
    async function addGroup() {
      const name = await g.uiAsk({ title: `New ${o.groupNoun}`, input: { label: 'Name' },
        buttons: [{ label: 'Cancel', value: null }, { label: 'Add', value: true, primary: true }] });
      if (!name) return;
      if (data().some((gr) => norm(gr.name) === norm(name))) { toast(`There’s already a ${o.groupNoun} called ${name}`); return; }
      const id = await run(() => o.addGroup(name));
      if (id != null && id !== FAILED && o.add) { st.addOpen = String(id); draw(); }
    }

    // ── Dragging ────────────────────────────────────────────────────────────────
    // Drag by the handle, finger or mouse (pointer events: the browser's own draggable is patchy on a phone).
    // A copy follows the pointer; a line shows where it lands; the page or sheet scrolls near its edges.
    function drag(e, handle, kind) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const id = kind === 'row' ? handle.dataset.grip : handle.dataset.ggrip;
      const src = kind === 'row' ? handle.closest('.ui-mrow') : handle.closest('.ui-mgroup');
      const box = (kind === 'row' ? src : src.querySelector('.ui-mhead')).getBoundingClientRect();
      const ghost = doc.createElement(kind === 'row' ? 'ul' : 'div');
      ghost.className = 'ui-mghost' + (kind === 'row' ? ' ui-list' : '');
      ghost.innerHTML = kind === 'row' ? src.outerHTML : `<div class="ui-head">${src.querySelector('.ui-mhead').innerHTML}</div>`;
      ghost.style.setProperty('--w', box.width + 'px');
      const host = el.closest('dialog[open]') || doc.body;
      host.append(ghost);
      const dx = e.clientX - box.left, dy = e.clientY - box.top, sp = scrollParent(el);
      let x = e.clientX, y = e.clientY, raf = 0, at = null, moved = false;
      const clear = () => el.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-into'));
      const place = () => { ghost.style.setProperty('--x', (x - dx) + 'px'); ghost.style.setProperty('--y', (y - dy) + 'px'); };
      const aim = () => {
        clear(); at = null;
        const under = doc.elementFromPoint(x, y);
        if (!under || !el.contains(under)) return;
        if (kind === 'group') {
          const sec = under.closest('.ui-mgroup');
          if (!sec || sec === src) return;
          const r = sec.getBoundingClientRect(), after = y > r.top + r.height / 2;
          sec.classList.add(after ? 'drop-after' : 'drop-before');
          at = { gid: sec.dataset.g, after };
          return;
        }
        const row = under.closest('.ui-mrow');
        if (row && row !== src && o.order) {
          const r = row.getBoundingClientRect(), after = y > r.top + r.height / 2;
          row.classList.add(after ? 'drop-after' : 'drop-before');
          at = { gid: row.closest('.ui-mgroup').dataset.g, row: row.dataset.id, after };
          return;
        }
        const zone = under.closest('[data-drop]') || (row && row.closest('[data-drop]'));
        if (zone && (canMoveGroups() || o.order)) {
          const gid = zone.dataset.drop, same = gid === src.closest('.ui-mgroup').dataset.g;
          if (same && !o.order) return;
          if (!same && !canMoveGroups()) return;
          (zone.closest('.ui-mgroup') || zone).classList.add('drop-into');
          at = { gid, end: true };
        }
      };
      const tick = () => {
        const edge = 64;
        const r = sp ? sp.getBoundingClientRect() : { top: 0, bottom: g.innerHeight };
        const v = y < r.top + edge ? -12 : y > r.bottom - edge ? 12 : 0;
        if (v) { if (sp) sp.scrollTop += v; else g.scrollBy(0, v); aim(); }
        raf = requestAnimationFrame(tick);
      };
      place();
      src.classList.add('ui-mdragfrom'); doc.body.classList.add('ui-mdragging');
      raf = requestAnimationFrame(tick);
      try { handle.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
      handle.onpointermove = (ev) => { x = ev.clientX; y = ev.clientY; moved = true; place(); aim(); };
      const end = (ok) => {
        cancelAnimationFrame(raf);
        handle.onpointermove = handle.onpointerup = handle.onpointercancel = null;
        ghost.remove(); clear(); src.classList.remove('ui-mdragfrom'); doc.body.classList.remove('ui-mdragging');
        if (!ok || !moved || !at) return;
        if (kind === 'group') {
          const list = data().filter((gr) => String(gr.id) !== String(id));
          let to = list.findIndex((gr) => String(gr.id) === at.gid);
          if (to < 0) return;
          if (at.after) to += 1;
          const from = data().findIndex((gr) => String(gr.id) === String(id));
          if (to !== from) run(() => o.moveGroup(data()[from].id, to));
          return;
        }
        const target = groupOf(at.gid) || (grouped ? null : data()[0]);
        if (!target) return;
        const rest = (target.items || []).filter((it) => String(it.id) !== String(id));
        let to = rest.length;
        if (at.row) { to = rest.findIndex((it) => String(it.id) === at.row); if (to < 0) to = rest.length; else if (at.after) to += 1; }
        const x0 = find(id);
        const from = x0 ? (x0.gr.items || []).findIndex((it) => String(it.id) === String(id)) : -1;
        const sameGroup = x0 && String(x0.gr.id) === String(target.id);
        if (sameGroup && from === to) return;
        run(() => o.move([String(id)], target.id, to)).then(() => {
          if (!sameGroup) toast(`${x0 ? x0.it.name : 'It'} moved to ${target.name}`);
        });
      };
      handle.onpointerup = () => end(true);
      handle.onpointercancel = () => end(false);
    }

    // ── Wiring (one set of listeners on the container; rows are redrawn freely) ──
    const onClick = (e) => {
      const t = e.target.closest('button, input');
      if (!t || !el.contains(t)) return;
      const d = t.dataset;
      if (d.open != null) { const x = find(d.open); if (!x) return; if (o.open) o.open(x.it); else if (o.rename && !x.it.noRename) rename(x.it); }
      else if (d.menu != null) rowMenu(d.menu);
      else if (d.gmenu != null) groupMenu(d.gmenu);
      else if (d.addopen != null) {
        st.addOpen = d.addopen; draw();
        const f = el.querySelector(`[data-addin="${CSS.escape(d.addopen)}"]`);
        if (f) { f.focus({ preventScroll: true }); f.setSelectionRange(f.value.length, f.value.length); }
      }
      else if (d.addclose != null) closeAdd();
      else if (d.addgroup != null) addGroup();
      else if (d.match != null) {
        if (t.getAttribute('aria-disabled') === 'true') { flash(d.match); return; }
        const form = t.closest('[data-addform]'), gid = form.dataset.addform, gr = groupOf(gid), x = find(d.match);
        if (!x || !gr) return;
        st.addText[gid] = '';
        run(() => o.move([String(x.it.id)], gr.id, (gr.items || []).length)).then(() => toast(`${x.it.name} moved to ${gr.name}`));
      }
      else if (d.select != null) { st.selecting = true; st.sel.clear(); draw(); }
      else if (d.seldone != null) { st.selecting = false; st.sel.clear(); draw(); }
      else if (d.selall != null) { const all = allItems().map((x) => String(x.it.id)); if (st.sel.size === all.length) st.sel.clear(); else all.forEach((i) => st.sel.add(i)); draw(); }
      else if (d.selmove != null) moveTo([...st.sel]);
      else if (d.seldel != null) remove([...st.sel]);
      else if (d.selact != null) { const items = [...st.sel].map(find).filter(Boolean).map((x) => x.it); run(() => o.actions[+d.selact].fn(items)).then(() => { st.sel.clear(); draw(); }); }
    };
    // Closing the add box drops what was half typed in it.
    const closeAdd = () => { if (st.addOpen != null) st.addText[st.addOpen] = ''; st.addOpen = null; draw(); };
    const onChange = (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.tick != null) {
        if (t.checked) st.sel.add(t.dataset.tick); else st.sel.delete(t.dataset.tick);
        draw();   // the action bar's count and buttons
      }
    };
    const onInput = (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.addin != null) { st.addText[t.dataset.addin] = t.value; showMatches(t); }
    };
    const onSubmit = (e) => {
      const f = e.target.closest('[data-addform]');
      if (!f) return;
      e.preventDefault();
      addFrom(f.dataset.addform);
    };
    const onKey = (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.addin != null && e.key === 'Escape' && grouped) { e.preventDefault(); e.stopPropagation(); closeAdd(); return; }
      const up = e.key === 'ArrowUp', down = e.key === 'ArrowDown';
      if (!up && !down) return;
      if (t.dataset && t.dataset.grip != null) {
        e.preventDefault();
        const x = find(t.dataset.grip);
        if (!x) return;
        const list = x.gr.items || [], i = list.indexOf(x.it);
        if (o.order && ((up && i > 0) || (down && i < list.length - 1))) { step(x.it.id, up ? -1 : 1); return; }
        // At the end of its group: on into the next or previous group.
        if (canMoveGroups()) {
          const gs = data(), gi = gs.findIndex((g2) => String(g2.id) === String(x.gr.id)), next = gs[gi + (up ? -1 : 1)];
          if (next) run(() => o.move([String(x.it.id)], next.id, up ? (next.items || []).length : 0));
        }
      } else if (t.dataset && t.dataset.ggrip != null) { e.preventDefault(); stepGroup(t.dataset.ggrip, up ? -1 : 1); }
    };
    const onDown = (e) => {
      const h = e.target.closest('[data-grip], [data-ggrip]');
      if (h && el.contains(h)) drag(e, h, h.dataset.grip != null ? 'row' : 'group');
    };
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    el.addEventListener('submit', onSubmit);
    el.addEventListener('keydown', onKey);
    el.addEventListener('pointerdown', onDown);
    draw();

    return {
      refresh: draw,
      select(on) { st.selecting = on !== false; st.sel.clear(); draw(); },
      destroy() {
        el.removeEventListener('click', onClick); el.removeEventListener('change', onChange);
        el.removeEventListener('input', onInput); el.removeEventListener('submit', onSubmit);
        el.removeEventListener('keydown', onKey); el.removeEventListener('pointerdown', onDown);
        el.innerHTML = ''; el.classList.remove('ui-manage', 'selecting');
      },
    };
  }

  // The whole list in its own sheet (a page on a phone), so a screen people use day to day keeps just an
  // "Organise" button (progressive disclosure). Resolves when it's closed. o.onClose runs then too.
  uiManage.sheet = function (o) {
    o = o || {};
    return new Promise((resolve) => {
      const d = doc.createElement('dialog');
      const id = 'ui-ms-' + ++seq;
      d.className = 'ui-sheet page wide';
      d.setAttribute('aria-labelledby', id);
      d.innerHTML = `<header><h2 id="${id}">${esc(o.title || 'Organise')}</h2>
          <button type="button" class="ui-btn primary small" data-done>Done</button></header>
        <div class="body"><div data-list></div></div>`;
      doc.body.append(d);
      const list = uiManage(d.querySelector('[data-list]'), o);
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        list.destroy(); if (d.open) d.close(); d.remove();
        if (o.onClose) o.onClose();
        resolve();
      };
      // Esc in an open add box closes the box (manage's keydown stops it there); Esc anywhere else closes the sheet.
      d.addEventListener('cancel', (e) => { e.preventDefault(); finish(); });
      d.addEventListener('close', finish);
      d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-done]')) finish(); });
      d.showModal();
      d.querySelector('[data-done]').focus();
    });
  };

  g.uiManage = uiManage;
})(window);
