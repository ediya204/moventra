package cryptofunds

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"io"
	"moventra.local/api/internal/cregis"
	"moventra.local/api/internal/tron"
	"net/http"
	"strings"
	"time"
)

// Source is observation-only even when attached to a shadow Service.
// It never resolves customer ownership and never invokes the ledger.
type Source struct {
	Service                  *Service
	Client                   *cregis.Client
	Connection, Project, Key string
	Node                     *tron.Client
	Contract                 string
	Network                  string
}

func (src *Source) store(ctx context.Context, tx pgx.Tx, kind, id string, payload any) error {
	raw, e := json.Marshal(payload)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO crypto_events(id,namespace,connection_id,project_id,kind,external_id,digest,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(namespace,connection_id,project_id,kind,external_id,digest) DO UPDATE SET deliveries=crypto_events.deliveries+1,updated_at=now()`, uuid.NewString(), src.Service.NS(), src.Connection, src.Project, kind, id, digest(payload), raw)
	return e
}
func (src *Source) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		prefix := "/webhooks/cregis/"
		if !strings.HasPrefix(r.URL.Path, prefix) {
			next.ServeHTTP(w, r)
			return
		}
		kind := cregis.CallbackKind(strings.TrimPrefix(r.URL.Path, prefix))
		if r.Method != "POST" || kind != cregis.Deposit && kind != cregis.Payout {
			http.NotFound(w, r)
			return
		}
		raw, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
		if e != nil {
			http.Error(w, "invalid", 400)
			return
		}
		observation, e := cregis.VerifyCallback(src.Key, src.Project, kind, raw)
		if e != nil {
			http.Error(w, "invalid", 400)
			return
		}
		// Never persist authentication material. A digest deduplicates semantically
		// identical deliveries even when nonce and timestamp change on a retry.
		delete(observation.Fields, "sign")
		delete(observation.Fields, "nonce")
		delete(observation.Fields, "timestamp")
		tx, e := src.Service.Ledger.DB.Begin(r.Context())
		if e != nil {
			http.Error(w, "unavailable", 503)
			return
		}
		defer tx.Rollback(r.Context())
		e = src.store(r.Context(), tx, string(kind), observation.EventID, observation.Fields)
		if e == nil {
			e = tx.Commit(r.Context())
		}
		if e != nil {
			http.Error(w, "unavailable", 503)
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(200)
		_, _ = w.Write([]byte("success"))
	})
}

// SyncPage serializes this connection across processes. The persisted next call
// time coordinates provider rate limits, while cursor and records commit together.
func (src *Source) SyncPage(ctx context.Context) error {
	s := src.Service
	tx, e := s.Ledger.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "cregis-project:"+src.Project)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO crypto_sync(namespace,connection_id,project_id,mode) VALUES($1,$2,$3,'observation') ON CONFLICT DO NOTHING`, s.NS(), src.Connection, src.Project)
	if e != nil {
		return e
	}
	var page int
	var next time.Time
	e = tx.QueryRow(ctx, `SELECT page,GREATEST(next_attempt,(SELECT max(next_attempt) FROM crypto_sync WHERE project_id=$3)) FROM crypto_sync WHERE namespace=$1 AND connection_id=$2 AND project_id=$3 FOR UPDATE`, s.NS(), src.Connection, src.Project).Scan(&page, &next)
	if e != nil {
		return e
	}
	if time.Now().Before(next) {
		return nil
	}
	p, callErr := src.Client.ListTrades(ctx, cregis.TradeQuery{Page: page, PageSize: 100})
	state := "syncing"
	message := ""
	delay := "3 seconds"
	if callErr != nil {
		state = "error"
		message = "cregis_query_failed"
		delay = "30 seconds"
	} else {
		for _, row := range p.Rows {
			if e = src.store(ctx, tx, "trade", row.ID.String(), row); e != nil {
				return e
			}
		}
		total, _ := p.Total.Int64()
		if int64(page*100) >= total {
			page = 1
			state = "partial"
			delay = "60 seconds"
		} else {
			page++
		}
	}
	// Re-scan from the beginning after each bounded pass; page-based provider data
	// is mutable, so no full-history completeness claim is made.
	_, e = tx.Exec(ctx, `UPDATE crypto_sync SET page=$1,state=$2,error=$3,next_attempt=now()+$4::interval,last_success=CASE WHEN $3='' THEN now() ELSE last_success END,generation=generation+CASE WHEN $1=1 AND $3='' THEN 1 ELSE 0 END WHERE namespace=$5 AND connection_id=$6 AND project_id=$7`, page, state, message, delay, s.NS(), src.Connection, src.Project)
	if e != nil {
		return e
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	return callErr
}

// VerifyObservations records evidence only. Historical live deposits are never
// converted to customer credits, even when their on-chain proof is complete.
func (src *Source) VerifyObservations(ctx context.Context) error {
	if src.Node == nil || src.Contract == "" || src.Network == "" {
		return nil
	}
	rows, e := src.Service.Ledger.DB.Query(ctx, `SELECT id::text,payload,kind FROM crypto_events WHERE namespace=$1 AND connection_id=$2 AND project_id=$3 AND state='received' AND ($4=false OR kind='trade') ORDER BY updated_at,id LIMIT 10`, src.Service.NS(), src.Connection, src.Project, src.Service.Live != nil)
	if e != nil {
		return e
	}
	type event struct {
		id   string
		data []byte
		kind string
	}
	var events []event
	for rows.Next() {
		var ev event
		if e = rows.Scan(&ev.id, &ev.data, &ev.kind); e != nil {
			rows.Close()
			return e
		}
		events = append(events, ev)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, ev := range events {
		var f map[string]json.RawMessage
		if json.Unmarshal(ev.data, &f) != nil {
			continue
		}
		get := func(k string) string { var v string; _ = json.Unmarshal(f[k], &v); return v }
		address := get("address")
		if ev.kind == "trade" {
			address = get("to_address")
		}
		state, reason := "review_required", "unsupported_asset_or_event"
		var proof tron.Proof
		if get("chain_id") == "195" && get("token_id") == src.Contract && get("txid") != "" {
			amount, err := DecimalMinor(get("amount"), 6)
			if err == nil {
				proof, err = src.Node.Verify(ctx, get("txid"), src.Contract, address, amount)
			}
			if err == nil {
				state = "verified_observation"
				reason = "unassigned_not_posted"
			} else {
				reason = "chain_evidence_pending"
				state = "received"
			}
		}
		tx, err := src.Service.Ledger.DB.Begin(ctx)
		if err != nil {
			return err
		}
		if state == "verified_observation" {
			raw, _ := json.Marshal(proof)
			_, e = tx.Exec(ctx, `INSERT INTO crypto_chain_proofs(event_id,network,proof) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, ev.id, src.Network, raw)
		}
		if e == nil {
			_, e = tx.Exec(ctx, `UPDATE crypto_events SET state=$1,error=$2,updated_at=now() WHERE id=$3`, state, reason, ev.id)
		}
		if e == nil {
			e = tx.Commit(ctx)
		}
		_ = tx.Rollback(ctx)
		if e != nil {
			return e
		}
	}
	return nil
}
func DecimalMinor(v string, scale int) (string, error) {
	parts := strings.Split(v, ".")
	if len(parts) > 2 || len(parts) == 0 || parts[0] == "" {
		return "", invalid("invalid_amount")
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
		if fraction == "" {
			return "", invalid("invalid_amount")
		}
	}
	if len(fraction) > scale {
		return "", invalid("invalid_precision")
	}
	n := parts[0] + fraction + strings.Repeat("0", scale-len(fraction))
	n = strings.TrimLeft(n, "0")
	if n == "" {
		n = "0"
	}
	if _, e := number(n, false); e != nil {
		return "", e
	}
	return n, nil
}
