package api

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"time"

	"firebase.google.com/go/v4/auth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Only these identity fields cross the adapter. Credentials/provider payloads do not.
type DirectoryIdentity struct {
	UID      string
	Email    string
	Name     string
	Verified bool
	Disabled bool
}
type UserDirectory interface {
	ByEmail(context.Context, string) (*DirectoryIdentity, error)
	ByUIDs(context.Context, []string) (map[string]DirectoryIdentity, error)
}
type FirebaseUserDirectory struct{ Client *auth.Client }

func directoryIdentity(u *auth.UserRecord) DirectoryIdentity {
	return DirectoryIdentity{UID: u.UID, Email: u.Email, Name: u.DisplayName, Verified: u.EmailVerified, Disabled: u.Disabled}
}
func (d FirebaseUserDirectory) ByEmail(ctx context.Context, email string) (*DirectoryIdentity, error) {
	u, err := d.Client.GetUserByEmail(ctx, email)
	if auth.IsUserNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	result := directoryIdentity(u)
	return &result, nil
}
func (d FirebaseUserDirectory) ByUIDs(ctx context.Context, uids []string) (map[string]DirectoryIdentity, error) {
	result := map[string]DirectoryIdentity{}
	if len(uids) == 0 {
		return result, nil
	}
	identifiers := make([]auth.UserIdentifier, 0, len(uids))
	for _, uid := range uids {
		identifiers = append(identifiers, auth.UIDIdentifier{UID: uid})
	}
	batch, err := d.Client.GetUsers(ctx, identifiers)
	if err != nil {
		return nil, err
	}
	for _, u := range batch.Users {
		result[u.UID] = directoryIdentity(u)
	}
	return result, nil
}

type directoryCustomer struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	CanReadAccounts     bool   `json:"canReadAccounts"`
	CanReviewOnboarding bool   `json:"canReviewOnboarding"`
}
type directoryUser struct {
	ID                 string              `json:"id"`
	UID                string              `json:"-"`
	Name               string              `json:"name"`
	Email              *string             `json:"email"`
	EmailVerified      *bool               `json:"emailVerified"`
	AuthStatus         string              `json:"authStatus"`
	RegistrationStatus string              `json:"registrationStatus"`
	UserStatus         *string             `json:"userStatus"`
	RegisteredAt       *time.Time          `json:"registeredAt"`
	CustomerLinkState  string              `json:"customerLinkState"`
	Customers          []directoryCustomer `json:"customers"`
}

func (u *directoryUser) identity(i *DirectoryIdentity) {
	u.AuthStatus = "missing"
	if i == nil {
		return
	}
	u.Email = &i.Email
	u.EmailVerified = &i.Verified
	u.AuthStatus = "enabled"
	if i.Disabled {
		u.AuthStatus = "disabled"
	}
	if u.Name == "" {
		u.Name = i.Name
	}
}

