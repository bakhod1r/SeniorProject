---
layout: default
title: Optimize
parent: Concurrent Counters
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/06-concurrent-counters/optimize/
---

# Concurrent Counters — Optimization Exercises

Each exercise presents a slow counter implementation. Your job: identify the bottleneck, fix it, and verify the improvement with benchmarks.

---

## Exercise 1: The mutex bottleneck

```go
type Counter struct {
    mu sync.Mutex
    v  int64
}

func (c *Counter) Inc()       { c.mu.Lock(); c.v++; c.mu.Unlock() }
func (c *Counter) Get() int64 { c.mu.Lock(); defer c.mu.Unlock(); return c.v }
```

Benchmark: at 16 cores, ~5M ops/sec.

**Optimization**: Replace mutex with `atomic.Int64`. Benchmark: ~15M ops/sec uncontended; ~3M at 16 cores (still cache contention but no mutex overhead).

```go
type Counter struct { v atomic.Int64 }

func (c *Counter) Inc()       { c.v.Add(1) }
func (c *Counter) Get() int64 { return c.v.Load() }
```

**Verification**: Run `go test -bench=. -cpu=1,16`. Mutex version ~50 ns/op uncontended, ~5 µs at 16 cores. Atomic version ~5 ns/op uncontended, ~300 ns at 16 cores. 10-15× speedup.

---

## Exercise 2: The single-atomic bottleneck

```go
type Counter struct { v atomic.Int64 }
```

At 16 cores, throughput plateaus at ~50M ops/sec total (~3M per core; per-core throughput falls as cores rise).

**Optimization**: Shard into N cells.

```go
type Sharded struct { cells [64]atomic.Int64 }

func (s *Sharded) Inc() { s.cells[rand.IntN(64)].Add(1) }

func (s *Sharded) Get() int64 {
    var t int64
    for i := range s.cells {
        t += s.cells[i].Load()
    }
    return t
}
```

Benchmark: ~500M ops/sec at 16 cores. 10× improvement.

**But**: the sharded counter still has false sharing. See Exercise 3.

---

## Exercise 3: False sharing

```go
type Sharded struct { cells [64]atomic.Int64 } // 8 atomics per cache line
```

At 16 cores, throughput is ~500M ops/sec. Expected (with true linear scaling): ~3B ops/sec.

**Optimization**: Cache-line pad each cell.

```go
import "golang.org/x/sys/cpu"

type cell struct {
    _ cpu.CacheLinePad
    v atomic.Int64
    _ cpu.CacheLinePad
}

type Sharded struct { cells [64]cell }
```

Benchmark: ~2.5B ops/sec at 16 cores. 5× additional improvement.

**Verification**: Use `unsafe.Offsetof` to verify cells are at >= 64-byte intervals.

---

## Exercise 4: Per-P sharding

```go
type Sharded struct { cells [64]cell }

func (s *Sharded) Inc() { s.cells[rand.Uint32()&63].v.Add(1) }
```

At 64 cores, throughput is ~3B ops/sec (limited by cache traffic between distant cores via random shard selection).

**Optimization**: Per-P shards via `runtime_procPin`.

```go
//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

type PerP struct { cells []cell }

func New() *PerP { return &PerP{cells: make([]cell, runtime.GOMAXPROCS(0))} }

func (p *PerP) Inc() {
    pid := runtime_procPin()
    p.cells[pid].v.Add(1)
    runtime_procUnpin()
}
```

Benchmark: ~6B+ ops/sec at 64 cores. 2× additional improvement, scales linearly.

---

## Exercise 5: Sloppy for ultra-high throughput

Per-P scaled well but still costs ~10 ns per increment (atomic op + procPin overhead).

**Optimization**: Sloppy counter with per-goroutine local + periodic flush.

```go
type Sloppy struct { global atomic.Int64 }

type Local struct {
    n       int64
    flushAt int64
    parent  *Sloppy
}

func (l *Local) Inc() {
    l.n++
    if l.n >= l.flushAt {
        l.parent.global.Add(l.n)
        l.n = 0
    }
}

func (l *Local) Flush() {
    if l.n > 0 {
        l.parent.global.Add(l.n)
        l.n = 0
    }
}
```

