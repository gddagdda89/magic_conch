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
    // 利用 AudioContext 播放极低音量振荡流，使 Chromium 标记标签页为媒体活动中，
    // 全面豁免锁屏与最小化时的 60 秒定时器节流（Timer Throttling）
    // ==========================================
    let keepAliveAudioCtx = null;
    let keepAliveOscillator = null;

    function startAudioKeepAlive() {
        if (typeof window === 'undefined') return;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        try {
            if (!keepAliveAudioCtx || keepAliveAudioCtx.state === 'closed') {
                keepAliveAudioCtx = new AudioContextClass();
            }
            if (keepAliveAudioCtx.state === 'suspended') {
                keepAliveAudioCtx.resume().catch(() => {});
            }
            if (!keepAliveOscillator) {
                const osc = keepAliveAudioCtx.createOscillator();
                const gain = keepAliveAudioCtx.createGain();
                // 极微音量 0.0001：人耳完全不可闻，但在浏览器音频渲染器中持续产生音频流，保持后台满频运行
                gain.gain.value = 0.0001;
                osc.type = 'sine';
                osc.frequency.value = 440;
                osc.connect(gain);
                gain.connect(keepAliveAudioCtx.destination);
                osc.start();
                keepAliveOscillator = osc;
                if (typeof diagnosticConsole !== 'undefined' && typeof diagnosticConsole.log === 'function') {
                    diagnosticConsole.log(`【神奇海螺】Web Audio 静音保活已激活 (AudioContext: ${keepAliveAudioCtx.state}，微声增益: 0.0001，免除锁屏与后台定时器节流)`);
                }
            }
        } catch (err) {
            if (typeof diagnosticConsole !== 'undefined' && typeof diagnosticConsole.warn === 'function') {
                diagnosticConsole.warn('【神奇海螺】Web Audio 静音保活启动受限:', err?.message || err);
            }
        }
    }

    function stopAudioKeepAlive() {
        try {
            if (keepAliveOscillator) {
                try { keepAliveOscillator.stop(); } catch (_) {}
                try { keepAliveOscillator.disconnect(); } catch (_) {}
                keepAliveOscillator = null;
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
