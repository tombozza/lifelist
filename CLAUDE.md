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

## Notes (the parking list)

`task.inNotes` parks a task in the Notes view: off the board and out of Lists,
but never hidden — for things that aren't a priority at all yet shouldn't be
snoozed. Parked tasks are excluded from `getFilteredTasks()`, `needsReview()`
and `isStale()`, and `moveToKanban()` un-parks anything put on the board.
Don't confuse it with `task.notes`, which is the free-text field.

## Priority

Five levels in `PRIORITY_LEVELS` / `PRIORITY_ORDER`: urgent, high, medium, low,
minimal, plus '' for none, which always sorts last. urgent/minimal were added
*either side* of the original three so nothing already prioritised had to be
re-triaged. The list is the single source — the modal picker and the Lists
filter dropdown are both built from it, so add a level in one place only.

## Sub-tasks

`task.subtasks = [{id, title, done}]`, surfaced as a progress chip on the board
card and list row (`subtaskProgress` / `progressChipEl`). They're edited on the
task modal's second tab. A recurring occurrence copies the checklist with fresh
ids and everything unticked.

## Board columns

`KANBAN_COLS` holds every column; `boardColumns()` is what actually gets drawn.
`defaultBacklogCol(themeIds)` decides where a task lands when it goes on the
board: **Day if any of its themes has a work focus, Evening otherwise** — but
`modalKanbanCol` beats it, so a task created from a column's "+ Add task"
lands in *that* column. It used
to be the time of day — it isn't any more, so don't reintroduce `isEvening()`
there (it still drives the column *order*). Completing
a task still parks it in the `complete` column, but that column is marked `offBoard: true`
and is never rendered — tasks leave via "Mark complete" or the list checkbox, and the
week's tally sits above the board (`renderBoardWeekStat`). Don't delete the `complete`
entry: the archive, `clearCompleted()` and the list chips all still look up its name.

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
