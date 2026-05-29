# Shared-Memory Concurrency — Junior Level

> **Topic:** [Shared-Memory Concurrency Roadmap](README.md)
> **Focus:** Two threads, one variable. What can possibly go wrong? (Answer: almost everything.) And the first tool we use to fix it.

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

> Focus: **What does it mean for two threads to share memory?** And **why does that almost always go wrong without coordination?**

**Shared-memory concurrency** is the original concurrency model. Two (or more) threads run *at the same time*, and they can all **read and write the same variables** — the same `int`, the same array, the same hash map, sitting at the same address in RAM. Nothing copies. Nothing is sent. Both threads simply *touch* the same bytes.

This is fast (no message-passing overhead, no serialization) and natural to a programmer who already understands single-threaded code — variables are still variables, you just have more than one thread looking at them. It's also the source of nearly every nasty concurrency bug ever filed: data races, torn reads, lost updates, deadlocks, livelocks, memory visibility problems. The reason languages have evolved alternative models — message passing, actors, CSP channels, software transactional memory — is precisely that shared memory is *so easy to get wrong* that humans needed safer abstractions.

In one sentence: **shared-memory concurrency is N people writing on the same whiteboard with no rules about who writes when.** And the first rule we add — a "lock" — is just *"one marker, one person at a time."*

> 🎓 **Why this matters for a junior:** When you start writing concurrent code, your single biggest source of pain will be code that works *most of the time* and then fails mysteriously on Friday afternoon in production. Those bugs are almost always shared-memory bugs. Learning the model — and the *one* tool (the mutex) that prevents 90% of those bugs — is the highest-leverage thing you can do in your first month with concurrency.

This page covers: what "shared memory" really is at the OS/CPU level, what a **data race** is and why it ruins your day, the **critical section** and the **mutex** as the cure, and the same buggy-then-correct counter example across C, Java, Python, Go, and Rust. The next level (`middle.md`) goes deep on memory ordering and the happens-before relation; `senior.md` covers lock-free design and the JMM/Go memory model; `professional.md` covers cache-coherence and large-scale lock design.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a simple program with functions in at least one language (C, Java, Python, Go, or Rust).
- **Required:** What a variable is and what reading/writing one means.
- **Required:** Basic loops and counters (`for i := 0; i < N; i++`).
- **Helpful but not required:** A vague awareness that your CPU has multiple cores and your OS schedules processes onto them.
- **Helpful but not required:** Some exposure to the idea of a *function call stack* — each thread will have its own.

You do **not** need to know:

- How a mutex is implemented (futexes, atomics, kernel parking — that's `middle.md`).
- The CPU memory model or memory barriers (that's `senior.md`).
- Anything about channels, actors, or async/await — those are alternative models discussed in sibling files.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Thread** | An OS-scheduled unit of execution. Has its own stack and registers but **shares the heap (and globals)** with other threads in the same process. |
| **Process** | A running program. Has its own address space — separate from other processes. May contain many threads. |
| **Shared memory** | Memory addresses visible to more than one thread. Heap allocations, global variables, and static data are all shared by default. |
| **Stack memory** | Each thread has its own stack — local variables of a function call are *not* shared unless you take a pointer/reference and hand it out. |
| **Concurrency** | Multiple tasks making progress over the same time period (may or may not run truly in parallel). |
| **Parallelism** | Multiple tasks **literally** running at the same instant on different CPU cores. |
| **Context switch** | The OS scheduler pausing one thread and resuming another. Cheap on the same core; not free. |
| **Time slice** | The chunk of CPU time the scheduler gives a thread before potentially switching to another. |
| **Race condition** | A bug whose presence depends on the **order** in which concurrent operations execute. |
| **Data race** | A specific race: two threads accessing the same memory address, at least one writing, with no synchronization. Almost always undefined behavior. |
| **Critical section** | A region of code that must execute by **at most one thread at a time** to remain correct. |
| **Mutex** | "Mutual exclusion." A lock object that, when held by a thread, blocks all others from holding it until released. |
| **Lock / Unlock** | Acquiring and releasing a mutex. Bracket your critical section with these. |
| **Atomic operation** | A read-modify-write that the CPU guarantees is **indivisible** — no other thread can see a half-finished state. |
| **Read-modify-write (RMW)** | An operation that reads a value, computes a new one, and writes it back. The classic example: `counter++`. The dangerous shape in concurrent code. |
| **Lost update** | When two threads both read the same value, both compute a new one, and the second write overwrites the first. The increment example, in a nutshell. |
| **Happens-before** | The formal rule (Java/C++/Go all have one) saying: if A happens-before B, then B is guaranteed to see the effects of A. Locks establish happens-before. |
| **Deadlock** | Two (or more) threads each holding a lock the other needs. Nobody can proceed. |
| **GIL (Global Interpreter Lock)** | A CPython implementation detail: only one Python thread runs bytecode at a time. Does **not** make your code race-free for compound operations. |

---

## Core Concepts

### 1. What "Shared" Means

Inside a single process, threads share the **heap** and **globals**. If you allocate a `struct Counter { value: i64 }` on the heap and hand a pointer to two threads, they are pointing at *literally the same eight bytes of RAM*. There is no copy, no per-thread view, no protective wrapper. When thread A writes, thread B sees that write — eventually (the "eventually" is what `middle.md` and `senior.md` are about).

What is **not** shared by default:

- Each thread has its own **stack**. Local variables in a function are private to that thread.
- Each thread has its own **registers and program counter**. They independently execute code.
- **Thread-local storage** (`pthread_setspecific`, `ThreadLocal<T>` in Java, `thread_local!` in Rust) gives each thread its own copy of a "global."

The default is the dangerous default: anything on the heap is fair game for any thread.

### 2. The OS Reality: Threads Are Scheduled

Even if you only have 4 cores, you can run 1,000 threads. The OS scheduler **time-slices** them: it runs thread A for ~1-10 milliseconds, pauses it (a *context switch*), runs thread B for a while, and so on. From a single thread's point of view, it does *not know when it will be paused*. It might be paused **between two CPU instructions** — including in the middle of a `counter++` that compiled to "load, add, store."

This is why the threads-share-memory model is dangerous: the OS can stop your thread *anywhere*, and another thread can then run and modify the same variable before yours resumes.

### 3. The Canonical Bug: `counter++` Is Not One Operation

You write `counter++` and you think *"increment the counter."* The CPU executes:

```text
   1. LOAD  counter into register R
   2. ADD   1 to R
   3. STORE R back into counter
```

Three operations. Now imagine two threads, both running this on the same counter, with the OS scheduler pausing them anywhere:

```text
Thread A             Thread B            counter in memory
LOAD R = 0                               0
                     LOAD R = 0          0
ADD R = 1                                0
                     ADD R = 1           0
STORE counter = 1                        1
                     STORE counter = 1   1     <-- LOST UPDATE
```

Both threads incremented. The counter went up by 1, not 2. Run this a million times across four threads, expect 4,000,000, and you'll get something like 3,217,584. **This is a data race in its purest form.**

### 4. Critical Section — The Concept

A **critical section** is *any region of code that must be executed by at most one thread at a time*. In the counter example, the critical section is the three-instruction sequence `LOAD; ADD; STORE`. We need a way to declare: *"only one thread inside here at a time."*

A useful test: **if I imagine N threads frozen at every possible interleaving of instructions inside this region, are all the resulting states still correct?** If no, the region is critical.

### 5. The First Cure: Mutex

A **mutex** (mutual exclusion lock) is an object with two operations: `lock()` and `unlock()`. The semantics: *at any moment, at most one thread holds the lock*. If thread A calls `lock()` while thread B holds it, A is **blocked** (parked, descheduled) until B calls `unlock()`. Then A acquires it and proceeds. Then someone else waits.

You wrap your critical section in `lock()` / `unlock()`:

```text
mutex.lock();
counter = counter + 1;   // critical section
mutex.unlock();
```

Now the three-instruction RMW is **atomic with respect to other threads**, because no other thread can be inside the lock-protected region at the same time.

### 6. The Three Operations: Read, Write, RMW

Categorize every shared-memory access:

| Operation | Example | Safe alone? |
|-----------|---------|-------------|
| **Read** | `x := counter` | Safe iff no concurrent write. With a concurrent write, you can read a *torn* (half-old, half-new) value on some platforms/types. |
| **Write** | `counter = 0` | Safe iff no concurrent read or write — same torn-write issue. |
| **Read-modify-write** | `counter++`, `list.append(x)`, `map[k] = map[k] + 1` | **Almost never safe** without synchronization. Two RMWs racing always risks a lost update. |

Junior heuristic: **if you see `++`, `+=`, `append`, or `map[k] = f(map[k])` on a shared variable without a lock, suspect a bug.**

### 7. Happens-Before, Briefly

Modern CPUs and compilers reorder memory operations to go faster. Without synchronization, a write you do in thread A might not be visible to thread B for *milliseconds*, or might appear out of order. A mutex gives you a guarantee: **everything thread A did before `unlock()` is visible to thread B after its matching `lock()`**. That guarantee is called **happens-before**. We'll go deep on it in `../../05-race-conditions/junior.md` and in this folder's `senior.md`. For now, take it as: **acquiring a mutex synchronizes your view of memory with whoever last released it.**

### 8. Why Fast, Why Error-Prone

Shared-memory concurrency is **fast** because there is no copying — a single 8-byte counter is a single 8-byte counter, no matter how many threads see it. The cost is the *coordination*: locks, atomics, fences. When that coordination is cheap (low contention) it's hard to beat. When that coordination is wrong, you get bugs that show up once a week in production and never in your tests.

The alternative models (message passing, channels, actors, STM) trade some of this raw speed for **structural safety** — they take away the foot-gun of "anyone can touch anything."

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Shared memory** | A whiteboard that everyone in the room can read and write. |
| **Thread** | A person standing in front of the whiteboard with a marker. |
| **Data race** | Two people writing on the same cell of the whiteboard at the same time — you get a smudge. |
| **Critical section** | The act of "update the running total in the corner." Only one person should do that at a time. |
| **Mutex** | The single physical marker. You can only write if you're holding it. When you put it down, the next person picks it up. |
| **Lock contention** | Six people waiting in a line for the one marker. The whiteboard is idle while they queue. |
| **Deadlock** | Alice is holding the red marker waiting for the blue one. Bob is holding the blue waiting for the red. They never move. |
| **Atomic operation** | A magic stamp that prints "+1" instantly and indivisibly. No one can interrupt mid-print. |
| **Context switch** | The room's PA system periodically shouting "Alice, freeze! Bob, go!" |
| **Lost update** | Alice reads the total (5), Bob reads the total (5). Alice writes 6. Bob writes 6. The room thinks they each added 1, but the total only went up by 1. |
| **Memory visibility issue** | You wrote "5" on the whiteboard, but someone across the room is still reading from a Polaroid they took 3 seconds ago. |
| **Happens-before** | A handover rule: "if I write something then ring the bell, anyone who hears the bell sees what I wrote." |

---

## Mental Models

### The Whiteboard Model

The model that beats every other for juniors: a single whiteboard in a room with multiple writers. The marker is the mutex. Without the marker rule, people scribble over each other. With it, writes are serialized. Everything you'll learn later — fairness, starvation, lock-free designs, atomics — is a refinement of this picture. Carry it with you.

### The "Interrupted at Any Instruction" Model

When reasoning about your concurrent code, mentally insert "// OS could pause this thread here" between **every single line**. Then ask: *"If another thread runs and touches the same data right now, is my code still correct when I resume?"* If the answer is "no" anywhere, you have a bug. The mutex is your way of saying "between `lock()` and `unlock()`, treat the whole block as one line."

### The "Reading from a Polaroid" Model (for memory visibility)

A thread's view of shared memory is not a live video feed; without synchronization, it can be a snapshot that's seconds old. The mutex is the moment the camera takes a fresh Polaroid. Code without locks can be reading from a stale photo while another thread is repainting the wall. This intuition saves you from the trap of *"but I wrote `done = true`, why doesn't the other thread see it?"*

---

## Code Examples

We solve the same problem in every language: **4 threads each increment a shared counter 1,000,000 times. Expected total: 4,000,000.** First the buggy version, then the fixed one. Run them yourself.

### C with pthreads — Buggy

```c
#include <stdio.h>
#include <pthread.h>

#define THREADS 4
#define ITERATIONS 1000000

long counter = 0;

void *worker(void *arg) {
    for (int i = 0; i < ITERATIONS; i++) {
        counter++;            // RACE: load, add, store
    }
    return NULL;
}

int main(void) {
    pthread_t t[THREADS];
    for (int i = 0; i < THREADS; i++) pthread_create(&t[i], NULL, worker, NULL);
    for (int i = 0; i < THREADS; i++) pthread_join(t[i], NULL);
    printf("expected=%d  got=%ld\n", THREADS * ITERATIONS, counter);
    return 0;
}
```

Sample output across runs: `got=2173998`, `got=3014562`, `got=3998112`. Never 4,000,000.

### C with pthreads — Fixed (mutex)

```c
#include <stdio.h>
#include <pthread.h>

#define THREADS 4
#define ITERATIONS 1000000

long counter = 0;
pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;

void *worker(void *arg) {
    for (int i = 0; i < ITERATIONS; i++) {
        pthread_mutex_lock(&lock);
        counter++;
        pthread_mutex_unlock(&lock);
    }
    return NULL;
}

int main(void) {
    pthread_t t[THREADS];
    for (int i = 0; i < THREADS; i++) pthread_create(&t[i], NULL, worker, NULL);
    for (int i = 0; i < THREADS; i++) pthread_join(t[i], NULL);
    printf("expected=%d  got=%ld\n", THREADS * ITERATIONS, counter);
    return 0;
}
```

Output every run: `expected=4000000  got=4000000`. Slower than the buggy version because of lock contention — that's the trade-off.

### Java — Buggy

```java
public class CounterRace {
    static long counter = 0;
    static final int THREADS = 4;
    static final int ITERATIONS = 1_000_000;

    public static void main(String[] args) throws InterruptedException {
        Thread[] t = new Thread[THREADS];
        for (int i = 0; i < THREADS; i++) {
            t[i] = new Thread(() -> {
                for (int j = 0; j < ITERATIONS; j++) counter++;
            });
            t[i].start();
        }
        for (Thread th : t) th.join();
        System.out.printf("expected=%d  got=%d%n", THREADS * ITERATIONS, counter);
    }
}
```

Same story: you'll never reliably see 4,000,000.

### Java — Fixed (`synchronized`)

```java
public class CounterFixed {
    static long counter = 0;
    static final Object lock = new Object();
    static final int THREADS = 4;
    static final int ITERATIONS = 1_000_000;

    public static void main(String[] args) throws InterruptedException {
        Thread[] t = new Thread[THREADS];
        for (int i = 0; i < THREADS; i++) {
            t[i] = new Thread(() -> {
                for (int j = 0; j < ITERATIONS; j++) {
                    synchronized (lock) {
                        counter++;
                    }
                }
            });
            t[i].start();
        }
        for (Thread th : t) th.join();
        System.out.printf("expected=%d  got=%d%n", THREADS * ITERATIONS, counter);
    }
}
```

The `synchronized(lock) { ... }` block *is* the mutex critical section. Reliable `got=4000000`.

> **Tip:** Java also has `AtomicLong` for this single-variable case — it's a lock-free counter and **much** faster. We cover that in `../../02-primitives/03-atomics/junior.md`. The point here is the model, not the optimal primitive.

### Python — Buggy

```python
import threading

THREADS = 4
ITERATIONS = 1_000_000
counter = 0

def worker():
    global counter
    for _ in range(ITERATIONS):
        counter += 1   # read-modify-write — NOT atomic across threads

threads = [threading.Thread(target=worker) for _ in range(THREADS)]
for t in threads: t.start()
for t in threads: t.join()
print(f"expected={THREADS * ITERATIONS}  got={counter}")
```

CPython has the **GIL** (Global Interpreter Lock), which means only one thread runs Python bytecode at a time. Many juniors assume this makes the program safe — *it does not*. `counter += 1` compiles to multiple bytecodes (`LOAD_GLOBAL`, `LOAD_CONST`, `BINARY_ADD`, `STORE_GLOBAL`) and the interpreter can switch threads between them. You'll routinely see results like `got=2347128`. The GIL eliminates *some* races (a single bytecode is atomic) but not *compound* ones.

### Python — Fixed (`threading.Lock`)

```python
import threading

THREADS = 4
ITERATIONS = 1_000_000
counter = 0
lock = threading.Lock()

def worker():
    global counter
    for _ in range(ITERATIONS):
        with lock:
            counter += 1

threads = [threading.Thread(target=worker) for _ in range(THREADS)]
for t in threads: t.start()
for t in threads: t.join()
print(f"expected={THREADS * ITERATIONS}  got={counter}")
```

`with lock:` is Python's RAII-style mutex: acquired on entry, released on exit (even on exception). Always `got=4000000`.

### Go — Buggy

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    const Threads = 4
    const Iterations = 1_000_000
    var counter int64
    var wg sync.WaitGroup
    for i := 0; i < Threads; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < Iterations; j++ {
                counter++ // DATA RACE
            }
        }()
    }
    wg.Wait()
    fmt.Printf("expected=%d  got=%d\n", Threads*Iterations, counter)
}
```

Run with `go run -race main.go` and Go's race detector will scream at you with a stack trace. Run without `-race` and you'll just get wrong numbers.

> **Note:** Goroutines are not a separate concurrency model from shared memory — they are still threads-of-execution that share the heap. Go *also* provides channels (CSP-style) as a recommended alternative, covered in `../04-csp/junior.md`. But `sync.Mutex` is pure shared-memory concurrency.

### Go — Fixed (`sync.Mutex`)

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    const Threads = 4
    const Iterations = 1_000_000
    var counter int64
    var mu sync.Mutex
    var wg sync.WaitGroup
    for i := 0; i < Threads; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < Iterations; j++ {
                mu.Lock()
                counter++
                mu.Unlock()
            }
        }()
    }
    wg.Wait()
    fmt.Printf("expected=%d  got=%d\n", Threads*Iterations, counter)
}
```

