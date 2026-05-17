import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { TimeWindow } from '@prisma/client';
import { toPlainJson } from '../lib/json';
import { RankingsService } from './rankings.service';

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
}

@Controller()
export class RankingsController {
  constructor(private readonly rankings: RankingsService) {}

  @Post('admin/seed-demo')
  async seedDemo(@Body() body: SeedDemoDto) {
    return this.rankings.seedDemo(body.slug);
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
    const row = await this.rankings.getTopicRankingStatus(BigInt(topicRankingId));
    if (!row) throw new NotFoundException();
    return toPlainJson(row);
  }

  @Get('v1/jobs/ranking/:jobId')
  async rankingJob(@Param('jobId') jobId: string) {
    const state = await this.rankings.getRankingJobState(jobId);
    if (!state) throw new NotFoundException();
    return toPlainJson(state);
  }

  @Get('v1/snapshots/:id')
  async snapshot(@Param('id') id: string) {
    const snap = await this.rankings.getSnapshotForApi(BigInt(id));
    if (!snap) throw new NotFoundException();
    return snap;
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
      return toPlainJson(await this.rankings.compareSnapshots(ids));
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw e;
    }
  }

  @Get('v1/topics/:slug/leaderboard')
  async leaderboard(@Param('slug') slug: string, @Query() query: LeaderboardQueryDto) {
    const row = await this.rankings.getLeaderboardForApi(slug, query);
    if (!row) throw new NotFoundException();
    return row;
  }

  @Get('v1/topics/:slug/versions')
  async versions(@Param('slug') slug: string) {
    return toPlainJson(await this.rankings.listVersionsBySlug(slug));
  }
}
