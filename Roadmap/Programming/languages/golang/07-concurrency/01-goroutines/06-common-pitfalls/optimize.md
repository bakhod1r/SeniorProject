# Goroutine Common Pitfalls — Optimize

> Optimization exercises focused on eliminating goroutine pitfalls that hurt performance. The pitfall and the optimization are the same task: remove the leak, the contention, or the churn.

## How to read this file

Each exercise gives a baseline (correct but slow / wasteful) and asks you to find the optimization. Measure before and after. Performance optimizations without measurement are guesses.

```bash
go test -bench=. -benchmem -benchtime=5s -count=5
```

is the minimum command line.

---

## Exercise 1 — Replace `time.After` in a hot select with a reused timer

**Baseline.**

```go
func consumer(messages <-chan Message, timeout time.Duration) {
    for {
        select {
        case m := <-messages:
            handle(m)
        case <-time.After(timeout):
            return
        }
    }
}
```

**Measurement.** Drive at 100 k messages/s; profile `heap`; observe `time.NewTimer` allocations.

**Optimization.**

```go
timer := time.NewTimer(timeout)
defer timer.Stop()
for {
    select {
    case m := <-messages:
        handle(m)
        if !timer.Stop() {
            <-timer.C
        }
        timer.Reset(timeout)
    case <-timer.C:
        return
    }
}
```

**Expected gain.** Reduced allocations by orders of magnitude; reduced GC pressure proportionally.

---

## Exercise 2 — Replace `defer` in a tight loop

**Baseline.**

```go
func processFiles(names []string) error {
    for _, name := range names {
        f, _ := os.Open(name)
        defer f.Close()
        process(f)
    }
    return nil
}
```

**Issue.** All `defer`s accumulate until function exit. 10 000 files = 10 000 open FDs.

**Optimization.** Extract the body into a function so `defer` scopes per-iteration.

```go
func processOne(name string) error {
    f, err := os.Open(name)
    if err != nil { return err }
    defer f.Close()
    return process(f)
}
```

**Bonus.** Pool the buffer used by `process` with `sync.Pool` to reduce allocations.

---

## Exercise 3 — Spawn-per-item versus worker pool

**Baseline.**

```go
for _, j := range jobs {
    go process(j)
}
```

**Issue.** Unbounded goroutine spawn. At 10 k jobs, 10 k goroutines start at once; each costs a stack and scheduler entry.

**Optimization.**

```go
const workers = 16
queue := make(chan Job, workers*2)
var wg sync.WaitGroup
for i := 0; i < workers; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := range queue {
            process(j)
        }
    }()
}
for _, j := range jobs {
    queue <- j
}
close(queue)
wg.Wait()
```

**Expected gain.** Stable memory; throughput closer to CPU-bound optimum.

**Benchmark target.** Compare goroutine count, peak memory, and total time on `jobs` of size 10 k and 100 k.

---

## Exercise 4 — Mutex over a remote call → mutex around in-memory state only

**Baseline.**

```go
mu.Lock()
v, err := remoteFetch(key)
if err != nil {
    mu.Unlock()
    return err
}
cache[key] = v
mu.Unlock()
```

**Issue.** Lock held for the full remote round trip; other goroutines serialise.

**Optimization.**

```go
v, err := remoteFetch(key)
if err != nil { return err }
mu.Lock()
cache[key] = v
mu.Unlock()
```

If concurrent calls for the same key should be deduplicated, layer in `singleflight`.

**Bonus.** Replace `sync.Mutex` with `sync.RWMutex` if reads dominate writes — but measure first; for low-contention workloads `Mutex` is faster.

---

## Exercise 5 — Replace `if instance == nil` with `sync.Once`

**Baseline.**

```go
func DB() *sql.DB {
    if db == nil {
        db = openDB()
    }
    return db
}
```

**Issue.** Race on construction; sometimes multiple DBs created.

**Optimization.**

```go
var (
    db   *sql.DB
    once sync.Once
)

func DB() *sql.DB {
    once.Do(func() { db = openDB() })
    return db
}
```

**Expected.** Correct (no race); after the first call, `once.Do` is a fast atomic check.

---

## Exercise 6 — `sync.Map` benchmarking

**Setup.** Build two caches: one with `map + sync.Mutex`, one with `sync.Map`. Benchmark four workloads:

1. Read-heavy, fixed keys.
2. Read-heavy, growing keys.
3. Write-heavy, fixed keys.
4. Disjoint-key-per-goroutine.

**Expected.** `sync.Map` wins on 1 and 4. `map + Mutex` wins on 2 and 3.

