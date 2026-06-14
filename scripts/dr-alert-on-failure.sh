#!/usr/bin/env bash
# Post failure alert for DR / scale probes (Slack or PagerDuty via unified webhook).
set -euo pipefail

send_probe_failure_alert() {
  local source="$1"
  local status="$2"
  local detail="$3"

  [[ "${DR_ALERT_ON_FAILURE:-}" == "true" ]] || return 0

  local url="${ALERT_WEBHOOK_URL:-${OBSERVABILITY_ALERT_WEBHOOK_URL:-}}"
  [[ -n "$url" ]] || {
    echo "DR_ALERT_ON_FAILURE=true but ALERT_WEBHOOK_URL unset" >&2
    return 0
  }

  local payload
  if [[ "$url" == *events.pagerduty.com* ]] && [[ -n "${PAGERDUTY_ROUTING_KEY:-}" ]]; then
    payload="$(node -e "
      console.log(JSON.stringify({
        routing_key: process.env.PAGERDUTY_ROUTING_KEY,
        event_action: 'trigger',
        payload: {
          summary: '[' + process.argv[1] + '] ' + process.argv[2],
          severity: process.argv[1] === 'critical' ? 'critical' : 'warning',
          source: process.argv[2],
          custom_details: { detail: process.argv[3] },
        },
      }));
    " "$status" "$source" "$detail")"
  else
    payload="$(node -e "
      console.log(JSON.stringify({
        envelopeVersion: 1,
        source: process.argv[1],
        category: 'ops',
        generatedAt: new Date().toISOString(),
        status: process.argv[2],
        alertCount: 1,
        alerts: [{ code: 'probe_failure', severity: process.argv[2], category: 'ops', message: process.argv[3] }],
      }));
    " "$source" "$status" "$detail")"
  fi

  local headers=(-H "Content-Type: application/json")
  if [[ -n "${ALERT_WEBHOOK_BEARER_TOKEN:-}" ]]; then
    headers+=(-H "Authorization: Bearer ${ALERT_WEBHOOK_BEARER_TOKEN}")
  fi

  curl -fsS -X POST "${headers[@]}" -d "$payload" "$url" >/dev/null \
    && echo "Sent probe failure alert → $source ($status)" \
    || echo "WARN: probe failure alert HTTP error" >&2
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  send_probe_failure_alert "${1:-ranking-probe}" "${2:-critical}" "${3:-probe failed}"
fi
