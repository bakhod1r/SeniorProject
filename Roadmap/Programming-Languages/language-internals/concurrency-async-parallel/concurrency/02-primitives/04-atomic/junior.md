# Atomic Operations — Junior Level

> **Topic:** [Atomic Operations](README.md)
> **Focus:** load/store/CAS/fetch-add, why i++ is not atomic

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

Imagine two threads, both incrementing the same shared counter. You expect a clean
final tally — if each thread runs the line `counter++` one million times, you expect
two million at the end. You run the program. You get 1,734,221. You run it again.
You get 1,812,556. The number is different every time, and it is always less than
two million. What happened?

The answer hides inside a single line of code that looks atomic but isn't.
`counter++` reads like one operation to a human, but to the CPU it is three:
**load** the current value from memory into a register, **add** one to that
register, **store** the new value back to memory. If two threads run those three
steps interleaved — both loading the same old value, both adding one, both writing
back the same new value — one increment is silently lost. Multiply that by a
million iterations on two cores, and hundreds of thousands of increments
evaporate.

There are two ways to fix this. The first is a **mutex** (covered in
[`../01-mutex/junior.md`](../01-mutex/junior.md)) — wrap the increment in a lock,
serialize access, problem solved but at the cost of system calls, context
switches, and contention. The second is the subject of this lesson: **atomic
operations**. An atomic operation is one the hardware guarantees executes as a
single, indivisible unit. While one core is performing an atomic increment, no
other core can see the variable in a half-updated state, and no other core can
sneak in its own update between the load and the store. The CPU achieves this
through special instructions — on x86, the `LOCK` prefix; on ARM, load-linked /
store-conditional pairs — that lock the cache line for the duration of the
read-modify-write cycle.

Atomics are the foundation of **lock-free programming**. They are how
high-performance counters, reference-counted smart pointers, lock-free queues,
and the internals of mutexes themselves are built. Every language with a serious
concurrency story exposes them: C11 has `_Atomic int`, C++ has `std::atomic<T>`,
Java has `AtomicInteger`, Go has the `sync/atomic` package, Rust has
`AtomicUsize`, and so on. The vocabulary is the same across languages: **load**,
**store**, **exchange**, **compare-and-swap** (CAS), **fetch-add**. Once you know
those five verbs, you can read atomic code in any language.

This junior-level lesson focuses on the *what* and the *why*. We will show how
`i++` fails, how an atomic counter fixes it, how CAS works at a conceptual level,
and when atomics are the wrong tool. Memory ordering — the deep, subtle question
of *when* a write becomes visible to another thread — is introduced briefly here
and explored in depth in [`middle.md`](middle.md) and [`senior.md`](senior.md).

By the end of this lesson, you will be able to look at a piece of multi-threaded
code, identify whether it has a data race on a shared integer, and reach for
the right tool — an atomic, a mutex, or a redesign — with confidence.

---

## Prerequisites

Before diving in, you should be comfortable with:

- **Threads and shared memory.** What it means for two threads to share a
  variable. If "thread" is a new word, read the
  [threads junior lesson](../../01-foundations/02-threads/junior.md) first.
- **The Mutex primitive.** Atomics are often introduced as "lighter than a
  mutex," so it helps to know what a mutex feels like. See
  [`../01-mutex/junior.md`](../01-mutex/junior.md).
- **Race conditions.** You should know that two threads writing the same
  variable without coordination produces undefined behavior. See
  [`../../05-race-conditions/junior.md`](../../05-race-conditions/junior.md).
- **Basic CPU model.** You don't need assembly fluency, but you should know that
  the CPU has **registers**, that memory is loaded into registers to be operated
  on, and that there are multiple cores each with their own cache.
- **A typed language.** Atomics are typed: `atomic<int>` is different from
  `atomic<long>`. Familiarity with C, C++, Go, Java, or Rust is enough.

If you can write a "hello, world" with two threads in your language of choice,
you are ready.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Atomic** | An operation guaranteed by hardware to execute as one indivisible unit — no thread observes a half-completed state. |
| **CAS** | **Compare-And-Swap.** Atomically: "if the current value equals X, set it to Y; otherwise, leave it alone." Returns whether the swap happened. The cornerstone of lock-free algorithms. |
| **Load** | Atomically read a value from memory. Guarantees you see a complete value, not a torn one. |
| **Store** | Atomically write a value to memory. Guarantees other threads see the complete new value, not a partial write. |
| **Fetch-add** | Atomic read-modify-write: add N to the variable and return the *old* value. The classic atomic-counter primitive. |
| **Exchange** | Atomically swap a new value into a variable and return the previous one. Useful for "claim a token" patterns. |
| **RMW** | **Read-Modify-Write.** Any atomic op that reads, computes, and writes — fetch-add, exchange, CAS are all RMW. |
| **Memory order** | A constraint that controls how an atomic operation synchronizes with operations on *other* variables. Junior takeaway: when in doubt, use the default (sequentially consistent). |
| **Lock-free** | An algorithm where threads make progress without holding mutexes — typically built from atomic CAS loops. |
| **Wait-free** | A stronger guarantee than lock-free: every thread makes progress in a bounded number of steps. Rare. |
| **Cache line** | The unit (typically 64 bytes) the CPU moves between cache and memory. Atomic ops lock a cache line briefly. |
| **LOCK prefix** | An x86 instruction prefix that makes the following instruction atomic across cores. |
| **LL/SC** | **Load-Linked / Store-Conditional.** The ARM and RISC-V mechanism for atomic RMW: load with a "watch," then store only if no one else wrote meanwhile. |
| **Torn read/write** | A non-atomic read or write where another thread sees only some of the bytes — for example, the low half of a 64-bit value updated, the high half not. |
| **Sequential consistency** | The strongest, simplest memory order: every thread sees a single global ordering of all operations. The safe default for beginners. |

