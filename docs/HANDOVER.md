# Life Kanban — handover

Written 10 Nov 2026. This is the front door. The detailed design notes (sync rules, tags,
Today, the task modal, card layout) are in [`../CLAUDE.md`](../CLAUDE.md) and are not repeated
here. Shared rules for all of Tom's apps (hosting, the two GitHub accounts, secrets, D1 limits)
are in [`../../CLAUDE.md`](../../CLAUDE.md).

## What it is

Tom's personal life-admin to-do app, built ADHD-friendly as a set of tiers: snoozed items →
themed Lists → off-board → a kanban Board (Backlog, Live, Waiting, Blocked, Ongoing) → a
**Today** to-do list on top (the default screen), with **Notes** off to the side for parked
items and saved filter lists (e.g. shopping). Single user, used on iPhone (as a PWA) and his
work and home Macs. Live: **https://life-kanban.pages.dev**. Repo: private `tombozza/lifelist`.

## Run it locally

No `package.json`, no build step. You need Node 18+ (wrangler is fetched by `npx`).

```bash
git clone https://github.com/tombozza/lifelist.git life-kanban && cd life-kanban
# tombozza repo: set the per-repo credential helper before pushing (../../CLAUDE.md, "Two GitHub accounts")
cp .dev.vars.example .dev.vars          # optional; fill AUTH_SECRET only if you test the password lock
npx wrangler d1 migrations apply life-kanban-db --local
npx wrangler pages dev . --port 8080    # also in .claude/launch.json
```

Open http://localhost:8080. Local D1 starts empty, so the app starts with its seeded default
themes. `node scripts/seed-d1.mjs` loads `scripts/seed-data.json` into the local server, but
that file is personal data and **gitignored**, so it is not in a fresh clone. To get real data
locally, use Settings › Data › Download JSON backup on the live site, then Import it locally.

## Deploy

```bash
./deploy.sh
```

Direct-upload Pages project, so a git push publishes nothing. `deploy.sh` pins Tom's
Cloudflare account, copies only `index.html app.js styles.css sw.js manifest.json icons/
vendor/ functions/` into a temp folder and deploys that. Not deployed: `CLAUDE.md`, `docs/`,
`.claude/`, `scripts/`, `migrations/`, `.backups/`. A new top-level asset must be added to the
`cp` lines or it won't ship. Bump `CACHE_NAME` in `sw.js` on every asset change (v68 at the
time of writing). Schema changes: add a file to `migrations/d1/`, then
`npx wrangler d1 migrations apply life-kanban-db --remote`.

## How it's built

- **Client:** plain JS. `app.js` (~5,000 lines, all logic), `index.html`, `styles.css`,
  `sw.js` (network-first service worker), `vendor/` (shared chassis CSS from `_shared`, plus
  `fuzzy.js` search and `clearx.js` clear buttons). It is registered in `_shared/apps.json`, so
  `node _shared/sync.mjs` refreshes `vendor/chassis/`; don't edit those copies here.
- **State:** the whole app state (tasks, themes, tags, smart notes, settings) is one JSON object
  in `localStorage`, and one blob in D1 under a fixed `SYNC_CODE` (a constant in `app.js`).
  The client polls every 20s, merges per task by `updatedAt` (tombstones for deletes) and
  wholesale for themes/tags/notes by their `*UpdatedAt` stamps. Read the tag-wipe section in
  `CLAUDE.md` before touching any merge or migration code.
- **Inbox:** a sibling row `<SYNC_CODE>-inbox` holds `{pending}` text from outside capture;
  the app imports it and clears it.
- **Quick capture:** opening `/?add=Some+task` adds a task (used by an iOS Shortcut).
- **API (Pages Functions):** `functions/_middleware.js` (password gate on `/api/*`),
  `api/auth.js`, `api/settings.js`, `api/sync/[code].js` (GET/PUT the blob). Auth is the shared
  gate copied from golf-tracker, see `../../CLAUDE.md`, "The shared password gate".
- **External services:** Cloudflare only (Pages + D1, account in `../../CLAUDE.md`). No AI, no
  third-party APIs, no CDN scripts.

## Config and secrets

| Name | What for | Where set |
|---|---|---|
| `AUTH_SECRET` | Signs the `lk_session` cookie for the optional password lock. Falls back to a built-in dev value if missing. | Pages secret (`npx wrangler pages secret put AUTH_SECRET --project-name life-kanban`), takes effect on the next deploy. Locally `.dev.vars` (see `.dev.vars.example`). |
| `DB` | D1 binding to `life-kanban-db` | `wrangler.jsonc` |

The password itself is not a secret in config: it is set in the app (Settings), stored as a
SHA-256 hash in D1 `settings`. The lock is off by default. While it is off, anyone who knows
the sync code can read and write the blob.