Benchmark: ~30B ops/sec at 64 cores. 5× additional improvement. Each Inc is one local increment; the global atomic Add happens once per `flushAt` ops.

Cost: staleness up to `flushAt * goroutines`. For metrics, acceptable.

---

## Exercise 6: Hot loop calling `Get`

```go
for i := 0; i < 1_000_000; i++ {
    if counter.Get() > limit { ... }
    counter.Inc()
}
```

`counter.Get()` is called every iteration. For a sharded counter, that's O(shards) per call.

**Optimization**: Cache locally; refresh periodically.

```go
cached := counter.Get()
for i := 0; i < 1_000_000; i++ {
    if i % 1000 == 0 {
        cached = counter.Get()
    }
    if cached > limit { ... }
    counter.Inc()
}
```

The "limit check" is now approximate (lags by up to 1000 iterations) but vastly cheaper.

---

## Exercise 7: Histogram observation in tight loop

```go
for i := 0; i < 1_000_000; i++ {
    start := time.Now()
    work()
    hist.Observe(time.Since(start))
}
```

`hist.Observe` is ~50-100 ns per call. At 1M iterations, that's 50-100 ms just on histogram recording.

**Optimization 1**: Sample observations.

```go
for i := 0; i < 1_000_000; i++ {
    start := time.Now()
    work()
    if i % 100 == 0 {
        hist.Observe(time.Since(start))
    }
}
```

100× less histogram overhead; statistically similar percentiles for large samples.

**Optimization 2**: Use a lock-free histogram (sharded HDR).

```go
hist := NewShardedHDR(64) // shards with per-shard mutex
hist.Observe(time.Since(start)) // ~30 ns instead of 100 ns
```

---

## Exercise 8: Reset that races

```go
func (s *Sharded) Reset() int64 {
    total := s.Get()
    for i := range s.cells {
        s.cells[i].v.Store(0)
    }
    return total
}
```

Concurrent `Inc` between `Get` and the `Store` loop is lost.

**Optimization**: Use `Swap` per shard.

```go
func (s *Sharded) Reset() int64 {
    var total int64
    for i := range s.cells {
        total += s.cells[i].v.Swap(0)
    }
    return total
}
```

Atomic per-shard; concurrent increments are counted in either the reset total or the new accumulation, never lost.

---

## Exercise 9: Cardinality bomb

```go
var requests = expvar.NewMap("requests")

func handler(...) {
    requests.Add(userID, 1) // userID is unbounded
}
```

Memory grows linearly with the number of unique users. Eventually OOMs the process and the metric backend.

**Optimization 1**: Bound cardinality.

```go
func handler(...) {
    bucket := hash(userID) % 100 // 100 buckets
    requests.Add(fmt.Sprintf("bucket_%d", bucket), 1)
}
```

100 entries instead of millions. Loses per-user detail; gains stability.

**Optimization 2**: Use traces for per-user detail, metrics for aggregates.

---

## Exercise 10: Slow Prometheus exposition

```go
http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
    for _, c := range allCounters {
        fmt.Fprintf(w, "%s %d\n", c.name, c.Get()) // Get() is slow for sharded
    }
})
```

For 1000 sharded counters, each `Get()` is ~200 ns. Scrape takes 200 µs (acceptable). For 100K counters (multi-tenant), 20 ms — starts to matter.

**Optimization**: Periodic snapshot publisher.

```go
type CachedSharded struct {
    inner   *Sharded
    cached  atomic.Int64
}

func (c *CachedSharded) Run(interval time.Duration) {
    for range time.Tick(interval) {
        c.cached.Store(c.inner.Get())
    }
}

func (c *CachedSharded) FastGet() int64 { return c.cached.Load() }
```

Scrape reads cached values (~5 ns each). Staleness bounded by `interval`.

---

## Exercise 11: GC pressure from `LongAdder`-style allocation

```go
func (a *LongAdder) Add(n int64) {
    cellsPtr := a.cellsP.Load()
    if cellsPtr == nil {
        newCells := make([]Cell, 4) // alloc on every contended add!
        a.cellsP.CompareAndSwap(nil, &newCells)
    }
    ...
}
```