---

## Core Concepts

### 1. What "Atomic" Really Means at the Hardware Level

The word *atomic* comes from the Greek *atomos*, meaning "indivisible." In
concurrency, an atomic operation is one the hardware refuses to split into
observable sub-steps. From any other CPU core's perspective, the operation
either has not started yet or has fully completed — there is no in-between
state.

On modern hardware, atomics work through one of two mechanisms:

- **x86 / x86-64:** A `LOCK` prefix on an instruction. When the CPU sees
  `LOCK XADD [counter], 1`, it asserts a signal that locks the relevant cache
  line (or, on very old hardware, the entire memory bus) for the duration of
  the read-modify-write. No other core can read or write that cache line until
  the operation completes.
- **ARM / RISC-V:** **Load-Linked / Store-Conditional** (LL/SC) pairs. The
  load instruction marks the address; the store instruction succeeds only if
  no other core has written to that address since the load. If someone else
  did, the store fails, and your code loops and retries.

Both mechanisms cost more than a plain memory access — typically 10 to 30 CPU
cycles versus 1 — but they cost vastly less than a mutex, which involves
system calls, scheduler interaction, and potential context switches.

### 2. The Basic Operations

Almost every atomics library exposes the same five operations:

- **Load** — atomically read the current value. Guarantees you don't see a
  torn read (where, say, you got the new low 32 bits but the old high 32 bits
  of a 64-bit number).
- **Store** — atomically write a new value. Guarantees no other thread sees a
  half-written result.
- **Exchange** (swap) — atomically write a new value *and* return the old one.
  Useful when you want to "take" the current value and replace it with
  something else in one step.
- **Compare-And-Swap (CAS)** — atomically: "if the variable still equals
  `expected`, set it to `desired`; otherwise, leave it alone and tell me what
  it actually is." Returns success or failure.
- **Fetch-add** (and friends: fetch-sub, fetch-and, fetch-or, fetch-xor) —
  atomically add N and return the previous value. The simplest building block
  for counters.

CAS is the most powerful of the five — every other RMW can be built from a
CAS loop — but fetch-add is the one you'll reach for daily.

### 3. Why `i++` Is NOT Atomic

This is the single most important fact in this lesson. Look at this line:

```c
counter++;
```

It looks like one operation. It is not. The compiler emits three:

```asm
mov  eax, [counter]   ; LOAD: read counter into register eax
inc  eax              ; MODIFY: add 1 to eax
mov  [counter], eax   ; STORE: write eax back to counter
```

Now picture two threads, both running this sequence, on two cores, with the
counter starting at 100:

| Step | Thread A | Thread B | counter |
|------|----------|----------|---------|
| 1 | `mov eax, [counter]` (eax = 100) | | 100 |
| 2 | | `mov eax, [counter]` (eax = 100) | 100 |
| 3 | `inc eax` (eax = 101) | | 100 |
| 4 | | `inc eax` (eax = 101) | 100 |
| 5 | `mov [counter], eax` | | 101 |
| 6 | | `mov [counter], eax` | 101 |

Two threads each performed an increment, but the counter only went from 100 to
101. One increment was silently lost. This is called the **lost update** problem,
and it is what makes naive `counter++` in shared memory produce wrong results.

The fix is `atomic_fetch_add(&counter, 1)`, which the CPU executes as a single
`LOCK XADD` instruction — load, increment, and store all happen as one
indivisible unit, with no possible interleaving.

### 4. The Atomic Counter Pattern — Replacing Mutex+Int

The simplest, most common use of atomics is the **atomic counter**: a shared
integer that many threads increment. Before atomics, you would write:

```c
pthread_mutex_lock(&mutex);
counter++;
pthread_mutex_unlock(&mutex);
```

Three function calls. Potentially a system call. Potentially a context switch
if the mutex is contended. The cost in cycles is in the hundreds, even when
uncontended.

With an atomic, you write:

```c
atomic_fetch_add(&counter, 1);
```

One instruction. Tens of cycles. No system calls. No risk of forgetting to
unlock on an early return.

For a *plain counter with no other state*, this is a strict upgrade. The
trouble starts when the counter participates in a larger invariant — say, you
want to increment two counters together such that they always match. Then the
atomic doesn't help you, because the *combination* of two atomic ops is not
itself atomic. We will come back to this in "When Atomics Are Wrong."

### 5. Why CAS Is the Foundation of Lock-Free

Compare-And-Swap is the Swiss Army knife of atomics. Its signature looks like:

```c
bool atomic_compare_exchange_strong(atomic_T *obj, T *expected, T desired);
```

It atomically does:

```
if (*obj == *expected) {
    *obj = desired;
    return true;
} else {
    *expected = *obj;   // tell the caller what's actually there
    return false;
}
```

With CAS, you can implement *any* atomic operation. To implement an atomic
multiply-by-three on a counter:

```c
int old = atomic_load(&counter);
while (!atomic_compare_exchange_weak(&counter, &old, old * 3)) {
    // CAS failed because someone else updated counter; old now holds the new value
    // loop body runs again with the fresh value
}
```

This is the **CAS loop**, the universal pattern of lock-free programming:
load the current value, compute the desired new value, try to swap it in, and
retry if someone beat you to it. Every lock-free queue, stack, and reference
counter ultimately reduces to one or more CAS loops.

### 6. A First Taste of Memory Ordering

