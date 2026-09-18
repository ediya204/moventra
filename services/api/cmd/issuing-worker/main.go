package main

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/issuing"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg, e := database.PoolConfig(os.Getenv("DATABASE_URL"), os.Getenv("DB_MAX_CONNS"))
	if e != nil {
		return e
	}
	if os.Getenv("ISSUING_MODE") == "prepare" {
		cfg.ConnConfig.RuntimeParams["default_transaction_read_only"] = "on"
	}
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		return e
	}
	defer db.Close()
	svc, e := issuing.FromEnv(db)
	if e != nil {
		return e
	}
	if svc.Funds != nil {
		check, done := context.WithTimeout(ctx, 5*time.Second)
		err := database.ReadyIssuingUnified(check, db)
		done()
		if err != nil {
			return err
		}
		if db.Config().MaxConns < 2 {
			return errors.New("unified_issuing_requires_two_connections")
		}
	}
	if !svc.Enabled && svc.Mode != "prepare" {
		return errors.New("issuing_execution_disabled")
	}
	check, cancel := context.WithTimeout(ctx, 5*time.Second)
	e = database.Ready(check, db, false)
	cancel()
	if e != nil {
		return e
	}
	ticker := time.NewTicker(3 * time.Second)
	if svc.Mode == "prepare" {
		ticker.Reset(time.Minute)
	}
	defer ticker.Stop()
	for {
		if svc.Mode == "prepare" {
			probe, done := context.WithTimeout(ctx, 5*time.Second)
			e = svc.Blnk.CheckLedger(probe)
			done()
			slog.Info("issuing preparation", "ledgerReachable", e == nil, "executionEnabled", false)
		} else {
			batch, done := context.WithTimeout(ctx, 45*time.Second)
			e = svc.Tick(batch)
			done()
			if e != nil {
				slog.Warn("issuing batch incomplete; durable retry retained")
			}
		}
		observation, end := context.WithTimeout(ctx, 2*time.Second)
		var pending, unknown int
		err := db.QueryRow(observation, `SELECT count(*) FILTER(WHERE state NOT IN ('active','failed','funding_failed')),count(*) FILTER(WHERE state IN ('provider_unknown','review_required')) FROM issuing_orders`).Scan(&pending, &unknown)
		end()
		if err == nil {
			slog.Info("issuing queue", "pending", pending, "requiresVerification", unknown)
		} else {
			slog.Warn("issuing queue observation unavailable")
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}
func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if run() != nil {
		slog.Error("issuing worker stopped; check mode, migrations and isolated configuration")
		os.Exit(1)
	}
}