**Pitfall avoided.** Choosing `sync.Map` based on docs without benchmarking.

---

## Exercise 7 — Bounded cgo concurrency

**Baseline.**

```go
for i := 0; i < 1000; i++ {
    go C.heavyCall(args)
}
```

**Issue.** Each cgo call holds an M for its duration. 1000 concurrent calls = 1000 OS threads.

**Optimization.**

```go
sem := make(chan struct{}, runtime.NumCPU())
for i := 0; i < 1000; i++ {
    sem <- struct{}{}
    go func() {
        defer func() { <-sem }()
        C.heavyCall(args)
    }()
}
```

**Measurement.** Track thread count via `/proc/<pid>/status`. Expected: threads bounded.

---

## Exercise 8 — Reduce closure capture size

**Baseline.**

```go
go func() {
    log.Printf("user %s, body %d bytes", req.User, len(req.Body))
}()
```

The closure captures `req` (the whole request). The goroutine holds the request, body, headers, cookies in memory until exit.

**Optimization.**

```go
user, size := req.User, len(req.Body)
go func() {
    log.Printf("user %s, body %d bytes", user, size)
}()
```

The closure captures only two values. The request is freeable as soon as the synchronous handler returns.

**Measurement.** With 1000 concurrent requests, compare RSS before and after.

---

## Exercise 9 — Replace polling with a channel

**Baseline.**

```go
for !ready.Load() {
    runtime.Gosched()
}
useResource()
```

**Issue.** Busy loop. Burns CPU. `Gosched` does not synchronise.

**Optimization.**

```go
<-readyCh
useResource()
```

The producer `close(readyCh)`; the consumer blocks until the close. The runtime parks the goroutine, freeing the M.

**Measurement.** CPU usage during wait drops from 100% to 0%.

---

## Exercise 10 — Buffered result channels for one-shot goroutines

**Baseline.**

```go
errCh := make(chan error)
go func() {
    errCh <- doWork()       // blocks if no receiver
}()
if shouldSkip() {
    return                  // leak!
}
return <-errCh
```

**Issue.** Unbuffered channel; if `shouldSkip`, the goroutine leaks.

**Optimization.**

```go
errCh := make(chan error, 1)
```

Size 1 buffer absorbs the single send; goroutine completes regardless of receiver.

**Performance impact.** Negligible. **Correctness impact.** Eliminates a leak.

---

## Exercise 11 — `sync.Pool` for ephemeral allocations

**Baseline.**

```go
func handle(r *http.Request) {
    buf := make([]byte, 4096)
    ...
}
```

**Issue.** 1 k RPS × 4 KB = 4 MB/s of garbage.

**Optimization.**

```go
var pool = sync.Pool{
    New: func() any { return make([]byte, 4096) },
}

func handle(r *http.Request) {
    buf := pool.Get().([]byte)
    defer pool.Put(buf)
    // use buf
}
```

**Caveats.**

- `sync.Pool` may discard at any GC. Do not assume Get returns a recent Put.
- If your objects have state (e.g., buffers with content), Reset on Get.

---

## Exercise 12 — Replace `time.Tick` with `time.NewTicker` and `Stop`

**Baseline.**

```go
for t := range time.Tick(time.Second) {
    publish(t)
    if shouldStop() { return }
}
```

**Issue.** Ticker is never stopped. After return, leaks forever.

**Optimization.**

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for tick := range t.C {
    publish(tick)
    if shouldStop() { return }
}
```

**Performance impact at scale.** Each call to the leaky function adds a permanent ticker. Memory grows monotonically.

---

## Exercise 13 — Cancel context promptly to release downstream resources

**Baseline.**

```go
ctx, _ := context.WithTimeout(parent, 30*time.Second)
result, err := slowQuery(ctx)
if err != nil { return err }
return process(result)
```

**Issue.** `cancel` is discarded. Even after `slowQuery` returns, the context's timer goroutine lives until the deadline.

**Optimization.**

```go
ctx, cancel := context.WithTimeout(parent, 30*time.Second)
defer cancel()
result, err := slowQuery(ctx)
if err != nil { return err }
return process(result)
```

**Measurement.** Active goroutine count drops; pprof shows fewer `context` goroutines.

---

## Exercise 14 — Limit retry concurrency

**Baseline.**

```go
func retry(fn func() error) error {
    for i := 0; i < 5; i++ {
        if err := fn(); err == nil { return nil }
        time.Sleep(backoff(i))
        go retry(fn)        // BUG: spawns another retry goroutine
    }
    return errors.New("max")
}
```

The recursive `go retry(fn)` spawns concurrent retries. Spawn rate compounds. Under sustained failure, goroutine count explodes.

**Optimization.** Plain serial retry; or a bounded retry queue with a worker pool.

```go
func retry(fn func() error) error {
    var err error
    for i := 0; i < 5; i++ {
        if err = fn(); err == nil { return nil }
        time.Sleep(backoff(i))
    }
    return err
}
```

---

## Exercise 15 — Drain a channel on shutdown

**Baseline.**

```go
func (s *Service) Shutdown() {
    s.cancel()
    s.wg.Wait()
}
```

A worker has data in `s.results` that should be flushed. Workers exit (because ctx is cancelled) without draining.

**Optimization.** Drain explicitly before workers exit.

```go
case <-ctx.Done():
    flushBatch(localBatch)
    return
