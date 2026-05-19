export type SearchEngineId = 'qdrant' | 'elasticsearch' | 'postgresql';

type SearchBackendFlags = { isEnabled(): boolean };

/** `auto`：Qdrant → Elasticsearch → PostgreSQL */
export function resolveSearchPrimary(
  qdrant: SearchBackendFlags,
  elastic: SearchBackendFlags,
): SearchEngineId {
  const pref = process.env.SEARCH_PRIMARY?.trim().toLowerCase();
  if (pref === 'qdrant') {
    return qdrant.isEnabled() ? 'qdrant' : 'postgresql';
  }
  if (pref === 'es' || pref === 'elasticsearch') {
    return elastic.isEnabled() ? 'elasticsearch' : 'postgresql';
  }
  if (pref === 'pg' || pref === 'postgresql') {
    return 'postgresql';
  }
  if (qdrant.isEnabled()) return 'qdrant';
  if (elastic.isEnabled()) return 'elasticsearch';
  return 'postgresql';
}

export function useQdrantAsPrimary(
  qdrant: SearchBackendFlags,
  elastic: SearchBackendFlags,
): boolean {
  return resolveSearchPrimary(qdrant, elastic) === 'qdrant';
}
