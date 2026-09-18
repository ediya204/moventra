#!/usr/bin/env python3
"""Targeted migration regression; creates only a fresh local socket database."""
import importlib.util
import subprocess
import uuid
from hashlib import sha256
from pathlib import Path

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("checkout_sql", Path(__file__).with_name("issuing-checkout-sql.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
database = "moventra_test_checkout_" + uuid.uuid4().hex


def sql(statement, success=True):
    result = subprocess.run(
        ["psql", "-h", "/tmp", "-d", database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
        input=statement, text=True, capture_output=True,
    )
    if (result.returncode == 0) != success:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


subprocess.run(["createdb", "-h", "/tmp", database], check=True)
try:
    sql("CREATE TABLE schema_migrations(version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now());")
    for version in range(1, 13):
        if version == 6:
            continue
        path = next((root / "internal/database").glob(f"{version:03d}_*.sql"))
        content = path.read_text()
        sql(content + f"\nINSERT INTO schema_migrations(version,checksum) VALUES({version},'{sha256(content.encode()).hexdigest()}');")
    migration = module.migration_sql()
    sql("UPDATE schema_migrations SET checksum='corrupt' WHERE version=12;")
    sql(migration, success=False)
    assert sql("SELECT to_regclass('issuing_consents') IS NULL;") == "t"
    path = next((root / "internal/database").glob("012_*.sql"))
    sql(f"UPDATE schema_migrations SET checksum='{sha256(path.read_bytes()).hexdigest()}' WHERE version=12;")
    sql(migration)
    stamp = sql("SELECT applied_at FROM schema_migrations WHERE version=14;")
    sql(migration)
    assert stamp == sql("SELECT applied_at FROM schema_migrations WHERE version=14;")
    assert sql("SELECT count(*) FROM schema_migrations WHERE version IN (6,13,15);") == "0"
    assert sql("SELECT count(*) FROM issuing_consents;") == "0"
    assert sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND ((table_name='issuing_orders' AND column_name='retry_count') OR (table_name='issuing_quotes' AND column_name='terms_version'));") == "2"
    sql("UPDATE schema_migrations SET checksum='conflict' WHERE version=14;")
    sql(migration, success=False)
    print("PASS: dependency mismatch rollback, additive schema, repeat idempotency, target checksum conflict, unrelated migrations excluded")
finally:
    subprocess.run(["dropdb", "-h", "/tmp", database], check=True)
