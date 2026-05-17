import {
  ENTITY_ADMIN_LIST_LIMIT_DEFAULT,
  ENTITY_ADMIN_LIST_LIMIT_MAX,
} from "@/lib/admin-input-limits";
import { ADMIN_HREF } from "@/lib/admin-web-paths";

/** 与后端 `listEntities` 钳制一致：1–`ENTITY_ADMIN_LIST_LIMIT_MAX`，空/非法回退默认值 */
export function normalizeEntityAdminListLimit(raw: string): string {
  const t = raw.trim();
  if (t === "") return String(ENTITY_ADMIN_LIST_LIMIT_DEFAULT);
  const n = Math.trunc(Number(t));
  if (!Number.isFinite(n) || n < 1) {
    return String(ENTITY_ADMIN_LIST_LIMIT_DEFAULT);
  }
  return String(Math.min(n, ENTITY_ADMIN_LIST_LIMIT_MAX));
}

/** 运营台 `/entities` 查询串，与列表页「刷新」行为一致 */
export function buildEntitiesListWebPath(q: string, limitRaw: string): string {
  const params = new URLSearchParams();
  const qt = q.trim();
  if (qt) params.set("q", qt);
  params.set("limit", normalizeEntityAdminListLimit(limitRaw));
  return `${ADMIN_HREF.entities}?${params.toString()}`;
}

/** 自其它页深链到实体列表（预填 canonicalName 子串 + 默认 limit） */
export function entitiesAdminPrefillPath(canonicalName: string): string {
  return buildEntitiesListWebPath(canonicalName, "");
}
