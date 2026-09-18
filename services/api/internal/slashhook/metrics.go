package slashhook

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MetricCard struct {
	Connection string    `json:"connection"`
	Card       string    `json:"card"`
	Customer   string    `json:"customer"`
	Account    string    `json:"account"`
	Wallet     string    `json:"wallet"`
	BindingAt  time.Time `json:"bindingAt"`
}

// PlanMetrics requires a verified Firebase UID from the operator CLI, not email
// supplied by a customer API. It reads exact formal bindings only.
func (s *Service) PlanMetrics(ctx context.Context, uid string) ([]MetricCard, error) {
	rows, e := s.DB.Query(ctx, `SELECT b.connection_id,b.external_card_id,b.customer_id::text,w.account_ref,b.virtual_account_ref,b.created_at
 FROM users u JOIN customers c ON c.personal_owner_id=u.id AND c.kind='personal'
 JOIN project_wallet_cards b ON b.customer_id=c.id JOIN project_wallets w ON w.connection_id=b.connection_id AND w.virtual_account_ref=b.virtual_account_ref
 JOIN channel_connections n ON n.id=b.connection_id AND n.account_ref=w.account_ref
 JOIN card_sync_links l ON l.connection_id=n.id AND l.enabled
 JOIN slash_hook_connections h ON h.id=l.hook_connection_id AND h.enabled AND h.account_ref=w.account_ref
 WHERE u.firebase_uid=$1 AND u.status='active' AND u.role='customer' ORDER BY b.connection_id,b.external_card_id`, uid)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []MetricCard{}
	for rows.Next() {
		var c MetricCard
		if e = rows.Scan(&c.Connection, &c.Card, &c.Customer, &c.Account, &c.Wallet, &c.BindingAt); e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Fixed manifest is rechecked in the same transaction that enrolls the cards.
func (s *Service) EnrollMetrics(ctx context.Context, uid string, manifest []MetricCard) error {
	if len(manifest) == 0 {
		return errors.New("empty_manifest")
	}
	acct, e := s.account(ctx)
	if e != nil {
		return e
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	end := time.Now().UTC().Truncate(time.Millisecond)
	start := end.Add(-30 * 24 * time.Hour)
	for _, c := range manifest {
		if c.Account != acct {
			return errors.New("connection_account_mismatch")
		}
		var locked string
		e = tx.QueryRow(ctx, `SELECT b.external_card_id FROM project_wallet_cards b JOIN customers c ON c.id=b.customer_id JOIN users u ON u.id=c.personal_owner_id JOIN project_wallets w ON w.connection_id=b.connection_id AND w.virtual_account_ref=b.virtual_account_ref
  JOIN card_sync_links l ON l.connection_id=b.connection_id AND l.enabled JOIN slash_hook_connections h ON h.id=l.hook_connection_id AND h.enabled AND h.account_ref=w.account_ref
  WHERE b.connection_id=$1 AND b.external_card_id=$2 AND b.customer_id=$3 AND b.created_at=$4 AND b.virtual_account_ref=$5 AND w.account_ref=$6 AND u.firebase_uid=$7 AND u.status='active' AND u.role='customer' AND c.kind='personal' FOR SHARE OF b,c,u,w,l,h`, c.Connection, c.Card, c.Customer, c.BindingAt, c.Wallet, c.Account, uid).Scan(&locked)
		if e != nil {
			return errors.New("card_ownership_changed")
		}
		tag, e := tx.Exec(ctx, `INSERT INTO card_metric_scopes(connection_id,external_card_id,customer_id,account_ref,virtual_account_ref,binding_created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, c.Connection, c.Card, c.Customer, c.Account, c.Wallet, c.BindingAt)
		if e != nil {
			return e
		}
		if tag.RowsAffected() == 0 {
			existing, e := metricScope(ctx, tx, c.Connection, c.Card)
			if e != nil || existing.Customer != c.Customer || !existing.BindingAt.Equal(c.BindingAt) {
				return errors.New("metric_enrollment_conflict")
			}
			continue
		}
		for _, r := range []struct {
			purpose  string
			from, to time.Time
		}{{"recent", start, end}, {"history", time.Unix(0, 0).UTC(), start}} {
			if _, e = tx.Exec(ctx, `INSERT INTO card_metric_runs(id,connection_id,external_card_id,from_at,to_at,purpose) VALUES($1,$2,$3,$4,$5,$6)`, uuid.NewString(), c.Connection, c.Card, r.from, r.to, r.purpose); e != nil {
				return e
			}
		}
	}
	return tx.Commit(ctx)
}

const metricScopeSQL = `SELECT s.connection_id,s.external_card_id,s.customer_id::text,s.account_ref,s.virtual_account_ref,s.binding_created_at FROM card_metric_scopes s
 JOIN project_wallet_cards b ON b.connection_id=s.connection_id AND b.external_card_id=s.external_card_id AND b.customer_id=s.customer_id AND b.virtual_account_ref=s.virtual_account_ref AND b.created_at=s.binding_created_at
 JOIN project_wallets w ON w.connection_id=s.connection_id AND w.virtual_account_ref=s.virtual_account_ref AND w.account_ref=s.account_ref
 JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=c.personal_owner_id AND u.status='active' AND u.role='customer'
 JOIN card_sync_links l ON l.connection_id=s.connection_id AND l.enabled
 JOIN slash_hook_connections h ON h.id=l.hook_connection_id AND h.enabled AND h.account_ref=s.account_ref
 WHERE s.enabled AND s.connection_id=$1 AND s.external_card_id=$2`

func metricScope(ctx context.Context, tx pgx.Tx, connection, card string) (MetricCard, error) {
	var c MetricCard
	e := tx.QueryRow(ctx, metricScopeSQL+` FOR SHARE OF s,b,w,c,u,l,h`, connection, card).Scan(&c.Connection, &c.Card, &c.Customer, &c.Account, &c.Wallet, &c.BindingAt)
	return c, e
}
func integer(raw json.RawMessage) (string, error) {
	v := strings.TrimSpace(string(raw))
	if strings.HasPrefix(v, `"`) {
		if json.Unmarshal(raw, &v) != nil {
			return "", errors.New("invalid_money")
		}
	}
	if len(v) == 0 || len(v) > 39 {
		return "", errors.New("invalid_money")
	}
	n, ok := new(big.Int).SetString(v, 10)
	if !ok || len(strings.TrimPrefix(n.String(), "-")) > 38 {
		return "", errors.New("invalid_money")
	}
	return n.String(), nil
}
func transactionData(m map[string]json.RawMessage, c MetricCard) ([]byte, string, time.Time, error) {
	id := value(m, "id")
	if !ident.MatchString(id) || value(m, "accountId") != c.Account || value(m, "virtualAccountId") != c.Wallet || value(m, "cardId") != c.Card {
		return nil, "", time.Time{}, errors.New("resource_scope_mismatch")
	}
	amount, e := integer(m["amountCents"])
	if e != nil {
		return nil, "", time.Time{}, e
	}
	at, e := time.Parse(time.RFC3339Nano, value(m, "date"))
	if e != nil {
		return nil, "", at, errors.New("invalid_source_date")
	}
	b, e := safePayload(m, id)
	if e != nil {
		return nil, "", at, e
	}
	var out map[string]any
	json.Unmarshal(b, &out)
	// JSON parsing above cannot round money: replace it with the exact string.
	out["amountCents"] = amount
	out["currency"] = "USD"
	out["scale"] = 2
	if value(m, "status") == "posted" {
		out["postedAt"] = at.UTC().Format(time.RFC3339Nano)
	}
	var merchant map[string]json.RawMessage
	json.Unmarshal(m["merchantData"], &merchant)
	if d := value(merchant, "description"); len(d) <= 512 {
		out["merchant"] = d
	}
	if code := value(merchant, "categoryCode"); len(code) <= 16 {
		out["categoryCode"] = code
	}
	var original map[string]json.RawMessage
	if json.Unmarshal(m["originalCurrency"], &original) == nil && original != nil {
		code := value(original, "code")
		n, e := integer(original["amountCents"])
		if e == nil && len(code) == 3 {
			out["originalCurrency"] = map[string]string{"code": code, "amountCents": n}
		}
	}
	b, e = json.Marshal(out)
	return b, amount, at, e
}
func saveTransaction(ctx context.Context, tx pgx.Tx, c MetricCard, m map[string]json.RawMessage, observed time.Time, evidence string, category bool) error {
	b, amount, at, e := transactionData(m, c)
	if e != nil {
		return e
	}
	id := value(m, "id")
	if _, e = tx.Exec(ctx, `INSERT INTO card_metric_observations(connection_id,external_card_id,resource_id,kind,evidence,payload,observed_at) VALUES($1,$2,$3,'transaction',$4,$5,$6)`, c.Connection, c.Card, id, evidence, b, observed); e != nil {
		return e
	}
	tag, e := tx.Exec(ctx, `INSERT INTO card_source_transactions(connection_id,external_id,external_card_id,account_ref,virtual_account_ref,amount_minor,source_date,status,detailed_status,category_verified,data,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
 ON CONFLICT(connection_id,external_id) DO UPDATE SET amount_minor=excluded.amount_minor,source_date=excluded.source_date,status=excluded.status,detailed_status=excluded.detailed_status,category_verified=card_source_transactions.category_verified OR excluded.category_verified,data=excluded.data,observed_at=excluded.observed_at
 WHERE card_source_transactions.external_card_id=excluded.external_card_id AND card_source_transactions.account_ref=excluded.account_ref AND card_source_transactions.virtual_account_ref=excluded.virtual_account_ref AND card_source_transactions.observed_at<=excluded.observed_at`, c.Connection, id, c.Card, c.Account, c.Wallet, amount, at, value(m, "status"), value(m, "detailedStatus"), category, b, observed)
	if e != nil {
		return e
	}
	if tag.RowsAffected() == 0 {
		return errors.New("transaction_observation_conflict")
	}
	return nil
}

// Filtered listing is the documented category evidence. Notifications never
// guess that every debit or a transaction with a card ID must be a purchase.
func (s *Service) metricPage(ctx context.Context, c MetricCard, from, to time.Time, cursor string) ([]map[string]json.RawMessage, string, error) {
	q := url.Values{"filter:accountId": {c.Account}, "filter:virtualAccountId": {c.Wallet}, "filter:cardId": {c.Card}, "filter:category": {"card"}, "filter:from_date": {strconv.FormatInt(from.UnixMilli(), 10)}, "filter:to_date": {strconv.FormatInt(to.UnixMilli()-1, 10)}}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	m, e := s.get(ctx, "/transaction?"+q.Encode())
	if e != nil {
		return nil, "", e
	}
	var items []map[string]json.RawMessage
	var meta map[string]json.RawMessage
	if json.Unmarshal(m["items"], &items) != nil || items == nil || json.Unmarshal(m["metadata"], &meta) != nil || meta == nil {
		return nil, "", errors.New("invalid_page")
	}
	next := value(meta, "nextCursor")
	if len(next) > 4096 || next != "" && next == cursor {
		return nil, "", errors.New("cursor_loop")
	}
	for _, m := range items {
		_, _, at, e := transactionData(m, c)
		if e != nil {
			return nil, "", e
		}
		if at.Before(from) || !at.Before(to) {
			return nil, "", errors.New("source_window_mismatch")
		}
	}
	return items, next, nil
}

func (s *Service) metricStep(ctx context.Context, db *pgxpool.Conn) error {
	// Drain durable refresh requests only when a new fixed-window job can start.
	_, e := db.Exec(ctx, `WITH picked AS (
 SELECT f.connection_id,f.external_card_id,f.requested_at FROM card_metric_refreshes f
 WHERE NOT EXISTS(SELECT 1 FROM card_metric_runs r WHERE r.connection_id=f.connection_id AND r.external_card_id=f.external_card_id AND r.state='queued' AND r.purpose='manual') LIMIT 1
 ), ins AS (INSERT INTO card_metric_runs(id,connection_id,external_card_id,from_at,to_at,purpose)
 SELECT $1,connection_id,external_card_id,date_trunc('milliseconds',now())-interval '30 days',date_trunc('milliseconds',now()),'manual' FROM picked RETURNING connection_id,external_card_id)
 DELETE FROM card_metric_refreshes f USING picked p,ins i WHERE f.connection_id=i.connection_id AND f.external_card_id=i.external_card_id AND f.connection_id=p.connection_id AND f.external_card_id=p.external_card_id AND f.requested_at=p.requested_at`, uuid.NewString())
	if e != nil {
		return e
	}
	var id, conn, card, cursor, purpose string
	var from, to time.Time
	var attempt, pages int
	e = db.QueryRow(ctx, `SELECT id::text,connection_id,external_card_id,cursor,from_at,to_at,purpose,attempts,pages FROM card_metric_runs WHERE state='queued' AND next_attempt<=now() ORDER BY CASE WHEN purpose='history' THEN 1 ELSE 0 END,created_at,id LIMIT 1`).Scan(&id, &conn, &card, &cursor, &from, &to, &purpose, &attempt, &pages)
	if e == pgx.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	if pages >= 50000 {
		return metricFailure(ctx, db, id, "page_limit", 12)
	}
	tx, e := db.Begin(ctx)
	if e != nil {
		return e
	}
	c, e := metricScope(ctx, tx, conn, card)
	tx.Rollback(ctx)
	if e != nil {
		return metricFailure(ctx, db, id, "card_ownership_changed", attempt)
	}
	observed := time.Now().UTC()
	acct, e := s.account(ctx)
	if e == nil && acct != c.Account {
		e = errors.New("connection_account_mismatch")
	}
	var items []map[string]json.RawMessage
	var next string
	if e == nil {
		items, next, e = s.metricPage(ctx, c, from, to, cursor)
	}
	if e != nil {
		return metricFailure(ctx, db, id, e.Error(), attempt)
	}
	// Capture current utilization only after a whole card/window was fetched.
	var utilization map[string]json.RawMessage
	var rules []byte
	if next == "" && purpose != "history" {
		utilization, rules, e = s.readUtilization(ctx, c)
		if e != nil {
			return metricFailure(ctx, db, id, e.Error(), attempt)
		}
	}
	tx, e = db.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = metricScope(ctx, tx, conn, card); e != nil {
		return e
	}
	var current string
	var seen []string
	if e = tx.QueryRow(ctx, `SELECT cursor,seen_cursors FROM card_metric_runs WHERE id=$1 AND state='queued' FOR UPDATE`, id).Scan(&current, &seen); e != nil {
		return e
	}
	if current != cursor {
		return errors.New("cursor_conflict")
	}
	for _, old := range seen {
		if next != "" && old == next {
			tx.Rollback(ctx)
			return metricFailure(ctx, db, id, "cursor_loop", 12)
		}
	}
	for _, m := range items {
		if e = saveTransaction(ctx, tx, c, m, observed, "run:"+id, true); e != nil {
			tx.Rollback(ctx)
			return metricFailure(ctx, db, id, "transaction_page_rejected", 12)
		}
	}
	state := "queued"
	var completed *time.Time
	if next == "" {
		state = "done"
		now := time.Now().UTC()
		completed = &now
	}
	if _, e = tx.Exec(ctx, `UPDATE card_metric_runs SET cursor=$2,seen_cursors=array_append(seen_cursors,$3),pages=pages+1,record_count=record_count+$4,state=$5,completed_at=$6,attempts=0,last_error='',next_attempt=now() WHERE id=$1`, id, next, cursor, len(items), state, completed); e != nil {
		return e
	}
	if utilization != nil {
		if e = saveUtilization(ctx, tx, c, utilization, rules, observed, "run:"+id); e != nil {
			tx.Rollback(ctx)
			return metricFailure(ctx, db, id, "utilization_rejected", 12)
		}
	}
	if next == "" && purpose == "recent" {
		// Re-scan the recent window through the handoff instant. Webhooks queued
		// during backfill are prioritized by Step and fetch authoritative objects.
		_, e = tx.Exec(ctx, `INSERT INTO card_metric_runs(id,connection_id,external_card_id,from_at,to_at,purpose) VALUES($1,$2,$3,$4,$5,'handoff') ON CONFLICT DO NOTHING`, uuid.NewString(), conn, card, from, time.Now().UTC().Truncate(time.Millisecond))
		if e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
func metricFailure(ctx context.Context, db *pgxpool.Conn, id, code string, attempt int) error {
	state := "queued"
	if attempt >= 11 || strings.Contains(code, "mismatch") || strings.Contains(code, "ownership") || code == "cursor_loop" || code == "provider_http_401" || code == "provider_http_403" {
		state = "review"
	}
	_, e := db.Exec(ctx, `UPDATE card_metric_runs SET state=$2,last_error=$3,attempts=attempts+1,next_attempt=$4 WHERE id=$1`, id, state, code, time.Now().Add(time.Duration(1<<min(attempt, 8))*30*time.Second))
	return e
}

// Resume a reviewed historical page without silently discarding its checkpoint.
// Ownership is revalidated both here and on the worker's next fetch.
func (s *Service) RetryMetricRun(ctx context.Context, uid, run string) error {
	if _, e := uuid.Parse(run); e != nil {
		return errors.New("invalid_run")
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var conn, card string
	e = tx.QueryRow(ctx, `SELECT r.connection_id,r.external_card_id FROM card_metric_runs r JOIN card_metric_scopes s ON s.connection_id=r.connection_id AND s.external_card_id=r.external_card_id JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=c.personal_owner_id WHERE r.id=$1 AND u.firebase_uid=$2 AND r.state='review' FOR UPDATE OF r`, run, uid).Scan(&conn, &card)
	if e != nil {
		return errors.New("run_not_available")
	}
	if _, e = metricScope(ctx, tx, conn, card); e != nil {
		return errors.New("card_ownership_changed")
	}
	if _, e = tx.Exec(ctx, `UPDATE card_metric_runs SET state='queued',attempts=0,next_attempt=now(),last_error='' WHERE id=$1`, run); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
