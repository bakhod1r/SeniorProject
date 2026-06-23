# Producer–Consumer — Optimization Walkthroughs

> Ten before/after optimizations for the **Producer–Consumer** pattern, from amortizing downstream cost to going lock-free. Each shows the problem, the fix, *why* it works, and the trade-off you accept. Measure before you adopt — none of these is free. See [Junior](junior.md) · [Middle](middle.md) · [Senior](senior.md) · [Professional](professional.md).

---

## Table of Contents

1. [Batch the Consumer with `drainTo`](#opt-1)
2. [Split One Lock into Two Conditions](#opt-2)
3. [`notify` Targeting: `signal` over `signalAll`](#opt-3)
4. [Right-Size the Consumer Pool](#opt-4)
5. [Process Outside the Lock](#opt-5)
6. [Pre-Size / Pre-Allocate the Buffer](#opt-6)
7. [Drop the Two-Lock Queue's GC Churn](#opt-7)
8. [Partition for Parallelism + Ordering](#opt-8)
9. [Go Lock-Free Ring Buffer (Disruptor-style)](#opt-9)
10. [Eliminate False Sharing with Padding](#opt-10)
11. [Optimization Tips](#optimization-tips)

---

## Opt 1 — Batch the Consumer with `drainTo`

**Before:** consumer flushes each item to the DB individually.
```java
while (true) { Row r = q.take(); db.insert(r); }   // one round-trip per row
```
**Problem:** A fixed cost (network round-trip + fsync, ~5 ms) is paid *per item*. Throughput is capped at ~200 rows/s no matter how fast the producer runs.
**After:**
```java
List<Row> batch = new ArrayList<>(256);
while (true) {
    batch.add(q.take());          // block for at least one
    q.drainTo(batch, 255);        // grab whatever else is ready
    db.insertBatch(batch);        // one round-trip per ~256 rows
    batch.clear();
}
```
**Why:** The fixed per-call cost is amortized across the batch — ~256 rows per 5 ms ≈ 51,000/s, a 250× jump.
**Trade-off:** Slightly higher per-item latency (an item may wait for the batch to fill) and partial-failure handling gets more complex. This is the single highest-leverage optimization in the whole pattern.

---

## Opt 2 — Split One Lock into Two Conditions

**Before:** single monitor, `notifyAll` wakes producers *and* consumers.
**Problem:** `notifyAll` causes a thundering herd — every waiter wakes, contends on the one lock, and most re-check their `while` and go back to sleep. Wasted wakeups scale with queue depth.
**After:** `ReentrantLock` with separate `notFull` and `notEmpty` `Condition`s.
**Why:** You signal only the side that can make progress. Producers wait on `notFull`, consumers on `notEmpty`; a `put` signals `notEmpty` only. No cross-wakeups.
**Trade-off:** More code than `synchronized`; you must `unlock()` in `finally`. This *is* how `ArrayBlockingQueue` is built — usually you just use it.

---

## Opt 3 — `notify` Targeting: `signal` over `signalAll`

**Before:** `notEmpty.signalAll()` after each `put`.
**Problem:** With separate conditions, *every* waiter on a condition can proceed once one slot changes — but only *one* item was added, so waking all consumers means N−1 wake, find nothing, re-sleep.
**After:** `notEmpty.signal()` — wake exactly one.
**Why:** One `put` produces capacity for exactly one `take`; waking one consumer is sufficient and correct. Wakeup cost drops from O(waiters) to O(1) per operation.
**Trade-off:** Correct *only* with the two-condition design (Opt 2) where every waiter on a condition is genuinely unblockable. With one mixed monitor you must still use `notifyAll`.

---

## Opt 4 — Right-Size the Consumer Pool

**Before:** 4 consumers for an I/O-bound workload on a 16-core box; queue perpetually full, latency climbing.
**Problem:** Consumers spend most of their time blocked on I/O, so 4 threads underutilize the machine; the queue saturates and items wait.
**After:** Size by Little's Law — `concurrency = throughput × latency`. For I/O-bound work that's far more than core count (e.g., 64 consumers); for CPU-bound, ≈ cores.
**Why:** Matching consumer concurrency to the workload empties the queue at the rate producers fill it, holding latency flat.
**Trade-off:** Too many threads → context-switch overhead and memory; too few → backpressure stalls producers. Tune against measured queue depth, don't guess.

---

## Opt 5 — Process Outside the Lock

**Before:** `process(item)` runs inside the consumer's critical section.
**Problem:** The lock serializes all consumers to single-threaded throughput, and producers block longer because the lock is held during slow processing.
**After:** Dequeue under the lock, release, then process: `T x = q.take(); process(x);`.
**Why:** The lock now protects only the tiny enqueue/dequeue, not the slow work. N consumers process in true parallel.
**Trade-off:** None, really — this is a strict win. (`BlockingQueue.take()` already does the right thing; the bug only appears in hand-rolled "take-and-process under lock" code.)

---

## Opt 6 — Pre-Size / Pre-Allocate the Buffer

**Before:** `LinkedBlockingQueue` growing node-by-node.
**Problem:** A `Node` allocation per item → constant minor-GC pressure → latency-tail jitter from GC pauses.
**After:** `ArrayBlockingQueue` with a fixed capacity allocated once at construction.
**Why:** Zero per-item allocation; memory is flat and predictable; the GC has nothing to collect on the hot path, tightening p99.9.
**Trade-off:** A single shared lock (vs the linked queue's two), so under *very* high mixed contention the linked queue may out-throughput it. Choose array for tail-latency, linked for raw throughput under balanced load.

---

## Opt 7 — Drop the Two-Lock Queue's GC Churn

**Before:** high-throughput service on `LinkedBlockingQueue`; profiler shows 30% time in GC.
**Problem:** Node allocation at millions of items/sec overwhelms the young generation, triggering frequent GC and pauses that wreck the latency tail.
**After:** Move to an array-backed bounded queue, or a pre-allocated ring of reusable slots.
**Why:** Reusing pre-allocated slots produces zero steady-state garbage — the GC effectively stops running on this path.
**Trade-off:** Fixed memory footprint regardless of load; reusable slots require careful "clear on consume" to avoid leaking references (or, in a ring, holding object refs alive). Worth it only when GC is a proven bottleneck.

---

## Opt 8 — Partition for Parallelism + Ordering

**Before:** one queue, many consumers, but you need per-key ordering — so you're stuck with a single consumer.
**Problem:** A single consumer can't keep up; multiple consumers reorder events for the same key.
**After:** Partition by key: `partition = hash(key) % N`; N queues, one consumer each.
**Why:** Each key always lands on the same consumer → per-key order preserved; N consumers run in parallel → throughput scales. (Exactly how Kafka partitions work.)
**Trade-off:** Global ordering is lost (usually fine); hot keys can skew load across partitions; resizing N requires rehashing. Per-key ordering with parallelism is the sweet spot for event processing.

---

## Opt 9 — Go Lock-Free Ring Buffer (Disruptor-style)

**Before:** Go channel hitting its throughput ceiling on an ultra-hot path (millions/sec).
**Problem:** Channels involve runtime locking and goroutine park/unpark; at extreme rates the scheduling overhead dominates.
**After:** A pre-allocated ring buffer with atomic sequence counters (SPSC/MPSC lock-free), busy-spinning consumers on the hot path.
**Why:** No locks, no park/unpark, no allocation; contiguous memory prefetches well. This is the Disruptor philosophy — throughput jumps an order of magnitude with a tight tail.
**Trade-off:** Busy-spin burns a core; the code is far more complex and easy to get subtly wrong; you lose Go's `select`/`range`/`close` ergonomics. Justify it with a profile, not a hunch — for 99% of services, channels are correct.

---

## Opt 10 — Eliminate False Sharing with Padding

**Before:** producer's `tail` and consumer's `head` counters land on the same 64-byte cache line.
**Problem:** Every `tail` write invalidates the cache line the consumer needs for `head` (and vice versa). The line ping-pongs between cores on the coherence bus — throughput collapses even though the values are logically independent.
**After:** Pad each counter so it owns its own cache line (`@Contended` in modern JDK, or manual long-padding; in the Disruptor's `Sequence`).
**Why:** Independent fields stop invalidating each other's cache lines; cross-core coherence traffic disappears. Can *double* throughput with no algorithmic change.
**Trade-off:** Wastes ~56 bytes per padded field and the code looks bizarre (dead `long` fields). Invisible in source, only justified by a profile showing cache-coherence stalls.

---

## Optimization Tips

- **Profile first, always.** Concurrency intuition is wrong constantly. Measure throughput *and* the latency tail (p99/p99.9) under a warmed-up, multi-core, balanced harness before and after every change.
- **Batching (Opt 1) is the biggest lever** for anything with an expensive downstream. Reach for it before touching locks or going lock-free.
- **Don't go lock-free prematurely.** Opts 9–10 are for proven, extreme hot paths. A `BlockingQueue` or a Go channel is the right answer for the overwhelming majority of systems.
- **Optimize the right axis.** Throughput optimizations (two-lock, `signal`, larger pool) can *worsen* the latency tail (GC, contention). Know which one your product needs.
- **Right-sizing (Opt 4) beats clever code.** A correctly sized consumer pool over a plain `BlockingQueue` outperforms a lock-free queue starved of consumers.
- **Bounded stays bounded.** Never "optimize" by removing the bound — you'd be trading a tunable stall for an OOM. Keep backpressure.
- **Re-measure after every change.** Each optimization shifts the bottleneck; the next one may now be elsewhere (the downstream DB, the network, the GC).
