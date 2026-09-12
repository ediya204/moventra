-- Read-only compatibility projection: no copied transactions and no business-row updates.
-- Each connection names one provider scope. Legacy rows keep their original detail handler.
CREATE VIEW IF NOT EXISTS fx_unified_transactions AS
 SELECT namespace,id,connection_id,entity_id,source_id,platform,scenario,source_json,internal_json,account_id,card_id,account_currency,account_scale,amount_minor,original_currency,original_scale,original_minor,provider_rate,status,detailed_status,category,balance_type,source_date,authorized_at,posted_at,collected_at,sync_state,'fx' source_kind
 FROM fx_records
 UNION ALL
 SELECT 'fx-cross-currency-v1' namespace,source_id id,'DEMO-LEGACY-SLASH' connection_id,entity_id,source_id,platform,scenario_id scenario,source_json,
 json_object('category',CASE WHEN detailed_status='refund' OR EXISTS(SELECT 1 FROM internal_relations l WHERE l.namespace=s.namespace AND l.from_id=s.source_id AND l.relation_type='refund') THEN 'refund' WHEN EXISTS(SELECT 1 FROM source_records f WHERE f.namespace=s.namespace AND f.source_id=s.source_id AND f.kind='fee') THEN 'fee' WHEN signed_amount_cents<0 THEN 'purchase' ELSE 'adjustment' END,'feeTreatment','unknown','matching',CASE WHEN json_extract(internal_json,'$.matchingStatus')='demo_verified' THEN 'demo_verified' ELSE 'unmatched' END,'assumption','原有清算Demo；分类为兼容映射，费用及关系仍需查看原详情','fault','旧记录未接入精确采集模型，费用及分类待确认') internal_json,
 account_id,card_id,currency account_currency,CASE WHEN currency='USD' THEN 2 END account_scale,CAST(signed_amount_cents AS TEXT) amount_minor,
 coalesce(original_currency,CASE WHEN platform='slash' THEN 'USD' END) original_currency,
 CASE WHEN coalesce(original_currency,CASE WHEN platform='slash' THEN 'USD' END) IN('USD','CNY','AED','EUR') THEN 2 END original_scale,
 CAST(original_amount_cents AS TEXT) original_minor,conversion_rate_decimal provider_rate,status,detailed_status,
 CASE WHEN detailed_status='refund' OR EXISTS(SELECT 1 FROM internal_relations l WHERE l.namespace=s.namespace AND l.from_id=s.source_id AND l.relation_type='refund') THEN 'refund' WHEN EXISTS(SELECT 1 FROM source_records f WHERE f.namespace=s.namespace AND f.source_id=s.source_id AND f.kind='fee') THEN 'fee' WHEN signed_amount_cents<0 THEN 'purchase' ELSE 'adjustment' END category,
 (SELECT CASE WHEN count(*)=1 THEN max(json_extract(b.source_json,'$.type')) ELSE 'unknown' END FROM source_records b WHERE b.namespace=s.namespace AND b.account_id=s.account_id AND b.kind='balance') balance_type,
 source_date,authorized_at,CASE WHEN status='posted' THEN source_date END posted_at,json_extract(internal_json,'$.lastSyncedAt') collected_at,'legacy_projection' sync_state,'legacy' source_kind
 FROM source_records s WHERE namespace='slash-clearing-v1' AND kind='transaction';
