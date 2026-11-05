    // ==========================================
    // 2. 防暂停与防后台挂机机制（动态联动：运行生效，暂停释放）
    // ==========================================
    function enableAntiPause() {
        try {
            const origHiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden') || Object.getOwnPropertyDescriptor(document, 'hidden');
            const origVisibilityDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState') || Object.getOwnPropertyDescriptor(document, 'visibilityState');
            const origWebkitVisibilityDesc = Object.getOwnPropertyDescriptor(document, 'webkitVisibilityState') || Object.getOwnPropertyDescriptor(Document.prototype, 'webkitVisibilityState');
            const origWebkitVisibility = document.webkitVisibilityState;

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
                if (state.enabled) e.stopImmediatePropagation();
            }, true);

            diagnosticConsole.log("【神奇海螺】防暂停与防后台机制已初始化（随【开始/暂停】动态生效）。");
        } catch (e) {
            diagnosticConsole.warn("【神奇海螺】防暂停注入异常:", e);
        }
    }

