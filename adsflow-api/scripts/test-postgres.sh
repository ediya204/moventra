#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Local socket only. Always create a new database; never reuse application data.
task_db="adsflow_test_$(date +%s)_${RANDOM}"
createdb -h /tmp "$task_db"
trap 'dropdb -h /tmp "$task_db"' EXIT
TEST_DATABASE_URL="postgresql:///${task_db}?host=/tmp" go test -race -count=1 -v ./...
