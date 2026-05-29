# Condition Variables — Professional Level

> **Topic:** [Condition Variables](README.md)
> **Focus:** monitor history, library design, alternatives ecosystem

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

At the professional level, the question stops being "how do I use a condition variable" and becomes "should this API expose one at all". Condition variables sit at the very bottom of the coordination stack — every blocking queue, every future, every channel implementation eventually bottoms out into something that looks like wait/signal on a queue of parked threads. But that does not mean every user should touch them directly.

This level traces condition variables back to their origin: Tony Hoare's 1974 paper on monitors, Per Brinch Hansen's parallel work on Concurrent Pascal, and the pragmatic Mesa system at Xerox PARC in 1980 that gave us the semantics we actually use today. Understanding why Mesa-style "signal-and-continue" defeated Hoare's elegant "signal-and-wait" tells you something important about how systems get built in the real world: clarity of proof loses to operational simplicity, almost every time.

We will also look outward — at the library and language designers who decided, deliberately, that condition variables would not appear in their user-facing concurrency story. Go ships `sync.Cond` in the standard library but its documentation politely suggests you probably want a channel. Rust's standard library ships `Condvar` but the ecosystem skews toward `mpsc`, `crossbeam`, and `tokio`. Java keeps `Object.wait`/`notify` for legacy reasons but pushes engineers toward `BlockingQueue`, `Phaser`, `CountDownLatch`, and `CyclicBarrier`. The pattern is clear: condition variables are a primitive for library authors, not application authors.

When you finish this level you should be able to (a) defend a design decision about whether a public API exposes condvar-style waits or hides them behind a higher-level abstraction, (b) explain to a junior engineer why `sync.Cond` in their pull request is a smell and what to use instead, and (c) sit in front of a Mesa paper or a Hoare paper and read it without needing a translator.

---

## Prerequisites

- Solid command of mutexes, condition variables, and the predicate loop (the senior level material).
- Familiarity with at least two of: Java `java.util.concurrent`, Go's `sync` and channels, Rust's `std::sync` and `crossbeam`.
- Comfort reading academic-style pseudocode (Hoare, Brinch Hansen).
- Experience designing a public API where you had to choose what to expose and what to hide.
- Understanding of the difference between a primitive (a single-purpose building block) and an abstraction (a curated combination of primitives).

---

## Glossary

- **Monitor** — A synchronization construct that bundles shared state, the mutex guarding it, and the condition variables operating on it into a single language-level abstraction.
- **Hoare semantics** — Signal-and-wait: when a waiter is signaled, control transfers to it immediately and the signaler is suspended until the waiter releases the lock.
- **Mesa semantics** — Signal-and-continue: when a waiter is signaled, the signaler keeps running; the waiter is merely marked runnable and competes for the lock like anyone else.
- **Brinch Hansen** — Per Brinch Hansen, who independently developed monitor concepts in Concurrent Pascal (1975) and was a long-time critic of Hoare's signal-and-wait choice.
- **Mesa** — A Xerox PARC systems programming language (1980) whose pragmatic monitor implementation set the template for Java, Pthreads, .NET, and almost everyone else.
- **Phaser** — A Java `java.util.concurrent` synchronization barrier that supports a dynamic number of parties and multiple phases; condvar-backed under the hood.
- **CountDownLatch** — A Java one-shot latch that lets one or more threads wait until a counter reaches zero.
- **CyclicBarrier** — A Java reusable barrier that synchronizes a fixed set of threads at a meeting point.
- **Exchanger** — A two-thread rendezvous point in Java where each thread brings a value and gets the other's value.
- **Footgun** — A primitive that is easy to misuse in ways that compile, pass tests, and explode under load.
- **Parking lot** — A queue of suspended threads associated with a condition variable, conceptually identical to the "wait set" in Java.

---

## Core Concepts

### History — Hoare's monitor (1974), Brinch Hansen, Mesa (1980)

The story starts in 1965 with Edsger Dijkstra's semaphores. Semaphores work but they put correctness entirely in the programmer's hands: forget a `V()`, and you deadlock; mismatch a `P()` and `V()` between procedures, and your invariant is gone. Through the late 1960s and early 1970s, people searched for a higher-level construct.

Tony Hoare's 1974 paper "Monitors: An Operating System Structuring Concept" was the first widely-read formal proposal. Hoare's monitor was a module that:

1. Encapsulated some shared state.
2. Provided procedures that operated on that state.
3. Guaranteed that at most one procedure was executing inside the monitor at a time (an implicit mutex).
4. Exposed condition variables, with `wait` and `signal` operations, to let procedures block until the state satisfied some predicate.

Hoare's `signal` had a specific semantics: when you signaled, the awakened waiter ran immediately, and the signaler was suspended. This guaranteed that the awakened waiter saw the world exactly as the signaler left it — no other thread had a chance to mutate state in between. Hoare picked this because it made proofs simpler: you could reason about the invariant at the point of `signal` and at the point of return from `wait` as if they were the same point in time.

Per Brinch Hansen had been working in parallel on Concurrent Pascal (1975), which also had monitors but with subtly different semantics. Brinch Hansen used "signal-and-return": a procedure could only signal as its very last action before returning, which preserved the invariant transfer property without the overhead of suspending the signaler.

