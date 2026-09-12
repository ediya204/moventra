package api

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
)

func TestOnboardingFeatures(t *testing.T) {
	for _, s := range []string{"draft", "submitted", "approved", "rejected", ""} {
		for _, v := range []string{"inactive", "active", "suspended", ""} {
			if allClientFeatures(s, v) != (s == "approved" && v == "active") {
				t.Fatal(s, v)
			}
		}
	}
}
func TestOnboardingBoundary(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated database required")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("refusing non-test DB")
	}
	ctx := context.Background()
	base, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	if _, err = base.Exec(ctx, `CREATE SCHEMA onboarding_flow`); err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = "onboarding_flow"
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
	handler := (&Server{DB: pool, Verifier: fakeVerifier{}}).Handler()
	request := func(surface, token, method, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/"+surface+"-api/v1/customers/"+personal+"/onboarding", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, tc := range []struct {
		surface, token string
		code           int
	}{{"client", "bob", 404}, {"admin", "staff", 404}, {"admin", "staff-no-mfa", 403}} {
		if w := request(tc.surface, tc.token, "GET", ""); w.Code != tc.code {
			t.Fatal(w.Code, w.Body)
		}
	}
	if _, err = pool.Exec(ctx, `INSERT INTO staff_grants VALUES('00000000-0000-0000-0000-000000000003',$1,'onboarding:review')`, personal); err != nil {
		t.Fatal(err)
	}
	if w := request("client", "alice", "POST", `{"action":"approve_activate","revision":0,"reason":"bypass"}`); w.Code != 409 {
		t.Fatal(w.Code, w.Body)
	}
	if w := request("client", "alice", "POST", `{"action":"submit","revision":0,"reason":""}`); w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	// Exactly one concurrent decision wins; no repeated service activation/event.
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes <- request("admin", "staff", "POST", `{"action":"approve_activate","revision":1,"reason":"reviewed"}`).Code
		}()
	}
	wg.Wait()
	close(codes)
	got := map[int]int{}
	for c := range codes {
		got[c]++
	}
	if got[200] != 1 || got[409] != 1 {
		t.Fatal(got)
	}
	if w := request("client", "alice", "GET", ""); !strings.Contains(w.Body.String(), `"allFeaturesEnabled":true`) {
		t.Fatal(w.Code, w.Body)
	}
	for i, action := range []string{"suspend", "resume"} {
		w := request("admin", "staff", "POST", fmt.Sprintf(`{"action":%q,"revision":%d,"reason":"reviewed"}`, action, i+2))
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		expected := `"allFeaturesEnabled":false`
		if action == "resume" {
			expected = `"allFeaturesEnabled":true`
		}
		if !strings.Contains(w.Body.String(), expected) {
			t.Fatal(w.Body)
		}
	}
	// Audit failure must roll back service status and event history.
	if _, err = pool.Exec(ctx, `CREATE FUNCTION reject_admission_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test'; END $$; CREATE TRIGGER admission_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_admission_audit()`); err != nil {
		t.Fatal(err)
	}
	if w := request("admin", "staff", "POST", `{"action":"suspend","revision":4,"reason":"fail audit"}`); w.Code != 503 {
		t.Fatal(w.Code, w.Body)
	}
	var revision, events, accounts int
	var service string
	if err = pool.QueryRow(ctx, `SELECT onboarding_revision,service_status,(SELECT count(*) FROM onboarding_events),(SELECT count(*) FROM accounts) FROM customers WHERE id=$1`, personal).Scan(&revision, &service, &events, &accounts); err != nil {
		t.Fatal(err)
	}
	if revision != 4 || events != 4 || service != "active" || accounts != 3 {
		t.Fatal(revision, events, service, accounts)
	}
}
