    // ==========================================
    // 2. 防暂停与防后台挂机机制（动态联动：运行生效，暂停释放）
    // ==========================================
    let nativeHiddenGetter = null;
    let nativeVisibilityGetter = null;

    // 只观察本页实际运行，不修改、补发或伪造平台心跳。
    const backgroundHealth = { tickAt: null, gapMs: 0, video: null, time: 0,
        progressAt: null, reportAt: null, epoch: null, recoveryPending: false };

    function sampleBackgroundHealth() {
        const now = Date.now();
        if (!state.enabled || backgroundHealth.epoch !== getLocalItem(ACCOUNT_EPOCH_KEY, '')) {
            Object.assign(backgroundHealth, { tickAt: null, gapMs: 0, video: null,
                progressAt: null, reportAt: null, recoveryPending: false, epoch: getLocalItem(ACCOUNT_EPOCH_KEY, '') });
            if (!state.enabled) return;
        }
        if (backgroundHealth.tickAt !== null) {
            const gap = Math.max(0, now - backgroundHealth.tickAt);
            if (gap > Math.max(10000, CONFIG.checkInterval * 5)) {
                backgroundHealth.gapMs = Math.max(backgroundHealth.gapMs, gap);
                backgroundHealth.recoveryPending = true;
                diagnosticConsole.warn('后台诊断：调度出现间隔，待核对播放和平台记录。', { gapSeconds: Math.round(gap / 1000) });
            }
        }
        backgroundHealth.tickAt = now;
        const video = IS_JNFTC ? jnDocuments().map(doc => doc.querySelector('video,audio')).find(Boolean) : document.querySelector('video');
        if (backgroundHealth.video !== video) {
            backgroundHealth.video = video;
            backgroundHealth.time = video?.currentTime || 0;
            backgroundHealth.progressAt = null;
            backgroundHealth.reportAt = null;
        } else if (video && !video.seeking && video.currentTime > backgroundHealth.time + 0.5) {
            backgroundHealth.progressAt = now;
        }
        backgroundHealth.time = video?.currentTime || 0;
        // 资源记录仅表示观察到请求完成，不能证明服务器已接受学习记录。
        if (IS_JNFTC && typeof performance !== 'undefined' && performance.getEntriesByType) {
            const loginId = document.querySelector('#txtLoginInfoId')?.value;
            if (loginId) for (const entry of performance.getEntriesByType('resource')) {
                try {
                    const url = new URL(entry.name, location.href);
                    if (url.origin !== new URL(location.href).origin || !/\/SetTime\.ashx$/i.test(url.pathname) ||
                        url.searchParams.get('LoginInfoId') !== loginId || !/^\d+$/.test(url.searchParams.get('pTime') || '')) continue;
                    const at = performance.timeOrigin + entry.responseEnd;
                    if (entry.responseEnd > 0 && Number.isFinite(at) && at <= now) backgroundHealth.reportAt = Math.max(backgroundHealth.reportAt || 0, at);
                } catch (_) { /* 忽略不可识别的资源记录。 */ }
            }
        }
    }

    function backgroundHealthText() {
        const now = Date.now();
        const age = at => at === null ? '待确认' : `${Math.max(0, Math.floor((now - at) / 1000))}秒前`;
        return `播放推进：${age(backgroundHealth.progressAt)}；平台上报请求：${age(backgroundHealth.reportAt)}（完成状态以平台为准）`;
    }

    function reconcileBackgroundRecovery() {
        if (!backgroundHealth.recoveryPending || getNativeHidden() || !state.enabled) return;
        backgroundHealth.recoveryPending = false;
        // 保留原来的课程、重播次数和未完成操作，由正常流程核对登录、完成标记并恢复。
        watchdogRuntime.lastProgressTimestamp = Date.now();
        if (IS_JNFTC && jnProgress) jnProgress.suspended = true;
        diagnosticConsole.log('后台恢复：重新核对当前页面，沿用原有播放、完成确认与有限重播流程。', {
            gapSeconds: Math.round(backgroundHealth.gapMs / 1000),
            paused: backgroundHealth.video?.paused, ended: backgroundHealth.video?.ended,
        });
    }

    function getNativeHidden() {
        try {
            if (typeof nativeHiddenGetter === 'function') return Boolean(nativeHiddenGetter());
        } catch (_) {}
        return typeof document !== 'undefined' ? Boolean(document.hidden) : false;
    }

    function getNativeVisibilityState() {
        try {
            if (typeof nativeVisibilityGetter === 'function') return String(nativeVisibilityGetter());
        } catch (_) {}
        return typeof document !== 'undefined' ? String(document.visibilityState || 'visible') : 'visible';
    }

    function formatMinimizationDuration(sec) {
        if (sec < 60) return `${sec} 秒`;
        const mins = Math.floor(sec / 60);
        const rem = sec % 60;
        return rem > 0 ? `${mins} 分 ${rem} 秒` : `${mins} 分钟`;
    }

    function handleMinimizationChange() {
        if (typeof document === 'undefined') return;
        const isHidden = getNativeHidden() || getNativeVisibilityState() === 'hidden';
        state.isCurrentlyMinimized = isHidden;

        if (isHidden) {
            if (!state.minimizedAt) {
                backgroundHealth.gapMs = 0;
                state.minimizedAt = Date.now();
                diagnosticConsole.log("【神奇海螺】检测到窗口进入最小化/后台隐藏状态...");
            }
        } else {
            if (state.minimizedAt) {
                const durationSec = Math.round((Date.now() - state.minimizedAt) / 1000);
                state.minimizedAt = 0;
                state.lastMinimizationDurationSec = durationSec;
                state.lastMinimizationRestoredAt = Date.now();

                // 唤醒看门狗时间戳，避免恢复瞬间误判卡死
                if (typeof watchdogRuntime !== 'undefined' && watchdogRuntime) {
                    watchdogRuntime.lastProgressTimestamp = Date.now();
                }

                // 仅当挂起 3 秒以上且处于运行状态时触发提示
                if (durationSec >= 3 && state.enabled) {
                    const durText = formatMinimizationDuration(durationSec);
                    backgroundHealth.recoveryPending = true;
                    state.minimizedAlertText = `后台约 ${durText}，正在核对播放与学习记录。音频辅助不保证后台持续运行。`;
                    diagnosticConsole.log(`后台恢复：${durText}；${backgroundHealthText()}`);
                    if (typeof updateHUD === 'function') {
                        updateHUD();
                    }
                }
            }
        }
    }

    function setupMinimizationMonitor() {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;
        if (typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', () => {
                handleMinimizationChange();
            }, true);
        }
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('focus', () => {
                handleMinimizationChange();
            }, true);
            window.addEventListener('blur', () => {
                handleMinimizationChange();
            }, true);
        }
    }
    setupMinimizationMonitor();

    function enableAntiPause() {
        try {
            const origHiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden') || Object.getOwnPropertyDescriptor(document, 'hidden');
            const origVisibilityDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState') || Object.getOwnPropertyDescriptor(document, 'visibilityState');
            const origWebkitVisibilityDesc = Object.getOwnPropertyDescriptor(document, 'webkitVisibilityState') || Object.getOwnPropertyDescriptor(Document.prototype, 'webkitVisibilityState');
            const origWebkitVisibility = document.webkitVisibilityState;

            nativeHiddenGetter = () => origHiddenDesc && origHiddenDesc.get ? origHiddenDesc.get.call(document) : (origHiddenDesc && 'value' in origHiddenDesc ? origHiddenDesc.value : false);
            nativeVisibilityGetter = () => origVisibilityDesc && origVisibilityDesc.get ? origVisibilityDesc.get.call(document) : (origVisibilityDesc && 'value' in origVisibilityDesc ? origVisibilityDesc.value : 'visible');

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
                handleMinimizationChange();
                if (state.enabled) e.stopImmediatePropagation();
            }, true);

            diagnosticConsole.log("【神奇海螺】防暂停与防后台机制已初始化（随【开始/暂停】动态生效）。");
        } catch (e) {
            diagnosticConsole.warn("【神奇海螺】防暂停注入异常:", e);
        }
    }

