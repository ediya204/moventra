// Trusted local shadow operations; never a public financial API.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/ledger"
	"os"
	"time"
)

func decode(v any) error {
	d := json.NewDecoder(io.LimitReader(os.Stdin, 16385))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return errors.New("invalid_input")
	}
	var x any
	if d.Decode(&x) != io.EOF {
		return errors.New("invalid_input")
	}
	return nil
}
func run() error {
	if len(os.Args) != 2 {
		return errors.New("usage: ledger migrate|provision|submit|asset|card-posting|crypto-credit|get|process|resolve|drain|status|snapshot (JSON on stdin)")
	}
	cfg, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		return errors.New("invalid_database_configuration")
	}
	if err = ledger.CheckLocalDatabase(cfg); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return errors.New("database_unavailable")
	}
	defer db.Close()
	if os.Args[1] == "migrate" {
		return database.Migrate(ctx, db)
	}
	s, err := ledger.FromEnv(db)
	if err != nil {
		return err
	}
	if s == nil {
		return errors.New("LEDGER_MODE=shadow_required")
	}
	var result any
	switch os.Args[1] {
	case "provision":
		var in ledger.AccountSpec
		if err = decode(&in); err == nil {
			result, err = s.Provision(ctx, in)
		}
	case "submit":
		var in ledger.Command
		if err = decode(&in); err == nil {
			result, err = s.Submit(ctx, in)
		}
	case "asset":
		var in struct{ Network, AssetID string }
		if err = decode(&in); err == nil {
			err = s.RegisterCryptoAsset(ctx, in.Network, in.AssetID)
			result = map[string]string{"status": "configured"}
		}
	case "card-posting":
		var in struct {
			CustomerID, CardID, ClearingID string
			Posting                        ledger.CardPosting
		}
		if err = decode(&in); err == nil {
			result, err = s.RecordCard(ctx, in.CustomerID, in.CardID, in.ClearingID, in.Posting)
		}
	case "crypto-credit":
		var in struct {
			CustomerID, WalletID, ClearingID string
			Credit                           ledger.CryptoCredit
		}
		if err = decode(&in); err == nil {
			result, err = s.RecordCrypto(ctx, in.CustomerID, in.WalletID, in.ClearingID, in.Credit)
		}
	case "get", "process", "resolve":
		var in struct {
			CustomerID  string `json:"customerId"`
			ID          string `json:"id"`
			Outcome     string `json:"outcome"`
			EvidenceRef string `json:"evidenceRef"`
		}
		if err = decode(&in); err == nil {
			if os.Args[1] == "get" {
				result, err = s.Get(ctx, in.CustomerID, in.ID)
			} else if os.Args[1] == "process" {
				result, err = s.Process(ctx, in.CustomerID, in.ID)
			} else {
				result, err = s.Resolve(ctx, in.CustomerID, in.ID, in.Outcome, in.EvidenceRef)
			}
		}
	case "snapshot":
		var in struct {
			CustomerID string `json:"customerId"`
		}
		if err = decode(&in); err == nil {
			result, err = s.Snapshot(ctx, in.CustomerID)
		}
	case "status":
		statusCtx, cancelStatus := context.WithTimeout(ctx, 2*time.Second)
		result, err = s.QueueStatus(statusCtx)
		cancelStatus()
	case "drain":
		result, err = s.Drain(ctx, 100)
	default:
		return errors.New("unknown_command")
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "shadow ledger command failed; inspect local configuration and operation status")
		os.Exit(1)
	}
}