`go run -race main.go` is clean. Output: `expected=4000000  got=4000000`.

### Rust — Buggy (won't compile, and that's the point)

```rust
use std::thread;

fn main() {
    let mut counter: i64 = 0;
    let mut handles = vec![];
    for _ in 0..4 {
        handles.push(thread::spawn(|| {
            for _ in 0..1_000_000 {
                counter += 1;       // ERROR: cannot borrow `counter` as mutable
            }
        }));
    }
    for h in handles { h.join().unwrap(); }
    println!("got={}", counter);
}
```

Rust's borrow checker **refuses to compile** this. It sees four threads each claiming a mutable borrow on the same variable and rejects the program. Rust elevates the shared-memory rule into a compile-time error — you literally cannot write the buggy program. This is one of Rust's biggest selling points.

### Rust — Fixed (`Arc<Mutex<T>>`)

```rust
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    const THREADS: usize = 4;
    const ITERATIONS: i64 = 1_000_000;
    let counter = Arc::new(Mutex::new(0i64));
    let mut handles = vec![];
    for _ in 0..THREADS {
        let c = Arc::clone(&counter);
        handles.push(thread::spawn(move || {
            for _ in 0..ITERATIONS {
                let mut guard = c.lock().unwrap();
                *guard += 1;
            }
        }));
    }
    for h in handles { h.join().unwrap(); }
    println!("expected={}  got={}", THREADS as i64 * ITERATIONS, *counter.lock().unwrap());
}
```

