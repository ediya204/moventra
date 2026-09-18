package api

import (
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"io"
	"net/http"
)

// Reuses channelRead's identity, source and row authorization. No arbitrary
// provider fields or paths are accepted. Each operation has a stable request ID.
func (s *Server) queueCardControl(w http.ResponseWriter, r *http.Request, tx pgx.Tx, p principal, connection, card, customer string) {
	var in struct {
		Action       string `json:"action"`
		Expected     string `json:"expectedStatus"`
		ConfirmClose bool   `json:"confirmClose"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	d.DisallowUnknownFields()
	if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
		fail(w, 400, "invalid_card_action")
		return
	}
	target := map[string]string{"activate": "active", "pause": "paused", "close": "closed"}[in.Action]
	if target == "" || (in.Expected != "active" && in.Expected != "paused" && in.Expected != "inactive") || target == in.Expected || (target == "paused" && in.Expected != "active") || (target == "closed" && !in.ConfirmClose) {
		fail(w, 400, "invalid_card_action")
		return
	}
	requestID := r.Header.Get("Idempotency-Key")
	if _, err := uuid.Parse(requestID); err != nil {
		fail(w, 400, "idempotency_key_required")
		return
	}
	// Durable commands refer to the actual formal owner, not request-supplied IDs.
	var owner string
	err := tx.QueryRow(r.Context(), `SELECT b.customer_id::text FROM project_wallet_cards b JOIN project_wallets w ON w.connection_id=b.connection_id AND w.virtual_account_ref=b.virtual_account_ref JOIN card_sync_links l ON l.connection_id=b.connection_id AND l.enabled AND l.controls_enabled JOIN slash_hook_connections h ON h.id=l.hook_connection_id AND h.enabled AND h.account_ref=w.account_ref WHERE b.connection_id=$1 AND b.external_card_id=$2 FOR SHARE OF b,l,h,w`, connection, card).Scan(&owner)
	if err == pgx.ErrNoRows {
		fail(w, 409, "card_controls_disabled")
		return
	}
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if customer != "" && customer != owner {
		fail(w, 404, "not_found")
		return
	}
	if customer == "" {
		var allowed bool
		if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM staff_grants WHERE user_id=$1 AND customer_id=$2 AND permission='accounts:read')`, p.ID, owner).Scan(&allowed); err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		if p.Role != "admin" || !allowed {
			fail(w, 403, "card_control_scope_required")
			return
		}
	}
	var existingActor, existingConnection, existingCard, existingTarget, existingExpected, state string
	err = tx.QueryRow(r.Context(), `SELECT actor_id::text,connection_id,external_card_id,target_status,expected_status,state FROM card_control_commands WHERE id=$1`, requestID).Scan(&existingActor, &existingConnection, &existingCard, &existingTarget, &existingExpected, &state)
	if err == nil {
		if existingActor != p.ID || existingConnection != connection || existingCard != card || existingTarget != target || existingExpected != in.Expected {
			fail(w, 409, "idempotency_conflict")
			return
		}
		if tx.Commit(r.Context()) != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		respond(w, 200, map[string]any{"data": map[string]any{"id": requestID, "state": state}})
		return
	}
	if err != pgx.ErrNoRows {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO card_control_commands(id,connection_id,external_card_id,customer_id,actor_id,expected_status,target_status) VALUES($1,$2,$3,$4,$5,$6,$7)`, requestID, connection, card, owner, p.ID, in.Expected, target)
	if err != nil {
		if pe, ok := err.(*pgconn.PgError); ok && pe.Code == "23505" {
			fail(w, 409, "card_action_in_progress")
			return
		}
		fail(w, 503, "temporarily_unavailable")
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO channel_read_audit(connection_id,actor_id,action,revision) SELECT $1,$2,$3,revision FROM channel_connections WHERE id=$1`, connection, p.ID, "card:action:"+in.Action+":"+requestID)
	if err != nil || tx.Commit(r.Context()) != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	respond(w, 202, map[string]any{"data": map[string]any{"id": requestID, "state": "queued"}})
}
