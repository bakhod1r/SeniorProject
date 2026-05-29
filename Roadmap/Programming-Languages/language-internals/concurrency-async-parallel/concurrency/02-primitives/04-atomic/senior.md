# Atomic Operations — Senior Level

> **Topic:** [Atomic Operations](README.md)
> **Focus:** lock-free DS, memory reclamation, cache effects

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

At the senior level, atomic operations stop being a tool and start being a discipline. You no longer ask "should I use `AtomicInteger` here?" — you ask "is the contention pattern of this counter going to dominate the cache coherence traffic of an entire NUMA node?" You stop trusting that "lock-free is faster than locked," because under heavy contention with short critical sections, a well-tuned mutex can outperform a naive CAS loop by a factor of two. You stop reaching for `AtomicReference` whenever you need to share state, because publishing pointers without a reclamation strategy leaks memory or, worse, hands a thread a pointer to memory that has already been freed.

Senior work with atomics is dominated by three concerns that the junior and middle levels barely touched. The first is **structural** — the design of lock-free data structures like the Michael-Scott queue, where the entire correctness argument hinges on a single double-word CAS and the careful ordering of two pointer updates. The second is **memory reclamation** — once a node is unlinked from a lock-free structure, when is it safe to free? Hazard pointers, epoch-based reclamation (EBR), and Read-Copy-Update (RCU) all answer this question with different trade-offs between latency, throughput, and memory overhead. The third is **microarchitectural** — the realization that an atomic operation is a transaction on the cache coherence protocol, and that two threads incrementing two counters that happen to share a cache line will run as slowly as if they were contending for the same lock.

This level also requires you to internalize the difference between **lock-free** (system-wide progress) and **wait-free** (per-thread progress), and to understand why most production "lock-free" code is not wait-free, and why that is usually fine. You will learn that on x86, almost any atomic store is also a release, and almost any atomic load is also an acquire — but that this same code on ARM or POWER will require explicit fences that cost real cycles. You will learn why `LongAdder` in `java.util.concurrent.atomic` exists, why Cassandra and Kafka use striped counters in their hottest paths, and why the LMAX Disruptor abandoned `BlockingQueue` for a single-writer ring buffer that pre-allocates everything.

Most importantly, you will learn humility. Lock-free programming is the area of concurrency where being clever costs the most. A bug in a Michael-Scott queue may only manifest under a specific reordering on a specific ARM core under a specific contention pattern, and may go undetected for years. The right approach is usually to build on top of well-tested primitives — `ConcurrentLinkedQueue`, `crossbeam::queue::SegQueue`, `tokio::sync::mpsc` — and to reach for hand-rolled atomic algorithms only when profiling proves the existing primitive is the bottleneck.

## Prerequisites

Before diving into senior-level atomics, you should already be comfortable with the following.

- **Cache coherence at MESI level.** You should know what the M, E, S, I states mean, what triggers state transitions, and why a write to a shared line is expensive while a write to a modified line is cheap.
- **The acquire/release memory model.** You should be able to reason about why a release store on x86 emits no fence but the same operation on ARM emits a `dmb ish` (data memory barrier).
- **Compare-and-swap semantics and the ABA problem.** You should be able to explain why a CAS that "succeeds" does not necessarily mean nothing changed in between.
- **Volatile and `LazySet`/`set_release` semantics.** You should know the difference between a `set`, a `lazySet`, and a `compareAndSet` on `AtomicReference`.
- **Garbage collection vs manual memory management.** Memory reclamation in lock-free structures looks very different in Java (where the GC saves you) versus C++ or Rust (where you must implement hazard pointers or epochs yourself).
- **Reading vendor docs.** You should be willing to read the Intel SDM Volume 3A chapter on memory ordering and the ARM ARM section on multi-copy atomicity. Senior atomics work without this is guessing.
- **Profiling tools.** `perf c2c` on Linux, Java Flight Recorder, Rust `flamegraph`, and the ability to read assembly output from your compiler are not optional. You cannot tune lock-free code by reading source.

## Glossary

- **Lock-free.** A progress condition: the system as a whole makes progress in a bounded number of steps, even if individual threads are starved.
- **Wait-free.** A stronger progress condition: every thread makes progress in a bounded number of its own steps, regardless of contention.
- **Obstruction-free.** A weaker progress condition: a thread that runs in isolation completes in a bounded number of steps; mutual obstruction may cause livelock.
- **Michael-Scott queue.** The canonical lock-free MPMC queue, published by Maged Michael and Michael Scott in 1996, based on linked nodes and a tail-update protocol.
- **Hazard pointer.** A per-thread published pointer marking a node currently in use; reclaimers must not free any node listed as hazardous.
- **Epoch-based reclamation (EBR).** A scheme where threads enter "epochs" and freed nodes wait until all threads have left the epoch in which they were unlinked.
- **RCU (Read-Copy-Update).** A reclamation scheme used heavily in the Linux kernel: readers run with no synchronization, writers copy-modify-publish, and freeing waits for a grace period.
- **False sharing.** Two unrelated variables sit in the same cache line, so a write to one invalidates the other, causing coherence traffic that looks like contention.
- **Cache line.** The unit of transfer in the coherence protocol, typically 64 bytes on x86 and ARMv8.
- **`LongAdder`.** A striped counter in `java.util.concurrent.atomic` that trades read cost (must sum cells) for write scalability under contention.
- **LMAX Disruptor.** A high-throughput ring buffer using single-writer principle and pre-allocated slots to avoid GC and contention.
- **LCRQ.** Linked Concurrent Ring Queue, a 2013 lock-free queue design that uses fixed-size ring buffers as nodes for better cache behavior.
- **Quiescent state.** In RCU, a moment when a CPU is known not to hold any RCU reference, enabling reclamation of nodes unlinked before that moment.
- **Cache line ping-pong.** Repeated transfer of a cache line between cores' L1 caches caused by alternating writes.

## Core Concepts

### Lock-free vs wait-free vs obstruction-free

Most engineers use "lock-free" sloppily to mean "no mutex." Strictly, **lock-free** means that *the system* always makes progress: if one thread is suspended in the middle of its operation, the others can still complete theirs. This is the progress guarantee of CAS loops: if one thread loses a CAS race, another must have won, so global progress continues.

