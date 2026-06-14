#!/usr/bin/env bash
set -euo pipefail

API_BASE="${RANKING_API_BASE:-http://localhost:3000}"
API_KEY="${RANKING_API_KEY:-${API_KEY:-}}"

if [[ -z "${API_KEY}" ]]; then
  echo "RANKING_API_KEY or API_KEY required" >&2
  exit 1
fi

MONTHS_AHEAD="${POSTGRES_PARTITION_MONTHS_AHEAD:-4}"
BODY=$(printf '{"monthsAhead":%s}' "${MONTHS_AHEAD}")

curl -sf -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d "${BODY}" \
  "${API_BASE}/admin/scale/postgres/ensure-partitions"

echo
