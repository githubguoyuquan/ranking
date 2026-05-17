import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
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
  topicId?: string;
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
      }),
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
