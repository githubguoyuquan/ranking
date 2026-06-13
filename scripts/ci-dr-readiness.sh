#!/usr/bin/env bash
# CI: compose 栈 + migrate + 短启 API + dr-readiness.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/ranking?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export KAFKA_BROKERS="${KAFKA_BROKERS:-localhost:19092}"
export KAFKA_SCHEMA_REGISTRY_URL="${KAFKA_SCHEMA_REGISTRY_URL:-http://localhost:18081}"
export API_AUTH_REQUIRED="${API_AUTH_REQUIRED:-false}"
export PRODUCTION_WIRING_REQUIRED="${PRODUCTION_WIRING_REQUIRED:-false}"

echo "Starting postgres, redis, redpanda..."
docker compose up -d postgres redis redpanda

echo "Waiting for postgres..."
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

npm ci
npm run prisma:deploy

echo "Building API..."
npm run build

echo "Starting API in background..."
node dist/main.js &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

export RANKING_API_BASE="${RANKING_API_BASE:-http://127.0.0.1:3000}"
export DR_READINESS_WAIT_SEC="${DR_READINESS_WAIT_SEC:-90}"
export DR_READINESS_MIN_STATUS="${DR_READINESS_MIN_STATUS:-warn}"

bash scripts/dr-readiness.sh --wait="$DR_READINESS_WAIT_SEC" --min-status="$DR_READINESS_MIN_STATUS"
echo "CI DR readiness passed"
