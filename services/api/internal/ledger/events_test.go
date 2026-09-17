package ledger

import (
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"testing"
)

func TestEconomicIdentityAndMapping(t *testing.T) {
	p := CardPosting{ConnectionID: "connection-A", TransactionID: "tx-1", Status: "posted", DetailedStatus: "settled", SignedAmountMinor: "-10100", Currency: "USD", EvidenceRef: "delivery-A"}
	a, e := CardCommand("customer", "card", "clearing", p)
	if e != nil || a.AmountMinor != "10100" || a.Kind != "card_settlement" {
		t.Fatal(a, e)
	}
	p.EvidenceRef = "delivery-B"
	b, _ := CardCommand("customer", "card", "clearing", p)
	if a.EffectKey != b.EffectKey {
		t.Fatal("delivery changes economic identity")
	}
	p.ConnectionID = "connection-B"
	b, _ = CardCommand("customer", "card", "clearing", p)
	if a.EffectKey == b.EffectKey {
		t.Fatal("connections collide")
	}
	p.Status = "pending"
	if _, e = CardCommand("customer", "card", "clearing", p); !errors.Is(e, ErrNonPosting) {
		t.Fatal(e)
	}
	p.Status = "posted"
	p.DetailedStatus = "dispute"
	if _, e = CardCommand("customer", "card", "clearing", p); !errors.Is(e, ErrUnmapped) {
		t.Fatal(e)
	}
	p.DetailedStatus = "settled"
	p.SignedAmountMinor = "-1e3"
	if _, e = CardCommand("customer", "card", "clearing", p); e == nil {
		t.Fatal("non-integer accepted")
	}
	credit := CryptoCredit{Network: "tron-mainnet", AssetID: "USDT-contract", TransactionHash: "hash-1", TransferIndex: "0", AmountMinor: "9007199254740993", EvidenceRef: "cregis-id", FinalityVerified: true}
	a, e = CryptoCommand("customer", "wallet", "clearing", credit)
	if e != nil {
		t.Fatal(e)
	}
	credit.EvidenceRef = "chain-proof"
	b, e = CryptoCommand("customer", "wallet", "clearing", credit)
	if e != nil || a.EffectKey != b.EffectKey {
		t.Fatal("chain/provider double credit")
	}
	credit.TransferIndex = "1"
	b, _ = CryptoCommand("customer", "wallet", "clearing", credit)
	if a.EffectKey == b.EffectKey {
		t.Fatal("token transfers collapsed")
	}
	credit.FinalityVerified = false
	if _, e = CryptoCommand("customer", "wallet", "clearing", credit); !errors.Is(e, ErrNonPosting) {
		t.Fatal(e)
	}
}
func TestLocalConfigGuard(t *testing.T) {
	for _, u := range []string{"postgres://localhost/production", "postgres://remote/moventra_shadow_demo", "postgres://localhost/moventra_test_demo?host=remote", "postgres://localhost/moventra_shadow_demo?host=localhost,remote"} {
		c, e := pgxpool.ParseConfig(u)
		if e == nil && CheckLocalDatabase(c) == nil {
			t.Fatal("unsafe database", u)
		}
	}
	c, e := pgxpool.ParseConfig("postgres:///moventra_test_ok?host=/tmp")
	if e != nil || CheckLocalDatabase(c) != nil {
		t.Fatal(e)
	}
}
