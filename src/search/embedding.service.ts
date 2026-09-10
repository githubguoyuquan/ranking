import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AI_AUDIT_SOURCE_EMBEDDING_SEARCH } from '../ai-audit/ai-audit.constants';
import { EMBEDDING_DIMS } from './embedding.constants';

function aliasesToText(aliases: Prisma.JsonValue | null | undefined): string {
  if (aliases === null || aliases === undefined) return '';
  if (Array.isArray(aliases)) {
    return aliases.filter((value): value is string => typeof value === 'string').join(' ');
  }
  if (typeof aliases === 'object') return JSON.stringify(aliases);
  return String(aliases);
}

function hashToken(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 项目内确定性特征哈希：不联网、不需要密钥，同一文本始终得到同一向量。
 * 单字、双字和词特征兼顾中文与以空格分词的语言。
 */
export function localTextEmbedding(input: string): number[] {
  const normalized = input.normalize('NFKC').toLocaleLowerCase().trim().slice(0, 8_000);
  const vector = new Array<number>(EMBEDDING_DIMS).fill(0);
  if (!normalized) return vector;

  const compact = [...normalized].filter((char) => /[\p{L}\p{N}]/u.test(char));
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const features = [
    ...tokens.map((token) => `w:${token}`),
    ...compact.map((char) => `c:${char}`),
    ...compact.slice(0, -1).map((char, index) => `b:${char}${compact[index + 1]}`),
  ];
  for (const feature of features) {
    const hash = hashToken(feature);
    const slot = hash % EMBEDDING_DIMS;
    vector[slot] += (hash & 0x80000000) === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

export type EmbeddingAuditContext = {
  source: string;
  operation?: string;
};

@Injectable()
export class EmbeddingService {
  isConfigured(): boolean {
    return true;
  }

  async embedText(input: string, _auditCtx?: EmbeddingAuditContext): Promise<number[]> {
    void _auditCtx;
    return localTextEmbedding(input);
  }

  async embedMany(inputs: string[], _auditCtx?: EmbeddingAuditContext): Promise<number[][]> {
    void _auditCtx;
    return inputs.map(localTextEmbedding);
  }

  async embedForEntity(
    canonicalName: string,
    aliases: Prisma.JsonValue | null | undefined,
    auditCtx?: EmbeddingAuditContext,
  ): Promise<number[]> {
    const aliasText = aliasesToText(aliases);
    const text = aliasText.length > 0 ? `${canonicalName.trim()}\n${aliasText}` : canonicalName.trim();
    return this.embedText(text, auditCtx ?? {
      source: AI_AUDIT_SOURCE_EMBEDDING_SEARCH,
      operation: 'entity_embed_local',
    });
  }
}
