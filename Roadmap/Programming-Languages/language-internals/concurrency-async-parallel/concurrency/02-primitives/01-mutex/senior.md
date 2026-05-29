# Mutex — Senior Level

> **Topic:** [Mutex](README.md)
> **Focus:** futex internals, contention, scheduler interaction, alternatives

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

At the junior and middle levels, a mutex is a black box: you call `Lock`, you do work, you call `Unlock`. The senior level is where the box opens. You stop asking "does this compile" and start asking "how many cycles does an uncontended `Lock` cost, what happens to the goroutine when it does not, and why is my p99 latency tripling under load even though CPU is at 40%?"

A modern user-space mutex is not a thin wrapper over a kernel object. It is a careful negotiation between three layers: an atomic CAS in user space (the fast path), a futex (or equivalent) syscall when contention appears, and a language runtime that decides whether to spin, park, or migrate the waiting thread or goroutine. Each layer hides surprising costs. The fast path is one cache miss away from being twenty times slower. The slow path drags the kernel scheduler into the picture, with consequences that ripple through priority, fairness, and tail latency. The runtime layer adds its own quirks: Go's adaptive spinning, the JVM's biased locking, glibc's `pthread_mutex_t` flavors.

This page is about that machinery. We will read the futex protocol the way a network engineer reads TCP. We will look at lock convoys, priority inversion, and the moment when an `RWMutex` becomes slower than a plain `Mutex`. We will profile contention with `perf lock`, Go's block profile, and Java Flight Recorder, and we will look at the alternatives — lock-free structures, hierarchical locks, sharding — and the conditions under which they actually pay off. By the end you should be able to look at a flame graph, point at the contended lock, and explain not just "there is contention" but "the scheduler is parking goroutines on this `semroot` tree because the spin budget is exhausted".

This is the level at which mutexes stop being primitives and start being a system to be engineered.

---

## Prerequisites

Before reading this page you should be comfortable with:

- Memory ordering: acquire/release semantics, sequential consistency, the difference between `MOV` and `LOCK XCHG`, and what a `MFENCE` does on x86.
- Compare-and-swap, fetch-and-add, and how the cache coherence protocol (MESI/MOESI) handles them.
- Kernel/user boundary: what a syscall costs, what `vDSO` does, and roughly how preemption works in a modern Linux kernel.
- The Go scheduler at the goroutine/M/P level, or the JVM thread-to-OS-thread mapping with safepoints.
- Linux performance tools: `perf`, `strace`, `bpftrace` at least at the level of running canned scripts.

If any of these are shaky, dip back into the middle-level concurrency pages — particularly the atomics and memory-model material — before continuing.

---

## Glossary

- **Futex** — Fast Userspace muTEX. A Linux primitive that lets a user-space lock perform its fast path entirely without entering the kernel, and only crosses into the kernel when threads must block or be woken.
- **Spinning** — Repeatedly checking a memory location in a tight loop, hoping the lock will be released soon. Trades CPU for latency.
- **Parking** — Suspending a thread (via futex wait, `park()` in Java, `gopark` in Go) so the OS or runtime can schedule something else.
- **Lock convoy** — A pathology in which threads accumulate behind a frequently-released lock and cannot make progress concurrently, even when the critical section is short.
- **Priority inversion** — A high-priority thread waits for a lock held by a low-priority thread which itself is preempted by medium-priority threads.
- **Priority inheritance (PI)** — A protection against priority inversion in which the holder of a lock temporarily inherits the priority of the highest-priority waiter.
- **Biased locking** — A JVM optimization (now deprecated as of JDK 15) in which a lock is "biased" toward the thread that acquired it first, eliminating CAS for repeated re-acquisitions.
- **Lock elision** — A technique (hardware via Intel TSX, or software via static analysis) that speculatively executes a critical section without acquiring the lock, falling back to real locking on conflict.
- **Block profile** — A Go runtime profile that records goroutines blocked on synchronization events (mutexes, channels) for longer than a configurable threshold.
- **Adaptive mutex** — A mutex implementation that decides at runtime whether to spin or to park, based on heuristics about lock contention and holder behavior.

---

## Core Concepts

### Futex internals — user-space fast path plus kernel slow path

The classic Unix mutex was a kernel object. Every `lock` and `unlock` made a system call, even when the lock was uncontended. That cost — on the order of hundreds of nanoseconds — was unacceptable for fine-grained locking. The futex (Fast Userspace muTEX), introduced into Linux in 2002 by Rusty Russell, Hubertus Franke, and Matthew Kirkwood, fixed it.

The protocol is simple. A futex is a 32-bit aligned integer in shared memory. Convention: zero means unlocked, non-zero means locked. Userspace code does the fast path with a CAS:

```
if (CAS(addr, 0, 1) == success) { /* we own it */ }
```

If the CAS succeeds the lock is acquired without ever touching the kernel. If it fails the userspace code calls the `futex(FUTEX_WAIT, addr, expected)` syscall. The kernel checks that `*addr == expected` under a hash-bucket spinlock — if not, it returns `EAGAIN` and the caller retries. If yes, the kernel queues the thread on a wait queue indexed by the address and puts it to sleep.

On unlock, the holder atomically clears the integer (or decrements it) and, if it suspects waiters exist, calls `futex(FUTEX_WAKE, addr, n)` to wake up `n` waiters. The "if it suspects" part is the optimization that makes futexes fast: a flag bit (often the high bit of the lock word, or a separate "contended" state) tells the holder whether `FUTEX_WAKE` is needed. If no one has ever blocked on this lock, unlock is a single atomic store and a branch.

