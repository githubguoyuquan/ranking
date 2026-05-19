import { afterEach, describe, expect, it } from 'vitest';
import {
  processRole,
  runsCrawlWorkers,
  runsOutboxKafkaPublisher,
  runsRankingWorkers,
} from './process-role';

describe('process-role', () => {
  const prev = process.env.PROCESS_ROLE;

  afterEach(() => {
    if (prev === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = prev;
  });

  it('defaults to all', () => {
    delete process.env.PROCESS_ROLE;
    expect(processRole()).toBe('all');
    expect(runsRankingWorkers()).toBe(true);
    expect(runsCrawlWorkers()).toBe(true);
    expect(runsOutboxKafkaPublisher()).toBe(true);
  });

  it('api disables workers', () => {
    process.env.PROCESS_ROLE = 'api';
    expect(runsRankingWorkers()).toBe(false);
    expect(runsOutboxKafkaPublisher()).toBe(false);
  });

  it('worker runs ranking and kafka', () => {
    process.env.PROCESS_ROLE = 'worker';
    expect(runsRankingWorkers()).toBe(true);
    expect(runsOutboxKafkaPublisher()).toBe(true);
    expect(runsCrawlWorkers()).toBe(false);
  });
});