**Wait-free** is stronger: each thread completes its operation in a bounded number of *its own* steps. CAS loops are not wait-free, because a thread can lose CAS arbitrarily many times in a row under bad luck. True wait-free algorithms typically use helping techniques where threads complete each other's pending operations, and they are dramatically more complex.

**Obstruction-free** is weakest: a thread completes if no other thread interferes, but two interfering threads can livelock. Software Transactional Memory (STM) implementations often start obstruction-free and then add backoff to recover throughput.

In practice, almost all production lock-free code is lock-free but not wait-free. The Michael-Scott queue is lock-free. `ConcurrentLinkedQueue` is lock-free. Wait-free queues exist (Kogan-Petrank, 2011) but their constant factors make them slower than lock-free queues on typical workloads.

### Michael-Scott queue (canonical lock-free MPMC queue)

The Michael-Scott queue, often abbreviated **MS-queue**, is the reference design for lock-free FIFO queues. It is the algorithm underneath Java's `ConcurrentLinkedQueue` and many production C++ queues. The structure is a singly linked list with a sentinel head node. Each `enqueue` performs the following protocol:

1. Read the current `tail` pointer.
2. Read `tail.next`.
3. Re-check `tail` — if it changed, retry.
4. If `tail.next != null`, the queue is in a "lagging tail" state, so help by CASing `tail` forward and retry.
5. Otherwise, CAS `tail.next` from `null` to the new node.
6. If that CAS succeeded, CAS `tail` from the old tail to the new node (this CAS may fail, and that is OK — another thread will catch up).

The trick is step 5 followed by step 6: the enqueue is "linearized" at step 5, even though the tail pointer may briefly be stale. The dequeue side reads `head`, `tail`, and `head.next`, and CASes `head` forward if `head.next != null`.

The MS-queue is a beautifully precise piece of engineering, but it has two famous problems. First, **ABA**: in a system without GC, a freed node may be reallocated as a new node with the same address, causing CAS to falsely succeed. Java sidesteps this because GC ensures a node cannot be reallocated while any thread holds a reference. C++ and Rust do not get this luxury. Second, **two-CAS-per-op overhead**: under contention, the queue becomes a hotspot because every enqueue touches `tail`, and every dequeue touches `head`, and these are usually on different cache lines but on the same NUMA node.

### LCRQ and LMAX Disruptor for ring buffers

To beat the MS-queue under heavy load, two design directions emerged.

**LCRQ** (Linked Concurrent Ring Queue, Morrison & Afek, 2013) batches enqueues and dequeues by making each linked-list node a fixed-size ring buffer, typically 1024 slots. Threads CAS into a per-slot atomic tag rather than fighting for a global tail pointer. This dramatically reduces cache-line contention because different threads write to different slots within the ring, and only when a ring fills does the algorithm link a new one. LCRQ is the basis for many high-performance queue implementations including those in DPDK and in some HFT systems.

**LMAX Disruptor** takes a different path. It is not lock-free in the strict sense — it uses memory fences and atomics, but the single-writer principle eliminates write contention entirely. A producer claims a sequence number with a single `getAndIncrement`, writes into a pre-allocated slot at `seq % bufferSize`, and publishes by updating a `cursor` sequence with a release store. Consumers spin on the cursor with acquire loads. Because the ring buffer is pre-allocated and slots are reused in place, there is zero allocation per message and no GC pressure. The Disruptor sustained 25 million messages per second per thread on commodity hardware around 2011 — a number that was an order of magnitude better than `ArrayBlockingQueue` and which forced the JVM concurrency community to take cache-aware design seriously.

### Memory reclamation: hazard pointers, epoch-based reclamation, RCU

In a managed runtime like the JVM, GC handles lock-free reclamation transparently. When a node is unlinked from a queue but another thread still holds a reference to it, GC will not free it until all references are dropped. This is one of the underappreciated reasons why high-quality lock-free code is so much easier in Java than in C++.

In an unmanaged language, you must implement reclamation by hand. Three schemes dominate.

**Hazard pointers** (Michael, 2004) work by having each thread publish, before dereferencing a shared pointer, the address it is about to read into a per-thread "hazard slot." When a writer wants to free a node, it scans all hazard slots; if the node's address is published, the writer defers the free. The cost is one store-load fence per dereference (because the publish must be visible before the read), which makes hazard pointers expensive on weakly ordered hardware. On x86 this fence is implicit. Hazard pointers are bounded — memory usage is `O(H * T)` for `H` hazard pointers per thread and `T` threads — and they are the dominant scheme in C++ (`folly::hazptr`, `boost::hazard_pointer`, and proposed C++26 hazard pointers).

**Epoch-based reclamation (EBR)** is faster but unbounded. Threads enter a global epoch counter before each operation and leave after. When a node is unlinked, it is tagged with the current epoch and added to a "limbo list." When all threads have advanced past that epoch, the limbo list is safe to free. EBR is the basis for `crossbeam-epoch` in Rust and is widely used because per-op overhead is just two atomic loads. The downside is that a slow or blocked thread can pin the global epoch and prevent reclamation, causing unbounded memory growth — an availability hazard for long-running services.

**RCU (Read-Copy-Update)** is the dominant reclamation scheme in the Linux kernel. Readers run with no synchronization — just preempt-disable. Writers copy a structure, modify the copy, and publish atomically. After a "grace period" during which every CPU has been observed to context-switch (proving no CPU still holds the old version), the old version is freed. RCU achieves near-zero read overhead, which is why the Linux dcache and routing table use it. The trade-off is write complexity and the latency of grace periods.

### False sharing in atomic counters; padding to cache lines

When two threads each increment their own counter, you would expect them to scale linearly. They do not, if the two counters share a cache line. Each increment requires the cache line in M state on the writing core, which forces the other core's copy into I, which then must be re-fetched on the next increment there. The cores end up ping-ponging the line between L1 caches over the coherence interconnect. The result: two threads each doing "private" increments run 5–10× slower than one thread doing both increments.

The fix is to pad each atomic to its own cache line. In Java this is `@Contended` (with `-XX:-RestrictContended`); in C++ it is `alignas(64)` plus padding; in Rust it is `crossbeam_utils::CachePadded`. The cost is 56 bytes wasted per counter, which is irrelevant in a counter array of 64 entries but significant if you had a million of them. The benefit is linear scaling instead of negative scaling.

