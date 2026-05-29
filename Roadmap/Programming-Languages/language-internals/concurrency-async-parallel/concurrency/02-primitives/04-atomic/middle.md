# Atomic Operations — Middle Level

> **Topic:** [Atomic Operations](README.md)
> **Focus:** memory ordering, CAS loops, ABA, lock-free intro

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

At the junior level you learned that atomic operations are indivisible — a load
or store cannot be torn in half by another thread, and a compare-and-swap
either succeeds completely or fails completely. That is the *correctness*
half of the story. The performance half — and most of the bugs in real
lock-free code — comes from a second, less obvious property: **memory
ordering**.

Modern CPUs and modern compilers both reorder memory operations aggressively.
The CPU has store buffers, load queues, and out-of-order execution. The
compiler hoists, sinks, and merges loads and stores. Both transformations are
safe within a single thread because the as-if rule preserves single-threaded
observable behaviour. Across threads, the same transformations can make a
correct-looking program produce results that are impossible under any
sequential interleaving of source-level statements.

Atomic operations are therefore two-in-one tools. They provide indivisibility
*and* they emit memory fences — barriers that constrain how loads and stores
on either side may be reordered. The middle level is about learning to choose
the right ordering, recognise where a CAS loop is the natural pattern, and
spot the classic traps such as the ABA problem and broken double-checked
locking.

This document walks through the memory model of C++ and Java side by side,
because most teams hit one or both, and the differences matter. We then build
a real lock-free data structure — a Treiber stack — in both languages,
demonstrate the ABA problem on it, and discuss the techniques that mitigate
ABA in production: tagged pointers, version counters, and hazard pointers.

By the end of this page you should be able to read a piece of lock-free code,
identify every memory order tag, explain why it is correct (or why it is
wrong), and write a CAS loop with confidence.

---

## Prerequisites

Before tackling this material you should be comfortable with:

- The junior-level atomics page: what `atomic<T>` means, what CAS does, why a
  non-atomic increment is a race.
- Basic concurrency: threads, joins, the idea of a data race.
- C++ templates and `std::atomic<T>` syntax at a surface level.
- Java `AtomicInteger`, `AtomicReference`, `volatile`.
- Pointers and references in both languages.
- The notion of a *happens-before* relation, even informally.

You do **not** yet need:

- Full formal knowledge of the C++ memory model or the JMM. We will introduce
  the parts you need as we go.
- Lock-free queues, RCU, or epoch-based reclamation. Those are senior topics.

---

## Glossary

- **Acquire** — an ordering on a load. No subsequent load or store may be
  reordered before this load. Pairs with a release store.
- **Release** — an ordering on a store. No prior load or store may be
  reordered after this store. Pairs with an acquire load.
- **Acq_rel** — applied to a read-modify-write operation. The read half acts
  acquire, the write half acts release.
- **Relaxed** — atomic with respect to the variable itself (no torn reads or
  lost updates on that one location) but no ordering relative to other
  variables. Cheapest tag.
- **Seq_cst** — sequentially consistent. There is a single total order over
  all seq_cst operations that all threads agree on. Strongest and most
  expensive tag.
- **CAS loop** — a `while (!cas(...))` pattern that retries on failure,
  building higher-level atomic primitives from compare-and-swap.
- **ABA problem** — a CAS observes the same value twice and concludes nothing
  changed, but in fact the value went A then B then back to A. The CAS
  succeeds when it should have failed.
- **Double-CAS / DCAS** — a CAS that atomically compares two locations and
  swaps both. Rare in hardware; usually emulated via tagged pointers.
- **Tagged pointer** — a pointer plus an extra counter packed into the same
  word so CAS compares both at once. Cheap defence against ABA.
- **Hazard pointer** — a per-thread published pointer that says "I am about
  to dereference this; do not free it." Used for safe memory reclamation in
  lock-free code.
- **RMW** — read-modify-write. A single atomic step that loads a value,
  computes a new one, and stores it. Includes CAS, fetch-add, fetch-or, swap.
- **Spurious failure** — a CAS that returns false even though the observed
  value equalled the expected value. Allowed for `compare_exchange_weak`.
- **JMM** — the Java Memory Model.

---

## Core Concepts

### Memory ordering: a quick tour

C++ exposes six memory orders: `relaxed`, `consume`, `acquire`, `release`,
`acq_rel`, and `seq_cst`. We will ignore `consume` — it is widely
unimplemented and currently equivalent to `acquire` in practice. That leaves
five tags worth memorising.