```

Or have a "finalizer" goroutine that runs after `wg.Wait()` and processes leftover state.

---

## Exercise 16 — Reduce goroutine startup latency

**Setup.** Measure the latency from `go f()` to the first instruction of `f`.

```go
start := time.Now()
go func() {
    elapsed := time.Since(start)
    // record elapsed
}()
```

**Observation.** Typical latency: hundreds of nanoseconds to a few microseconds. Under contention or high goroutine load: tens of microseconds.

**Optimizations.**

- Avoid spawning goroutines for tiny work units. A goroutine that runs for 100 ns has 1000% overhead.
- Reuse workers via a pool.
- Avoid large closures (allocation cost).

---

## Exercise 17 — Use `atomic.Int64` instead of mutex for hot counters

**Baseline.**

```go
var mu sync.Mutex
var n int64

func inc() { mu.Lock(); n++; mu.Unlock() }
```

**Optimization.**

```go
var n atomic.Int64

func inc() { n.Add(1) }
```

**Benchmark.** On a 16-core machine, atomic increments are typically 2-5x faster than mutex-protected increments for single-counter workloads.

**Caveat.** Atomics shine for single-field state. For multi-field updates, mutexes are simpler and correct.

---

## Exercise 18 — Avoid `sync.WaitGroup` overhead with `errgroup` for typed errors

If you already need error aggregation, `errgroup` reduces boilerplate and provides cancellation. The `errgroup.Group` itself has slightly more overhead than a raw `WaitGroup`, but the cancellation savings often pay back.

---

## Exercise 19 — Reduce M creation via static thread pool

If your service has cgo or `LockOSThread` work, pre-warm a small static pool of pinned goroutines and dispatch work to them via a channel. Avoids per-request M creation and destruction.

```go
type Pool struct {
    work chan func()
}

func New(n int) *Pool {
    p := &Pool{work: make(chan func(), n)}
    for i := 0; i < n; i++ {
        go func() {
            runtime.LockOSThread()
            for f := range p.work {
                f()
            }
            // exit without UnlockOSThread to destroy the M (intentional)
        }()
    }
    return p
}
```

---

## Exercise 20 — Cap pprof + tracing overhead in production

`pprof` and tracing are essential but have non-zero overhead. For high-throughput services, sample sparingly:

```go
// Sample 1% of requests for tracing
if rand.Float64() < 0.01 {
    trace.Log(ctx, "category", "value")
}
```

`runtime/trace` Start/Stop should run for seconds, not minutes; a 5 GB trace is rarely useful.

---

## Cross-cutting principle

Every "pitfall" in this subsection has two costs:

1. **Correctness.** The program produces wrong results or fails to make progress.
2. **Performance.** The program wastes memory, CPU, threads, or GC time.

Sometimes both. Sometimes only one. A leaked goroutine on the rare error path may never affect correctness but slowly fills memory. A `time.Sleep` for synchronisation may sometimes work; the cost is hours of debugging when it does not.

The optimization framing is the same as the correctness framing: *remove the pitfall*. Bound the queue. Reuse the timer. Replace polling with channels. Limit spawn rate. Profile, measure, repeat.

---

## Summary

Goroutine optimization is rarely about making goroutines faster. The runtime is already fast. Optimization is about *reducing waste*:

- Fewer goroutine spawns.
- Smaller closures.
- Bounded concurrency.
- Reused timers and buffers.
- Avoiding deadlocks and leaks that compound under load.

Each of the 20 exercises above is a worked example of the same principle: find the pitfall, measure the cost, eliminate it, measure again. The measurement is non-negotiable. Without numbers, you are guessing.

For correctness-focused work, return to [find-bug.md](find-bug.md). For deep coverage of goroutine leaks specifically, see [07-goroutine-lifecycle-leaks](../07-goroutine-lifecycle-leaks/).
