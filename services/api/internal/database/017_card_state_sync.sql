-- Explicit provider-to-projection mapping; never grants customer ownership.
CREATE TABLE card_sync_links (
 connection_id text PRIMARY KEY REFERENCES channel_connections(id),
 hook_connection_id text NOT NULL UNIQUE REFERENCES slash_hook_connections(id),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE card_current_states (
 connection_id text NOT NULL REFERENCES channel_connections(id),
 external_card_id text NOT NULL,
 account_ref text NOT NULL,
 virtual_account_ref text NOT NULL,
 status text NOT NULL CHECK(status IN ('active','paused','inactive','closed')),
 checked_at timestamptz NOT NULL DEFAULT now(),
 source_event_id text NOT NULL,
 PRIMARY KEY(connection_id,external_card_id)
);
CREATE INDEX slash_hook_card_pending ON slash_hook_events(connection_id,entity_id,received_at DESC) WHERE kind='card';
-- Shared read model; immutable imports remain untouched. Only current revisions
-- receive live state. Legacy pinned snapshots use channel_records directly.
CREATE VIEW channel_current_records AS
SELECT r.connection_id,r.revision,r.kind,r.external_id,
 r.data || CASE WHEN r.kind='card' AND l.connection_id IS NOT NULL THEN
   CASE WHEN s.external_card_id IS NOT NULL THEN jsonb_build_object('cardStatus',s.status,'checkedAt',s.checked_at) ELSE '{}'::jsonb END ||
   jsonb_build_object('syncState',CASE
     WHEN e.last_error<>'' THEN 'error'
     WHEN e.state='queued' THEN 'pending'
     WHEN s.checked_at IS NULL THEN 'pending'
     WHEN s.checked_at<now()-interval '10 minutes' THEN 'stale'
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
 WHERE e.connection_id=l.hook_connection_id AND e.kind='card' AND e.entity_id=r.external_id
 ORDER BY (e.state='queued') DESC,e.received_at DESC LIMIT 1
) e ON r.kind='card';