**Relaxed** gives you indivisibility on the variable being touched. Two
threads racing on a relaxed counter will produce a correct count: no
increment is lost. But relaxed says *nothing* about the order in which other
threads see updates to *other* variables. A relaxed store followed by a
relaxed store can be observed in reverse order by another thread.

**Acquire** is a constraint on loads. After an acquire load reads value `v`
from a location, every subsequent operation in that thread sees at least the
state that the writing thread had committed when it produced `v`. Acquire
prevents subsequent operations from sinking above the load.

**Release** is a constraint on stores. Before a release store writes `v`, all
preceding operations in that thread are visible to any thread that performs
an acquire load and reads `v`. Release prevents preceding operations from
floating below the store.

Acquire and release pair across threads. The producer does a release store,
the consumer does an acquire load, and *if* the consumer reads the producer's
value (or a later one in the modification order of that variable) then
everything the producer did before the store happens-before everything the
consumer does after the load.

**Acq_rel** is the obvious combination, applied to a RMW. A CAS with
`acq_rel` ordering acts acquire on its load half and release on its store
half. This is what you want for CAS loops that publish data.

**Seq_cst** is the safe default. All seq_cst operations across all threads
appear in a single total order. This is what you get from `std::atomic<T>`
member functions when you do not pass an explicit ordering, and it is what
Java `AtomicXxx` provides out of the box.

### Why C `volatile` is not a fence

In C and C++, `volatile` means "do not optimise away accesses to this
variable" — useful for memory-mapped IO, signal handlers, or `setjmp`/
`longjmp`. It explicitly does **not** insert memory fences and does **not**
make the variable atomic in the multithreaded sense.

A `volatile int counter` shared between threads is still racy. The compiler
will not cache it in a register across reads, but the CPU may still reorder
its stores and loads with respect to other variables, and the increment is
still a non-atomic read-modify-write.

Use `std::atomic<T>` for thread communication. Use `volatile` only for the IO
patterns it was designed for.

### Why Java `volatile` IS a fence

Java rewrote the meaning of `volatile` in JSR-133 (Java 5). A Java `volatile`
field has two effects: every read is an acquire-load and every write is a
release-store on that field. The JMM additionally guarantees a total order
over all `volatile` accesses. So `volatile` in Java is closer to C++
`atomic<T>` with `seq_cst` than to C `volatile`.

This is why Java idioms such as `volatile boolean done` for a shutdown flag
actually work, while the equivalent C code is broken without `_Atomic` or
`std::atomic`.

### The canonical CAS loop

`compare_exchange` is the workhorse of lock-free programming. The pattern is:

```cpp
T expected = atomic_var.load(std::memory_order_relaxed);
T desired;
do {
    desired = compute_new(expected);
} while (!atomic_var.compare_exchange_weak(
             expected, desired,
             std::memory_order_acq_rel,
             std::memory_order_relaxed));
```

A few things to internalise. The loop's body computes the new value from the
*last observed* expected value. On failure, `compare_exchange` writes the
current actual value into `expected` so the next iteration sees fresh state
without an explicit reload. The success ordering describes what fences happen
when the CAS succeeds; the failure ordering applies when it fails (and must
not be stronger than success).

The use of `_weak` allows spurious failures (more on that below). The success
ordering `acq_rel` is the typical pick when the CAS is publishing data the
other threads will read.

### The ABA problem

CAS only tells you "this location still holds the value I expected." It does
**not** tell you "no thread has touched this location since I read it."

Picture a lock-free stack with head `H`. Thread T1 reads `H = A` and prepares
to pop A by CAS'ing head from A to A->next = B. Before T1 commits the CAS,
threads T2 and T3 do this:

1. T2 pops A (head becomes B), uses A, frees it.
2. T3 allocates a new node, the allocator reuses A's address.
3. T3 pushes the new node; it happens to chain onto B; head becomes A again
   (same address, different node).

T1 now performs its CAS. It sees head == A, matching its expected value, and
swaps head to B. But B is no longer the real second element — the stack is
corrupted. ABA: the value went A, B, A, and CAS could not tell.

ABA shows up wherever pointers or generation-free integer tokens are
recycled. It does **not** show up where values are monotonic (e.g. a counter
that only increments), so a `fetch_add` loop is naturally ABA-immune.

### Tagged pointers and version counters

