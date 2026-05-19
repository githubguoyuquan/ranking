import { Injectable, Logger } from '@nestjs/common';

/**
 * 可选 Qdrant 向量库（Phase C）；未配置 `QDRANT_URL` 时不连接。
 * 当前生产检索仍以 ES dense_vector + PG TopicEmbedding 为主。
 */
@Injectable()
export class QdrantService {
  private readonly logger = new Logger(QdrantService.name);
  private readonly url = process.env.QDRANT_URL?.trim() ?? '';

  isEnabled(): boolean {
    return this.url.length > 0;
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    if (!this.isEnabled()) {
      return { ok: false, detail: 'QDRANT_URL not set' };
    }
    try {
      const res = await fetch(`${this.url.replace(/\/$/, '')}/collections`);
      return { ok: res.ok, detail: res.ok ? 'collections' : `HTTP ${res.status}` };
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  }

  status(): Record<string, unknown> {
    return {
      enabled: this.isEnabled(),
      url: this.isEnabled() ? this.url : null,
      note: 'Use ES kNN or PG TopicEmbedding when Qdrant is disabled',
    };
  }
}
