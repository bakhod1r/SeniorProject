# Deadlines and Cancellations — Optimization

> Honest framing first: a single `context.WithCancel` or `context.WithTimeout` call is cheap — a couple of hundred nanoseconds, a heap allocation or two, and a timer registration. You will never beat the standard library by reimplementing it.
>
> What *is* worth optimizing is everything around it: the call sites that allocate contexts they never use, the deeply nested derivation chains that turn one cancellation lookup into ten, the `Value` chains used as bag-of-globals, the polling loops that defeat the entire point of `Done()`, and the missing `cancel()` calls that quietly leak goroutines and timers until the process OOMs at 4 a.m.
>
> Each entry below states the problem, shows a "before" version, an "after" version, and the realistic gain. Code is runnable. Numbers come from `go test -bench=. -benchmem` on a typical Linux laptop unless noted.

---

## Optimization 1 — Don't allocate a context you never use

**Problem:** Every `context.WithCancel`, `WithTimeout`, or `WithDeadline` call allocates a struct, registers a child entry on the parent, and (for timeout/deadline) schedules a `time.Timer`. Code that derives "just in case" pays this cost on every call, even when the derived context is unused.

**Before:**
```go
func (s *Service) GetUser(ctx context.Context, id int) (*User, error) {
    // Always derive, even though we only use the timeout for the slow path.
    ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
    defer cancel()

    if u, ok := s.cache.Get(id); ok {
        return u, nil // cache hit — the WithTimeout was wasted
    }
    return s.db.QueryUser(ctx, id)
}
```
On a cache-heavy path (say 95% hit rate), 95% of the calls allocate a `timerCtx`, start a timer, and stop it again — pure overhead.

**After:**
```go
func (s *Service) GetUser(ctx context.Context, id int) (*User, error) {
    if u, ok := s.cache.Get(id); ok {
        return u, nil // no derivation at all
    }
    ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
    defer cancel()
    return s.db.QueryUser(ctx, id)
}
```

**Gain:** A `WithTimeout/cancel` pair benchmarks at roughly 250–400 ns and 2 allocs. At 100k QPS with 95% cache hits, removing it from the fast path saves ~24 ms of CPU per second per core and ~190k allocations/s — i.e. real GC pressure.

---

## Optimization 2 — Avoid `context.Value` for hot-path data

**Problem:** `context.Value(key)` walks the parent chain linearly, comparing keys with `==`. In a deep chain, every lookup is O(depth). It is fine for request-scoped metadata fetched once per request (trace ID, auth principal). It is not fine for data that the hot loop reads thousands of times.

**Before:**
```go
type ctxKey string
const dbKey ctxKey = "db"

func ProcessBatch(ctx context.Context, items []Item) error {
    for _, it := range items {
        // Each iteration walks the context chain to the dbKey holder.
        db := ctx.Value(dbKey).(*sql.DB)
        if err := db.Exec(...); err != nil {
            return err
        }
    }
    return nil
}
```
With a chain of 6–8 derived contexts (request → tracing → auth → tenant → timeout → cancel), each `Value` call is ~100 ns. At 1M items per batch that is 100 ms of pure key-walking.

**After:**
```go
type Worker struct {
    db *sql.DB
}

func (w *Worker) ProcessBatch(ctx context.Context, items []Item) error {
    db := w.db // resolve once at struct level
    for _, it := range items {
        if err := db.Exec(...); err != nil {
            return err
        }
    }
    return nil
}
```
Or, if you must use the context, hoist the lookup before the loop:
```go
db := ctx.Value(dbKey).(*sql.DB)
for _, it := range items {
    db.Exec(...)
}
```

**Gain:** Hot-path lookup goes from ~100 ns to ~1 ns (a struct field load). At 1M iterations the loop drops from ~100 ms of `Value` overhead to effectively zero.

---

## Optimization 3 — Keep derivation chains shallow

**Problem:** Each derive (`WithCancel`, `WithTimeout`, `WithValue`) adds a node. Deeply nested chains slow down `ctx.Done()` lookup, `Value` walks, and cancel cascades. A 12-deep chain is not unusual in code that derives in every helper.

**Before:**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    ctx = withTrace(ctx)        // +1 node (Value)
    ctx = withAuth(ctx)         // +1 node (Value)
    ctx = withTenant(ctx)       // +1 node (Value)
    ctx = withRequestID(ctx)    // +1 node (Value)
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    serve(ctx, r) // serve internally derives 4 more times before any work happens
}
```

**After (combine values into one carrier):**
```go
type RequestInfo struct {
    TraceID, RequestID, TenantID, UserID string
}

