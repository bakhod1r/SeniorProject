# When to Use Concurrency — Find the Bug

> Each snippet uses concurrency in a way that is wrong, wasteful, or counter-productive. Diagnose, then read the explanation.

---

## Bug 1 — Goroutine for every byte

```go
data := []byte("hello world")
var wg sync.WaitGroup
for _, b := range data {
    wg.Add(1)
    go func(b byte) {
        defer wg.Done()
        _ = b * 2
    }(b)
}
wg.Wait()
```

**What is wrong?**

Per-byte goroutines. Each goroutine costs ~500 ns; the work (`b * 2`) is 1 ns. Hundreds of times slower than a simple loop.

**Fix.**

```go
for _, b := range data {
    _ = b * 2
}
```

---

## Bug 2 — Sub-spawning inside an HTTP handler

```go
http.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
    go processRequest(r) // bug
    w.WriteHeader(202)
})
```

**What is wrong?**

`processRequest` runs in a goroutine spawned inside the framework's request goroutine. The handler returns immediately; the spawned goroutine may not finish before the program shuts down. If `processRequest` panics, it crashes the server. If it leaks, you never know.

**Fix.**

If the work is genuinely fire-and-forget, enqueue to a managed worker pool:

```go
select {
case workQueue <- r:
    w.WriteHeader(202)
default:
    http.Error(w, "overloaded", 503)
}
```

Or just run it synchronously:

```go
processRequest(r)
w.WriteHeader(200)
```

---

## Bug 3 — Concurrent code serialised by mutex

```go
var (
    mu sync.Mutex
    s  []int
)

func appendValues(values []int) {
    var wg sync.WaitGroup
    for _, v := range values {
        wg.Add(1)
        go func(v int) {
            defer wg.Done()
            mu.Lock()
            s = append(s, v)
            mu.Unlock()
        }(v)
    }
    wg.Wait()
}
```

**What is wrong?**

All goroutines serialise on the mutex. The append itself is cheap; the lock acquisition dominates. The "concurrent" code is sequential plus overhead.

**Fix.** Sequential is faster:

```go
s = append(s, values...)
```

---

## Bug 4 — Mistaking I/O-bound for CPU-bound

```go
func process(urls []string) {
    workers := runtime.NumCPU()
    // ...
}
```

**What is wrong?**

The work is HTTP fetching (I/O-bound). `NumCPU()` is irrelevant. Worker count should reflect downstream concurrency tolerance (e.g., 16–32 concurrent fetches), not CPU count.

**Fix.**

```go
const workers = 32 // or based on downstream rate limit
```

---

## Bug 5 — Per-CPU worker pool for I/O

```go
workers := runtime.NumCPU()
for i := 0; i < workers; i++ {
    go func() {
        for url := range urls {
            http.Get(url)
        }
    }()
}
```

**What is wrong?**

For I/O-bound work, `NumCPU` is the wrong sizing. 8 workers on an 8-core machine is too few — most of the time they are waiting on the network. You could have 100 in flight.

**Fix.** Size based on workload, not CPU count.

---

## Bug 6 — Unbounded fan-out

```go
for _, url := range allUrls {
    go fetch(url) // 100 000 goroutines
}
```

**What is wrong?**

100 000 goroutines. ~200 MB just for stacks. Likely exhausts file descriptors when each opens a socket. Likely rate-limited by the target.

**Fix.** Bound with a semaphore or `errgroup.SetLimit`:

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(50)
for _, url := range allUrls {
    url := url
    g.Go(func() error { return fetch(url) })
}
g.Wait()
```

---

## Bug 7 — Concurrency where there's a serial bottleneck

```go
var (
    db *sql.DB // single connection
)

