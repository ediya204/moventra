package cryptofunds

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCardLimitReadbackPreservesRulesAndNeverBlindlyRepeats(t *testing.T) {
	limit := "1000"
	writes := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "fixture" || r.Header.Get("x-legal-entity") != "entity" {
			t.Error("missing scoped authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "PUT" {
			writes++
			var body struct {
				MCC  []string `json:"allowedMcc"`
				Rule struct {
					Limit struct {
						Amount struct {
							Cents json.Number `json:"amountCents"`
						} `json:"limitAmount"`
					} `json:"utilizationLimit"`
				} `json:"spendingRule"`
			}
			if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.MCC) != 1 || body.MCC[0] != "1234" {
				t.Error("unrelated rules changed")
			}
			limit = body.Rule.Limit.Amount.Cents.String()
			w.WriteHeader(503) // Accepted upstream, but the write response was lost.
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"id": "card", "accountId": "account", "status": "active", "spendingConstraint": map[string]any{"allowedMcc": []string{"1234"}, "spendingRule": map[string]any{"utilizationLimit": map[string]any{"preset": "collective", "limitAmount": map[string]any{"amountCents": json.Number(limit)}}}}})
	}))
	defer server.Close()
	s := &SlashCards{Key: "fixture", Entity: "entity", Account: "account", Connection: "connection", Base: server.URL, HTTP: server.Client()}
	c := FundsCard{Connection: "connection", ExternalID: "card"}
	for i := 0; i < 2; i++ {
		if e := s.SetLimit(context.Background(), c, "1000", "900"); e != nil {
			t.Fatal(e)
		}
	}
	if writes != 1 {
		t.Fatal("duplicate limit write", writes)
	}
	if e := s.SetLimit(context.Background(), c, "1000", "800"); e == nil {
		t.Fatal("concurrent limit change accepted")
	}
	if writes != 1 {
		t.Fatal("unexpected write after mismatched limit")
	}
}

func TestCardSourceUnknownAndChangingAuthorizationsFailClosed(t *testing.T) {
	for _, scenario := range []string{"stable", "changed", "unknown", "wrong_account"} {
		t.Run(scenario, func(t *testing.T) {
			scans := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/card/card" {
					w.Write([]byte(`{"id":"card","accountId":"account","status":"active","last4":"1234","name":"Fixture","spendingConstraint":{"spendingRule":{"utilizationLimit":{"preset":"collective","limitAmount":{"amountCents":1000}}}}}`))
					return
				}
				scans++
				status, account, amount := "pending", "account", -100
				if scenario == "changed" && scans > 1 {
					amount = -101
				}
				if scenario == "unknown" {
					status = "reversed"
				}
				if scenario == "wrong_account" {
					account = "another"
				}
				json.NewEncoder(w).Encode(map[string]any{"items": []any{map[string]any{"id": "hold", "cardId": "card", "accountId": account, "amountCents": amount, "status": status}}, "metadata": map[string]any{}})
			}))
			defer server.Close()
			s := &SlashCards{Account: "account", Connection: "connection", Base: server.URL, HTTP: server.Client()}
			state, e := s.ReadCard(context.Background(), FundsCard{Connection: "connection", ExternalID: "card"})
			if scenario == "stable" {
				if e != nil || state.Held != "100" {
					t.Fatal(state, e)
				}
			} else if e == nil {
				t.Fatal("unsafe source accepted", scenario)
			}
		})
	}
}
