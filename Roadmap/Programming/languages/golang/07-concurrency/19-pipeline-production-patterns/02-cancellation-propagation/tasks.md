---
layout: default
title: Cancellation Propagation — Tasks
parent: Cancellation Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/02-cancellation-propagation/tasks/
---

# Cancellation Propagation — Hands-On Tasks

Practical exercises to build cancellation muscle memory. Each task includes a starting hint and a verification criterion. Solutions are not provided; the point is to do them yourself.

---

## Task 1: Cancellable producer

Write a function `produce(ctx context.Context) <-chan int` that emits integers 0, 1, 2, ... forever on its returned channel. The producer must exit cleanly when `ctx` is cancelled.

**Verification**: a test that cancels after 100 ms and observes that the producer goroutine has exited.

```go
func produce(ctx context.Context) <-chan int {
    // your implementation
}

func TestProduce(t *testing.T) {
    before := runtime.NumGoroutine()
    ctx, cancel := context.WithCancel(context.Background())
    out := produce(ctx)
    <-out
    <-out
    cancel()
    for range out {
    }
    after := runtime.NumGoroutine()
    if after > before {
        t.Errorf("goroutine leaked: %d -> %d", before, after)
    }
}
```

---

## Task 2: Pipeline of three stages

Build a pipeline:

- Stage 1: produce numbers 0..99.
- Stage 2: keep only odds.
- Stage 3: square each.

Make every stage cancellable via a shared context. Run the pipeline with a 50 ms deadline; verify it exits cleanly even if not all numbers are processed.

**Verification**: the pipeline returns within 100 ms; no goroutines leak.

---

## Task 3: Cancel on first error

Use `errgroup` to run 5 tasks in parallel. One of the tasks returns an error after 100 ms; the others run for 500 ms.

Verify that:

- The total time is ~100 ms (not 500 ms).
- All 5 tasks have returned by the time `g.Wait()` returns.
- The returned error is the one from the first failing task.

---

## Task 4: Cancellable HTTP handler

Write an HTTP handler that:

- Reads a `delay` query parameter.
- Sleeps for that duration (in a cancellable way).
- Returns "OK" if the delay completes, "cancelled" if the client disconnected.

**Verification**: a test that cancels the request after 50 ms when the delay is 1 second; expects the handler to return promptly.

---

## Task 5: Fan-out with bounded concurrency

Process a slice of 100 items in parallel, with at most 10 running concurrently. If any item errors, cancel the rest. Use `errgroup.SetLimit`.

**Verification**: timing test that the total work scales with `total / limit`, not with `total`.

---

## Task 6: Worker pool with graceful shutdown

Implement:

```go
type Pool struct { /* ... */ }
func NewPool(ctx context.Context, workers int) *Pool
func (p *Pool) Submit(ctx context.Context, job Job) error
func (p *Pool) Drain() // wait for in-flight jobs
func (p *Pool) Stop()  // cancel immediately
```

- `Submit` returns immediately on success; returns error if pool is cancelled or caller's context cancels.
- `Drain` waits for in-flight jobs to finish.
- `Stop` cancels everything and waits.

**Verification**: leak test using `goleak`.

---

## Task 7: Deadline-aware retry

Implement a retry helper:

```go
func WithRetry(ctx context.Context, fn func(context.Context) error, attempts int, base time.Duration) error
```

- Retries `fn` up to `attempts` times.
- Exponential backoff starting at `base`, doubling each time.
- Backoff is cancellable via `ctx`.
- Returns immediately if `ctx` cancels.

**Verification**: a test that cancels mid-backoff; the function returns within milliseconds.

---

## Task 8: Cancellable I/O wrapper

Write `cancellableCopy(ctx context.Context, dst io.Writer, src io.Reader) error` that:

- Copies from src to dst.
- Returns `ctx.Err()` if the context cancels mid-copy.
- For sources that do not support `SetReadDeadline`, the copy may not abort immediately, but the function must return.

Hint: use a watcher goroutine that closes the source on cancel.

---

## Task 9: Fan-in merger

Implement `merge(ctx context.Context, ins ...<-chan int) <-chan int`:

- Forwards values from all `ins` to the returned channel.
- Closes the returned channel when all inputs close.
- Exits if `ctx` cancels.

**Verification**: provide 3 input channels each producing 10 values; verify all 30 are emitted (in some order).

---

## Task 10: Cancellable database query

Using `database/sql` (with any driver that supports `QueryContext`):

