# Mutex — Professional Level

> **Topic:** [Mutex](README.md)
> **Focus:** designing locking subsystems, history, mentorship

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

At the professional level a mutex is no longer a primitive you reach for; it is one of many tools in a much larger toolbox, and your job is to decide when it belongs in a design and when it does not. You are expected to architect locking subsystems, write lock hierarchies that serve as living documentation, run code reviews where bad locking patterns are caught long before production, and mentor junior engineers in spotting deadlocks by reading code rather than waiting for a heisenbug to bite. You are also expected to understand the history of synchronization — Dijkstra, Hoare, Mesa, Lampson — because today's pthread mutex and Go sync.Mutex are sediments of decades of design decisions, some of which constrain what you can express today.

This level is about taste and judgment. The senior level taught you the techniques: lock ordering, fairness, hand-over-hand locking, the difference between blocking and spinning. The professional level asks you to use those techniques in service of a coherent architecture. The Linux kernel does not use a single "mutex" — it has spinlock_t, raw_spinlock_t, rwlock_t, mutex, rwsem, semaphore, completion, and several specialized RCU primitives, each with carefully documented use cases and lifetimes. That granularity exists because at scale, picking the right tool is the difference between a system that holds together and one that melts under load.

We will look at famous failures — Therac-25, Mars Pathfinder, the Linux kernel's BKL (Big Kernel Lock) saga — because the lessons embedded in those stories are not "use locks correctly" but rather "design so that locking is rarely needed in the first place." We will look at modern alternatives that change the trade-offs entirely: Rust's Send/Sync, which moves data-race detection to compile time; Go's race detector, which makes runtime detection cheap enough to ship in tests; lock-free data structures that sidestep the problem at the cost of harder reasoning.

The tone of this document is deliberately argumentative. There is no single correct answer to "should I use a mutex here?" — but there are wrong answers, and a professional engineer should be able to defend their choice in a design review, explain it to a junior teammate, and revisit it three years later when the system has grown ten times larger and the original assumptions no longer hold.

---

## Prerequisites

Before continuing, you should be comfortable with everything covered in junior, middle, and senior levels of this topic. In particular:

- You can implement a correct lock-ordering protocol and explain why it prevents deadlock.
- You understand cache coherence (MESI), false sharing, and the cost of a contended cache line.
- You know the difference between a spinlock, an adaptive mutex, and a blocking mutex, and you can explain when each is appropriate.
- You have used at least one profiling tool to identify contention (perf, pprof, Instruments, VTune, or similar).
- You can write a correct condition-variable wait loop and explain spurious wake-ups.
- You have written or reviewed code that uses memory ordering primitives (acquire, release, sequentially consistent).
- You have read at least one chapter of "The Art of Multiprocessor Programming" by Herlihy and Shavit, or equivalent material.

If any of these feel shaky, revisit the senior-level document before continuing. The professional level assumes that the mechanics are second nature and the focus is on judgment.

---

## Glossary

- **Lock subsystem.** The collection of locks, lock-ordering rules, and conventions that govern concurrent access in a module, library, or service. It is a *subsystem* in the same sense as a memory allocator or scheduler — designed deliberately, not assembled incidentally.
- **Lock hierarchy.** A partial order over locks such that any thread acquiring multiple locks does so in a globally agreed sequence. Often expressed as a directed acyclic graph in documentation.
- **God-mutex.** A single coarse-grained mutex that guards a large amount of state, often the entire data structure of a service. The name evokes the "god object" anti-pattern.
- **Sharded locking.** Partitioning state into shards (often by hash) so that each shard has its own lock. Reduces contention by spreading load across multiple locks.
- **Hand-over-hand locking** (also: lock coupling, crabbing). A pattern for traversing a linked structure where you hold the lock on the current node, acquire the lock on the next node, then release the current lock. Used in B-trees and linked lists.
- **Mesa-style condition variable.** The condvar style used by virtually all modern systems (Java, Go, POSIX). After `wait()` returns, the woken thread must re-check the predicate because another thread may have run between the signal and the wake.
- **Hoare-style condition variable.** A theoretical model where signalling immediately transfers control to the waiter with the invariant intact. Elegant but impractical to implement efficiently.
- **Priority inversion.** When a high-priority thread is blocked waiting for a lock held by a low-priority thread that is preempted by a medium-priority thread. The classic Mars Pathfinder bug.
- **Priority inheritance.** A mitigation for priority inversion: the lock holder temporarily inherits the priority of the highest-priority waiter.
- **Send / Sync.** Rust's marker traits. `Send` means a value can be transferred to another thread; `Sync` means a reference can be shared across threads. The compiler enforces these and rejects data races at compile time.
- **RCU (Read-Copy-Update).** A synchronization technique used heavily in the Linux kernel where readers proceed without locks and writers publish new versions atomically. Used for read-mostly data.
- **Lock-free / wait-free.** A data structure is lock-free if some thread always makes progress; wait-free if every thread makes progress in a bounded number of steps. Lock-free is not the absence of synchronization — it is the absence of mutual exclusion locks.
- **Big Kernel Lock (BKL).** A single global lock in early Linux that was gradually removed over more than a decade. The canonical case study in scaling lock granularity.

---

## Core Concepts

### Designing a locking subsystem for a library or service

When you sit down to design concurrency for a new module, resist the temptation to start by sprinkling `sync.Mutex` over fields. Instead, work top-down through four questions.

First, **what is shared?** If state is per-request, per-connection, or per-goroutine, it does not need synchronization at all. The cheapest lock is the one you never take. Identify the truly shared state — caches, registries, counters, configuration — and isolate it in well-defined modules.

Second, **what are the access patterns?** Is the data read-mostly (98% reads), write-mostly, or balanced? Read-mostly state benefits from RWMutex, RCU, or copy-on-write. Write-mostly state often benefits from sharding or message-passing. Balanced workloads are the hardest and usually demand careful benchmarking.

