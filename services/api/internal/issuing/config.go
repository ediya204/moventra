package issuing

import (
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/blnk"
	"moventra.local/api/internal/ledger"
	"net/url"
	"os"
	"strings"
)

// Live configuration is deliberately separate from LEDGER_MODE=shadow.
// Certification is an operator-maintained evidence manifest, never an API flag.
func FromEnv(db *pgxpool.Pool) (*Service, error) {
	s := &Service{DB: db, Providers: map[string]Provider{}}
	mode := os.Getenv("ISSUING_MODE")
	if mode == "" || mode == "disabled" {
		return s, nil
	}
	if mode == "local" {
		return localService(s)
	}
	if mode != "live" && mode != "prepare" {
		return nil, errors.New("invalid_issuing_mode")
	}
	if os.Getenv("LEDGER_MODE") == "shadow" || strings.HasPrefix(db.Config().ConnConfig.Database, "moventra_shadow_") {
		return nil, errors.New("live_shadow_isolation_required")
	}
	u, e := url.Parse(os.Getenv("ISSUING_BLNK_URL"))
	if e != nil || u.Scheme != "https" || u.Host == "" || os.Getenv("ISSUING_BLNK_URL") == os.Getenv("BLNK_URL") {
		return nil, errors.New("dedicated_tls_blnk_required")
	}
	c, e := blnk.NewWithCA(u.String(), os.Getenv("ISSUING_BLNK_KEY"), os.Getenv("ISSUING_BLNK_CA_PEM"), mode == "prepare")
	if e != nil {
		return nil, e
	}
	s.Blnk = c
	if source := os.Getenv("ISSUING_FUNDING_SOURCE"); source != "" && source != "issuing_wallet" {
		if source != "funds_wallet" || os.Getenv("FUNDS_PRODUCTION_MODE") != "enabled" || os.Getenv("FUNDS_PRODUCTION_EVIDENCE") == "" {
			return nil, errors.New("issuing_funds_configuration_required")
		}
		shared, err := blnk.NewWithCA(os.Getenv("DEPOSIT_PILOT_BLNK_URL"), os.Getenv("DEPOSIT_PILOT_BLNK_KEY"), os.Getenv("DEPOSIT_PILOT_BLNK_CA_PEM"), mode == "prepare")
		if err != nil {
			return nil, err
		}
		s.Funds, err = ledger.NewLive(db, shared, os.Getenv("DEPOSIT_ADDRESS_NAMESPACE"), "general_ledger_id")
		if err != nil {
			return nil, err
		}
	}
	if mode == "prepare" {
		s.Mode = "prepare"
		return s, nil // No provider, execution flag, certification claim or posting.
	}
	path := os.Getenv("ISSUING_CERTIFICATION_FILE")
	raw, e := os.ReadFile(path)
	if e != nil {
		return nil, errors.New("issuing_certification_required")
	}
	var cfg struct {
		EvidenceRef        string `json:"evidenceRef"`
		FundingSource      string `json:"fundingSource"`
		FundsNamespace     string `json:"fundsNamespace"`
		AccountingAccepted bool   `json:"accountingAccepted"`
		Suppliers          []struct {
			ID                      string `json:"id"`
			KeyEnv                  string `json:"keyEnv"`
			Entity                  string `json:"entity"`
			Account                 string `json:"account"`
			ZeroLimitVerified       bool   `json:"zeroLimitVerified"`
			CollectiveLimitVerified bool   `json:"collectiveLimitVerified"`
			RecoveryVerified        bool   `json:"recoveryVerified"`
			ReconciliationVerified  bool   `json:"reconciliationVerified"`
		} `json:"suppliers"`
	}
	if json.Unmarshal(raw, &cfg) != nil || !textOK(cfg.EvidenceRef, 300) || !cfg.AccountingAccepted {
		return nil, errors.New("issuing_certification_invalid")
	}
	if s.Funds != nil && (cfg.FundingSource != "funds_wallet" || cfg.FundsNamespace != s.Funds.Namespace) {
		return nil, errors.New("unified_accounting_certification_required")
	}
	for _, v := range cfg.Suppliers {
		if !ValidID(v.ID) || !sourceID.MatchString(v.Entity) || !sourceID.MatchString(v.Account) || !v.ZeroLimitVerified || !v.CollectiveLimitVerified || !v.RecoveryVerified || !v.ReconciliationVerified || !strings.HasPrefix(v.KeyEnv, "ISSUING_SLASH_KEY_") || os.Getenv(v.KeyEnv) == "" {
			return nil, errors.New("supplier_certification_invalid")
		}
		if s.Providers[v.ID] != nil {
			return nil, errors.New("duplicate_supplier")
		}
		s.Providers[v.ID] = NewSlash(os.Getenv(v.KeyEnv), v.Entity, v.Account)
	}
	s.Mode = "live"
	s.Enabled = true
	return s, nil
}

// Local execution is opt-in, loopback-only, and cannot reuse application or shadow databases.
func localService(s *Service) (*Service, error) {
	c := s.DB.Config().ConnConfig
	if (c.Host != "/tmp" && c.Host != "127.0.0.1" && c.Host != "localhost") || !strings.HasPrefix(c.Database, "moventra_test_") {
		return nil, errors.New("isolated_issuing_database_required")
	}
	localURL := func(raw string) bool {
		u, e := url.Parse(raw)
		return e == nil && u.Scheme == "http" && u.Hostname() == "127.0.0.1" && u.Port() != "" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && (u.Path == "" || u.Path == "/")
	}
	if !localURL(os.Getenv("ISSUING_BLNK_URL")) || !localURL(os.Getenv("ISSUING_FIXTURE_URL")) {
		return nil, errors.New("loopback_fixtures_required")
	}
	id := os.Getenv("ISSUING_FIXTURE_SUPPLIER_ID")
	if !ValidID(id) {
		return nil, ErrInvalid
	}
	b, e := blnk.New(os.Getenv("ISSUING_BLNK_URL"), os.Getenv("ISSUING_BLNK_KEY"))
	if e != nil {
		return nil, e
	}
	p := NewSlash("synthetic", "fixture_entity", "fixture_account")
	p.base = strings.TrimSuffix(os.Getenv("ISSUING_FIXTURE_URL"), "/")
	s.Blnk = b
	s.Providers[id] = p
	s.Enabled = true
	s.Mode = "isolated"
	if source := os.Getenv("ISSUING_FUNDING_SOURCE"); source != "" && source != "issuing_wallet" {
		if source != "funds_wallet" {
			return nil, errors.New("invalid_issuing_funding_source")
		}
		namespace := os.Getenv("ISSUING_LOCAL_FUNDS_NAMESPACE")
		if strings.HasPrefix(namespace, "live_issuing_test_") {
			// Production-schema acceptance is confined to this already-validated
			// loopback database/provider/ledger fixture. Never accepts a real namespace.
			s.Funds, e = ledger.NewLive(s.DB, b, namespace, "general_ledger_id")
		} else {
			s.Funds, e = ledger.New(s.DB, b, namespace, "general_ledger_id")
		}
		if e != nil {
			return nil, e
		}
	}
	return s, nil
}
