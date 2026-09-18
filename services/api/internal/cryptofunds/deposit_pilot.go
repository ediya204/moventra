package cryptofunds

// A deposit pilot is deliberately independent of full funds certification. It
// has no payout/card/address writer and can consume only the approved address.
import (
	"context"
	"errors"
	"log/slog"
	"math/big"
	"os"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/blnk"
	"moventra.local/api/internal/ledger"
	"moventra.local/api/internal/tron"
)

const pilotToken = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"

type DepositPilot struct {
	Customer    string `json:"customerId"`
	Address     string `json:"address"`
	Cap         string `json:"capMinor"`
	Evidence    string `json:"evidence"`
	lastHealthy atomic.Int64
}

func (p *DepositPilot) valid() bool {
	_, e := uuid.Parse(p.Customer)
	cap, ok := new(big.Int).SetString(p.Cap, 10)
	return e == nil && p.Customer != uuid.Nil.String() && validRecipient(p.Address) && ok && cap.Sign() > 0 && cap.Cmp(big.NewInt(1000000)) <= 0 && cap.String() == p.Cap && len(p.Evidence) > 0 && len(p.Evidence) <= 200
}
func (p *DepositPilot) fingerprint() string {
	return digest([]string{p.Customer, p.Address, p.Cap, p.Evidence})
}
func DepositPilotFromEnv(db *pgxpool.Pool) (*Service, error) {
	mode := os.Getenv("DEPOSIT_PILOT_MODE")
	if mode == "" {
		return nil, nil
	}
	if mode != "prepare" && mode != "enabled" {
		return nil, errors.New("invalid_deposit_pilot_mode")
	}
	p := &DepositPilot{Customer: os.Getenv("DEPOSIT_PILOT_CUSTOMER"), Address: os.Getenv("DEPOSIT_PILOT_ADDRESS"), Cap: os.Getenv("DEPOSIT_PILOT_CAP_MINOR"), Evidence: os.Getenv("DEPOSIT_PILOT_EVIDENCE")}
	if !p.valid() || os.Getenv("DEPOSIT_PILOT_DEPOSIT_FEE_MINOR") != "0" || os.Getenv("DEPOSIT_ADDRESS_MODE") != "observation" || os.Getenv("CREGIS_PROJECT_ID") == "" || os.Getenv("LEDGER_MODE") != "" || os.Getenv("CREGIS_SOURCE_ENABLED") == "true" {
		return nil, errors.New("invalid_deposit_pilot_scope")
	}
	c, e := blnk.NewWithCA(os.Getenv("DEPOSIT_PILOT_BLNK_URL"), os.Getenv("DEPOSIT_PILOT_BLNK_KEY"), os.Getenv("DEPOSIT_PILOT_BLNK_CA_PEM"), false)
	if e != nil {
		return nil, e
	}
	l, e := ledger.NewLive(db, c, os.Getenv("DEPOSIT_ADDRESS_NAMESPACE"), "general_ledger_id")
	if e != nil {
		return nil, e
	}
	if os.Getenv("DEPOSIT_PILOT_TRON_URL") != "https://api.trongrid.io" {
		return nil, errors.New("deposit_pilot_mainnet_node_required")
	}
	v, e := tron.New(os.Getenv("DEPOSIT_PILOT_TRON_URL"), os.Getenv("TRON_NODE_KEY"))
	if e != nil {
		return nil, e
	}
	return &Service{Ledger: l, Pilot: p, Live: &LiveRuntime{Connection: "cregis-waas", Project: os.Getenv("CREGIS_PROJECT_ID"), Networks: map[string]NetworkConfig{"TRC20": {Network: "TRC20", ChainID: "195", TokenID: pilotToken, Contract: pilotToken, Deposit: true, Verifier: v}}}}, nil
}
func (s *Service) pilotScope(ctx context.Context) error {
	p := s.Pilot
	if p == nil || !p.valid() || s.Live == nil || s.Live.Writer != nil || s.Live.Cards != nil {
		return errors.New("invalid_deposit_pilot")
	}
	var good bool
	e := s.Ledger.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM crypto_addresses a JOIN customers c ON c.id=a.customer_id JOIN funds_address_jobs j ON j.namespace=a.namespace AND j.customer_id=a.customer_id AND j.network=a.network WHERE a.namespace=$1 AND a.customer_id=$2 AND a.connection_id=$3 AND a.project_id=$4 AND a.network='TRC20' AND a.address=$5 AND a.mode='live' AND c.onboarding_status='approved' AND c.service_status='active' AND j.address=a.address AND j.state='completed')`, s.NS(), p.Customer, s.Live.Connection, s.Live.Project, p.Address).Scan(&good)
	if e != nil {
		return e
	}
	if !good {
		return errors.New("deposit_pilot_binding_required")
	}
	return nil
}
func (s *Service) pilotAccepted(ctx context.Context) error {
	var yes bool
	e := s.Ledger.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM crypto_audit WHERE namespace=$1 AND customer_id=$2 AND action='deposit_pilot_zero_opening' AND data->>'fingerprint'=$3)`, s.NS(), s.Pilot.Customer, s.Pilot.fingerprint()).Scan(&yes)
	if e != nil {
		return e
	}
	if !yes {
		return errors.New("deposit_pilot_zero_opening_required")
	}
	return nil
}

