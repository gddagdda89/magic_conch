    // 跨标签页并发调度支持 (唯一 Tab 标识与多开协调)
    const TAB_ID = 'kme_' + Math.random().toString(36).slice(2, 8) + '_' + Date.now().toString(36);
    const TAB_STORAGE_PREFIX = '_kme_tab_';
    const TAB_HEARTBEAT_TTL = 120000;
    let currentClaim = null;
    let claimGeneration = 0;
    let studyCheckPending = false;
    let claimWaitReason = '';
    const schedulerDiagnosticTimes = new Map();

    function logSchedulerWait(reason, course, locks = []) {
        claimWaitReason = reason;
        const last = schedulerDiagnosticTimes.get(reason);
        if (last !== undefined && Date.now() - last < 15000) return;
        schedulerDiagnosticTimes.set(reason, Date.now());
        if (!CONFIG.debugPlayback) {
            diagnosticConsole.warn('课程调度等待：' + reason);
            return;
        }
        diagnosticConsole.warn('课程调度等待：' + reason, {
            requested: course, ownClaim: currentClaim?.course || null,
            concurrency: getConcurrencySetting(),
            occupants: Object.entries(getActiveTabs()).filter(([, data]) => data.courseKey).map(([id, data]) => ({
                tab: id, self: id === TAB_ID, mapId: data.mapId, courseKey: data.courseKey,
                courseTitle: data.courseTitle, heartbeatAgeSeconds: Math.round((Date.now() - data.timestamp) / 1000),
            })),
            heldLocks: locks.held?.map(lock => lock.name) || [],
        });
    }

    // 在调度锁内核对新版独立心跳；真实课程锁仍在时保留占用，包括冻结的窗口。
    async function reconcileCourseHeartbeats() {
        const locks = await navigator.locks.query({ __internal: true });
        const held = new Set(locks.held.map(lock => lock.name));
        const active = getActiveTabs();
        for (const [id, data] of Object.entries(active)) {
            if (id === TAB_ID || !data.courseKey) continue;
            const key = TAB_STORAGE_PREFIX + id;
            const raw = getLocalItem(key);
            if (!raw) continue; // 旧版聚合记录仍按原有心跳有效期兼容。
            const lockName = '_kme_course_' + JSON.stringify([data.mapId, data.courseKey || data.courseTitle]);
            if (held.has(lockName)) continue;
            // 读取后未被其他脚本更新，才清理没有真实锁的独立记录。
            if (getLocalItem(key) !== raw) continue;
            removeLocalItem(key);
            diagnosticConsole.warn('课程调度：清理无课程锁的残留窗口记录', {
                tab: id, courseKey: data.courseKey, mapId: data.mapId,
                heartbeatAgeSeconds: Math.round((Date.now() - data.timestamp) / 1000),
            });
        }
        return locks;
    }

    function getConcurrencySetting() {
        if (IS_JNFTC) return 1;
        const val = parseInt(getLocalItem(STORAGE_KEYS.concurrency, (CONFIG.defaultConcurrency || 1).toString()), 10);
        if (isNaN(val) || val < 1) return 1;
        if (val > (CONFIG.maxConcurrency || 6)) return CONFIG.maxConcurrency || 6;
        return val;
    }

    function setConcurrencySetting(val) {
        const clamped = IS_JNFTC ? 1 : Math.max(1, Math.min(CONFIG.maxConcurrency || 6, parseInt(val, 10) || 1));
        setLocalItem(STORAGE_KEYS.concurrency, clamped.toString());
        state.concurrency = clamped;
        const valEl = getHUDElement('jinpei-concurrency-val');
        if (valEl) valEl.innerText = clamped.toString();
        const activeBadge = getHUDElement('jinpei-active-tabs-badge');
        if (activeBadge) {
            const activeCount = Math.max(1, Object.keys(getActiveTabs()).length);
            activeBadge.innerText = `${activeCount}/${clamped}`;
        }
        return clamped;
    }

    const rawStorageKey = typeof Storage !== 'undefined' && Storage.prototype.key ? Storage.prototype.key : null;

    function getActiveTabs() {
        try {
            // 旧版记录只读兼容；新版每个窗口独立写入，避免覆盖其他窗口。
            let map = {};
            try { map = JSON.parse(getLocalItem(STORAGE_KEYS.activeTabs, '{}')) || {}; } catch (_) {}
            for (let i = 0; i < localStorage.length; i++) {
                const key = rawStorageKey ? rawStorageKey.call(localStorage, i) : localStorage.key(i);
                if (!key || !key.startsWith(TAB_STORAGE_PREFIX)) continue;
                try { map[key.slice(TAB_STORAGE_PREFIX.length)] = JSON.parse(localStorage.getItem(key)); } catch (_) {}
            }
            const now = Date.now();
            const alive = {};
            for (const [id, data] of Object.entries(map)) {
                if (data && typeof data.timestamp === 'number' && (now - data.timestamp < TAB_HEARTBEAT_TTL)) {
                    alive[id] = data;
                }
            }
            return alive;
        } catch (_) {
            return {};
        }
    }

    function registerTabHeartbeat(courseKey, courseTitle, mapId) {
        try {
            const data = {
                courseKey: courseKey || "",
                courseTitle: courseTitle || "",
                mapId: mapId || getCurrentMapId() || "",
                timestamp: Date.now(),
                url: typeof location !== 'undefined' ? location.href : "",
            };
            // 播放器路由可能只含地图 ID，续期必须沿用领取时的课程标识。
            if (currentClaim) Object.assign(data, currentClaim.course);
            localStorage.setItem(TAB_STORAGE_PREFIX + TAB_ID, JSON.stringify(data));
            return true;
        } catch (_) { return false; }
    }

    function unregisterTab() {
        claimGeneration++;
        if (currentClaim) currentClaim.release();
        currentClaim = null;
        removeLocalItem(TAB_STORAGE_PREFIX + TAB_ID);
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('beforeunload', unregisterTab);
    }

    function isCourseBusyByOtherTab(courseKey, courseTitle, mapId) {
        const active = getActiveTabs();
        const effectiveMapId = mapId || getCurrentMapId();
        for (const [id, data] of Object.entries(active)) {
            if (id === TAB_ID || !data) continue;
            if (data.mapId && effectiveMapId && data.mapId !== effectiveMapId) continue;
            if (courseKey && (data.courseKey === courseKey || data.courseKey === `${effectiveMapId}::${courseKey}`)) return true;
            if ((!courseKey || courseKey === courseTitle || !data.courseKey || data.courseKey === data.courseTitle) &&
                courseTitle && (data.courseTitle === courseTitle || data.courseKey === courseTitle)) return true;
        }
        return false;
    }

    async function tryClaimCourseSlot(courseKey, courseTitle, mapId) {
        const course = { courseKey, courseTitle, mapId: mapId || getCurrentMapId() };
        const lockName = '_kme_course_' + JSON.stringify([course.mapId, courseKey || courseTitle]);
        if (currentClaim) {
            if (currentClaim.lockName === lockName) return true;
            logSchedulerWait('当前窗口仍持有另一课程', course);
            return false;
        }
        if (typeof navigator === 'undefined' || !navigator.locks) {
            throw new Error('浏览器不支持跨窗口课程锁，请使用新版 Chrome');
        }
        const generation = claimGeneration;
        const url = location.href;
        // 全局短锁串行完成检查和登记；课程锁持续持有到完成、暂停或关闭。
        return navigator.locks.request('_kme_course_scheduler', async () => {
            if (!state.enabled || generation !== claimGeneration || location.href !== url) return false;
            if (currentClaim) return currentClaim.lockName === lockName;
            const locks = await reconcileCourseHeartbeats();
            if (!state.enabled || generation !== claimGeneration || location.href !== url) return false;
            if (isCourseBusyByOtherTab(courseKey, courseTitle, course.mapId)) {
                logSchedulerWait('课程存在其他窗口占用记录', course, locks);
                return false;
            }
            const occupied = Object.entries(getActiveTabs()).filter(([id, data]) => id !== TAB_ID && data.courseKey).length;
            if (occupied >= getConcurrencySetting()) {
                logSchedulerWait('窗口占用记录已达并发上限', course, locks);
                return false;
            }
            if (locks.held.filter(lock => lock.name.startsWith('_kme_course_slot_')).length >= getConcurrencySetting()) {
                logSchedulerWait('并发名额锁已达上限', course, locks);
                return false;
            }
            for (let slot = 0; slot < getConcurrencySetting(); slot++) {
                const claimed = await new Promise((resolve, reject) => {
                    // 并发名额也持有锁，心跳过期不会使冻结窗口的名额被重复使用。
                    navigator.locks.request('_kme_course_slot_' + slot, { ifAvailable: true }, async slotLock => {
                        if (!slotLock) { resolve(false); return; }
                        await navigator.locks.request(lockName, { ifAvailable: true }, async lock => {
                            if (!lock || !state.enabled || generation !== claimGeneration || location.href !== url) {
                                resolve(false);
                                return;
                            }
                            let release;
                            const held = new Promise(done => { release = done; });
                            currentClaim = { course, lockName, release };
                            if (!registerTabHeartbeat(courseKey, courseTitle, course.mapId)) {
                                currentClaim = null;
                                release();
                                reject(new Error('无法保存课程占用记录，已停止学习'));
                                return;
                            }
                            resolve(true);
                            await held;
                        });
                    }).catch(reject);
                });
                if (claimed) { claimWaitReason = ''; schedulerDiagnosticTimes.clear(); return true; }
                if (!state.enabled || generation !== claimGeneration || location.href !== url) return false;
            }
            logSchedulerWait('课程或并发名额锁暂不可用', course, locks);
            return false;
        });
    }