Third, **what are the latency requirements?** A web service with 50ms p99 can tolerate occasional lock contention. A trading system with 50us p99 cannot. Latency requirements push you toward lock-free structures, per-CPU data, or RCU.

Fourth, **what is the failure model?** If a thread crashes while holding a lock, what happens? In a single process, the answer is usually "the whole process dies"; in a robust mutex setting (PTHREAD_MUTEX_ROBUST), the lock becomes recoverable. In distributed systems, locks need lease semantics so that crashed lock holders eventually release their locks.

The output of this design is a written document — sometimes called a "locking policy" — that lists every lock in the subsystem, its scope, what it protects, and where it sits in the lock order. The Linux kernel has hundreds of such documents scattered through `Documentation/locking/`. They are not bureaucratic overhead; they are how the system stays comprehensible as it grows.

### Lock hierarchy diagrams as documentation

A lock hierarchy is a directed acyclic graph: each node is a lock, each edge says "if you hold the source, you may acquire the destination." Drawing this graph turns an implicit convention into explicit documentation.

A simple hierarchy for a key-value store with sharded buckets, a global metadata lock, and a per-entry lock looks like this:

```
metadata_lock
     |
     v
bucket_lock[N]   (any N, but only one at a time)
     |
     v
entry_lock
```

The rules:
- A thread may acquire `metadata_lock` then `bucket_lock` then `entry_lock`.
- A thread may acquire `bucket_lock` then `entry_lock` without `metadata_lock`.
- A thread may **not** acquire `entry_lock` then `bucket_lock` — that violates the order.
- A thread may **not** acquire two `bucket_lock` instances simultaneously unless an explicit cross-bucket protocol is defined.

When this graph is published in the repository (often as a Markdown file in `docs/locking.md` or as ASCII art at the top of the source file), three good things happen. New contributors learn the model in one read. Code reviewers can mechanically check that a patch obeys the order. Static analyzers can be configured to enforce the order automatically.

When the graph cannot be drawn as a DAG — when there is a cycle — that is your design telling you to either merge the cyclic locks into one, or introduce a try-lock-and-retry pattern, or rethink the partitioning. Cycles in the lock graph are deadlocks waiting to happen.

### Code-review heuristics for locking code

A good code reviewer can spot most locking bugs without running the code. Train yourself to look for these patterns:

1. **Lock taken in one place, released in another that may be skipped on an error path.** Always prefer RAII / defer / try-finally.
2. **Lock held across an I/O call** — disk read, network call, channel send. This is the single most common cause of pathological tail latency in services.
3. **Lock held across a callback** into user code. The callback might re-enter the same lock, sleep, or take other locks.
4. **A new lock added without updating the lock-order documentation.** This is usually how lock cycles creep in.
5. **A `time.Sleep` or arbitrary timeout inside a critical section** ("we'll wait a bit for the resource to be ready"). This is almost always wrong; use a condition variable.
6. **Atomic operations and mutex-guarded reads of the same variable.** Pick one. Mixing them creates subtle races.
7. **A mutex field declared but only sometimes acquired** before reading the protected field. The reviewer should ask: "what makes this read safe?"
8. **Recursive calls under a lock that is not recursive.** Self-deadlock.
9. **A getter that returns a pointer to lock-protected state.** The caller might dereference after the lock is released.
10. **Lock ordering that depends on runtime values.** "Lock the smaller-id account first" is correct but easy to get wrong; flag for extra scrutiny.

Codify these into a review checklist. Pair them with linters where available (Go's `go vet` catches copylocks; Rust's borrow checker catches most data races; Clang Thread Safety Analysis can be used in C++ with annotations).

### When to use a mutex vs channel vs atomic vs lock-free DS

This is a decision you make many times per design. A rough decision tree:

- **Are you protecting a single primitive (int, pointer, bool)?** Use an atomic. `sync/atomic` in Go, `std::atomic` in C++, `AtomicLong` in Java.
- **Are you signalling between a small number of producers and consumers?** Use a channel or queue. The signalling intent is more important than the data structure.
- **Are you protecting a complex aggregate (map, list, custom struct)?** Use a mutex, unless profiling shows it is the bottleneck.
- **Is the workload read-mostly with rare writes?** Consider RWMutex, copy-on-write, or RCU.
- **Have you measured contention as the bottleneck?** Consider sharding, then lock-free structures, then per-CPU data.

The hierarchy is, roughly: do nothing (if possible) → atomic → mutex → channel → RWMutex → sharded mutex → lock-free → per-CPU. Move down only when measurement justifies it. Premature lock-freedom is a great way to ship a subtle bug that surfaces three years later under load you never tested.

### Migration story: shared-memory → MPSC channels → sharded service

A useful concrete narrative: imagine a metrics aggregator that starts as a simple in-process counter map guarded by a mutex.

Phase 1: **single mutex, in-process.** Every increment takes the global lock, updates a map, releases. Works fine at 10k events/second. Falls apart at 1M events/second because every CPU is fighting for the same cache line.

Phase 2: **MPSC channels, single aggregator goroutine.** Producers send increments into a buffered channel. A single consumer goroutine drains the channel and updates the map without any lock at all — it owns the data. Now there is no contention on the map, only on the channel head. Scales to ~10M events/second on modern hardware. The trade-off: channel send/receive has its own cost, and the aggregator becomes a single-threaded bottleneck.

Phase 3: **sharded service, per-shard aggregator.** Partition the metric keys by hash across N shards, one MPSC channel and aggregator goroutine per shard. Producers route by hash. Now contention is divided by N, and there is no global bottleneck. The trade-off: cross-shard queries become harder, and rebalancing during shard reconfiguration needs care.

This three-phase migration is one of the most common architecture stories in concurrent systems. Each phase trades simplicity for throughput, and a professional engineer should be able to recognize when the current phase is no longer adequate.

### Linux kernel mutex flavors

The Linux kernel exposes a graded set of synchronization primitives, each with documented semantics. Understanding why there are so many tells you a lot about real-world locking trade-offs.

