/* =============================================
   Life Kanban — App v2
   ============================================= */
(function () {
'use strict';

// ============ CONSTANTS ============

const STORAGE_KEY = 'life-kanban-v2';
// Sync now goes through Cloudflare Pages Functions (browser -> /api/sync/* -> D1),
// so no database key is ever shipped to the browser. SYNC_CODE namespaces this
// board's blob (and its "-inbox" sibling) in the kanban_sync table.
const SYNC_CODE = 'mpy31l1nrkp69mpy31l1nihblx';

const KANBAN_COLS = [
    { id: 'backlog-day',     name: 'Day',         backlog: true },
    { id: 'backlog-evening', name: 'Evening',     backlog: true },
    // Live replaced Next + In Progress (Nov 2026). Everything in it feeds the
    // Today view: planned onto a day, or sitting in Ready until it is.
    { id: 'live',            name: 'Live' },
    { id: 'waiting',         name: 'Waiting' },
    { id: 'blocked',         name: 'Blocked' },
    { id: 'ongoing',         name: 'Ongoing' },
    // Completing a task still parks it here, but the column is never drawn:
    // it was only ever in the way. Tasks leave via "Mark complete" and the
    // list checkbox, and the week's count sits above the board instead.
    { id: 'complete',        name: 'Complete',    offBoard: true },
];

const EVENING_HOUR = 17; // 5pm

function isEvening() { return new Date().getHours() >= EVENING_HOUR; }

// Which backlog a task lands in when it goes on the board: work in the Day
// column, everything else in the Evening one. "Work" means any theme with a
// work focus (set per theme in Admin), so a second work-ish theme behaves the
// same as the Work theme itself without needing to be named Work.
function defaultBacklogCol(themeIds) {
    const isWork = (themeIds || []).some(id => {
        const t = getTheme(id);
        return t && themeFocus(t) === 'work';
    });
    return isWork ? 'backlog-day' : 'backlog-evening';
}

// Board column order. The two backlog columns swap so the time-relevant one
// always sits immediately left of "Live": Day during the day, Evening after 5pm.
function boardColumns() {
    const day = KANBAN_COLS.find(c => c.id === 'backlog-day');
    const evening = KANBAN_COLS.find(c => c.id === 'backlog-evening');
    const rest = KANBAN_COLS.filter(c => !c.backlog && !c.offBoard);
    const backlogs = isEvening() ? [day, evening] : [evening, day];
    return [...backlogs, ...rest];
}

const SIZE_POINTS = { xs:1, s:2, m:3, l:5, xl:8, xxl:13 };
const SIZE_ORDER   = { xs:0, s:1, m:2, l:3, xl:4, xxl:5 };
// Five levels, with urgent/minimal added either side of the original three so
// existing tasks keep the priority they already had. '' (none) sorts last.
const PRIORITY_ORDER = { urgent:0, high:1, medium:2, low:3, minimal:4, '':5 };
const PRIORITY_LEVELS = [
    { value:'',        label:'None' },
    { value:'minimal', label:'Minimal' },
    { value:'low',     label:'Low' },
    { value:'medium',  label:'Medium' },
    { value:'high',    label:'High' },
    { value:'urgent',  label:'Urgent' },
];

// Tags cut across themes: the same tag can sit on a Work task and a Life one.
// They're grouped into categories (People, When, a holiday, …) so the filter
// rows stay readable, and every category is editable in Admin > Tags.
// The People category is seeded from the old People theme on first run —
// see migratePeopleThemeToTags.
const DEFAULT_TAG_CATEGORIES = [
    { id:'people', name:'People', color:'#5856D6', tags:[] },
    { id:'when',   name:'When',   color:'#30B0C7', tags:[
        { id:'when-day', name:'Day' },
        { id:'when-evening', name:'Evening' },
        { id:'when-weekday', name:'Weekday' },
        { id:'when-weekend', name:'Weekend' },
    ] },
];

const DEFAULT_THEMES = [
    { id:'work',   name:'Work',   color:'#007AFF', subThemes:['Meetings','Proposals','Reports','Strategy','Calls'] },
    { id:'admin',  name:'Admin',  color:'#5856D6', subThemes:['Email','Finance','HR','Planning','Accounts'] },
    { id:'garden', name:'Garden', color:'#34C759', subThemes:['Lawn','Planting','Maintenance','Tools'] },
    { id:'diy',    name:'DIY',    color:'#FF9500', subThemes:['Painting','Building','Repairs','Electrics','Plumbing'] },
    { id:'harry',  name:'Harry',  color:'#FF2D55', subThemes:['School','Activities','Health','Shopping'] },
    { id:'house',  name:'House',  color:'#32ADE6', subThemes:['Cleaning','Organising','Maintenance','Decorating'] },
    { id:'shop',   name:'Shop',   color:'#FF9F0A', subThemes:['Groceries','Clothing','Home','Tech'] },
];

// ============ STATE ============

let state = loadState();
// Today is the front door: the stripped-back list of what's on today.
let currentView = 'today';
let currentThemeTab = 'all';
let currentSort = 'priority';
let currentFilters = { priority:'', size:'', status:'active', search:'', age:'' };
// Tag filters are shared by Lists and Board and deliberately NOT persisted —
// a filter that survives a reload is a filter you forget you switched on.
let activeTagFilter = [];
let tagFilterOpen = false;
let staleBannerDismissed = false;
let reviewBannerDismissed = false;
let reopenReviewAfterTask = false;
let currentAdminTab = 'themes';
let bulkMode = false;
let selectedIds = new Set();
let editingTaskId = null;
let editingThemeId = null;
let ctxTaskId = null;
let draggedId = null;
let snoozedExpanded = new Set();
let snoozeTargetIds = null;
let snoozeFromBulk = false;
// Today view
let todayDay = todayStr();          // the day Today is showing (arrows step through days)
let todayAnchor = todayDay;         // the real date when todayDay was last in step with it
let todayOrderEdit = false;
let todayDragId = null;             // desktop drag: the task being dragged
let todayOpenId = null;             // the row with its action strip open
let todayDoneOpen = false;
let todayBacklogOpen = false;
let modalPlanDay = null;            // a task added from Today lands on this day

// Modal field state
let modalThemeIds = [];      // a task can carry several themes
let modalSubTheme = '';
let modalTagIds = [];
let modalSubtasks = [];
// Which folded-away sections of the task modal are showing (renderTaskSections)
let modalOpenSections = new Set();
let modalTagCatsOpen = new Set();
let themeModalFromTask = false;  // theme modal opened over the task modal
let modalPriority = '';
let modalSize = 'xs';
// The column "+ Add task" was clicked in, so a new task lands there rather
// than in whichever backlog its theme would have chosen.
let modalKanbanCol = null;
let quickAddFlashTimer = null;
let modalRecurType = 'daily';
let modalRecurDow = new Set();
let modalMonthlyMode = 'date';
let modalThemeFocus = 'home';

function defaultState() {
    return {
        tasks: [],
        themes: DEFAULT_THEMES.map(t => ({...t, subThemes:[...t.subThemes]})),
        archive: [],
        completionLog: {},
        settings: { theme: 'light' },
        deletedIds: [],
        themesUpdatedAt: 0,
        tagCategories: DEFAULT_TAG_CATEGORIES.map(c => ({...c, tags: c.tags.map(t => ({...t}))})),
        tagsUpdatedAt: 0,
    };
}

// Legacy single "backlog" column was split into Day/Evening; map old tasks
// (and any arriving via sync from an un-updated device) onto the Day backlog.
// Also treat any task that predates the review feature as already reviewed so
// the review queue only surfaces genuinely new captures.
function migrateColumns(tasks) {
    (tasks || []).forEach(t => {
        if (t.kanbanColumn === 'backlog') t.kanbanColumn = 'backlog-day';
        // Next and In Progress were folded into Live. An older device can
        // still write the old ids, so this runs after every sync merge too.
        if (t.kanbanColumn === 'next' || t.kanbanColumn === 'in-progress') t.kanbanColumn = 'live';
        // A day only means something while the task is Live (or done, so the
        // day can show what got finished). Anywhere else it's stale.
        if (t.planDay && t.kanbanColumn !== 'live' && t.status !== 'complete') { t.planDay = null; t.carriedFrom = null; }
        if (t.reviewed === undefined) t.reviewed = true;
        // A completed task must never recur again — the live schedule lives on
        // its active successor. Stripping recurring from completed records
        // stops any device (even one on old cached code) from re-spawning them,
        // which is what kept duplicating recurring tasks.
        if (t.status === 'complete' && t.recurring) { t.recurring = null; t.recurringSpawned = true; }
        // Give live recurring tasks a stable chain id so occurrence ids are
        // deterministic across devices (prevents duplicate spawns)
        if (t.recurring && !t.recurRoot) t.recurRoot = t.id;
        // Keep themeIds and the legacy themeId mirror in step. A record last
        // written by an older device carries only themeId, so that wins —
        // otherwise a stale themeIds array would mask the newer choice.
        if (!Array.isArray(t.themeIds) || !t.themeIds.length) {
            t.themeIds = t.themeId ? [t.themeId] : [];
        } else if (t.themeId && !t.themeIds.includes(t.themeId)) {
            t.themeIds = [t.themeId];
        } else {
            t.themeIds = [...new Set(t.themeIds.filter(Boolean))];
            t.themeId = t.themeIds[0] || '';
        }
        if (!Array.isArray(t.tags)) t.tags = [];
        if (!Array.isArray(t.subtasks)) t.subtasks = [];
    });
}

// Classify themes into work/home focus; anything unclassified defaults to
// home, except a theme literally named "Work".
function migrateThemes(themes) {
    (themes || []).forEach(t => {
        if (t.focus === undefined) t.focus = (t.name === 'Work') ? 'work' : 'home';
    });
}

// The People theme becomes the People tag category: its sub-themes are the
// names, so they carry over as tags and every task filed under it keeps its
// person. Runs once (guarded by peopleTagsMigrated) and stashes the original
// theme in removedPeopleTheme so nothing is actually thrown away.
function migratePeopleThemeToTags(p) {
    if (p.peopleTagsMigrated) return false;
    // peopleTagsMigrated is per-device, but this edits SHARED data. A device
    // opening late (or after a storage wipe) would otherwise re-run the whole
    // migration against freshly-seeded defaults. If any task already carries a
    // tag, the migration has happened elsewhere and this device just needs the
    // real categories from the next sync pull.
    if ((p.tasks || []).some(t => Array.isArray(t.tags) && t.tags.length)) {
        p.peopleTagsMigrated = true;
        return true;
    }
    const theme = (p.themes || []).find(t => (t.name || '').trim().toLowerCase() === 'people');
    p.peopleTagsMigrated = true;
    if (!theme) return true;

    const cat = (p.tagCategories || []).find(c => c.id === 'people');
    if (!cat) return true;
    // Names already in the category win, so re-running can't duplicate them
    const byName = new Map(cat.tags.map(t => [t.name.toLowerCase(), t]));
    (theme.subThemes || []).forEach(name => {
        const key = String(name).trim().toLowerCase();
        if (!key || byName.has(key)) return;
        const tag = { id: newTagId('people'), name: String(name).trim() };
        cat.tags.push(tag);
        byName.set(key, tag);
    });

    // Move every task off the theme and onto the matching tag
    (p.tasks || []).forEach(t => {
        const ids = Array.isArray(t.themeIds) && t.themeIds.length
            ? t.themeIds : (t.themeId ? [t.themeId] : []);
        if (!ids.includes(theme.id)) return;
        const tag = byName.get(String(t.subTheme || '').trim().toLowerCase());
        if (tag) {
            if (!Array.isArray(t.tags)) t.tags = [];
            if (!t.tags.includes(tag.id)) t.tags.push(tag.id);
            t.subTheme = '';
        }
        t.themeIds = ids.filter(id => id !== theme.id);
        t.themeId = t.themeIds[0] || '';
        t.updatedAt = Date.now();
    });

    p.removedPeopleTheme = theme;   // keep a copy rather than destroying it
    p.themes = p.themes.filter(t => t.id !== theme.id);
    // Deliberately NOT stamped with Date.now(). Stamping made a just-seeded
    // set of defaults look like the newest edit in the world, so a late
    // migration beat — and wholesale replaced — every real category the user
    // had built. Leaving the timestamps alone lets the first pull win instead.
    return true;
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const p = JSON.parse(raw);
            if (!p.themes || !p.themes.length) p.themes = DEFAULT_THEMES.map(t=>({...t,subThemes:[...t.subThemes]}));
            migrateThemes(p.themes);
            if (!p.archive) p.archive = [];
            if (!p.completionLog) p.completionLog = {};
            if (!p.settings) p.settings = { theme:'light' };
            if (!p.settings.mutedThemes) p.settings.mutedThemes = [];
            if (!p.settings.reminderTime) p.settings.reminderTime = '09:00';
            if (!p.deletedIds) p.deletedIds = [];
            if (!p.themesUpdatedAt) p.themesUpdatedAt = 0;
            if (!Array.isArray(p.tagCategories)) {
                p.tagCategories = DEFAULT_TAG_CATEGORIES.map(c => ({...c, tags: c.tags.map(t => ({...t}))}));
            }
            if (!p.tagsUpdatedAt) p.tagsUpdatedAt = 0;
            migrateColumns(p.tasks);
            // Persist straight away: saveState() can't run yet (it writes the
            // `state` this function is still returning), and an unsaved
            // migration would re-run on every load. The bumped tagsUpdatedAt
            // makes the next sync pull push it out to the other devices.
            if (migratePeopleThemeToTags(p)) {
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch(e) {}
            }
            return p;
        }
    } catch(e) {}
    return defaultState();
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ============ HELPERS ============

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function toDateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function todayStr() { return toDateStr(new Date()); }

function formatDateShort(s) {
    if (!s) return '';
    const d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}
function formatDateFull(s) {
    if (!s) return '';
    const d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

function addDays(s, n) {
    const d = new Date(s + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return toDateStr(d);
}

function getWeekStart(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return toDateStr(d);
}

function getWeekKey(dateStr) { return getWeekStart(dateStr || todayStr()); }

function getTheme(id) { return state.themes.find(t => t.id === id) || null; }

// A task can carry more than one theme (e.g. Work + Jim). `themeIds` is the
// source of truth; `themeId` mirrors themeIds[0] so a device still running
// older cached code — and every record already in the cloud — keeps working.
function taskThemeIds(t) {
    if (t && Array.isArray(t.themeIds) && t.themeIds.length) return t.themeIds;
    return (t && t.themeId) ? [t.themeId] : [];
}

function taskThemes(t) { return taskThemeIds(t).map(getTheme).filter(Boolean); }

// The theme a task is grouped under in Lists: its first still-existing one, so
// deleting a theme doesn't drop a two-theme task into "No Theme".
function primaryThemeId(t) {
    const first = taskThemes(t)[0];
    return first ? first.id : '';
}

// Normalise a theme selection onto a task payload: deduped, with the mirror.
function withThemeIds(data, ids) {
    const clean = [...new Set((ids || []).filter(Boolean))];
    return { ...data, themeIds: clean, themeId: clean[0] || '' };
}

// A tag chip, tinted with its category's colour so People and When read as
// different families at a glance.
function tagChipEl(tag) {
    const el = document.createElement('span');
    el.className = 'chip chip-tag';
    el.style.borderColor = tag.category.color;
    el.style.color = tag.category.color;
    el.textContent = tag.name;
    el.title = tag.category.name + ' · ' + tag.name;
    return el;
}

function progressChipEl(task) {
    const p = subtaskProgress(task);
    if (!p) return null;
    const el = document.createElement('span');
    el.className = 'chip chip-progress' + (p.done === p.total ? ' chip-progress-done' : '');
    el.innerHTML = `<span class="chip-progress-bar"><span style="width:${p.pct}%"></span></span>${p.done}/${p.total}`;
    el.title = p.pct + '% of sub-tasks done';
    return el;
}

// ---- Sub-tasks ----

// A long-running task's checklist: the card shows how far through it is.
function subtaskProgress(t) {
    const list = Array.isArray(t && t.subtasks) ? t.subtasks : [];
    if (!list.length) return null;
    const done = list.filter(st => st.done).length;
    return { done, total: list.length, pct: Math.round((done / list.length) * 100) };
}

// ---- Tags ----

function allTagCategories() { return state.tagCategories || []; }

function getTagCategory(id) { return allTagCategories().find(c => c.id === id) || null; }

function getTag(id) {
    for (const c of allTagCategories()) {
        const t = (c.tags || []).find(x => x.id === id);
        if (t) return { ...t, category: c };
    }
    return null;
}

function taskTagIds(t) { return Array.isArray(t && t.tags) ? t.tags : []; }

// Tag ids must survive being minted in a tight loop (a whole category pasted
// in at once), so keep genId()'s random suffix — truncating it to the
// timestamp alone hands every tag in the same millisecond an identical id.
function newTagId(catId) { return catId + '-' + genId(); }

// A tag id is "<categoryId>-<genId>", and genId never contains a dash, so the
// category it belonged to can always be read back off the id.
function categoryIdFromTagId(tagId) {
    const parts = String(tagId).split('-');
    return parts.length > 1 ? parts.slice(0, -1).join('-') : '';
}

// Category ids are "<slug>-<4 chars>"; turn one back into something readable.
// Theme and category ids are both "<slug>-<4 chars>", so the slug — and with
// it the name it was built from — survives in the id.
function idSlug(id) {
    const parts = String(id).split('-');
    if (parts.length > 1 && parts[parts.length - 1].length === 4) parts.pop();
    return parts.join('-');
}

function titleFromSlug(slug) {
    const words = slug.replace(/-/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Recovered';
}

function categoryNameFromId(catId) { return titleFromSlug(idSlug(catId)); }

// Self-heal: a tag id still sitting on a task but missing from every category
// means the category was lost rather than deleted — deleting one strips the id
// off the tasks, so an orphan can only come from a wholesale sync overwrite.
// Rebuild the category from the id and hand the tag back, so the loss shows up
// on screen instead of silently taking every chip with it. Names can't be
// recovered, so they come back as placeholders for renaming (which preserves
// the id, and so the tasks keep the tag).
// The same repair for themes, with one important difference: a stale theme id
// usually has a living namesake, because the theme was renamed or rebuilt and
// took a new id with it. Remapping the task onto that theme beats creating a
// duplicate called the same thing. Only when nothing matches is the theme
// rebuilt — and then only if a task that's still live needs it, since a
// dangling id on finished work just wants pointing at the right theme.
function recoverOrphanThemes() {
    const known = new Set(state.themes.map(t => t.id));
    const bySlug = new Map();
    state.themes.forEach(t => {
        const slug = idSlug(t.id);
        if (slug && !bySlug.has(slug)) bySlug.set(slug, t);
        const name = String(t.name || '').trim().toLowerCase();
        if (name && !bySlug.has(name)) bySlug.set(name, t);
    });

    const orphans = new Map();   // id -> { live }
    state.tasks.forEach(t => {
        const live = t.status !== 'complete' && t.status !== 'wont-do';
        taskThemeIds(t).forEach(id => {
            if (known.has(id)) return;
            const entry = orphans.get(id) || { live: false };
            if (live) entry.live = true;
            orphans.set(id, entry);
        });
    });
    if (!orphans.size) return 0;

    const remap = new Map();
    let created = 0;
    orphans.forEach((info, id) => {
        const slug = idSlug(id);
        const hit = bySlug.get(slug);
        if (hit) { remap.set(id, hit.id); return; }
        if (!info.live) return;
        const theme = { id, name: titleFromSlug(slug), color: '#8e8e93',
                        subThemes: [], focus: 'home', recovered: true };
        state.themes.push(theme);
        known.add(id);
        bySlug.set(slug, theme);
        created++;
    });

    let remapped = 0;
    if (remap.size) {
        state.tasks.forEach(t => {
            const ids = taskThemeIds(t);
            if (!ids.some(x => remap.has(x))) return;
            const next = [...new Set(ids.map(x => remap.get(x) || x))];
            t.themeIds = next;
            t.themeId = next[0] || '';
            t.updatedAt = Date.now();
            remapped++;
        });
    }
    // Only a rebuilt theme is a change to the shared themes list; a remap just
    // rewrites tasks, which carry their own updatedAt.
    if (created) state.themesUpdatedAt = Date.now();
    if (created || remapped) {
        console.info('[life-kanban] themes: rebuilt ' + created + ', remapped ' + remapped + ' task(s)');
    }
    return created + remapped;
}

// A silent repair is nearly as bad as a silent loss — say it happened.
function markTagRecovery() {
    state.settings.tagRecoveryNotice = true;
}

function recoveredTagCount() {
    return allTagCategories().reduce((sum, c) => sum + (c.tags || []).filter(t => t.recovered).length, 0);
}

function recoveredThemeCount() {
    return state.themes.filter(t => t.recovered).length;
}

function renderRecoveryNotice(container, kind) {
    if (!state.settings.tagRecoveryNotice) return;
    const n = kind === 'tags' ? recoveredTagCount() : recoveredThemeCount();
    if (!n) return;
    const note = document.createElement('div');
    note.className = 'tag-recovery-note';
    note.innerHTML = kind === 'tags'
        ? `<strong>${n} tag${n === 1 ? '' : 's'} recovered.</strong> They were still on your cards but their
           category had been overwritten by a sync, so they'd stopped showing. The names couldn't be recovered \u2014
           rename each <em>Recovered&nbsp;N</em> below and the tasks keep it. Delete one instead and it comes off
           those tasks properly.`
        : `<strong>${n} theme${n === 1 ? '' : 's'} rebuilt.</strong> ${n === 1 ? 'A task was' : 'Tasks were'} still
           filed under ${n === 1 ? 'a theme' : 'themes'} that had gone missing, so ${n === 1 ? 'it has' : 'they have'}
           been put back from the name in the id. Rename or recolour as you like \u2014 the tasks stay attached.`;
    const dismiss = document.createElement('button');
    dismiss.className = 'btn-ghost';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => {
        // One dismissal clears the lot, so it can't reappear on the other tab
        state.settings.tagRecoveryNotice = false;
        allTagCategories().forEach(c => { delete c.recovered; (c.tags || []).forEach(t => delete t.recovered); });
        state.themes.forEach(t => { delete t.recovered; });
        saveState();
        renderAdmin();
    });
    note.appendChild(dismiss);
    container.appendChild(note);
}

function recoverOrphanTags() {
    const known = new Set();
    allTagCategories().forEach(c => (c.tags || []).forEach(t => known.add(t.id)));

    const orphans = new Map();   // tagId -> how many live tasks use it
    state.tasks.forEach(t => {
        if (t.status === 'complete' || t.status === 'wont-do') return;
        taskTagIds(t).forEach(id => {
            if (known.has(id)) return;
            orphans.set(id, (orphans.get(id) || 0) + 1);
        });
    });
    if (!orphans.size) return 0;

    // Busiest first, so the placeholder numbering tracks how much a tag is used
    const ordered = [...orphans.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    let added = 0;
    ordered.forEach(id => {
        const catId = categoryIdFromTagId(id);
        if (!catId) return;
        // Match an existing category by id first, then by the name the id was
        // built from, so a category that was rebuilt under a new id doesn't end
        // up with a same-named twin.
        let cat = getTagCategory(catId);
        if (!cat) {
            const want = categoryNameFromId(catId).toLowerCase();
            cat = allTagCategories().find(c => String(c.name || '').trim().toLowerCase() === want) || null;
        }
        if (!cat) {
            cat = { id: catId, name: categoryNameFromId(catId), color: '#8e8e93', tags: [], recovered: true };
            state.tagCategories.push(cat);
        }
        if (!cat.tags) cat.tags = [];
        cat.tags.push({ id, name: 'Recovered ' + (cat.tags.filter(t => /^Recovered /.test(t.name)).length + 1), recovered: true });
        added++;
    });
    if (added) {
        state.tagsUpdatedAt = Date.now();
        console.info('[life-kanban] recovered ' + added + ' orphaned tag(s)');
    }
    return added;
}

function taskTags(t) { return taskTagIds(t).map(getTag).filter(Boolean); }

// Facet semantics: OR within a category, AND across them. Picking Barney and
// Harry shows either of them; adding Weekend narrows that to the weekend ones.
function taskMatchesTagFilter(t, tagIds) {
    if (!tagIds || !tagIds.length) return true;
    const own = new Set(taskTagIds(t));
    const byCat = new Map();
    tagIds.forEach(id => {
        const tag = getTag(id);
        const key = tag ? tag.category.id : '__gone__';
        if (!byCat.has(key)) byCat.set(key, []);
        byCat.get(key).push(id);
    });
    for (const ids of byCat.values()) {
        if (!ids.some(id => own.has(id))) return false;
    }
    return true;
}

// A task survives a theme filter as long as ONE of its themes is visible, so
// tagging something Work + Jim never makes it vanish from either view.
function themesPass(t, ...excluded) {
    const ids = taskThemeIds(t);
    if (!ids.length) return true;
    return ids.some(id => !excluded.some(set => set.has(id)));
}

function prioRank(t) {
    const v = PRIORITY_ORDER[t.priority];
    return v === undefined ? PRIORITY_ORDER[''] : v;
}

// Spotlighted tasks outrank everything, ahead of even High priority
function spotRank(t) { return t.spotlight ? 0 : 1; }

// Active list captures not yet triaged onto the board (or explicitly kept).
// Anything parked in Notes is deliberately untriaged, so it stays out.
function needsReview(t) {
    return t.status === 'active' && !t.kanbanColumn && !t.reviewed && !isSnoozed(t) && !t.inNotes;
}

// Notes is a parking list for things that aren't a priority at all but
// shouldn't be snoozed or hidden either — they just shouldn't clutter Lists.
function inNotes(t) { return !!t.inNotes; }

function isSnoozed(t) { return !!(t.snoozedUntil && t.snoozedUntil > todayStr()); }

const STALE_DAYS = 30;

function daysSince(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr + 'T00:00:00');
    return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Whole days from today until a date (negative once it's in the past)
function daysUntil(dateStr) {
    if (!dateStr) return 0;
    const from = new Date(todayStr() + 'T00:00:00');
    const to = new Date(dateStr + 'T00:00:00');
    return Math.round((to.getTime() - from.getTime()) / 86400000);
}

// Opt-in countdown chip for a task's "do by" date. Returns null when the task
// hasn't asked for one (or has already been finished).
function countdownChip(task) {
    if (!task.countdown || !task.dueDate || task.status !== 'active') return null;
    const n = daysUntil(task.dueDate);
    const chip = document.createElement('span');
    chip.className = 'chip chip-countdown' + (n < 0 ? ' past' : n <= 2 ? ' soon' : '');
    if (n < 0)       chip.textContent = Math.abs(n) + 'd overdue';
    else if (n === 0) chip.textContent = 'Due today';
    else if (n === 1) chip.textContent = 'Tomorrow';
    else if (n < 14)  chip.textContent = n + ' days left';
    else if (n < 60)  chip.textContent = Math.round(n / 7) + ' weeks left';
    else              chip.textContent = Math.round(n / 30) + ' months left';
    chip.title = 'Do by ' + formatDateFull(task.dueDate);
    return chip;
}

function isWeekend() {
    const day = new Date().getDay();
    return day === 0 || day === 6;
}

// Active list items (not on board, not snoozed, not done) that have been
// sitting around longer than the stale threshold — candidates for snoozing.
function isStale(t) {
    if (t.status !== 'active' || t.kanbanColumn || isSnoozed(t) || t.inNotes) return false;
    return daysSince(t.createdDate) >= STALE_DAYS;
}

// Themes hidden from the Board because it's the weekend and they're marked
// hide-on-weekend.
function weekendHiddenThemeIds() {
    if (!isWeekend()) return new Set();
    return new Set(state.themes.filter(t => t.hideWeekend).map(t => t.id));
}

function themeColor(id) { const t = getTheme(id); return t ? t.color : '#8e8e93'; }

// Pick black or white text for legibility on a given background colour
function contrastText(hex) {
    if (!hex || hex[0] !== '#' || hex.length < 7) return '#fff';
    const r = parseInt(hex.substr(1,2),16), g = parseInt(hex.substr(3,2),16), b = parseInt(hex.substr(5,2),16);
    // Perceived luminance (0–1); light backgrounds get dark text
    const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    return lum > 0.6 ? '#1d1d1f' : '#fff';
}

function calcNextRecurring(recurring, fromDate) {
    const d = new Date(fromDate + 'T00:00:00');
    if (recurring.type === 'daily') {
        d.setDate(d.getDate() + (recurring.interval || 1));
    } else if (recurring.type === 'weekly') {
        const target = recurring.dayOfWeek !== undefined ? recurring.dayOfWeek : d.getDay();
        const interval = recurring.interval || 1;
        let diff = target - d.getDay();
        if (diff <= 0) diff += 7 * interval;
        d.setDate(d.getDate() + diff);
    } else if (recurring.type === 'monthly') {
        if (recurring.monthlyMode === 'date') {
            // Anchor to the 1st first, so adding months can't skip one via a
            // short-month overflow (31 Jan + 3 months would land in May)
            d.setDate(1);
            d.setMonth(d.getMonth() + (recurring.interval || 1));
            const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
            d.setDate(Math.min(recurring.dayOfMonth || 1, lastDay));
        } else {
            d.setDate(1);
            d.setMonth(d.getMonth() + (recurring.interval || 1));
            const targetDow = recurring.dayOfWeek || 1;
            const weekNum = recurring.weekOfMonth || 1;
            let count = 0;
            while (count < weekNum) {
                if (d.getDay() === targetDow) count++;
                if (count < weekNum) d.setDate(d.getDate() + 1);
            }
        }
    }
    return toDateStr(d);
}

// Does a given date land on a recurrence's pattern? (weekly/monthly only)
function matchesRecurrence(recurring, dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    if (recurring.type === 'weekly') {
        return d.getDay() === (recurring.dayOfWeek !== undefined ? recurring.dayOfWeek : 1);
    }
    if (recurring.type === 'monthly') {
        if (recurring.monthlyMode === 'date') return d.getDate() === (recurring.dayOfMonth || 1);
        if (d.getDay() !== (recurring.dayOfWeek || 1)) return false;
        const occ = Math.floor((d.getDate() - 1) / 7) + 1;
        return occ === (recurring.weekOfMonth || 1);
    }
    return false;
}

// First occurrence on or after a date — used to schedule a brand-new
// recurring task (so "monthly on the 7th" first lands on the coming 7th).
function nextOccurrenceOnOrAfter(recurring, fromDate) {
    if (recurring.type === 'daily') return fromDate;
    let d = fromDate;
    for (let i = 0; i < 400; i++) {
        if (matchesRecurrence(recurring, d)) return d;
        d = addDays(d, 1);
    }
    return calcNextRecurring(recurring, fromDate);
}

// Scheduled = a future recurrence occurrence, dormant until its date, then
// activated straight onto the board. Hidden from lists/board/counts meanwhile.
function isScheduled(t) { return t.status === 'scheduled'; }

// ============ RENDERING ============

// Nothing to capture into on the Admin screens
function syncQuickAddVisibility() {
    document.getElementById('quick-add').style.display = currentView === 'admin' ? 'none' : '';
    // On Today it lines up with the centred list beneath it
    document.getElementById('quick-add').classList.toggle('quick-add-narrow', currentView === 'today');
    const target = quickAddPlanTarget();
    document.getElementById('quick-add-input').placeholder = target === undefined
        ? 'Quick add \u2014 lands in Review\u2026'
        : 'Add to ' + (target === todayStr() ? 'today' : longDay(target)) + '\u2026';
}

// On Today, quick add plans straight onto today. undefined = not on Today,
// so it goes to Review as usual.
function quickAddPlanTarget() {
    if (currentView !== 'today') return undefined;
    return todayDay < todayStr() ? todayStr() : todayDay;   // nothing gets added to the past
}

function render() {
    if (currentView === 'lists') renderLists();
    else if (currentView === 'today') renderToday();
    else if (currentView === 'board') renderBoard();
    else if (currentView === 'notes') renderNotes();
    else if (currentView === 'admin') renderAdmin();
    if (document.getElementById('review-modal').style.display === 'flex') {
        if (reviewQueue().length) renderReviewList();
        else closeReviewModal();
    }
}

// ---- LISTS ----

function hiddenThemeIds() {
    if (state.settings.showHidden) return new Set();
    return new Set(state.themes.filter(t => t.hidden).map(t => t.id));
}

// Per-device "muted" themes — quick-toggled off on the Board
function mutedThemeIds() { return new Set(state.settings.mutedThemes || []); }

function toggleThemeMute(id) {
    const list = state.settings.mutedThemes || (state.settings.mutedThemes = []);
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    saveState();
    renderBoard();
}

function renderLists() {
    const cur = getTheme(currentThemeTab);
    if (currentThemeTab !== 'all' && (!cur || (cur.hidden && !state.settings.showHidden))) currentThemeTab = 'all';
    renderFilterStatus();
    updateFiltersButton();
    renderStaleBanner();
    renderThemeTabs();
    renderTagFilter('lists-tag-filter');
    renderListContent();
}

function filtersActive() {
    return !!(currentFilters.priority || currentFilters.size || currentFilters.age || currentFilters.search
        || (currentFilters.status && currentFilters.status !== 'active'));
}

function clearListFilters() {
    currentFilters.priority = ''; currentFilters.size = ''; currentFilters.age = '';
    currentFilters.search = ''; currentFilters.status = 'active';
    document.getElementById('list-filter-priority').value = '';
    document.getElementById('list-filter-size').value = '';
    document.getElementById('list-filter-age').value = '';
    document.getElementById('list-filter-status').value = 'active';
    document.getElementById('list-search').value = '';
    staleBannerDismissed = false;
    renderLists();
}

function renderFilterStatus() {
    const bar = document.getElementById('filter-status');
    if (!filtersActive()) { bar.style.display = 'none'; return; }
    const parts = [];
    if (currentFilters.search) parts.push('“' + currentFilters.search + '”');
    if (currentFilters.priority) parts.push(currentFilters.priority[0].toUpperCase() + currentFilters.priority.slice(1) + ' priority');
    if (currentFilters.size) parts.push('Size ' + currentFilters.size.toUpperCase());
    if (currentFilters.status && currentFilters.status !== 'active') parts.push(currentFilters.status === 'complete' ? 'Completed' : 'Incl. done');
    if (currentFilters.age) {
        const m = { '7':'In list 1+ week', '14':'In list 2+ weeks', '30':'In list 1+ month', '90':'In list 3+ months' };
        parts.push(m[currentFilters.age] || ('In list ' + currentFilters.age + '+ days'));
    }
    bar.style.display = 'flex';
    bar.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'filter-status-label';
    label.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> ' + parts.join(' · ');
    bar.appendChild(label);
    const clear = document.createElement('button');
    clear.className = 'filter-clear-btn';
    clear.textContent = 'Clear';
    clear.addEventListener('click', clearListFilters);
    bar.appendChild(clear);
}

function activeFilterCount() {
    let n = 0;
    if (currentFilters.search) n++;
    if (currentFilters.priority) n++;
    if (currentFilters.size) n++;
    if (currentFilters.age) n++;
    if (currentFilters.status && currentFilters.status !== 'active') n++;
    if (currentSort !== 'priority') n++;
    return n;
}

function updateFiltersButton() {
    const n = activeFilterCount();
    const label = document.getElementById('filters-btn-label');
    if (label) label.textContent = n ? `Filters & sort (${n})` : 'Filters & sort';
    document.getElementById('open-filters').classList.toggle('has-active', n > 0);
}

// On mobile the filter controls live inside a modal; move the real elements
// in/out so there's a single source of truth (no duplicated state to sync).
function openFilterModal() {
    document.getElementById('filter-modal-body').appendChild(document.getElementById('filter-controls'));
    document.getElementById('filter-modal').style.display = 'flex';
}

function closeFilterModal() {
    // Return the controls to the toolbar
    document.querySelector('.lists-toolbar-left').appendChild(document.getElementById('filter-controls'));
    document.getElementById('filter-modal').style.display = 'none';
}

function reviewQueue() {
    const hidden = hiddenThemeIds();
    return state.tasks.filter(t => themesPass(t, hidden) && needsReview(t));
}

function renderReviewBanner() {
    const banner = document.getElementById('review-banner');
    const queue = reviewQueue();
    if (!queue.length || reviewBannerDismissed) {
        banner.style.display = 'none';
        return;
    }
    banner.style.display = 'flex';
    banner.innerHTML = '';
    const txt = document.createElement('span');
    txt.className = 'review-banner-text';
    txt.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg> <strong>${queue.length}</strong> new item${queue.length>1?'s':''} to review — decide what goes on the board.`;
    banner.appendChild(txt);
    const actions = document.createElement('div');
    actions.className = 'review-banner-actions';
    const reviewBtn = document.createElement('button');
    reviewBtn.className = 'btn-small';
    reviewBtn.textContent = 'Review';
    reviewBtn.addEventListener('click', openReviewModal);
    const dismiss = document.createElement('button');
    dismiss.className = 'btn-ghost review-banner-dismiss';
    dismiss.innerHTML = '&times;';
    dismiss.title = 'Dismiss';
    dismiss.addEventListener('click', () => { reviewBannerDismissed = true; renderReviewBanner(); });
    actions.appendChild(reviewBtn);
    actions.appendChild(dismiss);
    banner.appendChild(actions);
}

function openReviewModal() {
    renderReviewList();
    document.getElementById('review-modal').style.display = 'flex';
}

function closeReviewModal() {
    document.getElementById('review-modal').style.display = 'none';
}

function renderReviewList() {
    const list = document.getElementById('review-list');
    list.innerHTML = '';
    const queue = reviewQueue();
    if (!queue.length) {
        list.innerHTML = '<div class="review-empty">All caught up 🎉</div>';
        return;
    }
    sortKanbanFirst(queue).forEach(task => {
        list.appendChild(createListItem(task, { review: true }));
    });
}

function renderStaleBanner() {
    const banner = document.getElementById('stale-banner');
    const hidden = hiddenThemeIds();
    const stale = state.tasks.filter(t => themesPass(t, hidden) && isStale(t));
    const snoozedUntil = state.settings.staleSnoozeUntil;
    if (!stale.length || staleBannerDismissed || currentFilters.age
        || (snoozedUntil && todayStr() < snoozedUntil)) {
        banner.style.display = 'none';
        return;
    }
    banner.style.display = 'flex';
    banner.innerHTML = '';
    const txt = document.createElement('span');
    txt.className = 'stale-banner-text';
    txt.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg> <strong>${stale.length}</strong> task${stale.length>1?'s have':' has'} been sitting over ${STALE_DAYS} days. Snooze the ones you won't pick up soon.`;
    banner.appendChild(txt);
    const actions = document.createElement('div');
    actions.className = 'stale-banner-actions';
    const review = document.createElement('button');
    review.className = 'btn-small';
    review.textContent = 'Review';
    review.addEventListener('click', () => {
        // Clear anything that could hide stale items, then filter to 30+ days
        // across every theme (the count is theme-wide, so the view must be too)
        currentThemeTab = 'all';
        currentFilters.priority = ''; currentFilters.size = ''; currentFilters.search = '';
        currentFilters.status = 'active'; currentFilters.age = String(STALE_DAYS);
        document.getElementById('list-filter-priority').value = '';
        document.getElementById('list-filter-size').value = '';
        document.getElementById('list-filter-status').value = 'active';
        document.getElementById('list-search').value = '';
        document.getElementById('list-filter-age').value = String(STALE_DAYS);
        if (!bulkMode) document.getElementById('bulk-select-btn').click();
        renderLists();
    });
    const dismiss = document.createElement('button');
    dismiss.className = 'btn-ghost stale-banner-dismiss';
    dismiss.innerHTML = '&times;';
    dismiss.title = 'Snooze until next week';
    // Closing snoozes the reminder until the start of next week, so it stops
    // nagging but comes back for the following weekly review.
    dismiss.addEventListener('click', () => {
        staleBannerDismissed = true;
        state.settings.staleSnoozeUntil = addDays(getWeekStart(todayStr()), 7);
        saveState();
        renderStaleBanner();
    });
    actions.appendChild(review);
    actions.appendChild(dismiss);
    banner.appendChild(actions);
}

// One collapsible tag-filter block, rendered into whichever view is showing.
// Collapsed by default so it costs a single line until it's wanted.
function renderTagFilter(hostId) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = '';
    const cats = allTagCategories().filter(c => (c.tags || []).length);
    if (!cats.length) return;

    const head = document.createElement('div');
    head.className = 'tag-filter-head';
    const toggle = document.createElement('button');
    toggle.className = 'tag-filter-toggle' + (tagFilterOpen ? ' open' : '');
    toggle.innerHTML = `Tags <span class="tag-filter-caret">${tagFilterOpen ? '\u25be' : '\u25b8'}</span>`;
    toggle.addEventListener('click', () => { tagFilterOpen = !tagFilterOpen; render(); });
    head.appendChild(toggle);

    if (activeTagFilter.length) {
        const count = document.createElement('span');
        count.className = 'tag-filter-count';
        count.textContent = activeTagFilter.length + ' on';
        head.appendChild(count);
        // Name the active tags even when collapsed, so a filter can't hide
        activeTagFilter.map(getTag).filter(Boolean).forEach(tag => {
            const chip = tagChipEl(tag);
            chip.classList.add('chip-tag-active');
            chip.style.background = tag.category.color;
            chip.style.color = contrastText(tag.category.color);
            chip.addEventListener('click', () => toggleTagFilter(tag.id));
            head.appendChild(chip);
        });
        const clear = document.createElement('button');
        clear.className = 'btn-ghost tag-filter-clear';
        clear.textContent = 'Clear';
        clear.addEventListener('click', () => { activeTagFilter = []; render(); });
        head.appendChild(clear);
    }
    host.appendChild(head);

    if (!tagFilterOpen) return;
    const body = document.createElement('div');
    body.className = 'tag-filter-body';
    cats.forEach(cat => {
        const row = document.createElement('div');
        row.className = 'tag-filter-row';
        const label = document.createElement('span');
        label.className = 'tag-cat-label';
        label.textContent = cat.name;
        row.appendChild(label);
        [...cat.tags].sort((a,b) => a.name.localeCompare(b.name)).forEach(tag => {
            const on = activeTagFilter.includes(tag.id);
            const btn = document.createElement('button');
            btn.className = 'tag-chip' + (on ? ' on' : '');
            btn.textContent = tag.name;
            btn.style.borderColor = cat.color;
            if (on) { btn.style.background = cat.color; btn.style.color = contrastText(cat.color); }
            else { btn.style.color = cat.color; }
            btn.addEventListener('click', () => toggleTagFilter(tag.id));
            row.appendChild(btn);
        });
        body.appendChild(row);
    });
    host.appendChild(body);
}

function toggleTagFilter(id) {
    const i = activeTagFilter.indexOf(id);
    if (i === -1) activeTagFilter.push(id); else activeTagFilter.splice(i, 1);
    render();
}

function renderThemeTabs() {
    const container = document.getElementById('lists-theme-tabs');
    container.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.className = 'theme-tab' + (currentThemeTab === 'all' ? ' active' : '');
    allBtn.textContent = 'All';
    if (currentThemeTab === 'all') allBtn.style.background = '#1d1d1f';
    allBtn.addEventListener('click', () => { currentThemeTab = 'all'; renderLists(); });
    container.appendChild(allBtn);

    [...state.themes].filter(t => !t.hidden || state.settings.showHidden).sort((a,b) => a.name.localeCompare(b.name)).forEach(theme => {
        const btn = document.createElement('button');
        btn.className = 'theme-tab' + (currentThemeTab === theme.id ? ' active' : '');
        btn.textContent = theme.name;
        if (currentThemeTab === theme.id) { btn.style.background = theme.color; btn.style.color = contrastText(theme.color); }
        btn.addEventListener('click', () => { currentThemeTab = theme.id; renderLists(); });
        container.appendChild(btn);
    });
}

function getFilteredTasks() {
    const today = todayStr();
    const hidden = hiddenThemeIds();
    return state.tasks.filter(t => {
        if (t.status === 'scheduled') return false; // dormant recurrence
        if (t.inNotes) return false;               // parked over in Notes
        if (!themesPass(t, hidden)) return false;
        if (currentFilters.status === 'active' && (t.status === 'complete' || t.status === 'wont-do')) return false;
        if (currentFilters.status === 'complete' && t.status !== 'complete') return false;
        if (currentFilters.priority && t.priority !== currentFilters.priority) return false;
        if (currentFilters.size && t.size !== currentFilters.size) return false;
        if (currentFilters.age && daysSince(t.createdDate) < parseInt(currentFilters.age)) return false;
        if (!taskMatchesTagFilter(t, activeTagFilter)) return false;
        if (currentThemeTab !== 'all' && !taskThemeIds(t).includes(currentThemeTab)) return false;
        if (currentFilters.search) {
            if (!fuzzyMatch(currentFilters.search, t.title, t.subTheme || '', ...taskTags(t).map(x => x.name))) return false;
        }
        return true;
    });
}

// The chosen sort (default Priority) orders tasks within a group; the
// selected sort supersedes priority, with priority then title as tiebreaks.
function chosenSortCompare(a, b) {
    // When reviewing the aged-tasks filter, longest-in-list comes first
    // (oldest createdDate wins) regardless of the chosen sort.
    if (currentFilters.age) {
        const d = (a.createdDate || '').localeCompare(b.createdDate || '');
        if (d !== 0) return d;
    }
    if (currentSort === 'size') {
        const d = (SIZE_ORDER[b.size]||0) - (SIZE_ORDER[a.size]||0);
        if (d !== 0) return d;
    } else if (currentSort === 'points') {
        const d = (SIZE_POINTS[b.size]||0) - (SIZE_POINTS[a.size]||0);
        if (d !== 0) return d;
    } else if (currentSort === 'date') {
        const d = (b.createdDate||'').localeCompare(a.createdDate||'');
        if (d !== 0) return d;
    }
    const pd = prioRank(a) - prioRank(b);
    if (pd !== 0) return pd;
    return (a.title || '').localeCompare(b.title || '');
}

// Tier within a theme group: on-board first, then off-board, then plain list
function tierRank(t) {
    if (t.kanbanColumn) return 0;
    if (t.offKanban) return 1;
    return 2;
}

function sortKanbanFirst(tasks) {
    const colIndex = {};
    boardColumns().forEach((c, i) => colIndex[c.id] = i);
    return [...tasks].sort((a, b) => {
        // Spotlight floats to the very top of its theme group
        const sd = spotRank(a) - spotRank(b);
        if (sd !== 0) return sd;
        const td = tierRank(a) - tierRank(b);
        if (td !== 0) return td;
        // Within the on-board tier: high priority first, then position on the
        // board (Backlog → Complete), then title
        if (a.kanbanColumn && b.kanbanColumn) {
            const pd = prioRank(a) - prioRank(b);
            if (pd !== 0) return pd;
            const colDiff = (colIndex[a.kanbanColumn] ?? 99) - (colIndex[b.kanbanColumn] ?? 99);
            if (colDiff !== 0) return colDiff;
            return (a.title || '').localeCompare(b.title || '');
        }
        return chosenSortCompare(a, b);
    });
}

// Everything parked in Notes, grouped by theme like Lists and honouring the
// same tag filter — but without the priority/age machinery, which is the
// whole point of the list.
function notesTasks() {
    const hidden = hiddenThemeIds();
    return state.tasks.filter(t =>
        t.inNotes && t.status !== 'complete' && t.status !== 'wont-do'
        && themesPass(t, hidden) && taskMatchesTagFilter(t, activeTagFilter));
}

function renderNotes() {
    renderTagFilter('notes-tag-filter');
    const container = document.getElementById('notes-content');
    container.innerHTML = '';
    const all = notesTasks();
    if (!all.length) {
        container.innerHTML = '<div class="empty-state"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M4 4h16v12l-4 4H4z"/><path d="M8 9h8M8 13h5"/></svg><p>Nothing parked here yet</p><p class="empty-hint">Use a card\u2019s \u22ef menu &rsaquo; <strong>Move to Notes</strong> to park it.</p></div>';
        return;
    }
    const grouped = {};
    all.forEach(t => {
        const key = primaryThemeId(t) || '__none__';
        (grouped[key] = grouped[key] || []).push(t);
    });
    const order = [...state.themes].sort((a,b) => a.name.localeCompare(b.name)).map(th => th.id);
    order.unshift('__none__');
    order.forEach(tid => {
        if (!grouped[tid] || !grouped[tid].length) return;
        const theme = getTheme(tid);
        const label = document.createElement('div');
        label.className = 'list-group-label';
        label.textContent = theme ? theme.name : 'No Theme';
        container.appendChild(label);
        grouped[tid]
            .sort((a,b) => (a.title||'').localeCompare(b.title||''))
            .forEach(t => container.appendChild(createListItem(t)));
    });
}

function renderListContent() {
    const container = document.getElementById('lists-content');
    container.innerHTML = '';
    const all = getFilteredTasks();

    if (!all.length) {
        container.innerHTML = '<div class="empty-state"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg><p>No tasks here yet</p></div>';
        return;
    }

    const appendGroup = (groupKey, groupTasks) => {
        const active = groupTasks.filter(t => !isSnoozed(t));
        const snoozed = groupTasks.filter(isSnoozed);
        sortKanbanFirst(active).forEach(t => container.appendChild(createListItem(t)));
        if (snoozed.length) {
            const open = snoozedExpanded.has(groupKey);
            const toggle = document.createElement('button');
            toggle.className = 'snoozed-toggle';
            toggle.innerHTML = open
                ? 'Hide snoozed'
                : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg> Show ${snoozed.length} snoozed`;
            toggle.addEventListener('click', () => {
                if (open) snoozedExpanded.delete(groupKey); else snoozedExpanded.add(groupKey);
                renderLists();
            });
            container.appendChild(toggle);
            if (open) sortKanbanFirst(snoozed).forEach(t => container.appendChild(createListItem(t)));
        }
    };

    // Aged-tasks review (30-day banner): one flat list of list-only cards,
    // longest-in-list first, so the oldest across every theme surface together.
    // On-board and snoozed items are excluded to match the banner's count.
    if (currentFilters.age) {
        const aged = all.filter(t => !t.kanbanColumn && !isSnoozed(t))
            .sort((a, b) => (a.createdDate || '').localeCompare(b.createdDate || ''));
        if (!aged.length) {
            container.innerHTML = '<div class="empty-state"><p>Nothing sitting that long 🎉</p></div>';
            return;
        }
        aged.forEach(t => container.appendChild(createListItem(t)));
        return;
    }

    // Group by theme if "all" tab
    if (currentThemeTab === 'all') {
        const grouped = {};
        all.forEach(t => {
            const key = primaryThemeId(t) || '__none__';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(t);
        });
        const themeOrder = [...state.themes].sort((a,b) => a.name.localeCompare(b.name)).map(th => th.id);
        themeOrder.unshift('__none__');
        themeOrder.forEach(tid => {
            if (!grouped[tid] || !grouped[tid].length) return;
            const theme = getTheme(tid);
            const label = document.createElement('div');
            label.className = 'list-group-label';
            label.textContent = theme ? theme.name : 'No Theme';
            container.appendChild(label);
            appendGroup(tid, grouped[tid]);
        });
    } else {
        appendGroup(currentThemeTab, all);
    }
}

function createListItem(task, opts = {}) {
    const row = document.createElement('div');
    row.className = 'list-item';
    if (opts.review) row.classList.add('review-item');
    if (task.priority) row.classList.add('priority-' + task.priority);
    if (task.spotlight) row.classList.add('spotlight');
    if (task.offKanban && !task.kanbanColumn) row.classList.add('off-kanban');
    if (task.status === 'complete') row.classList.add('completed');
    if (task.status === 'wont-do') row.classList.add('wont-do');
    row.dataset.taskId = task.id;

    // Bulk checkbox
    if (bulkMode) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'list-select-cb';
        cb.checked = selectedIds.has(task.id);
        cb.addEventListener('change', () => {
            if (cb.checked) selectedIds.add(task.id); else selectedIds.delete(task.id);
            document.getElementById('bulk-count').textContent = selectedIds.size + ' selected';
        });
        row.appendChild(cb);
    }

    // Complete checkbox
    const check = document.createElement('div');
    check.className = 'list-check' + (task.status === 'complete' ? ' checked' : '');
    check.addEventListener('click', e => { e.stopPropagation(); completeTask(task.id); });
    row.appendChild(check);

    // Body
    const body = document.createElement('div');
    body.className = 'list-item-body';
    body.addEventListener('click', () => {
        if (opts.review) { reopenReviewAfterTask = true; closeReviewModal(); }
        openTaskModal(task.id);
    });

    const title = document.createElement('span');
    title.className = 'list-item-title';
    if (task.spotlight) {
        const star = document.createElement('span');
        star.className = 'spotlight-star';
        star.textContent = '★ ';
        title.appendChild(star);
    }
    title.appendChild(document.createTextNode(task.title));
    body.appendChild(title);

    const chips = document.createElement('div');
    chips.className = 'list-item-chips';

    if (needsReview(task)) {
        const nw = document.createElement('span');
        nw.className = 'chip chip-new';
        nw.textContent = 'New';
        chips.appendChild(nw);
    }
    if (task.offKanban && !task.kanbanColumn) {
        const ok = document.createElement('span');
        ok.className = 'chip chip-offkanban';
        ok.textContent = 'Off board';
        chips.appendChild(ok);
    }

    taskThemes(task).forEach(theme => {
        const tc = document.createElement('span');
        tc.className = 'chip chip-theme';
        tc.style.background = theme.color;
        tc.style.color = contrastText(theme.color);
        tc.textContent = theme.name;
        chips.appendChild(tc);
    });
    taskTags(task).forEach(tag => chips.appendChild(tagChipEl(tag)));
    const listProg = progressChipEl(task);
    if (listProg) chips.appendChild(listProg);
    if (task.subTheme) {
        const sc = document.createElement('span');
        sc.className = 'chip chip-sub';
        sc.textContent = task.subTheme;
        chips.appendChild(sc);
    }
    if (task.size) {
        const sz = document.createElement('span');
        sz.className = 'chip chip-size';
        sz.textContent = task.size.toUpperCase();
        chips.appendChild(sz);
    }
    if (task.recurring) {
        const rc = document.createElement('span');
        rc.className = 'chip chip-recurring';
        rc.textContent = '↻' + (task.runCount > 0 ? ' #'+task.runCount : '');
        chips.appendChild(rc);
    }
    const today = todayStr();
    const cd = countdownChip(task);
    if (cd) {
        chips.appendChild(cd);
    } else if (task.dueDate) {
        const due = document.createElement('span');
        due.className = 'chip ' + (task.dueDate < today ? 'chip-overdue' : 'chip-due');
        due.textContent = 'Due ' + formatDateShort(task.dueDate);
        chips.appendChild(due);
    }
    if (task.doDate && !task.kanbanColumn && task.status === 'active') {
        const dd = document.createElement('span');
        dd.className = 'chip chip-do';
        dd.textContent = 'Do ' + formatDateShort(task.doDate);
        chips.appendChild(dd);
    }
    if (isSnoozed(task)) {
        row.classList.add('snoozed');
        const sn = document.createElement('span');
        sn.className = 'chip chip-snoozed';
        sn.textContent = 'Snoozed until ' + formatDateShort(task.snoozedUntil);
        chips.appendChild(sn);
    } else if (currentFilters.age && !opts.review && !task.kanbanColumn) {
        // Only surface "days in list" while reviewing the aged-tasks filter
        // (e.g. via the 30-day banner) — otherwise it's just clutter.
        const st = document.createElement('span');
        st.className = 'chip chip-stale';
        st.textContent = daysSince(task.createdDate) + 'd in list';
        chips.appendChild(st);
    }
    body.appendChild(chips);
    row.appendChild(body);

    // Right side group
    const right = document.createElement('div');
    right.className = 'list-item-right';

    if (task.kanbanColumn) {
        const kb = document.createElement('span');
        kb.className = 'chip chip-kanban';
        kb.textContent = (KANBAN_COLS.find(c=>c.id===task.kanbanColumn)||{name:task.kanbanColumn}).name;
        right.appendChild(kb);
    }

    // To kanban / remove from kanban button
    const kanbanBtn = document.createElement('button');
    kanbanBtn.className = 'list-item-to-kanban' + (task.kanbanColumn ? ' on-kanban' : '');
    kanbanBtn.title = task.kanbanColumn ? 'Remove from Kanban' : 'Add to Kanban';
    if (task.kanbanColumn) {
        kanbanBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    } else {
        kanbanBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
    }
    kanbanBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (task.kanbanColumn) backToList(task.id);
        else moveToKanban(task.id);
    });
    right.appendChild(kanbanBtn);

    const dateEl = document.createElement('span');
    dateEl.className = 'list-item-date';
    dateEl.textContent = formatDateShort(task.createdDate);
    right.appendChild(dateEl);

    if (opts.review) {
        const del = document.createElement('button');
        del.className = 'list-item-delete';
        del.title = 'Delete';
        del.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
        del.addEventListener('click', e => { e.stopPropagation(); deleteTask(task.id); });
        right.appendChild(del);
    } else {
        const menu = document.createElement('button');
        menu.className = 'list-item-menu';
        menu.innerHTML = '⋯';
        menu.addEventListener('click', e => { e.stopPropagation(); openContextMenu(e, task.id); });
        right.appendChild(menu);
    }

    row.appendChild(right);
    return row;
}

// ---- BOARD ----

// Daily "review your Lists" reminder: shows on the Board from the configured
// time onward if the Lists page hasn't been opened yet today (per-device).
function reminderDue() {
    const s = state.settings;
    if (!s.reminderEnabled) return false;
    const today = todayStr();
    if (s.lastListVisit === today) return false;
    if (s.reminderSkipDate === today) return false;
    if (s.reminderSnoozeUntil && Date.now() < s.reminderSnoozeUntil) return false;
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    return hhmm >= (s.reminderTime || '09:00');
}

function renderListReminder() {
    const banner = document.getElementById('list-reminder');
    banner.style.display = (currentView === 'board' && reminderDue()) ? 'flex' : 'none';
}

function markListsVisited() {
    state.settings.lastListVisit = todayStr();
    saveState();
    renderListReminder();
}

// Each theme is classified as a work- or home-focus theme (set in the theme
// editor); the board's focus control flips whole groups of chips at once.
function themeFocus(t) { return t.focus === 'work' ? 'work' : 'home'; }

// The focus indicator is derived from the chip states rather than stored:
// exactly the work set on = Work, exactly the home set on = Home, anything
// else (including everything on) = All. That way toggling any chip by hand
// moves the indicator correctly on its own.
function deriveBoardFocus(themes, muted) {
    const work = themes.filter(t => themeFocus(t) === 'work');
    const home = themes.filter(t => themeFocus(t) === 'home');
    if (!work.length || !home.length) return 'all';
    const workAllOn  = work.every(t => !muted.has(t.id));
    const workAllOff = work.every(t => muted.has(t.id));
    const homeAllOn  = home.every(t => !muted.has(t.id));
    const homeAllOff = home.every(t => muted.has(t.id));
    if (workAllOn && homeAllOff) return 'work';
    if (homeAllOn && workAllOff) return 'home';
    return 'all';
}

function setBoardFocus(mode) {
    if (mode === 'all') state.settings.mutedThemes = [];
    else if (mode === 'work') state.settings.mutedThemes = state.themes.filter(t => themeFocus(t) !== 'work').map(t => t.id);
    else state.settings.mutedThemes = state.themes.filter(t => themeFocus(t) === 'work').map(t => t.id);
    saveState();
    renderBoard();
}

function renderBoardFilter() {
    const container = document.getElementById('board-filter');
    container.innerHTML = '';
    const weekendHidden = weekendHiddenThemeIds();
    const visibleThemes = state.themes.filter(t => (!t.hidden || state.settings.showHidden) && !weekendHidden.has(t.id));
    const muted = mutedThemeIds();

    // Focus segmented control: All / Work / Home presets
    const seg = document.createElement('div');
    seg.className = 'focus-seg';
    const currentFocus = deriveBoardFocus(visibleThemes, muted);
    [['all','All'], ['work','Work'], ['home','Home']].forEach(([mode, label]) => {
        const b = document.createElement('button');
        b.className = 'focus-seg-btn' + (currentFocus === mode ? ' active' : '');
        b.textContent = label;
        b.addEventListener('click', () => setBoardFocus(mode));
        seg.appendChild(b);
    });
    container.appendChild(seg);

    // Every theme is an on/off chip: filled with its colour when on, dimmed
    // when off. Off chips simply hide that theme's cards.
    [...visibleThemes].sort((a,b) => a.name.localeCompare(b.name)).forEach(theme => {
        const isOn = !muted.has(theme.id);
        const btn = document.createElement('button');
        btn.className = 'theme-tab theme-tab-toggle' + (isOn ? ' active' : ' off');
        btn.textContent = theme.name;
        if (isOn) { btn.style.background = theme.color; btn.style.color = contrastText(theme.color); }
        btn.title = (isOn ? 'Hide ' : 'Show ') + theme.name + ' cards';
        btn.addEventListener('click', () => toggleThemeMute(theme.id));
        container.appendChild(btn);
    });
}

function renderBoard() {
    renderTagFilter('board-tag-filter');
    renderBoardWeekStat();
    renderReviewBanner();
    renderListReminder();
    renderBoardFilter();
    const container = document.getElementById('board-columns');
    container.innerHTML = '';
    const hidden = hiddenThemeIds();
    const weekendHidden = weekendHiddenThemeIds();
    const muted = mutedThemeIds();

    boardColumns().forEach(col => {
        const tasks = state.tasks.filter(t =>
            t.kanbanColumn === col.id && t.status !== 'wont-do'
            && themesPass(t, hidden, weekendHidden, muted)
            && taskMatchesTagFilter(t, activeTagFilter));
        const colEl = document.createElement('div');
        colEl.className = 'board-col';
        colEl.dataset.col = col.id;

        const header = document.createElement('div');
        header.className = 'board-col-header';
        header.innerHTML = `<span class="board-col-name">${col.name}</span><span class="board-col-count">${tasks.length}</span>`;
        colEl.appendChild(header);

        const cards = document.createElement('div');
        cards.className = 'board-cards';
        cards.dataset.col = col.id;
        cards.addEventListener('dragover', e => { e.preventDefault(); cards.classList.add('drag-over'); });
        cards.addEventListener('dragleave', () => cards.classList.remove('drag-over'));
        cards.addEventListener('drop', e => {
            e.preventDefault(); cards.classList.remove('drag-over');
            if (draggedId) { moveToColumn(draggedId, col.id); draggedId = null; }
        });

        tasks
            .sort((a,b) => {
                const sd = spotRank(a) - spotRank(b);
                if (sd !== 0) return sd;
                const pd = prioRank(a) - prioRank(b);
                return pd !== 0 ? pd : (a.title||'').localeCompare(b.title||'');
            })
            .forEach(t => cards.appendChild(createBoardCard(t)));
        colEl.appendChild(cards);

        const addBtn = document.createElement('button');
        addBtn.className = 'board-col-add';
        addBtn.textContent = '+ Add task';
        addBtn.addEventListener('click', () => openTaskModal(null, col.id));
        colEl.appendChild(addBtn);
        container.appendChild(colEl);
    });
}

// The Complete column used to carry this in its header. The column is off the
// board now, so the week's tally sits above it instead.
function renderBoardWeekStat() {
    const host = document.getElementById('board-stats');
    host.innerHTML = '';
    const w = getWeekStats();
    if (!w.count && !w.lastCount) return;
    const arrow = w.delta === null ? '' : w.delta > 0 ? ` ↑${Math.abs(w.delta)}%` : w.delta < 0 ? ` ↓${Math.abs(w.delta)}%` : '';
    const cls = w.delta === null ? '' : w.delta > 0 ? 'col-stat-up' : w.delta < 0 ? 'col-stat-down' : '';
    const pill = document.createElement('div');
    pill.className = 'board-week-stat';
    pill.innerHTML = `<strong>${w.count}</strong> completed this week<span class="${cls}">${arrow}</span>`;
    host.appendChild(pill);
}

function createBoardCard(task) {
    const card = document.createElement('div');
    card.className = 'board-card';
    if (task.status === 'complete') card.classList.add('completed');
    if (task.spotlight) card.classList.add('spotlight');
    card.draggable = true;
    card.dataset.taskId = task.id;
    card.addEventListener('dragstart', e => { draggedId = task.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('click', () => openTaskModal(task.id));

    if (task.priority && !task.spotlight) {
        const bar = document.createElement('div');
        bar.className = 'board-card-priority ' + task.priority;
        card.appendChild(bar);
    }
    const title = document.createElement('div');
    title.className = 'board-card-title';
    if (task.spotlight) {
        const star = document.createElement('span');
        star.className = 'spotlight-star';
        star.textContent = '★ ';
        title.appendChild(star);
    }
    title.appendChild(document.createTextNode(task.title));
    card.appendChild(title);

    const footer = document.createElement('div');
    footer.className = 'board-card-footer';
    taskThemes(task).forEach(theme => {
        const tc = document.createElement('span');
        tc.className = 'chip chip-theme';
        tc.style.background = theme.color;
        tc.style.color = contrastText(theme.color);
        tc.textContent = theme.name;
        footer.appendChild(tc);
    });
    taskTags(task).forEach(tag => footer.appendChild(tagChipEl(tag)));
    const cardProg = progressChipEl(task);
    if (cardProg) footer.appendChild(cardProg);
    if (task.size) {
        const sz = document.createElement('span');
        sz.className = 'chip chip-size';
        sz.textContent = task.size.toUpperCase();
        footer.appendChild(sz);
    }
    if (task.recurring) {
        const rc = document.createElement('span');
        rc.className = 'chip chip-recurring';
        rc.textContent = '↻' + (task.runCount > 0 ? ' #'+task.runCount : '');
        footer.appendChild(rc);
    }
    const cd = countdownChip(task);
    if (cd) footer.appendChild(cd);
    if (task.kanbanColumn === 'live' && task.status === 'active') {
        footer.appendChild(todoChip(task.planDay ? dayLabel(task.planDay).replace(/ \d+ \w+$/, '') : 'Ready',
            'chip-day' + (task.planDay === todayStr() ? ' chip-day-today' : '')));
    }
    const menuBtn = document.createElement('button');
    menuBtn.className = 'board-card-menu';
    menuBtn.innerHTML = '⋯';
    menuBtn.addEventListener('click', e => { e.stopPropagation(); openContextMenu(e, task.id); });
    footer.appendChild(menuBtn);
    card.appendChild(footer);
    return card;
}

function getWeekStats() {
    const thisWeek = getWeekStart(todayStr());
    const lastWeek = getWeekStart(addDays(thisWeek, -1));
    const thisCompleted = state.tasks.filter(t => t.status === 'complete' && getWeekStart(t.completedDate||'') === thisWeek);
    const lastCompleted = state.tasks.filter(t => t.status === 'complete' && getWeekStart(t.completedDate||'') === lastWeek);
    const countDelta = lastCompleted.length ? Math.round((thisCompleted.length - lastCompleted.length) / lastCompleted.length * 100) : null;
    return { count: thisCompleted.length, lastCount: lastCompleted.length, delta: countDelta };
}

// ---- TODAY ----
// The top tier, and deliberately nothing but today. Everything in the board's
// Live column is either planned onto a day (task.planDay) or sitting in Ready;
// Ready stays out of sight behind one button (the Ready sheet) so the screen
// is only ever about today. Order within the day is task.planOrder, moved with
// up/down — the to-do list's own priority, so the priority field stays off it.
// Anything not done by the end of its day rolls forward to today
// (rollOverPlan), so nothing is ever left behind.

function byPlanOrder(a, b) {
    return (a.planOrder || 0) - (b.planOrder || 0) || (a.title || '').localeCompare(b.title || '');
}
function isLiveActive(t) { return t.status === 'active' && t.kanbanColumn === 'live'; }
function planTasks(day) { return state.tasks.filter(t => isLiveActive(t) && t.planDay === day).sort(byPlanOrder); }
function readyTasks() { return state.tasks.filter(t => isLiveActive(t) && !t.planDay).sort(byPlanOrder); }
function doneOn(day) { return state.tasks.filter(t => t.status === 'complete' && t.planDay === day).sort(byPlanOrder); }
function boardBacklogTasks() {
    return state.tasks.filter(t => t.status === 'active' && (t.kanbanColumn === 'backlog-day' || t.kanbanColumn === 'backlog-evening'))
        .sort((a, b) => spotRank(a) - spotRank(b) || prioRank(a) - prioRank(b) || (a.title || '').localeCompare(b.title || ''));
}
function nextPlanOrder(list) { return list.reduce((m, t) => Math.max(m, t.planOrder || 0), 0) + 1; }

// "Today", "Tomorrow", "Yesterday", else "Thu 6 Nov"
function dayLabel(day) {
    const today = todayStr();
    if (day === today) return 'Today';
    if (day === addDays(today, 1)) return 'Tomorrow';
    if (day === addDays(today, -1)) return 'Yesterday';
    return new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
}

// Unfinished work from a past day moves onto today, at the top (it's the
// overdue stuff). carriedFrom keeps the day it was first planned for, so a
// task that keeps slipping says so. Deterministic, so two devices rolling the
// same tasks over agree. Returns whether anything moved; the caller saves.
function rollOverPlan() {
    const today = todayStr();
    const late = state.tasks.filter(t => isLiveActive(t) && t.planDay && t.planDay < today).sort((a, b) =>
        a.planDay.localeCompare(b.planDay) || byPlanOrder(a, b));
    if (!late.length) return false;
    const top = planTasks(today).reduce((m, t) => Math.min(m, t.planOrder || 0), 1);
    late.forEach((t, i) => {
        if (!t.carriedFrom) t.carriedFrom = t.planDay;
        t.planDay = today;
        t.planOrder = top - late.length + i;
        t.updatedAt = Date.now();
    });
    return true;
}

// Put a task on a day (or back in Ready with day = null), at the bottom.
function planFor(id, day) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    const list = day ? planTasks(day) : readyTasks();
    todayOpenId = null;
    updateTask(id, {
        kanbanColumn: 'live', planDay: day || null, planOrder: nextPlanOrder(list.filter(t => t.id !== id)),
        carriedFrom: null, reviewed: true, offKanban: false, inNotes: false, snoozedUntil: '',
    });
}

function sendToBacklog(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    todayOpenId = null;
    updateTask(id, { kanbanColumn: defaultBacklogCol(taskThemeIds(task)) });
}

function markBlocked(id) { todayOpenId = null; updateTask(id, { kanbanColumn: 'blocked' }); }

// Swap a task with its neighbour in the list it's shown in.
// Desktop drag: drop a task onto a day at a given position, renumbering the
// day so the order is exactly what was shown.
function dropIntoPlan(id, day, index) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    const list = planTasks(day).filter(t => t.id !== id);
    list.splice(Math.max(0, Math.min(index, list.length)), 0, task);
    if (task.planDay !== day) task.carriedFrom = null;
    task.planDay = day;
    const now = Date.now();
    list.forEach((t, k) => { if (t.planOrder !== k || t === task) { t.planOrder = k; t.updatedAt = now; } });
    todayOpenId = null;
    saveState();
    render();
}

// Drag needs a mouse; phones keep the tap-only controls
function canDragTodo() { return window.matchMedia('(hover: hover) and (pointer: fine)').matches; }

function nudgePlanOrder(id, dir, list) {
    const i = list.findIndex(t => t.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const now = Date.now();
    list.forEach((t, k) => { if (t.planOrder !== k) { t.planOrder = k; t.updatedAt = now; } });
    [list[i].planOrder, list[j].planOrder] = [j, i];
    list[i].updatedAt = list[j].updatedAt = now;
    saveState();
    render();
}

function todoChip(text, cls) {
    const c = document.createElement('span');
    c.className = 'chip ' + (cls || '');
    c.textContent = text;
    return c;
}

function todoBtn(label, cls, fn, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.addEventListener('click', e => { e.stopPropagation(); fn(); });
    return b;
}

function longDay(day) {
    const l = dayLabel(day);
    if (/^(Today|Tomorrow|Yesterday)$/.test(l)) return l.toLowerCase();
    return new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'short' });
}
function shortDay(day) { return dayLabel(day).replace(/ \d+ \w+$/, ''); }

// One to-do row. where: 'day' | 'ready' | 'backlog' | 'done'.
function todoRow(task, where, list) {
    const row = document.createElement('div');
    row.className = 'todo-row';
    row.dataset.taskId = task.id;
    const done = task.status === 'complete';
    if (done) row.classList.add('done');
    const open = todayOpenId === task.id && !done;
    if (open) row.classList.add('open');
    const today = todayStr();

    const main = document.createElement('div');
    main.className = 'todo-main';

    if (where === 'day' || where === 'done') {
        const check = todoBtn('', 'todo-check', () => { todayOpenId = null; completeTask(task.id); },
            done ? 'Mark not done' : 'Mark complete');
        check.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2"><polyline points="20 6 9 17 4 12"/></svg>';
        main.appendChild(check);
    }

    const body = document.createElement('div');
    body.className = 'todo-body';
    const title = document.createElement('div');
    title.className = 'todo-title';
    title.textContent = task.title;
    body.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'todo-meta';
    taskThemes(task).forEach(theme => {
        const tc = todoChip(theme.name, 'chip-theme');
        tc.style.background = theme.color;
        tc.style.color = contrastText(theme.color);
        meta.appendChild(tc);
    });
    taskTags(task).forEach(tag => meta.appendChild(tagChipEl(tag)));
    const prog = progressChipEl(task);
    if (prog) meta.appendChild(prog);
    if (task.carriedFrom && !done) meta.appendChild(todoChip('↻ since ' + shortDay(task.carriedFrom), 'chip-carried'));
    if (meta.childNodes.length) body.appendChild(meta);
    if (!done) body.addEventListener('click', () => { todayOpenId = open ? null : task.id; render(); });
    main.appendChild(body);

    if (!done) {
        const side = document.createElement('div');
        side.className = 'todo-side';
        if (where === 'day' && todayOrderEdit && list) {
            const i = list.indexOf(task);
            const up = todoBtn('▲', 'todo-nudge', () => nudgePlanOrder(task.id, -1, list), 'Move up');
            const down = todoBtn('▼', 'todo-nudge', () => nudgePlanOrder(task.id, 1, list), 'Move down');
            up.disabled = i <= 0; down.disabled = i >= list.length - 1;
            side.append(up, down);
        } else if (where === 'ready' || where === 'backlog') {
            side.appendChild(todoBtn('+ ' + shortDay(todayDay), 'todo-add', () => planFor(task.id, todayDay), 'Add to ' + longDay(todayDay)));
        }
        if (side.childNodes.length) main.appendChild(side);
    }
    row.appendChild(main);
    if (where === 'day' && !done && canDragTodo()) {
        row.draggable = true;
        row.addEventListener('dragstart', e => {
            todayDragId = task.id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', task.id);
            setTimeout(() => row.classList.add('dragging'), 0);
        });
        row.addEventListener('dragend', () => { todayDragId = null; row.classList.remove('dragging'); clearDropMarks(); });
    }

    if (open) {
        const strip = document.createElement('div');
        strip.className = 'todo-actions';
        const add = (label, fn, cls) => strip.appendChild(todoBtn(label, 'todo-act' + (cls ? ' ' + cls : ''), fn));
        if (where === 'day') add(todayDay === today ? 'Tomorrow →' : 'Next day →', () => planFor(task.id, addDays(todayDay, 1)));
        else {
            if (todayDay !== today) add('+ Today', () => planFor(task.id, today));
            if (todayDay !== addDays(today, 1)) add('+ Tomorrow', () => planFor(task.id, addDays(today, 1)));
        }
        if (where !== 'ready') add(where === 'day' ? (todayDay === today ? 'Not today' : 'To Ready') : '+ Ready', () => planFor(task.id, null));
        const pick = document.createElement('label');
        pick.className = 'todo-act todo-pick';
        pick.textContent = 'Pick a day…';
        // Invisible over the pill: a tap lands on the input itself (which is
        // what opens the picker on iOS); elsewhere showPicker() does it.
        const date = document.createElement('input');
        date.type = 'date';
        date.min = today;
        date.setAttribute('aria-label', 'Pick a day');
        date.addEventListener('click', e => { e.stopPropagation(); try { date.showPicker(); } catch (err) {} });
        date.addEventListener('change', () => { if (date.value) planFor(task.id, date.value); });
        pick.appendChild(date);
        strip.appendChild(pick);
        if (where !== 'backlog') {
            add('Blocked', () => markBlocked(task.id), 'warn');
            add('Backlog', () => sendToBacklog(task.id));
        }
        add('Edit', () => { todayOpenId = null; openTaskModal(task.id); });
        row.appendChild(strip);
    }
    return row;
}

function clearDropMarks() {
    document.querySelectorAll('.todo-row.drop-before, .todo-list.drop-end').forEach(el => el.classList.remove('drop-before', 'drop-end'));
}

// Where a drop would land: before the first row whose middle is below the pointer
function dropIndex(list, y) {
    const rows = [...list.querySelectorAll('.todo-row:not(.done)')].filter(r => r.dataset.taskId !== todayDragId);
    for (let k = 0; k < rows.length; k++) {
        const r = rows[k].getBoundingClientRect();
        if (y < r.top + r.height / 2) return { index: k, row: rows[k] };
    }
    return { index: rows.length, row: null };
}

function makeTodoDropList(list, day) {
    list.addEventListener('dragover', e => {
        if (!todayDragId) return;
        e.preventDefault();
        const { row } = dropIndex(list, e.clientY);
        clearDropMarks();
        if (row) row.classList.add('drop-before'); else list.classList.add('drop-end');
    });
    list.addEventListener('dragleave', e => { if (!list.contains(e.relatedTarget)) clearDropMarks(); });
    list.addEventListener('drop', e => {
        e.preventDefault();
        if (!todayDragId) return;
        const { index } = dropIndex(list, e.clientY);
        const id = todayDragId; todayDragId = null;
        clearDropMarks();
        dropIntoPlan(id, day, index);
    });
}

function todoEmpty(text) {
    const p = document.createElement('div');
    p.className = 'todo-empty';
    p.textContent = text;
    return p;
}

function todoSection(host, label, items, isOpen, toggle, where) {
    if (!items.length) return;
    const head = todoBtn((isOpen ? '▾ ' : '▸ ') + label, 'todo-section-toggle', toggle);
    const count = document.createElement('span');
    count.className = 'todo-count';
    count.textContent = items.length;
    head.appendChild(count);
    host.appendChild(head);
    if (!isOpen) return;
    const list = document.createElement('div');
    list.className = 'todo-list';
    items.forEach(t => list.appendChild(todoRow(t, where, items)));
    host.appendChild(list);
}

function renderToday() {
    const host = document.getElementById('today-content');
    const y = window.scrollY;
    if (rollOverPlan()) saveState();
    host.innerHTML = '';
    const today = todayStr();
    // Left open past midnight: follow the date, unless they'd moved off today
    if (todayAnchor !== today) {
        if (todayDay === todayAnchor) todayDay = today;
        todayAnchor = today;
    }
    const day = todayDay;
    const goTo = d => { todayDay = d; todayOpenId = null; todayOrderEdit = false; render(); };

    const top = document.createElement('div');
    top.className = 'today-top';
    const d = new Date(day + 'T00:00:00');
    const date = document.createElement('div');
    date.className = 'today-date';
    date.innerHTML = '<div class="today-date-big"></div><div class="today-date-small"></div>';
    date.firstChild.textContent = d.toLocaleDateString('en-GB', { weekday:'long' });
    const rel = dayLabel(day);
    date.lastChild.textContent = d.toLocaleDateString('en-GB', { day:'numeric', month:'long' }) +
        (/^(Today|Tomorrow|Yesterday)$/.test(rel) && rel !== 'Today' ? ' · ' + rel : '');
    if (day !== today) date.lastChild.appendChild(todoBtn('Back to today', 'today-jump', () => goTo(today)));
    top.appendChild(date);
    const arrows = document.createElement('div');
    arrows.className = 'today-arrows';
    arrows.append(
        todoBtn('‹', 'today-arrow', () => goTo(addDays(day, -1)), 'Previous day'),
        todoBtn('›', 'today-arrow', () => goTo(addDays(day, 1)), 'Next day'));
    // Drop a task on an arrow to move it to that day (never into the past)
    [[arrows.firstChild, -1], [arrows.lastChild, 1]].forEach(([btn, dir]) => {
        const target = addDays(day, dir);
        if (target < today) return;
        btn.addEventListener('dragover', e => { if (!todayDragId) return; e.preventDefault(); btn.classList.add('drop-on'); });
        btn.addEventListener('dragleave', () => btn.classList.remove('drop-on'));
        btn.addEventListener('drop', e => {
            e.preventDefault(); btn.classList.remove('drop-on');
            const id = todayDragId; todayDragId = null;
            if (id) planFor(id, target);
        });
    });
    const tasks = planTasks(day);
    if (tasks.length > 1 || todayOrderEdit) {
        const b = todoBtn('', 'icon-btn todo-order-btn' + (todayOrderEdit ? ' on' : ''), () => {
            todayOrderEdit = !todayOrderEdit; todayOpenId = null; render();
        }, todayOrderEdit ? 'Done reordering' : 'Reorder');
        b.innerHTML = todayOrderEdit
            ? '<span class="todo-order-done">Done</span>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg>';
        top.appendChild(b);
    }
    top.appendChild(arrows);
    host.appendChild(top);

    const list = document.createElement('div');
    list.className = 'todo-list';
    tasks.forEach(t => list.appendChild(todoRow(t, 'day', tasks)));
    if (day >= today) makeTodoDropList(list, day);
    if (!tasks.length) {
        const past = day < today;
        list.appendChild(todoEmpty(past ? 'Anything unfinished from this day rolled forward to today.'
            : doneOn(day).length ? 'All done.' : 'Nothing planned' + (day === today ? ' for today yet.' : '.')));
    }
    host.appendChild(list);

    todoSection(host, 'Done', doneOn(day), todayDoneOpen, () => { todayDoneOpen = !todayDoneOpen; render(); }, 'done');

    // Ready lives behind this one quiet button (nothing to add to a past day)
    if (day >= today) {
        const n = readyTasks().length;
        host.appendChild(todoBtn(n ? 'Add from Ready · ' + n : 'Add from Ready', 'today-pull', openReadySheet));
    }

    if (document.getElementById('ready-modal').style.display === 'flex') renderReadySheet();
    syncQuickAddVisibility();   // its placeholder names the day being shown
    if (window.scrollY !== y) window.scrollTo(0, y);
}

// ---- The Ready sheet: Live but not on a day, plus the board backlog ----
function openReadySheet() {
    todayOpenId = null;
    document.getElementById('ready-modal').style.display = 'flex';
    renderReadySheet();
}
function closeReadySheet() {
    todayOpenId = null;
    document.getElementById('ready-modal').style.display = 'none';
    render();
}
function renderReadySheet() {
    const host = document.getElementById('ready-list');
    const y = host.scrollTop;
    host.innerHTML = '';
    document.getElementById('ready-title').textContent = 'Add to ' + longDay(todayDay);
    const ready = readyTasks();
    const list = document.createElement('div');
    list.className = 'todo-list';
    ready.forEach(t => list.appendChild(todoRow(t, 'ready', ready)));
    if (!ready.length) list.appendChild(todoEmpty('Nothing in Ready. Move cards into Live on the board, or pick from the backlog below.'));
    host.appendChild(list);
    todoSection(host, 'From the board backlog', boardBacklogTasks(), todayBacklogOpen,
        () => { todayBacklogOpen = !todayBacklogOpen; renderReadySheet(); }, 'backlog');
    host.scrollTop = y;
}

// ---- ADMIN ----

function renderAdmin() {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.admin === currentAdminTab));
    const container = document.getElementById('admin-content');
    if (currentAdminTab === 'themes') renderAdminThemes(container);
    else if (currentAdminTab === 'tags') renderAdminTags(container);
    else if (currentAdminTab === 'archive') renderAdminArchive(container);
    else renderAdminData(container);
}

function renderAdminThemes(container) {
    container.innerHTML = '';
    const hdr = document.createElement('div');
    hdr.className = 'admin-section-header';
    hdr.innerHTML = '<h3>Themes & Sub-themes</h3>';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary';
    addBtn.textContent = '+ Add Theme';
    addBtn.addEventListener('click', () => openThemeModal(null));
    hdr.appendChild(addBtn);
    container.appendChild(hdr);

    renderRecoveryNotice(container, 'themes');

    const list = document.createElement('div');
    list.className = 'theme-list';
    [...state.themes].sort((a,b) => a.name.localeCompare(b.name)).forEach(theme => {
        const row = document.createElement('div');
        row.className = 'theme-row';
        if (theme.hidden) row.classList.add('theme-row-hidden');
        if (theme.recovered) row.classList.add('theme-row-recovered');
        const swatch = document.createElement('div');
        swatch.className = 'theme-swatch';
        swatch.style.background = theme.color;
        const info = document.createElement('div');
        info.style.flex = '1';
        info.innerHTML = `<div class="theme-row-name">${theme.name}${theme.hidden ? ' <span class="hidden-badge">Hidden</span>' : ''}</div><div class="theme-row-subs">${[...(theme.subThemes||[])].sort((a,b)=>a.localeCompare(b)).join(', ') || 'No sub-themes'}</div>`;
        const actions = document.createElement('div');
        actions.className = 'theme-row-actions';
        const hideBtn = document.createElement('button');
        hideBtn.className = 'btn-ghost';
        hideBtn.textContent = theme.hidden ? 'Show' : 'Hide';
        hideBtn.style.padding = '5px 12px';
        hideBtn.style.fontSize = '12px';
        hideBtn.addEventListener('click', () => {
            theme.hidden = !theme.hidden;
            state.themesUpdatedAt = Date.now();
            saveState();
            renderAdmin();
        });
        actions.appendChild(hideBtn);
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-ghost';
        editBtn.textContent = 'Edit';
        editBtn.style.padding = '5px 12px';
        editBtn.style.fontSize = '12px';
        editBtn.addEventListener('click', () => openThemeModal(theme.id));
        actions.appendChild(editBtn);
        row.appendChild(swatch); row.appendChild(info); row.appendChild(actions);
        list.appendChild(row);
    });
    container.appendChild(list);
}

// Admin > Tags: categories with their tags, both editable inline. Kept
// deliberately plain — it's a list of words, not a design surface.
function renderAdminTags(container) {
    container.innerHTML = '';
    const hdr = document.createElement('div');
    hdr.className = 'admin-section-header';
    hdr.innerHTML = '<h3>Tags</h3>';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary';
    addBtn.textContent = '+ Add Category';
    addBtn.addEventListener('click', () => openTagCatModal(null));
    hdr.appendChild(addBtn);
    container.appendChild(hdr);

    renderRecoveryNotice(container, 'tags');

    const intro = document.createElement('div');
    intro.className = 'form-hint admin-intro';
    intro.innerHTML = 'Tags cut across themes, so one task can be Work <em>and</em> Barney <em>and</em> Weekend. A category groups related tags &mdash; people, when something fits, a trip you\u2019re planning.';
    container.appendChild(intro);

    const cats = allTagCategories();
    if (!cats.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No tag categories yet.';
        container.appendChild(empty);
        return;
    }

    cats.forEach(cat => {
        const box = document.createElement('div');
        box.className = 'tag-cat-box' + (cat.recovered ? ' tag-cat-recovered' : '');

        const head = document.createElement('div');
        head.className = 'tag-cat-head';
        const swatch = document.createElement('span');
        swatch.className = 'theme-swatch tag-cat-swatch';
        swatch.style.background = cat.color;
        head.appendChild(swatch);
        const name = document.createElement('div');
        name.className = 'tag-cat-name';
        name.textContent = cat.name;
        head.appendChild(name);
        const count = document.createElement('span');
        count.className = 'tag-cat-count';
        count.textContent = (cat.tags || []).length + ' tag' + ((cat.tags||[]).length === 1 ? '' : 's');
        head.appendChild(count);
        const edit = document.createElement('button');
        edit.className = 'btn-ghost';
        edit.textContent = 'Edit';
        edit.style.padding = '5px 12px';
        edit.style.fontSize = '12px';
        edit.addEventListener('click', () => openTagCatModal(cat.id));
        head.appendChild(edit);
        box.appendChild(head);

        const tagWrap = document.createElement('div');
        tagWrap.className = 'tag-cat-tags';
        [...(cat.tags || [])].sort((a,b) => a.name.localeCompare(b.name)).forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'tag-admin-chip' + (tag.recovered ? ' tag-admin-recovered' : '');
            chip.style.borderColor = cat.color;
            chip.style.color = cat.color;
            chip.textContent = tag.name;
            const del = document.createElement('button');
            del.className = 'tag-admin-del';
            del.innerHTML = '&times;';
            del.title = 'Delete "' + tag.name + '"';
            del.addEventListener('click', () => deleteTag(cat.id, tag.id));
            chip.appendChild(del);
            tagWrap.appendChild(chip);
        });
        box.appendChild(tagWrap);

        const needFixing = (cat.tags || []).filter(t => t.recovered);
        if (needFixing.length) box.appendChild(recoveredTagFixer(cat, needFixing));

        const add = document.createElement('div');
        add.className = 'tag-cat-add';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-input';
        input.placeholder = 'Add a tag to ' + cat.name + '\u2026';
        const go = () => {
            const v = input.value.trim();
            if (!v) return;
            addTag(cat.id, v);
            input.value = '';
            input.focus();
        };
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        add.appendChild(input);
        const addTagBtn = document.createElement('button');
        addTagBtn.className = 'btn-small';
        addTagBtn.textContent = 'Add';
        addTagBtn.addEventListener('click', go);
        add.appendChild(addTagBtn);
        box.appendChild(add);

        container.appendChild(box);
    });
}

// The tasks a tag is on, which is the only evidence of what a recovered tag
// used to be called.
function tasksWithTag(tagId) {
    return state.tasks.filter(t =>
        t.status !== 'complete' && t.status !== 'wont-do' && taskTagIds(t).includes(tagId));
}

function renameTag(catId, tagId, name) {
    const cat = getTagCategory(catId);
    const tag = cat && (cat.tags || []).find(t => t.id === tagId);
    if (!tag || !name.trim()) return;
    tag.name = name.trim();
    delete tag.recovered;                       // named, so no longer needs attention
    if (!(cat.tags || []).some(t => t.recovered)) delete cat.recovered;
    state.tagsUpdatedAt = Date.now();
    saveState();
    renderAdmin();
}

// Fold one tag into another: every task on `fromId` moves to `toId`, then the
// old tag goes. This is what a recovered tag usually needs — the name it was
// is often still sitting in the same category, unused.
function mergeTag(catId, fromId, toId) {
    const cat = getTagCategory(catId);
    if (!cat || fromId === toId) return;
    const to = (cat.tags || []).find(t => t.id === toId);
    if (!to) return;
    state.tasks.forEach(t => {
        const ids = taskTagIds(t);
        if (!ids.includes(fromId)) return;
        const next = ids.filter(x => x !== fromId);
        if (!next.includes(toId)) next.push(toId);
        t.tags = next;
        t.updatedAt = Date.now();
    });
    cat.tags = cat.tags.filter(t => t.id !== fromId);
    if (!cat.tags.some(t => t.recovered)) delete cat.recovered;
    activeTagFilter = activeTagFilter.filter(x => x !== fromId);
    state.tagsUpdatedAt = Date.now();
    saveState();
    renderAdmin();
}

// One row per recovered tag: the tasks carrying it, a box to name it, and a
// merge into whichever real tag it turns out to be.
function recoveredTagFixer(cat, tags) {
    const wrap = document.createElement('div');
    wrap.className = 'tag-fix';
    const head = document.createElement('div');
    head.className = 'tag-fix-head';
    head.textContent = tags.length + ' to sort out \u2014 named from the tasks still carrying them';
    wrap.appendChild(head);

    const targets = (cat.tags || []).filter(t => !t.recovered);
    tags.forEach(tag => {
        const row = document.createElement('div');
        row.className = 'tag-fix-row';

        const titles = tasksWithTag(tag.id).map(t => t.title);
        // A few examples are enough to recognise a tag; sixteen is a wall
        const SHOWN = 6;
        const shown = titles.slice(0, SHOWN);
        const on = document.createElement('div');
        on.className = 'tag-fix-on';
        on.innerHTML = `<span class="tag-fix-count">${titles.length}</span> ` +
            (titles.length ? shown.map(() => '<span class="tag-fix-task"></span>').join('') : '<em>no live tasks</em>') +
            (titles.length > SHOWN ? `<span class="tag-fix-more">+${titles.length - SHOWN} more</span>` : '');
        // set titles as text so nothing in a task name can be read as markup
        [...on.querySelectorAll('.tag-fix-task')].forEach((el, i) => { el.textContent = shown[i]; });
        if (titles.length) on.title = titles.join('\n');
        row.appendChild(on);

        const actions = document.createElement('div');
        actions.className = 'tag-fix-actions';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-input';
        input.placeholder = 'Name it\u2026';
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); renameTag(cat.id, tag.id, input.value); }
        });
        actions.appendChild(input);

        const save = document.createElement('button');
        save.className = 'btn-small';
        save.textContent = 'Rename';
        save.addEventListener('click', () => renameTag(cat.id, tag.id, input.value));
        actions.appendChild(save);

        if (targets.length) {
            const sel = document.createElement('select');
            sel.className = 'form-select form-select-sm';
            sel.innerHTML = '<option value="">Merge into\u2026</option>';
            [...targets].sort((a,b) => a.name.localeCompare(b.name)).forEach(t => {
                const o = document.createElement('option');
                o.value = t.id; o.textContent = t.name;
                sel.appendChild(o);
            });
            sel.addEventListener('change', () => {
                if (!sel.value) return;
                const to = targets.find(t => t.id === sel.value);
                if (confirm(`Move ${titles.length} task(s) onto "${to.name}" and drop this one?`)) {
                    mergeTag(cat.id, tag.id, sel.value);
                } else { sel.value = ''; }
            });
            actions.appendChild(sel);
        }

        row.appendChild(actions);
        wrap.appendChild(row);
    });
    return wrap;
}

function addTag(catId, name) {
    const cat = getTagCategory(catId);
    if (!cat) return;
    if (!cat.tags) cat.tags = [];
    if (cat.tags.some(t => t.name.toLowerCase() === name.toLowerCase())) return;
    cat.tags.push({ id: newTagId(catId), name });
    state.tagsUpdatedAt = Date.now();
    saveState();
    renderAdmin();
}

function deleteTag(catId, tagId) {
    const cat = getTagCategory(catId);
    if (!cat) return;
    const tag = cat.tags.find(t => t.id === tagId);
    const used = state.tasks.filter(t => taskTagIds(t).includes(tagId)).length;
    if (used && !confirm(`${used} task(s) are tagged "${tag ? tag.name : ''}". Delete the tag and take it off them?`)) return;
    cat.tags = cat.tags.filter(t => t.id !== tagId);
    // Strip it off the tasks too — a dangling tag id is invisible but would
    // linger in every export and sync payload
    state.tasks.forEach(t => {
        if (taskTagIds(t).includes(tagId)) {
            t.tags = t.tags.filter(x => x !== tagId);
            t.updatedAt = Date.now();
        }
    });
    activeTagFilter = activeTagFilter.filter(x => x !== tagId);
    state.tagsUpdatedAt = Date.now();
    saveState();
    renderAdmin();
}

// ---- Tag category modal ----

let editingTagCatId = null;

function openTagCatModal(catId) {
    editingTagCatId = catId;
    const cat = catId ? getTagCategory(catId) : null;
    document.getElementById('tagcat-title').textContent = cat ? 'Edit Category' : 'Add Category';
    document.getElementById('tagcat-delete').style.display = cat ? '' : 'none';
    document.getElementById('tagcat-name').value = cat ? cat.name : '';
    const color = cat ? cat.color : '#5856D6';
    document.getElementById('tagcat-color').value = color;
    document.getElementById('tagcat-color-hex').textContent = color;
    document.getElementById('tagcat-tags').value = cat ? (cat.tags || []).map(t => t.name).join('\n') : '';
    document.getElementById('tagcat-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('tagcat-name').focus(), 50);
}

function closeTagCatModal() {
    document.getElementById('tagcat-modal').style.display = 'none';
    editingTagCatId = null;
}

function stripTagsFromTasks(ids) {
    if (!ids.length) return;
    const gone = new Set(ids);
    state.tasks.forEach(t => {
        const kept = taskTagIds(t).filter(x => !gone.has(x));
        if (kept.length !== taskTagIds(t).length) { t.tags = kept; t.updatedAt = Date.now(); }
    });
    activeTagFilter = activeTagFilter.filter(x => !gone.has(x));
}

function saveTagCatModal() {
    const name = document.getElementById('tagcat-name').value.trim();
    if (!name) { document.getElementById('tagcat-name').focus(); return; }
    const color = document.getElementById('tagcat-color').value;
    const lines = document.getElementById('tagcat-tags').value
        .split('\n').map(x => x.trim()).filter(Boolean);

    let cat = editingTagCatId ? getTagCategory(editingTagCatId) : null;
    if (!cat) {
        cat = { id: name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + genId().slice(0,4), name, color, tags: [] };
        state.tagCategories.push(cat);
    } else {
        cat.name = name;
        cat.color = color;
    }

    // Reconcile the lines against the existing tags. Names that still match
    // keep their id (and so stay on their tasks). Whatever is left over on
    // each side is paired up in order, which is what makes renaming a line
    // a rename rather than a delete-plus-add.
    const existing = [...(cat.tags || [])];
    const takenNames = new Map(existing.map(t => [t.name.toLowerCase(), t]));
    const resolved = new Array(lines.length).fill(null);
    const usedIds = new Set();
    lines.forEach((line, i) => {
        const hit = takenNames.get(line.toLowerCase());
        if (hit && !usedIds.has(hit.id)) { resolved[i] = hit; usedIds.add(hit.id); }
    });
    const leftoverOld = existing.filter(t => !usedIds.has(t.id));
    lines.forEach((line, i) => {
        if (resolved[i]) return;
        const reuse = leftoverOld.shift();
        if (reuse) { reuse.name = line; resolved[i] = reuse; }
        else resolved[i] = { id: newTagId(cat.id), name: line };
    });
    stripTagsFromTasks(leftoverOld.map(t => t.id));
    cat.tags = resolved;

    state.tagsUpdatedAt = Date.now();
    saveState();
    closeTagCatModal();
    render();
}

function deleteTagCategory() {
    if (!editingTagCatId) return;
    const cat = getTagCategory(editingTagCatId);
    if (!cat) return;
    const ids = (cat.tags || []).map(t => t.id);
    const used = state.tasks.filter(t => taskTagIds(t).some(x => ids.includes(x))).length;
    if (!confirm(`Delete the "${cat.name}" category and its ${ids.length} tag(s)?` + (used ? ` ${used} task(s) will lose those tags.` : ''))) return;
    stripTagsFromTasks(ids);
    state.tagCategories = state.tagCategories.filter(c => c.id !== editingTagCatId);
    state.tagsUpdatedAt = Date.now();
    saveState();
    closeTagCatModal();
    render();
}

function renderAdminArchive(container) {
    container.innerHTML = '';
    const hdr = document.createElement('div');
    hdr.className = 'admin-section-header';
    hdr.innerHTML = '<h3>Archive</h3>';
    const archiveBtn = document.createElement('button');
    archiveBtn.className = 'btn-outline';
    archiveBtn.textContent = 'Archive completed now';
    archiveBtn.addEventListener('click', () => { archiveCompleted(); renderAdmin(); });
    hdr.appendChild(archiveBtn);
    container.appendChild(hdr);

    if (!state.archive.length) {
        container.innerHTML += '<div class="empty-state"><p>No archived tasks yet. Tasks in the Complete column are archived at week end.</p></div>';
        return;
    }
    [...state.archive].reverse().forEach(week => {
        const weekEl = document.createElement('div');
        weekEl.className = 'archive-week';
        const pts = week.tasks.reduce((s,t) => s+(SIZE_POINTS[t.size]||0),0);
        weekEl.innerHTML = `<div class="archive-week-header"><span class="archive-week-label">Week of ${formatDateFull(week.weekStart)}</span><span class="archive-week-stats">${week.tasks.length} tasks · ${pts} pts</span></div>`;
        const taskList = document.createElement('div');
        taskList.className = 'archive-task-list';
        week.tasks.forEach(t => {
            const ths = taskThemes(t);
            const tr = document.createElement('div');
            tr.className = 'archive-task-row';
            tr.innerHTML = `
                ${ths.map(th => `<span class="chip chip-theme" style="background:${th.color};color:${contrastText(th.color)}">${th.name}</span>`).join('')}
                <span style="flex:1">${t.title}</span>
                ${t.size ? `<span class="chip chip-size">${t.size.toUpperCase()}</span>` : ''}
                ${t.size ? `<span class="chip chip-size">${t.size.toUpperCase()}</span>` : ''}
            `;
            taskList.appendChild(tr);
        });
        weekEl.appendChild(taskList);
        container.appendChild(weekEl);
    });
}

function renderAdminData(container) {
    container.innerHTML = '';
    const hdr = document.createElement('div');
    hdr.className = 'admin-section-header';
    hdr.innerHTML = '<h3>Import / Export</h3>';
    container.appendChild(hdr);

    const wrap = document.createElement('div');
    wrap.className = 'data-actions';

    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn-ghost';
    exportBtn.textContent = 'Download JSON backup';
    exportBtn.addEventListener('click', exportData);

    const importLabel = document.createElement('label');
    importLabel.className = 'btn-ghost';
    importLabel.textContent = 'Import JSON backup';
    importLabel.style.display = 'block'; importLabel.style.cursor = 'pointer'; importLabel.style.textAlign='center';
    const importInput = document.createElement('input');
    importInput.type = 'file'; importInput.accept = '.json'; importInput.style.display = 'none';
    importInput.addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); });
    importLabel.appendChild(importInput);

    wrap.appendChild(exportBtn);
    wrap.appendChild(importLabel);
    container.appendChild(wrap);
}

// ============ ACTIONS ============

function createTask(data) {
    return {
        id: genId(),
        title: data.title || '',
        themeId: (data.themeIds && data.themeIds[0]) || data.themeId || '',
        themeIds: taskThemeIds(data),
        tags: [...taskTagIds(data)],
        subtasks: (data.subtasks || []).map(st => ({...st})),
        subTheme: data.subTheme || '',
        priority: data.priority || '',
        size: data.size || 'xs',
        kanbanColumn: data.kanbanColumn || null,
        status: data.status || 'active',
        dueDate: data.dueDate || '',
        countdown: data.countdown || false,
        doDate: data.doDate || '',
        notes: data.notes || '',
        createdDate: data.createdDate || todayStr(),
        completedDate: null,
        recurring: data.recurring || null,
        recurRoot: data.recurRoot || null,
        scheduledFor: data.scheduledFor || null,
        runCount: data.runCount || 0,
        spotlight: data.spotlight || false,
        planDay: data.planDay || null,
        planOrder: data.planOrder || 0,
        // Items captured straight to the list start unreviewed; anything
        // created already on the board counts as triaged
        reviewed: data.reviewed || !!data.kanbanColumn,
        updatedAt: Date.now(),
    };
}

function addTask(data) {
    const task = createTask(data);
    state.tasks.push(task);
    saveState();
    render();
    return task;
}

// Capture-by-URL: opening ?add=Buy%20milk (e.g. from an Apple Siri Shortcut)
// drops the item into the list unreviewed, then strips the param so a refresh
// won't add it again. Multiple items can be separated by newlines.
function handleAddParam() {
    const params = new URLSearchParams(location.search);
    const raw = params.get('add');
    if (!raw) return;
    const titles = raw.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
    titles.forEach(title => addTask({ title }));
    // Remove ?add= (and any other params) from the URL without reloading
    history.replaceState(null, '', location.pathname);
}

function updateTask(id, data) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    Object.assign(task, data);
    // Leaving Live (to the backlog, Blocked, a list, a snooze) takes the
    // task off whichever day it was planned for.
    if (task.planDay && task.kanbanColumn !== 'live' && task.status !== 'complete') { task.planDay = null; task.carriedFrom = null; }
    task.updatedAt = Date.now();
    saveState();
    render();
}

function deleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    state.deletedIds.push({ id, ts: Date.now() });
    saveState();
    render();
}

function completeTask(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    if (task.status === 'complete') {
        task.status = 'active';
        task.kanbanColumn = task._prevKanban || null;
        task.completedDate = null;
        delete task._prevKanban;
        // Reverse the scheduled next occurrence if it's still dormant,
        // taking the schedule back onto this task
        if (task.spawnedChildId) {
            const child = state.tasks.find(t => t.id === task.spawnedChildId);
            if (child && child.status === 'scheduled') {
                task.recurring = child.recurring || task.recurring;
                if (!task.recurRoot) task.recurRoot = child.recurRoot;
                deleteTask(child.id);
            }
            delete task.spawnedChildId;
        }
    } else {
        task._prevKanban = task.kanbanColumn;
        task.status = 'complete';
        task.kanbanColumn = 'complete';
        task.completedDate = todayStr();
        // Done counts on the day it was actually done, so Today's "Done" shows it
        if (task.planDay) task.planDay = task.completedDate;
        // Schedule the next occurrence for its recurrence date (it stays
        // dormant until then, then appears on the board), and clear the
        // schedule off this completed record
        if (task.recurring) {
            const nextDate = calcNextRecurring(task.recurring, todayStr());
            const child = scheduleOccurrence(task, nextDate, (task.runCount || 0) + 1);
            task.spawnedChildId = child.id;
            task.recurring = null;
        }
    }
    task.updatedAt = Date.now();
    saveState();
    render();
}

// Create (or reuse) a dormant "scheduled" occurrence of a recurring task. Its
// id is deterministic (chain root + date) so two devices scheduling the same
// occurrence collapse into one on sync.
function scheduleOccurrence(source, dateStr, runCount) {
    const root = source.recurRoot || source.id;
    const occId = root + '__' + dateStr;
    const existing = state.tasks.find(t => t.id === occId);
    if (existing) return existing;
    // Deliberately (re)creating this occurrence — drop any old tombstone so a
    // prior delete (e.g. from un-completing) can't wipe it on the next sync
    if (state.deletedIds) state.deletedIds = state.deletedIds.filter(x => x.id !== occId);
    const occ = createTask({
        title: source.title,
        themeId: source.themeId,
        themeIds: taskThemeIds(source),
        tags: [...taskTagIds(source)],
        // A fresh occurrence starts with its checklist unticked
        subtasks: (source.subtasks || []).map(st => ({ ...st, id: genId(), done: false })),
        subTheme: source.subTheme,
        priority: source.priority,
        size: source.size,
        notes: source.notes,
        recurring: source.recurring,
        recurRoot: root,
        status: 'scheduled',
        scheduledFor: dateStr,
        createdDate: dateStr,
        runCount: runCount || 0,
        reviewed: true,
    });
    occ.id = occId;
    state.tasks.push(occ);
    return occ;
}

function moveToColumn(id, col) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    const nowComplete = col === 'complete';
    const wasComplete = task.status === 'complete';
    // Dragging into Complete should complete the task (strikethrough,
    // completedDate, recurrence spawn) just like ticking it off.
    if (nowComplete && !wasComplete) { completeTask(id); return; }
    // Dragging a completed card back out un-completes it, then lands it in
    // the drop target column.
    if (!nowComplete && wasComplete) {
        completeTask(id); // flips status back to active
        updateTask(id, { kanbanColumn: col, reviewed: true, offKanban: false });
        return;
    }
    updateTask(id, { kanbanColumn: col, reviewed: true, offKanban: false });
}

function moveToKanban(id) {
    const task = state.tasks.find(t => t.id === id);
    updateTask(id, { kanbanColumn: defaultBacklogCol(taskThemeIds(task)), reviewed: true, offKanban: false, inNotes: false });
}

// Parked in Notes: off the board and out of Lists, but still right there.
// Marked reviewed so it can't come back through the review queue.
function moveToNotes(id) {
    updateTask(id, { inNotes: true, kanbanColumn: null, offKanban: false, reviewed: true });
}

function moveOutOfNotes(id) {
    updateTask(id, { inNotes: false });
}

// Taken off the board — lands in the "Off board" tier of its themed list
function backToList(id) {
    updateTask(id, { kanbanColumn: null, offKanban: true });
}

// Demote an off-board item all the way back into the normal themed list
function moveToThemedList(id) {
    updateTask(id, { kanbanColumn: null, offKanban: false });
}

function markWontDo(id) {
    updateTask(id, { status: 'wont-do', kanbanColumn: null, reviewed: true });
}

function toggleSpotlight(id) {
    const t = state.tasks.find(x => x.id === id);
    if (t) updateTask(id, { spotlight: !t.spotlight });
}

function markReviewed(id) {
    updateTask(id, { reviewed: true });
}

function archiveCompleted() {
    const completed = state.tasks.filter(t => t.kanbanColumn === 'complete' || (t.status === 'complete' && !t.kanbanColumn));
    if (!completed.length) return;
    const weekStart = getWeekStart(todayStr());
    const existing = state.archive.find(a => a.weekStart === weekStart);
    if (existing) {
        existing.tasks.push(...completed.map(t => ({...t})));
    } else {
        state.archive.push({ weekStart, tasks: completed.map(t => ({...t})) });
    }
    state.tasks = state.tasks.filter(t => t.kanbanColumn !== 'complete' || t.status !== 'complete');
    state.tasks = state.tasks.filter(t => !(t.status === 'complete' && !t.kanbanColumn));
    saveState();
    render();
}

function autoArchive() {
    const today = new Date();
    if (today.getDay() !== 1) return; // Only on Monday
    const lastArchive = state.archive.length ? state.archive[state.archive.length-1] : null;
    const thisWeek = getWeekStart(todayStr());
    if (lastArchive && lastArchive.weekStart === thisWeek) return;
    archiveCompleted();
}

// Activate any dormant recurrence whose date has arrived: it flips to an
// active task placed straight on the board backlog. Idempotent and safe to
// call repeatedly; deterministic occurrence ids stop cross-device duplicates.
function checkRecurring() {
    const today = todayStr();
    let changed = false;
    state.tasks.forEach(t => {
        if (t.status !== 'scheduled') return;
        if ((t.scheduledFor || '9999-99-99') <= today) {
            t.status = 'active';
            t.kanbanColumn = defaultBacklogCol(taskThemeIds(t));
            t.createdDate = t.scheduledFor || today;
            t.scheduledFor = null;
            t.reviewed = true;
            t.autoKanbaned = true;
            t.updatedAt = Date.now();
            changed = true;
        }
    });
    if (changed) saveState();
}

function checkAutoKanban() {
    const today = todayStr();
    let changed = false;
    state.tasks.forEach(t => {
        if (t.status !== 'active' || t.kanbanColumn || t.autoKanbaned || isSnoozed(t)) return;
        const doDue = t.doDate && t.doDate <= today;
        const deadlineNear = t.dueDate && addDays(t.dueDate, -3) <= today;
        if (doDue || deadlineNear) {
            t.kanbanColumn = defaultBacklogCol(taskThemeIds(t));
            t.autoKanbaned = true;
            t.updatedAt = Date.now();
            changed = true;
        }
    });
    if (changed) { saveState(); render(); }
}

// ============ TASK MODAL ============

function openTaskModal(taskId, defaultKanbanCol) {
    editingTaskId = taskId;
    const modal = document.getElementById('task-modal');
    document.getElementById('task-modal-title').textContent = taskId ? 'Edit Task' : 'New Task';
    document.getElementById('task-modal-delete').style.display = taskId ? '' : 'none';

    // Multi-add is only available for brand-new tasks; always reset to single
    document.getElementById('task-multi-toggle').checked = false;
    document.getElementById('multi-add-row').style.display = taskId ? 'none' : '';
    document.getElementById('task-title-multi').value = '';
    document.getElementById('task-title-multi').style.display = 'none';
    document.getElementById('task-title').style.display = '';

    // Reset fields
    modalThemeIds = [];
    modalSubTheme = '';
    modalTagIds = [];
    modalSubtasks = [];
    modalOpenSections = new Set();
    modalTagCatsOpen = new Set();
    modalPriority = '';
    modalSize = 'xs';
    modalKanbanCol = defaultKanbanCol || null;
    modalPlanDay = null;
    modalRecurType = 'daily';
    modalRecurDow = new Set();
    modalMonthlyMode = 'date';

    if (taskId) {
        const t = state.tasks.find(x => x.id === taskId);
        if (!t) return;
        document.getElementById('task-title').value = t.title;
        modalThemeIds = [...taskThemeIds(t)];
        modalSubTheme = t.subTheme || '';
        modalTagIds = [...taskTagIds(t)];
        modalSubtasks = (t.subtasks || []).map(st => ({...st}));
        modalPriority = t.priority || '';
        modalSize = t.size || 'xs';
        document.getElementById('task-due').value = t.dueDate || '';
        document.getElementById('task-countdown').checked = !!t.countdown;
        document.getElementById('task-do').value = t.doDate || '';
        document.getElementById('task-notes').value = t.notes || '';
        setNotesOpen(!!t.notes);
        document.getElementById('task-add-to-kanban').checked = !!t.kanbanColumn;
        const ri = !!t.recurring;
        document.getElementById('task-recurring-toggle').checked = ri;
        document.getElementById('recurring-config').style.display = ri ? '' : 'none';
        if (t.recurring) {
            modalRecurType = t.recurring.type || 'daily';
            if (t.recurring.type === 'weekly' && t.recurring.dayOfWeek !== undefined) {
                modalRecurDow = new Set([t.recurring.dayOfWeek]);
            }
            modalMonthlyMode = t.recurring.monthlyMode || 'date';
            document.getElementById('recur-daily-interval').value = t.recurring.interval || 1;
            document.getElementById('recur-weekly-interval').value = t.recurring.interval || 1;
            if (t.recurring.type === 'monthly') document.getElementById('recur-monthly-interval').value = t.recurring.interval || 1;
            document.getElementById('recur-monthly-day').value = t.recurring.dayOfMonth || 1;
            document.getElementById('recur-monthly-week').value = t.recurring.weekOfMonth || 1;
            document.getElementById('recur-monthly-dow').value = t.recurring.dayOfWeek || 1;
            document.querySelectorAll('input[name="monthly-mode"]').forEach(r => { r.checked = r.value === modalMonthlyMode; });
        }
        const inList = document.getElementById('task-in-list');
        const days = daysSince(t.createdDate);
        inList.textContent = `Added ${formatDateShort(t.createdDate)} · ${days === 0 ? 'in list since today' : days + ' day' + (days === 1 ? '' : 's') + ' in list'}`;
        inList.style.display = '';
    } else {
        document.getElementById('task-in-list').style.display = 'none';
        document.getElementById('task-title').value = '';
        document.getElementById('task-due').value = '';
        document.getElementById('task-countdown').checked = false;
        document.getElementById('task-do').value = '';
        document.getElementById('task-notes').value = '';
        setNotesOpen(false);
        document.getElementById('task-recurring-toggle').checked = false;
        document.getElementById('recurring-config').style.display = 'none';
        document.getElementById('task-add-to-kanban').checked = !!defaultKanbanCol;
        document.getElementById('recur-daily-interval').value = 1;
        document.getElementById('recur-weekly-interval').value = 1;
        document.getElementById('recur-monthly-interval').value = 1;
    }

    // A section with something in it starts open; the rest stay folded away
    if (taskId) {
        const t = state.tasks.find(x => x.id === taskId);
        if (modalTagIds.length) modalOpenSections.add('tags');
        if (modalPriority || (modalSize && modalSize !== 'xs')) modalOpenSections.add('priority');
        if (t.dueDate || t.doDate) modalOpenSections.add('dates');
        if (t.recurring) modalOpenSections.add('repeat');
        if (modalSubtasks.length) modalOpenSections.add('subtasks');
        if (t.notes) modalOpenSections.add('notes');
    }
    renderTaskSections();
    updateCountdownRow();
    renderThemePicker();
    renderTagPicker();
    renderSubtaskEditor();
    renderPriorityPicker();
    renderSizePicker();
    renderRecurTypeBtns();
    renderRecurOpts();
    renderDowPicker();
    updateSubThemeSelect();

    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('task-title').focus(), 50);
}

function closeTaskModal() {
    document.getElementById('task-modal').style.display = 'none';
    editingTaskId = null;
    // If we came here from the review modal, return to it to keep triaging
    if (reopenReviewAfterTask) {
        reopenReviewAfterTask = false;
        if (reviewQueue().length) openReviewModal();
    }
}

const TASK_SECTIONS = [
    ['tags', 'Tags'], ['priority', 'Priority'], ['dates', 'Dates'],
    ['repeat', 'Repeat'], ['subtasks', 'Sub-tasks'], ['notes', 'Notes'],
];

// Progressive disclosure: the title and themes are always there; every other
// section waits behind a "+" pill until it's wanted (or already has a value).
function renderTaskSections() {
    document.querySelectorAll('#task-modal [data-section]').forEach(el => {
        el.style.display = modalOpenSections.has(el.dataset.section) ? '' : 'none';
    });
    const bar = document.getElementById('task-more');
    bar.innerHTML = '';
    TASK_SECTIONS.forEach(([key, label]) => {
        if (modalOpenSections.has(key)) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'task-more-pill';
        b.textContent = '+ ' + label;
        b.addEventListener('click', () => openTaskSection(key));
        bar.appendChild(b);
    });
    bar.style.display = bar.childNodes.length ? '' : 'none';
}

function openTaskSection(key) {
    modalOpenSections.add(key);
    if (key === 'repeat') {
        document.getElementById('task-recurring-toggle').checked = true;
        document.getElementById('recurring-config').style.display = '';
    }
    if (key === 'notes') setNotesOpen(true);
    renderTaskSections();
    const focus = { notes: 'task-notes', subtasks: 'subtask-new-name' }[key];
    if (focus) document.getElementById(focus).focus({ preventScroll: true });
}

function renderTagPicker() {
    const container = document.getElementById('tag-picker');
    container.innerHTML = '';
    const cats = allTagCategories();
    if (!cats.length) {
        container.innerHTML = '<span class="form-hint">No tag categories yet &mdash; add one in Admin &rsaquo; Tags.</span>';
        return;
    }
    // Each category is folded to just its chosen tags until tapped open, so
    // a long People list doesn't swamp the modal
    const catToggle = (cat, open) => {
        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'tag-cat-label tag-cat-toggle';
        label.textContent = (open ? '▾ ' : '▸ ') + cat.name;
        label.addEventListener('click', () => {
            if (open) modalTagCatsOpen.delete(cat.id); else modalTagCatsOpen.add(cat.id);
            renderTagPicker();
        });
        return label;
    };
    // Folded categories with nothing chosen share one line at the bottom
    const folded = [];
    cats.forEach(cat => {
        const open = modalTagCatsOpen.has(cat.id);
        if (!open && !(cat.tags || []).some(t => modalTagIds.includes(t.id))) { folded.push(cat); return; }
        const row = document.createElement('div');
        row.className = 'tag-picker-row';
        row.appendChild(catToggle(cat, open));
        if (open && !(cat.tags || []).length) {
            const none = document.createElement('span');
            none.className = 'tag-cat-empty';
            none.textContent = 'none yet';
            row.appendChild(none);
        }
        [...(cat.tags || [])].sort((a,b) => a.name.localeCompare(b.name)).forEach(tag => {
            const on = modalTagIds.includes(tag.id);
            if (!open && !on) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tag-chip' + (on ? ' on' : '');
            btn.textContent = tag.name;
            btn.style.borderColor = cat.color;
            if (on) { btn.style.background = cat.color; btn.style.color = contrastText(cat.color); }
            else { btn.style.color = cat.color; }
            btn.addEventListener('click', () => {
                const i = modalTagIds.indexOf(tag.id);
                if (i === -1) modalTagIds.push(tag.id); else modalTagIds.splice(i, 1);
                renderTagPicker();
            });
            row.appendChild(btn);
        });
        container.appendChild(row);
    });
    if (folded.length) {
        const row = document.createElement('div');
        row.className = 'tag-picker-row tag-picker-folded';
        folded.forEach(cat => row.appendChild(catToggle(cat, false)));
        container.appendChild(row);
    }
}

// ---- Sub-task editor ----

function renderSubtaskEditor() {
    const list = document.getElementById('subtask-list');
    list.innerHTML = '';
    modalSubtasks.forEach((st, idx) => {
        const row = document.createElement('div');
        row.className = 'subtask-row' + (st.done ? ' done' : '');

        const check = document.createElement('div');
        check.className = 'list-check subtask-check' + (st.done ? ' checked' : '');
        check.addEventListener('click', () => {
            modalSubtasks[idx].done = !modalSubtasks[idx].done;
            renderSubtaskEditor();
        });
        row.appendChild(check);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'subtask-input';
        input.setAttribute('data-no-clear', '');   // the row already has its own ×
        input.value = st.title;
        input.addEventListener('input', () => { modalSubtasks[idx].title = input.value; });
        // Enter moves on to a new step rather than saving the whole task
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); document.getElementById('subtask-new-name').focus(); }
        });
        row.appendChild(input);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'icon-btn subtask-del';
        del.innerHTML = '&times;';
        del.title = 'Remove this step';
        del.addEventListener('click', () => { modalSubtasks.splice(idx, 1); renderSubtaskEditor(); });
        row.appendChild(del);

        list.appendChild(row);
    });

    const bar = document.getElementById('subtask-progress');
    if (modalSubtasks.length) {
        const done = modalSubtasks.filter(st => st.done).length;
        const pct = Math.round((done / modalSubtasks.length) * 100);
        bar.style.display = '';
        bar.innerHTML = `<span class="subtask-progress-bar"><span style="width:${pct}%"></span></span><span class="subtask-progress-text">${done}/${modalSubtasks.length} &middot; ${pct}%</span>`;
    } else {
        bar.style.display = 'none';
    }
}

function addSubtaskFromInput() {
    const input = document.getElementById('subtask-new-name');
    const title = input.value.trim();
    if (!title) return;
    modalSubtasks.push({ id: genId(), title, done: false });
    input.value = '';
    renderSubtaskEditor();
    input.focus();
}

function renderThemePicker() {
    const container = document.getElementById('theme-picker');
    container.innerHTML = '';
    [...state.themes].sort((a,b) => a.name.localeCompare(b.name)).forEach(theme => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-pick-btn' + (modalThemeIds.includes(theme.id) ? ' active' : '');
        btn.style.background = theme.color;
        btn.style.color = contrastText(theme.color);
        btn.textContent = theme.name + (theme.hidden ? ' 🕶' : '');
        btn.addEventListener('click', () => {
            // Each chip is an independent toggle, so Work + Jim is just two taps
            const i = modalThemeIds.indexOf(theme.id);
            if (i === -1) modalThemeIds.push(theme.id); else modalThemeIds.splice(i, 1);
            renderThemePicker();
            updateSubThemeSelect();
        });
        container.appendChild(btn);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'theme-pick-add';
    add.textContent = '+ New theme';
    add.title = 'Create a theme without leaving this task';
    add.addEventListener('click', () => openThemeModal(null, { fromTask: true }));
    container.appendChild(add);
}

function renderPriorityPicker() {
    const container = document.getElementById('priority-picker');
    container.innerHTML = '';
    PRIORITY_LEVELS.forEach(lv => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'group-btn' + (lv.value ? ' ' + lv.value : '')
            + (modalPriority === lv.value ? ' active' : '');
        btn.dataset.value = lv.value;
        btn.textContent = lv.label;
        btn.addEventListener('click', () => { modalPriority = lv.value; renderPriorityPicker(); });
        container.appendChild(btn);
    });
}

function renderSizePicker() {
    document.querySelectorAll('#size-picker .size-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === modalSize);
    });
}

// Notes start collapsed behind a button so the modal stays short; they open
// automatically when the task already has some.
function setNotesOpen(open) {
    document.getElementById('task-notes').style.display = open ? '' : 'none';
    document.getElementById('task-notes-add').style.display = open ? 'none' : '';
}

// The countdown option only makes sense once a "do by" date is set
function updateCountdownRow() {
    const has = !!document.getElementById('task-due').value;
    document.getElementById('countdown-row').style.display = has ? '' : 'none';
    if (!has) document.getElementById('task-countdown').checked = false;
}

function renderRecurTypeBtns() {
    document.querySelectorAll('.recur-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === modalRecurType);
    });
}

function renderRecurOpts() {
    document.getElementById('recur-daily').style.display  = modalRecurType === 'daily'   ? '' : 'none';
    document.getElementById('recur-weekly').style.display = modalRecurType === 'weekly'  ? '' : 'none';
    document.getElementById('recur-monthly').style.display= modalRecurType === 'monthly' ? '' : 'none';
}

function renderDowPicker() {
    document.querySelectorAll('.dow-btn').forEach(btn => {
        btn.classList.toggle('active', modalRecurDow.has(parseInt(btn.dataset.day)));
    });
}

function updateSubThemeSelect() {
    const sel = document.getElementById('task-subtheme');
    const themes = modalThemeIds.map(getTheme).filter(Boolean);
    sel.innerHTML = '<option value="">None</option>';
    const addOpt = (host, name) => {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        host.appendChild(opt);
    };
    const withSubs = themes.filter(t => (t.subThemes || []).length);
    if (withSubs.length === 1) {
        [...withSubs[0].subThemes].sort((a,b) => a.localeCompare(b)).forEach(n => addOpt(sel, n));
    } else {
        // Several themes in play: label each theme's sub-themes so identical
        // names (two "Maintenance"es) stay tellable apart
        withSubs.forEach(t => {
            const g = document.createElement('optgroup');
            g.label = t.name;
            [...t.subThemes].sort((a,b) => a.localeCompare(b)).forEach(n => addOpt(g, n));
            sel.appendChild(g);
        });
    }
    // The row is worth its space as soon as there's a theme to hang one off
    document.getElementById('subtheme-field').style.display = themes.length ? '' : 'none';
    // Drop a selection whose theme has just been untoggled
    if (modalSubTheme && !withSubs.some(t => (t.subThemes||[]).includes(modalSubTheme))) modalSubTheme = '';
    sel.value = modalSubTheme;
    if (!themes.length) hideNewSubTheme();
}

// Which theme a brand-new sub-theme should be filed under: unambiguous with
// one theme selected, otherwise the user picks.
function newSubThemeTargets() { return modalThemeIds.map(getTheme).filter(Boolean); }

function showNewSubTheme() {
    const targets = newSubThemeTargets();
    if (!targets.length) return;
    const picker = document.getElementById('subtheme-new-theme');
    picker.innerHTML = '';
    targets.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id; opt.textContent = t.name;
        picker.appendChild(opt);
    });
    picker.style.display = targets.length > 1 ? '' : 'none';
    document.getElementById('subtheme-new').style.display = '';
    const input = document.getElementById('subtheme-new-name');
    input.value = '';
    input.focus();
}

function hideNewSubTheme() {
    document.getElementById('subtheme-new').style.display = 'none';
    document.getElementById('subtheme-new-name').value = '';
}

function saveNewSubTheme() {
    const name = document.getElementById('subtheme-new-name').value.trim();
    const targets = newSubThemeTargets();
    if (!name || !targets.length) return;
    const theme = targets.length > 1
        ? (getTheme(document.getElementById('subtheme-new-theme').value) || targets[0])
        : targets[0];
    if (!theme.subThemes) theme.subThemes = [];
    if (!theme.subThemes.some(s => s.toLowerCase() === name.toLowerCase())) theme.subThemes.push(name);
    state.themesUpdatedAt = Date.now();
    saveState();
    modalSubTheme = theme.subThemes.find(s => s.toLowerCase() === name.toLowerCase()) || name;
    hideNewSubTheme();
    updateSubThemeSelect();
    if (currentView === 'admin') renderAdmin();
}

function getRecurringFromModal() {
    if (!document.getElementById('task-recurring-toggle').checked) return null;
    const type = modalRecurType;
    if (type === 'daily') {
        return { type:'daily', interval: parseInt(document.getElementById('recur-daily-interval').value)||1 };
    }
    if (type === 'weekly') {
        const dow = modalRecurDow.size ? [...modalRecurDow][0] : 1;
        return { type:'weekly', interval: parseInt(document.getElementById('recur-weekly-interval').value)||1, dayOfWeek: dow };
    }
    if (type === 'monthly') {
        const mode = document.querySelector('input[name="monthly-mode"]:checked')?.value || 'date';
        const interval = parseInt(document.getElementById('recur-monthly-interval').value) || 1;
        if (mode === 'date') {
            return { type:'monthly', interval, monthlyMode:'date', dayOfMonth: parseInt(document.getElementById('recur-monthly-day').value)||1 };
        } else {
            return { type:'monthly', interval, monthlyMode:'weekday', weekOfMonth: parseInt(document.getElementById('recur-monthly-week').value)||1, dayOfWeek: parseInt(document.getElementById('recur-monthly-dow').value)||1 };
        }
    }
    return null;
}

function saveTaskModal() {
    const multiMode = !editingTaskId && document.getElementById('task-multi-toggle').checked;
    const addToKanban = document.getElementById('task-add-to-kanban').checked;
    const shared = withThemeIds({
        tags: [...modalTagIds],
        subtasks: modalSubtasks.filter(st => st.title.trim()).map(st => ({...st, title: st.title.trim()})),
        subTheme: modalSubTheme,
        priority: modalPriority,
        size: modalSize,
        dueDate: document.getElementById('task-due').value,
        countdown: document.getElementById('task-countdown').checked,
        doDate: document.getElementById('task-do').value,
        notes: document.getElementById('task-notes').value.trim(),
        recurring: getRecurringFromModal(),
    }, modalThemeIds);

    if (multiMode) {
        const titles = document.getElementById('task-title-multi').value
            .split('\n').map(s => s.trim()).filter(Boolean);
        if (!titles.length) { document.getElementById('task-title-multi').focus(); return; }
        titles.forEach(title => addTask(withPlanDay({
            ...shared, title,
            kanbanColumn: addToKanban ? (modalKanbanCol || defaultBacklogCol(modalThemeIds)) : null,
        })));
        checkAutoKanban();
        closeTaskModal();
        return;
    }

    const title = document.getElementById('task-title').value.trim();
    if (!title) { document.getElementById('task-title').focus(); return; }
    const existingKanbanCol = editingTaskId
        ? (state.tasks.find(t => t.id === editingTaskId)?.kanbanColumn || null)
        : null;
    const data = {
        ...shared, title,
        // A task already on the board keeps the column it's in: editing one
        // (to add a theme, say) must not tip it back into the backlog.
        kanbanColumn: addToKanban
            ? (existingKanbanCol || modalKanbanCol || defaultBacklogCol(modalThemeIds))
            : (existingKanbanCol || null),
    };
    if (editingTaskId) {
        // Re-arm auto-kanban if the dates changed
        const existing = state.tasks.find(t=>t.id===editingTaskId);
        if (existing && (existing.doDate !== data.doDate || existing.dueDate !== data.dueDate)) {
            data.autoKanbaned = false;
        }
        if (data.recurring && existing && !existing.recurRoot) data.recurRoot = editingTaskId;
        updateTask(editingTaskId, data);
    } else if (data.recurring) {
        // New recurring task: schedule its first occurrence so it appears on
        // the board on its recurrence date (e.g. the coming 7th), rather than
        // sitting in the list from now
        const root = genId();
        const first = addToKanban ? todayStr() : nextOccurrenceOnOrAfter(data.recurring, todayStr());
        scheduleOccurrence({ ...data, recurRoot: root }, first, 1);
        saveState();
    } else {
        addTask(withPlanDay(data));
    }
    checkAutoKanban();
    checkRecurring();
    render();
    closeTaskModal();
}

// A new task made from Today lands on the day that was showing (if it's Live)
function withPlanDay(data) {
    if (!modalPlanDay || data.kanbanColumn !== 'live') return data;
    return { ...data, planDay: modalPlanDay, planOrder: nextPlanOrder(planTasks(modalPlanDay)) };
}

// ============ THEME MODAL ============

function openThemeModal(themeId, opts) {
    editingThemeId = themeId;
    themeModalFromTask = !!(opts && opts.fromTask);
    const modal = document.getElementById('theme-edit-modal');
    document.getElementById('theme-edit-title').textContent = themeId ? 'Edit Theme' : 'Add Theme';
    document.getElementById('theme-edit-delete').style.display = themeId ? '' : 'none';
    if (themeId) {
        const theme = getTheme(themeId);
        document.getElementById('theme-edit-name').value = theme.name;
        document.getElementById('theme-edit-color').value = theme.color;
        document.getElementById('theme-edit-color-hex').textContent = theme.color;
        document.getElementById('theme-edit-subthemes').value = (theme.subThemes||[]).join('\n');
        document.getElementById('theme-edit-hidden').checked = !!theme.hidden;
        document.getElementById('theme-edit-hide-weekend').checked = !!theme.hideWeekend;
        modalThemeFocus = themeFocus(theme);
    } else {
        document.getElementById('theme-edit-name').value = '';
        document.getElementById('theme-edit-color').value = '#007AFF';
        document.getElementById('theme-edit-color-hex').textContent = '#007AFF';
        document.getElementById('theme-edit-subthemes').value = '';
        document.getElementById('theme-edit-hidden').checked = false;
        document.getElementById('theme-edit-hide-weekend').checked = false;
        modalThemeFocus = 'home';
    }
    renderThemeFocusPicker();
    modal.style.display = 'flex';
}

function renderThemeFocusPicker() {
    document.querySelectorAll('#theme-focus-picker .group-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.value === modalThemeFocus);
    });
}

function closeThemeModal() {
    document.getElementById('theme-edit-modal').style.display = 'none';
    editingThemeId = null;
    themeModalFromTask = false;
}

function saveThemeModal() {
    const name = document.getElementById('theme-edit-name').value.trim();
    if (!name) return;
    const color = document.getElementById('theme-edit-color').value;
    const subThemes = document.getElementById('theme-edit-subthemes').value.split('\n').map(s=>s.trim()).filter(Boolean);
    const hidden = document.getElementById('theme-edit-hidden').checked;
    const hideWeekend = document.getElementById('theme-edit-hide-weekend').checked;
    let savedId = editingThemeId;
    if (editingThemeId) {
        const theme = getTheme(editingThemeId);
        if (theme) { theme.name = name; theme.color = color; theme.subThemes = subThemes; theme.hidden = hidden; theme.hideWeekend = hideWeekend; theme.focus = modalThemeFocus; }
    } else {
        savedId = name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + genId().slice(0,4);
        state.themes.push({ id: savedId, name, color, subThemes, hidden, hideWeekend, focus: modalThemeFocus });
    }
    state.themesUpdatedAt = Date.now();
    saveState();
    renderAdmin();
    // Opened from a task: hand the new theme straight back to it, selected,
    // rather than making the user find it again.
    const backToTask = themeModalFromTask;
    closeThemeModal();
    if (backToTask) {
        if (savedId && !modalThemeIds.includes(savedId)) modalThemeIds.push(savedId);
        renderThemePicker();
        updateSubThemeSelect();
        return;
    }
    render();
}

function deleteTheme() {
    if (!editingThemeId) return;
    const count = state.tasks.filter(t => taskThemeIds(t).includes(editingThemeId)).length;
    if (count && !confirm(`${count} task(s) use this theme. Delete anyway? (Tasks keep their data.)`)) return;
    state.themes = state.themes.filter(t => t.id !== editingThemeId);
    state.themesUpdatedAt = Date.now();
    saveState();
    renderAdmin();
    closeThemeModal();
}

// ============ CONTEXT MENU ============

function openContextMenu(e, taskId) {
    ctxTaskId = taskId;
    const task = state.tasks.find(t => t.id === taskId);
    const menu = document.getElementById('context-menu');
    const toKanban = menu.querySelector('[data-action="to-kanban"]');
    const moveTo = menu.querySelector('[data-action="move-to"]');
    const fromKanban = menu.querySelector('[data-action="from-kanban"]');
    const toList = menu.querySelector('[data-action="to-list"]');
    const offBoard = !task.kanbanColumn && task.offKanban;
    if (task.kanbanColumn) {
        toKanban.style.display = 'none';
        moveTo.style.display = '';
        fromKanban.style.display = '';
        toList.style.display = 'none';
    } else {
        toKanban.style.display = '';
        moveTo.style.display = 'none';
        fromKanban.style.display = 'none';
        toList.style.display = offBoard ? '' : 'none';
    }
    const parked = inNotes(task);
    menu.querySelector('[data-action="to-notes"]').style.display = parked ? 'none' : '';
    menu.querySelector('[data-action="from-notes"]').style.display = parked ? '' : 'none';
    menu.querySelector('[data-action="snooze"]').style.display = isSnoozed(task) ? 'none' : '';
    menu.querySelector('[data-action="unsnooze"]').style.display = isSnoozed(task) ? '' : 'none';
    menu.querySelector('[data-action="plan-today"]').style.display =
        (task.status === 'active' && !(task.kanbanColumn === 'live' && task.planDay === todayStr())) ? '' : 'none';
    menu.querySelector('[data-action="spotlight"]').style.display = task.spotlight ? 'none' : '';
    menu.querySelector('[data-action="unspotlight"]').style.display = task.spotlight ? '' : 'none';
    menu.style.display = 'block';
    let top = e.clientY + 4, left = e.clientX;
    if (left + 190 > window.innerWidth) left = window.innerWidth - 195;
    if (top + 200 > window.innerHeight) top = e.clientY - 204;
    menu.style.top = top + 'px'; menu.style.left = left + 'px';
}

function hideContextMenu() {
    document.getElementById('context-menu').style.display = 'none';
    ctxTaskId = null;
}

function snoozeTask(id, until) {
    updateTask(id, { snoozedUntil: until, kanbanColumn: null, reviewed: true });
}

function applySnooze(until) {
    (snoozeTargetIds || []).forEach(id => snoozeTask(id, until));
    // If this was a bulk snooze, exit bulk mode afterwards
    if (snoozeFromBulk) {
        bulkMode = false; selectedIds.clear();
        document.getElementById('bulk-select-btn').textContent = 'Select';
        document.getElementById('bulk-action-bar').style.display = 'none';
    }
    closeSnoozeModal();
    renderLists();
}

function closeSnoozeModal() {
    document.getElementById('snooze-modal').style.display = 'none';
    snoozeTargetIds = null;
    snoozeFromBulk = false;
}

function openSnoozeModal(taskIds, fromBulk) {
    snoozeTargetIds = Array.isArray(taskIds) ? taskIds : [taskIds];
    snoozeFromBulk = !!fromBulk;
    if (!snoozeTargetIds.length) return;
    document.querySelector('#snooze-modal .modal-header h3').textContent =
        snoozeTargetIds.length > 1 ? `Snooze ${snoozeTargetIds.length} tasks until…` : 'Snooze until…';
    const list = document.getElementById('snooze-options');
    list.innerHTML = '';
    const today = todayStr();
    [['Tomorrow', 1], ['3 days', 3], ['1 week', 7], ['2 weeks', 14], ['1 month', 30]].forEach(([label, days]) => {
        const until = addDays(today, days);
        const btn = document.createElement('button');
        btn.className = 'move-to-option';
        btn.innerHTML = `${label} <span class="snooze-date-hint">${formatDateShort(until)}</span>`;
        btn.addEventListener('click', () => applySnooze(until));
        list.appendChild(btn);
    });
    document.getElementById('snooze-date').value = '';
    document.getElementById('snooze-modal').style.display = 'flex';
}

function openMoveToModal(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const modal = document.getElementById('move-to-modal');
    const list = document.getElementById('move-to-list');
    list.innerHTML = '';
    boardColumns().forEach(col => {
        const btn = document.createElement('button');
        btn.className = 'move-to-option' + (task.kanbanColumn === col.id ? ' current' : '');
        btn.textContent = col.name;
        if (task.kanbanColumn === col.id) {
            btn.disabled = true;
            btn.textContent = col.name + ' (current)';
        }
        btn.addEventListener('click', () => {
            moveToColumn(taskId, col.id);
            modal.style.display = 'none';
        });
        list.appendChild(btn);
    });
    modal.style.display = 'flex';
}

// ============ DATA ============

function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'life-kanban-' + todayStr() + '.json';
    a.click(); URL.revokeObjectURL(url);
}

function importData(file) {
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const d = JSON.parse(e.target.result);
            if (d.tasks) { state = d; if(!state.archive)state.archive=[]; if(!state.settings)state.settings={theme:'light'}; saveState(); applyTheme(); render(); }
        } catch { alert('Invalid file'); }
    };
    reader.readAsText(file);
}

// ============ SETTINGS ============

function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.settings.theme || 'light');
}

// Switch the main view. Admin has no tab (it opens from Settings), so on
// Admin no tab is highlighted.
function showView(view) {
    currentView = view;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    if (view === 'lists') markListsVisited();
    syncQuickAddVisibility();
    window.scrollTo(0, 0);   // a new page opens at the top
    render();
}

// ============ INIT ============

function init() {
    applyTheme();
    autoArchive();
    checkRecurring();
    checkAutoKanban();
    handleAddParam();

    // View tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => showView(tab.dataset.view));
    });
    // Admin has no tab of its own any more: it opens from Settings
    document.querySelectorAll('[data-admin-open]').forEach(btn => {
        btn.addEventListener('click', () => {
            currentAdminTab = btn.dataset.adminOpen;
            document.getElementById('settings-modal').style.display = 'none';
            showView('admin');
        });
    });

    // Admin tabs
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentAdminTab = tab.dataset.admin;
            renderAdmin();
        });
    });

    // FAB
    document.getElementById('fab').addEventListener('click', () => {
        if (currentView !== 'today') return openTaskModal(null);
        openTaskModal(null, 'live');
        modalPlanDay = quickAddPlanTarget();
    });

    document.getElementById('ready-close').addEventListener('click', closeReadySheet);
    document.getElementById('ready-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeReadySheet(); });

    // Quick add — a title and nothing else, left unreviewed so it surfaces in
    // the review queue rather than silently joining the list.
    const doQuickAdd = () => {
        const input = document.getElementById('quick-add-input');
        const title = input.value.trim();
        if (!title) { input.focus(); return; }
        const target = quickAddPlanTarget();
        if (target === undefined) {
            addTask({ title, reviewed: false, kanbanColumn: null });
            reviewBannerDismissed = false;
        } else {
            addTask({ title, reviewed: true, kanbanColumn: 'live', planDay: target,
                planOrder: nextPlanOrder(target ? planTasks(target) : readyTasks()) });
        }
        input.value = '';
        render();
        const flash = document.getElementById('quick-add-flash');
        flash.textContent = target === undefined ? 'Added to Review' : 'Added';
        clearTimeout(quickAddFlashTimer);
        quickAddFlashTimer = setTimeout(() => { flash.textContent = ''; }, 2200);
        input.focus();
    };
    document.getElementById('quick-add-btn').addEventListener('click', doQuickAdd);
    document.getElementById('quick-add-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); doQuickAdd(); }
    });

    // Task modal
    document.getElementById('task-modal-save').addEventListener('click', saveTaskModal);
    document.getElementById('task-modal-cancel').addEventListener('click', closeTaskModal);
    document.getElementById('task-modal-close').addEventListener('click', closeTaskModal);
    document.getElementById('task-modal').addEventListener('click', e => { if(e.target===e.currentTarget) closeTaskModal(); });
    document.getElementById('task-modal-delete').addEventListener('click', () => {
        if (editingTaskId && confirm('Delete this task?')) { deleteTask(editingTaskId); closeTaskModal(); }
    });
    document.getElementById('task-title').addEventListener('keydown', e => { if(e.key==='Enter') saveTaskModal(); });

    // Multi-add toggle: swap single title input for a multi-line textarea
    document.getElementById('task-multi-toggle').addEventListener('change', e => {
        const multi = e.target.checked;
        const single = document.getElementById('task-title');
        const area = document.getElementById('task-title-multi');
        document.getElementById('task-modal-title').textContent = multi ? 'New Tasks' : 'New Task';
        single.style.display = multi ? 'none' : '';
        area.style.display = multi ? '' : 'none';
        if (multi) { if (single.value.trim()) area.value = single.value.trim() + '\n'; area.focus(); }
        else { single.focus(); }
    });

    // Priority picker
    // Priority options on the Lists filter come from the same list
    const prioSel = document.getElementById('list-filter-priority');
    PRIORITY_LEVELS.filter(lv => lv.value).slice().reverse().forEach(lv => {
        const opt = document.createElement('option');
        opt.value = lv.value; opt.textContent = lv.label;
        prioSel.appendChild(opt);
    });

    // Size picker
    document.querySelectorAll('#size-picker .size-btn').forEach(btn => {
        btn.addEventListener('click', () => { modalSize = btn.dataset.value; renderSizePicker(); });
    });

    // Recurring toggle
    document.getElementById('task-recurring-toggle').addEventListener('change', e => {
        document.getElementById('recurring-config').style.display = e.target.checked ? '' : 'none';
    });

    // "Do by" date drives whether the countdown option is offered
    document.getElementById('task-due').addEventListener('change', updateCountdownRow);
    document.getElementById('task-due').addEventListener('input', updateCountdownRow);

    document.getElementById('subtask-add-btn').addEventListener('click', addSubtaskFromInput);
    document.getElementById('subtask-new-name').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); addSubtaskFromInput(); }
    });

    // Sub-themes can be created here rather than over in Admin
    document.getElementById('subtheme-add-btn').addEventListener('click', showNewSubTheme);
    document.getElementById('subtheme-new-cancel').addEventListener('click', hideNewSubTheme);
    document.getElementById('subtheme-new-save').addEventListener('click', saveNewSubTheme);
    document.getElementById('subtheme-new-name').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); saveNewSubTheme(); }
        if (e.key === 'Escape') { e.preventDefault(); hideNewSubTheme(); }
    });
    document.getElementById('task-subtheme').addEventListener('change', e => { modalSubTheme = e.target.value; });

    // Notes stay collapsed until asked for
    document.getElementById('task-notes-add').addEventListener('click', () => {
        setNotesOpen(true);
        document.getElementById('task-notes').focus();
    });

    // Recurring type
    document.querySelectorAll('.recur-btn').forEach(btn => {
        btn.addEventListener('click', () => { modalRecurType = btn.dataset.type; renderRecurTypeBtns(); renderRecurOpts(); });
    });

    // Day of week picker
    document.querySelectorAll('.dow-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const day = parseInt(btn.dataset.day);
            if (modalRecurDow.has(day)) modalRecurDow.delete(day); else modalRecurDow.add(day);
            renderDowPicker();
        });
    });

    // Theme modal
    document.querySelectorAll('#theme-focus-picker .group-btn').forEach(btn => {
        btn.addEventListener('click', () => { modalThemeFocus = btn.dataset.value; renderThemeFocusPicker(); });
    });
    document.getElementById('theme-edit-save').addEventListener('click', saveThemeModal);
    document.getElementById('theme-edit-cancel').addEventListener('click', closeThemeModal);
    document.getElementById('theme-edit-close').addEventListener('click', closeThemeModal);
    document.getElementById('theme-edit-delete').addEventListener('click', deleteTheme);
    document.getElementById('theme-edit-modal').addEventListener('click', e => { if(e.target===e.currentTarget) closeThemeModal(); });
    document.getElementById('theme-edit-color').addEventListener('input', e => {
        document.getElementById('theme-edit-color-hex').textContent = e.target.value;
    });

    // Tag category modal
    document.getElementById('tagcat-save').addEventListener('click', saveTagCatModal);
    document.getElementById('tagcat-cancel').addEventListener('click', closeTagCatModal);
    document.getElementById('tagcat-close').addEventListener('click', closeTagCatModal);
    document.getElementById('tagcat-delete').addEventListener('click', deleteTagCategory);
    document.getElementById('tagcat-modal').addEventListener('click', e => { if(e.target===e.currentTarget) closeTagCatModal(); });
    document.getElementById('tagcat-color').addEventListener('input', e => {
        document.getElementById('tagcat-color-hex').textContent = e.target.value;
    });

    // Context menu
    document.getElementById('context-menu').addEventListener('click', e => {
        const action = e.target.dataset.action;
        if (!action || !ctxTaskId) return;
        if (action === 'edit') openTaskModal(ctxTaskId);
        else if (action === 'to-kanban') moveToKanban(ctxTaskId);
        else if (action === 'plan-today') planFor(ctxTaskId, todayStr());
        else if (action === 'move-to') { openMoveToModal(ctxTaskId); }
        else if (action === 'snooze') { openSnoozeModal(ctxTaskId); }
        else if (action === 'unsnooze') updateTask(ctxTaskId, { snoozedUntil: '' });
        else if (action === 'spotlight' || action === 'unspotlight') toggleSpotlight(ctxTaskId);
        else if (action === 'from-kanban') backToList(ctxTaskId);
        else if (action === 'to-list') moveToThemedList(ctxTaskId);
        else if (action === 'to-notes') moveToNotes(ctxTaskId);
        else if (action === 'from-notes') moveOutOfNotes(ctxTaskId);
        else if (action === 'complete') completeTask(ctxTaskId);
        else if (action === 'wont-do') markWontDo(ctxTaskId);
        else if (action === 'delete') { if(confirm('Delete this task?')) deleteTask(ctxTaskId); }
        hideContextMenu();
    });
    document.addEventListener('click', e => {
        if (!e.target.closest('.context-menu') && !e.target.closest('.list-item-menu') && !e.target.closest('.board-card-menu')) hideContextMenu();
    });

    // Filters
    document.getElementById('list-search').addEventListener('input', e => { currentFilters.search = e.target.value; renderLists(); });
    document.getElementById('list-filter-priority').addEventListener('change', e => { currentFilters.priority = e.target.value; renderLists(); });
    document.getElementById('list-filter-size').addEventListener('change', e => { currentFilters.size = e.target.value; renderLists(); });
    document.getElementById('list-filter-status').addEventListener('change', e => { currentFilters.status = e.target.value; renderLists(); });
    document.getElementById('list-filter-age').addEventListener('change', e => { currentFilters.age = e.target.value; renderLists(); });
    document.getElementById('list-sort').addEventListener('change', e => { currentSort = e.target.value; renderLists(); });

    // Bulk select
    document.getElementById('bulk-select-btn').addEventListener('click', () => {
        bulkMode = !bulkMode;
        selectedIds.clear();
        document.getElementById('bulk-select-btn').textContent = bulkMode ? 'Done' : 'Select';
        document.getElementById('bulk-action-bar').style.display = bulkMode ? 'flex' : 'none';
        renderLists();
    });
    document.getElementById('bulk-cancel').addEventListener('click', () => {
        bulkMode = false; selectedIds.clear();
        document.getElementById('bulk-select-btn').textContent = 'Select';
        document.getElementById('bulk-action-bar').style.display = 'none';
        renderLists();
    });
    document.getElementById('bulk-to-kanban').addEventListener('click', () => {
        selectedIds.forEach(id => moveToKanban(id));
        selectedIds.clear(); document.getElementById('bulk-count').textContent = '0 selected';
        renderLists();
    });
    document.getElementById('bulk-to-notes').addEventListener('click', () => {
        selectedIds.forEach(id => moveToNotes(id));
        selectedIds.clear(); document.getElementById('bulk-count').textContent = '0 selected';
        renderLists();
    });
    document.getElementById('bulk-from-kanban').addEventListener('click', () => {
        selectedIds.forEach(id => backToList(id));
        selectedIds.clear(); document.getElementById('bulk-count').textContent = '0 selected';
        renderLists();
    });
    document.getElementById('bulk-snooze').addEventListener('click', () => {
        if (!selectedIds.size) return;
        openSnoozeModal([...selectedIds], true);
    });

    // Settings
    document.getElementById('settings-btn').addEventListener('click', () => {
        document.getElementById('settings-dark').checked = state.settings.theme === 'dark';
        document.getElementById('settings-show-hidden').checked = !!state.settings.showHidden;
        document.getElementById('settings-reminder').checked = !!state.settings.reminderEnabled;
        document.getElementById('settings-reminder-time').value = state.settings.reminderTime || '09:00';
        document.getElementById('reminder-time-row').style.display = state.settings.reminderEnabled ? '' : 'none';
        document.getElementById('settings-modal').style.display = 'flex';
    });
    document.getElementById('settings-close').addEventListener('click', () => document.getElementById('settings-modal').style.display = 'none');
    document.getElementById('settings-modal').addEventListener('click', e => { if(e.target===e.currentTarget) e.currentTarget.style.display='none'; });
    document.getElementById('settings-dark').addEventListener('change', e => {
        state.settings.theme = e.target.checked ? 'dark' : 'light'; applyTheme(); saveState();
    });
    document.getElementById('settings-show-hidden').addEventListener('change', e => {
        state.settings.showHidden = e.target.checked; saveState(); render();
    });
    document.getElementById('settings-reminder').addEventListener('change', e => {
        state.settings.reminderEnabled = e.target.checked;
        document.getElementById('reminder-time-row').style.display = e.target.checked ? '' : 'none';
        saveState(); renderListReminder();
    });
    document.getElementById('settings-reminder-time').addEventListener('change', e => {
        if (e.target.value) { state.settings.reminderTime = e.target.value; saveState(); renderListReminder(); }
    });

    // --- Optional site password gate ---
    document.getElementById('settings-password').addEventListener('change', async e => {
        if (e.target.checked) {
            // Reveal the password entry; only enable once a password is saved.
            e.target.checked = false;
            document.getElementById('password-set-row').style.display = '';
            document.getElementById('settings-password-input').focus();
        } else {
            try {
                await apiUpdateSettings(false);
                refreshPasswordUI(false);
            } catch(err) { alert('Could not disable the lock: ' + err.message); e.target.checked = true; }
        }
    });
    document.getElementById('settings-password-save').addEventListener('click', async () => {
        const pw = document.getElementById('settings-password-input').value;
        if (!pw || pw.length < 4) { alert('Choose a password of at least 4 characters.'); return; }
        try {
            await apiUpdateSettings(true, pw);
            document.getElementById('settings-password-input').value = '';
            document.getElementById('password-set-row').style.display = 'none';
            refreshPasswordUI(true);
        } catch(err) { alert('Could not enable the lock: ' + err.message); }
    });
    document.getElementById('settings-password-logout').addEventListener('click', async () => {
        try { await fetch('/api/auth', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ action:'logout' }) }); } catch(_) {}
        location.reload();
    });

    // Password gate (unlock screen)
    const gateSubmit = document.getElementById('gate-submit');
    if (gateSubmit) {
        gateSubmit.addEventListener('click', unlockSite);
        document.getElementById('gate-password').addEventListener('keydown', e => { if (e.key === 'Enter') unlockSite(); });
    }

    // Reflect the current lock state when Settings opens.
    document.getElementById('settings-btn').addEventListener('click', loadPasswordSetting);

    // List review reminder banner (Board)
    document.getElementById('reminder-open').addEventListener('click', () => {
        [...document.querySelectorAll('.tab')].find(t => t.dataset.view === 'lists').click();
    });
    document.getElementById('reminder-snooze').addEventListener('click', () => {
        state.settings.reminderSnoozeUntil = Date.now() + 3600000;
        saveState(); renderListReminder();
    });
    document.getElementById('reminder-tomorrow').addEventListener('click', () => {
        state.settings.reminderSkipDate = todayStr();
        saveState(); renderListReminder();
    });
    // Surface the reminder while the app sits open on the Board (e.g. 9am
    // rolls around, or a snooze lapses), and activate any recurrence whose day
    // has arrived while the app was left open / backgrounded
    const periodicChecks = () => {
        checkRecurring(); checkAutoKanban(); renderListReminder();
        if (rollOverPlan()) { saveState(); render(); }
    };
    setInterval(periodicChecks, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { periodicChecks(); render(); } });

    // Move-to modal
    document.getElementById('move-to-close').addEventListener('click', () => document.getElementById('move-to-modal').style.display = 'none');
    document.getElementById('move-to-modal').addEventListener('click', e => { if(e.target===e.currentTarget) e.currentTarget.style.display='none'; });

    // Review modal
    // Keep remaining: everything still in the queue was reviewed, so mark it
    // reviewed (clearing the banner) and close. The X just closes.
    const keepRemaining = () => {
        reviewQueue().forEach(t => markReviewed(t.id));
        closeReviewModal();
    };
    document.getElementById('review-close').addEventListener('click', closeReviewModal);
    document.getElementById('review-done').addEventListener('click', keepRemaining);
    document.getElementById('review-modal').addEventListener('click', e => { if(e.target===e.currentTarget) closeReviewModal(); });

    // Filter modal (mobile)
    document.getElementById('open-filters').addEventListener('click', openFilterModal);
    document.getElementById('filter-modal-close').addEventListener('click', closeFilterModal);
    document.getElementById('filter-modal-done').addEventListener('click', closeFilterModal);
    document.getElementById('filter-modal').addEventListener('click', e => { if(e.target===e.currentTarget) closeFilterModal(); });
    document.getElementById('filter-modal-clear').addEventListener('click', clearListFilters);

    // Snooze modal
    document.getElementById('snooze-close').addEventListener('click', closeSnoozeModal);
    document.getElementById('snooze-modal').addEventListener('click', e => { if(e.target===e.currentTarget) closeSnoozeModal(); });
    document.getElementById('snooze-date').addEventListener('change', e => {
        const v = e.target.value;
        if (v && v > todayStr() && snoozeTargetIds && snoozeTargetIds.length) applySnooze(v);
    });

    // Escape key
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            // The theme modal can sit on top of the task modal; step back one
            // layer at a time rather than closing both at once.
            if (document.getElementById('theme-edit-modal').style.display === 'flex') {
                closeThemeModal();
                return;
            }
            if (document.getElementById('tagcat-modal').style.display === 'flex') {
                closeTagCatModal();
                return;
            }
            closeTaskModal(); closeThemeModal(); hideContextMenu(); closeSnoozeModal(); closeReviewModal();
            if (document.getElementById('filter-modal').style.display === 'flex') closeFilterModal();
            document.getElementById('settings-modal').style.display = 'none';
            document.getElementById('theme-edit-modal').style.display = 'none';
            document.getElementById('move-to-modal').style.display = 'none';
        }
    });

    // Quick-add via URL (?add=Task+title) — used by iOS Shortcuts / Siri
    const urlParams = new URLSearchParams(location.search);
    const quickAdd = urlParams.get('add');
    if (quickAdd && quickAdd.trim()) {
        addTask({ title: quickAdd.trim() });
        history.replaceState(null, '', location.pathname);
    }

    // Touch drag for kanban cards on mobile. A drag only begins after a
    // long press — otherwise every swipe would pick a card up instead of
    // scrolling the board sideways between columns.
    let touchDragId = null;
    let touchGhost = null;
    let touchStartX = 0, touchStartY = 0;
    let touchDragging = false;
    let touchArmed = false;      // long press completed: the card is grabbable
    let touchHoldTimer = null;
    const TOUCH_THRESHOLD = 10;
    const HOLD_MS = 350;

    // Holding a dragged card near either edge pages the board to the next
    // column, so you can reach a column that isn't on screen yet.
    let edgeTimer = null;
    let lastTouchX = 0, lastTouchY = 0;
    const EDGE_ZONE = 56;
    const EDGE_INTERVAL = 550;

    function dropZoneAt(x, y) {
        const el = document.elementFromPoint(x, y);
        return el && el.closest('.board-cards');
    }

    function highlightDropZone() {
        const zone = dropZoneAt(lastTouchX, lastTouchY);
        document.querySelectorAll('.board-cards').forEach(c => {
            c.classList.toggle('drag-over', c === zone);
        });
    }

    function cancelHold() {
        clearTimeout(touchHoldTimer);
        touchHoldTimer = null;
    }

    // scrollTo({behavior:'smooth'}) is unreliable here — mandatory snapping
    // cancels it outright — so the glide is animated by hand.
    let pageAnim = null;

    function pageBoard(dir) {
        const container = document.getElementById('board-columns');
        const col = container && container.querySelector('.board-col');
        if (!col) return;
        const gap = parseFloat(getComputedStyle(container).columnGap) || 0;
        const step = col.offsetWidth + gap;
        const max = container.scrollWidth - container.clientWidth;
        const from = container.scrollLeft;
        const to = Math.max(0, Math.min(max, from + dir * step));
        if (Math.abs(to - from) < 1) return;
        clearInterval(pageAnim);
        const t0 = Date.now();
        const DUR = 260;
        pageAnim = setInterval(() => {
            const p = Math.min(1, (Date.now() - t0) / DUR);
            const eased = 1 - Math.pow(1 - p, 3);
            container.scrollLeft = from + (to - from) * eased;
            if (p >= 1) { clearInterval(pageAnim); pageAnim = null; highlightDropZone(); }
        }, 16);
    }

    function startEdgeScroll() {
        if (edgeTimer) return;
        // Mandatory snapping cancels a programmatic smooth scroll outright,
        // so it has to come off while we're paging the board ourselves.
        const container = document.getElementById('board-columns');
        if (container) container.style.scrollSnapType = 'none';
        edgeTimer = setInterval(() => {
            const container = document.getElementById('board-columns');
            if (!container) return;
            const r = container.getBoundingClientRect();
            if (lastTouchX < r.left + EDGE_ZONE) pageBoard(-1);
            else if (lastTouchX > r.right - EDGE_ZONE) pageBoard(1);
        }, EDGE_INTERVAL);
    }

    function stopEdgeScroll() {
        clearInterval(edgeTimer);
        edgeTimer = null;
        clearInterval(pageAnim);
        pageAnim = null;
        const container = document.getElementById('board-columns');
        if (container) container.style.scrollSnapType = '';
    }

    document.addEventListener('touchstart', e => {
        const card = e.target.closest('.board-card');
        if (!card || !card.dataset.taskId) return;
        if (e.target.closest('.board-card-menu')) return;
        touchDragId = card.dataset.taskId;
        touchDragging = false;
        touchArmed = false;
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        cancelHold();
        touchHoldTimer = setTimeout(() => {
            touchArmed = true;
            card.classList.add('touch-armed');
            // Belt and braces for browsers that got a selection in first
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed) sel.removeAllRanges();
            if (navigator.vibrate) navigator.vibrate(10);
        }, HOLD_MS);
    }, { passive: true });

    document.addEventListener('touchmove', e => {
        if (!touchDragId) return;
        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - touchStartX);
        const dy = Math.abs(touch.clientY - touchStartY);
        if (!touchArmed) {
            // Moved before the hold completed — treat it as a scroll/swipe
            // and let the browser have the gesture.
            if (dx >= TOUCH_THRESHOLD || dy >= TOUCH_THRESHOLD) {
                cancelHold();
                clearTouchDrag();
            }
            return;
        }
        if (!touchDragging) {
            if (dx < TOUCH_THRESHOLD && dy < TOUCH_THRESHOLD) { e.preventDefault(); return; }
            touchDragging = true;
            const origCard = document.querySelector(`.board-card[data-task-id="${touchDragId}"]`);
            if (!origCard) return;
            touchGhost = origCard.cloneNode(true);
            touchGhost.classList.add('touch-dragging');
            touchGhost.style.setProperty('--drag-width', origCard.offsetWidth + 'px');
            touchGhost.style.width = origCard.offsetWidth + 'px';
            document.body.appendChild(touchGhost);
            origCard.style.opacity = '0.3';
            startEdgeScroll();
        }
        e.preventDefault();
        lastTouchX = touch.clientX;
        lastTouchY = touch.clientY;
        if (touchGhost) {
            touchGhost.style.left = (touch.clientX - 30) + 'px';
            touchGhost.style.top = (touch.clientY - 20) + 'px';
        }
        highlightDropZone();
    }, { passive: false });

    function clearTouchDrag() {
        stopEdgeScroll();
        if (touchGhost) { touchGhost.remove(); touchGhost = null; }
        if (touchDragId) {
            const origCard = document.querySelector(`.board-card[data-task-id="${touchDragId}"]`);
            if (origCard) { origCard.style.opacity = ''; origCard.classList.remove('touch-armed'); }
        }
        document.querySelectorAll('.board-cards').forEach(c => c.classList.remove('drag-over'));
        touchDragId = null;
        touchDragging = false;
        touchArmed = false;
    }

    document.addEventListener('touchend', e => {
        cancelHold();
        if (!touchDragId) return;
        if (touchDragging) {
            const touch = e.changedTouches[0];
            if (touchGhost) { touchGhost.remove(); touchGhost = null; }
            const dropZone = dropZoneAt(touch.clientX, touch.clientY);
            if (dropZone && dropZone.dataset.col) {
                moveToColumn(touchDragId, dropZone.dataset.col);
            }
        }
        clearTouchDrag();
    });

    document.addEventListener('touchcancel', () => { cancelHold(); clearTouchDrag(); });

    syncQuickAddVisibility();
    render();
}

// ============ CLOUDFLARE SYNC ============
// Sync goes through Pages Functions (browser -> /api/sync/:code -> D1). The
// merge logic below is unchanged from the Supabase version — only the transport
// (fetch instead of the Supabase client) is different. A 401 means the site's
// optional password gate is on and this device isn't authorised yet.

let syncEnabled = false;   // becomes true once the initial pull succeeds
let syncPaused = false;
let pushTimer = null;
const _baseSave = saveState;

async function apiGet(code) {
    const res = await fetch(`/api/sync/${encodeURIComponent(code)}`, { headers: { 'accept': 'application/json' } });
    if (res.status === 401) { showPasswordGate(); throw new Error('locked'); }
    if (!res.ok) throw new Error(`GET /api/sync ${res.status}`);
    const body = await res.json();
    return body.data; // parsed blob or null
}

async function apiPut(code, payload) {
    const res = await fetch(`/api/sync/${encodeURIComponent(code)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (res.status === 401) { showPasswordGate(); throw new Error('locked'); }
    if (!res.ok) throw new Error(`PUT /api/sync ${res.status}`);
    return res.json();
}

// --- Password gate helpers ---
function showPasswordGate() {
    const gate = document.getElementById('password-gate');
    if (gate) gate.style.display = 'flex';
}
async function unlockSite() {
    const input = document.getElementById('gate-password');
    const errEl = document.getElementById('gate-error');
    const pw = input ? input.value : '';
    try {
        const res = await fetch('/api/auth', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ password: pw }) });
        if (!res.ok) {
            if (errEl) { errEl.textContent = 'Incorrect password.'; errEl.style.display = ''; }
            return;
        }
        // Cookie set — reload so the gated data endpoints work and sync re-runs.
        location.reload();
    } catch(e) {
        if (errEl) { errEl.textContent = 'Could not reach the server.'; errEl.style.display = ''; }
    }
}
async function apiUpdateSettings(enabled, password) {
    const res = await fetch('/api/settings', {
        method:'PUT', headers:{'content-type':'application/json'},
        body: JSON.stringify({ password_enabled: enabled, password }),
    });
    if (!res.ok) { const b = await res.json().catch(()=>({})); throw new Error((b.error && b.error.message) || `HTTP ${res.status}`); }
    return res.json();
}
async function loadPasswordSetting() {
    try {
        const res = await fetch('/api/settings', { headers:{'accept':'application/json'} });
        const body = await res.json();
        refreshPasswordUI(!!body.password_enabled);
    } catch(_) { refreshPasswordUI(false); }
}
function refreshPasswordUI(enabled) {
    const toggle = document.getElementById('settings-password');
    if (toggle) toggle.checked = enabled;
    document.getElementById('password-set-row').style.display = 'none';
    const status = document.getElementById('password-status');
    if (status) {
        status.textContent = enabled ? 'This site is locked. A password is required on each device.' : '';
        status.style.display = enabled ? '' : 'none';
    }
    document.getElementById('password-logout-row').style.display = enabled ? '' : 'none';
}

saveState = function() {
    _baseSave();
    if (syncEnabled && !syncPaused) {
        clearTimeout(pushTimer);
        pushTimer = setTimeout(pushToCloud, 600);
    }
};

async function pushToCloud() {
    if (!syncEnabled || syncPaused) return;
    try {
        const payload = { tasks: state.tasks, themes: state.themes, archive: state.archive, completionLog: state.completionLog, deletedIds: state.deletedIds, themesUpdatedAt: state.themesUpdatedAt, tagCategories: state.tagCategories, tagsUpdatedAt: state.tagsUpdatedAt };
        await apiPut(SYNC_CODE, payload);
    } catch(e) { if (String(e).indexOf('locked') === -1) console.error('Sync push failed:', e); }
}

async function pullFromCloud() {
    if (!syncEnabled) return;
    try {
        const d = await apiGet(SYNC_CODE);
        if (!d) return;
        syncPaused = true;

        // --- Merge deletions (union, pruned after 60 days) ---
        const delMap = new Map();
        [...(state.deletedIds||[]), ...(d.deletedIds||[])].forEach(x => {
            const prev = delMap.get(x.id);
            if (!prev || x.ts > prev.ts) delMap.set(x.id, x);
        });
        const cutoff = Date.now() - 60*24*3600*1000;
        state.deletedIds = [...delMap.values()].filter(x => x.ts > cutoff);
        const delSet = new Set(state.deletedIds.map(x => x.id));

        // --- Detect whether local has anything the cloud lacks (decides if we push back) ---
        const remoteTasks = new Map((d.tasks||[]).map(t => [t.id, t]));
        let localContrib = false;
        (state.tasks||[]).forEach(t => {
            if (delSet.has(t.id)) return;
            const rt = remoteTasks.get(t.id);
            if (!rt || (t.updatedAt||0) > (rt.updatedAt||0)) localContrib = true;
        });
        (state.deletedIds||[]).forEach(x => {
            if (!(d.deletedIds||[]).some(r => r.id === x.id)) localContrib = true;
        });
        if ((state.themesUpdatedAt||0) > (d.themesUpdatedAt||0)) localContrib = true;
        if ((state.tagsUpdatedAt||0) > (d.tagsUpdatedAt||0)) localContrib = true;

        // --- Merge tasks: newest updatedAt wins per task ---
        const merged = new Map();
        (state.tasks||[]).forEach(t => merged.set(t.id, t));
        (d.tasks||[]).forEach(rt => {
            const lt = merged.get(rt.id);
            if (!lt || (rt.updatedAt||0) > (lt.updatedAt||0)) merged.set(rt.id, rt);
        });
        state.tasks = [...merged.values()].filter(t => !delSet.has(t.id));
        migrateColumns(state.tasks);

        // --- Themes: newest wholesale ---
        if ((d.themesUpdatedAt||0) > (state.themesUpdatedAt||0) && d.themes) {
            state.themes = d.themes;
            state.themesUpdatedAt = d.themesUpdatedAt;
            migrateThemes(state.themes);
        }

        // --- Tag categories: wholesale, newest wins — but seeded defaults
        // are not an edit. A device that has never touched its tags must take
        // whatever the cloud has, or it would push its defaults back over the
        // real thing the moment anything else got saved. ---
        if (d.tagCategories && ((d.tagsUpdatedAt||0) > (state.tagsUpdatedAt||0) || !state.tagsUpdatedAt)) {
            state.tagCategories = d.tagCategories;
            state.tagsUpdatedAt = d.tagsUpdatedAt || 0;
        }

        // --- Archive: merge weeks, union tasks within each week ---
        const weeks = new Map();
        (state.archive||[]).forEach(w => weeks.set(w.weekStart, w));
        (d.archive||[]).forEach(rw => {
            const lw = weeks.get(rw.weekStart);
            if (!lw) { weeks.set(rw.weekStart, rw); return; }
            const ids = new Set(lw.tasks.map(t => t.id));
            rw.tasks.forEach(t => { if (!ids.has(t.id)) lw.tasks.push(t); });
        });
        state.archive = [...weeks.values()].sort((a,b) => a.weekStart.localeCompare(b.weekStart));

        if (d.completionLog) state.completionLog = Object.assign({}, d.completionLog, state.completionLog);

        // localContrib was worked out before the merge, so a recovery has to
        // flag itself or the repaired categories would never leave this device
        if (recoverOrphanTags() + recoverOrphanThemes()) { markTagRecovery(); localContrib = true; }
        if (rollOverPlan()) localContrib = true;
        _baseSave();
        render();
        syncPaused = false;

        // Push merged state back only if local contributed something the cloud didn't have
        if (localContrib) pushToCloud();

        checkAutoKanban();
    } catch(e) { console.error('Sync pull:', e); syncPaused = false; }
}

// Inbox: external tools (e.g. an iOS Shortcuts automation bridging Apple
// Reminders) write pending task titles to a sibling sync row; we import
// them as tasks and clear the row.
async function checkInbox() {
    if (!syncEnabled) return;
    try {
        const inboxCode = SYNC_CODE + '-inbox';
        const d = await apiGet(inboxCode);
        if (!d) return;
        const pending = d.pending;
        let titles = [];
        if (Array.isArray(pending)) titles = pending;
        else if (typeof pending === 'string') titles = pending.split('\n');
        titles = titles.map(s => String(s).trim()).filter(Boolean);
        if (!titles.length) return;
        // Clear the inbox first so another device opening simultaneously
        // doesn't import the same batch
        await apiPut(inboxCode, { pending: '' });
        titles.forEach(title => addTask({ title }));
    } catch(e) { if (String(e).indexOf('locked') === -1) console.error('Inbox:', e); }
}

// Cloudflare has no Supabase-style realtime channel, so we poll instead: an
// interval plus the existing foreground/focus/online re-pulls keep devices fresh.
const SYNC_POLL_MS = 20000;

(function initSync() {
    // The first pull enables sync; if the site is locked it throws and the
    // password gate is shown — auth (unlockSite) re-runs this.
    syncEnabled = true;
    pullFromCloud().then(() => {
        checkInbox();
        setInterval(() => { if (!document.hidden) { pullFromCloud(); checkInbox(); } }, SYNC_POLL_MS);
    }).catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { pullFromCloud(); checkInbox(); } });
    window.addEventListener('focus', () => pullFromCloud());
    window.addEventListener('online', () => pullFromCloud());
})();

init();
})();

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(reg => {
        // When a new SW takes over, reload the page to get fresh files
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
        });
        // Check for updates every time the page loads
        reg.update();
    }).catch(() => {});
}
