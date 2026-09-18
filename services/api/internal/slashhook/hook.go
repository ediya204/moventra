// Package slashhook is a read-only online inbox. It has no ledger dependency.
package slashhook

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Slash official public verification key, retrieved 2026-09-18.
// https://docs.slash.com/api-reference/public-rsa-key
//
//go:embed public.pem
var publicPEM []byte
var ident = regexp.MustCompile(`^[a-zA-Z0-9_.:-]{1,180}$`)
var errInvalid = errors.New("invalid_notification")

type Event struct {
	Type   string    `json:"event"`
	ID     string    `json:"eventId"`
	Entity string    `json:"entityId"`
	At     time.Time `json:"eventTimestamp"`
}
type Service struct {
	MetricsEnabled bool
	DB             *pgxpool.Pool
	Key            *rsa.PublicKey
	apiKey         string
	client         *http.Client
	base           string
}

func New(db *pgxpool.Pool, apiKey string) *Service {
	b, _ := pem.Decode(publicPEM)
	k, err := x509.ParsePKIXPublicKey(b.Bytes)
	if err != nil {
		panic("invalid embedded Slash public key")
	}
	return &Service{DB: db, Key: k.(*rsa.PublicKey), apiKey: apiKey, base: "https://api.slash.com", client: &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}
func verify(k *rsa.PublicKey, signature string, body []byte) (Event, error) {
	var e Event
	if len(body) > 65536 || len(signature) > 1024 {
		return e, errInvalid
	}
	sig, err := base64.StdEncoding.DecodeString(signature)
	h := sha256.Sum256(body)
	if err != nil || rsa.VerifyPKCS1v15(k, crypto.SHA256, h[:], sig) != nil {
		return e, errInvalid
	}
	if json.Unmarshal(body, &e) != nil || !ident.MatchString(e.ID) || !ident.MatchString(e.Entity) || !ident.MatchString(e.Type) || e.At.IsZero() {
		return e, errInvalid
	}
	return e, nil
}
func kindOf(e string) string {
	switch e {
	case "aggregated_transaction.create", "aggregated_transaction.update":
		return "transaction"
	case "card_creation.event", "card.update", "card.delete":
		return "card"
	}
	return ""
}
func (s *Service) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/webhooks/slash" && !strings.HasPrefix(r.URL.Path, "/webhooks/slash/") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "POST" {
			w.Header().Set("Allow", "POST")
			w.WriteHeader(405)
			return
		}
		if r.Header.Get("slash-webhook-signature") == "" {
			w.WriteHeader(401)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 65536))
		if err != nil {
			w.WriteHeader(413)
			return
		}
		e, err := verify(s.Key, r.Header.Get("slash-webhook-signature"), body)
		if err != nil {
			w.WriteHeader(401)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()
		if err = s.receive(ctx, r.URL.Path, e); err != nil {
			slog.Warn("slash webhook not committed")
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(204)
	})
}
func (s *Service) receive(ctx context.Context, path string, e Event) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var conn string
	// Lock connection against retirement; no request-supplied tenant/connection.
	if err = tx.QueryRow(ctx, `SELECT id FROM slash_hook_connections WHERE endpoint=$1 AND enabled FOR SHARE`, path).Scan(&conn); err != nil {
		return err
	}
	kind := kindOf(e.Type)
	state := "queued"
	if kind == "" {
		state = "ignored"
	}
	_, err = tx.Exec(ctx, `INSERT INTO slash_hook_events(connection_id,event_id,event_type,entity_id,event_at,kind,state) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(connection_id,event_id) DO NOTHING`, conn, e.ID, e.Type, e.Entity, e.At, kind, state)
	if err != nil {
		return err
	}
	var typ, entity string
	var at time.Time
	var deliveries int
	err = tx.QueryRow(ctx, `SELECT event_type,entity_id,event_at,deliveries FROM slash_hook_events WHERE connection_id=$1 AND event_id=$2 FOR UPDATE`, conn, e.ID).Scan(&typ, &entity, &at, &deliveries)
	if err != nil {
		return err
	}
	// Postgres stores microsecond precision.
	conflict := typ != e.Type || entity != e.Entity || !at.Equal(e.At.Truncate(time.Microsecond))
	safe, _ := json.Marshal(e)
	hash := sha256.Sum256(safe)
	_, err = tx.Exec(ctx, `INSERT INTO slash_hook_deliveries(connection_id,event_id,digest,conflict) VALUES($1,$2,$3,$4)`, conn, e.ID, hex.EncodeToString(hash[:]), conflict)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE slash_hook_events SET deliveries=(SELECT count(*) FROM slash_hook_deliveries WHERE connection_id=$1 AND event_id=$2),last_received_at=now(),state=CASE WHEN $3 THEN 'review' ELSE state END,last_error=CASE WHEN $3 THEN 'event_conflict' ELSE last_error END WHERE connection_id=$1 AND event_id=$2`, conn, e.ID, conflict)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Service) get(ctx context.Context, path string) (map[string]json.RawMessage, error) {
	if s.apiKey == "" {
		return nil, errors.New("key_missing")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", s.base+path, nil)
	if err != nil {
		return nil, errors.New("invalid_path")
	}
	req.Header.Set("X-API-Key", s.apiKey)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, errors.New("provider_unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("provider_http_%d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
	if err != nil || len(b) > 2<<20 {
		return nil, errors.New("response_limit")
	}
	var v map[string]json.RawMessage
	if json.Unmarshal(b, &v) != nil {
		return nil, errors.New("invalid_json")
	}
	return v, nil
}
func value(m map[string]json.RawMessage, k string) string {
	var v string
	json.Unmarshal(m[k], &v)
	return v
}

// Single account is explicitly verified on registration and before every fetch.
func (s *Service) account(ctx context.Context) (string, error) {
	m, err := s.get(ctx, "/account")
	if err != nil {
		return "", err
	}
	var items []map[string]json.RawMessage
	if json.Unmarshal(m["items"], &items) != nil || len(items) != 1 {
		return "", errors.New("single_account_required")
	}
	var meta map[string]json.RawMessage
	json.Unmarshal(m["metadata"], &meta)
	if value(meta, "nextCursor") != "" {
		return "", errors.New("account_pagination_not_supported")
	}
	id := value(items[0], "id")
	if !ident.MatchString(id) {
		return "", errors.New("invalid_account")
	}
	return id, nil
}
func (s *Service) Init(ctx context.Context) error {
	acct, err := s.account(ctx)
	if err != nil {
		return err
	}
	// This immutable legacy path belongs only to the trial connection. Production
	// must use another connection and path; changing key alone is rejected by worker.
	_, err = s.DB.Exec(ctx, `INSERT INTO slash_hook_connections(id,account_ref,endpoint) VALUES('trial_20260918',$1,'/webhooks/slash') ON CONFLICT(id) DO NOTHING`, acct)
	if err != nil {
		return errors.New("connection_init_failed")
	}
	var existing string
	err = s.DB.QueryRow(ctx, `SELECT account_ref FROM slash_hook_connections WHERE id='trial_20260918'`).Scan(&existing)
	if err != nil || existing != acct {
		return errors.New("connection_account_conflict")
	}
	return nil
}

// Whitelist scalar fields only. Raw provider payload and PAN/CVV/OTP never persist.
func safePayload(m map[string]json.RawMessage, id string) ([]byte, error) {
	if value(m, "id") != id {
		return nil, errors.New("resource_identity_mismatch")
	}
	safe := map[string]json.RawMessage{}
	for _, k := range []string{"id", "accountId", "cardId", "virtualAccountId", "status", "detailedStatus", "amountCents", "date", "authorizedAt", "createdAt", "last4", "type"} {
		if v, ok := m[k]; ok {
			var scalar any
			dec := json.NewDecoder(strings.NewReader(string(v)))
			dec.UseNumber()
			if dec.Decode(&scalar) != nil {
				return nil, errors.New("invalid_scalar")
			}
			switch scalar.(type) {
			case string, json.Number, bool, nil:
				safe[k] = v
			}
		}
	}
	for _, key := range []string{"merchantData", "originalCurrency"} {
		var nested map[string]json.RawMessage
		if json.Unmarshal(m[key], &nested) == nil && nested != nil {
			clean := map[string]json.RawMessage{}
			keys := []string{"description", "categoryCode"}
			if key == "originalCurrency" {
				keys = []string{"code", "amountCents"}
			}
			for _, k := range keys {
				if raw, ok := nested[k]; ok {
					var str string
					if json.Unmarshal(raw, &str) == nil {
						clean[k] = raw
					} else if k == "amountCents" {
						if _, e := integer(raw); e == nil {
							clean[k] = raw
						}
					}
				}
			}
			safe[key], _ = json.Marshal(clean)
		}
	}
	return json.Marshal(safe)
}
func (s *Service) Step(ctx context.Context) error {
	// Session advisory lock is crash-released; no DB transaction spans HTTP.
	db, err := s.DB.Acquire(ctx)
	if err != nil {
		return err
	}
	defer db.Release()
	var locked bool
	if err = db.QueryRow(ctx, `SELECT pg_try_advisory_lock(73019009)`).Scan(&locked); err != nil || !locked {
		return err
	}
	defer func() {
		c, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if _, e := db.Exec(c, `SELECT pg_advisory_unlock(73019009)`); e != nil {
			db.Conn().Close(c)
		}
	}()
	if handled, commandErr := s.controlStep(ctx, db); handled || commandErr != nil {
		return commandErr
	}
	var conn, id, kind, entity, acct string
	var attempt int
	err = db.QueryRow(ctx, `SELECT e.connection_id,e.event_id,e.kind,e.entity_id,c.account_ref,e.attempts FROM slash_hook_events e JOIN slash_hook_connections c ON c.id=e.connection_id WHERE c.enabled AND e.state='queued' AND e.event_type<>'internal.card.reconcile' AND e.next_attempt<=now() ORDER BY e.next_attempt,e.received_at LIMIT 1`).Scan(&conn, &id, &kind, &entity, &acct, &attempt)
	if errors.Is(err, pgx.ErrNoRows) {
		if s.MetricsEnabled {
			return s.metricStep(ctx, db)
		}
		return nil
	}
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, `UPDATE slash_hook_events SET attempts=attempts+1,next_attempt=now()+interval '30 seconds' WHERE connection_id=$1 AND event_id=$2`, conn, id)
	if err != nil {
		return err
	}
	current, fetchErr := s.account(ctx)
	var payload []byte
	if fetchErr == nil && current != acct {
		fetchErr = errors.New("connection_account_mismatch")
	}
	if fetchErr == nil {
		var m map[string]json.RawMessage
		path := "/" + kind + "/" + url.PathEscape(entity)
		if kind == "card" {
			path += "?include_pan=false&include_cvv=false"
		}
		m, fetchErr = s.get(ctx, path)
		if fetchErr == nil {
			// Prefer explicit account reference; the single-account key gate also bounds resources.
			if raw, ok := m["accountId"]; ok && string(raw) != "null" && value(m, "accountId") != acct {
				fetchErr = errors.New("resource_account_mismatch")
			} else {
				payload, fetchErr = safePayload(m, entity)
			}
		}
	}
	if fetchErr != nil {
		state := "queued"
		code := fetchErr.Error()
		if attempt >= 11 || strings.Contains(code, "mismatch") || code == "single_account_required" || code == "provider_http_404" {
			state = "review"
		}
		delay := time.Duration(1<<min(attempt, 8)) * 30 * time.Second
		_, err = db.Exec(ctx, `UPDATE slash_hook_events SET state=$3,last_error=$4,next_attempt=$5 WHERE connection_id=$1 AND event_id=$2 AND state='queued'`, conn, id, state, code, time.Now().Add(delay))
		slog.Warn("slash fetch retry or review", "code", code)
		return err
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Recheck retirement/conflict after HTTP. Old results cannot publish to retired connections.
	var enabled bool
	var state string
	err = tx.QueryRow(ctx, `SELECT c.enabled,e.state FROM slash_hook_events e JOIN slash_hook_connections c ON c.id=e.connection_id WHERE e.connection_id=$1 AND e.event_id=$2 FOR UPDATE OF e FOR SHARE OF c`, conn, id).Scan(&enabled, &state)
	if err != nil {
		return err
	}
	if !enabled || state != "queued" {
		return nil
	}
	_, err = tx.Exec(ctx, `INSERT INTO slash_hook_observations(connection_id,event_id,kind,entity_id,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(connection_id,event_id) DO NOTHING`, conn, id, kind, entity, payload)
	if err != nil {
		return err
	}
	if kind == "card" {
		if err = publishCard(ctx, tx, conn, id, entity, acct, payload); err != nil {
			if err.Error() != "resource_wallet_mismatch" && err.Error() != "resource_status_unknown" {
				return err
			}
			_, err = tx.Exec(ctx, `UPDATE slash_hook_events SET state='review',last_error=$3 WHERE connection_id=$1 AND event_id=$2`, conn, id, err.Error())
			if err != nil {
				return err
			}
			return tx.Commit(ctx)
		}
	}
	var metricPayload map[string]json.RawMessage
	json.Unmarshal(payload, &metricPayload)
	if s.MetricsEnabled {
		if err = publishMetricEvent(ctx, tx, conn, id, kind, entity, metricPayload); err != nil {
			// Roll back partial observations, then retain a reviewable failure instead
			// of retrying malformed/foreign financial data indefinitely.
			tx.Rollback(ctx)
			_, updateErr := db.Exec(ctx, `UPDATE slash_hook_events SET state='review',last_error='metric_projection_rejected' WHERE connection_id=$1 AND event_id=$2 AND state='queued'`, conn, id)
			return updateErr
		}
	}
	_, err = tx.Exec(ctx, `UPDATE slash_hook_events SET state='done',last_error='' WHERE connection_id=$1 AND event_id=$2`, conn, id)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Service) Run(ctx context.Context) {
	timer := time.NewTicker(5 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			c, cancel := context.WithTimeout(ctx, 22*time.Second)
			err := s.Step(c)
			cancel()
			if err != nil {
				slog.Warn("slash inbox worker unavailable")
			}
		}
	}
}
func (s *Service) Status(ctx context.Context) (map[string]int, error) {
	rows, err := s.DB.Query(ctx, `SELECT state,count(*) FROM slash_hook_events GROUP BY state`)
	if err != nil {
		return nil, errors.New("inbox_unavailable")
	}
	defer rows.Close()
	m := map[string]int{}
	for rows.Next() {
		var k string
		var n int
		if err = rows.Scan(&k, &n); err != nil {
			return nil, err
		}
		m[k] = n
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	for label, query := range map[string]string{
		"deliveries":          "SELECT count(*) FROM slash_hook_deliveries",
		"observations":        "SELECT count(*) FROM slash_hook_observations",
		"enabled_connections": "SELECT count(*) FROM slash_hook_connections WHERE enabled",
	} {
		var n int
		if err = s.DB.QueryRow(ctx, query).Scan(&n); err != nil {
			return nil, errors.New("inbox_status_unavailable")
		}
		m[label] = n
	}
	return m, nil
}
