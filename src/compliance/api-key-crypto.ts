import { createHash, randomBytes } from 'crypto';

/** 生成 `rk_` 前缀的明文密钥（仅创建时返回一次） */
export function generateApiKeyPlaintext(): string {
  return `rk_${randomBytes(24).toString('base64url')}`;
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

export function apiKeyPrefix(plaintext: string): string {
  return plaintext.slice(0, 12);
}

export function extractApiKeyFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = headers['x-api-key'];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  const auth = headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}
