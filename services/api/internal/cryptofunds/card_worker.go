package cryptofunds

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"math/big"
	"moventra.local/api/internal/ledger"
)

func (s *Service) processCard(ctx context.Context, tx pgx.Tx, o Order) error {
	c, e := s.card(ctx, tx, o.CustomerID, o.CardID, false)
	if e != nil {
		return e
	}
	var key string
	e = tx.QueryRow(ctx, `SELECT account_key FROM ledger_accounts WHERE namespace=$1 AND customer_id=$2 AND id=$3 AND kind='card'`, s.NS(), o.CustomerID, c.AccountID).Scan(&key)
	if e != nil {
		return e
	}
	sourceKind, sourceKey, destKind, destKey := "wallet", "wallet-USD", "card", key
	if o.Direction == "card_to_wallet" {
		sourceKind, sourceKey, destKind, destKey = "card", key, "wallet", "wallet-USD"
	}
	hold := "crypto-hold:" + o.ID
	if o.State == "reserving" {
		if !c.CanOperate && o.Posting != "reserved" {
			return conflict("card_funds_not_ready")
		}
		var reserveExists bool
		if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ledger_operations WHERE namespace=$1 AND customer_id=$2 AND effect_key=$3)`, s.NS(), o.CustomerID, "crypto:"+o.ID+":reserve").Scan(&reserveExists); e != nil {
			return e
		}
		if o.Direction == "card_to_wallet" && !reserveExists {
			snap, err := s.Ledger.Snapshot(ctx, o.CustomerID)
			if err != nil {
				return err
			}
			available := new(big.Int)
			for _, a := range snap.Accounts {
				if a.ID == c.AccountID {
					available.SetString(a.AvailableMinor, 10)
				}
			}
			held, _ := new(big.Int).SetString(c.Held, 10)
			available.Sub(available, held)
			need, _ := new(big.Int).SetString(sum(o.Amount, o.Fee), 10)
			if available.Cmp(need) < 0 {
				o.State = "rejected"
				o.Posting = "not_posted"
				o.Error = "insufficient_balance"
				if e = s.Save(ctx, tx, &o, "", "worker"); e != nil {
					return e
				}
				return tx.Commit(ctx)
			}
		}
		e = s.move(ctx, o, "reserve", "USD", sum(o.Amount, o.Fee), sourceKind, sourceKey, "escrow", hold)
		if e == nil {
			o.State = "processing"
			o.Posting = "reserved"
		} else {
			var f *Fault
			if errors.As(e, &f) && f.Code == "insufficient_balance" {
				o.State = "rejected"
				o.Posting = "not_posted"
				o.Error = f.Code
				if err := s.Save(ctx, tx, &o, "", "worker"); err != nil {
					return err
				}
				return tx.Commit(ctx)
			}
			return e
		}
	}
	if o.State == "processing" || o.State == "unknown" {
		if s.Live != nil {
			if s.Live.Cards == nil {
				return conflict("card_provider_not_configured")
			}
			var raw []byte
			e = s.Ledger.DB.QueryRow(ctx, `SELECT request FROM funds_provider_requests WHERE namespace=$1 AND order_id=$2 AND kind='card_limit'`, s.NS(), o.ID).Scan(&raw)
			var plan struct{ Before, After string }
			if errors.Is(e, pgx.ErrNoRows) {
				plan.Before = c.Limit
				n, _ := new(big.Int).SetString(c.Limit, 10)
				change, _ := new(big.Int).SetString(o.Amount, 10)
				if o.Direction == "card_to_wallet" {
					change.SetString(sum(o.Amount, o.Fee), 10)
					n.Sub(n, change)
				} else {
					n.Add(n, change)
				}
				if n.Sign() < 0 {
					return conflict("card_limit_not_reconcilable")
				}
				plan.After = n.String()
				raw, _ = json.Marshal(plan)
				_, e = s.Ledger.DB.Exec(ctx, `INSERT INTO funds_provider_requests(namespace,order_id,kind,state,request) VALUES($1,$2,'card_limit','submitting',$3) ON CONFLICT DO NOTHING`, s.NS(), o.ID, raw)
			} else if e == nil {
				e = json.Unmarshal(raw, &plan)
			}
			if e != nil {
				return e
			}
			if e = s.Live.Cards.SetLimit(ctx, c, plan.Before, plan.After); e != nil {
				o.State = "unknown"
				o.Provider = "unknown"
				o.Error = "provider_outcome_unknown"
				if err := s.Save(ctx, tx, &o, "", "worker"); err != nil {
					return err
				}
				return tx.Commit(ctx)
			}
			_, e = tx.Exec(ctx, `UPDATE funds_cards SET limit_minor=$3 WHERE namespace=$1 AND id=$2`, s.NS(), c.ID, plan.After)
			if e != nil {
				return e
			}
			// Reconcile authorizations and postings AFTER reducing the limit. An old
			// snapshot cannot authorize a card-to-wallet release.
			if o.Direction == "card_to_wallet" {
				source, ok := s.Live.Cards.(CardSource)
				if !ok {
					return conflict("card_source_required")
				}
				state, err := source.ReadCard(ctx, c)
				if err != nil || state.Limit != plan.After {
					return conflict("card_source_not_ready")
				}
				for _, fact := range state.Facts {
					if err = s.recordCardFact(ctx, tx, o.CustomerID, c, fact); err != nil {
						return err
					}
				}
				snap, err := s.Ledger.Snapshot(ctx, o.CustomerID)
				if err != nil {
					return err
				}
				covered := false
				for _, a := range snap.Accounts {
					if a.ID == c.AccountID {
						remaining, valid := new(big.Int).SetString(a.AvailableMinor, 10)
						held, validHeld := new(big.Int).SetString(state.Held, 10)
						covered = valid && validHeld && held.Sign() >= 0 && remaining.Cmp(held) >= 0
					}
				}
				if !covered {
					return conflict("card_authorization_reconciliation_required")
				}
			}
			o.Provider = "confirmed"
		} else {
			o.Provider = "simulated_success"
		}
		e = s.move(ctx, o, "card-settle", "USD", o.Amount, "escrow", hold, destKind, destKey)
		if e == nil {
			e = s.move(ctx, o, "card-fee", "USD", o.Fee, "escrow", hold, "fee", "card-fees-USD")
		}
		if e == nil {
			o.State = "completed"
			o.Posting = "posted"
			o.Error = ""
		} else {
			o.State = "processing"
			o.Error = "accounting_recovery_pending"
		}
	}
	if err := s.Save(ctx, tx, &o, "", "worker"); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return e
}

// RecordCardFact is the trusted ingestion boundary for posted consumption and
// refunds. It never accepts browser-supplied state or changes historical ownership.
func (s *Service) RecordCardFact(ctx context.Context, customer, cardID string, p ledger.CardPosting) error {
	tx, e := s.Ledger.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = s.Lock(ctx, tx, customer); e != nil {
		return e
	}
	c, e := s.card(ctx, tx, customer, cardID, false)
	if e != nil {
		return e
	}
	if e = s.recordCardFact(ctx, tx, customer, c, p); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Service) recordCardFact(ctx context.Context, tx pgx.Tx, customer string, c FundsCard, p ledger.CardPosting) error {
	if p.ConnectionID != c.Connection || p.ExternalCardID != c.ExternalID {
		return conflict("card_scope_mismatch")
	}
	clearing, e := s.account(ctx, customer, "clearing", "USD", "clearing-USD")
	if e != nil {
		return e
	}
	op, e := s.Ledger.RecordCard(ctx, customer, c.AccountID, clearing.ID, p)
	if e != nil {
		return e
	}
	op, e = s.Ledger.Process(ctx, customer, op.ID)
	if e != nil {
		return e
	}
	if op.State != "applied" {
		return errors.New("ledger_pending")
	}
	if e = s.Audit(ctx, tx, customer, "", "", "card_posting", map[string]string{"operationId": op.ID, "sourceId": p.TransactionID}); e != nil {
		return e
	}
	return nil
}
