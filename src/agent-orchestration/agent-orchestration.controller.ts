import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AI_AGENT_DUPLICATE_DETECTION_V1,
  AI_AGENT_FACT_CHECK_V1,
  AI_AGENT_RANKING_V1,
  AI_AGENT_TIME_SERIES_V1,
  AI_AGENT_TOPIC_DISCOVERY_V1,
  AI_AGENT_TOPIC_MERGE_V1,
  AI_AGENT_TREND_ANALYSIS_V1,
  parseOrchestrationPipeline,
} from '../agent/ai-agent.constants';
import { toPlainJson } from '../lib/json';
import { TopicMergeAgent } from './agents/topic-merge.agent';
import { AgentRunService } from './agent-run.service';
import { AgentOrchestrationService } from './agent-orchestration.service';

class EnqueueAgentDto {
  @IsString()
  @MaxLength(120)
  agent!: string;

  @IsOptional()
  input?: Record<string, unknown>;
}

class EnqueuePipelineDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pipeline?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  agents?: string[];

  @IsOptional()
  input?: Record<string, unknown>;
}

class DiscoveryRunDto {
  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(5000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(20)
  minClusterSize?: number;
}

class MergeRunDto {
  @IsString()
  sourceTopicId!: string;

  @IsString()
  targetTopicId!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  mergedBy?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minSimilarity?: number;
}

class SnapshotAgentRunDto {
  @IsString()
  snapshotId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topN?: number;
}

class FactCheckRunDto extends SnapshotAgentRunDto {}

class ApproveProposalDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  version?: string;
}

function parseBigId(raw: string, field: string): bigint {
  try {
    return BigInt(raw.trim());
  } catch {
    throw new BadRequestException(`invalid ${field}`);
  }
}

@Controller()
export class AgentOrchestrationController {
  constructor(
    private readonly orchestration: AgentOrchestrationService,
    private readonly agentRuns: AgentRunService,
    private readonly topicMerge: TopicMergeAgent,
  ) {}

  @Get('admin/agents/overview')
  overview() {
    const o = this.orchestration.getRegistryOverview();
    return {
      queue: 'ai-agent',
      agents: o.registry.map((r) => r.id),
      registry: o.registry,
      crawlDiscoveryEnabled: o.crawlDiscoveryEnabled,
      agentEnabled: o.agentEnabled,
      defaultPipeline: o.defaultPipeline,
      snapshotPostProcessPipeline: o.snapshotPostProcessPipeline,
    };
  }

  @Get('admin/agents/runs')
  async listRuns(
    @Query('agent') agent?: string,
    @Query('status') status?: string,
    @Query('correlationId') correlationId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return toPlainJson(
      await this.agentRuns.list({
        agent,
        status,
        correlationId,
        limit: limit != null ? Number(limit) : undefined,
        offset: offset != null ? Number(offset) : undefined,
      }),
    );
  }

  @Post('admin/agents/enqueue')
  async enqueue(@Body() body: EnqueueAgentDto) {
    return toPlainJson(
      await this.orchestration.enqueueAgent(
        body.agent,
        body.input ?? {},
      ),
    );
  }

  @Post('admin/agents/pipeline')
  async enqueuePipeline(@Body() body: EnqueuePipelineDto) {
    let agents = body.agents ?? [];
    if (body.pipeline?.trim()) {
      const parsed = parseOrchestrationPipeline(body.pipeline);
      if (parsed.agents.length > 0) agents = parsed.agents;
    }
    if (agents.length === 0) {
      agents = this.orchestration.resolveDefaultPipeline();
    }
    if (agents.length === 0) {
      throw new BadRequestException('pipeline empty');
    }
    return toPlainJson(
      await this.orchestration.enqueuePipeline(agents, body.input ?? {}),
    );
  }

  @Post('admin/agents/discovery/run')
  async runDiscovery(@Body() body: DiscoveryRunDto) {
    return toPlainJson(
      await this.orchestration.enqueueAgent(AI_AGENT_TOPIC_DISCOVERY_V1, {
        sourceId: body.sourceId,
        limit: body.limit,
        minClusterSize: body.minClusterSize,
      }),
    );
  }

  @Get('admin/agents/proposals')
  async listProposals(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return toPlainJson(
      await this.orchestration.listProposals({
        status,
        limit: limit != null ? Number(limit) : undefined,
        offset: offset != null ? Number(offset) : undefined,
      }),
    );
  }

  @Post('admin/agents/proposals/:id/approve')
  async approveProposal(
    @Param('id') id: string,
    @Body() body: ApproveProposalDto,
  ) {
    const topic = await this.orchestration.approveProposal(parseBigId(id, 'id'), {
      version: body.version,
    });
    return toPlainJson({ ok: true, topic });
  }

  @Post('admin/agents/proposals/:id/reject')
  async rejectProposal(@Param('id') id: string) {
    return toPlainJson(
      await this.orchestration.rejectProposal(parseBigId(id, 'id')),
    );
  }

  @Post('admin/agents/merge/run')
  async runMerge(@Body() body: MergeRunDto) {
    const input = {
      sourceTopicId: body.sourceTopicId,
      targetTopicId: body.targetTopicId,
      dryRun: body.dryRun,
      mergedBy: body.mergedBy,
      minSimilarity: body.minSimilarity,
    };
    if (body.dryRun !== false) {
      return toPlainJson(await this.topicMerge.run(input));
    }
    return toPlainJson(
      await this.orchestration.enqueueAgent(AI_AGENT_TOPIC_MERGE_V1, input),
    );
  }

  @Get('admin/agents/merge/audits')
  async mergeAudits(@Query('limit') limit?: string) {
    return toPlainJson(
      await this.orchestration.listMergeAudits(
        limit != null ? Number(limit) : 50,
      ),
    );
  }

  @Post('admin/agents/factcheck/run')
  async runFactCheck(@Body() body: FactCheckRunDto) {
    return toPlainJson(
      await this.orchestration.enqueueAgent(AI_AGENT_FACT_CHECK_V1, {
        snapshotId: body.snapshotId,
        topN: body.topN,
      }),
    );
  }

  @Post('admin/agents/trend-analysis/run')
  async runTrendAnalysis(@Body() body: SnapshotAgentRunDto) {
    return toPlainJson(
      await this.orchestration.enqueueAgent(AI_AGENT_TREND_ANALYSIS_V1, {
        snapshotId: body.snapshotId,
        topN: body.topN,
      }),
    );
  }

  @Post('admin/agents/time-series/run')
  async runTimeSeries(@Body() body: SnapshotAgentRunDto) {
    return toPlainJson(
      await this.orchestration.enqueueAgent(AI_AGENT_TIME_SERIES_V1, {
        snapshotId: body.snapshotId,
      }),
    );
  }

  @Post('admin/agents/ranking/run')
  async runRankingAgent(@Body() body: SnapshotAgentRunDto) {
    return toPlainJson(
      await this.orchestration.enqueueAgent(AI_AGENT_RANKING_V1, {
        snapshotId: body.snapshotId,
        topN: body.topN,
      }),
    );
  }

  @Post('admin/agents/duplicate-detection/run')
  async runDuplicateDetection(
    @Body() body: { sourceId?: string; limit?: number },
  ) {
    return toPlainJson(
      await this.orchestration.enqueueAgent(AI_AGENT_DUPLICATE_DETECTION_V1, body),
    );
  }
}
