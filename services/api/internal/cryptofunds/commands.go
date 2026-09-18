package cryptofunds

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"moventra.local/api/internal/tron"
	"strings"
	"time"
)

// Execute is called inside the same transaction as authorization and audit.
// It queues all balance mutations; no network operation happens on this path.
func (s *Service) Execute(ctx context.Context, tx pgx.Tx, customer, actor, key string, admin bool, in Input) (json.RawMessage, error) {
	if s.Production != nil {
		if !s.ProductionReady() {
			return nil, conflict("funds_recovering")
		}
		if !admin && in.Action != "otc_quote" && in.Action != "otc_order" {
			return nil, conflict("capability_not_enabled")
		}
	}
	if _, e := uuid.Parse(key); e != nil {
		return nil, invalid("idempotency_key_required")
	}
	if len(in.Note) > 500 || len(in.Address) > 128 {
		return nil, invalid("invalid_body")
	}
	if e := s.Lock(ctx, tx, customer); e != nil {
		return nil, e
	}
	fingerprint := digest(in)
	var priorHash string
	var prior json.RawMessage
	e := tx.QueryRow(ctx, `SELECT request_hash,result FROM crypto_commands WHERE namespace=$1 AND customer_id=$2 AND actor_id=$3 AND request_id=$4`, s.NS(), customer, actor, key).Scan(&priorHash, &prior)
	if e == nil {
		if fingerprint != priorHash {
			return nil, conflict("idempotency_conflict")
		}
		return prior, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return nil, e
	}
	config, e := s.Settings(ctx, tx)
	if e != nil {
		return nil, e
	}
	var out any
	if admin {
		if strings.TrimSpace(in.Note) == "" {
			return nil, invalid("review_reason_required")
		}
		switch in.Action {
		case "configure":
			if in.Settings == nil {
				return nil, invalid("settings_required")
			}
			v := *in.Settings
			if v.Revision != config.Revision {
				return nil, conflict("configuration_changed")
			}
			if v.USDTToUSD != "" {
				if _, e = Convert("1000000", "USDT", v.USDTToUSD); e != nil {
					return nil, e
				}
			}
			if v.USDToUSDT != "" {
				if _, e = Convert("100", "USD", v.USDToUSDT); e != nil {
					return nil, e
				}
			}
			if v.OTCEnabled && (v.USDTToUSD == "" || v.USDToUSDT == "") {
				return nil, invalid("rates_required")
			}
			if v.WithdrawalFee != nil {
				if _, e = number(*v.WithdrawalFee, true); e != nil {
					return nil, e
				}
			}
			if v.WithdrawEnabled && v.WithdrawalFee == nil && len(v.NetworkFees) == 0 {
				return nil, invalid("withdrawal_fee_required")
			}
			for n, f := range v.NetworkFees {
				if !validNetwork(n) {
					return nil, invalid("invalid_network")
				}
				if f != nil {
					if _, e = number(*f, true); e != nil {
						return nil, e
					}
				}
			}
			for _, f := range []*string{v.CardDepositFee, v.CardWithdrawFee} {
				if f != nil {
					if _, e = number(*f, true); e != nil {
						return nil, e
					}
				}
			}
			v.Revision++
			raw, _ := json.Marshal(v)
			// Configuration is namespace-wide: revision CAS prevents cross-customer races.
			tag, err := tx.Exec(ctx, `INSERT INTO crypto_settings(namespace,revision,data) VALUES($1,$2,$3) ON CONFLICT(namespace) DO UPDATE SET revision=EXCLUDED.revision,data=EXCLUDED.data,updated_at=now() WHERE crypto_settings.revision=$4`, s.NS(), v.Revision, raw, config.Revision)
			if err != nil {
				return nil, err
			}
			if tag.RowsAffected() != 1 {
				return nil, conflict("configuration_changed")
			}
			out = v
		case "approve", "reject", "recover":
			o, err := s.Get(ctx, tx, customer, in.OrderID)
			if err != nil {
				return nil, err
			}
			if o.Revision != in.Revision {
				return nil, conflict("order_changed")
			}
			if in.Action == "recover" {
				if o.State != "processing" && o.State != "reserving" && o.State != "releasing" {
					return nil, conflict("evidence_required")
				}
				o.Error = ""
			} else {
				if o.Kind != "withdrawal" || o.State != "pending_review" || o.ActorID == actor {
					return nil, conflict("invalid_review")
				}
				if in.Action == "approve" {
					o.Approval = "approved"
					o.State = "processing"
				} else {
					o.Approval = "rejected"
					o.State = "releasing"
					o.Resolution = "rejected"
				}
			}
			if e = s.Save(ctx, tx, &o, actor, in.Action); e != nil {
				return nil, e
			}
			out = o
		default:
			return nil, invalid("invalid_action")
		}
	} else {
		switch in.Action {
		case "address":
			if s.Live != nil {
				out, e = s.requestAddress(ctx, tx, customer, in.Network)
				if e != nil {
					return nil, e
				}
				break
			}
			if in.Network == "" {
				in.Network = "TRC20"
			}
			if !validNetwork(in.Network) {
				return nil, invalid("invalid_network")
			}
			// Synthetic identifiers are deliberately not blockchain addresses.
			address := "SIMULATED-DO-NOT-SEND-" + digest([]string{s.NS(), customer, in.Network})[:24]
			_, e = tx.Exec(ctx, `INSERT INTO crypto_addresses(namespace,connection_id,project_id,network,customer_id,address,chain_address,mode) VALUES($1,'synthetic','synthetic',$5,$2,$3,$4,'synthetic') ON CONFLICT DO NOTHING`, s.NS(), customer, address, tron.FixtureAddress(s.NS()+":"+customer), fixtureNetwork(in.Network))
			if e != nil {
				return nil, e
			}
			out = map[string]string{"address": address, "network": in.Network, "mode": "synthetic"}
		case "card_quote":
			out, e = s.cardQuote(ctx, tx, customer, in, config)
			if e != nil {
				return nil, e
			}
		case "otc_quote", "withdraw_quote":
			if _, e = number(in.Amount, false); e != nil {
				return nil, e
			}
			q := Quote{ID: uuid.NewString(), CustomerID: customer, Currency: in.Currency, Amount: in.Amount, Fee: "0", PolicyRevision: config.Revision, Expires: time.Now().UTC().Add(60 * time.Second)}
			if in.Action == "otc_quote" {
				if !config.OTCEnabled {
					return nil, conflict("otc_disabled")
				}
				q.Kind = "otc"
				q.ToCurrency = opposite(in.Currency)
				q.Rate = config.USDTToUSD
				if in.Currency == "USD" {
					q.Rate = config.USDToUSDT
				}
				q.Receive, e = Convert(in.Amount, in.Currency, q.Rate)
				if e != nil {
					return nil, e
				}
			} else {
				if in.Network == "" && s.Live == nil {
					in.Network = "TRC20"
				}
				if !validNetwork(in.Network) {
					return nil, invalid("invalid_network")
				}
				q.Network = in.Network
				if (s.Live != nil || in.Address != "") && !validNetworkAddress(in.Network, in.Address) {
					return nil, invalid("invalid_network_address")
				}
				q.Address = in.Address
				if s.Live != nil && !s.Live.Networks[in.Network].Withdraw {
					return nil, conflict("network_not_enabled")
				}
				fee := config.NetworkFees[in.Network]
				if fee == nil && s.Live == nil && in.Network == "TRC20" {
					fee = config.WithdrawalFee
				}
				if !config.WithdrawEnabled || fee == nil || in.Currency != "USDT" {
					return nil, conflict("withdrawal_disabled")
				}
				q.Kind = "withdrawal"
				q.ToCurrency = "USDT"
				q.Receive = in.Amount
				q.Fee = *fee
				if _, e = number(sum(q.Amount, q.Fee), false); e != nil {
					return nil, e
				}
			}
			raw, _ := json.Marshal(q)
			_, e = tx.Exec(ctx, `INSERT INTO crypto_quotes(id,namespace,customer_id,kind,data,expires_at) VALUES($1,$2,$3,$4,$5,$6)`, q.ID, s.NS(), customer, q.Kind, raw, q.Expires)
			if e != nil {
				return nil, e
			}
			out = q
		case "otc_order", "withdraw_order", "card_order":
			if _, e = uuid.Parse(in.QuoteID); e != nil {
				return nil, invalid("invalid_quote")
			}
			var raw []byte
			var used bool
			e = tx.QueryRow(ctx, `SELECT data,used_by IS NOT NULL FROM crypto_quotes WHERE namespace=$1 AND customer_id=$2 AND id=$3 FOR UPDATE`, s.NS(), customer, in.QuoteID).Scan(&raw, &used)
			if errors.Is(e, pgx.ErrNoRows) {
				return nil, &Fault{"not_found", 404}
			}
			if e != nil {
				return nil, e
			}
			var q Quote
			if e = json.Unmarshal(raw, &q); e != nil {
				return nil, e
			}
			if used || !time.Now().Before(q.Expires) || q.PolicyRevision != config.Revision {
				return nil, conflict("quote_expired_or_changed")
			}
			if q.Kind == "otc" && in.Action != "otc_order" || q.Kind == "withdrawal" && in.Action != "withdraw_order" || q.Kind == "card_transfer" && in.Action != "card_order" {
				return nil, invalid("quote_kind_mismatch")
			}
			if q.Kind == "withdrawal" && q.Address != "" && (!sameAddress(q.Network, q.Address, in.Address) || in.Network != q.Network) {
				return nil, conflict("quote_destination_changed")
			}
			if q.Kind == "withdrawal" && !validNetworkAddress(q.Network, in.Address) {
				return nil, invalid("invalid_network_address")
			}
			if q.Kind == "card_transfer" {
				if _, err := s.card(ctx, tx, customer, q.CardID, true); err != nil {
					return nil, err
				}
			}
			o := Order{Network: q.Network, CardID: q.CardID, Direction: q.Direction, CustomerID: customer, ActorID: actor, Kind: q.Kind, State: "reserving", Currency: q.Currency, ToCurrency: q.ToCurrency, Amount: q.Amount, Receive: q.Receive, Fee: q.Fee, Quote: &q, Address: in.Address, Approval: "not_required", Provider: "not_applicable", Chain: "not_applicable", Posting: "pending"}
			if q.Kind == "withdrawal" {
				o.Approval = "pending"
				o.Provider = "not_submitted"
				o.Chain = "not_verified"
			}
			if e = s.Insert(ctx, tx, &o); e != nil {
				return nil, e
			}
			_, e = tx.Exec(ctx, `UPDATE crypto_quotes SET used_by=$1 WHERE id=$2`, o.ID, q.ID)
			if e != nil {
				return nil, e
			}
			out = o
		case "cancel":
			o, err := s.Get(ctx, tx, customer, in.OrderID)
			if err != nil {
				return nil, err
			}
			if o.Revision != in.Revision || o.Kind != "withdrawal" || o.State != "pending_review" {
				return nil, conflict("order_changed")
			}
			o.State = "releasing"
			o.Resolution = "cancelled"
			if e = s.Save(ctx, tx, &o, actor, "cancel"); e != nil {
				return nil, e
			}
			out = o
		default:
			return nil, invalid("invalid_action")
		}
	}
	result, e := json.Marshal(out)
	if e != nil {
		return nil, e
	}
	if e = s.Audit(ctx, tx, customer, "", actor, in.Action, map[string]any{"requestId": key, "note": in.Note, "result": out}); e != nil {
		return nil, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO crypto_commands(namespace,customer_id,actor_id,request_id,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)`, s.NS(), customer, actor, key, fingerprint, result)
	return result, e
}
