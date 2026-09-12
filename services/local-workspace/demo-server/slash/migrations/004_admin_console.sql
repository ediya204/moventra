-- Local management presentation settings only; no financial or permission policy.
CREATE TABLE IF NOT EXISTS mg_settings (
 namespace TEXT PRIMARY KEY REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 workspace_name TEXT NOT NULL DEFAULT '管理总后台',
 notice TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mg_audit_action_time ON mg_audit(namespace,action,created_at);
