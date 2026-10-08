// ui.js — 共享的批量离线下载面板渲染器
// 同时用于：扩展弹窗（批量标签页）与磁力页面的 Shadow DOM 弹窗
// 依赖 chrome.runtime 消息通道（'getStatus' / 'offline'），由 background.mjs 统一处理
(function (global) {
    'use strict';

    const MagnetExt = global.MagnetExt = global.MagnetExt || {};

    const STYLE = `
    .mo-panel { font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #2b2f36; text-align: left; }
    .mo-panel * { box-sizing: border-box; }
    .mo-links {
        width: 100%; height: 110px; padding: 7px 9px; margin-bottom: 10px;
        border: 1px solid #d7dae2; border-radius: 8px; font: 12px/1.6 Consolas, monospace;
        white-space: pre; overflow: auto; resize: vertical; outline: none;
    }
    .mo-links:focus { border-color: #667eea; }
    /* 网盘勾选区：所有网盘归入同一区域，行内四元素网格对齐 */
    .mo-providers { border: 1px solid #e6e8f0; border-radius: 10px; padding: 3px 11px; margin-bottom: 10px; }
    .mo-prow {
        display: grid; grid-template-columns: 20px 64px 1fr 110px;
        gap: 8px; align-items: center; padding: 5px 0;
    }
    .mo-prow + .mo-prow { border-top: 1px solid #f0f1f6; }
    .mo-prow input[type="checkbox"] { margin: 0; cursor: pointer; }
    .mo-prow .mo-pname { font-weight: 700; cursor: pointer; user-select: none; white-space: nowrap; }
    .mo-pan123 .mo-pname { color: #5b5fc7; }
    .mo-pikpak .mo-pname { color: #2456e6; }
    .mo-prow input[type="text"] {
        width: 100%; min-width: 0; padding: 5px 8px; border: 1px solid #d7dae2; border-radius: 6px;
        font-size: 12px; outline: none; color: #2b2f36;
    }
    .mo-prow input[type="text"]:focus { border-color: #667eea; }
    .mo-prow input[type="text"]::placeholder { color: #b0b6c0; }
    .mo-badge { font-size: 11px; white-space: nowrap; }
    .mo-prow .mo-badge { text-align: right; }
    .mo-badge.ok { color: #27ae60; }
    .mo-badge.no { color: #e74c3c; }
    .mo-badge.exp { color: #e67e22; }
    .mo-actions { display: flex; gap: 8px; align-items: center; margin-top: 2px; }
    .mo-btn {
        padding: 7px 16px; border: none; border-radius: 7px; cursor: pointer;
        font-size: 13px; font-weight: 700; color: #fff;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .mo-btn:disabled { background: #b9bfc6; cursor: not-allowed; }
    .mo-btn.mo-ghost { background: #8d959e; font-weight: 600; }
    .mo-status { margin-top: 10px; }
    .mo-line { padding: 5px 9px; border-radius: 7px; margin-bottom: 6px; line-height: 1.6; word-break: break-all; }
    .mo-line.done { background: #e9f9ef; color: #1e7e45; }
    .mo-line.err { background: #fdeaea; color: #b03030; }
    .mo-line.info { background: #f2f4f9; color: #556; }
    .mo-detail { margin: 4px 0 0; padding-left: 18px; }
    .mo-detail li { margin: 2px 0; font-size: 12px; }
    .mo-hint { color: #98a0ab; font-size: 11px; margin-top: 8px; line-height: 1.6; }
    `;

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function send(msg) {
        return chrome.runtime.sendMessage(msg).then(r => {
            if (r && r.error) throw new Error(r.error);
            return r;
        });
    }

    // Token 状态徽标（短文案保持行内对齐，详细信息放 title）
    function badgeFor(providerKey, st) {
        st = st || {};
        if (!st.hasToken) {
            return { cls: 'mo-badge no', text: '✖ 未同步', title: '未同步Token，转存将失败；请在扩展弹窗的设置中同步' };
        }
        const exp = Number(st.expiresAt || 0);
        if (exp && exp < Date.now()) {
            return { cls: 'mo-badge exp', text: '⚠ 已过期', title: 'Token已过期，转存时会自动续期' };
        }
        return { cls: 'mo-badge ok', text: '✔ 已同步', title: 'Token已同步' };
    }

    // container: 普通元素或 ShadowRoot
    // opts: { showLinks: bool, links: [..] | null, onClose: fn }
    MagnetExt.renderPanel = async function (container, opts) {
        opts = opts || {};
        const style = document.createElement('style');
        style.textContent = STYLE;
        container.appendChild(style);

        const panel = el('div', 'mo-panel');
        container.appendChild(panel);

        let status = {};
        try {
            status = (await send({ cmd: 'getStatus' })) || {};
        } catch (e) {
            const line = el('div', 'mo-line err', '初始化失败：' + e.message);
            panel.appendChild(line);
            return { close() { }, refresh() { } };
        }

        // 链接输入（批量模式）
        let linksBox = null;
        if (opts.showLinks) {
            linksBox = document.createElement('textarea');
            linksBox.className = 'mo-links';
            linksBox.wrap = 'off';
            linksBox.spellcheck = false;
            linksBox.placeholder = '每行一条下载链接';
            panel.appendChild(linksBox);
        }

        // getStatus 返回 provider-keyed 对象，动态提取网盘条目
        const entries = Object.entries(status).map(([key, state]) => ({ key, ...(state || {}) }))
            .filter(p => p && p.key && p.key !== 'entries' && typeof p === 'object');
        const region = el('div', 'mo-providers');
        const rows = [];
        for (const p of entries) {
            const st = status[p.key] || p || {};
            const row = el('div', 'mo-prow mo-' + String(p.key).replace(/[^\w-]/g, ''));

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true;
            row.appendChild(cb);

            const label = el('label', 'mo-pname', p.label);
            label.title = p.label;
            row.appendChild(label);

            const dirInput = document.createElement('input');
            dirInput.type = 'text';
            dirInput.placeholder = st.dirId ? '默认：' + st.dirId : '留空使用网盘默认目录';
            dirInput.value = '';
            dirInput.title = st.dirId ? '默认目录：' + st.dirId : '未设置默认目录';
            row.appendChild(dirInput);

            const badge = el('span', 'mo-badge');
            const b0 = badgeFor(p.key, st);
            badge.className = b0.cls;
            badge.textContent = b0.text;
            badge.title = b0.title || '';
            row.appendChild(badge);

            region.appendChild(row);
            rows.push({ key: p.key, label: p.label, cb, dirInput, badge });
        }
        if (!rows.length) region.appendChild(el('div', 'mo-hint', '暂无可用网盘'));
        panel.appendChild(region);

        const actions = el('div', 'mo-actions');
        const submitBtn = el('button', 'mo-btn', '发起离线下载');
        actions.appendChild(submitBtn);
        panel.appendChild(actions);

        const statusArea = el('div', 'mo-status');
        panel.appendChild(statusArea);

        function line(cls, html) {
            const d = el('div', 'mo-line ' + cls);
            d.innerHTML = html;
            statusArea.appendChild(d);
            return d;
        }

        submitBtn.onclick = async () => {
            statusArea.textContent = '';
            let links;
            if (opts.showLinks) {
                links = linksBox.value.split('\n').map(s => s.trim()).filter(Boolean);
                if (!links.length) { line('err', '❌ 请先粘贴下载链接（每行一条）'); return; }
            } else {
                links = opts.links || [];
            }

            const targets = rows.filter(r => r.cb.checked).map(r => ({
                provider: r.key,
                dirId: r.dirInput.value.trim()
            }));
            if (!targets.length) { line('err', '❌ 请至少勾选一个网盘'); return; }

            submitBtn.disabled = true;
            submitBtn.textContent = '提交中...';
            try {
                const resp = await send({ cmd: 'offline', links, targets });
                const results = resp.results || {};
                for (const key of Object.keys(results)) {
                    const r = results[key];
                    if (r.error) { line('err', '❌ ' + escapeHtml(r.label || key) + '：' + escapeHtml(r.error)); continue; }
                    const cls = r.fail === 0 && !r.skipped ? 'done' : 'err';
                    let html = (r.fail === 0 && !r.skipped ? '✅' : '⚠️') + ' <b>' + escapeHtml(r.label || key) + '</b>：成功 ' + (r.ok || 0) + ' 条，失败 ' + (r.fail || 0) + ' 条';
                    if (r.skipped) html += '，跳过 ' + r.skipped + ' 条';
                    if (r.filesAdded) html += '，共 ' + r.filesAdded + ' 个文件';
                    if (r.tokenError) html += '<br>⚠ ' + escapeHtml(r.tokenError);
                    const d = line(cls, html);
                    if (r.fail > 0) {
                        const ul = document.createElement('ul');
                        ul.className = 'mo-detail';
                        for (const item of r.detail) {
                            if (item.ok) continue;
                            const li = document.createElement('li');
                            li.textContent = (item.link.slice(0, 60)) + ' → ' + item.message;
                            ul.appendChild(li);
                        }
                        d.appendChild(ul);
                    }
                }
            } catch (e) {
                line('err', '❌ 提交失败：' + escapeHtml(e.message));
            }
            submitBtn.disabled = false;
            submitBtn.textContent = '发起离线下载';
        };

        function escapeHtml(s) {
            return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        }

        if (opts.showLinks && linksBox) linksBox.focus();

        // 就地刷新：重新拉取状态并更新 Token 徽标，不重建面板（保留已输入的链接与勾选）
        async function refresh() {
            try {
                const newStatus = (await send({ cmd: 'getStatus' })) || {};
                for (const row of rows) {
                    const b = badgeFor(row.key, newStatus[row.key] || {});
                    row.badge.className = b.cls;
                    row.badge.textContent = b.text;
                    row.badge.title = b.title || '';
                    const dir = newStatus[row.key]?.dirId || '';
                    row.dirInput.placeholder = dir ? '默认：' + dir : '留空使用网盘默认目录';
                    row.dirInput.title = dir ? '默认目录：' + dir : '未设置默认目录';
                }
            } catch (e) { /* 状态刷新失败不打断使用 */ }
        }

        return {
            close() { if (opts.onClose) opts.onClose(); },
            refresh
        };
    };
})(typeof window !== 'undefined' ? window : self);
