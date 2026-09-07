package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// These are statistics of the existing transaction projection. They are not
// source settlement evidence, balances or a new financial resource permission.
type overviewDaily struct {
	Date          string  `json:"date"`
	IncomingMinor *string `json:"incomingMinor"`
	OutgoingMinor *string `json:"outgoingMinor"`
	NetMinor      *string `json:"netMinor"`
	Posted        int64   `json:"posted"`
	Pending       int64   `json:"pending"`
	Failed        int64   `json:"failed"`
	Total         int64   `json:"total"`
}

type overviewTotals struct {
	IncomingMinor   string `json:"incomingMinor"`
	OutgoingMinor   string `json:"outgoingMinor"`
	NetMinor        string `json:"netMinor"`
	Transactions    int64  `json:"transactions"`
	Posted          int64  `json:"posted"`
	Pending         int64  `json:"pending"`
	Failed          int64  `json:"failed"`
	Review          int64  `json:"review"`
	ActiveCards     *int64 `json:"activeCards"`
	SelectedCards   *int64 `json:"selectedCards"`
	Customers       *int64 `json:"customers"`
	ActiveCustomers *int64 `json:"activeCustomers"`
}

type overviewRange struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Timezone string `json:"timezone"`
	Days     int    `json:"days"`
}

type overviewStatus struct {
	Status string `json:"status"`
	Count  int64  `json:"count"`
}

type overviewCurrency struct {
	Code  string `json:"code"`
	Count int64  `json:"count"`
}

type operationsOverview struct {
	Mode     string        `json:"mode"`
	AsOf     string        `json:"asOf"`
	Revision string        `json:"revision"`
	Range    overviewRange `json:"range"`
	Coverage struct {
		Complete bool   `json:"complete"`
		Reason   string `json:"reason"`
	} `json:"coverage"`
	Currency     string             `json:"currency"`
	Scale        int                `json:"scale"`
	TimeBasis    string             `json:"timeBasis"`
	Totals       overviewTotals     `json:"totals"`
	Daily        []overviewDaily    `json:"daily"`
	Statuses     []overviewStatus   `json:"statuses"`
	Merchants    []any              `json:"merchants"`
	Currencies   []overviewCurrency `json:"currencies"`
	Availability struct {
		Merchants bool `json:"merchants"`
		Cards     bool `json:"cards"`
		Customers bool `json:"customers"`
	} `json:"availability"`
	Sync struct {
		LastSuccessAt *string `json:"lastSuccessAt"`
		State         string  `json:"state"`
		Mode          string  `json:"mode"`
	} `json:"sync"`
}

func overviewWindow(query url.Values, now time.Time) (int, time.Time, time.Time, error) {
	days := 14
	for key, values := range query {
		if key != "days" || len(values) != 1 {
			return 0, time.Time{}, time.Time{}, fmt.Errorf("invalid query")
		}
		if values[0] != "7" && values[0] != "14" && values[0] != "30" {
			return 0, time.Time{}, time.Time{}, fmt.Errorf("invalid days")
		}
		days, _ = strconv.Atoi(values[0])
	}
	// Current reporting windows use Hong Kong's UTC+08:00 civil time. Keeping
	// this fixed avoids relying on OS tzdata in the minimal runtime container.
	hongKong := time.FixedZone("Asia/Hong_Kong", 8*60*60)
	local := now.In(hongKong)
	from := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, hongKong).AddDate(0, 0, -(days - 1))
	return days, from, now.UTC(), nil
}

