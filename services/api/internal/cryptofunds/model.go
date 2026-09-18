// Package cryptofunds runs isolated customer funding with Blnk as the balance
// engine. Live Cregis observations never authorize a payment or shadow credit.
package cryptofunds

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"math/big"
	"moventra.local/api/internal/ledger"
	"moventra.local/api/internal/tron"
	"regexp"
	"time"
)

type Fault struct {
	Code   string
	Status int
}

func (f *Fault) Error() string { return f.Code }
func invalid(s string) error   { return &Fault{s, 400} }
func conflict(s string) error  { return &Fault{s, 409} }

var integer = regexp.MustCompile(`^(0|[1-9][0-9]{0,37})$`)
var decimal = regexp.MustCompile(`^(0|[1-9][0-9]{0,12})(\.[0-9]{1,12})?$`)

func number(s string, zero bool) (*big.Int, error) {
	n, ok := new(big.Int).SetString(s, 10)
	if !ok || !integer.MatchString(s) || n.Sign() < 0 || !zero && n.Sign() == 0 {
		return nil, invalid("invalid_amount")
	}
	return n, nil
}
func opposite(c string) string {
	if c == "USDT" {
		return "USD"
	}
	return "USDT"
}
func scale(c string) int {
	if c == "USDT" {
		return 6
	}
	return 2
}
func Convert(amount, currency, rate string) (string, error) {
	n, e := number(amount, false)
	if e != nil {
		return "", e
	}
	if currency != "USD" && currency != "USDT" || !decimal.MatchString(rate) {
		return "", invalid("invalid_rate")
	}
	r, ok := new(big.Rat).SetString(rate)
	if !ok || r.Sign() <= 0 {
		return "", invalid("invalid_rate")
	}
	n.Mul(n, r.Num())
	n.Mul(n, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(scale(opposite(currency)))), nil))
	d := new(big.Int).Mul(r.Denom(), new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(scale(currency))), nil))
	n.Quo(n, d)
	if _, e = number(n.String(), false); e != nil {
		return "", invalid("receive_amount_out_of_range")
	}
	return n.String(), nil
}
func sum(a, b string) string {
	x, _ := new(big.Int).SetString(a, 10)
	y, _ := new(big.Int).SetString(b, 10)
	return x.Add(x, y).String()
}
func digest(v any) string { b, _ := json.Marshal(v); return fmt.Sprintf("%x", sha256.Sum256(b)) }

type Settings struct {
	NetworkFees     map[string]*string `json:"networkFees,omitempty"`
	CardDepositFee  *string            `json:"cardDepositFeeMinor"`
	CardWithdrawFee *string            `json:"cardWithdrawFeeMinor"`
	Revision        int64              `json:"revision"`
	OTCEnabled      bool               `json:"otcEnabled"`
	WithdrawEnabled bool               `json:"withdrawEnabled"`
	USDTToUSD       string             `json:"usdtToUsd"`
	USDToUSDT       string             `json:"usdToUsdt"`
	WithdrawalFee   *string            `json:"withdrawalFeeMinor"`
}
type Quote struct {
	Address        string    `json:"address,omitempty"`
	Network        string    `json:"network,omitempty"`
	CardID         string    `json:"cardId,omitempty"`
	Direction      string    `json:"direction,omitempty"`
	ID             string    `json:"id"`
	Kind           string    `json:"kind"`
	CustomerID     string    `json:"customerId"`
	Currency       string    `json:"currency"`
	ToCurrency     string    `json:"toCurrency"`
	Amount         string    `json:"amountMinor"`
	Receive        string    `json:"receiveMinor"`
	Fee            string    `json:"feeMinor"`
	Rate           string    `json:"rate"`
	PolicyRevision int64     `json:"policyRevision"`
	Expires        time.Time `json:"expiresAt"`
}
type Order struct {
	Network         string      `json:"network,omitempty"`
	CardID          string      `json:"cardId,omitempty"`
	Direction       string      `json:"direction,omitempty"`
	Proof           *tron.Proof `json:"proof,omitempty"`
	Contract        string      `json:"contract,omitempty"`
	ID              string      `json:"id"`
	CustomerID      string      `json:"customerId"`
	ActorID         string      `json:"-"`
	Kind            string      `json:"kind"`
	State           string      `json:"state"`
	Revision        int64       `json:"revision"`
	Currency        string      `json:"currency"`
	ToCurrency      string      `json:"toCurrency"`
	Amount          string      `json:"amountMinor"`
	Receive         string      `json:"receiveMinor"`
	Fee             string      `json:"feeMinor"`
	Address         string      `json:"address"`
	Quote           *Quote      `json:"quote,omitempty"`
	Approval        string      `json:"approvalStatus"`
	Provider        string      `json:"providerStatus"`
	Chain           string      `json:"chainStatus"`
	Posting         string      `json:"postingStatus"`
	Error           string      `json:"error"`
	Resolution      string      `json:"resolution"`
	TransactionHash string      `json:"txHash"`
	Evidence        string      `json:"evidenceRef"`
	Created         time.Time   `json:"createdAt"`
	Updated         time.Time   `json:"updatedAt"`
}
type Input struct {
	Network   string    `json:"network,omitempty"`
	CardID    string    `json:"cardId,omitempty"`
	Direction string    `json:"direction,omitempty"`
	Action    string    `json:"action,omitempty"`
	Currency  string    `json:"currency,omitempty"`
	Amount    string    `json:"amountMinor,omitempty"`
	QuoteID   string    `json:"quoteId,omitempty"`
	OrderID   string    `json:"orderId,omitempty"`
	Address   string    `json:"address,omitempty"`
	Revision  int64     `json:"revision,omitempty"`
	Note      string    `json:"note,omitempty"`
	Settings  *Settings `json:"settings,omitempty"`
}
type Service struct {
	Production *ProductionRuntime
	Pilot      *DepositPilot
	Ledger     *ledger.Service
	Live       *LiveRuntime
}

