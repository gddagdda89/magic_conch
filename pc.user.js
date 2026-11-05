// ==UserScript==
// @name         神奇海螺
// @namespace    https://github.com/gddagdda89/magic_conch
// @version      1.8.4
// @description  易知与江南金培课程学习助手，自动识别平台，支持课程连播与学习状态检查
// @author       gddagdda89
// @license      MIT
// @homepageURL  https://github.com/gddagdda89/magic_conch
// @supportURL   https://github.com/gddagdda89/magic_conch/issues
// @updateURL    https://gh-proxy.org/https://raw.githubusercontent.com/gddagdda89/magic_conch/refs/heads/main/pc.user.js
// @downloadURL  https://gh-proxy.org/https://raw.githubusercontent.com/gddagdda89/magic_conch/refs/heads/main/pc.user.js
// @match        https://pc.kmelearning.com/*
// @match        https://jnftc.jnbank.com.cn/*
// @noframes
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

const SCRIPT_VERSION = '1.8.4';

    function detectPlatform(url) {
        return /^https:\/\/jnftc\.jnbank\.com\.cn(?:\/|$)/i.test(url) ? 'jnftc' : 'yizhi';
    }
    const PLATFORM = detectPlatform(location.href);
    const IS_JNFTC = PLATFORM === 'jnftc';
    const PLATFORM_NAME = IS_JNFTC ? '江南金培' : '易知';

    console.log(`[${formatLogTimestamp()}]`, "【神奇海螺 v1.8.4】脚本初始化启动...");

    // 配置项
    const CONFIG = {
        checkInterval: 2000,      // 常规轮询检查周期 (ms)
        heartbeatWait: 4000,       // 视频结束后等待最后一次心跳上报的时间 (ms)
        completionReplaySeconds: 30, // 未打勾时重播末尾时长
        maxCompletionReplays: 3,  // 单小节最多重播次数
        replayStartTimeout: 15000, // 回退与恢复播放的总等待时间
        replayPlayMaxAttempts: 3, // 每轮重播内，播放启动请求最多尝试次数
        catalogWaitTimeout: 15000, // 返回目录的最大等待时间 (ms)
        pageReadyTimeout: 20000,  // 进入任务/课程后等待页面实际就绪的时间
        learningRecordWait: 5000, // 平台记录加载的最长等待时间
        completionMarkerWait: 30000, // 总时长达标后额外等待小节完成标记
        myTaskUrl: "https://pc.kmelearning.com/jsncxyslhs/home/my/myTask",
        autoMute: true,           // 自动静音播放
        jnAutoReport: true,       // 金培：移植 Python 的课件时长提交，随后返回课程核验
        jnAutoExam: true,         // 金培：识别页面现成答案并交卷；不支持的题型暂停
        jnExamQuestionDelayMin: 2000, // 金培：每题拟人作答最小间隔 (2 秒)
        jnExamQuestionDelayMax: 5000, // 金培：每题拟人作答最大间隔 (5 秒)
        jnExamWaitPerQuestionMin: 8,  // 金培：整套试卷每题拟人交卷等待最小秒数 (8 秒/题)
        jnExamWaitPerQuestionMax: 15, // 金培：整套试卷每题拟人交卷等待最大秒数 (15 秒/题)
        playbackRate: 1.0,        // 正常播放速度
        debugPlayback: false,    // 排查播放问题时开启详细事件日志，日常使用关闭
        enableJitter: typeof navigator !== 'undefined', // 浏览器真实环境下开启拟人随机时间抖动
        watchdogStallTimeout: 30000,   // 看门狗：视频进度卡住判定超时阈值 (30 秒)
        watchdogMaxReloads: 5,        // 看门狗：单小节卡死最大刷新重试次数 (5 次)
        watchdogMaxConsecutiveFails: 3, // 看门狗：连续卡死加载失败最大容忍小节数 (3 节)
        defaultConcurrency: 1,        // 默认并发课程数 (1)
        maxConcurrency: 6,            // 最大并发课程数 (6)
        updateCheckInterval: 1800000, // 远程新版本自检周期 (30 分钟)
        updateUrl: 'https://gh-proxy.org/https://raw.githubusercontent.com/gddagdda89/magic_conch/refs/heads/main/pc.user.js',
    };

    // 会话存储与跨标签存储脱敏键名映射（前缀去标识化，并兼容历史键名读取）
    const STORAGE_KEYS = {
        running: '_kme_running_state',
        hudPos: '_kme_pref_pos',
        hudCollapsed: '_kme_pref_col',
        handledCourses: '_kme_h_courses',
        handledMaps: '_kme_h_maps',
        mapProgress: '_kme_m_progress',
        watchdog: '_kme_wd_state',       // 看门狗跨刷新状态
        completionReplay: '_kme_sync_replay', // 未打勾重播次数（跨刷新保留）
        failedVideos: '_kme_wd_failed',   // 卡死跳过的小节列表
        concurrency: '_kme_concurrency',  // 并发课程数设置 (1 ~ 6)
        fastMode: '_kme_fast_mode',       // 金培极速模式偏好设置 ('1' 开启，'0' 关闭)
        hudCache: '_kme_hud_cache',       // HUD 界面状态快照缓存（减少跨页面跳转闪动）
        activeTabs: '_kme_active_tabs',   // 并发多标签页活跃状态表
        diagnostics: '_kme_diagnostics', // 当前窗口的最近诊断日志（跨刷新）
        retryEpoch: '_kme_retry_epoch', // 通知暂停窗口清理旧的异常/处理缓存
        selectedTasks: '_kme_selected_tasks', // 用户明确选择的学习地图
        taskCatalog: '_kme_task_catalog', // 只缓存任务 ID 和显示名称，供任意页面选择
        lastUpdateCheck: '_kme_last_update_check', // 最近一次检查远程版本时间戳
        latestVersion: '_kme_latest_version',     // 缓存的远程最新版本号
    };

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

function getStorageItem(keyName, legacyKey) {
        try {
            return sessionStorage.getItem(keyName) ?? (legacyKey ? sessionStorage.getItem(legacyKey) : null);
        } catch (_) {
            return null;
        }
    }

    function setStorageItem(keyName, value) {
        try {
            sessionStorage.setItem(keyName, value);
        } catch (_) {}
    }

    function removeStorageItem(keyName, legacyKey) {
        try {
            sessionStorage.removeItem(keyName);
            if (legacyKey) sessionStorage.removeItem(legacyKey);
        } catch (_) {}
    }

    function getLocalItem(keyName, fallback) {
        try {
            if (typeof localStorage === 'undefined') return fallback;
            const v = localStorage.getItem(keyName);
            return v !== null ? v : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function setLocalItem(keyName, value) {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(keyName, value);
            }
        } catch (_) {}
    }

    function removeLocalItem(keyName) {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.removeItem(keyName);
            }
        } catch (_) {}
    }

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

// 全局状态管理：默认首次打开时不自动运行；若用户手动点击了【开始学习】，则在当前标签页的流转与刷新中持续保持运行！
    const hasLiveActiveTabs = Object.keys(getActiveTabs()).length > 0;
    const isSessionRunning = getStorageItem(STORAGE_KEYS.running, 'jinpei_auto_running') === 'true' ||
        (hasLiveActiveTabs && getLocalItem(STORAGE_KEYS.running) === 'true');

    function initFastModeSetting() {
        const pref = getLocalItem(STORAGE_KEYS.fastMode, '1');
        CONFIG.jnAutoReport = pref !== '0';
    }
    initFastModeSetting();

    function setFastModeSetting(enabled) {
        CONFIG.jnAutoReport = Boolean(enabled);
        setLocalItem(STORAGE_KEYS.fastMode, CONFIG.jnAutoReport ? '1' : '0');
    }

    const state = {
        enabled: isSessionRunning,
        concurrency: getConcurrencySetting(),
        statusText: isSessionRunning ? "正在自动流转中..." : "待启动（请点击【开始学习】）",
        currentTask: "",
        currentCourse: "",
        currentSubVideo: "",
        videoProgress: "",
        allCoursesProgress: "",    // 全部课程进度 x/n (如 "2 / 3 门 (66%)")
        courseTotalProgress: "",   // 当前课程总进度 (如 "4/8 节 · 00:52:31 / 01:51:41 (47%)")
        courseTotalPercent: 0,
        isSwitching: false,
        isActionPending: false,    // 防重复调度与并发点击锁
        syncRetryCount: 0,         // 当前小节心跳同步重试计数
        lastJumpTime: 0,
        lastTabSpawnTime: 0,       // 并发子窗口唤起防抖节流
        remoteVersion: '',         // 远程检测到的最新版本号
    };

    const COURSE_OUTCOME_PREFIX = '_kme_course_outcome_';
    const courseOutcomeMemory = new Map();
    let lastRetryEpoch = getStorageItem(STORAGE_KEYS.retryEpoch) || '';
    let learningRecordPending = false;

    function getCourseOutcomes() {
        const results = new Map(courseOutcomeMemory);
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith(COURSE_OUTCOME_PREFIX)) continue;
                try {
                    const value = JSON.parse(localStorage.getItem(key));
                    if (value && Array.isArray(value.aliases) && Array.isArray(value.failedSubKeys) && ['completed', 'skipped', 'exam'].includes(value.status)) results.set(key, value);
                } catch (_) {}
            }
        } catch (_) {}
        return [...results.values()];
    }

    function saveCourseOutcome(status, failedSubKeys = []) {
        const mapId = currentClaim?.course.mapId || getCurrentMapId() || 'global';
        const title = currentClaim?.course.courseTitle || getCurrentCourseTitle() || 'unknown';
        const key = getCurrentCourseId() || currentClaim?.course.courseKey || title;
        const storageKey = COURSE_OUTCOME_PREFIX + JSON.stringify([mapId, key]);
        const previous = getCourseOutcomes().find(value => value.mapId === mapId && value.aliases.includes(key));
        const value = { mapId, mapTitle: state.currentTask || getMapTitleFromPage(), title, status,
            aliases: [key], failedSubKeys: [...new Set([...(previous?.failedSubKeys || []), ...failedSubKeys])], updatedAt: Date.now() };
        if (status === 'completed') value.failedSubKeys = [];
        try {
            localStorage.setItem(storageKey, JSON.stringify(value));
            if (previous) {
                const previousKey = COURSE_OUTCOME_PREFIX + JSON.stringify([previous.mapId, previous.aliases[0]]);
                if (previousKey !== storageKey) { removeLocalItem(previousKey); courseOutcomeMemory.delete(previousKey); }
            }
            courseOutcomeMemory.set(storageKey, value);
            updateOutcomeHUD();
            return true;
        } catch (_) {
            pauseAutomation('无法保存课程处理结果，已暂停；请检查浏览器存储空间。');
            return false;
        }
    }

    function getCourseDisposition(item, mapId) {
        if (isItemCompleted(item)) return 'completed';
        const key = getCourseKeyFromItem(item);
        const title = (item.innerText || '').split('\n')[0].trim();
        const outcome = getCourseOutcomes().find(value => value.mapId === mapId && value.aliases.includes(key));
        if (outcome) return outcome.status;
        // 历史版本只记录“已处理”，不能据此声称平台已完成。
        if (isCourseHandled(mapId, key) || (key === title && isCourseHandled(mapId, title))) return 'unverified';
        return 'pending';
    }

    function updateOutcomeHUD() {
        const results = getCourseOutcomes();
        const skipped = results.filter(value => value.status === 'skipped').length;
        const exams = results.filter(value => value.status === 'exam').length;
        const unverified = getHandledCourses().filter(key => !results.some(value => value.aliases.some(alias => key === `${value.mapId}::${alias}`))).length;
        const row = getHUDElement('jinpei-outcome-row');
        const text = getHUDElement('jinpei-outcome-summary');
        const retry = getHUDElement('jinpei-retry-skipped');
        if (row) row.style.display = skipped || exams || unverified ? 'flex' : 'none';
        if (text) text.innerText = `异常跳过 ${skipped} 门 · 待考试 ${exams} 门` + (unverified ? ` · 待核验 ${unverified}` : '');
        if (retry) retry.style.display = skipped || unverified ? 'inline-block' : 'none';
    }

    function syncRetryEpoch() {
        const epoch = getLocalItem(STORAGE_KEYS.retryEpoch, '');
        if (epoch === lastRetryEpoch) return;
        lastRetryEpoch = epoch;
        setStorageItem(STORAGE_KEYS.retryEpoch, epoch);
        courseOutcomeMemory.clear();
        removeStorageItem(STORAGE_KEYS.failedVideos);
        removeStorageItem(STORAGE_KEYS.handledCourses, 'jinpei_handled_courses');
        removeStorageItem(STORAGE_KEYS.handledMaps, 'jinpei_handled_maps');
        clearWatchdogState();
        completionReplayGeneration++;
        completionReplayMemory = null;
        removeStorageItem(STORAGE_KEYS.completionReplay);
    }

    function retrySkippedCourses() {
        if (Object.entries(getActiveTabs()).some(([id, value]) => id !== TAB_ID && value.courseKey)) {
            updateHUD('请先暂停其他学习窗口，再重试异常课程。');
            return false;
        }
        pauseAutomation('异常记录已清理，请点击开始重新检查未完成课程。');
        const skipped = getCourseOutcomes().filter(value => value.status === 'skipped');
        const affectedMaps = new Set(skipped.flatMap(value => [value.mapId, value.mapTitle]).filter(Boolean));
        const hasUnverified = getHandledCourses().some(key => !getCourseOutcomes().some(value => value.aliases.some(alias => key === `${value.mapId}::${alias}`)));
        const keepCourses = getHandledCourses().filter(key => {
            const typed = getCourseOutcomes().find(value => value.aliases.some(alias => key === `${value.mapId}::${alias}`));
            return typed && typed.status !== 'skipped';
        });
        const keepMaps = skipped.length && !hasUnverified ? getHandledMaps().filter(key => !affectedMaps.has(key)) : [];
        for (const value of skipped) for (const alias of value.aliases) removeLocalItem(COURSE_OUTCOME_PREFIX + JSON.stringify([value.mapId, alias]));
        setLocalItem(STORAGE_KEYS.handledCourses, JSON.stringify(keepCourses));
        setLocalItem(STORAGE_KEYS.handledMaps, JSON.stringify(keepMaps));
        setLocalItem(STORAGE_KEYS.retryEpoch, Date.now() + ':' + Math.random());
        syncRetryEpoch();
        updateOutcomeHUD();
        diagnosticConsole.log('已清理异常跳过记录，保留已完成和待考试课程。');
        return true;
    }