The cheapest fix is to attach a counter to the value being CAS'd. Instead of
CAS-ing just `head`, CAS the pair `(head, version)`. Each push or pop
increments `version`. Now even if the pointer cycles back to A, the version
has advanced, so the CAS fails.

On 64-bit x86-64 this is usually implemented by packing a 48-bit pointer with
a 16-bit version into one 64-bit word, or by using `cmpxchg16b` to CAS a full
128 bits. Java offers `AtomicStampedReference` which packs a reference with
an `int` stamp.

This works when you can afford the extra word and when ABA is the *only*
hazard. It does not help with **safe memory reclamation** — knowing when it
is safe to actually free A.

### Hazard pointers (intro)

Hazard pointers solve reclamation. Each thread publishes, in a slot all
threads can read, the pointer it is about to dereference. Before a thread
frees a node, it scans all hazard slots; if any thread has published that
pointer, the node is deferred. Otherwise it is safe to free.

We will only sketch hazard pointers here — full implementation is a senior
topic — but knowing the name unlocks reading lock-free papers. Other
techniques in this space include epoch-based reclamation and RCU.

### Double-checked locking

Lazy singleton initialisation is the classic example. Naive code:

```java
if (instance == null) {
    synchronized (lock) {
        if (instance == null) {
            instance = new Singleton();
        }
    }
}
```

Without `volatile` on `instance`, this is broken. Another thread may see a
non-null `instance` whose constructor has not yet finished, because the
publication of the reference can be reordered before the writes that
initialise the object. The fix in Java is `private static volatile Singleton
instance` — volatile makes the publication a release store and the outer
read an acquire load.

In C++, the broken DCL pattern is the canonical motivation for
`std::call_once`. If you must roll your own, use `std::atomic<Singleton*>`
with `acq_rel` on the publish CAS and `acquire` on the outer load.

### compare_exchange_strong vs compare_exchange_weak

`compare_exchange_strong` only fails when the actual value differs from
expected. `compare_exchange_weak` is allowed to fail spuriously even when
they match — typically because the underlying LL/SC (load-linked /
store-conditional) instruction on ARM and POWER lost its reservation.

Inside a retry loop, prefer `_weak`: spurious failures just cause another
iteration, and `_weak` is faster on those architectures. For a one-shot CAS
outside a loop, prefer `_strong` so you do not have to handle spurious
failure yourself.

### Reading the formal models

You do not need to memorise the full operational semantics of the JMM or
C++. You do need to know that both models are defined in terms of
*happens-before*. A program is data-race-free if and only if every pair of
conflicting accesses (at least one a write, to the same location) is ordered
by happens-before. In a DRF program, behaviour is as if executed under
sequential consistency.

The simple rule: pair each release with an acquire, ensure that the consumer
*reads from* the producer's release, and your inter-thread reasoning becomes
straightforward.

---

## Real-World Analogies

- **Memory ordering as postal mail.** Relaxed is a postcard tossed in the
  bag — it gets there, eventually. Release is a signed-for letter you hand to
  the postman after stamping all your other outgoing mail. Acquire is the
  recipient checking the postmark before opening any other letters that day.
  Seq_cst is a global registry that records every signed-for letter in a
  single ledger every party can audit.

- **CAS loop as a polite door.** You hold the handle, peek at who is inside,
  and try to enter only if the room matches what you expected when you
  knocked. If someone walked in or out between knock and entry, you let go,
  look again, and re-plan.

- **ABA as a rental car.** You leave your keys with car #A. Someone returns
  it, rents it to another driver, who returns it. You come back, see car #A
  in the same spot, and conclude nothing happened — but the odometer and the
  contents of the glovebox say otherwise.

- **Hazard pointer as a coatroom claim ticket.** Before the attendant throws
  out a coat, they check the rack of ticket stubs that current patrons hold.
  Your stub protects your coat.

---

## Mental Models

- **Atomic + ordering = data race shield.** Atomics make a single location
  race-free. Ordering extends that shield to a graph of related locations by
  hooking them onto the release-acquire pair.

- **Happens-before is the only currency.** When in doubt, ask: which two
  operations are establishing happens-before, and is the consumer guaranteed
  to read from the right write?

- **The CAS retry is part of the algorithm, not a bug.** Lock-free
  algorithms make progress because *some* thread's CAS always succeeds. A
  retry by your thread means another thread succeeded — global progress
  continues.

- **ABA is a memory-recycling problem.** If your tokens never recycle, you
  have no ABA. If they recycle, you need versions, hazard pointers, epochs,
  or some other reclamation scheme.

