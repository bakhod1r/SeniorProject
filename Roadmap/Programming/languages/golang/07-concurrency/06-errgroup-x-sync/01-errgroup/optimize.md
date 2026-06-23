---
layout: default
title: errgroup — Optimize
parent: errgroup
grand_parent: errgroup and x/sync
ancestor: Concurrency
nav_order: 9
permalink: /roadmap/programming-languages/golang/07-concurrency/06-errgroup-x-sync/01-errgroup/optimize/
---

# errgroup — Optimization

← Back to errgroup index

Errgroup is thin — most of its cost is the underlying goroutines and the work they do. But there are real choices about how you use it: when to set a limit, what limit to choose, when to use `TryGo` instead of `Go`, when to roll your own bounded executor, and when not to use errgroup at all. This page collects the performance and design decisions that matter.

---

## 1. The cost of errgroup itself

### 1.1 What you pay per `Go`

- One `sync.WaitGroup.Add(1)` — an atomic add (a few nanoseconds).
- If limited: one buffered-channel send — tens to a few hundred nanoseconds.
- One `go` statement — about 1 µs for the runtime to set up the goroutine plus the closure capture allocation.
- Inside the goroutine: deferred `<-sem` (if limited) + `wg.Done()` — also a few atomics.
- On error: one `sync.Once.Do` (cheap after first), one cancel-func call.

In numbers: an empty closure spawned through `g.Go` costs about 1.5–3 µs on modern hardware. Compared to a raw `go` (about 1 µs), errgroup overhead is 50–200 % on the spawn — but if the work itself is more than a microsecond, the overhead is rounded away.

Rule of thumb: if each task takes more than 10 µs of real work, errgroup overhead is below 10 % and you should not worry. If each task is sub-microsecond (e.g., `g.Go(func() error { return nil })`), errgroup is too heavy — batch instead.

### 1.2 What you pay per `WithContext`

- One `context.WithCancelCause` — allocates the derived context (~96 bytes) and a closure for the cancel func (~64 bytes). Tens of nanoseconds.
- One `cancel` call on `Wait` return — atomic close of the `Done` channel.

If you spawn 1000 tasks under one `WithContext`, the cost is amortised over 1000 goroutines, well under 1 % of total time.

### 1.3 What you pay per `SetLimit`

- One `make(chan token, n)` — allocates a channel with a buffer of `n × 8 bytes` plus header (~96 bytes).
- Per `Go`: one send (often non-blocking if a slot is free).
- Per goroutine exit: one receive.

The buffered channel is what `sync.WaitGroup` would do internally if it had a limit. There's no cheaper way to do "wait until a slot is free" without writing custom assembly.

---

## 2. Choosing the limit

### 2.1 CPU-bound work

For tight CPU loops, set the limit to `runtime.NumCPU()`. Going higher trades context-switching for nothing because all your CPUs are already busy.

```go
g.SetLimit(runtime.NumCPU())
```

For BurstableCPU services where you don't want to consume all cores, set it lower:

```go
g.SetLimit(runtime.NumCPU() / 2)
```

### 2.2 I/O-bound work

For HTTP fetches, DB queries, file reads — work that spends most of its time blocked — you can run far more goroutines than CPUs without harm. The bottleneck is the downstream service or the network, not your CPU.

Typical numbers:

| Workload | Sensible limit |
|---|---|
| Per-DB connection (PostgreSQL with `MaxConns=20`) | 20 |
| HTTP client with default transport (`MaxIdleConnsPerHost=2`) | 8–16 |
| HTTP client with tuned transport (`MaxIdleConnsPerHost=100`) | 100–500 |
| File-system operations on SSD | 16–64 |
| File-system operations on rotating disk | 4–8 |
| Untrusted public input | low; benchmark and pick |

The limit should not exceed the downstream's parallelism budget. If your database supports 20 connections, capping errgroup at 200 just queues 180 goroutines on the connection pool — same effective throughput, more memory.

### 2.3 Empirical tuning

A reliable procedure:

