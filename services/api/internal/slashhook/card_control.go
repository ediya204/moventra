package slashhook

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type control struct {
	id, connection, card, customer, actor, expected, target, state, hook, account, wallet string
	attempts                                                                              int
}

// Called under the same advisory lock as webhook GETs: no overlapping publication.
// Only persisted user commands cause writes. Uncertain writes are never replayed.
func (s *Service) controlStep(ctx context.Context, db *pgxpool.Conn) (bool, error) {
	var c control
	err := db.QueryRow(ctx, `SELECT id::text,connection_id,external_card_id,customer_id::text,actor_id::text,expected_status,target_status,state,attempts FROM card_control_commands WHERE state IN ('queued','submitted','confirming') AND next_attempt<=now() ORDER BY next_attempt,created_at LIMIT 1`).Scan(&c.id, &c.connection, &c.card, &c.customer, &c.actor, &c.expected, &c.target, &c.state, &c.attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	finish := func(state, code string) error {
		_, e := db.Exec(ctx, `UPDATE card_control_commands SET state=$2,last_error=$3,updated_at=now(),next_attempt=now()+($4 * interval '1 second') WHERE id=$1 AND state IN ('queued','submitted','confirming')`, c.id, state, code, 30*(1<<min(c.attempts, 6)))
		return e
	}
	retry := func(code string) error {
		state := c.state
		if state == "submitted" {
			state = "confirming"
		}
		if c.attempts >= 11 {
			state = "review"
		}
		return finish(state, code)
	}
	_, err = db.Exec(ctx, `UPDATE card_control_commands SET attempts=attempts+1,next_attempt=now()+interval '30 seconds',updated_at=now() WHERE id=$1`, c.id)
	if err != nil {
		return true, err
	}
	// Recheck ownership and capability immediately before dispatch, including staff scope.
	err = db.QueryRow(ctx, `SELECT h.id,h.account_ref,w.virtual_account_ref FROM card_sync_links l
 JOIN slash_hook_connections h ON h.id=l.hook_connection_id AND h.enabled
 JOIN channel_connections cc ON cc.id=l.connection_id AND cc.account_ref=h.account_ref
 JOIN channel_records cr ON cr.connection_id=cc.id AND cr.revision=cc.revision AND cr.kind='card' AND cr.external_id=$2
 JOIN project_wallet_cards b ON b.connection_id=l.connection_id AND b.external_card_id=$2 AND b.customer_id=$3
 JOIN project_wallets w ON w.connection_id=b.connection_id AND w.virtual_account_ref=b.virtual_account_ref AND w.account_ref=h.account_ref
 JOIN users u ON u.id=$4 AND u.status='active'
 WHERE l.connection_id=$1 AND l.enabled AND l.controls_enabled AND (
 (u.role='customer' AND EXISTS(SELECT 1 FROM customers x WHERE x.id=b.customer_id AND x.personal_owner_id=u.id AND x.kind='personal')) OR
 (u.role='admin' AND EXISTS(SELECT 1 FROM effective_channel_read_grants g WHERE g.connection_id=l.connection_id AND g.user_id=u.id) AND EXISTS(SELECT 1 FROM effective_staff_grants g WHERE g.user_id=u.id AND g.customer_id=b.customer_id AND g.permission='accounts:read')))
 `, c.connection, c.card, c.customer, c.actor).Scan(&c.hook, &c.account, &c.wallet)
	if errors.Is(err, pgx.ErrNoRows) {
		state := "failed"
		if c.state != "queued" {
			state = "review"
		}
		return true, finish(state, "control_scope_changed")
	}
	if err != nil {
		return true, err
	}
	account, err := s.account(ctx)
	if err != nil {
		return true, retry(err.Error())
	}
	if account != c.account {
		return true, finish("review", "connection_account_mismatch")
	}
	m, err := s.get(ctx, "/card/"+url.PathEscape(c.card)+"?include_pan=false&include_cvv=false")
	if err != nil {
		return true, retry(err.Error())
	}
	if value(m, "id") != c.card || value(m, "accountId") != c.account || value(m, "virtualAccountId") != c.wallet {
		return true, finish("review", "resource_scope_mismatch")
	}
	payload, err := safePayload(m, c.card)
	if err != nil {
		return true, finish("review", "invalid_card_response")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return true, err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO card_control_observations(command_id,status) VALUES($1,$2)`, c.id, value(m, "status"))
	if err != nil {
		return true, err
	}
	err = publishCard(ctx, tx, c.hook, "command:"+c.id, c.card, c.account, payload)
	if err == nil {
		err = tx.Commit(ctx)
	} else {
		tx.Rollback(ctx)
	}
	if err != nil {
		return true, retry("card_observation_failed")
	}
	if value(m, "status") == c.target {
		return true, finish("confirmed", "")
	}
	if c.state != "queued" {
		return true, retry("awaiting_channel_confirmation")
	}
	if value(m, "status") != c.expected {
		return true, finish("failed", "card_status_changed")
	}
	// Persist BEFORE the external write. Crash recovery only performs GETs.
	if err = finish("submitted", ""); err != nil {
		return true, err
	}
	c.state = "submitted"
	code, err := s.patchCardStatus(ctx, c.card, c.target)
	if err != nil {
		return true, retry("provider_result_unknown")
	}
	if code >= 400 && code < 500 && code != 408 && code != 429 {
		return true, finish("failed", fmt.Sprintf("provider_http_%d", code))
	}
	if code != 200 && code != 204 {
		return true, retry("provider_result_unknown")
	}
	// Do not infer success from HTTP alone, including deferred/agent requests.
	_, err = db.Exec(ctx, `UPDATE card_control_commands SET state='confirming',next_attempt=now(),last_error='',updated_at=now() WHERE id=$1 AND state='submitted'`, c.id)
	return true, err
}

func (s *Service) patchCardStatus(ctx context.Context, id, status string) (int, error) {
	if status != "active" && status != "paused" && status != "closed" {
		return 0, errors.New("invalid_status")
	}
	body, _ := json.Marshal(map[string]string{"status": status})
	req, err := http.NewRequestWithContext(ctx, "PATCH", s.base+"/card/"+url.PathEscape(id), strings.NewReader(string(body)))
	if err != nil {
		return 0, err
	}
	req.Header.Set("X-API-Key", s.apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := s.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	// Response may include sensitive card fields; never log or store it.
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 2<<20))
	return res.StatusCode, nil
}

func (s *Service) EnableCardControls(ctx context.Context, connection string) error {
	account, err := s.account(ctx)
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(ctx, `UPDATE card_sync_links l SET controls_enabled=true FROM slash_hook_connections h,project_wallets w WHERE l.connection_id=$1 AND l.enabled AND h.id=l.hook_connection_id AND h.enabled AND h.account_ref=$2 AND w.connection_id=l.connection_id AND w.account_ref=$2`, connection, account)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("control_connection_scope_mismatch")
	}
	return nil
}
