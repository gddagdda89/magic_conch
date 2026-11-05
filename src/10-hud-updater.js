    // ==========================================
    // HUD 版本自检与更新提醒模块
    // 定时异步比对远程最新版本，在 HUD 上以醒目徽标提示用户一键更新
    // ==========================================
    function semverCompare(a, b) {
        const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
        const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const na = pa[i] || 0;
            const nb = pb[i] || 0;
            if (na > nb) return 1;
            if (na < nb) return -1;
        }
        return 0;
    }

    function applyUpdateNotice(remoteVersion) {
        state.remoteVersion = remoteVersion;
        const badge = getHUDElement('jinpei-hud-update-badge');
        if (badge) {
            badge.innerText = `更新 v${remoteVersion}`;
            badge.href = CONFIG.updateUrl;
            badge.title = `发现新版本 v${remoteVersion} (当前 v${SCRIPT_VERSION})，点击跳转更新脚本`;
            badge.style.display = 'inline-block';
        }
        const header = getHUDElement('jinpei-hud-header');
        if (header && header.classList?.contains('jinpei-collapsed')) {
            header.title = `🐚 神奇海螺 · 发现新版本 v${remoteVersion} (点击展开)`;
        }
    }

    async function checkScriptUpdate(force = false) {
        if (typeof fetch !== 'function') return;

        // 先读取已缓存的最新版本
        const cachedVersion = getLocalItem(STORAGE_KEYS.latestVersion, '');
        if (cachedVersion && semverCompare(cachedVersion, SCRIPT_VERSION) > 0) {
            applyUpdateNotice(cachedVersion);
        }

        const lastCheck = parseInt(getLocalItem(STORAGE_KEYS.lastUpdateCheck, '0'), 10) || 0;
        if (!force && Date.now() - lastCheck < CONFIG.updateCheckInterval) {
            return;
        }

        try {
            const resp = await fetch(CONFIG.updateUrl, { cache: 'no-cache' });
            if (!resp.ok) return;
            const text = await resp.text();
            const match = text.match(/\/\/\s*@version\s+([0-9.]+)/);
            if (match && match[1]) {
                const remoteVersion = match[1].trim();
                setLocalItem(STORAGE_KEYS.lastUpdateCheck, String(Date.now()));
                if (semverCompare(remoteVersion, SCRIPT_VERSION) > 0) {
                    setLocalItem(STORAGE_KEYS.latestVersion, remoteVersion);
                    applyUpdateNotice(remoteVersion);
                    diagnosticConsole.log(`【神奇海螺】检测到新版本: v${remoteVersion} (当前: v${SCRIPT_VERSION})，可点击 HUD 上的更新按钮前往安装。`);
                } else {
                    setLocalItem(STORAGE_KEYS.latestVersion, '');
                }
            }
        } catch (_) {
            // 静默容错，不干扰主要播放流程
        }
    }
