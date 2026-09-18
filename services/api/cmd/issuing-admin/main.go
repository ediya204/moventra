// Trusted provisioning utility. No HTTP endpoint can grant financial permissions.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/issuing"
	"os"
	"time"
)

func run() error {
	if len(os.Args) == 2 && os.Args[1] == "import-catalog" {
		var v issuing.CatalogImport
		d := json.NewDecoder(io.LimitReader(os.Stdin, 4<<20))
		d.DisallowUnknownFields()
		if d.Decode(&v) != nil || d.Decode(new(any)) != io.EOF {
			return errors.New("invalid_catalog_import")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cfg, e := database.PoolConfig(os.Getenv("DATABASE_URL"), os.Getenv("DB_MAX_CONNS"))
		if e != nil {
			return e
		}
		db, e := pgxpool.NewWithConfig(ctx, cfg)
		if e != nil {
			return e
		}
		defer db.Close()
		n, e := issuing.ImportCatalog(ctx, db, v)
		if e != nil {
			return e
		}
		fmt.Printf("catalog imported: %d source products, %d new drafts\n", len(v.Items), n)
		return nil
	}

	if len(os.Args) != 2 || (os.Args[1] != "grant" && os.Args[1] != "resume-supplier") {
		return errors.New("usage: issuing-admin [grant|resume-supplier|import-catalog] < reviewed-input.json")
	}
	var v struct {
		ActorID     string `json:"actorId"`
		UserID      string `json:"userId"`
		ScopeID     string `json:"scopeId"`
		Permission  string `json:"permission"`
		EvidenceRef string `json:"evidenceRef"`
		Revoke      bool   `json:"revoke"`
	}
	d := json.NewDecoder(io.LimitReader(os.Stdin, 8192))
	d.DisallowUnknownFields()
	if d.Decode(&v) != nil || d.Decode(new(any)) != io.EOF || !issuing.ValidID(v.ActorID) || !issuing.ValidID(v.UserID) || v.EvidenceRef == "" || len(v.EvidenceRef) > 300 {
		return errors.New("invalid_grant")
	}
	resume := os.Args[1] == "resume-supplier"
	if resume && !issuing.ValidID(v.ScopeID) {
		return errors.New("invalid_supplier")
	}
	catalog := v.Permission == "catalog:read" || v.Permission == "catalog:write" || v.Permission == "pricing:write"
	customer := v.Permission == "customer:read" || v.Permission == "customer:write" || v.Permission == "funding:submit" || v.Permission == "funding:review" || v.Permission == "recovery:write"
	if !resume && (catalog && v.ScopeID != "catalog" || customer && !issuing.ValidID(v.ScopeID) || !catalog && !customer) {
		return errors.New("invalid_grant_scope")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cfg, e := database.PoolConfig(os.Getenv("DATABASE_URL"), os.Getenv("DB_MAX_CONNS"))
	if e != nil {
		return e
	}
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		return e
	}
	defer db.Close()
	tx, e := db.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	for _, id := range []string{v.ActorID, v.UserID} {
		var ok bool
		e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND role='admin' AND status='active')`, id).Scan(&ok)
		if e != nil {
			return e
		}
		if !ok {
			return errors.New("active_admin_required")
		}
	}
	if resume {
		tag, e := tx.Exec(ctx, `DELETE FROM issuing_supplier_blocks WHERE supplier_id=$1`, v.ScopeID)
		if e != nil {
			return e
		}
		if tag.RowsAffected() != 1 {
			return errors.New("supplier_not_blocked")
		}
		if e = issuing.Audit(ctx, tx, v.ActorID, "", v.ScopeID, "supplier.resume", v); e != nil {
			return e
		}
		return tx.Commit(ctx)
	}
	if customer {
		var ok bool
		e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM customers WHERE id=$1)`, v.ScopeID).Scan(&ok)
		if e != nil {
			return e
		}
		if !ok {
			return errors.New("customer_not_found")
		}
	}
	if v.Revoke {
		_, e = tx.Exec(ctx, `DELETE FROM issuing_grants WHERE user_id=$1 AND scope_id=$2 AND permission=$3`, v.UserID, v.ScopeID, v.Permission)
	} else {
		_, e = tx.Exec(ctx, `INSERT INTO issuing_grants VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, v.UserID, v.ScopeID, v.Permission)
	}
	if e != nil {
		return e
	}
	scope := ""
	if customer {
		scope = v.ScopeID
	}
	if e = issuing.Audit(ctx, tx, v.ActorID, scope, v.UserID, "permission.provision", v); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, "grant failed; validate input, administrator identities and database configuration")
		os.Exit(1)
	}
	fmt.Println("operation recorded with audit")
}
