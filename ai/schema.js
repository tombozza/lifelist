// Life List's AI Updates contract (sites/ai-updates/MAINTAINING.md). Plain ES module with no
// imports, read by the app (ai/updates.js), by node --test (tests/) and by the docs build.
// The words in `description` are what ChatGPT reads in its action reference, so write them
// for ChatGPT. The rules behind them are in ai/logic.js and ai/guide.md.

const date = { $ref: '#/defs/date' };
const name = (what, more = '') => ({ type: 'string', minLength: 1, maxLength: 80, description: `${what} name exactly as listed in the context${more}. It must already exist: Life List never creates ${what.toLowerCase()}s from here.` });

const taskRef = {
  task: { type: 'string', minLength: 1, maxLength: 200, description: 'The task’s title as Tom said it (or as listed in the context).' },
  task_id: { type: 'string', minLength: 1, maxLength: 80, description: 'The task’s id from the context. Add it whenever the task is listed there; leave it out otherwise.' },
};

const PRIORITY = { enum: ['none', 'minimal', 'low', 'medium', 'high', 'urgent'], description: 'none, minimal, low, medium, high or urgent. Leave out unless Tom gave one.' };
const SIZE = { enum: ['xs', 's', 'm', 'l', 'xl', 'xxl'], description: 'Effort: xs, s, m, l, xl or xxl. Leave out for the default (xs).' };
const TAGS = { type: 'array', minItems: 1, maxItems: 10, items: name('Tag'), description: 'Tag names. At most one tag from each tag category.' };

// Where a task goes. These are Life List's real places (KANBAN_COLS and the tiers in app.js).
const PLACES = ['today', 'day', 'ready', 'backlog', 'waiting', 'blocked', 'ongoing', 'list', 'off_board', 'notes'];
const placeHelp = 'today = on Today’s list; day = on the Today list of the date in "day"; ready = Live but no day yet (the Ready sheet); backlog, waiting, blocked, ongoing = that board column; list = its theme’s list, off the board; off_board = the list’s “Off board” tier; notes = parked in Notes';

const WEEKDAY = { enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] };

