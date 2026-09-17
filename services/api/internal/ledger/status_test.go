package ledger

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
)

func TestQueueStatusIsolationAndFailures(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("requires isolated local test database")
	}
	cfg, err := pgxpool.ParseConfig(raw)
	if err != nil || CheckLocalDatabase(cfg) != nil || !strings.HasPrefix(cfg.ConnConfig.Database, "moventra_test_") {
		t.Fatal("unsafe test database")
	}
	ctx := context.Background()
	base, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	schema := "queue_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = base.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer base.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = database.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	svc := &Service{DB: db, Namespace: "shadow_monitor"}
	empty, err := svc.QueueStatus(ctx)
	if err != nil || empty.Runnable != 0 || empty.OldestRunnableSeconds != nil || empty.OldestDueSeconds != nil || empty.OldestProviderWaitSeconds != nil {
		t.Fatal(empty, err)
	}
	customer := uuid.NewString()
	if _, err = db.Exec(ctx, `INSERT INTO customers(id,kind,name) VALUES($1,'business','Synthetic monitor')`, customer); err != nil {
		t.Fatal(err)
	}
	for _, ns := range []string{"shadow_monitor", "shadow_other"} {
		source, dest := uuid.NewString(), uuid.NewString()
		if _, err = db.Exec(ctx, `INSERT INTO ledger_accounts(id,namespace,customer_id,account_key,kind,currency,scale) VALUES($1,$3,$4,'clearing','clearing','USD',2),($2,$3,$4,'wallet','wallet','USD',2)`, source, dest, ns, customer); err != nil {
			t.Fatal(err)
		}
		for _, state := range []string{"pending", "commit_pending", "release_pending", "awaiting_provider", "provider_unknown", "review_required", "applied", "released", "rejected"} {
			if _, err = db.Exec(ctx, `INSERT INTO ledger_operations(id,namespace,customer_id,effect_key,kind,source_id,destination_id,amount_minor,currency,scale,state,evidence_ref,attempts,created_at,updated_at,next_attempt_at) VALUES($1,$2,$3,$4,'wallet_credit',$5,$6,1,'USD',2,$4,'synthetic',1,now()-interval '10 minutes',now()-interval '6 minutes',CASE WHEN $4='pending' THEN now()+interval '1 hour' ELSE now()-interval '5 minutes' END)`, uuid.NewString(), ns, customer, state, source, dest); err != nil {
				t.Fatal(err)
			}
		}
	}
	got, err := svc.QueueStatus(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got.Runnable != 3 || got.Due != 2 || got.Retrying != 3 || got.AwaitingProvider != 1 || got.ProviderUnknown != 1 || got.ReviewRequired != 1 {
		t.Fatalf("counts or namespace leakage: %+v", got)
	}
	if got.OldestRunnableSeconds == nil || *got.OldestRunnableSeconds < 600 || got.OldestDueSeconds == nil || *got.OldestDueSeconds < 300 || got.OldestProviderWaitSeconds == nil || *got.OldestProviderWaitSeconds < 360 {
		t.Fatalf("ages: %+v", got)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = svc.QueueStatus(canceled); err == nil {
		t.Fatal("cancelled observation appeared successful")
	}
	db.Close()
	if _, err = svc.QueueStatus(ctx); err == nil {
		t.Fatal("database failure appeared as zero backlog")
	}
}
