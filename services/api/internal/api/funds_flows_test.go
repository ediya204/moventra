package api

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/blnk"
	"moventra.local/api/internal/cregis"
	"moventra.local/api/internal/cryptofunds"
	"moventra.local/api/internal/ledger"
	"moventra.local/api/internal/tron"
	"testing"
	"time"
)

type fundsProviderFixture struct {
	Creates, Payouts int
	Unknown          bool
	Last             cregis.PayoutRequest
}

func (f *fundsProviderFixture) CreateAddress(_ context.Context, chain, alias, callback string) (string, error) {
	f.Creates++
	if f.Unknown {
		return "", errors.New("lost response")
	}
	if chain == "195" {
		return "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb", nil
	}
	return "0x1111111111111111111111111111111111111111", nil
}
func (f *fundsProviderFixture) Payout(_ context.Context, p cregis.PayoutRequest) (string, error) {
	f.Payouts++
	f.Last = p
	if f.Unknown {
		return "", errors.New("lost response")
	}
	return "123", nil
}
func (f *fundsProviderFixture) Coins(context.Context) (cregis.Coins, error) {
	coins := []cregis.Coin{{Name: "USDT", ChainID: "195", TokenID: "token-tron", Decimals: "6"}, {Name: "USDT", ChainID: "1", TokenID: "token-eth", Decimals: "6"}}
	return cregis.Coins{Address: coins, Payout: coins}, nil
}
func (f *fundsProviderFixture) ValidateAddress(context.Context, string, string) (bool, error) {
	return true, nil
}
func (f *fundsProviderFixture) QueryPayout(context.Context, string) (cregis.PayoutInfo, error) {
	status := 6
	hash := "fixture-payout"
	return cregis.PayoutInfo{ProjectID: json.Number("1"), ChainID: "195", TokenID: "token-tron", Address: f.Last.Address, Amount: f.Last.Amount, BusinessID: f.Last.BusinessID, Status: &status, TransactionID: &hash}, nil
}

type fundsProofFixture struct{}

