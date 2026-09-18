ALTER TABLE card_sync_links ADD COLUMN controls_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE card_control_commands (
 id uuid PRIMARY KEY,
 connection_id text NOT NULL REFERENCES card_sync_links(connection_id),
 external_card_id text NOT NULL,
 customer_id uuid NOT NULL REFERENCES customers(id),
 actor_id uuid NOT NULL REFERENCES users(id),
 expected_status text NOT NULL CHECK(expected_status IN ('active','paused','inactive')),
 target_status text NOT NULL CHECK(target_status IN ('active','paused','closed')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','submitted','confirming','confirmed','failed','review')),
 attempts integer NOT NULL DEFAULT 0,
 last_error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 next_attempt timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE card_control_observations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 command_id uuid NOT NULL REFERENCES card_control_commands(id),
 status text NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX card_control_one_pending ON card_control_commands(connection_id,external_card_id) WHERE state IN ('queued','submitted','confirming','review');
CREATE INDEX card_control_due ON card_control_commands(next_attempt) WHERE state IN ('queued','submitted','confirming');
UPDATE slash_hook_events SET state='ignored',last_error='' WHERE event_type='internal.card.reconcile' AND state='queued';
CREATE OR REPLACE VIEW channel_current_records AS
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
FROM channel_records r
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
