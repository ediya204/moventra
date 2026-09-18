-- Read model only: business components, not every ledger leg. Parameters:
-- actor, admin, active namespace, include dedicated issuing, query JSON.
WITH scope AS MATERIALIZED (
 SELECT c.id,c.name,
   (NOT $2::boolean AND c.personal_owner_id=$1::uuid) AS owner,
   ($2::boolean AND c.personal_owner_id<>$1::uuid AND EXISTS(SELECT 1 FROM effective_crypto_grants($3) g WHERE g.user_id=$1::uuid AND g.customer_id=c.id AND g.permission='read')) AS crypto,
   ($2::boolean AND c.personal_owner_id<>$1::uuid AND EXISTS(SELECT 1 FROM effective_manual_funds_grants g WHERE g.user_id=$1::uuid AND (g.scope='*' OR g.scope=c.id::text) AND g.permission='read')) AS manual,
   ($2::boolean AND EXISTS(SELECT 1 FROM effective_issuing_grants g WHERE g.user_id=$1::uuid AND g.scope_id=c.id::text AND g.permission='customer:read')) AS issuing
 FROM customers c WHERE c.kind='personal' AND (COALESCE($5::jsonb->>'customerId','')='' OR c.id::text=$5::jsonb->>'customerId')
), crypto AS MATERIALIZED (
 SELECT o.*,c.name,a.external_card_id,a.connection_id,COALESCE(a.last4,'') AS last4,a.id AS funds_card_id
 FROM crypto_orders o JOIN scope c ON c.id=o.customer_id AND (c.owner OR c.crypto)
 LEFT JOIN funds_cards a ON a.id::text=o.data->>'cardId' AND a.namespace=o.namespace AND a.customer_id=o.customer_id
 WHERE o.namespace=$3
), manual AS MATERIALIZED (
 SELECT o.*,c.name FROM manual_funds_orders o JOIN scope c ON c.id=o.customer_id AND (c.owner OR c.manual) WHERE o.namespace=$3
), issuing AS MATERIALIZED (
 SELECT o.*,c.name FROM issuing_orders o JOIN scope c ON c.id=o.customer_id AND (c.owner OR c.issuing)
 WHERE o.snapshot->>'fundsNamespace'=$3 OR ($4::boolean AND COALESCE(o.snapshot->>'fundsNamespace','')='')
), components AS (
 SELECT 'crypto'::text AS source,o.id::text AS order_id,o.customer_id,o.name,o.created_at,o.updated_at,o.state,
 p.component,p.kind,p.amount,p.direction,o.data->>'currency' AS currency,
 CASE WHEN p.component='principal' AND o.kind='otc' THEN o.data->>'toCurrency' END AS to_currency,
 CASE WHEN p.component='principal' AND o.kind='otc' THEN o.data->>'receiveMinor' END AS receive,
 COALESCE(o.funds_card_id::text,'') AS card_id,o.last4,COALESCE(o.data->>'network','') AS network,
 COALESCE(o.data->>'address','') AS address,COALESCE(o.data->>'txHash','') AS tx_hash,
 ''::text AS original_id,COALESCE(o.data->>'postingStatus','unknown') AS source_posting,
 CASE WHEN o.kind='deposit' THEN COALESCE(NULLIF(o.data->>'evidenceRef',''),'crypto-order:'||o.id) ELSE 'crypto-order:'||o.id END AS evidence,
 CASE WHEN p.component='fee' THEN ARRAY['crypto:'||o.id||':fee','crypto:'||o.id||':card-fee'] ELSE ARRAY[]::text[] END AS effect_keys,
 false AS dedicated
 FROM crypto o CROSS JOIN LATERAL (VALUES
 ('principal',CASE WHEN o.kind='card_transfer' THEN CASE WHEN o.data->>'direction'='card_to_wallet' THEN 'card_out' ELSE 'card_in' END ELSE o.kind END,o.data->>'amountMinor',CASE WHEN o.kind='deposit' THEN 'in' WHEN o.kind='card_transfer' THEN 'internal' WHEN o.kind='otc' THEN 'exchange' ELSE 'out' END),
 ('fee','fee',o.data->>'feeMinor','out')
 ) p(component,kind,amount,direction)
 WHERE p.component='principal' OR (p.amount IS NOT NULL AND p.amount ~ '^[0-9]+$' AND p.amount::numeric>0)
 UNION ALL
 SELECT 'manual',o.id::text,o.customer_id,o.name,o.created_at,o.updated_at,o.state,'principal',
 CASE WHEN o.source='reversal' THEN 'reversal' WHEN o.direction='credit' THEN 'manual_in' ELSE 'manual_out' END,
 o.amount_minor::text,CASE WHEN o.direction='credit' THEN 'in' ELSE 'out' END,o.currency,NULL,NULL,'','','','','',
 CASE WHEN o.original_id IS NOT NULL THEN 'manual_'||o.original_id||'_principal' ELSE '' END,
 CASE WHEN o.state='completed' THEN 'posted' ELSE 'pending' END,'manual-order:'||o.id,ARRAY[]::text[],false FROM manual o
 UNION ALL
 SELECT 'issuing',o.id::text,o.customer_id,o.name,o.created_at,o.updated_at,o.state,p.component,p.kind,p.amount,p.direction,'USD',NULL,NULL,
 COALESCE((SELECT a.id::text FROM funds_cards a WHERE a.namespace=$3 AND a.customer_id=o.customer_id AND a.connection_id=o.snapshot->>'connectionId' AND a.external_card_id=o.external_card_id LIMIT 1),''),o.last4,'','','',
 '', 'unknown','issuing-order:'||o.id,ARRAY['issuing:'||o.id||':'||p.step],COALESCE(o.snapshot->>'fundsNamespace','')=''
 FROM issuing o CROSS JOIN LATERAL (VALUES ('fee','opening_fee',o.fee_minor::text,'out','fee'),('funding','card_in',o.funding_minor::text,'internal','fund')) p(component,kind,amount,direction,step)
 WHERE p.amount::numeric>0
 UNION ALL
 SELECT 'issuing_deposit',o.id::text,o.customer_id,c.name,o.created_at,o.created_at,o.state,'principal','manual_in',o.amount_minor::text,'in','USD',NULL,NULL,'','','','','','','unknown','issuing-deposit:'||o.id,ARRAY[]::text[],true
 FROM issuing_deposits o JOIN scope c ON c.id=o.customer_id AND (c.owner OR c.issuing) WHERE $4::boolean
), enriched AS (
 SELECT c.*,CASE
 WHEN c.dedicated AND EXISTS(SELECT 1 FROM issuing_journal j WHERE j.customer_id=c.customer_id AND j.reference='mvl_'||encode(sha256(convert_to(to_json(c.order_id||':'||CASE WHEN c.source='issuing_deposit' THEN 'deposit' WHEN c.component='fee' THEN 'fee' ELSE 'fund' END)::text,'UTF8')),'hex')) THEN 'posted'
 WHEN NOT c.dedicated AND EXISTS(SELECT 1 FROM ledger_operations l JOIN ledger_journal j ON j.operation_id=l.id WHERE l.namespace=$3 AND l.customer_id=c.customer_id AND l.evidence_ref=c.evidence AND (cardinality(c.effect_keys)=0 OR l.effect_key=ANY(c.effect_keys)) AND l.state='applied' AND (cardinality(c.effect_keys)>0 OR c.source_posting IN ('posted','applied','completed'))) THEN 'posted'
 WHEN c.source='crypto' AND c.component='principal' AND c.source_posting IN ('posted','applied','completed') THEN 'posted'
 WHEN c.source='manual' AND c.state='completed' THEN 'posted'
 WHEN c.state IN ('failed','funding_failed','rejected','cancelled') THEN 'not_posted'
 ELSE 'pending' END AS posting
 FROM components c
), refunds AS (
 -- Only explicit return operations. Reserve/release and card consumption refunds
 -- never become business records. Joining the authorized order prevents leakage.
 SELECT e.*,l.id::text AS refund_id,l.amount_minor::text AS refund_amount,l.created_at AS refund_at,l.updated_at AS refund_updated,l.state AS refund_state,
 CASE WHEN a.kind='fee' THEN 'fee_refund' ELSE 'funding_return' END AS refund_kind
 FROM enriched e JOIN ledger_operations l ON l.namespace=$3 AND l.customer_id=e.customer_id AND l.evidence_ref=e.evidence
 JOIN ledger_accounts a ON a.id=l.source_id JOIN ledger_accounts b ON b.id=l.destination_id
 WHERE b.kind='wallet' AND ((a.kind='fee' AND e.component='fee') OR (e.source='issuing' AND e.component='funding' AND l.effect_key='issuing:'||e.order_id||':unfund'))
 UNION ALL
 SELECT e.*,e.order_id,j.amount_minor::text,j.created_at,j.created_at,'applied','funding_return'
 FROM enriched e JOIN issuing_journal j ON j.customer_id=e.customer_id AND j.reference='mvl_'||encode(sha256(convert_to(to_json(e.order_id||':unfund')::text,'UTF8')),'hex')
 WHERE e.dedicated AND e.source='issuing' AND e.component='funding'
), records AS (
 SELECT source||'_'||order_id||'_'||component AS id,customer_id,name,created_at,
 jsonb_build_object('id',source||'_'||order_id||'_'||component,'source',source,'fundingSource',CASE WHEN dedicated THEN 'issuing_wallet' ELSE 'funds_wallet' END,'orderId',order_id,'customerId',customer_id,'customerName',CASE WHEN $2 THEN name ELSE NULL END,'createdAt',created_at,'updatedAt',updated_at,'kind',kind,'direction',direction,'currency',currency,'amountMinor',amount,'toCurrency',to_currency,'receiveMinor',receive,'cardId',card_id,'last4',last4,'network',network,'address',address,'txHash',tx_hash,'originalId',NULLIF(original_id,''),'sourceState',state,'postingStatus',posting,'status',CASE WHEN component='fee' AND posting='posted' THEN 'completed' WHEN source='issuing' AND component='funding' AND posting='posted' THEN 'completed' WHEN state IN ('provider_unknown','unknown','review_required') THEN 'unknown' WHEN state IN ('failed','funding_failed') THEN 'failed' WHEN state='rejected' THEN 'rejected' WHEN state='cancelled' THEN 'cancelled' WHEN state IN ('completed','active','applied') THEN 'completed' WHEN state IN ('pending_review','submitted') THEN 'pending_review' ELSE 'processing' END) AS data,
 evidence,dedicated FROM enriched
 UNION ALL
 SELECT source||'_'||order_id||'_refund-'||refund_id,customer_id,name,refund_at,
 jsonb_build_object('id',source||'_'||order_id||'_refund-'||refund_id,'source',source,'fundingSource',CASE WHEN dedicated THEN 'issuing_wallet' ELSE 'funds_wallet' END,'orderId',order_id,'customerId',customer_id,'customerName',CASE WHEN $2 THEN name ELSE NULL END,'createdAt',refund_at,'updatedAt',refund_updated,'kind',refund_kind,'direction',CASE WHEN refund_kind='funding_return' THEN 'internal' ELSE 'in' END,'currency',currency,'amountMinor',refund_amount,'cardId',card_id,'last4',last4,'originalId',source||'_'||order_id||'_'||component,'sourceState',refund_state,'postingStatus',CASE WHEN refund_state='applied' THEN 'posted' ELSE 'pending' END,'status',CASE WHEN refund_state='applied' THEN 'completed' WHEN refund_state='rejected' THEN 'failed' ELSE 'unknown' END),evidence,dedicated FROM refunds
), filtered AS (
 SELECT * FROM records r WHERE
 (COALESCE($5::jsonb->>'id','')='' OR r.id=$5::jsonb->>'id') AND
 (COALESCE($5::jsonb->>'kind','')='' OR data->>'kind'=$5::jsonb->>'kind') AND
 (COALESCE($5::jsonb->>'status','')='' OR data->>'status'=$5::jsonb->>'status') AND
 (COALESCE($5::jsonb->>'currency','')='' OR data->>'currency'=$5::jsonb->>'currency' OR data->>'toCurrency'=$5::jsonb->>'currency') AND
 (COALESCE($5::jsonb->>'cardId','')='' OR data->>'cardId'=$5::jsonb->>'cardId') AND
 (NULLIF($5::jsonb->>'from','') IS NULL OR created_at>=($5::jsonb->>'from')::timestamptz) AND
 (NULLIF($5::jsonb->>'to','') IS NULL OR created_at<($5::jsonb->>'to')::timestamptz) AND
 (COALESCE($5::jsonb->>'q','')='' OR strpos(lower(concat_ws(' ',data->>'orderId',data->>'last4',data->>'address',data->>'txHash')),lower($5::jsonb->>'q'))>0)
)
