import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AgentOrchestrationService } from './agent-orchestration.service';
import {
  AI_AGENT_JOB_NAME,
  AI_AGENT_PIPELINE_JOB_NAME,
  AI_AGENT_QUEUE,
  type AiAgentJobPayload,
  type AiAgentPipelineJobPayload,
} from './ai-agent-job';

@Processor(AI_AGENT_QUEUE, { concurrency: 3 })
export class AiAgentProcessor extends WorkerHost {
  constructor(private readonly orchestration: AgentOrchestrationService) {
    super();
  }

  async process(
    job: Job<AiAgentJobPayload | AiAgentPipelineJobPayload, unknown, string>,
  ): Promise<Record<string, unknown>> {
    if (job.name === AI_AGENT_PIPELINE_JOB_NAME) {
      return this.orchestration.handlePipelineJob(
        job.data as AiAgentPipelineJobPayload,
      );
    }
    if (job.name === AI_AGENT_JOB_NAME) {
      return this.orchestration.handleAgentJob(job.data as AiAgentJobPayload);
    }
    return { skipped: true, name: job.name };
  }
}
