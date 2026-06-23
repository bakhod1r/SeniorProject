# Unlimited Goroutines — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Cost Model: What "Cheap" Really Means](#cost-model-what-cheap-really-means)
3. [Sizing the Limit](#sizing-the-limit)
4. [Worker Pool vs. Semaphore vs. errgroup.SetLimit](#worker-pool-vs-semaphore-vs-errgroupsetlimit)
5. [The Drain-Queue Pattern](#the-drain-queue-pattern)
6. [Backpressure End-to-End](#backpressure-end-to-end)
7. [Per-Tenant and Multi-Tier Bounds](#per-tenant-and-multi-tier-bounds)
8. [Refactoring an Existing Codebase](#refactoring-an-existing-codebase)
9. [Observability for Bounded Fan-Out](#observability-for-bounded-fan-out)
10. [Anti-Patterns at the Middle Level](#anti-patterns-at-the-middle-level)
11. [Testing the Cap](#testing-the-cap)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)

---

## Introduction

Junior taught what unbounded fan-out is and showed three idiomatic cures. Middle level is about *operating* a bounded fan-out: choosing the limit from measurement, propagating backpressure, isolating tenants, and converting a codebase that is full of `for ... go ...` into one that is not.

By the end you will be able to:

- Compute the right N for a CPU-bound, an I/O-bound, and a downstream-bound workload.
- Decide between worker pool, semaphore, and `SetLimit` based on lifetime, error-handling, and shape.
- Implement the drain-queue pattern (a bounded buffer in front of a bounded pool).
- Propagate backpressure to the request boundary rather than dropping it on the floor.
- Refactor a real codebase incrementally, with metrics and tests.

This file assumes you have read [junior.md](junior.md), [05-concurrency-patterns/02-fan-out](../../05-concurrency-patterns/02-fan-out/), and [06-errgroup-x-sync/02-semaphore](../../06-errgroup-x-sync/02-semaphore/).

---

## Cost Model: What "Cheap" Really Means

A goroutine in flight costs:

| Cost | Per Goroutine | Notes |
|------|---------------|-------|
| Initial stack | 2 KB | Grows in 2× steps to whatever the call chain demands |
| GC scan time | ~hundreds of ns | Per stack, per GC cycle |
| Scheduler bookkeeping | ~few hundred bytes | `g` struct in the runtime |
| OS thread (M) | 0 if blocked on Go primitives | An M is allocated when blocked on syscalls |
| File descriptor | varies | If the goroutine opens a connection |
| Downstream resource | varies | Database conn, socket, etc. |

The first three are the runtime cost. They dominate for small, idle goroutines. The last three are the *real* cost — and the reason "a million goroutines" is rarely the right answer even if it would technically fit.

### Worked example: cost of one million blocked goroutines

Assume each goroutine sits in `<-resultCh`. Cost approximately:

- 1,000,000 × 2 KB stacks = ~2 GB minimum
- GC scan of 1,000,000 stacks every cycle: at ~200 ns per scan, ~200 ms added per GC cycle
- A few GB of `g` and `m` bookkeeping

Result: a service with 4 GB RAM has no headroom for actual work. GC latency goes from ~5 ms to ~500 ms. The service appears alive but every request takes seconds. This is the "brownout" failure mode that precedes a crash.

### When the goroutine actually uses memory

If each goroutine allocates a 1 MB buffer:

- 100,000 goroutines × 1 MB = 100 GB. Almost certainly OOM.
- Even 10,000 × 1 MB = 10 GB. Painful on most cloud VMs.

Bound the count to whatever your *total memory budget* divided by *per-goroutine peak memory* allows. This is the heaviest constraint, not the lightest one.

---

## Sizing the Limit

### CPU-bound workloads

For pure CPU work (encoding, parsing, math):

```
N = runtime.NumCPU()
```

Going higher does not help; the cores are already saturated. Going lower wastes cores.

If the work is bursty, oversubscribe slightly:

```
N = runtime.NumCPU() + 1   // covers the case when one is in syscall
```

### I/O-bound workloads (network, disk)

When each goroutine spends most of its time waiting:

```
N = peakConcurrency = arrivalRate × averageLatency  (Little's Law)
```

Worked example: an HTTP handler that takes 200 ms per call, peak rate 200 req/s:

```
N = 200 req/s × 0.2 s = 40 concurrent
```

Set `N = 64` for headroom (1.5× rule).

### Downstream-bound workloads

When a downstream service (DB, API, queue) is the bottleneck:

```
N = downstreamConcurrencyLimit / replicaCount
```

If the database accepts 100 simultaneous queries and you have 5 Go instances:

```
N = 100 / 5 = 20
```

This is the *fair-share* bound. Without it, replicas race for the same pool and one starves another.

### When in doubt: measure

1. Start with `N = runtime.NumCPU()`.
2. Push throughput with a load test.
3. Increase N by 2× until either throughput plateaus or error/latency rises.
4. Back off 25%.
5. Document the number with a comment explaining the measurement.

### What N is *not*

- N is **not** "as high as my OS lets me." File descriptor and thread limits are *resource* limits, not *performance* limits.
- N is **not** static. Re-measure after every major architectural change.
- N is **not** universal. Each pool has its own correct N.

---

## Worker Pool vs. Semaphore vs. errgroup.SetLimit

| Property | Worker Pool | Semaphore | `errgroup.SetLimit` |
|---|---|---|---|
| Goroutine count | Fixed N | 0 to len(input) | 0 to N |
| Goroutine reuse | Yes | No | No |
| Spawn cost amortised | Yes | No | No |
| Error propagation | Manual | Manual | Built in |
| Cancellation | Manual / via context | Manual | Built in (with `WithContext`) |
| Code length | Most | Medium | Least |
| Long-lived service | Best fit | OK | OK |
| Short-lived request | Overkill | Good | Best fit |
| Variable-cost jobs | Hard | Easy with `semaphore.Weighted` | Hard |
| Submission backpressure | Buffered channel | Acquire blocks | `g.Go` blocks at limit |

### Rule of thumb

- **Service-scoped, continuous work** → worker pool.
- **Request-scoped, one-shot fan-out with error propagation** → `errgroup.SetLimit`.
- **Variable cost per job** → `semaphore.Weighted`.

### A semaphore-based pool template

```go
type Limited struct {
    sem chan struct{}
    wg  sync.WaitGroup
}

func NewLimited(n int) *Limited {
    return &Limited{sem: make(chan struct{}, n)}
}

func (l *Limited) Go(ctx context.Context, fn func() error) error {
    select {
    case l.sem <- struct{}{}:
    case <-ctx.Done():
        return ctx.Err()
    }
    l.wg.Add(1)
    go func() {
        defer l.wg.Done()
        defer func() { <-l.sem }()
        defer func() {
            if r := recover(); r != nil {
                log.Printf("limited goroutine panic: %v", r)
            }
        }()
        if err := fn(); err != nil {
            log.Printf("limited goroutine err: %v", err)
        }
    }()
    return nil
}

func (l *Limited) Wait() { l.wg.Wait() }
```

This is essentially what `errgroup.SetLimit` does, with weaker error handling. Use the real `errgroup` unless you have a specific reason not to.

---

## The Drain-Queue Pattern

A drain-queue is a *bounded buffer* in front of a *bounded pool*. It absorbs short bursts without rejecting them, while still enforcing the total in-flight cap.

```go
type DrainQueue struct {
    jobs chan Job
    wg   sync.WaitGroup
}

func NewDrainQueue(workers, queue int, handler func(context.Context, Job) error) *DrainQueue {
    q := &DrainQueue{jobs: make(chan Job, queue)}
    for i := 0; i < workers; i++ {
        q.wg.Add(1)
        go func() {
            defer q.wg.Done()
            for j := range q.jobs {
                _ = handler(context.Background(), j)
            }
        }()
    }
    return q
}

// Submit blocks if the queue is full. Use TrySubmit for non-blocking.
func (q *DrainQueue) Submit(ctx context.Context, j Job) error {
    select {
    case q.jobs <- j:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (q *DrainQueue) TrySubmit(j Job) bool {
    select {
    case q.jobs <- j:
        return true
    default:
        return false
    }
}

func (q *DrainQueue) Close() {
    close(q.jobs)
    q.wg.Wait()
}
```

### Sizing the queue

The queue's capacity is *not* the concurrency cap. It is a *burst buffer*. Size it so that:

- Sub-second bursts do not block the producer.
- A backlog that grows beyond the queue triggers backpressure to the caller.

A reasonable starting point: `queue = workers × 4`. Larger queues smooth bursts at the cost of memory and latency. Smaller queues propagate backpressure sooner.

### Why queue depth matters

Imagine workers=8, queue=100,000. A 100,000-item burst queues entirely, and the producer returns instantly. But the work waits — the *latency* of items at the tail is `100,000 / 8 / per-item-time` seconds. If per-item takes 100 ms, the last item finishes after ~21 minutes. The caller already gave up.

Better: queue=32, workers=8. Producer blocks at depth 32. Caller sees backpressure. Work latency stays bounded.

The queue should be a *shock absorber*, not a *garbage can*.

---

## Backpressure End-to-End

Backpressure is the property that "I am full" propagates upstream. Without it, the upstream produces faster than the downstream consumes, and the pipeline grows unboundedly somewhere — usually in a goroutine pile.

### The wrong way

```go
func handler(w http.ResponseWriter, r *http.Request) {
    job := decodeJob(r)
    pool.TrySubmit(job) // dropped if full; client gets 200 anyway
    w.WriteHeader(200)
}
```

The client thinks the work was accepted. It silently was not.

### The right way

```go
func handler(w http.ResponseWriter, r *http.Request) {
    job := decodeJob(r)
    select {
    case pool.jobs <- job:
        w.WriteHeader(202)
    case <-r.Context().Done():
        w.WriteHeader(503)
    default:
        // pool is full
        w.WriteHeader(429) // Too Many Requests
        return
    }
}
```

The handler returns 429 when full. The client (which has retry/backoff) reduces its rate. Backpressure has crossed the network.

### Multi-stage pipelines

```
Producer ──▶ Stage1 (bounded queue) ──▶ Stage2 (bounded queue) ──▶ Sink
```

Each stage's queue must be bounded; otherwise it acts as an infinite buffer for the next stage's slowness. Propagation works because each stage blocks at its queue's capacity.

A common bug: making stage 1's queue huge "to avoid blocking the producer." Stage 1 now hides stage 2's slowness; the operator only sees the failure when stage 1's memory blows up.

---

## Per-Tenant and Multi-Tier Bounds

A single global limit is fair to nobody. One noisy tenant uses the entire cap; quiet tenants starve. Production systems need *layered* limits.

### The layers

1. **Global cap** — the absolute ceiling for the service.
2. **Per-tenant cap** — how much one tenant may consume.
3. **Per-endpoint cap** — different endpoints have different costs.

```go
type Limits struct {
    global  *semaphore.Weighted
    tenants map[string]*semaphore.Weighted
    mu      sync.Mutex
}

func (l *Limits) Acquire(ctx context.Context, tenant string) (func(), error) {
    if err := l.global.Acquire(ctx, 1); err != nil {
        return nil, err
    }
    tsem := l.tenantSem(tenant)
    if err := tsem.Acquire(ctx, 1); err != nil {
        l.global.Release(1)
        return nil, err
    }
    return func() {
        tsem.Release(1)
        l.global.Release(1)
    }, nil
}

func (l *Limits) tenantSem(tenant string) *semaphore.Weighted {
    l.mu.Lock()
    defer l.mu.Unlock()
    s, ok := l.tenants[tenant]
    if !ok {
        s = semaphore.NewWeighted(perTenantCap)
        l.tenants[tenant] = s
    }
    return s
}
```

Note the order: acquire global first, then tenant. Release in reverse. This prevents a tenant from holding tenant-cap while waiting for global.

### Sizing the layers

A common allocation: each tenant gets `globalCap / max_tenants × headroom_factor`. If global=200 and you expect 10 simultaneous tenants:

```
perTenant = 200 / 10 × 0.5 = 10
```

The 0.5 factor leaves room for one tenant to burst above their fair share when others are quiet.

---

## Refactoring an Existing Codebase

A real codebase has dozens of unbounded loops, accreted over years. Here is the playbook.

### Step 1 — Find them

```bash
# Spawn-inside-loop pattern
grep -rn --include='*.go' -B2 'go .*(' . \
  | awk '/for /{flag=1} flag{print} /^[^-]/{flag=0}' \
  | less
```

A better tool: `golangci-lint` with a custom `gocritic` check, or `semgrep`:

```yaml
# semgrep rule
rules:
  - id: unbounded-goroutine-loop
    pattern: |
      for $... {
        ...
        go $F(...)
        ...
      }
    message: Goroutine spawn inside a loop — verify a bound exists
    languages: [go]
    severity: WARNING
```

False positives are common (some loops are tiny and intentional). Triage manually.

### Step 2 — Inventory and prioritise

For each finding:

| Question | Risk Score |
|---|---|
| Is the input external/user-controlled? | High if yes |
| Is `len(input)` capped before the loop? | Lower if yes |
| Does the goroutine open an external connection? | High if yes |
| Has this code been hit by an OOM/load incident? | High if yes |

Triage to a queue: critical-path code with untrusted input first.

### Step 3 — Refactor with minimal change

The smallest correct refactor uses `errgroup.SetLimit`:

```go
// Before
func send(users []User) {
    for _, u := range users {
        go sendEmail(u)
    }
}

// After
func send(ctx context.Context, users []User) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(maxConcurrentEmails)
    for _, u := range users {
        u := u
        g.Go(func() error { return sendEmail(ctx, u) })
    }
    return g.Wait()
}
```

Three changes: bound, context, error. Test passes? Merge. Repeat.

### Step 4 — Add tests that fail before the fix

A test that submits a 1-million-item input and asserts memory stays under 200 MB. Run it on CI. Without this, the next developer un-fixes your fix.

### Step 5 — Measurement and roll-forward

After deploying:

- Watch `runtime.NumGoroutine()` — should be flat near `N + workers`, not spiky.
- Watch heap — should be flat under load.
- Watch downstream latencies — should improve or stay the same.
- Watch your error-rate metric — bounded fan-out may cause some 429s. That is *correct*. Tune the cap or the queue.

### Step 6 — Document

In the file:

```go
// SetLimit(64) chosen because:
// - downstream gRPC service supports 256 concurrent streams
// - we run 4 replicas, so per-replica fair share is 64
// - measurements 2026-04 confirmed throughput plateau at this value
g.SetLimit(64)
```

Future you will thank you.

### Step 7 — Add a regression test in CI

A `go vet` style check, a `semgrep` rule, or a custom analyser that fails the build on `for ... go ...` without an enclosing limit. Without enforcement, the pattern returns.

---

## Observability for Bounded Fan-Out

A bounded pool needs four metrics:

| Metric | Type | What it tells you |
|---|---|---|
| `pool_active` | gauge | How many workers currently busy |
| `pool_queue_depth` | gauge | How deep the queue is |
| `pool_rejected_total` | counter | How many `TrySubmit` returned false |
| `pool_latency_seconds` | histogram | Wait time from submit to completion |

A pool that is always at `pool_active == capacity` and growing `pool_queue_depth` is undersized. A pool with rising `pool_rejected_total` is too small *and* the producer is not slowing down.

Wire these via Prometheus or your platform of choice. Alert on:

- `pool_queue_depth / pool_queue_capacity > 0.8` for 5 minutes (capacity warning)
- `pool_rejected_total` increasing (overload)
- `runtime.NumGoroutine()` > expected baseline (regression of the anti-pattern somewhere)

---

## Anti-Patterns at the Middle Level

### Sneaky-unbounded: capacity equal to input size

```go
sem := make(chan struct{}, len(items)) // "bounded"
```

This is unbounded with extra syntax. The cap *must* be a constant or configured value, not derived from `len(items)`.

### Sneaky-unbounded: the wrapper that spawns

```go
func dispatch(item Item) {
    go process(item)
}

for _, x := range items {
    dispatch(x) // looks bounded; is not
}
```

The `go` is now inside `dispatch`, but the caller is still in a loop. The hiding does not change the fan-out.

### Sneaky-unbounded: the closure that recurses

```go
var walk func(n *Node)
walk = func(n *Node) {
    for _, c := range n.Children {
        go walk(c)
    }
}
```

Each node spawns one goroutine per child, recursively. The tree's total node count is the goroutine count. Convert to a queue-driven crawl with a bounded pool.

### Sneaky-unbounded: streaming without flow control

```go
go func() {
    for msg := range subscriber {
        go handle(msg)
    }
}()
```

`subscriber` delivers as fast as the broker can; each delivery spawns. If the broker has a backlog of 10 million, you have 10 million goroutines. Solution: read `msg`, send to a bounded pool with `Submit` that blocks. The broker observes backpressure.

### Sneaky-unbounded: per-request goroutines without server-level cap

```go
// Per-request handler
func handler(w http.ResponseWriter, r *http.Request) {
    go logRequest(r) // one spawn per request
    realHandler(w, r)
}
```

If the HTTP server allows 10,000 concurrent connections and each spawns a logger goroutine, you have 20,000 goroutines. The cure is a bounded log pool that handlers submit to, not direct spawns.

### Sneaky-unbounded: time.After in a loop

```go
for {
    select {
    case <-tick.C:
        for _, w := range work {
            go process(w)
        }
    }
}
```

Each tick spawns a wave. If processing is slow, waves stack. Fold into one drain queue with a continuous worker pool.

---

## Testing the Cap

### Cap-enforcement test

```go
func TestPoolCapEnforced(t *testing.T) {
    const cap = 8
    var (
        cur, peak int32
        wg        sync.WaitGroup
    )

    work := func() {
        n := atomic.AddInt32(&cur, 1)
        for {
            p := atomic.LoadInt32(&peak)
            if n <= p || atomic.CompareAndSwapInt32(&peak, p, n) {
                break
            }
        }
        time.Sleep(20 * time.Millisecond)
        atomic.AddInt32(&cur, -1)
        wg.Done()
    }

    g := new(errgroup.Group)
    g.SetLimit(cap)
    for i := 0; i < 500; i++ {
        wg.Add(1)
        g.Go(func() error { work(); return nil })
    }
    _ = g.Wait()
    wg.Wait()

    if peak > int32(cap) {
        t.Fatalf("peak concurrency %d > cap %d", peak, cap)
    }
}
```

### Memory ceiling test

```go
func TestMemoryCeiling(t *testing.T) {
    var m runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&m)
    before := m.HeapInuse

    items := make([]Item, 1_000_000)
    _ = process(items) // production code path

    runtime.GC()
    runtime.ReadMemStats(&m)
    after := m.HeapInuse

    if after-before > 200<<20 { // 200 MB ceiling
        t.Fatalf("heap grew by %d bytes, expected < 200 MB", after-before)
    }
}
```

This test would fail loudly on the unbounded version. CI catches the regression.

### Cancellation test

```go
func TestCancelStopsInFlight(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    var done int32
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(8)
    for i := 0; i < 1000; i++ {
        g.Go(func() error {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case <-time.After(time.Second):
                atomic.AddInt32(&done, 1)
                return nil
            }
        })
    }
    time.AfterFunc(50*time.Millisecond, cancel)
    _ = g.Wait()
    if done > 16 {
        t.Fatalf("expected most tasks cancelled, got %d completed", done)
    }
}
```

---

## Cheat Sheet

```
SIZE CHOICES:
  CPU-bound      → runtime.NumCPU()
  I/O-bound      → arrival × latency (Little's Law)
  Downstream-bound → downstream_cap / replicas

QUEUE DEPTH:
  queue = workers × 4
  smaller → faster backpressure
  larger  → more smoothing, more latency

PATTERN PICKER:
  Long-lived service work       → worker pool
  Per-request fan-out + errors  → errgroup.SetLimit
  Variable cost per job         → semaphore.Weighted

BACKPRESSURE:
  prefer blocking Submit over silent drop
  HTTP edge: return 429 when full
  pipeline: each stage bounded

PER-TENANT:
  acquire global → acquire tenant
  release tenant → release global

METRICS:
  pool_active, pool_queue_depth, pool_rejected_total, pool_latency_seconds
  runtime.NumGoroutine() as a gauge

REFACTOR:
  1. grep for "go " in loops
  2. triage by input source
  3. SetLimit + context + error return
  4. add ceiling test
  5. document the cap
  6. enforce with semgrep/gocritic
```

---

## Summary

Bounding a fan-out is not the hard part; *operating* one is. Sizing the limit demands measurement. Backpressure must propagate to the request boundary, not vanish into a silent drop. Multi-tenant systems need layered limits. Codebases full of `for ... go ...` are refactored one loop at a time, with tests, metrics, and CI enforcement. Senior level moves up another layer to architecture-wide capacity planning.
