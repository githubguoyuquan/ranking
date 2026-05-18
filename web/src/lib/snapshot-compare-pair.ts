/**
 * `GET /v1/rankings/:id/status` 的 `snapshots` 为 `snapshotTime` 降序（新→旧），且最多返回若干条。
 * 在列表中定位当前快照 id，优先组成时间上相邻的两张（用于对比页预填）。
 */
export function compareIdsFromRankingSnapshots(
  currentId: string,
  snapshots: unknown,
): string[] {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return [currentId];
  const rows: string[] = [];
  for (const s of snapshots) {
    if (typeof s === "object" && s !== null && "id" in s) {
      const v = (s as { id: unknown }).id;
      if (v != null && String(v) !== "") rows.push(String(v));
    }
  }
  const idx = rows.indexOf(currentId);
  if (idx < 0) return [currentId];
  const olderInList = idx + 1 < rows.length ? rows[idx + 1] : null;
  const newerInList = idx > 0 ? rows[idx - 1] : null;
  if (olderInList) return [olderInList, currentId];
  if (newerInList) return [currentId, newerInList];
  return [currentId];
}