---

## Code Examples

### Lock-free Treiber stack — C++

```cpp
#include <atomic>
#include <iostream>
#include <thread>
#include <vector>

template <typename T>
class TreiberStack {
private:
    struct Node {
        T value;
        Node* next;
        explicit Node(T v) : value(std::move(v)), next(nullptr) {}
    };

    std::atomic<Node*> head_{nullptr};

public:
    ~TreiberStack() {
        Node* n = head_.load(std::memory_order_relaxed);
        while (n) {
            Node* nx = n->next;
            delete n;
            n = nx;
        }
    }

    void push(T value) {
        Node* node = new Node(std::move(value));
        Node* old = head_.load(std::memory_order_relaxed);
        do {
            node->next = old;
        } while (!head_.compare_exchange_weak(
                     old, node,
                     std::memory_order_release,
                     std::memory_order_relaxed));
    }

    bool pop(T& out) {
        Node* old = head_.load(std::memory_order_acquire);
        while (old) {
            if (head_.compare_exchange_weak(
                    old, old->next,
                    std::memory_order_acquire,
                    std::memory_order_acquire)) {
                out = std::move(old->value);
                delete old;          // UNSAFE without reclamation scheme
                return true;
            }
        }
        return false;
    }
};

int main() {
    TreiberStack<int> s;
    std::vector<std::thread> ts;
    for (int i = 0; i < 4; ++i)
        ts.emplace_back([&, i] {
            for (int k = 0; k < 1000; ++k) s.push(i * 1000 + k);
        });
    for (auto& t : ts) t.join();
    int popped = 0, val;
    while (s.pop(val)) ++popped;
    std::cout << "popped: " << popped << "\n";
}
```

Notes: `push` uses `release` so a subsequent reader sees the node's fields.
`pop` uses `acquire` so it sees those fields. The `delete old` line is the
unsafe part — under contention, another thread may still be inside its `pop`
holding `old` from before our CAS. Production code must use hazard pointers
or epoch-based reclamation.

### Lock-free Treiber stack — Java

```java
import java.util.concurrent.atomic.AtomicReference;

public class TreiberStack<T> {
    private static final class Node<T> {
        final T value;
        Node<T> next;
        Node(T v) { value = v; }
    }

    private final AtomicReference<Node<T>> head = new AtomicReference<>();

    public void push(T value) {
        Node<T> node = new Node<>(value);
        Node<T> old;
        do {
            old = head.get();
            node.next = old;
        } while (!head.compareAndSet(old, node));
    }

    public T pop() {
        Node<T> old;
        Node<T> next;
        do {
            old = head.get();
            if (old == null) return null;
            next = old.next;
        } while (!head.compareAndSet(old, next));
        return old.value;
    }
}
```

In Java the JMM guarantees that `compareAndSet` is volatile-strength — both
acquire and release semantics. The garbage collector solves reclamation, so
unlike the C++ version there is no use-after-free hazard. ABA can still
occur if the same `Node` object is recycled (e.g. via an object pool), but
under normal GC each `new Node<>` is unique.

### Reproducing ABA with a recycling pool — C++

```cpp
#include <atomic>
#include <cassert>
#include <iostream>
#include <thread>

struct Node { int value; Node* next; };

class Pool {
    std::atomic<Node*> free_list_{nullptr};
public:
    Node* take() {
        Node* n = free_list_.load(std::memory_order_acquire);
        while (n && !free_list_.compare_exchange_weak(
                       n, n->next,
                       std::memory_order_acq_rel,
                       std::memory_order_acquire)) {}
        return n ? n : new Node{0, nullptr};
    }
    void give(Node* n) {
        Node* old = free_list_.load(std::memory_order_relaxed);
        do { n->next = old; }
        while (!free_list_.compare_exchange_weak(
                   old, n,
                   std::memory_order_release,
                   std::memory_order_relaxed));
    }
};

// Single shared head, threads race on it. The pool recycles nodes so the
// same address shows up repeatedly: a fertile ground for ABA.
std::atomic<Node*> head{nullptr};
Pool pool;

void worker(int rounds) {
    for (int i = 0; i < rounds; ++i) {
        Node* n = pool.take();
        n->value = i;
        n->next  = head.load(std::memory_order_relaxed);
        while (!head.compare_exchange_weak(
                   n->next, n,
                   std::memory_order_release,
                   std::memory_order_relaxed)) {}
        Node* top = head.load(std::memory_order_acquire);
        if (top &&
            head.compare_exchange_strong(
                top, top->next,
                std::memory_order_acq_rel,
                std::memory_order_acquire)) {
            pool.give(top);
        }
    }
}

int main() {
    std::thread a(worker, 100000), b(worker, 100000);
    a.join(); b.join();
    // Count remaining; under ABA you will often see fewer than expected.
    int n = 0;
    for (auto p = head.load(); p; p = p->next) ++n;
    std::cout << "remaining: " << n << "\n";
}
```

