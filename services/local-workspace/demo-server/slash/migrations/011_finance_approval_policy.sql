-- Only isolated fixture policy; no production policy is enabled by this migration.
CREATE TABLE IF NOT EXISTS fn_policies(namespace TEXT NOT NULL REFERENCES demo_batches(namespace),version TEXT NOT NULL,asset TEXT NOT NULL,network TEXT NOT NULL,mode TEXT NOT NULL,tiers_json TEXT NOT NULL,PRIMARY KEY(namespace,version));
