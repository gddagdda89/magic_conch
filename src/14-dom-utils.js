    // ==========================================
    // 3. 通用 DOM 检查工具函数 (兼容多种目录结构与已学标记)
    // ==========================================

    // 检查某个元素是否代表“已完成”状态（绿色对勾、100%、已完成文本）
    function isItemCompleted(el) {
        if (!el) return false;
        const hasQuery = typeof el.querySelector === 'function';
        // 1. 检查是否有 check 对勾图标 (anticon5-check, data-icon="check", aria-label="check")
        const hasCheckIcon = hasQuery && el.querySelector('[data-icon="check"], [aria-label="check"], .anticon5-check, .anticon-check, [class*="anticon-check"], [class*="anticon5-check"]') !== null;
        if (hasCheckIcon) return true;
        // 完成状态只认独立状态文字；第一行课程标题不参与匹配。
        const finished = /^(?:(?:已完成|已学完|学习完成)(?:\s+100\s*%)?|(?:学习进度\s*[:：]?\s*)?100\s*%)$/;
        const lines = (el.innerText || '').split(/\r?\n/).map(text => text.trim()).filter(Boolean);
        if (lines.slice(1).some(text => finished.test(text))) return true;
        if (typeof el.querySelectorAll !== 'function') return false;
        const title = hasQuery ? el.querySelector('[title], .truncate, [class*="course-title"], [class*="courseTitle"]') : null;
        return Array.from(el.querySelectorAll('[role="progressbar"], [class*="progress"], [class*="status"]')).some(marker => {
            if (marker === title || title?.contains?.(marker)) return false;
            if (marker.getAttribute?.('role') === 'progressbar') {
                const current = marker.getAttribute('aria-valuenow');
                const maximum = marker.getAttribute('aria-valuemax') || '100';
                return current !== null && Number(maximum) > 0 && Number(current) >= Number(maximum);
            }
            return finished.test((marker.innerText || '').trim());
        });
    }

    // 检查子视频小节是否处于当前选中/播放激活状态
    function isSubVideoActive(el) {
        if (!el) return false;
        const cls = el.className || '';
        if (cls.includes('bg6') || cls.includes('text-primary') || cls.includes('active')) return true;
        const titleEl = el.querySelector('[title], .truncate');
        if (titleEl && (titleEl.className || '').includes('text-primary')) return true;
        return false;
    }

    let chapterCatalogRuntime = null;
    let chapterCatalogWaitPending = false;
    let chapterCatalogWaitGeneration = 0;

    // 逐个展开并验证各面板的内容，目录稳定后才允许核实整课完成。
    function ensureAllChaptersExpanded() {
        const video = document.querySelector('video');
        if (!chapterCatalogRuntime || chapterCatalogRuntime.video !== video || chapterCatalogRuntime.url !== location.href) {
            chapterCatalogRuntime = { video, url: location.href, clicked: new WeakSet(), sawHeaders: false, stableSince: null, signature: '' };
        }
        const runtime = chapterCatalogRuntime;
        const headers = Array.from(document.querySelectorAll('.ant5-collapse-header[aria-expanded], .ant-collapse-header[aria-expanded], [class*="collapse-header"][aria-expanded]'))
            .filter(header => header.offsetParent !== null);
        if (!headers.length) return !runtime.sawHeaders;
        runtime.sawHeaders = true;
        let ready = true;
        for (const header of headers) {
            if (header.getAttribute('aria-expanded') !== 'true') {
                ready = false;
                if (!runtime.clicked.has(header)) {
                    runtime.clicked.add(header);
                    diagnosticConsole.log('等待章节展开并加载：', (header.innerText || '').trim());
                    simulateHumanClick(header);
                }
                continue;
            }
            runtime.clicked.delete(header);
            const panelId = header.getAttribute('aria-controls');
            const panel = (panelId && document.getElementById(panelId)) ||
                header.closest?.('.ant5-collapse-item, .ant-collapse-item')?.querySelector('.ant5-collapse-content, .ant-collapse-content');
            if (!panel || panel.querySelector('[aria-busy="true"], .ant5-spin-spinning, .ant-spin-spinning') ||
                (!Array.from(panel.querySelectorAll('div.group.cursor-pointer, [class*="min-h-10"][class*="cursor-pointer"]'))
                    .some(item => /\d{1,2}:\d{2}/.test(item.innerText || '')) && !/考试|测验/.test(panel.innerText || ''))) ready = false;
        }
        const signature = JSON.stringify(getAllSubVideoItems().map(getSubVideoKey));
        if (!ready || signature !== runtime.signature) {
            runtime.signature = signature;
            runtime.stableSince = ready ? Date.now() : null;
            return false;
        }
        return runtime.stableSince !== null && Date.now() - runtime.stableSince >= 1000;
    }

    function waitForChapterCatalog(scope, onReady) {
        if (chapterCatalogWaitPending) return;
        chapterCatalogWaitPending = true;
        const generation = ++chapterCatalogWaitGeneration;
        const started = Date.now();
        state.isSwitching = true;
        state.isActionPending = true;
        function poll() {
            if (!state.enabled || generation !== chapterCatalogWaitGeneration) return;
            if (!isPlaybackScopeCurrent(scope, true)) {
                chapterCatalogWaitPending = false;
                cancelStalePlaybackWait();
                return;
            }
            if (ensureAllChaptersExpanded()) {
                chapterCatalogWaitPending = false;
                state.isSwitching = false;
                state.isActionPending = false;
                onReady();
                return;
            }
            if (Date.now() - started >= CONFIG.pageReadyTimeout) {
                pauseAutomation('章节目录未完整加载，已暂停；请检查目录和网络后重新开始。');
                return;
            }
            if (currentClaim && !registerTabHeartbeat()) { pauseAutomation('等待章节时无法续期课程占用，已暂停。'); return; }
            updateHUD('等待全部章节展开并加载完整...');
            setManagedTimeout(poll, 500);
        }
        poll();
    }

    // 获取当前页面中所有的子小节条目（兼容一层目录与多层折叠目录）
    function getAllSubVideoItems() {
        // 匹配所有具有 cursor-pointer 且包含时长格式 (如 00:07:45 或 03:37) 的条目
        const items = Array.from(document.querySelectorAll('div.group.cursor-pointer, [class*="min-h-10"][class*="cursor-pointer"]'))
            .filter(el => {
                const t = el.innerText || '';
                // 排除顶层菜单项，只保留包含时间或明确小节标识的条目
                return /\d{1,2}:\d{2}/.test(t) && !t.includes('学时') && !t.includes('个活动');
            });

        return items;
    }

    // 解析时分秒字符串为纯秒数 (例如 "00:14:57" -> 897, "12:46" -> 766)
    function parseTimeToSeconds(timeStr) {
        if (!timeStr) return 0;
        const parts = timeStr.trim().split(':').map(Number);
        if (parts.length === 3) {
            return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
        }
        if (parts.length === 2) {
            return (parts[0] || 0) * 60 + (parts[1] || 0);
        }
        return 0;
    }

    // 计算当前大课程的总时长、已学时长、小节数完成比与总百分比
    function calculateCourseTotalProgress(allSubItems, video) {
        let totalSec = 0;
        let completedSec = 0;
        let completedCount = 0;
        const totalCount = allSubItems.length;

        allSubItems.forEach(el => {
            const tm = (el.innerText || '').match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
            const itemSec = tm ? parseTimeToSeconds(tm[1]) : 0;
            totalSec += itemSec;
            const isDone = isItemCompleted(el);
            const isActive = isSubVideoActive(el);

            if (isDone) {
                completedSec += itemSec;
                completedCount++;
            } else if (isActive && video && video.duration > 0) {
                const curPlay = Math.min(itemSec > 0 ? itemSec : video.currentTime, video.currentTime);
                completedSec += curPlay;
            }
        });

        const percent = totalSec > 0 ? Math.min(100, Math.floor((completedSec / totalSec) * 100)) : (totalCount > 0 && completedCount === totalCount ? 100 : 0);
        const countStr = `${completedCount}/${totalCount} 节`;
        const timeStr = `${formatTime(completedSec)} / ${formatTime(totalSec)}`;
        return {
            text: `${countStr} · ${timeStr} (${percent}%)`,
            percent: percent,
            completedCount,
            totalCount,
            completedSec,
            totalSec
        };
    }

    // 检查当前课程是否包含随堂测验/课后考试/测试节点
    function detectCourseExam() {
        const candidates = Array.from(document.querySelectorAll(
            'div.group.cursor-pointer, [class*="min-h-10"][class*="cursor-pointer"], .ant5-tabs-tab, .ant-tabs-tab, [role="tab"], li, button, span, div'
        )).filter(el => {
            if (el && el.closest && (el.closest('#jinpei-hud') || el.closest('#_kme_tool_host'))) return false;
            const t = (el.innerText || '').trim();
            return /^(课后考试|随堂测验|结业考试|课程考试|综合测试|在线考试|随堂考试|作业与考试|单元测验|去考试)$/.test(t) ||
                   (/(考试|测验|随堂测)/.test(t) && t.length <= 12 && !t.includes('调试'));
        });
        return candidates.length > 0;
    }

    // 当前地图/培训项目 ID 提取
    function getCurrentMapId() {
        const path = (location && (location.pathname || location.href)) || "";
        const m = path.match(/\/(?:study|detail)\/(\d+)/);
        if (m) return m[1];
        const cp = path.match(/\/courseplay\/(\d+)/);
        if (cp) return `courseplay_${cp[1]}`;
        return "";
    }

    // 当前地图标题提取（优先使用保存的任务标题，兜底页面标题）
    function getMapTitleFromPage() {
        if (state.currentTask) return state.currentTask;
        const candidates = Array.from(document.querySelectorAll('h1, h2, h3, .main div, [class*="title"]'))
            .map(el => (el.innerText || '').trim())
            .filter(t => t.includes('学习地图') || (t.includes('培训') && t.length < 50));
        if (candidates.length > 0) return candidates[0].split('\n')[0].trim();
        return "";
    }

    // 只读平台已有数据，不修改 React 状态，也不拦截平台请求。
    function getPlatformEntityId(el, kind) {
        if (!el) return '';
        const attrs = kind === 'chapter' ? ['data-chapter-id', 'data-section-id', 'data-id'] :
            kind === 'course' ? ['data-course-id', 'data-id'] : ['data-task-id', 'data-tp-id', 'data-id'];
        for (const name of attrs) {
            const value = el.getAttribute?.(name);
            if (value) return String(value);
        }
        try {
            const fiberKey = Object.getOwnPropertyNames(el).find(key => /^__react(Fiber|InternalInstance)\$/.test(key));
            let fiber = fiberKey && el[fiberKey];
            let keyedId = '';
            for (let depth = 0; fiber && depth < 4; depth++, fiber = fiber.return) {
                const p = fiber.memoizedProps || {};
                const item = p.item || p.data || p.record || {};
                const value = kind === 'chapter' ? p.section?.id || p.chapter?.id || p.chapterId :
                    kind === 'course' ? p.section?.courseId || p.courseId || p.course?.id || p.courseInfo?.courseVo?.id || item.courseId || item.relationId :
                    p.tpId || p.task?.tpId || p.task?.id || item.tpId || item.trainingId || item.id;
                if (typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))) return String(value);
                if (!keyedId && /^\d+$/.test(fiber.key || '')) keyedId = fiber.key;
            }
            if (keyedId) return keyedId;
        } catch (_) {}
        return '';
    }

    // 从任务卡片提取 Task ID
    function getTaskIdFromCard(card) {
        if (!card) return "";
        const platformId = getPlatformEntityId(card, 'task');
        if (platformId) return platformId;
        const id = (typeof card.getAttribute === 'function' ? (card.getAttribute('data-id') || card.getAttribute('id')) : null) || (card.dataset && card.dataset.id);
        if (id) return id;
        const link = typeof card.querySelector === 'function' ? card.querySelector('a[href*="/training/"]') : null;
        if (link) {
            const m = link.href.match(/\/training\/(?:detail|study)\/(\d+)/);
            if (m) return m[1];
        }
        return "";
    }

    // 从课程条目提取唯一标识（优先 ID，兜底标题）
    function getCourseKeyFromItem(c) {
        if (!c) return "";
        const platformId = getPlatformEntityId(c, 'course');
        if (platformId) return platformId;
        const id = (typeof c.getAttribute === 'function' ? (c.getAttribute('data-id') || c.getAttribute('data-course-id') || c.getAttribute('id')) : null) || (c.dataset && (c.dataset.id || c.dataset.courseId));
        if (id) return id;
        const link = typeof c.querySelector === 'function' ? c.querySelector('a[href*="/course/"], a[href*="/courseplay/"]') : null;
        if (link) {
            const lm = link.href.match(/\/(?:course|courseplay)\/(\d+)/);
            if (lm) return lm[1];
        }
        return (c.innerText || '').split('\n')[0].trim();
    }

    // [P1 修复] 按“地图 ID + 课程标识”作用域记录已处理课程，防止不同地图同名课程被误跳过（同时同步 localStorage 支持跨标签并发）
    function getHandledCourses() {
        try {
            const local = JSON.parse(getLocalItem(STORAGE_KEYS.handledCourses, '[]')) || [];
            const session = JSON.parse(getStorageItem(STORAGE_KEYS.handledCourses, 'jinpei_handled_courses') || '[]') || [];
            return Array.from(new Set([...local, ...session]));
        } catch (_) {
            return [];
        }
    }

    function markCourseHandled(arg1, arg2) {
        let mapId, courseKey;
        if (arg2 === undefined) {
            mapId = getCurrentMapId() || 'global';
            courseKey = arg1;
        } else {
            mapId = arg1 || getCurrentMapId() || 'global';
            courseKey = arg2;
        }
        if (!courseKey) return;
        const list = getHandledCourses();
        const scopedKey = `${mapId}::${courseKey}`;
        if (!list.includes(scopedKey)) {
            list.push(scopedKey);
            const str = JSON.stringify(list);
            setStorageItem(STORAGE_KEYS.handledCourses, str);
            setLocalItem(STORAGE_KEYS.handledCourses, str);
        }
    }

    function isCourseHandled(arg1, arg2) {
        let mapId, courseKey;
        if (arg2 === undefined) {
            mapId = getCurrentMapId() || 'global';
            courseKey = arg1;
        } else {
            mapId = arg1 || getCurrentMapId() || 'global';
            courseKey = arg2;
        }
        if (!courseKey) return false;
        const list = getHandledCourses();
        return list.includes(`${mapId}::${courseKey}`);
    }

    // [P2 修复] 已学完视频/跳过考试的学习地图记录管理器（防止任务中心未打勾导致死循环重复进入）
    function getHandledMaps() {
        try {
            const local = JSON.parse(getLocalItem(STORAGE_KEYS.handledMaps, '[]')) || [];
            const session = JSON.parse(getStorageItem(STORAGE_KEYS.handledMaps, 'jinpei_handled_maps') || '[]') || [];
            return Array.from(new Set([...local, ...session]));
        } catch (_) {
            return [];
        }
    }

    function markMapHandled(mapKey) {
        if (!mapKey) return;
        const list = getHandledMaps();
        if (!list.includes(mapKey)) {
            list.push(mapKey);
            const str = JSON.stringify(list);
            setStorageItem(STORAGE_KEYS.handledMaps, str);
            setLocalItem(STORAGE_KEYS.handledMaps, str);
        }
    }

    // 提取当前课程标题（从全局状态、页面面包屑、头部或标题中提取）
    function getCurrentCourseTitle() {
        if (state.currentCourse) return state.currentCourse;
        const breadcrumbEl = document.querySelector('.ant5-breadcrumb, .ant-breadcrumb, [class*="breadcrumb"]');
        if (breadcrumbEl) {
            const parts = Array.from(breadcrumbEl.querySelectorAll('li, span, a'))
                .map(el => (el.innerText || '').trim())
                .filter(t => t && !/^(首页|我的任务|培训|学习地图)$/.test(t));
            if (parts.length > 0) return parts[parts.length - 1];
        }
        const titleEl = document.querySelector('h1, h2, [class*="courseTitle"], [class*="course-title"], [class*="headerTitle"]');
        if (titleEl) {
            const t = (titleEl.innerText || '').trim();
            if (t && t.length < 60) return t;
        }
        if (document.title && !document.title.includes('江南金融') && !document.title.includes('登录')) {
            return document.title.split('-')[0].trim();
        }
        return "";
    }

    // 提取当前课程在 URL 中的 ID
    function getCurrentCourseId() {
        const active = Array.from(document.querySelectorAll('div.group.cursor-pointer, [class*="min-h-10"][class*="cursor-pointer"]'))
            .find(el => /\d{1,2}:\d{2}/.test(el.innerText || '') && isSubVideoActive(el));
        const platformId = getPlatformEntityId(active, 'course');
        if (platformId) return platformId;
        const path = (location && (location.pathname || location.href)) || "";
        const m = path.match(/\/courseplay\/(\d+)/);
        return m ? m[1] : "";
    }

