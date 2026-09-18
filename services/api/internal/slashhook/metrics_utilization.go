package slashhook

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/url"
	"time"
)

// This whitelist is recursive: never store a raw provider card or group body.
func limitFields(raw json.RawMessage) any {
	var array []json.RawMessage
	if json.Unmarshal(raw, &array) == nil && array != nil {
		out := []any{}
		for _, v := range array {
			out = append(out, limitFields(v))
		}
		return out
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	out := map[string]any{}
	for _, k := range []string{"amountCents", "preset", "interval", "type", "period", "timezone", "startDate", "endDate", "startAt"} {
		if v, ok := m[k]; ok {
			if k == "amountCents" {
				if n, e := integer(v); e == nil {
					out[k] = n
				}
				continue
			}
			var s string
			if json.Unmarshal(v, &s) == nil && len(s) <= 100 {
				out[k] = s
			}
		}
	}
	for _, k := range []string{"spendingRule", "utilizationLimit", "utilizationLimitV2", "limitAmount", "transactionSizeLimit", "minimum", "maximum", "limit", "daily", "weekly", "monthly", "yearly", "collective"} {
		if v, ok := m[k]; ok {
			out[k] = limitFields(v)
		}
	}
	return out
}
func (s *Service) readUtilization(ctx context.Context, c MetricCard) (map[string]json.RawMessage, []byte, error) {
	m, e := s.get(ctx, "/card/"+url.PathEscape(c.Card)+"?include_pan=false&include_cvv=false")
	if e != nil {
		return nil, nil, e
	}
	if value(m, "id") != c.Card || value(m, "virtualAccountId") != c.Wallet {
		return nil, nil, errors.New("resource_scope_mismatch")
	}
	if a := value(m, "accountId"); a != "" && a != c.Account {
		return nil, nil, errors.New("resource_account_mismatch")
	}
	rules := map[string]any{"card": limitFields(m["spendingConstraint"])}
	if group := value(m, "cardGroupId"); group != "" {
		if !ident.MatchString(group) {
			return nil, nil, errors.New("invalid_group")
		}
		g, e := s.get(ctx, "/card-group/"+url.PathEscape(group))
		if e != nil {
			return nil, nil, e
		}
		if value(g, "id") != group {
			return nil, nil, errors.New("resource_group_mismatch")
		}
		rules["group"] = limitFields(g["spendingConstraint"])
		rules["sharedGroup"] = true
	}
	b, _ := json.Marshal(rules)
	u, e := s.get(ctx, "/card/"+url.PathEscape(c.Card)+"/utilization")
	return u, b, e
}
func saveUtilization(ctx context.Context, tx pgx.Tx, c MetricCard, m map[string]json.RawMessage, rules []byte, at time.Time, evidence string) error {
	var spend, available map[string]json.RawMessage
	if json.Unmarshal(m["spend"], &spend) != nil {
		return errors.New("invalid_utilization")
	}
	n, e := integer(spend["amountCents"])
	if e != nil {
		return e
	}
	var a *string
	if raw, ok := m["availableBalance"]; ok && string(raw) != "null" {
		if json.Unmarshal(raw, &available) != nil {
			return errors.New("invalid_utilization")
		}
		v, e := integer(available["amountCents"])
		if e != nil {
			return e
		}
		a = &v
	}
	var reset *time.Time
	if v := value(m, "nextResetDate"); v != "" {
		t, e := time.Parse(time.RFC3339Nano, v)
		if e != nil {
			return errors.New("invalid_reset_time")
		}
		reset = &t
	}
	payload, _ := json.Marshal(map[string]any{"availableMinor": a, "spendMinor": n, "nextResetAt": reset, "rules": json.RawMessage(rules), "currency": "USD"})
	if _, e = tx.Exec(ctx, `INSERT INTO card_metric_observations(connection_id,external_card_id,resource_id,kind,evidence,payload,observed_at) VALUES($1,$2,$2,'utilization',$3,$4,$5)`, c.Connection, c.Card, evidence, payload, at); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO card_utilization_snapshots(connection_id,external_card_id,available_minor,spend_minor,currency,next_reset_at,rules,collected_at) VALUES($1,$2,$3,$4,'USD',$5,$6,$7) ON CONFLICT(connection_id,external_card_id) DO UPDATE SET available_minor=excluded.available_minor,spend_minor=excluded.spend_minor,next_reset_at=excluded.next_reset_at,rules=excluded.rules,collected_at=excluded.collected_at WHERE card_utilization_snapshots.collected_at<=excluded.collected_at`, c.Connection, c.Card, a, n, reset, rules, at)
	return e
}

// QueueRefresh coalesces repeated notifications/clicks. It only writes a query
// task and never changes card controls or monetary balances.
func QueueMetricRefresh(ctx context.Context, tx pgx.Tx, connection, card string) error {
	if _, e := metricScope(ctx, tx, connection, card); e != nil {
		return e
	}
	// A fixed window must not be extended midway through pagination. Mark a
	// follow-up refresh if another event arrives while one is in progress.
	_, e := tx.Exec(ctx, `INSERT INTO card_metric_refreshes(connection_id,external_card_id,requested_at) VALUES($1,$2,now()) ON CONFLICT(connection_id,external_card_id) DO UPDATE SET requested_at=excluded.requested_at`, connection, card)
	return e
}
func publishMetricEvent(ctx context.Context, tx pgx.Tx, hook, event, kind, entity string, m map[string]json.RawMessage) error {
	var conn string
	if e := tx.QueryRow(ctx, `SELECT connection_id FROM card_sync_links WHERE hook_connection_id=$1 AND enabled`, hook).Scan(&conn); e == pgx.ErrNoRows {
		return nil
	} else if e != nil {
		return e
	}
	card := entity
	if kind == "transaction" {
		card = value(m, "cardId")
	}
	if card == "" {
		return nil
	}
	c, e := metricScope(ctx, tx, conn, card)
	if e == pgx.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	if kind == "transaction" {
		if e = saveTransaction(ctx, tx, c, m, time.Now().UTC(), "event:"+event, false); e != nil {
			return e
		}
	}
	return QueueMetricRefresh(ctx, tx, conn, card)
}
