#!/usr/bin/env bash
# DR readiness probe for CI / on-call / post-deploy smoke.
set -euo pipefail

BASE="${RANKING_API_BASE:-http://127.0.0.1:3000}"
KEY="${RANKING_API_KEY:-}"
# ok = fail on warn+critical; warn = fail on critical only
MIN_STATUS="${DR_READINESS_MIN_STATUS:-ok}"
WAIT_SEC="${DR_READINESS_WAIT_SEC:-0}"

usage() {
  cat <<'EOF'
Usage: dr-readiness.sh [options]

  RANKING_API_BASE          API origin (default http://127.0.0.1:3000)
  RANKING_API_KEY           Admin API key (X-API-Key)
  DR_READINESS_MIN_STATUS   ok (default) | warn
  DR_READINESS_WAIT_SEC     Retry seconds until API is up

Options:
  --min-status=warn    Allow warn (only fail on critical)
  --wait=SECONDS       Retry until API responds
  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --min-status=*) MIN_STATUS="${1#*=}"; shift ;;
    --wait=*) WAIT_SEC="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 64 ;;
  esac
done

headers=()
if [[ -n "$KEY" ]]; then
  headers=(-H "X-API-Key: $KEY")
else
  echo "WARN: RANKING_API_KEY unset — may fail when API_AUTH_REQUIRED=true" >&2
fi

url="${BASE%/}/admin/ops/dr/readiness"
deadline=$((SECONDS + WAIT_SEC))

fetch_body() {
  curl -fsS "${headers[@]}" "$url"
}

echo "GET $url"
body=""
while true; do
  if body="$(fetch_body 2>/dev/null)"; then
    break
  fi
  if (( WAIT_SEC <= 0 || SECONDS >= deadline )); then
    echo "DR readiness: API unreachable at $url" >&2
    exit 3
  fi
  sleep 2
done

status="$(echo "$body" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);process.stdout.write(j.status||'unknown')})")"

echo "$body" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"

if [[ "$status" == "critical" ]]; then
  echo "DR readiness: CRITICAL" >&2
  exit 2
fi
if [[ "$status" == "warn" ]]; then
  echo "DR readiness: WARN" >&2
  if [[ "$MIN_STATUS" == "warn" ]]; then
    echo "DR readiness: WARN accepted (DR_READINESS_MIN_STATUS=warn)"
    exit 0
  fi
  exit 1
fi
echo "DR readiness: OK"
exit 0
