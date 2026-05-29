# Shared-Memory Concurrency — Middle Level

> **Topic:** [Shared-Memory Concurrency](README.md)
> **Focus:** memory models, atomics, cond vars, lock-free intro

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

At the junior level you learned that shared memory means multiple threads in one address space, that mutexes serialize critical sections, and that races corrupt data. That picture is enough to make small programs work, but it hides almost everything the CPU and the compiler actually do. The middle level is where the floor drops out: you discover that "the program" you wrote is not the program that runs. The compiler reorders independent statements. The CPU executes loads out of order, buffers stores, and speculates across branches. Each core has its own cache, and writes propagate through a coherence protocol that takes tens of cycles. None of this matters for a single-threaded program, because the hardware promises to preserve the illusion of sequential execution. The instant a second thread looks at the same memory, the illusion shatters.

A memory model is the contract between you and the system that tells you which reorderings are allowed and which are forbidden. It is the only thing that lets you reason about concurrent code at all. Without a memory model, even `flag = true; data = 42;` on one thread and `if (flag) print(data);` on another is not analyzable — you cannot say whether the reader sees `42`, sees `0`, sees garbage, or never sees `flag` set at all. With a memory model — Java's JMM, C++11's `std::memory_order`, Go's happens-before — you get precise rules about which synchronization actions establish ordering, and from there you can build atomics, locks, condition variables, and eventually lock-free data structures.

This level covers the toolbox between "wrap everything in one big mutex" and "I am writing a hand-tuned lock-free queue." You will learn what atomics actually do, why `volatile` in C is not the same as `std::atomic`, how compare-and-swap (CAS) builds nearly everything else, what reader-writer locks and condition variables are for, why spurious wakeups exist, what false sharing is and how to detect it, and the practical differences between the JMM, C++ MM, and Go MM. The goal is not to make you write lock-free code in production tomorrow — the goal is to make you read a piece of concurrent code and know which primitives are correct, which are accidentally working, and which are time bombs.

## Prerequisites

Before reading this page you should be comfortable with:

- Threads, joins, and the basics of mutexes (see [junior.md](junior.md)).
- The notion of a critical section and why unprotected shared state is a bug.
- Reading C or C++ syntax at the level of structs, pointers, and pthreads, and reading Java/Python/Go threading code at the level of `synchronized`, `threading.Lock`, and `sync.Mutex`.
- Basic CPU architecture vocabulary: cache, cache line, register, pipeline. You do not need to know MESI by heart, but knowing that caches exist and are per-core is required.
- The idea that compilers optimize and may reorder code.

If any of those are shaky, go back to the junior page and the prerequisites it lists.

## Glossary

| Term | Meaning |
|---|---|
| Data race | Two or more threads access the same memory, at least one writes, and there is no happens-before edge between them. Undefined behavior in C/C++; observable but bounded in Java/Go. |
| Race condition | A logical bug where outcome depends on thread interleaving. Broader than a data race; you can have a race condition without a data race (e.g., TOCTOU). |
| Atomic | An operation that other threads observe as either fully done or not started — never half done — and that participates in the memory model. |
| CAS | Compare-and-swap. Atomic instruction: if `*addr == expected`, set `*addr = new` and return true; else return false. Foundation of most lock-free code. |
| LL/SC | Load-Linked / Store-Conditional. ARM/POWER equivalent of CAS; the store succeeds only if no other write touched the line since the load. |
| Memory order | The constraint an atomic puts on surrounding loads and stores. Examples: `relaxed`, `acquire`, `release`, `acq_rel`, `seq_cst`. |
| Fence (memory barrier) | A standalone instruction that forbids certain reorderings across it. `mfence`, `lfence`, `sfence` on x86; `dmb` on ARM. |
| RWMutex | Reader-writer lock. Many concurrent readers OR one writer, never both. |
| Condvar | Condition variable. A queue threads sleep on, woken by `signal`/`broadcast`. Always used with a mutex and a predicate loop. |
| Spurious wakeup | A condvar `wait` returns even though nobody signaled. Allowed by the spec; the reason you must `while (!pred) wait;` and never `if (!pred) wait;`. |
| Reentrant lock | A lock the same thread can acquire multiple times without deadlocking; releases when the depth returns to zero. |
| Lock granularity | How much state one lock protects. Coarse = simple, less parallel. Fine = scalable, more deadlock risk. |
| Lock-free | Progress guarantee: some thread always makes progress system-wide, even if individual threads stall. Stronger than "no locks." |
| Wait-free | Stronger guarantee: every thread makes progress in a bounded number of steps. Rare in practice. |
| ABA problem | CAS sees the same value twice but the world changed in between (A→B→A). Defeats naive lock-free stacks. |
| False sharing | Two unrelated variables share a cache line; writes to one invalidate the other, killing performance silently. |
| Cache line | The unit of cache coherence, typically 64 bytes on x86 and ARM. |
| Happens-before | Partial order over memory operations defined by the memory model. If A happens-before B, B sees A's effects. |
| JMM | Java Memory Model (JSR-133). Defines happens-before for `volatile`, `synchronized`, `final`, `Thread.start/join`. |
| Sequential consistency | The strongest practical model: result is as if all ops from all threads were interleaved in some global order consistent with each thread's program order. |
| TSO | Total Store Order. x86's model: stores buffered, loads can pass earlier stores to different addresses. |

---

## Core Concepts

### Memory models — the contract you cannot ignore

A memory model answers one question: given the source code I wrote, what executions am I allowed to observe? The naive answer — "whatever interleaving of statements" — is called sequential consistency (SC) and was formalized by Leslie Lamport in 1979. SC is what most beginners assume implicitly. It is also what no real hardware implements, because enforcing it would kill performance.

Modern CPUs and compilers implement weaker models:

| Model | Where | Reorderings allowed |
|---|---|---|
| Sequential Consistency | Theoretical baseline, JMM `volatile`, C++ `seq_cst` | None |
| Total Store Order (TSO) | x86, x86-64, SPARC | Store→Load to different addresses |
| Processor Consistency | Older models | Stores reordered between cores |
| Weak / Relaxed | ARM, POWER, RISC-V | Almost any non-dependent reordering |

The practical consequence: code that "obviously works" on your x86 laptop can break the first time it runs on an ARM server. This is not a hypothetical — many production bugs in the early days of Apple Silicon and AWS Graviton were exactly this.

Example. Consider two threads:

```
// initially x = y = 0
T1:  x = 1;  r1 = y;
T2:  y = 1;  r2 = x;
```