- **`spinlock_t`.** Busy-waits. Disables preemption. Cannot sleep while held. Used in interrupt context and very short critical sections.
- **`raw_spinlock_t`.** Like `spinlock_t` but does not get the PREEMPT_RT treatment. Used in code that absolutely must remain spinlocks even on real-time kernels.
- **`rwlock_t`.** Reader-writer spinlock. Multiple readers, one writer. Same constraints as spinlock_t.
- **`mutex`.** Sleeping lock. Optimized with optimistic spinning for the common short-hold case. Cannot be used in interrupt context. The default choice for new kernel code.
- **`rwsem` (read-write semaphore).** Sleeping reader-writer lock. Used heavily in the memory management code (mmap_sem, now mmap_lock).
- **`semaphore`.** Counting semaphore. Mostly legacy; new code uses mutexes or completions.
- **`completion`.** A one-shot signalling primitive: one side waits, the other signals "done." Used heavily for "wait for this background task to finish."
- **RCU primitives.** `rcu_read_lock`, `synchronize_rcu`, `call_rcu`. Lockless reads, deferred reclamation. Used everywhere in the kernel for read-mostly structures.

The lesson for application engineers: even when your language gives you one or two locking primitives, the underlying problem space justifies many more. When you find yourself wishing for a semaphore that wakes the highest-priority waiter, or a mutex that defers reclamation, you are rediscovering distinctions the Linux kernel made decades ago.

### History — Dijkstra, Hoare, Mesa

Dijkstra introduced the semaphore in 1965 as part of his work on the THE multiprogramming system. The semaphore was the first synchronization primitive that could be implemented portably above the hardware: `P` and `V` operations (Dutch *prolaag* and *verhoog*) atomically decremented and incremented a counter, blocking if the counter went negative. Every modern mutex is a binary semaphore at heart.

Tony Hoare proposed monitors in 1974 as a higher-level abstraction. A monitor was an object with implicit mutual exclusion: only one thread could be inside the monitor at a time, and condition variables let threads wait inside. Hoare's original semantics were elegant: when a thread signalled a condition variable, control was immediately transferred to a waiting thread, with the monitor invariant intact. This made reasoning straightforward but was hard to implement efficiently.

In 1980 Mesa, the language developed at Xerox PARC, introduced what we now call Mesa-style condition variables. Instead of transferring control to the waiter, signal merely *marked* the waiter as ready; the waiter resumed execution sometime later, after re-acquiring the monitor lock. Crucially, by the time the waiter ran, the predicate it was waiting for might no longer hold — so waiters had to re-check the predicate in a loop. This is why every condition-variable wait in modern code looks like `while (!predicate) cond.wait();`.

Every modern language (Java's `synchronized`/`wait`, Go's `sync.Cond`, POSIX `pthread_cond_t`, C++ `std::condition_variable`) uses Mesa-style semantics. The `while` loop is not a stylistic preference; it is a direct consequence of a 1980 design decision.

### Famous bugs

**Therac-25 (1985-1987).** A radiation therapy machine that killed at least three patients. The root cause was a race condition between the operator interface and the hardware control software. When operators edited treatment parameters quickly, an intermediate state could leave the machine in high-energy mode without the beam spreader in place. The machine had been built without proper synchronization primitives, relying on the rough timing of human input. The lesson: software that controls physical systems must treat concurrency as a first-class concern, not as something that "won't happen in practice."

**Mars Pathfinder (1997).** A few days after landing, the spacecraft began resetting itself periodically. The cause was priority inversion: a low-priority "meteorological data" task held a mutex that a high-priority "bus management" task needed. A medium-priority "communications" task preempted the low-priority task before it could release the mutex. A watchdog timer noticed the high-priority task wasn't running and reset the spacecraft. The fix was to enable priority inheritance on the VxWorks mutex, which had been disabled by default. The lesson: real-time systems must use priority-inheriting mutexes, and "the watchdog will catch it" is not a robustness strategy.

**Linux BKL.** The Big Kernel Lock was a single global lock introduced in Linux 2.0 (1996) to make SMP work without rewriting subsystems. Over the next 15 years, kernel developers gradually removed BKL from every subsystem, replacing it with finer-grained locks or lock-free structures. The last BKL was removed in 2011 with kernel 2.6.39. This is the largest and longest "god-mutex elimination" project in software history, and reading the commit messages is a masterclass in how to migrate a locking subsystem.

### Modern alternatives

**Rust's Send and Sync.** Rust encodes thread-safety in the type system. A type implements `Send` if it is safe to transfer ownership to another thread, and `Sync` if `&T` is safe to share. The borrow checker enforces that mutable references are exclusive, so data races are caught at compile time. The runtime cost is zero — there is no race detector to enable in production. The cognitive cost is that you must learn the type system, and some patterns (especially graph-like data structures) require `Arc<Mutex<T>>` or `unsafe`.

**Go's race detector.** Enabled with `go test -race` or `go run -race`. It instruments every memory access and tracks happens-before relationships using vector clocks. When it detects a race, it prints both stack traces. The overhead is roughly 5-10x CPU and 5-10x memory, which is too high for production but fine for tests. It has caught thousands of races in real codebases — including, famously, in the Go standard library itself.

**Lock-free data structures.** Libraries like `crossbeam` (Rust), `boost::lockfree` (C++), and `java.util.concurrent` (Java) provide queues, stacks, and hash maps that do not use locks. They use compare-and-swap loops and epoch-based or hazard-pointer memory reclamation. They are dramatically faster under contention but dramatically harder to reason about. Use them when profiling justifies it, not by default.

### Mentoring patterns — teaching juniors to spot deadlock-prone code

Juniors typically learn locking by being burned by a deadlock in production. A more efficient approach is to teach them to read code with deadlock-shaped eyes. Concrete exercises that work well:

1. **The lock-acquisition tour.** Have the junior open the codebase, search for every `Lock()` call, and list which lock it takes and what other locks it might take while held. By the end of the exercise they have built the lock-order graph in their head.