False sharing is one of the most insidious bugs in concurrent systems because it is invisible at the source code level. The fix requires reading the assembly and the cache-line layout. Tools like `perf c2c` (Cache to Cache) make this visible by directly measuring HITM (Hit Modified) events on shared lines.

### x86 vs ARM/POWER memory ordering at hardware level

x86 has a Total Store Order (TSO) memory model. Stores can be reordered with later loads of other addresses (store buffer forwarding), but stores are never reordered with other stores, and loads are never reordered with earlier loads. As a consequence, almost every atomic operation on x86 emits no extra fences: a `mov` is already a release store, a read is already an acquire load. The only operation that requires a fence is the seq-cst store, which compiles to a `mov` followed by `mfence` (or to `xchg`, which has an implicit `mfence`).

ARM (ARMv8) and POWER are much weaker. Loads and stores can be freely reordered as long as data dependencies are respected. A release store on ARMv8 compiles to `stlr` (store-release register), and an acquire load to `ldar`. These instructions cost real cycles — typically 5–10 extra cycles per fence — and on a hot path like a CAS loop, this is measurable. Code that "just works" on x86 because of TSO will deadlock or produce wrong answers on ARM if the fences are missing.

This is why C++ `std::memory_order_relaxed` is genuinely faster on ARM but indistinguishable from `seq_cst` on x86. It is also why benchmarks of lock-free code that were calibrated on x86 servers in 2015 may show very different numbers on modern Graviton or M-series chips.

### Java's `LongAdder` vs `AtomicLong` under contention

`AtomicLong.incrementAndGet()` is a single CAS loop on a single memory location. Under low contention this is ~10 ns. Under high contention — say, 32 threads on 32 cores all incrementing — throughput collapses to maybe 5 million ops/sec total, because every core fights for the cache line.

`LongAdder` solves this by maintaining an array of cells. Each thread, on contention, picks a cell based on its hash and increments that cell. To read the total, you sum all cells. The trade-off: writes scale linearly, reads cost `O(N)` cells. For pure counter scenarios where you write often and read rarely (rate limiters, metric counters, throughput meters), this is a massive win — `LongAdder` can sustain 200+ million increments per second on a 32-core box where `AtomicLong` saturates at 10 million.

The lesson generalizes: when contention is the bottleneck, *spreading* the contention is often more valuable than making each operation faster. Striping, sharding, and per-thread caches are the same idea applied at different scales.

### Profiling lock-free code: `perf c2c`, JFR allocation profile

Profiling lock-free code is harder than profiling locked code. There are no lock contention events — there is only "this load took 200 cycles instead of 4." The right tools:

- **`perf c2c`** on Linux directly reports cache-to-cache transfer events, identifying false sharing and contention hotspots.
- **`perf stat -e cache-misses,L1-dcache-load-misses`** gives high-level cache pressure.
- **Java Flight Recorder** with `jdk.CPULoad` and `jdk.SafepointBegin` events shows GC and safepoint pauses that can mask atomic contention.
- **`async-profiler` with `-e cycles`** gives flame graphs that highlight the CAS loops themselves.

The classic diagnostic pattern: a benchmark shows excellent single-threaded throughput, but throughput *drops* as threads are added. This is the signature of cache contention. The fix is almost always either padding (for false sharing) or striping (for true sharing).

### When atomics LOSE to mutexes — under high contention with short critical sections

The mythology says lock-free is faster than locked. The reality is more nuanced. Mutexes have a fast path: an uncontended acquire on x86 is a single CAS, comparable to an atomic increment. Under high contention with short critical sections, mutexes actually win because:

1. **Backoff is built in.** Modern futex-based mutexes park threads after a few spin attempts, removing them from the contention. CAS loops have no such mechanism unless you add explicit backoff.
2. **Fairness.** Mutexes can queue waiters; CAS loops cannot, leading to starvation.
3. **Cache locality.** Under heavy contention, mutexes effectively serialize cache-line ownership and limit ping-pong. A CAS loop with N threads keeps all N lines fighting.

The crossover point depends on critical section length and core count, but a useful rule of thumb is: if the critical section does more than ~50 ns of work and contention is heavy, a mutex will beat a hand-rolled CAS loop. Lock-free shines on short, hot operations like a single counter increment or a single pointer publish — exactly the operations that compile to one or two instructions.

### The "atomic is not free" lesson: $20-40 cycles for CAS, cache-line ping-pong

A `lock cmpxchg` on x86 takes roughly 20–40 cycles even on a hot cache line. On a cold or contended line, it can take hundreds of cycles. The reason: `lock` prefix forces the operation to be globally ordered, which means the core must obtain exclusive ownership of the cache line and prevent other cores from interfering for the duration of the read-modify-write.

This means a tight loop of `incrementAndGet` on a single counter is fundamentally limited to about 100 million operations per second per core, and *less* under contention. If your throughput needs exceed this, you must shard the counter (like `LongAdder`) or batch updates.

### Volatile load/store visibility model (Java/JLS)

Java's `volatile` is acquire-release with sequential consistency for volatile-only operations. A `volatile` write happens-before every subsequent `volatile` read of the same field on any thread. This is stronger than C++'s `memory_order_acquire`/`memory_order_release` (which only synchronize matching pairs) and weaker than `memory_order_seq_cst` (which gives a total order across all seq-cst operations).

The practical implication: `volatile long` reads and writes are atomic in Java (unlike non-volatile longs on 32-bit JVMs), and they synchronize-with each other. But a `volatile` increment (`v++`) is not atomic, because it is a read-modify-write that the model treats as a separate load and store. Use `AtomicLong` for atomic increments.

## Real-World Analogies

- **Air traffic control with no controller.** Lock-free MS-queue is a runway where pilots coordinate via radio (CAS) without a central tower. Each pilot reads who is at the end of the queue, attempts to slot in, and if two attempt at once, one re-checks and retries. The system works because the protocol is unambiguous and bounded.
- **Hazard pointers as a mortuary registry.** Before you visit a dead celebrity's body, you sign a registry. The undertaker checks the registry before cremation. If your name is there, the body waits. EBR is the same but coarser: the undertaker waits for a whole "shift" to end before cremating anyone who died during that shift.
- **RCU as Wikipedia.** Readers see the live version with no coordination. Writers fork an edit, modify, and atomically publish. The old version is preserved until everyone who started reading it before the publish has finished — only then can it be deleted from history.
- **False sharing as roommates fighting over one fridge.** You and your roommate keep your own food on different shelves, but the fridge only fits in the kitchen, and only one person can be in the kitchen at a time. Even though you never touch each other's food, you constantly wait for the other to leave.
- **`LongAdder` as multiple cash registers.** A single cashier (AtomicLong) becomes a bottleneck when 30 customers arrive at once. Opening 32 registers and summing the takings at end-of-day (LongAdder) keeps the queue flowing.
- **LMAX Disruptor as an assembly line.** Each station has a fixed slot in the conveyor. A station never waits for upstream allocation; the slot already exists. Coordination is via sequence numbers visible to all stations, not via passing items hand-to-hand.
- **x86 vs ARM as different countries' driving rules.** x86 has strict laws — almost every store is implicitly visible to other CPUs in order, so you rarely need extra signage. ARM is "anything goes unless you put up a sign" — you must explicitly mark fences, or visitors will be confused.

