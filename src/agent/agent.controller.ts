import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { toPlainJson } from '../lib/json';
import { SnapshotAnalyzeService } from './snapshot-analyze.service';

class AnalyzeSnapshotDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  agent?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topN?: number;

  /** 注入 user 消息前缀，模拟流水线「前序摘要」（需 OPENAI_API_KEY 才影响 LLM） */
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  chainContext?: string;
}

const LIST_ANALYSES_AGENT_KINDS = [
  'followup',
  'trend',
  'credibility',
  'factcheck',
  'default',
] as const;

class ListAnalysesQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(LIST_ANALYSES_AGENT_KINDS)
  agentKind?: (typeof LIST_ANALYSES_AGENT_KINDS)[number];

  /** 精确匹配 `AiAnalysis.agent`（与 POST body 一致 ≤120） */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  agent?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  offset?: number;
}

function parseSnapshotId(raw: string): bigint {
  try {
    return BigInt(raw.trim());
  } catch {
    throw new BadRequestException('invalid snapshotId');
  }
}

@Controller()
export class AgentController {
  constructor(private readonly snapshotAnalyze: SnapshotAnalyzeService) {}

  /** 基于快照排行生成 `AiAnalysis`（规则摘要；配置 OPENAI_API_KEY 时可选调用 GPT 润色） */
  @Post('admin/snapshots/:snapshotId/analyze')
  async analyzeSnapshot(
    @Param('snapshotId') snapshotId: string,
    @Body() body: AnalyzeSnapshotDto,
  ) {
    const sid = parseSnapshotId(snapshotId);
    return toPlainJson(
      await this.snapshotAnalyze.analyzeSnapshot(sid, {
        agent: body.agent,
        topN: body.topN,
        chainContext: body.chainContext,
      }),
    );
  }

  @Get('v1/snapshots/:snapshotId/analyses')
  async listAnalyses(
    @Param('snapshotId') snapshotId: string,
    @Query() query: ListAnalysesQueryDto,
  ) {
    const sid = parseSnapshotId(snapshotId);
    return toPlainJson(
      await this.snapshotAnalyze.listAnalyses(sid, {
        agentKind: query.agentKind,
        agent: query.agent,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }
}