Run this a few times under load. Occasionally you will observe corruption:
the chain length is wrong or the program crashes dereferencing a freed node.
This is ABA in action.

### Fixing ABA with a tagged pointer — C++

```cpp
#include <atomic>
#include <cstdint>

struct Node { int value; Node* next; };

struct Tagged {
    Node* ptr;
    uint64_t tag;
    bool operator==(const Tagged& o) const noexcept {
        return ptr == o.ptr && tag == o.tag;
    }
};

std::atomic<Tagged> head{{nullptr, 0}};

void push(Node* n) {
    Tagged old = head.load(std::memory_order_relaxed);
    Tagged nw;
    do {
        n->next = old.ptr;
        nw = {n, old.tag + 1};
    } while (!head.compare_exchange_weak(
                 old, nw,
                 std::memory_order_release,
                 std::memory_order_relaxed));
}

Node* pop() {
    Tagged old = head.load(std::memory_order_acquire);
    Tagged nw;
    while (old.ptr) {
        nw = {old.ptr->next, old.tag + 1};
        if (head.compare_exchange_weak(
                old, nw,
                std::memory_order_acq_rel,
                std::memory_order_acquire))
            return old.ptr;
    }
    return nullptr;
}
```

Requires `cmpxchg16b` (x86-64) or LSE atomics (ARM) under the hood; check
that `std::atomic<Tagged>::is_lock_free()` returns true on your target.

### Double-checked locking — broken vs fixed in Java

```java
// BROKEN
public class BrokenSingleton {
    private static Singleton instance;          // not volatile
    public static Singleton get() {
        if (instance == null) {
            synchronized (BrokenSingleton.class) {
                if (instance == null) instance = new Singleton();
            }
        }
        return instance;
    }
}

// FIXED
public class GoodSingleton {
    private static volatile Singleton instance; // volatile is essential
    public static Singleton get() {
        Singleton local = instance;             // single volatile read
        if (local == null) {
            synchronized (GoodSingleton.class) {
                local = instance;
                if (local == null) {
                    local = new Singleton();
                    instance = local;           // release publish
                }
            }
        }
        return local;
    }
}
```

The single `local` variable avoids re-reading the volatile field in the fast
path twice. Without `volatile`, another thread could see `instance != null`
but observe a half-constructed Singleton whose fields are still default
values.

### Relaxed counter — quick benchmark

```cpp
#include <atomic>
#include <chrono>
#include <iostream>
#include <thread>

template <std::memory_order Order>
void bench(const char* name) {
    constexpr int N = 8;
    std::atomic<long> c{0};
    auto t0 = std::chrono::steady_clock::now();
    std::vector<std::thread> ts;
    for (int i = 0; i < N; ++i)
        ts.emplace_back([&] {
            for (int k = 0; k < 5'000'000; ++k)
                c.fetch_add(1, Order);
        });
    for (auto& t : ts) t.join();
    auto dt = std::chrono::steady_clock::now() - t0;
    std::cout << name << ": "
              << std::chrono::duration_cast<std::chrono::milliseconds>(dt).count()
              << " ms, sum=" << c.load() << "\n";
}

int main() {
    bench<std::memory_order_relaxed>("relaxed");
    bench<std::memory_order_seq_cst>("seq_cst");
}
```

On x86 the gap is small because every store is already release and every
load is already acquire. On ARM and POWER the gap is dramatic — relaxed can
be several times faster than seq_cst for pure counters.

---

## Pros & Cons

**Pros**

- Lock-free algorithms remain responsive under thread suspension or
  priority inversion.
- Fine-grained memory ordering means you pay only for the fences you need.
- Tagged pointers and hazard pointers give bounded latency where mutexes
  would block.

**Cons**

- Reasoning is hard; bugs are non-deterministic and rarely reproducible.
- Safe memory reclamation is a research-grade problem in C++.
- Performance can be *worse* than a mutex under high contention because
  retries compete for the cache line.