`Arc` is "atomic reference count" — a thread-safe smart pointer so all four threads can co-own the counter. `Mutex<T>` wraps the data; `lock()` returns a guard that *contains* a mutable reference. When the guard goes out of scope, the lock is released automatically. Output: `expected=4000000  got=4000000`.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Performance (uncontended)** | Direct memory access — no copying, no marshalling, no message queue. Fastest possible model for fine-grained data sharing. | Cache coherence traffic when threads on different cores touch the same cache line (false sharing). |
| **Performance (contended)** | Lock-free designs (later) can scale linearly. | Locks serialize work. Two threads contending on one mutex run no faster than one. |
| **Mental model** | Same as single-threaded — variables are variables. Easy to get started. | Easy to get **wrong**. Bugs are nondeterministic and hard to reproduce. |
| **Memory usage** | One copy of the data, shared by N threads. | Locks add per-object overhead. |
| **Composability** | Combine any data structures freely. | Composing two thread-safe operations is **not** automatically thread-safe (see "compound operation pitfall"). |
| **Tooling** | Mature: pthread, Java `java.util.concurrent`, Go race detector, Rust borrow checker, ThreadSanitizer. | Race bugs in C/C++ are undefined behavior — may corrupt arbitrary memory. |
| **Debugging** | Single shared address space — debuggers see everything. | Heisenbugs: the bug disappears under the debugger. Stress testing is the main tool. |

---

## Use Cases

Shared-memory concurrency is the right tool when:

