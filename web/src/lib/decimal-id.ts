/**
 * 后端多处对路径或 JSON 使用 `BigInt(…)`；非十进制字符串会变成难读的服务器错误。
 * 位数上限与常见 PG `bigint` / JS 互操作习惯一致。
 */
export const DECIMAL_BIGINT_ID_MAX_DIGITS = 38;

function isNonEmptyDecimalId(value: string): boolean {
  const t = value.trim();
  if (!t || !/^\d+$/.test(t) || t.length > DECIMAL_BIGINT_ID_MAX_DIGITS) {
    return false;
  }
  return true;
}

/** 已 trim 且非空的 topicVersionId / Topic.id 等 */
export function isDecimalBigIntIdString(raw: string): boolean {
  return isNonEmptyDecimalId(raw);
}

type OptionalDecimalOk = { ok: true; value?: string };
type OptionalDecimalErr = { ok: false; message: string };

export function validateOptionalDecimalBigIntId(
  raw: string,
  fieldLabel: string,
): OptionalDecimalOk | OptionalDecimalErr {
  const t = raw.trim();
  if (t === "") return { ok: true, value: undefined };
  if (!isNonEmptyDecimalId(t)) {
    return {
      ok: false,
      message: `${fieldLabel} 须为不含空格的十进制数字（至多 ${DECIMAL_BIGINT_ID_MAX_DIGITS} 位），或留空不传`,
    };
  }
  return { ok: true, value: t };
}
