package issuing

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Persist only provider fields validated against the frozen order scope. Source
// receipts are separate immutable batches, never rewritten historical imports.
func (s *Service) linkCard(ctx context.Context, tx pgx.Tx, o Order, card Card) error {
	v := o.Snapshot
	if v.ConnectionID == "" || v.VirtualAccountID == "" || card.Projection == nil || card.Projection["id"] != card.ID || card.Projection["accountId"] != v.Supplier.AccountRef || card.Projection["virtualAccountId"] != v.VirtualAccountID || card.Projection["last4"] != card.Last4 {
		return ErrUnknown
	}
	var valid bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM project_wallets w JOIN channel_connections c ON c.id=w.connection_id WHERE w.project_key='moventra' AND w.connection_id=$1 AND w.account_ref=$2 AND w.virtual_account_ref=$3 AND c.account_ref=w.account_ref)`, v.ConnectionID, v.Supplier.AccountRef, v.VirtualAccountID).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return ErrConflict
	}
	// Customer consent is the actor evidence for this automatic fulfillment.
	var actor string
	if err := tx.QueryRow(ctx, `SELECT actor_id::text FROM issuing_consents WHERE order_id=$1 AND customer_id=$2`, o.ID, o.CustomerID).Scan(&actor); err != nil {
		return err
	}
	revision := "issuing-" + o.ID
	safe := map[string]any{}
	for _, key := range []string{"id", "accountId", "virtualAccountId", "last4", "cardStatus", "name", "cardName", "createdAtUTC", "expiryMonth", "expiryYear"} {
		if value, ok := card.Projection[key]; ok {
			safe[key] = value
		}
	}
	raw, err := json.Marshal(safe)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO channel_imports(connection_id,revision,source_at,actor_id,record_count) VALUES($1,$2,now(),$3,1) ON CONFLICT DO NOTHING`, v.ConnectionID, revision, actor); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO channel_records(connection_id,revision,kind,external_id,data) VALUES($1,$2,'card',$3,$4) ON CONFLICT DO NOTHING`, v.ConnectionID, revision, card.ID, raw); err != nil {
		return err
	}
	// The first new card may establish an empty connection's initial revision.
	if _, err = tx.Exec(ctx, `UPDATE channel_connections SET revision=$2,source_at=now(),imported_at=now() WHERE id=$1 AND revision IS NULL`, v.ConnectionID, revision); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO project_wallet_customers(customer_id,project_key) VALUES($1,'moventra') ON CONFLICT DO NOTHING`, o.CustomerID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO project_wallet_cards(connection_id,external_card_id,customer_id,virtual_account_ref,evidence_revision,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,'issuing_order_fulfillment') ON CONFLICT DO NOTHING`, v.ConnectionID, card.ID, o.CustomerID, v.VirtualAccountID, revision, actor); err != nil {
		return err
	}
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM project_wallet_cards WHERE connection_id=$1 AND external_card_id=$2 AND customer_id=$3 AND virtual_account_ref=$4 AND evidence_revision=$5)`, v.ConnectionID, card.ID, o.CustomerID, v.VirtualAccountID, revision).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return ErrConflict
	}
	if _, err = tx.Exec(ctx, `INSERT INTO issuing_card_projections(order_id,customer_id,connection_id,external_card_id,evidence_revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, o.ID, o.CustomerID, v.ConnectionID, card.ID, revision); err != nil {
		return err
	}
	return Audit(ctx, tx, actor, o.CustomerID, o.ID, "card.linked", map[string]string{"connectionId": v.ConnectionID, "cardId": card.ID, "evidenceRevision": revision})
}
func (s *Service) linkFundsCard(ctx context.Context, tx pgx.Tx, o Order, key string) error {
	account, err := s.fundsAccount(ctx, tx, o.CustomerID, key)
	if err != nil {
		return err
	}
	var id string
	// New-card opening is known from the restricted issuance flow. Pending
	// authorizations remain unknown until the card funding verifier supplies them.
	err = tx.QueryRow(ctx, `INSERT INTO funds_cards(id,namespace,customer_id,connection_id,external_card_id,name,last4,ledger_account_id,enabled,opening_verified,authorization_complete,evidence_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,false,true,false,$9) ON CONFLICT(namespace,connection_id,external_card_id) DO UPDATE SET name=funds_cards.name WHERE funds_cards.customer_id=EXCLUDED.customer_id AND funds_cards.ledger_account_id=EXCLUDED.ledger_account_id RETURNING id::text`, uuid.NewString(), s.Funds.Namespace, o.CustomerID, account.ConnectionID, account.ExternalCardID, o.Snapshot.CardName, o.Last4, account.ID, "issuing-order:"+o.ID).Scan(&id)
	if err != nil {
		return err
	}
	return Audit(ctx, tx, "", o.CustomerID, o.ID, "card.subaccount.linked", map[string]string{"fundingCardId": id, "ledgerAccountId": account.ID})
}
