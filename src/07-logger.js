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

