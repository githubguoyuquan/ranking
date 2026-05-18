/**
 * `TopicVersion.policyJson` 形状：与排行物化 (`RankingsService`) 所用字段一致。
 * 校验失败时抛出带可读信息的 Error（由上层转为 HTTP 400）。
 */
export type RankingPolicyJson = {
  entityIds?: string[];
  weights: Record<string, number>;
  requiredSignalKeys?: string[];
};

export function parseRankingPolicyJson(raw: unknown): RankingPolicyJson {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('policyJson must be a non-array object');
  }
  const o = raw as Record<string, unknown>;

  const weightsRaw = o.weights;
  if (
    weightsRaw === null ||
    typeof weightsRaw !== 'object' ||
    Array.isArray(weightsRaw)
  ) {
    throw new Error('weights must be an object');
  }

  const weights: Record<string, number> = {};
  for (const [k, v] of Object.entries(weightsRaw as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`weight "${key}" must be a non-negative finite number`);
    }
    weights[key] = n;
  }
  if (Object.keys(weights).length === 0) {
    throw new Error('weights must have at least one key');
  }

  let entityIds: string[] | undefined;
  if (o.entityIds !== undefined) {
    if (!Array.isArray(o.entityIds)) {
      throw new Error('entityIds must be an array');
    }
    entityIds = [];
    for (const x of o.entityIds) {
      const s = String(x).trim();
      if (!/^\d+$/.test(s)) {
        throw new Error(`invalid entityId: ${s}`);
      }
      entityIds.push(s);
    }
  }

  let requiredSignalKeys: string[] | undefined;
  if (o.requiredSignalKeys !== undefined) {
    if (!Array.isArray(o.requiredSignalKeys)) {
      throw new Error('requiredSignalKeys must be an array');
    }
    requiredSignalKeys = o.requiredSignalKeys.map((x) => String(x));
    for (const key of requiredSignalKeys) {
      if (!(key in weights)) {
        throw new Error(`requiredSignalKeys contains "${key}" which is not in weights`);
      }
    }
  }

  const out: RankingPolicyJson = { weights };
  if (entityIds !== undefined) out.entityIds = entityIds;
  if (requiredSignalKeys !== undefined) out.requiredSignalKeys = requiredSignalKeys;
  return out;
}
