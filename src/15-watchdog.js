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

