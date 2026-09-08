export type TopicEntityCandidate = {
  id: string;
  name: string;
  type: string;
  description: string;
  externalId: string;
  sourceUrl: string;
};

export type TopicEntityAutofill = {
  requestedCount: number;
  status: "queued" | "running" | "completed" | "partial" | "failed";
  strategy: string | null;
  message: string | null;
  updatedAt: string;
  entities: TopicEntityCandidate[];
};

const STATUSES = new Set(["queued", "running", "completed", "partial", "failed"]);

/** Only link to the identity provider; never render arbitrary returned URLs. */
export function safeEntitySourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.wikidata.org" ||
      url.port || url.username || url.password ||
      !/^\/(?:wiki|entity)\/Q[1-9]\d*$/.test(url.pathname) ||
      url.search || url.hash
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function parseTopicEntityAutofill(raw: unknown): TopicEntityAutofill | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    !Number.isInteger(value.requestedCount) ||
    Number(value.requestedCount) < 1 || Number(value.requestedCount) > 50 ||
    typeof value.status !== "string" || !STATUSES.has(value.status) ||
    !Array.isArray(value.entities)
  ) return null;
  const entities: TopicEntityCandidate[] = [];
  const seen = new Set<string>();
  for (const row of value.entities) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
    const entity = row as Record<string, unknown>;
    const id = String(entity.id ?? "");
    if (!/^[1-9]\d*$/.test(id) || seen.has(id) || typeof entity.name !== "string" || !entity.name.trim()) continue;
    seen.add(id);
    entities.push({
      id,
      name: entity.name,
      type: String(entity.type ?? ""),
      description: String(entity.description ?? ""),
      externalId: String(entity.externalId ?? ""),
      sourceUrl: safeEntitySourceUrl(entity.sourceUrl) ?? "",
    });
  }
  return {
    requestedCount: Number(value.requestedCount),
    status: value.status as TopicEntityAutofill["status"],
    strategy: typeof value.strategy === "string" ? value.strategy : null,
    message: typeof value.message === "string" ? value.message : null,
    updatedAt: String(value.updatedAt ?? ""),
    entities,
  };
}

/** Partial candidates require an operator's explicit acceptance. */
export function entityAutofillSelection(
  population: TopicEntityAutofill,
  partialAccepted = false,
): string | null {
  if (
    population.entities.length === 0 ||
    (population.status !== "completed" && !(population.status === "partial" && partialAccepted))
  ) return null;
  return population.entities.map((entity) => entity.id).join(", ");
}

export const ENTITY_AUTOFILL_STATUS_LABELS: Record<TopicEntityAutofill["status"], string> = {
  queued: "等待查找",
  running: "正在查找",
  completed: "已填充完成",
  partial: "已找到部分对象",
  failed: "暂未填充成功",
};
