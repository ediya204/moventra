package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
)

// CardSecrets is deliberately separate from projection import and request logging.
type CardSecrets interface {
	Reveal(context.Context, string, string, string) (string, error)
}
type slashCardSecrets struct {
	key, base string
	client    *http.Client
}

func CardSecretsFromEnv() CardSecrets {
	if os.Getenv("CARD_CVV_ENABLED") != "true" || os.Getenv("SLASH_API_KEY") == "" {
		return nil
	}
	return &slashCardSecrets{os.Getenv("SLASH_API_KEY"), "https://vault.slash.com", &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

var secretDigits = regexp.MustCompile(`^[0-9]{3,4}$`)

func (s *slashCardSecrets) Reveal(ctx context.Context, card, account, wallet string) (string, error) {
	unavailable := errors.New("card_secret_unavailable")
	req, e := http.NewRequestWithContext(ctx, "GET", s.base+"/card/"+url.PathEscape(card)+"?include_cvv=true&include_pan=false", nil)
	if e != nil {
		return "", unavailable
	}
	req.Header.Set("X-API-Key", s.key)
	req.Header.Set("Accept", "application/json")
	res, e := s.client.Do(req)
	if e != nil {
		return "", unavailable
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", unavailable
	}
	// Decode only fields needed for identity validation and the requested secret.
	// PAN and unknown fields are never materialized into application structs.
	var v struct {
		ID      string `json:"id"`
		Account string `json:"accountId"`
		Wallet  string `json:"virtualAccountId"`
		CVV     string `json:"cvv"`
	}
	d := json.NewDecoder(io.LimitReader(res.Body, 65537))
	if d.Decode(&v) != nil || d.Decode(new(any)) != io.EOF || v.ID != card || v.Account != account || v.Wallet != wallet || !secretDigits.MatchString(v.CVV) {
		return "", unavailable
	}
	return v.CVV, nil
}

const cardSecretScope = `SELECT w.account_ref,w.virtual_account_ref FROM project_wallet_cards b JOIN project_wallets w ON w.connection_id=b.connection_id AND w.virtual_account_ref=b.virtual_account_ref JOIN customers c ON c.id=b.customer_id JOIN users u ON u.id=c.personal_owner_id JOIN card_sync_links l ON l.connection_id=b.connection_id AND l.enabled JOIN slash_hook_connections h ON h.id=l.hook_connection_id AND h.enabled AND h.account_ref=w.account_ref WHERE b.customer_id=$1 AND b.connection_id=$2 AND b.external_card_id=$3 AND c.personal_owner_id=$4 AND c.kind='personal' AND u.status='active' FOR SHARE OF b,w,c,u,l,h`

func (s *Server) revealCardSecret(w http.ResponseWriter, r *http.Request, tx pgx.Tx, p principal, connection, card, customer, revision string) {
	w.Header().Set("Cache-Control", "private, no-store")
	if customer == "" || p.Role != "customer" {
		fail(w, 404, "not_found")
		return
	}
	if s.CardSecrets == nil {
		fail(w, 409, "card_secret_disabled")
		return
	}
	var input struct {
		Purpose string `json:"purpose"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || input.Purpose != "cardholder-view" {
		fail(w, 400, "invalid_request")
		return
	}
	var account, wallet string
	if e := tx.QueryRow(r.Context(), cardSecretScope, customer, connection, card, p.ID).Scan(&account, &wallet); e != nil {
		fail(w, 404, "not_found")
		return
	}
	// Shared database locks serialize the rate decision across API replicas.
	if _, e := tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock(hashtextextended($1,0)),pg_advisory_xact_lock(hashtextextended($2,0))`, "cvv:user:"+p.ID, "cvv:card:"+connection+":"+card); e != nil {
		fail(w, 503, "card_secret_unavailable")
		return
	}
	var userCount, cardCount int
	if e := tx.QueryRow(r.Context(), `SELECT count(*) FILTER(WHERE actor_id=$1),count(*) FILTER(WHERE connection_id=$2 AND action=$3) FROM channel_read_audit WHERE action LIKE 'card:cvv:request:%' AND created_at>now()-interval '1 minute'`, p.ID, connection, "card:cvv:request:"+card).Scan(&userCount, &cardCount); e != nil {
		fail(w, 503, "card_secret_unavailable")
		return
	}
	if userCount >= 10 || cardCount >= 3 {
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "card_secret_rate_limited")
		return
	}
	if _, e := tx.Exec(r.Context(), `INSERT INTO channel_read_audit(connection_id,actor_id,action,revision) VALUES($1,$2,$3,$4)`, connection, p.ID, "card:cvv:request:"+card, revision); e != nil {
		fail(w, 503, "card_secret_unavailable")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "card_secret_unavailable")
		return
	}
	value, e := s.CardSecrets.Reveal(r.Context(), card, account, wallet)
	outcome := "failed"
	if e == nil {
		outcome = "success"
	}
	// Recheck current ownership after upstream I/O and before disclosing anything.
	check, err := s.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "card_secret_unavailable")
		return
	}
	defer check.Rollback(r.Context())
	var a, b string
	if check.QueryRow(r.Context(), cardSecretScope, customer, connection, card, p.ID).Scan(&a, &b) != nil || a != account || b != wallet {
		outcome = "denied"
	}
	if _, err = check.Exec(r.Context(), `INSERT INTO channel_read_audit(connection_id,actor_id,action,revision) VALUES($1,$2,$3,$4)`, connection, p.ID, "card:cvv:"+outcome+":"+card, revision); err != nil {
		fail(w, 503, "card_secret_unavailable")
		return
	}
	if outcome != "success" {
		_ = check.Commit(r.Context())
		fail(w, 503, "card_secret_unavailable")
		return
	}
	// Persist the safe outcome before disclosing the response.
	if check.Commit(r.Context()) != nil {
		fail(w, 503, "card_secret_unavailable")
		return
	}
	respond(w, 200, map[string]any{"source": "upstream", "cardId": card, "cvv": value, "expiresAt": time.Now().Add(30 * time.Second).UTC()})
}
