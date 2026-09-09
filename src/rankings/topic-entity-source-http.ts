import { ServiceUnavailableException } from '@nestjs/common';
import { ProxyAgent, fetch as proxyFetch } from 'undici';

const ALLOWED_ENDPOINTS = new Set([
  'https://www.wikidata.org/w/api.php',
  'https://query.wikidata.org/sparql',
  'https://api.openai.com/v1/chat/completions',
]);
const MAX_RESPONSE_BYTES = 1_048_576;

export function sourceRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Fixed providers only: neither topic text nor provider output can choose a destination. */
export async function entitySourceJson(
  url: URL,
  options: { body?: Record<string, unknown>; apiKey?: string } = {},
): Promise<unknown> {
  const endpoint = `${url.origin}${url.pathname}`;
  const isOpenAi = endpoint === 'https://api.openai.com/v1/chat/completions';
  if (!ALLOWED_ENDPOINTS.has(endpoint) || url.username || url.password
    || (options.apiKey && !isOpenAi)) {
    throw new Error('Unsupported entity discovery endpoint');
  }
  let dispatcher: ProxyAgent | undefined;
  try {
    const proxy = process.env.ENTITY_DISCOVERY_HTTP_PROXY?.trim()
      || process.env.CRAWL_HTTP_PROXY?.trim();
    if (proxy) dispatcher = new ProxyAgent(proxy);
    const request = {
      method: options.body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'RankingPlatform/0.1 (entity discovery)',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(isOpenAi && options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.apiKey ? 30_000 : 15_000),
      redirect: 'error' as const,
    };
    const response = dispatcher
      ? await proxyFetch(url, { ...request, dispatcher })
      : await fetch(url, request);
    if (!response.ok || !response.body) throw new Error(`Provider status ${response.status}`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Provider response exceeds limit');
      }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ServiceUnavailableException(
      '实体语义解析或公开来源暂时无法访问，请检查网络与服务配置后重试；不会用虚构对象补齐。',
    );
  } finally {
    if (dispatcher) await dispatcher.destroy();
  }
}
