# When to Use Concurrency — Optimization Exercises

> Each exercise has concurrent code that hurts or does not help. Remove or restructure the concurrency. Measure before and after.

---

## Exercise 1 — Per-element goroutine for trivial work

**Baseline.**

```go
func sum(nums []int) int {
    var s atomic.Int64
    var wg sync.WaitGroup
    for _, n := range nums {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            s.Add(int64(n))
        }(n)
    }
    wg.Wait()
    return int(s.Load())
}
```

**Goal.** Remove concurrency.

**Solution.**

```go
func sum(nums []int) int {
    s := 0
    for _, n := range nums {
        s += n
    }
    return s
}
```

100x faster. Concurrency was decoration.

---

## Exercise 2 — Fan-out where caching wins

**Baseline.**

```go
func enrich(items []Item) []Enriched {
    out := make([]Enriched, len(items))
    g, _ := errgroup.WithContext(ctx)
    for i, item := range items {
        i, item := i, item
        g.Go(func() error {
            user := fetchUser(item.UserID)
            out[i] = enrich1(item, user)
            return nil
        })
    }
    g.Wait()
    return out
}
```

If many items share a `UserID`, you fetch the same user repeatedly.

**Goal.** Dedupe.

**Solution.**

```go
import "golang.org/x/sync/singleflight"

func enrich(items []Item) []Enriched {
    out := make([]Enriched, len(items))
    var g singleflight.Group
    var wg sync.WaitGroup
    for i, item := range items {
        i, item := i, item
        wg.Add(1)
        go func() {
            defer wg.Done()
            user, _, _ := g.Do(item.UserID, func() (interface{}, error) {
                return fetchUser(item.UserID), nil
            })
            out[i] = enrich1(item, user.(User))
        }()
    }
    wg.Wait()
    return out
}
```

If 100 items share 10 unique users: from 100 fetches to 10.

---

## Exercise 3 — Sub-spawning in HTTP handler

**Baseline.**

```go
http.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
    go heavyTask(r) // fire-and-forget
    w.WriteHeader(202)
})
```

The goroutine may leak or fail silently.

**Goal.** Make the async work managed.

**Solution.**

```go
var jobs = make(chan *http.Request, 1024)

func init() {
    for i := 0; i < 16; i++ {
        go func() {
            for r := range jobs {
                heavyTask(r)
            }
        }()
    }
}

http.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
    select {
    case jobs <- r:
        w.WriteHeader(202)
    default:
        http.Error(w, "overloaded", 503)
    }
})
```

Bounded workers, bounded queue, load shedding on overload.

---

## Exercise 4 — Concurrent code serialised by lock

**Baseline.**

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}
```

Under 32-core contention, every increment is a cache-line bounce.

**Goal.** Reduce contention.

**Solution.** Sharded counter.

```go
type ShardedCounter struct {
    shards [32]struct {
        n atomic.Int64
        _ [56]byte // padding
    }
}

func (c *ShardedCounter) Inc() {
    idx := someGoroutineHash() % 32
    c.shards[idx].n.Add(1)
}

func (c *ShardedCounter) Load() int64 {
    var total int64
    for i := range c.shards {
        total += c.shards[i].n.Load()
    }
    return total
}
```

Cache-line-isolated shards. Reads are slower (sum all shards) but increments scale linearly.

---

## Exercise 5 — Concurrent search where tiered is better

**Baseline.**

```go
func find(query string) ([]Result, error) {
    g, _ := errgroup.WithContext(ctx)
    var (
        cache []Result
        db    []Result
        api   []Result
    )
    g.Go(func() error { cache = searchCache(query); return nil })
    g.Go(func() error { db = searchDB(query); return nil })
    g.Go(func() error { api = searchAPI(query); return nil })
    g.Wait()
    return merge(cache, db, api), nil
}
```

Always pays cost of all three lookups.

**Goal.** Cheap-first.

**Solution.**

```go
func find(query string) ([]Result, error) {
    if r := searchCache(query); len(r) > 0 {
        return r, nil
    }
    if r := searchDB(query); len(r) > 0 {
        return r, nil
    }
    return searchAPI(query), nil
}
```

Most queries hit cache; saves database and API load.

---

## Exercise 6 — Excessive worker pool

**Baseline.**

```go
const workers = 256

