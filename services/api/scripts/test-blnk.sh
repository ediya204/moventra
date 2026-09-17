#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Fresh Compose project + volumes and a fresh local application test database.
# Requires local PostgreSQL (/tmp), Docker, Go and curl. No application DB reused.
task_project="moventra-blnk-test-$(date +%s)-${RANDOM}"
task_compose="../../deploy/blnk/compose.yaml"
export BLNK_LOCAL_PORT="${BLNK_LOCAL_PORT:-5502}"
trap 'docker compose -p "$task_project" -f "$task_compose" down -v >/dev/null 2>&1' EXIT
docker compose -p "$task_project" -f "$task_compose" up -d --wait --wait-timeout 60
export BLNK_TEST_URL="http://127.0.0.1:${BLNK_LOCAL_PORT}"
# Public local fixture key in blnk.local.json, never a deployed credential.
export BLNK_TEST_KEY="moventra-local-shadow-only"
for task_attempt in {1..30}; do
  if curl -fsS --max-time 2 -H "X-blnk-key: ${BLNK_TEST_KEY}" "${BLNK_TEST_URL}/ledgers/general_ledger_id" >/dev/null 2>&1; then
    bash scripts/test-postgres.sh
    exit 0
  fi
  sleep 1
done
printf '%s\n' 'Local Blnk did not become ready' >&2
exit 1