Then in 1980, Butler Lampson and David Redell published "Experience with Processes and Monitors in Mesa". Mesa was a real, shipping systems language used at Xerox PARC, and the paper was an honest engineering retrospective. Lampson and Redell explained that they had abandoned both Hoare and Brinch Hansen semantics. Mesa's `notify` was a hint — it marked a waiter as runnable but did not transfer control. The waiter, when it eventually got the lock, had to re-check its predicate because anything might have happened in the meantime.

This was the birth of the loop-around-wait pattern that every modern system requires.

### Hoare vs Mesa semantics — the "signal-and-continue" vs "signal-and-wait" choice; why Mesa won

Why did Mesa win? Several reasons, all of them mundane:

**Operational simplicity.** In Hoare semantics, every `signal` is potentially a context switch. The signaler must be suspended; the waiter must be resumed; if the waiter blocks again or returns from the monitor, the signaler must be resumed. The scheduler is involved on every signal. In Mesa, `notify` is a flag flip on a thread's state, and the scheduler picks it up whenever it would have anyway. That is orders of magnitude cheaper.

**Spurious wakeups become a non-issue.** Because Mesa requires every waiter to re-check its predicate in a loop, the implementation is free to wake waiters more often than strictly necessary. This lets the kernel or runtime use coarse-grained signaling, batch wakeups, or use tricks like futexes that occasionally lie. In Hoare semantics, every wakeup must be "real" or correctness is broken — which constrains the implementation badly.

**Composition with timers, interrupts, and cancellation.** A Mesa `wait` can wake up for any reason — a signal, a timeout, a cancellation flag, a signal handler — and the predicate loop sorts it out. A Hoare `wait` cannot, because the contract is that you only wake up when state was correct at the moment of signal.

**It matches what the hardware wants to do.** Modern processors run threads on independent cores; transferring control synchronously between cores is exactly what you do not want. Mesa semantics matches the asynchronous nature of the hardware.

**It's easier to teach.** "When you wake up, the world may have changed. Re-check." is one sentence. Hoare's "the invariant at signal is the invariant at the return from wait" requires a course in axiomatic semantics.

The price you pay is real but acceptable: every waiter does a small amount of redundant work re-checking its predicate, and the system as a whole has slightly looser guarantees about when a signaled thread will actually run. Every mainstream system since 1980 has decided the price is worth it. Pthreads, Java, Win32, .NET, Go, Rust, Python — all Mesa-style.

### Java's monitor (synchronized + wait/notify) as a Mesa-style monitor

Java is the most widely-deployed monitor system in history. Every Java object is, implicitly, a monitor: it has an associated mutex (the intrinsic lock), a wait set (the condition variable queue), and the `synchronized` keyword acts as the monitor entry. The `Object.wait()`, `Object.notify()`, and `Object.notifyAll()` methods are the wait/signal/broadcast operations.

```java
public class BoundedBuffer<T> {
    private final Object[] items;
    private int head, tail, count;

    public BoundedBuffer(int capacity) {
        this.items = new Object[capacity];
    }

    public synchronized void put(T x) throws InterruptedException {
        while (count == items.length) {
            wait();
        }
        items[tail] = x;
        tail = (tail + 1) % items.length;
        count++;
        notifyAll();
    }

    @SuppressWarnings("unchecked")
    public synchronized T take() throws InterruptedException {
        while (count == 0) {
            wait();
        }
        T x = (T) items[head];
        head = (head + 1) % items.length;
        count--;
        notifyAll();
        return x;
    }
}
```

This is textbook Mesa: `synchronized` enters the monitor, `wait()` releases the lock and parks, `notifyAll()` wakes everyone, and the loop around `wait()` re-checks the predicate because Mesa semantics demand it. Java only gives you one condition variable per object — if you need separate predicates (full vs empty), you have to use `notifyAll()` and let everyone re-check. The newer `java.util.concurrent.locks.Lock` plus `Condition` interfaces fix this by letting you have multiple condition variables per lock.

### Designing a library API that exposes condition-variable-style waits

When you write a library, you face a choice: expose the wait/signal primitive, or hide it behind a higher-level abstraction.

**Expose it (rare):** Your users are themselves library authors, your domain is "build me a synchronization primitive", and your users will read the documentation. Examples: `java.util.concurrent.locks.Condition`, Rust's `parking_lot::Condvar`, Go's `sync.Cond`. Note that all three of these come with stern warnings in their documentation.

**Hide it behind futures/promises (most common):** Your users want "do this work and tell me when it's done". The future/promise abstraction wraps a condvar internally — `future.get()` is just `cond.wait()` with predicate "is result set" — but the user never sees the condvar. JavaScript Promises, Java `CompletableFuture`, Rust `Future`, Python `asyncio.Future`. The condvar is an implementation detail.

**Hide it behind channels (Go, Erlang, CSP-style):** Your users want "send messages between coroutines". The channel internally uses a mutex and a condvar (or something morally equivalent) to park sleeping receivers and wake them on send. The user never writes `wait()`.

**Hide it behind events/signals (UI frameworks, Node.js):** Your users subscribe to events and get callbacks. The dispatcher uses a condvar internally to coordinate event delivery between the event loop and any worker threads. The user just writes `emitter.on('foo', callback)`.