Under SC, you cannot end with `r1 == 0 && r2 == 0` — at least one thread's store must be visible. Under TSO (x86), `r1 == 0 && r2 == 0` is allowed because each thread's store is buffered and the load reads the other thread's *old* value from cache before the store drains. Under ARM weak ordering, even more outcomes are legal.

You do not memorize the table per architecture. You use the memory model your language gives you, and let it pick the right fences for each CPU.

### Atomic operations — indivisible by contract

An atomic operation is one the runtime guarantees other threads see as a single event. On x86, naturally aligned 4- and 8-byte loads and stores happen to be atomic at the hardware level, but that is an accident of the architecture, not a portable guarantee. A 64-bit store on 32-bit ARMv7 is *not* atomic; it tears into two 32-bit stores.

What `std::atomic<int>` / `AtomicInteger` / `sync/atomic.Int64` give you:

1. **Indivisibility**: no torn reads or writes.
2. **Visibility**: the runtime emits cache-coherence traffic so other threads can see the update.
3. **Ordering**: surrounding loads and stores are constrained according to the memory order you ask for.

Atomic operations include:

- `load` / `store`
- `exchange` (atomic write, return old value)
- `compare_exchange_strong` / `compare_exchange_weak` (CAS)
- `fetch_add`, `fetch_sub`, `fetch_and`, `fetch_or`, `fetch_xor`

The arithmetic ones are how you build counters, sequence numbers, and rate limiters without locks.

### CAS — the universal primitive

Compare-And-Swap is the most important atomic. Its semantics:

```
bool CAS(addr, expected, new):
    atomically:
        if *addr == expected:
            *addr = new
            return true
        else:
            return false
```

CAS is the building block for lock-free counters, stacks, queues, hash tables, and even mutexes themselves. The typical pattern is the **CAS loop**:

```c
do {
    old = atomic_load(&head);
    new = compute_new(old);
} while (!atomic_compare_exchange_weak(&head, &old, new));
```

`compare_exchange_weak` is allowed to fail spuriously (helpful on LL/SC architectures), so it is always used in a loop. `compare_exchange_strong` only fails when the value actually differs, but is slightly more expensive on ARM/POWER.

### Load-Linked / Store-Conditional (LL/SC)

ARM, POWER, RISC-V, and MIPS do not have CAS as a single instruction. They have a pair: `ldrex` (load-linked) marks an address as "reserved" for the current core; `strex` (store-conditional) succeeds only if no other core has touched the line in between. The compiler synthesizes CAS from LL/SC:

```
loop:
   v = LL(addr)
   if v != expected: fail
   if !SC(addr, new): goto loop
   succeed
```

LL/SC is strictly more general than CAS — you can build atomic `fetch_add` and other RMW operations without a dedicated instruction. The cost: spurious failures from unrelated cache traffic, hence `compare_exchange_weak`.

### Memory ordering — relaxed, acquire, release, seq_cst

C++11 and modern Rust expose memory orderings on every atomic. Use them deliberately.

| Order | Meaning |
|---|---|
| `relaxed` | Atomicity only. No ordering constraints. Use for counters where you only need the final sum. |
| `acquire` (load) | No load/store after this load may be reordered before it. Pairs with `release` to form a synchronizes-with edge. |
| `release` (store) | No load/store before this store may be reordered after it. The reader's `acquire` sees everything the writer did before the `release`. |
| `acq_rel` | RMWs only. Combines acquire on the load half and release on the store half. |
| `seq_cst` | Acquire + release + global total order across all `seq_cst` ops. The default; the safe choice; the slow choice. |

The acquire-release pattern is the workhorse:

```cpp
// Writer
data = 42;                                       // ordinary store
flag.store(true, std::memory_order_release);     // publishes data

// Reader
while (!flag.load(std::memory_order_acquire)) {} // observes flag
use(data);                                       // guaranteed to see 42
```

### Why `volatile` in C/C++ is not enough

`volatile` was designed for memory-mapped I/O. It tells the compiler "do not optimize loads and stores of this variable away or merge them." It does NOT:

- Prevent CPU reordering.
- Emit any fence.
- Make multi-word access atomic.
- Establish happens-before with other threads.

`volatile int x; x++;` in C is still a data race when two threads do it. Use `_Atomic int` (C11) or `std::atomic<int>` (C++11) instead. In Java, `volatile` *does* mean acquire-release semantics for that variable — it is one of those bitter naming collisions across languages.

### Reader-writer locks

A mutex serializes everyone. An RWMutex (a.k.a. `shared_mutex`, `RWLock`, `sync.RWMutex`) allows many concurrent readers OR one exclusive writer. Use when:

- Reads vastly outnumber writes (≥ 10x typically).
- The critical section is long enough that the higher per-acquisition cost pays off.

Pitfalls:

- **Writer starvation**: in reader-preference implementations, a steady stream of readers can keep writers waiting forever. Most modern RWMutex impls are writer-preferring or fair to avoid this.
- **Higher fixed cost**: an RWMutex is usually 2-3x slower per acquisition than a plain mutex. If the critical section is tiny, plain mutex wins.
- **No upgrade**: most implementations forbid upgrading a read lock to a write lock — it deadlocks if two readers try simultaneously. Release, then re-acquire as writer, then re-check the predicate.

### Condition variables

A condition variable is the answer to "I am holding the lock but the predicate I need is not yet true; how do I wait without busy-spinning?" The contract:

1. The waiter holds the mutex, checks the predicate; if false, calls `cv.wait(mutex)`, which atomically releases the mutex and sleeps.
2. A signaler holds the mutex, mutates state, calls `cv.notify_one()` or `cv.notify_all()`, then releases.
3. The waiter wakes up, the mutex is re-acquired *for it* before `wait` returns.
4. The waiter rechecks the predicate. If false again — spurious wakeup or another waiter took the slot — it waits again.

The non-negotiable rule:

```cpp
std::unique_lock<std::mutex> lock(mu);
while (!predicate()) {           // while, NEVER if
    cv.wait(lock);
}
// predicate is true; we hold the lock
```

Why `while`?

- **Spurious wakeups**: POSIX and Java explicitly allow `wait` to return without a signal. Hardware interrupts and signal-safety details make detecting them expensive, so the spec says "deal with it."
- **Lost-wakeup-style races**: between your wake and your turn at the lock, another thread might have grabbed the resource you were waiting for.
- **Broadcast**: `notify_all` wakes everyone, but only one (or a few) can actually proceed. The rest must wait again.

`notify_one` vs `notify_all`:

- `notify_one`: wake exactly one waiter. Cheaper. Use when any waiter can handle the new work and they are interchangeable (e.g., worker pool).
- `notify_all`: wake everyone. Use when the predicate change might satisfy multiple waiters or when waiters are waiting on different sub-predicates.

