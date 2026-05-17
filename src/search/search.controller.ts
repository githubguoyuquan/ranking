import { Controller, Get, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { toPlainJson } from '../lib/json';
import { ElasticService } from './elastic.service';

class SearchEntitiesQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

@Controller()
export class SearchController {
  constructor(private readonly elastic: ElasticService) {}

  @Get('v1/search/health')
  async searchHealth() {
    return toPlainJson(await this.elastic.ping());
  }

  @Get('v1/search/entities')
  async searchEntities(@Query() query: SearchEntitiesQueryDto) {
    const hits = await this.elastic.searchEntities(query.q, query.limit ?? 20);
    return toPlainJson({ query: query.q, count: hits.length, hits });
  }

  /** 从数据库全量灌实体索引（需 ES 已启动且配置 NODE） */
  @Post('admin/reindex-entities')
  async reindexEntities() {
    const indexed = await this.elastic.reindexAllEntitiesFromDb();
    return toPlainJson({ ok: true, indexed });
  }
}
