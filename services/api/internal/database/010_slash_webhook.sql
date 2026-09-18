-- Trial notification inbox and read-only observations; no ledger writes.
CREATE TABLE slash_hook_connections (
 id text PRIMARY KEY, account_ref text NOT NULL, endpoint text NOT NULL UNIQUE,
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE slash_hook_events (
 connection_id text NOT NULL REFERENCES slash_hook_connections(id), event_id text NOT NULL,
 event_type text NOT NULL, entity_id text NOT NULL, event_at timestamptz NOT NULL,
 kind text NOT NULL, state text NOT NULL CHECK(state IN ('queued','done','ignored','review')),
 deliveries integer NOT NULL DEFAULT 1, attempts integer NOT NULL DEFAULT 0,
 next_attempt timestamptz NOT NULL DEFAULT now(), last_error text NOT NULL DEFAULT '',
 received_at timestamptz NOT NULL DEFAULT now(), last_received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(connection_id,event_id)
);
CREATE TABLE slash_hook_deliveries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 connection_id text NOT NULL, event_id text NOT NULL, digest text NOT NULL,
 conflict boolean NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(connection_id,event_id) REFERENCES slash_hook_events(connection_id,event_id)
);
CREATE TABLE slash_hook_observations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, connection_id text NOT NULL,
 event_id text NOT NULL, kind text NOT NULL, entity_id text NOT NULL,
 payload jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,event_id),
 FOREIGN KEY(connection_id,event_id) REFERENCES slash_hook_events(connection_id,event_id)
);
CREATE INDEX slash_hook_pending ON slash_hook_events(next_attempt) WHERE state='queued';
