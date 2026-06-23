# Mutex — Junior Level

> **Topic:** [Mutex](README.md)
> **Focus:** lock/unlock, critical sections, RAII guards

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

A **mutex** — short for **Mut**ual **Ex**clusion lock — is the oldest, simplest,
and most widely used concurrency primitive in existence. If you have ever
written a program that uses threads, you have either used a mutex on purpose,
or you have used a library that uses one under the hood.

The idea is almost embarrassingly simple. Imagine a hotel bathroom shared by
five guests. Only one person can use it at a time. To enforce that rule, you
hang a single key on a hook outside the door. Whoever grabs the key first
goes in, locks the door, does their business, comes out, and puts the key
back on the hook. The next person who reaches for the hook takes the key
next. There is exactly one key. There is exactly one occupant at a time.
There is no schedule, no list, no committee — just a token of "I have it,
you don't."

A mutex is that key. It is a small piece of state, managed by the operating
system or the language runtime, that exactly one thread can "hold" at a
time. Every other thread that tries to acquire it while it is held will
**block** — that is, the OS suspends the thread until the lock becomes
available. When the holder releases the lock, exactly one of the waiters is
woken up and given the lock next.

Why do we need this? Because shared mutable state plus concurrent access
equals **data races**. A data race is the situation where two threads touch
the same memory location at the same time, at least one of them is writing,
and there is no synchronization between them. Data races are *undefined
behavior* in C, C++, Go, and Rust — meaning the compiler is allowed to do
literally anything, including producing wrong answers, corrupting memory,
or making your program crash months later in production. A mutex is the
simplest fix: wrap the shared state in a mutex, and the moment a thread
holds the lock, no other thread can touch the protected data.

Every mainstream language ships a mutex. C has `pthread_mutex_t`, C++ has
`std::mutex`, Go has `sync.Mutex`, Java has both the built-in `synchronized`
keyword and the more flexible `ReentrantLock`, Python has `threading.Lock`,
and Rust has `std::sync::Mutex<T>` — which is special because it wraps the
data itself, making it impossible at compile time to access the data without
holding the lock. The flavors differ, but the core contract is the same:
**lock, do work, unlock**.

This page is the junior-level introduction to that core contract. You will
learn what a mutex is at the machine level, what "acquire" and "release"
actually do, why double-unlock is undefined behavior, what RAII guards are
and why they exist, what reentrant means, and how to fix the classic
counter race in six different languages. By the end you will be able to
read code that uses a mutex, write code that uses one correctly, and
recognize when you are about to do something dangerous.

We will not yet cover deadlock avoidance strategies, lock-free programming,
or the implementation details of how the kernel parks a thread. Those
belong on the middle, senior, and professional pages. Here we focus on
the contract and the discipline you need to use a mutex without shooting
yourself in the foot.

---

## Prerequisites

Before this page makes full sense, you should be comfortable with:

- **Threads and processes.** You should know that a thread is a unit of
  execution inside a process, and that multiple threads inside the same
  process share memory. If you have ever called `pthread_create`,
  `std::thread`, `go func() {}`, `new Thread()`, `threading.Thread`, or
  `std::thread::spawn`, you are ready.
- **What a race condition is.** You do not need to have implemented one;
  you just need to know that two threads writing the same variable can
  produce nonsense. The classic example — `counter++` from many threads
  losing increments — should not be a mystery.
- **Basic memory model intuition.** You should know that a write by one
  thread is not automatically visible to another thread. You will revisit
  this on the [shared-memory](../../01-models/01-shared-memory/junior.md)
  and [atomic](../04-atomic/junior.md) pages, but a vague sense of
  "memory isn't magic" is enough for now.
- **Function calls and exceptions.** Several mistakes around mutexes
  involve early returns, panics, or exceptions skipping the unlock. You
  should know how each of the example languages signals errors.
- **RAII at least vaguely.** If you have written C++ with `std::unique_ptr`
  or Rust with `Box<T>`, you have used RAII. If you have only written
  Python or Java, do not worry — the section on RAII guards will explain
  it from scratch.

If you have not yet built a small multi-threaded program, do that first.
Start a couple of threads, have them each increment a shared counter a
million times without any synchronization, and observe that the final
value is almost never `2_000_000`. That experiment is the strongest
possible motivation for learning what a mutex does.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Mutex** | A synchronization primitive that allows at most one thread to hold it at any moment. Short for **MUT**ual **EX**clusion lock. |
| **Critical section** | A region of code that accesses shared mutable state and must execute under mutual exclusion. The code between `lock()` and `unlock()`. |
| **Acquire** | The operation that takes the lock. Also called `lock()`, `Lock()`, `acquire()`, `enter()`. Blocks if another thread holds the lock. |
| **Release** | The operation that gives the lock back. Also called `unlock()`, `Unlock()`, `release()`, `exit()`. Must be called by the same thread that acquired. |
| **Lock guard** | An object whose lifetime corresponds to "the lock is held". Constructed on acquire, releases on destruction. Examples: `std::lock_guard`, Rust `MutexGuard`. |
| **RAII** | Resource Acquisition Is Initialization — a C++/Rust idiom where resource ownership is tied to object lifetime. The destructor releases the resource. |
| **Deadlock** | A state where two or more threads each wait for a lock the other holds, so no one ever makes progress. |
| **Reentrant** | A property of a mutex whereby the same thread can lock it multiple times without deadlocking, as long as it unlocks the same number of times. |
| **Spinlock** | A lock variant where waiters busy-loop on a CPU instead of sleeping. Faster for very short critical sections, wasteful otherwise. |
| **Fairness** | A property of a mutex implementation about whether waiters are served in FIFO order or whether the OS may give the lock back to a thread that just released it. |

