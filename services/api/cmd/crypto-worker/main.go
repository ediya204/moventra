// crypto-worker is local-only. It cannot construct a real Cregis write client.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"moventra.local/api/internal/cregis"
	"moventra.local/api/internal/cryptofunds"
	"moventra.local/api/internal/ledger"
	"moventra.local/api/internal/tron"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func run() error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	cfg, e := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if e != nil {
		return errors.New("invalid_local_database")
	}
	if e = ledger.CheckLocalDatabase(cfg); e != nil && os.Getenv("LEDGER_MODE") != "live" {
		return e
	}
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		return e
	}
	defer db.Close()
	l, e := ledger.FromEnv(db)
	if e != nil {
		return e
	}
	s, e := cryptofunds.New(l)
	if e != nil {
		return e
	}
	command := "drain"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	if command == "enroll-zero-card" {
		var in struct{ CustomerID, Connection, ExternalCardID, EvidenceRef string }
		d := json.NewDecoder(io.LimitReader(os.Stdin, 8192))
		d.DisallowUnknownFields()
		if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
			return errors.New("invalid_input")
		}
		id, err := s.EnrollZeroCard(ctx, in.CustomerID, in.Connection, in.ExternalCardID, in.EvidenceRef)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]string{"cardId": id})
	}
	if command == "deposit-fixture" || command == "resolve-fixture" || command == "grant" {
		if l.IsLive() {
			return errors.New("fixture_commands_forbidden_in_live")
		}
		var in struct {
			Callback   json.RawMessage `json:"callback"`
			CustomerID string          `json:"customerId"`
			UserID     string          `json:"userId"`
			Permission string          `json:"permission"`
			Connection string          `json:"connection"`
			OrderID    string          `json:"orderId"`
			Outcome    string          `json:"outcome"`
			Contract   string          `json:"contract"`
			Recipient  string          `json:"recipient"`
			Amount     string          `json:"amountMinor"`
			Receipt    tron.Receipt    `json:"receipt"`
		}
		d := json.NewDecoder(io.LimitReader(os.Stdin, 2<<20))
		d.DisallowUnknownFields()
		if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
			return errors.New("invalid_input")
		}
		switch command {
		case "deposit-fixture":
			o, err := s.ReceiveFixture(ctx, in.Callback, in.Receipt)
			if err != nil {
				return err
			}
			return json.NewEncoder(os.Stdout).Encode(o)
		case "resolve-fixture":
			return s.ResolveSimulation(ctx, in.CustomerID, in.OrderID, in.Outcome)
		case "grant":
			tx, err := db.Begin(ctx)
			if err != nil {
				return err
			}
			defer tx.Rollback(ctx)
			if in.Connection != "" {
				_, err = tx.Exec(ctx, `INSERT INTO crypto_connection_grants(namespace,connection_id,user_id,permission) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, s.NS(), in.Connection, in.UserID, in.Permission)
			} else {
				_, err = tx.Exec(ctx, `INSERT INTO crypto_grants(namespace,customer_id,user_id,permission) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, s.NS(), in.CustomerID, in.UserID, in.Permission)
			}
			if err != nil {
				return err
			}
			if err = s.Audit(ctx, tx, in.CustomerID, "", in.UserID, "local_grant", map[string]string{"permission": in.Permission, "connection": in.Connection}); err != nil {
				return err
			}
			return tx.Commit(ctx)
		}
	}
	var source *cryptofunds.Source
	if command == "sync" || command == "run-with-readonly-source" {
		c, err := cregis.FromEnv()
		if err != nil {
			return err
		}
		source = &cryptofunds.Source{Service: s, Client: c, Connection: "cregis-waas", Project: os.Getenv("CREGIS_PROJECT_ID"), Key: os.Getenv("CREGIS_API_KEY")}
		if os.Getenv("TRON_NODE_URL") != "" {
			source.Node, e = tron.New(os.Getenv("TRON_NODE_URL"), os.Getenv("TRON_NODE_KEY"))
			if e != nil {
				return e
			}
			source.Contract = os.Getenv("TRON_USDT_CONTRACT")
			source.Network = os.Getenv("TRON_NETWORK")
			if source.Contract == "" || source.Network == "" {
				return errors.New("tron_contract_and_network_required")
			}
		}
	}
	if command != "run" && command != "run-with-readonly-source" && command != "drain" && command != "sync" {
		return errors.New("unknown_command")
	}
	for {
		if source != nil {
			e = source.SyncPage(ctx)
			if e == nil {
				e = source.VerifyObservations(ctx)
			}
		}
		if command != "sync" {
			_, err := s.Drain(ctx)
			if e == nil {
				e = err
			}
		}
		if command == "drain" || command == "sync" {
			return e
		}
		if e != nil {
			fmt.Fprintln(os.Stderr, "crypto worker: retry pending (details withheld)")
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
		fmt.Fprintln(os.Stderr, "crypto worker failed:", e)
		os.Exit(1)
	}
}