- **You need high-throughput counters or stats.** Per-thread or atomic counters, requests-per-second meters, hit/miss caches.
- **You have a large in-memory data structure that many threads read.** Caches, lookup tables, configuration. (Reader-writer locks shine here.)
- **You're writing a runtime, OS, or systems library.** When you *are* the concurrency primitive, you have no message-passing layer beneath you.
- **You need fine-grained synchronization at sub-microsecond cost.** Atomics and CAS loops live in this world.
- **Performance is dominated by memory bandwidth, not coordination.** Image processing, scientific computing on grids, ray tracing.

It is the **wrong** tool when:

- You're building loosely coupled actors. Use the actor model (`../03-actor-model/junior.md`).
- You want clean handoff semantics between goroutines/threads. Use channels (`../04-csp/junior.md`).
- Crossing a process or machine boundary. Use messaging.
- You want bulletproof correctness with little reasoning. Use STM (`../05-stm/junior.md`).

---

## Coding Patterns

### Pattern 1: Lock-around-data (the canonical pattern)

```go
type SafeCounter struct {
    mu sync.Mutex
    n  int64
}

func (c *SafeCounter) Inc()   { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c *SafeCounter) Get() int64 { c.mu.Lock(); defer c.mu.Unlock(); return c.n }
```

The mutex and the data it protects live **next to each other** in the same struct. Every method that touches `n` takes the lock. Junior rule: *the mutex and the field it guards are siblings.*

### Pattern 2: RAII / `defer` / `with` for unlock

In every language with scoped resource management, prefer it over manual unlock:

```python
with lock:        # Python
    update_state()
```

```rust
let guard = mutex.lock().unwrap();   // Rust — released when guard drops
update(&mut *guard);
```

```go
mu.Lock()
defer mu.Unlock()
update()
```

```java
synchronized (lock) {   // Java
    updateState();
}
```

This pattern eliminates the bug class "I forgot to unlock on the early-return path."

### Pattern 3: Coarse vs fine locking — start coarse

Beginners should reach for **one big lock** around the whole data structure first. Splitting into multiple locks is a performance optimization that introduces deadlock risk. Profile, then split.

### Pattern 4: Read-mostly data — copy or RWMutex

If reads vastly outnumber writes, either:

- Use a **reader-writer lock** (`sync.RWMutex` in Go, `RwLock` in Rust, `ReentrantReadWriteLock` in Java) so reads don't serialize against each other; or
- **Replace the whole structure** on write (copy-on-write) and atomically swap the pointer.

### Pattern 5: Never call user code while holding a lock

```text
mu.Lock()
callback()        // BUG: this can do anything — even try to take the same lock
mu.Unlock()
```

Take the lock, copy what you need, release, then call out.

---

## Clean Code

- **Lock-and-data live together.** The mutex is a field next to the data it guards. Comment what it guards if non-obvious.
- **Lock blocks are short.** Do the minimum inside the critical section. Nothing slow, nothing blocking, no I/O.
- **One lock per logical resource.** Don't reuse a mutex for unrelated state.
- **Document lock ordering.** If your program acquires multiple locks, write down the order. Always acquire in that order.
- **Prefer atomics over locks for single-value counters.** A `sync/atomic` operation is faster than `Mutex.Lock + ++ + Unlock` for a single `int64`.
- **Public methods take the lock; private helpers assume it's held.** Name the helpers `xxxLocked` (Go convention) or document it.
- **Never expose internal mutable state from behind a lock.** If `Get()` returns a pointer to internal data, the caller can race with you after you return.

---

## Best Practices

- **Use the race detector / sanitizer in CI.** `go test -race`, `cargo test` with `RUSTFLAGS=-Zsanitizer=thread`, `clang -fsanitize=thread`, Java's `ErrorProne` and stress tests. Race bugs are silent without tooling.
- **Write tests that hammer concurrent code with many threads and high iterations.** A single-thread test proves nothing.
- **Prefer immutable shared data.** If a value never changes after construction, it can be shared without any lock at all (sometimes called "publishing").
- **Prefer thread-confined data.** A variable that only one thread ever touches needs no synchronization. Sharing is the cost; avoid it where you can.
- **When in doubt, lock.** The wrong-but-correct program is fixable; the fast-but-incorrect program isn't.
- **Measure before optimizing locking.** Most contention is on a single hot lock. Fix that one, not the cold ones.
- **Lock granularity is a trade-off, not a goal.** Finer locks = more parallelism + more deadlock risk. Don't fragment prematurely.
- **Never hold a lock across an external call** — network, disk, callback, channel send. The wait time inside the critical section blocks every other thread.

---

## Edge Cases & Pitfalls

- **Compound operations.** Even if every method on a "thread-safe" data structure is internally locked, `if !map.contains(k) { map.put(k, v) }` is **two** locked operations with a window between them. Another thread can sneak in. Use `putIfAbsent` or hold the lock yourself.
- **Visibility without atomicity.** A 64-bit read on a 32-bit CPU can tear: you read the upper half before the writer updates it, and the lower half after. Use atomics or proper synchronization for multi-word values.
- **The "I checked it just above" trap.** `if (x != null) x.doStuff();` — if `x` is shared, another thread can null it between the check and the call. Take the lock around both, or copy `x` to a local.
- **Re-entrant vs non-reentrant locks.** Some mutexes (Java `synchronized`, Java `ReentrantLock`, Python `RLock`) let the **same thread** lock recursively. Most C/Go/Rust mutexes do not — re-locking from the same thread deadlocks. Know which you have.
- **Holding a lock during a long operation.** Sleeping, I/O, network calls, or sub-second compute inside a critical section is almost always a bug.
- **Locking on a per-call-new object.** `synchronized(new Object())` in Java means *every call gets its own lock* — it locks nothing.
- **Locking on a `String` literal or boxed integer.** Java interns these. Two unrelated classes can accidentally take the same lock.
- **`volatile` is not a mutex.** In Java/C# it gives you visibility but **not** atomic RMW. `volatile int x; x++;` still races.
- **CPython's GIL gives false confidence.** It serializes Python bytecode, not Python *operations*. `+=` is unsafe.
- **False sharing.** Two unrelated variables in the same 64-byte cache line cause cache thrashing when different cores write to them. A surprising performance bug, not a correctness one.

