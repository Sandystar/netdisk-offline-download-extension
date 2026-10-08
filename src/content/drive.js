// content-drive.js — 123云盘 / PikPak 网盘页面：读取登录态并自动同步到扩展存储
// Token 变化时合并写入（保留 dirId），2秒轮询；同时响应弹窗"立即同步"指令
(function () {
    'use strict';

    const HOST = location.hostname;
    const PATH = location.pathname;

    // ---- 123云盘（yun.123pan.cn）----
    function readPan123() {
        const candidates = [];
        const authorRaw = localStorage.getItem('authorToken');
        if (authorRaw) candidates.push(authorRaw);
        try {
            const tokenSet = JSON.parse(localStorage.getItem('tokenSet') || 'null');
            if (tokenSet && tokenSet.token) candidates.push(tokenSet.token);
        } catch (e) { }
        try {
            const userInfo = JSON.parse(localStorage.getItem('userInfo') || 'null');
            if (userInfo && userInfo.token) candidates.push(userInfo.token);
        } catch (e) { }
        for (let raw of candidates) {
            let t = String(raw).trim();
            if (!t) continue;
            if (t.charAt(0) === '"' || t.charAt(0) === "'") {
                try { t = JSON.parse(t); } catch (e) { t = t.replace(/^['"]+|['"]+$/g, ''); }
            }
            t = String(t).trim();
            if (t.length > 50) return { token: t };
        }
        return null;
    }

    // ---- PikPak（mypikpak.com/drive）----
    function readPikpak() {
        try {
            let credKey = null;
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith('credentials_')) { credKey = k; break; }
            }
            if (!credKey) return null;
            const obj = JSON.parse(localStorage.getItem(credKey) || 'null');
            if (!obj) return null;
            const access = obj.access_token || obj.accessToken;
            const refresh = obj.refresh_token || obj.refreshToken;
            if (!access || String(access).length < 50) return null;
            const rawDev = localStorage.getItem('deviceid') || localStorage.getItem('_deviceid') || '';
            return {
                accessToken: String(access),
                refreshToken: refresh ? String(refresh) : null,
                sub: obj.sub ? String(obj.sub) : null,
                expiresAt: obj.expires_at ? (new Date(obj.expires_at).getTime() || 0) : 0,
                deviceId: String(rawDev).split('.').pop().substring(0, 32) || null
            };
        } catch (e) { return null; }
    }

    function currentProvider() {
        if (HOST === 'yun.123pan.cn') return { key: 'pan123', label: '123云盘', read: readPan123 };
        if ((HOST === 'mypikpak.com' || HOST.endsWith('.mypikpak.com')) && PATH.startsWith('/drive') && !PATH.startsWith('/drive/login')) {
            return { key: 'pikpak', label: 'PikPak', read: readPikpak };
        }
        return null;
    }

    const provider = currentProvider();
    if (!provider) return;

    async function syncOnce(notifyBadge) {
        const fields = provider.read();
        if (!fields) return null;
        const stateKey = 'provider_' + provider.key;
        const stored = (await chrome.storage.local.get(stateKey))[stateKey] || {};
        // 变更签名：Token + 设备ID（PikPak 的 captcha 与 device_id 绑定）
        const sig = (fields.token || fields.accessToken || '') + '|' + (fields.deviceId || '');
        const curSig = ((stored.token || stored.accessToken || '') + '|' + (stored.deviceId || ''));
        if (sig !== curSig || !stored.lastSyncedAt) {
            await chrome.storage.local.set({
                [stateKey]: { ...stored, ...fields, lastSyncedAt: Date.now() }
            });
            if (notifyBadge) console.log('[磁力离线] ' + provider.label + ' Token 已同步');
        }
        return fields;
    }

    // 弹窗"立即同步"：就地读取一次并返回结果
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg && msg.cmd === 'readTokens') {
            syncOnce(true).then(fields => sendResponse({ ok: !!fields }))
                .catch(e => sendResponse({ ok: false, error: String(e) }));
            return true;
        }
    });

    syncOnce(true).catch(console.error);
    setInterval(() => syncOnce(false).catch(console.error), 2000);
})();