**Hide it behind structured constructs (latches, barriers, semaphores):** Your users want "wait for N things" or "release K permits". `CountDownLatch`, `CyclicBarrier`, `Semaphore` all wrap a condvar with a counting predicate.

The rule of thumb: only expose condvar-style waits when the user's predicate is genuinely unconstrained and unknowable to you. If you can characterize the predicate ("result is ready", "count reached zero", "permit available"), build the abstraction.

### When NOT to expose condvar to users (it's footgun-y)

Condition variables are a footgun for at least five reasons:

1. **The predicate must be checked in a loop.** Users will forget. The code looks like it works in unit tests.
2. **Wait releases the lock.** Users do not understand this, and write code that assumes invariants hold across `wait()`.
3. **Signal-vs-broadcast is a correctness decision.** Wrong choice produces lost wakeups (signal when multiple should wake) or thundering herd (broadcast when one should wake). Users do not have the context to choose.
4. **Predicate, lock, and condvar must be associated correctly.** A condvar paired with the wrong lock, or guarding the wrong piece of state, deadlocks at midnight in production.
5. **Spurious wakeups are real.** Users do not believe they are real until production. Then they do.

If your API exposes condvars, you are signing up to teach every user about these five issues, in your documentation, repeatedly, forever.

### Alternatives: blocking queues, futures, channels, signals/events

The alternatives are not just "easier to use" — they encode the discipline directly in the API.

- **Blocking queue.** The predicate is fixed: "an item is available" or "space is available". The loop is hidden inside `put` and `take`. Users cannot get it wrong.
- **Future / Promise.** The predicate is fixed: "the result is set". The loop is hidden inside `get()`. Cancellation, timeout, and error handling are first-class.
- **Channel.** The predicate is "a sender has matched with me" or "the channel is closed". The mutex+condvar is invisible. Composition with `select` is built in.
- **Semaphore.** The predicate is "permits > 0". `acquire` and `release` are the only verbs.
- **Latch / Barrier.** The predicate is "all parties have arrived" or "counter has reached zero". One method, one signal.
- **Event / Signal.** The predicate is "the event has fired". Wait and reset are the API.

Each of these is a condvar in disguise, but with the predicate, the loop, and the signal/broadcast choice baked into the type.

### Java's Phaser, CountDownLatch, CyclicBarrier, Exchanger as condvar-backed conveniences

These are the canonical examples of "expose the abstraction, hide the condvar".

- `CountDownLatch(N)`: one-shot. `await()` blocks until `countDown()` has been called N times. Internally: AQS (AbstractQueuedSynchronizer), which is a souped-up condvar.
- `CyclicBarrier(N, action)`: reusable. `await()` blocks until N threads have all called `await()`. Then the optional `action` runs once, all threads are released, and the barrier resets.
- `Phaser`: dynamic. Number of parties can change. Multiple phases. Supports advancing, deregistering, hierarchical phasing. The Swiss Army knife of barriers.
- `Exchanger<V>`: rendezvous. Two threads each call `exchange(myValue)` and each receives the other's value.

All four are built on AQS, which itself is a high-quality condvar implementation. None of them require the user to write a wait loop, choose between signal and broadcast, or even know what a condition variable is.

### Modern languages largely hide condvars (Go uses channels; Rust prefers channels/parking_lot)

Go is the cleanest example. `sync.Cond` exists in the standard library but the documentation says:

> "For many simple use cases, users will be better off using channels than a Cond (Broadcast corresponds to closing a channel, and Signal corresponds to sending on a channel)."

This is the standard library telling you not to use the standard library. Go's design center is CSP: communicating sequential processes through channels. A channel send wakes a receiver; closing a channel broadcasts to all receivers; `select` composes multiple channels. Almost any condvar use case in Go has a more idiomatic channel implementation.

Rust's `std::sync::Condvar` exists for the same reason Go's `sync.Cond` exists: to be a building block for higher-level abstractions. But application code in Rust overwhelmingly reaches for `std::sync::mpsc` (multi-producer single-consumer channels), `crossbeam::channel` (more flexible channels), or `tokio` (async runtime). The `parking_lot::Condvar` crate exists for performance-critical library code.

Python's `threading.Condition` is taught in textbooks but production Python code reaches for `queue.Queue`, `concurrent.futures`, or `asyncio` — all of which hide the condvar internally.

C++ has `std::condition_variable`, which is widely used, but only because C++ is a systems language whose users explicitly want low-level primitives.

### Anti-patterns: condvar as event signal; broadcast without need; sleeping wait without predicate

**Condvar as event signal.** "I just want to tell one thread that something happened." A condvar is the wrong tool. A channel, an atomic flag with a futex, or a `Future` is the right tool. Symptom: the predicate is `eventFired` and never reset; spurious wakeups cause double-handling.

**Broadcast without need.** Calling `notifyAll()` "to be safe" when only one waiter could possibly proceed. Symptom: thundering herd; on a 64-thread system, every signal wakes 64 threads, all of which check the predicate, find one is true, 63 of them re-park.

**Sleeping wait without predicate.** Using `sleep(100)` instead of `wait()` because the developer did not understand condvars. Symptom: latency-throughput tradeoff that gets worse over time; eventual production incident when a longer-running operation pushes the sleep past the deadline.

### The "barrier" abstraction built from condvars

A barrier is an N-thread rendezvous point. The natural condvar implementation:

