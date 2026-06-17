/* =============================================
   Life Kanban — App v2
   ============================================= */
(function () {
'use strict';

// ============ CONSTANTS ============

const STORAGE_KEY = 'life-kanban-v2';
const SUPABASE_URL = 'https://gctcxgjvnaptywmhnmuf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjdGN4Z2p2bmFwdHl3bWhubXVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NzE3MTMsImV4cCI6MjA5NTM0NzcxM30.psusSSNMhV62XEj03Pje1TUIc25l46YAUnZgiHeFcvY';
const SYNC_CODE = 'mpy31l1nrkp69mpy31l1nihblx';

const KANBAN_COLS = [
    { id: 'backlog-day',     name: 'Day',         backlog: true },
    { id: 'backlog-evening', name: 'Evening',     backlog: true },
    { id: 'next',            name: 'Next' },
    { id: 'in-progress',     name: 'In Progress' },
    { id: 'ongoing',         name: 'Ongoing' },
    { id: 'blocked',         name: 'Blocked' },
    { id: 'complete',        name: 'Complete' },
];

const EVENING_HOUR = 17; // 5pm

function isEvening() { return new Date().getHours() >= EVENING_HOUR; }

// The default backlog for newly added items: the one that's "active" right
// now (Day during the day, Evening after 5pm).
function defaultBacklogCol() { return isEvening() ? 'backlog-evening' : 'backlog-day'; }

// Board column order. The two backlog columns swap so the time-relevant one
// always sits immediately left of "Next": Day during the day, Evening after 5pm.
function boardColumns() {
    const day = KANBAN_COLS.find(c => c.id === 'backlog-day');
    const evening = KANBAN_COLS.find(c => c.id === 'backlog-evening');
    const rest = KANBAN_COLS.filter(c => !c.backlog);
    const backlogs = isEvening() ? [day, evening] : [evening, day];
    return [...backlogs, ...rest];
}

const SIZE_POINTS = { xs:1, s:2, m:3, l:5, xl:8, xxl:13 };
const SIZE_ORDER   = { xs:0, s:1, m:2, l:3, xl:4, xxl:5 };
const PRIORITY_ORDER = { high:0, medium:1, low:2, '':3 };

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
let currentView = 'board';
let currentThemeTab = 'all';
let currentSort = 'priority';
let currentFilters = { priority:'', size:'', status:'active', search:'', age:'' };
let staleBannerDismissed = false;
let reviewBannerDismissed = false;
let currentAdminTab = 'themes';
let bulkMode = false;
let selectedIds = new Set();
let editingTaskId = null;
let editingThemeId = null;
let ctxTaskId = null;
let draggedId = null;
let boardThemeFilter = new Set();
let snoozedExpanded = new Set();
let snoozeTargetIds = null;
let snoozeFromBulk = false;

// Modal field state
let modalThemeId = '';
let modalPriority = '';
let modalSize = 'm';
let modalRecurType = 'daily';
let modalRecurDow = new Set();
let modalMonthlyMode = 'date';

function defaultState() {
    return {
        tasks: [],
        themes: DEFAULT_THEMES.map(t => ({...t, subThemes:[...t.subThemes]})),
        archive: [],
        completionLog: {},
        settings: { theme: 'light' },
        deletedIds: [],
        themesUpdatedAt: 0,
    };
}

// Legacy single "backlog" column was split into Day/Evening; map old tasks
// (and any arriving via sync from an un-updated device) onto the Day backlog.
// Also treat any task that predates the review feature as already reviewed so
// the review queue only surfaces genuinely new captures.
function migrateColumns(tasks) {
    (tasks || []).forEach(t => {
        if (t.kanbanColumn === 'backlog') t.kanbanColumn = 'backlog-day';
        if (t.reviewed === undefined) t.reviewed = true;
    });
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const p = JSON.parse(raw);
            if (!p.themes || !p.themes.length) p.themes = DEFAULT_THEMES.map(t=>({...t,subThemes:[...t.subThemes]}));
            if (!p.archive) p.archive = [];
            if (!p.completionLog) p.completionLog = {};
            if (!p.settings) p.settings = { theme:'light' };
            if (!p.deletedIds) p.deletedIds = [];
            if (!p.themesUpdatedAt) p.themesUpdatedAt = 0;
            migrateColumns(p.tasks);
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

function prioRank(t) {
    const v = PRIORITY_ORDER[t.priority];
    return v === undefined ? 3 : v;
}

// Spotlighted tasks outrank everything, ahead of even High priority
function spotRank(t) { return t.spotlight ? 0 : 1; }

// Active list captures not yet triaged onto the board (or explicitly kept)
function needsReview(t) {
    return t.status === 'active' && !t.kanbanColumn && !t.reviewed && !isSnoozed(t);
}

function isSnoozed(t) { return !!(t.snoozedUntil && t.snoozedUntil > todayStr()); }

const STALE_DAYS = 30;

function daysSince(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr + 'T00:00:00');
    return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function isWeekend() {
    const day = new Date().getDay();
    return day === 0 || day === 6;
}

// Active list items (not on board, not snoozed, not done) that have been
// sitting around longer than the stale threshold — candidates for snoozing.
function isStale(t) {
    if (t.status !== 'active' || t.kanbanColumn || isSnoozed(t)) return false;
    return daysSince(t.createdDate) >= STALE_DAYS;
}

// Themes hidden from the Board because it's the weekend and they're marked
// hide-on-weekend.
function weekendHiddenThemeIds() {
    if (!isWeekend()) return new Set();
    return new Set(state.themes.filter(t => t.hideWeekend).map(t => t.id));
}

function themeColor(id) { const t = getTheme(id); return t ? t.color : '#8e8e93'; }

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
            d.setMonth(d.getMonth() + (recurring.interval || 1));
            d.setDate(recurring.dayOfMonth || 1);
        } else {
            d.setMonth(d.getMonth() + (recurring.interval || 1));
            d.setDate(1);
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

// ============ RENDERING ============

function render() {
    if (currentView === 'lists') renderLists();
    else if (currentView === 'board') renderBoard();
    else if (currentView === 'admin') renderAdmin();
}

// ---- LISTS ----

function hiddenThemeIds() {
    if (state.settings.showHidden) return new Set();
    return new Set(state.themes.filter(t => t.hidden).map(t => t.id));
}

function renderLists() {
    const cur = getTheme(currentThemeTab);
    if (currentThemeTab !== 'all' && (!cur || (cur.hidden && !state.settings.showHidden))) currentThemeTab = 'all';
    renderReviewBanner();
    renderStaleBanner();
    renderThemeTabs();
    renderListContent();
}

function reviewQueue() {
    const hidden = hiddenThemeIds();
    return state.tasks.filter(t => !hidden.has(t.themeId) && needsReview(t));
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
        const row = document.createElement('div');
        row.className = 'review-row';

        const info = document.createElement('div');
        info.className = 'review-row-info';
        const title = document.createElement('div');
        title.className = 'review-row-title';
        title.textContent = task.title;
        title.addEventListener('click', () => { closeReviewModal(); openTaskModal(task.id); });
        info.appendChild(title);
        const meta = document.createElement('div');
        meta.className = 'review-row-meta';
        const theme = getTheme(task.themeId);
        if (theme) {
            const tc = document.createElement('span');
            tc.className = 'chip chip-theme';
            tc.style.background = theme.color;
            tc.textContent = theme.name;
            meta.appendChild(tc);
        }
        const age = document.createElement('span');
        age.className = 'review-row-age';
        const d = daysSince(task.createdDate);
        age.textContent = d <= 0 ? 'today' : d + 'd ago';
        meta.appendChild(age);
        info.appendChild(meta);
        row.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'review-row-actions';
        const toBoard = document.createElement('button');
        toBoard.className = 'btn-small';
        toBoard.textContent = '→ Board';
        toBoard.title = 'Add to Kanban backlog';
        toBoard.addEventListener('click', () => { moveToKanban(task.id); afterReviewAction(); });
        const keep = document.createElement('button');
        keep.className = 'btn-ghost review-keep-btn';
        keep.textContent = 'Keep';
        keep.title = 'Keep in list (mark reviewed)';
        keep.addEventListener('click', () => { markReviewed(task.id); afterReviewAction(); });
        actions.appendChild(toBoard);
        actions.appendChild(keep);
        row.appendChild(actions);
        list.appendChild(row);
    });
}

function afterReviewAction() {
    if (!reviewQueue().length) { closeReviewModal(); return; }
    renderReviewList();
}

function renderStaleBanner() {
    const banner = document.getElementById('stale-banner');
    const hidden = hiddenThemeIds();
    const stale = state.tasks.filter(t => !hidden.has(t.themeId) && isStale(t));
    if (!stale.length || staleBannerDismissed || currentFilters.age) {
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
        currentFilters.age = String(STALE_DAYS);
        document.getElementById('list-filter-age').value = String(STALE_DAYS);
        if (!bulkMode) document.getElementById('bulk-select-btn').click();
        renderLists();
    });
    const dismiss = document.createElement('button');
    dismiss.className = 'btn-ghost stale-banner-dismiss';
    dismiss.innerHTML = '&times;';
    dismiss.title = 'Dismiss';
    dismiss.addEventListener('click', () => { staleBannerDismissed = true; renderStaleBanner(); });
    actions.appendChild(review);
    actions.appendChild(dismiss);
    banner.appendChild(actions);
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
        if (currentThemeTab === theme.id) btn.style.background = theme.color;
        btn.addEventListener('click', () => { currentThemeTab = theme.id; renderLists(); });
        container.appendChild(btn);
    });
}

