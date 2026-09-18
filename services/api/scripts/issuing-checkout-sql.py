#!/usr/bin/env python3
"""Emit only migration 014, guarded by the deployed dependency checksums.

This generator does not connect to a database. Review/save its stdout and run
with psql -X -v ON_ERROR_STOP=1 after backup and restore verification.
"""
from hashlib import sha256
from pathlib import Path


def migration_sql():
    root = Path(__file__).resolve().parents[1] / "internal/database"
    dependencies = []
    for version in range(1, 13):
        paths = list(root.glob(f"{version:03d}_*.sql"))
        if len(paths) != 1:
            raise ValueError(f"ambiguous dependency {version}")
        dependencies.append((version, sha256(paths[0].read_bytes()).hexdigest()))
    body = (root / "014_issuing_checkout.sql").read_text()
    digest = sha256(body.encode()).hexdigest()
    expected = ",\n".join(f"({version}, '{value}')" for version, value in dependencies)
    # No values originate from external input. Dollar delimiters are checked to
    # keep the reviewed DDL intact if its content changes in the future.
    if "$checkout_ddl$" in body or "$checkout_guard$" in body:
        raise ValueError("migration delimiter collision")
    return f"""-- Target: Moventra issuing checkout 014 only. No worker activation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(73019001);
DO $checkout_guard$
DECLARE dep record; actual text;
BEGIN
  FOR dep IN SELECT * FROM (VALUES
{expected}
  ) AS expected(version, checksum) LOOP
    SELECT checksum INTO actual FROM schema_migrations WHERE version=dep.version;
    IF actual IS NULL AND dep.version=6 THEN CONTINUE; END IF;
    IF actual IS DISTINCT FROM dep.checksum THEN
      RAISE EXCEPTION 'existing migration % missing or mismatched', dep.version;
    END IF;
  END LOOP;
  SELECT checksum INTO actual FROM schema_migrations WHERE version=14;
  IF actual IS NOT NULL THEN
    IF actual <> '{digest}' THEN RAISE EXCEPTION 'migration 14 conflict'; END IF;
  ELSE
    EXECUTE $checkout_ddl${body}$checkout_ddl$;
    INSERT INTO schema_migrations(version,checksum) VALUES(14,'{digest}');
  END IF;
END $checkout_guard$;
COMMIT;
SELECT version,checksum FROM schema_migrations WHERE version=14;
"""


if __name__ == "__main__":
    print(migration_sql(), end="")
