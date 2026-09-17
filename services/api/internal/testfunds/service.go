package testfunds

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"math/big"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Authorize locks the customer for mutation, making balance checks and holds serial.
func Authorize(ctx context.Context, tx pgx.Tx, customer, actor string, admin, write bool) (bool, bool, error) {
	var owner, onboard, service string
	suffix := " FOR SHARE"
	if write {
		suffix = " FOR UPDATE"
	}
	e := tx.QueryRow(ctx, `SELECT personal_owner_id::text,onboarding_status,service_status FROM customers WHERE id=$1 AND kind='personal'`+suffix, customer).Scan(&owner, &onboard, &service)
	if errors.Is(e, pgx.ErrNoRows) {
		return false, false, &Fault{"not_found", 404}
	}
	if e != nil {
		return false, false, e
	}
	var active bool
	role := "customer"
	if admin {
		role = "admin"
	}
	e = tx.QueryRow(ctx, `SELECT status='active' AND role=$2 FROM users WHERE id=$1 FOR SHARE`, actor, role).Scan(&active)
	if e != nil {
		return false, false, e
	}
	if !active {
		return false, false, &Fault{"user_disabled", 403}
	}
	if admin {
		var scope string
		e = tx.QueryRow(ctx, `SELECT reason FROM online_test_funds_review_grants WHERE user_id=$1 AND customer_id=$2 FOR SHARE`, actor, customer).Scan(&scope)
		if errors.Is(e, pgx.ErrNoRows) || owner == actor {
			return false, false, &Fault{"not_found", 404}
		}
		if e != nil {
			return false, false, e
		}
	} else if owner != actor {
		return false, false, &Fault{"not_found", 404}
	}
	var enabled bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM online_test_wallet_grants WHERE customer_id=$1)`, customer).Scan(&enabled)
	return enabled, onboard == "approved" && service == "active", e
}
func List(ctx context.Context, tx pgx.Tx, customer, kind, status string, page int, enabled, operate bool) (Snapshot, error) {
	out := Snapshot{Mode: "online_test", CustomerID: customer, Enabled: enabled, CanOperate: enabled && operate, Balances: []Balance{}, Orders: []Order{}, Page: page, Policy: "test-v1"}
	var e error
	if !enabled {
		return out, nil
	}
	out.Balances, e = Balances(ctx, tx, customer)
	if e != nil {
		return out, e
	}
	e = tx.QueryRow(ctx, `SELECT count(*) FROM online_test_funds_orders WHERE customer_id=$1 AND ($2='' OR kind=$2) AND ($3='' OR status=$3)`, customer, kind, status).Scan(&out.Total)
	if e != nil {
		return out, e
	}
	rows, e := tx.Query(ctx, `SELECT `+columns+` FROM online_test_funds_orders WHERE customer_id=$1 AND ($2='' OR kind=$2) AND ($3='' OR status=$3) ORDER BY created_at DESC,id LIMIT 20 OFFSET $4`, customer, kind, status, page*20)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return out, err
		}
		out.Orders = append(out.Orders, o)
	}
	return out, rows.Err()
}
func recordEvent(ctx context.Context, tx pgx.Tx, o Order, actor, action, note string) error {
	_, e := tx.Exec(ctx, `INSERT INTO online_test_funds_events(customer_id,order_id,actor_id,action,status,revision,note) VALUES($1,$2,$3,$4,$5,$6,$7)`, o.CustomerID, o.ID, actor, action, o.Status, o.Revision, note)
	return e
}
func movement(ctx context.Context, tx pgx.Tx, o Order, c string, n int64) error {
	_, e := tx.Exec(ctx, `INSERT INTO online_test_funds_movements(customer_id,order_id,currency,wallet_delta_minor,counter_delta_minor) VALUES($1,$2,$3,$4,$5)`, o.CustomerID, o.ID, c, n, -n)
	return e
}
func quoteMath(n int64, c string) (fee, receive int64) {
	fee = (n*50 + 9999) / 10000
	net := big.NewInt(n - fee)
	// Fixed reversible rate: 1 USDT = 0.99 USD, precision-adjusted entirely in integers.
	if c == "USDT" {
		net.Mul(net, big.NewInt(99))
		net.Div(net, big.NewInt(1000000))
	} else {
		net.Mul(net, big.NewInt(1000000))
		net.Div(net, big.NewInt(99))
	}
	return fee, net.Int64()
}
func Execute(ctx context.Context, tx pgx.Tx, customer, actor, key string, admin, operate bool, in Input) (json.RawMessage, error) {
	if _, e := uuid.Parse(key); e != nil {
		return nil, Invalid("idempotency_key_required")
	}
	if len([]rune(in.Note)) > 500 || len([]rune(in.RecipientLabel)) > 120 {
		return nil, Invalid("invalid_body")
	}
	if admin && strings.TrimSpace(in.Note) == "" {
		return nil, Invalid("review_reason_required")
	}
	payload, _ := json.Marshal(in)
	hash := fmt.Sprintf("%x", sha256.Sum256(payload))
	var priorHash string
	var prior json.RawMessage
	e := tx.QueryRow(ctx, `SELECT request_hash,result FROM online_test_funds_commands WHERE customer_id=$1 AND actor_id=$2 AND request_id=$3`, customer, actor, key).Scan(&priorHash, &prior)
	if e == nil {
		if hash != priorHash {
			return nil, bad("idempotency_conflict")
		}
		return prior, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return nil, e
	}
	var result Result
	if admin {
		if !slices.Contains([]string{"detect", "approve", "reject", "unknown", "complete", "fail"}, in.Action) {
			return nil, &Fault{"operation_not_permitted", 403}
		}
	} else if !slices.Contains([]string{"deposit", "quote", "exchange", "withdraw", "cancel"}, in.Action) {
		return nil, &Fault{"operation_not_permitted", 403}
	}
	if !admin && in.Action != "cancel" && !operate {
		return nil, &Fault{"funds_not_active", 403}
	}
	switch in.Action {
	case "quote":
		n, err := amount(in.AmountMinor, in.Currency)
		if err != nil {
			return nil, err
		}
		fee, receive := quoteMath(n, in.Currency)
		if receive <= 0 || fee >= n {
			return nil, Invalid("amount_too_small")
		}
		if err = ensureAvailable(ctx, tx, customer, in.Currency, n); err != nil {
			return nil, err
		}
		q := Quote{ID: uuid.NewString(), Currency: in.Currency, ToCurrency: opposite(in.Currency), Amount: in.AmountMinor, Fee: strconv.FormatInt(fee, 10), Receive: strconv.FormatInt(receive, 10), Expires: time.Now().UTC().Add(time.Minute), Policy: "test-v1"}
		_, err = tx.Exec(ctx, `INSERT INTO online_test_funds_quotes(id,customer_id,actor_id,currency,amount_minor,fee_minor,receive_minor,policy_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, q.ID, customer, actor, q.Currency, n, fee, receive, q.Policy, q.Expires)
		if err != nil {
			return nil, err
		}
		result.Quote = &q
	case "deposit", "withdraw", "exchange":
		o := Order{ID: uuid.NewString(), CustomerID: customer, ActorID: actor, Kind: in.Action, Currency: in.Currency, Amount: in.AmountMinor, Fee: "0", Receive: in.AmountMinor, Status: "pending", Revision: 1, Recipient: strings.TrimSpace(in.RecipientLabel)}
		var quoteID *string
		var n, fee, receive int64
		var err error
		if in.Action == "exchange" {
			if _, err = uuid.Parse(in.QuoteID); err != nil {
				return nil, Invalid("invalid_quote_id")
			}
			var expires time.Time
			var used bool
			var policy string
			err = tx.QueryRow(ctx, `SELECT q.currency,q.amount_minor,q.fee_minor,q.receive_minor,q.expires_at,q.policy_version,EXISTS(SELECT 1 FROM online_test_funds_orders o WHERE o.quote_id=q.id) FROM online_test_funds_quotes q WHERE q.id=$1 AND q.customer_id=$2 AND q.actor_id=$3`, in.QuoteID, customer, actor).Scan(&o.Currency, &n, &fee, &receive, &expires, &policy, &used)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, &Fault{"not_found", 404}
			}
			if err != nil {
				return nil, err
			}
			if used {
				return nil, bad("quote_used")
			}
			if !time.Now().Before(expires) || policy != "test-v1" {
				return nil, bad("quote_expired")
			}
			quoteID = &in.QuoteID
			o.Status = "completed"
			o.Amount = strconv.FormatInt(n, 10)
			o.Fee = strconv.FormatInt(fee, 10)
			o.Receive = strconv.FormatInt(receive, 10)
			if err = ensureAvailable(ctx, tx, customer, o.Currency, n); err != nil {
				return nil, err
			}
		} else {
			n, err = amount(in.AmountMinor, in.Currency)
			if err != nil {
				return nil, err
			}
			receive = n
			if in.Action == "withdraw" {
				if o.Recipient == "" {
					return nil, Invalid("test_recipient_required")
				}
				if in.Currency == "USDT" {
					fee = 2000000
				}
				if err = ensureAvailable(ctx, tx, customer, o.Currency, n+fee); err != nil {
					return nil, err
				}
				o.Status = "pending_review"
				o.Fee = strconv.FormatInt(fee, 10)
			}
		}
		o.ToCurrency = o.Currency
		if o.Kind == "exchange" {
			o.ToCurrency = opposite(o.Currency)
		}
		err = tx.QueryRow(ctx, `INSERT INTO online_test_funds_orders(id,customer_id,actor_id,kind,currency,amount_minor,fee_minor,receive_minor,quote_id,recipient_label,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING created_at,updated_at`, o.ID, customer, actor, o.Kind, o.Currency, n, fee, receive, quoteID, o.Recipient, o.Status).Scan(&o.Created, &o.Updated)
		if err != nil {
			return nil, err
		}
		if o.Kind == "exchange" {
			if err = movement(ctx, tx, o, o.Currency, -n); err != nil {
				return nil, err
			}
			if err = movement(ctx, tx, o, o.ToCurrency, receive); err != nil {
				return nil, err
			}
		}
		if err = recordEvent(ctx, tx, o, actor, in.Action, in.Note); err != nil {
			return nil, err
		}
		result.Order = &o
	default:
		if _, err := uuid.Parse(in.OrderID); err != nil {
			return nil, Invalid("invalid_order_id")
		}
		o, _, err := GetOrder(ctx, tx, customer, in.OrderID)
		if err != nil {
			return nil, err
		}
		if in.Revision != o.Revision {
			return nil, bad("order_changed")
		}
		if admin && o.ActorID == actor {
			return nil, &Fault{"self_review_forbidden", 403}
		}
		next := ""
		if o.Kind == "deposit" {
			switch in.Action {
			case "cancel":
				if o.Status == "pending" {
					next = "cancelled"
				}
			case "detect":
				if o.Status == "pending" {
					next = "confirming"
				}
			case "complete":
				if o.Status == "confirming" {
					next = "completed"
				}
			case "reject", "fail":
				if o.Status == "pending" || o.Status == "confirming" {
					if in.Action == "reject" {
						next = "rejected"
					} else {
						next = "failed"
					}
				}
			}
		}
		if o.Kind == "withdraw" {
			switch in.Action {
			case "cancel":
				if o.Status == "pending_review" {
					next = "cancelled"
				}
			case "approve":
				if o.Status == "pending_review" {
					next = "processing"
				}
			case "reject":
				if o.Status == "pending_review" {
					next = "rejected"
				}
			case "unknown":
				if o.Status == "processing" {
					next = "unknown"
				}
			case "complete", "fail":
				if o.Status == "processing" || o.Status == "unknown" {
					if in.Action == "complete" {
						next = "completed"
					} else {
						next = "failed"
					}
				}
			}
		}
		if next == "" {
			return nil, bad("invalid_funds_transition")
		}
		o.Status = next
		o.Revision++
		err = tx.QueryRow(ctx, `UPDATE online_test_funds_orders SET status=$3,revision=$4,updated_at=now() WHERE customer_id=$1 AND id=$2 RETURNING updated_at`, customer, o.ID, o.Status, o.Revision).Scan(&o.Updated)
		if err != nil {
			return nil, err
		}
		if next == "completed" {
			n, _ := strconv.ParseInt(o.Amount, 10, 64)
			fee, _ := strconv.ParseInt(o.Fee, 10, 64)
			if o.Kind == "withdraw" {
				n = -(n + fee)
			}
			if err = movement(ctx, tx, o, o.Currency, n); err != nil {
				return nil, err
			}
		}
		if err = recordEvent(ctx, tx, o, actor, in.Action, in.Note); err != nil {
			return nil, err
		}
		result.Order = &o
	}
	if _, e = Balances(ctx, tx, customer); e != nil {
		return nil, e
	}
	raw, e := json.Marshal(result)
	if e != nil {
		return nil, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,$3)`, actor, customer, "test-funds:"+in.Action+":"+key)
	if e != nil {
		return nil, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO online_test_funds_commands(customer_id,actor_id,request_id,request_hash,result) VALUES($1,$2,$3,$4,$5)`, customer, actor, key, hash, raw)
	return raw, e
}
