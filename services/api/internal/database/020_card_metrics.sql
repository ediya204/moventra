-- Read-only source analytics. None of these tables is a money ledger.
CREATE TABLE card_metric_scopes (
 connection_id text NOT NULL REFERENCES channel_connections(id),
 external_card_id text NOT NULL,
 customer_id uuid NOT NULL REFERENCES customers(id),
 account_ref text NOT NULL,
 virtual_account_ref text NOT NULL,
 binding_created_at timestamptz NOT NULL,
 enrolled_at timestamptz NOT NULL DEFAULT now(),
 enabled boolean NOT NULL DEFAULT true,
 PRIMARY KEY(connection_id,external_card_id)
);
CREATE TABLE card_metric_runs (
 id uuid PRIMARY KEY,
 connection_id text NOT NULL,
 external_card_id text NOT NULL,
 from_at timestamptz NOT NULL,
 to_at timestamptz NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('recent','history','manual','handoff')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','done','review')),
 cursor text NOT NULL DEFAULT '',
 seen_cursors text[] NOT NULL DEFAULT '{}',
 pages integer NOT NULL DEFAULT 0,
 record_count integer NOT NULL DEFAULT 0,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt timestamptz NOT NULL DEFAULT now(),
 last_error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 FOREIGN KEY(connection_id,external_card_id) REFERENCES card_metric_scopes,
 CHECK(from_at < to_at)
);
CREATE UNIQUE INDEX card_metric_one_run ON card_metric_runs(connection_id,external_card_id,purpose) WHERE state='queued';
CREATE INDEX card_metric_due ON card_metric_runs(next_attempt) WHERE state='queued';
CREATE TABLE card_source_transactions (
 connection_id text NOT NULL REFERENCES channel_connections(id),
 external_id text NOT NULL,
 external_card_id text NOT NULL,
 account_ref text NOT NULL,
 virtual_account_ref text NOT NULL,
 amount_minor numeric(38,0) NOT NULL,
 source_date timestamptz NOT NULL,
 status text NOT NULL,
 detailed_status text NOT NULL,
 category_verified boolean NOT NULL DEFAULT false,
 data jsonb NOT NULL,
 observed_at timestamptz NOT NULL,
 PRIMARY KEY(connection_id,external_id)
);
CREATE INDEX card_source_window ON card_source_transactions(connection_id,external_card_id,source_date);
CREATE TABLE card_metric_observations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 connection_id text NOT NULL,
 external_card_id text NOT NULL,
 resource_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('transaction','utilization')),
 evidence text NOT NULL,
 payload jsonb NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE card_utilization_snapshots (
 connection_id text NOT NULL,
 external_card_id text NOT NULL,
 available_minor numeric(38,0),
 spend_minor numeric(38,0) NOT NULL,
 currency text NOT NULL CHECK(currency='USD'),
 next_reset_at timestamptz,
 rules jsonb NOT NULL,
 collected_at timestamptz NOT NULL,
 PRIMARY KEY(connection_id,external_card_id),
 FOREIGN KEY(connection_id,external_card_id) REFERENCES card_metric_scopes
);
-- Keep original snapshot reads intact; only the current authorized view overlays
-- new transactions. Imports cannot replace a newer webhook observation.
ALTER VIEW channel_current_records RENAME TO channel_state_records;
CREATE VIEW channel_current_records AS
SELECT r.connection_id,r.revision,r.kind,r.external_id,r.data
FROM channel_state_records r
WHERE NOT EXISTS(SELECT 1 FROM card_source_transactions t JOIN channel_connections c ON c.id=t.connection_id
 WHERE r.kind='transaction' AND r.connection_id=t.connection_id AND r.revision=c.revision AND r.external_id=t.external_id)
UNION ALL
SELECT t.connection_id,c.revision,'transaction',t.external_id,t.data || jsonb_build_object('metricCategory',CASE WHEN t.category_verified THEN 'card' ELSE 'unknown' END)
FROM card_source_transactions t JOIN channel_connections c ON c.id=t.connection_id;

CREATE TABLE card_metric_refreshes (
 connection_id text NOT NULL,
 external_card_id text NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(connection_id,external_card_id),
 FOREIGN KEY(connection_id,external_card_id) REFERENCES card_metric_scopes
);
