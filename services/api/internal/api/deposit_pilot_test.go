package api

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/cryptofunds"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/depositaddress"
	"moventra.local/api/internal/ledger"
	"moventra.local/api/internal/tron"
)

type pilotVerifier struct{}

func (pilotVerifier) Verify(_ context.Context, hash, contract, address, amount string) (tron.Proof, error) {
	if hash == strings.Repeat("f", 64) {
		return tron.Proof{}, errors.New("not_final")
	}
	return tron.Proof{TransactionHash: hash, TransferIndex: "0", BlockNumber: "999", AmountMinor: amount, EvidenceRef: "fixture:solidified:" + hash}, nil
}
func TestDepositPilotCapDedupAndRecovery(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	cfg, e := pgxpool.ParseConfig(raw)
	if e != nil || ledger.CheckLocalDatabase(cfg) != nil {
		t.Fatal("unsafe database")
	}
	base, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	schema := "pilot_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = base.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer base.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = database.Migrate(ctx, db); e != nil {
		t.Fatal(e)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(ctx, q, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec(seed)
	exec(`UPDATE customers SET onboarding_status='approved',service_status='active' WHERE id=$1`, personal)
	ns := "live_" + schema
	address := tron.FixtureAddress("pilot")
	project := "fixture"
	token := depositaddress.Token
	l, e := ledger.NewLive(db, cryptoBlnk(t, true), ns, "general_ledger_id")
	if e != nil {
		t.Fatal(e)
	}
	s := &cryptofunds.Service{Ledger: l, Pilot: &cryptofunds.DepositPilot{Customer: personal, Address: address, Cap: "1000000", Evidence: "synthetic:test-authorization"}, Live: &cryptofunds.LiveRuntime{Connection: "cregis-waas", Project: project, Networks: map[string]cryptofunds.NetworkConfig{"TRC20": {Network: "TRC20", ChainID: "195", TokenID: token, Contract: token, Deposit: true, Verifier: pilotVerifier{}}}}}
	exec(`INSERT INTO crypto_addresses(namespace,connection_id,project_id,network,customer_id,address,mode) VALUES($1,'cregis-waas',$2,'TRC20',$3,$4,'live')`, ns, project, personal, address)
	exec(`INSERT INTO funds_address_jobs(namespace,customer_id,network,id,state,address) VALUES($1,$2,'TRC20',$3,'completed',$4)`, ns, personal, uuid.NewString(), address)
	if e = s.RunDepositPilotOnce(ctx); e == nil {
		t.Fatal("unprepared pilot enabled")
	}
	if e = s.PrepareDepositPilot(ctx); e != nil {
		t.Fatal(e)
	}
	add := func(hash, amount, addr, chain, asset, status string) {
		t.Helper()
		id := uuid.NewString()
		b, _ := json.Marshal(map[string]string{"txid": hash, "amount": amount, "address": addr, "chain_id": chain, "token_id": asset, "status": status})
		exec(`INSERT INTO crypto_events(id,namespace,connection_id,project_id,kind,external_id,digest,payload) VALUES($1::uuid,$2,'cregis-waas',$3,'deposit',$1::text,$1::text,$4)`, id, ns, project, b)
	}
	// Same economic transfer, different channel ids and concurrent workers.
	for i := 0; i < 8; i++ {
		add(strings.Repeat("a", 64), "0.6", address, "195", token, "1")
	}
	add(strings.Repeat("b", 64), "0.6", address, "195", token, "1")
	add(strings.Repeat("f", 64), "0.1", address, "195", token, "1")
	add(strings.Repeat("c", 64), "0.1", address, "1", token, "1")
	add(strings.Repeat("d", 64), "0.1", address, "195", "wrong-token", "1")
	add(strings.Repeat("e", 64), "0.1", tron.FixtureAddress("other"), "195", token, "1")
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if e := s.RunDepositPilotOnce(ctx); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	var count int
	if e = db.QueryRow(ctx, `SELECT count(*) FROM crypto_orders`).Scan(&count); e != nil || count != 1 {
		t.Fatalf("orders=%d err=%v", count, e)
	}
	status, e := s.DepositPilotStatus(ctx, personal)
	if e != nil || status.Wallet != "600000" || status.Remaining != "400000" || !status.Enabled {
		t.Fatal(status, e)
	}
	add(strings.Repeat("9", 64), "0.4", address, "195", token, "1")
	if e = s.RunDepositPilotOnce(ctx); e != nil {
		t.Fatal(e)
	}
	if e = s.RunDepositPilotOnce(ctx); e != nil {
		t.Fatal(e)
	}
	status, e = s.DepositPilotStatus(ctx, personal)
	if e != nil || status.Wallet != "1000000" || status.Remaining != "0" || status.Enabled {
		t.Fatal(status, e)
	}
	if e = db.QueryRow(ctx, `SELECT count(*) FROM ledger_journal`).Scan(&count); e != nil || count != 2 {
		t.Fatalf("journal=%d err=%v", count, e)
	}
	other, e := s.DepositPilotStatus(ctx, uuid.NewString())
	if e != nil || other.Cap != "" || other.Wallet != "" {
		t.Fatal("cross customer status", other, e)
	}
	// A status replay after settlement must not reset/reseed the opening.
	if e = s.PrepareDepositPilot(ctx); e != nil {
		t.Fatal(e)
	}
	ds := &depositaddress.Service{DB: db, Namespace: ns, Project: project}
	events, e := ds.Events(ctx, personal, 0, "")
	if e != nil {
		t.Fatal(e)
	}
	found := false
	for _, v := range events {
		if v.TxHash == strings.Repeat("9", 64) {
			found = v.Posting == "posted"
		}
	}
	if !found {
		t.Fatal("posted deposit not visible", events)
	}
}
