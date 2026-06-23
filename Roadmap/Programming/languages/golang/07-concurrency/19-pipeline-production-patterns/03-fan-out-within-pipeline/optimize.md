---
layout: default
title: Optimize
parent: Fan-Out Within Pipeline
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/03-fan-out-within-pipeline/optimize/
---

# Fan-Out Within a Pipeline Stage — Optimize

A series of optimisation exercises. Each starts with a snippet that "works" but is slow or wasteful. Identify the inefficiency, propose a change, and predict the speedup or resource reduction.

## Exercise 1: Per-item allocation in the worker

```go
func hashWorker(in <-chan []byte, out chan<- string) {
    for data := range in {
        h := sha256.New()
        h.Write(data)
        sum := h.Sum(nil)
        out <- hex.EncodeToString(sum)
    }
}
```

**Issue:** A new `sha256.New()` is allocated per item. The encoding allocates a fresh string per item.

**Optimisation:** Reuse the hasher per worker. Reuse a per-worker buffer.

```go
func hashWorker(in <-chan []byte, out chan<- string) {
    h := sha256.New()
    buf := make([]byte, 0, hex.EncodedLen(sha256.Size))
    for data := range in {
        h.Reset()
        h.Write(data)
        sum := h.Sum(nil)
        buf = buf[:0]
        buf = hex.AppendEncode(buf, sum)
        out <- string(buf) // unavoidable allocation of one string
    }
}
```

**Expected impact:** Allocation rate drops; GC pause reduces. Throughput rises 10-30% under high QPS.

## Exercise 2: Hard-coded N

```go
func process(in <-chan Job) <-chan Result {
    const n = 4
    ...
}
```

**Issue:** N is a magic constant. Wrong default for any non-laptop machine; impossible to tune in production.

**Optimisation:** Take N as a parameter or read from config.

```go
func process(in <-chan Job, n int) <-chan Result { ... }
```

**Expected impact:** Per-machine tuning possible. On a 32-core production server, N = 32 vs 4 is an 8x throughput improvement on CPU-bound work.

## Exercise 3: Channel send for every metric

```go
type Metric struct { Worker int; Latency time.Duration }

metrics := make(chan Metric, 1000)
for i := 0; i < n; i++ {
    go func(id int) {
        for j := range in {
            start := time.Now()
            r := process(j)
            metrics <- Metric{Worker: id, Latency: time.Since(start)}
            out <- r
        }
    }(i)
}
go func() {
    for m := range metrics {
        // expensive metric backend write
        backend.Record(m)
    }
}()
```

**Issue:** Every item produces a channel send for metrics. Channel ops add latency; backend.Record is expensive.

**Optimisation:** Aggregate per worker, flush periodically.

```go
type Stats struct {
    Count int64
    Latency int64 // ns
    _ [48]byte    // pad
}
stats := make([]Stats, n)
for i := 0; i < n; i++ {
    go func(id int) {
        s := &stats[id]
        for j := range in {
            start := time.Now()
            r := process(j)
            atomic.AddInt64(&s.Count, 1)
            atomic.AddInt64(&s.Latency, time.Since(start).Nanoseconds())
            out <- r
        }
    }(i)
}
go func() {
    ticker := time.NewTicker(1 * time.Second)
    defer ticker.Stop()
    for range ticker.C {
        for i := range stats {
            count := atomic.SwapInt64(&stats[i].Count, 0)
            latency := atomic.SwapInt64(&stats[i].Latency, 0)
            backend.Aggregate(i, count, latency)
        }
    }
}()
```

**Expected impact:** Per-item overhead drops from microseconds to nanoseconds. Throughput rises 20-50% for fast workers.

## Exercise 4: Unbounded reorder buffer

```go
func reorder(in <-chan Tagged[int]) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        next := int64(0)
        pending := make(map[int64]int)
        for t := range in {
            pending[t.Seq] = t.Val
            for {
                v, ok := pending[next]
                if !ok { break }
                out <- v
                delete(pending, next)
                next++
            }
        }
    }()
    return out
}
```

**Issue:** If one worker is much slower than peers, the reorder buffer can grow to hold many items. Memory blows up.

**Optimisation:** Bound in-flight by buffering the input channel:

```go
in := make(chan Tagged[int], n) // at most N items in flight
```

Now the reorder buffer holds at most N items. Memory is bounded.

**Expected impact:** Predictable memory footprint. Slower workers cause backpressure, not memory growth.

## Exercise 5: Worker with synchronous RPC and no connection reuse

```go
func worker(in <-chan Req, out chan<- Resp) {
    for r := range in {
        client := &http.Client{}      // BUG: fresh client per item
        resp, _ := client.Do(r.HTTP)
        ...
        out <- Resp{...}
    }
}
```

