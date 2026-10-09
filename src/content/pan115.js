// HttpOnly cookies stay in Chrome; requests run on the 115 origin.
(function () {
    'use strict';
    if (location.origin !== 'https://115.com' || window.top !== window) return;

    function failure(message, code = 'SUBMIT_FAILED') {
        return Object.assign(new Error(message), { code });
    }

    function checkError(body) {
        const message = body.error_msg || body.message || body.msg || '115网盘请求失败';
        const code = Number(body.errcode ?? body.error_code ?? body.code);
        if (code === 911) throw failure('115需要安全验证，请到云下载页面完成验证后重试', 'VERIFICATION_REQUIRED');
        if (code === 99 || /登录|登陆|cookie|会话|login/i.test(message)) {
            throw failure('115登录已失效，请重新登录并同步', 'TOKEN_EXPIRED');
        }
        throw failure(message);
    }

    async function request(url, data) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(url, {
                method: data ? 'POST' : 'GET', credentials: 'include', cache: 'no-store',
                signal: controller.signal,
                ...(data ? {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
                    body: new URLSearchParams(data)
                } : {})
            });
            if (response.status === 401 || response.status === 403) {
                throw failure('115登录已失效，请重新登录并同步', 'TOKEN_EXPIRED');
            }
            if (!response.ok) throw failure('115接口请求失败（HTTP ' + response.status + '）');
            const text = await response.text();
            let body;
            try { body = JSON.parse(text); }
            catch {
                if (/<!doctype|<html/i.test(text)) throw failure('115返回了网页而非接口数据，请确认已登录', 'TOKEN_EXPIRED');
                throw failure('115接口返回了无效JSON，请先检查云下载任务列表再重试', 'REQUEST_UNCERTAIN');
            }
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure('115接口返回格式异常，请先检查云下载任务列表再重试', 'REQUEST_UNCERTAIN');
            return body;
        } catch (error) {
            if (controller.signal.aborted) throw failure('115请求超时，请先检查云下载任务列表再重试', 'REQUEST_UNCERTAIN');
            if (!error.code) throw failure('115网络连接中断，请先检查云下载任务列表再重试', 'REQUEST_UNCERTAIN');
            throw error;
        } finally { clearTimeout(timer); }
    }

    async function signature() {
        const body = await request('https://115.com/?ct=offline&ac=space');
        if (body.state === false) checkError(body);
        if (!body.sign || !body.time) throw failure('无法获取115离线签名，请重新登录并同步', 'TOKEN_EXPIRED');
        return { sign: String(body.sign), time: String(body.time) };
    }

    async function submit(msg) {
        if (typeof msg.link !== 'string' || !msg.link.trim()) throw failure('下载链接不能为空');
        if (!/^\d+$/.test(String(msg.uid || ''))) throw failure('缺少115登录UID', 'TOKEN_EXPIRED');
        let dirId = String(msg.dirId || '');
        if (dirId && !/^\d+$/.test(dirId)) throw failure('115文件夹ID必须是数字');
        const key = await signature();
        if (!dirId) {
            const paths = await request('https://webapi.115.com/offine/downpath');
            if (paths.state === false) checkError(paths);
            if (!Array.isArray(paths.data)) throw failure('115默认云下载目录返回格式异常');
            const selected = paths.data.find(path => Number(path.is_selected) === 1);
            if (selected) {
                dirId = String(selected.file_id);
                if (!/^\d+$/.test(dirId)) throw failure('115默认云下载目录ID无效');
            }
        }
        const body = await request('https://115.com/web/lixian/?ct=lixian&ac=add_task_url', {
            url: msg.link.trim(), uid: String(msg.uid), ...key, savepath: '', wp_path_id: dirId
        });
        if (body.state !== true) checkError(body);
        return { ok: true };
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.cmd === 'ping115') { sendResponse({ ok: true }); return; }
        if (msg?.cmd !== 'check115' && msg?.cmd !== 'submit115') return;
        const task = msg.cmd === 'check115' ? signature().then(() => ({ ok: true })) : submit(msg);
        task.then(sendResponse).catch(error => sendResponse({ ok: false, code: error.code || 'SUBMIT_FAILED', error: error.message }));
        return true;
    });
})();
