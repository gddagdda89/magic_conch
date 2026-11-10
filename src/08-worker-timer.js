    // ==========================================
    // 后台标签页 Worker 防休眠机制
    // 利用独立 Web Worker 线程的心跳调度，彻底免疫 Chromium 对后台标签页的定时器节流降频
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
    // Web Audio 极微声波静音保活机制
    // 利用 AudioContext 播放极微声波振荡流（符合 Chrome 88 官方规范，高于 -60 dB 判定线），
    // 产生真实 audible 特征（点亮标签页小喇叭），使 Chromium 调度器全面豁免锁屏与后台定时器节流（Timer Throttling）
    // ==========================================
    let keepAliveAudioCtx = null;
    let keepAliveOscillator = null;
    let keepAliveGainNode = null;
    let keepAliveGestureHooked = false;
    let hasLoggedRunning = false;

    function reportAudioKeepAliveRunning() {
        if (!hasLoggedRunning) {
            hasLoggedRunning = true;
            if (typeof diagnosticConsole !== 'undefined' && typeof diagnosticConsole.log === 'function') {
                diagnosticConsole.log('【神奇海螺】Web Audio 保活已激活 (AudioContext: running，增益 0.002@30Hz，获得浏览器发声豁免免除后台节流)');
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
            }

            if (!keepAliveOscillator) {
                const osc = keepAliveAudioCtx.createOscillator();
                const gain = keepAliveAudioCtx.createGain();
                // 增益 0.002（约 -54 dBFS）高于 Chromium 静音门限（-60 dBFS），
                // 搭配 30Hz 超低频（人耳完全不可闻，但在浏览器音频流中持续产生 RMS 能量，稳定获得 audible 豁免）
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
                keepAliveAudioCtx.resume().then(() => {
                    if (keepAliveAudioCtx && keepAliveAudioCtx.state === 'running') {
                        reportAudioKeepAliveRunning();
                    }
                }).catch((err) => {
                    if (typeof diagnosticConsole !== 'undefined' && typeof diagnosticConsole.warn === 'function') {
                        diagnosticConsole.warn('【神奇海螺】Web Audio 保活处于挂起等待手势状态 (受浏览器自动播放策略限制，点击页面后自动激活):', err?.message || err);
                    }
                });
            }
        } catch (err) {
            if (typeof diagnosticConsole !== 'undefined' && typeof diagnosticConsole.warn === 'function') {
                diagnosticConsole.warn('【神奇海螺】Web Audio 保活启动受限:', err?.message || err);
            }
        }
    }

    function stopAudioKeepAlive() {
        keepAliveGestureHooked = false;
        hasLoggedRunning = false;
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
                    diagnosticConsole.log('【神奇海螺】Web Audio 静音保活已释放');
                }
            }
        } catch (_) {}
    }

    function isAudioKeepAliveActive() {
        return !!(keepAliveAudioCtx && keepAliveOscillator && keepAliveAudioCtx.state === 'running');
    }
