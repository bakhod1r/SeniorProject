---
layout: default
title: Optimize
parent: Channel Close Violations
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 9
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/03-channel-close-violations/optimize/
---

# Channel Close Violations — Optimization

## Introduction

This file presents 10 optimization scenarios involving channel close. Each scenario starts with a working but suboptimal implementation, identifies the cost, and proposes a tuned version. Where appropriate, we discuss the trade-offs and when to choose each.

The micro-optimizations here matter only when measured: do not apply blindly. Profile first; optimize what shows up.

---

## Scenario 1: sync.Once vs Atomic CAS for Idempotent Close

**Baseline.**

```go
type Closer struct {
    done chan struct{}
    once sync.Once
}

func (c *Closer) Close() {
    c.once.Do(func() { close(c.done) })
}
```

**Cost.** `sync.Once` is two fields: a uint32 flag and a sync.Mutex. The fast path is `atomic.LoadUint32` + branch (~1 ns uncontended). The slow path takes the mutex.

**Optimized.**

```go
type Closer struct {
    done   chan struct{}
    closed atomic.Uint32
}

func (c *Closer) Close() {
    if c.closed.CompareAndSwap(0, 1) {
        close(c.done)
    }
}
```

**Why.** Pure atomic CAS. One uint32 field instead of two. Slightly faster on the slow path (no mutex acquisition).

**Trade-off.** Slightly less readable. Equivalent semantics. Save this for ultra-hot paths where the close happens often (which is rare — close is typically once-per-lifetime).

**Recommendation.** Default to `sync.Once`. Switch to atomic CAS only after profiling confirms a benefit.

---

## Scenario 2: Reusing Channels via sync.Pool Is Not Safe — Show Why

**Tempting baseline.**

```go
var chPool = sync.Pool{
    New: func() interface{} { return make(chan int, 16) },
}

func get() chan int { return chPool.Get().(chan int) }
func put(ch chan int) {
    // drain
    for {
        select { case <-ch: default: goto done }
    }
done:
    chPool.Put(ch)
}
```

**Problem 1: drain may miss values.** If another goroutine still holds the channel and sends to it after `put` drains but before `put` returns it to the pool, the value sits in the buffer. The next pool consumer sees a non-empty buffer with stale data.

**Problem 2: close cannot be reused.** A channel that has been closed cannot be put back into the pool and used again — it would panic on subsequent sends. So you must never close pooled channels. But that means no receiver can use `range`, and there is no clean end-of-stream signal.

**Problem 3: ABA.** Two goroutines both grab a channel from the pool, then both put it back. The pool now has two references to the same channel. Subsequent users may receive each other's data.

**Conclusion.** Channels are not poolable. The cost of `make(chan int, 16)` is small (under 100 ns); pooling does not pay.