This is the foundation under glibc's `pthread_mutex_t`, Go's `sync.Mutex`, the JVM's parking primitives, and essentially every modern Linux user-space lock. On other platforms the names change — Windows has `WaitOnAddress`/`WakeByAddressSingle`, macOS has `__ulock_wait`/`__ulock_wake` — but the protocol is identical.

### FUTEX_WAIT and FUTEX_WAKE syscalls

`FUTEX_WAIT` takes three arguments that matter for correctness: the address, the expected value, and a timeout. The expected-value check is the protocol's main correctness trick. Without it, you have a race: the unlocker stores zero, then the locker reads non-zero (stale), the locker calls `FUTEX_WAIT`, the unlocker calls `FUTEX_WAKE` but no one is parked yet, and the locker sleeps forever. With the check, the kernel re-reads the value while holding the bucket lock and refuses to park if the value has changed.

`FUTEX_WAKE` takes a count. The most common values are 1 (wake one) and `INT_MAX` (wake all). For mutex unlock, you wake one. For condition variable broadcast you wake all (or, more efficiently, use `FUTEX_REQUEUE` to move them onto a different futex).

Important variants:

- `FUTEX_WAIT_BITSET` lets you tag waits and wakes with a 32-bit mask, so you can wake only a subset of waiters on the same address. Used for reader-writer locks.
- `FUTEX_REQUEUE` / `FUTEX_CMP_REQUEUE` move waiters from one address to another without waking them. This is how `pthread_cond_broadcast` avoids the thundering-herd "wake all, all race for the mutex, all but one go back to sleep" problem.
- `FUTEX_LOCK_PI` / `FUTEX_UNLOCK_PI` implement priority-inheriting mutexes, used by real-time threads.

### Adaptive spinning

Parking is expensive — a context switch, a TLB flush on some configurations, cache pollution, and on the way back a queue insertion in the scheduler. If the lock will be released in the next 50 nanoseconds, parking is a terrible idea: it costs more than just waiting.

Hence adaptive spinning. The locker, after a failed CAS, doesn't immediately call `FUTEX_WAIT`. It spins for a while in user space, repeatedly checking the lock word. Two questions: how long, and what does it execute in the spin loop?

How long: glibc, by default, spins for a fixed iteration count (around 100 on modern systems) per `pthread_mutex_lock` call. Go's `sync.Mutex` uses `runtime.sync_runtime_doSpin` which spins for 30 iterations of `PAUSE` instructions per attempt and is gated by checks that there are other Ps available to run the holder. The kernel's `pthread_mutex_t` with `PTHREAD_MUTEX_ADAPTIVE_NP` does something similar.

What it executes: the spin loop must do two things — read the lock word, and signal the CPU that this is a spin. The signal on x86 is the `PAUSE` instruction (which on modern microarchitectures sleeps for tens of cycles, reduces the cost of memory-order misspeculation when the lock is released, and reduces power). On ARM it is `YIELD` or `WFE`. Without these the spin loop saturates the pipeline, wastes power, and on hyper-threaded cores starves the sibling thread.

Adaptive spinning is also disabled in conditions where it would be harmful. Go's runtime checks whether all Ps are busy — if not, spinning is pointless because the holder is not running. Real-time threads disable it because it can hide priority inversion.

### Lock convoy and contention pathologies

A lock convoy forms when threads arrive at a lock faster than the critical section can drain them, and the wake-up pattern serializes them in a way that prevents the system from recovering. The classic scenario:

1. Thread A holds the lock and is preempted while holding it.
2. Threads B, C, D, E all try to acquire and block.
3. A is rescheduled, finishes, unlocks. The kernel wakes B.
4. B runs, holds for a microsecond, releases. The kernel wakes C.
5. While C runs, B tries to re-acquire (e.g., another iteration of the same loop) and queues again.
6. Now everyone is queued in a strict order; nobody can proceed except in lockstep.

Throughput drops to "one critical section per context switch", which can be 100x slower than the uncontended case. The fixes are systemic: reduce hold time, partition the data, replace the lock with a lock-free structure, or use a backoff scheme.

Other pathologies:

- **Lock starvation**: under FIFO wakeup, a thread that wakes up but does not immediately re-acquire may be skipped if a newcomer steals the lock (barging). Go's `Mutex` uses a "starvation mode" — after a waiter has been queued for more than 1ms it switches to FIFO handoff, in which the unlocker passes ownership directly to the head of the queue without releasing the atomic.
- **Cache-line ping-pong**: even an uncontended atomic access incurs cache-line transfers if multiple CPUs read the lock word concurrently. A "lock prefix" instruction forces the line into Modified state on the owning CPU, invalidating it everywhere else. Two CPUs both polling a `sync.Mutex`'s state field can cost more than the critical section itself.

### Priority inversion — Mars Pathfinder

The canonical priority inversion story is the Mars Pathfinder, July 1997. The spacecraft kept rebooting on Mars because a high-priority bus management thread was waiting on a mutex held by a low-priority meteorological data thread, which itself was preempted by a medium-priority communications task. The bus management watchdog timed out and triggered a system reset.

The structure is:

- Low priority L holds lock M.
- Medium priority threads M1, M2, ... are runnable and never block.
- High priority H tries to acquire M.

If the scheduler is preemptive priority-based, H goes to sleep on M, L is preempted by M1, M1 runs to completion or blocks, then M2, and so on. H is effectively blocked by M1..Mn, even though they do not hold M. The medium-priority threads have inverted into a priority above H.