queue := make(chan Job, 1024)
for i := 0; i < workers; i++ {
    go func() {
        for j := range queue {
            process(j) // takes 10 ms CPU
        }
    }()
}
```

CPU-bound work; 256 workers on (say) 8 cores. Workers compete for CPU. Throughput plateaus around 8 simultaneous.

**Goal.** Right-size the pool.

**Solution.**

```go
workers := runtime.NumCPU()
```

8 workers process 800 jobs/sec at full CPU utilisation. 256 workers process the same 800 jobs/sec with scheduling overhead.

---

## Exercise 7 — Unbounded goroutine spawn

**Baseline.**

```go
func handle(events []Event) {
    for _, e := range events {
        go process(e)
    }
}
```

If `events` has 1M elements, 1M goroutines.

**Goal.** Bound concurrency.

**Solution.**

```go
import "golang.org/x/sync/errgroup"

func handle(events []Event) error {
    g, _ := errgroup.WithContext(ctx)
    g.SetLimit(64)
    for _, e := range events {
        e := e
        g.Go(func() error {
            process(e)
            return nil
        })
    }
    return g.Wait()
}
```

64 in flight; rest queue.

---

## Exercise 8 — Channel for one-shot wait

**Baseline.**

```go
done := make(chan struct{})
go func() {
    work()
    close(done)
}()
<-done
```

Just to wait for the goroutine. Channel + goroutine for nothing.

**Goal.** Remove unnecessary indirection.

**Solution.**

```go
work() // synchronously
```

Or, if you genuinely need it in a goroutine (e.g., for timeout enforcement):

```go
err := waitForWork(timeout)
```

---

## Exercise 9 — Concurrent code without measurement

**Baseline.**

A team adds concurrency to a function "to improve scalability." Benchmark:

```
BenchmarkSeq    1000  1000 ns/op
BenchmarkPar    1000  3000 ns/op
```

Concurrent is 3x slower.

**Goal.** Revert.

**Solution.** Profile. Confirm the concurrent version has more overhead than gain. Replace with sequential.

This requires writing the benchmark first. The discipline: every concurrent design comes with a benchmark.

---

## Exercise 10 — Reading multiple files

**Baseline.**

```go
for _, path := range paths {
    data, _ := os.ReadFile(path)
    process(data)
}
```

If `paths` is 100 files of 1 MB each, sequential: ~10 s on a slow disk.

**Goal.** Concurrent read.

**Solution.**

```go
sem := make(chan struct{}, 16) // bound for disk
var wg sync.WaitGroup
for _, path := range paths {
    sem <- struct{}{}
    wg.Add(1)
    go func(path string) {
        defer wg.Done()
        defer func() { <-sem }()
        data, _ := os.ReadFile(path)
        process(data)
    }(path)
}
wg.Wait()
```

16 concurrent reads (good for SSD; for HDD, lower).

But: `process` may be the bottleneck. Profile.

---

## Exercise 11 — Hedging when downstream is at capacity

**Baseline.** Service hedges every request to a busy downstream:

```go
go fetchA(req)
time.Sleep(20 * time.Millisecond)
go fetchB(req)
```

Downstream sees ~1.8x traffic. It is already at 90% capacity. Hedging pushes it to 100%+ → queues build up → latency rises everywhere.

**Goal.** Conditional hedging.

**Solution.** Only hedge when:

- The first request has not responded in some time.
- Downstream is not already overloaded.
- The request is read-only.

```go
if downstreamLoad < 0.7 && req.IsRead() {
    // hedge
}
```

Or use a feedback-loop circuit breaker that disables hedging under load.

---

## Exercise 12 — Premature async

**Baseline.**

```go
type Result struct {
    out chan int
}

