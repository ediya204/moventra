// Package tron verifies solidified TRC20 receipts using read-only node APIs.
package tron

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var ErrEvidence = errors.New("tron_evidence_unverified")

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const transferTopic = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

func AddressHex(s string) (string, error) {
	n := new(big.Int)
	for _, r := range s {
		i := strings.IndexRune(alphabet, r)
		if i < 0 {
			return "", ErrEvidence
		}
		n.Mul(n, big.NewInt(58))
		n.Add(n, big.NewInt(int64(i)))
	}
	b := n.Bytes()
	if len(s) != 34 || len(b) != 25 || b[0] != 0x41 {
		return "", ErrEvidence
	}
	h := sha256.Sum256(b[:21])
	h = sha256.Sum256(h[:])
	if !bytes.Equal(h[:4], b[21:]) {
		return "", ErrEvidence
	}
	return hex.EncodeToString(b[1:21]), nil
}

type Log struct {
	Address string   `json:"address"`
	Topics  []string `json:"topics"`
	Data    string   `json:"data"`
}
type Receipt struct {
	ID          string      `json:"id"`
	BlockNumber json.Number `json:"blockNumber"`
	BlockTime   json.Number `json:"blockTimeStamp"`
	Receipt     struct {
		Result string `json:"result"`
	} `json:"receipt"`
	Logs []Log `json:"log"`
}
type Proof struct {
	TransactionHash string `json:"txHash"`
	TransferIndex   string `json:"transferIndex"`
	BlockNumber     string `json:"blockNumber"`
	AmountMinor     string `json:"amountMinor"`
	EvidenceRef     string `json:"evidenceRef"`
}

// Match must only receive a receipt fetched from the configured solidity API.
// Multiple identical transfers are ambiguous, never assigned an invented index.
func Match(r Receipt, hash, contract, address, amount string) (Proof, error) {
	var p Proof
	contractHex, e := AddressHex(contract)
	if e != nil {
		return p, e
	}
	to, e := AddressHex(address)
	if e != nil {
		return p, e
	}
	if len(hash) != 64 || r.ID != hash || r.Receipt.Result != "SUCCESS" {
		return p, ErrEvidence
	}
	if _, e = hex.DecodeString(hash); e != nil {
		return p, ErrEvidence
	}
	height, e := r.BlockNumber.Int64()
	if e != nil || height <= 0 {
		return p, ErrEvidence
	}
	matches := 0
	for i, l := range r.Logs {
		a := strings.TrimPrefix(strings.ToLower(l.Address), "0x")
		if len(a) == 42 && strings.HasPrefix(a, "41") {
			a = a[2:]
		}
		if a != contractHex || len(l.Topics) != 3 || strings.ToLower(l.Topics[0]) != transferTopic || len(l.Topics[1]) != 64 || len(l.Topics[2]) != 64 || !strings.HasPrefix(l.Topics[2], strings.Repeat("0", 24)) || strings.ToLower(l.Topics[2][24:]) != to || len(l.Data) != 64 {
			continue
		}
		n, ok := new(big.Int).SetString(l.Data, 16)
		if !ok || n.Sign() <= 0 || n.String() != amount {
			continue
		}
		matches++
		p = Proof{hash, big.NewInt(int64(i)).String(), r.BlockNumber.String(), amount, "tron:solidified:" + hash}
	}
	if matches != 1 {
		return Proof{}, ErrEvidence
	}
	return p, nil
}

type Client struct {
	URL, Key string
	HTTP     *http.Client
}

func New(raw, key string) (*Client, error) {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" {
		return nil, ErrEvidence
	}
	return &Client{strings.TrimSuffix(raw, "/"), key, &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (c *Client) Verify(ctx context.Context, hash, contract, address, amount string) (Proof, error) {
	if len(hash) != 64 {
		return Proof{}, ErrEvidence
	}
	body, _ := json.Marshal(map[string]string{"value": hash})
	req, e := http.NewRequestWithContext(ctx, "POST", c.URL+"/walletsolidity/gettransactioninfobyid", bytes.NewReader(body))
	if e != nil {
		return Proof{}, ErrEvidence
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Key != "" {
		req.Header.Set("TRON-PRO-API-KEY", c.Key)
	}
	res, e := c.HTTP.Do(req)
	if e != nil {
		return Proof{}, ErrEvidence
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return Proof{}, ErrEvidence
	}
	raw, e := io.ReadAll(io.LimitReader(res.Body, 2*1024*1024+1))
	if e != nil || len(raw) > 2*1024*1024 {
		return Proof{}, ErrEvidence
	}
	var r Receipt
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if d.Decode(&r) != nil || d.Decode(new(any)) != io.EOF {
		return Proof{}, ErrEvidence
	}
	return Match(r, hash, contract, address, amount)
}

// FixtureAddress creates a deterministic synthetic test identity. Callers must
// never present this as a real deposit address or offer a sendable QR code.
func FixtureAddress(identity string) string {
	h := sha256.Sum256([]byte("moventra-fixture-address:" + identity))
	p := append([]byte{0x41}, h[:20]...)
	check := sha256.Sum256(p)
	check = sha256.Sum256(check[:])
	p = append(p, check[:4]...)
	n := new(big.Int).SetBytes(p)
	s := ""
	for n.Sign() > 0 {
		q, r := new(big.Int), new(big.Int)
		q.QuoRem(n, big.NewInt(58), r)
		s = string(alphabet[r.Int64()]) + s
		n = q
	}
	return s
}
