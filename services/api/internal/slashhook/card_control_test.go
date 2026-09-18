package slashhook

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
)

func testCardControls(t *testing.T, ctx context.Context, db *pgxpool.Pool, s *Service) {
	t.Helper()
	var status atomic.Value
	status.Store("paused")
	var patches, gets atomic.Int32
	var uncertain atomic.Bool
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/account" {
			fmt.Fprint(w, `{"items":[{"id":"acct1"}]}`)
			return
		}
		if r.URL.Path != "/card/card1" {
			t.Error("unexpected resource")
			w.WriteHeader(404)
			return
		}
		if r.Method == "PATCH" {
			patches.Add(1)
			var body map[string]string
			if json.NewDecoder(r.Body).Decode(&body) != nil || len(body) != 1 || body["status"] == "" {
				t.Error("non-status mutation")
			}
			status.Store(body["status"])
			if uncertain.Load() {
				w.WriteHeader(500)
				return
			}
			w.WriteHeader(200)
			fmt.Fprint(w, `{"cvv":"must-not-persist"}`)
			return
		}
		gets.Add(1)
		if r.URL.Query().Get("include_cvv") != "false" || r.URL.Query().Get("include_pan") != "false" {
			t.Error("sensitive query")
		}
		fmt.Fprintf(w, `{"id":"card1","accountId":"acct1","virtualAccountId":"wallet1","status":%q}`, status.Load())
	}))
	defer ts.Close()
	s.base = ts.URL
	if _, err := db.Exec(ctx, `UPDATE card_sync_links SET controls_enabled=true WHERE connection_id='source'`); err != nil {
		t.Fatal(err)
	}
	enqueue := func(expected, target, state string) string {
		t.Helper()
		id := uuid.NewString()
		_, err := db.Exec(ctx, `INSERT INTO card_control_commands(id,connection_id,external_card_id,customer_id,actor_id,expected_status,target_status,state) VALUES($1,'source','card1','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',$2,$3,$4)`, id, expected, target, state)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	step := func() {
		t.Helper()
		if err := s.Step(ctx); err != nil {
			t.Fatal(err)
		}
	}
	check := func(id, want string) {
		t.Helper()
		var got string
		if err := db.QueryRow(ctx, `SELECT state FROM card_control_commands WHERE id=$1`, id).Scan(&got); err != nil || got != want {
			t.Fatalf("command %s want %s: %v", got, want, err)
		}
	}
	due := func(id string) {
		t.Helper()
		if _, err := db.Exec(ctx, `UPDATE card_control_commands SET next_attempt=now() WHERE id=$1`, id); err != nil {
			t.Fatal(err)
		}
	}
	// Every successful action requires a separate read, never optimistic publication.
	for _, pair := range [][2]string{{"paused", "active"}, {"active", "paused"}, {"paused", "closed"}} {
		id := enqueue(pair[0], pair[1], "queued")
		before := patches.Load()
		step()
		check(id, "confirming")
		var published string
		db.QueryRow(ctx, `SELECT status FROM card_current_states WHERE external_card_id='card1'`).Scan(&published)
		if published != pair[0] {
			t.Fatalf("optimistic state %s", published)
		}
		step()
		check(id, "confirmed")
		if patches.Load() != before+1 {
			t.Fatal("duplicate patch")
		}
	}
	// No events or commands => no provider calls, regardless of elapsed checked_at.
	before := gets.Load()
	step()
	if gets.Load() != before {
		t.Fatal("idle polling")
	}
	// A lost response may already have applied. Confirm with GET, never resend PATCH.
	status.Store("active")
	uncertain.Store(true)
	id := enqueue("active", "paused", "queued")
	beforePatch := patches.Load()
	step()
	check(id, "confirming")
	due(id)
	step()
	check(id, "confirmed")
	if patches.Load() != beforePatch+1 {
		t.Fatal("uncertain write replayed")
	}
	uncertain.Store(false)
	// Persisted submitted command after a crash also only reads.
	id = enqueue("active", "paused", "submitted")
	beforePatch = patches.Load()
	step()
	check(id, "confirmed")
	if patches.Load() != beforePatch {
		t.Fatal("crash replayed write")
	}
	// External changes invalidate the expected status, so no stale command is sent.
	status.Store("closed")
	id = enqueue("active", "paused", "queued")
	step()
	check(id, "failed")
	if patches.Load() != beforePatch {
		t.Fatal("stale write")
	}
	// Revoking capability stops queued work before any write.
	id = enqueue("paused", "active", "queued")
	db.Exec(ctx, `UPDATE card_sync_links SET controls_enabled=false WHERE connection_id='source'`)
	step()
	check(id, "failed")
	if patches.Load() != beforePatch {
		t.Fatal("revoked write")
	}
	// The dispatch worker must recognize global scope, and recheck revocation.
	admin := uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO users(id,firebase_uid,display_name,role) VALUES($1,'global-control','Global operator','admin')`, admin); err != nil {
		t.Fatal(err)
	}
	if err := database.SetGlobalAdmin(ctx, db, "global-control", "isolated-control", true); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `UPDATE card_sync_links SET controls_enabled=true WHERE connection_id='source'`); err != nil {
		t.Fatal(err)
	}
	status.Store("paused")
	id = enqueue("paused", "active", "queued")
	if _, err := db.Exec(ctx, `UPDATE card_control_commands SET actor_id=$1 WHERE id=$2`, admin, id); err != nil {
		t.Fatal(err)
	}
	step()
	check(id, "confirming")
	step()
	check(id, "confirmed")
	id = enqueue("active", "paused", "queued")
	if _, err := db.Exec(ctx, `UPDATE card_control_commands SET actor_id=$1 WHERE id=$2`, admin, id); err != nil {
		t.Fatal(err)
	}
	if err := database.SetGlobalAdmin(ctx, db, "global-control", "isolated-revoke", false); err != nil {
		t.Fatal(err)
	}
	beforePatch = patches.Load()
	step()
	check(id, "failed")
	if patches.Load() != beforePatch {
		t.Fatal("global revocation bypassed at dispatch")
	}
	var observations int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM card_control_observations`).Scan(&observations); err != nil || observations < 8 {
		t.Fatal("missing observations", observations, err)
	}
}