1. Set `g.SetLimit(N)` for a starting `N` (say, `2 * NumCPU()` for I/O work).
2. Measure throughput.
3. Double `N`. If throughput rises, keep doubling. If it plateaus, you've found the sweet spot.
4. If throughput drops, you're past the sweet spot (downstream is saturated, or context switching dominates).

This is "binary search over the parallelism knob" — a standard tuning technique.

### 2.4 Dynamic limits

Errgroup does not support dynamic limit changes. If you need them (e.g., scale concurrency based on load), use `semaphore.Weighted` with a configurable max-weight:

```go
var maxWeight atomic.Int64
maxWeight.Store(initial)
sem := semaphore.NewWeighted(maxWeight.Load())
// ... external code can do maxWeight.Store(newValue), but NewWeighted is fixed.
```

Actually, `semaphore.Weighted` also has a fixed capacity. For truly dynamic limits, you write a custom token-bucket or use `context.WithCancel` per worker to kill excess.

---

## 3. `Go` vs `TryGo`

| Choice | Producer behaviour | Use when |
|---|---|---|
| `Go` only | Producer blocks when full | Backpressure is desired; producer can wait |
| `TryGo` only | Producer never blocks; failed `TryGo` is a hint to do something else | Real-time producer must not stall |
| Mixed | Use `TryGo` first; fall back to `Go` after enqueueing on a backlog | Complex policy |

A common mistake is using `TryGo` everywhere and silently dropping work. Always pair `TryGo` with a metric counter — `metrics.Drops.Inc()` — so you can observe overload.

### 3.1 Cost difference

`TryGo` does an extra `select { case sem <- token: ; default: return false }` instead of a blocking send. This is roughly the same cost when a slot is free, and faster than `Go` when a slot is not (because `TryGo` returns immediately).

### 3.2 Pattern: spillover queue

```go
queue := make(chan Item, 1000)

producer := func() {
    for x := range source {
        if !g.TryGo(func() error { return process(x) }) {
            select {
            case queue <- x:
            default:
                metrics.Drops.Inc()
            }
        }
    }
}

drainer := func() {
    for x := range queue {
        x := x
        g.Go(func() error { return process(x) }) // may block
    }
}
```

The `TryGo` path tries to dispatch immediately; on overflow, the item goes to a queue. A separate drainer pulls from the queue and uses blocking `Go`. This gives you a 1000-item buffer plus the in-flight limit.

---

## 4. Avoiding allocations

### 4.1 Closure capture is an allocation

```go
for _, x := range xs {
    x := x
    g.Go(func() error { return process(x) })
}
```

Each closure captures `x`. Go's escape analysis will heap-allocate the closure environment because the goroutine outlives the loop iteration. That's one allocation per `Go`.

You cannot avoid this — `g.Go` takes `func() error`, which is a closure. The cost is small (16–48 bytes per call). For a million tasks, you allocate ~32 MB transiently, which the GC reclaims promptly.

### 4.2 Reusing closures

For very high task rates, you can amortise by submitting *batches* per goroutine:

```go
const batchSize = 100
batches := chunkSlice(xs, batchSize)
for _, batch := range batches {
    batch := batch
    g.Go(func() error {
        for _, x := range batch {
            if err := process(x); err != nil { return err }
        }
        return nil
    })
}
```

Now you spawn `len(xs) / batchSize` goroutines instead of `len(xs)`. The closure allocation overhead drops proportionally.

This is a classic "amortise spawn cost" trick. The cost: a single failing item now aborts a batch of 100 instead of just itself — slightly delayed cancellation.

### 4.3 Inlining for small tasks

If your task is "increment a counter," do not use errgroup. The spawn cost dwarfs the work. Use `sync.WaitGroup` directly, or batch, or use a single goroutine with a channel.

---

## 5. When *not* to use errgroup

### 5.1 Long-running services

Errgroup is for "spawn N, wait here." For services that run for the program's lifetime, use a long-running goroutine pattern:

```go
go func() {
    for {
        select {
        case <-ctx.Done():
            return
        case msg := <-input:
            handle(msg)
        }
    }
}()
```

`Wait` does not fit; you want the program to keep running.

### 5.2 One-shot single goroutine