### Reentrant vs non-reentrant locks

A reentrant (recursive) lock remembers the owning thread and a hold count. The same thread can `lock()` again; only when the count returns to zero is the lock actually released.

| Property | Non-reentrant | Reentrant |
|---|---|---|
| Cost | Lower (just owner check or none) | Higher (owner + counter) |
| Self-deadlock | Yes if you re-enter | No |
| Encourages bad design | No | Yes — hides lock structure |
| Examples | `std::mutex`, `sync.Mutex`, pthread default | `std::recursive_mutex`, `ReentrantLock` (Java), pthread `_RECURSIVE` |

The pragmatic advice: prefer non-reentrant. If you find yourself needing reentrance, you usually have a layering bug — the public API takes the lock and then calls into another method that also takes the lock. Refactor: split into a public locking shell and a private unlocked helper.

### Lock granularity

| Granularity | Description | Trade-off |
|---|---|---|
| Global lock | One lock for the entire program | Easy to reason about; kills parallelism |
| Coarse | One lock per major subsystem | Decent for low contention |
| Fine | One lock per object / per row / per bucket | Scales; deadlock and complexity risk |
| Striped | N locks chosen by hash(key) % N | Bounded memory, good scale; chosen N matters |
| Lock-free | No locks, atomics + CAS | Best scale; hardest to write correctly |

Choose granularity by measurement. Start coarse, profile, refine. Going straight to lock-free is almost always premature optimization.

### Lock-free intro — Treiber stack and MS queue

The Treiber stack is the classic lock-free stack (R. K. Treiber, 1986):

```c
// push
do {
    old_top = atomic_load(&top);
    node->next = old_top;
} while (!CAS(&top, &old_top, node));

// pop
do {
    old_top = atomic_load(&top);
    if (!old_top) return NULL;
    new_top = old_top->next;
} while (!CAS(&top, &old_top, new_top));
return old_top;
```

It is lock-free: at least one thread always makes progress. It is NOT memory-safe — pop returns a node, but you cannot free it immediately because another thread may still be reading it. And it suffers from the **ABA problem**: thread A reads top=X, gets preempted; thread B pops X, pops Y, pushes X back (re-using memory); thread A's CAS succeeds even though the world changed. Fixes include hazard pointers, epoch-based reclamation, or a CAS-2 with a version counter.

