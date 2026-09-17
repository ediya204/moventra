package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/ledger"
	"moventra.local/api/internal/worker"
)

func run() error {
	cfg, err := database.PoolConfig(os.Getenv("DATABASE_URL"), os.Getenv("DB_MAX_CONNS"))
	if err != nil {
		return err
	}
	// Check before opening any connection. Cloud deployment is not enabled here.
	if err = ledger.CheckLocalDatabase(cfg); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return errors.New("database_initialization_failed")
	}
	defer db.Close()
	svc, err := ledger.FromEnv(db)
	if err != nil {
		return err
	}
	if svc == nil {
		return errors.New("LEDGER_MODE=shadow_required")
	}
	startup, cancel := context.WithTimeout(ctx, 5*time.Second)
	err = database.Ready(startup, db, true)
	cancel()
	if err != nil {
		return err
	}
	slog.Info("shadow worker started", "batch_limit", 20, "poll_seconds", 5)
	var lastSample time.Time
	return worker.Run(ctx, 5*time.Second, time.Minute, 20, svc.Drain, func(n int, err error) {
		// Do not log upstream errors, credentials or financial payloads.
		if err != nil {
			slog.Warn("shadow worker batch incomplete", "selected", n)
		}
		// Sample at most once a minute, including idle queues. Missing samples
		// and failed queries must be distinguishable from zero backlog.
		if !lastSample.IsZero() && time.Since(lastSample) < time.Minute {
			return
		}
		lastSample = time.Now()
		sampleCtx, cancelSample := context.WithTimeout(ctx, 2*time.Second)
		status, sampleErr := svc.QueueStatus(sampleCtx)
		cancelSample()
		if sampleErr != nil {
			slog.Warn("shadow worker queue observation failed", "event", "ledger_queue_unavailable")
			return
		}
		pool := db.Stat()
		level := slog.LevelInfo
		if status.ProviderUnknown > 0 || status.ReviewRequired > 0 || (status.OldestDueSeconds != nil && *status.OldestDueSeconds >= 300) {
			level = slog.LevelWarn
		}
		slog.Log(ctx, level, "shadow worker queue observation",
			"event", "ledger_queue", "queue", status,
			"pool_acquired", pool.AcquiredConns(), "pool_total", pool.TotalConns(),
			"pool_max", pool.MaxConns(), "pool_empty_acquires_total", pool.EmptyAcquireCount(),
			"pool_acquire_duration_ms_total", pool.AcquireDuration().Milliseconds())
	})
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("shadow worker startup failed; verify local mode, configuration and migrations")
		os.Exit(1)
	}
}
