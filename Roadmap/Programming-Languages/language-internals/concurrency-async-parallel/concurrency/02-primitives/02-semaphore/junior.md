# Semaphore — Junior Level

> **Topic:** [Semaphore](README.md)
> **Focus:** P/V, counting vs binary, permits

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Clean Code](#clean-code)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Common Mistakes](#common-mistakes)
- [Tricky Points](#tricky-points)
- [Test Yourself](#test-yourself)
- [Tricky Questions](#tricky-questions)
- [Cheat Sheet](#cheat-sheet)
- [Summary](#summary)
- [What You Can Build](#what-you-can-build)
- [Further Reading](#further-reading)
- [Related Topics](#related-topics)
- [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

A **semaphore** is one of the oldest and most surprisingly useful tools in
concurrent programming. Strip away the jargon and you have something tiny:
an integer counter with two atomic operations. Yet that small object solves
problems that a plain mutex cannot — limiting the number of threads inside a
section, coordinating producers and consumers, modelling a pool of
interchangeable resources, throttling outgoing requests, signalling that an
event has happened.

Edsger Dijkstra introduced the semaphore in 1965 while designing the THE
multiprogramming system. He needed a primitive richer than busy-waiting but
simpler than full message passing. The result was an integer with two
operations he called **P** (Dutch *passeer* / *prolaag*, "try to pass" or
"try to decrement") and **V** (*vrijgeven*, "release"). Sixty years later
the names have changed — `wait`/`signal`, `acquire`/`release`,
`down`/`up` — but the semantics are identical, and almost every modern
language ships some flavour of semaphore.

This junior-level chapter teaches you to:

- Read and write the two operations of a semaphore confidently.
- Distinguish a **binary semaphore** from a **counting semaphore**.
- Spot when a problem is asking for "N permits" rather than "exclusive
  access".
- Build classic patterns: rate limiter, bounded worker pool, bounded buffer.
- Avoid the three or four foot-guns that bite every beginner.

You should leave this page feeling comfortable saying: *"That problem is a
counting semaphore with N permits; I will model it as a `chan struct{}` of
size N (or `Semaphore(N)` in Java/Python, or `sem_t` in C)."*

We will keep the tone practical. Each idea is followed by a short, runnable
program. Theory only appears when it explains a behaviour you can observe.

---

## Prerequisites

Before reading on, you should be comfortable with:

- **Threads or goroutines**: how to spawn one, how to wait for it to finish.
- **Race conditions and the need for atomicity**: why two threads writing
  to a counter without protection produces wrong results.
- **Mutex basics**: what `lock` / `unlock` does, why exclusive access matters.
  We will compare semaphore and mutex repeatedly, so a working mental model
  of a mutex is helpful. See [`../01-mutex/junior.md`](../01-mutex/junior.md).
- **Basic queueing intuition**: when a thread cannot proceed, it waits in a
  queue maintained by the scheduler.
- **One systems language**: C or Go is enough. Examples appear in C
  (POSIX), Java, Python and Go; you only need to follow one.

You do **not** need to know condition variables, monitors, or memory
ordering for this chapter. Those belong to the middle and senior levels.

---

## Glossary

| Term | Meaning |
| --- | --- |
| **Semaphore** | An integer counter with two atomic operations: `wait` (decrement, block if zero) and `signal` (increment, wake one waiter). |
| **P / wait / acquire / down** | The decrement operation. If the counter is positive, decrement and return. If zero, block until another thread increments it. |
| **V / signal / release / up** | The increment operation. Adds one to the counter; if a thread is waiting, wake exactly one. Never blocks. |
| **Binary semaphore** | A semaphore whose counter is restricted to 0 or 1. Looks like a mutex but lacks ownership. |
| **Counting semaphore** | A semaphore whose counter can take any non-negative value. Models "N copies of a resource". |
| **Permit** | One unit of the semaphore's capacity. "Acquiring a permit" means decrementing the counter; "releasing a permit" means incrementing it. |
| **Blocking** | A thread that cannot proceed is suspended by the kernel/runtime and removed from the run queue until something wakes it. It does **not** spin. |
| **Dijkstra** | Edsger W. Dijkstra (1930–2002), Dutch computer scientist who introduced semaphores in 1965 in *Cooperating Sequential Processes*. |
| **Producer / Consumer** | Classic pattern: one or more threads add items to a buffer, one or more threads remove them. The canonical semaphore example. |
| **Bounded buffer** | A queue with a fixed maximum size. Producers wait when full; consumers wait when empty. |
| **Mutex (recap)** | Mutual exclusion lock with **ownership**: only the thread that locked may unlock. A binary semaphore lacks this rule. |

Keep this table handy; the rest of the chapter assumes these terms.

---

## Core Concepts

### 1. The counter plus two operations

At its heart, a semaphore is just this:

```text
struct Semaphore {
    int    counter;       // current number of available permits
    Queue  waiters;       // threads blocked in wait()
}

wait(s):       // also called P, acquire, down
    atomically:
        while s.counter == 0:
            put current thread on s.waiters; sleep
        s.counter -= 1

signal(s):     // also called V, release, up
    atomically:
        s.counter += 1
        if s.waiters is non-empty:
            wake one waiter
```

Notice four things:

1. The operations are **atomic** — internally the runtime or kernel uses a
   spinlock plus the scheduler's wait queue, but from your code's point of
   view, nothing can interleave between "test" and "decrement".
2. `wait` may block. `signal` never blocks; it always returns immediately.
3. The thread that signals does **not** have to be the same thread that
   waited. This is the single biggest difference from a mutex.
4. The counter is **non-negative** in classic Dijkstra semantics. Some
   variants allow negative counters (the magnitude tells you how many
   waiters there are), but the semantics are the same.

### 2. Dijkstra's 1965 origin

Dijkstra's 1965 paper *Cooperating Sequential Processes* invented the
semaphore to solve two problems:

- **Mutual exclusion** of a critical section between cooperating processes.
- **Condition synchronisation** — making process B wait until process A
  has done something.

He wanted a primitive that the operating system could implement once, that
user programs could combine to build any synchronisation pattern they
needed. The names P and V are mnemonics in Dutch. In English we usually
say *wait* and *signal*, or *acquire* and *release*.

A small piece of trivia: the semaphore was originally a hardware-flag
metaphor — railway signals that say "track free" (raise flag, allow
through) or "track busy" (lower flag, halt). The integer counter
generalised that to N parallel tracks.

### 3. Binary semaphore vs counting semaphore

A **binary semaphore** is initialised to 1, and protocol prevents the
counter from ever exceeding 1. Used like:

```text
binary_sem = Semaphore(1)

wait(binary_sem)
    // critical section
signal(binary_sem)
```

This works as mutual exclusion. Some POSIX systems even ship a separate
`sem_t` flavour for this.

A **counting semaphore** is initialised to any N ≥ 0:

```text
slots = Semaphore(3)   // up to 3 threads inside at once

wait(slots)
    // do work that competes for a limited resource
signal(slots)
```

This is **not** mutual exclusion. It is "at most N threads at once". That is
a fundamentally different pattern — and one you cannot build cleanly from a
single mutex.

### 4. Difference from a mutex: ownership

This is the single most confusing point for beginners. A mutex tracks an
**owner**: the thread that called `lock` is the only thread allowed to
call `unlock`. Many runtimes panic or throw if you violate that.

A semaphore tracks **nothing of the sort**. Any thread can call `signal`,
even if it never called `wait`. This is a feature, not a bug, because it is
exactly what allows semaphores to express signalling: thread A reaches a
milestone and calls `signal` on a semaphore that thread B is waiting on.

But it has a dark side: if you use a binary semaphore as a "mutex" and
forget the ownership rule, the compiler will not save you. A buggy
`signal` from the wrong thread silently lets two threads into the critical
section.

> Rule of thumb: **mutual exclusion → mutex. Signalling or limiting
> concurrency → semaphore.**

### 5. "N permits" — controlling concurrency

The mental model that makes semaphores click is **permits**. The
semaphore is a coat-check holding N tickets. To do the protected work you
must hold a ticket. Tickets are taken with `wait`, returned with `signal`.

This is exactly what you want when:

- You have N database connections and want to cap concurrent queries.
- You have N parking spots and want to refuse new cars until one leaves.
- You want to limit outgoing HTTP requests to 10 in flight at once.
- You want a worker pool of fixed size.

Notice that "permits" has no notion of *which* permit you hold. They are
interchangeable. If the resources behind the permits are *not*
interchangeable (e.g. connection #3 is bound to user X), a semaphore is the
wrong tool — you need a pool with identity tracking.

### 6. Bounded buffer with two semaphores plus a mutex

The classic textbook example: producers add items, consumers remove items,
buffer has fixed capacity N.

```text
empty  = Semaphore(N)   // permits = empty slots available to producers
full   = Semaphore(0)   // permits = filled slots available to consumers
mutex  = Mutex()        // protects the buffer data structure

producer:
    wait(empty)         // wait for an empty slot
    lock(mutex)
        buffer.push(item)
    unlock(mutex)
    signal(full)        // tell consumers an item is ready

consumer:
    wait(full)          // wait for a filled slot
    lock(mutex)
        item = buffer.pop()
    unlock(mutex)
    signal(empty)       // tell producers a slot is free
```

Two things to appreciate:

- The two semaphores express the two *conditions* (not empty, not full).
  The mutex protects the *data*.
- The producer signals `full`; the consumer signals `empty`. They release
  each other's semaphores. Try writing this with only a mutex and a
  condition variable — it works but is wordier and easier to get wrong.

### 7. Common confusions

- **"A semaphore is just a fancy mutex."** No. A mutex enforces
  exclusivity *with ownership*. A semaphore counts permits *without
  ownership*. Their intended use cases overlap only at N=1, and even there
  a mutex is usually safer.
- **"A binary semaphore is identical to a mutex."** Behaviourally similar
  for the simple case; semantically different because of ownership.
- **"`signal` wakes everyone."** No. `signal` increments the counter by 1
  and wakes exactly one waiter. To wake many, call `signal` many times.
- **"Order is guaranteed."** Classic semaphores do not promise FIFO. Many
  implementations approximate it; some explicitly offer a *fair* mode.

---

## Real-World Analogies

### Parking lot with N spaces

A multi-storey car park advertises "10 spaces available" on a sign at the
entrance. Each entering car decrements the sign (waits/acquires a permit);
each leaving car increments it (signals/releases). When the sign reads 0,
new cars queue at the gate until one leaves. Nothing about the protocol
cares *which* space a car parked in: the spaces are interchangeable.

That is a counting semaphore initialised to 10.

### Taxi stand with one taxi

A village taxi rank has exactly one taxi. When a customer takes the taxi,
the slot is empty (counter = 0). Other customers wait in line. When the
taxi returns, the slot fills (counter = 1) and one waiting customer takes
it. The driver does not care who hails him; any waiting customer is fine.

That is a binary semaphore — and unlike a real "mutex" where the same
driver returns the car, anyone in the village could in principle drive the
taxi back.

### Library with multiple copies of a book

The library owns three identical copies of *Operating Systems Concepts*.
Three students can read concurrently. A fourth student must wait until one
copy is returned. Books are interchangeable; the librarian does not track
which copy a student has, only the count.

That is a counting semaphore with capacity 3 — and yes, the same student
who borrowed does not have to be the one to return: a friend could hand it
back. The library is happy. A real `Mutex` would refuse the friend.

### Stadium turnstile

A football stadium issues 50 000 tickets. Each entering fan decrements the
count; each leaving fan increments it. Once 50 000 are inside, the
turnstiles freeze. Fans outside form a queue and are admitted as space
opens.

This is exactly the **rate limiter** pattern at human scale.

---

## Mental Models

Pick whichever of these clicks for you:

1. **A bag of N coins.** `wait` takes a coin; `signal` puts a coin back.
   If the bag is empty, you wait by the bag until someone drops a coin in.

2. **A counter with a queue glued to it.** When the counter hits 0, new
   `wait` callers join the queue. When `signal` brings the counter to 1
   and a queue exists, the runtime pops one waiter from the queue and
   atomically gives them the permit (counter stays 0; the woken thread
   "absorbs" the permit).

3. **A bounded channel.** Sending fills a slot, receiving empties one. A
   buffered channel of capacity N with empty-struct values is a semaphore
   in disguise — and that is exactly the Go idiom we will show.

4. **A traffic light with N green permits.** Each arrival takes a green;
   when greens are exhausted, the light turns red. Departures hand back a
   green. The departures do not need to be the same cars that took them.

5. **A coat-check stub.** You receive a numbered stub on entry, surrender
   it on exit. But here, anyone with a stub can return it.

---

## Code Examples

The examples below are intentionally minimal so you can run them quickly.
They share one shape: spawn N workers, have them contend for a semaphore
that admits at most K concurrent winners, observe that at most K are
"inside" at any moment.

### Example 1 — POSIX `sem_t` rate limiter in C

This program creates ten threads and a counting semaphore with three
permits. Each thread sleeps for a moment to simulate "doing work" while
holding a permit. You will see at most three threads "inside" at once.

```c
// build: cc -pthread sem_demo.c -o sem_demo && ./sem_demo
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <pthread.h>
#include <semaphore.h>

#define WORKERS 10
#define PERMITS 3

static sem_t slots;

static void *worker(void *arg) {
    long id = (long)arg;

    sem_wait(&slots);                  // acquire a permit (P)
    printf("worker %ld: entered\n", id);
    sleep(1);                          // simulate work
    printf("worker %ld: leaving\n", id);
    sem_post(&slots);                  // release a permit (V)

    return NULL;
}

int main(void) {
    if (sem_init(&slots, 0, PERMITS) != 0) {
        perror("sem_init");
        return 1;
    }

    pthread_t threads[WORKERS];
    for (long i = 0; i < WORKERS; i++) {
        pthread_create(&threads[i], NULL, worker, (void *)i);
    }
    for (int i = 0; i < WORKERS; i++) {
        pthread_join(threads[i], NULL);
    }

    sem_destroy(&slots);
    return 0;
}
```

Things to notice:

- `sem_init(&slots, 0, PERMITS)`: the middle `0` means "thread-shared, not
  process-shared". The `3` is the initial counter.
- `sem_wait` is P; `sem_post` is V. Yes, the POSIX name `sem_post` is
  irritating, but it is the V operation.
- `sem_wait` can be interrupted by a signal and return `EINTR`. Production
  code wraps it in a retry loop. We omitted that for clarity.

### Example 2 — Java `Semaphore` for bounded concurrent jobs

`java.util.concurrent.Semaphore` is the canonical reference implementation
in any teaching context. It supports both a non-fair (default) and a fair
mode. Same shape as the C example.

```java
// javac SemDemo.java && java SemDemo
import java.util.concurrent.Semaphore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class SemDemo {
    private static final int WORKERS = 10;
    private static final int PERMITS = 3;
    private static final Semaphore slots = new Semaphore(PERMITS);

    public static void main(String[] args) throws InterruptedException {
        ExecutorService pool = Executors.newFixedThreadPool(WORKERS);

        for (int i = 0; i < WORKERS; i++) {
            final int id = i;
            pool.submit(() -> {
                try {
                    slots.acquire();                       // P
                    System.out.println("worker " + id + ": entered");
                    Thread.sleep(1000);
                    System.out.println("worker " + id + ": leaving");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    slots.release();                       // V
                }
            });
        }

        pool.shutdown();
        pool.awaitTermination(1, TimeUnit.MINUTES);
    }
}
```

Notice the `try { acquire } finally { release }` pattern. **Always**
release in a `finally` block — if the protected work throws, you must not
leak the permit.

### Example 3 — Python `threading.Semaphore`

Python's standard library exposes both a `Semaphore` and a
`BoundedSemaphore`. The bounded version raises a `ValueError` if you
release more often than you acquire — which catches the "extra release"
bug we discuss in Edge Cases.

```python
# python sem_demo.py
import threading
import time

WORKERS = 10
PERMITS = 3

slots = threading.BoundedSemaphore(PERMITS)

def worker(i: int) -> None:
    with slots:                       # acquire on enter, release on exit
        print(f"worker {i}: entered")
        time.sleep(1)
        print(f"worker {i}: leaving")

threads = [threading.Thread(target=worker, args=(i,)) for i in range(WORKERS)]
for t in threads:
    t.start()
for t in threads:
    t.join()
```

The `with slots:` form is the Pythonic equivalent of `try/finally`. The
semaphore is acquired on entry and released on exit, even if the block
raises.

### Example 4 — Go "semaphore as channel"

Go does not ship a `Semaphore` type in the standard library. Idiomatic Go
uses a buffered channel of empty structs. The capacity is the permit count;
sending is `wait`, receiving is `signal`.

```go
// go run sem_demo.go
package main

import (
	"fmt"
	"sync"
	"time"
)

const (
	workers = 10
	permits = 3
)

func main() {
	slots := make(chan struct{}, permits)
	var wg sync.WaitGroup

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			slots <- struct{}{}             // acquire (P)
			fmt.Printf("worker %d: entered\n", id)
			time.Sleep(time.Second)
			fmt.Printf("worker %d: leaving\n", id)
			<-slots                         // release (V)
		}(i)
	}

	wg.Wait()
}
```

Reading this for the first time, it looks backwards. Remember: a buffered
channel with capacity N blocks the sender once N values are unread. So
"send" is "take a permit"; "receive" is "give a permit back". The channel
is a perfectly serviceable counting semaphore with built-in blocking.

For a fancier API, the `golang.org/x/sync/semaphore` package wraps this
into an explicit `Acquire(ctx, n)` / `Release(n)` interface, including
weight-based acquisitions. The channel idiom is more common in everyday
code.

---

## Pros & Cons

### Pros

- **Models N-permit concurrency directly.** No mental gymnastics needed
  to express "at most 8 in flight".
- **Cross-thread signalling.** Producer signals, consumer waits — clean.
- **Tiny conceptual surface.** Two operations and a counter; you can
  implement one in an afternoon if you have atomics and a wait queue.
- **Ubiquitous.** Every mainstream language ships a semaphore (or its
  channel-based equivalent).
- **Composable.** Two semaphores plus a mutex give you a bounded buffer.
  More semaphores express more complex synchronisation.

### Cons

- **No ownership tracking.** Releasing a permit you never acquired
  compiles cleanly. The runtime cannot catch this for you.
- **Easy to leak a permit.** If the protected work panics and you forgot
  the `finally`/`defer`, the counter drops by one *permanently* and the
  system slowly grinds to a halt.
- **No re-entrance.** Calling `wait` twice from the same thread will
  block forever if there is only one permit. Mutexes sometimes offer a
  re-entrant flavour; semaphores do not, because "same thread" is not even
  a concept the semaphore tracks.
- **Order is not guaranteed.** Vanilla semaphores can starve waiters.
  Fair mode helps but at performance cost.
- **Easy to mis-use as a mutex.** Beginners reach for a binary semaphore
  when a mutex is correct. The code looks the same; the bug surface is
  different.

---

## Use Cases

A semaphore is the right answer when one of these patterns matches:

1. **Rate-limit concurrent work.** "At most N goroutines may call this
   external API at once." `chan struct{}` of size N.
2. **Bounded worker pool.** "At most N HTTP handlers can run database
   queries in parallel." Counting semaphore = pool size.
3. **Bounded buffer / producer-consumer.** Two semaphores (`empty`,
   `full`) plus a data mutex.
4. **Event signalling, one-shot.** Initialise semaphore at 0. The
   signaller calls `signal` once; the waiter wakes. This is a *one-shot
   event* — slightly clunkier than dedicated `Event`/`WaitGroup` but works.
5. **Throttling external calls.** "I am allowed 100 outgoing TCP
   connections." Counting semaphore guarding the dial.
6. **Limiting memory or CPU pressure.** A counting semaphore expressing
   "at most M megabytes of in-flight uploads" approximates back-pressure.
7. **Coordinating start of a batch.** Initialise to 0, the leader signals
   N times when ready, N followers each `wait` once.

A semaphore is **not** the right answer when:

- You need exclusive access to a single resource → use a mutex.
- The resources have identity → use a pool with explicit checkout/return.
- You need RAII safety in C++ → wrap, or use `std::counting_semaphore` with
  a guard.
- You need broadcast wake (one event, many waiters at once) → use a
  condition variable or a `WaitGroup`/barrier.

---

## Coding Patterns

### Pattern 1 — Acquire / release with `finally` or `defer`

The single most important pattern. The release **must** run whether the
work succeeds or panics.

```java
slots.acquire();
try {
    doWork();
} finally {
    slots.release();
}
```

```go
slots <- struct{}{}
defer func() { <-slots }()
doWork()
```

```python
with slots:
    do_work()
```

### Pattern 2 — Bounded fan-out

Spawn many workers, cap the number running at once.

```go
sem := make(chan struct{}, 8)
var wg sync.WaitGroup
for _, item := range items {
    wg.Add(1)
    sem <- struct{}{}                  // wait for a permit
    go func(it Item) {
        defer wg.Done()
        defer func() { <-sem }()       // release
        process(it)
    }(item)
}
wg.Wait()
```

Notice that `sem <- struct{}{}` happens in the **caller** before the
goroutine is spawned. That means we limit not just concurrent execution
but also goroutine creation — useful when items is huge.

### Pattern 3 — Two semaphores for bounded buffer

```text
empty = N        // empty slots
full  = 0        // filled slots
mutex = 1        // protects the buffer
```

Producers: `wait(empty) → lock(mutex) → push → unlock(mutex) → signal(full)`.
Consumers: `wait(full) → lock(mutex) → pop → unlock(mutex) → signal(empty)`.

The two semaphores carry the *availability* signals; the mutex carries
*mutual exclusion* on the data.

### Pattern 4 — One-shot signal (event)

```python
done = threading.Semaphore(0)

def worker():
    do_long_thing()
    done.release()        # signal completion

threading.Thread(target=worker).start()
done.acquire()            # wait for worker
print("worker finished")
```

Crude but works. A dedicated event primitive is cleaner, but this is the
fallback when none is available.

### Pattern 5 — Try-acquire / non-blocking attempt

Most semaphores expose a non-blocking variant: `sem_trywait`, Java's
`tryAcquire`, Python's `acquire(blocking=False)`. Use it when you would
rather skip the work than wait.

```java
if (slots.tryAcquire()) {
    try { doWork(); } finally { slots.release(); }
} else {
    // skip or fall back
}
```

In Go you express the same with a `select` on a channel send:

```go
select {
case slots <- struct{}{}:
    defer func() { <-slots }()
    doWork()
default:
    // no permit available, skip
}
```

---

## Clean Code

- **Name the semaphore for what it counts.** `dbConnSlots`, `uploadPermits`,
  `apiQuota` — not `sem` or `s`.
- **Initialise where you declare.** Reduces the risk of forgetting the
  initial count. Counting semaphores with a "magic 1" hidden far from the
  declaration are an audit headache.
- **One acquire, one release, paired in the same function.** If acquire
  is in function A and release in function B, you have a maintenance
  hazard. Pass the semaphore explicitly and pair the operations.
- **Wrap in a helper.** A `with semaphore_guard(slots):` context manager
  or a `defer release()` is worth its weight.
- **Document the invariant.** Above the declaration write the rule:
  *"This semaphore caps concurrent uploads at MAX_UPLOADS."* Six months
  later you will thank yourself.

---

## Best Practices

1. **Pair every `wait` with exactly one `signal` on every code path.** Use
   `finally`/`defer`. No exceptions.
2. **Prefer the language's "with" / RAII form** if it exists. It removes
   the mistake from the equation.
3. **Use a bounded semaphore when available** (Python's
   `BoundedSemaphore`, similar wrappers elsewhere). It catches the
   "extra release" bug at the source.
4. **Choose fair mode when starvation matters.** Java's
   `new Semaphore(N, true)` queues waiters FIFO. Slightly slower; much
   more predictable under contention.
5. **Do not use a semaphore for mutual exclusion if a mutex will do.** Use
   the smaller, safer primitive.
6. **Document the permit count.** "Permits = max concurrent DB queries."
   Future readers must know what N means.
7. **Drain on shutdown.** When you tear down the system, ensure no
   threads are still parked in `wait`. Otherwise the program hangs.
8. **Avoid mixing waits and signals across many threads ad-hoc.** Keep
   the producer/consumer roles clear; semaphore code that crosses many
   modules becomes very hard to reason about.

---

## Edge Cases & Pitfalls

- **Forgetting to release on panic.** Classic permit leak. After enough
  panics the counter is permanently 0 and the system blocks forever.
- **Releasing more than you acquired.** A counting semaphore happily
  goes above its "initial" count. Future acquirers no longer block as
  expected, and your concurrency limit silently disappears. Use bounded
  semaphores when possible.
- **Calling `wait` twice from the same thread with capacity 1.** Permanent
  self-deadlock. Semaphores are not re-entrant.
- **Signal storms.** Calling `signal` in a tight loop wakes one waiter per
  signal, but if there are no waiters, the counter grows without bound.
  Bounded semaphores prevent this; classic ones do not.
- **Unfair scheduling.** Without fair mode, a freshly arrived waiter may
  jump ahead of long-parked ones if the runtime happens to schedule it
  first. Long-running services should opt into fair mode if any waiter has
  a deadline.
- **Wait inside lock.** If you call `wait` while holding a mutex that the
  signaller needs, you deadlock. Acquire the semaphore *outside* the
  mutex, or order locks carefully.
- **Signal-from-handler.** POSIX `sem_post` is *async-signal-safe*; you
  can call it from a signal handler. Most other primitives are not. This
  is occasionally why semaphores are the answer in low-level code.
- **EINTR on `sem_wait`.** POSIX may return early with `EINTR` after a
  signal. Production code retries; teaching code often forgets to.

---

## Common Mistakes

1. **Using a semaphore as a mutex.** Initialise to 1, treat as a lock,
   forget the ownership rule, get caught by a release from the wrong
   thread.
2. **Forgetting `finally` / `defer`.** Permit leak.
3. **Releasing on the error path but not the success path** (or vice
   versa). Asymmetric error handling is the most common source of leaks.
4. **Initialising the wrong number.** "I want at most 8 in flight" but
   you wrote `Semaphore(9)`. Easy off-by-one. Sanity-check by writing a
   test that asserts the maximum observed concurrency.
5. **Holding a permit across a long blocking operation that does not
   need it.** You bottleneck the system on permits for no reason.
6. **Using a single semaphore where two semaphores plus a mutex are
   needed** (the producer/consumer mistake). The single-semaphore
   solution either races or deadlocks.
7. **Assuming FIFO.** Then complaining about starvation. Either use fair
   mode or design around the lack of ordering.
8. **Mixing channel-based and `sync/semaphore` patterns in one Go
   program.** Both work; pick one per module.

---

## Tricky Points

- **What if `signal` is called with the counter already at maximum?**
  Unbounded semaphores increment anyway. Bounded ones throw. Pick the
  variant that matches your invariant.
- **What if a thread is cancelled (interrupted) while parked in `wait`?**
  Java throws `InterruptedException`; Python re-raises `KeyboardInterrupt`
  in some cases; Go using channels needs an explicit `select` with a
  `ctx.Done()` to be cancellable. Plain `sem_t` is not cancellable.
- **Does `signal` wake the longest-waiting thread?** Not guaranteed by
  spec. Fair mode in Java/Python promises FIFO; default mode does not.
- **Is `wait` interruptible by a signal handler in C?** Yes — returns
  `EINTR`. Wrap in a `do { rc = sem_wait(&s); } while (rc == -1 && errno
  == EINTR);` loop.
- **What about timeouts?** `sem_timedwait` (POSIX) and `tryAcquire(timeout,
  unit)` (Java) and `acquire(timeout=...)` (Python) all exist. Go uses a
  `select` with `time.After(...)`. Use timeouts on any acquire that could
  hang user-visible work.
- **What if the OS thread holding a permit dies abnormally?** The permit
  is lost. There is no recovery short of restarting the process or
  introducing a watchdog that re-balances permits.

---

## Test Yourself

Try these without rereading the chapter. Answers are deliberately omitted —
look them up in the text if you are unsure.

1. State the two operations of a semaphore and what each does.
2. What is the difference between a binary semaphore and a mutex?
3. What is a counting semaphore? Give two real-world examples.
4. Write pseudocode for `wait` and `signal` using an integer and a wait
   queue.
5. Explain why "at most 8 concurrent requests" is a semaphore problem,
   not a mutex problem.
6. In a producer/consumer with a bounded buffer, why do you need *two*
   semaphores and *one* mutex?
7. What is the failure mode if you forget to release a permit?
8. What is the failure mode if you release a permit you never acquired
   (in an unbounded semaphore)?
9. What does Java's "fair mode" buy you, and what does it cost?
10. Show, in your language of choice, the four-line idiom that ensures a
    permit is always released even on exception.

---

## Tricky Questions

1. *Can a semaphore initialised to 0 ever be useful?* Yes — as a one-shot
   signal. The signaller increments to 1; the waiter consumes it.
2. *What is the smallest semaphore that still blocks?* `Semaphore(0)`. Any
   `wait` blocks immediately until somebody signals.
3. *Can two threads simultaneously succeed in `wait` on `Semaphore(2)`?*
   They can succeed in parallel from the caller's view — the two atomic
   decrements are serialised internally but happen "instantaneously".
4. *Is it safe to call `signal` more times than there have been waiters?*
   Unbounded: yes, the counter rises. Bounded: no, raises an error.
5. *Why is `sem_post` named "post"?* Historical. Older POSIX drafts used
   `sem_post` for V to match notation in classic OS textbooks. Treat it
   as a synonym for `signal` / V.
6. *Do semaphores guarantee progress?* Only weakly. A thread that keeps
   missing the wakeup in non-fair mode can starve forever in theory.
7. *Can I use a `chan int` instead of `chan struct{}` for the Go idiom?*
   Yes, but `struct{}` carries zero bytes; it is the idiomatic "permit"
   value.
8. *Why does the empty struct `struct{}` work?* Go optimises sends and
   receives of zero-sized values: only the slot count changes, no copy
   happens. The channel is purely a counter with a wait queue — i.e., a
   semaphore.

---

## Cheat Sheet

```text
SEMAPHORE: counter + atomic wait()/signal()

  wait()    : counter -= 1; block if was 0
  signal()  : counter += 1; wake one waiter

INITIAL VALUE
  N=1  → binary semaphore (like mutex, but no ownership)
  N=K  → counting semaphore, K permits
  N=0  → one-shot signal (waiter blocks; signaller releases)

PATTERNS
  rate limiter         : Semaphore(MAX_CONCURRENT)
  worker pool          : Semaphore(POOL_SIZE)
  bounded buffer       : Semaphore(N)+Semaphore(0)+Mutex
  one-shot event       : Semaphore(0), one signal()

LANGUAGE MAP
  C/POSIX   : sem_t, sem_init, sem_wait, sem_post, sem_destroy
  Java      : java.util.concurrent.Semaphore, acquire/release
  Python    : threading.Semaphore, threading.BoundedSemaphore, with
  Go        : chan struct{} of size N, or golang.org/x/sync/semaphore

RULES
  1. acquire+release pair on every code path (finally/defer/with)
  2. counter is non-negative; releasing too often is a bug
  3. semaphore is NOT a mutex: no ownership, not re-entrant
  4. FIFO not guaranteed unless fair mode
  5. timeout-aware acquire variants exist; use them in user-facing code
```

---

## Summary

A semaphore is the simplest non-trivial synchronisation primitive: a
counter, plus `wait` (decrement, block at zero) and `signal` (increment,
wake one). With it you can:

- Implement mutual exclusion (binary semaphore — though a real mutex is
  usually preferable).
- Limit concurrency to **N permits** (counting semaphore — what mutexes
  *cannot* do directly).
- Coordinate producers and consumers with a bounded buffer.
- Express one-shot signalling and cross-thread waiting.

The biggest pitfall is that semaphores do not track ownership: releases
from the wrong thread compile cleanly, and forgotten releases leak permits
that the runtime never gets back. Pair every `wait` with a `signal` on
every exit path. Prefer language constructs (`with`, `finally`, `defer`)
that make pairing automatic.

Mentally model permits, not locks. When the problem statement contains
"at most N", "limit concurrent", "pool of K", or "wait for an item",
a semaphore (or its channel-shaped twin) is almost always the right tool.

---

## What You Can Build

After this chapter, you should be able to build:

- A **HTTP client wrapper** that caps the number of in-flight requests.
- A **file download manager** with N concurrent transfers.
- A **bounded job queue** with producer and consumer threads.
- A **rate-limited web scraper** that politely respects a concurrency cap.
- A **connection pool prototype** (toy, without identity tracking) that
  hands out and reclaims slots.
- A **bounded `chan`-style worker pool** in your favourite language.
- A **CLI batch processor** that fans out work across N workers and
  collects results, refusing to spawn more than N goroutines at a time.

These are all variations on the same theme: count something, cap it,
queue when full.

---

## Further Reading

- Dijkstra, E. W. *Cooperating Sequential Processes* (1965). The
  original paper; surprisingly readable.
- Silberschatz, Galvin, Gagne. *Operating System Concepts*. Chapter on
  synchronisation covers semaphores in textbook form, including
  bounded-buffer and readers-writers solutions.
- Tanenbaum, Bos. *Modern Operating Systems*. Same material, slightly
  different angle.
- Andrews, G. R. *Foundations of Multithreaded, Parallel, and
  Distributed Programming*. Many semaphore patterns worked out.
- Allen B. Downey. *The Little Book of Semaphores*. A free PDF entirely
  about semaphore puzzles, from beginner to advanced.
- POSIX manual pages: `sem_init(3)`, `sem_wait(3)`, `sem_post(3)`,
  `sem_timedwait(3)`.
- Java API documentation for `java.util.concurrent.Semaphore`.
- Python `threading` module docs, sections on `Semaphore` and
  `BoundedSemaphore`.
- Go's `golang.org/x/sync/semaphore` package documentation.

---

## Related Topics

- [Middle Level](middle.md) — fairness, starvation, condition variables vs
  semaphores, bounded-buffer correctness arguments.
- [Senior Level](senior.md) — implementing a semaphore from atomics and
  futexes, memory-ordering implications, weighted semaphores.
- [Professional Level](professional.md) — semaphore scaling under
  thousands of waiters, kernel costs, design trade-offs vs lock-free.
- [Interview Questions](interview.md) — typical semaphore questions and
  classic patterns.
- [Practice Tasks](tasks.md) — hands-on exercises building rate limiters,
  bounded buffers and pools.
- [Mutex — Junior](../01-mutex/junior.md) — the sibling primitive; learn
  when to pick which.
- [Channels — Junior](../05-channels/junior.md) — the Go idiom that *is* a
  semaphore in disguise.
- [Shared Memory Model — Junior](../../01-models/01-shared-memory/junior.md) —
  the broader concurrency model in which semaphores live.

---

## Diagrams & Visual Aids

### Counter view of a semaphore

```text
   Semaphore(3)

   permits: [ X X X . . ]    counter = 3, queue = []
            after 1 wait()
   permits: [ X X . . . ]    counter = 2

            after 3 more wait()s
   permits: [ . . . . . ]    counter = 0, queue = [T4]
                              T4 is blocked

            after 1 signal()
   permits: [ X . . . . ]    counter = 0
                              T4 woken, absorbs the permit
```

### Wait / signal flowchart

```text
        wait(s)                       signal(s)
        -------                       ---------
        counter > 0 ? --yes--> dec    inc counter
              |                       waiter? --yes--> wake one
              no                            |
              v                             no
        sleep in queue                 return
              ^                             |
              | (woken by signal)           v
              +-----------------------------+
```

### Bounded-buffer interaction

```text
        producer                       consumer
        --------                       --------
        wait(empty)                    wait(full)
        lock(mutex)                    lock(mutex)
        push item                      pop item
        unlock(mutex)                  unlock(mutex)
        signal(full)                   signal(empty)
```

### Semaphore in a permit lifecycle

```text
   issued ───────► held by thread T ───────► returned
     ▲                                          │
     │                                          │
     └──────────────────────────────────────────┘
                  (any thread may return;
                   semaphore tracks count only)
```

### Mental picture of "N permits"

```text
                  +-----------------------+
                  |    Counting Semaphore |
                  |       capacity = 4    |
                  +-----------------------+
                          |  |  |  |
                          v  v  v  v
                       [P1][P2][P3][P4]   (4 permits)

   threads waiting:    T9 T8 T7
                       ^^^^^^^^^
                       sleep in queue, woken
                       one-at-a-time by signal()
```

These pictures all encode the same invariant:

> The number of threads currently inside the protected region
> equals (initial count) minus (current counter), and never exceeds the
> initial count.

Hold that sentence in your head and most semaphore bugs become visible at
a glance.
