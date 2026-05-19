import type { PiiLevel } from '@prisma/client';
import type { ApiKeyScope } from './pii-redact';
import { redactAliases, redactCanonicalName } from './pii-redact';

/** 单条 Entity 行 API 脱敏 */
export function redactEntityRecord<T extends { canonicalName: string; piiLevel?: PiiLevel; aliases?: unknown }>(
  row: T,
  scopes: ApiKeyScope[] = ['read'],
): T {
  const pii = row.piiLevel ?? 'NONE';
  return {
    ...row,
    canonicalName: redactCanonicalName(row.canonicalName, pii, scopes),
    aliases: redactAliases(row.aliases, pii, scopes),
  };
}

/** 对快照/榜单 API 的 plain JSON 脱敏实体字段 */
export function redactSnapshotPlainForScopes(
  plain: unknown,
  scopes: ApiKeyScope[] = ['read'],
): unknown {
  if (!plain || typeof plain !== 'object') return plain;
  const root = plain as Record<string, unknown>;

  if (Array.isArray(root.items)) {
    root.items = root.items.map((row) => redactRankingItemRow(row, scopes));
  }

  const nested = root.snapshot;
  if (nested && typeof nested === 'object') {
    redactSnapshotPlainForScopes(nested, scopes);
  }

  return plain;
}

function redactRankingItemRow(row: unknown, scopes: ApiKeyScope[]): unknown {
  if (!row || typeof row !== 'object') return row;
  const r = row as Record<string, unknown>;
  const ent = r.entity;
  if (!ent || typeof ent !== 'object') return row;
  const e = ent as Record<string, unknown>;
  const pii = (e.piiLevel as string | undefined) ?? 'NONE';
  if (typeof e.canonicalName === 'string') {
    e.canonicalName = redactCanonicalName(e.canonicalName, pii as 'NONE' | 'LOW' | 'HIGH', scopes);
  }
  if (e.aliases !== undefined) {
    e.aliases = redactAliases(e.aliases, pii as 'NONE' | 'LOW' | 'HIGH', scopes);
  }
  return row;
}
