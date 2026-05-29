# Atomic Operations — Professional Level

> **Topic:** [Atomic Operations](README.md)
> **Focus:** designing lock-free libs, JMM/C++ memory models, history, verification

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

At the professional level, atomic operations stop being a feature you use and start being a system you design. The shift is qualitative. A junior engineer asks "which method increments this counter safely?" A middle engineer asks "what memory order do I need for this CAS?" A senior engineer asks "is this data structure linearizable, and can I prove it?" A professional asks a different question entirely: "should we be writing this at all, or should we adopt crossbeam, folly, or `java.util.concurrent`?"

The professional level is where atomics meet three uncomfortable truths. First, the formal memory models that govern atomic behavior — the Java Memory Model (JSR-133) and the C++11/C++20 model — are subtle enough that even their authors have published errata. Second, lock-free code that looks correct on x86 routinely breaks on ARM and POWER because of weak memory ordering, and the bugs manifest as silent corruption rather than crashes. Third, the literature is full of beautiful published algorithms — Treiber stacks, Michael-Scott queues, Harris's linked list — that contain real-world hazards (ABA, memory reclamation, false sharing) which the original papers gloss over.

This level is about three things you cannot learn from the junior or middle articles. You learn to read the *primary literature* — the Treiber 1986 IBM technical report, the Michael-Scott 1996 PODC paper, Doug Lea's `util.concurrent` design notes — because translated and rewritten versions in textbooks often drop crucial preconditions. You learn to *verify* concurrent code using tools rather than testing — TLA+, CBMC, Rust's `loom` — because conventional testing cannot reproduce a race that fires once per billion operations on a specific CPU. And you learn to *mentor*: spotting the engineer on your team who reaches for `memory_order_relaxed` because "it's faster" and knowing exactly how to redirect that energy.

The hardest part of working at this level is restraint. You will know enough to roll your own lock-free queue. The professional answer in 95% of cases is: do not. Use a mature library. Save the rolling-your-own for the 5% where profiling, problem characteristics, and your test infrastructure justify the months of verification work it actually takes.

---

## Prerequisites

Before reading this article, you should already have working knowledge of:

