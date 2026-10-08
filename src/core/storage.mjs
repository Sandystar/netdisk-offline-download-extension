// Preserve legacy provider_<key> credentials; store preferences separately so
// page-side credential synchronization cannot overwrite a saved directory.
const pending = new Map();
const stateKey = key => 'provider_' + key;
const settingsKey = key => 'settings_' + key;

export async function getProviderState(key) {
    const keys = [stateKey(key), settingsKey(key)];
    const data = await chrome.storage.local.get(keys);
    return { ...(data[keys[0]] || {}), ...(data[keys[1]] || {}) };
}

export function saveProviderState(key, fields) {
    const previous = pending.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
        const data = await chrome.storage.local.get(stateKey(key));
        await chrome.storage.local.set({ [stateKey(key)]: { ...(data[stateKey(key)] || {}), ...fields } });
    });
    pending.set(key, task);
    task.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => {});
    return task;
}

export async function saveProviderDir(key, dirId) {
    if (typeof dirId !== 'string') throw new Error('文件夹ID必须是字符串');
    const value = dirId.trim();
    if (value.length > 256 || /[\u0000-\u001f]/.test(value)) throw new Error('文件夹ID格式不正确');
    await chrome.storage.local.set({ [settingsKey(key)]: { dirId: value } });
}
