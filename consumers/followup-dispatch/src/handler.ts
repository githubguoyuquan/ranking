import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KafkaEnvelopeV1 } from './config';

export class OutboxIdLedger {
  private readonly seen = new Set<string>();

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        const id = line.trim();
        if (id) this.seen.add(id);
      }
    }
  }

  has(outboxId: string): boolean {
    return this.seen.has(outboxId);
  }

  record(outboxId: string): void {
    if (this.seen.has(outboxId)) return;
    this.seen.add(outboxId);
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(this.path, `${outboxId}\n`, 'utf8');
  }

  get size(): number {
    return this.seen.size;
  }
}

export type DispatchStats = {
  processed: number;
  skippedDuplicate: number;
  invalid: number;
  dispatchFailures: number;
  lastSnapshotId: string | null;
  lastProcessedAt: string | null;
};

export class FollowupDispatchHandler {
  readonly stats: DispatchStats = {
    processed: 0,
    skippedDuplicate: 0,
    invalid: 0,
    dispatchFailures: 0,
    lastSnapshotId: null,
    lastProcessedAt: null,
  };

  constructor(
    private readonly ledger: OutboxIdLedger,
    private readonly dispatchUrl: string,
    private readonly dispatchApiKey: string | null,
  ) {}

  async handle(envelope: KafkaEnvelopeV1): Promise<'processed' | 'duplicate'> {
    const outboxId = envelope.meta.outboxId;
    if (this.ledger.has(outboxId)) {
      this.stats.skippedDuplicate += 1;
      return 'duplicate';
    }

    const p = envelope.payload;
    const body = {
      snapshotId: p.snapshotId,
      topicRankingId: p.topicRankingId,
      topicVersionId: p.topicVersionId,
      topicId: p.topicId,
      timeWindow: p.timeWindow,
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.dispatchApiKey) {
      headers.Authorization = `Bearer ${this.dispatchApiKey}`;
    }

    try {
      const res = await fetch(this.dispatchUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        this.stats.dispatchFailures += 1;
        const text = await res.text().catch(() => '');
        throw new Error(`dispatch HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      this.stats.dispatchFailures += 1;
      throw e;
    }

    this.ledger.record(outboxId);
    this.stats.processed += 1;
    this.stats.lastSnapshotId = p.snapshotId;
    this.stats.lastProcessedAt = new Date().toISOString();

    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'followup_dispatched',
        outboxId,
        snapshotId: p.snapshotId,
        timeWindow: p.timeWindow,
      }),
    );
    return 'processed';
  }

  recordInvalid(): void {
    this.stats.invalid += 1;
  }
}