- Atomic operations at the junior and middle level — compare-and-swap, fetch-and-add, weak vs strong CAS, basic memory orders (acquire/release/relaxed/seq_cst), and the ABA problem.
- The hardware reality of atomics — cache coherence, MESI/MOESI protocols, cache line contention, false sharing, and the difference between x86 (strong memory model) and ARM/POWER (weak memory model).
- Lock-free vs wait-free terminology — progress guarantees and what it means for a thread to make progress without taking a lock.
- Locks and mutexes — when they are appropriate, what reentrancy means, and why uncontended locks are often faster than naive lock-free code.
- One real concurrent runtime in depth — either the JVM (HotSpot's `Unsafe`, `VarHandle`, the JMM), or C++ (`std::atomic`, `std::memory_order`), or Rust (`std::sync::atomic`, `Ordering`).
- Practical experience with a lock-free data structure — having implemented or debugged at least one queue, stack, or counter under contention.
- Reading a CPU profile — flame graphs, cache miss counters (`perf stat`), and understanding what "this line of code took 200 cycles" actually means.

If any of these are shaky, return to `middle.md` and the prerequisites listed there. The material that follows assumes fluency in all of the above.

---

## Glossary

- **JMM (Java Memory Model)** — JSR-133, the formal specification of how reads and writes interact between threads on the JVM. Defines the happens-before relation and what guarantees `volatile`, `final`, and `synchronized` provide.
- **C++ Memory Model** — Introduced in C++11, formalized in subsequent standards. Defines `std::memory_order` and the conditions under which a program is data-race-free.
- **DRF (Data-Race-Free)** — A program is DRF if every conflicting access on shared data is ordered by happens-before. DRF programs behave as if executed under sequential consistency.
- **Linearizability** — A correctness condition for concurrent objects. Every operation appears to take effect instantaneously at some point between its invocation and response.
- **Sequential Consistency (SC)** — Lamport's definition: the result of execution is as if operations from all threads were executed in some sequential order respecting each thread's program order.
- **Consensus Number** — Herlihy's measure of an object's synchronization power. The maximum number of threads for which the object can solve consensus. CAS has consensus number infinity.
- **Wait-Free Hierarchy** — Herlihy's classification of synchronization primitives by consensus number. Registers are at the bottom (1), CAS at the top (infinity).
- **Treiber Stack** — A lock-free stack using CAS on a head pointer, published by R. Kent Treiber at IBM in 1986. The canonical first lock-free data structure.
- **Michael-Scott Queue** — A lock-free FIFO queue published by Maged Michael and Michael Scott in 1996. Uses two atomic pointers (head, tail) and a sentinel node.
- **Hazard Pointer** — A memory reclamation technique for lock-free data structures (Michael, 2004). Threads publish pointers they are about to dereference; memory cannot be freed until no thread hazards it.
- **Epoch-Based Reclamation** — Alternative to hazard pointers. Memory is reclaimed at epoch boundaries when all threads have moved past the epoch in which the memory became unreachable.
- **RCU (Read-Copy-Update)** — A reclamation strategy used heavily in the Linux kernel. Readers proceed without synchronization; writers create new versions and defer reclamation until a quiescent state.
- **Loom (Rust)** — A model-checking library that explores possible interleavings of an atomic program to find data races and ordering bugs.
- **TLA+** — Leslie Lamport's specification language for concurrent and distributed systems. Used to model and verify lock-free algorithms.
- **CBMC** — C Bounded Model Checker. Verifies C programs by exploring bounded executions, including those with atomic operations.
- **HTM (Hardware Transactional Memory)** — Intel TSX, IBM Power. CPU support for speculative transactional execution. Largely disappointed in practice.
- **`std::atomic_ref`** — C++20 facility allowing atomic operations on objects that were not declared atomic.
- **`std::atomic_flag`** — The only C++ atomic guaranteed to be lock-free on all platforms. Pre-C++20 it had no load operation.
- **VarHandle** — JVM 9+ replacement for `sun.misc.Unsafe`. Provides typed, ordered access to fields and array elements.

---

## Core Concepts

### Designing a Lock-Free Library: API Surface, Error Handling, Debugging Story

A lock-free *algorithm* is a research artifact. A lock-free *library* is a product. The professional difference is in what the algorithm does not specify: API ergonomics, error reporting, debuggability, observability, and integration with the language's idioms.

When designing a lock-free library, three questions dominate. First, what does your API expose, and what does it hide? If you expose raw CAS, you have not built a library; you have built a wrapper. Maturity means hiding `compare_exchange_weak` behind operations like `try_push`, `try_pop`, `try_steal`, where the user thinks in terms of the data structure, not in terms of CPU instructions. Second, what happens when the data structure is corrupt? A lock-free queue with a torn pointer cannot meaningfully be "recovered"; the library either has to panic or has to be designed so torn states are impossible. Third, how does the user debug? You must provide consistency-checking iterators, contention counters exposed as metrics, and the ability to convert at compile time to a locking implementation for A/B testing.

The folly library (Facebook) handles this with its `MPMCQueue` and `ProducerConsumerQueue`. The crossbeam crate (Rust) handles this with `crossbeam::queue::SegQueue` and `crossbeam::deque::Worker`. In both cases, the public API hides epoch-based reclamation entirely; users never see an "epoch" type. The debugging story relies on the library having been used in production at scale: the maintainers fixed the rough edges so you do not have to.

When your team starts a new lock-free library, the first commit should be a test harness — preferably with `loom` or a TLA+ model — not the algorithm. The algorithm is the easy part.

### The JMM (JSR-133) and C++11 Memory Model — How Programmers Actually Reason

The JMM, codified in JSR-133 for Java 5 (2004), was the first widely-deployed industrial memory model. It was a triumph of pragmatism. Before JSR-133, the original Java Memory Model in the 1995 specification was so badly broken that even `final` fields could appear to change values after construction. JSR-133 fixed this by defining the *happens-before* relation as a partial order, with rules for `volatile`, monitor entry/exit, thread start/join, and `final` field semantics. The key insight: programmers reason in terms of "what other thread will see when it reads X after I write X," and the formal model must answer that question deterministically.

The C++11 memory model, designed by Hans Boehm, Sarita Adve, and others, took inspiration from the JMM but exposed more knobs. Where the JMM has essentially three levels (plain, `volatile`, `synchronized`), C++11 has six explicit memory orders: `relaxed`, `consume`, `acquire`, `release`, `acq_rel`, `seq_cst`. The flexibility comes at a cost — `memory_order_consume` was so subtle that no compiler ever implemented it correctly, and it has been effectively deprecated in favor of `acquire`.

In practice, both models converge on the same advice for working engineers: write race-free code using sequential consistency, escape to relaxed orderings only when you can prove correctness, and always test on weakly-ordered hardware (ARM or POWER) before shipping. The JMM forces this by making `volatile` already sequentially consistent. C++ allows you to shoot yourself in the foot more creatively, which is why C++ codebases need code review by people who can read the memory model.

### Modern C++ `std::atomic_ref`, `std::atomic_flag`, `std::atomic_shared_ptr`

C++20 added three important atomic facilities that change how lock-free code is written.

`std::atomic_ref<T>` lets you perform atomic operations on a non-atomic object. This solves a long-standing problem: third-party libraries return references to plain `int` fields that you want to update atomically, but you cannot rewrite the third-party type. With `atomic_ref`, you can wrap the field and update it atomically *as long as* every other access to that field also goes through `atomic_ref` for as long as your reference is alive. The discipline is unenforced by the type system but the tool exists.

`std::atomic_flag` is the oldest atomic type and the only one guaranteed lock-free on every platform. Historically it was almost useless because it had no load operation — only `test_and_set` and `clear`. C++20 added `test()` and `wait()`/`notify_one()`/`notify_all()`, making it a complete primitive. The `wait`/`notify` operations are the C++ equivalent of `Object.wait`/`notify` in Java: they let a thread sleep until a value changes, without burning CPU in a spin loop.

`std::atomic_shared_ptr<T>` (and `atomic<shared_ptr<T>>`) provides atomic operations on a reference-counted pointer. This is dramatically harder than atomic pointer operations because the reference count must move atomically with the pointer. Implementations use a packed-pointer representation (stealing bits for the count) or a deferred-reclamation scheme. The performance is often worse than a lock around a `shared_ptr` for contended workloads, but for read-mostly workloads (configuration pointers, routing tables) it is excellent.

### Sequentially-Consistent Atomics — When the Overhead Is Worth Correctness Clarity

Senior engineers tend to view `memory_order_seq_cst` as the slow, conservative choice. Professional engineers know it is often the *correct* choice, and the performance cost is usually invisible.

Sequential consistency on x86 typically costs an `mfence` (or `lock`-prefixed instruction) on stores, but loads are nearly free. On ARM, it costs `dmb ish` barriers in both directions. The cost is real but small — on the order of 10-30 nanoseconds per operation. For code paths that execute millions of times per second, this can matter. For code paths that execute hundreds or thousands of times per second — which is most code — the overhead is below the measurement noise floor.

The case for sequential consistency is not performance, it is *reasoning*. SC atomics let you think of concurrent code as if it were a sequence of interleaved operations. Every reader and writer agrees on a single global order. This matches how humans naturally reason about programs. Weaker orderings require you to think in terms of "what is visible to whom at what point," which is a much harder mental model.

Professional code uses SC by default and downgrades to acquire/release or relaxed only when (a) profiling shows the operation is hot, (b) the correctness argument is documented in a comment, and (c) the code is verified with `loom` or TLA+ to prove the weaker ordering is safe. The discipline is "premature optimization is the root of all evil" applied to memory orderings.

### Linearizability vs Sequential Consistency

Linearizability is the standard correctness condition for concurrent objects. Defined by Herlihy and Wing in 1990, it says: every operation appears to take effect at some single instant between the invocation and the response, and the resulting sequential history is legal.

Linearizability is *compositional* — if every object in your system is linearizable, then the whole system is linearizable. This is what makes it the gold standard. Sequential consistency is not compositional: you can have two SC objects whose interaction is not SC.

The practical difference matters when you design APIs. A `Map` that is "thread-safe" might mean different things. If `get` is linearizable, then once `put(k, v)` returns, every subsequent `get(k)` from any thread returns `v` (or whatever overwrites it). If `get` is only sequentially consistent, you might see a stale value because the global order does not match real-time ordering.

`java.util.concurrent.ConcurrentHashMap` is linearizable for `put`/`get` but not for the bulk operations (`forEach`, `reduce`). This is documented but easy to miss. Folly's `AtomicHashMap` makes similar trade-offs. When designing your own library, document the linearizability boundary explicitly: "single-key operations are linearizable; bulk scans are weakly consistent and may observe a mix of states."

### Herlihy's Wait-Free Hierarchy (Consensus Number)

In 1991, Maurice Herlihy published "Wait-Free Synchronization," establishing a hierarchy of synchronization primitives by their *consensus number*. A primitive's consensus number is the maximum number of threads for which it can solve the consensus problem — getting N threads to agree on a single value despite arbitrary asynchrony.

The results are striking. Plain atomic registers have consensus number 1 — you cannot even get two threads to agree using only reads and writes. Test-and-set, fetch-and-add, and swap have consensus number 2. Compare-and-swap has consensus number infinity. This is the formal reason why CAS is sufficient to build any wait-free data structure, and why fetch-and-add alone is not.

The hierarchy is more than theory. It tells you, when you sit down to design a new synchronization primitive, whether it can possibly solve your problem. If your hardware exposes only fetch-and-add (some early multiprocessors did), you cannot build a wait-free linked list — you would need to fall back to lock-based or obstruction-free designs.

In practice, modern CPUs expose CAS (via `lock cmpxchg` on x86, `LDXR`/`STXR` on ARM, `LL`/`SC` on POWER), so consensus number is rarely a constraint. But understanding the hierarchy makes you literate in the lock-free literature.

### Verification: TLA+, CBMC, `loom` (Rust)

Conventional testing cannot find concurrency bugs reliably. A race that fires once per billion operations might appear in production once a week — and you have no way to reproduce it. Professional concurrent code uses *verification* tools that exhaustively explore interleavings.

**TLA+** is Leslie Lamport's specification language. You write a high-level model of your algorithm in TLA+ and assert invariants and temporal properties (e.g., "no deadlock," "every push is eventually visible to a pop"). The TLC model checker explores all reachable states. AWS famously used TLA+ to verify DynamoDB and S3 designs. For a lock-free queue, a TLA+ spec might be 100-200 lines and catch bugs that survived years of production use.

**CBMC** (C Bounded Model Checker) works on C code directly. It explores all executions up to a bounded loop depth and reports counterexamples. The bounded part is important: CBMC cannot prove correctness for arbitrary input sizes, only for the bound you specify. For lock-free code where bugs typically manifest with 2-4 threads, this is sufficient.

**`loom`** is a Rust crate by Carl Lerche that model-checks `std::sync::atomic` code. You write your data structure normally, then write a test that exercises it under `loom`, and `loom` explores all interleavings the C++ memory model permits. It finds ABA bugs, missing barriers, and incorrect orderings. Tokio's internals are verified with `loom`.

A professional rule: any non-trivial lock-free data structure ships with a `loom` test, a TLA+ spec, or a CBMC harness. Without verification, you are shipping a coin flip.

### Modern Production Lock-Free Libs: folly, Concurrencpp, crossbeam, Doug Lea's util.concurrent

The lock-free libraries that have stood the test of production deployment are few and worth naming.

**folly** (Facebook) provides `MPMCQueue`, `ProducerConsumerQueue`, `AtomicHashMap`, `ConcurrentSkipList`, and `Synchronized`. The code is dense, well-tested, and used at Facebook's scale. The implementation reads like a graduate course in lock-free engineering: every comment is a load-bearing argument about ordering. Read it to learn how production lock-free code is written.

**Concurrencpp** is a smaller C++ coroutine library with lock-free primitives for task scheduling. Lighter than folly, easier to understand, suitable for embedding in your own runtime.

**crossbeam** (Rust) provides `crossbeam::queue::ArrayQueue`/`SegQueue`, `crossbeam::deque::Worker` (work-stealing), `crossbeam::channel` (multi-producer multi-consumer channels), and `crossbeam_epoch` (epoch-based memory reclamation). The crossbeam crate is the de facto standard for lock-free Rust. Its epoch-based reclamation is exposed as a usable API, which is unusual — most libraries hide reclamation entirely.

**`java.util.concurrent`** (Doug Lea) gave the world `ConcurrentHashMap`, `ConcurrentLinkedQueue`, `LinkedTransferQueue`, the `Atomic*` classes, and the fork/join framework. Doug Lea designed these starting in the late 1990s, and they shipped with Java 5 in 2004. Twenty years later, they are still the reference standard for lock-free data structures on the JVM. Read the source — Lea's comments are textbook material.

### When the Team Should NOT Roll Its Own Lock-Free

The default answer to "should we write our own lock-free queue?" is no. The cases where you should are narrower than they appear.

You should *not* roll your own when: an existing library (`java.util.concurrent`, folly, crossbeam) has a data structure that fits within 90% of your needs; your team does not include someone with verification experience; your problem can be solved with a per-CPU sharded design over a simpler primitive (this is often the right answer); the contention level is below 100,000 operations per second per core (locks are fine); or the data structure is not on the critical path.

You should consider rolling your own when: profiling shows the existing library is the bottleneck and the bottleneck is intrinsic to its design (not just bad sizing or tuning); the access pattern is highly specialized (e.g., single-producer single-consumer with hardware timestamps); your team has the verification infrastructure to prove correctness; and you have allocated months, not weeks, for the work.

A good professional habit: when someone proposes rolling a new lock-free structure, ask "what library did you benchmark against, and what was the gap?" If the answer is hand-waving, the answer to the proposal is no.

### Mentoring: Spotting a Junior Misusing `memory_order_relaxed`

The single most common lock-free bug in modern C++ codebases is misuse of `memory_order_relaxed`. Junior engineers learn that relaxed is "faster" and reach for it whenever they see an atomic. The pattern is so common it has a name: the "relaxed flag" bug.

```cpp
std::atomic<bool> ready{false};
int data;

// Thread 1
void producer() {
    data = 42;
    ready.store(true, std::memory_order_relaxed);  // BUG
}

// Thread 2
void consumer() {
    while (!ready.load(std::memory_order_relaxed)) {}
    std::cout << data << "\n";  // May print 0
}
```

The relaxed store does not establish a happens-before with the relaxed load. Thread 2 can observe `ready == true` while still seeing `data == 0`. The fix is `release` on the store and `acquire` on the load.

When mentoring, do not just point at the bug. Explain *why* `relaxed` exists: for statistics counters, reference counts (with proper acquire on the destructor), and similar uses where the value is the sole content of the synchronization. As soon as the atomic is signaling that *other* data is ready, you need acquire/release at minimum.

A code review heuristic: every `memory_order_relaxed` should have a comment justifying it. If there is no comment, ask for one. If the comment cannot be written, the ordering is wrong.

### History — Treiber 1986, Michael-Scott 1996, Herlihy & Shavit Textbook

The lock-free literature has a clear lineage worth knowing.

**Treiber 1986** — R. Kent Treiber, at IBM Almaden, wrote "Systems Programming: Coping with Parallelism," an IBM technical report (RJ 5118). It introduced the Treiber stack, the first published lock-free data structure. The original report describes both the algorithm and the memory reclamation challenge it creates. Twenty-five years before the C++11 memory model, Treiber was already grappling with the issues.

**Michael-Scott 1996** — Maged Michael and Michael Scott published "Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms" at PODC 1996. The Michael-Scott queue uses two atomic pointers (head, tail), a sentinel node, and a CAS protocol that gracefully handles the tail-pointer-lagging case. It is the algorithm behind `ConcurrentLinkedQueue` in Java and many production queues.

**Michael 2004** — Maged Michael, again, published "Hazard Pointers: Safe Memory Reclamation for Lock-Free Objects" in IEEE TPDS. Hazard pointers solved the memory reclamation problem for lock-free structures and remain the textbook approach.

**Harris 2001** — Tim Harris's "A Pragmatic Implementation of Non-blocking Linked-lists" introduced the mark bit technique for lock-free linked-list deletion. The technique is used in Java's `ConcurrentSkipListMap`.

**Herlihy & Shavit's "The Art of Multiprocessor Programming"** (2008, revised 2020) collected this literature into a coherent textbook. Every professional concurrent engineer should own a copy. The exercises are worked, the proofs are rigorous, and the historical context is preserved.

Reading the primary sources matters because textbook simplifications often drop preconditions. The Treiber stack as taught in textbooks does not handle ABA; the original paper acknowledges it. The Michael-Scott queue as taught often omits the memory reclamation discussion; the original paper has it.

### Hardware Trends: Weak Memory Models (ARMv8), Transactional Memory Disappointments

Two hardware trends shape modern lock-free work.

First, weak memory models have won. ARMv8 is the dominant non-x86 architecture, present in every smartphone, all Apple silicon Macs, AWS Graviton, and increasingly in datacenters. ARMv8 is weakly ordered: stores can be reordered with later loads, and barriers are explicit. Code that "worked on x86" frequently fails on ARM because the developer relied on x86's strong ordering accidentally. Always test on ARM before shipping. ARMv8.3 added LDAPR (Load-Acquire RCpc) which is even more relaxed than the original Acquire — another reminder that "acquire" semantics are not universal.

Second, hardware transactional memory has largely disappointed. Intel TSX (Transactional Synchronization Extensions) was introduced in Haswell (2013), disabled because of bugs, re-enabled, then disabled in many SKUs because of side-channel vulnerabilities. IBM Power HTM is more reliable but limited. The promise of HTM was that you could write code as if it were sequential, wrap it in a transaction, and the hardware would handle conflicts. In practice, transaction abort rates are too high for many workloads, the transaction size limits are restrictive, and the verification story is unclear. Most production lock-free code today does not use HTM.

The trend that *has* materialized is CPU-level wait primitives — `monitor`/`mwait` on x86, `WFE`/`SEV` on ARM, `umwait` on more recent Intel chips. These let a thread sleep efficiently on a memory location without spinning. They are the foundation for `std::atomic::wait` and `WaitOnAddress` on Windows.

---

## Real-World Analogies

**Designing a lock-free library is like designing a kitchen for a busy restaurant.** The cooks do not need to know how the gas line works. They need clean interfaces — burners that turn on, ovens that maintain temperature, surfaces that drain. The library designer hides the gas main, the ventilation, the safety interlocks. The cooks (users) focus on cooking. A library that exposes raw CAS is a kitchen that makes the cooks weld their own burners.

**Memory orderings are like postal services in a federation of nations.** Sequential consistency is FedEx overnight to every nation, in canonical order, signed-for. Acquire/release is national mail — within your country, things arrive in order; across borders, you only get ordering when both sides cooperate. Relaxed is dropping letters off a balcony — they get there eventually, in no particular order, and you have no idea what other letters arrived before yours.

**Linearizability is like a court reporter.** Every action is timestamped to a single instant; the transcript is what really happened. Sequential consistency is like a journalist's reconstruction — the events are in *some* coherent order, but the order may not match wall-clock time. For a database, you want the court reporter. For a feed of social media posts, the journalist is fine.

**The consensus number is like the load capacity of a bridge.** A footbridge supports a few hikers; a highway bridge supports trucks; a railway bridge supports trains. CAS is the railway bridge of synchronization — it supports any load. Plain atomic reads and writes are the footbridge — you cannot get even two trucks across.

**Verification with TLA+ or loom is like an architect's structural analysis.** Before construction, the architect runs simulations to verify the building withstands wind, earthquakes, snow loads. Without the simulation, you find out when the building falls down. With it, you find the weak beam before pouring concrete.

**Using folly or crossbeam instead of rolling your own is like ordering steel beams from a mill instead of forging your own.** The mill has decades of metallurgy expertise. Your forge in the back yard does not. The beams are not just cheaper; they are better.

---

## Mental Models

**Model 1: The Memory Model as Contract.** The C++ or Java memory model is not a description of what the CPU does. It is a contract between you and the compiler/CPU. You promise to mark your atomic operations correctly; the compiler/CPU promises certain visibility guarantees. Violate the contract (data race), and the contract is void — your program may behave arbitrarily. Honor the contract, and you get the guarantees, even though the underlying hardware may reorder freely.

**Model 2: Happens-Before as a DAG.** Draw your concurrent program as a DAG. Each thread is a chain of operations in program order. Synchronization edges (acquire/release pairs, lock acquisitions, thread joins) cross between threads. The DAG defines what *must* happen before what. Operations not connected by a path can happen in either order, or simultaneously. Reasoning about lock-free code means manipulating this DAG mentally.

**Model 3: Lock-Free Library as Black Box.** A well-designed lock-free library appears to the user as a black box that satisfies linearizability for its public operations. The user can reason about it as if it were a sequential data structure, with operations occurring at discrete points in time. All the memory order subtlety is hidden inside the box. If you ever feel you need to look inside the box, the abstraction is leaking.

**Model 4: The Verification Pyramid.** At the base, simple atomic counters and flags — verified by code review. Above, single-producer single-consumer queues — verified by stress tests and `loom`. Above, multi-producer multi-consumer queues and lock-free maps — verified by TLA+ or formal proofs. At the apex, novel algorithms — verified by peer review at a top conference. The pyramid tells you how much verification effort your work requires.

**Model 5: The Disappointment Curve.** Junior engineers underestimate the difficulty of lock-free programming. Middle engineers overestimate it (locks are slow, lock-free is fast). Senior engineers reach an equilibrium: locks are often fine, lock-free is sometimes necessary, the library exists, use the library. Professionals understand that the disappointment curve applies to *every* synchronization technology, including new ones — be skeptical of "transactional memory will fix everything" and similar promises.

**Model 6: The History Lens.** Every lock-free pattern you use has a paper behind it. The Treiber stack, the Michael-Scott queue, the Harris linked list, hazard pointers, epoch reclamation, RCU. Knowing the origin tells you the original constraints and the gotchas. A pattern that solved a 1996 problem may not be optimal for a 2026 problem, but it is rarely wrong.

---

## Code Examples

The examples here are runnable Rust code. Rust is chosen because `loom` makes the verification story concrete and because `crossbeam_epoch` exposes epoch-based reclamation as a real API. The same patterns translate to C++ with `std::atomic` and to Java with `VarHandle`.

### Example 1: Designing a Lock-Free SPSC Ring Buffer

A single-producer single-consumer (SPSC) ring buffer is the simplest non-trivial lock-free structure. It uses two indices, requires only acquire/release semantics, and admits a clear linearizability proof. We will design it as a library, with attention to API surface, error handling, and observability.

```rust
// File: spsc_ring.rs
// A bounded single-producer single-consumer ring buffer.
//
// Design notes:
// - Capacity must be a power of two so we can mask instead of mod.
// - Producer owns `tail`; consumer owns `head`. Each reads the other
//   with acquire ordering, writes its own with release ordering.
// - Padded to avoid false sharing between producer and consumer caches.
// - try_push and try_pop return Result so the user is forced to handle
//   the full/empty case.
// - len() and is_empty() are weakly consistent snapshots; documented.

use std::cell::UnsafeCell;
use std::mem::MaybeUninit;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[repr(align(64))]
struct CachelinePadded<T>(T);

pub struct SpscRing<T> {
    buf: Box<[UnsafeCell<MaybeUninit<T>>]>,
    mask: usize,
    head: CachelinePadded<AtomicUsize>,
    tail: CachelinePadded<AtomicUsize>,
}

unsafe impl<T: Send> Send for SpscRing<T> {}
unsafe impl<T: Send> Sync for SpscRing<T> {}

#[derive(Debug)]
pub struct Full<T>(pub T);

#[derive(Debug)]
pub struct Empty;

impl<T> SpscRing<T> {
    pub fn with_capacity(capacity: usize) -> Arc<Self> {
        assert!(capacity.is_power_of_two(), "capacity must be a power of two");
        let mut buf = Vec::with_capacity(capacity);
        for _ in 0..capacity {
            buf.push(UnsafeCell::new(MaybeUninit::uninit()));
        }
        Arc::new(Self {
            buf: buf.into_boxed_slice(),
            mask: capacity - 1,
            head: CachelinePadded(AtomicUsize::new(0)),
            tail: CachelinePadded(AtomicUsize::new(0)),
        })
    }

    pub fn try_push(&self, value: T) -> Result<(), Full<T>> {
        let tail = self.tail.0.load(Ordering::Relaxed);
        let head = self.head.0.load(Ordering::Acquire);
        if tail.wrapping_sub(head) == self.buf.len() {
            return Err(Full(value));
        }
        let slot = unsafe { &mut *self.buf[tail & self.mask].get() };
        slot.write(value);
        self.tail.0.store(tail.wrapping_add(1), Ordering::Release);
        Ok(())
    }

    pub fn try_pop(&self) -> Result<T, Empty> {
        let head = self.head.0.load(Ordering::Relaxed);
        let tail = self.tail.0.load(Ordering::Acquire);
        if head == tail {
            return Err(Empty);
        }
        let slot = unsafe { &mut *self.buf[head & self.mask].get() };
        let value = unsafe { slot.assume_init_read() };
        self.head.0.store(head.wrapping_add(1), Ordering::Release);
        Ok(value)
    }

    /// Weakly consistent length snapshot.
    pub fn len_approx(&self) -> usize {
        let tail = self.tail.0.load(Ordering::Acquire);
        let head = self.head.0.load(Ordering::Acquire);
        tail.wrapping_sub(head)
    }
}

impl<T> Drop for SpscRing<T> {
    fn drop(&mut self) {
        // Drain remaining elements to drop them properly.
        while let Ok(_) = self.try_pop() {}
    }
}
```

Notes on the design. The two indices are 64-bit and wrap around naturally; `wrapping_sub` gives the correct distance regardless of wraparound. The producer publishes new data with `store(tail+1, Release)` after writing the slot — the release pairs with the consumer's `load(Acquire)` to guarantee the consumer sees the slot data. The consumer publishes the empty slot with `store(head+1, Release)` so the producer sees the freed slot. `len_approx` reads both indices but acknowledges that another thread may move them concurrently; documenting this is important.

### Example 2: Verifying the SPSC Ring with `loom`

A handwritten correctness argument is not enough. We verify with `loom`. Add to `Cargo.toml`:

```toml
[target.'cfg(loom)'.dependencies]
loom = "0.7"
```

Then write a model-checked test. Under `loom`, the atomic types come from `loom::sync::atomic` rather than `std::sync::atomic`, but you abstract over this with a shim:

```rust
// File: tests/spsc_loom.rs
#![cfg(loom)]

use loom::sync::Arc;
use loom::thread;

// In real code, gate the atomic imports behind cfg(loom).
use loom::sync::atomic::{AtomicUsize, Ordering};

// ... SpscRing impl using loom atomics ...

#[test]
fn spsc_push_pop_ordering() {
    loom::model(|| {
        let ring = SpscRing::<u32>::with_capacity(2);
        let producer = {
            let ring = ring.clone();
            thread::spawn(move || {
                let _ = ring.try_push(1);
                let _ = ring.try_push(2);
            })
        };
        let consumer = {
            let ring = ring.clone();
            thread::spawn(move || {
                let mut seen = Vec::new();
                while seen.len() < 2 {
                    if let Ok(v) = ring.try_pop() {
                        seen.push(v);
                    }
                }
                // FIFO invariant: producer pushed 1 then 2, so consumer
                // must see 1 then 2.
                assert_eq!(seen, vec![1, 2]);
            })
        };
        producer.join().unwrap();
        consumer.join().unwrap();
    });
}
```

`loom::model` explores every possible interleaving of the two threads' atomic operations under the C++/Rust memory model. If the SPSC ring has an ordering bug — say, using `Relaxed` instead of `Release` on `try_push`'s final store — `loom` finds the interleaving that exposes it.

Run with `RUSTFLAGS="--cfg loom" cargo test --release`. A clean run gives high confidence; not certainty (bounded depth), but enough to catch the common mistakes.

### Example 3: Refactoring Custom Lock-Free Code to Use `crossbeam_epoch`

Suppose you wrote a lock-free linked list and the memory reclamation is a hand-rolled grace-period scheme that does not quite work. Refactor it to use `crossbeam_epoch`, which solves the reclamation problem correctly.

Original code (sketch):

```rust
// BEFORE: custom hand-rolled list with memory leak
struct Node<T> {
    value: T,
    next: AtomicPtr<Node<T>>,
}

struct List<T> {
    head: AtomicPtr<Node<T>>,
}

impl<T> List<T> {
    fn push(&self, value: T) {
        let new = Box::into_raw(Box::new(Node {
            value,
            next: AtomicPtr::new(std::ptr::null_mut()),
        }));
        loop {
            let head = self.head.load(Ordering::Acquire);
            unsafe { (*new).next.store(head, Ordering::Relaxed); }
            if self.head
                .compare_exchange(head, new, Ordering::Release, Ordering::Acquire)
                .is_ok()
            {
                return;
            }
        }
    }
    // pop() is a memory-safety nightmare — when can we Box::from_raw the
    // popped node?  Another thread might still hold a reference.
}
```

After refactor with `crossbeam_epoch`:

```rust
// AFTER: crossbeam_epoch handles reclamation
use crossbeam_epoch::{self as epoch, Atomic, Owned, Shared};
use std::sync::atomic::Ordering;

pub struct List<T> {
    head: Atomic<Node<T>>,
}

struct Node<T> {
    value: T,
    next: Atomic<Node<T>>,
}

impl<T> List<T> {
    pub fn new() -> Self {
        Self { head: Atomic::null() }
    }

    pub fn push(&self, value: T) {
        let guard = &epoch::pin();
        let new = Owned::new(Node {
            value,
            next: Atomic::null(),
        });
        let mut new = new.into_shared(guard);
        loop {
            let head = self.head.load(Ordering::Acquire, guard);
            unsafe { new.deref().next.store(head, Ordering::Relaxed); }
            match self.head.compare_exchange(
                head, new, Ordering::Release, Ordering::Acquire, guard,
            ) {
                Ok(_) => return,
                Err(e) => new = e.new,
            }
        }
    }

    pub fn pop(&self) -> Option<T>
    where T: Clone,
    {
        let guard = &epoch::pin();
        loop {
            let head = self.head.load(Ordering::Acquire, guard);
            match unsafe { head.as_ref() } {
                None => return None,
                Some(node) => {
                    let next = node.next.load(Ordering::Acquire, guard);
                    if self.head.compare_exchange(
                        head, next, Ordering::Release, Ordering::Acquire, guard,
                    ).is_ok() {
                        let value = node.value.clone();
                        unsafe { guard.defer_destroy(head); }
                        return Some(value);
                    }
                }
            }
        }
    }
}
```

The key change is `guard.defer_destroy(head)`. Instead of `Box::from_raw`, which would immediately free memory that another thread might still be reading, `defer_destroy` queues the destruction for the next epoch boundary. `crossbeam_epoch` guarantees that by the time the destruction actually runs, no thread can still hold a reference. The reclamation problem disappears as an API concern.

This is what "using the library" looks like. Hundreds of lines of hazard-pointer or epoch-management code in your codebase shrink to a single `defer_destroy` call. The verification burden moves from you to the crossbeam maintainers, who have already done it.

---

## Pros & Cons

**Pros of designing at the professional level:**

- Your code is verifiable, not just "tested" — you can prove correctness for the model checker's bound.
- Your APIs hide complexity, making your library safer to use by less-expert teammates.
- You leverage existing battle-tested libraries (folly, crossbeam, j.u.c) rather than reimplementing, saving months of work and verification.
- You can mentor your team out of common anti-patterns like relaxed-flag bugs.
- Your code runs correctly on weakly-ordered hardware (ARM, POWER), not just x86.

**Cons:**

- Verification tooling (TLA+, CBMC, loom) has a learning curve measured in weeks.
- Pulling in folly or crossbeam adds a dependency that must be maintained, updated, and audited.
- The skills you build at this level are concentrated — there are few opportunities to apply them, so they atrophy.
- Communicating with non-expert teammates is harder; you must translate memory-model arguments into terms they can act on in code review.
- The "rolling your own is bad" advice is hard to enforce when a senior engineer is excited about a paper they just read.

---

## Use Cases

Professional-level atomic work appears in the following contexts:

- **Language runtimes** — JVM `j.u.c`, Go's runtime scheduler, Rust async runtimes (Tokio), Erlang/BEAM message passing.
- **Database engines** — write-ahead log buffers, lock-free B-tree variants (Bw-tree, OLFIT), MVCC transaction managers.
- **High-performance networking** — DPDK ring buffers, kernel-bypass NIC queues, multi-queue packet schedulers.
- **Tracing and metrics libraries** — distributed tracing libraries collecting spans across threads with minimal overhead.
- **Game engines** — task graphs, job systems with work stealing, lock-free entity component systems.
- **HPC and scientific computing** — atomic accumulation in parallel reduction, lock-free hash tables for graph algorithms.
- **Embedded real-time systems** — wait-free protocols for inter-core communication where bounded latency is required.
- **OS kernels** — RCU in Linux, sequence locks, per-CPU counters, lock-free interrupt-handler-to-task communication.

---

## Coding Patterns

**Pattern 1: Library API surface.** Hide all memory-order details behind named operations. Users call `queue.try_push(x)`, never `queue.head.compare_exchange(..., Release, Acquire)`. The discipline forces correct ordering at the API boundary.

**Pattern 2: Verification-first.** For any non-trivial lock-free structure, write the `loom` test or TLA+ spec before the implementation is finalized. If the model fails, fix the model and the code together.

**Pattern 3: Document every relaxed ordering.** Every `memory_order_relaxed` (or `Ordering::Relaxed`) gets an inline comment explaining why it is safe. No exceptions.

**Pattern 4: Pair acquire and release.** Every release-store has a matching acquire-load in another thread. Document the pairing in a comment naming the other site.

**Pattern 5: Reclamation as a separate concern.** Use `crossbeam_epoch`, hazard pointers, or RCU rather than hand-rolling reclamation. If you must roll your own, write the reclamation as a separate module with its own tests.

**Pattern 6: Cacheline padding for hot fields.** Producer-only and consumer-only fields go on separate cachelines using `#[repr(align(64))]` or `alignas(64)`. Measure before and after.

**Pattern 7: Snapshot operations are weak by design.** `len()`, `is_empty()`, and similar inspection operations return weakly-consistent snapshots. Document this explicitly so users do not write algorithms depending on consistency.

**Pattern 8: Library escape hatches.** Provide a way to swap your lock-free implementation for a locking implementation at compile time or via configuration. Makes A/B testing trivial and lets you roll back if a bug appears.

---

## Clean Code

Clean code at this level is *documented* code. The cleanliness is in the comments, not the symbols.

A clean lock-free function names its acquire/release pairs:

```rust
// PRODUCER: publishes a new tail position.  The Release ordering on this
// store synchronizes with the CONSUMER's Acquire load of `tail` in
// `try_pop` (line ~XX).  This pairing guarantees that data written to
// `self.buf[tail & mask]` above is visible to the consumer after the
// consumer sees the new tail value.
self.tail.store(tail + 1, Ordering::Release);
```

Clean code separates concerns: the data-structure invariants are in one module, the memory reclamation in another, the API surface in a third. A user reading the public API does not see `defer_destroy` or epoch handling.

Clean code names things by what they mean, not what they do. `try_push` is good; `cas_tail` is implementation detail leaking through the name.

Clean code uses sequential consistency by default and downgrades only with justification. Reading a lock-free module that uses `seq_cst` everywhere is much easier than reading one that uses six different orderings.

Clean code has compile-time toggles for verification (`#[cfg(loom)]`, `#ifdef CBMC`) so the same source is used in production and in the model checker.

---

## Best Practices

1. **Adopt a battle-tested library** before considering custom code. Defaults: `java.util.concurrent` on the JVM, folly in C++, crossbeam in Rust.
2. **Verify with a tool**, not just tests. Pick one of TLA+, CBMC, loom (or your language's equivalent).
3. **Test on weakly-ordered hardware.** Run your test suite on ARM (Apple silicon, Graviton, Raspberry Pi). Bugs that hide on x86 surface on ARM.
4. **Document every memory ordering choice.** The comment is part of the code, not optional.
5. **Pad to avoid false sharing.** Use `#[repr(align(64))]` for any field touched by multiple threads on different cores.
6. **Use sequential consistency by default.** Justify any weaker ordering in comments and in code review.
7. **Separate reclamation from algorithm.** Use epoch-based or hazard-pointer libraries.
8. **Profile before optimizing.** Lock-free is not always faster; locks under low contention often win.
9. **Provide a locking fallback.** Compile-time switchable implementation enables A/B testing.
10. **Mentor your team.** When you see a relaxed flag, do not just fix it — explain it.
11. **Read primary sources.** Treiber 1986, Michael-Scott 1996, Herlihy's papers. The textbooks omit details.
12. **Track upstream library versions.** Bugs in folly and crossbeam are sometimes fixed; subscribe to release notes.
13. **Maintain a verification harness in CI.** TLA+ models or loom tests run on every PR touching the concurrent module.

---

## Edge Cases & Pitfalls

- **The relaxed flag bug.** Using `memory_order_relaxed` for a flag that signals other data is ready. Always use `release`/`acquire` for flag-and-data patterns.
- **The "free on x86, broken on ARM" pitfall.** Code that uses `volatile` (in C/C++) or omits barriers works by accident on x86's strong memory model and fails on ARM. Always test on a weak architecture.
- **ABA on pointer-tagged data.** Even with epoch-based reclamation, ABA can occur on tagged pointers if you reuse tag bits. Reserve enough tag bits or use double-width CAS.
- **Reclamation deadlock.** If your reclamation scheme depends on every thread eventually quiescing, but one thread is blocked waiting for memory to be freed, you deadlock. Hazard pointers and epoch reclamation both have variants of this issue.
- **`atomic_shared_ptr` performance cliff.** Under high contention, the deferred-reclamation overhead can be worse than a mutex around a `shared_ptr`. Benchmark, do not assume.
- **`memory_order_consume` is broken.** Every compiler implements consume as acquire. Do not rely on consume's weaker semantics.
- **Spurious failure of CAS-weak.** `compare_exchange_weak` can fail even when the compare succeeded. Always use it in a loop, never standalone.
- **Loom is sound but incomplete.** Loom explores bounded interleavings; it can miss bugs that manifest only with more threads or longer histories. Use it in addition to, not instead of, careful reasoning.
- **TSAN false negatives on atomics.** Thread sanitizer may not catch all ordering bugs because it relies on dynamic execution. Static verification catches more.
- **Performance regression from `seq_cst`.** On ARM, every `seq_cst` operation costs a `dmb ish` barrier. Hot loops may need acquire/release with documented reasoning.

---

## Common Mistakes

- **Rolling your own lock-free queue when crossbeam has one.** The customization rarely justifies the months of verification.
- **Skipping the loom test because "it's tested."** Stress tests cannot prove memory-order correctness.
- **Using `Relaxed` for "performance" without measuring.** The cost of `seq_cst` is often invisible in real workloads.
- **Treating ARM as "like x86 but slower."** ARM has fundamentally different ordering rules.
- **Letting reclamation leak into the API.** Users should not see epochs, hazards, or RCU read-sides.
- **Ignoring the Boehm paper.** Believing you can implement thread-safe libraries in pre-C++11 C is the road to ruin.
- **Reading textbook simplifications instead of papers.** Textbooks omit corner cases.
- **No comment justifying each memory ordering.** Code reviewers cannot validate without intent.
- **No cacheline padding on hot atomic fields.** False sharing destroys lock-free performance.
- **Assuming the JVM's JMM is the same as the C++ model.** They are similar but not identical (data race semantics differ).
- **Forgetting to test on multiple JVMs or compilers.** Different JIT compilers may schedule barriers differently.
- **Letting the lock-free version stay in production after the contention has subsided.** Lock-free is a tool for high contention; if your service's traffic dropped, locks might be cleaner.

---

## Tricky Points

- **The JMM treats `final` fields specially.** A `final` field initialized in a constructor is guaranteed visible to other threads after construction without explicit synchronization. This is the foundation of immutable object thread safety.
- **`volatile` in Java is sequentially consistent.** Unlike `volatile` in C/C++, which provides no thread-safety guarantees, Java's `volatile` is roughly equivalent to a C++ `atomic` with `seq_cst`.
- **`memory_order_consume` was intended to be cheaper than acquire on POWER and ARM.** It would have allowed data-dependency-only synchronization. Compilers found it impossible to track dependencies reliably; they all promote consume to acquire. The standard committee is reworking it.
- **`fetch_add` on a counter is *not* a memory barrier on its own.** With relaxed ordering, you get atomic update but no visibility ordering with other data. People forget this.
- **CAS-on-the-tail-pointer in Michael-Scott queue can fail without the queue being modified.** The algorithm handles this by allowing tail to lag behind reality and lazily catching up. Naive reimplementations skip this and break.
- **`std::atomic_ref` requires every concurrent access to go through `atomic_ref`.** If anyone uses a plain reference to the same object, you have a data race. The type system does not enforce this.
- **HotSpot inlines `Atomic*` methods aggressively.** A `getAndIncrement` may compile to a single `lock xadd` on x86. Microbenchmarks need to disable inlining cautiously, or you measure the JIT, not the algorithm.
- **`crossbeam_epoch::pin` is cheap but not free.** It increments a thread-local epoch counter. Pinning in a tight loop can hurt; cache the guard across operations when possible.
- **The Linux kernel's `READ_ONCE`/`WRITE_ONCE` macros are not atomic.** They prevent the compiler from tearing or reordering, but on weakly-ordered hardware you still need explicit barriers.
- **TSAN does not understand all memory orderings.** Recent versions handle acquire/release but historically did not. Verify your TSAN version.

---

## Test Yourself

1. Why does CAS have consensus number infinity while fetch-and-add has only 2? Sketch the wait-free consensus protocol for two threads using fetch-and-add and explain why it does not extend to three.
2. Show an interleaving in which the SPSC ring example produces incorrect output if `Release` on `try_push` is downgraded to `Relaxed`. Use the operational reordering rules of the C++/Rust memory model.
3. The Michael-Scott queue keeps a sentinel node so that head and tail never become null. Why is this important for correctness, not just convenience?
4. Explain the difference between linearizability and sequential consistency with a concrete example involving a thread-safe map.
5. Why does `crossbeam_epoch::defer_destroy` not free memory immediately, and what would go wrong if it did?
6. When would you choose `std::atomic<bool>` over `std::atomic_flag` in C++20, and vice versa?
7. Read the relaxed flag example in the mentoring section. Now suppose `data` is a `std::atomic<int>` (instead of plain `int`). Is the example correct with all-relaxed atomics? Justify.
8. Pick any data structure in `java.util.concurrent` and identify exactly which operations are linearizable and which are weakly consistent. Cite the Javadoc.

---

## Tricky Questions

1. **Could you implement a wait-free queue using only fetch-and-add?** Argue from the consensus hierarchy. If your answer is no, what is the strongest progress guarantee you can achieve with fetch-and-add alone?
2. **Why did Hans Boehm publish "Threads cannot be implemented as a library"?** What is the title's claim, and what specific compiler optimization motivated it?
3. **The original Treiber stack does not handle ABA.** How does Java's `ConcurrentLinkedDeque` (which is internally a Treiber-like structure for the deque ends) avoid ABA?
4. **You add hardware transactional memory to your design.** Where does HTM fit in Herlihy's consensus hierarchy, and what aborts does the runtime need to handle?
5. **A junior engineer benchmarks your lock-free queue and finds it slower than a `std::mutex`-protected queue.** Walk through the analysis steps you would use to determine whether the lock-free version is fundamentally inappropriate or just under-tuned.
6. **You want to verify a 200-line lock-free data structure.** Do you reach for TLA+, CBMC, or loom first? Defend your choice based on what each tool is best at.
7. **Two threads alternate writing to and reading from a `std::atomic<int>` with `seq_cst`. The reader sometimes sees a stale value.** Is this a memory-model bug, a coherence problem, or expected behavior? Explain.
8. **The C++ memory model is "data-race-free under sequential consistency."** What exactly counts as a data race, and why does the model permit arbitrary behavior in racy programs?

---

## Cheat Sheet

```
PROGRESSION
junior:        use one atomic class, understand CAS
middle:        memory orders, ABA, build small structures
professional:  design libraries, verify with tools, mentor

LIBRARIES TO REACH FOR
JVM:    java.util.concurrent (Doug Lea)
C++:    folly, Concurrencpp
Rust:   crossbeam, parking_lot (for locks)

MEMORY ORDERS (C++)
relaxed     no sync, atomic only
acquire     load+sync with release
release     store+sync with acquire
acq_rel     RMW with both
seq_cst     total order across threads (DEFAULT)

JMM PRIMITIVES
volatile    seq_cst on read/write
final       safe publish after constructor
synchronized happens-before via monitor

VERIFICATION
TLA+        high-level model, model checker (TLC)
CBMC        bounded model check of C code
loom        Rust model checker for atomics
sanitizers  TSAN/UBSAN — dynamic, not exhaustive

WHEN NOT TO ROLL YOUR OWN
- existing library covers 90%+ of need
- no verification expertise on team
- contention < 100k ops/sec/core
- not on critical path

ABA REMEDIES
- crossbeam_epoch (Rust)
- hazard pointers (folly, Michael 2004)
- RCU (Linux kernel)
- 128-bit CAS (x86_64 has cmpxchg16b)

ARCHITECTURE GOTCHAS
x86          strong; acquire/release nearly free; SC needs mfence on store
ARMv8        weak; acquire and release have ldar/stlr; SC = dmb ish
POWER        weakest; LL/SC; sync and lwsync barriers

HISTORICAL PAPERS
1986   Treiber stack (IBM RJ 5118)
1991   Herlihy, wait-free hierarchy
1996   Michael-Scott queue (PODC)
2001   Harris, lock-free linked list (DISC)
2004   JSR-133 finalized
2004   Michael, hazard pointers (IEEE TPDS)
2008   Herlihy & Shavit textbook (1st ed)
2011   C++11 memory model (Boehm/Adve)
2020   Herlihy & Shavit 2nd edition
```

---

## Summary

The professional level of atomic operations is where the focus shifts from individual primitives to the design of *systems* of primitives — libraries, with API surfaces, verification stories, and integration with the rest of the codebase. You are no longer asking "how do I use CAS?" but "should we build this at all, and if so, how do we prove it correct?"

The intellectual core of this level is the memory model — JSR-133 on the JVM, C++11/20 on C++ — as a *contract* between programmer and machine. The contract makes weak hardware tractable and lets programmers reason about visibility without thinking about cache coherence directly. Sequential consistency is the default; weaker orderings are escape hatches with documented justification.

The practical core is restraint and verification. Restraint, because the existing libraries — `java.util.concurrent`, folly, crossbeam — represent decades of expert work, and rolling your own is almost always wrong. Verification, because lock-free code that "passes tests" can still hide bugs that fire once a billion operations and only on ARM. TLA+, CBMC, and loom are the tools that let you escape the testing trap.

The social core is mentoring. You spot the engineer reaching for `memory_order_relaxed` without justification and redirect them. You insist on comments for every ordering choice. You bring in primary sources — the Treiber paper, the Michael-Scott paper, Herlihy and Shavit — instead of letting your team rely on Stack Overflow excerpts.

The historical core is the lineage. Every pattern has a paper. Knowing the paper tells you the original constraints, the gotchas, and the assumptions that may not hold in 2026. Read primary sources. They are clearer than textbook simplifications and they record what the algorithm actually requires.

If you take three things away from this article: prefer a battle-tested library to your own implementation; verify with a tool rather than trusting tests; and treat every memory-ordering choice as a piece of design that must be documented and justified. That mindset, more than any specific technique, is what separates professional lock-free engineering from senior-level work.

---

## What You Can Build

- A production lock-free MPMC queue with verified linearizability, documented memory orders, and integrated metrics — comparable in quality to folly's `MPMCQueue`.
- An epoch-based reclamation library for your codebase that wraps crossbeam_epoch (Rust) or hazard pointers (C++) behind an ergonomic API.
- A TLA+ specification suite for the lock-free primitives in your runtime, run in CI, that catches ordering regressions on every commit.
- A teaching repository with progressively harder lock-free exercises (SPSC ring, MPSC queue, MPMC queue, lock-free hashmap), each with loom tests and an explanation document.
- A migration plan for your team to replace hand-rolled lock-free code with `java.util.concurrent`, folly, or crossbeam — with benchmarks proving the replacement is at least as fast.
- A linter or code-review tool that flags every `memory_order_relaxed` (or `Ordering::Relaxed`) without an accompanying justifying comment.
- An ARM-vs-x86 differential test harness that runs the same atomic stress test on both architectures and surfaces ordering bugs that hide on x86.

---

## Further Reading

- Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*, 2nd edition, Morgan Kaufmann, 2020. The standard textbook on concurrent algorithms. Every chapter is worth reading.
- Jeff Preshing's blog (preshing.com). Posts on memory ordering, lock-free programming, and atomic operations. The articles "Memory Ordering at Compile Time," "Acquire and Release Semantics," and "An Introduction to Lock-Free Programming" are required reading.
- Hans-J. Boehm, "Threads Cannot be Implemented as a Library," PLDI 2005. The paper arguing that thread safety must be a language-level concern, not a library-level concern. The intellectual foundation of the C++11 memory model.
- R. Kent Treiber, "Systems Programming: Coping with Parallelism," IBM Research Report RJ 5118, 1986. The original Treiber stack.
- Maged M. Michael and Michael L. Scott, "Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms," PODC 1996. The Michael-Scott queue.
- Maged M. Michael, "Hazard Pointers: Safe Memory Reclamation for Lock-Free Objects," IEEE TPDS 15(6), 2004.
- Maurice Herlihy, "Wait-Free Synchronization," ACM TOPLAS 13(1), 1991. The consensus hierarchy paper.
- Maurice Herlihy and Jeannette Wing, "Linearizability: A Correctness Condition for Concurrent Objects," ACM TOPLAS 12(3), 1990.
- Doug Lea, *Concurrent Programming in Java*, 2nd edition, Addison-Wesley, 2000. The design notes behind `java.util.concurrent`.
- JSR-133: "Java Memory Model and Thread Specification Revision," 2004. The formal JMM.
- Hans-J. Boehm and Sarita V. Adve, "Foundations of the C++ Concurrency Memory Model," PLDI 2008. The C++ model derivation.
- Paul E. McKenney, *Is Parallel Programming Hard, And, If So, What Can You Do About It?* (perfbook). Free book covering RCU and Linux kernel concurrency.
- The folly source code: `folly/concurrency/` and `folly/synchronization/`. Read with a copy of Herlihy & Shavit beside you.
- The crossbeam source code: `crossbeam-epoch`, `crossbeam-queue`, `crossbeam-deque`. Rust's reference standard for lock-free.
- The `loom` documentation and the Tokio internals using it.
- Leslie Lamport, *Specifying Systems*. The TLA+ book.

---

## Related Topics

- [Memory Model](../../03-memory-model/README.md) — the formal foundation under all atomic operations
- [Locks and Mutexes](../03-locks/README.md) — the alternative; often the right answer
- [Lock-Free Data Structures](../../04-lock-free/README.md) — designs built on atomic primitives
- [Hardware Concurrency Support](../../05-hardware/README.md) — what the CPU actually provides
- [Concurrency Models](../../01-models/README.md) — message passing as an alternative paradigm
- [Performance Engineering](../../../quality-engineering/performance/README.md) — profiling and measurement methodology
- [Formal Verification](../../../formal-methods/README.md) — TLA+, CBMC, and proof techniques

---

## Diagrams & Visual Aids

### Wait-Free Hierarchy

```
consensus
number       primitive                       examples
------       ---------                       --------
infinity     compare-and-swap, LL/SC         x86 lock cmpxchg, ARM ldxr/stxr
   2         test-and-set, swap,             x86 xchg, lock bts
             fetch-and-add
   1         atomic read/write registers     plain volatile loads/stores
```

### Happens-Before DAG of SPSC Ring

```
PRODUCER                            CONSUMER
--------                            --------
buf[tail & mask] = v   ----release--load--->  while head == tail spin
tail.store(tail+1, R)                         tail.load(Acquire)
                                              v = buf[head & mask]
                                              head.store(head+1, R)
                                                       |
buf[tail & mask] = v2  <---acquire--store--- ...slot is free, reuse it
```

### Memory Order Cost (Approximate, x86 vs ARMv8)

```
operation             x86 cycles    ARMv8 cycles
---------             ----------    ------------
relaxed load              1               1
relaxed store             1               1
acquire load              1               2  (ldar)
release store             1               2  (stlr)
seq_cst load              1               2  (ldar)
seq_cst store             ~20 (mfence)    ~10 (dmb ish)
CAS                       ~20             ~10
```

### When To Roll Your Own Lock-Free

```
                contention >100k ops/sec/core ?
                /                           \
              no                            yes
              |                             |
          USE LOCKS              existing library fits ?
                                  /                   \
                                yes                    no
                                |                       |
                             USE LIBRARY      verification expertise ?
                                              /                   \
                                            yes                    no
                                            |                       |
                                       MAYBE BUILD              USE LIBRARY
                                       (months of work)         (accept the cost)
```

### Verification Pyramid

```
                /\
               /  \   peer-reviewed publication
              /----\
             /      \  TLA+ formal proof
            /--------\
           /          \  CBMC / loom model check
          /------------\
         /              \  stress test on weak HW
        /----------------\
       /                  \  unit tests
      /--------------------\
     / code review by expert\
    /------------------------\
```

### History Timeline

```
1986      Treiber stack
1990      Herlihy-Wing linearizability
1991      Herlihy wait-free hierarchy
1996      Michael-Scott queue
2001      Harris lock-free linked list
2004      JSR-133 (Java Memory Model)
2004      Michael hazard pointers
2005      Boehm: threads cannot be a library
2008      C++ memory model finalized in C++0x draft
2008      Herlihy & Shavit textbook 1st ed
2011      C++11 ships
2013      Intel TSX (HTM) introduced, disabled, re-enabled
2017      crossbeam-epoch reaches stability
2019      loom (Rust) released
2020      C++20: atomic_ref, atomic_shared_ptr, atomic::wait
2020      Herlihy & Shavit 2nd edition
```
