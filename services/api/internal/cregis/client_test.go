package cregis

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const tradeResponse = `{"code":"00000","data":{"total":1,"pageNum":1,"pageSize":20,"rows":[{"pid":1455735316373504,"cid":9007199254740993,"status":0,"amount":"0.000000000000000001","currency":"ETH","chain_id":"1","token_id":"1","trade_type":"1","business_type":"0"}]}}`

func TestReadOnlyClient(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/api/v1/trade/page" {
			t.Errorf("unexpected operation %s %s", r.Method, r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		f, e := VerifyWaaS("fixture-key", "1455735316373504", raw)
		if e != nil {
			t.Error(e)
		}
		if f["status"] != json.Number("0") || f["page_size"] != json.Number("20") || len(f["nonce"].(string)) != 6 {
			t.Error("request mismatch")
		}
		if strings.Contains(string(raw), "fixture-key") {
			t.Error("key transmitted")
		}
		io.WriteString(w, tradeResponse)
	}))
	defer srv.Close()
	c, e := NewClient(srv.URL, "1455735316373504", "fixture-key")
	if e != nil {
		t.Fatal(e)
	}
	c.http.Transport = srv.Client().Transport
	zero := 0
	p, e := c.ListTrades(context.Background(), TradeQuery{Status: &zero})
	if e != nil {
		t.Fatal(e)
	}
	if p.Rows[0].ID.String() != "9007199254740993" || p.Rows[0].Amount != "0.000000000000000001" {
		t.Fatal("precision lost")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if _, e = c.ListTrades(ctx, TradeQuery{}); !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal(e)
	}
}

func TestClientRejectsInvalidResponses(t *testing.T) {
	for _, body := range []string{
		`{"code":"B0001","msg":"SECRET"}`, `{"code":"00000","data":null}`,
		strings.Replace(tradeResponse, "1455735316373504", "999", 1),
		strings.Replace(tradeResponse, `"status":0,`, "", 1),
		strings.Replace(tradeResponse, `"pageNum":1`, `"pageNum":2`, 1),
		strings.Replace(tradeResponse, `"total":1`, `"total":0`, 1),
		strings.Replace(tradeResponse, `"0.000000000000000001"`, `0.1`, 1),
		strings.Repeat("x", (2<<20)+1),
	} {
		srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, body) }))
		c, _ := NewClient(srv.URL, "1455735316373504", "fixture-key")
		c.http.Transport = srv.Client().Transport
		_, e := c.ListTrades(context.Background(), TradeQuery{})
		srv.Close()
		if e == nil || strings.Contains(e.Error(), "SECRET") {
			t.Fatal("unsafe response handling", e)
		}
	}
}

func TestClientConfigAndRedirect(t *testing.T) {
	for _, u := range []string{"http://example.com", "https://user:secret@example.com", "https://example.com/path", "https://example.com?token=x"} {
		if _, e := NewClient(u, "123", "fixture"); e == nil {
			t.Fatal("invalid config accepted")
		}
	}
	if _, e := NewClient("https://example.com", "123", ""); e == nil {
		t.Fatal("empty key accepted")
	}
	called := false
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/trade/page" {
			called = true
		}
		http.Redirect(w, r, "/other", http.StatusTemporaryRedirect)
	}))
	defer srv.Close()
	c, _ := NewClient(srv.URL, "123", "fixture")
	c.http.Transport = srv.Client().Transport
	if _, e := c.ListTrades(context.Background(), TradeQuery{}); e != ErrUpstream || called {
		t.Fatal("redirect followed", e)
	}
	if _, e := c.ListTrades(context.Background(), TradeQuery{PageSize: 101}); e != ErrInvalid {
		t.Fatal(e)
	}
}
