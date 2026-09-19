package issuing

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"moventra.local/api/internal/blnk"
	"net/url"
	"regexp"
	"time"
)

type SourceTransaction struct {
	ID             string      `json:"id"`
	CardID         string      `json:"cardId"`
	AccountID      string      `json:"accountId"`
	Status         string      `json:"status"`
	DetailedStatus string      `json:"detailedStatus"`
	Amount         json.Number `json:"amountCents"`
}
type TransactionSource interface {
	Transactions(context.Context, string, string) ([]SourceTransaction, string, error)
}

func (s *Slash) Transactions(ctx context.Context, card, cursor string) ([]SourceTransaction, string, error) {
	if !sourceID.MatchString(card) {
		return nil, "", ErrInvalid
	}
	q := url.Values{"filter:cardId": {card}, "filter:accountId": {s.account}}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var page struct {
		Items    []SourceTransaction `json:"items"`
		Metadata struct {
			Next string `json:"nextCursor"`
		} `json:"metadata"`
	}
	if e := s.call(ctx, "GET", "/transaction?"+q.Encode(), nil, &page); e != nil {
		return nil, "", e
	}
	if len(page.Items) > 1000 || len(page.Metadata.Next) > 4096 || cursor != "" && cursor == page.Metadata.Next {
		return nil, "", ErrUnknown
	}
	return page.Items, page.Metadata.Next, nil
}

var signedMinor = regexp.MustCompile(`^-?(0|[1-9][0-9]{0,17})$`)

