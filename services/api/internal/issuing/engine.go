package issuing

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"math/big"
	"moventra.local/api/internal/blnk"
	"time"
)

var ErrInsufficient = errors.New("insufficient_wallet_balance")
var ErrUnknown = errors.New("provider_outcome_unknown")
var ErrAccess = errors.New("provider_access_blocked")
var ErrRejected = errors.New("provider_rejected")

type Card struct {
	ID         string
	Last4      string
	Restricted bool
}
type Provider interface {
	Create(context.Context, string, Snapshot) (Card, error)
	Find(context.Context, string, Snapshot) (Card, error)
	Enable(context.Context, Card, Snapshot, string) error
}

func (s *Service) Wallet(ctx context.Context, tx pgx.Tx, customer string) (string, error) {
	if s.Blnk == nil {
		return "", ErrBlocked
	}
	var id string
	e := tx.QueryRow(ctx, `SELECT blnk_id FROM issuing_balances WHERE customer_id=$1 AND account_key='wallet'`, customer).Scan(&id)
	if e == pgx.ErrNoRows {
		return "0", nil
	}
	if e != nil {
		return "", e
	}
	b, e := s.Blnk.Balance(ctx, id)
	if e != nil {
		return "", e
	}
	if b.Currency != "USD" || b.LedgerID != "general_ledger_id" {
		return "", blnk.ErrConflict
	}
	return new(big.Int).Sub(b.Amount, b.InflightDebit).String(), nil
}
func (s *Service) balance(ctx context.Context, tx pgx.Tx, customer, key string) (string, error) {
	var id string
	e := tx.QueryRow(ctx, `SELECT blnk_id FROM issuing_balances WHERE customer_id=$1 AND account_key=$2`, customer, key).Scan(&id)
	if e == nil {
		return id, nil
	}
	if e != pgx.ErrNoRows {
		return "", e
	}
	b, e := s.Blnk.EnsureBalance(ctx, "general_ledger_id", "mvl_"+hash([]string{customer, key}), "USD", 100)
	if e != nil {
		return "", e
	}
	_, e = tx.Exec(ctx, `INSERT INTO issuing_balances(customer_id,account_key,blnk_id) VALUES($1,$2,$3)`, customer, key, b.ID)
	return b.ID, e
}
func (s *Service) transfer(ctx context.Context, tx pgx.Tx, customer, ref, source, dest, amount string, overdraft bool) error {
	if amount == "0" {
		return nil
	}
	a, e := s.balance(ctx, tx, customer, source)
	if e != nil {
		return e
	}
	b, e := s.balance(ctx, tx, customer, dest)
	if e != nil {
		return e
	}
	r := "mvl_" + hash(ref)
	v, e := s.Blnk.Apply(ctx, blnk.Transfer{Description: "Moventra live issuing", Reference: r, Source: a, Destination: b, Currency: "USD", Amount: number(amount), Precision: 100, AllowOverdraft: overdraft})
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO issuing_journal(reference,customer_id,transaction_id,source_id,destination_id,amount_minor) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(reference) DO NOTHING`, r, customer, v.ID, a, b, amount)
	return e
}
func (s *Service) state(ctx context.Context, tx pgx.Tx, o Order, state, code string) error {
	_, e := tx.Exec(ctx, `UPDATE issuing_orders SET state=$2,error_code=$3,retry_count=0,updated_at=now(),next_attempt_at=now()+CASE WHEN $3='provider_outcome_unknown' THEN interval '30 seconds' ELSE interval '1 second' END WHERE id=$1`, o.ID, state, code)
	if e != nil {
		return e
	}
	return Audit(ctx, tx, "", o.CustomerID, o.ID, "order."+state, map[string]string{"code": code})
}
func (s *Service) Process(ctx context.Context, id string) error {
	if !s.Enabled || s.Blnk == nil || !ValidID(id) {
		return ErrBlocked
	}
	conn, e := s.DB.Acquire(ctx)
	if e != nil {
		return e
	}
	defer conn.Release()
	var locked bool
	if e = conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtextextended($1,0))`, "issuing-worker:"+id).Scan(&locked); e != nil || !locked {
		return e
	}
	defer func() {
		c, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, err := conn.Exec(c, `SELECT pg_advisory_unlock(hashtextextended($1,0))`, "issuing-worker:"+id)
		if err != nil {
			_ = conn.Conn().Close(c)
		}
	}()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var o Order
	var raw []byte
	var supplierID string
	e = tx.QueryRow(ctx, `SELECT id::text,customer_id::text,product_id::text,state,fee_minor::text,funding_minor::text,external_card_id,last4,COALESCE(parent_id::text,''),snapshot,supplier_id::text FROM issuing_orders WHERE id=$1`, id).Scan(&o.ID, &o.CustomerID, &o.ProductID, &o.State, &o.FeeMinor, &o.FundingMinor, &o.CardID, &o.Last4, &o.ParentID, &raw, &supplierID)
	if e != nil {
		return e
	}
	if e = json.Unmarshal(raw, &o.Snapshot); e != nil {
		return e
	}
	if e = Lock(ctx, tx, o.CustomerID); e != nil {
		return e
	}
	provider := s.Providers[supplierID]
	var blocked bool
	if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_supplier_blocks WHERE supplier_id=$1)`, supplierID).Scan(&blocked); e != nil {
		return e
	}
	if blocked {
		provider = nil
	}
	transit := "order_" + id
	cardKey := "card_" + id
	if o.ParentID != "" {
		cardKey = "card_" + o.ParentID
	}
	next := func(state, code string) error {
		if e := s.state(ctx, tx, o, state, code); e != nil {
			return e
		}
		return tx.Commit(ctx)
	}
	switch o.State {
	case "queued":
		// A prior reserve may have applied before the SQL transaction rolled back.
		// Recover it before honoring a newly paused product or revoked customer.
		_, lookupErr := s.Blnk.Lookup(ctx, "mvl_"+hash(id+":reserve"))
		alreadyReserved := lookupErr == nil
		if lookupErr != nil && !errors.Is(lookupErr, blnk.ErrNotFound) {
			return lookupErr
		}
		if !alreadyReserved && (provider == nil || !vAllowed(ctx, tx, o.CustomerID)) {
			return next("failed", "execution_not_enabled")
		}
		if o.ParentID == "" && !alreadyReserved {
			p, e := product(ctx, tx, o.ProductID)
			if e != nil {
				return e
			}
			sp, e := supplier(ctx, tx, supplierID)
			if e != nil {
				return e
			}
			if p.Status != "active" || sp.Status != "active" {
				return next("failed", "product_or_supplier_paused")
			}
		}
		e = s.transfer(ctx, tx, o.CustomerID, id+":reserve", "wallet", transit, add(o.FeeMinor, o.FundingMinor), false)
		if errors.Is(e, blnk.ErrRejected) {
			return next("failed", "insufficient_wallet_balance")
		}
		if e != nil {
			return e
		}
		return next("reserved", "")
	case "reserved":
		if provider == nil || !vAllowed(ctx, tx, o.CustomerID) {
			return next("releasing", "execution_not_enabled")
		}
		if o.ParentID != "" {
			return next("fee_charged", "")
		}
		p, e := product(ctx, tx, o.ProductID)
		if e != nil {
			return e
		}
		sp, e := supplier(ctx, tx, supplierID)
		if e != nil {
			return e
		}
		if p.Status != "active" || sp.Status != "active" {
			return next("releasing", "product_or_supplier_paused")
		}
		if e = next("creating", ""); e != nil {
			return e
		}
		card, err := provider.Create(ctx, id, o.Snapshot)
		return s.recordCard(ctx, o, card, err)
	case "creating", "provider_unknown":
		if provider == nil {
			return ErrBlocked
		}
		if e = tx.Commit(ctx); e != nil {
			return e
		}
		card, err := provider.Find(ctx, id, o.Snapshot)
		return s.recordCard(ctx, o, card, err)
	case "created":
		e = s.transfer(ctx, tx, o.CustomerID, id+":fee", transit, "fee_revenue", o.FeeMinor, false)
		if e != nil {
			return e
		}
		return next("fee_charged", "")
	case "fee_charged":
		if provider == nil || !vAllowed(ctx, tx, o.CustomerID) {
			return ErrBlocked
		}
		e = s.transfer(ctx, tx, o.CustomerID, id+":fund", transit, cardKey, o.FundingMinor, false)
		if e != nil {
			return e
		}
		return next("funded", "")
	case "funded", "enabling":
		if provider == nil || !vAllowed(ctx, tx, o.CustomerID) {
			return ErrBlocked
		}
		if e = next("enabling", ""); e != nil {
			return e
		}
		err := provider.Enable(ctx, Card{ID: o.CardID, Last4: o.Last4}, o.Snapshot, o.FundingMinor)
		tx, e = s.DB.Begin(ctx)
		if e != nil {
			return e
		}
		defer tx.Rollback(ctx)
		if e = Lock(ctx, tx, o.CustomerID); e != nil {
			return e
		}
		if errors.Is(err, ErrAccess) {
			if _, e = tx.Exec(ctx, `INSERT INTO issuing_supplier_blocks(supplier_id,reason) VALUES($1,'provider_access_denied') ON CONFLICT DO NOTHING`, supplierID); e != nil {
				return e
			}
		}
		if errors.Is(err, ErrRejected) {
			e = s.transfer(ctx, tx, o.CustomerID, id+":unfund", cardKey, "wallet", o.FundingMinor, false)
			if e != nil {
				return e
			}
			if e = s.state(ctx, tx, o, "funding_failed", "funding_rejected"); e != nil {
				return e
			}
		} else if err != nil {
			if e = s.state(ctx, tx, o, "enabling", "provider_outcome_unknown"); e != nil {
				return e
			}
		} else {
			if e = s.state(ctx, tx, o, "active", ""); e != nil {
				return e
			}
			if o.ParentID != "" {
				_, e = tx.Exec(ctx, `UPDATE issuing_orders SET state='active',error_code='',updated_at=now() WHERE id=$1 AND customer_id=$2`, o.ParentID, o.CustomerID)
				if e != nil {
					return e
				}
			}
		}
		return tx.Commit(ctx)
	case "releasing":
		e = s.transfer(ctx, tx, o.CustomerID, id+":release", transit, "wallet", add(o.FeeMinor, o.FundingMinor), false)
		if e != nil {
			return e
		}
		return next("failed", "creation_failed")
	}
	return nil
}
func (s *Service) recordCard(ctx context.Context, o Order, c Card, providerErr error) error {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = Lock(ctx, tx, o.CustomerID); e != nil {
		return e
	}
	state, code := "provider_unknown", "provider_outcome_unknown"
	if errors.Is(providerErr, ErrAccess) {
		if _, e = tx.Exec(ctx, `INSERT INTO issuing_supplier_blocks(supplier_id,reason) VALUES($1,'provider_access_denied') ON CONFLICT DO NOTHING`, o.Snapshot.Supplier.ID); e != nil {
			return e
		}
	}
	if (errors.Is(providerErr, ErrRejected) || errors.Is(providerErr, ErrAccess)) && o.State == "reserved" {
		state, code = "releasing", "creation_rejected"
	} else if providerErr == nil && c.ID != "" {
		state, code = "created", ""
		if !c.Restricted {
			state, code = "review_required", "card_restriction_unverified"
		}
		_, e = tx.Exec(ctx, `UPDATE issuing_orders SET external_card_id=$2,last4=$3 WHERE id=$1 AND (external_card_id='' OR external_card_id=$2)`, o.ID, c.ID, c.Last4)
		if e != nil {
			return e
		}
	}
	if e = s.state(ctx, tx, o, state, code); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Service) ProcessDeposit(ctx context.Context, id string) error {
	if !s.Enabled || s.Blnk == nil {
		return ErrBlocked
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var customer, amount, state string
	e = tx.QueryRow(ctx, `SELECT customer_id::text,amount_minor::text,state FROM issuing_deposits WHERE id=$1 FOR UPDATE`, id).Scan(&customer, &amount, &state)
	if e != nil {
		return e
	}
	if state != "approved" {
		return nil
	}
	if e = Lock(ctx, tx, customer); e != nil {
		return e
	}
	e = s.transfer(ctx, tx, customer, id+":deposit", "funding_control", "wallet", amount, true)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `UPDATE issuing_deposits SET state='applied',revision=revision+1 WHERE id=$1`, id)
	if e != nil {
		return e
	}
	if e = Audit(ctx, tx, "", customer, id, "deposit.applied", map[string]string{"amountMinor": amount}); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Service) Tick(ctx context.Context) error {
	rows, e := s.DB.Query(ctx, `SELECT id::text,'order' FROM issuing_orders WHERE state NOT IN ('active','failed','funding_failed','review_required') AND next_attempt_at<=now() UNION ALL SELECT id::text,'deposit' FROM issuing_deposits WHERE state='approved' LIMIT 20`)
	if e != nil {
		return e
	}
	type job struct{ id, kind string }
	jobs := []job{}
	for rows.Next() {
		var j job
		if e = rows.Scan(&j.id, &j.kind); e != nil {
			rows.Close()
			return e
		}
		jobs = append(jobs, j)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	var last error
	for _, j := range jobs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if j.kind == "deposit" {
			e = s.ProcessDeposit(ctx, j.id)
		} else {
			e = s.Process(ctx, j.id)
		}
		if e != nil {
			last = e
			if j.kind == "order" {
				_, scheduleErr := s.DB.Exec(ctx, `UPDATE issuing_orders SET retry_count=LEAST(retry_count+1,10),next_attempt_at=now()+make_interval(secs => LEAST(300,5*power(2,LEAST(retry_count,6)))::double precision) WHERE id=$1`, j.id)
				if scheduleErr != nil {
					last = scheduleErr
				}
			}
		}
	}
	rows, e = s.DB.Query(ctx, `SELECT o.id::text FROM issuing_orders o LEFT JOIN issuing_sync s ON s.order_id=o.id WHERE o.parent_id IS NULL AND o.external_card_id<>'' AND (s.next_attempt_at IS NULL OR s.next_attempt_at<=now()) ORDER BY s.next_attempt_at NULLS FIRST,o.created_at LIMIT 5`)
	if e != nil {
		return e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return e
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, id := range ids {
		if e = s.SyncCard(ctx, id); e != nil {
			last = e
		}
	}
	return last
}
