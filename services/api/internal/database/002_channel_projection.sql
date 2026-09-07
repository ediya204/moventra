-- Read-only source projection; deliberately separate from customer accounts/ledger.
CREATE TABLE channel_connections (
 id text PRIMARY KEY, account_ref text NOT NULL, label text NOT NULL,
 revision text, source_at timestamptz, imported_at timestamptz
);
CREATE TABLE channel_read_grants (
 connection_id text REFERENCES channel_connections(id), user_id uuid REFERENCES users(id),
 PRIMARY KEY(connection_id,user_id)
);
CREATE TABLE channel_imports (
 connection_id text REFERENCES channel_connections(id), revision text NOT NULL,
 source_at timestamptz NOT NULL, imported_at timestamptz NOT NULL DEFAULT now(),
 actor_id uuid NOT NULL REFERENCES users(id), record_count integer NOT NULL,
 PRIMARY KEY(connection_id,revision)
);
CREATE TABLE channel_records (
 connection_id text NOT NULL, revision text NOT NULL, kind text NOT NULL CHECK(kind IN ('card','transaction')),
 external_id text NOT NULL, data jsonb NOT NULL,
 PRIMARY KEY(connection_id,revision,kind,external_id),
 FOREIGN KEY(connection_id,revision) REFERENCES channel_imports(connection_id,revision)
);
CREATE TABLE channel_read_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 connection_id text NOT NULL REFERENCES channel_connections(id), actor_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL, revision text, created_at timestamptz NOT NULL DEFAULT now()
);
