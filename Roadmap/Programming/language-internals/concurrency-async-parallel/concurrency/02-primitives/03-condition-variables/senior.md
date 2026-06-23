# Condition Variables — Senior Level

> **Topic:** [Condition Variables](README.md)
> **Focus:** futex internals, performance, alternatives, hand-coded waitsets

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

At the junior level, a condition variable is a black box: you call `wait`,
the thread sleeps; you call `signal`, a thread wakes. At the middle level,
you understand spurious wakeups, predicates, and the canonical loop. At
the senior level, you stop seeing the condition variable as a primitive
at all — you see a thin wrapper over a kernel object (the **futex** on
Linux, the **wait address** on Windows, the **dispatch queue** on
Darwin) and you start asking different questions: How many cache lines
does a broadcast touch? Does my workload actually benefit from waiting,
or am I paying for a syscall I could amortize? Would a bounded queue
serve me better? Could I use `LockSupport.park` and a custom waitset?

This document is the engineer's tour. We open up glibc's `pthread_cond_t`,
follow the bytes through `futex(2)`, walk through the **requeue trick**
that makes `broadcast` not catastrophic, profile a contended broadcast
storm, compare a hand-rolled producer/consumer against
`LinkedBlockingQueue`, and explain why idiomatic Go code almost never
uses `sync.Cond`. By the end you will know when to reach for a condvar,
when to reach for a channel, and when to reach for nothing at all.

The senior posture is not "more condition variables". It is **fewer,
better-placed condition variables, and a clear-eyed picture of what they
cost.**

---

## Prerequisites

Before reading this senior treatment, you should be solid on:

- **Junior:** What a condvar does and the `while (!predicate) wait()` loop.
- **Middle:** Spurious wakeups, signal vs broadcast, monitor coupling
  with a mutex, the lost-wakeup problem.
- **Memory model:** Acquire/release semantics, happens-before, why the
  mutex around a condvar provides the publication barrier.
- **Linux primitives:** `futex(2)` syscall, wait/wake/requeue operations,
  the idea that the kernel uses the address of an `int` as a key.
- **Profiling:** `perf`, `strace`, contention counters, off-CPU profiling
  with eBPF or `perf sched`.
- **Posix and Java APIs:** `pthread_cond_t`, `java.util.concurrent.locks
  .Condition`, `LockSupport.park/unpark`.

If any of those feels shaky, return to the middle-level page and the
mutex internals page first. The material here will reference them
without re-deriving.

---

## Glossary

- **Futex:** Fast Userspace muTEX. A Linux syscall that lets userspace
  manage a wait queue keyed by a memory address; the kernel only gets
  involved on contention.
- **FUTEX_WAIT:** Atomically check `*addr == expected` and sleep if true.
- **FUTEX_WAKE:** Wake up to N waiters parked on `addr`.
- **FUTEX_CMP_REQUEUE:** Wake one waiter on `addr1` and **move** the
  rest from `addr1`'s queue to `addr2`'s queue without waking them.
- **Wait morphing / requeue trick:** Use `FUTEX_CMP_REQUEUE` so a
  broadcast moves waiters from the condvar's queue to the mutex's queue,
  preventing the **thundering herd** on the mutex.
- **Thundering herd / mutex stampede:** Many threads wake simultaneously,
  all try to acquire the same mutex, and most go back to sleep —
  wasting context switches.
- **Stampede counter:** `__g1_orig_size` and friends — glibc's internal
  generation counters that order signals against waits.
- **Generation counter:** A monotonically increasing integer used to
  distinguish "the signal that woke me" from "a stale signal from
  before I started waiting".
- **Cache line ping-pong:** Multiple CPUs writing to the same cache line,
  causing constant cache coherency traffic.
- **Park / unpark:** Java's low-level "block this thread until told
  otherwise" primitive, exposed via `java.util.concurrent.locks.LockSupport`.
- **Waitset:** The data structure (often a linked list) that tracks
  blocked threads — what a condvar wraps.
- **LBQ:** `java.util.concurrent.LinkedBlockingQueue`, a battle-tested
  bounded/unbounded BlockingQueue.

---

## Core Concepts

### 1. Futex-backed condition variable implementation (glibc, musl)

A modern `pthread_cond_t` on Linux is not a kernel object. It is a small
struct of integers in user memory plus a few `futex` syscalls. The
kernel knows nothing about "condition variables" — only about wait
queues keyed by an address.

The simplified layout (real glibc has more fields for fairness and
shared mappings):

```c
struct __pthread_cond_s {
    uint64_t __wseq;          // wait sequence — incremented on each wait
    uint64_t __g1_start;      // start of group 1 (the one being signaled)
    unsigned int __g_refs[2]; // futex addresses, one per group
    unsigned int __g_size[2]; // remaining waiters in each group
    unsigned int __g1_orig_size;
    unsigned int __wrefs;     // total waiters + refcount bits
    unsigned int __g_signals[2];
};
```

The trick that makes glibc's condvar correct under broadcast and signal
is **dual groups**. Waiters arriving "now" join G2. When a signal or
broadcast happens, the implementation closes G1 (drains it) and rotates
G2 into G1. This means a `signal` cannot accidentally wake a thread
that called `wait` after the signal returned — the generation counter
keeps them in G2.

**Why this matters:** Earlier glibc versions had subtle ordering bugs
under broadcast that were not fixed until 2016 (bug 13165). The
"new condvar" landed in glibc 2.25. If you read pre-2.25 documentation
you will see a different algorithm. The takeaway: condvars are hard
even for the people who write libc.

musl takes a simpler path with a single counter and accepts slightly
more wakeups in exchange for simpler code. Both are correct; the
trade-off is throughput under heavy broadcast.

