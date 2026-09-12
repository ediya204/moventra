package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

type fakeDirectory struct {
	calls       int
	unavailable bool
}

func (d *fakeDirectory) ByUIDs(_ context.Context, uids []string) (map[string]DirectoryIdentity, error) {
	d.calls++
	if d.unavailable {
		return nil, errors.New("fixture unavailable")
	}
	result := map[string]DirectoryIdentity{}
	for _, uid := range uids {
		if uid != "disabled" {
			result[uid] = DirectoryIdentity{UID: uid, Email: uid + "@example.com", Verified: true}
		}
	}
	return result, nil
}
func (d *fakeDirectory) ByEmail(_ context.Context, email string) (*DirectoryIdentity, error) {
	d.calls++
	if d.unavailable {
		return nil, errors.New("fixture unavailable")
	}
	uid := strings.TrimSuffix(strings.ToLower(email), "@example.com")
	if uid == "absent" {
		return nil, nil
	}
	return &DirectoryIdentity{UID: uid, Email: strings.ToLower(email), Name: "Identity name", Verified: true}, nil
}
func TestUserDirectory(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated database required")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("isolated database required")
	}
	ctx := context.Background()
	base, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	if _, err = base.Exec(ctx, `CREATE SCHEMA user_directory`); err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = "user_directory"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, seed); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 22; i++ {
		if _, err = pool.Exec(ctx, `INSERT INTO users(id,firebase_uid,display_name) VALUES($1,$2,$3)`, fmt.Sprintf("90000000-0000-0000-0000-%012d", i), fmt.Sprintf("new%d", i), "New registration"); err != nil {
			t.Fatal(err)
		}
	}
	identity := &fakeDirectory{}
	handler := (&Server{DB: pool, Verifier: fakeVerifier{}, Directory: identity}).Handler()
	request := func(token, path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	decode := func(w *httptest.ResponseRecorder) ([]directoryUser, bool) {
		t.Helper()
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		var body struct {
			Data []directoryUser `json:"data"`
			Meta struct {
				HasMore bool `json:"hasMore"`
			} `json:"meta"`
		}
		if e := json.Unmarshal(w.Body.Bytes(), &body); e != nil {
			t.Fatal(e)
		}
		return body.Data, body.Meta.HasMore
	}
	t.Run("auth and MFA checked before identity service", func(t *testing.T) {
		for token, want := range map[string]int{"": 401, "alice": 403, "staff-no-mfa": 403, "disabled": 403} {
			if w := request(token, "/admin-api/v1/users"); w.Code != want {
				t.Fatal(token, w.Code)
			}
		}
		if identity.calls != 0 {
			t.Fatal("unauthorized identity lookup")
		}
	})
	t.Run("paged registered users include unlinked identities", func(t *testing.T) {
		first, more := decode(request("staff", "/admin-api/v1/users?limit=20&offset=0"))
		if len(first) != 20 || !more {
			t.Fatal(len(first), more)
		}
		second, more := decode(request("staff", "/admin-api/v1/users?limit=20&offset=20"))
		if len(second) != 5 || more {
			t.Fatal(len(second), more)
		}
		ids := map[string]bool{}
		unlinked := 0
		missing := 0
		for _, u := range append(first, second...) {
			if ids[u.ID] {
				t.Fatal("duplicate page row")
			}
			ids[u.ID] = true
			if u.CustomerLinkState == "unlinked" {
				unlinked++
			}
			if u.AuthStatus == "missing" {
				missing++
				if u.Email != nil || u.EmailVerified != nil {
					t.Fatal("invented email")
				}
			}
		}
		if unlinked != 23 || missing != 1 {
			t.Fatal(unlinked, missing)
		}
	})
	t.Run("email identifies same UID and links retain resource permissions", func(t *testing.T) {
		users, _ := decode(request("staff", "/admin-api/v1/users?email=ALICE%40example.com"))
		if len(users) != 1 {
			t.Fatal(len(users))
		}
		u := users[0]
		if u.ID != "00000000-0000-0000-0000-000000000001" || u.Email == nil || *u.Email != "alice@example.com" || len(u.Customers) != 1 || u.Customers[0].ID != business || !u.Customers[0].CanReadAccounts || u.Customers[0].CanReviewOnboarding {
			t.Fatalf("bad scoped identity %+v", u)
		}
		users, _ = decode(request("staff", "/admin-api/v1/users?email=bob%40example.com"))
		if len(users) != 1 || users[0].CustomerLinkState != "linked_restricted" || len(users[0].Customers) != 0 {
			t.Fatalf("scope leak %+v", users)
		}
		w := request("staff", "/admin-api/v1/customers/"+other+"/accounts")
		if w.Code != 404 {
			t.Fatal("directory changed business scope", w.Code)
		}
	})
	t.Run("identity-only and not-found and admin are distinct", func(t *testing.T) {
		users, _ := decode(request("staff", "/admin-api/v1/users?email=new-user%40example.com"))
		if len(users) != 1 || users[0].RegistrationStatus != "identity_only" || users[0].UserStatus != nil || users[0].RegisteredAt != nil {
			t.Fatal(users)
		}
		for _, email := range []string{"absent", "staff"} {
			users, _ = decode(request("staff", "/admin-api/v1/users?email="+email+"%40example.com"))
			if len(users) != 0 {
				t.Fatal(email, users)
			}
		}
		var count int
		if err = pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE firebase_uid='new-user'`).Scan(&count); err != nil || count != 0 {
			t.Fatal("search wrote user", count, err)
		}
	})
	t.Run("invalid filters rejected without identity access", func(t *testing.T) {
		calls := identity.calls
		for _, q := range []string{"email=x", "email=", "email=a%40b.com&offset=1", "email=a%40b.com&email=b%40b.com", "limit=51", "limit=0", "offset=-1", "offset=100001", "role=admin", "limit=1&limit=2", "email=%zz"} {
			if w := request("staff", "/admin-api/v1/users?"+q); w.Code != 400 {
				t.Fatal(q, w.Code)
			}
		}
		if identity.calls != calls {
			t.Fatal("invalid request reached identity API")
		}
	})
	t.Run("upstream failure is not empty directory", func(t *testing.T) {
		identity.unavailable = true
		defer func() { identity.unavailable = false }()
		for _, q := range []string{"", "?email=alice%40example.com"} {
			w := request("staff", "/admin-api/v1/users"+q)
			if w.Code != 503 || !strings.Contains(w.Body.String(), "identity_directory_unavailable") {
				t.Fatal(w.Code, w.Body.String())
			}
		}
	})
	t.Run("directory audits succeed without customer grants and fail closed", func(t *testing.T) {
		if _, err = pool.Exec(ctx, `DELETE FROM staff_grants WHERE user_id='00000000-0000-0000-0000-000000000003'`); err != nil {
			t.Fatal(err)
		}
		users, _ := decode(request("staff", "/admin-api/v1/users?email=alice%40example.com"))
		if len(users) != 1 || users[0].CustomerLinkState != "linked_restricted" {
			t.Fatal(users)
		}
		var n int
		if err = pool.QueryRow(ctx, `SELECT count(*) FROM user_directory_audit`).Scan(&n); err != nil || n < 7 {
			t.Fatal(n, err)
		}
		if _, err = pool.Exec(ctx, `CREATE FUNCTION reject_directory_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$;CREATE TRIGGER reject_directory_audit BEFORE INSERT ON user_directory_audit FOR EACH ROW EXECUTE FUNCTION reject_directory_audit()`); err != nil {
			t.Fatal(err)
		}
		w := request("staff", "/admin-api/v1/users?email=alice%40example.com")
		if w.Code != 503 || strings.Contains(w.Body.String(), "alice@example.com") {
			t.Fatal(w.Code, w.Body.String())
		}
	})
}