---

## Core Concepts

### What a mutex actually is

At the machine level, a mutex is a tiny piece of memory — usually a single
word, sometimes a small struct — plus a contract with the operating system
or runtime about what to do when contention happens.

The word stores at least:

- whether the lock is held (often a single bit, `0` or `1`),
- often the identity of the holding thread (so the runtime can detect
  illegal unlocks or implement reentrance),
- often a wait queue or a pointer to one (so waiters can be parked and
  woken up).

When you call `lock()`, the implementation tries to flip the held-bit from
`0` to `1` using a special CPU instruction called a **compare-and-swap**
(CAS) or a similar atomic operation. If the bit was `0`, the swap
succeeds, you now hold the lock, and you return from `lock()` immediately
without involving the kernel. This is the fast path, and it is fast — a
few nanoseconds.

If the bit was already `1` — somebody else holds the lock — your call
falls into the slow path. The runtime asks the kernel to park your
thread on a wait queue associated with this mutex. The kernel stops
scheduling your thread until somebody wakes it. On Linux, this uses a
mechanism called a **futex** (fast userspace mutex); on Windows it uses
`WaitOnAddress`; macOS uses `__ulock_wait`. The details differ but the
shape is the same: the kernel only gets involved when there is real
contention.

When the holder calls `unlock()`, the implementation flips the bit back
to `0` and, if any thread is parked on the wait queue, asks the kernel to
wake one (or sometimes all). The woken thread re-attempts the CAS, finds
it succeeds, and returns from its long-suspended `lock()` call.

You do not need to remember the futex word in everyday code. You just need
to remember: **lock is cheap when uncontended, expensive when contended**.
That fact alone justifies a lot of the best practices later in this page.

### Acquire (Lock) and release (Unlock)

The two operations on a mutex are `lock` and `unlock`. Together they
delimit a **critical section**:

```text
mu.lock()      // acquire
// ---- critical section ----
// touch shared state
mu.unlock()    // release
```

`lock()` is a blocking call. If the lock is free, it returns immediately.
If it is held by someone else, it suspends your thread until the lock
becomes available. Most mutex APIs also provide a non-blocking variant
called `try_lock()` that returns `false` immediately if the lock is held
rather than waiting.

`unlock()` always returns immediately. It is non-blocking. Its job is to
release the lock and, if there are waiters, wake one of them up.

The pairing rule is sacred: **every successful `lock()` must be matched by
exactly one `unlock()`, on the same thread**. Forget to unlock, and every
future caller blocks forever. Unlock twice, and you trip undefined
behavior. Unlock from a different thread, and on most implementations
you trip undefined behavior again.

### The critical section pattern

The phrase "critical section" comes from Edsger Dijkstra in the 1960s. It
means: a region of code that accesses a resource which must be used by
only one process at a time. The mutex is the mechanism; the critical
section is the code the mechanism protects.

A good critical section has three properties:

1. **It is as small as possible.** The longer you hold the lock, the more
   other threads queue up behind you. Compute everything you can outside
   the lock, take the lock, do the minimum, release.
2. **It does not call slow or blocking operations.** Never do disk I/O,
   network I/O, or `sleep()` while holding a lock unless you have a very
   good reason. Other threads are waiting.
3. **It does not call user-supplied callbacks.** If a callback re-enters
   your code and tries to acquire the same lock, you deadlock.

A bad critical section holds the lock during a network call. A good one
copies the data it needs, releases the lock, then does the network call.

### Why double-unlock is undefined behavior

The mutex bit is either `0` (free) or `1` (held). When you call `unlock()`
you flip `1` to `0`. If you call `unlock()` *again* without an intervening
`lock()`, you are flipping a `0` to a `0`... or worse, possibly flipping
to `0` after another thread has just flipped to `1`, silently removing
*their* lock. From that moment on, two threads believe they hold the
lock; mutual exclusion is broken; the program is corrupt.

Most implementations refuse to detect this — checking it costs cycles on
the fast path. C's `pthread_mutex_unlock` on a non-error-checking mutex
that you do not hold is undefined behavior. C++ `std::mutex::unlock` from
a thread that does not own the mutex is undefined behavior. Go's
`sync.Mutex.Unlock` of an unlocked mutex panics — Go is one of the few
runtimes that does check. Python's `threading.Lock.release` on an
unlocked lock raises `RuntimeError`. Java's `ReentrantLock.unlock`
without holding throws `IllegalMonitorStateException`.

The defensive rule is simple: structure your code so that double-unlock
is *impossible*, not just unlikely. That is what RAII guards do.

### RAII guards

The single most common mistake with raw `lock()` / `unlock()` is forgetting
to unlock. You write:

```cpp
mu.lock();
if (something_bad) return;   // OOPS — never unlocked
do_work();
mu.unlock();
```

That `return` skipped the unlock. Now every future caller of this function
hangs forever, and your service is down.

The solution every modern language adopts in some form is the **lock
guard**: an object whose lifetime is the critical section. You construct
the guard when you take the lock; the guard's destructor releases the
lock; and the compiler guarantees the destructor runs no matter how you
leave the scope — normal return, exception, early `break`, or panic.

In C++, this is `std::lock_guard<std::mutex>`:

```cpp
{
    std::lock_guard<std::mutex> guard(mu);
    if (something_bad) return;  // guard destructor unlocks first
    do_work();
} // guard destructor unlocks here
```

In Rust, locking returns a `MutexGuard<T>`. Drop the guard, the lock is
released. There is no way to access the protected data without holding
a guard — the type system enforces it.

In Go, the idiom is `defer`:

