package blnk

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestApplyRecoveryPrecisionAndConflict(t *testing.T) {
	n, _ := new(big.Int).SetString("9007199254740993123456789", 10)
	r := Transfer{Reference: "ref_exact", Source: "bln_source", Destination: "bln_dest", Currency: "USDT", Amount: n, Precision: 1000000}
	var saved *Transaction
	posts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) {
		if q.Header.Get("X-blnk-key") != "local-test" {
			t.Error("missing key")
		}
		if q.Method == "GET" {
			if saved == nil {
				w.WriteHeader(404)
				return
			}
			json.NewEncoder(w).Encode(saved)
			return
		}
		posts++
		var got Transfer
		if err := json.NewDecoder(q.Body).Decode(&got); err != nil {
			t.Error(err)
		}
		if got.Amount.Cmp(n) != 0 || !got.SkipQueue || got.AllowOverdraft {
			t.Error("unsafe amount/flags", got)
		}
		saved = &Transaction{ID: "txn_1", Reference: got.Reference, Source: got.Source, Destination: got.Destination, Currency: got.Currency, Amount: got.Amount, Precision: got.Precision, Status: "APPLIED"}
		// Emulate an applied transaction whose response was lost at the proxy.
		w.WriteHeader(502)
	}))
	defer srv.Close()
	c, _ := New(srv.URL, "local-test")
	for i := 0; i < 2; i++ {
		if _, e := c.Apply(context.Background(), r); e != nil {
			t.Fatal(e)
		}
	}
	if posts != 1 {
		t.Fatal("duplicate posting", posts)
	}
	r.Amount = big.NewInt(1)
	if _, e := c.Apply(context.Background(), r); !errors.Is(e, ErrConflict) {
		t.Fatal("reference payload was not checked", e)
	}
}
func TestQueuedRejectedAndRedaction(t *testing.T) {
	for _, status := range []string{"QUEUED", "INFLIGHT", "REJECTED", "APPLIED"} {
		t.Run(status, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				json.NewEncoder(w).Encode(Transaction{ID: "txn_1", Reference: "ref", Source: "a", Destination: "b", Currency: "USD", Amount: big.NewInt(100), Precision: 100, Status: status})
			}))
			defer srv.Close()
			c, _ := New(srv.URL, "private-key")
			_, err := c.Apply(context.Background(), Transfer{Reference: "ref", Source: "a", Destination: "b", Currency: "USD", Amount: big.NewInt(100), Precision: 100})
			if status == "APPLIED" && err != nil {
				t.Fatal(err)
			}
			if status != "APPLIED" && err == nil {
				t.Fatal("accepted non-applied status")
			}
		})
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte("private-key and sensitive details"))
	}))
	defer srv.Close()
	c, _ := New(srv.URL, "private-key")
	_, err := c.Balance(context.Background(), "bln_a")
	if err == nil || strings.Contains(err.Error(), "private-key") {
		t.Fatal(err)
	}
}
func TestNoRedirectAndConfig(t *testing.T) {
	called := false
	dst := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	defer dst.Close()
	src := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, dst.URL, 307) }))
	defer src.Close()
	c, _ := New(src.URL, "key")
	_, _ = c.Balance(context.Background(), "bln_a")
	if called {
		t.Fatal("followed credential redirect")
	}
	for _, u := range []string{"http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?token=secret"} {
		if _, e := New(u, "key"); e == nil {
			t.Fatal("unsafe config", u)
		}
	}
}

func TestReferencePrecisionFallsBackToFullTransaction(t *testing.T) {
	fullRead := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		transaction := Transaction{ID: "txn_precision", Reference: "reference", Source: "a", Destination: "b", Currency: "USD", Amount: big.NewInt(123), Status: "APPLIED"}
		if r.URL.Path == "/transactions/txn_precision" {
			transaction.Precision = 100
			fullRead = true
		}
		if r.Method != "GET" {
			t.Error("reposted existing transaction")
		}
		json.NewEncoder(w).Encode(transaction)
	}))
	defer server.Close()
	c, _ := New(server.URL, "test-key")
	_, err := c.Apply(context.Background(), Transfer{Reference: "reference", Source: "a", Destination: "b", Currency: "USD", Amount: big.NewInt(123), Precision: 100})
	if err != nil || !fullRead {
		t.Fatal("did not verify full precision", err)
	}
}