## Mental Models

### The cache coherence transaction model

Every atomic operation is a transaction on the cache coherence protocol. Reading an atomic means "get this line in S (shared) state on my core." Writing an atomic means "get this line in M (modified) state on my core, invalidating all other copies." Under this model, the cost of an atomic is dominated not by the instruction itself but by the state transitions of the cache line.

A counter that lives in M state on one core and is never touched by anyone else is effectively free to increment. A counter that ping-pongs between two cores' M states is slower than a mutex. A counter that is read-mostly and lives in S state on many cores is cheap to read and expensive to write. This model explains why per-core counters, read-mostly data, and immutable data are the friends of scalability, and why shared writeable counters are its enemies.

### The "two cooperators, two adversaries" model for lock-free correctness

Every lock-free algorithm must be correct against four scenarios for every operation: (1) my CAS succeeds while a cooperator is also helping; (2) my CAS fails because a competitor moved the state; (3) I read state that is in transit because another op is half-done; (4) I publish state while another op is reading. Designing a lock-free algorithm is exhaustively checking that each of the four scenarios preserves invariants. The MS-queue's "help the lagging tail" step is exactly scenario (3) in action.

### The reclamation cost model

Reclamation is never free. Hazard pointers cost a fence per read. EBR costs an atomic increment per op-region entry. RCU costs nothing on read but requires grace-period detection on write. GC costs allocation-rate-proportional pause time. When choosing a reclamation scheme, ask: what is my read:write ratio, what is my maximum acceptable read latency, what is my memory budget? The right answer for a read-heavy hash map (RCU) is different from the right answer for a write-heavy queue (EBR) which is different from a bounded latency system (hazard pointers).

### The contention model

Imagine each shared cache line has a "shadow lock" that the hardware acquires for the duration of any atomic operation. This shadow lock is invisible to your code but very visible in your profiler. Operations on hot shared lines are serialized through this shadow lock. To scale, you must reduce contention on shared lines — by padding (false sharing fix), by sharding (LongAdder), by single-writer (Disruptor), or by read-mostly access patterns (RCU).

## Code Examples

### Michael-Scott queue in Java

A working MS-queue, suitable for studying. Production code should use `ConcurrentLinkedQueue` instead.

```java
import java.util.concurrent.atomic.AtomicReference;

public class MSQueue<T> {
    private static class Node<T> {
        final T value;
        final AtomicReference<Node<T>> next = new AtomicReference<>(null);
        Node(T value) { this.value = value; }
    }

    private final AtomicReference<Node<T>> head;
    private final AtomicReference<Node<T>> tail;

    public MSQueue() {
        Node<T> sentinel = new Node<>(null);
        head = new AtomicReference<>(sentinel);
        tail = new AtomicReference<>(sentinel);
    }

    public void enqueue(T value) {
        Node<T> newNode = new Node<>(value);
        while (true) {
            Node<T> currentTail = tail.get();
            Node<T> tailNext = currentTail.next.get();
            // Re-check tail. If changed, another thread modified state — retry.
            if (currentTail != tail.get()) continue;
            if (tailNext != null) {
                // Tail is lagging. Help advance it, then retry.
                tail.compareAndSet(currentTail, tailNext);
                continue;
            }
            // Try to link new node at the end.
            if (currentTail.next.compareAndSet(null, newNode)) {
                // Linked successfully. Try to advance tail; failure is fine.
                tail.compareAndSet(currentTail, newNode);
                return;
            }
            // CAS failed — another thread won the race. Retry.
        }
    }

    public T dequeue() {
        while (true) {
            Node<T> currentHead = head.get();
            Node<T> currentTail = tail.get();
            Node<T> headNext = currentHead.next.get();
            if (currentHead != head.get()) continue;
            if (currentHead == currentTail) {
                if (headNext == null) return null; // empty
                // Tail is lagging — help it.
                tail.compareAndSet(currentTail, headNext);
                continue;
            }
            T value = headNext.value;
            if (head.compareAndSet(currentHead, headNext)) {
                return value;
            }
        }
    }
}
```

### Epoch-based reclamation in Rust

Using `crossbeam-epoch` to implement a tiny lock-free stack with proper reclamation. This compiles and runs.

```rust
use crossbeam_epoch::{self as epoch, Atomic, Owned};
use std::sync::atomic::Ordering;

pub struct Stack<T> {
    head: Atomic<Node<T>>,
}

struct Node<T> {
    value: T,
    next: Atomic<Node<T>>,
}

impl<T> Stack<T> {
    pub fn new() -> Self {
        Stack { head: Atomic::null() }
    }

    pub fn push(&self, value: T) {
        let guard = &epoch::pin();
        let mut new_node = Owned::new(Node { value, next: Atomic::null() });
        loop {
            let head = self.head.load(Ordering::Acquire, guard);
            new_node.next.store(head, Ordering::Relaxed);
            match self.head.compare_exchange(
                head,
                new_node,
                Ordering::Release,
                Ordering::Acquire,
                guard,
            ) {
                Ok(_) => return,
                Err(e) => new_node = e.new,
            }
        }
    }

    pub fn pop(&self) -> Option<T> where T: Clone {
        let guard = &epoch::pin();
        loop {
            let head = self.head.load(Ordering::Acquire, guard);
            match unsafe { head.as_ref() } {
                None => return None,
                Some(h) => {
                    let next = h.next.load(Ordering::Acquire, guard);
                    if self.head.compare_exchange(
                        head, next, Ordering::Release, Ordering::Acquire, guard,
                    ).is_ok() {
                        // Defer dropping until all threads exit current epoch.
                        unsafe { guard.defer_destroy(head); }
                        return Some(h.value.clone());
                    }
                }
            }
        }
    }
}
```

