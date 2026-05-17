/** 与 `class-validator` `@IsDateString()` 前置体验一致：`Date.parse` 可解析即可。 */
export function isIsoDateString(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return Number.isFinite(Date.parse(t));
}