function getFilteredTasks() {
    const today = todayStr();
    const hidden = hiddenThemeIds();
    return state.tasks.filter(t => {
        if (hidden.has(t.themeId)) return false;
        if (currentFilters.status === 'active' && (t.status === 'complete' || t.status === 'wont-do')) return false;
        if (currentFilters.status === 'complete' && t.status !== 'complete') return false;
        if (currentFilters.priority && t.priority !== currentFilters.priority) return false;
        if (currentFilters.size && t.size !== currentFilters.size) return false;
        if (currentFilters.age && daysSince(t.createdDate) < parseInt(currentFilters.age)) return false;
        if (currentThemeTab !== 'all' && t.themeId !== currentThemeTab) return false;
        if (currentFilters.search) {
            const q = currentFilters.search.toLowerCase();
            if (!t.title.toLowerCase().includes(q) && !(t.subTheme||'').toLowerCase().includes(q)) return false;
        }
        return true;
    });
}

function sortTasks(tasks) {
    return [...tasks].sort((a, b) => {
        if (currentSort === 'priority') {
            const pd = prioRank(a) - prioRank(b);
            if (pd !== 0) return pd;
            return (a.title||'').localeCompare(b.title||'');
        }
        if (currentSort === 'size') return (SIZE_ORDER[b.size]||0) - (SIZE_ORDER[a.size]||0);
        if (currentSort === 'points') return (SIZE_POINTS[b.size]||0) - (SIZE_POINTS[a.size]||0);
        if (currentSort === 'date') return (b.createdDate||'').localeCompare(a.createdDate||'');
        return 0;
    });
}

