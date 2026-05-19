import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { runsAiAgentWorkers } from '../config/process-role';
import { AgentModule } from '../agent/agent.module';
import { SearchModule } from '../search/search.module';
import { AgentOrchestrationController } from './agent-orchestration.controller';
import { AgentOrchestrationService } from './agent-orchestration.service';
import { AgentRunService } from './agent-run.service';
import { AI_AGENT_QUEUE } from './ai-agent-job';
import { AiAgentProcessor } from './ai-agent.processor';
import { DuplicateDetectionAgent } from './agents/duplicate-detection.agent';
import { FactCheckAgent } from './agents/fact-check.agent';
import { TopicDiscoveryAgent } from './agents/topic-discovery.agent';
import { TopicMergeAgent } from './agents/topic-merge.agent';

@Module({
  imports: [
    AgentModule,
    SearchModule,
    BullModule.registerQueue({ name: AI_AGENT_QUEUE }),
  ],
  controllers: [AgentOrchestrationController],
  providers: [
    AgentRunService,
    AgentOrchestrationService,
    ...(runsAiAgentWorkers() ? [AiAgentProcessor] : []),
    TopicDiscoveryAgent,
    TopicMergeAgent,
    FactCheckAgent,
    DuplicateDetectionAgent,
  ],
  exports: [AgentOrchestrationService],
})
export class AgentOrchestrationModule {}
