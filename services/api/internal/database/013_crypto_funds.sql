-- Local shadow only. Existing ledger identities and journal history are preserved.
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_kind_check;
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_check1;
ALTER TABLE ledger_accounts ADD CHECK(kind IN ('wallet','card','transit','clearing','escrow','fee'));
ALTER TABLE ledger_accounts ADD CHECK((kind IN ('card','transit') AND connection_id<>'' AND external_card_id<>'' AND currency='USD') OR (kind IN ('wallet','clearing','escrow','fee') AND connection_id='' AND external_card_id=''));
ALTER TABLE ledger_operations DROP CONSTRAINT ledger_operations_kind_check;
ALTER TABLE ledger_operations ADD CHECK(kind IN ('wallet_credit','card_settlement','card_refund','wallet_to_card','crypto_move'));
CREATE TABLE crypto_settings (
 namespace text PRIMARY KEY CHECK(namespace ~ '^shadow_[a-z0-9_]{1,48}$'),
 revision bigint NOT NULL DEFAULT 1,
 data jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crypto_grants (
 namespace text NOT NULL, customer_id uuid NOT NULL REFERENCES customers(id),
 user_id uuid NOT NULL REFERENCES users(id), permission text NOT NULL CHECK(permission IN ('read','review','configure','recover')),
 PRIMARY KEY(namespace,customer_id,user_id,permission)
);
CREATE TABLE crypto_orders (
 id uuid PRIMARY KEY, namespace text NOT NULL, customer_id uuid NOT NULL REFERENCES customers(id),
 actor_id uuid REFERENCES users(id), kind text NOT NULL CHECK(kind IN ('deposit','withdrawal','otc')),
 state text NOT NULL, revision bigint NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(data->>'state'=state), UNIQUE(namespace,customer_id,id)
);
CREATE INDEX crypto_orders_customer ON crypto_orders(namespace,customer_id,created_at DESC,id);
CREATE INDEX crypto_orders_worker ON crypto_orders(namespace,updated_at) WHERE state IN ('reserving','processing','releasing');
CREATE TABLE crypto_quotes (
 id uuid PRIMARY KEY, namespace text NOT NULL, customer_id uuid NOT NULL REFERENCES customers(id),
 kind text NOT NULL, data jsonb NOT NULL, expires_at timestamptz NOT NULL, used_by uuid REFERENCES crypto_orders(id)
);
CREATE TABLE crypto_commands (
 namespace text NOT NULL, customer_id uuid NOT NULL REFERENCES customers(id), actor_id uuid NOT NULL REFERENCES users(id),
 request_id uuid NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(namespace,customer_id,actor_id,request_id)
);
CREATE TABLE crypto_addresses (
 namespace text NOT NULL, connection_id text NOT NULL, project_id text NOT NULL, network text NOT NULL,
 customer_id uuid NOT NULL REFERENCES customers(id), address text NOT NULL, chain_address text NOT NULL DEFAULT '', mode text NOT NULL CHECK(mode IN ('synthetic','observation')),
 effective_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,connection_id,project_id,network,address), UNIQUE(namespace,customer_id,network,mode)
);
CREATE TABLE crypto_events (
 id uuid PRIMARY KEY, namespace text NOT NULL, connection_id text NOT NULL, project_id text NOT NULL,
 kind text NOT NULL, external_id text NOT NULL, digest text NOT NULL, payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'received', error text NOT NULL DEFAULT '', order_id uuid REFERENCES crypto_orders(id),
 deliveries integer NOT NULL DEFAULT 1, received_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(namespace,connection_id,project_id,kind,external_id,digest)
);
CREATE TABLE crypto_postings (
 namespace text NOT NULL, economic_key text NOT NULL, order_id uuid NOT NULL REFERENCES crypto_orders(id),
 PRIMARY KEY(namespace,economic_key)
);
CREATE TABLE crypto_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, namespace text NOT NULL, customer_id uuid REFERENCES customers(id),
 order_id uuid REFERENCES crypto_orders(id), actor_id uuid REFERENCES users(id), action text NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER crypto_audit_immutable BEFORE UPDATE OR DELETE ON crypto_audit FOR EACH ROW EXECUTE FUNCTION ledger_immutable_journal();
CREATE TABLE crypto_sync (
 namespace text NOT NULL, connection_id text NOT NULL, project_id text NOT NULL, mode text NOT NULL CHECK(mode='observation'),
 page integer NOT NULL DEFAULT 1, generation bigint NOT NULL DEFAULT 1, state text NOT NULL DEFAULT 'queued',
 last_success timestamptz, next_attempt timestamptz NOT NULL DEFAULT now(), error text NOT NULL DEFAULT '',
 PRIMARY KEY(namespace,connection_id,project_id)
);
CREATE TABLE crypto_connection_grants (
 namespace text NOT NULL, connection_id text NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
 permission text NOT NULL CHECK(permission IN ('read','sync')),
 PRIMARY KEY(namespace,connection_id,user_id,permission)
);
CREATE TABLE crypto_chain_proofs (
 event_id uuid PRIMARY KEY REFERENCES crypto_events(id), network text NOT NULL, proof jsonb NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT now()
);
