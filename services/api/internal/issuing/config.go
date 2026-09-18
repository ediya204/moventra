package issuing

import (
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/blnk"
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
	if mode != "live" {
		return nil, errors.New("invalid_issuing_mode")
	}
	if os.Getenv("LEDGER_MODE") == "shadow" || strings.HasPrefix(db.Config().ConnConfig.Database, "moventra_shadow_") {
		return nil, errors.New("live_shadow_isolation_required")
	}
	u, e := url.Parse(os.Getenv("ISSUING_BLNK_URL"))
	if e != nil || u.Scheme != "https" || u.Host == "" || os.Getenv("ISSUING_BLNK_URL") == os.Getenv("BLNK_URL") {
		return nil, errors.New("dedicated_tls_blnk_required")
	}
	c, e := blnk.New(u.String(), os.Getenv("ISSUING_BLNK_KEY"))
	if e != nil {
		return nil, e
	}
	s.Blnk = c
	path := os.Getenv("ISSUING_CERTIFICATION_FILE")
	raw, e := os.ReadFile(path)
	if e != nil {
		return nil, errors.New("issuing_certification_required")
	}
	var cfg struct {
		EvidenceRef        string `json:"evidenceRef"`
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
	return s, nil
}
