/* =========================================
   Life Kanban — App Logic
   ========================================= */

(function () {
    'use strict';

    const STORAGE_KEY = 'life-kanban';
    const DEFAULT_COLUMNS = [
        { id: 'inbox', name: 'Inbox' },
        { id: 'todo', name: 'To Do' },
        { id: 'in-progress', name: 'In Progress' },
        { id: 'ongoing', name: 'Ongoing' },
        { id: 'blocked', name: 'Blocked' },
        { id: 'next-week', name: 'Next Week' },
        { id: 'next-month', name: 'Next Month' },
        { id: 'complete', name: 'Complete' },
    ];

    // ---- State ----

    let state = loadState();
    let currentView = 'today';
    let currentContext = state.settings?.defaultContext || 'work';
    let currentSort = 'priority';
    let selectedDate = null;
    let editingTaskId = null;
    let editingColumnId = null;
    let draggedTaskId = null;

    function defaultState() {
        return {
            tasks: [],
            columns: DEFAULT_COLUMNS.map(c => ({ ...c })),
            settings: { theme: 'light', defaultContext: 'work' },
            completionLog: {},
        };
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (!parsed.columns || parsed.columns.length === 0) {
                    parsed.columns = DEFAULT_COLUMNS.map(c => ({ ...c }));
                }
                DEFAULT_COLUMNS.forEach(dc => {
                    if (!parsed.columns.find(c => c.id === dc.id)) {
                        const completeIdx = parsed.columns.findIndex(c => c.id === 'complete');
                        if (completeIdx >= 0) parsed.columns.splice(completeIdx, 0, { ...dc });
                        else parsed.columns.push({ ...dc });
                    }
                });
                if (!parsed.completionLog) parsed.completionLog = {};
                if (!parsed.settings) parsed.settings = { theme: 'light', defaultContext: 'work' };
                return parsed;
            }
        } catch (e) { /* fall through */ }
        return defaultState();
    }

    function saveState() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    // ---- Helpers ----

    function genId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function toDateStr(d) {
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function todayStr() {
        return toDateStr(new Date());
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }

    function formatDateLong(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }

    function addDays(dateStr, days) {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return toDateStr(d);
    }

    function nextMonday(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        const day = d.getDay();
        const daysUntilMon = day === 0 ? 1 : (8 - day);
        d.setDate(d.getDate() + daysUntilMon);
        return toDateStr(d);
    }

    function nextDayOfWeek(targetDay) {
        const d = new Date(todayStr() + 'T00:00:00');
        const current = d.getDay();
        let diff = targetDay - current;
        if (diff <= 0) diff += 7;
        d.setDate(d.getDate() + diff);
        return toDateStr(d);
    }

    function dayName(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-GB', { weekday: 'long' });
    }

    function isOverdue(task) {
        if (!task.scheduledDate) return false;
        return task.scheduledDate < todayStr() && task.column !== 'complete' && task.status !== 'wont-do';
    }

    function rolloverTasks() {
        const today = todayStr();
        let changed = false;
        state.tasks.forEach(task => {
            if (task.scheduledDate && task.scheduledDate < today && task.column !== 'complete' && task.status !== 'wont-do') {
                task.scheduledDate = today;
                changed = true;
            }
        });
        if (changed) saveState();
    }

    function getTodayCompletions() {
        return state.completionLog[todayStr()] || 0;
    }

    function getUniqueThemes() {
        const themes = new Set();
        state.tasks.forEach(t => { if (t.theme) themes.add(t.theme); });
        return [...themes].sort();
    }

    function getUniqueSubthemes() {
        const sub = new Set();
        state.tasks.forEach(t => { if (t.subTheme) sub.add(t.subTheme); });
        return [...sub].sort();
    }

    function priorityOrder(p) {
        if (p === 'high') return 0;
        if (p === 'medium') return 1;
        if (p === 'low') return 2;
        return 3;
    }

    // ---- Rendering ----

    function render() {
        if (currentView === 'today') { renderToday(); renderUpcoming(); }
        else if (currentView === 'board') renderBoard();
        else if (currentView === 'list') renderList();
    }

    function getSelectedDate() {
        return selectedDate || todayStr();
    }

    function renderToday() {
        const viewing = getSelectedDate();
        const today = todayStr();
        const isToday = viewing === today;

        document.getElementById('today-date-text').textContent = formatDateLong(viewing);
        document.getElementById('day-today').style.display = isToday ? 'none' : '';

        const count = getTodayCompletions();
        const streakEl = document.getElementById('today-streak');
        if (isToday && count > 0) {
            streakEl.textContent = `${count} done today`;
            streakEl.style.display = '';
        } else {
            streakEl.style.display = 'none';
        }

        document.querySelectorAll('.today-col').forEach(col => {
            const ctx = col.dataset.colContext;

            col.classList.toggle('active-mobile', ctx === currentContext);

            const tasks = state.tasks.filter(t =>
                t.context === ctx &&
                t.scheduledDate === viewing &&
                t.column !== 'complete' &&
                t.status !== 'wont-do'
            );

            const overdueTasks = isToday ? state.tasks.filter(t =>
                t.context === ctx &&
                t.scheduledDate &&
                t.scheduledDate < today &&
                t.column !== 'complete' &&
                t.status !== 'wont-do'
            ) : [];

            const overdueContainer = col.querySelector('.today-col-overdue');
            overdueContainer.innerHTML = '';
            if (overdueTasks.length > 0) {
                overdueContainer.innerHTML = '<div class="overdue-label">Rolled over</div>';
                overdueTasks.forEach(t => overdueContainer.appendChild(createTaskCard(t)));
            }

            const groups = { high: [], medium: [], low: [], none: [] };
            tasks.forEach(t => {
                const p = t.priority || 'none';
                groups[p].push(t);
            });

            ['high', 'medium', 'low', 'none'].forEach(p => {
                const container = col.querySelector(`.priority-group[data-priority="${p}"]`);
                container.innerHTML = '';
                if (groups[p].length > 0) {
                    const labels = { high: 'High Priority', medium: 'Medium Priority', low: 'Low Priority', none: 'No Priority' };
                    const label = document.createElement('div');
                    label.className = 'priority-group-label';
                    label.textContent = labels[p];
                    container.appendChild(label);
                    groups[p].forEach(t => container.appendChild(createTaskCard(t)));
                }
            });

            const empty = col.querySelector('.today-col-empty');
            const emptyMsg = col.querySelector('.today-col-empty p');
            empty.style.display = (tasks.length === 0 && overdueTasks.length === 0) ? '' : 'none';
            if (emptyMsg) emptyMsg.textContent = `No ${ctx} tasks for ${isToday ? 'today' : dayName(viewing).toLowerCase()}.`;
        });
    }

    function renderUpcoming() {
        const container = document.getElementById('upcoming-days');
        container.innerHTML = '';
        const today = getSelectedDate();

        let hasAny = false;
        for (let i = 1; i <= 14; i++) {
            const dateStr = addDays(today, i);
            const tasks = state.tasks.filter(t =>
                t.scheduledDate === dateStr &&
                t.column !== 'complete' &&
                t.status !== 'wont-do'
            );
            if (tasks.length === 0) continue;
            hasAny = true;

            const dayEl = document.createElement('div');
            dayEl.className = 'upcoming-day';

            const header = document.createElement('div');
            header.className = 'upcoming-day-header';
            header.innerHTML = `
                <span class="upcoming-day-name">${dayName(dateStr)}</span>
                <span class="upcoming-day-date">${formatDate(dateStr)}</span>
                <span class="upcoming-day-count">${tasks.length}</span>
            `;
            dayEl.appendChild(header);

            tasks
                .sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority))
                .forEach(task => {
                    const row = document.createElement('div');
                    row.className = 'upcoming-task';
                    row.addEventListener('click', () => openTaskModal(task.id));

                    if (task.priority) {
                        const dot = document.createElement('div');
                        dot.className = `priority-dot ${task.priority}`;
                        row.appendChild(dot);
                    }

                    const title = document.createElement('span');
                    title.className = 'upcoming-task-title';
                    title.textContent = task.title;
                    row.appendChild(title);

                    const ctxBadge = document.createElement('span');
                    ctxBadge.className = `badge-context ${task.context}`;
                    ctxBadge.textContent = task.context;
                    row.appendChild(ctxBadge);

                    if (task.timeframe) {
                        const size = document.createElement('span');
                        size.className = 'badge badge-size';
                        size.textContent = task.timeframe;
                        row.appendChild(size);
                    }

                    dayEl.appendChild(row);
                });

            container.appendChild(dayEl);
        }

        if (!hasAny) {
            container.innerHTML = '<div class="upcoming-empty">No tasks scheduled for the next 2 weeks.</div>';
        }
    }

    function createTaskCard(task) {
        const card = document.createElement('div');
        card.className = 'task-card';
        if (task.column === 'complete') card.classList.add('completed');
        if (task.status === 'wont-do') card.classList.add('wont-do');
        card.dataset.taskId = task.id;

        const checkbox = document.createElement('div');
        checkbox.className = 'task-checkbox' + (task.column === 'complete' ? ' checked' : '');
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleComplete(task.id);
        });

        const body = document.createElement('div');
        body.className = 'task-card-body';

        if (task.priority) {
            const dot = document.createElement('div');
            dot.className = `priority-dot ${task.priority}`;
            body.appendChild(dot);
        }

        const title = document.createElement('span');
        title.className = 'task-card-title';
        title.textContent = task.title;
        body.appendChild(title);

        const badges = document.createElement('div');
        badges.className = 'task-badges';

        if (task.timeframe) {
            const b = document.createElement('span');
            b.className = 'badge badge-size';
            b.textContent = task.timeframe;
            badges.appendChild(b);
        }
        if (task.theme) {
            const b = document.createElement('span');
            b.className = 'badge badge-theme';
            b.textContent = task.theme;
            badges.appendChild(b);
        }
        if (task.dueDate) {
            const isOverdueDate = task.dueDate < todayStr();
            const b = document.createElement('span');
            b.className = `badge ${isOverdueDate ? 'badge-overdue' : 'badge-due'}`;
            b.textContent = `Due ${formatDate(task.dueDate)}`;
            badges.appendChild(b);
        }
        if (isOverdue(task)) {
            const b = document.createElement('span');
            b.className = 'badge badge-overdue';
            b.textContent = `from ${formatDate(task.scheduledDate)}`;
            badges.appendChild(b);
        }

        body.appendChild(badges);

        const menuBtn = document.createElement('button');
        menuBtn.className = 'task-card-menu';
        menuBtn.innerHTML = '⋯';
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showContextMenu(e, task.id);
        });

        card.appendChild(checkbox);
        card.appendChild(body);
        card.appendChild(menuBtn);

        card.addEventListener('click', () => openTaskModal(task.id));

        return card;
    }

    function renderBoard() {
        const container = document.getElementById('board-columns');
        container.innerHTML = '';

        state.columns.forEach(col => {
            const colTasks = state.tasks.filter(t =>
                t.column === col.id && t.context === currentContext
            );

            const colEl = document.createElement('div');
            colEl.className = 'board-column';
            colEl.dataset.columnId = col.id;

            const header = document.createElement('div');
            header.className = 'column-header';
            header.innerHTML = `<h3>${col.name}</h3><span class="column-count">${colTasks.length}</span>`;
            header.addEventListener('click', () => openColumnModal(col.id));

            const cards = document.createElement('div');
            cards.className = 'column-cards';
            cards.dataset.columnId = col.id;

            cards.addEventListener('dragover', (e) => {
                e.preventDefault();
                cards.classList.add('drag-over');
            });
            cards.addEventListener('dragleave', () => {
                cards.classList.remove('drag-over');
            });
            cards.addEventListener('drop', (e) => {
                e.preventDefault();
                cards.classList.remove('drag-over');
                if (draggedTaskId) {
                    moveTaskToColumn(draggedTaskId, col.id);
                    draggedTaskId = null;
                }
            });

            colTasks
                .sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority))
                .forEach(task => {
                    const card = createBoardCard(task);
                    cards.appendChild(card);
                });

            const addBtn = document.createElement('button');
            addBtn.className = 'column-add-btn';
            addBtn.textContent = '+ Add task';
            addBtn.addEventListener('click', () => openTaskModal(null, col.id));

            colEl.appendChild(header);
            colEl.appendChild(cards);
            colEl.appendChild(addBtn);
            container.appendChild(colEl);
        });
    }

    function createBoardCard(task) {
        const card = document.createElement('div');
        card.className = 'board-card';
        if (task.column === 'complete') card.classList.add('completed');
        card.draggable = true;
        card.dataset.taskId = task.id;

        card.addEventListener('dragstart', (e) => {
            draggedTaskId = task.id;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
        });
        card.addEventListener('click', () => openTaskModal(task.id));

        if (task.priority) {
            const bar = document.createElement('div');
            bar.className = `board-card-priority ${task.priority}`;
            card.appendChild(bar);
        }

        const title = document.createElement('div');
        title.className = 'board-card-title';
        title.textContent = task.title;
        card.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'board-card-meta';

        if (task.timeframe) {
            const b = document.createElement('span');
            b.className = 'badge badge-size';
            b.textContent = task.timeframe;
            meta.appendChild(b);
        }
        if (task.theme) {
            const b = document.createElement('span');
            b.className = 'badge badge-theme';
            b.textContent = task.theme;
            meta.appendChild(b);
        }
        if (task.dueDate) {
            const b = document.createElement('span');
            b.className = `badge ${task.dueDate < todayStr() ? 'badge-overdue' : 'badge-due'}`;
            b.textContent = `Due ${formatDate(task.dueDate)}`;
            meta.appendChild(b);
        }

        if (meta.children.length > 0) card.appendChild(meta);

        return card;
    }

    function renderList() {
        const container = document.getElementById('list-tasks');
        container.innerHTML = '';

        let tasks = state.tasks.filter(t => t.context === currentContext && t.status !== 'wont-do');

        if (currentSort === 'priority') {
            tasks.sort((a, b) => {
                const comp = priorityOrder(a.priority) - priorityOrder(b.priority);
                if (comp !== 0) return comp;
                return (a.title || '').localeCompare(b.title || '');
            });
        } else if (currentSort === 'date') {
            tasks.sort((a, b) => {
                const da = a.dueDate || a.scheduledDate || '9999';
                const db = b.dueDate || b.scheduledDate || '9999';
                return da.localeCompare(db);
            });
        } else if (currentSort === 'theme') {
            tasks.sort((a, b) => (a.theme || 'zzz').localeCompare(b.theme || 'zzz'));
        }

        if (tasks.length === 0) {
            container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">No tasks yet.</div>';
            return;
        }

        tasks.forEach(task => {
            const row = document.createElement('div');
            row.className = 'list-task-row' + (task.column === 'complete' ? ' completed' : '');
            row.dataset.taskId = task.id;

            const checkbox = document.createElement('div');
            checkbox.className = 'task-checkbox' + (task.column === 'complete' ? ' checked' : '');
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleComplete(task.id);
            });

            if (task.priority) {
                const dot = document.createElement('div');
                dot.className = `priority-dot ${task.priority}`;
                row.appendChild(dot);
            }

            const title = document.createElement('span');
            title.className = 'list-task-title';
            title.textContent = task.title;

            const col = document.createElement('span');
            col.className = 'list-task-col';
            const colObj = state.columns.find(c => c.id === task.column);
            col.textContent = colObj ? colObj.name : '';

            const date = document.createElement('span');
            date.className = 'list-task-col';
            date.textContent = task.dueDate ? formatDate(task.dueDate) : (task.scheduledDate ? formatDate(task.scheduledDate) : '');

            row.appendChild(checkbox);
            row.appendChild(title);
            row.appendChild(col);
            row.appendChild(date);

            row.addEventListener('click', () => openTaskModal(task.id));

            container.appendChild(row);
        });
    }

    // ---- Actions ----

    function addTask(title, overrides = {}) {
        const task = {
            id: genId(),
            title: title.trim(),
            priority: overrides.priority || '',
            timeframe: overrides.timeframe || '',
            theme: overrides.theme || '',
            subTheme: overrides.subTheme || '',
            column: overrides.column || 'inbox',
            context: overrides.context || currentContext,
            scheduledDate: overrides.scheduledDate || todayStr(),
            dueDate: overrides.dueDate || '',
            notes: overrides.notes || '',
            status: 'active',
            createdDate: todayStr(),
            order: state.tasks.length,
        };
        state.tasks.push(task);
        saveState();
        render();
        return task;
    }

    function updateTask(id, updates) {
        const task = state.tasks.find(t => t.id === id);
        if (!task) return;
        Object.assign(task, updates);
        saveState();
        render();
    }

    function deleteTask(id) {
        state.tasks = state.tasks.filter(t => t.id !== id);
        saveState();
        render();
    }

    function toggleComplete(id) {
        const task = state.tasks.find(t => t.id === id);
        if (!task) return;
        if (task.column === 'complete') {
            task.column = task._prevColumn || 'todo';
            task.status = 'active';
            const today = todayStr();
            if (state.completionLog[today]) state.completionLog[today]--;
        } else {
            task._prevColumn = task.column;
            task.column = 'complete';
            task.status = 'complete';
            const today = todayStr();
            state.completionLog[today] = (state.completionLog[today] || 0) + 1;
        }
        saveState();
        render();
    }

    function moveTaskToColumn(id, columnId) {
        updateTask(id, { column: columnId });
    }

    function moveToNextDay(id) {
        const task = state.tasks.find(t => t.id === id);
        if (!task) return;
        const base = task.scheduledDate || todayStr();
        const tomorrow = addDays(base < todayStr() ? todayStr() : base, 1);
        updateTask(id, { scheduledDate: tomorrow });
    }

    function moveToNextWeek(id) {
        const task = state.tasks.find(t => t.id === id);
        if (!task) return;
        const base = task.scheduledDate || todayStr();
        const monday = nextMonday(base < todayStr() ? todayStr() : base);
        updateTask(id, { scheduledDate: monday });
    }

    function moveToDay(id, dateStr) {
        updateTask(id, { scheduledDate: dateStr });
    }

    function markWontDo(id) {
        updateTask(id, { status: 'wont-do', column: 'complete' });
    }

    // ---- Date Picker Modal ----

    let datePickerTaskId = null;

    function openDatePicker(taskId) {
        datePickerTaskId = taskId;
        const modal = document.getElementById('date-picker-modal');
        const input = document.getElementById('move-to-date-input');
        const task = state.tasks.find(t => t.id === taskId);
        input.value = task ? (task.scheduledDate || todayStr()) : todayStr();
        modal.style.display = 'flex';
        input.focus();
    }

    function closeDatePicker() {
        document.getElementById('date-picker-modal').style.display = 'none';
        datePickerTaskId = null;
    }

    function saveDatePicker() {
        const dateVal = document.getElementById('move-to-date-input').value;
        if (datePickerTaskId && dateVal) {
            moveToDay(datePickerTaskId, dateVal);
        }
        closeDatePicker();
    }

    // ---- Modals ----

    function openTaskModal(taskId, defaultColumn) {
        editingTaskId = taskId;
        const modal = document.getElementById('task-modal');
        const titleEl = document.getElementById('modal-title');
        const deleteBtn = document.getElementById('task-delete');

        const colSelect = document.getElementById('task-column');
        colSelect.innerHTML = '';
        state.columns.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            colSelect.appendChild(opt);
        });

        const themeList = document.getElementById('theme-list');
        themeList.innerHTML = '';
        getUniqueThemes().forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            themeList.appendChild(opt);
        });

        const subList = document.getElementById('subtheme-list');
        subList.innerHTML = '';
        getUniqueSubthemes().forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            subList.appendChild(opt);
        });

        if (taskId) {
            const task = state.tasks.find(t => t.id === taskId);
            if (!task) return;
            titleEl.textContent = 'Edit Task';
            deleteBtn.style.display = '';
            document.getElementById('task-title').value = task.title;
            document.getElementById('task-priority').value = task.priority || '';
            document.getElementById('task-timeframe').value = task.timeframe || '';
            document.getElementById('task-context').value = task.context || 'work';
            document.getElementById('task-column').value = task.column;
            document.getElementById('task-scheduled').value = task.scheduledDate || '';
            document.getElementById('task-due').value = task.dueDate || '';
            document.getElementById('task-theme').value = task.theme || '';
            document.getElementById('task-subtheme').value = task.subTheme || '';
            document.getElementById('task-notes').value = task.notes || '';
        } else {
            titleEl.textContent = 'New Task';
            deleteBtn.style.display = 'none';
            document.getElementById('task-title').value = '';
            document.getElementById('task-priority').value = '';
            document.getElementById('task-timeframe').value = '';
            document.getElementById('task-context').value = currentContext;
            document.getElementById('task-column').value = defaultColumn || 'inbox';
            document.getElementById('task-scheduled').value = getSelectedDate();
            document.getElementById('task-due').value = '';
            document.getElementById('task-theme').value = '';
            document.getElementById('task-subtheme').value = '';
            document.getElementById('task-notes').value = '';
        }

        modal.style.display = 'flex';
        document.getElementById('task-title').focus();
    }

    function closeTaskModal() {
        document.getElementById('task-modal').style.display = 'none';
        editingTaskId = null;
    }

    function saveTaskModal() {
        const title = document.getElementById('task-title').value.trim();
        if (!title) return;

        const data = {
            title,
            priority: document.getElementById('task-priority').value,
            timeframe: document.getElementById('task-timeframe').value,
            context: document.getElementById('task-context').value,
            column: document.getElementById('task-column').value,
            scheduledDate: document.getElementById('task-scheduled').value,
            dueDate: document.getElementById('task-due').value,
            theme: document.getElementById('task-theme').value.trim(),
            subTheme: document.getElementById('task-subtheme').value.trim(),
            notes: document.getElementById('task-notes').value.trim(),
        };

        if (editingTaskId) {
            updateTask(editingTaskId, data);
        } else {
            addTask(title, data);
        }
        closeTaskModal();
    }

    function openColumnModal(columnId) {
        editingColumnId = columnId;
        const modal = document.getElementById('column-modal');
        const titleEl = document.getElementById('column-modal-title');
        const deleteBtn = document.getElementById('column-delete');
        const nameInput = document.getElementById('column-name');

        if (columnId) {
            const col = state.columns.find(c => c.id === columnId);
            if (!col) return;
            titleEl.textContent = 'Edit Column';
            nameInput.value = col.name;
            deleteBtn.style.display = '';
        } else {
            titleEl.textContent = 'New Column';
            nameInput.value = '';
            deleteBtn.style.display = 'none';
        }

        modal.style.display = 'flex';
        nameInput.focus();
    }

    function closeColumnModal() {
        document.getElementById('column-modal').style.display = 'none';
        editingColumnId = null;
    }

    function saveColumnModal() {
        const name = document.getElementById('column-name').value.trim();
        if (!name) return;

        if (editingColumnId) {
            const col = state.columns.find(c => c.id === editingColumnId);
            if (col) col.name = name;
        } else {
            const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + genId().slice(0, 4);
            state.columns.push({ id, name });
        }
        saveState();
        render();
        closeColumnModal();
    }

    function deleteColumn() {
        if (!editingColumnId) return;
        const tasksInCol = state.tasks.filter(t => t.column === editingColumnId);
        if (tasksInCol.length > 0) {
            if (!confirm(`This column has ${tasksInCol.length} task(s). They will be moved to Inbox. Continue?`)) return;
            tasksInCol.forEach(t => t.column = 'inbox');
        }
        state.columns = state.columns.filter(c => c.id !== editingColumnId);
        saveState();
        render();
        closeColumnModal();
    }

    // ---- Context Menu ----

    let activeMenuTaskId = null;

    function showContextMenu(e, taskId) {
        activeMenuTaskId = taskId;
        const menu = document.getElementById('context-menu');
        menu.style.display = 'block';

        const rect = e.target.getBoundingClientRect();
        let top = rect.bottom + 4;
        let left = rect.left;

        if (left + 180 > window.innerWidth) left = window.innerWidth - 190;
        if (top + 160 > window.innerHeight) top = rect.top - 164;

        menu.style.top = top + 'px';
        menu.style.left = left + 'px';
    }

    function hideContextMenu() {
        document.getElementById('context-menu').style.display = 'none';
        activeMenuTaskId = null;
    }

    // ---- Settings ----

    function openSettings() {
        const modal = document.getElementById('settings-modal');
        document.getElementById('settings-theme').value = state.settings.theme || 'light';
        modal.style.display = 'flex';
    }

    function closeSettings() {
        document.getElementById('settings-modal').style.display = 'none';
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        state.settings.theme = theme;
        saveState();
    }

    function exportData() {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `life-kanban-backup-${todayStr()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importData(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.tasks && data.columns) {
                    state = data;
                    if (!state.completionLog) state.completionLog = {};
                    if (!state.settings) state.settings = { theme: 'light', defaultContext: 'work' };
                    saveState();
                    applyTheme(state.settings.theme);
                    render();
                    closeSettings();
                }
            } catch (err) {
                alert('Invalid JSON file');
            }
        };
        reader.readAsText(file);
    }

    // ---- Event Binding ----

    function init() {
        applyTheme(state.settings.theme || 'light');
        rolloverTasks();

        // View tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentView = tab.dataset.view;
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                document.getElementById(`view-${currentView}`).classList.add('active');
                render();
            });
        });

        // Context toggle
        document.querySelectorAll('.ctx-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.ctx-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentContext = btn.dataset.context;
                render();
            });
        });

        // Day navigation
        document.getElementById('day-prev').addEventListener('click', () => {
            selectedDate = addDays(getSelectedDate(), -1);
            render();
        });
        document.getElementById('day-next').addEventListener('click', () => {
            selectedDate = addDays(getSelectedDate(), 1);
            render();
        });
        document.getElementById('day-today').addEventListener('click', () => {
            selectedDate = null;
            render();
        });

        // Brain dump (one per context column)
        document.querySelectorAll('.brain-dump-input').forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const val = e.target.value.trim();
                    const ctx = e.target.dataset.context || currentContext;
                    if (val) {
                        addTask(val, { column: 'inbox', context: ctx, scheduledDate: getSelectedDate() });
                        e.target.value = '';
                    }
                }
            });
        });

        // Task modal
        document.getElementById('task-save').addEventListener('click', saveTaskModal);
        document.getElementById('task-cancel').addEventListener('click', closeTaskModal);
        document.getElementById('modal-close').addEventListener('click', closeTaskModal);
        document.getElementById('task-delete').addEventListener('click', () => {
            if (editingTaskId && confirm('Delete this task?')) {
                deleteTask(editingTaskId);
                closeTaskModal();
            }
        });
        document.getElementById('task-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeTaskModal();
        });

        // Column modal
        document.getElementById('add-column-btn').addEventListener('click', () => openColumnModal(null));
        document.getElementById('column-save').addEventListener('click', saveColumnModal);
        document.getElementById('column-cancel').addEventListener('click', closeColumnModal);
        document.getElementById('column-modal-close').addEventListener('click', closeColumnModal);
        document.getElementById('column-delete').addEventListener('click', deleteColumn);
        document.getElementById('column-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeColumnModal();
        });

        // Context menu
        document.getElementById('context-menu').addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (!action || !activeMenuTaskId) return;
            if (action === 'next-day') moveToNextDay(activeMenuTaskId);
            else if (action === 'next-friday') moveToDay(activeMenuTaskId, nextDayOfWeek(5));
            else if (action === 'next-monday') moveToDay(activeMenuTaskId, nextDayOfWeek(1));
            else if (action === 'next-week') moveToNextWeek(activeMenuTaskId);
            else if (action === 'move-to-date') openDatePicker(activeMenuTaskId);
            else if (action === 'wont-do') markWontDo(activeMenuTaskId);
            else if (action === 'edit') openTaskModal(activeMenuTaskId);
            hideContextMenu();
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu') && !e.target.closest('.task-card-menu')) {
                hideContextMenu();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideContextMenu();
                closeTaskModal();
                closeColumnModal();
                closeSettings();
                closeDatePicker();
            }
        });

        // Sort buttons
        document.querySelectorAll('.sort-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentSort = btn.dataset.sort;
                render();
            });
        });

        // Settings
        document.getElementById('settings-btn').addEventListener('click', openSettings);
        document.getElementById('settings-close').addEventListener('click', closeSettings);
        document.getElementById('settings-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeSettings();
        });
        document.getElementById('settings-theme').addEventListener('change', (e) => {
            applyTheme(e.target.value);
        });
        document.getElementById('export-data').addEventListener('click', exportData);
        document.getElementById('import-data').addEventListener('change', (e) => {
            if (e.target.files[0]) importData(e.target.files[0]);
        });

        // Date picker modal
        document.getElementById('date-picker-save').addEventListener('click', saveDatePicker);
        document.getElementById('date-picker-cancel').addEventListener('click', closeDatePicker);
        document.getElementById('date-picker-close').addEventListener('click', closeDatePicker);
        document.getElementById('date-picker-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeDatePicker();
        });
        document.getElementById('move-to-date-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveDatePicker();
        });

        // Enter key in modals
        document.getElementById('column-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveColumnModal();
        });

        render();
    }

    // ---- Sync (auto-connect) ----

    const SUPABASE_URL = 'https://gctcxgjvnaptywmhnmuf.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjdGN4Z2p2bmFwdHl3bWhubXVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NzE3MTMsImV4cCI6MjA5NTM0NzcxM30.psusSSNMhV62XEj03Pje1TUIc25l46YAUnZgiHeFcvY';
    const SYNC_CODE = 'mpy31l1nrkp69mpy31l1nihblx';

    let supabaseClient = null;
    let syncChannel = null;
    let syncPaused = false;

    async function pushToCloud() {
        if (!supabaseClient || syncPaused) return;
        try {
            const payload = { tasks: state.tasks, columns: state.columns, completionLog: state.completionLog };
            const { error } = await supabaseClient
                .from('kanban_sync')
                .upsert({ sync_code: SYNC_CODE, data: payload, updated_at: new Date().toISOString() });
            if (error) console.error('Sync push error:', error.message);
        } catch (e) { console.error('Sync push failed:', e); }
    }

    async function pullFromCloud() {
        if (!supabaseClient) return false;
        try {
            const { data, error } = await supabaseClient
                .from('kanban_sync')
                .select('data, updated_at')
                .eq('sync_code', SYNC_CODE)
                .maybeSingle();
            if (error) { console.error('Sync pull error:', error.message); return false; }
            if (data && data.data) {
                syncPaused = true;
                if (data.data.tasks) state.tasks = data.data.tasks;
                if (data.data.columns) state.columns = data.data.columns;
                if (data.data.completionLog) state.completionLog = data.data.completionLog;
                saveState();
                render();
                syncPaused = false;
                return true;
            }
        } catch (e) { console.error('Sync pull failed:', e); }
        return false;
    }

    function subscribeToChanges() {
        if (syncChannel) { supabaseClient.removeChannel(syncChannel); }
        syncChannel = supabaseClient
            .channel('kanban-realtime')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'kanban_sync', filter: `sync_code=eq.${SYNC_CODE}` },
                () => { pullFromCloud(); }
            )
            .subscribe();
    }

    let pushTimer = null;
    const originalSaveState = saveState;

    saveState = function () {
        originalSaveState();
        if (supabaseClient && !syncPaused) {
            clearTimeout(pushTimer);
            pushTimer = setTimeout(pushToCloud, 500);
        }
    };

    // Auto-connect on load
    (function autoConnect() {
        if (!window.supabase) return;
        try {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            pullFromCloud().then(() => {
                pushToCloud();
                subscribeToChanges();
            });
        } catch (e) { console.error('Sync init failed:', e); }
    })();

    init();
})();

// Register service worker for PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}
