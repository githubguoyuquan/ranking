/** `AiAuditEvent.source` 取值（运维筛选 / 全图谱聚合） */
export const AI_AUDIT_SOURCE_API = 'api';
export const AI_AUDIT_SOURCE_RANKING_FOLLOWUP = 'ranking_followup';
export const AI_AUDIT_SOURCE_EMBEDDING_INGESTION = 'embedding_ingestion';
export const AI_AUDIT_SOURCE_EMBEDDING_SEARCH = 'embedding_search';
export const AI_AUDIT_SOURCE_EMBEDDING_RECOMMEND = 'embedding_recommend';

export type AiAuditSource =
  | typeof AI_AUDIT_SOURCE_API
  | typeof AI_AUDIT_SOURCE_RANKING_FOLLOWUP
  | typeof AI_AUDIT_SOURCE_EMBEDDING_INGESTION
  | typeof AI_AUDIT_SOURCE_EMBEDDING_SEARCH
  | typeof AI_AUDIT_SOURCE_EMBEDDING_RECOMMEND;