2. **The "what if I sleep here?" game.** Pick a critical section. Ask: "what if this thread were paused for one second here? What would the other threads be doing?" This builds intuition for what is and isn't safe to do under a lock.

3. **The reversal exercise.** Find two places where two locks are taken. Ask: "if I swapped the order in one of these, would a deadlock be possible? Construct the scenario." This teaches the connection between lock order and deadlock.

4. **The unlock-then-relock trap.** Show them code that releases a lock, does something, then re-acquires. Ask: "what invariant might no longer hold after the unlock?" This teaches that lock-protected invariants do not survive an unlock.

5. **The mutex copy bug.** Show them Go code where a struct containing a mutex is passed by value. Ask: "what happens if both copies are locked?" This is a real bug that `go vet` catches, but understanding why is illuminating.

The goal of mentorship is to transfer pattern recognition, not facts. A junior who can look at a pull request and say "this lock is being held across a network call, that's a problem" is more valuable than one who has memorized every primitive in the standard library.

### Anti-patterns at scale

- **"We put a giant lock around everything."** This is the BKL pattern. It works until it doesn't. Once contention becomes the bottleneck, breaking it up is a multi-year project.
- **God-mutex.** A single mutex inside a "service" object that guards every field. Tends to grow over time as more state is added. Hard to refactor because every method assumes the lock is held.
- **Lock held during I/O.** A request handler locks state, makes a downstream RPC, then unlocks. Under any load, the RPC latency dominates; every other request blocks. Fix: copy what you need, unlock, then do I/O.
- **Lock per object in a large pool.** Sometimes the overhead of one mutex per cached object exceeds the benefit. Consider striping locks across the pool instead.
- **Hot-path atomic + cold-path lock.** Common in counters: increment is atomic, but reading the snapshot takes a lock. If the snapshot is slow, the increments don't matter. Profile end-to-end, not piece by piece.
- **"Just retry on conflict."** Optimistic concurrency without bounded retries can spin forever under contention. Always cap retries and fall back to a blocking acquisition.
- **Locks held across user callbacks.** If user code can hang, allocate, recurse, or take other locks, you have lost control of your critical section.

---

## Real-World Analogies

**The hospital operating room.** A surgery requires multiple resources: the room, the anaesthesiologist, the specific instruments, the surgeon. Each must be reserved in a known order; otherwise two surgeries can deadlock waiting for each other's resources. The hospital's scheduling office is the lock-ordering policy. Without it, the system gives up entirely and one master coordinator (the BKL) schedules every surgery in series — slow, but never deadlocked.

**The newspaper print shop.** Multiple journalists submit articles; a single press prints the paper. Early shops had one editor (god-mutex) who serialized everything. Modern shops have editorial sections (sharded locks), copy-editors (per-article locks), and a final layout step that integrates all sections (lock hierarchy). The print run itself is RCU-like: the old edition is still being delivered while the new edition is being typeset.

**The university library acquisitions desk.** Multiple students return books; multiple students check out books. A single counter is the god-mutex. Self-checkout machines are sharded locks — each machine handles its own queue. Reference materials that cannot leave the library are RCU: many readers, no checkouts. The "hold list" for popular books is a condition variable: students wait until the book is returned, then are notified.

**The airline gate.** Boarding passes are checked one at a time at the gate (the mutex). Frequent flyers board first (priority inheritance). If the gate agent has to step away to handle a problem (lock held during I/O), the whole line stalls. Modern airports have multiple gate scanners (sharded locks) and zone-based boarding (lock hierarchy).

---

## Mental Models

**Locks are statements about invariants.** Every lock protects a specific invariant — "the count equals the sum of the buckets," "the next-pointer is non-null iff the node is in the list." When you take the lock, you are promising to restore the invariant before you unlock. The lock is not the goal; the invariant is.

**Lock order is a partial order on memory.** If you can draw a DAG of locks, you have a partial order. Any total order consistent with that partial order is a valid acquisition sequence. Cycles mean undefined behavior.

**Contention is a queue.** A contended lock is a queue with a service rate of one. Little's Law applies: average waiters = arrival rate times average service time. If service time is 1ms and arrivals are 2000/sec, you have an average of 2 waiters — manageable. If service time is 100ms (because the critical section does I/O), you have 200 waiters — disaster.

**Mutual exclusion is sequential execution.** Every critical section is a serialization point. Amdahl's Law tells you the speed-up from parallelism is bounded by the serial fraction. A 1% serial fraction caps speed-up at 100x regardless of how many cores you throw at it. Locking is sequential execution; minimize it accordingly.

**The lock holder is a privileged citizen.** While you hold a lock, you have an obligation to release it quickly. The longer you hold it, the more you tax every other thread. Treat lock-holding time as a budget.

---

## Code Examples

### 1) Thread-safe LRU cache with sharded locks (Go)

