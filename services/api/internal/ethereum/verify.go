// Package ethereum verifies USDT transfers against a finalized canonical block.
package ethereum

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"moventra.local/api/internal/tron"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var ErrEvidence = errors.New("ethereum_evidence_unverified")

func ValidAddress(v string) bool {
	if len(v) != 42 || !strings.HasPrefix(v, "0x") {
		return false
	}
	_, e := hex.DecodeString(v[2:])
	return e == nil && strings.Trim(v[2:], "0") != ""
}
func quantity(v string) (*big.Int, error) {
	if !strings.HasPrefix(v, "0x") || len(v) < 3 {
		return nil, ErrEvidence
	}
	n, ok := new(big.Int).SetString(v[2:], 16)
	if !ok || n.Sign() < 0 {
		return nil, ErrEvidence
	}
	return n, nil
}

type Log struct {
	Address         string   `json:"address"`
	Topics          []string `json:"topics"`
	Data            string   `json:"data"`
	Index           string   `json:"logIndex"`
	Removed         bool     `json:"removed"`
	TransactionHash string   `json:"transactionHash"`
	BlockHash       string   `json:"blockHash"`
}
type Receipt struct {
	Hash        string `json:"transactionHash"`
	BlockHash   string `json:"blockHash"`
	BlockNumber string `json:"blockNumber"`
	Status      string `json:"status"`
	Logs        []Log  `json:"logs"`
}
type Block struct {
	Hash   string `json:"hash"`
	Number string `json:"number"`
}

func Match(r Receipt, finalized, canonical Block, hash, contract, address, amount string) (tron.Proof, error) {
	if len(hash) != 66 || !ValidAddress(contract) || !ValidAddress(address) || r.Hash != hash || r.Status != "0x1" || len(r.BlockHash) != 66 || r.BlockHash != canonical.Hash || canonical.Number != r.BlockNumber {
		return tron.Proof{}, ErrEvidence
	}
	if _, e := hex.DecodeString(strings.TrimPrefix(hash, "0x")); e != nil {
		return tron.Proof{}, ErrEvidence
	}
	height, e := quantity(r.BlockNumber)
	if e != nil {
		return tron.Proof{}, e
	}
	final, e := quantity(finalized.Number)
	if e != nil || height.Cmp(final) > 0 {
		return tron.Proof{}, ErrEvidence
	}
	var proof tron.Proof
	matches := 0
	for _, l := range r.Logs {
		if l.Removed || l.TransactionHash != hash || l.BlockHash != r.BlockHash || !strings.EqualFold(l.Address, contract) || len(l.Topics) != 3 || l.Topics[0] != "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" || len(l.Topics[1]) != 66 || len(l.Topics[2]) != 66 || !strings.HasPrefix(l.Topics[2], "0x"+strings.Repeat("0", 24)) || !strings.EqualFold(l.Topics[2][26:], address[2:]) || len(l.Data) != 66 {
			continue
		}
		n, e := quantity(l.Data)
		if e != nil || n.Sign() <= 0 || n.String() != amount {
			continue
		}
		index, e := quantity(l.Index)
		if e != nil || !index.IsUint64() || index.Uint64() > 9999999999 {
			return tron.Proof{}, ErrEvidence
		}
		matches++
		proof = tron.Proof{TransactionHash: strings.ToLower(hash), TransferIndex: index.String(), BlockNumber: height.String(), AmountMinor: amount, EvidenceRef: "ethereum:finalized:" + r.BlockHash}
	}
	if matches != 1 {
		return tron.Proof{}, ErrEvidence
	}
	return proof, nil
}

type Client struct {
	URL  string
	HTTP *http.Client
}

func New(raw string) (*Client, error) {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return nil, ErrEvidence
	}
	return &Client{raw, &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (c *Client) call(ctx context.Context, method string, params any, out any) error {
	b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	req, e := http.NewRequestWithContext(ctx, "POST", c.URL, bytes.NewReader(b))
	if e != nil {
		return ErrEvidence
	}
	req.Header.Set("Content-Type", "application/json")
	res, e := c.HTTP.Do(req)
	if e != nil {
		return ErrEvidence
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return ErrEvidence
	}
	raw, e := io.ReadAll(io.LimitReader(res.Body, 2<<20+1))
	if e != nil || len(raw) > 2<<20 {
		return ErrEvidence
	}
	var v struct {
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
		ID     int             `json:"id"`
	}
	if json.Unmarshal(raw, &v) != nil || v.ID != 1 || len(v.Error) > 0 && string(v.Error) != "null" || len(v.Result) == 0 || string(v.Result) == "null" {
		return ErrEvidence
	}
	if json.Unmarshal(v.Result, out) != nil {
		return ErrEvidence
	}
	return nil
}
func (c *Client) Verify(ctx context.Context, hash, contract, address, amount string) (tron.Proof, error) {
	var chain string
	if c.call(ctx, "eth_chainId", []any{}, &chain) != nil || chain != "0x1" {
		return tron.Proof{}, ErrEvidence
	}
	var r Receipt
	if e := c.call(ctx, "eth_getTransactionReceipt", []any{hash}, &r); e != nil {
		return tron.Proof{}, e
	}
	var f, b Block
	if c.call(ctx, "eth_getBlockByNumber", []any{"finalized", false}, &f) != nil || c.call(ctx, "eth_getBlockByNumber", []any{r.BlockNumber, false}, &b) != nil {
		return tron.Proof{}, ErrEvidence
	}
	return Match(r, f, b, hash, contract, address, amount)
}
