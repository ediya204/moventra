DROP TABLE IF EXISTS mg_settings;
DROP INDEX IF EXISTS mg_audit_action_time;
DELETE FROM schema_migrations WHERE version=4;