- Open a connection.
- Issue a query that takes a long time.
- Cancel the context.
- Verify the query is aborted promptly.

If you do not have a real DB, simulate with a slow driver.

---

## Task 11: Long-poll endpoint

Build an HTTP handler:

- Long-polls for events from an `events` channel.
- Returns the first event, or 204 No Content if 30 seconds elapse.
- Exits if the client disconnects.

**Verification**: tests for all three cases (event arrives, timeout, disconnect).

---

## Task 12: Supervisor with restart

Implement a supervisor that runs `fn(ctx)` and restarts it on error, with exponential backoff up to a cap. Exits cleanly when `ctx` cancels.

**Verification**: a test where `fn` always fails; verify that after `ctx` cancels, the supervisor exits and the failure count is bounded.

---

## Task 13: Per-tenant context isolation

Implement a multi-tenant context manager:

- `GetTenantContext(tenant string) (context.Context, context.CancelFunc)`.
- Each tenant has its own context derived from the app root.
- Cancelling one tenant does not affect others.
- App shutdown cancels all tenants.

---

## Task 14: Streaming aggregator

Build a pipeline:

- Source emits events with `Timestamp` and `Value` fields.
- Aggregator windows events into 1-second buckets, summing the values.
- Sink prints each window's sum.

Make the whole pipeline cancellable; on cancel, flush the current window if non-empty.

---

## Task 15: HTTP server with graceful shutdown

Build a complete HTTP server:

- Uses `signal.NotifyContext` for SIGTERM/SIGINT.
- `BaseContext` propagates the root context to every request.
- On signal, calls `Shutdown` with a 30-second deadline.
- All handlers respect `r.Context()`.

**Verification**: send SIGTERM during a handler with a 10-second delay; verify shutdown completes within ~10 seconds (waiting for the handler).

---

## Task 16: Hierarchical cancellation

Build a structure where:

- A root context has children A and B.
- A has grandchildren A1 and A2.
- B has grandchild B1.

Verify:

- Cancelling A1 does not affect A2, B, or B1.
- Cancelling A affects A1 and A2 but not B.
- Cancelling root affects everyone.

Use `context.WithCancel` and observe `<-ctx.Done()` in each goroutine.

---

## Task 17: First-result race

Query 3 backends in parallel; return the first successful result; cancel the others.

```go
func firstResult(ctx context.Context, queries []func(context.Context) (Result, error)) (Result, error)
```

**Verification**: timing test that the total time is bounded by the fastest query.

---

## Task 18: Cancellation observability

Add metrics to a pipeline:

- Counter of pipelines completed normally.
- Counter of pipelines cancelled.
- Histogram of cancellation latency (cancel-to-fully-stopped).

Use `expvar` or any metric library.

---

## Task 19: Chaos test

Run a pipeline 1000 times with:

- Random duration before cancel (0-100 ms).
- Random concurrency.
- Random input sizes.

After all runs, verify `runtime.NumGoroutine()` is at baseline.

---

## Task 20: Implement your own `errgroup`-lite

Without using `golang.org/x/sync/errgroup`, implement:

- `Group` struct with `Go(f func() error)` and `Wait() error`.
- Returns the first error.
- Cancels a shared context on first error.

**Verification**: works the same as the real `errgroup` for basic cases.

---

## Task 31: Batch processor with cancellation

Implement a batch processor:

- Collects items into batches of 100 or every 1 second, whichever comes first.
- Flushes the batch.
- On cancellation, flushes any partial batch before exiting.

Use a timer plus a buffer; respect context.

---

## Task 32: Cancellable scheduler

Implement a job scheduler:

- `Schedule(at time.Time, fn func(context.Context))` registers a job.
- A goroutine wakes at each scheduled time and runs the job.
- Cancelling the scheduler cancels all pending jobs.

Use a heap or sorted slice for ordering.

---

## Task 33: Cancellation tracing

Add a wrapper that traces context cancellations:

```go
type tracedCtx struct {
    context.Context
    name string
}

func WithTrace(parent context.Context, name string) context.Context
```

When the context cancels, log the name and cause. Useful for debugging "which context cancelled?"

---

## Task 34: Pipeline with progress reporting

Combine a pipeline with progress events:

- Pipeline processes N items.
- Emits progress events every 100 items.
- Cancellable; on cancel, emits a final "cancelled at K" event.

---

## Task 35: Cancellation-safe finite state machine

