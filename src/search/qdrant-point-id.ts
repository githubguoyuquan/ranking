import { createHash } from 'node:crypto';

/** 将 PG `bigint` 主键映射为 Qdrant 可接受的稳定 UUID */
export function qdrantPointIdFromBigint(id: bigint): string {
  const h = createHash('sha256').update(`ranking:${id.toString()}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
