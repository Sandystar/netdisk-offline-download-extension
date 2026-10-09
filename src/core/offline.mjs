import { adapters, PROVIDERS, getAdapter } from '../providers/index.mjs';
import { getProviderState, saveProviderDir } from './storage.mjs';
import { errMessage } from './http.mjs';
import { refreshSession, syncSession } from '../providers/pan115.mjs';
export { PROVIDERS };
export { getProviderState, saveProviderState } from './storage.mjs';

export const sync115 = syncSession;
export async function setProviderDir(key, dirId) {
    getAdapter(key);
    if (key === 'pan115' && dirId && !/^\d+$/.test(dirId.trim())) throw new Error('115文件夹ID必须是数字（网址中的cid）');
    await saveProviderDir(key, dirId);
}

export async function getStatus() {
    await refreshSession();
    const entries = await Promise.all(Object.entries(adapters).map(async ([key, adapter]) => {
        const state = await getProviderState(key);
        return [key, {
            label: adapter.config.label, homeUrl: adapter.config.homeUrl,
            ...adapter.getAuthStatus(state), expiresAt: state.expiresAt || null,
            lastSyncedAt: state.lastSyncedAt || null, dirId: state.dirId || ''
        }];
    }));
    return Object.fromEntries(entries);
}

export async function submitOffline(msg = {}) {
    if (!Array.isArray(msg.links) || !msg.links.length) throw new Error('没有可提交的链接');
    if (msg.links.some(link => typeof link !== 'string')) throw new Error('链接必须是字符串');
    const links = [...new Set(msg.links.map(link => link.trim()).filter(Boolean))];
    if (!links.length) throw new Error('没有可提交的链接');
    if (!Array.isArray(msg.targets)) throw new Error('请至少勾选一个网盘');
    const targets = msg.targets.filter(target => target && target.checked !== false);
    if (!targets.length) throw new Error('请至少勾选一个网盘');
    // Reject malformed batches before any network side effects.
    const unique = new Map();
    for (const target of targets) {
        getAdapter(target.provider);
        if (target.dirId != null && typeof target.dirId !== 'string') throw new Error('文件夹ID必须是字符串');
        if (unique.has(target.provider)) throw new Error('不能重复选择同一网盘');
        unique.set(target.provider, target);
    }
    const entries = await Promise.all([...unique].map(async ([key, target]) => {
        const adapter = getAdapter(key);
        const result = { label: adapter.config.label, total: links.length, ok: 0, fail: 0,
            skipped: 0, filesAdded: 0, tokenError: null, detail: [] };
        try {
            const dirId = (target.dirId || '').trim() || (await getProviderState(key)).dirId || '';
            for (const link of links) {
                try {
                    const count = await adapter.submitOne(link, dirId);
                    result.ok++; result.filesAdded += count || 0;
                    result.detail.push({ link, ok: true });
                } catch (error) {
                    result.fail++;
                    result.detail.push({ link, ok: false, message: errMessage(error) });
                    if (['NO_TOKEN', 'TOKEN_EXPIRED', 'VERIFICATION_REQUIRED', 'REQUEST_UNCERTAIN'].includes(error.code)) {
                        result.tokenError = errMessage(error);
                        break;
                    }
                }
            }
        } catch (error) { result.error = errMessage(error); }
        result.skipped = result.total - result.ok - result.fail;
        return [key, result];
    }));
    return { results: Object.fromEntries(entries) };
}

export async function syncNow(key) {
    if (key === 'pan115') return syncSession();
    const { config } = getAdapter(key);
    const tabs = await chrome.tabs.query({ url: config.tabPatterns });
    if (!tabs.length) {
        await chrome.tabs.create({ url: config.homeUrl });
        return { ok: true, opened: true };
    }
    let response;
    try { response = await chrome.tabs.sendMessage(tabs[0].id, { cmd: 'readTokens' }); }
    catch {
        await chrome.tabs.reload(tabs[0].id);
        return { ok: true, opened: false, reloading: true };
    }
    if (!response?.ok) throw new Error(response?.error || '未读取到登录态，请先登录网盘');
    return { ok: true, opened: false };
}
