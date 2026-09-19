package issuing

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"time"
)

func (s *Service) Quote(ctx context.Context, tx pgx.Tx, customer, productID, funding string) (Quote, error) {
	var q Quote
	if !ValidID(productID) || !Money(funding, true) {
		return q, ErrInvalid
	}
	if e := Lock(ctx, tx, "catalog"); e != nil {
		return q, e
	}
	v, b, e := s.snapshot(ctx, tx, customer, productID)
	if e != nil {
		return q, e
	}
	if b != "" {
		return q, ErrBlocked
	}
	if number(funding).Cmp(number(v.Product.MinimumMinor)) < 0 {
		return q, ErrInvalid
	}
	if s.Pilot != nil && !s.Pilot.amountAllowed(v.FeeMinor, funding) {
		return q, ErrBlocked
	}
	q = Quote{TermsVersion: s.Terms().Version, ID: uuid.NewString(), ProductID: productID, FeeMinor: v.FeeMinor, FundingMinor: funding, TotalMinor: add(v.FeeMinor, funding), PriceSource: v.PriceSource, ExpiresAt: time.Now().UTC().Add(5 * time.Minute).Format(time.RFC3339)}
	raw, _ := json.Marshal(v)
	_, e = tx.Exec(ctx, `INSERT INTO issuing_quotes(id,customer_id,product_id,fingerprint,snapshot,fee_minor,funding_minor,expires_at,terms_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, q.ID, customer, productID, hash(v), raw, q.FeeMinor, funding, q.ExpiresAt, q.TermsVersion)
	return q, e
}

const orderJSON = `jsonb_build_object('pilot',COALESCE(snapshot->>'pilotAuthorization','')<>'','fundingSource',CASE WHEN COALESCE(snapshot->>'fundsNamespace','')='' THEN 'issuing_wallet' ELSE 'funds_wallet' END,'fundingAccountId',NULLIF(snapshot->>'fundsWalletId',''),'id',id,'customerId',customer_id,'productId',product_id,'state',state,'feeMinor',fee_minor::text,'fundingMinor',funding_minor::text,'last4',last4,'errorCode',error_code,'createdAt',created_at,'cardId',CASE WHEN external_card_id<>'' THEN COALESCE(parent_id,id)::text ELSE '' END,'parentId',COALESCE(parent_id::text,''),'cardName',COALESCE(snapshot->>'cardName',''),'productName',snapshot->'product'->>'name','bin',snapshot->'product'->>'bin')`

func OrderRead(ctx context.Context, tx pgx.Tx, customer, id string) (any, error) {
	if !ValidID(id) {
		return nil, ErrInvalid
	}
	var raw json.RawMessage
	e := tx.QueryRow(ctx, `SELECT `+orderJSON+` FROM issuing_orders WHERE customer_id=$1 AND id=$2`, customer, id).Scan(&raw)
	if e != nil {
		return nil, mapped(e)
	}
	var result map[string]any
	if e = json.Unmarshal(raw, &result); e != nil {
		return nil, e
	}
	var consent json.RawMessage
	e = tx.QueryRow(ctx, `SELECT jsonb_build_object('version',terms_version,'digest',terms_digest,'text',terms_text,'acceptedAt',accepted_at,'lawfulUse',lawful_use,'acceptedTerms',accepted_terms) FROM issuing_consents WHERE order_id=$1 AND customer_id=$2`, id, customer).Scan(&consent)
	if e != nil && e != pgx.ErrNoRows {
		return nil, e
	}
	result["consent"] = consent
	events, e := jsonRows(ctx, tx, `SELECT jsonb_build_object('state',substring(action from 7),'createdAt',created_at,'code',detail->>'code') FROM issuing_audit WHERE customer_id=$1 AND resource_id=$2 AND action LIKE 'order.%' ORDER BY id LIMIT 200`, customer, id)
	result["events"] = events
	return result, e
}
func (s *Service) Submit(ctx context.Context, tx pgx.Tx, customer, quoteID, key string) (any, error) {
	if !ValidID(quoteID) || !ValidID(key) {
		return nil, ErrInvalid
	}
	if e := Lock(ctx, tx, "catalog"); e != nil {
		return nil, e
	}
	if e := Lock(ctx, tx, customer); e != nil {
		return nil, e
	}
	var oldID, oldQuote string
	e := tx.QueryRow(ctx, `SELECT id::text,quote_id::text FROM issuing_orders WHERE customer_id=$1 AND idempotency_key=$2`, customer, key).Scan(&oldID, &oldQuote)
	if e == nil {
		if oldQuote != quoteID {
			return nil, ErrConflict
		}
		return OrderRead(ctx, tx, customer, oldID)
	}
	if e != pgx.ErrNoRows {
		return nil, e
	}
	var productID, fingerprint, fee, funding string
	var raw []byte
	var expiry time.Time
	e = tx.QueryRow(ctx, `SELECT product_id::text,fingerprint,snapshot,fee_minor::text,funding_minor::text,expires_at FROM issuing_quotes WHERE id=$1 AND customer_id=$2`, quoteID, customer).Scan(&productID, &fingerprint, &raw, &fee, &funding, &expiry)
	if e != nil {
		return nil, mapped(e)
	}
	if time.Now().After(expiry) {
		return nil, ErrConflict
	}
	v, b, e := s.snapshot(ctx, tx, customer, productID)
	if e != nil {
		return nil, e
	}
	if b != "" {
		return nil, ErrBlocked
	}
	if fingerprint != hash(v) {
		return nil, ErrConflict
	}
	var used bool
	if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_orders WHERE quote_id=$1)`, quoteID).Scan(&used); e != nil {
		return nil, e
	}
	if used {
		return nil, ErrConflict
	}
	if s.Pilot != nil && !s.Pilot.amountAllowed(fee, funding) {
		return nil, ErrBlocked
	}
	balance, e := s.Wallet(ctx, tx, customer)
	if e != nil {
		return nil, e
	}
	if number(balance).Cmp(number(add(fee, funding))) < 0 {
		return nil, ErrInsufficient
	}
	v.CardName, e = randomCardName()
	if e != nil {
		return nil, e
	}
	raw, e = json.Marshal(v)
	if e != nil {
		return nil, e
	}
	id := uuid.NewString()
	if s.Pilot != nil {
		id = s.Pilot.OrderID
	}
	_, e = tx.Exec(ctx, `INSERT INTO issuing_orders(id,customer_id,product_id,quote_id,idempotency_key,snapshot,fee_minor,funding_minor,state,supplier_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9)`, id, customer, productID, quoteID, key, raw, fee, funding, v.Supplier.ID)
	if e != nil {
		return nil, e
	}
	return OrderRead(ctx, tx, customer, id)
}
func (s *Service) Topup(ctx context.Context, tx pgx.Tx, customer, parent, key, funding string) (any, error) {
	if s.Pilot != nil {
		return nil, ErrBlocked
	}
	if !ValidID(parent) || !ValidID(key) || !Money(funding, true) {
		return nil, ErrInvalid
	}
	if !s.Enabled || s.Blnk == nil {
		return nil, ErrBlocked
	}
	if e := Lock(ctx, tx, "catalog"); e != nil {
		return nil, e
	}
	if e := Lock(ctx, tx, customer); e != nil {
		return nil, e
	}
	var oldID, oldParent, oldAmount string
	e := tx.QueryRow(ctx, `SELECT id::text,parent_id::text,funding_minor::text FROM issuing_orders WHERE customer_id=$1 AND idempotency_key=$2`, customer, key).Scan(&oldID, &oldParent, &oldAmount)
	if e == nil {
		if oldParent != parent || oldAmount != funding {
			return nil, ErrConflict
		}
		return OrderRead(ctx, tx, customer, oldID)
	}
	if e != pgx.ErrNoRows {
		return nil, e
	}
	var original Order
	var raw []byte
	var supplierID string
	e = tx.QueryRow(ctx, `SELECT id::text,product_id::text,state,external_card_id,last4,snapshot,supplier_id::text FROM issuing_orders WHERE id=$1 AND customer_id=$2 AND parent_id IS NULL FOR UPDATE`, parent, customer).Scan(&original.ID, &original.ProductID, &original.State, &original.CardID, &original.Last4, &raw, &supplierID)
	if e != nil {
		return nil, mapped(e)
	}
	if original.State != "funding_failed" {
		return nil, ErrConflict
	}
	var exists bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_orders WHERE parent_id=$1 AND state NOT IN ('failed','funding_failed'))`, parent).Scan(&exists)
	if e != nil {
		return nil, e
	}
	if exists {
		return nil, ErrConflict
	}
	v, b, e := s.snapshot(ctx, tx, customer, original.ProductID)
	if e != nil {
		return nil, e
	}
	if b != "" && b != "product_paused" {
		return nil, ErrBlocked
	}
	if s.Providers[supplierID] == nil || !vAllowed(ctx, tx, customer) {
		return nil, ErrBlocked
	}
	if number(funding).Cmp(number(v.Product.MinimumMinor)) < 0 {
		return nil, ErrInvalid
	}
	var old Snapshot
	if e = json.Unmarshal(raw, &old); e != nil {
		return nil, e
	}
	if old.FundsNamespace != v.FundsNamespace {
		return nil, ErrBlocked
	}
	old.FeeMinor = "0"
	raw, _ = json.Marshal(old)
	quoteID, id := uuid.NewString(), uuid.NewString()
	_, e = tx.Exec(ctx, `INSERT INTO issuing_quotes(id,customer_id,product_id,fingerprint,snapshot,fee_minor,funding_minor,expires_at) VALUES($1,$2,$3,$4,$5,0,$6,now())`, quoteID, customer, original.ProductID, hash(old), raw, funding)
	if e != nil {
		return nil, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO issuing_orders(id,customer_id,product_id,quote_id,idempotency_key,parent_id,snapshot,fee_minor,funding_minor,state,supplier_id,external_card_id,last4) VALUES($1,$2,$3,$4,$5,$6,$7,0,$8,'queued',$9,$10,$11)`, id, customer, original.ProductID, quoteID, key, parent, raw, funding, supplierID, original.CardID, original.Last4)
	if e != nil {
		return nil, e
	}
	return OrderRead(ctx, tx, customer, id)
}
func vAllowed(ctx context.Context, tx pgx.Tx, customer string) bool {
	var ok bool
	e := tx.QueryRow(ctx, `SELECT i.enabled AND c.service_status='active' AND c.onboarding_status='approved' FROM issuing_customers i JOIN customers c ON c.id=i.customer_id WHERE customer_id=$1`, customer).Scan(&ok)
	return e == nil && ok
}
func CustomerRead(ctx context.Context, tx pgx.Tx, customer, resource, id string, offset int) (any, error) {
	switch resource {
	case "orders":
		if id != "" {
			return OrderRead(ctx, tx, customer, id)
		}
		return jsonRows(ctx, tx, `SELECT `+orderJSON+` FROM issuing_orders WHERE customer_id=$1 ORDER BY created_at DESC,id LIMIT 51 OFFSET $2`, customer, offset)
	case "enrollment":
		var raw json.RawMessage
		e := tx.QueryRow(ctx, `SELECT jsonb_build_object('customerId',c.id,'name',c.name,'enabled',COALESCE(i.enabled,false),'groupId',COALESCE(i.group_id::text,''),'revision',COALESCE(i.revision,0)) FROM customers c LEFT JOIN issuing_customers i ON i.customer_id=c.id WHERE c.id=$1`, customer).Scan(&raw)
		return raw, mapped(e)
	case "deposits":
		return jsonRows(ctx, tx, `SELECT jsonb_build_object('id',id,'amountMinor',amount_minor::text,'evidenceRef',evidence_ref,'submittedBy',submitted_by,'reviewedBy',reviewed_by,'state',state,'revision',revision,'createdAt',created_at) FROM issuing_deposits WHERE customer_id=$1 ORDER BY created_at DESC,id LIMIT 51 OFFSET $2`, customer, offset)
	case "audit":
		return jsonRows(ctx, tx, `SELECT jsonb_build_object('id',id::text,'action',action,'resourceId',resource_id,'detail',detail,'createdAt',created_at) FROM issuing_audit WHERE customer_id=$1 ORDER BY id DESC LIMIT 51 OFFSET $2`, customer, offset)
	}
	return nil, ErrInvalid
}
func Deposit(ctx context.Context, tx pgx.Tx, customer, actor, amount, evidence string) (any, error) {
	if !Money(amount, true) || !textOK(evidence, 300) {
		return nil, ErrInvalid
	}
	id := uuid.NewString()
	_, e := tx.Exec(ctx, `INSERT INTO issuing_deposits(id,customer_id,amount_minor,evidence_ref,submitted_by,state) VALUES($1,$2,$3,$4,$5,'submitted')`, id, customer, amount, evidence, actor)
	return map[string]any{"id": id, "state": "submitted"}, e
}
func ReviewDeposit(ctx context.Context, tx pgx.Tx, customer, actor, id string, revision int64, approve bool) error {
	if !ValidID(id) {
		return ErrInvalid
	}
	state := "rejected"
	if approve {
		state = "approved"
	}
	r, e := tx.Exec(ctx, `UPDATE issuing_deposits SET state=$1,reviewed_by=$2,revision=revision+1 WHERE id=$3 AND customer_id=$4 AND submitted_by<>$2 AND state='submitted' AND revision=$5`, state, actor, id, customer, revision)
	if e == nil && r.RowsAffected() != 1 {
		return ErrConflict
	}
	return e
}
