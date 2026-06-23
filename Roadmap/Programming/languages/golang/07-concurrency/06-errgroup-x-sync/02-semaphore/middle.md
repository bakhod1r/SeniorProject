# x/sync semaphore — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Beyond Weight = 1: Variable-Cost Acquisitions](#beyond-weight-1-variable-cost-acquisitions)
3. [Channel-as-Semaphore — A Deeper Comparison](#channel-as-semaphore-a-deeper-comparison)
4. [Context Patterns with Acquire](#context-patterns-with-acquire)
5. [`TryAcquire` in Production](#tryacquire-in-production)
6. [Memory-Budget Gating](#memory-budget-gating)
7. [Composing Semaphores](#composing-semaphores)
8. [Sizing the Capacity](#sizing-the-capacity)
9. [Combining with `sync.WaitGroup`](#combining-with-syncwaitgroup)
10. [Idiomatic Code](#idiomatic-code)
11. [Anti-Patterns](#anti-patterns)
12. [Testing Strategy](#testing-strategy)
13. [Tricky Cases](#tricky-cases)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)

---

## Introduction

Junior introduced `semaphore.Weighted` as a counter you `Acquire` and `Release`. Middle level upgrades it to a production tool. We will:

- Use weighted acquisitions for non-trivial cost models.
- Pin down when to choose a buffered channel and when to use `semaphore.Weighted`.
- Handle context properly across nested calls.
- Compose multiple semaphores (CPU + memory, per-tenant + global).
- Size capacity from real measurements rather than guesses.

Expect to write code that does **not** look like a textbook example. Real-world semaphore usage carries policy and observability around the bare API.

---

## Beyond Weight = 1: Variable-Cost Acquisitions

The package documentation calls this a "weighted" semaphore, but most demos use weight = 1. The weighted case is where it stops competing with channels.

```go
// A 4 GiB memory budget. Each request reserves bytes proportional to
// the size of the data it processes.
budget := semaphore.NewWeighted(4 << 30)

func process(ctx context.Context, payload []byte) error {
    cost := int64(len(payload)) * 3 // 3x overhead for parsing
    if cost > 4<<30 {
        return errors.New("payload too large for budget")
    }
    if err := budget.Acquire(ctx, cost); err != nil {
        return err
    }
    defer budget.Release(cost)
    return doProcessing(payload)
}
```

Two things to note:

1. **Validate `cost > capacity` before acquiring.** Otherwise `Acquire` blocks forever (or until ctx cancels).
2. **The cost passed to `Acquire` and `Release` must be identical.** Capture it in a local variable; never compute it twice — what if `payload` is mutated between?

### Estimating cost honestly

The cost you pass is a *budget reservation*, not an enforced limit. If your job actually uses more memory than it reserved, the program will OOM and the semaphore will not save you. The point is to coordinate; the discipline of measuring how much each job costs is yours.

A common pattern: measure peak RSS for a representative input, multiply by a safety factor of 1.5–2, use that as the reservation formula.

### Reservation by tier

Sometimes exact byte counts are impractical; tiered weights are simpler:

```go
const (
    weightSmall = 1
    weightMedium = 4
    weightLarge = 16
)

func tier(size int) int64 {
    switch {
    case size < 64<<10:
        return weightSmall
    case size < 1<<20:
        return weightMedium
    default:
        return weightLarge
    }
}

sem := semaphore.NewWeighted(32) // 32 small, 8 medium, 2 large, or any mix
```

Tiered weights are easy to reason about and to tune.

---

## Channel-as-Semaphore — A Deeper Comparison

The simplest unweighted gate in Go is a buffered channel:

```go
slots := make(chan struct{}, 8)

acquire := func() { slots <- struct{}{} }
release := func() { <-slots }
```

The two approaches differ in five ways:

### 1. Weighted vs unweighted

The channel cannot express "this acquire is worth 4 slots." You would need to send four times, which is a non-atomic operation:

```go
for i := 0; i < 4; i++ {
    slots <- struct{}{}
}
// not atomic — a slot may be acquired by another goroutine between iterations
```

`semaphore.Weighted` handles this in one atomic call.

### 2. Selectable vs not

The channel works inside `select`:

```go
select {
case slots <- struct{}{}:
    defer func() { <-slots }()
    work()
case <-ctx.Done():
    return ctx.Err()
case <-time.After(timeout):
    return errBusy
}
```

`semaphore.Weighted.Acquire` is *not* a channel; it cannot be a `select` case. You can simulate timeout with `context.WithTimeout`, but not multiplex with other channel operations.

### 3. Context awareness

`Acquire(ctx, n)` is context-aware out of the box. The channel version needs an extra `select` arm.

### 4. Fairness

Channel acquisition order is not strictly FIFO in Go's spec; in practice the runtime tries to be fair, but there is no guarantee. `semaphore.Weighted` documents and enforces FIFO.

### 5. Failure modes

Sending on a closed channel **panics**. Receiving from a closed channel **returns zero**. There is no `Close` on a semaphore. Channel-as-semaphore is more dangerous if any goroutine ever calls `close(slots)` — usually nobody does, but it is an extra invariant.

### Decision rubric

| Need | Use |
|---|---|
| Unweighted, simple, `select` integration | Buffered channel |
| Weighted (variable cost per acquire) | `semaphore.Weighted` |
| Context-aware acquire | `semaphore.Weighted` (cleaner) |
| Cross-goroutine handoff with payload | Channel (carries data) |
| Pure budget (no data) | `semaphore.Weighted` |
| FIFO guarantee mandatory | `semaphore.Weighted` |

When in doubt and weight = 1, use a buffered channel — it is simpler and standard library only. Reach for `semaphore.Weighted` once you need any of the things on the right.

---

## Context Patterns with Acquire

### Pattern: Per-request context

Each incoming request brings its own `ctx`. Pass it down to `Acquire`:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    if err := sem.Acquire(r.Context(), 1); err != nil {
        http.Error(w, "service busy", http.StatusServiceUnavailable)
        return
    }
    defer sem.Release(1)
    handle(r)
}
```

When the client disconnects, `r.Context()` cancels, and a parked `Acquire` returns. No work is wasted on an abandoned request.

### Pattern: Bounded wait

Sometimes you want to wait at most X seconds for a slot, then fail fast:

```go
acqCtx, cancel := context.WithTimeout(r.Context(), 200*time.Millisecond)
defer cancel()

if err := sem.Acquire(acqCtx, 1); err != nil {
    return errBusy
}
defer sem.Release(1)
```

Note: the `cancel` is for the *acquire* context, not the work itself. Once acquired, use `r.Context()` for the actual work. Cancelling `acqCtx` after `Acquire` returns has no effect on the held slot.

### Pattern: Shared budget, derived contexts

If you have a parent context for the request and want a budget acquire to have a tighter deadline:

```go
budgetCtx, cancel := context.WithDeadline(ctx, time.Now().Add(100*time.Millisecond))
defer cancel()

if err := budget.Acquire(budgetCtx, cost); err != nil {
    return ErrBudgetUnavailable
}
defer budget.Release(cost)
```

The work continues to use `ctx`, which may have a longer deadline.

### Pattern: Context-aware release? No

You never pass a `ctx` to `Release`. Release is unconditional. There is no scenario where "this release should be cancelled."

---

## `TryAcquire` in Production

`TryAcquire` returns `false` immediately if the slot cannot be reserved. It is the right tool for:

### Best-effort metrics

```go
if sem.TryAcquire(1) {
    defer sem.Release(1)
    go emitMetrics() // skipped under load
}
```

Under load, metrics are sacrificed. The main work proceeds.

### Probe / health checks

```go
if !sem.TryAcquire(1) {
    return false // backend saturated; report unhealthy
}
sem.Release(1)
return true
```

A "saturated semaphore means unhealthy" probe.

### Backpressure decisions

```go
if !sem.TryAcquire(int64(jobCost)) {
    return enqueueToOverflowQueue(job) // can't take now, persist for later
}
defer sem.Release(int64(jobCost))
process(job)
```

The semaphore is the fast path; an overflow queue absorbs the rest.

### Why `TryAcquire` respects FIFO

If `TryAcquire` cut the queue when capacity was free, a hot loop calling `TryAcquire` would starve parked waiters. The implementation deliberately returns `false` whenever the wait queue is non-empty. This is a feature, not a quirk.

---

## Memory-Budget Gating

The killer application. Below is a complete sketch.

```go
type Processor struct {
    mem *semaphore.Weighted
    log *slog.Logger
}

func NewProcessor(budgetBytes int64, log *slog.Logger) *Processor {
    return &Processor{
        mem: semaphore.NewWeighted(budgetBytes),
        log: log,
    }
}

func (p *Processor) Process(ctx context.Context, item Item) error {
    cost := estimateCost(item)
    if cost <= 0 || cost > p.budgetCapacity() {
        return fmt.Errorf("invalid cost %d", cost)
    }

    start := time.Now()
    if err := p.mem.Acquire(ctx, cost); err != nil {
        return fmt.Errorf("memory budget: %w", err)
    }
    waitFor := time.Since(start)
    if waitFor > 100*time.Millisecond {
        p.log.Warn("long memory budget wait", "wait", waitFor, "cost", cost)
    }
    defer p.mem.Release(cost)

    return doWork(ctx, item)
}

func (p *Processor) budgetCapacity() int64 {
    // The package has no Capacity() getter; we need to record it ourselves.
    return p.cap
}
```

Two operational notes:

- **Log slow waits.** Without logging, a queue building up is invisible. The semaphore has no `Waiting()` getter; you must measure wait time yourself.
- **Validate cost up-front.** A bug that produces `cost = math.MaxInt64` blocks forever otherwise.

### Avoiding double-counting

If a job calls multiple semaphore-protected functions, design carefully:

```go
// BAD: nested acquire of the same semaphore — risk of deadlock under saturation
func outer(ctx context.Context) {
    sem.Acquire(ctx, 1)
    defer sem.Release(1)
    inner(ctx)
}
func inner(ctx context.Context) {
    sem.Acquire(ctx, 1) // may deadlock when capacity == 1 and outer holds it
    defer sem.Release(1)
    // ...
}
```

Outer-then-inner re-entry deadlocks. Either lift acquire to the outermost call, or use two semaphores (one per level), or accept that callers must hold the budget before calling.

---

## Composing Semaphores

Real systems often have multiple resources to gate:

```go
type Service struct {
    cpu *semaphore.Weighted // GOMAXPROCS slots
    mem *semaphore.Weighted // memory bytes
    db  *semaphore.Weighted // DB connection slots
}

func (s *Service) Handle(ctx context.Context, req Request) error {
    cost := req.MemoryCost()

    if err := s.mem.Acquire(ctx, cost); err != nil { return err }
    defer s.mem.Release(cost)

    if err := s.db.Acquire(ctx, 1); err != nil { return err }
    defer s.db.Release(1)

    if err := s.cpu.Acquire(ctx, 1); err != nil { return err }
    defer s.cpu.Release(1)

    return s.work(ctx, req)
}
```

### Ordering matters

The order in which you acquire matters for two reasons:

1. **Deadlock prevention.** If two paths acquire `mem` then `db` and another path acquires `db` then `mem`, deadlock is possible. Pick one global order and stick to it.
2. **Holding time minimisation.** Acquire the most-contended resource last. If `db` is saturated and `mem` is not, holding `mem` while waiting on `db` wastes memory. Reorder so contended ones come first.

A pragmatic ordering: acquire scarce, slow-to-free resources first; cheap ones last.

### Per-tenant gating

Multi-tenant services often need per-tenant quotas plus a global cap:

```go
type Limiter struct {
    global  *semaphore.Weighted
    perUser sync.Map // map[userID]*semaphore.Weighted
}

func (l *Limiter) Acquire(ctx context.Context, userID string) error {
    if err := l.global.Acquire(ctx, 1); err != nil { return err }
    user := l.userSem(userID)
    if err := user.Acquire(ctx, 1); err != nil {
        l.global.Release(1)
        return err
    }
    return nil
}

func (l *Limiter) Release(userID string) {
    l.userSem(userID).Release(1)
    l.global.Release(1)
}

func (l *Limiter) userSem(userID string) *semaphore.Weighted {
    if s, ok := l.perUser.Load(userID); ok { return s.(*semaphore.Weighted) }
    s, _ := l.perUser.LoadOrStore(userID, semaphore.NewWeighted(4))
    return s.(*semaphore.Weighted)
}
```

The global cap prevents the whole service from drowning; the per-user cap prevents one user from monopolising the global. Cleaning up idle per-user semaphores is a separate concern (`sync.Map` does not GC them).

---

## Sizing the Capacity

The biggest mistake at junior level is picking capacity by gut feel. At middle level you measure.

### CPU-bound capacity

For CPU-bound work, capacity = `runtime.GOMAXPROCS(0)` is a sensible default. Going higher just causes scheduler thrash without throughput gains.

### I/O-bound capacity

For I/O-bound work (HTTP, DB queries, disk reads), capacity can be much higher than core count — often 10x to 100x. The right number depends on:

- Latency per call (`p99`).
- Throughput target (`requests per second`).
- Little's Law: `concurrency = throughput * latency`.

Example: 1000 RPS target with 100 ms p99 latency → about 100 concurrent in flight.

### Memory-bound capacity

For memory budgets: 80% of available RAM is the usual target. Going to 100% invites OOM. Going much lower wastes memory.

Always profile under representative load. The first capacity you pick is wrong — adjust.

### Capacity that adapts

The package does not support dynamic capacity. If your workload changes, you usually replace the semaphore at startup (e.g., based on a config flag). True dynamic adaptation (auto-tuning) requires a custom limiter outside the standard package — see the `netflix/concurrency-limits` family of libraries for inspiration.

---

## Combining with `sync.WaitGroup`

Bounded fan-out: limit concurrency *and* wait for completion.

```go
func processAll(ctx context.Context, items []Item, parallel int64) error {
    sem := semaphore.NewWeighted(parallel)
    var wg sync.WaitGroup
    errCh := make(chan error, len(items))

    for _, item := range items {
        if err := sem.Acquire(ctx, 1); err != nil {
            wg.Wait()
            return err
        }
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            defer sem.Release(1)
            if err := process(ctx, it); err != nil {
                errCh <- err
            }
        }(item)
    }
    wg.Wait()
    close(errCh)
    if err := <-errCh; err != nil {
        return err
    }
    return nil
}
```

This is correct but verbose. `errgroup` (next section) simplifies it. Note that `Acquire` is in the *producer* loop, not inside the goroutine — this is intentional so the loop runs at semaphore speed, not at "spawn-all-immediately" speed.

---

## Idiomatic Code

```go
// Pattern: bounded fan-out
sem := semaphore.NewWeighted(int64(concurrency))
for _, x := range items {
    x := x
    if err := sem.Acquire(ctx, 1); err != nil { return err }
    go func() {
        defer sem.Release(1)
        work(x)
    }()
}

// Pattern: weighted budget
const budget = 256 << 20
mem := semaphore.NewWeighted(budget)
cost := estimateCost(item) // in bytes
if cost > budget { return fmt.Errorf("oversize") }
if err := mem.Acquire(ctx, cost); err != nil { return err }
defer mem.Release(cost)

// Pattern: try-acquire with fallback
if sem.TryAcquire(1) {
    defer sem.Release(1)
    fastPath()
} else {
    slowPath()
}

// Pattern: domain wrapper
type Budget struct{ s *semaphore.Weighted }
func (b *Budget) Reserve(ctx context.Context, n int64) (func(), error) {
    if err := b.s.Acquire(ctx, n); err != nil { return nil, err }
    return func() { b.s.Release(n) }, nil
}
```

---

## Anti-Patterns

### Anti-pattern 1: Acquire inside goroutine spawn

```go
for _, x := range items {
    go func(x Item) {
        sem.Acquire(ctx, 1) // BAD: all goroutines spawn first
        defer sem.Release(1)
        work(x)
    }(x)
}
```

Now you have N goroutines all parked in `Acquire`. Memory cost = N small stacks. Better to `Acquire` in the producer loop so spawning is rate-limited.

### Anti-pattern 2: Not capturing the weight

```go
sem.Acquire(ctx, cost)
defer sem.Release(estimateCost(item)) // BAD: may differ from acquired cost
```

Capture in a local variable.

### Anti-pattern 3: Acquire then check ctx, then forget release

```go
sem.Acquire(ctx, 1)
if ctx.Err() != nil {
    return ctx.Err() // BAD: leaked slot
}
defer sem.Release(1)
```

Defer first, *then* check.

### Anti-pattern 4: Semaphore around a `sync.Mutex` critical section

```go
sem.Acquire(ctx, 1)
mu.Lock()
critical()
mu.Unlock()
sem.Release(1)
```

Stacking lock primitives for no reason. Pick one.

### Anti-pattern 5: Capacity bigger than expected concurrency

```go
sem := semaphore.NewWeighted(1<<30)
sem.Acquire(ctx, 1) // always succeeds
```

If capacity > expected concurrency, the semaphore does nothing. Either you do not need it, or you sized it wrong.

### Anti-pattern 6: Forgetting context

```go
sem.Acquire(context.Background(), 1) // BAD when caller has its own ctx
```

If you have a ctx, pass it. `context.Background()` says "wait forever."

---

## Testing Strategy

### Saturation test

Push more work than the semaphore can take, verify it queues.

```go
func TestSaturation(t *testing.T) {
    sem := semaphore.NewWeighted(2)
    ctx := context.Background()
    started := make(chan int, 10)
    var done sync.WaitGroup

    for i := 0; i < 10; i++ {
        i := i
        done.Add(1)
        go func() {
            defer done.Done()
            sem.Acquire(ctx, 1)
            defer sem.Release(1)
            started <- i
            time.Sleep(10 * time.Millisecond)
        }()
    }

    deadline := time.After(50 * time.Millisecond)
    inFlight := 0
    for {
        select {
        case <-started:
            inFlight++
            if inFlight > 2 {
                t.Fatalf("too many concurrent: %d", inFlight)
            }
        case <-deadline:
            done.Wait()
            return
        }
    }
}
```

### Cancellation test

```go
func TestCancel(t *testing.T) {
    sem := semaphore.NewWeighted(1)
    sem.Acquire(context.Background(), 1)

    ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
    defer cancel()
    start := time.Now()
    err := sem.Acquire(ctx, 1)
    if !errors.Is(err, context.DeadlineExceeded) {
        t.Fatalf("want DeadlineExceeded, got %v", err)
    }
    if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
        t.Fatalf("Acquire took too long: %v", elapsed)
    }
}
```

### FIFO ordering test

With weight = 1 and capacity = 1, three sequential acquires must wake in order. Use a barrier (`sync.WaitGroup`) to align goroutine starts, then verify the order they appear.

### Race detector

Always test with `-race`. The semaphore is internally synchronised; the race detector helps catch caller bugs (forgotten release, double release).

---

## Tricky Cases

### TryAcquire and FIFO

A common surprise: `TryAcquire(1)` returns `false` even when free capacity exists, because a heavier waiter is queued ahead. This is intentional — `TryAcquire` does not jump the queue. If you need "give me a slot if free, even past waiters," you need a non-FIFO semaphore (not in this package).

### Acquire of weight 0 returns immediately

`sem.Acquire(ctx, 0)` returns `nil` instantly, regardless of state. Do not call `Release(0)` — it is a no-op apart from a wake scan. Usually it is cleaner to avoid 0-weight calls entirely.

### Capacity vs concurrent goroutines

If capacity is 8 and each acquire is weight 1, up to 8 goroutines run. If capacity is 8 and each is weight 4, up to 2 run. Plan for the worst-case concurrency:

```
worst_case_concurrent_goroutines = capacity / minimum_weight
```

When `minimum_weight = 1`, this can be huge.

### Release in defer of a function that returns errors

```go
func work(ctx context.Context) (err error) {
    if err := sem.Acquire(ctx, 1); err != nil { return err }
    defer sem.Release(1)
    return doWork(ctx)
}
```

This is correct. `defer` runs regardless of error.

---

## Cheat Sheet

```go
// Construct
sem := semaphore.NewWeighted(N)

// Acquire (blocking, context-aware)
if err := sem.Acquire(ctx, w); err != nil { return err }
defer sem.Release(w)

// TryAcquire (non-blocking)
if sem.TryAcquire(w) {
    defer sem.Release(w)
    work()
}

// Composed
sem.Acquire(ctx, costMem)
defer sem.Release(costMem)
sem.Acquire(ctx, 1) // CPU slot
defer sem.Release(1)

// Bounded fan-out
for _, x := range items {
    sem.Acquire(ctx, 1)
    go func(x Item) {
        defer sem.Release(1)
        work(x)
    }(x)
}
```

Sizing:
- CPU-bound: `runtime.GOMAXPROCS(0)`.
- I/O-bound: `throughput * latency` (Little's Law).
- Memory: 80% of available RAM.

Pitfalls:
- `n > capacity` → blocks forever.
- Mismatched `Release` weight → leak or panic.
- Nested same-semaphore acquire → deadlock risk.
- `Acquire` inside `go func()` spawn → all goroutines spawn first.

---

## Summary

At middle level, `semaphore.Weighted` is more than a counter. It is a budget primitive used for memory, CPU, file descriptors, GPU memory, and any other quantifiable resource. The weighted feature is what justifies the external dependency; weight = 1 use cases are better served by a buffered channel.

You should be able to:

- Decide between channel and semaphore based on whether weights vary.
- Size capacity by measurement, not by guess.
- Compose multiple semaphores in deadlock-safe order.
- Wrap raw semaphores in domain types with logging and validation.
- Test saturation, cancellation, and FIFO behaviour.

Senior level pushes further: fairness analysis, head-of-line blocking, integration with `errgroup`, and the design trade-offs in choosing this primitive over alternatives.
