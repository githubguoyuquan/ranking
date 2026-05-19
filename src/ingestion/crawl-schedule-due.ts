/** 判断信源是否应在 `now` 触发调度（interval 优先于 cron） */
export function isSourceScheduleDue(
  source: {
    scheduleIntervalMinutes: number | null;
    scheduleCron: string | null;
    lastScheduledAt: Date | null;
  },
  now: Date,
): boolean {
  if (source.scheduleIntervalMinutes != null && source.scheduleIntervalMinutes > 0) {
    const ms = source.scheduleIntervalMinutes * 60_000;
    if (!source.lastScheduledAt) return true;
    return now.getTime() - source.lastScheduledAt.getTime() >= ms;
  }
  if (source.scheduleCron?.trim()) {
    return cronMatchesUtc(source.scheduleCron.trim(), now);
  }
  return false;
}

/** 极简 5 段 cron（分 时 日 月 周），支持星号、数字、步长（如 star/6） */
function cronMatchesUtc(expr: string, now: Date): boolean {
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return false;
  const [minF, hourF, domF, monF, dowF] = parts;
  const min = now.getUTCMinutes();
  const hour = now.getUTCHours();
  const dom = now.getUTCDate();
  const mon = now.getUTCMonth() + 1;
  const dow = now.getUTCDay();
  return (
    fieldMatches(minF, min) &&
    fieldMatches(hourF, hour) &&
    fieldMatches(domF, dom) &&
    fieldMatches(monF, mon) &&
    fieldMatches(dowF, dow)
  );
}

function fieldMatches(field: string, value: number): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = Number.parseInt(field.slice(2), 10);
    return Number.isFinite(step) && step > 0 && value % step === 0;
  }
  if (field.includes(',')) {
    return field.split(',').some((p) => fieldMatches(p.trim(), value));
  }
  const n = Number.parseInt(field, 10);
  return Number.isFinite(n) && n === value;
}
