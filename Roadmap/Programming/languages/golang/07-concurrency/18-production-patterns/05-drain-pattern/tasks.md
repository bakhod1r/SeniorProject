---
layout: default
title: Tasks — Drain Pattern
parent: Drain Pattern
grand_parent: Production Patterns
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/05-drain-pattern/tasks/
---

# Drain Pattern — Tasks

## Table of Contents
1. [Beginner Tasks](#beginner-tasks)
2. [Intermediate Tasks](#intermediate-tasks)
3. [Advanced Tasks](#advanced-tasks)
4. [Capstone Project](#capstone-project)

---

## Beginner Tasks

### Task 1. Smallest drainable program

Write a Go program that:

- Prints "running" every second.
- On Ctrl+C (`SIGINT`) or `SIGTERM`, prints "draining" and exits cleanly.
- Uses `signal.NotifyContext`.

Acceptance criteria:

- Program responds to signal within 100 ms.
- Prints "draining" before exit.
- Exits with code 0.

### Task 2. Worker pool drain

Implement a worker pool with:

- `Start(ctx, n)` — spawns n worker goroutines.
- `Submit(job)` — enqueues a job.
- `Drain(ctx)` — closes the queue and waits for workers, bounded by context.

Acceptance criteria:

- All jobs submitted before drain are processed.
- Drain returns within the context deadline.
- No goroutine leaks (verify with `runtime.NumGoroutine`).

### Task 3. HTTP server with graceful shutdown

Write an HTTP server with a `/slow` endpoint that sleeps for 2 seconds.

- On signal, call `srv.Shutdown(ctx)` with a 5-second deadline.
- Verify that an in-flight `/slow` request completes if drain begins mid-request.

Acceptance criteria:

- Send a request to `/slow`, send `SIGTERM` 0.5s later, verify the response arrives.

### Task 4. Drain with a deadline

Take the worker pool from Task 2. Modify a worker to take 10 seconds for one job. Trigger drain with a 1-second deadline.

Acceptance criteria:

- `Drain` returns `context.DeadlineExceeded`.
- The 10-second job is force-cancelled (worker sees `<-ctx.Done()`).

### Task 5. Readiness endpoint

Add a `/ready` endpoint to Task 3 that:

- Returns 200 when normal.
- Returns 503 when draining.

Acceptance criteria:

- Before signal, `/ready` returns 200.
- After signal (but before exit), `/ready` returns 503.

---

## Intermediate Tasks

### Task 6. Drain with sync.Once

Refactor your worker pool so that `Drain` is idempotent: calling it twice does not panic, and the second call returns immediately. Use `sync.Once`.

### Task 7. Errgroup-coordinated service

Write a service with two long-lived goroutines (a "tick" goroutine and an HTTP server) coordinated by `errgroup.WithContext`. On signal, both should drain in parallel within the deadline.

### Task 8. Drain order

Write a service with three components (A, B, C). A depends on B; B depends on C. Implement drain in the correct order (A → B → C). Verify with logs.

### Task 9. Drain test in CI

Write a Go test that:

- Starts your service.
- Sends synthetic load.
- Sends `SIGTERM` via `Process.Signal`.
- Asserts clean exit within a deadline.
- Asserts no 5xx responses during the drain window.

### Task 10. Drain metric

Instrument your drain function with a Prometheus histogram for duration. Test that the histogram is emitted after each drain.

### Task 11. Drain with idle-wait

Implement a `Drainer` that uses idle-wait semantics: drain is considered complete when in-flight has been zero for 200ms continuously.

### Task 12. Drainable interface

Define a `Drainable` interface and a `Lifecycle` registry that walks registered components in reverse order on drain. Write a small example with three components.

---

## Advanced Tasks

### Task 13. Kafka consumer drain

Using `segmentio/kafka-go` or `sarama`, write a consumer that:

- Reads from a topic.
- Processes each message.
- On drain, stops fetching, waits for in-flight processing, commits offsets, closes.

Acceptance criteria:

- No duplicate processing on rapid restarts.
- Offsets are committed before close.
- Drain returns within budget.

### Task 14. Drain with HTTP client timeouts

In your service, configure an HTTP client with a 30-second timeout. The drain budget is 25 seconds. Demonstrate the bug (drain hangs on stuck downstream). Then fix it by lowering the client timeout below the drain budget.

### Task 15. WebSocket graceful drain

Write a WebSocket server that:

- Maintains a registry of active connections.
- On drain, sends a close frame to each.
- Waits for clients to disconnect (with deadline).
- Force-closes remaining.

### Task 16. Two-phase shutdown

Implement a service with `Quiesce()` and `Drain(ctx)` methods. Quiesce rejects new long-running work but accepts new short-running work. After a quiesce period, full drain begins.

### Task 17. Drain across multiple processes

Write a parent Go program that spawns a child Go program. On `SIGTERM` to the parent, forward `SIGTERM` to the child. Both should drain cleanly.

### Task 18. Drain audit script

Write a Go program that walks a codebase and flags:

- `time.Sleep` calls without a surrounding `select` and `<-ctx.Done()`.
- `os.Exit` calls outside `main`.
- `for { ... }` loops without a context check.
- `wg.Wait()` calls without a deadline.

Run it on an open-source project and report findings.

---

## Capstone Project

### Project: Order Processing Service With Drain

Build a complete order processing service:

- HTTP API accepting orders.
- Worker pool processing orders.
- Postgres for persistence.
- Kafka producer for events.
- Health endpoints (`/ready`, `/healthz`).

Requirements:

- Full drain on `SIGTERM`.
- Configurable drain budget via env var.
- Metrics emitted (`drain_duration_seconds`, `orders_in_flight`).
- Drain test in CI.
- Documentation in code explaining drain order.

Stretch goals:

- Add a Kafka consumer for order updates.
- Add a Redis cache.
- Add OpenTelemetry tracing for drain phases.
- Implement two-phase shutdown.
- Add a chaos test that triggers drain at random times.

Time estimate: 1-2 weeks for a single engineer, including tests and docs.

Deliverables:

- Working binary.
- Test suite covering drain.
- README explaining drain design.
- Postmortem of any drain bugs encountered.

---

## Verification

For each task, verify:

1. Code compiles (`go build`).
2. Tests pass with `go test -race`.
3. No goroutine leaks (`go.uber.org/goleak` recommended).
4. Drain works under realistic load.
5. Metrics are emitted.

A task is "done" when all five hold true.

---

## Submission Checklist

For self-assessment after each task:

- [ ] Code follows Go style (`gofmt`, `golint` clean).
- [ ] Drain uses `signal.NotifyContext`.
- [ ] Drain bounded by context.
- [ ] WaitGroup paired with `defer`.
- [ ] No `os.Exit` outside `main`.
- [ ] Tests run with `-race`.
- [ ] Drain logs duration and outcome.
- [ ] README documents the drain order.

---

## Pacing Suggestions

- Tasks 1-5: Junior level. Complete in a week of evenings.
- Tasks 6-12: Middle level. Complete in two weeks.
- Tasks 13-18: Senior level. Complete in a month.
- Capstone: 1-2 weeks of focused work.

Quality matters more than speed. Each task is meant to teach a pattern; do it well, even if it takes longer.

---

## Tools Recommended

- `go test -race` — always.
- `go.uber.org/goleak` — leak detection.
- `vegeta` — load testing.
- `prometheus/client_golang` — metrics.
- `signal.NotifyContext` — signal handling.
- `golang.org/x/sync/errgroup` — coordination.
- `github.com/stretchr/testify` — test assertions.

---

## Feedback

If you build a clean implementation of the capstone project, ask a senior engineer to code-review it. The drain patterns will be at the centre of the discussion.

Code reviews of drain code are some of the most educational reviews you will receive. Welcome them.

---

## Final Word

These tasks build the muscle memory for drain in Go. Each task takes 30 minutes to a few hours; together they take a month or two.

That investment pays back for years. The drain patterns become natural; you stop thinking about them and just write them.

Go build.

---

## A Note On Solution Quality

There is no single "right" solution to these tasks. Multiple implementations are valid. What matters:

- The drain works under load.
- The drain respects the deadline.
- The drain rejects new work after starting.
- The drain logs and emits metrics.
- The drain is tested.

If your solution meets these, it is correct. Subtle improvements (less code, better naming, fewer locks) come with practice.

---

## A Note On Sharing

If you complete these tasks, consider:

- Publishing your solutions on GitHub.
- Writing a blog post about drain.
- Mentoring others through the tasks.

Drain education is a community good. Pay forward what you learn.

---

End of tasks.

---

## Detailed Task Walkthroughs

For the most important tasks, here are detailed walkthroughs.

### Task 2 Walkthrough — Worker Pool Drain

Start with the type:

```go
type Pool struct {
	queue  chan Job
	wg     sync.WaitGroup
	closed atomic.Bool
	mu     sync.Mutex
}
```

`Start` spawns workers:

```go
func (p *Pool) Start(ctx context.Context, n int) {
	for i := 0; i < n; i++ {
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case j, ok := <-p.queue:
					if !ok {
						return
					}
					process(j)
				}
			}
		}()
	}
}
```

`Submit` enqueues:

```go
func (p *Pool) Submit(j Job) error {
	if p.closed.Load() {
		return errors.New("pool closed")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed.Load() {
		return errors.New("pool closed")
	}
	p.queue <- j
	return nil
}
```

`Drain` is the centrepiece:

```go
func (p *Pool) Drain(ctx context.Context) error {
	p.mu.Lock()
	if p.closed.CompareAndSwap(false, true) {
		close(p.queue)
	}
	p.mu.Unlock()
	done := make(chan struct{})
	go func() { p.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

Test:

```go
func TestPoolDrain(t *testing.T) {
	p := NewPool(8)
	p.Start(context.Background(), 2)
	for i := 0; i < 10; i++ {
		_ = p.Submit(Job{ID: i})
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, p.Drain(ctx))
}
```

Run with `go test -race`. Done.

### Task 13 Walkthrough — Kafka Consumer Drain

Using `segmentio/kafka-go`:

```go
type Consumer struct {
	reader    *kafka.Reader
	inFlight  sync.WaitGroup
	fetchCtx  context.Context
	cancel    context.CancelFunc
}

func (c *Consumer) Start(ctx context.Context, workers int) {
	c.fetchCtx, c.cancel = context.WithCancel(ctx)
	msgs := make(chan kafka.Message, 32)
	go func() {
		defer close(msgs)
		for {
			m, err := c.reader.FetchMessage(c.fetchCtx)
			if err != nil {
				return
			}
			select {
			case <-c.fetchCtx.Done():
				return
			case msgs <- m:
			}
		}
	}()
	for i := 0; i < workers; i++ {
		c.inFlight.Add(1)
		go func() {
			defer c.inFlight.Done()
			for m := range msgs {
				if err := process(m); err != nil {
					continue
				}
				_ = c.reader.CommitMessages(ctx, m)
			}
		}()
	}
}

func (c *Consumer) Drain(ctx context.Context) error {
	c.cancel()
	done := make(chan struct{})
	go func() { c.inFlight.Wait(); close(done) }()
	select {
	case <-done:
		return c.reader.Close()
	case <-ctx.Done():
		_ = c.reader.Close()
		return ctx.Err()
	}
}
```

Test by:

1. Producing 100 messages to a topic.
2. Starting consumer.
3. After 50 messages, sending `SIGTERM`.
4. Verifying that all 100 messages are processed (with no duplicates and no losses).

Acceptance: zero duplicates, zero losses, drain in under 5 seconds.

---

## Bonus Exercises

### Bonus 1. Drain with leak detection

Add `go.uber.org/goleak` to your tests. Verify no goroutine leaks after drain.

```go
func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)
}
```

### Bonus 2. Drain with race detector

All tests run with `go test -race`. Fix any race detector reports.

### Bonus 3. Drain with profiler

Profile a drain in production via `net/http/pprof`. Identify bottlenecks.

### Bonus 4. Drain with tracing

Instrument drain phases with OpenTelemetry. Visualise in Jaeger or Tempo.

### Bonus 5. Drain documentation

Write a 1-page design doc for your service's drain. Include order, budgets, metrics, and known limitations.

---

## Drill Schedule

A 4-week schedule to complete all tasks:

**Week 1:** Tasks 1-5 (junior). Build the recipe.

**Week 2:** Tasks 6-9 (middle). Coordinate components.

**Week 3:** Tasks 10-12 (middle). Idiomatic patterns.

**Week 4:** Tasks 13-15 (advanced). Production scenarios.

Beyond week 4: Tasks 16-18 (advanced) and capstone.

Adjust pace as needed. The goal is depth, not speed.

---

## Pair Programming

If you have a study partner:

- Take turns implementing each task.
- Review each other's solutions.
- Discuss trade-offs.
- Help each other debug.

Drain is teachable in pairs. The questions one partner asks the other are the questions reviewers ask in production code reviews.

---

## Solo Practice

If working alone:

- Time-box each task. 30 minutes for beginner, 1 hour for intermediate, 2 hours for advanced.
- After the time-box, compare with the patterns in the senior/professional pages.
- Note what you missed; learn from it.

---

## Reviewing Your Own Code

A self-review checklist:

- [ ] `signal.NotifyContext` at the top.
- [ ] `Drain(ctx context.Context) error` on each component.
- [ ] Drain bounded by context.
- [ ] `sync.WaitGroup.Wait` not without deadline.
- [ ] Idempotent drain.
- [ ] Metrics emitted.
- [ ] Tests under `-race`.
- [ ] No `os.Exit` outside `main`.

Check each item before declaring a task complete.

---

## Difficulty Calibration

If a beginner task takes more than 1 hour, return to the junior page and re-read. If an intermediate task is easy, skip to advanced. The tasks are signposts; use them to gauge your level.

A typical progression: junior tasks in 1 week, middle in 2-3 weeks, senior in 3-4 weeks. Capstone in 1-2 weeks.

---

## Acknowledgements

These tasks are inspired by patterns I have used in production. The order reflects the order I would teach them to a new engineer.

If you find tasks that should be added, please contribute back to the Roadmap.

---

## Wrap-Up

Drain is a skill built through practice. These tasks are the practice. Do them all, in order, with care.

You will emerge a better Go engineer. Your services will drain cleanly. Your team will benefit.

Go.

