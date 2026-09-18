package api

// Applied only to authorized admin rows. Assignment identities are independent
// of import revisions. Never infer an owner from a name, suffix or cardholder.
// A transaction describes its card's current assignment, not historical funds.
const channelOwnershipJoin = ` LEFT JOIN LATERAL (
 SELECT b.customer_id, 'project_wallet'::text AS kind,
        (r.data->>'accountId'=w.account_ref AND r.data->>'virtualAccountId'=w.virtual_account_ref) IS TRUE AS scope_matches
 FROM project_wallet_cards b
 JOIN project_wallets w ON w.connection_id=b.connection_id AND w.virtual_account_ref=b.virtual_account_ref
 WHERE b.connection_id=r.connection_id
   AND b.external_card_id=CASE WHEN r.kind='card' THEN r.external_id ELSE r.data->>'cardId' END
 UNION ALL
 SELECT b.customer_id, 'test_snapshot'::text, true
 FROM customer_card_bindings b
 WHERE b.connection_id=r.connection_id
   AND b.external_card_id=CASE WHEN r.kind='card' THEN r.external_id ELSE r.data->>'cardId' END
   AND NOT EXISTS(SELECT 1 FROM project_wallet_customers p WHERE p.customer_id=b.customer_id)
   AND NOT EXISTS(SELECT 1 FROM project_wallet_cards p WHERE p.connection_id=b.connection_id AND p.external_card_id=b.external_card_id)
 ) assignment ON true
 LEFT JOIN customers owner_customer ON owner_customer.id=assignment.customer_id AND assignment.scope_matches AND EXISTS(SELECT 1 FROM staff_grants g WHERE g.user_id=$12 AND g.customer_id=assignment.customer_id AND g.permission='accounts:read')
 LEFT JOIN users owner_user ON owner_user.id=owner_customer.personal_owner_id `

const channelOwnershipSelection = `r.data || jsonb_build_object(
 'controlsEnabled', COALESCE((r.data->>'controlsEnabled')::boolean,false) AND owner_customer.id IS NOT NULL AND assignment.kind='project_wallet' AND assignment.scope_matches,
 'assignmentKind', COALESCE(assignment.kind,'unassigned'),
 'customerAssignment', CASE WHEN assignment.customer_id IS NULL THEN jsonb_build_object('state','unassigned') WHEN NOT assignment.scope_matches THEN jsonb_build_object('state','scope_mismatch') WHEN owner_customer.id IS NULL THEN jsonb_build_object('state','restricted') ELSE jsonb_build_object('state','assigned','id',owner_customer.id,'name',owner_customer.name) END,
 'internal', jsonb_build_object(
   'ownershipStatus', CASE WHEN assignment.customer_id IS NULL THEN 'unassigned' WHEN NOT assignment.scope_matches THEN 'scope_mismatch' WHEN owner_customer.id IS NULL THEN 'restricted' ELSE 'bound' END,
   'customerId', owner_customer.id, 'userId', owner_user.id,
   'customerName', COALESCE(NULLIF(owner_user.display_name,''),NULLIF(owner_customer.name,''),owner_customer.id::text)
 ))`
