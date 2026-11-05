    function getTaskCards() {
        return Array.from(document.querySelectorAll('div.group.cursor-pointer, .grid > div'))
            .filter(c => /学习地图|进行中|截止/.test(c.innerText || '') && c.offsetParent !== null);
    }

    function getTaskSelection() {
        try {
            const value = JSON.parse(getLocalItem(STORAGE_KEYS.selectedTasks, 'null'));
            return value?.mode === 'all' || (value?.mode === 'ids' && Array.isArray(value.ids)) ? value : { mode: 'all' };
        } catch (_) { return { mode: 'all' }; }
    }

    function saveTaskSelection(selection) {
        localStorage.setItem(STORAGE_KEYS.selectedTasks, JSON.stringify(selection));
    }

    function taskSelectionKey(card) {
        return getTaskIdFromCard(card) || 'title:' + (card.innerText || '').split('\n')[0].trim();
    }

    function isTaskKeySelected(key) {
        const selection = getTaskSelection();
        return selection.mode === 'all' || selection.ids.includes(key);
    }

    let taskCatalogMemory = [];
    let taskCatalogLoading = null;
    let taskCatalogAttemptAt = -Infinity;
    let taskCatalogMessage = '';
    function taskCatalogDay() {
        const date = new Date();
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }

    function getTaskCatalog() {
        try {
            const cache = JSON.parse(getLocalItem(STORAGE_KEYS.taskCatalog, 'null'));
            if (cache?.day === taskCatalogDay() && Array.isArray(cache.entries)) return cache.entries;
        } catch (_) {}
        return taskCatalogMemory;
    }

    function saveTaskCatalog(entries, fetchedAt) {
        taskCatalogMemory = [...new Map(entries.filter(item => item.key && item.title).map(item => [item.key, item])).values()];
        if (fetchedAt === undefined) {
            try { fetchedAt = JSON.parse(getLocalItem(STORAGE_KEYS.taskCatalog, 'null'))?.fetchedAt; } catch (_) {}
        }
        setLocalItem(STORAGE_KEYS.taskCatalog, JSON.stringify({ day: taskCatalogDay(), entries: taskCatalogMemory, fetchedAt }));
    }

    function rememberTaskCards(cards) {
        if (!cards.length) return;
        saveTaskCatalog([...getTaskCatalog(), ...cards.map(card => ({ key: taskSelectionKey(card),
            title: (card.innerText || '').split('\n')[0].trim(), completed: isItemCompleted(card) }))]);
    }

    // 复用平台已登录的请求客户端，仅查询任务列表，不修改播放器或学习上报。
    function getPlatformTaskClient() {
        let requirePlatform;
        if (!window.webpackChunkwmy_pc?.push) throw new Error('平台任务接口尚未就绪');
        window.webpackChunkwmy_pc.push([[], {}, runtime => { requirePlatform = runtime; }]);
        if (!requirePlatform) throw new Error('平台任务接口尚未就绪');
        return { api: requirePlatform(90025).Z, base: requirePlatform(63601).kT };
    }

    async function loadTaskCatalog(force = false) {
        if (IS_JNFTC) return loadJnTaskCatalog(force);
        const accountEpoch = getLocalItem(ACCOUNT_EPOCH_KEY);
        if (taskCatalogLoading) return taskCatalogLoading;
        try {
            const cache = JSON.parse(getLocalItem(STORAGE_KEYS.taskCatalog, 'null'));
            if (!force && cache?.day === taskCatalogDay() && typeof cache.fetchedAt === 'number' && Date.now() - cache.fetchedAt < 60000) return getTaskCatalog();
        } catch (_) {}
        if (!force && Date.now() - taskCatalogAttemptAt < 60000) return getTaskCatalog();
        taskCatalogAttemptAt = Date.now();
        taskCatalogMessage = '正在读取任务列表...';
        taskCatalogLoading = (async () => {
            let timer;
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            try {
                const { api, base } = getPlatformTaskClient();
                const date = new Date(); date.setHours(0, 0, 0, 0);
                const collect = async () => {
                    const entries = [];
                    let seen = 0;
                    for (let page = 1; page <= 20; page++) {
                        const response = await api.post(base + '/calendar/api/pc/getPage',
                            { date: date.getTime(), pageNo: page, pageSize: 100 }, controller ? { signal: controller.signal } : {});
                        if (String(response?.code) !== '1000' || !Array.isArray(response.data?.records)) throw new Error('任务列表读取失败');
                        const records = response.data.records;
                        for (const item of records) {
                            if (Number(item.taskType) === 1 && typeof item.taskId === 'string') {
                                entries.push({ key: item.taskId, title: String(item.taskName || item.name || '学习地图') });
                            }
                        }
                        seen += records.length;
                        if (!records.length || seen >= Number(response.data.total || 0)) return entries;
                    }
                    throw new Error('任务列表过多，请在任务中心分批选择');
                };
                const entries = await Promise.race([collect(), new Promise((_, reject) => {
                    timer = setTimeout(() => { controller?.abort(); reject(new Error('任务列表加载超时')); }, 5000);
                })]);
                if (accountEpoch !== getLocalItem(ACCOUNT_EPOCH_KEY) || accountStale) return getTaskCatalog();
                saveTaskCatalog(entries, Date.now());
                taskCatalogMessage = entries.length ? '' : '今天暂无学习地图。';
            } catch (error) {
                taskCatalogMessage = `${error.message}；可点击刷新，已有任务仍可选择。`;
            } finally {
                if (timer) clearTimeout(timer);
            }
            return getTaskCatalog();
        })();
        try { return await taskCatalogLoading; } finally { taskCatalogLoading = null; }
    }

    function getPendingTasks(cards = []) {
        rememberTaskCards(cards);
        const handled = getHandledMaps();
        return getTaskCatalog().filter(task => isTaskKeySelected(task.key) && !task.completed &&
            !handled.includes(task.key) && !(task.key.startsWith('title:') && handled.includes(task.title)));
    }

    function getTaskLoad(key) {
        return Object.entries(getActiveTabs()).filter(([id, tab]) => id !== TAB_ID && tab.mapId === key).length;
    }

    function pickNextTask(tasks, excludedMap = '') {
        return tasks.filter(task => task.key !== excludedMap && Number(getLocalItem('_kme_task_busy_' + task.key, '0')) <= Date.now())
            .sort((a, b) => getTaskLoad(a.key) - getTaskLoad(b.key))[0];
    }

    function enterAssignedTask(task, card) {
        state.isActionPending = true;
        state.currentTask = task.title;
        if (!registerTabHeartbeat('', '正在进入任务', task.key)) throw new Error('无法保存任务分配，已暂停');
        updateHUD(`进入任务: ${task.title}`, task.title);
        setManagedTimeout(() => {
            if (!isTaskKeySelected(task.key)) { pauseAutomation('任务选择已改变，请重新开始。'); return; }
            if (card) simulateHumanClick(card);
            else location.href = CONFIG.myTaskUrl.replace('/my/myTask', '/training/detail/' + encodeURIComponent(task.key));
            waitForPageReady('任务学习入口加载', () =>
                (location.href.includes('/home/training/detail/') && !!getStudyEntryButton()) || isStudyPageReady());
        }, 1000);
    }

    async function spawnTaskWorker() {
        if (!state.enabled || !navigator.locks || typeof window.open !== 'function') return false;
        return navigator.locks.request('_kme_worker_spawn', { ifAvailable: true }, lock => {
            if (!lock || !state.enabled) return false;
            const count = Object.keys(getActiveTabs()).length;
            if (count >= getConcurrencySetting()) return false;
            let pending;
            try { pending = JSON.parse(getLocalItem('_kme_worker_pending', 'null')); } catch (_) {}
            if (pending && pending.until > Date.now() && count <= pending.count) return false;
            setLocalItem('_kme_worker_pending', JSON.stringify({ count, until: Date.now() + 10000 }));
            const opened = window.open(CONFIG.myTaskUrl, '_blank');
            if (!opened) removeLocalItem('_kme_worker_pending');
            return !!opened;
        });
    }

    let taskSelectionRenderKey = '';
    function renderTaskSelection(force = false) {
        const panel = getHUDElement('jinpei-task-selection');
        const list = getHUDElement('jinpei-task-list');
        if (!panel || !list) return;
        panel.style.display = 'block';
        if (location.href.includes('/home/my/myTask')) rememberTaskCards(getTaskCards());
        const tasks = getTaskCatalog();
        getHUDElement('jinpei-task-all').disabled = state.enabled;
        getHUDElement('jinpei-task-clear').disabled = state.enabled;
        const renderKey = JSON.stringify([state.enabled, getTaskSelection(), tasks, taskCatalogMessage]);
        if (!force && renderKey === taskSelectionRenderKey) return;
        taskSelectionRenderKey = renderKey;
        list.textContent = '';
        if (!tasks.length || taskCatalogMessage) {
            const hint = document.createElement('div');
            hint.textContent = taskCatalogMessage || '默认全选，展开或点击刷新即可读取任务列表。';
            list.appendChild(hint);
        }
        for (const task of tasks) {
            const label = document.createElement('label');
            label.className = 'jinpei-task-item';
            label.style.cssText = 'display:flex;gap:6px;align-items:center;margin:4px 0;';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'jinpei-checkbox';
            checkbox.checked = isTaskKeySelected(task.key);
            checkbox.disabled = state.enabled;
            const text = document.createElement('span');
            text.style.cssText = 'min-width:0;overflow-wrap:anywhere;';
            text.textContent = task.title;
            label.append(checkbox, text);
            checkbox.addEventListener('change', () => {
                if (state.enabled) return;
                const previous = getTaskSelection();
                const ids = new Set(previous.mode === 'all' ? getTaskCatalog().map(item => item.key) : previous.ids);
                if (checkbox.checked) ids.add(task.key); else ids.delete(task.key);
                saveTaskSelection({ mode: 'ids', ids: [...ids] });
            });
            list.appendChild(label);
        }
    }

    function getStudyEntryButton() {
        return Array.from(document.querySelectorAll('button, .ant5-btn, [role="button"]'))
            .find(b => /进入学习|继续学习|去学习/.test((b.innerText || '').trim()) && b.offsetParent !== null);
    }

    function isStudyPageReady() {
        if (!/\/home\/(training\/study\/|courseplay\/)/.test(location.href)) return false;
        const video = document.querySelector('video');
        if (!video) return getCourseItems().length > 0;
        return Number.isFinite(video.duration) && video.duration > 0 &&
            (typeof video.readyState !== 'number' || video.readyState >= 2) &&
            getAllSubVideoItems().some(isSubVideoActive);
    }

