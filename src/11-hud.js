    function createHUD() {
        if (getHUDElement('jinpei-hud')) return;

        const hudDocument = IS_JNFTC ? jnHUDDocument() : document;
        if (!hudDocument) return;

        let host = hudDocument.getElementById('_kme_tool_host');
        if (!host && typeof hudDocument.createElement === 'function' && hudDocument.body) {
            host = hudDocument.createElement('div');
            host.id = '_kme_tool_host';
            if (typeof host.setAttribute === 'function') {
                host.setAttribute('aria-hidden', 'true');
                host.setAttribute('data-nosnippet', 'true');
            }
            host.style.position = 'absolute';
            host.style.top = '0';
            host.style.left = '0';
            host.style.zIndex = '999999';
            hudDocument.body.appendChild(host);
        }

        if (host && typeof host.attachShadow === 'function' && !hudShadowRoot) {
            try {
                hudShadowRoot = host.attachShadow({ mode: 'open' });
            } catch (_) {
                hudShadowRoot = null;
            }
        }

        const renderRoot = hudShadowRoot || hudDocument.body;
        if (!renderRoot) return;

        ensureHUDStyles(renderRoot);

        const hud = document.createElement('div');
        hud.id = 'jinpei-hud';
        hud.className = 'jinpei-glass';
        hud.style.transition = 'transform 0.2s ease, box-shadow 0.25s ease, border-color 0.25s ease, width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.25s cubic-bezier(0.4, 0, 0.2, 1)';

        // 恢复拖动位置（脱敏键名）
        let savedPos = null;
        try {
            savedPos = JSON.parse(getStorageItem(STORAGE_KEYS.hudPos, 'jinpei_hud_pos'));
        } catch (_) {}

        if (savedPos && savedPos.left && savedPos.top) {
            hud.style.left = savedPos.left;
            hud.style.top = savedPos.top;
            hud.style.right = 'auto';
        } else {
            hud.style.top = '24px';
            hud.style.right = '24px';
        }

        let isCollapsed = false;
        try {
            isCollapsed = getStorageItem(STORAGE_KEYS.hudCollapsed, 'jinpei_hud_collapsed') === 'true';
        } catch (_) {}
        hud.style.width = isCollapsed ? '42px' : '320px';
        hud.style.height = isCollapsed ? '42px' : 'auto';
        hud.style.minWidth = isCollapsed ? '42px' : '320px';
        hud.style.borderRadius = isCollapsed ? '50%' : '18px';
        if (isCollapsed && hud.classList) {
            hud.classList.add('jinpei-collapsed');
        }

        const btnText = state.enabled ? "暂停自动学习" : "开始自动学习";
        const btnIcon = state.enabled ? "⏸" : "▶";
        const btnBg = state.enabled 
            ? "linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)" 
            : "linear-gradient(135deg, #10b981 0%, #059669 100%)";
        const btnShadow = state.enabled
            ? "0 4px 14px rgba(244, 63, 94, 0.3)"
            : "0 4px 14px rgba(16, 185, 129, 0.3)";
        const dotBg = state.enabled ? "#10b981" : "#f59e0b";
        const dotAnim = state.enabled ? "jinpei-pulse 2s infinite ease-in-out" : "jinpei-amber-pulse 2s infinite ease-in-out";

        const cachedVer = getLocalItem(STORAGE_KEYS.latestVersion, '');
        if (cachedVer && semverCompare(cachedVer, SCRIPT_VERSION) > 0) {
            state.remoteVersion = cachedVer;
        }
        const hasUpdate = Boolean(state.remoteVersion && semverCompare(state.remoteVersion, SCRIPT_VERSION) > 0);

        let cachedHUD = null;
        try {
            cachedHUD = JSON.parse(getStorageItem(STORAGE_KEYS.hudCache)) || null;
        } catch (_) {}

        const initTask = state.currentTask || cachedHUD?.task || '';
        const initCourse = state.currentCourse || cachedHUD?.course || (IS_JNFTC ? (jnContext?.courseTitle || '') : '');
        const initAllCourses = state.allCoursesProgress || cachedHUD?.allCoursesProg || '';
        const initSub = state.currentSubVideo || cachedHUD?.sub || '';
        const initCourseProg = state.courseTotalProgress || cachedHUD?.courseTotalProg || '';
        const initCoursePercent = state.courseTotalPercent || cachedHUD?.courseTotalPercent || 0;
        const initProgress = state.videoProgress || cachedHUD?.videoProgress || '';
        const initStatus = state.statusText || cachedHUD?.statusText || (state.enabled ? "正在自动流转中..." : "待启动（请点击【开始学习】）");

        hud.innerHTML = `
            <!-- 顶部炫彩渐变微光线条 -->
            <div id="jinpei-hud-top-bar" style="height: 3px; background: linear-gradient(90deg, #38bdf8 0%, #818cf8 50%, #f472b6 100%); display: ${isCollapsed ? 'none' : 'block'};"></div>

            <!-- 可拖动顶栏 / 最小化单个海螺悬浮图标 -->
            <div id="jinpei-hud-header" style="${isCollapsed 
                ? 'width: 42px; height: 42px; padding: 0; display: flex; align-items: center; justify-content: center; position: relative; cursor: pointer; border-bottom: none;' 
                : 'padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: move; border-bottom: 1px solid rgba(0, 0, 0, 0.06); white-space: nowrap;'
            }" title="${isCollapsed ? `🐚 神奇海螺 · ${state.enabled ? (state.videoProgress || state.statusText || '运行中') : '已暂停'}${hasUpdate ? ` · 发现新版本 v${state.remoteVersion}` : ''} (点击展开)` : ''}">
                <div id="jinpei-hud-header-left" style="display: flex; align-items: center; gap: 7px; flex-shrink: 0; white-space: nowrap; ${isCollapsed ? 'justify-content: center; width: 100%; height: 100%; gap: 0;' : ''}">
                    <div id="jinpei-hud-dot" style="width: 8px; height: 8px; border-radius: 50%; background: ${dotBg}; animation: ${dotAnim}; flex-shrink: 0; ${isCollapsed ? 'position: absolute; top: 7px; right: 7px; width: 7px; height: 7px; box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.95); z-index: 2;' : ''}"></div>
                    <span id="jinpei-hud-icon" style="font-size: ${isCollapsed ? '21px' : '14px'}; flex-shrink: 0; line-height: 1;" title="${isCollapsed ? '点击展开神奇海螺' : ''}">🐚</span>
                    <span id="jinpei-hud-title-text" style="font-weight: 600; font-size: 13px; color: #0f172a; letter-spacing: 0.3px; white-space: nowrap; flex-shrink: 0; display: ${isCollapsed ? 'none' : 'inline'};">神奇海螺</span>
                    <span id="jinpei-hud-version" style="font-size: 10px; color: #64748b; background: rgba(0, 0, 0, 0.05); padding: 1px 6px; border-radius: 4px; font-weight: 500; white-space: nowrap; flex-shrink: 0; display: ${isCollapsed ? 'none' : 'inline-block'};">v1.8.4</span>
                    <a id="jinpei-hud-update-badge" href="${CONFIG.updateUrl}" target="_blank" rel="noopener noreferrer" style="font-size: 10px; color: #ffffff; background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); padding: 1px 6px; border-radius: 4px; font-weight: 600; text-decoration: none; white-space: nowrap; flex-shrink: 0; display: ${hasUpdate && !isCollapsed ? 'inline-block' : 'none'}; cursor: pointer; animation: jinpei-pulse 2s infinite ease-in-out; margin-left: 2px;" title="${hasUpdate ? `发现新版本 v${state.remoteVersion}，点击跳转更新` : '更新'}">更新 v${state.remoteVersion || ''}</a>
                </div>
                <div id="jinpei-hud-header-right" style="display: ${isCollapsed ? 'none' : 'flex'}; align-items: center; gap: 6px; flex-shrink: 0; white-space: nowrap;">
                    <span id="jinpei-hud-mini-status" style="display: none; font-size: 11px; color: #0284c7; font-weight: 600; font-family: monospace; white-space: nowrap; flex-shrink: 0;"></span>
                    <button id="jinpei-hud-min-btn" class="jinpei-icon-btn" style="flex-shrink: 0;" title="${isCollapsed ? '展开面板' : '折叠面板'}">${isCollapsed ? '＋' : '−'}</button>
                </div>
            </div>

            <!-- 主体内容卡片 -->
            <div id="jinpei-hud-body" style="display: ${isCollapsed ? 'none' : 'block'}; padding: 12px 14px 14px 14px;">
                <div style="font-size:11px;color:#64748b;margin-bottom:8px;">当前平台：${PLATFORM_NAME}</div>
                <!-- 快捷启动/暂停按键 -->
                <button id="jinpei-toggle-btn" class="jinpei-btn-action" style="
                    width: 100%;
                    padding: 8px 12px;
                    margin-bottom: 10px;
                    background: ${btnBg};
                    color: #ffffff;
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    box-shadow: ${btnShadow};
                ">
                    <span id="jinpei-btn-icon">${btnIcon}</span>
                    <span id="jinpei-btn-text">${btnText}</span>
                </button>

                <!-- 浅色磨砂信息栏 -->
                <div class="jinpei-info-box" style="
                    display: flex;
                    flex-direction: column;
                    gap: 7px;
                ">
                    <!-- 状态 -->
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 4px;">
                            <span>⚡</span> 运行状态
                        </span>
                        <span id="jinpei-hud-status" style="font-size: 11px; color: ${state.enabled ? '#0284c7' : '#d97706'}; font-weight: 500; text-align: right; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${initStatus}</span>
                    </div>

                    <!-- 任务 -->
                    <div id="jinpei-hud-task-row" style="display: ${initTask ? 'flex' : 'none'}; align-items: flex-start; justify-content: space-between; gap: 6px;">
                        <span style="font-size: 11px; color: #64748b; flex-shrink: 0; display: flex; align-items: center; gap: 4px;">
                            <span>📋</span> 任务
                        </span>
                        <span id="jinpei-hud-task" style="font-size: 11px; color: #d97706; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">${initTask || '-'}</span>
                    </div>

                    <!-- 课程 -->
                    <div id="jinpei-hud-course-row" style="display: ${initCourse ? 'flex' : 'none'}; align-items: flex-start; justify-content: space-between; gap: 6px;">
                        <span style="font-size: 11px; color: #64748b; flex-shrink: 0; display: flex; align-items: center; gap: 4px;">
                            <span>📚</span> 课程
                        </span>
                        <span id="jinpei-hud-course" style="font-size: 11px; color: #7c3aed; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">${initCourse || '-'}</span>
                    </div>

                    <!-- 全部课程进度 x/n -->
                    <div id="jinpei-hud-all-courses-row" style="display: ${initAllCourses ? 'flex' : 'none'}; align-items: flex-start; justify-content: space-between; gap: 6px;">
                        <span style="font-size: 11px; color: #64748b; flex-shrink: 0; display: flex; align-items: center; gap: 4px;">
                            <span>🗺️</span> 全部课程
                        </span>
                        <span id="jinpei-hud-all-courses" style="font-size: 11px; color: #059669; font-weight: 600; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">${initAllCourses || '-'}</span>
                    </div>

                    <!-- 小节 -->
                    <div id="jinpei-hud-sub-row" style="display: ${initSub ? 'flex' : 'none'}; align-items: flex-start; justify-content: space-between; gap: 6px;">
                        <span style="font-size: 11px; color: #64748b; flex-shrink: 0; display: flex; align-items: center; gap: 4px;">
                            <span>🎬</span> 小节
                        </span>
                        <span id="jinpei-hud-sub" style="font-size: 11px; color: #db2777; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">${initSub || '-'}</span>
                    </div>

                    <!-- 本课总进度（总时长 + 百分比） -->
                    <div id="jinpei-hud-course-prog-row" style="display: ${initCourseProg ? 'block' : 'none'}; margin-top: 2px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 4px;">
                            <span style="color: #64748b; display: flex; align-items: center; gap: 4px;">
                                <span>📊</span> 本课总览
                            </span>
                            <span id="jinpei-hud-course-prog" style="color: #7c3aed; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${initCourseProg || '-'}</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(0, 0, 0, 0.06); border-radius: 9999px; overflow: hidden;">
                            <div id="jinpei-hud-course-bar-fill" style="width: ${initCoursePercent}%; height: 100%; background: linear-gradient(90deg, #a855f7, #ec4899); border-radius: 9999px; transition: width 0.3s ease;"></div>
                        </div>
                    </div>

                    <!-- 单节播放进度 -->
                    <div id="jinpei-hud-progress-row" style="display: ${initProgress ? 'block' : 'none'}; margin-top: 2px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 4px;">
                            <span style="color: #64748b; display: flex; align-items: center; gap: 4px;">
                                <span>⏱</span> 单节播放
                            </span>
                            <span id="jinpei-hud-progress" style="color: #0284c7; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${initProgress || '-'}</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(0, 0, 0, 0.06); border-radius: 9999px; overflow: hidden;">
                            <div id="jinpei-hud-bar-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #38bdf8, #6366f1); border-radius: 9999px; transition: width 0.3s ease;"></div>
                        </div>
                    </div>

                    <!-- 并发课程控制 (1 ~ 6 路) -->
                    <div id="jinpei-concurrency-controls" style="display: ${IS_JNFTC ? 'none' : 'flex'}; align-items: center; justify-content: space-between; padding-top: 5px; border-top: 1px dashed rgba(0, 0, 0, 0.08); margin-top: 2px;">
                        <span style="font-size: 11px; color: #475569; display: flex; align-items: center; gap: 4px; font-weight: 500;">
                            <span>🚀</span> 并发课程
                        </span>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <button id="jinpei-concurrency-dec" class="jinpei-step-btn" title="减少并发课程">−</button>
                            <span id="jinpei-concurrency-val" style="font-size: 13px; font-weight: 700; color: #0284c7; min-width: 16px; text-align: center; font-family: ui-monospace, monospace;">${state.concurrency}</span>
                            <button id="jinpei-concurrency-inc" class="jinpei-step-btn" title="增加并发课程 (最高 6 路)">＋</button>
                            <span id="jinpei-active-tabs-badge" style="font-size: 10px; color: #059669; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 4px; padding: 1px 5px; font-weight: 600; white-space: nowrap;" title="当前活跃标签页 / 目标并发数">1/1</span>
                        </div>
                    </div>

                    <!-- 金培极速模式控制（默认开启 m_time 极速跳过，取消勾选按时长正常挂课） -->
                    <div id="jinpei-fast-mode-controls" style="display: ${IS_JNFTC ? 'flex' : 'none'}; align-items: center; justify-content: space-between; padding-top: 5px; border-top: 1px dashed rgba(0, 0, 0, 0.08); margin-top: 2px;">
                        <span style="font-size: 11px; color: #475569; display: flex; align-items: center; gap: 4px; font-weight: 500;" title="开启后通过上报课件时长极速跳过；取消勾选后按课件时长正常挂课（暂停时可切换）">
                            <span>⚡</span> 极速模式
                        </span>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <label style="display: flex; align-items: center; gap: 4px; cursor: ${state.enabled ? 'not-allowed' : 'pointer'}; user-select: none;">
                                <input type="checkbox" id="jinpei-fast-mode-toggle" ${CONFIG.jnAutoReport ? 'checked' : ''} ${state.enabled ? 'disabled' : ''} style="cursor: ${state.enabled ? 'not-allowed' : 'pointer'}; width: 14px; height: 14px; accent-color: #0284c7; margin: 0;" title="${state.enabled ? '运行中不可切换模式，请先暂停' : '开启极速跳过或正常挂课'}">
                                <span id="jinpei-fast-mode-val" style="font-size: 11px; font-weight: 600; color: ${CONFIG.jnAutoReport ? '#0284c7' : '#64748b'};">${CONFIG.jnAutoReport ? '极速' : '正常'}</span>
                            </label>
                            <span style="font-size: 10px; color: #94a3b8; white-space: nowrap;">暂停时可切换</span>
                        </div>
                    </div>
                </div>

                <!-- 底部任务选择与辅助工具 -->
                <details id="jinpei-task-selection" style="display: none; margin-top: 8px; font-size: 11px; color: #64748b;">
                    <summary class="jinpei-summary">
                        <span>📋 选择学习任务</span>
                        <span class="jinpei-summary-arrow">›</span>
                    </summary>
                    <div class="jinpei-details-body">
                        <div id="jinpei-task-list" style="max-height: 140px; overflow-y: auto; padding: 2px 0;"></div>
                        <div style="display: flex; gap: 5px; align-items: center; margin-top: 8px; flex-wrap: wrap;">
                            <button id="jinpei-task-all" type="button" class="jinpei-btn-sub">全选</button>
                            <button id="jinpei-task-clear" type="button" class="jinpei-btn-sub jinpei-btn-danger">清空</button>
                            <button id="jinpei-task-refresh" type="button" class="jinpei-btn-sub jinpei-btn-primary">刷新任务</button>
                            <span style="font-size: 10px; color: #94a3b8; margin-left: auto;">暂停时可修改</span>
                        </div>
                    </div>
                </details>
                <div id="jinpei-outcome-row" style="display: none; align-items: center; justify-content: space-between; gap: 6px; margin-top: 8px; font-size: 10px; color: #b45309; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 6px; padding: 4px 8px;">
                    <span id="jinpei-outcome-summary"></span>
                    <button id="jinpei-retry-skipped" type="button" class="jinpei-btn-sub" style="font-size: 10px; padding: 1px 6px; color: #b45309; border-color: rgba(245, 158, 11, 0.3);">重试异常</button>
                </div>
                <div style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #94a3b8; padding: 0 2px;">
                    <span>按住顶部可拖动</span>
                    <span id="jinpei-open-tab-btn" style="display: ${IS_JNFTC ? 'none' : 'inline'}; color: #0284c7; cursor: pointer; padding: 1px 5px; border-radius: 4px; background: rgba(2, 132, 199, 0.08); font-weight: 500; transition: all 0.15s ease;" title="在后台多开一个课程页面">多开 1 窗口</span>
                    <span>1.0x 标准播放</span>
                </div>
                <details id="jinpei-diagnostics" style="margin-top: 6px; font-size: 10px; color: #94a3b8; white-space: normal;">
                    <summary class="jinpei-summary">
                        <span>🔍 诊断日志</span>
                        <span class="jinpei-summary-arrow">›</span>
                    </summary>
                    <div class="jinpei-details-body">
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                            <button id="jinpei-diagnostics-copy" type="button" class="jinpei-btn-sub" style="font-size: 10px; padding: 2px 7px;">复制日志</button>
                            <button id="jinpei-diagnostics-clear" type="button" class="jinpei-btn-sub jinpei-btn-danger" style="font-size: 10px; padding: 2px 7px;">清空</button>
                            <span id="jinpei-diagnostics-notice" role="status" style="font-size: 10px; color: #059669; margin-left: auto;"></span>
                        </div>
                        <textarea id="jinpei-diagnostics-output" class="jinpei-textarea" readonly aria-label="最近诊断日志"></textarea>
                    </div>
                </details>
            </div>
        `;

        renderRoot.appendChild(hud);

        const header = getHUDElement('jinpei-hud-header');
        const minBtn = getHUDElement('jinpei-hud-min-btn');
        const bodyEl = getHUDElement('jinpei-hud-body');
        const miniStatusEl = getHUDElement('jinpei-hud-mini-status');
        const versionEl = getHUDElement('jinpei-hud-version');
        const toggleBtn = getHUDElement('jinpei-toggle-btn');
        const btnIconEl = getHUDElement('jinpei-btn-icon');
        const btnTextEl = getHUDElement('jinpei-btn-text');
        const dot = getHUDElement('jinpei-hud-dot');
        const statusEl = getHUDElement('jinpei-hud-status');
        bodyEl.style.maxHeight = 'calc(100vh - 90px)';
        bodyEl.style.overflowY = 'auto';
        getHUDElement('jinpei-diagnostics').addEventListener('toggle', () => {
            renderDiagnosticLogs();
            clampHUDPosition();
        });
        getHUDElement('jinpei-diagnostics-copy').addEventListener('click', copyDiagnosticLogs);
        getHUDElement('jinpei-diagnostics-clear').addEventListener('click', clearDiagnosticLogs);
        getHUDElement('jinpei-retry-skipped').addEventListener('click', retrySkippedCourses);
        getHUDElement('jinpei-task-all').addEventListener('click', () => {
            if (!state.enabled) { saveTaskSelection({ mode: 'all' }); renderTaskSelection(true); }
        });
        getHUDElement('jinpei-task-selection').addEventListener('toggle', () => {
            clampHUDPosition();
            if (getHUDElement('jinpei-task-selection').open) loadTaskCatalog().then(() => renderTaskSelection(true));
        });
        getHUDElement('jinpei-task-refresh').addEventListener('click', () => loadTaskCatalog(true).then(() => renderTaskSelection(true)));
        getHUDElement('jinpei-task-clear').addEventListener('click', () => {
            if (!state.enabled) { saveTaskSelection({ mode: 'ids', ids: [] }); renderTaskSelection(true); }
        });
        updateOutcomeHUD();

        // 边界吸附与溢出校正：保证 HUD 在折叠、展开或窗口缩放时始终完整可见不换行
        function clampHUDPosition() {
            const maxLeft = Math.max(10, window.innerWidth - hud.offsetWidth - 10);
            const maxTop = Math.max(10, window.innerHeight - hud.offsetHeight - 10);
            const curLeft = parseInt(hud.style.left, 10);
            const curTop = parseInt(hud.style.top, 10);
            if (!isNaN(curLeft)) {
                hud.style.left = `${Math.max(10, Math.min(maxLeft, curLeft))}px`;
            }
            if (!isNaN(curTop)) {
                hud.style.top = `${Math.max(10, Math.min(maxTop, curTop))}px`;
            }
        }

        const topBarEl = getHUDElement('jinpei-hud-top-bar');
        const headerLeft = getHUDElement('jinpei-hud-header-left');
        const headerRight = getHUDElement('jinpei-hud-header-right');
        const iconEl = getHUDElement('jinpei-hud-icon');
        const titleTextEl = getHUDElement('jinpei-hud-title-text');

        function setCollapsed(collapsed) {
            isCollapsed = !!collapsed;
            setStorageItem(STORAGE_KEYS.hudCollapsed, isCollapsed ? 'true' : 'false');

            if (hud.classList) {
                if (isCollapsed) hud.classList.add('jinpei-collapsed');
                else hud.classList.remove('jinpei-collapsed');
            }

            if (isCollapsed) {
                const currentH = hud.offsetHeight || 0;
                if (currentH > 42) {
                    hud.style.height = `${currentH}px`;
                    if (typeof hud.offsetHeight === 'number') void hud.offsetHeight;
                }
                hud.style.width = '42px';
                hud.style.height = '42px';
                hud.style.minWidth = '42px';
                hud.style.borderRadius = '50%';
                hud.style.overflow = 'visible';
                if (bodyEl) bodyEl.style.display = 'none';
                if (topBarEl) topBarEl.style.display = 'none';
                if (titleTextEl) titleTextEl.style.display = 'none';
                if (versionEl) versionEl.style.display = 'none';
                const updateBadgeEl = getHUDElement('jinpei-hud-update-badge');
                if (updateBadgeEl) updateBadgeEl.style.display = 'none';
                if (headerRight) headerRight.style.display = 'none';
                if (miniStatusEl) miniStatusEl.style.display = 'none';
                if (header) {
                    header.style.width = '42px';
                    header.style.height = '42px';
                    header.style.padding = '0';
                    header.style.justifyContent = 'center';
                    header.style.borderBottom = 'none';
                    const statusSummary = state.enabled ? (state.videoProgress || state.statusText || '运行中') : '已暂停';
                    const hasUpdate = state.remoteVersion && semverCompare(state.remoteVersion, SCRIPT_VERSION) > 0;
                    const updateSuffix = hasUpdate ? ` · 发现新版本 v${state.remoteVersion}` : '';
                    header.title = `🐚 神奇海螺 · ${statusSummary}${updateSuffix} (点击展开)`;
                }
                if (headerLeft) {
                    headerLeft.style.width = '100%';
                    headerLeft.style.height = '100%';
                    headerLeft.style.justifyContent = 'center';
                    headerLeft.style.gap = '0';
                }
                if (iconEl) {
                    iconEl.style.fontSize = '21px';
                }
                if (dot) {
                    dot.style.position = 'absolute';
                    dot.style.top = '7px';
                    dot.style.right = '7px';
                    dot.style.width = '7px';
                    dot.style.height = '7px';
                    dot.style.boxShadow = '0 0 0 1.5px rgba(255, 255, 255, 0.95)';
                    dot.style.zIndex = '2';
                }
                if (minBtn) {
                    minBtn.innerText = '＋';
                    minBtn.title = '展开面板';
                }
            } else {
                if (bodyEl) bodyEl.style.display = 'block';
                if (topBarEl) topBarEl.style.display = 'block';
                if (titleTextEl) titleTextEl.style.display = 'inline';
                if (versionEl) versionEl.style.display = 'inline-block';
                const updateBadgeEl = getHUDElement('jinpei-hud-update-badge');
                const hasUpdate = state.remoteVersion && semverCompare(state.remoteVersion, SCRIPT_VERSION) > 0;
                if (updateBadgeEl) updateBadgeEl.style.display = hasUpdate ? 'inline-block' : 'none';
                if (headerRight) headerRight.style.display = 'flex';
                if (miniStatusEl) miniStatusEl.style.display = 'none';

                const prevH = hud.offsetHeight || 0;
                hud.style.width = '320px';
                hud.style.minWidth = '320px';
                hud.style.borderRadius = '18px';
                hud.style.overflow = 'hidden';

                if (prevH <= 42 && typeof hud.offsetHeight === 'number') {
                    hud.style.height = 'auto';
                    const targetH = hud.offsetHeight || 0;
                    if (targetH > 42) {
                        hud.style.height = '42px';
                        void hud.offsetHeight;
                        hud.style.height = `${targetH}px`;
                        setTimeout(() => {
                            if (!isCollapsed) hud.style.height = 'auto';
                        }, 280);
                    }
                } else {
                    hud.style.height = 'auto';
                }
                if (header) {
                    header.style.width = 'auto';
                    header.style.height = 'auto';
                    header.style.padding = '10px 14px';
                    header.style.justifyContent = 'space-between';
                    header.style.borderBottom = '1px solid rgba(0, 0, 0, 0.06)';
                    header.title = '';
                }
                if (headerLeft) {
                    headerLeft.style.width = 'auto';
                    headerLeft.style.height = 'auto';
                    headerLeft.style.justifyContent = 'flex-start';
                    headerLeft.style.gap = '7px';
                }
                if (iconEl) {
                    iconEl.style.fontSize = '14px';
                }
                if (dot) {
                    dot.style.position = 'static';
                    dot.style.width = '8px';
                    dot.style.height = '8px';
                    dot.style.boxShadow = 'none';
                    dot.style.zIndex = 'auto';
                }
                if (minBtn) {
                    minBtn.innerText = '−';
                    minBtn.title = '折叠面板';
                }
            }
            clampHUDPosition();
            setStorageItem(STORAGE_KEYS.hudPos, JSON.stringify({
                left: hud.style.left,
                top: hud.style.top
            }));
        }

        // 初始化根据已保存状态应用折叠/展开
        setCollapsed(isCollapsed);

        // 折叠 / 展开交互：点击右上角折叠按钮
        if (minBtn) {
            minBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                setCollapsed(!isCollapsed);
            });
        }

        // 最小化状态下：点击海螺图标/小悬浮球任意位置直接展开（若刚发生拖拽则忽略点击）
        if (header) {
            header.addEventListener('click', (e) => {
                if (isCollapsed && !hasDragged) {
                    setCollapsed(false);
                }
            });
        }

        // 窗口尺寸变化时自动校正 HUD 坐标
        window.addEventListener('resize', clampHUDPosition);

        // 自由拖拽交互
        let isDragging = false;
        let hasDragged = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;

        header.addEventListener('mousedown', (e) => {
            if (!isCollapsed && e.target.closest('button')) return;
            isDragging = true;
            hasDragged = false;
            startX = e.clientX;
            startY = e.clientY;
            const rect = hud.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            hud.style.transition = 'none';
            e.preventDefault();
        });

        hudDocument.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
                hasDragged = true;
            }
            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            const maxLeft = window.innerWidth - hud.offsetWidth - 10;
            const maxTop = window.innerHeight - hud.offsetHeight - 10;
            newLeft = Math.max(10, Math.min(maxLeft, newLeft));
            newTop = Math.max(10, Math.min(maxTop, newTop));

            hud.style.left = `${newLeft}px`;
            hud.style.top = `${newTop}px`;
            hud.style.right = 'auto';
        });

        hudDocument.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                clampHUDPosition();
                hud.style.transition = 'transform 0.2s ease, box-shadow 0.25s ease, border-color 0.25s ease, width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
                setStorageItem(STORAGE_KEYS.hudPos, JSON.stringify({
                    left: hud.style.left,
                    top: hud.style.top
                }));
                setTimeout(() => {
                    hasDragged = false;
                }, 50);
            }
        });

        // 开始 / 暂停切换
        toggleBtn.addEventListener('click', () => {
            if (!state.enabled) {
                const selection = getTaskSelection();
                if (selection.mode === 'ids' && !selection.ids.length) {
                    renderTaskSelection(true);
                    getHUDElement('jinpei-task-selection').open = true;
                    updateHUD('请先勾选要学习的任务。');
                    return;
                }
            }
            state.enabled = !state.enabled;
            if (state.enabled) {
                setStorageItem(STORAGE_KEYS.running, 'true');
                setLocalItem(STORAGE_KEYS.running, 'true');
                btnIconEl.innerText = "⏸";
                btnTextEl.innerText = "暂停自动学习";
                toggleBtn.style.background = "linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)";
                toggleBtn.style.boxShadow = "0 4px 14px rgba(244, 63, 94, 0.3)";
                dot.style.background = "#10b981";
                dot.style.animation = "jinpei-pulse 2s infinite ease-in-out";
                statusEl.style.color = "#0284c7";
                updateHUD("已手动启动，正在运行中...");
                diagnosticConsole.log("【神奇海螺】用户手动点击启动自动化！");
                mainLoop();
            } else {
                pauseAutomation("已手动暂停（所有待执行操作已取消）");
                diagnosticConsole.log("【神奇海螺】用户手动点击暂停，已清空待执行定时器并暂停视频。");
            }
        });

        // 并发调节与多开按键交互
        const decBtn = getHUDElement('jinpei-concurrency-dec');
        const incBtn = getHUDElement('jinpei-concurrency-inc');
        const openTabBtn = getHUDElement('jinpei-open-tab-btn');

        if (IS_JNFTC) {
            // 金培按任务顺序流转；复用面板，避免把易知的多窗口规则用于旧平台。
            for (const button of [decBtn, incBtn, openTabBtn]) {
                if (button) { button.disabled = true; button.title = '江南金培使用单窗口顺序学习'; }
            }
            setConcurrencySetting(1);
        }

        if (!IS_JNFTC && decBtn && typeof decBtn.addEventListener === 'function') {
            decBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const cur = getConcurrencySetting();
                if (cur > 1) {
                    const next = setConcurrencySetting(cur - 1);
                    diagnosticConsole.log(`【神奇海螺】并发设置减少至: ${next} 路`);
                    updateHUD(`并发课程数已调整为 ${next} 路`);
                }
            });
        }

        if (!IS_JNFTC && incBtn && typeof incBtn.addEventListener === 'function') {
            incBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const cur = getConcurrencySetting();
                if (cur < (CONFIG.maxConcurrency || 6)) {
                    const next = setConcurrencySetting(cur + 1);
                    diagnosticConsole.log(`【神奇海螺】并发设置增加至: ${next} 路`);
                    updateHUD(`并发课程数已调整为 ${next} 路`);
                    const activeCount = Object.keys(getActiveTabs()).length;
                    if (activeCount < next && typeof window !== 'undefined' && typeof window.open === 'function' && location.href.includes('/home/training/study/')) {
                        try {
                            window.open(CONFIG.myTaskUrl, '_blank');
                        } catch (_) {}
                    }
                }
            });
        }

        if (!IS_JNFTC && openTabBtn && typeof openTabBtn.addEventListener === 'function') {
            openTabBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    const cur = getConcurrencySetting();
                    if (cur < (CONFIG.maxConcurrency || 6)) {
                        setConcurrencySetting(cur + 1);
                    }
                    if (typeof window !== 'undefined' && typeof window.open === 'function') {
                        window.open(CONFIG.myTaskUrl, '_blank');
                        updateHUD("正在唤起新窗口进行并发学习...");
                    }
                } catch (err) {
                    diagnosticConsole.error(err);
                }
            });
        }

        const fastModeToggle = getHUDElement('jinpei-fast-mode-toggle');
        const fastModeVal = getHUDElement('jinpei-fast-mode-val');
        if (IS_JNFTC && fastModeToggle && typeof fastModeToggle.addEventListener === 'function') {
            fastModeToggle.addEventListener('click', (e) => {
                if (state.enabled) {
                    e.preventDefault();
                    fastModeToggle.checked = CONFIG.jnAutoReport;
                    updateHUD('请先暂停学习，再切换挂课模式。');
                    return false;
                }
            });
            fastModeToggle.addEventListener('change', () => {
                if (state.enabled) {
                    fastModeToggle.checked = CONFIG.jnAutoReport;
                    updateHUD('请先暂停学习，再切换挂课模式。');
                    return;
                }
                setFastModeSetting(fastModeToggle.checked);
                if (fastModeVal) {
                    fastModeVal.textContent = CONFIG.jnAutoReport ? '极速' : '正常';
                    fastModeVal.style.color = CONFIG.jnAutoReport ? '#0284c7' : '#64748b';
                }
                diagnosticConsole.log(`金培：已切换为【${CONFIG.jnAutoReport ? '极速跳过模式' : '正常挂课模式'}】。`);
                updateHUD(state.statusText);
            });
        }
    }

    function updateHUD(status, task, sub, progress, course, allCoursesProg, courseTotalProg, courseTotalPercent) {
        if (status) state.statusText = status;
        if (task !== undefined) state.currentTask = task;
        if (sub !== undefined) state.currentSubVideo = sub;
        if (progress !== undefined) state.videoProgress = progress;
        if (course !== undefined) state.currentCourse = course;
        if (allCoursesProg !== undefined) state.allCoursesProgress = allCoursesProg;
        if (courseTotalProg !== undefined) state.courseTotalProgress = courseTotalProg;
        if (courseTotalPercent !== undefined) state.courseTotalPercent = courseTotalPercent;
        updateOutcomeHUD();

        const statusEl = getHUDElement('jinpei-hud-status');
        const taskRow = getHUDElement('jinpei-hud-task-row');
        const taskEl = getHUDElement('jinpei-hud-task');
        const courseRow = getHUDElement('jinpei-hud-course-row');
        const courseEl = getHUDElement('jinpei-hud-course');
        const allCoursesRow = getHUDElement('jinpei-hud-all-courses-row');
        const allCoursesEl = getHUDElement('jinpei-hud-all-courses');
        const subRow = getHUDElement('jinpei-hud-sub-row');
        const subEl = getHUDElement('jinpei-hud-sub');
        const courseProgRow = getHUDElement('jinpei-hud-course-prog-row');
        const courseProgEl = getHUDElement('jinpei-hud-course-prog');
        const courseBarFill = getHUDElement('jinpei-hud-course-bar-fill');
        const progRow = getHUDElement('jinpei-hud-progress-row');
        const progEl = getHUDElement('jinpei-hud-progress');
        const barFill = getHUDElement('jinpei-hud-bar-fill');
        const miniStatusEl = getHUDElement('jinpei-hud-mini-status');

        if (statusEl) {
            statusEl.innerText = state.statusText;
            statusEl.title = state.statusText;
        }

        if (taskRow && taskEl) {
            if (state.currentTask) {
                taskRow.style.display = 'flex';
                taskEl.innerText = state.currentTask;
                taskEl.title = state.currentTask;
            } else {
                taskRow.style.display = 'none';
            }
        }

        if (courseRow && courseEl) {
            if (state.currentCourse) {
                courseRow.style.display = 'flex';
                courseEl.innerText = state.currentCourse;
                courseEl.title = state.currentCourse;
            } else {
                courseRow.style.display = 'none';
            }
        }

        if (allCoursesRow && allCoursesEl) {
            if (state.allCoursesProgress) {
                allCoursesRow.style.display = 'flex';
                allCoursesEl.innerText = state.allCoursesProgress;
                allCoursesEl.title = state.allCoursesProgress;
            } else {
                allCoursesRow.style.display = 'none';
            }
        }

        if (subRow && subEl) {
            if (state.currentSubVideo) {
                subRow.style.display = 'flex';
                subEl.innerText = state.currentSubVideo;
                subEl.title = state.currentSubVideo;
            } else {
                subRow.style.display = 'none';
            }
        }

        if (courseProgRow && courseProgEl) {
            if (state.courseTotalProgress) {
                courseProgRow.style.display = 'block';
                courseProgEl.innerText = state.courseTotalProgress;
                courseProgEl.title = state.courseTotalProgress;
                if (courseBarFill) {
                    courseBarFill.style.width = (state.courseTotalPercent || 0) + '%';
                }
            } else {
                courseProgRow.style.display = 'none';
            }
        }

        if (progRow && progEl) {
            if (state.videoProgress) {
                progRow.style.display = 'block';
                progEl.innerText = state.videoProgress;

                // 动态更新单节进度条长度
                const match = state.videoProgress.match(/(\d+)%/);
                if (barFill && match) {
                    barFill.style.width = match[1] + '%';
                } else if (barFill && state.videoProgress === '100%') {
                    barFill.style.width = '100%';
                }
            } else {
                progRow.style.display = 'none';
            }
        }

        const concValEl = getHUDElement('jinpei-concurrency-val');
        if (concValEl) {
            concValEl.innerText = (state.concurrency || getConcurrencySetting()).toString();
        }

        const activeBadge = getHUDElement('jinpei-active-tabs-badge');
        if (activeBadge) {
            const activeCount = Math.max(1, Object.keys(getActiveTabs()).length);
            const target = state.concurrency || getConcurrencySetting();
            activeBadge.innerText = `${activeCount}/${target}`;
            activeBadge.title = `当前活跃标签页: ${activeCount} / 目标并发数: ${target}`;
        }

        if (miniStatusEl) {
            const conc = state.concurrency || getConcurrencySetting();
            const concTag = conc > 1 ? ` · ${conc}路` : '';
            if (state.courseTotalPercent > 0) {
                miniStatusEl.innerText = `${state.courseTotalPercent}%${concTag}`;
            } else if (state.videoProgress) {
                const m = state.videoProgress.match(/(\d+%)/);
                miniStatusEl.innerText = `${m ? m[1] : state.videoProgress}${concTag}`;
            } else if (state.enabled) {
                miniStatusEl.innerText = `运行中${concTag}`;
            } else {
                miniStatusEl.innerText = '已暂停';
            }
        }

        const hudEl = getHUDElement('jinpei-hud');
        const headerEl = getHUDElement('jinpei-hud-header');
        const isCollapsedNow = (hudEl && hudEl.classList && hudEl.classList.contains('jinpei-collapsed')) ||
            getStorageItem(STORAGE_KEYS.hudCollapsed, 'jinpei_hud_collapsed') === 'true';
        if (isCollapsedNow && headerEl) {
            const statusSummary = state.enabled ? (state.videoProgress || state.statusText || '运行中') : '已暂停';
            headerEl.title = `🐚 神奇海螺 · ${statusSummary} (点击展开)`;
        }

        const fastModeToggle = getHUDElement('jinpei-fast-mode-toggle');
        if (fastModeToggle) {
            fastModeToggle.disabled = state.enabled;
            fastModeToggle.style.cursor = state.enabled ? 'not-allowed' : 'pointer';
            fastModeToggle.title = state.enabled ? '运行中不可切换模式，请先暂停' : '开启极速跳过或正常挂课';
            const labelEl = fastModeToggle.closest?.('label');
            if (labelEl) labelEl.style.cursor = state.enabled ? 'not-allowed' : 'pointer';
        }

        try {
            setStorageItem(STORAGE_KEYS.hudCache, JSON.stringify({
                task: state.currentTask,
                course: state.currentCourse,
                allCoursesProg: state.allCoursesProgress,
                sub: state.currentSubVideo,
                courseTotalProg: state.courseTotalProgress,
                courseTotalPercent: state.courseTotalPercent,
                videoProgress: state.videoProgress,
                statusText: state.statusText
            }));
        } catch (_) {}
    }

