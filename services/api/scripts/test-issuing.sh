#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Fresh application DB; optional BLNK_TEST_URL must be loopback (checked by Go fixture).
task_db="moventra_test_issuing_$(date +%s)_${RANDOM}"
createdb -h /tmp "$task_db"
trap 'dropdb -h /tmp "$task_db"' EXIT
TEST_DATABASE_URL="postgresql:///${task_db}?host=/tmp" go test -race -count=1 -v ./internal/api ./internal/issuing ./internal/database -run 'TestIssuingFullFlow|TestCardNamePool|TestSlashBoundary|TestIssuingLocalConfig|TestRoleMigration|TestReadyMigrationIntegrity'
