// AI Updates for Life List: the schema, resolve, the handlers against a fake app, and the
// context. Run from the app folder:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { processReply, checkAppSchema, shareContext } from '../vendor/ai-protocol/protocol.js';
import schema, { examples } from '../ai/schema.js';
import { ACTION_TYPES, buildContext, makeHandlers, planAction, resolveItem, matchName, whereOf } from '../ai/logic.js';

const TODAY = '2026-11-12';

function fixture() {
  return {
    themes: [
      { id: 'house', name: 'House', color: '#32ADE6', subThemes: ['Cleaning', 'Maintenance'] },
      { id: 'work', name: 'Work', color: '#007AFF', subThemes: ['Meetings', 'Reports'], focus: 'work' },
      { id: 'garden', name: 'Garden', color: '#34C759', subThemes: ['Lawn', 'Maintenance'] },
      { id: 'admin', name: 'Admin', color: '#5856D6', subThemes: [], hidden: true },
    ],
    tagCategories: [
      { id: 'people', name: 'People', color: '#5856D6', tags: [{ id: 'people-a1', name: 'Jim' }, { id: 'people-a2', name: 'Mum' }] },
      { id: 'people-work-x1y2', name: 'People work', color: '#5856D6', tags: [{ id: 'people-work-x1y2-b1', name: 'Jim' }] },
      { id: 'when', name: 'When', color: '#30B0C7', tags: [{ id: 'when-day', name: 'Day' }, { id: 'when-weekend', name: 'Weekend' }] },
    ],
    smartNotes: [],
    tasks: [
      task({ id: 'mhw3k2a1x9f2q', title: 'Book dentist', kanbanColumn: 'backlog' }),
      task({ id: 'gutter1', title: 'Get gutter quote', themeIds: ['house'], themeId: 'house', tags: ['when-weekend'] }),
      task({ id: 'mhv9z0b7c3d1e', title: 'Boiler service', themeIds: ['house'], themeId: 'house', subTheme: 'Maintenance', notes: 'Annual', tags: ['people-a2'] }),
      task({ id: 'mhu1a2b3c4d5e', title: 'Tax return', themeIds: ['admin'], themeId: 'admin', kanbanColumn: 'live', planDay: TODAY, planOrder: 1 }),
      task({ id: 'xmas1', title: 'Christmas card list', inNotes: true }),
      task({ id: 'ring1', title: 'Ring mum', kanbanColumn: 'live', planDay: null }),
      task({ id: 'ring2', title: 'Ring mum', reviewed: false }),
      task({ id: 'snz1', title: 'Clear the loft', snoozedUntil: '2026-12-01' }),
      task({ id: 'done1', title: 'Pay council tax', status: 'complete', kanbanColumn: 'complete', completedDate: '2026-11-10' }),
      task({ id: 'sched1', title: 'Bins', status: 'scheduled', scheduledFor: '2026-11-16' }),
    ],
  };
}
function task(o) {
  return { themeIds: [], themeId: '', tags: [], subtasks: [], subTheme: '', priority: '', size: 'xs', kanbanColumn: null, status: 'active',
    dueDate: '', doDate: '', notes: '', url: '', createdDate: '2026-11-01', planDay: null, planOrder: 0, reviewed: true, updatedAt: 1, ...o };
}

