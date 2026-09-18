package cryptofunds

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"time"
)

// CardProvider changes a certified, exclusively managed collective limit. Limits
// are never used as a ledger balance. Unknown results require readback.
type CardProvider interface {
	SetLimit(context.Context, FundsCard, string, string) error
}
type SlashCards struct {
	Key, Entity, Account, Connection, Base string
	HTTP                                   *http.Client
}

func CardProviderFromEnv() (CardProvider, error) {
	var cfg struct {
		Connection, Entity, Account, KeyEnv, EvidenceRef                                                                                                       string
		ExclusiveControl, CollectiveLimitVerified, AuthorizationCoverageVerified, RecoveryVerified, LimitEnforcedBeforeAcknowledgment, PostLimitReadConsistent bool
	}
	raw, e := os.ReadFile(os.Getenv("FUNDS_SLASH_CERTIFICATION_FILE"))
	if e != nil || json.Unmarshal(raw, &cfg) != nil || cfg.EvidenceRef == "" || !cfg.ExclusiveControl || !cfg.CollectiveLimitVerified || !cfg.AuthorizationCoverageVerified || !cfg.RecoveryVerified || !cfg.LimitEnforcedBeforeAcknowledgment || !cfg.PostLimitReadConsistent || !safeRef.MatchString(cfg.Connection) || !safeRef.MatchString(cfg.Entity) || !safeRef.MatchString(cfg.Account) || os.Getenv(cfg.KeyEnv) == "" {
		return nil, errors.New("funds_card_certification_required")
	}
	return &SlashCards{os.Getenv(cfg.KeyEnv), cfg.Entity, cfg.Account, cfg.Connection, "https://api.slash.com", &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (s *SlashCards) call(ctx context.Context, method, path string, body any, out any) error {
	var data []byte
	var e error
	if body != nil {
		data, e = json.Marshal(body)
		if e != nil {
			return e
		}
	}
	r, e := http.NewRequestWithContext(ctx, method, s.Base+path, bytes.NewReader(data))
	if e != nil {
		return errors.New("card_outcome_unknown")
	}
	r.Header.Set("X-API-Key", s.Key)
	r.Header.Set("x-legal-entity", s.Entity)
	r.Header.Set("Content-Type", "application/json")
	resp, e := s.HTTP.Do(r)
	if e != nil {
		return errors.New("card_outcome_unknown")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return errors.New("card_outcome_unknown")
	}
	raw, e := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if e != nil || len(raw) > 1<<20 || json.Unmarshal(raw, out) != nil {
		return errors.New("card_outcome_unknown")
	}
	return nil
}
func (s *SlashCards) SetLimit(ctx context.Context, c FundsCard, before, after string) error {
	if c.Connection != s.Connection || !safeRef.MatchString(c.ExternalID) {
		return conflict("card_scope_mismatch")
	}
	if _, e := number(after, true); e != nil {
		return e
	}
	type card struct {
		ID         string                     `json:"id"`
		Account    string                     `json:"accountId"`
		Status     string                     `json:"status"`
		Constraint map[string]json.RawMessage `json:"spendingConstraint"`
	}
	read := func() (card, string, error) {
		var v card
		e := s.call(ctx, "GET", "/card/"+c.ExternalID, nil, &v)
		if e != nil {
			return v, "", e
		}
		if v.ID != c.ExternalID || v.Account != s.Account || v.Status != "active" {
			return v, "", conflict("card_scope_mismatch")
		}
		var rules map[string]json.RawMessage
		if json.Unmarshal(v.Constraint["spendingRule"], &rules) != nil {
			return v, "", conflict("card_limit_unverified")
		}
		var limit struct {
			Preset string `json:"preset"`
			Amount struct {
				Cents json.Number `json:"amountCents"`
			} `json:"limitAmount"`
		}
		if json.Unmarshal(rules["utilizationLimit"], &limit) != nil || limit.Preset != "collective" || len(rules["utilizationLimitV2"]) > 0 {
			return v, "", conflict("card_limit_unverified")
		}
		return v, limit.Amount.Cents.String(), nil
	}
	v, current, e := read()
	if e != nil {
		return e
	}
	if current == after {
		return nil
	}
	if current != before {
		return conflict("card_limit_changed")
	}
	var rules map[string]json.RawMessage
	if json.Unmarshal(v.Constraint["spendingRule"], &rules) != nil {
		return invalid("card_rules_invalid")
	}
	rules["utilizationLimit"], _ = json.Marshal(map[string]any{"preset": "collective", "limitAmount": map[string]any{"amountCents": json.Number(after)}})
	v.Constraint["spendingRule"], _ = json.Marshal(rules)
	var result any
	callErr := s.call(ctx, "PUT", "/card/"+c.ExternalID+"/spending-constraint", v.Constraint, &result)
	_, current, e = read()
	if e == nil && current == after {
		return nil
	}
	if callErr != nil {
		return callErr
	}
	return errors.New("card_outcome_unknown")
}
