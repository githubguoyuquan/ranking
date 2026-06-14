#!/usr/bin/env bash
# Quarterly DR drill orchestrator — readiness + outbox plan + scale validate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE="${RANKING_API_BASE:-http://127.0.0.1:3000}"
KEY="${RANKING_API_KEY:-}"
MIN_STATUS="${DR_DRILL_MIN_STATUS:-warn}"
REPORT="${DR_DRILL_REPORT:-dr-drill-$(date +%Y%m%dT%H%M%S).json}"

usage() {
  cat <<'EOF'
Usage: dr-quarterly-drill.sh

  RANKING_API_BASE        API origin
  RANKING_API_KEY         Admin API key
  DR_DRILL_MIN_STATUS     ok | warn (default warn)
  DR_DRILL_REPORT         Output JSON path

Runs:
  1. GET /admin/ops/dr/readiness
  2. GET /admin/ops/dr/outbox-replay-plan
  3. GET /admin/ops/k8s/probes
  4. POST /admin/scale/validate

Exit codes: 0 ok, 1 warn (accepted if min=warn), 2 critical, 3 unreachable
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 64 ;;
  esac
done

if [[ -z "$KEY" ]]; then
  echo "RANKING_API_KEY required" >&2
  exit 1
fi

headers=(-H "X-API-Key: $KEY")

fetch() {
  local method="$1"
  local path="$2"
  local url="${BASE%/}${path}"
  if [[ "$method" == "GET" ]]; then
    curl -fsS "${headers[@]}" "$url"
  else
    curl -fsS -X POST "${headers[@]}" -H "Content-Type: application/json" -d '{}' "$url"
  fi
}

echo "Quarterly DR drill → $BASE"
echo "Report: $REPORT"

readiness="$(fetch GET /admin/ops/dr/readiness || echo '{"status":"critical","error":"unreachable"}')"
outbox="$(fetch GET /admin/ops/dr/outbox-replay-plan || echo '{"error":"unreachable"}')"
probes="$(fetch GET /admin/ops/k8s/probes || echo '{"error":"unreachable"}')"
scale="$(fetch POST /admin/scale/validate || echo '{"status":"critical","error":"unreachable"}')"

node -e "
  const fs = require('fs');
  const report = {
    generatedAt: new Date().toISOString(),
    apiBase: process.argv[1],
    readiness: JSON.parse(process.argv[2]),
    outboxReplayPlan: JSON.parse(process.argv[3]),
    k8sProbes: JSON.parse(process.argv[4]),
    scaleValidate: JSON.parse(process.argv[5]),
  };
  const statuses = [report.readiness.status, report.scaleValidate.status].filter(Boolean);
  report.overallStatus = statuses.includes('critical')
    ? 'critical'
    : statuses.includes('warn')
      ? 'warn'
      : 'ok';
  fs.writeFileSync(process.argv[6], JSON.stringify(report, null, 2));
  process.stdout.write(report.overallStatus);
" "$BASE" "$readiness" "$outbox" "$probes" "$scale" "$REPORT"

overall="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).overallStatus)" "$REPORT")"
echo "Overall: $overall (saved $REPORT)"

if [[ "$overall" == "critical" ]]; then
  # shellcheck source=/dev/null
  source "$ROOT/scripts/dr-alert-on-failure.sh"
  send_probe_failure_alert "ranking-dr-quarterly-drill" "critical" "Quarterly DR drill critical — see $REPORT"
  exit 2
fi
if [[ "$overall" == "warn" ]]; then
  if [[ "$MIN_STATUS" == "warn" ]]; then
    exit 0
  fi
  # shellcheck source=/dev/null
  source "$ROOT/scripts/dr-alert-on-failure.sh"
  send_probe_failure_alert "ranking-dr-quarterly-drill" "warn" "Quarterly DR drill warn — see $REPORT"
  exit 1
fi
exit 0
