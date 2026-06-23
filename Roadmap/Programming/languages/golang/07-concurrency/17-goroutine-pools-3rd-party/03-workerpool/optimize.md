---
layout: default
title: Optimize
parent: workerpool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/03-workerpool/optimize/
---

# gammazero/workerpool — Optimization Scenarios

Ten optimization scenarios with before/after code. Each scenario presents a slow or wasteful piece of pool code and shows how to improve it.

These optimizations apply broadly to concurrent Go code, not just to `workerpool`. The patterns transfer to other pool libraries and hand-rolled solutions.

---

## Scenario 1: Eliminate Per-Task Channel Sends via Chunking

### Before

```go
pool := workerpool.New(4)
defer pool.StopWait()

var sum int64
for i := 0; i < 1_000_000; i++ {
    i := i
    pool.Submit(func() {
        atomic.AddInt64(&sum, int64(i))
    })
}
```

**Problem:** 1 million `Submit` calls, each ~200 ns. Total submit overhead: 200 ms. Per-task work is trivial (atomic increment), so submit overhead dominates.

### After

```go
pool := workerpool.New(4)
defer pool.StopWait()

const chunkSize = 10000
var sum int64
for start := 0; start < 1_000_000; start += chunkSize {
    start := start
    end := start + chunkSize
    if end > 1_000_000 {
        end = 1_000_000
    }
    pool.Submit(func() {
        local := int64(0)
        for i := start; i < end; i++ {
            local += int64(i)
        }
        atomic.AddInt64(&sum, local)
    })
}
```

**Improvement:** 100 `Submit` calls instead of 1M. Submit overhead drops from 200 ms to 0.02 ms. Atomic contention also reduced — one add per chunk instead of one per item.

**Speedup:** Often 5-10x for trivial per-item work.

**Trade-off:** Less granular parallelism. If chunks are very uneven in cost, load balancing suffers.

---

## Scenario 2: Replace Unbounded Queue with Semaphore

### Before

```go
pool := workerpool.New(50)
defer pool.StopWait()

for record := range stream { // unbounded stream
    record := record
    pool.Submit(func() {
        process(record)
    })
}
```

**Problem:** If `stream` produces faster than workers consume, the pool's internal queue grows without bound. Memory eventually exhausts.

### After

```go
pool := workerpool.New(50)
defer pool.StopWait()

sem := make(chan struct{}, 500) // queue cap 500

for record := range stream {
    sem <- struct{}{} // backpressure
    record := record
    pool.Submit(func() {
        defer func() { <-sem }()
        process(record)
    })
}
```

**Improvement:** Memory usage is bounded by 500 + workers' worth of records, instead of unbounded. Producer naturally slows down when full.

**Trade-off:** Producer blocks instead of buffering. Acceptable for streams; problematic for ad-hoc submissions where blocking is undesirable.

---

## Scenario 3: Batch Submissions to a Slow Downstream

### Before

```go
pool := workerpool.New(50)
defer pool.StopWait()

for _, evt := range events {
    evt := evt
    pool.Submit(func() {
        db.Insert(evt) // one DB call per event
    })
}
```

**Problem:** 10,000 events → 10,000 DB calls. Each DB round-trip is 10 ms. Total work: 10,000 × 10 ms = 100 seconds, divided by 50 workers = 2 seconds. Plus 10,000 connections worth of DB load.

### After

```go
pool := workerpool.New(10)
defer pool.StopWait()

const batchSize = 100
for i := 0; i < len(events); i += batchSize {
    end := i + batchSize
    if end > len(events) {
        end = len(events)
    }
    batch := events[i:end]
    pool.Submit(func() {
        db.InsertBatch(batch) // one DB call per 100 events
    })
}
```

