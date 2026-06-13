export type RrfList<T> = {
  name: string;
  hits: T[];
  idOf: (hit: T) => string;
};

export type RrfFusedHit<T> = {
  hit: T;
  score: number;
  ranks: Record<string, number>;
};

/**
 * Reciprocal Rank Fusion: score(d) = Σ 1 / (k + rank_i(d))
 * @see https://plg.uwaterloo.ca/~gvcormac/cormac09rrf.pdf
 */
export function reciprocalRankFusion<T>(
  lists: RrfList<T>[],
  k = 60,
): RrfFusedHit<T>[] {
  const kk = Number.isFinite(k) && k >= 0 ? k : 60;
  const fused = new Map<string, { hit: T; score: number; ranks: Record<string, number> }>();

  for (const list of lists) {
    list.hits.forEach((hit, idx) => {
      const id = list.idOf(hit);
      if (!id) return;
      const rank = idx + 1;
      const contrib = 1 / (kk + rank);
      const cur = fused.get(id);
      if (!cur) {
        fused.set(id, {
          hit,
          score: contrib,
          ranks: { [list.name]: rank },
        });
        return;
      }
      cur.score += contrib;
      cur.ranks[list.name] = rank;
    });
  }

  return [...fused.values()].sort((a, b) => b.score - a.score);
}

export function rrfKFromEnv(): number {
  const v = process.env.SEARCH_RRF_K?.trim();
  if (!v) return 60;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 60;
}