// Prepare creates only zero accounts and records an auditable, scoped opening.
// Re-running after activation only verifies the same authorization, never resets.
func (s *Service) PrepareDepositPilot(ctx context.Context) error {
	if e := s.pilotScope(ctx); e != nil {
		return e
	}
	if e := s.Ledger.Blnk.CheckLedger(ctx); e != nil {
		return e
	}
	if v, ok := s.Live.Networks["TRC20"].Verifier.(*tron.Client); ok {
		if e := v.CheckReady(ctx); e != nil {
			return e
		}
	}
	if s.pilotAccepted(ctx) == nil {
		return nil
	}
	for _, kind := range []string{"wallet", "clearing"} {
		if _, e := s.account(ctx, s.Pilot.Customer, kind, "USDT", kind+"-USDT"); e != nil {
			return e
		}
	}
	snap, e := s.Ledger.Snapshot(ctx, s.Pilot.Customer)
	if e != nil {
		return e
	}
	if snap.Reconciliation != "matched" || snap.PendingOperations != 0 || len(snap.Accounts) != 1 {
		return errors.New("deposit_pilot_opening_not_zero")
	}
	for _, a := range snap.Accounts {
		if a.AvailableMinor != "0" {
			return errors.New("deposit_pilot_opening_not_zero")
		}
	}
	tx, e := s.Ledger.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = s.Lock(ctx, tx, s.Pilot.Customer); e != nil {
		return e
	}
	var count int
	e = tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM crypto_orders WHERE namespace=$1 AND customer_id=$2)+(SELECT count(*) FROM ledger_operations WHERE namespace=$1 AND customer_id=$2)`, s.NS(), s.Pilot.Customer).Scan(&count)
	if e != nil {
		return e
	}
	if count != 0 {
		return errors.New("deposit_pilot_opening_has_activity")
	}
	if e = s.Audit(ctx, tx, s.Pilot.Customer, "", "", "deposit_pilot_zero_opening", map[string]any{"fingerprint": s.Pilot.fingerprint(), "scope": s.Pilot}); e != nil {
		return e
	}
	return tx.Commit(ctx)
}

// Called while holding the customer's crypto lock, before reserving an order.
func (s *Service) pilotCapacity(ctx context.Context, tx pgx.Tx, additional string) error {
	var total string
	e := tx.QueryRow(ctx, `SELECT COALESCE(sum((data->>'amountMinor')::numeric),0)::text FROM crypto_orders WHERE namespace=$1 AND customer_id=$2 AND kind='deposit'`, s.NS(), s.Pilot.Customer).Scan(&total)
	if e != nil {
		return e
	}
	used, ok := new(big.Int).SetString(total, 10)
	if !ok {
		return errors.New("deposit_pilot_invalid_total")
	}
	add, ok := new(big.Int).SetString(additional, 10)
	if !ok || add.Sign() < 0 {
		return errors.New("deposit_pilot_invalid_amount")
	}
	cap, _ := new(big.Int).SetString(s.Pilot.Cap, 10)
	if used.Add(used, add).Cmp(cap) > 0 {
		return errors.New("deposit_pilot_cap_reached")
	}
	return nil
}
func (s *Service) RunDepositPilotOnce(ctx context.Context) error {
	if e := s.pilotScope(ctx); e != nil {
		return e
	}
	if e := s.pilotAccepted(ctx); e != nil {
		return e
	}
	if e := s.Ledger.Blnk.CheckLedger(ctx); e != nil {
		return e
	}
	if v, ok := s.Live.Networks["TRC20"].Verifier.(*tron.Client); ok {
		if e := v.CheckReady(ctx); e != nil {
			return e
		}
	}
	if e := s.ProcessLiveEvents(ctx); e != nil {
		return e
	}
	rows, e := s.Ledger.DB.Query(ctx, `SELECT id::text FROM crypto_orders WHERE namespace=$1 AND customer_id=$2 AND kind='deposit' AND state='processing' ORDER BY updated_at,id LIMIT 20`, s.NS(), s.Pilot.Customer)
	if e != nil {
		return e
	}
	var ids []string
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			break
		}
		ids = append(ids, id)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return e
	}
	for _, id := range ids {
		if e = s.Process(ctx, s.Pilot.Customer, id); e != nil {
			return e
		}
	}
	s.Pilot.lastHealthy.Store(time.Now().Unix())
	return nil
}
func (s *Service) RunDepositPilot(ctx context.Context) {
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		work, cancel := context.WithTimeout(ctx, 45*time.Second)
		e := s.RunDepositPilotOnce(work)
		cancel()
		if e != nil {
			s.Pilot.lastHealthy.Store(0)
			slog.Warn("deposit pilot waiting for verified recovery", "reason", e.Error())
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

type PilotStatus struct {
	Enabled        bool   `json:"enabled"`
	Cap            string `json:"capMinor,omitempty"`
	Remaining      string `json:"remainingMinor,omitempty"`
	Wallet         string `json:"walletMinor,omitempty"`
	Reconciliation string `json:"reconciliation,omitempty"`
}

func (s *Service) DepositPilotStatus(ctx context.Context, customer string) (PilotStatus, error) {
	var out PilotStatus
	if s == nil || s.Pilot == nil || customer != s.Pilot.Customer {
		return out, nil
	}
	out.Cap = s.Pilot.Cap
	snap, e := s.Ledger.Snapshot(ctx, customer)
	if e != nil {
		return out, e
	}
	out.Reconciliation = snap.Reconciliation
	for _, a := range snap.Accounts {
		if a.Key == "wallet-USDT" && snap.Reconciliation == "matched" {
			out.Wallet = a.AvailableMinor
		}
	}
	var total string
	e = s.Ledger.DB.QueryRow(ctx, `SELECT COALESCE(sum((data->>'amountMinor')::numeric),0)::text FROM crypto_orders WHERE namespace=$1 AND customer_id=$2 AND kind='deposit'`, s.NS(), customer).Scan(&total)
	if e != nil {
		return out, e
	}
	used, ok := new(big.Int).SetString(total, 10)
	if !ok {
		return out, errors.New("deposit_pilot_invalid_total")
	}
	cap, _ := new(big.Int).SetString(out.Cap, 10)
	cap.Sub(cap, used)
	if cap.Sign() < 0 {
		cap.SetInt64(0)
	}
	out.Remaining = cap.String()
	out.Enabled = time.Now().Unix()-s.Pilot.lastHealthy.Load() < 90 && snap.Reconciliation == "matched" && cap.Sign() > 0
	return out, nil
}
func (s *Service) pilotAddress() string {
	if s.Pilot != nil {
		return s.Pilot.Address
	}
	return ""
}