for _, q := range queries {
    go db.Exec(q)
}
```

**What is wrong?**

A single DB connection. All goroutines queue. Concurrency does not help.

**Fix.** Either:

- Use a connection pool: `sql.Open` returns a pool by default, but it has a size; ensure it is configured for concurrency.
- Just run sequentially.

---

## Bug 8 — Adding concurrency without measurement

```go
// "Make it faster"
func process(items []Item) []Result {
    g, ctx := errgroup.WithContext(ctx)
    results := make([]Result, len(items))
    for i, item := range items {
        i, item := i, item
        g.Go(func() error {
            results[i] = compute(item) // takes 10 µs
            return nil
        })
    }
    g.Wait()
    return results
}
```

**What is wrong?**

If `compute` takes 10 µs, the goroutine overhead (~1 µs each) plus errgroup overhead exceeds any parallelism gain. Sequential is faster.

**Fix.** Measure the sequential version. If it is fast enough, keep it.

---

## Bug 9 — Async API hiding sync work

```go
func ProcessAsync(req Request) chan Response {
    out := make(chan Response, 1)
    go func() {
        out <- compute(req) // sync work, just wrapped
    }()
    return out
}

// Caller:
resp := <-ProcessAsync(req)
```

**What is wrong?**

The "async" API is purely sync from the caller's view (it waits for the response). The extra channel and goroutine add overhead and complexity without benefit.

**Fix.** Just call `compute(req)` synchronously.

---

## Bug 10 — Premature concurrency

```go
// Comment in code: "Made this concurrent in case we need to scale."
func search(query string) []Result {
    g, _ := errgroup.WithContext(ctx)
    var (
        cache    []Result
        db       []Result
        external []Result
    )
    g.Go(func() error { cache = searchCache(query); return nil })
    g.Go(func() error { db = searchDB(query); return nil })
    g.Go(func() error { external = searchExternal(query); return nil })
    g.Wait()
    return merge(cache, db, external)
}
```

**What is wrong?**

If `searchCache` is 1 ms, `searchDB` is 10 ms, `searchExternal` is 100 ms — the concurrency saves only the difference between max and sum: 100 vs 111 ms. ~10% improvement at the cost of complexity.

But what if `searchCache` should be tried first and `searchDB` only if cache misses? The concurrent design pre-fetches all three even when one is enough. Wasted work + downstream cost.

**Fix.** Often a tiered approach is better:

```go
if r := searchCache(query); len(r) > 0 {
    return r
}
if r := searchDB(query); len(r) > 0 {
    return r
}
return searchExternal(query)
```

Sequential, but smarter. Saves downstream load.

---

## Bug 11 — Concurrent code with hidden contention

```go
type Counter struct {
    n int
    mu sync.Mutex
}

func bench(c *Counter) {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 10000; j++ {
                c.mu.Lock()
                c.n++
                c.mu.Unlock()
            }
        }()
    }
    wg.Wait()
}
```

**What is wrong?**

100 goroutines × 10 000 increments = 1M lock acquisitions, all contending. Sequential `for i := 0; i < 1_000_000; i++ { n++ }` is much faster.

**Fix.** Atomic, or sequential.

```go
type Counter struct {
    n atomic.Int64
}

// Or just sequential.
```

---

## Bug 12 — Concurrency adding latency

```go
func get(key string) (string, error) {
    g, ctx := errgroup.WithContext(ctx)
    var (
        c    string
        from string
    )
    g.Go(func() error { c = getCached(ctx, key); from = "cache"; return nil })
    g.Go(func() error { c = getFresh(ctx, key); from = "fresh"; return nil })
    g.Wait()
    return c, nil
}
```

**What is wrong?**

The race between cache and fresh is non-deterministic. Both run; one wins, one is wasted work. Always doubles downstream load.

Also: `c` and `from` are races (both goroutines write).

**Fix.** Try cache first; fallback to fresh only on miss.

```go
if v, ok := getCached(ctx, key); ok {
    return v, nil
}
return getFresh(ctx, key)
```

---

## Bug 13 — `go` for every method call

```go
type Service struct{}

