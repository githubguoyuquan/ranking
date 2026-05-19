#!/usr/bin/env bash
set -euo pipefail

BASE="${API_BASE_URL:-http://localhost:3000}"
KEY="${API_KEY:-${ADMIN_API_KEY:-}}"

if [[ -z "$KEY" ]]; then
  echo "Set API_KEY or ADMIN_API_KEY (admin scope)" >&2
  exit 1
fi

echo "POST $BASE/admin/scale/validate"
curl -sS -X POST \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"esIterations":15,"qdrantIterations":20}' \
  "$BASE/admin/scale/validate" | jq .
