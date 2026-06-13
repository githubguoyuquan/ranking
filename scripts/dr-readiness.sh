#!/usr/bin/env bash
# DR readiness probe for CI / on-call (requires admin API key).
set -euo pipefail

BASE="${RANKING_API_BASE:-http://127.0.0.1:3000}"
KEY="${RANKING_API_KEY:-}"

headers=()
if [[ -n "$KEY" ]]; then
  headers=(-H "X-API-Key: $KEY")
fi

url="${BASE%/}/admin/ops/dr/readiness"
echo "GET $url"
body="$(curl -fsS "${headers[@]}" "$url")"
status="$(echo "$body" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);process.stdout.write(j.status||'unknown')})")"

echo "$body" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"

if [[ "$status" == "critical" ]]; then
  echo "DR readiness: CRITICAL" >&2
  exit 2
fi
if [[ "$status" == "warn" ]]; then
  echo "DR readiness: WARN" >&2
  exit 1
fi
echo "DR readiness: OK"
