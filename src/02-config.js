    const SCRIPT_VERSION = '1.8.4';

    function detectPlatform(url) {
        return /^https:\/\/jnftc\.jnbank\.com\.cn(?:\/|$)/i.test(url) ? 'jnftc' : 'yizhi';
    }
    const PLATFORM = detectPlatform(location.href);
    const IS_JNFTC = PLATFORM === 'jnftc';
    const PLATFORM_NAME = IS_JNFTC ? '江南金培' : '易知';

    console.log(`[${formatLogTimestamp()}]`, "【神奇海螺 v1.8.4】脚本初始化启动...");

    // 配置项
    const CONFIG = {
        checkInterval: 2000,      // 常规轮询检查周期 (ms)
        heartbeatWait: 4000,       // 视频结束后等待最后一次心跳上报的时间 (ms)
        completionReplaySeconds: 30, // 未打勾时重播末尾时长
        maxCompletionReplays: 3,  // 单小节最多重播次数
        replayStartTimeout: 15000, // 回退与恢复播放的总等待时间
        replayPlayMaxAttempts: 3, // 每轮重播内，播放启动请求最多尝试次数
        catalogWaitTimeout: 15000, // 返回目录的最大等待时间 (ms)
        pageReadyTimeout: 20000,  // 进入任务/课程后等待页面实际就绪的时间
        learningRecordWait: 5000, // 平台记录加载的最长等待时间
        completionMarkerWait: 30000, // 总时长达标后额外等待小节完成标记
        myTaskUrl: "https://pc.kmelearning.com/jsncxyslhs/home/my/myTask",
        autoMute: true,           // 自动静音播放
        jnAutoReport: true,       // 金培：移植 Python 的课件时长提交，随后返回课程核验
        jnAutoExam: true,         // 金培：识别页面现成答案并交卷；不支持的题型暂停
        jnExamQuestionDelayMin: 2000, // 金培：每题拟人作答最小间隔 (2 秒)
        jnExamQuestionDelayMax: 5000, // 金培：每题拟人作答最大间隔 (5 秒)
        jnExamWaitPerQuestionMin: 8,  // 金培：整套试卷每题拟人交卷等待最小秒数 (8 秒/题)
        jnExamWaitPerQuestionMax: 15, // 金培：整套试卷每题拟人交卷等待最大秒数 (15 秒/题)
        playbackRate: 1.0,        // 正常播放速度
        debugPlayback: false,    // 排查播放问题时开启详细事件日志，日常使用关闭
        enableJitter: typeof navigator !== 'undefined', // 浏览器真实环境下开启拟人随机时间抖动
        watchdogStallTimeout: 30000,   // 看门狗：视频进度卡住判定超时阈值 (30 秒)
        watchdogMaxReloads: 5,        // 看门狗：单小节卡死最大刷新重试次数 (5 次)
        watchdogMaxConsecutiveFails: 3, // 看门狗：连续卡死加载失败最大容忍小节数 (3 节)
        defaultConcurrency: 1,        // 默认并发课程数 (1)
        maxConcurrency: 6,            // 最大并发课程数 (6)
        updateCheckInterval: 1800000, // 远程新版本自检周期 (30 分钟)
        updateUrl: 'https://gh-proxy.org/https://raw.githubusercontent.com/gddagdda89/magic_conch/refs/heads/main/pc.user.js',
    };

    // 会话存储与跨标签存储脱敏键名映射（前缀去标识化，并兼容历史键名读取）
    const STORAGE_KEYS = {
        running: '_kme_running_state',
        hudPos: '_kme_pref_pos',
        hudCollapsed: '_kme_pref_col',
        handledCourses: '_kme_h_courses',
        handledMaps: '_kme_h_maps',
        mapProgress: '_kme_m_progress',
        watchdog: '_kme_wd_state',       // 看门狗跨刷新状态
        completionReplay: '_kme_sync_replay', // 未打勾重播次数（跨刷新保留）
        failedVideos: '_kme_wd_failed',   // 卡死跳过的小节列表
        concurrency: '_kme_concurrency',  // 并发课程数设置 (1 ~ 6)
        fastMode: '_kme_fast_mode',       // 金培极速模式偏好设置 ('1' 开启，'0' 关闭)
        hudCache: '_kme_hud_cache',       // HUD 界面状态快照缓存（减少跨页面跳转闪动）
        activeTabs: '_kme_active_tabs',   // 并发多标签页活跃状态表
        diagnostics: '_kme_diagnostics', // 当前窗口的最近诊断日志（跨刷新）
        retryEpoch: '_kme_retry_epoch', // 通知暂停窗口清理旧的异常/处理缓存
        selectedTasks: '_kme_selected_tasks', // 用户明确选择的学习地图
        taskCatalog: '_kme_task_catalog', // 只缓存任务 ID 和显示名称，供任意页面选择
        lastUpdateCheck: '_kme_last_update_check', // 最近一次检查远程版本时间戳
        latestVersion: '_kme_latest_version',     // 缓存的远程最新版本号
    };