type infoKey struct{}

func WithInfo(ctx context.Context, ri *RequestInfo) context.Context {
    return context.WithValue(ctx, infoKey{}, ri)
}

func InfoFrom(ctx context.Context) *RequestInfo {
    ri, _ := ctx.Value(infoKey{}).(*RequestInfo)
    return ri
}

func handler(w http.ResponseWriter, r *http.Request) {
    ri := &RequestInfo{ /* fill from headers/JWT */ }
    ctx := WithInfo(r.Context(), ri)
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    serve(ctx, r)
}
```
Four `WithValue` nodes collapse into one, and a single struct holds all per-request fields.

**Gain:** `Value` lookups now terminate in one step. Cancel cascade has fewer hops. In a fan-out service with thousands of derived sub-contexts per request, the saved walk time is measurable in microseconds per request — significant under load.

---

## Optimization 4 — Use `context.AfterFunc` instead of a cleanup goroutine (Go 1.21+)

**Problem:** A common idiom is to spawn a goroutine that waits on `ctx.Done()` and runs cleanup. That is one goroutine per cleanup, each costing ~2 KB of stack and a scheduler entry, even when the context never cancels.

**Before:**
```go
func (c *Conn) startCleanup(ctx context.Context) {
    go func() {
        <-ctx.Done()
        c.Close()
    }()
}
```
Spawned 100k times across the lifetime of a server, you have 100k blocked goroutines hanging around — visible as stack memory and as scheduler latency.

**After (Go 1.21+):**
```go
func (c *Conn) startCleanup(ctx context.Context) {
    context.AfterFunc(ctx, c.Close)
}
```
`AfterFunc` registers a callback inside the context's cancel machinery. No goroutine is created until cancellation actually fires; the function then runs in a fresh goroutine just for the cleanup.

**Gain:** Memory drops from `~2 KB × N cleanups` to a few hundred bytes per registration. Live goroutine count stays bounded. `runtime.NumGoroutine()` no longer correlates with idle connections.

---

## Optimization 5 — Don't use `time.After` inside a select loop

**Problem:** `time.After(d)` allocates a fresh `*time.Timer` on every call. Inside a `select` loop the timer is reset every iteration whether or not it fired, leaking timers that the runtime will only GC when they expire — potentially seconds or minutes later.

**Before:**
```go
func poll(ctx context.Context, fn func() error) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(100 * time.Millisecond): // <- new timer per iteration
            if err := fn(); err != nil {
                return err
            }
        }
    }
}
```
Run for 10 minutes at 100 ms cadence and you have 6000 zombie timers held by the runtime until each one expires.

**After:**
```go
func poll(ctx context.Context, fn func() error) error {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            if err := fn(); err != nil {
                return err
            }
        }
    }
}
```
Or, if you want a one-shot timer reused across iterations:
```go
t := time.NewTimer(100 * time.Millisecond)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-t.C:
        if err := fn(); err != nil {
            return err
        }
        t.Reset(100 * time.Millisecond)
    }
}
```

**Gain:** Timer allocations drop from one-per-iteration to one-per-loop. On a busy server with thousands of pollers this removes a significant share of `runtime.timer` book-keeping and steady allocations.

---

## Optimization 6 — Always call `cancel()` — measure the leak

**Problem:** `WithCancel`, `WithTimeout`, and `WithDeadline` all return a cancel function. Forgetting to call it leaks the child node from the parent's `children` map and (for timer-based contexts) leaks the underlying `time.Timer` until its deadline. This compounds: at high QPS the heap fills with stale timer/cancel entries.

**Before:**
```go
func fetch(parent context.Context, url string) (*Response, error) {
    ctx, _ := context.WithTimeout(parent, 5*time.Second) // cancel discarded
    return httpDo(ctx, url)
}
```

**After:**
```go
func fetch(parent context.Context, url string) (*Response, error) {
    ctx, cancel := context.WithTimeout(parent, 5*time.Second)
    defer cancel()
    return httpDo(ctx, url)
}
```

**Measure the leak yourself:**
```go
package main

import (
    "context"
    "fmt"
    "runtime"
    "time"
)

