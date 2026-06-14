import { Injectable, Logger } from '@nestjs/common';
import { ElasticService } from '../search/elastic.service';
import { ELASTIC_INDEX_CRAWLED_URLS, ELASTIC_INDEX_ENTITIES } from '../search/elastic.constants';

@Injectable()
export class ElasticCcrService {
  private readonly logger = new Logger(ElasticCcrService.name);

  constructor(private readonly elastic: ElasticService) {}

  remoteCluster(): string | null {
    return process.env.ELASTICSEARCH_CCR_REMOTE_CLUSTER?.trim() || null;
  }

  leaderIndexPattern(base: string): string {
    const override = process.env.ELASTICSEARCH_CCR_LEADER_PATTERN?.trim();
    if (override) return override;
    return `${base}*`;
  }

  /** 跨集群复制 / auto-follow 状态（需远端集群已注册） */
  async getCcrStatus(): Promise<Record<string, unknown>> {
    const client = this.elastic.getNativeClient();
    if (!client) return { ok: false, reason: 'ELASTICSEARCH_NODE not set' };

    const remote = this.remoteCluster();
    const indices: Record<string, unknown> = {};
    const out: Record<string, unknown> = {
      ok: true,
      remoteCluster: remote,
      configured: Boolean(remote),
      generatedAt: new Date().toISOString(),
      indices,
    };

    if (!remote) {
      return {
        ...out,
        hint: 'Set ELASTICSEARCH_CCR_REMOTE_CLUSTER to leader cluster name for DR follower',
      };
    }

    for (const base of [ELASTIC_INDEX_ENTITIES, ELASTIC_INDEX_CRAWLED_URLS]) {
      try {
        const stats = await client.transport.request({
          method: 'GET',
          path: `/_ccr/stats`,
        });
        indices[base] = { stats };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        indices[base] = { error: msg };
      }
    }

    try {
      const followers = await client.transport.request({
        method: 'GET',
        path: `/${remote}:${this.leaderIndexPattern(ELASTIC_INDEX_ENTITIES)}/_ccr/info`,
      });
      out.followerInfo = followers;
    } catch (e) {
      out.followerInfo = {
        error: e instanceof Error ? e.message : String(e),
      };
    }

    return out;
  }

  /**
   * 注册 auto-follow 模式（运维一次性；需 ES 白金版 CCR 与远端集群连通）。
   * `ELASTICSEARCH_CCR_AUTO_FOLLOW=true` 时才执行 PUT。
   */
  async bootstrapAutoFollow(): Promise<Record<string, unknown>> {
    const client = this.elastic.getNativeClient();
    if (!client) return { ok: false, reason: 'ELASTICSEARCH_NODE not set' };

    const remote = this.remoteCluster();
    if (!remote) {
      return {
        ok: false,
        reason: 'ELASTICSEARCH_CCR_REMOTE_CLUSTER not set',
      };
    }

    if (process.env.ELASTICSEARCH_CCR_AUTO_FOLLOW !== 'true') {
      return {
        ok: false,
        reason: 'Set ELASTICSEARCH_CCR_AUTO_FOLLOW=true to apply auto-follow patterns',
        remoteCluster: remote,
        dryRun: true,
        patterns: [
          `${ELASTIC_INDEX_ENTITIES}*`,
          `${ELASTIC_INDEX_CRAWLED_URLS}*`,
        ],
      };
    }

    const patterns = [
      `${ELASTIC_INDEX_ENTITIES}*`,
      `${ELASTIC_INDEX_CRAWLED_URLS}*`,
    ];
    const applied: string[] = [];

    for (const pattern of patterns) {
      await client.transport.request({
        method: 'PUT',
        path: `/_ccr/auto_follow/${pattern.replace(/\*/g, '_star_')}`,
        body: {
          remote_cluster: remote,
          leader_index_patterns: [pattern],
          follow_index_pattern: '{{leader_index}}-follower',
        },
      });
      applied.push(pattern);
      this.logger.log(`CCR auto-follow registered: ${remote} → ${pattern}`);
    }

    return { ok: true, remoteCluster: remote, applied };
  }
}
