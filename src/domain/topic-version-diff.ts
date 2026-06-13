import type { RankingPolicyJson } from './policy-json';

export type WeightChangeKind = 'added' | 'removed' | 'changed';

export type WeightChange = {
  key: string;
  kind: WeightChangeKind;
  from?: number;
  to?: number;
};

export type TopicVersionPolicyDiff = {
  weightChanges: WeightChange[];
  entityIdsAdded: string[];
  entityIdsRemoved: string[];
  requiredSignalKeysAdded: string[];
  requiredSignalKeysRemoved: string[];
  decayChanged: boolean;
  decayFrom: RankingPolicyJson['decay'] | null;
  decayTo: RankingPolicyJson['decay'] | null;
  unchanged: boolean;
};

export function diffTopicVersionPolicies(
  from: RankingPolicyJson,
  to: RankingPolicyJson,
): TopicVersionPolicyDiff {
  const weightChanges: WeightChange[] = [];
  const fromKeys = new Set(Object.keys(from.weights));
  const toKeys = new Set(Object.keys(to.weights));

  for (const key of [...fromKeys].sort()) {
    if (!toKeys.has(key)) {
      weightChanges.push({ key, kind: 'removed', from: from.weights[key] });
    } else if (from.weights[key] !== to.weights[key]) {
      weightChanges.push({
        key,
        kind: 'changed',
        from: from.weights[key],
        to: to.weights[key],
      });
    }
  }
  for (const key of [...toKeys].sort()) {
    if (!fromKeys.has(key)) {
      weightChanges.push({ key, kind: 'added', to: to.weights[key] });
    }
  }

  const fromEntityIds = new Set(from.entityIds ?? []);
  const toEntityIds = new Set(to.entityIds ?? []);
  const entityIdsAdded = [...toEntityIds].filter((id) => !fromEntityIds.has(id)).sort();
  const entityIdsRemoved = [...fromEntityIds].filter((id) => !toEntityIds.has(id)).sort();

  const fromReq = new Set(from.requiredSignalKeys ?? Object.keys(from.weights));
  const toReq = new Set(to.requiredSignalKeys ?? Object.keys(to.weights));
  const requiredSignalKeysAdded = [...toReq].filter((k) => !fromReq.has(k)).sort();
  const requiredSignalKeysRemoved = [...fromReq].filter((k) => !toReq.has(k)).sort();

  const decayFrom = from.decay ?? null;
  const decayTo = to.decay ?? null;
  const decayChanged = stableJson(decayFrom) !== stableJson(decayTo);

  const unchanged =
    weightChanges.length === 0 &&
    entityIdsAdded.length === 0 &&
    entityIdsRemoved.length === 0 &&
    requiredSignalKeysAdded.length === 0 &&
    requiredSignalKeysRemoved.length === 0 &&
    !decayChanged;

  return {
    weightChanges,
    entityIdsAdded,
    entityIdsRemoved,
    requiredSignalKeysAdded,
    requiredSignalKeysRemoved,
    decayChanged,
    decayFrom,
    decayTo,
    unchanged,
  };
}

function stableJson(v: unknown): string {
  return JSON.stringify(v ?? null);
}
