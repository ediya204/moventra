package api

import (
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

func (s *Server) channelRead(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	if !p.Identity.MFA {
		fail(w, 403, "mfa_required")
		return
	}
	q, e := url.ParseQuery(r.URL.RawQuery)
	if e != nil {
		fail(w, 400, "invalid_query")
		return
	}
	connection := r.PathValue("connection")
	resource := r.PathValue("resource")
	id := r.PathValue("id")
	allowed := map[string]bool{"page": true, "keyword": true, "detailedStatus": true, "from": true, "to": true, "revision": true, "cardId": true, "cardStatus": true}
	for k, v := range q {
		if !allowed[k] || len(v) != 1 || len(v[0]) > 200 || connection == "" || id != "" {
			fail(w, 400, "invalid_query")
			return
		}
	}
	if resource == "cards" && (q.Has("detailedStatus") || q.Has("from") || q.Has("to") || q.Has("cardId")) || resource == "transactions" && q.Has("cardStatus") {
		fail(w, 400, "invalid_query")
		return
	}
	page := 0
	if q.Has("page") {
		page, e = strconv.Atoi(q.Get("page"))
		if e != nil || page < 0 || page > 2500 {
			fail(w, 400, "invalid_page")
			return
		}
	}
	var from, to *time.Time
	for key, dest := range map[string]**time.Time{"from": &from, "to": &to} {
		if q.Get(key) != "" {
			t, err := time.Parse(time.RFC3339, q.Get(key))
			if err != nil {
				fail(w, 400, "invalid_time")
				return
			}
			*dest = &t
		}
	}
	if from != nil && to != nil && !from.Before(*to) {
		fail(w, 400, "invalid_time")
		return
	}
	tx, e := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if e != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	// Existing staff role and a separate explicit channel grant are both required.
	const scope = `g.user_id=$1 AND EXISTS(SELECT 1 FROM staff_grants s WHERE s.user_id=g.user_id)`
	if connection == "" {
		rows, e := tx.Query(r.Context(), `SELECT c.id,c.label,c.revision,c.source_at::text,c.imported_at::text FROM channel_connections c JOIN channel_read_grants g ON g.connection_id=c.id WHERE `+scope+` ORDER BY c.id`, p.ID)
		if e != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		data := []map[string]any{}
		for rows.Next() {
			var id, label string
			var rev, at, imported *string
			if e = rows.Scan(&id, &label, &rev, &at, &imported); e != nil {
				break
			}
			data = append(data, map[string]any{"id": id, "label": label, "revision": rev, "sourceAt": at, "importedAt": imported})
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		if len(data) == 0 {
			fail(w, 403, "channel_scope_required")
			return
		}
		_, e = tx.Exec(r.Context(), `INSERT INTO channel_read_audit(connection_id,actor_id,action,revision) SELECT c.id,$1,'projection:connections:read',c.revision FROM channel_connections c JOIN channel_read_grants g ON g.connection_id=c.id WHERE `+scope, p.ID)
		if e != nil || tx.Commit(r.Context()) != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		respond(w, 200, map[string]any{"data": data})
		return
	}
	var revision string
	var sourceAt, importedAt time.Time
	e = tx.QueryRow(r.Context(), `SELECT c.revision,c.source_at,c.imported_at FROM channel_connections c JOIN channel_read_grants g ON g.connection_id=c.id WHERE `+scope+` AND c.id=$2`, p.ID, connection).Scan(&revision, &sourceAt, &importedAt)
	if e == pgx.ErrNoRows {
		fail(w, 404, "not_found")
		return
	}
	if e != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if q.Get("revision") != "" && q.Get("revision") != revision {
		fail(w, 409, "projection_updated")
		return
	}
	if resource != "transactions" && resource != "cards" {
		fail(w, 404, "not_found")
		return
	}
	kind := "transaction"
	if resource == "cards" {
		kind = "card"
	}
	data := []json.RawMessage{}
	var total int
	where := `connection_id=$1 AND revision=$2 AND kind=$3 AND ($4='' OR external_id=$4) AND ($5='' OR data->>'merchant' ILIKE '%'||$5||'%' OR data->>'cardLast4'=$5 OR external_id=$5 OR ($3='card' AND (data->>'cardName' ILIKE '%'||$5||'%' OR data->>'name' ILIKE '%'||$5||'%' OR data->>'last4'=$5))) AND ($6='' OR data->>'detailedStatus'=$6) AND ($7::timestamptz IS NULL OR (data->>'date')::timestamptz >= $7) AND ($8::timestamptz IS NULL OR (data->>'date')::timestamptz < $8) AND ($9='' OR data->>'cardId'=$9) AND ($10='' OR data->>'cardStatus'=$10)`
	args := []any{connection, revision, kind, id, q.Get("keyword"), q.Get("detailedStatus"), from, to, q.Get("cardId"), q.Get("cardStatus")}
	if e = tx.QueryRow(r.Context(), `SELECT count(*) FROM channel_records WHERE `+where, args...).Scan(&total); e != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	rows, e := tx.Query(r.Context(), `SELECT data FROM channel_records WHERE `+where+` ORDER BY (data->>'date')::timestamptz DESC NULLS LAST,external_id LIMIT 20 OFFSET $11`, append(args, page*20)...)
	if e != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	for rows.Next() {
		var raw []byte
		if e = rows.Scan(&raw); e != nil {
			break
		}
		data = append(data, json.RawMessage(raw))
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if id != "" && len(data) == 0 {
		fail(w, 404, "not_found")
		return
	}
	if _, e = tx.Exec(r.Context(), `INSERT INTO channel_read_audit(connection_id,actor_id,action,revision) VALUES($1,$2,$3,$4)`, connection, p.ID, "projection:"+resource+":read", revision); e != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	respond(w, 200, map[string]any{"data": map[string]any{"rows": data, "total": total, "page": page, "revision": revision, "sourceAt": sourceAt, "importedAt": importedAt, "complete": false, "syncMode": "manual_import", "coverageReason": "已授权本地采集范围的手动导入；不是实时数据或完整渠道资金池。未绑定内部用户，不用于账务执行。"}})
}
