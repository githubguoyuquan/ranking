import { DECIMAL_BIGINT_ID_MAX_DIGITS } from "@/lib/decimal-id";

/** 与 `CreateEntityAdminDto.type` `@MaxLength(120)` 一致 */
export const ENTITY_TYPE_MAX_LEN = 120;

/** `CreateEntityAdminDto` / `PatchEntityAdminDto` `canonicalName` */
export const ENTITY_CANONICAL_NAME_MAX_LEN = 500;

/**
 * 实体表单「逗号分隔 aliases」单行；DTO 为数组无单元素 MaxLength，此处防过大 JSON。
 */
export const ENTITY_ALIASES_CSV_INPUT_MAX_LEN = 4096;

/** `UnifiedSearchQueryDto` / `SearchEntitiesQueryDto` 等 `q` */
export const UNIFIED_SEARCH_Q_MAX_LEN = 200;

/** `NEST_V1.search`（`nest-api-paths`）上 GET 的 `limit` `@Max(30)` */
export const UNIFIED_SEARCH_LIMIT_MAX = 30;

/** 搜索页 limit 输入：1–30 最多两位十进制 */
export const UNIFIED_SEARCH_LIMIT_INPUT_MAX_LEN = 2;

/** `BACKEND_ADMIN.outbox`（`backend-api-paths`）GET 的 `limit` `@Max(200)` */
export const OUTBOX_LIST_LIMIT_MAX = 200;

/** outbox limit 输入：1–200 最多三位十进制 */
export const OUTBOX_LIMIT_INPUT_MAX_LEN = 3;

/**
 * 运营台实体列表 GET（`BACKEND_ADMIN.entities`，`backend-api-paths`）的 `q` 子串；与统一搜索 `q` 上限相同。
 */
export const ENTITY_LIST_Q_MAX_LEN = UNIFIED_SEARCH_Q_MAX_LEN;

/**
 * 运营台实体列表 `limit` 常用默认值（后端未传时实为 40；前台显式传参保持原 50 行为）。
 */
export const ENTITY_ADMIN_LIST_LIMIT_DEFAULT = 50;

/** 后端 `listEntities` 钳制上界：Math.min(…, 100) */
export const ENTITY_ADMIN_LIST_LIMIT_MAX = 100;

/** limit 输入框：100 为三位十进制 */
export const ENTITY_ADMIN_LIST_LIMIT_INPUT_MAX_LEN = 3;

/** `UnifiedSearchQueryDto.sourceId` `@MaxLength(64)` */
export const SEARCH_SOURCE_ID_QUERY_MAX_LEN = 64;

/** `UnifiedSearchQueryDto.status` `@MaxLength(64)` */
export const SEARCH_CRAWL_STATUS_MAX_LEN = 64;

/** `BACKEND_ADMIN_DOC.snapshotAnalyze` body `agent`（`@MaxLength(120)`） */
export const SNAPSHOT_ANALYZE_AGENT_MAX_LEN = 120;

/** POST analyze body `topN` `@Min(1) @Max(50)` */
export const SNAPSHOT_ANALYZE_TOPN_MIN = 1;
export const SNAPSHOT_ANALYZE_TOPN_MAX = 50;

/** topN 输入框：50 为两位十进制 */
export const SNAPSHOT_ANALYZE_TOPN_INPUT_MAX_LEN = 2;

/** `POST …/analyze` body `chainContext`（与 Nest `AnalyzeSnapshotDto` 一致） */
export const SNAPSHOT_ANALYZE_CHAIN_CONTEXT_MAX_LEN = 8192;

/** Prisma `TimeWindow` 最长 REALTIME；留余量 */
export const TIME_WINDOW_INPUT_MAX_LEN = 16;

/** ISO 8601 在输入框中的合理上限（话题热榜 / 跑榜共用） */
export const ISO_DATETIME_INPUT_MAX_LEN = 80;

/** 与演示 seed slug 习惯一致 */
export const TOPIC_SLUG_MAX_LEN = 160;

/** 热榜 query `version` */
export const LEADERBOARD_VERSION_QUERY_MAX_LEN = 64;

/** 数据源 `name`（Prisma 无 VarChar 上限时的运营台防御性上限） */
export const CRAWL_SOURCE_NAME_INPUT_MAX_LEN = 255;

/** `baseUrl` / `seedUrl` 等（常见浏览器/网关可接受量级） */
export const HTTP_URL_INPUT_MAX_LEN = 2048;

/** 与 `CreateSourceDto.trustTier` `@Min(1) @Max(5)` 一致，一位十进制 */
export const CRAWL_TRUST_TIER_INPUT_MAX_LEN = 1;

/**
 * `CompareSnapshotsDto ArrayMaxSize(10)` + 十进制 id + 逗号与极短分隔容错。
 */
export const COMPARE_SNAPSHOT_IDS_INPUT_MAX_LEN =
  10 * DECIMAL_BIGINT_ID_MAX_DIGITS + 19;

/** GET `NEST_V1.crawlSources`（`nest-api-paths`）的 `limit`（`listSources` 钳制 1–100；运营台常用 50） */
export const CRAWL_SOURCES_LIST_LIMIT_DEFAULT = 50;

/** 运营台「某 source 最近 URL」预览条数 */
export const CRAWL_SOURCE_URLS_PREVIEW_LIMIT = 5;