func New(l *ledger.Service) (*Service, error) {
	if l == nil {
		return nil, errors.New("crypto_ledger_required")
	}
	if e := ledger.CheckLocalDatabase(l.DB.Config()); e != nil && !l.IsLive() {
		return nil, e
	}
	s := &Service{Ledger: l}
	if l.IsLive() {
		var err error
		s.Live, err = LiveFromEnv()
		if err != nil {
			return nil, err
		}
	}
	return s, nil
}
func (s *Service) NS() string { return s.Ledger.Namespace }
func (s *Service) Lock(ctx context.Context, tx pgx.Tx, customer string) error {
	_, e := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "crypto:"+s.NS()+":"+customer)
	return e
}
func (s *Service) Settings(ctx context.Context, tx pgx.Tx) (Settings, error) {
	var c Settings
	var raw []byte
	e := tx.QueryRow(ctx, `SELECT data,revision FROM crypto_settings WHERE namespace=$1 FOR SHARE`, s.NS()).Scan(&raw, &c.Revision)
	if errors.Is(e, pgx.ErrNoRows) {
		return Settings{}, nil
	}
	if e != nil {
		return c, e
	}
	rev := c.Revision
	e = json.Unmarshal(raw, &c)
	c.Revision = rev
	return c, e
}
func (s *Service) Audit(ctx context.Context, tx pgx.Tx, customer, order, actor, action string, data any) error {
	raw, e := json.Marshal(data)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO crypto_audit(namespace,customer_id,order_id,actor_id,action,data) VALUES($1,NULLIF($2,'')::uuid,NULLIF($3,'')::uuid,NULLIF($4,'')::uuid,$5,$6)`, s.NS(), customer, order, actor, action, raw)
	return e
}
func (s *Service) Authorize(ctx context.Context, tx pgx.Tx, customer, actor, permission string, admin, write bool) error {
	var owner, onboard, status string
	e := tx.QueryRow(ctx, `SELECT personal_owner_id::text,onboarding_status,service_status FROM customers WHERE id=$1 AND kind='personal' FOR SHARE`, customer).Scan(&owner, &onboard, &status)
	if errors.Is(e, pgx.ErrNoRows) {
		return &Fault{"not_found", 404}
	}
	if e != nil {
		return e
	}
	if admin {
		var allowed bool
		e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM crypto_grants WHERE namespace=$1 AND customer_id=$2 AND user_id=$3 AND permission=$4)`, s.NS(), customer, actor, permission).Scan(&allowed)
		if e != nil {
			return e
		}
		if !allowed || owner == actor {
			return &Fault{"not_found", 404}
		}
	} else if owner != actor {
		return &Fault{"not_found", 404}
	}
	if write && (onboard != "approved" || status != "active") {
		return &Fault{"user_not_enabled", 403}
	}
	return nil
}
func (s *Service) Get(ctx context.Context, tx pgx.Tx, customer, id string) (Order, error) {
	var o Order
	var raw []byte
	var actor string
	e := tx.QueryRow(ctx, `SELECT data,COALESCE(actor_id::text,'') FROM crypto_orders WHERE namespace=$1 AND customer_id=$2 AND id=$3`, s.NS(), customer, id).Scan(&raw, &actor)
	if errors.Is(e, pgx.ErrNoRows) {
		return o, &Fault{"not_found", 404}
	}
	if e != nil {
		return o, e
	}
	e = json.Unmarshal(raw, &o)
	o.ActorID = actor
	return o, e
}
func (s *Service) Save(ctx context.Context, tx pgx.Tx, o *Order, actor, action string) error {
	o.Revision++
	o.Updated = time.Now().UTC()
	raw, e := json.Marshal(o)
	if e != nil {
		return e
	}
	tag, e := tx.Exec(ctx, `UPDATE crypto_orders SET state=$1,revision=$2,data=$3,updated_at=$4 WHERE namespace=$5 AND id=$6 AND revision=$7`, o.State, o.Revision, raw, o.Updated, s.NS(), o.ID, o.Revision-1)
	if e != nil {
		return e
	}
	if tag.RowsAffected() != 1 {
		return conflict("order_changed")
	}
	return s.Audit(ctx, tx, o.CustomerID, o.ID, actor, action, o)
}
func (s *Service) Insert(ctx context.Context, tx pgx.Tx, o *Order) error {
	o.ID = uuid.NewString()
	o.Revision = 1
	o.Created = time.Now().UTC()
	o.Updated = o.Created
	raw, _ := json.Marshal(o)
	_, e := tx.Exec(ctx, `INSERT INTO crypto_orders(id,namespace,customer_id,actor_id,kind,state,revision,data,created_at,updated_at) VALUES($1,$2,$3,NULLIF($4,'')::uuid,$5,$6,1,$7,$8,$8)`, o.ID, s.NS(), o.CustomerID, o.ActorID, o.Kind, o.State, raw, o.Created)
	if e != nil {
		return e
	}
	return s.Audit(ctx, tx, o.CustomerID, o.ID, o.ActorID, "created", o)
}
