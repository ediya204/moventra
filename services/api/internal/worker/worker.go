// Package worker runs bounded, sequential batches. Persistence and idempotency
// remain the responsibility of ledger.Service, including unknown outcomes.
package worker

import (
	"context"
	"errors"
	"time"
)

type DrainFunc func(context.Context, int) (int, error)

func Run(ctx context.Context, interval, timeout time.Duration, batch int, drain DrainFunc, report func(int, error)) error {
	if interval <= 0 || timeout <= 0 || batch < 1 || batch > 100 || drain == nil {
		return errors.New("invalid_worker_configuration")
	}
	for ctx.Err() == nil {
		cycle, cancel := context.WithTimeout(ctx, timeout)
		n, err := drain(cycle, batch)
		cancel()
		if ctx.Err() != nil {
			return nil
		}
		if report != nil {
			report(n, err)
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
	return nil
}