/** A small stand-in for window.lifeListApp: the same functions, simplified, with a call log. */
function fakeApp(state = fixture()) {
  let n = 0;
  const log = [];
  const find = id => state.tasks.find(t => t.id === id);
  const upd = (id, d) => { const t = find(id); Object.assign(t, d); if (t.planDay && t.kanbanColumn !== 'live' && t.status !== 'complete') t.planDay = null; t.updatedAt = 2; };
  const rec = (fn, impl) => (...args) => { log.push([fn, ...args]); return impl(...args); };
  const app = {
    state, log,
    env: () => ({
      today: TODAY, genId: () => `gen${++n}`, normaliseUrl: s => (!s ? '' : /^[a-z]+:/i.test(s) ? s : `https://${s}`),
      nextPlanOrder: day => state.tasks.filter(t => t.status === 'active' && t.kanbanColumn === 'live' && (day ? t.planDay === day : !t.planDay)).reduce((m, t) => Math.max(m, t.planOrder || 0), 0) + 1,
      nextOccurrenceOnOrAfter: (r, from) => (r.type === 'weekly' ? '2026-11-16' : from),
    }),
    addTask: rec('addTask', d => { const t = task({ ...d, id: `task${++n}`, reviewed: d.reviewed || !!d.kanbanColumn }); state.tasks.push(t); return t; }),
    updateTask: rec('updateTask', upd),
    completeTask: rec('completeTask', id => upd(id, { status: 'complete', kanbanColumn: 'complete', completedDate: TODAY })),
    markWontDo: rec('markWontDo', id => upd(id, { status: 'wont-do', kanbanColumn: null, reviewed: true })),
    planFor: rec('planFor', (id, day) => upd(id, { kanbanColumn: 'live', planDay: day, reviewed: true, inNotes: false, snoozedUntil: '' })),
    moveToColumn: rec('moveToColumn', (id, col) => upd(id, { kanbanColumn: col, reviewed: true, offKanban: false })),
    moveToKanban: rec('moveToKanban', id => upd(id, { kanbanColumn: 'backlog', reviewed: true, offKanban: false, inNotes: false })),
    moveToNotes: rec('moveToNotes', id => upd(id, { inNotes: true, kanbanColumn: null, offKanban: false, reviewed: true })),
    moveToThemedList: rec('moveToThemedList', id => upd(id, { kanbanColumn: null, offKanban: false })),
    backToList: rec('backToList', id => upd(id, { kanbanColumn: null, offKanban: true })),
    snoozeTask: rec('snoozeTask', (id, until) => upd(id, { snoozedUntil: until, kanbanColumn: null, reviewed: true })),
    scheduleOccurrence: rec('scheduleOccurrence', (src, day, k) => { const t = task({ ...src, id: `${src.recurRoot}__${day}`, status: 'scheduled', scheduledFor: day, runCount: k }); state.tasks.push(t); return t; }),
    checkAutoKanban: rec('checkAutoKanban', () => {}),
    checkRecurring: rec('checkRecurring', () => {}),
    saveState: rec('saveState', () => {}),
    render: rec('render', () => {}),
  };
  return app;
}

const block = actions => JSON.stringify({ protocol: 'ai-updates', v: 1, id: '2026-11-12-life-test', apps: { life_list: { v: 1, actions } } });
const item = action => ({ type: action.type, action });
const fns = app => app.log.map(c => c[0]);

// ---------------------------------------------------------------------------------------

test('the schema is valid and every example passes processReply', () => {
  checkAppSchema(schema);
  assert.equal(schema.app, 'life_list'); assert.equal(schema.v, 1); assert.deepEqual(schema.accepts, [1]);
  const covered = new Set();
  for (const ex of examples) {
    const r = processReply(block(ex.actions), schema);
    assert.equal(r.ok, true, ex.title);
    for (const it of r.items) { assert.equal(it.status, 'ready', `${ex.title}: ${it.errors.join('; ')}`); covered.add(it.type); }
  }
  assert.deepEqual([...covered].sort(), Object.keys(schema.actions).sort(), 'an example for every action type');
});

test('the schema is strict: unknown fields and bad values are caught', () => {
  const r = processReply(block([
    { type: 'add_task', title: 'X', colour: 'red' },
    { type: 'move_task', task: 'X', where: 'tomorrow' },
    { type: 'snooze_task', task: 'X', until: '1 Dec' },
    { type: 'add_task', title: 'X', priority: '' },
  ]), schema);
  assert.deepEqual(r.items.map(i => i.status), ['invalid', 'invalid', 'invalid', 'invalid']);
});

test('the handler keys equal the schema action keys', () => {
  assert.deepEqual(Object.keys(makeHandlers(fakeApp())).sort(), Object.keys(schema.actions).sort());
  assert.deepEqual([...ACTION_TYPES].sort(), Object.keys(schema.actions).sort());
});

test('every example resolves against a matching board and applies through the app functions', async () => {
  const app = fakeApp();
  const h = makeHandlers(app);
  const themes = JSON.stringify(app.state.themes), tags = JSON.stringify(app.state.tagCategories);
  for (const ex of examples) for (const a of ex.actions) {
    const res = resolveItem(item(a), app.state, app.env());
    assert.equal(res.ok, true, `${ex.title}: ${res.reason}`);
    await h[a.type](a);
  }
  assert.equal(JSON.stringify(app.state.themes), themes, 'themes untouched');
  assert.equal(JSON.stringify(app.state.tagCategories), tags, 'tags untouched');
});

