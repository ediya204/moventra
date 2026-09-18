package issuing

import (
	"context"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

type CatalogSourceItem struct {
	ID     string `json:"id"`
	Prefix string `json:"prefix"`
	Status string `json:"status"`
}
type CatalogImport struct {
	ActorID      string              `json:"actorId"`
	SupplierID   string              `json:"supplierId"`
	SupplierName string              `json:"supplierName"`
	AccountRef   string              `json:"accountRef"`
	EntityRef    string              `json:"entityRef"`
	EvidenceRef  string              `json:"evidenceRef"`
	CollectedAt  time.Time           `json:"collectedAt"`
	Complete     bool                `json:"complete"`
	Items        []CatalogSourceItem `json:"items"`
}

// ImportCatalog atomically stages source facts and unpriced drafts. It never publishes,
// resets commercial settings, or replaces a source mapping. Absent items are retained.
func ImportCatalog(ctx context.Context, db *pgxpool.Pool, v CatalogImport) (int, error) {
	if !ValidID(v.ActorID) || !ValidID(v.SupplierID) || !textOK(v.SupplierName, 120) || !textOK(v.EvidenceRef, 300) || len(v.AccountRef) > 180 || len(v.EntityRef) > 180 || !v.Complete || len(v.Items) == 0 || len(v.Items) > 10000 || v.CollectedAt.IsZero() || v.CollectedAt.After(time.Now().Add(5*time.Minute)) {
		return 0, ErrInvalid
	}
	seen := map[string]bool{}
	for _, p := range v.Items {
		if !textOK(p.ID, 180) || !binRE.MatchString(p.Prefix) || (p.Status != "active" && p.Status != "inactive") || seen[p.ID] {
			return 0, ErrInvalid
		}
		seen[p.ID] = true
	}
	tx, e := db.Begin(ctx)
	if e != nil {
		return 0, e
	}
	defer tx.Rollback(ctx)
	if e = Lock(ctx, tx, "catalog"); e != nil {
		return 0, e
	}
	var allowed bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users u JOIN effective_issuing_grants g ON g.user_id=u.id WHERE u.id=$1 AND u.role='admin' AND u.status='active' AND g.scope_id='catalog' AND g.permission='catalog:write')`, v.ActorID).Scan(&allowed)
	if e != nil {
		return 0, e
	}
	if !allowed {
		return 0, ErrForbidden
	}
	old, e := supplier(ctx, tx, v.SupplierID)
	if e == ErrNotFound {
		_, e = tx.Exec(ctx, `INSERT INTO issuing_suppliers(id,name,adapter,status,account_ref,entity_ref) VALUES($1,$2,'slash','paused',$3,$4)`, v.SupplierID, v.SupplierName, v.AccountRef, v.EntityRef)
	} else if e == nil && (old.Adapter != "slash" || old.AccountRef != v.AccountRef || old.EntityRef != v.EntityRef || old.Status == "archived") {
		return 0, ErrConflict
	}
	if e != nil {
		return 0, e
	}
	created := 0
	for _, p := range v.Items {
		var productID, prefix, status string
		var observed time.Time
		e = tx.QueryRow(ctx, `SELECT product_id::text,prefix,source_status,observed_at FROM issuing_catalog_sources WHERE supplier_id=$1 AND upstream_id=$2`, v.SupplierID, p.ID).Scan(&productID, &prefix, &status, &observed)
		if e == pgx.ErrNoRows {
			productID = uuid.NewString()
			_, e = tx.Exec(ctx, `INSERT INTO issuing_products(id,supplier_id,name,bin,network,upstream_id,status,fee_minor,minimum_minor) VALUES($1,$2,$3,$4,'',$5,'draft',NULL,NULL)`, productID, v.SupplierID, "Slash "+p.Prefix, p.Prefix, p.ID)
			if e != nil {
				return 0, e
			}
			created++
		} else if e != nil {
			return 0, e
		} else {
			if prefix != p.Prefix || v.CollectedAt.Before(observed) {
				return 0, ErrConflict
			}
			if status != p.Status {
				if _, e = tx.Exec(ctx, `UPDATE issuing_products SET revision=revision+1,updated_at=now() WHERE id=$1`, productID); e != nil {
					return 0, e
				}
			}
		}
		_, e = tx.Exec(ctx, `INSERT INTO issuing_catalog_sources(supplier_id,upstream_id,prefix,source_status,product_id,observed_at,evidence_ref) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(supplier_id,upstream_id) DO UPDATE SET source_status=EXCLUDED.source_status,observed_at=EXCLUDED.observed_at,evidence_ref=EXCLUDED.evidence_ref`, v.SupplierID, p.ID, p.Prefix, p.Status, productID, v.CollectedAt, v.EvidenceRef)
		if e != nil {
			return 0, e
		}
	}
	if e = Audit(ctx, tx, v.ActorID, "", v.SupplierID, "catalog.import", v); e != nil {
		return 0, e
	}
	return created, tx.Commit(ctx)
}
