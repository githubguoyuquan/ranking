/**
 * 后端 Nest API 基址。浏览器与 Server Components 均使用 NEXT_PUBLIC_*。
 */
export function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
}
