import { Injectable } from '@nestjs/common';
import { QdrantSearchService } from '../search/qdrant-search.service';

/** 规模运维页探活；检索实现见 `QdrantSearchService` */
@Injectable()
export class QdrantService {
  constructor(private readonly qdrant: QdrantSearchService) {}

  isEnabled(): boolean {
    return this.qdrant.isEnabled();
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    return this.qdrant.ping();
  }

  status(): Record<string, unknown> {
    return {
      enabled: this.isEnabled(),
      url: process.env.QDRANT_URL?.trim() || null,
      collections: {
        entities: process.env.QDRANT_COLLECTION_ENTITIES ?? 'ranking_entities',
        crawledUrls:
          process.env.QDRANT_COLLECTION_CRAWLED_URLS ?? 'ranking_crawled_urls',
      },
      searchPrimary: process.env.SEARCH_PRIMARY?.trim() || 'auto',
    };
  }
}