- Code is platform-sensitive: x86 hides bugs that ARM exposes.

---

## Use Cases

- Statistic counters touched from many threads (relaxed fetch-add).
- Lazy initialisation (acquire load + release store, or `call_once`).
- Lock-free stacks and SPSC/MPSC queues for low-latency pipelines.
- Reference counting for shared objects (`shared_ptr` internals).
- Sequence locks for read-mostly snapshots (e.g. configuration).
- Hazard pointers in concurrent hash tables and memory reclamation systems.

---

## Coding Patterns

- **Load-decide-CAS-retry.** The shape of every CAS loop. Compute the new
  value from the latest observed value; let `compare_exchange` update the
  expected on failure.

- **Publish via release, consume via acquire.** Producer fills a struct then
  release-stores its pointer; consumer acquire-loads the pointer and reads
  the fields. Forms the backbone of single-writer publish patterns.

- **Sequence lock for read-mostly data.** Writer increments a counter to
  odd, modifies, increments to even. Reader reads counter, reads data, reads
  counter again; if the two counter reads differ or are odd, retry. Combines
  acquire/release with a CAS-free reader path.

- **Hazard pointer protocol.** Publish the pointer you are about to use,
  validate it is still current, dereference, retire when done.

- **Tagged pointer for ABA.** Pair every CAS'd pointer with a generation
  count and CAS both together.

---

## Clean Code

- Wrap atomics behind named operations such as `push`, `tryPop`, `publish`,
  not inline `compare_exchange_weak` calls scattered across the codebase.
- Comment the ordering choice every time it is not `seq_cst`. "Why relaxed?"
  should be answered in code.
- Keep CAS loops short. If the body grows, extract a helper that takes
  `expected` and returns `desired`.
- Name flags by their role, not their type. `volatile boolean shutdown` is
  clearer than `volatile boolean flag`.

---

## Best Practices

- Default to `seq_cst`. Weaken only after measurement on the target hardware.
- Pair every release with a documented acquire. Stand-alone fences are a
  smell.
- Reach for `std::atomic<T>` member functions; avoid `std::atomic_thread_fence`
  unless you can prove no atomic operation could carry the same ordering.
- In Java, prefer `VarHandle` to `Unsafe` when you need fine-grained ordering.
- Treat lock-free code as you would treat assembly: code review by at least
  one expert and exhaustive testing (TSan, stress tests, the Java Concurrency
  Stress tests).
- Use `is_lock_free()` and `is_always_lock_free` to verify you actually got
  the lock-free implementation.

---

## Edge Cases & Pitfalls

- **Reader does not observe the producer's write.** Either the producer
  used relaxed instead of release, or the reader used relaxed instead of
  acquire, or the reader read a stale value not produced by the release.
  Happens-before requires the consumer to *read from* the release.

- **ABA on object pools.** Reusing nodes from a custom pool brings ABA back
  even in Java.

- **DCL without `volatile`.** Almost always wrong. The constructor's stores
  can sink past the publish.

- **Failure ordering stronger than success.** Forbidden. The C++ standard
  requires `failure <= success` in strength.

- **CAS loop livelock under extreme contention.** All threads retry
  forever. Mitigate with backoff: a few `pause` instructions, then
  exponential delay.

- **False sharing on the CAS cache line.** If two unrelated atomics share a
  cache line, contention on one slows down the other. Align hot atomics to
  `std::hardware_destructive_interference_size`.

- **`memory_order_consume` traps.** Currently equivalent to `acquire` on
  every mainstream compiler but officially deprecated; do not rely on
  consume in new code.

- **Word size limits for tagged pointers.** Packing pointer + version into
  one 64-bit word costs you address bits. On x86-64, 48-bit virtual
  addresses leave 16 bits for a version counter — overflow concerns matter.

---

## Common Mistakes

- Using C `volatile` to share counters across threads.
- Writing `if (head.load() != null) head.load()->next` — load twice, dereference
  the second result. Another thread can change head between the two loads.
- Forgetting that `compare_exchange` updates `expected` by reference on
  failure. Re-reading inside the loop is unnecessary and can be a bug.
- Using `compare_exchange_strong` inside a tight retry loop on ARM, paying
  for an extra LL/SC retry.
- Mixing `std::atomic<int>` operations with non-atomic accesses to the same
  variable. Once you make it atomic, every access must go through the atomic
  API.
- Trying to delete a node freshly popped from a lock-free structure without
  any reclamation scheme.
