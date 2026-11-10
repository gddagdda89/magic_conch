    // ==========================================
    // 后台标签页 Worker 防休眠机制
    // 利用独立 Web Worker 辅助调度；后台冻结或系统睡眠仍可能中断运行
    // ==========================================
    function createWorkerInterval(callback, intervalMs) {
        const minInterval = Math.max(200, intervalMs || 2000);

        // 在 Node.js 测试环境或不支持 Web Worker 的环境平滑回退至原生 setInterval
        if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
            const id = typeof setInterval === 'function' ? setInterval(callback, minInterval) : null;
            return {
                type: 'interval',
                id,
                clear() {
                    try {
                        if (typeof clearInterval === 'function') clearInterval(id);
                    } catch (_) {}
                }
            };
        }

        try {
            const workerCode = `
                let timer = null;
                self.onmessage = function(e) {
                    if (e.data && e.data.type === 'start') {
                        if (timer) clearInterval(timer);
                        timer = setInterval(function() {
                            self.postMessage({ type: 'tick' });
                        }, Math.max(200, e.data.interval || 2000));
                    } else if (e.data && e.data.type === 'stop') {
                        if (timer) {
                            clearInterval(timer);
                            timer = null;
                        }
                    }
                };
            `;
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            const worker = new Worker(workerUrl);

            worker.onmessage = function(e) {
                if (e.data && e.data.type === 'tick') {
                    try {
                        callback();
                    } catch (err) {
                        console.error('[神奇海螺] Worker 定时执行回调异常:', err);
                    }
                }
            };

            worker.postMessage({ type: 'start', interval: minInterval });

            return {
                type: 'worker',
                worker,
                workerUrl,
                clear() {
                    try {
                        worker.postMessage({ type: 'stop' });
                        worker.terminate();
                        URL.revokeObjectURL(workerUrl);
                    } catch (_) {}
                }
            };
        } catch (_) {
            // 如遇到严格 CSP 限制（如禁止 blob: Worker），自动降级为原生 setInterval
            const id = typeof setInterval === 'function' ? setInterval(callback, minInterval) : null;
            return {
                type: 'interval',
                id,
                clear() {
                    try {
                        if (typeof clearInterval === 'function') clearInterval(id);
                    } catch (_) {}
                }
            };
        }
    }

    // ==========================================
    // Web Audio 后台防休眠机制
    // 利用 AudioContext 播放低音量振荡流作为辅助措施，
    // 不根据音频状态推断视频推进、心跳成功或浏览器调度豁免。
    // ==========================================
    let keepAliveAudioCtx = null;
    let keepAliveOscillator = null;
    let keepAliveGainNode = null;
    let keepAliveGestureHooked = false;
    let hasLoggedRunning = false;
    let hasLoggedSuspendedNotice = false;

    function reportAudioKeepAliveRunning() {
        if (!hasLoggedRunning) {
            hasLoggedRunning = true;
            if (typeof diagnosticConsole !== 'undefined' && typeof diagnosticConsole.log === 'function') {
                diagnosticConsole.log('【神奇海螺】音频辅助保活已启动 (AudioContext: running；后台运行效果待实际观测)');
            }
            if (typeof updateHUD === 'function') {
                updateHUD();
            }
        }
    }

    function setupUserGestureResume() {
        if (keepAliveGestureHooked || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
        keepAliveGestureHooked = true;
        const onUserGesture = () => {
            if (keepAliveAudioCtx && keepAliveAudioCtx.state === 'suspended') {
                keepAliveAudioCtx.resume().then(() => {
                    if (keepAliveAudioCtx && keepAliveAudioCtx.state === 'running') {
                        reportAudioKeepAliveRunning();
                    }
                }).catch(() => {});
            }
        };
        window.addEventListener('click', onUserGesture, { once: true, capture: true });
        window.addEventListener('keydown', onUserGesture, { once: true, capture: true });
    }

    function startAudioKeepAlive() {
        if (typeof window === 'undefined') return;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        try {
            if (!keepAliveAudioCtx || keepAliveAudioCtx.state === 'closed') {
                keepAliveAudioCtx = new AudioContextClass();
                keepAliveOscillator = null;
                keepAliveGainNode = null;
                hasLoggedRunning = false;
                hasLoggedSuspendedNotice = false;
            }

            if (!keepAliveOscillator) {
                const osc = keepAliveAudioCtx.createOscillator();
                const gain = keepAliveAudioCtx.createGain();
                // 低音量辅助音频；效果受浏览器策略与音频输出设置影响，
                // 30Hz 不保证不可闻，也不保证后台调度豁免。
                gain.gain.value = 0.002;
                osc.type = 'sine';
                osc.frequency.value = 30;
                osc.connect(gain);
                gain.connect(keepAliveAudioCtx.destination);
                osc.start();
                keepAliveOscillator = osc;
                keepAliveGainNode = gain;
            }

            if (keepAliveAudioCtx.state === 'running') {
                reportAudioKeepAliveRunning();
            } else if (keepAliveAudioCtx.state === 'suspended') {
                setupUserGestureResume();
                if (!hasLoggedSuspendedNotice && typeof diagnosticConsole !== 'undefined' && typeof diagnosticConsole.log === 'function') {
                    hasLoggedSuspendedNotice = true;
                    diagnosticConsole.log('【神奇海螺】Web Audio 后台防休眠就绪，当前等待手势激活 (点击 HUD 胶囊或页面任意处即可激活)');
                }
                keepAliveAudioCtx.resume().then(() => {
                    if (keepAliveAudioCtx && keepAliveAudioCtx.state === 'running') {
                        reportAudioKeepAliveRunning();
                    }
                }).catch((err) => {
                    if (typeof diagnosticConsole !== 'undefined' && typeof diagnosticConsole.warn === 'function') {
                        diagnosticConsole.warn('【神奇海螺】Web Audio 后台防休眠处于挂起等待手势状态 (受浏览器自动播放策略限制，与页面交互后自动激活):', err?.message || err);
                    }
                });
            }
        } catch (err) {
            if (typeof diagnosticConsole !== 'undefined' && typeof diagnosticConsole.warn === 'function') {
                diagnosticConsole.warn('【神奇海螺】Web Audio 后台防休眠启动受限:', err?.message || err);
            }
        }
    }

    function stopAudioKeepAlive() {
        keepAliveGestureHooked = false;
        hasLoggedRunning = false;
        hasLoggedSuspendedNotice = false;
        try {
            if (keepAliveOscillator) {
                try { keepAliveOscillator.stop(); } catch (_) {}
                try { keepAliveOscillator.disconnect(); } catch (_) {}
                keepAliveOscillator = null;
            }
            if (keepAliveGainNode) {
                try { keepAliveGainNode.disconnect(); } catch (_) {}
                keepAliveGainNode = null;
            }
            if (keepAliveAudioCtx) {
                if (keepAliveAudioCtx.state !== 'closed' && typeof keepAliveAudioCtx.close === 'function') {
                    keepAliveAudioCtx.close().catch(() => {});
                }
                keepAliveAudioCtx = null;
                if (typeof diagnosticConsole !== 'undefined' && typeof diagnosticConsole.log === 'function') {
                    diagnosticConsole.log('【神奇海螺】Web Audio 后台防休眠已释放');
                }
                if (typeof updateHUD === 'function') {
                    updateHUD();
                }
            }
        } catch (_) {}
    }

    function isAudioKeepAliveActive() {
        return !!(keepAliveAudioCtx && keepAliveOscillator && keepAliveAudioCtx.state === 'running');
    }
