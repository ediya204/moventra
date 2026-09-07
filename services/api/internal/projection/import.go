// Package projection imports only approved, sanitized read-only observations.
package projection

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"regexp"
	"time"
)

type Bundle struct {
	ConnectionID string   `json:"connectionId"`
	AccountID    string   `json:"accountId"`
	Label        string   `json:"label"`
	SourceAt     string   `json:"sourceAt"`
	Records      []Record `json:"records"`
}
type Record struct {
	Kind string         `json:"kind"`
	Data map[string]any `json:"data"`
}

var identifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,160}$`)
var integer = regexp.MustCompile(`^(0|-?[1-9][0-9]{0,37})$`)
var fields = map[string]bool{}

func init() {
	for _, k := range []string{"id", "accountId", "cardId", "cardName", "cardLast4", "name", "last4", "cardStatus", "createdAtUTC", "status", "detailedStatus", "date", "authorizedAt", "postedAt", "merchant", "categoryCode", "amountCents", "originalCurrency", "merchantData"} {
		fields[k] = true
	}
}
func Validate(b Bundle) error {
	if !identifier.MatchString(b.ConnectionID) || !identifier.MatchString(b.AccountID) || len(b.Label) == 0 || len(b.Label) > 100 || len(b.Records) == 0 || len(b.Records) > 50000 {
		return fmt.Errorf("invalid bundle scope")
	}
	if _, e := time.Parse(time.RFC3339Nano, b.SourceAt); e != nil {
		return fmt.Errorf("invalid source time")
	}
	seen := map[string]bool{}
	for _, r := range b.Records {
		if r.Kind != "card" && r.Kind != "transaction" {
			return fmt.Errorf("invalid resource")
		}
		id, ok := r.Data["id"].(string)
		if !ok || !identifier.MatchString(id) || seen[r.Kind+":"+id] {
			return fmt.Errorf("invalid or duplicate identity")
		}
		seen[r.Kind+":"+id] = true
		if r.Data["accountId"] != b.AccountID {
			return fmt.Errorf("outside source account")
		}
		for k, v := range r.Data {
			if !fields[k] {
				return fmt.Errorf("field not allowed: %s", k)
			}
			if v == nil {
				continue
			}
			switch k {
			case "originalCurrency":
				m, ok := v.(map[string]any)
				if !ok {
					return fmt.Errorf("invalid originalCurrency")
				}
				for key, x := range m {
					if key != "code" && key != "amountCents" && key != "conversionRate" {
						return fmt.Errorf("invalid original field")
					}
					if x == nil {
						continue
					}
					str, ok := x.(string)
					if !ok || len(str) > 100 {
						return fmt.Errorf("invalid original value")
					}
					if key == "amountCents" && !integer.MatchString(str) {
						return fmt.Errorf("invalid original amount")
					}
				}
			case "merchantData":
				m, ok := v.(map[string]any)
				if !ok {
					return fmt.Errorf("invalid merchant")
				}
				for key, x := range m {
					if key == "location" {
						if x == nil {
							continue
						}
						loc, ok := x.(map[string]any)
						if !ok {
							return fmt.Errorf("invalid location")
						}
						for field, z := range loc {
							if field != "city" && field != "state" && field != "zip" && field != "country" {
								return fmt.Errorf("invalid location field")
							}
							if z != nil {
								str, ok := z.(string)
								if !ok || len(str) > 500 {
									return fmt.Errorf("invalid location value")
								}
							}
						}
					} else {
						if key != "description" && key != "categoryCode" {
							return fmt.Errorf("invalid merchant field")
						}
						if x != nil {
							str, ok := x.(string)
							if !ok || len(str) > 500 {
								return fmt.Errorf("invalid merchant value")
							}
						}
					}
				}
			default:
				str, ok := v.(string)
				if !ok || len(str) > 500 {
					return fmt.Errorf("invalid string")
				}
				if k == "amountCents" && !integer.MatchString(str) {
					return fmt.Errorf("invalid amount")
				}
				if (k == "last4" || k == "cardLast4") && !regexp.MustCompile(`^[0-9]{4}$`).MatchString(str) {
					return fmt.Errorf("invalid last four")
				}
				if k == "date" || k == "postedAt" || k == "authorizedAt" || k == "createdAtUTC" {
					if _, e := time.Parse(time.RFC3339Nano, str); e != nil {
						return fmt.Errorf("invalid time")
					}
				}
			}
		}
		if r.Kind == "transaction" {
			card, ok := r.Data["cardId"].(string)
			if !ok || !identifier.MatchString(card) {
				return fmt.Errorf("not a card transaction")
			}
		}
	}
	return nil
}

// Import requires an explicitly chosen existing operator. It does not create
// users/customer ownership, infer permission from a display name, or move funds.
func Import(ctx context.Context, db *pgxpool.Pool, b Bundle, operatorUID string) (string, error) {
	if err := Validate(b); err != nil {
		return "", err
	}
	if operatorUID == "" {
		return "", fmt.Errorf("explicit operator required")
	}
	raw, _ := json.Marshal(b)
	hash := sha256.Sum256(raw)
	revision := hex.EncodeToString(hash[:])
	tx, e := db.Begin(ctx)
	if e != nil {
		return "", e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73019002)`); e != nil {
		return "", e
	}
	var actor string
	e = tx.QueryRow(ctx, `SELECT id::text FROM users u WHERE firebase_uid=$1 AND status='active' AND EXISTS(SELECT 1 FROM staff_grants g WHERE g.user_id=u.id)`, operatorUID).Scan(&actor)
	if e != nil {
		return "", fmt.Errorf("existing active operator required")
	}
	_, e = tx.Exec(ctx, `INSERT INTO channel_connections(id,account_ref,label) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, b.ConnectionID, b.AccountID, b.Label)
	if e != nil {
		return "", e
	}
	var account string
	var at *time.Time
	if e = tx.QueryRow(ctx, `SELECT account_ref,source_at FROM channel_connections WHERE id=$1 FOR UPDATE`, b.ConnectionID).Scan(&account, &at); e != nil {
		return "", e
	}
	stamp, _ := time.Parse(time.RFC3339Nano, b.SourceAt)
	if account != b.AccountID || (at != nil && stamp.Before(*at)) {
		return "", fmt.Errorf("account mismatch or stale import")
	}
	result, e := tx.Exec(ctx, `INSERT INTO channel_imports(connection_id,revision,source_at,actor_id,record_count) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, b.ConnectionID, revision, stamp, actor, len(b.Records))
	if e != nil {
		return "", e
	}
	if result.RowsAffected() > 0 {
		rows := make([][]any, 0, len(b.Records))
		for _, r := range b.Records {
			data, _ := json.Marshal(r.Data)
			rows = append(rows, []any{b.ConnectionID, revision, r.Kind, r.Data["id"], string(data)})
		}
		if _, e = tx.CopyFrom(ctx, pgx.Identifier{"channel_records"}, []string{"connection_id", "revision", "kind", "external_id", "data"}, pgx.CopyFromRows(rows)); e != nil {
			return "", e
		}
		if _, e = tx.Exec(ctx, `UPDATE channel_connections SET revision=$2,source_at=$3,imported_at=now() WHERE id=$1`, b.ConnectionID, revision, stamp); e != nil {
			return "", e
		}
	}
	if _, e = tx.Exec(ctx, `INSERT INTO channel_read_grants VALUES($1,$2) ON CONFLICT DO NOTHING`, b.ConnectionID, actor); e != nil {
		return "", e
	}
	if _, e = tx.Exec(ctx, `INSERT INTO channel_read_audit(connection_id,actor_id,action,revision) VALUES($1,$2,'projection:manual-import',$3)`, b.ConnectionID, actor, revision); e != nil {
		return "", e
	}
	return revision, tx.Commit(ctx)
}
