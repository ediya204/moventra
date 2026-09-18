package api

import (
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func (s *Server) channelRead(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	customer := r.PathValue("customerID")
	client := customer != ""
	if client {
		if _, err := uuid.Parse(customer); err != nil {
			fail(w, 400, "invalid_customer_id")
			return
		}
	}
	if !client && !p.Identity.MFA {
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
	if client {
		var allowed bool
		if e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM customers WHERE id=$1 AND kind='personal' AND personal_owner_id=$2)`, customer, p.ID).Scan(&allowed); e != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		if p.Role != "customer" || !allowed {
			fail(w, 404, "not_found")
			return
		}
	}
	// Existing staff role and a separate explicit channel grant are both required.
	const scope = `g.user_id=$1 AND EXISTS(SELECT 1 FROM staff_grants s WHERE s.user_id=g.user_id)`
	walletScoped := false
	if client {
		if e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM project_wallet_customers WHERE customer_id=$1)`, customer).Scan(&walletScoped); e != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
	}
	if connection == "" {
		query := `SELECT c.id,c.label,c.revision,c.source_at::text,c.imported_at::text FROM channel_connections c JOIN channel_read_grants g ON g.connection_id=c.id WHERE ` + scope + ` ORDER BY c.id`
		arg := p.ID
		if client {
			query = `SELECT c.id,c.label,b.revision,i.source_at::text,i.imported_at::text FROM customer_card_snapshots b JOIN channel_connections c ON c.id=b.connection_id JOIN channel_imports i ON i.connection_id=b.connection_id AND i.revision=b.revision WHERE b.customer_id=$1 ORDER BY c.id`
			arg = customer
			if walletScoped {
				query = `SELECT c.id,w.label,c.revision,c.source_at::text,c.imported_at::text FROM project_wallet_customers u JOIN project_wallets w ON w.project_key=u.project_key JOIN channel_connections c ON c.id=w.connection_id WHERE u.customer_id=$1 ORDER BY c.id`
			}
		}
		rows, e := tx.Query(r.Context(), query, arg)
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
		if len(data) == 0 && !client {
			fail(w, 403, "channel_scope_required")
			return
		}
		if client {
			_, e = tx.Exec(r.Context(), `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,'card-snapshot:connections:read')`, p.ID, customer)
		} else {
			_, e = tx.Exec(r.Context(), `INSERT INTO channel_read_audit(connection_id,actor_id,action,revision) SELECT c.id,$1,'projection:connections:read',c.revision FROM channel_connections c JOIN channel_read_grants g ON g.connection_id=c.id WHERE `+scope, p.ID)
		}
		if e != nil || tx.Commit(r.Context()) != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		respond(w, 200, map[string]any{"data": data})
		return
	}
	var revision string
	var sourceAt, importedAt time.Time
	if client && walletScoped {
		e = tx.QueryRow(r.Context(), `SELECT c.revision,c.source_at,c.imported_at FROM project_wallet_customers u JOIN project_wallets w ON w.project_key=u.project_key JOIN channel_connections c ON c.id=w.connection_id WHERE u.customer_id=$1 AND c.id=$2`, customer, connection).Scan(&revision, &sourceAt, &importedAt)
	} else if client {
		e = tx.QueryRow(r.Context(), `SELECT b.revision,i.source_at,i.imported_at FROM customer_card_snapshots b JOIN channel_imports i ON i.connection_id=b.connection_id AND i.revision=b.revision WHERE b.customer_id=$1 AND b.connection_id=$2`, customer, connection).Scan(&revision, &sourceAt, &importedAt)
	} else {
		e = tx.QueryRow(r.Context(), `SELECT c.revision,c.source_at,c.imported_at FROM channel_connections c JOIN channel_read_grants g ON g.connection_id=c.id WHERE `+scope+` AND c.id=$2`, p.ID, connection).Scan(&revision, &sourceAt, &importedAt)
	}
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
	prefix := ""
	if !client || walletScoped {
		prefix = "WITH channel_records AS (SELECT * FROM channel_current_records) "
	}
	data := []json.RawMessage{}
	var total int
	where := `connection_id=$1 AND revision=$2 AND kind=$3 AND ($4='' OR external_id=$4) AND ($5='' OR data->>'merchant' ILIKE '%'||$5||'%' OR data->>'cardLast4'=$5 OR external_id=$5 OR ($3='card' AND (data->>'cardName' ILIKE '%'||$5||'%' OR data->>'name' ILIKE '%'||$5||'%' OR data->>'last4'=$5))) AND ($6='' OR data->>'detailedStatus'=$6) AND ($7::timestamptz IS NULL OR (data->>'date')::timestamptz >= $7) AND ($8::timestamptz IS NULL OR (data->>'date')::timestamptz < $8) AND ($9='' OR data->>'cardId'=$9) AND ($10='' OR data->>'cardStatus'=$10)`
	// Resolve display metadata only from the same scoped card snapshot. Never
	// derive a suffix from a card ID or read another connection/revision.
	cardLast4 := "data->>'cardLast4'"
	if kind == "transaction" {
		cardLast4 = `COALESCE(NULLIF(data->>'cardLast4',''), (SELECT COALESCE(NULLIF(card.data->>'cardLast4',''),NULLIF(card.data->>'last4','')) FROM channel_records card WHERE card.connection_id=channel_records.connection_id AND card.revision=channel_records.revision AND card.kind='card' AND card.external_id=channel_records.data->>'cardId' AND card.data->>'accountId' IS NOT DISTINCT FROM channel_records.data->>'accountId' AND card.data->>'virtualAccountId' IS NOT DISTINCT FROM channel_records.data->>'virtualAccountId'))`
		where = strings.ReplaceAll(where, "data->>'cardLast4'", cardLast4)
	}
	args := []any{connection, revision, kind, id, q.Get("keyword"), q.Get("detailedStatus"), from, to, q.Get("cardId"), q.Get("cardStatus")}
	if client {
		// Both cards and transactions are restricted before counting/pagination.
		if walletScoped {
			where += ` AND EXISTS(SELECT 1 FROM project_wallet_cards b JOIN project_wallets w ON w.connection_id=b.connection_id AND w.virtual_account_ref=b.virtual_account_ref WHERE b.customer_id=$11 AND b.connection_id=channel_records.connection_id AND b.external_card_id=CASE WHEN channel_records.kind='card' THEN channel_records.external_id ELSE channel_records.data->>'cardId' END AND channel_records.data->>'accountId'=w.account_ref AND channel_records.data->>'virtualAccountId'=w.virtual_account_ref)`
		} else {
			where += ` AND EXISTS(SELECT 1 FROM customer_card_bindings b WHERE b.customer_id=$11 AND b.connection_id=channel_records.connection_id AND b.revision=channel_records.revision AND b.external_card_id=CASE WHEN channel_records.kind='card' THEN channel_records.external_id ELSE channel_records.data->>'cardId' END)`
		}
		args = append(args, customer)
		if q.Get("cardId") != "" {
			var allowed bool
			if walletScoped {
				e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM project_wallet_cards WHERE customer_id=$1 AND connection_id=$2 AND external_card_id=$3)`, customer, connection, q.Get("cardId")).Scan(&allowed)
			} else {
				e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM customer_card_bindings WHERE customer_id=$1 AND connection_id=$2 AND revision=$3 AND external_card_id=$4)`, customer, connection, revision, q.Get("cardId")).Scan(&allowed)
			}
			if e != nil {
				fail(w, 503, "temporarily_unavailable")
				return
			}
			if !allowed {
				fail(w, 404, "not_found")
				return
			}
		}
	}
	if e = tx.QueryRow(r.Context(), prefix+`SELECT count(*) FROM channel_records WHERE `+where, args...).Scan(&total); e != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	offset := "$11"
	if client {
		offset = "$12"
	}
	selection := "data"
	if kind == "transaction" {
		selection = `data || jsonb_build_object('cardLast4', ` + cardLast4 + `)`
	}
	// Apply the owner join after pagination, preserving count and ordering and
	// avoiding per-card queries. Source and ownership share one read snapshot.
	if !client {
		selection += " AS data,connection_id,kind,external_id"
	}
	query := `SELECT ` + selection + ` FROM channel_records WHERE ` + where + ` ORDER BY (data->>'date')::timestamptz DESC NULLS LAST,external_id LIMIT 20 OFFSET ` + offset
	if !client {
		query = `SELECT ` + channelOwnershipSelection + ` FROM (` + query + `) r` + channelOwnershipJoin + ` ORDER BY (r.data->>'date')::timestamptz DESC NULLS LAST,r.external_id`
	}
	queryArgs := append(args, page*20)
	if !client {
		queryArgs = append(queryArgs, p.ID)
	}
	rows, e := tx.Query(r.Context(), prefix+query, queryArgs...)
	if e != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	for rows.Next() {
		var raw []byte
		if e = rows.Scan(&raw); e != nil {
			break
		}
		if client {
			// Explicit customer DTO, never expose shared account identifiers or future import fields.
			var input map[string]json.RawMessage
			if e = json.Unmarshal(raw, &input); e != nil {
				break
			}
			safe := map[string]json.RawMessage{}
			for _, key := range []string{"id", "cardId", "cardName", "cardLast4", "name", "last4", "cardStatus", "createdAtUTC", "checkedAt", "syncState", "cardAction", "controlsEnabled", "status", "detailedStatus", "date", "authorizedAt", "postedAt", "merchant", "categoryCode", "amountCents", "originalCurrency", "merchantData"} {
				if value, ok := input[key]; ok {
					safe[key] = value
				}
			}
			raw, e = json.Marshal(safe)
			if e != nil {
				break
			}
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
	if r.Method == "POST" {
		if resource != "cards" || id == "" || (client && !walletScoped) {
			fail(w, 404, "not_found")
			return
		}
		if strings.HasSuffix(r.URL.Path, "/actions") {
			s.queueCardControl(w, r, tx, p, connection, id, customer)
			return
		}
		var hook string
		e = tx.QueryRow(r.Context(), `SELECT l.hook_connection_id FROM card_sync_links l JOIN slash_hook_connections h ON h.id=l.hook_connection_id AND h.enabled JOIN channel_connections c ON c.id=l.connection_id AND c.account_ref=h.account_ref WHERE l.connection_id=$1 AND l.enabled AND EXISTS(SELECT 1 FROM project_wallet_cards b JOIN project_wallets w ON w.connection_id=b.connection_id AND w.virtual_account_ref=b.virtual_account_ref WHERE b.connection_id=l.connection_id AND b.external_card_id=$2 AND w.account_ref=h.account_ref)`, connection, id).Scan(&hook)
		if e == pgx.ErrNoRows {
			fail(w, 409, "card_sync_disabled")
			return
		}
		if e != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		_, e = tx.Exec(r.Context(), `INSERT INTO slash_hook_events(connection_id,event_id,event_type,entity_id,event_at,kind,state)
   SELECT $1,'manual:'||$2||':'||floor(extract(epoch FROM now())/30)::text,'internal.card.refresh',$2,now(),'card','queued'
   WHERE NOT EXISTS(SELECT 1 FROM slash_hook_events WHERE connection_id=$1 AND entity_id=$2 AND kind='card' AND state='queued')
   ON CONFLICT(connection_id,event_id) DO NOTHING`, hook, id)
		if e != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		_, e = tx.Exec(r.Context(), `INSERT INTO channel_read_audit(connection_id,actor_id,action,revision) VALUES($1,$2,'card:sync:request',$3)`, connection, p.ID, revision)
		if e != nil || tx.Commit(r.Context()) != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		respond(w, 202, map[string]any{"data": map[string]any{"syncState": "pending"}})
		return
	}
	action := "projection:" + resource + ":read"
	if client {
		action = "card-snapshot:" + resource + ":read"
	}
	if _, e = tx.Exec(r.Context(), `INSERT INTO channel_read_audit(connection_id,actor_id,action,revision) VALUES($1,$2,$3,$4)`, connection, p.ID, action, revision); e != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	mode := "manual_import"
	coverage := "已授权本地采集范围的手动导入；不是实时数据或完整渠道资金池。内部卡片归属独立管理，不用于账务执行。"
	if client {
		mode = "test_snapshot"
		coverage = "已明确分配给本账户的卡片测试快照，包含同批关联交易；不是实时数据、完整账单或资金所有权证明。"
	}
	if walletScoped {
		mode = "assigned_wallet_projection"
		coverage = "项目钱包内已明确归属本用户的卡片及对应交易；不含其他用户或其他钱包。仅已导入来源记录，不代表完整历史或个人可用资金。"
	}
	if kind == "card" && (!client || walletScoped) {
		coverage = "卡片基础资料保留导入版本；已启用同步的卡片由卡片操作和渠道通知更新状态，每卡标示核验时间。交易仍按原导入范围，不代表资金余额。"
		if client {
			coverage = "仅展示正式归属本用户的项目钱包卡片。" + coverage
		}
	}
	respond(w, 200, map[string]any{"data": map[string]any{"rows": data, "total": total, "page": page, "revision": revision, "sourceAt": sourceAt, "importedAt": importedAt, "complete": false, "syncMode": mode, "coverageReason": coverage}})
}