The key call is `guard.defer_destroy(head)`. This does not free the node immediately; it adds it to a per-thread "garbage list" that is freed only when all threads have left the epoch in which the unlink happened. Without this, a `pop` could return memory that another thread is still dereferencing.

### False sharing demo: padded vs unpadded counters

A benchmark that demonstrates the speedup from padding two counters to separate cache lines.

```java
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicLongArray;
import jdk.internal.vm.annotation.Contended;

public class FalseSharingDemo {
    // Two counters in the same cache line — false sharing.
    static class Unpadded {
        AtomicLong a = new AtomicLong();
        AtomicLong b = new AtomicLong();
    }

    // Two counters padded to separate cache lines.
    static class Padded {
        @Contended AtomicLong a = new AtomicLong();
        @Contended AtomicLong b = new AtomicLong();
    }

    public static long run(Runnable rA, Runnable rB) throws Exception {
        Thread t1 = new Thread(rA);
        Thread t2 = new Thread(rB);
        long start = System.nanoTime();
        t1.start(); t2.start();
        t1.join(); t2.join();
        return System.nanoTime() - start;
    }

    public static void main(String[] args) throws Exception {
        final long N = 100_000_000L;

        Unpadded u = new Unpadded();
        long uTime = run(
            () -> { for (long i = 0; i < N; i++) u.a.incrementAndGet(); },
            () -> { for (long i = 0; i < N; i++) u.b.incrementAndGet(); }
        );

        Padded p = new Padded();
        long pTime = run(
            () -> { for (long i = 0; i < N; i++) p.a.incrementAndGet(); },
            () -> { for (long i = 0; i < N; i++) p.b.incrementAndGet(); }
        );

        System.out.printf("Unpadded: %.2f s%n", uTime / 1e9);
        System.out.printf("Padded:   %.2f s%n", pTime / 1e9);
        System.out.printf("Speedup:  %.2fx%n", (double) uTime / pTime);
    }
}
```

Run with `-XX:-RestrictContended` to enable `@Contended`. On a typical 8-core x86, padded is 3–6× faster.

### LongAdder vs AtomicLong scaling

```java
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;
import java.util.concurrent.*;

public class AdderVsAtomic {
    public static void main(String[] args) throws Exception {
        for (int threads : new int[]{1, 2, 4, 8, 16, 32}) {
            bench("AtomicLong", threads, new AtomicLongTask());
            bench("LongAdder ", threads, new LongAdderTask());
        }
    }

    interface Task {
        void increment();
        long sum();
    }

    static class AtomicLongTask implements Task {
        final AtomicLong v = new AtomicLong();
        public void increment() { v.incrementAndGet(); }
        public long sum() { return v.get(); }
    }

    static class LongAdderTask implements Task {
        final LongAdder v = new LongAdder();
        public void increment() { v.increment(); }
        public long sum() { return v.sum(); }
    }

    static void bench(String name, int threads, Task task) throws Exception {
        final long PER_THREAD = 5_000_000;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch latch = new CountDownLatch(threads);
        long start = System.nanoTime();
        for (int i = 0; i < threads; i++) {
            pool.submit(() -> {
                for (long j = 0; j < PER_THREAD; j++) task.increment();
                latch.countDown();
            });
        }
        latch.await();
        long elapsed = System.nanoTime() - start;
        pool.shutdown();
        double opsPerSec = (double) (threads * PER_THREAD) / (elapsed / 1e9);
        System.out.printf("%s threads=%2d ops=%.1f M/s%n", name, threads, opsPerSec / 1e6);
    }
}
```

Typical output on an 8-core x86 box:

```
AtomicLong threads= 1 ops=130.0 M/s
LongAdder  threads= 1 ops= 95.0 M/s
AtomicLong threads= 8 ops= 18.0 M/s
LongAdder  threads= 8 ops=400.0 M/s
```

Single-threaded, `AtomicLong` wins. Multi-threaded with contention, `LongAdder` is more than 20× faster.

## Pros & Cons

**Pros of senior-level atomic techniques.**

- **Linear or near-linear scalability** when contention is the bottleneck and the data structure supports striping.
- **Lower latency than mutex-based code** on short hot paths, especially when wait time is short.
- **No deadlock risk** from atomics themselves (though livelock is possible).
- **Composable across async runtimes** that cannot block on a mutex (e.g., async-only contexts in Rust or Java loom).
- **Cache-friendly designs** like Disruptor avoid GC pressure entirely.

**Cons.**

- **Complexity is multiplicative.** Every operation must be verified against every interleaving and every reclamation scenario.
- **Reclamation is hard outside GC languages.** Hazard pointers and EBR add their own overhead and memory cost.
- **Tooling is weaker.** Debuggers cannot single-step through races; bugs may take months to reproduce.
- **Cache effects dominate intuition.** Code that looks scalable can collapse under false sharing.
- **Portability across architectures is hard.** Code written and tested on x86 may break on ARM.
- **Maintenance cost is high.** Future maintainers may not understand the invariants and introduce subtle bugs.

## Use Cases

- **High-throughput counters and metrics.** `LongAdder` patterns power StatsD, Dropwizard Metrics, Prometheus client libraries.
- **Lock-free queues for low-latency messaging.** LMAX Disruptor in trading systems; `crossbeam` channels in Rust services.
- **Concurrent caches.** Caffeine's hot path uses CAS-driven LRU updates; `Cache::get` is lock-free.
- **Lock-free hash maps.** `ConcurrentHashMap` in Java, `dashmap` in Rust, `folly::ConcurrentHashMap` in C++.
- **OS kernels.** Linux dcache, page cache, networking stack all use RCU.
- **Garbage collectors themselves.** ZGC and Shenandoah use atomic load barriers for concurrent marking.
- **Connection pools.** Lock-free claim of free connection slots avoids serialization.
- **Logging frameworks.** Log4j 2 async logger uses LMAX Disruptor for backend handoff.
- **Async runtimes.** Tokio's work-stealing scheduler uses lock-free deques for per-worker run queues.

## Coding Patterns

