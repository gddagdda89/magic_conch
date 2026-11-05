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
