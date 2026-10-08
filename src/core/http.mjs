export function errMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

// Bounded requests; never automatically retry a submission (duplicate tasks).
export async function fetchJSON(method, url, headers = {}, data) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch(url, {
            method, headers, signal: controller.signal,
            ...(data == null ? {} : { body: JSON.stringify(data) })
        });
        let body;
        try { body = await response.json(); }
        catch { throw new Error('接口返回异常（HTTP ' + response.status + '）'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new Error('接口返回格式异常（HTTP ' + response.status + '）');
        }
        // Leave 401 to the adapter's existing credential handling.
        if (response.status >= 400 && response.status !== 401) {
            throw new Error('接口请求失败（HTTP ' + response.status + '）：' +
                (body.message || body.error_description || body.error || '未知错误'));
        }
        return { status: response.status, body };
    } catch (error) {
        if (controller.signal.aborted) throw new Error('请求超时，请确认网盘任务状态后再试');
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}
