import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type SitePreferencesPayload = {
  recentTopics?: string[];
  watchlist?: string[];
  tier?: string;
};

@Injectable()
export class SiteService {
  private readonly logger = new Logger(SiteService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getProfile(deviceId: string) {
    const id = deviceId.trim();
    if (!id || id.length > 64) {
      return { deviceId: null, tier: 'free', recentTopics: [], watchlist: [] };
    }
    const row = await this.prisma.siteDeviceProfile.findUnique({ where: { deviceId: id } });
    if (!row) {
      return { deviceId: id, tier: 'free', recentTopics: [], watchlist: [] };
    }
    return {
      deviceId: row.deviceId,
      tier: row.tier,
      recentTopics: normalizeStringArray(row.recentTopics),
      watchlist: normalizeStringArray(row.watchlist),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async upsertProfile(deviceId: string, body: SitePreferencesPayload) {
    const id = deviceId.trim();
    if (!id || id.length > 64) {
      throw new Error('invalid device id');
    }
    const recentTopics = body.recentTopics?.slice(0, 20) ?? undefined;
    const watchlist = body.watchlist?.slice(0, 50) ?? undefined;
    const row = await this.prisma.siteDeviceProfile.upsert({
      where: { deviceId: id },
      create: {
        deviceId: id,
        tier: body.tier?.trim() || 'free',
        recentTopics: recentTopics ?? [],
        watchlist: watchlist ?? [],
      },
      update: {
        ...(body.tier?.trim() ? { tier: body.tier.trim() } : {}),
        ...(recentTopics ? { recentTopics } : {}),
        ...(watchlist ? { watchlist } : {}),
      },
    });
    this.logger.debug(`site profile upsert ${id}`);
    return {
      deviceId: row.deviceId,
      tier: row.tier,
      recentTopics: normalizeStringArray(row.recentTopics),
      watchlist: normalizeStringArray(row.watchlist),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** 基于 watchlist + recentTopics 推荐话题 slug（只读，无需登录） */
  async personalizedTopicSlugs(deviceId: string, limit = 6): Promise<string[]> {
    const profile = await this.getProfile(deviceId);
    const merged = [...profile.watchlist, ...profile.recentTopics];
    const unique = [...new Set(merged.map((s) => s.trim()).filter(Boolean))];
    return unique.slice(0, limit);
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}