When you write `atomic_load(&x)` and another thread did `atomic_store(&x, 42)`,
you are guaranteed to *eventually* see 42 (or some later value). But what about
*other* variables the storing thread wrote *before* storing 42? Are they
visible too? This is the question of **memory ordering**.

There are several memory orders to choose from. The two endpoints are:

- **`memory_order_seq_cst`** (sequentially consistent) — the strongest. Every
  thread sees a single global order of all atomic operations. Easy to reason
  about. The default in C++, Java, and Rust.
- **`memory_order_relaxed`** — the weakest. Only the atomic operation itself
  is atomic; nothing is said about ordering with other variables. Fastest, but
  almost impossible to reason about correctly.

In between are `acquire`, `release`, `acq_rel`, and `consume`.

**Junior-level takeaway:** Always use the default (sequentially consistent)
until you have measured and proved that a weaker ordering is needed. Premature
relaxation of memory ordering is one of the most common sources of subtle
concurrency bugs in production code. We cover these in depth in
[`middle.md`](middle.md) and [`senior.md`](senior.md).

### 7. Same-Machine vs Cross-Machine

Atomics work because they leverage the hardware's cache coherency protocol —
the mechanism by which all cores in a single CPU agree on the state of memory.
They are a **single-machine** primitive. They do not, and cannot, synchronize
two processes on two different servers across a network.

If you need a "distributed counter" — say, a request counter shared across
ten web servers — atomics are no help. You need a network-coordinated
solution: Redis `INCR`, a SQL database with a serializable transaction, or a
consensus algorithm like Raft. Atomic operations in your language's standard
library will not save you across the wire.

### 8. When Atomics Are Wrong

Atomics solve exactly one problem: making a *single* memory operation
indivisible. They do not solve:

- **Multi-step invariants.** If you must update two counters such that
  `A + B == 100` always holds, two separate atomic ops can never satisfy this.
  Between the first and second op, another thread will observe the broken
  invariant. You need a mutex (or a lock-free algorithm built from CAS, which
  is much harder).
- **Transactional logic.** "Read X, compute Y from X, write Y to X" requires
  the read and the write to be coupled. The CAS loop pattern handles *simple*
  cases of this, but if "compute Y" is expensive or has side effects, retrying
  it many times under contention is wasteful.
- **Complex data structures.** A linked list, a hash map, a tree — these
  have too much state to fit in a single atomic word. You can build lock-free
  versions, but they are research-level work; in production, prefer a mutex
  or a well-tested concurrent library.
- **I/O, file writes, network calls.** Atomicity is a memory concept. The
  filesystem and network have their own atomicity stories (fsync, two-phase
  commit) and atomics will not help you there.

Atomics are best at: counters, flags, single-pointer swaps, and the internal
plumbing of higher-level primitives. Everything else, reach for a mutex or a
proven library first.

---

## Real-World Analogies

**The Turnstile Click.** Imagine a subway turnstile that counts entries.
Every passenger pushes through, and the mechanical counter clicks forward by
one. The click is mechanical: from the outside, the counter either reads N or
N+1, never some half-state. Two passengers cannot pass simultaneously; the
mechanism is physically indivisible. This is exactly `atomic_fetch_add`: a
single, indivisible click that increments a shared count. No matter how many
passengers (threads) arrive at once, the total is exact.

**The Door Buzzer with One Push.** Picture an apartment intercom where a
visitor presses a buzzer to be let in. The button has two states — pressed
and not pressed. The first person to press it triggers the door to unlock; if
two people press it within milliseconds, only the first press matters; the
second is a no-op because the door is already opening. This is
**compare-and-swap**: "if the state is 'closed', set it to 'opening';
otherwise, leave it alone." The first thread to CAS wins; the others see the
state has already changed and move on.

**The Restaurant Ticket Stub.** A bakery hands every customer a paper ticket
with a number. The ticket dispenser has a single counter; ripping off a
ticket increments the counter by one. Two customers cannot rip off the same
ticket — the mechanical detachment is atomic. This is **fetch-add returning
the old value**: each thread gets a unique number, and the counter advances
exactly once per call.

**The Light Switch.** A traditional toggle switch has two positions, ON and
OFF. Flipping it is mechanical; an outside observer sees it as ON or OFF,
never "halfway." This is the **atomic load/store of a flag**: a boolean that
threads can flip and read with no torn-bit nonsense.

---

## Mental Models

**Atomics are a contract with the CPU.** When you mark a variable atomic, you
are telling the compiler: "I will only touch this through the atomic API.
Please emit `LOCK`-prefixed instructions for me, do not optimize my reads
into a single load, do not reorder my writes." In return, the CPU promises
that every read sees a complete value and every write becomes visible to
other threads in finite time.

**Atomics are the assembly language of concurrency.** A mutex is a sentence;
an atomic is a syllable. Mutexes are *built from* atomics (a mutex
implementation typically uses a CAS to acquire its lock word). When you reach
for an atomic, you are operating one level closer to the metal than when you
reach for a mutex.

**Every RMW is a tiny transaction.** A `fetch_add` is a transaction with
exactly one read and one write. A CAS loop is a transaction that you keep
retrying until it commits. Lock-free programming is, fundamentally, the art
of expressing your algorithm as a sequence of tiny single-word transactions
that the hardware can commit atomically.

**The CPU has a budget.** A normal memory access is "free" (1-3 cycles in
cache). An atomic costs 10-30 cycles uncontended, and *much* more under heavy
contention (because the cache line has to ping-pong between cores). A mutex
costs hundreds to thousands of cycles uncontended, millions when it blocks.
Atomics are not free, but they are an order of magnitude cheaper than mutexes
in the common case.

