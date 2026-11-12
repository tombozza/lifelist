// Life List's AI Updates logic: names → records, each action → the app's own calls, and the
// "Copy for ChatGPT" context. Pure (no DOM, no globals), so node --test can run it
// (tests/ai.test.mjs). The browser glue is ai/updates.js; the contract is ai/schema.js.
//
// The one rule that matters: every write goes through the app's own functions (addTask,
// updateTask, completeTask, markWontDo, planFor, moveToColumn, moveToKanban, moveToNotes,
// moveToThemedList, backToList, snoozeTask, scheduleOccurrence, checkAutoKanban,
// checkRecurring), exposed by app.js as window.lifeListApp. planAction() only describes
// those calls; runCalls() makes them. Nothing here creates themes, tags, categories or saved
// notes, and nothing deletes: those sync wholesale (the 8 Oct 2026 tag wipe).

import schema from './schema.js';

export const ACTION_TYPES = Object.keys(schema.actions);
export const COLUMNS = ['backlog', 'waiting', 'blocked', 'ongoing'];
const PRIORITY = { none: '', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', urgent: 'urgent' };
const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const PLACE_LABEL = {
  today: 'Today', ready: 'Ready', backlog: 'Backlog', waiting: 'Waiting', blocked: 'Blocked', ongoing: 'Ongoing',
  list: 'its list', off_board: 'Off board', notes: 'Notes', review: 'the review queue', snoozed: 'snoozed',
};
const CONTEXT_LIMIT = 300;

// ---------------------------------------------------------------------------------------
// Matching names

/** Lower case, no accents or punctuation, "&" = "and", simple plurals folded. */
export function normalise(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter(Boolean).map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
}

function lev(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1: 1 = the same once normalised. */
export function similarity(a, b) {
  const x = normalise(a), y = normalise(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const ratio = 1 - lev(x, y) / Math.max(x.length, y.length);
  const tx = new Set(x.split(' ')), ty = new Set(y.split(' '));
  const common = [...tx].filter(w => ty.has(w)).length;
  let dice = (2 * common) / (tx.size + ty.size);
  if (common === tx.size || common === ty.size) dice = Math.max(dice, 0.75);   // one inside the other
  return Math.max(ratio, dice) * 0.99;   // never quite an exact match
}

const STRONG = 0.85, CLOSE = 0.5;

/**
 * Match a name against records ({id, name}). Never guesses: one exact match, or one strong
 * close match with nothing else near, is a hit; anything else comes back as options.
 * @returns {{hit?:object, close?:boolean, options:{item:object, score:number}[]}}
 */
export function matchName(query, items, { max = 8 } = {}) {
  const q = normalise(query);
  const exact = items.filter(it => normalise(it.name) === q);
  if (exact.length === 1) return { hit: exact[0], options: [] };
  if (exact.length > 1) return { options: exact.map(item => ({ item, score: 1 })) };
  const scored = items.map(item => ({ item, score: similarity(query, item.name) }))
    .filter(s => s.score >= CLOSE).sort((a, b) => b.score - a.score);
  if (scored.length && scored[0].score >= STRONG && !(scored[1] && scored[1].score >= CLOSE)) return { hit: scored[0].item, close: true, options: [] };
  return { options: scored.slice(0, max) };
}

// ---------------------------------------------------------------------------------------
// Reading the app's state (the same rules as app.js)

const isOpen = t => t && t.status === 'active';
const themeIdsOf = t => (Array.isArray(t.themeIds) && t.themeIds.length ? t.themeIds : t.themeId ? [t.themeId] : []);
const isSnoozed = (t, today) => !!(t.snoozedUntil && t.snoozedUntil > today);

/** Where an open task is, in the words the actions use (plus "snoozed"). */
export function whereOf(t, today) {
  if (isSnoozed(t, today)) return 'snoozed';
  if (t.kanbanColumn === 'live') return !t.planDay ? 'ready' : t.planDay <= today ? 'today' : 'day';
  if (COLUMNS.includes(t.kanbanColumn)) return t.kanbanColumn;
  if (t.inNotes) return 'notes';
  if (t.offKanban) return 'off_board';
  if (t.reviewed === false) return 'review';
  return 'list';
}

const placeText = (where, day) => (where === 'day' ? `the ${day} list` : PLACE_LABEL[where] ?? where);

function allTags(state) {
  return (state.tagCategories || []).flatMap(c => (c.tags || []).map(t => ({ id: t.id, name: t.name, catId: c.id, catName: c.name })));
}
const tagCat = (state, id) => (allTags(state).find(t => t.id === id) || {}).catId
  ?? (String(id).includes('-') ? String(id).split('-').slice(0, -1).join('-') : '');

const taskLabel = (t, today) => {
  const w = whereOf(t, today);
  return `${t.title} · ${w === 'day' ? t.planDay : PLACE_LABEL[w] ?? w}${t.dueDate ? ` · due ${t.dueDate}` : ''}`;
};

// ---------------------------------------------------------------------------------------
// Context ("Copy for ChatGPT")

/**
 * Small: today's date, themes with sub-themes, tag categories with tags, and up to 300 open
 * tasks (everything on Today, a day or Ready first, then the newest). No archive, settings,
 * notes text or tombstones.
 */
export function buildContext(state, { today, limit = CONTEXT_LIMIT } = {}) {
  const themes = state.themes || [];
  const themeName = new Map(themes.map(t => [t.id, t.name]));
  const open = (state.tasks || []).filter(isOpen);
  const live = t => (t.kanbanColumn === 'live' && !isSnoozed(t, today) ? 0 : 1);
  const sorted = [...open].sort((a, b) => live(a) - live(b)
    || String(b.createdDate || '').localeCompare(String(a.createdDate || '')) || (b.updatedAt || 0) - (a.updatedAt || 0));
  const tasks = sorted.slice(0, limit).map(t => {
    const where = whereOf(t, today);
    const o = { id: t.id, title: t.title, where };
    if (where === 'day' || where === 'today') o.day = t.planDay < today ? today : t.planDay;
    if (where === 'snoozed') o.until = t.snoozedUntil;
    if (t.dueDate) o.due = t.dueDate;
    if (t.priority) o.priority = t.priority;
    const names = themeIdsOf(t).map(id => themeName.get(id)).filter(Boolean);
    if (names.length) o.themes = names;
    if (t.recurring) o.repeats = true;
    return o;
  });
  const data = {
    today,
    themes: themes.map(t => ({ id: t.id, name: t.name, sub_themes: [...(t.subThemes || [])], ...(t.hidden ? { hidden: true } : {}) })),
    tag_categories: (state.tagCategories || []).map(c => ({ id: c.id, name: c.name, tags: (c.tags || []).map(t => ({ id: t.id, name: t.name })) })),
    open_tasks: open.length,
    tasks,
  };
  const note = open.length > tasks.length
    ? `${tasks.length} of ${open.length} open tasks are listed (Today, Ready and the newest). Refer to any other task by its title.`
    : undefined;
  return { data, note };
}

// ---------------------------------------------------------------------------------------
// Resolving one action into the app's calls

/** The sheet passes one choice per action; ours are "<key>=<value>" so we know which reference it answers. */
export const choiceValue = (key, value) => `${key}=${value}`;
function parseChoice(choice) {
  if (choice == null || choice === '') return {};
  const s = String(choice); const i = s.indexOf('=');
  return i < 0 ? { task: s } : { [s.slice(0, i)]: s.slice(i + 1) };
}

function resolveTask(state, action, today, choices, problems) {
  const tasks = state.tasks || [];
  if (choices.task) {
    const t = tasks.find(x => x.id === choices.task);
    if (t && isOpen(t)) return t;
  }
  if (action.task_id) {
    const t = tasks.find(x => x.id === action.task_id);
    if (t && isOpen(t)) return t;
    if (t && (t.status === 'complete' || t.status === 'wont-do')) {
      problems.push({ key: 'task', reason: `“${t.title}” is already ${t.status === 'complete' ? `done${t.completedDate ? ` (${t.completedDate})` : ''}` : 'filed as won’t do'}.` });
      return null;
    }
  }
  const open = tasks.filter(isOpen);
  const m = matchName(action.task, open.map(t => ({ id: t.id, name: t.title, t })));
  if (m.hit) return m.hit.t;
  if (m.options.length) {
    problems.push({ key: 'task', reason: m.options[0].score === 1 ? `More than one open task is called “${action.task}”. Which one?` : `No open task is called “${action.task}”. Did you mean one of these?`,
      options: m.options.map(o => ({ value: choiceValue('task', o.item.id), label: taskLabel(o.item.t, today) })) });
    return null;
  }
  const done = tasks.find(t => (t.status === 'complete' || t.status === 'wont-do') && normalise(t.title) === normalise(action.task));
  problems.push({ key: 'task', reason: done ? `“${done.title}” is already ${done.status === 'complete' ? 'done' : 'filed as won’t do'}.` : `No open task is called “${action.task}”.` });
  return null;
}

function resolveTheme(state, nameIn, key, choices, problems) {
  const themes = state.themes || [];
  if (choices[key]) { const t = themes.find(x => x.id === choices[key]); if (t) return t; }
  const m = matchName(nameIn, themes, { max: 50 });
  if (m.hit) return m.hit;
  const near = new Set(m.options.map(o => o.item.id));
  const ordered = [...m.options.map(o => o.item), ...themes.filter(t => !near.has(t.id))];
  problems.push({ key, reason: m.options.length && m.options[0].score === 1 ? `More than one theme is called “${nameIn}”. Which one?` : `There’s no theme called “${nameIn}” (Life List doesn’t make new ones from here). Pick one:`,
    options: ordered.map(t => ({ value: choiceValue(key, t.id), label: t.name })) });
  return null;
}

function resolveSub(nameIn, themes, key, choices, problems) {
  if (key in choices) return choices[key];   // '' = no sub-theme
  const subs = [...new Set(themes.flatMap(t => t.subThemes || []))].map(s => ({ id: s, name: s }));
  const m = matchName(nameIn, subs, { max: 50 });
  if (m.hit) return m.hit.name;
  const near = new Set(m.options.map(o => o.item.id));
  const ordered = [...m.options.map(o => o.item), ...subs.filter(s => !near.has(s.id))];
  problems.push({ key, reason: `“${nameIn}” isn’t a sub-theme of ${themes.map(t => t.name).join(' or ') || 'its theme'}. Pick one:`,
    options: [...ordered.map(s => ({ value: choiceValue(key, s.name), label: s.name })), { value: choiceValue(key, ''), label: 'No sub-theme' }] });
  return undefined;
}

/** A tag by name, or "Category › Tag" (also "Category: Tag" or "Category / Tag") when a name is in two categories. */
function resolveTag(state, nameIn, key, choices, problems) {
  const tags = allTags(state);
  if (key in choices) return choices[key] ? tags.find(t => t.id === choices[key]) || null : false;   // false = leave it off
  let pool = tags, q = nameIn;
  const split = /^(.+?)\s*(?:›|>|:|\/)\s*(.+)$/.exec(nameIn);
  if (split) {
    const cats = matchName(split[1], (state.tagCategories || []).map(c => ({ id: c.id, name: c.name })));
    if (cats.hit) { pool = tags.filter(t => t.catId === cats.hit.id); q = split[2]; }
  }
  const m = matchName(q, pool, { max: 50 });
  if (m.hit) return m.hit;
  const near = new Set(m.options.map(o => o.item.id));
  const ordered = [...m.options.map(o => o.item), ...tags.filter(t => !near.has(t.id))];
  problems.push({ key, reason: m.options.length && m.options[0].score === 1 ? `“${nameIn}” is in more than one tag category. Which one?` : `There’s no tag called “${nameIn}” (Life List doesn’t make new ones from here). Pick one, or leave it off:`,
    options: [...ordered.map(t => ({ value: choiceValue(key, t.id), label: `${t.catName} › ${t.name}` })), { value: choiceValue(key, ''), label: 'Leave this tag off' }] });
  return null;
}

function resolveTags(state, names, keyBase, choices, problems) {
  const out = [];
  (names || []).forEach((n, i) => { const t = resolveTag(state, n, `${keyBase}.${i}`, choices, problems); if (t) out.push(t); });
  return out;
}

function oneTagPerCategory(tags, problems) {
  const seen = new Map();
  for (const t of tags) {
    if (seen.has(t.catId) && seen.get(t.catId).id !== t.id) {
      problems.push({ key: 'tags', reason: `Life List takes one tag per category: “${seen.get(t.catId).name}” and “${t.name}” are both ${t.catName}.` });
      return;
    }
    seen.set(t.catId, t);
  }
}

function themesFor(state, action, choices, problems) {
  const names = action.theme ? [action.theme, ...(action.also_themes || [])] : [];
  const keys = action.theme ? ['theme', ...(action.also_themes || []).map((_, i) => `also_themes.${i}`)] : [];
  return names.map((n, i) => resolveTheme(state, n, keys[i], choices, problems)).filter(Boolean);
}

function buildRepeat(r, problems) {
  const interval = r.interval ?? 1;
  const has = k => r[k] !== undefined;
  const bad = reason => { problems.push({ key: 'repeat', reason }); return null; };
  let rec;
  if (r.every === 'day') {
    if (has('weekday') || has('day_of_month') || has('week_of_month')) return bad('A daily repeat takes no weekday or day of the month.');
    rec = { type: 'daily', interval };
  } else if (r.every === 'week') {
    if (!has('weekday')) return bad('A weekly repeat needs a weekday.');
    if (has('day_of_month') || has('week_of_month')) return bad('A weekly repeat takes a weekday only.');
    rec = { type: 'weekly', interval, dayOfWeek: WEEKDAYS[r.weekday] };
  } else {
    if (has('day_of_month') === has('week_of_month')) return bad('A monthly repeat needs either day_of_month, or week_of_month with weekday.');
    if (has('day_of_month')) {
      if (has('weekday')) return bad('A monthly repeat on a date takes no weekday.');
      rec = { type: 'monthly', interval, monthlyMode: 'date', dayOfMonth: r.day_of_month };
    } else {
      if (!has('weekday')) return bad('A monthly repeat on a weekday needs the weekday.');
      // app.js reads a monthly weekday as `dayOfWeek || 1`, so Sunday (0) would become Monday.
      if (r.weekday === 'sunday') return bad('Life List can’t repeat on a Sunday of the month yet (it would land on the Monday). Pick another day.');
      rec = { type: 'monthly', interval, monthlyMode: 'weekday', weekOfMonth: r.week_of_month, dayOfWeek: WEEKDAYS[r.weekday] };
    }
  }
  rec.onToday = r.on_today ?? true;
  if (rec.onToday) rec.missed = r.missed ?? 'carry';
  else if (has('missed')) return bad('“missed” only applies when on_today is true.');
  return rec;
}

const fail = problems => {
  if (problems.length === 1 && problems[0].options?.length) return { ok: false, reason: problems[0].reason, options: problems[0].options };
  return { ok: false, reason: problems.map(p => p.reason).join(' ') };
};

/** "where" + "day" → the app's fields for a new task (and whether it needs backToList after). */
function placement(where, dayIn, env) {
  const day = dayIn && dayIn < env.today ? env.today : dayIn;
  switch (where) {
    case 'today': return { data: { kanbanColumn: 'live', planDay: env.today, planOrder: env.nextPlanOrder(env.today) }, day: env.today };
    case 'day': return { data: { kanbanColumn: 'live', planDay: day, planOrder: env.nextPlanOrder(day) }, day };
    case 'ready': return { data: { kanbanColumn: 'live', planDay: null, planOrder: env.nextPlanOrder(null) } };
    case 'list': return { data: { kanbanColumn: null, reviewed: true } };
    case 'off_board': return { data: { kanbanColumn: null, reviewed: true }, then: 'backToList' };
    case 'notes': return { data: { kanbanColumn: null, inNotes: true, reviewed: true } };
    case 'backlog': case 'waiting': case 'blocked': case 'ongoing': return { data: { kanbanColumn: where } };
    default: return { data: { kanbanColumn: null } };   // review queue: unreviewed, like a quick capture
  }
}

function checkPlace(action, problems) {
  const where = action.where ?? (action.day ? 'day' : undefined);
  if (where === 'day' && !action.day) problems.push({ key: 'day', reason: '“where”: “day” needs a “day” date.' });
  if (where !== 'day' && action.day) problems.push({ key: 'day', reason: '“day” only goes with “where”: “day”.' });
  return where;
}

const tagText = tags => (tags.length ? `tag${tags.length > 1 ? 's' : ''} ${tags.map(t => t.name).join(', ')}` : '');

function planAdd(action, state, env, choices) {
  const problems = [];
  const themes = themesFor(state, action, choices, problems);
  let subTheme = '';
  if (action.sub_theme) {
    if (!action.theme) problems.push({ key: 'sub_theme', reason: 'A sub-theme needs its theme too.' });
    else if (themes.length === 1 + (action.also_themes || []).length) subTheme = resolveSub(action.sub_theme, themes, 'sub_theme', choices, problems) ?? '';
  }
  const tags = resolveTags(state, action.tags, 'tags', choices, problems);
  oneTagPerCategory(tags, problems);
  const where = checkPlace(action, problems);
  let rec = null;
  if (action.repeat) {
    const extra = ['where', 'day', 'due', 'url', 'spotlight'].filter(k => action[k] !== undefined);
    if (extra.length) problems.push({ key: 'repeat', reason: `A repeating task can’t take ${extra.join(', ')}: its first occurrence appears on its date.` });
    rec = buildRepeat(action.repeat, problems);
  }
  if (problems.length) return fail(problems);

  const themeIds = [...new Set(themes.map(t => t.id))];
  const data = {
    title: action.title.trim(), themeIds, themeId: themeIds[0] || '', subTheme,
    tags: tags.map(t => t.id),
    priority: PRIORITY[action.priority ?? 'none'], size: action.size ?? 'xs',
    dueDate: action.due ?? '', notes: (action.notes ?? '').trim(), url: env.normaliseUrl(action.url ?? ''),
    subtasks: (action.subtasks || []).map(title => ({ id: env.genId(), title: title.trim(), done: false })),
    spotlight: !!action.spotlight,
  };
  const bits = [themes.length ? themes.map(t => t.name).join(' + ') + (subTheme ? ` › ${subTheme}` : '') : 'no theme', tagText(tags)];
  if (data.priority) bits.push(`${data.priority} priority`);
  if (data.dueDate) bits.push(`due ${data.dueDate}`);
  if (data.subtasks.length) bits.push(`${data.subtasks.length} step${data.subtasks.length > 1 ? 's' : ''}`);
  const twin = (state.tasks || []).find(t => isOpen(t) && normalise(t.title) === normalise(data.title));
  const warn = twin ? ` (there’s already an open task called “${twin.title}”)` : '';

  if (rec) {
    const from = action.repeat.starts && action.repeat.starts > env.today ? action.repeat.starts : env.today;
    const first = env.nextOccurrenceOnOrAfter(rec, from);
    const root = env.genId();
    return {
      ok: true,
      text: `Add “${data.title}” · ${bits.filter(Boolean).join(' · ')} · repeats, first on ${first}${rec.onToday ? ' (onto Today)' : ' (into the Backlog)'}${warn}`,
      calls: [
        { fn: 'scheduleOccurrence', args: [{ ...data, recurring: rec, recurRoot: root }, first, 1] },
        { fn: 'saveState', args: [] },
        { fn: 'checkRecurring', args: [] },
        { fn: 'render', args: [] },
      ],
    };
  }
  const p = placement(where, action.day, env);
  const calls = [{ fn: 'addTask', args: [{ ...data, ...p.data }] }];
  if (p.then) calls.push({ fn: p.then, args: ['$new'] });
  calls.push({ fn: 'checkAutoKanban', args: [] });
  return { ok: true, text: `Add “${data.title}” to ${placeText(where ?? 'review', p.day)} · ${bits.filter(Boolean).join(' · ')}${warn}`, calls };
}

function planUpdate(action, state, env, choices) {
  const problems = [];
  const task = resolveTask(state, action, env.today, choices, problems);
  const themes = themesFor(state, action, choices, problems);
  const tags = resolveTags(state, action.tags, 'tags', choices, problems);
  const remove = resolveTags(state, action.remove_tags, 'remove_tags', choices, problems);
  oneTagPerCategory(tags, problems);
  if (problems.length || !task) return fail(problems.length ? problems : [{ reason: 'No task.' }]);

  const patch = {}; const said = [];
  if (action.title !== undefined && action.title.trim() !== task.title) { patch.title = action.title.trim(); said.push(`rename to “${patch.title}”`); }
  let finalThemes = themeIdsOf(task).map(id => (state.themes || []).find(t => t.id === id)).filter(Boolean);
  if (action.theme && themes.map(t => t.id).join() !== themeIdsOf(task).join()) {
    const ids = [...new Set(themes.map(t => t.id))];
    patch.themeIds = ids; patch.themeId = ids[0] || '';
    finalThemes = themes;
    said.push(`theme ${themes.map(t => t.name).join(' + ')}`);
  }
  if (action.sub_theme === null) { if (task.subTheme) { patch.subTheme = ''; said.push('no sub-theme'); } }
  else if (action.sub_theme !== undefined) {
    const sub = resolveSub(action.sub_theme, finalThemes, 'sub_theme', choices, problems);
    if (sub !== undefined && sub !== (task.subTheme || '')) { patch.subTheme = sub; said.push(sub ? `sub-theme ${sub}` : 'no sub-theme'); }
  } else if (action.theme && task.subTheme && !finalThemes.some(t => (t.subThemes || []).includes(task.subTheme))) {
    patch.subTheme = ''; said.push(`sub-theme ${task.subTheme} cleared (not in the new theme)`);
  }
  if (tags.length || remove.length) {
    const newCats = new Set(tags.map(t => t.catId));
    const gone = new Set(remove.map(t => t.id));
    const before = Array.isArray(task.tags) ? task.tags : [];
    const next = [...new Set([...before.filter(id => !gone.has(id) && !newCats.has(tagCat(state, id))), ...tags.map(t => t.id)])];
    if (next.join() !== before.join()) {
      patch.tags = next;
      if (tags.length) said.push(tagText(tags));
      if (remove.length) said.push(`remove ${remove.map(t => t.name).join(', ')}`);
    }
  }
  if (action.priority !== undefined && PRIORITY[action.priority] !== (task.priority || '')) { patch.priority = PRIORITY[action.priority]; said.push(`${action.priority} priority`); }
  if (action.size !== undefined && action.size !== (task.size || 'xs')) { patch.size = action.size; said.push(`size ${action.size.toUpperCase()}`); }
  if (action.due !== undefined && (action.due ?? '') !== (task.dueDate || '')) {
    patch.dueDate = action.due ?? '';
    // as the task window does: a changed date re-arms the 3-days-out nudge
    if (!task.doDate) patch.autoKanbaned = false;
    said.push(action.due ? `due ${action.due}` : 'no due date');
  }
  if (action.url !== undefined && env.normaliseUrl(action.url ?? '') !== (task.url || '')) { patch.url = env.normaliseUrl(action.url ?? ''); said.push(patch.url ? 'link' : 'no link'); }
  if (action.append_notes) { patch.notes = [task.notes, action.append_notes.trim()].filter(Boolean).join('\n'); said.push('add to notes'); }
  if (action.add_subtasks) {
    patch.subtasks = [...(task.subtasks || []), ...action.add_subtasks.map(title => ({ id: env.genId(), title: title.trim(), done: false }))];
    said.push(`${action.add_subtasks.length} more step${action.add_subtasks.length > 1 ? 's' : ''}`);
  }
  if (action.spotlight !== undefined && action.spotlight !== !!task.spotlight) { patch.spotlight = action.spotlight; said.push(action.spotlight ? 'spotlight' : 'no spotlight'); }
  if (problems.length) return fail(problems);
  if (!Object.keys(patch).length) return { ok: false, reason: `Nothing to change on “${task.title}”: it already looks like that.` };
  return {
    ok: true, taskId: task.id,
    text: `“${task.title}”: ${said.join(', ')}`,
    calls: [{ fn: 'updateTask', args: [task.id, patch] }, { fn: 'checkAutoKanban', args: [] }],
  };
}

function planComplete(action, state, env, choices) {
  const problems = [];
  const task = resolveTask(state, action, env.today, choices, problems);
  if (!task) return fail(problems);
  const wont = action.outcome === 'wont_do';
  return {
    ok: true, taskId: task.id,
    text: `${wont ? 'Won’t do' : 'Done'}: “${task.title}”${!wont && task.recurring ? ' (books the next one)' : ''}`,
    calls: [{ fn: wont ? 'markWontDo' : 'completeTask', args: [task.id] }],
  };
}

function planMove(action, state, env, choices) {
  const problems = [];
  const task = resolveTask(state, action, env.today, choices, problems);
  const where = checkPlace(action, problems);
  if (!task) return fail(problems);
  if (problems.length) return fail(problems);
  const id = task.id;
  const day = where === 'day' ? (action.day < env.today ? env.today : action.day) : undefined;
  const calls = [];
  // what the plain move functions leave behind (Notes, a snooze, unreviewed), so the task really is where it was sent
  const tidy = ({ notes = false, reviewed = false } = {}) => {
    const f = {};
    if (notes && task.inNotes) f.inNotes = false;
    if (isSnoozed(task, env.today)) f.snoozedUntil = '';
    if (reviewed && task.reviewed === false) f.reviewed = true;
    if (Object.keys(f).length) calls.push({ fn: 'updateTask', args: [id, f] });
  };
  if (where === 'today' || where === 'day' || where === 'ready') calls.push({ fn: 'planFor', args: [id, where === 'ready' ? null : where === 'today' ? env.today : day] });
  else if (where === 'backlog') { calls.push({ fn: 'moveToKanban', args: [id] }); tidy(); }
  else if (COLUMNS.includes(where)) { calls.push({ fn: 'moveToColumn', args: [id, where] }); tidy({ notes: true }); }
  else if (where === 'list') { calls.push({ fn: 'moveToThemedList', args: [id] }); tidy({ notes: true, reviewed: true }); }
  else if (where === 'off_board') { calls.push({ fn: 'backToList', args: [id] }); tidy({ notes: true, reviewed: true }); }
  else if (where === 'notes') { calls.push({ fn: 'moveToNotes', args: [id] }); tidy(); }
  const now = whereOf(task, env.today);
  const same = now === where && (where !== 'day' || task.planDay === day) && (where !== 'today' || task.planDay === env.today);
  return { ok: true, taskId: id, text: `Move “${task.title}” to ${placeText(where, day)}${same ? ' (it’s already there)' : ''}`, calls };
}

function planSnooze(action, state, env, choices) {
  const problems = [];
  const task = resolveTask(state, action, env.today, choices, problems);
  if (action.until <= env.today) problems.push({ key: 'until', reason: `Snooze needs a date after today (${env.today}).` });
  if (!task || problems.length) return fail(problems);
  return { ok: true, taskId: task.id, text: `Snooze “${task.title}” until ${action.until}`, calls: [{ fn: 'snoozeTask', args: [task.id, action.until] }] };
}

const PLANNERS = { add_task: planAdd, update_task: planUpdate, complete_task: planComplete, move_task: planMove, snooze_task: planSnooze };

/**
 * One action → the app calls that would apply it, against the state as it is now.
 * @param {object} action  a valid action (processReply already checked it against the schema)
 * @param {object} state   the app's state ({tasks, themes, tagCategories, …})
 * @param {{today:string, genId:()=>string, normaliseUrl:(s:string)=>string,
 *          nextPlanOrder:(day:string|null)=>number, nextOccurrenceOnOrAfter:(rec:object, from:string)=>string}} env
 * @param {string} [choice]  what Tom picked in the preview ("<key>=<value>")
 * @returns {{ok:true, text:string, calls:{fn:string,args:any[]}[], taskId?:string} | {ok:false, reason:string, options?:{value:string,label:string}[]}}
 */
export function planAction(action, state, env, choice) {
  const planner = PLANNERS[action?.type];
  if (!planner) return { ok: false, reason: `“${action?.type}” isn’t something Life List does.` };
  return planner(action, state, env, parseChoice(choice));
}

/** For the sheet's resolve(): the preview line, or what needs choosing. */
export function resolveItem(item, state, env) {
  const p = planAction(item.action, state, env);
  return p.ok ? { ok: true, text: p.text } : { ok: false, reason: p.reason, options: p.options };
}

/** Make the planned calls on the app, in order. "$new" stands for the task addTask just made. */
export function runCalls(app, calls) {
  let created;
  for (const { fn, args } of calls) {
    if (typeof app[fn] !== 'function') throw new Error(`Life List has no ${fn}()`);
    const out = app[fn](...args.map(a => (a === '$new' ? created?.id : a)));
    if (fn === 'addTask' || fn === 'scheduleOccurrence') created = out;
  }
  return created;
}

/**
 * The handler map (MAINTAINING.md): { <type>: async (action, choice) => … }, each planning
 * against the live state at the moment it runs (so earlier actions in the block count) and
 * applying with the app's own functions.
 * @param {object} app  window.lifeListApp: { state, env(), addTask, updateTask, … }
 */
export function makeHandlers(app) {
  const handler = async (action, choice) => {
    const p = planAction(action, app.state, app.env(), choice);
    if (!p.ok) throw new Error(p.reason);
    const made = runCalls(app, p.calls);
    return made ? made.id : p.taskId;
  };
  return Object.fromEntries(ACTION_TYPES.map(t => [t, handler]));
}