```text
class Barrier:
    int parties
    int waiting = 0
    Mutex mu
    Cond cond

    void await():
        mu.lock()
        waiting++
        if waiting == parties:
            waiting = 0       # reset for reuse (cyclic)
            cond.broadcast()
        else:
            int generation = currentGeneration
            while currentGeneration == generation and waiting < parties:
                cond.wait(mu)
        mu.unlock()
```

This is exactly what `CyclicBarrier` does. The condvar is the engine; the barrier is the steering wheel.

### Mentoring: when a junior reaches for sync.Cond in Go, that's usually a smell

In a Go code review, when you see `sync.Cond`, ninety percent of the time the right reaction is "let's talk about why a channel doesn't work here". The cases where `sync.Cond` is actually correct in Go are narrow: you need to broadcast to a large number of waiters, the waiters are mutating shared state that the broadcaster also touches, and you cannot model the waiters as receivers on a channel. Real cases exist (some database connection pool implementations, some custom worker pool designs) but they are rare.

When mentoring, walk through the alternatives with the junior: would a `chan struct{}` work for signaling? Would a buffered channel work for batching? Would `context.Context` work for cancellation? Would a `sync.WaitGroup` work for "wait for N to finish"? If the answer to all is no, then yes, `sync.Cond` is appropriate — but make sure the answer to all four really is no.

---

## Real-World Analogies

**The fire drill (Hoare semantics).** The fire chief blows the whistle. Everyone in the building stops what they are doing and exits in a predetermined order. The chief waits at the exit until the last person is out. This is signal-and-wait: control transfers immediately and the signaler is suspended until the waiter is fully out.

**The radio announcement (Mesa semantics).** The DJ says "free pizza in the lobby". The DJ keeps talking. Listeners hear it eventually, walk over to the lobby, and discover whether there is still pizza when they get there. This is signal-and-continue: the broadcaster does not wait, and the listener must verify the world has not changed.

**The hotel concierge (the monitor abstraction).** Guests do not pour their own coffee, manage their own keys, or coordinate among themselves. They walk up to the concierge — one at a time, by convention — and ask. The concierge decides whether to fulfill the request now, ask the guest to wait, or signal a bellhop. The guests never touch the underlying machinery. This is what a well-designed monitor API looks like to users.

**The receipt printer (futures/promises).** You order at the counter. You get a receipt with a number. You do not wait at the counter; you do other things. When your number is called, you come back and collect. The number is a `Future`; the call is the condvar signal hidden inside the future's `get()`.

**The mailbox (channels).** You drop a letter in your neighbor's mailbox. You walk away. They check the mailbox when they get home. Neither of you waits at the mailbox watching. The mailbox is a buffered channel; the visit to the mailbox is the receive operation.

---

## Mental Models

**Layers of the coordination stack.** At the bottom: atomic operations and memory fences. Above that: mutexes and condition variables. Above that: structured primitives — semaphores, latches, barriers, futures, channels. Above that: domain abstractions — pipelines, work queues, request handlers. Each layer hides the one below from its users. Library authors live at one layer; their users live at the layer above. Confusion happens when users dig into the wrong layer.

**The "API as encoded discipline" model.** Every condvar discipline rule — loop around wait, check predicate, choose signal vs broadcast — should be encoded in the type system or the API shape if possible. A `BlockingQueue` makes the loop impossible to skip. A `Future` makes the predicate ("result set") immutable. A `Latch` makes the broadcast (when count reaches zero) automatic.

**The "footgun vs hammer" framing.** A footgun is sharp, multi-purpose, and dangerous in untrained hands. A hammer is blunt, single-purpose, and safe enough to leave on the workbench. Condvars are footguns. Latches, barriers, futures are hammers. Library authors should ship hammers and put the footgun in a locked drawer labeled "for advanced users".

---

## Code Examples

### Example 1: Phaser-based parallel-stage workflow

```java
import java.util.concurrent.*;

public class PhaserPipeline {
    public static void main(String[] args) throws InterruptedException {
        int workers = 4;
        Phaser phaser = new Phaser(workers);

        ExecutorService pool = Executors.newFixedThreadPool(workers);
        for (int i = 0; i < workers; i++) {
            final int id = i;
            pool.submit(() -> runWorker(id, phaser));
        }

        pool.shutdown();
        pool.awaitTermination(1, TimeUnit.MINUTES);
    }

    private static void runWorker(int id, Phaser phaser) {
        try {
            log(id, "stage 1: loading data");
            Thread.sleep(100 + id * 30);
            phaser.arriveAndAwaitAdvance();

            log(id, "stage 2: processing");
            Thread.sleep(150 + id * 20);
            phaser.arriveAndAwaitAdvance();

            log(id, "stage 3: writing output");
            Thread.sleep(80 + id * 10);
            phaser.arriveAndAwaitAdvance();

            log(id, "done");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void log(int id, String msg) {
        System.out.printf("[worker %d] %s%n", id, msg);
    }
}
```

This is a classic parallel-stage workflow. Four workers each go through three stages. `arriveAndAwaitAdvance()` blocks until all four have arrived at that phase, then releases them all. The user wrote no `wait`, no `notify`, no predicate loop. The `Phaser` did all of it.

### Example 2: CountDownLatch for graceful start