```go
// File: lru_sharded.go
// Run: go test -race -bench=. ./...
//
// A bounded LRU cache that scales to many cores via lock sharding.
// Each shard owns an independent mutex, list, and map. Reads and writes
// hash to a shard; only that shard's lock is taken. There is no global
// lock — the cache's total size is approximate (sum of shard sizes).

package lru

import (
    "container/list"
    "hash/fnv"
    "sync"
)

type entry struct {
    key   string
    value any
}

type shard struct {
    mu       sync.Mutex
    capacity int
    items    map[string]*list.Element
    order    *list.List
}

func newShard(cap int) *shard {
    return &shard{
        capacity: cap,
        items:    make(map[string]*list.Element, cap),
        order:    list.New(),
    }
}

func (s *shard) get(key string) (any, bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    el, ok := s.items[key]
    if !ok {
        return nil, false
    }
    s.order.MoveToFront(el)
    return el.Value.(*entry).value, true
}

func (s *shard) set(key string, value any) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if el, ok := s.items[key]; ok {
        el.Value.(*entry).value = value
        s.order.MoveToFront(el)
        return
    }
    if s.order.Len() >= s.capacity {
        oldest := s.order.Back()
        if oldest != nil {
            s.order.Remove(oldest)
            delete(s.items, oldest.Value.(*entry).key)
        }
    }
    el := s.order.PushFront(&entry{key: key, value: value})
    s.items[key] = el
}

type LRU struct {
    shards []*shard
}

func New(totalCapacity, shardCount int) *LRU {
    if shardCount < 1 {
        shardCount = 1
    }
    per := totalCapacity / shardCount
    if per < 1 {
        per = 1
    }
    shards := make([]*shard, shardCount)
    for i := range shards {
        shards[i] = newShard(per)
    }
    return &LRU{shards: shards}
}

func (c *LRU) shardFor(key string) *shard {
    h := fnv.New32a()
    _, _ = h.Write([]byte(key))
    return c.shards[int(h.Sum32())%len(c.shards)]
}

func (c *LRU) Get(key string) (any, bool) {
    return c.shardFor(key).get(key)
}

func (c *LRU) Set(key string, value any) {
    c.shardFor(key).set(key, value)
}
```

Design notes. The cache trades a strict global LRU policy for scalability: an item evicted from shard 3 is unaffected by activity in shard 7. For most real workloads this is acceptable, and the throughput gain over a single-locked LRU is dramatic — often 8-16x on modern hardware. The number of shards should be roughly the number of cores; more shards waste memory, fewer cause contention. The hash function must distribute keys well; FNV is fine, but for adversarial inputs use a seeded hash.

### 2) Refactor a god-mutex service into fine-grained locks (Go)

Before:

```go
// File: registry_before.go
// A god-mutex service: every operation takes the same lock.

package registry

import "sync"

type Registry struct {
    mu      sync.Mutex
    users   map[string]*User
    devices map[string]*Device
    audit   []AuditEntry
}

type User struct {
    ID    string
    Name  string
    Quota int
}

type Device struct {
    ID    string
    Owner string
}

type AuditEntry struct {
    Op   string
    Key  string
}

func (r *Registry) AddUser(u *User) {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.users[u.ID] = u
    r.audit = append(r.audit, AuditEntry{Op: "add_user", Key: u.ID})
}

func (r *Registry) GetUser(id string) *User {
    r.mu.Lock()
    defer r.mu.Unlock()
    return r.users[id]
}

func (r *Registry) AddDevice(d *Device) {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.devices[d.ID] = d
    r.audit = append(r.audit, AuditEntry{Op: "add_device", Key: d.ID})
}
```

After:

```go
// File: registry_after.go
// Fine-grained: users, devices, and audit each have their own lock.
// Lock order: users -> devices -> audit. Never the reverse.

package registry

import "sync"

type Registry struct {
    usersMu   sync.RWMutex
    users     map[string]*User

    devicesMu sync.RWMutex
    devices   map[string]*Device

    auditMu   sync.Mutex
    audit     []AuditEntry
}

func (r *Registry) AddUser(u *User) {
    r.usersMu.Lock()
    r.users[u.ID] = u
    r.usersMu.Unlock()

    r.appendAudit("add_user", u.ID)
}

func (r *Registry) GetUser(id string) *User {
    r.usersMu.RLock()
    defer r.usersMu.RUnlock()
    return r.users[id]
}

func (r *Registry) AddDevice(d *Device) {
    r.devicesMu.Lock()
    r.devices[d.ID] = d
    r.devicesMu.Unlock()

    r.appendAudit("add_device", d.ID)
}

func (r *Registry) appendAudit(op, key string) {
    r.auditMu.Lock()
    r.audit = append(r.audit, AuditEntry{Op: op, Key: key})
    r.auditMu.Unlock()
}
```

Refactoring notes. Reads of users and devices now use RWMutex — typically these maps are read-mostly. Audit appending has its own lock so audit contention does not block lookups. The lock order is documented as a comment at the top of the type and is preserved in every method. If a future method needs to update users and devices atomically, it must take both locks in the documented order and probably also a transaction notion at a higher layer.

A subtle point: after the refactor, `AddUser` is no longer atomic with the audit entry — a reader might see the new user before the audit row exists. Decide whether that matters. If it does, you need a transactional outer lock or a write-ahead log; you cannot fake it with fine-grained locks alone.

### 3) Linux kernel rwsem mini-tutorial (C)

The Linux kernel's `rw_semaphore` is the read-write equivalent of `mutex`. Readers and writers both sleep when they cannot acquire. Multiple readers can hold the semaphore concurrently; writers are exclusive.

```c
/* File: rwsem_example.c
 * Out-of-tree kernel module illustrating rwsem usage.
 * Build with a Linux Kbuild Makefile and insmod into a test VM. Do not
 * run on a production machine.
 */
#include <linux/init.h>
#include <linux/module.h>
#include <linux/rwsem.h>
#include <linux/slab.h>
#include <linux/kthread.h>
#include <linux/delay.h>

MODULE_LICENSE("GPL");

struct shared_state {
    struct rw_semaphore rwsem;
    int counter;
    char data[64];
};

static struct shared_state *state;
static struct task_struct *reader_thread;
static struct task_struct *writer_thread;

static int reader_fn(void *arg)
{
    while (!kthread_should_stop()) {
        down_read(&state->rwsem);
        pr_info("reader: counter=%d data=%s\n",
                state->counter, state->data);
        up_read(&state->rwsem);
        msleep(100);
    }
    return 0;
}

static int writer_fn(void *arg)
{
    int i = 0;
    while (!kthread_should_stop()) {
        down_write(&state->rwsem);
        state->counter++;
        snprintf(state->data, sizeof(state->data),
                 "update_%d", i++);
        up_write(&state->rwsem);
        msleep(500);
    }
    return 0;
}

static int __init rwsem_init(void)
{
    state = kzalloc(sizeof(*state), GFP_KERNEL);
    if (!state)
        return -ENOMEM;

    init_rwsem(&state->rwsem);
    strscpy(state->data, "initial", sizeof(state->data));

    reader_thread = kthread_run(reader_fn, NULL, "rwsem_reader");
    writer_thread = kthread_run(writer_fn, NULL, "rwsem_writer");
    return 0;
}

static void __exit rwsem_exit(void)
{
    kthread_stop(reader_thread);
    kthread_stop(writer_thread);
    kfree(state);
}

module_init(rwsem_init);
module_exit(rwsem_exit);
```

