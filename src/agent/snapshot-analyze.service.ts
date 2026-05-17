import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SnapshotAnalyzeService {
  constructor(private readonly prisma: PrismaService) {}

  async listAnalyses(snapshotId: bigint) {
    return this.prisma.aiAnalysis.findMany({
      where: { snapshotId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async analyzeSnapshot(snapshotId: bigint, opts: { agent?: string; topN?: number }) {
    const topN = Math.min(Math.max(opts.topN ?? 8, 1), 50);
    const snap = await this.prisma.topicRankSnapshot.findUnique({
      where: { id: snapshotId },
      include: {
        items: {
          orderBy: { rank: 'asc' },
          take: topN,
          include: { entity: true },
        },
      },
    });
    if (!snap) throw new NotFoundException('TopicRankSnapshot not found');

    const lines = snap.items.map(
      (it) =>
        `#${it.rank} ${it.entity.canonicalName} (${it.trendType}, popularity ${it.popularityScore.toFixed(2)})`,
    );
    const names = snap.items.map((i) => i.entity.canonicalName);
    let summary = `本榜前 ${snap.items.length} 名：${names.join('、')}。`;
    summary = await this.maybeOpenAiSummary(lines.join('\n'), summary);

    return this.prisma.aiAnalysis.create({
      data: {
        snapshotId,
        agent: opts.agent?.trim() || 'rules-v1',
        summary,
        detailJson: {
          schemaVersion: 1,
          topN,
          lines,
          snapshotVersion: snap.snapshotVersion,
        },
        confidence: process.env.OPENAI_API_KEY?.trim() ? 0.85 : 0.55,
      },
    });
  }

  private async maybeOpenAiSummary(context: string, fallback: string): Promise<string> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) return fallback;

    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                '你是排行榜运营助手。请用 2～4 句中文概括下列排名信息，语气客观，不要编造未出现的名字。',
            },
            { role: 'user', content: context },
          ],
          max_tokens: 300,
          temperature: 0.4,
        }),
      });
      if (!res.ok) return fallback;
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      return text && text.length > 0 ? text : fallback;
    } catch {
      return fallback;
    }
  }
}
