import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { toPlainJson } from '../lib/json';
import { IngestionService } from './ingestion.service';

export class UpsertCheckpointDto {
  @IsOptional()
  @IsString()
  lastCursor?: string | null;

  @IsOptional()
  @IsString()
  lastUrl?: string | null;

  @IsOptional()
  @IsString()
  lastTopic?: string | null;

  @IsOptional()
  @IsString()
  lastProcessed?: string;
}

export class CreateSourceDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  baseUrl!: string;

  @IsString()
  @MinLength(1)
  kind!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  trustTier?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  httpProxyUrl?: string | null;

  @IsOptional()
  @IsString()
  topicId?: string;

  @IsOptional()
  @IsBoolean()
  scheduleEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(10080)
  scheduleIntervalMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  scheduleCron?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  region?: string;

  @IsOptional()
  @IsInt()
  @Min(-100)
  @Max(100)
  schedulePriority?: number;
}

export class PatchSourceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  kind?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  trustTier?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  httpProxyUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  scheduleEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(10080)
  scheduleIntervalMinutes?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  scheduleCron?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  region?: string | null;

  @IsOptional()
  @IsInt()
  @Min(-100)
  @Max(100)
  schedulePriority?: number;
}

export class CreateCrawlTaskDto {
  @IsString()
  sourceId!: string;

  @IsOptional()
  @IsBoolean()
  async?: boolean;

  @IsOptional()
  @IsString()
  crawlerName?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  seedUrls?: string[];
}

export class RegisterUrlDto {
  @IsString()
  sourceId!: string;

  @IsString()
  @MinLength(4)
  url!: string;

  @IsOptional()
  @IsString()
  contentHash?: string;
}

@Controller('v1/crawl')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @Get('checkpoints/:crawlerName')
  async getCheckpoint(@Param('crawlerName') crawlerName: string) {
    const row = await this.ingestion.getCheckpoint(crawlerName);
    if (!row) throw new NotFoundException();
    return toPlainJson(row);
  }

  @Put('checkpoints/:crawlerName')
  async putCheckpoint(
    @Param('crawlerName') crawlerName: string,
    @Body() body: UpsertCheckpointDto,
  ) {
    const lastProcessed = body.lastProcessed
      ? new Date(body.lastProcessed)
      : undefined;
    return toPlainJson(
      await this.ingestion.upsertCheckpoint(crawlerName, {
        lastCursor: body.lastCursor,
        lastUrl: body.lastUrl,
        lastTopic: body.lastTopic,
        lastProcessed: lastProcessed ?? null,
      }),
    );
  }

  @Post('sources')
  async createSource(@Body() body: CreateSourceDto) {
    return toPlainJson(
      await this.ingestion.createSource({
        name: body.name,
        baseUrl: body.baseUrl,
        kind: body.kind,
        trustTier: body.trustTier,
        topicId: body.topicId ? BigInt(body.topicId) : undefined,
        httpProxyUrl: body.httpProxyUrl?.trim() || null,
        scheduleEnabled: body.scheduleEnabled,
        scheduleIntervalMinutes: body.scheduleIntervalMinutes,
        scheduleCron: body.scheduleCron,
        region: body.region,
        schedulePriority: body.schedulePriority,
      }),
    );
  }

  @Patch('sources/:sourceId')
  async patchSource(@Param('sourceId') sourceId: string, @Body() body: PatchSourceDto) {
    return toPlainJson(
      await this.ingestion.patchSource(BigInt(sourceId), {
        name: body.name,
        baseUrl: body.baseUrl,
        kind: body.kind,
        trustTier: body.trustTier,
        httpProxyUrl: body.httpProxyUrl,
        scheduleEnabled: body.scheduleEnabled,
        scheduleIntervalMinutes: body.scheduleIntervalMinutes,
        scheduleCron: body.scheduleCron,
        region: body.region,
        schedulePriority: body.schedulePriority,
      }),
    );
  }

  @Get('sources')
  async listSources(@Query('limit') limitRaw?: string) {
    const limit = limitRaw !== undefined ? Number(limitRaw) : 50;
    const lim = Number.isFinite(limit) ? limit : 50;
    return toPlainJson(await this.ingestion.listSources(lim));
  }

  @Get('sources/:sourceId/urls')
  async listCrawledUrls(
    @Param('sourceId') sourceId: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = limitRaw !== undefined ? Number(limitRaw) : 50;
    const lim = Number.isFinite(limit) ? limit : 50;
    return toPlainJson(
      await this.ingestion.listCrawledUrlsForSource(BigInt(sourceId), lim),
    );
  }

  @Post('tasks')
  async createTask(@Body() body: CreateCrawlTaskDto) {
    const task = await this.ingestion.createCrawlTask({
      sourceId: BigInt(body.sourceId),
      async: body.async === true,
      crawlerName: body.crawlerName,
      cursor: body.cursor,
      seedUrls: body.seedUrls,
    });
    return toPlainJson(task);
  }

  @Get('tasks')
  async listTasks(
    @Query('limit') limitRaw?: string,
    @Query('sourceId') sourceIdRaw?: string,
  ) {
    const limit = limitRaw !== undefined ? Number(limitRaw) : 30;
    const lim = Number.isFinite(limit) ? limit : 30;
    let sourceId: bigint | undefined;
    if (sourceIdRaw !== undefined && sourceIdRaw.trim() !== '') {
      try {
        sourceId = BigInt(sourceIdRaw.trim());
      } catch {
        throw new BadRequestException('invalid sourceId');
      }
    }
    return toPlainJson(await this.ingestion.listCrawlTasks(lim, sourceId));
  }

  @Get('tasks/:id')
  async getTask(@Param('id') id: string) {
    return toPlainJson(await this.ingestion.getCrawlTask(BigInt(id)));
  }

  @Post('urls')
  async registerUrl(@Body() body: RegisterUrlDto) {
    const out = await this.ingestion.registerCrawledUrl(
      BigInt(body.sourceId),
      body.url,
      body.contentHash,
    );
    return toPlainJson({ ...out, row: out.row });
  }
}
