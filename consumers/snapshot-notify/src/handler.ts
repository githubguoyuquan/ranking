import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KafkaEnvelopeV1 } from './config';

/** 基于 outboxId 的幂等账本（JSONL，一行一个 id） */
export class OutboxIdLedger {
  private readonly seen = new Set<string>();

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      const lines = readFileSync(path, 'utf8').split('\n');
      for (const line of lines) {
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

export type NotifyStats = {
  processed: number;
  skippedDuplicate: number;
  invalid: number;
  webhookFailures: number;
  lastSnapshotId: string | null;
  lastProcessedAt: string | null;
};

export class SnapshotNotifyHandler {
  readonly stats: NotifyStats = {
    processed: 0,
    skippedDuplicate: 0,
    invalid: 0,
    webhookFailures: 0,
    lastSnapshotId: null,
    lastProcessedAt: null,
  };

  constructor(
    private readonly ledger: OutboxIdLedger,
    private readonly webhookUrl: string | null,
  ) {}

  async handle(envelope: KafkaEnvelopeV1): Promise<'processed' | 'duplicate'> {
    const outboxId = envelope.meta.outboxId;
    if (this.ledger.has(outboxId)) {
      this.stats.skippedDuplicate += 1;
      return 'duplicate';
    }

    const p = envelope.payload;
    const summary = {
      event: envelope.type,
      outboxId,
      snapshotId: p.snapshotId,
      topicVersionId: p.topicVersionId,
      topicVersionLabel: p.topicVersionLabel,
      timeWindow: p.timeWindow,
      itemCount: p.itemCount,
      confidenceScore: p.confidenceScore,
      snapshotTime: p.snapshotTime,
    };

    console.log(JSON.stringify({ level: 'info', msg: 'snapshot_completed', ...summary }));

    if (this.webhookUrl) {
      try {
        const res = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...summary,
            payload: p,
            meta: envelope.meta,
            receivedAt: new Date().toISOString(),
          }),
        });
        if (!res.ok) {
          this.stats.webhookFailures += 1;
          throw new Error(`webhook HTTP ${res.status}`);
        }
      } catch (e) {
        this.stats.webhookFailures += 1;
        throw e;
      }
    }

    this.ledger.record(outboxId);
    this.stats.processed += 1;
    this.stats.lastSnapshotId = p.snapshotId;
    this.stats.lastProcessedAt = new Date().toISOString();
    return 'processed';
  }

  recordInvalid(): void {
    this.stats.invalid += 1;
  }
}