func (s *Server) userDirectory(w http.ResponseWriter, r *http.Request) {
	p := r.Context().Value(principalKey{}).(principal)
	if p.Role != "admin" {
		fail(w, 403, "operator_required")
		return
	}
	if !p.Identity.MFA {
		fail(w, 403, "mfa_required")
		return
	}
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		fail(w, 400, "invalid_query")
		return
	}
	for k, v := range q {
		if (k != "email" && k != "userId" && k != "limit" && k != "offset") || len(v) != 1 {
			fail(w, 400, "invalid_query")
			return
		}
	}
	limit, offset := 20, 0
	for k, dest := range map[string]*int{"limit": &limit, "offset": &offset} {
		if q.Has(k) {
			n, e := strconv.Atoi(q.Get(k))
			if e != nil || n < 0 || k == "limit" && (n < 1 || n > 50) || k == "offset" && n > 100000 {
				fail(w, 400, "invalid_query")
				return
			}
			*dest = n
		}
	}
	email := strings.TrimSpace(q.Get("email"))
	userID := q.Get("userId")
	if q.Has("userId") {
		id, e := uuid.Parse(userID)
		if e != nil || len(userID) != 36 || q.Has("email") || offset != 0 {
			fail(w, 400, "invalid_query")
			return
		}
		userID = id.String()
	}
	if q.Has("email") {
		address, e := mail.ParseAddress(email)
		if e != nil || address.Address != email || len(email) > 254 || offset != 0 {
			fail(w, 400, "invalid_email_query")
			return
		}
	}
	if s.Directory == nil {
		fail(w, 503, "identity_directory_unavailable")
		return
	}
	ctx := r.Context()
	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	defer tx.Rollback(ctx)
	// Explicitly authorized policy: all active admins may read registration metadata.
	// Lock the actor so role/disable changes cannot race this read and its audit.
	var actor string
	err = tx.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND role='admin' AND status='active' FOR SHARE`, p.ID).Scan(&actor)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 403, "operator_required")
		return
	}
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	data := []directoryUser{}
	hasMore := false
	var searched *DirectoryIdentity
	if email != "" {
		searched, err = s.Directory.ByEmail(ctx, email)
		if err != nil {
			fail(w, 503, "identity_directory_unavailable")
			return
		}
	}
	if email == "" || searched != nil {
		uid := ""
		if searched != nil {
			uid = searched.UID
		}
		rows, e := tx.Query(ctx, `SELECT id::text,firebase_uid,display_name,status,created_at FROM users WHERE role='customer' AND ($1='' OR firebase_uid=$1) AND (NULLIF($4,'')::uuid IS NULL OR id=NULLIF($4,'')::uuid) ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`, uid, limit+1, offset, userID)
		if e != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		for rows.Next() {
			u := directoryUser{RegistrationStatus: "registered", CustomerLinkState: "unlinked", Customers: []directoryCustomer{}}
			if e = rows.Scan(&u.ID, &u.UID, &u.Name, &u.UserStatus, &u.RegisteredAt); e != nil {
				break
			}
			data = append(data, u)
		}
		scanErr := rows.Err()
		rows.Close()
		if e != nil || scanErr != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		hasMore = len(data) > limit
		if hasMore {
			data = data[:limit]
		}
		if searched != nil && len(data) == 0 {
			// An existing admin is not a customer; do not mislabel it as unregistered.
			var exists bool
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE firebase_uid=$1)`, searched.UID).Scan(&exists); err != nil {
				fail(w, 503, "temporarily_unavailable")
				return
			}
			if !exists {
				u := directoryUser{ID: "identity:" + searched.UID, RegistrationStatus: "identity_only", CustomerLinkState: "unlinked", Customers: []directoryCustomer{}}
				u.identity(searched)
				data = append(data, u)
			}
		}
	}
	identities := map[string]DirectoryIdentity{}
	if searched != nil {
		identities[searched.UID] = *searched
	} else if email == "" {
		uids := make([]string, 0, len(data))
		for _, u := range data {
			uids = append(uids, u.UID)
		}
		identities, err = s.Directory.ByUIDs(ctx, uids)
		if err != nil {
			fail(w, 503, "identity_directory_unavailable")
			return
		}
	}
	for i := range data {
		u := &data[i]
		if u.RegistrationStatus != "registered" {
			continue
		}
		if identity, ok := identities[u.UID]; ok {
			u.identity(&identity)
		} else {
			u.identity(nil)
		}
		// Discover only link existence globally. Names/IDs/actions remain grant-scoped.
		var linked bool
		const ownership = `(c.personal_owner_id=$1 OR EXISTS(SELECT 1 FROM memberships m WHERE m.customer_id=c.id AND m.user_id=$1 AND m.status='active'))`
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM customers c WHERE `+ownership+`)`, u.ID).Scan(&linked); err != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		if linked {
			u.CustomerLinkState = "linked_restricted"
		}
		rows, e := tx.Query(ctx, `SELECT c.id::text,c.name,bool_or(g.permission='accounts:read'),bool_or(g.permission='onboarding:review') FROM customers c JOIN staff_grants g ON g.customer_id=c.id AND g.user_id=$2 WHERE `+ownership+` GROUP BY c.id,c.name ORDER BY c.id`, u.ID, p.ID)
		if e != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		for rows.Next() {
			var c directoryCustomer
			if e = rows.Scan(&c.ID, &c.Name, &c.CanReadAccounts, &c.CanReviewOnboarding); e != nil {
				break
			}
			u.Customers = append(u.Customers, c)
		}
		scanErr := rows.Err()
		rows.Close()
		if e != nil || scanErr != nil {
			fail(w, 503, "temporarily_unavailable")
			return
		}
		if len(u.Customers) > 0 {
			u.CustomerLinkState = "linked"
		}
	}
	action := "users:list"
	if email != "" {
		action = "users:email-search"
	}
	if _, err = tx.Exec(ctx, `INSERT INTO user_directory_audit(actor_id,action,result_count) VALUES($1,$2,$3)`, p.ID, action, len(data)); err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if err = tx.Commit(ctx); err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	respond(w, 200, map[string]any{"data": data, "meta": map[string]any{"limit": limit, "offset": offset, "hasMore": hasMore}})
}
