// background.mjs — MV3 service worker（module）：所有跨源 API 请求在这里发起
import * as P from '../core/offline.mjs';
import { getAdapter } from '../providers/index.mjs';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        switch (msg && msg.cmd) {
            case 'getStatus':
                return P.getStatus();
            case 'offline':
                return P.submitOffline(msg);
            case 'syncNow':
                return P.syncNow(msg.provider);
            case 'setDir':
                await P.setProviderDir(msg.provider, msg.dirId);
                return { ok: true };
            case 'openHome': {
                const conf = getAdapter(msg.provider).config;
                await chrome.tabs.create({ url: conf.homeUrl });
                return { ok: true };
            }
            default:
                throw new Error('未知指令: ' + (msg && msg.cmd));
        }
    })().then(sendResponse).catch(e => sendResponse({ error: (e && e.message) ? e.message : String(e) }));
    return true; // 保持消息通道开启直到异步完成
});
