---
layout: default
title: Decision Tree — Optimize
parent: Decision Tree
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/04-decision-tree/optimize/
---

# Decision Tree — Optimize

[← Back](../)

Choosing the right primitive is half of the optimization problem. The other half is choosing the right *shape* of that primitive: cache-line aligned, sharded, batched. The numbers below are from a 16-core x86-64 Linux box running Go 1.22; relative magnitudes are stable across machines, absolute numbers are not. Always rebenchmark on your own hardware.

## Counter benchmarks: atomic vs mutex vs channel vs sharded

```go
// Atomic counter
var aCount atomic.Int64
func BenchmarkAtomic(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() { aCount.Add(1) }
    })
}

// Mutex counter
var mu sync.Mutex
var mCount int64
func BenchmarkMutex(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.Lock(); mCount++; mu.Unlock()
        }
    })
}

// Channel counter (deltas sent to one goroutine)
var ch = make(chan int64, 1024)
// ... goroutine reads from ch and adds to a local int64 ...
func BenchmarkChannel(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() { ch <- 1 }
    })
}

// Sharded atomic, padded to cache line
const shards = 64
var sCount [shards]struct {
    v atomic.Int64
    _ [56]byte // pad: 8 (int64) + 56 = 64 byte cache line
}
func BenchmarkSharded(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() { sCount[shardID()].v.Add(1) }
    })
}
```

Representative results on 16 cores, GOMAXPROCS=16, 100M iterations:

| Primitive | ns/op | Allocations | Notes |
|---|---|---|---|
| atomic.Int64.Add | 18.4 | 0 | Single cache line bouncing between cores |
| sync.Mutex | 78.2 | 0 | Lock/unlock pair, contention dominates |
| chan int64 (1024 buf) | 145.3 | 0 | Channel send + receiver goroutine cost |
| Sharded atomic (padded) | 1.3 | 0 | Each core writes only its own cache line |

Read the table carefully. The naive atomic is 4x faster than the mutex but the *sharded* atomic is 14x faster than the naive atomic — because cache-line bouncing dominates at high contention, not the atomic instruction itself. If you have a hot counter, your real choice is "sharded atomic vs. plain atomic," not "atomic vs. mutex."

## False sharing: the invisible 10x cost

```go
// BAD: two atomics on the same cache line
type stats struct {
    requests atomic.Int64 // bytes 0-7
    bytes    atomic.Int64 // bytes 8-15, same cache line
}
```

Two goroutines writing to `requests` and `bytes` from different cores will fight over the same cache line even though they are touching different fields. The hardware sees one cache line; the cores must coordinate.

```go
// GOOD: pad to separate cache lines
type stats struct {
    requests atomic.Int64
    _        [56]byte // pad to 64 bytes
    bytes    atomic.Int64
    _        [56]byte
}
```

Benchmark on two goroutines, one writing `requests`, one writing `bytes`:

| Layout | ns/op |
|---|---|
| Packed (same cache line) | 32.1 |
| Padded (separate lines) | 3.4 |

Almost 10x. False sharing is the most common silent performance bug in concurrent Go code. `go tool perf c2c` or Intel VTune will find it; reading the struct layout will not.

## Channel batching: amortize the send

```go
// BAD: one send per event
for _, e := range events {
    ch <- e
}

// GOOD: batch and send a slice
const batch = 64
buf := make([]Event, 0, batch)
for _, e := range events {
    buf = append(buf, e)
    if len(buf) >= batch {
        ch <- buf
        buf = make([]Event, 0, batch)
    }
}
if len(buf) > 0 { ch <- buf }
```

A channel send is ~30–100 ns of overhead independent of message size (for small messages). Sending a batch of 64 turns 64 sends into 1, amortizing that fixed cost by 64x. The receiver loop becomes:

```go
for batch := range ch {
    for _, e := range batch {
        process(e)
    }
}
```

Trade-off: latency rises by the time it takes to fill a batch. For metrics ingestion, log shipping, or telemetry, this is acceptable. For request handling, it is not.

## sync.RWMutex vs atomic.Pointer for read-mostly state

```go
type cfg struct{ timeout time.Duration; max int }

// Version A: RWMutex
var rwState struct {
    mu  sync.RWMutex
    cfg cfg
}
func ReadRW() cfg {
    rwState.mu.RLock()
    defer rwState.mu.RUnlock()
    return rwState.cfg
}

// Version B: atomic.Pointer
var apState atomic.Pointer[cfg]
func ReadAP() cfg { return *apState.Load() }
```