---

## Common Mistakes

1. **Forgetting to lock the read side.** If thread A writes under a lock and thread B reads without one, B can see stale or torn values. Both sides need synchronization.
2. **Using a different lock for read vs write of the same data.** The lock identity matters — mutexes only exclude *each other*, not *anyone with any lock*.
3. **`x++` on a "thread-safe" type.** A method being thread-safe doesn't make `x++` on it thread-safe — that's still a read followed by a write.
4. **Forgetting `defer Unlock` and returning early.** Critical section never releases. Next caller blocks forever.
5. **Calling out to user code while holding a lock.** The user code can call back into you, re-take the lock, and deadlock.
6. **Taking two locks in different orders in different code paths.** Classic deadlock recipe.
7. **Using `time.Sleep` to "fix" a race.** It hides the bug under load. The race is still there.
8. **Locking on the wrong scope.** Per-instance lock when you needed a class-wide one (multiple instances racing on shared static state), or vice versa.
9. **Treating Python's GIL as a substitute for `Lock`.** It isn't.
10. **Sharing mutable data without a lock "because it's just a flag."** A `bool done` written by one thread and read by another is a textbook race — use `atomic`/`volatile`/synchronization or you might never see it flip.

---

## Tricky Points

- **The bug is in the *interleaving*, not the lines.** Each line looks innocent. Code review of concurrent code requires imagining the schedule.
- **Optimizers reorder reads and writes.** The CPU and the compiler can both reorder memory operations across statements as long as single-threaded behavior is preserved. The mutex tells them: *don't reorder across this boundary.*
- **A successful run proves nothing.** Race bugs surface 1 in 10^6 schedules. Your laptop happens to schedule one way; production servers schedule another. Bug-free in dev, broken in prod.
- **The race detector finds *some* races, not all.** It detects races that *did happen* during execution, not all possible ones. Code paths it didn't hit are unchecked.
- **A "thread-safe" library type does not make compound operations safe.** `ConcurrentHashMap.get` and `put` are each thread-safe, but `get-then-put` is not.
- **Re-entrant locks can hide bugs.** They let you accidentally hold a lock recursively where a non-reentrant lock would have caught your invariant violation by deadlocking.
- **Stack-allocated values are not automatically thread-confined.** If you pass a pointer to a stack-allocated variable into a goroutine/thread, the compiler will move it to the heap and now it's shared.
- **`if (!initialized) initialize();` is the classic double-checked-locking trap.** Without proper memory barriers, another thread can see `initialized = true` *before* it sees the fully-initialized object.

---

## Test Yourself

1. Draw the instruction-level interleaving where two threads each running `counter = counter + 1` produce a final counter of 1 (not 2). Be precise about the order of LOAD, ADD, STORE.
2. In the C counter example, run it with `THREADS = 1`. Does the bug disappear? Why?
3. Take the buggy Java example. Change `long counter` to `volatile long counter`. Does it become correct? Why or why not?
4. Take the Python buggy example. Change the loop to `counter = counter + 1` written as one line, then `counter += 1`, then `counter = counter.__add__(1)`. Are they equivalent in race-ness? Explain why.
5. In the Go buggy example, swap `int64 counter` for `var counter atomic.Int64` and replace `counter++` with `counter.Add(1)`. Predict the output. Then run it.
6. Why does Rust's borrow checker reject the buggy Rust example *at compile time*, while Go and C let it run? What does Rust know that the others don't?
7. You have two methods, `Deposit(amount)` and `Withdraw(amount)`, each locking the same mutex. A user calls `Transfer(from, to, amount)` that does `from.Withdraw(amount); to.Deposit(amount);`. Is `Transfer` atomic? If a third thread reads both balances between these two calls, what does it see?
8. Write a program in your favorite language with two locks, A and B, and demonstrate a deadlock by acquiring them in opposite orders in two threads.

---

## Tricky Questions

**Q1: Is `int x = 0;` (a simple write to a `int`) atomic in C?**

Sort of, but you shouldn't rely on it. On most modern hardware, an aligned write to a machine-word-sized integer is atomic at the CPU level — it won't tear. But the *C standard* makes no such guarantee, and the compiler is free to assume no other thread touches `x` and reorder/elide the write. Use `_Atomic int` or `<stdatomic.h>` to make it formally atomic. The lesson: hardware-atomic and language-atomic are different things.

**Q2: Does Python's GIL make `counter += 1` safe?**

No. The GIL guarantees only one Python bytecode runs at a time. `counter += 1` compiles to several bytecodes (load global, push constant, add, store global), and the interpreter can switch threads between any two of them. Use `threading.Lock` or `itertools.count` (which uses C-level atomic operations).

**Q3: If only one thread writes and many threads read, do the readers need a lock?**