### 2. The `futex_requeue` trick used by `pthread_cond_broadcast`

A naive `broadcast` would wake every waiter with `FUTEX_WAKE`. All of
them would race for the mutex. N-1 would lose, go back to sleep, and
the kernel would have done N context switches to make 1 thread useful.
This is the **mutex stampede**.

The fix: `FUTEX_CMP_REQUEUE`. The kernel wakes **one** waiter from the
condvar's queue and **moves** the rest to the mutex's wait queue
without waking them. As the first thread releases the mutex, the next
one (already queued on the mutex) is woken normally — one wake per
useful unit of work.

```
broadcast()
   |
   v
FUTEX_CMP_REQUEUE(cond_addr -> mutex_addr, wake=1, requeue=INT_MAX)
   |
   +-- wake 1 thread on cond_addr (it will try to lock mutex)
   +-- move the rest from cond_addr's queue to mutex_addr's queue
       (they stay parked, just on a different key)
```

This is one of the most beautiful pieces of systems engineering in
modern kernels. It turns an O(N) wake into an O(1) wake plus an O(N)
metadata move — and the metadata move never enters userspace.

### 3. Why broadcast on a single condvar can stampede the mutex

Even with requeue, broadcast is not free:

- Every requeued thread will, eventually, fight for the mutex.
- If the predicate is only satisfiable for one of them, N-1 will
  acquire, check the predicate, fail, and wait again.
- That means N lock/unlock cycles and N condvar reinserts.

**Rule:** Use `broadcast` only when the predicate change can satisfy
multiple waiters. For "one slot freed in a bounded queue", use
`signal`. For "the producer is done and everyone should observe EOF",
use `broadcast`.

A surprisingly common bug: a thread pool with one shared condvar,
broadcast on every task submission. With 64 worker threads, every
submit causes 64 wakeups, 64 lock acquisitions, 63 failed predicate
checks, 63 re-waits. Throughput collapses past 16 cores.

### 4. When to use channels/queues instead of condvars (Go, Rust)

In Go, the idiomatic concurrency primitive is the **channel**. A
buffered channel with `<-` is operationally equivalent to a
bounded queue with internal condition variables, but with a syntax
that makes lost-wakeup bugs nearly impossible to write.

```go
// Idiomatic Go: no condvar in sight.
ch := make(chan Job, 64)
// producer
ch <- job
// consumer
for job := range ch {
    handle(job)
}
```

