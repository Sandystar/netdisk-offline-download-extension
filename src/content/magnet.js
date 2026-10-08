// content-magnet.js — 在任意网页识别磁力链接，注入统一的「离线下载」按钮
// 点击弹出 Shadow DOM 弹窗（复用 ui.js 的批量面板，隐藏链接输入框，针对当前磁力链接）
(function () {
    'use strict';

    const BTN_CLASS = 'mo-offline-btn';
    const WRAP_CLASS = 'mo-offline-wrap';

    const btnCss = `
    .${BTN_CLASS} {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        margin-left: 6px !important;
        padding: 3px 10px !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        color: #fff !important;
        background: linear-gradient(135deg, #36a2ff 0%, #764ba2 100%) !important;
        border: none !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        text-decoration: none !important;
        vertical-align: middle !important;
        line-height: 1.4 !important;
        box-shadow: 0 2px 4px rgba(80, 110, 240, 0.3) !important;
        transition: all 0.2s ease !important;
        white-space: nowrap !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    }
    .${BTN_CLASS}:hover {
        transform: translateY(-1px) !important;
        box-shadow: 0 4px 8px rgba(80, 110, 240, 0.5) !important;
        filter: brightness(1.12) !important;
    }
    `;

    function ensureStyle() {
        if (document.getElementById('mo-offline-style')) return;
        const style = document.createElement('style');
        style.id = 'mo-offline-style';
        style.textContent = btnCss;
        document.head.appendChild(style);
    }

    let overlay = null;

    function openDialog(magnetLink) {
        closeDialog();
        overlay = document.createElement('div');
        overlay.id = 'mo-offline-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483645;background:rgba(15,18,25,0.45);';
        overlay.addEventListener('click', e => { if (e.target === overlay) closeDialog(); });

        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483646;width:400px;max-width:92vw;background:#fff;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,0.28);padding:16px;';
        overlay.appendChild(host);

        const head = document.createElement('div');
        head.style.cssText = 'font:600 14px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#333;margin:0 0 12px;display:flex;justify-content:space-between;align-items:center;';
        const title = document.createElement('span');
        title.textContent = '离线下载';
        const closeX = document.createElement('span');
        closeX.textContent = '×';
        closeX.style.cssText = 'cursor:pointer;font-size:20px;color:#999;line-height:1;';
        closeX.onclick = closeDialog;
        head.appendChild(title);
        head.appendChild(closeX);
        host.appendChild(head);

        const shadowHost = document.createElement('div');
        host.appendChild(shadowHost);
        const shadow = shadowHost.attachShadow({ mode: 'open' });

        window.MagnetExt.renderPanel(shadow, { showLinks: false, links: [magnetLink], onClose: closeDialog })
            .catch(err => console.error('[磁力离线] 弹窗渲染失败', err));

        document.documentElement.appendChild(overlay);
        document.addEventListener('keydown', escListener, true);
    }

    function escListener(e) {
        if (e.key === 'Escape') closeDialog();
    }

    function closeDialog() {
        document.removeEventListener('keydown', escListener, true);
        if (overlay) { overlay.remove(); overlay = null; }
    }

    function injectButtons(root) {
        ensureStyle();
        const scope = root && root.querySelectorAll ? root : document;
        scope.querySelectorAll('a[href^="magnet:"]').forEach(a => {
            // 用锚点自身的标记去重：即使其他脚本在锚点后插入元素也不会重复注入按钮
            if (a.dataset.moOffline) return;
            const href = a.getAttribute('href');
            if (!href || !href.startsWith('magnet:')) return;

            const wrap = document.createElement('span');
            wrap.className = WRAP_CLASS;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = BTN_CLASS;
            btn.textContent = '⚡ 离线下载';
            btn.title = '选择网盘并离线下载';
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const current = a.getAttribute('href');
                if (current && current.startsWith('magnet:')) openDialog(current);
            };
            wrap.appendChild(btn);
            a.parentNode.insertBefore(wrap, a.nextSibling);
            a.dataset.moOffline = '1';
            a.dataset.moOfflineHref = href;
        });
    }

    let scanTimer = null;
    const pendingRoots = new Set();
    function scheduleScan(root) {
        if (!root) return;
        pendingRoots.add(root);
        if (scanTimer) return;
        scanTimer = setTimeout(() => {
            scanTimer = null;
            const roots = [...pendingRoots];
            pendingRoots.clear();
            for (const candidate of roots) {
                if (candidate.isConnected && !roots.some(other => other !== candidate && other.contains(candidate))) {
                    injectButtons(candidate);
                }
            }
        }, 120);
    }
    const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            if (m.type === 'attributes' && m.target.matches?.('a[href]')) scheduleScan(m.target.parentNode);
            if (m.addedNodes?.length) scheduleScan(m.target);
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    scheduleScan(document);
})();
