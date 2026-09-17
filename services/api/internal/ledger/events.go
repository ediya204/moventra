package ledger

import (
	"context"
	"errors"
	"math/big"
	"regexp"
	"strings"
)

var ErrNonPosting = errors.New("event_has_no_confirmed_fund_movement")
var ErrUnmapped = errors.New("event_requires_mapping_review")

// Verified normalized adapter facts, never raw unsigned webhook payloads.
type CardPosting struct{ ExternalCardID, ConnectionID, TransactionID, Status, DetailedStatus, SignedAmountMinor, Currency, EvidenceRef string }

func CardCommand(customer, card, clearing string, p CardPosting) (Command, error) {
	c := Command{CustomerID: customer, EvidenceRef: p.EvidenceRef}
	if !validText(p.ConnectionID, 180) || !validText(p.TransactionID, 180) || p.Currency != "USD" {
		return c, ErrInvalid
	}
	if p.Status == "pending" || p.Status == "failed" {
		return c, ErrNonPosting
	}
	if p.Status != "posted" {
		return c, ErrUnmapped
	}
	a, ok := new(big.Int).SetString(p.SignedAmountMinor, 10)
	if !ok || a.String() != p.SignedAmountMinor || len(strings.TrimPrefix(p.SignedAmountMinor, "-")) > 38 {
		return c, ErrInvalid
	}
	if a.Sign() == 0 {
		return c, ErrNonPosting
	}
	switch {
	case p.DetailedStatus == "settled" && a.Sign() < 0:
		c.Kind = "card_settlement"
		c.SourceID = card
		c.DestinationID = clearing
	case p.DetailedStatus == "refund" && a.Sign() > 0:
		c.Kind = "card_refund"
		c.SourceID = clearing
		c.DestinationID = card
	default:
		return c, ErrUnmapped
	}
	c.AmountMinor = new(big.Int).Abs(a).String()
	c.EffectKey = "slash_posting_" + hash(p.ConnectionID, p.TransactionID)
	return c, nil
}

type CryptoCredit struct {
	Network, AssetID, TransactionHash, TransferIndex, AmountMinor, EvidenceRef string
	FinalityVerified                                                           bool
}

var indexPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,9})$`)

func CryptoCommand(customer, wallet, clearing string, p CryptoCredit) (Command, error) {
	c := Command{CustomerID: customer, Kind: "wallet_credit", SourceID: clearing, DestinationID: wallet, AmountMinor: p.AmountMinor, EvidenceRef: p.EvidenceRef}
	if !p.FinalityVerified {
		return c, ErrNonPosting
	}
	if !validText(p.Network, 80) || !validText(p.AssetID, 180) || !validText(p.TransactionHash, 180) || !indexPattern.MatchString(p.TransferIndex) || !amountPattern.MatchString(p.AmountMinor) {
		return c, ErrInvalid
	}
	// The adapter canonicalizes chain-specific identities without lowercasing
	// case-sensitive identifiers. Cregis and chain delivery IDs are only evidence.
	c.EffectKey = "crypto_credit_" + hash(p.Network, p.AssetID, p.TransactionHash, p.TransferIndex)
	return c, nil
}

// RegisterCryptoAsset configures a known contract on a specific network. The
// first version supports USDT at scale 6; conversion to USD is a separate flow.
func (s *Service) RegisterCryptoAsset(ctx context.Context, network, asset string) error {
	if !validText(network, 80) || !validText(asset, 180) {
		return ErrInvalid
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO ledger_crypto_assets(namespace,network,asset_id,currency,scale) VALUES($1,$2,$3,'USDT',6) ON CONFLICT DO NOTHING`, s.Namespace, network, asset)
	return err
}
func (s *Service) RecordCrypto(ctx context.Context, customer, wallet, clearing string, p CryptoCredit) (Operation, error) {
	c, err := CryptoCommand(customer, wallet, clearing, p)
	if err != nil {
		return Operation{}, err
	}
	var allowed bool
	err = s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ledger_crypto_assets t JOIN ledger_accounts a ON a.namespace=t.namespace AND a.currency=t.currency AND a.scale=t.scale WHERE t.namespace=$1 AND t.network=$2 AND t.asset_id=$3 AND a.customer_id=$4 AND a.id=$5 AND a.kind='wallet')`, s.Namespace, p.Network, p.AssetID, customer, wallet).Scan(&allowed)
	if err != nil {
		return Operation{}, err
	}
	if !allowed {
		return Operation{}, ErrUnmapped
	}
	return s.Submit(ctx, c)
}
func (s *Service) RecordCard(ctx context.Context, customer, card, clearing string, p CardPosting) (Operation, error) {
	c, err := CardCommand(customer, card, clearing, p)
	if err != nil {
		return Operation{}, err
	}
	var allowed bool
	err = s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ledger_accounts WHERE namespace=$1 AND customer_id=$2 AND id=$3 AND kind='card' AND connection_id=$4 AND external_card_id=$5)`, s.Namespace, customer, card, p.ConnectionID, p.ExternalCardID).Scan(&allowed)
	if err != nil {
		return Operation{}, err
	}
	if !allowed {
		return Operation{}, ErrNotFound
	}
	return s.Submit(ctx, c)
}