The Michael-Scott queue is the analogous FIFO. Both use CAS loops on the head/tail. Real production lock-free queues (LMAX Disruptor, boost::lockfree, Java's ConcurrentLinkedQueue) descend from MS.

You will likely never write one. You will likely *use* libraries that contain them. Knowing what the algorithm requires (a memory reclamation strategy, awareness of ABA, careful memory ordering) helps you judge whether a library is trustworthy.

### False sharing and cache lines

The CPU does not transfer single bytes between caches; it transfers cache lines (64 bytes on x86 and ARM, 128 on some POWER). If thread A on core 0 writes variable `x` and thread B on core 1 writes variable `y`, and `x` and `y` are in the same cache line, then every write by one core invalidates the line in the other core's cache. The variables are logically independent, but the hardware treats them as contended. Performance can collapse 10-100x.

Detection: profile with `perf c2c` (Linux), Intel VTune's cache contention view, or hand-written benchmarks. Fix: pad to a cache line.

```c
struct PaddedCounter {
    _Atomic long value;
    char pad[64 - sizeof(long)];  // pad to one cache line
};
```

Or in C++17:

```cpp
struct alignas(std::hardware_destructive_interference_size) PaddedCounter {
    std::atomic<long> value;
};
```

### Memory model differences — JMM, C++ MM, Go MM

| Aspect | Java (JMM, JSR-133) | C++11 (std::memory_order) | Go |
|---|---|---|---|
| Default semantics | Data races allowed but bounded (no UB) | Data race = UB | Data race = undefined-ish (Go spec: program semantics undefined) |
| `volatile` | Acquire-release on each access | Useless for concurrency | No keyword; use `sync/atomic` |
| Default atomic order | `seq_cst` for `volatile` and `j.u.c.atomic` | `seq_cst` for `atomic<T>` default ops | `seq_cst` for `sync/atomic` (Go 1.19+) |
| Granular ordering | No (only `volatile` or `Atomic*` with `getOpaque`/`getAcquire`/`setRelease` in Java 9+) | Yes, full menu | No (intentionally simple) |
| Happens-before sources | `synchronized`, `volatile`, `final`, `Thread.start/join`, `j.u.c` | Mutex lock/unlock, atomics, fences, `thread.join` | Channel ops, mutex lock/unlock, `sync.Once`, goroutine start, `sync/atomic` |

Go's memory model is intentionally minimal: you are encouraged to communicate via channels, not shared memory. The Go memory model document is short — read it once a year. Java's JMM is the most rigorously specified; C++11's is the most flexible and the most dangerous to misuse.

---

## Real-World Analogies

| Analogy | Maps to |
|---|---|
| A live theater with a director shouting "action!" and "cut!" | Memory fences — they create observable boundaries |
| A whiteboard where everyone writes at once | Shared memory without synchronization — illegible |
| A bank teller line with one teller (mutex) vs. ten tellers and one safe (RWMutex) | Mutex vs reader-writer lock |
| A doorbell: ring once, multiple people might come | `notify_all` (broadcast) |
| Checking the kettle every minute vs sleeping until it whistles | Busy-wait vs condition variable |
| A revolving door — only one person at a time, but counted | Atomic counter (`fetch_add`) |
| A locker with a combination that only opens if the dial is at the expected number | CAS — succeeds only if value matches expected |
| Two people writing on the same Post-it note | False sharing — different "ideas," same physical surface |
| Mailroom slot vs shouting across the office | Acquire-release vs sequential consistency |

---

## Mental Models

### The Memory-Model-as-Contract Model

Stop thinking of memory as a thing your CPU has. Think of it as a contract between the language and the hardware, mediated by the compiler. Your code is a *request* for behavior, expressed in the language's memory model. The compiler translates it into machine code that the hardware's memory model is allowed to execute. Bugs happen at every translation layer:

- You wrote racy code → language MM says UB or unspecified.
- You wrote correct code with weak ordering → compiler emits fences appropriate to the target CPU.
- You ran it on a new architecture → if the language MM is sound, it still works; if you assumed x86 semantics, it breaks.

The contract idea also explains why "it worked in testing" means nothing. Race bugs are non-deterministic. The contract violation existed; the schedule that exposed it hadn't happened yet.

### The Publication / Subscription Model

Acquire-release exists to model one thread *publishing* data and another *subscribing*. The release store is the publication: "I'm done; what I did is visible." The acquire load is the subscription: "I am ready to see what the publisher did." The pattern is so common that whole frameworks (single-producer single-consumer queues, RCU, Java's `volatile` boolean flags) reduce to it.

Whenever you see `flag.store(true, release)` paired with `while (!flag.load(acquire))`, you are watching a publication. Whenever you reach for `seq_cst` because you "want it to work," ask: is this just a publication? Most of the time, acquire-release is enough and lets the compiler emit cheaper instructions on ARM and POWER.

### The Happens-Before Graph Model

Model your program as a DAG. Each thread's instructions form a linear chain. Synchronization primitives — mutex lock/unlock, atomic acquire/release, condvar wait/notify, thread start/join — add cross-thread edges. Memory operations connected by a path are ordered. Operations with no path between them race.

When you debug a concurrency bug, draw the graph. Find a write and a read of the same location with no path between them. That is your bug. The fix is to add an edge — usually by inserting an atomic or extending a lock's range.

---

## Code Examples

### Bounded buffer (mutex + 2 condvars) in 4 languages

The same problem: a fixed-size queue, producers wait if full, consumers wait if empty. We use two condition variables — `not_full` and `not_empty` — to avoid waking waiters who can't make progress.

#### C (pthreads)

```c
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

#define CAP 4

typedef struct {
    int buf[CAP];
    int head, tail, count;
    pthread_mutex_t mu;
    pthread_cond_t not_full;
    pthread_cond_t not_empty;
} bq_t;

void bq_init(bq_t *q) {
    q->head = q->tail = q->count = 0;
    pthread_mutex_init(&q->mu, NULL);
    pthread_cond_init(&q->not_full, NULL);
    pthread_cond_init(&q->not_empty, NULL);
}

void bq_put(bq_t *q, int v) {
    pthread_mutex_lock(&q->mu);
    while (q->count == CAP) {
        pthread_cond_wait(&q->not_full, &q->mu);
    }
    q->buf[q->tail] = v;
    q->tail = (q->tail + 1) % CAP;
    q->count++;
    pthread_cond_signal(&q->not_empty);
    pthread_mutex_unlock(&q->mu);
}

int bq_get(bq_t *q) {
    pthread_mutex_lock(&q->mu);
    while (q->count == 0) {
        pthread_cond_wait(&q->not_empty, &q->mu);
    }
    int v = q->buf[q->head];
    q->head = (q->head + 1) % CAP;
    q->count--;
    pthread_cond_signal(&q->not_full);
    pthread_mutex_unlock(&q->mu);
    return v;
}

void *producer(void *arg) {
    bq_t *q = arg;
    for (int i = 0; i < 8; i++) bq_put(q, i);
    return NULL;
}

void *consumer(void *arg) {
    bq_t *q = arg;
    for (int i = 0; i < 8; i++) printf("got %d\n", bq_get(q));
    return NULL;
}

int main(void) {
    bq_t q; bq_init(&q);
    pthread_t p, c;
    pthread_create(&p, NULL, producer, &q);
    pthread_create(&c, NULL, consumer, &q);
    pthread_join(p, NULL);
    pthread_join(c, NULL);
    return 0;
}
```

#### Java

```java
import java.util.concurrent.locks.*;

public class BoundedBuffer {
    private static final int CAP = 4;
    private final int[] buf = new int[CAP];
    private int head, tail, count;
    private final ReentrantLock mu = new ReentrantLock();
    private final Condition notFull  = mu.newCondition();
    private final Condition notEmpty = mu.newCondition();

    public void put(int v) throws InterruptedException {
        mu.lock();
        try {
            while (count == CAP) notFull.await();
            buf[tail] = v;
            tail = (tail + 1) % CAP;
            count++;
            notEmpty.signal();
        } finally { mu.unlock(); }
    }

    public int get() throws InterruptedException {
        mu.lock();
        try {
            while (count == 0) notEmpty.await();
            int v = buf[head];
            head = (head + 1) % CAP;
            count--;
            notFull.signal();
            return v;
        } finally { mu.unlock(); }
    }

    public static void main(String[] args) throws Exception {
        BoundedBuffer q = new BoundedBuffer();
        Thread p = new Thread(() -> {
            try { for (int i = 0; i < 8; i++) q.put(i); }
            catch (InterruptedException e) {}
        });
        Thread c = new Thread(() -> {
            try { for (int i = 0; i < 8; i++) System.out.println("got " + q.get()); }
            catch (InterruptedException e) {}
        });
        p.start(); c.start(); p.join(); c.join();
    }
}
```

#### Python

```python
import threading

class BoundedBuffer:
    def __init__(self, cap=4):
        self.cap = cap
        self.buf = [None] * cap
        self.head = self.tail = self.count = 0
        self.mu = threading.Lock()
        self.not_full  = threading.Condition(self.mu)
        self.not_empty = threading.Condition(self.mu)

    def put(self, v):
        with self.not_full:
            while self.count == self.cap:
                self.not_full.wait()
            self.buf[self.tail] = v
            self.tail = (self.tail + 1) % self.cap
            self.count += 1
            self.not_empty.notify()

    def get(self):
        with self.not_empty:
            while self.count == 0:
                self.not_empty.wait()
            v = self.buf[self.head]
            self.head = (self.head + 1) % self.cap
            self.count -= 1
            self.not_full.notify()
            return v

def producer(q):
    for i in range(8):
        q.put(i)

def consumer(q):
    for _ in range(8):
        print("got", q.get())

if __name__ == "__main__":
    q = BoundedBuffer()
    p = threading.Thread(target=producer, args=(q,))
    c = threading.Thread(target=consumer, args=(q,))
    p.start(); c.start(); p.join(); c.join()
```

Note: in Python, the GIL makes single-bytecode operations effectively atomic, but the `while` predicate loop is still required because `Condition.wait` can spuriously return and because multiple consumers can race for the same item.

#### Go

```go
package main

import (
    "fmt"
    "sync"
)

const cap = 4

type BoundedBuffer struct {
    buf            [cap]int
    head, tail, n  int
    mu             sync.Mutex
    notFull        *sync.Cond
    notEmpty       *sync.Cond
}

func NewBoundedBuffer() *BoundedBuffer {
    b := &BoundedBuffer{}
    b.notFull = sync.NewCond(&b.mu)
    b.notEmpty = sync.NewCond(&b.mu)
    return b
}

func (b *BoundedBuffer) Put(v int) {
    b.mu.Lock()
    for b.n == cap {
        b.notFull.Wait()
    }
    b.buf[b.tail] = v
    b.tail = (b.tail + 1) % cap
    b.n++
    b.notEmpty.Signal()
    b.mu.Unlock()
}

func (b *BoundedBuffer) Get() int {
    b.mu.Lock()
    for b.n == 0 {
        b.notEmpty.Wait()
    }
    v := b.buf[b.head]
    b.head = (b.head + 1) % cap
    b.n--
    b.notFull.Signal()
    b.mu.Unlock()
    return v
}

func main() {
    q := NewBoundedBuffer()
    var wg sync.WaitGroup
    wg.Add(2)
    go func() { defer wg.Done(); for i := 0; i < 8; i++ { q.Put(i) } }()
    go func() { defer wg.Done(); for i := 0; i < 8; i++ { fmt.Println("got", q.Get()) } }()
    wg.Wait()
}
```

Idiomatic Go would use a buffered channel instead — `make(chan int, 4)` — but the explicit mutex+condvar version exposes the underlying machinery.

### Atomic counter with CAS in 4 languages

A counter incremented from many threads, lock-free.

#### C11

```c
#include <stdatomic.h>
#include <pthread.h>
#include <stdio.h>

atomic_long counter = 0;

void inc(void) {
    long old;
    do {
        old = atomic_load_explicit(&counter, memory_order_relaxed);
    } while (!atomic_compare_exchange_weak_explicit(
        &counter, &old, old + 1,
        memory_order_relaxed, memory_order_relaxed));
}

void *worker(void *arg) {
    for (int i = 0; i < 100000; i++) inc();
    return NULL;
}

int main(void) {
    pthread_t t[4];
    for (int i = 0; i < 4; i++) pthread_create(&t[i], NULL, worker, NULL);
    for (int i = 0; i < 4; i++) pthread_join(t[i], NULL);
    printf("counter = %ld\n", atomic_load(&counter));
    return 0;
}
```

For a plain counter, `atomic_fetch_add(&counter, 1)` is shorter and faster than a CAS loop. CAS shines when the new value depends on the old in a complex way.

#### Java

```java
import java.util.concurrent.atomic.AtomicLong;

public class CasCounter {
    static AtomicLong counter = new AtomicLong();

    static void inc() {
        long old;
        do {
            old = counter.get();
        } while (!counter.compareAndSet(old, old + 1));
    }

    public static void main(String[] args) throws Exception {
        Thread[] t = new Thread[4];
        for (int i = 0; i < 4; i++) t[i] = new Thread(() -> {
            for (int j = 0; j < 100_000; j++) inc();
        });
        for (Thread th : t) th.start();
        for (Thread th : t) th.join();
        System.out.println("counter = " + counter.get());
    }
}
```

#### Python

```python
import threading

class CasCounter:
    def __init__(self):
        self._value = 0
        self._lock = threading.Lock()

    def cas(self, expected, new):
        with self._lock:
            if self._value == expected:
                self._value = new
                return True
            return False

    def get(self):
        return self._value

    def inc(self):
        while True:
            old = self.get()
            if self.cas(old, old + 1):
                return

counter = CasCounter()

def worker():
    for _ in range(100_000):
        counter.inc()

ts = [threading.Thread(target=worker) for _ in range(4)]
for t in ts: t.start()
for t in ts: t.join()
print("counter =", counter.get())
```

Python has no native CAS in the language — we simulate it with a lock to illustrate the pattern. Real performance work in CPython uses `multiprocessing` or moves to a thread-safe language. In free-threaded CPython (3.13+), `_thread`/`atomic` APIs are evolving.

#### Go

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

var counter atomic.Int64

func inc() {
    for {
        old := counter.Load()
        if counter.CompareAndSwap(old, old+1) {
            return
        }
    }
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 100000; j++ {
                inc()
            }
        }()
    }
    wg.Wait()
    fmt.Println("counter =", counter.Load())
}
```

Again, `counter.Add(1)` is the idiomatic and faster path. The CAS form is for when arithmetic is conditional.

### False-sharing benchmark in C

This program demonstrates that two counters in the same cache line are dramatically slower than two counters in different cache lines.

```c
#define _POSIX_C_SOURCE 200809L
#include <pthread.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <time.h>

