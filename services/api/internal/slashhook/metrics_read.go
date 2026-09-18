package slashhook

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
)

// Metrics are attached only to cards already authorized by channelRead. One
// batch query, no per-card upstream requests. The reporting endpoint is the
// latest fully scanned 30-day window, not a claim of live bank balance.
func ReadMetrics(ctx context.Context, tx pgx.Tx, connection string, ids []string) (map[string]json.RawMessage, error) {
	rows, e := tx.Query(ctx, `SELECT s.external_card_id,jsonb_build_object(
 'cycleSpendMinor',u.spend_minor::text,
 'totalLimitMinor',CASE WHEN COALESCE((u.rules->>'sharedGroup')::boolean,false) THEN NULL ELSE u.rules#>>'{card,spendingRule,utilizationLimit,limitAmount,amountCents}' END,
 'currency','USD','scale',2,'availableMinor',u.available_minor::text,'availableAt',u.collected_at,
 'availability',CASE WHEN u.collected_at IS NULL THEN 'unknown' WHEN u.available_minor IS NULL THEN 'not_supported' ELSE 'available' END,
 'sharedGroup',COALESCE((u.rules->>'sharedGroup')::boolean,false),'nextResetAt',u.next_reset_at,
 'from',r.to_at-interval '30 days','to',r.to_at,'updatedAt',r.completed_at,
 'coverage',CASE WHEN r.id IS NULL THEN 'incomplete' WHEN a.unknown_count>0 THEN 'incomplete' ELSE 'complete' END,
 'spendingMinor',CASE WHEN r.id IS NOT NULL AND a.unknown_count=0 THEN a.spending::text ELSE NULL END,
 'refundMinor',CASE WHEN r.id IS NOT NULL AND a.unknown_count=0 THEN a.refund::text ELSE NULL END,
 'syncState',CASE WHEN EXISTS(SELECT 1 FROM card_metric_runs f WHERE f.connection_id=s.connection_id AND f.external_card_id=s.external_card_id AND f.state='review' AND (r.completed_at IS NULL OR f.created_at>r.completed_at)) THEN 'error'
 WHEN EXISTS(SELECT 1 FROM card_metric_runs f WHERE f.connection_id=s.connection_id AND f.external_card_id=s.external_card_id AND f.state='queued' AND f.purpose<>'history') OR EXISTS(SELECT 1 FROM card_metric_refreshes f WHERE f.connection_id=s.connection_id AND f.external_card_id=s.external_card_id) THEN 'pending' ELSE 'idle' END)
 FROM card_metric_scopes s
 JOIN project_wallet_cards b ON b.connection_id=s.connection_id AND b.external_card_id=s.external_card_id AND b.customer_id=s.customer_id AND b.created_at=s.binding_created_at AND b.virtual_account_ref=s.virtual_account_ref
 JOIN project_wallets w ON w.connection_id=s.connection_id AND w.account_ref=s.account_ref AND w.virtual_account_ref=s.virtual_account_ref
 LEFT JOIN card_utilization_snapshots u ON u.connection_id=s.connection_id AND u.external_card_id=s.external_card_id
 LEFT JOIN LATERAL(SELECT id,to_at,completed_at FROM card_metric_runs r WHERE r.connection_id=s.connection_id AND r.external_card_id=s.external_card_id AND r.state='done' AND r.purpose<>'history' AND r.from_at<=r.to_at-interval '30 days' ORDER BY r.to_at DESC LIMIT 1) r ON true
 LEFT JOIN LATERAL(SELECT
 COALESCE(sum(-t.amount_minor) FILTER(WHERE t.status='posted' AND t.detailed_status='settled' AND t.amount_minor<0 AND t.category_verified),0) AS spending,
 COALESCE(sum(t.amount_minor) FILTER(WHERE t.status='posted' AND t.detailed_status='refund' AND t.amount_minor>=0 AND t.category_verified),0) AS refund,
 count(*) FILTER(WHERE NOT t.category_verified OR t.status NOT IN ('posted','pending','failed') OR t.detailed_status NOT IN ('settled','refund','pending','pending_approval','in_review','failed','declined','canceled','reversed','returned') OR (t.status='posted' AND t.detailed_status NOT IN ('settled','refund')) OR (t.detailed_status='refund' AND t.amount_minor<0) OR (t.status<>'posted' AND t.detailed_status IN ('settled','refund'))) AS unknown_count
 FROM card_source_transactions t WHERE t.connection_id=s.connection_id AND t.external_card_id=s.external_card_id AND t.account_ref=s.account_ref AND t.virtual_account_ref=s.virtual_account_ref AND t.source_date>=r.to_at-interval '30 days' AND t.source_date<r.to_at) a ON true
 WHERE s.connection_id=$1 AND s.external_card_id=ANY($2) AND s.enabled`, connection, ids)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := map[string]json.RawMessage{}
	for rows.Next() {
		var id string
		var b []byte
		if e = rows.Scan(&id, &b); e != nil {
			return nil, e
		}
		out[id] = b
	}
	return out, rows.Err()
}
