package cregis

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

var ErrConfig = errors.New("cregis_configuration_required")
var ErrUpstream = errors.New("cregis_query_failed")
var ErrResponse = errors.New("cregis_invalid_response")

// Client exposes only read operations. Reuse one per project within a process.
// Multiple processes must coordinate the provider's project rate limit externally.
type Client struct {
	baseURL, projectID, key string
	http                    *http.Client
	mu                      sync.Mutex
	next                    time.Time
}

func NewClient(baseURL, projectID, key string) (*Client, error) {
	u, e := url.Parse(baseURL)
	id, idErr := strconv.ParseInt(projectID, 10, 64)
	if e != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || idErr != nil || id <= 0 || !positiveID.MatchString(projectID) || strings.TrimSpace(key) == "" {
		return nil, ErrConfig
	}
	return &Client{baseURL: strings.TrimSuffix(baseURL, "/"), projectID: projectID, key: key, http: &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

// FromEnv does not log or expose key values, and never auto-loads dotenv files.
func FromEnv() (*Client, error) {
	return NewClient(os.Getenv("CREGIS_BASE_URL"), os.Getenv("CREGIS_PROJECT_ID"), os.Getenv("CREGIS_API_KEY"))
}

type TradeQuery struct {
	Page, PageSize                  int
	Status                          *int // nil means no filter; zero means pending confirmation.
	ChainID, TokenID, TransactionID string
}

// Channel values retain their source types. These are not customer ledger rows.
type Trade struct {
	ID            json.Number `json:"cid"`
	ProjectID     json.Number `json:"pid"`
	Status        *int        `json:"status"`
	TradeType     string      `json:"trade_type"`
	BusinessType  string      `json:"business_type"`
	Amount        string      `json:"amount"`
	Currency      string      `json:"currency"`
	ChainID       string      `json:"chain_id"`
	TokenID       string      `json:"token_id"`
	FromAddress   string      `json:"from_address"`
	ToAddress     string      `json:"to_address"`
	TransactionID string      `json:"txid"`
	BlockHeight   string      `json:"block_height"`
	BlockTime     json.Number `json:"block_time"`
	Fee           string      `json:"fee"`
	Memo          string      `json:"memo"`
	Remark        string      `json:"remark"`
}
type TradePage struct {
	Total    json.Number `json:"total"`
	Page     int         `json:"pageNum"`
	PageSize int         `json:"pageSize"`
	Rows     []Trade     `json:"rows"`
}

func (c *Client) wait(ctx context.Context) error {
	for {
		c.mu.Lock()
		delay := time.Until(c.next)
		if delay <= 0 {
			c.next = time.Now().Add(2100 * time.Millisecond)
			c.mu.Unlock()
			return ctx.Err()
		}
		c.mu.Unlock()
		t := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			t.Stop()
			return ctx.Err()
		case <-t.C:
		}
	}
}

// ListTrades calls only POST /api/v1/trade/page, a read-only Cregis operation.
// Errors do not include raw upstream responses or request credentials.
func (c *Client) ListTrades(ctx context.Context, q TradeQuery) (TradePage, error) {
	if q.Page == 0 {
		q.Page = 1
	}
	if q.PageSize == 0 {
		q.PageSize = 20
	}
	if q.Page < 1 || q.Page > 2147483647 || q.PageSize < 1 || q.PageSize > 100 || (q.Status != nil && (*q.Status < 0 || *q.Status > 2)) {
		return TradePage{}, ErrInvalid
	}
	if e := c.wait(ctx); e != nil {
		return TradePage{}, e
	}
	b := make([]byte, 3)
	if _, e := rand.Read(b); e != nil {
		return TradePage{}, ErrUpstream
	}
	f := map[string]any{"pid": json.Number(c.projectID), "nonce": hex.EncodeToString(b), "timestamp": json.Number(strconv.FormatInt(time.Now().UnixMilli(), 10)), "page_num": json.Number(strconv.Itoa(q.Page)), "page_size": json.Number(strconv.Itoa(q.PageSize))}
	if q.Status != nil {
		f["status"] = json.Number(strconv.Itoa(*q.Status))
	}
	for k, v := range map[string]string{"chain_id": q.ChainID, "token_id": q.TokenID, "tx_id": q.TransactionID} {
		if v != "" {
			f[k] = v
		}
	}
	sig, e := WaaSSignature(c.key, f)
	if e != nil {
		return TradePage{}, e
	}
	f["sign"] = sig
	body, e := json.Marshal(f)
	if e != nil {
		return TradePage{}, ErrInvalid
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/trade/page", bytes.NewReader(body))
	if e != nil {
		return TradePage{}, ErrConfig
	}
	req.Header.Set("Content-Type", "application/json")
	res, e := c.http.Do(req)
	if e != nil {
		if ctx.Err() != nil {
			return TradePage{}, ctx.Err()
		}
		return TradePage{}, ErrUpstream
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return TradePage{}, ErrUpstream
	}
	const max = 2 << 20
	raw, e := io.ReadAll(io.LimitReader(res.Body, max+1))
	if e != nil || len(raw) > max {
		return TradePage{}, ErrResponse
	}
	var envelope struct {
		Code string          `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(raw, &envelope) != nil {
		return TradePage{}, ErrResponse
	}
	if envelope.Code != "00000" {
		return TradePage{}, ErrUpstream
	}
	var page TradePage
	if json.Unmarshal(envelope.Data, &page) != nil {
		return TradePage{}, ErrResponse
	}
	total, e := page.Total.Int64()
	if e != nil || total < 0 || page.Page != q.Page || page.PageSize != q.PageSize || page.Rows == nil || len(page.Rows) > q.PageSize || int64(len(page.Rows)) > total {
		return TradePage{}, ErrResponse
	}
	for _, row := range page.Rows {
		id, e := row.ID.Int64()
		if e != nil || id <= 0 || row.ProjectID.String() != c.projectID || row.Status == nil || *row.Status < 0 || *row.Status > 2 || !decimalAmount.MatchString(row.Amount) || row.Currency == "" || row.ChainID == "" || row.TokenID == "" {
			return TradePage{}, ErrResponse
		}
	}
	return page, nil
}
