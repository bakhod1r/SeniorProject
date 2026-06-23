# Starvation — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [`sync.Mutex` Starvation Mode (Go 1.9+)](#syncmutex-starvation-mode-go-19)
3. [`sync.RWMutex` and Writer Starvation](#syncrwmutex-and-writer-starvation)
4. [Channel Fairness and Bias](#channel-fairness-and-bias)
5. [Bounded Queues and Back-pressure](#bounded-queues-and-back-pressure)
6. [Diagnosing Starvation](#diagnosing-starvation)
7. [Common Patterns and Anti-patterns](#common-patterns-and-anti-patterns)
8. [Summary](#summary)

---

## Introduction

This file is for the engineer who has seen `sync.Mutex` in production and now needs to *reason* about its fairness. We will study:

- The exact rule that flips Go's mutex into starvation mode, and the cost of that flip.
- The `RWMutex` algorithm and the asymmetric protection it gives writers.
- How `select`'s pseudo-random pick interacts with biased readiness.
- How bounded channels do anti-starvation work for you by transferring the wait to the producer.
- How to read `pprof` block and mutex profiles and turn what you see into action.

By the end you should be able to predict whether a given piece of code can starve under load, and be ready to read the runtime sources at senior level.

---

## `sync.Mutex` Starvation Mode (Go 1.9+)

### Why a mode at all

A plain CAS-only mutex has a simple acquire path:

```go
if atomic.CompareAndSwapInt32(&m.state, 0, 1) { return }
// else: queue, park, wake up, retry
```

The race is between a *fresh arriver* on a CPU and a *just-woken parked waiter* climbing out of its sleep. The fresh arriver almost always wins: it is already cache-hot, already executing, and only needs one CAS to grab the lock. The waiter has to be woken by the OS, scheduled by Go, return from `gopark`, and then attempt a CAS that the arriver already beat them to.

Repeat this enough times and the waiter is starved.

### The 1 ms rule

Dmitry Vyukov's design (Go issue #13086, merged in Go 1.9) introduced two modes:

- **Normal mode.** The fast-path CAS is enabled. Arrivers can grab the lock without consulting the queue. Waiters compete and may lose to fresh arrivers.
- **Starvation mode.** The fast-path CAS is disabled. Every acquire goes to the slow path and queues. On `Unlock`, the lock is handed *directly* to the head of the queue.

A `sync.Mutex` enters starvation mode when any single waiter has been parked for more than **1 ms**. The waiter's `gopark` is timed; when it wakes up it checks if its wait exceeded the threshold and, if so, signals "we are starving" by setting the `mutexStarving` bit on the state word.

The mutex leaves starvation mode when the waiter at the head of the queue acquires the lock and observes that *it* is the last waiter, or that its own wait was short. Then it clears the bit.

### What this costs

Starvation mode is *slower*. Every `Lock` enters the slow path. There is no CAS optimisation. The hand-off ping-pongs the cache line between cores. Throughput drops noticeably.

This is by design. The Go runtime accepts a throughput dip to guarantee that no single waiter is starved for more than ~1 ms beyond contention level. The trade-off is "fast in the common case, slow but fair in the bad case".

### Practical observation

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

func main() {
    runtime.GOMAXPROCS(4)
    var mu sync.Mutex
    var hits [4]int64

    var wg sync.WaitGroup
    start := time.Now()
    deadline := start.Add(500 * time.Millisecond)

    for i := 0; i < 4; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            for time.Now().Before(deadline) {
                mu.Lock()
                // ~10 µs of "work" to encourage contention.
                for k := 0; k < 1000; k++ {
                    _ = k * k
                }
                mu.Unlock()
                atomic.AddInt64(&hits[i], 1)
            }
        }()
    }
    wg.Wait()
    for i, h := range hits {
        fmt.Printf("worker %d: %d hits\n", i, h)
    }
}
```

On Go 1.9+ the counts are within a factor of about 2 of each other. On pre-1.9 builds or on a different language's naive CAS mutex, the spread is typically 10x or more.

### What `sync.Mutex` does *not* guarantee

- **FIFO order.** Even in starvation mode the order is "the goroutine at the head of the parked queue", but the head is chosen by the runtime's semaphore implementation, which is FIFO within a single semaphore but may not match the order goroutines called `Lock`.
- **Cancellation.** A parked `Lock` cannot be cancelled. If you need a cancellable lock, build it with a channel.
- **Reentrancy.** A goroutine cannot acquire a `sync.Mutex` it already holds. Doing so deadlocks (and the runtime cannot detect it as deadlock unless every other goroutine is also asleep).

---

## `sync.RWMutex` and Writer Starvation

### The data layout (simplified)

```go
// src/sync/rwmutex.go
type RWMutex struct {
    w           Mutex  // held by writers; serialises writers among themselves
    writerSem   uint32 // writer wakes here when all readers leave
    readerSem   uint32 // readers wake here when writer leaves
    readerCount atomic.Int32
    readerWait  atomic.Int32
}
```

The key invariant: `readerCount` is positive when only readers are active. A pending writer subtracts a large constant from `readerCount`, making it negative. New `RLock` calls observe this negative value and park.

### The acquisition algorithm

`RLock`:

1. Increment `readerCount` atomically.
2. If the result is negative, a writer is pending. Park on `readerSem`.
3. Otherwise, hold the lock.

`Lock` (writer):

1. Acquire `w` (block other writers).
2. Subtract a large constant from `readerCount` (turns it negative). Read the previous value.
3. If the previous value was non-zero (readers were active), set `readerWait` to that count and park on `writerSem`.
4. Each `RUnlock` decrements `readerWait`; the last one wakes the writer.

`RUnlock`:

1. Decrement `readerCount`.
2. If the result is negative, a writer is pending. Decrement `readerWait`; if it reaches zero, wake the writer.

`Unlock` (writer):

1. Add the large constant back to `readerCount`.
2. Wake all parked readers (broadcast on `readerSem`).
3. Release `w`.

### How this prevents reader starvation of the writer

When a writer subtracts the constant, every *new* arriving reader sees a negative count and parks. So the moment a writer arrives, no new readers join. The writer waits only for the existing readers to drain. This is the *key anti-starvation mechanism*.

### Why writers can still starve

The writer must wait for the existing readers to release. If those readers hold the lock for a long time and there are many of them, the wait can be unbounded relative to a normal lock acquire. Worse: if the read critical section itself acquires another lock or makes a callback, the chain can stretch into milliseconds.

```go
func (c *Cache) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    if v, ok := c.fast[k]; ok {
        return v
    }
    return c.slowFallback.Get(k) // network call inside the read lock!
}
```

If `slowFallback.Get` does a 50 ms network call, the writer waits 50 ms behind every reader currently parked there.

### Reader starvation under writer pressure

The mirror image: a stream of writers can starve readers. The Go implementation handles this by waking *all* parked readers on each writer's `Unlock`. Until the next writer arrives, every parked reader gets a chance. Writers must compete with each other through the inner `w Mutex`, which (after Go 1.9) is itself fair under starvation.

### When `RWMutex` helps

- Read critical section ≫ atomic overhead (i.e., the section does real work).
- Read:write ratio is ≥ 10:1.
- Multiple readers can genuinely overlap (no internal serialisation).

### When `RWMutex` hurts

- Read critical sections are tiny (a map lookup): extra atomic operations cost more than they save.
- Writes are common: every write triggers the "drain readers, exclude new arrivers" dance.
- Read critical sections contain long operations (I/O, blocking calls): writers wait for those operations too.

### Measuring writer wait time

```go
type InstrumentedRWMutex struct {
    inner   sync.RWMutex
    waitNs  atomic.Int64
}

func (m *InstrumentedRWMutex) Lock() {
    start := time.Now()
    m.inner.Lock()
    m.waitNs.Add(int64(time.Since(start)))
}

func (m *InstrumentedRWMutex) Unlock() { m.inner.Unlock() }
func (m *InstrumentedRWMutex) RLock()  { m.inner.RLock() }
func (m *InstrumentedRWMutex) RUnlock(){ m.inner.RUnlock() }
```

Export `waitNs` as a gauge. If the writer's average wait exceeds the writer's own critical section duration by a factor of 10 or more, you have writer starvation.

---

## Channel Fairness and Bias

### Pseudo-random select pick

When multiple `select` cases are ready, the runtime calls `fastrand` to choose one. This is documented behaviour, not an accident. In `src/runtime/select.go`:

```go
// select cases are shuffled before being evaluated
// to give every ready case the same expected service.
```

The shuffle is uniform among ready cases. Over many iterations, every ready case is picked with equal probability.

### How bias creeps in anyway

`select` is internally fair, but bias enters through the *readiness rate*:

```go
for {
    select {
    case v := <-fast:
        // fast is almost always ready
    case v := <-slow:
        // slow is rarely ready
    case <-time.After(50 * time.Millisecond):
        return
    }
}
```

If `fast` is ready 99% of the iterations and `slow` is ready 1%, the picks distribute roughly 99/1. This is correct behaviour but feels like bias.

### Mitigations

- **Separate goroutines per channel.** Don't combine. Let each consumer block on its own source.
- **Explicit priority via two-stage select.**

```go
for {
    select {
    case v := <-high:
        handle(v)
        continue
    default:
    }
    select {
    case v := <-high:
        handle(v)
    case v := <-low:
        handle(v)
    }
}
```

The first `select` polls `high` non-blockingly; only if empty does the second `select` give `low` a chance. This makes the priority *explicit* and consistent. Be careful: this pattern can starve `low` under a flood of `high`. Add an aging mechanism if that matters.

- **Bounded send timeouts.** A producer that blocks forever on `ch <- v` is a starvation candidate (its consumer may have moved on). Wrap with `select` + `ctx.Done()`.

### Channel back-pressure as anti-starvation

A bounded channel `make(chan Job, N)` acts as a fairness fence: when `N` jobs are in flight, producers block instead of piling more on. The consumer is not "starved" because there is always work to do; the producer is throttled. This is desirable when consumer capacity is the bottleneck.

An unbounded queue (`[]Job` plus a mutex, or a channel with extremely high capacity) gives no back-pressure and lets producers starve consumers relative to memory.

---

## Bounded Queues and Back-pressure

### Why "bounded" is the answer

Three workers and one unbounded queue:

```
producers -> [-----------queue grows forever-----------] -> workers
```

Producers always succeed; workers process at fixed rate; queue grows. Memory blows up. Latency for the front of the queue grows linearly with the queue's length. This is not starvation in the strict sense (workers do work) but it is the same symptom: items in the queue wait arbitrarily long.

Three workers and one bounded queue of size 10:

```
producers -> [10 slots]
              ^ producers block here when full
                                -> workers
```

When workers fall behind, producers feel it as latency. The system stays stable; the producer has feedback.

### Coding pattern

```go
const QueueDepth = 100

type Pool struct {
    jobs chan Job
    wg   sync.WaitGroup
}

func New(workers int) *Pool {
    p := &Pool{jobs: make(chan Job, QueueDepth)}
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for j := range p.jobs {
                j.Run()
            }
        }()
    }
    return p
}

func (p *Pool) Submit(ctx context.Context, j Job) error {
    select {
    case p.jobs <- j:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (p *Pool) Shutdown() {
    close(p.jobs)
    p.wg.Wait()
}
```

The `Submit` is the back-pressure point. The `ctx.Done()` lets the caller bail out if the system is overloaded, surfacing the situation as an error rather than a silent stall.

### Multi-tenant fairness

Single-queue back-pressure protects the system as a whole but does not protect tenants from each other. A noisy tenant can fill the queue with their own jobs and starve quiet tenants. Patterns:

- **Per-tenant queues plus a round-robin dispatcher.**
- **Weighted fair queueing**: each tenant gets a guaranteed share of throughput.
- **Hierarchical token bucket**: top-level pool size, per-tenant sub-pool size.

We will implement the round-robin dispatcher in `tasks.md`.

---

## Diagnosing Starvation

### Mutex profile

Enable in your program:

```go
import _ "net/http/pprof"
import "runtime"

func init() {
    runtime.SetMutexProfileFraction(1) // sample every contention event
}
```

Then collect:

```
go tool pprof http://localhost:6060/debug/pprof/mutex
```

The top contributors are the lock sites with the most waiting time. A lock that shows up here disproportionately is your starvation suspect.

### Block profile

```go
runtime.SetBlockProfileRate(1) // every blocking operation
```

```
go tool pprof http://localhost:6060/debug/pprof/block
```

Shows channel sends/receives, mutex waits, and other blocking calls. A long-duration block at a `select` site can indicate starvation by readiness imbalance.

### `runtime/metrics`

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/sync/mutex/wait/total:seconds"},
}
metrics.Read(samples)
fmt.Println(samples[0].Value.Float64())
```

This gauge tracks total time spent waiting on mutexes. Export it to Prometheus and graph it. A linear rise during the same workload is a contention regression; a sudden cliff is a starvation event.

### Per-goroutine waiter tracking

```go
type WaitingMutex struct {
    inner       sync.Mutex
    waiters     atomic.Int64
    maxWaiters  atomic.Int64
}

func (m *WaitingMutex) Lock() {
    n := m.waiters.Add(1)
    for {
        cur := m.maxWaiters.Load()
        if n <= cur || m.maxWaiters.CompareAndSwap(cur, n) {
            break
        }
    }
    m.inner.Lock()
}

func (m *WaitingMutex) Unlock() {
    m.waiters.Add(-1)
    m.inner.Unlock()
}
```

Export `maxWaiters` over time. A spike means many goroutines were queued; combined with high p99 latency at that timestamp, it pinpoints the contention.

### Symptoms checklist

- High p99 latency, normal p50.
- `runtime/metrics` mutex wait climbing.
- A specific goroutine stack appears in mutex profile while others do not.
- Throughput stable but latency growing.
- One tenant's success rate falls while others stay flat (multi-tenant starvation).

---

## Common Patterns and Anti-patterns

### Pattern: Drain-before-Wait

When a `select` polls a high-priority channel non-blockingly first, then falls through to a regular blocking `select`:

```go
for {
    select {
    case v := <-urgent:
        handle(v)
        continue
    default:
    }
    select {
    case v := <-urgent:
        handle(v)
    case v := <-normal:
        handle(v)
    case <-ctx.Done():
        return
    }
}
```

Use this when `urgent` must be served before `normal`. Add aging to prevent `normal` starvation under sustained `urgent` load.

### Pattern: Bounded Read in RWMutex Critical Section

Make read critical sections short and finite. If you need to do something slow with the read result, copy it out and release:

```go
func (c *Cache) Get(k string) Value {
    c.mu.RLock()
    v, ok := c.data[k]
    c.mu.RUnlock()
    if !ok {
        return c.fallback(k) // outside the lock
    }
    return v
}
```

The writer's wait is now bounded by the time it takes to copy a small value, not by `c.fallback`.

### Anti-pattern: `select` with always-ready `default`

```go
for {
    select {
    case v := <-ch:
        handle(v)
    default:
        // spin
    }
}
```

This consumes 100% of a P and starves the other goroutines on it (pre-1.14) or contributes to overall scheduling pressure (1.14+). Almost always wrong.

### Anti-pattern: Unbounded `chan`

```go
jobs := make(chan Job, 1<<30) // "effectively unbounded"
```

This works until it doesn't. Memory grows; latency grows; you get paged at 3 a.m. Use a bound and apply back-pressure to producers.

### Anti-pattern: Slow callbacks under `RLock`

```go
func (s *Store) ForEach(fn func(k, v string)) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    for k, v := range s.data {
        fn(k, v) // arbitrary user code under the lock!
    }
}
```

A slow `fn` blocks every writer for the duration of the iteration. Either snapshot under the lock and call `fn` outside, or document that callbacks must be non-blocking.

### Pattern: Snapshot-and-iterate

```go
func (s *Store) Snapshot() map[string]string {
    s.mu.RLock()
    out := make(map[string]string, len(s.data))
    for k, v := range s.data {
        out[k] = v
    }
    s.mu.RUnlock()
    return out
}
```

The reader pays for the copy; the writer's wait time is bounded by the copy time, not by the consumer of the snapshot.

---

## Summary

`sync.Mutex` is fair-enough thanks to its 1 ms starvation-mode rule introduced in Go 1.9. `sync.RWMutex` tries to be fair by blocking new readers when a writer is pending, but it can still starve writers if existing readers stay in long critical sections. `select` is internally fair (pseudo-random over ready cases), but bias creeps in through readiness imbalance and code-shape errors. Bounded channels and queues do the heavy lifting of system-level fairness by transferring waits from consumers to producers.

The middle-level toolkit:

- Trust `sync.Mutex`'s starvation mode.
- Measure `sync.RWMutex` writer wait time before assuming it helps.
- Watch for `select` patterns where one case dominates readiness.
- Bound every queue.
- Read mutex and block profiles. Make `runtime/metrics` mutex wait a first-class graph.

Continue to [senior.md](senior.md) for scheduler-level starvation, priority inversion, and anti-starvation priority queue design.
