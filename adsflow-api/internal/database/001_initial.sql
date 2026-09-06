CREATE TABLE users (
    id uuid PRIMARY KEY,
    firebase_uid text NOT NULL UNIQUE,
    display_name text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at timestamptz NOT NULL DEFAULT now()
);
-- A customer is a business subject, not an authentication identity.
CREATE TABLE customers (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('personal','business')),
    name text NOT NULL,
    personal_owner_id uuid REFERENCES users(id),
    onboarding_status text NOT NULL DEFAULT 'draft' CHECK (onboarding_status IN ('draft','submitted','approved','rejected')),
    service_status text NOT NULL DEFAULT 'inactive' CHECK (service_status IN ('inactive','active','suspended')),
    UNIQUE(id,kind),
    UNIQUE(personal_owner_id),
    CHECK ((kind='personal' AND personal_owner_id IS NOT NULL) OR (kind='business' AND personal_owner_id IS NULL))
);
-- Personal ownership is on customers. Memberships are business-only.
CREATE TABLE memberships (
    customer_id uuid NOT NULL,
    customer_kind text NOT NULL DEFAULT 'business' CHECK (customer_kind='business'),
    user_id uuid NOT NULL REFERENCES users(id),
    role text NOT NULL CHECK (role IN ('owner','admin','viewer')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
    PRIMARY KEY(customer_id,user_id),
    FOREIGN KEY(customer_id,customer_kind) REFERENCES customers(id,kind)
);
CREATE TABLE staff_grants (
    user_id uuid NOT NULL REFERENCES users(id),
    customer_id uuid NOT NULL REFERENCES customers(id),
    permission text NOT NULL CHECK (permission IN ('accounts:read','transactions:read')),
    PRIMARY KEY(user_id,customer_id,permission)
);
CREATE TABLE accounts (
    id uuid PRIMARY KEY,
    customer_id uuid NOT NULL REFERENCES customers(id),
    parent_id uuid,
    name text NOT NULL,
    status text NOT NULL CHECK (status IN ('active','frozen','closed')),
    UNIQUE(customer_id,id),
    FOREIGN KEY(customer_id,parent_id) REFERENCES accounts(customer_id,id),
    CHECK(parent_id IS NULL OR parent_id <> id)
);
-- Query projection only: not a ledger and never the source for spending decisions.
CREATE TABLE transactions (
    id uuid PRIMARY KEY,
    customer_id uuid NOT NULL,
    account_id uuid NOT NULL,
    currency text NOT NULL CHECK (currency IN ('USD','USDT')),
    amount_minor bigint NOT NULL CHECK(amount_minor > 0),
    direction text NOT NULL CHECK(direction IN ('debit','credit')),
    status text NOT NULL CHECK(status IN ('pending','succeeded','failed')),
    occurred_at timestamptz NOT NULL,
    source text NOT NULL,
    external_id text NOT NULL,
    UNIQUE(source,external_id),
    FOREIGN KEY(customer_id,account_id) REFERENCES accounts(customer_id,id)
);
CREATE INDEX transactions_customer_time ON transactions(customer_id,occurred_at DESC,id DESC);
CREATE TABLE audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES users(id),
    customer_id uuid NOT NULL REFERENCES customers(id),
    action text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- Upgrading links subjects instead of relabelling historical personal assets.
CREATE TABLE business_upgrade_requests (
    id uuid PRIMARY KEY,
    personal_customer_id uuid NOT NULL,
    personal_kind text NOT NULL DEFAULT 'personal' CHECK(personal_kind='personal'),
    requested_by uuid NOT NULL REFERENCES users(id),
    legal_name text NOT NULL CHECK(length(legal_name) BETWEEN 1 AND 200),
    status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected')),
    business_customer_id uuid,
    business_kind text NOT NULL DEFAULT 'business' CHECK(business_kind='business'),
    idempotency_key uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_by uuid REFERENCES users(id),
    reviewed_at timestamptz,
    FOREIGN KEY(personal_customer_id,personal_kind) REFERENCES customers(id,kind),
    FOREIGN KEY(business_customer_id,business_kind) REFERENCES customers(id,kind),
    UNIQUE(requested_by,idempotency_key),
    CHECK((status='approved' AND business_customer_id IS NOT NULL) OR (status<>'approved' AND business_customer_id IS NULL)),
    CHECK((status='submitted' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status<>'submitted' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_open_upgrade ON business_upgrade_requests(personal_customer_id) WHERE status IN ('submitted','approved');
