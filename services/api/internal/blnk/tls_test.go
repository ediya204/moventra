package blnk

import (
	"context"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPrivateCAAndReadOnlyBoundary(t *testing.T) {
	writes := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			writes++
			t.Error("preparation sent a write")
		}
		if r.Header.Get("X-blnk-key") != "fixture" {
			w.WriteHeader(401)
			return
		}
		if r.URL.Path == "/ledgers/general_ledger_id" {
			_, _ = w.Write([]byte(`{"ledger_id":"general_ledger_id"}`))
			return
		}
		w.WriteHeader(404)
	}))
	defer server.Close()
	ca := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}))
	client, err := NewWithCA(server.URL, "fixture", ca, true)
	if err != nil {
		t.Fatal(err)
	}
	if err = client.CheckLedger(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err = client.EnsureBalance(context.Background(), "general_ledger_id", "fixture", "USD", 100); err == nil {
		t.Fatal("write allowed")
	}
	if _, err = client.Apply(context.Background(), Transfer{Reference: "fixture", Source: "bln_source", Destination: "bln_dest", Currency: "USD", Amount: big.NewInt(1), Precision: 100}); err == nil {
		t.Fatal("transfer allowed")
	}
	if writes != 0 {
		t.Fatal("remote mutation")
	}
	untrusted, _ := NewWithCA(server.URL, "fixture", "", true)
	if untrusted.CheckLedger(context.Background()) == nil {
		t.Fatal("untrusted certificate accepted")
	}
	badKey, _ := NewWithCA(server.URL, "wrong", ca, true)
	if badKey.CheckLedger(context.Background()) == nil {
		t.Fatal("invalid key accepted")
	}
	if _, err = NewWithCA("http://127.0.0.1:5001", "fixture", ca, true); err == nil {
		t.Fatal("CA on plaintext accepted")
	}
	if _, err = NewWithCA(server.URL, "fixture", "garbage", true); err == nil {
		t.Fatal("invalid CA accepted")
	}
}
