import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DuplicateDetectionAgent {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: {
    sourceId?: string;
    limit?: number;
  }): Promise<{
    urlHashGroups: number;
    semanticDupCount: number;
    samples: Array<Record<string, unknown>>;
  }> {
    const limit = Math.min(Math.max(input.limit ?? 200, 20), 2000);
    const sourceId = input.sourceId?.trim()
      ? BigInt(input.sourceId.trim())
      : undefined;

    const semanticDupCount = await this.prisma.crawledUrl.count({
      where: {
        duplicateOfId: { not: null },
        ...(sourceId != null ? { sourceId } : {}),
      },
    });

    const rows = await this.prisma.crawledUrl.findMany({
      where: {
        ...(sourceId != null ? { sourceId } : {}),
        contentHash: { not: null },
      },
      orderBy: { id: 'desc' },
      take: limit,
      select: {
        id: true,
        url: true,
        contentHash: true,
        urlFingerprint: true,
        duplicateOfId: true,
        status: true,
      },
    });

    const byHash = new Map<string, typeof rows>();
    for (const r of rows) {
      const h = r.contentHash ?? '';
      if (!h) continue;
      const arr = byHash.get(h) ?? [];
      arr.push(r);
      byHash.set(h, arr);
    }

    const groups = [...byHash.values()].filter((g) => g.length > 1);
    const samples = groups.slice(0, 10).map((g) => ({
      contentHash: g[0].contentHash,
      count: g.length,
      urls: g.slice(0, 5).map((x) => ({ id: x.id.toString(), url: x.url })),
    }));

    return {
      urlHashGroups: groups.length,
      semanticDupCount,
      samples,
    };
  }
}