## Data

- **Real data:** D1 `life-kanban-db`, table `kanban_sync` (one row per sync code, plus the
  inbox row), and `settings` (lock switch and hash). Each device also holds a full copy in
  `localStorage`.
- **Backup / export, three routes:**
  1. In the app: Settings › Data › **Download JSON backup** (file `life-kanban-YYYY-MM-DD.json`);
     **Import JSON backup** restores it.
  2. Whole database: `npx wrangler d1 export life-kanban-db --remote --output life-kanban-backup.sql`
     (run from the app folder, with `CLOUDFLARE_ACCOUNT_ID` set as in `deploy.sh`).
  3. The raw blob: `GET https://life-kanban.pages.dev/api/sync/<SYNC_CODE>` (needs the session
     cookie if the lock is on).
- `.backups/sync-blob-2026-10-30-pre-tag-repair.json` is the blob from before the tag repair,
  kept locally and ignored through `.git/info/exclude`, so it is not in the repo.

## Decisions

Newest first. Most have a longer explanation in `CLAUDE.md`.

- 2026-11-11: Theme, sub-theme and tags became one always-open block in the task window: every row one sideways-scrolling line, sub-themes as chips, one tag per category (a tap replaces that category's other tag). Tom: tags under chevrons meant expanding five menus. Applies to the current window and all four test layouts.
- 2026-11-11: Tom said the task window "doesn't work at all" (too many big pills, scattered options). Four test layouts built behind Settings › Task window layout (per device): A property list, B composer bar, C two panes, D quick add then a full page. They only rearrange the same modal DOM (`applyTaskLayout`), so saving and sync are unchanged. When Tom picks one, build it in properly, move its styles into the shared components and delete the other three plus the setting.
- 2026-11-11: Black Friday is a Seasonal tag only (Tom: "keep the tag"); the duplicate Shop sub-theme was removed from the live data (no task used it). The Black Friday note filters on Shop + the tag.
- 2026-11-11: Task window layout E, Sections, is now the default (Tom: "Can you not just have sections for themes, sub-themes, tags etc?"): every part open under its own heading. C and D removed (Tom: "a no go"); a saved C/D falls back to E. A, B and the old window stay in Settings for comparison. Service worker v74.
- 2026-11-11: Shared light/dark switch (`_shared/chassis/theme.js`, Tom: "add dark/light switches across all apps"): theme.js loads first in `<head>`; Auto / Light / Dark is in Settings › Appearance and replaces the app's own Dark mode checkbox (a saved Dark carries over once, `lk-theme-moved`). Service worker v70. Checked in Light and Dark at phone width. Deployed live the same day (Tom's go-ahead).
- 2026-11-10: Every screen is now built from the shared components (`_shared/chassis/components.css`, the `ui-` classes), loaded after tokens.css and controls.css; the app's own buttons, cards, fields, pop-ups and neutral colour tokens are gone, and it keeps only its accent, priority and spotlight colours. Pop-ups are `<dialog class="ui-sheet">`; Today's tick is a real checkbox. Its own light/dark switch still defaults to light. Deployed live the same day (10 Nov 2026, Tom's go-ahead).
- 2026-11-10: Repeats can go straight onto Today on their day, with a per-repeat choice to
  carry a missed one forward or mark it missed and book the next. New repeats default to on +
  carry; older ones keep going to Backlog until edited.
- 2026-11-10: Saved notes are standing filters (themes, sub-themes, tags, with leave-outs),
  so shopping and errands live off the board and Today but can be pulled up anywhere.
  Quick add inside a note parks the item there.
- 2026-11-10: Checkboxes and switches drawn by the shared chassis controls, not hand-made.
- 2026-11-06: One web link per task, shown as a chip. Undo via Ctrl/Cmd-Z plus an Undo toast
  after completing (phones have no Ctrl-Z); only person-caused task changes are undoable.
- 2026-11-04: Added Today as a tier above the board because the kanban "scares" Tom on a phone
  and he stopped using the app. Today shows one day with arrows, no week view, and Ready is
  hidden in a sheet. A week view and Ready toggle shipped and were removed the same day.
- 2026-11-04: Next + In Progress merged into Live; Day/Evening backlogs merged into one Backlog
  ("Don't need day/evening anymore"). Work/home is now a filter, not columns.
- 2026-11-04: Theme chips removed from cards (filters do the sorting; the colour pulled the eye
  off the title). Priority became a left border; the card corner belongs to the ⋯ menu only.
- 2026-11-04: Task modal uses progressive disclosure: only title and themes always visible.
- 2026-11-04: Admin moved into Settings; the Notes tab shows no count.
- 2026-11-04: Sub-tasks can be split out to their own board card; the card is the source of
  truth for the parent's % complete.
- 2026-10-30: After the 8 Oct tag wipe, migrations must never stamp `*UpdatedAt`, a device that
  hasn't edited a wholesale field can't push defaults over the cloud, and per-device flags can't
  guard shared data. Orphaned tags and themes are recovered automatically after every merge.
- 2026-10-30: `deploy.sh` pins the Cloudflare account id (two accounts are signed in).
- 2026-09-23: Five priorities (urgent and minimal added either side, so nothing needed
  re-triaging); XS is the default size; Notes parking list added.
- 2026-09-18: Tags as a cross-theme axis (OR within a category, AND across); People theme
  converted into a People tag category.
- 2026-09-15: A task can carry several themes (`themeIds`, with `themeId` kept as a mirror for
  older records).
- 2026-08-05: On mobile, dragging a card needs a long press, so swiping between columns works;
  the ⋯ menu's "Move to" is the main way to move cards on a phone.
- 2026-07-24: Moved from Supabase to Cloudflare D1 via Pages Functions, copying media-tracker,
  so no database key ships to the browser. Supabase realtime replaced by 20s polling. Kept the
  single-blob data model rather than per-row tables; seeding goes through the API because the
  blob is too big for one SQL statement.
- 2026-07-20: Tom: "Just push and publish. You don't need to ask" for this app (from memory
  notes; still subject to the session's own rules).
- 2026-07-15: All / Work / Home focus switch replaced a complicated per-chip toggle scheme
  (after several attempts on 6–8 Jul, Tom asked to "simplify this").
- 2026-07-15: Moved hosting from GitHub Pages to Cloudflare Pages; Tom unpublished the GitHub
  Pages copy the same day.
- 2026-06-17: Spotlight (super-priority) and a review queue for new captures.
- 2026-06-11: `?add=` URL capture for a Siri Shortcut. Tom found Siri unreliable (it added to
  Apple Reminders instead, and failed when locked), so treat Siri capture as best-effort.
- 2026-06-04: Rebuilt from scratch as Lists + Board + Admin with recurring tasks and themes.
- 2026-06-03: First version, with Supabase sync.

## Status

- **Works:** Today, Board, Lists, Notes and saved notes, recurring tasks (incl. onto Today),
  sub-tasks and split-out cards, tags, links, undo, JSON backup/import, optional password lock,
  multi-device sync. Fresh-clone setup works (see Setup check).
- **In progress (uncommitted, 10 Nov 2026):** `functions/api/settings.js` has a local change so
  that turning the lock on with a blank password keeps the existing one, instead of being
  refused. This fixes the "leave blank to keep the current password" bug noted in
  `../../CLAUDE.md`. Not committed or deployed; golf-tracker has the same file and would drift.
- **Known loose ends:** from the tag repair, Jim, Laura and Jack each exist in both the People
  and People work categories, so some cards show them twice; People also has a spare unused Dad
  and James. Tom to decide whether People work keeps its own copies.
- **Stale docs:** `CLAUDE.md` and `deploy.sh` comments still say GitHub Pages
  (`tombozza.github.io/lifelist`) auto-deploys on push. Tom unpublished it on 15 Jul 2026 and the
  repo is now private, so this is out of date (unconfirmed whether the Pages setting is fully off).
- **Testing (11 Nov 2026):** task window defaults to Sections (E); A, B and the old window still in Settings. Waiting for Tom to confirm E, then delete the rest.
- Waiting on Tom to live in Today for a while and say what's missing.

## Parked ideas

- A week view on Today, and showing Ready on the main Today screen: built and removed on
  4 Nov 2026. Don't bring back unasked.
- Day/Evening backlog columns that swap at 5pm (built June 2026, removed 4 Nov 2026).
- Theme chips on cards (removed 4 Nov 2026).
- The "All" chip and the per-chip on/off toggle for Work (July 2026, replaced by the focus switch).
- Siri hands-free capture while locked/in the car: not achievable with the Shortcut approach.
- Bulk add: Tom said in July he'd never used it; it was shrunk, not removed.

## Setup check

10 Nov 2026, fresh clone of the local repo into a scratch folder:

- All JS parses (`node --check` on `app.js`, `sw.js`, `vendor/*.js`, every function, the seed
  script). Every file `deploy.sh` copies and every asset `index.html` references is present.
- `npx wrangler d1 migrations apply life-kanban-db --local` (wrangler 4.160.0): pass,
  `0001_init.sql` applied.
- `npx wrangler pages functions build`: pass, compiled.
- Found: `node scripts/seed-d1.mjs` cannot work from a fresh clone because `seed-data.json`
  is gitignored. The steps above now say so and give the JSON-backup route instead.
- Dev server not started, nothing deployed. Clone deleted.
