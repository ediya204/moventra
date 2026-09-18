// Package messages owns notifications, never financial execution.
package messages

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Fault struct {
	Code   string
	Status int
}

func (e *Fault) Error() string { return e.Code }
func Bad(code string) error    { return &Fault{code, 400} }
func Missing() error           { return &Fault{"not_found", 404} }

type Service struct {
	DB          *pgxpool.Pool
	Namespace   string
	Key         []byte
	SendEnabled bool
}

func FromEnv(db *pgxpool.Pool) (*Service, error) {
	if os.Getenv("MESSAGES_ENABLED") != "true" {
		return nil, nil
	}
	ns, key := os.Getenv("MESSAGES_NAMESPACE"), os.Getenv("MESSAGES_TOKEN_KEY")
	if os.Getenv("FUNDS_DISPLAY_MODE") == "production" && (ns == "" || ns != os.Getenv("DEPOSIT_ADDRESS_NAMESPACE")) {
		return nil, errors.New("messages_production_namespace_mismatch")
	}
	if ns == "" || len(ns) > 100 || len(key) < 32 {
		return nil, errors.New("messages_configuration_required")
	}
	return &Service{db, ns, []byte(key), os.Getenv("MESSAGES_SEND_ENABLED") == "true"}, nil
}
func (s *Service) Check(ctx context.Context) error {
	var ok bool
	err := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM message_namespaces WHERE namespace=$1)`, s.Namespace).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("messages_namespace_not_configured")
	}
	return nil
}
func (s *Service) Owner(ctx context.Context, tx pgx.Tx, customer, user string) error {
	var ok bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM customers WHERE id=$1 AND kind='personal' AND personal_owner_id=$2)`, customer, user).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return Missing()
	}
	return nil
}
func (s *Service) Allowed(ctx context.Context, tx pgx.Tx, customer, user, permission string) (bool, error) {
	var ok bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM message_grants g JOIN users u ON u.id=g.user_id WHERE g.namespace=$1 AND g.customer_id=$2 AND g.user_id=$3 AND g.permission=$4 AND u.role='admin' AND u.status='active' AND EXISTS(SELECT 1 FROM effective_staff_grants f WHERE f.user_id=g.user_id AND f.customer_id=g.customer_id AND f.permission='accounts:read'))`, s.Namespace, customer, user, permission).Scan(&ok)
	return ok, err
}
func (s *Service) Audit(ctx context.Context, tx pgx.Tx, actor, campaign, job, action string) error {
	_, e := tx.Exec(ctx, `INSERT INTO message_audit(namespace,actor_id,campaign_id,job_id,action) VALUES($1,NULLIF($2,'')::uuid,NULLIF($3,'')::uuid,NULLIF($4,'')::uuid,$5)`, s.Namespace, actor, campaign, job, action)
	return e
}

type token struct {
	NS       string
	User     string
	Customer string
	Kind     string
	Seq      int64
	Until    int64
	Filter   string
}

func (s *Service) sign(t token) string {
	raw, _ := json.Marshal(t)
	mac := hmac.New(sha256.New, s.Key)
	mac.Write(raw)
	return base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Service) parse(value, user, customer, kind, filter string) (int64, error) {
	if len(value) > 2000 {
		return 0, Bad("invalid_snapshot")
	}
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return 0, Bad("invalid_snapshot")
	}
	raw, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil {
		return 0, Bad("invalid_snapshot")
	}
	sig, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil {
		return 0, Bad("invalid_snapshot")
	}
	mac := hmac.New(sha256.New, s.Key)
	mac.Write(raw)
	var t token
	if !hmac.Equal(sig, mac.Sum(nil)) || json.Unmarshal(raw, &t) != nil || t.NS != s.Namespace || t.User != user || t.Customer != customer || t.Kind != kind || t.Filter != filter || t.Seq < 0 || t.Until < time.Now().Unix() {
		return 0, Bad("invalid_snapshot")
	}
	return t.Seq, nil
}
func (s *Service) newToken(user, customer, kind, filter string, seq int64) string {
	return s.sign(token{s.Namespace, user, customer, kind, seq, time.Now().Add(24 * time.Hour).Unix(), filter})
}

type Message struct {
	ID              string          `json:"id"`
	Category        string          `json:"category"`
	Title           string          `json:"title"`
	Body            string          `json:"body"`
	Priority        string          `json:"priority"`
	OrderID         string          `json:"orderId,omitempty"`
	Facts           json.RawMessage `json:"facts"`
	ResourceVersion *int64          `json:"resourceVersion,omitempty"`
	OccurredAt      time.Time       `json:"occurredAt"`
	DeliveredAt     time.Time       `json:"deliveredAt"`
	ReadAt          *time.Time      `json:"readAt"`
	Seq             int64           `json:"-"`
}
type Summary struct {
	Unread     int            `json:"unread"`
	Categories map[string]int `json:"categories"`
	Snapshot   string         `json:"snapshotToken"`
}

func (s *Service) Summary(ctx context.Context, tx pgx.Tx, customer, user string) (Summary, error) {
	out := Summary{Categories: map[string]int{"otc": 0, "letter": 0, "system": 0}}
	rows, e := tx.Query(ctx, `SELECT j.category,count(*) FROM message_inbox i JOIN message_jobs j ON j.id=i.id WHERE i.namespace=$1 AND i.customer_id=$2 AND i.user_id=$3 AND i.read_at IS NULL GROUP BY j.category`, s.Namespace, customer, user)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var c string
		var n int
		if e = rows.Scan(&c, &n); e != nil {
			break
		}
		out.Categories[c] = n
		out.Unread += n
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return out, e
	}
	var seq int64
	e = tx.QueryRow(ctx, `SELECT COALESCE(max(seq),0) FROM message_inbox WHERE namespace=$1 AND customer_id=$2 AND user_id=$3`, s.Namespace, customer, user).Scan(&seq)
	out.Snapshot = s.newToken(user, customer, "snapshot", "", seq)
	return out, e
}

const selectMessage = `SELECT i.id::text,j.category,j.title,j.body,j.priority,COALESCE(j.order_id::text,''),j.facts,j.resource_version,j.occurred_at,i.delivered_at,i.read_at,i.seq FROM message_inbox i JOIN message_jobs j ON j.id=i.id WHERE i.namespace=$1 AND i.customer_id=$2 AND i.user_id=$3`

func scanMessage(row pgx.Row) (Message, error) {
	var m Message
	e := row.Scan(&m.ID, &m.Category, &m.Title, &m.Body, &m.Priority, &m.OrderID, &m.Facts, &m.ResourceVersion, &m.OccurredAt, &m.DeliveredAt, &m.ReadAt, &m.Seq)
	return m, e
}

type Query struct {
	Category, Status, Q, Cursor string
	Limit                       int
}
type Page struct {
	Items   []Message `json:"items"`
	Next    string    `json:"nextCursor"`
	Summary Summary   `json:"summary"`
}

func (s *Service) List(ctx context.Context, tx pgx.Tx, customer, user string, q Query) (Page, error) {
	out := Page{Items: []Message{}}
	filter := q.Category + "|" + q.Status + "|" + q.Q + "|" + strconv.Itoa(q.Limit)
	var before int64
	var e error
	if q.Cursor != "" {
		before, e = s.parse(q.Cursor, user, customer, "cursor", filter)
		if e != nil {
			return out, e
		}
	}
	rows, e := tx.Query(ctx, selectMessage+` AND ($4='' OR j.category=$4) AND ($5='' OR ($5='unread' AND i.read_at IS NULL) OR ($5='read' AND i.read_at IS NOT NULL)) AND ($6='' OR strpos(lower(j.title),lower($6))>0 OR strpos(COALESCE(j.order_id::text,''),lower($6))>0) AND ($7::bigint=0 OR i.seq<$7) ORDER BY i.seq DESC LIMIT $8`, s.Namespace, customer, user, q.Category, q.Status, q.Q, before, q.Limit+1)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			e = err
			break
		}
		out.Items = append(out.Items, m)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return out, e
	}
	if len(out.Items) > q.Limit {
		out.Items = out.Items[:q.Limit]
		out.Next = s.newToken(user, customer, "cursor", filter, out.Items[len(out.Items)-1].Seq)
	}
	out.Summary, e = s.Summary(ctx, tx, customer, user)
	return out, e
}
func (s *Service) Detail(ctx context.Context, tx pgx.Tx, customer, user, id string) (Message, error) {
	m, e := scanMessage(tx.QueryRow(ctx, selectMessage+` AND i.id=$4`, s.Namespace, customer, user, id))
	if errors.Is(e, pgx.ErrNoRows) {
		return m, Missing()
	}
	return m, e
}
func (s *Service) Read(ctx context.Context, tx pgx.Tx, customer, user, id, snapshot string) (Summary, error) {
	if id != "" {
		tag, e := tx.Exec(ctx, `UPDATE message_inbox SET read_at=COALESCE(read_at,clock_timestamp()) WHERE namespace=$1 AND customer_id=$2 AND user_id=$3 AND id=$4`, s.Namespace, customer, user, id)
		if e != nil {
			return Summary{}, e
		}
		if tag.RowsAffected() != 1 {
			return Summary{}, Missing()
		}
	} else {
		seq, e := s.parse(snapshot, user, customer, "snapshot", "")
		if e != nil {
			return Summary{}, e
		}
		_, e = tx.Exec(ctx, `UPDATE message_inbox SET read_at=clock_timestamp() WHERE namespace=$1 AND customer_id=$2 AND user_id=$3 AND seq<=$4 AND read_at IS NULL`, s.Namespace, customer, user, seq)
		if e != nil {
			return Summary{}, e
		}
	}
	return s.Summary(ctx, tx, customer, user)
}

// DeliverOne holds the job row lock through delivery. A crashed worker rolls back
// completely; another worker resumes without leases or duplicate inbox entries.
func (s *Service) DeliverOne(ctx context.Context) (bool, error) {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return false, e
	}
	defer tx.Rollback(ctx)
	var id, customer, user, actor, campaign string
	var attempts int
	e = tx.QueryRow(ctx, `SELECT id::text,customer_id::text,user_id::text,COALESCE(actor_id::text,''),COALESCE(campaign_id::text,''),attempts FROM message_jobs WHERE namespace=$1 AND state='pending' AND next_attempt_at<=now() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, s.Namespace).Scan(&id, &customer, &user, &actor, &campaign, &attempts)
	if errors.Is(e, pgx.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	sub, e := tx.Begin(ctx)
	if e != nil {
		return true, e
	}
	state, code := "delivered", ""
	var eligible bool
	e = sub.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM customers c JOIN users u ON u.id=c.personal_owner_id WHERE c.id=$1 AND c.personal_owner_id=$2 AND u.role='customer' AND u.status='active')`, customer, user).Scan(&eligible)
	if e == nil && eligible && actor != "" {
		eligible, e = s.Allowed(ctx, sub, customer, actor, "publish")
	}
	if e == nil && !eligible {
		state, code = "skipped", "recipient_or_permission_changed"
	}
	if e == nil && eligible {
		_, e = sub.Exec(ctx, `INSERT INTO message_inbox_counters(namespace,customer_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, s.Namespace, customer, user)
		var seq int64
		if e == nil {
			e = sub.QueryRow(ctx, `UPDATE message_inbox_counters SET last_seq=last_seq+1 WHERE namespace=$1 AND customer_id=$2 AND user_id=$3 RETURNING last_seq`, s.Namespace, customer, user).Scan(&seq)
		}
		if e == nil {
			_, e = sub.Exec(ctx, `INSERT INTO message_inbox(id,namespace,customer_id,user_id,seq) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`, id, s.Namespace, customer, user, seq)
		}
	}
	if e == nil {
		e = s.Audit(ctx, sub, actor, campaign, id, "delivery:"+state)
	}
	if e == nil {
		e = sub.Commit(ctx)
	} else {
		_ = sub.Rollback(ctx)
		state, code = "pending", "delivery_unavailable"
		if attempts+1 >= 8 {
			state = "failed"
		}
	}
	if code == "delivery_unavailable" {
		details, _ := json.Marshal(map[string]any{"attempt": attempts + 1, "result": state, "code": code})
		if _, err := tx.Exec(ctx, `INSERT INTO message_audit(namespace,actor_id,campaign_id,job_id,action,details) VALUES($1,NULLIF($2,'')::uuid,NULLIF($3,'')::uuid,$4,'delivery:retry', $5)`, s.Namespace, actor, campaign, id, details); err != nil {
			return true, err
		}
	}
	delay := time.Duration(1<<min(attempts, 8))*time.Second + time.Duration(time.Now().UnixNano()%1000)*time.Millisecond
	_, e = tx.Exec(ctx, `UPDATE message_jobs SET state=$2,last_error=$3,attempts=attempts+1,next_attempt_at=$4 WHERE id=$1`, id, state, code, time.Now().Add(delay))
	if e != nil {
		return true, e
	}
	return true, tx.Commit(ctx)
}
func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for i := 0; i < 50; i++ {
				work, e := s.DeliverOne(ctx)
				if e != nil {
					slog.Warn("message delivery unavailable")
					break
				}
				if !work {
					break
				}
			}
		}
	}
}
func hash(v any) string     { b, _ := json.Marshal(v); return fmt.Sprintf("%x", sha256.Sum256(b)) }
func validID(v string) bool { _, e := uuid.Parse(v); return e == nil }