#define ITERS 50000000L
#define CACHE_LINE 64

typedef struct {
    volatile long a;
    volatile long b;
} SharedLine;

typedef struct {
    volatile long a;
    char pad[CACHE_LINE - sizeof(long)];
    volatile long b;
} DistinctLines;

static SharedLine    shared;
static DistinctLines distinct;

void *bump_shared_a(void *_) { for (long i = 0; i < ITERS; i++) shared.a++;    return NULL; }
void *bump_shared_b(void *_) { for (long i = 0; i < ITERS; i++) shared.b++;    return NULL; }
void *bump_dist_a  (void *_) { for (long i = 0; i < ITERS; i++) distinct.a++;  return NULL; }
void *bump_dist_b  (void *_) { for (long i = 0; i < ITERS; i++) distinct.b++;  return NULL; }

double run(void *(*fa)(void*), void *(*fb)(void*)) {
    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    pthread_t a, b;
    pthread_create(&a, NULL, fa, NULL);
    pthread_create(&b, NULL, fb, NULL);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    clock_gettime(CLOCK_MONOTONIC, &t1);
    return (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;
}

int main(void) {
    double shared_time   = run(bump_shared_a, bump_shared_b);
    double distinct_time = run(bump_dist_a,   bump_dist_b);
    printf("same line   : %.3fs\n", shared_time);
    printf("padded apart: %.3fs\n", distinct_time);
    printf("slowdown    : %.1fx\n", shared_time / distinct_time);
    return 0;
}
```

Typical output on an x86 laptop: the same-line version is 5-10x slower despite doing identical work. The variables are not even atomic — the cache coherence protocol alone is the killer. (Note: `volatile` here is to prevent the compiler optimizing the loop away; it is NOT making things atomic and the program has data races by design.)

---

## Pros & Cons

| Aspect | Pros | Cons |
|---|---|---|
| Atomics | Low overhead; lock-free progress; composable | Hard to reason about ordering; easy to under-fence |
| RWMutex | Read parallelism for read-heavy workloads | Higher fixed cost; possible writer starvation |
| Condvars | Idiomatic event waiting; correct when used with predicate loop | Easy to forget the `while`; lost wakeups if you signal outside the lock; broadcast can thunder |
| Lock-free | Best scalability under contention | Hard to write, harder to verify; ABA, reclamation |
| Fine granularity | Scales | Deadlock risk; cognitive load |
| Coarse granularity | Simple | Bottleneck |
| seq_cst everywhere | Easy to reason about | Slower, especially on ARM/POWER |
| Acquire-release | Cheap, expressive | Subtle; pair-ups must be exactly right |

---

## Use Cases

- **Reference counts**: `atomic.fetch_sub(refcnt, 1, acq_rel)` then if zero, free. Classic acquire-release.
- **Sequence numbers / IDs**: `atomic.fetch_add` for a global counter.
- **Spin locks**: a `bool` atomic with `acquire`/`release` and `compare_exchange_weak`. Use for very short critical sections only.
- **Flag-based shutdown**: a `volatile bool` (Java) or `atomic.Bool` (Go/Rust) checked in worker loops.
- **Read-mostly caches**: RWMutex around a hash map; consider `sync.Map` (Go) or `ConcurrentHashMap` (Java) instead.
- **Bounded queues between producers and consumers**: mutex + 2 condvars; or move to a lock-free SPSC/MPMC if measured contention demands it.
- **Latches and barriers**: `CountDownLatch`, `CyclicBarrier` (Java), `sync.WaitGroup` (Go).
- **Double-checked locking** for one-time init: in Java/C++11, use `volatile`/`atomic`+`Once`; in C++ also `std::call_once`; in Go, `sync.Once`.

---

## Coding Patterns

### Acquire-release publication

```cpp
std::atomic<Config*> g_config{nullptr};

void publish(Config* c) {
    g_config.store(c, std::memory_order_release);
}

Config* current() {
    return g_config.load(std::memory_order_acquire);
}
```

### CAS loop with backoff

```c
for (int spin = 1; ; spin = spin < 1024 ? spin * 2 : spin) {
    long old = atomic_load(&v);
    long nw  = transform(old);
    if (atomic_compare_exchange_weak(&v, &old, nw)) break;
    for (int i = 0; i < spin; i++) __asm__ __volatile__("pause");
}
```

Without backoff, a hot CAS loop wastes cache bandwidth fighting other cores.

### Predicate-loop condvar

```python
with cv:
    while not predicate():
        cv.wait()
    do_work()
```

### Double-checked locking (Go)

```go
var (
    once  sync.Once
    inst  *Service
)

func Get() *Service {
    once.Do(func() { inst = newService() })
    return inst
}
```

`sync.Once` is the right primitive; rolling your own with a `volatile` flag is a classic foot-gun.

### Striped locks

```go
type StripedMap struct {
    stripes [32]struct {
        mu sync.Mutex
        m  map[string]any
    }
}

func (s *StripedMap) stripe(k string) *struct{ mu sync.Mutex; m map[string]any } {
    h := fnv32(k)
    return &s.stripes[h % 32]
}
```

---

## Clean Code

- Name locks by what they protect: `usersMu` for the lock on `users`. A lock named `mu` over a 500-line struct is a smell.
- Document the locking discipline at the top of the struct. Examples: `// users_ is guarded by mu_.` `// counter_ is atomic.`
- Make critical sections small and obvious. Extract long bodies into private methods that take `// PRE: caller holds mu` comments.
- Prefer scoped lock guards (`std::lock_guard`, `defer mu.Unlock()`, `try-finally`) over manual unlock pairs.
- Hide condvars behind a domain operation. Callers should call `queue.Put(v)`, not see the condvar at all.
- One lock per field family. If two fields are always taken together, they share a lock; if they are not, they should not.
- Atomics deserve a typedef or wrapper that captures intent: `using Refcount = std::atomic<uint32_t>;` reads better than scattered atomics.
- Never re-export a lock. The lock should be a private detail of the type.

---

## Best Practices

| Practice | Why |
|---|---|
| Always recheck predicate in a `while` after `wait` | Spurious wakeups + lost wakeups + broadcast |
| Hold the lock when signaling, OR document why you don't | Signaling without the lock can lose wakeups (POSIX), and even where allowed (Java), it harms predictability |
| Prefer `notify_all` if you are unsure which waiters can proceed | Correctness first; optimize to `notify_one` after measurement |
| Default to `seq_cst`; weaken only when profiling demands | Acquire-release bugs are silent and architecture-specific |
| Pad shared atomics to a cache line | Cheap insurance against false sharing |
| Prefer atomic fetch-add over CAS loops for simple counters | Fewer round trips on hot paths |
| Use language-provided primitives over rolling your own | `sync.Once`, `CountDownLatch`, `std::call_once` cover 90% of needs |
| Run tests under `-race` / TSan | Catches data races before customers do |
| Test on the weakest target you support (ARM, POWER) | TSO covers x86 sins |
| Time-bound `wait` in production loops with a timeout | Reveals lost-wakeup bugs as latency, not hangs |

---

## Edge Cases & Pitfalls

- **`notify_one` after releasing the mutex** in C++ before C++20 was fine but caused the signaled thread to immediately contend; in some runtimes it could miss a wakeup if another thread re-acquired and changed state.
- **`broadcast` storms**: 1000 waiters wake, fight over the lock, 999 re-sleep. Use `notify_one` per item produced, or a different design.
- **Unaligned atomics**: a `std::atomic<long long>` that ends up misaligned (rare with default allocators, common with packed structs) is much slower and on some hardware non-atomic. Don't pack atomics.
- **Mixed atomic and non-atomic access** to the same address: undefined in C++, dangerous everywhere. Pick one.
- **Reading atomics in a tight loop without backoff**: causes cache-line ping-pong even though you are not writing.
- **Re-entrant condvar wait**: waiting on a condvar inside a callback that runs holding the same mutex deadlocks if the callback is invoked under a different lock.
- **Forgetting that `pthread_cond_wait` can return EINTR**: in some implementations, signal delivery wakes the waiter. The `while` predicate loop handles this for free.
- **Java `wait()` without holding the monitor** throws `IllegalMonitorStateException`. Always inside `synchronized` or `lock`.
- **Mixed `RWLock` users where readers also mutate** (e.g., updating an LRU counter) — your reader is a writer. Use a writer lock or atomics for the side effects.

---

## Common Mistakes

1. Using `if` instead of `while` around `wait`. The single most common condvar bug.
2. Treating `volatile` in C/C++ as a concurrency primitive. It isn't.
3. Sharing a `std::condition_variable` between two mutexes. Each condvar belongs to exactly one mutex.
4. Signaling a condvar without ever modifying the predicate.
5. Calling `notify_all` from inside a tight loop and saturating the scheduler.
6. Upgrading a read lock to a write lock and deadlocking.
7. Forgetting to release the lock on an exception path. Use RAII / `defer` / `try-finally`.
8. Returning a pointer to data protected by a lock, then releasing the lock — callers race.
9. Using a recursive mutex to "fix" deadlocks instead of fixing the layering.
10. Assuming x86 ordering on ARM and skipping memory orders.
11. CAS loop with no progress detection — livelock under high contention.
12. Allocating inside a critical section, blocking other threads on the allocator.
13. Logging inside a critical section — `fprintf` may take its own internal lock and cause inversion.
14. Holding a user-defined lock across a callback whose contract is unknown.
15. Reading an atomic with `relaxed` and assuming you also synchronized other variables.

---

## Tricky Points

- An `atomic` load with `relaxed` is genuinely atomic at the access level. It just doesn't order anything else. People misread "relaxed" as "racy."
- `std::memory_order_consume` exists in the standard but is widely implemented as `acquire`. Don't use it.
- Java's `final` fields have special initialization semantics — once the constructor finishes, all threads see the final values without synchronization. Don't break it by leaking `this` from the constructor.
- Go's race detector finds many bugs but is not exhaustive. Absence of detection is not absence of races.
- C++ `std::shared_mutex` allows readers and writers, but on Linux/glibc it has historically been notably slower than `std::mutex` for short sections. Benchmark.
- "Memory barrier" colloquially means "anything that orders memory." Strictly, a barrier is a *standalone* instruction. Atomic ops with ordering are not barriers — they are ordered ops.
- On x86, every locked instruction (`lock add`, `lock cmpxchg`, `xchg` of memory) carries a full barrier. On ARM, `ldaxr`/`stlxr` give acquire/release individually, and `dmb ish` is the explicit fence.
- `volatile` in Java IS acquire-release; this is the most confusing collision with C/C++ terminology in all of programming.

---

## Test Yourself

1. Two threads run `x++` where `x` is a `volatile int` in C and an `atomic_int` in C11. For each, what is the worst case after 1000 iterations per thread? Justify in terms of the memory model.
2. Write a single-producer single-consumer ring buffer using two atomics (`head`, `tail`) with the *minimum* memory orderings that make it correct. Show the orderings and explain each.
3. Modify the bounded buffer above to support multiple producers and multiple consumers. What changes? Are two condvars still enough, or do you need more?
4. Implement a non-blocking `try_lock` for a spinlock using `compare_exchange_strong` and `compare_exchange_weak`. Why is the choice different from a normal `lock`?
5. Take the false-sharing benchmark. Replace `volatile long` with `_Atomic long` and explain whether the gap grows, shrinks, or stays the same — and why.
6. Show why "double-checked locking" without a memory model (i.e., plain pointer check, lock, check, allocate, store) is broken on ARM but appears to work on x86.
7. Design an RWMutex that prevents writer starvation. What invariants do you maintain when a reader arrives while a writer is waiting?
8. Reproduce an ABA bug in a Treiber stack using two threads. What is the minimum schedule?

## Tricky Questions

**Q1.** A colleague says: "I used `std::atomic<int>` so I don't need a mutex." Is the colleague right?
**A.** Only for that single integer's loads/stores/RMWs. Once a logical operation spans more than one memory location, atomicity of each component does not give atomicity of the composite. You still need a mutex or a carefully designed lock-free algorithm.

**Q2.** Why does POSIX allow spurious wakeups when it could implement strict signaling?
**A.** Two reasons. Signal-safety: a UNIX signal handler that wants to wake a waiter cannot easily reach into kernel-managed condvar state, so a spurious wake is a safety valve. And implementation cost: detecting spurious wakeups (e.g., from sched preemption interacting with futex restart) would require extra atomics on the fast path. Forcing apps to use a predicate loop makes both problems disappear at the cost of one line of code.

**Q3.** Your program crashes once a week on AWS Graviton (ARM) but never on EC2 m5 (x86). The code uses raw `volatile` for cross-thread flags. What is your hypothesis?
**A.** TSO on x86 happens to make many under-synchronized programs work; ARM's weak model exposes the missing fences. Replace `volatile` with `std::atomic<T>` using at least acquire/release, run TSan, and re-test.

**Q4.** `notify_one` vs `notify_all`. When is `notify_all` actually required for correctness?
**A.** When different waiters wait on different sub-predicates of the same condvar, or when a single state change may satisfy more than one waiter (e.g., releasing N permits in a semaphore-like primitive when N waiters could each take one). Otherwise `notify_one` plus a correct predicate loop is sufficient.

**Q5.** Java's `volatile` makes the variable acquire-release. So why is `volatile int counter; counter++;` still racy?
**A.** `counter++` is a load, an increment, and a store. Each is acquire-release individually, but the read-modify-write composite is NOT atomic. Two threads can both load 5 and both store 6. Use `AtomicInteger.incrementAndGet`.

**Q6.** Your CAS loop never makes progress under high contention — the program appears to make forward progress globally but one specific thread never wins. Is this a bug?
**A.** Lock-free guarantees system-wide progress, not per-thread fairness. Your thread is starving. Solutions: exponential backoff with jitter, fallback to a fair lock under heavy contention, or switch to a wait-free algorithm.

**Q7.** Why is `std::atomic<T>` for large T sometimes a lock under the hood?
**A.** If `T` is bigger than what the hardware can do atomically (commonly >16 bytes on x86 with `cmpxchg16b`), the standard library uses a hidden lock to fake atomicity. Check `is_lock_free()`. The interface is the same, the performance and progress guarantee are not.

**Q8.** A reader sees `flag = true`, then reads `data` and prints garbage. The writer wrote `data = 42; flag.store(true, std::memory_order_release);`. What went wrong?
**A.** The reader is using `flag.load(std::memory_order_relaxed)` or, worse, a non-atomic `volatile bool`. Use `acquire` on the read; the release-acquire pair establishes happens-before so `data == 42` is guaranteed.

---

## Cheat Sheet

```
+----------------------------------------------------------------+
|                 SHARED-MEMORY — MIDDLE                         |
+----------------------------------------------------------------+
| MEMORY MODELS                                                  |
|   SC : strongest; the "obvious" semantics; not real HW         |
|   TSO: x86; store->load to other addrs may reorder             |
|   Weak: ARM/POWER; almost any non-dep reorder allowed          |
|                                                                |
| MEMORY ORDERS (C++ / Rust)                                     |
|   relaxed   : atomicity only                                   |
|   acquire   : no later loads/stores rise above                 |
|   release   : no earlier loads/stores sink below               |
|   acq_rel   : RMW; both sides                                  |
|   seq_cst   : global total order; default                      |
|                                                                |
| ATOMIC PATTERNS                                                |
|   counter   : fetch_add                                        |
|   flag      : store(release) / load(acquire)                   |
|   spinlock  : exchange / cmpxchg                               |
|   lock-free : cmpxchg_weak loop + backoff                      |
|                                                                |
| CONDVAR INVARIANT                                              |
|   take lock -> while (!P) wait -> mutate -> signal -> unlock   |
|   NEVER `if (!P) wait;`                                        |
|                                                                |
| LOCK CHOICE                                                    |
|   reads >> writes, long CS       -> RWMutex                    |
|   reads >> writes, short CS      -> plain Mutex or atomic snap |
|   1-time init                    -> sync.Once / call_once      |
|   layered API self-call          -> refactor; not recursive    |
|                                                                |
| CACHE LINES                                                    |
|   typical: 64 B  (x86, ARM); 128 B (some POWER)                |
|   pad hot atomics with `alignas(64)` / `pad[64]`               |
|                                                                |
| LOCK-FREE WARNINGS                                             |
|   ABA   -> hazard ptrs / epochs / tagged ptrs                  |
|   live  -> add backoff; consider fallback lock                 |
|   recl. -> never free under racing readers                     |
+----------------------------------------------------------------+
```

---

## Summary

- A memory model is the contract that makes concurrent code analyzable. SC is the theoretical baseline; TSO (x86) and weak (ARM/POWER) are what you actually run on.
- `volatile` in C/C++ is for I/O; `std::atomic` is for concurrency. Java's `volatile` is acquire-release; do not confuse the two languages' keywords.
- CAS is the universal RMW. LL/SC is the ARM/POWER equivalent. CAS loops + backoff build counters, stacks, queues.
- Acquire-release is the cheap, expressive ordering. `seq_cst` is the safe default. Use weaker orders only when measured.
- Condvars require a mutex and a `while`-predicate loop. Always. Spurious wakeups are real.
- RWMutex pays off when reads dominate and CSes are long. Otherwise plain mutex wins. Watch writer starvation.
- Lock granularity is a tuning knob: coarse, fine, striped, lock-free, in order of complexity.
- False sharing is invisible until you measure. Pad hot atomics to a cache line.
- JMM, C++ MM, and Go MM differ in defaults and granularity. Read your language's spec once.

## What You Can Build

- A thread-safe LRU cache: striped map + RWMutex per stripe + atomic hit/miss counters.
- A bounded blocking queue with mutex+2 condvars, generalized to multi-producer multi-consumer.
- A fast counter array padded against false sharing, summed periodically into a global stat.
- A spinlock-based critical section for sub-microsecond work, with TSan tests.
- A `sync.Once`-style lazy initializer in C (atomic flag + mutex + correct ordering).
- A double-checked lazy singleton in Java using `volatile` + DCL.
- An RWMutex with anti-starvation: track waiting writers, block new readers when one is pending.
- A Treiber stack guarded by epoch-based reclamation, with tests under TSan + ARM.
- A diagnostic harness that reproduces the message-passing reordering example on ARM and shows it works on x86.

## Further Reading

- Hans Boehm — *Threads Cannot be Implemented as a Library* (PLDI 2005). The paper that motivated the C++ memory model.
- Sarita Adve and Hans Boehm — *Memory Models: A Case for Rethinking Parallel Languages and Hardware* (CACM 2010).
- Doug Lea — *The JSR-133 Cookbook for Compiler Writers*.
- Maurice Herlihy and Nir Shavit — *The Art of Multiprocessor Programming*. Chapter 7 covers spinlocks and Chapter 10 covers lock-free queues in detail.
- Paul McKenney — *Is Parallel Programming Hard, And, If So, What Can You Do About It?* Free book; the definitive reference for low-level concurrency on Linux.
- *cppreference: std::memory_order* — the canonical reference for orderings.
- The Go memory model document — short, official, periodically updated.
- Preshing on Programming — blog series: "An Introduction to Lock-Free Programming," "Memory Reordering Caught in the Act."
- Ulrich Drepper — *What Every Programmer Should Know About Memory*. Cache lines, false sharing, NUMA.

## Related Topics

- [Junior level: Shared-Memory Concurrency](junior.md)
- [Senior level: Shared-Memory Concurrency](senior.md)
- [Professional level: Shared-Memory Concurrency](professional.md)
- [Interview questions: Shared-Memory Concurrency](interview.md)
- [Tasks: Shared-Memory Concurrency](tasks.md)
- [Mutexes (middle)](../../02-primitives/01-mutex/middle.md)
- [Atomics (middle)](../../02-primitives/04-atomic/middle.md)
- [Race conditions (middle)](../../05-race-conditions/middle.md)

## Diagrams & Visual Aids

### Acquire-release publication

```
Writer thread                         Reader thread
-------------                         -------------
data = 42;                            while (!flag.load(acquire)) {}
flag.store(true, release);  ---->     use(data);   // sees 42, guaranteed
                                          ^
       release-acquire forms a happens-before edge
       across the dashed boundary; everything above
       the release is visible to everything below
       the acquire.
```

### Condvar state machine

```
        +-----------+   wait (release lock, sleep)
        |  HOLDING  | ----------------+
        |   LOCK    |                 v
        +-----------+           +-----------+
              ^                 |  SLEEPING |
              |                 | ON CONDVAR|
       wait returns:            +-----------+
       lock reacquired                 |
              |                        | signal / broadcast
              |                        v
              |                 +-----------+
              +---------------- |  WOKEN,   |
                                |  WAITING  |
                                |  FOR LOCK |
                                +-----------+

  Rule: when wait returns, ALWAYS re-check predicate.
```

### Cache line and false sharing

```
Cache line (64 bytes) on Core 0 cache
+--+--+--+--+--+--+--+--+
| a |   |   |   | b |   |   |   |     a, b in same line
+--+--+--+--+--+--+--+--+

Core 0 writes a -> cache line owned by Core 0
Core 1 writes b -> cache line must move to Core 1
Core 0 writes a -> cache line bounces back
... ping-pong storm even though a and b are independent

Fix:
+--+--+--+--+--+--+--+--+   +--+--+--+--+--+--+--+--+
| a | pad pad pad pad pad |   | b | pad pad pad pad pad |
+--+--+--+--+--+--+--+--+   +--+--+--+--+--+--+--+--+
   each on its own line; no interference
```

### CAS loop

```
       +-----------------+
       |  load old       |
       +-----------------+
                |
                v
       +-----------------+
       |  compute new    |
       +-----------------+
                |
                v
       +-----------------+   fail
       |  CAS(old -> new)|---------+
       +-----------------+         |
                |                  |
            success                |
                |                  |
                v                  |
            done                   |
                                    \__ retry from load
```

### Memory model strength axis

```
   weak                                                       strong
    |---------- ARM, POWER -------- TSO (x86) -------- SC ----|
    |                                                          |
    |  more reorderings allowed   <---->   fewer reorderings   |
    |  cheaper synchronization    <---->   easier to reason    |
```
