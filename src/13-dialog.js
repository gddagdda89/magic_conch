    // 智能关闭弹窗：严格限定在弹窗/遮罩层容器内部寻找，避免误触页面常规按钮，排除神奇海螺面板本身
    function autoDismissDialogs() {
        if (!state.enabled) return;

        const dialogContainers = Array.from(document.querySelectorAll(
            '.ant5-modal:not(#jinpei-hud), .ant-modal, .ant5-modal-content, [role="dialog"], div[class*="modal-content"], div[class*="dialog-content"]'
        )).filter(d => !d.closest('#jinpei-hud') && !d.closest('#_kme_tool_host') && d.offsetParent !== null);

        for (const dialog of dialogContainers) {
            const dialogText = (dialog.innerText || '').trim();

            const buttons = Array.from(dialog.querySelectorAll('button, .ant5-btn, [role="button"]'))
                .filter(b => b.offsetParent !== null);

            for (const btn of buttons) {
                const btnText = (btn.innerText || '').trim();

                // 1. 明确的学习/播放恢复按钮（精确匹配），直接点击
                if (/^(继续学习|继续播放)$/.test(btnText)) {
                    diagnosticConsole.log("【神奇海螺】检测到学习恢复弹窗，点击继续:", btnText);
                    simulateHumanClick(btn);
                    return;
                }

                // 2. 通用“确定/我知道了/继续”（精确匹配），严格排除单独的“提示”，只匹配明确的学习超时/防挂机/继续观看内容
                if (/^(确定|我知道了|知道了|继续)$/.test(btnText)) {
                    const isLearningNotice = /长时间未操作|学习超时|超时未操作|继续学习|继续观看|挂机检测|防挂机|学时累计|学时记录|是否继续学习/i.test(dialogText);
                    if (isLearningNotice) {
                        diagnosticConsole.log("【神奇海螺】检测到学习超时/挂机提醒弹窗，点击确认:", btnText);
                        simulateHumanClick(btn);
                        return;
                    }
                }
            }

            // 3. 考试/测验邀请或提醒弹窗：用户要求看完视频不参加考试，直接关闭/取消
            if (/考试|测验|测试/.test(dialogText)) {
                const cancelBtn = buttons.find(b => /^(取消|关闭|稍后|稍后再说|暂不|我知道了)$/.test((b.innerText || '').trim()));
                if (cancelBtn) {
                    diagnosticConsole.log("【神奇海螺】检测到考试邀请/提醒弹窗，根据配置自动跳过/关闭:", cancelBtn.innerText.trim());
                    simulateHumanClick(cancelBtn);
                    return;
                }
                const closeIcon = dialog.querySelector('.ant5-modal-close, .ant-modal-close, [aria-label="Close"], [aria-label="关闭"]');
                if (closeIcon && closeIcon.offsetParent !== null) {
                    diagnosticConsole.log("【神奇海螺】检测到考试邀请/提醒弹窗，点击右上角关闭按钮");
                    simulateHumanClick(closeIcon);
                    return;
                }
            }
        }
    }

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds) || !isFinite(seconds)) return "00:00";
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) {
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