```java
import java.util.concurrent.*;

public class GracefulStart {
    public static void main(String[] args) throws InterruptedException {
        int services = 5;
        CountDownLatch ready = new CountDownLatch(services);
        CountDownLatch go = new CountDownLatch(1);

        ExecutorService pool = Executors.newFixedThreadPool(services);
        for (int i = 0; i < services; i++) {
            final int id = i;
            pool.submit(() -> {
                try {
                    initialize(id);
                    ready.countDown();
                    go.await();
                    serve(id);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
        }

        ready.await();
        System.out.println("All services initialized. Releasing.");
        go.countDown();

        pool.shutdown();
        pool.awaitTermination(1, TimeUnit.MINUTES);
    }

    private static void initialize(int id) throws InterruptedException {
        System.out.printf("service %d initializing...%n", id);
        Thread.sleep(100 + (long) (Math.random() * 200));
        System.out.printf("service %d ready%n", id);
    }

    private static void serve(int id) throws InterruptedException {
        System.out.printf("service %d serving requests%n", id);
        Thread.sleep(50);
    }
}
```

Two latches: one to know everyone is initialized, one to release them all at once. This is a classic "synchronized start" pattern for benchmarks and for production services that must not start serving until all of their peers are ready. Condvar-backed underneath, completely hidden from the user.

### Example 3: Hoare-monitor pseudo-implementation

This example shows what Hoare semantics would look like, implemented on top of Mesa semantics, so you can see the difference. It is not how you would actually build a system — it is a teaching tool.

```java
import java.util.concurrent.locks.*;

public class HoareMonitor {
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition urgentQueue = lock.newCondition();
    private int urgentCount = 0;

    public Condition newCondition() {
        return new HoareCondition(lock.newCondition());
    }

    public void enter() {
        lock.lock();
    }

    public void leave() {
        if (urgentCount > 0) {
            urgentQueue.signal();
        }
        lock.unlock();
    }

    private class HoareCondition {
        private final Condition mesaCond;
        private int waiters = 0;

        HoareCondition(Condition mesaCond) {
            this.mesaCond = mesaCond;
        }

        public void hoareWait() throws InterruptedException {
            waiters++;
            mesaCond.await();
            waiters--;
        }

        public void hoareSignal() throws InterruptedException {
            if (waiters > 0) {
                urgentCount++;
                mesaCond.signal();
                urgentQueue.await();
                urgentCount--;
            }
        }
    }
}
```

The trick: when `hoareSignal` fires, it wakes a waiter and then immediately puts itself on the `urgentQueue`. The waiter gets the lock, does its work, and when it calls `leave()`, the `leave()` checks the urgent queue and wakes the original signaler. This implements signal-and-wait on top of signal-and-continue. The code is correct but slow — every signal becomes two context switches. This is roughly why Mesa won: even when you want Hoare semantics, you build them on a Mesa substrate.

### Example 4: A Future implemented directly on a condvar

```java
import java.util.concurrent.locks.*;
import java.util.concurrent.TimeUnit;

public class SimpleFuture<V> {
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition done = lock.newCondition();
    private V value;
    private Throwable error;
    private boolean complete = false;

    public V get() throws InterruptedException {
        lock.lock();
        try {
            while (!complete) {
                done.await();
            }
            if (error != null) {
                throw new RuntimeException(error);
            }
            return value;
        } finally {
            lock.unlock();
        }
    }

    public V get(long timeout, TimeUnit unit) throws InterruptedException {
        lock.lock();
        try {
            long nanos = unit.toNanos(timeout);
            while (!complete && nanos > 0) {
                nanos = done.awaitNanos(nanos);
            }
            if (!complete) {
                throw new RuntimeException("timeout");
            }
            if (error != null) {
                throw new RuntimeException(error);
            }
            return value;
        } finally {
            lock.unlock();
        }
    }

    public void complete(V v) {
        lock.lock();
        try {
            if (!complete) {
                value = v;
                complete = true;
                done.signalAll();
            }
        } finally {
            lock.unlock();
        }
    }

    public void fail(Throwable t) {
        lock.lock();
        try {
            if (!complete) {
                error = t;
                complete = true;
                done.signalAll();
            }
        } finally {
            lock.unlock();
        }
    }
}
```

This is a `Future` from scratch. Predicate: `complete`. Wait loop: yes. Broadcast on completion: yes. The user calls `get()` and never sees the condvar. This is what every production future implementation does, with embellishments for cancellation, chaining, and combination.

---

## Pros & Cons

**Pros of exposing condvars in your library**
- Maximum flexibility for advanced users who genuinely need it.
- No abstraction overhead.
- Matches the mental model of users coming from C/C++ or systems programming.

**Cons of exposing condvars in your library**
- Users will misuse them. They will skip the loop, choose the wrong signal type, forget to hold the lock, use the wrong condvar.
- Documentation burden — you must teach Mesa semantics in your own docs.
- Bugs will be reported as your library's bugs, not as user errors.
- API evolution is hard: if you later want to add cancellation, timeouts, or async, you have to ship a new API.

**Pros of high-level abstractions (queues, futures, channels, latches)**
- Discipline encoded in the type.
- Predictable performance characteristics.
- Composable: futures combine, channels select, queues drain.
- Documentation is short and friendly.

