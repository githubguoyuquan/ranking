#!/usr/bin/env bash
# On-call alert summary: Outbox/crawl + trend anomalies.
set -euo pipefail

BASE="${RANKING_API_BASE:-http://127.0.0.1:3000}"
KEY="${RANKING_API_KEY:-}"
MIN_STATUS="${ALERT_SUMMARY_MIN_STATUS:-ok}"
WAIT_SEC="${ALERT_SUMMARY_WAIT_SEC:-0}"

usage() {
  cat <<'EOF'
Usage: alert-summary.sh [options]

  RANKING_API_BASE           API origin (default http://127.0.0.1:3000)
  RANKING_API_KEY            Admin API key (X-API-Key)
  ALERT_SUMMARY_MIN_STATUS   ok (default) | warn
  ALERT_SUMMARY_WAIT_SEC     Retry seconds until API is up

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

fetch_json() {
  local path="$1"
  curl -fsS "${headers[@]}" "${BASE%/}${path}"
}

deadline=$((SECONDS + WAIT_SEC))
ops_body=""
trends_body=""

while true; do
  if ops_body="$(fetch_json "/admin/observability/summary" 2>/dev/null)" && \
     trends_body="$(fetch_json "/admin/trends/alerts" 2>/dev/null)"; then
    break
  fi
  if (( WAIT_SEC <= 0 || SECONDS >= deadline )); then
    echo "alert-summary: API unreachable at ${BASE}" >&2
    exit 3
  fi
  sleep 2
done

node -e "
const ops = JSON.parse(process.argv[1]);
const trends = JSON.parse(process.argv[2]);
const opsAlerts = (ops.alerts || []).filter(a => a.severity !== 'ok');
const trendAlerts = trends.anomalies || trends.alerts || [];
const rank = s => (s === 'critical' ? 2 : s === 'warn' ? 1 : 0);
const worst = ['ok', ops.status || 'ok', trends.status || 'ok'].sort((a,b) => rank(b)-rank(a))[0];
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  status: worst,
  ops: { status: ops.status, alertCount: opsAlerts.length, alerts: opsAlerts },
  trends: { status: trends.status, alertCount: trendAlerts.length, alerts: trendAlerts.slice(0, 30) },
}, null, 2));
process.exitCode = worst === 'critical' ? 2 : worst === 'warn' ? 1 : 0;
" "$ops_body" "$trends_body"

exit_code=$?
if [[ $exit_code -eq 2 ]]; then
  echo "alert-summary: CRITICAL" >&2
  exit 2
fi
if [[ $exit_code -eq 1 ]]; then
  echo "alert-summary: WARN" >&2
  if [[ "$MIN_STATUS" == "warn" ]]; then
    echo "alert-summary: WARN accepted (ALERT_SUMMARY_MIN_STATUS=warn)"
    exit 0
  fi
  exit 1
fi
echo "alert-summary: OK"
exit 0
