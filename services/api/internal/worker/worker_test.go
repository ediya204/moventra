package worker

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRetryAfterFailure(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	calls, reports := 0, 0
	err := Run(ctx, time.Millisecond, time.Second, 20, func(ctx context.Context, limit int) (int, error) {
		calls++
		if limit != 20 {
			t.Fatal(limit)
		}
		if calls == 1 {
			return 1, errors.New("temporary")
		}
		cancel()
		return 0, nil
	}, func(n int, err error) {
		reports++
		if n != 1 || err == nil {
			t.Fatal("failure hidden")
		}
	})
	if err != nil || calls != 2 || reports != 1 {
		t.Fatal(err, calls, reports)
	}
}

func TestBatchTimeoutAndShutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0
	err := Run(ctx, time.Millisecond, 5*time.Millisecond, 1, func(c context.Context, _ int) (int, error) {
		calls++
		<-c.Done()
		if calls == 1 && !errors.Is(c.Err(), context.DeadlineExceeded) {
			t.Fatal(c.Err())
		}
		return 0, c.Err()
	}, func(_ int, err error) {
		if err == nil {
			t.Fatal("timeout hidden")
		}
		cancel()
	})
	if err != nil || calls != 1 {
		t.Fatal(err, calls)
	}
}

func TestCancelledBeforeStart(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Run(ctx, time.Second, time.Second, 1, func(context.Context, int) (int, error) { t.Fatal("drained after cancellation"); return 0, nil }, nil); err != nil {
		t.Fatal(err)
	}
}

func TestInvalidConfig(t *testing.T) {
	if Run(context.Background(), 0, time.Second, 1, nil, nil) == nil {
		t.Fatal("invalid config accepted")
	}
}

func TestShutdownCancelsActiveBatch(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		finished <- Run(ctx, time.Hour, time.Hour, 1, func(c context.Context, _ int) (int, error) {
			close(started)
			<-c.Done()
			return 0, c.Err()
		}, nil)
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("worker did not start")
	}
	cancel()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown blocked")
	}
}
