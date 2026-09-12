-- Local Demo client projection; never modifies Slash source records or legacy business tables.
CREATE TABLE IF NOT EXISTS portal_state(
 namespace TEXT PRIMARY KEY REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 state_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS portal_actions(
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 action_json TEXT NOT NULL,
 record_id TEXT NOT NULL,
 PRIMARY KEY(namespace,request_id)
);
