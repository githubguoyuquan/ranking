import type { DecayParams } from './scoring';

/**
 * `TopicVersion.policyJson` 形状：与排行物化 (`RankingsService`) 所用字段一致。
 * 校验失败时抛出带可读信息的 Error（由上层转为 HTTP 400）。
 */
export type RankingPolicyJson = {
  entityIds?: string[];
  weights: Record<string, number>;
  requiredSignalKeys?: string[];
  /** 时间衰减；未设时由 TopicKind 预设或 `scoreEntity` 默认 */
  decay?: DecayParams;
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

  let decay: DecayParams | undefined;
  if (o.decay !== undefined) {
    if (o.decay === null || typeof o.decay !== 'object' || Array.isArray(o.decay)) {
      throw new Error('decay must be an object');
    }
    const d = o.decay as Record<string, unknown>;
    decay = {};
    if (d.halfLifeDays !== undefined) {
      const hl = typeof d.halfLifeDays === 'number' ? d.halfLifeDays : Number(d.halfLifeDays);
      if (!Number.isFinite(hl) || hl <= 0) {
        throw new Error('decay.halfLifeDays must be a positive finite number');
      }
      decay.halfLifeDays = hl;
    }
    if (d.breakpoints !== undefined) {
      if (!Array.isArray(d.breakpoints)) {
        throw new Error('decay.breakpoints must be an array');
      }
      decay.breakpoints = [];
      for (const bp of d.breakpoints) {
        if (bp === null || typeof bp !== 'object' || Array.isArray(bp)) {
          throw new Error('decay.breakpoints entries must be objects');
        }
        const b = bp as Record<string, unknown>;
        const maxAgeDays =
          typeof b.maxAgeDays === 'number' ? b.maxAgeDays : Number(b.maxAgeDays);
        const weight = typeof b.weight === 'number' ? b.weight : Number(b.weight);
        if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
          throw new Error('decay.breakpoints.maxAgeDays must be non-negative');
        }
        if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
          throw new Error('decay.breakpoints.weight must be in [0, 1]');
        }
        decay.breakpoints.push({ maxAgeDays, weight });
      }
    }
    if (decay.halfLifeDays === undefined && !decay.breakpoints?.length) {
      throw new Error('decay must specify halfLifeDays and/or breakpoints');
    }
  }

  const out: RankingPolicyJson = { weights };
  if (entityIds !== undefined) out.entityIds = entityIds;
  if (requiredSignalKeys !== undefined) out.requiredSignalKeys = requiredSignalKeys;
  if (decay !== undefined) out.decay = decay;
  return out;
}
