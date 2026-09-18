package database

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WalletAssignment contains reviewed source identities, never an all-future-cards rule.
type WalletAssignment struct {
	ConnectionID     string   `json:"connectionId"`
	AccountID        string   `json:"accountId"`
	VirtualAccountID string   `json:"virtualAccountId"`
	Label            string   `json:"label"`
	Revision         string   `json:"revision"`
	CardIDs          []string `json:"cardIds"`
	Reason           string   `json:"reason"`
	EvidenceRef      string   `json:"evidenceRef"`
}
type WalletPlan struct {
	CustomerID string `json:"customerId"`
	WalletAssignment
	Cards        int    `json:"cards"`
	Transactions int    `json:"transactions"`
	LegacyCards  int    `json:"legacyCardsSuperseded"`
	SHA256       string `json:"sha256"`
	Applied      bool   `json:"applied"`
}

func AssignProjectWalletCards(ctx context.Context, pool *pgxpool.Pool, operatorUID, targetUID string, input WalletAssignment, expectedPlan string, apply bool) (WalletPlan, error) {
	p := WalletPlan{WalletAssignment: input}
	invalid := errors.New("explicit verified wallet scope and fixed card identities required")
	ident := regexp.MustCompile(`^[A-Za-z0-9_-]{1,160}$`)
	if !ident.MatchString(input.ConnectionID) || !ident.MatchString(input.AccountID) || !ident.MatchString(input.VirtualAccountID) || input.Revision == "" || input.Label == "" || len(input.Label) > 100 || input.Reason == "" || len(input.Reason) > 500 || input.EvidenceRef == "" || len(input.EvidenceRef) > 500 || len(input.CardIDs) < 1 || len(input.CardIDs) > 5000 {
		return p, invalid
	}
	p.CardIDs = append([]string(nil), input.CardIDs...)
	sort.Strings(p.CardIDs)
	for i, id := range p.CardIDs {
		if !ident.MatchString(id) || (i > 0 && id == p.CardIDs[i-1]) {
			return p, invalid
		}
	}
	tx, e := pool.Begin(ctx)
	if e != nil {
		return p, e
	}
	defer tx.Rollback(ctx)
	// Same assignment lock as the legacy binder; source head is also locked.
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73019007)`); e != nil {
		return p, e
	}
	var actor string
	e = tx.QueryRow(ctx, `SELECT u.id::text FROM users u JOIN effective_channel_read_grants g ON g.user_id=u.id WHERE u.firebase_uid=$1 AND u.status='active' AND u.role='admin' AND g.connection_id=$2 AND EXISTS(SELECT 1 FROM effective_staff_grants s WHERE s.user_id=u.id)`, operatorUID, input.ConnectionID).Scan(&actor)
	if e != nil {
		return p, errors.New("active operator with source grant required")
	}
	e = tx.QueryRow(ctx, `SELECT c.id::text FROM users u JOIN customers c ON c.personal_owner_id=u.id AND c.kind='personal' WHERE u.firebase_uid=$1 AND u.status='active' AND u.role='customer' FOR UPDATE OF u,c`, targetUID).Scan(&p.CustomerID)
	if e != nil {
		return p, errors.New("active personal customer required")
	}
	var account, revision string
	e = tx.QueryRow(ctx, `SELECT account_ref,revision FROM channel_connections WHERE id=$1 FOR UPDATE`, input.ConnectionID).Scan(&account, &revision)
	if e != nil || account != input.AccountID || revision != input.Revision {
		return p, errors.New("source account or revision changed")
	}
	var conn, va, parent, label string
	e = tx.QueryRow(ctx, `SELECT connection_id,virtual_account_ref,account_ref,label FROM project_wallets WHERE project_key='moventra' FOR UPDATE`).Scan(&conn, &va, &parent, &label)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return p, e
	}
	if conn != "" && (conn != input.ConnectionID || va != input.VirtualAccountID || parent != input.AccountID || label != input.Label) {
		return p, errors.New("project wallet replacement requires separate migration")
	}
	e = tx.QueryRow(ctx, `SELECT count(*) FROM channel_records WHERE connection_id=$1 AND revision=$2 AND kind='card' AND external_id=ANY($3) AND data->>'accountId'=$4 AND data->>'virtualAccountId'=$5`, input.ConnectionID, input.Revision, p.CardIDs, input.AccountID, input.VirtualAccountID).Scan(&p.Cards)
	if e != nil {
		return p, e
	}
	if p.Cards != len(p.CardIDs) {
		return p, errors.New("card missing or outside reviewed wallet")
	}
	var conflicts int
	e = tx.QueryRow(ctx, `SELECT count(*) FROM (
 SELECT customer_id FROM customer_card_bindings WHERE connection_id=$1 AND external_card_id=ANY($2)
 UNION ALL SELECT customer_id FROM project_wallet_cards WHERE connection_id=$1 AND external_card_id=ANY($2)
 ) b WHERE customer_id<>$3`, input.ConnectionID, p.CardIDs, p.CustomerID).Scan(&conflicts)
	if e != nil {
		return p, e
	}
	if conflicts > 0 {
		return p, errors.New("card already assigned to another customer; rebind refused")
	}
	e = tx.QueryRow(ctx, `SELECT count(*) FROM channel_records WHERE connection_id=$1 AND revision=$2 AND kind='transaction' AND data->>'cardId'=ANY($3) AND data->>'accountId'=$4 AND data->>'virtualAccountId'=$5`, input.ConnectionID, input.Revision, p.CardIDs, input.AccountID, input.VirtualAccountID).Scan(&p.Transactions)
	if e != nil {
		return p, e
	}
	e = tx.QueryRow(ctx, `SELECT count(*) FROM customer_card_bindings WHERE customer_id=$1`, p.CustomerID).Scan(&p.LegacyCards)
	if e != nil {
		return p, e
	}
	raw, _ := json.Marshal(p)
	hash := sha256.Sum256(raw)
	p.SHA256 = hex.EncodeToString(hash[:])
	if !apply {
		return p, nil
	}
	if expectedPlan != p.SHA256 {
		return p, errors.New("reviewed plan hash required; plan changed")
	}
	_, e = tx.Exec(ctx, `INSERT INTO project_wallets(project_key,connection_id,account_ref,virtual_account_ref,label,evidence_ref,actor_id) VALUES('moventra',$1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, input.ConnectionID, input.AccountID, input.VirtualAccountID, input.Label, input.EvidenceRef, actor)
	if e != nil {
		return p, e
	}
	enrolled, e := tx.Exec(ctx, `INSERT INTO project_wallet_customers(customer_id,project_key) VALUES($1,'moventra') ON CONFLICT DO NOTHING`, p.CustomerID)
	if e != nil {
		return p, e
	}
	added, e := tx.Exec(ctx, `INSERT INTO project_wallet_cards(connection_id,external_card_id,customer_id,virtual_account_ref,evidence_revision,actor_id,reason) SELECT $1,unnest($2::text[]),$3,$4,$5,$6,$7 ON CONFLICT DO NOTHING`, input.ConnectionID, p.CardIDs, p.CustomerID, input.VirtualAccountID, input.Revision, actor, input.Reason)
	if e != nil {
		return p, e
	}
	if added.RowsAffected() > 0 || enrolled.RowsAffected() > 0 {
		_, e = tx.Exec(ctx, `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,$3)`, actor, p.CustomerID, "project-wallet:assign:"+p.SHA256)
		if e != nil {
			return p, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return p, e
	}
	p.Applied = true
	return p, nil
}
