package issuing

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"moventra.local/api/internal/blnk"
	"moventra.local/api/internal/ledger"
)

// An order selects its accounting authority once, in its persisted snapshot.
// Absence means the historical dedicated issuing ledger, never the new wallet.
func (s *Service) forSnapshot(v Snapshot) (*Service, error) {
	copy := *s
	if v.FundsNamespace == "" {
		copy.Funds = nil
		return &copy, nil
	}
	if s.Funds == nil || s.Funds.Namespace != v.FundsNamespace || !ValidID(v.FundsWalletID) {
		return nil, ErrBlocked
	}
	copy.ScopedWalletID = v.FundsWalletID
	return &copy, nil
}
func (s *Service) FundingSource() string {
	if s.Funds != nil {
		return "funds_wallet"
	}
	return "issuing_wallet"
}
func (s *Service) fundsWallet(ctx context.Context, tx pgx.Tx, customer string) (string, error) {
	snap, err := s.Funds.SnapshotTx(ctx, tx, customer)
	if err != nil {
		return "", err
	}
	if snap.Reconciliation == "mismatch" || snap.PendingOperations != 0 {
		return "", ErrUnknown
	}
	for _, a := range snap.Accounts {
		if a.Kind == "wallet" && a.Currency == "USD" {
			if a.Key != "wallet-USD" {
				return "", ErrConflict
			}
			return a.AvailableMinor, nil
		}
	}
	return "0", nil
}
func (s *Service) fundsAccount(ctx context.Context, tx pgx.Tx, customer, key string) (ledger.Account, error) {
	spec := ledger.AccountSpec{CustomerID: customer, Currency: "USD"}
	switch {
	case key == "wallet":
		spec.Key, spec.Kind = "wallet-USD", "wallet"
	case key == "fee_revenue":
		spec.Key, spec.Kind = "issuing-fee-USD", "fee"
	case key == "card_clearing":
		spec.Key, spec.Kind = "clearing-USD", "clearing"
	case strings.HasPrefix(key, "order_"):
		spec.Key, spec.Kind = "issuing-hold:"+strings.TrimPrefix(key, "order_"), "escrow"
	case strings.HasPrefix(key, "card_"):
		var ns string
		err := tx.QueryRow(ctx, `SELECT external_card_id,snapshot->>'connectionId',snapshot->>'fundsNamespace' FROM issuing_orders WHERE id=$1 AND customer_id=$2 AND parent_id IS NULL AND external_card_id<>''`, strings.TrimPrefix(key, "card_"), customer).Scan(&spec.ExternalCardID, &spec.ConnectionID, &ns)
		if err != nil {
			return ledger.Account{}, err
		}
		if ns != s.Funds.Namespace || spec.ConnectionID == "" {
			return ledger.Account{}, ErrConflict
		}
		spec.Key, spec.Kind = "funds-card:"+spec.ConnectionID+":"+spec.ExternalCardID, "card"
	default:
		return ledger.Account{}, ErrBlocked
	}
	account, err := s.Funds.Provision(ctx, spec)
	if err == nil && key == "wallet" && s.ScopedWalletID != "" && account.ID != s.ScopedWalletID {
		return ledger.Account{}, ErrConflict
	}
	return account, err
}
func (s *Service) fundsTransfer(ctx context.Context, tx pgx.Tx, customer, ref, source, dest, amount string) error {
	// The normal ledger owns every posting, including its durable journal and
	// unknown-result recovery. The issuing transaction may safely roll back.
	a, err := s.fundsAccount(ctx, tx, customer, source)
	if err != nil {
		return err
	}
	b, err := s.fundsAccount(ctx, tx, customer, dest)
	if err != nil {
		return err
	}
	if a.Kind == "card" && b.Kind == "wallet" {
		order := strings.SplitN(ref, ":", 2)[0]
		hold, err := s.fundsAccount(ctx, tx, customer, "order_"+order)
		if err != nil {
			return err
		}
		if err = s.fundsMove(ctx, customer, ref+":hold", a, hold, amount); err != nil {
			return err
		}
		return s.fundsMove(ctx, customer, ref, hold, b, amount)
	}
	return s.fundsMove(ctx, customer, ref, a, b, amount)
}
func (s *Service) fundsMove(ctx context.Context, customer, ref string, a, b ledger.Account, amount string) error {
	kind := "crypto_move"
	if a.Kind == "card" && b.Kind == "clearing" {
		kind = "card_settlement"
	}
	if a.Kind == "clearing" && b.Kind == "card" {
		kind = "card_refund"
	}
	op, err := s.Funds.Submit(ctx, ledger.Command{CustomerID: customer, EffectKey: "issuing:" + ref, Kind: kind, SourceID: a.ID, DestinationID: b.ID, AmountMinor: amount, EvidenceRef: "issuing-order:" + strings.SplitN(ref, ":", 2)[0]})
	if err != nil {
		return err
	}
	op, err = s.Funds.Process(ctx, customer, op.ID)
	if err != nil {
		return err
	}
	switch op.State {
	case "applied":
		return nil
	case "rejected":
		return blnk.ErrRejected
	case "review_required":
		return blnk.ErrConflict
	}
	return ErrUnknown
}
func (s *Service) reserveExists(ctx context.Context, tx pgx.Tx, customer, id string) (bool, error) {
	if s.Funds != nil {
		var exists bool
		// Even a pending operation may already have posted remotely. Recover it
		// before acting on a newly paused product or revoked eligibility.
		err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ledger_operations WHERE namespace=$1 AND customer_id=$2 AND effect_key=$3)`, s.Funds.Namespace, customer, "issuing:"+id+":reserve").Scan(&exists)
		return exists, err
	}
	_, err := s.Blnk.Lookup(ctx, "mvl_"+hash(id+":reserve"))
	if errors.Is(err, blnk.ErrNotFound) {
		return false, nil
	}
	return err == nil, err
}
