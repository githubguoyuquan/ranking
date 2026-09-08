import { TopicOverviewQuery } from './queries/topic-overview.query';
import { SnapshotContextQuery } from './queries/snapshot-context.query';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { getAuthFromRequest } from '../compliance/request-auth';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
} from 'class-validator';
import { TimeWindow, TopicKind } from '@prisma/client';
import { RequireScopes } from '../compliance/api-key.guard';
import { toPlainJson } from '../lib/json';
import { resolveRealtimeRankingWindow } from '../domain/realtime-ranking-window';
import { RankingsService } from './rankings.service';
import { TrendAnomalyService } from './trend-anomaly.service';
import { TopicEntityAutofillService } from './topic-entity-autofill.service';

export class RunRankingDto {
  @IsString()
  topicVersionId!: string;

  @IsEnum(TimeWindow)
  timeWindow!: TimeWindow;

  @IsDateString()
  windowStart!: string;

  @IsDateString()
  windowEnd!: string;

  /** 快照截止时间（缺省用 windowEnd）。同一窗口多次生成快照时用于演化对比 */
  @IsOptional()
  @IsDateString()
  asOf?: string;

  /** true：入队异步执行（需 Redis / BullMQ Worker） */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  async?: boolean;
}

export class SeedDemoDto {
  @IsOptional()
  @IsString()
  slug?: string;
}