test('add_task: theme, sub-theme, tags, priority, due, steps, link, and a day', async () => {
  const app = fakeApp(); const h = makeHandlers(app);
  const id = await h.add_task({ type: 'add_task', title: ' Book MOT ', theme: 'house', sub_theme: 'maintenance', tags: ['Weekend', 'Mum'],
    priority: 'high', size: 's', due: '2026-11-30', subtasks: ['Find V5C'], url: 'gov.uk/mot', where: 'day', day: '2026-11-19' });
  const t = app.state.tasks.find(x => x.id === id);
  assert.equal(t.title, 'Book MOT');
  assert.deepEqual(t.themeIds, ['house']); assert.equal(t.themeId, 'house'); assert.equal(t.subTheme, 'Maintenance');
  assert.deepEqual(t.tags, ['when-weekend', 'people-a2']);
  assert.equal(t.priority, 'high'); assert.equal(t.size, 's'); assert.equal(t.dueDate, '2026-11-30');
  assert.equal(t.url, 'https://gov.uk/mot');
  assert.deepEqual(t.subtasks, [{ id: 'gen1', title: 'Find V5C', done: false }]);
  assert.equal(t.kanbanColumn, 'live'); assert.equal(t.planDay, '2026-11-19'); assert.equal(t.planOrder, 1);
  assert.deepEqual(fns(app), ['addTask', 'checkAutoKanban']);
});

test('add_task: where maps onto the real places', async () => {
  const cases = {
    undefined: { kanbanColumn: null, reviewed: false },
    review: { kanbanColumn: null, reviewed: false },
    today: { kanbanColumn: 'live', planDay: TODAY, planOrder: 2 },
    ready: { kanbanColumn: 'live', planDay: null, planOrder: 1 },
    backlog: { kanbanColumn: 'backlog', reviewed: true },
    blocked: { kanbanColumn: 'blocked' },
    list: { kanbanColumn: null, reviewed: true },
    notes: { kanbanColumn: null, inNotes: true, reviewed: true },
    off_board: { kanbanColumn: null, offKanban: true, reviewed: true },
  };
  for (const [where, want] of Object.entries(cases)) {
    const app = fakeApp(); const h = makeHandlers(app);
    const a = { type: 'add_task', title: `T ${where}` }; if (where !== 'undefined') a.where = where;
    const id = await h.add_task(a);
    const t = app.state.tasks.find(x => x.id === id);
    for (const [k, v] of Object.entries(want)) assert.equal(t[k], v, `${where}.${k}`);
    if (where === 'off_board') assert.deepEqual(app.log[1], ['backToList', id]);
  }
  const app = fakeApp();
  const past = planAction({ type: 'add_task', title: 'Late', where: 'day', day: '2026-11-01' }, app.state, app.env());
  assert.equal(past.calls[0].args[0].planDay, TODAY, 'a past day means today');
});

test('add_task with a repeat goes through scheduleOccurrence, like the task window', async () => {
  const app = fakeApp(); const h = makeHandlers(app);
  await h.add_task({ type: 'add_task', title: 'Put the bins out', theme: 'House', repeat: { every: 'week', weekday: 'monday', missed: 'skip' } });
  assert.deepEqual(fns(app), ['scheduleOccurrence', 'saveState', 'checkRecurring', 'render']);
  const [, src, day, runCount] = app.log[0];
  assert.deepEqual(src.recurring, { type: 'weekly', interval: 1, dayOfWeek: 1, onToday: true, missed: 'skip' });
  assert.equal(src.recurRoot, 'gen1'); assert.equal(day, '2026-11-16'); assert.equal(runCount, 1);
  const p = a => planAction({ type: 'add_task', title: 'R', repeat: a }, app.state, app.env());
  assert.deepEqual(p({ every: 'month', day_of_month: 7, interval: 2, on_today: false }).calls[0].args[0].recurring, { type: 'monthly', interval: 2, monthlyMode: 'date', dayOfMonth: 7, onToday: false });
  assert.deepEqual(p({ every: 'month', week_of_month: 1, weekday: 'friday' }).calls[0].args[0].recurring, { type: 'monthly', interval: 1, monthlyMode: 'weekday', weekOfMonth: 1, dayOfWeek: 5, onToday: true, missed: 'carry' });
  assert.equal(p({ every: 'week' }).ok, false, 'weekly needs a weekday');
  assert.equal(p({ every: 'month', week_of_month: 1, weekday: 'sunday' }).calls[0].args[0].recurring.dayOfWeek, 0, 'a monthly Sunday stays Sunday');
  assert.equal(p({ every: 'day', on_today: false, missed: 'skip' }).ok, false);
  assert.equal(planAction({ type: 'add_task', title: 'R', where: 'today', repeat: { every: 'day' } }, app.state, app.env()).ok, false, 'no where with a repeat');
});

