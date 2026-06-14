#!/usr/bin/env bash
# Scale validation gate for CI / on-call / post-deploy (POST /admin/scale/validate).
set -euo pipefail

BASE="${RANKING_API_BASE:-${API_BASE_URL:-http://127.0.0.1:3000}}"
KEY="${RANKING_API_KEY:-${API_KEY:-${ADMIN_API_KEY:-}}}"
MIN_STATUS="${SCALE_VALIDATE_MIN_STATUS:-ok}"

usage() {
  cat <<'EOF'
Usage: scale-validate.sh [options]

  RANKING_API_BASE / API_BASE_URL   API origin (default http://127.0.0.1:3000)
  RANKING_API_KEY / API_KEY         Admin API key (X-API-Key)
  SCALE_VALIDATE_MIN_STATUS         ok (default) | warn

Options:
  --min-status=warn    Fail only on critical
  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --min-status=*) MIN_STATUS="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 64 ;;
  esac
done

if [[ -z "$KEY" ]]; then
  echo "Set RANKING_API_KEY or API_KEY (admin scope)" >&2
  exit 1
fi

url="${BASE%/}/admin/scale/validate"
echo "POST $url"

body="$(curl -fsS -X POST \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"esIterations":15,"qdrantIterations":20}' \
  "$url")"

echo "$body" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"

status="$(echo "$body" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);process.stdout.write(j.status||'unknown')})")"

if [[ "$status" == "critical" ]]; then
  echo "Scale validate: CRITICAL" >&2
  # shellcheck source=/dev/null
  source "$(dirname "$0")/dr-alert-on-failure.sh"
  send_probe_failure_alert "ranking-scale-validate" "critical" "Scale validation probe returned critical"
  exit 2
fi
if [[ "$status" == "warn" ]]; then
  echo "Scale validate: WARN" >&2
  if [[ "$MIN_STATUS" == "warn" ]]; then
    echo "Scale validate: WARN accepted (SCALE_VALIDATE_MIN_STATUS=warn)"
    exit 0
  fi
  # shellcheck source=/dev/null
  source "$(dirname "$0")/dr-alert-on-failure.sh"
  send_probe_failure_alert "ranking-scale-validate" "warn" "Scale validation probe returned warn"
  exit 1
fi
echo "Scale validate: OK"
exit 0
