package cryptofunds

// Production TRC20 deposits and OTC are independent of unverified payout/card
// capabilities. They reuse the existing live namespace, never seed balances.
import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/blnk"
	"moventra.local/api/internal/ledger"
	"moventra.local/api/internal/tron"
)

type ProductionRuntime struct{ lastHealthy atomic.Int64 }

func ProductionFromEnv(db *pgxpool.Pool) (*Service, error) {
	mode := os.Getenv("FUNDS_PRODUCTION_MODE")
	if mode == "" {
		return nil, nil
	}
	if (mode != "prepare" && mode != "enabled") || os.Getenv("DEPOSIT_PILOT_MODE") != "" || os.Getenv("LEDGER_MODE") != "" || os.Getenv("DEPOSIT_ADDRESS_MODE") != "observation" || os.Getenv("FUNDS_PRODUCTION_EVIDENCE") == "" || os.Getenv("FUNDS_PRODUCTION_DEPOSIT_FEE_MINOR") != "0" {
		return nil, errors.New("invalid_production_funds_configuration")
	}
	c, e := blnk.NewWithCA(os.Getenv("DEPOSIT_PILOT_BLNK_URL"), os.Getenv("DEPOSIT_PILOT_BLNK_KEY"), os.Getenv("DEPOSIT_PILOT_BLNK_CA_PEM"), false)
	if e != nil {
		return nil, e
	}
	l, e := ledger.NewLive(db, c, os.Getenv("DEPOSIT_ADDRESS_NAMESPACE"), "general_ledger_id")
	if e != nil {
		return nil, e
	}
	if os.Getenv("DEPOSIT_PILOT_TRON_URL") != "https://api.trongrid.io" || os.Getenv("CREGIS_PROJECT_ID") == "" {
		return nil, errors.New("production_mainnet_required")
	}
	v, e := tron.New(os.Getenv("DEPOSIT_PILOT_TRON_URL"), os.Getenv("TRON_NODE_KEY"))
	if e != nil {
		return nil, e
	}
	return &Service{Ledger: l, Production: &ProductionRuntime{}, Live: &LiveRuntime{Connection: "cregis-waas", Project: os.Getenv("CREGIS_PROJECT_ID"), Networks: map[string]NetworkConfig{"TRC20": {Network: "TRC20", ChainID: "195", TokenID: pilotToken, Contract: pilotToken, Deposit: true, Verifier: v}}}}, nil
}
func (s *Service) ProductionReady() bool {
	return s != nil && s.Production != nil && time.Now().Unix()-s.Production.lastHealthy.Load() < 90
}
func (s *Service) CheckProduction(ctx context.Context) error {
	if s.Production == nil || s.Pilot != nil || !s.Ledger.IsLive() || s.Live.Writer != nil || s.Live.Cards != nil {
		return errors.New("invalid_production_profile")
	}
	// Actual posted, final-chain evidence in this namespace is required, not a
	// synthetic certification file. The acceptance order is never replayed here.
	var accepted bool
	e := s.Ledger.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM crypto_orders o JOIN crypto_audit a ON a.namespace=o.namespace AND a.customer_id=o.customer_id WHERE o.namespace=$1 AND o.id::text=$2 AND o.kind='deposit' AND o.state='completed' AND o.data->>'postingStatus'='posted' AND o.data->>'chainStatus'='finalized' AND a.action='deposit_pilot_zero_opening')`, s.NS(), os.Getenv("FUNDS_PRODUCTION_EVIDENCE")).Scan(&accepted)
	if e != nil {
		return e
	}
	if !accepted {
		return errors.New("production_deposit_evidence_required")
	}
	if e = s.Ledger.Blnk.CheckLedger(ctx); e != nil {
		return e
	}
	if v, ok := s.Live.Networks["TRC20"].Verifier.(*tron.Client); ok {
		if e = v.CheckReady(ctx); e != nil {
			return e
		}
	}
	return nil
}
func (s *Service) RunProductionOnce(ctx context.Context) error {
	if e := s.CheckProduction(ctx); e != nil {
		return e
	}
	if _, e := s.Drain(ctx); e != nil {
		return e
	}
	if s.Production.lastHealthy.Swap(time.Now().Unix()) == 0 {
		slog.Info("production funds healthy", "deposit_network", "TRC20", "otc", true, "payout", false, "cards", false)
	}
	return nil
}
func (s *Service) RunProduction(ctx context.Context) {
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		work, cancel := context.WithTimeout(ctx, 45*time.Second)
		e := s.RunProductionOnce(work)
		cancel()
		if e != nil {
			s.Production.lastHealthy.Store(0)
			slog.Warn("production funds awaiting recovery", "reason", e.Error())
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// An explicit one-off operator command sets user-approved terms. Startup never
// overwrites later changes made through the MFA-protected settings endpoint.
func (s *Service) ConfigureProduction(ctx context.Context) error {
	if e := s.CheckProduction(ctx); e != nil {
		return e
	}
	zero := "0"
	v := Settings{USDTToUSD: "0.99", USDToUSDT: "0.99", OTCEnabled: true, WithdrawEnabled: false, WithdrawalFee: &zero, NetworkFees: map[string]*string{"TRC20": &zero, "ERC20": &zero}, CardDepositFee: &zero, CardWithdrawFee: &zero}
	tx, e := s.Ledger.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, s.NS()+":production-config"); e != nil {
		return e
	}
	var exists bool
	if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM crypto_audit WHERE namespace=$1 AND action='production_terms_20260918')`, s.NS()).Scan(&exists); e != nil {
		return e
	}
	if exists {
		return nil
	}
	current, e := s.Settings(ctx, tx)
	if e != nil {
		return e
	}
	v.Revision = current.Revision + 1
	raw, _ := json.Marshal(v)
	tag, e := tx.Exec(ctx, `INSERT INTO crypto_settings(namespace,revision,data) VALUES($1,$2,$3) ON CONFLICT(namespace) DO UPDATE SET revision=EXCLUDED.revision,data=EXCLUDED.data,updated_at=now() WHERE crypto_settings.revision=$4`, s.NS(), v.Revision, raw, current.Revision)
	if e != nil {
		return e
	}
	if tag.RowsAffected() != 1 {
		return errors.New("configuration_changed")
	}
	if e = s.Audit(ctx, tx, "", "", "", "production_terms_20260918", map[string]any{"settings": v, "evidence": os.Getenv("FUNDS_PRODUCTION_EVIDENCE"), "authorization": "user-approved 0.99 both directions, fees 0, remove pilot cap"}); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
