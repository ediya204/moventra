package issuing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"math/big"
	"moventra.local/api/internal/blnk"
	"moventra.local/api/internal/ledger"
	"regexp"
	"strings"
)

var ErrInvalid = errors.New("invalid_issuing_request")
var ErrConflict = errors.New("configuration_changed")
var ErrNotFound = errors.New("not_found")
var ErrBlocked = errors.New("issuing_not_enabled")
var ErrForbidden = errors.New("permission_required")
var amountRE = regexp.MustCompile(`^(0|[1-9][0-9]{0,17})$`)
var binRE = regexp.MustCompile(`^([0-9]{6}|[0-9]{8})$`)

func ValidID(s string) bool {
	v, e := uuid.Parse(s)
	return e == nil && v != uuid.Nil && v.String() == s
}
func Money(s string, positive bool) bool { return amountRE.MatchString(s) && (!positive || s != "0") }
func number(s string) *big.Int           { n, _ := new(big.Int).SetString(s, 10); return n }
func add(a, b string) string             { return new(big.Int).Add(number(a), number(b)).String() }
func textOK(s string, n int) bool {
	return strings.TrimSpace(s) == s && s != "" && len(s) <= n && !strings.ContainsAny(s, "\r\n\x00")
}
func hash(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

type Service struct {
	Pilot          *PilotAuthorization
	DB             *pgxpool.Pool
	Blnk           *blnk.Client
	Providers      map[string]Provider
	Mode           string
	Enabled        bool
	Funds          *ledger.Service
	ScopedWalletID string
}
type Supplier struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Adapter    string `json:"adapter"`
	Status     string `json:"status"`
	AccountRef string `json:"accountRef"`
	EntityRef  string `json:"entityRef"`
	Revision   int64  `json:"revision"`
}
type Product struct {
	ID           string `json:"id"`
	SupplierID   string `json:"supplierId"`
	Name         string `json:"name"`
	BIN          string `json:"bin"`
	Network      string `json:"network"`
	UpstreamID   string `json:"upstreamId"`
	Status       string `json:"status"`
	Description  string `json:"description"`
	FeeMinor     string `json:"feeMinor"`
	MinimumMinor string `json:"minimumMinor"`
	Revision     int64  `json:"revision"`
}
type Price struct {
	ProductID string  `json:"productId"`
	ScopeKind string  `json:"scopeKind"`
	ScopeID   string  `json:"scopeId"`
	FeeMinor  *string `json:"feeMinor"`
	Revision  int64   `json:"revision"`
}
type Enrollment struct {
	CustomerID    string `json:"customerId"`
	GroupID       string `json:"groupId"`
	Enabled       bool   `json:"enabled"`
	Revision      int64  `json:"revision"`
	SupplierID    string `json:"supplierId"`
	CardholderRef string `json:"cardholderRef"`
	EvidenceRef   string `json:"evidenceRef"`
}
type Snapshot struct {
	PilotAuthorization string   `json:"pilotAuthorization,omitempty"`
	FundsWalletID      string   `json:"fundsWalletId,omitempty"`
	FundsNamespace     string   `json:"fundsNamespace,omitempty"`
	ConnectionID       string   `json:"connectionId,omitempty"`
	VirtualAccountID   string   `json:"virtualAccountId,omitempty"`
	CardName           string   `json:"cardName,omitempty"`
	Product            Product  `json:"product"`
	Supplier           Supplier `json:"supplier"`
	FeeMinor           string   `json:"feeMinor"`
	PriceSource        string   `json:"priceSource"`
	CustomerRevision   int64    `json:"customerRevision"`
	CardholderRef      string   `json:"cardholderRef"`
}
type Quote struct {
	TermsVersion string `json:"termsVersion"`
	ID           string `json:"id"`
	ProductID    string `json:"productId"`
	FeeMinor     string `json:"feeMinor"`
	FundingMinor string `json:"fundingMinor"`
	TotalMinor   string `json:"totalMinor"`
	PriceSource  string `json:"priceSource"`
	ExpiresAt    string `json:"expiresAt"`
}
type Order struct {
	CardName     string   `json:"cardName"`
	ID           string   `json:"id"`
	CustomerID   string   `json:"customerId"`
	ProductID    string   `json:"productId"`
	State        string   `json:"state"`
	FeeMinor     string   `json:"feeMinor"`
	FundingMinor string   `json:"fundingMinor"`
	Last4        string   `json:"last4"`
	ErrorCode    string   `json:"errorCode"`
	CreatedAt    string   `json:"createdAt"`
	CardID       string   `json:"cardId"`
	ParentID     string   `json:"parentId"`
	Snapshot     Snapshot `json:"-"`
}

func Audit(ctx context.Context, tx pgx.Tx, actor, customer, resource, action string, detail any) error {
	b, e := json.Marshal(detail)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO issuing_audit(actor_id,customer_id,resource_id,action,detail) VALUES(NULLIF($1,'')::uuid,NULLIF($2,'')::uuid,$3,$4,$5)`, actor, customer, resource, action, b)
	return e
}
func Lock(ctx context.Context, tx pgx.Tx, key string) error {
	_, e := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "issuing:"+key)
	return e
}
func mapped(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
func jsonRows(ctx context.Context, tx pgx.Tx, sql string, args ...any) ([]json.RawMessage, error) {
	r, e := tx.Query(ctx, sql, args...)
	if e != nil {
		return nil, e
	}
	defer r.Close()
	out := []json.RawMessage{}
	for r.Next() {
		var b []byte
		if e = r.Scan(&b); e != nil {
			return nil, e
		}
		out = append(out, json.RawMessage(b))
	}
	return out, r.Err()
}

const productCols = `id::text,supplier_id::text,name,bin,network,upstream_id,status,description,COALESCE(fee_minor::text,''),COALESCE(minimum_minor::text,''),revision`

func product(ctx context.Context, tx pgx.Tx, id string) (p Product, e error) {
	e = tx.QueryRow(ctx, `SELECT `+productCols+` FROM issuing_products WHERE id=$1`, id).Scan(&p.ID, &p.SupplierID, &p.Name, &p.BIN, &p.Network, &p.UpstreamID, &p.Status, &p.Description, &p.FeeMinor, &p.MinimumMinor, &p.Revision)
	return p, mapped(e)
}
func supplier(ctx context.Context, tx pgx.Tx, id string) (p Supplier, e error) {
	e = tx.QueryRow(ctx, `SELECT id::text,name,adapter,status,account_ref,entity_ref,revision FROM issuing_suppliers WHERE id=$1`, id).Scan(&p.ID, &p.Name, &p.Adapter, &p.Status, &p.AccountRef, &p.EntityRef, &p.Revision)
	return p, mapped(e)
}
