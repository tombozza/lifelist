// Life Kanban's how-to guides, shown by the shared Help sheet (vendor/chassis/help.js, uiHelp) from
// Settings › Help (22 Nov 2026, Tom: "more how-to than FAQ"; plan in sites/briefs/help-audit-2026-11-21.html).
// Written from docs/HANDOVER.md's Decisions and a read of app.js and index.html, one job per guide.
//
// KEEP THESE TRUE: when a screen's words or steps change, change its guide in the same edit
// (sites/_shared/README.md, "The Help sheet"). `go` is a CSS selector for the button "Take me there" clicks
// once Help and Settings have closed (a view tab, an admin button inside Settings, or #settings-btn).
(function () {
  'use strict';

  const GROUPS = [
    { id: 'today', name: 'Today' },
    { id: 'dates', name: 'Dates and repeats' },
    { id: 'board', name: 'Board and lists' },
    { id: 'sort', name: 'Themes, tags and notes' },
    { id: 'stuck', name: 'Get unstuck' },
  ];

  const TODAY = '.tab[data-view="today"]';
  const BOARD = '.tab[data-view="board"]';
  const LISTS = '.tab[data-view="lists"]';
  const NOTES = '.tab[data-view="notes"]';
  const SETTINGS = '#settings-btn';
  const OPEN_TASK = 'Open the task (tap it on Today, Lists or the Board).';
  const MENU = 'Tap the ⋯ on its card or row.';

  const GUIDES = [
    // ── Today ──────────────────────────────────────────────────────────────────
    {
      id: 'plan-today', group: 'today', title: 'Plan what to do today',
      words: 'today list day plan add choose pick what next ready',
      where: 'Today', go: TODAY,
      steps: [
        'Open Today. It shows one day: the tasks planned for it, then Done.',
        'Tap Add from Ready at the bottom. The number on it is how many are waiting in Ready.',
        'Tap the + button beside each one you want today. “From the board backlog” underneath has the Backlog column too.',
        'To add something new straight onto the day, type it in Quick add at the top while you’re on Today.',
      ],
      done: 'The tasks are on the day’s list, ready to tick.',
      related: ['move-day', 'rollover', 'do-on'],
    },
    {
      id: 'rollover', group: 'today', title: 'Deal with tasks left from yesterday',
      words: 'yesterday unfinished carried over moved rollover missed not done old day past since',
      where: 'Today', go: TODAY,
      steps: [
        'Nothing to do: anything you didn’t tick moves onto today by itself, at the top.',
        'Tap one to see how long it’s been there (“On your list since …”).',
        'Then move it on if today isn’t the day: Tomorrow, Pick day, Ready, Backlog or Blocked.',
      ],
      done: 'Today only holds what you mean to do today.',
      tip: 'Past days only show what was planned and done; you can’t add to them. A repeat set to “Only that day” doesn’t carry over: it’s marked missed and the next one is booked.',
      related: ['move-day', 'repeat-missed'],
    },
    {
      id: 'move-day', group: 'today', title: 'Move a task to another day',
      words: 'move tomorrow later another day reschedule postpone push next week pick date',
      where: 'Today', go: TODAY,
      steps: [
        'Tap the task on Today to open its actions.',
        'Tap Tomorrow, or Pick day and choose a date. Ready takes it off the day without a date.',
        'On a computer you can also drag it onto the arrow beside the date.',
      ],
      done: 'It leaves this day and shows up on the day you picked.',
      related: ['plan-today', 'do-on'],
    },
    {
      id: 'reorder-today', group: 'today', title: 'Put today’s tasks in order',
      words: 'order reorder sort first priority top move up down arrange',
      where: 'Today', go: TODAY,
      steps: [
        'Tap the Reorder button beside the day’s tasks (it shows when there are two or more).',
        'Move tasks with the up and down arrows.',
        'Tap Done. On a computer you can simply drag the rows.',
      ],
      done: 'The list keeps that order on every device.',
    },
    {
      id: 'undo', group: 'today', title: 'Undo a tick or a change',
      words: 'undo mistake ticked wrong accidentally completed untick not done back',
      where: 'Today',
      steps: [
        'Right after ticking, tap Undo on the message at the bottom (it stays for a few seconds).',
        'Missed it? Open Done under the day’s list and untick the task.',
        'On a computer, Ctrl-Z or Cmd-Z undoes your last change to a task.',
      ],
      done: 'The task is back on the list as it was.',
      related: ['reopen', 'deleted'],
    },
    {
      id: 'work-home', group: 'today', title: 'Show only Work or only Home',
      words: 'work home filter focus hide office personal switch all',
      where: 'Today or the Board', go: TODAY,
      steps: [
        'On Today, tap All, Work or Home above the list.',
        'The Board has its own All, Work and Home in its toolbar, with a chip for each theme you can switch off.',
        'They’re separate on purpose: Today can show Home while the Board shows Work.',
        'Every task is Work or Home: it’s the switch under the title when you open it.',
      ],
      done: 'Only that side’s tasks show. Something you add while Work is showing is a Work task.',
      related: ['hide-weekend', 'themes'],
    },

    // ── Dates and repeats ──────────────────────────────────────────────────────
    {
      id: 'do-on', group: 'dates', title: 'Plan a task for a particular day',
      words: 'do on date day schedule plan future specific when',
      where: 'The task › Dates', go: TODAY,
      steps: [
        OPEN_TASK,
        'Under Dates, set Do on to the day.',
        'Save. Or, for today, tap ⋯ › Do today.',
      ],
      done: 'It appears on Today on that day. Clearing Do on sends it back to Ready.',
      tip: 'Do on is when you’ll do it. Do by is a deadline, which works differently.',
      related: ['do-by', 'move-day'],
    },
    {
      id: 'do-by', group: 'dates', title: 'Give a task a deadline',
      words: 'do by deadline due date before must finish late overdue',
      where: 'The task › Dates',
      steps: [
        OPEN_TASK,
        'Under Dates, set Do by to the deadline, and save.',
        'If it isn’t on the board yet, three days before the deadline it moves into the Backlog by itself.',
      ],
      done: 'The task shows its deadline, and it’s on the board in time.',
      tip: 'Do by never puts a task on Today. To do it on a set day as well, also set Do on.',
      related: ['do-on'],
    },
    {
      id: 'repeat', group: 'dates', title: 'Make a task repeat',
      words: 'repeat recurring every week daily monthly weekly routine regular again bins',
      where: 'The task › Repeat',
      steps: [
        OPEN_TASK,
        'Turn on Repeat and choose Daily, Weekly or Monthly, then how often (and which days, or which day of the month).',
        'Leave “Put it on Today on the day” ticked to have it land on Today. Without it, each one lands in the Backlog on its day.',
        'Choose what happens if you miss one, and save.',
      ],
      done: 'The next one is booked. When you finish it, the one after is booked.',
      related: ['repeat-missed'],
    },
    {
      id: 'repeat-missed', group: 'dates', title: 'Choose what happens when a repeat is missed',
      words: 'missed repeat skipped not done carry next day only that day disappeared',
      where: 'The task › Repeat › If missed',
      steps: [
        OPEN_TASK,
        'Under Repeat, “If missed” has two choices.',
        'Move it to the next day: it stays on Today until you do it.',
        'Only that day: an undone one is marked missed and the next one is booked instead.',
      ],
      done: 'Missed repeats behave the way you picked.',
      tip: 'This only applies when “Put it on Today on the day” is ticked.',
      related: ['repeat', 'rollover'],
    },
    {
      id: 'snooze', group: 'dates', title: 'Snooze a task until later',
      words: 'snooze hide later not now pause until come back',
      where: 'A task’s ⋯ menu',
      steps: [
        MENU,
        'Tap Snooze… and pick Tomorrow, 3 days, 1 week, 2 weeks or 1 month.',
        'To bring it back early, tap ⋯ › Unsnooze.',
      ],
      done: 'It’s out of the way until that day, then it comes back.',
      tip: 'In Lists, Select lets you snooze several at once.',
    },

    // ── Board and lists ────────────────────────────────────────────────────────
    {
      id: 'review', group: 'board', title: 'Sort the new items waiting for review',
      words: 'review new items pop up popup keeps appearing inbox captured quick add',
      where: 'Board › Review', go: BOARD,
      steps: [
        'Things added with Quick add (anywhere but Today) or from your phone’s shortcut wait to be reviewed.',
        'The Review sheet opens by itself when you open the app, or come back after 10 minutes away, while any are waiting. The small Review button on the Board opens it too.',
        'Tap an item to give it a theme and dates or put it on the board. The bin deletes it.',
        'Tap Done to keep the rest where they are (in Lists). Closing it with × leaves them for next time.',
      ],
      done: 'The sheet says All caught up, and it stops popping up.',
      related: ['capture'],
    },
    {
      id: 'move-card', group: 'board', title: 'Move a card to another column',
      words: 'move card column live waiting blocked ongoing backlog drag status',
      where: 'Board', go: BOARD,
      steps: [
        'On a computer, drag the card to the column.',
        'On a phone, tap ⋯ › Move to… and pick the column. (A long press also lets you drag.)',
      ],
      done: 'The card sits in its new column. Live with a day is on Today; Live without one is in Ready.',
      related: ['on-off-board'],
    },
    {
      id: 'on-off-board', group: 'board', title: 'Put a task on the board, or take it off',
      words: 'add to kanban board take off list themed list off board',
      where: 'A task’s ⋯ menu', go: LISTS,
      steps: [
        'In Lists, tap the task’s ⋯ › Add to Kanban. It goes into the Backlog.',
        'To take a card off, tap its ⋯ › Take off board. It goes back to Lists.',
      ],
      done: 'The board only holds what you’re actually working through.',
      related: ['move-card', 'park'],
    },
    {
      id: 'spotlight', group: 'board', title: 'Spotlight a task so it stays on top',
      words: 'spotlight star important top priority urgent pin highlight',
      where: 'A task’s ⋯ menu',
      steps: [MENU, 'Tap Spotlight. Tap ⋯ › Remove spotlight to undo it.'],
      done: 'It has a star and sits above everything else, even High priority.',
    },
    {
      id: 'subtasks', group: 'board', title: 'Break a task into steps',
      words: 'subtask sub-task steps checklist parts split card progress percent',
      where: 'The task › Sub-tasks',
      steps: [
        OPEN_TASK,
        'Under Sub-tasks, type each step and tap Add.',
        'A step that needs its own card: tap the card button beside it (To board).',
        'Save.',
      ],
      done: 'The task shows how far through you are. A step on its own card counts as done when that card is finished.',
    },
    {
      id: 'stale', group: 'board', title: 'Clear out old tasks',
      words: 'old stale tasks over 30 days clean up tidy cull',
      where: 'Lists', go: LISTS,
      steps: [
        'When tasks are over 30 days old, a note in Lists says how many. Tap Review on it.',
        'Lists shows just those, with Select on. Tick the ones to deal with.',
        'Use the buttons at the bottom to snooze, finish or move them together.',
      ],
      done: 'The note goes away until more tasks get old.',
    },

    // ── Themes, tags and notes ─────────────────────────────────────────────────
    {
      id: 'themes', group: 'sort', title: 'Add or change a theme',
      words: 'theme category colour rename new add sub-theme group',
      where: 'Settings › Themes', go: '[data-admin-open="themes"]',
      steps: [
        'Open Settings and tap Themes.',
        'Add a theme, or tap one to rename it, change its colour, Work or Home, and its sub-themes.',
        'Save.',
      ],
      done: 'The theme is on the Board’s chips and in the task window.',
      tip: 'A theme marked hidden disappears everywhere until you turn on Show hidden themes in Settings.',
      related: ['hide-weekend', 'tags'],
    },
    {
      id: 'hide-weekend', group: 'sort', title: 'Hide work themes at the weekend',
      words: 'weekend saturday sunday hide work off',
      where: 'Settings › Themes', go: '[data-admin-open="themes"]',
      steps: ['Open Settings and tap Themes.', 'Tap the theme and turn on Hide on weekends.', 'Save.'],
      done: 'On Saturday and Sunday its cards drop off the Board, and come back on Monday.',
      related: ['work-home', 'themes'],
    },
    {
      id: 'tags', group: 'sort', title: 'Tag tasks across themes',
      words: 'tag tags people person who where weekend label category filter',
      where: 'Settings › Tags', go: '[data-admin-open="tags"]',
      steps: [
        'Open Settings and tap Tags. Tags sit in categories (People, Seasonal…); add or rename them there.',
        'In a task, pick its tags under Tags: one per category.',
        'Filter by tags on the Board or in Lists.',
      ],
      done: 'Tags in one category widen the filter (Barney or Jim); a tag from another category narrows it (and Weekend).',
      related: ['saved-note'],
    },
    {
      id: 'saved-note', group: 'sort', title: 'Keep a shopping list with a saved note',
      words: 'shopping list errands saved note filter notes shop',
      where: 'Notes › Filter', go: NOTES,
      steps: [
        'Open Notes and tap + Filter.',
        'Pick the themes, sub-themes and tags to include, and any to leave out.',
        'Name it and tap Save as note.',
        'Quick add while that note is open parks the new item in it.',
      ],
      done: 'The note lists every open task that matches, wherever it lives, one tap away.',
      related: ['park', 'tags'],
    },
    {
      id: 'park', group: 'sort', title: 'Park something that isn’t a priority',
      words: 'park notes someday maybe idea not priority later clutter',
      where: 'A task’s ⋯ menu', go: NOTES,
      steps: [MENU, 'Tap Move to Notes.', 'It’s in Notes › Parked. Tap ⋯ › Move back to list when it matters.'],
      done: 'It’s kept, but out of Lists and off the board.',
      related: ['saved-note', 'snooze'],
    },

    // ── Get unstuck ────────────────────────────────────────────────────────────
    {
      id: 'sync', group: 'stuck', title: 'Fix a change that isn’t showing on another device',
      words: 'sync not syncing other device phone mac missing change came back ticked offline',
      where: 'The dot in the top bar',
      steps: [
        'Look at the dot in the top bar: green is synced, amber is busy, red is a problem. Tap it to sync now.',
        'Devices check every 20 seconds, and whenever you come back to the app.',
        'Still missing? Close the app or tab on that device and open it again. An old copy updates itself when it opens.',
        'If the dot says Too full to sync, see the guide on making room.',
      ],
      done: 'Both devices show the same tasks.',
      related: ['too-full'],
    },
    {
      id: 'too-full', group: 'stuck', title: 'Make room when it says Too full to sync',
      words: 'too full size warning space archive trim storage limit',
      where: 'Settings › Archive', go: '[data-admin-open="archive"]',
      steps: [
        'Open Settings and tap Archive, then Trim archive.',
        'Choose how old (finished more than 12, 6 or 3 months ago). It says how many that is.',
        'Tap Download backup to keep a copy, then Remove.',
      ],
      done: 'The warning goes and syncing starts again.',
      tip: 'Restore from a backup brings trimmed tasks back if you ever want them.',
      related: ['sync', 'backup'],
    },
    {
      id: 'reopen', group: 'stuck', title: 'Bring back a finished task',
      words: 'reopen finished completed archive bring back undo done restore',
      where: 'Settings › Archive', go: '[data-admin-open="archive"]',
      steps: ['Open Settings and tap Archive.', 'Find the task and tap Reopen.'],
      done: 'It’s back in the column it was finished from (Live comes back as Ready).',
      related: ['undo'],
    },
    {
      id: 'deleted', group: 'stuck', title: 'Bring back a deleted task',
      words: 'deleted delete bin trash recently restore undo lost gone mistake',
      where: 'Settings › Recently deleted', go: '#settings-bin',
      steps: [
        'Right after deleting, tap Undo on the message at the bottom.',
        'Missed it? Open Settings and tap Recently deleted.',
        'Find the task and tap Restore.',
      ],
      done: 'The task is back where it was, on every device. Deleted tasks are kept for 30 days.',
      tip: 'Themes, tags and saved notes aren’t kept there, so the app asks before deleting one.',
      related: ['undo', 'reopen'],
    },
    {
      id: 'backup', group: 'stuck', title: 'Back up, or restore from a backup',
      words: 'backup restore download export import file lost deleted',
      where: 'Settings › Data', go: '[data-admin-open="data"]',
      steps: [
        'Open Settings and tap Data.',
        'Download backup saves everything as a file.',
        'Restore from a backup adds back anything in the file that isn’t here now.',
      ],
      done: 'Restoring never changes or deletes what’s here, and what it adds shows on every device.',
    },
    {
      id: 'lock', group: 'stuck', title: 'Lock the app with a password',
      words: 'password lock private secure recovery code sign out log out',
      where: 'Settings › Require a password', go: SETTINGS,
      steps: [
        'Open Settings and turn on Require a password.',
        'Type the password and tap Enable lock.',
        'Write down the recovery code it shows. It’s shown only once.',
      ],
      done: 'Other devices ask for the password. A new password signs every other device out.',
      related: ['pattern', 'forgot'],
    },
    {
      id: 'pattern', group: 'stuck', title: 'Unlock by drawing a pattern',
      words: 'pattern draw swipe unlock dots lock screen password',
      where: 'Settings › Draw a pattern', go: SETTINGS,
      steps: [
        'Turn on Require a password first. The password stays the way back in.',
        'Open Settings and tap Set one beside Draw a pattern.',
        'Join at least 4 dots, then draw the same shape again.',
      ],
      done: 'The lock screen shows the dots. Tap Forgot pattern? there to type the password instead.',
      related: ['lock', 'forgot'],
    },
    {
      id: 'forgot', group: 'stuck', title: 'Get in when you’ve forgotten the password',
      words: 'forgot password locked out recovery code cant get in',
      where: 'The lock screen',
      steps: [
        'If the lock screen shows dots, tap Forgot pattern? first.',
        'Type the recovery code where the password goes.',
        'Once in, open Settings and set a new password. It makes a new recovery code.',
        'Lost both? The way back in is in the Cloudflare dashboard. The app’s handover, under Break glass, has the exact steps.',
      ],
      done: 'You’re in, with a password you know.',
      related: ['lock'],
    },
    {
      id: 'ai-updates', group: 'stuck', title: 'Update tasks from ChatGPT',
      words: 'chatgpt ai updates paste import voice brain dump plan',
      where: 'Settings › AI Updates', go: '#settings-ai-updates',
      steps: [
        'Open Settings and tap AI Updates.',
        'Copy for ChatGPT, then paste it into your AI Updates chat and talk it through.',
        'Paste ChatGPT’s reply back in, tick the changes you want and tap Apply.',
      ],
      done: 'The ticked changes are made. It can add, change, finish, move and snooze tasks, and never deletes anything or makes themes or tags.',
    },
    {
      id: 'capture', group: 'stuck', title: 'Add a task without opening the app',
      words: 'shortcut siri phone capture quick add outside link',
      where: 'Your phone’s Shortcuts app',
      steps: [
        'Make a Shortcut that opens life-kanban.pages.dev/?add= followed by the task.',
        'Run it. The app opens and adds the task.',
      ],
      done: 'The task waits in Review, so you can sort it later.',
      tip: 'Siri has been unreliable with this (it can add to Reminders instead), so check it landed.',
      related: ['review'],
    },
    {
      id: 'reminder', group: 'stuck', title: 'Get a daily nudge to look through Lists',
      words: 'reminder nudge daily review lists remember',
      where: 'Settings › Daily list review reminder', go: SETTINGS,
      steps: ['Open Settings and turn on Daily list review reminder.', 'Set Remind from to the time you want it.'],
      done: 'From that time, a note on the Board asks you to look at Lists, until you open them that day.',
    },
  ];

  function goTo(sel) {
    if (!sel) return;
    const settings = document.getElementById('settings-modal');
    // Admin buttons and AI Updates live inside Settings and work from there; tabs need Settings closed
    if (settings?.open && !settings.contains(document.querySelector(sel))) settings.close();
    document.querySelector(sel)?.click();
  }

  function openHelp(start) {
    return uiHelp.open({ title: 'Help', groups: GROUPS, guides: GUIDES, start, go: (g) => goTo(g.go) });
  }

  window.lifeListHelp = { open: openHelp, guides: GUIDES, groups: GROUPS };
  document.getElementById('settings-help')?.addEventListener('click', () => openHelp());
})();
