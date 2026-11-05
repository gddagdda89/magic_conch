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