func (s *Service) SyncCard(ctx context.Context, id string) error {
	if !s.Enabled || s.Blnk == nil || s.Pilot != nil {
		return ErrBlocked
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = Lock(ctx, tx, "sync:"+id); e != nil {
		return e
	}
	var customer, card, supplierID string
	var raw []byte
	e = tx.QueryRow(ctx, `SELECT customer_id::text,external_card_id,supplier_id::text,snapshot FROM issuing_orders WHERE id=$1 AND parent_id IS NULL AND external_card_id<>''`, id).Scan(&customer, &card, &supplierID, &raw)
	if e != nil {
		return e
	}
	var snapshot Snapshot
	if e = json.Unmarshal(raw, &snapshot); e != nil {
		return e
	}
	s, e = s.forSnapshot(snapshot)
	if e != nil {
		return e
	}
	var blocked bool
	if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_supplier_blocks WHERE supplier_id=$1)`, supplierID).Scan(&blocked); e != nil {
		return e
	}
	if blocked {
		return ErrBlocked
	}
	source, ok := s.Providers[supplierID].(TransactionSource)
	if !ok {
		return ErrBlocked
	}
	if e = Lock(ctx, tx, customer); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO issuing_sync(order_id) VALUES($1) ON CONFLICT DO NOTHING`, id)
	if e != nil {
		return e
	}
	var cursor string
	var due time.Time
	e = tx.QueryRow(ctx, `SELECT cursor,next_attempt_at FROM issuing_sync WHERE order_id=$1 FOR UPDATE`, id).Scan(&cursor, &due)
	if e != nil {
		return e
	}
	if time.Now().Before(due) {
		return nil
	}
	items, next, e := source.Transactions(ctx, card, cursor)
	if e != nil {
		if errors.Is(e, ErrAccess) {
			if _, err := tx.Exec(ctx, `INSERT INTO issuing_supplier_blocks(supplier_id,reason) VALUES($1,'provider_access_denied') ON CONFLICT DO NOTHING`, supplierID); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `UPDATE issuing_sync SET state='source_unavailable',next_attempt_at=now()+interval '5 minutes' WHERE order_id=$1`, id)
		if err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	for _, v := range items {
		if !sourceID.MatchString(v.ID) || v.CardID != card || v.AccountID != snapshot.Supplier.AccountRef || !signedMinor.MatchString(v.Amount.String()) {
			return ErrUnknown
		}
		data, _ := json.Marshal(v)
		_, e = tx.Exec(ctx, `INSERT INTO issuing_source_observations(order_id,source_id,fingerprint,data) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, id, v.ID, hash(v), data)
		if e != nil {
			return e
		}
		var oldAmount, oldStatus, oldState string
		e = tx.QueryRow(ctx, `SELECT amount_minor::text,detailed_status,state FROM issuing_postings WHERE order_id=$1 AND source_id=$2`, id, v.ID).Scan(&oldAmount, &oldStatus, &oldState)
		hasOld := e == nil
		if e != nil && e != pgx.ErrNoRows {
			return e
		}
		reason := ""
		if hasOld {
			if oldState == "review_required" {
				continue
			}
			if oldAmount == v.Amount.String() && oldStatus == v.DetailedStatus && v.Status == "posted" {
				continue
			}
			reason = "posted_fact_changed"
		}
		if reason == "" && (v.Status == "pending" || v.Status == "failed") {
			continue
		} // authorization and its reversal do not move posted funds
		amount := number(v.Amount.String())
		if reason == "" && (v.Status != "posted" || !((amount.Sign() < 0 && v.DetailedStatus == "settled") || (amount.Sign() > 0 && v.DetailedStatus == "refund"))) {
			reason = "unmapped_source_state"
		}
		if reason == "" {
			from, to := "card_"+id, "card_clearing"
			if amount.Sign() > 0 {
				from, to = to, from
			}
			amount.Abs(amount)
			e = s.transfer(ctx, tx, customer, id+":source:"+v.ID, from, to, amount.String(), true)
			if errors.Is(e, blnk.ErrConflict) {
				reason = "accounting_reference_conflict"
			} else if e != nil {
				return e
			}
		}
		state := "applied"
		if reason != "" {
			state = "review_required"
		}
		_, e = tx.Exec(ctx, `INSERT INTO issuing_postings(order_id,source_id,amount_minor,detailed_status,state,reason) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(order_id,source_id) DO UPDATE SET state='review_required',reason=EXCLUDED.reason,updated_at=now()`, id, v.ID, v.Amount.String(), v.DetailedStatus, state, reason)
		if e != nil {
			return e
		}
		if e = Audit(ctx, tx, "", customer, id, "source."+state, map[string]string{"sourceId": v.ID, "reason": reason}); e != nil {
			return e
		}
	}
	_, e = tx.Exec(ctx, `UPDATE issuing_sync SET cursor=$2,state='partial',last_success_at=now(),last_cycle_at=CASE WHEN $2='' THEN now() ELSE last_cycle_at END,next_attempt_at=now()+interval '1 minute' WHERE order_id=$1`, id, next)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Service) Reconciliation(ctx context.Context, tx pgx.Tx, customer string) (any, error) {
	if s.Funds != nil {
		return s.Funds.SnapshotTx(ctx, tx, customer)
	}
	rows, e := tx.Query(ctx, `SELECT account_key,blnk_id FROM issuing_balances WHERE customer_id=$1 ORDER BY account_key LIMIT 501`, customer)
	if e != nil {
		return nil, e
	}
	type item struct{ key, id string }
	accounts := []item{}
	for rows.Next() {
		var a item
		if e = rows.Scan(&a.key, &a.id); e != nil {
			rows.Close()
			return nil, e
		}
		accounts = append(accounts, a)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	if len(accounts) > 500 {
		return nil, ErrBlocked
	}
	out := []map[string]any{}
	if s.Blnk == nil {
		return nil, ErrBlocked
	}
	for _, a := range accounts {
		b, e := s.Blnk.Balance(ctx, a.id)
		if e != nil {
			return nil, e
		}
		var expected string
		e = tx.QueryRow(ctx, `SELECT COALESCE(sum(CASE WHEN destination_id=$2 THEN amount_minor ELSE -amount_minor END),0)::text FROM issuing_journal WHERE customer_id=$1 AND (source_id=$2 OR destination_id=$2)`, customer, a.id).Scan(&expected)
		if e != nil {
			return nil, e
		}
		out = append(out, map[string]any{"key": a.key, "postedMinor": b.Amount.String(), "journalMinor": expected, "matched": expected == b.Amount.String()})
	}
	var review int
	e = tx.QueryRow(ctx, `SELECT count(*) FROM issuing_postings p JOIN issuing_orders o ON o.id=p.order_id WHERE o.customer_id=$1 AND p.state='review_required'`, customer).Scan(&review)
	if e != nil {
		return nil, e
	}
	return map[string]any{"accounts": out, "reviewCount": review, "externalPoolReconciliation": "not_verified", "coverage": "partial"}, nil
}
