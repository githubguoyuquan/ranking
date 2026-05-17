import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ELASTIC_INDEX_ENTITIES } from './elastic.constants';

function aliasesToText(aliases: Prisma.JsonValue | null | undefined): string {
  if (aliases === null || aliases === undefined) return '';
  if (Array.isArray(aliases)) {
    return aliases.filter((x): x is string => typeof x === 'string').join(' ');
  }
  if (typeof aliases === 'object') return JSON.stringify(aliases);
  return String(aliases);
}

@Injectable()
export class ElasticService implements OnModuleDestroy {
  private readonly logger = new Logger(ElasticService.name);
  private client: Client | null = null;
  private indexReady = false;

  constructor(private readonly prisma: PrismaService) {
    const node = process.env.ELASTICSEARCH_NODE?.trim();
    if (!node) {
      this.logger.warn('ELASTICSEARCH_NODE not set — entity search disabled');
      return;
    }
    this.client = new Client({ node, requestTimeout: 30_000 });
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  async ping(): Promise<{ ok: boolean; clusterName?: string; detail?: string }> {
    if (!this.client) return { ok: false, detail: 'ELASTICSEARCH_NODE not set' };
    try {
      const info = await this.client.info();
      return { ok: true, clusterName: info.cluster_name };
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async ensureEntityIndex(): Promise<void> {
    if (!this.client) return;
    if (this.indexReady) return;

    const exists = await this.client.indices.exists({ index: ELASTIC_INDEX_ENTITIES });
    if (!exists) {
      await this.client.indices.create({
        index: ELASTIC_INDEX_ENTITIES,
        mappings: {
          properties: {
            entityId: { type: 'keyword' },
            type: { type: 'keyword' },
            canonicalName: {
              type: 'text',
              analyzer: 'standard',
              fields: { keyword: { type: 'keyword', ignore_above: 256 } },
            },
            aliases: { type: 'text', analyzer: 'standard' },
          },
        },
      });
      this.logger.log(`Created index ${ELASTIC_INDEX_ENTITIES}`);
    }
    this.indexReady = true;
  }

  /** 全量从 PG 重建实体索引（开发/运维；生产可改为 CDC/增量） */
  async reindexAllEntitiesFromDb(): Promise<number> {
    if (!this.client) {
      throw new ServiceUnavailableException('Elasticsearch not configured (ELASTICSEARCH_NODE)');
    }
    await this.ensureEntityIndex();
    const entities = await this.prisma.entity.findMany();
    if (entities.length === 0) return 0;

    const operations: object[] = [];
    for (const e of entities) {
      operations.push({
        index: { _index: ELASTIC_INDEX_ENTITIES, _id: e.id.toString() },
      });
      operations.push({
        entityId: e.id.toString(),
        type: e.type,
        canonicalName: e.canonicalName,
        aliases: aliasesToText(e.aliases),
      });
    }

    const res = await this.client.bulk({ operations, refresh: true });
    if (res.errors) {
      const first = res.items.find((i) => 'index' in i && i.index?.error);
      const errMsg = first && 'index' in first ? first.index?.error?.reason : 'bulk errors';
      this.logger.error(`Elasticsearch bulk: ${errMsg}`);
      throw new ServiceUnavailableException(`Elasticsearch bulk failed: ${errMsg}`);
    }
    return entities.length;
  }

  async searchEntities(
    q: string,
    limit: number,
  ): Promise<Array<{ entityId: string; score: number; canonicalName: string; type: string }>> {
    if (!this.client) {
      throw new ServiceUnavailableException('Elasticsearch not configured (ELASTICSEARCH_NODE)');
    }
    await this.ensureEntityIndex();

    const size = Math.min(Math.max(limit, 1), 50);
    let res;
    try {
      res = await this.client.search({
        index: ELASTIC_INDEX_ENTITIES,
        query: {
          multi_match: {
            query: q,
            fields: ['canonicalName^2', 'aliases'],
            type: 'best_fields',
            fuzziness: 'AUTO',
          },
        },
        size,
        _source: ['entityId', 'canonicalName', 'type'],
      });
    } catch (e) {
      this.logger.warn(`searchEntities: ${e instanceof Error ? e.message : String(e)}`);
      throw new ServiceUnavailableException(
        `Elasticsearch query failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const out: Array<{ entityId: string; score: number; canonicalName: string; type: string }> =
      [];
    for (const hit of res.hits.hits) {
      const src = hit._source as
        | { entityId?: string; canonicalName?: string; type?: string }
        | undefined;
      out.push({
        entityId: src?.entityId ?? String(hit._id ?? ''),
        score: hit._score ?? 0,
        canonicalName: src?.canonicalName ?? '',
        type: src?.type ?? '',
      });
    }
    return out;
  }
}
