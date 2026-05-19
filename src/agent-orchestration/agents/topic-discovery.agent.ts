import { Injectable } from '@nestjs/common';
import type { TopicKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { slugifyTopicTitle } from '../agent-slug';

type Cluster = {
  key: string;
  title: string;
  urls: Array<{ id: string; url: string; pageTitle: string | null }>;
};

@Injectable()
export class TopicDiscoveryAgent {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: {
    sourceId?: string;
    limit?: number;
    minClusterSize?: number;
  }): Promise<{
    proposalsCreated: number;
    proposalsSkipped: number;
    clusters: number;
    proposalIds: string[];
  }> {
    const limit = Math.min(Math.max(input.limit ?? 500, 10), 5000);
    const minSize = Math.min(Math.max(input.minClusterSize ?? 2, 2), 20);
    const sourceId = input.sourceId?.trim()
      ? BigInt(input.sourceId.trim())
      : undefined;

    const rows = await this.prisma.crawledUrl.findMany({
      where: {
        status: { in: ['fetched', 'fetched_stub'] },
        duplicateOfId: null,
        ...(sourceId != null ? { sourceId } : {}),
        OR: [
          { pageTitle: { not: null } },
          { textPreview: { not: null } },
        ],
      },
      orderBy: { id: 'desc' },
      take: limit,
      select: {
        id: true,
        url: true,
        pageTitle: true,
        textPreview: true,
      },
    });

    const clusters = new Map<string, Cluster>();
    for (const row of rows) {
      const title =
        row.pageTitle?.trim() ||
        row.textPreview?.trim().slice(0, 80) ||
        row.url;
      const key = this.clusterKey(title);
      const existing = clusters.get(key);
      const hit = {
        id: row.id.toString(),
        url: row.url,
        pageTitle: row.pageTitle,
      };
      if (existing) {
        existing.urls.push(hit);
      } else {
        clusters.set(key, { key, title, urls: [hit] });
      }
    }

    let proposalsCreated = 0;
    let proposalsSkipped = 0;
    const proposalIds: string[] = [];

    for (const c of clusters.values()) {
      if (c.urls.length < minSize) continue;
      const suggestedTitle = c.title.slice(0, 200);
      let suggestedSlug = slugifyTopicTitle(suggestedTitle);
      const exists = await this.prisma.topic.findUnique({
        where: { slug: suggestedSlug },
        select: { id: true },
      });
      if (exists) {
        suggestedSlug = `${suggestedSlug}-${c.key.slice(0, 8)}`.slice(0, 120);
      }
      const dup = await this.prisma.topicProposal.findUnique({
        where: { clusterKey: c.key },
      });
      if (dup) {
        proposalsSkipped += 1;
        continue;
      }
      const confidence = Math.min(0.95, 0.45 + c.urls.length * 0.08);
      const row = await this.prisma.topicProposal.create({
        data: {
          status: 'pending',
          suggestedSlug,
          suggestedTitle,
          kind: 'SEMI_OBJECTIVE' as TopicKind,
          confidence,
          clusterKey: c.key,
          sourceId,
          evidenceJson: {
            schemaVersion: 1,
            clusterSize: c.urls.length,
            sampleUrls: c.urls.slice(0, 8),
          },
        },
      });
      proposalsCreated += 1;
      proposalIds.push(row.id.toString());
    }

    return {
      proposalsCreated,
      proposalsSkipped,
      clusters: [...clusters.values()].filter((c) => c.urls.length >= minSize)
        .length,
      proposalIds,
    };
  }

  private clusterKey(title: string): string {
    const words = title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4);
    return words.join('-').slice(0, 128) || 'misc';
  }
}
