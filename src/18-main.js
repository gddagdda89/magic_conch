    // ==========================================
    // 5. 主循环调度器
    // ==========================================
    function mainLoop() {
        if (!syncAccountContext()) return;
        syncRetryEpoch();
        createHUD();
        renderTaskSelection();
        if (IS_JNFTC) { updateHUD(); return handleJnPlatform(); }

        // 未手动启动时，不执行任何自动化逻辑（包括不自动弹窗确认、不自动播放、不自动跳转）
        if (!state.enabled) return;

        observeVideoPlayback(document.querySelector('video'));
        loadTaskCatalog().then(() => {
            renderTaskSelection();
            if (state.enabled && currentClaim && pickNextTask(getPendingTasks(), getCurrentMapId())) {
                spawnTaskWorker().catch(error => diagnosticConsole.warn('并发窗口唤起失败:', error.message));
            }
        });

        autoDismissDialogs();

        const url = location.href;

        if (url.includes('/home/index') || url.includes('/home/login') || url.includes('/home/portal')) {
            handleLoginAndIndex();
        } else if (url.includes('/home/my/myTask')) {
            return handleMyTaskPage();
        } else if (url.includes('/home/training/detail/')) {
            handleDetailPage();
        } else if (url.includes('/home/training/study/') || url.includes('/home/courseplay/')) {
            return handleStudyPage();
        }
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('storage', event => {
            if (event.key === ACCOUNT_ID_KEY || event.key === ACCOUNT_EPOCH_KEY) syncAccountContext();
        });
        window.addEventListener('beforeunload', () => {
            if (!state.enabled || !CONFIG.debugPlayback) return;
            const video = document.querySelector('video');
            diagnosticConsole.log('播放诊断：页面即将卸载', {
                currentTime: video?.currentTime, duration: video?.duration,
                switching: state.isSwitching, actionPending: state.isActionPending,
            });
        });
    }
    enableLockStealth();
    enableStorageStealth();
    if (!IS_JNFTC) enableAntiPause();
    const workerTimer = createWorkerInterval(mainLoop, CONFIG.checkInterval);
    setTimeout(mainLoop, 1000);
    checkScriptUpdate().catch(() => {});

    recordDiagnostic('INFO', '脚本初始化 v1.8.4，运行状态：' + (state.enabled ? '已启动' : '待启动') + ' (防休眠: ' + (workerTimer.type === 'worker' ? 'Web Worker 独立线程' : '主线程计时器') + ')' + (accountResetOnStartup ? '；已清理上次账号的学习状态' : ''));
