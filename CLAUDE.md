# Life Kanban

A personal life-admin kanban board. Vanilla JS PWA on Cloudflare Pages, with Pages
Functions over D1. No build step.

Live: https://life-kanban.pages.dev · Repo: `github.com/tombozza/lifelist`

## Layout

```
index.html          the board
app.js              all client logic
styles.css
sw.js               service worker — bump CACHE_NAME on every asset change
functions/
  _middleware.js    edge auth gate for /api/*
  api/_lib.js       json(), sha256Hex(), sessionToken(), isAuthorized()
  api/auth.js       POST — password → session cookie
  api/settings.js   GET — tells the client whether the site is locked
  api/sync/[code].js  the state sync endpoint
migrations/d1/0001_init.sql
scripts/            seed-d1.mjs, seed-data.json
deploy.sh           ← use this, not a bare wrangler command
```

## Deploy — use `./deploy.sh`

```bash
./deploy.sh
```

Two reasons it exists, both of which will bite you if you bypass it:

1. **The Pages project is direct-upload, not git-connected.** Pushing to GitHub does
   *not* update https://life-kanban.pages.dev. But GitHub Pages
   (`tombozza.github.io/lifelist`) *does* auto-deploy on push — so the two silently
   drift apart if you only push.
2. **It stages the files first.** Deploying the repo root would upload `.claude/` too:
   wrangler ignores `.gitignore`, and Pages direct-upload ignores `.assetsignore`.
   The script copies only the site files plus `functions/` into a temp dir.

If you add a new top-level asset, **add it to the `cp` line in `deploy.sh`** or it won't ship.

## Themes on a task

A task carries **several** themes (Work + Jim). `themeIds` is the source of truth;
`themeId` is kept as a mirror of `themeIds[0]` so records written by an older device
— and everything already in D1 — keep rendering. Read it through the accessors, never
off the task directly:

- `taskThemeIds(t)` / `taskThemes(t)` — every theme, falling back to legacy `themeId`
- `primaryThemeId(t)` — the first *still-existing* theme, used for Lists grouping
- `withThemeIds(data, ids)` — writes both fields, deduped
- `themesPass(t, ...sets)` — a task stays visible while **one** of its themes is, so
  tagging something Work + Jim never makes it vanish from either filter

`migrateColumns()` re-derives the pair on load and after every sync merge. If a record
has a `themeId` that isn't in its `themeIds`, an older device wrote it last and `themeId`
wins — otherwise a stale array would mask the newer choice.

## Tags

Tags cut *across* themes — the same tag sits on a Work task and a Life one — so
they're a separate axis, not a second level of theme. They live in
`state.tagCategories` (`{id, name, color, tags:[{id,name}]}`) and a task holds
`tags: [tagId]`. Filtering is faceted: **OR within a category, AND across them**
(`taskMatchesTagFilter`), so Barney+Jim widens and +Weekend narrows.

- Tag ids come from `newTagId()`. Do **not** truncate `genId()` to build one:
  its first ~8 chars are the millisecond timestamp, so a whole category pasted
  in at once would get identical ids. That bug silently mis-tagged tasks.
- `state.tagsUpdatedAt` drives sync, wholesale, exactly like `themesUpdatedAt`.
- Deleting a tag or a category strips it off every task (`stripTagsFromTasks`) —
  a dangling id is invisible but would ride along in every sync payload forever.
- Editing a category's tags via the textarea matches lines to existing tags by
  name, then pairs up the leftovers *in order*. That is what makes renaming a
  line a rename (id preserved, tasks keep it) rather than a delete-plus-add.

The **People** theme was converted into the People tag category by
`migratePeopleThemeToTags` — its sub-themes became the tags, tasks moved over,
and the original theme is stashed in `state.removedPeopleTheme`. It persists
itself directly to localStorage because `saveState()` cannot run during
`loadState()`.

### The 8 Oct 2026 tag wipe — don't rebuild this trap

Four whole categories (How, Where, People work, Tools) and ten People tags
vanished. Cause: `peopleTagsMigrated` is a **per-device** flag guarding a change
to **shared** data, and the migration stamped `tagsUpdatedAt = Date.now()`. A
device opening late (or after a storage wipe) re-ran the migration against
freshly-*seeded defaults*, stamped them as the newest edit in the world, and its
wholesale push replaced everyone's real categories. Tasks merge per-task, so
they kept their tag ids — which is the only reason it was recoverable.

Three rules fall out of it, all load-bearing:

1. **A migration must never stamp `*UpdatedAt` with `Date.now()`.** Seeded
   defaults are not an edit. Leave the timestamps alone and let the first pull win.