Under contention, many goroutines allocate cell arrays; only one wins the CAS; others are GC'd. GC pressure spikes.

**Optimization**: Use a mutex to serialize cell allocation; only one goroutine allocates.

```go
func (a *LongAdder) Add(n int64) {
    if a.cellsP.Load() == nil {
        a.mu.Lock()
        if a.cellsP.Load() == nil {
            newCells := make([]Cell, 4)
            a.cellsP.Store(&newCells)
        }
        a.mu.Unlock()
    }
    ...
}
```

Allocation happens once; no GC churn.

---

## Exercise 12: Counter exposed via `expvar.Func` that allocates

```go
expvar.Publish("status", expvar.Func(func() any {
    return map[string]int64{
        "requests": requests.Load(),
        "errors":   errors.Load(),
    }
})) // map allocated on every scrape
```

Each scrape allocates a map; GC pressure if scraped frequently.

**Optimization**: Use a cached struct.

```go
type Status struct {
    Requests int64 `json:"requests"`
    Errors   int64 `json:"errors"`
}
var cachedStatus atomic.Pointer[Status]

func init() {
    expvar.Publish("status", expvar.Func(func() any {
        return cachedStatus.Load()
    }))
    go refreshStatus()
}

func refreshStatus() {
    for range time.Tick(time.Second) {
        cachedStatus.Store(&Status{
            Requests: requests.Load(),
            Errors:   errors.Load(),
        })
    }
}
```

One alloc per second instead of one per scrape.

---

## Exercise 13: Mutex held across HDR record

```go
var (
    mu sync.Mutex
    h  = hdrhistogram.New(1, 60_000_000_000, 3)
)

func observe(d time.Duration) {
    mu.Lock()
    h.RecordValue(d.Nanoseconds())
    mu.Unlock()
}
```

At high concurrency, the global mutex serialises all observations.

**Optimization**: Sharded HDR.

```go
type ShardedHDR struct {
    shards []shard
}

type shard struct {
    _ cpu.CacheLinePad
    mu sync.Mutex
    h  *hdrhistogram.Histogram
    _ cpu.CacheLinePad
}
```

Per-shard mutex; contention reduced by `1/N`.

---

## Exercise 14: Counter naming overhead

```go
func handler(...) {
    counterName := fmt.Sprintf("requests_%s_%d", path, status)
    counters.Add(counterName, 1) // sprintf + map lookup on every request
}
```

`fmt.Sprintf` allocates; map lookup is hashing the string. Both per-request overhead.

**Optimization**: Pre-allocate per-route counter objects.

```go
type RouteStats struct {
    OK2xx atomic.Int64
    Err4xx atomic.Int64
    Err5xx atomic.Int64
}

var routes = map[string]*RouteStats{
    "/api/users": &RouteStats{},
    // ... pre-built
}

func handler(...) {
    s := routes[r.URL.Path]
    if r.Status < 300 {
        s.OK2xx.Add(1)
    } else if r.Status < 500 {
        s.Err4xx.Add(1)
    } else {
        s.Err5xx.Add(1)
    }
}
```

No allocation, no string formatting per request.

---

## Exercise 15: Cross-process counter aggregation cost

```go
// In each of 100 instances:
total := 0
for each instance: total += scrape(instance).requests
```

Scraping 100 instances takes 100 round-trips.

**Optimization**: Federated aggregation. Each region's Prometheus scrapes local instances and pre-aggregates; the global Prometheus scrapes only the region totals.

```
global -> region1 (pre-aggregated)
       -> region2 (pre-aggregated)
       ...
```

100 round-trips → 5 round-trips. Same data freshness; 20× less cost.

---

## Closing thoughts

Each optimization trades complexity for performance. Apply them only when measurement shows the bottleneck. Premature optimization is a real cost.

The ladder:

1. `atomic.Int64` (always start here)
2. Padded `atomic.Int64` (high contention)
3. Padded sharded (very high contention)
4. Per-P sharded (extreme contention, runtime cooperation OK)
5. Sloppy (extreme throughput, freshness OK)
6. Dynamic (LongAdder) (unpredictable contention)

Climb only when needed. Re-measure at each step.

End.