func (s *Service) HandleA() { go s.processA() }
func (s *Service) HandleB() { go s.processB() }
func (s *Service) HandleC() { go s.processC() }
```

**What is wrong?**

Every public method spawns a goroutine. Callers cannot wait for results. Errors are lost. Resources leak.

**Fix.** Make the methods synchronous; let callers decide whether to wrap in `go`.

---

## Bug 14 — Fan-out where serial-and-cache is better

```go
func enrichItems(items []Item) []EnrichedItem {
    g, _ := errgroup.WithContext(ctx)
    result := make([]EnrichedItem, len(items))
    for i, item := range items {
        i, item := i, item
        g.Go(func() error {
            user := fetchUser(item.UserID) // slow, repeated
            result[i] = enrich(item, user)
            return nil
        })
    }
    g.Wait()
    return result
}
```

**What is wrong?**

Many items have the same `UserID`. Concurrent fetches still call the user service N times for the same user.

**Fix.** Dedupe with `singleflight` and/or cache.

```go
var g singleflight.Group
func fetchUserCached(id string) User {
    v, _, _ := g.Do(id, func() (interface{}, error) {
        return fetchUser(id), nil
    })
    return v.(User)
}
```

Or: collect unique user IDs first, fetch them in one batch, then enrich.

---

## Bug 15 — Concurrent counter without need

```go
var counter atomic.Int64

func handler(w http.ResponseWriter, r *http.Request) {
    counter.Add(1)
    process(r)
}
```

**What is wrong?**

Atomic increment on every request from 32 cores creates a cache-line hot spot. Throughput plateaus.

**Fix:** sharded counter, or per-CPU local counters combined periodically.

---

## Bug 16 — Channel-based coordination overkill

```go
type Counter struct {
    add chan int
    get chan chan int
}

func NewCounter() *Counter {
    c := &Counter{add: make(chan int), get: make(chan chan int)}
    go func() {
        var n int
        for {
            select {
            case d := <-c.add: n += d
            case reply := <-c.get: reply <- n
            }
        }
    }()
    return c
}
```

**What is wrong?**

Channel-mediated counter. Each operation costs hundreds of ns. An atomic counter costs ~5 ns.

**Fix.** `atomic.Int64`.

---

## Bug 17 — Goroutine per item in a batch

```go
func send(items []Item) {
    for _, item := range items {
        go sendOne(item) // unbounded
    }
}
```

**What is wrong?**

Unbounded fan-out. If items is large, you spawn many goroutines that exhaust connections / rate limits.

Also: no wait, no error handling.

**Fix.** Worker pool or `errgroup.SetLimit`.

---

## Bug 18 — Aggressive caching that adds latency

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]string
}

func (c *Cache) Get(k string) (string, error) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if v, ok := c.m[k]; ok {
        return v, nil
    }
    v := slowFetch(k) // 100 ms while holding lock
    c.m[k] = v
    return v, nil
}
```

**What is wrong?**

Holding the mutex during the 100 ms fetch blocks all concurrent readers. Cache contention dominates.

**Fix.** Release lock during slow fetch; use `singleflight` to dedupe concurrent misses.

---

## Bug 19 — Pipeline that wastes parallelism

```go
out := make(chan int)
go func() {
    for v := range in {
        out <- transform(v)
    }
    close(out)
}()
```

**What is wrong?**

Single transform goroutine. If `transform` is expensive, this stage is the bottleneck.

**Fix.** Parallelise:

```go
out := make(chan int)
var wg sync.WaitGroup
for i := 0; i < runtime.NumCPU(); i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range in {
            out <- transform(v)
        }
    }()
}
go func() { wg.Wait(); close(out) }()
```

---

## Bug 20 — Saying "we'll do it asynchronously" without backing infrastructure

A team decides to make a slow handler "asynchronous." But:

- No durable queue: jobs are stored in an in-memory channel that loses on restart.
- No retry logic: failed jobs are silently dropped.
- No status endpoint: clients cannot check progress.
- No backpressure: the channel grows unboundedly.

**What is wrong?**

"Asynchronous" without the infrastructure is just "slow handler + extra complexity."

**Fix.** Use a real async system: durable queue (Kafka, NATS, Redis Streams), status endpoint, observability. Or accept the sync API.

---

## Closing

Misapplied concurrency clusters around:

- Concurrency where there is no parallel opportunity (CPU-bound on one core, single bottleneck).
- Unbounded goroutine creation.
- Sub-spawning inside framework goroutines.
- Concurrency-for-its-own-sake without measurement.
- Cargo-cult `go` statements on every method or call.
- Async APIs without async infrastructure.
- Concurrent operations where serial-and-cached is better.
- Channel-mediated coordination for simple shared state.

The default discipline: sequential code is the baseline. Concurrency is opt-in, justified by measurement, bounded explicitly. Use `go test -race` and `-bench` to verify decisions are correct.