```go
mu.Lock()
defer mu.Unlock()
// rest of function — Unlock runs no matter how we exit
```

In Java, the classical pattern is `try { ... } finally { lock.unlock(); }`,
or you simply use the `synchronized` block which has unlock built into
the language.

In Python, the idiom is `with lock:` — the context manager protocol
releases the lock when the `with` block exits, even on exception.

Use a guard. Always. Raw `lock()`/`unlock()` calls in modern code are a
smell.

### Reentrant vs non-reentrant

A **non-reentrant** mutex is the default. If thread T holds the lock and
T tries to lock it again, T deadlocks against itself. This is a feature,
not a bug — it forces you to design your code so that lock-holding is
explicit and bounded.

A **reentrant** (also called **recursive**) mutex allows the same thread
to lock multiple times. It maintains a recursion count: each `lock()`
increments the count, each `unlock()` decrements it, and only when the
count returns to zero is the lock actually released and another thread
allowed in.

C++'s `std::mutex` is non-reentrant; `std::recursive_mutex` is reentrant.
Go's `sync.Mutex` is non-reentrant (no recursive version is provided —
this is intentional). Java's `synchronized` blocks and `ReentrantLock`
are both reentrant. Python's `threading.Lock` is non-reentrant;
`threading.RLock` is reentrant. Rust's `std::sync::Mutex` is non-reentrant.

