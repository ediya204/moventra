DROP TABLE IF EXISTS mg_sessions;
DROP TABLE IF EXISTS mg_audit;
DROP TABLE IF EXISTS mg_resets;
DROP TABLE IF EXISTS mg_accounts;
DROP TABLE IF EXISTS mg_fees;
DROP TABLE IF EXISTS mg_users;
DROP TABLE IF EXISTS mg_groups;
DELETE FROM schema_migrations WHERE version=3;
