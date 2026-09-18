#!/usr/bin/env python3
"""Emit reviewed 019 migration SQL only; never connect to a database."""
from pathlib import Path
import hashlib
root = Path(__file__).resolve().parents[1] / 'internal/database'
files = sorted(root.glob('[0-9][0-9][0-9]_*.sql'))
assert [int(p.name[:3]) for p in files] == list(range(1, 20))
checks = '\n'.join("IF (SELECT checksum FROM schema_migrations WHERE version=%d) IS DISTINCT FROM '%s' THEN RAISE EXCEPTION 'migration_%d_conflict'; END IF;" % (int(p.name[:3]), hashlib.sha256(p.read_bytes()).hexdigest(), int(p.name[:3])) for p in files[:-1])
sql=files[-1].read_text();digest=hashlib.sha256(files[-1].read_bytes()).hexdigest()
print("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SELECT pg_advisory_xact_lock(73019001);")
print("DO $check$ BEGIN\n"+checks)
print("IF EXISTS(SELECT 1 FROM schema_migrations WHERE version=19) THEN")
print("IF (SELECT checksum FROM schema_migrations WHERE version=19) <> '%s' THEN RAISE EXCEPTION 'migration_19_conflict'; END IF;" % digest)
print("ELSE EXECUTE $payload$"+sql+"$payload$;")
print("INSERT INTO schema_migrations(version,checksum) VALUES(19,'%s'); END IF; END $check$; COMMIT;" % digest)