**Issue:** A fresh client per item means a fresh transport, no connection reuse, fresh DNS lookups, fresh TLS handshakes. Per-item overhead is huge.

**Optimisation:** Share one client per worker (or across workers):

```go
client := &http.Client{
    Transport: &http.Transport{
        MaxIdleConnsPerHost: 32,
        IdleConnTimeout:     90 * time.Second,
    },
}
for i := 0; i < n; i++ {
    go func() {
        for r := range in {
            resp, _ := client.Do(r.HTTP)
            ...
            out <- Resp{...}
        }
    }()
}
```

**Expected impact:** Per-item latency drops from 50ms to 5ms (eliminating handshake). Throughput per worker rises 10x.

## Exercise 6: GOMAXPROCS mismatch in containers

```go
// no automaxprocs, default GOMAXPROCS = host cores
```

**Issue:** In Kubernetes with CPU limit 2, the host may have 64 cores. GOMAXPROCS defaults to 64. The runtime over-allocates Ps; CPU throttling causes severe latency spikes.

**Optimisation:** Use `automaxprocs`:

```go
import _ "go.uber.org/automaxprocs"
```

Or set explicitly:

```go
runtime.GOMAXPROCS(2)
```

**Expected impact:** No more CFS throttling spikes. p99 latency drops dramatically. Throughput stabilises.

## Exercise 7: GC pressure from large per-item objects

```go
type Item struct {
    Body []byte // up to 5 MB
}

for j := range in {
    cp := make([]byte, len(j.Body))
    copy(cp, j.Body)
    process(cp)
}
```

**Issue:** A 5 MB copy per item. With 1000 items/s, that is 5 GB/s of allocation. GC works overtime.

**Optimisation:** Pool the buffers:

```go
var pool = sync.Pool{New: func() any { return make([]byte, 0, 5<<20) }}

for j := range in {
    buf := pool.Get().([]byte)[:0]
    buf = append(buf, j.Body...)
    process(buf)
    pool.Put(buf)
}
```

**Expected impact:** Allocation rate drops drastically. GC pause time drops. Heap usage stabilises.

## Exercise 8: Channel contention at high QPS

Pprof shows `runtime.chansend` and `runtime.chanrecv` at 30% of CPU.

**Issue:** A single channel with millions of ops/second is contended on its mutex.

**Optimisation:** Batch items per send. Send a slice of 100 items instead of one item per send.

```go
type Batch struct { Items []Item }

// producer
batch := make([]Item, 0, 100)
for j := range raw {
    batch = append(batch, j)
    if len(batch) == 100 {
        out <- Batch{Items: batch}
        batch = make([]Item, 0, 100)
    }
}
if len(batch) > 0 {
    out <- Batch{Items: batch}
}
```

The worker loops within each batch. Channel ops are 100x fewer.

**Expected impact:** Channel contention drops to a few percent. Total throughput rises 2-3x at high QPS.

## Exercise 9: Lock inside a worker

```go
var mu sync.Mutex
var seen = make(map[string]bool)

for j := range in {
    mu.Lock()
    if seen[j.ID] {
        mu.Unlock()
        continue
    }
    seen[j.ID] = true
    mu.Unlock()
    process(j)
}
```

**Issue:** All workers serialise on `mu`. The fan-out is functionally serial.

**Optimisation:** Shard the map by hash of `j.ID`. Each shard has its own mutex.

```go
const shards = 32
type Shard struct {
    mu sync.Mutex
    m  map[string]bool
}
var sh [shards]Shard
func init() {
    for i := range sh {
        sh[i].m = make(map[string]bool)
    }
}

func bucket(id string) *Shard {
    h := fnv.New32a()
    h.Write([]byte(id))
    return &sh[h.Sum32()%shards]
}

for j := range in {
    s := bucket(j.ID)
    s.mu.Lock()
    seen := s.m[j.ID]
    s.m[j.ID] = true
    s.mu.Unlock()
    if seen { continue }
    process(j)
}
```

Or use `sync.Map` for read-mostly workloads. Or per-worker maps merged at the end. The right answer depends on access patterns.

**Expected impact:** Lock contention drops by `shards`x. Worker parallelism is real, not synthetic.

## Exercise 10: Worker reads context.Value on every item

```go
for j := range in {
    user := ctx.Value(userKey).(*User) // BUG: type assertion + map lookup per item
    process(user, j)
}
```

**Issue:** `ctx.Value` is a linked-list traversal; `type assertion` adds overhead. On a hot path, this is measurable.

**Optimisation:** Read once before the loop:

```go
user := ctx.Value(userKey).(*User)
for j := range in {
    process(user, j)
}
```

**Expected impact:** Saves 10-50ns per item. Significant at high throughput.

## Exercise 11: time.Now() in hot path

