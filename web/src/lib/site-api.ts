import { apiUrl } from "@/lib/api";

/** C 端请求头：`read` 作用域 API Key（生产 `API_AUTH_REQUIRED=true` 时必填） */
export function siteApiHeaders(): HeadersInit {
  const key =
    process.env.NEXT_PUBLIC_READ_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_API_KEY?.trim();
  return key ? { "X-API-Key": key } : {};
}

export async function siteFetchJson<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; text: string }> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { ...siteApiHeaders(), ...init?.headers },
    cache: init?.cache ?? "no-store",
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, status: res.status, text };
  }
}
