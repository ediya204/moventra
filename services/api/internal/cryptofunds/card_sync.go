package cryptofunds

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"math/big"
	"moventra.local/api/internal/ledger"
	"net/url"
	"regexp"
	"time"
)

type CardSourceState struct {
	Limit, Held, Last4, Name, Evidence string
	Facts                              []ledger.CardPosting
}
type CardSource interface {
	ReadCard(context.Context, FundsCard) (CardSourceState, error)
}

// ReadCard fails closed on truncated, changing, unknown or unsupported source
// states. The operator's certification must establish authorization coverage.
func (s *SlashCards) ReadCard(ctx context.Context, c FundsCard) (CardSourceState, error) {
	var out CardSourceState
	if c.Connection != s.Connection || !safeRef.MatchString(c.ExternalID) {
		return out, conflict("card_scope_mismatch")
	}
	var card struct {
		ID, AccountID, Status, Last4, Name string
		SpendingConstraint                 struct {
			SpendingRule struct {
				UtilizationLimit struct {
					Preset      string
					LimitAmount struct {
						Amount json.Number `json:"amountCents"`
					}
				}
				UtilizationLimitV2 json.RawMessage
			}
		}
	}
	if e := s.call(ctx, "GET", "/card/"+c.ExternalID, nil, &card); e != nil {
		return out, e
	}
	rule := card.SpendingConstraint.SpendingRule
	if card.ID != c.ExternalID || card.AccountID != s.Account || card.Status != "active" || rule.UtilizationLimit.Preset != "collective" || len(rule.UtilizationLimitV2) > 0 {
		return out, conflict("card_source_not_ready")
	}
	out.Limit = rule.UtilizationLimit.LimitAmount.Amount.String()
	if _, e := number(out.Limit, true); e != nil {
		return out, e
	}
	out.Name = card.Name
	out.Last4 = card.Last4
	if !regexp.MustCompile(`^[0-9]{4}$`).MatchString(out.Last4) {
		return out, conflict("card_source_not_ready")
	}
	scan := func() ([]ledger.CardPosting, string, error) {
		facts := []ledger.CardPosting{}
		hold := new(big.Int)
		cursor := ""
		seen := map[string]bool{}
		for page := 0; page < 100; page++ {
			path := "/transaction"
			if cursor != "" {
				path += "?cursor=" + url.QueryEscape(cursor)
			}
			var data struct {
				Items []struct {
					ID, AccountID, CardID, Status, DetailedStatus string
					Amount                                        json.Number `json:"amountCents"`
				}
				Metadata struct{ NextCursor string }
			}
			if e := s.call(ctx, "GET", path, nil, &data); e != nil {
				return nil, "", e
			}
			for _, v := range data.Items {
				if v.CardID != c.ExternalID {
					continue
				}
				if v.AccountID != s.Account || !safeRef.MatchString(v.ID) || seen[v.ID] {
					return nil, "", conflict("card_source_incomplete")
				}
				seen[v.ID] = true
				n, ok := new(big.Int).SetString(v.Amount.String(), 10)
				if !ok || n.String() != v.Amount.String() {
					return nil, "", invalid("invalid_source_amount")
				}
				switch v.Status {
				case "pending":
					if n.Sign() >= 0 {
						return nil, "", conflict("unknown_authorization")
					}
					hold.Add(hold, new(big.Int).Abs(n))
				case "posted":
					p := ledger.CardPosting{ConnectionID: c.Connection, ExternalCardID: c.ExternalID, TransactionID: v.ID, Status: v.Status, DetailedStatus: v.DetailedStatus, SignedAmountMinor: n.String(), Currency: "USD", EvidenceRef: "slash:transaction:" + v.ID}
					if _, e := ledger.CardCommand("", "", "", p); e != nil {
						return nil, "", e
					}
					facts = append(facts, p)
				case "failed":
				default:
					return nil, "", conflict("unknown_card_status")
				}
			}
			if data.Metadata.NextCursor == "" {
				return facts, hold.String(), nil
			}
			if data.Metadata.NextCursor == cursor {
				return nil, "", conflict("card_source_incomplete")
			}
			cursor = data.Metadata.NextCursor
		}
		return nil, "", conflict("card_source_capacity")
	}
	a, h, e := scan()
	if e != nil {
		return out, e
	}
	b, h2, e := scan()
	if e != nil || h != h2 || digest(a) != digest(b) {
		return out, conflict("card_source_changed")
	}
	out.Facts = b
	out.Held = h
	out.Evidence = "slash:card-snapshot:" + digest(out)
	return out, nil
}

