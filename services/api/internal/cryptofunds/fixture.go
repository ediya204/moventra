package cryptofunds

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"moventra.local/api/internal/cregis"
	"moventra.local/api/internal/tron"
)

// DepositFixture is an explicitly synthetic trusted CLI/test entry, not a
// public HTTP action. Its receipt is validated by the same TRC20 parser; it is
// never represented as live network evidence or used outside the shadow DB.
func (s *Service) DepositFixture(ctx context.Context, customer, contract, recipient, amount string, receipt tron.Receipt) (Order, error) {
	var empty Order
	if s.Ledger.IsLive() {
		return empty, invalid("fixture_forbidden")
	}
	if contract != "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV" {
		return empty, invalid("unsupported_fixture_contract")
	}
	if _, e := number(amount, false); e != nil {
		return empty, e
	}
	proof, e := tron.Match(receipt, receipt.ID, contract, recipient, amount)
	if e != nil {
		return empty, e
	}
	proof.EvidenceRef = "synthetic:solidified:" + proof.TransactionHash
	tx, e := s.Ledger.DB.Begin(ctx)
	if e != nil {
		return empty, e
	}
	defer tx.Rollback(ctx)
	if e = s.Lock(ctx, tx, customer); e != nil {
		return empty, e
	}
	var address, expected string
	e = tx.QueryRow(ctx, `SELECT address,chain_address FROM crypto_addresses WHERE namespace=$1 AND customer_id=$2 AND mode='synthetic'`, s.NS(), customer).Scan(&address, &expected)
	if e != nil {
		return empty, e
	}
	if recipient != expected {
		return empty, conflict("deposit_address_mismatch")
	}
	economic := digest([]string{"tron-fixture", contract, proof.TransactionHash, proof.TransferIndex})
	// Global economic identity lock prevents a fixture transfer crediting two users.
	_, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, s.NS()+":deposit:"+economic)
	if e != nil {
		return empty, e
	}
	var id, owner string
	e = tx.QueryRow(ctx, `SELECT p.order_id::text,o.customer_id::text FROM crypto_postings p JOIN crypto_orders o ON o.id=p.order_id WHERE p.namespace=$1 AND p.economic_key=$2`, s.NS(), economic).Scan(&id, &owner)
	if e == nil {
		if owner != customer {
			return empty, conflict("deposit_owner_conflict")
		}
		o, err := s.Get(ctx, tx, customer, id)
		if err != nil {
			return empty, err
		}
		if o.Amount != amount || o.Contract != contract {
			return empty, conflict("deposit_evidence_conflict")
		}
		return o, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return empty, e
	}
	o := Order{CustomerID: customer, Kind: "deposit", State: "processing", Currency: "USDT", ToCurrency: "USDT", Amount: amount, Receive: amount, Fee: "0", Address: address, Approval: "not_required", Provider: "simulated_success", Chain: "simulated_verified", Posting: "pending", TransactionHash: proof.TransactionHash, Evidence: proof.EvidenceRef, Proof: &proof, Contract: contract}
	if e = s.Insert(ctx, tx, &o); e != nil {
		return empty, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO crypto_postings(namespace,economic_key,order_id) VALUES($1,$2,$3)`, s.NS(), economic, o.ID)
	if e != nil {
		return empty, e
	}
	return o, tx.Commit(ctx)
}

// ReceiveFixture authenticates a synthetic Cregis deposit envelope before the
// shared receipt parser and address mapping. The public fixture key has no
// relation to the live project; this function is used only by local CLI/tests.
func (s *Service) ReceiveFixture(ctx context.Context, raw []byte, receipt tron.Receipt) (Order, error) {
	observation, e := cregis.VerifyCallback("moventra-synthetic-cregis", "1", cregis.Deposit, raw)
	if e != nil {
		return Order{}, e
	}
	f := observation.Fields
	str := func(k string) string { v, _ := f[k].(string); return v }
	if observation.Status != "1" || str("chain_id") != "195" || str("txid") != receipt.ID {
		return Order{}, invalid("non_posting_fixture")
	}
	amount, e := DecimalMinor(str("amount"), 6)
	if e != nil {
		return Order{}, e
	}
	var customer string
	e = s.Ledger.DB.QueryRow(ctx, `SELECT customer_id::text FROM crypto_addresses WHERE namespace=$1 AND mode='synthetic' AND chain_address=$2`, s.NS(), str("address")).Scan(&customer)
	if e != nil {
		return Order{}, e
	}
	o, e := s.DepositFixture(ctx, customer, str("token_id"), str("address"), amount, receipt)
	if e != nil {
		return o, e
	}
	// Journal identity remains the on-chain transfer, never cid or delivery id.
	tx, e := s.Ledger.DB.Begin(ctx)
	if e != nil {
		return o, e
	}
	defer tx.Rollback(ctx)
	delete(f, "sign")
	delete(f, "nonce")
	delete(f, "timestamp")
	source := Source{Service: s, Connection: "synthetic", Project: "1"}
	if e = source.store(ctx, tx, "deposit", observation.EventID, f); e != nil {
		return o, e
	}
	_, e = tx.Exec(ctx, `UPDATE crypto_events SET order_id=$1,state='synthetic_verified' WHERE namespace=$2 AND connection_id='synthetic' AND project_id='1' AND kind='deposit' AND external_id=$3`, o.ID, s.NS(), observation.EventID)
	if e != nil {
		return o, e
	}
	return o, tx.Commit(ctx)
}