func compute(req Request) *Result {
    r := &Result{out: make(chan int, 1)}
    go func() {
        r.out <- doWork(req)
    }()
    return r
}

// Caller:
v := <-result.out
```

The caller waits anyway. Channel + goroutine is pure overhead.

**Goal.** Remove async.

**Solution.**

```go
func compute(req Request) int {
    return doWork(req)
}

v := compute(req)
```

If you ever need to add async for a real reason (parallel sub-operations, timeout enforcement), add it then.

---

## Exercise 13 — Worker pool that hides errors

**Baseline.**

```go
for i := 0; i < workers; i++ {
    go func() {
        for j := range jobs {
            err := process(j)
            if err != nil {
                log.Println(err) // logged, then forgotten
            }
        }
    }()
}
```

**Goal.** Propagate errors.

**Solution.** Use `errgroup`:

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(workers)
for j := range jobs {
    j := j
    g.Go(func() error {
        return process(ctx, j)
    })
}
if err := g.Wait(); err != nil {
    return err
}
```

First error cancels the rest.

---

## Exercise 14 — Locking too broadly

**Baseline.**

```go
type Cache struct {
    mu sync.Mutex
    data map[string][]Item
}

func (c *Cache) Search(query string) []Item {
    c.mu.Lock()
    defer c.mu.Unlock()
    // ... search ...
    return matching
}
```

A long search holds the lock; other readers wait.

**Goal.** Reduce critical section.

**Solution.**

```go
func (c *Cache) Search(query string) []Item {
    c.mu.RLock()
    snapshot := c.data // snapshot the map reference
    c.mu.RUnlock()
    // search on snapshot — no lock needed (assuming no mutation)
    return search(snapshot, query)
}
```

Lock only long enough to capture a snapshot. Or use `atomic.Pointer[map]`.

---

## Exercise 15 — Sequential where parallel saves seconds

**Baseline.**

```go
func loadProfile(userID string) Profile {
    user := loadUser(userID)        // 50 ms
    prefs := loadPrefs(userID)      // 50 ms
    history := loadHistory(userID)  // 50 ms
    return assemble(user, prefs, history)
}
```

Total: 150 ms.

**Goal.** Parallelise.

**Solution.**

```go
func loadProfile(ctx context.Context, userID string) (Profile, error) {
    var (
        user    User
        prefs   Prefs
        history History
    )
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error {
        var err error
        user, err = loadUser(ctx, userID)
        return err
    })
    g.Go(func() error {
        var err error
        prefs, err = loadPrefs(ctx, userID)
        return err
    })
    g.Go(func() error {
        var err error
        history, err = loadHistory(ctx, userID)
        return err
    })
    if err := g.Wait(); err != nil {
        return Profile{}, err
    }
    return assemble(user, prefs, history), nil
}
```

Total: ~50 ms (max, not sum). 3x speedup.

This is concurrency *done right* — measurable benefit, structured, with proper error propagation.

---

## Closing

Optimisation in this space is often about *removing* unnecessary concurrency. Patterns to recognise:

1. **Trivial work in goroutines.** Just iterate.
2. **Concurrency serialised by a single lock.** Restructure or remove.
3. **Async APIs callers wait for synchronously.** Just call.
4. **Sub-spawning inside framework goroutines.** Use a managed worker pool.
5. **Unbounded goroutine creation.** Always bound.
6. **CPU pool sized for I/O work.** Match to actual workload.
7. **Hedging on overloaded downstream.** Conditional.
8. **Concurrent search where tiered is better.** Try cheap first.

Concurrency-done-right patterns:

1. **Parallel I/O via `errgroup`.** Genuine speedup.
2. **CPU split into NumCPU goroutines.** Parallelism on multi-core.
3. **Worker pool for unbounded input bounded by downstream.**
4. **`singleflight` for deduping concurrent requests.**
5. **Atomics for hot counters; sharding for very hot counters.**

The discipline: every `go` statement justifies itself. Measure before and after. Default to sequential. Remove concurrency that does not pay.