Pure read benchmark, 16 cores, all reading concurrently:

| Primitive | ns/op (uncontended) | ns/op (16 concurrent readers) |
|---|---|---|
| atomic.Pointer.Load | 1.1 | 1.1 |
| RWMutex.RLock/RUnlock | 22.4 | 134.7 |

The interesting number is the right column. `RWMutex.RLock` does a CAS on the reader-count field; under N concurrent readers, that CAS contends with itself. `atomic.Pointer.Load` reads a single immutable cache line that every core can cache locally. The atomic pointer scales perfectly with reader count; the RWMutex degrades.

Writes, of course, are the opposite story: `atomic.Pointer.Store` requires allocating a new struct (the copy); `RWMutex.Lock` mutates in place. If writes outpace reads, the comparison flips.

Rule of thumb: if reads dominate by more than 10:1, `atomic.Pointer` over an immutable snapshot wins. Below 10:1, the math gets complicated; benchmark your specific workload.

## sync.Map vs map+Mutex vs sharded map+Mutex

```go
// Random key reads and writes, 50/50 mix, 1M-key universe
```

| Implementation | ns/op | Notes |
|---|---|---|
| map + sync.Mutex | 280 | Single lock, full contention |
| map + sync.RWMutex (90% read) | 105 | Reader contention on RLock |
| sync.Map | 88 | Optimized for read-mostly + disjoint keys |
| Sharded map + Mutex (64 shards) | 41 | Hash key to shard, one lock per shard |

Sharded map almost always wins. `sync.Map` wins specifically when (a) reads dominate writes by 10:1+ and (b) the working set is small enough to fit in its read-only optimized "amended map." For arbitrary workloads, sharded `map[K]V` with per-shard `sync.Mutex` is faster and more predictable.

## Batching beats per-op synchronization

A common pattern: a goroutine accumulates work and flushes to a shared destination. The naive version locks per operation:

```go
// BAD: lock per insert
for _, item := range items {
    sharedSlice.mu.Lock()
    sharedSlice.data = append(sharedSlice.data, item)
    sharedSlice.mu.Unlock()
}
```

The batched version locks once:

```go
// GOOD: lock once per batch
sharedSlice.mu.Lock()
sharedSlice.data = append(sharedSlice.data, items...)
sharedSlice.mu.Unlock()
```

For 1000 items, the locked-per-op version costs ~1000 * 60 ns = 60 μs of lock acquisition. The batched version costs ~60 ns. The 1000x ratio is the upper bound; under contention the gap widens because each lock acquisition also pays a context switch.

The decision tree's quiet rule: *whenever you find yourself locking inside a loop, ask whether the loop body can be lifted outside the lock.*

## errgroup.SetLimit vs semaphore vs token channel

Three ways to bound concurrency at N=16:

```go
// A: errgroup.SetLimit
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(16)
for _, t := range tasks { g.Go(func() error { return do(t) }) }
g.Wait()

// B: semaphore.Weighted
sem := semaphore.NewWeighted(16)
var wg sync.WaitGroup
for _, t := range tasks {
    sem.Acquire(ctx, 1)
    wg.Add(1)
    go func() { defer sem.Release(1); defer wg.Done(); do(t) }()
}
wg.Wait()

// C: buffered channel of tokens
tokens := make(chan struct{}, 16)
var wg sync.WaitGroup
for _, t := range tasks {
    tokens <- struct{}{}
    wg.Add(1)
    go func() { defer func() { <-tokens; wg.Done() }(); do(t) }()
}
wg.Wait()
```

For 100k tasks of ~1ms each:

| Approach | Total time | Allocations |
|---|---|---|
| errgroup.SetLimit | 6.3 s | minimal |
| semaphore.Weighted | 6.4 s | minimal |
| Token channel | 6.5 s | minimal |

They are essentially identical. Pick on readability:

- `errgroup.SetLimit` if you also want error short-circuit and context cancellation.
- `semaphore.Weighted` if different tasks have different weights.
- Token channel for the simplest, dependency-free form.

The optimization here is *not switching*. Stay with the form that reads most clearly for the use case.

## Cache-line awareness summary

Three rules that handle 90% of concurrent-Go performance issues:

1. **Pad hot atomics to cache-line boundaries.** Anything written by multiple goroutines that lives on the same 64-byte cache line as another hot variable will false-share.
2. **Shard write-heavy state.** If every goroutine increments the same counter, give each goroutine (or each CPU) its own shard and aggregate periodically.
3. **Batch when possible.** A single lock acquisition that processes N items is almost always faster than N lock acquisitions for one item each, even if the lock body is trivially short.

