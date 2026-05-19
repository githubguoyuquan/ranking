import { EMBEDDING_DIMS } from './embedding.constants';

export const QDRANT_COLLECTION_ENTITIES =
  process.env.QDRANT_COLLECTION_ENTITIES?.trim() || 'ranking_entities';

export const QDRANT_COLLECTION_CRAWLED_URLS =
  process.env.QDRANT_COLLECTION_CRAWLED_URLS?.trim() || 'ranking_crawled_urls';

export const QDRANT_VECTOR_DIMS = EMBEDDING_DIMS;

/** 无 embedding 时占位向量（仅用于满足 Qdrant 必填 vector；不参与语义检索） */
export const QDRANT_PLACEHOLDER_VECTOR: number[] = Array.from(
  { length: QDRANT_VECTOR_DIMS },
  () => 0,
);