2. **Never let a device that has not edited a wholesale-synced field push its
   defaults over the cloud's copy.** The pull guard is
   `remote newer || !state.tagsUpdatedAt`, not just `remote newer`.
3. **A per-device "already migrated" flag cannot guard shared data.** The
   migration now also bails out if any task already carries a tag.

`recoverOrphanThemes()` is the same safety net for themes, with one difference
worth keeping: a stale theme id usually has a *living namesake*, because the
theme was renamed or rebuilt and took a new id with it (`tech-mq71` → `tech-mq87`).
So it matches an existing theme by slug or name and **remaps the task onto it**
rather than creating a same-named twin, and only rebuilds a theme when nothing
matches *and* a live task still needs it — a dangling id on finished work just
wants pointing at the right theme. Only a rebuild stamps `themesUpdatedAt`; a
remap rewrites tasks, which carry their own `updatedAt`.

`recoverOrphanTags()` is the safety net and runs after every sync merge: a tag id
still on a task but absent from every category can only have come from a
wholesale overwrite (deleting a tag *strips* it from tasks), so it rebuilds the
category from the id — `"<categoryId>-<genId>"`, and genId has no dash — and
hands the tag back as `Recovered N` for renaming, which preserves the id. It sets
`localContrib` itself, because that flag is computed *before* the merge. The
pre-repair blob is in `.backups/` (gitignored via `.git/info/exclude`).

**Recovering the id is only half the job.** Shipping 19 tags called
`Recovered 3` with no way to tell what they were made the repair useless in
practice — the evidence (which tasks still carry the tag) only existed outside
the app. `recoveredTagFixer()` now puts a row under each category listing those
task titles, with a name box and a **Merge into…** picker. Merging matters as
much as renaming: a lost tag's name is often still sitting in the same category
unused, because the People migration re-seeded the names from the old theme — so
renaming would leave two `Dad`s where `mergeTag()` collapses them into one.
Recovery skips tags only used by completed tasks, so a few dangling ids stay in
the archive by design (the old `Tools` category is one).

## Notes (the parking list)

`task.inNotes` parks a task in the Notes view: off the board and out of Lists,
but never hidden — for things that aren't a priority at all yet shouldn't be
snoozed. Parked tasks are excluded from `getFilteredTasks()`, `needsReview()`
and `isStale()`, and `moveToKanban()` un-parks anything put on the board.
Don't confuse it with `task.notes`, which is the free-text field.

### Saved notes (smart lists)

Tom (10 Nov 2026): shopping and errands shouldn't clog Today or the board, but he
wants them as lists to pull up in the shop or at his mum's. The Notes view has a
pill row (`renderNoteBar`): **Parked** (the original `inNotes` list), each saved
note, and **+ Filter**. A saved note is a standing filter in `state.smartNotes`:
`{id, name, inc:{themes,subs,tags}, exc:{themes,subs,tags}}`, where subs are
`"themeId::Sub-theme"` (names alone collide across themes). `noteMatches()`:
any one match within a group, every non-empty `inc` group must match, anything
in `exc` rules it out, active tasks only, wherever they live. Examples: Shop ›
Black Friday; Shop but not Black Friday; tag Mum.

- **+ Filter is the builder and a live filter at once** (`renderNoteBuilder`):
  tri-state pills (show → leave out → clear) with the matches listed underneath,
  then "Save as note". Sub-theme pills only appear once their theme is picked.
- Quick add inside a note files the item into the note's theme / sub-theme /
  first tag and **parks it** (`inNotes`), so it stays off the board and out of Lists.
- Synced wholesale by `smartNotesUpdatedAt`, with the same guard as tags
  (`remote newer || !local stamp`); only real edits stamp it.
- The selected note is per-device (`localStorage lk-note-sel`).

## Priority

Five levels in `PRIORITY_LEVELS` / `PRIORITY_ORDER`: urgent, high, medium, low,
minimal, plus '' for none, which always sorts last. urgent/minimal were added
*either side* of the original three so nothing already prioritised had to be
re-triaged. The list is the single source — the modal picker and the Lists
filter dropdown are both built from it, so add a level in one place only.

## Sub-tasks

`task.subtasks = [{id, title, done}]`, surfaced as a progress chip on the board
card and list row (`subtaskProgress` / `progressChipEl`). They're edited in the
task modal's Sub-tasks section. A recurring occurrence copies the checklist with fresh
ids and everything unticked (and no card links).