export default {
  app: 'life_list',
  name: 'Life List',
  v: 1,
  accepts: [1],
  defs: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', hint: 'should be a date like 2026-11-14' },
  },
  actions: {
    add_task: {
      title: 'Add a task',
      description: 'A new task. With no "where" it lands in the review queue, like a quick capture.',
      schema: {
        type: 'object', required: ['type', 'title'], additionalProperties: false,
        properties: {
          type: { const: 'add_task' },
          title: { type: 'string', minLength: 1, maxLength: 200, description: 'Short task title, in Tom’s words.' },
          theme: name('Theme', ' (e.g. "House")'),
          also_themes: { type: 'array', minItems: 1, maxItems: 4, items: name('Theme'), description: 'Extra themes when a task belongs to more than one (Work + Jim). Rarely needed.' },
          sub_theme: name('Sub-theme', ', belonging to the task’s theme'),
          tags: TAGS,
          priority: PRIORITY,
          size: SIZE,
          where: { enum: [...PLACES, 'review'], description: `Where it goes: ${placeHelp}; review = the review queue (the default when left out).` },
          day: { ...date, description: 'The date for where "day" (YYYY-MM-DD). A past date means today.' },
          due: { ...date, description: '“Do by” deadline (YYYY-MM-DD). Three days before it, a task not on the board moves to the Backlog.' },
          notes: { type: 'string', maxLength: 2000, description: 'Free-text notes.' },
          url: { type: 'string', maxLength: 500, description: 'One web link.' },
          subtasks: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 200 }, description: 'Checklist steps, in order.' },
          spotlight: { type: 'boolean', description: 'true = spotlight (above everything else). Only when Tom asks.' },
          repeat: {
            type: 'object', required: ['every'], additionalProperties: false,
            description: 'Makes it a repeating task. Leave out "where", "day", "due", "url" and "spotlight" with a repeat: the first occurrence appears on its date.',
            properties: {
              every: { enum: ['day', 'week', 'month'], description: 'day, week or month.' },
              interval: { type: 'integer', minimum: 1, maximum: 60, description: 'Every N days/weeks/months. Default 1.' },
              weekday: { ...WEEKDAY, description: 'For every week: the day (one only). For every month with week_of_month: the weekday.' },
              day_of_month: { type: 'integer', minimum: 1, maximum: 31, description: 'For every month on a date: the day of the month (31 means the last day in short months).' },
              week_of_month: { type: 'integer', minimum: 1, maximum: 4, description: 'For every month on a weekday: 1st to 4th, with weekday.' },
              on_today: { type: 'boolean', description: 'true (default) = each occurrence goes straight onto Today on its date; false = it goes to the Backlog.' },
              missed: { enum: ['carry', 'skip'], description: 'With on_today: carry (default) = an unfinished one moves to the next day; skip = it only counts on its day.' },
              starts: { ...date, description: 'First possible date (YYYY-MM-DD). Default today. The first occurrence is the first matching date on or after it.' },
            },
          },
        },
      },
      describe: a => `Add “${a.title}”${a.theme ? ` to ${a.theme}` : ''}${a.where ? ` (${a.where === 'day' ? a.day : a.where})` : ''}${a.repeat ? `, repeating every ${a.repeat.interval > 1 ? `${a.repeat.interval} ` : ''}${a.repeat.every}${a.repeat.interval > 1 ? 's' : ''}` : ''}`,
    },

    update_task: {
      title: 'Change a task',
      description: 'Edit an open task. Only the fields given change. To move it, use move_task.',
      schema: {
        type: 'object', required: ['type', 'task'], additionalProperties: false, minProperties: 3,
        properties: {
          type: { const: 'update_task' },
          ...taskRef,
          title: { type: 'string', minLength: 1, maxLength: 200, description: 'A new title (rename).' },
          theme: name('Theme', '. Replaces the task’s themes'),
          also_themes: { type: 'array', minItems: 1, maxItems: 4, items: name('Theme'), description: 'Extra themes, with theme.' },
          sub_theme: { type: ['string', 'null'], minLength: 1, maxLength: 80, description: 'Sub-theme name (must belong to one of the task’s themes), or null to clear it.' },
          tags: { ...TAGS, description: 'Tags to put on. Each replaces any other tag of the same category on the task; other tags stay.' },
          remove_tags: { type: 'array', minItems: 1, maxItems: 10, items: name('Tag'), description: 'Tags to take off.' },
          priority: PRIORITY,
          size: SIZE,
          due: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$', hint: 'should be a date like 2026-11-14, or null', description: '“Do by” date (YYYY-MM-DD), or null to clear it.' },
          url: { type: ['string', 'null'], maxLength: 500, description: 'One web link, or null to clear it.' },
          append_notes: { type: 'string', minLength: 1, maxLength: 2000, description: 'Text added on a new line at the end of the task’s notes (existing notes are kept).' },
          add_subtasks: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 200 }, description: 'Checklist steps added at the end.' },
          spotlight: { type: 'boolean', description: 'true = spotlight it, false = take the spotlight off.' },
        },
      },
      describe: a => `Change “${a.task}”`,
    },

    complete_task: {
      title: 'Complete a task',
      description: 'Tick an open task off (a repeat books its next occurrence), or file it as won’t do.',
      schema: {
        type: 'object', required: ['type', 'task'], additionalProperties: false,
        properties: {
          type: { const: 'complete_task' },
          ...taskRef,
          outcome: { enum: ['done', 'wont_do'], description: 'done (default) or wont_do (dropped, not done). There is no delete.' },
        },
      },
      describe: a => `${a.outcome === 'wont_do' ? 'Won’t do' : 'Done'}: “${a.task}”`,
    },

    move_task: {
      title: 'Move a task',
      description: 'Put an open task on a day, in Ready, a board column, its list or Notes.',
      schema: {
        type: 'object', required: ['type', 'task', 'where'], additionalProperties: false,
        properties: {
          type: { const: 'move_task' },
          ...taskRef,
          where: { enum: PLACES, description: `Where it goes: ${placeHelp}.` },
          day: { ...date, description: 'The date, with where "day" only (YYYY-MM-DD). A past date means today.' },
        },
      },
      describe: a => `Move “${a.task}” to ${a.where === 'day' ? a.day : a.where}`,
    },

    snooze_task: {
      title: 'Snooze a task',
      description: 'Hide an open task until a date. It comes back to its list (not the board) on that date.',
      schema: {
        type: 'object', required: ['type', 'task', 'until'], additionalProperties: false,
        properties: {
          type: { const: 'snooze_task' },
          ...taskRef,
          until: { ...date, description: 'The date it reappears (YYYY-MM-DD), after today.' },
        },
      },
      describe: a => `Snooze “${a.task}” until ${a.until}`,
    },
  },
};

export const examples = [
  {
    title: 'Add tasks with a theme, a date and a deadline',
    said: 'Add booking the MOT to House, it needs doing by the end of the month. And put "ring the garage about the tyres" on next Thursday.',
    actions: [
      { type: 'add_task', title: 'Book MOT', theme: 'House', sub_theme: 'Maintenance', due: '2026-11-30', priority: 'high' },
      { type: 'add_task', title: 'Ring the garage about the tyres', theme: 'House', where: 'day', day: '2026-11-19' },
    ],
  },
  {
    title: 'A repeating task',
    said: 'Every Monday I need to put the bins out. Put it on Today each week, and if I miss it, don’t carry it over.',
    actions: [
      { type: 'add_task', title: 'Put the bins out', theme: 'House', repeat: { every: 'week', weekday: 'monday', on_today: true, missed: 'skip' } },
    ],
  },
  {
    title: 'Finish, drop and edit',
    said: 'I booked the dentist, forget about the gutter quote, and the boiler service is urgent now, add a note that British Gas said Tuesday.',
    actions: [
      { type: 'complete_task', task: 'Book dentist', task_id: 'mhw3k2a1x9f2q' },
      { type: 'complete_task', task: 'Get gutter quote', outcome: 'wont_do' },
      { type: 'update_task', task: 'Boiler service', task_id: 'mhv9z0b7c3d1e', priority: 'urgent', append_notes: 'British Gas said Tuesday.' },
    ],
  },
  {
    title: 'Plan and snooze',
    said: 'Move the tax return to tomorrow, and snooze the Christmas card list until 1 December.',
    actions: [
      { type: 'move_task', task: 'Tax return', task_id: 'mhu1a2b3c4d5e', where: 'day', day: '2026-11-13' },
      { type: 'snooze_task', task: 'Christmas card list', until: '2026-12-01' },
    ],
  },
];