Yes, generally. Without synchronization, readers may see torn writes (on multi-word values), stale values forever (compiler caches the value in a register), or out-of-order writes from the writer. The mechanism varies — atomics, `volatile`, mutex, memory barriers — but synchronization is required.

**Q4: Why is `synchronized` in Java sometimes slower than `AtomicLong`?**

`synchronized` involves: a monitor object, possibly OS-level thread parking on contention, biased locking heuristics, and a full memory barrier. `AtomicLong` on a counter is a single CPU instruction (`LOCK XADD` on x86). For a *single* variable, atomics win. For *multi-variable* invariants, you need a lock.

**Q5: Can a deadlock happen with a single lock?**

With a non-reentrant mutex, yes — a thread that takes a lock and then tries to take it again deadlocks against itself. With a reentrant mutex, no, the same thread can re-enter. But you can still create a livelock or a starvation case.

**Q6: Two threads each increment a shared `int` 1 million times under a mutex. Is the final value guaranteed to be 2 million?**

Yes, with proper locking on every access. The mutex serializes the increments, and the happens-before edges from each `unlock` to the next `lock` guarantee every increment is visible to the next holder. This is the entire purpose of the lock.

**Q7: Is `if (cache.contains(k)) return cache.get(k); else return loadAndPut(k);` thread-safe with a thread-safe cache?**

No. Two threads can both pass the `contains` check, both miss it, and both call `loadAndPut`. Use the cache's `computeIfAbsent` (Java), `entry().or_insert_with` (Rust), or hold a lock spanning both calls. The compound operation is the trap.

**Q8: My program works fine on my 8-core laptop but races in production on a 64-core server. Why?**

More cores mean more *true parallelism* (not just time-slicing) which exposes races faster. Also, cache-coherence effects and the scheduler's preemption pattern change. A program that has a race "but rarely" will demonstrate the race far more often as core count rises.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                 SHARED-MEMORY CONCURRENCY                        │
├──────────────────────────────────────────────────────────────────┤
│ What's shared:  heap, globals, statics                           │
│ What's private: stack, registers                                 │
├──────────────────────────────────────────────────────────────────┤
│ Operations on shared data:                                       │
│   READ           safe iff no concurrent write                    │
│   WRITE          safe iff no concurrent read or write            │
│   READ-MODIFY-W  almost never safe — needs lock or atomic        │
├──────────────────────────────────────────────────────────────────┤
│ Critical section = code that must run by ≤ 1 thread at a time    │
│ Mutex = mutual-exclusion lock for the critical section           │
├──────────────────────────────────────────────────────────────────┤
│ Language quick-reference                                         │
│   C        pthread_mutex_lock / unlock                           │
│   Java     synchronized(obj) { ... } / ReentrantLock             │
│   Python   with lock:   (and beware the GIL myth)                │
│   Go       mu.Lock(); defer mu.Unlock()                          │
│   Rust     let g = mtx.lock().unwrap(); (drop releases)          │
├──────────────────────────────────────────────────────────────────┤
│ The Big Four bugs:                                               │
│   1. Data race      — unsynchronized access, ≥1 write            │
│   2. Lost update    — RMW without atomicity                      │
│   3. Torn read      — multi-word value read mid-write            │
│   4. Deadlock       — circular wait for locks                    │
├──────────────────────────────────────────────────────────────────┤
│ Hygiene rules:                                                   │
│   * lock and data live together                                  │
│   * keep critical sections short                                 │
│   * never call out (I/O, callback) while holding a lock          │
│   * always release on every path (RAII / defer / with)           │
│   * acquire multiple locks in a fixed global order               │
│   * run with the race detector / sanitizer in CI                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Shared memory** = multiple threads reading and writing the same heap addresses. The default for OS threads in every mainstream language.
- The CPU/OS realities: threads are **scheduled**, paused at any instruction, and run in parallel on multiple cores. You can't predict the interleaving.
- The canonical bug is the **data race**, especially in **read-modify-write** operations like `counter++`. A million-iteration counter test will fail every time without synchronization.
- The first cure is the **mutex** (lock): a "one thread at a time" gate around the **critical section**.
- Every mainstream language has the same shape: `lock`/`unlock` (C, Go), `synchronized` block (Java), `with lock:` (Python), `Mutex<T>` + guard drop (Rust). The names differ; the model is identical.
- Rust elevates the rule into the **borrow checker**: many shared-memory bugs become compile errors.
- **Happens-before** is the invisible guarantee a mutex gives you: anything written before `unlock` is visible after the next `lock`. Without it, even a `bool done` flag can be invisible forever.
- The shared-memory model is **fast** (no copying, direct access) but **error-prone** (every variable is a potential racing point).
- Sibling models — **message passing, actors, CSP channels, STM** — exist exactly to remove this foot-gun in exchange for some performance and some flexibility.
- A junior's #1 habit: when you see a shared variable being modified, **suspect a race until proven otherwise.** The mutex is your first answer.

---

## What You Can Build

- **A thread-safe counter library.** Implement increment, decrement, add, get, and reset, all thread-safe. Stress-test with 8 threads × 10M ops.
- **A bank account simulator.** N threads doing random transfers between M accounts. Verify total money is conserved at the end. Try it with no locks, then per-account locks. Watch for deadlocks when transferring between accounts in different orders.
- **A bounded counter / rate limiter.** Cap at K events per second. Many threads call `Allow()`. Verify exact counts.
- **A "buggy on purpose" demo.** Write the same race in 4 languages and produce a chart of how often it's wrong, by language and thread count.
- **A toy producer-consumer with one shared array.** Producers write, consumers read. Add a mutex; verify correctness; then think about what's wrong with this design (hint: it's a busy-wait — next stop, condition variables in `middle.md`).
- **A stress harness for a coworker's "thread-safe" class.** Hammer their public API from many threads. If it ever produces a wrong answer, file a bug.