If you have one goroutine, the errgroup overhead is not worth it:

```go
// Don't:
var g errgroup.Group
g.Go(func() error { return doIt() })
return g.Wait()

// Do:
return doIt()
```

If you need to do `doIt` concurrently with the caller, use a channel.

### 5.3 Streaming pipelines with channels

A pipeline where stages communicate via channels:

```go
out := make(chan Result, 16)
go stage1(in1, mid)
go stage2(mid, out)
```

Errgroup helps with the "wait for all stages" part, but the data flow is the channels. Use errgroup as a join helper, not as the primary pattern.

### 5.4 Per-task panic recovery

If your code can panic on input and you want each goroutine to fail independently, errgroup is awkward — you must wrap every closure with `defer recover()`. Consider `sourcegraph/conc.WaitGroup` or `pool.Pool`, which handle this.

### 5.5 Fan-in collection without errgroup

If you just want to merge values from N producers into one channel:

```go
out := make(chan Item)
var wg sync.WaitGroup
for _, src := range sources {
    wg.Add(1)
    go func(s Source) {
        defer wg.Done()
        for v := range s.Stream() {
            out <- v
        }
    }(src)
}
go func() { wg.Wait(); close(out) }()
```

Errgroup adds the error-collection layer, but if every source is infallible, `sync.WaitGroup` is simpler.

---

## 6. Cancellation cost

### 6.1 What cancellation does

When the first error fires, errgroup calls `cancel(err)`. Internally, that closes the `Done` channel of the derived context. Every goroutine selecting on that channel wakes up.

