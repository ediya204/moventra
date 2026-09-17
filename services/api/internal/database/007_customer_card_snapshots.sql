-- Explicit read-only test-data assignment. This is not financial ownership.
CREATE TABLE customer_card_snapshots (
 customer_id uuid NOT NULL REFERENCES customers(id),
 connection_id text NOT NULL,
 revision text NOT NULL,
 target_user_id uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(customer_id,connection_id),
 UNIQUE(customer_id,connection_id,revision),
 FOREIGN KEY(connection_id,revision) REFERENCES channel_imports(connection_id,revision)
);
CREATE TABLE customer_card_bindings (
 connection_id text NOT NULL,
 external_card_id text NOT NULL,
 customer_id uuid NOT NULL,
 revision text NOT NULL,
 kind text NOT NULL DEFAULT 'card' CHECK(kind='card'),
 PRIMARY KEY(connection_id,external_card_id),
 FOREIGN KEY(customer_id,connection_id,revision) REFERENCES customer_card_snapshots(customer_id,connection_id,revision),
 FOREIGN KEY(connection_id,revision,kind,external_card_id) REFERENCES channel_records(connection_id,revision,kind,external_id)
);
CREATE INDEX customer_card_bindings_scope ON customer_card_bindings(customer_id,connection_id,revision);
