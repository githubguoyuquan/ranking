import type { TimeWindow } from '@prisma/client';

/** `OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED` → Kafka `ranking.snapshot.completed` 的 JSON 形状（契约层）。 */
export type RankingSnapshotCompletedOutboxPayload = {
  schemaVersion: 1;
  snapshotId: string;
  topicRankingId: string;
  topicVersionId: string;
  topicId: string;
  topicVersionLabel: string;
  timeWindow: TimeWindow;
  snapshotTime: string;
  snapshotVersion: string;
  itemCount: number;
  confidenceScore: number;
  hasScoreModel: boolean;
  scoreModelId: string | null;
};

/**
 * 将库内 Outbox 行（含 schema 升级前缺字段的旧 payload）规范为 v1 契约。
 * 缺 `hasScoreModel` 时按 `scoreModelId` 推断；二者皆无则 `false` / `null`。
 */
export function normalizeRankingSnapshotCompletedOutboxPayload(
  raw: unknown,
): RankingSnapshotCompletedOutboxPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (p.schemaVersion !== 1) return null;

  const snapshotId = p.snapshotId != null ? String(p.snapshotId) : '';
  const topicRankingId = p.topicRankingId != null ? String(p.topicRankingId) : '';
  const topicVersionId = p.topicVersionId != null ? String(p.topicVersionId) : '';
  const topicId = p.topicId != null ? String(p.topicId) : '';
  const topicVersionLabel =
    typeof p.topicVersionLabel === 'string' ? p.topicVersionLabel : '';
  const timeWindow = p.timeWindow;
  const snapshotTime = typeof p.snapshotTime === 'string' ? p.snapshotTime : '';
  const snapshotVersion =
    typeof p.snapshotVersion === 'string' ? p.snapshotVersion : '';
  const itemCount = typeof p.itemCount === 'number' ? p.itemCount : NaN;
  const confidenceScore =
    typeof p.confidenceScore === 'number' ? p.confidenceScore : NaN;

  if (
    !snapshotId ||
    !topicRankingId ||
    !topicVersionId ||
    !topicId ||
    !topicVersionLabel ||
    typeof timeWindow !== 'string' ||
    !snapshotTime ||
    !snapshotVersion ||
    !Number.isFinite(itemCount) ||
    !Number.isFinite(confidenceScore)
  ) {
    return null;
  }

  let hasScoreModel: boolean;
  if (typeof p.hasScoreModel === 'boolean') {
    hasScoreModel = p.hasScoreModel;
  } else {
    const sid = p.scoreModelId;
    hasScoreModel =
      sid != null && sid !== 'null' && String(sid).trim() !== '';
  }

  let scoreModelId: string | null;
  if (p.scoreModelId == null || p.scoreModelId === 'null') {
    scoreModelId = null;
  } else if (
    typeof p.scoreModelId === 'string' ||
    typeof p.scoreModelId === 'number' ||
    typeof p.scoreModelId === 'bigint'
  ) {
    scoreModelId = String(p.scoreModelId);
  } else {
    scoreModelId = null;
  }

  if (!hasScoreModel) scoreModelId = null;

  return {
    schemaVersion: 1,
    snapshotId,
    topicRankingId,
    topicVersionId,
    topicId,
    topicVersionLabel,
    timeWindow: timeWindow as TimeWindow,
    snapshotTime,
    snapshotVersion,
    itemCount,
    confidenceScore,
    hasScoreModel,
    scoreModelId,
  };
}

export function buildRankingSnapshotCompletedOutboxPayload(args: {
  snapshotId: bigint;
  topicRankingId: bigint;
  topicVersionId: bigint;
  topicId: bigint;
  topicVersionLabel: string;
  timeWindow: TimeWindow;
  snapshotTime: Date;
  snapshotVersion: string;
  itemCount: number;
  confidenceScore: number;
  scoreModelId: bigint | null;
}): RankingSnapshotCompletedOutboxPayload {
  return {
    schemaVersion: 1,
    snapshotId: args.snapshotId.toString(),
    topicRankingId: args.topicRankingId.toString(),
    topicVersionId: args.topicVersionId.toString(),
    topicId: args.topicId.toString(),
    topicVersionLabel: args.topicVersionLabel,
    timeWindow: args.timeWindow,
    snapshotTime: args.snapshotTime.toISOString(),
    snapshotVersion: args.snapshotVersion,
    itemCount: args.itemCount,
    confidenceScore: args.confidenceScore,
    hasScoreModel: args.scoreModelId != null,
    scoreModelId: args.scoreModelId != null ? args.scoreModelId.toString() : null,
  };
}