export class CompareSnapshotsDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  snapshotIds!: string[];

  /** 为每个快照列合并 `aiAnalysisCount` / `hasFollowupBrief` / `hasTrendBrief` / `hasCredibilityBrief` */
  @IsOptional()
  @Transform(({ obj, key }) => {
    const value: unknown = obj[key];
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  includeAiStats?: boolean;
}

export class SnapshotQueryDto {
  @IsOptional()
  @Transform(({ obj, key }) => {
    const value: unknown = obj[key];
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  includeNeighbors?: boolean;

  /** 合并 `AiAnalysis` 条数与 `hasFollowupBrief` / `hasTrendBrief` / `hasCredibilityBrief`（复用快照缓存，独立读取当前 AI 统计） */
  @IsOptional()
  @Transform(({ obj, key }) => {
    const value: unknown = obj[key];
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  includeAiStats?: boolean;
}

export class LeaderboardQueryDto {
  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsEnum(TimeWindow)
  timeWindow?: TimeWindow;

  @IsOptional()
  @IsDateString()
  windowStart?: string;

  /** 嵌套 `snapshot` 合并 `aiAnalysisCount` / `has*Brief`（与 `GET /v1/snapshots/:id?includeAiStats=1` 行为一致） */
  @IsOptional()
  @Transform(({ obj, key }) => {
    const value: unknown = obj[key];
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  includeAiStats?: boolean;
}

export class EntityRankHistoryQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  topicSlug!: string;

  @IsOptional()
  @IsEnum(TimeWindow)
  timeWindow?: TimeWindow;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class TopicTrendAnalysesQueryDto {
  @IsOptional()
  @IsEnum(TimeWindow)
  timeWindow?: TimeWindow;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class TopicSnapshotsQueryDto {
  @IsOptional()
  @IsEnum(TimeWindow)
  timeWindow?: TimeWindow;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PatchTopicVersionPolicyBodyDto {
  @IsObject()
  policyJson!: Record<string, unknown>;
}

export class PatchTopicBodyDto {
  @IsOptional()
  @IsEnum(TopicKind)
  kind?: TopicKind;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;
}

export class CreateTopicAdminDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must use lowercase letters, numbers, and single hyphens',
  })
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsEnum(TopicKind)
  kind!: TopicKind;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(35)
  locale?: string;

  @IsOptional()
  @Transform(({ obj, key }) => obj[key])
  @IsInt()
  @Min(1)
  @Max(50)
  entityCount?: number;
}

export class CreateTopicVersionAdminDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  version!: string;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsObject()
  policyJson!: Record<string, unknown>;
}

export class TrendsHotQueryDto {
  @IsOptional()
  @IsEnum(TimeWindow)
  timeWindow?: TimeWindow;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class TrendsAnomaliesQueryDto {
  @IsOptional()
  @IsEnum(TimeWindow)
  timeWindow?: TimeWindow;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  hours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class HotBoardsQueryDto {
  @IsOptional()
  @IsEnum(TimeWindow)
  timeWindow?: TimeWindow;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  topicsLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  previewLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500)
  offset?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  topicQuery?: string;

  @IsOptional()
  @IsEnum(TopicKind)
  topicKind?: TopicKind;
}

export class RankingFollowupDispatchDto {
  @IsString()
  snapshotId!: string;

  @IsString()
  topicRankingId!: string;

  @IsString()
  topicVersionId!: string;

  @IsString()
  topicId!: string;

  @IsEnum(TimeWindow)
  timeWindow!: TimeWindow;
}

export class TopicOverviewQueryDto extends LeaderboardQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  recentLimit?: number;
}

@Controller()
export class RankingsController {
  constructor(
    private readonly rankings: RankingsService,
    private readonly topicOverview: TopicOverviewQuery,
    private readonly snapshotContext: SnapshotContextQuery,
    private readonly trendAnomaly: TrendAnomalyService,
    private readonly entityAutofill: TopicEntityAutofillService,
  ) {}

  @Post('admin/seed-demo')
  async seedDemo(@Body() body: SeedDemoDto) {
    return this.rankings.seedDemo(body.slug);
  }

  /** 运营台手工创建话题；正式写操作要求 admin scope。 */
  @Post('admin/topics')
  @RequireScopes('admin')
  async createTopic(
    @Body() body: CreateTopicAdminDto,
    @Req() req: Request,
  ) {
    return this.rankings.createTopic(
      {
        slug: body.slug,
        title: body.title,
        kind: body.kind,
        locale: body.locale,
        entityCount: body.entityCount,
      },
      getAuthFromRequest(req),
    );
  }

  /** 运营台为已有话题创建不可重名的新版本。 */
  @Post('admin/topics/:slug/versions')
  @RequireScopes('admin')
  async createTopicVersion(
    @Param('slug') slug: string,
    @Body() body: CreateTopicVersionAdminDto,
    @Req() req: Request,
  ) {
    return this.rankings.createTopicVersion(
      slug,
      {
        version: body.version,
        effectiveFrom: new Date(body.effectiveFrom),
        effectiveTo: body.effectiveTo
          ? new Date(body.effectiveTo)
          : undefined,
        policyJson: body.policyJson,
      },
      getAuthFromRequest(req),
    );
  }

  @Get('v1/topics/:slug/entities')
  async topicEntities(@Param('slug') slug: string, @Req() req: Request) {
    return this.entityAutofill.get(slug, getAuthFromRequest(req));
  }

  @Post('admin/topics/:slug/entities/retry')
  @RequireScopes('admin')
  async retryTopicEntities(@Param('slug') slug: string, @Req() req: Request) {
    return this.entityAutofill.retry(slug, getAuthFromRequest(req));
  }

  /** 浏览器会发 GET；真正跑榜必须用 POST + JSON body */
  @Get('v1/rankings/run')
  runRankingHint() {
    return {
      error: 'Use POST, not GET',
      method: 'POST',
      path: '/v1/rankings/run',
      contentType: 'application/json',
      body: {
        topicVersionId: '1',
        timeWindow: 'WEEK',
        windowStart: '2026-05-10T00:00:00.000Z',
        windowEnd: '2026-05-17T00:00:00.000Z',
        asOf: '2026-05-17T12:00:00.000Z',
        async: false,
      },
    };
  }

  @Post('v1/rankings/run')
  async run(@Body() body: RunRankingDto) {
    const args = {
      topicVersionId: BigInt(body.topicVersionId),
      timeWindow: body.timeWindow,
      windowStart: new Date(body.windowStart),
      windowEnd: new Date(body.windowEnd),
      asOf: body.asOf ? new Date(body.asOf) : undefined,
    };
    try {
      if (body.async) {
        return toPlainJson(await this.rankings.enqueueRanking(args));
      }
      return await this.rankings.runRanking(args);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw e;
    }
  }

  @Get('v1/rankings/:topicRankingId/status')
  async rankingStatus(@Param('topicRankingId') topicRankingId: string) {
    let trId: bigint;
    try {
      trId = BigInt(topicRankingId.trim());
    } catch {
      throw new BadRequestException('invalid topicRankingId');
    }
    const row = await this.rankings.getTopicRankingStatus(trId);
    if (!row) throw new NotFoundException();
    const plain = toPlainJson(row) as Record<string, unknown>;
    const snaps = plain.snapshots;
    if (Array.isArray(snaps)) {
      for (const s of snaps) {
        if (typeof s === 'object' && s !== null && !Array.isArray(s)) {
          const o = s as Record<string, unknown>;
          const mid = o.scoreModelId;
          o.hasScoreModel =
            mid != null && mid !== '' && String(mid) !== 'null';
        }
      }
    }
    return plain;
  }

  @Get('v1/jobs/ranking/:jobId')
  async rankingJob(@Param('jobId') jobId: string) {
    const state = await this.rankings.getRankingJobState(jobId);
    if (!state) throw new NotFoundException();
    return toPlainJson(state);
  }

  @Get('v1/snapshots/:id')
  async snapshot(
    @Param('id') id: string,
    @Query() query: SnapshotQueryDto,
    @Req() req: Request,
  ) {
    let sid: bigint;
    try {
      sid = BigInt(id.trim());
    } catch {
      throw new BadRequestException('invalid snapshot id');
    }
    const snap = await this.rankings.getSnapshotForApiWithAuth(sid, {
      includeAiStats: query.includeAiStats === true,
      auth: getAuthFromRequest(req),
    });
    if (!snap) throw new NotFoundException();
    if (query.includeNeighbors) {
      const navigation = await this.snapshotContext.neighbors(sid, getAuthFromRequest(req));
      return { ...(snap as Record<string, unknown>), navigation };
    }
    return snap;
  }

  /** `ScoreBreakdown` 关系表扁平导出（条目名次 + 实体 + 分量/权重）；无行时 `rowCount` 为 0 */
  @Get('v1/snapshots/:id/score-breakdowns')
  async snapshotScoreBreakdowns(@Param('id') id: string) {
    let sid: bigint;
    try {
      sid = BigInt(id.trim());
    } catch {
      throw new BadRequestException('invalid snapshot id');
    }
    const payload = await this.rankings.getSnapshotRelationalScoreBreakdowns(sid);
    if (!payload) throw new NotFoundException();
    return payload;
  }

  /** 同一 `TopicRanking` 下至少 2 张、至多 10 张快照的 rank 并列对比 */
  @Post('v1/snapshots/compare')
  async compareSnapshots(@Body() body: CompareSnapshotsDto) {
    let ids: bigint[];
    try {
      ids = body.snapshotIds.map((s) => BigInt(s.trim()));
    } catch {
      throw new BadRequestException('invalid snapshot id');
    }
    try {
      return toPlainJson(
        await this.rankings.compareSnapshots(ids, body.includeAiStats === true),
      );
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw e;
    }
  }

  @Get('v1/rankings/realtime-window')
  realtimeWindow() {
    return toPlainJson(resolveRealtimeRankingWindow());
  }

  @Get('v1/topics/:slug/overview')
  async overview(@Param('slug') slug: string, @Query() query: TopicOverviewQueryDto, @Req() req: Request) {
    return this.topicOverview.get(slug, query, getAuthFromRequest(req));
  }

  @Get('v1/topics/:slug/leaderboard')
  async leaderboard(
    @Param('slug') slug: string,
    @Query() query: LeaderboardQueryDto,
    @Req() req: Request,
  ) {
    const row = await this.rankings.getLeaderboardForApi(slug, query, getAuthFromRequest(req));
    if (!row) throw new NotFoundException();
    return row;
  }

  @Get('v1/topics/:slug')
  async topic(@Param('slug') slug: string, @Req() req: Request) {
    return await this.rankings.getTopicBySlug(slug, getAuthFromRequest(req));
  }

  @Patch('v1/topics/:slug')
  async patchTopic(
    @Param('slug') slug: string,
    @Body() body: PatchTopicBodyDto,
    @Req() req: Request,
  ) {
    if (body.kind === undefined && body.title === undefined) {
      throw new BadRequestException('provide kind and/or title');
    }
    return await this.rankings.updateTopicBySlug(
      slug,
      { kind: body.kind, title: body.title },
      getAuthFromRequest(req),
    );
  }

  @Get('v1/topics/:slug/versions')
  async versions(@Param('slug') slug: string, @Req() req: Request) {
    return toPlainJson(await this.rankings.listVersionsBySlug(slug, getAuthFromRequest(req)));
  }

  /** 更新 TopicVersion.policyJson（须非 frozen；服务端强校验 weights / entityIds） */
  @Patch('v1/topic-versions/:id/policy')
  async patchTopicVersionPolicy(
    @Param('id') id: string,
    @Body() body: PatchTopicVersionPolicyBodyDto,
  ) {
    let tvId: bigint;
    try {
      tvId = BigInt(id.trim());
    } catch {
      throw new BadRequestException('invalid topic version id');
    }
    try {
      return await this.rankings.updateTopicVersionPolicy(tvId, body.policyJson);
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof BadRequestException) throw e;
      throw e;
    }
  }

  /** 近期快照级 TrendAnalysis 涨榜聚合。OpenAPI：`docs/openapi/trends.yaml` */
  @Get('v1/trends/hot')
  async trendsHot(@Query() query: TrendsHotQueryDto) {
    return await this.rankings.listHotTrends(query.timeWindow, query.limit);
  }

  /** C 端只读热榜索引：各话题最新榜 TOP 预览。OpenAPI：`docs/openapi/v1-hot-boards.yaml` */
  @Get('v1/hot-boards')
  async hotBoards(@Query() query: HotBoardsQueryDto, @Req() req: Request) {
    return this.rankings.listHotBoards(
      {
        timeWindow: query.timeWindow,
        topicsLimit: query.topicsLimit,
        previewLimit: query.previewLimit,
        offset: query.offset,
        topicQuery: query.topicQuery,
        topicKind: query.topicKind,
      },
      getAuthFromRequest(req),
    );
  }

  /** 扫描近期快照趋势异常。OpenAPI：`docs/openapi/trends.yaml` */
  @Get('v1/trends/anomalies')
  async trendsAnomalies(@Query() query: TrendsAnomaliesQueryDto) {
    return this.trendAnomaly.listAnomaliesForApi({
      hours: query.hours,
      timeWindow: query.timeWindow,
      limit: query.limit,
    });
  }

  /** 趋势异常告警摘要。OpenAPI：`docs/openapi/trends.yaml` */
  @Get('admin/trends/alerts')
  @RequireScopes('admin')
  async trendsAlerts(@Query() query: TrendsAnomaliesQueryDto) {
    const scan = await this.trendAnomaly.scanRecentAnomalies({
      hours: query.hours ?? 48,
      timeWindow: query.timeWindow,
    });
    return toPlainJson({
      ...scan,
      filter: {
        hours: query.hours ?? 48,
        timeWindow: query.timeWindow ?? null,
      },
    });
  }

  /**
   * 由 `consumers/followup-dispatch` Kafka consumer 或运维调用，执行与 BullMQ `ranking-followup` 相同流水线。
   */
  @Post('admin/ranking-followup/dispatch')
  @RequireScopes('admin')
  async dispatchRankingFollowup(@Body() body: RankingFollowupDispatchDto) {
    return toPlainJson(
      await this.rankings.handleRankingFollowupJob({
        schemaVersion: 1,
        snapshotId: body.snapshotId.trim(),
        topicRankingId: body.topicRankingId.trim(),
        topicVersionId: body.topicVersionId.trim(),
        topicId: body.topicId.trim(),
        timeWindow: body.timeWindow,
      }),
    );
  }

  /** 近期 `TrendAnalysis`（默认仅快照级摘要 `entityId` 为空） */
  @Get('v1/topics/:slug/trend-analyses')
  async topicTrendAnalyses(
    @Param('slug') slug: string,
    @Query() query: TopicTrendAnalysesQueryDto,
    @Req() req: Request,
  ) {
    try {
      return await this.rankings.listTrendAnalysesForTopicSlug(
        slug,
        query.timeWindow,
        query.limit,
        getAuthFromRequest(req),
      );
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw e;
    }
  }

  /** 话题下近期 `TopicRankSnapshot`（跨 version / ranking） */
  @Get('v1/topics/:slug/snapshots')
  async topicSnapshots(
    @Param('slug') slug: string,
    @Query() query: TopicSnapshotsQueryDto,
    @Req() req: Request,
  ) {
    try {
      return await this.rankings.listSnapshotsForTopicSlug(
        slug,
        query.timeWindow,
        query.limit,
        getAuthFromRequest(req),
      );
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw e;
    }
  }

  /**
   * 实体在话题下的排行时间演化（来自 `RankingItemHistory`）。
   * 查询参数：`topicSlug`（必填）、`timeWindow`（可选）、`limit`（默认 100，最大 500；取最近若干快照点）。
   */
  @Get('v1/entities/:id/rank-history')
  async entityRankHistory(
    @Param('id') id: string,
    @Query() query: EntityRankHistoryQueryDto,
    @Req() req: Request,
  ) {
    let entityId: bigint;
    try {
      entityId = BigInt(id.trim());
    } catch {
      throw new BadRequestException('invalid entity id');
    }
    try {
      return await this.rankings.getEntityRankHistory(
        entityId,
        query.topicSlug,
        query.timeWindow,
        query.limit,
        getAuthFromRequest(req),
      );
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw e;
    }
  }
}
