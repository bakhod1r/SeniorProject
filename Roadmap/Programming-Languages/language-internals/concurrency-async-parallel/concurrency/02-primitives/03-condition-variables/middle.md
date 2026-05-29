# Condition Variables — Middle Level

> **Topic:** [Condition Variables](README.md)
> **Focus:** Mesa semantics, signal-all storms, futex-backed implementations

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

At the junior level a condition variable looked like a polite waiting room: threads slept on `wait`, somebody called `signal` or `broadcast`, and life moved on. That picture is enough to write a correct producer-consumer queue, but it leaves three uncomfortable holes:

1. Why does every textbook insist on `while (!predicate) cond.wait(lock)` instead of `if`?
2. When you call `signal`, why might *more than one* thread wake up? When you call `broadcast`, why is that sometimes a performance disaster?
3. Why do `wait` calls sometimes return even though nobody signalled?

The middle level fills those holes. We will study **Mesa semantics**, the model used by every mainstream language (POSIX pthreads, Java, C#, Python, Go, Rust). We will look at how `wait` is actually implemented on Linux — a thin layer over the `futex` syscall — and use that mental model to explain spurious wakeups, the lost-wakeup bug, and the thundering-herd problem caused by over-eager broadcasts. Finally we will build three classic higher-level primitives — a barrier, a semaphore, and a readers-writer lock — using only `Mutex` and `Cond`, so you can see the primitive's full expressive power.

By the end of this document you should be able to:

- Explain *why* Mesa semantics force the `while` loop and what would change under Hoare semantics.
- Choose `signal` vs `broadcast` correctly and quantify the cost of getting it wrong.
- Diagnose a lost-wakeup bug by inspecting the order of `lock`, `signal`, and `wait`.
- Read a futex-based `pthread_cond_wait` implementation and predict when spurious wakeups occur.
- Build a barrier, a counting semaphore, and a fair RWMutex on top of mutex + condvar.
- Recognise when condition variables are the wrong tool — and when channels, semaphores, or `eventfd` are better.

---

## Prerequisites

You should already be comfortable with:

- **Mutex basics** — lock, unlock, ownership, critical sections.
- **The producer-consumer pattern** with a single condition variable (covered in the [junior](junior.md) document).
- One concrete API surface — `std::condition_variable`, `pthread_cond_t`, `java.util.concurrent.locks.Condition`, `threading.Condition`, or `sync.Cond`.
- The notion of a **predicate** — a boolean expression over shared state that tells the consumer "you may proceed now".

If any of those feel shaky, re-read the junior document and come back. The middle level moves fast and assumes the foundation is solid.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Mesa semantics** | The signalled thread is moved to the *ready* queue but does not run immediately; it must re-acquire the mutex and re-check the predicate. Named after the Mesa language at Xerox PARC (1977). |
| **Hoare semantics** | The signalled thread runs *immediately* with the mutex implicitly transferred; the signaller is suspended. Elegant in theory, almost nobody implements it. |
| **Predicate** | A boolean expression over shared state — for example `queue.size() > 0` — that must be true before the waiter proceeds. |
| **Signal (`notify_one`)** | Wake exactly one waiter (the OS picks which). If no one is waiting, the signal is lost. |
| **Broadcast (`notify_all`)** | Wake every waiter. Useful when more than one waiter's predicate may now be satisfiable. |
| **Spurious wakeup** | `wait` returns without any signal or broadcast having been issued. POSIX explicitly permits this; the futex spec makes it concrete. |
| **Lost wakeup** | A signal issued *before* the corresponding wait, when there is no waiter to receive it. The signal vanishes — the next waiter sleeps forever. |
| **Thundering herd** | A broadcast wakes N waiters; they all race to grab the mutex; N-1 immediately go back to sleep. O(N) wasted context switches. |
| **Futex** | "Fast userspace mutex" — Linux syscall (`futex(2)`) that puts a thread to sleep on a memory address until another thread issues a wake on the same address. The kernel-level building block under condvars. |
| **Wait morphing / requeue** | Implementation trick where a `broadcast` does not actually wake N threads — it moves N-1 of them from the cond-wait queue to the mutex-wait queue, so they wake one at a time as the mutex is released. |
| **Generation counter / sequence number** | Integer incremented on every signal; waiters record the current value before sleeping and the kernel checks it on wake. Prevents lost wakeups across `signal`/`wait` races. |

---

## Core Concepts

### 1. Mesa Semantics in Depth — Why You Must Re-Check

When a thread T calls `cond.signal()`, what does the runtime promise?

Under **Mesa semantics** (everyone's choice): "Some waiter on this cond will eventually be moved to the ready queue. When it wakes up, the mutex will be re-acquired before `wait` returns. No claim is made about *when* it runs relative to any other thread."

Under **Hoare semantics** (mostly academic): "The signalled waiter runs *immediately*, the signaller is suspended, and the mutex is handed off atomically. When the waiter releases the mutex, the signaller resumes."

The difference matters because of a tiny gap in time:

```
T1 (signaller)              T2 (waiter)                T3 (another thread)
------------------          ------------------         ---------------------
lock(m)
state = ready
cond.signal()
unlock(m)
                                                       lock(m)
                                                       state = consumed
                                                       unlock(m)
                            (woken, acquires m)
                            // predicate now FALSE
```

Between T1 unlocking and T2 actually running, a third thread T3 acquired the mutex and consumed the resource. T2's predicate is no longer true. Under Hoare semantics this could not happen — T2 would have run with the mutex in hand. Under Mesa it can, so T2 *must* re-check:

```c
while (!predicate)
    cond_wait(&c, &m);
```

The `while` loop is not paranoia; it is correctness. Replacing it with `if` will, under load, eventually wake a thread to find the predicate false and let it proceed anyway — a classic bug that takes weeks to reproduce in tests but minutes in production.

Mesa semantics has one giant upside: implementation simplicity. The runtime never has to perform an atomic context switch or transfer mutex ownership across threads. It just moves a thread node from one waitqueue to another.

### 2. Signal vs Broadcast — When Each Is Right

The rule of thumb:

- **`signal` (notify_one)**: when *any one* waiter's predicate becoming true is enough, and waiters are interchangeable. Example: producer in a single-condition bounded queue — any consumer can drain one item.
- **`broadcast` (notify_all)**: when the state change may satisfy *different waiters' different predicates*, or when more than one waiter can proceed simultaneously.

Concrete cases for `broadcast`:

1. **Multiple condition variables not in use, but predicate is heterogeneous.** Example: a resource pool where waiters request `n` items each; freeing 5 items may satisfy two waiters who wanted 2 each but not a waiter who wanted 6.
2. **Shutdown.** Set `closed = true` and broadcast — every waiter must observe the new state and exit.
3. **Promotion barriers.** When a writer in an RWMutex finishes, all blocked readers can proceed simultaneously.

A failure mode to remember: **`signal` is silently incorrect when waiters have non-uniform predicates**, because the OS may pick a waiter whose predicate is still false; they go back to sleep, and the other waiter — whose predicate *was* satisfied — never gets woken. Symptom: deadlock under specific timing.

Rule: **use `broadcast` if in doubt; use `signal` only when you can prove all waiters share the identical predicate.**

### 3. The Thundering-Herd Anti-Pattern

The opposite mistake is reflexively broadcasting. Imagine a queue with 100 consumers blocked on "queue not empty". A producer pushes one item and calls `broadcast`. The kernel wakes 100 threads. They all try to lock the mutex. One wins, checks the predicate (true), pops the item, releases the mutex. The other 99 each acquire the mutex in turn, find the queue empty, re-call `wait`, and go back to sleep.

You just paid for ~100 context switches and 100 mutex round-trips to deliver one item.

Solutions:

- **Use `signal` when it is provably safe**, as in the bounded-queue case.
- **Use multiple condition variables** so the broadcast wakes only the relevant subset.
- Modern implementations (glibc, musl) use **wait morphing**: a broadcast moves N-1 waiters from the cond-wait queue directly to the mutex-wait queue, so only one thread is actually scheduled at a time. This blunts the herd but does not eliminate it.

### 4. Timed Wait

`wait_for(lock, duration, predicate)` (C++), `wait(timeout_ms)` (Java), `wait(timeout=...)` (Python), `WaitWithContext` (Go) all return early if no signal arrives within the timeout. Two return paths:

- **Predicate true** — proceed normally.
- **Timeout fired** — the predicate is still false; handle the failure (retry, abort, log).

The standard idiom in C++:

```cpp
if (!cv.wait_for(lock, 100ms, [&]{ return !queue.empty(); })) {
    // timeout — predicate still false
    return std::nullopt;
}
// got an item
```

Timed wait is what you reach for when:

- You need cancellable waits (combine with a cancel flag in the predicate).
- You want to enforce SLAs ("a worker waits at most 50ms for a job before parking itself").
- You are debugging a suspected deadlock and want the program to abort instead of hang.

Beware: a deadline-based API (`wait_until`) is safer than a duration-based API (`wait_for`) when you wake up, re-check the predicate, and may need to wait again — `wait_for` would restart the full timeout.

### 5. Multiple Condition Variables on the Same Mutex

A single mutex can host several condition variables, each tracking a different predicate. The canonical example is a bounded buffer with one cond for "not full" and one for "not empty":

| Action | Waits on | Signals |
|--------|----------|---------|
| `enqueue` (when full) | `not_full` | `not_empty` after push |
| `dequeue` (when empty) | `not_empty` | `not_full` after pop |

This is strictly more efficient than one condition variable and `broadcast`, because each `signal` wakes exactly the kind of waiter that can make progress. We will write this in [Code Examples](#code-examples).

### 6. The Lost-Wakeup Bug — Signal Before Wait

This is the most expensive bug in the condition-variable family. Pattern:

```
Producer                       Consumer
--------                       --------
                               lock(m)
                               if (!ready)        // not in a loop, and not holding m on signal
                                   cond.wait(m)
state = ready                  // signal lost
cond.signal()                  
                               unlock(m)          // sleeps forever
```

Two distinct correctness rules collapse here:

1. **Always test the predicate while holding the mutex, before calling `wait`.**
2. **Always hold the mutex when modifying the state the predicate observes, including when you call `signal`/`broadcast`.** (Some APIs technically allow signalling without the lock; doing so introduces races.)

If you obey both, a lost wakeup is impossible: the producer cannot publish `ready = true` until the consumer has either fully entered `wait` (joined the waitqueue) or seen `ready` as true and skipped the wait entirely.

Note: the rule "hold the mutex while signalling" is *not* about correctness of the signal mechanism itself — it is about correctness of your *predicate*. The signal can be issued without the mutex held, but you must guarantee no race in the state read by the predicate. In practice the simplest discipline is: lock, mutate state, signal, unlock.

### 7. Spurious Wakeups — POSIX and the Futex

`pthread_cond_wait` may return *without* any thread calling `pthread_cond_signal` or `pthread_cond_broadcast`. POSIX explicitly allows this. Why? Two real reasons:

- **Signal handling**: a UNIX signal (`SIGUSR1`, etc.) interrupting the syscall.
- **Futex implementation**: the kernel may wake a thread when an unrelated condition flips the futex word, especially across `pthread_cond_broadcast` requeues. The cheapest, race-free implementation has spurious wakeups as a side effect.

On Linux, `pthread_cond_t` is built on `futex(FUTEX_WAIT)` keyed to an internal sequence number. The kernel wakes everyone waiting on that futex when the seq changes. If a single thread is "borrowed" by a broadcast requeue or interrupted by a signal, it returns from `futex` without proof that the cond was actually signalled.

Practical impact: **always use `while (!predicate) wait(...)`**. The same `while` loop that defends against Mesa staleness also defends against spurious wakeups, so a single discipline covers both.

### 8. Building Higher-Level Primitives on Mutex + Cond

The expressive power of mutex + condvar lets us build most other synchronisation primitives. Three classics:

**Counting semaphore.** `permits` is an integer. `acquire` waits while `permits == 0`, decrements. `release` increments and signals.

**Barrier.** N threads must rendezvous. Each calls `arrive_and_wait`; the last increments a counter to N and broadcasts; everyone proceeds together. The classic "phase" trick (a generation counter) prevents a fast thread from racing through a second barrier before slow threads exit the first.

**Readers-writer lock.** Track `active_readers` and `active_writer`. Readers wait while a writer is active. Writers wait while any reader or writer is active. Two condvars (`readers_cv`, `writers_cv`) avoid a thundering herd on release.

Working code is in [Code Examples](#code-examples). Building these by hand once is the best way to internalise the primitive.

### 9. Java: `Object.wait/notify` vs `ReentrantLock.newCondition`

Java offers two distinct condvar APIs:

| Aspect | `Object.wait/notify` | `ReentrantLock.newCondition` |
|--------|----------------------|------------------------------|
| Mutex | The object's intrinsic lock | Explicit `Lock` instance |
| Multiple conds per mutex | No (one per object) | Yes — call `newCondition()` multiple times |
| Interruptibility | Throws `InterruptedException` | Throws `InterruptedException` (or `awaitUninterruptibly`) |
| Fairness | None | Configurable on the `ReentrantLock` |
| Deadline | `wait(millis)` | `awaitUntil(Date)`, `awaitNanos(long)` |

For new code, prefer `ReentrantLock` + `Condition`. The intrinsic lock API is older and harder to use correctly with multiple predicates.

### 10. Python's `threading.Condition`

Python's standard library models the API well. `threading.Condition(lock=None)` creates a cond either with a fresh `RLock` or wrapping an existing lock. Multiple `Condition` objects can share the same lock:

```python
mutex = threading.Lock()
not_empty = threading.Condition(mutex)
not_full  = threading.Condition(mutex)
```

`wait_for(predicate, timeout=None)` is a convenience wrapper around the standard `while` loop. CPython has the GIL, so the typical condvar use case is coordinating threads that block on I/O, not CPU-bound work — but the discipline (always re-check the predicate) is identical.

### 11. Go: `sync.Cond` — Rarely Needed

`sync.Cond` exists, and the API mirrors POSIX: `Wait`, `Signal`, `Broadcast`. But idiomatic Go almost always uses channels instead. Three reasons:

- A channel *is* both signal and predicate. A receiver wakes when the channel has a value; no separate state to re-check.
- `select` lets you wait on multiple channels with a timeout and a cancellation channel — no condvar can match that.
- `sync.Cond` cannot be used with `context.Context` cancellation cleanly; channels can.

The few legitimate uses of `sync.Cond`:

- You have very large numbers of waiters (thousands) and channel allocation overhead matters.
- You need a "broadcast to all current waiters" semantic that is awkward with channels.

The Go authors have publicly said `sync.Cond` is the most-misused primitive in the standard library. If you reach for it, double-check that channels really do not fit.

---

## Real-World Analogies

**Mesa vs Hoare — restaurant table.** Mesa: the host (signaller) tells the bartender to call the next party (waiter) but goes back to seating others; when the next party walks over, the table may already have been taken by a walk-in. Hoare: the host personally walks the party to the table and waits there until they're seated, then resumes other work. Hoare is more polite but blocks the host; Mesa is efficient but the party must check the table is still free.

**Multiple condvars on one mutex — DMV windows.** One mutex protects the whole DMV. Different counters serve different transactions (`renewals_ready`, `registrations_ready`). The clerk signals only the relevant condvar; you don't have to wake everyone in the building.

**Thundering herd — fire alarm.** Pulling the alarm (`broadcast`) makes every employee leave the building even if there's one small fire in the kitchen. Most of them walk straight back inside. Sending a Slack message to the kitchen team (`signal` to the right group) is the efficient version.

**Lost wakeup — calling a friend who isn't home.** If you ring the doorbell *before* they arrive, the ring is lost. They show up later, sit on the porch waiting for the bell that already happened, and starve. Solution: check whether they're home before ringing, while standing inside their porch (holding the mutex).

**Spurious wakeup — false fire alarm.** The smoke detector goes off because of burnt toast. You check — no fire — and go back to bed. The discipline of *always checking* covers both real fires and toast.

---

## Mental Models

### Model 1: Condvar as a Three-State Machine for Each Thread

A thread interacting with a condvar passes through three states:

1. **Running with mutex** — about to call `wait`.
2. **Sleeping in the cond's waitqueue, mutex released** — invisible to other threads except via the kernel waitqueue.
3. **Running with mutex re-acquired** — woken, but must re-check the predicate.

The transition `1 → 2 → 3` is the critical sequence. The atomicity of "release mutex AND enqueue in waitqueue" inside `wait` is what makes the primitive sound.

### Model 2: Predicate as the Single Source of Truth

The condvar is just a *notification mechanism*. The predicate is the *truth*. If the predicate is true after `wait` returns, you may proceed; otherwise loop. The condvar itself carries zero state — it does not remember whether it was signalled. Treat it as a wake-up service, not a queue of messages.

### Model 3: Futex Sequence Number

Modern implementations attach a sequence number to each cond. The protocol:

1. Waiter reads `seq = cond.seq` while holding the mutex.
2. Waiter releases mutex and calls `futex(FUTEX_WAIT, &cond.seq, seq, ...)` — sleep only if `cond.seq == seq`.
3. Signaller increments `cond.seq` and calls `futex(FUTEX_WAKE, &cond.seq, 1)`.

If the signaller increments before the waiter calls `FUTEX_WAIT`, the syscall returns `EAGAIN` immediately (because the observed value no longer matches). The waiter loops back, checks the predicate, may proceed without ever sleeping. This is how the lost-wakeup race is closed at the kernel level.

---

## Code Examples

> All examples are deliberately runnable on stock toolchains: C++17, Java 17, Python 3.10+, Go 1.20+. Compile commands are noted inline.

### Example 1: Bounded Buffer with Two Condition Variables (Canonical, C++)

```cpp
// bounded_buffer.cpp — compile with: g++ -std=c++17 -O2 -pthread bounded_buffer.cpp -o bb
#include <condition_variable>
#include <mutex>
#include <optional>
#include <queue>
#include <thread>
#include <iostream>
#include <chrono>

template <typename T>
class BoundedBuffer {
public:
    explicit BoundedBuffer(size_t capacity) : capacity_(capacity) {}

    void push(T value) {
        std::unique_lock<std::mutex> lk(m_);
        not_full_.wait(lk, [&] { return q_.size() < capacity_ || closed_; });
        if (closed_) throw std::runtime_error("buffer closed");
        q_.push(std::move(value));
        // signal one consumer — any one will do, predicates are uniform
        not_empty_.notify_one();
    }

    std::optional<T> pop() {
        std::unique_lock<std::mutex> lk(m_);
        not_empty_.wait(lk, [&] { return !q_.empty() || closed_; });
        if (q_.empty()) return std::nullopt; // closed and drained
        T value = std::move(q_.front());
        q_.pop();
        not_full_.notify_one();
        return value;
    }

    void close() {
        std::lock_guard<std::mutex> lk(m_);
        closed_ = true;
        // broadcast — every blocked producer AND consumer must observe shutdown
        not_full_.notify_all();
        not_empty_.notify_all();
    }

private:
    mutable std::mutex m_;
    std::condition_variable not_full_, not_empty_;
    std::queue<T> q_;
    size_t capacity_;
    bool closed_ = false;
};

int main() {
    BoundedBuffer<int> bb(4);
    std::thread producer([&] {
        for (int i = 0; i < 10; ++i) {
            bb.push(i);
            std::cout << "pushed " << i << "\n";
        }
        bb.close();
    });
    std::thread consumer([&] {
        while (auto v = bb.pop()) {
            std::cout << "popped " << *v << "\n";
        }
    });
    producer.join();
    consumer.join();
}
```

Key middle-level points:

- **Two condvars** — push signals `not_empty_`, pop signals `not_full_`. No thundering herd, no waking the wrong side.
- **`signal` (notify_one)** suffices because every waiter on a given cond has the same predicate.
- **Shutdown uses `broadcast`** because every waiter, regardless of side, must observe `closed_`.
- The lambda predicate passed to `wait` is the standard library's sugar for `while (!pred) wait(lk)`.

### Example 2: Building a Counting Semaphore (Python)

```python
# semaphore.py — run with: python3 semaphore.py
import threading
import time

class Semaphore:
    def __init__(self, permits: int):
        self._permits = permits
        self._mutex = threading.Lock()
        self._cv = threading.Condition(self._mutex)

    def acquire(self, n: int = 1, timeout: float | None = None) -> bool:
        deadline = None if timeout is None else time.monotonic() + timeout
        with self._cv:
            while self._permits < n:
                remaining = None if deadline is None else deadline - time.monotonic()
                if remaining is not None and remaining <= 0:
                    return False
                self._cv.wait(timeout=remaining)
            self._permits -= n
            return True

    def release(self, n: int = 1):
        with self._cv:
            self._permits += n
            # broadcast — waiters may want different n, not all can proceed
            self._cv.notify_all()


sem = Semaphore(3)

def worker(i):
    if sem.acquire(timeout=2.0):
        print(f"worker {i} got permit")
        time.sleep(0.3)
        sem.release()
        print(f"worker {i} released")
    else:
        print(f"worker {i} timed out")

threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
for t in threads: t.start()
for t in threads: t.join()
```

Why `notify_all` and not `notify_one`? Because waiters may request different `n` values. If we released 5 permits and notified one waiter who wanted 6, they'd go back to sleep — and a waiter who wanted 2 never gets a chance. With `notify_all` every waiter re-checks; only those whose predicate is satisfied proceed.

### Example 3: Reusable Barrier in C++

```cpp
// barrier.cpp — g++ -std=c++17 -O2 -pthread barrier.cpp -o barrier
#include <condition_variable>
#include <mutex>
#include <iostream>
#include <thread>
#include <vector>

class Barrier {
public:
    explicit Barrier(int n) : n_(n), waiting_(0), generation_(0) {}

    void arrive_and_wait() {
        std::unique_lock<std::mutex> lk(m_);
        int gen = generation_;
        if (++waiting_ == n_) {
            // last arrival — flip generation, reset counter, release everyone
            ++generation_;
            waiting_ = 0;
            cv_.notify_all();
        } else {
            cv_.wait(lk, [&] { return gen != generation_; });
        }
    }

private:
    std::mutex m_;
    std::condition_variable cv_;
    int n_;
    int waiting_;
    int generation_; // prevents the next phase racing past the current one
};

int main() {
    Barrier b(4);
    std::vector<std::thread> ts;
    for (int i = 0; i < 4; ++i) {
        ts.emplace_back([&b, i] {
            for (int phase = 0; phase < 3; ++phase) {
                std::cout << "thread " << i << " before phase " << phase << "\n";
                b.arrive_and_wait();
                std::cout << "thread " << i << " after  phase " << phase << "\n";
            }
        });
    }
    for (auto& t : ts) t.join();
}
```

The `generation_` counter is the subtle middle-level trick: without it, a fast thread could run all the way back to the barrier and increment `waiting_` to 1 before slow threads have left the previous phase. The predicate `gen != generation_` says "wait until *my* phase has ended" — even if a new phase has begun.

### Example 4: Fair RWMutex from Cond + Mutex (Go-style pseudocode in C++)

```cpp
// rwmutex.cpp — g++ -std=c++17 -O2 -pthread rwmutex.cpp -o rw
#include <condition_variable>
#include <mutex>
#include <iostream>
#include <thread>
#include <chrono>

class RWMutex {
public:
    void rlock() {
        std::unique_lock<std::mutex> lk(m_);
        readers_cv_.wait(lk, [&] { return !writer_active_ && waiting_writers_ == 0; });
        ++active_readers_;
    }
    void runlock() {
        std::unique_lock<std::mutex> lk(m_);
        if (--active_readers_ == 0 && waiting_writers_ > 0) {
            writers_cv_.notify_one();
        }
    }
    void lock() {
        std::unique_lock<std::mutex> lk(m_);
        ++waiting_writers_;
        writers_cv_.wait(lk, [&] { return !writer_active_ && active_readers_ == 0; });
        --waiting_writers_;
        writer_active_ = true;
    }
    void unlock() {
        std::unique_lock<std::mutex> lk(m_);
        writer_active_ = false;
        if (waiting_writers_ > 0) {
            writers_cv_.notify_one(); // prefer writers — prevents starvation
        } else {
            readers_cv_.notify_all();
        }
    }
private:
    std::mutex m_;
    std::condition_variable readers_cv_, writers_cv_;
    int active_readers_ = 0;
    int waiting_writers_ = 0;
    bool writer_active_ = false;
};

int main() {
    RWMutex rw;
    auto reader = [&](int id) {
        for (int i = 0; i < 3; ++i) {
            rw.rlock();
            std::cout << "reader " << id << " reading\n";
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
            rw.runlock();
        }
    };
    auto writer = [&](int id) {
        for (int i = 0; i < 2; ++i) {
            rw.lock();
            std::cout << "writer " << id << " writing\n";
            std::this_thread::sleep_for(std::chrono::milliseconds(80));
            rw.unlock();
        }
    };
    std::thread r1(reader, 1), r2(reader, 2), w1(writer, 1);
    r1.join(); r2.join(); w1.join();
}
```

Key middle-level points:

- **`waiting_writers_` count** enforces writer priority — new readers wait if any writer is queued, preventing writer starvation.
- **On `unlock`**, broadcast to readers (they can all proceed) but `notify_one` for writers (only one can hold the lock anyway).
- **Two condvars** mean readers and writers never wake each other unnecessarily — no thundering herd.

### Example 5: Lost-Wakeup Reproduction (Buggy Code — DO NOT COPY)

```cpp
// lost_wakeup.cpp — demonstrates the bug; expect occasional hangs
#include <condition_variable>
#include <mutex>
#include <thread>
#include <iostream>

std::mutex m;
std::condition_variable cv;
bool ready = false;

void consumer_bad() {
    // BUG: predicate read OUTSIDE the lock
    if (!ready) {
        std::unique_lock<std::mutex> lk(m);
        cv.wait(lk);  // BUG: no while, no predicate, no re-check
    }
    std::cout << "consumer proceeding\n";
}

void producer() {
    {
        std::lock_guard<std::mutex> lk(m);
        ready = true;
    }
    cv.notify_one();
}

int main() {
    // To trigger the race, producer runs first sometimes
    std::thread p(producer);
    p.join();
    std::thread c(consumer_bad);
    c.join();  // may hang forever
}
```

The two bugs combine. The consumer reads `ready` without the lock — by the time it acquires the lock and calls `wait`, the producer's signal is already gone. The fix is two lines:

```cpp
void consumer_good() {
    std::unique_lock<std::mutex> lk(m);
    cv.wait(lk, [&] { return ready; }); // predicate + while via lambda
    std::cout << "consumer proceeding\n";
}
```

Now the predicate is evaluated atomically with the lock held. If `ready` is already true, `wait` returns immediately without sleeping; if not, the wait is atomic with releasing the lock so no signal can be missed.

---

## Pros & Cons

**Pros**

- **Expressive** — any waiting condition can be modelled by a predicate.
- **Standardised** — POSIX, Win32, Java, .NET, Python, Go, Rust all implement Mesa-style condvars with nearly identical semantics.
- **Cheap when uncontended** — modern implementations stay in userspace until contention forces a syscall.
- **Composable** — used to build semaphores, barriers, RWMutex, blocking queues.

**Cons**

- **Easy to misuse** — lost wakeups, missing `while`, signalling outside the lock.
- **No built-in cancellation** in C/C++; you must bake a flag into the predicate.
- **Thundering herd** on naive `broadcast` use, especially with many waiters.
- **Spurious wakeups** require defensive coding — the `while` loop is non-negotiable.
- **Hard to reason about** with multiple condvars and many predicates — formal verification or careful invariants are needed at scale.

---

## Use Cases

- Bounded producer-consumer queues (the canonical case).
- Higher-level primitives — semaphores, barriers, RWMutex, count-down latches.
- Coordinating start-up phases: workers wait for `initialised == true`.
- Resource pools — connection pools, thread pools, memory pools.
- Implementing graceful shutdown — set `closed = true` and broadcast.
- Cross-thread event signalling where the receiver may not be ready yet (sequence numbers close the race).

---

## Coding Patterns

### Pattern A: Predicate Loop

```pseudo
lock(m)
while (!predicate())
    cond.wait(m)
... critical section ...
unlock(m)
```

The shape of every correct condvar use. Memorise it.

### Pattern B: Lock-Mutate-Signal-Unlock

```pseudo
lock(m)
mutate_state()
cond.signal_or_broadcast()
unlock(m)
```

Mutating state and signalling under the same lock ownership prevents lost wakeups and ensures every waiter sees the new state.

### Pattern C: One Cond per Predicate

If you find yourself broadcasting and then having most waiters go back to sleep, split into multiple condvars — one per disjoint predicate class.

### Pattern D: Generation Counter for Phase-Style Sync

When the same condvar is reused across rounds (barriers, epoch-based reclamation), add an integer that increments per round; predicates compare to the current value to avoid stale wakeups.

### Pattern E: Timed Wait with Deadline (Not Duration)

```cpp
auto deadline = std::chrono::steady_clock::now() + 100ms;
while (!predicate()) {
    if (cv.wait_until(lk, deadline) == std::cv_status::timeout) {
        if (!predicate()) return false; // real timeout
    }
}
```

`wait_until` is correct across multiple wakeups; `wait_for` re-arms the timer each call.

### Pattern F: Channel Translation Reminder (Go)

```go
// If you're tempted to write sync.Cond in Go, try channels first.
done := make(chan struct{})
go func() {
    // when ready:
    close(done) // broadcasts to all receivers
}()
<-done // any number of goroutines can wait on this
```

---

## Clean Code

- **Name the predicate**. `not_empty.wait(lk, [&]{ return !q.empty(); })` — the lambda *is* the predicate documentation.
- **Encapsulate**. The mutex, condvars, and predicate state belong inside the same class. If `signal` is callable from outside, you've leaked your invariants.
- **One mutex per logical object**. Multiple condvars on it are fine; multiple mutexes per object usually mean you should split the object.
- **Comment intent on `notify_one` vs `notify_all`**. State *why* — "uniform predicate" or "predicate depends on `n`".
- **Document shutdown semantics**. If `close()` exists, every waiting method must explain what happens to in-flight callers.

---

## Best Practices

1. **Always hold the mutex while calling `wait`.** APIs enforce this; do not get clever.
2. **Always use `while (!pred) wait(...)` or the predicate-lambda form.**
3. **Hold the mutex while mutating the state the predicate reads, including when you signal.** Release after.
4. **Prefer `signal` to `broadcast` when waiters are uniform** — measure before optimising the other way.
5. **Use multiple condvars instead of one + broadcast** when you have heterogeneous predicates.
6. **Add a generation counter** to anything reusable across phases.
7. **Bake cancellation into the predicate** — `predicate := real_pred || cancelled`. Broadcast on cancel.
8. **Use deadline-based waits** when looping; duration-based waits only in single-shot calls.
9. **Never call user code (callbacks, virtual methods) while holding the cond's mutex.** It risks deadlock and reentrancy.
10. **In Go, prefer channels.** Reach for `sync.Cond` only with a written justification.

---

## Edge Cases & Pitfalls

- **Signalling before the consumer waits** — fine *if* the predicate is true and the consumer is using `while`; the consumer will skip `wait`. Disaster if the consumer reads the predicate outside the lock.
- **Spurious wakeups under load** — observable in real systems, especially under heavy signal traffic. The `while` loop handles them.
- **Mutex held too long** — if the critical section calls slow code (I/O), waiters pile up and the cond becomes a queue. Move slow work outside the lock.
- **Two condvars sharing the wrong mutex** — must share the *same* mutex; mixing crosses an invariant boundary and is undefined behaviour.
- **Recursive lock + cond** — most APIs require a non-recursive mutex; `pthread_cond_wait` on a recursive mutex unlocks only one level, leaving others held. Java's `ReentrantLock.Condition` handles this correctly; raw POSIX does not.
- **`destroy` while waiters present** — destroying a cond or mutex that still has waiters is UB. Drain (broadcast and join) before destruction.
- **Allocation in the critical section** — can hide latency spikes; pre-allocate where possible.

---

## Common Mistakes

| Mistake | Why It Bites | Fix |
|--------|--------------|-----|
| `if (!pred) wait(...)` | Spurious / Mesa wakeup → predicate false on resume → bug | `while (!pred) wait(...)` |
| Reading predicate without the lock | Race window → lost wakeup | Lock before checking |
| Signalling without the lock | Race against modifying the predicate state | Lock, mutate, signal, unlock |
| `notify_all` on a uniform predicate | Thundering herd | `notify_one` |
| `notify_one` on a heterogeneous predicate | Wrong waiter wakes, right one starves | `notify_all` (or split condvars) |
| Sharing two condvars across different mutexes | UB and corrupted state | One mutex per cond family |
| Using `wait_for` in a loop | Each iteration re-arms the timeout — total wait is unbounded | `wait_until(deadline)` |
| Forgetting to handle shutdown | Threads block forever on close | Set flag, broadcast, predicate checks flag |
| Holding lock across slow I/O | Convoy of waiters, deadlock risk | Lock briefly, release, do I/O, re-lock if needed |
| Calling `signal` on a destroyed cond | UB, often a segfault | Lifecycle management |

---

## Tricky Points

- **Atomicity of release-and-wait.** Inside `wait`, the runtime must atomically (a) put the thread on the cond's waitqueue and (b) release the mutex. If either step happens without the other, lost wakeups become possible. Trust the implementation; do not try to imitate this in user code.

- **`broadcast` vs broadcast-then-unlock.** Some implementations are faster if you unlock *before* broadcasting (`signal-then-unlock`), because waiters waking up immediately try to acquire the mutex you've just released. Others (Linux glibc with wait morphing) handle the requeue internally. Do not over-optimise; measure.

- **Re-entrant cond use.** Calling `signal` while holding the same mutex from inside a `wait` callback is generally safe, but careless reentrancy (e.g. waiter's predicate calls back into a signaller) creates self-deadlock. Keep predicates pure functions of state.

- **Wait morphing and FIFO order.** Many `pthread_cond_t` implementations are FIFO under the hood but the FIFO can be subverted by wait morphing on broadcast. If strict FIFO matters, build it yourself (queue of tokens).

- **Cancellation points.** On POSIX, `pthread_cond_wait` is a cancellation point. A `pthread_cancel` while waiting executes cancellation handlers and exits the thread — your cleanup must rewind the mutex state. Use `pthread_cleanup_push`.

- **Java intrinsic vs explicit.** A single object can host one `Object.wait/notify` queue plus arbitrary explicit `Condition` queues via a `ReentrantLock` field — but mixing them on the same lock is begging for confusion.

---

## Test Yourself

1. Why must the predicate be re-checked after `wait` returns under Mesa semantics, even with no spurious wakeups?
2. Describe one concrete situation where `signal` is provably correct, and one where it is provably incorrect.
3. Implement a count-down latch from mutex + cond.
4. Why does the barrier example need a `generation_` counter? What goes wrong without it?
5. What is the lost-wakeup bug? Sketch a fix for it.
6. Why may `wait` return spuriously on Linux? Cite a mechanism, not just "POSIX allows it".
7. In the RWMutex example, why do we `notify_one` writers but `notify_all` readers?
8. Why does idiomatic Go avoid `sync.Cond`?
9. What does `wait_until` do that `wait_for` does not?
10. Convert the bounded buffer to use only one condvar and `broadcast`. What changes in throughput under heavy load?

---

## Tricky Questions

1. *A team observes that adding a `notify_all` to every state mutation "to be safe" causes a 4x slowdown under load. Explain mechanistically what is happening and recommend a fix.*
2. *Your colleague proposes using `if` instead of `while` to skip a "wasted iteration". On a system with no documented spurious wakeups, are they correct? Defend with Mesa semantics.*
3. *You see a deadlock once a week in production. The hung thread is blocked in `pthread_cond_wait`. Walk through the lost-wakeup hypothesis, and three other hypotheses you would investigate.*
4. *Describe how a futex sequence number closes the race between `signal` and `wait` at the kernel level. Why is this design impossible in a userspace-only implementation?*
5. *Could you implement a condition variable from just an atomic integer? What guarantees would you lose without kernel waitqueue support?*
6. *Why does signalling without the mutex held — though allowed by POSIX — almost never appear in correct production code?*
7. *Compare a single condvar + broadcast to two condvars + targeted signal for a bounded buffer. Under what consumer/producer ratios does the difference disappear?*
8. *In Java, when would you prefer `Object.wait/notify` over `ReentrantLock.newCondition`?*
9. *Sketch a fair RWMutex that prevents both reader and writer starvation. Where would condvars suffice and where would you reach for a queue?*
10. *In Go, you have 10,000 goroutines that must be unblocked when a `bool` flips. Is `close(channel)` or `sync.Cond.Broadcast` faster, and why?*

---

## Cheat Sheet

```
Discipline:
  lock → check predicate → wait if false → re-check → act → signal → unlock

ALWAYS:
  - while (!pred) cond.wait(lock)
  - hold lock when mutating predicate state
  - hold lock when calling signal/broadcast (preferred)

CHOOSE:
  signal     -> uniform predicate, any one waiter can proceed
  broadcast  -> heterogeneous predicates, multiple waiters can proceed, or shutdown

TIME:
  wait_until(deadline) for loops; wait_for(duration) for single-shot only

MULTIPLE CONDS:
  - one mutex
  - one cond per predicate class
  - avoids thundering herd

SHUTDOWN:
  - bool closed
  - predicate: real_pred || closed
  - close(): closed=true; broadcast all conds

DEBUGGING:
  - hang in wait → lost wakeup or predicate bug
  - 100% CPU near wait → spurious wakeup in tight loop (rare) or predicate flapping
  - thundering herd → swap broadcast for signal or split conds
```

---

## Summary

- **Mesa semantics** — every mainstream language. The signalled thread does not run immediately; you must re-check the predicate in a `while` loop.
- **`signal` vs `broadcast`** — signal when waiters are uniform, broadcast when predicates differ or on shutdown.
- **Thundering herd** is the cost of unnecessary `broadcast`; mitigations are signal, multiple condvars, and runtime wait morphing.
- **Spurious wakeups** are real on Linux due to futex implementation details; the `while` loop covers them automatically.
- **Lost wakeup** is the deadliest bug: signal issued before wait, predicate evaluated without the lock. Discipline of "lock → check → wait → mutate → signal → unlock" eliminates it.
- **Multiple condvars on one mutex** is the clean fix for heterogeneous predicates.
- **Higher-level primitives** — semaphore, barrier, RWMutex — are all expressible as mutex + condvar. Build each once to internalise the model.
- **Language-specific notes** — Java has two APIs; Python's `threading.Condition` is well-designed; Go prefers channels.

---

## What You Can Build

- A bounded blocking queue with `signal`-per-side and graceful shutdown.
- A counting semaphore with timeout-aware `acquire(n)`.
- A reusable barrier with generation counter.
- A fair readers-writer lock with writer priority.
- A connection pool with predicate "available > 0".
- A count-down latch (`await(n)` blocks until `n` calls to `count_down`).
- A simple actor mailbox with backpressure.
- A worker pool that drains gracefully on shutdown.

---

## Further Reading

- *POSIX Threads Programming* — Butenhof. The canonical book; chapters 3 and 5 are gold.
- *Programming with POSIX Threads* — same author, deeper dives on cond and mutex internals.
- *The Little Book of Semaphores* — Downey. Build your intuition by re-deriving synchronisation problems with mutex + cond + sem.
- *Java Concurrency in Practice* — Goetz et al. Chapter 14 on building custom synchronizers with `Condition`.
- Linux man pages: `pthread_cond_wait(3)`, `futex(2)`, `futex(7)`.
- glibc source: `nptl/pthread_cond_wait.c` — read once for enlightenment.
- Russ Cox, "Go Concurrency Patterns" — why channels usually win.
- Doug Lea, "Synchronizer Framework" — the design behind `AbstractQueuedSynchronizer` in Java.

---

## Related Topics

- [Mutexes & Locks](../02-mutexes/README.md) — the mandatory companion to every condvar.
- [Semaphores](../04-semaphores/README.md) — often clearer than condvars for counting use cases.
- [Channels & CSP](../06-channels/README.md) — the higher-level alternative in Go and Rust.
- [Futexes](../../03-low-level/02-futex/README.md) — what your condvar is built on.
- [Barriers](../05-barriers/README.md) — a derived primitive.
- [Producer-Consumer Patterns](../../03-patterns/01-producer-consumer/README.md) — the use case that defines condvars.

---

## Diagrams & Visual Aids

### Mesa Wait/Signal Sequence

```
Thread A (waiter)                       Thread B (signaller)
-----------------                       --------------------
lock(m)
while (!pred):                          
  cond.wait(m) -+                       
                |  (release m, sleep)   
                |                       lock(m)
                |                       mutate state (pred true)
                |                       cond.signal()  --+
                |                       unlock(m)        |
                |                                        v
                +-- (woken, re-acquire m)
while (!pred):  -- pred now true, skip
... critical section ...
unlock(m)
```

### Lost Wakeup Race (BAD)

```
Thread A (consumer, buggy)              Thread B (producer)
-------------------------               -------------------
if (!ready)         <-- check OUTSIDE lock
                                        lock(m)
                                        ready = true
                                        cond.signal()   <-- nobody waiting
                                        unlock(m)
  lock(m)
  cond.wait(m)      <-- sleeps forever
```

### Two Condvars vs One Condvar + Broadcast

```
ONE COND + BROADCAST (bounded buffer):

producer.push():                        consumer.pop():
  ...                                     ...
  cond.broadcast()  -- wakes producers AND consumers
                       producers immediately re-sleep (predicate false)

TWO CONDS:

producer.push():                        consumer.pop():
  not_empty.signal()  -- wakes ONE consumer only
  ...                                     not_full.signal() -- wakes ONE producer only
```

### Generation Counter in a Barrier

```
Phase 0:  threads 1,2,3,4 arrive, last (4) flips gen 0 -> 1, notify_all
          waiters check (gen != saved_gen) -> true, proceed

Phase 1:  thread 1 races ahead, arrives at barrier again
          waiting_=1, gen still 1
          But thread 1's saved_gen is 1; it waits on (gen != 1) -> false, sleeps
          Until last thread arrives, flips gen 1 -> 2, broadcast
```

### Futex Sequence Number Wakeup

```
Cond struct:
   seq:  4   <-- incremented on every signal/broadcast
   mutex queue
   wait queue

Waiter:                                 Signaller:
  observed = cond.seq (=4)               cond.seq = 5
  release mutex                          futex_wake(&cond.seq, 1)
  futex_wait(&cond.seq, 4)
    kernel: if cond.seq == 4 -> sleep
            else              -> return EAGAIN (no sleep, retry)
```

### Choosing Signal vs Broadcast

```
Question                                          | signal | broadcast
--------------------------------------------------|--------|----------
All waiters have the same predicate?              |  YES   |   no
Waiters may want different "amounts"?             |   no   |   YES
State change satisfies multiple waiters at once?  |   no   |   YES
Shutdown / cancellation?                          |   no   |   YES
Spawned thousands of waiters?                     |  signal+ multiple conds preferred
```

---

*Next: [Condition Variables — Senior Level](senior.md) — kernel implementations, lock-free condvars, futex2, formal semantics, and modeling with TLA+.*