Reentrance sounds convenient, but it has costs. It hides who really
holds the lock; it makes invariant reasoning harder ("am I holding this
because I just took it, or because my caller did?"); it makes the
implementation slower. Prefer non-reentrant locks. If you find yourself
*needing* a reentrant lock, that is usually a signal that your locking
design has too much overlap and should be refactored.

### The classic counter race fix

Here is the example everybody has seen. Two threads each increment a
shared counter one million times. Without a mutex, the final value is
almost never `2_000_000`:

```text
Without mutex: final = 1_374_215 (different every run)
With    mutex: final = 2_000_000 (every run)
```

Why does this happen? Because `counter++` is not one operation; it is
three: load the current value, add one, store the result. Two threads
can both load `42`, both compute `43`, and both store `43` — one of the
increments vanishes. A mutex around the increment forces the three
operations to happen atomically with respect to other threads. Whoever
gets the lock first runs load-add-store before the other thread even
gets to load.

The code section below shows this fix in six languages.

### Hold the lock as briefly as possible

This is the single most important practical rule. Do not hold a lock
across slow operations. Do not hold a lock during user-callback
invocations. Do not hold a lock during disk or network I/O.

If you must do a slow thing on data that is protected, copy the data
out under the lock, release the lock, then do the slow thing on the
copy:

```text
mu.lock()
data := shared.deepCopy()
mu.unlock()

// slow thing on `data` — other threads unblocked
processSlowly(data)
```

Holding a lock during `time.Sleep`, `read(socket)`, `printf` to a
slow terminal, or — God forbid — a synchronous HTTP request, is one
of the most common production-grade lock mistakes you will see in
your career.

---

## Real-World Analogies

**Single-occupant restroom.** A small café has one bathroom and one key
hanging on a hook by the counter. Whoever takes the key uses the
bathroom; everyone else waits. When they come back and rehang the key,
the next person in line takes it. The key is the mutex. The bathroom is
the critical section. Forgetting to rehang the key — leaving with it in
your pocket — is the bug. The café manager who walks around with a
spare key and lets people in anyway is your data race.

**Talking stick.** Indigenous council traditions sometimes use a "talking
stick": only the person holding the stick may speak. Others wait their
turn. The stick enforces mutual exclusion over the shared resource — the
group's attention. Pass the stick, someone else may speak. Try to talk
without the stick, you are out of order. A mutex is a talking stick for
threads.

**Conch shell.** William Golding's *Lord of the Flies* uses a conch
shell as a speaking token in the boys' assembly. Whoever holds the conch
may speak; the rest must listen. When Piggy is killed and the conch
shatters, mutual exclusion collapses and chaos breaks out. This is what
happens when you double-unlock a mutex: the shell shatters and any
number of threads believe they may speak. Programs do not survive that.

---

## Mental Models

### The hook with one key

Picture a small board with a single hook. On the hook hangs a single
key. A thread that wants the lock walks up to the board:

- Key on hook? Take it. You now hold the lock.
- Key not on hook? Wait by the board. Somebody must put it back.

When you are done, you walk back to the board and hang the key. If anyone
is waiting, one of them grabs it and walks off. If nobody is waiting,
the key stays on the hook for the next person.

That is essentially what `lock()` and `unlock()` do at the OS level. The
"hook" is the futex word in kernel memory.

### The state machine

A mutex has two states: **free** and **held**. The transitions are:

- **free → held**: a thread calls `lock()` successfully.
- **held → free**: the holding thread calls `unlock()`.

Any other transition is an error: held → held by another thread
(double-lock from a different thread without unlock), free → free
(double-unlock), or "unlock by a thread that does not hold it" are all
undefined or panicking behaviors.

### The waiting room

When a lock is contended, the runtime maintains a queue (or sometimes a
less ordered structure, depending on the implementation's fairness
guarantees). When `unlock()` runs, the runtime peeks into the waiting
room and wakes up at least one waiter, who then re-attempts the lock.
On most modern implementations the waker hands the lock directly to the
woken thread, but some implementations allow a freshly arriving thread
to steal the lock first — this is called "barging" and trades fairness
for throughput.

You do not need to think about this in junior-level code. You just need
to know that "thread is waiting on a mutex" is a real OS state — your
debugger and profiler can show it to you.

---

## Code Examples

The following examples all implement the same scenario: two threads each
incrementing a shared counter `N` times. Without a mutex, the final
result is random and almost always less than `2N`. With a mutex, the
final result is always exactly `2N`. Every example shows the broken
version first, then the fix.

### C with pthreads

```c
// counter_race.c — compile with: cc -pthread counter_race.c -o counter_race
#include <pthread.h>
#include <stdio.h>

#define N 1000000

static long counter = 0;
static pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;

static void *worker_unsafe(void *arg) {
    (void)arg;
    for (int i = 0; i < N; i++) {
        counter++;            // RACE: load-add-store is not atomic
    }
    return NULL;
}

static void *worker_safe(void *arg) {
    (void)arg;
    for (int i = 0; i < N; i++) {
        pthread_mutex_lock(&mu);
        counter++;            // critical section
        pthread_mutex_unlock(&mu);
    }
    return NULL;
}

int main(void) {
    pthread_t t1, t2;

    counter = 0;
    pthread_create(&t1, NULL, worker_unsafe, NULL);
    pthread_create(&t2, NULL, worker_unsafe, NULL);
    pthread_join(t1, NULL);
    pthread_join(t2, NULL);
    printf("unsafe: counter = %ld (expected %d)\n", counter, 2 * N);

    counter = 0;
    pthread_create(&t1, NULL, worker_safe, NULL);
    pthread_create(&t2, NULL, worker_safe, NULL);
    pthread_join(t1, NULL);
    pthread_join(t2, NULL);
    printf("safe:   counter = %ld (expected %d)\n", counter, 2 * N);

    pthread_mutex_destroy(&mu);
    return 0;
}
```

Note: pthreads has no RAII. You must pair every `pthread_mutex_lock`
with a `pthread_mutex_unlock`. Forgetting one on an early return is the
classic C concurrency bug.

### C++ with std::mutex and std::lock_guard

```cpp
// counter_race.cpp — compile with: c++ -std=c++17 -pthread counter_race.cpp
#include <iostream>
#include <mutex>
#include <thread>

constexpr int N = 1'000'000;

long counter = 0;
std::mutex mu;

void worker_unsafe() {
    for (int i = 0; i < N; i++) counter++;     // race
}

void worker_safe() {
    for (int i = 0; i < N; i++) {
        std::lock_guard<std::mutex> guard(mu); // RAII: unlocks on scope exit
        counter++;
    }
}

int main() {
    counter = 0;
    std::thread a(worker_unsafe), b(worker_unsafe);
    a.join(); b.join();
    std::cout << "unsafe: " << counter << " (expected " << 2 * N << ")\n";

    counter = 0;
    std::thread c(worker_safe), d(worker_safe);
    c.join(); d.join();
    std::cout << "safe:   " << counter << " (expected " << 2 * N << ")\n";
}
```

`std::lock_guard` cannot be copied, cannot be moved, and unlocks in its
destructor. Even if the body of the critical section throws, the
destructor still runs as the stack unwinds, and the lock is released.

### Go with sync.Mutex

```go
// counter_race.go — run with: go run counter_race.go
package main

import (
    "fmt"
    "sync"
)

const N = 1_000_000

func main() {
    var counter int64
    var wg sync.WaitGroup

    // Unsafe version
    counter = 0
    wg.Add(2)
    for i := 0; i < 2; i++ {
        go func() {
            defer wg.Done()
            for j := 0; j < N; j++ {
                counter++ // race
            }
        }()
    }
    wg.Wait()
    fmt.Printf("unsafe: counter = %d (expected %d)\n", counter, 2*N)

    // Safe version
    var mu sync.Mutex
    counter = 0
    wg.Add(2)
    for i := 0; i < 2; i++ {
        go func() {
            defer wg.Done()
            for j := 0; j < N; j++ {
                mu.Lock()
                counter++
                mu.Unlock()
            }
        }()
    }
    wg.Wait()
    fmt.Printf("safe:   counter = %d (expected %d)\n", counter, 2*N)
}
```

Run the unsafe version with `go run -race counter_race.go` and the Go
race detector will scream at you with a clear report. The race detector
is one of Go's best features; use it on every test run.

The idiomatic Go pattern for whole-function critical sections is
`defer mu.Unlock()` immediately after `mu.Lock()`. That keeps the
"unlock will happen" obvious at the top of the function and works even
if the body panics.

### Java: synchronized and ReentrantLock

```java
// CounterRace.java — compile: javac CounterRace.java
public class CounterRace {
    static final int N = 1_000_000;
    static long counter = 0;
    static final Object monitor = new Object();
    static final java.util.concurrent.locks.ReentrantLock lock =
        new java.util.concurrent.locks.ReentrantLock();

    static void workerUnsafe() {
        for (int i = 0; i < N; i++) counter++;        // race
    }

    static void workerSynchronized() {
        for (int i = 0; i < N; i++) {
            synchronized (monitor) {                  // built-in lock
                counter++;
            }
        }
    }

    static void workerReentrantLock() {
        for (int i = 0; i < N; i++) {
            lock.lock();
            try {
                counter++;
            } finally {
                lock.unlock();                        // always runs
            }
        }
    }

    public static void main(String[] args) throws InterruptedException {
        runPair("unsafe", CounterRace::workerUnsafe);
        runPair("synchronized", CounterRace::workerSynchronized);
        runPair("ReentrantLock", CounterRace::workerReentrantLock);
    }

    static void runPair(String label, Runnable body) throws InterruptedException {
        counter = 0;
        Thread t1 = new Thread(body);
        Thread t2 = new Thread(body);
        t1.start(); t2.start();
        t1.join();  t2.join();
        System.out.printf("%-14s counter = %d (expected %d)%n", label, counter, 2 * N);
    }
}
```

`synchronized` is the simplest Java mutex. Every Java object has an
intrinsic monitor; `synchronized(obj)` acquires it on entry and releases
on exit. `ReentrantLock` is more flexible — it supports `tryLock`,
timed `tryLock`, interruptible `lockInterruptibly`, and explicit
condition variables. Use `try/finally` with `ReentrantLock` to
guarantee unlock.

### Python with threading.Lock

```python
# counter_race.py
import threading

N = 1_000_000

def worker_unsafe(state):
    for _ in range(N):
        state['counter'] += 1          # race

def worker_safe(state, lock):
    for _ in range(N):
        with lock:                     # context manager handles release
            state['counter'] += 1

def run(label, target, *args):
    state = {'counter': 0}
    t1 = threading.Thread(target=target, args=(state, *args))
    t2 = threading.Thread(target=target, args=(state, *args))
    t1.start(); t2.start()
    t1.join();  t2.join()
    print(f"{label:8s} counter = {state['counter']} (expected {2 * N})")

if __name__ == "__main__":
    run("unsafe", worker_unsafe)
    lock = threading.Lock()
    run("safe",   worker_safe, lock)
```

A note on Python: due to the CPython Global Interpreter Lock (GIL), some
operations look atomic in practice — for example a single bytecode like
`LOAD_FAST` / `STORE_FAST` of a small integer. But `state['counter'] +=
1` is compiled to multiple bytecodes, and the interpreter is free to
switch threads between them. The race is real. The `with lock:` form is
how you make it go away.

### Rust with Mutex<T>

```rust
// counter_race.rs — compile: rustc counter_race.rs
use std::sync::{Arc, Mutex};
use std::thread;

const N: usize = 1_000_000;

fn main() {
    // Rust's type system makes the unsafe version *impossible* to write
    // without `unsafe` blocks and raw pointers. There is no shared
    // mutable variable you can race on without explicit opt-in.

    let counter = Arc::new(Mutex::new(0i64));

    let handles: Vec<_> = (0..2).map(|_| {
        let counter = Arc::clone(&counter);
        thread::spawn(move || {
            for _ in 0..N {
                let mut guard = counter.lock().unwrap();
                *guard += 1;
                // guard dropped here; lock released
            }
        })
    }).collect();

    for h in handles { h.join().unwrap(); }
    println!("safe: counter = {} (expected {})",
             *counter.lock().unwrap(), 2 * N);
}
```

`Mutex<T>` in Rust *wraps the data*. You cannot get at the inner `T`
without calling `.lock()`, which returns a `MutexGuard<T>`. The guard
derefs to `T`, and when it drops the lock is released. The borrow
checker and the type system together guarantee that the protected data
can only be reached while holding the lock. It is the most ergonomic
mutex API of the bunch.

The `.unwrap()` on `lock()` deals with a Rust-specific concept called
**lock poisoning**: if a thread panics while holding the lock, the lock
is marked poisoned and subsequent `lock()` calls return an `Err`. This
is Rust forcing you to acknowledge the possibility that the data is in
an inconsistent state.

---

## Pros & Cons

**Pros**

- **Universally available.** Every operating system and every mainstream
  language has a mutex. Skills transfer.
- **Easy to reason about.** "While I hold this, no one else changes the
  data" is a much simpler mental model than lock-free or
  message-passing protocols.
- **Correct by construction.** If you put all access to the shared data
  inside critical sections protected by the same mutex, you cannot have
  a data race on that data. Period.
- **Cheap when uncontended.** A modern mutex's fast path is a single
  atomic CAS — tens of nanoseconds.

**Cons**

- **Can deadlock.** Two locks acquired in opposite orders by two threads
  is the classic Coffman deadlock.
- **Serializes access.** Whatever you put in the critical section runs
  one thread at a time. That can become the bottleneck of a parallel
  program — the dreaded "lock contention".
- **Easy to forget to unlock.** Especially with raw lock/unlock pairs
  (C, older Java) on functions with multiple return paths.
- **Priority inversion.** A low-priority thread holding a lock can
  effectively block a high-priority thread waiting for the same lock.
  This matters in real-time systems.
- **Not composable.** You cannot easily wrap two locked operations from
  different libraries into a single atomic unit without risking
  deadlock.
- **Hides progress problems.** A thread blocked on a lock looks the same
  as a thread blocked on a slow operation; you need profilers to tell
  them apart.

---

## Use Cases

- **Protecting a shared counter, statistics, or in-memory cache.** The
  bread and butter.
- **Guarding access to a non-thread-safe library.** A C library you call
  from many goroutines, a SQLite handle you share, an object that
  manages its own internal state but was not designed for concurrent
  callers.
- **Protecting a small in-memory data structure** — a map, a tree, a
  linked list — that is read and written by multiple threads.
- **Serializing access to a hardware resource** — a serial port, a
  printer, a GPU queue.
- **Coordinating shutdown.** A `mu`-protected "running" flag that
  workers check on each iteration so they know to exit cleanly.
- **Building higher-level primitives.** Condition variables, channels,
  worker pools, and connection pools are all internally implemented
  with mutexes.

When *not* to use one:

- **Per-CPU or thread-local data.** No sharing, no lock needed.
- **Producer/consumer streams.** A channel or queue is usually a better
  fit.
- **Read-mostly data with rare writes.** Consider RWMutex, or even
  copy-on-write / RCU patterns.
- **A single atomic counter.** An atomic integer is simpler and faster.

---

## Coding Patterns

### The bounded critical section

```text
mu.Lock()
// only the minimum needed for atomicity
copy := shared.snapshot()
mu.Unlock()
// expensive work on copy, no lock held
process(copy)
```

### The struct-with-its-own-mutex

```go
type Counter struct {
    mu sync.Mutex
    n  int64
}

func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}

func (c *Counter) Value() int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
}
```

The mutex lives next to the data it protects. The methods of `Counter`
form the only access path, so the mutex discipline is enforced by the
type, not by convention.

### Lock guard with explicit scope

```cpp
void update() {
    prepare_inputs();           // outside the lock

    {
        std::lock_guard<std::mutex> g(mu);
        modify_shared_state();
    }                           // lock released here

    log_after_modification();   // outside the lock
}
```

### Try-lock for opportunistic work

```go
if !mu.TryLock() {
    return // someone else is doing it; skip this round
}
defer mu.Unlock()
doMaintenance()
```

Useful for background tasks that should not pile up behind contention.

### Copy-out, work-on-copy

```python
with lock:
    snapshot = list(shared_items)  # cheap copy under the lock
# expensive processing happens lock-free on the snapshot
for item in snapshot:
    process(item)
```

### One mutex per resource, not per program

A common antipattern is one global mutex that protects everything.
Better: one mutex per data structure. Threads working on unrelated data
do not block each other.

---

## Clean Code

- **Name the mutex after what it protects.** `metricsMu` is better than
  `mu1`. Even better: keep it inside a struct so the protection is
  obvious from the field's location.
- **Put the mutex near the data it guards.** In a struct, the convention
  in Go and Rust is to put the mutex as a field right above the data it
  protects, often with a comment: `// protects: counters, lastFlush`.
- **Make the critical section visible.** A reader of `lock()` should
  be able to find the matching `unlock()` within a few lines. If the
  critical section is hundreds of lines long, your function is too big.
- **Do not lock and forget.** When you take a lock, your very next
  instruction should be `defer Unlock` / `lock_guard` / `try { }
  finally { unlock() }` / `with lock:`. Make the unlock impossible to
  miss.
- **Document the locking discipline.** If a function expects the caller
  to hold a lock, say so in the doc comment: `// requires: mu held`.
  If it acquires the lock itself, say so: `// acquires mu`.
- **One mutex per concept.** Do not reuse a mutex to protect unrelated
  data; you create false contention.

---

## Best Practices

1. **Use a lock guard or `defer Unlock` for every lock.** Raw `lock()`/
   `unlock()` in a function with multiple return paths is a bug waiting
   to happen.
2. **Keep critical sections short.** Compute everything you can outside
   the lock; do the minimum inside.
3. **Never call into unknown code while holding a lock.** No user
   callbacks, no library calls whose locking behavior you don't know.
4. **Always acquire multiple locks in the same order across the
   program.** The classic deadlock fix.
5. **Never hold a lock during blocking I/O.** Disk, network, sleep —
   always release first.
6. **Prefer non-reentrant locks.** If you think you need a reentrant
   one, your design probably has a layering problem.
7. **Use the race detector.** `go run -race`, ThreadSanitizer for C/C++,
   `RUST_TEST_THREADS=1` plus Rust's `loom` crate, Java's
   `ThreadSanitizer`-style tools, Python's `threading` warnings.
8. **Test under load.** A race that does not show up in one
   single-threaded run will reliably show up under stress.
9. **Profile contention.** If a mutex shows up high in your CPU profile,
   consider whether you can shrink the critical section or shard the
   data.
10. **One mutex per data structure** — not one global mutex per
    program, not one mutex per field.

---

## Edge Cases & Pitfalls

- **Locking during initialization.** If two threads race to initialize
  a shared singleton, you can end up with two singletons. Use a
  thread-safe initialization primitive (`std::call_once`, `sync.Once`,
  static local in C++, double-checked locking with `volatile` /
  `Atomic` references in Java) instead of a raw mutex.
- **Sleeping while holding the lock.** Hilariously common when someone
  adds a `time.Sleep` for "debouncing" without realizing they are
  blocking every other thread for the same duration.
- **Releasing in a different scope from acquiring.** If you `lock()` in
  one function and `unlock()` in another, you have lost local
  reasoning. Refactor.
- **Returning a pointer to data protected by the lock.** Once the
  pointer escapes the critical section, anybody can write to the data
  without holding the lock. Return copies or accessor functions
  instead.
- **Recursive callbacks.** If your critical section calls a function
  that, transitively, takes the same lock — deadlock on non-reentrant,
  invariant violations on reentrant.
- **Forgetting that `try_lock` can spuriously fail under some
  implementations.** Treat `false` from `try_lock` as "not now", not
  as "the lock is definitely held by someone else".
- **Lock granularity.** Too coarse → contention. Too fine → deadlock
  risk plus overhead. The middle is an engineering judgement, not a
  formula.
- **Mutex copy.** Many implementations make mutexes non-copyable for a
  reason: a copy has a different identity from the original, and
  locking the copy does not stop someone from running the critical
  section on the original. In Go, `go vet` will warn you. In Rust and
  C++, the type system forbids it.

---

## Common Mistakes

1. **`lock()` without `unlock()` on an early return.** The reason RAII
   guards exist.
2. **`unlock()` twice.** Undefined or panicking, depending on the
   implementation.
3. **`unlock()` from a thread that did not lock.** Most implementations
   do not check at runtime; correctness silently breaks.
4. **Holding the lock during a blocking operation.** Pathological
   performance.
5. **Acquiring two locks in opposite orders.** Classic deadlock.
6. **Returning a pointer to protected data.** The caller now races.
7. **Using a global mutex for everything.** Serializes the whole
   program.
8. **Forgetting that read access also needs the lock.** Two threads
   doing `read` and `write` with no sync is still a race.
9. **Using a mutex as a flag.** "I'll set this bool while holding the
   lock to mean ready." Use a condition variable instead.
10. **Copying a struct that contains a mutex.** The copy has a separate
    mutex; nothing is synchronized between them.

---

## Tricky Points

- **A mutex provides mutual exclusion, but it also provides memory
  visibility.** When you `unlock`, all your previous writes become
  visible to the next thread that `lock`s the same mutex. This is
  called a happens-before edge. It is the reason a mutex is sufficient
  on its own — you do not need a separate "memory barrier" call.
- **Acquiring an uncontended mutex still has a cost.** A few
  nanoseconds for the atomic operation, plus cache line traffic. In
  tight loops where you acquire-release a million times, this dominates.
- **The fast path and the slow path have wildly different costs.** An
  uncontended lock-unlock takes around 20 nanoseconds; a contended one
  that goes through the kernel can take a few microseconds. Lock
  contention shows up as wall-clock latency, not CPU time.
- **A reentrant lock acquired N times must be released N times.** The
  classic mistake is to lock in a loop and unlock once.
- **Some implementations are not FIFO-fair.** A thread that just
  released the lock may immediately reacquire it before a long-waiting
  thread is scheduled. This improves throughput but starves waiters.
- **`try_lock` is not the same as `lock` followed by a quick check.** A
  successful `try_lock` *takes* the lock; you must `unlock` it just
  like a successful `lock`.

---

## Test Yourself

1. What three machine-level operations make `counter++` non-atomic, and
   why does a mutex fix it?
2. What is the difference between a critical section and a mutex?
3. If you `lock()` and never `unlock()`, what happens to the next
   caller? What if there is no next caller — does anything bad happen?
4. Why is `std::lock_guard` better than raw `lock()`/`unlock()` calls?
5. Why does Go use `defer mu.Unlock()` immediately after `mu.Lock()`?
6. What does a *reentrant* mutex allow that a normal mutex does not?
7. Why does `sync.Mutex.Unlock` of an already-unlocked mutex panic in
   Go but is undefined behavior in C++?
8. Why should you not hold a mutex during a network call?
9. What is the cost difference between an uncontended and a contended
   mutex acquisition?
10. Why does Rust make it the type system's job to enforce locking?

---

## Tricky Questions

1. *Why is a mutex not just `while (locked) {}`?* — Because spinning
   wastes a whole CPU core and does not let the OS schedule the
   lock-holder. Real mutexes park waiters in the kernel.
2. *Two threads call `lock()` at exactly the same instant. Who wins?* —
   Whichever atomic CAS wins at the cache-coherency level. There is
   no global ordering; the hardware picks.
3. *What does it mean for a mutex to be "fair"?* — Waiters are served
   in FIFO order, even if it means a freshly arriving thread has to
   wait. Most production mutexes are *not* strictly fair; they barge
   for throughput.
4. *Can a mutex protect data on disk?* — Only within a single process.
   Cross-process synchronization needs a file lock, an OS named mutex,
   or a database transaction.
5. *Does a mutex prevent reordering?* — Yes. `lock` is an acquire
   barrier, `unlock` is a release barrier. Compiler and CPU
   reorderings cannot move loads or stores out of the critical section.
6. *What happens if the lock-holder is killed?* — On most
   implementations, the lock is leaked. Some OSes provide "robust
   mutexes" that mark themselves dead so the next acquirer can
   recover.
7. *Why does Rust care about "poisoning"?* — Because a panic mid-update
   may leave the data in an invariant-violating state, and the next
   thread to enter has no way to know. Poisoning forces the caller to
   explicitly opt in to using possibly-broken data.
8. *Why doesn't Go provide a recursive mutex?* — Rob Pike's stated
   position: needing one is almost always a design smell. The language
   nudges you toward refactoring.

---

## Cheat Sheet

```
ACQUIRE → critical section → RELEASE
Pair every lock with its unlock. Use RAII / defer / with / try-finally.

  C:    pthread_mutex_lock(&mu);     ... pthread_mutex_unlock(&mu);
  C++:  std::lock_guard<std::mutex> g(mu);   // RAII, auto-unlock
  Go:   mu.Lock(); defer mu.Unlock()
  Java: synchronized (obj) { ... }
        lock.lock(); try { ... } finally { lock.unlock(); }
  Py:   with lock: ...
  Rust: let g = mu.lock().unwrap();   // scope-bound

Rules:
  1. Same thread unlocks that locked.
  2. Never double-unlock.
  3. Critical section as small as possible.
  4. No I/O or blocking calls while holding a lock.
  5. Acquire multiple locks in a consistent global order.
  6. Prefer non-reentrant mutexes.

Smells:
  - lock(); ...; return; ...; unlock();           // skipped unlock
  - lock(); networkCall(); unlock();              // I/O under lock
  - lockA(); lockB(); ... vs lockB(); lockA();    // deadlock
  - global lock guarding everything               // contention
  - returning pointers into protected data        // escape
```

---

## Summary

A mutex is a single-occupant token. Exactly one thread at a time can
hold it. While you hold it, you have exclusive access to whatever data
it protects. The two operations are `lock` (acquire) and `unlock`
(release), and the contract is sacred: every successful lock must be
matched by exactly one unlock on the same thread.

The mutex is also a memory barrier: writes made before `unlock` become
visible to the next thread that `lock`s the same mutex. That property
is the reason a mutex alone is sufficient for safe shared mutable
state, without separate fence calls.

The practical discipline is twofold. First, structure your code so that
unlock is impossible to forget: use `std::lock_guard` in C++,
`defer mu.Unlock()` in Go, `try { ... } finally { unlock() }` in Java,
`with lock:` in Python, scope-bound `MutexGuard` in Rust. Second, hold
the lock as briefly as possible: copy out, release, work on the copy.

Mutexes are universal, well understood, and easy to use *correctly* —
if you follow the discipline. They are also the easiest concurrency
primitive to misuse: forgetting an unlock, holding too long, acquiring
in wrong order, returning escaping pointers. The middle and senior
pages will dig into deadlock avoidance, performance tuning, reader-writer
variants, and the internals of how a futex-based mutex actually works.

For now, the rule is: when in doubt, lock it. When the profiler tells
you that lock is the bottleneck, *then* go look at finer-grained
locking, atomics, lock-free data structures, or message passing.

---

## What You Can Build

- A thread-safe in-memory cache (`Get`, `Put`, `Delete`) with a single
  mutex guarding a hash map.
- A bounded worker pool: a mutex-protected job queue plus N worker
  threads.
- A statistics counter: many threads incrementing, one thread
  periodically reading and resetting.
- A connection pool: a mutex around a free-list, plus a condition
  variable to wait when the pool is empty.
- A thread-safe LRU cache: mutex around the map + linked list.
- A small key-value store backing a TCP server, with one mutex per
  shard for concurrent throughput.
- A logging library with a mutex around the output stream to keep log
  lines uncorrupted.

---

## Further Reading

- POSIX Threads Programming (Blaise Barney, LLNL) — classic pthreads
  tutorial covering `pthread_mutex_*` from first principles.
- *C++ Concurrency in Action*, Anthony Williams — chapter 3 is the
  definitive reference on `std::mutex`, `std::lock_guard`, and the
  more advanced `std::unique_lock` and `std::scoped_lock`.
- The Go Memory Model — short, official, and worth reading once a year.
  Pay attention to the "happens-before" guarantees of `sync.Mutex`.
- *Java Concurrency in Practice*, Brian Goetz — chapters 2–4 on the
  Java memory model, `synchronized`, and `ReentrantLock`.
- The Linux kernel's `futex(2)` man page — short, technical, eye-opening
  if you want to know what your mutex actually does.
- *The Art of Multiprocessor Programming*, Herlihy & Shavit — the
  textbook on synchronization. Chapter 7 on locks goes deep.
- Rust documentation for `std::sync::Mutex` — explains poisoning and
  the type-system-enforced API.

---

## Related Topics

- [Mutex — Middle Level](middle.md)
- [Mutex — Senior Level](senior.md)
- [Mutex — Professional Level](professional.md)
- [Mutex — Interview Questions](interview.md)
- [Mutex — Practice Tasks](tasks.md)
- [Semaphore — Junior Level](../02-semaphore/junior.md)
- [Condition Variables — Junior Level](../03-condition-variables/junior.md)
- [Atomic Operations — Junior Level](../04-atomic/junior.md)
- [Shared Memory Model — Junior Level](../../01-models/01-shared-memory/junior.md)

---

## Diagrams & Visual Aids

### Two threads racing on `counter++`

```
Initial: counter = 42

Thread A                      Thread B
--------                      --------
load  counter -> 42
                              load  counter -> 42
add 1         -> 43
                              add 1         -> 43
store counter <- 43
                              store counter <- 43

Final: counter = 43           (one increment lost)
```

### Same scenario with a mutex

```
Initial: counter = 42

Thread A                      Thread B
--------                      --------
lock(mu) -> OK
                              lock(mu) -> BLOCKED, parked by OS
load 42
add 1 -> 43
store 43
unlock(mu) ----> wakes B
                              lock(mu) -> OK
                              load 43
                              add 1 -> 44
                              store 44
                              unlock(mu)

Final: counter = 44           (both increments preserved)
```

### Mutex state machine

```
                lock() succeeds
       +-------------------------+
       |                         v
   [ FREE ]                  [ HELD by T1 ]
       ^                         |
       |   unlock() by T1        |
       +-------------------------+

   lock() by T2 while HELD -> T2 parked in waiters queue
   unlock() while FREE     -> UB or panic
   unlock() by T2 not T1   -> UB or panic
```

### Critical section anatomy

```
+-----------------------------------------------------+
|  // outside the lock — concurrent with other threads |
|  prepare_inputs();                                   |
|                                                      |
|  mu.lock();          <-- enter critical section      |
|  +-----------------------------------------------+   |
|  | // INSIDE the lock — exclusive on this mutex  |   |
|  | read_shared();                                |   |
|  | mutate_shared();                              |   |
|  +-----------------------------------------------+   |
|  mu.unlock();        <-- exit critical section       |
|                                                      |
|  // outside the lock — concurrent again              |
|  publish_outputs();                                  |
+-----------------------------------------------------+
```

### RAII guard scope

```
{
    std::lock_guard<std::mutex> g(mu);   // ctor: lock acquired
    //                                         |
    //  ...critical section...                 |  guard alive => lock held
    //                                         |
    if (early_return) return;            //    |  guard destructs here -> unlock
    do_more();                           //    |
}                                        // <- guard destructs here -> unlock
```

### Fast path vs slow path

```
                 +---- lock() ----+
                 |                |
        Is the bit 0 ?            |
        /                \        |
    YES (uncontended)     NO (contended)
        |                          |
   atomic CAS 0->1             ask kernel to park me
   return  (~20 ns)            ...much later, awakened
                                attempt CAS again
                                return  (microseconds)
```

### Locking order to avoid deadlock

```
  GOOD                              BAD
  ----                              ---

  Thread A:   lock(L1); lock(L2);   Thread A:  lock(L1); lock(L2);
  Thread B:   lock(L1); lock(L2);   Thread B:  lock(L2); lock(L1);
                                              ^
              same order, no cycle            different order -> can deadlock
```