**Default to sequential consistency.** Memory orders are a sharp knife. The
default — `seq_cst` — means "behave as if every thread sees all atomic
operations in a single global order." That is the model you can reason about.
The faster orderings (`relaxed`, `acquire`, `release`) are optimizations you
apply *after* you have working code and a measured bottleneck, not before.

---

## Code Examples

All examples below count to two million by spawning two threads, each running
one million increments. We start with a broken version to make the failure
concrete, then fix it with atomics.

### Broken: Plain `int` Counter in C

```c
// broken_counter.c — compile with: gcc -O2 -pthread broken_counter.c -o broken
// Demonstrates lost updates with non-atomic increment.
#include <stdio.h>
#include <pthread.h>

static long counter = 0;
static const long ITERATIONS = 1000000;

void *worker(void *arg) {
    (void)arg;
    for (long i = 0; i < ITERATIONS; ++i) {
        counter++;   // NOT atomic: load + add + store
    }
    return NULL;
}

int main(void) {
    pthread_t t1, t2;
    pthread_create(&t1, NULL, worker, NULL);
    pthread_create(&t2, NULL, worker, NULL);
    pthread_join(t1, NULL);
    pthread_join(t2, NULL);
    printf("expected: %ld, got: %ld\n", 2 * ITERATIONS, counter);
    return 0;
}
```

Run it a few times. The output will be different each time, and always
less than 2,000,000. The lost-update problem in action.

### Fixed: `atomic_int` Counter in C (C11)

```c
// atomic_counter.c — compile with: gcc -O2 -pthread atomic_counter.c -o atomic
// Same program but using C11 atomics.
#include <stdio.h>
#include <pthread.h>
#include <stdatomic.h>

static atomic_long counter = 0;
static const long ITERATIONS = 1000000;

void *worker(void *arg) {
    (void)arg;
    for (long i = 0; i < ITERATIONS; ++i) {
        atomic_fetch_add(&counter, 1);   // single LOCK XADD instruction
    }
    return NULL;
}

int main(void) {
    pthread_t t1, t2;
    pthread_create(&t1, NULL, worker, NULL);
    pthread_create(&t2, NULL, worker, NULL);
    pthread_join(t1, NULL);
    pthread_join(t2, NULL);
    printf("expected: %ld, got: %ld\n", 2 * ITERATIONS, atomic_load(&counter));
    return 0;
}
```

Run it as many times as you like — the output is always exactly 2,000,000.

### Go: `sync/atomic.AddInt64`

```go
// atomic_counter.go — go run atomic_counter.go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var counter int64
    const iterations = 1_000_000
    var wg sync.WaitGroup

    for i := 0; i < 2; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < iterations; j++ {
                atomic.AddInt64(&counter, 1)
            }
        }()
    }
    wg.Wait()

    fmt.Printf("expected: %d, got: %d\n", 2*iterations, atomic.LoadInt64(&counter))
}
```

Note that Go 1.19+ also provides `atomic.Int64`, a typed wrapper:

```go
var counter atomic.Int64
counter.Add(1)
fmt.Println(counter.Load())
```

The typed version is preferred in new code — it prevents you from accidentally
reading the counter with a non-atomic load.

### Java: `AtomicInteger.incrementAndGet`

```java
// AtomicCounter.java — javac AtomicCounter.java && java AtomicCounter
import java.util.concurrent.atomic.AtomicInteger;

public class AtomicCounter {
    private static final AtomicInteger counter = new AtomicInteger(0);
    private static final int ITERATIONS = 1_000_000;

    public static void main(String[] args) throws InterruptedException {
        Thread t1 = new Thread(AtomicCounter::work);
        Thread t2 = new Thread(AtomicCounter::work);
        t1.start();
        t2.start();
        t1.join();
        t2.join();
        System.out.printf("expected: %d, got: %d%n", 2 * ITERATIONS, counter.get());
    }

    private static void work() {
        for (int i = 0; i < ITERATIONS; i++) {
            counter.incrementAndGet();
        }
    }
}
```

`AtomicInteger` is implemented on top of `sun.misc.Unsafe.compareAndSwapInt`
(or `VarHandle` in modern Java), which compiles to `LOCK CMPXCHG` on x86.

### C++: `std::atomic<int>::fetch_add`

```cpp
// atomic_counter.cpp — g++ -O2 -pthread -std=c++17 atomic_counter.cpp -o atomic
#include <atomic>
#include <iostream>
#include <thread>

static std::atomic<long> counter{0};
static constexpr long ITERATIONS = 1'000'000;

void worker() {
    for (long i = 0; i < ITERATIONS; ++i) {
        counter.fetch_add(1);   // default memory_order_seq_cst
    }
}

int main() {
    std::thread t1(worker);
    std::thread t2(worker);
    t1.join();
    t2.join();
    std::cout << "expected: " << 2 * ITERATIONS
              << ", got: " << counter.load() << "\n";
    return 0;
}
```

Note: `counter++` *is* atomic here because `std::atomic` overloads `operator++`
to call `fetch_add(1)`. This is convenient but can mask the cost of the
operation from readers — many style guides recommend writing `fetch_add`
explicitly so the atomicity is visible.

### Rust: `AtomicUsize::fetch_add`

```rust
// atomic_counter.rs — rustc -O atomic_counter.rs && ./atomic_counter
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;

const ITERATIONS: usize = 1_000_000;

fn main() {
    let counter = Arc::new(AtomicUsize::new(0));
    let mut handles = vec![];

    for _ in 0..2 {
        let c = Arc::clone(&counter);
        handles.push(thread::spawn(move || {
            for _ in 0..ITERATIONS {
                c.fetch_add(1, Ordering::SeqCst);
            }
        }));
    }

    for h in handles {
        h.join().unwrap();
    }

    println!(
        "expected: {}, got: {}",
        2 * ITERATIONS,
        counter.load(Ordering::SeqCst)
    );
}
```

