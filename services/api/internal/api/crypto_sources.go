package api

import (
	"encoding/json"
	"github.com/google/uuid"
	"net/http"
	"strconv"
)

func (s *Server) cryptoSourceAPI(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	if !p.Identity.MFA {
		fail(w, 403, "mfa_required")
		return
	}
	svc, e := s.fundsReadService()
	if e != nil {
		fail(w, 503, "crypto_disabled")
		return
	}
	ctx := r.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		cryptoFail(w, e)
		return
	}
	defer tx.Rollback(ctx)
	connection := r.PathValue("connection")
	permission := "read"
	if r.Method == "POST" {
		permission = "sync"
		if _, e = uuid.Parse(r.Header.Get("Idempotency-Key")); e != nil {
			fail(w, 400, "idempotency_key_required")
			return
		}
	}
	if connection != "" {
		var allowed bool
		e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM crypto_connection_grants WHERE namespace=$1 AND connection_id=$2 AND user_id=$3 AND permission=$4)`, svc.NS(), connection, p.ID, permission).Scan(&allowed)
		if e != nil {
			cryptoFail(w, e)
			return
		}
		if !allowed {
			fail(w, 404, "not_found")
			return
		}
	}
	eventID := r.PathValue("eventID")
	if eventID != "" {
		if _, err := uuid.Parse(eventID); err != nil {
			fail(w, 400, "invalid_event_id")
			return
		}
	}
	page := 0
	for k, v := range r.URL.Query() {
		if eventID != "" || r.Method != "GET" || connection == "" || k != "page" || len(v) != 1 {
			fail(w, 400, "invalid_query")
			return
		}
		page, e = strconv.Atoi(v[0])
		if e != nil || page < 0 || page > 500 {
			fail(w, 400, "invalid_query")
			return
		}
	}
	var out any
	if connection == "" {
		if r.URL.RawQuery != "" {
			fail(w, 400, "invalid_query")
			return
		}
		rows, err := tx.Query(ctx, `SELECT g.connection_id,COALESCE(s.state,'never_synced'),s.last_success,COALESCE(s.error,''),COALESCE(s.page,1),COALESCE(s.generation,0) FROM crypto_connection_grants g LEFT JOIN crypto_sync s ON s.namespace=g.namespace AND s.connection_id=g.connection_id WHERE g.namespace=$1 AND g.user_id=$2 AND g.permission='read' ORDER BY g.connection_id LIMIT 101`, svc.NS(), p.ID)
		if err != nil {
			cryptoFail(w, err)
			return
		}
		list := []map[string]any{}
		for rows.Next() {
			var id, state, reason string
			var at any
			var cursor, generation int64
			if e = rows.Scan(&id, &state, &at, &reason, &cursor, &generation); e != nil {
				break
			}
			list = append(list, map[string]any{"id": id, "state": state, "lastSuccess": at, "error": reason, "page": cursor, "generation": generation, "coverage": "bounded_rescans_not_full_history", "mode": "observation"})
		}
		if e == nil {
			e = rows.Err()
		}
		rows.Close()
		if len(list) > 100 {
			fail(w, 503, "source_capacity_exceeded")
			return
		}
		out = list
	} else if r.Method == "POST" {
		tag, err := tx.Exec(ctx, `UPDATE crypto_sync SET state='queued' WHERE namespace=$1 AND connection_id=$2`, svc.NS(), connection)
		e = err
		if e == nil && tag.RowsAffected() == 0 {
			fail(w, 409, "source_not_initialized")
			return
		}
		out = map[string]string{"state": "queued"}
	} else {
		var total int
		e = tx.QueryRow(ctx, `SELECT count(*) FROM crypto_events WHERE namespace=$1 AND connection_id=$2`, svc.NS(), connection).Scan(&total)
		if e != nil {
			cryptoFail(w, e)
			return
		}
		rows, err := tx.Query(ctx, `SELECT id::text,external_id,kind,state,error,payload,received_at,deliveries FROM crypto_events WHERE namespace=$1 AND connection_id=$2 AND ($4='' OR id::text=$4) ORDER BY received_at DESC,id LIMIT 20 OFFSET $3`, svc.NS(), connection, page*20, eventID)
		if err != nil {
			cryptoFail(w, err)
			return
		}
		list := []map[string]any{}
		for rows.Next() {
			var id, external, kind, state, reason string
			var raw []byte
			var at any
			var deliveries int
			if e = rows.Scan(&id, &external, &kind, &state, &reason, &raw, &at, &deliveries); e != nil {
				break
			}
			var fields map[string]json.RawMessage
			if e = json.Unmarshal(raw, &fields); e != nil {
				break
			}
			dto := map[string]any{"id": id, "externalId": external, "kind": kind, "state": state, "error": reason, "receivedAt": at, "deliveries": deliveries}
			for _, key := range []string{"chain_id", "token_id", "amount", "currency", "address", "from_address", "to_address", "txid", "fee", "status", "block_time", "block_height", "trade_type", "business_type", "third_party_id"} {
				if raw, ok := fields[key]; ok {
					var value string
					if json.Unmarshal(raw, &value) != nil {
						value = string(raw)
					}
					dto[key] = value
				}
			}
			list = append(list, dto)
		}
		if e == nil {
			e = rows.Err()
		}
		rows.Close()
		if eventID != "" {
			if len(list) == 0 {
				fail(w, 404, "not_found")
				return
			}
			out = list[0]
		} else {
			out = map[string]any{"rows": list, "total": total, "page": page, "mode": "observation"}
		}
	}
	if e == nil {
		e = svc.Audit(ctx, tx, "", "", p.ID, "source:"+permission, map[string]string{"connection": connection})
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		cryptoFail(w, e)
		return
	}
	respond(w, 200, map[string]any{"data": out})
}
