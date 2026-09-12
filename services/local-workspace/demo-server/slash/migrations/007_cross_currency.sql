-- Isolated precise read projection. Never an executable wallet ledger.
CREATE TABLE IF NOT EXISTS fx_records (
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,
 id TEXT NOT NULL,connection_id TEXT NOT NULL,entity_id TEXT NOT NULL,source_id TEXT NOT NULL,platform TEXT NOT NULL,
 scenario TEXT NOT NULL,source_json TEXT NOT NULL,internal_json TEXT NOT NULL,
 account_id TEXT,card_id TEXT,account_currency TEXT,account_scale INTEGER,amount_minor TEXT,
 original_currency TEXT,original_scale INTEGER,original_minor TEXT,provider_rate TEXT,
 status TEXT,detailed_status TEXT,category TEXT NOT NULL,balance_type TEXT NOT NULL,
 source_date TEXT,authorized_at TEXT,posted_at TEXT,collected_at TEXT NOT NULL,
 request_seq INTEGER NOT NULL DEFAULT 0,applied_seq INTEGER NOT NULL DEFAULT 0,sync_state TEXT NOT NULL DEFAULT 'current',
 PRIMARY KEY(namespace,id),UNIQUE(namespace,connection_id,entity_id,source_id)
);
CREATE INDEX IF NOT EXISTS fx_query ON fx_records(namespace,posted_at,id);
CREATE INDEX IF NOT EXISTS fx_card ON fx_records(namespace,card_id,posted_at);
CREATE INDEX IF NOT EXISTS fx_currency_status ON fx_records(namespace,original_currency,status,posted_at);
CREATE TABLE IF NOT EXISTS fx_observations (
 namespace TEXT NOT NULL,record_id TEXT NOT NULL,request_seq INTEGER NOT NULL,source_json TEXT NOT NULL,collected_at TEXT NOT NULL,result TEXT NOT NULL,
 PRIMARY KEY(namespace,record_id,request_seq),FOREIGN KEY(namespace,record_id) REFERENCES fx_records(namespace,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS fx_relations (
 namespace TEXT NOT NULL,child_id TEXT NOT NULL,parent_id TEXT NOT NULL,kind TEXT NOT NULL,confirmation TEXT NOT NULL,evidence TEXT NOT NULL,
 PRIMARY KEY(namespace,child_id,parent_id,kind),FOREIGN KEY(namespace,child_id) REFERENCES fx_records(namespace,id) ON DELETE CASCADE,
 FOREIGN KEY(namespace,parent_id) REFERENCES fx_records(namespace,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS fx_events (
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,connection_id TEXT NOT NULL,event_id TEXT NOT NULL,
 event TEXT NOT NULL,entity_id TEXT NOT NULL,event_timestamp TEXT NOT NULL,received_at TEXT NOT NULL,
 PRIMARY KEY(namespace,connection_id,event_id)
);
CREATE TABLE IF NOT EXISTS fx_deliveries (
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,id TEXT NOT NULL,connection_id TEXT NOT NULL,event_id TEXT NOT NULL,received_at TEXT NOT NULL,result TEXT NOT NULL,
 PRIMARY KEY(namespace,id)
);
CREATE TABLE IF NOT EXISTS fx_balances (
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,id TEXT NOT NULL,connection_id TEXT NOT NULL,account_id TEXT NOT NULL,
 balance_type TEXT NOT NULL,currency TEXT NOT NULL,scale INTEGER NOT NULL,available_minor TEXT,posted_minor TEXT,timestamp TEXT NOT NULL,
 collected_at TEXT NOT NULL,opening_minor TEXT,opening_at TEXT,scope_complete INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(namespace,id)
);
CREATE TABLE IF NOT EXISTS fx_daily (
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,key TEXT NOT NULL,
 day TEXT NOT NULL,timezone TEXT NOT NULL,basis TEXT NOT NULL,platform TEXT NOT NULL,connection_id TEXT NOT NULL,
 account_id TEXT NOT NULL,balance_type TEXT NOT NULL,account_currency TEXT NOT NULL,account_scale INTEGER NOT NULL,
 original_currency TEXT NOT NULL,original_scale INTEGER NOT NULL,scenario TEXT NOT NULL,status TEXT NOT NULL,category TEXT NOT NULL,
 count INTEGER NOT NULL,amount_minor TEXT NOT NULL,original_minor TEXT NOT NULL,unknown_original INTEGER NOT NULL,issues INTEGER NOT NULL,
 PRIMARY KEY(namespace,key)
);
CREATE INDEX IF NOT EXISTS fx_daily_period ON fx_daily(namespace,timezone,basis,day,account_id,account_currency);
CREATE TABLE IF NOT EXISTS fx_assets (
 namespace TEXT NOT NULL REFERENCES demo_batches(namespace) ON DELETE CASCADE,id TEXT NOT NULL,kind TEXT NOT NULL,source_json TEXT NOT NULL,
 PRIMARY KEY(namespace,kind,id)
);
CREATE TABLE IF NOT EXISTS fx_projection_state(namespace TEXT PRIMARY KEY REFERENCES demo_batches(namespace) ON DELETE CASCADE,dirty INTEGER NOT NULL DEFAULT 1);
CREATE TRIGGER IF NOT EXISTS fx_dirty_insert AFTER INSERT ON fx_records BEGIN INSERT INTO fx_projection_state VALUES(NEW.namespace,1) ON CONFLICT(namespace) DO UPDATE SET dirty=1; END;
CREATE TRIGGER IF NOT EXISTS fx_dirty_update AFTER UPDATE ON fx_records BEGIN INSERT INTO fx_projection_state VALUES(NEW.namespace,1) ON CONFLICT(namespace) DO UPDATE SET dirty=1; END;
CREATE TRIGGER IF NOT EXISTS fx_dirty_delete AFTER DELETE ON fx_records WHEN EXISTS(SELECT 1 FROM demo_batches WHERE namespace=OLD.namespace) BEGIN INSERT INTO fx_projection_state VALUES(OLD.namespace,1) ON CONFLICT(namespace) DO UPDATE SET dirty=1; END;
CREATE TRIGGER IF NOT EXISTS fx_dirty_relation AFTER INSERT ON fx_relations BEGIN INSERT INTO fx_projection_state VALUES(NEW.namespace,1) ON CONFLICT(namespace) DO UPDATE SET dirty=1; END;
CREATE TRIGGER IF NOT EXISTS fx_dirty_relation_delete AFTER DELETE ON fx_relations WHEN EXISTS(SELECT 1 FROM demo_batches WHERE namespace=OLD.namespace) BEGIN INSERT INTO fx_projection_state VALUES(OLD.namespace,1) ON CONFLICT(namespace) DO UPDATE SET dirty=1; END;
