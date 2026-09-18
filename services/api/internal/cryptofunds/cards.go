package cryptofunds

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"math/big"
	"moventra.local/api/internal/ledger"
	"time"
)

type FundsCard struct {
	ID                                             string  `json:"id"`
	Name                                           string  `json:"name"`
	Last4                                          string  `json:"last4"`
	Available                                      *string `json:"availableMinor"`
	CanOperate                                     bool    `json:"canOperate"`
	Reason                                         string  `json:"reason"`
	AccountID, Connection, ExternalID, Held, Limit string
	Observed                                       *time.Time
	Enabled, Opening, Authorizations               bool
}

func (s *Service) card(ctx context.Context, tx pgx.Tx, customer, id string, operate bool) (FundsCard, error) {
	var c FundsCard
	e := tx.QueryRow(ctx, `SELECT id::text,name,last4,ledger_account_id::text,connection_id,external_card_id,held_minor::text,observed_at,enabled,opening_verified,authorization_complete,limit_minor::text FROM funds_cards WHERE namespace=$1 AND customer_id=$2 AND id=$3`, s.NS(), customer, id).Scan(&c.ID, &c.Name, &c.Last4, &c.AccountID, &c.Connection, &c.ExternalID, &c.Held, &c.Observed, &c.Enabled, &c.Opening, &c.Authorizations, &c.Limit)
	if errors.Is(e, pgx.ErrNoRows) {
		return c, &Fault{"not_found", 404}
	}
	if e != nil {
		return c, e
	}
	c.CanOperate = (s.Live == nil || s.Live.Cards != nil) && c.Enabled && c.Opening && c.Authorizations && c.Observed != nil && time.Since(*c.Observed) >= 0 && time.Since(*c.Observed) < 30*time.Second
	if s.Live != nil {
		var owned bool
		if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM project_wallet_cards WHERE customer_id=$1 AND connection_id=$2 AND external_card_id=$3)`, customer, c.Connection, c.ExternalID).Scan(&owned); e != nil {
			return c, e
		}
		c.CanOperate = c.CanOperate && owned
	}
	if !c.CanOperate {
		c.Reason = "卡片资金或授权占用待核实"
	}
	if operate {
		var pending bool
		if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM crypto_orders WHERE namespace=$1 AND customer_id=$2 AND kind='card_transfer' AND data->>'cardId'=$3 AND state IN ('reserving','processing','unknown','releasing'))`, s.NS(), customer, id).Scan(&pending); e != nil {
			return c, e
		}
		if pending {
			return c, conflict("card_transfer_pending")
		}
	}
	if operate && !c.CanOperate {
		return c, conflict("card_funds_not_ready")
	}
	return c, nil
}
func (s *Service) Cards(ctx context.Context, tx pgx.Tx, customer string, snapshot ledger.Snapshot) ([]map[string]any, error) {
	rows, e := tx.Query(ctx, `SELECT id::text FROM funds_cards WHERE namespace=$1 AND customer_id=$2 ORDER BY id LIMIT 501`, s.NS(), customer)
	if e != nil {
		return nil, e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			break
		}
		ids = append(ids, id)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return nil, e
	}
	if len(ids) > 500 {
		return nil, conflict("card_capacity_exceeded")
	}
	// Attribute held escrow from the complete ledger snapshot to its original card order.
	transit := map[string]*big.Int{}
	heldByKey := map[string]string{}
	keys := []string{}
	for _, a := range snapshot.Accounts {
		if a.Kind == "escrow" && a.Currency == "USD" && a.HeldMinor != "0" {
			heldByKey[a.Key] = a.HeldMinor
			keys = append(keys, a.Key)
		}
	}
	if len(keys) > 0 {
		holds, err := tx.Query(ctx, `SELECT data->>'cardId','crypto-hold:'||id::text FROM crypto_orders WHERE namespace=$1 AND customer_id=$2 AND kind='card_transfer' AND ('crypto-hold:'||id::text)=ANY($3)`, s.NS(), customer, keys)
		if err != nil {
			return nil, err
		}
		for holds.Next() {
			var cardID, key string
			if err = holds.Scan(&cardID, &key); err != nil {
				break
			}
			n, ok := new(big.Int).SetString(heldByKey[key], 10)
			if !ok {
				err = errors.New("invalid escrow amount")
				break
			}
			if transit[cardID] == nil {
				transit[cardID] = new(big.Int)
			}
			transit[cardID].Add(transit[cardID], n)
		}
		if err == nil {
			err = holds.Err()
		}
		holds.Close()
		if err != nil {
			return nil, err
		}
	}
	out := []map[string]any{}
	for _, id := range ids {
		c, e := s.card(ctx, tx, customer, id, false)
		if e != nil {
			return nil, e
		}
		for _, a := range snapshot.Accounts {
			if a.ID == c.AccountID && c.CanOperate {
				n, _ := new(big.Int).SetString(a.AvailableMinor, 10)
				h, _ := new(big.Int).SetString(c.Held, 10)
				n.Sub(n, h)
				if n.Sign() < 0 {
					n.SetInt64(0)
				}
				v := n.String()
				c.Available = &v
			}
		}
		out = append(out, map[string]any{"id": c.ID, "name": c.Name, "last4": c.Last4, "availableMinor": c.Available, "canOperate": c.CanOperate && c.Available != nil, "reason": c.Reason, "ledgerAccountId": c.AccountID, "inTransitMinor": func() any {
			if snapshot.Reconciliation != "matched" {
				return nil
			}
			if transit[c.ID] != nil {
				return transit[c.ID].String()
			}
			return "0"
		}(), "heldMinor": func() any {
			if c.Authorizations && c.Observed != nil && time.Since(*c.Observed) >= 0 && time.Since(*c.Observed) < 30*time.Second {
				return c.Held
			}
			return nil
		}()})
	}
	return out, nil
}
func (s *Service) cardQuote(ctx context.Context, tx pgx.Tx, customer string, in Input, config Settings) (Quote, error) {
	q := Quote{}
	if _, e := uuid.Parse(in.CardID); e != nil {
		return q, invalid("invalid_card")
	}
	if in.Currency != "USD" {
		return q, invalid("invalid_currency")
	}
	if _, e := number(in.Amount, false); e != nil {
		return q, e
	}
	if _, e := s.card(ctx, tx, customer, in.CardID, true); e != nil {
		return q, e
	}
	fee := config.CardDepositFee
	if in.Direction == "card_to_wallet" {
		fee = config.CardWithdrawFee
	} else if in.Direction != "wallet_to_card" {
		return q, invalid("invalid_direction")
	}
	if fee == nil {
		return q, conflict("card_fee_not_configured")
	}
	if _, e := number(sum(in.Amount, *fee), false); e != nil {
		return q, e
	}
	q = Quote{ID: uuid.NewString(), Kind: "card_transfer", CustomerID: customer, Currency: "USD", ToCurrency: "USD", Amount: in.Amount, Receive: in.Amount, Fee: *fee, CardID: in.CardID, Direction: in.Direction, PolicyRevision: config.Revision, Expires: time.Now().UTC().Add(time.Minute)}
	raw, _ := json.Marshal(q)
	_, e := tx.Exec(ctx, `INSERT INTO crypto_quotes(id,namespace,customer_id,kind,data,expires_at) VALUES($1,$2,$3,$4,$5,$6)`, q.ID, s.NS(), customer, q.Kind, raw, q.Expires)
	return q, e
}
