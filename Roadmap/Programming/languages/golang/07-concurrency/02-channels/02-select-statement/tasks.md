# Select Statement — Hands-on Tasks

A graded set of exercises that build real `select`-driven systems. Each task lists what to build, hints, and acceptance criteria. Solutions are intentionally not provided — that is what makes them tasks. Use the rest of the suite (junior/middle/senior) as reference material.

## Table of Contents
1. [Task Set 1 — Basics (Junior)](#task-set-1-basics-junior)
2. [Task Set 2 — Patterns (Middle)](#task-set-2-patterns-middle)
3. [Task Set 3 — Systems (Senior)](#task-set-3-systems-senior)
4. [Task Set 4 — Production (Professional)](#task-set-4-production-professional)
5. [Task Set 5 — Open-Ended Designs](#task-set-5-open-ended-designs)
6. [Self-Grading Rubric](#self-grading-rubric)

---

## Task Set 1 — Basics (Junior)

### Task 1.1 — First select
Write `pickFirst(a, b <-chan string) string` that returns whichever channel produces a value first. If both deliver simultaneously, the function may return either.

**Acceptance:**
- The function blocks until at least one value arrives.
- It does not panic on closed channels (use `v, ok`).
- It does not leak any goroutines.

### Task 1.2 — Non-blocking peek
Write `tryReceive[T any](ch <-chan T) (T, bool)` that returns `(v, true)` if a value is available right now, otherwise `(zero, false)`. The function must not block.

**Hints:**
- Use `default`.

### Task 1.3 — Timeout receive
Write `recvWithTimeout[T any](ch <-chan T, d time.Duration) (T, error)`. Returns the value or an `ErrTimeout`. Use `time.After`.

**Acceptance:**
- Returns the value if it arrives within `d`.
- Returns `ErrTimeout` if not.
- Idiomatic, ten lines or fewer.

### Task 1.4 — Done channel cancellation
Write a goroutine `func count(done <-chan struct{}, out chan<- int)` that emits incrementing integers (starting at 0) on `out`, one every 100 ms, until `done` is closed. After cancellation, close `out` and return.

**Acceptance:**
- Closes `out` exactly once.
- Exits within 200 ms of `done` being closed.
- No goroutine leak.

### Task 1.5 — Block-forever main
Write a small program in `main` that starts a worker goroutine which prints "tick" every second forever, and uses `select{}` to keep the program alive.

**Acceptance:**
- Compiles, runs, prints ticks.
- `main` does not exit on its own.

---

## Task Set 2 — Patterns (Middle)

### Task 2.1 — Reusable timer
Refactor this loop to use `time.NewTimer` instead of `time.After`:
```go
for {
    select {
    case msg := <-in:
        handle(msg)
    case <-time.After(time.Second):
        log.Println("idle")
    }
}
```
Keep behaviour identical. Document the Stop/Reset dance with a comment.

**Acceptance:**
- Uses one `*time.Timer` for the lifetime of the loop.
- Calls `Stop` and `Reset` correctly (no spurious firings).
- Includes a `<-ctx.Done()` exit path.

### Task 2.2 — Heartbeat worker
Write `func worker(ctx context.Context, jobs <-chan Job, hb chan<- struct{}) error` that:
- Processes `jobs` until cancelled.
- Emits a heartbeat on `hb` every 5 seconds, dropping if `hb` is full.
- Returns `ctx.Err()` when cancelled.

### Task 2.3 — Drop-on-full enqueue
Implement `EventBus` with method `Publish(e Event) bool` that returns `true` if `e` was accepted into a fixed-capacity buffer, `false` if dropped. Internally use one buffered channel and one consumer goroutine.

**Acceptance:**
- No mutex; coordination through the channel only.
- Bounded memory under unbounded `Publish` rate.
- Drop counter exposed via `DroppedCount() uint64` (use `sync/atomic`).

### Task 2.4 — Fan-in
Write `Merge(ctx context.Context, sources ...<-chan int) <-chan int` that merges any number of source channels into one. Closes the output when all sources are drained or context is cancelled.

**Acceptance:**
- One goroutine per source.
- A coordinator goroutine `close()`s `out` exactly once.
- Cancellation honoured promptly (within 50 ms in tests).

### Task 2.5 — Gated send queue
Build a queue with: `Push(v T) bool` (drops on full) and `Out() <-chan T` (consumer reads here). Internally use a slice as a buffer and a single goroutine that drives a `select` whose send case is gated by buffer state — when the slice is empty, set the send-side channel variable to `nil` so the case is disabled.

**Hints:**
- The single goroutine pattern from middle.md ("gated send").

### Task 2.6 — Priority select
Implement a router that prefers `urgent <-chan Job` over `normal <-chan Job` without starving normal traffic. The two-level select pattern is the right tool. Add a counter that increments when normal is processed.

**Acceptance:**
- Under sustained urgent load, normal still receives at least 1 in 10 messages over 10000 iterations.
- No `default + sleep` polling.

---

## Task Set 3 — Systems (Senior)

### Task 3.1 — RPC client with timeout
Wrap an HTTP client so each call has both a per-request timeout and respects a parent context. Implement:
```go
func (c *Client) Get(ctx context.Context, url string, timeout time.Duration) ([]byte, error)
```
Use `context.WithTimeout` plus a `select` to cover (a) result, (b) context cancellation, (c) timeout.

### Task 3.2 — Worker pool with graceful shutdown
Build `Pool` with `Submit(j Job) error` and `Shutdown(ctx context.Context) error`. Implementation:
- N worker goroutines, each with a for-select over `jobs` and `<-ctx.Done()`.
- `Submit` returns an error if pool is shut down.
- `Shutdown` stops accepting new jobs, drains the queue with a deadline from `ctx`, and returns `ctx.Err()` if the deadline fires before drain.

**Acceptance:**
- Race-free under `go test -race`.
- No goroutine leak after `Shutdown` returns (verify with `goleak`).
- Submit-after-shutdown returns a clean error, not a panic.

### Task 3.3 — Periodic flusher
Build a `Flusher[T any]` that batches values via `Add(v T)` and flushes every `interval` seconds OR when the buffer reaches `maxSize`, calling a user-supplied `Flush(batch []T)`. Implementation uses a single goroutine with a for-select over `add chan T`, `time.Ticker`, and `<-ctx.Done()`. Flush on shutdown to avoid losing buffered values.

### Task 3.4 — Reflect-based dynamic select
Write `WaitFirst(channels ...<-chan int) (chosen int, value int)` using `reflect.Select`. Returns the index of the channel that fired first and the value received. If a channel was closed, the value is the zero value.

**Acceptance:**
- Handles up to 100 channels.
- No goroutine leak.

### Task 3.5 — Token bucket rate limiter
Implement a token bucket rate limiter using `select` and a `time.Ticker`. Methods:
- `Take(ctx) error` — blocks until a token is available; returns `ctx.Err()` if cancelled.
- `Stop()` — stops the ticker and frees resources.

The internal goroutine ticks tokens into a buffered channel up to capacity; `Take` selects on the channel and `<-ctx.Done()`.

### Task 3.6 — Pub/sub with topic subscriptions
Build `Broker` with `Subscribe(topic string) (<-chan Msg, func())` and `Publish(topic string, m Msg)`. Internally use one goroutine per subscriber that runs a for-select over the subscriber's channel, the unsubscribe channel, and `<-broker.done`.

**Acceptance:**
- Unsubscribe cleans up all goroutines and channels for that subscriber.
- Publishing to a topic with no subscribers is a no-op (not an error).
- Slow subscribers do not block the broker (use `default` to drop).

---

## Task Set 4 — Production (Professional)

### Task 4.1 — Leak-test with goleak
Add `goleak` to your test suite for one of the previous tasks. Write a leak-test that:
- Starts the system.
- Sends some work.
- Cancels the context.
- Asserts no leftover goroutines after a 200 ms grace period.

### Task 4.2 — Metrics on case selection
Take the worker pool from 3.2 and add metrics:
- `pool_jobs_processed_total{worker="N"}`
- `pool_idle_seconds_total{worker="N"}`
- `pool_shutdown_total`

Increment them inside the appropriate `case` of the for-select. Expose via Prometheus.

### Task 4.3 — Replace `time.After` across a codebase
Take an existing repo (your own or open-source) and find every use of `time.After`. For each one:
- Decide if it is fine (one-shot at API boundary) or a leak (in a loop or hot path).
- For each leak, replace with `time.NewTimer`/`Reset`/`Stop`.
- Add a CI lint rule (a `staticcheck` config or a `go vet` analyser) that flags new uses of `time.After` outside an allowlist.

### Task 4.4 — Graceful HTTP server
Wrap `http.Server` so `Run(ctx)` listens until `ctx` is cancelled, then calls `Shutdown` with a fresh `30s` context for drain. Use a top-level `errgroup` and a hard-deadline `time.AfterFunc` for last-resort termination.

**Acceptance:**
- Sending SIGINT during a slow request lets the request finish within 30s.
- After 30s, the server exits even if requests are still in flight.

### Task 4.5 — Trace-driven optimisation
Run `runtime/trace` on a service of your choice (any of the previous tasks). Identify any goroutine spending more than 50% of its time parked in `selectgo`. For the top one, propose an architectural change (fewer cases, sharded channels, batched processing) and measure the improvement.

### Task 4.6 — Drop-policy library
Build a `chanqueue` package with:
- `New[T](cap int, policy DropPolicy) *Queue[T]`
- `policies: DropNewest, DropOldest, BlockProducer, ReplaceWithKey`
- `Push(v T) bool`, `Out() <-chan T`, `Close()`

Each policy is one shape of `select`. Provide a benchmark comparing the four under uniform and bursty load.

---

## Task Set 5 — Open-Ended Designs

### Task 5.1 — Build a tiny actor system
Each actor is a goroutine with a mailbox channel. Actors process messages with a for-select over the mailbox and a `<-ctx.Done()` for stopping. Implement `Send`, `Stop`, and a supervisor that restarts failed actors with exponential back-off.

### Task 5.2 — Multi-source aggregator
Build a metrics aggregator that collects counters from N source services, aggregates them every 10 seconds, and emits the aggregate. Use `errgroup` for the sources, fan-in for the aggregation step, and a periodic flusher for the output.

### Task 5.3 — Backpressure-aware load generator
Build a load generator that issues N requests per second at sustained load, but slows down if the response queue depth grows beyond a threshold (signalling that the target is overloaded). All coordination via channels and selects, no mutexes.

### Task 5.4 — Circuit breaker
Build a circuit breaker that wraps a function. Implementation: a single state-machine goroutine driven by a for-select over (a) call attempts, (b) result reports, (c) reset ticker, (d) stop signal. The select-driven state machine is cleaner than the equivalent mutex-protected one.

### Task 5.5 — Distributed task queue worker
Build a worker that pulls tasks from Redis, processes them, and respects:
- `ctx.Done()` for shutdown.
- A heartbeat to update task lease.
- Bounded concurrency (semaphore via buffered channel).
- Graceful drain on shutdown.

The for-select gets to four cases here: tasks, heartbeat, ctx.Done(), and a "result" channel from in-flight tasks. Past four, refactor.

---

## Self-Grading Rubric

For each task, score yourself:

| Criterion | 0 (Fail) | 1 (Pass) | 2 (Strong) |
|-----------|----------|----------|------------|
| Correctness | Doesn't compile or wrong behaviour | Behaves as specified | Handles edge cases (closed channels, double cancel) |
| Leak-freedom | `goleak` finds leftovers | Leak-free in happy path | Leak-free under cancellation, panic, and error paths |
| Style | Off-spec or unidiomatic | Idiomatic Go | Self-documenting, comments where non-obvious |
| Performance | Spins or allocates excessively | Reasonable | Profiled and measured |
| Test coverage | None | Happy path tested | Cancellation, timeout, and error paths tested |

Aim for a 9/10 on every task you submit for review. The professional level expects every box ticked.

---

## How to Use This File

1. Pick the lowest-numbered task you have not done.
2. Read the prompt twice; do not look at hints.
3. Solve it on your own machine. Aim for under one hour for set 1 tasks, under three hours for set 4.
4. Run `go test -race`, `go vet`, and `golangci-lint`.
5. Compare your solution to the patterns in middle.md and senior.md. If yours differs, ask why.
6. Move on.

The point is not to memorise solutions — it is to internalise the shapes so that, when you reach for `select` in real work, the right pattern shows up unbidden.