The fix is priority inheritance: while L holds M and H is waiting, L's effective priority is boosted to H's. M1..Mn cannot preempt L until L releases M. Once L releases, H takes the lock, L drops back to its base priority.

POSIX exposes this via `pthread_mutexattr_setprotocol(PTHREAD_PRIO_INHERIT)`. Linux supports it with `FUTEX_LOCK_PI`. For real-time systems it is mandatory. For ordinary user-space services it is rarely used because the runtime cost is higher than the unmodified futex path.

### Scheduler interaction — Go runtime parking

When a Go goroutine fails to acquire a `sync.Mutex` and exhausts its spin budget, the runtime calls `runtime_SemacquireMutex`, which eventually calls `semacquire1`. This places the goroutine in a treap (a randomized binary tree) keyed by the wait address, called a `semaRoot`. The goroutine is then `gopark`ed — its state is set to `_Gwaiting`, its M releases its P, the P picks up another runnable G, and the M either runs the next G or, if none, spins down.

When the unlocker calls `semrelease1`, it walks the treap to find a waiter, removes it, and calls `goready` on the goroutine. `goready` puts the goroutine back on a run queue (preferring the local P's queue) and, if no M is currently spinning, wakes up an M to run it.

This is why a contended Go mutex shows up in flame graphs as `runtime.semacquire1` / `runtime.semrelease1`, and why the block profile shows time in `sync.(*Mutex).Lock`. The runtime is doing real work on every contended acquire — not just a syscall, but also a tree walk and a scheduler transition. For very high contention, this work itself becomes a bottleneck, which is one reason `sync.Pool` and sharded designs exist.

### Lock-free alternatives — when CAS-based structures beat mutexes

Lock-free data structures use CAS loops (or LL/SC on ARM) to update shared state without locking. The classic examples are Treiber's stack, the Michael-Scott queue, and concurrent hash maps with fine-grained CAS on buckets.

When do they beat mutexes? Conditions:

- The critical section is tiny (one or two pointer updates).
- Contention is moderate — high enough that mutex parking hurts, low enough that the CAS retry loop doesn't spin forever.
- Memory reclamation is solved (hazard pointers, epoch-based reclamation, RCU, or you're in a GC'd language).
- The data structure has a natural CAS-able state (a head pointer, a counter, a bitmap).

When do they lose? When the critical section has multiple updates that must be atomic together — a CAS only updates one word, and multi-word atomicity is doable but adds overhead. When contention is extreme, lock-free structures can degrade worse than mutex-based ones because every retry wastes a full CAS round trip across cores. When the language doesn't provide memory ordering primitives (or provides them at the wrong granularity), lock-free is a debugging nightmare.

A telling story: many production systems started with lock-free queues and migrated back to mutex-protected ring buffers after measuring real workloads, because the lock-free version was harder to maintain and the mutex version was fast enough.

### Hierarchical locking

When code must acquire multiple locks, the classic deadlock-avoidance technique is hierarchical locking: assign a global order to all locks and require that any thread acquires them in that order. If thread A holds L1 and wants L2, while thread B holds L2 and wants L1, you have a deadlock — but if both must acquire in increasing order, it cannot happen.

Implementations:

- A static rank field on each lock, checked in a debug build.
- A thread-local "currently held locks" set, checked on acquire.
- Compile-time lockdep (Linux kernel) that builds the dependency graph dynamically and reports cycles.

The cost is real: every acquire becomes a bounded amount of bookkeeping. The benefit is that you can ship multi-lock code with confidence. Production databases, file systems, and kernels rely on this.

### Reader-writer scaling traps — when RWMutex is slower than Mutex

A reader-writer lock lets multiple readers proceed concurrently while writers have exclusive access. Naïve expectation: read-heavy workloads scale linearly with cores.

The trap: every reader still writes to a shared counter on acquire and release. That shared counter is a cache line that bounces between cores. With N cores reading, you have N writes per read to a single line, and the line transitions Modified → Invalidated → Modified at each transfer. The throughput is limited by the cache coherence protocol, not by the workload.

In Go, `sync.RWMutex` has been benchmarked as slower than `sync.Mutex` for read-heavy workloads when the critical section is short, exactly because of this. The fix is sharded counters (one per core / per P), bitfield-style state words, or RCU-style designs where readers don't write anything.

For Go specifically: prefer `sync.Mutex` unless the read critical section is long enough (say, microseconds) to amortize the contention on the state word. For Java, `StampedLock` provides an optimistic-read mode that lets readers skip the counter increment entirely.

### JVM biased locking and lock elision

Biased locking, introduced in HotSpot around 2006, observed that most locks are acquired and released by the same thread. The first acquire records the thread's identity in the object's mark word; subsequent acquires by the same thread just check the field and skip the CAS. The savings on uncontended single-threaded code paths could be significant.

Why was it deprecated and removed (JEP 374, JDK 15)? Two reasons. First, modern CAS on contended caches is fast enough that the savings became negligible. Second, the bookkeeping for revoking a bias (when a second thread tries to acquire) required a safepoint, and safepoints have become much more expensive in modern JVMs with concurrent collectors. The cost-benefit tipped.

Lock elision is a different idea: don't acquire the lock at all, on the theory that the critical section won't conflict. Intel TSX (Transactional Synchronization Extensions) implemented this in hardware. A `XACQUIRE` prefix tells the CPU "speculatively execute as if the lock is acquired; if there's a conflict, roll back and acquire for real". TSX had several security and stability issues (TAA vulnerability, Pluton-style erratum on some Skylake variants) and is rarely enabled in production today, but the idea persists in research and in the JVM's escape-analysis-based static elision (`-XX:+DoEscapeAnalysis`).

### The double-checked locking anti-pattern and its fix

Double-checked locking is the pattern:

```java
if (instance == null) {
    synchronized (lock) {
        if (instance == null) {
            instance = new Singleton();
        }
    }
}
return instance;
```

The intent: skip the lock on the common case where `instance` is already initialized. The bug: without proper memory ordering, the second thread might read a non-null `instance` reference whose constructor has not finished executing, because the compiler and CPU may reorder the constructor's writes after the reference write.

The fix in Java since JSR-133 (Java 5): declare `instance` as `volatile`. A volatile write is a release-store, a volatile read is an acquire-load, and the constructor's writes happen-before the read of the reference.

In C++ the fix is `std::atomic<T*>` with `memory_order_release` on the store and `memory_order_acquire` on the load. In Go the idiom is `sync.Once`, which encapsulates the pattern correctly.

The reason this still matters at the senior level: developers reinvent it. You will see "fast-path nil check then mutex then re-check" patterns in caches, lazy initializers, and resource pools. If the protected object's constructor performs any non-atomic writes (which is essentially always), you need release/acquire ordering, and the way you get it varies by language.

### Profiling lock contention

You cannot fix what you cannot see. Tools:

- **Linux `perf lock`**: records contention events from the kernel's lock instrumentation. Run `perf lock record ./your-binary`, then `perf lock report` shows lock name, contention count, max/total wait time, and the call site. Requires kernel `CONFIG_LOCK_STAT`.
- **`bpftrace` lock scripts**: count futex syscalls per process, histogram their durations, attribute them to user-space stack traces.
- **Go's block profile**: `runtime.SetBlockProfileRate(1)` enables collection. `go tool pprof -block http://localhost:6060/debug/pprof/block` shows the goroutines blocked on synchronization, grouped by stack trace. Time is wall-clock blocked, not CPU.
- **Go's mutex profile**: `runtime.SetMutexProfileFraction(1)` enables. Shows time spent waiting specifically on `sync.Mutex` and `sync.RWMutex` (not channels).
- **Go's race detector** (`-race`): not a contention profiler, but it catches the bugs that lead to lock misuse (missing locks, lock order violations) and is the first stop when debugging "weird" behavior.
- **JFR (Java Flight Recorder)**: the `jdk.JavaMonitorEnter` event records lock acquisitions that took more than a threshold (default 10ms). `jdk.JavaMonitorWait` records `Object.wait` blocking. JFR is now part of the JDK and free for production use.

The general protocol: run under representative load, capture for at least 30 seconds, sort by total wait time, look at the top three locks, and ask "can I shrink, shard, or remove this?"

---

## Real-World Analogies

**The toll booth**: a single-lane toll booth on a highway is a mutex. Uncontended (no one ahead) you pay and go through in one second. Contended, you queue. Convoys form when traffic arrives faster than the cashier can process. Priority inversion: an ambulance is stuck behind a tractor, and the cars in the open lanes (medium priority, no toll needed) are zipping by.

**The hospital triage**: the operating room is a critical section. A standard mutex is "first come first served unless an emergency arrives", which is what priority inheritance encodes — the nurse currently in the OR doesn't get bumped out by routine patients while the heart surgeon (high priority) is suiting up.

**The library reading room**: an `RWMutex`. Many readers can sit and read silently (shared lock). When the librarian wants to update a card catalog, everyone must leave (exclusive lock). The trap: if the librarian must check a guestbook on every entry and exit, that guestbook becomes the bottleneck even though the reading is conflict-free.

**The deli counter ticket**: futex queueing. You take a ticket, the display says "now serving 47". You can wander around (parked). When 47 is called, you wake up and walk to the counter. The kernel's wait queue is exactly this — a tagged list of "people interested in this address".

---

## Mental Models

**The mutex as a state machine**. Three states: unlocked, locked-no-waiters, locked-with-waiters. Transitions are CAS operations on a single word. The slow path is entered only on transitions involving "with-waiters". This is the model that explains why uncontended `Unlock` is one atomic store and a branch.

**The futex as a hashed park lot**. The kernel keeps a global hash table indexed by physical address. Multiple unrelated futexes can hash to the same bucket; this is fine because the hash bucket's spinlock serializes access, and the kernel checks the exact address inside. The waiters on a single bucket form a linked list, traversed at wake time.

**The contention curve**. Throughput vs. offered load on a mutex-protected resource. At low load, throughput rises linearly. At a knee, throughput plateaus (you've saturated the critical section). Past the knee, throughput drops because contention overhead eats CPU. The knee is the budget. Knowing where it is for your workload is the difference between architecting for scale and reacting to outages.

**The Amdahl ceiling**. If 5% of work is serialized on a mutex, throughput cannot exceed 20x even with infinite cores. The way to break the ceiling is to reduce that 5% — sharding, lock-free, or eliminating the lock entirely.

---

## Code Examples

### 1. Profiling a contended mutex with Go's pprof

```go
package main

import (
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "runtime"
    "sync"
    "time"
)

type counter struct {
    mu    sync.Mutex
    value int64
}

func (c *counter) Add(n int64) {
    c.mu.Lock()
    // Simulate non-trivial critical section.
    for i := 0; i < 1000; i++ {
        c.value += n
        c.value -= (n - 1)
    }
    c.mu.Unlock()
}

func main() {
    // Enable block profile (sample every blocked event over 1ns).
    runtime.SetBlockProfileRate(1)
    // Enable mutex profile.
    runtime.SetMutexProfileFraction(1)

    go func() {
        // pprof endpoint available at /debug/pprof/.
        http.ListenAndServe("localhost:6060", nil)
    }()

    c := &counter{}
    const workers = 32
    const iterations = 100_000
    var wg sync.WaitGroup
    wg.Add(workers)
    start := time.Now()
    for i := 0; i < workers; i++ {
        go func() {
            defer wg.Done()
            for j := 0; j < iterations; j++ {
                c.Add(1)
            }
        }()
    }
    wg.Wait()
    fmt.Printf("done in %v, value=%d\n", time.Since(start), c.value)
    // Keep the server alive long enough to scrape profiles.
    time.Sleep(60 * time.Second)
}
```

Capture and inspect:

```
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/mutex
go tool pprof -http=:8081 http://localhost:6060/debug/pprof/block
```

The mutex profile attributes wall-clock-blocked time to `(*counter).Add`. The block profile shows the same, generalized over all synchronization primitives.

### 2. Tracing futex syscalls with strace

```
strace -f -e trace=futex -c ./mutex-demo
```

Sample output (counts of `FUTEX_WAIT_PRIVATE`, `FUTEX_WAKE_PRIVATE`):

```
% time     seconds  usecs/call     calls    errors syscall
------ ----------- ----------- --------- --------- ----------------
 72.13    0.041280          27      1503        12 futex
```

For per-call detail, drop `-c`:

```
strace -f -e trace=futex -tt ./mutex-demo 2>&1 | head -50
```

You will see entries like `futex(0x7fff..., FUTEX_WAIT_PRIVATE, 2, NULL) = 0`. The `2` is the expected value (locked-with-waiters). When the kernel returns 0, the thread was woken; non-zero would indicate timeout or signal.

### 3. Priority inversion reproduction (Linux real-time threads)

This is C because POSIX real-time semantics are clearest there.

```c
#define _GNU_SOURCE
#include <pthread.h>
#include <sched.h>
#include <stdio.h>
#include <unistd.h>

static pthread_mutex_t M;

static void *low(void *arg) {
    pthread_mutex_lock(&M);
    printf("L acquired\n");
    sleep(2);                 // simulate long critical section
    printf("L releasing\n");
    pthread_mutex_unlock(&M);
    return NULL;
}

static void *medium(void *arg) {
    sleep(1);                 // start after L
    printf("M running (busy loop)\n");
    while (1) { /* burn CPU */ }
}

static void *high(void *arg) {
    sleep(1);                 // start after L
    printf("H requesting M\n");
    pthread_mutex_lock(&M);
    printf("H acquired\n");
    pthread_mutex_unlock(&M);
    return NULL;
}

int main(void) {
    pthread_mutexattr_t attr;
    pthread_mutexattr_init(&attr);
    // Comment the next line to disable PI and observe inversion.
    pthread_mutexattr_setprotocol(&attr, PTHREAD_PRIO_INHERIT);
    pthread_mutex_init(&M, &attr);

    pthread_t tL, tM, tH;
    struct sched_param pL = {.sched_priority = 10};
    struct sched_param pM = {.sched_priority = 20};
    struct sched_param pH = {.sched_priority = 30};
    pthread_attr_t aL, aM, aH;
    pthread_attr_init(&aL); pthread_attr_setschedpolicy(&aL, SCHED_FIFO);
    pthread_attr_setschedparam(&aL, &pL); pthread_attr_setinheritsched(&aL, PTHREAD_EXPLICIT_SCHED);
    pthread_attr_init(&aM); pthread_attr_setschedpolicy(&aM, SCHED_FIFO);
    pthread_attr_setschedparam(&aM, &pM); pthread_attr_setinheritsched(&aM, PTHREAD_EXPLICIT_SCHED);
    pthread_attr_init(&aH); pthread_attr_setschedpolicy(&aH, SCHED_FIFO);
    pthread_attr_setschedparam(&aH, &pH); pthread_attr_setinheritsched(&aH, PTHREAD_EXPLICIT_SCHED);

    pthread_create(&tL, &aL, low, NULL);
    pthread_create(&tM, &aM, medium, NULL);
    pthread_create(&tH, &aH, high, NULL);
    pthread_join(tH, NULL);
    return 0;
}
```

Without PI, H waits for M to yield, which it never does on `SCHED_FIFO`. With PI, L is boosted to 30 while holding the mutex, preempts M, runs, releases, drops back to 10, and H proceeds. Run as root or with `CAP_SYS_NICE`.

### 4. Reader-writer scaling demonstration in Go

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

type sharedState struct {
    data atomic.Int64
}

func benchMutex(workers int, dur time.Duration) int64 {
    var mu sync.Mutex
    s := &sharedState{}
    var ops atomic.Int64
    stop := time.Now().Add(dur)
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for time.Now().Before(stop) {
                mu.Lock()
                _ = s.data.Load()
                mu.Unlock()
                ops.Add(1)
            }
        }()
    }
    wg.Wait()
    return ops.Load()
}