**Split out to a card.** In the task modal, a step's ↗ button (`splitSubtaskToCard`)
makes it a real board card in Backlog, with the parent's themes and tags and
`parentId` pointing back; the step keeps `cardId`. The **card is the source of
truth**: `subtaskDone(st)` reads the card's status whenever the card exists, so the
parent's % (`progressChipEl`, now shown as a percentage) is right even when the two
records synced from different devices. `completeTask` mirrors the tick onto the
parent (`syncParentStep`), and ticking/renaming the step in the parent's modal does
the same to the card on save (`applyStepsToCards`). Delete the card and the step
falls back to its own tick. The child card shows a quiet `↳ Parent` chip.

## Link

`task.url` holds one web link, edited in the modal's **Link** section (an "Open"
button follows the box). `normaliseUrl()` adds `https://` to a bare address.
Cards, Today rows and list rows show it as a chip with the site's name
(`linkChipEl`); the chip *is* the link and stops the click from opening the task.

## Undo

Ctrl/⌘-Z, plus an **Undo** toast after every completion (phones have no Ctrl-Z).
`saveState()` keeps a snapshot of `state.tasks` as it was before each change and
pushes it onto `undoStack` (30 deep, in memory only) — but **only when a person
caused the save**: a capture listener stamps `userIntentAt` on any pointer, key,
drop or change, and saves more than 1.5s after one aren't recorded. Sync merges
set `inSyncMerge` around their save. So rollover, recurring checks and sync
move the baseline but never become undo steps, and undo can't revert someone
else's edit that just synced in. `undoLast()` restores only the tasks that
differ, re-stamping `updatedAt` so the restored version wins the next sync;
tasks the change created are tombstoned, tasks it deleted get their tombstone
lifted. Ctrl-Z is ignored while typing in a box or while a modal is open.
Only tasks are covered, not themes or tags.

## Board columns

`KANBAN_COLS` holds every column; `boardColumns()` is what gets drawn. Columns are
**Backlog, Live, Waiting, Blocked, Ongoing**. Two merges, both 4 Nov 2026, both done
by `migrateColumns()` on load *and after every sync merge* (an older cached device
can still write the old ids):

- Next + In Progress → **Live**.
- Day + Evening backlogs → one **Backlog** (Tom: "Don't need day/evening anymore").
  `defaultBacklogCol()` now always returns `'backlog'`; it keeps its `themeIds`
  argument only so the callers didn't need touching. Don't reintroduce a work/home
  column split — work/home is a *filter* now (the board's focus control, and
  Today's own switch).

A task created from a column's "+ Add task" lands in that column (`modalKanbanCol`).
Completing a task still parks it in the `complete` column, but that column is marked
`offBoard: true` and is never rendered — tasks leave via "Mark complete" or the list
checkbox, and the week's tally sits above the board (`renderBoardWeekStat`). Don't
delete the `complete` entry: the archive, `clearCompleted()` and the list chips all
still look up its name.

## Today (the top tier)

The tiers, bottom to top: snoozed list items → themed Lists → off-board → the
Board → **Today**, with Notes off to the side. Today is the default view on open.

- Everything in the **Live** column feeds it. `task.planDay` (`YYYY-MM-DD` or null)
  puts a Live task on a day; Live with no day is **Ready**.
- `task.planOrder` is the to-do list's own order (▲▼ in reorder mode, drag on
  desktop). Priority is deliberately not shown on Today.
- **Rollover:** `rollOverPlan()` moves any unfinished Live task from a past day onto
  today, at the top, and sets `carriedFrom` to the day it was first planned for (the
  "↻ since" chip). It's deterministic so devices agree, and runs on render, every
  minute, and after each sync merge.
- A day only means something while the task is Live: `updateTask()` and
  `migrateColumns()` clear `planDay` the moment a task leaves Live. Completing keeps
  it, re-stamped to the completion day, so that day's "Done" section shows it.
