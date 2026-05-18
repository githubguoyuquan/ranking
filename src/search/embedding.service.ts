import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMS } from './embedding.constants';

function aliasesToText(aliases: Prisma.JsonValue | null | undefined): string {
  if (aliases === null || aliases === undefined) return '';
  if (Array.isArray(aliases)) {
    return aliases.filter((x): x is string => typeof x === 'string').join(' ');
  }
  if (typeof aliases === 'object') return JSON.stringify(aliases);
  return String(aliases);
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  async embedText(input: string): Promise<number[]> {
    const vectors = await this.embedMany([input]);
    return vectors[0] ?? [];
  }

  /** 批量嵌入（单次请求，适合话题全量灌库） */
  async embedMany(inputs: string[]): Promise<number[][]> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY not set (required for semantic / vector search)',
      );
    }
    if (inputs.length === 0) return [];

    const trimmed = inputs.map((s) => s.trim().slice(0, 8000));
    const model = DEFAULT_EMBEDDING_MODEL;

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: trimmed }),
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.warn(`OpenAI embeddings ${res.status}: ${err}`);
      throw new ServiceUnavailableException(
        `OpenAI embeddings failed: HTTP ${res.status}`,
      );
    }

    const body = (await res.json()) as {
      data?: Array<{ index: number; embedding: number[] }>;
    };
    const rows = body.data;
    if (!rows?.length) {
      throw new ServiceUnavailableException('OpenAI embeddings: empty data');
    }

    const sorted = [...rows].sort((a, b) => a.index - b.index);
    for (const r of sorted) {
      if (!r.embedding || r.embedding.length !== EMBEDDING_DIMS) {
        throw new ServiceUnavailableException(
          `unexpected embedding dim: ${r.embedding?.length} (expected ${EMBEDDING_DIMS})`,
        );
      }
    }
    return sorted.map((r) => r.embedding);
  }

  async embedForEntity(
    canonicalName: string,
    aliases: Prisma.JsonValue | null | undefined,
  ): Promise<number[]> {
    const a = aliasesToText(aliases);
    const text =
      a.length > 0 ? `${canonicalName.trim()}\n${a}` : canonicalName.trim();
    return this.embedText(text);
  }

}