func benchRWMutex(workers int, dur time.Duration) int64 {
    var mu sync.RWMutex
    s := &sharedState{}
    var ops atomic.Int64
    stop := time.Now().Add(dur)
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for time.Now().Before(stop) {
                mu.RLock()
                _ = s.data.Load()
                mu.RUnlock()
                ops.Add(1)
            }
        }()
    }
    wg.Wait()
    return ops.Load()
}

func main() {
    cpus := runtime.NumCPU()
    fmt.Printf("CPUs=%d\n", cpus)
    for _, w := range []int{1, 2, 4, 8, 16, 32} {
        m := benchMutex(w, time.Second)
        rw := benchRWMutex(w, time.Second)
        fmt.Printf("workers=%2d  Mutex=%10d ops  RWMutex=%10d ops  ratio=%.2f\n",
            w, m, rw, float64(rw)/float64(m))
    }
}
```

Typical result on a many-core machine: `RWMutex` is comparable at one or two workers and becomes 30–60% slower than `Mutex` at high worker counts when the critical section is empty, because the read counter cache line is the bottleneck. Add a `time.Sleep(time.Microsecond)` inside the critical section and the ratio flips: now `RWMutex` is faster because the work amortizes the coherence cost.

---

## Pros & Cons

**Pros of mutex-based concurrency.** Simple to reason about: one lock, one resource, mutual exclusion. Universally available across languages and platforms. Adapts to a wide range of contention patterns through runtime tuning (adaptive spinning, FIFO starvation handoff). Composable with condition variables and other primitives. Debuggable: the race detector, `perf lock`, and JFR all understand it.

**Cons.** A serialization point that ultimately limits throughput by Amdahl's law. Fairness and progress guarantees depend on the implementation (some implementations allow barging, some FIFO). Adds latency even uncontended due to memory fences. Tail latency can be terrible under contention. Lock order discipline is a global property of the codebase, easy to violate. Priority inversion requires explicit handling. Deadlocks are easy to introduce and hard to test for.

---

## Use Cases

- Protecting in-memory data structures shared across threads or goroutines.
- Serializing access to a non-thread-safe library (e.g., many C libraries used from a multi-threaded host).
- Coordinating producer/consumer access to a bounded buffer in combination with condition variables.
- Implementing once-only initialization (`sync.Once`).
- Guarding bookkeeping in higher-level primitives (semaphores, reader-writer locks, channels).

When *not* to use a mutex: data structures with natural sharding (per-CPU counters), append-only writes that can use atomics, immutable structures swapped via pointer CAS, message-passing designs where ownership is transferred rather than shared.

---

## Coding Patterns

**Lock the smallest scope necessary.** Acquire late, release early. Computation outside the lock is free concurrency.

**Encapsulate the lock with its data.** A `struct` that contains both the mutex and the protected fields, with methods that take the lock internally, prevents external code from accessing the fields without the lock. Avoid exporting the mutex.

**Use defer for unlock with caution.** `defer mu.Unlock()` is safe and idiomatic, but adds a small overhead and extends the lock to the end of the function. If the function does additional work after the critical section, prefer explicit `Unlock` to shrink the scope.

**Separate read and write paths.** If reads dominate by an order of magnitude and the critical section is non-trivial, `RWMutex` may help. Benchmark first.

**Use try-lock for opportunistic work.** When a lock failure is acceptable (e.g., background flush that can run later), `TryLock` avoids parking and skips the work. Go added `TryLock` in 1.18 with strong warnings about correctness; use sparingly.

**Sharded locking for hot tables.** Replace one big mutex with `N` mutexes, each protecting a slice of the data (hash-partitioned). The fan-out reduces contention proportional to N.

---

## Clean Code

A mutex is plumbing. Plumbing should be invisible.

- The lock variable is named for the data it protects (`stateMu`, `cacheMu`) or omitted if it is "the" lock of the struct (`mu`).
- Methods that require the lock are private; methods that take the lock are public. The public/private distinction documents the locking convention.
- Comments document invariants, not mechanics. "Holds the lock while iterating buckets" is mechanics; "buckets are stable while any reader is registered" is an invariant.
- Lock acquisition and release are visibly paired. `defer` works. Manual `Unlock` works. Conditionals inside the critical section that may early-return are a smell — restructure.
- Functions that "must be called with the lock held" are documented with that exact phrase at the top of the godoc/javadoc. Better: they are private methods with a name suffix (`fooLocked`).

---

## Best Practices

- Measure before tuning. The Go runtime, the JVM, and glibc all have well-tuned default mutexes. Optimizing without a profile is guessing.
- Choose lock granularity to match contention, not source-code structure. One method, one lock is convenient; one bucket, one lock scales.
- Prefer `sync.Mutex` over `sync.RWMutex` until you have evidence the read path benefits. Benchmark the actual workload.
- Never hold a lock across a blocking operation (I/O, channel receive, network call). The lock is now held for milliseconds; everything else suffers.
- Document lock order. A comment at the top of the file or package: "Order: A before B before C." Enforce in code review.
- Use `sync.Once` for one-shot initialization. Don't reinvent double-checked locking.
- Use try-lock with reservations, not as a default. A `TryLock` that "usually succeeds" is hiding a design problem.
- Run with the race detector in CI. Catch lock omissions before they reach production.
- Add block and mutex profiles to your standard production telemetry. They cost almost nothing at low rates and reveal contention that load tests miss.

---

## Edge Cases & Pitfalls

- **Recursive acquire**. Plain mutexes are not reentrant. Calling `Lock` on a mutex you already hold deadlocks. Refactor to take the lock once at the entry point.
- **Lock copying**. Copying a struct that contains a mutex copies the lock state. The race detector will complain. Use pointers or `noCopy` markers.
- **Lock in a hot path**. A mutex around a single counter increment is wasteful — use an atomic. A mutex around 10 nanoseconds of work has overhead higher than the work itself.
- **Unlocking from a different goroutine**. Some implementations require lock and unlock to happen in the same thread. Go's `sync.Mutex` permits cross-goroutine unlock (it tracks ownership only in the race detector), but it remains a smell.
- **Unlock after panic**. `defer mu.Unlock()` handles this. Manual unlock does not, and a panic leaves the lock held — every subsequent acquire blocks forever.
- **Lost wakeup with condition variables**. Forgetting to hold the mutex while signaling, or checking the predicate without a `while` loop, leads to lost or spurious wakeups. Always: `while (!condition) cond.wait(mu)`.
- **False sharing**. A mutex's state word and adjacent fields share a cache line. If two unrelated mutexes happen to land on the same line, they create coherence traffic. Padding to 64 bytes helps.
- **Trylock starvation**. A thread that loops on `TryLock` instead of `Lock` can starve a waiter that's already queued.

---

## Common Mistakes

- "Add a mutex" as the default response to a race report, without understanding what is racing or whether atomics would suffice.
- Holding a mutex across a network call. The lock becomes a serialization point for upstream latency.
- Using a single global mutex when sharded locks would work. The global lock survives initial load and falls over at scale.
- Believing `RWMutex` is "always faster for reads". It isn't — measure.
- Treating `defer Unlock` as a one-size-fits-all. For tight critical sections in hot paths, manual unlock is faster.
- Forgetting that `sync.Once` uses a mutex internally and can become a contention point if called from many goroutines simultaneously before the first call completes.
- Mixing lock types on the same data — protecting some accesses with one mutex and others with a different one (or no lock). The race detector will save you here.

---

## Tricky Points

- The Go runtime's spin budget for `sync.Mutex` is tuned for typical workloads. On machines with very few cores, or with all Ps busy, it disables spinning. You cannot tune this without modifying the runtime.
- `sync.RWMutex` writer starvation: under continuous read load, a waiting writer might never acquire. Go's implementation switches to writer preference once a writer is queued, mitigating this.
- Futex wake counts can over-deliver. `FUTEX_WAKE` of 1 might wake more than one waiter in rare cases (e.g., if multiple waiters were already racing the spinlock); user-space code must handle spurious wakeups.
- Some `pthread_mutex_t` types (e.g., `PTHREAD_MUTEX_NORMAL`) do not detect self-deadlock and will hang forever. `PTHREAD_MUTEX_ERRORCHECK` returns an error. Debug builds should use errorcheck.
- Java's `synchronized` is a monitor, not a mutex. It uses different runtime mechanisms and historically benefited from biased locking. With biased locking removed, modern `synchronized` performance is close to `ReentrantLock` for uncontended cases.
- Cache line bouncing on the mutex state word is invisible to most profilers. `perf c2c` (cache-to-cache) is the tool that reveals it.

---

## Test Yourself

1. What is the contended-acquire cost (roughly, in nanoseconds) of a `pthread_mutex_t` on modern Linux? The uncontended cost?
2. Why does `FUTEX_WAIT` take an "expected value" argument?
3. What is a lock convoy, and what code change typically fixes it?
4. Walk through the priority inversion in Mars Pathfinder. What primitive would have prevented it?
5. Under what conditions is `sync.RWMutex` slower than `sync.Mutex` in Go?
6. Why is double-checked locking incorrect in Java without `volatile`?
7. How does Go's `sync.Mutex` decide whether to spin or park?
8. What does `perf lock report` show, and what kernel config is required?
9. When is a lock-free queue worse than a mutex-protected ring buffer?
10. Why was JVM biased locking removed?

---

## Tricky Questions

1. You have a service with `p50=2ms`, `p99=200ms`, CPU at 40%. The block profile shows 60% of blocked time on one mutex. What is happening, and what are three orthogonal ways to fix it?
2. A `FUTEX_WAIT` returns successfully but the lock word is still locked. Is this a bug? Why or why not?
3. A goroutine calls `mu.Lock()` and never returns, but no other goroutine appears to hold `mu`. What three causes should you suspect?
4. Your microbenchmark shows `sync.RWMutex` is 50% slower than `sync.Mutex` for an empty critical section with 16 readers. Your production code uses the same `RWMutex` and is fine. Why doesn't the benchmark predict production?
5. A real-time system uses priority-inheriting mutexes and observes occasional unbounded latency. What might be happening?
6. You add a mutex to fix a race; CPU usage drops 20%. What does this tell you?
7. A `TryLock` loop in a hot path causes throughput to collapse on machines with more cores. Explain.
8. Under what conditions can `FUTEX_WAKE(addr, 1)` wake zero threads even though several were waiting on `addr`?

---

## Cheat Sheet

```
Uncontended mutex cost:        ~20-30 ns (single CAS + branch)
Contended mutex cost:          ~1-10 us  (CAS + futex syscall + park/wake)
Context switch cost:           ~1-3 us
Futex hash bucket lock:        spinlock, very short
Go sync.Mutex spin budget:     ~30 PAUSEs * a few iterations
Go starvation threshold:       1 ms in queue -> FIFO handoff mode
Linux PI futex syscalls:       FUTEX_LOCK_PI / FUTEX_UNLOCK_PI
JVM biased locking:            deprecated JDK 15, removed in later
JFR slow-monitor threshold:    default 10 ms
perf lock:                     needs CONFIG_LOCK_STAT
Go block profile rate:         runtime.SetBlockProfileRate(rate)
Go mutex profile fraction:     runtime.SetMutexProfileFraction(rate)
Race detector:                 go build -race / go test -race
Java StampedLock:              optimistic read = no counter write
RCU:                           readers do nothing, writers wait for grace
```

---

## Summary

A senior view of mutexes treats them as a layered system. The bottom layer is hardware atomics and cache coherence: every lock acquire moves a cache line. The middle layer is the futex protocol (or its platform equivalent): user-space fast paths that escalate to kernel waits on contention. The top layer is the language runtime: Go's semaphore trees, the JVM's monitors, glibc's adaptive types. Each layer's design decisions show up in your latency tails.

To work at this level you need to read the futex protocol, recognize contention pathologies (convoys, priority inversion, false sharing), measure with the right tools (`perf lock`, block/mutex profiles, JFR), and choose between alternatives — sharding, lock-free, RCU — based on workload data rather than fashion. The choices are rarely between "mutex" and "no mutex"; they are between "where exactly to put the serialization point so it costs the least".

You should leave this page able to look at a flame graph and say not just "lock contention here" but "this is convoy formation around a single global, fix is bucket-sharding or per-P caches", and to know within an order of magnitude what your mutex is costing in nanoseconds.

---

## What You Can Build

- A contention dashboard for a Go service that exports block and mutex profile metrics to Prometheus.
- A microbenchmark suite that compares `Mutex`, `RWMutex`, atomic-only, and sharded designs on your own data structures.
- A lockdep-style runtime tool for your codebase that detects lock-order cycles in CI.
- A priority-inheriting mutex wrapper for a real-time control loop.
- A sharded cache, hash map, or counter that replaces a contended global lock.
- A research project: implement Treiber's stack, Michael-Scott queue, and a hazard-pointer reclaimer, then benchmark against a mutex-protected baseline.

---

## Further Reading

- Ulrich Drepper, *Futexes Are Tricky* (the canonical paper on what makes futexes correct).
- Rusty Russell, Hubertus Franke, Matthew Kirkwood, *Fuss, Futexes and Furwocks: Fast Userlevel Locking in Linux*.
- Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*.
- Paul McKenney, *Is Parallel Programming Hard, And, If So, What Can You Do About It?* (free book).
- Doug Lea, *The JSR-133 Cookbook for Compiler Writers*.
- Russ Cox, *Hardware Memory Models* and *Programming Language Memory Models* (two essays).
- Linux kernel documentation: `Documentation/locking/futex2.rst` and the `pi-futex.txt` design notes.
- Go runtime source: `runtime/sema.go`, `runtime/lock_futex.go`, `sync/mutex.go`.
- JEP 374: *Deprecate and Disable Biased Locking*.

---

## Related Topics

- [Atomics and Memory Ordering](../../README.md)
- [Reader-Writer Locks](../02-rwmutex/README.md)
- [Condition Variables](../03-condition-variables/README.md)
- [Semaphores](../04-semaphores/README.md)
- [Lock-Free Data Structures](../../03-lock-free/README.md)
- [Go Runtime: Scheduler](../../../../languages/golang/15-go-source-reading/03-runtime-source/README.md)

---

## Diagrams & Visual Aids

```
Mutex state machine:

      [unlocked]
         |  Lock (CAS 0->1)
         v
    [locked, 0 waiters]
         |                              Lock (contended)
         |  CAS 1->2 then FUTEX_WAIT  <----------+
         v                                       |
    [locked, >=1 waiters] ----------------------+
         |
         |  Unlock: CAS 2->0, FUTEX_WAKE 1
         v
      [unlocked]
