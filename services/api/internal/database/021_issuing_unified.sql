-- Additive opt-in new-card linkage. No historical balance or ownership migration.
CREATE TABLE issuing_card_projections (
 order_id uuid PRIMARY KEY REFERENCES issuing_orders(id),
 customer_id uuid NOT NULL REFERENCES customers(id),
 connection_id text NOT NULL REFERENCES channel_connections(id),
 external_card_id text NOT NULL,
 evidence_revision text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,external_card_id),
 FOREIGN KEY(connection_id,external_card_id) REFERENCES project_wallet_cards(connection_id,external_card_id),
 FOREIGN KEY(customer_id,order_id) REFERENCES issuing_orders(customer_id,id)
);

CREATE OR REPLACE VIEW channel_current_records AS
WITH current_source AS (
 SELECT connection_id,revision,kind,external_id,data FROM channel_records
 UNION ALL
 SELECT r.connection_id,c.revision,r.kind,r.external_id,r.data
 FROM issuing_card_projections p
 JOIN channel_records r ON r.connection_id=p.connection_id AND r.revision=p.evidence_revision AND r.kind='card' AND r.external_id=p.external_card_id
 JOIN channel_connections c ON c.id=p.connection_id
 WHERE c.revision IS NOT NULL AND c.revision<>p.evidence_revision
 AND NOT EXISTS(SELECT 1 FROM channel_records existing WHERE existing.connection_id=c.id AND existing.revision=c.revision AND existing.kind='card' AND existing.external_id=p.external_card_id)
)
SELECT r.connection_id,r.revision,r.kind,r.external_id,
 r.data || CASE WHEN r.kind='card' AND l.connection_id IS NOT NULL THEN
   CASE WHEN s.external_card_id IS NOT NULL THEN jsonb_build_object('cardStatus',s.status,'checkedAt',s.checked_at) ELSE '{}'::jsonb END ||
   jsonb_build_object('controlsEnabled',l.controls_enabled,'cardAction',CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('id',a.id,'state',a.state,'targetStatus',a.target_status,'error',a.last_error) ELSE NULL END,'syncState',CASE
     WHEN a.state IN ('queued','submitted','confirming') THEN 'pending'
     WHEN a.state='review' THEN 'error'
     WHEN e.last_error<>'' THEN 'error'
     WHEN e.state='queued' THEN 'pending'
     WHEN s.checked_at IS NULL THEN 'unverified'
     ELSE 'synced' END)
 ELSE '{}'::jsonb END AS data
FROM current_source r
JOIN channel_connections c ON c.id=r.connection_id
LEFT JOIN card_sync_links l ON l.connection_id=r.connection_id AND l.enabled AND r.revision=c.revision
 AND EXISTS(SELECT 1 FROM project_wallet_cards b WHERE b.connection_id=r.connection_id AND b.external_card_id=r.external_id AND b.virtual_account_ref=r.data->>'virtualAccountId')
LEFT JOIN card_current_states s ON s.connection_id=l.connection_id AND s.external_card_id=r.external_id
 AND s.account_ref=r.data->>'accountId' AND s.virtual_account_ref=r.data->>'virtualAccountId'
LEFT JOIN LATERAL (
 SELECT state,last_error FROM slash_hook_events e
 WHERE e.connection_id=l.hook_connection_id AND e.kind='card' AND e.entity_id=r.external_id AND e.event_type<>'internal.card.reconcile'
 ORDER BY (e.state='queued') DESC,e.received_at DESC LIMIT 1
) e ON r.kind='card'
LEFT JOIN LATERAL (SELECT id,state,target_status,last_error FROM card_control_commands a WHERE a.connection_id=l.connection_id AND a.external_card_id=r.external_id ORDER BY a.created_at DESC,a.id DESC LIMIT 1) a ON r.kind='card';
