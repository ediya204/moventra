package cregis

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOfficialWaaSSignature(t *testing.T) {
	fields, e := ParseFields([]byte(`{"pid":1382528827416576,"currency":"195@195","address":"TXsmKpEuW7qWnXzJLGP9eDLvWPR2GRn1FS","amount":"1.1","remark":"payout","third_party_id":"c9231e604da54469a735af3f449c880f","callback_url":"https://your-domain.com/callback","nonce":"hwlkk6","timestamp":1688004243314}`))
	if e != nil {
		t.Fatal(e)
	}
	const documentedKey = "f502a9ac9ca54327986f29c03b271491" // Published documentation fixture, not a credential.
	sig, e := WaaSSignature(documentedKey, fields)
	if e != nil || sig != "f76fb193e9d34d2e59fef64e3418f79b" {
		t.Fatal(sig, e)
	}
	fields["sign"] = sig
	raw, _ := json.Marshal(fields)
	if _, e = VerifyWaaS(documentedKey, "1382528827416576", raw); e != nil {
		t.Fatal(e)
	}
	for _, mutated := range [][]byte{[]byte(strings.Replace(string(raw), `"1.1"`, `"9.1"`, 1)), []byte(strings.Replace(string(raw), `"remark":`, `"remark":"hidden","remark":`, 1))} {
		if _, e = VerifyWaaS(documentedKey, "1382528827416576", mutated); e == nil {
			t.Fatal("accepted tamper/duplicate")
		}
	}
	if _, e = VerifyWaaS(documentedKey, "999", raw); e == nil {
		t.Fatal("cross-project callback accepted")
	}
}
func TestScalarParsingPreservesIDsAndZero(t *testing.T) {
	f, e := ParseFields([]byte(`{"pid":9007199254740993,"status":0,"amount":"0.000001","memo":""}`))
	if e != nil {
		t.Fatal(e)
	}
	if f["pid"].(json.Number).String() != "9007199254740993" {
		t.Fatal(f)
	}
	a, _ := WaaSSignature("fixture", f)
	delete(f, "status")
	b, _ := WaaSSignature("fixture", f)
	if a == b {
		t.Fatal("zero incorrectly omitted")
	}
	for _, raw := range []string{`{"pid":1,"pid":2}`, `{"payload":{}}`, `{"a":true}`, `{"a":[]} `, `{} {}`, `null`} {
		if _, e := ParseFields([]byte(raw)); e == nil {
			t.Fatal("accepted", raw)
		}
	}
	if _, e = WaaSSignature("fixture", map[string]any{"pid": float64(1)}); e == nil {
		t.Fatal("float allowed")
	}
}
func TestTeamSignsExactRequest(t *testing.T) {
	a := TeamSignature("secret", "/openapi/v1/wallets", "1700000000000", "1234567890123456", []byte(`{"page":1}`))
	// Independently calculated using Node crypto.createHmac.
	if a != "4d6282ff23342c43fcf384eb504f2f7ca689c415660206da2c86d2b74b73f8d3" {
		t.Fatal(a)
	}
	for _, b := range []string{TeamSignature("secret", "/different", "1700000000000", "1234567890123456", []byte(`{"page":1}`)), TeamSignature("secret", "/openapi/v1/wallets", "1700000000000", "1234567890123456", []byte(`{ "page":1}`))} {
		if a == b {
			t.Fatal("request bytes not bound")
		}
	}
}
