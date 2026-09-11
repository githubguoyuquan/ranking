/** Shared transport only. Resource aggregation lives in Nest query services. */
export function adminApiHeaders(): Record<string, string> {
  const key = process.env.NEXT_PUBLIC_API_KEY?.trim();
  return key ? { "X-API-Key": key } : {};
}
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

const statusReasons: Record<number, string> = {
  400: "提交内容不符合要求，请检查输入。",
  401: "身份验证失败，请检查访问密钥。",
  403: "当前账号没有执行此操作的权限。",
  404: "请求的资源或接口不存在。",
  409: "数据冲突，可能存在重复记录或状态已变化。",
  429: "请求过于频繁，请稍后重试。",
  500: "服务处理失败，具体原因需查看后台日志。",
  502: "网关无法获取后台响应。",
  503: "后台服务暂时不可用。",
  504: "后台响应超时，请稍后重试。",
};

/** 只提取约定的错误信息，不展示原始 HTML、堆栈或整个响应对象。 */
export async function apiResponseError(response: Response): Promise<ApiRequestError> {
  let reason = statusReasons[response.status] ?? "请求失败，请稍后重试。";
  let requestId = response.headers.get("x-request-id") ?? undefined;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const value = body as Record<string, unknown>;
      const message = Array.isArray(value.message)
        ? value.message.filter((item): item is string => typeof item === "string").join("；")
        : typeof value.message === "string" ? value.message : "";
      if (message.trim() && message !== "Internal server error") reason = message.trim();
      if (!requestId && typeof value.requestId === "string") requestId = value.requestId;
    }
  } catch {
    // 非 JSON 响应使用状态码对应的说明。
  }
  requestId = requestId?.slice(0, 128);
  return new ApiRequestError(
    `${reason.slice(0, 1500)}（HTTP ${response.status}）${requestId ? ` 请求编号：${requestId}` : ""}`,
    response.status,
    requestId,
  );
}

/** 所有 HTTP 方法共用；保留取消信号，网络错误不臆断为服务未启动。 */
export async function apiRequest(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(adminApiHeaders());
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, cache: "no-store" });
  } catch (error) {
    if (init.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new ApiRequestError("无法连接后台服务，请检查服务是否启动、网络及跨域配置；浏览器未返回具体原因。");
  }
  if (!response.ok) throw await apiResponseError(response);
  return response;
}

export async function queryJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await apiRequest(url, { signal });
  try {
    return await response.json() as T;
  } catch {
    throw new ApiRequestError("后台返回的数据格式异常，无法读取 JSON。", response.status);
  }
}
