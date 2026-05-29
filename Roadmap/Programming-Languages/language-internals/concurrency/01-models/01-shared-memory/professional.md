# Shared-Memory Concurrency — Professional Level

> **Topic:** [Shared-Memory Concurrency](README.md)
> **Focus:** library/system design, lock-free engineering, history, mentoring

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
  - [Designing Concurrent Data Structures](#designing-concurrent-data-structures)
  - [Lock-Free Queue Case Study](#lock-free-queue-case-study)
  - [Linux Kernel Toolkit](#linux-kernel-toolkit)
  - [Language Primitives as Library Design](#language-primitives-as-library-design)
  - [Migrating Off Shared Memory](#migrating-off-shared-memory)
  - [Verification](#verification)
  - [The Go Maxim](#the-go-maxim)
  - [History](#history)
  - [Hardware Trends](#hardware-trends)
  - [Mentoring: Code-Review Heuristics](#mentoring-code-review-heuristics)
  - [Anti-Patterns at Scale](#anti-patterns-at-scale)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Clean Code](#clean-code)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Common Mistakes](#common-mistakes)
- [Tricky Points](#tricky-points)
- [Test Yourself](#test-yourself)
- [Tricky Questions](#tricky-questions)
- [Cheat Sheet](#cheat-sheet)
- [Summary](#summary)
- [What You Can Build](#what-you-can-build)
- [Further Reading](#further-reading)
- [Related Topics](#related-topics)
- [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

At the professional level — Staff, Principal, Distinguished engineer — shared-memory concurrency stops being a feature you use and becomes a substrate you design, defend, and teach. You are no longer the person who reaches for `sync.Mutex` and ships; you are the person who decides whether your platform will expose mutexes at all, who reviews the lock-free ring buffer a team across the building wants to merge, and who pages in to debug a corruption that only manifests on 96-core ARM machines under saturating load. The mental shift is from "how do I correctly use these primitives" to "how do I keep an entire organization correctly using these primitives, and what new primitives do we need?"

This document assumes you have absorbed the junior, middle, and senior tiers. You already know the C++ and Go memory models, you can reason about happens-before, you can implement a correct lock-free stack from atomics, and you have read the JSR-133 cookbook at least once. What changes here is breadth and consequence. We will look at the design recipes professionals follow when committing a new concurrent data structure to a shared library; we will dissect the Michael-Scott queue, the LCRQ, and the LMAX Disruptor as case studies in evolution of the same idea over twenty years; we will tour the Linux kernel's concurrency toolkit because no other body of code teaches scalability as ruthlessly; we will examine how Doug Lea, Hans Boehm, Russ Cox, and Linus Torvalds approach the same problems with different priors and how their choices have shaped Java JUC, C++11, Go, and the Linux kernel.

Finally, we will spend significant time on history and on mentoring. Shared-memory concurrency is one of the few areas of software where the 1965 paper still matters in 2026, and where the senior engineers in your organization either learned from those papers or learned from people who did. You cannot review a PR that introduces a new spinlock without knowing why Dijkstra wrote about semaphores, why Hoare wrote about monitors, why Lamport wrote about bakery, why Herlihy wrote about wait-freedom. Your job at this tier is partly to be the institutional memory of these ideas.

---

## Prerequisites

- Junior, middle, and senior tiers of this topic fully internalized.
- Comfort writing and reading lock-free code in at least one of C++, Rust, Java, or Go.
- Experience debugging production memory-order bugs on weakly-ordered hardware (ARM, POWER).
- Familiarity with at least one formal-methods tool (TLA+, Spin, Coq, Alloy, or loom).
- Operational experience: paging, capacity planning, post-mortems, mentoring incident reviews.
- A track record of shipping or maintaining a non-trivial concurrent library (a connection pool, a job queue, a cache, a scheduler).

---

## Glossary

| Term | Meaning |
|------|---------|
| Wait-free | Every operation completes in a bounded number of steps regardless of other threads. |
| Lock-free | At least one thread makes progress in a bounded number of steps system-wide. |
| Obstruction-free | A thread makes progress when run in isolation; weakest non-blocking guarantee. |
| Linearizability | Each operation appears to take effect atomically at some point between its invocation and response. |
| Sequential consistency | Operations across all threads form a total order consistent with each thread's program order. |
| Quiescent consistency | Operations separated by a quiescent period appear in real-time order. |
| Memory reclamation | Safely freeing memory in a lock-free structure (epochs, hazard pointers, RCU). |
| ABA problem | A value changes from A to B and back to A, fooling a CAS into thinking nothing happened. |
| Hazard pointer | A per-thread published pointer announcing "I am reading this" so writers defer reclamation. |
| Epoch-based reclamation | Threads enter an epoch; memory is reclaimed only when all threads have left earlier epochs. |
| RCU | Read-Copy-Update: readers are wait-free; writers wait for a grace period before reclaiming. |
| Seqlock | Sequence counter lock — fast readers, optimistic concurrency, retry on writer interleave. |
| Per-CPU variable | One copy of data per CPU, no synchronization for local access. |
| NUMA | Non-uniform memory access — memory access cost depends on which CPU socket touches it. |
| False sharing | Two unrelated variables on the same cache line cause coherence traffic. |
| LCRQ | Linked Concurrent Ring Queue — Morrison and Afek 2013, FAA-based, near-wait-free. |
| MS queue | Michael-Scott two-lock or lock-free queue, the canonical 1996 design. |
| Memory model | Formal contract between hardware/compiler and programmer about visible orderings. |
| TLA+ | Lamport's specification language for concurrent and distributed systems. |
| Spin | Holzmann's model checker based on Promela. |
| Loom | Rust crate that exhaustively explores interleavings under permissive memory model. |
| Stress + rr | Linux record-replay debugger used to capture and replay races deterministically. |

---

## Core Concepts

### Designing Concurrent Data Structures

When a team comes to you wanting to ship a new concurrent data structure — a faster MPMC queue, a custom striped map, a wait-free counter — you should walk them through a recipe in this exact order. Skipping a step is the single most common cause of structures that "passed CI" and corrupted production.

**Step 1: Correctness proof, on paper, before any code.** Define the linearization points of each operation. For each operation, point to a specific atomic step that "is" the moment the operation took effect. If you cannot do this, you do not have a lock-free design; you have a wish.

**Step 2: Algorithm.** Choose the algorithmic family. Is this a Treiber stack with hazard pointers? A Michael-Scott queue with epoch reclamation? An LCRQ with a fallback list? Skip-list, BW-tree, lock-free hash with Cliff Click's algorithm? Write pseudocode. Walk three colleagues through it on a whiteboard. If two of them cannot poke a hole, you may be looking at a real design.

**Step 3: Memory ordering.** Annotate every atomic with the weakest ordering that preserves the proof from step 1. Default to seq_cst only if you cannot articulate why a weaker ordering suffices. Document each ordering choice in a comment that references the linearization argument. This is the step that distinguishes professional from senior — seniors choose orderings correctly; professionals leave a trail others can audit.

**Step 4: Testing.** Three layers. Unit tests under TSan and UBSan. Stress tests on the most weakly ordered hardware you can find (typically aarch64 in 2026). Model-checking under loom or relacy or TLA+ for an abstracted form. Never ship a structure whose only test is "ran the benchmark and got no crashes."

**Step 5: Benchmark.** Measure throughput and tail latency under at least three loads: uncontended single-thread, contended same-NUMA-node, contended cross-socket. Compare against the obvious alternative (a mutex-protected baseline). If you are not beating the mutex by at least 3x on contended cross-socket, you have probably not justified the complexity.

This recipe is itself a deliverable. Document it in your team's wiki. Reference it from every PR review of a concurrent structure. Make it harder to add a new lock-free structure to your codebase than to add one more mutex.

### Lock-Free Queue Case Study

The lock-free MPMC queue is the canonical example because it has been redesigned every few years for thirty years and each redesign teaches a lesson.

**Michael and Scott 1996.** Two-lock queue for the simple variant; lock-free version uses CAS on head and tail. Sentinel node ensures head and tail never alias even when empty. Memory reclamation in the original paper assumes a garbage collector; in C++ you must add hazard pointers or epoch-based reclamation. The MS queue is correct, durable, taught everywhere — but it does not scale beyond about 8 producers because of CAS contention on the tail pointer. Lesson: a correct lock-free design can still be a poor scalability story.

**LMAX Disruptor 2010.** Martin Thompson and team built a ring buffer with single-producer or multi-producer modes, distinguishing the sequence claim from the sequence publish, and aggressively pre-allocating. The Disruptor is technically blocking (it spins) but achieves microsecond-level inter-thread handoff because it avoids garbage, avoids allocation in the hot path, and is mechanically sympathetic — cache-line padded, NUMA-aware, batch-oriented. Lesson: lock-free purity is not the goal; predictable latency is. A spin-based design that fits in L1 can beat a "pure" lock-free design that thrashes the coherence fabric.

**LCRQ — Morrison and Afek 2013.** A linked list of ring queues, where each ring uses fetch-and-add instead of CAS for enqueue/dequeue index claiming. FAA is wait-free on x86 (xadd) and significantly less contended than CAS because there is no retry loop. The LCRQ approaches wait-freedom in practice. The cost is complexity — handling ring-full transition, CRQ closure, and reclamation is intricate. Lesson: the right primitive (FAA vs CAS) can change the asymptotic contention behavior. Hardware primitives matter; pick yours deliberately.

The arc from MS to Disruptor to LCRQ is a lesson in how a single problem evolves with hardware. In 1996 we had few cores and CAS was the obvious primitive. In 2010 cache effects dominated and mechanical sympathy mattered more than theoretical lock-freedom. In 2013 FAA on modern x86 was cheap enough to redesign around it. In 2026 we have efficiency cores and big cores on the same die, NUMA at chiplet granularity, and CXL memory pools — and the next great queue design will reflect those.

### Linux Kernel Toolkit

No body of code teaches concurrency like the Linux kernel. You should read at least the documentation for these three primitives, and ideally trace through the implementations.

**RCU (Read-Copy-Update).** Readers traverse data structures without locks, atomics, or even memory barriers on most architectures. Writers create a new version, swap an atomic pointer, then wait for a grace period before freeing the old version. The grace period is defined as "all CPUs have passed through a quiescent state since the swap" — for the classic preemptible-disabled variant, that means every CPU has scheduled at least once. RCU achieves zero-cost reads at the price of write-side latency and memory bloat during grace periods. It is the right answer for read-mostly structures: routing tables, mount tables, security modules.

**Seqlocks.** A sequence counter incremented by writers before and after a write. Readers snapshot the counter, read the data, and re-read the counter; if odd or changed, retry. Writers exclude each other with a spinlock; readers never block writers. Perfect for read-heavy data where the read is short, the data is small, and writes are rare — for example `jiffies` and time-of-day in the kernel.

**Per-CPU variables.** One copy of a counter or list head per CPU. Local operations need no synchronization at all (just preemption disable). Reads of "the total" walk all CPUs. Ideal for statistics, slab allocators, network packet counters. The cost is memory proportional to CPU count and the read-side cost of aggregation.

The deeper lesson from the kernel is that no single primitive is right. The kernel uses spinlocks, mutexes, rwsems, RCU, seqlocks, per-CPU vars, atomic counters, lockless rings, and more — each chosen for a specific access pattern. A professional concurrency engineer thinks the same way: there is no default; there is a question to ask about access patterns and then a primitive that fits.

### Language Primitives as Library Design

Step back and look at how each language exposes shared-memory concurrency. The libraries themselves are case studies in API design.

**Java java.util.concurrent — Doug Lea.** JUC is the canonical concurrent library because Doug Lea spent twenty years iterating on it in public, with academic rigor. The decisions that defined it: a small core of primitives (locks, atomics, queues, executors) that compose; a Memory Model formalized in JSR-133 to make those primitives reasonable; a willingness to ship sharp tools (LockSupport, Unsafe, VarHandle) for library authors while pushing application authors toward higher-level abstractions (Executor, CompletableFuture). The lesson for library designers: write your concurrent library against a formal memory model and document it.

**C++ <atomic> and <thread>.** C++11 introduced a memory model and atomic types deliberately modeled after Java's — with Hans Boehm and the SG1 committee borrowing JSR-133's vocabulary while adding richer ordering options (memory_order_relaxed, acquire, release, acq_rel, seq_cst, plus the controversial consume). The C++ standard library deliberately stops at primitives; the rich concurrent containers live in TBB, folly, abseil. Lesson: a standard library can choose to ship only the primitives and leave the structures to ecosystems — but only if the primitives are precise enough to compose.

**Go sync.** Russ Cox and team made an opinionated choice: channels first, mutexes when channels do not fit, and a deliberately small sync package (Mutex, RWMutex, WaitGroup, Once, Pool, Cond, Map, atomic). Go's memory model was informal until 2022 when it was rewritten to align with C++/Java. Lesson: opinionation has costs and benefits; Go's small surface area is teachable and consistent, but Go programmers reach for sync.Map and sync.Pool with less precision than Java programmers reach for ConcurrentHashMap, partly because Go's docs explain less.

**Rust std::sync.** Rust's distinguishing move was to bake concurrency safety into the type system via Send and Sync, not just into runtime primitives. The type system prevents data races at compile time — but only data races, not race conditions or deadlocks. Lesson: language design and library design are inseparable; Rust gets to ship Mutex<T> with confidence that you cannot accidentally share &mut T because the borrow checker enforces it.

When you design a concurrent library for your organization, you are making the same decisions. Will you expose raw atomics? A small set of primitives and a memory model? Higher-level structures? A type discipline? Whatever you choose, document it as a contract, not as a tutorial.

### Migrating Off Shared Memory

A senior engineer knows when to use shared memory. A professional engineer knows when to leave it.

**Signs you should migrate to actors or CSP.** Your shared-memory code has accreted layers of locks, lock orderings, and condition variables. Your bug tracker has a recurring "concurrency-related" tag. Onboarding time for new engineers includes a multi-day "do not touch the lock manager" warning. Your post-mortems blame lock ordering inversions, not algorithmic bugs.

**What you gain by moving.** Locality of reasoning: each actor's state is its own. Easier testing: you can drive an actor with a sequence of messages. Easier supervision and restart: an actor is the unit of failure. Easier distribution: actors can move across processes or hosts with little API change.

**What you lose.** Throughput on hot paths, because message passing involves more allocation and more cache misses than a CAS. Predictable latency, because schedulers introduce variance. The ability to atomically read across multiple pieces of state, because actor boundaries make that explicit and slow.

**The hybrid in practice.** Most successful large systems are not pure shared-memory or pure actor. They have an actor or CSP shell with shared-memory cores: each service is single-threaded or actor-based at the orchestration layer, with hot per-request work using lock-free queues, RCU, or per-CPU structures. Erlang/OTP looks like actors at the surface and uses shared memory aggressively inside the BEAM. The Linux kernel looks like shared memory at the surface and uses per-CPU partitioning to behave like an actor system on the hot paths. The shape that wins is "actors at the boundary, shared memory at the engine, type discipline enforcing the boundary."

When you advise a team to migrate, walk them through this shape rather than prescribing actors as a silver bullet.

### Verification

At your level, "I tested it" is not an engineering claim. Verification is.

**TLA+.** Lamport's specification language. You write the algorithm at a high level — typically a few hundred lines for a non-trivial concurrent structure — and TLC model-checks all interleavings up to a finite bound. AWS uses TLA+ for DynamoDB and S3. Use TLA+ when you need to convince yourself and a reviewer that a protocol is correct before you write a line of code.

**Spin/Promela.** Holzmann's older but still excellent model checker. Promela is C-like; the checker explores state space exhaustively or with bitstate hashing. Spin found bugs in flight software and telephone switches in the 1990s and still finds bugs in concurrent libraries today.

**Rust loom.** A crate that runs your test under a permissive memory model and exhaustively explores interleavings. Limited to bounded state spaces but excellent for unit-testing a lock-free data structure. Replaces the "run it a million times and pray" approach with deterministic coverage.

**Stress + rr.** Mozilla's rr is a record-replay debugger that captures a single execution and replays it deterministically. Combined with chaos stress (random sleeps, thread pinning), rr lets you reproduce a once-in-a-billion race deterministically once you catch it.

**Sanitizers.** ThreadSanitizer detects data races at runtime with about 5-20x slowdown. AddressSanitizer catches use-after-free. MemorySanitizer catches uninitialized reads. Run your concurrent code under TSan in CI for every PR. There is no excuse not to in 2026.

The professional posture is to apply at least two verification methods to every new concurrent structure: a model-checker for design and TSan for implementation. Anything less leaves bugs for future you to find.

### The Go Maxim

"Do not communicate by sharing memory; share memory by communicating."

This Go proverb is taught, repeated, and frequently misapplied. Let us audit it.

**When the maxim is right.** Coordinating goroutines on a pipeline. Building a worker pool. Passing immutable values between stages. Fan-out/fan-in. Cancellation via context. Anywhere the data has clear ownership and a natural lifecycle. In these cases channels are clearer than mutexes, easier to test, and easier to reason about.

**When the maxim is wrong.** Counters that are incremented by every goroutine and read by a metrics endpoint — channels add latency for no win, atomic.Int64 is correct. Caches that are read-heavy and read by many goroutines — sync.RWMutex or sync.Map outperforms a channel-fronted owner. Hot-path data structures in performance-critical code — channels involve allocation, scheduler interaction, and copy overhead. The author of the maxim, Rob Pike, has explicitly clarified in talks that it is a default, not a law.

**What to teach junior engineers.** Use channels for coordination, mutexes for protection. If you find yourself sending a pointer through a channel to mutate it, you are using channels as awkward mutexes; just use a mutex. If you find yourself locking and unlocking around a single field that is read in many places, you may want an atomic or a copy-on-write under a channel of subscribers.

The maxim is a heuristic, not a memory model. Memory model is what governs correctness. Heuristic is what governs style.

### History

A short tour. You should be able to discuss each of these in a code review without looking them up.

**Dijkstra, 1965, semaphores.** "Cooperating Sequential Processes" introduced the binary and counting semaphore as a primitive for mutual exclusion and signaling. The first principled answer to "how do threads coordinate."

**Hoare, 1974, monitors.** "Monitors: An Operating System Structuring Concept" introduced the monitor — a higher-level construct combining mutual exclusion with condition variables. Java synchronized blocks and wait/notify are a direct descendant.

**Lamport, 1974, bakery algorithm.** A mutual exclusion algorithm requiring no atomic primitives beyond single-word reads and writes. Demonstrated that mutual exclusion is achievable with shockingly little hardware support — and that getting the memory model wrong breaks it.

**Lamport, 1978, time/clocks.** "Time, Clocks, and the Ordering of Events in a Distributed System" defined happens-before, which is now the bedrock of every memory model in every mainstream language.

**Herlihy, 1991, wait-free hierarchy.** "Wait-Free Synchronization" proved that there is a hierarchy of synchronization primitives by consensus number: registers (1), test-and-set (2), CAS (infinity). This is why CAS is universal and registers alone are not.

**Herlihy and Wing, 1990, linearizability.** Defined linearizability as the correctness condition for concurrent objects. Every concurrent data structure paper since builds on this.

**JSR-133, 2004, Java Memory Model.** Doug Lea, Bill Pugh, and Sarita Adve led the rewrite of the Java memory model. First mainstream language to ship a precise, formal memory model.

**C++11 memory model, 2011.** Hans Boehm and SG1 ported the JSR-133 ideas to C++ with the explicit ordering vocabulary (relaxed/acquire/release/seq_cst).

**Go memory model, 2014 (informal) and 2022 (rewrite).** Russ Cox shipped Go with an informal memory model in 2014 and rewrote it in 2022 to be formal and to add explicit support for atomic types. Notable for being the most readable memory model document among the mainstream languages.

You do not need to have read all the original papers, but you should have read at least Herlihy and Wing, Lamport on happens-before, and the Go memory model. These three give you the vocabulary to discuss correctness with rigor.

### Hardware Trends

**Single-core frequency scaling died around 2005.** Since then, performance has come from parallelism, vectorization, and specialization. Every concurrency engineer is living in the world that fact created.

**NUMA is ubiquitous.** Even desktop CPUs are now multi-chiplet with non-uniform memory access. A lock that bounces between sockets pays a 5-10x penalty over a same-socket lock. NUMA-aware allocation, NUMA-aware thread placement, and NUMA-aware lock design (MCS, CLH, hierarchical locks) are professional concerns.

**Persistent memory and CXL.** Intel Optane is gone, but the broader CXL ecosystem is delivering memory pools that span sockets and racks at memory-like latencies. The concurrent algorithms of the next decade will need to think about durability ordering (PMEM had `pmem_flush` and `pmem_drain`) and remote memory access.

**Hybrid cores.** Apple Silicon, Intel hybrid, ARM big.LITTLE — your threads are running on heterogeneous cores. Lock-free designs that assumed uniform progress may behave badly when an efficiency core holds a spinlock contended by a performance core.

**Hardware transactional memory.** Intel TSX shipped, was repeatedly broken by Spectre-related side channels, and is now mostly disabled in production. ARM has TME on paper. HTM was supposed to make optimistic concurrency easy; the security pushback means software lock elision is still the path most teams take.

**SIMD-aware concurrency.** Wide SIMD changes the calculus of lock-free designs because a single core can do more work per instruction. The boundary between "throughput" and "latency" use cases is shifting.

The professional takeaway: do not design your concurrent libraries against the hardware of 2015. Profile on the hardware your customers actually run today, and read the architecture reference manuals for the chips you care about.

### Mentoring: Code-Review Heuristics

Your highest-leverage activity at this level is reviewing other people's concurrent code. Here are heuristics to apply.

**Smell test on diff size.** A PR that adds a new mutex is rarely a problem. A PR that adds a new atomic without a comment explaining the memory ordering is always a problem. A PR that adds a new lock-free structure deserves a meeting.

**Ask for the linearization point.** "Which line is the linearization point of this operation?" If the author cannot answer in one sentence, the design is not done.

**Audit ordering choices.** For each atomic, ask "why this ordering and not the next one weaker?" The acceptable answers are "I need this happens-before edge to make X visible to Y" or "I tried weaker and a model-checker found a bug." Anything else is unverified.

**Check the reclamation story.** "How is freed memory protected from use-after-free?" The answers — hazard pointers, epochs, RCU, leak — are all valid; "I assumed it would be fine" is not.

**Cache-line layout.** Look at the struct. Is there padding around the hot atomic? Are independent atomics on independent cache lines? Are read-mostly and write-mostly fields separated?

**Test coverage.** Are there TSan-clean tests? Is there a stress test? Has anyone run it on aarch64? Is there a model-checker harness, even a small one?

**Comparison to the alternative.** "What did you measure against?" A single-threaded baseline tells you nothing; a contended-mutex baseline tells you whether the complexity is justified.

When mentoring, your goal is not to catch every bug. It is to install these questions in the author's head so the next PR is better.

### Anti-Patterns at Scale

Patterns that look fine in a microbenchmark but ruin systems at scale.

**The single global mutex.** Often used to "be safe." Becomes the throughput bottleneck of the entire service. Replace with striping, RCU, or per-CPU partitioning before the team migrates from VM to bare metal and discovers the problem.

**The RWMutex on a write-heavy workload.** Readers think they are free, writers are starved. Measure read:write ratio before choosing RWMutex over Mutex.

**Lock-free for its own sake.** Adding a lock-free queue because "lock-free is faster" without measuring contention or considering complexity. Mutex-based designs win on uncontended workloads and on workloads with naturally low concurrency.

**Atomic flags as poor-man's barriers.** Using a chain of atomic bools to coordinate phases of computation. This is reinventing a barrier badly. Use a real barrier primitive (sync.WaitGroup, std::barrier, CyclicBarrier).

**Concurrency in the wrong layer.** Locking inside a deeply nested call chain when the natural granularity is at a request handler. Often fixes a symptom and creates a footgun.

**Shared mutable state for "caching."** A cache that everyone reads and writes becomes a contention magnet. Per-CPU caches with periodic merge usually beat a single shared cache by an order of magnitude.

**Reinventing the JUC/folly/abseil structure.** If your problem looks like ConcurrentHashMap, use the equivalent in your language. The chance that you will out-implement Doug Lea on a Tuesday afternoon is small.

---

## Real-World Analogies

| Analogy | Concurrency Concept |
|---------|---------------------|
| Newspaper printing press: writers prepare new edition, then everyone swaps to it at once | RCU grace period and pointer swap |
| Restaurant kitchen with stations and an expediter | Disruptor — sequenced single-writer, multi-reader pipeline |
| Library card catalog with sequence stamps | Seqlock — readers retry if a writer interleaves |
| Each cashier has their own till; manager totals at close | Per-CPU counters with periodic aggregation |
| Highway with lane discipline vs. one bridge bottleneck | Striped lock vs. single global mutex |
| Air traffic control: rules for who lands first | Lock ordering protocols to prevent deadlock |
| Mathematical proof reviewed by peers | Model-checking and code review of lock-free designs |
| Master and apprentice in a guild | Senior reviewing junior's first concurrent PR |
| Postal system with regional sorting facilities | Hierarchical locks for NUMA awareness |
| Coral reef ecosystem: many species, narrow niches | Many concurrency primitives, each fitting one pattern |

---

## Mental Models

**Concurrency primitives form a toolbox, not a hierarchy.** RCU is not "better than" a mutex; it is right for read-mostly, slow-write workloads. Spinlocks are not "worse than" mutexes; they are right for short critical sections with low contention. Your job is to know the toolbox.

**Every memory ordering choice is a contract.** Relaxed means "I do not need ordering, just atomicity." Acquire/release means "I am synchronizing a release with an acquire to publish state." Seq_cst means "I need a total order." Document the contract in the comment next to the atomic.

**Verification scales the engineer.** A senior engineer who reasons carefully will be right 95% of the time on a lock-free design. A professional engineer who reasons carefully and runs a model-checker will be right 99.5% of the time. The model-checker is the multiplier.

**History is design pressure.** Every primitive in your standard library has a reason it was added and a reason it has the shape it has. Reading the history makes you better at predicting which new primitives will catch on and which will fade.

**Latency, throughput, and complexity are a budget.** Lock-free buys you tail latency and throughput at the cost of complexity. Mutex buys you simplicity at the cost of contention. Channels buy you locality at the cost of throughput. Spend the budget deliberately.

---

## Code Examples

### Michael-Scott MPMC Queue from First Principles

A walked-through C++ implementation. Each ordering choice is justified inline.

```cpp
#include <atomic>
#include <optional>

// Node and queue use raw pointers; in production, wrap with hazard pointers or
// epoch-based reclamation for safe memory reclamation. Here we leak nodes to
// keep the example focused on the algorithm.

template <typename T>
class MSQueue {
  struct Node {
    std::atomic<Node*> next{nullptr};
    T value{};
    Node() = default;
    explicit Node(T v) : value(std::move(v)) {}
  };

  // head and tail must be on separate cache lines to avoid false sharing
  // between enqueuers and dequeuers.
  alignas(64) std::atomic<Node*> head_;
  alignas(64) std::atomic<Node*> tail_;

public:
  MSQueue() {
    Node* sentinel = new Node();
    head_.store(sentinel, std::memory_order_relaxed);
    tail_.store(sentinel, std::memory_order_relaxed);
  }

  void enqueue(T value) {
    Node* node = new Node(std::move(value));
    // node->next is already nullptr from construction; no store needed.

    while (true) {
      // Acquire on tail: we want to observe the most recent tail node and its
      // next pointer publication.
      Node* tail = tail_.load(std::memory_order_acquire);
      Node* next = tail->next.load(std::memory_order_acquire);

      if (tail != tail_.load(std::memory_order_acquire)) continue; // re-check

      if (next == nullptr) {
        // Try to attach node after tail. Release on success publishes the
        // node's contents to any subsequent acquire of next.
        if (tail->next.compare_exchange_weak(
                next, node,
                std::memory_order_release,
                std::memory_order_relaxed)) {
          // Help advance tail. Failure is fine; some other thread will.
          tail_.compare_exchange_strong(
              tail, node,
              std::memory_order_release,
              std::memory_order_relaxed);
          return;
        }
      } else {
        // tail was stale, help advance it.
        tail_.compare_exchange_strong(
            tail, next,
            std::memory_order_release,
            std::memory_order_relaxed);
      }
    }
  }

  std::optional<T> dequeue() {
    while (true) {
      Node* head = head_.load(std::memory_order_acquire);
      Node* tail = tail_.load(std::memory_order_acquire);
      Node* next = head->next.load(std::memory_order_acquire);

      if (head != head_.load(std::memory_order_acquire)) continue;

      if (head == tail) {
        if (next == nullptr) return std::nullopt; // empty
        // Tail is lagging; help advance.
        tail_.compare_exchange_strong(
            tail, next,
            std::memory_order_release,
            std::memory_order_relaxed);
      } else {
        // Read value before CAS; once the CAS succeeds another thread could
        // free next.
        T value = next->value;
        if (head_.compare_exchange_strong(
                head, next,
                std::memory_order_release,
                std::memory_order_relaxed)) {
          // head is now reclaimable under your chosen scheme.
          return value;
        }
      }
    }
  }
};
```

Notes for review: the choice of acquire for loads and release for the publishing CAS gives the minimum ordering to make the enqueued value visible to a successful dequeuer; an alternative seq_cst version is simpler to reason about but pays a fence on every operation.

### TLA+ Excerpt of Peterson's Algorithm

A complete TLA+ specification of two-thread Peterson with a safety invariant.

```
---------------------------- MODULE Peterson ----------------------------
EXTENDS Naturals
VARIABLES flag, turn, pc
vars == <<flag, turn, pc>>

ProcSet == {0, 1}

Init == /\ flag = [i \in ProcSet |-> FALSE]
        /\ turn = 0
        /\ pc = [i \in ProcSet |-> "L1"]

L1(i) == /\ pc[i] = "L1"
         /\ flag' = [flag EXCEPT ![i] = TRUE]
         /\ pc' = [pc EXCEPT ![i] = "L2"]
         /\ UNCHANGED turn

L2(i) == /\ pc[i] = "L2"
         /\ turn' = 1 - i
         /\ pc' = [pc EXCEPT ![i] = "L3"]
         /\ UNCHANGED flag

L3(i) == /\ pc[i] = "L3"
         /\ (flag[1-i] = FALSE \/ turn = i)
         /\ pc' = [pc EXCEPT ![i] = "CS"]
         /\ UNCHANGED <<flag, turn>>

CS(i) == /\ pc[i] = "CS"
         /\ pc' = [pc EXCEPT ![i] = "L4"]
         /\ UNCHANGED <<flag, turn>>

L4(i) == /\ pc[i] = "L4"
         /\ flag' = [flag EXCEPT ![i] = FALSE]
         /\ pc' = [pc EXCEPT ![i] = "L1"]
         /\ UNCHANGED turn

Next == \E i \in ProcSet : L1(i) \/ L2(i) \/ L3(i) \/ CS(i) \/ L4(i)

Spec == Init /\ [][Next]_vars

MutualExclusion ==
  ~(pc[0] = "CS" /\ pc[1] = "CS")
=========================================================================
```

Run this through TLC and `MutualExclusion` is checked across all interleavings. Switch a step from atomic-write to memory-model-realistic and watch it fail — this is how you teach a junior why memory models matter.

### RCU Mini-Tutorial

A toy user-space RCU sketched in C, showing the reader and writer flows.

```c
// Reader: no locks, no atomics on the hot path (preempt-disable suffices).
void reader(void) {
    rcu_read_lock();                       // mark this thread as in a read section
    struct config *c = rcu_dereference(global_config);
    use(c->field);                          // safe: c will not be freed until grace period
    rcu_read_unlock();                     // mark this thread as out
}

// Writer: copy, modify, swap atomically, then wait for readers to drain.
void writer(struct config *new_cfg) {
    struct config *old = global_config;
    rcu_assign_pointer(global_config, new_cfg);  // publish
    synchronize_rcu();                            // wait for all readers to exit
    free(old);                                    // now safe to reclaim
}
```

The reader cost is essentially zero; the writer cost is the grace period (often milliseconds). Use RCU when your read-to-write ratio is at least 100:1 and your readers should not block writers.

### NUMA-Aware Mutex (MCS-Hierarchical Sketch)

A Java sketch of a hierarchical lock that batches contention within a NUMA node before crossing the interconnect.

```java
public final class HierarchicalLock {
    private final ThreadLocal<Integer> nodeId = ThreadLocal.withInitial(NumaUtil::currentNode);
    private final AtomicReferenceArray<MCSNode> localTails;
    private final AtomicReference<MCSNode> globalTail = new AtomicReference<>();

    public HierarchicalLock(int numNodes) {
        this.localTails = new AtomicReferenceArray<>(numNodes);
    }

    public void lock(MCSNode me) {
        int node = nodeId.get();
        MCSNode predLocal = localTails.getAndSet(node, me);
        if (predLocal != null) {
            me.localWaiting = true;
            predLocal.localNext = me;
            while (me.localWaiting) Thread.onSpinWait();
        }
        // Now we are the local leader; contend for the global lock.
        MCSNode predGlobal = globalTail.getAndSet(me);
        if (predGlobal != null) {
            me.globalWaiting = true;
            predGlobal.globalNext = me;
            while (me.globalWaiting) Thread.onSpinWait();
        }
    }

    // unlock omitted; in practice this design hands off the global lock
    // to a queued local successor first to keep ownership on-node.
}
```

The shape — local queue per NUMA node, leader of each local queue contends for a global queue — is the same shape as the Linux kernel's qspinlock variants and the cohort locks in research literature. The win is throughput under cross-socket contention; the cost is implementation complexity and latency under low contention.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Maximum throughput on hot paths | Highest design complexity |
| Predictable tail latency when done right | Memory model details bite weakly trained teams |
| Composes with every language's runtime | Hard to test exhaustively without model-checkers |
| Aligns with hardware reality (shared caches, atomics) | Maintenance cost when original designer leaves |
| Enables zero-copy designs | Easy to footgun yourself with ABA, ordering bugs |
| Rich body of literature and patterns | History matters; ignorance of it repeats old bugs |
| Sanitizer ecosystem is mature | Hardware trends keep changing the right answer |

---

## Use Cases

- Designing the concurrent primitives layer of a language runtime or database.
- Building or maintaining a high-throughput message broker (Kafka, NATS, internal equivalents).
- Implementing storage engines, in-memory KV stores, and caches at scale.
- Designing schedulers, work-stealing runtimes, and async executors.
- Kernel and hypervisor concurrency engineering.
- Trading systems with sub-microsecond latency budgets.
- Operating-system level garbage collectors with concurrent marking.

---

## Coding Patterns

- Recipe: prove correctness, write algorithm, choose orderings, test, benchmark — in order.
- Layered libraries: low-level primitives for library authors, higher-level structures for application authors.
- RCU and seqlocks for read-mostly state; per-CPU counters for write-mostly statistics.
- Hierarchical locks for NUMA scaling.
- Hazard pointers or epoch-based reclamation as the default memory reclamation strategy for lock-free structures.
- Two-phase commit at the abstraction boundary: actor-like message passing at the API surface, lock-free engine inside.
- Model-checker harnesses checked into the repo next to the structure.
- TSan-clean as a CI gate.
- Cache-line padding around hot atomics, documented with `alignas(64)` or equivalent.
- Lock ordering documented in code, validated at runtime in debug builds.

---

## Clean Code

- Every atomic operation has a comment explaining the ordering choice.
- Linearization points are marked with comments referring to the proof.
- Concurrent data structures live in a dedicated module with their own README and test directory.
- Public APIs hide concurrency details; users see `enqueue(value)`, not `compare_exchange_weak`.
- Reclamation strategy is documented at the top of each lock-free structure.
- Benchmarks live next to the structure and are run in CI.
- Sanitizer suppressions are rare and individually justified.
- Wrapping unsafe primitives in safe abstractions; raw atomics never leak past the module boundary.

---

## Best Practices

- Reach for the highest-level primitive that meets the requirement.
- Default to seq_cst and weaken with evidence (model-checker, benchmark).
- Treat the memory model as a contract; document the contract you depend on.
- Verify with two methods: a model-checker for design, a sanitizer for code.
- Benchmark on the hardware your customers actually run.
- Padded cache lines for hot atomics; measure to confirm.
- Lock ordering written down once, enforced everywhere.
- Hazard pointers / epochs / RCU before raw delete in lock-free code.
- Mentor by asking "where is the linearization point?" until it becomes reflex.
- Pair every new concurrent structure with a written design doc; revisit it in a year.

---

## Edge Cases & Pitfalls

- ABA without versioning: a pointer reused at the same address fools a CAS.
- Spurious wakeups: condition-variable waits must always loop on the predicate.
- Memory-order downgrades that pass tests on x86 and break on aarch64.
- Reclamation deferred too long: lock-free structures consuming gigabytes of "drained" memory.
- Priority inversion: high-priority thread waits on a lock held by a low-priority thread.
- Convoying: threads queue behind a slow lock holder, never recovering.
- Lost wakeups when a notify happens before the wait registers.
- Asymmetric synchronization (Sleeping Beauty problem) in readers/writers patterns.
- Cache-line ping-pong from "innocent" adjacent fields.
- Mixed atomic and non-atomic access to the same location — UB in C++.

---

## Common Mistakes

- Treating memory ordering as a performance knob rather than a correctness contract.
- Skipping the linearization-point analysis.
- Assuming GC saves you from reclamation bugs; it does not save you from races.
- Designing a structure for the benchmark and not the workload.
- Reinventing primitives the standard library already provides.
- Locking-as-policy instead of locking-as-mechanism; embedding business rules in lock acquisition order.
- Ignoring the cost of cross-NUMA traffic until production tells you about it.
- Believing the Go maxim is a memory model.
- Skipping TSan because "we have unit tests."
- Not writing down the design before writing code.

---

## Tricky Points

- The Java MM and C++ MM agree on the basics but differ in detail (out-of-thin-air, consume semantics).
- Go's memory model only formally covers atomic operations as of 2022; older code may have been correct by accident.
- RCU's grace period is not free in user space; user-space RCU has notably different cost characteristics.
- Hazard pointers are simple in theory and intricate in implementation (per-thread arrays, scanning, retired lists).
- Sequence locks have subtle issues with torn reads of multi-word data on 32-bit platforms.
- Hierarchical locks improve throughput but can increase tail latency under low contention.
- Lock-free does not imply wait-free; livelock under high contention is real.
- Hardware transactional memory's security history makes it effectively unavailable in 2026.

---

## Test Yourself

1. Walk a colleague through the linearization points of the Michael-Scott queue.
2. Explain why the Disruptor outperforms a "pure" lock-free queue in the LMAX use case.
3. Write a TLA+ spec for a counter incremented by N threads and check that it always reaches N.
4. Implement a hazard-pointer based reclamation scheme for the MS queue.
5. Compare a `sync.RWMutex`-backed cache to an RCU-backed cache for a 1000:1 read:write workload — predict and measure.
6. Find a concurrency anti-pattern in your codebase and write the PR to fix it.
7. Mentor a junior through their first lock-free PR using the five-step recipe.
8. Read JSR-133 and write a one-page summary of how it differs from the Go memory model.
9. Write a stress test reproducing an ABA bug, then fix it with tagged pointers.
10. Design a NUMA-aware queue for a 4-socket server and benchmark it.

---

## Tricky Questions

**Q1: When is a lock-free design the wrong choice even though it is faster in microbenchmarks?**
A: When the workload is uncontended (a mutex is simpler and equally fast), when correctness is hard to prove (complexity outweighs gain), when the team cannot maintain it after the original author leaves, when reclamation pressure outweighs the lock-acquisition cost, or when the latency budget is dominated by something else (network, disk, GC) so the gain is invisible at the system level.

**Q2: Why does Doug Lea matter to a Go programmer who will never write Java?**
A: Because the design language of modern concurrency libraries — primitives, memory models, queues, executors — was largely shaped by Doug Lea's twenty-year iteration on JUC. The vocabulary you use in Go (acquire/release, lock-free, happens-before) was made precise in Java first, and Go's primitives are shaped by the lessons learned there.

**Q3: When is "share memory by communicating" actively misleading?**
A: When the data is shared, frequently accessed, and naturally lives in a flat structure (counters, caches, ring buffers). Channels add allocation, scheduler interaction, and ordering constraints that obscure rather than reveal. The maxim is for coordination patterns, not memory layout decisions.

**Q4: How do you decide between RCU, seqlocks, and per-CPU counters for read-mostly state?**
A: RCU when readers traverse pointer structures and writers replace whole subgraphs. Seqlocks when readers see a single struct that can be torn during a write. Per-CPU counters when writers also exist on every CPU and the read-side cost of aggregation is acceptable.

**Q5: Why does Linus dislike most non-RCU lock-free designs in the kernel?**
A: Because they tend to have subtle reclamation bugs, ABA hazards, and weak portability across architectures. RCU has been audited, integrated, and tooling-supported for decades. The cost of a new lock-free structure that "might be slightly faster" is rarely worth the maintenance burden — Linus has written about this on LKML in detail.

**Q6: What does Herlihy's wait-free hierarchy mean for which primitives you ask hardware vendors for?**
A: It means CAS is universal — anything that can be done lock-free can be done with CAS. It means weaker primitives (TAS, fetch-and-add) suffice for limited patterns. Vendors keep adding CAS variants (DCAS, transactional memory) because the hierarchy tells them where the boundaries are.

**Q7: Why is verification (TLA+, loom) not enough on its own?**
A: Because verification proves the design correct under an abstract memory model and finite state space. The implementation may diverge (compiler optimizations, wrong ordering choices), and the verified state space may not cover real workloads. Verification raises the floor; sanitizers, stress tests, and benchmarks raise the ceiling.

**Q8: How should you stage migration from a shared-memory engine to an actor-style one?**
A: Carve out a request-oriented boundary. Make the actor message the unit of work. Keep the hot inner loop shared-memory and contained inside one actor. Migrate stateful operations off the shared store one at a time, with a feature flag and a reverse-traffic plan. Never do it all at once; the cost of being wrong is too high.

**Q9: How do you mentor a junior who insists on writing lock-free code?**
A: Ask them to show you the linearization point. Ask them to model-check it in loom or TLA+. Ask them to compare against the obvious mutex baseline on real hardware. If they can answer all three, encourage them. If not, redirect them to a mutex and a smaller scope, and offer to pair on the lock-free version after they read one chapter of Herlihy & Shavit.

**Q10: What is the biggest risk in maintaining a 10-year-old concurrent library?**
A: Hardware drift. The library was tuned for the hardware of its era; new hardware (NUMA topology changes, hybrid cores, wider SIMD, CXL) may have shifted the cost curves enough that the design is no longer optimal. Audit your concurrent libraries' assumptions every few years against current hardware reality.

---

## Cheat Sheet

```
+--------------------------------------------------------------+
|             SHARED MEMORY — PROFESSIONAL CHEAT SHEET         |
+--------------------------------------------------------------+
|  DESIGN RECIPE                                               |
|    1. Correctness proof on paper (linearization points)      |
|    2. Algorithm pseudocode reviewed by 3 colleagues          |
|    3. Memory ordering, weakest that preserves proof          |
|    4. Tests: TSan + stress on aarch64 + model-checker        |
|    5. Benchmark vs mutex baseline at 3 contention levels     |
+--------------------------------------------------------------+
|  KERNEL TOOLKIT                                              |
|    RCU         — read-mostly, writer waits grace period      |
|    seqlock     — read-heavy, retry on writer interleave      |
|    per-CPU var — local writes, aggregate on read             |
+--------------------------------------------------------------+
|  ORDERING CONTRACT                                           |
|    relaxed     — atomicity only                              |
|    acquire     — pair with release to import state           |
|    release     — pair with acquire to publish state          |
|    acq_rel     — read-modify-write that does both            |
|    seq_cst     — total order, default unless justified       |
+--------------------------------------------------------------+
|  VERIFICATION                                                |
|    TLA+ / Spin — design-level model checking                 |
|    loom        — Rust unit-test interleaving exploration     |
|    TSan        — runtime data race detection                 |
|    rr          — record/replay deterministic debugging       |
+--------------------------------------------------------------+
|  MENTOR QUESTIONS                                            |
|    "Where is the linearization point?"                       |
|    "Why this memory order and not weaker?"                   |
|    "How is reclamation handled?"                             |
|    "What did you benchmark against?"                         |
+--------------------------------------------------------------+
|  HISTORY MILESTONES                                          |
|    1965 Dijkstra semaphores                                  |
|    1974 Hoare monitors / Lamport bakery                      |
|    1991 Herlihy wait-free hierarchy                          |
|    2004 JSR-133 JMM                                          |
|    2011 C++11 memory model                                   |
|    2022 Go memory model rewrite                              |
+--------------------------------------------------------------+
```

---

## Summary

At the professional tier, shared-memory concurrency is a discipline you steward. You design new primitives only when the existing toolbox does not fit. You apply a five-step recipe — proof, algorithm, ordering, test, benchmark — to every PR. You wield verification methods like a builder wields a level: they make crooked work visible. You teach by asking three questions on every concurrent PR: where is the linearization point, why this ordering, and how is memory reclaimed. You know the history because the literature is the institutional memory of the field. You know the hardware because the right design changes with the chip. And you know when to leave shared memory altogether, because the most powerful move at scale is sometimes to retreat to actors at the boundary and keep the shared-memory engine small and well-understood.

The professional engineer's superpower is not writing the fastest lock-free queue. It is making sure the next person who writes a lock-free queue at your organization writes it correctly, tests it rigorously, and chooses it only when nothing simpler will do.

---

## What You Can Build

- A team-wide concurrency standard with a recipe, code-review checklist, and required verification gates.
- A high-throughput in-memory broker rivaling Disruptor or LMAX-class systems.
- A NUMA-aware storage engine with hierarchical locks and per-node caches.
- A custom user-space RCU library tailored to your runtime.
- A model-checker harness pattern that ships with every concurrent structure in your codebase.
- A mentorship program that produces engineers capable of designing and shipping safe concurrent libraries.
- A migration playbook taking a shared-memory monolith into an actor-fronted hybrid.
- A talk or paper documenting hard-won lessons from a production lock-free system.

---

## Further Reading

- Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming* — the textbook of the field.
- Doug Lea, *Concurrent Programming in Java* and the JSR-133 papers.
- Russ Cox, blog posts on the Go memory model (especially the 2022 rewrite series).
- Linus Torvalds on RCU, lock-free, and memory ordering — selected LKML threads.
- Pawel Wieczorek, blog series on lock-free data structures and reclamation.
- Maged Michael, *Hazard Pointers* paper.
- Adam Morrison and Yehuda Afek, *Fast Concurrent Queues for x86 Processors* (LCRQ).
- Martin Thompson, *Mechanical Sympathy* blog and Disruptor papers.
- Hans Boehm, *Threads Cannot be Implemented as a Library* and C++ memory model work.
- Paul McKenney, *Is Parallel Programming Hard, And, If So, What Can You Do About It?* — free PDF, kernel-perspective.
- Leslie Lamport, *Specifying Systems* — TLA+ reference.
- The Linux kernel `Documentation/RCU/` and `Documentation/atomic_t.txt`.

---

## Related Topics

- [Memory Models (Go, C++, Java)](../../02-memory-models/README.md)
- [Lock-Free Data Structures](../../03-lock-free/README.md)
- [Actor Model](../02-actors/README.md)
- [CSP and Channels](../03-csp/README.md)
- [Go Runtime Internals](../../../languages/golang/15-go-source-reading/03-runtime-source/README.md)
- [Linux Kernel Concurrency](../../../../Operating-Systems/kernel-concurrency/README.md)
- [Formal Methods and TLA+](../../../../Computer-Science/formal-methods/README.md)
- [Hardware Architecture and NUMA](../../../../Computer-Science/computer-architecture/README.md)

---

## Diagrams & Visual Aids

```
DESIGN RECIPE FLOW
==================

  +------------+     +------------+     +------------+
  |  Proof     | --> | Algorithm  | --> |  Ordering  |
  |  on paper  |     | pseudocode |     | annotations|
  +------------+     +------------+     +------------+
                                              |
                                              v
                       +------------+     +------------+
                       | Benchmark  | <-- |   Tests    |
                       | vs mutex   |     | TSan+model |
                       +------------+     +------------+
                              |
                              v
                       +------------+
                       |  Ship or   |
                       |  redesign  |
                       +------------+


RCU TIMELINE
============

Time -->

Writer:   ----[allocate new]--[swap ptr]----[wait grace]----[free old]----
                                  ^                |
                                  |                |
Reader A: --[lock][read old]------|----[unlock]----+
                                  |
Reader B: --[lock][read new]------|------------[unlock]
                                  |
Reader C:                         [lock][read new][unlock]


HIERARCHY OF LOCK DESIGNS BY CONTENTION
=======================================

       Low contention                          High contention
       <------------------------------------------------------>
  Mutex --- RWMutex --- Striped --- MCS --- Hierarchical --- RCU/seqlock
  simple    read-heavy    bucket    NUMA-fair    NUMA-batched    no-block reads


VERIFICATION COVERAGE
=====================

                         |--- TLA+/Spin (design level) ---|
                         |
                                |--- loom (impl, bounded) ---|
                                |
                                       |--- TSan (runtime races) ---|
                                       |
                                              |--- stress (real workload) ---|

   abstract  <----------------------------------------------------------> concrete
```