- **Today shows one day**, on every screen size, with ‹ › arrows to step to other
  days (`todayDay`). Tom asked for no week view ("I just don't want a full week
  view") and for Ready hidden away — don't bring either back unasked. Ready and
  quick add work on the day being shown; past days are read-only (their work has
  rolled forward), so quick add there goes to today.
- **Ready is hidden on purpose**: it lives in a sheet (`#ready-modal`,
  `renderReadySheet`) behind the quiet "Add from Ready · N" button, along with the
  board backlog. Keep it off the main screen.
- Tapping a row opens its action strip (Tomorrow, Not today, Pick a day, Blocked,
  Backlog, Edit), so it's all taps on a phone.
- **Desktop drag** (only where `canDragTodo()` sees a mouse): drag a row to reorder
  (`makeTodoDropList` → `dropIntoPlan`), or drop it on ‹ › to move it a day
  (never into the past). Phones never get `draggable`, so scrolling stays clean.
- **Work / Home switch** on Today (`state.settings.todayFocus`, `todayFocusPass`):
  its own setting, deliberately *not* the board's theme-chip mutes, so muting a chip
  on the board never hides a task here. No theme counts as home. It filters the day,
  Done and the Ready sheet. Reordering while filtered renumbers the whole day first
  (`nudgePlanOrder`, `dropIntoPlan`) so hidden tasks keep their places, and adding
  while on Work stamps the first work theme (`todayFocusThemeIds`) so the new task
  doesn't vanish.
- On Today, quick add and the + button plan straight onto today
  (`quickAddPlanTarget`, `modalPlanDay`) instead of going to Review.

## Repeats on Today

Tom (10 Nov 2026): a repeat should be able to "pop up every Monday" on Today, and
he chooses whether a missed one follows him to the next day or only counts on
its day. Two fields on `task.recurring`, set in the Repeat section (new repeats
default to on + carry; older ones are unchanged, so they keep going to Backlog):

- `onToday` — `checkRecurring()` wakes the occurrence straight into **Live** with
  `planDay` = its scheduled date, at the top of that day.
- `missed: 'carry' | 'skip'` — carry is the normal `rollOverPlan()`. Skip: a
  past-day one is handed to `missOccurrence()` instead: filed as `wont-do` with
  `missed: true` / `missedOn`, and the next occurrence on or after today is
  scheduled (deterministic id, so devices agree). Works even if the app wasn't
  opened that day, because the woken occurrence's `planDay` is its own date.

## The task modal — progressive disclosure

Tom (4 Nov 2026): "it needs tidying up and more progressive disclosure". Only the
title and Themes are always shown. Tags, Priority & size, Dates, Repeat, Sub-tasks
and Notes are `[data-section]` blocks behind "+" pills (`TASK_SECTIONS`,
`renderTaskSections`, `openTaskSection`); editing a task opens the sections that
already hold a value. The old Details / Notes tabs are gone. In Tags, each category
is folded to its chosen tags (`modalTagCatsOpen`); untouched categories share one
line. New fields belong in a section, not loose in the modal.

## No theme chips on cards

Tom (4 Nov 2026): he doesn't scan cards for themes, the filters do the sorting, and
the solid theme colour pulled his eye off the title. So board cards, Today rows, the
Ready sheet and Lists rows show **tags but no theme chips**. Only the Admin archive
still shows them. Don't add them back to a card.

Priority on a board card is a 3px **left border** (`.board-card.priority-*`), the same
as a list row. It used to be a bar across the top, right where the eye starts reading
the title.

Card layout (`createBoardCard`), all so a column scans as a list of titles: the title
has the top row to itself, and the top-right **corner belongs to the ⋯ menu alone**
(Tom: putting the size there "interrupts the three little dots"). With a mouse, ⋯
floats over the corner on hover, taking none of the title's width, and right-click
opens the same menu; on touch it sits in the corner, always visible. Everything else
is the bottom row, **right-aligned**: tags, progress, recurring, countdown, then the
day mark and size at the far end. A Live task's day is a small calendar icon
(`.card-day`) — blue for today, grey with the day name for later, nothing for Ready —
never a chip that reads like a tag.

## Navigation

Tabs are Today, Board, Lists, Notes. **Admin has no tab**: Settings (the gear) has
Themes / Tags / Archive / Data buttons that open it (`data-admin-open`, `showView`).
The Notes tab deliberately shows no count.

The floating **+** is hidden on Admin (it adds a task, and it sat on top of the tag
boxes' Add buttons), and `main` has ~90px of bottom padding so on every other page
the last row can scroll clear of it.

Admin › Tags: adding a tag redraws the page, so `go()` re-focuses the *new* input for
that category (`data-tag-add-for`) and restores the scroll — Enter, name, Enter… must
keep working without the mouse.

## Auth

The shared pattern (see the root `CLAUDE.md`), identical to `golf-tracker` bar the cookie
name (`lk_session`):

- `_middleware.js` gates `/api/*` when `settings.password_enabled` is set in D1.
- `POST /api/auth` and `GET /api/settings` stay open so the static app can load and show
  its password screen.
- Stateless session token: `HMAC(AUTH_SECRET, "authenticated")`.

`golf-tracker` has the same files. Fix a bug in one, fix it in both.

## History

Migrated off Supabase. The migration scripts and credentials have been removed; D1 is the
only backend.

## Commands

```bash
npx wrangler pages dev .                                  # local, with functions
npx wrangler d1 migrations apply life-kanban-db --local   # or --remote
node scripts/seed-d1.mjs
./deploy.sh
```

`AUTH_SECRET` is a Pages secret and **only takes effect on the next deploy**.
