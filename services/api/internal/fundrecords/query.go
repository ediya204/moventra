// Package fundrecords provides a read-only, authorized union of business records.
package fundrecords

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

//go:embed records.sql
var querySQL string
var ID = regexp.MustCompile(`^(crypto|manual|issuing|issuing_deposit)_[0-9a-f-]{36}_(principal|fee|funding|refund-[0-9a-f-]{36})$`)
var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var ErrQuery = errors.New("invalid_query")

func Parse(v url.Values, id string) (map[string]string, error) {
	q := map[string]string{"page": "0"}
	if id != "" {
		if !ID.MatchString(id) || len(v) != 0 {
			return nil, ErrQuery
		}
		q["id"] = id
		return q, nil
	}
	allowed := map[string]string{"kind": "deposit,withdrawal,card_in,card_out,otc,manual_in,manual_out,reversal,opening_fee,fee,fee_refund,funding_return", "status": "pending_review,processing,completed,failed,rejected,cancelled,unknown", "currency": "USD,USDT"}
	for k, vs := range v {
		if len(vs) != 1 {
			return nil, ErrQuery
		}
		s := vs[0]
		if !strings.Contains(",kind,status,currency,page,customerId,cardId,from,to,q,", ","+k+",") {
			return nil, ErrQuery
		}
		if s == "" {
			continue
		}
		switch k {
		case "kind", "status", "currency":
			ok := false
			for _, a := range strings.Split(allowed[k], ",") {
				ok = ok || s == a
			}
			if !ok {
				return nil, ErrQuery
			}
		case "page":
			n, e := strconv.Atoi(s)
			if e != nil || n < 0 || n > 100000 {
				return nil, ErrQuery
			}
		case "customerId", "cardId":
			if !uuid.MatchString(s) {
				return nil, ErrQuery
			}
		case "from", "to":
			if _, e := time.Parse(time.RFC3339, s); e != nil {
				return nil, ErrQuery
			}
		case "q":
			if len(s) > 180 {
				return nil, ErrQuery
			}
		default:
			return nil, ErrQuery
		}
		q[k] = s
	}
	if q["from"] != "" && q["to"] != "" {
		a, _ := time.Parse(time.RFC3339, q["from"])
		b, _ := time.Parse(time.RFC3339, q["to"])
		if !a.Before(b) {
			return nil, ErrQuery
		}
	}
	return q, nil
}

// Query uses one SQL snapshot for count and page, so concurrent writes cannot
// make the returned count describe a different filter or source snapshot.
func Query(ctx context.Context, tx pgx.Tx, actor string, admin bool, namespace string, dedicated bool, q map[string]string) (json.RawMessage, error) {
	raw, _ := json.Marshal(q)
	page, _ := strconv.Atoi(q["page"])
	var out json.RawMessage
	err := tx.QueryRow(ctx, querySQL+` SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'records',COALESCE((SELECT jsonb_agg(data ORDER BY created_at DESC,id DESC) FROM (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET $6) p),'[]'::jsonb))`, actor, admin, namespace, dedicated, raw, page*20).Scan(&out)
	return out, err
}

// Evidence is loaded only after Query has authorized the exact record.
func Evidence(ctx context.Context, tx pgx.Tx, namespace, customer, source, order string, dedicated bool) (json.RawMessage, error) {
	var out json.RawMessage
	if dedicated {
		err := tx.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (
   SELECT j.reference AS id,p.step,'applied' AS state,'USD' AS currency,j.amount_minor::text AS "amountMinor",p.src AS "from",p.dst AS "to",j.created_at AS "createdAt"
   FROM (VALUES ('reserve','wallet','escrow'),('fee','escrow','fee'),('fund','escrow','card'),('unfund','card','wallet'),('release','escrow','wallet'),('deposit','clearing','wallet')) p(step,src,dst)
   JOIN issuing_journal j ON j.customer_id=$1 AND j.reference='mvl_'||encode(sha256(convert_to(to_json($2::text||':'||p.step)::text,'UTF8')),'hex')
   ORDER BY j.created_at,j.reference) x`, customer, order).Scan(&out)
		return out, err
	}
	prefix := map[string]string{"crypto": "crypto-order:", "manual": "manual-order:", "issuing": "issuing-order:", "issuing_deposit": "issuing-deposit:"}[source]
	err := tx.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (SELECT l.id,l.effect_key AS step,l.state,l.currency,l.amount_minor::text AS "amountMinor",a.kind AS "from",b.kind AS "to",l.created_at AS "createdAt" FROM ledger_operations l JOIN ledger_accounts a ON a.id=l.source_id JOIN ledger_accounts b ON b.id=l.destination_id WHERE l.namespace=$1 AND l.customer_id=$2 AND (l.evidence_ref=$3 OR ($4='crypto' AND l.evidence_ref IN (SELECT NULLIF(data->>'evidenceRef','') FROM crypto_orders WHERE namespace=$1 AND customer_id=$2 AND id::text=$5 AND kind='deposit'))) ORDER BY l.created_at,l.id LIMIT 101) x`, namespace, customer, prefix+order, source, order).Scan(&out)
	return out, err
}