test('names: exact, close, ambiguous and unknown, never guessed or created', () => {
  const app = fakeApp(); const env = app.env();
  const r = a => resolveItem(item(a), app.state, env);
  // unknown theme: options, not a new theme
  const t = r({ type: 'add_task', title: 'X', theme: 'Car' });
  assert.equal(t.ok, false); assert.ok(t.options.some(o => o.label === 'House'));
  const chosen = planAction({ type: 'add_task', title: 'X', theme: 'Car' }, app.state, env, t.options.find(o => o.label === 'House').value);
  assert.deepEqual(chosen.calls[0].args[0].themeIds, ['house']);
  // a tag name in two categories: options; "Category › Tag" picks it
  const jim = r({ type: 'add_task', title: 'X', tags: ['Jim'] });
  assert.equal(jim.ok, false); assert.deepEqual(jim.options.slice(0, 2).map(o => o.label).sort(), ['People work › Jim', 'People › Jim']);
  assert.equal(r({ type: 'add_task', title: 'X', tags: ['People work › Jim'] }).ok, true);
  // unknown tag: options include leaving it off
  const odd = r({ type: 'add_task', title: 'X', tags: ['Seasonal'] });
  assert.equal(odd.options.at(-1).label, 'Leave this tag off');
  assert.deepEqual(planAction({ type: 'add_task', title: 'X', tags: ['Seasonal'] }, app.state, env, odd.options.at(-1).value).calls[0].args[0].tags, []);
  // one tag per category
  const two = r({ type: 'add_task', title: 'X', tags: ['Day', 'Weekend'] });
  assert.equal(two.ok, false); assert.match(two.reason, /one tag per category/); assert.equal(two.options, undefined);
  // sub-theme must belong to the theme
  assert.equal(r({ type: 'add_task', title: 'X', theme: 'Work', sub_theme: 'Lawn' }).ok, false);
  assert.equal(r({ type: 'add_task', title: 'X', sub_theme: 'Lawn' }).ok, false, 'a sub-theme needs its theme');
  // two problems at once: not pickable, both reasons shown
  const both = r({ type: 'add_task', title: 'X', theme: 'Car', tags: ['Seasonal'] });
  assert.equal(both.ok, false); assert.equal(both.options, undefined);
  // close match on plurals and case
  assert.equal(matchName('houses', app.state.themes).hit.id, 'house');
});

test('tasks: id first, then the title; duplicates and done tasks are flagged', () => {
  const app = fakeApp(); const env = app.env();
  const r = a => resolveItem(item(a), app.state, env);
  assert.equal(r({ type: 'complete_task', task: 'something else', task_id: 'gutter1' }).ok, true, 'the id wins');
  assert.equal(r({ type: 'complete_task', task: 'get the gutter quote' }).ok, false, 'a loose title is offered, not guessed');
  const dup = r({ type: 'complete_task', task: 'Ring mum' });
  assert.equal(dup.ok, false); assert.equal(dup.options.length, 2); assert.match(dup.reason, /More than one/);
  const p = planAction({ type: 'complete_task', task: 'Ring mum' }, app.state, env, dup.options[1].value);
  assert.deepEqual(p.calls, [{ fn: 'completeTask', args: [dup.options[1].value.split('=')[1]] }]);
  assert.match(r({ type: 'complete_task', task: 'Pay council tax' }).reason, /already done/);
  assert.match(r({ type: 'complete_task', task: 'x', task_id: 'done1' }).reason, /already done/);
  assert.match(r({ type: 'complete_task', task: 'Bins' }).reason, /No open task/, 'a dormant repeat is not open');
  assert.match(r({ type: 'move_task', task: 'Nope', where: 'today' }).reason, /No open task/);
});

test('complete_task: done and won’t do, through completeTask and markWontDo', async () => {
  const app = fakeApp(); const h = makeHandlers(app);
  await h.complete_task({ type: 'complete_task', task: 'Book dentist', task_id: 'mhw3k2a1x9f2q' });
  await h.complete_task({ type: 'complete_task', task: 'Get gutter quote', outcome: 'wont_do' });
  assert.deepEqual(app.log, [['completeTask', 'mhw3k2a1x9f2q'], ['markWontDo', 'gutter1']]);
  // a second complete of the same task fails rather than toggling it back open
  await assert.rejects(h.complete_task({ type: 'complete_task', task: 'Book dentist', task_id: 'mhw3k2a1x9f2q' }), /already done/);
});

