package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"moventra.local/api/internal/projection"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	firebase "firebase.google.com/go/v4"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"moventra.local/api/internal/api"
	"moventra.local/api/internal/database"
)

func run() error {
	if os.Getenv("DATABASE_URL") == "" {
		return errors.New("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cfg, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		return errors.New("invalid DATABASE_URL")
	}
	cfg.MaxConns = 5
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return errors.New("database initialization failed")
	}
	defer pool.Close()
	if err = pool.Ping(ctx); err != nil {
		return errors.New("database unavailable")
	}
	if len(os.Args) == 2 && os.Args[1] == "import-channel" {
		var bundle projection.Bundle
		decoder := json.NewDecoder(io.LimitReader(os.Stdin, 64<<20))
		decoder.DisallowUnknownFields()
		if e := decoder.Decode(&bundle); e != nil {
			return errors.New("invalid projection input")
		}
		if e := decoder.Decode(new(any)); e != io.EOF {
			return errors.New("unexpected trailing input")
		}
		importCtx, done := context.WithTimeout(context.Background(), 2*time.Minute)
		defer done()
		if _, e := projection.Import(importCtx, pool, bundle, os.Getenv("PROJECTION_OPERATOR_UID")); e != nil {
			return fmt.Errorf("projection import refused: %w", e)
		}
		slog.Info("read-only projection imported; no customer ledger changed")
		return nil
	}
	if len(os.Args) > 1 {
		if len(os.Args) != 2 || (os.Args[1] != "migrate" && os.Args[1] != "provision-user" && os.Args[1] != "provision-personal" && os.Args[1] != "provision-operator") {
			return errors.New("usage: api [migrate|provision-user|provision-personal|provision-operator]")
		}
		if os.Args[1] == "migrate" {
			if err = database.Migrate(ctx, pool); err != nil {
				return errors.New("migration failed; inspect database and migration version")
			}
			slog.Info("database migrations applied")
			return nil
		}
	}
	if os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != "" {
		return errors.New("auth emulator is not allowed in this API executable")
	}
	project := os.Getenv("FIREBASE_PROJECT_ID")
	if project == "" {
		return errors.New("FIREBASE_PROJECT_ID is required")
	}
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: project})
	if err != nil {
		return errors.New("firebase initialization failed")
	}
	auth, err := app.Auth(ctx)
	if err != nil {
		return errors.New("firebase credentials unavailable")
	}
	if len(os.Args) == 2 && (os.Args[1] == "provision-user" || os.Args[1] == "provision-personal" || os.Args[1] == "provision-operator") {
		uid, email := strings.TrimSpace(os.Getenv("PROVISION_FIREBASE_UID")), strings.TrimSpace(os.Getenv("PROVISION_EMAIL"))
		if uid == "" || email == "" {
			return errors.New("explicit PROVISION_FIREBASE_UID and PROVISION_EMAIL are required")
		}
		user, err := auth.GetUser(ctx, uid)
		if err != nil || user.Disabled || !strings.EqualFold(user.Email, email) {
			return errors.New("Firebase identity does not match the enabled provisioning target")
		}
		if os.Args[1] == "provision-operator" {
			ownerUID, ownerEmail := strings.TrimSpace(os.Getenv("PROVISION_OWNER_UID")), strings.TrimSpace(os.Getenv("PROVISION_OWNER_EMAIL"))
			if ownerUID == "" || ownerEmail == "" || ownerUID == uid {
				return errors.New("distinct explicit owner identity required")
			}
			owner, e := auth.GetUser(ctx, ownerUID)
			if e != nil || owner.Disabled || !owner.EmailVerified || !strings.EqualFold(owner.Email, ownerEmail) {
				return errors.New("verified owner identity does not match")
			}
			customer, e := database.ProvisionOperator(ctx, pool, uid, ownerUID)
			if e != nil {
				return fmt.Errorf("operator provisioning refused: %w", e)
			}
			slog.Info("operator authorization verified; two read scopes; client has no staff grants; MFA remains required", "customer_id", customer)
			return nil
		}
		if os.Args[1] == "provision-personal" {
			if !user.EmailVerified {
				return errors.New("verified email is required")
			}
			customer, err := database.ProvisionPersonal(ctx, pool, uid)
			if err != nil {
				return errors.New("personal provisioning failed; check active local identity")
			}
			slog.Info("personal subject linked; no service activation, funds or staff grants", "customer_id", customer)
			return nil
		}
		// Provision identity only. Never infer customer ownership or staff grants,
		// and never reactivate an existing disabled local user.
		_, err = pool.Exec(ctx, `INSERT INTO users(id,firebase_uid,display_name) VALUES($1,$2,$3) ON CONFLICT(firebase_uid) DO NOTHING`, uuid.NewString(), uid, user.DisplayName)
		if err != nil {
			return errors.New("identity provisioning failed")
		}
		slog.Info("identity provisioning complete; no customer or operator grants assigned")
		return nil
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8870"
	}
	server := http.Server{Addr: ":" + port, Handler: (&api.Server{DB: pool, Verifier: api.FirebaseVerifier{Client: auth}}).Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	stop, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	result := make(chan error, 1)
	go func() { result <- server.ListenAndServe() }()
	slog.Info("api listening", "port", port)
	select {
	case err = <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("http server failed")
	case <-stop.Done():
		shutdown, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelShutdown()
		return server.Shutdown(shutdown)
	}
}
func main() {
	if err := run(); err != nil {
		slog.Error("startup failed", "reason", err.Error())
		os.Exit(1)
	}
}
