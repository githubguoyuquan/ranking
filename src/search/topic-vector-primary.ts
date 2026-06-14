import type { TopicVectorIndexService } from './topic-vector-index.service';

export type TopicVectorBackend = 'qdrant' | 'postgresql';

/** `auto`：Qdrant 可用时用 ANN，否则 PG 余弦 */
export function resolveTopicVectorPrimary(
  topicVectors: Pick<TopicVectorIndexService, 'isEnabled'>,
): TopicVectorBackend {
  const pref = process.env.TOPIC_VECTOR_PRIMARY?.trim().toLowerCase();
  if (pref === 'qdrant') {
    return topicVectors.isEnabled() ? 'qdrant' : 'postgresql';
  }
  if (pref === 'pg' || pref === 'postgresql') {
    return 'postgresql';
  }
  if (topicVectors.isEnabled()) return 'qdrant';
  return 'postgresql';
}
