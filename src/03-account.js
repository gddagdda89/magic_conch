    // 账号切换时仅清理助手的学习状态，绝不清除平台登录信息或 HUD 偏好。
    const ACCOUNT_ID_KEY = '_kme_account_identity';
    const ACCOUNT_SESSION_KEY = '_kme_session_account';
    const ACCOUNT_EPOCH_KEY = '_kme_account_epoch';
    const ACCOUNT_LEARNING_KEYS = [STORAGE_KEYS.running, STORAGE_KEYS.handledCourses, STORAGE_KEYS.handledMaps,
        STORAGE_KEYS.mapProgress, STORAGE_KEYS.watchdog, STORAGE_KEYS.completionReplay, STORAGE_KEYS.failedVideos,
        STORAGE_KEYS.diagnostics, STORAGE_KEYS.retryEpoch, STORAGE_KEYS.selectedTasks, STORAGE_KEYS.taskCatalog,
        STORAGE_KEYS.activeTabs, '_kme_worker_pending', '_jnftc_context',
        'jinpei_auto_running', 'jinpei_handled_courses', 'jinpei_handled_maps', 'jinpei_map_progress'];
    let accountStale = false;
    let accountStaleNotified = false;

    function accountFingerprint(value) {
        let hash = 2166136261;
        for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
        return PLATFORM + ':' + (hash >>> 0).toString(16) + ':' + value.length;
    }

    function readAccountIdentity() {
        const path = new URL(location.href).pathname;
        if (IS_JNFTC) {
            if (/\/Website\/Index\.aspx$/i.test(path) && !jnLoggedIn()) return 'logged-out';
            return '';
        }
        if (/\/home\/login(?:\/|$)/i.test(path)) return 'logged-out';
        // 与平台 18828/63118 模块一致，优先稳定账号 ID，不把轮换的 token 当账号。
        let id = getStorageItem('accountId');
        if (!id) {
            try { id = JSON.parse(getStorageItem('userInfo') || 'null')?.id; } catch (_) {}
        }
        if (!id) {
            try { id = JSON.parse(getLocalItem('wmy@expire_token', 'null'))?.accountId; } catch (_) {}
        }
        return id ? accountFingerprint(String(id)) : '';
    }

    function clearAccountLearningStorage(includeLocal) {
        for (const key of ACCOUNT_LEARNING_KEYS) {
            try { sessionStorage.removeItem(key); } catch (_) {}
            if (includeLocal) { try { localStorage.removeItem(key); } catch (_) {} }
        }
        if (includeLocal) {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
            for (const key of keys) {
                if (/^_kme_(?:course_outcome_|tab_|task_busy_)/.test(key || '')) localStorage.removeItem(key);
            }
        }
    }

    function checkAccountStorage() {
        if (accountStale) return true;
        try {
            const identity = readAccountIdentity();
            if (!identity) return false;
            const shared = localStorage.getItem(ACCOUNT_ID_KEY);
            const previous = sessionStorage.getItem(ACCOUNT_SESSION_KEY);
            const sharedEpoch = localStorage.getItem(ACCOUNT_EPOCH_KEY);
            const ownEpoch = sessionStorage.getItem(ACCOUNT_EPOCH_KEY);
            if (identity === 'logged-out' && previous === 'logged-out' && shared && shared !== 'logged-out') {
                clearAccountLearningStorage(false); accountStale = true; return true;
            }
            // 旧标签仍持有旧账号的 sessionStorage 时，不能覆盖新账号的全站缓存。
            if (identity !== 'logged-out' && shared && identity !== shared && previous === identity) {
                clearAccountLearningStorage(false); accountStale = true; return true;
            }
            const changed = identity !== shared;
            if (changed) {
                clearAccountLearningStorage(true);
                localStorage.setItem(ACCOUNT_ID_KEY, identity);
                localStorage.setItem(ACCOUNT_EPOCH_KEY, Date.now() + ':' + Math.random());
            } else if (sharedEpoch !== ownEpoch || previous && previous !== identity) {
                clearAccountLearningStorage(false);
            }
            sessionStorage.setItem(ACCOUNT_SESSION_KEY, identity);
            sessionStorage.setItem(ACCOUNT_EPOCH_KEY, localStorage.getItem(ACCOUNT_EPOCH_KEY) || '');
            return changed || sharedEpoch !== ownEpoch || !!previous && previous !== identity;
        } catch (_) { return false; }
    }

    const accountResetOnStartup = checkAccountStorage();

    function syncAccountContext() {
        if (accountStale && accountStaleNotified) return false;
        if (!checkAccountStorage() && !accountStale) return true;
        const running = accountStale ? getLocalItem(STORAGE_KEYS.running) : null;
        pauseAutomation(accountStale ? '登录账号已在其他窗口改变，请刷新此页后重新开始。' : '登录账号已变化，旧学习进度已清空，请重新开始。');
        if (running !== null) setLocalItem(STORAGE_KEYS.running, running);
        if (accountStale) accountStaleNotified = true;
        courseOutcomeMemory.clear();
        taskCatalogMemory = []; taskCatalogAttemptAt = -Infinity; taskSelectionRenderKey = '';
        completionReplayMemory = null; jnContext = {}; jnMedia = null; jnProgress = null;
        lastRetryEpoch = ''; diagnosticLogs = [];
        for (const key of ['currentTask', 'currentCourse', 'currentSubVideo', 'videoProgress', 'allCoursesProgress', 'courseTotalProgress']) state[key] = '';
        state.courseTotalPercent = 0;
        renderTaskSelection(true); updateHUD(state.statusText);
        return false;
    }
