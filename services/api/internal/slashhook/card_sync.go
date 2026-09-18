package slashhook

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
)

// Validate before publishing; imports and ownership are never overwritten.
func publishCard(ctx context.Context, tx pgx.Tx, hook, id, entity, acct string, payload []byte) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(payload, &m); err != nil {
		return err
	}
	var connection, wallet string
	err := tx.QueryRow(ctx, `SELECT l.connection_id,w.virtual_account_ref FROM card_sync_links l
 JOIN channel_connections c ON c.id=l.connection_id AND c.account_ref=$2
 JOIN project_wallets w ON w.connection_id=l.connection_id AND w.account_ref=$2
 JOIN channel_records r ON r.connection_id=c.id AND r.revision=c.revision AND r.kind='card' AND r.external_id=$3
 AND r.data->>'accountId'=$2 AND r.data->>'virtualAccountId'=w.virtual_account_ref
 WHERE l.hook_connection_id=$1 AND l.enabled AND EXISTS(SELECT 1 FROM project_wallet_cards b WHERE b.connection_id=l.connection_id AND b.external_card_id=$3 AND b.virtual_account_ref=w.virtual_account_ref) FOR SHARE OF l,w,c`, hook, acct, entity).Scan(&connection, &wallet)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if value(m, "virtualAccountId") != wallet {
		return errors.New("resource_wallet_mismatch")
	}
	status := value(m, "status")
	if status != "active" && status != "paused" && status != "inactive" && status != "closed" {
		return errors.New("resource_status_unknown")
	}
	_, err = tx.Exec(ctx, `INSERT INTO card_current_states(connection_id,external_card_id,account_ref,virtual_account_ref,status,source_event_id)
 VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(connection_id,external_card_id) DO UPDATE SET
 account_ref=excluded.account_ref,virtual_account_ref=excluded.virtual_account_ref,status=excluded.status,checked_at=now(),source_event_id=excluded.source_event_id`, connection, entity, acct, wallet, status, id)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE card_control_commands SET state='confirmed',last_error='',updated_at=now() WHERE connection_id=$1 AND external_card_id=$2 AND target_status=$3 AND state IN ('submitted','confirming','review')`, connection, entity, status)
	return err
}

// Enable binds an existing read-only webhook connection only after live account
// verification and a matching formally configured project wallet.
func (s *Service) EnableCardSync(ctx context.Context, connection, hook string) error {
	acct, err := s.account(ctx)
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(ctx, `INSERT INTO card_sync_links(connection_id,hook_connection_id)
 SELECT c.id,h.id FROM channel_connections c JOIN slash_hook_connections h ON h.id=$2 AND h.enabled AND h.account_ref=c.account_ref
 JOIN project_wallets w ON w.connection_id=c.id AND w.account_ref=c.account_ref
 WHERE c.id=$1 AND c.account_ref=$3
 ON CONFLICT(connection_id) DO UPDATE SET enabled=true WHERE card_sync_links.hook_connection_id=excluded.hook_connection_id`, connection, hook, acct)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("sync_connection_scope_mismatch")
	}
	return nil
}
