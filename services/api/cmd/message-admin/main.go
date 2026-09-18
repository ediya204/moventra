// message-admin is an explicit operations CLI; it never migrates or enables
// production automatically. Read JSON from stdin so identifiers need not be
// embedded in shell history. Database credentials remain in DATABASE_URL.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"moventra.local/api/internal/database"
	"os"
	"time"
)

func run() error {
	var in struct {
		Action     string `json:"action"`
		Namespace  string `json:"namespace"`
		Operator   string `json:"operatorUid"`
		User       string `json:"userUid"`
		Customer   string `json:"customerId"`
		Permission string `json:"permission"`
		OTC        bool   `json:"otcEnabled"`
		Job        string `json:"jobId"`
		Evidence   string `json:"evidence"`
	}
	d := json.NewDecoder(io.LimitReader(os.Stdin, 8192))
	d.DisallowUnknownFields()
	if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF || in.Namespace == "" || len(in.Namespace) > 100 || in.Operator == "" || len(in.Evidence) < 3 || len(in.Evidence) > 300 {
		return errors.New("explicit_action_namespace_operator_and_evidence_required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cfg, e := database.PoolConfig(os.Getenv("DATABASE_URL"), "2")
	if e != nil {
		return e
	}
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		return errors.New("database_unavailable")
	}
	defer db.Close()
	tx, e := db.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var actor string
	e = tx.QueryRow(ctx, `SELECT id::text FROM users WHERE firebase_uid=$1 AND role='admin' AND status='active' AND is_global_admin(id)`, in.Operator).Scan(&actor)
	if e != nil {
		return errors.New("active_global_operator_required")
	}
	switch in.Action {
	case "configure":
		_, e = tx.Exec(ctx, `INSERT INTO message_namespaces(namespace,otc_enabled) VALUES($1,$2) ON CONFLICT(namespace) DO UPDATE SET otc_enabled=excluded.otc_enabled`, in.Namespace, in.OTC)
	case "grant", "revoke":
		if _, err := uuid.Parse(in.Customer); err != nil {
			return errors.New("customer_required")
		}
		if in.Permission != "read" && in.Permission != "compose" && in.Permission != "publish" && in.Permission != "retry" {
			return errors.New("invalid_permission")
		}
		var user string
		e = tx.QueryRow(ctx, `SELECT id::text FROM users WHERE firebase_uid=$1 AND role='admin' AND status='active'`, in.User).Scan(&user)
		if e != nil {
			return errors.New("active_admin_required")
		}
		if in.Action == "grant" {
			_, e = tx.Exec(ctx, `INSERT INTO message_grants(namespace,user_id,customer_id,permission) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, in.Namespace, user, in.Customer, in.Permission)
		} else {
			_, e = tx.Exec(ctx, `DELETE FROM message_grants WHERE namespace=$1 AND user_id=$2 AND customer_id=$3 AND permission=$4`, in.Namespace, user, in.Customer, in.Permission)
		}
	case "retry":
		if _, err := uuid.Parse(in.Job); err != nil {
			return errors.New("job_required")
		}
		var count int64
		tag, err := tx.Exec(ctx, `UPDATE message_jobs SET state='pending',attempts=0,next_attempt_at=now() WHERE namespace=$1 AND id=$2 AND state='failed' AND campaign_id IS NULL`, in.Namespace, in.Job)
		e = err
		if e == nil {
			count = tag.RowsAffected()
			if count != 1 {
				return errors.New("failed_automatic_job_required")
			}
		}
	case "status":
		rows, err := tx.Query(ctx, `SELECT state,count(*),COALESCE(EXTRACT(EPOCH FROM now()-min(created_at)),0)::bigint FROM message_jobs WHERE namespace=$1 GROUP BY state`, in.Namespace)
		if err != nil {
			return err
		}
		items := []map[string]any{}
		for rows.Next() {
			var state string
			var count, age int64
			if e = rows.Scan(&state, &count, &age); e != nil {
				break
			}
			items = append(items, map[string]any{"state": state, "count": count, "oldestAgeSeconds": age})
		}
		if e == nil {
			e = rows.Err()
		}
		rows.Close()
		if e != nil {
			return e
		}
		if e = json.NewEncoder(os.Stdout).Encode(items); e != nil {
			return e
		}
	default:
		return errors.New("unknown_action")
	}
	if e != nil {
		return errors.New("message_admin_action_failed")
	}
	// Structured, non-secret operational evidence; no message body or credentials.
	details, _ := json.Marshal(map[string]any{"action": in.Action, "userUid": in.User, "customerId": in.Customer, "permission": in.Permission, "otcEnabled": in.OTC, "jobId": in.Job, "evidence": in.Evidence})
	_, e = tx.Exec(ctx, `INSERT INTO message_audit(namespace,actor_id,action,details) VALUES($1,$2,$3,$4)`, in.Namespace, actor, "admin:"+in.Action, details)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