## Mutex contention profiling

Go ships with built-in mutex profiling. Enable it with:

```go
runtime.SetMutexProfileFraction(1) // sample every blocked mutex
runtime.SetBlockProfileFraction(1)
```

Then capture a profile under load:

```bash
go tool pprof http://localhost:6060/debug/pprof/mutex
```

The output shows which mutex (file, line, function) goroutines spent the most cumulative time blocked on. A mutex with 10 seconds of cumulative wait across all goroutines is almost certainly your bottleneck.

The decision tree's optimization step starts with this profile, not with intuition. "I think this mutex is hot" without data is the wrong order.

## Goroutine scheduler interactions

Atomic operations do not yield to the scheduler. Mutex contention does — `sync.Mutex.Lock` will park the goroutine if the lock is held by another, allowing other goroutines to run. This has subtle consequences:

- A tight loop of atomic increments from many goroutines will *not* let other goroutines on the same processor run. The Go runtime relies on preemption (Go 1.14+) to interrupt the loop; before 1.14, such loops could starve other work.
- A loop of mutex acquisitions naturally yields. If you have a small piece of CPU-intensive work that must be fair across goroutines, mutex-based serialization may give better fairness than atomic-based.

These are second-order effects. For 95% of workloads, the cache-line cost of atomic vs mutex dominates and the scheduler interaction is irrelevant. Mention it in code review only when you have measured a starvation problem.

## Pool sizing for sync.Pool

`sync.Pool` is a low-cost allocator wrapper, but it has subtleties:

```go
var bufferPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func handleRequest(req *Request) {
    buf := bufferPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufferPool.Put(buf)
    // ... use buf ...
}
```

Three optimization rules:

1. **Always Reset on Get.** The pool returns whatever object was last Put. Without Reset, the next consumer sees leftover state.
2. **Beware GC drain.** `sync.Pool` is cleared every GC cycle. Under low load, the pool is effectively empty between requests. Pool benefits scale with load — at 10 req/sec, the pool may not help; at 10K req/sec, it eliminates a significant chunk of allocations.
3. **Beware retained references.** If a pooled object holds a reference to per-request data (a slice header pointing into a request body), that data outlives the request via the pool. Either deep-copy on Put or clear references before Put.

A benchmark snippet to verify pool effectiveness:

```go
func BenchmarkNoPool(b *testing.B) {
    for i := 0; i < b.N; i++ {
        buf := new(bytes.Buffer)
        buf.WriteString("hello")
        _ = buf.String()
    }
}

func BenchmarkPool(b *testing.B) {
    for i := 0; i < b.N; i++ {
        buf := bufferPool.Get().(*bytes.Buffer)
        buf.Reset()
        buf.WriteString("hello")
        _ = buf.String()
        bufferPool.Put(buf)
    }
}
```

Typical result: `BenchmarkNoPool` allocates 64 B/op; `BenchmarkPool` allocates 0 B/op after the first iteration. Whether that matters depends on whether allocations show up in your CPU profile.

## When to stop optimizing

Concurrent code is the easiest place in Go to spend a day shaving microseconds without moving the needle on production latency. The decision tree's optimization advice ends here: if the profiler shows the primitive itself in the top-5 of CPU time, optimize. If it does not, leave it. A clear `sync.Mutex` is almost always better than a clever atomic-pointer-CAS-with-copy-on-write that the next maintainer cannot debug. The right primitive is the cheapest one that *the team can keep correct*, not the absolute fastest one possible in isolation.

## Optimization checklist

Before submitting a "concurrency optimization" PR, work through this list:

1. **Profile shows the primitive in the top 5 CPU consumers?** If no, the optimization is premature. Stop here.
2. **Benchmark before-and-after exists?** If no, write one. `testing.B` with `b.RunParallel` is the minimum.
3. **`-race` passes after the change?** Optimization that introduces races is a regression, not an improvement.
4. **The fast path is still readable?** A clever CAS loop with a four-line comment explaining it is acceptable; one without is a future bug.
5. **Cache-line padding is justified?** Padding adds 56 bytes per atomic. For small numbers of hot atomics this is free; for arrays of 100,000+ counters, the memory cost adds up.
6. **The slow path (writes, in a read-mostly design) is still correct?** Many optimizations make reads faster at the cost of writes; verify the write cost is acceptable for your workload.

If all six checks pass, the optimization belongs in the codebase. If any fail, the patch is not ready.