Go does ship `sync.Cond`, but the standard library team has
[publicly said](https://github.com/golang/go/issues/21165) it is rarely
the right tool, and the Go runtime team has at times considered
deprecating it. The reasons:

- It is easy to misuse (lost-wakeup, missing the `for` loop).
- Goroutines are cheap, so "block one goroutine per condition" via a
  channel is fine.
- The runtime's scheduler is aware of channels and can do tricks
  (direct hand-off) that `sync.Cond` cannot.

In Rust, `std::sync::mpsc` and `crossbeam-channel` cover most cases.
`std::sync::Condvar` exists but the type system makes you carry the
predicate through `Mutex<T>`, which already nudges you toward queues.

The senior heuristic: **if the predicate is "there is an item in a
queue", use a queue.** Reach for a condvar only when the predicate is
genuinely arbitrary ("the global config version has advanced", "the
checkpoint coordinator has reached state X").

### 5. The cost: cache line ping-pong of the condvar's internal counter

Every `signal`, `broadcast`, and `wait` writes to the condvar's
sequence counters. These counters live in one or two cache lines. With
many CPUs operating on the same condvar, those lines bounce between
caches constantly.

Profile with `perf c2c` (cache-to-cache):

```
$ perf c2c record ./my_program
$ perf c2c report

Shared Cacheline Distribution Pareto Table
=============================================
HITM  Total  Source                              Line
 87%   42k   pthread_cond_signal                 nptl/pthread_cond_signal.c:74
```

87% of cache-line hits in HITM state (modified-elsewhere) on the
condvar's sequence field is a smoking gun. Solutions:

- **Shard the condvar:** one condvar per shard of work, reducing
  contention.
- **Use a queue:** the queue's slot pointers naturally distribute writes.
- **Switch to `LockSupport.park`/`unpark`** (Java) and a per-thread
  parking flag, so each waiter touches a different cache line.

### 6. Java's `LockSupport.park`/`unpark` as a lower-level primitive

`java.util.concurrent.locks.LockSupport` is the closest thing in the JVM
to a raw futex. It exposes:

```java
LockSupport.park();             // block this thread until unparked
LockSupport.parkNanos(nanos);   // block with timeout
LockSupport.unpark(thread);     // wake a specific thread
```

Critical properties:

- **`unpark` is sticky:** if `unpark(t)` is called before `t` calls
  `park`, the next `park` returns immediately. This eliminates the
  lost-wakeup window that plagues raw condvars.
- **No mutex required:** `park`/`unpark` operates on the thread itself,
  not a shared address. You build your own waitset.
- **Per-thread:** `unpark` targets a specific thread, not "anyone
  waiting on this object". That means O(1) targeted wakeups.

Every queue in `java.util.concurrent` — `LinkedBlockingQueue`,
`SynchronousQueue`, `ArrayBlockingQueue`, `LinkedTransferQueue` — is
built on `park`/`unpark`, not on `Object.wait()` or `Condition.await()`.

### 7. Hand-coded waitsets in lock-free libraries

When you write a high-performance queue (e.g. `LinkedTransferQueue`,
Disruptor, JCTools queues), you do not use a condvar. You build a
**waitset** explicitly:

```
1. Producer publishes an item (lock-free CAS or write).
2. If the item required a slot and a consumer was registered, call
   LockSupport.unpark(consumer.thread).
3. Consumer enqueues itself on a waitset node, publishes "I am parked",
   re-checks the predicate (memory-fence dance), then LockSupport.park().
```

The advantages over a condvar:

- No mutex held during the wait — producers can publish concurrently.
- O(1) targeted wakeup — no "wake all and let one win".
- Cache-friendly — each waiter touches its own node, not a shared
  counter.

The disadvantages:

- You must hand-roll the publication memory fence and the re-check.
- Subtle ABA bugs around node reuse.
- Hard to review; only reach for this in proven hot paths.

### 8. Building a producer/consumer with `LinkedBlockingQueue` (Java) — when stdlib beats hand-rolled condvar

The naive Java implementation of a bounded queue uses a `ReentrantLock`
and two `Condition`s — `notFull` and `notEmpty`. It works. It is
correct. It is also slower than `LinkedBlockingQueue` because:

- LBQ uses **two separate locks** — one at the head, one at the tail.
  Producers and consumers do not contend.
- LBQ uses **atomic size counters**, so size checks can skip the lock
  in the fast path.
- LBQ is **battle-tested** under every JVM bug, every OS, every
  generation of hardware. Your hand-rolled version is not.

The senior decision is rarely "should I write a condvar pattern". It is
"should I take the LBQ in my standard library, or do I have a measured
reason to write something else". The measured reason had better be
benchmarks, not vibes.

### 9. Profiling condvar contention

Tools that reveal condvar pain:

- **`perf lock`** (Linux): shows lock and condvar contention statistics.
- **`perf sched`** + `perf timechart`: visualizes off-CPU time per
  thread; long off-CPU regions on a condvar are visible immediately.
- **`bpftrace` / `bcc`**: trace `futex` syscalls with stack traces.
- **JVM:** `async-profiler` in wall-clock mode shows time spent in
  `Object.wait` / `Condition.await` per call site.
- **`pidstat -d -w`**: voluntary context switches per thread; a thread
  with 100k+ voluntary switches per second is almost certainly bouncing
  on a condvar.

Look for the signatures:

| Signature                        | Likely cause                       |
| -------------------------------- | ---------------------------------- |
| High futex syscalls, low CPU     | Broadcast storm                    |
| One waiter, low futex syscalls   | Healthy or no work                 |
| `HITM` on cond struct cacheline  | Cache ping-pong, shard or queue    |
| Long off-CPU on `pthread_cond_*` | Predicate transitions are rare     |
| Many threads woken, one works    | Use `signal` instead of `broadcast`|

### 10. Real-world bugs: lost wakeup, missed predicate transition

Two recurring production incidents:

**Lost wakeup** (already covered at middle level, but seen here in
shipped code):

```c
// BUG: signal happens between predicate check and wait.
if (queue.empty()) {
    pthread_cond_wait(&cv, &mu);
}
```

If the producer signals between `empty()` and `wait()`, the consumer
sleeps forever. Fix: hold the mutex the entire time, use `while`
instead of `if`.

**Missed predicate transition:** the predicate flips from false to
true and back to false between signal and wakeup.

```c
// Producer
pthread_mutex_lock(&mu);
queue.push(item);
pthread_cond_signal(&cv);
pthread_mutex_unlock(&mu);

// Meanwhile a second consumer drains the queue.

// Original consumer wakes, sees empty queue, goes back to wait.
// No bug — but a profiler will show high "useless wakeup" rate.
```

This is not incorrect, but at scale it is a waste. A bounded queue
with a single consumer would avoid it.

### 11. Why Go does not bless `sync.Cond` in idiomatic code

The Go documentation for `sync.Cond` literally says (paraphrasing):
"In most cases, a channel is preferable." Rob Pike's mantra "Do not
communicate by sharing memory; share memory by communicating" is the
philosophical version. The mechanical reasons:

- `sync.Cond` does not integrate with the Go scheduler's hand-off
  optimizations.
- The `for predicate { c.Wait() }` pattern is easy to get wrong; a
  channel `<-` does the loop for you.
- Cancellation via `context.Context` is awkward — you need an extra
  goroutine to call `c.Broadcast()` on cancel.

When Go code does need cond-like behaviour, the idiom is a channel of
struct{}, broadcast by closing it:

```go
done := make(chan struct{})
// "broadcast"
close(done)
// "wait"
<-done
```

This pattern handles single-shot broadcast cleanly. For repeated
broadcasts, generate a new channel each time and publish it via a
`sync/atomic.Value`.

---

## Real-World Analogies

- **Air traffic control vs. radio broadcast.** A condvar broadcast is
  the tower yelling "everyone check the runway". Every pilot wakes up,
  most check, see they are not cleared to land, and go back to a
  holding pattern. The futex requeue trick is the tower instead saying
  "you, plane 7, land now; everyone else, queue at the next ATC
  channel" — one wakeup, the rest stay parked but on the right queue.
- **Email vs. office PA.** A targeted `LockSupport.unpark(thread)` is
  email. A `broadcast` is the office PA system. Use email by default.
- **Restaurant order ticker vs. shouting "order up".** A blocking
  queue is the order ticker — clean, ordered, one consumer pulls one
  ticket. Condvars with broadcast are the line cook shouting "order
  up" and every server racing to claim it.
- **Generation counters as version stamps.** The `__wseq` field is a
  document version number. A waiter records "I started waiting at
  version 7", a signaler bumps to version 8. The version comparison
  makes "did the event I am waiting for already happen" decidable.

---

## Mental Models

**Model 1: Condvar = wait address + generation counter.** Everything
else (broadcast, signal, requeue) is bookkeeping to manage one address
and one counter correctly.

**Model 2: Mutex stampede is the default; requeue is the fix.** Always
ask "how many threads wake when I signal, and how many can actually do
work?" If those numbers do not match, you have inefficiency.

**Model 3: Wait-set granularity is the design knob.** One condvar per
million tasks is bad. One condvar per worker is fine. The unit of
parking should be the unit of "this exact thread has work".

**Model 4: Queues and channels are condvars with the predicate baked in.**
"Is the queue non-empty" is such a common predicate that languages
ship it as a primitive. Use the primitive.

**Model 5: Park/unpark is the assembly language; condvar is the high-
level API.** Park is more flexible but easier to corrupt. Build the
high-level API only when the standard one does not exist or has
measured overhead.

---

## Code Examples

### Example 1: glibc cond var implementation walkthrough (annotated)

This is a simplified version of `pthread_cond_wait` from glibc 2.34,
focusing on the structure. It is not meant to compile — read it as a
specification.

```c
int __pthread_cond_wait(pthread_cond_t *cond, pthread_mutex_t *mutex) {
    // 1. Increment wait sequence and join group G2.
    uint64_t wseq = atomic_fetch_add(&cond->__wseq, 2);
    unsigned int g = wseq & 1;             // group index (0 or 1)
    uint64_t seq = wseq >> 1;
    atomic_fetch_add(&cond->__g_size[g], 1);

    // 2. Bump waiter refcount so destroyers wait for us.
    atomic_fetch_add(&cond->__wrefs, 8);   // +1 in upper bits

    // 3. Release the mutex (publish that we are about to wait).
    pthread_mutex_unlock(mutex);

    // 4. Wait on our group's futex address.
    while (true) {
        unsigned int signals = atomic_load(&cond->__g_signals[g]);
        if (signals & 1) break;            // group closed -> wakeup
        if (signals >= 2) {                // signal available
            if (atomic_compare_exchange(&cond->__g_signals[g],
                                        signals, signals - 2)) {
                break;                     // consumed a signal
            }
            continue;                      // retry
        }
        // No signal yet. Sleep on the futex.
        futex_wait(&cond->__g_signals[g], signals);
    }

    // 5. Decrement group size; if last, allow group rotation.
    if (atomic_fetch_sub(&cond->__g_size[g], 1) == 1) {
        // last in this group; signaler may now rotate G2 -> G1
        futex_wake(&cond->__g_refs[g], INT_MAX);
    }

    // 6. Drop waiter refcount.
    atomic_fetch_sub(&cond->__wrefs, 8);

    // 7. Reacquire the mutex.
    pthread_mutex_lock(mutex);
    return 0;
}
```

Key takeaways:

- The condvar maintains **two groups** for ordering correctness.
- `__g_signals[g]` is the futex address. Its lowest bit means "group
  closed"; higher bits count available signals.
- The waiter does not own the mutex during `futex_wait` — that is the
  publication window the signaler needs.
- Generation correctness comes from `wseq`. A late signal cannot wake a
  future waiter because the future waiter is in a different group.

### Example 2: Profiling a broadcast storm

A worker pool with a single shared cond var. We will profile it and
fix it.

```c
// broadcast_storm.c — compile: gcc -O2 -pthread broadcast_storm.c -o storm
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdatomic.h>

#define WORKERS 64
#define TASKS 200000

typedef struct {
    int *buf;
    int head, tail, count, cap;
    pthread_mutex_t mu;
    pthread_cond_t cv;     // ONE cond var for all workers — bad
    int shutdown;
} pool_t;

static atomic_long g_done;

void pool_init(pool_t *p, int cap) {
    p->buf = calloc(cap, sizeof(int));
    p->head = p->tail = p->count = 0;
    p->cap = cap;
    pthread_mutex_init(&p->mu, NULL);
    pthread_cond_init(&p->cv, NULL);
    p->shutdown = 0;
}

void submit(pool_t *p, int task) {
    pthread_mutex_lock(&p->mu);
    while (p->count == p->cap) pthread_cond_wait(&p->cv, &p->mu);
    p->buf[p->tail] = task;
    p->tail = (p->tail + 1) % p->cap;
    p->count++;
    pthread_cond_broadcast(&p->cv);   // BUG: should be signal
    pthread_mutex_unlock(&p->mu);
}

int take(pool_t *p) {
    pthread_mutex_lock(&p->mu);
    while (p->count == 0 && !p->shutdown)
        pthread_cond_wait(&p->cv, &p->mu);
    if (p->count == 0) { pthread_mutex_unlock(&p->mu); return -1; }
    int v = p->buf[p->head];
    p->head = (p->head + 1) % p->cap;
    p->count--;
    pthread_cond_broadcast(&p->cv);   // BUG: should be signal
    pthread_mutex_unlock(&p->mu);
    return v;
}

void *worker(void *arg) {
    pool_t *p = arg;
    int t;
    while ((t = take(p)) >= 0) {
        // simulate work
        atomic_fetch_add(&g_done, 1);
    }
    return NULL;
}

int main(void) {
    pool_t p; pool_init(&p, 256);
    pthread_t threads[WORKERS];
    for (int i = 0; i < WORKERS; i++)
        pthread_create(&threads[i], NULL, worker, &p);

    for (int i = 0; i < TASKS; i++) submit(&p, i);

    pthread_mutex_lock(&p.mu);
    p.shutdown = 1;
    pthread_cond_broadcast(&p.cv);
    pthread_mutex_unlock(&p.mu);

    for (int i = 0; i < WORKERS; i++) pthread_join(threads[i], NULL);
    printf("done=%ld\n", atomic_load(&g_done));
    return 0;
}
```

Profile:

```
$ perf stat -e context-switches,cs,migrations ./storm
[...]
   1,234,567,890   context-switches
       6,543,210   migrations

# Way more context switches than tasks. Broadcast storm confirmed.
$ perf record -g ./storm && perf report
# Top function: __pthread_cond_broadcast (45%), futex_wait_setup (22%).
```

Fix: change both `broadcast` calls to `signal`. Re-measure:

```
$ perf stat -e context-switches ./storm_fixed
      210,432   context-switches    # roughly 1 per task, not 64
```

A 1000x reduction in context switches by changing one word.

### Example 3: `LinkedBlockingQueue` vs hand-rolled condvar benchmark (Java, JMH)

```java
// build with JMH: org.openjdk.jmh
import java.util.concurrent.*;
import java.util.concurrent.locks.*;
import org.openjdk.jmh.annotations.*;

@State(Scope.Benchmark)
@BenchmarkMode(Mode.Throughput)
public class QueueBench {

    static class HandRolled<T> {
        private final Object[] buf;
        private int head, tail, count;
        private final ReentrantLock lock = new ReentrantLock();
        private final Condition notFull  = lock.newCondition();
        private final Condition notEmpty = lock.newCondition();
        HandRolled(int cap) { buf = new Object[cap]; }
        void put(T x) throws InterruptedException {
            lock.lock();
            try {
                while (count == buf.length) notFull.await();
                buf[tail] = x; tail = (tail + 1) % buf.length; count++;
                notEmpty.signal();
            } finally { lock.unlock(); }
        }
        @SuppressWarnings("unchecked")
        T take() throws InterruptedException {
            lock.lock();
            try {
                while (count == 0) notEmpty.await();
                Object x = buf[head];
                head = (head + 1) % buf.length; count--;
                notFull.signal();
                return (T) x;
            } finally { lock.unlock(); }
        }
    }

    HandRolled<Integer> hand;
    LinkedBlockingQueue<Integer> lbq;

    @Setup
    public void setup() {
        hand = new HandRolled<>(1024);
        lbq  = new LinkedBlockingQueue<>(1024);
    }

    @Benchmark
    @Threads(8)
    @Group("hand")
    public void handPut() throws Exception { hand.put(1); }

    @Benchmark
    @Threads(8)
    @Group("hand")
    public Integer handTake() throws Exception { return hand.take(); }

    @Benchmark
    @Threads(8)
    @Group("lbq")
    public void lbqPut() throws Exception { lbq.put(1); }

    @Benchmark
    @Threads(8)
    @Group("lbq")
    public Integer lbqTake() throws Exception { return lbq.take(); }
}
```

Typical results on a 16-core machine (your numbers will vary):

```
Benchmark             Mode  Cnt  Score   Error  Units
QueueBench.hand:put   thrpt   5  3.2M           ops/s
QueueBench.hand:take  thrpt   5  3.2M           ops/s
QueueBench.lbq:put    thrpt   5  5.8M           ops/s
QueueBench.lbq:take   thrpt   5  5.8M           ops/s
```

LBQ wins by roughly 80% because it splits the head/tail locks. The
hand-rolled version contends on a single lock; producers and consumers
serialize. Even with a "correct" condvar implementation, the
architectural choice (single lock vs two) dominates.

### Example 4: Java `LockSupport.park`/`unpark`

A minimal one-shot event that does not use `Object.wait` or `Condition`:

```java
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.LockSupport;

public final class OneShot {
    private static final Object DONE = new Object();
    private final AtomicReference<Object> state = new AtomicReference<>();

    /** Block until {@link #fire} is called. Safe to call before fire. */
    public void await() {
        Thread me = Thread.currentThread();
        // Try to register self.
        while (true) {
            Object s = state.get();
            if (s == DONE) return;             // already fired
            if (state.compareAndSet(null, me)) break;
            // Another thread is parked already? OneShot is single-waiter
            // by design; throw if misused.
            if (s instanceof Thread)
                throw new IllegalStateException("multi-waiter");
        }
        // Park loop. park() may return spuriously; re-check state.
        while (state.get() != DONE) {
            LockSupport.park(this);
            if (Thread.interrupted())
                throw new RuntimeException("interrupted");
        }
    }

    public void fire() {
        Object prev = state.getAndSet(DONE);
        if (prev instanceof Thread t) LockSupport.unpark(t);
        // unpark is sticky: even if t calls park later, it returns
        // immediately. No mutex, no condvar.
    }
}
```

Try:

```java
OneShot s = new OneShot();
Thread t = new Thread(() -> { s.await(); System.out.println("fired!"); });
t.start();
Thread.sleep(100);
s.fire();
t.join();
```

This is roughly 5-10x faster than the equivalent `Object.wait` /
`Object.notify` pattern because there is no monitor lock acquisition.
It is also harder to reason about — note the spurious-park check, the
interruption handling, the misuse guard. The senior lesson: drop down
to `park`/`unpark` only when you have measured a real bottleneck.

---

## Pros & Cons

**Pros (when used correctly):**

- Universal: every POSIX, every JVM, every modern language.
- Cheap on the uncontended fast path (futex stays in userspace).
- Composes naturally with mutexes.
- Generation counters give strong ordering guarantees.

**Cons (when used carelessly):**

- Broadcast can stampede the mutex without `FUTEX_CMP_REQUEUE`.
- Cache line ping-pong on the internal counter under heavy contention.
- Lost-wakeup bugs and missed-transition wakeups are easy to write.
- The `wait`/`signal` API does not compose with cancellation cleanly.
- `signal` does not say which waiter wakes — you cannot do targeted
  wakeups without dropping to `park`/`unpark`.

---

## Use Cases

Use a condition variable when:

1. **Arbitrary predicate** — "config version > X", "checkpoint phase
   reached", "all subordinate workers done". A queue does not model
   this directly.
2. **Coarse-grained coordination** — a few threads, infrequent signals,
   correctness over throughput.
3. **You are implementing a higher-level primitive** — a fork/join
   pool, a custom BlockingQueue, a graph executor.
4. **Predicate is multi-dimensional** — "queue is non-empty AND we are
   not paused AND budget remains".

Prefer a queue or channel when:

1. **The predicate is "an item is available."**
2. **You are in Go.** Use channels unless you have a measured reason
   not to.
3. **You need cancellation** via `context.Context` or
   `CancellationToken`.
4. **You can tolerate the queue's memory overhead.**

Prefer `park`/`unpark` when:

1. You are building a lock-free data structure with rare blocking.
2. You need targeted wakeups (specific thread, not "any waiter").
3. You have profiled the condvar's cache pressure and it is a top hit.

---

## Coding Patterns

**Pattern: signal vs broadcast decision table.**

| Predicate change                  | Use         |
| --------------------------------- | ----------- |
| One unit of work added            | `signal`    |
| All work done; shutdown announced | `broadcast` |
| State transition multiple kinds   | `broadcast` |
| Queue slot freed                  | `signal`    |
| Configuration version bumped      | `broadcast` |

**Pattern: sharded condvars.**

Instead of one condvar for N workers, give each worker its own
condition / waitset. Producer chooses which to wake (round-robin or
work-stealing). This eliminates broadcast storms structurally.

**Pattern: closed-channel broadcast (Go).**

```go
type Event struct{ ch chan struct{} }
func New() *Event { return &Event{ch: make(chan struct{})} }
func (e *Event) Wait()    { <-e.ch }
func (e *Event) Trigger() { close(e.ch) }
```

**Pattern: park-based waitset.**

Each blocked thread enqueues a node containing its Thread reference.
Producer pops a node, calls `LockSupport.unpark(node.thread)`. No
mutex, O(1) wakeup. Used by `LinkedTransferQueue`.

**Pattern: deadline + monotonic clock.**

Always use the OS monotonic clock for cond var timeouts. Wall-clock
time can jump backward (NTP) and cause infinite waits.

---

## Clean Code

- **Name your condvars after the predicate.** Not `cv1`, but
  `not_empty`, `slot_available`, `config_updated`.
- **Comment the predicate inline.** The `while` loop should reference
  the predicate by name.
- **Encapsulate.** Never expose a raw `pthread_cond_t` or `Condition`
  to callers; wrap it in a `BlockingQueue` or `Event` that enforces
  the protocol.
- **Pair every condvar with exactly one mutex.** Document this in the
  type that owns them.
- **Document the signal/broadcast choice.** A code comment "signal
  because only one waiter can proceed" prevents the next maintainer
  from "fixing" it to broadcast.

---

## Best Practices

1. **Default to a queue.** Reach for a condvar only when the predicate
   does not map cleanly to "items available".
2. **Use `signal` by default; broadcast only when justified.**
3. **Use the standard library's queue.** Hand-rolled is almost never
   faster after benchmarking honestly.
4. **Profile under load** before declaring victory. The cost of a
   wrong choice scales with thread count.
5. **Beware static condvars.** A `pthread_cond_t` at file scope shared
   across modules is an anti-pattern; ownership is unclear.
6. **Monotonic clock for timeouts.** Always.
7. **Test the lost-wakeup race** with stress tests, not unit tests.
   Run for hours, not seconds.
8. **Document the invariants** the condvar protects, not just its
   syntax.

---

## Edge Cases & Pitfalls

- **Destroying a condvar with waiters.** UB on POSIX; glibc protects
  this via `__wrefs` but you should not rely on it.
- **Signaling without holding the mutex.** Allowed by POSIX but causes
  missed wakeups in practice and prevents the requeue optimization.
- **`pthread_cond_timedwait` with `CLOCK_REALTIME`.** Default on older
  glibc; explicitly use `pthread_condattr_setclock(CLOCK_MONOTONIC)`.
- **Mutex held by a different thread when signaling.** Allowed, but
  defeats the requeue optimization — the kernel cannot move waiters
  to a mutex queue if the lock is not held.
- **Spurious wakeups in CI.** Real on all real systems. Run your tests
  on real hardware, not just in a single-threaded simulator.
- **Java `Object.notify` vs `notifyAll`.** Same trade-off as
  `signal`/`broadcast` but without requeue — Java pre-6 had a thundering
  herd on every `notifyAll`.
- **Re-entry through condvar wait.** If your wait predicate calls into
  user-supplied callbacks, those callbacks might re-enter your
  monitor and deadlock.

---

## Common Mistakes

1. **Using `if` instead of `while`** around the wait. Even after a decade
   of warnings, this still appears in PRs.
2. **Broadcast for "wake one"** because "it's safer". It is correct but
   1000x slower.
3. **Multiple condvars on one mutex without a coordination contract.**
   Allowed but easy to mis-signal.
4. **Calling `signal` outside the mutex** "for speed". Defeats the
   requeue optimization and risks lost wakeups.
5. **Treating condvar as a counter.** `signal` does not stack; calling
   it 5 times with no waiters does not wake the next 5 waiters.
6. **Forgetting to also signal on cancellation/shutdown.** Threads
   waiting forever.
7. **Re-using a condvar after destroying it.** Some implementations
   allow this; none promise it.
8. **Sharing a condvar across processes** without `pthread_condattr_setpshared`
   and a shared memory mapping.

---

## Tricky Points

- **Requeue requires the mutex address to be a futex word.** On
  platforms where the mutex is more elaborate (e.g. PI mutexes for
  realtime), requeue may be disabled. Profile accordingly.
- **Generation counter rollover.** `__wseq` is 64-bit and will not
  wrap in any practical lifetime, but on 32-bit platforms with a
  32-bit wseq, you can theoretically wrap. Glibc handles this; your
  hand-rolled imitation may not.
- **`futex(2)` vs `futex_waitv(2)`.** The newer `futex_waitv` lets you
  wait on multiple addresses; condvars do not use it yet, but some
  custom waitset libraries do.
- **`pthread_cond_signal` may wake more than one.** Permitted by POSIX
  ("at least one"). Most implementations wake exactly one, but your
  code must not rely on it.
- **Memory model.** The mutex acquire on the waker's side and release
  on the waiter's side provides the happens-before. Signaling without
  the mutex breaks this on some weakly ordered architectures (ARMv8
  before LSE, Power).

---

## Test Yourself

1. Why does `pthread_cond_broadcast` use `FUTEX_CMP_REQUEUE` instead
   of `FUTEX_WAKE` with a large count?
2. What is the dual-group design in glibc's condvar and what problem
   does it solve?
3. Why is `LockSupport.unpark` sticky, and how does this help avoid
   lost wakeups?
4. Under what conditions does `pthread_cond_signal` wake more than
   one thread?
5. Why does Go's standard library de-emphasize `sync.Cond`?
6. How would you measure that your condvar is causing cache-line
   ping-pong?
7. When is broadcast cheaper than N signals?
8. Why do `LinkedBlockingQueue` and `ReentrantLock+Condition`
   benchmark differently for producer/consumer workloads?
9. What is the difference between `FUTEX_WAKE` and `FUTEX_WAKE_OP`?
10. What does it mean to "build a waitset by hand", and when is it
    worth it?

---

## Tricky Questions

1. **A broadcast wakes 64 threads, all check the predicate, 63 fail
   and re-wait. Throughput is poor. Your "fix" is to switch to
   signal. Why might that be wrong?** *(Answer: because the predicate
   change satisfies multiple waiters — e.g. a chunk of data arrived,
   not just one item. The correct fix is to issue N signals instead of
   one broadcast, or to redesign the queue so each waiter waits on its
   own slot.)*

2. **You replace a condvar with a channel. CPU goes down but tail
   latency p99 goes up. Why?** *(Channels in Go schedule via the
   runtime's goroutine queues, which can introduce extra context
   switches for low-frequency wakeups. The condvar bypasses this. For
   p99 you might need a buffered channel, GOMAXPROCS tuning, or
   `runtime.LockOSThread`.)*

3. **You design a system with one condvar per shard. A producer
   sometimes does not know which shard the work belongs to and so
   broadcasts to all. Now you have the stampede again. How do you
   structure this?** *(Use a routing layer that classifies the work
   first, then enqueues to a single shard. Or use a hierarchical
   condvar tree: a top-level "something happened" signal that wakes
   one router, which then targets the right shard.)*

4. **A teammate proposes signaling outside the mutex "to reduce
   contention". Should you accept it?** *(Reject unless they can show
   measurements. It is allowed by POSIX but defeats the requeue
   optimization, can cause missed wakeups under shutdown races, and
   weakens the happens-before relationship on some architectures.)*

5. **You read a 2012 blog post that says `pthread_cond_broadcast` is
   broken under signal/wait races. Is it still relevant?** *(Possibly
   — that was glibc bug 13165, fixed in glibc 2.25 in 2017. If your
   target platform has older glibc, yes. On modern systems, no.)*

6. **Why does `Object.notify` in Java not have a requeue
   optimization?** *(Java's monitor design predates futex tricks; the
   JVM maintains its own intrinsic locks. Some JVMs do internal
   biased-locking and lock coarsening, but there is no
   externally-visible requeue. This is part of why `java.util.concurrent`
   was added: better primitives.)*

7. **You see a benchmark where `BlockingQueue.put` is *slower* than a
   raw mutex + condvar. Possible?** *(Yes, in single-threaded
   microbenchmarks where the queue's extra atomic counters cost more
   than they save. Real concurrent loads tell a different story.)*

---

## Cheat Sheet

```
PRIMITIVE        WHEN TO USE                              COST
----------------------------------------------------------------
Condvar          Arbitrary predicate, few waiters         Medium
Channel/Queue    "Item is available" predicate            Low (built-in)
park/unpark      Targeted wakeup, lock-free DS            Lowest, hardest
Closed channel   One-shot broadcast (Go)                  Lowest
CountDownLatch   "All N done" predicate                   Low

SIGNAL vs BROADCAST
  signal    : one waiter can proceed                     prefer
  broadcast : multiple waiters can proceed               only when justified

FUTEX TRICKS
  FUTEX_WAIT          : park if *addr == expected
  FUTEX_WAKE n        : wake up to n waiters
  FUTEX_CMP_REQUEUE   : wake 1, move rest to another queue (broadcast magic)

GLIBC INTERNALS
  __wseq          : 64-bit wait sequence, group bit = LSB
  __g_signals[2]  : per-group futex address
  __g_size[2]     : waiters remaining in each group
  __wrefs         : refcount for safe destroy

PROFILING
  perf lock          : lock + cond contention stats
  perf c2c           : cache line ping-pong
  bpftrace futex     : per-call-site futex stats
  async-profiler     : JVM wall-clock view of await()
  pidstat -w         : voluntary context switches per thread

DEFAULTS
  monotonic clock for timedwait
  while loop for predicate
  signal, not broadcast
  hold the mutex when signaling
```

---

## Summary

At the senior level, the condition variable is not an answer; it is a
question. Every time you reach for one, ask: what is the predicate?
How many waiters can proceed when it changes? Does my standard library
already model this as a queue or channel? Can I shard? Can I target a
specific thread with `park`/`unpark`?

The mechanics — futex requeue, dual groups, generation counters,
cache line ping-pong — are not trivia. They explain why broadcast can
stampede, why signal-without-mutex breaks the requeue optimization,
why a sharded design outperforms a single condvar by orders of
magnitude. Understanding them lets you read a profiler output and
diagnose contention without trial and error.

The cultural shift, especially from a C/Java background to Go or
Rust, is that idiomatic modern concurrency often *has no condvar at
all*. Channels and queues bake the predicate in and make the
correctness story trivial. When you do need a condvar, you reach for
it with care, document the protocol, and choose `signal` over
`broadcast` until measurements justify otherwise.

The simplest summary: **understand the futex, prefer the queue, and
never trust the first profile.**

---

## What You Can Build

- A custom thread pool with per-worker `LockSupport.park`/`unpark` and
  work-stealing — no shared condvar.
- A bounded blocking queue with split head/tail locks, beating
  `ArrayBlockingQueue` on your specific workload after benchmarking.
- A versioned config broadcaster using a closed-channel-per-version
  pattern in Go.
- A coordination barrier (phaser-style) using park/unpark.
- A "configurable broadcast strategy" library that picks signal vs
  broadcast at runtime based on predicate metadata.
- A debug shim that wraps `pthread_cond_*` and logs every signal/wait
  with call-site and contention.

---

## Further Reading

- Drepper, Ulrich. **"Futexes Are Tricky"** — the canonical paper.
- Linux kernel docs: `Documentation/locking/futex-requeue-pi.rst`.
- glibc source: `nptl/pthread_cond_wait.c`, `nptl/pthread_cond_signal.c`
  (after 2.25).
- Doug Lea, **"The Java Memory Model"** and the
  `java.util.concurrent` JSR-166 papers.
- Brendan Gregg, **Systems Performance** — chapters on off-CPU
  profiling.
- Aleksey Shipilev's blog posts on JMH and on JVM locking.
- Go issue 21165 — discussion on `sync.Cond`.
- Linux `man 2 futex` and `man 7 pthreads`.

---

## Related Topics

- [Mutexes](../02-mutexes/senior.md) — the primitive condvars build on.
- [Futexes](../06-futex/senior.md) — the kernel mechanism beneath.
- [Channels](../../03-models/01-channels/senior.md) — the higher-level
  alternative.
- [Lock-Free Data Structures](../../04-lock-free/senior.md) — where
  hand-coded waitsets live.
- [Java `java.util.concurrent`](../../../../../languages/java/concurrency/jcu/senior.md)
  — the practical home of park/unpark.
- [Go `sync` package](../../../../../languages/golang/05-concurrency/sync/senior.md)
  — why `sync.Cond` is rarely idiomatic.

---

## Diagrams & Visual Aids

**Broadcast without requeue (the stampede):**

```
        T0  T1  T2  T3  T4  T5  T6  T7
        |   |   |   |   |   |   |   |
   broadcast()
        v   v   v   v   v   v   v   v
       wake wake wake wake wake wake wake wake
        |   |   |   |   |   |   |   |
        +---+---+---+---+---+---+---+
                    |
                    v
              fight for mutex
                    |
                    v
              T3 wins, others wait
              -> 7 wasted wakeups
```

**Broadcast with `FUTEX_CMP_REQUEUE`:**

```
        T0  T1  T2  T3  T4  T5  T6  T7  (parked on cond)
        |   |   |   |   |   |   |   |
   broadcast()
        v
       wake T0 only
                requeue T1..T7 onto mutex queue
        |   |   |   |   |   |   |   |
       T0  T1..T7 still parked, but on mutex
        |
        v
       T0 acquires mutex, does work, unlocks
        |
        v
       mutex unlock wakes T1 (only)
       T1 does work, unlocks -> wakes T2 ...
       -> 1 wake per useful unit of work
```

**glibc dual-group rotation:**

```
   wseq=0      wseq=1      wseq=2      wseq=3
   G1 active    G1 active   G1 closed   G1 closed
                            G2 -> G1    G2 -> G1
                            new G2      new G2

   waiter at wseq=1 -> joins G1 (current)
   signal arrives   -> closes G1, rotates G2 into G1
   waiter at wseq=4 -> joins fresh G2 (cannot be woken
                       by a signal that targeted old G1)
```

**Cache line ping-pong on shared condvar:**

```
   CPU0  CPU1  CPU2  CPU3
    ^     ^     ^     ^
    |     |     |     |
   modify modify modify modify
    \____ /\___ /\___ /
         cache line of __g_signals[0]
         bounces M -> M -> M -> M
         ~100ns per transition
```

**Sharded condvar (the fix):**

```
   Shard 0      Shard 1      Shard 2      Shard 3
   [queue,mu,cv][queue,mu,cv][queue,mu,cv][queue,mu,cv]
       ^            ^            ^            ^
       |            |            |            |
     W0,W1        W2,W3        W4,W5        W6,W7

   Producer routes work to one shard.
   Signal touches only that shard's cache line.
   No cross-CPU bounce.
```

**Park/unpark targeted wakeup:**

```
   ProducerThread                          ConsumerThread
        |                                         |
        | publish item                            | (parked)
        | atomic.compareAndSet                    |
        | LockSupport.unpark(consumer) ---------> wake
        |                                         | re-check predicate
        v                                         v
       continue                              do work
```

End of senior-level treatment.
