#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Synthetic local databases only. No app database or environment URL is read.
task_source="moventra_test_backup_$(date +%s)_${RANDOM}"
task_target="${task_source}_restore"
task_dir=$(mktemp -d /tmp/moventra-restore.XXXXXX)
task_source_created=false
task_target_created=false
cleanup() {
  if "$task_target_created"; then dropdb -h /tmp "$task_target"; fi
  if "$task_source_created"; then dropdb -h /tmp "$task_source"; fi
  rm -rf "$task_dir"
}
trap cleanup EXIT
createdb -h /tmp "$task_source"
task_source_created=true
createdb -h /tmp "$task_target"
task_target_created=true
task_source_url="postgresql:///${task_source}?host=/tmp"
task_target_url="postgresql:///${task_target}?host=/tmp"
DATABASE_URL="$task_source_url" go run ./cmd/api migrate
psql -X -v ON_ERROR_STOP=1 --dbname="$task_source_url" <<'SQL'
INSERT INTO customers(id,kind,name) VALUES('11111111-1111-4111-8111-111111111111','business','Synthetic restore');
INSERT INTO ledger_accounts(id,namespace,customer_id,account_key,kind,currency,scale) VALUES
('22222222-2222-4222-8222-222222222222','shadow_restore','11111111-1111-4111-8111-111111111111','clearing','clearing','USDT',6),
('33333333-3333-4333-8333-333333333333','shadow_restore','11111111-1111-4111-8111-111111111111','wallet','wallet','USDT',6);
INSERT INTO ledger_operations(id,namespace,customer_id,effect_key,kind,source_id,destination_id,amount_minor,currency,scale,state,evidence_ref) VALUES
('44444444-4444-4444-8444-444444444444','shadow_restore','11111111-1111-4111-8111-111111111111','synthetic-applied','wallet_credit','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',9007199254740993,'USDT',6,'applied','synthetic/evidence'),
('55555555-5555-4555-8555-555555555555','shadow_restore','11111111-1111-4111-8111-111111111111','synthetic-pending','wallet_credit','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',1,'USDT',6,'pending','synthetic/pending');
INSERT INTO ledger_evidence(operation_id,evidence_ref) VALUES('44444444-4444-4444-8444-444444444444','synthetic/evidence');
INSERT INTO ledger_journal(operation_id,phase,blnk_reference,blnk_transaction_id,source_id,destination_id,amount_minor) VALUES('44444444-4444-4444-8444-444444444444','post','synthetic-fixed-reference','synthetic-not-a-real-blnk-transaction','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',9007199254740993);
INSERT INTO ledger_audit(operation_id,state,evidence_ref) VALUES('44444444-4444-4444-8444-444444444444','applied','synthetic/evidence');
SQL
pg_dump --format=custom --no-owner --no-privileges --dbname="$task_source_url" --file="$task_dir/backup.dump"
(cd "$task_dir" && shasum -a 256 backup.dump > backup.sha256 && shasum -a 256 -c backup.sha256)
pg_restore --exit-on-error --no-owner --no-privileges --dbname="$task_target_url" "$task_dir/backup.dump"
# Verify all rows in every public table, including migration checksums and audit.
psql -X -At -v ON_ERROR_STOP=1 --dbname="$task_source_url" -c "SELECT format('SELECT %L || row_to_json(t)::text FROM %I t ORDER BY row_to_json(t)::text;', tablename || ':', tablename) FROM pg_tables WHERE schemaname='public' ORDER BY tablename" > "$task_dir/compare.sql"
psql -X -At -v ON_ERROR_STOP=1 --dbname="$task_source_url" -f "$task_dir/compare.sql" > "$task_dir/source.rows"
psql -X -At -v ON_ERROR_STOP=1 --dbname="$task_target_url" -f "$task_dir/compare.sql" > "$task_dir/restored.rows"
cmp "$task_dir/source.rows" "$task_dir/restored.rows"
# Explicit migration replay checks the restored checksums without changing rows.
DATABASE_URL="$task_target_url" go run ./cmd/api migrate
if psql -X -v ON_ERROR_STOP=1 --dbname="$task_target_url" -c "DELETE FROM ledger_journal" > "$task_dir/immutable.log" 2>&1; then
  echo 'FAIL: restored audit immutability lost' >&2
  exit 1
fi
# Check that the expected guard, rather than an unrelated error, rejected deletion.
rg -q 'ledger evidence is append-only' "$task_dir/immutable.log"
echo 'PASS: synthetic local backup checksum, full-row restore, migration replay and immutable journal'
echo 'Blnk storage and production recovery were not exercised; no worker was started.'