**Alternative.** If you need many channels and worry about allocation, use a slab allocator pattern at a higher level (one channel per session, reused for the session's lifetime).

```go
type Session struct {
    ch chan Event // alive for the whole session
}
```

The session struct lives in a pool; the channel inside it is created on session start and lives until session end. No reuse across sessions.

---

## Scenario 3: Convert "Close as Broadcast" to Context

**Baseline.**

```go
type Server struct {
    done chan struct{}
}
func (s *Server) Shutdown() { close(s.done) }
// workers:
select { case <-s.done: return; case task := <-tasks: ... }
```

**Issue.** Custom done channel does not propagate to nested operations (sub-goroutines, RPC calls, database queries).

**Optimized.**

```go
type Server struct {
    ctx    context.Context
    cancel context.CancelFunc
}

func New(parent context.Context) *Server {
    ctx, cancel := context.WithCancel(parent)
    return &Server{ctx: ctx, cancel: cancel}
}

func (s *Server) Shutdown() { s.cancel() }

// workers:
select { case <-s.ctx.Done(): return; case task := <-tasks: ... }
```

**Why.** `context.Context` propagates: child contexts cancel automatically. Database libraries, HTTP libraries, and gRPC all accept context. The cancellation reaches all layers.

**Cost.** Slight allocation overhead for context.WithCancel (a context struct). Negligible compared to the benefits.

**Recommendation.** Use context.Context for cancellation. Use raw done-channels only when you cannot depend on context (low-level libraries) or when context's deadline/cause semantics are unwanted.

---

## Scenario 4: Reduce Lock Contention on Close Storms

**Baseline.** One channel with 10,000 receivers; close fires.

```go
done := make(chan struct{})
for i := 0; i < 10000; i++ {
    go func() { <-done }()
}
close(done) // wakes all 10,000 at once
```

**Cost.** `close` holds the channel lock while building the wakeup list of 10,000. Other operations on the channel are blocked. The wakeup itself is O(N).

**Optimized: shard the receivers.**

```go
const shards = 16
doneChs := make([]chan struct{}, shards)
for i := range doneChs { doneChs[i] = make(chan struct{}) }
for i := 0; i < 10000; i++ {
    shard := i % shards
    go func(shard int) { <-doneChs[shard] }(shard)
}
// close all in parallel
var wg sync.WaitGroup
for i := range doneChs {
    wg.Add(1)
    go func(i int) { defer wg.Done(); close(doneChs[i]) }(i)
}
wg.Wait()
```

**Why.** Each shard's close is independent. Total work is the same (O(N)) but parallelism reduces wall clock. Each shard's lock is held for ~50µs instead of 1ms.

**Trade-off.** More complexity for distributed-close coordination. Worth it only for truly massive fanouts (10K+).

---

## Scenario 5: Avoid Recreating Done Channels Per Request

**Baseline.**

```go
func handle(req Request) {
    done := make(chan struct{})
    go work(done)
    // ... use done ...
    close(done)
}
```

**Cost.** Per-request allocation of a done channel. For 100K QPS, 100K channel allocations per second. Channel allocation is ~100 ns; total 10 ms/sec of CPU.

**Optimized.** Reuse a process-wide context for cancellation; per-request scope via WithCancel of parent.

```go
var globalCtx, globalCancel = context.WithCancel(context.Background())

func handle(ctx context.Context, req Request) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    go work(ctx)
    // ... use ctx ...
}
```

**Why.** `context.WithCancel` allocates a small context struct, but typical Go runtimes are heavily optimized for this. The allocation is still smaller than a full channel.

Actually, `context.WithCancel` also allocates a done channel internally — just lazily. The cost is similar to raw channel allocation. No savings unless the done channel is never observed.

**Better optimization.** If most requests don't need to spawn child goroutines, avoid creating the cancel-scope at all. Only create when actually needed.

```go
func handle(ctx context.Context, req Request) {
    if !needsConcurrency(req) {
        return process(ctx, req) // no extra goroutine
    }
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    go work(ctx)
    return finalize(ctx, req)
}
```

---

## Scenario 6: Eliminate Coordinator Goroutine via Atomic Counter

**Baseline.**

```go
var wg sync.WaitGroup
wg.Add(N)
for i := 0; i < N; i++ {
    go func() { defer wg.Done(); /* work */ }()
}
go func() { wg.Wait(); close(out) }()
```

**Cost.** N+1 goroutines per pipeline stage. The coordinator goroutine is overhead.

**Optimized.**

```go
var pending atomic.Int32
pending.Store(int32(N))
for i := 0; i < N; i++ {
    go func() {
        // ... work ...
        if pending.Add(-1) == 0 {
            close(out)
        }
    }()
}
```

**Why.** Each worker decrements the counter on exit. The last decrementer closes the channel. No separate coordinator.

**Cost-benefit.** Saves one goroutine (~2KB stack) and one wakeup. For high-throughput pipelines with frequent setup, this matters.

**Risk.** The atomic CAS-close pattern is correct, but slightly less readable. The WaitGroup version is more familiar to most Go developers.

**Recommendation.** Use the WaitGroup version for clarity. Switch to the atomic version only for benchmarked hot paths.

---

## Scenario 7: Reduce select Overhead in Hot Loops

**Baseline.**

```go
for {
    select {
    case <-ctx.Done(): return
    case v := <-input: process(v)
    }
}
```

**Cost.** Each select has ~100 ns of overhead (locking channels in canonical order, polling each case).

**Optimized: poll non-blocking first.**

```go
for {
    select {
    case <-ctx.Done(): return
    default:
    }
    v, ok := <-input
    if !ok { return }
    process(v)
}
```

**Why.** The first select is a non-blocking poll on ctx (cheap if ctx is not done). The receive on input is a direct channel op (faster than select).

**Trade-off.** Loses the ability to abort during a blocking receive. If `input` blocks indefinitely (no producer), the loop is stuck even if ctx is done.

This optimization is correct only when input is guaranteed to either deliver or close, both of which let the receive return. For input that may block indefinitely (e.g., waiting for upstream events), the select version is necessary.

**Recommendation.** Use the optimization only when input is bounded. Most production code should use the select version for safety.

---

## Scenario 8: Batch Sends to Amortize Lock Cost

**Baseline.**

```go
for _, v := range items {
    ch <- v
}
close(ch)
```

**Cost.** Each `ch <- v` takes the channel lock. For 10,000 items, 10,000 lock acquisitions.

**Optimized: send slices.**

```go
const batchSize = 100
batch := make([]Item, 0, batchSize)
for _, v := range items {
    batch = append(batch, v)
    if len(batch) == batchSize {
        ch <- batch
        batch = make([]Item, 0, batchSize)
    }
}
if len(batch) > 0 { ch <- batch }
close(ch)
```

Change the channel type to `chan []Item`.

**Why.** 100 items per send means 100x fewer lock acquisitions. The receiver processes the slice in its own loop, which is also locally optimized.

**Trade-off.** Latency: the first send is delayed until 100 items accumulate. Backpressure dynamics change.

**Recommendation.** Use batching when throughput matters more than latency. Streaming applications (Kafka consumers) often batch.

---

## Scenario 9: Avoid Close Storms by Re-Using Long-Lived Channels

**Baseline.** Per-request channels:

```go
func handleRequest(req Request) Response {
    resp := make(chan Response, 1)
    go work(req, resp)
    return <-resp
}
```

Each request allocates a channel. The channel is GC'd shortly after.

**Optimized: per-worker reusable response channels.**

This pattern is hard to apply correctly because each request needs its own response. The "obvious" optimization (pool of response channels) is unsafe (Scenario 2).

**Real fix.** If allocation is the bottleneck, profile to confirm. Channel allocation in modern Go is fast; rarely the bottleneck.

If you must pool, use a strict per-worker pattern:

```go
type Worker struct {
    in  chan Request
    out chan Response
}

func (w *Worker) loop() {
    for req := range w.in {
        w.out <- process(req)
    }
}

// caller:
worker.in <- req
resp := <-worker.out
```

Each worker has a single in/out pair, reused across requests. The cost is correlating request to response (works only for single-flight pattern; concurrent requests would interleave).

For most cases, accept the allocation. Channel allocation is sub-µs.

---

## Scenario 10: Convert Recover-Around-Send to Select-on-Done

**Baseline.**

```go
func trySend(ch chan<- int, v int) (ok bool) {
    defer func() {
        if r := recover(); r != nil {
            ok = false
        }
    }()
    ch <- v
    return true
}
```

**Cost.** The deferred function adds ~100-300 ns to every send, even when no panic occurs.

**Optimized.**

```go
func trySend(ch chan<- int, done <-chan struct{}, v int) bool {
    select {
    case <-done: return false
    case ch <- v: return true
    }
}
```

**Why.** Select is cheaper than defer-with-recover. No panic, no goroutine state mutation.

**Cost.** Requires that `done` is available; the design must allow for it.

**Recommendation.** Always prefer select-on-done over recover-around-send. The latter is a last resort for legacy code that cannot be refactored.

---

## Scenario 11: Reduce Channel Capacity for Lower Memory

**Baseline.**

```go
ch := make(chan Event, 10000)
```

**Cost.** 10000 * sizeof(Event). For Event of 256 bytes, that's 2.5 MB per channel. With many channels (sessions, tenants), this adds up.

**Optimized.**

```go
ch := make(chan Event, 16)
```

**Why.** Smaller buffer = less memory. For most workloads, 16 is sufficient. Backpressure kicks in if producer is faster than consumer.

**Trade-off.** Smaller buffer is less tolerant of bursts. Producer may block more often.

**Recommendation.** Start with unbuffered (0). Increase to 16 if profiling shows blocking. Increase further only with concrete justification.

Large buffers (>256) often indicate a design that should be using a different queue mechanism (database, message bus, ring buffer).

---

## Scenario 12: Use Closed Channel as Permanent Broadcast

**Baseline.** Sending struct{} repeatedly to signal:

```go
for _, sub := range subscribers {
    sub.ch <- struct{}{}
}
```

**Cost.** N sends. Each takes a channel lock.

**Optimized.** Close the signal channel once (one-shot broadcast):

```go
var signal = make(chan struct{})
// ...
close(signal)

// Subscribers:
<-signal // unblocks everyone simultaneously
```

**Why.** One close, N wakeups. The close is O(N) under the channel lock but it's a single sequence of operations.

Compare: sending struct{} N times is O(N) under the lock too, but with N separate lock acquisitions. The close is more efficient.

**Trade-off.** Close is one-shot. If you need a reusable signal, you cannot use this pattern.

**Recommendation.** For one-shot fanout (shutdown, init complete, etc.), use close-as-broadcast. For repeating signals, use individual sends or sync.Cond.

---

## Summary

Channel close is rarely the performance bottleneck in production Go. The optimizations above address specific micro-issues that show up under load:

- **sync.Once vs CAS:** marginal, default to sync.Once.
- **No channel pooling:** unsafe, do not attempt.
- **context over done:** structural improvement, not perf.
- **Shard close storms:** for >10K fanout.
- **Eliminate coordinator goroutine:** small savings for hot pipelines.
- **Avoid select overhead:** when input is bounded.
- **Batch sends:** reduce lock acquisitions in high-throughput.
- **Reuse long-lived channels:** when allocation matters.
- **Select-on-done over recover:** avoid deferred recover in hot paths.
- **Smaller buffers:** reduce memory.
- **Close as broadcast:** efficient one-shot fanout.

Profile before optimizing. Read flame graphs. Compare benchmarks. The patterns here are tools; apply them surgically when measurements justify.

Most production Go services do not have channel-close as their bottleneck. The bottleneck is usually I/O, JSON parsing, allocation, or business logic. Channels are fast enough that close optimization is rarely the highest-leverage work.

When in doubt, choose readability. Future maintainers will thank you.