// [防检测 1: 拟人随机数与时间抖动发生器 Human Jitter]
    function randomBetween(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // [防检测 2: 拟人化真实坐标与鼠标事件链点击 Simulated Human Click]
    function simulateHumanClick(el) {
        if (!el) return;
        try {
            const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
            let x = 0, y = 0;
            if (rect && rect.width > 0 && rect.height > 0) {
                const rx = 0.25 + 0.5 * Math.random();
                const ry = 0.25 + 0.5 * Math.random();
                x = Math.round(rect.left + rect.width * rx);
                y = Math.round(rect.top + rect.height * ry);
            } else if (typeof window !== 'undefined') {
                x = Math.round((window.innerWidth || 1024) / 2 + (Math.random() * 40 - 20));
                y = Math.round((window.innerHeight || 768) / 2 + (Math.random() * 40 - 20));
            }

            const commonProps = {
                bubbles: true,
                cancelable: true,
                view: typeof window !== 'undefined' ? window : null,
                clientX: x,
                clientY: y,
                screenX: x + 10,
                screenY: y + 10,
            };

            if (typeof MouseEvent === 'function' && typeof el.dispatchEvent === 'function') {
                el.dispatchEvent(new MouseEvent('mouseover', commonProps));
                el.dispatchEvent(new MouseEvent('mousemove', commonProps));
                el.dispatchEvent(new MouseEvent('mousedown', { ...commonProps, buttons: 1, button: 0 }));
                el.dispatchEvent(new MouseEvent('mouseup', { ...commonProps, buttons: 0, button: 0 }));
                el.dispatchEvent(new MouseEvent('click', { ...commonProps, buttons: 0, button: 0 }));
                // 已派发一次 click，不能再调用 .click()；即使默认行为被取消也不重复点击。
                return;
            }
        } catch (_) {}

        if (typeof el.click === 'function') {
            el.click();
        }
    }

    // [防检测 3: 原生函数伪装与特征隐藏 Native Function Masquerade]
    const nativeFnToString = Function.prototype.toString;
    const hookedFunctions = new WeakMap();

    function makeNativeFunction(fn, original, name) {
        if (typeof fn !== 'function') return fn;
        const fnName = name || original?.name || fn.name || '';
        const nativeString = `function ${fnName}() { [native code] }`;
        hookedFunctions.set(fn, nativeString);
        try {
            Object.defineProperty(fn, 'name', { value: fnName, configurable: true });
            Object.defineProperty(fn, 'length', { value: original ? original.length : fn.length, configurable: true });
            const toStringFn = function toString() {
                if (this === fn || this === toStringFn) return nativeString;
                return nativeFnToString.call(this);
            };
            hookedFunctions.set(toStringFn, `function toString() { [native code] }`);
            Object.defineProperty(fn, 'toString', { value: toStringFn, writable: true, configurable: true });
        } catch (_) {}
        return fn;
    }

    try {
        const patchedToString = function toString() {
            if (hookedFunctions.has(this)) return hookedFunctions.get(this);
            return nativeFnToString.call(this);
        };
        hookedFunctions.set(patchedToString, `function toString() { [native code] }`);
        Object.defineProperty(Function.prototype, 'toString', {
            value: patchedToString,
            writable: true,
            configurable: true,
        });
    } catch (_) {}

    // [防检测 4: 跨标签 Web Locks 与存储特征脱敏隐藏]
    function enableLockStealth() {
        if (typeof navigator === 'undefined' || !navigator.locks || typeof navigator.locks.query !== 'function') return;
        if (navigator.locks.query.__isStealth) return;
        const origQuery = navigator.locks.query.bind(navigator.locks);
        const stealthQuery = makeNativeFunction(async function query(options) {
            const result = await origQuery();
            if (options?.__internal) return result;
            return {
                held: (result.held || []).filter(l => !l.name?.startsWith('_kme_') && !l.name?.startsWith('jinpei_')),
                pending: (result.pending || []).filter(l => !l.name?.startsWith('_kme_') && !l.name?.startsWith('jinpei_')),
            };
        }, origQuery, 'query');
        stealthQuery.__isStealth = true;
        navigator.locks.query = stealthQuery;
    }

    function enableStorageStealth() {
        if (typeof window === 'undefined' || !window.Storage) return;
        if (Storage.prototype.key.__isStealth) return;
        const isHidden = key => typeof key === 'string' && (key.startsWith('_kme_') || key.startsWith('jinpei_'));
        const origKey = Storage.prototype.key;
        if (typeof origKey === 'function') {
            const stealthKey = makeNativeFunction(function key(index) {
                const visible = [];
                for (let i = 0; i < this.length; i++) {
                    const k = origKey.call(this, i);
                    if (k && !isHidden(k)) visible.push(k);
                }
                return visible[index] !== undefined ? visible[index] : null;
            }, origKey, 'key');
            stealthKey.__isStealth = true;
            Storage.prototype.key = stealthKey;
        }
    }

// [防检测 4: Shadow DOM 内部元素寻址隔离器]
    let hudShadowRoot = null;
    function getHUDElement(id) {
        if (hudShadowRoot?.host?.isConnected === false) hudShadowRoot = null;
        if (hudShadowRoot && typeof hudShadowRoot.getElementById === 'function') {
            return hudShadowRoot.getElementById(id) || (typeof document.getElementById === 'function' ? document.getElementById(id) : null);
        }
        return typeof document.getElementById === 'function' ? document.getElementById(id) : null;
    }

    // 定时器集中管理器：支持暂停时一键清空所有已安排的定时任务（真实运行下自动加入拟人时间抖动）
    const activeTimers = new Set();
    let pageWaitGeneration = 0;
    let pageWaitActive = false;
    const DIAGNOSTIC_LIMIT = 200;
    let diagnosticLogs = [];
    try {
        const saved = JSON.parse(getStorageItem(STORAGE_KEYS.diagnostics) || '[]');
        if (Array.isArray(saved)) diagnosticLogs = saved.filter(entry => entry && Number.isFinite(entry.time) && typeof entry.message === 'string').slice(-DIAGNOSTIC_LIMIT);
    } catch (_) {}

    // 只收集本脚本的日志，不替换网页的 console；页面上下文仅保存路径。
    function recordDiagnostic(level, ...args) {
        const message = args.map(value => {
            if (value && typeof value.message === 'string') return `${value.name || 'Error'}: ${value.message}`;
            if (typeof value === 'string') return value;
            try { return JSON.stringify(value) ?? String(value); } catch (_) { return String(value); }
        }).join(' ').slice(0, 1200);
        diagnosticLogs.push({ time: Date.now(), level, tab: TAB_ID, message, platform: PLATFORM_NAME,
            task: state.currentTask, course: state.currentCourse, sub: state.currentSubVideo,
            syncRetry: state.syncRetryCount, route: location.href.split(/[?#]/)[0].replace(/^https?:\/\/[^/]+/, '') });
        diagnosticLogs = diagnosticLogs.slice(-DIAGNOSTIC_LIMIT);
        setStorageItem(STORAGE_KEYS.diagnostics, JSON.stringify(diagnosticLogs));
        renderDiagnosticLogs();
    }

    function formatLogTimestamp(timestamp = Date.now()) {
        const date = new Date(timestamp);
        const pad = (value, length = 2) => String(value).padStart(length, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
            `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
    }

    const diagnosticConsole = Object.fromEntries(['log', 'warn', 'error'].map(method => [method, (...args) => {
        console[method](`[${formatLogTimestamp()}]`, ...args);
        recordDiagnostic(method === 'log' ? 'INFO' : method.toUpperCase(), ...args);
    }]));

    function formatDiagnosticLogs() {
        return '神奇海螺诊断日志\n' + diagnosticLogs.map(entry =>
            `[${formatLogTimestamp(entry.time)}] [${entry.level}] [${entry.tab}] ${entry.message}\n` +
            `  平台=${entry.platform || '易知'} 任务=${entry.task || '-'} 课程=${entry.course || '-'} 小节=${entry.sub || '-'} 同步重试=${entry.syncRetry || 0} 页面=${entry.route || '-'}`
        ).join('\n');
    }

    // 仅观察播放事件；不改写播放器属性，不记录含鉴权参数的媒体地址。
    const playbackDiagnostics = new WeakMap();
    let diagnosticVideo = null;
    let diagnosticVideoId = 0;
    function observeVideoPlayback(video) {
        if (!video) return;
        let tracker = playbackDiagnostics.get(video);
        if (!tracker) {
            tracker = { id: ++diagnosticVideoId, previous: null, source: null, sourceRevision: 0, lastLogged: 0 };
            playbackDiagnostics.set(video, tracker);
            if (typeof video.addEventListener === 'function') {
                for (const event of ['timeupdate', 'seeking', 'seeked', 'ended', 'emptied', 'loadstart', 'loadedmetadata', 'durationchange', 'play', 'playing', 'pause', 'waiting', 'stalled', 'error']) {
                    // ended 使用捕获阶段，先记住结束的小节，再让平台执行归零/自动连播。
                    video.addEventListener(event, () => sample(event), event === 'ended');
                }
            }
        }
        const replaced = diagnosticVideo !== video;
        diagnosticVideo = video;
        sample(replaced ? '播放器出现或替换' : '轮询');

        function sample(event) {
            if (!state.enabled || document.querySelector('video') !== video) return;
            const source = video.currentSrc || video.src || '';
            const requestedSource = video.src || '';
            const previousIdentity = tracker.identity;
            const previous = tracker.previous;
            const sourceChanged = tracker.source !== null && tracker.source !== source;
            if (tracker.source !== source) { tracker.source = source; tracker.sourceRevision++; }
            const active = getAllSubVideoItems().find(isSubVideoActive);
            const snapshot = {
                player: tracker.id, sourceRevision: tracker.sourceRevision,
                subKey: active ? getSubVideoKey(active) : '',
                currentTime: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : null,
                ended: video.ended, paused: video.paused, seeking: video.seeking,
                readyState: video.readyState, switching: state.isSwitching,
                actionPending: state.isActionPending, completed: active ? isItemCompleted(active) : null,
                mediaError: video.error?.code || null,
            };
            // 平台的 ended 回调可能已将进度和 ended 属性重置；事件本身仍是结束依据。
            const identity = { subKey: snapshot.subKey, source, requestedSource, url: location.href };
            const sameIdentity = previousIdentity && Object.keys(identity).every(key => identity[key] === previousIdentity[key]);
            if (previousIdentity && !sameIdentity && active) tracker.version = (tracker.version || 0) + 1;
            const wasAtTail = previous && previous.duration > 0 && previous.currentTime >= previous.duration - 2.5;
            if (event === 'ended' && active && sameIdentity && (video.ended || wasAtTail)) {
                tracker.completion = identity;
                if (CONFIG.debugPlayback) diagnosticConsole.log('播放诊断：已记住结束事件，等待完成确认', {
                    subKey: snapshot.subKey, currentTime: snapshot.currentTime, duration: snapshot.duration,
                });
            } else if (event === 'ended') {
                if (CONFIG.debugPlayback) diagnosticConsole.warn('播放诊断：忽略与当前小节不匹配的旧结束事件');
            }
            const backwards = previous && snapshot.currentTime < previous.currentTime - 2;
            const sectionChanged = previous && previous.subKey !== snapshot.subKey;
            const periodic = Date.now() - tracker.lastLogged >= 15000;
            if (CONFIG.debugPlayback && (backwards || sourceChanged || sectionChanged || periodic || (event !== '轮询' && event !== 'timeupdate'))) {
                diagnosticConsole[backwards ? 'warn' : 'log'](`播放诊断：${backwards ? '进度回退' : event}`, {
                    event, sourceChanged, sectionChanged, previous, current: snapshot,
                });
                tracker.lastLogged = Date.now();
            }
            tracker.previous = snapshot;
            if (active) tracker.identity = identity;
        }
    }

    function hasPlaybackCompletion(video, activeSubEl) {
        const tracker = playbackDiagnostics.get(video);
        const completion = tracker?.completion;
        if (!completion) return false;
        if (!activeSubEl || completion.subKey !== getSubVideoKey(activeSubEl) ||
            completion.url !== location.href || completion.source !== (video.currentSrc || video.src || '') ||
            completion.requestedSource !== (video.src || '')) {
            delete tracker.completion;
            return false;
        }
        return true;
    }

    function capturePlaybackScope(subEl = getAllSubVideoItems().find(isSubVideoActive)) {
        const video = document.querySelector('video');
        return { video, url: location.href, source: video?.currentSrc || video?.src || '',
            requestedSource: video?.src || '', subKey: subEl ? getSubVideoKey(subEl) : '',
            version: playbackDiagnostics.get(video)?.version || 0, claimGeneration };
    }

    function isPlaybackScopeCurrent(scope, allowMissingSub = false) {
        if (!state.enabled || scope.claimGeneration !== claimGeneration || scope.url !== location.href ||
            document.querySelector('video') !== scope.video ||
            (scope.video?.currentSrc || scope.video?.src || '') !== scope.source ||
            (scope.video?.src || '') !== scope.requestedSource ||
            (playbackDiagnostics.get(scope.video)?.version || 0) !== scope.version) return false;
        const active = getAllSubVideoItems().find(isSubVideoActive);
        return active ? getSubVideoKey(active) === scope.subKey : allowMissingSub || !scope.subKey;
    }

    function cancelStalePlaybackWait() {
        state.isSwitching = false;
        state.isActionPending = false;
        state.syncRetryCount = 0;
        diagnosticConsole.log('播放诊断：小节或媒体已切换，取消旧同步等待');
    }

    function renderDiagnosticLogs() {
        const panel = getHUDElement('jinpei-diagnostics');
        const output = getHUDElement('jinpei-diagnostics-output');
        if (panel && panel.open && output) output.value = formatDiagnosticLogs();
    }

    function clearDiagnosticLogs() {
        diagnosticLogs = [];
        removeStorageItem(STORAGE_KEYS.diagnostics);
        const notice = getHUDElement('jinpei-diagnostics-notice');
        if (notice) notice.innerText = '已清空';
        renderDiagnosticLogs();
    }

    async function copyDiagnosticLogs() {
        const notice = getHUDElement('jinpei-diagnostics-notice');
        try {
            await navigator.clipboard.writeText(formatDiagnosticLogs());
            if (notice) notice.innerText = '已复制';
            return true;
        } catch (_) {
            const panel = getHUDElement('jinpei-diagnostics');
            if (panel) panel.open = true;
            renderDiagnosticLogs();
            const output = getHUDElement('jinpei-diagnostics-output');
            if (output && typeof output.select === 'function') { output.focus(); output.select(); }
            if (notice) notice.innerText = '请按 Ctrl+C 复制';
            return false;
        }
    }

    function waitForPageReady(label, isReady, timeout = CONFIG.pageReadyTimeout) {
        const generation = ++pageWaitGeneration;
        const startedAt = Date.now();
        const previousStatus = state.statusText;
        pageWaitActive = true;
        state.isActionPending = true;
        diagnosticConsole.log(`等待页面就绪：${label}`);
        function poll() {
            if (!state.enabled || generation !== pageWaitGeneration) return;
            try {
                if (isReady()) {
                    pageWaitActive = false;
                    state.isActionPending = false;
                    state.isSwitching = false;
                    state.syncRetryCount = 0;
                    diagnosticConsole.log(`页面已就绪：${label}（${Date.now() - startedAt}ms）`);
                    return;
                }
                if (Date.now() - startedAt >= timeout) {
                    pauseAutomation(`${label}超时，已暂停；请检查页面后重新开始。`);
                    return;
                }
                if (currentClaim && !registerTabHeartbeat()) throw new Error('无法续期课程占用记录');
                updateHUD(`${previousStatus} · 等待${label}...`);
                setManagedTimeout(poll, 500);
            } catch (error) {
                pauseAutomation(`${label}失败：${error.message}`);
            }
        }
        poll();
    }
    function setManagedTimeout(fn, delay) {
        let actualDelay = delay;
        // 在浏览器真实环境下引入 15% 随机时间抖动，抹除固定的机器定时特征（Node单元测试环境保持精准）
        if (CONFIG.enableJitter && typeof delay === 'number' && delay > 0) {
            const variance = Math.max(50, Math.floor(delay * 0.15));
            actualDelay = randomBetween(delay - variance, delay + variance);
        }
        let timerId = null;
        timerId = setTimeout(() => {
            activeTimers.delete(timerId);
            if (!state.enabled) return; // 执行前二次校验运行状态
            fn();
        }, actualDelay);
        activeTimers.add(timerId);
        return timerId;
    }

    function clearAllManagedTimeouts() {
        for (const t of activeTimers) {
            clearTimeout(t);
        }
        activeTimers.clear();
    }

    function pauseAutomation(message) {
        chapterCatalogRuntime = null;
        chapterCatalogWaitPending = false;
        chapterCatalogWaitGeneration++;
        learningRecordPending = false;
        pageWaitGeneration++;
        pageWaitActive = false;
        diagnosticConsole.warn('自动学习暂停：', message);
        completionReplayGeneration++;
        completionReplayMemory = null;
        removeStorageItem(STORAGE_KEYS.completionReplay);
        state.enabled = false;
        removeStorageItem(STORAGE_KEYS.running, 'jinpei_auto_running');
        removeLocalItem(STORAGE_KEYS.running);
        unregisterTab();
        clearAllManagedTimeouts();
        clearWatchdogState();
        state.isSwitching = false;
        state.isActionPending = false;
        state.syncRetryCount = 0;

        const video = document.querySelector('video');
        if (video && !video.paused) video.pause();
        if (IS_JNFTC) pauseJnPlayback();

        const icon = getHUDElement('jinpei-btn-icon');
        const text = getHUDElement('jinpei-btn-text');
        const button = getHUDElement('jinpei-toggle-btn');
        const dot = getHUDElement('jinpei-hud-dot');
        const status = getHUDElement('jinpei-hud-status');
        if (icon) icon.innerText = "▶";
        if (text) text.innerText = "开始自动学习";
        if (button) {
            button.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
            button.style.boxShadow = "0 4px 14px rgba(16, 185, 129, 0.3)";
        }
        if (dot) {
            dot.style.background = "#f59e0b";
            dot.style.animation = "jinpei-amber-pulse 2s infinite ease-in-out";
        }
        if (status) status.style.color = "#d97706";
        updateHUD(message);
    }

// ==========================================
    // 后台标签页 Worker 防休眠机制
    // 利用独立 Web Worker 线程的心跳调度，彻底免疫 Chromium 对后台标签页的定时器节流降频
    // ==========================================
    function createWorkerInterval(callback, intervalMs) {
        const minInterval = Math.max(200, intervalMs || 2000);

        // 在 Node.js 测试环境或不支持 Web Worker 的环境平滑回退至原生 setInterval
        if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
            const id = typeof setInterval === 'function' ? setInterval(callback, minInterval) : null;
            return {
                type: 'interval',
                id,
                clear() {
                    try {
                        if (typeof clearInterval === 'function') clearInterval(id);
                    } catch (_) {}
                }
            };
        }

        try {
            const workerCode = `
                let timer = null;
                self.onmessage = function(e) {
                    if (e.data && e.data.type === 'start') {
                        if (timer) clearInterval(timer);
                        timer = setInterval(function() {
                            self.postMessage({ type: 'tick' });
                        }, Math.max(200, e.data.interval || 2000));
                    } else if (e.data && e.data.type === 'stop') {
                        if (timer) {
                            clearInterval(timer);
                            timer = null;
                        }
                    }
                };
            `;
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            const worker = new Worker(workerUrl);

            worker.onmessage = function(e) {
                if (e.data && e.data.type === 'tick') {
                    try {
                        callback();
                    } catch (err) {
                        console.error('[神奇海螺] Worker 定时执行回调异常:', err);
                    }
                }
            };

            worker.postMessage({ type: 'start', interval: minInterval });

            return {
                type: 'worker',
                worker,
                workerUrl,
                clear() {
                    try {
                        worker.postMessage({ type: 'stop' });
                        worker.terminate();
                        URL.revokeObjectURL(workerUrl);
                    } catch (_) {}
                }
            };
        } catch (_) {
            // 如遇到严格 CSP 限制（如禁止 blob: Worker），自动降级为原生 setInterval
            const id = typeof setInterval === 'function' ? setInterval(callback, minInterval) : null;
            return {
                type: 'interval',
                id,
                clear() {
                    try {
                        if (typeof clearInterval === 'function') clearInterval(id);
                    } catch (_) {}
                }
            };
        }
    }

// ==========================================
    // 1. 悬浮 HUD 状态面板（现代浅色高透光磨砂玻璃态设计 + 可拖拽 + 折叠）
    // ==========================================
    // ==========================================
    // 1. 悬浮 HUD 状态面板（现代浅色高透光磨砂玻璃态设计 + Shadow DOM 隔离 + 可拖拽 + 折叠）
    // ==========================================
    function ensureHUDStyles(targetRoot) {
        const root = targetRoot || document.head || document.body;
        if (!root) return;
        if (root.querySelector && root.querySelector('#jinpei-hud-styles')) return;
        const style = document.createElement('style');
        style.id = 'jinpei-hud-styles';
        style.innerHTML = `
            @keyframes jinpei-pulse {
                0% { transform: scale(0.92); opacity: 0.7; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
                70% { transform: scale(1.08); opacity: 1; box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
                100% { transform: scale(0.92); opacity: 0.7; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
            }
            @keyframes jinpei-amber-pulse {
                0% { transform: scale(0.92); opacity: 0.7; box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.6); }
                70% { transform: scale(1.08); opacity: 1; box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
                100% { transform: scale(0.92); opacity: 0.7; box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
            }
            .jinpei-glass, .jinpei-glass * {
                box-sizing: border-box !important;
            }
            .jinpei-glass {
                position: fixed;
                z-index: 999999;
                /* 浅色高通透 Apple 风格毛玻璃 */
                background: rgba(255, 255, 255, 0.42) !important;
                backdrop-filter: blur(16px) saturate(180%) !important;
                -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
                border: 1px solid rgba(255, 255, 255, 0.55) !important;
                border-radius: 18px !important;
                box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.6) inset, 0 2px 4px rgba(0, 0, 0, 0.04) !important;
                color: #1e293b !important;
                font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
                user-select: none;
                overflow: hidden;
                white-space: nowrap !important;
                transition: transform 0.2s ease, box-shadow 0.25s ease, border-color 0.25s ease, width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            .jinpei-glass:hover {
                background: rgba(255, 255, 255, 0.58) !important;
                border-color: rgba(255, 255, 255, 0.7) !important;
                box-shadow: 0 24px 48px -10px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.8) inset !important;
            }
            /* 折叠/最小化状态：紧凑单个海螺悬浮图标，隐藏标题 */
            .jinpei-glass.jinpei-collapsed {
                border-radius: 50% !important;
                width: 42px !important;
                height: 42px !important;
                min-width: 42px !important;
                cursor: pointer !important;
                overflow: visible !important;
                box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.14), 0 0 0 1px rgba(255, 255, 255, 0.75) inset !important;
                transition: transform 0.2s ease, box-shadow 0.25s ease, border-color 0.25s ease, width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            .jinpei-glass.jinpei-collapsed:hover {
                transform: scale(1.08);
                box-shadow: 0 12px 28px -4px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.9) inset !important;
            }
            .jinpei-glass.jinpei-collapsed #jinpei-hud-top-bar,
            .jinpei-glass.jinpei-collapsed #jinpei-hud-title-text,
            .jinpei-glass.jinpei-collapsed #jinpei-hud-version,
            .jinpei-glass.jinpei-collapsed #jinpei-hud-update-badge,
            .jinpei-glass.jinpei-collapsed #jinpei-hud-header-right,
            .jinpei-glass.jinpei-collapsed #jinpei-hud-body {
                display: none !important;
            }
            .jinpei-glass.jinpei-collapsed #jinpei-hud-header {
                width: 42px !important;
                height: 42px !important;
                padding: 0 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                border-bottom: none !important;
                position: relative !important;
                cursor: pointer !important;
            }
            #jinpei-hud-header {
                transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1), padding 0.25s ease !important;
            }
            #jinpei-hud-icon {
                transition: font-size 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            #jinpei-hud-dot {
                transition: top 0.25s ease, right 0.25s ease, width 0.25s ease, height 0.25s ease, box-shadow 0.25s ease !important;
            }
            .jinpei-glass.jinpei-collapsed #jinpei-hud-header-left {
                width: 100% !important;
                height: 100% !important;
                justify-content: center !important;
                align-items: center !important;
                gap: 0 !important;
            }
            .jinpei-glass.jinpei-collapsed #jinpei-hud-icon {
                font-size: 21px !important;
                display: inline-block !important;
                line-height: 1 !important;
            }
            .jinpei-glass.jinpei-collapsed #jinpei-hud-dot {
                position: absolute !important;
                top: 7px !important;
                right: 7px !important;
                width: 7px !important;
                height: 7px !important;
                box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.95) !important;
                z-index: 2 !important;
            }
            .jinpei-info-box {
                background: rgba(255, 255, 255, 0.18);
                border: 1px solid rgba(255, 255, 255, 0.55);
                border-radius: 12px;
                padding: 10px 12px;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02) inset;
            }
            .jinpei-btn-action {
                cursor: pointer;
                border: none;
                outline: none;
                border-radius: 9px;
                font-weight: 600;
                font-size: 13px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .jinpei-btn-action:hover {
                filter: brightness(1.08);
                transform: translateY(-1px);
            }
            .jinpei-btn-action:active {
                transform: translateY(1px);
                filter: brightness(0.96);
            }
            .jinpei-icon-btn {
                background: rgba(0, 0, 0, 0.04);
                border: 1px solid rgba(0, 0, 0, 0.06);
                color: #64748b;
                width: 24px;
                height: 24px;
                border-radius: 6px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font-size: 13px;
                line-height: 1;
                transition: all 0.2s ease;
            }
            .jinpei-icon-btn:hover {
                background: rgba(0, 0, 0, 0.08);
                color: #0f172a;
                border-color: rgba(0, 0, 0, 0.12);
            }
            /* 次级与工具按钮（全选、清空、刷新任务、复制/清空日志等） */
            .jinpei-btn-sub {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                padding: 3px 8px;
                font-size: 11px;
                font-weight: 500;
                color: #334155;
                background: rgba(255, 255, 255, 0.65);
                border: 1px solid rgba(0, 0, 0, 0.09);
                border-radius: 6px;
                cursor: pointer;
                outline: none;
                line-height: 1.4;
                transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
                user-select: none;
            }
            .jinpei-btn-sub:hover:not(:disabled) {
                background: #ffffff;
                color: #0284c7;
                border-color: rgba(2, 132, 199, 0.35);
                box-shadow: 0 2px 6px rgba(2, 132, 199, 0.18);
                transform: translateY(-1px);
            }
            .jinpei-btn-sub:active:not(:disabled) {
                transform: translateY(0);
                filter: brightness(0.96);
            }
            .jinpei-btn-sub:disabled {
                opacity: 0.45;
                cursor: not-allowed;
                border-color: rgba(0, 0, 0, 0.05);
                background: rgba(0, 0, 0, 0.02);
                color: #94a3b8;
                transform: none !important;
                box-shadow: none !important;
            }
            .jinpei-btn-sub.jinpei-btn-primary {
                color: #0284c7;
                background: rgba(2, 132, 199, 0.08);
                border-color: rgba(2, 132, 199, 0.25);
                font-weight: 600;
            }
            .jinpei-btn-sub.jinpei-btn-primary:hover:not(:disabled) {
                background: #0284c7;
                color: #ffffff;
                border-color: #0284c7;
                box-shadow: 0 2px 8px rgba(2, 132, 199, 0.3);
            }
            .jinpei-btn-sub.jinpei-btn-danger:hover:not(:disabled) {
                color: #ef4444;
                border-color: rgba(239, 68, 68, 0.3);
                background: rgba(254, 242, 242, 0.9);
                box-shadow: 0 2px 6px rgba(239, 68, 68, 0.18);
            }
            /* 折叠详情栏与指示箭头 */
            .jinpei-summary {
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: pointer;
                font-size: 11px;
                font-weight: 600;
                color: #475569;
                padding: 6px 9px;
                background: rgba(255, 255, 255, 0.4);
                border: 1px solid rgba(255, 255, 255, 0.65);
                border-radius: 8px;
                transition: all 0.2s ease;
                user-select: none;
                list-style: none;
            }
            .jinpei-summary::-webkit-details-marker {
                display: none;
            }
            .jinpei-summary:hover {
                background: rgba(255, 255, 255, 0.7);
                color: #0f172a;
                border-color: rgba(255, 255, 255, 0.9);
            }
            .jinpei-summary-arrow {
                font-size: 11px;
                line-height: 1;
                color: #94a3b8;
                transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), color 0.2s ease;
                display: inline-block;
            }
            details[open] > .jinpei-summary .jinpei-summary-arrow {
                transform: rotate(90deg);
                color: #0284c7;
            }
            details[open] > .jinpei-summary {
                border-bottom-left-radius: 0;
                border-bottom-right-radius: 0;
                background: rgba(255, 255, 255, 0.6);
                border-bottom-color: rgba(0, 0, 0, 0.04);
            }
            .jinpei-details-body {
                background: rgba(255, 255, 255, 0.26);
                border: 1px solid rgba(255, 255, 255, 0.65);
                border-top: none;
                border-bottom-left-radius: 8px;
                border-bottom-right-radius: 8px;
                padding: 8px 10px;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02) inset;
            }
            /* 自定义现代复选框与任务选项 */
            .jinpei-checkbox {
                appearance: none;
                -webkit-appearance: none;
                width: 14px;
                height: 14px;
                border: 1.5px solid #cbd5e1;
                border-radius: 4px;
                outline: none;
                cursor: pointer;
                margin: 0;
                vertical-align: middle;
                background: rgba(255, 255, 255, 0.85);
                display: inline-grid;
                place-content: center;
                transition: all 0.18s ease;
                flex-shrink: 0;
            }
            .jinpei-checkbox::before {
                content: "";
                width: 8px;
                height: 8px;
                clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
                transform: scale(0);
                transform-origin: center;
                transition: 120ms transform ease-in-out;
                background-color: #ffffff;
            }
            .jinpei-checkbox:checked {
                background-color: #0284c7;
                border-color: #0284c7;
                box-shadow: 0 1px 3px rgba(2, 132, 199, 0.3);
            }
            .jinpei-checkbox:checked::before {
                transform: scale(1);
            }
            .jinpei-checkbox:hover:not(:disabled) {
                border-color: #0284c7;
                background-color: #f0f9ff;
            }
            .jinpei-checkbox:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                border-color: #e2e8f0;
                background-color: rgba(0, 0, 0, 0.04);
            }
            .jinpei-task-item {
                display: flex;
                align-items: center;
                gap: 7px;
                padding: 4px 6px;
                border-radius: 6px;
                margin: 2px 0;
                cursor: pointer;
                font-size: 11px;
                color: #334155;
                line-height: 1.35;
                transition: background 0.15s ease;
            }
            .jinpei-task-item:hover {
                background: rgba(255, 255, 255, 0.55);
            }
            /* 并发加减步进器按钮 */
            .jinpei-step-btn {
                width: 20px;
                height: 20px;
                border-radius: 5px;
                border: 1px solid rgba(0, 0, 0, 0.1);
                background: rgba(255, 255, 255, 0.85);
                color: #334155;
                font-size: 12px;
                font-weight: bold;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                line-height: 1;
                padding: 0;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
                transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
                outline: none;
            }
            .jinpei-step-btn:hover {
                background: #0284c7;
                color: #ffffff;
                border-color: #0284c7;
                box-shadow: 0 2px 6px rgba(2, 132, 199, 0.25);
                transform: translateY(-1px);
            }
            .jinpei-step-btn:active {
                transform: translateY(0) scale(0.95);
                filter: brightness(0.95);
            }
            /* 诊断日志文本域 */
            .jinpei-textarea {
                width: 100%;
                height: 130px;
                resize: vertical;
                border: 1px solid rgba(0, 0, 0, 0.08);
                border-radius: 8px;
                padding: 7px 8px;
                background: rgba(255, 255, 255, 0.55);
                color: #334155;
                font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                user-select: text;
                outline: none;
                transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
            }
            .jinpei-textarea:focus {
                border-color: #38bdf8;
                box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
                background: rgba(255, 255, 255, 0.85);
            }
            /* 精致纤细滚动条 */
            .jinpei-glass ::-webkit-scrollbar {
                width: 5px;
                height: 5px;
            }
            .jinpei-glass ::-webkit-scrollbar-track {
                background: transparent;
            }
            .jinpei-glass ::-webkit-scrollbar-thumb {
                background: rgba(0, 0, 0, 0.12);
                border-radius: 9999px;
            }
            .jinpei-glass ::-webkit-scrollbar-thumb:hover {
                background: rgba(0, 0, 0, 0.22);
            }
        `;
        root.appendChild(style);
    }

// ==========================================
    // HUD 版本自检与更新提醒模块
    // 定时异步比对远程最新版本，在 HUD 上以醒目徽标提示用户一键更新
    // ==========================================
    function semverCompare(a, b) {
        const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
        const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const na = pa[i] || 0;
            const nb = pb[i] || 0;
            if (na > nb) return 1;
            if (na < nb) return -1;
        }
        return 0;
    }

    function applyUpdateNotice(remoteVersion) {
        state.remoteVersion = remoteVersion;
        const badge = getHUDElement('jinpei-hud-update-badge');
        if (badge) {
            badge.innerText = `更新 v${remoteVersion}`;
            badge.href = CONFIG.updateUrl;
            badge.title = `发现新版本 v${remoteVersion} (当前 v${SCRIPT_VERSION})，点击跳转更新脚本`;
            badge.style.display = 'inline-block';
        }
        const header = getHUDElement('jinpei-hud-header');
        if (header && header.classList?.contains('jinpei-collapsed')) {
            header.title = `🐚 神奇海螺 · 发现新版本 v${remoteVersion} (点击展开)`;
        }
    }

    async function checkScriptUpdate(force = false) {
        if (typeof fetch !== 'function') return;

        // 先读取已缓存的最新版本
        const cachedVersion = getLocalItem(STORAGE_KEYS.latestVersion, '');
        if (cachedVersion && semverCompare(cachedVersion, SCRIPT_VERSION) > 0) {
            applyUpdateNotice(cachedVersion);
        }

        const lastCheck = parseInt(getLocalItem(STORAGE_KEYS.lastUpdateCheck, '0'), 10) || 0;
        if (!force && Date.now() - lastCheck < CONFIG.updateCheckInterval) {
            return;
        }

        try {
            const resp = await fetch(CONFIG.updateUrl, { cache: 'no-cache' });
            if (!resp.ok) return;
            const text = await resp.text();
            const match = text.match(/\/\/\s*@version\s+([0-9.]+)/);
            if (match && match[1]) {
                const remoteVersion = match[1].trim();
                setLocalItem(STORAGE_KEYS.lastUpdateCheck, String(Date.now()));
                if (semverCompare(remoteVersion, SCRIPT_VERSION) > 0) {
                    setLocalItem(STORAGE_KEYS.latestVersion, remoteVersion);
                    applyUpdateNotice(remoteVersion);
                    diagnosticConsole.log(`【神奇海螺】检测到新版本: v${remoteVersion} (当前: v${SCRIPT_VERSION})，可点击 HUD 上的更新按钮前往安装。`);
                } else {
                    setLocalItem(STORAGE_KEYS.latestVersion, '');
                }
            }
        } catch (_) {
            // 静默容错，不干扰主要播放流程
        }
    }

function createHUD() {
        if (getHUDElement('jinpei-hud')) return;

        const hudDocument = IS_JNFTC ? jnHUDDocument() : document;
        if (!hudDocument) return;

        let host = hudDocument.getElementById('_kme_tool_host');
        if (!host && typeof hudDocument.createElement === 'function' && hudDocument.body) {
            host = hudDocument.createElement('div');
            host.id = '_kme_tool_host';
            if (typeof host.setAttribute === 'function') {
                host.setAttribute('aria-hidden', 'true');
                host.setAttribute('data-nosnippet', 'true');
            }
            host.style.position = 'absolute';
            host.style.top = '0';
            host.style.left = '0';
            host.style.zIndex = '999999';
            hudDocument.body.appendChild(host);
        }

        if (host && typeof host.attachShadow === 'function' && !hudShadowRoot) {
            try {
                hudShadowRoot = host.attachShadow({ mode: 'open' });
            } catch (_) {
                hudShadowRoot = null;
            }
        }

        const renderRoot = hudShadowRoot || hudDocument.body;
        if (!renderRoot) return;

        ensureHUDStyles(renderRoot);

        const hud = document.createElement('div');
        hud.id = 'jinpei-hud';
        hud.className = 'jinpei-glass';
        hud.style.transition = 'transform 0.2s ease, box-shadow 0.25s ease, border-color 0.25s ease, width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.25s cubic-bezier(0.4, 0, 0.2, 1)';

        // 恢复拖动位置（脱敏键名）
        let savedPos = null;
        try {
            savedPos = JSON.parse(getStorageItem(STORAGE_KEYS.hudPos, 'jinpei_hud_pos'));
        } catch (_) {}

        if (savedPos && savedPos.left && savedPos.top) {
            hud.style.left = savedPos.left;
            hud.style.top = savedPos.top;
            hud.style.right = 'auto';
        } else {
            hud.style.top = '24px';
            hud.style.right = '24px';
        }

        let isCollapsed = false;
        try {
            isCollapsed = getStorageItem(STORAGE_KEYS.hudCollapsed, 'jinpei_hud_collapsed') === 'true';
        } catch (_) {}
        hud.style.width = isCollapsed ? '42px' : '320px';
        hud.style.height = isCollapsed ? '42px' : 'auto';
        hud.style.minWidth = isCollapsed ? '42px' : '320px';
        hud.style.borderRadius = isCollapsed ? '50%' : '18px';
        if (isCollapsed && hud.classList) {
            hud.classList.add('jinpei-collapsed');
        }

        const btnText = state.enabled ? "暂停自动学习" : "开始自动学习";
        const btnIcon = state.enabled ? "⏸" : "▶";
        const btnBg = state.enabled 
            ? "linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)" 
            : "linear-gradient(135deg, #10b981 0%, #059669 100%)";
        const btnShadow = state.enabled
            ? "0 4px 14px rgba(244, 63, 94, 0.3)"
            : "0 4px 14px rgba(16, 185, 129, 0.3)";
        const dotBg = state.enabled ? "#10b981" : "#f59e0b";
        const dotAnim = state.enabled ? "jinpei-pulse 2s infinite ease-in-out" : "jinpei-amber-pulse 2s infinite ease-in-out";

        const cachedVer = getLocalItem(STORAGE_KEYS.latestVersion, '');
        if (cachedVer && semverCompare(cachedVer, SCRIPT_VERSION) > 0) {
            state.remoteVersion = cachedVer;
        }
        const hasUpdate = Boolean(state.remoteVersion && semverCompare(state.remoteVersion, SCRIPT_VERSION) > 0);

        let cachedHUD = null;
        try {
            cachedHUD = JSON.parse(getStorageItem(STORAGE_KEYS.hudCache)) || null;
        } catch (_) {}

        const initTask = state.currentTask || cachedHUD?.task || '';
        const initCourse = state.currentCourse || cachedHUD?.course || (IS_JNFTC ? (jnContext?.courseTitle || '') : '');
        const initAllCourses = state.allCoursesProgress || cachedHUD?.allCoursesProg || '';
        const initSub = state.currentSubVideo || cachedHUD?.sub || '';
        const initCourseProg = state.courseTotalProgress || cachedHUD?.courseTotalProg || '';
        const initCoursePercent = state.courseTotalPercent || cachedHUD?.courseTotalPercent || 0;
        const initProgress = state.videoProgress || cachedHUD?.videoProgress || '';
        const initStatus = state.statusText || cachedHUD?.statusText || (state.enabled ? "正在自动流转中..." : "待启动（请点击【开始学习】）");

        hud.innerHTML = `
            <!-- 顶部炫彩渐变微光线条 -->
            <div id="jinpei-hud-top-bar" style="height: 3px; background: linear-gradient(90deg, #38bdf8 0%, #818cf8 50%, #f472b6 100%); display: ${isCollapsed ? 'none' : 'block'};"></div>

            <!-- 可拖动顶栏 / 最小化单个海螺悬浮图标 -->
            <div id="jinpei-hud-header" style="${isCollapsed 
                ? 'width: 42px; height: 42px; padding: 0; display: flex; align-items: center; justify-content: center; position: relative; cursor: pointer; border-bottom: none;' 
                : 'padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: move; border-bottom: 1px solid rgba(0, 0, 0, 0.06); white-space: nowrap;'
            }" title="${isCollapsed ? `🐚 神奇海螺 · ${state.enabled ? (state.videoProgress || state.statusText || '运行中') : '已暂停'}${hasUpdate ? ` · 发现新版本 v${state.remoteVersion}` : ''} (点击展开)` : ''}">
                <div id="jinpei-hud-header-left" style="display: flex; align-items: center; gap: 7px; flex-shrink: 0; white-space: nowrap; ${isCollapsed ? 'justify-content: center; width: 100%; height: 100%; gap: 0;' : ''}">
                    <div id="jinpei-hud-dot" style="width: 8px; height: 8px; border-radius: 50%; background: ${dotBg}; animation: ${dotAnim}; flex-shrink: 0; ${isCollapsed ? 'position: absolute; top: 7px; right: 7px; width: 7px; height: 7px; box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.95); z-index: 2;' : ''}"></div>
                    <span id="jinpei-hud-icon" style="font-size: ${isCollapsed ? '21px' : '14px'}; flex-shrink: 0; line-height: 1;" title="${isCollapsed ? '点击展开神奇海螺' : ''}">🐚</span>
                    <span id="jinpei-hud-title-text" style="font-weight: 600; font-size: 13px; color: #0f172a; letter-spacing: 0.3px; white-space: nowrap; flex-shrink: 0; display: ${isCollapsed ? 'none' : 'inline'};">神奇海螺</span>
                    <span id="jinpei-hud-version" style="font-size: 10px; color: #64748b; background: rgba(0, 0, 0, 0.05); padding: 1px 6px; border-radius: 4px; font-weight: 500; white-space: nowrap; flex-shrink: 0; display: ${isCollapsed ? 'none' : 'inline-block'};">v1.8.4</span>
                    <a id="jinpei-hud-update-badge" href="${CONFIG.updateUrl}" target="_blank" rel="noopener noreferrer" style="font-size: 10px; color: #ffffff; background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); padding: 1px 6px; border-radius: 4px; font-weight: 600; text-decoration: none; white-space: nowrap; flex-shrink: 0; display: ${hasUpdate && !isCollapsed ? 'inline-block' : 'none'}; cursor: pointer; animation: jinpei-pulse 2s infinite ease-in-out; margin-left: 2px;" title="${hasUpdate ? `发现新版本 v${state.remoteVersion}，点击跳转更新` : '更新'}">更新 v${state.remoteVersion || ''}</a>
                </div>
                <div id="jinpei-hud-header-right" style="display: ${isCollapsed ? 'none' : 'flex'}; align-items: center; gap: 6px; flex-shrink: 0; white-space: nowrap;">
                    <span id="jinpei-hud-mini-status" style="display: none; font-size: 11px; color: #0284c7; font-weight: 600; font-family: monospace; white-space: nowrap; flex-shrink: 0;"></span>
                    <button id="jinpei-hud-min-btn" class="jinpei-icon-btn" style="flex-shrink: 0;" title="${isCollapsed ? '展开面板' : '折叠面板'}">${isCollapsed ? '＋' : '−'}</button>
                </div>
            </div>

            <!-- 主体内容卡片 -->
            <div id="jinpei-hud-body" style="display: ${isCollapsed ? 'none' : 'block'}; padding: 12px 14px 14px 14px;">
                <div style="font-size:11px;color:#64748b;margin-bottom:8px;">当前平台：${PLATFORM_NAME}</div>
                <!-- 快捷启动/暂停按键 -->
                <button id="jinpei-toggle-btn" class="jinpei-btn-action" style="
                    width: 100%;
                    padding: 8px 12px;
                    margin-bottom: 10px;
                    background: ${btnBg};
                    color: #ffffff;
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    box-shadow: ${btnShadow};
                ">
                    <span id="jinpei-btn-icon">${btnIcon}</span>
                    <span id="jinpei-btn-text">${btnText}</span>
                </button>

                <!-- 浅色磨砂信息栏 -->
                <div class="jinpei-info-box" style="
                    display: flex;
                    flex-direction: column;
                    gap: 7px;
                ">
                    <!-- 状态 -->
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 4px;">
                            <span>⚡</span> 运行状态
                        </span>
                        <span id="jinpei-hud-status" style="font-size: 11px; color: ${state.enabled ? '#0284c7' : '#d97706'}; font-weight: 500; text-align: right; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${initStatus}</span>
                    </div>

                    <!-- 任务 -->
                    <div id="jinpei-hud-task-row" style="display: ${initTask ? 'flex' : 'none'}; align-items: flex-start; justify-content: space-between; gap: 6px;">
                        <span style="font-size: 11px; color: #64748b; flex-shrink: 0; display: flex; align-items: center; gap: 4px;">
                            <span>📋</span> 任务
                        </span>
                        <span id="jinpei-hud-task" style="font-size: 11px; color: #d97706; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">${initTask || '-'}</span>
                    </div>

                    <!-- 课程 -->
                    <div id="jinpei-hud-course-row" style="display: ${initCourse ? 'flex' : 'none'}; align-items: flex-start; justify-content: space-between; gap: 6px;">
                        <span style="font-size: 11px; color: #64748b; flex-shrink: 0; display: flex; align-items: center; gap: 4px;">
                            <span>📚</span> 课程
                        </span>
                        <span id="jinpei-hud-course" style="font-size: 11px; color: #7c3aed; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">${initCourse || '-'}</span>
                    </div>

                    <!-- 全部课程进度 x/n -->
                    <div id="jinpei-hud-all-courses-row" style="display: ${initAllCourses ? 'flex' : 'none'}; align-items: flex-start; justify-content: space-between; gap: 6px;">
                        <span style="font-size: 11px; color: #64748b; flex-shrink: 0; display: flex; align-items: center; gap: 4px;">
                            <span>🗺️</span> 全部课程
                        </span>
                        <span id="jinpei-hud-all-courses" style="font-size: 11px; color: #059669; font-weight: 600; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">${initAllCourses || '-'}</span>
                    </div>

                    <!-- 小节 -->
                    <div id="jinpei-hud-sub-row" style="display: ${initSub ? 'flex' : 'none'}; align-items: flex-start; justify-content: space-between; gap: 6px;">
                        <span style="font-size: 11px; color: #64748b; flex-shrink: 0; display: flex; align-items: center; gap: 4px;">
                            <span>🎬</span> 小节
                        </span>
                        <span id="jinpei-hud-sub" style="font-size: 11px; color: #db2777; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">${initSub || '-'}</span>
                    </div>

                    <!-- 本课总进度（总时长 + 百分比） -->
                    <div id="jinpei-hud-course-prog-row" style="display: ${initCourseProg ? 'block' : 'none'}; margin-top: 2px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 4px;">
                            <span style="color: #64748b; display: flex; align-items: center; gap: 4px;">
                                <span>📊</span> 本课总览
                            </span>
                            <span id="jinpei-hud-course-prog" style="color: #7c3aed; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${initCourseProg || '-'}</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(0, 0, 0, 0.06); border-radius: 9999px; overflow: hidden;">
                            <div id="jinpei-hud-course-bar-fill" style="width: ${initCoursePercent}%; height: 100%; background: linear-gradient(90deg, #a855f7, #ec4899); border-radius: 9999px; transition: width 0.3s ease;"></div>
                        </div>
                    </div>

                    <!-- 单节播放进度 -->
                    <div id="jinpei-hud-progress-row" style="display: ${initProgress ? 'block' : 'none'}; margin-top: 2px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 4px;">
                            <span style="color: #64748b; display: flex; align-items: center; gap: 4px;">
                                <span>⏱</span> 单节播放
                            </span>
                            <span id="jinpei-hud-progress" style="color: #0284c7; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${initProgress || '-'}</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(0, 0, 0, 0.06); border-radius: 9999px; overflow: hidden;">
                            <div id="jinpei-hud-bar-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #38bdf8, #6366f1); border-radius: 9999px; transition: width 0.3s ease;"></div>
                        </div>
                    </div>

                    <!-- 并发课程控制 (1 ~ 6 路) -->
                    <div id="jinpei-concurrency-controls" style="display: ${IS_JNFTC ? 'none' : 'flex'}; align-items: center; justify-content: space-between; padding-top: 5px; border-top: 1px dashed rgba(0, 0, 0, 0.08); margin-top: 2px;">
                        <span style="font-size: 11px; color: #475569; display: flex; align-items: center; gap: 4px; font-weight: 500;">
                            <span>🚀</span> 并发课程
                        </span>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <button id="jinpei-concurrency-dec" class="jinpei-step-btn" title="减少并发课程">−</button>
                            <span id="jinpei-concurrency-val" style="font-size: 13px; font-weight: 700; color: #0284c7; min-width: 16px; text-align: center; font-family: ui-monospace, monospace;">${state.concurrency}</span>
                            <button id="jinpei-concurrency-inc" class="jinpei-step-btn" title="增加并发课程 (最高 6 路)">＋</button>
                            <span id="jinpei-active-tabs-badge" style="font-size: 10px; color: #059669; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 4px; padding: 1px 5px; font-weight: 600; white-space: nowrap;" title="当前活跃标签页 / 目标并发数">1/1</span>
                        </div>
                    </div>

                    <!-- 金培极速模式控制（默认开启 m_time 极速跳过，取消勾选按时长正常挂课） -->
                    <div id="jinpei-fast-mode-controls" style="display: ${IS_JNFTC ? 'flex' : 'none'}; align-items: center; justify-content: space-between; padding-top: 5px; border-top: 1px dashed rgba(0, 0, 0, 0.08); margin-top: 2px;">
                        <span style="font-size: 11px; color: #475569; display: flex; align-items: center; gap: 4px; font-weight: 500;" title="开启后通过上报课件时长极速跳过；取消勾选后按课件时长正常挂课（暂停时可切换）">
                            <span>⚡</span> 极速模式
                        </span>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <label style="display: flex; align-items: center; gap: 4px; cursor: ${state.enabled ? 'not-allowed' : 'pointer'}; user-select: none;">
                                <input type="checkbox" id="jinpei-fast-mode-toggle" ${CONFIG.jnAutoReport ? 'checked' : ''} ${state.enabled ? 'disabled' : ''} style="cursor: ${state.enabled ? 'not-allowed' : 'pointer'}; width: 14px; height: 14px; accent-color: #0284c7; margin: 0;" title="${state.enabled ? '运行中不可切换模式，请先暂停' : '开启极速跳过或正常挂课'}">
                                <span id="jinpei-fast-mode-val" style="font-size: 11px; font-weight: 600; color: ${CONFIG.jnAutoReport ? '#0284c7' : '#64748b'};">${CONFIG.jnAutoReport ? '极速' : '正常'}</span>
                            </label>
                            <span style="font-size: 10px; color: #94a3b8; white-space: nowrap;">暂停时可切换</span>
                        </div>
                    </div>
                </div>

                <!-- 底部任务选择与辅助工具 -->
                <details id="jinpei-task-selection" style="display: none; margin-top: 8px; font-size: 11px; color: #64748b;">
                    <summary class="jinpei-summary">
                        <span>📋 选择学习任务</span>
                        <span class="jinpei-summary-arrow">›</span>
                    </summary>
                    <div class="jinpei-details-body">
                        <div id="jinpei-task-list" style="max-height: 140px; overflow-y: auto; padding: 2px 0;"></div>
                        <div style="display: flex; gap: 5px; align-items: center; margin-top: 8px; flex-wrap: wrap;">
                            <button id="jinpei-task-all" type="button" class="jinpei-btn-sub">全选</button>
                            <button id="jinpei-task-clear" type="button" class="jinpei-btn-sub jinpei-btn-danger">清空</button>
                            <button id="jinpei-task-refresh" type="button" class="jinpei-btn-sub jinpei-btn-primary">刷新任务</button>
                            <span style="font-size: 10px; color: #94a3b8; margin-left: auto;">暂停时可修改</span>
                        </div>
                    </div>
                </details>
                <div id="jinpei-outcome-row" style="display: none; align-items: center; justify-content: space-between; gap: 6px; margin-top: 8px; font-size: 10px; color: #b45309; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 6px; padding: 4px 8px;">
                    <span id="jinpei-outcome-summary"></span>
                    <button id="jinpei-retry-skipped" type="button" class="jinpei-btn-sub" style="font-size: 10px; padding: 1px 6px; color: #b45309; border-color: rgba(245, 158, 11, 0.3);">重试异常</button>
                </div>
                <div style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #94a3b8; padding: 0 2px;">
                    <span>按住顶部可拖动</span>
                    <span id="jinpei-open-tab-btn" style="display: ${IS_JNFTC ? 'none' : 'inline'}; color: #0284c7; cursor: pointer; padding: 1px 5px; border-radius: 4px; background: rgba(2, 132, 199, 0.08); font-weight: 500; transition: all 0.15s ease;" title="在后台多开一个课程页面">多开 1 窗口</span>
                    <span>1.0x 标准播放</span>
                </div>
                <details id="jinpei-diagnostics" style="margin-top: 6px; font-size: 10px; color: #94a3b8; white-space: normal;">
                    <summary class="jinpei-summary">
                        <span>🔍 诊断日志</span>
                        <span class="jinpei-summary-arrow">›</span>
                    </summary>
                    <div class="jinpei-details-body">
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                            <button id="jinpei-diagnostics-copy" type="button" class="jinpei-btn-sub" style="font-size: 10px; padding: 2px 7px;">复制日志</button>
                            <button id="jinpei-diagnostics-clear" type="button" class="jinpei-btn-sub jinpei-btn-danger" style="font-size: 10px; padding: 2px 7px;">清空</button>
                            <span id="jinpei-diagnostics-notice" role="status" style="font-size: 10px; color: #059669; margin-left: auto;"></span>
                        </div>
                        <textarea id="jinpei-diagnostics-output" class="jinpei-textarea" readonly aria-label="最近诊断日志"></textarea>
                    </div>
                </details>
            </div>
        `;

        renderRoot.appendChild(hud);

        const header = getHUDElement('jinpei-hud-header');
        const minBtn = getHUDElement('jinpei-hud-min-btn');
        const bodyEl = getHUDElement('jinpei-hud-body');
        const miniStatusEl = getHUDElement('jinpei-hud-mini-status');
        const versionEl = getHUDElement('jinpei-hud-version');
        const toggleBtn = getHUDElement('jinpei-toggle-btn');
        const btnIconEl = getHUDElement('jinpei-btn-icon');
        const btnTextEl = getHUDElement('jinpei-btn-text');
        const dot = getHUDElement('jinpei-hud-dot');
        const statusEl = getHUDElement('jinpei-hud-status');
        bodyEl.style.maxHeight = 'calc(100vh - 90px)';
        bodyEl.style.overflowY = 'auto';
        getHUDElement('jinpei-diagnostics').addEventListener('toggle', () => {
            renderDiagnosticLogs();
            clampHUDPosition();
        });
        getHUDElement('jinpei-diagnostics-copy').addEventListener('click', copyDiagnosticLogs);
        getHUDElement('jinpei-diagnostics-clear').addEventListener('click', clearDiagnosticLogs);
        getHUDElement('jinpei-retry-skipped').addEventListener('click', retrySkippedCourses);
        getHUDElement('jinpei-task-all').addEventListener('click', () => {
            if (!state.enabled) { saveTaskSelection({ mode: 'all' }); renderTaskSelection(true); }
        });
        getHUDElement('jinpei-task-selection').addEventListener('toggle', () => {
            clampHUDPosition();
            if (getHUDElement('jinpei-task-selection').open) loadTaskCatalog().then(() => renderTaskSelection(true));
        });
        getHUDElement('jinpei-task-refresh').addEventListener('click', () => loadTaskCatalog(true).then(() => renderTaskSelection(true)));
        getHUDElement('jinpei-task-clear').addEventListener('click', () => {
            if (!state.enabled) { saveTaskSelection({ mode: 'ids', ids: [] }); renderTaskSelection(true); }
        });
        updateOutcomeHUD();

        // 边界吸附与溢出校正：保证 HUD 在折叠、展开或窗口缩放时始终完整可见不换行
        function clampHUDPosition() {
            const maxLeft = Math.max(10, window.innerWidth - hud.offsetWidth - 10);
            const maxTop = Math.max(10, window.innerHeight - hud.offsetHeight - 10);
            const curLeft = parseInt(hud.style.left, 10);
            const curTop = parseInt(hud.style.top, 10);
            if (!isNaN(curLeft)) {
                hud.style.left = `${Math.max(10, Math.min(maxLeft, curLeft))}px`;
            }
            if (!isNaN(curTop)) {
                hud.style.top = `${Math.max(10, Math.min(maxTop, curTop))}px`;
            }
        }

        const topBarEl = getHUDElement('jinpei-hud-top-bar');
        const headerLeft = getHUDElement('jinpei-hud-header-left');
        const headerRight = getHUDElement('jinpei-hud-header-right');
        const iconEl = getHUDElement('jinpei-hud-icon');
        const titleTextEl = getHUDElement('jinpei-hud-title-text');

        function setCollapsed(collapsed) {
            isCollapsed = !!collapsed;
            setStorageItem(STORAGE_KEYS.hudCollapsed, isCollapsed ? 'true' : 'false');

            if (hud.classList) {
                if (isCollapsed) hud.classList.add('jinpei-collapsed');
                else hud.classList.remove('jinpei-collapsed');
            }

            if (isCollapsed) {
                const currentH = hud.offsetHeight || 0;
                if (currentH > 42) {
                    hud.style.height = `${currentH}px`;
                    if (typeof hud.offsetHeight === 'number') void hud.offsetHeight;
                }
                hud.style.width = '42px';
                hud.style.height = '42px';
                hud.style.minWidth = '42px';
                hud.style.borderRadius = '50%';
                hud.style.overflow = 'visible';
                if (bodyEl) bodyEl.style.display = 'none';
                if (topBarEl) topBarEl.style.display = 'none';
                if (titleTextEl) titleTextEl.style.display = 'none';
                if (versionEl) versionEl.style.display = 'none';
                const updateBadgeEl = getHUDElement('jinpei-hud-update-badge');
                if (updateBadgeEl) updateBadgeEl.style.display = 'none';
                if (headerRight) headerRight.style.display = 'none';
                if (miniStatusEl) miniStatusEl.style.display = 'none';
                if (header) {
                    header.style.width = '42px';
                    header.style.height = '42px';
                    header.style.padding = '0';
                    header.style.justifyContent = 'center';
                    header.style.borderBottom = 'none';
                    const statusSummary = state.enabled ? (state.videoProgress || state.statusText || '运行中') : '已暂停';
                    const hasUpdate = state.remoteVersion && semverCompare(state.remoteVersion, SCRIPT_VERSION) > 0;
                    const updateSuffix = hasUpdate ? ` · 发现新版本 v${state.remoteVersion}` : '';
                    header.title = `🐚 神奇海螺 · ${statusSummary}${updateSuffix} (点击展开)`;
                }
                if (headerLeft) {
                    headerLeft.style.width = '100%';
                    headerLeft.style.height = '100%';
                    headerLeft.style.justifyContent = 'center';
                    headerLeft.style.gap = '0';
                }
                if (iconEl) {
                    iconEl.style.fontSize = '21px';
                }
                if (dot) {
                    dot.style.position = 'absolute';
                    dot.style.top = '7px';
                    dot.style.right = '7px';
                    dot.style.width = '7px';
                    dot.style.height = '7px';
                    dot.style.boxShadow = '0 0 0 1.5px rgba(255, 255, 255, 0.95)';
                    dot.style.zIndex = '2';
                }
                if (minBtn) {
                    minBtn.innerText = '＋';
                    minBtn.title = '展开面板';
                }
            } else {
                if (bodyEl) bodyEl.style.display = 'block';
                if (topBarEl) topBarEl.style.display = 'block';
                if (titleTextEl) titleTextEl.style.display = 'inline';
                if (versionEl) versionEl.style.display = 'inline-block';
                const updateBadgeEl = getHUDElement('jinpei-hud-update-badge');
                const hasUpdate = state.remoteVersion && semverCompare(state.remoteVersion, SCRIPT_VERSION) > 0;
                if (updateBadgeEl) updateBadgeEl.style.display = hasUpdate ? 'inline-block' : 'none';
                if (headerRight) headerRight.style.display = 'flex';
                if (miniStatusEl) miniStatusEl.style.display = 'none';

                const prevH = hud.offsetHeight || 0;
                hud.style.width = '320px';
                hud.style.minWidth = '320px';
                hud.style.borderRadius = '18px';
                hud.style.overflow = 'hidden';

                if (prevH <= 42 && typeof hud.offsetHeight === 'number') {
                    hud.style.height = 'auto';
                    const targetH = hud.offsetHeight || 0;
                    if (targetH > 42) {
                        hud.style.height = '42px';
                        void hud.offsetHeight;
                        hud.style.height = `${targetH}px`;
                        setTimeout(() => {
                            if (!isCollapsed) hud.style.height = 'auto';
                        }, 280);
                    }
                } else {
                    hud.style.height = 'auto';
                }
                if (header) {
                    header.style.width = 'auto';
                    header.style.height = 'auto';
                    header.style.padding = '10px 14px';
                    header.style.justifyContent = 'space-between';
                    header.style.borderBottom = '1px solid rgba(0, 0, 0, 0.06)';
                    header.title = '';
                }
                if (headerLeft) {
                    headerLeft.style.width = 'auto';
                    headerLeft.style.height = 'auto';
                    headerLeft.style.justifyContent = 'flex-start';
                    headerLeft.style.gap = '7px';
                }
                if (iconEl) {
                    iconEl.style.fontSize = '14px';
                }
                if (dot) {
                    dot.style.position = 'static';
                    dot.style.width = '8px';
                    dot.style.height = '8px';
                    dot.style.boxShadow = 'none';
                    dot.style.zIndex = 'auto';
                }
                if (minBtn) {
                    minBtn.innerText = '−';
                    minBtn.title = '折叠面板';
                }
            }
            clampHUDPosition();
            setStorageItem(STORAGE_KEYS.hudPos, JSON.stringify({
                left: hud.style.left,
                top: hud.style.top
            }));
        }

        // 初始化根据已保存状态应用折叠/展开
        setCollapsed(isCollapsed);

        // 折叠 / 展开交互：点击右上角折叠按钮
        if (minBtn) {
            minBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                setCollapsed(!isCollapsed);
            });
        }

        // 最小化状态下：点击海螺图标/小悬浮球任意位置直接展开（若刚发生拖拽则忽略点击）
        if (header) {
            header.addEventListener('click', (e) => {
                if (isCollapsed && !hasDragged) {
                    setCollapsed(false);
                }
            });
        }

        // 窗口尺寸变化时自动校正 HUD 坐标
        window.addEventListener('resize', clampHUDPosition);

        // 自由拖拽交互
        let isDragging = false;
        let hasDragged = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;

        header.addEventListener('mousedown', (e) => {
            if (!isCollapsed && e.target.closest('button')) return;
            isDragging = true;
            hasDragged = false;
            startX = e.clientX;
            startY = e.clientY;
            const rect = hud.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            hud.style.transition = 'none';
            e.preventDefault();
        });

        hudDocument.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
                hasDragged = true;
            }
            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            const maxLeft = window.innerWidth - hud.offsetWidth - 10;
            const maxTop = window.innerHeight - hud.offsetHeight - 10;
            newLeft = Math.max(10, Math.min(maxLeft, newLeft));
            newTop = Math.max(10, Math.min(maxTop, newTop));

            hud.style.left = `${newLeft}px`;
            hud.style.top = `${newTop}px`;
            hud.style.right = 'auto';
        });

        hudDocument.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                clampHUDPosition();
                hud.style.transition = 'transform 0.2s ease, box-shadow 0.25s ease, border-color 0.25s ease, width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
                setStorageItem(STORAGE_KEYS.hudPos, JSON.stringify({
                    left: hud.style.left,
                    top: hud.style.top
                }));
                setTimeout(() => {
                    hasDragged = false;
                }, 50);
            }
        });

        // 开始 / 暂停切换
        toggleBtn.addEventListener('click', () => {
            if (!state.enabled) {
                const selection = getTaskSelection();
                if (selection.mode === 'ids' && !selection.ids.length) {
                    renderTaskSelection(true);
                    getHUDElement('jinpei-task-selection').open = true;
                    updateHUD('请先勾选要学习的任务。');
                    return;
                }
            }
            state.enabled = !state.enabled;
            if (state.enabled) {
                setStorageItem(STORAGE_KEYS.running, 'true');
                setLocalItem(STORAGE_KEYS.running, 'true');
                btnIconEl.innerText = "⏸";
                btnTextEl.innerText = "暂停自动学习";
                toggleBtn.style.background = "linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)";
                toggleBtn.style.boxShadow = "0 4px 14px rgba(244, 63, 94, 0.3)";
                dot.style.background = "#10b981";
                dot.style.animation = "jinpei-pulse 2s infinite ease-in-out";
                statusEl.style.color = "#0284c7";
                updateHUD("已手动启动，正在运行中...");
                diagnosticConsole.log("【神奇海螺】用户手动点击启动自动化！");
                mainLoop();
            } else {
                pauseAutomation("已手动暂停（所有待执行操作已取消）");
                diagnosticConsole.log("【神奇海螺】用户手动点击暂停，已清空待执行定时器并暂停视频。");
            }
        });

        // 并发调节与多开按键交互
        const decBtn = getHUDElement('jinpei-concurrency-dec');
        const incBtn = getHUDElement('jinpei-concurrency-inc');
        const openTabBtn = getHUDElement('jinpei-open-tab-btn');

        if (IS_JNFTC) {
            // 金培按任务顺序流转；复用面板，避免把易知的多窗口规则用于旧平台。
            for (const button of [decBtn, incBtn, openTabBtn]) {
                if (button) { button.disabled = true; button.title = '江南金培使用单窗口顺序学习'; }
            }
            setConcurrencySetting(1);
        }

        if (!IS_JNFTC && decBtn && typeof decBtn.addEventListener === 'function') {
            decBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const cur = getConcurrencySetting();
                if (cur > 1) {
                    const next = setConcurrencySetting(cur - 1);
                    diagnosticConsole.log(`【神奇海螺】并发设置减少至: ${next} 路`);
                    updateHUD(`并发课程数已调整为 ${next} 路`);
                }
            });
        }

        if (!IS_JNFTC && incBtn && typeof incBtn.addEventListener === 'function') {
            incBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const cur = getConcurrencySetting();
                if (cur < (CONFIG.maxConcurrency || 6)) {
                    const next = setConcurrencySetting(cur + 1);
                    diagnosticConsole.log(`【神奇海螺】并发设置增加至: ${next} 路`);
                    updateHUD(`并发课程数已调整为 ${next} 路`);
                    const activeCount = Object.keys(getActiveTabs()).length;
                    if (activeCount < next && typeof window !== 'undefined' && typeof window.open === 'function' && location.href.includes('/home/training/study/')) {
                        try {
                            window.open(CONFIG.myTaskUrl, '_blank');
                        } catch (_) {}
                    }
                }
            });
        }

        if (!IS_JNFTC && openTabBtn && typeof openTabBtn.addEventListener === 'function') {
            openTabBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    const cur = getConcurrencySetting();
                    if (cur < (CONFIG.maxConcurrency || 6)) {
                        setConcurrencySetting(cur + 1);
                    }
                    if (typeof window !== 'undefined' && typeof window.open === 'function') {
                        window.open(CONFIG.myTaskUrl, '_blank');
                        updateHUD("正在唤起新窗口进行并发学习...");
                    }
                } catch (err) {
                    diagnosticConsole.error(err);
                }
            });
        }

        const fastModeToggle = getHUDElement('jinpei-fast-mode-toggle');
        const fastModeVal = getHUDElement('jinpei-fast-mode-val');
        if (IS_JNFTC && fastModeToggle && typeof fastModeToggle.addEventListener === 'function') {
            fastModeToggle.addEventListener('click', (e) => {
                if (state.enabled) {
                    e.preventDefault();
                    fastModeToggle.checked = CONFIG.jnAutoReport;
                    updateHUD('请先暂停学习，再切换挂课模式。');
                    return false;
                }
            });
            fastModeToggle.addEventListener('change', () => {
                if (state.enabled) {
                    fastModeToggle.checked = CONFIG.jnAutoReport;
                    updateHUD('请先暂停学习，再切换挂课模式。');
                    return;
                }
                setFastModeSetting(fastModeToggle.checked);
                if (fastModeVal) {
                    fastModeVal.textContent = CONFIG.jnAutoReport ? '极速' : '正常';
                    fastModeVal.style.color = CONFIG.jnAutoReport ? '#0284c7' : '#64748b';
                }
                diagnosticConsole.log(`金培：已切换为【${CONFIG.jnAutoReport ? '极速跳过模式' : '正常挂课模式'}】。`);
                updateHUD(state.statusText);
            });
        }
    }

    function updateHUD(status, task, sub, progress, course, allCoursesProg, courseTotalProg, courseTotalPercent) {
        if (status) state.statusText = status;
        if (task !== undefined) state.currentTask = task;
        if (sub !== undefined) state.currentSubVideo = sub;
        if (progress !== undefined) state.videoProgress = progress;
        if (course !== undefined) state.currentCourse = course;
        if (allCoursesProg !== undefined) state.allCoursesProgress = allCoursesProg;
        if (courseTotalProg !== undefined) state.courseTotalProgress = courseTotalProg;
        if (courseTotalPercent !== undefined) state.courseTotalPercent = courseTotalPercent;
        updateOutcomeHUD();

        const statusEl = getHUDElement('jinpei-hud-status');
        const taskRow = getHUDElement('jinpei-hud-task-row');
        const taskEl = getHUDElement('jinpei-hud-task');
        const courseRow = getHUDElement('jinpei-hud-course-row');
        const courseEl = getHUDElement('jinpei-hud-course');
        const allCoursesRow = getHUDElement('jinpei-hud-all-courses-row');
        const allCoursesEl = getHUDElement('jinpei-hud-all-courses');
        const subRow = getHUDElement('jinpei-hud-sub-row');
        const subEl = getHUDElement('jinpei-hud-sub');
        const courseProgRow = getHUDElement('jinpei-hud-course-prog-row');
        const courseProgEl = getHUDElement('jinpei-hud-course-prog');
        const courseBarFill = getHUDElement('jinpei-hud-course-bar-fill');
        const progRow = getHUDElement('jinpei-hud-progress-row');
        const progEl = getHUDElement('jinpei-hud-progress');
        const barFill = getHUDElement('jinpei-hud-bar-fill');
        const miniStatusEl = getHUDElement('jinpei-hud-mini-status');

        if (statusEl) {
            statusEl.innerText = state.statusText;
            statusEl.title = state.statusText;
        }

        if (taskRow && taskEl) {
            if (state.currentTask) {
                taskRow.style.display = 'flex';
                taskEl.innerText = state.currentTask;
                taskEl.title = state.currentTask;
            } else {
                taskRow.style.display = 'none';
            }
        }

        if (courseRow && courseEl) {
            if (state.currentCourse) {
                courseRow.style.display = 'flex';
                courseEl.innerText = state.currentCourse;
                courseEl.title = state.currentCourse;
            } else {
                courseRow.style.display = 'none';
            }
        }

        if (allCoursesRow && allCoursesEl) {
            if (state.allCoursesProgress) {
                allCoursesRow.style.display = 'flex';
                allCoursesEl.innerText = state.allCoursesProgress;
                allCoursesEl.title = state.allCoursesProgress;
            } else {
                allCoursesRow.style.display = 'none';
            }
        }

        if (subRow && subEl) {
            if (state.currentSubVideo) {
                subRow.style.display = 'flex';
                subEl.innerText = state.currentSubVideo;
                subEl.title = state.currentSubVideo;
            } else {
                subRow.style.display = 'none';
            }
        }

        if (courseProgRow && courseProgEl) {
            if (state.courseTotalProgress) {
                courseProgRow.style.display = 'block';
                courseProgEl.innerText = state.courseTotalProgress;
                courseProgEl.title = state.courseTotalProgress;
                if (courseBarFill) {
                    courseBarFill.style.width = (state.courseTotalPercent || 0) + '%';
                }
            } else {
                courseProgRow.style.display = 'none';
            }
        }

        if (progRow && progEl) {
            if (state.videoProgress) {
                progRow.style.display = 'block';
                progEl.innerText = state.videoProgress;

                // 动态更新单节进度条长度
                const match = state.videoProgress.match(/(\d+)%/);
                if (barFill && match) {
                    barFill.style.width = match[1] + '%';
                } else if (barFill && state.videoProgress === '100%') {
                    barFill.style.width = '100%';
                }
            } else {
                progRow.style.display = 'none';
            }
        }

        const concValEl = getHUDElement('jinpei-concurrency-val');
        if (concValEl) {
            concValEl.innerText = (state.concurrency || getConcurrencySetting()).toString();
        }

        const activeBadge = getHUDElement('jinpei-active-tabs-badge');
        if (activeBadge) {
            const activeCount = Math.max(1, Object.keys(getActiveTabs()).length);
            const target = state.concurrency || getConcurrencySetting();
            activeBadge.innerText = `${activeCount}/${target}`;
            activeBadge.title = `当前活跃标签页: ${activeCount} / 目标并发数: ${target}`;
        }

        if (miniStatusEl) {
            const conc = state.concurrency || getConcurrencySetting();
            const concTag = conc > 1 ? ` · ${conc}路` : '';
            if (state.courseTotalPercent > 0) {
                miniStatusEl.innerText = `${state.courseTotalPercent}%${concTag}`;
            } else if (state.videoProgress) {
                const m = state.videoProgress.match(/(\d+%)/);
                miniStatusEl.innerText = `${m ? m[1] : state.videoProgress}${concTag}`;
            } else if (state.enabled) {
                miniStatusEl.innerText = `运行中${concTag}`;
            } else {
                miniStatusEl.innerText = '已暂停';
            }
        }

        const hudEl = getHUDElement('jinpei-hud');
        const headerEl = getHUDElement('jinpei-hud-header');
        const isCollapsedNow = (hudEl && hudEl.classList && hudEl.classList.contains('jinpei-collapsed')) ||
            getStorageItem(STORAGE_KEYS.hudCollapsed, 'jinpei_hud_collapsed') === 'true';
        if (isCollapsedNow && headerEl) {
            const statusSummary = state.enabled ? (state.videoProgress || state.statusText || '运行中') : '已暂停';
            headerEl.title = `🐚 神奇海螺 · ${statusSummary} (点击展开)`;
        }

        const fastModeToggle = getHUDElement('jinpei-fast-mode-toggle');
        if (fastModeToggle) {
            fastModeToggle.disabled = state.enabled;
            fastModeToggle.style.cursor = state.enabled ? 'not-allowed' : 'pointer';
            fastModeToggle.title = state.enabled ? '运行中不可切换模式，请先暂停' : '开启极速跳过或正常挂课';
            const labelEl = fastModeToggle.closest?.('label');
            if (labelEl) labelEl.style.cursor = state.enabled ? 'not-allowed' : 'pointer';
        }

        try {
            setStorageItem(STORAGE_KEYS.hudCache, JSON.stringify({
                task: state.currentTask,
                course: state.currentCourse,
                allCoursesProg: state.allCoursesProgress,
                sub: state.currentSubVideo,
                courseTotalProg: state.courseTotalProgress,
                courseTotalPercent: state.courseTotalPercent,
                videoProgress: state.videoProgress,
                statusText: state.statusText
            }));
        } catch (_) {}
    }

// ==========================================
    // 2. 防暂停与防后台挂机机制（动态联动：运行生效，暂停释放）
    // ==========================================
    function enableAntiPause() {
        try {
            const origHiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden') || Object.getOwnPropertyDescriptor(document, 'hidden');
            const origVisibilityDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState') || Object.getOwnPropertyDescriptor(document, 'visibilityState');
            const origWebkitVisibilityDesc = Object.getOwnPropertyDescriptor(document, 'webkitVisibilityState') || Object.getOwnPropertyDescriptor(Document.prototype, 'webkitVisibilityState');
            const origWebkitVisibility = document.webkitVisibilityState;

            // 仅在 state.enabled 为 true 时伪装前台可见，暂停时返回浏览器原生状态
            Object.defineProperty(document, 'hidden', {
                get: () => state.enabled ? false : (origHiddenDesc && origHiddenDesc.get ? origHiddenDesc.get.call(document) : false),
                configurable: true
            });
            Object.defineProperty(document, 'visibilityState', {
                get: () => state.enabled ? 'visible' : (origVisibilityDesc && origVisibilityDesc.get ? origVisibilityDesc.get.call(document) : 'visible'),
                configurable: true
            });
            Object.defineProperty(document, 'webkitVisibilityState', {
                get: () => state.enabled ? 'visible' : (
                    origWebkitVisibilityDesc && origWebkitVisibilityDesc.get
                        ? origWebkitVisibilityDesc.get.call(document)
                        : (origWebkitVisibilityDesc && 'value' in origWebkitVisibilityDesc
                            ? origWebkitVisibilityDesc.value
                            : (origWebkitVisibility !== undefined ? origWebkitVisibility : document.visibilityState))
                ),
                configurable: true
            });

            // 事件拦截：仅在 state.enabled 为 true 时拦截，暂停状态下放行
            window.addEventListener('blur', (e) => {
                if (state.enabled) e.stopImmediatePropagation();
            }, true);
            window.addEventListener('mouseleave', (e) => {
                if (state.enabled) e.stopImmediatePropagation();
            }, true);
            document.addEventListener('visibilitychange', (e) => {
                if (state.enabled) e.stopImmediatePropagation();
            }, true);

            diagnosticConsole.log("【神奇海螺】防暂停与防后台机制已初始化（随【开始/暂停】动态生效）。");
        } catch (e) {
            diagnosticConsole.warn("【神奇海螺】防暂停注入异常:", e);
        }
    }

// 智能关闭弹窗：严格限定在弹窗/遮罩层容器内部寻找，避免误触页面常规按钮，排除神奇海螺面板本身
    function autoDismissDialogs() {
        if (!state.enabled) return;

        const dialogContainers = Array.from(document.querySelectorAll(
            '.ant5-modal:not(#jinpei-hud), .ant-modal, .ant5-modal-content, [role="dialog"], div[class*="modal-content"], div[class*="dialog-content"]'
        )).filter(d => !d.closest('#jinpei-hud') && !d.closest('#_kme_tool_host') && d.offsetParent !== null);

        for (const dialog of dialogContainers) {
            const dialogText = (dialog.innerText || '').trim();

            const buttons = Array.from(dialog.querySelectorAll('button, .ant5-btn, [role="button"]'))
                .filter(b => b.offsetParent !== null);

            for (const btn of buttons) {
                const btnText = (btn.innerText || '').trim();

                // 1. 明确的学习/播放恢复按钮（精确匹配），直接点击
                if (/^(继续学习|继续播放)$/.test(btnText)) {
                    diagnosticConsole.log("【神奇海螺】检测到学习恢复弹窗，点击继续:", btnText);
                    simulateHumanClick(btn);
                    return;
                }

                // 2. 通用“确定/我知道了/继续”（精确匹配），严格排除单独的“提示”，只匹配明确的学习超时/防挂机/继续观看内容
                if (/^(确定|我知道了|知道了|继续)$/.test(btnText)) {
                    const isLearningNotice = /长时间未操作|学习超时|超时未操作|继续学习|继续观看|挂机检测|防挂机|学时累计|学时记录|是否继续学习/i.test(dialogText);
                    if (isLearningNotice) {
                        diagnosticConsole.log("【神奇海螺】检测到学习超时/挂机提醒弹窗，点击确认:", btnText);
                        simulateHumanClick(btn);
                        return;
                    }
                }
            }

            // 3. 考试/测验邀请或提醒弹窗：用户要求看完视频不参加考试，直接关闭/取消
            if (/考试|测验|测试/.test(dialogText)) {
                const cancelBtn = buttons.find(b => /^(取消|关闭|稍后|稍后再说|暂不|我知道了)$/.test((b.innerText || '').trim()));
                if (cancelBtn) {
                    diagnosticConsole.log("【神奇海螺】检测到考试邀请/提醒弹窗，根据配置自动跳过/关闭:", cancelBtn.innerText.trim());
                    simulateHumanClick(cancelBtn);
                    return;
                }
                const closeIcon = dialog.querySelector('.ant5-modal-close, .ant-modal-close, [aria-label="Close"], [aria-label="关闭"]');
                if (closeIcon && closeIcon.offsetParent !== null) {
                    diagnosticConsole.log("【神奇海螺】检测到考试邀请/提醒弹窗，点击右上角关闭按钮");
                    simulateHumanClick(closeIcon);
                    return;
                }
            }
        }
    }

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds) || !isFinite(seconds)) return "00:00";
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) {
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

// ==========================================
    // 3. 通用 DOM 检查工具函数 (兼容多种目录结构与已学标记)
    // ==========================================

    // 检查某个元素是否代表“已完成”状态（绿色对勾、100%、已完成文本）
    function isItemCompleted(el) {
        if (!el) return false;
        const hasQuery = typeof el.querySelector === 'function';
        // 1. 检查是否有 check 对勾图标 (anticon5-check, data-icon="check", aria-label="check")
        const hasCheckIcon = hasQuery && el.querySelector('[data-icon="check"], [aria-label="check"], .anticon5-check, .anticon-check, [class*="anticon-check"], [class*="anticon5-check"]') !== null;
        if (hasCheckIcon) return true;
        // 完成状态只认独立状态文字；第一行课程标题不参与匹配。
        const finished = /^(?:(?:已完成|已学完|学习完成)(?:\s+100\s*%)?|(?:学习进度\s*[:：]?\s*)?100\s*%)$/;
        const lines = (el.innerText || '').split(/\r?\n/).map(text => text.trim()).filter(Boolean);
        if (lines.slice(1).some(text => finished.test(text))) return true;
        if (typeof el.querySelectorAll !== 'function') return false;
        const title = hasQuery ? el.querySelector('[title], .truncate, [class*="course-title"], [class*="courseTitle"]') : null;
        return Array.from(el.querySelectorAll('[role="progressbar"], [class*="progress"], [class*="status"]')).some(marker => {
            if (marker === title || title?.contains?.(marker)) return false;
            if (marker.getAttribute?.('role') === 'progressbar') {
                const current = marker.getAttribute('aria-valuenow');
                const maximum = marker.getAttribute('aria-valuemax') || '100';
                return current !== null && Number(maximum) > 0 && Number(current) >= Number(maximum);
            }
            return finished.test((marker.innerText || '').trim());
        });
    }

    // 检查子视频小节是否处于当前选中/播放激活状态
    function isSubVideoActive(el) {
        if (!el) return false;
        const cls = el.className || '';
        if (cls.includes('bg6') || cls.includes('text-primary') || cls.includes('active')) return true;
        const titleEl = el.querySelector('[title], .truncate');
        if (titleEl && (titleEl.className || '').includes('text-primary')) return true;
        return false;
    }

    let chapterCatalogRuntime = null;
    let chapterCatalogWaitPending = false;
    let chapterCatalogWaitGeneration = 0;

    // 逐个展开并验证各面板的内容，目录稳定后才允许核实整课完成。
    function ensureAllChaptersExpanded() {
        const video = document.querySelector('video');
        if (!chapterCatalogRuntime || chapterCatalogRuntime.video !== video || chapterCatalogRuntime.url !== location.href) {
            chapterCatalogRuntime = { video, url: location.href, clicked: new WeakSet(), sawHeaders: false, stableSince: null, signature: '' };
        }
        const runtime = chapterCatalogRuntime;
        const headers = Array.from(document.querySelectorAll('.ant5-collapse-header[aria-expanded], .ant-collapse-header[aria-expanded], [class*="collapse-header"][aria-expanded]'))
            .filter(header => header.offsetParent !== null);
        if (!headers.length) return !runtime.sawHeaders;
        runtime.sawHeaders = true;
        let ready = true;
        for (const header of headers) {
            if (header.getAttribute('aria-expanded') !== 'true') {
                ready = false;
                if (!runtime.clicked.has(header)) {
                    runtime.clicked.add(header);
                    diagnosticConsole.log('等待章节展开并加载：', (header.innerText || '').trim());
                    simulateHumanClick(header);
                }
                continue;
            }
            runtime.clicked.delete(header);
            const panelId = header.getAttribute('aria-controls');
            const panel = (panelId && document.getElementById(panelId)) ||
                header.closest?.('.ant5-collapse-item, .ant-collapse-item')?.querySelector('.ant5-collapse-content, .ant-collapse-content');
            if (!panel || panel.querySelector('[aria-busy="true"], .ant5-spin-spinning, .ant-spin-spinning') ||
                (!Array.from(panel.querySelectorAll('div.group.cursor-pointer, [class*="min-h-10"][class*="cursor-pointer"]'))
                    .some(item => /\d{1,2}:\d{2}/.test(item.innerText || '')) && !/考试|测验/.test(panel.innerText || ''))) ready = false;
        }
        const signature = JSON.stringify(getAllSubVideoItems().map(getSubVideoKey));
        if (!ready || signature !== runtime.signature) {
            runtime.signature = signature;
            runtime.stableSince = ready ? Date.now() : null;
            return false;
        }
        return runtime.stableSince !== null && Date.now() - runtime.stableSince >= 1000;
    }

    function waitForChapterCatalog(scope, onReady) {
        if (chapterCatalogWaitPending) return;
        chapterCatalogWaitPending = true;
        const generation = ++chapterCatalogWaitGeneration;
        const started = Date.now();
        state.isSwitching = true;
        state.isActionPending = true;
        function poll() {
            if (!state.enabled || generation !== chapterCatalogWaitGeneration) return;
            if (!isPlaybackScopeCurrent(scope, true)) {
                chapterCatalogWaitPending = false;
                cancelStalePlaybackWait();
                return;
            }
            if (ensureAllChaptersExpanded()) {
                chapterCatalogWaitPending = false;
                state.isSwitching = false;
                state.isActionPending = false;
                onReady();
                return;
            }
            if (Date.now() - started >= CONFIG.pageReadyTimeout) {
                pauseAutomation('章节目录未完整加载，已暂停；请检查目录和网络后重新开始。');
                return;
            }
            if (currentClaim && !registerTabHeartbeat()) { pauseAutomation('等待章节时无法续期课程占用，已暂停。'); return; }
            updateHUD('等待全部章节展开并加载完整...');
            setManagedTimeout(poll, 500);
        }
        poll();
    }

    // 获取当前页面中所有的子小节条目（兼容一层目录与多层折叠目录）
    function getAllSubVideoItems() {
        // 匹配所有具有 cursor-pointer 且包含时长格式 (如 00:07:45 或 03:37) 的条目
        const items = Array.from(document.querySelectorAll('div.group.cursor-pointer, [class*="min-h-10"][class*="cursor-pointer"]'))
            .filter(el => {
                const t = el.innerText || '';
                // 排除顶层菜单项，只保留包含时间或明确小节标识的条目
                return /\d{1,2}:\d{2}/.test(t) && !t.includes('学时') && !t.includes('个活动');
            });

        return items;
    }

    // 解析时分秒字符串为纯秒数 (例如 "00:14:57" -> 897, "12:46" -> 766)
    function parseTimeToSeconds(timeStr) {
        if (!timeStr) return 0;
        const parts = timeStr.trim().split(':').map(Number);
        if (parts.length === 3) {
            return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
        }
        if (parts.length === 2) {
            return (parts[0] || 0) * 60 + (parts[1] || 0);
        }
        return 0;
    }

    // 计算当前大课程的总时长、已学时长、小节数完成比与总百分比
    function calculateCourseTotalProgress(allSubItems, video) {
        let totalSec = 0;
        let completedSec = 0;
        let completedCount = 0;
        const totalCount = allSubItems.length;

        allSubItems.forEach(el => {
            const tm = (el.innerText || '').match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
            const itemSec = tm ? parseTimeToSeconds(tm[1]) : 0;
            totalSec += itemSec;
            const isDone = isItemCompleted(el);
            const isActive = isSubVideoActive(el);

            if (isDone) {
                completedSec += itemSec;
                completedCount++;
            } else if (isActive && video && video.duration > 0) {
                const curPlay = Math.min(itemSec > 0 ? itemSec : video.currentTime, video.currentTime);
                completedSec += curPlay;
            }
        });

        const percent = totalSec > 0 ? Math.min(100, Math.floor((completedSec / totalSec) * 100)) : (totalCount > 0 && completedCount === totalCount ? 100 : 0);
        const countStr = `${completedCount}/${totalCount} 节`;
        const timeStr = `${formatTime(completedSec)} / ${formatTime(totalSec)}`;
        return {
            text: `${countStr} · ${timeStr} (${percent}%)`,
            percent: percent,
            completedCount,
            totalCount,
            completedSec,
            totalSec
        };
    }

    // 检查当前课程是否包含随堂测验/课后考试/测试节点
    function detectCourseExam() {
        const candidates = Array.from(document.querySelectorAll(
            'div.group.cursor-pointer, [class*="min-h-10"][class*="cursor-pointer"], .ant5-tabs-tab, .ant-tabs-tab, [role="tab"], li, button, span, div'
        )).filter(el => {
            if (el && el.closest && (el.closest('#jinpei-hud') || el.closest('#_kme_tool_host'))) return false;
            const t = (el.innerText || '').trim();
            return /^(课后考试|随堂测验|结业考试|课程考试|综合测试|在线考试|随堂考试|作业与考试|单元测验|去考试)$/.test(t) ||
                   (/(考试|测验|随堂测)/.test(t) && t.length <= 12 && !t.includes('调试'));
        });
        return candidates.length > 0;
    }

    // 当前地图/培训项目 ID 提取
    function getCurrentMapId() {
        const path = (location && (location.pathname || location.href)) || "";
        const m = path.match(/\/(?:study|detail)\/(\d+)/);
        if (m) return m[1];
        const cp = path.match(/\/courseplay\/(\d+)/);
        if (cp) return `courseplay_${cp[1]}`;
        return "";
    }

    // 当前地图标题提取（优先使用保存的任务标题，兜底页面标题）
    function getMapTitleFromPage() {
        if (state.currentTask) return state.currentTask;
        const candidates = Array.from(document.querySelectorAll('h1, h2, h3, .main div, [class*="title"]'))
            .map(el => (el.innerText || '').trim())
            .filter(t => t.includes('学习地图') || (t.includes('培训') && t.length < 50));
        if (candidates.length > 0) return candidates[0].split('\n')[0].trim();
        return "";
    }

    // 只读平台已有数据，不修改 React 状态，也不拦截平台请求。
    function getPlatformEntityId(el, kind) {
        if (!el) return '';
        const attrs = kind === 'chapter' ? ['data-chapter-id', 'data-section-id', 'data-id'] :
            kind === 'course' ? ['data-course-id', 'data-id'] : ['data-task-id', 'data-tp-id', 'data-id'];
        for (const name of attrs) {
            const value = el.getAttribute?.(name);
            if (value) return String(value);
        }
        try {
            const fiberKey = Object.getOwnPropertyNames(el).find(key => /^__react(Fiber|InternalInstance)\$/.test(key));
            let fiber = fiberKey && el[fiberKey];
            let keyedId = '';
            for (let depth = 0; fiber && depth < 4; depth++, fiber = fiber.return) {
                const p = fiber.memoizedProps || {};
                const item = p.item || p.data || p.record || {};
                const value = kind === 'chapter' ? p.section?.id || p.chapter?.id || p.chapterId :
                    kind === 'course' ? p.section?.courseId || p.courseId || p.course?.id || p.courseInfo?.courseVo?.id || item.courseId || item.relationId :
                    p.tpId || p.task?.tpId || p.task?.id || item.tpId || item.trainingId || item.id;
                if (typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))) return String(value);
                if (!keyedId && /^\d+$/.test(fiber.key || '')) keyedId = fiber.key;
            }
            if (keyedId) return keyedId;
        } catch (_) {}
        return '';
    }

    // 从任务卡片提取 Task ID
    function getTaskIdFromCard(card) {
        if (!card) return "";
        const platformId = getPlatformEntityId(card, 'task');
        if (platformId) return platformId;
        const id = (typeof card.getAttribute === 'function' ? (card.getAttribute('data-id') || card.getAttribute('id')) : null) || (card.dataset && card.dataset.id);
        if (id) return id;
        const link = typeof card.querySelector === 'function' ? card.querySelector('a[href*="/training/"]') : null;
        if (link) {
            const m = link.href.match(/\/training\/(?:detail|study)\/(\d+)/);
            if (m) return m[1];
        }
        return "";
    }

    // 从课程条目提取唯一标识（优先 ID，兜底标题）
    function getCourseKeyFromItem(c) {
        if (!c) return "";
        const platformId = getPlatformEntityId(c, 'course');
        if (platformId) return platformId;
        const id = (typeof c.getAttribute === 'function' ? (c.getAttribute('data-id') || c.getAttribute('data-course-id') || c.getAttribute('id')) : null) || (c.dataset && (c.dataset.id || c.dataset.courseId));
        if (id) return id;
        const link = typeof c.querySelector === 'function' ? c.querySelector('a[href*="/course/"], a[href*="/courseplay/"]') : null;
        if (link) {
            const lm = link.href.match(/\/(?:course|courseplay)\/(\d+)/);
            if (lm) return lm[1];
        }
        return (c.innerText || '').split('\n')[0].trim();
    }

    // [P1 修复] 按“地图 ID + 课程标识”作用域记录已处理课程，防止不同地图同名课程被误跳过（同时同步 localStorage 支持跨标签并发）
    function getHandledCourses() {
        try {
            const local = JSON.parse(getLocalItem(STORAGE_KEYS.handledCourses, '[]')) || [];
            const session = JSON.parse(getStorageItem(STORAGE_KEYS.handledCourses, 'jinpei_handled_courses') || '[]') || [];
            return Array.from(new Set([...local, ...session]));
        } catch (_) {
            return [];
        }
    }

    function markCourseHandled(arg1, arg2) {
        let mapId, courseKey;
        if (arg2 === undefined) {
            mapId = getCurrentMapId() || 'global';
            courseKey = arg1;
        } else {
            mapId = arg1 || getCurrentMapId() || 'global';
            courseKey = arg2;
        }
        if (!courseKey) return;
        const list = getHandledCourses();
        const scopedKey = `${mapId}::${courseKey}`;
        if (!list.includes(scopedKey)) {
            list.push(scopedKey);
            const str = JSON.stringify(list);
            setStorageItem(STORAGE_KEYS.handledCourses, str);
            setLocalItem(STORAGE_KEYS.handledCourses, str);
        }
    }

    function isCourseHandled(arg1, arg2) {
        let mapId, courseKey;
        if (arg2 === undefined) {
            mapId = getCurrentMapId() || 'global';
            courseKey = arg1;
        } else {
            mapId = arg1 || getCurrentMapId() || 'global';
            courseKey = arg2;
        }
        if (!courseKey) return false;
        const list = getHandledCourses();
        return list.includes(`${mapId}::${courseKey}`);
    }

    // [P2 修复] 已学完视频/跳过考试的学习地图记录管理器（防止任务中心未打勾导致死循环重复进入）
    function getHandledMaps() {
        try {
            const local = JSON.parse(getLocalItem(STORAGE_KEYS.handledMaps, '[]')) || [];
            const session = JSON.parse(getStorageItem(STORAGE_KEYS.handledMaps, 'jinpei_handled_maps') || '[]') || [];
            return Array.from(new Set([...local, ...session]));
        } catch (_) {
            return [];
        }
    }

    function markMapHandled(mapKey) {
        if (!mapKey) return;
        const list = getHandledMaps();
        if (!list.includes(mapKey)) {
            list.push(mapKey);
            const str = JSON.stringify(list);
            setStorageItem(STORAGE_KEYS.handledMaps, str);
            setLocalItem(STORAGE_KEYS.handledMaps, str);
        }
    }

    // 提取当前课程标题（从全局状态、页面面包屑、头部或标题中提取）
    function getCurrentCourseTitle() {
        if (state.currentCourse) return state.currentCourse;
        const breadcrumbEl = document.querySelector('.ant5-breadcrumb, .ant-breadcrumb, [class*="breadcrumb"]');
        if (breadcrumbEl) {
            const parts = Array.from(breadcrumbEl.querySelectorAll('li, span, a'))
                .map(el => (el.innerText || '').trim())
                .filter(t => t && !/^(首页|我的任务|培训|学习地图)$/.test(t));
            if (parts.length > 0) return parts[parts.length - 1];
        }
        const titleEl = document.querySelector('h1, h2, [class*="courseTitle"], [class*="course-title"], [class*="headerTitle"]');
        if (titleEl) {
            const t = (titleEl.innerText || '').trim();
            if (t && t.length < 60) return t;
        }
        if (document.title && !document.title.includes('江南金融') && !document.title.includes('登录')) {
            return document.title.split('-')[0].trim();
        }
        return "";
    }

    // 提取当前课程在 URL 中的 ID
    function getCurrentCourseId() {
        const active = Array.from(document.querySelectorAll('div.group.cursor-pointer, [class*="min-h-10"][class*="cursor-pointer"]'))
            .find(el => /\d{1,2}:\d{2}/.test(el.innerText || '') && isSubVideoActive(el));
        const platformId = getPlatformEntityId(active, 'course');
        if (platformId) return platformId;
        const path = (location && (location.pathname || location.href)) || "";
        const m = path.match(/\/courseplay\/(\d+)/);
        return m ? m[1] : "";
    }

// ==========================================
    // 3.1 看门狗服务 (Watchdog: 进度卡死检测、自动刷新、异常小节跳过与终极暂停保护)
    // ==========================================
    function getSubVideoTitle(el) {
        if (!el) return "";
        const titleEl = typeof el.querySelector === 'function' ? el.querySelector('[title], .truncate') : null;
        if (titleEl && titleEl.title) return titleEl.title.trim();
        if (titleEl && titleEl.innerText) return titleEl.innerText.trim();
        return (el.innerText || '').split('\n')[0].trim();
    }

    function getSubVideoKey(el) {
        if (!el) return "";
        const mapId = getCurrentMapId() || 'global';
        const courseKey = getPlatformEntityId(el, 'course') || getCurrentCourseId() || currentClaim?.course.courseKey || getCurrentCourseTitle() || 'unknown';
        const subKey = getPlatformEntityId(el, 'chapter') || getSubVideoTitle(el);
        return `${mapId}::${courseKey}::${subKey}`;
    }

    function getFailedSubVideos() {
        try {
            const session = JSON.parse(getStorageItem(STORAGE_KEYS.failedVideos)) || [];
            return [...new Set([...session, ...getCourseOutcomes().flatMap(value => value.failedSubKeys)])];
        } catch (_) {
            return [];
        }
    }

    function markSubVideoFailed(subKey) {
        if (!subKey) return;
        const list = getFailedSubVideos();
        if (!list.includes(subKey)) {
            list.push(subKey);
            setStorageItem(STORAGE_KEYS.failedVideos, JSON.stringify(list));
            saveCourseOutcome('skipped', [subKey]);
        }
    }

    function isSubVideoFailed(subKey) {
        if (!subKey) return false;
        const list = getFailedSubVideos();
        return list.includes(subKey);
    }

    let completionReplayGeneration = 0;
    let completionReplayMemory = null;

    function getCompletionReplayState() {
        if (completionReplayMemory) return completionReplayMemory;
        try {
            const value = JSON.parse(getStorageItem(STORAGE_KEYS.completionReplay));
            if (value && typeof value.subVideoKey === 'string' && Number.isInteger(value.attempts) && value.attempts >= 0) return value;
        } catch (_) {}
        return { subVideoKey: '', attempts: 0 };
    }

    function clearCompletedReplay(subEl) {
        if (subEl && isItemCompleted(subEl) && getCompletionReplayState().subVideoKey === getSubVideoKey(subEl)) {
            completionReplayGeneration++;
            completionReplayMemory = null;
            removeStorageItem(STORAGE_KEYS.completionReplay);
        }
    }

    function findCourseTab(label) {
        return Array.from(document.querySelectorAll('[role="tab"], .ant5-tabs-tab-btn, .ant-tabs-tab-btn'))
            .find(el => {
                // Ant Design 会把隐藏的读屏提示插入活动标签，innerText 不再只有“目录”。
                const directText = Array.from(el.childNodes || []).filter(node => node.nodeType === 3).map(node => node.textContent).join('').trim();
                return (directText || (el.innerText || '').trim()) === label && el.offsetParent !== null;
            });
    }

    function isCourseTabActive(label) {
        const tab = findCourseTab(label);
        return !!tab && tab.getAttribute('aria-selected') === 'true';
    }

    function directoryDurationSeconds(items) {
        let total = 0;
        for (const item of items) {
            const matches = (item.innerText || '').match(/\b\d{1,3}:\d{2}(?::\d{2})?\b/g);
            if (!matches) return 0;
            const seconds = parseTimeToSeconds(matches[matches.length - 1]);
            if (!(seconds > 0)) return 0;
            total += seconds;
        }
        return total;
    }

    function readPlatformLearningRecord() {
        const roots = Array.from(document.querySelectorAll('[class*="course-records"], [class*="courseRecords"], [class*="record-list"]'));
        const root = roots.find(el => el.offsetParent !== null && /学习总时长/.test(el.innerText || ''));
        if (!root || root.querySelector('.ant5-spin-spinning, .ant-spin-spinning, [aria-busy="true"]')) return null;
        const match = (root.innerText || '').match(/学习总时长\s*(\d{1,3}[:：]\d{2}[:：]\d{2})(?!\d)/);
        if (!match) return null;
        const parts = match[1].replace(/：/g, ':').split(':').map(Number);
        if (parts[1] >= 60 || parts[2] >= 60) return null;
        return { learnedSeconds: parts[0] * 3600 + parts[1] * 60 + parts[2] };
    }

    // 记录是整课累计时长，不能替代当前小节的完成标记。
    function reconcileBeforeReplay(subEl, items) {
        const recordTab = findCourseTab('记录');
        const catalogTab = findCourseTab('目录');
        const requiredSeconds = directoryDurationSeconds(items);
        if (!recordTab || !catalogTab || !requiredSeconds) {
            diagnosticConsole.log('平台学习记录入口或目录时长不可用，沿用有限末尾重播。');
            replayVideoTail(subEl);
            return;
        }
        if (learningRecordPending) return;
        const subKey = getSubVideoKey(subEl);
        const scope = capturePlaybackScope(subEl);
        const generation = completionReplayGeneration;
        const startedAt = Date.now();
        let record = null;
        learningRecordPending = true;
        state.isSwitching = true;
        state.isActionPending = true;
        const valid = () => generation === completionReplayGeneration && isPlaybackScopeCurrent(scope, true);
        function cancelIfChanged() {
            if (valid()) return false;
            if (generation === completionReplayGeneration) {
                learningRecordPending = false;
                if (state.enabled) cancelStalePlaybackWait();
            }
            return true;
        }
        function renew() {
            if (currentClaim && !registerTabHeartbeat()) { pauseAutomation('核对记录时无法续期课程占用，已暂停。'); return false; }
            return true;
        }
        function resumeForCurrent(active) {
            learningRecordPending = false;
            state.isActionPending = false;
            if (isItemCompleted(active)) {
                state.syncRetryCount = 0;
                switchToNextSubVideoOrCourse();
            } else {
                replayVideoTail(active);
            }
        }
        function restoreCatalog() {
            if (cancelIfChanged()) return;
            const tab = findCourseTab('目录');
            if (!tab) { pauseAutomation('核对学习记录后无法返回小节目录，已暂停。'); return; }
            simulateHumanClick(tab);
            const restoreStarted = Date.now();
            function pollCatalog() {
                if (cancelIfChanged() || !renew()) return;
                const active = isCourseTabActive('目录') && getAllSubVideoItems().find(isSubVideoActive);
                if (active) {
                    if (getSubVideoKey(active) !== subKey) {
                        learningRecordPending = false;
                        state.isActionPending = false;
                        state.isSwitching = false;
                        diagnosticConsole.warn('核对期间小节已更换，取消旧小节的恢复操作。');
                        return;
                    }
                    if (isItemCompleted(active) || !record || record.learnedSeconds < requiredSeconds) {
                        resumeForCurrent(active);
                        return;
                    }
                    // 时长达标只延长等待，不把任何未打勾的小节视为完成。
                    const markerStarted = Date.now();
                    updateHUD('课程累计时长已达目录总时长，等待当前小节完成标记...');
                    function pollMarker() {
                        if (cancelIfChanged() || !renew()) return;
                        const current = getAllSubVideoItems().find(isSubVideoActive);
                        if (!current || getSubVideoKey(current) !== subKey) {
                            pauseAutomation('等待完成标记时小节目录发生变化，已暂停。');
                            return;
                        }
                        if (isItemCompleted(current)) { resumeForCurrent(current); return; }
                        if (Date.now() - markerStarted >= CONFIG.completionMarkerWait) {
                            diagnosticConsole.warn('课程累计时长已达标但小节仍未打勾，回退到原有有限重播，不据此跳过小节。');
                            resumeForCurrent(current);
                            return;
                        }
                        setManagedTimeout(pollMarker, 500);
                    }
                    pollMarker();
                    return;
                }
                if (Date.now() - restoreStarted >= CONFIG.learningRecordWait) { pauseAutomation('核对记录后小节目录加载超时，已暂停。'); return; }
                setManagedTimeout(pollCatalog, 500);
            }
            setManagedTimeout(pollCatalog, 500);
        }
        function pollRecord() {
            if (cancelIfChanged() || !renew()) return;
            record = isCourseTabActive('记录') ? readPlatformLearningRecord() : null;
            if (record) {
                diagnosticConsole.log(`平台课程累计学习时长 ${formatTime(record.learnedSeconds)}，目录视频总时长 ${formatTime(requiredSeconds)}；${record.learnedSeconds >= requiredSeconds ? '延长等待完成标记' : '仍有时长缺口，按原规则有限重播'}。`);
                restoreCatalog();
            } else if (Date.now() - startedAt >= CONFIG.learningRecordWait) {
                diagnosticConsole.warn('平台学习记录加载超时或格式无法识别，返回目录后按原规则有限重播。');
                restoreCatalog();
            } else {
                setManagedTimeout(pollRecord, 500);
            }
        }
        updateHUD('正在核对平台学习记录...');
        diagnosticConsole.log('打开平台记录页核对课程累计时长。');
        simulateHumanClick(recordTab);
        setManagedTimeout(pollRecord, 500);
    }

    function replayVideoTail(subEl) {
        const subVideoKey = getSubVideoKey(subEl);
        const title = getSubVideoTitle(subEl);
        const previous = getCompletionReplayState();
        const attempts = previous.subVideoKey === subVideoKey ? previous.attempts : 0;
        if (attempts >= CONFIG.maxCompletionReplays) {
            pauseAutomation(`「${title}」重播 ${CONFIG.maxCompletionReplays} 次后仍未打勾，已暂停；请检查网络和学习记录。`);
            return;
        }
        const video = document.querySelector('video');
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
            pauseAutomation(`「${title}」无法获取视频时长，无法回退重播，已暂停。`);
            return;
        }
        const targetTime = Math.max(0, video.duration - CONFIG.completionReplaySeconds);
        const generation = ++completionReplayGeneration;
        const scope = capturePlaybackScope(subEl);
        const stillCurrent = () => generation === completionReplayGeneration && isPlaybackScopeCurrent(scope);
        const startedAt = Date.now();
        let playAttempts = 0;
        let requestId = 0;
        let settled = false;
        let seekConfirmed = false;
        let lastError = '';
        const isPending = () => {
            if (settled) return false;
            if (stillCurrent()) return true;
            // 路由或播放器被用户切换后，旧恢复任务退出并释放自己的锁。
            if (state.enabled && generation === completionReplayGeneration) {
                settled = true;
                cancelStalePlaybackWait();
            }
            return false;
        };
        const fail = (reason) => {
            if (!isPending()) return;
            settled = true;
            diagnosticConsole.error(`【神奇海螺】重播恢复失败: ${reason}`, {
                currentTime: video.currentTime, targetTime, seeking: video.seeking,
                readyState: video.readyState, paused: video.paused, playAttempts,
            });
            pauseAutomation(`「${title}」${reason}，已暂停；请检查播放器和网络。`);
        };
        const finish = () => {
            if (!isPending()) return;
            settled = true;
            state.isSwitching = false;
            state.isActionPending = false;
            watchdogRuntime.lastCurrentTime = video.currentTime;
            watchdogRuntime.initialProgressTime = video.currentTime;
            watchdogRuntime.lastProgressTimestamp = Date.now();
            if (CONFIG.debugPlayback) diagnosticConsole.log('播放诊断：末尾重播已启动', {
                targetTime, currentTime: video.currentTime, duration: video.duration,
                paused: video.paused, seeking: video.seeking, playAttempts,
            });
            updateHUD(`「${title}」已恢复重播 (${attempts + 1}/${CONFIG.maxCompletionReplays})...`);
        };
        const retry = (error, id) => {
            if (!isPending() || id !== requestId) return;
            requestId++; // 忽略被中断的旧播放请求及其迟到回调
            lastError = `${error?.name || 'Error'}: ${error?.message || String(error)}`;
            diagnosticConsole.warn(`【神奇海螺】重播播放请求失败 (${playAttempts}/${CONFIG.replayPlayMaxAttempts}): ${lastError}`);
            if (playAttempts >= CONFIG.replayPlayMaxAttempts) {
                fail(`重播启动连续失败 ${playAttempts} 次 (${lastError})`);
                return;
            }
            updateHUD(`「${title}」等待播放器恢复，准备重试播放 (${playAttempts}/${CONFIG.replayPlayMaxAttempts})...`);
            setManagedTimeout(waitAndPlay, 1000);
        };
        const waitAndPlay = () => {
            if (!isPending()) return;
            if (Date.now() - startedAt >= CONFIG.replayStartTimeout) {
                fail(`回退后恢复播放超时${lastError ? ` (${lastError})` : ''}`);
                return;
            }
            if (isItemCompleted(subEl)) {
                settled = true;
                clearCompletedReplay(subEl);
                state.isSwitching = false;
                state.isActionPending = false;
                switchToNextSubVideoOrCourse();
                return;
            }
            // currentTime 已赋值不代表跳转完成，还需等待 seek 与缓冲就绪。
            if (!video.seeking && Math.abs(video.currentTime - targetTime) <= 1) seekConfirmed = true;
            if (!seekConfirmed || video.seeking || (typeof video.readyState === 'number' && video.readyState < 2)) {
                setManagedTimeout(waitAndPlay, 500);
                return;
            }
            playAttempts++;
            const id = ++requestId;
            try {
                Promise.resolve(video.play()).then(() => {
                    if (!isPending() || id !== requestId) return;
                    if (video.paused || video.seeking) {
                        retry(new Error('播放器尚未进入播放状态'), id);
                    } else {
                        finish();
                    }
                }, error => retry(error, id));
                // play() 可能一直不返回结果，不能无限等待。
                setManagedTimeout(() => retry(new Error('播放请求等待超时'), id), 4000);
            } catch (error) {
                retry(error, id);
            }
        };
        try {
            // 以总时长为基准，兼容播放器结束后把 currentTime 重置为 0 的情况。
            observeVideoPlayback(video);
            const tracker = playbackDiagnostics.get(video);
            if (tracker) delete tracker.completion;
            if (CONFIG.debugPlayback) diagnosticConsole.warn('播放诊断：脚本请求末尾回退', {
                subKey: subVideoKey, from: video.currentTime, duration: video.duration,
                targetTime, replaySeconds: CONFIG.completionReplaySeconds, attempt: attempts + 1,
            });
            video.currentTime = targetTime;
            completionReplayMemory = { subVideoKey, attempts: attempts + 1 };
            setStorageItem(STORAGE_KEYS.completionReplay, JSON.stringify(completionReplayMemory));
            state.syncRetryCount = 0;
            state.isSwitching = true;
            state.isActionPending = true;
            watchdogRuntime.subVideoKey = subVideoKey;
            watchdogRuntime.lastCurrentTime = targetTime;
            watchdogRuntime.initialProgressTime = targetTime;
            watchdogRuntime.lastProgressTimestamp = Date.now();
            const message = `「${title}」尚未打勾，重播末尾 ${Math.min(video.duration, CONFIG.completionReplaySeconds)} 秒 (${attempts + 1}/${CONFIG.maxCompletionReplays})...`;
            diagnosticConsole.warn(`【神奇海螺】${message}`);
            updateHUD(message);
            setManagedTimeout(waitAndPlay, 500);
        } catch (error) {
            fail(`回退重播失败 (${error?.name || 'Error'}: ${error?.message || String(error)})`);
        }
    }

    function getWatchdogState() {
        try {
            return JSON.parse(getStorageItem(STORAGE_KEYS.watchdog)) || {
                subVideoKey: "",
                reloadCount: 0,
                consecutiveFails: 0
            };
        } catch (_) {
            return { subVideoKey: "", reloadCount: 0, consecutiveFails: 0 };
        }
    }

    function setWatchdogState(wd) {
        setStorageItem(STORAGE_KEYS.watchdog, JSON.stringify(wd));
    }

    function clearWatchdogState() {
        removeStorageItem(STORAGE_KEYS.watchdog);
    }

    const watchdogRuntime = {
        subVideoKey: "",
        lastCurrentTime: -1,
        lastProgressTimestamp: -1,
        initialProgressTime: -1,
    };

    function checkWatchdog(video, activeSubEl, allSubItems) {
        if (!state.enabled || state.isSwitching || state.isActionPending) return;
        if (!video) return;

        // 视频播放完成判定中或已结束，不触发卡顿看门狗
        if (hasPlaybackCompletion(video, activeSubEl) || video.ended ||
            (video.duration > 0 && video.currentTime >= video.duration)) {
            return;
        }

        const activeSub = activeSubEl || (allSubItems && allSubItems.length > 0 ? allSubItems.find(isSubVideoActive) || allSubItems[0] : null);
        const subKey = getSubVideoKey(activeSub);
        if (!subKey) return;

        const wd = getWatchdogState();

        // 1. 如果换到了不同的小节，重置当前小节的刷新计数
        if (wd.subVideoKey !== subKey) {
            wd.subVideoKey = subKey;
            wd.reloadCount = 0;
            setWatchdogState(wd);

            watchdogRuntime.subVideoKey = subKey;
            watchdogRuntime.lastCurrentTime = video.currentTime;
            watchdogRuntime.lastProgressTimestamp = Date.now();
            watchdogRuntime.initialProgressTime = video.currentTime;
            return;
        }

        if (watchdogRuntime.subVideoKey !== subKey || watchdogRuntime.lastProgressTimestamp < 0) {
            watchdogRuntime.subVideoKey = subKey;
            watchdogRuntime.lastCurrentTime = video.currentTime;
            watchdogRuntime.lastProgressTimestamp = Date.now();
            watchdogRuntime.initialProgressTime = video.currentTime;
        }

        // 2. 检查播放进度推进
        const timeDiff = Math.abs(video.currentTime - watchdogRuntime.lastCurrentTime);
        if (timeDiff >= 0.5) {
            // 进度在正常前进！
            watchdogRuntime.lastCurrentTime = video.currentTime;
            watchdogRuntime.lastProgressTimestamp = Date.now();

            // 若从进入起向前正常推进超过 3 秒，确信视频已成功播放，清除当前小节刷新计数和连续失败计数
            if (Math.abs(video.currentTime - watchdogRuntime.initialProgressTime) >= 3) {
                if (wd.reloadCount > 0 || wd.consecutiveFails > 0) {
                    diagnosticConsole.log("【神奇海螺·看门狗】视频恢复正常稳定播放，清除看门狗异常计数。");
                    wd.reloadCount = 0;
                    wd.consecutiveFails = 0;
                    setWatchdogState(wd);
                }
            }
            return;
        }

        // 3. 进度未前进，计算卡住停滞时间
        const stallTime = Date.now() - watchdogRuntime.lastProgressTimestamp;
        if (stallTime >= CONFIG.watchdogStallTimeout) {
            const replay = getCompletionReplayState();
            if (replay.subVideoKey === subKey && replay.attempts > 0) {
                pauseAutomation(`「${getSubVideoTitle(activeSub)}」重播期间播放停滞，已暂停；请检查播放器和网络。`);
                return;
            }
            diagnosticConsole.warn(`【神奇海螺·看门狗】检测到视频进度停滞超过 ${Math.round(stallTime / 1000)} 秒 (阈值: ${CONFIG.watchdogStallTimeout / 1000}s)！`);

            // 规则 1: 如果还未超过 5 次重试，自动刷新网页
            if (wd.reloadCount < CONFIG.watchdogMaxReloads) {
                wd.reloadCount++;
                setWatchdogState(wd);
                const reloadMsg = `⚠️ 视频进度卡住超过 30 秒，看门狗自动刷新页面（第 ${wd.reloadCount}/${CONFIG.watchdogMaxReloads} 次）...`;
                updateHUD(reloadMsg);
                diagnosticConsole.warn(`【神奇海螺·看门狗】${reloadMsg}`);
                if (typeof location !== 'undefined' && typeof location.reload === 'function') {
                    location.reload();
                }
                return;
            }

            // 规则 2: 超过 5 次还没能恢复，跳过当前这一节课
            wd.consecutiveFails++;
            wd.reloadCount = 0;
            markSubVideoFailed(subKey);
            setWatchdogState(wd);

            // 规则 3: 连续 3 节课都加载不出来，自动暂停学习
            if (wd.consecutiveFails >= CONFIG.watchdogMaxConsecutiveFails) {
                diagnosticConsole.error(`【神奇海螺·看门狗】连续 ${wd.consecutiveFails} 节视频加载失败，触发终极暂停保护！`);
                clearWatchdogState();
                pauseAutomation(`⚠️ 连续 ${CONFIG.watchdogMaxConsecutiveFails} 节课均无法正常加载播放，看门狗已自动暂停学习！请检查网络连接或课件。`);
                return;
            }

            const skipMsg = `⚠️ 当前小节连续 ${CONFIG.watchdogMaxReloads} 次刷新仍无法恢复播放，看门狗自动跳过并切换下一节（连续失败 ${wd.consecutiveFails}/${CONFIG.watchdogMaxConsecutiveFails} 节）...`;
            updateHUD(skipMsg);
            diagnosticConsole.warn(`【神奇海螺·看门狗】${skipMsg}`);
            watchdogRuntime.lastProgressTimestamp = Date.now();
            state.isSwitching = true;
            setManagedTimeout(() => {
                switchToNextSubVideoOrCourse();
            }, 1000);
        }
    }

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

// 流程 A: 登录状态检测与重定向
    function handleLoginAndIndex() {
        const url = location.href;
        if (url.includes('/home/login')) {
            updateHUD("等待用户登录账号...");
            return;
        }

        if (url.includes('/home/index') || url.includes('/home/portal')) {
            const hasToken = localStorage.getItem('_l_KPLiPs') || document.cookie.includes('_c_WBKFRo');
            const hasUserArea = document.querySelector('.header__b48WI, .user, [class*="user"], [class*="avatar"]');

            if (hasToken || hasUserArea) {
                if (state.isActionPending) return;
                state.isActionPending = true;
                updateHUD("检测到已登录，正在跳转任务中心...");
                setManagedTimeout(() => {
                    location.href = CONFIG.myTaskUrl;
                }, 1500);
            } else {
                updateHUD("请先完成登录...");
            }
        }
    }


    // 流程 B: 任务页 (myTask) 检查与自动进入
    let taskDispatchPending = false;
    async function handleMyTaskPage() {
        if (state.isActionPending || taskDispatchPending) return;
        taskDispatchPending = true;
        const url = location.href;
        const generation = claimGeneration;
        try {
            updateHUD("正在检查我的任务列表...");
            await loadTaskCatalog();
            if (!state.enabled || location.href !== url || generation !== claimGeneration) return;
            const cards = getTaskCards();
            const tasks = getPendingTasks(cards);
            if (!cards.length && !getTaskCatalog().length) {
                updateHUD("等待任务列表加载...");
                return;
            }
            if (getTaskSelection().mode === 'ids' && !getTaskSelection().ids.length) {
                pauseAutomation('请先勾选要学习的任务，再点击开始。');
                renderTaskSelection(true);
                return;
            }

            if (tasks.length) {
                if (!navigator.locks) throw new Error('浏览器不支持跨窗口任务调度，请使用新版 Chrome');
                await navigator.locks.request('_kme_task_scheduler', () => {
                    if (!state.enabled || location.href !== url || generation !== claimGeneration) return;
                    const task = pickNextTask(getPendingTasks(cards));
                    if (task) enterAssignedTask(task, cards.find(card => taskSelectionKey(card) === task.key));
                    else {
                        registerTabHeartbeat('', '等待其他任务空闲', '');
                        updateHUD('已选任务暂时没有空闲课程，等待其他窗口推进...');
                    }
                });
            } else {
                const outcomes = getCourseOutcomes();
                const skipped = outcomes.filter(value => value.status === 'skipped').length;
                const exams = outcomes.filter(value => value.status === 'exam').length;
                pauseAutomation(skipped || exams
                    ? `本轮任务处理结束：异常跳过 ${skipped} 门，待考试 ${exams} 门；平台尚未全部完成。`
                    : '本轮任务检查结束；已处理的历史任务请以平台完成状态为准。');
                if (window.opener && window.opener !== window) window.close();
            }
        } catch (error) {
            if (state.enabled) pauseAutomation(error.message || '任务调度失败');
        } finally { taskDispatchPending = false; }
    }

    // 流程 C: 任务详情页 (training/detail)
    function handleDetailPage() {
        if (state.isActionPending) return;
        updateHUD("任务详情页，正在寻找学习入口...");

        const enterBtn = getStudyEntryButton();

        if (enterBtn) {
            state.isActionPending = true;
            updateHUD("点击进入学习目录...");
            setManagedTimeout(() => {
                simulateHumanClick(enterBtn);
                waitForPageReady('学习目录加载', isStudyPageReady);
            }, 1200);
        }
    }

    function getCourseItems() {
        return Array.from(document.querySelectorAll('[class*="panelContent"], .course-wrap [class*="item"], div[class*="cursor-pointer"]'))
            .filter(el => {
                const text = el.innerText || '';
                return /(课程|学时|课时|学分|分钟|\d+%|必修|选修)/.test(text) && el.children.length <= 12 && text.length < 300 && el.offsetParent !== null;
            });
    }

    // 返回目录后按实际路由和目录内容解锁；超时暂停，不重复点击。
    function waitForCourseCatalog() {
        waitForPageReady('返回学习目录', () =>
            (!document.querySelector('video') && isStudyPageReady()) ||
            (location.href.includes('/home/my/myTask') && getTaskCards().length > 0) ||
            (location.href.includes('/home/training/detail/') && !!getStudyEntryButton()), CONFIG.catalogWaitTimeout);
    }

    // 流程 D: 学习与播放页 (training/study)
    async function handleStudyPage() {
        if (studyCheckPending) return;
        studyCheckPending = true;
        try {
            await processStudyPage();
        } catch (error) {
            if (state.enabled) pauseAutomation(error.message || '课程调度异常，已暂停');
            diagnosticConsole.error('【神奇海螺】课程调度失败:', error);
        } finally {
            studyCheckPending = false;
        }
    }

    async function processStudyPage() {
        if (pageWaitActive || learningRecordPending || chapterCatalogWaitPending) return;
        const selection = getTaskSelection();
        const mapId = getCurrentMapId();
        if (selection?.mode === 'ids' && mapId && !selection.ids.includes(mapId) && !selection.ids.includes('title:' + state.currentTask)) {
            pauseAutomation('当前学习地图未勾选，已暂停。请在 HUD 中修改选择。');
            return;
        }
        const pageUrl = location.href;
        let generation = claimGeneration;
        const video = document.querySelector('video');

        // 情况 1: 页面正在展示课程大目录（中间主区域未打开视频播放器）
        if (!video) {
            if (state.isActionPending) return;
            // 已退回或处于课程大目录，重置视频切课状态
            state.isSwitching = false;
            updateHUD("正在分析课程目录...");

            // 提取所有大课程条目（兼容 panelContent 及其它变体）
            const courseItems = getCourseItems();

            if (courseItems.length > 0) {
                // 确认课程目录已出现才释放旧领取；播放器加载中的空白过渡不释放。
                if (currentClaim) {
                    diagnosticConsole.log('课程调度：已返回课程目录，释放当前窗口旧课程', currentClaim.course);
                    unregisterTab();
                    generation = claimGeneration;
                    state.currentCourse = '';
                    state.currentSubVideo = '';
                    state.syncRetryCount = 0;
                    completionReplayGeneration++;
                    completionReplayMemory = null;
                }
                if (typeof navigator === 'undefined' || !navigator.locks) {
                    throw new Error('浏览器不支持跨窗口课程锁，请使用新版 Chrome');
                }
                await navigator.locks.request('_kme_course_scheduler', reconcileCourseHeartbeats);
                if (!state.enabled || generation !== claimGeneration || location.href !== pageUrl || document.querySelector('video')) return;
                const mapId = getCurrentMapId();
                const concurrency = getConcurrencySetting();
                state.concurrency = concurrency;
                const activeTabs = getActiveTabs();
                const activeTabsCount = Math.max(1, Object.keys(activeTabs).length);

                // 统计地图所有课程的总进度
                let completedCount = 0;
                let processedCount = 0;
                let skippedCount = 0;
                let examCount = 0;
                let unverifiedCount = 0;
                const totalCount = courseItems.length;
                for (const c of courseItems) {
                    const disposition = getCourseDisposition(c, mapId);
                    if (disposition !== 'pending') processedCount++;
                    if (disposition === 'completed') completedCount++;
                    if (disposition === 'skipped') skippedCount++;
                    if (disposition === 'exam') examCount++;
                    if (disposition === 'unverified') unverifiedCount++;
                }
                const pct = totalCount > 0 ? Math.floor((completedCount / totalCount) * 100) : 0;
                const allCoursesProg = `${completedCount} / ${totalCount} 门 (${pct}%)` +
                    (skippedCount || examCount || unverifiedCount ? ` · 异常 ${skippedCount} · 待考试 ${examCount} · 待核验 ${unverifiedCount}` : '');
                setStorageItem(STORAGE_KEYS.mapProgress, allCoursesProg);

                // 如果所有课程全部完成
                if (processedCount === totalCount) {
                    state.isActionPending = true;
                    updateHUD(completedCount === totalCount ? '🎉 本地图课程已确认完成！返回任务中心...' :
                        `本轮处理结束：完成 ${completedCount}，异常 ${skippedCount}，待考试 ${examCount}，待核验 ${unverifiedCount}；返回任务中心...`, undefined, undefined, undefined, undefined, allCoursesProg);
                    // 标记当前地图为已处理（即使包含跳过的考试，防止回任务页又反复进入该地图）
                    if (mapId) markMapHandled(mapId);
                    if (state.currentTask) markMapHandled(state.currentTask);
                    const mapTitle = getMapTitleFromPage();
                    if (mapTitle) markMapHandled(mapTitle);

                    unregisterTab();

                    // 如果当前窗口是由主窗口弹出的并发子窗口，学完后自动关闭本窗口释放资源
                    if (typeof window !== 'undefined' && window.opener && window.opener !== window && !getPendingTasks().length) {
                        diagnosticConsole.log("【神奇海螺】并发子窗口已学完全部课程，自动关闭窗口释放资源...");
                        setManagedTimeout(() => {
                            try {
                                window.close();
                            } catch (_) {
                                location.href = CONFIG.myTaskUrl;
                            }
                        }, 2000);
                        return;
                    }

                    setManagedTimeout(() => {
                        location.href = CONFIG.myTaskUrl;
                    }, 2000);
                    return;
                }

                // 过滤出未完成且未被记录跳过的大课
                const uncompletedCourses = courseItems.filter(c => {
                    return getCourseDisposition(c, mapId) === 'pending';
                });

                // 寻找第一个未被其他活跃窗口占用的课程
                let targetCourse = null;
                for (const c of uncompletedCourses) {
                    const cKey = getCourseKeyFromItem(c);
                    const cName = (c.innerText || '').split('\n')[0].trim();
                    if (!isCourseBusyByOtherTab(cKey, cName, mapId)) {
                        const claimed = await tryClaimCourseSlot(cKey, cName, mapId);
                        if (!state.enabled || generation !== claimGeneration || location.href !== pageUrl) {
                            if (claimed && generation === claimGeneration) unregisterTab();
                            return;
                        }
                        if (claimed) {
                            targetCourse = c;
                            break;
                        }
                    }
                }

                if (!state.enabled) return;
                if (targetCourse) {
                    // 若开启了多路并发，且当前活跃标签数少于目标并发数，且还有更多未开工的课程，尝试唤起新的并发窗口
                    const availableRemaining = uncompletedCourses.filter(c => {
                        const cKey = getCourseKeyFromItem(c);
                        const cName = (c.innerText || '').split('\n')[0].trim();
                        return c !== targetCourse && !isCourseBusyByOtherTab(cKey, cName, mapId);
                    });

                    if (concurrency > 1 && activeTabsCount < concurrency && (availableRemaining.length > 0 || pickNextTask(getPendingTasks(), mapId))) {
                        if (!state.lastTabSpawnTime || Date.now() - state.lastTabSpawnTime > 4000) {
                            state.lastTabSpawnTime = Date.now();
                            try {
                                if (typeof window !== 'undefined' && typeof window.open === 'function') {
                                    const newWin = await spawnTaskWorker();
                                    if (newWin) {
                                        diagnosticConsole.log(`【神奇海螺】当前已开启 ${activeTabsCount + 1}/${concurrency} 路并发学习！`);
                                    }
                                }
                            } catch (e) {
                                diagnosticConsole.warn("【神奇海螺】自动弹窗受阻，请允许弹窗或手动多开:", e);
                            }
                        }
                    }

                    if (!state.enabled || generation !== claimGeneration || location.href !== pageUrl) return;
                    state.isActionPending = true;
                    const cName = (targetCourse.innerText || '').split('\n')[0].trim();
                    state.currentCourse = cName;
                    updateHUD(`进入未完成课程: ${cName}`, undefined, undefined, undefined, cName, allCoursesProg);
                    diagnosticConsole.log("【神奇海螺】正在进入未完成大课:", cName);
                    setManagedTimeout(() => {
                        simulateHumanClick(targetCourse);
                        waitForPageReady('课程播放器与小节目录加载', () =>
                            !!document.querySelector('video') && isStudyPageReady());
                    }, 1000);
                } else {
                    const allBusyHere = uncompletedCourses.length && uncompletedCourses.every(c =>
                        isCourseBusyByOtherTab(getCourseKeyFromItem(c), (c.innerText || '').split('\n')[0].trim(), mapId));
                    if (allBusyHere) {
                        logSchedulerWait('剩余课程均存在其他窗口占用记录', { mapId });
                        setLocalItem('_kme_task_busy_' + mapId, String(Date.now() + 20000));
                        await loadTaskCatalog();
                        if (!state.enabled || generation !== claimGeneration || location.href !== pageUrl) return;
                        if (pickNextTask(getPendingTasks(), mapId)) {
                            const occupied = Object.values(getActiveTabs()).filter(tab => tab.courseKey).length;
                            if (occupied < concurrency) {
                                state.isActionPending = true;
                                unregisterTab();
                                updateHUD('当前任务课程已被其他窗口领取，转到其他已选任务...');
                                location.href = CONFIG.myTaskUrl;
                                return;
                            }
                        }
                    }
                    // 没领取到课程也可能是名额锁或残留状态；不直接推断其他窗口正在学习。
                    if (!registerTabHeartbeat("", "等待并发窗口完成中...", mapId)) {
                        throw new Error('无法保存窗口状态，已停止学习');
                    }
                    const occupiedCount = Object.entries(getActiveTabs()).filter(([id, data]) => id !== TAB_ID && data.courseKey).length;
                    const waitStatus = allBusyHere
                        ? `⏳ 剩余课程存在其他窗口占用记录 (${occupiedCount} 个)，等待释放...`
                        : `⏳ ${claimWaitReason || '暂未领取到课程'}，等待重新调度...`;
                    updateHUD(waitStatus, undefined, undefined, undefined, undefined, allCoursesProg);
                }
            }
            return;
        }

        // 情况 2: 页面已处于视频播放状态
        const detectedId = getCurrentCourseId();
        if (detectedId && currentClaim && detectedId !== currentClaim.course.courseKey) {
            unregisterTab();
            for (const timer of activeTimers) clearTimeout(timer);
            activeTimers.clear();
            pageWaitGeneration++;
            pageWaitActive = false;
            learningRecordPending = false;
            completionReplayGeneration++;
            completionReplayMemory = null;
            state.syncRetryCount = 0;
            state.currentCourse = '';
            state.isSwitching = false;
            state.isActionPending = false;
            return;
        }
        if (!currentClaim && !state.isSwitching && !state.isActionPending) {
            const title = getCurrentCourseTitle();
            const claimed = await tryClaimCourseSlot(getCurrentCourseId() || title, title, getCurrentMapId());
            if (!state.enabled || generation !== claimGeneration || location.href !== pageUrl || document.querySelector('video') !== video) {
                if (claimed && generation === claimGeneration) unregisterTab();
                return;
            }
            if (!claimed) {
                pauseAutomation('当前课程已被其他窗口占用或并发已满，已暂停');
                return;
            }
        }
        handleVideoPlayback(video);
    }

    // 流程 E: 视频播放管理、跳过已学视频与自动连播
    function handleVideoPlayback(video) {
        if (!ensureAllChaptersExpanded()) {
            waitForChapterCatalog(capturePlaybackScope(), () => handleVideoPlayback(video));
            return;
        }
        observeVideoPlayback(video);
        // 1. 静音与速率
        if (CONFIG.autoMute && !video.muted) {
            video.muted = true;
        }
        if (video.playbackRate !== CONFIG.playbackRate) {
            video.playbackRate = CONFIG.playbackRate;
        }

        // 2. 获取所有子视频条目
        const allSubItems = getAllSubVideoItems();

        // 计算当前大课程的总进度、总时长与百分比
        const courseProg = calculateCourseTotalProgress(allSubItems, video);

        // 提取全部课程进度 (从 sessionStorage 恢复)
        const allCoursesProg = getStorageItem(STORAGE_KEYS.mapProgress, 'jinpei_map_progress') || state.allCoursesProgress || "";

        // 提取课程名称
        if (!state.currentCourse) {
            const detectedCourse = getCurrentCourseTitle();
            if (detectedCourse) state.currentCourse = detectedCourse;
        }

        // 注册当前正在播放的课程心跳（跨标签页并发占位）
        const activeMapId = getCurrentMapId();
        const activeCourseKey = getCurrentCourseId() || state.currentCourse || getCurrentCourseTitle();
        const activeCourseTitle = state.currentCourse || getCurrentCourseTitle();
        if (activeCourseKey || activeCourseTitle) {
            if (!registerTabHeartbeat(activeCourseKey, activeCourseTitle, activeMapId)) {
                throw new Error('无法续期课程占用记录，已停止学习');
            }
        }

        // 提取当前正在播放/选中的子视频条目
        const activeSubEl = allSubItems.find(isSubVideoActive);
        clearCompletedReplay(activeSubEl);

        // 看门狗：实时检测进度停滞、自动刷新、连续异常跳过与终极暂停保护
        checkWatchdog(video, activeSubEl, allSubItems);
        if (!state.enabled || state.isSwitching) return;

        let currentSubName = "当前小节";
        if (activeSubEl) {
            const subTitleEl = activeSubEl.querySelector('[title], .truncate');
            if (subTitleEl) currentSubName = subTitleEl.innerText.trim();
        }

        // 3. 【核心能力：自动跳过已学小节与异常跳过小节】
        const now = Date.now();
        const isCurDoneOrFailed = activeSubEl && (isItemCompleted(activeSubEl) || isSubVideoFailed(getSubVideoKey(activeSubEl)));
        if (isCurDoneOrFailed && !state.isSwitching && (now - state.lastJumpTime > 5000)) {
            // 找到第一个未完成且未被跳过的小节
            const firstUncompleted = allSubItems.find(el => !isItemCompleted(el) && !isSubVideoFailed(getSubVideoKey(el)));
            if (firstUncompleted) {
                state.lastJumpTime = now;
                state.isSwitching = true;
                const nextTitle = firstUncompleted.querySelector('[title], .truncate')?.innerText || '下一未学小节';
                updateHUD(`跳过已学小节，自动切换至: ${nextTitle}`, undefined, nextTitle, "00:00", undefined, allCoursesProg, courseProg.text, courseProg.percent);
                diagnosticConsole.log("【神奇海螺】检测到当前小节已学完或跳过，自动点击下一未完成小节:", nextTitle);
                simulateHumanClick(firstUncompleted);
                setManagedTimeout(() => {
                    state.isSwitching = false;
                }, 3000);
                return;
            } else if (allSubItems.length > 0 && allSubItems.every(el => isItemCompleted(el) || isSubVideoFailed(getSubVideoKey(el)))) {
                // 严格核查：全量小节必须都已完成或跳过，才切换下一课程
                diagnosticConsole.log("【神奇海螺】当前课程的所有子视频均已严格核查完成或跳过！正在切换下一课程...");
                state.isSwitching = true;
                state.isActionPending = true;
                switchToNextSubVideoOrCourse();
                return;
            }
        }

        // 4. 进度展示
        const curr = formatTime(video.currentTime);
        const dur = formatTime(video.duration);
        const percent = video.duration > 0 ? Math.min(100, Math.floor((video.currentTime / video.duration) * 100)) : 0;
        const progressStr = `${curr} / ${dur} (${percent}%)`;
        const replay = getCompletionReplayState();
        const playbackStatus = activeSubEl && replay.subVideoKey === getSubVideoKey(activeSubEl) && replay.attempts > 0
            ? `正在重播末尾 ${CONFIG.completionReplaySeconds} 秒 (${replay.attempts}/${CONFIG.maxCompletionReplays})...`
            : "正在按时长播放中...";

        // 必须在自动 play() 前消费结束事件，避免平台归零后被当作普通暂停从头播放。
        const endedEvent = hasPlaybackCompletion(video, activeSubEl);
        const isVideoFinished = endedEvent || video.ended || (video.duration > 0 && video.currentTime >= video.duration);
        if (isVideoFinished && !state.isSwitching) {
            const tracker = playbackDiagnostics.get(video);
            if (tracker) delete tracker.completion;
            state.isSwitching = true;
            updateHUD(`当前节播放完毕，等待 ${CONFIG.heartbeatWait / 1000} 秒上报心跳...`, undefined, currentSubName, "100%", undefined, allCoursesProg, courseProg.text, courseProg.percent);
            diagnosticConsole.log("【神奇海螺】当前子视频播放结束，等待服务器心跳同步...", ...(CONFIG.debugPlayback ? [{
                currentTime: video.currentTime, duration: video.duration, ended: video.ended, endedEvent,
            }] : []));
            const scope = capturePlaybackScope(activeSubEl);
            setManagedTimeout(() => {
                if (!isPlaybackScopeCurrent(scope)) {
                    diagnosticConsole.log('播放诊断：结束等待期间播放器或小节已切换，取消旧完成检查');
                    state.isSwitching = false;
                    return;
                }
                switchToNextSubVideoOrCourse(scope);
            }, CONFIG.heartbeatWait);
            return;
        }

        // 5. 自动恢复播放
        if (video.paused && !video.ended && !state.isSwitching) {
            video.play().then(() => {
                if (state.enabled && !state.isSwitching) updateHUD(playbackStatus, undefined, currentSubName, progressStr, undefined, allCoursesProg, courseProg.text, courseProg.percent);
            }).catch(e => {
                if (state.enabled && !state.isSwitching) updateHUD("等待播放 (交互受限)", undefined, currentSubName, progressStr, undefined, allCoursesProg, courseProg.text, courseProg.percent);
            });
        } else if (!state.isSwitching) {
            updateHUD(playbackStatus, undefined, currentSubName, progressStr, undefined, allCoursesProg, courseProg.text, courseProg.percent);
        }

    }

    // 切换到下一个未完成的子小节，或切换到下一门大课程（严格核实完成状态）
    function switchToNextSubVideoOrCourse(scope = capturePlaybackScope()) {
        if (!state.enabled) return;
        if (!isPlaybackScopeCurrent(scope)) { cancelStalePlaybackWait(); return; }
        if (!ensureAllChaptersExpanded()) {
            waitForChapterCatalog(scope, () => switchToNextSubVideoOrCourse(scope));
            return;
        }
        state.isSwitching = true; // 进入切换流程即刻加锁，防止多轮轮询并发重入

        const allSubItems = getAllSubVideoItems();
        diagnosticConsole.log(`【神奇海螺】正在检查小节完成情况，共有 ${allSubItems.length} 个子小节`);

        // 1. 严格防御：如果未获取到任何子小节（目录未加载完成），绝不能判定为整门课完成！
        if (!allSubItems || allSubItems.length === 0) {
            diagnosticConsole.warn("【神奇海螺】未检测到任何子小节，可能目录尚未渲染完毕，等待重新检测...");
            state.isSwitching = false;
            return;
        }

        // 找到当前选中小节的索引
        const currentIndex = allSubItems.findIndex(isSubVideoActive);

        // 2. 核心保护：切往下一节前，必须先确认【当前小节已打勾完成】（已卡死跳过的小节除外）！
        // 如果当前刚播完的小节尚未完成且未被跳过，原地等待心跳上报打勾，避免心跳延迟导致漏计进度
        const isCurSubFailed = currentIndex !== -1 && isSubVideoFailed(getSubVideoKey(allSubItems[currentIndex]));
        if (currentIndex !== -1 && !isItemCompleted(allSubItems[currentIndex]) && !isCurSubFailed) {
            state.syncRetryCount = (state.syncRetryCount || 0) + 1;
            const curTitle = allSubItems[currentIndex].querySelector('[title], .truncate')?.innerText || '当前小节';

            if (state.syncRetryCount <= 4) { // 等待最多 4 次 * 3秒 = 12秒
                diagnosticConsole.log(`【神奇海螺】当前小节(${curTitle})尚未打勾，等待服务器心跳状态同步确认 (第 ${state.syncRetryCount}/4 次)...`);
                updateHUD(`等待当前节心跳同步确认 (${state.syncRetryCount}/4)...`);
                setManagedTimeout(() => {
                    switchToNextSubVideoOrCourse(scope);
                }, 3000);
                return;
            } else {
                reconcileBeforeReplay(allSubItems[currentIndex], allSubItems);
                return;
            }
        } else {
            // 当前小节已打勾确认完成或已作为卡死小节跳过，重置重试计数
            state.syncRetryCount = 0;
            if (currentIndex !== -1) clearCompletedReplay(allSubItems[currentIndex]);
        }

        // 3. 当前小节已完成确认或跳过后，寻找下一个【未完成且未被跳过】的子小节
        let nextTarget = null;
        if (currentIndex !== -1) {
            for (let i = currentIndex + 1; i < allSubItems.length; i++) {
                if (!isItemCompleted(allSubItems[i]) && !isSubVideoFailed(getSubVideoKey(allSubItems[i]))) {
                    nextTarget = allSubItems[i];
                    break;
                }
            }
        }

        // 如果当前小节之后没有，循环回前面找
        if (!nextTarget) {
            const searchLimit = currentIndex !== -1 ? currentIndex : allSubItems.length;
            for (let i = 0; i < searchLimit; i++) {
                if (!isItemCompleted(allSubItems[i]) && !isSubVideoFailed(getSubVideoKey(allSubItems[i]))) {
                    nextTarget = allSubItems[i];
                    break;
                }
            }
        }

        // 4. 如果找到了其他未学小节，直接点击播放！
        if (nextTarget) {
            const nextTitle = nextTarget.querySelector('[title], .truncate')?.innerText || '下一未学小节';
            updateHUD(`自动连播下一小节: ${nextTitle}`, undefined, nextTitle, "00:00");
            diagnosticConsole.log("【神奇海螺】点击播放未完成小节:", nextTitle);
            simulateHumanClick(nextTarget);
            setManagedTimeout(() => {
                state.isSwitching = false;
            }, 3000);
            return;
        }

        // 5. 严格验证：全量小节必须【每一小节都已完成或已跳过】才准退出课程！
        const isAllStrictlyCompleted = allSubItems.length > 0 && allSubItems.every(el => isItemCompleted(el) || isSubVideoFailed(getSubVideoKey(el)));
        if (!isAllStrictlyCompleted) {
            diagnosticConsole.warn("【神奇海螺】未全部打勾或跳过，暂不退出课程，等待状态确认...");
            state.isSwitching = false;
            return;
        }

        // 记录本门课程已完成，跳过考试或后续重复检查（基于当前 地图ID + 课程标识 作用域）
        const mapId = getCurrentMapId();
        const courseId = currentClaim?.course.courseKey || '';
        const courseTitle = getCurrentCourseTitle();
        const failedSubKeys = allSubItems.filter(el => !isItemCompleted(el) && isSubVideoFailed(getSubVideoKey(el))).map(getSubVideoKey);
        const hasExam = detectCourseExam();
        const outcome = failedSubKeys.length ? 'skipped' : hasExam ? 'exam' : 'completed';
        if (!saveCourseOutcome(outcome, failedSubKeys)) return;
        if (courseId) markCourseHandled(mapId, courseId);
        if (!courseId && courseTitle) markCourseHandled(mapId, courseTitle);

        const allCoursesProg = getStorageItem(STORAGE_KEYS.mapProgress, 'jinpei_map_progress') || state.allCoursesProgress || "";

        if (failedSubKeys.length) {
            diagnosticConsole.warn(`本课仍有 ${failedSubKeys.length} 个异常小节，记录为异常跳过，不计入已完成。`);
            updateHUD(`本课异常跳过 ${failedSubKeys.length} 节，继续其他课程；可稍后重试。`, undefined, undefined, undefined, undefined, allCoursesProg);
        } else if (hasExam) {
            diagnosticConsole.log("【神奇海螺】检测到本课程包含课后考试/测验节点，根据策略跳过考试，结束本课程！");
            updateHUD("📝 本课视频已学完（包含考试，已自动跳过），待考试，正在切课...", undefined, undefined, "100%", undefined, allCoursesProg, "视频完成 · 待考试", 100);
        } else {
            diagnosticConsole.log("【神奇海螺】严格核实：本课程全量子视频均已完成！准备返回课程目录选择新课程...");
            updateHUD("本课程全部完成，正在返回学习目录切换新课程...", undefined, undefined, "100%", undefined, allCoursesProg, "全部完成", 100);
        }

        // 释放当前课程的并发占位，避免返回目录后由于心跳残留误判为冲突
        unregisterTab();
        registerTabHeartbeat("", "正在返回目录...", mapId);

        // 保持切换锁与操作锁，防止目录切换慢时连续重复点击
        state.isSwitching = true;
        state.isActionPending = true;

        // 尝试点击侧边栏“学习目录”
        const catalogLi = Array.from(document.querySelectorAll('li, div, span, button'))
            .find(el => el.innerText && el.innerText.trim() === '学习目录' && el.children.length === 0);

        if (catalogLi) {
            simulateHumanClick(catalogLi.closest('li, button, div, a'));
            waitForCourseCatalog();
        } else {
            // 点击返回按钮
            const backBtn = Array.from(document.querySelectorAll('button, span, div, a'))
                .find(el => el.innerText && /^(返回|返回目录|返回课程)$/.test(el.innerText.trim()) && (el.children.length === 0 || el.tagName === 'BUTTON'));
            if (backBtn) {
                const clickTarget = backBtn.closest('button, a, div[role="button"]') || backBtn;
                simulateHumanClick(clickTarget);
            } else {
                location.href = CONFIG.myTaskUrl;
            }
            waitForCourseCatalog();
        }
    }

let jnReportPromise = null;
    const jnActionControllers = new Set();
    let jnActionGeneration = 0;
    let jnExamSubmitRestore = null;

    function cancelJnActions() {
        jnActionGeneration++;
        for (const controller of jnActionControllers) controller.abort();
        jnActionControllers.clear();
        if (jnExamSubmitRestore) { jnExamSubmitRestore(); jnExamSubmitRestore = null; }
    }

    function jnActionSnapshot() {
        return { url: location.href, claim: claimGeneration, generation: jnActionGeneration, epoch: getLocalItem(ACCOUNT_EPOCH_KEY) };
    }

    function jnActionCurrent(snapshot) {
        return state.enabled && !accountStale && location.href === snapshot.url && claimGeneration === snapshot.claim &&
            jnActionGeneration === snapshot.generation && getLocalItem(ACCOUNT_EPOCH_KEY) === snapshot.epoch;
    }

    function jnWaitNativeReport(seconds, loginId, signal, stillCurrent) {
        return new Promise((resolve, reject) => {
            const watched = new Map();
            let observer;
            let settled = false;
            const stopClock = () => { if (window.tt !== undefined) clearInterval(window.tt); jnClockPaused = true; };
            const finish = error => {
                if (settled) return;
                settled = true; observer?.disconnect(); stopClock();
                signal.removeEventListener('abort', aborted);
                for (const [script, handlers] of watched) {
                    script.removeEventListener('load', handlers.loaded); script.removeEventListener('error', handlers.failed);
                }
                if (error) reject(error); else resolve();
            };
            const aborted = () => finish(Object.assign(new Error('原生上报等待已取消'), { name: 'AbortError' }));
            const watch = script => {
                if (script.tagName !== 'SCRIPT' || watched.has(script)) return;
                let url;
                try { url = new URL(script.src, location.href); } catch (_) { return; }
                if (url.origin !== new URL(location.href).origin || !/\/SetTime\.ashx$/i.test(url.pathname) ||
                    url.searchParams.get('LoginInfoId') !== loginId || Number(url.searchParams.get('pTime')) !== seconds) return;
                if (!stillCurrent()) { aborted(); return; }
                stopClock();
                const loaded = () => finish();
                const failed = () => finish(new Error('平台原生上报加载失败'));
                watched.set(script, { loaded, failed });
                script.addEventListener('load', loaded); script.addEventListener('error', failed);
            };
            try {
                if (signal.aborted || !stillCurrent()) { aborted(); return; }
                if (typeof window.myload !== 'function') throw new Error('未找到平台原生计时器');
                observer = new MutationObserver(records => {
                    for (const record of records) for (const node of record.addedNodes) {
                        watch(node);
                        for (const script of node.querySelectorAll?.('script[src]') || []) watch(script);
                    }
                });
                observer.observe(document.head || document.documentElement, { childList: true, subtree: true });
                signal.addEventListener('abort', aborted, { once: true });
                window.myload();
            } catch (error) { finish(error); }
        });
    }

    async function jnReportStudyTime(video) {
        if (jnReportPromise) return jnReportPromise;
        const snapshot = jnActionSnapshot();
        const currentId = new URL(location.href).searchParams.get('CoursewareId');
        const loginId = document.querySelector('#txtLoginInfoId')?.value;
        // 平台 startclock() 仅在 m_time % 60 === 0 时提交，按完整分钟向上取整。
        const seconds = Math.ceil(video.duration / 60) * 60;
        if (!loginId || !currentId || !Number.isFinite(seconds) || seconds <= 1) {
            pauseAutomation('缺少课件计时会话或有效视频时长，无法自动提交。'); return;
        }
        const source = video.currentSrc || video.src || '';
        const stillCurrent = () => jnActionCurrent(snapshot) && jnDocuments().some(doc => doc.querySelector('video,audio') === video) &&
            (video.currentSrc || video.src || '') === source;
        jnReportPromise = (async () => {
            const controller = new AbortController();
            jnActionControllers.add(controller);
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
                if (!stillCurrent()) return;
                // 先停旧计时器；从整分钟前一秒重新启动原生计时，由平台自行发送请求。
                if (window.tt !== undefined) clearInterval(window.tt);
                video.pause();
                window.m_time = seconds - 1;
                const timeInput = document.querySelector('#lblTimeAll');
                if (timeInput) timeInput.value = String(seconds - 1);
                jnContext.report = { id: currentId, seconds, phase: 'sending' }; jnSave();
                updateHUD(`等待平台原生计时到 ${formatTime(seconds)} 并自动上报...`);
                diagnosticConsole.log('金培：计时设为整分钟前一秒，等待平台原生上报。', { initialSeconds: seconds - 1, seconds });
                await jnWaitNativeReport(seconds, loginId, controller.signal, stillCurrent);
                if (!stillCurrent()) return;
                diagnosticConsole.log('金培：已观察到平台原生上报加载完成，返回课程核验。', { seconds });
                jnContext.report.phase = 'sent';
                if (!jnContext.courseUrl) { jnSave(); pauseAutomation('时长已提交，请返回课程详情核验；未自动标记完成。'); return; }
                jnContext.index = (jnContext.index || 0) + 1;
                jnGo(jnContext.courseUrl);
            } catch (error) {
                if (jnActionCurrent(snapshot)) pauseAutomation(error.name === 'AbortError' ? '金培时长上报超时，请核对学习记录后重试。' : '金培时长上报失败，请核对学习记录后重试。');
            } finally { clearTimeout(timer); jnActionControllers.delete(controller); }
        })();
        try { return await jnReportPromise; } finally { jnReportPromise = null; }
    }

    function jnParseAnswers(value) {
        const text = String(value || '').trim().toUpperCase();
        if (!/^[A-G01](?:[\s,;、|]*[A-G01])*$/.test(text)) throw new Error('答案缺失或格式不支持');
        return [...new Set(text.match(/[A-G01]/g))];
    }

    function jnParseExamPlans(doc) {
        const questions = Array.from(doc.querySelectorAll('.tb_title'));
        if (!questions.length) throw new Error('未找到可识别的考试题目');
        const indexes = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, '1': 0, '0': 1 };
        const seen = new Set();
        // 所有题目先校验，再操作选项；缺题、缺答案、未知题型均不会交卷。
        return questions.map((question, index) => {
            const answer = question.querySelector('[id^="tmjo_"]') || doc.querySelector('#tmjo_' + (index + 1));
            const number = answer?.id?.match(/^tmjo_(\d+)$/)?.[1];
            if (!number || seen.has(number)) throw new Error('题目标识缺失或重复');
            seen.add(number);
            const desired = jnParseAnswers(answer.value || answer.getAttribute('value')).map(key => 'tm_' + number + '_' + indexes[key]);
            const options = Array.from(doc.querySelectorAll('[id^="tm_' + number + '_"]'));
            if (desired.some(id => !options.some(option => option.id === id)) ||
                !options.length || options.some(option => !['checkbox', 'radio'].includes(option.type) || option.disabled) ||
                desired.length > 1 && options.some(option => option.type === 'radio')) throw new Error('题目选项不完整或题型不支持');
            return { options, desired };
        });
    }

    function jnApplyExamPlan(plan) {
        const { options, desired } = plan;
        for (const option of options) {
            const expected = desired.includes(option.id);
            if (option.checked !== expected && (expected || option.type === 'checkbox')) {
                simulateHumanClick(option);
            }
        }
        if (options.some(option => option.checked !== desired.includes(option.id))) {
            throw new Error('选项未成功选中，已停止交卷');
        }
    }

    function jnAnswerQuestions(doc) {
        const plans = jnParseExamPlans(doc);
        for (const plan of plans) jnApplyExamPlan(plan);
        return plans.length;
    }

    function jnStartExam(link) {
        if (!CONFIG.jnAutoExam) { pauseAutomation('此课程需要考试，请手动完成后继续。'); return; }
        const id = link.getAttribute('onclick')?.match(/CreateExam\(\s*['"]([\w-]+)['"]\s*\)/i)?.[1];
        const source = typeof window.btnGiveUp_onclick === 'function' ? window.btnGiveUp_onclick.toString() : '';
        const studentId = source.match(/var\s+sStudentId\s*=\s*['"]([\w-]+)['"]/i)?.[1] ||
            document.querySelector('#HidStudentId,#hidStudentId')?.value;
        if (!id || !studentId || !/^[\w-]+$/.test(studentId)) { pauseAutomation('无法识别考试入口或学员标识，请检查课程考试页。'); return; }
        if (jnContext.exam?.id === id) { pauseAutomation('此考试本轮已尝试，平台尚未确认通过，请核对考试结果。'); return; }
        const url = new URL('../MyExam/aspNet/ExamCreate.ashx', location.href);
        url.search = new URLSearchParams({ Tk_Cl_Id: id, Clerk_id: studentId, SiteType: '' }).toString();
        jnContext.exam = { id, phase: 'opened', startedAt: Date.now() };
        updateHUD('正在进入课程考试...');
        jnGo(url.href);
    }

    function jnExamDialogs(win) {
        const originalConfirm = win.confirm?.bind(win);
        const originalAlert = win.alert?.bind(win);
        if (originalConfirm) {
            win.confirm = makeNativeFunction(message => {
                return state.enabled && ['submitting', 'submitted'].includes(jnContext.exam?.phase) &&
                    /交卷|提交.*(?:试卷|答案|考试)|(?:确定|确认).*提交|结束.*考试/.test(String(message)) ? true : originalConfirm(message);
            }, win.confirm, 'confirm');
        }
        if (originalAlert) {
            win.alert = makeNativeFunction(message => {
                if (state.enabled && /还有未答|题目.*未.*答/.test(String(message))) {
                    pauseAutomation('平台检测到未答题，已取消自动交卷，请检查选项。');
                    throw new Error('平台检测到未答题');
                }
                if (state.enabled && jnContext.exam?.phase === 'submitted' && /交卷成功|提交成功|考试结束|考试已结束/.test(String(message))) return;
                return originalAlert(message);
            }, win.alert, 'alert');
        }
    }

    function jnHandleExam() {
        const exam = jnContext.exam;
        if (!exam || !jnContext.courseUrl) { pauseAutomation('请从课程详情页启动自动考试，以便交卷后核验结果。'); return; }
        const docs = jnDocuments();
        const answers = docs.find(doc => doc.querySelectorAll('.tb_title').length);
        if (exam.phase === 'submitted') {
            updateHUD('试卷已提交，等待考试结果，随后返回课程核验...');
            const elapsed = Date.now() - exam.submittedAt;
            if (elapsed >= 15000 || elapsed >= 3000 && !answers) jnGo(jnContext.courseUrl);
            return;
        }
        const header = docs.find(doc => typeof doc.defaultView?.SubmitExam === 'function');
        if (!answers || !header) {
            updateHUD('等待考试题目和交卷入口加载...');
            if (Date.now() - exam.startedAt > 20000) pauseAutomation('考试页面加载超时，请检查题目和交卷入口。');
            return;
        }
        if (exam.phase === 'submitting') {
            updateHUD('等待原页面确认交卷并提交答卷...');
            if (Date.now() - exam.submittingAt > 15000) pauseAutomation('尚未观察到答卷提交，请检查交卷确认窗口。');
            return;
        }
        try {
            const snapshot = jnActionSnapshot();
            const plans = jnParseExamPlans(answers);
            const count = plans.length;
            if (!jnActionCurrent(snapshot)) return;

            // 1. 拟人答题流程初始化
            if (!exam.phase || exam.phase === 'opened') {
                exam.startedAt = exam.startedAt || Date.now();
                if (CONFIG.enableJitter) {
                    exam.phase = 'answering';
                    exam.answerIndex = 0;
                    const minWait = CONFIG.jnExamWaitPerQuestionMin || 8;
                    const maxWait = CONFIG.jnExamWaitPerQuestionMax || 15;
                    exam.totalWaitSeconds = count * randomBetween(minWait, maxWait);
                    exam.targetSubmitAt = exam.startedAt + exam.totalWaitSeconds * 1000;
                    const dMin = CONFIG.jnExamQuestionDelayMin || 2000;
                    const dMax = CONFIG.jnExamQuestionDelayMax || 5000;
                    exam.nextAnswerAt = Date.now() + randomBetween(dMin, dMax);
                    jnSave();
                    updateHUD(`已识别 ${count} 道试题，准备拟人作答（全卷复查预计共等待 ${Math.ceil(exam.totalWaitSeconds / 60)} 分钟）...`);
                    return;
                }
                jnAnswerQuestions(answers);
                exam.phase = 'answered';
                exam.answeredAt = Date.now();
                exam.answeredCount = count;
                exam.targetSubmitAt = (exam.startedAt || Date.now()) + 2000;
                jnSave();
                updateHUD(`已选择 ${count} 道题，等待页面保存选项后核验...`);
                diagnosticConsole.log(`金培：已选择 ${count} 道题，等待页面处理选项后再交卷。`);
                return;
            }

            // 2. 拟人单题步进作答（每题间隔 2~5 秒）
            if (exam.phase === 'answering') {
                const idx = exam.answerIndex || 0;
                if (idx < count) {
                    if (Date.now() < (exam.nextAnswerAt || 0)) {
                        const waitSec = Math.max(1, Math.ceil((exam.nextAnswerAt - Date.now()) / 1000));
                        updateHUD(`正在思考第 ${idx + 1}/${count} 题（拟人等待 ${waitSec}s）...`);
                        return;
                    }
                    jnApplyExamPlan(plans[idx]);
                    exam.answerIndex = idx + 1;
                    if (exam.answerIndex < count) {
                        const dMin = CONFIG.jnExamQuestionDelayMin || 2000;
                        const dMax = CONFIG.jnExamQuestionDelayMax || 5000;
                        exam.nextAnswerAt = Date.now() + randomBetween(dMin, dMax);
                        jnSave();
                        updateHUD(`已完成第 ${exam.answerIndex}/${count} 题，拟人延时等待作答下一题...`);
                        return;
                    }
                    exam.phase = 'answered';
                    exam.answeredAt = Date.now();
                    exam.answeredCount = count;
                    jnSave();
                    updateHUD(`全卷 ${count} 题已作答完毕，进入拟人复查试卷阶段...`);
                    return;
                }
            }

            // 3. 拟人试卷等待与复查阶段（整卷等待 题目数 * (8~15秒)）
            if (exam.phase === 'answered') {
                const targetAt = exam.targetSubmitAt || (exam.answeredAt + 2000);
                if (Date.now() < targetAt) {
                    const remaining = Math.max(1, Math.ceil((targetAt - Date.now()) / 1000));
                    updateHUD(`全卷已答完（共 ${count} 题），正在模拟人工复查试卷（剩余 ${remaining}s 后交卷）...`);
                    return;
                }

                const answerWindow = answers.defaultView;
                if (typeof answerWindow?.check_tx === 'function') {
                    const total = Number(answerWindow.total);
                    if (!Number.isInteger(total) || total <= 0 || total !== count ||
                        Array.from({ length: total }, (_, i) => i + 1).some(i => !answerWindow.check_tx(i))) {
                        throw new Error('平台原生答题检查未通过');
                    }
                }
                exam.nativeVerified = typeof answerWindow?.check_tx === 'function';
                const form = answers.querySelector('#frmExam');
                if (!form || typeof form.submit !== 'function') throw new Error('未找到原生答卷表单');
                for (const doc of docs) if (doc.defaultView) jnExamDialogs(doc.defaultView);
                const nativeSubmit = form.submit;
                const guardedSubmit = function () {
                    if (!jnActionCurrent(snapshot) || exam.phase === 'submitted') return;
                    exam.phase = 'submitted'; exam.submissionObserved = true; exam.submittedAt = Date.now(); jnSave();
                    diagnosticConsole.log(`金培：原页面已发起答卷提交（${count} 道题），等待平台核验。`);
                    return nativeSubmit.call(form);
                };
                form.submit = guardedSubmit;
                jnExamSubmitRestore = () => { if (form.submit === guardedSubmit) form.submit = nativeSubmit; };
                exam.phase = 'submitting'; exam.submittingAt = Date.now(); jnSave();
                // 与 Python 一致，下一轮事件循环调用原生 SubmitExam；确认框在答题 frame 中。
                setManagedTimeout(() => {
                    if (!jnActionCurrent(snapshot)) return;
                    try { header.defaultView.SubmitExam(); }
                    catch (_) { if (state.enabled) pauseAutomation('原页面交卷未完成，请检查试卷；未登记通过。'); }
                }, 0);
            }
        } catch (_) { pauseAutomation('自动答题或交卷未完成，请手动检查；未登记考试通过。'); }
    }

    async function jnSubmitRating() {
        const previous = jnContext.rating;
        if (previous?.phase === 'submitted') {
            updateHUD('评价已提交，等待平台确认课程完成...');
            if (Date.now() < previous.nextCheckAt) return;
            previous.checks++;
            if (previous.checks > 3) { pauseAutomation('评价提交后平台仍未确认课程完成，请检查考试和评价结果。'); return; }
            previous.nextCheckAt = Date.now() + 5000;
            jnSave();
            jnGo(jnContext.courseUrl);
            return;
        }
        const text = document.querySelector('#txtArea');
        const score = document.querySelector('#HidSpell');
        const starScore = document.querySelector('#star_submit input[name="score"]');
        const submit = document.querySelector('#SubComment');
        const form = submit?.form || document.querySelector('form');
        if (!text || !score || !starScore || !submit || !form || submit.disabled) {
            pauseAutomation('未找到完整的课程评价表单，请检查课程页面。'); return;
        }
        const snapshot = jnActionSnapshot();
        const widget = document.querySelector('#star_submit');
        const star = document.querySelector('#star_submit img[alt="5"]');
        try {
            const jquery = window.jQuery || window.$;
            const rating = typeof jquery === 'function' ? jquery('#star_submit') : null;
            if (typeof rating?.raty === 'function') rating.raty('score', 5);
            else if (star) {
                if (typeof MouseEvent === 'function') star.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                star.click();
            }
            const images = Array.from(widget?.querySelectorAll('img') || []);
            if (images.length === 5 && images.some(image => !/star-on\.(?:png|gif)(?:\?|$)/i.test(image.src))) {
                pauseAutomation('五星评分控件未成功点亮，已停止评价，请检查评分。'); return;
            }
        } catch (_) { pauseAutomation('五星评分控件设置失败，已停止评价。'); return; }
        score.value = '5';
        if (starScore) starScore.value = '5';
        text.value = '好';
        if (typeof text.dispatchEvent === 'function') {
            text.dispatchEvent(new Event('input', { bubbles: true }));
            text.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (!jnActionCurrent(snapshot)) return;
        jnContext.rating = { phase: 'preparing', checks: 0, nextCheckAt: Date.now() + 5000 };
        jnSave();
        updateHUD('正在提交课程评价...');
        state.isActionPending = true;
        const controller = new AbortController();
        jnActionControllers.add(controller);
        const timer = setTimeout(() => controller.abort(), 10000);
        let navigating = false;
        try {
            // 使用原表单及提交按钮参数；响应只读取，避免整页回发的提示框阻塞续课。
            const data = new FormData(form);
            data.set(submit.name || 'SubComment', submit.value || '发表');
            if (String(starScore.value) !== '5') throw new Error('本次评价控件不是5分');
            // Raty 为平均分、已有评价、本次评价都生成 name=score，只提交本次评分。
            data.set(starScore.name || 'score', '5');
            const values = name => Array.from(data.entries()).filter(([key]) => key === name).map(([, value]) => String(value));
            const scoreValues = values(score.name || 'HidSpell');
            const starValues = starScore ? values(starScore.name || 'score') : [];
            if (scoreValues.length !== 1 || scoreValues[0] !== '5' || starScore && (starValues.length !== 1 || starValues[0] !== '5')) {
                throw new Error('实际评价表单不是5分');
            }
            jnContext.rating.phase = 'submitted'; jnContext.rating.score = 5; jnContext.rating.payloadVerified = true; jnSave();
            diagnosticConsole.log('金培：实际评价表单已校验，提交5分后等待平台确认。', { HidSpell: scoreValues[0], score: starValues[0] || null });
            const target = jnUrl(form.getAttribute('action') || location.href);
            if (!target) throw new Error('评价表单地址异常');
            const response = await fetch(target, { method: 'POST', body: new URLSearchParams(data), credentials: 'same-origin', signal: controller.signal });
            await response.text();
            if (!jnActionCurrent(snapshot)) return;
            if (!response.ok || response.url && !/\/Layer_CourseInfo\.aspx$/i.test(new URL(response.url).pathname)) throw new Error('评价提交失败或登录失效');
            navigating = true;
            jnGo(jnContext.courseUrl);
        } catch (_) {
            if (jnActionCurrent(snapshot)) pauseAutomation('课程评价提交异常，请核对平台结果后继续。');
        } finally {
            clearTimeout(timer); jnActionControllers.delete(controller);
            if (!navigating && jnActionCurrent(snapshot)) state.isActionPending = false;
        }
    }

    function jnHUDDocument() {
        if (document.body?.tagName !== 'FRAMESET') return document;
        const main = document.querySelector('frame[name="mainFrame"],iframe[name="mainFrame"]');
        if (main) {
            try {
                const doc = main.contentDocument;
                return doc?.body?.tagName === 'BODY' && doc.URL !== 'about:blank' ? doc : null;
            } catch (_) { return null; }
        }
        const docs = jnDocuments().filter(doc => doc.body?.tagName === 'BODY');
        return docs.find(doc => doc.defaultView?.frameElement?.name === 'mainFrame') ||
            docs.sort((a, b) => (b.defaultView?.innerHeight || 0) - (a.defaultView?.innerHeight || 0))[0] || null;
    }

// 江南金培适配：独立于易知的路由、任务和播放器流程，仍共用 HUD 和诊断日志。
    const JN_CONTEXT_KEY = '_jnftc_context';
    let jnBusy = false;
    let jnLoginWaiting = false;
    let jnMedia = null;
    let jnProgress = null;
    let jnClockPaused = false;
    let jnContext = {};
    try { jnContext = JSON.parse(getStorageItem(JN_CONTEXT_KEY) || '{}') || {}; } catch (_) {}
    if (IS_JNFTC) {
        state.currentTask = jnContext.title || '';
        state.currentCourse = jnContext.courseTitle || '';
        state.currentSubVideo = jnContext.queue?.[jnContext.index || 0]?.title || '';
    }

    function jnSave() { setStorageItem(JN_CONTEXT_KEY, JSON.stringify(jnContext)); }

    function jnRoot(url = location.href) {
        return new URL(url).pathname.match(/^\/WebTraining\d*/i)?.[0] || '/WebTraining14';
    }

    function jnUrl(value, base = location.href) {
        try {
            const url = new URL(value, base);
            if (!/^https?:$/.test(url.protocol) || url.origin !== new URL(location.href).origin) return '';
            if (!/^\/WebTraining\d*\/Web\//i.test(url.pathname)) return '';
            return url.href;
        } catch (_) { return ''; }
    }

    function jnTaskUrl() { return new URL(jnRoot() + '/Web/MyDuty/MyDutyList.aspx?Menu=9', location.href).href; }

    function jnText(el) { return (el?.innerText || el?.textContent || '').trim().replace(/\s+/g, ' '); }

    function jnLoggedIn(doc = document) {
        return !!doc.querySelector('#Top1_lbtnLogout,#Top1_BtnLogOut,.theme-login2,#lblCurrDuty,#tbCurTabIndex,#txtLoginInfoId,.a-2') ||
            !!doc.querySelector('[id$="_BtnLogOut"],[id$="_lbtnLogout"]') ||
            /\/Web\//i.test(location.href) && !!doc.querySelector('a[href*="BtnLogOut"],a[id*="Logout"]');
    }

    function jnReadTasks(doc, base) {
        return Array.from(doc.querySelectorAll('#lblCurrDuty > div > div')).flatMap(card => {
            const link = card.querySelector('a[href*="DutyShow.aspx"]');
            const url = link && jnUrl(link.getAttribute('href'), base);
            const key = url && new URL(url).searchParams.get('DutyId');
            return key ? [{ key, title: jnText(card) || '学习任务', url }] : [];
        });
    }

    async function jnFetchTaskPages(url, signal) {
        let response = await fetch(url, { credentials: 'same-origin', signal });
        const tasks = [];
        for (let page = 0; page < 20; page++) {
            if (!response.ok) throw new Error('任务列表读取失败');
            const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
            if (!doc.querySelector('#lblCurrDuty')) throw new Error('请先手动登录江南金培');
            tasks.push(...jnReadTasks(doc, response.url || url));
            const current = Number(jnText(doc.querySelector('#PageSplit1_LbPageIndex')));
            const total = Number(jnText(doc.querySelector('#PageSplit1_LbPageCount')));
            if (!(current > 0 && current < total)) return tasks;
            const next = doc.querySelector('#PageSplit1_BtnNext');
            const target = next?.getAttribute('href')?.match(/__doPostBack\('([\w$]+)'/i)?.[1];
            if (!target) throw new Error('未识别任务分页，请前往任务中心检查');
            const data = new URLSearchParams();
            doc.querySelectorAll('input[type="hidden"][name]').forEach(el => data.set(el.name, el.value));
            data.set('__EVENTTARGET', target); data.set('__EVENTARGUMENT', '');
            response = await fetch(url, { method: 'POST', credentials: 'same-origin', body: data, signal });
        }
        throw new Error('任务分页超过读取上限，请在任务中心分批查看');
    }

    async function loadJnTaskCatalog(force = false) {
        if (taskCatalogLoading) return taskCatalogLoading;
        if (!force && Date.now() - taskCatalogAttemptAt < 60000) return getTaskCatalog();
        taskCatalogAttemptAt = Date.now();
        taskCatalogLoading = (async () => {
            const accountEpoch = getLocalItem(ACCOUNT_EPOCH_KEY);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            try {
                const url = jnTaskUrl();
                const tasks = await jnFetchTaskPages(url, controller.signal);
                if (accountEpoch !== getLocalItem(ACCOUNT_EPOCH_KEY) || accountStale) return getTaskCatalog();
                jnLoginWaiting = false;
                saveTaskCatalog(tasks, Date.now());
                taskCatalogMessage = getTaskCatalog().length ? '' : '暂无学习任务。';
            } catch (error) {
                if (error.message.includes('登录')) jnLoginWaiting = true;
                taskCatalogMessage = error.name === 'AbortError' ? '任务读取超时，可点击刷新。' : error.message;
            } finally { clearTimeout(timeout); }
            return getTaskCatalog();
        })();
        try { return await taskCatalogLoading; } finally { taskCatalogLoading = null; }
    }

    function jnGo(value) {
        const url = jnUrl(value);
        if (!url) throw new Error('无法识别金培页面地址，请检查页面');
        jnSave();
        state.isActionPending = true;
        const target = new URL(url);
        const current = new URL(location.href);
        target.hash = ''; current.hash = '';
        // 平台页签使用 #none；同址赋值只会页内跳转，不能用它刷新后台状态。
        if (target.href === current.href) location.reload();
        else location.href = target.href;
    }

    function jnOpenCourseUrl(link, base = location.href) {
        const code = link?.getAttribute('onclick') || '';
        const match = code.match(/window\.open\(\s*(['"])([^'"]+)\1/);
        const url = jnUrl(match?.[2] || link?.getAttribute('href'), base);
        return url && /\/Layer_CourseInfo\.aspx$/i.test(new URL(url).pathname) ? url : '';
    }

    function jnReadVideos(doc = document, base = location.href) {
        return Array.from(doc.querySelectorAll('#table a[onclick]')).flatMap(link => {
            const code = link.getAttribute('onclick') || '';
            if (!/^\s*Online\(/i.test(code)) return [];
            const args = Array.from(code.matchAll(/['"]([^'"]*)['"]/g), m => m[1]);
            if (args.length !== 4 || !/^[\w-]+$/.test(args[0]) || !/^[\w-]+$/.test(args[3]) || !/^\d+$/.test(args[2])) return [];
            const url = new URL('OnLineRead.aspx', base);
            url.search = new URLSearchParams({ CoursewareId: args[0], TypeValue: '0', Type: args[2], CourseId: args[3] }).toString();
            // 与平台 Online() 保持相同编码，兼容旧 ASP.NET 的中文课件路径。
            const target = jnUrl(url.href + '&Url=' + escape(args[1]), base);
            return target ? [{ id: args[0], url: target, title: jnText(link.closest('tr')?.querySelector('td')) || '视频课件' }] : [];
        });
    }

    function jnStatusDone(selector, doc = document) {
        const el = doc.querySelector(selector);
        return !!el && /(?:ico_kecheng_t[23]_over|CourseOver)\.(?:png|jpg)/i.test(el.getAttribute('style') || '');
    }

    function jnNextPage() {
        const current = Number(jnText(document.querySelector('#PageSplit1_LbPageIndex')));
        const total = Number(jnText(document.querySelector('#PageSplit1_LbPageCount')));
        const next = document.querySelector('#PageSplit1_BtnNext');
        if (current > 0 && current < total && next && !next.disabled && !next.classList.contains('aspNetDisabled')) {
            state.isActionPending = true;
            jnSave();
            next.click();
            return true;
        }
        return false;
    }

    function jnChangeDutyTab(index) {
        const input = document.querySelector('#tbCurTabIndex');
        if (!input || String(input.value) === String(index)) return false;
        input.value = String(index);
        state.isActionPending = true;
        jnSave();
        const form = input.form || document.querySelector('form');
        if (!form) throw new Error('未找到学习任务表单');
        form.submit();
        return true;
    }

    function jnDocuments() {
        const docs = [document];
        for (let i = 0; i < docs.length && i < 10; i++) {
            for (const frame of docs[i].querySelectorAll('iframe,frame')) {
                try { if (frame.contentDocument && !docs.includes(frame.contentDocument)) docs.push(frame.contentDocument); } catch (_) {}
            }
        }
        return docs;
    }

    function pauseJnPlayback() {
        cancelJnActions();
        for (const doc of jnDocuments()) {
            for (const video of doc.querySelectorAll('video,audio')) { if (!video.paused) video.pause(); }
        }
        if (typeof window.myload === 'function' && window.tt !== undefined) {
            clearInterval(window.tt);
            jnClockPaused = true;
        }
        if (jnProgress) jnProgress.suspended = true;
    }

    function jnFinishDuty() {
        if (jnContext.dutyKey) markMapHandled(jnContext.dutyKey);
        jnContext = {};
        jnGo(jnTaskUrl());
    }

    function jnHandleDuty() {
        const url = new URL(location.href);
        const key = url.searchParams.get('DutyId');
        if (jnContext.dutyKey !== key) jnContext = { dutyKey: key, dutyUrl: location.href, dutyTab: 0, title: document.title };
        if (!isTaskKeySelected(key)) { pauseAutomation('当前任务未勾选，请在 HUD 中选择后继续。'); return; }
        if (jnChangeDutyTab(jnContext.dutyTab || 0)) return;
        const tab = jnContext.dutyTab || 0;
        if (!document.querySelector('#tbCurTabIndex') || !document.querySelector(tab === 0 ? '#ul-1' : '#ul-2')) {
            updateHUD('等待任务课程列表加载...'); return;
        }
        const rows = document.querySelectorAll(tab === 0 ? '#ul-1 > li' : '#ul-2 > li');
        const link = Array.from(rows).map(row => ({ row, url: jnOpenCourseUrl(row.querySelector('a[onclick]')) })).find(item => item.url);
        if (link) {
            jnContext.courseUrl = link.url;
            jnContext.courseTitle = jnText(link.row.querySelector('tr td:nth-child(2)')) || '当前课程';
            jnContext.queue = []; jnContext.index = 0; jnContext.verify = 0;
            updateHUD('正在进入课程...', jnContext.title, '', '', jnContext.courseTitle);
            jnGo(link.url);
            return;
        }
        if (jnNextPage()) return;
        if (tab === 0) { jnContext.dutyTab = 1; jnChangeDutyTab(1); return; }
        // 两个待学习分类及其分页均检查完才结束，不用总进度文案推断完成。
        jnFinishDuty();
    }

    function jnHandleCourse() {
        jnContext.courseUrl = location.href;
        const courseId = new URL(location.href).searchParams.get('CourseId');
        if (jnContext.courseId !== courseId) {
            jnContext.courseId = courseId; jnContext.queue = []; jnContext.index = 0; jnContext.verify = 0;
            delete jnContext.exam; delete jnContext.examProbeAt;
            delete jnContext.rating;
        }
        if (jnStatusDone('.a-4')) {
            diagnosticConsole.log('金培：平台已确认课程完成。');
            jnContext.queue = []; jnContext.index = 0; jnContext.verify = 0;
            delete jnContext.rating;
            jnGo(jnContext.dutyUrl || jnTaskUrl()); return;
        }
        if (jnStatusDone('.a-2')) {
            const examLink = document.querySelector('a[onclick*="CreateExam"]');
            if (examLink && !jnStatusDone('.a-3')) {
                jnStartExam(examLink); return;
            }
            if (!jnStatusDone('.a-3')) {
                const examTab = Array.from(document.querySelectorAll('#TabNav a')).find(tab => /考试|测验|测试/.test(jnText(tab)));
                if (examTab && !jnContext.examProbeAt) {
                    jnContext.examProbeAt = Date.now(); jnSave(); examTab.click(); updateHUD('正在检查课程考试入口...'); return;
                }
                if (jnContext.examProbeAt && Date.now() - jnContext.examProbeAt < 3000) return;
            }
            if (jnContext.exam && !jnStatusDone('.a-3')) {
                pauseAutomation('考试已尝试，但平台尚未确认通过，请检查考试结果。'); return;
            }
            return jnSubmitRating();
        }
        const batch = jnReadVideos();
        const queue = jnContext.queue || [];
        for (const item of batch) { if (!queue.some(old => old.id === item.id)) queue.push(item); }
        jnContext.queue = queue;
        if (jnNextPage()) return;
        if (!queue.length) { pauseAutomation('未识别到可播放课件，请检查课程页面。'); return; }
        const next = queue[jnContext.index || 0];
        if (next) { updateHUD('正在打开视频课件...', jnContext.title, next.title, '', jnContext.courseTitle); jnGo(next.url); return; }
        jnContext.verify = (jnContext.verify || 0) + 1;
        if (jnContext.verify > 3) { pauseAutomation('课件已播放完，平台仍未确认完成，请检查学习记录。'); return; }
        state.isActionPending = true;
        updateHUD('等待平台确认课程学习记录...');
        jnSave();
        setManagedTimeout(() => location.reload(), 5000);
    }

    function jnHandlePlayer() {
        const currentId = new URL(location.href).searchParams.get('CoursewareId');
        const item = jnContext.queue?.[jnContext.index || 0];
        if (item && item.id !== currentId) { pauseAutomation('课件与当前任务不一致，已暂停，请从任务中心重新开始。'); return; }
        const video = jnDocuments().map(doc => doc.querySelector('video,audio')).find(Boolean);
        if (!video) {
            if (!jnProgress) jnProgress = { waitingAt: Date.now() };
            updateHUD('等待金培播放器加载...', jnContext.title, item?.title);
            if (Date.now() - jnProgress.waitingAt > 60000) pauseAutomation('金培播放器加载超过 60 秒，请检查课件后继续。');
            return;
        }
        if (jnMedia !== video) {
            jnMedia = video;
            jnProgress = { time: video.currentTime, at: Date.now(), lastPlay: 0, endedAt: 0 };
            // 提前注册，兼容平台 ended 回调把进度归零的播放器。
            video.addEventListener('ended', () => { if (jnMedia === video) jnProgress.endedAt = Date.now(); }, true);
        }
        if (jnProgress.suspended) {
            jnProgress.at = Date.now();
            jnProgress.lastPlay = 0;
            if (jnProgress.endedAt) jnProgress.endedAt = Date.now();
            jnProgress.suspended = false;
        }
        if (!jnProgress.endedAt && video.ended) jnProgress.endedAt = Date.now();
        if (CONFIG.jnAutoReport) {
            if (!Number.isFinite(video.duration) || video.duration <= 0) {
                if (Date.now() - jnProgress.at > 60000) pauseAutomation('等待课件时长超时，无法自动上报。');
                else updateHUD('等待课件时长，准备自动上报...');
                return;
            }
            if (Date.now() - jnProgress.at < 3000) { updateHUD('已识别课件，准备提交学习时间...'); return; }
            return jnReportStudyTime(video);
        }
        if (jnClockPaused && typeof window.myload === 'function') { window.myload(); jnClockPaused = false; }
        video.muted = CONFIG.autoMute;
        if (video.playbackRate !== 1) video.playbackRate = 1;

        if (video.paused && !video.ended && Date.now() - jnProgress.lastPlay > 4000) {
            jnProgress.lastPlay = Date.now();
            Promise.resolve(video.play()).catch(error => diagnosticConsole.warn('金培播放请求失败：', error.message));
        }

        if (!Number.isFinite(video.duration) || video.duration <= 0) {
            if (Date.now() - jnProgress.at > 60000) pauseAutomation('等待课件时长超时，请检查播放器。');
            else updateHUD('等待课件时长...', jnContext.title, item?.title);
            return;
        }

        const targetSeconds = Math.max(60, Math.ceil(video.duration / 60) * 60);
        const hasNativeClock = typeof window.m_time === 'number' && Number.isFinite(window.m_time);
        const currentSeconds = hasNativeClock ? window.m_time : Math.floor(video.currentTime || 0);
        const isVideoEnded = Boolean(jnProgress.endedAt || video.ended || (video.duration > 0 && video.currentTime >= video.duration - 0.5));
        const clockReached = hasNativeClock ? (currentSeconds >= targetSeconds) : Boolean(isVideoEnded || currentSeconds >= targetSeconds);
        // 必须同时满足视频播放结束与平台计时达标，避免缓冲或暂停期间计时虚高提前切课
        const reachedTarget = isVideoEnded && clockReached;

        if (reachedTarget) {
            if (!jnProgress.targetReachedAt) jnProgress.targetReachedAt = Date.now();
            updateHUD('已达挂课时长，等待平台同步记录...', jnContext.title, item?.title || '当前课件',
                `${formatTime(currentSeconds)} / ${formatTime(targetSeconds)}`, jnContext.courseTitle);
            if (Date.now() - jnProgress.targetReachedAt < 6000) return;
            const resources = typeof performance !== 'undefined' && performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
            const referenceTime = Math.min(jnProgress.endedAt || Infinity, jnProgress.targetReachedAt || Infinity) - 5000;
            const loginId = document.querySelector('#txtLoginInfoId')?.value;
            const synced = resources.some(entry => {
                if (!/\/SetTime\.ashx(?:\?|$)/i.test(entry.name)) return false;
                try {
                    const url = new URL(entry.name, location.href);
                    const reqLoginId = url.searchParams.get('LoginInfoId');
                    const pTime = parseInt(url.searchParams.get('pTime'), 10);
                    if (loginId && reqLoginId && reqLoginId !== loginId) return false;
                    if (Number.isFinite(pTime) && pTime < targetSeconds) return false;
                    return performance.timeOrigin + entry.startTime >= referenceTime;
                } catch (_) {
                    return performance.timeOrigin + entry.startTime >= referenceTime;
                }
            });
            if (!synced) {
                if (Date.now() - jnProgress.targetReachedAt > 75000) pauseAutomation('播放已结束，但未观察到平台最后一次学习时间提交，请检查页面后继续。');
                return;
            }
            if (!jnContext.courseUrl) { pauseAutomation('课件已结束，请返回课程详情核对学习状态。'); return; }
            jnContext.index = (jnContext.index || 0) + 1;
            jnGo(jnContext.courseUrl); return;
        }

        if (isVideoEnded) {
            const remaining = Math.max(0, targetSeconds - currentSeconds);
            updateHUD(`视频已播完，补齐挂课时长中 (还需 ${remaining}s)...`, jnContext.title, item?.title || '当前课件',
                `${formatTime(currentSeconds)} / ${formatTime(targetSeconds)}`, jnContext.courseTitle);
        } else {
            updateHUD('正在播放金培课件 (正常挂课)...', jnContext.title, item?.title || '当前课件',
                `${formatTime(currentSeconds)} / ${formatTime(targetSeconds)}`, jnContext.courseTitle);
        }

        if (Math.abs(currentSeconds - (jnProgress.lastRecordedTime || 0)) >= 1) {
            jnProgress.lastRecordedTime = currentSeconds;
            jnProgress.at = Date.now();
        } else if (Math.abs(video.currentTime - jnProgress.time) >= 0.5) {
            jnProgress.time = video.currentTime;
            jnProgress.at = Date.now();
        }
        if (Date.now() - jnProgress.at > 60000) { pauseAutomation('金培播放器超过 60 秒没有进度，请检查网络后继续。'); return; }
        if (video.paused && Date.now() - jnProgress.lastPlay > 4000) {
            jnProgress.lastPlay = Date.now();
            Promise.resolve(video.play()).catch(error => diagnosticConsole.warn('金培播放请求失败：', error.message));
        }
    }

    async function handleJnPlatform() {
        if (jnBusy) return;
        const onManagedExam = /\/MyExam\//i.test(new URL(location.href).pathname) && !!jnContext.exam;
        if (!jnLoggedIn() && !onManagedExam) {
            jnLoginWaiting = true;
            updateHUD('江南金培：等待你手动登录，登录后继续。');
            return;
        }
        if (jnLoginWaiting) { jnLoginWaiting = false; taskCatalogAttemptAt = -Infinity; }
        if (!state.enabled && /等待你手动登录/.test(state.statusText)) updateHUD('已登录江南金培，请点击开始学习。');
        if (!state.enabled || state.isActionPending) return;
        jnBusy = true;
        try {
            const sourceUrl = location.href;
            const generation = claimGeneration;
            const path = new URL(location.href).pathname.toLowerCase();
            if (!currentClaim) {
                const claimed = await tryClaimCourseSlot('controller', '江南金培顺序学习', 'jnftc');
                if (sourceUrl !== location.href || generation !== claimGeneration) return;
                if (!state.enabled || !claimed) { if (state.enabled) updateHUD('另一个窗口正在处理金培任务，请在该窗口继续。'); return; }
            }
            registerTabHeartbeat();
            if (path.includes('/myexam/')) { jnHandleExam(); return; }
            if (path.endsWith('/onlineread.aspx')) return await jnHandlePlayer();
            if (path.endsWith('/layer_courseinfo.aspx')) return await jnHandleCourse();
            if (path.endsWith('/dutyshow.aspx')) { jnHandleDuty(); return; }
            if (!path.endsWith('/mydutylist.aspx')) { jnGo(jnTaskUrl()); return; }
            const tasks = jnReadTasks(document, location.href);
            if (!document.querySelector('#lblCurrDuty')) { updateHUD('等待金培学习任务加载...'); return; }
            saveTaskCatalog(tasks, Date.now()); renderTaskSelection(true);
            const next = tasks.find(task => isTaskKeySelected(task.key) && !getHandledMaps().includes(task.key));
            if (!next) {
                if (jnNextPage()) return;
                pauseAutomation('已选金培任务检查结束；最终完成状态以平台为准。'); return;
            }
            jnContext = { dutyKey: next.key, dutyUrl: next.url, title: next.title, dutyTab: 0 };
            updateHUD('正在进入金培学习任务...', next.title);
            jnGo(next.url);
        } catch (error) { if (state.enabled) pauseAutomation('金培流程异常：' + error.message); }
        finally { jnBusy = false; }
    }

    if (IS_JNFTC && typeof window.confirm === 'function') {
        const nativeConfirm = window.confirm.bind(window);
        window.confirm = makeNativeFunction(message => {
            return state.enabled && /^是否继续学习[？?]?$/.test(String(message).trim()) ? true : nativeConfirm(message);
        }, window.confirm, 'confirm');
    }

// ==========================================
    // 5. 主循环调度器
    // ==========================================
    function mainLoop() {
        if (!syncAccountContext()) return;
        syncRetryEpoch();
        createHUD();
        renderTaskSelection();
        if (IS_JNFTC) { updateHUD(); return handleJnPlatform(); }

        // 未手动启动时，不执行任何自动化逻辑（包括不自动弹窗确认、不自动播放、不自动跳转）
        if (!state.enabled) return;

        observeVideoPlayback(document.querySelector('video'));
        loadTaskCatalog().then(() => {
            renderTaskSelection();
            if (state.enabled && currentClaim && pickNextTask(getPendingTasks(), getCurrentMapId())) {
                spawnTaskWorker().catch(error => diagnosticConsole.warn('并发窗口唤起失败:', error.message));
            }
        });

        autoDismissDialogs();

        const url = location.href;

        if (url.includes('/home/index') || url.includes('/home/login') || url.includes('/home/portal')) {
            handleLoginAndIndex();
        } else if (url.includes('/home/my/myTask')) {
            return handleMyTaskPage();
        } else if (url.includes('/home/training/detail/')) {
            handleDetailPage();
        } else if (url.includes('/home/training/study/') || url.includes('/home/courseplay/')) {
            return handleStudyPage();
        }
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('storage', event => {
            if (event.key === ACCOUNT_ID_KEY || event.key === ACCOUNT_EPOCH_KEY) syncAccountContext();
        });
        window.addEventListener('beforeunload', () => {
            if (!state.enabled || !CONFIG.debugPlayback) return;
            const video = document.querySelector('video');
            diagnosticConsole.log('播放诊断：页面即将卸载', {
                currentTime: video?.currentTime, duration: video?.duration,
                switching: state.isSwitching, actionPending: state.isActionPending,
            });
        });
    }
    enableLockStealth();
    enableStorageStealth();
    if (!IS_JNFTC) enableAntiPause();
    const workerTimer = createWorkerInterval(mainLoop, CONFIG.checkInterval);
    setTimeout(mainLoop, 1000);
    checkScriptUpdate().catch(() => {});

    recordDiagnostic('INFO', '脚本初始化 v1.8.4，运行状态：' + (state.enabled ? '已启动' : '待启动') + ' (防休眠: ' + (workerTimer.type === 'worker' ? 'Web Worker 独立线程' : '主线程计时器') + ')' + (accountResetOnStartup ? '；已清理上次账号的学习状态' : ''));

})();