---

## Further Reading

- *The Art of Multiprocessor Programming* — Maurice Herlihy & Nir Shavit. The definitive academic reference.
- *Java Concurrency in Practice* — Brian Goetz et al. The most readable book on shared-memory concurrency in any language. Concepts apply far beyond Java.
- *Programming with POSIX Threads* — David Butenhof. The pthread bible.
- *The Rust Book* — Chapter 16 ("Fearless Concurrency"). https://doc.rust-lang.org/book/ch16-00-concurrency.html
- *The Go Memory Model* — https://go.dev/ref/mem
- *The Java Memory Model FAQ* — Jeremy Manson & Bill Pugh. https://www.cs.umd.edu/~pugh/java/memoryModel/jsr-133-faq.html
- *Memory Models: A Case for Rethinking Parallel Languages and Hardware* — Adve & Boehm, CACM 2010.
- *Threads Cannot Be Implemented as a Library* — Hans Boehm, 2005. Why C without atomics is fundamentally broken for concurrency.
- *Preshing on Programming* — a blog series on lock-free programming with crystal-clear explanations. https://preshing.com/
- *Linux man page* — `pthread_mutex_init(3)`. Required reading if you're writing C.

---

## Related Topics

- This folder, next levels: [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md), [`find-bug.md`](find-bug.md), [`optimize.md`](optimize.md), [`specification.md`](specification.md).
- Alternative concurrency models in this same folder family:
  - [Message Passing — Junior](../02-message-passing/junior.md) — explicit `send/recv` of values, no shared state.
  - [Actor Model — Junior](../03-actor-model/junior.md) — isolated actors with mailboxes (Erlang, Akka).
  - [CSP — Junior](../04-csp/junior.md) — Communicating Sequential Processes (Go channels, occam).
  - [STM — Junior](../05-stm/junior.md) — software transactional memory (Haskell, Clojure).
- Primitive deep-dive: [Mutex — Junior](../../02-primitives/01-mutex/junior.md).
- The bug class this model creates: [Race Conditions — Junior](../../05-race-conditions/junior.md).
- Concurrency cousins outside this folder:
  - `../../../diagnostics/debugging/junior.md` for general debugging mindset.
  - `../../../code-craft/clean-code/README.md` for the broader hygiene context.

---

## Diagrams & Visual Aids

### Two Threads, One Counter, No Lock

```text
TIME ─►

Thread A:  LOAD R = counter (0)
                                  ↓ context switch
Thread B:                         LOAD R = counter (0)
                                  ADD R = 1
                                  STORE counter = 1
                                  ↓ context switch
Thread A:  ADD R = 1
           STORE counter = 1

                       counter = 1   ← expected 2. LOST UPDATE.
```

### Same Story, With a Mutex

```text
TIME ─►

Thread A:  LOCK mu
           LOAD R = counter (0)
           ADD R = 1
           STORE counter = 1
           UNLOCK mu                ─┐ happens-before edge
                                     │
Thread B:                            ▼ LOCK mu  (sees counter = 1)
                                       LOAD R = counter (1)
                                       ADD R = 1
                                       STORE counter = 2
                                       UNLOCK mu

                       counter = 2   ← correct.
```

### The Thread / Process / Memory Picture

```text
┌──────────────────────────── PROCESS ──────────────────────────────┐
│                                                                   │
│   ┌─── Thread 1 ────┐  ┌─── Thread 2 ────┐  ┌─── Thread 3 ────┐   │
│   │  stack          │  │  stack          │  │  stack          │   │
│   │  registers      │  │  registers      │  │  registers      │   │
│   │  PC             │  │  PC             │  │  PC             │   │
│   └────────┬────────┘  └────────┬────────┘  └────────┬────────┘   │
│            │                    │                    │            │
│            └────────────┬───────┴────────────────────┘            │
│                         ▼                                         │
│            ┌─────────────────────────────────┐                    │
│            │  HEAP  +  GLOBALS  +  STATICS   │  ◄── shared        │
│            │   (this is where races live)    │                    │
│            └─────────────────────────────────┘                    │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

### Critical Section Sandwich

```text
            ┌─────────────────────┐
            │  ...other code...   │
            └──────────┬──────────┘
                       ▼
                   LOCK(mu)   ◄── gate: at most 1 thread past this
            ┌──────────────────────┐
            │   CRITICAL SECTION   │
            │   read/write shared  │
            │   data here          │
            └──────────┬───────────┘
                       ▼
                  UNLOCK(mu)   ◄── releases gate; next thread enters
            ┌──────────────────────┐
            │   ...other code...   │
            └──────────────────────┘
```

### The Deadlock Picture (Preview of `middle.md`)

```text
Thread A holds  ──► Lock 1
                       │
                       │ wants
                       ▼
                    Lock 2  ◄── held by Thread B
                       │
                       │ wants
                       ▼
                    Lock 1  ◄── held by Thread A

       Cycle = deadlock.  Nobody releases.  Nobody proceeds.
```
