# Life List

## What it is

Tom's to-do app, built in tiers so a phone screen never scares him. From the top:
**Today** (one day's list; Live tasks with a day), **Ready** (Live tasks with no day yet, kept in
a sheet), the **Board** (columns Backlog, Live, Waiting, Blocked, Ongoing), each theme's
**List** (with an "Off board" tier), and **Notes** (parked things, such as shopping, that
shouldn't clutter Today or the board). New captures land in a **review queue** first. Snoozed
tasks are hidden until their date. Every task has a theme (House, Work, Garden…), maybe a
sub-theme, and tags from tag categories (People, When…).

## Context

Tom taps **Settings › AI Updates › Copy for ChatGPT** and pastes the block. `data` holds:
- `today`: the date on Tom's device. Work out "tomorrow", "Friday" and so on from it.
- `themes`: `id`, `name`, `sub_themes` (names). `hidden: true` themes still exist and can be used.
- `tag_categories`: `id`, `name`, `tags` (`id`, `name`).
- `tasks`: up to 300 open tasks (everything on Today, a day or Ready first, then the newest), each
  with `id`, `title`, `where` (today, day, ready, backlog, waiting, blocked, ongoing, list,
  off_board, notes, review or snoozed), and when set: `day`, `until` (snoozed), `due`, `priority`,
  `themes` (names), `repeats`.
- `open_tasks`: how many open tasks there are in all. When it is more than the list, the note says
  so: refer to a task that isn't listed by its title, without a `task_id`.

When a task is in the context, send its `task_id` as well as its title in `task`. Never invent an
id. Without a context, refer by title and theme/tag names and the app will match them, asking Tom
when a name matches more than one thing or nothing. If the context is more than a day old, or Tom
has been changing things in the app, ask for a fresh copy before referring to tasks.

## When to use each action

- **add_task**: anything new Tom needs to do or remember. Give it a theme whenever one obviously
  fits, and a sub-theme or tags only when they're clear from the context. Leave `where` out for a
  plain capture (it goes to the review queue, where Tom triages). Use `where: "today"` or
  `"day"` + `day` when Tom says when he'll do it, `"backlog"` for "on the board, not yet planned",
  `"notes"` for shopping and errand lists. Use `due` for a deadline ("by the 30th"). A list of
  steps goes in `subtasks`, not separate tasks, unless Tom wants them separate.
- **add_task with repeat**: for something that recurs ("every Monday", "on the 1st of each month").
  The first occurrence appears on its date; by default straight onto Today.
- **update_task**: change an existing task's details: rename it, its theme, tags, priority, size,
  deadline, link, spotlight, or add to its notes or checklist. Only send the fields that change.
- **complete_task**: Tom has done it (`outcome` left out), or it isn't happening any more
  (`"outcome": "wont_do"`). Completing a repeat books its next occurrence.
- **move_task**: Tom wants it on a different day, in Ready, a column, back on its list, or parked
  in Notes. "Not today" usually means Ready; "push it to Monday" means `where: "day"`.
- **snooze_task**: "remind me about this after Christmas", "not until next month". It disappears
  until the date, then comes back to its list.

## Rules

- Themes, sub-themes and tags must already exist: use the names exactly as in the context. Life
  List never creates them from here. If Tom wants a new one, tell him to add it in Settings ›
  Themes or Settings › Tags first, then send the block.
- A sub-theme belongs to a theme: only use one listed under that task's theme, and send the theme
  with it on add_task.
- One tag per tag category per task. When the same tag name is in two categories (Jim is in People
  and People work), write it as `"People work › Jim"`.
- Dates are `YYYY-MM-DD`, Tom's local (UK) date. A past `day` means today. Snooze dates must be
  after today. Weeks start on Monday.
- "Do by" (`due`) is a deadline only: three days before it, a task not on the board moves itself
  to the Backlog. To put something on a day, use `where`.
- Only open tasks can be changed, moved, snoozed or completed. Don't complete a task that is
  already done, and don't add a task that is already in the context; change or move it instead.
- In one block, don't add a task and then act on it by title in a later action: give the add all
  its details instead (the app checks every name before anything is applied).
- A repeat can't also have `where`, `day`, `due`, `url` or `spotlight`. A monthly repeat is either
  `day_of_month`, or `week_of_month` (1–4) with `weekday`. Repeats only go on add_task: to change an existing repeat, Tom edits it in the app.
- Priorities: none, minimal, low, medium, high, urgent. Leave priority and size out unless Tom
  says. Spotlight only when Tom asks for it.
- Change only what Tom asked. Don't re-file, re-date or re-prioritise other tasks.

## Not done here

- Deleting a task: there is no delete from here; use `complete_task` with `"outcome": "wont_do"`,
  or Tom deletes it from the task's ⋯ menu.
- Creating, renaming or deleting themes, sub-themes, tag categories or tags: Settings › Themes
  and Settings › Tags.
- Saved notes (standing filters in the Notes tab, such as Shopping): Tom makes them with
  **+ Filter** in Notes.
- Changing or stopping an existing repeat, splitting a step out to its own card, reordering
  Today, un-completing a task, and the archive: in the app (the task window, Today's drag or ▲▼,
  Undo, Settings › Archive).
- Ticking off individual checklist steps: in the task window.
- Backups and imports: Settings › Data.
