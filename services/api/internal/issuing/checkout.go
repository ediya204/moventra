package issuing

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"strings"
)

var ErrConsent = errors.New("consent_required")
var ErrTerms = errors.New("terms_changed")

type Terms struct {
	Version string `json:"version"`
	Text    string `json:"text"`
	Digest  string `json:"digest"`
}

// Versioned application policy. A revision requires a new version; quotes bind it.
func CurrentTerms() Terms {
	text := "我承诺仅将卡片用于合法用途，不用于诈骗、洗钱或其他违法活动。开卡费与首充从独立 USD 开卡钱包支付。发卡失败退回全部预占金额；发卡成功后开卡费不退，首充失败仅退回首充金额，可对原卡补充首充且不重复收取开卡费。结果未知时需等待核查，不代表失败或退款。首充属于内部卡分户记账，卡片是否可用以启用核验结果为准。"
	return Terms{Version: "issuing-2026-09-18-v1", Text: text, Digest: hash(text)}
}

func (s *Service) Terms() Terms {
	t := CurrentTerms()
	if s.Funds != nil {
		t.Version = "issuing-funds-2026-09-19-v1"
		t.Text = strings.Replace(t.Text, "独立 USD 开卡钱包", "资金中心 USD 钱包", 1)
		t.Digest = hash(t.Text)
	}
	if s.Pilot != nil {
		t.Version = "issuing-pilot-2026-09-19-v1"
		t.Text = strings.Replace(t.Text, "可对原卡补充首充且不重复收取开卡费", "本次不开放补充首充", 1)
		t.Text += " 本次为限定真实验收，仅指定产品一张卡，首充20 USD，开卡费最多10 USD，合计最多30 USD；失败或结果未知不自动另开新卡。"
		t.Digest = hash(t.Text)
	}
	return t
}

type Checkout struct {
	QuoteID       string `json:"quoteId"`
	TermsVersion  string `json:"termsVersion"`
	LawfulUse     bool   `json:"lawfulUse"`
	AcceptedTerms bool   `json:"acceptedTerms"`
}