func main() {
    runtime.GC()
    fmt.Println("before:", runtime.NumGoroutine())

    parent, cancelParent := context.WithCancel(context.Background())
    defer cancelParent()

    for i := 0; i < 100_000; i++ {
        // BAD: cancel ignored.
        ctx, _ := context.WithTimeout(parent, 10*time.Minute)
        _ = ctx
    }

    time.Sleep(200 * time.Millisecond)
    runtime.GC()
    var ms runtime.MemStats
    runtime.ReadMemStats(&ms)
    fmt.Printf("after:  goroutines=%d heap=%d KB\n",
        runtime.NumGoroutine(), ms.HeapAlloc/1024)
}
```
Replace the bad line with `ctx, cancel := ...; cancel()` and re-run. The heap delta is the leak.

**Gain:** Eliminating a leaked-cancel hot spot in a real service is often the single biggest "context" optimization you will ever make. `go vet -lostcancel` and `golangci-lint`'s `lostcancel` should be CI gates.

---

## Optimization 7 — Replace `ctx.Err()` polling with `select` on `ctx.Done()`

**Problem:** `ctx.Err()` does a load and a function call. Polling it inside a tight loop reads the cancel state on every iteration, even when nothing has changed. Worse, polling cannot wake the goroutine when something else (a channel send, an I/O return) is what we're actually waiting for.

**Before:**
```go
func consume(ctx context.Context, ch <-chan Job) {
    for {
        if ctx.Err() != nil { // poll on every iteration
            return
        }
        select {
        case j := <-ch:
            handle(j)
        default:
            time.Sleep(time.Millisecond) // burn CPU when ch is idle
        }
    }
}
```
Two problems: the `Err()` poll runs even when the channel is busy, and the `default` branch with `time.Sleep` is a busy-wait that wastes CPU and adds latency.

**After:**
```go
func consume(ctx context.Context, ch <-chan Job) {
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-ch:
            handle(j)
        }
    }
}
```
The goroutine parks on the runtime's channel queue until `ch` produces a value or `ctx` cancels — zero CPU while idle, immediate wakeup on either event.

**Gain:** Idle CPU drops from "constant tens of microseconds per ms" to zero. Latency to react to a job arriving improves from `time.Sleep` granularity (~1 ms) to scheduler granularity (~1 µs).

---

## Optimization 8 — Coalesce timeouts when a batch shares a deadline

**Problem:** Setting an individual timeout per item in a batch creates N timers and N child contexts. If the entire batch shares a single deadline ("everyone must finish by X"), one parent context with a single deadline serves the same purpose at 1/N the cost.

**Before:**
```go
func FetchAll(ctx context.Context, urls []string) []Result {
    res := make([]Result, len(urls))
    var wg sync.WaitGroup
    for i, u := range urls {
        wg.Add(1)
        go func(i int, u string) {
            defer wg.Done()
            // Each request gets its own 2 s timeout — N timers for N urls.
            cctx, cancel := context.WithTimeout(ctx, 2*time.Second)
            defer cancel()
            res[i] = doFetch(cctx, u)
        }(i, u)
    }
    wg.Wait()
    return res
}
```
For 1000 URLs, that is 1000 timers and 1000 timer-context allocations.

**After:**
```go
func FetchAll(ctx context.Context, urls []string) []Result {
    // One parent timeout shared across the whole batch.
    bctx, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()

    res := make([]Result, len(urls))
    var wg sync.WaitGroup
    for i, u := range urls {
        wg.Add(1)
        go func(i int, u string) {
            defer wg.Done()
            res[i] = doFetch(bctx, u) // share the parent
        }(i, u)
    }
    wg.Wait()
    return res
}
```

**Gain:** Allocations drop from O(N) to O(1) per batch. The single timer is enough to cancel every in-flight goroutine because they all derive from `bctx`. Also simpler to reason about: one deadline, one cancellation event.

> Use the per-item timeout only if items have genuinely independent budgets (e.g. retries with separate backoff windows).

---

## Optimization 9 — Use `context.WithoutCancel` for fire-and-forget (Go 1.21+)

**Problem:** Logging, metric flushes, and audit writes triggered at the end of a request often run *after* the request context is cancelled. If they take the request's context, they cancel immediately and the work is lost. Re-using `context.Background()` works but loses request-scoped values (trace ID, tenant ID).

**Before:**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    // ... work ...

    // Detach for the audit write — but we lose trace IDs and other values.
    go func() {
        bg := context.Background()
        audit.Log(bg, "request done")
    }()
}
```
The goroutine sees no trace ID, no tenant, no auth principal — observability falls off a cliff.

