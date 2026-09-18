package cryptofunds

import (
	"context"
	"errors"
	"moventra.local/api/internal/ledger"
	"moventra.local/api/internal/tron"

	"time"
)

func validRecipient(s string) bool { _, e := tron.AddressHex(s); return e == nil }
func (s *Service) account(ctx context.Context, customer, kind, currency, key string) (ledger.Account, error) {
	if kind == "card" {
		var a ledger.Account
		var raw string
		e := s.Ledger.DB.QueryRow(ctx, `SELECT id::text,account_key,connection_id,external_card_id,blnk_balance_id FROM ledger_accounts WHERE namespace=$1 AND customer_id=$2 AND account_key=$3 AND kind='card'`, s.NS(), customer, key).Scan(&a.ID, &a.Key, &a.ConnectionID, &a.ExternalCardID, &raw)
		if e != nil {
			return a, e
		}
		a.CustomerID = customer
		a.Kind = kind
		a.Currency = currency
		a.Scale = 2
		return a, nil
	}
	return s.Ledger.Provision(ctx, ledger.AccountSpec{CustomerID: customer, Kind: kind, Currency: currency, Key: key})
}
func (s *Service) move(ctx context.Context, o Order, phase, currency, amount, fromKind, fromKey, toKind, toKey string) error {
	if amount == "0" {
		return nil
	}
	a, e := s.account(ctx, o.CustomerID, fromKind, currency, fromKey)
	if e != nil {
		return e
	}
	b, e := s.account(ctx, o.CustomerID, toKind, currency, toKey)
	if e != nil {
		return e
	}
	op, e := s.Ledger.Submit(ctx, ledger.Command{CustomerID: o.CustomerID, EffectKey: "crypto:" + o.ID + ":" + phase, Kind: "crypto_move", SourceID: a.ID, DestinationID: b.ID, AmountMinor: amount, EvidenceRef: "crypto-order:" + o.ID})
	if e != nil {
		return e
	}
	op, e = s.Ledger.Process(ctx, o.CustomerID, op.ID)
	if op.State == "rejected" {
		return conflict("insufficient_balance")
	}
	if e != nil {
		return e
	}
	if op.State != "applied" {
		return errors.New("ledger_pending")
	}
	return nil
}

