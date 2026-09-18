package issuing

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestSlashBoundary(t *testing.T) {
	var posts atomic.Int32
	limit := "0"
	reject := false
	v := Snapshot{Product: Product{UpstreamID: "prod"}, Supplier: Supplier{Adapter: "slash", AccountRef: "acct", EntityRef: "entity"}, CardName: "James Anderson"}
	card := func() map[string]any {
		return map[string]any{"id": "card", "accountId": "acct", "cardProductId": "prod", "last4": "1234", "status": "active", "userData": map[string]string{"moventraOrderId": "order"}, "spendingConstraint": constraint(limit), "pan": "DO_NOT_PERSIST", "cvv": "DO_NOT_PERSIST"}
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "test" || r.Header.Get("x-legal-entity") != "entity" {
			t.Error("auth scope")
		}
		if strings.Contains(r.URL.RawQuery, "include_pan") {
			t.Error("sensitive request")
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "POST":
			posts.Add(1)
			var body struct {
				Name       string          `json:"name"`
				Holder     *string         `json:"cardholderId"`
				Product    string          `json:"cardProductId"`
				Account    string          `json:"accountId"`
				Constraint slashConstraint `json:"spendingConstraint"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			if body.Name != v.CardName || body.Holder != nil {
				t.Error("display name or default holder mismatch")
			}
			if body.Product != "prod" || body.Account != "acct" || body.Constraint.SpendingRule.UtilizationLimit.LimitAmount.Amount.String() != "0" {
				t.Error("unrestricted creation")
			}
			w.WriteHeader(201)
			json.NewEncoder(w).Encode(card())
		case r.Method == "PUT":
			if reject {
				w.WriteHeader(422)
				return
			}
			var input slashConstraint
			json.NewDecoder(r.Body).Decode(&input)
			limit = input.SpendingRule.UtilizationLimit.LimitAmount.Amount.String()
			json.NewEncoder(w).Encode(constraint(limit))
		case r.URL.Path == "/card":
			json.NewEncoder(w).Encode(map[string]any{"items": []any{card()}, "metadata": map[string]string{"nextCursor": ""}})
		default:
			json.NewEncoder(w).Encode(card())
		}
	}))
	defer srv.Close()
	s := NewSlash("test", "entity", "acct")
	s.base = srv.URL
	s.http = srv.Client()
	ctx := context.Background()
	c, e := s.Create(ctx, "order", v)
	if e != nil || !c.Restricted {
		t.Fatal(c, e)
	}
	found, e := s.Find(ctx, "order", v)
	if e != nil || found.ID != c.ID || posts.Load() != 1 {
		t.Fatal("recovery created a card", e)
	}
	if e = s.Enable(ctx, c, v, "1000"); e != nil {
		t.Fatal(e)
	}
	if e = s.Enable(ctx, c, v, "1000"); e != nil {
		t.Fatal(e)
	}
	limit = "0"
	reject = true
	if e = s.Enable(ctx, c, v, "1000"); e != ErrRejected {
		t.Fatal(e)
	}
	v.Supplier.AccountRef = "other"
	if _, e = s.Create(ctx, "order", v); e != ErrRejected || posts.Load() != 1 {
		t.Fatal("cross account write")
	}
}
func TestMoneyAndPaths(t *testing.T) {
	for _, v := range []string{"-1", "1.2", "1e3", "01", "", "9007199254740993000"} {
		if Money(v, false) {
			t.Fatal(v)
		}
	}
	for _, v := range []string{"0", "9007199254740993"} {
		if !Money(v, false) {
			t.Fatal(v)
		}
	}
	if add("9007199254740993", "7") != "9007199254741000" {
		t.Fatal("precision")
	}
}