- **Help, don't wait.** When a CAS shows the structure is in transit (e.g., lagging tail), help complete the previous operation rather than spinning.
- **Acquire-release pairs.** Every release store on a pointer must be matched by an acquire load on every reader. Otherwise, the reader may see a stale pointer to fresh data.
- **Pad to cache line.** Any atomic field that is written by multiple threads should sit on its own cache line.
- **Stripe writes, sum reads.** Convert single-counter hotspots into per-stripe counters with periodic summation.
- **Single writer.** Where possible, restructure so each piece of state has one writer; this eliminates write contention entirely.
- **Defer reclamation.** Never `free` a node directly after CAS-unlinking it. Use hazard pointers, EBR, RCU, or GC.
- **Backoff in CAS loops.** Add exponential backoff or `pause`/`yield` after several failed CAS attempts to avoid live cache-line ping-pong.
- **Linearization point comment.** Document, in the code, the single point at which each operation linearizes.

## Clean Code

- **Name atomic types with their semantics.** `AtomicReference<TailNode>` is clearer than `AtomicReference<Node>`.
- **Comment every CAS with what it linearizes.** Reviewers cannot reverse-engineer the invariant; you must state it.
- **Extract retry loops into named methods.** `enqueueImpl` should not have eight `continue` statements with no comments.
- **Encapsulate hazard pointer management.** Don't let callers see the raw `hazptr` API; provide an `AutoProtect` RAII helper.
- **Document the memory model assumptions at the top.** "This code assumes x86 TSO; on ARM the loads in `pop` need to be acquire."
- **Provide a single-threaded reference implementation.** Test the lock-free version against it under stress to catch races.
- **Centralize cache-padding utilities.** Wrap `@Contended` in a `Padded<T>` type to avoid sprinkling annotations.
- **Avoid clever tricks where boring works.** Use `ConcurrentLinkedQueue` until profiling proves you need MS-queue.

## Best Practices

- **Start with locked code, benchmark, then go lock-free.** Atomic code without a baseline is unjustifiable.
- **Use battle-tested libraries.** `java.util.concurrent.atomic`, `crossbeam`, `folly::AtomicHashMap`. Hand-rolled lock-free code is an audit liability.
- **Test on the target architecture.** x86 CI does not validate ARM correctness. Run a stress suite on Graviton or M-series in CI.
- **Use TSan / ThreadSanitizer / loom.** These tools catch races that JCStress and unit tests miss. `loom` for Rust enumerates interleavings exhaustively for small models.
- **Measure cache misses, not just throughput.** A benchmark that hits the L1 perfectly tells you nothing about production where the working set is huge.
- **Set explicit memory ordering.** Don't rely on `seq_cst` defaults if you can correctly use `acquire`/`release`; but also don't downgrade to `relaxed` without proof.
- **Pad shared atomic fields.** Default to `CachePadded` for any atomic in a struct that has other atomics.
- **Plan for reclamation upfront.** "I'll add hazard pointers later" is a code smell; the design changes once reclamation is in.
- **Document the invariant.** Write the invariant the algorithm preserves in plain English at the top of the file.
- **Limit the blast radius.** Lock-free code should be encapsulated behind a clean interface. Don't expose `AtomicReference<Node<T>>` to callers.

## Edge Cases & Pitfalls

- **ABA in non-GC languages.** A pointer compares equal but the pointed-to memory was freed and reallocated. Solutions: tagged pointers, hazard pointers, EBR.
- **Compiler reordering of plain (non-atomic) accesses.** Surrounding plain loads/stores around an atomic operation can be reordered by the compiler; use `volatile` (Java) or atomic operations all the way through.
- **The 32-bit `long` tearing trap.** On 32-bit JVMs, non-volatile `long` reads may tear. `volatile long` is atomic; plain `long` is not.
- **Spurious CAS failure on LL/SC architectures.** On ARM, `compare_exchange_weak` may fail even when values match, due to context switches. Use `_strong` when you cannot retry.
- **Memory budget explosion under EBR.** A blocked thread pins the epoch and prevents reclamation, causing unbounded memory growth.
- **False sharing across allocator alignment.** Even with `alignas(64)`, the C `malloc` may not honor it. Use `posix_memalign` or aligned allocators.
- **Hazard pointer slot exhaustion.** If you have more hazard pointers per op than slots, you cannot protect them all.
- **Release without acquire pair.** Publishing with a release store but reading with a relaxed load gives no guarantee of visibility.
- **Mixing volatile and atomic on the same field.** Don't. Pick one model and stick with it.
- **CAS loops that never make progress** because the contention always wins. Add backoff or fall back to a mutex.
- **Disruptor consumer starvation.** A slow consumer blocks the entire ring; you must monitor consumer lag.

## Common Mistakes

- **Assuming GC saves you from races.** GC saves you from use-after-free, not from races. Two threads can still see inconsistent state.
- **Using `lazySet` for publication.** `lazySet` is a release store but skips the StoreLoad fence in some implementations; do not use it for hand-off where the reader must see fresh data.
- **Sharing `AtomicReference` for high-throughput counters.** Use `LongAdder` or per-thread accumulation.
- **Reading the same atomic twice and assuming the values match.** They might not — another thread wrote in between. Snapshot once.
- **Treating `compareAndSet` like a lock.** It is not. There is no waiting, no fairness, no priority — just a race.
- **Adding `volatile` on every field "for safety."** This adds fences everywhere and destroys performance without helping correctness.
- **Believing benchmark results from a single thread.** The interesting question is "what happens at 32 threads on 32 cores."
- **Forgetting that GC pauses break invariants you assumed.** If a CAS retry loop runs during a GC safepoint, you may see different timings than expected.

## Tricky Points

- **MS-queue's "lagging tail" is a feature, not a bug.** The algorithm is correct even when `tail` is stale, because every operation re-checks and helps. Removing the helping step breaks the algorithm.
- **Release stores are visible to subsequent acquire loads of the same memory, not to all loads.** Two acquire loads from different memory locations are not ordered relative to each other.
- **`AtomicReference.compareAndSet(expected, new)` returns boolean.** Many bugs come from ignoring the return value and assuming the CAS succeeded.
- **Memory order strength is partially ordered.** `relaxed < consume < acquire < release < acq_rel < seq_cst`, but `acquire` and `release` are not comparable to each other.
- **Java's `volatile` is stronger than C++'s `volatile`.** Do not transfer intuition between languages.
- **The "publish" pattern requires acquire on the consumer.** If you publish via a release store on a flag, and the consumer reads the flag with a plain load, you have a race.
- **Single-writer Disruptor invariants break under multi-writer.** You cannot trivially extend Disruptor to multi-producer; the multi-producer variant is more complex.
- **`Atomic<T>` types in C++ are NOT lock-free for arbitrary T.** Only sizes that fit in CPU atomic primitives (8, 16, 32, 64, 128 bits) are guaranteed lock-free. Larger structs may take an internal lock.
- **RCU readers must not block.** A reader that sleeps inside an RCU read-side critical section can stall all reclamation.

