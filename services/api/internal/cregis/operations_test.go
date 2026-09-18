package cregis

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCapabilitiesAndLocalOnlyWrites(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		f, e := VerifyWaaS("synthetic", "1", raw)
		if e != nil {
			t.Error(e)
		}
		var data any
		switch r.URL.Path {
		case "/api/v1/coins":
			data = map[string]any{"payout_coins": []Coin{{"USDT", "195", "fixture-contract", "6"}}, "address_coins": []Coin{{"USDT", "195", "fixture-contract", "6"}}}
		case "/api/v1/address/legal":
			data = map[string]bool{"result": false}
		case "/api/v1/address/create":
			data = map[string]string{"address": "fixture-address"}
		case "/api/v2/payout":
			if f["third_party_id"] != "stable-id" {
				t.Error("business key lost")
			}
			data = map[string]any{"cid": json.Number("9007199254740993")}
		case "/api/v1/payout/query":
			data = map[string]any{"pid": 1, "status": 0, "amount": "1.000001", "third_party_id": "stable-id"}
		default:
			t.Error(r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]any{"code": "00000", "data": data})
	}))
	defer srv.Close()
	c, _ := NewClient(srv.URL, "1", "synthetic")
	c.http.Transport = srv.Client().Transport
	w, e := NewLocalWriter(c)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = c.Coins(context.Background()); e != nil {
		t.Fatal(e)
	}
	c.next = time.Time{}
	if ok, e := c.ValidateAddress(context.Background(), "195", "bad"); e != nil || ok {
		t.Fatal(ok, e)
	}
	c.next = time.Time{}
	if _, e = w.CreateAddress(context.Background(), "195", "fixture", "https://callback.invalid"); e != nil {
		t.Fatal(e)
	}
	c.next = time.Time{}
	id, e := w.Payout(context.Background(), PayoutRequest{Currency: "195@fixture", Address: "fixture-address", Amount: "1.000001", BusinessID: "stable-id"})
	if e != nil || id != "9007199254740993" {
		t.Fatal(id, e)
	}
	c.next = time.Time{}
	p, e := c.QueryPayout(context.Background(), id)
	if e != nil || p.Status == nil || *p.Status != 0 {
		t.Fatal(p, e)
	}
	remote, _ := NewClient("https://tenant.example", "1", "synthetic")
	if _, e = NewLocalWriter(remote); e == nil {
		t.Fatal("real write client enabled")
	}
}