function sortKanbanFirst(tasks) {
    const colIndex = {};
    boardColumns().forEach((c, i) => colIndex[c.id] = i);
    return [...tasks].sort((a, b) => {
        // Spotlight floats to the very top of its theme group
        const sd = spotRank(a) - spotRank(b);
        if (sd !== 0) return sd;
        const aOnBoard = a.kanbanColumn ? 0 : 1;
        const bOnBoard = b.kanbanColumn ? 0 : 1;
        if (aOnBoard !== bOnBoard) return aOnBoard - bOnBoard;
        if (aOnBoard === 0 && bOnBoard === 0) {
            const colDiff = (colIndex[a.kanbanColumn] ?? 99) - (colIndex[b.kanbanColumn] ?? 99);
            if (colDiff !== 0) return colDiff;
        }
        const pd = prioRank(a) - prioRank(b);
        if (pd !== 0) return pd;
        return (a.title || '').localeCompare(b.title || '');
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

    // Group by theme if "all" tab
    if (currentThemeTab === 'all') {
        const grouped = {};
        all.forEach(t => {
            const key = t.themeId || '__none__';
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

function createListItem(task) {
    const row = document.createElement('div');
    row.className = 'list-item';
    if (task.priority) row.classList.add('priority-' + task.priority);
    if (task.spotlight) row.classList.add('spotlight');
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
    body.addEventListener('click', () => openTaskModal(task.id));

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

    const theme = getTheme(task.themeId);
    if (theme) {
        const tc = document.createElement('span');
        tc.className = 'chip chip-theme';
        tc.style.background = theme.color;
        tc.textContent = theme.name;
        chips.appendChild(tc);
    }
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
        rc.textContent = '↻' + (task.runCount > 0 ? ' ×'+task.runCount : '');
        chips.appendChild(rc);
    }
    const today = todayStr();
    if (task.dueDate) {
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
    } else if (isStale(task)) {
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

    const menu = document.createElement('button');
    menu.className = 'list-item-menu';
    menu.innerHTML = '⋯';
    menu.addEventListener('click', e => { e.stopPropagation(); openContextMenu(e, task.id); });
    right.appendChild(menu);

    row.appendChild(right);
    return row;
}

// ---- BOARD ----

function renderBoardFilter() {
    const container = document.getElementById('board-filter');
    container.innerHTML = '';
    // Drop filters for themes that no longer exist, are hidden, or are
    // weekend-hidden right now
    const weekendHidden = weekendHiddenThemeIds();
    const visibleThemes = state.themes.filter(t => (!t.hidden || state.settings.showHidden) && !weekendHidden.has(t.id));
    const valid = new Set(visibleThemes.map(t => t.id));
    boardThemeFilter.forEach(id => { if (!valid.has(id)) boardThemeFilter.delete(id); });

    const allBtn = document.createElement('button');
    allBtn.className = 'theme-tab' + (boardThemeFilter.size === 0 ? ' active' : '');
    allBtn.textContent = 'All';
    if (boardThemeFilter.size === 0) allBtn.style.background = '#1d1d1f';
    allBtn.addEventListener('click', () => { boardThemeFilter.clear(); renderBoard(); });
    container.appendChild(allBtn);

    [...visibleThemes].sort((a,b) => a.name.localeCompare(b.name)).forEach(theme => {
        const btn = document.createElement('button');
        const active = boardThemeFilter.has(theme.id);
        btn.className = 'theme-tab' + (active ? ' active' : '');
        btn.textContent = theme.name;
        if (active) btn.style.background = theme.color;
        btn.addEventListener('click', () => {
            if (boardThemeFilter.has(theme.id)) boardThemeFilter.delete(theme.id);
            else boardThemeFilter.add(theme.id);
            renderBoard();
        });
        container.appendChild(btn);
    });
}

function renderBoard() {
    document.getElementById('board-stats').innerHTML = '';
    renderBoardFilter();
    const container = document.getElementById('board-columns');
    container.innerHTML = '';
    const weekStats = getWeekStats();
    const hidden = hiddenThemeIds();
    const weekendHidden = weekendHiddenThemeIds();

    boardColumns().forEach(col => {
        const tasks = state.tasks.filter(t =>
            t.kanbanColumn === col.id && t.status !== 'wont-do'
            && !hidden.has(t.themeId) && !weekendHidden.has(t.themeId)
            && (boardThemeFilter.size === 0 || boardThemeFilter.has(t.themeId)));
        const colEl = document.createElement('div');
        colEl.className = 'board-col';
        colEl.dataset.col = col.id;

        const header = document.createElement('div');
        header.className = 'board-col-header';
        if (col.id === 'complete') {
            const arrow = weekStats.delta === null ? '' : weekStats.delta > 0 ? ` ↑${Math.abs(weekStats.delta)}%` : weekStats.delta < 0 ? ` ↓${Math.abs(weekStats.delta)}%` : '';
            const cls = weekStats.delta === null ? '' : weekStats.delta > 0 ? 'col-stat-up' : weekStats.delta < 0 ? 'col-stat-down' : '';
            header.innerHTML = `
                <span class="board-col-name">${col.name}</span>
                <span class="board-col-count">${tasks.length}</span>
                <span class="col-week-stat ${cls}">${weekStats.count} this week${arrow}</span>
            `;
        } else {
            header.innerHTML = `<span class="board-col-name">${col.name}</span><span class="board-col-count">${tasks.length}</span>`;
        }
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
    const theme = getTheme(task.themeId);
    if (theme) {
        const tc = document.createElement('span');
        tc.className = 'chip chip-theme';
        tc.style.background = theme.color;
        tc.textContent = theme.name;
        footer.appendChild(tc);
    }
    if (task.size) {
        const sz = document.createElement('span');
        sz.className = 'chip chip-size';
        sz.textContent = task.size.toUpperCase();
        footer.appendChild(sz);
    }
    if (task.recurring) {
        const rc = document.createElement('span');
        rc.className = 'chip chip-recurring';
        rc.textContent = '↻' + (task.runCount > 0 ? ' ×'+task.runCount : '');
        footer.appendChild(rc);
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

// ---- ADMIN ----

function renderAdmin() {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.admin === currentAdminTab));
    const container = document.getElementById('admin-content');
    if (currentAdminTab === 'themes') renderAdminThemes(container);
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

    const list = document.createElement('div');
    list.className = 'theme-list';
    [...state.themes].sort((a,b) => a.name.localeCompare(b.name)).forEach(theme => {
        const row = document.createElement('div');
        row.className = 'theme-row';
        if (theme.hidden) row.classList.add('theme-row-hidden');
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
            const th = getTheme(t.themeId);
            const tr = document.createElement('div');
            tr.className = 'archive-task-row';
            tr.innerHTML = `
                ${th ? `<span class="chip chip-theme" style="background:${th.color}">${th.name}</span>` : ''}
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
        themeId: data.themeId || '',
        subTheme: data.subTheme || '',
        priority: data.priority || '',
        size: data.size || 'm',
        kanbanColumn: data.kanbanColumn || null,
        status: 'active',
        dueDate: data.dueDate || '',
        doDate: data.doDate || '',
        notes: data.notes || '',
        createdDate: todayStr(),
        completedDate: null,
        recurring: data.recurring || null,
        runCount: data.runCount || 0,
        spotlight: data.spotlight || false,
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

function updateTask(id, data) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    Object.assign(task, data);
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
        // Reverse the recurring spawn if its successor is still untouched
        if (task.spawnedChildId) {
            const child = state.tasks.find(t => t.id === task.spawnedChildId);
            if (child && child.status === 'active' && !child.kanbanColumn) deleteTask(child.id);
            delete task.spawnedChildId;
            task.recurringSpawned = false;
        }
    } else {
        task._prevKanban = task.kanbanColumn;
        task.status = 'complete';
        task.kanbanColumn = 'complete';
        task.completedDate = todayStr();
        // Spawn the next occurrence exactly once (guard against re-spawn on
        // every reload/sync, which is what duplicated recurring tasks before)
        if (task.recurring && !task.recurringSpawned) {
            const child = spawnRecurring(task);
            task.recurringSpawned = true;
            task.spawnedChildId = child.id;
        }
    }
    task.updatedAt = Date.now();
    saveState();
    render();
}

function spawnRecurring(completedTask) {
    const nextDate = calcNextRecurring(completedTask.recurring, todayStr());
    const newTask = createTask({
        ...completedTask,
        id: undefined,
        status: 'active',
        kanbanColumn: null,
        completedDate: null,
        createdDate: nextDate,
        doDate: '',
        runCount: (completedTask.runCount || 0) + 1,
    });
    newTask.createdDate = nextDate;
    newTask.recurringSpawned = false;
    delete newTask.spawnedChildId;
    state.tasks.push(newTask);
    return newTask;
}

function moveToColumn(id, col) {
    updateTask(id, { kanbanColumn: col, reviewed: true });
}

function moveToKanban(id) {
    updateTask(id, { kanbanColumn: defaultBacklogCol(), reviewed: true });
}

function backToList(id) {
    updateTask(id, { kanbanColumn: null });
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

function checkRecurring() {
    const today = todayStr();
    let changed = false;
    state.tasks.forEach(t => {
        // Only ever spawn once per completed recurring task — the guard is
        // what stops this catch-up pass from duplicating on every load/sync
        if (!t.recurring || t.status !== 'complete' || t.recurringSpawned) return;
        const next = calcNextRecurring(t.recurring, t.completedDate || today);
        if (next <= today) {
            const child = spawnRecurring(t);
            t.recurringSpawned = true;
            t.spawnedChildId = child.id;
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
            t.kanbanColumn = defaultBacklogCol();
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
    modalThemeId = '';
    modalPriority = '';
    modalSize = 'm';
    modalRecurType = 'daily';
    modalRecurDow = new Set();
    modalMonthlyMode = 'date';

    if (taskId) {
        const t = state.tasks.find(x => x.id === taskId);
        if (!t) return;
        document.getElementById('task-title').value = t.title;
        modalThemeId = t.themeId || '';
        modalPriority = t.priority || '';
        modalSize = t.size || 'm';
        document.getElementById('task-due').value = t.dueDate || '';
        document.getElementById('task-do').value = t.doDate || '';
        document.getElementById('task-notes').value = t.notes || '';
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
            document.getElementById('recur-monthly-day').value = t.recurring.dayOfMonth || 1;
            document.getElementById('recur-monthly-week').value = t.recurring.weekOfMonth || 1;
            document.getElementById('recur-monthly-dow').value = t.recurring.dayOfWeek || 1;
            document.querySelectorAll('input[name="monthly-mode"]').forEach(r => { r.checked = r.value === modalMonthlyMode; });
        }
    } else {
        document.getElementById('task-title').value = '';
        document.getElementById('task-due').value = '';
        document.getElementById('task-do').value = '';
        document.getElementById('task-notes').value = '';
        document.getElementById('task-recurring-toggle').checked = false;
        document.getElementById('recurring-config').style.display = 'none';
        document.getElementById('task-add-to-kanban').checked = !!defaultKanbanCol;
        document.getElementById('recur-daily-interval').value = 1;
        document.getElementById('recur-weekly-interval').value = 1;
    }

    renderThemePicker();
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
}

function renderThemePicker() {
    const container = document.getElementById('theme-picker');
    container.innerHTML = '';
    [...state.themes].sort((a,b) => a.name.localeCompare(b.name)).forEach(theme => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-pick-btn' + (modalThemeId === theme.id ? ' active' : '');
        btn.style.background = theme.color;
        btn.textContent = theme.name + (theme.hidden ? ' 🕶' : '');
        btn.addEventListener('click', () => {
            modalThemeId = theme.id;
            renderThemePicker();
            updateSubThemeSelect();
        });
        container.appendChild(btn);
    });
}

function renderPriorityPicker() {
    document.querySelectorAll('#priority-picker .group-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === modalPriority);
    });
}

function renderSizePicker() {
    document.querySelectorAll('#size-picker .size-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === modalSize);
    });
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
    const theme = getTheme(modalThemeId);
    sel.innerHTML = '<option value="">None</option>';
    if (theme && theme.subThemes) {
        [...theme.subThemes].sort((a,b) => a.localeCompare(b)).forEach(s => {
            const opt = document.createElement('option');
            opt.value = s; opt.textContent = s;
            sel.appendChild(opt);
        });
    }
    // Preserve existing selection if editing
    if (editingTaskId) {
        const t = state.tasks.find(x=>x.id===editingTaskId);
        if (t && t.subTheme) sel.value = t.subTheme;
    }
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
        if (mode === 'date') {
            return { type:'monthly', interval:1, monthlyMode:'date', dayOfMonth: parseInt(document.getElementById('recur-monthly-day').value)||1 };
        } else {
            return { type:'monthly', interval:1, monthlyMode:'weekday', weekOfMonth: parseInt(document.getElementById('recur-monthly-week').value)||1, dayOfWeek: parseInt(document.getElementById('recur-monthly-dow').value)||1 };
        }
    }
    return null;
}

function saveTaskModal() {
    const multiMode = !editingTaskId && document.getElementById('task-multi-toggle').checked;
    const addToKanban = document.getElementById('task-add-to-kanban').checked;
    const shared = {
        themeId: modalThemeId,
        subTheme: document.getElementById('task-subtheme').value,
        priority: modalPriority,
        size: modalSize,
        dueDate: document.getElementById('task-due').value,
        doDate: document.getElementById('task-do').value,
        notes: document.getElementById('task-notes').value.trim(),
        recurring: getRecurringFromModal(),
    };

    if (multiMode) {
        const titles = document.getElementById('task-title-multi').value
            .split('\n').map(s => s.trim()).filter(Boolean);
        if (!titles.length) { document.getElementById('task-title-multi').focus(); return; }
        titles.forEach(title => addTask({
            ...shared, title,
            kanbanColumn: addToKanban ? defaultBacklogCol() : null,
        }));
        checkAutoKanban();
        closeTaskModal();
        return;
    }

    const title = document.getElementById('task-title').value.trim();
    if (!title) { document.getElementById('task-title').focus(); return; }
    const data = {
        ...shared, title,
        kanbanColumn: addToKanban ? defaultBacklogCol() : (editingTaskId ? (state.tasks.find(t=>t.id===editingTaskId)?.kanbanColumn || null) : null),
    };
    if (editingTaskId) {
        // Re-arm auto-kanban if the dates changed
        const existing = state.tasks.find(t=>t.id===editingTaskId);
        if (existing && (existing.doDate !== data.doDate || existing.dueDate !== data.dueDate)) {
            data.autoKanbaned = false;
        }
        updateTask(editingTaskId, data);
    } else {
        addTask(data);
    }
    checkAutoKanban();
    closeTaskModal();
}

// ============ THEME MODAL ============

function openThemeModal(themeId) {
    editingThemeId = themeId;
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
    } else {
        document.getElementById('theme-edit-name').value = '';
        document.getElementById('theme-edit-color').value = '#007AFF';
        document.getElementById('theme-edit-color-hex').textContent = '#007AFF';
        document.getElementById('theme-edit-subthemes').value = '';
        document.getElementById('theme-edit-hidden').checked = false;
        document.getElementById('theme-edit-hide-weekend').checked = false;
    }
    modal.style.display = 'flex';
}

function closeThemeModal() {
    document.getElementById('theme-edit-modal').style.display = 'none';
    editingThemeId = null;
}

function saveThemeModal() {
    const name = document.getElementById('theme-edit-name').value.trim();
    if (!name) return;
    const color = document.getElementById('theme-edit-color').value;
    const subThemes = document.getElementById('theme-edit-subthemes').value.split('\n').map(s=>s.trim()).filter(Boolean);
    const hidden = document.getElementById('theme-edit-hidden').checked;
    const hideWeekend = document.getElementById('theme-edit-hide-weekend').checked;
    if (editingThemeId) {
        const theme = getTheme(editingThemeId);
        if (theme) { theme.name = name; theme.color = color; theme.subThemes = subThemes; theme.hidden = hidden; theme.hideWeekend = hideWeekend; }
    } else {
        const id = name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + genId().slice(0,4);
        state.themes.push({ id, name, color, subThemes, hidden, hideWeekend });
    }
    state.themesUpdatedAt = Date.now();
    saveState();
    renderAdmin();
    closeThemeModal();
}

function deleteTheme() {
    if (!editingThemeId) return;
    const count = state.tasks.filter(t => t.themeId === editingThemeId).length;
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
    if (task.kanbanColumn) {
        toKanban.style.display = 'none';
        moveTo.style.display = '';
        fromKanban.style.display = '';
    } else {
        toKanban.style.display = '';
        moveTo.style.display = 'none';
        fromKanban.style.display = 'none';
    }
    menu.querySelector('[data-action="snooze"]').style.display = isSnoozed(task) ? 'none' : '';
    menu.querySelector('[data-action="unsnooze"]').style.display = isSnoozed(task) ? '' : 'none';
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

// ============ INIT ============

function init() {
    applyTheme();
    autoArchive();
    checkRecurring();
    checkAutoKanban();

    // View tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
            tab.classList.add('active');
            currentView = tab.dataset.view;
            document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
            document.getElementById('view-'+currentView).classList.add('active');
            render();
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
    document.getElementById('fab').addEventListener('click', () => openTaskModal(null));

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
    document.querySelectorAll('#priority-picker .group-btn').forEach(btn => {
        btn.addEventListener('click', () => { modalPriority = btn.dataset.value; renderPriorityPicker(); });
    });

    // Size picker
    document.querySelectorAll('#size-picker .size-btn').forEach(btn => {
        btn.addEventListener('click', () => { modalSize = btn.dataset.value; renderSizePicker(); });
    });

    // Recurring toggle
    document.getElementById('task-recurring-toggle').addEventListener('change', e => {
        document.getElementById('recurring-config').style.display = e.target.checked ? '' : 'none';
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
    document.getElementById('theme-edit-save').addEventListener('click', saveThemeModal);
    document.getElementById('theme-edit-cancel').addEventListener('click', closeThemeModal);
    document.getElementById('theme-edit-close').addEventListener('click', closeThemeModal);
    document.getElementById('theme-edit-delete').addEventListener('click', deleteTheme);
    document.getElementById('theme-edit-modal').addEventListener('click', e => { if(e.target===e.currentTarget) closeThemeModal(); });
    document.getElementById('theme-edit-color').addEventListener('input', e => {
        document.getElementById('theme-edit-color-hex').textContent = e.target.value;
    });

    // Context menu
    document.getElementById('context-menu').addEventListener('click', e => {
        const action = e.target.dataset.action;
        if (!action || !ctxTaskId) return;
        if (action === 'edit') openTaskModal(ctxTaskId);
        else if (action === 'to-kanban') moveToKanban(ctxTaskId);
        else if (action === 'move-to') { openMoveToModal(ctxTaskId); }
        else if (action === 'snooze') { openSnoozeModal(ctxTaskId); }
        else if (action === 'unsnooze') updateTask(ctxTaskId, { snoozedUntil: '' });
        else if (action === 'spotlight' || action === 'unspotlight') toggleSpotlight(ctxTaskId);
        else if (action === 'from-kanban') backToList(ctxTaskId);
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

    // Move-to modal
    document.getElementById('move-to-close').addEventListener('click', () => document.getElementById('move-to-modal').style.display = 'none');
    document.getElementById('move-to-modal').addEventListener('click', e => { if(e.target===e.currentTarget) e.currentTarget.style.display='none'; });

    // Review modal
    document.getElementById('review-close').addEventListener('click', closeReviewModal);
    document.getElementById('review-done').addEventListener('click', closeReviewModal);
    document.getElementById('review-modal').addEventListener('click', e => { if(e.target===e.currentTarget) closeReviewModal(); });
    document.getElementById('review-keep-all').addEventListener('click', () => {
        reviewQueue().forEach(t => markReviewed(t.id));
        closeReviewModal();
    });

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
            closeTaskModal(); closeThemeModal(); hideContextMenu(); closeSnoozeModal(); closeReviewModal();
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

    // Touch drag for kanban cards on mobile
    let touchDragId = null;
    let touchGhost = null;
    let touchStartX = 0, touchStartY = 0;
    let touchDragging = false;
    const TOUCH_THRESHOLD = 10;

    document.addEventListener('touchstart', e => {
        const card = e.target.closest('.board-card');
        if (!card || !card.dataset.taskId) return;
        touchDragId = card.dataset.taskId;
        touchDragging = false;
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
    }, { passive: true });

    document.addEventListener('touchmove', e => {
        if (!touchDragId) return;
        const touch = e.touches[0];
        if (!touchDragging) {
            const dx = Math.abs(touch.clientX - touchStartX);
            const dy = Math.abs(touch.clientY - touchStartY);
            if (dx < TOUCH_THRESHOLD && dy < TOUCH_THRESHOLD) return;
            touchDragging = true;
            const origCard = document.querySelector(`.board-card[data-task-id="${touchDragId}"]`);
            if (!origCard) return;
            touchGhost = origCard.cloneNode(true);
            touchGhost.classList.add('touch-dragging');
            touchGhost.style.setProperty('--drag-width', origCard.offsetWidth + 'px');
            touchGhost.style.width = origCard.offsetWidth + 'px';
            document.body.appendChild(touchGhost);
            origCard.style.opacity = '0.3';
        }
        e.preventDefault();
        if (touchGhost) {
            touchGhost.style.left = (touch.clientX - 30) + 'px';
            touchGhost.style.top = (touch.clientY - 20) + 'px';
        }
        document.querySelectorAll('.board-cards').forEach(c => c.classList.remove('drag-over'));
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const dropZone = el && el.closest('.board-cards');
        if (dropZone) dropZone.classList.add('drag-over');
    }, { passive: false });

    document.addEventListener('touchend', e => {
        if (!touchDragId) return;
        if (touchDragging) {
            const touch = e.changedTouches[0];
            if (touchGhost) { touchGhost.remove(); touchGhost = null; }
            const origCard = document.querySelector(`.board-card[data-task-id="${touchDragId}"]`);
            if (origCard) origCard.style.opacity = '';
            document.querySelectorAll('.board-cards').forEach(c => c.classList.remove('drag-over'));
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            const dropZone = el && el.closest('.board-cards');
            if (dropZone && dropZone.dataset.col) {
                moveToColumn(touchDragId, dropZone.dataset.col);
            }
        }
        touchDragId = null;
        touchDragging = false;
    });

    render();
}

// ============ SUPABASE SYNC ============

let supabaseClient = null;
let syncChannel = null;
let syncPaused = false;
let pushTimer = null;
const _baseSave = saveState;

saveState = function() {
    _baseSave();
    if (supabaseClient && !syncPaused) {
        clearTimeout(pushTimer);
        pushTimer = setTimeout(pushToCloud, 600);
    }
};

async function pushToCloud() {
    if (!supabaseClient || syncPaused) return;
    try {
        const payload = { tasks: state.tasks, themes: state.themes, archive: state.archive, completionLog: state.completionLog, deletedIds: state.deletedIds, themesUpdatedAt: state.themesUpdatedAt };
        const { error } = await supabaseClient.from('kanban_sync').upsert({ sync_code: SYNC_CODE, data: payload, updated_at: new Date().toISOString() });
        if (error) console.error('Sync push:', error.message);
    } catch(e) { console.error('Sync push failed:', e); }
}

async function pullFromCloud() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient.from('kanban_sync').select('data').eq('sync_code', SYNC_CODE).maybeSingle();
        if (error || !data) return;
        const d = data.data;
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
    if (!supabaseClient) return;
    try {
        const inboxCode = SYNC_CODE + '-inbox';
        const { data, error } = await supabaseClient.from('kanban_sync').select('data').eq('sync_code', inboxCode).maybeSingle();
        if (error || !data || !data.data) return;
        const pending = data.data.pending;
        let titles = [];
        if (Array.isArray(pending)) titles = pending;
        else if (typeof pending === 'string') titles = pending.split('\n');
        titles = titles.map(s => String(s).trim()).filter(Boolean);
        if (!titles.length) return;
        // Clear the inbox first so another device opening simultaneously
        // doesn't import the same batch
        await supabaseClient.from('kanban_sync').upsert({ sync_code: inboxCode, data: { pending: '' }, updated_at: new Date().toISOString() });
        titles.forEach(title => addTask({ title }));
    } catch(e) { console.error('Inbox:', e); }
}

(function initSync() {
    if (!window.supabase) return;
    try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        pullFromCloud().then(() => {
            checkInbox();
            syncChannel = supabaseClient.channel('kanban-rt')
                .on('postgres_changes', { event:'*', schema:'public', table:'kanban_sync', filter:`sync_code=eq.${SYNC_CODE}` }, () => pullFromCloud())
                .subscribe();
        });
        // Re-pull whenever the app comes back to the foreground (PWAs lose the
        // realtime connection while backgrounded, which is why devices went stale)
        document.addEventListener('visibilitychange', () => { if (!document.hidden) { pullFromCloud(); checkInbox(); } });
        window.addEventListener('focus', () => pullFromCloud());
        window.addEventListener('online', () => pullFromCloud());
    } catch(e) { console.error('Sync init:', e); }
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