Discussion. `down_read` and `up_read` are the reader side; multiple kthreads can be inside `down_read` simultaneously. `down_write` and `up_write` are the writer side; they block until all readers have left. The semaphore is fair on modern kernels, so writers do not starve. The `init_rwsem` call sets up the internal wait queue.

In production kernel code, the most famous `rwsem` is `mmap_lock` (formerly `mmap_sem`), which protects a process's address space. Reads of the VMA tree take it for read; modifications take it for write. The contention on `mmap_lock` was so severe in some workloads that the kernel community spent years splitting it into per-VMA locks and ultimately into a maple-tree-based structure. That story is a textbook case of "your rwsem becomes the bottleneck, then you need to fundamentally rethink the data structure."

---

## Pros & Cons

### Pros

- **Well-understood semantics.** Locking is taught in every operating systems course; the mental model is shared across the industry.
- **Composability.** A correctly-written locked subsystem can be composed with other locked subsystems, given a global lock order.
- **Predictable failure modes.** Deadlocks, contention, priority inversion — all of these have known signatures and known mitigations.
- **Tool support.** Race detectors, deadlock detectors, lock-order verifiers, and profilers all understand mutexes.
- **Available in every language.** No need for exotic dependencies.

### Cons

- **Serialization.** Every critical section is a chunk of sequential execution. Amdahl's Law limits scalability.
- **Composability has limits.** As subsystems grow, global lock orders become hard to maintain.
- **Tail latency.** A lock held by a paged-out thread can stall every waiter for tens of milliseconds.
- **Deadlock risk grows quadratically.** With N locks, you have N(N-1)/2 potential lock-order rules to enforce.
- **Hard to reason about across asynchronous boundaries.** Locks held across `await`, callbacks, or yield points are a major source of bugs.

---

## Use Cases

- **Caches and registries.** Sharded locks, RWMutex for read-mostly access.
- **Background job queues.** Mutex around the work list; condition variables for "waiter on work available."
- **Connection pools.** Mutex around the free list; condition variable for "waiter on connection available."
- **In-memory rate limiters.** Mutex around a sliding-window counter, or atomic for a simple token bucket.
- **Configuration hot-reload.** RWMutex or copy-on-write; readers must see a consistent snapshot.
- **Metrics aggregation.** Per-shard mutex, plus a periodic flusher that takes all shard locks in order.
- **File-system-like indexes.** Hand-over-hand locking through a tree.
- **Embedded real-time systems.** Priority-inheriting mutexes are mandatory; everything else is a candidate for queues.

---

## Coding Patterns

