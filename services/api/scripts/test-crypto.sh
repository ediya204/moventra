#!/usr/bin/env bash
# Uses only a new disposable local PostgreSQL database. Never reads dotenv.
set -euo pipefail
cd "$(dirname "$0")/.."
crypto_db="moventra_test_crypto_$(date +%s)_$$"
createdb -h /tmp "$crypto_db"
trap 'dropdb -h /tmp "$crypto_db"' EXIT
export TEST_DATABASE_URL="postgresql:///$crypto_db?host=/tmp"
if [[ -n "${BLNK_TEST_URL:-}" ]]; then
  go test -count=1 -race -run TestCryptoFundsLifecycle ./internal/api
else
  go test -count=1 -race ./internal/api ./internal/cryptofunds ./internal/cregis ./internal/tron ./internal/ethereum
fi
