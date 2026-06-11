# Monitor Object — Optimization Walkthroughs

> Ten before/after optimizations for Monitor Object code. Each gives the starting code, the problem, the improved version, why it's faster, and the trade-off. Optimize only what you've *measured* — these are the knobs that matter once a Monitor shows up in a profile. See [middle](middle.md) · [senior](senior.md) · [professional](professional.md).

## Table of Contents

1. [Shrink the critical section](#1-shrink-the-critical-section)
2. [Split conditions to kill the thundering herd](#2-split-conditions-to-kill-the-thundering-herd)
3. [`signal` instead of `signalAll`](#3-signal-instead-of-signalall)
4. [Move I/O out from under the lock](#4-move-io-out-from-under-the-lock)
5. [Replace busy-wait polling with condition waiting](#5-replace-busy-wait-polling-with-condition-waiting)
6. [Read-mostly: Monitor → StampedLock](#6-read-mostly-monitor--stampedlock)
7. [Lock striping for partitionable state](#7-lock-striping-for-partitionable-state)
8. [Atomics for single-variable counters](#8-atomics-for-single-variable-counters)
9. [Unfair lock for throughput](#9-unfair-lock-for-throughput)
10. [Replace the hand-rolled Monitor with j.u.c](#10-replace-the-hand-rolled-monitor-with-juc)
11. [Optimization Tips](#optimization-tips)

---

## 1. Shrink the critical section

**Before:**
```java
public synchronized void record(Event e) {
    String json = serialize(e);   // CPU-heavy, touches NO shared state
    buffer.add(json);             // the only line needing the lock
}
```
**Problem:** Serialization (allocation, string building) runs *under* the lock, so every other thread queues behind it. Time-under-lock is dominated by work that didn't need protecting.
**After:**
```java
public void record(Event e) {
    String json = serialize(e);          // outside the lock → parallel
    synchronized (this) { buffer.add(json); }   // tiny critical section
}
```
**Why faster:** Time-under-lock drops to a single `add`. Threads spend less time `BLOCKED`; short sections stay in HotSpot's adaptive-spin regime and never park in the kernel.
**Trade-off:** None to correctness here (the moved work was lock-independent). The discipline is verifying the moved code truly touches no shared state.

## 2. Split conditions to kill the thundering herd

**Before:** one intrinsic monitor, `notifyAll()` wakes every producer *and* consumer on each operation.
**Problem:** With 200 waiters, each `notifyAll()` unparks all 200; they serialize through the lock, 199 re-check and re-sleep. O(N) wakeups per op → p99 latency spikes.
**After:** `ReentrantLock` + `notFull`/`notEmpty`; `put` does `notEmpty.signal()`, `take` does `notFull.signal()`.
**Why faster:** Each operation unparks exactly **one** relevant waiter instead of all N. Eliminates the herd.
**Trade-off:** More code (explicit lock, two conditions, `try/finally`); you must correctly map each wait/signal to the right condition or you reintroduce [Bug 8](find-bug.md#bug-8--await-on-the-wrong-condition).

## 3. `signal` instead of `signalAll`

**Before:**
```java
notFull.signalAll();   // wakes ALL waiting producers after one take
```
**Problem:** Only **one** slot freed, but every waiting producer wakes and contends; all but one re-sleep. Wasted unparks and context switches.
**After:**
```java
notFull.signal();      // one freed slot → wake exactly one producer
```
**Why faster:** One state change enables one waiter, so one `signal` suffices. Removes redundant wakeups.
**Trade-off:** `signal` is correct **only** when each freed unit enables exactly one homogeneous waiter (true for a per-condition bounded buffer). If a single state change can enable *multiple* waiters (e.g. a latch opening for all), you still need `signalAll`.

## 4. Move I/O out from under the lock

**Before:**
```java
public synchronized void append(String line) {
    file.write(line);   // disk I/O under the lock → convoy
}
```
**Problem:** A slow/blocked write (page cache flush, fsync, network FS stall) stalls *every* waiting thread for the full I/O duration — convoying. A GC pause or page fault here multiplies across all queued requests.
**After:** Enqueue under the lock into a Monitor-backed buffer; a dedicated writer thread drains and does the I/O *outside* any caller's critical section (producer–consumer handoff).
```java
public void append(String line) { queue.put(line); }   // fast, bounded
// writer thread: while(true){ String s = queue.take(); file.write(s); }
```
**Why faster:** Callers never block on I/O; the lock is held only for the in-memory enqueue. See [Producer–Consumer](../06-producer-consumer/middle.md).
**Trade-off:** Adds a thread and a bounded queue (backpressure when full); ordering and durability semantics need care (lost buffered writes on crash).

## 5. Replace busy-wait polling with condition waiting

**Before:**
```java
public T take() throws InterruptedException {
    while (true) {
        synchronized (this) { if (count > 0) { /* dequeue */ return x; } }
        Thread.sleep(5);   // poll
    }
}
```
**Problem:** Burns CPU spinning, adds up to 5 ms latency per item, and scales terribly (every consumer polls independently).
**After:** `while (count == 0) wait();` inside the synchronized method — sleep until signaled, wake the instant an item arrives.
**Why faster:** Zero CPU while idle; near-zero wakeup latency; no fixed polling delay.
**Trade-off:** Must get the wait/signal protocol right (`while`, notify on every state change) — but that's strictly better than polling on every axis.

## 6. Read-mostly: Monitor → StampedLock

**Before:** a `synchronized` getter/setter pair on state read 100:1 over writes — every read takes the exclusive lock and serializes.
**Problem:** Reads can't run in parallel; the lock word's cache line bounces between cores on every read CAS. Read throughput is capped at the single-lock rate.
**After:**
```java
long stamp = sl.tryOptimisticRead();      // no lock
var snapshot = readFields();
if (!sl.validate(stamp)) { stamp = sl.readLock(); try { snapshot = readFields(); } finally { sl.unlockRead(stamp); } }
```
**Why faster:** Optimistic reads take **no lock** in the common (no-concurrent-write) case — zero contention, no cache-line bounce. Writers still serialize.
**Trade-off:** You abandon "one thread at a time" for reads, so the read must work on a **consistent snapshot** and tolerate retry. More complex; wrong for write-heavy or multi-field-invariant reads that can't snapshot cleanly.

## 7. Lock striping for partitionable state

**Before:** one Monitor guarding a whole map; every `get`/`put` contends on one lock.
**Problem:** All keys serialize through a single lock regardless of whether they touch the same entry — needless contention.
**After:** Partition into M segments, each with its own lock; route by `hash(key) % M`. (Historically how `ConcurrentHashMap` worked.)
**Why faster:** Operations on different segments proceed in parallel; contention drops ~M×.
**Trade-off:** **Cross-stripe atomicity is lost** — you can't atomically touch two segments (e.g. a global `size()` or moving an entry between stripes becomes hard/locked-globally). Only valid when operations are key-local.

## 8. Atomics for single-variable counters

**Before:**
```java
public synchronized void inc() { count++; }
public synchronized long get() { return count; }
```
**Problem:** A full Monitor for a single independent variable is overkill; the lock serializes increments that could be lock-free.
**After:**
```java
private final AtomicLong count = new AtomicLong();
public void inc()  { count.incrementAndGet(); }   // CAS, lock-free
public long get()  { return count.get(); }
```
For extreme contention, `LongAdder` (striped counters) beats `AtomicLong`.
**Why faster:** Lock-free CAS avoids park/unpark; `LongAdder` spreads writes across cells to cut cache-line contention.
**Trade-off:** Atomics only protect a **single** variable — useless when multiple fields form an invariant (use the Monitor) or when you need to **block** on a condition (atomics can't `wait`).

## 9. Unfair lock for throughput

**Before:** `new ReentrantLock(true)` (fair) on a hot path.
**Problem:** Fair locks enforce FIFO and disable **barging** — a thread that could grab a just-freed lock must instead yield to the queue head, adding a context switch per handoff. Throughput often **halves**.
**After:** `new ReentrantLock()` (default, unfair) — a running thread may barge and re-acquire immediately.
**Why faster:** Barging keeps a hot thread on-CPU and avoids handoff context switches; HotSpot's adaptive spinning works with it.
**Trade-off:** Unfair locks risk **starvation** of unlucky waiters. Keep fair only where you've *measured* starvation and an SLO demands bounded wait time.

## 10. Replace the hand-rolled Monitor with j.u.c

**Before:** a custom `synchronized` bounded buffer with `wait`/`notifyAll`.
**Problem:** Hand-rolled `wait`/`notify` code is a top source of concurrency bugs *and* is typically less optimized than the JDK's (no lock elision tuning, no separated conditions, suboptimal wakeups).
**After:**
```java
BlockingQueue<T> q = new ArrayBlockingQueue<>(1024);
q.put(x);            // producer
T v = q.take();      // consumer
```
**Why faster (and safer):** `ArrayBlockingQueue` already uses one `ReentrantLock` + two `Condition`s + targeted `signal`, is battle-tested, and benefits from JIT optimizations the JDK maintains. You inherit timeouts, fairness option, drainTo, and correctness for free.
**Trade-off:** Less control over exotic semantics; if you genuinely need behavior no `j.u.c` type offers, you're back to hand-rolling — but verify that first.

## Optimization Tips

1. **Measure before optimizing.** Profile for `BLOCKED` thread time and lock contention (async-profiler, JFR). If the Monitor isn't in the hot path, leave it alone — its simplicity is worth more than micro-gains.
2. **Climb the ladder in order:** shrink the critical section → split conditions / `signal` → read/write separation → striping → lock-free → replace with `j.u.c`. Most wins are at the first rung (work that didn't need the lock).
3. **Report the contention curve, not ops/sec.** Throughput *and* p99/p999 latency vs thread count reveals the serialization knee — the number that justifies an architectural change.
4. **Never trade away a real invariant for speed.** Lock striping and `StampedLock` give up multi-region atomicity; only apply where operations are genuinely independent.
5. **Watch for virtual-thread pinning.** On Loom-heavy services, prefer `ReentrantLock` over `synchronized` so blocked virtual threads unmount instead of pinning carriers.
6. **Re-run the invariant stress test after every change.** An optimization that reintroduces a race is a regression, not a win — the stress test (asserting count bounds, conservation, no double-issue) is the safety net for the entire ladder.