## Test Yourself

1. Why is the Michael-Scott queue still considered the canonical lock-free MPMC queue?
2. What is the precise distinction between lock-free and wait-free, and why is wait-free rarely used in production?
3. How do hazard pointers prevent use-after-free, and what is the per-read cost?
4. What is the trade-off between EBR and hazard pointers?
5. Why does `LongAdder` beat `AtomicLong` under contention but lose under no contention?
6. Show how to detect false sharing with `perf c2c`.
7. Explain why `release` followed by `acquire` synchronizes two threads but `relaxed` does not.
8. What is the ABA problem and what are three solutions in non-GC languages?
9. Why is the LMAX Disruptor not strictly lock-free, yet considered a benchmark for high-throughput messaging?
10. What does the `lock` prefix actually do at the cache level on x86?
11. Why do CAS loops without backoff sometimes scale worse than locks?
12. Explain how RCU achieves zero-overhead reads in the Linux kernel.
13. What is the failure mode of a hazard pointer scheme with too few hazard slots?
14. Why do you need to re-check `tail` after reading `tail.next` in MS-queue enqueue?
15. What does `@Contended` do, and why is `-XX:-RestrictContended` needed?

## Tricky Questions

1. **Two threads, two `AtomicLong` counters, each thread increments only its own counter. Why is this slow?** Because the counters share a cache line (false sharing). Pad them.
2. **You replace a mutex with `AtomicReference` CAS loop and throughput drops. Why?** Likely under high contention with short critical section. CAS retries dominate; mutex's queue is more efficient.
3. **MS-queue enqueue did the first CAS but crashed before the second CAS. Is the queue corrupted?** No. The next enqueue or dequeue will see `tail.next != null` and help complete the operation.
4. **Your Rust lock-free stack works on x86 but segfaults on ARM. What is the most likely cause?** Missing acquire ordering on a load, allowing reordering that lets a thread dereference uninitialized memory.
5. **`LongAdder.sum()` returns 0 even though increments are in flight. Race?** Yes — `sum()` is not atomic across cells. It is approximate by design.
6. **Your hazard pointer scheme works in tests but production runs OOM after a week. Why?** A long-running thread that never publishes a free hazard slot — perhaps stuck in a loop — pins memory.
7. **CAS succeeds but the linked structure is still inconsistent. Bug?** Possibly ABA: the pointer matched, but the underlying memory was reallocated. Tagged pointers solve this.
8. **You wrote a lock-free queue and it deadlocks under load.** Lock-free code cannot deadlock from CAS itself, but it can livelock; or you may have introduced a hidden lock (allocator, logger) that does deadlock.
9. **A Disruptor consumer falls behind. What happens?** Producers eventually block waiting for the consumer to advance, because slots cannot be overwritten until consumed. The whole ring stalls.
10. **`AtomicReference.set()` vs `lazySet()` — when does it matter?** `set()` is a volatile write with a StoreLoad fence; `lazySet()` is a release store. Use `set()` for publication that must be immediately visible; `lazySet()` only when you know no concurrent reader needs the StoreLoad guarantee.

## Cheat Sheet

| Concept                     | Quick Rule                                                          |
| --------------------------- | ------------------------------------------------------------------- |
| Lock-free                   | System makes progress; one thread may starve                        |
| Wait-free                   | Every thread makes progress in bounded steps                        |
| Michael-Scott queue         | Canonical lock-free FIFO; two CAS per op                            |
| Hazard pointer              | Per-thread published pointer; bounded memory; fence per read        |
| EBR                         | Cheap reads but unbounded memory if a thread stalls                 |
| RCU                         | Zero-cost reads; grace period for reclamation                       |
| False sharing               | Pad atomic fields to 64-byte cache lines                            |
| `LongAdder`                 | Striped counter; great for write-heavy, cheap reads                 |
| Disruptor                   | Single-writer ring buffer; zero allocation                          |
| x86 memory model            | TSO; almost free acquire/release                                    |
| ARM memory model            | Weak; explicit `ldar`/`stlr` cost real cycles                       |
| `lock cmpxchg` cost         | 20-40 cycles uncontended; hundreds contended                        |
| CAS retry signal            | Add backoff after 4-8 failed CAS                                    |
| `@Contended`                | Java only; needs `-XX:-RestrictContended`                           |
| ABA                         | Use tagged pointers, hazard pointers, or GC                         |
| `volatile long` in Java     | Atomic read and write; non-volatile may tear on 32-bit              |
| When to NOT go lock-free    | Heavy contention with critical section > 50 ns                      |
| Profiling tool              | `perf c2c` for cache contention; JFR for JVM                        |

## Summary

Senior-level atomic operations are not about reaching for `AtomicInteger` more often. They are about understanding that every atomic operation is a transaction on the cache coherence protocol; that contention, false sharing, and memory ordering are the real performance levers; and that correctness in a lock-free data structure requires reasoning about every interleaving and every reclamation scenario. The Michael-Scott queue, hazard pointers, EBR, RCU, and the LMAX Disruptor are the canonical building blocks. `LongAdder`-style striping is the canonical scaling pattern for contended counters. Padding to cache lines is the canonical fix for false sharing. Knowing when *not* to use atomics — under heavy contention with short critical sections — is just as important as knowing when to use them.

The senior posture is one of measurement-driven humility. You do not assume lock-free is faster; you benchmark with multiple thread counts on the target architecture, measure cache misses with `perf c2c`, and validate correctness with stress tests and tools like JCStress, loom, and TSan. You document the linearization point and invariant of every lock-free operation. You prefer well-tested library primitives over hand-rolled code, and you reach for hand-rolled atomics only when profiling proves the library is the bottleneck. When you do reach for them, you plan reclamation upfront, you stripe to reduce contention, and you pad to eliminate false sharing.

## What You Can Build

