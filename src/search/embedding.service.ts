import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AiAuditService } from '../ai-audit/ai-audit.service';
import {
  AI_AUDIT_SOURCE_EMBEDDING_SEARCH,
} from '../ai-audit/ai-audit.constants';
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMS } from './embedding.constants';

function aliasesToText(aliases: Prisma.JsonValue | null | undefined): string {
  if (aliases === null || aliases === undefined) return '';
  if (Array.isArray(aliases)) {
    return aliases.filter((x): x is string => typeof x === 'string').join(' ');
  }
  if (typeof aliases === 'object') return JSON.stringify(aliases);
  return String(aliases);
}

export type EmbeddingAuditContext = {
  source: string;
  operation?: string;
};

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(private readonly audit: AiAuditService) {}

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  private embeddingAuditEnabled(): boolean {
    return process.env.AI_EMBEDDING_AUDIT !== 'false';
  }

  private async assertEmbeddingDailyCap(): Promise<void> {
    const raw = process.env.AI_EMBEDDING_DAILY_CAP?.trim();
    if (!raw) return;
    const cap = Number(raw);
    if (!Number.isFinite(cap) || cap < 0) return;
    const { start } = this.audit.utcDayBounds();
    const n = await this.audit.countSuccessfulEmbeddingsSince(start);
    if (n >= cap) {
      throw new ServiceUnavailableException(
        `Embedding quota: daily cap ${cap} (UTC) successful batches reached`,
      );
    }
  }

  async embedText(input: string, auditCtx?: EmbeddingAuditContext): Promise<number[]> {
    const vectors = await this.embedMany([input], auditCtx);
    return vectors[0] ?? [];
  }

  /** 批量嵌入（单次请求，适合话题全量灌库） */
  async embedMany(
    inputs: string[],
    auditCtx?: EmbeddingAuditContext,
  ): Promise<number[][]> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY not set (required for semantic / vector search)',
      );
    }
    if (inputs.length === 0) return [];

    await this.assertEmbeddingDailyCap();

    const trimmed = inputs.map((s) => s.trim().slice(0, 8000));
    const model = DEFAULT_EMBEDDING_MODEL;

    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, input: trimmed }),
      });
    } catch (e) {
      if (this.embeddingAuditEnabled() && auditCtx) {
        await this.audit.recordEmbeddingBatch({
          operation: auditCtx.operation ?? 'openai.embeddings',
          model,
          inputCount: trimmed.length,
          success: false,
          errorMessage: e instanceof Error ? e.message : String(e),
          source: auditCtx.source,
        });
      }
      throw e;
    }

    if (!res.ok) {
      const err = await res.text();
      this.logger.warn(`OpenAI embeddings ${res.status}: ${err}`);
      if (this.embeddingAuditEnabled() && auditCtx) {
        await this.audit.recordEmbeddingBatch({
          operation: auditCtx.operation ?? 'openai.embeddings',
          model,
          inputCount: trimmed.length,
          success: false,
          errorMessage: err.slice(0, 2000),
          source: auditCtx.source,
        });
      }
      throw new ServiceUnavailableException(
        `OpenAI embeddings failed: HTTP ${res.status}`,
      );
    }

    const body = (await res.json()) as {
      data?: Array<{ index: number; embedding: number[] }>;
      usage?: { total_tokens?: number };
    };
    const rows = body.data;
    if (!rows?.length) {
      if (this.embeddingAuditEnabled() && auditCtx) {
        await this.audit.recordEmbeddingBatch({
          operation: auditCtx.operation ?? 'openai.embeddings',
          model,
          inputCount: trimmed.length,
          success: false,
          errorMessage: 'empty data',
          source: auditCtx.source,
        });
      }
      throw new ServiceUnavailableException('OpenAI embeddings: empty data');
    }

    const sorted = [...rows].sort((a, b) => a.index - b.index);
    for (const r of sorted) {
      if (!r.embedding || r.embedding.length !== EMBEDDING_DIMS) {
        if (this.embeddingAuditEnabled() && auditCtx) {
          await this.audit.recordEmbeddingBatch({
            operation: auditCtx.operation ?? 'openai.embeddings',
            model,
            inputCount: trimmed.length,
            success: false,
            errorMessage: `dim ${r.embedding?.length}`,
            source: auditCtx.source,
          });
        }
        throw new ServiceUnavailableException(
          `unexpected embedding dim: ${r.embedding?.length} (expected ${EMBEDDING_DIMS})`,
        );
      }
    }

    if (this.embeddingAuditEnabled() && auditCtx) {
      await this.audit.recordEmbeddingBatch({
        operation: auditCtx.operation ?? 'openai.embeddings',
        model,
        inputCount: trimmed.length,
        success: true,
        totalTokens: body.usage?.total_tokens ?? null,
        source: auditCtx.source,
      });
    }

    return sorted.map((r) => r.embedding);
  }

  async embedForEntity(
    canonicalName: string,
    aliases: Prisma.JsonValue | null | undefined,
    auditCtx?: EmbeddingAuditContext,
  ): Promise<number[]> {
    const a = aliasesToText(aliases);
    const text =
      a.length > 0 ? `${canonicalName.trim()}\n${a}` : canonicalName.trim();
    return this.embedText(text, auditCtx ?? {
      source: AI_AUDIT_SOURCE_EMBEDDING_SEARCH,
      operation: 'entity_embed',
    });
  }
}
