import { EMBEDDING_DIMS } from '../search/embedding.constants';
import { cosineSimilarity } from '../lib/vector-cosine';

/** 合并 title + preview 作为语义指纹输入 */
export function crawlSemanticDedupText(
  pageTitle: string | null,
  textPreview: string | null,
): string | null {
  const t = pageTitle?.trim();
  const p = textPreview?.trim();
  const parts = [t, p].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return parts.join('\n').slice(0, 8000);
}

export function crawlSemanticDedupEnabled(): boolean {
  return process.env.CRAWL_SEMANTIC_DEDUP === 'true';
}

export function crawlSemanticDedupMinChars(): number {
  const n = Number(process.env.CRAWL_SEMANTIC_DEDUP_MIN_CHARS);
  return Number.isFinite(n) && n >= 20 && n <= 4000 ? Math.floor(n) : 80;
}

export function crawlSemanticDedupThreshold(): number {
  const n = Number(process.env.CRAWL_SEMANTIC_DEDUP_THRESHOLD);
  return Number.isFinite(n) && n >= 0.75 && n <= 0.999 ? n : 0.92;
}

export function crawlSemanticDedupCandidateLimit(): number {
  const n = Number(process.env.CRAWL_SEMANTIC_DEDUP_CANDIDATES);
  return Number.isFinite(n) && n >= 30 && n <= 2000 ? Math.floor(n) : 300;
}

export function parsePreviewEmbeddingJson(j: unknown): number[] | null {
  if (!Array.isArray(j)) return null;
  const nums = j.filter((x): x is number => typeof x === 'number');
  if (nums.length !== EMBEDDING_DIMS) return null;
  return nums;
}

export function findNearestByCosine(
  vec: number[],
  rows: Array<{ id: bigint; previewEmbedding: unknown }>,
  threshold: number,
): bigint | null {
  let bestId: bigint | null = null;
  let best = threshold;
  for (const r of rows) {
    const emb = parsePreviewEmbeddingJson(r.previewEmbedding);
    if (!emb) continue;
    const sim = cosineSimilarity(vec, emb);
    if (sim >= best) {
      best = sim;
      bestId = r.id;
    }
  }
  return bestId;
}
