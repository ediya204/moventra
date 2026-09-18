-- Independent message storage. Installing this migration enables no subscriptions.
CREATE TABLE message_namespaces (
 namespace text PRIMARY KEY, otc_enabled boolean NOT NULL DEFAULT false,
 activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE message_grants (
 namespace text NOT NULL REFERENCES message_namespaces(namespace),
 user_id uuid NOT NULL REFERENCES users(id), customer_id uuid NOT NULL REFERENCES customers(id),
 permission text NOT NULL CHECK(permission IN ('read','compose','publish','retry')),
 PRIMARY KEY(namespace,user_id,customer_id,permission)
);
CREATE TABLE message_campaigns (
 id uuid PRIMARY KEY, namespace text NOT NULL REFERENCES message_namespaces(namespace),
 actor_id uuid NOT NULL REFERENCES users(id), title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 80),
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 5000),
 priority text NOT NULL CHECK(priority IN ('normal','high')),
 revision integer NOT NULL DEFAULT 1, state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published')),
 create_key uuid NOT NULL, publish_key uuid, create_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
 UNIQUE(namespace,actor_id,create_key), UNIQUE(namespace,actor_id,publish_key)
);
CREATE TABLE message_campaign_recipients (
 campaign_id uuid NOT NULL REFERENCES message_campaigns(id),
 customer_id uuid NOT NULL REFERENCES customers(id), user_id uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(campaign_id,customer_id,user_id)
);
CREATE TABLE message_jobs (
 id uuid PRIMARY KEY, namespace text NOT NULL REFERENCES message_namespaces(namespace),
 event_key text NOT NULL, customer_id uuid NOT NULL REFERENCES customers(id), user_id uuid NOT NULL REFERENCES users(id),
 campaign_id uuid REFERENCES message_campaigns(id), actor_id uuid REFERENCES users(id),
 category text NOT NULL CHECK(category IN ('otc','letter','system')),
 title text NOT NULL, body text NOT NULL, priority text NOT NULL DEFAULT 'normal',
 facts jsonb NOT NULL DEFAULT '{}', order_id uuid, resource_version bigint, occurred_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivered','failed','skipped')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(namespace,event_key,customer_id,user_id)
);
CREATE INDEX message_jobs_pending ON message_jobs(namespace,next_attempt_at,id) WHERE state='pending';
CREATE INDEX message_jobs_campaign ON message_jobs(campaign_id,customer_id,id);
CREATE TABLE message_inbox_counters (
 namespace text NOT NULL, customer_id uuid NOT NULL REFERENCES customers(id), user_id uuid NOT NULL REFERENCES users(id),
 last_seq bigint NOT NULL DEFAULT 0, PRIMARY KEY(namespace,customer_id,user_id)
);
CREATE TABLE message_inbox (
 id uuid PRIMARY KEY REFERENCES message_jobs(id), namespace text NOT NULL,
 customer_id uuid NOT NULL REFERENCES customers(id), user_id uuid NOT NULL REFERENCES users(id),
 seq bigint NOT NULL, delivered_at timestamptz NOT NULL DEFAULT clock_timestamp(), read_at timestamptz,
 UNIQUE(namespace,customer_id,user_id,seq)
);
CREATE INDEX message_inbox_unread ON message_inbox(namespace,customer_id,user_id,seq DESC) WHERE read_at IS NULL;
CREATE TABLE message_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, namespace text NOT NULL,
 actor_id uuid REFERENCES users(id), campaign_id uuid REFERENCES message_campaigns(id),
 job_id uuid REFERENCES message_jobs(id), action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER message_audit_immutable BEFORE UPDATE OR DELETE ON message_audit FOR EACH ROW EXECUTE FUNCTION ledger_immutable_journal();
-- This outbox trigger sees only committed authoritative order transitions. It
-- never calls a provider or writes balances, and is disabled by default.
CREATE FUNCTION capture_otc_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; headline text; content text; event_name text;
BEGIN
 IF NEW.kind <> 'otc' OR NOT EXISTS(SELECT 1 FROM message_namespaces n WHERE n.namespace=NEW.namespace AND n.otc_enabled AND NEW.created_at>=n.activated_at) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
   IF NEW.state=OLD.state THEN RETURN NEW; END IF;
 END IF;
 IF TG_OP='INSERT' THEN headline:='OTC订单已受理'; event_name:='accepted';
 ELSIF NEW.state='completed' THEN headline:='OTC兑换已完成'; event_name:='completed';
 ELSIF NEW.state='failed' THEN headline:='OTC兑换未完成'; event_name:='failed';
 ELSIF NEW.state='unknown' THEN headline:='OTC订单结果待确认'; event_name:='attention';
 ELSE RETURN NEW; END IF;
 SELECT c.personal_owner_id INTO owner_id FROM customers c JOIN users u ON u.id=c.personal_owner_id WHERE c.id=NEW.customer_id AND c.kind='personal' AND u.status='active' AND u.role='customer';
 IF owner_id IS NULL THEN RETURN NEW; END IF;
 content:=CASE event_name
 WHEN 'completed' THEN '订单已完成兑换，请查看订单中的成交金额、汇率及记账结果。'
 WHEN 'failed' THEN '兑换未完成，资金处理结果以订单详情为准。'
 WHEN 'attention' THEN '订单结果仍待确认，请查看原订单进度，勿重复成交。'
 ELSE '订单已受理，兑换结果尚待确认，请查看订单进度。' END;
 INSERT INTO message_jobs(id,namespace,event_key,customer_id,user_id,category,title,body,facts,order_id,resource_version,occurred_at)
 VALUES(gen_random_uuid(),NEW.namespace,'otc:'||NEW.id||':'||NEW.revision,NEW.customer_id,owner_id,'otc',headline,content,jsonb_build_object('currency',NEW.data->>'currency','amountMinor',NEW.data->>'amountMinor','toCurrency',NEW.data->>'toCurrency','receiveMinor',NEW.data->>'receiveMinor','feeMinor',NEW.data->>'feeMinor','rate',NEW.data->'quote'->>'rate','state',NEW.state),NEW.id,NEW.revision,NEW.updated_at)
 ON CONFLICT(namespace,event_key,customer_id,user_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER crypto_message_outbox AFTER INSERT OR UPDATE ON crypto_orders FOR EACH ROW EXECUTE FUNCTION capture_otc_message();
