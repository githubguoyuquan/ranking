/** Dev / prod index name for Entity documents */
export const ELASTIC_INDEX_ENTITIES =
  process.env.ELASTICSEARCH_INDEX_ENTITIES ?? 'ranking_entities';

/** Crawled URL / text preview documents（与 ranking_entities 分立） */
export const ELASTIC_INDEX_CRAWLED_URLS =
  process.env.ELASTICSEARCH_INDEX_CRAWLED_URLS ?? 'ranking_crawled_urls';
