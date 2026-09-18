package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"moventra.local/api/internal/projection"
	"moventra.local/api/internal/slashhook"
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
	"moventra.local/api/internal/cregis"
	"moventra.local/api/internal/cryptofunds"
	"moventra.local/api/internal/database"
	"moventra.local/api/internal/depositaddress"
	"moventra.local/api/internal/issuing"
	"moventra.local/api/internal/ledger"
	"moventra.local/api/internal/messages"
)

func run() error {
	if os.Getenv("DATABASE_URL") == "" {
		return errors.New("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cfg, err := database.PoolConfig(os.Getenv("DATABASE_URL"), os.Getenv("DB_MAX_CONNS"))
	if err != nil {
		return err
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return errors.New("database initialization failed")
	}
	defer pool.Close()
	if err = pool.Ping(ctx); err != nil {
		return errors.New("database unavailable")
	}
	if len(os.Args) == 2 && os.Args[1] == "migrate-issuing-unified" {
		return database.MigrateIssuingUnified(ctx, pool)
	}
	if len(os.Args) == 2 && os.Args[1] == "migrate-messages" {
		return database.MigrateMessages(ctx, pool)
	}
	if len(os.Args) == 2 && os.Args[1] == "migrate-global-admin" {
		return database.MigrateGlobalAdmin(ctx, pool)
	}
	if len(os.Args) >= 2 && (os.Args[1] == "global-admin-plan" || os.Args[1] == "global-admin-grant" || os.Args[1] == "global-admin-revoke") {
		return globalAdminCommand(ctx, pool)
	}
	if len(os.Args) == 2 && os.Args[1] == "migrate-card-controls" {
		return database.MigrateCardControls(ctx, pool)
	}
	if len(os.Args) == 2 && os.Args[1] == "configure-production-funds" {
		svc, e := cryptofunds.ProductionFromEnv(pool)
		if e != nil {
			return e
		}
		if svc == nil {
			return errors.New("production_configuration_required")
		}
		return svc.ConfigureProduction(ctx)
	}
	if len(os.Args) == 2 && os.Args[1] == "migrate-manual-funds" {
		return database.MigrateManualFunds(ctx, pool)
	}
	if len(os.Args) == 2 && os.Args[1] == "migrate-card-state-sync" {
		return database.MigrateCardStateSync(ctx, pool)
	}
	if len(os.Args) == 2 && os.Args[1] == "migrate-deposit-addresses" {
		if os.Getenv("CONFIRM_DEPOSIT_SCHEMA") != "yes" {
			return errors.New("explicit_deposit_schema_confirmation_required")
		}
		return database.MigrateDepositAddresses(ctx, pool)
	}
	if len(os.Args) == 2 && os.Args[1] == "prepare-deposit-pilot" {
		if os.Getenv("DEPOSIT_PILOT_MODE") != "prepare" {
			return errors.New("deposit_pilot_prepare_mode_required")
		}
		svc, e := cryptofunds.DepositPilotFromEnv(pool)
		if e != nil {
			return e
		}
		if svc == nil {
			return errors.New("deposit_pilot_configuration_required")
		}
		return svc.PrepareDepositPilot(ctx)
	}
	if len(os.Args) == 2 && os.Args[1] == "import-deposit-address" {
		svc, e := depositaddress.FromEnv(pool)
		if e != nil {
			return e
		}
		if svc == nil {
			return errors.New("deposit_address_configuration_required")
		}
		var in struct {
			CustomerID string `json:"customerId"`
			Address    string `json:"address"`
			Evidence   string `json:"evidence"`
		}
		d := json.NewDecoder(io.LimitReader(os.Stdin, 4096))
		d.DisallowUnknownFields()
		if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
			return errors.New("invalid_import")
		}
		return svc.Import(ctx, in.CustomerID, in.Address, in.Evidence)
	}
	if len(os.Args) == 2 && strings.HasPrefix(os.Args[1], "slash-webhook-") {
		hook := slashhook.New(pool, os.Getenv("SLASH_API_KEY"))
		switch os.Args[1] {
		case "slash-webhook-migrate":
			return database.MigrateSlashWebhook(ctx, pool)
		case "slash-webhook-init":
			return hook.Init(ctx)
		case "slash-webhook-enable-card-controls":
			return hook.EnableCardControls(ctx, os.Getenv("CARD_SYNC_CONNECTION"))
		case "slash-webhook-enable-card-sync":
			return hook.EnableCardSync(ctx, os.Getenv("CARD_SYNC_CONNECTION"), os.Getenv("CARD_SYNC_HOOK_CONNECTION"))
		case "slash-webhook-status":
			status, e := hook.Status(ctx)
			if e != nil {
				return e
			}
			return json.NewEncoder(os.Stdout).Encode(status)
		default:
			return errors.New("unknown_slash_webhook_command")
		}
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
	if len(os.Args) == 2 && os.Args[1] == "grant-existing-onboarding" {
		if os.Getenv("CONFIRM_EXISTING_CUSTOMER_SCOPES") != "yes" {
			return errors.New("CONFIRM_EXISTING_CUSTOMER_SCOPES=yes is required")
		}
		count, e := database.GrantExistingOnboarding(ctx, pool)
		if e != nil {
			return errors.New("onboarding scope grant failed; transaction rolled back")
		}
		slog.Info("existing customer onboarding scopes granted and audited", "new_grants", count)
		return nil
	}
	if len(os.Args) == 2 && os.Args[1] == "migrate-test-funds" {
		return database.MigrateTestFunds(ctx, pool)
	}
	if len(os.Args) == 2 && os.Args[1] == "migrate-test-wallet" {
		return database.MigrateTestWallet(ctx, pool)
	}
	testWalletCmd := len(os.Args) == 2 && (os.Args[1] == "test-wallet-plan" || os.Args[1] == "grant-test-wallet" || os.Args[1] == "test-funds-review-plan" || os.Args[1] == "enable-test-funds-reviews")
	projectWalletCmd := len(os.Args) == 2 && (os.Args[1] == "project-wallet-plan" || os.Args[1] == "project-wallet-apply")
	bindingCommand := len(os.Args) == 2 && (os.Args[1] == "card-bindings-plan" || os.Args[1] == "bind-card-snapshot")
	if len(os.Args) > 1 && !bindingCommand && !testWalletCmd && !projectWalletCmd {
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
	if testWalletCmd {
		if os.Args[1] == "test-funds-review-plan" || os.Args[1] == "enable-test-funds-reviews" {
			return testFundsReviewCommand(ctx, pool, auth, os.Args[1] == "enable-test-funds-reviews")
		}
		return testWalletCommand(ctx, pool, auth, os.Args[1] == "grant-test-wallet")
	}
	if projectWalletCmd {
		return projectWalletCommand(ctx, pool, auth, os.Args[1] == "project-wallet-apply")
	}
	if bindingCommand {
		return cardBindings(ctx, pool, auth, os.Args[1] == "bind-card-snapshot")
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
	shadowLedger, err := ledger.FromEnv(pool)
	if err != nil {
		return err
	}
	issuingService, err := issuing.FromEnv(pool)
	if err != nil {
		return err
	}
	if issuingService.Funds != nil {
		if err = database.ReadyIssuingUnified(ctx, pool); err != nil {
			return err
		}
	}
	deposits, err := depositaddress.FromEnv(pool)
	if err != nil {
		return err
	}
	pilot, err := cryptofunds.DepositPilotFromEnv(pool)
	if err != nil {
		return err
	}
	production, err := cryptofunds.ProductionFromEnv(pool)
	if err != nil {
		return err
	}
	messageService, err := messages.FromEnv(pool)
	if err != nil {
		return err
	}
	if messageService != nil {
		if err = messageService.Check(ctx); err != nil {
			return errors.New("messages_storage_not_ready")
		}
	}
	hook := slashhook.New(pool, os.Getenv("SLASH_API_KEY"))
	handler := hook.Handler((&api.Server{Messages: messageService, CardSecrets: api.CardSecretsFromEnv(), ProductionFunds: production, DepositPilot: pilot, Deposits: deposits, DB: pool, Verifier: api.FirebaseVerifier{Client: auth}, Directory: api.FirebaseUserDirectory{Client: auth}, Ledger: shadowLedger, Issuing: issuingService}).Handler())
	if os.Getenv("CREGIS_SOURCE_ENABLED") == "true" {
		funding, e := cryptofunds.New(shadowLedger)
		if e != nil {
			return e
		}
		client, e := cregis.FromEnv()
		if e != nil {
			return e
		}
		source := &cryptofunds.Source{Service: funding, Client: client, Connection: "cregis-waas", Project: os.Getenv("CREGIS_PROJECT_ID"), Key: os.Getenv("CREGIS_API_KEY")}
		handler = source.Handler(handler)
	}
	server := http.Server{Addr: ":" + port, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	stop, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	if messageService != nil && os.Getenv("MESSAGES_WORKER_ENABLED") == "true" {
		go messageService.Run(stop)
	}
	if production != nil && os.Getenv("FUNDS_PRODUCTION_MODE") == "enabled" {
		go production.RunProduction(stop)
	}
	if pilot != nil && os.Getenv("DEPOSIT_PILOT_MODE") == "enabled" {
		go pilot.RunDepositPilot(stop)
	}
	if os.Getenv("SLASH_API_KEY") != "" {
		go hook.Run(stop)
	}
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