**After (Go 1.21+):**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    // ... work ...

    detached := context.WithoutCancel(ctx) // keeps Values, drops cancellation
    go func() {
        audit.Log(detached, "request done")
    }()
}
```
`WithoutCancel(ctx)` returns a context that:
- inherits all `Value` lookups from `ctx`,
- never returns from `Done()` (no cancellation propagates),
- has no deadline.

**Gain:** Background work completes reliably and remains observable. No need to thread a parallel "values-only" context through your code by hand.

---

## Optimization 10 — Cache `ctx.Done()` once per loop

**Problem:** `ctx.Done()` is a method call. The compiler does not always inline it, and on a `cancelCtx` it loads the `done` channel from a struct field protected by a `sync.Mutex` (lazily initialized). Calling it on every iteration of a hot loop is wasted work.

**Before:**
```go
func process(ctx context.Context, items []Item) error {
    for _, it := range items {
        select {
        case <-ctx.Done(): // method call per iteration
            return ctx.Err()
        default:
        }
        if err := handle(it); err != nil {
            return err
        }
    }
    return nil
}
```

**After:**
```go
func process(ctx context.Context, items []Item) error {
    done := ctx.Done() // resolve once
    for _, it := range items {
        select {
        case <-done:
            return ctx.Err()
        default:
        }
        if err := handle(it); err != nil {
            return err
        }
    }
    return nil
}
```
The local `done` is just a channel receive on a chan handle — no method dispatch, no mutex.

**Gain:** Modest per-iteration win (single-digit nanoseconds), but it adds up in tight loops over millions of items. Also makes the cancellation channel an explicit local variable, which reads more clearly.

---

## Optimization 11 — Don't check `ctx.Done()` on every inner-loop tick

**Problem:** Cancellation checks inside the innermost loop add overhead to every iteration even when the work is sub-microsecond. For CPU-bound chunks, the check itself can dominate.

**Before:**
```go
func sumMatrix(ctx context.Context, m [][]float64) (float64, error) {
    var s float64
    for _, row := range m {
        for _, v := range row {
            select {
            case <-ctx.Done():
                return 0, ctx.Err()
            default:
            }
            s += v
        }
    }
    return s, nil
}
```
For a 10000×10000 matrix that is 10^8 select operations protecting 10^8 floating-point adds.

**After:**
```go
func sumMatrix(ctx context.Context, m [][]float64) (float64, error) {
    done := ctx.Done()
    var s float64
    for _, row := range m {
        select {
        case <-done:
            return 0, ctx.Err()
        default:
        }
        for _, v := range row {
            s += v
        }
    }
    return s, nil
}
```
Check at the outer-loop boundary only. Worst-case cancellation latency is "one row's worth of work" — milliseconds at most for any reasonable row size.

**Gain:** For workloads where each inner iteration is short, removing the inner-loop select can speed up the loop 2–5× depending on the work. Cancellation latency is a tunable: pick a granularity (per row, per chunk of N) that bounds the latency you can tolerate.

---

## Optimization 12 — Replace deadline-and-recheck loops with a deadline-aware blocking call

**Problem:** Manually waking up to "see if we are still allowed to continue" implies the runtime does not already know about your deadline. Most blocking primitives accept a context (or a deadline) directly — push the deadline into the call instead of polling.

**Before:**
```go
func waitForFlag(ctx context.Context, f *Flag) error {
    deadline, _ := ctx.Deadline()
    for {
        if f.IsSet() {
            return nil
        }
        if time.Now().After(deadline) {
            return context.DeadlineExceeded
        }
        time.Sleep(10 * time.Millisecond) // arbitrary granularity, wastes CPU
    }
}
```

**After (use a condition variable with deadline-aware wakeup, or simply select on Done):**
```go
type Flag struct {
    mu  sync.Mutex
    set bool
    ch  chan struct{} // closed when set
}

func NewFlag() *Flag { return &Flag{ch: make(chan struct{})} }

func (f *Flag) Set() {
    f.mu.Lock()
    if !f.set {
        f.set = true
        close(f.ch)
    }
    f.mu.Unlock()
}

func (f *Flag) IsSet() bool {
    select {
    case <-f.ch:
        return true
    default:
        return false
    }
}