**Improvement:** 10,000 events → 100 DB calls. Each batch is 50 ms (let's say). Total work: 100 × 50 ms = 5 seconds, divided by 10 workers = 0.5 seconds. DB load is 100x less.

**Speedup:** 4x time, 100x less DB load.

**Trade-off:** Batches mean larger latency for an individual event (it waits for the batch to fill). Tune `batchSize` to balance.

---

## Scenario 4: Avoid Closure Allocation per Task

### Before

```go
pool := workerpool.New(8)
defer pool.StopWait()

for i := 0; i < 1_000_000; i++ {
    i := i
    pool.Submit(func() {
        atomic.AddInt64(&counter, int64(i))
    })
}
```

**Problem:** Each `Submit` allocates a closure (16-32 bytes for this trivial case, but it's allocation pressure on GC). 1M allocations is real GC work.

### After

```go
// Use ants.PoolWithFunc to avoid closure allocations
pool, _ := ants.NewPoolWithFunc(8, func(arg interface{}) {
    atomic.AddInt64(&counter, int64(arg.(int)))
})
defer pool.Release()

for i := 0; i < 1_000_000; i++ {
    _ = pool.Invoke(i) // no closure allocation
}
```

**Improvement:** Zero closure allocations. The function is bound once at pool creation; each `Invoke` just sends the argument.

**Speedup:** ~30% on micro-benchmarks. Real-world: usually negligible unless allocation is profiled to be hot.

**Trade-off:** Different API (ants vs workerpool), and the `interface{}` boxing has its own cost.

---

## Scenario 5: Reduce Mutex Contention with Sharded State

### Before

```go
pool := workerpool.New(32)
defer pool.StopWait()

var mu sync.Mutex
counts := make(map[string]int)

for _, word := range words {
    word := word
    pool.Submit(func() {
        mu.Lock()
        counts[word]++
        mu.Unlock()
    })
}
```

**Problem:** All 32 workers contend on the single mutex. The pool's effective parallelism is limited by mutex lock duration.

### After

```go
const shards = 32
var muShards [shards]sync.Mutex
var countShards [shards]map[string]int
for i := range countShards {
    countShards[i] = make(map[string]int)
}

shard := func(word string) int {
    h := fnv.New32a()
    _, _ = h.Write([]byte(word))
    return int(h.Sum32()) % shards
}

pool := workerpool.New(32)
defer pool.StopWait()

for _, word := range words {
    word := word
    pool.Submit(func() {
        s := shard(word)
        muShards[s].Lock()
        countShards[s][word]++
        muShards[s].Unlock()
    })
}
```

**Improvement:** Lock contention divided by `shards`. With 32 shards and 32 workers, ideal case is one worker per shard, near-zero contention.

**Speedup:** 5-20x for write-heavy workloads.

**Trade-off:** Aggregating results requires iterating all shards. Memory usage grows ~linearly with shards.

---

## Scenario 6: Cache HTTP Connections via Reuse

### Before

```go
pool := workerpool.New(50)
defer pool.StopWait()

for _, url := range urls {
    url := url
    pool.Submit(func() {
        resp, _ := http.Get(url) // new client each time
        if resp != nil {
            resp.Body.Close()
        }
    })
}
```

**Problem:** `http.Get` uses `DefaultClient` which has connection pooling, but with 50 simultaneous requests to different hosts, each connection is short-lived.

### After

```go
client := &http.Client{
    Timeout: 30 * time.Second,
    Transport: &http.Transport{
        MaxIdleConns:        100,
        MaxIdleConnsPerHost: 20,
        IdleConnTimeout:     90 * time.Second,
    },
}

pool := workerpool.New(50)
defer pool.StopWait()

for _, url := range urls {
    url := url
    pool.Submit(func() {
        req, _ := http.NewRequest("GET", url, nil)
        resp, _ := client.Do(req)
        if resp != nil {
            io.Copy(io.Discard, resp.Body) // important: drain for reuse
            resp.Body.Close()
        }
    })
}
```

**Improvement:** Persistent connections reduce TCP+TLS handshake cost. 20 connections per host can serve many requests.

**Speedup:** 2-10x for repeated hits to the same hosts.

**Trade-off:** More configuration. Slightly more memory for the connection pool.

**Critical:** *Always drain `resp.Body` before closing*, or the connection cannot be reused.

---

## Scenario 7: Avoid Synchronous SubmitWait in Loops

### Before

```go
pool := workerpool.New(8)
defer pool.StopWait()

for _, item := range items {
    item := item
    pool.SubmitWait(func() { // serializes everything
        process(item)
    })
}
```

**Problem:** `SubmitWait` blocks until each task completes. The loop runs at the pace of the slowest worker. Effective parallelism: 1.

### After

```go
pool := workerpool.New(8)

var wg sync.WaitGroup
for _, item := range items {
    item := item
    wg.Add(1)
    pool.Submit(func() {
        defer wg.Done()
        process(item)
    })
}
wg.Wait()
pool.StopWait()
```

**Improvement:** Submission is fast (microseconds); workers run in parallel up to `maxWorkers`. `wg.Wait` waits for completion.

**Speedup:** Up to `maxWorkers` x speedup. With 8 workers, 8x.

**Trade-off:** Slightly more code. Need to manage `WaitGroup`.

---

## Scenario 8: Drop Excess Work Instead of Buffering

### Before

```go
pool := workerpool.New(10)
defer pool.StopWait()

for event := range firehose { // unbounded stream
    event := event
    pool.Submit(func() {
        slowProcess(event) // 500ms each
    })
}
```

**Problem:** Firehose produces 1000 events/sec. Pool processes 20 events/sec (10 workers × 2 per second). Queue grows ~980 per second. Memory exhaustion in minutes.

### After

```go
pool := workerpool.New(10)
defer pool.StopWait()

const queueCap = 100
sem := make(chan struct{}, queueCap)
var dropped int64

for event := range firehose {
    select {
    case sem <- struct{}{}:
        event := event
        pool.Submit(func() {
            defer func() { <-sem }()
            slowProcess(event)
        })
    default:
        atomic.AddInt64(&dropped, 1)
    }
}
log.Printf("dropped %d events", atomic.LoadInt64(&dropped))
```

**Improvement:** Memory bounded at `queueCap + workers`. Excess events dropped (and counted). System remains stable.

**Trade-off:** Lost data. Acceptable for some workloads (metrics, logs); not for others (financial transactions).

---

## Scenario 9: Reuse Buffers via sync.Pool

### Before

```go
pool := workerpool.New(16)
defer pool.StopWait()

for _, req := range requests {
    req := req
    pool.Submit(func() {
        buf := make([]byte, 64*1024) // 64 KB allocation per task
        n, _ := req.Read(buf)
        process(buf[:n])
    })
}
```

**Problem:** Each task allocates 64 KB. With 1000 tasks/sec, that's 64 MB/sec of allocation. GC pressure.

### After

```go
var bufPool = sync.Pool{
    New: func() interface{} {
        buf := make([]byte, 64*1024)
        return &buf
    },
}

pool := workerpool.New(16)
defer pool.StopWait()

for _, req := range requests {
    req := req
    pool.Submit(func() {
        bufPtr := bufPool.Get().(*[]byte)
        defer bufPool.Put(bufPtr)
        buf := *bufPtr
        n, _ := req.Read(buf)
        process(buf[:n])
    })
}
```

**Improvement:** Allocations dropped from 1000/sec to near zero (steady state, after `bufPool` warms up). GC pressure reduced significantly.

**Speedup:** Depends on GC pressure; can be 20-50% for allocation-heavy workloads.

**Trade-off:** More complex code. `sync.Pool` does not guarantee reuse (GC can clear it). Use only when allocation is measured to be a bottleneck.

---

## Scenario 10: Replace Pool with errgroup.SetLimit

### Before

```go
pool := workerpool.New(8)
var wg sync.WaitGroup
var mu sync.Mutex
var errs []error

for _, item := range items {
    item := item
    wg.Add(1)
    pool.Submit(func() {
        defer wg.Done()
        if err := process(item); err != nil {
            mu.Lock()
            errs = append(errs, err)
            mu.Unlock()
        }
    })
}
wg.Wait()
pool.StopWait()
err := errors.Join(errs...)
```

**Problem:** Lots of moving parts: pool + waitgroup + mutex + error slice. For a one-shot batch, this is over-engineered.

### After

```go
g, ctx := errgroup.WithContext(context.Background())
g.SetLimit(8)
for _, item := range items {
    item := item
    g.Go(func() error {
        if err := ctx.Err(); err != nil {
            return err
        }
        return process(item)
    })
}
err := g.Wait()
```

**Improvement:** Half the code. Built-in error propagation and context cancellation. No external `workerpool` dependency.

**Trade-off:** No long-lived pool reuse. For a long-running service with many batches, `workerpool` may still be appropriate.

---

## Summary

Ten optimization scenarios:

1. **Chunk submissions** to reduce per-task overhead.
2. **Bound the queue** with a semaphore to prevent OOM.
3. **Batch downstream calls** to reduce round-trip cost.
4. **Eliminate closure allocations** with `ants.PoolWithFunc`.
5. **Shard shared state** to reduce mutex contention.
6. **Reuse HTTP connections** for repeated host calls.
7. **Avoid SubmitWait in loops** for parallelism.
8. **Drop excess work** when overload is acceptable.
9. **Reuse buffers via sync.Pool** to reduce GC pressure.
10. **Use errgroup.SetLimit** for one-shot batches.

Each optimization has trade-offs. Apply only when measurement shows a need.

---

## A General Optimization Methodology

1. **Measure baseline.** Benchmark or profile. Know where time goes.
2. **Identify the bottleneck.** Is it submit overhead? Worker contention? Downstream latency? GC?
3. **Hypothesise an improvement.** Based on the bottleneck.
4. **Apply and measure.** Compare to baseline. Did it help?
5. **Document.** Why the optimization, why now, what the trade-off was.

Premature optimization is the root of much evil. Optimize what's slow, not what might be slow.

---

## When to NOT Optimize

- Per-task work is large compared to overhead.
- Throughput requirements are well within current capacity.
- Code is being deprecated.
- Optimization adds complexity without measurable gain.
- The "before" code is already understandable and correct.

If your service is comfortably hitting its SLA, optimization is busywork. Spend that energy on features or refactoring.

---

## Profiling Workflow

To find bottlenecks systematically:

```bash
# CPU profile
go test -cpuprofile cpu.prof -bench .
go tool pprof -http :8080 cpu.prof

# Memory profile
go test -memprofile mem.prof -bench .
go tool pprof -http :8080 mem.prof

# Goroutine profile (production)
curl http://localhost:6060/debug/pprof/goroutine -o g.prof
go tool pprof -http :8080 g.prof
```

In `pprof`, the flame graph view shows where time/memory goes. The "top" view lists hottest functions. Use these to guide optimization.

---

## A Final Word

`workerpool` is fast enough for most workloads. The "before" examples in this file are not bad code per se; they are starting points for optimization when measurement justifies it.

Always measure first. Always document the optimization. Always consider whether the trade-off is worth it.

Good optimization is invisible: the code is fast, but no one notices. Bad optimization is loud: complex code with unclear benefit. Aim for invisible.

End of optimization scenarios.