Cost: O(number of waiters). If you have 100 000 goroutines blocked on `ctx.Done()`, all 100 000 wake up. The Go runtime handles this efficiently (it's a single channel-close operation that walks the waiter list), but each goroutine still runs briefly.

In practice this is fast (microseconds for thousands of goroutines). It is not free for millions.

### 6.2 Cancellation propagation latency

The goroutine that observes `ctx.Done()` only stops when it next reaches a `select` or context-aware call. If it's mid-`time.Sleep(10*time.Second)`, the sleep finishes first. If it's mid-`net.Conn.Read` without a context, the read continues until the OS returns.

Latency from "first error returned" to "all workers stopped" can be:

- Microseconds, if every worker is in a tight `select` on `ctx.Done()`.
- Seconds, if workers are in `time.Sleep` without `select`.
- Minutes, if workers are in `net.Conn.Read` without a deadline.

Always set deadlines on I/O and wrap sleeps in `select`. This is general advice, not errgroup-specific.

---

## 7. Memory profile

### 7.1 Per-Group memory

| Component | Bytes |
|---|---|
| `Group` struct | 24 |
| Cancel closure (with `WithContext`) | ~64 |
| Limit channel (with `SetLimit(n)`) | ~96 + 8n |
| Per goroutine (stack) | 2048+ (grows on demand) |
| Per closure capture | varies |

A group with `SetLimit(64)` and `WithContext` costs about 600 bytes. Negligible.

### 7.2 Goroutine stack pressure

Each spawned goroutine starts at 2 KB. If you spawn 100 000 with errgroup, the resident set grows by about 200 MB just for stacks, plus closure captures. If they live briefly, GC reclaims. If they all block simultaneously (e.g., on `ctx.Done()`), peak memory is the sum.

For massive fan-out, prefer:

- A bounded `SetLimit` so peak goroutine count is the limit, not the input size.
- Batching (multiple items per goroutine) so spawn count is smaller.

### 7.3 Closure pressure

A closure that captures a 1 KB struct will heap-allocate that struct (escape analysis pushes it out). Spawn a million such closures and you've allocated a gigabyte. Always think about what your closure captures.

```go
// Bad: captures entire huge struct by value (copies it 1M times)
for _, h := range hugeStructs {
    g.Go(func() error { return process(h) })
}

// Better: capture just the ID, look up the struct inside
for i, h := range hugeStructs {
    i := i
    _ = h
    g.Go(func() error { return process(hugeStructs[i]) })
}
```

The "better" version captures only `i` (8 bytes) instead of `h` (1 KB). Less pressure on GC.

---

## 8. Benchmarking errgroup

A minimal benchmark template:

```go
func BenchmarkErrgroup(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var g errgroup.Group
        for j := 0; j < 100; j++ {
            g.Go(func() error { return nil })
        }
        _ = g.Wait()
    }
}

func BenchmarkErrgroupLimit(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var g errgroup.Group
        g.SetLimit(8)
        for j := 0; j < 100; j++ {
            g.Go(func() error { return nil })
        }
        _ = g.Wait()
    }
}

func BenchmarkRawWaitGroup(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        for j := 0; j < 100; j++ {
            wg.Add(1)
            go func() { defer wg.Done() }()
        }
        wg.Wait()
    }
}
```

Run with `go test -bench=. -benchmem`. You will see:

- Errgroup adds a few hundred nanoseconds per spawn over raw `WaitGroup`.
- `SetLimit` adds a channel send/receive — a few hundred more nanoseconds, but it pins peak goroutine count.
- Memory allocations are dominated by the closure environment.

---

## 9. Common optimisation mistakes

### 9.1 Setting a limit "for safety" on small workloads

```go
var g errgroup.Group
g.SetLimit(4)
for _, x := range []Item{a, b, c} { g.Go(...) }
```

Three tasks. Limit of 4. Limit does nothing useful, adds two channel ops. Skip `SetLimit` for small `n`.

### 9.2 Setting the limit way too low

```go
g.SetLimit(1)
```

`SetLimit(1)` is "do these serially." If that's what you want, just call them sequentially without errgroup. If you wanted parallelism, you have a bug.

### 9.3 Using errgroup as a serialiser

```go
var g errgroup.Group
g.SetLimit(1)
for _, x := range xs {
    x := x
    g.Go(func() error { return critical(x) })
}
g.Wait()
```

This works (serialises critical work). But `sync.Mutex` is simpler:

```go
for _, x := range xs {
    mu.Lock()
    if err := critical(x); err != nil { mu.Unlock(); return err }
    mu.Unlock()
}
```

Don't use concurrency primitives to serialise. It's a sign you should not have introduced concurrency at all.

### 9.4 Hand-rolling errgroup

```go
var wg sync.WaitGroup
var firstErr atomic.Value
var sem = make(chan struct{}, 8)
ctx, cancel := context.WithCancel(parent)
// ... etc
```

Re-implementing errgroup is rarely worth it. The library is short, audited, used everywhere. Hand-rolling is more code and more bugs. Unless you need something errgroup explicitly doesn't provide (panic recovery, multi-error, dynamic limit), use errgroup.

---

## 10. Decision matrix

| Workload | Limit? | WithContext? | Notes |
|---|---|---|---|
| 3 service init calls | No | Yes | Tiny fixed set; cancellation matters. |
| 10–100 HTTP fetches | Yes (8–16) | Yes | Bound for politeness; cancel for fail-fast. |
| Bulk import (1000+ rows) | Yes (NumCPU * 2) | Yes | Bound for DB; cancel for fail-fast. |
| CPU-bound parallel-map | Yes (NumCPU) | Yes | Bound for cores. |
| Crawler (unbounded) | Yes (per-host limit) | Yes | TryGo for overflow. |
| Background daemon | N/A | N/A | Don't use errgroup; use a long-running goroutine. |
| 2 sub-results combined | No | Yes | Tiny; just use errgroup for clarity. |
| Test fixture seeding | Yes | No | Errors should be collected, not first-only. |

---

## 11. Summary

- Errgroup overhead is ~1.5–3 µs per spawn — negligible above 10 µs of real work.
- Limit choice is bounded by the downstream's parallelism budget, not by your CPU count for I/O work.
- Use `Go` for backpressure, `TryGo` for drop-on-overflow.
- Batch tasks to amortise spawn cost when each task is short.
- Bound peak goroutine count with `SetLimit` for any unbounded input.
- Don't reach for errgroup when one goroutine, long-running work, or panic-recovery is the actual problem.

Errgroup is well-tuned out of the box. The optimisation problems are almost always about *what you put inside the closure* and *how you bound the work*, not about the library itself.
