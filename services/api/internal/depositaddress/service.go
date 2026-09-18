// Package depositaddress manages provider addresses independently of ledger execution.
// It never posts balances, approves withdrawals, or treats callbacks as finality.
package depositaddress

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"moventra.local/api/internal/cregis"
	"moventra.local/api/internal/tron"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"time"
)

const Connection = "cregis-waas"
const Network = "TRC20"
const Token = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"

type Provider interface {
	Coins(context.Context) (cregis.Coins, error)
	CreateAddress(context.Context, string, string, string) (string, error)
	InternalAddress(context.Context, string, string) (bool, error)
	UpdateAddressCallback(context.Context, string, string) error
}
type Service struct {
	DB                                *pgxpool.Pool
	Provider                          Provider
	Namespace, Project, Key, Callback string
}
type Address struct {
	Network string `json:"network"`
	Address string `json:"address"`
	State   string `json:"state"`
}

func FromEnv(db *pgxpool.Pool) (*Service, error) {
	if os.Getenv("DEPOSIT_ADDRESS_MODE") == "" {
		return nil, nil
	}
	if os.Getenv("DEPOSIT_ADDRESS_MODE") != "observation" {
		return nil, errors.New("invalid_deposit_address_mode")
	}
	ns := os.Getenv("DEPOSIT_ADDRESS_NAMESPACE")
	u, e := url.Parse(os.Getenv("DEPOSIT_CALLBACK_URL"))
	if !regexp.MustCompile(`^live_[a-z0-9_]{1,48}$`).MatchString(ns) || e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "/webhooks/cregis/address-deposit" {
		return nil, errors.New("invalid_deposit_address_configuration")
	}
	c, e := cregis.FromEnv()
	if e != nil {
		return nil, e
	}
	w, e := cregis.NewAddressClient(c)
	if e != nil {
		return nil, e
	}
	return &Service{db, w, ns, os.Getenv("CREGIS_PROJECT_ID"), os.Getenv("CREGIS_API_KEY"), u.String()}, nil
}
func (s *Service) Eligible(ctx context.Context, customer, actor string) (bool, error) {
	var eligible bool
	e := s.DB.QueryRow(ctx, `SELECT onboarding_status='approved' AND service_status='active' FROM customers WHERE id=$1 AND personal_owner_id=$2 AND kind='personal'`, customer, actor).Scan(&eligible)
	return eligible, e
}
func (s *Service) Get(ctx context.Context, customer string) (Address, error) {
	a := Address{Network: Network, State: "not_created"}
	e := s.DB.QueryRow(ctx, `SELECT state,COALESCE(address,'') FROM funds_address_jobs WHERE namespace=$1 AND customer_id=$2 AND network=$3`, s.Namespace, customer, Network).Scan(&a.State, &a.Address)
	if errors.Is(e, pgx.ErrNoRows) {
		return a, nil
	}
	if a.State != "completed" {
		a.Address = ""
	}
	return a, e
}

