import { Injectable, Logger } from '@nestjs/common';
import { ElasticService } from '../search/elastic.service';
import {
  ELASTIC_INDEX_CRAWLED_URLS,
  ELASTIC_INDEX_ENTITIES,
} from '../search/elastic.constants';

export type ElasticRolloverResult = {
  alias: string;
  ok: boolean;
  newIndex?: string;
  detail?: string;
};

@Injectable()
export class ElasticRolloverService {
  private readonly logger = new Logger(ElasticRolloverService.name);

  constructor(private readonly elastic: ElasticService) {}

  async rolloverEntities(maxDocs?: number, maxAge?: string): Promise<ElasticRolloverResult> {
    return this.elastic.rolloverWriteAlias(ELASTIC_INDEX_ENTITIES, { maxDocs, maxAge });
  }

  async rolloverCrawledUrls(maxDocs?: number, maxAge?: string): Promise<ElasticRolloverResult> {
    return this.elastic.rolloverWriteAlias(ELASTIC_INDEX_CRAWLED_URLS, { maxDocs, maxAge });
  }

  async indexStats(): Promise<unknown> {
    if (!this.elastic.isEnabled()) {
      return { ok: false, detail: 'ELASTICSEARCH_NODE not set' };
    }
    return this.elastic.getIndexStats();
  }

  async bootstrapWriteAliases(): Promise<unknown> {
    return this.elastic.bootstrapWriteAliases();
  }
}
