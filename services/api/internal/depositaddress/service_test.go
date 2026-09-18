package depositaddress

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/cregis"
	"moventra.local/api/internal/database"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

type fixture struct {
	creates atomic.Int32
	unknown bool
}

func (f *fixture) Coins(context.Context) (cregis.Coins, error) {
	return cregis.Coins{Address: []cregis.Coin{{ChainID: "195", TokenID: Token, Decimals: "6"}}}, nil
}
func (f *fixture) CreateAddress(context.Context, string, string, string) (string, error) {
	f.creates.Add(1)
	if f.unknown {
		return "", errors.New("timeout")
	}
	return "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb", nil
}
func (f *fixture) InternalAddress(context.Context, string, string) (bool, error) { return true, nil }
func (f *fixture) UpdateAddressCallback(context.Context, string, string) error   { return nil }
func setup(t *testing.T) (*Service, *fixture, string, string) {
	t.Helper()
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("isolated PostgreSQL required")
	}
	cfg, e := pgxpool.ParseConfig(raw)
	if e != nil {
		t.Fatal(e)
	}
	if cfg.ConnConfig.Host != "/tmp" || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("unsafe database")
	}
	ctx := context.Background()
	base, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	schema := "deposit_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = base.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close(); base.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); base.Close() })
	if e = database.Migrate(ctx, db); e != nil {
		t.Fatal(e)
	}
	if e = database.MigrateDepositAddresses(ctx, db); e != nil {
		t.Fatal(e)
	}
	actor, customer := uuid.NewString(), uuid.NewString()
	if _, e = db.Exec(ctx, `INSERT INTO users(id,firebase_uid,display_name,role) VALUES($1::uuid,$1::text,'fixture','customer')`, actor); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, `INSERT INTO customers(id,kind,name,personal_owner_id,onboarding_status,service_status) VALUES($1,'personal','fixture',$2,'approved','active')`, customer, actor); e != nil {
		t.Fatal(e)
	}
	f := &fixture{}
	return &Service{DB: db, Provider: f, Namespace: "live_test", Project: "1", Key: "fixture-key", Callback: "https://example.test/webhooks/cregis/address-deposit"}, f, customer, actor
}
func TestConcurrentAndUnknownAddress(t *testing.T) {
	s, f, c, a := setup(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := s.Request(ctx, c, a); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	if f.creates.Load() != 1 {
		t.Fatal("duplicate provider call")
	}
	v, e := s.Get(ctx, c)
	if e != nil || v.State != "completed" || v.Address == "" {
		t.Fatal(v, e)
	}
	if _, e = s.Request(ctx, c, uuid.NewString()); e == nil {
		t.Fatal("cross customer accepted")
	}
	s2, f2, c2, a2 := setup(t)
	f2.unknown = true
	if _, e = s2.Request(ctx, c2, a2); e == nil {
		t.Fatal("expected unknown")
	}
	for i := 0; i < 3; i++ {
		s2.Request(ctx, c2, a2)
	}
	if f2.creates.Load() != 1 {
		t.Fatal("unknown repeated")
	}
}
func TestImportCallbackIsolationAndNoLedger(t *testing.T) {
	s, _, c, _ := setup(t)
	ctx := context.Background()
	address := "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"
	for i := 0; i < 2; i++ {
		if e := s.Import(ctx, c, address, "reviewed fixture receipt"); e != nil {
			t.Fatal(e)
		}
	}
	if e := s.Import(ctx, c, "different", "fixture"); e == nil {
		t.Fatal("reassignment accepted")
	}
	fields := map[string]any{"pid": json.Number("1"), "cid": json.Number("123"), "timestamp": json.Number("1789728000000"), "nonce": "abc123", "chain_id": "195", "token_id": Token, "currency": "195@" + Token, "address": address, "amount": "1.234567", "status": "1", "txid": "fixture-hash"}
	sig, e := cregis.WaaSSignature(s.Key, fields)
	if e != nil {
		t.Fatal(e)
	}
	fields["sign"] = sig
	raw, _ := json.Marshal(fields)
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		s.CallbackHandler(w, httptest.NewRequest("POST", s.Callback, strings.NewReader(string(raw))))
		if w.Code != 200 || w.Body.String() != "success" {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	list, e := s.Events(ctx, c, 0, "")
	if e != nil || len(list) != 1 || list[0].Amount != "1.234567" {
		t.Fatal(list, e)
	}
	other, e := s.Events(ctx, uuid.NewString(), 0, list[0].ID)
	if e != nil || len(other) != 0 {
		t.Fatal("cross customer event leak", e)
	}
	var count, deliveries int
	if e = s.DB.QueryRow(ctx, `SELECT count(*) FROM ledger_journal`).Scan(&count); e != nil || count != 0 {
		t.Fatal("callback posted ledger", e)
	}
	s.DB.QueryRow(ctx, `SELECT deliveries FROM crypto_events`).Scan(&deliveries)
	if deliveries != 2 {
		t.Fatal(deliveries)
	}
	fields["amount"] = "9"
	raw, _ = json.Marshal(fields)
	w := httptest.NewRecorder()
	s.CallbackHandler(w, httptest.NewRequest("POST", s.Callback, strings.NewReader(string(raw))))
	if w.Code != 400 {
		t.Fatal("bad signature accepted")
	}
}