func waitForFlag(ctx context.Context, f *Flag) error {
    select {
    case <-f.ch:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```
The runtime parks the goroutine until either `f.ch` or `ctx.Done()` fires. No polling, no sleeps, no manual deadline math.

**Gain:** Latency to react to a flag drops from 10 ms (the poll interval) to <1 µs (scheduler wakeup). Idle CPU during the wait drops to zero. Cancellation latency tracks the runtime's `Done` signalling, not a sleep granule.

---

## Optimization 13 — Reuse a single cancelable parent for batches of short-lived children

**Problem:** A worker pool that derives `WithCancel(parent)` for every job creates N children per second, each registered on the parent's `children` map. The map is mutex-protected; under high contention the registration becomes a bottleneck on its own.

**Before:**
```go
func (p *Pool) Run(parent context.Context, jobs <-chan Job) {
    for j := range jobs {
        // Per-job cancelable child — registered on parent.
        ctx, cancel := context.WithCancel(parent)
        p.handle(ctx, j)
        cancel()
    }
}
```
At 1M jobs/s the parent's `children` map sees 2M operations/s under its mutex.

**After:**
```go
func (p *Pool) Run(parent context.Context, jobs <-chan Job) {
    // Derive one cancelable batch-context per N jobs.
    const batch = 1024
    var n int
    var bctx context.Context
    var bcancel context.CancelFunc

    for j := range jobs {
        if n%batch == 0 {
            if bcancel != nil {
                bcancel()
            }
            bctx, bcancel = context.WithCancel(parent)
        }
        p.handle(bctx, j)
        n++
    }
    if bcancel != nil {
        bcancel()
    }
}
```
The parent now sees one registration per 1024 jobs. The mutex contention drops by 1024×.

**Gain:** Removes a cancel-registration hotspot under extreme QPS. Most services do not need this; reach for it only when profiling shows `context.(*cancelCtx).propagateCancel` or `(*cancelCtx).cancel` near the top of a flame graph.

> Caveat: per-batch cancellation is coarser. Use this only when individual job cancellation is not required, or implement per-job cancellation with a different mechanism (e.g. `chan struct{}` per job).

---

## Benchmarking and Measurement

Optimization without measurement is folklore. Useful patterns:

```go
// Allocation cost of a derive.
func BenchmarkWithTimeout(b *testing.B) {
    parent := context.Background()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, cancel := context.WithTimeout(parent, time.Hour)
        cancel()
    }
}

// Goroutine leak detector.
func TestNoLeak(t *testing.T) {
    before := runtime.NumGoroutine()
    runScenario()
    runtime.GC()
    time.Sleep(50 * time.Millisecond)
    if after := runtime.NumGoroutine(); after > before {
        t.Fatalf("leaked %d goroutines", after-before)
    }
}

// Pprof on a real workload.
//   go test -bench=. -cpuprofile=cpu.out -memprofile=mem.out
//   go tool pprof -top -nodecount=20 cpu.out
//   go tool pprof -top -nodecount=20 mem.out
//
// Look for: context.(*cancelCtx).cancel, context.WithCancel, context.WithValue,
// time.After, runtime.timer.* — these are the names that surface when a context
// pattern is the bottleneck.
```

Run `go vet -lostcancel ./...` and `golangci-lint run --enable lostcancel` in CI. They catch the most expensive bug class — leaked cancel functions — before it ships.

---

## When NOT to Optimize

- **Single-shot CLI tool:** every context optimization listed here is invisible against the JVM-style cold-start of starting a Go program. Write the simple version.
- **Code that runs ten times a day:** even a 100 ns saving is irrelevant. Optimize for clarity.
- **Tests:** `context.WithTimeout` in a test is fine. Don't pool, don't reuse, don't collapse — keep the test obvious.
- **Library you do not own:** fixing `context.Value` abuse in someone else's codebase by adding a struct cache might violate their abstraction. Open an issue first.
- **Small `Value` chains:** a 2-deep chain doing 100 `Value` lookups per request is not a problem. The pattern matters at depth × QPS, not in the absolute.

---

## Summary

`context.Context` is a fast, well-engineered primitive. Its cost shows up only when you ignore the things it asks of you: call `cancel`, keep chains shallow, don't poll, don't store hot data in `Value`, prefer the runtime-aware blocking call over the busy loop. Most context "performance bugs" in real services are not slow — they are *leaky*: timers and goroutines and child entries that pile up because nothing ever called `cancel()`. Plug those leaks first; the rest is microseconds. Optimize the patterns, not the package.