- **RAII / defer for unlock.** Always release on the function exit path. No exceptions.
- **Try-lock with backoff.** When out-of-order acquisition is unavoidable, try-lock, drop both, sleep with jitter, retry.
- **Copy-out-then-unlock.** Copy the data you need, release the lock, then act on the data.
- **Single-writer-many-readers via atomic pointer.** Writer prepares a new structure, atomically swaps a pointer, lets readers finish on the old one (a poor man's RCU).
- **Lock-then-publish for initialization.** Set up the object completely under the lock, then make it visible to other threads.
- **Sharded counters.** Per-shard `int64`, summed lazily when the total is read.
- **Read-side fast path with atomic version counter.** If the counter is unchanged across the read, the read is consistent; otherwise retry.
- **Two-phase locking.** Acquire all needed locks in order, do work, release all in reverse order.

---

## Clean Code

- Name locks for what they protect: `usersMu`, not `mu1`.
- Place the lock field immediately above the fields it protects, with a comment.
- Keep critical sections short enough to fit on one screen.
- Prefer many small private methods that assume the lock is held over one large method that takes and releases.
- Use a naming convention like `unlocked` or trailing `Locked` to mark methods that require the lock to be held by the caller.
- Document lock order at the type definition, not buried in a wiki.
- Treat every new lock as an entry in the locking policy; require a doc update in code review.

---

## Best Practices

- **Profile before optimizing.** Lock contention is often not the bottleneck you think it is. Use perf, pprof, or your language's profiler.
- **Make lock order explicit and reviewable.** A diagram in `docs/locking.md` plus comments at lock-field definitions.
- **Use RWMutex sparingly.** It is slower than Mutex under low contention; only adopt it when reads dominate writes by ~10x or more.
- **Never hold a lock across I/O.** Copy the necessary state, release, do I/O.
- **Never hold a lock across a user callback.** You do not control what the callback will do.
- **Always pair a `sync.Cond.Wait()` with a predicate loop.** Spurious wake-ups are real, even when they shouldn't be.
- **Use deadlock detectors in tests.** Go's race detector, Java's ThreadMXBean, Linux's lockdep.
- **Treat lock-acquisition latency as a metric.** Histogram of time-to-acquire; spikes are leading indicators.
- **Plan for migration.** Today's mutex may be tomorrow's sharded mutex may be tomorrow's lock-free queue. Keep the abstraction boundary clean.

---

## Edge Cases & Pitfalls

- **Lock taken in a destructor that runs in an unknown thread.** Hard to reason about; consider an explicit `Close()` method.
- **Lock held while panicking / throwing.** RAII saves you in C++ and Rust; defer saves you in Go; in Java you need try-finally or `Lock.lockInterruptibly()`.
- **Lock around a slow-allocating call.** Map growth, slice append with realloc, GC pause. The critical section is longer than it looks.
- **Lock on a struct that gets copied.** In Go this is a `go vet` warning; in other languages it can pass silently.
- **Forgetting that `defer unlock` runs in LIFO order.** Easy to release in the wrong order if you have nested locks.
- **Async cancellation.** A goroutine killed while holding a lock leaks the lock forever. Don't kill goroutines.
- **Reentrant patterns in non-reentrant locks.** The same thread takes the lock twice and deadlocks itself. Some languages have reentrant mutexes; Go and C++ standard `std::mutex` do not.
- **Read-modify-write under a read lock.** RWMutex allows concurrent reads, so you cannot modify under a read lock. Take the write lock.
- **Time spent in `Lock()` itself.** Under heavy contention the lock acquisition path dominates the critical section.
- **Cache-line ping-pong on the lock word.** Two cores fighting over the same cache line burn enormous CPU even on uncontended-looking locks.

---

## Common Mistakes

- **Sprinkling mutexes after the fact.** Locking that is added defensively to an existing single-threaded design is always brittle. Design for concurrency from the start.
- **Locking everything to be safe.** The opposite mistake: a god-mutex that kills performance.
- **Mixing atomic operations and mutex-protected reads of the same variable.** Pick one. Mixed approaches lead to torn reads.
- **Not handling spurious wake-ups.** `if (!ready) cond.wait();` is a bug; use `while`.
- **Treating `RWMutex.RLock()` as cheap.** It is not free; it still requires synchronization on every acquisition.
- **Confusing "no race detector warning" with "race-free."** The race detector catches what executed in this test run; rare interleavings can slip through.
- **Putting the lock inside the loop body instead of outside.** Or vice versa, when batching would be better.
- **Holding the lock through a `select` or `await`.** The runtime may park your goroutine while still holding the lock.

---

## Tricky Points

- **Fairness vs throughput.** Strictly fair locks have higher worst-case latency but better predictability. Unfair locks have higher throughput but can starve some waiters. Choose deliberately.
- **Adaptive spinning.** Modern mutexes spin briefly before blocking. The spin threshold is tuned for typical hold times; if your hold times are unusual, the default may be wrong.
- **NUMA effects.** A lock acquired by a thread on a different NUMA node than the data takes a remote memory access for every read. Pinning matters.
- **Memory order on unlock.** Unlock is a *release* operation. Reads before the unlock are visible to any thread that subsequently acquires the lock. Reads after the unlock are not protected.
- **Lock elision and TSX.** On some Intel CPUs, the hardware can speculatively skip the lock if no conflict occurs. Useful for short, mostly-uncontended critical sections; complicated to deploy correctly.
- **Futexes.** Modern Linux mutexes are built on `futex(2)`, which lets the userspace lock fast-path stay in userspace and only call the kernel on contention. The performance difference vs the old pthread implementation is enormous.

---

## Test Yourself

1. You inherit a service with a single `sync.Mutex` around a registry of 100k entries. Latency is fine at 100 RPS but degrades sharply at 1k RPS. Walk through the diagnosis and the refactor.
2. Draw the lock-order DAG for a system with a global metadata lock, per-bucket locks, and per-entry locks. List two acquisition sequences that are valid and two that are not.
3. Explain why every `cond.Wait()` is followed by a re-check of the predicate, in terms of Mesa-style semantics.
4. Implement a `TryLock` with timeout in your favorite language. Discuss the trade-offs vs blocking `Lock`.
5. Given the Pathfinder bug, explain why priority inheritance was the fix and what alternative designs would have avoided the bug entirely.

## Tricky Questions

1. Under what conditions is a god-mutex actually the right design choice, and how would you defend that choice in a review?
2. If you have three locks `A`, `B`, `C` and you sometimes acquire them in the order `A->B`, sometimes `A->C`, sometimes `B->C`, is there a deadlock risk?
3. What is the difference between Hoare and Mesa condition variables, and why did Mesa win?
4. When would you choose a sharded `Mutex` over a single `RWMutex`, even for a read-mostly workload?
5. Explain how `sync.Mutex` in Go can be both fast for the uncontended case and fair for the contended case. What is "starvation mode"?

---

## Cheat Sheet

```
Designing a locking subsystem:
  1. List shared state.
  2. Identify access pattern (R-heavy, W-heavy, balanced).
  3. Identify latency requirement.
  4. Choose primitive (atomic / mutex / RWMutex / channel / RCU).
  5. Document lock order as a DAG.
  6. Codify review heuristics.
  7. Plan for migration.

Code review checklist:
  - Lock taken on one path, released on another?
  - Lock held across I/O?
  - Lock held across callback?
  - New lock added without doc update?
  - Sleep / timeout inside a critical section?
  - Atomic + lock on the same variable?
  - Pointer to lock-protected state returned?
  - Recursive call under non-reentrant lock?

Anti-patterns:
  - God-mutex
  - Lock held during I/O
  - Lock per object in massive pool
  - Hot-path atomic + cold-path lock
  - Unbounded retry on conflict
  - Lock across user callback

History:
  Dijkstra (1965): semaphore
  Hoare (1974):   monitor + signal-and-urgent
  Mesa (1980):    signal-and-continue (modern style)

Famous bugs:
  Therac-25:        race condition in safety-critical code
  Mars Pathfinder:  priority inversion, fixed by priority inheritance
  Linux BKL:        15-year migration from god-mutex to fine-grained
```

---

## Summary

At the professional level, mutexes are no longer interesting in isolation — what matters is the locking subsystem they belong to. Design begins by minimizing shared state, choosing the right primitive for each access pattern, documenting the lock order as a DAG, and codifying review heuristics so that the team can sustain the design over years. History informs every choice: Dijkstra's semaphores, Hoare's monitors, and Mesa-style condition variables shaped today's APIs. Famous failures — Therac-25, Mars Pathfinder, the BKL saga — teach which patterns to avoid at scale.

Modern alternatives reshape the trade-offs. Rust's `Send` and `Sync` catch data races at compile time; Go's race detector catches them in tests; lock-free data structures replace contention with compare-and-swap overhead. The professional engineer evaluates these alternatives on their merits, not their novelty, and migrates when measurement justifies it.

Mentorship is part of the role. Teaching a junior to read code with deadlock-shaped eyes — to ask "what if this thread paused here?", "who else might be holding this lock?", "what invariant does this critical section preserve?" — is more valuable than answering their tactical questions one at a time. The goal is to make the team's collective taste better, not to be the sole gatekeeper of correct locking.

Locks are statements about invariants. The lock is not the goal; the invariant is. Keep critical sections short. Hold no lock across I/O. Document the lock order. Profile before optimizing. Migrate when measurement justifies it. These are the habits that turn a competent engineer into a professional one.

---

## What You Can Build

- A locking-policy document template for your team's services.
- A sharded LRU cache benchmarked against a single-locked one across 1, 2, 4, 8, 16 cores.
- A code-review bot that flags common locking anti-patterns (lock held across `http.Do`, mutex-by-value, etc.).
- A teaching exercise for juniors that walks them through the BKL removal commits.
- A linter that verifies your team's documented lock order against actual code.
- A locking-subsystem-design talk for an internal engineering all-hands.
- A migration of one god-mutex service in your codebase to fine-grained or sharded locks, with before/after benchmarks.

---

## Further Reading

- *The Art of Multiprocessor Programming* by Maurice Herlihy and Nir Shavit. The definitive textbook; covers mutexes, condition variables, lock-free structures, and transactional memory with rigorous semantics.
- *Java Concurrency in Practice* by Brian Goetz et al. Doug Lea is a contributor; the patterns generalize far beyond Java.
- Doug Lea's papers on the `java.util.concurrent` library — especially "The java.util.concurrent Synchronizer Framework" — explain the design of modern lock implementations.
- Linux kernel mailing list discussions on the BKL removal. Searching for "BKL" in lore.kernel.org turns up years of commentary on why coarse-grained locking does not scale.
- Linus Torvalds's posts on spinlocks vs sleeping locks. Look for his rants on userspace spinlocks (spoiler: he is against them).
- Documentation/locking/ in the Linux kernel source tree. The canonical reference for the kernel's mutex flavors.
- *Patterns in Concurrent and Distributed Programming* by Schmidt et al. — the Reactor and Proactor patterns, half-sync/half-async, monitor object, double-checked locking.
- Paul McKenney's *Is Parallel Programming Hard, And, If So, What Can You Do About It?* — covers RCU and per-CPU patterns in depth.
- "Mars Pathfinder Bug" post-mortem by Mike Jones (1997) — short and worth reading.
- Nancy Leveson's "Therac-25 Accidents" paper — the foundational safety-critical-software case study.
- Rust's `std::sync` documentation and the Rustonomicon's chapter on `Send`/`Sync`.

---

## Related Topics

- [Mutex — Senior Level](senior.md)
- [Mutex — Middle Level](middle.md)
- [Concurrency Primitives Overview](../README.md)
- [Channels and Message Passing](../02-channels/README.md)
- [Atomic Operations](../03-atomics/README.md)
- [RCU and Read-Mostly Patterns](../04-rcu/README.md)
- [Lock-Free Data Structures](../05-lock-free/README.md)
- [Memory Models and Ordering](../../03-memory-model/README.md)
- [Cache Coherence (MESI)](../../04-hardware/01-cache-coherence/README.md)
- [Real-Time Scheduling](../../05-scheduling/README.md)

---

## Diagrams & Visual Aids

### Lock hierarchy DAG (canonical example)

```
            +-----------------+
            |  metadata_lock  |
            +--------+--------+
                     |
                     v
            +-----------------+
            |  bucket_lock[N] |
            +--------+--------+
                     |
                     v
            +-----------------+
            |   entry_lock    |
            +-----------------+
```

### Contention scales with hold time (Little's Law)

```
   arrival rate:  R requests/sec
   hold time:     T seconds
   avg waiters:   R * T  (Little's Law)

   R=2000, T=0.001  ->  2 waiters (fine)
   R=2000, T=0.010  ->  20 waiters (warning)
   R=2000, T=0.100  ->  200 waiters (disaster: tail latency explodes)
```

### Migration path: shared memory -> MPSC -> sharded

```
   Phase 1: shared memory + god mutex
       [P1] [P2] [P3] [P4]  ->  [mutex] -> [map]
                                  ^^^^^ contention

   Phase 2: MPSC channels, single aggregator
       [P1] [P2] [P3] [P4]  ->  [chan] -> [aggregator] -> [map]
                                                 ^^^ single-threaded

   Phase 3: sharded service
       [P1]->[hash]->[shard0 chan]->[agg0]->[map0]
       [P2]->[hash]->[shard1 chan]->[agg1]->[map1]
       [P3]->[hash]->[shard2 chan]->[agg2]->[map2]
       [P4]->[hash]->[shard3 chan]->[agg3]->[map3]
```

### Mesa-style condvar wake pattern

```
   Thread A (waiter)          Thread B (signaller)
   --------------             --------------------
   lock(m)
   while (!ready) {
       wait(c, m)
                              lock(m)
                              ready = true
                              signal(c)
                              unlock(m)
   <- woken, m re-acquired
   }   <- predicate must be re-checked
   do_work()
   unlock(m)
```

### Lock-order violation -> deadlock

```
   T1: lock(A); lock(B); ...
   T2: lock(B); lock(A); ...

   Interleaving:
     T1 holds A, wants B
     T2 holds B, wants A
     --> both block forever

   Fix: enforce a global lock order, e.g. always A before B.
```

### Sharded LRU layout

```
   key "foo"  -- hash --> shard 3
                          [mutex][list][map]

   key "bar"  -- hash --> shard 7
                          [mutex][list][map]

   No global lock. Total size = sum(shard size).
   Trade-off: not a strict global LRU; eviction is per-shard.
```
