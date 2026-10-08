import md5 from '../vendor/md5.mjs';
import { getProviderState, saveProviderState } from '../core/storage.mjs';
import { fetchJSON } from '../core/http.mjs';
export const config = {
    key: 'pikpak',
    label: 'PikPak',
    homeUrl: 'https://mypikpak.com/drive/all',
    tabPatterns: ['https://mypikpak.com/*', 'https://*.mypikpak.com/*'],
    apiBase: 'https://api-drive.mypikpak.com/drive/v1/',
    authBase: 'https://user.mypikpak.com',
    webClientId: 'YUMx5nI8ZU8Ap8pm',
    clientVersion: '2.0.0',
    packageName: 'mypikpak.com',
    buildTimestamp: '1790733736477', // 官方前端构建时固化的基准时间戳
    captchaSalts: ['C9qPpZLN8ucRTaTiUMWYS9cQvWOE','+r6CQVxjzJV6LCV','F','pFJRC','9WXYIDGrwTCz2OiVlgZa90qpECPD6olt','/750aCr4lm/Sly/c','RB+DT/gZCrbV','','CyLsf7hdkIRxRm215hl','7xHvLi2tOYP0Y92b','ZGTXXxu8E/MIWaEDB+Sm/','1UI3','E7fP5Pfijd+7K+t6Tg/NhuLq0eEUVChpJSkrKxpO','ihtqpG6FMt65+Xk+tWUH2','NhXXU9rg4XXdzo7u5o']
};

const PIKPAK = config;
async function pikpakEnsureToken(force) {
    let st = await getProviderState('pikpak');
    if (!st.refreshToken) throw Object.assign(new Error('未同步PikPak Token，请打开PikPak网盘页面'), { code: 'NO_TOKEN' });
    if (!force && st.expiresAt && Date.now() < st.expiresAt - 300000) return st;

    const { status, body } = await fetchJSON('POST', PIKPAK.authBase + '/v1/auth/token', {
        'Content-Type': 'application/json'
    }, {
        client_id: PIKPAK.webClientId,
        refresh_token: st.refreshToken,
        grant_type: 'refresh_token'
    });
    if (!body || !body.access_token) {
        const reason = body ? (body.error_description || body.error) : ('HTTP ' + status);
        throw Object.assign(new Error('PikPak Token刷新失败: ' + reason + '，请打开PikPak网盘页面重新同步'), { code: 'TOKEN_EXPIRED' });
    }
    // 服务端会轮换 refresh_token，必须保存新值
    await saveProviderState('pikpak', {
        accessToken: body.access_token,
        refreshToken: body.refresh_token || st.refreshToken,
        sub: body.sub || st.sub,
        expiresAt: Date.now() + Number(body.expires_in || 7200) * 1000
    });
    return getProviderState('pikpak');
}

// captcha token 与 client_id/设备ID/请求路径绑定，5分钟有效 → 逐请求生成
async function pikpakGetCaptchaToken(sub, deviceId, action) {
    if (!deviceId) throw new Error('缺少设备ID，请打开PikPak网盘页面同步');
    let sign = PIKPAK.webClientId + PIKPAK.clientVersion + PIKPAK.packageName + deviceId + PIKPAK.buildTimestamp;
    for (const salt of PIKPAK.captchaSalts) sign = md5(sign + salt);
    const { body } = await fetchJSON('POST', PIKPAK.authBase + '/v1/shield/captcha/init', {
        'Content-Type': 'application/json'
    }, {
        client_id: PIKPAK.webClientId,
        action: action,
        device_id: deviceId,
        meta: {
            captcha_sign: '1.' + sign,
            timestamp: PIKPAK.buildTimestamp,
            client_version: PIKPAK.clientVersion,
            package_name: PIKPAK.packageName,
            user_id: sub || ''
        }
    });
    if (!body || !body.captcha_token) {
        throw new Error('获取captcha失败: ' + (body ? (body.error_description || body.error) : '空响应'));
    }
    return body.captcha_token;
}

async function pikpakRequest(method, path, data, retried) {
    const st = await pikpakEnsureToken(false);
    // captcha 与完整请求路径绑定（如 "POST:/drive/v1/files"）
    const apiPath = '/drive/v1/' + path.split('?')[0];
    const captchaToken = await pikpakGetCaptchaToken(st.sub, st.deviceId, method.toUpperCase() + ':' + apiPath);
    const { status, body } = await fetchJSON(method, PIKPAK.apiBase + path, {
        'Authorization': 'Bearer ' + st.accessToken,
        'Content-Type': 'application/json',
        'X-Device-Id': st.deviceId,
        'X-Captcha-Token': captchaToken
    }, data);
    if (status === 401 && !retried) {
        await pikpakEnsureToken(true);
        return pikpakRequest(method, path, data, true);
    }
    return body;
}

// 转存单条链接
export async function submitOne(link, dirId) {
    const payload = {
        kind: 'drive#file',
        upload_type: 'UPLOAD_TYPE_URL',
        url: { url: link }, // 嵌套对象！字符串写法会被 proto 解析拒绝
        params: { from: 'manual' }
    };
    if (dirId) payload.parent_id = String(dirId);
    else payload.folder_type = 'DOWNLOAD';
    const body = await pikpakRequest('POST', 'files', payload);
    if (body && body.error) throw new Error(body.error_description || body.error);
    return 1;
}


export const getAuthStatus = state => ({ hasToken: !!state.accessToken, refreshTokenReady: !!state.refreshToken });
