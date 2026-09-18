-- Shared provider wallet configuration is not a customer balance or ledger.
CREATE TABLE project_wallets (
 project_key text PRIMARY KEY CHECK(project_key='moventra'),
 connection_id text NOT NULL REFERENCES channel_connections(id),
 account_ref text NOT NULL,
 virtual_account_ref text NOT NULL,
 label text NOT NULL,
 evidence_ref text NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,virtual_account_ref)
);
-- Enrollment supersedes legacy broad snapshot access, without deleting history.
CREATE TABLE project_wallet_customers (
 customer_id uuid PRIMARY KEY REFERENCES customers(id),
 project_key text NOT NULL REFERENCES project_wallets(project_key),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_wallet_cards (
 connection_id text NOT NULL,
 external_card_id text NOT NULL,
 customer_id uuid NOT NULL REFERENCES project_wallet_customers(customer_id),
 virtual_account_ref text NOT NULL,
 evidence_revision text NOT NULL,
 kind text NOT NULL DEFAULT 'card' CHECK(kind='card'),
 actor_id uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(connection_id,external_card_id),
 FOREIGN KEY(connection_id,virtual_account_ref) REFERENCES project_wallets(connection_id,virtual_account_ref),
 FOREIGN KEY(connection_id,evidence_revision,kind,external_card_id) REFERENCES channel_records(connection_id,revision,kind,external_id)
);
CREATE INDEX project_wallet_cards_customer ON project_wallet_cards(customer_id,connection_id);
