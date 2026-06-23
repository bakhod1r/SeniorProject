# Shared-Memory Concurrency — Senior Level

> **Topic:** [Shared-Memory Concurrency Roadmap](README.md)
> **Focus:** System-level consequences of shared-memory concurrency — cache coherence, NUMA effects, contended-lock pathologies, lock-free/wait-free design, formal memory models, and how to diagnose all of this in production.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Trade-offs](#trade-offs)
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

> 🎓 At junior level you learned what a mutex is. At middle level you learned how the language enforces happens-before. At senior level you must answer a harder question: **when the lock is held for 40 nanoseconds, why does the program still spend 60% of its time inside `lock()`?** The answer lives below the language — in cache lines, in the coherence protocol, in the memory controller, and in the way the OS scheduler interacts with the runtime.

Shared-memory concurrency is the abstraction every modern CPU sells you, but the hardware does not actually have shared memory. It has per-core caches, a coherence protocol that pretends those caches are one memory, and a memory controller (or several) that is far slower than the cores it serves. Every `mutex.Lock()` you write is a contract you sign with that machinery. At senior level, you are the person who reads the contract.

This level is about consequences. The same mutex that protects a 10-line critical section can be invisible at 4 cores, expensive at 16, and a scaling cliff at 64. The same `volatile` field that fixed your double-checked locking in Java 5 was a no-op in Java 1.4 and undefined in C++ until C++11. The same lock-free queue that is "obviously faster" on a benchmark may be slower than a plain mutex once you account for memory reclamation. We will walk through all of this with real protocols (MESI/MOESI), real bugs (Mars Pathfinder), real fixes (JSR-133), and real diagnostic tools (`perf c2c`, JFR, `runtime/trace`).

## Prerequisites

- Solid grasp of the [junior](junior.md) and [middle](middle.md) levels: what locks, happens-before, and data races are.
- Comfort reading assembly at the level of "this is `lock cmpxchg`, this is a memory barrier."
- Familiarity with at least one language's memory model — preferably the Java or C++ one — see [`../../03-patterns/`](../../03-patterns/) and [`../../05-race-conditions/senior.md`](../../05-race-conditions/senior.md).
- Working knowledge of atomics: see [`../../02-primitives/04-atomic/senior.md`](../../02-primitives/04-atomic/senior.md).
- You should have profiled a program at least once with `perf`, JFR, or `go tool pprof`.

## Glossary

| Term | Meaning |
| --- | --- |
| **MESI / MOESI** | Cache-line coherence protocols: states a line can be in (Modified, Exclusive, Shared, Invalid; +Owned for MOESI). |
| **Cache line** | Unit of coherence, typically 64 bytes. Two unrelated variables in the same line still contend. |
| **False sharing** | Two threads writing to different variables that happen to live in the same cache line, causing coherence traffic. |
| **NUMA** | Non-Uniform Memory Access — memory attached to a specific socket; remote-socket access is 1.5-3× slower. |
| **Convoy effect** | A slow lock holder causes a queue of waiters that survives the original cause; throughput collapses. |
| **Lock-free** | At least one thread makes progress in a bounded number of steps. Blocking is forbidden. |
| **Wait-free** | *Every* thread makes progress in a bounded number of its own steps. Strictly stronger than lock-free. |
| **ABA problem** | A value reads A, changes to B, changes back to A; CAS thinks nothing happened, but it did. |
| **Hazard pointer** | A per-thread "do not free" mark on a pointer the thread is using. |
| **Epoch-based reclamation (EBR)** | Defer frees to an epoch when no thread is in a critical section. |
| **RCU** | Read-Copy-Update: readers run lock-free; writers publish a new copy and free the old after a grace period. |
| **HTM** | Hardware Transactional Memory (Intel TSX, IBM POWER): hardware speculatively executes a region, rolls back on conflict. |
| **Lock elision** | Speculatively skip a lock using HTM; fall back to real locking on abort. |
| **Biased locking** | JVM optimization: a lock "biases" toward the last thread to hold it, making re-entry near-free. Removed in JDK 15. |
| **MVCC** | Multi-Version Concurrency Control: the database keeps multiple row versions so readers never block writers. |
| **Snapshot isolation** | Each transaction sees a consistent snapshot taken at start. Implemented via MVCC. |
| **`perf c2c`** | Linux perf tool for diagnosing cache-line contention and false sharing. |
| **JFR** | Java Flight Recorder — low-overhead event recorder; has built-in lock contention events. |

## Core Concepts

### 1. Cache coherence protocols (MESI / MOESI)

Modern CPUs do not share memory directly. Each core has its own L1/L2 cache, and a coherence protocol — MESI on Intel, MOESI on AMD — ensures the illusion. Every cache line is tagged with a state:

- **M (Modified)** — this core has the only valid copy, and it is dirty (not yet in memory).
- **E (Exclusive)** — this core has the only valid copy, and it is clean.
- **S (Shared)** — multiple cores have read-only copies.
- **I (Invalid)** — this cache does not have a valid copy.
- **O (Owned, MOESI only)** — like Modified, but the line is also Shared with others; this core owes writeback.

A write to a cache line in Shared state must transition every other copy to Invalid before the write completes. That transition is a coherence message on the interconnect (QPI, UPI, Infinity Fabric). For uncontended data this is invisible; for contended data it dominates execution time. A `lock cmpxchg` on a heavily-shared cache line can cost **300+ cycles** instead of the 4-5 cycles of an uncontended atomic.

Practical consequence: the cost of a mutex is not "the cost of `lock()`," it is "the cost of moving the cache line containing the lock between cores." That is why a per-thread counter (one cache line per thread) scales linearly, and a single shared counter does not.

### 2. NUMA and the scaling cliff

Past a single socket, "shared memory" stops being a useful lie. On a two-socket Xeon, the memory controller on socket 0 owns half the DRAM; socket 1 owns the other half. A core on socket 1 reading a line owned by socket 0's controller pays roughly 1.5-3× the latency of a local access. Coherence between sockets traverses an even slower inter-socket link.

A lock-protected counter that scales fine within one socket (8-16 cores) can fall off a cliff at 18 cores because the 17th and 18th threads are scheduled on the other socket. The lock line ping-pongs across the inter-socket link on every acquire. The scaling curve goes flat or even negative.

Solutions: NUMA-aware allocators (`numactl`, `libnuma`, `set_mempolicy`), per-socket sharding, and locks designed to keep ownership local (cohort locks, hierarchical CLH locks). The [`../../02-primitives/01-mutex/senior.md`](../../02-primitives/01-mutex/senior.md) file goes deeper.

### 3. Contended-lock pathologies

A contended lock is not just "slower," it has specific failure modes:

- **Convoy effect.** Thread A grabs a lock, gets preempted by the OS. Threads B, C, D... pile up on the wait queue. When A resumes and releases, B runs. By the time D runs, A is already back, the cache is cold, throughput tanks. The original delay was 1 ms; the convoy lasts seconds.
- **Lock thrashing.** Holders are constantly preempted because the critical section is too long relative to the OS time slice. CPUs spend more time in context switches than work.
- **Priority inversion.** A low-priority thread holds a lock. A high-priority thread waits. A medium-priority thread preempts the low one. Now the high thread is blocked by the medium one indirectly. NASA's **Mars Pathfinder** hit this in 1997: the bus management task (high priority) blocked on a pipe owned by the meteorological data task (low priority), while a medium-priority communications task hogged the CPU. The watchdog reset the system repeatedly until JPL engineers enabled VxWorks's priority inheritance, debugged it from Earth, and uploaded the fix.

Fixes: priority inheritance / priority ceiling protocols, lock-free or RCU-style structures for hot paths, and shorter critical sections.

### 4. Lock-free vs wait-free

These terms have **precise** meanings; treat them carefully:

- **Lock-free**: the system as a whole makes progress. At least one thread always completes an operation in finitely many steps, no matter what others are doing. A starved individual thread is allowed.
- **Wait-free**: *every* thread completes its operation in a bounded number of its own steps. No starvation is possible.

Wait-free is strictly stronger and dramatically harder to design. Most "lock-free" data structures (Treiber stack, Michael-Scott queue) are not wait-free. Wait-free queues exist (Kogan-Petrank 2011) but are slower than locks for low contention.

The performance reality: **lock-free is often slower than a well-tuned mutex** when contention is low, because every operation pays CAS overhead and memory-barrier costs even when nobody else is touching the structure. Lock-free shines under high contention or when you genuinely cannot tolerate blocking (real-time, signal handlers, kernel paths).

### 5. The C++ / Java memory model formalisms

A formal memory model defines which executions of a concurrent program are legal. Three relations matter:

- **Sequenced-before** — single-thread program order.
- **Synchronizes-with** — cross-thread ordering established by, e.g., a release-store paired with an acquire-load on the same atomic, or a mutex unlock paired with the next lock.
- **Happens-before** — the transitive closure of sequenced-before and synchronizes-with. If a write happens-before a read, the read sees that write (or a later one).

**Java's JSR-133 saga.** Before Java 5, the Java Memory Model (JMM) did not guarantee that a `volatile` write established happens-before with a subsequent `volatile` read of a *different* field. This broke the famous double-checked locking idiom:

```java
class Holder {
  private static Singleton instance;          // not volatile (pre-JSR-133 broken code)
  public static Singleton get() {
    if (instance == null) {
      synchronized (Holder.class) {
        if (instance == null) instance = new Singleton();
      }
    }
    return instance;
  }
}
```

The constructor of `Singleton` runs *before* the assignment to `instance` in source order, but the JVM (or CPU) could reorder them so that another thread saw a non-null `instance` pointing at a half-constructed object — fields default-initialized to null/zero. JSR-133 (Java 5, 2004) fixed this by giving `volatile` cross-field happens-before semantics: making `instance` `volatile` makes the idiom correct.

C++ went further with `std::memory_order` (C++11), exposing `relaxed`, `acquire`, `release`, `acq_rel`, `consume`, `seq_cst` directly to the programmer. Power, granted at the cost that almost nobody writes provably correct non-`seq_cst` code.

### 6. Reader-writer scaling traps

`RWMutex` ("many readers OR one writer") seems strictly better than `Mutex` for read-heavy workloads. It often is not, for a specific reason: every reader acquisition must atomically update a shared reader-count. Under high read concurrency, that counter is a hot cache line — exactly the contention you were trying to avoid.

Measured reality on Go's `sync.RWMutex` and Java's `ReentrantReadWriteLock`:

- Very long critical sections (I/O, complex computation): RWMutex wins clearly.
- Brief critical sections (a few field reads): RWMutex *loses* to plain Mutex above ~8 cores, because the reader-count CAS dominates the actual work.
- Mixed read/write traffic: writers can starve readers or vice versa depending on the policy.

Modern alternatives: **sharded locks** (one per N keys), **RCU**, **seqlocks** (readers retry on conflict, no writes to shared state for readers).

### 7. Hazard pointers, EBR, and RCU

The fundamental problem of lock-free data structures: when can you free a node? In a lock-free queue, a reader may hold a pointer to a node the writer just unlinked. Free the node, and the reader segfaults.

Three families of solutions:

- **Hazard pointers (Michael 2004).** Each thread publishes the pointer it is currently dereferencing in a per-thread "hazard" slot. The reclaimer scans all slots before freeing. Constant-space, O(threads) reclaim cost.
- **Epoch-based reclamation (EBR).** Threads enter an "epoch" before touching shared structures. Frees are deferred to an epoch when no thread is still in the prior epoch. Lower per-operation overhead than hazard pointers, but a stalled thread can pin epochs and bloat memory.
- **RCU (Read-Copy-Update).** Used pervasively in the Linux kernel. Readers run with no synchronization at all (just a per-CPU disable-preemption marker). Writers publish a new copy via an atomic pointer swap, then wait for a "grace period" — until every CPU has scheduled at least once — before freeing the old copy. Reads cost essentially zero. Writers pay the grace-period latency.

RCU is why Linux can sustain millions of reads per second on `/proc` and routing tables with no read-side locking at all.

### 8. Software vs hardware transactional memory

Transactional memory says: write a critical section as `atomic { ... }` and let the runtime detect conflicts and retry. Two flavors:

- **STM (software).** Pure software bookkeeping. Clojure refs, Haskell's `STM` monad, GHC. Composable, no hardware required, but high per-operation overhead (often 3-10× a hand-tuned lock).
- **HTM (hardware).** Intel's TSX (Haswell 2013+), IBM POWER8+. The CPU speculatively executes a region; if a conflicting access happens or the working set exceeds L1, the transaction aborts and software must fall back.

**Why HTM failed commercially.** Intel TSX shipped with errata: on Haswell, certain microcode bugs forced disabling TSX entirely via microcode updates. On Skylake, side-channel attacks (TSX Asynchronous Abort, TAA) led OS vendors to disable TSX by default. By 2021 Intel deprecated TSX in client CPUs. HTM remains alive in IBM POWER and zSeries mainframes, but the mainstream x86 promise of "make all your locks elidable" did not survive.

### 9. Lock elision and biased locking

JVM-side optimizations targeted single-threaded fast paths:

- **Biased locking.** A lock biases toward the last thread to hold it; that thread can re-enter without any CAS, just a flag check. If another thread shows up, the bias is revoked at a cost. Worked well for single-threaded code paths in heavily-locked APIs (`Vector`, `StringBuffer`). **Removed in JDK 15** because revocation costs hurt modern multi-threaded workloads more than the bias helped.
- **Lock elision.** Use HTM (where available) to speculatively skip the lock entirely. The CPU monitors the region; if no conflict, the lock was effectively free. Promising in theory, marginal in practice once TSX was disabled.

### 10. Choosing actors, channels, or shared memory at senior level

By senior level the question is not "which is best?" but "which fits the failure mode I am most afraid of?":

| Concern | Use shared memory + locks | Use channels (CSP) | Use actors |
| --- | --- | --- | --- |
| Lowest latency per op | ✅ atomics + locks | ⚠️ channel hop adds nanoseconds | ❌ mailbox + scheduler |
| Reasoning under partial failure | ❌ shared state is corrupt | ⚠️ buffered channels can lose | ✅ supervision trees |
| Distribution across machines | ❌ no such thing | ⚠️ need a network channel | ✅ location-transparent |
| Cache-locality | ✅ tune to L1/L2 | ⚠️ ownership transfer | ⚠️ mailbox per actor |
| Backpressure | ❌ manual | ✅ bounded channels | ✅ mailbox bounds |

In practice big systems mix all three: shared memory inside one process for the hot paths, channels between subsystems, actors at process boundaries.

### 11. Databases as the production answer

Databases solved shared-memory concurrency at scale before our languages did. The vocabulary you use in code maps directly to the one DBs use:

- **MVCC** is RCU for transactions. Postgres, Oracle, and InnoDB keep multiple row versions; readers see the version valid at transaction-start time. No reader blocks a writer.
- **Snapshot isolation** is the SQL-level analogue of acquire/release semantics: each transaction sees a consistent view; conflicts at commit time abort the loser.
- **Serializable** isolation in Postgres uses Serializable Snapshot Isolation (SSI), which adds conflict tracking on top of MVCC.

The mental bridge: when you design a lock strategy for in-memory data, ask "how would Postgres do this?" Often the answer (versioned reads + atomic commit pointer) is faster and simpler than a hand-rolled RWMutex.

See [`../../../databases/transactions/`](../../../databases/) for the database side of this story.

### 12. Profiling and detection in production

You cannot fix what you cannot measure:

- **Linux `perf c2c`** — diagnoses cache-line contention. Shows you the exact source line of HITM (modified-line hit) events: "thread X on core 4 modified line L last; thread Y on core 12 is loading it now." False sharing jumps out.
- **`perf lock`** — kernel-side lock contention.
- **Java Flight Recorder** — built-in `jdk.JavaMonitorEnter`, `jdk.ThreadPark` events; JMC visualizes hot locks.
- **Go `runtime/trace`** — shows goroutine blocking, lock-wait time, and (since Go 1.21) a "mutex profile" via `runtime.SetMutexProfileFraction`.
- **`go test -race`, ThreadSanitizer (`-fsanitize=thread`)** — dynamic race detectors. Mandatory in CI.
- **eBPF** — custom probes on `futex_wait` give you contention histograms with no application changes.

## Real-World Analogies

| Concept | Real-world analogy |
| --- | --- |
| Cache coherence | Whisper network: when one person learns a fact, everyone who repeated it must be notified the old version is wrong. |
| False sharing | Two roommates editing different documents on the same desk; they keep bumping each other even though their work is unrelated. |
| NUMA | A factory with two warehouses; workers near warehouse A are fast; workers from across the road are slow. |
| Convoy effect | A turnstile jammed for 2 seconds creates a 5-minute queue. |
| Priority inversion | The CEO is waiting on the intern who is stuck behind a chatty middle manager. |
| Lock-free | A queue at a coffee shop where someone is always being served, even if some specific customer waits a long time. |
| Wait-free | A queue where every customer has a guaranteed maximum wait. |
| Hazard pointers | Library books: you put a "do not reshelve" tag on every book you are reading. |
| RCU | The newspaper: writers print new editions; readers keep their old copy until they pick up the next one. |
| MVCC | Wikipedia article history — every edit creates a new version, readers see a snapshot. |
| HTM | A bar tab: drink first, settle conflicts at the end of the night. |

## Mental Models

### "The cache line is the unit of contention"

Stop thinking in variables. Start thinking in 64-byte lines. Two atomic counters in the same struct contend even if no code ever touches both. Three booleans in a struct become a coherence bottleneck. The compiler, the layout, and `alignas(64)` / `//go:linkname` padding are now part of your concurrency design.

### "Every lock has a coherence cost equal to the line bounce"

A `mutex.Lock()` is not "issue a CAS." It is "move the cache line holding the mutex from whatever core last touched it to this core, invalidating it everywhere else." That bounce is a constant 80-300 cycles. Multiply by lock-acquisition rate. That is your floor; the actual critical section adds to it.

### "Reasoning about happens-before is a graph problem"

Draw the threads as columns, operations as nodes, synchronizes-with relations as arrows. The visible state at a node is exactly the union of writes reachable backward through this graph. If you cannot draw the arrow that connects writer to reader, the read is racy.

## Code Examples

### Go — false sharing benchmark

```go
package main

import (
	"sync"
	"sync/atomic"
	"testing"
)

// Naively packed counters share a cache line.
type packed struct {
	a, b, c, d uint64
}

// Padded counters live on their own line each.
type padded struct {
	a   uint64
	_   [56]byte
	b   uint64
	_   [56]byte
	c   uint64
	_   [56]byte
	d   uint64
	_   [56]byte
}

func BenchmarkPackedFalseSharing(b *testing.B) {
	var p packed
	var wg sync.WaitGroup
	wg.Add(4)
	per := b.N / 4
	go func() { for i := 0; i < per; i++ { atomic.AddUint64(&p.a, 1) }; wg.Done() }()
	go func() { for i := 0; i < per; i++ { atomic.AddUint64(&p.b, 1) }; wg.Done() }()
	go func() { for i := 0; i < per; i++ { atomic.AddUint64(&p.c, 1) }; wg.Done() }()
	go func() { for i := 0; i < per; i++ { atomic.AddUint64(&p.d, 1) }; wg.Done() }()
	wg.Wait()
}

func BenchmarkPaddedNoSharing(b *testing.B) {
	var p padded
	var wg sync.WaitGroup
	wg.Add(4)
	per := b.N / 4
	go func() { for i := 0; i < per; i++ { atomic.AddUint64(&p.a, 1) }; wg.Done() }()
	go func() { for i := 0; i < per; i++ { atomic.AddUint64(&p.b, 1) }; wg.Done() }()
	go func() { for i := 0; i < per; i++ { atomic.AddUint64(&p.c, 1) }; wg.Done() }()
	go func() { for i := 0; i < per; i++ { atomic.AddUint64(&p.d, 1) }; wg.Done() }()
	wg.Wait()
}

func main() {
	res := testing.Benchmark(BenchmarkPackedFalseSharing)
	println("packed:", res.NsPerOp(), "ns/op")
	res = testing.Benchmark(BenchmarkPaddedNoSharing)
	println("padded:", res.NsPerOp(), "ns/op")
}
```

On a typical x86 server you see padded run **5-10× faster**. `perf c2c record ./bin && perf c2c report` will point at the exact line.

### Java — the broken DCL and the fix

```java
// BrokenDCL.java — DO NOT USE on JVMs older than 1.5; subtly broken even after.
public class BrokenDCL {
    private static Singleton instance; // NOT volatile

    public static Singleton get() {
        if (instance == null) {
            synchronized (BrokenDCL.class) {
                if (instance == null) instance = new Singleton(); // racy publication
            }
        }
        return instance;
    }
}

// FixedDCL.java — correct under JSR-133 (Java 5+).
public class FixedDCL {
    private static volatile Singleton instance; // volatile is the fix

    public static Singleton get() {
        Singleton local = instance;       // single volatile read
        if (local == null) {
            synchronized (FixedDCL.class) {
                local = instance;
                if (local == null) {
                    local = new Singleton();
                    instance = local;     // volatile write publishes safely
                }
            }
        }
        return local;
    }
}

// Better: the Initialization-on-demand holder idiom. No volatile, no DCL.
public class HolderIdiom {
    private static class Holder { static final Singleton INSTANCE = new Singleton(); }
    public static Singleton get() { return Holder.INSTANCE; }
}
```

The middle form is correct but most senior Java engineers reach for `HolderIdiom` first — class-loader semantics give you lazy, thread-safe initialization for free.

### Python — RCU-style read-mostly cache

```python
# read_mostly_cache.py
# Reads are lock-free (atomic pointer load via dict reference).
# Writers copy-modify-publish under a lock.

import threading

class RCUCache:
    def __init__(self):
        self._snapshot = {}            # the "current" snapshot
        self._writer_lock = threading.Lock()

    def get(self, key, default=None):
        # Single attribute read: in CPython this is an atomic pointer load.
        # Readers never block, never CAS, never see a torn dict.
        return self._snapshot.get(key, default)

    def put(self, key, value):
        with self._writer_lock:
            new = dict(self._snapshot)  # full copy — expensive in writes
            new[key] = value
            self._snapshot = new        # atomic publish

    def delete(self, key):
        with self._writer_lock:
            new = dict(self._snapshot)
            new.pop(key, None)
            self._snapshot = new

if __name__ == "__main__":
    cache = RCUCache()
    cache.put("k", 1)
    threads = [threading.Thread(target=lambda: print(cache.get("k"))) for _ in range(8)]
    for t in threads: t.start()
    for t in threads: t.join()
```

Read-cost is one attribute access. Write-cost is O(N). This pattern is gold for configuration data, feature flags, and routing tables.

### Rust — lock-free Treiber stack with epoch-based reclamation

```rust
// Cargo.toml: crossbeam-epoch = "0.9"
use crossbeam_epoch::{self as epoch, Atomic, Owned, Shared};
use std::sync::atomic::Ordering::{Acquire, Relaxed, Release};

pub struct Stack<T> {
    head: Atomic<Node<T>>,
}

struct Node<T> {
    value: T,
    next: Atomic<Node<T>>,
}

impl<T> Stack<T> {
    pub fn new() -> Self { Self { head: Atomic::null() } }

    pub fn push(&self, value: T) {
        let mut new = Owned::new(Node { value, next: Atomic::null() });
        let guard = &epoch::pin();
        loop {
            let head = self.head.load(Relaxed, guard);
            new.next.store(head, Relaxed);
            match self.head.compare_exchange(head, new, Release, Relaxed, guard) {
                Ok(_) => break,
                Err(e) => new = e.new,
            }
        }
    }

    pub fn pop(&self) -> Option<T> where T: Clone {
        let guard = &epoch::pin();
        loop {
            let head = self.head.load(Acquire, guard);
            match unsafe { head.as_ref() } {
                None => return None,
                Some(h) => {
                    let next = h.next.load(Relaxed, guard);
                    if self.head.compare_exchange(head, next, Release, Relaxed, guard).is_ok() {
                        unsafe { guard.defer_destroy(head); }
                        return Some(h.value.clone());
                    }
                }
            }
        }
    }
}

fn main() {
    let s = Stack::new();
    s.push(1); s.push(2); s.push(3);
    while let Some(v) = s.pop() { println!("{v}"); }
}
```

The `crossbeam-epoch` crate handles the grace-period machinery. Without it, you would have to invent hazard pointers or risk use-after-free on every pop.

## Trade-offs

| You gain... | ...at the cost of... |
| --- | --- |
| Lock-free progress guarantees | More complex code, harder reasoning, often slower at low contention |
| RCU read scalability | Bounded memory bloat during grace periods, complex writer paths |
| Wait-free determinism | Significantly worse constant factors than lock-free |
| HTM speculative speed | Aborts on conflict; fallback path must exist and be correct |
| Biased / elided locks | Implementation complexity and microcode dependence |
| RWMutex parallel reads | Reader-count contention; sometimes slower than Mutex |
| Per-CPU sharding | Cross-shard operations now require fan-out |
| MVCC snapshot isolation | Storage cost of multiple versions, vacuum/garbage-collection burden |

## Use Cases

- **Hot in-process caches** — feature flags, config, lookup tables → RCU / read-mostly.
- **Connection pools** — bounded queue + condition variable; watch for lost-wakeup bugs.
- **Reference-counted resources** — atomic refcount with proper acquire/release ordering ([`../../02-primitives/04-atomic/senior.md`](../../02-primitives/04-atomic/senior.md)).
- **Statistics / metrics** — per-CPU counters aggregated on read; never a single shared counter.
- **Schedulers and runtimes** — Go runtime, Erlang BEAM, JVM all use carefully designed lock-free queues for run-queues and work-stealing.
- **In-memory databases** — Redis (single-threaded by design), KeyDB (multi-threaded with sharded locks), Aerospike (lock-free index).

## Coding Patterns

### 1. Cache-aligned struct fields

```go
type Stripe struct {
    counter uint64
    _       [56]byte // pad to 64-byte line
}
type Counters struct {
    stripes [64]Stripe
}
```

Use when multiple cores update parallel slots that must not contend.

### 2. Sharded counter (per-CPU style in user space)

```java
public class StripedCounter {
    private static final int SHARDS = 64;
    private final LongAdder[] shards = new LongAdder[SHARDS];
    public StripedCounter() { for (int i = 0; i < SHARDS; i++) shards[i] = new LongAdder(); }

    public void inc() {
        int idx = (int)(Thread.currentThread().getId() & (SHARDS - 1));
        shards[idx].increment();
    }
    public long sum() {
        long total = 0;
        for (LongAdder s : shards) total += s.sum();
        return total;
    }
}
```

JDK's `LongAdder` does this internally.

### 3. Seqlock for occasional writers, frequent readers

```c
// pseudo-C — used pervasively in Linux for jiffies, time-of-day
unsigned begin;
do {
    begin = seq_read(&lock);     // read sequence number
    snapshot = global_data;       // racy read OK; we'll retry
} while (seq_retry(&lock, begin)); // retry if writer ran
```

Readers never write to shared state. Writers bump a sequence counter before and after. Readers retry if they observed mid-write.

### 4. Lock cohorting (NUMA-aware)

Each NUMA socket has its own local lock. The global lock is held by whichever socket currently "owns" it; ownership is passed across sockets only after a batch of local acquisitions. Throughput improves by 2-3× on NUMA boxes for contended locks.

## Clean Code

- **Size your critical section in microseconds, not lines of code.** A 200-line critical section that runs in 200 ns is fine. A 5-line one that does I/O is a bug.
- **Pad shared atomics to 64 bytes if other writers touch the same struct.**
- **Choose the weakest correct memory order; document it.** A `Relaxed` should be accompanied by a comment proving the proof obligation is met elsewhere.
- **Never roll your own lock-free structure for production without a model checker.** Use CDSChecker, TLA+, or rely on vetted libraries (crossbeam, folly, concurrencpp).
- **Treat `volatile` (C/C++) as "compiler do not optimize this away"; it is NOT a synchronization primitive.** That is `std::atomic`'s job.

## Best Practices

1. **Measure before redesigning.** A "scalability problem" is often a 200 µs critical section that should be 5 µs.
2. **Per-CPU or sharded structures** beat lock-free almost every time at low-to-medium core counts.
3. **Promote read-mostly workloads to RCU/seqlock** before reaching for RWMutex.
4. **Pin threads when running NUMA-sensitive workloads** — `taskset`, `numactl`, JVM `-XX:+UseNUMA`, Go runtime is *not* NUMA-aware.
5. **Test under realistic contention.** A microbenchmark with two threads tells you almost nothing about what happens with 64.
6. **Race-detector in CI.** Mandatory for Go, Rust (Miri/Loom for unsafe), Java (jcstress for the brave).
7. **Document the memory-ordering proof** for any non-`seq_cst` atomic. Six months from now, you will need it.

## Edge Cases & Pitfalls

- **Spurious wakeups** from condition variables — always `while`, never `if`.
- **Lost wakeups** — signaling without holding the associated mutex; `pthread_cond_signal` is fine outside the mutex *only* if the predicate update is already visible.
- **Fairness bugs** — strict FIFO mutexes can starve under bursty load.
- **Reentrancy assumptions** — `RWMutex` in Go is not reentrant; nesting read locks across a function boundary will deadlock if a writer is waiting.
- **Atomic-on-pointer ≠ atomic-on-pointee.** Atomic pointer swap publishes the pointer, not the bytes of the struct it points at; the publication is the synchronization.
- **HTM aborts on cache-line eviction** — long transactions blow L1 and abort.
- **NUMA migration mid-run** — the OS scheduler may move a thread; mlock and pinning fight this.
- **JIT deoptimization** under contended biased locks (pre-JDK 15) — the revoke caused safepoint pauses.

## Common Mistakes

1. **Treating a lock-free algorithm as "always faster."** Test it. At 2-4 threads it usually loses to a mutex.
2. **Forgetting reclamation** — lock-free without hazard pointers or EBR is a use-after-free in production.
3. **Padding fields but reusing them under a single lock** — wasted memory with no benefit.
4. **Using `volatile` for cross-thread visibility in C/C++.** It does not synchronize.
5. **Assuming `RWMutex` always beats `Mutex`** for read-heavy workloads.
6. **Holding locks across I/O or channel sends** — convoy guaranteed.
7. **Ignoring NUMA on big iron** — a 96-core scaling cliff blames the lock; it is the inter-socket hop.
8. **Designing a lock-free queue without modeling it in TLA+/jcstress.** The Michael-Scott paper exists for a reason; your hand-rolled version is wrong.
9. **Re-introducing biased locking semantics in user-space code** — you will trip safepoint-like pauses on revocation.
10. **Using HTM as a correctness mechanism instead of an optimization.** TSX aborts must always fall back; if your code is incorrect without HTM it is incorrect with it.

## Tricky Points

- **`std::memory_order_consume`** in C++ — promised dependency-ordering reads, was implemented as `acquire` everywhere because no compiler could track dependencies; effectively dead.
- **Java `final` fields** — get publication safety even without synchronization, but *only* if no `this` reference escapes the constructor.
- **Go's `sync.Mutex` is not reentrant**, by design — `RLock` from the same goroutine while holding `RLock` is a deadlock if a writer is waiting.
- **`atomic.Value` in Go** type-tags on first store — subsequent stores of a different concrete type panic.
- **JVM safepoints** can interrupt your lock-free loop for GC; bounded steps does not equal bounded latency.
- **`futex_wait` returns `EINTR`** on signal delivery; libraries must loop.
- **Linux `pthread_mutex_t` defaults to PTHREAD_MUTEX_NORMAL** — no error checking; recursive locking is undefined behavior, not a deadlock you can debug.
- **The "memory model" of x86 is TSO (total store order)**, which is far stricter than C++/Java models. Code that "works on Intel" may break on ARM/POWER.

## Test Yourself

1. Take the Go false-sharing benchmark above and reproduce a 5× difference between packed and padded layouts. Then explain it from a `perf c2c` report.
2. Implement a wait-free single-producer/single-consumer queue. Prove it is wait-free for both ends.
3. Convert a `sync.RWMutex`-protected config map to RCU. Show that read latency drops and write latency rises.
4. Write a TLA+ specification of the Michael-Scott queue and model-check it for ABA.
5. Demonstrate, in code, the pre-JSR-133 broken DCL bug (use a Java 1.4 JVM if you can find one, or simulate by hand).
6. Profile a contended Java `synchronized` block with JFR. Identify the holder, the waiters, and the average wait time.
7. Show with `perf c2c` that adjacent struct fields share a cache line, then pad them and show contention disappears.
8. Implement a NUMA-aware mutex (cohort lock) and benchmark against `std::mutex` on a dual-socket box.

## Tricky Questions

1. **Why is a `sync.RWMutex` sometimes slower than `sync.Mutex` for read-heavy code?**
   The reader-count is itself a contended atomic. With brief critical sections, the per-acquire CAS dominates the work and serializes readers via the cache line.

2. **What is the difference between lock-free and wait-free?**
   Lock-free guarantees *some* thread makes progress; wait-free guarantees *every* thread makes progress in bounded steps of its own. Wait-free is strictly stronger and rarer.

3. **Why was double-checked locking broken before JSR-133?**
   The JMM did not give non-`volatile` writes happens-before semantics with respect to subsequent reads of a different field. A reader could observe `instance != null` while the object's fields were still default-initialized.

4. **Why is RCU read-cost essentially zero?**
   Readers do not write to any shared cache line. They take a per-CPU disable-preempt marker (or in user space, an epoch number) and load the head pointer with acquire semantics. No contention, no bouncing.

5. **What does `perf c2c` actually measure?**
   HITM events — when a load on one core hits a modified line owned by another core. That is exactly the signature of true sharing (lock contention) or false sharing (adjacent fields).

6. **Why did Intel deprecate TSX?**
   Microcode errata (Haswell), then side-channel attacks (TAA on Skylake/Cascade Lake) forced OS-level disabling. Without TSX, lock elision lost its hardware fast path.

7. **Why did the JVM remove biased locking in JDK 15?**
   Revocation costs (safepoints, atomic flag changes) outweighed the bias savings on modern multi-threaded workloads. Server code rarely had a single-threaded fast path anymore.

8. **How does MVCC relate to language-level memory models?**
   Both are versioned, copy-on-write disciplines. A snapshot transaction reads the version current at start; a lock-free reader holds a pointer current at acquire-time. The publication mechanism (commit pointer / atomic store) is the synchronization.

## Cheat Sheet

```text
┌─────────────────────────────────────────────────────────────────────┐
│  SENIOR SHARED-MEMORY CHEAT SHEET                                  │
├─────────────────────────────────────────────────────────────────────┤
│ Cache line = 64 B = unit of contention. Pad hot atomics.           │
│ MESI bounce = 80-300 cycles. Lock cost = bounce + crit section.    │
│ NUMA hop = 1.5-3× local DRAM. Inter-socket = even worse.           │
├─────────────────────────────────────────────────────────────────────┤
│ Lock-free  : some thread progresses                                │
│ Wait-free  : every thread progresses in bounded steps              │
│ Obstr-free : progress only without contention                      │
├─────────────────────────────────────────────────────────────────────┤
│ For read-mostly:                                                   │
│   readers >> writers   →  RCU or seqlock                           │
│   readers > writers    →  RWMutex (only if crit section is long)   │
│   contended bool flag  →  atomic + padding, not a lock             │
├─────────────────────────────────────────────────────────────────────┤
│ Reclamation in lock-free:                                          │
│   Hazard pointers    → bounded memory, O(N) reclaim                │
│   Epoch-based (EBR)  → cheap reads, possible bloat                 │
│   RCU                → near-zero reads, grace-period waits         │
├─────────────────────────────────────────────────────────────────────┤
│ Diagnostic tools:                                                  │
│   Linux  : perf c2c, perf lock, eBPF futex tracepoints             │
│   Java   : JFR, jcstress, async-profiler --lock                    │
│   Go     : runtime/trace, mutex profile, -race                     │
│   C/C++  : tsan, helgrind, drd                                     │
├─────────────────────────────────────────────────────────────────────┤
│ Hall of pathologies:                                               │
│   Convoy, thrash, priority inversion, livelock, ABA, lost wakeup  │
│   False sharing, NUMA cliff, biased-lock revoke storms             │
└─────────────────────────────────────────────────────────────────────┘
```

## Summary

- Shared memory is a hardware lie maintained by a coherence protocol; every contended write pays a cache-line bounce.
- Past one socket, NUMA changes the cost model; locks that scale within a socket can fall off a cliff past it.
- Lock-free is not "always faster"; it is "guaranteed progress under contention," often at a cost when contention is low.
- Wait-free is strictly stronger than lock-free; rarely practical except for HFT and real-time systems.
- The Java and C++ memory models exist because hardware reordering and compiler reordering combine in ways no individual programmer can track informally.
- Reclamation (hazard pointers, EBR, RCU) is half the design effort of any real lock-free structure.
- HTM (Intel TSX) failed commercially; biased locking was removed from the JVM. The "free lunch" optimizations did not last.
- Databases have shared-memory concurrency answers (MVCC, snapshot isolation) that map directly to in-process designs.
- Diagnose with `perf c2c`, JFR, `runtime/trace` — not with intuition.

## What You Can Build

- A NUMA-aware sharded key-value store with per-socket primary writers and lock-free reads.
- A RCU-based feature-flag service with sub-microsecond read latency under millions of QPS.
- A jcstress-validated lock-free MPSC queue with hazard-pointer reclamation.
- A `perf c2c` post-processor that suggests `alignas`/padding fixes by ranking false-sharing offenders.
- A scheduler that mimics Go's M:N model with NUMA-aware run-queues.

## Further Reading

- Maurice Herlihy & Nir Shavit, *The Art of Multiprocessor Programming*, 2nd ed. — the canonical textbook.
- Paul McKenney, *Is Parallel Programming Hard, And, If So, What Can You Do About It?* — free PDF, the RCU bible.
- Jeremy Manson, Brian Goetz et al., *JSR-133 (Java Memory Model and Thread Specification)*.
- Hans Boehm & Sarita Adve, *Foundations of the C++ Concurrency Memory Model*, PLDI 2008.
- Michael & Scott, *Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms*, PODC 1996.
- Maged Michael, *Hazard Pointers: Safe Memory Reclamation*, 2004.
- Joe Duffy, *Concurrent Programming on Windows*.
- Linux kernel `Documentation/RCU/` directory.
- Intel, *TSX Programming Considerations*; AMD, *Memory Model* white paper.
- Andreas Lochbihler, *Memory Models for C/C++ Concurrency*, lecture notes.
- Aleksey Shipilëv's blog and jcstress samples — best practical JMM material.

## Related Topics

- [Junior level](junior.md), [Middle level](middle.md), [Professional level](professional.md), [Interview](interview.md), [Tasks](tasks.md).
- Sibling concurrency models: [`../02-message-passing/senior.md`](../02-message-passing/senior.md), [`../03-actor-model/`](../03-actor-model/), [`../04-csp/`](../04-csp/), [`../05-stm/`](../05-stm/).
- Primitives: [`../../02-primitives/01-mutex/senior.md`](../../02-primitives/01-mutex/senior.md), [`../../02-primitives/04-atomic/senior.md`](../../02-primitives/04-atomic/senior.md).
- Failure modes: [`../../05-race-conditions/senior.md`](../../05-race-conditions/senior.md), [`../../06-deadlock-detection/`](../../06-deadlock-detection/).
- Language-specific deep dives: [`../../../languages/golang/`](../../../languages/golang/), [`../../../languages/java/`](../../../languages/java/), [`../../../languages/rust/`](../../../languages/rust/).

## Diagrams & Visual Aids

### MESI line-state transitions on a contended counter

```text
   Core 0                  Core 1                  Core 2
   ┌──────────┐            ┌──────────┐            ┌──────────┐
   │  L1: M   │            │  L1: I   │            │  L1: I   │
   │ ctr=42   │            │          │            │          │
   └────┬─────┘            └────┬─────┘            └────┬─────┘
        │ atomic.Add(&ctr,1)    │                       │
        ▼                        │                       │
   ┌──────────┐                  │                       │
   │  L1: M   │                  │                       │
   │ ctr=43   │                  │                       │
   └──────────┘                  │                       │
                                 │ atomic.Add(&ctr,1)    │
                                 ▼                       │
        invalidate  ──────► ┌──────────┐                 │
        line bounces        │  L1: M   │                 │
        Core0 → Core1       │ ctr=44   │                 │
                            └──────────┘                 │
                                                         ▼
                                       invalidate  ──► ┌──────────┐
                                       Core1 → Core2   │  L1: M   │
                                                       │ ctr=45   │
                                                       └──────────┘
   Each acquire = full cache-line bounce + ~200 cycles + a coherence msg.
```

### NUMA scaling cliff

```text
   throughput
       │
       │       ╱─────────────── ideal (linear)
       │      ╱
       │     ╱
       │    ╱       ┌─ same-socket scaling
       │   ╱      ╱─┘
       │  ╱     ╱
       │ ╱    ╱        ┌─ inter-socket: flat or negative
       │╱   ╱        ╱─┘
       │  ╱       ╱
       │ ╱     ╱
       │╱   ╱
       └────────────────────────────────► cores
       1  4  8  16  18  32  64

   ↑ same socket          ↑ second socket joins → cliff
```

### Lock-free progress hierarchy

```text
                ┌──────────────────────────────┐
                │      WAIT-FREE               │
                │  every thread, bounded steps │
                └──────────────┬───────────────┘
                               │ strictly stronger
                ┌──────────────▼───────────────┐
                │      LOCK-FREE               │
                │  some thread always progresses│
                └──────────────┬───────────────┘
                               │ strictly stronger
                ┌──────────────▼───────────────┐
                │   OBSTRUCTION-FREE           │
                │ progress only if alone        │
                └──────────────┬───────────────┘
                               │
                ┌──────────────▼───────────────┐
                │      BLOCKING                │
                │ any thread can stall all     │
                └──────────────────────────────┘
```

### RCU read/write timeline

```text
   readers ───●─────●────●──────●───────●────────●──────●────────●─────►
              │     │    │      │       │        │      │        │
              └─ see version V1 ─┘      └─ see version V2 ────────┘
                                 │
   writer ────────────────────── ●publish V2 ──── ●grace period ─── ●free V1
                                 ▲                                  ▲
                                 atomic ptr swap                     all readers done with V1
```

### perf c2c report sketch (false sharing)

```text
   ─────── Shared Data Cache Line Table ─────────────────────────────────
   Index   Cacheline           HITM%   Loads   Stores   Symbols
       0   0xffff800012ab40    78.4%   1.2M    1.1M     pkt_stats.tx_bytes
       0                                                pkt_stats.rx_bytes
       1   0xffff800012ab80     6.1%    180K    150K    sched_run_queue
   ─────────────────────────────────────────────────────────────────────
   Action: pad tx_bytes / rx_bytes to separate lines or move to per-CPU.
```