// Request commits a unique claim before any provider call. Unknown requests are
// never automatically retried, including after process death or client retries.
func (s *Service) Request(ctx context.Context, customer, actor string) (Address, error) {
	eligible, e := s.Eligible(ctx, customer, actor)
	if e != nil {
		return Address{}, e
	}
	if !eligible {
		return Address{}, errors.New("customer_not_ready")
	}
	a, e := s.Get(ctx, customer)
	if e != nil || a.State != "not_created" {
		return a, e
	}
	coins, e := s.Provider.Coins(ctx)
	if e != nil {
		return Address{}, e
	}
	supported := false
	for _, c := range coins.Address {
		if c.ChainID == "195" && c.TokenID == Token && c.Decimals == "6" {
			supported = true
		}
	}
	if !supported {
		return Address{}, errors.New("network_unavailable")
	}
	id := uuid.NewString()
	tag, e := s.DB.Exec(ctx, `INSERT INTO funds_address_jobs(namespace,customer_id,network,id,state) SELECT $1,id,$3,$4,'submitting' FROM customers WHERE id=$2 AND personal_owner_id=$5 AND onboarding_status='approved' AND service_status='active' ON CONFLICT DO NOTHING`, s.Namespace, customer, Network, id, actor)
	if e != nil {
		return Address{}, e
	}
	if tag.RowsAffected() == 0 {
		return s.Get(ctx, customer)
	}
	address, e := s.Provider.CreateAddress(ctx, "195", "mv_"+id, s.Callback)
	if e != nil {
		return Address{Network: Network, State: "unknown"}, e
	}
	// Preserve a returned address even if its verification or binding later fails.
	if _, e = s.DB.Exec(ctx, `UPDATE funds_address_jobs SET address=$4,state='verifying',updated_at=now() WHERE namespace=$1 AND customer_id=$2 AND network=$3 AND id=$5`, s.Namespace, customer, Network, address, id); e != nil {
		return Address{}, e
	}
	ok, e := s.Provider.InternalAddress(ctx, "195", address)
	_, syntaxErr := tron.AddressHex(address)
	if e != nil || !ok || syntaxErr != nil {
		return Address{}, errors.New("address_verification_pending")
	}
	if e = s.bind(ctx, customer, address); e != nil {
		return Address{}, e
	}
	return s.Get(ctx, customer)
}
func (s *Service) bind(ctx context.Context, customer, address string) error {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	// Unique network/customer and provider address constraints reject reassignment.
	_, e = tx.Exec(ctx, `INSERT INTO crypto_addresses(namespace,connection_id,project_id,network,customer_id,address,chain_address,mode) VALUES($1,$2,$3,$4,$5,$6,$6,'live') ON CONFLICT(namespace,customer_id,network,mode) DO NOTHING`, s.Namespace, Connection, s.Project, Network, customer, address)
	if e != nil {
		return e
	}
	var saved string
	if e = tx.QueryRow(ctx, `SELECT address FROM crypto_addresses WHERE namespace=$1 AND customer_id=$2 AND network=$3 AND mode='live'`, s.Namespace, customer, Network).Scan(&saved); e != nil {
		return e
	}
	if saved != address {
		return errors.New("address_conflict")
	}
	_, e = tx.Exec(ctx, `UPDATE funds_address_jobs SET state='completed',address=$4,updated_at=now() WHERE namespace=$1 AND customer_id=$2 AND network=$3`, s.Namespace, customer, Network, address)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}