```go
for j := range in {
    j.Received = time.Now()
    process(j)
}
```

**Issue:** `time.Now` is a syscall on some platforms; even where it is not, it has measurable overhead. Calling it per item in a microsecond-scale worker dominates.

**Optimisation:** If timestamp precision is not critical, sample every N items, or use a monotonic counter updated by a background goroutine.

```go
var nowNs int64
go func() {
    ticker := time.NewTicker(1 * time.Millisecond)
    for t := range ticker.C {
        atomic.StoreInt64(&nowNs, t.UnixNano())
    }
}()
// in worker:
j.ReceivedNs = atomic.LoadInt64(&nowNs)
```

**Expected impact:** Per-item overhead drops to a single atomic load. Throughput rises measurably on microsecond workers.

## Exercise 12: Logging inside the worker

```go
for j := range in {
    log.Printf("processing %d", j.ID)
    process(j)
    log.Printf("done %d", j.ID)
}
```

**Issue:** Two log lines per item. `log.Printf` allocates, formats, holds a mutex. For high QPS, log writing is the bottleneck.

**Optimisation:** Reduce logging to per-batch or sample-based:

```go
for j := range in {
    if j.ID%1000 == 0 {
        log.Printf("processed up to %d", j.ID)
    }
    process(j)
}
```

Or use a structured logger with leveled output:

```go
slog.Debug("processed", "id", j.ID) // disabled by default at INFO level
```

**Expected impact:** Log volume drops 1000x. Worker throughput rises 5-50x if log was the bottleneck.

## Exercise 13: Per-tenant pool grown unboundedly

```go
type Pool struct { workers []chan Job }
var pools sync.Map

func submit(tenant string, j Job) {
    p, ok := pools.Load(tenant)
    if !ok {
        // spawn new pool with 8 workers
        ...
        pools.Store(tenant, newPool(8))
    }
    p.(*Pool).workers[hash(j) % 8] <- j
}
```

**Issue:** Tenants accumulate forever. After months, you have 100k tenant pools each with 8 idle workers = 800k goroutines.

**Optimisation:** LRU eviction or idle-timeout per pool. After 5 minutes of no activity, shut down the pool.

```go
type Pool struct {
    workers []chan Job
    lastUsed atomic.Int64
}

// reaper goroutine
for {
    time.Sleep(1 * time.Minute)
    now := time.Now().Unix()
    pools.Range(func(k, v any) bool {
        p := v.(*Pool)
        if now-p.lastUsed.Load() > 300 {
            p.shutdown()
            pools.Delete(k)
        }
        return true
    })
}
```

**Expected impact:** Goroutine count stable instead of growing. Memory bounded.

## Exercise 14: Per-worker slow startup

```go
for i := 0; i < n; i++ {
    go func() {
        client, _ := initClient() // 500 ms each
        for j := range in { ... }
    }()
}
```

**Issue:** All workers start serially because Go scheduler runs them as they get CPU time. Each `initClient` takes 500 ms. For N=8, total warm-up is 4 seconds.

**Optimisation:** Initialise once, share, or parallelise startup:

```go
client, _ := initClient()
for i := 0; i < n; i++ {
    go func() {
        for j := range in { ... }
    }()
}
```

Or if per-worker init is required, run them in parallel:

```go
clients := make([]*Client, n)
var initWg sync.WaitGroup
for i := 0; i < n; i++ {
    i := i
    initWg.Add(1)
    go func() {
        defer initWg.Done()
        clients[i], _ = initClient()
    }()
}
initWg.Wait()
for i := 0; i < n; i++ { ... }
```

**Expected impact:** Startup time drops from 4 s to 500 ms.

## Exercise 15: Goroutine spawned per item

```go
for j := range in {
    j := j
    go func() {
        result := process(j)
        results <- result
    }()
}
```

**Issue:** Each item spawns a goroutine. Goroutines are cheap but not free — and there is no concurrency cap. Under high QPS, you spawn millions of goroutines and OOM.

**Optimisation:** Use a fixed-size worker pool (the standard fan-out template) instead.

**Expected impact:** Bounded goroutine count. Predictable memory. Better cache behaviour.

---

## Cheat Sheet: First Things to Check

1. Is N a configuration parameter or a constant?
2. Are per-worker resources (HTTP clients, hashers, buffers) allocated outside the loop?
3. Is the channel buffer modest (N to 2N)?
4. Is GOMAXPROCS correct for the environment (containers!)?
5. Are atomics used instead of mutexes for simple counters?
6. Is cache-line padding applied to per-worker stats?
7. Are timestamps and metrics sampled, not per-item?
8. Are logs minimal in the hot path?
9. Is the worker context-aware so cancellation is honored?
10. Are spawn rates bounded — no per-item goroutines?

These ten questions catch the bulk of fan-out performance issues in real code.
