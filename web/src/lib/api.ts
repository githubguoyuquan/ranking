/**
 * 后端 Nest API 基址。浏览器与 Server Components 均使用 NEXT_PUBLIC_*。
 * 未配置时与 `web/.env.example` 中的示例一致。
 */
export const DEFAULT_PUBLIC_API_URL = "http://localhost:3000";

export function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_PUBLIC_API_URL;
}

/** 绝对 URL：`apiBase + path`（path 可省略前导 `/`）。 */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBase()}${p}`;
}
