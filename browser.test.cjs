// Real Chrome DOM, events, and storage; isolated fixtures never open the learning platform.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
    const chrome = process.env.CHROME_PATH || (process.platform === 'win32'
        ? path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')
        : '/usr/bin/google-chrome');
    assert.ok(fs.existsSync(chrome), 'Chrome missing; set CHROME_PATH');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'conch-browser-test-'));
    // 一秒静音 WAV，用真实媒体 ended 事件验证平台先归零的顺序。
    const wav = Buffer.alloc(44 + 16000);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
    const submittedTimes = [];
    const submittedRatings = [];
    const ratingScoreLists = [];
    const server = http.createServer((_req, res) => {
        if (_req.url.startsWith('/WebTraining14/Web/MyClass/SetTime.ashx')) {
            submittedTimes.push(new URL(_req.url, 'http://fixture').searchParams.get('pTime'));
            res.setHeader('Content-Type', 'application/javascript'); res.end(''); return;
        }
        if (_req.url.startsWith('/exam-frameset')) {
            res.setHeader('Content-Type', 'text/html');
            res.end('<html><frameset rows="80,*"><frame name="topFrame" src="/exam-header"><frame name="mainFrame" src="/exam-answers"></frameset></html>'); return;
        }
        if (_req.url.startsWith('/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx')) {
            const respond = () => {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end('<html><body><main id="fixture"></main><a class="a-2" style="background-image:url(ico_kecheng_t3_over.png)"></a><a class="a-4" style="background-image:url(CourseOver.png)"></a></body></html>');
            };
            if (_req.method === 'POST') {
                let body = ''; _req.on('data', chunk => { body += chunk; });
                _req.on('end', () => { const data = new URLSearchParams(body); submittedRatings.push(Object.fromEntries(data)); ratingScoreLists.push(data.getAll('score')); respond(); });
            } else respond();
            return;
        }
        if (_req.url.startsWith('/tail.wav')) { res.setHeader('Content-Type', 'audio/wav'); res.end(wav); return; }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        if (_req.url.startsWith('/WebTraining14/Web/MyDuty/MyDutyList.aspx')) {
            const second = _req.method === 'POST';
            const id = second ? 'task-b' : 'task-a';
            res.end('<html><body><form><input type="hidden" name="__VIEWSTATE" value="fixture">' +
                '<div id="lblCurrDuty"><div><div>金培任务' + id + '<a href="DutyShow.aspx?DutyId=' + id + '"></a></div></div></div>' +
                '<span id="PageSplit1_LbPageIndex">' + (second ? '2' : '1') + '</span><span id="PageSplit1_LbPageCount">2</span>' +
                '<a id="PageSplit1_BtnNext" href="javascript:__doPostBack(\'PageSplit1$BtnNext\',\'\')">下一页</a></form></body></html>');
            return;
        }
        res.end('<!doctype html><html><body><main id="fixture"></main></body></html>');
    });
    let child;
    let ws;
    let peerWs;
    let call;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        child = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
            '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
        let launchError;
        child.on('error', error => { launchError = error; });
        const portFile = path.join(profile, 'DevToolsActivePort');
        const deadline = Date.now() + 15000;
        while (!fs.existsSync(portFile) && Date.now() < deadline && !launchError) await delay(100);
        if (launchError) throw launchError;
        assert.ok(fs.existsSync(portFile), 'Chrome debugging endpoint did not start');
        const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
        const base = 'http://127.0.0.1:' + port;
        const url = 'http://127.0.0.1:' + server.address().port + '/home/my/myTask';
        const target = await (await fetch(base + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json();
        ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
        let sequence = 0;
        const pending = new Map();
        ws.onmessage = event => {
            const message = JSON.parse(event.data);
            const entry = pending.get(message.id);
            if (entry) { clearTimeout(entry.timeout); pending.delete(message.id); entry.resolve(message); }
        };
        call = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++sequence;
            const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
            pending.set(id, { resolve, timeout });
            ws.send(JSON.stringify({ id, method, params }));
        });
        const evaluate = async expression => {
            const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
            if (result.error || result.result.exceptionDetails) throw new Error(JSON.stringify(result.error || result.result.exceptionDetails));
            return result.result.result.value;
        };
        for (let tries = 0; tries < 50 && !await evaluate("!!document.getElementById('fixture')"); tries++) await delay(100);
        await evaluate(`document.getElementById('fixture').innerHTML = '<div class="group cursor-pointer" data-tp-id="11">地图一<br>学习地图 进行中</div><div class="group cursor-pointer" data-tp-id="12">地图二<br>学习地图 进行中</div>';document.querySelectorAll('[data-tp-id]').forEach(el=>{el.dataset.clicks='0';el.addEventListener('click',()=>{el.dataset.clicks=String(Number(el.dataset.clicks)+1);});});`);
        let source = fs.readFileSync(path.join(__dirname, 'pc.js'), 'utf8');
        source = source.replace('    setInterval(mainLoop, CONFIG.checkInterval);', '').replace('    setTimeout(mainLoop, 1000);', '');
        source = source.replace('const workerTimer = createWorkerInterval(mainLoop, CONFIG.checkInterval);', "const workerTimer = {type:'test'};");
        source = source.replace(/\}\)\(\);\s*$/, 'CONFIG.enableJitter=false;CONFIG.debugPlayback=true;window.testApi={state,mainLoop,pauseAutomation,getTaskSelection,getSubVideoKey,getCurrentCourseId,switchToNextSubVideoOrCourse,handleMyTaskPage,saveTaskSelection,setConcurrencySetting,observeVideoPlayback,handleVideoPlayback,formatDiagnosticLogs,hasPlaybackCompletion,isItemCompleted,getCourseOutcomes};})();');
        await evaluate(source);
        await evaluate("testApi.mainLoop();document.getElementById('_kme_tool_host').shadowRoot.querySelectorAll('#jinpei-task-list input')[0].click()");
        assert.equal(await evaluate("getComputedStyle(document.getElementById('_kme_tool_host').shadowRoot.getElementById('jinpei-concurrency-controls')).display"), 'flex');
        assert.deepEqual(await evaluate('testApi.getTaskSelection().ids'), ['12']);
        await evaluate("document.getElementById('_kme_tool_host').shadowRoot.getElementById('jinpei-toggle-btn').click()");
        await delay(1300);
        assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('[data-tp-id]')).map(e=>Number(e.dataset.clicks))"), [0, 1]);
        await evaluate("testApi.pauseAutomation('test');history.pushState({},'', '/home/training/study/12');document.getElementById('fixture').innerHTML='<div id=\"first\" class=\"group cursor-pointer text-primary\" data-course-id=\"101\" data-chapter-id=\"21\">同名小节<br>00:01:00<svg data-icon=\"check\"></svg></div><div id=\"next\" class=\"group cursor-pointer\" data-course-id=\"101\" data-chapter-id=\"22\">同名小节<br>00:01:00</div>';window.nextClicks=0;document.getElementById('next').addEventListener('click',()=>nextClicks++);testApi.state.enabled=true");
        await evaluate('testApi.state.enabled=false;testApi.mainLoop()');
        assert.deepEqual(await evaluate("(()=>{const r=document.getElementById('_kme_tool_host').shadowRoot;return {visible:r.getElementById('jinpei-task-selection').style.display,checks:Array.from(r.querySelectorAll('#jinpei-task-list input')).map(e=>e.checked)};})()"), { visible: 'block', checks: [false, true] });
        await evaluate("document.getElementById('_kme_tool_host').shadowRoot.querySelectorAll('#jinpei-task-list input')[0].click();testApi.state.enabled=true");
        assert.equal(await evaluate('testApi.getCurrentCourseId()'), '101');
        assert.notEqual(await evaluate("testApi.getSubVideoKey(document.getElementById('first'))"), await evaluate("testApi.getSubVideoKey(document.getElementById('next'))"));
        await evaluate('testApi.switchToNextSubVideoOrCourse()');
        assert.equal(await evaluate('nextClicks'), 1);
        await evaluate("testApi.pauseAutomation('test finished')");
        await evaluate(`(async()=>{
            document.getElementById('first').querySelector('svg').remove();
            window.tailVideo=document.createElement('video');tailVideo.muted=true;tailVideo.src='/tail.wav';
            document.getElementById('fixture').appendChild(tailVideo);
            window.nativeEndSeen=false;window.nativePlayCount=0;
            tailVideo.addEventListener('ended',()=>{tailVideo.currentTime=0;nativeEndSeen=true;});
            tailVideo.addEventListener('play',()=>nativePlayCount++);
            testApi.state.enabled=true;testApi.observeVideoPlayback(tailVideo);await tailVideo.play();
        })()`);
        for (let tries = 0; tries < 30 && !await evaluate('nativeEndSeen'); tries++) await delay(100);
        assert.equal(await evaluate('nativeEndSeen'), true);
        await evaluate('testApi.handleVideoPlayback(tailVideo)');
        assert.deepEqual(await evaluate('({switching:testApi.state.isSwitching,plays:nativePlayCount,paused:tailVideo.paused})'),
            { switching: true, plays: 1, paused: true });
        assert.match(await evaluate('testApi.formatDiagnosticLogs()'), /"endedEvent":true/);
        await evaluate("testApi.pauseAutomation('native ended verified')");
        await evaluate(`(async()=>{
            tailVideo.addEventListener('ended',()=>{
                document.getElementById('first').classList.remove('text-primary');
                document.getElementById('next').classList.add('text-primary');
                tailVideo.src='/tail.wav?new-section';
            },{once:true});
            tailVideo.src='/tail.wav?old-section';nativeEndSeen=false;
            testApi.state.enabled=true;testApi.observeVideoPlayback(tailVideo);await tailVideo.play();
        })()`);
        for (let tries = 0; tries < 30 && !await evaluate('nativeEndSeen'); tries++) await delay(100);
        assert.equal(await evaluate('nativeEndSeen'), true);
        assert.equal(await evaluate("testApi.hasPlaybackCompletion(tailVideo,document.getElementById('next'))"), false);
        await evaluate("testApi.pauseAutomation('automatic next-section verified')");
        assert.deepEqual(await evaluate(`(()=>{
            const el=document.createElement('div');
            el.innerHTML='<div class="truncate">100%客户满意度</div><div>0%</div><svg><path fill="#1677ff"></path></svg>';
            document.getElementById('fixture').appendChild(el);
            const pending=testApi.isItemCompleted(el);
            el.children[1].textContent='100%';const completed=testApi.isItemCompleted(el);el.remove();
            return {pending,completed};
        })()`), { pending: false, completed: true });
        await evaluate(`
            document.getElementById('fixture').innerHTML='<video muted></video><div class="group cursor-pointer text-primary" data-course-id="101" data-chapter-id="21">已看小节<br>00:01:00<svg data-icon="check"></svg></div><div class="ant5-collapse-item"><div id="chapter-header" class="ant5-collapse-header" aria-expanded="false" aria-controls="chapter-panel">第二章</div><div id="chapter-panel" class="ant5-collapse-content"></div></div>';
            window.delayedNextClicks=0;
            document.getElementById('chapter-header').addEventListener('click',()=>{
                document.getElementById('chapter-header').setAttribute('aria-expanded','true');
                setTimeout(()=>{
                    document.getElementById('chapter-panel').innerHTML='<div id="delayed-next" class="group cursor-pointer" data-course-id="101" data-chapter-id="22">未看小节<br>00:01:00</div>';
                    document.getElementById('delayed-next').addEventListener('click',()=>delayedNextClicks++);
                },600);
            });
            testApi.state.enabled=true;testApi.switchToNextSubVideoOrCourse();
        `);
        await delay(300);
        assert.equal(await evaluate('testApi.getCourseOutcomes().length'), 0);
        assert.equal(await evaluate('delayedNextClicks'), 0);
        for (let tries = 0; tries < 40 && !await evaluate('delayedNextClicks'); tries++) await delay(100);
        assert.equal(await evaluate('delayedNextClicks'), 1);
        assert.equal(await evaluate('testApi.getCourseOutcomes().length'), 0);
        await evaluate("testApi.pauseAutomation('delayed chapter verified')");
        const taskFixture = `history.pushState({},'', '/home/my/myTask');document.getElementById('fixture').innerHTML='<div class="group cursor-pointer" data-tp-id="11">地图一<br>学习地图 进行中</div><div class="group cursor-pointer" data-tp-id="12">地图二<br>学习地图 进行中</div>';document.querySelectorAll('[data-tp-id]').forEach(el=>{el.dataset.clicks='0';el.addEventListener('click',()=>{el.dataset.clicks=String(Number(el.dataset.clicks)+1);});});`;
        await evaluate(taskFixture + "testApi.saveTaskSelection({mode:'all'});testApi.setConcurrencySetting(2)");
        const peer = await (await fetch(base + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json();
        peerWs = new WebSocket(peer.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { peerWs.onopen = resolve; peerWs.onerror = reject; });
        let peerSequence = 0;
        const peerEvaluate = expression => new Promise((resolve, reject) => {
            const id = ++peerSequence;
            const timeout = setTimeout(() => reject(new Error('Peer CDP timeout')), 10000);
            peerWs.onmessage = event => {
                const result = JSON.parse(event.data);
                if (result.id !== id) return;
                clearTimeout(timeout);
                if (result.error || result.result.exceptionDetails) reject(new Error(JSON.stringify(result.error || result.result.exceptionDetails)));
                else resolve(result.result.result.value);
            };
            peerWs.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
        });
        for (let tries = 0; tries < 50 && !await peerEvaluate("!!document.getElementById('fixture')"); tries++) await delay(100);
        await peerEvaluate(taskFixture + source);
        await Promise.all([
            evaluate('testApi.state.enabled=true;testApi.handleMyTaskPage()'),
            peerEvaluate('testApi.state.enabled=true;testApi.handleMyTaskPage()'),
        ]);
        let assignments;
        const assignmentDeadline = Date.now() + 10000;
        do {
            assignments = await Promise.all([
                evaluate("Array.from(document.querySelectorAll('[data-tp-id]')).map(e=>Number(e.dataset.clicks))"),
                peerEvaluate("Array.from(document.querySelectorAll('[data-tp-id]')).map(e=>Number(e.dataset.clicks))"),
            ]);
            if (assignments.every(counts => counts.reduce((a, b) => a + b, 0) === 1)) break;
            await delay(200);
        } while (Date.now() < assignmentDeadline);
        if (assignments.some(counts => counts.reduce((a, b) => a + b, 0) !== 1)) {
            console.log('Scheduler diagnostics:', await evaluate('({url:location.href,state:testApi.state,selection:testApi.getTaskSelection()})'),
                await peerEvaluate('({url:location.href,state:testApi.state,selection:testApi.getTaskSelection()})'));
        }
        assert.deepEqual(assignments.sort((a, b) => b[0] - a[0]), [[1, 0], [0, 1]]);
        await evaluate("testApi.pauseAutomation('switch fixture')");
        await peerEvaluate("testApi.pauseAutomation('switch fixture')");
        await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/WebTraining14/Website/Index.aspx' });
        for (let tries = 0; tries < 50 && !await evaluate("location.pathname.includes('WebTraining14')&&!!document.getElementById('fixture')"); tries++) await delay(100);
        const jnSource = source.replace('const PLATFORM = detectPlatform(location.href);', "const PLATFORM = 'jnftc';")
            .replace('CONFIG.enableJitter=false;', 'CONFIG.jnAutoReport=false;CONFIG.enableJitter=false;')
            .replace('getCourseOutcomes};', 'getCourseOutcomes,CONFIG,getConcurrencySetting,setConcurrencySetting,loadJnTaskCatalog,getTaskCatalog,jnReadVideos,jnHandlePlayer,jnReportStudyTime,jnHandleExam,jnSubmitRating,setJnContext:value=>{jnContext=value;jnSave();},getJnContext:()=>jnContext,getJnProgress:()=>jnProgress};');
        await evaluate(jnSource);
        await evaluate('testApi.mainLoop();testApi.loadJnTaskCatalog(true)');
        assert.equal(await evaluate('testApi.getTaskCatalog().length'), 2);
        await evaluate('testApi.mainLoop()');
        assert.equal(await evaluate("document.getElementById('_kme_tool_host').shadowRoot.textContent.includes('当前平台：江南金培')"), true);
        assert.equal(await evaluate("document.getElementById('_kme_tool_host').shadowRoot.getElementById('jinpei-open-tab-btn').disabled"), true);
        assert.deepEqual(await evaluate("(()=>{const r=document.getElementById('_kme_tool_host').shadowRoot;return ['jinpei-concurrency-controls','jinpei-open-tab-btn'].map(id=>getComputedStyle(r.getElementById(id)).display);})()"), ['none', 'none']);
        assert.equal(await evaluate("testApi.getConcurrencySetting()"), 1);
        assert.equal(await evaluate("testApi.setConcurrencySetting(4)"), 1);
        assert.equal(await evaluate("testApi.getConcurrencySetting()"), 1);
        assert.equal(await evaluate("document.getElementById('_kme_tool_host').shadowRoot.querySelectorAll('#jinpei-task-list input').length"), 2);
        assert.equal(await evaluate('testApi.state.enabled'), false);
        await call('Page.bringToFront');
        await evaluate(`
            history.pushState({},'', '/WebTraining14/Web/MyClass/OnLineRead.aspx?CoursewareId=ware-1');
            document.getElementById('fixture').innerHTML='<input id="txtLoginInfoId"><video muted src="/tail.wav"></video>';
            window.jnVideo=document.querySelector('video');
            jnVideo.addEventListener('ended',()=>{jnVideo.currentTime=0;});
            testApi.state.enabled=true;testApi.jnHandlePlayer();
        `);
        for (let tries = 0; tries < 50 && !await evaluate('!!testApi.getJnProgress()?.endedAt'); tries++) await delay(100);
        if (!await evaluate('!!testApi.getJnProgress()?.endedAt')) console.log('JNFTC playback diagnostics:', await evaluate('({paused:jnVideo.paused,readyState:jnVideo.readyState,currentTime:jnVideo.currentTime,error:jnVideo.error?.message,state:testApi.state.statusText,progress:testApi.getJnProgress(),logs:testApi.formatDiagnosticLogs()})'));
        assert.equal(await evaluate('!!testApi.getJnProgress().endedAt'), true);
        await evaluate('testApi.jnHandlePlayer()');
        assert.match(await evaluate('testApi.state.statusText'), /等待平台同步/);
        await evaluate("testApi.pauseAutomation('jnftc fixture finished')");
        await evaluate(`(async()=>{testApi.CONFIG.jnAutoReport=true;testApi.state.enabled=true;testApi.setJnContext({index:0});
            document.getElementById('txtLoginInfoId').value='fixture-session';
            window.myload=function(){window.tt=setInterval(()=>{window.m_time++;if(window.m_time%60===0){const s=document.createElement('script');s.src='/WebTraining14/Web/MyClass/SetTime.ashx?LoginInfoId=fixture-session&pTime='+window.m_time;document.head.appendChild(s);}},1000);};
            const pending=testApi.jnReportStudyTime(jnVideo);window.initialNativeTime=window.m_time;await pending;})()`);
        assert.equal(await evaluate('initialNativeTime'), 59);
        assert.deepEqual(submittedTimes, ['60']);
        assert.equal(await evaluate('window.m_time'), 60);
        assert.equal(await evaluate('testApi.getJnContext().report.phase'), 'sent');
        assert.equal(await evaluate('testApi.getCourseOutcomes().length'), 0);
        await evaluate(`testApi.state.enabled=true;const pending=testApi.jnReportStudyTime(jnVideo);testApi.pauseAutomation('cancel before native tick');pending.catch(()=>{});`);
        await delay(1200);
        assert.deepEqual(submittedTimes, ['60']);
        await evaluate(`
            history.pushState({},'', '/WebTraining14/Web/MyExam/aspNet/ExamMain.aspx');
            document.getElementById('fixture').innerHTML='<iframe id="exam-answers"></iframe><iframe id="exam-header"></iframe>';
            window.examAnswerFrame=document.getElementById('exam-answers');window.examHeaderFrame=document.getElementById('exam-header');
            examAnswerFrame.contentDocument.body.innerHTML='<div class="tb_title"><input type="hidden" id="tmjo_1" value="B"><input id="tm_1_0" type="radio" name="q1"><input id="tm_1_1" type="radio" name="q1"></div><div class="tb_title"><input type="hidden" id="tmjo_2" value="AC"><input type="checkbox" id="tm_2_0"><input type="checkbox" id="tm_2_1"><input type="checkbox" id="tm_2_2"></div>';
            window.examSubmissions=0;
            window.examForm=examAnswerFrame.contentDocument.createElement('form');examForm.id='frmExam';examAnswerFrame.contentDocument.body.appendChild(examForm);
            examForm.submit=function(){examSubmissions++;};
            examAnswerFrame.contentWindow.initialize=function(){if(this.confirm('确认提交答卷吗？'))examForm.submit();};
            examHeaderFrame.contentWindow.SubmitExam=function(){examAnswerFrame.contentWindow.initialize();};
            testApi.setJnContext({courseUrl:location.origin+'/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=fixture',exam:{id:'fixture',phase:'opened',startedAt:Date.now()}});
            testApi.state.enabled=true;testApi.jnHandleExam();testApi.jnHandleExam();
        `);
        assert.equal(await evaluate('examSubmissions'), 0);
        assert.equal(await evaluate('testApi.getJnContext().exam.phase'), 'answered');
        await delay(2100);
        await evaluate('testApi.jnHandleExam()');
        for (let tries = 0; tries < 30 && !await evaluate('examSubmissions'); tries++) await delay(100);
        assert.equal(await evaluate('examSubmissions'), 1);
        assert.deepEqual(await evaluate("Array.from(examAnswerFrame.contentDocument.querySelectorAll('input:checked')).map(el=>el.id)"), ['tm_1_1', 'tm_2_0', 'tm_2_2']);
        assert.equal(await evaluate('testApi.getJnContext().exam.phase'), 'submitted');
        assert.equal(await evaluate('testApi.getCourseOutcomes().length'), 0);
        await evaluate(`examAnswerFrame.contentDocument.getElementById('tmjo_2').value='';
            testApi.setJnContext({courseUrl:location.origin+'/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=fixture',exam:{id:'fixture-2',phase:'opened',startedAt:Date.now()}});
            testApi.jnHandleExam();`);
        assert.equal(await evaluate('testApi.state.enabled'), false);
        assert.equal(await evaluate('examSubmissions'), 1);
        await evaluate(`
            history.pushState({},'', '/WebTraining14/Web/MyClass/Layer_CourseInfo.aspx?CourseId=fixture#none');
            document.getElementById('fixture').innerHTML='<form method="post"><input type="hidden" name="__VIEWSTATE" value="fixture"><input type="hidden" id="HidSpell" name="HidSpell" value="0"><i id="star_submit"><input type="hidden" name="score"></i><textarea id="txtArea" name="txtArea"></textarea><input type="submit" id="SubComment" name="SubComment" value="发表"></form>';
            const average=document.createElement('input');average.type='hidden';average.name='score';average.value='4.732';document.querySelector('form').prepend(average);
            for(let i=1;i<=5;i++){const img=document.createElement('img');img.src='/star-off.png';img.alt=String(i);document.getElementById('star_submit').appendChild(img);}
            window.jQuery=function(){return {raty:function(method,value){if(method==='score'&&value===5)document.querySelectorAll('#star_submit img').forEach(img=>{img.src='/star-on.png';});}};};
            testApi.setJnContext({courseId:'fixture',courseUrl:location.href,dutyUrl:location.origin+'/WebTraining14/Web/MyDuty/DutyShow.aspx?DutyId=fixture'});
            testApi.state.enabled=true;testApi.jnSubmitRating();window.starsBeforeSend=Array.from(document.querySelectorAll('#star_submit img')).filter(img=>img.src.endsWith('/star-on.png')).length;
        `);
        // 实际 HTTP 请求及界面状态都要满足五星，不能只检查赋值代码。
        const visibleStars = await evaluate('starsBeforeSend');
        assert.equal(visibleStars, 5);
        for (let tries = 0; tries < 50 && !await evaluate("!!document.querySelector('.a-4[style*=\"CourseOver\"]')"); tries++) await delay(100);
        assert.equal(submittedRatings.length, 1);
        assert.equal(submittedRatings[0].HidSpell, '5'); assert.equal(submittedRatings[0].score, '5');
        assert.deepEqual(ratingScoreLists, [['5']]);
        assert.equal(submittedRatings[0].txtArea, '好'); assert.equal(submittedRatings[0].__VIEWSTATE, 'fixture');
        await evaluate(jnSource);
        await evaluate('testApi.state.enabled=true;testApi.mainLoop()');
        for (let tries = 0; tries < 50 && !await evaluate("location.pathname.endsWith('/DutyShow.aspx')"); tries++) await delay(100);
        assert.equal(await evaluate("location.pathname.endsWith('/DutyShow.aspx')"), true);
        await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/exam-frameset' });
        for (let tries = 0; tries < 50 && !await evaluate("document.body?.tagName==='FRAMESET'&&frames.length===2&&frames[1].document.URL.endsWith('/exam-answers')&&frames[1].document.body?.tagName==='BODY'"); tries++) await delay(100);
        await evaluate(jnSource + ';testApi.mainLoop()');
        assert.equal(await evaluate("!!frames[1].document.getElementById('_kme_tool_host')?.shadowRoot.getElementById('jinpei-hud')"), true);
        console.log('Chrome passed: native ended reset and automatic next-section, strict completion markers, delayed chapter loading, task selector, single clicks, and cross-map scheduling with native Web Locks.');
        console.log('JNFTC Chrome passed: platform HUD, manual login wait, task pagination and selection, sequential controls, and native ended reset handling.');
        console.log('JNFTC actions passed: native 60*N-1 timer/report and pause cancellation, frame-based exam selection and single submission, incomplete-answer pause, and frameset HUD mounting.');
        console.log('JNFTC rating passed: real ASP form payload, single rating submission, course completion verification, and automatic return to tasks.');
    } finally {
        if (call && ws?.readyState === WebSocket.OPEN) await call('Browser.close').catch(() => {});
        ws?.close();
        peerWs?.close();
        if (child && child.exitCode === null) { await delay(500); if (child.exitCode === null) child.kill(); }
        server.closeAllConnections();
        server.close();
        // Delete only the profile this test created in the OS temp directory.
        assert.equal(path.dirname(profile), os.tmpdir());
        assert.ok(path.basename(profile).startsWith('conch-browser-test-'));
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
