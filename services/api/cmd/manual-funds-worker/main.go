// Explicit worker only; no bank, card, or crypto payout client.
package main

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/ledger"
	"moventra.local/api/internal/manualfunds"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func run() error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	db, e := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		return fmt.Errorf("database_configuration_invalid")
	}
	defer db.Close()
	l, e := ledger.FromEnv(db)
	if e != nil {
		return e
	}
	s := &manualfunds.Service{DB: db, Ledger: l}
	if !s.Enabled() {
		return fmt.Errorf("manual_funds_disabled")
	}
	command := "drain"
	if len(os.Args) == 2 {
		command = os.Args[1]
	}
	if len(os.Args) > 2 || command != "drain" && command != "run" {
		return fmt.Errorf("expected drain or run")
	}
	for {
		_, e = s.Drain(ctx)
		if command == "drain" {
			return e
		}
		if e != nil {
			fmt.Fprintln(os.Stderr, "manual funds: pending recovery")
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(5 * time.Second):
		}
	}
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, "manual funds worker did not complete")
		os.Exit(1)
	}
}
