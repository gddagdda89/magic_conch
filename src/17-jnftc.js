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
