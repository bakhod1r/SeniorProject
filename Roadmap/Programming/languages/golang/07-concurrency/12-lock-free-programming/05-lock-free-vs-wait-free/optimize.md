# Lock-Free vs Wait-Free — Optimize

## Table of Contents
1. [Introduction](#introduction)
2. [The Optimisation Question](#the-optimisation-question)
3. [Heuristic 1: Step Down to a Mutex](#heuristic-1-step-down-to-a-mutex)
4. [Heuristic 2: Step Up to Wait-Free Only If Required](#heuristic-2-step-up-to-wait-free-only-if-required)
5. [Heuristic 3: Eliminate Contention Before Choosing a Class](#heuristic-3-eliminate-contention-before-choosing-a-class)
6. [Heuristic 4: Bound the CAS Retry](#heuristic-4-bound-the-cas-retry)
7. [Heuristic 5: Use the Dedicated Atomic Op](#heuristic-5-use-the-dedicated-atomic-op)
8. [Heuristic 6: Cache-Line Awareness](#heuristic-6-cache-line-awareness)
9. [Heuristic 7: Sharding](#heuristic-7-sharding)
10. [Heuristic 8: Per-Goroutine Local State](#heuristic-8-per-goroutine-local-state)
11. [Heuristic 9: Hybrid Designs](#heuristic-9-hybrid-designs)
12. [Heuristic 10: Measure Tail Latency](#heuristic-10-measure-tail-latency)
13. [Worked Example: A Hot-Path Counter](#worked-example-a-hot-path-counter)
14. [Worked Example: A Configuration Hot Swap](#worked-example-a-configuration-hot-swap)
15. [Worked Example: A Multi-Producer Job Queue](#worked-example-a-multi-producer-job-queue)
16. [Summary](#summary)

---

## Introduction

The previous files in this subsection treat lock-free and wait-free as *correctness* claims — properties to defend in a design review. This file treats them as *performance* knobs. The question is: given a concurrent type, which rung of the hierarchy gives the best practical performance for your workload?

The answer is rarely "the strongest." Wait-free designs are the most expensive in steady state. Lock-free designs are robust but pay a CAS-retry cost under contention. Mutexes are simplest and fastest when contention is low. The optimisation question is which of these is right for *this* workload, and how to step up or down the hierarchy when the workload changes.

This file gives ten heuristics, then walks through three worked examples that demonstrate them in action.

---

## The Optimisation Question

You are looking at a concurrent type that is too slow. You profile and find that it is bottlenecked on a shared variable. What do you do?

The conventional answer is "use a faster primitive." That answer is incomplete. The right framing has four questions:

1. **Is this the right concurrent type at all?** Maybe the workload should be split (sharding) or moved (per-goroutine state) so there is no shared variable.
2. **What is the contention regime?** Low, moderate, or extreme. The right answer differs.
3. **What is the operation?** A single read-modify-write maps to one wait-free atomic. A multi-step transaction requires more.
4. **What is the latency SLA?** Throughput, p99, or p99.99 — each pulls toward a different choice.

The four questions interact. A single-counter increment at 1M ops/sec with no SLA on tail latency wants `atomic.Add` (wait-free per call, cache-line bouncing dominates). The same increment with a 10-microsecond p99 SLA wants per-CPU sharding. The same workload but as a CAS-loop on a complex transaction wants a mutex if contention is low, a lock-free design if moderate, and a redesign if extreme.

---

## Heuristic 1: Step Down to a Mutex

When in doubt, use a mutex. It is the simplest tool, has predictable behaviour, and is fast under low contention. The pathological cases (priority inversion, scheduler unfairness) are rare in Go.

A typical pattern: someone wrote a lock-free CAS-loop counter, you measure it, and the loop retries 5 times per success under realistic contention. The CAS-loop is slower than a mutex at this rate (each retry is a cache miss). Replace it.

```go
// Before: lock-free, slow under realistic contention
for {
    old := c.value.Load()
    if c.value.CompareAndSwap(old, old + delta) {
        return
    }
}

// After: blocking, simpler, often faster
c.mu.Lock()
c.value += delta
c.mu.Unlock()
```

The change *weakens* the progress class but may *strengthen* the average performance. Measure before deciding.

---

## Heuristic 2: Step Up to Wait-Free Only If Required

Wait-free is the right answer when the requirement names a bound. "p99 latency under 10 microseconds" — name the bound, then build to it. Otherwise, do not pay for the helping overhead.

The misuse pattern: someone reads about wait-free, implements a helping-based queue, and ships it. Throughput drops 3x compared to the Michael-Scott queue it replaced. The team rolls it back. The wait-free property was not required; it just had a nice name.

Test: can you write down the SLA the wait-free design satisfies that the lock-free design does not? If not, step down to lock-free.

---

## Heuristic 3: Eliminate Contention Before Choosing a Class

The most expensive part of any contended atomic is the cache-line bouncing. If 16 cores all hammer the same atomic, the throughput plateaus regardless of progress class.

Often the right optimisation is to *eliminate* the contention rather than tolerate it. Split the hot variable into N shards. Each goroutine touches one shard. The aggregation happens on read.

Sharding is more important than lock-free vs wait-free at scale. A sharded counter scales linearly with cores; a single hot atomic counter does not, no matter what progress class.

```go
type ShardedCounter struct {
    shards []atomic.Int64
}

func (c *ShardedCounter) Add(delta int64) {
    shard := goroutineIndex() % len(c.shards)
    c.shards[shard].Add(delta)
}

func (c *ShardedCounter) Load() int64 {
    var sum int64
    for i := range c.shards {
        sum += c.shards[i].Load()
    }
    return sum
}
```

Both `Add` and `Load` are wait-free *per shard*. The `Load` is `O(N)` in the shard count, but the read rate is typically far lower than the write rate, so the trade is fine.

---

## Heuristic 4: Bound the CAS Retry

For latency-sensitive code, an unbounded CAS loop is a liability. Cap the retry count and fall back.

```go
const maxRetries = 8

func (c *Cell) Update(transform func(int64) int64) (int64, error) {
    for i := 0; i < maxRetries; i++ {
        old := c.value.Load()
        new := transform(old)
        if c.value.CompareAndSwap(old, new) {
            return new, nil
        }
    }
    return 0, errContended
}
```

Trade-offs:

- **Throughput.** Under high contention, you shed load instead of retrying forever. Throughput is lower but stable.
- **Latency.** Worst-case per-call latency is bounded by `maxRetries * (load + CAS)`. Tail is predictable.
- **Caller complexity.** The caller must handle `errContended` — retry later, fall back to a mutex path, alert the operator.

This pattern is common in trading systems and real-time pipelines. It is *bounded lock-free*, not wait-free, but it has the property that real systems actually need: a hard cap on per-call cost.

---

## Heuristic 5: Use the Dedicated Atomic Op

Whenever the operation maps to a single hardware primitive, use the dedicated atomic function rather than a CAS loop. The dedicated function is:

- **Wait-free per call.** One instruction, no retry.
- **Faster.** No load-then-CAS round trip.
- **Simpler.** Fewer lines of code.

| Operation | Dedicated wait-free op |
|-----------|------------------------|
| Increment by constant | `atomic.AddInt64` |
| Set to a known value | `atomic.StoreInt64` |
| Read | `atomic.LoadInt64` |
| Swap and return old | `atomic.SwapInt64` |
| Conditional set | `atomic.CompareAndSwapInt64` (single call) |
| Update pointer | `atomic.Pointer[T].Store` |
| Compare pointers and swap | `atomic.Pointer[T].CompareAndSwap` |

A CAS loop is the right tool when:

- The new value depends non-trivially on the old (cannot be expressed as `add` or `swap`).
- You need to read multiple fields atomically (use `atomic.Pointer` to a struct).
- You are implementing a higher-level concurrent type (queue, stack, ring buffer).

In any other case, prefer the dedicated op.

---

## Heuristic 6: Cache-Line Awareness

A hot atomic shared across cores bounces its cache line on every modification. The cache miss is the dominant cost — 50-200 cycles per bounce, vs a few cycles for the atomic itself.

Two mitigations:

**False sharing.** If two unrelated atomics share a cache line, they bounce each other. Pad them apart.

```go
type Counters struct {
    a atomic.Int64
    _ [56]byte // pad to cache line
    b atomic.Int64
    _ [56]byte
}
```

**Read-mostly atomics.** A counter that is read 1000x for every write is *read-hot*, not *write-hot*. The cache line stays in shared state, no bouncing. Reads are cheap. Most of the throughput goes to reads.

The progress class is irrelevant to these effects. Both wait-free and lock-free designs bounce the same cache line. The optimisation is at a different layer.

---

## Heuristic 7: Sharding

Already mentioned under "eliminate contention," but worth its own heuristic. Sharding is the most powerful optimisation in concurrent design. It turns a contended operation into a non-contended one.

Pattern: replace `1` shared atomic with `N` shards, each touched by a subset of goroutines.

```go
type Sharded struct {
    shards [16]atomic.Int64
}

func (s *Sharded) Inc(key uint64) {
    s.shards[key%16].Add(1)
}
```

The right `N` depends on your workload. Common choices:

- `N = GOMAXPROCS`. Each goroutine has a shard with high probability.
- `N = 16` or `N = 64`. Fixed sizes that scale well across machines.
- `N = log(workers)`. Reduces sum cost at read.

Read cost is `O(N)`. If reads outnumber writes by 100x, sharding may hurt; use a single counter or shard less aggressively. If writes outnumber reads (typical for metric counters), shard aggressively.

---

## Heuristic 8: Per-Goroutine Local State

The ultimate sharding: each goroutine has its own state. No contention at all. Aggregate on demand.

```go
type GoroutineLocal struct {
    states sync.Map // goroutineID -> *State
}
```

This is rare in Go because there is no portable way to get a goroutine ID. The Go runtime hides it on purpose; relying on it is fragile. But where you control the goroutine pool — for example, a worker pool with `N` goroutines indexed 0 to `N-1` — per-goroutine local state is the cleanest pattern.

```go
type WorkerPool struct {
    perWorker []Worker
}

type Worker struct {
    counter int64 // unsynchronised, only this worker touches it
}

func (p *WorkerPool) Run(workerID int, job Job) {
    p.perWorker[workerID].counter++
}
```

`counter++` is not synchronised at all — it is purely local to one worker. No atomic, no mutex, no shared state. The aggregation routine reads all workers' counters (potentially under a mutex, or via atomics if you want consistency).

This is wait-free *and* the fastest possible design. The trick is that there is no concurrency in the hot path.

---

## Heuristic 9: Hybrid Designs

Many production designs combine progress classes intentionally. The hot path uses the strongest available; the cold path uses the simplest.

**Pattern 1.** Atomic pointer for the read path, mutex for the cold reload.

```go
type HotConfig struct {
    p  atomic.Pointer[Config] // wait-free read
    mu sync.Mutex             // blocking reload
}
```

**Pattern 2.** Per-CPU fast path, mutex slow path (`sync.Pool`'s structure).

```go
type Pool struct {
    perP []Local        // lock-free per-P
    mu   sync.Mutex     // blocking cross-P stealing
}
```

**Pattern 3.** Wait-free read, lock-free write, with a periodic compaction under mutex.

```go
type EventLog struct {
    appendable atomic.Pointer[Chunk] // lock-free
    mu         sync.Mutex            // blocking compaction
}
```

The point is to spend the cost where the workload pays. Hot paths get the strongest guarantee; cold paths can afford to block.

---

## Heuristic 10: Measure Tail Latency

Throughput hides progress-class differences. Tail latency surfaces them.

A 1000-second benchmark that reports "10 million ops/sec average" tells you nothing about the worst-case operation. A log-bucketed histogram (p50, p95, p99, p99.9, max) tells you whether the algorithm has a *long tail*.

Long tails are the signature of:

- Mutex contention (long wait queues).
- CAS-loop starvation (one goroutine retrying forever in the worst case).
- Cache-line bouncing under high contention.

The progress class predicts which long tail you should expect:

- **Blocking.** Long tail is possible under contention.
- **Lock-free.** Long tail in the worst case (a single goroutine starving).
- **Wait-free.** Bounded worst case; no long tail.

The benchmark must surface these. Use `runtime.LockOSThread` to pin goroutines, `GOMAXPROCS` to vary core count, and a histogram to capture the tail.

```go
type Histo struct {
    buckets [64]atomic.Int64
}

func (h *Histo) Record(d time.Duration) {
    n := uint64(d.Nanoseconds())
    if n == 0 { n = 1 }
    bucket := 63 - bits.LeadingZeros64(n)
    h.buckets[bucket].Add(1)
}
```

Run the benchmark, dump the histogram, look at the high buckets. The shape tells you the story.

---

## Worked Example: A Hot-Path Counter

### The problem

A service increments a per-endpoint counter on every request. Load is 500k req/sec across 16 cores. Profiling shows the counter is hot.

### Iteration 1: mutex

```go
type Counter struct {
    mu sync.Mutex
    n  int64
}
func (c *Counter) Inc() { c.mu.Lock(); c.n++; c.mu.Unlock() }
```

Throughput: 5M ops/sec on 16 cores. Mutex contention dominates. p99 latency: 30 microseconds.

### Iteration 2: `atomic.Add`

```go
type Counter struct {
    n atomic.Int64
}
func (c *Counter) Inc() { c.n.Add(1) }
```

Throughput: 50M ops/sec. Cache-line bouncing dominates. p99 latency: 200 nanoseconds.

Progress class went from blocking to wait-free. Throughput went up 10x.

### Iteration 3: sharded

```go
type Counter struct {
    shards [16]atomic.Int64
}
func (c *Counter) Inc() {
    s := goroutineIndex() % 16
    c.shards[s].Add(1)
}
```

Throughput: 500M ops/sec. No contention. Each shard is touched by one or two cores. p99 latency: 30 nanoseconds.

The progress class is still wait-free per shard, but the *aggregate* design is now contention-free. The win is sharding, not the progress class.

### Lesson

`atomic.Add` got us from blocking to wait-free with 10x throughput. Sharding got us another 10x by eliminating contention. The two are independent: you can shard a mutex, an `atomic.Add`, or a CAS loop. The right answer is to do both.

---

## Worked Example: A Configuration Hot Swap

### The problem

A long-running service reloads its configuration every 60 seconds. The hot path is "read the live config" on every request — 1M reads/sec. The reload is rare.

### Iteration 1: mutex

```go
type Config struct {
    mu  sync.RWMutex
    cfg *Settings
}
func (c *Config) Get() *Settings { c.mu.RLock(); defer c.mu.RUnlock(); return c.cfg }
func (c *Config) Set(s *Settings) { c.mu.Lock(); defer c.mu.Unlock(); c.cfg = s }
```

`RWMutex` is the natural choice for read-heavy. But every `RLock` is a write to the reader counter, which bounces the cache line. Throughput: 10M reads/sec. p99: 1 microsecond.

### Iteration 2: `atomic.Pointer`

```go
type Config struct {
    p atomic.Pointer[Settings]
}
func (c *Config) Get() *Settings { return c.p.Load() }
func (c *Config) Set(s *Settings) { c.p.Store(s) }
```

`Get` is wait-free. The cache line is shared-read; no writes from readers. Throughput: 500M reads/sec. p99: 20 nanoseconds.

### Lesson

`atomic.Pointer` for swap-once-rarely state is the canonical wait-free Go pattern. `RWMutex` is the *wrong* tool for this workload — its overhead is in the reader-counter writes. Step up to wait-free reads; the trade-off favours simplicity *and* speed.

---

## Worked Example: A Multi-Producer Job Queue

### The problem

A worker pool processes jobs. Producers (request handlers) enqueue; consumers (workers) dequeue. 100k jobs/sec, 8 producers, 16 consumers.

### Iteration 1: buffered channel

```go
ch := make(chan Job, 1024)
```

Send/receive is mutex-protected internally. Throughput: 5M jobs/sec. p99: 50 microseconds (parking and unparking goroutines).

For 100k jobs/sec, this is fine. p99 of 50 microseconds is below most SLA budgets. *Ship it.*

### Iteration 2 (if profiling demands): Michael-Scott queue

```go
q := NewMSQueue[Job]()
q.Enqueue(job)
job, ok := q.Dequeue()
```

Throughput: 20M jobs/sec. p99: 5 microseconds (no goroutine parking). But the queue's progress class is lock-free, not blocking — a consumer never blocks on an empty queue, it just gets `false`. The caller must busy-poll or use a separate signalling mechanism (a `sync.Cond` or a small channel).

The signalling mechanism brings back the blocking property. The combined design is mixed-class: lock-free enqueue/dequeue, blocking signal.

### Iteration 3 (if SLA demands): bounded lock-free with a fallback

```go
const maxRetries = 16
func (q *Queue) EnqueueBounded(j Job) error {
    for i := 0; i < maxRetries; i++ {
        if q.tryEnqueue(j) {
            return nil
        }
    }
    return errOverloaded
}
```

When the queue is too contended, return an error and let the caller decide (drop, queue elsewhere, alert). Throughput: 30M jobs/sec. p99: 1 microsecond. p99.9 includes the `errOverloaded` rate.

### Lesson

The channel was fine for 100k jobs/sec. For 10M jobs/sec, lock-free wins on tail. For an SLA on tail latency, *bounded* lock-free with explicit shedding is the right answer. Wait-free was never on the table because the SLA was tail latency, not worst-case bound.

---

## Summary

The optimisation question is rarely "which progress class is strongest?" It is "which design fits this workload?" Ten heuristics guide the answer:

1. Step down to a mutex when in doubt.
2. Step up to wait-free only when the SLA names a bound.
3. Eliminate contention through sharding before tuning the progress class.
4. Bound CAS retries for latency-sensitive code.
5. Use the dedicated atomic op when the operation maps to one.
6. Cache-line awareness beats progress-class choice in many cases.
7. Sharding scales further than any single hot atomic, no matter what class.
8. Per-goroutine local state has no concurrency at all — the fastest design.
9. Hybrid designs match the strongest class to the hot path, simplest class to the cold path.
10. Measure tail latency, not just throughput.

Worked examples show the heuristics in action: a hot counter that goes mutex → `atomic.Add` → sharded for a 100x throughput improvement; a configuration hot swap that goes `RWMutex` → `atomic.Pointer` for a 50x improvement; a job queue that picks channel, Michael-Scott, or bounded lock-free depending on the SLA.

The progress class is one variable among many. Wait-free is rarely the right optimisation, *not* because it is weak, but because the strongest progress guarantee is rarely what the workload needs. The workload usually needs less contention, better cache behaviour, or a bounded tail. Pick the tool that delivers those, document the resulting progress class honestly, and move on.

See Herlihy 1991 *Wait-Free Synchronization* for the formal hierarchy; in practice, the optimisation question is solved with sharding, dedicated atomics, and disciplined measurement, not with the highest rung of the hierarchy.
