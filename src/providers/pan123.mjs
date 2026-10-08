import { getProviderState, saveProviderState } from '../core/storage.mjs';
import { fetchJSON } from '../core/http.mjs';
export const config = {
    key: 'pan123',
    label: '123云盘',
    homeUrl: 'https://yun.123pan.cn/',
    tabPatterns: ['https://yun.123pan.cn/*'],
    apiBase: 'https://api.123278.com/b/api/',
    resolvePath: 'v2/offline_download/task/resolve',
    submitPath: 'v2/offline_download/task/submit',
    getPath: 'file/get_path'
};

const PAN123 = config;
async function pan123Request(method, path, data) {
    const st = await getProviderState('pan123');
    if (!st.token) throw Object.assign(new Error('未同步123云盘Token，请打开123云盘页面'), { code: 'NO_TOKEN' });
    const { status, body } = await fetchJSON(method, PAN123.apiBase + path, {
        'Authorization': 'Bearer ' + st.token,
        'Content-Type': 'application/json;charset=UTF-8',
        'platform': 'web',
        'App-Version': '3'
    }, data);
    if (status === 401 || body.code === 401) throw Object.assign(new Error('123云盘Token已过期，请打开123云盘页面重新同步'), { code: 'TOKEN_EXPIRED' });
    return body;
}

// 转存单条链接，返回添加的文件数
export async function submitOne(link, dirId) {
    const resolveData = await pan123Request('POST', PAN123.resolvePath, { urls: link });
    if (resolveData.code !== 0) throw new Error(resolveData.message || ('code=' + resolveData.code));
    const list = resolveData.data && resolveData.data.list;
    if (!list || !list.length) throw new Error('解析结果为空');
    const task = list[0];
    if (task.err_code !== 0) throw new Error('解析失败 code=' + task.err_code);

    const fileIds = (task.files || []).map(f => f.id);
    const payload = { resource_list: [{ resource_id: task.id, select_file_id: fileIds }] };
    if (dirId) payload.upload_dir = dirId;
    const submitData = await pan123Request('POST', PAN123.submitPath, payload);
    if (submitData.code !== 0) throw new Error(submitData.message || ('code=' + submitData.code));
    return fileIds.length;
}


export const getAuthStatus = state => ({ hasToken: !!state.token });
