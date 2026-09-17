// Package blnk is the server-only Blnk Core 0.15.4 HTTP boundary.
package blnk

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"time"
)

var ErrNotFound = errors.New("blnk_not_found")
var ErrUnknown = errors.New("blnk_outcome_unknown")
var ErrConflict = errors.New("blnk_payload_conflict")
var ErrRejected = errors.New("blnk_rejected")
var token = regexp.MustCompile(`^[A-Za-z0-9_-]{1,180}$`)

type Client struct {
	base, key string
	http      *http.Client
}
type Balance struct {
	ID            string   `json:"balance_id"`
	LedgerID      string   `json:"ledger_id"`
	Indicator     string   `json:"indicator"`
	Currency      string   `json:"currency"`
	Amount        *big.Int `json:"balance"`
	InflightDebit *big.Int `json:"inflight_debit_balance"`
	Version       int64    `json:"version"`
}
type Transfer struct {
	Description    string   `json:"description"`
	Reference      string   `json:"reference"`
	Source         string   `json:"source"`
	Destination    string   `json:"destination"`
	Currency       string   `json:"currency"`
	Amount         *big.Int `json:"precise_amount"`
	Precision      int64    `json:"precision"`
	AllowOverdraft bool     `json:"allow_overdraft"`
	SkipQueue      bool     `json:"skip_queue"`
}
type Transaction struct {
	ID          string   `json:"transaction_id"`
	Reference   string   `json:"reference"`
	Source      string   `json:"source"`
	Destination string   `json:"destination"`
	Currency    string   `json:"currency"`
	Amount      *big.Int `json:"precise_amount"`
	Precision   int64    `json:"precision"`
	Status      string   `json:"status"`
}

func New(base, key string) (*Client, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || key == "" {
		return nil, errors.New("invalid_blnk_configuration")
	}
	ip := net.ParseIP(u.Hostname())
	local := u.Hostname() == "localhost" || (ip != nil && ip.IsLoopback())
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return nil, errors.New("blnk_requires_tls")
	}
	return &Client{base: u.Scheme + "://" + u.Host, key: key, http: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (c *Client) call(ctx context.Context, method, path string, input, output any) error {
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return ErrUnknown
	}
	req.Header.Set("X-blnk-key", c.key)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return ErrUnknown
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return ErrUnknown
	}
	if res.StatusCode == 404 {
		return ErrNotFound
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var e struct {
			Detail struct {
				Code string `json:"code"`
			} `json:"error_detail"`
		}
		_ = json.Unmarshal(data, &e)
		// Never include provider payloads, URLs or credentials in errors/logs.
		if e.Detail.Code == "TXN_INSUFFICIENT_FUNDS" {
			return ErrRejected
		}
		return ErrUnknown
	}
	if output != nil && json.Unmarshal(data, output) != nil {
		return ErrUnknown
	}
	return nil
}
func (c *Client) Balance(ctx context.Context, id string) (Balance, error) {
	var b Balance
	if !token.MatchString(id) {
		return b, ErrConflict
	}
	err := c.call(ctx, "GET", "/balances/"+id, nil, &b)
	if err == nil && (b.ID != id || b.Amount == nil || b.InflightDebit == nil) {
		err = ErrUnknown
	}
	return b, err
}
func (c *Client) EnsureBalance(ctx context.Context, ledger, indicator, currency string, precision int64) (Balance, error) {
	var b Balance
	if !token.MatchString(ledger) || !token.MatchString(indicator) || !token.MatchString(currency) {
		return b, ErrConflict
	}
	indicator = "@" + indicator
	path := "/balances/indicator/" + indicator + "/currency/" + currency
	err := c.call(ctx, "GET", path, nil, &b)
	if errors.Is(err, ErrNotFound) {
		err = c.call(ctx, "POST", "/balances", map[string]any{"ledger_id": ledger, "indicator": indicator, "currency": currency, "precision": precision}, &b)
		if err != nil {
			err = c.call(ctx, "GET", path, nil, &b)
		}
	}
	if err == nil && (b.ID == "" || b.LedgerID != ledger || b.Currency != currency || b.Indicator != indicator) {
		err = ErrConflict
	}
	return b, err
}
func (c *Client) Lookup(ctx context.Context, ref string) (Transaction, error) {
	var t Transaction
	if !token.MatchString(ref) {
		return t, ErrConflict
	}
	err := c.call(ctx, "GET", "/transactions/reference/"+ref, nil, &t)
	// Core 0.15.4 reference lookup omits precision in its SQL projection.
	// Fetch the full object rather than weakening payload comparison.
	if err == nil && t.Precision == 0 {
		if !token.MatchString(t.ID) {
			return t, ErrConflict
		}
		id := t.ID
		err = c.call(ctx, "GET", "/transactions/"+id, nil, &t)
		if err == nil && t.ID != id {
			return t, ErrConflict
		}
	}
	return t, err
}

// Apply recovers a lost response by immutable reference. A conflict is never
// considered successful until every material accounting field matches.
func (c *Client) Apply(ctx context.Context, r Transfer) (Transaction, error) {
	var t Transaction
	if !token.MatchString(r.Reference) || !token.MatchString(r.Source) || !token.MatchString(r.Destination) || r.Source == r.Destination || r.Amount == nil || r.Amount.Sign() <= 0 || r.Precision <= 0 {
		return t, ErrConflict
	}
	r.SkipQueue = true
	r.Description = "Moventra shadow accounting"
	t, err := c.Lookup(ctx, r.Reference)
	if errors.Is(err, ErrNotFound) {
		err = c.call(ctx, "POST", "/transactions", r, &t)
		if err != nil {
			postErr := err
			t, err = c.Lookup(ctx, r.Reference)
			if errors.Is(err, ErrNotFound) && errors.Is(postErr, ErrRejected) {
				return t, ErrRejected
			}
		}
	}
	if err != nil {
		return t, err
	}
	if t.ID == "" || t.Reference != r.Reference || t.Source != r.Source || t.Destination != r.Destination || t.Currency != r.Currency || t.Precision != r.Precision || t.Amount == nil || t.Amount.Cmp(r.Amount) != 0 {
		return t, ErrConflict
	}
	switch t.Status {
	case "APPLIED":
		return t, nil
	case "REJECTED":
		return t, ErrRejected
	default:
		return t, ErrUnknown
	}
}