- Believing that "x86 is strongly ordered, so I do not need ordering tags."
  The compiler can still reorder; only the *CPU* is strongly ordered.

---

## Tricky Points

- **Release stores do not flush anything.** They are local instructions
  that constrain *this thread's* reorderings, not global broadcasts. The
  acquire on the other side is what completes the synchronisation.

- **`seq_cst` is not just "release + acquire."** It additionally provides a
  single total order across all seq_cst operations. Two release-store-only
  threads can disagree on the order of each other's stores; two seq_cst
  threads cannot.

- **Spurious failure on `compare_exchange_weak`.** Allowed even when no
  other thread has touched the variable. Always loop.

- **Read-modify-write operations participate in the modification order.**
  Every RMW sees the latest value in modification order and writes the next
  one. This is why `fetch_add` is ABA-immune: there is exactly one
  modification order, and you advanced it.

- **`memory_order_acquire` on a CAS that fails.** Still imposes the
  acquire fence on the load. You can therefore reuse failed CAS values for
  reasoning, but only if your code does not assume the store half happened.

---

## Test Yourself

1. What is the difference between `relaxed`, `acquire`, and `seq_cst` on a
   load?
2. Why is a Java `volatile` field safe for inter-thread communication while
   a C `volatile int` is not?
3. Describe the ABA problem with a concrete scenario using a stack.
4. Why is `compare_exchange_weak` preferred inside a loop on ARM?
5. What is the role of `volatile` in the Java double-checked locking idiom?
6. Why is `fetch_add` immune to ABA?
7. How does a tagged pointer prevent ABA, and what is its cost?
8. Give one reason a tagged pointer is not enough — what additional problem
   needs solving in C++?
9. What ordering would you use for a "stop" flag read by workers and set by
   a controller, and why?
10. Why must the failure ordering of `compare_exchange` be no stronger than
    the success ordering?

---

## Tricky Questions

1. Two threads each release-store distinct values to two atomics `x` and
   `y`. A third thread acquire-loads both. Can it see the writes in
   different orders depending on which atomic it loads first? What changes
   if all four operations are `seq_cst`?

2. You implement a Treiber stack with a global free-list pool. ABA appears
   in tests. You add an `AtomicStampedReference`. The stamp space is `int`;
   under intense traffic, does stamp wraparound revive ABA, and how would
   you mitigate?

3. In C++, you publish a `Config*` via `std::atomic<Config*>`. The Config
   has a non-atomic `std::vector<int>` field set before publish. The reader
   acquire-loads the pointer and iterates the vector. Is this safe? What if
   the vector is later reassigned on the writer side?

4. A junior engineer writes a CAS loop where the `desired` value depends on
   a function with side effects (logging). What goes wrong, and how should
   it be refactored?

5. On x86-64, you replace all `seq_cst` operations with `acq_rel` and the
   tests still pass. Does that prove correctness? Why or why not?

6. Show a case where two consecutive `relaxed` stores by one thread are
   observed in reverse order by another thread, but the program is still
   data-race-free.

7. A hazard pointer scheme keeps a per-thread published pointer. What
   happens if a thread crashes before clearing its hazard pointer? Suggest a
   mitigation.

8. Why does Java's `AtomicReference` not provide an `addAndGet`-style
   helper, while `AtomicInteger` does? What would the equivalent look like
   on a reference, and why is it expensive?

---

## Cheat Sheet

```
ordering       use case                                    cost (x86 / ARM)
-----------    ------------------------------------------  ----------------
relaxed        counters, statistics, IDs                   nil  /  low
acquire        consumer side of publish-subscribe          nil  /  med
release        producer side of publish-subscribe          nil  /  med
acq_rel        CAS loops that publish data                 nil  /  med
seq_cst        default, total order, fewer surprises       med  /  high

CAS loop skeleton:
    expected = a.load(relaxed)
    do { desired = f(expected); }
    while (!a.compare_exchange_weak(expected, desired,
                                    acq_rel, relaxed))

ABA mitigations:
    - tagged pointers / AtomicStampedReference  (cheap, no GC needed)
    - hazard pointers                           (also gives safe reclaim)
    - epoch-based reclamation / RCU             (best amortised throughput)

C volatile     != atomic, no fences         (use for IO, signals only)
Java volatile  == acquire-release on field  (safe for inter-thread)
```

---

## Summary