// EnrollZeroCard is a trusted server operation for explicitly approved new cards.
// Existing nonzero or previously used cards are not imported into a zero ledger.
func (s *Service) EnrollZeroCard(ctx context.Context, customer, connection, external, evidence string) (string, error) {
	if evidence == "" || !safeRef.MatchString(connection) || !safeRef.MatchString(external) || s.Live == nil {
		return "", invalid("card_enrollment_required")
	}
	source, ok := s.Live.Cards.(CardSource)
	if !ok {
		return "", conflict("card_source_required")
	}
	var owned bool
	e := s.Ledger.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM project_wallet_cards WHERE customer_id=$1 AND connection_id=$2 AND external_card_id=$3)`, customer, connection, external).Scan(&owned)
	if e != nil {
		return "", e
	}
	if !owned {
		return "", conflict("card_scope_mismatch")
	}
	state, e := source.ReadCard(ctx, FundsCard{Connection: connection, ExternalID: external})
	if e != nil {
		return "", e
	}
	if state.Limit != "0" || state.Held != "0" || len(state.Facts) != 0 {
		return "", conflict("nonzero_opening_card")
	}
	a, e := s.Ledger.Provision(ctx, ledger.AccountSpec{CustomerID: customer, Key: "funds-card:" + connection + ":" + external, Kind: "card", Currency: "USD", ConnectionID: connection, ExternalCardID: external})
	if e != nil {
		return "", e
	}
	tx, e := s.Ledger.DB.Begin(ctx)
	if e != nil {
		return "", e
	}
	defer tx.Rollback(ctx)
	if e = s.Lock(ctx, tx, customer); e != nil {
		return "", e
	}
	if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM project_wallet_cards WHERE customer_id=$1 AND connection_id=$2 AND external_card_id=$3)`, customer, connection, external).Scan(&owned); e != nil {
		return "", e
	}
	if !owned {
		return "", conflict("card_scope_mismatch")
	}
	var id string
	e = tx.QueryRow(ctx, `INSERT INTO funds_cards(id,namespace,customer_id,connection_id,external_card_id,name,last4,ledger_account_id,enabled,opening_verified,authorization_complete,observed_at,evidence_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,true,true,now(),$9) ON CONFLICT(namespace,connection_id,external_card_id) DO UPDATE SET name=funds_cards.name WHERE funds_cards.customer_id=EXCLUDED.customer_id RETURNING id::text`, uuid.NewString(), s.NS(), customer, connection, external, state.Name, state.Last4, a.ID, evidence).Scan(&id)
	if e != nil {
		return "", e
	}
	if e = s.Audit(ctx, tx, customer, "", "", "zero_card_enrollment", map[string]string{"cardId": id, "evidenceRef": evidence}); e != nil {
		return "", e
	}
	return id, tx.Commit(ctx)
}
func (s *Service) SyncCards(ctx context.Context) error {
	if s.Live == nil || s.Live.Cards == nil {
		return nil
	}
	source, ok := s.Live.Cards.(CardSource)
	if !ok {
		return errors.New("card_source_required")
	}
	rows, e := s.Ledger.DB.Query(ctx, `SELECT customer_id::text,id::text,connection_id,external_card_id FROM funds_cards WHERE namespace=$1 AND enabled=true ORDER BY observed_at NULLS FIRST LIMIT 20`, s.NS())
	if e != nil {
		return e
	}
	type item struct {
		customer string
		c        FundsCard
	}
	list := []item{}
	for rows.Next() {
		var v item
		if e = rows.Scan(&v.customer, &v.c.ID, &v.c.Connection, &v.c.ExternalID); e != nil {
			break
		}
		list = append(list, v)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return e
	}
	for _, v := range list {
		_, e = s.Ledger.DB.Exec(ctx, `UPDATE funds_cards SET authorization_complete=false WHERE namespace=$1 AND id=$2`, s.NS(), v.c.ID)
		if e != nil {
			return e
		}
		observed := time.Now()
		state, err := source.ReadCard(ctx, v.c)
		if err != nil {
			continue
		}
		good := true
		for _, p := range state.Facts {
			if err = s.RecordCardFact(ctx, v.customer, v.c.ID, p); err != nil {
				good = false
				break
			}
		}
		if !good {
			continue
		}
		tx, err := s.Ledger.DB.Begin(ctx)
		if err != nil {
			return err
		}
		if err = s.Lock(ctx, tx, v.customer); err == nil {
			_, err = tx.Exec(ctx, `UPDATE funds_cards SET held_minor=$3,observed_at=$4,authorization_complete=true,evidence_ref=$5 WHERE namespace=$1 AND id=$2 AND limit_minor=$6`, s.NS(), v.c.ID, state.Held, observed, state.Evidence, state.Limit)
		}
		if err == nil {
			err = tx.Commit(ctx)
		} else {
			tx.Rollback(ctx)
		}
		if err != nil {
			return err
		}
	}
	return nil
}