// Import requires an independently reviewed creation receipt. It never creates
// another address; repeated invocations only verify/update this same address.
func (s *Service) Import(ctx context.Context, customer, address, evidence string) error {
	if _, err := tron.AddressHex(address); err != nil {
		return errors.New("invalid_tron_address")
	}
	if _, e := uuid.Parse(customer); e != nil || evidence == "" || len(evidence) > 300 {
		return errors.New("invalid_import")
	}
	ok, e := s.Provider.InternalAddress(ctx, "195", address)
	if e != nil || !ok {
		return errors.New("provider_ownership_required")
	}
	tag, e := s.DB.Exec(ctx, `INSERT INTO funds_address_jobs(namespace,customer_id,network,id,state,address,error) SELECT $1,id,$3,$4,'verifying',$5,$6 FROM customers WHERE id=$2 AND onboarding_status='approved' AND service_status='active' ON CONFLICT DO NOTHING`, s.Namespace, customer, Network, uuid.NewString(), address, evidence)
	if e != nil {
		return e
	}
	var stored string
	if e = s.DB.QueryRow(ctx, `SELECT COALESCE(address,'') FROM funds_address_jobs WHERE namespace=$1 AND customer_id=$2 AND network=$3`, s.Namespace, customer, Network).Scan(&stored); e != nil {
		return e
	}
	if stored != address {
		return errors.New("address_conflict")
	}
	_ = tag
	if e = s.Provider.UpdateAddressCallback(ctx, address, s.Callback); e != nil {
		return e
	}
	return s.bind(ctx, customer, address)
}
func (s *Service) CallbackHandler(w http.ResponseWriter, r *http.Request) {
	raw, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if e != nil {
		http.Error(w, "invalid", 400)
		return
	}
	ob, e := cregis.VerifyCallback(s.Key, s.Project, cregis.Deposit, raw)
	if e != nil {
		http.Error(w, "invalid", 400)
		return
	}
	if ob.Fields["chain_id"] != "195" || ob.Fields["token_id"] != Token {
		http.Error(w, "unsupported", 400)
		return
	}
	delete(ob.Fields, "sign")
	delete(ob.Fields, "nonce")
	delete(ob.Fields, "timestamp")
	payload, e := json.Marshal(ob.Fields)
	if e != nil {
		http.Error(w, "invalid", 400)
		return
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(payload))
	// Customer ownership is resolved only on reads; unbound notifications remain
	// durable evidence for recovery, never an instruction to credit an account.
	_, e = s.DB.Exec(r.Context(), `INSERT INTO crypto_events(id,namespace,connection_id,project_id,kind,external_id,digest,payload) VALUES($1,$2,$3,$4,'deposit',$5,$6,$7) ON CONFLICT(namespace,connection_id,project_id,kind,external_id,digest) DO UPDATE SET deliveries=crypto_events.deliveries+1,updated_at=now()`, uuid.NewString(), s.Namespace, Connection, s.Project, ob.EventID, digest, payload)
	if e != nil {
		http.Error(w, "unavailable", 503)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte("success"))
}

type Event struct {
	State          string    `json:"state"`
	Posting        string    `json:"posting"`
	Error          string    `json:"error,omitempty"`
	OrderID        string    `json:"orderId,omitempty"`
	ID             string    `json:"id"`
	Amount         string    `json:"amount"`
	TxHash         string    `json:"txHash"`
	ProviderStatus string    `json:"providerStatus"`
	ReceivedAt     time.Time `json:"receivedAt"`
}

func (s *Service) Events(ctx context.Context, customer string, page int, event string) ([]Event, error) {
	rows, e := s.DB.Query(ctx, `WITH owned AS (
 SELECT e.* FROM crypto_events e JOIN crypto_addresses a
 ON a.namespace=e.namespace AND a.connection_id=e.connection_id AND a.project_id=e.project_id AND a.address=e.payload->>'address' AND a.network='TRC20' AND a.mode='live'
 WHERE e.namespace=$1 AND a.customer_id=$2 AND e.project_id=$3 AND e.kind='deposit' AND e.payload->>'chain_id'='195' AND e.payload->>'token_id'=$4
), canonical AS (
 SELECT DISTINCT ON(external_id) * FROM owned
 WHERE ($6='' OR external_id IN(SELECT external_id FROM owned WHERE id::text=$6))
 ORDER BY external_id,(order_id IS NOT NULL) DESC,received_at DESC,id DESC
), recent AS (
 SELECT DISTINCT ON(COALESCE(order_id::text,'event:'||external_id)) * FROM canonical
 ORDER BY COALESCE(order_id::text,'event:'||external_id),received_at DESC,id DESC
)
 SELECT recent.id::text,recent.payload->>'amount',COALESCE(recent.payload->>'txid',''),recent.payload->>'status',recent.received_at,recent.state,COALESCE(o.data->>'postingStatus','not_posted'),recent.error,COALESCE(o.id::text,'')
 FROM recent LEFT JOIN crypto_orders o ON o.id=recent.order_id AND o.namespace=recent.namespace AND o.customer_id=$2
 ORDER BY recent.received_at DESC,recent.id DESC LIMIT 5 OFFSET $5`, s.Namespace, customer, s.Project, Token, page*5, event)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		var v Event
		if e = rows.Scan(&v.ID, &v.Amount, &v.TxHash, &v.ProviderStatus, &v.ReceivedAt, &v.State, &v.Posting, &v.Error, &v.OrderID); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
