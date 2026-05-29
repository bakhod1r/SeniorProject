# Deque — Senior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Thread-Safe Deques](#thread-safe-deques)
3. [Work-Stealing Queues](#work-stealing-queues)
4. [Deques in the Go Scheduler and Tokio Runtime](#deques-in-the-go-scheduler-and-tokio-runtime)
5. [Deque-Backed System Design Patterns](#deque-backed-system-design-patterns)
6. [Capacity Planning](#capacity-planning)
7. [Observability and Metrics](#observability-and-metrics)
8. [Failure Modes](#failure-modes)
9. [Code Examples](#code-examples)
10. [Summary](#summary)

---

## Introduction

At the senior level the question stops being "which deque do I use?" and becomes "how do I deploy a deque in a system that must stay up, scale to many cores, and survive bad inputs?" That puts concurrency, observability, and capacity planning front and centre. The most important production use of deques today is **work-stealing scheduling** — the per-thread runqueues that power the Go scheduler, Tokio, JavaScript's WebWorker pools, Java's ForkJoinPool, and Rust's rayon are all deques. Understanding them is the difference between writing a fast service and writing one that scales.

This page assumes you can already write a single-threaded ring-buffer deque (junior) and reason about implementation tradeoffs (middle). We now move to multithreaded, distributed, and operational concerns.

---

## Thread-Safe Deques

Built-in deques are **not** thread-safe. Mutating a shared `ArrayDeque` or `collections.deque` from two threads at the same time corrupts internal state — head and tail indices race, size becomes wrong, the underlying buffer may end up with overlapping writes. There are four common strategies.

### Strategy 1 — External lock

The simplest correct option. Wrap the deque in a mutex.

```java
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.locks.ReentrantLock;

public class LockedDeque<T> {
    private final Deque<T> dq = new ArrayDeque<>();
    private final ReentrantLock lock = new ReentrantLock();

    public void pushBack(T x) {
        lock.lock();
        try { dq.offerLast(x); } finally { lock.unlock(); }
    }

    public T popFront() {
        lock.lock();
        try { return dq.pollFirst(); } finally { lock.unlock(); }
    }
}
```

Pros: simple, correct, easy to reason about.
Cons: every operation serializes through the lock; throughput is bounded by lock contention. Fine for low-rate use; bottleneck at ~1-2 million ops/sec.

### Strategy 2 — Lock-free deques

Java's `ConcurrentLinkedDeque` is a non-blocking, lock-free deque using CAS on a doubly-linked structure. Reads do not block, and writes contend only at the affected end.

```java
import java.util.concurrent.ConcurrentLinkedDeque;

ConcurrentLinkedDeque<Task> q = new ConcurrentLinkedDeque<>();
q.offerLast(task);          // multiple producers OK
Task t = q.pollFirst();     // multiple consumers OK
```

Properties:
- **Lock-free** push and pop at either end.
- **Weakly consistent iterators** — never throw `ConcurrentModificationException`, may or may not see concurrent updates.
- `size()` is O(n) and non-deterministic under contention. Track size externally if you need it.
- Higher per-element overhead than `ArrayDeque` (doubly-linked, plus CAS metadata).

When to use: multi-producer multi-consumer workloads with moderate contention. The lock-free design wins clearly past 4-8 threads.

### Strategy 3 — Blocking deques

`LinkedBlockingDeque<T>` adds **blocking** put/take semantics: producers wait if the deque is full, consumers wait if it is empty. The capacity is fixed at construction.

```java
import java.util.concurrent.LinkedBlockingDeque;

LinkedBlockingDeque<Job> q = new LinkedBlockingDeque<>(1000);
q.putFirst(urgent);            // blocks if full
Job j = q.takeLast();          // blocks if empty
boolean ok = q.offerLast(j, 100, TimeUnit.MILLISECONDS); // with timeout
```

This is the right primitive when you have **producer-consumer back-pressure**: if downstream cannot keep up, upstream must slow down (or fail fast). It is what most queue-based job systems are actually built on, despite the name "deque" — they only use one end.

### Strategy 4 — Wait-free with single-producer single-consumer

For SPSC (one writer, one reader), you can build a lock-free deque using just two atomic indices (head and tail). No CAS needed — atomic load and atomic store are sufficient because only one thread writes each index. This is the basis of high-frequency-trading and audio-processing pipelines.

```go
// SPSC ring buffer in Go.
type SPSCRing struct {
    buf  []int64
    mask int64
    head atomic.Int64 // written only by reader
    tail atomic.Int64 // written only by writer
}

func (r *SPSCRing) Push(x int64) bool {
    tail := r.tail.Load()
    head := r.head.Load()
    if tail-head >= int64(len(r.buf)) {
        return false // full
    }
    r.buf[tail&r.mask] = x
    r.tail.Store(tail + 1)
    return true
}

func (r *SPSCRing) Pop() (int64, bool) {
    head := r.head.Load()
    tail := r.tail.Load()
    if head == tail {
        return 0, false // empty
    }
    x := r.buf[head&r.mask]
    r.head.Store(head + 1)
    return x, true
}
```

Notes: `len(buf)` is a power of two so `& mask` replaces `% len`. Memory ordering is acquire-release; the explicit `Load`/`Store` on atomics gives that on modern Go.

---

## Work-Stealing Queues

The most important concurrent deque in production. The setup:

```
+----------+   +----------+   +----------+   +----------+
| Worker 1 |   | Worker 2 |   | Worker 3 |   | Worker 4 |
| [J J J ] |   | [    J ] |   | [J J   ] |   | [      ] |
+----------+   +----------+   +----------+   +----------+
   ^owner          ^owner         ^owner         ^owner
   pushes/         pushes/        pushes/        pushes/
   pops at         pops at        pops at        pops at
   one end         one end        one end        one end
                                                    ^
                                            empty queue
                                            steals from
                                            another end
```

Each worker thread owns a deque of tasks. New tasks are pushed at the **bottom** by the owner and popped from the **bottom** by the owner — operations on the same end, like a stack, so they require no synchronisation in the common case. When a worker runs out of work, it picks another worker at random and **steals from the top** of that worker's deque.

The key property: in the common case (no stealing), push and pop are unsynchronised stack operations. Stealing is rare and requires synchronisation. This minimises atomic operations on the hot path.

### Why a deque?

- **Owner pushes/pops one end** -> LIFO locality (recently-created tasks are still in cache).
- **Thieves pop the other end** -> oldest tasks (more likely to be coarse-grained "big" work units, since fine-grained tasks have already been processed by the owner).
- Owner and thieves rarely touch the same end -> minimal contention.

### The Chase-Lev algorithm

Chase-Lev (2005) is the canonical lock-free work-stealing deque. It uses:
- A growable array.
- A `top` index (modified by thieves, with CAS).
- A `bottom` index (modified by the owner only; relaxed atomics).
- A single CAS in the steal path to claim the stolen task.

The owner's operations are nearly lock-free; only the cooperation with thieves needs CAS. We cover formal correctness in **professional.md** — for now, the key takeaway is:

| Op                       | Cost                                |
| ------------------------ | ----------------------------------- |
| Owner push (no race)     | 1 store, 1 fence — almost free      |
| Owner pop (no race)      | 1 store, 1 fence                    |
| Owner pop racing thief   | 1 CAS                               |
| Thief steal              | 1 load + 1 CAS                      |
| Resize (rare)            | Atomic pointer swap of underlying array |

Used in: Java `ForkJoinPool` (slightly modified variant), Go scheduler (a fixed-capacity variant), Rust `rayon`, Tokio, .NET TPL.

---

## Deques in the Go Scheduler and Tokio Runtime

### Go runtime — `runq`

Each Go `P` (processor) has a local run queue of **256 goroutines**, implemented as a **circular array**:

```go
// runtime/runtime2.go (sketched)
type p struct {
    runqhead uint32     // index into runq, updated by owner
    runqtail uint32     // index into runq, updated by owner and stealers
    runq     [256]guintptr
    runnext  guintptr   // 1-slot fast path
    // ...
}
```

- `runqhead`, `runqtail` use power-of-two modular arithmetic on 256.
- Owner pops from `runqhead`. Stealers steal half the queue from `runqtail` side with a CAS.
- `runnext` is a single-slot optimisation: the most recently spawned goroutine goes here first, executed next. Strong LIFO locality.
- Overflow goes to a shared global run queue.

This is a deque tuned for the workload. The local queue is bounded (256) so memory is predictable; stealing happens in batches (half the queue) so the steal cost is amortised; `runnext` exploits the producer-consumer locality of common goroutine patterns.

### Tokio (Rust)

Tokio's multi-threaded runtime uses a per-worker deque, also bounded at **256** by default, with stealing semantics. The implementation is a Chase-Lev variant with additional optimisations:
- Local queue is fixed-capacity for cache predictability.
- Overflow tasks go to a global "injection queue."
- Thieves steal up to half the local queue per attempt to reduce steal frequency.

### Java ForkJoinPool

Each worker has its own `WorkQueue` — a Chase-Lev-derived deque. ForkJoinPool ships with the JVM since Java 7 and is the basis of `parallelStream()`, `CompletableFuture.async`, and `ManagedBlocker`-style work. Tunable via `-Djava.util.concurrent.ForkJoinPool.common.parallelism`.

### JavaScript runtime

V8's microtask queue is a FIFO queue, but the **task pool** that backs `Worker` threads in browser implementations follows the same work-stealing pattern. Node.js's `worker_threads` are not yet work-stealing, but libuv's thread pool is a simple shared queue (not a deque).

---

## Deque-Backed System Design Patterns

### Pattern 1 — Priority + FIFO with two ends

A queue where most jobs are FIFO but some are "urgent" jumps to the front. Without a deque you would need a priority queue and tiebreak on insertion order — heavy. With a deque, `urgent.offer = pushFront`, `normal.offer = pushBack`. Single dequeue takes from front.

This is what task systems like Sidekiq, Celery, and BullMQ implement for "high-priority jobs": they keep a separate priority queue alongside the main queue. A deque is the simpler version when you have exactly two priority levels.

### Pattern 2 — Recent activity feeds

User feeds typically show "recent activity, newest first, bounded to N items." A `deque(maxlen=N)` per user (in-memory) or a Redis list with `LPUSH` + `LTRIM` (distributed) gives O(1) insert and O(N) display with no manual eviction logic.

### Pattern 3 — Rate-limited event stream

Sliding-window rate limiters keep a deque of timestamps for the events within the last window. On a new event:
1. Pop from the front while front-timestamp is older than `now - windowSize`.
2. Push current timestamp to back.
3. If `size > limit`, reject.

The deque shape makes both ends mutate constantly without ever touching the middle.

### Pattern 4 — Browser-history-style navigation

Back/forward navigation in a SPA. Two deques: `backStack` and `forwardStack`. Clicking back: `forwardStack.push(currentPage); currentPage = backStack.pop()`. Clicking forward: mirror. Bounded with `maxlen` to cap memory.

### Pattern 5 — Distributed work distribution

For a distributed system you usually do not use a true deque — instead you use a message queue (Kafka, SQS, RabbitMQ) with shard-aware consumers. But the *pattern* is the same: producers write to one end, multiple consumer groups read from the other, and the broker enforces ordering and at-least-once delivery. Mentally model your message queue as a distributed deque with one direction disabled.

---

## Capacity Planning

For each deque in your system, ask:

1. **What is the steady-state size?** Average over a week of typical traffic.
2. **What is the peak size?** Burst plus all queued work during an outage of the consumer.
3. **What is the size per element?** Pointer + payload, accounting for boxing.
4. **What is the memory budget?** Service heap minus everything else.
5. **What is the overflow policy?** Block producer, drop oldest, drop newest, spill to disk, scale up consumers?

A worked example. A request-coalescing deque (one per shard) holds in-flight HTTP request structs.

- Steady-state: 100 requests/shard.
- Peak: 5000 requests/shard during downstream incidents.
- Element size: ~2 KB per request struct.
- Number of shards: 64 per process.
- Memory budget: 8 GB heap.

`peak * elementSize * shards = 5000 * 2 KB * 64 = 640 MB`. That is 8% of the heap — acceptable. If the calculation came out at 4 GB you would need to either reduce per-element size, scale shards more aggressively, or add a hard cap with `LinkedBlockingDeque` and let requests fail fast.

A common production failure pattern: **unbounded deques in front of slow consumers**. The deque grows until the heap is exhausted, the GC starts thrashing, the service crashes. Always cap.

---

## Observability and Metrics

For each significant deque in production:

| Metric                                  | What it tells you                              | Alert threshold        |
| --------------------------------------- | ---------------------------------------------- | ---------------------- |
| `deque_size`                            | Current depth                                  | > 80% of capacity      |
| `deque_capacity`                        | Allocated slots                                | n/a (reference)        |
| `deque_push_rate{end="front|back"}`     | Producer pressure                              | > 1.5x consumer rate   |
| `deque_pop_rate{end="front|back"}`      | Consumer throughput                            | < expected SLO         |
| `deque_wait_time_ms`                    | How long an element sat before being dequeued  | p99 > SLO              |
| `deque_drop_count`                      | Items dropped due to bound (maxlen)            | rate > 0 for > 1m      |
| `deque_block_time_ms`                   | Time producers blocked on full deque           | p99 > 100 ms           |
| `deque_steal_rate` (work-stealing only) | Stealing frequency                             | high = poor work locality |
| `deque_resize_count`                    | How often the backing array grew               | per-process > 10 / hr  |

Two things especially worth alerting on: **drop_count > 0** (data is being lost) and **wait_time_ms p99 trending up** (we are about to fall over).

Tools: Prometheus + Grafana for the metrics, OpenTelemetry traces tied to individual elements for the lifetime of "how long did this request sit in the deque before being served?"

---

## Failure Modes

### Failure 1 — Slow consumer, unbounded producer

Classic. The consumer slows down (downstream dependency degraded, GC pause, deploy in progress) but the producer keeps pushing. The deque grows without bound until the heap is exhausted.

**Mitigation:** always cap. Use a bounded deque with a clear overflow policy. The choice between block, drop, and fail-fast depends on whether the upstream can tolerate latency or whether dropped requests are acceptable.

### Failure 2 — Hot deque

In a sharded system, one deque receives a disproportionate share of traffic — usually because the sharding key is skewed (user_id when a few users generate most events, or geo when most traffic is from one region).

**Mitigation:** shard on a higher-cardinality key, add a hash mix step, or use power-of-two-choices (each producer picks two random shards and pushes to whichever is shorter).

### Failure 3 — Stale tasks in work-stealing queues

A worker thread can park with non-empty local queue (e.g. blocking on I/O outside the scheduler). Other workers see the global "no work" signal even though work is sitting in the parked queue.

**Mitigation:** detect parked workers and rebalance their queues. Both Go's runtime and Tokio do this. If you build your own work-stealer, copy the pattern.

### Failure 4 — ABA in lock-free deques

The classical concurrency hazard. A CAS on a deque slot can succeed even though the slot was popped and re-pushed with a different value, leaving the deque in an inconsistent state.

**Mitigation:** use generation counters (tag the pointer or index with a version that increments on every change). Chase-Lev handles this with the `top` index increasing monotonically.

### Failure 5 — Iterator-corruption-from-mutation

Snapshotting a deque for observability (e.g. dumping the queue contents to a metric) while it is being mutated. Java's `ArrayDeque.iterator()` throws `ConcurrentModificationException`. Production code copies first.

**Mitigation:** snapshot with `new ArrayList<>(deque)` under a lock, then iterate the copy.

---

## Code Examples

### A bounded, observable, lock-protected deque in Go

```go
package boundeddeque

import (
    "errors"
    "sync"
    "time"
)

var ErrFull = errors.New("deque full")

// BoundedDeque is a thread-safe, bounded ring-buffer deque with observability.
type BoundedDeque[T any] struct {
    mu        sync.Mutex
    buf       []T
    head      int
    size      int
    capacity  int

    // observability
    pushCount uint64
    popCount  uint64
    dropCount uint64
}

func New[T any](capacity int) *BoundedDeque[T] {
    return &BoundedDeque[T]{
        buf:      make([]T, capacity),
        capacity: capacity,
    }
}

// PushBack returns ErrFull if the deque is at capacity (does not block).
func (d *BoundedDeque[T]) PushBack(x T) error {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.size == d.capacity {
        d.dropCount++
        return ErrFull
    }
    tail := (d.head + d.size) % d.capacity
    d.buf[tail] = x
    d.size++
    d.pushCount++
    return nil
}

// PopFrontWithDeadline blocks up to wait for an element to become available.
func (d *BoundedDeque[T]) PopFront() (T, bool) {
    d.mu.Lock()
    defer d.mu.Unlock()
    var zero T
    if d.size == 0 {
        return zero, false
    }
    x := d.buf[d.head]
    d.buf[d.head] = zero
    d.head = (d.head + 1) % d.capacity
    d.size--
    d.popCount++
    return x, true
}

// Stats returns a snapshot of metrics for observability.
func (d *BoundedDeque[T]) Stats() (size, capacity int, pushes, pops, drops uint64) {
    d.mu.Lock()
    defer d.mu.Unlock()
    return d.size, d.capacity, d.pushCount, d.popCount, d.dropCount
}

// Helper: wait until a value is available, with a deadline.
func (d *BoundedDeque[T]) PopFrontTimeout(timeout time.Duration) (T, bool) {
    deadline := time.Now().Add(timeout)
    for {
        if x, ok := d.PopFront(); ok {
            return x, true
        }
        if time.Now().After(deadline) {
            var zero T
            return zero, false
        }
        time.Sleep(time.Millisecond)
    }
}
```

This is the right shape for most production deques: bounded, lock-protected, fail-fast on overflow, with stats exposed for monitoring.

### Thread-safe deque using `ConcurrentLinkedDeque` in Java

```java
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.atomic.AtomicLong;

public class ObservedDeque<T> {
    private final ConcurrentLinkedDeque<T> dq = new ConcurrentLinkedDeque<>();
    private final AtomicLong pushes = new AtomicLong();
    private final AtomicLong pops = new AtomicLong();
    private final AtomicLong currentSize = new AtomicLong();
    private final long capacity;

    public ObservedDeque(long capacity) { this.capacity = capacity; }

    public boolean pushBack(T x) {
        // Soft cap — best-effort, may slightly overshoot under contention.
        if (currentSize.get() >= capacity) return false;
        dq.offerLast(x);
        currentSize.incrementAndGet();
        pushes.incrementAndGet();
        return true;
    }

    public T popFront() {
        T x = dq.pollFirst();
        if (x != null) {
            currentSize.decrementAndGet();
            pops.incrementAndGet();
        }
        return x;
    }

    public long size()    { return currentSize.get(); }
    public long pushes()  { return pushes.get(); }
    public long pops()    { return pops.get(); }
}
```

### Asyncio-aware deque in Python

```python
import asyncio
from collections import deque

class AsyncBoundedDeque:
    """Async deque with put/get semantics and bounded capacity."""

    def __init__(self, capacity: int):
        self._dq: deque = deque(maxlen=None)  # no auto-eviction; we enforce manually
        self._capacity = capacity
        self._not_full = asyncio.Condition()
        self._not_empty = asyncio.Condition()

    async def push_back(self, x) -> None:
        async with self._not_full:
            while len(self._dq) >= self._capacity:
                await self._not_full.wait()
            self._dq.append(x)
            async with self._not_empty:
                self._not_empty.notify()

    async def pop_front(self):
        async with self._not_empty:
            while not self._dq:
                await self._not_empty.wait()
            x = self._dq.popleft()
            async with self._not_full:
                self._not_full.notify()
            return x

    def size(self) -> int:
        return len(self._dq)
```

For pure asyncio code this is the right shape — producer coroutines `await deque.push_back(x)`, consumer coroutines `await deque.pop_front()`, no thread-level locking needed since asyncio is single-threaded.

---

## Summary

| Concern                      | Senior-level answer                                                    |
| ---------------------------- | ---------------------------------------------------------------------- |
| **Thread safety**            | Pick a strategy: external lock, lock-free (`ConcurrentLinkedDeque`), blocking (`LinkedBlockingDeque`), or SPSC wait-free |
| **Work-stealing**            | Chase-Lev deque per worker — owner pushes/pops one end, thieves steal from the other |
| **Production runtimes**      | Go scheduler runq (256-slot ring), Tokio worker queues, Java ForkJoinPool |
| **Bounded deques**           | Mandatory for memory predictability — never deploy an unbounded deque under a slow consumer |
| **Observability**            | Size, push/pop rate, wait time, drop count, block time, steal rate     |
| **Failure modes**            | Slow consumer, hot shard, parked workers, ABA hazard, iterator corruption |
| **System patterns**          | Priority + FIFO via two ends, recent activity, sliding-window rate limit, browser history, feed |
| **Distributed analog**       | Message queues are conceptually distributed deques with one direction disabled |

At senior level the deque stops being a data structure and becomes a system component — with all the operational concerns that implies. Move to **professional.md** for the formal analysis behind Chase-Lev, amortised growth, and lower bounds for concurrent deque operations.
