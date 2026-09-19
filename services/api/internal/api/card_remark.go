package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

func remarksReady(ctx context.Context, tx pgx.Tx) (bool, error) {
	var ready bool
	err := tx.QueryRow(ctx, `SELECT to_regclass('public.customer_card_remarks') IS NOT NULL`).Scan(&ready)
	return ready, err
}
func attachCardRemarks(ctx context.Context, tx pgx.Tx, customer, connection string, data []json.RawMessage) error {
	ready, err := remarksReady(ctx, tx)
	if err != nil {
		return err
	}
	ids := []string{}
	for _, raw := range data {
		var row struct {
			ID string `json:"id"`
		}
		json.Unmarshal(raw, &row)
		ids = append(ids, row.ID)
	}
	type entry struct {
		value    string
		revision int
	}
	values := map[string]entry{}
	if ready {
		rows, err := tx.Query(ctx, `SELECT external_card_id,remark,revision FROM customer_card_remarks WHERE customer_id=$1 AND connection_id=$2 AND external_card_id=ANY($3)`, customer, connection, ids)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id, value string
			var revision int
			if err = rows.Scan(&id, &value, &revision); err != nil {
				rows.Close()
				return err
			}
			values[id] = entry{value, revision}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
	}
	for i, raw := range data {
		var row map[string]any
		json.Unmarshal(raw, &row)
		v := values[row["id"].(string)]
		row["remark"] = v.value
		row["remarkRevision"] = v.revision
		row["remarkEditable"] = ready
		data[i], _ = json.Marshal(row)
	}
	return nil
}
func (s *Server) saveCardRemark(w http.ResponseWriter, r *http.Request, tx pgx.Tx, p principal, customer, connection, id, revision string, walletScoped bool) {
	var in struct {
		Remark   *string `json:"remark"`
		Revision *int    `json:"revision"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	d.DisallowUnknownFields()
	if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF || in.Remark == nil || in.Revision == nil || *in.Revision < 0 || !utf8.ValidString(*in.Remark) || utf8.RuneCountInString(*in.Remark) > 200 || strings.ContainsRune(*in.Remark, 0) {
		fail(w, 400, "invalid_card_remark")
		return
	}
	ready, err := remarksReady(r.Context(), tx)
	if err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if !ready {
		fail(w, 409, "card_remarks_unavailable")
		return
	}
	// Lock the already-authorized owner and assignment against concurrent revocation.
	var owner string
	err = tx.QueryRow(r.Context(), `SELECT id::text FROM customers WHERE id=$1 AND personal_owner_id=$2 FOR SHARE`, customer, p.ID).Scan(&owner)
	if err != nil {
		fail(w, 409, "remark_conflict")
		return
	}
	if walletScoped {
		err = tx.QueryRow(r.Context(), `SELECT b.external_card_id FROM project_wallet_cards b JOIN project_wallets w ON w.connection_id=b.connection_id AND w.virtual_account_ref=b.virtual_account_ref JOIN project_wallet_customers u ON u.customer_id=b.customer_id AND u.project_key=w.project_key WHERE b.customer_id=$1 AND b.connection_id=$2 AND b.external_card_id=$3 FOR SHARE OF b,w,u`, customer, connection, id).Scan(&owner)
	} else {
		err = tx.QueryRow(r.Context(), `SELECT external_card_id FROM customer_card_bindings WHERE customer_id=$1 AND connection_id=$2 AND external_card_id=$3 AND revision=$4 FOR SHARE`, customer, connection, id, revision).Scan(&owner)
	}
	if err != nil {
		fail(w, 409, "remark_conflict")
		return
	}
	value := strings.TrimSpace(*in.Remark)
	var next int
	if *in.Revision == 0 {
		err = tx.QueryRow(r.Context(), `INSERT INTO customer_card_remarks(customer_id,connection_id,external_card_id,remark,revision,updated_by) VALUES($1,$2,$3,$4,1,$5) ON CONFLICT DO NOTHING RETURNING revision`, customer, connection, id, value, p.ID).Scan(&next)
	} else {
		err = tx.QueryRow(r.Context(), `UPDATE customer_card_remarks SET remark=$4,revision=revision+1,updated_by=$5,updated_at=now() WHERE customer_id=$1 AND connection_id=$2 AND external_card_id=$3 AND revision=$6 RETURNING revision`, customer, connection, id, value, p.ID, *in.Revision).Scan(&next)
	}
	if err != nil {
		fail(w, 409, "remark_conflict")
		return
	}
	// No remark text or sensitive card data in the audit log.
	if _, err = tx.Exec(r.Context(), `INSERT INTO audit_events(actor_id,customer_id,action) VALUES($1,$2,$3)`, p.ID, customer, "card-remark:update:"+connection+":"+id); err != nil {
		fail(w, 503, "temporarily_unavailable")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 409, "remark_conflict")
		return
	}
	respond(w, 200, map[string]any{"data": map[string]any{"remark": value, "remarkRevision": next, "remarkEditable": true}})
}