test('update_task: only what was given changes', async () => {
  const app = fakeApp(); const h = makeHandlers(app);
  await h.update_task({ type: 'update_task', task: 'Boiler service', priority: 'urgent', append_notes: 'British Gas said Tuesday.', tags: ['People › Jim'], due: '2026-11-20' });
  const t = app.state.tasks.find(x => x.id === 'mhv9z0b7c3d1e');
  assert.equal(t.priority, 'urgent');
  assert.equal(t.notes, 'Annual\nBritish Gas said Tuesday.');
  assert.deepEqual(t.tags, ['people-a1'], 'Jim replaced Mum: one tag per category');
  assert.equal(t.dueDate, '2026-11-20'); assert.equal(t.autoKanbaned, false);
  assert.equal(t.subTheme, 'Maintenance'); assert.deepEqual(t.themeIds, ['house']);
  assert.deepEqual(fns(app), ['updateTask', 'checkAutoKanban']);
  // a new theme without that sub-theme clears it; Garden has Maintenance too, so it stays
  const p = a => planAction({ type: 'update_task', task: 'Boiler service', ...a }, app.state, app.env());
  assert.deepEqual(p({ theme: 'Work' }).calls[0].args[1], { themeIds: ['work'], themeId: 'work', subTheme: '' });
  assert.deepEqual(p({ theme: 'Garden' }).calls[0].args[1], { themeIds: ['garden'], themeId: 'garden' });
  assert.deepEqual(p({ due: null, url: null, sub_theme: null, remove_tags: ['People › Jim'] }).calls[0].args[1], { dueDate: '', autoKanbaned: false, subTheme: '', tags: [] });
  assert.deepEqual(p({ add_subtasks: ['Ring them'] }).calls[0].args[1].subtasks.map(s => s.title), ['Ring them']);
  assert.equal(p({ priority: 'urgent' }).ok, false, 'nothing to change');
  assert.equal(p({}).ok, false);
});

test('move_task: each place uses the app’s own move function', () => {
  const app = fakeApp(); const env = app.env();
  const calls = (task, where, day) => planAction({ type: 'move_task', task, where, ...(day ? { day } : {}) }, app.state, env).calls;
  assert.deepEqual(calls('Book dentist', 'today'), [{ fn: 'planFor', args: ['mhw3k2a1x9f2q', TODAY] }]);
  assert.deepEqual(calls('Book dentist', 'day', '2026-11-13'), [{ fn: 'planFor', args: ['mhw3k2a1x9f2q', '2026-11-13'] }]);
  assert.deepEqual(calls('Book dentist', 'day', '2026-10-01'), [{ fn: 'planFor', args: ['mhw3k2a1x9f2q', TODAY] }]);
  assert.deepEqual(calls('Book dentist', 'ready'), [{ fn: 'planFor', args: ['mhw3k2a1x9f2q', null] }]);
  assert.deepEqual(calls('Tax return', 'backlog'), [{ fn: 'moveToKanban', args: ['mhu1a2b3c4d5e'] }]);
  assert.deepEqual(calls('Christmas card list', 'waiting'), [{ fn: 'moveToColumn', args: ['xmas1', 'waiting'] }, { fn: 'updateTask', args: ['xmas1', { inNotes: false }] }]);
  assert.deepEqual(calls('Clear the loft', 'list'), [{ fn: 'moveToThemedList', args: ['snz1'] }, { fn: 'updateTask', args: ['snz1', { snoozedUntil: '' }] }]);
  assert.deepEqual(calls('Book dentist', 'off_board'), [{ fn: 'backToList', args: ['mhw3k2a1x9f2q'] }]);
  assert.deepEqual(calls('Book dentist', 'notes'), [{ fn: 'moveToNotes', args: ['mhw3k2a1x9f2q'] }]);
  assert.equal(planAction({ type: 'move_task', task: 'Book dentist', where: 'day' }, app.state, env).ok, false, 'day needs a date');
  assert.equal(planAction({ type: 'move_task', task: 'Book dentist', where: 'today', day: TODAY }, app.state, env).ok, false);
});

