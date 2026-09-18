package manualfunds

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"moventra.local/api/internal/ledger"
	"time"
)

func (s *Service) account(ctx context.Context, c, kind, key string) (ledger.Account, error) {
	return s.Ledger.Provision(ctx, ledger.AccountSpec{CustomerID: c, Kind: kind, Currency: "USD", Key: key})
}
func (s *Service) move(ctx context.Context, o Order, phase, fromKind, fromKey, toKind, toKey string) error {
	a, e := s.account(ctx, o.CustomerID, fromKind, fromKey)
	if e != nil {
		return e
	}
	b, e := s.account(ctx, o.CustomerID, toKind, toKey)
	if e != nil {
		return e
	}
	kind := "crypto_move"
	if fromKind == "clearing" && toKind == "wallet" {
		kind = "wallet_credit"
	}
	op, e := s.Ledger.Submit(ctx, ledger.Command{CustomerID: o.CustomerID, EffectKey: "manual:" + o.ID + ":" + phase, Kind: kind, SourceID: a.ID, DestinationID: b.ID, AmountMinor: o.Amount, EvidenceRef: "manual-order:" + o.ID})
	if e != nil {
		return e
	}
	op, e = s.Ledger.Process(ctx, o.CustomerID, op.ID)
	if op.State == "rejected" {
		return fault("insufficient_balance", 409)
	}
	if e != nil {
		return e
	}
	if op.State != "applied" {
		return errors.New("ledger_pending")
	}
	return nil
}
func (s *Service) Process(ctx context.Context, c, id string) error {
	if !s.Enabled() {
		return fault("manual_funds_disabled", 503)
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = s.Lock(ctx, tx, c); e != nil {
		return e
	}
	o, e := s.Get(ctx, tx, c, id)
	if e != nil {
		return e
	}
	if o.State != "reserving" && o.State != "processing" && o.State != "releasing" {
		return nil
	}
	// Before/after are from this order's immutable journal leg, not a stale UI balance.
	hold := "manual-hold:" + o.ID
	next := o.State
	switch o.State {
	case "reserving":
		e = s.move(ctx, o, "reserve", "wallet", "wallet-USD", "escrow", hold)
		if e == nil {
			next = "pending_review"
		} else {
			var f *Fault
			if errors.As(e, &f) && f.Code == "insufficient_balance" {
				next = "failed"
				o.Error = f.Code
				e = nil
			}
		}
	case "releasing":
		e = s.move(ctx, o, "release", "escrow", hold, "wallet", "wallet-USD")
		if e == nil {
			next = o.Resolution
		}
	case "processing":
		if o.ReviewerID == "" || o.ReviewerID == o.ActorID {
			return fault("review_required", 409)
		}
		if o.Direction == "credit" {
			e = s.move(ctx, o, "credit", "clearing", "clearing-USD", "wallet", "wallet-USD")
		} else {
			if o.Source == "offline_payout" && o.PaymentEvidence == "" {
				return fault("payment_evidence_required", 409)
			}
			e = s.move(ctx, o, "debit", "escrow", hold, "clearing", "clearing-USD")
		}
		if e == nil {
			next = "completed"
		}
	}
	if e != nil {
		o.Error = "accounting_recovery_pending"
	} else if next != "failed" {
		o.Error = ""
	}
	// Persist an actionable pending state on any unknown result. Deterministic
	// ledger references safely recover even if this transaction later rolls back.
	_, saveErr := tx.Exec(ctx, `UPDATE manual_funds_orders SET state=$1,error=$2,revision=revision+1,updated_at=now() WHERE id=$3`, next, o.Error, o.ID)
	if saveErr == nil {
		saveErr = s.updateWalletEvidence(ctx, tx, o)
	}
	if saveErr == nil {
		saveErr = s.Audit(ctx, tx, c, id, "", "worker", map[string]string{"state": next, "error": o.Error})
	}
	if saveErr != nil {
		return saveErr
	}
	if saveErr = tx.Commit(ctx); saveErr != nil {
		return saveErr
	}
	return e
}
func (s *Service) updateWalletEvidence(ctx context.Context, tx pgx.Tx, o Order) error {
	// Report the wallet change caused by the credit or initial debit reservation.
	phase := "credit"
	if o.Direction == "debit" {
		phase = "reserve"
	}
	_, e := tx.Exec(ctx, `WITH leg AS (
 SELECT j.id,j.source_id,j.destination_id,j.amount_minor,a.id wallet_id FROM ledger_journal j
 JOIN ledger_operations op ON op.id=j.operation_id JOIN ledger_accounts a ON a.namespace=op.namespace AND a.customer_id=op.customer_id AND a.kind='wallet' AND a.currency='USD'
 WHERE op.namespace=$1 AND op.effect_key=$2 AND (a.id=j.source_id OR a.id=j.destination_id)
 ), amounts AS (
 SELECT leg.id,leg.amount_minor,leg.destination_id=leg.wallet_id incoming,COALESCE(sum(CASE WHEN j.destination_id=leg.wallet_id THEN j.amount_minor ELSE -j.amount_minor END),0) before
 FROM leg LEFT JOIN ledger_journal j ON j.id<leg.id AND (j.source_id=leg.wallet_id OR j.destination_id=leg.wallet_id) GROUP BY leg.id,leg.amount_minor,leg.destination_id,leg.wallet_id
 ) UPDATE manual_funds_orders SET wallet_before_minor=amounts.before,wallet_after_minor=amounts.before+CASE WHEN amounts.incoming THEN amounts.amount_minor ELSE -amounts.amount_minor END FROM amounts WHERE manual_funds_orders.id=$3`, s.NS(), "manual:"+o.ID+":"+phase, o.ID)
	return e
}
func (s *Service) Drain(ctx context.Context) (int, error) {
	if !s.Enabled() {
		return 0, fault("manual_funds_disabled", 503)
	}
	rows, e := s.DB.Query(ctx, `SELECT customer_id::text,id::text FROM manual_funds_orders WHERE namespace=$1 AND state IN ('reserving','processing','releasing') ORDER BY updated_at,id LIMIT 20`, s.NS())
	if e != nil {
		return 0, e
	}
	work := [][2]string{}
	for rows.Next() {
		var r [2]string
		if e = rows.Scan(&r[0], &r[1]); e != nil {
			break
		}
		work = append(work, r)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return 0, e
	}
	var first error
	for _, r := range work {
		task, cancel := context.WithTimeout(ctx, 30*time.Second)
		e = s.Process(task, r[0], r[1])
		cancel()
		if first == nil {
			first = e
		}
	}
	return len(work), first
}
