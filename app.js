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
    { id: 'backlog',     name: 'Backlog' },
    { id: 'next',        name: 'Next' },
    { id: 'in-progress', name: 'In Progress' },
    { id: 'ongoing',     name: 'Ongoing' },
    { id: 'blocked',     name: 'Blocked' },
    { id: 'complete',    name: 'Complete' },
];

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
let currentFilters = { priority:'', size:'', status:'active', search:'' };
let currentAdminTab = 'themes';
let bulkMode = false;
let selectedIds = new Set();
let editingTaskId = null;
let editingThemeId = null;
let ctxTaskId = null;
let draggedId = null;

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
    };
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

function renderLists() {
    renderThemeTabs();
    renderListContent();
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

    state.themes.forEach(theme => {
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
    return state.tasks.filter(t => {
        if (currentFilters.status === 'active' && (t.status === 'complete' || t.status === 'wont-do')) return false;
        if (currentFilters.status === 'complete' && t.status !== 'complete') return false;
        if (currentFilters.priority && t.priority !== currentFilters.priority) return false;
        if (currentFilters.size && t.size !== currentFilters.size) return false;
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
            const pd = (PRIORITY_ORDER[a.priority]||3) - (PRIORITY_ORDER[b.priority]||3);
            if (pd !== 0) return pd;
            return (a.title||'').localeCompare(b.title||'');
        }
        if (currentSort === 'size') return (SIZE_ORDER[b.size]||0) - (SIZE_ORDER[a.size]||0);
        if (currentSort === 'points') return (SIZE_POINTS[b.size]||0) - (SIZE_POINTS[a.size]||0);
        if (currentSort === 'date') return (b.createdDate||'').localeCompare(a.createdDate||'');
        return 0;
    });
}

function renderListContent() {
    const container = document.getElementById('lists-content');
    container.innerHTML = '';
    const tasks = sortTasks(getFilteredTasks());

    if (!tasks.length) {
        container.innerHTML = '<div class="empty-state"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg><p>No tasks here yet</p></div>';
        return;
    }

    // Group by theme if "all" tab
    if (currentThemeTab === 'all') {
        const grouped = {};
        tasks.forEach(t => {
            const key = t.themeId || '__none__';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(t);
        });
        const themeOrder = state.themes.map(th => th.id);
        themeOrder.push('__none__');
        themeOrder.forEach(tid => {
            if (!grouped[tid] || !grouped[tid].length) return;
            const theme = getTheme(tid);
            const label = document.createElement('div');
            label.className = 'list-group-label';
            label.textContent = theme ? theme.name : 'No Theme';
            container.appendChild(label);
            grouped[tid].forEach(t => container.appendChild(createListItem(t)));
        });
    } else {
        tasks.forEach(t => container.appendChild(createListItem(t)));
    }
}

function createListItem(task) {
    const row = document.createElement('div');
    row.className = 'list-item';
    if (task.priority) row.classList.add('priority-' + task.priority);
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
    title.textContent = task.title;
    body.appendChild(title);

    const chips = document.createElement('div');
    chips.className = 'list-item-chips';

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
    if (task.kanbanColumn) {
        const kb = document.createElement('span');
        kb.className = 'chip chip-kanban';
        kb.textContent = '⊞ ' + (KANBAN_COLS.find(c=>c.id===task.kanbanColumn)||{name:task.kanbanColumn}).name;
        chips.appendChild(kb);
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
    body.appendChild(chips);
    row.appendChild(body);

    // Date
    const dateEl = document.createElement('span');
    dateEl.className = 'list-item-date';
    dateEl.textContent = formatDateShort(task.createdDate);
    row.appendChild(dateEl);

    // 3-dot menu
    const menu = document.createElement('button');
    menu.className = 'list-item-menu';
    menu.innerHTML = '⋯';
    menu.addEventListener('click', e => { e.stopPropagation(); openContextMenu(e, task.id); });
    row.appendChild(menu);

    return row;
}

// ---- BOARD ----

function renderBoard() {
    document.getElementById('board-stats').innerHTML = '';
    const container = document.getElementById('board-columns');
    container.innerHTML = '';
    const weekStats = getWeekStats();

    KANBAN_COLS.forEach(col => {
        const tasks = state.tasks.filter(t => t.kanbanColumn === col.id && t.status !== 'wont-do');
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
            .sort((a,b) => (PRIORITY_ORDER[a.priority]||3) - (PRIORITY_ORDER[b.priority]||3))
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
    card.draggable = true;
    card.dataset.taskId = task.id;
    card.addEventListener('dragstart', e => { draggedId = task.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('click', () => openTaskModal(task.id));

    if (task.priority) {
        const bar = document.createElement('div');
        bar.className = 'board-card-priority ' + task.priority;
        card.appendChild(bar);
    }
    const title = document.createElement('div');
    title.className = 'board-card-title';
    title.textContent = task.title;
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
    state.themes.forEach(theme => {
        const row = document.createElement('div');
        row.className = 'theme-row';
        const swatch = document.createElement('div');
        swatch.className = 'theme-swatch';
        swatch.style.background = theme.color;
        const info = document.createElement('div');
        info.style.flex = '1';
        info.innerHTML = `<div class="theme-row-name">${theme.name}</div><div class="theme-row-subs">${(theme.subThemes||[]).join(', ') || 'No sub-themes'}</div>`;
        const actions = document.createElement('div');
        actions.className = 'theme-row-actions';
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
        notes: data.notes || '',
        createdDate: todayStr(),
        completedDate: null,
        recurring: data.recurring || null,
        runCount: data.runCount || 0,
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
    saveState();
    render();
}

function deleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
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
    } else {
        task._prevKanban = task.kanbanColumn;
        task.status = 'complete';
        task.kanbanColumn = 'complete';
        task.completedDate = todayStr();
        if (task.recurring) spawnRecurring(task);
    }
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
        runCount: (completedTask.runCount || 0) + 1,
    });
    newTask.createdDate = nextDate;
    state.tasks.push(newTask);
}

function moveToColumn(id, col) {
    updateTask(id, { kanbanColumn: col });
}

function moveToKanban(id) {
    updateTask(id, { kanbanColumn: 'backlog' });
}

function backToList(id) {
    updateTask(id, { kanbanColumn: null });
}

function markWontDo(id) {
    updateTask(id, { status: 'wont-do', kanbanColumn: null });
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
    state.tasks.forEach(t => {
        if (!t.recurring || t.status !== 'complete') return;
        const next = calcNextRecurring(t.recurring, t.completedDate || today);
        if (next <= today) spawnRecurring(t);
    });
    saveState();
}

// ============ TASK MODAL ============

function openTaskModal(taskId, defaultKanbanCol) {
    editingTaskId = taskId;
    const modal = document.getElementById('task-modal');
    document.getElementById('task-modal-title').textContent = taskId ? 'Edit Task' : 'New Task';
    document.getElementById('task-modal-delete').style.display = taskId ? '' : 'none';

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
    state.themes.forEach(theme => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-pick-btn' + (modalThemeId === theme.id ? ' active' : '');
        btn.style.background = theme.color;
        btn.textContent = theme.name;
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
        theme.subThemes.forEach(s => {
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
    const title = document.getElementById('task-title').value.trim();
    if (!title) { document.getElementById('task-title').focus(); return; }
    const addToKanban = document.getElementById('task-add-to-kanban').checked;
    const data = {
        title,
        themeId: modalThemeId,
        subTheme: document.getElementById('task-subtheme').value,
        priority: modalPriority,
        size: modalSize,
        dueDate: document.getElementById('task-due').value,
        notes: document.getElementById('task-notes').value.trim(),
        recurring: getRecurringFromModal(),
        kanbanColumn: addToKanban ? 'backlog' : (editingTaskId ? (state.tasks.find(t=>t.id===editingTaskId)?.kanbanColumn || null) : null),
    };
    if (editingTaskId) {
        updateTask(editingTaskId, data);
    } else {
        addTask(data);
    }
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
    } else {
        document.getElementById('theme-edit-name').value = '';
        document.getElementById('theme-edit-color').value = '#007AFF';
        document.getElementById('theme-edit-color-hex').textContent = '#007AFF';
        document.getElementById('theme-edit-subthemes').value = '';
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
    if (editingThemeId) {
        const theme = getTheme(editingThemeId);
        if (theme) { theme.name = name; theme.color = color; theme.subThemes = subThemes; }
    } else {
        const id = name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + genId().slice(0,4);
        state.themes.push({ id, name, color, subThemes });
    }
    saveState();
    renderAdmin();
    closeThemeModal();
}

function deleteTheme() {
    if (!editingThemeId) return;
    const count = state.tasks.filter(t => t.themeId === editingThemeId).length;
    if (count && !confirm(`${count} task(s) use this theme. Delete anyway? (Tasks keep their data.)`)) return;
    state.themes = state.themes.filter(t => t.id !== editingThemeId);
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
    const fromKanban = menu.querySelector('[data-action="from-kanban"]');
    if (task.kanbanColumn) {
        toKanban.style.display = 'none';
        fromKanban.style.display = '';
    } else {
        toKanban.style.display = '';
        fromKanban.style.display = 'none';
    }
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

    // Settings
    document.getElementById('settings-btn').addEventListener('click', () => {
        document.getElementById('settings-theme').value = state.settings.theme || 'light';
        document.getElementById('settings-modal').style.display = 'flex';
    });
    document.getElementById('settings-close').addEventListener('click', () => document.getElementById('settings-modal').style.display = 'none');
    document.getElementById('settings-modal').addEventListener('click', e => { if(e.target===e.currentTarget) e.currentTarget.style.display='none'; });
    document.getElementById('settings-theme').addEventListener('change', e => {
        state.settings.theme = e.target.value; applyTheme(); saveState();
    });

    // Escape key
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeTaskModal(); closeThemeModal(); hideContextMenu();
            document.getElementById('settings-modal').style.display = 'none';
            document.getElementById('theme-edit-modal').style.display = 'none';
        }
    });

    // Board add buttons (handled dynamically in renderBoard)

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
        const payload = { tasks: state.tasks, themes: state.themes, archive: state.archive, completionLog: state.completionLog };
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
        if (d.tasks) state.tasks = d.tasks;
        if (d.themes) state.themes = d.themes;
        if (d.archive) state.archive = d.archive;
        if (d.completionLog) state.completionLog = d.completionLog;
        _baseSave();
        render();
        syncPaused = false;
    } catch(e) { console.error('Sync pull:', e); }
}

(function initSync() {
    if (!window.supabase) return;
    try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        pullFromCloud().then(() => {
            syncChannel = supabaseClient.channel('kanban-rt')
                .on('postgres_changes', { event:'*', schema:'public', table:'kanban_sync', filter:`sync_code=eq.${SYNC_CODE}` }, () => pullFromCloud())
                .subscribe();
        });
    } catch(e) { console.error('Sync init:', e); }
})();

init();
})();

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}
