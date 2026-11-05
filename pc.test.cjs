const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const pkg = require('./package.json');

function createLockManager() {
    const queues = new Map();
    return {
        async query() { return { held: [...queues.keys()].map(name => ({ name })), pending: [] }; },
        request(name, options, callback) {
            if (typeof options === 'function') { callback = options; options = {}; }
            if (options.ifAvailable && queues.has(name)) return Promise.resolve().then(() => callback(null));
            return new Promise((resolve, reject) => {
                const queue = queues.get(name) || [];
                queues.set(name, queue);
                queue.push({ callback, resolve, reject });
                if (queue.length === 1) run();
                function run() {
                    const item = queue[0];
                    Promise.resolve().then(() => item.callback({ name })).then(item.resolve, item.reject).finally(() => {
                        queue.shift();
                        if (queue.length) run(); else queues.delete(name);
                    });
                }
            });
        }
    };
}

function setup(initialStorage = [], initialLocalStorage = [], shared = {}) {
    let now = 0;
    let nextTimer = 0;
    const timers = new Map();
    const storage = new Map([['jinpei_auto_running', 'true'], ...initialStorage]);
    const localStorageMap = shared.storage || new Map([...initialLocalStorage]);
    if (!localStorageMap.has('_kme_selected_tasks')) localStorageMap.set('_kme_selected_tasks', JSON.stringify({ mode: 'all' }));
    const openedUrls = [];
    const video = { paused: false, muted: true, playbackRate: 1, currentTime: 0, duration: 100, ended: false,
        plays: 0, pause() { this.paused = true; }, play() { this.plays++; this.paused = false; this.ended = false; return Promise.resolve(); } };
    const current = { completed: false, className: 'text-primary', innerText: '当前小节\n00:01:40',
        querySelector(selector) { return selector === '[title], .truncate' ? { innerText: '当前小节' } : (this.completed ? {} : null); } };
    const next = { ...current, className: '', clicks: 0, click() { this.clicks++; } };
    const fixture = { video, items: [current, next], courses: [], catalogClicks: 0 };
    const hud = new Map();
    const catalog = { innerText: '学习目录', children: [], closest() { return { click() { fixture.catalogClicks++; } }; } };
    class Document {
        createElement() { return { style: {}, append() {}, appendChild() {}, addEventListener() {} }; }
        get hidden() { return true; }
        get visibilityState() { return 'hidden'; }
        get webkitVisibilityState() { return 'hidden'; }
        addEventListener() {}
        getElementById(id) {
            if (!hud.has(id)) hud.set(id, { style: {}, innerText: '', addEventListener() {}, appendChild() {}, title: '' });
            return hud.get(id);
        }
        querySelector(selector) { return selector === 'video' ? fixture.video : null; }
        querySelectorAll(selector) {
            if (selector.startsWith('div.group.cursor-pointer,')) return fixture.items;
            if (selector.startsWith('[class*="panelContent"]')) return fixture.courses;
            if (selector.startsWith('button, .ant5-btn')) return fixture.entryButtons || [];
            if (selector === 'li, div, span, button') return [catalog];
            return [];
        }
    }
    const context = {
        URL, URLSearchParams, AbortController, Document, document: new Document(), window: {
            addEventListener() {},
            open(url) { openedUrls.push(url); return { closed: false }; },
            close() { this.closed = true; },
            closed: false
        },
        location: { href: shared.url || 'https://pc.kmelearning.com/home/training/study/1', reloads: 0, reload() { this.reloads++; } },
        sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        navigator: { locks: shared.locks || createLockManager() },
        localStorage: { get length() { return localStorageMap.size; }, key: index => [...localStorageMap.keys()][index] ?? null, getItem: key => localStorageMap.get(key) ?? null, setItem: (key, value) => localStorageMap.set(key, value), removeItem: key => localStorageMap.delete(key) },
        console: { log() {}, warn() {}, error() {} }, Date: class extends Date { static now() { return now; } },
        setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
        clearTimeout(id) { timers.delete(id); }, setInterval() {}, clearInterval() {},
    };
    vm.createContext(context);
    const source = fs.readFileSync(path.join(__dirname, 'pc.js'), 'utf8');
    vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'CONFIG.enableJitter = false; CONFIG.debugPlayback = true; window.testApi = { makeNativeFunction, enableLockStealth, enableStorageStealth, jnParseExamPlans, jnApplyExamPlan, jnSubmitRating, jnReportStudyTime, jnParseAnswers, jnAnswerQuestions, jnStartExam, jnHandleExam, syncAccountContext, readAccountIdentity, detectPlatform, jnRoot, jnUrl, jnReadTasks, jnReadVideos, jnHandleDuty, jnHandleCourse, jnHandlePlayer, handleJnPlatform, pauseJnPlayback, setJnContext: value => { jnContext = value; jnSave(); }, getJnContext: () => jnContext, isItemCompleted, getAllSubVideoItems, replayVideoTail, state, switchToNextSubVideoOrCourse, mainLoop, pauseAutomation, calculateCourseTotalProgress, detectCourseExam, getHandledCourses, markCourseHandled, isCourseHandled, getHandledMaps, markMapHandled, getCourseItems, autoDismissDialogs, updateHUD, simulateHumanClick, randomBetween, setManagedTimeout, STORAGE_KEYS, getStorageItem, setStorageItem, removeStorageItem, CONFIG, checkWatchdog, getWatchdogState, setWatchdogState, clearWatchdogState, markSubVideoFailed, isSubVideoFailed, getFailedSubVideos, watchdogRuntime, getConcurrencySetting, setConcurrencySetting, getActiveTabs, registerTabHeartbeat, unregisterTab, isCourseBusyByOtherTab, tryClaimCourseSlot, TAB_ID, waitForPageReady, recordDiagnostic, observeVideoPlayback, formatDiagnosticLogs, clearDiagnosticLogs, copyDiagnosticLogs, getCourseOutcomes, saveCourseOutcome, getCourseDisposition, getPlatformEntityId, getCurrentCourseId, getSubVideoKey, getCourseKeyFromItem, getTaskIdFromCard, getTaskSelection, saveTaskSelection, getTaskCatalog, saveTaskCatalog, loadTaskCatalog, pickNextTask, spawnTaskWorker, isTaskKeySelected, handleMyTaskPage, retrySkippedCourses, reconcileBeforeReplay, readPlatformLearningRecord, directoryDurationSeconds, createWorkerInterval, checkScriptUpdate, semverCompare }; })();'), context);
    timers.clear(); // 初始化主循环由测试显式调用。
    function advance(ms) {
        const end = now + ms;
        while (true) {
            const pending = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!pending) break;
            timers.delete(pending[0]); now = pending[1].at; pending[1].fn();
        }
        now = end;
    }
    return { ...context.window.testApi, context, fixture, current, next, advance, timers, storage, localStorageMap, openedUrls };
}

const settleLocks = () => new Promise(resolve => setImmediate(resolve));

function setupJn(pathname = '/WebTraining14/Website/Index.aspx') {
    const t = setup([], [], { url: 'https://jnftc.jnbank.com.cn' + pathname });
    t.CONFIG.jnAutoReport = false; t.CONFIG.jnAutoExam = false;
    const elements = new Map();
    const collections = new Map();
    const originalOne = t.context.document.querySelector.bind(t.context.document);
    const originalAll = t.context.document.querySelectorAll.bind(t.context.document);
    t.context.document.querySelector = selector => elements.has(selector) ? elements.get(selector) : selector === 'video,audio' ? t.fixture.video : originalOne(selector);
    t.context.document.querySelectorAll = selector => collections.has(selector) ? collections.get(selector) : originalAll(selector);
    const events = new Map();
    t.fixture.video.addEventListener = (type, listener) => events.set(type, listener);
    collections.set('video,audio', [t.fixture.video]);
    return { ...t, elements, collections, events };
}

test('金培按完整域名识别，与易知流程隔离且兼容新旧站点根路径', () => {
    const t = setupJn();
    assert.equal(t.detectPlatform(t.context.location.href), 'jnftc');
    assert.equal(t.detectPlatform('https://jnftc.jnbank.com.cn.evil.test/'), 'yizhi');
    assert.equal(t.jnRoot(), '/WebTraining14');
    assert.equal(t.jnRoot('https://jnftc.jnbank.com.cn/WebTraining/Web/a'), '/WebTraining');
    assert.equal(t.jnUrl('javascript:alert(1)'), '');
    assert.equal(t.jnUrl('https://other.test/WebTraining14/Web/a'), '');
    assert.equal(t.jnUrl('/WebTraining14/Website/Index.aspx'), '');
});

test('金培平台不需要支持并发，并发设置固定为 1 且不可调整', () => {
    const t = setupJn();
    t.localStorageMap.set(t.STORAGE_KEYS.concurrency, '4');
    assert.equal(t.getConcurrencySetting(), 1);
    assert.equal(t.setConcurrencySetting(5), 1);
    assert.equal(t.state.concurrency, 1);
});

