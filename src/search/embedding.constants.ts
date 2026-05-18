/** OpenAI `text-embedding-3-small` 默认向量维度 */
export const EMBEDDING_DIMS = 1536;

export const DEFAULT_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
