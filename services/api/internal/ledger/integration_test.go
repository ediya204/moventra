package ledger

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/blnk"
	"moventra.local/api/internal/database"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestBlnkPostgresLifecycle(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	endpoint := os.Getenv("BLNK_TEST_URL")
	if raw == "" || endpoint == "" {
		t.Skip("requires isolated TEST_DATABASE_URL and local BLNK_TEST_URL")
	}
	cfg, err := pgxpool.ParseConfig(raw)
	if err != nil || CheckLocalDatabase(cfg) != nil {
		t.Fatal("refusing unsafe test database")
	}
	ctx := context.Background()
	base, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")
	schema := "ledger_test_" + suffix
	if _, err = base.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	defer base.Exec(ctx, `DROP SCHEMA `+schema+` CASCADE`)
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = database.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err = database.Migrate(ctx, db); err != nil {
		t.Fatal("migration replay", err)
	}
	customer, other := uuid.NewString(), uuid.NewString()
	for _, id := range []string{customer, other} {
		_, err = db.Exec(ctx, `INSERT INTO customers(id,kind,name) VALUES($1,'business','Synthetic ledger test')`, id)
		if err != nil {
			t.Fatal(err)
		}
	}
	client, err := blnk.New(endpoint, os.Getenv("BLNK_TEST_KEY"))
	if err != nil {
		t.Fatal(err)
	}
	book := "general_ledger_id"
	svc, err := New(db, client, "shadow_test_"+suffix, book)
	if err != nil {
		t.Fatal(err)
	}
	provision := func(t *testing.T, key, kind, currency, card string) Account {
		t.Helper()
		spec := AccountSpec{CustomerID: customer, Key: key, Kind: kind, Currency: currency}
		if card != "" {
			spec.ConnectionID = "isolated-slash"
			spec.ExternalCardID = card
		}
		a, e := svc.Provision(ctx, spec)
		if e != nil {
			t.Fatal(key, e)
		}
		again, e := svc.Provision(ctx, spec)
		if e != nil || again.ID != a.ID || again.BalanceID != a.BalanceID {
			t.Fatal("provision replay", again, e)
		}
		return a
	}
	wallet := provision(t, "wallet-usd", "wallet", "USD", "")
	clearing := provision(t, "clearing-usd", "clearing", "USD", "")
	cardA := provision(t, "card-a", "card", "USD", "a")
	holdA := provision(t, "transit-a", "transit", "USD", "a")
	cardB := provision(t, "card-b", "card", "USD", "b")
	holdB := provision(t, "transit-b", "transit", "USD", "b")
	submit := func(t *testing.T, kind, key, amount string, src, dst Account, transit string) Operation {
		t.Helper()
		o, e := svc.Submit(ctx, Command{CustomerID: customer, EffectKey: key, Kind: kind, SourceID: src.ID, DestinationID: dst.ID, TransitID: transit, AmountMinor: amount, EvidenceRef: "synthetic/" + key})
		if e != nil {
			t.Fatal(key, e)
		}
		return o
	}
	process := func(t *testing.T, o Operation, want string) Operation {
		t.Helper()
		got, e := svc.Process(ctx, customer, o.ID)
		if e != nil || got.State != want {
			t.Fatal("process", o.EffectKey, got.State, e)
		}
		return got
	}
	resolve := func(t *testing.T, o Operation, outcome string) Operation {
		t.Helper()
		got, e := svc.Resolve(ctx, customer, o.ID, outcome, "synthetic/provider/"+outcome)
		if e != nil {
			t.Fatal(e)
		}
		return got
	}
	snapshot := func(t *testing.T, total string) Snapshot {
		t.Helper()
		v, e := svc.Snapshot(ctx, customer)
		if e != nil || v.Totals["USD"] != total || v.Reconciliation != "matched" {
			t.Fatalf("snapshot %+v error %v", v, e)
		}
		return v
	}
	t.Run("fund multi-card transfer unknown success and rejection", func(t *testing.T) {
		process(t, submit(t, "wallet_credit", "opening", "10000", clearing, wallet, ""), "applied")
		a := process(t, submit(t, "wallet_to_card", "transfer-a", "3000", wallet, cardA, holdA.ID), "awaiting_provider")
		b := process(t, submit(t, "wallet_to_card", "transfer-b", "2000", wallet, cardB, holdB.ID), "awaiting_provider")
		resolve(t, a, "unknown")
		s := snapshot(t, "10000")
		for _, v := range s.Accounts {
			if v.ID == holdA.ID && (v.HeldMinor != "3000" || v.AvailableMinor != "0") {
				t.Fatal("unknown released funds", v)
			}
		}
		process(t, resolve(t, a, "confirmed"), "applied")
		process(t, resolve(t, b, "rejected"), "released")
		snapshot(t, "10000")
		if _, e := svc.Resolve(ctx, customer, a.ID, "rejected", "contradiction"); !errors.Is(e, ErrConflict) {
			t.Fatal("terminal decision reversed", e)
		}
		if _, e := svc.Submit(ctx, Command{CustomerID: customer, EffectKey: "wrong-transit", Kind: "wallet_to_card", SourceID: wallet.ID, DestinationID: cardA.ID, TransitID: holdB.ID, AmountMinor: "1", EvidenceRef: "test"}); e == nil {
			t.Fatal("cross-card transit accepted")
		}
	})
	t.Run("posting refund replay and mismatched economics", func(t *testing.T) {
		posting := CardPosting{ExternalCardID: "a", ConnectionID: "isolated-slash", TransactionID: "purchase-a", Status: "posted", DetailedStatus: "settled", SignedAmountMinor: "-1010", Currency: "USD", EvidenceRef: "synthetic/callback-1"}
		c, e := CardCommand(customer, cardA.ID, clearing.ID, posting)
		if e != nil {
			t.Fatal(e)
		}
		o, e := svc.RecordCard(ctx, customer, cardA.ID, clearing.ID, posting)
		if e != nil {
			t.Fatal(e)
		}
		var wg sync.WaitGroup
		for i := 0; i < 6; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, e := svc.Process(ctx, customer, o.ID); e != nil {
					t.Error(e)
				}
			}()
		}
		wg.Wait()
		c.EvidenceRef = "synthetic/callback-2"
		same, e := svc.Submit(ctx, c)
		if e != nil || same.ID != o.ID {
			t.Fatal("duplicate effect", e)
		}
		wrong := posting
		wrong.ExternalCardID = "b"
		if _, e := svc.RecordCard(ctx, customer, cardA.ID, clearing.ID, wrong); !errors.Is(e, ErrNotFound) {
			t.Fatal("wrong card posting accepted", e)
		}
		c.AmountMinor = "1011"
		if _, e = svc.Submit(ctx, c); !errors.Is(e, ErrConflict) {
			t.Fatal("changed amount accepted", e)
		}
		process(t, submit(t, "card_refund", "refund-a", "250", clearing, cardA, ""), "applied")
		snapshot(t, "9240")
		if _, e := db.Exec(ctx, `UPDATE ledger_journal SET amount_minor=1`); e == nil {
			t.Fatal("journal rewritten")
		}
	})
	t.Run("recover Blnk success after local journal rollback", func(t *testing.T) {
		o := submit(t, "wallet_to_card", "crash-transfer", "1000", wallet, cardB, holdB.ID)
		_, e := db.Exec(ctx, `CREATE FUNCTION reject_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$; CREATE TRIGGER reject_journal BEFORE INSERT ON ledger_journal FOR EACH ROW EXECUTE FUNCTION reject_journal()`)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = svc.Process(ctx, customer, o.ID); e == nil {
			t.Fatal("fault did not roll back")
		}
		v, e := svc.Snapshot(ctx, customer)
		if e != nil || v.Reconciliation != "mismatch" {
			t.Fatal("unresolved remote commit hidden", v, e)
		}
		if _, e = db.Exec(ctx, `DROP TRIGGER reject_journal ON ledger_journal`); e != nil {
			t.Fatal(e)
		}
		recovered, _ := New(db, client, svc.Namespace, book)
		if _, e = recovered.Process(ctx, customer, o.ID); e != nil {
			t.Fatal("restart recovery", e)
		}
		process(t, resolve(t, o, "confirmed"), "applied")
		snapshot(t, "9240")
	})
	t.Run("concurrent insufficient funds cannot overdraw wallet", func(t *testing.T) {
		a := submit(t, "wallet_to_card", "race-a", "4000", wallet, cardA, holdA.ID)
		b := submit(t, "wallet_to_card", "race-b", "4000", wallet, cardB, holdB.ID)
		var wg sync.WaitGroup
		for _, o := range []Operation{a, b} {
			wg.Add(1)
			go func(o Operation) { defer wg.Done(); _, _ = svc.Process(ctx, customer, o.ID) }(o)
		}
		wg.Wait()
		var held, rejected int
		if e := db.QueryRow(ctx, `SELECT count(*) FILTER(WHERE state='awaiting_provider'),count(*) FILTER(WHERE state='rejected') FROM ledger_operations WHERE id IN ($1,$2)`, a.ID, b.ID).Scan(&held, &rejected); e != nil || held != 1 || rejected != 1 {
			t.Fatal("race outcomes", held, rejected, e)
		}
		s := snapshot(t, "9240")
		for _, v := range s.Accounts {
			if v.ID == wallet.ID && v.AvailableMinor != "2000" {
				t.Fatal("wallet overdrawn", v)
			}
		}
	})
	t.Run("cross-customer mapping and reads", func(t *testing.T) {
		c := Command{CustomerID: other, EffectKey: "cross", Kind: "wallet_credit", SourceID: clearing.ID, DestinationID: wallet.ID, AmountMinor: "1", EvidenceRef: "test"}
		if _, e := svc.Submit(ctx, c); !errors.Is(e, ErrNotFound) {
			t.Fatal(e)
		}
		if _, e := svc.Provision(ctx, AccountSpec{CustomerID: other, Key: "steal-card", Kind: "card", Currency: "USD", ConnectionID: "isolated-slash", ExternalCardID: "a"}); e == nil {
			t.Fatal("card rebound")
		}
		v, e := svc.Snapshot(ctx, other)
		if e != nil || len(v.Accounts) != 0 || v.Reconciliation != "insufficient_data" {
			t.Fatal(v, e)
		}
	})
	t.Run("crypto precision chain Cregis deduplication", func(t *testing.T) {
		w := provision(t, "wallet-usdt", "wallet", "USDT", "")
		c := provision(t, "clearing-usdt", "clearing", "USDT", "")
		p := CryptoCredit{Network: "tron-mainnet", AssetID: "usdt-test-contract", TransactionHash: "test-hash", TransferIndex: "0", AmountMinor: "9007199254740993", EvidenceRef: "synthetic/cregis", FinalityVerified: true}
		if _, e := svc.RecordCrypto(ctx, customer, w.ID, c.ID, p); !errors.Is(e, ErrUnmapped) {
			t.Fatal("unregistered token accepted", e)
		}
		if e := svc.RegisterCryptoAsset(ctx, p.Network, p.AssetID); e != nil {
			t.Fatal(e)
		}
		if _, e := svc.RecordCrypto(ctx, customer, wallet.ID, clearing.ID, p); !errors.Is(e, ErrUnmapped) {
			t.Fatal("USDT credited as USD", e)
		}
		o, e := svc.RecordCrypto(ctx, customer, w.ID, c.ID, p)
		if e != nil {
			t.Fatal(e)
		}
		process(t, o, "applied")
		p.EvidenceRef = "synthetic/chain"
		same, e := svc.RecordCrypto(ctx, customer, w.ID, c.ID, p)
		if e != nil || same.ID != o.ID {
			t.Fatal("double credit", e)
		}
		process(t, same, "applied")
		s := snapshot(t, "9240")
		if s.Totals["USDT"] != "9007199254740993" {
			t.Fatal("precision lost", s)
		}
	})
}