Atomics at the middle level are about *memory ordering*. Atomic
indivisibility alone does not give you cross-variable visibility — that is
the job of acquire and release. Pair them carefully, default to `seq_cst`
when in doubt, and weaken only with measurement and review.

CAS loops are the bread and butter of lock-free programming. They build all
higher-level atomic operations on top of compare-and-swap, and they encode
the producer-consumer dance of "load, decide, swap, retry."

ABA is the classic CAS hazard. It does not occur when values are monotonic
(`fetch_add` is safe by construction). It does occur when pointers or
identifiers recycle. Mitigate with tagged pointers or hazard pointers, and
in C++ remember that ABA prevention and safe memory reclamation are two
separate problems.

C `volatile` is not Java `volatile`. The former gives no ordering and is
useless for thread communication. The latter is acquire-release on every
access and is the correct fix for double-checked locking.

Lock-free does not mean fast. It means progress. Measure before assuming an
atomic-based design beats a well-written mutex.

---

## What You Can Build

- A lock-free counter and tally service with relaxed `fetch_add`.
- A lock-free Treiber stack (with hazard pointers for production use).
- A bounded MPSC ring buffer with sequence numbers, suitable for high-
  throughput logging.
- A lazy singleton in Java using `volatile`, or in C++ using
  `std::call_once` or DCL on `std::atomic<T*>`.
- A sequence lock for read-mostly snapshot data such as runtime configuration.

---

## Further Reading

- *C++ Concurrency in Action*, Anthony Williams — chapters 5 and 7 on the
  C++ memory model and lock-free data structures.
- *The Art of Multiprocessor Programming*, Herlihy and Shavit — the
  textbook on lock-free algorithms.
- JSR-133 Cookbook by Doug Lea — the JMM expressed as a set of barrier
  rules for compiler implementers.
- Hans-J. Boehm, *Threads Cannot Be Implemented as a Library* — why C
  `volatile` is not enough.
- Maged Michael, *Hazard Pointers: Safe Memory Reclamation for Lock-Free
  Objects*, IEEE TPDS 2004.
- *Memory Models: A Case for Rethinking Parallel Languages and Hardware*,
  Adve and Boehm.
- Preshing on Programming (preshing.com) — accessible deep dives on memory
  ordering, acquire/release, sequence locks, and lock-free patterns.

---

## Related Topics

- [Locks and Mutexes](../03-locks/README.md) — the alternative when
  lock-free is overkill.
- [Memory Models](../../../memory-management/README.md) — formal background
  for the ordering rules used here.
- [Concurrency Models](../../01-models/README.md) — where shared-memory and
  message-passing fit in the bigger picture.
- [Volatile and Memory Visibility](../05-volatile/README.md) — focused
  treatment of `volatile` in C, C++, and Java.
- [Lock-Free Data Structures](../06-lockfree/README.md) — Treiber stack,
  Michael-Scott queue, and friends in depth.

---

## Diagrams & Visual Aids

### Release-acquire publish

```
Thread P (producer)             Thread C (consumer)
-------------------             -------------------
data.x = 1;                     while (flag.load(acquire) == 0) {}
data.y = 2;                     // guaranteed to see x = 1, y = 2
flag.store(1, release);
```

The release store on `flag` orders the prior writes to `data` before any
acquire load that reads `flag == 1`.

### CAS loop control flow

```
                    +-----------------+
                    | expected = load |
                    +--------+--------+
                             |
                             v
                    +-----------------+
                    | desired = f(.)  |
                    +--------+--------+
                             |
                             v
                    +-----------------+
                    | CAS(a, exp, des)|
                    +--+-----------+--+
                       | success   | failure (exp updated in place)
                       v           |
                    return      [loop back]
```

### ABA timeline

```
time --->
T1: read head = A .................................. CAS(head, A -> B) ?
T2:             pop A; free A
T3:                       alloc; addr reused as A; push A'
                                          head is A again, but A != A
```

T1's CAS succeeds because the bits match, but the linked structure no longer
holds the node T1 believed it did.

### Tagged-pointer CAS

```
+-------------------+-------------+
|  pointer (48 bit) | tag (16 bit)|
+-------------------+-------------+
        ^                  ^
        |                  |
   recycled                bumped every push/pop
   address                 so ABA fails
```

### Memory order lattice (informal)

```
            seq_cst
              ^
              |
            acq_rel
            ^     ^
            |     |
        acquire  release
            ^     ^
             \   /
            relaxed
```

Stronger orderings imply all the guarantees of the weaker ones below them.