// Process holds the order lock while replaying deterministic ledger steps.
// Ledger transactions use a different advisory key; a failed local commit is
// recovered by Blnk references and never produces a second balance mutation.
func (s *Service) Process(ctx context.Context, customer, id string) error {
	tx, e := s.Ledger.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = s.Lock(ctx, tx, customer); e != nil {
		return e
	}
	o, e := s.Get(ctx, tx, customer, id)
	if e != nil {
		return e
	}
	if s.Pilot != nil {
		if customer != s.Pilot.Customer || o.Kind != "deposit" || o.Network != "TRC20" || o.Address != s.Pilot.Address || o.Currency != "USDT" || o.Fee != "0" || (o.State != "processing" && o.State != "completed") {
			return errors.New("deposit_pilot_scope_rejected")
		}
		if e = s.pilotCapacity(ctx, tx, "0"); e != nil {
			return e
		}
	}
	if o.Kind == "card_transfer" {
		return s.processCard(ctx, tx, o)
	}
	oldState := o.State
	if s.Live != nil && o.State == "unknown" {
		o.State = "processing"
	}
	hold := "crypto-hold:" + o.ID
	buyHold := "crypto-buy:" + o.ID
	move := func(phase, currency, amount, fk, f, tk, t string) error {
		return s.move(ctx, o, phase, currency, amount, fk, f, tk, t)
	}
	if o.State == "reserving" {
		e = move("reserve", o.Currency, sum(o.Amount, o.Fee), "wallet", "wallet-"+o.Currency, "escrow", hold)
		if e == nil {
			if o.Kind == "withdrawal" {
				o.State = "pending_review"
			} else {
				o.State = "processing"
			}
			o.Posting = "reserved"
		} else {
			var f *Fault
			if errors.As(e, &f) && f.Code == "insufficient_balance" {
				o.State = "rejected"
				o.Posting = "not_posted"
				o.Error = f.Code
				e = nil
			}
		}
	}
	if e == nil && o.State == "releasing" {
		e = move("release", o.Currency, sum(o.Amount, o.Fee), "escrow", hold, "wallet", "wallet-"+o.Currency)
		if e == nil {
			o.State = o.Resolution
			o.Posting = "released"
		}
	}
	if e == nil && o.State == "processing" {
		if o.Kind == "deposit" {
			if o.Proof == nil {
				return invalid("missing_deposit_proof")
			}
			wallet, err := s.account(ctx, o.CustomerID, "wallet", "USDT", "wallet-USDT")
			if err != nil {
				return err
			}
			clearing, err := s.account(ctx, o.CustomerID, "clearing", "USDT", "clearing-USDT")
			if err != nil {
				return err
			}
			network := o.Network
			if network == "" {
				network = "tron-fixture"
			}
			if s.Live != nil {
				n := s.Live.Networks[network]
				if n.Contract != o.Contract || o.Chain != "finalized" {
					return invalid("unverified_live_deposit")
				}
			}
			if err = s.Ledger.RegisterCryptoAsset(ctx, network, o.Contract); err != nil {
				return err
			}
			op, err := s.Ledger.RecordCrypto(ctx, o.CustomerID, wallet.ID, clearing.ID, ledger.CryptoCredit{Network: network, AssetID: o.Contract, TransactionHash: o.Proof.TransactionHash, TransferIndex: o.Proof.TransferIndex, AmountMinor: o.Amount, EvidenceRef: o.Evidence, FinalityVerified: true})
			if err == nil {
				op, err = s.Ledger.Process(ctx, o.CustomerID, op.ID)
			}
			e = err
			if e == nil && op.State != "applied" {
				e = errors.New("ledger_pending")
			}
		} else if o.Kind == "otc" {
			// Buy credit remains unavailable until the source leg is settled.
			e = move("buy-reserve", o.ToCurrency, o.Receive, "clearing", "clearing-"+o.ToCurrency, "escrow", buyHold)
			if e == nil {
				e = move("sell-settle", o.Currency, o.Amount, "escrow", hold, "clearing", "clearing-"+o.Currency)
			}
			if e == nil {
				e = move("buy-release", o.ToCurrency, o.Receive, "escrow", buyHold, "wallet", "wallet-"+o.ToCurrency)
			}
		} else if o.Kind == "withdrawal" {
			if s.Live != nil {
				outcome, hash, err := s.payout(ctx, o)
				if outcome == "confirmed" && err == nil {
					o.Provider = "confirmed"
					o.Chain = "finalized"
					o.TransactionHash = hash
					e = move("payout", o.Currency, o.Amount, "escrow", hold, "clearing", "clearing-"+o.Currency)
					if e == nil {
						e = move("fee", o.Currency, o.Fee, "escrow", hold, "fee", "withdrawal-fees-"+o.Currency)
					}
				} else if outcome == "failed" && err == nil {
					o.Provider = "failed"
					o.Resolution = "failed"
					o.State = "releasing"
				} else {
					o.Provider = "unknown"
					o.State = "unknown"
					o.Error = "provider_outcome_unknown"
					e = err
				}
			} else {
				// This release has no real payout executor. The simulator has a stable
				// result per order; tests may inject unknown/failure through ResolveSimulation.
				if o.Resolution == "unknown" {
					o.State = "unknown"
					o.Provider = "simulated_unknown"
					o.Error = "provider_outcome_unknown"
				} else if o.Resolution == "failed" {
					o.State = "releasing"
					o.Provider = "simulated_failed"
				} else {
					o.Provider = "simulated_success"
					o.Chain = "simulated_verified"
					o.Evidence = "synthetic:payout:" + o.ID
					e = move("payout", o.Currency, o.Amount, "escrow", hold, "clearing", "clearing-"+o.Currency)
					if e == nil {
						e = move("fee", o.Currency, o.Fee, "escrow", hold, "fee", "withdrawal-fees-"+o.Currency)
					}
				}
			}
		} else {
			return invalid("invalid_worker_order")
		}
		if e == nil && o.State == "processing" {
			o.State = "completed"
			o.Posting = "posted"
			o.Error = ""
		}
	}
	if e != nil {
		o.Error = "accounting_recovery_pending"
	}
	if o.State == oldState && o.State != "processing" && o.State != "reserving" && o.State != "releasing" {
		return nil
	}
	if err := s.Save(ctx, tx, &o, "", "worker"); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return e
}
func (s *Service) Drain(ctx context.Context) (int, error) {
	if s.Live != nil {
		if e := s.SyncCards(ctx); e != nil {
			return 0, e
		}
		if e := s.CreateAddresses(ctx); e != nil {
			return 0, e
		}
		if e := s.ProcessLiveEvents(ctx); e != nil {
			return 0, e
		}
	}
	rows, e := s.Ledger.DB.Query(ctx, `SELECT customer_id::text,id::text FROM crypto_orders WHERE namespace=$1 AND state IN ('reserving','processing','releasing','unknown') ORDER BY updated_at,id LIMIT 50`, s.NS())
	if e != nil {
		return 0, e
	}
	var work [][2]string
	for rows.Next() {
		var r [2]string
		if e = rows.Scan(&r[0], &r[1]); e != nil {
			rows.Close()
			return 0, e
		}
		work = append(work, r)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return 0, e
	}
	var first error
	for _, r := range work {
		taskCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		e = s.Process(taskCtx, r[0], r[1])
		cancel()
		if first == nil {
			first = e
		}
	}
	return len(work), first
}

// Trusted isolated fixture hook, not an HTTP route and never a provider fact.
func (s *Service) ResolveSimulation(ctx context.Context, customer, id, outcome string) error {
	if s.Ledger.IsLive() {
		return invalid("fixture_forbidden")
	}
	if outcome != "unknown" && outcome != "failed" && outcome != "confirmed" {
		return invalid("invalid_outcome")
	}
	tx, e := s.Ledger.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = s.Lock(ctx, tx, customer); e != nil {
		return e
	}
	o, e := s.Get(ctx, tx, customer, id)
	if e != nil {
		return e
	}
	if o.Kind != "withdrawal" || o.State != "processing" && o.State != "unknown" {
		return conflict("order_changed")
	}
	o.Resolution = outcome
	o.State = "processing"
	if e = s.Save(ctx, tx, &o, "", "synthetic_resolution"); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
