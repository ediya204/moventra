package ledger

import (
	"context"
	"time"
)

// QueueStatus is an operational summary, not a balance or reconciliation result.
// It is available only to trusted local tooling, never through customer APIs.
type QueueStatus struct {
	ObservedAt                time.Time `json:"observedAt"`
	Runnable                  int64     `json:"runnable"`
	Due                       int64     `json:"due"`
	AwaitingProvider          int64     `json:"awaitingProvider"`
	ProviderUnknown           int64     `json:"providerUnknown"`
	ReviewRequired            int64     `json:"reviewRequired"`
	Retrying                  int64     `json:"retrying"`
	OldestRunnableSeconds     *int64    `json:"oldestRunnableSeconds"`
	OldestDueSeconds          *int64    `json:"oldestDueSeconds"`
	OldestProviderWaitSeconds *int64    `json:"oldestProviderWaitSeconds"`
}

func (s *Service) QueueStatus(ctx context.Context) (QueueStatus, error) {
	var out QueueStatus
	err := s.DB.QueryRow(ctx, `WITH active AS (
	 SELECT *, state IN ('pending','commit_pending','release_pending') AS runnable
	 FROM ledger_operations WHERE namespace=$1
	 AND state IN ('pending','commit_pending','release_pending','awaiting_provider','provider_unknown','review_required')
	) SELECT now(),
	 count(*) FILTER (WHERE runnable),
	 count(*) FILTER (WHERE runnable AND next_attempt_at<=now()),
	 count(*) FILTER (WHERE state='awaiting_provider'),
	 count(*) FILTER (WHERE state='provider_unknown'),
	 count(*) FILTER (WHERE state='review_required'),
	 count(*) FILTER (WHERE runnable AND attempts>0),
	 GREATEST(0,EXTRACT(EPOCH FROM now()-min(created_at) FILTER (WHERE runnable))::bigint),
	 GREATEST(0,EXTRACT(EPOCH FROM now()-min(next_attempt_at) FILTER (WHERE runnable AND next_attempt_at<=now()))::bigint),
	 GREATEST(0,EXTRACT(EPOCH FROM now()-min(updated_at) FILTER (WHERE state IN ('awaiting_provider','provider_unknown')))::bigint)
	 FROM active`, s.Namespace).Scan(&out.ObservedAt, &out.Runnable, &out.Due,
		&out.AwaitingProvider, &out.ProviderUnknown, &out.ReviewRequired, &out.Retrying,
		&out.OldestRunnableSeconds, &out.OldestDueSeconds, &out.OldestProviderWaitSeconds)
	if err != nil {
		return QueueStatus{}, err
	}
	// PostgreSQL GREATEST ignores NULL; expose absence explicitly as null.
	if out.Runnable == 0 {
		out.OldestRunnableSeconds = nil
	}
	if out.Due == 0 {
		out.OldestDueSeconds = nil
	}
	if out.AwaitingProvider+out.ProviderUnknown == 0 {
		out.OldestProviderWaitSeconds = nil
	}
	return out, nil
}