Build a finite state machine:

- States: Init, Running, Draining, Stopped.
- Transitions: Init -> Running, Running -> Draining, Draining -> Stopped.
- Each transition validates and updates atomically.
- Cancellation triggers Drain.

Verify with a multi-goroutine test that the state never enters an invalid state.

---

## Stretch tasks

For extra practice:

- **Stretch A**: Implement a cancellable `sync.Cond`-like primitive.
- **Stretch B**: Build a pub-sub broker with per-subscriber cancellation.
- **Stretch C**: Implement a connection pool with cancellable acquire.
- **Stretch D**: Build a rate limiter with cancellable wait.
- **Stretch E**: Implement a circuit breaker that does not count cancellations as failures.

---

## Task 21: Cancellable buffered pipeline

Build a pipeline where stages communicate via buffered channels (capacity 10). Make sure that cancellation can interrupt:

- A producer waiting on a full buffer.
- A consumer waiting on an empty buffer.
- A mid-flight item.

Verify by injecting delays into producer/consumer and confirming cancellation works.

---

## Task 22: Per-call deadlines in a chain

Implement a 3-call chain where each call has its own deadline:

- Top-level deadline: 1 second.
- Call A: 300 ms max.
- Call B: 400 ms max.
- Call C: 200 ms max.

Each call should fail with `context.DeadlineExceeded` if its budget is exceeded; the chain should fail with the same error.

Use `context.WithTimeout` at each step.

---

## Task 23: Reload configuration without restart

Implement a hot-reload mechanism:

- A `Service` struct with a `Run(ctx context.Context)` method.
- A `Reload(newConfig Config)` method that cancels the current internal context and starts a fresh one with the new config.

Verify that:

- Existing work completes during reload (graceful).
- New work uses the new config.
- No goroutines leak across reloads.

---

## Task 24: Cancellation cascade benchmark

Write a benchmark that measures cancellation latency for various fan-out sizes:

- 1, 10, 100, 1000, 10000 goroutines.
- Each waits on `<-ctx.Done()`.
- Measure time from `cancel()` to all goroutines exited.

Plot the results. They should be roughly linear in N.

---

## Task 25: Cancellation under panic

Write a pipeline where one stage may panic. Implement:

- A `recover` at each goroutine boundary.
- On panic, log and cancel the shared context.
- Other stages see the cancel and exit.

Verify the pipeline does not crash the test process.

---

## Task 26: Two-source cancellation

A pipeline takes input from two sources. Either source closing should not cancel the pipeline (other source may still have data); but explicit cancel of the shared context should.

```go
func runFromSources(ctx context.Context, src1, src2 <-chan Item) <-chan Result
```

Test:

- Both sources close: pipeline drains and exits.
- Cancel: pipeline exits immediately.

---

## Task 27: Cancellation observability dashboard

Extend Task 18 with:

- Per-stage cancellation latency.
- Cancellation reason (Canceled, DeadlineExceeded, custom cause).
- In-flight pipeline gauge.

Expose via `/metrics` endpoint compatible with Prometheus.

---

## Task 28: Cancellation in connection pool

Build a connection pool:

- `Get(ctx context.Context) (*Conn, error)`: gets a connection, blocking if pool is full. Cancellable.
- `Put(*Conn)`: returns a connection.
- `Close()`: cancels all in-flight Gets and prevents new ones.

Verify:

- Get respects context cancellation.
- Close cancels waiting Gets.
- No goroutines leak after Close.

---

## Task 29: SSE handler with cancellation

Server-Sent Events handler:

- Streams events from an internal channel.
- Each event is formatted as `data: ...\n\n`.
- Client disconnect cancels the handler.
- A ping every 30 seconds keeps the connection alive.

Verify by testing with a client that disconnects mid-stream.

---

## Task 30: Cancellable parallel map

Implement a parallel map:

```go
func ParallelMap[T, U any](ctx context.Context, in []T, fn func(context.Context, T) (U, error)) ([]U, error)
```

- Processes inputs in parallel (bounded concurrency).
- Cancels remaining on first error.
- Returns the results slice and the error.

Use `errgroup` and a result slice with index-based assignment.

---

## Tips

- Always test with `go test -race`.
- Use `goleak` for leak detection.
- Verify both fast paths (no cancel) and cancel paths.
- Test edge cases: cancel before start, cancel mid-work, cancel after completion.

Solutions: write yourself, test thoroughly, get the muscle memory.
