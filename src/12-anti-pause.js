    // ==========================================
    // 2. 防暂停与防后台挂机机制（动态联动：运行生效，暂停释放）
    // ==========================================
    let nativeHiddenGetter = null;
    let nativeVisibilityGetter = null;

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
                    const isAudioProtected = typeof isAudioKeepAliveActive === 'function' && isAudioKeepAliveActive();
                    if (isAudioProtected) {
                        // 已经拥有后台防休眠发声豁免，免除浏览器后台节流，无需弹出刺眼的警告横幅
                        state.minimizedAlertText = '';
                        diagnosticConsole.log(`【神奇海螺】检测到窗口从后台恢复（后台约 ${durText}），后台防休眠持续生效中，心跳与定时器正常运行。`);
                    } else {
                        const alertMsg = `检测到窗口在后台约 ${durText}（后台防休眠尚未激活）。建议点击 HUD 激活防休眠胶囊，或保持窗口展开挂课。`;
                        state.minimizedAlertText = alertMsg;
                        diagnosticConsole.warn(`【神奇海螺】⚠️ 检测到窗口从后台恢复（挂起约 ${durText}，防休眠未激活）。已在 HUD 提示激活防休眠！`);
                    }
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