func buildOverview(days int, from, to time.Time, buckets []overviewDaily) (operationsOverview, error) {
	result := operationsOverview{
		Mode: "production", AsOf: to.Format(time.RFC3339Nano),
		Range:    overviewRange{From: from.Format(time.RFC3339Nano), To: to.Format(time.RFC3339Nano), Timezone: "Asia/Hong_Kong", Days: days},
		Currency: "USD", Scale: 2, TimeBasis: "occurred_at",
		Daily: make([]overviewDaily, 0, days), Merchants: []any{}, Currencies: []overviewCurrency{},
	}
	result.Coverage.Reason = "仅统计已授权客户的 USD 交易查询投影；succeeded 为内部成功状态，按发生时间统计，不代表渠道已结算。渠道尚未接入，完整性未知；未抵消内部转账，不作为可用余额。"
	result.Sync.State, result.Sync.Mode = "not_connected", "projection_read"
	byDate := make(map[string]overviewDaily, len(buckets))
	incoming, outgoing := new(big.Int), new(big.Int)
	for _, day := range buckets {
		if day.IncomingMinor == nil || day.OutgoingMinor == nil {
			return result, fmt.Errorf("missing aggregate amount")
		}
		in, okIn := new(big.Int).SetString(*day.IncomingMinor, 10)
		out, okOut := new(big.Int).SetString(*day.OutgoingMinor, 10)
		if !okIn || !okOut || in.Sign() < 0 || out.Sign() < 0 {
			return result, fmt.Errorf("invalid aggregate amount")
		}
		net := new(big.Int).Sub(in, out).String()
		day.NetMinor = &net
		byDate[day.Date] = day
		incoming.Add(incoming, in)
		outgoing.Add(outgoing, out)
		result.Totals.Posted += day.Posted
		result.Totals.Pending += day.Pending
		result.Totals.Failed += day.Failed
		result.Totals.Transactions += day.Total
	}
	for i := 0; i < days; i++ {
		date := from.AddDate(0, 0, i).Format("2006-01-02")
		day, exists := byDate[date]
		if !exists {
			// Missing source coverage is not proof of a zero-flow day.
			day = overviewDaily{Date: date}
		}
		result.Daily = append(result.Daily, day)
	}
	result.Totals.IncomingMinor = incoming.String()
	result.Totals.OutgoingMinor = outgoing.String()
	result.Totals.NetMinor = new(big.Int).Sub(incoming, outgoing).String()
	result.Statuses = []overviewStatus{{"succeeded", result.Totals.Posted}, {"pending", result.Totals.Pending}, {"failed", result.Totals.Failed}}
	if result.Totals.Transactions > 0 {
		result.Currencies = append(result.Currencies, overviewCurrency{"USD", result.Totals.Transactions})
	}
	return result, nil
}

func (s *Server) opsOverview(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	if !p.Identity.MFA {
		fail(w, 403, "mfa_required")
		return
	}
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		fail(w, 400, "invalid_query")
		return
	}
	days, from, to, err := overviewWindow(query, time.Now())
	if err != nil {
		fail(w, 400, "invalid_query")
		return
	}
	// Scope lookup, aggregates and mandatory audit use one snapshot. This does
	// not grant accounts, customer metadata, card or channel access.
	tx, err := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	grants, err := tx.Query(r.Context(), `SELECT customer_id::text FROM staff_grants WHERE user_id=$1 AND permission='transactions:read' ORDER BY customer_id`, p.ID)
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	scopes := []string{}
	for grants.Next() {
		var id string
		if err = grants.Scan(&id); err != nil {
			break
		}
		scopes = append(scopes, id)
	}
	if err == nil {
		err = grants.Err()
	}
	grants.Close()
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if len(scopes) == 0 {
		fail(w, 403, "scope_required")
		return
	}
	rows, err := tx.Query(r.Context(), `
SELECT to_char(t.occurred_at AT TIME ZONE 'Asia/Hong_Kong','YYYY-MM-DD'),
       COALESCE(sum(t.amount_minor) FILTER (WHERE t.status='succeeded' AND t.direction='credit'),0)::text,
       COALESCE(sum(t.amount_minor) FILTER (WHERE t.status='succeeded' AND t.direction='debit'),0)::text,
       count(*) FILTER (WHERE t.status='succeeded'),
       count(*) FILTER (WHERE t.status='pending'),
       count(*) FILTER (WHERE t.status='failed'), count(*)
FROM transactions t
WHERE t.currency='USD' AND t.occurred_at >= $2 AND t.occurred_at < $3
  AND EXISTS (SELECT 1 FROM staff_grants g WHERE g.user_id=$1 AND g.customer_id=t.customer_id AND g.permission='transactions:read')
GROUP BY 1 ORDER BY 1`, p.ID, from, to)
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	buckets := []overviewDaily{}
	for rows.Next() {
		var day overviewDaily
		if err = rows.Scan(&day.Date, &day.IncomingMinor, &day.OutgoingMinor, &day.Posted, &day.Pending, &day.Failed, &day.Total); err != nil {
			break
		}
		buckets = append(buckets, day)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	result, err := buildOverview(days, from, to, buckets)
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	// The content fingerprint binds the caller, permissions, calendar window
	// and exact aggregates. It is not a channel version or a replayable report.
	version, _ := json.Marshal([]any{"ops-overview-v1", p.ID, scopes, result.Range.From, result.Daily})
	hash := sha256.Sum256(version)
	result.Revision = hex.EncodeToString(hash[:])
	_, err = tx.Exec(r.Context(), `INSERT INTO audit_events(actor_id,customer_id,action) SELECT user_id,customer_id,'transactions:overview:read' FROM staff_grants WHERE user_id=$1 AND permission='transactions:read'`, p.ID)
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	respond(w, 200, map[string]any{"data": result})
}
