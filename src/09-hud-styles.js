    // ==========================================
    // 1. 悬浮 HUD 状态面板（现代浅色高透光磨砂玻璃态设计 + 可拖拽 + 折叠）
    // ==========================================
    // ==========================================
    // 1. 悬浮 HUD 状态面板（现代浅色高透光磨砂玻璃态设计 + Shadow DOM 隔离 + 可拖拽 + 折叠）
    // ==========================================
    function ensureHUDStyles(targetRoot) {
        const root = targetRoot || document.head || document.body;
        if (!root) return;
        if (root.querySelector && root.querySelector('#jinpei-hud-styles')) return;
        const style = document.createElement('style');
        style.id = 'jinpei-hud-styles';
        style.innerHTML = `
            @keyframes jinpei-pulse {
                0% { transform: scale(0.92); opacity: 0.7; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
                70% { transform: scale(1.08); opacity: 1; box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
                100% { transform: scale(0.92); opacity: 0.7; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
            }
            @keyframes jinpei-amber-pulse {
                0% { transform: scale(0.92); opacity: 0.7; box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.6); }
                70% { transform: scale(1.08); opacity: 1; box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
                100% { transform: scale(0.92); opacity: 0.7; box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
            }
            .jinpei-glass, .jinpei-glass * {
                box-sizing: border-box !important;
            }
            .jinpei-glass {
                position: fixed;
                z-index: 999999;
                /* 浅色高通透 Apple 风格毛玻璃 */
                background: rgba(255, 255, 255, 0.42) !important;
                backdrop-filter: blur(16px) saturate(180%) !important;
                -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
                border: 1px solid rgba(255, 255, 255, 0.55) !important;
                border-radius: 18px !important;
                box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.6) inset, 0 2px 4px rgba(0, 0, 0, 0.04) !important;
                color: #1e293b !important;
                font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
                user-select: none;
                overflow: hidden;
                white-space: nowrap !important;
                transition: transform 0.2s ease, box-shadow 0.25s ease, border-color 0.25s ease, width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            .jinpei-glass:hover {
                background: rgba(255, 255, 255, 0.58) !important;
                border-color: rgba(255, 255, 255, 0.7) !important;
                box-shadow: 0 24px 48px -10px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.8) inset !important;
            }
            /* 折叠/最小化状态：紧凑单个海螺悬浮图标，隐藏标题 */
            .jinpei-glass.jinpei-collapsed {
                border-radius: 50% !important;
                width: 42px !important;
                height: 42px !important;
                min-width: 42px !important;
                cursor: pointer !important;
                overflow: visible !important;
                box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.14), 0 0 0 1px rgba(255, 255, 255, 0.75) inset !important;
                transition: transform 0.2s ease, box-shadow 0.25s ease, border-color 0.25s ease, width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            .jinpei-glass.jinpei-collapsed:hover {
                transform: scale(1.08);
                box-shadow: 0 12px 28px -4px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.9) inset !important;
            }
            .jinpei-glass.jinpei-collapsed #jinpei-hud-top-bar,
            .jinpei-glass.jinpei-collapsed #jinpei-hud-title-text,
            .jinpei-glass.jinpei-collapsed #jinpei-hud-version,
            .jinpei-glass.jinpei-collapsed #jinpei-hud-update-badge,
            .jinpei-glass.jinpei-collapsed #jinpei-hud-header-right,
            .jinpei-glass.jinpei-collapsed #jinpei-hud-body {
                display: none !important;
            }
            .jinpei-glass.jinpei-collapsed #jinpei-hud-header {
                width: 42px !important;
                height: 42px !important;
                padding: 0 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                border-bottom: none !important;
                position: relative !important;
                cursor: pointer !important;
            }
            #jinpei-hud-header {
                transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1), padding 0.25s ease !important;
            }
            #jinpei-hud-icon {
                transition: font-size 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            #jinpei-hud-dot {
                transition: top 0.25s ease, right 0.25s ease, width 0.25s ease, height 0.25s ease, box-shadow 0.25s ease !important;
            }
            .jinpei-glass.jinpei-collapsed #jinpei-hud-header-left {
                width: 100% !important;
                height: 100% !important;
                justify-content: center !important;
                align-items: center !important;
                gap: 0 !important;
            }
            .jinpei-glass.jinpei-collapsed #jinpei-hud-icon {
                font-size: 21px !important;
                display: inline-block !important;
                line-height: 1 !important;
            }
            .jinpei-glass.jinpei-collapsed #jinpei-hud-dot {
                position: absolute !important;
                top: 7px !important;
                right: 7px !important;
                width: 7px !important;
                height: 7px !important;
                box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.95) !important;
                z-index: 2 !important;
            }
            .jinpei-info-box {
                background: rgba(255, 255, 255, 0.18);
                border: 1px solid rgba(255, 255, 255, 0.55);
                border-radius: 12px;
                padding: 10px 12px;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02) inset;
            }
            .jinpei-btn-action {
                cursor: pointer;
                border: none;
                outline: none;
                border-radius: 9px;
                font-weight: 600;
                font-size: 13px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .jinpei-btn-action:hover {
                filter: brightness(1.08);
                transform: translateY(-1px);
            }
            .jinpei-btn-action:active {
                transform: translateY(1px);
                filter: brightness(0.96);
            }
            .jinpei-icon-btn {
                background: rgba(0, 0, 0, 0.04);
                border: 1px solid rgba(0, 0, 0, 0.06);
                color: #64748b;
                width: 24px;
                height: 24px;
                border-radius: 6px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font-size: 13px;
                line-height: 1;
                transition: all 0.2s ease;
            }
            .jinpei-icon-btn:hover {
                background: rgba(0, 0, 0, 0.08);
                color: #0f172a;
                border-color: rgba(0, 0, 0, 0.12);
            }
            /* 次级与工具按钮（全选、清空、刷新任务、复制/清空日志等） */
            .jinpei-btn-sub {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                padding: 3px 8px;
                font-size: 11px;
                font-weight: 500;
                color: #334155;
                background: rgba(255, 255, 255, 0.65);
                border: 1px solid rgba(0, 0, 0, 0.09);
                border-radius: 6px;
                cursor: pointer;
                outline: none;
                line-height: 1.4;
                transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
                user-select: none;
            }
            .jinpei-btn-sub:hover:not(:disabled) {
                background: #ffffff;
                color: #0284c7;
                border-color: rgba(2, 132, 199, 0.35);
                box-shadow: 0 2px 6px rgba(2, 132, 199, 0.18);
                transform: translateY(-1px);
            }
            .jinpei-btn-sub:active:not(:disabled) {
                transform: translateY(0);
                filter: brightness(0.96);
            }
            .jinpei-btn-sub:disabled {
                opacity: 0.45;
                cursor: not-allowed;
                border-color: rgba(0, 0, 0, 0.05);
                background: rgba(0, 0, 0, 0.02);
                color: #94a3b8;
                transform: none !important;
                box-shadow: none !important;
            }
            .jinpei-btn-sub.jinpei-btn-primary {
                color: #0284c7;
                background: rgba(2, 132, 199, 0.08);
                border-color: rgba(2, 132, 199, 0.25);
                font-weight: 600;
            }
            .jinpei-btn-sub.jinpei-btn-primary:hover:not(:disabled) {
                background: #0284c7;
                color: #ffffff;
                border-color: #0284c7;
                box-shadow: 0 2px 8px rgba(2, 132, 199, 0.3);
            }
            .jinpei-btn-sub.jinpei-btn-danger:hover:not(:disabled) {
                color: #ef4444;
                border-color: rgba(239, 68, 68, 0.3);
                background: rgba(254, 242, 242, 0.9);
                box-shadow: 0 2px 6px rgba(239, 68, 68, 0.18);
            }
            /* 折叠详情栏与指示箭头 */
            .jinpei-summary {
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: pointer;
                font-size: 11px;
                font-weight: 600;
                color: #475569;
                padding: 6px 9px;
                background: rgba(255, 255, 255, 0.4);
                border: 1px solid rgba(255, 255, 255, 0.65);
                border-radius: 8px;
                transition: all 0.2s ease;
                user-select: none;
                list-style: none;
            }
            .jinpei-summary::-webkit-details-marker {
                display: none;
            }
            .jinpei-summary:hover {
                background: rgba(255, 255, 255, 0.7);
                color: #0f172a;
                border-color: rgba(255, 255, 255, 0.9);
            }
            .jinpei-summary-arrow {
                font-size: 11px;
                line-height: 1;
                color: #94a3b8;
                transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), color 0.2s ease;
                display: inline-block;
            }
            details[open] > .jinpei-summary .jinpei-summary-arrow {
                transform: rotate(90deg);
                color: #0284c7;
            }
            details[open] > .jinpei-summary {
                border-bottom-left-radius: 0;
                border-bottom-right-radius: 0;
                background: rgba(255, 255, 255, 0.6);
                border-bottom-color: rgba(0, 0, 0, 0.04);
            }
            .jinpei-details-body {
                background: rgba(255, 255, 255, 0.26);
                border: 1px solid rgba(255, 255, 255, 0.65);
                border-top: none;
                border-bottom-left-radius: 8px;
                border-bottom-right-radius: 8px;
                padding: 8px 10px;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02) inset;
            }
            /* 自定义现代复选框与任务选项 */
            .jinpei-checkbox {
                appearance: none;
                -webkit-appearance: none;
                width: 14px;
                height: 14px;
                border: 1.5px solid #cbd5e1;
                border-radius: 4px;
                outline: none;
                cursor: pointer;
                margin: 0;
                vertical-align: middle;
                background: rgba(255, 255, 255, 0.85);
                display: inline-grid;
                place-content: center;
                transition: all 0.18s ease;
                flex-shrink: 0;
            }
            .jinpei-checkbox::before {
                content: "";
                width: 8px;
                height: 8px;
                clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
                transform: scale(0);
                transform-origin: center;
                transition: 120ms transform ease-in-out;
                background-color: #ffffff;
            }
            .jinpei-checkbox:checked {
                background-color: #0284c7;
                border-color: #0284c7;
                box-shadow: 0 1px 3px rgba(2, 132, 199, 0.3);
            }
            .jinpei-checkbox:checked::before {
                transform: scale(1);
            }
            .jinpei-checkbox:hover:not(:disabled) {
                border-color: #0284c7;
                background-color: #f0f9ff;
            }
            .jinpei-checkbox:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                border-color: #e2e8f0;
                background-color: rgba(0, 0, 0, 0.04);
            }
            .jinpei-task-item {
                display: flex;
                align-items: center;
                gap: 7px;
                padding: 4px 6px;
                border-radius: 6px;
                margin: 2px 0;
                cursor: pointer;
                font-size: 11px;
                color: #334155;
                line-height: 1.35;
                transition: background 0.15s ease;
            }
            .jinpei-task-item:hover {
                background: rgba(255, 255, 255, 0.55);
            }
            /* 并发加减步进器按钮 */
            .jinpei-step-btn {
                width: 20px;
                height: 20px;
                border-radius: 5px;
                border: 1px solid rgba(0, 0, 0, 0.1);
                background: rgba(255, 255, 255, 0.85);
                color: #334155;
                font-size: 12px;
                font-weight: bold;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                line-height: 1;
                padding: 0;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
                transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
                outline: none;
            }
            .jinpei-step-btn:hover {
                background: #0284c7;
                color: #ffffff;
                border-color: #0284c7;
                box-shadow: 0 2px 6px rgba(2, 132, 199, 0.25);
                transform: translateY(-1px);
            }
            .jinpei-step-btn:active {
                transform: translateY(0) scale(0.95);
                filter: brightness(0.95);
            }
            /* 诊断日志文本域 */
            .jinpei-textarea {
                width: 100%;
                height: 130px;
                resize: vertical;
                border: 1px solid rgba(0, 0, 0, 0.08);
                border-radius: 8px;
                padding: 7px 8px;
                background: rgba(255, 255, 255, 0.55);
                color: #334155;
                font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                user-select: text;
                outline: none;
                transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
            }
            .jinpei-textarea:focus {
                border-color: #38bdf8;
                box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
                background: rgba(255, 255, 255, 0.85);
            }
            /* 精致纤细滚动条 */
            .jinpei-glass ::-webkit-scrollbar {
                width: 5px;
                height: 5px;
            }
            .jinpei-glass ::-webkit-scrollbar-track {
                background: transparent;
            }
            .jinpei-glass ::-webkit-scrollbar-thumb {
                background: rgba(0, 0, 0, 0.12);
                border-radius: 9999px;
            }
            .jinpei-glass ::-webkit-scrollbar-thumb:hover {
                background: rgba(0, 0, 0, 0.22);
            }
        `;
        root.appendChild(style);
    }
