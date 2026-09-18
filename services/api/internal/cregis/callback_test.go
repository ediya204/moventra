package cregis

import (
	"encoding/json"
	"testing"
)

func TestCallbackKindsAndValidation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		kind   CallbackKind
		status any
		mutate func(map[string]any)
		valid  bool
	}{
		{"deposit_success", Deposit, "1", nil, true},
		{"deposit_failure", Deposit, "2", nil, true},
		{"payout_success", Payout, json.Number("6"), nil, true},
		{"payout_signature_rejected", Payout, json.Number("2"), nil, true},
		{"payout_approval_rejected", Payout, json.Number("4"), nil, true},
		{"payout_failure", Payout, json.Number("7"), nil, true},
		{"deposit_number", Deposit, json.Number("1"), nil, false},
		{"payout_string", Payout, "6", nil, false},
		{"payout_nonterminal", Payout, json.Number("1"), nil, false},
		{"wrong_kind", "unknown", "1", nil, false},
		{"missing_tx", Deposit, "1", func(f map[string]any) { delete(f, "txid") }, false},
		{"missing_order", Payout, json.Number("6"), func(f map[string]any) { delete(f, "third_party_id") }, false},
		{"bad_amount", Deposit, "1", func(f map[string]any) { f["amount"] = "1e6" }, false},
		{"bad_nonce", Deposit, "1", func(f map[string]any) { f["nonce"] = "" }, false},
		{"zero_timestamp", Deposit, "1", func(f map[string]any) { f["timestamp"] = json.Number("0") }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := map[string]any{"pid": json.Number("123"), "cid": json.Number("9007199254740993"), "timestamp": json.Number("1687850657960"), "nonce": "abc123", "amount": "0.000001", "chain_id": "195", "token_id": "195", "currency": "TRX", "address": "fixture-address", "txid": "fixture-hash", "third_party_id": "fixture-order", "status": tc.status}
			if tc.mutate != nil {
				tc.mutate(f)
			}
			sig, e := WaaSSignature("fixture", f)
			if e != nil {
				t.Fatal(e)
			}
			f["sign"] = sig
			raw, _ := json.Marshal(f)
			obs, e := VerifyCallback("fixture", "123", tc.kind, raw)
			if (e == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, e)
			}
			if tc.valid && (obs.EventID != "9007199254740993" || obs.Kind != tc.kind) {
				t.Fatal(obs)
			}
		})
	}
}
