# Lock-Free vs Wait-Free — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Recap of the Hierarchy](#recap-of-the-hierarchy)
3. [Treiber Stack — Lock-Free in Depth](#treiber-stack-lock-free-in-depth)
4. [Michael-Scott Queue — Lock-Free Reference](#michael-scott-queue-lock-free-reference)
5. [Why a Wait-Free Queue is Hard](#why-a-wait-free-queue-is-hard)
6. [Kogan-Petrank — A First Look](#kogan-petrank-a-first-look)
7. [Helping Mechanisms](#helping-mechanisms)
8. [Contention Analysis](#contention-analysis)
9. [Benchmark Methodology](#benchmark-methodology)
10. [Trade-off Tables](#trade-off-tables)
11. [Where Go Constructs Sit, Revisited](#where-go-constructs-sit-revisited)
12. [Practical Heuristics](#practical-heuristics)
13. [Common Mistakes at This Level](#common-mistakes-at-this-level)
14. [Self-Assessment](#self-assessment)
15. [Summary](#summary)

---

## Introduction

The junior file defined the four rungs of Herlihy's progress hierarchy and placed Go's common primitives on it. At middle level we stop reasoning about counters and start reasoning about data structures: stacks, queues, and the gap between a lock-free implementation and a wait-free one.

The goal of this file is to make three things concrete. First, *what does a real lock-free data structure look like, and why is the CAS loop unavoidable in it?* Second, *what does a wait-free version cost, and where does the cost come from?* Third, *under realistic Go contention, which one wins in practice?* The answer to the third is almost always "lock-free" or "mutex"; understanding *why* the answer is not "wait-free" is the point of this level.

You will leave with the ability to sketch a Treiber stack and a Michael-Scott queue from memory, to explain why a wait-free queue is in a different complexity class, and to design a benchmark that distinguishes the three under contention. You should also leave skeptical of any paper or blog post that claims "wait-free" without showing the bound.

---

## Recap of the Hierarchy

| Rung | One-sentence definition | Go example |
|------|--------------------------|------------|
| Blocking | Progress depends on the scheduler running the right thread. | `sync.Mutex`. |
| Obstruction-free | A thread running in isolation finishes in bounded steps. | Rare; some STM. |
| Lock-free | Some thread always makes progress; individuals may starve. | CAS-loop counter, Treiber stack. |
| Wait-free | Every thread completes each operation in a bounded number of its own steps. | `atomic.Add`, Kogan-Petrank queue. |

The four definitions form a strict containment chain: wait-free ⊂ lock-free ⊂ obstruction-free ⊂ non-blocking. Each step *up* the chain rules out an adversarial scenario; each step *down* loosens constraints and usually buys speed or simplicity.

The middle-level move is to stop treating these as labels on a slide and start treating them as constraints on a design. When you implement a stack or queue, you have to *decide* which rung you target, and the decision drives every line of code that follows.

---

## Treiber Stack — Lock-Free in Depth

The Treiber stack (R. K. Treiber, 1986) is the simplest lock-free data structure that is still interesting. We saw the skeleton in `junior.md`; here we examine it carefully.

```go
package treiber

import "sync/atomic"

type node[T any] struct {
    value T
    next  *node[T]
}

type Stack[T any] struct {
    head atomic.Pointer[node[T]]
}

func (s *Stack[T]) Push(v T) {
    n := &node[T]{value: v}
    for {
        top := s.head.Load()
        n.next = top
        if s.head.CompareAndSwap(top, n) {
            return
        }
    }
}

func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    for {
        top := s.head.Load()
        if top == nil {
            return zero, false
        }
        if s.head.CompareAndSwap(top, top.next) {
            return top.value, true
        }
    }
}
```

### Why this is lock-free

In any execution, each iteration of the `for` loop either succeeds (one operation completes) or fails (the CAS observed a different head, meaning some *other* thread's CAS succeeded since the load). Either way, *some* operation completed during that iteration. Aggregate progress is monotonic; that is the lock-free property.

### Why this is not wait-free

The number of iterations a single goroutine spends in the loop is unbounded. If thread T reads `head = A`, but another thread pushes `B` before T's CAS, T loops. If many other threads push faster than T can run, T can in principle loop forever. There is no integer `B` that bounds T's worst-case step count. Therefore: not wait-free.

### Memory reclamation

Go's GC keeps popped nodes alive as long as any goroutine references them through a local variable, so the Treiber stack does not suffer ABA in the way a C version does. In C/C++ you would need hazard pointers or epochs. This is one of the rare cases where Go is genuinely simpler than C for lock-free code.

### Cost model

Each successful push or pop costs one CAS. Each failed attempt costs one load plus one CAS. Under contention with `N` threads, the *expected* number of retries per operation grows roughly linearly with `N` on cached architectures, dominated by cache-line bouncing on `head`.

### When the Treiber stack is the right tool

When pushes and pops are infrequent enough that the contention pattern is mild, when reads do not outnumber writes (a stack has no fast read path), and when fairness across threads is not a hard requirement. It is fine as a freelist for buffer pools.

---

## Michael-Scott Queue — Lock-Free Reference

Maged Michael and Michael Scott published the canonical lock-free FIFO queue in 1996. It is the queue equivalent of the Treiber stack: not the most efficient algorithm known today, but the one you should be able to sketch.

```go
package msqueue

import "sync/atomic"

type node[T any] struct {
    value T
    next  atomic.Pointer[node[T]]
}

type Queue[T any] struct {
    head atomic.Pointer[node[T]]
    tail atomic.Pointer[node[T]]
}

func New[T any]() *Queue[T] {
    sentinel := &node[T]{}
    q := &Queue[T]{}
    q.head.Store(sentinel)
    q.tail.Store(sentinel)
    return q
}

func (q *Queue[T]) Enqueue(v T) {
    n := &node[T]{value: v}
    for {
        tail := q.tail.Load()
        next := tail.next.Load()
        if tail != q.tail.Load() {
            continue
        }
        if next != nil {
            // Tail was lagging; help advance it and retry.
            q.tail.CompareAndSwap(tail, next)
            continue
        }
        if tail.next.CompareAndSwap(nil, n) {
            // Link succeeded; try to swing tail to the new node.
            q.tail.CompareAndSwap(tail, n)
            return
        }
    }
}

func (q *Queue[T]) Dequeue() (T, bool) {
    var zero T
    for {
        head := q.head.Load()
        tail := q.tail.Load()
        next := head.next.Load()
        if head != q.head.Load() {
            continue
        }
        if head == tail {
            if next == nil {
                return zero, false
            }
            // Tail was lagging; help advance it.
            q.tail.CompareAndSwap(tail, next)
            continue
        }
        if q.head.CompareAndSwap(head, next) {
            return next.value, true
        }
    }
}
```

### What is going on

The queue maintains a sentinel head (so the empty-queue case is uniform) and two atomic pointers. Enqueue installs a new tail in two CAS steps: first link it after the current tail's `next`, then swing `tail` to it. The second step can be done by any thread (this is the "helping" trick), so a slow enqueuer cannot indefinitely leave the queue in a half-installed state.

### Why this is lock-free, not wait-free

For the same reason as the Treiber stack: under contention, an individual thread can retry its CAS forever. The system-wide progress is guaranteed (every retry implies someone else succeeded) but no per-thread bound exists.

### Where the design earns its keep

The "help advance tail" step is the bridge between lock-free correctness and observable performance. Without it, a thread that succeeds on the first CAS (linking) but gets paused before the second (swinging tail) would force every subsequent enqueuer to spin. With the help step, the next enqueuer simply finishes the job and proceeds.

### Cost

Each enqueue costs at least two CAS in the no-contention case (link, then swing). Each dequeue costs one CAS. Under contention the CAS-retry rate dominates everything.

---

## Why a Wait-Free Queue is Hard

The Michael-Scott queue is lock-free; making it wait-free is significantly harder. The difficulty comes from three converging requirements.

### Requirement 1: bounded retries

A wait-free design cannot tolerate "retry forever." Every loop must have a static maximum iteration count, ideally `O(1)` or `O(N)` where `N` is the number of threads. This rules out the open-ended CAS retry pattern that drives both stacks and queues above.

### Requirement 2: help propagation

If thread T1 cannot retry forever, then *some other thread* must be obligated to complete T1's operation eventually. This is the "helping" pattern: T1 publishes a description of what it wants to do, and any thread that observes the publication is responsible for finishing it (or for finishing some prefix of pending operations and moving the work forward).

### Requirement 3: bounded helper work

If every thread always helps every pending operation, the per-operation cost grows linearly with the number of pending operations, which can grow without bound. Real designs carefully bound the number of operations a single thread helps with, often using a per-thread "phase" or "round" counter to ensure fairness.

### Why two CAS are not enough

The lock-free queue uses two CAS per enqueue: link, then swing. A wait-free queue typically uses *at least* a CAS to install an operation descriptor, a CAS to claim a sequence number, a CAS to write the value, and a CAS to advance the tail — and each one can fail, forcing additional retries that the design must structurally bound.

The result is that a wait-free queue typically performs 4-10x more memory operations per enqueue than the Michael-Scott queue, and that gap shows up directly in throughput.

---

## Kogan-Petrank — A First Look

Alex Kogan and Erez Petrank published the reference wait-free MPMC queue at PPoPP 2011. The full algorithm runs to several pages of pseudocode; here we sketch only the structure.

### Operation descriptors

Each thread maintains a slot in a per-thread "announcement array." When thread T wants to enqueue a value `v`, it does not directly touch the queue. It writes an *operation descriptor* — `{op: enqueue, value: v, phase: P}` — into its announcement slot.

### Phase numbering

A monotonically increasing phase counter ensures fairness. Every thread that arrives bumps the phase counter and reads its own phase. Any other thread that sees an *announced* descriptor with a phase number less than its own current phase is obliged to help complete it.

### Help-on-arrival

When thread T2 wants to do its own operation, it first scans the announcement array for any pending operation with phase number less than T2's current phase. T2 must complete each such pending operation before doing its own. Because phases are monotonic and there is a fixed maximum number of threads `N`, the number of operations T2 must help with on any single arrival is bounded by `N`. That bound is the wait-free property.

### Actual queue operations

The queue itself is similar to a Michael-Scott queue, but each operation is replayed via the descriptors. The value is committed by a CAS that simultaneously installs the new tail and marks the descriptor "done."

### Cost in practice

Even after years of refinement, Kogan-Petrank style queues perform around 30-50% the throughput of Michael-Scott under low-to-moderate contention. Under extreme contention with adversarial scheduling, Kogan-Petrank's worst-case tail latency is dramatically better; under realistic contention with the Go scheduler, mutex or Michael-Scott usually wins.

### A skeleton of the announcement table

```go
type op[T any] struct {
    enqueue bool
    value   T
    phase   uint64
    done    atomic.Bool
}

type announce[T any] struct {
    slot atomic.Pointer[op[T]]
}

type WaitFreeQueue[T any] struct {
    table []announce[T]
    phase atomic.Uint64
    // ... plus the underlying lock-free queue ...
}
```

We do not implement the full algorithm here; the Kogan-Petrank paper is the place to read it. The point at middle level is the *shape*: an announcement table, a phase counter, a help loop bounded by `N`, and an underlying lock-free queue that the helpers manipulate on each others' behalf.

---

## Helping Mechanisms

"Helping" is the structural ingredient that turns a lock-free design into a wait-free one. The pattern shows up in essentially every wait-free algorithm.

### The contract

Each operation is *announced* before it is performed. Any thread can finish any announced operation by reading its description, executing it on the underlying data structure, and marking the announcement complete.

### The trade-offs

Helping has three costs.

First, *every* operation reads the entire announcement table on entry. The table is `O(N)` in size, so each operation pays `O(N)` cache traffic on entry, regardless of whether anyone needed help.

Second, when a thread does help, it spends real time on someone else's work instead of its own. The throughput hit is direct.

Third, descriptors must be allocated, freed, and managed. In Go the GC simplifies reclamation; in C/C++ a per-thread pool is typical.

### A toy example: wait-free counter with helping

To make the pattern concrete, here is a *toy* wait-free counter that uses announcements. This is not a practical design — `atomic.Add` is already wait-free and far faster — but the structure mirrors a real wait-free algorithm.

```go
package waitfree

import (
    "sync/atomic"
)

type req struct {
    delta int64
    done  atomic.Bool
    out   atomic.Int64 // result observed
}

type Counter struct {
    value atomic.Int64
    slots [16]atomic.Pointer[req]
}

func (c *Counter) Add(delta int64, slot int) int64 {
    r := &req{delta: delta}
    c.slots[slot].Store(r)

    // Help: scan all slots, advance any pending request once.
    for i := 0; i < len(c.slots); i++ {
        other := c.slots[i].Load()
        if other == nil || other.done.Load() {
            continue
        }
        for {
            old := c.value.Load()
            if c.value.CompareAndSwap(old, old+other.delta) {
                other.out.Store(old + other.delta)
                other.done.Store(true)
                break
            }
            // If someone else completed it in the meantime, stop.
            if other.done.Load() {
                break
            }
        }
    }

    return r.out.Load()
}
```

This sketch is *not* wait-free in the formal sense — the inner CAS loop can fail twice in a row, and we have not proven the bound — but the *shape* matches Kogan-Petrank. Each call announces, helps, and reads back. The cost per call is `O(N)` where `N = len(c.slots)`, even with zero contention. That is why nobody writes a wait-free counter; `atomic.Add` is wait-free and `O(1)`.

The lesson: helping is the price of wait-freedom. It is rarely worth paying.

---

## Contention Analysis

When you choose between mutex, lock-free, and wait-free, contention is the variable that matters most. Three regimes are worth distinguishing.

### Regime 1: low contention

One or two threads, or many threads touching different locations. The mutex's uncontended `Lock` is two atomic operations (CAS-acquire, store-release); the lock-free CAS loop is one CAS per success; the wait-free `atomic.Add` is one instruction. Differences are nanoseconds. Pick the simplest tool — usually the mutex.

### Regime 2: moderate contention

Many threads hitting the same hot spot, but not in lockstep. The mutex spends time bouncing the lock cache line and parking goroutines. The lock-free CAS loop sees occasional retries — typical retry rate 1-3 per success. The wait-free `atomic.Add` continues to be one instruction.

For a counter, wait-free wins. For a queue, the lock-free Michael-Scott and the mutex-protected queue are usually within 20% of each other, with the lock-free version winning under multi-producer load.

### Regime 3: extreme contention

Dozens of cores hammering the same atomic. Cache-line bouncing dominates everything. The mutex's queue grows; goroutines park and unpark. The lock-free CAS loop's retry rate spikes — five, ten, twenty retries per success. The wait-free counter still runs in one instruction per call, but the cache line is now bouncing constantly, so the *aggregate* throughput plateaus.

At this scale, *sharding* (per-CPU counters that are summed at read) beats everything, and the right question is "can I eliminate the contention?" rather than "what is the strongest progress guarantee?"

### Visualising the regimes

```
Throughput
  ^
  |
  | wait-free Add  ====+
  |                    \
  | lock-free CAS     ==+\
  |                       \
  | mutex              ====+
  |                         \
  +--------------------------+--> Threads / contention
                          (saturation)
```

The interesting observation is that the *rank order* depends on the operation. For a counter, wait-free Add is fastest across all regimes. For a queue, lock-free MS often beats mutex at moderate contention but loses to it at extreme contention because the retry rate explodes. The "wait-free queue" line typically sits *below* both, paying its helping cost as constant overhead.

---

## Benchmark Methodology

A benchmark that distinguishes progress classes must do three things.

### 1. Vary contention

Run with `GOMAXPROCS` set to 1, 2, 4, 8, and the host's core count. Run with `-cpu=1,2,4,8`. A single-thread benchmark cannot tell you anything about the lock-free / wait-free gap.

```go
func BenchmarkAdd(b *testing.B) {
    var n atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            n.Add(1)
        }
    })
}
```

`b.RunParallel` is the right primitive: it spreads iterations across `GOMAXPROCS` goroutines and tells you operations per second per core.

### 2. Measure tail latency, not just throughput

Lock-free and wait-free differ most in their *tail* — the slowest 1% or 0.1% of operations. Throughput alone hides this.

```go
type LatencyHistogram struct {
    buckets [64]atomic.Int64
}

func (h *LatencyHistogram) Record(d time.Duration) {
    bucket := bits.Len64(uint64(d.Nanoseconds())) // log2 bucket
    if bucket >= len(h.buckets) {
        bucket = len(h.buckets) - 1
    }
    h.buckets[bucket].Add(1)
}
```

A simple log-bucketed histogram is enough to see the difference. Wait-free's p99 looks like its p50; lock-free's p99 is often 10-100x its p50 under contention.

### 3. Stress with an adversarial pattern

A uniformly random arrival pattern does not stress lock-free's starvation property. To see starvation, you need a *biased* schedule — one or two "slow" goroutines that lose CAS races to "fast" ones. The harness must measure per-goroutine completion counts, not just aggregate throughput.

```go
type Counts struct {
    perGoroutine []atomic.Int64
}
```

Compare the min, max, and median completion counts after a fixed duration. A wait-free algorithm produces a flat distribution. A lock-free algorithm under bias can produce a long-tailed distribution.

---

## Trade-off Tables

### Simplicity vs progress vs speed

| Property | Mutex | Lock-free | Wait-free |
|----------|-------|-----------|-----------|
| Lines of code to implement | 1-5 | 10-30 | 100-500 |
| Correctness reasoning | Easy | Moderate | Hard |
| Avg latency, low contention | Fast | Fast | Fast |
| Avg latency, high contention | Slow | Medium | Medium |
| p99 latency, high contention | Very slow | Slow | Medium |
| Survives thread suspension | No | Yes | Yes |
| Per-thread starvation possible | Yes (waiters) | Yes | No |
| Bounded worst-case steps | No | No | Yes |
| Right for hard real-time | No | Sometimes | Yes |
| Right for typical app code | Yes | Sometimes | Almost never |

### "What does this gain you over the rung below?"

| Step up | Buys you | Costs you |
|---------|----------|-----------|
| Blocking → obstruction-free | Solo threads complete; thread suspension does not freeze. | Livelock possible under contention. |
| Obstruction-free → lock-free | Some thread always progresses under any schedule. | Implementation complexity; still allows per-thread starvation. |
| Lock-free → wait-free | Every thread bounded; no starvation. | Helping mechanism overhead; 2-10x slower steady-state. |

### Decision flow

```
Is this hard real-time / safety-critical?
  yes -> wait-free or shard-and-aggregate
  no  -> Is this a single read-modify-write (Add, Swap, Load, Store)?
          yes -> use the wait-free atomic directly
          no  -> Is contention high enough that mutex is a bottleneck?
                  yes -> consider lock-free (MS queue, Treiber stack, etc.)
                  no  -> use a mutex
```

In practice, almost every decision lands on "use a mutex" or "use `atomic.Add`." Lock-free data structures are an optimisation for a real, measured bottleneck. Wait-free is reserved for cases where the worst-case latency bound is part of the SLA.

---

## Where Go Constructs Sit, Revisited

The junior file gave a high-level table. Here we annotate it with *why* each construct sits where it does.

| Construct | Class | Mechanism |
|-----------|-------|-----------|
| `atomic.AddInt64` | Wait-free | `LOCK XADD` on x86; LDADD on ARMv8.1; one instruction. |
| `atomic.CompareAndSwapInt64` (single call) | Wait-free | One `LOCK CMPXCHG`. Caller may interpret success or failure. |
| CAS loop | Lock-free | Repeats the wait-free primitive; loop body can fail unboundedly. |
| `sync.Mutex` | Blocking | Fast path is a single CAS (wait-free), but acquire-when-held parks the goroutine. |
| `sync.RWMutex` | Blocking | RLock/RUnlock are atomic increments on the reader count, but writer-wait is blocking. |
| `sync.Map.Load` (hot key) | Wait-free in steady state | A single atomic read from the read-only map. |
| `sync.Map.Load` (miss) | Blocking | Falls back to the mutex-protected dirty map. |
| `sync.Map.Store` (new key) | Blocking | Promotes the key into the dirty map under the mutex. |
| `sync.Pool.Get` (per-P) | Lock-free | Stack of recycled values per P, manipulated with `runtime_procPin`. |
| `sync.Pool.Get` (steal) | Lock-free with a mutex slow path | Cross-P stealing under a mutex. |
| `sync.Once.Do` (first call) | Blocking | A mutex ensures the init function runs exactly once. |
| `sync.Once.Do` (subsequent) | Wait-free | A single atomic load sees "done." |
| Channel send (buffered, room) | Lock-free in fast path; mutex under contention | The buffer is protected by a mutex, but uncontended sends often go through a fast path. |
| Channel send (full or unbuffered) | Blocking | The sender parks until a receiver arrives. |
| `sync.WaitGroup.Add` / `Done` | Wait-free | One atomic Add. |
| `sync.WaitGroup.Wait` | Blocking | Parks on a semaphore until the counter is zero. |
| `sync.Cond.Wait` | Blocking | Releases the mutex and parks on the cond variable. |

### Reading the Go source

You can verify each of these claims by reading the Go standard library source. `sync/mutex.go` shows the fast-path CAS and the slow-path park. `sync/map.go` shows the read-only / dirty split. `sync/once.go` shows the load-then-mutex idiom. The exercise of reading the source with the hierarchy in mind is one of the best ways to internalise the distinctions.

---

## Practical Heuristics

### Heuristic 1: name the rung in your code comments

Every concurrent type you write should have a one-line comment near its declaration stating the progress class.

```go
// RequestCounter is a wait-free per-endpoint counter. Read and increment
// are both wait-free (single atomic op). Reset takes a mutex.
type RequestCounter struct { ... }
```

This forces you to decide *and* documents the decision for reviewers. Mixed-class types are common and acceptable; ambiguity is not.

### Heuristic 2: prefer single atomic ops over CAS loops

If you can express the operation as `Add`, `Swap`, `Load`, `Store`, or a single `CompareAndSwap` call, do so. Each of these is wait-free per call. A CAS loop is one step down the hierarchy and almost always slower than the dedicated primitive for the same operation.

### Heuristic 3: bound your CAS loops if latency matters

For latency-sensitive code, an unbounded CAS loop is a liability. Cap the retry count and fall back to a slower path (mutex, return error, yield):

```go
const maxRetries = 8
for i := 0; i < maxRetries; i++ {
    old := slot.Load()
    if slot.CompareAndSwap(old, transform(old)) {
        return nil
    }
}
return errContended
```

This is not formally wait-free, but it is *bounded*, which is what real systems actually need.

### Heuristic 4: do not build wait-free when sharding will do

The trick of using `N` per-CPU counters that you sum on read is often a better answer than a wait-free single counter. Sharding eliminates contention rather than tolerating it. The result is faster and easier to reason about than any helping scheme.

### Heuristic 5: distrust "wait-free" claims without a bound

If a library claims wait-free, look for the integer `B` in the documentation. If you cannot find it, the claim is suspect. A real wait-free algorithm always cites the bound — typically `O(N)` or `O(log N)` in the number of threads.

---

## Common Mistakes at This Level

1. *Implementing a "wait-free" queue with a CAS loop in the body.* The loop makes it lock-free at best. To be wait-free you need helping and bounded retries.
2. *Comparing throughput only, ignoring tail latency.* Throughput tests hide the lock-free / wait-free distinction; the gap is in p99 and beyond.
3. *Building a wait-free counter instead of using `atomic.Add`.* The latter is wait-free already and runs at hardware speed.
4. *Sharing the announcement table across unrelated operations.* In a real wait-free design, the table is per-operation-type. Mixing types creates correctness bugs.
5. *Forgetting that helping costs cache traffic.* Even an idle wait-free algorithm pays `O(N)` cache reads per call to scan the table.
6. *Treating Go's GC as a substitute for an epoch-based reclamation scheme inside helping logic.* GC handles unreachable nodes, but it does not coordinate the *help is done* signal — you still need atomic flags.

---

## Self-Assessment

- [ ] I can sketch a Treiber stack from memory and explain why it is lock-free, not wait-free.
- [ ] I can sketch a Michael-Scott queue from memory and identify the helping step.
- [ ] I can explain why a wait-free queue requires helping and bounded retries.
- [ ] I can describe the Kogan-Petrank announcement-and-phase pattern in three sentences.
- [ ] I know that helping costs `O(N)` cache traffic per call.
- [ ] I know that under realistic Go contention, mutex or lock-free almost always wins on throughput.
- [ ] I can design a benchmark that distinguishes lock-free from wait-free using tail latency.
- [ ] I can read the `sync.Mutex`, `sync.Map`, and `sync.Once` sources and classify each operation.
- [ ] I know when sharding is a better answer than any non-blocking algorithm.
- [ ] I do not say "wait-free" when I mean "lock-free" and vice versa.

---

## Summary

The Treiber stack and Michael-Scott queue are the two canonical lock-free data structures. Both rely on CAS loops, and both are lock-free, not wait-free, because their loops can retry without bound. A wait-free queue (Kogan-Petrank, 2011) replaces the unbounded retry with a helping mechanism: every operation announces itself, and every arriving thread helps a bounded number of pending operations before doing its own. The helping bound is what makes the algorithm wait-free; the helping overhead is what makes it slow. In Go, the practical answer is almost always "use `atomic.Add` for simple counters and `sync.Mutex` or a lock-free structure for anything more interesting." Wait-free designs earn their complexity only in hard-real-time, safety-critical, or fault-tolerant contexts, where the bounded worst-case latency is part of the specification rather than a nice-to-have. See Herlihy 1991 *Wait-Free Synchronization* for the original hierarchy and Kogan and Petrank 2011 for the reference wait-free queue.
