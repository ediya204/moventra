-- Stop the Demo server and back up first. Only this module is removed.
DROP TRIGGER IF EXISTS ca_entries_immutable_update;
DROP TRIGGER IF EXISTS ca_entries_immutable_delete;
DROP TABLE IF EXISTS ca_audit;
DROP TABLE IF EXISTS ca_jobs;
DROP TABLE IF EXISTS ca_holds;
DROP TABLE IF EXISTS ca_entries;
DROP TABLE IF EXISTS ca_journals;
DROP TABLE IF EXISTS ca_operations;
DROP TABLE IF EXISTS ca_accounts;
DROP TABLE IF EXISTS ca_cards;
DROP TABLE IF EXISTS ca_principals;
DELETE FROM schema_migrations WHERE version=9;