Rust forces you to specify a memory ordering on every atomic operation — there
is no default. `Ordering::SeqCst` is the conservative choice while learning.

### A CAS Loop: Atomic Maximum in Go

Sometimes you need an atomic operation the library doesn't provide. Suppose
you want to track the maximum value any thread has seen. There's no
`atomic.MaxInt64`, so you write a CAS loop:

```go
func atomicMax(addr *int64, val int64) {
    for {
        old := atomic.LoadInt64(addr)
        if val <= old {
            return // already at least as large
        }
        if atomic.CompareAndSwapInt64(addr, old, val) {
            return // we won the race
        }
        // CAS failed; someone else updated. Loop and retry.
    }
}
```

This is the universal CAS-loop pattern: load, compute, try to swap, retry on
failure. Every lock-free algorithm is some variation on this theme.

---

## Pros & Cons

**Pros:**

- **Speed.** An atomic op is roughly 10-30x cheaper than a mutex acquire/release
  cycle in the uncontended case. For hot counters, this matters.
- **No deadlock.** A single atomic operation cannot deadlock — there is no lock
  to acquire in a particular order. (CAS loops can *livelock* under heavy
  contention, but not deadlock.)
- **Simpler error handling.** No "did I forget to release the lock?" question.
  The operation completes atomically; there is no "in progress" state to clean
  up if an exception fires elsewhere.
- **Foundation for higher-level primitives.** If you ever want to implement a
  mutex, semaphore, or lock-free queue, you'll be doing it with atomics.
- **Async-signal safety (on some platforms).** Atomic loads/stores of small
  types are typically safe to use from signal handlers, where mutexes
  generally are not.

**Cons:**

- **Limited expressiveness.** Atomics protect *one variable at a time*.
  Compound invariants over multiple variables require either a mutex or a much
  more complex lock-free algorithm.
- **Memory ordering is subtle.** The default (sequentially consistent) is safe
  but slow; the fast orderings are correct only for certain patterns. Getting
  this wrong produces bugs that appear randomly under load, on some CPU
  architectures and not others.
- **Cache-line contention.** When many threads hammer the same atomic, the
  cache line bounces between cores. The atomic stays correct, but throughput
  collapses. This is called **cache-line ping-ponging**.
- **Wider RMW can be slow under contention.** Under heavy contention, CAS
  loops retry repeatedly; the wasted work can be worse than just taking a
  mutex.
- **Hard to debug.** When something goes wrong with relaxed-order atomics, the
  bug may only manifest on weakly-ordered hardware (ARM, POWER), not on x86.
  Code that "works" on your laptop can fail on a phone.

---

## Use Cases

- **Counters and statistics.** Request counters, hit counters, error counters,
  bytes-transferred totals. Any case where many threads increment a number
  many times.
- **Flags.** "Is the server shutting down?" "Has initialization completed?"
  A single boolean read and written across threads.
- **Sequence numbers.** Allocating unique IDs to log entries, transactions,
  or tickets. `fetch_add` produces a stream of unique increasing values.
- **Reference counts.** Smart pointers (`shared_ptr`, `Arc`) use atomic
  refcounts so that "increment when copied, decrement when dropped, free when
  zero" is thread-safe.
- **Spinlocks.** The lock word itself is typically a single atomic that
  threads CAS against to acquire.
- **Lock-free queues and stacks.** High-performance data structures built
  entirely on atomic pointer manipulation, with no mutex anywhere.
- **Lazy initialization.** Double-checked locking patterns where a `done`
  flag is read atomically before deciding whether to take the slow path.
- **Token claiming.** Exchange to atomically "take" a resource (e.g., the
  current head of a free list) and replace it with a sentinel.

---

## Coding Patterns

### Pattern: Atomic Counter

```go
var requests atomic.Int64

func handleRequest() {
    requests.Add(1)
    // ... do work ...
}

func reportStats() {
    fmt.Printf("served %d requests\n", requests.Load())
}
```

The simplest possible use. Replaces `mutex + int`.

### Pattern: Shutdown Flag

```cpp
std::atomic<bool> shouldStop{false};

void worker() {
    while (!shouldStop.load()) {
        doOneUnitOfWork();
    }
}

void signalShutdown() {
    shouldStop.store(true);
}
```

Workers poll an atomic flag and exit when it flips. Cheap and correct.

### Pattern: Compare-And-Swap Loop

```java
AtomicReference<Node> head = new AtomicReference<>();

void push(int value) {
    Node newNode = new Node(value);
    Node oldHead;
    do {
        oldHead = head.get();
        newNode.next = oldHead;
    } while (!head.compareAndSet(oldHead, newNode));
}
```

The Treiber stack `push`: read the current head, point your new node at it,
try to swap your new node in as the head, retry on conflict. Classic
lock-free pattern.

### Pattern: One-Shot Initialization

```rust
use std::sync::atomic::{AtomicBool, Ordering};

static INITIALIZED: AtomicBool = AtomicBool::new(false);

fn init_once() {
    if INITIALIZED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        // We were the first; do the initialization
        do_expensive_setup();
    }
    // Else: someone else already did (or is doing) it
}
```

Use CAS to ensure exactly one thread runs the initialization. (For production,
prefer `std::sync::Once` / `OnceLock`, which handles edge cases.)

### Pattern: Atomic Maximum / Minimum

Shown above in the Go example. Always a CAS loop because there is no single
hardware instruction for "atomic max."

### Pattern: Token Take (Exchange)

