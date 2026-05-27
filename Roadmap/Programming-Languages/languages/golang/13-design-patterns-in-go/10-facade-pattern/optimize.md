# Facade Pattern — Optimization

## 1. How to use this file

Twelve scenarios where facade code is slower than it needs to be. Each:

- **Scenario** — the inefficiency.
- **Before** — measured-slow code with realistic benchmark numbers.
- **After** (collapsible) — optimised version with benchmark comparison.
- **Why faster** — what changed at the runtime level.
- **Trade-offs** — what you lose by optimising.
- **When NOT to do this** — the cases where the optimisation isn't worth it.

The honest answer for most facade "optimisations": the facade is rarely the bottleneck — the subsystems behind it are. A facade call itself is 1-10 ns of overhead. What hurts is what the facade *does*: serial calls when parallel would work, locks that span the whole flow, allocations that fan out into every subsystem method, lazy init via mutex, and so on. Benchmarks below are illustrative. Qualitative direction (allocs vs no allocs, serialised vs parallel) matters more than absolute ns/op. Go 1.22, amd64, GOMAXPROCS=8.

---

## 2. Table of Contents

1. [How to use this file](#1-how-to-use-this-file)
2. [Table of Contents](#2-table-of-contents)
3. [Exercise 1 — Facade lock around all calls instead of per-subsystem locks](#exercise-1--facade-lock-around-all-calls-instead-of-per-subsystem-locks)
4. [Exercise 2 — Sequential subsystem calls when they can run in parallel](#exercise-2--sequential-subsystem-calls-when-they-can-run-in-parallel)
5. [Exercise 3 — Allocation per call for subsystem method args](#exercise-3--allocation-per-call-for-subsystem-method-args)
6. [Exercise 4 — Facade returning interface forces escape](#exercise-4--facade-returning-interface-forces-escape)
7. [Exercise 5 — Mutex in facade for simple state instead of atomic](#exercise-5--mutex-in-facade-for-simple-state-instead-of-atomic)
8. [Exercise 6 — Lazy init via mutex instead of sync.Once](#exercise-6--lazy-init-via-mutex-instead-of-synconce)
9. [Exercise 7 — Many small subsystem calls instead of batching](#exercise-7--many-small-subsystem-calls-instead-of-batching)
10. [Exercise 8 — PGO devirtualization for hot facade methods](#exercise-8--pgo-devirtualization-for-hot-facade-methods)
11. [Exercise 9 — fmt.Sprintf in facade error wrapping](#exercise-9--fmtsprintf-in-facade-error-wrapping)
12. [Exercise 10 — Facade caching subsystem results for read-heavy workloads](#exercise-10--facade-caching-subsystem-results-for-read-heavy-workloads)
13. [Exercise 11 — Facade per request instead of reused with injected state](#exercise-11--facade-per-request-instead-of-reused-with-injected-state)
14. [Exercise 12 — Reflection-based dispatch replaced by direct method calls](#exercise-12--reflection-based-dispatch-replaced-by-direct-method-calls)
15. [When NOT to optimize](#when-not-to-optimize)
16. [Summary](#summary)

---

## Exercise 1 — Facade lock around all calls instead of per-subsystem locks

**Scenario:** An `OrderFacade` holds a single mutex that's locked for the entire duration of every facade method. The facade calls into independent subsystems (inventory, billing, shipping, notification) that don't share state. Under load, the global lock serializes every request even when subsystems would happily run concurrently.

**Before:**

```go
type OrderFacade struct {
    mu           sync.Mutex // guards everything
    inventory    *InventoryService
    billing      *BillingService
    shipping     *ShippingService
    notification *NotificationService
}

func (f *OrderFacade) PlaceOrder(ctx context.Context, o Order) error {
    f.mu.Lock()
    defer f.mu.Unlock()

    if err := f.inventory.Reserve(ctx, o.Items); err != nil {
        return err
    }
    if err := f.billing.Charge(ctx, o.UserID, o.Total); err != nil {
        return err
    }
    if err := f.shipping.Schedule(ctx, o.Address); err != nil {
        return err
    }
    return f.notification.Send(ctx, o.UserID)
}
```

Benchmark with 8 concurrent callers, each subsystem call simulating ~2 ms of work:

```
BenchmarkGlobalLock-8     500    8_200_000 ns/op    256 B/op    5 allocs/op
```

The whole flow takes ~8 ms when run sequentially under a global lock. The four subsystems each take ~2 ms; they execute in series because the lock prevents any concurrency.

<details><summary>After</summary>

Drop the global lock. The subsystems have their own internal synchronization (each is concurrency-safe). The facade should not impose serialisation it doesn't need:

```go
type OrderFacade struct {
    inventory    *InventoryService    // each is internally safe
    billing      *BillingService
    shipping     *ShippingService
    notification *NotificationService
}

func (f *OrderFacade) PlaceOrder(ctx context.Context, o Order) error {
    if err := f.inventory.Reserve(ctx, o.Items); err != nil {
        return err
    }
    if err := f.billing.Charge(ctx, o.UserID, o.Total); err != nil {
        return err
    }
    if err := f.shipping.Schedule(ctx, o.Address); err != nil {
        return err
    }
    return f.notification.Send(ctx, o.UserID)
}
```

If the facade has state that genuinely needs protection (e.g. a per-order ID counter), use a narrow lock scoped to just that field — or better, an atomic (see Exercise 5).

Benchmark with 8 concurrent callers (subsystems each ~2 ms, executed sequentially per request but requests no longer block each other):

```
BenchmarkPerSubsystemLock-8     4000    2_100_000 ns/op    256 B/op    5 allocs/op
```

Per-request latency is unchanged at ~2 ms each (sequential within the request), but throughput is 8× higher: requests no longer wait for each other.

**Why faster:** The previous code serialised eight goroutines through one mutex, so the system processed one order at a time. Removing the global mutex lets the runtime schedule all eight requests in parallel — each still runs its own subsystem calls in sequence, but the requests don't fight for a single lock. For the counter case, narrowing the lock means contention only on the small critical section (a few ns), not the entire request flow.

**Trade-offs:** You need to verify each subsystem actually is concurrency-safe — if any of them has hidden shared state that the global lock was implicitly protecting, you'll get races. Run with `-race` to confirm. Also: ordering guarantees that came "for free" from the global lock are gone. If business logic relies on "no two orders ever interleave", that has to be enforced elsewhere (e.g. per-user lock, optimistic concurrency at the DB).

**When NOT to do this:** When the subsystems genuinely share mutable state that the facade was protecting (rare — usually a smell). Also when the facade is rarely called concurrently; for a CLI tool processing one order at a time, the lock costs nothing.

```bash
# Detect contention on the mutex
go test -bench=. -mutexprofile=mu.pprof -blockprofile=block.pprof
go tool pprof -top mu.pprof    # confirm the facade mutex disappears from contention top
go tool pprof -top block.pprof # confirm blocking time dropped
```
</details>

---

## Exercise 2 — Sequential subsystem calls when they can run in parallel

**Scenario:** A `DashboardFacade.Render` calls into four read-only subsystems (user profile, recent orders, recommendations, notifications). Each takes ~50 ms because they hit different downstream services. The facade calls them sequentially; the user waits for the sum.

**Before:**

```go
type DashboardData struct {
    Profile         UserProfile
    Orders          []Order
    Recommendations []Item
    Notifications   []Notification
}

func (f *DashboardFacade) Render(ctx context.Context, userID int64) (DashboardData, error) {
    profile, err := f.users.Get(ctx, userID)       // ~50 ms
    if err != nil {
        return DashboardData{}, err
    }
    orders, err := f.orders.Recent(ctx, userID, 10) // ~50 ms
    if err != nil {
        return DashboardData{}, err
    }
    recs, err := f.recommender.For(ctx, userID)     // ~50 ms
    if err != nil {
        return DashboardData{}, err
    }
    notifs, err := f.notifs.Unread(ctx, userID)     // ~50 ms
    if err != nil {
        return DashboardData{}, err
    }
    return DashboardData{
        Profile: profile, Orders: orders,
        Recommendations: recs, Notifications: notifs,
    }, nil
}
```

```
BenchmarkSerialFacade-8     5    200_000_000 ns/op
```

200 ms per render — four 50 ms calls in series.

<details><summary>After</summary>

Fan out with `errgroup`:

```go
import "golang.org/x/sync/errgroup"

func (f *DashboardFacade) Render(ctx context.Context, userID int64) (DashboardData, error) {
    g, gctx := errgroup.WithContext(ctx)

    var (
        profile UserProfile
        orders  []Order
        recs    []Item
        notifs  []Notification
    )

    g.Go(func() error {
        var err error
        profile, err = f.users.Get(gctx, userID)
        return err
    })
    g.Go(func() error {
        var err error
        orders, err = f.orders.Recent(gctx, userID, 10)
        return err
    })
    g.Go(func() error {
        var err error
        recs, err = f.recommender.For(gctx, userID)
        return err
    })
    g.Go(func() error {
        var err error
        notifs, err = f.notifs.Unread(gctx, userID)
        return err
    })

    if err := g.Wait(); err != nil {
        return DashboardData{}, err
    }
    return DashboardData{
        Profile: profile, Orders: orders,
        Recommendations: recs, Notifications: notifs,
    }, nil
}
```

```
BenchmarkParallelFacade-8    20    52_000_000 ns/op
```

~4× faster (50 ms + scheduling overhead).

**Why faster:** Latency is now bounded by the slowest call, not the sum. Each goroutine sleeps on its own RPC; the runtime parks them and the wall-clock time becomes `max(t1, t2, t3, t4)` instead of `t1 + t2 + t3 + t4`. The goroutine creation cost (~3 μs each) is dwarfed by the 50 ms saved.

**Trade-offs:**
- **Resource amplification.** One request now creates 4 concurrent downstream calls. If you serve 1k RPS, that's 4k downstream RPS. The downstreams need to handle the fan-out.
- **Partial-failure handling becomes harder.** With sequential code, the first failure short-circuits. With `errgroup`, the first error cancels the context — but the other goroutines may have already completed work that's now wasted. If one call is "must succeed" and others are "best effort", split them: do the must-succeed one first, then fan out the rest.
- **Error masking.** `errgroup.Wait()` returns the first error; subsequent errors are lost. For diagnostics, you may want a custom collector.
- **Reordering side effects.** If one subsystem call had a side effect that another depended on (e.g. user-profile creation gating orders), parallelising breaks that ordering.

**When NOT to do this:** When the calls are interdependent — call B needs call A's result. Fanning out then doesn't help. Also when downstream services can't handle the increased concurrency (a poorly-tuned database, an external API with strict rate limits). Sometimes a sequential pipeline with one downstream-friendly request is better than four parallel ones that get throttled.

```bash
# Verify the speedup matches the slowest call, not the sum
go test -bench=Facade -trace=trace.out
go tool trace trace.out   # look at the goroutine timeline
```
</details>

---

## Exercise 3 — Allocation per call for subsystem method args

**Scenario:** A `MetricsFacade.Record` method builds a request struct on every call, populated with several slices and a map. The subsystem doesn't retain the struct; it reads the fields and writes to a backing store. Yet every call allocates.

**Before:**

```go
type MetricEvent struct {
    Labels   map[string]string
    Tags     []string
    Values   []float64
    Buckets  []float64
}

type MetricsFacade struct {
    backend *MetricsBackend
}

func (f *MetricsFacade) Record(name string, value float64, tags []string) {
    ev := MetricEvent{
        Labels:  map[string]string{"name": name},
        Tags:    append([]string{}, tags...),
        Values:  []float64{value},
        Buckets: []float64{0.1, 0.5, 1, 5, 10},
    }
    f.backend.Submit(ev)
}
```

```
BenchmarkAllocPerRecord-8    2000000    720 ns/op    432 B/op    7 allocs/op
```

Every call creates a fresh map, three slices, and the struct itself. At 100k RPS, that's ~43 MB/s of allocation pressure, all of it ephemeral.

<details><summary>After</summary>

Reuse buffers via `sync.Pool`. The pooled object carries pre-sized slices and a map you `clear()` on release:

```go
type metricBuf struct {
    Labels  map[string]string
    Tags    []string
    Values  []float64
    Buckets []float64
}

var metricPool = sync.Pool{
    New: func() any {
        return &metricBuf{
            Labels:  make(map[string]string, 4),
            Tags:    make([]string, 0, 8),
            Values:  make([]float64, 0, 4),
            Buckets: []float64{0.1, 0.5, 1, 5, 10}, // fixed; reused
        }
    },
}

func (f *MetricsFacade) Record(name string, value float64, tags []string) {
    b := metricPool.Get().(*metricBuf)
    defer func() {
        clear(b.Labels)
        b.Tags = b.Tags[:0]
        b.Values = b.Values[:0]
        // Buckets is fixed; do not reset
        metricPool.Put(b)
    }()

    b.Labels["name"] = name
    b.Tags = append(b.Tags, tags...)
    b.Values = append(b.Values, value)

    f.backend.SubmitBuf(b) // backend must NOT retain b after return
}
```

The backend must be modified to accept the pooled buffer and copy out anything it retains before returning (do NOT store the pointer past the call).

```
BenchmarkPooledRecord-8     20000000     85 ns/op     0 B/op    0 allocs/op
```

~8× faster, zero allocations.

**Why faster:** No allocator pressure, no GC scans of these short-lived objects. The hit on the hot path is two atomic loads (pool get/put) and a few memory writes into pre-allocated slots.

**Trade-offs:**
- **Aliasing bugs.** The backend must copy what it needs. Holding a pointer to the pooled buffer past `Put` causes corruption. This is the #1 source of pool-related bugs.
- **Reset discipline.** Forgetting to `clear(b.Labels)` leaks state across calls — the next caller sees stale labels. Cover this with a test that exercises the pool with different inputs.
- **GC drops the pool.** `sync.Pool` releases pooled objects on every GC. Right after GC, the next call allocates. The pool helps steady-state but not first-call latency.
- **API uglier.** The backend now has a `SubmitBuf` taking an internal type, which leaks the optimisation into the interface.

**When NOT to do this:**
- Low call rates (<1k RPS) — the pool overhead exceeds the alloc cost.
- The backend retains the data asynchronously (logs it, queues it, etc.). Pooling requires synchronous handoff; if the backend stores the pointer, you cannot return the buffer to the pool.
- The struct is small (<64 B) and contains no nested allocations — the GC handles it fine.

```bash
# Confirm zero allocs and the alloc rate dropped
go test -bench=Record -benchmem
GODEBUG=gctrace=1 go test -bench=Record -benchtime=10s 2>&1 | head -20
```
</details>

---

## Exercise 4 — Facade returning interface forces escape

**Scenario:** The facade method returns an interface (`io.ReadCloser`, `Result`, etc.). The concrete type the facade builds escapes to the heap because the compiler cannot prove the interface doesn't outlive the function.

**Before:**

```go
type QueryResult interface {
    Next() bool
    Scan(dest ...any) error
    Close() error
}

type DBFacade struct{ pool *sql.DB }

func (f *DBFacade) Query(ctx context.Context, q string) QueryResult {
    rows, _ := f.pool.QueryContext(ctx, q)
    return &queryResultImpl{rows: rows} // escapes
}

type queryResultImpl struct{ rows *sql.Rows }

func (q *queryResultImpl) Next() bool                  { return q.rows.Next() }
func (q *queryResultImpl) Scan(dest ...any) error      { return q.rows.Scan(dest...) }
func (q *queryResultImpl) Close() error                { return q.rows.Close() }

func consume(f *DBFacade) {
    for i := 0; i < 1000; i++ {
        r := f.Query(ctx, "SELECT 1")
        r.Close()
    }
}
```

```
BenchmarkInterfaceReturn-8    2000000    520 ns/op    48 B/op    2 allocs/op
```

Escape analysis confirms (`go build -gcflags='-m -m' . 2>&1 | grep queryResultImpl`): `&queryResultImpl{...} escapes to heap`.

<details><summary>After</summary>

Return the concrete pointer. The caller can still assign it into an `QueryResult` variable if they want:

```go
func (f *DBFacade) Query(ctx context.Context, q string) *queryResultImpl {
    rows, _ := f.pool.QueryContext(ctx, q)
    return &queryResultImpl{rows: rows}
}
```

For callers that need the interface (e.g. a generic helper), the conversion happens at the call site, which doesn't force the source value to escape:

```go
func consume(f *DBFacade) {
    for i := 0; i < 1000; i++ {
        r := f.Query(ctx, "SELECT 1") // *queryResultImpl, may stack-allocate
        r.Close()
    }
}
```

```
BenchmarkConcreteReturn-8     20000000     45 ns/op     0 B/op    0 allocs/op
```

~10× speedup, allocations gone (when the concrete value can stay on the stack).

**Why faster:** Returning an interface forces the runtime to box: it allocates an `iface` (type+data) header and the data pointer must outlive the function. When you return the concrete pointer, escape analysis can sometimes prove it doesn't escape (e.g. the caller uses it briefly and discards) and stack-allocate. Even when the concrete still escapes, you save the iface header.

**Trade-offs:**
- **API leak.** The package's internal type is now exposed in the signature. Renaming or changing fields becomes a breaking change. Most facade designs use interfaces specifically to avoid this.
- **Substitution at the boundary is harder.** Mocks and alternative implementations need to be `*queryResultImpl` or close enough — you can't drop in any `QueryResult`.
- **For most facades, the wrong trade.** A facade's job is to expose a stable surface; concrete-return defeats that purpose. Reserve this for hot internal facades, not public ones.

**When NOT to do this:** Public APIs where substitution is the point. Standard library facades (`os.Open` returns `*os.File`, not `io.ReadCloser`) get away with it because the concrete type is a fixture; your custom facade probably shouldn't.

```bash
# Confirm the value no longer escapes
go build -gcflags='-m' . 2>&1 | grep queryResultImpl
# Want to see: "does not escape" or "moved to stack"
```
</details>

---

## Exercise 5 — Mutex in facade for simple state instead of atomic

**Scenario:** The facade tracks a single counter (number of operations performed, current generation, last-request timestamp). The counter is read and written under a mutex.

**Before:**

```go
type Facade struct {
    mu    sync.Mutex
    ops   int64
    last  int64
}

func (f *Facade) Do() {
    f.mu.Lock()
    f.ops++
    f.last = time.Now().UnixNano()
    f.mu.Unlock()
    // ... real work
}

func (f *Facade) Stats() (ops int64, lastNs int64) {
    f.mu.Lock()
    defer f.mu.Unlock()
    return f.ops, f.last
}
```

```
BenchmarkMutexCounter-8     50000000     25 ns/op    0 B/op    0 allocs/op
```

Under contention (8 goroutines), throughput collapses because every goroutine serialises on the lock.

```
BenchmarkMutexCounterContended-8    5000000    280 ns/op
```

<details><summary>After</summary>

Use `sync/atomic`:

```go
type Facade struct {
    ops  atomic.Int64
    last atomic.Int64
}

func (f *Facade) Do() {
    f.ops.Add(1)
    f.last.Store(time.Now().UnixNano())
    // ... real work
}

func (f *Facade) Stats() (ops int64, lastNs int64) {
    return f.ops.Load(), f.last.Load()
}
```

Single-threaded:

```
BenchmarkAtomicCounter-8    300000000     4 ns/op    0 B/op    0 allocs/op
```

Contended (8 goroutines):

```
BenchmarkAtomicCounterContended-8    150000000     12 ns/op
```

~6× faster uncontended; ~20× faster contended.

**Why faster:** Atomic operations compile to a single locked instruction (`LOCK XADD` on amd64). The mutex acquires a futex on contention and does scheduler-visible work. For a counter, the atomic is strictly cheaper. For a "consistent snapshot" of multiple atomics (the two reads in `Stats()` could disagree), put them under one `atomic.Pointer[stats]` with CAS, or fall back to `sync.RWMutex` for the read path.

**Trade-offs:**
- **No grouping.** If you need "atomically update three fields together", atomics on individual fields don't give you that. You need a struct + `atomic.Pointer` or a mutex.
- **64-bit alignment.** On 32-bit platforms, `atomic.Int64` requires the field to be 64-bit aligned. The `atomic.Int64` type in Go 1.19+ handles this; raw `int64 + atomic.AddInt64` does not.
- **Subtle bugs.** Read-modify-write without CAS races (read 5, increment to 6, store; meanwhile someone else also went 5→6, lost an update). For counters, use `Add`; for anything else, use CAS or rethink.

**When NOT to do this:** When updates span multiple variables that must change together (use mutex). When the critical section does I/O or anything other than a few field writes (mutex is fine; the I/O dwarfs the lock cost).

```bash
# Compare lock vs atomic under contention
go test -bench=Counter -cpu=1,2,4,8
```
</details>

---

## Exercise 6 — Lazy init via mutex instead of sync.Once

**Scenario:** The facade lazily initialises an expensive subsystem (TLS-bound HTTP client, DB pool, schema cache) on first use, guarded by a mutex.

**Before:**

```go
type Facade struct {
    mu     sync.Mutex
    client *http.Client // expensive: TLS handshake setup, pool warm-up
}

func (f *Facade) http() *http.Client {
    f.mu.Lock()
    defer f.mu.Unlock()
    if f.client == nil {
        f.client = buildClient() // 30 ms first call
    }
    return f.client
}
```

```
BenchmarkMutexLazy-8     50000000     25 ns/op    0 B/op    0 allocs/op
```

Every call after init still pays for `Lock`/`Unlock`. Under contention, the mutex serialises all callers.

<details><summary>After</summary>

`sync.Once`:

```go
type Facade struct {
    once   sync.Once
    client *http.Client
}

func (f *Facade) http() *http.Client {
    f.once.Do(func() { f.client = buildClient() })
    return f.client
}
```

```
BenchmarkOnceLazy-8     500000000     2.4 ns/op    0 B/op    0 allocs/op
```

~10× faster post-init; the gap widens under contention because `sync.Once`'s fast path is a single atomic load with no scheduler interaction.

For the absolute fastest version, combine `atomic.Pointer[Client]` with a `sync.Once` guard: fast path is an atomic load (~1 ns), slow path is the once-guarded build.

**Why faster:** `sync.Once.Do` does an atomic load on the fast path. After `done == 1`, every call returns immediately with no lock acquisition. The mutex version pays `Lock`/`Unlock` forever.

**Trade-offs:**
- `sync.Once.Do` takes a closure; the compiler usually inlines the fast path, but the slow path is a closure call. Negligible.
- Error handling: `sync.Once.Do` has no return value. For fallible init use `sync.OnceValue` / `sync.OnceValues` (Go 1.21+) or store the error in a field.

**When NOT to do this:** Almost never. `sync.Once` is strictly better than the mutex pattern for one-time init. The only exception: when re-initialisation is needed (e.g. the client can be invalidated and rebuilt). For that, use `atomic.Pointer` with explicit CAS-and-rebuild, not a mutex.

```bash
# Verify contention is gone
go test -bench=Lazy -mutexprofile=mu.pprof
go tool pprof -top mu.pprof
```
</details>

---

## Exercise 7 — Many small subsystem calls instead of batching

**Scenario:** A facade iterates a list and calls a subsystem method per item. Each call has fixed overhead (network round-trip, lock acquisition, syscall). The total overhead dominates.

**Before:**

```go
type UserFacade struct{ db *DBClient }

func (f *UserFacade) ActivateAll(ctx context.Context, ids []int64) error {
    for _, id := range ids {
        if err := f.db.SetActive(ctx, id, true); err != nil {
            return err
        }
    }
    return nil
}
```

Each `SetActive` issues one DB round-trip (~1 ms).

```
BenchmarkPerItemCall-8    50    20_000_000 ns/op    1024 B/op    20 allocs/op
```

For 1000 IDs, that's 1 second.

<details><summary>After</summary>

Add a batch method to the subsystem (if absent) and call it once:

```go
func (f *UserFacade) ActivateAll(ctx context.Context, ids []int64) error {
    return f.db.SetActiveBatch(ctx, ids, true)
}

// In the DB layer:
func (c *DBClient) SetActiveBatch(ctx context.Context, ids []int64, active bool) error {
    _, err := c.conn.ExecContext(ctx,
        "UPDATE users SET active = $1 WHERE id = ANY($2)",
        active, pq.Array(ids))
    return err
}
```

```
BenchmarkBatchCall-8    5000    220_000 ns/op    96 B/op    3 allocs/op
```

~90× faster.

If the subsystem can't be modified, fall back to bounded-concurrency fan-out via `errgroup.SetLimit(N)`. That doesn't reduce DB load but cuts wall-clock time roughly proportional to the concurrency.

**Why faster:** One round-trip with N IDs amortises the network and parsing overhead. The DB also batches its writes inside a single transaction. The CPU time per ID is roughly unchanged; the wall-clock time is dominated by `1× RTT` instead of `N× RTT`.

**Trade-offs:**
- **All-or-nothing semantics.** A batch usually fails atomically — one bad ID may roll back the whole update. If you need partial success, the subsystem has to support that (returning per-ID statuses).
- **Memory.** Batching builds an in-memory list. For a million IDs, you're materialising a million-row update. Chunk it.
- **Error attribution.** With per-item calls, you know which one failed. With batches, the error often doesn't tell you which row caused the rollback. Validate inputs first.
- **Backpressure.** A batch of a million IDs is one giant query that may lock the table or exceed a query-size limit. Pick a chunk size (1k-10k is typical) and loop.

**When NOT to do this:**
- When items genuinely need independent error handling and you'd retry each one individually.
- When the subsystem has no batch API and adding one is expensive (e.g. a third-party service that only accepts one ID per request — there's nothing to batch).
- When batch size is always 1 in practice (you have a generic batch interface but callers pass one item).

```bash
# Measure the wall-clock for a representative batch
go test -bench=Activate -benchtime=10x -count=5
```
</details>

---

## Exercise 8 — PGO devirtualization for hot facade methods

**Scenario:** The facade holds its subsystems as interfaces (good for testing/mocking). In production, the concrete implementations are fixed (only one production type per interface), but the interface dispatch still pays for itab lookup on every call.

**Before:**

```go
type Cache interface{ Get(string) ([]byte, bool) }
type DB    interface{ Query(string) ([]byte, error) }

type Facade struct {
    cache Cache
    db    DB
}

func (f *Facade) Fetch(key string) ([]byte, error) {
    if b, ok := f.cache.Get(key); ok { // interface dispatch
        return b, nil
    }
    return f.db.Query(key) // interface dispatch
}
```

In production, `cache` is always `*redisCache` and `db` is always `*postgres`.

```
BenchmarkFacadeIface-8     5000000     280 ns/op
```

<details><summary>After (with PGO)</summary>

Collect a CPU profile from production-representative load:

```bash
# Option A: from a benchmark
go test -bench=Fetch -cpuprofile=cpu.pprof -benchtime=30s

# Option B: from a running service
curl -o cpu.pprof http://localhost:6060/debug/pprof/profile?seconds=30

# Apply PGO
mv cpu.pprof default.pgo
go build -pgo=auto . # auto picks up default.pgo
```

```
BenchmarkFacadePGO-8     9000000     150 ns/op
```

~45% faster.

**Why faster:** PGO sees that `f.cache.Get` is dominated by calls into `*redisCache.Get`. The compiler emits a fast-path check (`if itab == redisCacheItab`) followed by an inlined direct call, with the original indirect dispatch as a fallback. The CPU's branch predictor handles the fast path well, and the inlined body lets the compiler do further optimisations (constant folding, dead-code elim) on the hot call site.

Verify devirtualization with `go build -pgo=default.pgo -gcflags='-m=2' . 2>&1 | grep devirtual` — look for lines like `devirtualizing f.cache.Get to *redisCache.Get`.

**Trade-offs:**
- **Build pipeline complexity.** You need a workflow to collect, version, and ship the profile alongside source.
- **Profile must be representative.** A profile from staging or from a workload mix that doesn't match production devirtualizes the wrong implementations and can even regress performance.
- **Binary size.** Typically 3-10% larger due to inlined fast paths.
- **No help if implementations actually vary.** If your facade is called with multiple concrete cache types in production at similar frequencies, PGO has nothing to specialise on.

**When NOT to do this:**
- Small services (<1k QPS) — savings are invisible against network latency.
- Batch jobs, CLIs, anything not running hot enough.
- Early in development — the workload is too volatile to have a stable profile.
- Tests — PGO is for shipping binaries, not test runs.

```bash
# Compare with and without PGO on the same benchmark
go test -bench=Fetch -count=10 > nopgo.txt
go test -bench=Fetch -pgo=default.pgo -count=10 > pgo.txt
benchstat nopgo.txt pgo.txt
```
</details>

---

## Exercise 9 — `fmt.Sprintf` in facade error wrapping

**Scenario:** The facade wraps subsystem errors with context, using `fmt.Sprintf` or `fmt.Errorf` with multiple verbs. On the success path, this is unused — but error wrapping appears on every error return, and for high-error-rate facades (e.g. validation) it dominates.

**Before:**

```go
func (f *OrderFacade) PlaceOrder(ctx context.Context, o Order) error {
    if err := f.inventory.Reserve(ctx, o.Items); err != nil {
        return fmt.Errorf("order %d: inventory reserve for user %d failed: %w", o.ID, o.UserID, err)
    }
    if err := f.billing.Charge(ctx, o.UserID, o.Total); err != nil {
        return fmt.Errorf("order %d: billing charge user %d amount %.2f failed: %w", o.ID, o.UserID, o.Total, err)
    }
    // ...
    return nil
}
```

When inventory often fails (e.g. out-of-stock during a flash sale, 30% error rate):

```
BenchmarkFmtErrorf-8     3000000    420 ns/op    192 B/op    5 allocs/op
```

Each error path allocates the formatted string, the wrapping error struct, and a couple of intermediate interfaces.

<details><summary>After</summary>

Define a typed error and avoid `fmt.Sprintf`:

```go
type OrderError struct {
    OrderID int64
    UserID  int64
    Stage   string // "inventory", "billing", "shipping", "notification"
    Err     error
}

func (e *OrderError) Error() string {
    var sb strings.Builder
    sb.Grow(64)
    sb.WriteString("order ")
    sb.WriteString(strconv.FormatInt(e.OrderID, 10))
    sb.WriteString(": ")
    sb.WriteString(e.Stage)
    sb.WriteString(" failed: ")
    sb.WriteString(e.Err.Error())
    return sb.String()
}

func (e *OrderError) Unwrap() error { return e.Err }

func (f *OrderFacade) PlaceOrder(ctx context.Context, o Order) error {
    if err := f.inventory.Reserve(ctx, o.Items); err != nil {
        return &OrderError{OrderID: o.ID, UserID: o.UserID, Stage: "inventory", Err: err}
    }
    if err := f.billing.Charge(ctx, o.UserID, o.Total); err != nil {
        return &OrderError{OrderID: o.ID, UserID: o.UserID, Stage: "billing", Err: err}
    }
    return nil
}
```

```
BenchmarkTypedError-8     20000000     85 ns/op     32 B/op    1 allocs/op
```

~5× faster, ~6× fewer bytes, ~5× fewer allocations on the error path. The `Error()` string is only built if/when something actually logs the error.

**Why faster:** `fmt.Errorf` parses the format string, boxes each argument into `any` (allocating for non-pointer types like int64 and float64), and dispatches via type switch + reflect on each verb. The typed error stores the fields directly; formatting happens lazily.

When you don't need fields, just a static prefix, prefer `errors.Join(errInventory, err)` or `fmt.Errorf("%w: %w", errInventory, err)` over `Sprintf`-style formatting.

**Trade-offs:**
- **More code.** A typed error per facade is verbose. Worth it for facades with high error rates.
- **Loses the format-string ergonomics.** New fields require updating the struct + the `Error()` method, not just adding a verb.
- **Log-format coupling.** If multiple callers log the error and want different formats, you're stuck with whatever `Error()` produces, or you expose the fields.

**When NOT to do this:** When errors are rare (the path is barely exercised) and clarity beats nanoseconds. Most facade error paths see < 1% of traffic; `fmt.Errorf` is fine there.

```bash
# Identify hot error paths
go test -bench=. -cpuprofile=cpu.pprof
go tool pprof -list 'fmt\.Errorf|fmt\.Sprintf' cpu.pprof
```
</details>

---

## Exercise 10 — Facade caching subsystem results for read-heavy workloads

**Scenario:** A facade's `Get` method calls into a slow subsystem (DB, remote API). The same key is requested repeatedly within a short window. Each request pays the full cost.

**Before:**

```go
type ConfigFacade struct{ store *ConfigStore }

func (f *ConfigFacade) Get(ctx context.Context, key string) (Config, error) {
    return f.store.Fetch(ctx, key) // ~2 ms per call (DB round-trip)
}
```

```
BenchmarkUncachedGet-8     500    2_000_000 ns/op    128 B/op    3 allocs/op
```

Workload: 90% of requests hit a hot set of 50 keys.

<details><summary>After</summary>

Add a TTL cache. For the simple case, `sync.Map` plus expiry timestamps:

```go
type cacheEntry struct {
    cfg     Config
    expires int64 // unix nanos
}

type ConfigFacade struct {
    store *ConfigStore
    cache sync.Map // key -> *cacheEntry
    ttl   time.Duration
}

func (f *ConfigFacade) Get(ctx context.Context, key string) (Config, error) {
    if v, ok := f.cache.Load(key); ok {
        e := v.(*cacheEntry)
        if time.Now().UnixNano() < e.expires {
            return e.cfg, nil
        }
    }
    cfg, err := f.store.Fetch(ctx, key)
    if err != nil {
        return Config{}, err
    }
    f.cache.Store(key, &cacheEntry{
        cfg:     cfg,
        expires: time.Now().Add(f.ttl).UnixNano(),
    })
    return cfg, nil
}
```

```
BenchmarkCachedHit-8     50000000     45 ns/op     0 B/op    0 allocs/op
```

~40000× faster on hits. With a 90% hit rate, average latency drops from 2 ms to ~200 μs.

To avoid a thundering herd when a popular key expires, wrap the miss path in `golang.org/x/sync/singleflight`:

```go
v, err, _ := f.sf.Do(key, func() (any, error) {
    cfg, err := f.store.Fetch(ctx, key)
    if err != nil {
        return nil, err
    }
    f.cache.Store(key, &cacheEntry{cfg: cfg, expires: time.Now().Add(f.ttl).UnixNano()})
    return cfg, nil
})
```

**Why faster:** Hits avoid the subsystem call entirely — just a map lookup and a timestamp compare. `singleflight` ensures a stampede of requests for the same key collapses into one upstream call.

**Trade-offs:**
- **Staleness.** Cached values can be up to `ttl` out of date. Acceptable for config; usually not for inventory counts.
- **Memory.** Cache grows with distinct keys. Bound it (LRU, fixed size) if keys are unbounded.
- **Invalidation.** If a write happens elsewhere, the cache holds stale data until TTL expires. Either accept that, or wire in invalidation (pub/sub from the writer, or shorter TTL).
- **Negative caching.** Should you cache errors? "Not found" responses? Be explicit; failing to cache misses can stampede a slow backend.

**When NOT to do this:**
- Write-heavy workloads where the cache is invalidated as often as it's read.
- Read patterns that are uniform (no hot keys) — the cache wastes memory.
- Strong-consistency requirements (config that must reflect the latest write within milliseconds).
- Tiny key spaces where you should just preload everything at boot instead.

```bash
# Measure hit rate and effective latency
go test -bench=Get -benchtime=10s
# Add instrumentation: count hits vs misses, log hit rate periodically.
```
</details>

---

## Exercise 11 — Facade per request instead of reused with injected state

**Scenario:** An HTTP handler builds a fresh facade per request, populating it with request-scoped state (user ID, tenant, trace context). The facade construction allocates several fields and possibly opens subsystem resources.

**Before:**

```go
type RequestFacade struct {
    userID   int64
    tenant   string
    traceID  string
    cache    *Cache
    db       *DB
    logger   *Logger
    metrics  *Metrics
    requests []Request
}

func handler(w http.ResponseWriter, r *http.Request) {
    f := &RequestFacade{
        userID:   userIDFromCtx(r.Context()),
        tenant:   tenantFromCtx(r.Context()),
        traceID:  traceIDFromCtx(r.Context()),
        cache:    globalCache,
        db:       globalDB,
        logger:   globalLogger.With("trace", traceIDFromCtx(r.Context())),
        metrics:  globalMetrics,
        requests: make([]Request, 0, 8),
    }
    handleRequest(f, r)
}
```

```
BenchmarkPerRequestFacade-8    1000000    1450 ns/op    864 B/op    9 allocs/op
```

At 50k RPS, that's ~45 MB/s of allocation pressure just for facade construction.

<details><summary>After</summary>

Make the facade a long-lived singleton holding the *stable* dependencies, and pass request-scoped state through method arguments (preferred) or a small per-request struct:

```go
type Facade struct { // built once at startup
    cache   *Cache
    db      *DB
    logger  *Logger
    metrics *Metrics
}

type ReqCtx struct {
    UserID  int64
    Tenant  string
    TraceID string
}

func (f *Facade) Handle(ctx context.Context, rc ReqCtx, r Request) error {
    log := f.logger.With("trace", rc.TraceID)
    // ... use f.cache, f.db, log, etc.
    return nil
}

func handler(w http.ResponseWriter, r *http.Request) {
    rc := ReqCtx{
        UserID:  userIDFromCtx(r.Context()),
        Tenant:  tenantFromCtx(r.Context()),
        TraceID: traceIDFromCtx(r.Context()),
    }
    facade.Handle(r.Context(), rc, parseRequest(r))
}
```

The `ReqCtx` stays on the stack (it's a small value type passed by value), and the facade itself has no per-request allocation.

```
BenchmarkSharedFacade-8     30000000     80 ns/op     0 B/op    0 allocs/op
```

~18× faster, zero allocations on the facade construction path.

If you really need a per-request scratch object (buffer, set of recent IDs), pool it via `sync.Pool` (see Exercise 3 for the full pattern).

**Why faster:** No allocation per request for the facade itself. The logger's `.With()` call still allocates (if it must build a new child logger), so consider whether the trace ID truly belongs on the logger or can be threaded through the call as `slog.Attr`.

**Trade-offs:**
- **API churn.** You're moving "captured state" from the receiver to arguments. Methods grow more parameters. Code is more verbose.
- **Risk of forgetting context.** If a method forgets to thread `rc` through, you can't tell from the type system. A context-based approach (`context.Value`) is more flexible but has its own downsides (type-unsafe, harder to test).
- **Closure-style ergonomics gone.** "Bind the user once, call ten methods" becomes "pass user ten times". A middle ground: a per-request `FacadeView` value type wrapping `*Facade + ReqCtx`; small enough to stack-allocate if it doesn't escape.

**When NOT to do this:** When the facade genuinely owns request-scoped resources (a transaction it must commit, a file handle it must close). Then per-request construction reflects the lifetime correctly.

```bash
# Confirm the construction allocations are gone
go test -bench=Handle -benchmem
go test -bench=Handle -memprofile=mem.pprof
go tool pprof -alloc_objects mem.pprof
```
</details>

---

## Exercise 12 — Reflection-based dispatch replaced by direct method calls

**Scenario:** The facade dispatches to subsystems using reflection — typically because of a generic "command bus" or "RPC server" abstraction inside the facade.

**Before:**

```go
type Facade struct {
    handlers map[string]reflect.Value // method values
}

func NewFacade(svc *Service) *Facade {
    f := &Facade{handlers: make(map[string]reflect.Value)}
    v := reflect.ValueOf(svc)
    f.handlers["CreateUser"] = v.MethodByName("CreateUser")
    f.handlers["DeleteUser"] = v.MethodByName("DeleteUser")
    f.handlers["UpdateUser"] = v.MethodByName("UpdateUser")
    return f
}

func (f *Facade) Dispatch(name string, args ...any) ([]any, error) {
    m, ok := f.handlers[name]
    if !ok {
        return nil, fmt.Errorf("unknown method %s", name)
    }
    in := make([]reflect.Value, len(args))
    for i, a := range args {
        in[i] = reflect.ValueOf(a)
    }
    out := m.Call(in)
    res := make([]any, len(out))
    for i, o := range out {
        res[i] = o.Interface()
    }
    return res, nil
}
```

```
BenchmarkReflectDispatch-8     500000    3500 ns/op    640 B/op    16 allocs/op
```

Every call: map lookup + N `reflect.ValueOf` calls + `Call` (which itself uses reflection to set up the stack frame) + N `Interface()` boxings.

<details><summary>After</summary>

Direct method calls. If the dispatch table is fixed at compile time, write a switch:

```go
type Facade struct{ svc *Service }

func (f *Facade) CreateUser(ctx context.Context, name string) (int64, error) {
    return f.svc.CreateUser(ctx, name)
}

func (f *Facade) DeleteUser(ctx context.Context, id int64) error {
    return f.svc.DeleteUser(ctx, id)
}

func (f *Facade) UpdateUser(ctx context.Context, id int64, name string) error {
    return f.svc.UpdateUser(ctx, id, name)
}
```

Callers invoke the typed method directly:

```go
id, err := facade.CreateUser(ctx, "alice")
```

```
BenchmarkDirectCall-8    200000000     12 ns/op     0 B/op    0 allocs/op
```

~300× faster, zero allocations.

If you do need string-keyed dispatch (HTTP handler, RPC router), use a typed dispatch table of closures with a fixed signature like `func(ctx, json.RawMessage) (any, error)`. Each closure handles its own decoding and calls the typed service method directly.

```
BenchmarkClosureDispatch-8    5000000     280 ns/op    96 B/op    2 allocs/op
```

Still ~12× faster than reflection, while keeping the runtime-name dispatch.

**Why faster:** Reflection has several hidden costs:
1. `reflect.ValueOf(x)` for non-pointer values allocates a copy on the heap.
2. `m.Call(args)` allocates the input and output slices and uses an internal calling convention that copies argument data.
3. Each return value is boxed back into `any`.
4. The compiler cannot inline through reflection — every call goes through `reflect.Value.call`.

Direct calls compile to a CALL instruction; closures compile to an indirect CALL through a function pointer. Both are dramatically cheaper than the reflective path.

**Trade-offs:**
- **No runtime extensibility.** With reflection, you can register methods at runtime (plugin systems, dynamic configuration). Direct dispatch can't.
- **Boilerplate.** One closure per method. Code-gen helps if the surface is large.
- **Same generic problem solved differently.** If you needed reflection for a *real* reason (transparent JSON-RPC, decoding arbitrary requests), you can't just delete it. But often facades use reflection where a few `case` clauses would do.

**When NOT to do this:** When the method set is genuinely unknown at compile time (plugin loader, scripting interface). Then reflection is unavoidable — but cache the `reflect.Method` and minimise per-call work (precompute argument types, reuse `reflect.Value` slices via `sync.Pool`).

```bash
# Profile to confirm reflect overhead
go test -bench=Dispatch -cpuprofile=cpu.pprof
go tool pprof -list 'reflect\..*' cpu.pprof
```
</details>

---

## When NOT to optimize

Most facade-related optimisations are micro-optimisations. They matter only if:

1. **Profiling shows the facade is a bottleneck.** Most of the time, the subsystems behind the facade dominate. The facade adds 1-10 ns per call; the subsystem call is 1 μs to 1 ms. Optimising the facade is the wrong place to look unless it's allocating like a maniac, holding a global lock, or serialising work that could parallelise.
2. **The QPS is high enough to matter.** A 100 ns saving × 10 QPS = 1 μs/sec. Irrelevant.
3. **The clarity loss is acceptable.** A facade exists to provide a clean surface. Optimisations that drag subsystem implementation details into the facade signature defeat its purpose.

The right order: measure → identify hot paths → optimise selectively → measure again.

```bash
go test -bench=. -cpuprofile=cpu.pprof -memprofile=mem.pprof
go tool pprof -top -cum cpu.pprof
go test -bench=. -count=10 > before.txt # apply change, then re-run
benchstat before.txt after.txt
```

Premature optimisation of facades is a classic time-waster. The pattern is *already* efficient on the dispatch side — Go's compiler handles the common cases well. The exceptions almost always worth doing without measurement:

- `sync.Once` for lazy init of subsystems (Exercise 6).
- Avoid a global lock around the whole flow when subsystems have their own locking (Exercise 1).
- Don't construct a fresh facade per request when state can be injected (Exercise 11).
- Don't recompile regexes, recompile templates, or rebuild fixed config inside the facade.

Everything else: measure first.

---

## Summary

**Wins that always ship:**
- `sync.Once` for lazy subsystem init (Exercise 6).
- Drop the global lock when subsystems have internal locking (Exercise 1).
- Reuse the facade with injected per-request state instead of constructing it per request (Exercise 11).
- Compile-time interface check (`var _ FacadeIface = (*Facade)(nil)`).

**Wins behind a profile:**
- Parallelise independent subsystem calls with `errgroup` (Exercise 2).
- Reuse buffers via `sync.Pool` for hot facade-to-subsystem arg shapes (Exercise 3).
- Cache read-heavy subsystem results with TTL + `singleflight` (Exercise 10).
- Batch many small subsystem calls into one (Exercise 7).
- Replace `fmt.Errorf` on hot error paths with typed errors (Exercise 9).
- Replace reflection-based dispatch with direct or closure-table calls (Exercise 12).

**Wins that trade off flexibility:**
- Return concrete types instead of interfaces from facade methods (Exercise 4).
- Replace mutex with atomic for simple counter state (Exercise 5).

**Rarely worth it without measurement:** PGO devirtualization (Exercise 8) — only for hot, stable services with a representative profile.

Most facade performance work is *avoiding* serialisation and *moving cost off the hot path*. The three patterns most engineers hit first — global lock around everything (Exercise 1), serial calls to independent subsystems (Exercise 2), per-request facade construction (Exercise 11) — fix the majority of facade-related hotspots in real services with no measurement needed.
