import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
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
}

function parseSnapshotId(raw: string): bigint {
  try {
    return BigInt(raw);
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
      }),
    );
  }

  @Get('v1/snapshots/:snapshotId/analyses')
  async listAnalyses(@Param('snapshotId') snapshotId: string) {
    const sid = parseSnapshotId(snapshotId);
    return toPlainJson(await this.snapshotAnalyze.listAnalyses(sid));
  }
}
