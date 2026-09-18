package messages

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type Draft struct {
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	Priority  string   `json:"priority"`
	Customers []string `json:"customerIds"`
	Revision  int      `json:"revision"`
}
type Campaign struct {
	ID        string         `json:"id"`
	Title     string         `json:"title"`
	Body      string         `json:"body"`
	Priority  string         `json:"priority"`
	Revision  int            `json:"revision"`
	State     string         `json:"state"`
	Created   time.Time      `json:"createdAt"`
	Published *time.Time     `json:"publishedAt"`
	Customers []string       `json:"customerIds"`
	Counts    map[string]int `json:"counts"`
}
type Scope struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Permissions []string `json:"permissions"`
}

func (s *Service) Scopes(ctx context.Context, tx pgx.Tx, actor string) ([]Scope, error) {
	out := []Scope{}
	rows, e := tx.Query(ctx, `SELECT c.id::text,c.name,array_agg(g.permission ORDER BY g.permission) FROM message_grants g JOIN customers c ON c.id=g.customer_id JOIN users u ON u.id=c.personal_owner_id WHERE g.namespace=$1 AND g.user_id=$2 AND c.kind='personal' AND u.status='active' AND u.role='customer' AND EXISTS(SELECT 1 FROM effective_staff_grants f WHERE f.user_id=g.user_id AND f.customer_id=c.id AND f.permission='accounts:read') GROUP BY c.id,c.name ORDER BY c.name,c.id LIMIT 501`, s.Namespace, actor)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var v Scope
		if e = rows.Scan(&v.ID, &v.Name, &v.Permissions); e != nil {
			return out, e
		}
		out = append(out, v)
	}
	if len(out) > 500 {
		return out, &Fault{"scope_capacity_exceeded", 503}
	}
	return out, rows.Err()
}
func (d *Draft) validate() error {
	d.Title = strings.TrimSpace(d.Title)
	d.Body = strings.TrimSpace(d.Body)
	if utf8.RuneCountInString(d.Title) < 1 || utf8.RuneCountInString(d.Title) > 80 || utf8.RuneCountInString(d.Body) < 1 || utf8.RuneCountInString(d.Body) > 5000 || strings.ContainsAny(d.Title, "\x00\r\n") || strings.ContainsRune(d.Body, 0) || d.Priority != "normal" && d.Priority != "high" || len(d.Customers) < 1 || len(d.Customers) > 100 {
		return Bad("invalid_draft")
	}
	sort.Strings(d.Customers)
	for i, id := range d.Customers {
		if !validID(id) || i > 0 && id == d.Customers[i-1] {
			return Bad("invalid_recipients")
		}
	}
	return nil
}
func (s *Service) recipients(ctx context.Context, tx pgx.Tx, actor, permission string, ids []string) (map[string]string, error) {
	out := map[string]string{}
	for _, id := range ids {
		ok, e := s.Allowed(ctx, tx, id, actor, permission)
		if e != nil {
			return nil, e
		}
		if !ok {
			return nil, Missing()
		}
		var user string
		e = tx.QueryRow(ctx, `SELECT c.personal_owner_id::text FROM customers c JOIN users u ON u.id=c.personal_owner_id WHERE c.id=$1 AND c.kind='personal' AND u.status='active' AND u.role='customer' FOR SHARE OF c,u`, id).Scan(&user)
		if errors.Is(e, pgx.ErrNoRows) {
			return nil, Missing()
		}
		if e != nil {
			return nil, e
		}
		out[id] = user
	}
	return out, nil
}
func (s *Service) Create(ctx context.Context, tx pgx.Tx, actor, key string, d Draft) (Campaign, error) {
	if !validID(key) {
		return Campaign{}, Bad("idempotency_key_required")
	}
	if e := d.validate(); e != nil {
		return Campaign{}, e
	}
	recipients, e := s.recipients(ctx, tx, actor, "compose", d.Customers)
	if e != nil {
		return Campaign{}, e
	}
	_, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "message-create:"+s.Namespace+actor+key)
	if e != nil {
		return Campaign{}, e
	}
	var existing, oldHash string
	e = tx.QueryRow(ctx, `SELECT id::text,create_hash FROM message_campaigns WHERE namespace=$1 AND actor_id=$2 AND create_key=$3`, s.Namespace, actor, key).Scan(&existing, &oldHash)
	if e == nil {
		if oldHash != hash(d) {
			return Campaign{}, &Fault{"idempotency_conflict", 409}
		}
		return s.Campaign(ctx, tx, actor, existing, "compose", false)
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return Campaign{}, e
	}
	id := uuid.NewString()
	_, e = tx.Exec(ctx, `INSERT INTO message_campaigns(id,namespace,actor_id,title,body,priority,create_key,create_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, s.Namespace, actor, d.Title, d.Body, d.Priority, key, hash(d))
	if e != nil {
		return Campaign{}, e
	}
	for _, c := range d.Customers {
		_, e = tx.Exec(ctx, `INSERT INTO message_campaign_recipients(campaign_id,customer_id,user_id) VALUES($1,$2,$3)`, id, c, recipients[c])
		if e != nil {
			return Campaign{}, e
		}
	}
	if e = s.Audit(ctx, tx, actor, id, "", "draft:create"); e != nil {
		return Campaign{}, e
	}
	return s.Campaign(ctx, tx, actor, id, "compose", false)
}
func (s *Service) Campaign(ctx context.Context, tx pgx.Tx, actor, id, permission string, lock bool) (Campaign, error) {
	var c Campaign
	sql := `SELECT id::text,title,body,priority,revision,state,created_at,published_at FROM message_campaigns WHERE namespace=$1 AND actor_id=$2 AND id=$3`
	if lock {
		sql += " FOR UPDATE"
	}
	e := tx.QueryRow(ctx, sql, s.Namespace, actor, id).Scan(&c.ID, &c.Title, &c.Body, &c.Priority, &c.Revision, &c.State, &c.Created, &c.Published)
	if errors.Is(e, pgx.ErrNoRows) {
		return c, Missing()
	}
	if e != nil {
		return c, e
	}
	c.Customers = []string{}
	rows, e := tx.Query(ctx, `SELECT customer_id::text FROM message_campaign_recipients WHERE campaign_id=$1 ORDER BY customer_id`, id)
	if e != nil {
		return c, e
	}
	for rows.Next() {
		var v string
		if e = rows.Scan(&v); e != nil {
			break
		}
		c.Customers = append(c.Customers, v)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return c, e
	}
	for _, customer := range c.Customers {
		ok, err := s.Allowed(ctx, tx, customer, actor, permission)
		if err != nil {
			return c, err
		}
		if !ok {
			return c, Missing()
		}
	}
	c.Counts = map[string]int{"pending": 0, "delivered": 0, "failed": 0, "skipped": 0, "read": 0}
	rows, e = tx.Query(ctx, `SELECT j.state,count(*),count(i.read_at) FROM message_jobs j LEFT JOIN message_inbox i ON i.id=j.id WHERE j.campaign_id=$1 GROUP BY j.state`, id)
	if e != nil {
		return c, e
	}
	defer rows.Close()
	for rows.Next() {
		var state string
		var count, read int
		if e = rows.Scan(&state, &count, &read); e != nil {
			return c, e
		}
		c.Counts[state] = count
		c.Counts["read"] += read
	}
	return c, rows.Err()
}
func (s *Service) Update(ctx context.Context, tx pgx.Tx, actor, id string, d Draft) (Campaign, error) {
	if e := d.validate(); e != nil {
		return Campaign{}, e
	}
	c, e := s.Campaign(ctx, tx, actor, id, "compose", true)
	if e != nil {
		return c, e
	}
	if c.State != "draft" || c.Revision != d.Revision {
		return c, &Fault{"campaign_changed", 409}
	}
	recipients, e := s.recipients(ctx, tx, actor, "compose", d.Customers)
	if e != nil {
		return c, e
	}
	_, e = tx.Exec(ctx, `UPDATE message_campaigns SET title=$2,body=$3,priority=$4,revision=revision+1 WHERE id=$1`, id, d.Title, d.Body, d.Priority)
	if e != nil {
		return c, e
	}
	_, e = tx.Exec(ctx, `DELETE FROM message_campaign_recipients WHERE campaign_id=$1`, id)
	if e != nil {
		return c, e
	}
	for _, customer := range d.Customers {
		_, e = tx.Exec(ctx, `INSERT INTO message_campaign_recipients(campaign_id,customer_id,user_id) VALUES($1,$2,$3)`, id, customer, recipients[customer])
		if e != nil {
			return c, e
		}
	}
	if e = s.Audit(ctx, tx, actor, id, "", "draft:update"); e != nil {
		return c, e
	}
	return s.Campaign(ctx, tx, actor, id, "compose", false)
}
func (s *Service) Publish(ctx context.Context, tx pgx.Tx, actor, id, key string, revision int) (Campaign, error) {
	if !s.SendEnabled {
		return Campaign{}, &Fault{"messages_send_disabled", 503}
	}
	if !validID(key) {
		return Campaign{}, Bad("idempotency_key_required")
	}
	if _, e := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "message-publish:"+s.Namespace+actor+key); e != nil {
		return Campaign{}, e
	}
	c, e := s.Campaign(ctx, tx, actor, id, "publish", true)
	if e != nil {
		return c, e
	}
	var existing string
	e = tx.QueryRow(ctx, `SELECT COALESCE(publish_key::text,'') FROM message_campaigns WHERE id=$1`, id).Scan(&existing)
	if e != nil {
		return c, e
	}
	if c.Revision != revision {
		return c, &Fault{"campaign_changed", 409}
	}
	if c.State == "published" {
		if existing != key {
			return c, &Fault{"campaign_changed", 409}
		}
		return c, nil
	}
	// Scope and content are frozen in the draft revision. Ownership changes require a new preview.
	rows, e := tx.Query(ctx, `SELECT r.customer_id::text,r.user_id::text FROM message_campaign_recipients r JOIN customers c ON c.id=r.customer_id JOIN users u ON u.id=r.user_id WHERE r.campaign_id=$1 AND c.personal_owner_id=r.user_id AND u.status='active' AND u.role='customer' ORDER BY r.customer_id FOR SHARE OF c,u`, id)
	if e != nil {
		return c, e
	}
	pairs := [][2]string{}
	for rows.Next() {
		var pair [2]string
		if e = rows.Scan(&pair[0], &pair[1]); e != nil {
			break
		}
		pairs = append(pairs, pair)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return c, e
	}
	if len(pairs) != len(c.Customers) {
		return c, &Fault{"campaign_changed", 409}
	}
	var keyUsed bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM message_campaigns WHERE namespace=$1 AND actor_id=$2 AND publish_key=$3)`, s.Namespace, actor, key).Scan(&keyUsed)
	if e != nil {
		return c, e
	}
	if keyUsed {
		return c, &Fault{"idempotency_conflict", 409}
	}
	for _, pair := range pairs {
		_, e = tx.Exec(ctx, `INSERT INTO message_jobs(id,namespace,event_key,customer_id,user_id,campaign_id,actor_id,category,title,body,priority,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,'letter',$8,$9,$10,now())`, uuid.NewString(), s.Namespace, "campaign:"+id, pair[0], pair[1], id, actor, c.Title, c.Body, c.Priority)
		if e != nil {
			return c, e
		}
	}
	_, e = tx.Exec(ctx, `UPDATE message_campaigns SET state='published',published_at=now(),publish_key=$2 WHERE id=$1`, id, key)
	if e != nil {
		return c, e
	}
	if e = s.Audit(ctx, tx, actor, id, "", "publish"); e != nil {
		return c, e
	}
	return s.Campaign(ctx, tx, actor, id, "publish", false)
}
func (s *Service) Retry(ctx context.Context, tx pgx.Tx, actor, id string) (Campaign, error) {
	if !s.SendEnabled {
		return Campaign{}, &Fault{"messages_send_disabled", 503}
	}
	c, e := s.Campaign(ctx, tx, actor, id, "retry", true)
	if e != nil {
		return c, e
	}
	for _, customer := range c.Customers {
		ok, err := s.Allowed(ctx, tx, customer, actor, "publish")
		if err != nil {
			return c, err
		}
		if !ok {
			return c, Missing()
		}
	}
	_, e = tx.Exec(ctx, `UPDATE message_jobs SET state='pending',attempts=0,next_attempt_at=now() WHERE campaign_id=$1 AND state='failed'`, id)
	if e != nil {
		return c, e
	}
	if e = s.Audit(ctx, tx, actor, id, "", "retry"); e != nil {
		return c, e
	}
	return s.Campaign(ctx, tx, actor, id, "retry", false)
}
func (s *Service) Campaigns(ctx context.Context, tx pgx.Tx, actor string, page int) (map[string]any, error) {
	// Filter inaccessible campaigns before paging; never disclose partial audiences.
	sql := ` FROM message_campaigns c WHERE c.namespace=$1 AND c.actor_id=$2 AND NOT EXISTS(SELECT 1 FROM message_campaign_recipients r WHERE r.campaign_id=c.id AND NOT EXISTS(SELECT 1 FROM message_grants g WHERE g.namespace=c.namespace AND g.customer_id=r.customer_id AND g.user_id=$2 AND g.permission='read' AND EXISTS(SELECT 1 FROM effective_staff_grants f WHERE f.user_id=g.user_id AND f.customer_id=g.customer_id AND f.permission='accounts:read')))`
	var total int
	if e := tx.QueryRow(ctx, `SELECT count(*)`+sql, s.Namespace, actor).Scan(&total); e != nil {
		return nil, e
	}
	rows, e := tx.Query(ctx, `SELECT c.id::text`+sql+` ORDER BY c.created_at DESC,c.id DESC LIMIT 20 OFFSET $3`, s.Namespace, actor, page*20)
	if e != nil {
		return nil, e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			break
		}
		ids = append(ids, id)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return nil, e
	}
	items := []Campaign{}
	for _, id := range ids {
		c, e := s.Campaign(ctx, tx, actor, id, "read", false)
		if e != nil {
			return nil, e
		}
		items = append(items, c)
	}
	return map[string]any{"items": items, "total": total, "page": page}, nil
}
func (s *Service) Receipts(ctx context.Context, tx pgx.Tx, actor, id string, page int) (map[string]any, error) {
	if _, e := s.Campaign(ctx, tx, actor, id, "read", false); e != nil {
		return nil, e
	}
	rows, e := tx.Query(ctx, `SELECT j.customer_id::text,c.name,j.state,j.attempts,j.last_error,i.delivered_at,i.read_at FROM message_jobs j JOIN customers c ON c.id=j.customer_id LEFT JOIN message_inbox i ON i.id=j.id WHERE j.campaign_id=$1 ORDER BY j.customer_id,j.id LIMIT 20 OFFSET $2`, id, page*20)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var customer, name, state, code string
		var attempts int
		var delivered, read *time.Time
		if e = rows.Scan(&customer, &name, &state, &attempts, &code, &delivered, &read); e != nil {
			return nil, e
		}
		items = append(items, map[string]any{"customerId": customer, "name": name, "state": state, "attempts": attempts, "error": code, "deliveredAt": delivered, "readAt": read})
	}
	return map[string]any{"items": items, "page": page}, rows.Err()
}