func (s *Service) Checkout(ctx context.Context, tx pgx.Tx, customer, actor, key string, v Checkout) (any, error) {
	if !ValidID(v.QuoteID) || !ValidID(key) {
		return nil, ErrInvalid
	}
	if !v.LawfulUse || !v.AcceptedTerms {
		return nil, ErrConsent
	}
	if e := Lock(ctx, tx, "catalog"); e != nil {
		return nil, e
	}
	if e := Lock(ctx, tx, customer); e != nil {
		return nil, e
	}
	var oldID, oldHash string
	e := tx.QueryRow(ctx, `SELECT o.id::text,c.request_hash FROM issuing_orders o JOIN issuing_consents c ON c.order_id=o.id WHERE o.customer_id=$1 AND o.idempotency_key=$2`, customer, key).Scan(&oldID, &oldHash)
	if e == nil {
		if oldHash != hash(v) {
			return nil, ErrConflict
		}
		return OrderRead(ctx, tx, customer, oldID)
	}
	if e != pgx.ErrNoRows {
		return nil, e
	}
	terms := s.Terms()
	var version string
	e = tx.QueryRow(ctx, `SELECT terms_version FROM issuing_quotes WHERE id=$1 AND customer_id=$2`, v.QuoteID, customer).Scan(&version)
	if e != nil {
		return nil, mapped(e)
	}
	if version != terms.Version || v.TermsVersion != version {
		return nil, ErrTerms
	}
	result, e := s.Submit(ctx, tx, customer, v.QuoteID, key)
	if e != nil {
		return nil, e
	}
	raw, e := json.Marshal(result)
	if e != nil {
		return nil, e
	}
	var order struct {
		ID string `json:"id"`
	}
	if e = json.Unmarshal(raw, &order); e != nil {
		return nil, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO issuing_consents(order_id,customer_id,actor_id,request_hash,terms_version,terms_digest,terms_text,lawful_use,accepted_terms) VALUES($1,$2,$3,$4,$5,$6,$7,true,true)`, order.ID, customer, actor, hash(v), terms.Version, terms.Digest, terms.Text)
	if e != nil {
		return nil, e
	}
	return OrderRead(ctx, tx, customer, order.ID)
}
func (s *Service) ClientProduct(ctx context.Context, tx pgx.Tx, customer, id string) (any, error) {
	if !ValidID(id) {
		return nil, ErrInvalid
	}
	v, b, e := s.snapshot(ctx, tx, customer, id)
	if e != nil {
		return nil, e
	}
	if v.Product.Status != "active" && v.Product.Status != "paused" {
		return nil, ErrNotFound
	}
	return map[string]any{"id": id, "name": v.Product.Name, "bin": v.Product.BIN, "network": v.Product.Network, "description": v.Product.Description, "status": v.Product.Status, "feeMinor": v.FeeMinor, "minimumMinor": v.Product.MinimumMinor, "currency": "USD", "blockedReason": b, "revision": v.Product.Revision}, nil
}
func (s *Service) Cards(ctx context.Context, tx pgx.Tx, customer, id string, offset int) (any, error) {
	if id == "" {
		return jsonRows(ctx, tx, `SELECT `+orderJSON+` FROM issuing_orders WHERE customer_id=$1 AND parent_id IS NULL AND external_card_id<>'' ORDER BY created_at DESC,id LIMIT 51 OFFSET $2`, customer, offset)
	}
	if !ValidID(id) {
		return nil, ErrInvalid
	}
	var exists bool
	if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_orders WHERE id=$1 AND customer_id=$2 AND parent_id IS NULL AND external_card_id<>'')`, id, customer).Scan(&exists); e != nil {
		return nil, e
	}
	if !exists {
		return nil, ErrNotFound
	}
	order, e := OrderRead(ctx, tx, customer, id)
	if e != nil {
		return nil, e
	}
	result := map[string]any{"order": order, "currency": "USD", "balanceMinor": nil, "balanceStatus": "unavailable", "balanceKind": "internal_card_subaccount"}
	// Only an explicit same-customer, same-account mapping can link the channel view.
	var projectionConnection, projectionCard string
	mappingErr := tx.QueryRow(ctx, `SELECT p.connection_id,p.external_card_id FROM issuing_orders o JOIN issuing_suppliers s ON s.id=o.supplier_id JOIN project_wallet_cards p ON p.customer_id=o.customer_id AND p.external_card_id=o.external_card_id JOIN project_wallets w ON w.connection_id=p.connection_id AND w.virtual_account_ref=p.virtual_account_ref AND w.account_ref=s.account_ref WHERE o.id=$1 AND o.customer_id=$2 AND EXISTS(SELECT 1 FROM channel_current_records r WHERE r.connection_id=p.connection_id AND r.kind='card' AND r.external_id=p.external_card_id AND r.data->>'accountId'=w.account_ref AND r.data->>'virtualAccountId'=w.virtual_account_ref) AND (SELECT count(*) FROM project_wallet_cards x JOIN project_wallets y ON y.connection_id=x.connection_id AND y.virtual_account_ref=x.virtual_account_ref WHERE x.customer_id=o.customer_id AND x.external_card_id=o.external_card_id AND y.account_ref=s.account_ref)=1`, id, customer).Scan(&projectionConnection, &projectionCard)
	if mappingErr == nil {
		result["projection"] = map[string]string{"connection": projectionConnection, "cardId": projectionCard}
	} else if mappingErr != pgx.ErrNoRows {
		return nil, mappingErr
	}
	var snapshotRaw []byte
	if e = tx.QueryRow(ctx, `SELECT snapshot FROM issuing_orders WHERE id=$1 AND customer_id=$2`, id, customer).Scan(&snapshotRaw); e != nil {
		return nil, e
	}
	var snap Snapshot
	if e = json.Unmarshal(snapshotRaw, &snap); e != nil {
		return nil, e
	}
	accounting, routeErr := s.forSnapshot(snap)
	if routeErr != nil {
		return result, nil
	}
	s = accounting
	if s.Funds != nil {
		var key string
		if e = tx.QueryRow(ctx, `SELECT external_card_id FROM issuing_orders WHERE id=$1 AND customer_id=$2`, id, customer).Scan(&key); e != nil {
			return nil, e
		}
		view, err := s.Funds.SnapshotTx(ctx, tx, customer)
		if err != nil {
			return result, nil
		}
		for _, a := range view.Accounts {
			if a.Key == "funds-card:"+snap.ConnectionID+":"+key {
				result["balanceMinor"] = a.PostedMinor
				result["balanceStatus"] = "known"
				return result, nil
			}
		}
		result["balanceStatus"] = "not_funded"
		return result, nil
	}
	if s.Blnk == nil {
		return result, nil
	}
	var balanceID string
	e = tx.QueryRow(ctx, `SELECT blnk_id FROM issuing_balances WHERE customer_id=$1 AND account_key=$2`, customer, "card_"+id).Scan(&balanceID)
	if e == pgx.ErrNoRows {
		result["balanceStatus"] = "not_funded"
		return result, nil
	}
	if e != nil {
		return nil, e
	}
	balance, e := s.Blnk.Balance(ctx, balanceID)
	if e != nil {
		return result, nil
	}
	if balance.Currency != "USD" || balance.LedgerID != "general_ledger_id" {
		return result, nil
	}
	result["balanceMinor"] = balance.Amount.String()
	result["balanceStatus"] = "known"
	return result, nil
}
