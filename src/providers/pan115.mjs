import { getProviderState, saveProviderState } from '../core/storage.mjs';

export const config = {
    key: 'pan115', label: '115网盘', homeUrl: 'https://115.com/',
    offlineUrl: 'https://115.com/?tab=offline&mode=wangpan',
    tabPatterns: ['https://115.com/*']
};
const authError = (message, code = 'NO_TOKEN') => Object.assign(new Error(message), { code });

export async function refreshSession(revalidate = false) {
    const cookies = await chrome.cookies.getAll({ url: config.homeUrl });
    const value = name => cookies.find(cookie => cookie.name === name && cookie.value)?.value || '';
    const uid = value('UID').split('_')[0];
    const hasCookies = /^\d+$/.test(uid) && !!value('CID') && !!value('SEID');
    const stored = await getProviderState(config.key);
    const sessionInvalid = hasCookies && !revalidate && !!stored.sessionInvalid;
    const hasSession = hasCookies && !sessionInvalid;
    if (stored.hasSession !== hasSession || stored.uid !== (hasSession ? uid : '') || !!stored.sessionInvalid !== sessionInvalid) {
        await saveProviderState(config.key, {
            hasSession, sessionInvalid, uid: hasSession ? uid : '', lastSyncedAt: hasSession ? Date.now() : null
        });
    }
    return { hasSession, uid: hasSession ? uid : '' };
}

async function pageMessage(tabId, message) {
    let timer;
    try {
        return await Promise.race([
            chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => {
                throw authError('115页面连接中断，请先检查云下载任务列表再重试', 'REQUEST_UNCERTAIN');
            }),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(authError('115页面响应超时，请先检查云下载任务列表再重试', 'REQUEST_UNCERTAIN')), message.cmd === 'ping115' ? 3000 : 95000);
            })
        ]);
    } finally { clearTimeout(timer); }
}

async function findPage() {
    const tabs = await chrome.tabs.query({ url: config.tabPatterns });
    tabs.sort((a, b) => Number(b.active) - Number(a.active));
    for (const tab of tabs) {
        try {
            const response = await pageMessage(tab.id, { cmd: 'ping115' });
            if (response?.ok) return tab;
        } catch { }
    }
    throw new Error('未找到可用的115页面，请打开115.com并刷新页面后重试');
}

async function requireSession() {
    const session = await refreshSession();
    if (!session.hasSession) throw authError('未读取到115登录状态，请打开115.com登录');
    return session;
}

async function checkResponse(response) {
    if (response?.ok) return;
    const code = response?.code || 'SUBMIT_FAILED';
    if (code === 'TOKEN_EXPIRED') {
        await saveProviderState(config.key, { hasSession: false, sessionInvalid: true, uid: '', lastSyncedAt: null });
    }
    throw authError(response?.error || '115网盘请求失败', code);
}

export async function syncSession() {
    const session = await refreshSession(true);
    const tabs = await chrome.tabs.query({ url: config.tabPatterns });
    if (!tabs.length) {
        await chrome.tabs.create({ url: session.hasSession ? config.offlineUrl : config.homeUrl });
        return { ok: true, opened: true };
    }
    await requireSession();
    let tab;
    try { tab = await findPage(); }
    catch {
        await chrome.tabs.reload(tabs.find(tab => tab.active)?.id || tabs[0].id);
        return { ok: true, reloading: true };
    }
    await checkResponse(await pageMessage(tab.id, { cmd: 'check115' }));
    await saveProviderState(config.key, { ...session, lastSyncedAt: Date.now() });
    return { ok: true };
}

export async function submitOne(link, dirId) {
    if (dirId && !/^\d+$/.test(dirId)) throw new Error('115文件夹ID必须是数字（文件夹网址中的cid，0为根目录）');
    const { uid } = await requireSession();
    const tab = await findPage();
    // Never retry a POST on another tab: a lost response may still have created a task.
    const response = await pageMessage(tab.id, { cmd: 'submit115', link, dirId: dirId || '', uid });
    await checkResponse(response);
    return 0;
}

export const getAuthStatus = state => ({ hasToken: !!state.hasSession });