```go
var token atomic.Int32

// Producer sets a token
token.Store(42)

// Consumer takes the token, leaving 0
old := token.Swap(0)
if old != 0 {
    process(old)
}
```

`Swap` (exchange) atomically replaces the value and returns the previous one.
Used when "the value is the work" — taking it removes it from circulation.

---

## Clean Code

- **Name the variable for its role, not its type.** `requestCount`, not
  `atomicInt`. The reader needs to know the *meaning*; the type is in the
  declaration.
- **Wrap atomics in domain types when possible.** Instead of exposing an
  `AtomicLong requestCount` directly, write a small `RequestStats` class with
  `incrementRequest()` and `getRequestCount()` methods. Future you can change
  the storage without changing the call sites.
- **Prefer the typed atomic wrapper.** In Go, `atomic.Int64` over
  `int64 + atomic.AddInt64`. In Java, `AtomicInteger` over `volatile int`. The
  typed wrapper makes it impossible to accidentally do a non-atomic read.
- **Comment the contract.** When a variable is atomic for non-obvious reasons,
  say so: `// fetch_add: each call must return a unique sequence number`. The
  next reader will not have to guess why you reached for an atomic.
- **Don't mix atomic and non-atomic access.** If a field is atomic, *all*
  reads and writes must go through the atomic API. Even one stray `field = x`
  reintroduces the race.
- **Hide CAS loops behind small helpers.** A naked CAS loop in business logic
  is an eyesore. Wrap it in `atomicMax`, `lazyInit`, or `pushFront` and let
  the caller think in domain terms.

---

## Best Practices

- **Default to sequentially consistent ordering.** Get correctness first; tune
  ordering later, only if profiling shows the atomic is a bottleneck.
- **Pair atomic counters with non-atomic snapshots for reporting.** If you
  need a precise snapshot of many counters at once, briefly take a lock
  around them all — a single atomic read of each is not consistent across
  the group.
- **Beware false sharing.** If you put two unrelated atomics in the same
  cache line, updates to one will invalidate the cache line for threads using
  the other. Pad hot atomics to their own cache line (typically 64 bytes).
- **Profile contention.** A "free" atomic on paper becomes catastrophically
  slow under heavy contention. Tools like `perf c2c` (Linux), Intel VTune,
  and Java Flight Recorder can show cache-line ping-ponging.
- **Don't reinvent lock-free data structures.** A correct lock-free queue is
  a research paper. Use a vetted library (e.g., Java's
  `ConcurrentLinkedQueue`, C++'s Boost.Lockfree, Go's channels).
- **Document the protocol.** When several atomics interact, write down the
  intended ordering, even informally. A `// invariant: head is updated after
  next` comment can save the next maintainer hours.
- **Test on weak-memory hardware.** If you ship to mobile (ARM) or large
  servers (POWER, modern ARM), test there. x86's strong memory model can
  hide bugs that ARM exposes.

---

## Edge Cases & Pitfalls

- **64-bit atomics on 32-bit machines.** On a 32-bit platform, a 64-bit
  read or write may be implemented as two 32-bit ops and may not be naturally
  atomic. Use the explicit atomic API — never rely on alignment alone.
- **Alignment matters.** Many platforms require atomics to be naturally
  aligned (a 64-bit atomic must sit on an 8-byte boundary). Using `std::atomic`
  / `atomic_int` typically handles this for you; raw pointer casts may not.
- **`volatile` is not `atomic`.** In C and C++, `volatile` prevents the
  compiler from optimizing away accesses, but provides no atomicity or memory
  ordering across threads. In Java, `volatile` does provide some ordering
  guarantees, but is still weaker than `AtomicInteger` and lacks RMW. Always
  use the dedicated atomic type for cross-thread sharing.
- **ABA problem in CAS.** A CAS sees the value `A`, then the value flips to
  `B` and back to `A` while you were computing. Your CAS succeeds but the
  state has changed underneath you. Common in lock-free pointer manipulation.
  Mitigated with tagged pointers, hazard pointers, or generation counters —
  covered in [`senior.md`](senior.md).
- **Spurious failure of weak CAS.** `compare_exchange_weak` can fail even
  when the value matches, on platforms with LL/SC (ARM). Always call it in a
  loop. Use `compare_exchange_strong` for one-shot CAS.
- **Returning from inside a CAS loop.** Make sure every path either commits
  or retries. An accidental early return on failure leaks the partial update.
- **Mixing atomic types and sizes.** An atomic load of an `int` cannot read a
  store of a `long`. Keep the types consistent.

---

## Common Mistakes

- **Thinking `counter++` is atomic.** It is not, in any of C, C++, Java
  (`int`), Go, Rust. (Java `int` reads/writes are atomic for the *type*, but
  the `++` is still load+add+store and races.)
- **Using a mutex *and* an atomic on the same variable.** Pick one. Mixing
  protocols nearly always produces a race.
- **Reading an atomic without the atomic API.** A direct `counter` read in C
  defeats the purpose. Always use `atomic_load`.
- **Treating two atomic ops as one.** `a.Add(1); b.Add(1);` is two separate
  atomic operations. Another thread can observe `a` updated but not `b`. If
  the pair must be consistent, you need a mutex.
- **Assuming ordering you didn't ask for.** With relaxed ordering, a write
  to `x` and a write to `y` may become visible to other threads in any order.
  Don't assume FIFO unless you used `seq_cst`.
- **Cache-padding too aggressively.** Padding every atomic to a cache line
  wastes memory; only pad ones that are demonstrably hot.
- **Forgetting `volatile` on raw atomic pointers in C.** When passing the
  address of an atomic to a function, the function signature should accept
  `_Atomic int *`, not `int *`. Casting away the atomicity is undefined
  behavior.