**Cons of high-level abstractions**
- Edge cases sometimes fall outside the abstraction.
- Performance overhead in pathological cases.
- A naive user can still misuse them (e.g., unbounded queues).

---

## Use Cases

- **Designing a job scheduler API.** Expose `Future` for individual job completion; expose `BlockingQueue` for pending jobs; expose `Phaser` for grouped stage advancement. Do not expose condvars.
- **Designing a database connection pool.** Internally use a condvar to park threads waiting for an available connection. Externally expose `acquire()` and `release()` with optional timeout. The condvar is invisible.
- **Designing an actor framework.** Channels for all communication. Condvars hidden inside channel implementation.
- **Designing a parallel batch processing system.** `CountDownLatch` for "wait for all batches to finish". `CyclicBarrier` for "synchronize between stages". Condvars hidden inside both.
- **Designing a custom concurrency primitive.** This is the one case where exposing a condvar is justified — but only if your users are library authors themselves.

---

## Coding Patterns

### Pattern: API that hides condvars behind futures

```java
public interface AsyncCache<K, V> {
    CompletableFuture<V> get(K key);
    void put(K key, V value);
}
```

The user does not know whether `get` blocks, polls, or queues. They get a future. The implementation can use any synchronization primitive it wants, swap it for a different one in v2, or even reroute to a remote service.

### Pattern: Layered library — public abstraction, internal condvar

```java
public final class Token {
    private final Object lock = new Object();
    private String value;

    public String fetch() throws InterruptedException {
        synchronized (lock) {
            while (value == null) {
                lock.wait();
            }
            return value;
        }
    }

    void set(String v) {
        synchronized (lock) {
            this.value = v;
            lock.notifyAll();
        }
    }
}
```

Internally, this is a condvar. Externally, the user calls `fetch()` and gets a string. The fact that they might block is documented, but the mechanism is not.

### Pattern: Don't expose; expose a channel instead

```go
type EventBus struct {
    ch chan Event
}

func New() *EventBus {
    return &EventBus{ch: make(chan Event, 100)}
}

func (b *EventBus) Publish(e Event) {
    b.ch <- e
}

func (b *EventBus) Subscribe() <-chan Event {
    return b.ch
}
```

A condvar-based implementation is possible. A channel-based one is idiomatic Go, smaller, and composes with `select`.

---

## Clean Code

- Public APIs should not contain the words `wait`, `notify`, or `condition` unless they are intentionally low-level.
- Method names like `awaitCompletion`, `whenDone`, `onReady`, `subscribe` communicate intent without exposing the primitive.
- If your library has both a low-level and a high-level API, document them as such; do not let users wander into the low-level one by accident.
- Wherever you use a condvar internally, write a comment explaining what predicate it is associated with and why broadcast/signal was chosen.

---

## Best Practices

1. **Default to channels/futures/queues in your APIs.** Make the user write a condvar only as a last resort.
2. **Encode the predicate in the type.** `Future<V>` has predicate "result is set". `Latch` has predicate "count is zero". `Semaphore` has predicate "permits > 0".
3. **Document the wait semantics.** "Blocks until X. May be interrupted. Returns false on timeout." Three sentences, every blocking method.
4. **Prefer `Lock + Condition` over `Object.wait/notify` in Java** when you need multiple condition variables per lock or fairness.
5. **Use `Phaser` over hand-rolled barriers.** It handles dynamic parties, hierarchical phasing, and termination correctly.
6. **In Go, default to channels.** Reach for `sync.Cond` only after explicit justification.
7. **In Rust, default to `mpsc` or `crossbeam`.** Reach for `Condvar` only inside library implementations.
8. **Provide cancellation everywhere.** `Future` should support `cancel()`. `Latch` should support `await(timeout)`. `Channel` should support `select` with context.
9. **Code review: flag every `sync.Cond` or `Condvar` use as a discussion point.** Most should be replaced; some are appropriate; you want the team to talk about each one.
10. **Teach the discipline.** When you mentor juniors, walk them through Mesa semantics before they touch a condvar. The investment pays for itself.

---

## Edge Cases & Pitfalls

- **Future combinators.** `CompletableFuture.allOf` and friends do the right thing, but their failure semantics differ. Read carefully.
- **Cancellation in latches.** `CountDownLatch` cannot be cancelled. A late-arriving thread will block forever if `countDown` was never called the right number of times. Always pair with a timeout in production.
- **Phaser termination.** A `Phaser` terminates automatically when its registered parties drop to zero. Forgetting to deregister can leave a `Phaser` open forever.
- **Channel buffering.** A buffered channel hides a condvar-like mechanism. An unbuffered channel is a direct rendezvous. The choice matters for backpressure.
- **Promise resolution.** Resolving a promise twice (in JavaScript) silently ignores the second call. Resolving with an exception then resolving with a value silently ignores the value. Library users need to know.

---

## Common Mistakes

- **Choosing `Object.notify` in Java when you should choose `notifyAll`.** Subtle and dangerous because it works in tests.
- **Building a barrier by hand instead of using `CyclicBarrier`.** Almost always gets the reset wrong on the first attempt.
- **Using a condvar to signal a single event.** Use a `CountDownLatch(1)` or a `CompletableFuture<Void>` instead.
- **Exposing a condvar in a public API and calling it "advanced".** Users will not read the warning.
- **Calling `sync.Cond.Wait` without a lock held.** Panics at runtime in Go.
- **Resetting a `CountDownLatch` by creating a new one.** Other threads still hold the old reference.

