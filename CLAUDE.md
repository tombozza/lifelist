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

## Board columns

`KANBAN_COLS` holds every column; `boardColumns()` is what actually gets drawn. Completing
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