```

```
Futex fast path vs slow path:

  Thread A: Lock                         Thread B: Lock
    |                                      |
    CAS 0 -> 1   (success)                 CAS 0 -> 1   (fails)
    | (in critical section)                CAS 1 -> 2
    |                                      futex(WAIT, addr, 2)  ---> [kernel]
    |                                                                    |
    Unlock                                                                |  block
    CAS 2 -> 0                                                            |
    futex(WAKE, addr, 1)  ----------------> wakes B  <--------------------+
    |                                      |
    (returns)                              retry CAS 0 -> 1 (success)
```

```
Priority inversion (without PI):

  prio 30: H  -- requests M --> [BLOCKED on M]
  prio 20: M1 -- runs forever ------------------>
  prio 10: L  -- holds M, preempted by M1 ------>

  H waits arbitrarily long, even though L has the lock.

Priority inheritance fix:

  L holds M, H waits on M  ==>  L's effective priority := 30
  M1 (prio 20) cannot preempt L until L releases M.
  L runs, releases M, drops back to prio 10.
  H acquires M and proceeds.
```

```
Lock convoy:

  Time --->
  T1: [lock] CS [unlock]         [lock] CS [unlock]         ...
  T2:        [wait------][lock] CS [unlock]         [wait--][lock]...
  T3:               [wait----------------][lock] CS [unlock]      ...
  T4:                              [wait-----------------][lock]  ...

  Each thread can run only after the previous one parks it again.
  Throughput is one critical section per context switch.
```

```
RWMutex cache-line ping-pong (read-heavy):

  Core 0  RLock -> writes readerCount -> [line Modified on Core 0]
  Core 1  RLock -> must read readerCount -> [line transfers to Core 1]
  Core 2  RLock -> [line transfers to Core 2]
  Core 0  RUnlock -> [line transfers back]
  ...

  The state word is a hot line. Throughput is bounded by coherence, not by code.
```

```
Go sync.Mutex slow path (simplified):

  Lock failed CAS
    |
    spin? (runtime_canSpin)
    |       \
    yes      no
    |        |
    PAUSE x30 -> retry CAS
    |
    still locked: semacquireMutex
       -> place G in semaRoot treap
       -> gopark; M releases P
       ...
  Unlock CAS released
    -> semrelease1: walk treap, pop a waiter
    -> goready: enqueue on a P's run queue
    -> wake M if none spinning
```
