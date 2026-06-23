# x/sync semaphore — Tasks

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Tier 1 — Warm-Up](#tier-1-warm-up)
3. [Tier 2 — Core Patterns](#tier-2-core-patterns)
4. [Tier 3 — Weighted Acquisitions](#tier-3-weighted-acquisitions)
5. [Tier 4 — Integration with Other Primitives](#tier-4-integration-with-other-primitives)
6. [Tier 5 — Build Your Own](#tier-5-build-your-own)
7. [Tier 6 — Diagnostic and Stress](#tier-6-diagnostic-and-stress)
8. [Self-Grading Rubric](#self-grading-rubric)

---

## How to Use This File

Each task has:

- A short statement of what to build.
- The required behaviour.
- A test or measurement that confirms correctness.

Do them in order. Tier 1 takes minutes; Tier 5–6 take hours. After each tier, run `go vet`, `go test -race`, and `go build` to confirm hygiene.

All tasks use `golang.org/x/sync/semaphore`. Install once:

```bash
go get golang.org/x/sync
```

---

## Tier 1 — Warm-Up

### Task 1.1 — Hello, Semaphore

Write a program that creates a `semaphore.Weighted` of capacity 3, acquires three slots in a row, attempts a fourth `TryAcquire`, then releases all three.

**Required behaviour:**
- Three `Acquire` calls succeed quickly.
- The fourth `TryAcquire` returns `false`.
- All three `Release` calls succeed without panicking.

**Verification:** print the result of each step. The output should match the expected order.

---

### Task 1.2 — Bounded Worker Loop

Given a list of 20 dummy tasks (each sleeping 10 ms), use a semaphore of capacity 4 to ensure no more than 4 tasks run concurrently. Use `sync.WaitGroup` to wait for completion.

**Required behaviour:**
- All 20 tasks complete.
- At no time are more than 4 running.
- Total wall time is roughly `ceil(20/4) * 10ms = 50ms` (plus scheduler overhead).

**Verification:** an atomic counter incremented at task start and decremented at end, with a watchdog assertion that it never exceeds 4.

---

### Task 1.3 — Acquire Context Cancellation

Acquire the only slot of a capacity-1 semaphore. Spawn a goroutine that attempts to `Acquire(ctx, 1)` with a 100 ms timeout. Verify the goroutine returns `context.DeadlineExceeded`.

**Verification:** assert `errors.Is(err, context.DeadlineExceeded)`.

---

### Task 1.4 — Pre-Cancelled Acquire

Create a cancelled context. Call `Acquire(cancelledCtx, 1)` on a fresh, empty semaphore. Verify it returns `context.Canceled` immediately even though capacity is free.

**Verification:** measure time taken; should be under 1 ms.

---

### Task 1.5 — Release-of-Zero

Acquire 5 units. Call `Release(0)`. Then call `Release(5)`. Verify no panic and the semaphore is empty.

**Verification:** then `TryAcquire(cap)` should succeed.

---

## Tier 2 — Core Patterns

### Task 2.1 — Bounded HTTP Fetcher

Build a function `FetchAll(ctx context.Context, urls []string, maxParallel int) (map[string]int, error)` that fetches each URL with `http.Get`, returning a map from URL to status code. Use `semaphore.Weighted` to cap parallelism at `maxParallel`. Errors should not stop the whole batch; collect them per URL in a separate map.

**Required behaviour:**
- At most `maxParallel` outstanding requests.
- Respects `ctx` — cancelling stops further requests.
- Returns all results gathered before cancellation.

**Verification:** use a test server that counts concurrent in-flight requests; assert it never exceeds `maxParallel`.

---

### Task 2.2 — Producer Spawn Rate-Limiting

Write a producer loop that creates 1,000 worker goroutines, each doing a 50 ms sleep. The producer must acquire from a capacity-8 semaphore *before* spawning. Each worker releases on exit.

**Required behaviour:**
- At any time, at most 8 worker goroutines exist.
- The producer blocks when the semaphore is saturated, so spawning is rate-limited.

**Verification:** poll `runtime.NumGoroutine()` periodically; it should stay near 9 (8 workers + 1 producer + main).

---

### Task 2.3 — `TryAcquire` Backpressure

Build a function that processes items from a channel. For each item, attempt `TryAcquire(1)`. If successful, process synchronously. If not, log "shed" and skip.

**Required behaviour:**
- Under low load, every item is processed.
- Under saturated load, excess items are dropped, not queued.

**Verification:** feed 1,000 items at high rate to a capacity-4 semaphore; count processed vs shed; assert (processed + shed == 1000).

---

### Task 2.4 — Cancellation Cleanup

Create a goroutine that acquires a slot, sleeps 1 second, releases. Spawn a second goroutine that immediately attempts `Acquire(ctx, 1)` with a 50 ms timeout. Verify the second goroutine cleans up properly: it returns `DeadlineExceeded` and does NOT hold a slot when its `Acquire` errors out.

**Verification:** after the second goroutine returns its error, the first goroutine's release should result in the semaphore being empty (`TryAcquire(cap)` succeeds).

---

### Task 2.5 — FIFO Ordering Verification

Acquire the only slot of a capacity-1 semaphore. Spawn three goroutines A, B, C in known order (use a barrier). Each tries `Acquire(ctx, 1)`. Release the holder. Confirm A wakes first, then B, then C, in order.

**Verification:** each woken goroutine appends its name to a slice (under mutex). After all complete, slice must be `[A, B, C]`.

---

## Tier 3 — Weighted Acquisitions

### Task 3.1 — Memory Budget

Build a `BudgetedProcessor` type with a constructor `NewBudgetedProcessor(budgetBytes int64)`. Add a method `Process(ctx context.Context, sizeBytes int) error` that:

- Validates `sizeBytes <= budgetBytes`.
- Acquires `sizeBytes` from the semaphore.
- Sleeps for `sizeBytes / 1<<20` milliseconds (1 ms per MiB).
- Releases.

Run 10 concurrent calls with random sizes 1 MiB to 100 MiB against a 256 MiB budget. Verify total acquired weight never exceeds 256 MiB.

**Verification:** atomic counter of currently-acquired bytes; assert `<= 256<<20` always.

---

### Task 3.2 — Tiered Workload

Define three tiers: small (weight 1), medium (weight 4), large (weight 16). Run a workload of mixed sizes against a capacity-32 semaphore. Confirm:

- Up to 32 small jobs run concurrently, OR
- Up to 8 medium, OR
- Up to 2 large, OR
- Any combination that sums to ≤ 32.

**Verification:** instrument concurrent count by tier; assert the inequality holds.

---

### Task 3.3 — Head-of-Line Blocking Demo

Acquire 8 units of a capacity-10 semaphore. Spawn a goroutine that tries to `Acquire(ctx, 10)`. Spawn another goroutine 100 ms later that tries to `Acquire(ctx, 1)`. Release 8 units. Confirm the 10-acquire wakes first (it fits exactly), then the 1-acquire — strict FIFO.

**Verification:** the 1-acquire should NOT wake before the 10-acquire even though 2 units would be free if the 1-acquire jumped the queue.

---

### Task 3.4 — Oversize Reject

Wrap `Acquire` so that requests larger than capacity return `ErrOversize` immediately instead of blocking.

```go
var ErrOversize = errors.New("oversize")

type SafeSem struct {
    s   *semaphore.Weighted
    cap int64
}

func (s *SafeSem) Acquire(ctx context.Context, n int64) error {
    if n > s.cap { return ErrOversize }
    return s.s.Acquire(ctx, n)
}
```

**Verification:** request larger than capacity returns `ErrOversize` in under 1 ms. Smaller requests behave as normal.

---

### Task 3.5 — Cost Validator

Build `func validateCost(item Item) (int64, error)` that returns the cost for an item or an error if the cost cannot be computed safely. Test with malicious inputs (`MaxInt64`, negative, zero) and verify the validator rejects them before reaching the semaphore.

**Verification:** unit tests for each malicious input.

---

## Tier 4 — Integration with Other Primitives

### Task 4.1 — Errgroup + Semaphore

Process a list of items with `errgroup.WithContext` and a `semaphore.NewWeighted(8)`. If any item's processor returns an error, cancel the rest. Return the first error or nil.

**Required behaviour:**
- At most 8 items processed concurrently.
- On first error, remaining items are not started.
- Total error returned is the first one.

**Verification:** processor randomly returns errors for 1% of items; assert that after the first error, subsequent acquires return ctx errors.

---

### Task 4.2 — Two Semaphores in Order

Build a service that needs both a memory slot and a CPU slot:

```go
type Service struct {
    mem *semaphore.Weighted
    cpu *semaphore.Weighted
}

func (s *Service) Process(ctx context.Context, cost int64) error {
    // acquire mem, then cpu, then process, then release in reverse
}
```

Confirm the order is consistent across all call sites (no deadlock from reversed order).

**Verification:** stress test with 100 concurrent goroutines; no deadlock or starvation.

---

### Task 4.3 — Per-User Limiter

Build a `RateLimiter` with a global cap of 100 and per-user cap of 5. Use a `sync.Map` keyed by user ID, lazy-creating per-user `*semaphore.Weighted` of capacity 5. On `Acquire(user)`, hold a global slot and a user slot. On `Release(user)`, release both.

**Required behaviour:**
- One user cannot exceed 5 in flight.
- All users together cannot exceed 100.

**Verification:** test that 6 concurrent acquires for the same user blocks the 6th, even when the global has room.

---

### Task 4.4 — Replace Channel-as-Semaphore

Take this code:

```go
slots := make(chan struct{}, 8)
slots <- struct{}{}
defer func() { <-slots }()
work()
```

Convert it to `semaphore.Weighted` with context-aware acquire and a 1-second timeout.

**Verification:** behaviour is identical for the happy path; under saturation, the semaphore version returns `DeadlineExceeded` cleanly while the channel version would need a `select` block.

---

### Task 4.5 — Combined with sync.Once

Use a `sync.Once` to lazy-initialise a semaphore the first time `Process` is called. Subsequent calls reuse the same instance.

**Verification:** call `Process` 100 times concurrently; assert only one `NewWeighted` invocation occurred (use a counter inside the `Once.Do` closure).

---

## Tier 5 — Build Your Own

### Task 5.1 — Channel-Only Semaphore

Implement `Sem` with a `chan struct{}` of capacity N, exposing `Acquire(ctx)`, `TryAcquire()`, `Release()`. Make `Acquire` context-aware using `select`.

```go
type Sem struct { c chan struct{} }
func NewSem(n int) *Sem { return &Sem{c: make(chan struct{}, n)} }
func (s *Sem) Acquire(ctx context.Context) error { ... }
func (s *Sem) TryAcquire() bool { ... }
func (s *Sem) Release() { ... }
```

**Required behaviour:** equivalent to `semaphore.Weighted` with weight = 1.

**Verification:** run the same test suite against `Sem` and `semaphore.Weighted`; both must pass.

---

### Task 5.2 — Weighted Semaphore From Scratch

Implement `MyWeighted` matching the `semaphore.Weighted` API: `NewWeighted(n int64)`, `Acquire(ctx, n int64) error`, `TryAcquire(n int64) bool`, `Release(n int64)`. Use a mutex + `container/list.List` + per-waiter `chan struct{}`. Pass these tests:

- FIFO ordering with weight = 1.
- Head-of-line blocking with mixed weights.
- Context cancellation removes the waiter from the queue.
- Cancellation-during-grant returns the slot.

**Verification:** the official tests from `x/sync/semaphore` test directory should pass against your implementation.

---

### Task 5.3 — Best-Fit Semaphore (Variant)

Implement a non-FIFO variant: on `Release`, wake the *largest* waiter that fits, not the head. This maximises throughput but allows small-weight starvation.

Document the starvation risk in a comment.

**Verification:** a stress test where heavy waiters are 10x more frequent than light ones; the light waiters should occasionally starve (in a bad way), proving the policy.

---

### Task 5.4 — LIFO Semaphore (Variant)

Implement a LIFO variant: on `Release`, wake the most-recently-parked waiter.

Justify when LIFO is the right policy (hint: prefer-newest scenarios like live traffic over background backfills).

**Verification:** ordering test confirms LIFO behaviour.

---

### Task 5.5 — Deadline-Aware Semaphore (Variant)

Implement a variant that, on `Release`, wakes the waiter whose `ctx` deadline is soonest. Skip waiters whose ctx has already expired.

**Verification:** insert three waiters with deadlines 100 ms, 200 ms, 50 ms; release; the 50 ms one should wake first.

---

## Tier 6 — Diagnostic and Stress

### Task 6.1 — Wait-Time Instrumentation

Wrap `semaphore.Weighted` in a type that records the wait time of every `Acquire` in a `prometheus.Histogram` (or `expvar`). Verify under saturation that the histogram reflects real wait times.

**Verification:** load test with saturation; check the histogram has p50, p99, max as expected.

---

### Task 6.2 — Saturation Detector

Add a method to the instrumented wrapper: `IsSaturated() bool`. Returns true if `Acquire` waits have exceeded a threshold (e.g., 100 ms p95) over the last 10 seconds.

**Verification:** unit test that injects synthetic wait times and checks the detector fires.

---

### Task 6.3 — Deadlock Detector

Build a test that intentionally creates a deadlock by acquiring two semaphores in inconsistent order from two goroutines. Run with the race detector. Document what symptom you observe (the test will hang).

**Verification:** the test, when not killed by a deadline, hangs forever — proving the deadlock.

---

### Task 6.4 — Memory Profile Under Saturation

Run a workload that parks 10,000 goroutines on a semaphore. Capture a heap profile (`pprof.Lookup("heap")`). Identify the dominant allocation source. Estimate per-waiter overhead.

**Verification:** expected dominant allocator is `chan struct{}` and `*list.Element`. Per-waiter ~96 bytes.

---

### Task 6.5 — Benchmark Suite

Write `BenchmarkAcquireRelease` covering:
- Uncontended single-goroutine.
- Saturated with 8 goroutines.
- Saturated with 64 goroutines.

Run with `go test -bench=. -benchmem`. Record:
- ns/op.
- allocs/op.
- B/op.

Compare against a channel-based semaphore of the same capacity.

**Verification:** report results in a comment with your interpretation.

---

### Task 6.6 — Reproduce the Cancellation Race

Construct a test that reliably hits the cancellation-during-grant race:
- Acquire all capacity.
- Spawn a waiter with a `ctx` that has a short deadline.
- Time the release to occur exactly at deadline expiry.

Run thousands of iterations under `-race`; confirm the implementation handles the race without losing slots.

**Verification:** after the test, `TryAcquire(cap)` succeeds — no slot leaked.

---

## Self-Grading Rubric

- **0 tasks done:** read junior.md first.
- **Tier 1 done:** you understand the API.
- **Tier 2 done:** you can write idiomatic semaphore code.
- **Tier 3 done:** you can use the weighted feature for real budgets.
- **Tier 4 done:** you can integrate the semaphore with other primitives correctly.
- **Tier 5 done:** you understand the implementation deeply.
- **Tier 6 done:** you can operate the semaphore in production.

Repeat tasks at higher pressure (with `-race`, with `-count=100`, on a busy machine) to ensure correctness under stress.
