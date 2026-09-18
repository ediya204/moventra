-- Authorized catalogue configuration only; does not enable financial execution.
-- Price decision: customer initial funding USD 20, opening fee USD 10.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('issuing:catalog',0));
CREATE TEMP TABLE release_bins(bin text PRIMARY KEY, upstream_id text NOT NULL) ON COMMIT DROP;
INSERT INTO release_bins VALUES
('40024200','card_product_hsz62usueilg'),
('40041606','card_product_21srtczdagp7p'),
('40041641','card_product_260203k7tyny0'),
('43612077','card_product_34mwpjogx4gu3'),
('43612078','card_product_2zwp1e2k7u0im'),
('43612079','card_product_2f0pb1sqhzse4'),
('43612080','card_product_1g6jd6ffgjas6'),
('43612081','card_product_c2rjxwqnbz8t');
DO $release$
DECLARE before_data jsonb; after_data jsonb; matching integer;
BEGIN
 IF EXISTS(SELECT 1 FROM issuing_audit WHERE action='catalog.production_release' AND detail->>'evidenceRef'='issuing-catalog-20260918-fee10-min20') THEN
   RAISE NOTICE 'catalogue release already recorded; no changes'; RETURN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=14 AND checksum='43f2e9df26d59cbfc6b67721d1bcc1dc7534467d7c34480b81b821c4d3f6ab9c') THEN
   RAISE EXCEPTION 'checkout migration required';
 END IF;
 SELECT count(*) INTO matching FROM issuing_products p
 JOIN release_bins b ON b.bin=p.bin AND b.upstream_id=p.upstream_id
 JOIN issuing_catalog_sources c ON c.product_id=p.id AND c.prefix=b.bin AND c.upstream_id=b.upstream_id AND c.source_status='active'
 WHERE p.supplier_id='69654f5f-780e-55ad-8a06-4ff4715afc95' AND p.status='draft' AND p.revision=1
 AND p.network='' AND p.fee_minor IS NULL AND p.minimum_minor IS NULL;
 IF matching<>8 THEN RAISE EXCEPTION 'catalogue baseline changed'; END IF;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.bin) INTO before_data FROM issuing_products p JOIN release_bins b USING(bin)
 WHERE p.supplier_id='69654f5f-780e-55ad-8a06-4ff4715afc95';
 UPDATE issuing_products p SET name='Moventra USD · '||p.bin,network='visa',fee_minor=1000,minimum_minor=2000,
 status='active',description='USD 虚拟卡，BIN '||p.bin||'。开卡费 10 USD，最低首充 20 USD，可增加首充金额。仅限合法用途；商户是否接受以实际支付结果为准。',
 revision=revision+1,updated_at=now() FROM release_bins b
 WHERE p.bin=b.bin AND p.upstream_id=b.upstream_id AND p.supplier_id='69654f5f-780e-55ad-8a06-4ff4715afc95';
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.bin) INTO after_data FROM issuing_products p JOIN release_bins b USING(bin)
 WHERE p.supplier_id='69654f5f-780e-55ad-8a06-4ff4715afc95';
 INSERT INTO issuing_audit(actor_id,resource_id,action,detail) VALUES(NULL,'69654f5f-780e-55ad-8a06-4ff4715afc95','catalog.production_release',
 jsonb_build_object('evidenceRef','issuing-catalog-20260918-fee10-min20','executionContext','authorized Render maintenance console',
 'authorization','user requested deployment and all eight BINs; explicitly set fee USD 10 and minimum funding USD 20',
 'networkBasis','Visa classification derived from source BIN prefixes beginning with 4; not a card-product API field',
 'sourceEvidence','Render read-only GET /card-product on 2026-09-18 returned these 8 active products, no nextCursor',
 'before',before_data,'after',after_data,'executionEnabled',false));
END $release$;
COMMIT;
SELECT bin,name,network,status,fee_minor,minimum_minor,revision FROM issuing_products
WHERE supplier_id='69654f5f-780e-55ad-8a06-4ff4715afc95' ORDER BY bin;
