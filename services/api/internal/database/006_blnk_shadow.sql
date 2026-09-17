-- Explicit opt-in shadow integration. No existing accounts/balances are migrated.
CREATE TABLE ledger_accounts (
 id uuid PRIMARY KEY,
 namespace text NOT NULL CHECK(namespace ~ '^shadow_[a-z0-9_]{1,48}$'),
 customer_id uuid NOT NULL REFERENCES customers(id),
 account_key text NOT NULL CHECK(length(account_key) BETWEEN 1 AND 180),
 kind text NOT NULL CHECK(kind IN ('wallet','card','transit','clearing')),
 currency text NOT NULL CHECK(currency IN ('USD','USDT')),
 scale integer NOT NULL CHECK((currency='USD' AND scale=2) OR (currency='USDT' AND scale=6)),
 connection_id text NOT NULL DEFAULT '',
 external_card_id text NOT NULL DEFAULT '',
 blnk_balance_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(namespace,customer_id,account_key),
 UNIQUE(namespace,customer_id,id),
 CHECK((kind IN ('card','transit') AND connection_id<>'' AND external_card_id<>'' AND currency='USD') OR (kind IN ('wallet','clearing') AND connection_id='' AND external_card_id=''))
);
CREATE UNIQUE INDEX ledger_one_wallet ON ledger_accounts(namespace,customer_id,currency,kind) WHERE kind IN ('wallet','clearing');
CREATE UNIQUE INDEX ledger_card_owner ON ledger_accounts(namespace,connection_id,external_card_id,kind,currency) WHERE kind IN ('card','transit');
CREATE TABLE ledger_operations (
 id uuid PRIMARY KEY,
 namespace text NOT NULL,
 customer_id uuid NOT NULL REFERENCES customers(id),
 effect_key text NOT NULL CHECK(length(effect_key) BETWEEN 1 AND 300),
 kind text NOT NULL CHECK(kind IN ('wallet_credit','card_settlement','card_refund','wallet_to_card')),
 source_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 transit_id uuid,
 amount_minor numeric(38,0) NOT NULL CHECK(amount_minor>0),
 currency text NOT NULL,
 scale integer NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','awaiting_provider','provider_unknown','commit_pending','release_pending','applied','released','rejected','review_required')),
 evidence_ref text NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 300),
 decision_ref text NOT NULL DEFAULT '',
 last_error text NOT NULL DEFAULT '',
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(namespace,effect_key),
 FOREIGN KEY(namespace,customer_id,source_id) REFERENCES ledger_accounts(namespace,customer_id,id),
 FOREIGN KEY(namespace,customer_id,destination_id) REFERENCES ledger_accounts(namespace,customer_id,id),
 FOREIGN KEY(namespace,customer_id,transit_id) REFERENCES ledger_accounts(namespace,customer_id,id),
 CHECK(source_id<>destination_id),
 CHECK((kind='wallet_to_card')=(transit_id IS NOT NULL))
);
CREATE INDEX ledger_work ON ledger_operations(namespace,next_attempt_at,created_at) WHERE state IN ('pending','commit_pending','release_pending');
CREATE TABLE ledger_evidence (
 operation_id uuid NOT NULL REFERENCES ledger_operations(id),
 evidence_ref text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(operation_id,evidence_ref)
);
CREATE TABLE ledger_journal (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 operation_id uuid NOT NULL REFERENCES ledger_operations(id),
 phase text NOT NULL,
 blnk_reference text NOT NULL UNIQUE,
 blnk_transaction_id text NOT NULL UNIQUE,
 source_id uuid NOT NULL REFERENCES ledger_accounts(id),
 destination_id uuid NOT NULL REFERENCES ledger_accounts(id),
 amount_minor numeric(38,0) NOT NULL CHECK(amount_minor>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(operation_id,phase)
);
CREATE TABLE ledger_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 operation_id uuid NOT NULL REFERENCES ledger_operations(id),
 state text NOT NULL,
 evidence_ref text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ledger_read_grants (
 user_id uuid NOT NULL REFERENCES users(id),
 customer_id uuid NOT NULL REFERENCES customers(id),
 PRIMARY KEY(user_id,customer_id)
);
-- Explicit token contract/network allowlist. Empty until locally configured.
CREATE TABLE ledger_crypto_assets (
 namespace text NOT NULL CHECK(namespace ~ '^shadow_[a-z0-9_]{1,48}$'),
 network text NOT NULL,
 asset_id text NOT NULL,
 currency text NOT NULL CHECK(currency='USDT'),
 scale integer NOT NULL CHECK(scale=6),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,network,asset_id)
);
-- Accounting evidence is append-only, including when an operation needs repair.
CREATE FUNCTION ledger_immutable_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger evidence is append-only'; END $$;
CREATE TRIGGER ledger_journal_immutable BEFORE UPDATE OR DELETE ON ledger_journal FOR EACH ROW EXECUTE FUNCTION ledger_immutable_journal();
CREATE TRIGGER ledger_evidence_immutable BEFORE UPDATE OR DELETE ON ledger_evidence FOR EACH ROW EXECUTE FUNCTION ledger_immutable_journal();
CREATE TRIGGER ledger_audit_immutable BEFORE UPDATE OR DELETE ON ledger_audit FOR EACH ROW EXECUTE FUNCTION ledger_immutable_journal();
