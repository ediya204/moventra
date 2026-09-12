-- Local Demo only. Additive source projection; no legacy table is modified.
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS demo_batches(namespace TEXT PRIMARY KEY, seed INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scenarios(
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, expected_net_cents INTEGER NOT NULL,
 expected_hold_cents INTEGER NOT NULL, confirmation TEXT NOT NULL, PRIMARY KEY(namespace,id));
CREATE TABLE IF NOT EXISTS source_records(
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 platform TEXT NOT NULL, entity_id TEXT NOT NULL, source_id TEXT NOT NULL, kind TEXT NOT NULL,
 scenario_id TEXT, source_json TEXT NOT NULL, internal_json TEXT NOT NULL,
 account_id TEXT, virtual_account_id TEXT, card_id TEXT, status TEXT, detailed_status TEXT,
 signed_amount_cents INTEGER, currency TEXT, original_currency TEXT, original_amount_cents INTEGER,
 conversion_rate_decimal TEXT, source_date TEXT, authorized_at TEXT, account_subtype TEXT,
 order_id TEXT, reference_number TEXT, authorization_id TEXT, mcc TEXT,
 version INTEGER NOT NULL, PRIMARY KEY(namespace,platform,entity_id,kind,source_id),
 FOREIGN KEY(namespace,scenario_id) REFERENCES scenarios(namespace,id));
CREATE INDEX IF NOT EXISTS source_transaction_date ON source_records(namespace,kind,source_date,source_id);
CREATE INDEX IF NOT EXISTS source_transaction_card ON source_records(namespace,kind,card_id,source_date);
CREATE INDEX IF NOT EXISTS source_transaction_status ON source_records(namespace,kind,status,detailed_status,source_date);
CREATE INDEX IF NOT EXISTS source_transaction_account ON source_records(namespace,kind,account_id);
CREATE TABLE IF NOT EXISTS source_versions(
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 platform TEXT NOT NULL, entity_id TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL,
 version INTEGER NOT NULL, source_json TEXT NOT NULL, collected_at TEXT NOT NULL,
 PRIMARY KEY(namespace,platform,entity_id,kind,source_id,version));
CREATE TABLE IF NOT EXISTS source_events(
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 entity_id TEXT NOT NULL,event_id TEXT NOT NULL,event TEXT NOT NULL,event_timestamp TEXT NOT NULL,
 source_id TEXT NOT NULL,collected_at TEXT NOT NULL, PRIMARY KEY(namespace,entity_id,event_id));
CREATE INDEX IF NOT EXISTS events_by_transaction ON source_events(namespace,source_id);
CREATE TABLE IF NOT EXISTS event_deliveries(
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 id TEXT NOT NULL,event_id TEXT,source_id TEXT NOT NULL,received_at TEXT NOT NULL,result TEXT NOT NULL,
 PRIMARY KEY(namespace,id));
CREATE TABLE IF NOT EXISTS internal_relations(
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 id TEXT NOT NULL,scenario_id TEXT NOT NULL,from_id TEXT NOT NULL,to_id TEXT NOT NULL,
 relation_type TEXT NOT NULL,evidence TEXT NOT NULL,confirmation TEXT NOT NULL,PRIMARY KEY(namespace,id));
CREATE TABLE IF NOT EXISTS internal_adjustments(
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 id TEXT NOT NULL,scenario_id TEXT NOT NULL,account_id TEXT NOT NULL,source_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL,occurred_at TEXT NOT NULL,reason TEXT NOT NULL,confirmation TEXT NOT NULL,
 PRIMARY KEY(namespace,id));
CREATE TABLE IF NOT EXISTS balance_snapshots(
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 id TEXT NOT NULL,scenario_id TEXT NOT NULL,account_id TEXT NOT NULL,currency TEXT NOT NULL,
 balance_type TEXT NOT NULL,available_cents INTEGER NOT NULL,posted_cents INTEGER NOT NULL,
 timestamp TEXT NOT NULL,step TEXT NOT NULL,PRIMARY KEY(namespace,id));