---

## Tricky Points

- **AbstractQueuedSynchronizer (AQS) in Java** is a single implementation that backs `ReentrantLock`, `Semaphore`, `CountDownLatch`, `ReentrantReadWriteLock`, and `FutureTask`. Understanding AQS is the bridge between knowing how to use these primitives and knowing how to build new ones.
- **Mesa semantics interact with priority inversion.** A high-priority thread waiting on a condvar can be blocked indefinitely if a low-priority thread holds the associated lock and is preempted. Real-time systems address this with priority inheritance protocols.
- **The "fairness" parameter on `ReentrantLock` and `Semaphore`** is a property of the lock, not the condition variable. Fair locks serve waiters in FIFO order; unfair locks may starve.
- **Spurious wakeups in Java vs Pthreads.** Java's spec explicitly allows spurious wakeups on `Object.wait`. Pthreads' spec also allows them. Both because the underlying futex implementation occasionally produces them. Always loop.
- **The "monitor invariant".** In a well-designed monitor, the protected state always satisfies some invariant when no thread is inside. Procedures may temporarily violate the invariant during execution but restore it before exiting or before waiting on a condition. This is the property Hoare's signal-and-wait was designed to preserve directly; Mesa-style monitors achieve it through the loop-around-wait discipline.

---

## Test Yourself

1. Why did Mesa semantics win over Hoare semantics? Give three reasons.
2. What is the predicate associated with `CountDownLatch.await()`? Why is no explicit loop needed in user code?
3. When a Java engineer reaches for `Object.wait`/`notify`, what should you ask them to consider instead?
4. Why does Go's standard library suggest channels over `sync.Cond`?
5. What does `Phaser.arriveAndAwaitAdvance()` do that `CyclicBarrier.await()` does not?
6. Implement a `Future<T>` API on top of `ReentrantLock` and `Condition`. What is your predicate? Do you signal or broadcast on completion?
7. In a Hoare-style monitor, what happens to the signaler when it calls `signal` on a non-empty queue?
8. Why are spurious wakeups acceptable in Mesa semantics but would break a Hoare-style monitor?

---

## Tricky Questions

1. "If Hoare semantics is provably simpler, why didn't it survive?" — Because it imposes a context-switch cost on every signal, requires implementations to deliver exact wakeups (no spurious), and does not compose with timeouts or interrupts. Mesa was a pragmatic engineering win even though it is a theoretical step backward.
2. "Should our internal config library expose a condvar to clients?" — Almost certainly not. Use a `CompletableFuture<Config>` for "wait for config to load" or a callback subscription model for "notify me when config changes". The condvar is an implementation detail.
3. "Why does `notifyAll` exist if it is usually wasteful?" — Because Java's `Object` monitor has only one condition variable. If multiple distinct predicates share that condition variable (e.g., `notFull` and `notEmpty` in a bounded buffer), only `notifyAll` is correct. If you can refactor to multiple `Condition` objects, you can use `signal`.
4. "When is `sync.Cond` actually correct in Go?" — When you need broadcast wakeup to a dynamic set of waiters that share state with the broadcaster and cannot be modeled as channel receivers. Real cases: some custom connection pools, some condition-based throttles, some sophisticated worker pool designs.
5. "How do you migrate a public API from condvar-based to channel-based without breaking users?" — Introduce the channel-based API as v2 alongside v1; deprecate v1; provide a compatibility shim that bridges the two; remove v1 in a major version bump. Document the rationale honestly.
6. "What's the difference between an `Exchanger` and a `SynchronousQueue` of size zero?" — Functionally close. `Exchanger` is two-way: both threads bring a value and both receive one. `SynchronousQueue` is one-way. Both are condvar-backed.
7. "What goes wrong if you call `Future.cancel(true)` while a downstream future is chained?" — Depends on the runtime. Java's `CompletableFuture` does not propagate cancellation by default. This is a well-known foot-gun and the answer is "use `whenComplete` to install your own cancellation propagation".

---

## Cheat Sheet

```text
WHEN DESIGNING A LIBRARY

Need: "wait for one event"        -> CompletableFuture<V> or Promise
Need: "wait for N to finish"      -> CountDownLatch
Need: "synchronize N threads"     -> CyclicBarrier or Phaser
Need: "limit concurrent access"   -> Semaphore
Need: "produce/consume"           -> BlockingQueue or Channel
Need: "two-thread handoff"        -> Exchanger or SynchronousQueue
Need: "custom predicate"          -> Condition / Condvar  (last resort)


WHEN REVIEWING CODE

See: sync.Cond in Go              -> ask "why not a channel?"
See: Object.wait in new Java      -> ask "why not Future/Latch/Queue?"
See: notify without notifyAll     -> verify only one waiter can proceed
See: wait without while-loop      -> reject
See: lock held across long IO     -> reject
See: condvar as event flag        -> suggest atomic + futex or future


MESA SEMANTICS RULES

1. Always loop around wait, re-checking the predicate.
2. signal/notify is a hint, not a guarantee.
3. Spurious wakeups are real; assume they happen.
4. Hold the lock when calling wait and when calling signal.
```

