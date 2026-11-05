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

