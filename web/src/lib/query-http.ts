/** Shared transport only. Resource aggregation lives in Nest query services. */
export function adminApiHeaders(): Record<string, string> {
  const key = process.env.NEXT_PUBLIC_API_KEY?.trim();
  return key ? { "X-API-Key": key } : {};
}
export async function queryJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { headers: adminApiHeaders(), cache: "no-store", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