func (fundsProofFixture) Verify(_ context.Context, hash, contract, address, amount string) (tron.Proof, error) {
	return tron.Proof{TransactionHash: hash, TransferIndex: "0", BlockNumber: "100", AmountMinor: amount, EvidenceRef: "synthetic:proof"}, nil
}
func testLiveFunding(t *testing.T, db *pgxpool.Pool, b *blnk.Client, customer string) {
	t.Helper()
	ctx := context.Background()
	ns := "live_test_" + uuid.NewString()[:8]
	l, e := ledger.NewLive(db, b, ns, "general_ledger_id")
	if e != nil {
		t.Fatal(e)
	}
	provider := &fundsProviderFixture{}
	s := &cryptofunds.Service{Ledger: l, Live: &cryptofunds.LiveRuntime{Writer: provider, Reader: provider, Connection: "fixture", Project: "1", CallbackURL: "https://callback.invalid", Networks: map[string]cryptofunds.NetworkConfig{"TRC20": {Network: "TRC20", ChainID: "195", TokenID: "token-tron", Contract: "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV", Deposit: true, Withdraw: true, Verifier: fundsProofFixture{}}, "ERC20": {Network: "ERC20", ChainID: "1", TokenID: "token-eth", Contract: "0x2222222222222222222222222222222222222222", Deposit: true, Withdraw: true, Verifier: fundsProofFixture{}}}}}
	var actor, staff string
	db.QueryRow(ctx, `SELECT id::text FROM users WHERE firebase_uid='alice'`).Scan(&actor)
	db.QueryRow(ctx, `SELECT id::text FROM users WHERE firebase_uid='staff'`).Scan(&staff)
	execute := func(admin bool, in cryptofunds.Input, key string) (json.RawMessage, error) {
		tx, e := db.Begin(ctx)
		if e != nil {
			return nil, e
		}
		defer tx.Rollback(ctx)
		a := actor
		if admin {
			a = staff
		}
		out, e := s.Execute(ctx, tx, customer, a, key, admin, in)
		if e == nil {
			e = tx.Commit(ctx)
		}
		return out, e
	}
	for _, network := range []string{"TRC20", "ERC20"} {
		for i := 0; i < 3; i++ {
			if _, e := execute(false, cryptofunds.Input{Action: "address", Network: network}, uuid.NewString()); e != nil {
				t.Fatal(e)
			}
		}
	}
	if e = s.CreateAddresses(ctx); e != nil {
		t.Fatal(e)
	}
	if e = s.CreateAddresses(ctx); e != nil || provider.Creates != 2 {
		t.Fatal("customer/network address reused", e, provider.Creates)
	}
	var address string
	if e = db.QueryRow(ctx, `SELECT address FROM crypto_addresses WHERE namespace=$1 AND network='TRC20'`, ns).Scan(&address); e != nil {
		t.Fatal(e)
	}
	// A stored authenticated provider observation and a verified transfer are both required.
	raw, _ := json.Marshal(map[string]any{"chain_id": "195", "token_id": "token-tron", "address": address, "amount": "10", "status": "1", "txid": "fixture-deposit"})
	for i := 0; i < 2; i++ {
		_, e = db.Exec(ctx, `INSERT INTO crypto_events(id,namespace,connection_id,project_id,kind,external_id,digest,payload) VALUES($1,$2,'fixture','1','deposit',$3,$3,$4)`, uuid.NewString(), ns, uuid.NewString(), raw)
		if e != nil {
			t.Fatal(e)
		}
	}
	if _, e = s.Drain(ctx); e != nil {
		t.Fatal(e)
	}
	var count int
	db.QueryRow(ctx, `SELECT count(*) FROM crypto_orders WHERE namespace=$1 AND kind='deposit'`, ns).Scan(&count)
	if count != 1 {
		t.Fatal("duplicate economic deposit", count)
	}
	snap, e := l.Snapshot(ctx, customer)
	if e != nil || snap.Totals["USDT"] != "10000000" {
		t.Fatal(snap, e)
	}
	fee := "100000"
	zero := "0"
	config := cryptofunds.Settings{OTCEnabled: true, WithdrawEnabled: true, USDTToUSD: "1", USDToUSDT: "1", NetworkFees: map[string]*string{"TRC20": &fee, "ERC20": &zero}, CardDepositFee: &zero, CardWithdrawFee: &zero}
	if _, e = execute(true, cryptofunds.Input{Action: "configure", Settings: &config, Note: "fixture"}, uuid.NewString()); e != nil {
		t.Fatal(e)
	}
	raw, e = execute(false, cryptofunds.Input{Action: "withdraw_quote", Currency: "USDT", Network: "TRC20", Address: address, Amount: "1000000"}, uuid.NewString())
	if e != nil {
		t.Fatal(e)
	}
	var q cryptofunds.Quote
	json.Unmarshal(raw, &q)
	if time.Until(q.Expires) > time.Minute || q.Fee != fee {
		t.Fatal(q)
	}
	if _, e = execute(false, cryptofunds.Input{Action: "withdraw_order", QuoteID: q.ID, Network: "ERC20", Address: address}, uuid.NewString()); e == nil {
		t.Fatal("network mismatch accepted")
	}
	raw, e = execute(false, cryptofunds.Input{Action: "withdraw_order", QuoteID: q.ID, Network: "TRC20", Address: address}, uuid.NewString())
	if e != nil {
		t.Fatal(e)
	}
	var o cryptofunds.Order
	json.Unmarshal(raw, &o)
	if e = s.Process(ctx, customer, o.ID); e != nil {
		t.Fatal(e)
	}
	var body []byte
	db.QueryRow(ctx, `SELECT data FROM crypto_orders WHERE id=$1`, o.ID).Scan(&body)
	json.Unmarshal(body, &o)
	if o.State != "pending_review" {
		t.Fatal(o)
	}
	if _, e = execute(true, cryptofunds.Input{Action: "approve", OrderID: o.ID, Revision: o.Revision, Note: "fixture"}, uuid.NewString()); e != nil {
		t.Fatal(e)
	}
	if e = s.Process(ctx, customer, o.ID); e != nil {
		t.Fatal(e)
	}
	if e = s.Process(ctx, customer, o.ID); e != nil || provider.Payouts != 1 {
		t.Fatal("duplicate payout", e, provider.Payouts)
	}
	snap, e = l.Snapshot(ctx, customer)
	if e != nil || snap.Totals["USDT"] != "8900000" {
		t.Fatal(snap, e)
	}
	// Lost payout responses never cause a second real submission.
	provider.Unknown = true
	raw, e = execute(false, cryptofunds.Input{Action: "withdraw_quote", Currency: "USDT", Network: "TRC20", Address: address, Amount: "1000000"}, uuid.NewString())
	if e != nil {
		t.Fatal(e)
	}
	json.Unmarshal(raw, &q)
	raw, e = execute(false, cryptofunds.Input{Action: "withdraw_order", QuoteID: q.ID, Network: "TRC20", Address: address}, uuid.NewString())
	if e != nil {
		t.Fatal(e)
	}
	json.Unmarshal(raw, &o)
	if e = s.Process(ctx, customer, o.ID); e != nil {
		t.Fatal(e)
	}
	db.QueryRow(ctx, `SELECT data FROM crypto_orders WHERE id=$1`, o.ID).Scan(&body)
	json.Unmarshal(body, &o)
	if _, e = execute(true, cryptofunds.Input{Action: "approve", OrderID: o.ID, Revision: o.Revision, Note: "fixture"}, uuid.NewString()); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 3; i++ {
		if e = s.Process(ctx, customer, o.ID); e != nil {
			t.Fatal(e)
		}
	}
	if provider.Payouts != 2 {
		t.Fatal("uncertain payout resent", provider.Payouts)
	}
	// Fixtures never credit or resolve a live namespace.
	if e = s.ResolveSimulation(ctx, customer, o.ID, "confirmed"); e == nil {
		t.Fatal("live fixture accepted")
	}
	// No legacy test opening credit leaked into either new asset.
	if snap.Totals["USD"] != "" && snap.Totals["USD"] != "0" {
		t.Fatal("nonzero USD opening")
	}
}