test('金培游客只等待手动登录，登录后自动去对应站点任务页', async () => {
    const t = setupJn();
    t.state.enabled = true; // 用户在游客页点击开始，等待其手动登录。
    await t.handleJnPlatform();
    assert.match(t.state.statusText, /等待你手动登录/);
    assert.equal(t.state.enabled, true);
    assert.match(t.context.location.href, /Website\/Index/);
    t.elements.set('#Top1_lbtnLogout,#Top1_BtnLogOut,.theme-login2,#lblCurrDuty,#tbCurTabIndex,#txtLoginInfoId,.a-2', {});
    await t.handleJnPlatform();
    assert.equal(t.context.location.href, 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyDuty/MyDutyList.aspx?Menu=9');
});

test('金培已登录但未启动时清除过期的等待登录提示，不自动跳转', async () => {
    const t = setupJn();
    t.state.enabled = false; t.state.statusText = '江南金培：等待你手动登录，登录后继续。';
    t.elements.set('[id$="_BtnLogOut"],[id$="_lbtnLogout"]', {});
    await t.handleJnPlatform();
    assert.match(t.state.statusText, /已登录江南金培/);
    assert.match(t.context.location.href, /Website\/Index/);
});

test('金培只解析课件参数，不执行 onclick，中文路径使用平台编码', () => {
    const t = setupJn('/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1');
    const link = { getAttribute: () => "Online('ware-1','课程/一.mp4','1','course-1')", closest: () => ({ querySelector: () => ({ textContent: '第一讲' }) }) };
    t.collections.set('#table a[onclick]', [link, { ...link, getAttribute: () => "alert('fake')" }]);
    const videos = t.jnReadVideos();
    assert.equal(videos.length, 1);
    assert.equal(videos[0].id, 'ware-1');
    assert.ok(videos[0].url.includes('Url=%u8BFE%u7A0B/%u4E00.mp4'));
    assert.equal(videos[0].title, '第一讲');
});

test('金培任务使用 DutyId，任务链接不允许跨域', () => {
    const t = setupJn();
    const card = { textContent: '学习地图', querySelector: () => ({ getAttribute: () => 'DutyShow.aspx?DutyId=task-1' }) };
    t.collections.set('#lblCurrDuty > div > div', [card]);
    assert.equal(t.jnReadTasks(t.context.document, 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyDuty/MyDutyList.aspx')[0].key, 'task-1');
    card.querySelector = () => ({ getAttribute: () => 'https://other.test/DutyShow.aspx?DutyId=task-2' });
    assert.equal(t.jnReadTasks(t.context.document, t.context.location.href).length, 0);
});

test('金培先检查在学再检查未学，不用进度数字推断全部完成', () => {
    const t = setupJn('/WebTraining14/Web/MyDuty/DutyShow.aspx?DutyId=task-1');
    let submitted = 0;
    const input = { value: '0', form: { submit() { submitted++; } } };
    t.elements.set('#tbCurTabIndex', input);
    t.elements.set('#ul-1', {}); t.elements.set('#ul-2', {});
    t.jnHandleDuty();
    assert.equal(submitted, 1);
    assert.equal(input.value, '1');
    assert.equal(t.getHandledMaps().includes('task-1'), false);
    t.state.isActionPending = false;
    t.jnHandleDuty();
    assert.equal(t.getHandledMaps().includes('task-1'), true);
    assert.match(t.context.location.href, /MyDutyList/);
});

test('金培平台明确确认课程完成才返回任务，考试评价待人工处理', () => {
    const path = '/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1';
    const t = setupJn(path);
    t.setJnContext({ dutyUrl: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyDuty/DutyShow.aspx?DutyId=task-1' });
    t.elements.set('.a-4', { getAttribute: () => "background-image:url('../images/CourseOver.png')" });
    t.jnHandleCourse();
    assert.match(t.context.location.href, /DutyShow/);
    const pending = setupJn(path);
    pending.elements.set('.a-2', { getAttribute: () => 'ico_kecheng_t3_over.png' });
    pending.elements.set('a[onclick*="CreateExam"]', {});
    pending.jnHandleCourse();
    assert.equal(pending.state.enabled, false);
    assert.match(pending.state.statusText, /手动完成/);
    assert.equal(pending.getHandledMaps().length, 0);
});

test('金培播放结束等待平台最后一次上报，确认后返回详情并推进课件队列', () => {
    const t = setupJn('/WebTraining14/Web/MyClass/OnLineRead.aspx?CoursewareId=ware-1');
    t.setJnContext({ queue: [{ id: 'ware-1', title: '第一讲' }], index: 0,
        courseUrl: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1' });
    t.advance(1000);
    t.fixture.video.ended = true;
    t.jnHandlePlayer();
    t.advance(6000);
    t.jnHandlePlayer();
    assert.match(t.context.location.href, /OnLineRead/);
    t.context.performance = { timeOrigin: 0, getEntriesByType: () => [{ name: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/SetTime.ashx?x=1', startTime: 2000 }] };
    t.jnHandlePlayer();
    assert.match(t.context.location.href, /Layer_CourseInfo/);
    assert.equal(t.getJnContext().index, 1);
});

test('金培正常挂课模式按n+1分钟向上取整挂满时长，2分53秒未满180秒不交卷，满180秒且上报才返回', () => {
    const t = setupJn('/WebTraining14/Web/MyClass/OnLineRead.aspx?CoursewareId=ware-1');
    t.CONFIG.jnAutoReport = false;
    t.setJnContext({ queue: [{ id: 'ware-1', title: '第一讲' }], index: 0,
        courseUrl: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1' });
    t.advance(1000);
    t.fixture.video.duration = 173; // 2 分 53 秒
    t.fixture.video.currentTime = 173;
    t.fixture.video.ended = true; // 视频播放完毕
    t.context.window.m_time = 173; // 原生计时当前在 173 秒（目标 180 秒）

    // 1. 刚播完但 m_time 未达到 180 秒（还剩 7 秒）
    t.jnHandlePlayer();
    assert.match(t.state.statusText, /补齐挂课时长/);
    assert.match(t.context.location.href, /OnLineRead/); // 绝不提前返回

    // 2. 原生计时走到 179 秒
    t.context.window.m_time = 179;
    t.jnHandlePlayer();
    assert.match(t.context.location.href, /OnLineRead/);

    // 3. 原生计时走到 180 秒（达到 3 分钟），平台触发上报
    t.context.window.m_time = 180;
    t.jnHandlePlayer();
    assert.match(t.state.statusText, /已达挂课时长/);
    assert.match(t.context.location.href, /OnLineRead/);

    // 4. 等待 6 秒以上且观察到平台上报完成
    t.advance(7000);
    t.context.performance = { timeOrigin: 0, getEntriesByType: () => [{ name: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/SetTime.ashx?x=1', startTime: 2000 }] };
    t.jnHandlePlayer();
    assert.match(t.context.location.href, /Layer_CourseInfo/);
    assert.equal(t.getJnContext().index, 1);
});

test('金培极速模式与正常挂课模式偏好设置可切换与持久化', () => {
    const t = setupJn();
    assert.equal(t.CONFIG.jnAutoReport, false); // setupJn 显式设为 false
    const normal = setup();
    assert.equal(normal.CONFIG.jnAutoReport, true);
    t.localStorageMap.set(t.STORAGE_KEYS.fastMode, '0');
    assert.equal(t.localStorageMap.get('_kme_fast_mode'), '0');
});

test('金培正常挂课模式同时检查视频结束与平台计时，缓冲未播完绝不提前切课', () => {
    const t = setupJn('/WebTraining14/Web/MyClass/OnLineRead.aspx?CoursewareId=ware-1');
    t.CONFIG.jnAutoReport = false;
    t.setJnContext({ queue: [{ id: 'ware-1', title: '第一讲' }], index: 0,
        courseUrl: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1' });
    t.advance(1000);
    t.fixture.video.duration = 173; // 2 分 53 秒
    t.fixture.video.currentTime = 50; // 视频卡顿/缓冲，才播到 50 秒
    t.fixture.video.ended = false;
    t.context.window.m_time = 180; // 虽然平台计时虚高达到 180 秒

    t.jnHandlePlayer();
    // 必须继续播放视频，绝不能提前切课
    assert.match(t.state.statusText, /正在播放金培课件/);
    assert.match(t.context.location.href, /OnLineRead/);
});

test('金培正常挂课上报精确核对 LoginInfoId 与目标 pTime', () => {
    const t = setupJn('/WebTraining14/Web/MyClass/OnLineRead.aspx?CoursewareId=ware-1');
    t.CONFIG.jnAutoReport = false;
    t.elements.set('#txtLoginInfoId', { value: 'my-session-123' });
    t.setJnContext({ queue: [{ id: 'ware-1', title: '第一讲' }], index: 0,
        courseUrl: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1' });
    t.advance(1000);
    t.fixture.video.duration = 173;
    t.fixture.video.ended = true;
    t.context.window.m_time = 180;
    t.jnHandlePlayer();

    t.advance(7000);
    // 1. 错误的 session ID -> 拒绝
    t.context.performance = { timeOrigin: 0, getEntriesByType: () => [{ name: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/SetTime.ashx?LoginInfoId=other-session&pTime=180', startTime: 2000 }] };
    t.jnHandlePlayer();
    assert.match(t.context.location.href, /OnLineRead/);

    // 2. 正确的 session ID 但 pTime 未达到目标 180 秒（如只有 60 秒） -> 拒绝
    t.context.performance = { timeOrigin: 0, getEntriesByType: () => [{ name: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/SetTime.ashx?LoginInfoId=my-session-123&pTime=60', startTime: 2000 }] };
    t.jnHandlePlayer();
    assert.match(t.context.location.href, /OnLineRead/);

    // 3. 正确的 session ID 且 pTime 达到 180 秒 -> 匹配通过并切课
    t.context.performance = { timeOrigin: 0, getEntriesByType: () => [{ name: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/SetTime.ashx?LoginInfoId=my-session-123&pTime=180', startTime: 2000 }] };
    t.jnHandlePlayer();
    assert.match(t.context.location.href, /Layer_CourseInfo/);
    assert.equal(t.getJnContext().index, 1);
});

test('金培上报超时、播放器加载超时有限暂停，不误标完成', () => {
    const t = setupJn('/WebTraining14/Web/MyClass/OnLineRead.aspx?CoursewareId=ware-1');
    t.advance(1000); t.fixture.video.ended = true; t.jnHandlePlayer();
    t.advance(76000); t.jnHandlePlayer();
    assert.equal(t.state.enabled, false);
    assert.match(t.state.statusText, /最后一次学习时间提交/);
    const missing = setupJn('/WebTraining14/Web/MyClass/OnLineRead.aspx');
    missing.fixture.video = null;
    missing.jnHandlePlayer(); missing.advance(61000); missing.jnHandlePlayer();
    assert.equal(missing.state.enabled, false);
    assert.match(missing.state.statusText, /播放器加载/);
});

test('暂停金培同时暂停内嵌媒体和原生页面计时', () => {
    const t = setupJn();
    let stopped = 0;
    t.context.window.tt = 9; t.context.window.myload = () => {};
    t.context.clearInterval = id => { assert.equal(id, 9); stopped++; };
    t.pauseAutomation('测试暂停');
    assert.equal(stopped, 1);
    assert.equal(t.fixture.video.paused, true);
});

function prepareJnReport(t) {
    t.CONFIG.jnAutoReport = true;
    t.elements.set('#txtLoginInfoId', { value: 'fixture-session' });
    t.setJnContext({ queue: [{ id: 'ware-1' }], index: 0,
        courseUrl: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1' });
    let observer;
    t.context.MutationObserver = class {
        constructor(callback) { this.callback = callback; observer = this; this.active = false; }
        observe() { this.active = true; }
        disconnect() { this.active = false; }
    };
    // 模拟平台 myload/startclock 自己加一秒并加载上报脚本；fetch 只属于测试平台。
    t.context.window.myload = () => {
        t.context.window.tt = 1;
        Promise.resolve().then(async () => {
            if (!observer?.active) return;
            t.context.window.m_time++;
            const url = new URL('SetTime.ashx', t.context.location.href);
            url.search = new URLSearchParams({ LoginInfoId: 'fixture-session', pTime: String(t.context.window.m_time) }).toString();
            const listeners = new Map();
            const script = { tagName: 'SCRIPT', src: url.href, addEventListener: (type, fn) => listeners.set(type, fn),
                removeEventListener: type => listeners.delete(type) };
            observer.callback([{ addedNodes: [script] }]);
            try {
                const response = await t.context.fetch(url.href);
                const body = await response.text();
                listeners.get(response.ok && !/<html|登录|error/i.test(body) ? 'load' : 'error')?.();
            } catch (_) { listeners.get('error')?.(); }
        });
    };
}

test('金培自动计时写入 m_time，重复轮询只上报一次并返回课程核验', async () => {
    const t = setupJn('/WebTraining14/Web/MyClass/OnLineRead.aspx?CoursewareId=ware-1');
    prepareJnReport(t);
    const requests = [];
    t.context.fetch = async url => { requests.push(url); return { ok: true, url, text: async () => '' }; };
    await Promise.all([t.jnReportStudyTime(t.fixture.video), t.jnReportStudyTime(t.fixture.video)]);
    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0]).searchParams.get('pTime'), '120');
    assert.equal(t.context.window.m_time, 120);
    assert.equal(t.getJnContext().index, 1);
    assert.equal(t.getHandledMaps().length, 0);
    assert.match(t.context.location.href, /Layer_CourseInfo/);
});

test('金培所有时长上报均向上取整到60秒整数倍，157秒上报180秒', async () => {
    for (const [duration, expected] of [[1, 60], [59.9, 60], [60, 60], [60.01, 120], [157, 180], [180, 180]]) {
        const t = setupJn('/WebTraining14/Web/MyClass/OnLineRead.aspx?CoursewareId=ware-1');
        prepareJnReport(t); t.fixture.video.duration = duration;
        let seconds;
        t.context.fetch = async url => { seconds = Number(new URL(url).searchParams.get('pTime')); return { ok: true, url, text: async () => '' }; };
        await t.jnReportStudyTime(t.fixture.video);
        assert.equal(seconds, expected); assert.equal(seconds % 60, 0);
        assert.equal(t.context.window.m_time, expected);
    }
});

function prepareJnRating(t) {
    const fields = { text: { value: '' }, score: { value: '0' }, star: { value: '' } };
    const form = { getAttribute: () => '', fields: [['__VIEWSTATE', 'fixture-state']] };
    const button = { name: 'SubComment', value: '发表', form };
    t.elements.set('#txtArea', fields.text); t.elements.set('#HidSpell', fields.score);
    t.elements.set('#star_submit input[name="score"]', fields.star); t.elements.set('#SubComment', button);
    const images = Array.from({ length: 5 }, () => ({ src: 'https://fixture/star-off.png' }));
    t.elements.set('#star_submit', { querySelectorAll: () => images });
    t.context.window.jQuery = () => ({ raty(method, value) { assert.equal(method, 'score'); assert.equal(value, 5); images.forEach(image => { image.src = 'https://fixture/star-on.png'; }); } });
    t.context.FormData = class {
        constructor(value) { this.values = [...value.fields, ['HidSpell', fields.score.value], ['score', fields.star.value], ['txtArea', fields.text.value]]; }
        entries() { return this.values.values(); }
        [Symbol.iterator]() { return this.entries(); }
        set(name, value) { this.values = this.values.filter(([key]) => key !== name); this.values.push([name, value]); }
    };
    t.setJnContext({ courseId: 'course-1', courseUrl: t.context.location.href,
        dutyUrl: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyDuty/DutyShow.aspx?DutyId=task-1' });
    return fields;
}

test('评价提交以实际表单为准，评分被页面改回0时停止，不发送非5分', async () => {
    const t = setupJn('/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1');
    const fields = prepareJnRating(t); let sent = 0;
    t.context.Event = class { constructor(type) { this.type = type; } };
    fields.text.dispatchEvent = event => { if (event.type === 'change') fields.score.value = '0'; };
    t.context.fetch = async () => { sent++; return { ok: true, text: async () => '' }; };
    await t.jnSubmitRating();
    assert.equal(sent, 0); assert.equal(t.state.enabled, false);
    assert.notEqual(t.getJnContext().rating.payloadVerified, true);
});

test('页面平均分与已有评价的重复score字段不会混入本次5分请求', async () => {
    const t = setupJn('/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1');
    prepareJnRating(t);
    t.elements.get('#SubComment').form.fields.push(['score', '4.732'], ['score', '3']);
    let sent;
    t.context.fetch = async (url, options) => { sent = options.body; return { ok: true, url, text: async () => '' }; };
    await t.jnSubmitRating();
    assert.deepEqual(sent.getAll('score'), ['5']); assert.deepEqual(sent.getAll('HidSpell'), ['5']);
    assert.equal(t.getJnContext().rating.payloadVerified, true);
});

test('评分插件未点亮五星时不提交，避免只改隐藏值而控件显示不一致', async () => {
    const t = setupJn('/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1');
    prepareJnRating(t); let sent = 0;
    t.context.window.jQuery = () => ({ raty() {} });
    t.context.fetch = async () => { sent++; return { ok: true, text: async () => '' }; };
    await t.jnSubmitRating();
    assert.equal(sent, 0); assert.equal(t.state.enabled, false);
    assert.match(t.state.statusText, /未成功点亮/);
});

test('金培自动评价按原脚本填写5分和好，保留ASP表单参数且只提交一次', async () => {
    const t = setupJn('/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1');
    const fields = prepareJnRating(t); const requests = [];
    t.context.fetch = async (url, options) => { requests.push(options); return { ok: true, url, text: async () => '<html></html>' }; };
    await Promise.all([t.jnSubmitRating(), t.jnSubmitRating()]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.get('__VIEWSTATE'), 'fixture-state');
    assert.equal(requests[0].body.get('SubComment'), '发表');
    assert.equal(fields.text.value, '好'); assert.equal(fields.score.value, '5'); assert.equal(fields.star.value, '5');
    assert.equal(t.getHandledMaps().length, 0);
    t.elements.set('.a-4', { getAttribute: () => 'CourseOver.png' });
    t.jnHandleCourse();
    assert.match(t.context.location.href, /DutyShow/);
    assert.equal(t.state.enabled, true);
});

test('金培评价页地址含#none时真正刷新页面，不停留在页内跳转等待', async () => {
    const t = setupJn('/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1#none');
    prepareJnRating(t);
    t.context.fetch = async url => ({ ok: true, url, text: async () => '' });
    await t.jnSubmitRating();
    assert.equal(t.context.location.reloads, 1);
    assert.equal(t.state.enabled, true);
});

test('评价未得到平台确认时有限核验，不重复评价、不提前切下一门', async () => {
    const t = setupJn('/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1');
    prepareJnRating(t); let requests = 0;
    t.context.fetch = async url => { requests++; return { ok: true, url, text: async () => '' }; };
    await t.jnSubmitRating();
    for (let i = 0; i < 4; i++) { t.advance(5000); await t.jnSubmitRating(); }
    assert.equal(requests, 1); assert.equal(t.state.enabled, false);
    assert.match(t.state.statusText, /仍未确认/);
    assert.equal(t.getHandledMaps().length, 0);
});

test('评价提交期间暂停或换号，迟到响应不再跳转', async () => {
    for (const change of ['pause', 'account']) {
        const t = setupJn('/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1');
        prepareJnRating(t); let finish;
        t.context.fetch = url => new Promise(resolve => { finish = () => resolve({ ok: true, url, text: async () => '' }); });
        const pending = t.jnSubmitRating();
        if (change === 'pause') t.pauseAutomation('暂停');
        else t.localStorageMap.set('_kme_account_epoch', 'changed');
        finish(); await pending;
        assert.equal(t.getHandledMaps().length, 0);
        assert.match(t.context.location.href, /Layer_CourseInfo/);
    }
});

test('金培整页跳转后恢复任务课程小节名称，初始化日志不再全为空', () => {
    const context = { title: '测试任务', courseTitle: '测试课程', queue: [{ title: '测试小节' }], index: 0 };
    const t = setup([['_jnftc_context', JSON.stringify(context)]], [], { url: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/OnLineRead.aspx' });
    assert.equal(t.state.currentTask, '测试任务'); assert.equal(t.state.currentCourse, '测试课程');
    assert.equal(t.state.currentSubVideo, '测试小节');
});

test('金培计时任务等待时长就绪及定时调度，不在首次识别时立即上报', async () => {
    const t = setupJn('/WebTraining14/Web/MyClass/OnLineRead.aspx?CoursewareId=ware-1');
    prepareJnReport(t); let requests = 0;
    t.context.fetch = async url => { requests++; return { ok: true, url, text: async () => '' }; };
    t.jnHandlePlayer(); assert.equal(requests, 0);
    t.advance(3000); await t.jnHandlePlayer(); assert.equal(requests, 1);
});

test('金培时长上报遇到登录页、错误响应时不推进课件', async () => {
    for (const response of [{ ok: true, text: async () => '<html>登录</html>' }, { ok: false, text: async () => 'error' }]) {
        const t = setupJn('/WebTraining14/Web/MyClass/OnLineRead.aspx?CoursewareId=ware-1');
        prepareJnReport(t); t.context.fetch = async () => response;
        await t.jnReportStudyTime(t.fixture.video);
        assert.equal(t.getJnContext().index, 0);
        assert.equal(t.state.enabled, false);
        assert.match(t.context.location.href, /OnLineRead/);
    }
});

test('金培上报等待中暂停、换号或更换播放器，迟到响应不切课', async () => {
    for (const change of ['pause', 'account', 'video']) {
        const t = setupJn('/WebTraining14/Web/MyClass/OnLineRead.aspx?CoursewareId=ware-1');
        prepareJnReport(t); let finish;
        t.context.fetch = url => new Promise(resolve => { finish = () => resolve({ ok: true, url, text: async () => '' }); });
        const pending = t.jnReportStudyTime(t.fixture.video);
        await Promise.resolve();
        if (change === 'pause') t.pauseAutomation('暂停');
        if (change === 'account') t.localStorageMap.set('_kme_account_epoch', 'another-account');
        if (change === 'video') t.fixture.video = { ...t.fixture.video };
        finish(); await pending;
        assert.equal(t.getJnContext().index, 0);
        assert.match(t.context.location.href, /OnLineRead/);
    }
});

test('金培先设为60*N-1，等平台走到整分钟并完成原生脚本加载才切课', async () => {
    const t = setupJn('/WebTraining14/Web/MyClass/OnLineRead.aspx?CoursewareId=ware-1');
    prepareJnReport(t); let finish;
    t.context.fetch = url => new Promise(resolve => { finish = () => resolve({ ok: true, url, text: async () => '' }); });
    const pending = t.jnReportStudyTime(t.fixture.video);
    assert.equal(t.context.window.m_time, 119);
    assert.equal(t.getJnContext().index, 0);
    await Promise.resolve();
    assert.equal(t.context.window.m_time, 120);
    assert.equal(t.getJnContext().index, 0);
    finish(); await pending;
    assert.equal(t.getJnContext().index, 1);
});

test('金培原生计时器缺失或一直不触发上报时有限暂停', async () => {
    for (const missing of [true, false]) {
        const t = setupJn('/WebTraining14/Web/MyClass/OnLineRead.aspx?CoursewareId=ware-1');
        prepareJnReport(t);
        if (missing) delete t.context.window.myload;
        else t.context.window.myload = () => {};
        const pending = t.jnReportStudyTime(t.fixture.video);
        if (!missing) t.advance(10000);
        await pending;
        assert.equal(t.state.enabled, false); assert.equal(t.getJnContext().index, 0);
    }
});

function jnExamFixture(values = ['A', 'BD', '0']) {
    const optionsByNumber = new Map();
    const questions = values.map((value, i) => {
        const id = i + 1;
        const answer = { id: 'tmjo_' + id, value, getAttribute: () => value };
        const options = Array.from({ length: 4 }, (_, index) => ({ id: 'tm_' + id + '_' + index,
            type: i === 1 ? 'checkbox' : 'radio', checked: false, clicks: 0,
            click() { this.clicks++; if (this.type === 'radio') options.forEach(other => { other.checked = false; }); this.checked = !this.checked; } }));
        optionsByNumber.set(String(id), options);
        return { querySelector: () => answer };
    });
    return { questions, optionsByNumber,
        doc: { querySelectorAll(selector) {
            if (selector === '.tb_title') return questions;
            const number = selector.match(/tm_(\d+)_/)?.[1];
            return optionsByNumber.get(number) || [];
        }, querySelector() { return null; } } };
}

test('金培自动答题支持单选、多选、判断题，重复调用不重复点击正确选项', () => {
    const t = setupJn(); const fixture = jnExamFixture();
    assert.equal(t.jnAnswerQuestions(fixture.doc), 3);
    assert.deepEqual([...fixture.optionsByNumber.values()].map(options => options.filter(o => o.checked).map(o => o.id)),
        [['tm_1_0'], ['tm_2_1', 'tm_2_3'], ['tm_3_1']]);
    t.jnAnswerQuestions(fixture.doc);
    assert.equal([...fixture.optionsByNumber.values()].flat().reduce((sum, option) => sum + option.clicks, 0), 4);
    assert.deepEqual(Array.from(t.jnParseAnswers('A, A;G')), ['A', 'G']);
    assert.throws(() => t.jnParseAnswers('unknown'), /格式/);
});

test('金培缺答案、缺选项、未知题型时先整体校验，不部分作答或交卷', () => {
    const t = setupJn();
    for (const value of ['', 'H', 'this is not an answer']) {
        const fixture = jnExamFixture(['A', value]);
        assert.throws(() => t.jnAnswerQuestions(fixture.doc));
        assert.equal([...fixture.optionsByNumber.values()].flat().some(option => option.checked), false);
    }
    const missing = jnExamFixture(['G']);
    assert.throws(() => t.jnAnswerQuestions(missing.doc), /选项/);
    const radio = jnExamFixture(['AB']);
    assert.throws(() => t.jnAnswerQuestions(radio.doc), /题型/);
});

test('金培考试入口解析参数而不执行页面源码，同一考试不会反复进入', () => {
    const t = setupJn('/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1');
    t.CONFIG.jnAutoExam = true;
    t.context.window.btnGiveUp_onclick = Object.assign(() => {}, { toString: () => "function btnGiveUp_onclick(){var sStudentId='student-1';}" });
    const link = { getAttribute: () => "CreateExam('exam-1')" };
    t.jnStartExam(link);
    const url = new URL(t.context.location.href);
    assert.equal(url.searchParams.get('Tk_Cl_Id'), 'exam-1');
    assert.equal(url.searchParams.get('Clerk_id'), 'student-1');
    t.context.location.href = 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1';
    t.jnStartExam(link);
    assert.equal(t.state.enabled, false);
    assert.match(t.state.statusText, /本轮已尝试/);
});

test('金培跨同源frame答题和交卷只执行一次，提交后返回详情而不登记通过', () => {
    const t = setupJn('/WebTraining14/Web/MyExam/aspNet/ExamMain.aspx');
    t.CONFIG.jnAutoExam = true;
    t.setJnContext({ courseUrl: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1',
        exam: { id: 'exam-1', phase: 'opened', startedAt: 0 } });
    const fixture = jnExamFixture(); let submitted = 0;
    const form = { submit() { submitted++; } };
    fixture.doc.querySelector = selector => selector === '#frmExam' ? form : null;
    fixture.doc.defaultView = { confirm: () => false, total: 3, check_tx: number => fixture.optionsByNumber.get(String(number)).some(o => o.checked) };
    const header = { querySelectorAll: () => [], defaultView: {
        confirm: () => false, SubmitExam() { assert.equal(fixture.doc.defaultView.confirm('确认提交答卷吗？'), true); form.submit(); }
    } };
    t.collections.set('iframe,frame', [{ contentDocument: fixture.doc }, { contentDocument: header }]);
    t.jnHandleExam();
    assert.equal(submitted, 0);
    assert.equal(t.getJnContext().exam.phase, 'answered');
    t.advance(2000); t.jnHandleExam();
    assert.equal(submitted, 0);
    t.advance(0); t.jnHandleExam();
    assert.equal(submitted, 1);
    assert.equal(t.getJnContext().exam.phase, 'submitted');
    assert.equal(t.getHandledMaps().length, 0);
    t.advance(15000); t.jnHandleExam();
    assert.match(t.context.location.href, /Layer_CourseInfo/);
});

test('金培考试加载失败或答案不完整时暂停，绝不交卷或记为通过', () => {
    const t = setupJn('/WebTraining14/Web/MyExam/aspNet/ExamMain.aspx');
    t.setJnContext({ courseUrl: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1',
        exam: { id: 'exam-1', phase: 'opened', startedAt: 0 } });
    let submitted = 0; const fixture = jnExamFixture(['']);
    fixture.doc.defaultView = { SubmitExam: () => submitted++ };
    t.collections.set('iframe,frame', [{ contentDocument: fixture.doc }]);
    t.jnHandleExam();
    assert.equal(submitted, 0);
    assert.equal(t.state.enabled, false);
    assert.equal(t.getHandledMaps().length, 0);
});

test('平台原生check_tx仍判定未答时不触发SubmitExam', () => {
    const t = setupJn('/WebTraining14/Web/MyExam/aspNet/ExamMain.aspx');
    t.setJnContext({ courseUrl: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1', exam: { id: 'exam-1', phase: 'opened', startedAt: 0 } });
    const fixture = jnExamFixture(); let submitted = 0;
    fixture.doc.defaultView = { total: 3, check_tx: () => false, SubmitExam: () => submitted++ };
    fixture.doc.querySelector = selector => selector === '#frmExam' ? { submit: () => submitted++ } : null;
    t.collections.set('iframe,frame', [{ contentDocument: fixture.doc }]);
    t.jnHandleExam(); t.advance(2000); t.jnHandleExam(); t.advance(0);
    assert.equal(submitted, 0); assert.equal(t.state.enabled, false);
    assert.notEqual(t.getJnContext().exam.phase, 'submitted');
});

test('只调用SubmitExam但未真正提交原生表单时，不记录已交卷，也不离开试卷', () => {
    const t = setupJn('/WebTraining14/Web/MyExam/aspNet/ExamMain.aspx');
    t.setJnContext({ courseUrl: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1', exam: { id: 'exam-1', phase: 'opened', startedAt: 0 } });
    const fixture = jnExamFixture(); let opened = 0;
    fixture.doc.defaultView = { SubmitExam: () => opened++ };
    fixture.doc.querySelector = selector => selector === '#frmExam' ? { submit() {} } : null;
    t.collections.set('iframe,frame', [{ contentDocument: fixture.doc }]);
    t.jnHandleExam(); t.advance(2000); t.jnHandleExam(); t.advance(0);
    assert.equal(opened, 1); assert.equal(t.getJnContext().exam.phase, 'submitting');
    assert.equal(t.getJnContext().exam.submissionObserved, undefined);
    t.advance(16000); t.jnHandleExam();
    assert.equal(t.state.enabled, false); assert.match(t.context.location.href, /ExamMain/);
});

test('金培考试开启拟人抖动时，按题步进间隔作答且总等待时间符合题目数要求', () => {
    const t = setupJn('/WebTraining14/Web/MyExam/aspNet/ExamMain.aspx');
    t.CONFIG.jnAutoExam = true;
    t.CONFIG.enableJitter = true;
    t.CONFIG.jnExamQuestionDelayMin = 2000;
    t.CONFIG.jnExamQuestionDelayMax = 5000;
    t.CONFIG.jnExamWaitPerQuestionMin = 8;
    t.CONFIG.jnExamWaitPerQuestionMax = 15;
    t.setJnContext({
        courseUrl: 'https://jnftc.jnbank.com.cn/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=course-1',
        exam: { id: 'exam-1', phase: 'opened', startedAt: 0 }
    });
    const fixture = jnExamFixture();
    let submitted = 0;
    const form = { submit() { submitted++; } };
    fixture.doc.querySelector = selector => selector === '#frmExam' ? form : null;
    fixture.doc.defaultView = {
        total: 3,
        check_tx: number => fixture.optionsByNumber.get(String(number)).some(o => o.checked),
        confirm: () => true
    };
    const header = {
        querySelectorAll: () => [],
        defaultView: {
            SubmitExam() { form.submit(); }
        }
    };
    t.collections.set('iframe,frame', [{ contentDocument: fixture.doc }, { contentDocument: header }]);

    // 第1次：进入 answering 状态并设定总等待（3题 * 8~15秒 = 24~45秒）
    t.jnHandleExam();
    const exam = t.getJnContext().exam;
    assert.equal(exam.phase, 'answering');
    assert.equal(exam.answerIndex, 0);
    assert.ok(exam.totalWaitSeconds >= 24 && exam.totalWaitSeconds <= 45);

    // 步进作答第1题
    t.advance(5500);
    t.jnHandleExam();
    assert.equal(t.getJnContext().exam.answerIndex, 1);
    assert.equal(fixture.optionsByNumber.get('1').some(o => o.checked), true);

    // 步进作答第2题
    t.advance(5500);
    t.jnHandleExam();
    assert.equal(t.getJnContext().exam.answerIndex, 2);

    // 步进作答第3题
    t.advance(5500);
    t.jnHandleExam();
    assert.equal(t.getJnContext().exam.phase, 'answered');

    // 处于拟人复查等待，未达总时长不提交
    t.advance(1000);
    t.jnHandleExam();
    assert.equal(submitted, 0);

    // 达到总时长后提交
    t.advance(exam.totalWaitSeconds * 1000);
    t.jnHandleExam();
    t.advance(0);
    assert.equal(submitted, 1);
    assert.equal(t.getJnContext().exam.phase, 'submitted');
});

test('防检测原生函数伪装：重写函数 toString 和原型链完全符合原生特征', () => {
    const t = setup();
    const dummy = function myNative() {};
    const hooked = t.makeNativeFunction(function () { return 'ok'; }, dummy, 'myNative');
    assert.equal(hooked(), 'ok');
    assert.equal(hooked.name, 'myNative');
    assert.equal(hooked.toString(), 'function myNative() { [native code] }');
    assert.equal(hooked.toString.name, 'toString');
});

test('防检测跨标签锁与存储脱敏隐藏：query 过滤内部锁标识', async () => {
    const t = setup();
    const queryResult = {
        held: [{ name: '_kme_course_1' }, { name: 'other_user_lock' }],
        pending: [{ name: 'jinpei_lock' }]
    };
    t.context.navigator.locks = {
        query: async () => queryResult
    };
    t.enableLockStealth();
    const result = await t.context.navigator.locks.query();
    assert.deepEqual(result.held, [{ name: 'other_user_lock' }]);
    assert.deepEqual(result.pending, []);
});

test('首次识别账号清除未归属的旧进度，保留平台登录和界面偏好', () => {
    const t = setup([['accountId', 'account-a'], ['_kme_m_progress', '旧进度']], [
        ['_kme_h_maps', '["old-map"]'], ['_kme_selected_tasks', '{"mode":"ids","ids":["old-map"]}'],
        ['_kme_course_outcome_old', '{}'], ['_kme_concurrency', '3'], ['platform-data', 'keep']]);
    assert.equal(t.getHandledMaps().length, 0);
    assert.equal(t.storage.has('_kme_m_progress'), false);
    assert.equal(t.localStorageMap.has('_kme_course_outcome_old'), false);
    assert.equal(t.getTaskSelection().mode, 'all');
    assert.equal(t.getConcurrencySetting(), 3);
    assert.equal(t.storage.get('accountId'), 'account-a');
    assert.equal(t.localStorageMap.get('platform-data'), 'keep');
    assert.equal(t.state.enabled, false);
});

test('同账号刷新保留进度，token 轮换不当作换号', () => {
    const t = setup([['accountId', 'account-a']]);
    t.markMapHandled('map-a');
    const next = setup([...t.storage], [], { storage: t.localStorageMap });
    assert.deepEqual(Array.from(next.getHandledMaps()), ['map-a']);
    next.storage.set('token', 'new-token');
    assert.equal(next.syncAccountContext(), true);
    assert.deepEqual(Array.from(next.getHandledMaps()), ['map-a']);
});

test('运行中换账号会取消操作并清理内存、已处理课程和任务选择', () => {
    const t = setup([['accountId', 'account-a']]);
    t.state.enabled = true; t.state.currentCourse = '旧课程';
    t.markMapHandled('map-a'); t.markCourseHandled('map-a', 'course-a');
    t.saveTaskCatalog([{ key: 'map-a', title: '旧任务' }]);
    let clicked = false; t.setManagedTimeout(() => { clicked = true; }, 1000);
    t.storage.set('accountId', 'account-b');
    assert.equal(t.syncAccountContext(), false);
    t.advance(2000);
    assert.equal(clicked, false);
    assert.equal(t.state.enabled, false);
    assert.equal(t.state.currentCourse, '');
    assert.equal(t.getHandledMaps().length, 0);
    assert.equal(t.getHandledCourses().length, 0);
    assert.equal(t.getTaskCatalog().length, 0);
    assert.equal(t.getTaskSelection().mode, 'all');
});

test('其他窗口换号时旧窗口停止，不覆盖新账号身份或进度', () => {
    const a = setup([['accountId', 'account-a']]);
    const b = setup([['accountId', 'account-b']], [], { storage: a.localStorageMap });
    b.markMapHandled('map-b');
    b.localStorageMap.set('_kme_running_state', 'true');
    const identity = b.localStorageMap.get('_kme_account_identity');
    a.state.enabled = true;
    assert.equal(a.syncAccountContext(), false);
    assert.equal(a.state.enabled, false);
    assert.equal(a.localStorageMap.get('_kme_account_identity'), identity);
    assert.equal(a.localStorageMap.get('_kme_running_state'), 'true');
    assert.equal(b.getHandledMaps().includes('map-b'), true);
    assert.equal(a.syncAccountContext(), false);
});

test('进入易知登录页立即清理旧学习状态，不等待新账号开始播放', async () => {
    const t = setup([['accountId', 'account-a']]);
    t.markMapHandled('old-map');
    t.context.location.href = 'https://pc.kmelearning.com/jsncxyslhs/home/login';
    await t.mainLoop();
    assert.equal(t.getHandledMaps().length, 0);
    assert.equal(t.localStorageMap.get('_kme_account_identity'), 'logged-out');
    assert.equal(t.state.enabled, false);
});

test('停留在旧登录页的窗口不会反复清掉另一个窗口新登录账号的进度', () => {
    const login = setup([], [], { url: 'https://pc.kmelearning.com/home/login' });
    const loggedIn = setup([['accountId', 'account-b']], [], { storage: login.localStorageMap });
    loggedIn.markMapHandled('new-map');
    assert.equal(login.syncAccountContext(), false);
    assert.equal(loggedIn.getHandledMaps().includes('new-map'), true);
    assert.notEqual(loggedIn.localStorageMap.get('_kme_account_identity'), 'logged-out');
});

function taskCardsFor(t) {
    const cards = ['1', '2'].map(id => ({ innerText: '学习地图' + id + '\n进行中', offsetParent: {}, clicks: 0,
        getAttribute: name => name === 'data-tp-id' ? id : null, click() { this.clicks++; } }));
    const original = t.context.document.querySelectorAll.bind(t.context.document);
    t.context.document.querySelectorAll = selector => selector === 'div.group.cursor-pointer, .grid > div' ? cards : original(selector);
    t.context.location.href = 'https://pc.kmelearning.com/home/my/myTask';
    return cards;
}

test('首次无设置时默认全选，已有手动选择保持不变', () => {
    const t = setup(); t.localStorageMap.delete(t.STORAGE_KEYS.selectedTasks);
    assert.equal(t.getTaskSelection().mode, 'all');
    t.saveTaskSelection({ mode: 'ids', ids: ['2'] });
    assert.equal(t.isTaskKeySelected('1'), false);
    assert.equal(t.isTaskKeySelected('2'), true);
});

test('多个窗口同时分配任务会分流到不同地图，已选范围和忙碌冷却都生效', async () => {
    const { a, b } = twoWindows();
    const ca = taskCardsFor(a), cb = taskCardsFor(b);
    await Promise.all([a.mainLoop(), b.mainLoop()]);
    a.advance(1000); b.advance(1000);
    assert.deepEqual(ca.map(c => c.clicks), [1, 0]);
    assert.deepEqual(cb.map(c => c.clicks), [0, 1]);
    assert.equal(a.getActiveTabs()[a.TAB_ID].mapId, '1');
    assert.equal(b.getActiveTabs()[b.TAB_ID].mapId, '2');
    a.localStorageMap.set('_kme_task_busy_1', '20000');
    assert.equal(a.pickNextTask(a.getTaskCatalog()).key, '2');
});

test('同一地图的剩余课程被占用时转到其他任务，并发满时继续等待', async () => {
    for (const concurrency of [1, 2]) {
        const { a, b } = twoWindows(); a.setConcurrencySetting(concurrency);
        a.saveTaskCatalog([{ key: '1', title: '任务一' }, { key: '2', title: '任务二' }]);
        assert.equal(await b.tryClaimCourseSlot('课程一', '课程一', '1'), true);
        a.fixture.video = null;
        a.fixture.courses = [{ innerText: '课程一\n2学时', children: [], offsetParent: {} }];
        await a.mainLoop();
        assert.equal(a.context.location.href.includes('/home/my/myTask'), concurrency === 2);
        assert.equal(a.state.enabled, true);
    }
});

test('跨任务也共用课程并发上限，不按地图各自计算名额', async () => {
    const { a, b } = twoWindows(); a.setConcurrencySetting(1);
    assert.equal(await a.tryClaimCourseSlot('101', '课一', '1'), true);
    assert.equal(await b.tryClaimCourseSlot('201', '课二', '2'), false);
});

test('同时请求多开只打开一个待注册窗口，且从任务中心领取', async () => {
    const { a, b } = twoWindows(); a.setConcurrencySetting(3);
    await Promise.all([a.spawnTaskWorker(), b.spawnTaskWorker()]);
    assert.equal(a.openedUrls.length + b.openedUrls.length, 1);
    assert.equal([...a.openedUrls, ...b.openedUrls][0], a.CONFIG.myTaskUrl);
});

test('子窗口学完当前地图后，存在其他任务则继续而不关闭', async () => {
    const t = setup(); t.context.window.opener = {};
    t.saveTaskCatalog([{ key: '1', title: '任务一' }, { key: '2', title: '任务二' }]);
    t.fixture.video = null; t.fixture.courses = [{ innerText: '已完成课程\n100%', children: [], offsetParent: {} }];
    await t.mainLoop(); t.advance(2500);
    assert.equal(t.context.window.closed, false);
    assert.equal(t.context.location.href, t.CONFIG.myTaskUrl);
});

test('任务列表接口分页读取并缓存，失败或超时保留旧列表且不暂停视频', async () => {
    const t = setup(); let calls = 0;
    t.context.window.webpackChunkwmy_pc = { push(chunk) { chunk[2](id => id === 90025 ? { Z: { async post(_url, body) {
        calls++;
        return { code: '1000', data: { total: 2, records: [{ taskType: 1, taskId: String(body.pageNo), taskName: '任务' + body.pageNo }] } };
    } } } : { kT: '/web-student' }); } };
    await t.loadTaskCatalog(true);
    assert.equal(calls, 2); assert.equal(t.getTaskCatalog().length, 2);
    t.context.window.webpackChunkwmy_pc = { push(chunk) { chunk[2](id => id === 90025 ? { Z: { post() { return new Promise(() => {}); } } } : { kT: '/web-student' }); } };
    const pending = t.loadTaskCatalog(true); t.advance(5000); await pending;
    assert.equal(t.getTaskCatalog().length, 2);
    assert.equal(t.state.enabled, true);
    assert.equal(t.fixture.video.paused, false);
});

test('平台 React 数据中的小节和课程 ID 优先于标题，改名不改变小节键', () => {
    const t = setup();
    t.current.__reactInternalInstance$test = { memoizedProps: {}, return: { memoizedProps: { section: { id: '201', courseId: '101' } } } };
    t.next.__reactFiber$test = { memoizedProps: { section: { id: '202', courseId: '101' } } };
    const before = t.getSubVideoKey(t.current);
    assert.equal(t.getCurrentCourseId(), '101', 'study 路由中的地图 ID 不能用作课程 ID');
    assert.equal(before, '1::101::201');
    assert.notEqual(before, t.getSubVideoKey(t.next));
    t.state.currentCourse = '改名课程'; t.current.innerText = '改名小节\n00:01:40';
    assert.equal(t.getSubVideoKey(t.current), before);
});

test('同名不同 ID 的课程结果互不污染，旧标题缓存也不跳过另一门课程', () => {
    const t = setup(); t.state.currentCourse = '同名课程';
    t.current.getAttribute = name => name === 'data-course-id' ? '101' : null;
    t.saveCourseOutcome('completed'); t.markCourseHandled('1', '同名课程');
    const other = { innerText: '同名课程\n2学时', getAttribute: name => name === 'data-course-id' ? '102' : null };
    assert.equal(t.getCourseDisposition(other, '1'), 'pending');
    assert.deepEqual(Array.from(t.getCourseOutcomes()[0].aliases), ['101']);
});

test('同名不同 ID 可并发，改名后仍不能重复领取同一个 ID', async () => {
    const { a, b } = twoWindows();
    assert.equal(await a.tryClaimCourseSlot('101', '同名课程', '1'), true);
    assert.equal(await b.tryClaimCourseSlot('102', '同名课程', '1'), true);
    b.unregisterTab(); await settleLocks();
    assert.equal(await b.tryClaimCourseSlot('101', '改名课程', '1'), false);
});

test('手动切换到另一课程会释放旧 ID，再按新 ID 领取', async () => {
    const t = setup(); t.current.getAttribute = name => name === 'data-course-id' ? '102' : null;
    assert.equal(await t.tryClaimCourseSlot('101', '旧课', '1'), true);
    t.setManagedTimeout(() => { t.next.clicks++; }, 1000);
    await t.mainLoop(); await settleLocks();
    assert.equal(t.getActiveTabs()[t.TAB_ID], undefined);
    t.advance(1000);
    assert.equal(t.next.clicks, 0, '旧课程的延迟切节不能影响手动切换后的课程');
    await t.mainLoop(); await settleLocks();
    assert.equal(t.getActiveTabs()[t.TAB_ID].courseKey, '102');
});

test('任务页只点击选中的地图，空选择不会开始自动流转', async () => {
    for (const ids of [[], ['2']]) {
        const t = setup(); t.context.location.href = 'https://pc.kmelearning.com/home/my/myTask';
        const cards = ['1', '2'].map(id => ({ innerText: '学习地图' + id + '\n进行中', offsetParent: {}, clicks: 0,
            getAttribute: name => name === 'data-tp-id' ? id : null, click() { this.clicks++; } }));
        const original = t.context.document.querySelectorAll.bind(t.context.document);
        t.context.document.querySelectorAll = selector => selector === 'div.group.cursor-pointer, .grid > div' ? cards : original(selector);
        t.saveTaskSelection({ mode: 'ids', ids });
        await t.handleMyTaskPage(); t.advance(1000);
        assert.equal(cards[0].clicks, 0);
        assert.equal(cards[1].clicks, ids.length ? 1 : 0);
        if (!ids.length) assert.equal(t.state.enabled, false);
    }
});

test('任务选择跨窗口共享，手动进入未勾选地图会暂停', async () => {
    const { a, b } = twoWindows();
    a.saveTaskSelection({ mode: 'ids', ids: ['2'] });
    assert.deepEqual(Array.from(b.getTaskSelection().ids), ['2']);
    await b.mainLoop();
    assert.equal(b.state.enabled, false);
    assert.equal(b.fixture.video.plays, 0);
    assert.match(b.state.statusText, /未勾选/);
});

function platformRecords(t, learnedSeconds) {
    const fixture = { learnedSeconds, busy: false, mode: 'catalog', recordClicks: 0, catalogClicks: 0 };
    const original = t.context.document.querySelectorAll.bind(t.context.document);
    const recordTab = { innerText: '记录', offsetParent: {}, getAttribute() { return String(fixture.mode === 'record'); }, click() { fixture.mode = 'record'; fixture.recordClicks++; } };
    const catalogTab = { innerText: 'Tab 1 of 3\n目录', childNodes: [{ nodeType: 1 }, { nodeType: 3, textContent: '目录' }], offsetParent: {}, getAttribute() { return String(fixture.mode === 'catalog'); }, click() { if (!fixture.blockCatalog) fixture.mode = 'catalog'; fixture.catalogClicks++; } };
    t.context.document.querySelectorAll = selector => {
        if (selector === '[role="tab"], .ant5-tabs-tab-btn, .ant-tabs-tab-btn') return [catalogTab, recordTab];
        if (selector.startsWith('[class*="course-records"]')) {
            const n = fixture.learnedSeconds;
            const clock = n === null ? '未知' : [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map(v => String(v).padStart(2, '0')).join(':');
            return fixture.mode === 'record' ? [{ innerText: '学习总时长\n' + clock, offsetParent: {}, querySelector() { return fixture.busy ? {} : null; } }] : [];
        }
        if (selector.startsWith('div.group.cursor-pointer,') && fixture.mode === 'record') return [];
        return original(selector);
    };
    return fixture;
}

test('异常跳过与待考试不计入已完成，已打勾的平台状态优先', async () => {
    const t = setup(); t.state.currentCourse = '异常课程';
    t.markSubVideoFailed('1::异常课程::当前小节');
    const item = { innerText: '异常课程\n2学时', children: [], offsetParent: {} };
    assert.equal(t.getCourseDisposition(item, '1'), 'skipped');
    t.state.currentCourse = '考试课程'; t.saveCourseOutcome('exam');
    assert.equal(t.getCourseDisposition({ ...item, innerText: '考试课程\n2学时' }, '1'), 'exam');
    assert.equal(t.getCourseDisposition({ ...item, querySelector() { return {}; } }, '1'), 'completed');
    t.fixture.video = null; t.fixture.courses = [item, { ...item, innerText: '考试课程\n2学时' }];
    await t.mainLoop();
    assert.match(t.storage.get(t.STORAGE_KEYS.mapProgress), /0 \/ 2 门 \(0%\).*异常 1.*待考试 1/);
    assert.match(t.state.statusText, /本轮处理结束/);
    assert.doesNotMatch(t.state.statusText, /全部学完|确认完成/);
});

test('课程全部为异常跳过时保存异常结果，绝不标为已完成', async () => {
    const t = setup(); t.state.currentCourse = '异常课程'; t.fixture.items = [t.current];
    t.markSubVideoFailed('1::异常课程::当前小节');
    t.switchToNextSubVideoOrCourse();
    assert.equal(t.getCourseOutcomes()[0].status, 'skipped');
    assert.equal(t.getCourseOutcomes()[0].failedSubKeys.length, 1);
    assert.match(t.state.statusText, /异常跳过/);
});

test('重试异常只清理异常和旧缓存，保留已完成及待考试，其他窗口同步缓存', async () => {
    const { a, b } = twoWindows();
    a.state.currentCourse = '异常课程'; a.markSubVideoFailed('1::异常课程::小节一'); a.markCourseHandled('1', '异常课程');
    a.state.currentCourse = '完成课程'; a.saveCourseOutcome('completed'); a.markCourseHandled('1', '完成课程');
    a.state.currentCourse = '考试课程'; a.saveCourseOutcome('exam'); a.markCourseHandled('1', '考试课程');
    a.markMapHandled('1');
    b.storage.set(b.STORAGE_KEYS.failedVideos, JSON.stringify(['1::异常课程::小节一']));
    b.storage.set(b.STORAGE_KEYS.handledCourses, JSON.stringify(['1::异常课程']));
    b.state.enabled = false;
    assert.equal(a.retrySkippedCourses(), true);
    await b.mainLoop();
    assert.equal(a.getCourseOutcomes().length, 2);
    assert.equal(a.getFailedSubVideos().length, 0);
    assert.equal(b.getFailedSubVideos().length, 0);
    assert.equal(b.isCourseHandled('1', '异常课程'), false);
    assert.equal(a.isCourseHandled('1', '完成课程'), true);
    assert.equal(a.isCourseHandled('1', '考试课程'), true);
    assert.equal(a.getHandledMaps().includes('1'), false);
    assert.equal(a.state.enabled, false);
});

test('其他窗口仍在学习时拒绝清理异常记录', async () => {
    const { a, b } = twoWindows();
    a.state.currentCourse = '异常课程'; a.markSubVideoFailed('1::异常课程::小节一');
    assert.equal(await b.tryClaimCourseSlot('c2', '其他课程', '1'), true);
    assert.equal(a.retrySkippedCourses(), false);
    assert.equal(a.getFailedSubVideos().length, 1);
});

test('重试同时清除旧版未核验课程所属地图的处理缓存，允许重新进入', () => {
    const t = setup();
    t.state.currentCourse = '异常课程'; t.markSubVideoFailed('1::异常课程::小节一');
    t.markCourseHandled('2', '旧版课程'); t.markMapHandled('1'); t.markMapHandled('2');
    assert.equal(t.retrySkippedCourses(), true);
    assert.equal(t.getHandledMaps().length, 0);
    assert.equal(t.isCourseHandled('2', '旧版课程'), false);
});

test('旧窗口刷新后仍能识别重试代次并清除会话内的异常缓存', async () => {
    const t = setup([
        ['_kme_failed_videos', JSON.stringify(['1::异常课程::小节一'])],
        ['_kme_handled_courses', JSON.stringify(['1::异常课程'])],
        ['_kme_retry_epoch', 'old'],
    ], [['_kme_retry_epoch', 'new']]);
    t.state.enabled = false;
    await t.mainLoop();
    assert.equal(t.getFailedSubVideos().length, 0);
    assert.equal(t.isCourseHandled('1', '异常课程'), false);
    assert.equal(t.storage.get(t.STORAGE_KEYS.retryEpoch), 'new');
});

test('整课累计时长达标仍不跳过未打勾小节，等待超时回退原有有限重播', async () => {
    const t = setup(); const records = platformRecords(t, 300);
    t.reconcileBeforeReplay(t.current, t.fixture.items); t.advance(1000);
    assert.equal(records.mode, 'catalog');
    assert.equal(t.fixture.video.plays, 0); assert.equal(t.next.clicks, 0);
    t.advance(30500); await settleLocks();
    assert.equal(t.state.enabled, true);
    assert.equal(t.fixture.video.plays, 1); assert.equal(t.next.clicks, 0);
    assert.match(t.formatDiagnosticLogs(), /回退到原有有限重播/);
});

test('核对记录后打勾延迟到达才切下一节', async () => {
    const t = setup(); platformRecords(t, 300);
    t.reconcileBeforeReplay(t.current, t.fixture.items); t.advance(1000);
    assert.equal(t.next.clicks, 0);
    t.current.completed = true; t.advance(500);
    assert.equal(t.next.clicks, 1);
    assert.equal(t.fixture.video.plays, 0);
});

test('正常播放和已打勾连播不会打开记录页', async () => {
    const t = setup(); const records = platformRecords(t, 300);
    t.fixture.video.currentTime = 20;
    await t.mainLoop();
    assert.equal(records.recordClicks, 0);
    t.current.completed = true;
    t.switchToNextSubVideoOrCourse();
    assert.equal(t.next.clicks, 1);
    assert.equal(records.recordClicks, 0);
});

test('记录有时长缺口时仍最多重播三次，不延长原来的重试上限', async () => {
    const t = setup(); const records = platformRecords(t, 20);
    for (let i = 0; i < 4; i++) {
        t.reconcileBeforeReplay(t.current, t.fixture.items); t.advance(1500); await settleLocks();
    }
    assert.equal(t.fixture.video.plays, 3);
    assert.equal(t.state.enabled, false);
    assert.equal(records.mode, 'catalog');
    assert.match(t.formatDiagnosticLogs(), /仍有时长缺口/);
});

test('记录加载失败返回目录再按原规则重播，不把未知记录当成达标', async () => {
    const t = setup(); const records = platformRecords(t, null);
    t.reconcileBeforeReplay(t.current, t.fixture.items); t.advance(6000); await settleLocks();
    assert.equal(records.mode, 'catalog');
    assert.equal(t.fixture.video.plays, 1); assert.equal(t.next.clicks, 0);
});

test('返回目录失败时有限等待后暂停，不对隐藏小节操作或无限卡住', async () => {
    const t = setup(); const records = platformRecords(t, 20); records.blockCatalog = true;
    const original = t.context.document.querySelectorAll;
    t.context.document.querySelectorAll = selector => selector.startsWith('div.group.cursor-pointer,') ? t.fixture.items : original(selector);
    t.reconcileBeforeReplay(t.current, t.fixture.items); t.advance(6000); await settleLocks();
    assert.equal(t.state.enabled, false);
    assert.equal(t.fixture.video.plays, 0); assert.equal(t.next.clicks, 0);
    assert.match(t.state.statusText, /目录加载超时/);
});

test('核对记录期间暂停、路由改变或播放器更换都取消旧恢复操作', async () => {
    for (const action of ['pause', 'route', 'video']) {
        const t = setup(); platformRecords(t, 20);
        t.reconcileBeforeReplay(t.current, t.fixture.items);
        if (action === 'pause') t.pauseAutomation('手动暂停');
        if (action === 'route') t.context.location.href += '?changed';
        if (action === 'video') t.fixture.video = { ...t.fixture.video };
        t.advance(6000); await settleLocks();
        assert.equal(t.fixture.video.plays, 0); assert.equal(t.next.clicks, 0);
    }
});

test('核对结束后活动小节已更换，不重播或跳过旧小节', async () => {
    const t = setup(); platformRecords(t, 20);
    t.reconcileBeforeReplay(t.current, t.fixture.items);
    t.next.innerText = '新小节\n00:01:40';
    t.next.querySelector = () => ({ innerText: '新小节' });
    t.next.className = 'text-primary'; t.current.className = '';
    t.advance(1000); await settleLocks();
    assert.equal(t.fixture.video.plays, 0); assert.equal(t.next.clicks, 0);
    assert.equal(t.state.isActionPending, false);
});
function twoWindows(concurrency = 2) {
    const shared = { storage: new Map(), locks: createLockManager() };
    const a = setup([], [], shared);
    const b = setup([], [], shared);
    a.setConcurrencySetting(concurrency);
    return { a, b, shared };
}

test('两个窗口同时领取同一课程，只有一个成功', async () => {
    const { a, b } = twoWindows();
    const results = await Promise.all([
        a.tryClaimCourseSlot('c1', '课程一', '1'),
        b.tryClaimCourseSlot('c1', '课程一', '1'),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(Object.keys(a.getActiveTabs()).length, 1);
});

test('不同课程同时领取，独立心跳互不覆盖，暂停仅删除自己的记录', async () => {
    const { a, b } = twoWindows();
    assert.deepEqual(await Promise.all([
        a.tryClaimCourseSlot('c1', '课程一', '1'),
        b.tryClaimCourseSlot('c2', '课程二', '1'),
    ]), [true, true]);
    a.registerTabHeartbeat('错误的路由ID', '课程一', '1');
    b.registerTabHeartbeat('c2', '课程二', '1');
    assert.equal(a.getActiveTabs()[a.TAB_ID].courseKey, 'c1');
    assert.equal(Object.keys(a.getActiveTabs()).length, 2);
    a.pauseAutomation('手动暂停');
    assert.equal(Object.keys(b.getActiveTabs()).length, 1);
    assert.equal(b.getActiveTabs()[b.TAB_ID].courseKey, 'c2');
    await settleLocks();
    assert.equal(await a.tryClaimCourseSlot('c1', '课程一', '1'), false);
});

test('心跳过期仍持有课程锁，退出释放后其他窗口才能领取', async () => {
    const { a, b } = twoWindows();
    assert.equal(await a.tryClaimCourseSlot('c1', '课程一', '1'), true);
    a.advance(121000); b.advance(121000);
    assert.equal(Object.keys(b.getActiveTabs()).length, 0);
    assert.equal(await b.tryClaimCourseSlot('c1', '课程一', '1'), false);
    a.unregisterTab();
    await settleLocks();
    assert.equal(await b.tryClaimCourseSlot('c1', '课程一', '1'), true);
});

test('冻结窗口心跳过期也不能突破并发上限', async () => {
    const { a, b } = twoWindows(1);
    assert.equal(await a.tryClaimCourseSlot('c1', '课程一', '1'), true);
    a.advance(121000); b.advance(121000);
    assert.equal(await b.tryClaimCourseSlot('c2', '课程二', '1'), false);
    a.unregisterTab(); await settleLocks();
    assert.equal(await b.tryClaimCourseSlot('c2', '课程二', '1'), true);
});

test('领取等待期间暂停或跳转，不留下课程锁和占用记录', async () => {
    for (const navigate of [false, true]) {
        const { a, b } = twoWindows();
        const pending = a.tryClaimCourseSlot('c1', '课程一', '1');
        if (navigate) a.context.location.href += '?changed=1';
        else a.pauseAutomation('手动暂停');
        assert.equal(await pending, false);
        assert.equal(Object.keys(b.getActiveTabs()).length, 0);
        assert.equal(await b.tryClaimCourseSlot('c1', '课程一', '1'), true);
    }
});

test('不支持锁或存储不可写时安全暂停，不点击课程、不恢复播放', async () => {
    for (const unavailableLocks of [false, true]) {
        const t = setup();
        t.fixture.video.paused = true;
        if (unavailableLocks) delete t.context.navigator.locks;
        else t.context.localStorage.setItem = () => { throw new Error('quota exceeded'); };
        await t.mainLoop();
        assert.equal(t.state.enabled, false);
        assert.equal(t.fixture.video.plays, 0);
        assert.equal(t.next.clicks, 0);
        assert.equal(Object.keys(t.getActiveTabs()).length, 0);
    }
});

test('两个目录同时调度，分别进入不同课程；重复轮询不会重复领取或点击', async () => {
    const { a, b } = twoWindows();
    function courses() {
        return ['课程一', '课程二'].map(name => ({
            innerText: name + '\n2学时', children: [], offsetParent: {}, clicks: 0,
            click() { this.clicks++; },
        }));
    }
    a.fixture.video = null; b.fixture.video = null;
    a.fixture.courses = courses(); b.fixture.courses = courses();
    const first = a.mainLoop();
    await Promise.all([first, a.mainLoop(), b.mainLoop()]);
    a.advance(1000); b.advance(1000);
    assert.notEqual(a.state.currentCourse, b.state.currentCourse);
    assert.equal(a.fixture.courses.reduce((n, c) => n + c.clicks, 0), 1);
    assert.equal(b.fixture.courses.reduce((n, c) => n + c.clicks, 0), 1);
    assert.equal(Object.keys(a.getActiveTabs()).length, 2);
});

test('直接进入已被占用的播放器时暂停，防止绕过目录领取', async () => {
    const { a, b } = twoWindows();
    a.state.currentCourse = '课程一'; b.state.currentCourse = '课程一';
    assert.equal(await a.tryClaimCourseSlot('c1', '课程一', '1'), true);
    await b.mainLoop();
    assert.equal(b.state.enabled, false);
    assert.equal(b.fixture.video.paused, true);
    assert.equal(a.getActiveTabs()[a.TAB_ID].courseKey, 'c1');
});

test('课程全部完成后释放课程锁与名额', async () => {
    const { a, b } = twoWindows(1);
    assert.equal(await a.tryClaimCourseSlot('c1', '课程一', '1'), true);
    a.fixture.items = [a.current]; a.current.completed = true;
    a.switchToNextSubVideoOrCourse();
    await settleLocks();
    assert.equal(await b.tryClaimCourseSlot('c2', '课程二', '1'), true);
});

test('降低并发数后，冻结窗口仍占用名额，不能新开课程', async () => {
    const { a, b, shared } = twoWindows(2);
    const c = setup([], [], shared);
    assert.equal(await a.tryClaimCourseSlot('c1', '课程一', '1'), true);
    assert.equal(await b.tryClaimCourseSlot('c2', '课程二', '1'), true);
    a.unregisterTab(); await settleLocks();
    c.setConcurrencySetting(1);
    b.advance(121000); c.advance(121000);
    assert.equal(await c.tryClaimCourseSlot('c3', '课程三', '1'), false);
});

test('同步超时重播末尾30秒，重播3次仍未打勾才暂停', async () => {
    const t = setup();
    for (let attempt = 1; attempt <= 3; attempt++) {
        t.fixture.video.currentTime = 100; t.fixture.video.ended = true;
        await t.mainLoop(); t.advance(16500); await new Promise(resolve => setImmediate(resolve));
        assert.equal(t.state.enabled, true);
        assert.equal(t.state.isSwitching, false);
        assert.equal(t.fixture.video.currentTime, 70);
        assert.equal(t.fixture.video.plays, attempt);
    }
    t.fixture.video.currentTime = 100; t.fixture.video.ended = true;
    await t.mainLoop(); t.advance(16500); await new Promise(resolve => setImmediate(resolve));
    assert.equal(t.next.clicks, 0);
    assert.equal(t.state.enabled, false);
    assert.equal(t.fixture.video.paused, true);
    assert.equal(t.storage.has('jinpei_auto_running'), false);
    assert.equal(t.timers.size, 0);
    assert.equal(t.fixture.video.plays, 3);
    assert.match(t.context.document.getElementById('jinpei-hud-status').innerText, /重播 3 次后仍未打勾/);
});

function simulatePlatformEndReset(t) {
    const listeners = new Map();
    const video = t.fixture.video;
    video.addEventListener = (name, fn) => listeners.set(name, fn);
    video.currentTime = 98; video.readyState = 4;
    t.observeVideoPlayback(video);
    // 与实际日志一致：网站先处理 ended，将进度归零，脚本回调随后运行。
    video.currentTime = 0; video.ended = false; video.paused = true;
    listeners.get('ended')();
    return video;
}

test('完成判断只认明确对勾或状态，不把图标颜色和课程标题当完成', () => {
    const t = setup();
    const item = { innerText: '100%客户满意度\n0%', querySelector: () => null };
    assert.equal(t.isItemCompleted(item), false);
    item.innerText = '课程\n未完成';
    item.querySelector = selector => selector.startsWith('svg path') ? {} : null;
    assert.equal(t.isItemCompleted(item), false);
    item.innerText = '课程\n100%'; assert.equal(t.isItemCompleted(item), true);
    item.innerText = '课程\n已完成'; assert.equal(t.isItemCompleted(item), true);
    item.innerText = '课程\n0%';
    item.querySelector = selector => selector.startsWith('[data-icon="check"]') ? {} : null;
    assert.equal(t.isItemCompleted(item), true);
});

test('同步等待中切换到新小节，旧回调不重播或递增新小节重试', () => {
    const t = setup(); t.switchToNextSubVideoOrCourse();
    t.next.getAttribute = name => name === 'data-chapter-id' ? 'new-section' : null;
    t.current.className = ''; t.next.className = 'text-primary'; t.fixture.video.currentTime = 20;
    t.advance(16000);
    assert.equal(t.fixture.video.currentTime, 20);
    assert.equal(t.fixture.video.plays, 0);
    assert.equal(t.state.syncRetryCount, 0);
    assert.equal(t.state.isSwitching, false);
    assert.equal(t.state.enabled, true);
    assert.match(t.formatDiagnosticLogs(), /取消旧同步等待/);
});

test('复用同一个播放器切小节或换源，旧重播任务不播放新媒体', () => {
    for (const kind of ['section', 'source']) {
        const t = setup(); t.fixture.video.readyState = 1;
        t.replayVideoTail(t.current);
        if (kind === 'section') {
            t.next.getAttribute = name => name === 'data-chapter-id' ? 'new-section' : null;
            t.current.className = ''; t.next.className = 'text-primary';
        }
        else t.fixture.video.src = 'new-media';
        t.fixture.video.currentTime = 20; t.fixture.video.readyState = 4;
        t.advance(16000);
        assert.equal(t.fixture.video.plays, 0);
        assert.equal(t.fixture.video.currentTime, 20);
        assert.equal(t.state.enabled, true);
        assert.equal(t.state.isSwitching, false);
    }
});

test('记录核对期间复用播放器换源，退出旧核对且不操作新媒体', () => {
    const t = setup(); platformRecords(t, 300);
    t.reconcileBeforeReplay(t.current, t.fixture.items);
    t.fixture.video.src = 'new-media'; t.fixture.video.currentTime = 20;
    t.advance(35000);
    assert.equal(t.fixture.video.plays, 0);
    assert.equal(t.fixture.video.currentTime, 20);
    assert.equal(t.state.enabled, true);
    assert.equal(t.state.isActionPending, false);
});

test('平台先切小节再派发旧ended，不给新小节生成完成信号', async () => {
    const t = setup(); const listeners = new Map();
    t.fixture.video.addEventListener = (name, fn, capture) => {
        if (name === 'ended') assert.equal(capture, true);
        listeners.set(name, fn);
    };
    t.fixture.video.currentTime = 98; t.observeVideoPlayback(t.fixture.video);
    t.next.getAttribute = name => name === 'data-chapter-id' ? 'new-section' : null;
    t.current.className = ''; t.next.className = 'text-primary';
    t.fixture.video.currentTime = 0; t.fixture.video.src = 'new-media';
    t.fixture.video.paused = true; listeners.get('ended')();
    await t.mainLoop();
    assert.equal(t.state.isSwitching, false);
    assert.equal(t.fixture.video.plays, 1);
    assert.doesNotMatch(t.formatDiagnosticLogs(), /"endedEvent":true/);
    assert.match(t.formatDiagnosticLogs(), /忽略.*旧结束事件/);
});

function delayedChapter(t, load = true) {
    const original = t.context.document.querySelectorAll.bind(t.context.document);
    let expanded = false; let loaded = false; let clicks = 0;
    const panel = { innerText: '', querySelector: () => null,
        querySelectorAll: () => loaded ? [t.next] : [] };
    const header = { innerText: '第二章',
        getAttribute: name => name === 'aria-expanded' ? String(expanded) : null,
        closest: () => ({ querySelector: () => panel }),
        click() { clicks++; expanded = true; if (load) t.context.setTimeout(() => {
            loaded = true; t.fixture.items.push(t.next);
        }, 1500); } };
    t.context.document.querySelectorAll = selector => selector.includes('collapse-header') ? [header] : original(selector);
    t.fixture.items = [t.current]; t.current.completed = true;
    return { get clicks() { return clicks; } };
}

test('折叠章节异步加载时等待全量目录，不提前把课程标记完成', () => {
    const t = setup(); const chapter = delayedChapter(t);
    t.switchToNextSubVideoOrCourse(); t.advance(1000);
    assert.equal(t.getCourseOutcomes().length, 0);
    assert.equal(t.next.clicks, 0);
    t.advance(2000);
    assert.equal(t.next.clicks, 1);
    assert.equal(t.getCourseOutcomes().length, 0);
    assert.equal(chapter.clicks, 1);
});

test('章节始终加载不出时有限等待后暂停，不登记完成', () => {
    const t = setup(); const chapter = delayedChapter(t, false);
    t.switchToNextSubVideoOrCourse(); t.advance(21000);
    assert.equal(t.state.enabled, false);
    assert.equal(t.getCourseOutcomes().length, 0);
    assert.equal(chapter.clicks, 1);
    assert.match(t.formatDiagnosticLogs(), /章节目录未完整加载/);
});

test('诊断读取目录不展开章节，暂停取消目录等待中的后续操作', () => {
    const t = setup(); const chapter = delayedChapter(t);
    t.observeVideoPlayback(t.fixture.video);
    assert.equal(chapter.clicks, 0);
    t.switchToNextSubVideoOrCourse(); t.pauseAutomation('手动暂停'); t.advance(21000);
    assert.equal(t.next.clicks, 0);
    assert.equal(t.getCourseOutcomes().length, 0);
    assert.equal(t.state.enabled, false);
});

test('ended被平台归零后仍等待打勾，不从0恢复播放，确认完成后连播', async () => {
    const t = setup(); const video = simulatePlatformEndReset(t);
    await t.mainLoop();
    assert.equal(video.plays, 0);
    assert.equal(t.state.isSwitching, true);
    assert.match(t.formatDiagnosticLogs(), /"endedEvent":true/);
    t.current.completed = true; t.advance(4000);
    assert.equal(t.next.clicks, 1);
    assert.equal(video.plays, 0);
});

test('日常日志关闭详细事件输出，结束归零保护仍正常生效', async () => {
    const t = setup(); t.CONFIG.debugPlayback = false; t.clearDiagnosticLogs();
    const video = simulatePlatformEndReset(t);
    await t.mainLoop();
    assert.equal(video.plays, 0);
    assert.equal(t.state.isSwitching, true);
    assert.match(t.formatDiagnosticLogs(), /当前子视频播放结束/);
    assert.doesNotMatch(t.formatDiagnosticLogs(), /播放诊断：(?:播放器出现|进度回退|已记住结束事件)|"previous"|"endedEvent"/);
    t.current.completed = true; t.advance(4000);
    assert.equal(t.next.clicks, 1);
    assert.equal(video.plays, 0);
});

test('平台结束归零后未打勾，等待同步超时才回退到末尾30秒', async () => {
    const t = setup(); const video = simulatePlatformEndReset(t);
    await t.mainLoop(); t.advance(15000);
    assert.equal(video.plays, 0);
    t.advance(1500); await settleLocks();
    assert.equal(video.currentTime, 70);
    assert.equal(video.plays, 1);
    assert.match(t.formatDiagnosticLogs(), /脚本请求末尾回退/);
});

test('剩余不到1秒仍继续正常播放，不提前进入完成检查', async () => {
    const t = setup(); t.fixture.video.currentTime = 99.5;
    await t.mainLoop();
    assert.equal(t.state.isSwitching, false);
    assert.doesNotMatch(t.formatDiagnosticLogs(), /当前子视频播放结束/);
});

test('最后半秒持续卡顿仍触发看门狗，已收到结束事件归零则不会误刷新', () => {
    const stalled = setup();
    stalled.fixture.video.currentTime = 99.5;
    stalled.checkWatchdog(stalled.fixture.video, stalled.current, stalled.fixture.items);
    stalled.advance(31000);
    stalled.checkWatchdog(stalled.fixture.video, stalled.current, stalled.fixture.items);
    assert.equal(stalled.context.location.reloads, 1);

    const ended = setup();
    ended.checkWatchdog(ended.fixture.video, ended.current, ended.fixture.items);
    simulatePlatformEndReset(ended);
    ended.advance(31000);
    ended.checkWatchdog(ended.fixture.video, ended.current, ended.fixture.items);
    assert.equal(ended.context.location.reloads, 0);
});

test('结束信号不跨换源、小节和播放器复用，旧完成等待不处理新播放器', async () => {
    for (const kind of ['source', 'section', 'player', 'pending']) {
        const t = setup(); const video = simulatePlatformEndReset(t);
        if (kind === 'pending') await t.mainLoop();
        if (kind === 'source') video.currentSrc = 'new-source';
        if (kind === 'section') t.fixture.items = [{ ...t.current,
            querySelector(selector) { return selector === '[title], .truncate' ? { innerText: '新小节' } : null; } }];
        if (kind === 'player' || kind === 'pending') t.fixture.video = { ...video, currentTime: 10, paused: false, plays: 0, addEventListener() {} };
        if (kind === 'pending') {
            t.advance(4000);
            assert.equal(t.next.clicks, 0);
            assert.doesNotMatch(t.formatDiagnosticLogs(), /正在检查小节完成情况/);
        } else {
            await t.mainLoop();
            assert.equal(t.state.isSwitching, false);
            assert.doesNotMatch(t.formatDiagnosticLogs(), /"endedEvent":true/);
        }
    }
});

test('手动返回课程目录释放自己旧课程锁，能继续领取另一门课', async () => {
    const t = setup(); assert.equal(await t.tryClaimCourseSlot('old', '旧课程', '1'), true);
    const nextCourse = { innerText: '下一门课程\n2学时', children: [], offsetParent: {}, clicks: 0, click() { this.clicks++; } };
    t.fixture.video = null; t.fixture.courses = [nextCourse];
    await t.mainLoop(); await settleLocks();
    if (!t.state.isActionPending) await t.mainLoop();
    t.advance(1000);
    assert.equal(nextCourse.clicks, 1);
    assert.equal(t.getActiveTabs()[t.TAB_ID].courseKey, '下一门课程');
    assert.match(t.formatDiagnosticLogs(), /释放当前窗口旧课程/);
});

test('异常关闭遗留的独立心跳无真实课程锁时立即清理，不等待120秒', async () => {
    const t = setup([], [['_kme_tab_closed', JSON.stringify({
        courseKey: '目标课程', courseTitle: '目标课程', mapId: '1', timestamp: 0,
    })]]);
    t.fixture.video = null;
    let clicks = 0;
    t.fixture.courses = [{ innerText: '目标课程\n2学时', children: [], offsetParent: {}, click() { clicks++; } }];
    await t.mainLoop(); t.advance(1000);
    assert.equal(clicks, 1);
    assert.equal(t.localStorageMap.has('_kme_tab_closed'), false);
    assert.match(t.formatDiagnosticLogs(), /清理无课程锁的残留窗口记录/);
});

test('真实名额锁占满但心跳已过期时，提示名额锁等待而非断言有窗口学习', async () => {
    const { a, b } = twoWindows(1);
    assert.equal(await a.tryClaimCourseSlot('held', '占用课程', '1'), true);
    a.advance(121000); b.advance(121000);
    b.fixture.video = null;
    b.fixture.courses = [{ innerText: '另一课程\n2学时', children: [], offsetParent: {} }];
    await b.mainLoop();
    assert.match(b.context.document.getElementById('jinpei-hud-status').innerText, /并发名额锁已达上限/);
    assert.doesNotMatch(b.context.document.getElementById('jinpei-hud-status').innerText, /其他窗口.*学习/);
    assert.match(b.formatDiagnosticLogs(), /_kme_course_slot_0/);
});

test('结束后进度归零仍从末尾30秒重播，打勾后清除次数并切换', async () => {
    const t = setup();
    t.switchToNextSubVideoOrCourse(); t.advance(12500); await new Promise(resolve => setImmediate(resolve));
    assert.equal(t.fixture.video.currentTime, 70);
    t.current.completed = true;
    t.switchToNextSubVideoOrCourse();
    assert.equal(t.next.clicks, 1);
    assert.equal(t.storage.has(t.STORAGE_KEYS.completionReplay), false);
});

test('短视频从零重播，未知时长安全暂停', async () => {
    const short = setup(); short.fixture.video.duration = 15;
    short.switchToNextSubVideoOrCourse(); short.advance(12500); await new Promise(resolve => setImmediate(resolve));
    assert.equal(short.fixture.video.currentTime, 0);
    assert.equal(short.fixture.video.plays, 1);
    for (const duration of [NaN, Infinity, 0]) {
        const t = setup(); t.fixture.video.duration = duration;
        t.switchToNextSubVideoOrCourse(); t.advance(12500); await new Promise(resolve => setImmediate(resolve));
        assert.equal(t.state.enabled, false);
        assert.equal(t.next.clicks, 0);
    }
});

test('刷新后保留重播次数，不开始第4次重播', async () => {
    const first = setup();
    first.switchToNextSubVideoOrCourse(); first.advance(12500); await new Promise(resolve => setImmediate(resolve));
    const saved = JSON.parse(first.storage.get(first.STORAGE_KEYS.completionReplay)); saved.attempts = 3;
    const t = setup([[first.STORAGE_KEYS.completionReplay, JSON.stringify(saved)]]);
    t.switchToNextSubVideoOrCourse(); t.advance(12500); await new Promise(resolve => setImmediate(resolve));
    assert.equal(t.fixture.video.plays, 0);
    assert.equal(t.state.enabled, false);
});

test('重播播放连续失败3次才暂停，迟到的失败回调不覆盖手动暂停提示', async () => {
    for (const manualPause of [false, true]) {
        const t = setup(); let reject;
        t.fixture.video.play = () => new Promise((_, fail) => { reject = fail; });
        t.switchToNextSubVideoOrCourse(); t.advance(12500); await new Promise(resolve => setImmediate(resolve));
        if (manualPause) t.pauseAutomation('手动暂停');
        reject(new Error('play rejected')); await new Promise(resolve => setImmediate(resolve));
        if (!manualPause) {
            assert.equal(t.state.enabled, true);
            for (let retry = 0; retry < 2; retry++) {
                t.advance(1000);
                reject(new Error('play rejected')); await new Promise(resolve => setImmediate(resolve));
            }
        }
        assert.equal(t.state.enabled, false);
        assert.equal(t.fixture.video.paused, true);
        assert.match(t.context.document.getElementById('jinpei-hud-status').innerText, manualPause ? /手动暂停/ : /重播启动连续失败 3 次/);
    }
});

test('重播期间卡住时暂停，不刷新或标记跳过', async () => {
    const t = setup(); t.switchToNextSubVideoOrCourse(); t.advance(12500); await new Promise(resolve => setImmediate(resolve));
    await t.mainLoop(); t.advance(30000); await t.mainLoop();
    assert.equal(t.state.enabled, false);
    assert.equal(t.context.location.reloads, 0);
    assert.equal(t.getFailedSubVideos().length, 0);
    assert.equal(t.next.clicks, 0);
});

test('会话存储不可用时也最多重播3次', async () => {
    const t = setup();
    t.context.sessionStorage.setItem = () => { throw new Error('storage unavailable'); };
    for (let attempt = 0; attempt < 4; attempt++) {
        t.switchToNextSubVideoOrCourse(); t.advance(12500); await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(t.fixture.video.plays, 3);
    assert.equal(t.state.enabled, false);
    assert.equal(t.next.clicks, 0);
});

test('回退尚未完成或缓冲不足时等待，轮询不并发发起播放', async () => {
    const t = setup(); const video = t.fixture.video;
    video.seeking = true; video.readyState = 1; video.paused = true;
    t.switchToNextSubVideoOrCourse(); t.advance(13000); await t.mainLoop();
    assert.equal(video.plays, 0);
    assert.equal(t.state.enabled, true);
    video.seeking = false; t.advance(500);
    assert.equal(video.plays, 0);
    video.readyState = 2; t.advance(500);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(video.plays, 1);
    assert.equal(t.state.isSwitching, false);
});

test('临时AbortError会重试并恢复，同一轮不多扣重播次数', async () => {
    const t = setup(); const video = t.fixture.video; video.paused = true;
    video.play = () => {
        video.plays++;
        if (video.plays === 1) return Promise.reject(Object.assign(new Error('seek interrupted'), { name: 'AbortError' }));
        video.paused = false; return Promise.resolve();
    };
    t.switchToNextSubVideoOrCourse(); t.advance(12500);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(t.state.enabled, true);
    assert.equal(t.state.isSwitching, true);
    await t.mainLoop(); assert.equal(video.plays, 1);
    t.advance(1000); await new Promise(resolve => setImmediate(resolve));
    assert.equal(video.plays, 2);
    assert.equal(t.state.isSwitching, false);
    assert.equal(JSON.parse(t.storage.get(t.STORAGE_KEYS.completionReplay)).attempts, 1);
});

test('回退一直未完成会超时暂停，手动暂停可取消等待', async () => {
    for (const manual of [false, true]) {
        const t = setup(); t.fixture.video.seeking = true;
        t.switchToNextSubVideoOrCourse(); t.advance(12500);
        if (manual) t.pauseAutomation('手动暂停');
        t.advance(15000);
        assert.equal(t.state.enabled, false);
        assert.equal(t.fixture.video.plays, 0);
        assert.equal(t.timers.size, 0);
        assert.match(t.context.document.getElementById('jinpei-hud-status').innerText, manual ? /手动暂停/ : /恢复播放超时/);
    }
});

test('播放请求永远不返回也会有限重试后暂停', async () => {
    const t = setup(); const video = t.fixture.video;
    video.play = () => { video.plays++; return new Promise(() => {}); };
    t.switchToNextSubVideoOrCourse(); t.advance(27000);
    assert.equal(t.state.enabled, false);
    assert.equal(video.plays, 3);
    assert.equal(t.next.clicks, 0);
});

test('等待回退时更换播放器不会播放旧视频，并释放恢复锁', async () => {
    const t = setup(); const oldVideo = t.fixture.video;
    oldVideo.seeking = true;
    t.switchToNextSubVideoOrCourse(); t.advance(12500);
    t.fixture.video = { ...oldVideo, seeking: false };
    t.advance(1000);
    assert.equal(oldVideo.plays, 0);
    assert.equal(t.state.enabled, true);
    assert.equal(t.state.isSwitching, false);
    assert.equal(t.state.isActionPending, false);
});

test('同步等待期间确认完成后才切换下一节', async () => {
    const t = setup();
    t.switchToNextSubVideoOrCourse(); t.advance(3000);
    assert.equal(t.next.clicks, 0);
    t.current.completed = true; t.advance(3000);
    assert.equal(t.next.clicks, 1);
    t.advance(3000);
    assert.equal(t.state.isSwitching, false);
});

test('慢目录切换持续加锁，空白过渡页不解锁，目录渲染后解锁', async () => {
    const t = setup(); t.current.completed = true; t.fixture.items = [t.current];
    t.switchToNextSubVideoOrCourse(); t.advance(4000); await t.mainLoop();
    assert.equal(t.fixture.catalogClicks, 1);
    assert.equal(t.state.isActionPending, true);
    t.fixture.video = null; await t.mainLoop(); t.advance(500);
    assert.equal(t.state.isSwitching, true);
    t.fixture.courses = [{ innerText: '下一课程\n2学时', children: [], offsetParent: {} }];
    t.advance(500);
    assert.equal(t.state.isSwitching, false);
    assert.equal(t.state.isActionPending, false);
});

test('目录切换超时暂停，不再次点击', async () => {
    const t = setup(); t.current.completed = true; t.fixture.items = [t.current];
    t.switchToNextSubVideoOrCourse(); t.advance(15000); await t.mainLoop();
    assert.equal(t.state.enabled, false);
    assert.equal(t.fixture.catalogClicks, 1);
    assert.equal(t.timers.size, 0);
});

test('返回时路由变化但任务卡片尚未加载仍等待，卡片加载后解除锁', async () => {
    const t = setup(); t.current.completed = true; t.fixture.items = [t.current];
    t.switchToNextSubVideoOrCourse(); t.context.location.href = 'https://pc.kmelearning.com/home/my/myTask';
    t.advance(500);
    assert.equal(t.state.isActionPending, true);
    t.fixture.items = [{ innerText: '学习地图\n进行中', offsetParent: {} }];
    t.advance(500);
    assert.equal(t.state.isActionPending, false);
    assert.equal(t.state.isSwitching, false);
});

test('进入任务等学习入口实际出现，详情页跳转等目录实际出现', async () => {
    const t = setup();
    t.context.location.href = 'https://pc.kmelearning.com/home/my/myTask';
    let clicks = 0;
    t.fixture.items = [{ innerText: '学习地图\n进行中', children: [], offsetParent: {}, click() {
        clicks++; t.context.location.href = 'https://pc.kmelearning.com/home/training/detail/1';
    } }];
    await t.mainLoop(); t.advance(6000); await t.mainLoop();
    assert.equal(clicks, 1);
    assert.equal(t.state.isActionPending, true);
    t.fixture.entryButtons = [{ innerText: '进入学习', offsetParent: {}, click() {
        clicks++; t.context.location.href = 'https://pc.kmelearning.com/home/training/study/1';
        t.fixture.video = null;
    } }];
    t.advance(500);
    assert.equal(t.state.isActionPending, false);
    await t.mainLoop(); t.advance(6000); await t.mainLoop();
    assert.equal(clicks, 2);
    assert.equal(t.state.isActionPending, true);
    t.fixture.courses = [{ innerText: '课程一\n2学时', children: [], offsetParent: {} }];
    t.advance(500);
    assert.equal(t.state.isActionPending, false);
});

test('进入课程等待视频可播放且小节目录就绪，不重复点击或提前触发看门狗', async () => {
    const t = setup(); const video = t.fixture.video;
    t.fixture.video = null;
    let clicks = 0;
    t.fixture.courses = [{ innerText: '课程一\n2学时', children: [], offsetParent: {}, click() { clicks++; } }];
    await t.mainLoop(); t.advance(5000); await t.mainLoop();
    assert.equal(clicks, 1); assert.equal(t.state.isActionPending, true);
    video.duration = NaN; video.readyState = 1; t.fixture.video = video;
    t.advance(500); await t.mainLoop();
    assert.equal(t.state.isActionPending, true);
    video.duration = 100; t.advance(500);
    assert.equal(t.state.isActionPending, true);
    video.readyState = 2; t.fixture.items = []; t.advance(500);
    assert.equal(t.state.isActionPending, true);
    t.fixture.items = [t.current]; t.advance(500);
    assert.equal(t.state.isActionPending, false);
    assert.equal(clicks, 1); assert.equal(t.context.location.reloads, 0);
    assert.match(t.formatDiagnosticLogs(), /页面已就绪：课程播放器与小节目录加载/);
});

test('课程点击后立即就绪就立即解锁，不额外等待三秒', async () => {
    const t = setup(); const video = t.fixture.video;
    t.fixture.video = null;
    t.fixture.courses = [{ innerText: '课程一\n2学时', children: [], offsetParent: {}, click() { t.fixture.video = video; } }];
    await t.mainLoop(); t.advance(1000);
    assert.equal(t.state.isActionPending, false);
});

test('页面就绪等待超时或检查异常会暂停并记录原因', async () => {
    for (const error of [false, true]) {
        const t = setup();
        t.waitForPageReady('课程加载', () => { if (error) throw new Error('检查失败'); return false; }, 1000);
        t.advance(1000);
        assert.equal(t.state.enabled, false);
        assert.equal(t.state.isActionPending, false);
        assert.equal(t.timers.size, 0);
        assert.match(t.formatDiagnosticLogs(), error ? /检查失败/ : /课程加载超时/);
    }
});

test('手动暂停取消页面等待，迟到的就绪状态不会继续运行', async () => {
    const t = setup(); let ready = false;
    t.waitForPageReady('课程加载', () => ready);
    t.pauseAutomation('手动暂停'); ready = true; t.advance(25000);
    assert.equal(t.state.enabled, false);
    assert.equal(t.timers.size, 0);
    assert.doesNotMatch(t.formatDiagnosticLogs(), /页面已就绪：课程加载/);
});

test('诊断日志只保留200条，含上下文并在刷新后恢复，可清空', async () => {
    const t = setup(); t.clearDiagnosticLogs();
    t.state.currentTask = '任务一'; t.state.currentCourse = '课程一'; t.state.currentSubVideo = '小节一';
    t.state.syncRetryCount = 2;
    t.context.location.href += '?token=private#secret';
    for (let i = 0; i < 205; i++) t.recordDiagnostic('INFO', '记录' + i);
    const saved = JSON.parse(t.storage.get(t.STORAGE_KEYS.diagnostics));
    assert.equal(saved.length, 200); assert.equal(saved[0].message, '记录5');
    assert.equal(saved[199].course, '课程一'); assert.equal(saved[199].sub, '小节一');
    assert.equal(saved[199].syncRetry, 2); assert.equal(saved[199].tab, t.TAB_ID);
    assert.doesNotMatch(t.formatDiagnosticLogs(), /private|secret/);
    const restored = setup([...t.storage]);
    assert.match(restored.formatDiagnosticLogs(), /记录204/);
    restored.clearDiagnosticLogs();
    assert.equal(restored.storage.has(t.STORAGE_KEYS.diagnostics), false);
    assert.doesNotMatch(restored.formatDiagnosticLogs(), /记录204/);
});

test('播放诊断记录同播放器归零和末尾跳转事件，不重复绑定或泄露媒体地址', () => {
    const t = setup(); const listeners = new Map();
    const video = t.fixture.video;
    video.addEventListener = (name, fn) => {
        assert.equal(listeners.has(name), false); listeners.set(name, fn);
    };
    video.currentSrc = 'https://media.invalid/video?token=private';
    video.currentTime = 98;
    t.observeVideoPlayback(video); t.observeVideoPlayback(video);
    video.currentTime = 0; listeners.get('timeupdate')();
    let logs = t.formatDiagnosticLogs();
    assert.match(logs, /播放诊断：进度回退/);
    assert.match(logs, /"currentTime":98/);
    assert.match(logs, /"currentTime":0/);
    assert.match(logs, /"sourceChanged":false/);
    assert.doesNotMatch(logs, /private|media.invalid/);
    video.currentTime = 70; listeners.get('seeking')(); listeners.get('seeked')();
    logs = t.formatDiagnosticLogs();
    assert.match(logs, /播放诊断：seeked/);
    assert.match(logs, /"currentTime":70/);
});

test('播放诊断识别换源、播放器替换，忽略已移除播放器事件', () => {
    const t = setup(); const listeners = new Map(); const old = t.fixture.video;
    old.addEventListener = (name, fn) => listeners.set(name, fn);
    old.currentSrc = 'first'; t.observeVideoPlayback(old);
    old.currentSrc = 'second'; listeners.get('loadstart')();
    assert.match(t.formatDiagnosticLogs(), /"sourceChanged":true/);
    t.fixture.video = { ...old, addEventListener() {}, currentTime: 0 };
    t.observeVideoPlayback(t.fixture.video);
    assert.match(t.formatDiagnosticLogs(), /"player":2/);
    const logs = t.formatDiagnosticLogs();
    listeners.get('ended')();
    assert.equal(t.formatDiagnosticLogs(), logs);
});

test('诊断日志复制成功有反馈，剪贴板不可用时选中文本供手动复制', async () => {
    const t = setup(); let copied = ''; let selected = false;
    t.context.navigator.clipboard = { async writeText(text) { copied = text; } };
    assert.equal(await t.copyDiagnosticLogs(), true);
    assert.match(copied, /神奇海螺诊断日志/);
    assert.equal(t.context.document.getElementById('jinpei-diagnostics-notice').innerText, '已复制');
    delete t.context.navigator.clipboard;
    const output = t.context.document.getElementById('jinpei-diagnostics-output');
    output.focus = () => {}; output.select = () => { selected = true; };
    assert.equal(await t.copyDiagnosticLogs(), false);
    assert.equal(selected, true);
    assert.equal(t.context.document.getElementById('jinpei-diagnostics').open, true);
});

test('存储不可用或旧日志损坏时，诊断日志仍可在内存中使用', async () => {
    const t = setup([['_kme_diagnostics', '{invalid']]);
    t.context.sessionStorage.setItem = () => { throw new Error('quota'); };
    t.recordDiagnostic('ERROR', new Error('播放器异常'));
    assert.match(t.formatDiagnosticLogs(), /播放器异常/);
    assert.equal(t.state.enabled, true);
});

test('手动暂停取消同步重试并恢复原生可见性', async () => {
    const t = setup(); t.switchToNextSubVideoOrCourse();
    assert.equal(t.context.document.webkitVisibilityState, 'visible');
    t.pauseAutomation('已暂停'); t.current.completed = true; t.advance(20000);
    assert.equal(t.next.clicks, 0);
    assert.equal(t.context.document.hidden, true);
    assert.equal(t.context.document.visibilityState, 'hidden');
    assert.equal(t.context.document.webkitVisibilityState, 'hidden');
    assert.equal(t.timers.size, 0);
});

test('calculateCourseTotalProgress 正确计算总时长、已完成小节数及百分比', async () => {
    const t = setup();
    const item1 = { completed: true, className: '', innerText: '小节1\n00:10:00', querySelector() { return {}; } };
    const item2 = { completed: false, className: 'text-primary', innerText: '小节2\n00:20:00', querySelector() { return null; } };
    const fakeVideo = { currentTime: 300, duration: 1200 }; // 播了5分钟 (300秒)
    const result = t.calculateCourseTotalProgress([item1, item2], fakeVideo);
    assert.equal(result.completedCount, 1);
    assert.equal(result.totalCount, 2);
    assert.equal(result.totalSec, 1800); // 10m + 20m = 30m = 1800s
    assert.equal(result.completedSec, 900); // 600s + 300s = 900s
    assert.equal(result.percent, 50);
    assert.match(result.text, /1\/2 节 · 15:00 \/ 30:00 \(50%\)/);
});

test('全量小节学完且检测到考试时，自动跳过考试并记录handledCourses', async () => {
    const t = setup(); t.state.currentCourse = '含考试课程';
    t.current.completed = true;
    t.fixture.items = [t.current];
    // 注入考试检测条目
    t.fixture.examNode = { innerText: '课后考试', closest() { return null; } };
    const origQSA = t.context.document.querySelectorAll.bind(t.context.document);
    t.context.document.querySelectorAll = (sel) => {
        if (sel.includes('ant5-tabs-tab')) return [t.fixture.examNode];
        return origQSA(sel);
    };

    t.switchToNextSubVideoOrCourse();
    t.advance(500);

    const handled = t.getHandledCourses();
    assert.ok(handled.length > 0);
    assert.match(t.context.document.getElementById('jinpei-hud-status').innerText, /包含考试，已自动跳过/);
});

test('autoDismissDialogs 检测并跳过考试弹窗', async () => {
    const t = setup();
    let cancelClicked = 0;
    const mockDialog = {
        innerText: '恭喜您完成视频，是否进入结业考试？',
        offsetParent: {},
        closest() { return null; },
        querySelectorAll(sel) {
            if (sel.includes('button')) {
                return [
                    { innerText: '取消', offsetParent: {}, click() { cancelClicked++; } },
                    { innerText: '去考试', offsetParent: {}, click() {} }
                ];
            }
            return [];
        },
        querySelector() { return null; }
    };
    const origQSA = t.context.document.querySelectorAll.bind(t.context.document);
    t.context.document.querySelectorAll = (sel) => {
        if (sel.includes('modal')) return [mockDialog];
        return origQSA(sel);
    };

    t.autoDismissDialogs();
    assert.equal(cancelClicked, 1);
});

test('课程大目录中跳过已处理课程，防止未打勾导致死循环', async () => {
    const t = setup();
    t.fixture.video = null; // 在目录页
    let course1Clicks = 0;
    let course2Clicks = 0;
    const course1 = { innerText: '已学课程（含考试跳过）\n2学时', children: [], offsetParent: {}, click() { course1Clicks++; } };
    const course2 = { innerText: '未学课程2\n1学时', children: [], offsetParent: {}, click() { course2Clicks++; } };
    t.fixture.courses = [course1, course2];

    // 将 course1 加入 handled
    t.markCourseHandled('已学课程（含考试跳过）');

    await t.mainLoop();
    t.advance(1500);

    assert.equal(course1Clicks, 0, '已跳过的课程不应被再次点击');
    assert.equal(course2Clicks, 1, '应直接进入下一门未完成课程');
    assert.equal(t.storage.get('_kme_m_progress') || t.storage.get('jinpei_map_progress'), '0 / 2 门 (0%) · 异常 0 · 待考试 0 · 待核验 1');
});

test('mainLoop 兼容 /home/courseplay/ 独立课程播放路由', async () => {
    const t = setup();
    t.context.location.href = 'https://pc.kmelearning.com/jsncxyslhs/home/courseplay/2092436631901233152';
    t.current.completed = true;
    t.fixture.items = [t.current, t.next];
    t.advance(6000);
    await t.mainLoop();
    t.advance(500);
    // 应该识别为 study/courseplay 页面并推进视频跳转
    assert.equal(t.next.clicks, 1);
});

test('[P1] 不同地图中的同名课程不相互冲突，地图A处理后地图B同名未学课程正常进入', async () => {
    const t = setup();
    // 地图 100 中标记“合规培训”已处理
    t.markCourseHandled('100', '合规培训');
    assert.equal(t.isCourseHandled('100', '合规培训'), true);
    assert.equal(t.isCourseHandled('200', '合规培训'), false);

    // 切换到地图 200
    t.context.location.href = 'https://pc.kmelearning.com/home/training/study/200';
    t.fixture.video = null; // 目录页
    let map2CourseClicks = 0;
    const map2Course = { innerText: '合规培训\n2学时', children: [], offsetParent: {}, click() { map2CourseClicks++; } };
    t.fixture.courses = [map2Course];

    await t.mainLoop();
    t.advance(1500);

    assert.equal(map2CourseClicks, 1, '地图200中的同名课程不应被地图100误跳过');
});

test('[P2] 任务中心跳过包含考试已学完的地图，避免死循环重入', async () => {
    const t = setup();
    t.context.location.href = 'https://pc.kmelearning.com/home/my/myTask';
    let map1Clicks = 0;
    let map2Clicks = 0;
    const taskMap1 = {
        innerText: '2026年九月地图（含考试已跳过）\n进行中\n截止2026.10.01',
        offsetParent: {},
        click() { map1Clicks++; }
    };
    const taskMap2 = {
        innerText: '2026年十月地图\n进行中\n截止2026.11.01',
        offsetParent: {},
        click() { map2Clicks++; }
    };

    // 模拟 querySelectorAll 返回任务卡片
    t.context.document.querySelectorAll = (sel) => {
        if (sel.includes('.grid > div')) return [taskMap1, taskMap2];
        return [];
    };

    // 记录 taskMap1 为已处理
    t.markMapHandled('2026年九月地图（含考试已跳过）');

    await t.mainLoop();
    t.advance(1500);

    assert.equal(map1Clicks, 0, '已处理跳过的地图不应被再次点击重入');
    assert.equal(map2Clicks, 1, '应顺利进入下一个未处理地图');

    // 若 taskMap2 也处理完，再次执行主循环应平稳暂停自动化
    t.markMapHandled('2026年十月地图');
    t.state.isActionPending = false;
    await t.mainLoop();
    assert.equal(t.state.enabled, false);
    assert.match(t.context.document.getElementById('jinpei-hud-status').innerText, /本轮任务检查结束/);
});

test('[P3] getCourseItems 正确识别只有 0% 或仅有百分比的课程卡片', async () => {
    const t = setup();
    const cardWithZero = {
        innerText: '新员工合规通识\n0%',
        children: [],
        offsetParent: {}
    };
    const cardWithFifty = {
        innerText: '银行理财业务概览\n50%',
        children: [],
        offsetParent: {}
    };
    t.context.document.querySelectorAll = (sel) => {
        if (sel.includes('panelContent')) return [cardWithZero, cardWithFifty];
        return [];
    };

    const items = t.getCourseItems();
    assert.equal(items.length, 2, '包含 0% 和 50% 的卡片应全部被正确识别');
});

test('[防检测 1] 随机时间抖动：randomBetween 落在正确闭区间，开启 enableJitter 后定时产生波动', async () => {
    const t = setup();
    for (let i = 0; i < 50; i++) {
        const val = t.randomBetween(100, 200);
        assert.ok(val >= 100 && val <= 200, `val ${val} 应在 100 到 200 之间`);
    }

    t.CONFIG.enableJitter = true;
    const delays = [];
    for (let i = 0; i < 20; i++) {
        t.setManagedTimeout(() => {}, 1000);
        const latestTimer = [...t.timers.values()].pop();
        delays.push(latestTimer.at);
    }
    // 抖动模式下，每个 1000ms 定时器由于 ~15% 随机偏移，不应全部完全相同
    const uniqueDelays = new Set(delays);
    assert.ok(uniqueDelays.size > 1, '启用拟人时间抖动后，定时器触发时刻应产生离散波动');
    t.CONFIG.enableJitter = false;
});

test('[防检测 2] 拟人化点击：simulateHumanClick 派发完整鼠标事件链与自然范围坐标', async () => {
    const t = setup();
    const dispatchedEvents = [];
    let nativeClicked = 0;
    let handledClicks = 0;

    const mockButton = {
        getBoundingClientRect() {
            return { left: 100, top: 200, width: 80, height: 40 };
        },
        dispatchEvent(evt) {
            dispatchedEvents.push(evt);
            if (evt.type === 'click') handledClicks++;
            return true;
        },
        click() {
            nativeClicked++;
            handledClicks++;
        }
    };

    // 注入全局 MouseEvent 构造支持
    t.context.MouseEvent = class MockMouseEvent {
        constructor(type, init = {}) {
            this.type = type;
            Object.assign(this, init);
        }
    };

    t.simulateHumanClick(mockButton);

    assert.equal(nativeClicked, 0, '派发 click 后不能再调用 .click()');
    assert.equal(handledClicks, 1, '页面的点击处理只能触发一次');
    const eventTypes = dispatchedEvents.map(e => e.type);
    assert.deepEqual(eventTypes, ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']);

    // 坐标在元素 bounding box 内部 (left: 100..180, top: 200..240)
    for (const evt of dispatchedEvents) {
        assert.ok(evt.clientX >= 100 && evt.clientX <= 180, `clientX ${evt.clientX} 应在元素水平区域内`);
        assert.ok(evt.clientY >= 200 && evt.clientY <= 240, `clientY ${evt.clientY} 应在元素垂直区域内`);
    }
});

test('点击被页面取消默认行为时，不通过 .click() 再触发一次', () => {
    const t = setup(); let handled = 0; let nativeClicked = 0;
    t.context.MouseEvent = class { constructor(type) { this.type = type; } };
    t.simulateHumanClick({
        dispatchEvent(event) { if (event.type === 'click') { handled++; return false; } return true; },
        click() { nativeClicked++; handled++; },
    });
    assert.equal(handled, 1);
    assert.equal(nativeClicked, 0);
});

test('鼠标事件不可用或派发前失败时，回退 .click() 一次以保持课程推进', () => {
    for (const unavailable of ['missing', 'throws']) {
        const t = setup(); let clicks = 0;
        if (unavailable === 'throws') t.context.MouseEvent = class { constructor() { throw new Error('MouseEvent unavailable'); } };
        t.simulateHumanClick({ dispatchEvent() {}, click() { clicks++; } });
        assert.equal(clicks, 1);
    }
});

test('[防检测 4] 会话存储脱敏：使用 _kme_* 前缀，兼容旧 jinpei_* 键名', async () => {
    const t = setup();
    // 1. 验证写入脱敏键名
    t.setStorageItem(t.STORAGE_KEYS.running, 'true');
    assert.equal(t.storage.get('_kme_running_state'), 'true');

    // 2. 验证优先读取脱敏键名
    assert.equal(t.getStorageItem(t.STORAGE_KEYS.running, 'jinpei_auto_running'), 'true');

    // 3. 验证向下兼容历史键名
    t.storage.delete('_kme_running_state');
    t.storage.set('jinpei_auto_running', 'legacy_true');
    assert.equal(t.getStorageItem(t.STORAGE_KEYS.running, 'jinpei_auto_running'), 'legacy_true');

    // 4. 验证 removeStorageItem 同时清除新旧键名
    t.setStorageItem(t.STORAGE_KEYS.running, 'true');
    t.removeStorageItem(t.STORAGE_KEYS.running, 'jinpei_auto_running');
    assert.equal(t.storage.has('_kme_running_state'), false);
    assert.equal(t.storage.has('jinpei_auto_running'), false);
});

test('[防检测 4] Shadow DOM 隔离：HUD 挂载至 _kme_tool_host 且内部 Shadow 封装', async () => {
    const t = setup();
    let attachedShadowRoot = null;
    const hostEl = {
        id: '_kme_tool_host',
        style: {},
        attachShadow(init) {
            assert.equal(init.mode, 'open');
            attachedShadowRoot = {
                children: [],
                appendChild(child) { this.children.push(child); },
                getElementById(id) { return this.children.find(c => c.id === id) || null; },
                querySelector() { return null; }
            };
            return attachedShadowRoot;
        }
    };

    t.context.document.body = {
        children: [],
        appendChild(child) { this.children.push(child); }
    };
    t.context.document.getElementById = (id) => {
        if (id === '_kme_tool_host') return null;
        if (id === 'jinpei-hud') return null;
        return { style: {}, innerText: '', addEventListener() {}, appendChild() {} };
    };
    t.context.document.createElement = (tag) => {
        if (tag === 'div') {
            return {
                id: '',
                style: {},
                children: [],
                attachShadow: hostEl.attachShadow,
                appendChild(c) { this.children.push(c); },
                addEventListener() {},
                getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 200 }; }
            };
        }
        if (tag === 'style') {
            return { id: '', innerHTML: '' };
        }
        return { style: {}, addEventListener() {} };
    };

    // 执行主循环触发 HUD 创建
    await t.mainLoop();

    assert.ok(attachedShadowRoot, '应成功为宿主 host 创建 attachShadow({ mode: "open" })');
    const hudInShadow = attachedShadowRoot.children.find(c => c.id === 'jinpei-hud');
    assert.ok(hudInShadow, 'HUD 面板应被安全封闭在 Shadow DOM 内部，避免外层 document.querySelectorAll 检索遍历');
    assert.match(hudInShadow.innerHTML, /<details id="jinpei-diagnostics"[^>]*>/);
    assert.doesNotMatch(hudInShadow.innerHTML, /<details[^>]*\bopen\b/);
});

test('[看门狗 1] 视频进度卡住 30 秒自动触发 location.reload()，且 reloadCount 正确累加', async () => {
    const t = setup();
    t.current.completed = false;
    t.fixture.video.currentTime = 10;

    // 首次检测初始化
    t.checkWatchdog(t.fixture.video, t.current, t.fixture.items);
    assert.equal(t.context.location.reloads, 0);

    // 时间推进 29 秒 (未达 30 秒阈值)
    t.advance(29000);
    t.checkWatchdog(t.fixture.video, t.current, t.fixture.items);
    assert.equal(t.context.location.reloads, 0, '未达 30 秒不应触发刷新');

    // 时间推进到 30 秒
    t.advance(1000);
    t.checkWatchdog(t.fixture.video, t.current, t.fixture.items);
    assert.equal(t.context.location.reloads, 1, '卡顿满 30 秒应自动刷新页面');

    const wd = t.getWatchdogState();
    assert.equal(wd.reloadCount, 1, '已刷新次数应记录为 1');
});

test('[看门狗 2] 连续卡死刷新达 5 次仍未恢复，自动标记跳过该小节并切换下一小节', async () => {
    const t = setup();
    t.current.completed = false;
    t.fixture.video.currentTime = 5;

    // 让下一小节拥有独立标题，避免和当前小节同名导致键名冲突
    t.next.innerText = '下一小节\n00:02:00';
    t.next.querySelector = (selector) => selector === '[title], .truncate' ? { innerText: '下一小节' } : (t.next.completed ? {} : null);

    // 模拟已经刷新了 5 次
    const subKey = '1::unknown::当前小节';
    t.setWatchdogState({
        subVideoKey: subKey,
        reloadCount: 5,
        consecutiveFails: 0
    });

    // 初始化 runtime 记录
    t.checkWatchdog(t.fixture.video, t.current, t.fixture.items);

    // 卡顿满 30 秒
    t.advance(30000);
    t.checkWatchdog(t.fixture.video, t.current, t.fixture.items);

    // 此时不再执行 location.reload()，而是判定该小节卡死
    const wd = t.getWatchdogState();
    assert.equal(wd.reloadCount, 0, '小节跳过后 reloadCount 应归零');
    assert.equal(wd.consecutiveFails, 1, '连续失败小节数应为 1');
    assert.ok(t.isSubVideoFailed(subKey), '当前小节应被记录至 failedVideos');

    // 推进 1 秒调度 switchToNextSubVideoOrCourse
    t.advance(1000);
    assert.equal(t.next.clicks, 1, '应自动点击并切换至下一未完成小节');
});

test('[看门狗 3] 连续 3 节课均加载失败，看门狗自动暂停学习并提示用户', async () => {
    const t = setup();
    t.current.completed = false;
    t.fixture.video.currentTime = 0;

    // 模拟前 2 节课已经失败，当前小节是第 3 节，且已刷新 5 次
    const subKey = '1::unknown::当前小节';
    t.setWatchdogState({
        subVideoKey: subKey,
        reloadCount: 5,
        consecutiveFails: 2
    });

    t.checkWatchdog(t.fixture.video, t.current, t.fixture.items);
    t.advance(30000);
    t.checkWatchdog(t.fixture.video, t.current, t.fixture.items);

    assert.equal(t.state.enabled, false, '达到连续 3 节失败上限应自动暂停');
    assert.match(t.context.document.getElementById('jinpei-hud-status').innerText, /连续 3 节课均无法正常加载播放/);
});

test('[看门狗 4] 视频正常稳定播放推进后，自动复位看门狗异常计数', async () => {
    const t = setup();
    t.current.completed = false;
    t.fixture.video.currentTime = 10;

    const subKey = '1::unknown::当前小节';
    t.setWatchdogState({
        subVideoKey: subKey,
        reloadCount: 2,
        consecutiveFails: 1
    });

    // 第一次进入
    t.checkWatchdog(t.fixture.video, t.current, t.fixture.items);

    // 视频正常播放了 4 秒 (10 -> 14)
    t.advance(4000);
    t.fixture.video.currentTime = 14;
    t.checkWatchdog(t.fixture.video, t.current, t.fixture.items);

    const wd = t.getWatchdogState();
    assert.equal(wd.reloadCount, 0, '视频正常播放后 reloadCount 应清零');
    assert.equal(wd.consecutiveFails, 0, '视频正常播放后 consecutiveFails 应清零');
});

test('[并发 1] 并发数读取与设置：默认并发数为 1，支持 1~6 范围约束与持久化', async () => {
    const t = setup();
    assert.equal(t.getConcurrencySetting(), 1, '默认并发数应为 1');
    assert.equal(t.CONFIG.defaultConcurrency, 1);
    assert.equal(t.CONFIG.maxConcurrency, 6);

    // 设置在有效范围内
    assert.equal(t.setConcurrencySetting(3), 3);
    assert.equal(t.getConcurrencySetting(), 3);
    assert.equal(t.localStorageMap.get(t.STORAGE_KEYS.concurrency), '3');
    assert.equal(t.state.concurrency, 3);

    // 下界钳位
    assert.equal(t.setConcurrencySetting(0), 1);
    assert.equal(t.getConcurrencySetting(), 1);

    // 上界钳位 (最大 6)
    assert.equal(t.setConcurrencySetting(9), 6);
    assert.equal(t.getConcurrencySetting(), 6);
});

test('[并发 2] 跨标签页心跳注册、过期清理与窗口退出释放', async () => {
    const t = setup();
    t.registerTabHeartbeat('c_101', '合规大课', 'map_99');
    let tabs = t.getActiveTabs();
    assert.ok(tabs[t.TAB_ID], '当前标签页应成功注册至活跃表');
    assert.equal(tabs[t.TAB_ID].courseKey, 'c_101');
    assert.equal(tabs[t.TAB_ID].courseTitle, '合规大课');
    assert.equal(tabs[t.TAB_ID].mapId, 'map_99');

    // 120 秒内活跃心跳有效
    t.advance(5000);
    tabs = t.getActiveTabs();
    assert.ok(tabs[t.TAB_ID], '5 秒内心跳依然有效');

    // 模拟超过 120 秒未续期（页面卡死或异常崩溃关闭），自动清理陈旧槽位
    t.advance(116000); // 121 秒未续期
    tabs = t.getActiveTabs();
    assert.equal(tabs[t.TAB_ID], undefined, '超过 120 秒未刷新心跳应被自动剔除');

    // 重新注册并手动 unregisterTab (模拟 beforeunload 退出)
    t.registerTabHeartbeat('c_101', '合规大课', 'map_99');
    assert.ok(t.getActiveTabs()[t.TAB_ID]);
    t.unregisterTab();
    assert.equal(t.getActiveTabs()[t.TAB_ID], undefined, 'unregisterTab 后应立即移除占位');
});

test('[并发 3] 课程槽位防冲突：其他活跃窗口占用的课程不会被重复分配', async () => {
    const otherTabId = 'tab_other_abc';
    const activeMap = {
        [otherTabId]: {
            courseKey: 'c_course1',
            courseTitle: '第一门必修课',
            mapId: '1',
            timestamp: 0,
        }
    };
    const t = setup([], [['_kme_active_tabs', JSON.stringify(activeMap)]]);

    // 检查冲突检测
    assert.equal(t.isCourseBusyByOtherTab('c_course1', '第一门必修课', '1'), true, '同地图同课程应判定为占用');
    assert.equal(t.isCourseBusyByOtherTab('c_course2', '第二门必修课', '1'), false, '未被占用的课程应返回 false');
    assert.equal(t.isCourseBusyByOtherTab('c_course1', '第一门必修课', 'map_diff'), false, '不同地图不冲突');

    // 槽位抢占
    t.setConcurrencySetting(2);
    assert.equal(await t.tryClaimCourseSlot('c_course1', '第一门必修课', '1'), false, '被占用的课程无法申领');
    assert.equal(await t.tryClaimCourseSlot('c_course2', '第二门必修课', '1'), true, '未被占用的课程成功申领');

    // 申领成功后应已记入当前标签的心跳
    assert.equal(t.getActiveTabs()[t.TAB_ID].courseKey, 'c_course2');
});

test('[并发 4] 目录调度与多窗口唤起：多并发下自动打开新窗口，全占用时候选中不误切', async () => {
    const c1 = { innerText: '课程一\n2学时', children: [], offsetParent: {}, clicks: 0, click() { this.clicks++; } };
    const c2 = { innerText: '课程二\n2学时', children: [], offsetParent: {}, clicks: 0, click() { this.clicks++; } };
    const c3 = { innerText: '课程三\n2学时', children: [], offsetParent: {}, clicks: 0, click() { this.clicks++; } };

    const t = setup();
    t.fixture.video = null; // 目录态
    t.fixture.courses = [c1, c2, c3];
    t.setConcurrencySetting(2); // 设为 2 路并发

    // Tab 1 运行目录调度
    await t.mainLoop();
    t.advance(1000);

    // Tab 1 进入 c1
    assert.equal(c1.clicks, 1, '应选择第一个可用大课');
    assert.equal(t.state.currentCourse, '课程一');
    // 因为设置了 2 路并发，且还有剩余课程，自动唤起了新窗口
    assert.equal(t.openedUrls.length, 1, '并发 > 1 且有余课时应调用 window.open 唤起新窗口');

    // 模拟 Tab 2：C1 和 C2 都已被两个窗口占用，只剩 C1/C2 在学
    const twoBusyTabs = {
        tab_1: { courseKey: '课程一', courseTitle: '课程一', mapId: '1', timestamp: 1000 },
        tab_2: { courseKey: '课程二', courseTitle: '课程二', mapId: '1', timestamp: 1000 },
    };
    const t2 = setup([], [['_kme_active_tabs', JSON.stringify(twoBusyTabs)]]);
    t2.fixture.video = null;
    t2.fixture.courses = [c1, c2]; // 只有两门课，且两门课都正在被 tab_1 和 tab_2 学习
    await t2.mainLoop();

    // t2 应原地等待候选中，不误点击，也不误跳出地图
    assert.equal(c1.clicks, 1, '不应重复点击已占用的课程');
    assert.equal(c2.clicks, 0);
    assert.match(t2.context.document.getElementById('jinpei-hud-status').innerText, /剩余课程存在其他窗口占用记录 \(2 个\)/);
});

test('[并发 5] 并发子窗口学完全部课程后自动关闭释放资源', async () => {
    const c1 = { innerText: '已学课程一\n2学时', children: [], offsetParent: {} };
    const t = setup();
    t.markCourseHandled('1', '已学课程一');
    t.context.window.opener = {}; // 标识当前窗口为由主窗口打开的子窗口
    t.fixture.video = null;
    t.fixture.courses = [c1];

    await t.mainLoop();
    t.advance(2500);

    assert.equal(t.context.window.closed, true, '并发子窗口学完全部课程后应调用 window.close() 自动关闭');
});

function renderHUDTest(storageInit = []) {
    const t = setup(storageInit, storageInit);
    let attachedShadowRoot = null;
    const hostEl = {
        id: '_kme_tool_host',
        style: {},
        attachShadow(init) {
            assert.equal(init.mode, 'open');
            attachedShadowRoot = {
                children: [],
                appendChild(child) { this.children.push(child); },
                getElementById(id) { return this.children.find(c => c.id === id) || null; },
                querySelector() { return null; }
            };
            return attachedShadowRoot;
        }
    };
    t.context.document.body = {
        children: [],
        appendChild(child) { this.children.push(child); }
    };
    t.context.document.getElementById = (id) => {
        if (id === '_kme_tool_host') return null;
        if (id === 'jinpei-hud') return null;
        return { style: {}, innerText: '', addEventListener() {}, appendChild() {} };
    };
    t.context.document.createElement = (tag) => {
        if (tag === 'div') {
            return {
                id: '',
                style: {},
                children: [],
                classList: {
                    classes: new Set(),
                    add(c) { this.classes.add(c); },
                    remove(c) { this.classes.delete(c); },
                    contains(c) { return this.classes.has(c); },
                    toggle(c, v) { if (v) this.add(c); else this.remove(c); }
                },
                attachShadow: hostEl.attachShadow,
                appendChild(c) { this.children.push(c); },
                addEventListener() {},
                getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 200 }; }
            };
        }
        if (tag === 'style') {
            return { id: '', innerHTML: '' };
        }
        return { style: {}, addEventListener() {} };
    };
    return { t, getShadowRoot: () => attachedShadowRoot };
}

test('[HUD 最小化 1] 最小化时折叠为单个海螺图标悬浮球，隐藏标题文字、版本号及迷你状态', async () => {
    const { t, getShadowRoot } = renderHUDTest([['_kme_pref_col', 'true']]);
    await t.mainLoop();

    const shadow = getShadowRoot();
    assert.ok(shadow, '应该为 HUD 创建 Shadow DOM');
    const hud = shadow.children.find(c => c.id === 'jinpei-hud');
    assert.ok(hud, 'HUD 面板应挂载在 Shadow DOM 中');

    assert.equal(hud.style.width, '42px', '折叠时 HUD 宽度应为 42px 紧凑正圆');
    assert.equal(hud.style.height, '42px', '折叠时 HUD 高度应为 42px');
    assert.equal(hud.style.borderRadius, '50%', '折叠时 HUD 边框应为 50% 正圆');
    assert.equal(hud.style.overflow, 'visible', '折叠时 HUD overflow 应为 visible 避免状态指示圆点被截断');
    assert.ok(hud.classList.contains('jinpei-collapsed'), '折叠时应具有 jinpei-collapsed 样式类名');

    // 检查 HTML 结构：标题文字在折叠时为 display: none，不展示 title
    assert.match(hud.innerHTML, /id="jinpei-hud-title-text"[^>]*display:\s*none/, '折叠时标题文字（神奇海螺）应隐藏不展示');
    assert.match(hud.innerHTML, /id="jinpei-hud-version"[^>]*display:\s*none/, '折叠时版本号应隐藏');
    assert.match(hud.innerHTML, /id="jinpei-hud-top-bar"[^>]*display:\s*none/, '折叠时顶部彩条应隐藏');
    assert.match(hud.innerHTML, /id="jinpei-hud-icon"[^>]*>🐚<\/span>/, '折叠时应展示海螺图标');
    assert.match(hud.innerHTML, /id="jinpei-hud-dot"[^>]*top:\s*7px;?[^>]*right:\s*7px/, '折叠时状态绿点应居内定位避免贴边截断');
});

test('[HUD 最小化 2] 默认展开时显示完整标题神奇海螺与当前版本号', async () => {
    const { t, getShadowRoot } = renderHUDTest([['_kme_pref_col', 'false']]);
    await t.mainLoop();

    const shadow = getShadowRoot();
    const hud = shadow.children.find(c => c.id === 'jinpei-hud');
    assert.ok(hud);

    assert.equal(hud.style.width, '320px', '展开时宽度应为 320px');
    assert.equal(hud.style.borderRadius, '18px', '展开时圆角应为 18px');
    assert.equal(hud.style.overflow, 'hidden', '展开时圆角应裁剪溢出');
    assert.equal(hud.classList.contains('jinpei-collapsed'), false);

    assert.match(hud.innerHTML, /id="jinpei-hud-title-text"[^>]*display:\s*inline;?[^>]*>神奇海螺<\/span>/, '展开时标题文字应正常展示');
    assert.match(hud.innerHTML, new RegExp('id="jinpei-hud-version"[^>]*>v' + pkg.version.replace(/\./g, '\\.') + '<\\/span>'), '展开时版本号应显示为 v' + pkg.version);
    assert.match(hud.innerHTML, /id="jinpei-hud-top-bar"[^>]*display:\s*block/, '展开时顶部彩条应正常显示');
});

test('[HUD 更新提醒] 检测到远程新版本时在 HUD 标题栏显示更新徽标与下载链接', async () => {
    const { t, getShadowRoot } = renderHUDTest([
        ['_kme_pref_col', 'false'],
        ['_kme_latest_version', '99.0.0']
    ]);
    await t.mainLoop();

    const shadow = getShadowRoot();
    const hud = shadow.children.find(c => c.id === 'jinpei-hud');
    assert.ok(hud);

    assert.match(hud.innerHTML, /id="jinpei-hud-update-badge"[^>]*display:\s*inline-block/, '存在新版本时应展示更新徽标');
    assert.match(hud.innerHTML, />更新 v99\.0\.0<\/a>/, '更新徽标应展示新版本号');
    assert.match(hud.innerHTML, /href="https:\/\/gh-proxy\.org\/[^"]*pc(?:\.user)?\.js"/, '更新徽标应链接到 userscript 下载地址');
});

test('[后台 Worker 防休眠] 支持创建定时调度器并在不支持 Worker 时平滑回退', async () => {
    const t = setup();
    assert.equal(typeof t.createWorkerInterval, 'function', '应提供 createWorkerInterval 调度器构造函数');

    let _tickCount = 0;
    const timer = t.createWorkerInterval(() => { _tickCount++; }, 50);
    assert.ok(timer, '调度器应正常返回控制句柄');
    assert.ok(timer.type === 'interval' || timer.type === 'worker', '句柄类型应为 worker 或 interval 回退');

    timer.clear();
});