- A high-throughput metrics library competitive with Dropwizard or Prometheus.
- A lock-free MPMC queue benchmark suite comparing MS-queue, LCRQ, and Disruptor variants.
- A custom EBR-based reclamation framework for a Rust embedded database.
- An RCU implementation for a user-space routing table for a software switch.
- A high-performance connection pool with lock-free slot claim and per-shard waiters.
- A cache with single-writer ring-buffer write-back, inspired by Disruptor.
- A wait-free atomic counter using helping techniques, for academic study.
- A custom JCStress test suite that validates your in-house concurrent data structures.
- A microbenchmark harness with NUMA-aware thread pinning to measure cache effects properly.
- A telemetry system that detects production cache-line contention via PMU counters.

## Further Reading

- Maged Michael, Michael Scott — "Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms" (1996). The MS-queue paper.
- Maurice Herlihy, Nir Shavit — *The Art of Multiprocessor Programming*, second edition. The graduate textbook.
- Paul McKenney — "Is Parallel Programming Hard, And, If So, What Can You Do About It?" Free book, kernel-focused, deep on RCU.
- Adam Morrison, Yehuda Afek — "Fast Concurrent Queues for x86 Processors" (2013). LCRQ paper.
- Trisha Gee, Martin Thompson — LMAX Disruptor technical paper.
- Doug Lea — `java.util.concurrent.atomic.LongAdder` source. Read it.
- Intel Software Developer Manual, Volume 3A, Chapter 8: Memory Ordering.
- ARM Architecture Reference Manual ARMv8, section B2: The AArch64 Application Level Memory Model.
- Hans Boehm — "Threads Cannot be Implemented as a Library." On memory model fundamentals.
- Preshing on Programming blog — Series on memory barriers and lock-free programming.
- Linux kernel documentation: `Documentation/RCU/`.
- `crossbeam` Rust crate documentation, especially `crossbeam-epoch`.
- Folly source code: `folly/concurrency/` and `folly/synchronization/Hazptr.h`.

## Related Topics

- [Memory model](../../../memory-management/README.md) — happens-before relationships ground all atomic semantics.
- [Locks and mutexes](../03-mutex/README.md) — the alternative; understand the trade-off.
- [Memory ordering and fences](../05-memory-ordering/README.md) — acquire, release, seq-cst at the instruction level.
- [Cache coherence and false sharing](../../../../quality-engineering/performance/README.md) — the hardware reality behind atomic costs.
- [Concurrent data structures](../../README.md) — the structures that build on these primitives.
- [GC and memory reclamation](../../../memory-management/README.md) — the management-runtime alternative to hazard pointers.

## Diagrams & Visual Aids

### Michael-Scott queue state during a concurrent enqueue

```
Initial state:
  head --> [sentinel] --> [A] --> [B] <-- tail

Thread T1 starts enqueue(C):
  T1 reads tail = [B]
  T1 reads tail.next = null
  T1 CAS tail.next: null -> [C]    SUCCESS
  Queue is now:
  head --> [sentinel] --> [A] --> [B] --> [C]
                                   ^
                                   tail (LAGGING)
  Before T1 advances tail, T2 starts enqueue(D):
  T2 reads tail = [B]
  T2 reads tail.next = [C]         (sees lagging tail!)
  T2 helps: CAS tail: [B] -> [C]   SUCCESS
  T2 retries from top, sees fresh tail
  T2 CAS [C].next: null -> [D]     SUCCESS
  T2 advances tail to [D]
```

### Cache-line ping-pong vs padded counters

```
SHARED CACHE LINE (false sharing):

  Cache line [a | b | ... | padding]
    Core 1 writes a: line goes to M on Core 1, I on Core 2
    Core 2 writes b: line bounces to M on Core 2, I on Core 1
    Core 1 writes a: bounces back ...
  Result: every write costs a coherence round-trip.

PADDED (one cache line each):

  Cache line [a | padding] on Core 1 in M state
  Cache line [b | padding] on Core 2 in M state
  No coherence traffic. Linear scaling.
```

### Hazard pointer protection

```
Reader thread R wants to use node N:
  R publishes N's address into hazard_slot[R]
  R issues fence
  R re-reads the shared pointer to confirm it still points to N
  R uses N

Writer thread W wants to free node M:
  W scans every hazard_slot
  If M's address appears anywhere, W defers free
  Else W frees M
```

### Epoch-based reclamation timeline

```
Epoch counter: 0 -------> 1 -------> 2 -------> 3

Thread A: |--- pin in 0 ---| ......... |--- pin in 2 ---|
Thread B:           |--- pin in 1 ---| ......... |--- pin in 3 ---|

Node X unlinked during epoch 1.
  -> X goes on limbo_list[1]
  -> Free when no thread is still in epoch 1.
  -> When B leaves epoch 1 (at start of epoch 3), and A has left epoch 0,
     limbo_list[1] becomes safe.
```

### `LongAdder` cell striping

```
On contention:
  Thread T1 (hash=3) increments cells[3]
  Thread T2 (hash=7) increments cells[7]
  Thread T3 (hash=2) increments cells[2]

  Read: sum(cells[0..N])
  Writes: parallel, no contention
  Reads: O(N) but rare
```

### x86 vs ARM CAS cost comparison

```
x86 atomic increment:
  lock add [counter], 1
  ~25 cycles uncontended

ARM atomic increment:
  ldaxr  w0, [counter]   ; load-acquire-exclusive
  add    w0, w0, 1
  stlxr  w1, w0, [counter] ; store-release-exclusive
  cbnz   w1, retry
  ~30-40 cycles uncontended (LL/SC pair)
```

### Lock-free vs locked under contention (qualitative)

```
Throughput (ops/sec)
        |
        |        --- Locked mutex (with queue)
        |       /
        |      /  ___ Lock-free CAS with backoff
        |     / /
        |    //
        |   //  ____ Lock-free CAS no backoff
        |  ///
        | ////
        |/
        +----------------------> contention (thread count)

Lock-free without backoff degrades fast; with backoff it tracks locked.
```

### MS-queue tail-update protocol

```
enqueue protocol:
  1. read tail T
  2. read T.next
  3. recheck tail; if changed, restart
  4. if T.next != null: help advance tail (CAS), restart
  5. CAS T.next: null -> newNode
        success -> step 6
        failure -> restart
  6. CAS tail: T -> newNode  (failure OK; another thread already advanced)
```
