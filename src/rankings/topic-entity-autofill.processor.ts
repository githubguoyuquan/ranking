import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { TopicEntityAutofillService } from './topic-entity-autofill.service';
import {
  TOPIC_ENTITY_AUTOFILL_JOB, TOPIC_ENTITY_AUTOFILL_QUEUE, type TopicEntityAutofillJob,
} from './topic-entity-autofill-job';

@Processor(TOPIC_ENTITY_AUTOFILL_QUEUE, { concurrency: 2 })
export class TopicEntityAutofillProcessor extends WorkerHost {
  constructor(private readonly autofill: TopicEntityAutofillService) { super(); }

  async process(job: Job<TopicEntityAutofillJob>) {
    if (job.name !== TOPIC_ENTITY_AUTOFILL_JOB) return;
    await this.autofill.process(job.data);
  }
}
