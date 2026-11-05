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

