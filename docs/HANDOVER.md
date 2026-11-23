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
vendor/ functions/` plus `ai/*.js` into a temp folder and deploys that. Not deployed: `CLAUDE.md`, `docs/`,
`.claude/`, `scripts/`, `migrations/`, `.backups/`. A new top-level asset must be added to the
`cp` lines or it won't ship. Bump `CACHE_NAME` in `sw.js` on every asset change (v68 at the
time of writing). Schema changes: add a file to `migrations/d1/`, then
`npx wrangler d1 migrations apply life-kanban-db --remote`.

## How it's built

- **AI Updates:** `ai/` holds the ChatGPT contract (`schema.js`, `guide.md`), the pure logic (`logic.js`: names → records, actions → app calls, the context) and the Settings sheet glue (`updates.js`, a module loaded after `app.js`). Tests: `node --test tests/*.test.mjs` (no package.json needed).
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
- **External services:** Cloudflare only (Pages + D1, account in `../../CLAUDE.md`). No AI calls
  (AI Updates is copy and paste with ChatGPT), no third-party APIs, no CDN scripts.

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

- 2026-11-23: **No grey example text; ticks get their own tap square** (rules sweep, `_shared/RULES.md` W1, W2, C2). Every box lost its placeholder (the quick-add box's "Add to today" is now its aria-label, set in the same place); List search says only "Search". Trim archive's explaining line went (its own confirm still says what it removes). The Done ticks on list rows, Today rows and steps sit in `<label class="check zone">` via `tickZone()` in app.js (click doesn't open the task); the grid rule in styles.css follows the label. Service worker v105, live 23 Nov; after-deploy check passed, 36 views. Ticking wasn't tried on the live board (it would change real tasks).
Newest first. Most have a longer explanation in `CLAUDE.md`.

- 2026-11-22: **Settings rebuilt as groups of rows** (Tom on House Book's: "just a bunch of stuff thrown on a page with no thought"; House Book's `renderSettings` is the model). Order: Your board (Themes, Tags, Archive rows; Show hidden themes and Daily list review reminder switches; Remind from), Appearance, Password (Require a password, with Locked as its sub; the new-password field; Recovery code; Log out this device), AI (AI Updates), Your data (one Data row: the admin Data page), Help (How to…), then Testing. Each group is a `.ui-label` heading over a `.ui-card` list of `.ui-row`s; every ID and `data-admin-open` the JS and the Help guides use is unchanged, and so is every stored setting. The Task window layout select (`lk-task-layout`, the 11 Nov trial; code says fold in the winner and delete the rest) is kept as-is in a last Testing group, now `data-fixed`. Recovery code's sub line is a state now (Made / None yet), not an explanation; the password box has a label instead of placeholder text. `.settings-admin` CSS removed. design-check --changed clean; live-check of Settings and Help locally at 375/1000 light/dark shows only the Today page's three old issues behind the sheet (same on the live site). Service worker v103. Not deployed.
- 2026-11-22: **Help (Settings › Help › How to…)**: the shared Help sheet (`vendor/chassis/help.js`, `uiHelp`) with 30 how-to guides in `help/help.js` (five groups: Today, Dates and repeats, Board and lists, Themes tags and notes, Get unstuck), written from this handover's Decisions and a read of `app.js`/`index.html` (plan: `../briefs/help-audit-2026-11-21.html`). `go` is a CSS selector Take me there clicks (a view tab, a `data-admin-open` button, `#settings-btn`, `#settings-ai-updates`); Settings closes first unless the target lives inside it. No Ask yet (Finance's runs a week first). `deploy.sh` copies `help/`; `index.html` loads `vendor/chassis/fuzzy.js`, `help.js`, then `help/help.js` after `app.js`. Two Help screens added to `_shared/qa/screens/life-kanban.json`. **Keep the guides true:** a change to a screen's words or steps changes its guide in the same edit. Checked locally at 375 dark and 1100 light: list, fuzzy search, a guide, Take me there to Archive, Notes, Settings and AI Updates; no console errors; tests 41/41. Service worker v102. Deployed 22 Nov.
- 2026-11-21: **Icons, not emoji** (Tom: "I'd rather just custom icons"). The last emoji went (🎉 on the empty aged list is dropped; the 🕶 after a hidden theme's chip in the task window is now an eye-off icon), and every text glyph used as an icon is a shared icon (`uiIcon`, `vendor/chassis/icons.js`): ★ spotlight (a filled star), ↻ repeat badge, ⋯ menus, ▲▼ reorder, ▸▾ Tags and section toggles, ‹ › day arrows, ↑↓ on the week's tally, × on a tag chip, the + on every add button, and the sync dot (a filled circle). The app's hand-drawn SVGs went too (settings cog, Filters & sort, the add button, link, card-out, snoozed clock, Add to/Remove from Kanban, delete, the card's day, reorder, the task window's section icons). The funnel became adjustments-horizontal (the set has no filter icon). Design check: emoji 1 → 0. The saved screen list's step that clicks "●" (`_shared/qa/screens/life-kanban.json`) now finds nothing and is skipped; it wants `clickSel: "#sync-status"`. Service worker v101. Tests pass; checked locally (`wrangler pages dev` + local D1) on every saved screen plus Settings, Filters, a new task, an open task and the card menu: no empty icons, no emoji, no console errors; live-check clean. Deployed; the after-deploy check passed (24 views, 4 skipped for that step).
- 2026-11-21: **Old app copies can't save the board any more.** At 00:18 a device still on pre-v100 code (a background tab) rolled over on a stale copy and saved it, reopening Pizza money and keeping call sutton hall and Buy Pyrities open. `PUT /api/sync` now refuses a save without `x-base-version` (409, `reason: old_app`), except the `-inbox` row; old copies still pull and reload to the new app by themselves. Re-closed the three tasks through the app's own `completeTask` on the live site. Nothing else had changed status or gone missing since the evening before.
- 2026-11-20: **Sync can no longer wipe another device's work** (Tom: changes not reaching other devices; new tasks missing, two ticked tasks back). Two causes. (1) `PUT /api/sync` replaced the whole blob blindly, so a device that hadn't caught up erased newer saves from elsewhere. It now takes `x-base-version` (the `updated_at` the app last read; `none` for no row) and answers 409 `conflict` if the row has moved on; the app then pulls, merges and saves again (up to 3 tries in a row). GET returns `version`. A save without the header (an older cached app, the inbox row) still overwrites as before. (2) `rollOverPlan()` and `missOccurrence()` stamped `updatedAt = now`, so a background tab rolling over at midnight on a stale copy beat ticks made elsewhere; the two stuck tasks carried exactly a 00:00:55 stamp. They no longer stamp: every device works the rollover out itself. Tested locally: another device saves first, this one gets 409, pulls, and both tasks end up in the cloud. Tom re-ticks the two tasks; tasks added on a device whose save was overwritten come back when that device next opens. Service worker v100.
- 2026-11-20: **Review pops up on open.** With new items waiting, the Review sheet opens by itself on launch (after the first sync and inbox check) and when the app is returned to after 10+ minutes away; once per opening, never over another dialog or the password gate. Title shows the count; its empty state uses the shared icon instead of 🎉. Service worker v99.
- 2026-11-20: **Board top squeezed to one toolbar** (Tom: on desktop the top took half the screen with the least important information). The week's tally, the full-width "N to review" note, the theme filter and the Tags row were four rows; now one line on desktop (filters scroll, then Tags, "N done this week" and a small Review button with its count) and two on a phone. All shared pieces (`ui-chips scroll`, `ui-seg`, `ui-btn small`, `ui-badge`). The review note's dismiss × is gone; the button is small enough to leave. Columns start about 110px higher at 1024 wide. Service worker v98.
- 2026-11-19: **Trim archive and a size warning** (Round 5, things that only grow). The live row was 203 KB of D1's 2,000,000-byte cap (archive 112 KB, 250 tasks since June; tasks 70 KB; deletion records 15 KB), growing about 5 KB a week, so about 5 years to the 75% warning at this pace. Settings › Archive › **Trim archive** removes archived tasks finished more than 12, 6 or 3 months ago (default 12): it shows the count, offers Download backup, then asks in the card (no browser dialog) before Remove. Never automatic. It writes one mark into `deletedIds`, `{id: 'archive-trim', ts, before}`, which `compactArchive()` obeys (drops copies finished before `before` and last changed at or before `ts`), so another device can't bring them back; a newer trim replaces it, it never ages out, and a restore's copies (stamped now) survive it. Deletion records no longer pile up: archive tombstones (one per finished task) now age out after 90 days, since `archiveDone()` re-files a finished task anyway; plain deletes and archive-out marks keep two years. Past 75% a note on the Board and in Settings says how full it is, with a Trim archive button; `PUT /api/sync` answers 413 `too_big` over the cap (it was a bare 500), and the app also checks before sending, so the badge says "Too full to sync" with a toast, and changes stay on the device until trimmed. Sizes are decimal MB now, to match the cap. Proved on a copy of the live row that tasks and archive come out identical to the old code. Tests in `tests/archive.test.mjs`. Service worker v97.
- 2026-11-19: **Recovery code for the lock** (Round 3, "Never locked out"). Setting a password makes a recovery code; only its hash is kept (`settings.recovery_hash`, a column added on first use, so no migration) and the code is shown once in the shared sheet (`vendor/safety/recovery-sheet.js`). On the lock screen the code works in place of the password (`POST /api/auth` answers `recovered: true`) and the screen says so before going in. Settings shows a Recovery code row while the lock is on: New code (after a confirm; the old one stops working) or Make one for a lock set before today. A new password makes a new code; Off clears it; `PUT /api/settings { new_recovery_code: true }` is refused unless the lock is on and stays behind the middleware. The session token is still tied to the password hash, so a recovery sign-in is the same cookie as a password one. Copied from Golf Tracker. Test in `tests/lock.test.mjs`. Service worker v96.
- 2026-11-19: **Restore from a backup only adds** (Settings › Data; Round 2, the safety net). The old Import replaced the whole state and the next pull merged the cloud straight back over it (a backup's older stamps always lose), so it never actually restored. Now it uses the shared `openRestore` + `restoreMissing` (`vendor/safety/`): it pulls first, then adds every task, archived task, theme, tag and saved note in the file whose id isn't here, and leaves everything here alone. What it adds is stamped now and pushed at once, so it sticks on every device; a task or archive copy deleted for good here (a plain tombstone always wins) comes back under a new id, with `parentId` and a step's `cardId` remapped; themes, tags and saved notes stamp their `*UpdatedAt` (a restore is a real edit, made after a pull); a repeat still running here comes back a one-off and its dormant occurrences are skipped. Not an Undo step. `restorePlan` / `applyRestore` in the `restore-core` block of `app.js`; `tests/restore.test.mjs` (two-device merges). Tried locally with `wrangler pages dev` and local D1 as two devices (localhost and 127.0.0.1): deleted a task everywhere, restored it on one, reloaded the other and it was there, with a newer edit to another task kept. Archive Reopen and Delete (the other review item) was already done earlier today. Service worker v95. Not deployed. No schema change.
- 2026-11-19: Board cards sit on a `--sp-2` gap (was 6px margins; the live check's new `stacked` rule wants 8+). Every close and dismiss × is the shared `x` icon instead of a faint × character (the review and stale-list banners, the sheets' close buttons, a subtask's remove). Tag chips keep their × (the shared chip's). Live.
- 2026-11-19: **Reopen and Delete on archive rows** (Settings › Archive; Round 1, fix it after the fact). Reopen puts the task back in the column it was finished from (Live comes back as Ready, an old or missing column as Backlog); Delete asks once and removes it on every device. The archive merges as a union, so taking an entry out writes an `archive-out:<id>` mark into `deletedIds` (`{id:'archive-out:<taskId>', ts}`, never a task id, so all code versions sync it untouched) and `compactArchive(archive, deletedIds)` drops copies changed at or before it; a task finished again later files normally, and the re-archive now refreshes its old archive tombstone. Reopen stamps the task now, so it beats its archive tombstone everywhere; Delete adds a plain tombstone. A repeat: if its next occurrence is still dormant the schedule comes back onto the reopened one and the dormant one is deleted (as un-completing does), otherwise it comes back a one-off, so there's never a second live repeat. Not an Undo step (Undo would tombstone the reopened task). `reopenArchived` / `deleteArchived` in the archive-core block; `tests/archive.test.mjs` (two-device merges). Tried locally with `wrangler pages dev` and local D1, including a stale cloud copy pushed back over it. Service worker v94. Not deployed. No schema change.

- 2026-11-16: the board card's ⋯ is the new shared `.ui-btn.quiet.icon.tiny` (24px, added to `_shared/chassis/components.css` for this), so every button on the board is now a shared piece; `styles.css` keeps only the hover-to-show. Estate UI QA sweep (Tom: "go"). Deployed 16 Nov 2026, sw cache life-kanban-v88-qa3.
- 2026-11-16: light-mode accent deepened from #007aff to #0062cc (`styles.css`), so white on the primary buttons reads at 5.8:1, up from 4.0; the icon and App Hub tile keep #007aff, and dark mode keeps #0a84ff with navy ink (estate UI QA sweep; Tom: "Go with your colour picks"). Deployed 16 Nov 2026, sw cache life-kanban-v88-qa2.
- 2026-11-16: Lists on phones (under 769px): each row is a small grid, and the status badge (Backlog, Live…) sits under the title and tags instead of beside the × and ⋯ buttons. At 375px the text had 125px and 46 of 135 rows wrapped onto three or four lines; now it has 197px and none do. Select mode moves the text one column along. Checked against the live data at 375px, with and without Select (estate UI QA sweep; deployed 16 Nov 2026, sw cache life-kanban-v88-qa).
- 2026-11-16: phone sweep (375px, Light and Dark): theme and tag chips now pick black or white text by real contrast (`contrastText` in app.js; white on Garden green and House blue was 2.2:1 and 2.5:1); the pressed High priority chip keeps white text in dark mode (the navy ink was 3.6:1 on red). No AI actions page: the only AI is the free AI Updates import in Settings. Cache `life-kanban-v88`. Not deployed.
- 13 Nov 2026: copy audit applied — explanatory copy removed or cut to plain words (Tom: 'Do all'). Settings › AI is now a ✨ AI Updates button (`<magic-mark>`, so `ai/updates.js` imports `vendor/magic/magic.js`); the always-on "Syncing across devices" note is gone. `sw.js` v87. Committed and deployed 13 Nov 2026; checked live at 375px in light and dark, no console errors or sideways scroll.
- 12 Nov 2026: **Lock cookie tied to the password.** `lk_session` is now HMAC(`AUTH_SECRET`, `authenticated:` + password hash) (`functions/api/_lib.js`), so a new password signs every other device out; before, the token never changed. Turning the lock on in Settings now also signs this device in (it used to lock itself out on the next sync). Tests in `tests/lock.test.mjs`. Existing cookies stop working once this deploys, which only matters if the lock is on (it was off on 12 Nov). Deployed 12 Nov 2026, with the Sunday repeat fix.
- 12 Nov 2026: **Monthly repeats on a Sunday** stay on Sunday. `calcNextRecurring`, `matchesRecurrence` and the task window read the weekday as `dayOfWeek || 1`, so Sunday (0) became Monday; now `?? 1`. AI Updates accepts a monthly Sunday again.
- 12 Nov 2026: **AI Updates daily copy**: `ai/updates.js` takes the App Hub's `#ai-hub-key=…` set-up link on load (`captureHubKey`) and shares the AI Updates context with the App Hub (`shareContext`) once the first cloud pull has merged (`window.lifeListApp.firstSync()`), and again whenever the app comes back to the front (it skips itself with no key or unchanged data). Test in `tests/ai.test.mjs`. Vendor ai-protocol and chassis re-synced. Service worker life-kanban-v83. Deployed 12 Nov 2026 and checked live.
- 12 Nov 2026: **AI Updates** (Settings › AI Updates, `sites/ai-updates`): paste a ChatGPT block, preview, tick, Apply; "Copy for ChatGPT" gives today's date, themes with sub-themes, tag categories with tags and up to 300 open tasks. v1 actions `add_task` (incl. repeats, via `scheduleOccurrence` like the task window), `update_task`, `complete_task` (done or won't do), `move_task`, `snooze_task`. Everything applies through the app's own functions, exposed at the end of `app.js` as `window.lifeListApp`; nothing creates themes, tags, categories or saved notes, and nothing deletes. Contract, guide and logic in `ai/` (`schema.js`, `guide.md`, `logic.js`, `updates.js`); tests `node --test tests/*.test.mjs`. `deploy.sh` now copies `ai/*.js`; `vendor/magic/` and `vendor/ai-protocol/` are shared copies (`node _shared/sync.mjs`). Service worker life-kanban-v82. Not committed or deployed.
- 12 Nov 2026: moved the last stand-ins onto shared pieces (deployed 12 Nov, checked live): the ⋯ menu is one shared `.ui-menu` popover every ⋯ points at (opens under the button that opened it; right-click a card opens it from the card's ⋯); the Undo toast is a `.ui-toast` with a button (6s), sync errors use `.ui-toast.bad`; Settings › Tags chips are `span.ui-chip.small` with ×; the Notes filter's leave-out state is the shared `.out`; theme and tag-category colours are `.ui-swatches` (13 colours plus a Custom swatch over a native picker); the + is `.ui-fab`; own list min-width workaround deleted. Kept app-made on purpose: the tiny board-card ⋯ (no shared compact corner button), category-tinted tag badges on cards, and the test task-window chip sizes. There is no done/in-plan card, so nothing became `.ui-card.highlight`. Shared fix: a toast now sits above a `.ui-fab`. Checked 375px light and dark on every tab. Service worker life-kanban-v81.
- 2026-11-16: dark mode: text on the accent (primary buttons, pressed chips, ticks) is now a dark ink, as the chassis asks for a light accent; white on it was 3.6:1, now 4.8:1 (estate UI QA sweep, 16 Nov 2026; deployed the same day from a clean export of the commit). Urgent-priority ticks keep white. Light mode is unchanged and still 4.0:1 (#007aff); left for Tom
- 2026-11-12: deployed the shared components update (missing pieces + four CSS fixes); cache bumped (life-kanban-v80; checked from outside only); live checked.
- 2026-11-11: Sync blob fix (deployed 11 Nov, v79; not committed). The synced blob was 1.28 MB, the archive 2,676 copies of 240 tasks, growing ~100 KB a week toward D1's ~2 MB row limit: archiving removed a task locally with no tombstone, so the next pull put it back and the next week re-archived it. Now archiving writes an archive tombstone into `deletedIds` (`{id, ts, archived:true}`, which older cached code already obeys; new code lets a later edit beat it), `compactArchive()` keeps one entry per task (earliest week, newest copy) on load and every merge, and `autoArchive()` runs after every merge and on the minute tick, archiving whatever was completed before this week under its completion week (was: Mondays only, everything into the current week). Tombstones kept 2 years (was 60 days). Top-bar sync dot (green / amber / red; words on wider screens; tap to sync now) and a size warning over 1.5 MB; Settings › Archive shows the data size and a Compact archive button. Simulated on the downloaded live blob: 1,248 KB → 188 KB, no task or archived id lost, converges with old-code devices. Service worker v79. Code comment: the ARCHIVE block in `app.js`.
- 2026-11-11: shared `ui-badge` good/warn/bad text now mixes 30% of `--text` into the status colour (the green and amber were about 2.7:1 in Light; now 4.5:1 or better in both themes). Synced copy of `components.css`, deployed 11 Nov.
- 2026-11-11: shared `--success` and `--warning` are deeper in Light (`#15803d`, `#b45309`, 5:1 on white; the old bright ones were about 3.2:1 as words) and stay bright in Dark. Synced copy of `tokens.css`.
- 2026-11-11: Theme, sub-theme and tags became one always-open block in the task window: every row one sideways-scrolling line, sub-themes as chips, one tag per category (a tap replaces that category's other tag). Tom: tags under chevrons meant expanding five menus. Applies to the current window and all four test layouts.
- 2026-11-11: Tom said the task window "doesn't work at all" (too many big pills, scattered options). Four test layouts built behind Settings › Task window layout (per device): A property list, B composer bar, C two panes, D quick add then a full page. They only rearrange the same modal DOM (`applyTaskLayout`), so saving and sync are unchanged. When Tom picks one, build it in properly, move its styles into the shared components and delete the other three plus the setting.
- 2026-11-18: Row actions grouped: a divider sets Edit apart at the end from the five that move the task (Tom: "they need to be split somehow"; the "Move to" label was tried and dropped). Shared tiles gained `<hr>` dividers and `.end`. Service worker v92.
- 2026-11-18: Today's row actions redesigned: one tinted panel joined to the row, six icon tiles on one line (new shared `ui-actions tiles`, shared icons now in this app). The "since Thu" chip is gone from rows (Tom: "repetitive and distracting"); the opened panel says since when. Service worker v91.
- 2026-11-18: Every task is Work or Home (`task.area`), with the theme optional underneath (Tom: not adding themes to quick home tasks because he can't think of one). A Work | Home switch under the title; it narrows the theme row, picking a theme sets it, flipping it drops the other side's themes. Today's and the board's Work/Home filters use it. Old tasks keep sorting by their themes. AI Updates `add_task`/`update_task` take `area`. Service worker v89.
- 2026-11-11: "Do on" now puts a task on Today for that day (Live with that plan day) instead of dropping it into the backlog when the day comes (Tom: set to do on tomorrow, wasn't on tomorrow's list). Date boxes fit the phone width (iOS drew them too wide). Service worker v77.
- 2026-11-11: On a phone the task window is now a full-screen page, not a card sliding up (Tom: "Does it need to be a modal on mobile or can it be a page?"); new shared `ui-sheet page` variant. Chips run full width, Tags start folded, a gap under each heading. Service worker v76.
- 2026-11-11: Sections layout (E) now has A's icon headings and folds (Tom: "with the icons and collapsable sections from option A"): each heading shows a summary; a new task opens Theme, Sub-theme and Tags, an edit opens whatever has a value. Service worker v75.
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

## Break glass

If both the password and the recovery code are lost: Cloudflare dashboard › Storage & databases › D1 ›
**life-kanban-db** › Console, run

```sql
UPDATE settings SET password_enabled = 0, password_hash = NULL, recovery_hash = NULL WHERE id = 1;
```

(If it says there's no `recovery_hash` column, no code was ever made: drop that part.) The app is then
open; turn the lock back on in Settings. Deleted tasks can't usefully be brought back from the console:
everything lives in one JSON document per sync code in `kanban_sync`, with deletes as tombstones inside
it. Use the app (Archive, or Settings › Data › Restore from a backup) instead.

## Status

- **Works:** Today, Board, Lists, Notes and saved notes, recurring tasks (incl. onto Today),
  sub-tasks and split-out cards, tags, links, undo, JSON backup and restore-only-adds, optional password lock,
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
- **Sync blob fix (11 Nov 2026, uncommitted, not deployed):** see Decisions. Needs deploying before late December, when the old growth would have hit the D1 row limit. After deploy, open the app on each device once so all three run the new code.
- Waiting on Tom to live in Today for a while and say what's missing.
- **AI Updates (12 Nov 2026, uncommitted, not deployed):** built and checked in a local browser (phone width, light and dark) against a test board, not against real data. The ChatGPT contract is `ai/` (schema, guide, logic); run `node --test tests/*.test.mjs` from this folder.

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
