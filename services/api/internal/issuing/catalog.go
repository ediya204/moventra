package issuing

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func SaveSupplier(ctx context.Context, tx pgx.Tx, p Supplier) (Supplier, error) {
	if !textOK(p.Name, 120) || (p.Adapter != "slash" && p.Adapter != "manual") || (p.Status != "active" && p.Status != "paused" && p.Status != "archived") || len(p.AccountRef) > 180 || len(p.EntityRef) > 180 {
		return p, ErrInvalid
	}
	if e := Lock(ctx, tx, "catalog"); e != nil {
		return p, e
	}
	if p.ID == "" {
		p.ID = uuid.NewString()
		p.Revision = 1
		_, e := tx.Exec(ctx, `INSERT INTO issuing_suppliers(id,name,adapter,status,account_ref,entity_ref) VALUES($1,$2,$3,$4,$5,$6)`, p.ID, p.Name, p.Adapter, p.Status, p.AccountRef, p.EntityRef)
		return p, e
	}
	if !ValidID(p.ID) {
		return p, ErrInvalid
	}
	old, e := supplier(ctx, tx, p.ID)
	if e != nil {
		return p, e
	}
	if old.Revision != p.Revision || old.Status == "archived" {
		return p, ErrConflict
	}
	var used bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_orders WHERE supplier_id=$1)`, p.ID).Scan(&used)
	if e != nil {
		return p, e
	}
	if used && (old.Adapter != p.Adapter || old.AccountRef != p.AccountRef || old.EntityRef != p.EntityRef) {
		return p, ErrConflict
	}
	_, e = tx.Exec(ctx, `UPDATE issuing_suppliers SET name=$2,adapter=$3,status=$4,account_ref=$5,entity_ref=$6,revision=revision+1,updated_at=now() WHERE id=$1`, p.ID, p.Name, p.Adapter, p.Status, p.AccountRef, p.EntityRef)
	p.Revision++
	return p, e
}
func SaveProduct(ctx context.Context, tx pgx.Tx, p Product) (Product, error) {
	if !ValidID(p.SupplierID) || !textOK(p.Name, 120) || !binRE.MatchString(p.BIN) || (p.Network != "" && p.Network != "visa" && p.Network != "mastercard") || !textOK(p.UpstreamID, 180) || len(p.Description) > 2000 || (p.FeeMinor != "" && !Money(p.FeeMinor, false)) || (p.MinimumMinor != "" && !Money(p.MinimumMinor, true)) {
		return p, ErrInvalid
	}
	if p.Status != "draft" && p.Status != "archived" && (p.Network == "" || p.FeeMinor == "" || p.MinimumMinor == "") {
		return p, ErrInvalid
	}
	if p.Status != "draft" && p.Status != "active" && p.Status != "paused" && p.Status != "archived" {
		return p, ErrInvalid
	}
	if e := Lock(ctx, tx, "catalog"); e != nil {
		return p, e
	}
	sp, e := supplier(ctx, tx, p.SupplierID)
	if e != nil {
		return p, e
	}
	if sp.Status == "archived" {
		return p, ErrConflict
	}
	if p.ID == "" {
		p.ID = uuid.NewString()
		p.Revision = 1
		_, e = tx.Exec(ctx, `INSERT INTO issuing_products(id,supplier_id,name,bin,network,upstream_id,status,description,fee_minor,minimum_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,'')::numeric,NULLIF($10,'')::numeric)`, p.ID, p.SupplierID, p.Name, p.BIN, p.Network, p.UpstreamID, p.Status, p.Description, p.FeeMinor, p.MinimumMinor)
		return p, e
	}
	if !ValidID(p.ID) {
		return p, ErrInvalid
	}
	old, e := product(ctx, tx, p.ID)
	if e != nil {
		return p, e
	}
	if old.Revision != p.Revision || old.Status == "archived" {
		return p, ErrConflict
	}
	var sourced bool
	if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_catalog_sources WHERE product_id=$1)`, p.ID).Scan(&sourced); e != nil {
		return p, e
	}
	if sourced && (old.SupplierID != p.SupplierID || old.UpstreamID != p.UpstreamID || old.BIN != p.BIN) {
		return p, ErrConflict
	}
	var used bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_orders WHERE product_id=$1)`, p.ID).Scan(&used)
	if e != nil {
		return p, e
	}
	if used && (old.SupplierID != p.SupplierID || old.BIN != p.BIN || old.Network != p.Network || old.UpstreamID != p.UpstreamID) {
		return p, ErrConflict
	}
	_, e = tx.Exec(ctx, `UPDATE issuing_products SET supplier_id=$2,name=$3,bin=$4,network=$5,upstream_id=$6,status=$7,description=$8,fee_minor=NULLIF($9,'')::numeric,minimum_minor=NULLIF($10,'')::numeric,revision=revision+1,updated_at=now() WHERE id=$1`, p.ID, p.SupplierID, p.Name, p.BIN, p.Network, p.UpstreamID, p.Status, p.Description, p.FeeMinor, p.MinimumMinor)
	p.Revision++
	return p, e
}
func SavePrice(ctx context.Context, tx pgx.Tx, p Price) error {
	if !ValidID(p.ProductID) || !ValidID(p.ScopeID) || (p.ScopeKind != "customer" && p.ScopeKind != "group") || (p.FeeMinor != nil && !Money(*p.FeeMinor, false)) {
		return ErrInvalid
	}
	if e := Lock(ctx, tx, "catalog"); e != nil {
		return e
	}
	var exists bool
	table := "customers"
	if p.ScopeKind == "group" {
		table = "issuing_groups"
	}
	if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM `+table+` WHERE id=$1)`, p.ScopeID).Scan(&exists); e != nil {
		return e
	}
	if !exists {
		return ErrNotFound
	}
	prod, e := product(ctx, tx, p.ProductID)
	if e != nil {
		return e
	}
	if prod.Revision != p.Revision || prod.Status == "archived" {
		return ErrConflict
	}
	if p.FeeMinor == nil {
		_, e = tx.Exec(ctx, `DELETE FROM issuing_prices WHERE product_id=$1 AND scope_kind=$2 AND scope_id=$3`, p.ProductID, p.ScopeKind, p.ScopeID)
	} else {
		_, e = tx.Exec(ctx, `INSERT INTO issuing_prices(product_id,scope_kind,scope_id,fee_minor) VALUES($1,$2,$3,$4) ON CONFLICT(product_id,scope_kind,scope_id) DO UPDATE SET fee_minor=EXCLUDED.fee_minor,revision=issuing_prices.revision+1`, p.ProductID, p.ScopeKind, p.ScopeID, *p.FeeMinor)
	}
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `UPDATE issuing_products SET revision=revision+1 WHERE id=$1`, p.ProductID)
	return e
}
func SaveEnrollment(ctx context.Context, tx pgx.Tx, p Enrollment) error {
	if !ValidID(p.CustomerID) || (p.GroupID != "" && !ValidID(p.GroupID)) {
		return ErrInvalid
	}
	legacyHolder := p.SupplierID != "" || p.CardholderRef != "" || p.EvidenceRef != ""
	if legacyHolder && (!ValidID(p.SupplierID) || !textOK(p.CardholderRef, 180) || !textOK(p.EvidenceRef, 300)) {
		return ErrInvalid
	}
	if e := Lock(ctx, tx, "catalog"); e != nil {
		return e
	}
	if e := Lock(ctx, tx, p.CustomerID); e != nil {
		return e
	}
	var current int64
	e := tx.QueryRow(ctx, `SELECT revision FROM issuing_customers WHERE customer_id=$1`, p.CustomerID).Scan(&current)
	if e != nil && e != pgx.ErrNoRows {
		return e
	}
	if current != p.Revision {
		return ErrConflict
	}
	if legacyHolder {
		var old string
		e = tx.QueryRow(ctx, `SELECT cardholder_ref FROM issuing_cardholders WHERE customer_id=$1 AND supplier_id=$2`, p.CustomerID, p.SupplierID).Scan(&old)
		if e != nil && e != pgx.ErrNoRows {
			return e
		}
		if old != "" && old != p.CardholderRef {
			return ErrConflict
		}
	}
	_, e = tx.Exec(ctx, `INSERT INTO issuing_customers(customer_id,group_id,enabled) VALUES($1,NULLIF($2,'')::uuid,$3) ON CONFLICT(customer_id) DO UPDATE SET group_id=EXCLUDED.group_id,enabled=EXCLUDED.enabled,revision=issuing_customers.revision+1`, p.CustomerID, p.GroupID, p.Enabled)
	if e != nil {
		return e
	}
	if !legacyHolder {
		return nil
	}
	_, e = tx.Exec(ctx, `INSERT INTO issuing_cardholders(customer_id,supplier_id,cardholder_ref,evidence_ref) VALUES($1,$2,$3,$4) ON CONFLICT(customer_id,supplier_id) DO UPDATE SET evidence_ref=EXCLUDED.evidence_ref`, p.CustomerID, p.SupplierID, p.CardholderRef, p.EvidenceRef)
	return e
}
func Group(ctx context.Context, tx pgx.Tx, id, name string, revision int64) (map[string]any, error) {
	if !textOK(name, 120) {
		return nil, ErrInvalid
	}
	if e := Lock(ctx, tx, "catalog"); e != nil {
		return nil, e
	}
	if id == "" {
		id = uuid.NewString()
		_, e := tx.Exec(ctx, `INSERT INTO issuing_groups(id,name) VALUES($1,$2)`, id, name)
		return map[string]any{"id": id, "name": name, "revision": 1}, e
	}
	if !ValidID(id) {
		return nil, ErrInvalid
	}
	r, e := tx.Exec(ctx, `UPDATE issuing_groups SET name=$2,revision=revision+1 WHERE id=$1 AND revision=$3`, id, name, revision)
	if e == nil && r.RowsAffected() != 1 {
		e = ErrConflict
	}
	return map[string]any{"id": id, "name": name, "revision": revision + 1}, e
}
func (s *Service) snapshot(ctx context.Context, tx pgx.Tx, customer, id string) (v Snapshot, blocked string, err error) {
	v.Product, err = product(ctx, tx, id)
	if err != nil {
		return
	}
	v.Supplier, err = supplier(ctx, tx, v.Product.SupplierID)
	if err != nil {
		return
	}
	v.FeeMinor = v.Product.FeeMinor
	v.PriceSource = "default"
	var enabled, active bool
	var group string
	err = tx.QueryRow(ctx, `SELECT COALESCE(i.enabled,false),COALESCE(i.revision,0),COALESCE(i.group_id::text,''),c.service_status='active' AND c.onboarding_status='approved' FROM customers c LEFT JOIN issuing_customers i ON i.customer_id=c.id WHERE c.id=$1`, customer).Scan(&enabled, &v.CustomerRevision, &group, &active)
	if err != nil {
		return
	}
	var price, kind string
	err = tx.QueryRow(ctx, `SELECT fee_minor::text,scope_kind FROM issuing_prices WHERE product_id=$1 AND ((scope_kind='customer' AND scope_id=$2::uuid) OR (scope_kind='group' AND scope_id=NULLIF($3,'')::uuid)) ORDER BY CASE scope_kind WHEN 'customer' THEN 0 ELSE 1 END LIMIT 1`, id, customer, group).Scan(&price, &kind)
	if err == nil {
		v.FeeMinor = price
		v.PriceSource = kind
	} else if err != pgx.ErrNoRows {
		return
	}
	err = nil
	if v.Supplier.Adapter != "slash" {
		e := tx.QueryRow(ctx, `SELECT cardholder_ref FROM issuing_cardholders WHERE customer_id=$1 AND supplier_id=$2`, customer, v.Supplier.ID).Scan(&v.CardholderRef)
		if e != nil && e != pgx.ErrNoRows {
			err = e
			return
		}
	}
	var accessBlocked bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_supplier_blocks WHERE supplier_id=$1)`, v.Supplier.ID).Scan(&accessBlocked); err != nil {
		return
	}
	var sourceInactive bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issuing_catalog_sources WHERE product_id=$1 AND source_status<>'active')`, id).Scan(&sourceInactive); err != nil {
		return
	}
	switch {
	case sourceInactive:
		blocked = "source_product_inactive"
	case !Money(v.FeeMinor, false) || !Money(v.Product.MinimumMinor, true):
		blocked = "product_unconfigured"
	case accessBlocked:
		blocked = "provider_access_blocked"
	case v.Product.Status != "active":
		blocked = "product_" + v.Product.Status
	case v.Supplier.Status != "active":
		blocked = "supplier_" + v.Supplier.Status
	case !enabled || !active:
		blocked = "customer_not_enabled"
	case v.Supplier.Adapter != "slash" && v.CardholderRef == "":
		blocked = "cardholder_not_verified"
	case !s.Enabled || s.Blnk == nil:
		blocked = "execution_disabled"
	case s.Providers[v.Supplier.ID] == nil:
		blocked = "provider_not_verified"
	}
	return
}
func Catalog(ctx context.Context, tx pgx.Tx, resource, id, query, status string, offset int) (any, error) {
	if id != "" && !ValidID(id) {
		return nil, ErrInvalid
	}
	switch resource {
	case "suppliers":
		if id != "" {
			return supplier(ctx, tx, id)
		}
		return jsonRows(ctx, tx, `SELECT jsonb_build_object('id',id,'name',name,'adapter',adapter,'status',status,'accountRef',account_ref,'entityRef',entity_ref,'revision',revision) FROM issuing_suppliers WHERE ($1='' OR name ILIKE '%'||$1||'%') AND ($2='' OR status=$2) ORDER BY created_at DESC,id LIMIT 51 OFFSET $3`, query, status, offset)
	case "products":
		if id != "" {
			p, e := product(ctx, tx, id)
			if e != nil {
				return nil, e
			}
			prices, e := jsonRows(ctx, tx, `SELECT jsonb_build_object('scopeKind',scope_kind,'scopeId',scope_id,'feeMinor',fee_minor::text) FROM issuing_prices WHERE product_id=$1 ORDER BY scope_kind,scope_id LIMIT 501`, id)
			if e != nil {
				return nil, e
			}
			sources, e := jsonRows(ctx, tx, `SELECT jsonb_build_object('prefix',prefix,'status',source_status,'observedAt',observed_at,'evidenceRef',evidence_ref) FROM issuing_catalog_sources WHERE product_id=$1`, id)
			return map[string]any{"product": p, "prices": prices, "sources": sources}, e
		}
		return jsonRows(ctx, tx, `SELECT jsonb_build_object('id',p.id,'supplierId',p.supplier_id,'supplierName',s.name,'name',p.name,'bin',p.bin,'network',p.network,'status',p.status,'feeMinor',COALESCE(p.fee_minor::text,''),'minimumMinor',COALESCE(p.minimum_minor::text,''),'revision',p.revision) FROM issuing_products p JOIN issuing_suppliers s ON s.id=p.supplier_id WHERE ($1='' OR p.name ILIKE '%'||$1||'%' OR p.bin LIKE $1||'%') AND ($2='' OR p.status=$2) ORDER BY p.created_at DESC,p.id LIMIT 51 OFFSET $3`, query, status, offset)
	case "groups":
		if id != "" {
			var raw json.RawMessage
			e := tx.QueryRow(ctx, `SELECT jsonb_build_object('id',id,'name',name,'revision',revision) FROM issuing_groups WHERE id=$1`, id).Scan(&raw)
			return raw, mapped(e)
		}
		return jsonRows(ctx, tx, `SELECT jsonb_build_object('id',id,'name',name,'revision',revision) FROM issuing_groups WHERE ($1='' OR name ILIKE '%'||$1||'%') ORDER BY name,id LIMIT 51 OFFSET $2`, query, offset)
	case "audit":
		return jsonRows(ctx, tx, `SELECT jsonb_build_object('id',id::text,'actorId',actor_id,'resourceId',resource_id,'action',action,'detail',detail,'createdAt',created_at) FROM issuing_audit WHERE customer_id IS NULL AND ($1='' OR resource_id=$1) ORDER BY id DESC LIMIT 51 OFFSET $2`, query, offset)
	}
	return nil, ErrInvalid
}
func (s *Service) ClientProducts(ctx context.Context, tx pgx.Tx, customer, q string, offset int) ([]map[string]any, error) {
	ids, e := jsonRows(ctx, tx, `SELECT to_jsonb(id::text) FROM issuing_products WHERE status IN ('active','paused') AND ($1='' OR name ILIKE '%'||$1||'%' OR bin LIKE $1||'%') ORDER BY created_at DESC,id LIMIT 51 OFFSET $2`, q, offset)
	if e != nil {
		return nil, e
	}
	out := []map[string]any{}
	for _, raw := range ids {
		var id string
		_ = json.Unmarshal(raw, &id)
		v, b, e := s.snapshot(ctx, tx, customer, id)
		if e != nil {
			return nil, e
		}
		out = append(out, map[string]any{"id": id, "name": v.Product.Name, "bin": v.Product.BIN, "network": v.Product.Network, "description": v.Product.Description, "status": v.Product.Status, "feeMinor": v.FeeMinor, "minimumMinor": v.Product.MinimumMinor, "currency": "USD", "blockedReason": b, "revision": v.Product.Revision})
	}
	return out, nil
}