---

## Tricky Points

- **Read-only access still goes through the atomic API.** Even reading,
  use `atomic_load` / `.Load()` / `.get()`. Direct field access may produce a
  torn read or be optimized into a single load that the compiler hoists out
  of a loop.
- **CAS loops can livelock.** Under heavy contention, threads may keep
  failing their CAS forever. Algorithms that need progress guarantees use
  back-off (sleep a tiny amount on failure) or queue-based designs.
- **`load` on `seq_cst` is not free.** A `seq_cst` load typically requires
  a full memory barrier — much more expensive than a normal load. Workloads
  with heavy atomic reads sometimes benefit from `acquire` ordering instead.
- **The compiler can still optimize around atomics in surprising ways.**
  `atomic_load` followed by `atomic_load` of the same variable may not be
  combined, but the compiler can still reorder other code around them.
- **`bool` atomics may be 1 byte, may be 4.** On some platforms, atomic
  booleans are promoted to int-sized for performance. Don't assume
  `sizeof(atomic<bool>) == 1`.

---

## Test Yourself

1. Why does `counter++` fail when shared between threads, even though it is
   one line of code?
2. Name the five basic atomic operations.
3. Why is CAS more powerful than fetch-add?
4. What is a CAS loop, and why must it loop?
5. When would you use a mutex instead of an atomic, even if the atomic is
   faster?
6. What memory order should you use by default as a beginner?
7. Two threads each call `atomic.Add(&counter, 1)` a million times. What is
   the final value?
8. Two threads each call `atomic.Add(&a, 1); atomic.Add(&b, 1)`. After both
   finish, are `a` and `b` always equal at every observation point?
9. What is the ABA problem, and which operation is vulnerable to it?
10. Why is `volatile` in C not a substitute for `atomic`?

---

## Tricky Questions

- **"If atomics are faster than mutexes, why don't we use them for everything?"**
  Because they protect only single-word operations. Most real-world
  invariants involve multiple variables, and stitching atomics into a correct
  multi-word protocol is the domain of lock-free algorithm research, not
  daily application code.

- **"Is `atomic_int x = 5; x = 6;` atomic?"** In C++ and C, assignment to a
  `std::atomic` / `atomic_int` *is* atomic — the type overloads `operator=`.
  But this can be confusing because the same syntax on a plain `int` is
  *not* atomic. Use the explicit `x.store(6)` / `atomic_store(&x, 6)` form
  when clarity matters.

- **"If two threads CAS to the same value, which one 'wins'?"** Whichever
  one's CAS commits first wins. The other sees its CAS fail (the value
  changed between its load and its CAS), and typically retries with the new
  observed value. Both threads make progress; one just runs an extra
  iteration.

- **"Can atomics deadlock?"** A single atomic operation cannot deadlock — it
  has no concept of waiting. A *CAS loop* can livelock under extreme
  contention, but livelock is recoverable (it just wastes CPU); deadlock,
  where all threads are blocked forever, requires lock-style waiting.

- **"What's the difference between `volatile` and `atomic` in Java?"**
  Both give ordering guarantees, but only `atomic` gives RMW. With
  `volatile int x`, the expression `x++` still races. With `AtomicInteger x`,
  `x.incrementAndGet()` is safe.

- **"Why do I need atomics on x86, where word-sized writes are already
  atomic?"** Two reasons. First, the *compiler* can still reorder code
  around your write, or optimize it away entirely; the atomic type tells the
  compiler not to. Second, RMW operations like `++` are not single
  instructions on x86 by default — they decompose into separate load and
  store unless you use the `LOCK` prefix, which is exactly what the atomic
  API emits.

- **"Are atomics safe across processes that share memory?"** Yes, if the
  shared memory is mapped as such (e.g., `MAP_SHARED` `mmap`) and the same
  atomic type is used by both processes. The hardware sees the cache line
  the same way regardless of which process owns the virtual page.

---

## Cheat Sheet

| Need | Use |
|------|-----|
| Increment a counter | `fetch_add(1)` / `AddInt64` / `incrementAndGet` |
| Decrement a counter | `fetch_sub(1)` |
| Read current value | `load` / `Load` / `get` |
| Write a new value | `store` / `Store` / `set` |
| Swap and get old | `exchange` / `Swap` / `getAndSet` |
| "Set X only if it was Y" | `compare_exchange` / `CompareAndSwap` / `compareAndSet` |
| Atomic max / min / arbitrary update | CAS loop |
| Default memory order | sequentially consistent |
| Counter shared across machines | NOT atomics — use Redis / DB / consensus |
| Compound invariant on two variables | NOT atomics — use a mutex |

| Language | Type | Increment |
|----------|------|-----------|
| C11 | `atomic_int` / `atomic_long` | `atomic_fetch_add(&x, 1)` |
| C++ | `std::atomic<int>` | `x.fetch_add(1)` or `x++` |
| Go | `atomic.Int64` (or `int64 + atomic.AddInt64`) | `x.Add(1)` |
| Java | `AtomicInteger` / `AtomicLong` | `x.incrementAndGet()` |
| Rust | `AtomicUsize` / `AtomicI64` | `x.fetch_add(1, Ordering::SeqCst)` |

---

## Summary

An atomic operation is one the CPU executes as a single indivisible step —
no thread can ever observe a half-completed state. The five core operations
(**load**, **store**, **exchange**, **compare-and-swap**, **fetch-add**) are
provided by every serious language: `atomic_int` in C, `std::atomic<T>` in
C++, `AtomicInteger` in Java, `sync/atomic` in Go, `AtomicUsize` in Rust.
They cost ten to thirty CPU cycles, an order of magnitude cheaper than a
mutex, and are the foundation of every lock-free algorithm and high-throughput
counter.