test('snooze_task: through snoozeTask, only to a later date', async () => {
  const app = fakeApp(); const h = makeHandlers(app);
  await h.snooze_task({ type: 'snooze_task', task: 'Christmas card list', until: '2026-12-01' });
  assert.deepEqual(app.log, [['snoozeTask', 'xmas1', '2026-12-01']]);
  await assert.rejects(h.snooze_task({ type: 'snooze_task', task: 'Book dentist', until: TODAY }), /after today/);
});

test('a block applies in order: an earlier action counts for a later one', async () => {
  const app = fakeApp(); const h = makeHandlers(app);
  const id = await h.add_task({ type: 'add_task', title: 'Order skip', where: 'backlog' });
  await h.move_task({ type: 'move_task', task: 'Order skip', where: 'today' });
  assert.equal(app.state.tasks.find(t => t.id === id).planDay, TODAY);
});

test('context: today, themes, tags, open tasks with where; small and capped', () => {
  const state = fixture();
  const { data, note } = buildContext(state, { today: TODAY });
  assert.equal(data.today, TODAY);
  assert.deepEqual(data.themes[0], { id: 'house', name: 'House', sub_themes: ['Cleaning', 'Maintenance'] });
  assert.equal(data.themes[3].hidden, true);
  assert.deepEqual(data.tag_categories[2], { id: 'when', name: 'When', tags: [{ id: 'when-day', name: 'Day' }, { id: 'when-weekend', name: 'Weekend' }] });
  assert.equal(data.open_tasks, 8);
  assert.equal(note, undefined);
  const ids = data.tasks.map(t => t.id);
  assert.ok(!ids.includes('done1') && !ids.includes('sched1'), 'open tasks only');
  assert.deepEqual(ids.slice(0, 2).sort(), ['mhu1a2b3c4d5e', 'ring1'], 'Today and Ready first');
  const by = Object.fromEntries(data.tasks.map(t => [t.id, t]));
  assert.deepEqual(by.mhu1a2b3c4d5e, { id: 'mhu1a2b3c4d5e', title: 'Tax return', where: 'today', day: TODAY, themes: ['Admin'] });
  assert.equal(by.ring1.where, 'ready'); assert.equal(by.ring2.where, 'review'); assert.equal(by.xmas1.where, 'notes');
  assert.deepEqual(by.snz1, { id: 'snz1', title: 'Clear the loft', where: 'snoozed', until: '2026-12-01' });
  assert.equal(by.mhv9z0b7c3d1e.notes, undefined, 'no notes text');
  for (const t of data.tasks) for (const k of Object.keys(t)) assert.ok(['id', 'title', 'where', 'day', 'until', 'due', 'priority', 'themes', 'repeats'].includes(k), k);
  for (let i = 0; i < 400; i++) state.tasks.push(task({ id: `bulk${i}`, title: `Bulk ${i}`, createdDate: '2026-10-01' }));
  const big = buildContext(state, { today: TODAY });
  assert.equal(big.data.tasks.length, 300); assert.equal(big.data.open_tasks, 408);
  assert.match(big.note, /300 of 408/);
  assert.ok(JSON.stringify(big.data).length < 40_000);
});

test('whereOf matches the app’s tiers', () => {
  assert.equal(whereOf(task({ kanbanColumn: 'live', planDay: '2026-11-20' }), TODAY), 'day');
  assert.equal(whereOf(task({ kanbanColumn: 'live', planDay: '2026-11-01' }), TODAY), 'today');
  assert.equal(whereOf(task({ offKanban: true }), TODAY), 'off_board');
  assert.equal(whereOf(task({ kanbanColumn: 'ongoing' }), TODAY), 'ongoing');
  assert.equal(whereOf(task({ snoozedUntil: '2026-11-01' }), TODAY), 'list', 'an expired snooze is back');
});

test('the daily copy: the context shares straight after load with the app’s schema', async () => {
  const state = fixture();
  const mem = new Map([['ai-updates-hub-key', 'k'.repeat(24)]]);
  const store = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
  const context = () => buildContext(state, { today: TODAY });   // as ai/updates.js builds it
  assert.deepEqual(await shareContext(schema, context, { store, fetch }), { shared: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, new RegExp(`/api/ai-context/${schema.app}$`));
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.v, schema.v);
  assert.deepEqual(body.data, context().data);
  assert.deepEqual(await shareContext(schema, context, { store, fetch }), { shared: false, reason: 'unchanged' });
  assert.equal(calls.length, 1);
});
