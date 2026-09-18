-- Additive preparation only; no opening credits and no automatic activation.
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_namespace_check;
ALTER TABLE ledger_accounts ADD CHECK(namespace ~ '^(shadow|live)_[a-z0-9_]{1,48}$');
ALTER TABLE ledger_crypto_assets DROP CONSTRAINT ledger_crypto_assets_namespace_check;
ALTER TABLE ledger_crypto_assets ADD CHECK(namespace ~ '^(shadow|live)_[a-z0-9_]{1,48}$');
ALTER TABLE crypto_settings DROP CONSTRAINT crypto_settings_namespace_check;
ALTER TABLE crypto_settings ADD CHECK(namespace ~ '^(shadow|live)_[a-z0-9_]{1,48}$');
ALTER TABLE crypto_orders DROP CONSTRAINT crypto_orders_kind_check;
ALTER TABLE crypto_orders ADD CHECK(kind IN ('deposit','withdrawal','otc','card_transfer'));
ALTER TABLE crypto_addresses DROP CONSTRAINT crypto_addresses_mode_check;
ALTER TABLE crypto_addresses ADD CHECK(mode IN ('synthetic','observation','live'));
CREATE TABLE funds_address_jobs (
 namespace text NOT NULL,customer_id uuid NOT NULL REFERENCES customers(id),network text NOT NULL CHECK(network IN ('TRC20','ERC20')),
 id uuid NOT NULL UNIQUE,state text NOT NULL DEFAULT 'queued',address text,error text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,customer_id,network)
);
CREATE TABLE funds_provider_requests (
 namespace text NOT NULL,order_id uuid NOT NULL REFERENCES crypto_orders(id),kind text NOT NULL,
 state text NOT NULL,provider_id text,request jsonb NOT NULL,result jsonb,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,order_id,kind)
);
-- A trusted enrollment explicitly certifies zero opening and owned card mapping.
CREATE TABLE funds_cards (
 id uuid PRIMARY KEY,namespace text NOT NULL,customer_id uuid NOT NULL REFERENCES customers(id),
 connection_id text NOT NULL,external_card_id text NOT NULL,name text NOT NULL,last4 text NOT NULL,
 ledger_account_id uuid NOT NULL REFERENCES ledger_accounts(id),enabled boolean NOT NULL DEFAULT false,
 opening_verified boolean NOT NULL DEFAULT false,authorization_complete boolean NOT NULL DEFAULT false,
 held_minor numeric(38,0) NOT NULL DEFAULT 0 CHECK(held_minor>=0),observed_at timestamptz,
 UNIQUE(namespace,connection_id,external_card_id),UNIQUE(namespace,customer_id,id)
);
CREATE INDEX funds_orders_kind_recent ON crypto_orders(namespace,customer_id,kind,created_at DESC,id);
ALTER TABLE funds_cards ADD COLUMN limit_minor numeric(38,0) NOT NULL DEFAULT 0 CHECK(limit_minor>=0);
ALTER TABLE funds_cards ADD COLUMN evidence_ref text NOT NULL DEFAULT '';
