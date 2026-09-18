package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	firebase "firebase.google.com/go/v4"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"moventra.local/api/internal/slashhook"
	"os"
	"strings"
	"time"
)

func cardMetricsCommand(ctx context.Context, db *pgxpool.Pool) error {
	if len(os.Args) != 3 && !(len(os.Args) == 4 && os.Args[1] == "card-metrics-enroll") {
		return errors.New("usage: api card-metrics-plan|card-metrics-status|card-metrics-enroll|card-metrics-retry email [manifest-sha256]")
	}
	if os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != "" {
		return errors.New("emulator_not_allowed")
	}
	app, e := firebase.NewApp(ctx, &firebase.Config{ProjectID: os.Getenv("FIREBASE_PROJECT_ID")})
	if e != nil {
		return errors.New("firebase_unavailable")
	}
	auth, e := app.Auth(ctx)
	if e != nil {
		return errors.New("firebase_unavailable")
	}
	user, e := auth.GetUserByEmail(ctx, os.Args[2])
	if e != nil || !strings.EqualFold(user.Email, os.Args[2]) || user.Disabled || !user.EmailVerified {
		return errors.New("verified_identity_required")
	}
	s := slashhook.New(db, os.Getenv("SLASH_API_KEY"))
	if os.Args[1] == "card-metrics-plan" {
		cards, e := s.PlanMetrics(ctx, user.UID)
		if e != nil {
			return e
		}
		return json.NewEncoder(os.Stdout).Encode(cards)
	}
	if os.Args[1] == "card-metrics-status" {
		cards, e := s.PlanMetrics(ctx, user.UID)
		if e != nil {
			return e
		}
		tx, e := db.Begin(ctx)
		if e != nil {
			return e
		}
		defer tx.Rollback(ctx)
		output := []map[string]any{}
		for _, c := range cards {
			metrics, e := slashhook.ReadMetrics(ctx, tx, c.Connection, []string{c.Card})
			if e != nil {
				return e
			}
			rows, e := tx.Query(ctx, `SELECT purpose,state,pages,record_count,last_error,from_at,to_at FROM card_metric_runs WHERE connection_id=$1 AND external_card_id=$2 ORDER BY created_at`, c.Connection, c.Card)
			if e != nil {
				return e
			}
			runs := []map[string]any{}
			for rows.Next() {
				var purpose, state, last string
				var pages, count int
				var from, to time.Time
				if e = rows.Scan(&purpose, &state, &pages, &count, &last, &from, &to); e != nil {
					rows.Close()
					return e
				}
				runs = append(runs, map[string]any{"purpose": purpose, "state": state, "pages": pages, "records": count, "error": last, "from": from, "to": to})
			}
			e = rows.Err()
			rows.Close()
			if e != nil {
				return e
			}
			output = append(output, map[string]any{"connection": c.Connection, "card": c.Card, "metrics": metrics[c.Card], "runs": runs})
		}
		return json.NewEncoder(os.Stdout).Encode(output)
	}
	if os.Args[1] == "card-metrics-retry" {
		var input struct {
			RunID string `json:"runId"`
		}
		d := json.NewDecoder(io.LimitReader(os.Stdin, 4096))
		d.DisallowUnknownFields()
		if d.Decode(&input) != nil || d.Decode(new(any)) != io.EOF {
			return errors.New("invalid_run")
		}
		return s.RetryMetricRun(ctx, user.UID, input.RunID)
	}
	var cards []slashhook.MetricCard
	if len(os.Args) == 4 {
		cards, e = s.PlanMetrics(ctx, user.UID)
		if e != nil {
			return e
		}
		b, _ := json.Marshal(cards)
		if fmt.Sprintf("%x", sha256.Sum256(b)) != os.Args[3] {
			return errors.New("manifest_changed")
		}
	} else {
		d := json.NewDecoder(io.LimitReader(os.Stdin, 1<<20))
		d.DisallowUnknownFields()
		if d.Decode(&cards) != nil || d.Decode(new(any)) != io.EOF {
			return errors.New("invalid_manifest")
		}
	}
	if e = s.EnrollMetrics(ctx, user.UID, cards); e != nil {
		return e
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"enrolled": len(cards), "financialWrites": false})
}
