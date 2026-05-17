import {
  SEARCH_SOURCE_ID_QUERY_MAX_LEN,
  UNIFIED_SEARCH_Q_MAX_LEN,
} from "@/lib/admin-input-limits";
import { ADMIN_HREF } from "@/lib/admin-web-paths";

/**
 * 运营台 `/search` 深链，子串与 `UnifiedSearchQueryDto.q` `@MaxLength(200)` 对齐。
 */
export function unifiedSearchAdminPathFromQuery(rawQ: string): string {
  const t = rawQ.trim();
  if (t === "") return ADMIN_HREF.search;
  const q =
    t.length > UNIFIED_SEARCH_Q_MAX_LEN
      ? t.slice(0, UNIFIED_SEARCH_Q_MAX_LEN)
      : t;
  return `${ADMIN_HREF.search}?${new URLSearchParams({ q }).toString()}`;
}

/**
 * 仅预填 `sourceId`（如从 crawl 数据源跳转）；与 `UnifiedSearchQueryDto.sourceId`
 * `@MaxLength(64)` 对齐。
 */
export function unifiedSearchAdminPathFromSourceId(rawSourceId: string): string {
  const t = rawSourceId.trim();
  if (t === "") return ADMIN_HREF.search;
  const sourceId =
    t.length > SEARCH_SOURCE_ID_QUERY_MAX_LEN
      ? t.slice(0, SEARCH_SOURCE_ID_QUERY_MAX_LEN)
      : t;
  return `${ADMIN_HREF.search}?${new URLSearchParams({ sourceId }).toString()}`;
}

/** 聚合搜索管理页路径，与 `URLSearchParams` 查询串拼成与 `NEST_V1.search`（`nest-api-paths`）一致的预填 */
export function buildUnifiedSearchWebPath(params: URLSearchParams): string {
  return `${ADMIN_HREF.search}?${params.toString()}`;
}
