import type { PiiLevel } from '@prisma/client';

export type ApiKeyScope = 'read' | 'write' | 'admin';

export function parseApiKeyScopes(raw: unknown): ApiKeyScope[] {
  if (!Array.isArray(raw)) return ['read'];
  const out: ApiKeyScope[] = [];
  for (const x of raw) {
    if (x === 'read' || x === 'write' || x === 'admin') out.push(x);
  }
  return out.length ? out : ['read'];
}

export function canViewHighPii(scopes: ApiKeyScope[]): boolean {
  return scopes.includes('admin');
}

/** 对外响应脱敏：HIGH 且非 admin 时隐藏可识别名称 */
export function redactCanonicalName(
  name: string,
  piiLevel: PiiLevel,
  scopes: ApiKeyScope[],
): string {
  if (piiLevel !== 'HIGH' || canViewHighPii(scopes)) return name;
  if (name.length <= 2) return '**';
  return `${name.slice(0, 1)}${'*'.repeat(Math.min(name.length - 1, 8))}`;
}

export function redactAliases(
  aliases: unknown,
  piiLevel: PiiLevel,
  scopes: ApiKeyScope[],
): unknown {
  if (piiLevel !== 'HIGH' || canViewHighPii(scopes)) return aliases;
  if (aliases === null || aliases === undefined) return aliases;
  if (Array.isArray(aliases)) return aliases.map(() => '[redacted]');
  return '[redacted]';
}
