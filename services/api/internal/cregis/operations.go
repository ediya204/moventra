package cregis

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// request never retries. The default writer constructor permits only loopback;
// live construction requires the funds activation path.
func (c *Client) request(ctx context.Context, path string, f map[string]any, out any) error {
	if e := c.wait(ctx); e != nil {
		return e
	}
	b := make([]byte, 3)
	if _, e := rand.Read(b); e != nil {
		return ErrUpstream
	}
	f["pid"] = json.Number(c.projectID)
	f["nonce"] = hex.EncodeToString(b)
	f["timestamp"] = json.Number(strconv.FormatInt(time.Now().UnixMilli(), 10))
	sig, e := WaaSSignature(c.key, f)
	if e != nil {
		return e
	}
	f["sign"] = sig
	raw, e := json.Marshal(f)
	if e != nil {
		return ErrInvalid
	}
	req, e := http.NewRequestWithContext(ctx, "POST", c.baseURL+path, bytes.NewReader(raw))
	if e != nil {
		return ErrConfig
	}
	req.Header.Set("Content-Type", "application/json")
	res, e := c.http.Do(req)
	if e != nil {
		return ErrUpstream
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return ErrUpstream
	}
	raw, e = io.ReadAll(io.LimitReader(res.Body, (2<<20)+1))
	if e != nil || len(raw) > 2<<20 {
		return ErrResponse
	}
	var envelope struct {
		Code string          `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(raw, &envelope) != nil {
		return ErrResponse
	}
	if envelope.Code != "00000" {
		return ErrUpstream
	}
	if json.Unmarshal(envelope.Data, out) != nil {
		return ErrResponse
	}
	return nil
}

type Coin struct {
	Name     string `json:"coin_name"`
	ChainID  string `json:"chain_id"`
	TokenID  string `json:"token_id"`
	Decimals string `json:"decimals"`
}
type Coins struct {
	Payout  []Coin `json:"payout_coins"`
	Address []Coin `json:"address_coins"`
}

func (c *Client) Coins(ctx context.Context) (Coins, error) {
	var v Coins
	e := c.request(ctx, "/api/v1/coins", map[string]any{}, &v)
	if e != nil {
		return v, e
	}
	for _, list := range [][]Coin{v.Payout, v.Address} {
		for _, coin := range list {
			n, e := strconv.Atoi(coin.Decimals)
			if e != nil || n < 0 || n > 38 || coin.ChainID == "" || coin.TokenID == "" {
				return Coins{}, ErrResponse
			}
		}
	}
	return v, nil
}

type PayoutInfo struct {
	ProjectID     json.Number `json:"pid"`
	ChainID       string      `json:"chain_id"`
	TokenID       string      `json:"token_id"`
	Currency      string      `json:"currency"`
	Address       string      `json:"address"`
	Amount        string      `json:"amount"`
	BusinessID    string      `json:"third_party_id"`
	Status        *int        `json:"status"`
	TransactionID *string     `json:"txid"`
}

func (c *Client) QueryPayout(ctx context.Context, id string) (PayoutInfo, error) {
	var p PayoutInfo
	if !positiveID.MatchString(id) {
		return p, ErrInvalid
	}
	e := c.request(ctx, "/api/v1/payout/query", map[string]any{"cid": json.Number(id)}, &p)
	if e != nil {
		return p, e
	}
	if p.ProjectID.String() != c.projectID || p.Status == nil || *p.Status < 0 || *p.Status > 7 || !decimalAmount.MatchString(p.Amount) || p.BusinessID == "" {
		return PayoutInfo{}, ErrResponse
	}
	return p, nil
}

type LocalWriter struct{ client *Client }

func NewLocalWriter(c *Client) (*LocalWriter, error) {
	if c == nil {
		return nil, ErrConfig
	}
	u, e := url.Parse(c.baseURL)
	if e != nil {
		return nil, ErrConfig
	}
	ip := net.ParseIP(u.Hostname())
	if u.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return nil, ErrConfig
	}
	return &LocalWriter{c}, nil
}
func (w *LocalWriter) CreateAddress(ctx context.Context, chain, alias, callback string) (string, error) {
	if chain == "" || alias == "" {
		return "", ErrInvalid
	}
	var v struct {
		Address string `json:"address"`
	}
	e := w.client.request(ctx, "/api/v1/address/create", map[string]any{"chain_id": chain, "alias": alias, "callback_url": callback}, &v)
	if e == nil && v.Address == "" {
		e = ErrResponse
	}
	return v.Address, e
}

type PayoutRequest struct{ Currency, Address, Amount, BusinessID, CallbackURL, WalletID string }

func (w *LocalWriter) Payout(ctx context.Context, p PayoutRequest) (string, error) {
	if p.Currency == "" || p.Address == "" || !decimalAmount.MatchString(p.Amount) || p.BusinessID == "" {
		return "", ErrInvalid
	}
	f := map[string]any{"currency": p.Currency, "to_address": p.Address, "amount": p.Amount, "third_party_id": p.BusinessID, "callback_url": p.CallbackURL}
	if p.WalletID != "" {
		if !positiveID.MatchString(p.WalletID) {
			return "", ErrInvalid
		}
		f["wallet_id"] = json.Number(p.WalletID)
	}
	var v struct {
		ID json.Number `json:"cid"`
	}
	e := w.client.request(ctx, "/api/v2/payout", f, &v)
	if e == nil && !positiveID.MatchString(v.ID.String()) {
		e = ErrResponse
	}
	return v.ID.String(), e
}

func (c *Client) ValidateAddress(ctx context.Context, chain, address string) (bool, error) {
	if chain == "" || address == "" {
		return false, ErrInvalid
	}
	var v struct {
		Result *bool `json:"result"`
	}
	e := c.request(ctx, "/api/v1/address/legal", map[string]any{"chain_id": chain, "address": address}, &v)
	if e != nil {
		return false, e
	}
	if v.Result == nil {
		return false, ErrResponse
	}
	return *v.Result, nil
}

// NewLiveWriter is constructed only after server-side certification. It performs
// no request on construction and never retries ambiguous writes.
func NewLiveWriter(c *Client, activated bool) (*LocalWriter, error) {
	if c == nil || !activated {
		return nil, ErrConfig
	}
	return &LocalWriter{c}, nil
}
