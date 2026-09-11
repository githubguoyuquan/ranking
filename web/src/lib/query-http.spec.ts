import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, apiResponseError, queryJson } from './query-http';

afterEach(() => vi.unstubAllGlobals());

describe('公共请求错误', () => {
  it('保留验证错误数组及请求编号', async () => {
    const error = await apiResponseError(new Response(JSON.stringify({ message: ['名称不能为空', '数量必须为正整数'] }), {
      status: 400, headers: { 'x-request-id': 'request-123' },
    }));
    expect(error.message).toContain('名称不能为空；数量必须为正整数');
    expect(error.status).toBe(400);
    expect(error.requestId).toBe('request-123');
  });
  it('不把代理 HTML 错误页直接展示给运营', async () => {
    const error = await apiResponseError(new Response('<html>private diagnostic</html>', { status: 502 }));
    expect(error.message).toContain('网关');
    expect(error.message).not.toContain('private diagnostic');
  });
  it('解释网络故障且保留主动取消', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiRequest('http://localhost/test')).rejects.toThrow('无法连接后台服务');
    const abort = new DOMException('cancelled', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    await expect(apiRequest('http://localhost/test')).rejects.toBe(abort);
  });
  it('原 queryJson 调用者自动获得后台具体原因', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: '内部标识已存在' }), { status: 409 })));
    await expect(queryJson('http://localhost/test')).rejects.toThrow('内部标识已存在');
  });
  it('解释成功响应中损坏的 JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json')));
    await expect(queryJson('http://localhost/test')).rejects.toThrow('数据格式异常');
  });
});