func testCardFunding(t *testing.T, db *pgxpool.Pool, b *blnk.Client, customer string) {
	t.Helper()
	ctx := context.Background()
	l, e := ledger.New(db, b, "shadow_cards_"+uuid.NewString()[:8], "general_ledger_id")
	if e != nil {
		t.Fatal(e)
	}
	s, e := cryptofunds.New(l)
	if e != nil {
		t.Fatal(e)
	}
	var actor string
	db.QueryRow(ctx, `SELECT id::text FROM users WHERE firebase_uid='alice'`).Scan(&actor)
	provision := func(key, kind, external string) ledger.Account {
		spec := ledger.AccountSpec{CustomerID: customer, Key: key, Kind: kind, Currency: "USD"}
		if kind == "card" {
			spec.ConnectionID = "fixture"
			spec.ExternalCardID = external
		}
		a, e := l.Provision(ctx, spec)
		if e != nil {
			t.Fatal(e)
		}
		return a
	}
	wallet := provision("wallet-USD", "wallet", "")
	clearing := provision("clearing-USD", "clearing", "")
	card := provision("card-a", "card", "a")
	other := provision("card-b", "card", "b")
	op, e := l.Submit(ctx, ledger.Command{CustomerID: customer, EffectKey: "synthetic-opening", Kind: "wallet_credit", SourceID: clearing.ID, DestinationID: wallet.ID, AmountMinor: "10000", EvidenceRef: "synthetic:card-test"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = l.Process(ctx, customer, op.ID); e != nil {
		t.Fatal(e)
	}
	id, otherID := uuid.NewString(), uuid.NewString()
	for _, v := range []struct {
		id  string
		a   ledger.Account
		ext string
	}{{id, card, "a"}, {otherID, other, "b"}} {
		_, e = db.Exec(ctx, `INSERT INTO funds_cards(id,namespace,customer_id,connection_id,external_card_id,name,last4,ledger_account_id,enabled,opening_verified,authorization_complete,observed_at) VALUES($1,$2,$3,'fixture',$4,'Test card','1234',$5,true,true,true,now())`, v.id, s.NS(), customer, v.ext, v.a.ID)
		if e != nil {
			t.Fatal(e)
		}
	}
	zero := "0"
	raw, _ := json.Marshal(cryptofunds.Settings{Revision: 1, CardDepositFee: &zero, CardWithdrawFee: &zero})
	if _, e = db.Exec(ctx, `INSERT INTO crypto_settings(namespace,data,revision) VALUES($1,$2,1)`, s.NS(), raw); e != nil {
		t.Fatal(e)
	}
	execute := func(in cryptofunds.Input, key string) (json.RawMessage, error) {
		tx, e := db.Begin(ctx)
		if e != nil {
			return nil, e
		}
		defer tx.Rollback(ctx)
		out, e := s.Execute(ctx, tx, customer, actor, key, false, in)
		if e == nil {
			e = tx.Commit(ctx)
		}
		return out, e
	}
	order := func(direction, amount string) (cryptofunds.Order, error) {
		var o cryptofunds.Order
		raw, e := execute(cryptofunds.Input{Action: "card_quote", Currency: "USD", CardID: id, Direction: direction, Amount: amount}, uuid.NewString())
		if e != nil {
			return o, e
		}
		var q cryptofunds.Quote
		json.Unmarshal(raw, &q)
		raw, e = execute(cryptofunds.Input{Action: "card_order", QuoteID: q.ID}, uuid.NewString())
		json.Unmarshal(raw, &o)
		return o, e
	}
	o, e := order("wallet_to_card", "3000")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = order("wallet_to_card", "1"); e == nil {
		t.Fatal("overlapping transfer accepted")
	}
	if e = s.Process(ctx, customer, o.ID); e != nil {
		t.Fatal(e)
	}
	if e = s.Process(ctx, customer, o.ID); e != nil {
		t.Fatal(e)
	}
	snap, e := l.Snapshot(ctx, customer)
	if e != nil {
		t.Fatal(e)
	}
	balances := map[string]string{}
	for _, a := range snap.Accounts {
		balances[a.ID] = a.AvailableMinor
	}
	if balances[card.ID] != "3000" || balances[wallet.ID] != "7000" || balances[other.ID] != "0" || snap.Totals["USD"] != "10000" {
		t.Fatal(balances, snap)
	}
	// Held authorizations cannot be withdrawn.
	if _, e = db.Exec(ctx, `UPDATE funds_cards SET held_minor=2500 WHERE id=$1`, id); e != nil {
		t.Fatal(e)
	}
	o, e = order("card_to_wallet", "1000")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Process(ctx, customer, o.ID); e != nil {
		t.Fatal(e)
	}
	var state string
	db.QueryRow(ctx, `SELECT state FROM crypto_orders WHERE id=$1`, o.ID).Scan(&state)
	if state != "rejected" {
		t.Fatal(state)
	}
	if _, e = db.Exec(ctx, `UPDATE funds_cards SET held_minor=0 WHERE id=$1`, id); e != nil {
		t.Fatal(e)
	}
	o, e = order("card_to_wallet", "1000")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Process(ctx, customer, o.ID); e != nil {
		t.Fatal(e)
	}
	// A posted purchase and refund use source economic identity, independent of delivery.
	fact := ledger.CardPosting{ConnectionID: "fixture", ExternalCardID: "a", TransactionID: "purchase", Status: "posted", DetailedStatus: "settled", SignedAmountMinor: "-500", Currency: "USD", EvidenceRef: "synthetic:purchase"}
	for i := 0; i < 2; i++ {
		if e = s.RecordCardFact(ctx, customer, id, fact); e != nil {
			t.Fatal(e)
		}
	}
	fact.TransactionID = "refund"
	fact.DetailedStatus = "refund"
	fact.SignedAmountMinor = "200"
	if e = s.RecordCardFact(ctx, customer, id, fact); e != nil {
		t.Fatal(e)
	}
	snap, e = l.Snapshot(ctx, customer)
	if e != nil || snap.Totals["USD"] != "9700" {
		t.Fatal(snap, e)
	}
	if _, e = db.Exec(ctx, `UPDATE funds_cards SET observed_at=now()-interval '1 minute' WHERE id=$1`, id); e != nil {
		t.Fatal(e)
	}
	if _, e = order("wallet_to_card", "1"); e == nil {
		t.Fatal("stale source accepted")
	}
}