---

## Summary

Condition variables are the engine room of every higher-level coordination primitive in modern systems. They came out of Hoare's 1974 monitor paper and Brinch Hansen's parallel work, and they reached their modern shape in 1980 when Lampson and Redell described Mesa's pragmatic signal-and-continue semantics. Mesa's choices — looser delivery, predicate re-check, spurious wakeups allowed — won everywhere, and every mainstream system since has followed.

At the professional level, condition variables are a primitive for library authors. They should rarely appear in application code, and they should almost never appear in public APIs. Instead, expose futures, channels, queues, latches, barriers, semaphores — abstractions that encode the wait discipline in their types and method shapes. Java's `java.util.concurrent` package is the canonical example: it ships dozens of high-level primitives, all condvar-backed underneath, almost none of which require the user to know what a condition variable is.

When mentoring, your job is to redirect. A junior reaching for `sync.Cond` in Go, `Object.wait` in Java, or `threading.Condition` in Python is almost always reaching for the wrong tool. Walk them through the alternatives. Make them justify why a channel, a future, or a latch would not work. Most of the time, one of them will work. The cases where a condvar is actually correct are real but rare, and worth handling on their merits.

---

## What You Can Build

- A connection pool with timeout-aware acquire and graceful shutdown.
- A multi-stage data pipeline using `Phaser` for stage synchronization.
- A graceful start coordinator using `CountDownLatch` pairs.
- A custom future library on top of `ReentrantLock` and `Condition`.
- A high-level event bus that hides all condvar machinery from subscribers.
- A library API design document that justifies every primitive choice.
- A code-review checklist for synchronization primitives in your team's main language.

---

## Further Reading

- C.A.R. Hoare. "Monitors: An Operating System Structuring Concept." Communications of the ACM, October 1974. The foundational paper. Read it once for the ideas, once for the proofs.
- B. Lampson and D. Redell. "Experience with Processes and Monitors in Mesa." Communications of the ACM, February 1980. The pragmatic counterpoint that defined the modern era.
- Per Brinch Hansen. "The Origin of Concurrent Programming." Springer, 2002. A historical collection including Brinch Hansen's own monitor work.
- Doug Lea. "Concurrent Programming in Java: Design Principles and Patterns." Addison-Wesley. The book that defined how to use Java's monitors well.
- Brian Goetz et al. "Java Concurrency in Practice." Addison-Wesley, 2006. Chapters on `java.util.concurrent` and AQS are essential.
- Maurice Herlihy and Nir Shavit. "The Art of Multiprocessor Programming." Morgan Kaufmann. Treats monitors, condition variables, and lock-free alternatives together.
- The Go blog: "Share Memory By Communicating." Explains why Go prefers channels.
- Rust API documentation for `std::sync::Condvar` and `crossbeam::channel`. Read the rationale sections.

---

## Related Topics

- [Mutexes](../02-mutexes/README.md) — the lock condition variables sit on.
- [Semaphores](../04-semaphores/README.md) — a counting-condvar abstraction.
- [Channels](../../03-coordination/01-channels/README.md) — the CSP alternative.
- [Futures and Promises](../../03-coordination/02-futures/README.md) — the wait-for-result abstraction.
- [Latches and Barriers](../../03-coordination/03-latches-barriers/README.md) — counting-condvar conveniences.
- [Memory Models](../../01-foundations/04-memory-model/README.md) — what the lock release in wait actually guarantees.

---

## Diagrams & Visual Aids

```text
Hoare semantics: signal-and-wait

  Signaler                  Waiter
  ----------                ----------
  hold lock
  signal()         --->     resumes
  (suspended)               does work
                            leave()
  resumes        <---
  leave()


Mesa semantics: signal-and-continue

  Signaler                  Waiter
  ----------                ----------
  hold lock
  signal()         --->     (marked runnable)
  continue
  leave()
                            acquires lock
                            re-checks predicate
                            (maybe waits again)
                            does work
                            leave()
```

```text
Layered coordination stack

  +---------------------------------------------+
  | Application:                                |
  |   request handlers, pipelines, schedulers   |
  +---------------------------------------------+
  | Structured primitives:                      |
  |   Future, Channel, Queue, Latch, Barrier    |
  +---------------------------------------------+
  | Low-level primitives:                       |
  |   Mutex, ConditionVariable, Semaphore       |
  +---------------------------------------------+
  | Atomics & memory fences                     |
  +---------------------------------------------+
  | Hardware: CAS, LL/SC, MESI                  |
  +---------------------------------------------+
```

```text
Decision flowchart for library API design

   user task: wait for something
            |
            v
   is the predicate fixed?
       |              |
       yes            no
       |              |
       v              v
   pick a struct      consider:
   primitive          - condvar (last resort)
   (Future, Latch,    - parameterized waiter
    Queue, etc.)      - polling loop
                      - rethink the API
```

```text
Java j.u.c hierarchy, condvar-backed

   AbstractQueuedSynchronizer (AQS)
        |
        +---- ReentrantLock --> Condition (1+ per lock)
        |
        +---- Semaphore (counting permits)
        |
        +---- CountDownLatch (one-shot count to zero)
        |
        +---- ReentrantReadWriteLock (read/write modes)
        |
        +---- FutureTask (Future<V> backing)
```
