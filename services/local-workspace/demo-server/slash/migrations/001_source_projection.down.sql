DROP TABLE IF EXISTS portal_actions;
DROP TABLE IF EXISTS portal_state;
-- Entire local projection only. CLI rollback requires all Demo batches cleaned first.
DROP TABLE IF EXISTS balance_snapshots;
DROP TABLE IF EXISTS internal_adjustments;
DROP TABLE IF EXISTS internal_relations;
DROP TABLE IF EXISTS event_deliveries;
DROP TABLE IF EXISTS source_events;
DROP TABLE IF EXISTS source_versions;
DROP TABLE IF EXISTS source_records;
DROP TABLE IF EXISTS scenarios;
DROP TABLE IF EXISTS demo_batches;
DROP TABLE IF EXISTS schema_migrations;
