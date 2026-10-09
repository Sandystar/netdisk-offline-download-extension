// popup.js — 扩展弹窗：批量离线下载 + 设置（Token 状态/同步、文件夹ID）
(function () {
    'use strict';

    function send(msg) {
        return chrome.runtime.sendMessage(msg).then(r => {
            if (r && r.error) throw new Error(r.error);
            return r;
        });
    }

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    let toastTimer = null;
    function toast(msg) {
        let t = document.querySelector('.toast');
        if (!t) {
            t = el('div', 'toast');
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.opacity = '1';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2600);
    }

    function fmtShort(ts) {
        if (!ts) return '';
        const d = new Date(Number(ts));
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // ================== 标签页切换 ==================
    let batchPanel = null;
    window.MagnetExt.renderPanel(document.getElementById('tab-batch'), { showLinks: true, links: null })
        .then(c => { batchPanel = c; })
        .catch(e => console.error(e));

    document.querySelectorAll('.tab').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
            document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
            // 切到批量页时就地刷新 Token 徽标（设置页里的同步即时反映过来）
            if (btn.dataset.tab === 'batch' && batchPanel) batchPanel.refresh();
            if (btn.dataset.tab === 'settings') refresh();
        };
    });

    // ================== 设置 ==================
    const settingsBody = document.getElementById('settings-body');
    const dirDrafts = Object.create(null);
    const dirDirty = Object.create(null);

    // 紧凑徽标：状态 + 时间（PikPak 显示有效期，123 显示同步时间）
    function badgeFor(st) {
        if (!st.hasToken) return { cls: 'no', text: '✖ 未同步' };
        const exp = Number(st.expiresAt || 0);
        if (exp && exp < Date.now()) return { cls: 'exp', text: '⚠ 已过期 · ' + fmtShort(exp) };
        if (exp) return { cls: 'ok', text: '✔ 有效至 ' + fmtShort(exp) };
        if (st.lastSyncedAt) return { cls: 'ok', text: '✔ 已同步 · ' + fmtShort(st.lastSyncedAt) };
        return { cls: 'ok', text: '✔ 已同步' };
    }

    function renderSettings(status) {
        settingsBody.textContent = '';
        const entries = Object.entries(status || {}).map(([key, state]) => ({ key, ...(state || {}) }))
            .filter(p => p && p.key && p.key !== 'entries' && typeof p === 'object');
        for (const p of entries) {
            const st = Object.assign({}, p, status[p.key] || {});
            st.key = p.key;
            const sec = el('div', 'psec ' + String(p.key).replace(/[^\w-]/g, ''));

            // 首行：网盘名 + 打开主页 + 同步Token + Token状态(含时间)
            const head = el('div', 'psec-head');
            head.appendChild(el('span', 'pname', p.label));

            const openBtn = el('button', 'pbtn ghost small', '打开主页');
            openBtn.onclick = () => send({ cmd: 'openHome', provider: p.key }).catch(e => toast('❌ ' + e.message));
            head.appendChild(openBtn);

            const syncBtn = el('button', 'pbtn small', '同步Token');
            syncBtn.onclick = async () => {
                syncBtn.disabled = true;
                try {
                    const r = await send({ cmd: 'syncNow', provider: p.key });
                    toast(r.opened ? '已打开' + p.label + '页面，登录后可同步' : r.reloading ? '正在刷新网盘页面，请稍候再同步' : p.key === 'pan115' ? '115登录状态和离线签名已验证' : '已通知网盘页面同步，请稍候...');
                    setTimeout(() => { refresh(); if (batchPanel) batchPanel.refresh(); }, r.opened ? 4000 : 1500);
                } catch (e) {
                    toast('❌ ' + e.message);
                }
                syncBtn.disabled = false;
            };
            head.appendChild(syncBtn);

            const badge = el('span', 'pbadge');
            const b = badgeFor(st);
            badge.className = 'pbadge ' + b.cls;
            badge.textContent = b.text;
            head.appendChild(badge);
            sec.appendChild(head);

            // 目录行：输入框（已设置则直接显示）+ 保存
            const dirRow = el('div', 'prow');
            const dirInput = document.createElement('input');
            const hasDraft = Object.prototype.hasOwnProperty.call(dirDrafts, p.key);
            if (hasDraft) {
                dirInput.value = dirDrafts[p.key];
            } else if (st.dirId) {
                dirInput.value = st.dirId;
                dirInput.title = '默认目录：' + st.dirId;
            } else {
                dirInput.placeholder = '未设置，使用网盘默认目录';
            }
            if (p.key === 'pan115') {
                dirInput.title = '115文件夹网址中的cid；0为根目录，留空使用115默认云下载目录';
                dirInput.inputMode = 'numeric';
            }
            dirInput.addEventListener('input', () => {
                dirDrafts[p.key] = dirInput.value;
                dirDirty[p.key] = true;
            });
            dirRow.appendChild(dirInput);
            const saveBtn = el('button', 'pbtn', '保存');
            saveBtn.onclick = async () => {
                const v = dirInput.value.trim();
                if (v.length > 256 || /[\u0000-\u001f]/.test(v)) { toast('❌ 文件夹ID格式不正确'); return; }
                try {
                    await send({ cmd: 'setDir', provider: p.key, dirId: v });
                    delete dirDrafts[p.key];
                    delete dirDirty[p.key];
                    toast(v ? '✅ ' + p.label + ' 目录已保存: ' + v : '↩️ ' + p.label + ' 已恢复默认目录');
                    refresh();
                } catch (e) {
                    toast('❌ ' + e.message);
                }
                if (batchPanel) batchPanel.refresh();
            };
            dirRow.appendChild(saveBtn);
            sec.appendChild(dirRow);
            if (p.key === 'pan115') {
                sec.appendChild(el('div', 'pmeta', '填写文件夹网址中的 cid；0 为根目录，留空使用115默认云下载目录。下载时请保留115页面。'));
            }

            settingsBody.appendChild(sec);
        }
    }

    async function refresh() {
        try {
            const status = await send({ cmd: 'getStatus' });
            if (!status || typeof status !== 'object') throw new Error('状态格式无效');
            renderSettings(status);
        } catch (e) {
            settingsBody.textContent = '';
            settingsBody.appendChild(el('div', 'pmeta', '状态加载失败: ' + e.message));
        }
    }

    refresh();
    // 设置页停留时每 5 秒刷新一次状态（比如网盘页刚同步完）
    setInterval(() => {
        if (document.getElementById('tab-settings').classList.contains('active') &&
            !settingsBody.contains(document.activeElement)) refresh();
    }, 5000);
})();
