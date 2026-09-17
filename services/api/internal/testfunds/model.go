// Package testfunds operates only on synthetic online testing credits.
// It has no provider clients, payout executors or access to real ledger balances.
package testfunds

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"math/big"
	"strconv"
	"time"
)

type Fault struct {
	Code   string
	Status int
}

func (e *Fault) Error() string   { return e.Code }
func bad(code string) *Fault     { return &Fault{code, 409} }
func Invalid(code string) *Fault { return &Fault{code, 400} }
func opposite(c string) string {
	if c == "USD" {
		return "USDT"
	}
	return "USD"
}
func scale(c string) int {
	if c == "USD" {
		return 2
	}
	return 6
}
func amount(s, c string) (int64, error) {
	n, e := strconv.ParseInt(s, 10, 64)
	limit := int64(100000000)
	if c == "USDT" {
		limit = 1000000000000
	} else if c != "USD" {
		return 0, Invalid("invalid_currency")
	}
	if e != nil || n <= 0 || n > limit || strconv.FormatInt(n, 10) != s {
		return 0, Invalid("invalid_amount")
	}
	return n, nil
}

type Input struct {
	Action         string `json:"action"`
	Currency       string `json:"currency,omitempty"`
	AmountMinor    string `json:"amountMinor,omitempty"`
	QuoteID        string `json:"quoteId,omitempty"`
	OrderID        string `json:"orderId,omitempty"`
	Revision       int64  `json:"revision,omitempty"`
	RecipientLabel string `json:"recipientLabel,omitempty"`
	Note           string `json:"note,omitempty"`
}
type Balance struct {
	Currency  string `json:"currency"`
	Scale     int    `json:"scale"`
	Posted    string `json:"postedMinor"`
	Held      string `json:"heldMinor"`
	Available string `json:"availableMinor"`
}
type Quote struct {
	ID         string    `json:"id"`
	Currency   string    `json:"currency"`
	ToCurrency string    `json:"toCurrency"`
	Amount     string    `json:"amountMinor"`
	Fee        string    `json:"feeMinor"`
	Receive    string    `json:"receiveMinor"`
	Expires    time.Time `json:"expiresAt"`
	Policy     string    `json:"policyVersion"`
}
type Order struct {
	ID         string    `json:"id"`
	CustomerID string    `json:"customerId"`
	ActorID    string    `json:"actorId"`
	Kind       string    `json:"kind"`
	Currency   string    `json:"currency"`
	ToCurrency string    `json:"toCurrency"`
	Amount     string    `json:"amountMinor"`
	Fee        string    `json:"feeMinor"`
	Receive    string    `json:"receiveMinor"`
	Recipient  string    `json:"recipientLabel"`
	Status     string    `json:"status"`
	Revision   int64     `json:"revision"`
	Created    time.Time `json:"createdAt"`
	Updated    time.Time `json:"updatedAt"`
}
type Event struct {
	Action   string    `json:"action"`
	Status   string    `json:"status"`
	Note     string    `json:"note"`
	Revision int64     `json:"revision"`
	Created  time.Time `json:"createdAt"`
}
type Result struct {
	Quote *Quote `json:"quote,omitempty"`
	Order *Order `json:"order,omitempty"`
}
type Snapshot struct {
	Mode               string    `json:"mode"`
	ExecutionEligible  bool      `json:"executionEligible"`
	WithdrawalEligible bool      `json:"withdrawalEligible"`
	CustomerID         string    `json:"customerId"`
	Enabled            bool      `json:"enabled"`
	CanOperate         bool      `json:"canOperate"`
	Balances           []Balance `json:"balances"`
	Orders             []Order   `json:"orders"`
	Total              int       `json:"total"`
	Page               int       `json:"page"`
	Policy             string    `json:"policyVersion"`
}

func Balances(ctx context.Context, tx pgx.Tx, customer string) ([]Balance, error) {
	out := []Balance{}
	for _, c := range []string{"USD", "USDT"} {
		var posted, held string
		e := tx.QueryRow(ctx, `SELECT (COALESCE((SELECT sum(CASE WHEN $2='USD' THEN usd_minor ELSE usdt_minor END) FROM online_test_wallet_grants WHERE customer_id=$1),0)+COALESCE((SELECT sum(wallet_delta_minor) FROM online_test_funds_movements WHERE customer_id=$1 AND currency=$2),0))::text,COALESCE((SELECT sum(amount_minor::numeric+fee_minor) FROM online_test_funds_orders WHERE customer_id=$1 AND currency=$2 AND kind='withdraw' AND status IN ('pending_review','processing','unknown')),0)::text`, customer, c).Scan(&posted, &held)
		if e != nil {
			return nil, e
		}
		p, ok := new(big.Int).SetString(posted, 10)
		if !ok {
			return nil, errors.New("balance_invalid")
		}
		h, ok := new(big.Int).SetString(held, 10)
		if !ok {
			return nil, errors.New("hold_invalid")
		}
		a := new(big.Int).Sub(p, h)
		if a.Sign() < 0 {
			return nil, errors.New("test_wallet_invariant_failed")
		}
		out = append(out, Balance{c, scale(c), posted, held, a.String()})
	}
	return out, nil
}
func ensureAvailable(ctx context.Context, tx pgx.Tx, customer, c string, n int64) error {
	bs, e := Balances(ctx, tx, customer)
	if e != nil {
		return e
	}
	for _, b := range bs {
		if b.Currency == c {
			a, _ := new(big.Int).SetString(b.Available, 10)
			if a.Cmp(big.NewInt(n)) >= 0 {
				return nil
			}
		}
	}
	return bad("insufficient_test_balance")
}

const columns = `id::text,customer_id::text,actor_id::text,kind,currency,amount_minor::text,fee_minor::text,receive_minor::text,recipient_label,status,revision,created_at,updated_at`

func scanOrder(row pgx.Row) (Order, error) {
	var o Order
	e := row.Scan(&o.ID, &o.CustomerID, &o.ActorID, &o.Kind, &o.Currency, &o.Amount, &o.Fee, &o.Receive, &o.Recipient, &o.Status, &o.Revision, &o.Created, &o.Updated)
	o.ToCurrency = o.Currency
	if o.Kind == "exchange" {
		o.ToCurrency = opposite(o.Currency)
	}
	if errors.Is(e, pgx.ErrNoRows) {
		return o, &Fault{"not_found", 404}
	}
	return o, e
}
func GetOrder(ctx context.Context, tx pgx.Tx, customer, id string) (Order, []Event, error) {
	o, e := scanOrder(tx.QueryRow(ctx, `SELECT `+columns+` FROM online_test_funds_orders WHERE customer_id=$1 AND id=$2`, customer, id))
	if e != nil {
		return o, nil, e
	}
	rows, e := tx.Query(ctx, `SELECT action,status,note,revision,created_at FROM online_test_funds_events WHERE customer_id=$1 AND order_id=$2 ORDER BY revision`, customer, id)
	if e != nil {
		return o, nil, e
	}
	defer rows.Close()
	ev := []Event{}
	for rows.Next() {
		var v Event
		if e = rows.Scan(&v.Action, &v.Status, &v.Note, &v.Revision, &v.Created); e != nil {
			return o, nil, e
		}
		ev = append(ev, v)
	}
	return o, ev, rows.Err()
}