The single most important fact: **`counter++` is not atomic**. It is load,
add, store — three steps that can interleave with other threads' loads and
stores and silently lose updates. The fix is `atomic_fetch_add`, which the
CPU executes as one indivisible `LOCK XADD` (or LL/SC pair). This is the
canonical replacement for `mutex + int` when all you want is a counter.

For anything more complex — invariants over multiple variables, transactional
logic, large data structures — atomics alone are not enough. Either reach
for a mutex or use a vetted lock-free library. And remember: atomics
synchronize *one machine*; for cross-machine consensus, you need a network
protocol.

Memory ordering — when a write to one atomic becomes visible relative to
writes to other variables — is a deep topic introduced here only briefly.
At the junior level, always use the default sequentially consistent
ordering. Optimizing memory order is a senior-level skill, and getting it
wrong produces bugs that only show up on certain CPUs under load.

Atomics are not magic; they are a sharp, narrow tool. Used correctly, they
make hot paths flyingly fast. Used as a substitute for proper synchronization
of complex state, they produce some of the most subtle bugs in the field.
Master the counter, the flag, and the CAS loop, and you have the foundation
of every higher concurrent abstraction.

---

## What You Can Build

- **A request-per-second counter** for a web server: one atomic per server,
  incremented per request, sampled by a stats endpoint.
- **A unique ID generator** that hands out monotonically increasing 64-bit
  IDs across threads with no central coordinator.
- **A shutdown flag** that allows worker threads to gracefully exit when the
  main thread asks them to stop.
- **A spinlock** implemented in twenty lines using a single atomic boolean
  and CAS.
- **An atomic reference counter** for a custom smart pointer or shared
  resource.
- **A wait-free single-producer, single-consumer ring buffer** for
  low-latency producer/consumer hand-offs.
- **A lock-free Treiber stack** for a free-list allocator or a fast
  worker-task queue.
- **A "first one wins" initializer** for lazy singletons that must run setup
  exactly once.

---

## Further Reading

- C++ Concurrency in Action (Anthony Williams) — chapters 5 and 7 on
  atomics and lock-free data structures.
- The Art of Multiprocessor Programming (Herlihy & Shavit) — the
  foundational textbook on concurrent algorithms.
- Preshing on Programming (blog) — accessible essays on lock-free patterns,
  memory ordering, and CAS.
- C++ Reference: `<atomic>` — the canonical API docs, even useful if you
  write Go or Java.
- Go documentation: `sync/atomic` package.
- Java documentation: `java.util.concurrent.atomic`.
- Rust documentation: `std::sync::atomic`.
- "Memory Barriers: A Hardware View for Software Hackers" (Paul McKenney)
  — the classic explainer for the hardware side of atomics.
- LWN.net articles on the Linux kernel's atomic primitives.

---

## Related Topics

- [Atomic Operations — Middle Level](middle.md)
- [Atomic Operations — Senior Level](senior.md)
- [Atomic Operations — Professional Level](professional.md)
- [Atomic Operations — Interview Prep](interview.md)
- [Atomic Operations — Practice Tasks](tasks.md)
- [Mutex — Junior Level](../01-mutex/junior.md)
- [Condition Variables — Junior Level](../03-condition-variables/junior.md)
- [Race Conditions — Junior Level](../../05-race-conditions/junior.md)

---

## Diagrams & Visual Aids

**The lost update with non-atomic `i++`:**

```
Time --->

Thread A:   LOAD(100)   ADD                     STORE(101)
Thread B:               LOAD(100)   ADD                     STORE(101)
counter:    100         100         100         101         101

Expected after two increments: 102
Actually got:                  101
One increment LOST.
```

**Atomic fetch-add — no interleaving possible:**

```
Time --->

Thread A:   [LOCK XADD: load+add+store as one]
Thread B:                                       [LOCK XADD: load+add+store as one]
counter:    100 ------> 101 ------------------> 102

Both increments visible. Result is exact.
```

**The CAS loop, conceptually:**

```
        +-----------------------------+
        |  load current value (old)   |
        +-----------------------------+
                      |
                      v
        +-----------------------------+
        |  compute desired (new)      |
        +-----------------------------+
                      |
                      v
        +-----------------------------+
        |  CAS(old -> new)            |
        +-----------------------------+
                |          |
        success |          | failure (someone changed it)
                v          v
            (commit)   (retry from top)
```

**Cache-line ping-pong under contention:**

```
   Core 0        Core 1        Core 2        Core 3
     |             |             |             |
     | fetch_add   |             |             |
     |---LOCK----->|             |             |
     |  cache line |             |             |
     |  bounces -->|             |             |
     |             | fetch_add   |             |
     |             |---LOCK----->|             |
     |             |             | fetch_add   |
     |             |             |---LOCK----->|
     |             |             |             |
     v             v             v             v

Every atomic operation invalidates the cache line on every other core.
Under heavy contention, throughput collapses — the atomic is still
correct, but slow.
```

**When to use atomic vs mutex vs nothing:**

```
Shared variable?
   |
   no -> use a plain local; you're done.
   |
   yes
   |
   v
Only ever read? (never written after init)
   |
   yes -> use a plain const / final; you're done.
   |
   no
   |
   v
Single integer or pointer, no compound invariant?
   |
   yes -> use an ATOMIC.
   |
   no
   |
   v
Invariant over multiple fields? Complex protocol?
   |
   yes -> use a MUTEX.
   |
   no -> redesign; share less.
```
