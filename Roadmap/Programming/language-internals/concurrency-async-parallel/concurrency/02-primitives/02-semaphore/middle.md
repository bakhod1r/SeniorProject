# Semaphore — Middle Level

> **Topic:** [Semaphore](README.md)
> **Focus:** fair semaphores, weighted, async, classic problems

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

At the junior level you learned the elevator pitch: a semaphore is a counter that gates access to a pool of permits. That mental model is enough to write a worker pool or a connection limiter, but it stops being enough the moment two threads start racing for the last permit, or the moment your producer outruns your consumer, or the moment an exception leaks a permit and your service quietly drains until it deadlocks at 3 a.m.

This middle-level note picks up where the junior note left off. We treat the semaphore not as a single primitive but as a small family of related tools: counting, binary, fair, unfair, weighted, async. We study the three textbook problems that every concurrency course uses to teach semaphores — bounded buffer, readers-writers, and dining philosophers — because each one exposes a different failure mode (starvation, priority inversion, deadlock). We also look at how modern runtimes (Java, Python asyncio, Tokio, Go) implement semaphore semantics on top of their schedulers, and why the answer is rarely "just a counter."

By the end of this note you should be able to:

- Choose between a fair and an unfair semaphore based on workload characteristics.
- Use weighted permits to model heterogeneous resources.
- Implement a bounded buffer, a rate limiter, and a worker pool from scratch.
- Recognize the three classic deadlock scenarios and the standard fixes.
- Read async semaphore code in Python, Rust, and Go without confusion.
- Explain to a teammate why semaphores are "the assembly language of concurrency" — powerful, but easy to misuse.

The tone is practical. We assume you have written a few multi-threaded programs and have been bitten at least once by a deadlock. If `acquire` and `release` are still unfamiliar verbs, go back to the junior note first.

---

## Prerequisites

Before continuing, you should be comfortable with:

- **Junior semaphore note** — counting vs binary semaphores, `P/V` semantics, basic invariants.
- **Mutexes and condition variables** — you know the difference between mutual exclusion and signaling.
- **Thread basics** — creating threads, joining them, the meaning of "blocked" vs "runnable."
- **Producer-consumer intuition** — even informally, you know what a bounded queue is.
- **Async/await basics in at least one language** — Python, JavaScript, Rust, or C#. We will not teach the syntax, but we will use it.
- **Big-O thinking** — to reason about fairness and throughput trade-offs.

Helpful but not required: prior exposure to monitors (Hoare/Mesa), Petri nets, or formal verification tools like TLA+.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Permit** | One unit of capacity held by the semaphore. `acquire` consumes one; `release` returns one. |
| **Fair semaphore** | A semaphore that hands out permits in FIFO order of `acquire` calls. |
| **Unfair (barging) semaphore** | A semaphore where an arriving thread may steal a permit ahead of waiters. |
| **Weighted permit** | `acquire(N)` consumes N permits atomically; useful for variable-sized requests. |
| **Bounded buffer** | A fixed-capacity queue used to decouple producers and consumers. |
| **Rate limiter** | A mechanism that caps the number of operations per unit time. |
| **Worker pool** | A fixed set of workers (or a permit count) that bounds concurrency. |
| **Starvation** | A thread waits indefinitely because others keep cutting in front of it. |
| **Priority inversion** | A high-priority thread waits on a permit held by a low-priority thread. |
| **Async semaphore** | A semaphore whose `acquire` returns a future/coroutine instead of blocking a thread. |
| **Permit leak** | A bug where `release` is not called, permanently reducing capacity. |
| **Over-release** | Calling `release` more times than `acquire`, inflating capacity beyond intent. |
| **Barging** | An arriving thread acquires before queued waiters are unparked. |
| **Hand-off** | A scheduling policy where the released permit is given directly to a specific waiter. |
| **Semaphore-as-channel** | The Go pattern of using a buffered channel of size N as a counting semaphore. |

---

## Core Concepts

### 1. Fair vs Unfair Semaphores

A **fair semaphore** guarantees FIFO ordering: if thread A called `acquire` before thread B, A will receive a permit before B (assuming both are still waiting). An **unfair semaphore** makes no such promise; a thread that arrives at exactly the moment a permit is released may "barge" past the queue.

In Java:

```java
Semaphore fair    = new Semaphore(10, true);   // FIFO
Semaphore unfair  = new Semaphore(10, false);  // default, faster
```

Trade-offs:

- **Unfair is faster.** No queue management, no context switch when a barging thread can grab the permit. Higher throughput under contention.
- **Fair prevents starvation.** Under heavy load, a polite thread that always yields will never starve.
- **Fair has lower throughput.** Every release must hand off to the head of the queue, which means an extra wakeup and a guaranteed context switch.

Rule of thumb: prefer unfair for throughput-critical hot paths (connection pools, leaf-level rate limiters) where any thread's progress counts as forward progress. Prefer fair when each waiter represents a distinct customer whose latency matters individually (a per-tenant rate limiter where one noisy tenant must not starve a quiet one).

### 2. Weighted Permits

`acquire(N)` and `release(N)` let you treat the semaphore as a budget rather than a counter. Examples:

- A memory-bound job pool where each task declares its memory cost.
- A token-bucket rate limiter where a "big" request costs 10 tokens and a "small" one costs 1.
- A bandwidth limiter where each unit is a kilobyte.

Java exposes this directly:

```java
Semaphore budget = new Semaphore(1024); // 1024 KB
budget.acquire(128);                    // I need 128 KB
try { work(); }
finally { budget.release(128); }
```

Watch out: weighted `acquire(N)` on most implementations is **atomic** — either all N permits are taken or none are. This avoids partial-acquire deadlocks but means a single greedy request can sit waiting forever behind a stream of small requests on a fair semaphore. On an unfair semaphore the same thread may starve because small requests keep slipping past.

### 3. Bounded Buffer Pattern

The bounded buffer is the canonical example for understanding semaphores. You have a fixed-size queue shared between producers and consumers. You need three things:

- `empty` — counts free slots (initial value: capacity).
- `full` — counts filled slots (initial value: 0).
- `mutex` — a binary semaphore protecting the buffer's internal state.

Producer:

```text
empty.acquire()
mutex.acquire()
buffer.push(item)
mutex.release()
full.release()
```

Consumer:

```text
full.acquire()
mutex.acquire()
item = buffer.pop()
mutex.release()
empty.release()
```

Key invariant: `empty + full = capacity` at all times. Permits are never created out of thin air; producers and consumers swap them.

Pitfall: the order **must** be `empty.acquire` before `mutex.acquire`, never the reverse. If you acquire the mutex first and then block on `empty`, no consumer can ever enter the critical section to free a slot — classic deadlock.

### 4. Rate Limiter Pattern

A semaphore can rate-limit concurrent operations (concurrency limit) but cannot, by itself, rate-limit operations per second. To do the latter, combine the semaphore with a scheduled `release`:

```text
sem = Semaphore(100)   // burst of 100
every 1 second:
    sem.release(100 - sem.available())  // top up
```

This is the basis of token-bucket and leaky-bucket rate limiters. The semaphore handles the synchronization; a timer handles the refill.

For pure concurrency limits ("no more than 50 in-flight requests"), the semaphore alone is enough.

### 5. Worker Pool with N Permits

Instead of spawning N worker threads explicitly, you can let any thread do the work as long as it first acquires a permit:

```text
sem = Semaphore(N)
for each task:
    sem.acquire()
    spawn:
        try { work(task) }
        finally { sem.release() }
```

This is "permission-based concurrency": you do not need to manage worker lifecycles, only the permit count. It composes beautifully with futures and async code.

### 6. Producer-Consumer with Semaphores

The bounded buffer above **is** the producer-consumer solution. The salient features:

- Producers block on `empty` when the buffer is full.
- Consumers block on `full` when the buffer is empty.
- The mutex serializes structural changes to the buffer.

Variations:

- Multiple producers, multiple consumers: same code works because the mutex is per-buffer.
- Multiple queues per consumer: use one `(empty, full)` pair per queue and `select` across them (or in Go, use channels directly).

### 7. Readers-Writers with Semaphores

The readers-writers problem allows many concurrent readers but only one writer at a time. There are three classical variants:

**Variant 1 — Readers preference (writers may starve):**

```text
mutex     = Semaphore(1)
write_sem = Semaphore(1)
read_count = 0

reader:
    mutex.acquire()
    read_count += 1
    if read_count == 1: write_sem.acquire()
    mutex.release()
    read()
    mutex.acquire()
    read_count -= 1
    if read_count == 0: write_sem.release()
    mutex.release()

writer:
    write_sem.acquire()
    write()
    write_sem.release()
```

The first reader "locks the door" against writers; the last reader "unlocks" it. If readers keep arriving, writers never get in.

**Variant 2 — Writers preference (readers may starve):** add a `writer_present` flag and force readers to wait if a writer is queued.

**Variant 3 — Fair (no starvation):** introduce a turnstile semaphore that every reader and writer must pass through, in FIFO order, before contending for the data lock. This is the textbook "no starvation" solution from Downey's *Little Book of Semaphores*.

The pattern of choice depends on workload: in a read-heavy cache, readers preference is fine. In a config service where writes carry critical updates, writers preference (or fair) is safer.

### 8. Dining Philosophers with Semaphores

Five philosophers sit around a table. Each needs two forks (left and right) to eat. With five forks total, naive acquisition causes deadlock:

```text
each philosopher i:
    fork[i].acquire()
    fork[(i+1) % 5].acquire()
    eat()
    fork[(i+1) % 5].release()
    fork[i].release()
```

If everyone picks up their left fork simultaneously, no right fork is ever free. Standard solutions:

- **Resource hierarchy / ordering.** Force every philosopher to acquire the lower-indexed fork first. This breaks the circular wait.
- **Asymmetric philosophers.** Make one philosopher acquire right-then-left while the others go left-then-right.
- **Arbiter (waiter) semaphore.** Add a `Semaphore(4)` representing "seats at the table." Only four philosophers can attempt to eat at once, guaranteeing at least one can acquire both forks.
- **All-or-nothing.** Use a mutex around the fork-acquisition phase so a philosopher either gets both or neither.

This problem is not academic. Replace "philosopher" with "transaction" and "fork" with "row lock," and you have the deadlock pattern every database engine guards against.

### 9. Async Semaphores

In async runtimes, blocking a thread defeats the point. So `acquire` returns a future or coroutine:

- **Python:** `asyncio.Semaphore` exposes `async with sem:`.
- **Rust/Tokio:** `tokio::sync::Semaphore` returns an `OwnedSemaphorePermit` future.
- **JavaScript:** no built-in, but libraries (`p-limit`, `async-sema`) provide promise-based equivalents.
- **C#:** `SemaphoreSlim.WaitAsync()` integrates with `Task`.

The semantics match thread semaphores, but the cost of "waiting" is one suspended task, not one parked thread. This makes async semaphores extremely cheap and lets you set permit counts in the hundreds of thousands without OS pressure.

Caveat: async semaphores still need careful cancellation handling. If a task is cancelled while waiting, the runtime must remove it from the queue without leaking a permit. Tokio handles this via `Drop`; Python via `CancelledError`. Always check your runtime's docs.

### 10. Why Semaphores Are Dangerous

Semaphores are powerful because they decouple `acquire` from `release`. They are dangerous for exactly the same reason:

- **No ownership.** Any thread can release a permit, even one it did not acquire. A bug elsewhere can inflate your capacity by a factor of two.
- **No automatic release.** Forgetting `release` in an error path leaks a permit; eventually capacity reaches zero and the system deadlocks.
- **No re-entrancy.** Acquiring the same semaphore twice from the same thread blocks if there is only one permit. (Mutexes can be recursive; counting semaphores generally are not.)
- **Easy to over-release.** A spurious extra `release` raises capacity above the intended ceiling and silently breaks the invariant the semaphore was protecting.
- **Invisible coupling.** Two unrelated subsystems sharing a global semaphore by name will deadlock the entire process if one of them mishandles permits.

The takeaway: semaphores belong in narrow, well-tested utility code. Higher-level primitives (channels, executors, `synchronized` blocks) cost a little more but eliminate most of these foot-guns.

---

## Real-World Analogies

- **Parking garage with attendants.** A fair semaphore is a garage with a single queue and a polite attendant: first car in line gets the next free spot. An unfair semaphore is a free-for-all lot: whoever sees the spot first claims it.
- **Restaurant with limited tables.** The dining philosophers arbiter is the maitre d': they refuse to seat the fifth party even if a single table is open, because they know letting everyone sit will deadlock the kitchen.
- **Library reading room.** The readers-writers problem is the rule "as many readers as you want, but only one librarian reshelving at a time, and we lock the door during reshelving."
- **Airport security.** Weighted permits are like the rule that a family of four passes through together: they need four "slots" at once or the whole group waits.
- **Toll booths.** A semaphore-as-channel in Go is a parking-lot ticket dispenser: take a ticket on entry, return it on exit, and the booth stops issuing once the lot is full.

---

## Mental Models

- **The semaphore is a budget, not a lock.** A mutex protects an identity (this one object); a semaphore protects a quantity (this much capacity).
- **`acquire` is a question, `release` is a gift.** `acquire` asks "may I have a permit?" and may block waiting for one. `release` gifts a permit to the pool, no matter who acquired it.
- **Permits are conserved.** In a correct program, `total_permits == initial + sum(releases) - sum(acquires_in_flight)`. Anything else is a bug.
- **Fairness costs throughput, unfairness costs latency.** You cannot have both; pick based on which matters in this workload.
- **Async semaphores are cooperative.** They never preempt; they only suspend the current task. If your "critical section" blocks on a sync I/O call, you have lost the benefit.

---

## Code Examples

### 1. Bounded Buffer in C (POSIX semaphores)

```c
#include <pthread.h>
#include <semaphore.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#define CAPACITY 8
#define ITEMS    32

static int buffer[CAPACITY];
static int head = 0, tail = 0;

static sem_t empty_slots;  // initial = CAPACITY
static sem_t full_slots;   // initial = 0
static sem_t mutex;        // binary, initial = 1

static void *producer(void *arg) {
    long id = (long)arg;
    for (int i = 0; i < ITEMS; i++) {
        int item = (int)(id * 1000 + i);

        sem_wait(&empty_slots);          // wait for a free slot
        sem_wait(&mutex);                // protect buffer state
        buffer[tail] = item;
        tail = (tail + 1) % CAPACITY;
        printf("producer %ld -> %d\n", id, item);
        sem_post(&mutex);
        sem_post(&full_slots);           // signal: one more item

        usleep(1000);
    }
    return NULL;
}

static void *consumer(void *arg) {
    long id = (long)arg;
    for (int i = 0; i < ITEMS; i++) {
        sem_wait(&full_slots);           // wait for an item
        sem_wait(&mutex);
        int item = buffer[head];
        head = (head + 1) % CAPACITY;
        printf("consumer %ld <- %d\n", id, item);
        sem_post(&mutex);
        sem_post(&empty_slots);          // signal: one more slot

        usleep(1500);
    }
    return NULL;
}

int main(void) {
    sem_init(&empty_slots, 0, CAPACITY);
    sem_init(&full_slots,  0, 0);
    sem_init(&mutex,       0, 1);

    pthread_t p1, p2, c1, c2;
    pthread_create(&p1, NULL, producer, (void *)1);
    pthread_create(&p2, NULL, producer, (void *)2);
    pthread_create(&c1, NULL, consumer, (void *)1);
    pthread_create(&c2, NULL, consumer, (void *)2);

    pthread_join(p1, NULL);
    pthread_join(p2, NULL);
    pthread_join(c1, NULL);
    pthread_join(c2, NULL);

    sem_destroy(&empty_slots);
    sem_destroy(&full_slots);
    sem_destroy(&mutex);
    return 0;
}
```

Compile with `cc -pthread bounded_buffer.c -o bb && ./bb`. Notice the strict acquisition order: capacity semaphore first, mutex second.

### 2. Java Connection Pool with `Semaphore`

```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Deque;
import java.util.ArrayDeque;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

public final class ConnectionPool implements AutoCloseable {
    private final String url;
    private final Semaphore permits;
    private final Deque<Connection> idle = new ArrayDeque<>();

    public ConnectionPool(String url, int size) {
        this.url = url;
        this.permits = new Semaphore(size, /* fair = */ true);
    }

    public Connection borrow(long timeoutMs) throws SQLException, InterruptedException {
        if (!permits.tryAcquire(timeoutMs, TimeUnit.MILLISECONDS)) {
            throw new SQLException("connection pool timeout after " + timeoutMs + " ms");
        }
        Connection c;
        synchronized (idle) {
            c = idle.pollFirst();
        }
        if (c == null || c.isClosed()) {
            c = DriverManager.getConnection(url);
        }
        return c;
    }

    public void giveBack(Connection c) {
        try {
            synchronized (idle) {
                idle.addFirst(c);
            }
        } finally {
            permits.release();
        }
    }

    @Override
    public void close() throws SQLException {
        synchronized (idle) {
            for (Connection c : idle) c.close();
            idle.clear();
        }
    }
}
```

Notes: the semaphore is fair to prevent one chatty caller from monopolizing connections. `release` is in a `finally` to survive exceptions. The `idle` deque is protected by its own monitor; the semaphore protects the *count*, not the deque structure.

### 3. Python `asyncio.Semaphore` — Rate-Limited HTTP Fetcher

```python
import asyncio
import time
import aiohttp

MAX_CONCURRENT = 8

async def fetch(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str) -> int:
    async with sem:                          # acquire on enter, release on exit
        async with session.get(url) as resp:
            await resp.read()
            return resp.status

async def main(urls: list[str]) -> None:
    sem = asyncio.Semaphore(MAX_CONCURRENT)
    timeout = aiohttp.ClientTimeout(total=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        tasks = [fetch(session, sem, u) for u in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    ok = sum(1 for r in results if r == 200)
    print(f"{ok} / {len(urls)} OK")

if __name__ == "__main__":
    urls = [f"https://httpbin.org/anything/{i}" for i in range(40)]
    t0 = time.perf_counter()
    asyncio.run(main(urls))
    print(f"elapsed: {time.perf_counter() - t0:.2f}s")
```

Without the semaphore, 40 simultaneous sockets open at once. With `Semaphore(8)`, only eight are ever in flight, and `async with` guarantees `release` even on exceptions.

### 4. Go: Semaphore-as-Channel for Goroutine Limiting

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

// sema is a buffered channel acting as a counting semaphore.
type sema chan struct{}

func newSema(n int) sema { return make(chan struct{}, n) }

func (s sema) acquire(ctx context.Context) error {
    select {
    case s <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (s sema) release() { <-s }

func work(ctx context.Context, id int, s sema, wg *sync.WaitGroup) {
    defer wg.Done()
    if err := s.acquire(ctx); err != nil {
        fmt.Printf("task %d: %v\n", id, err)
        return
    }
    defer s.release()

    fmt.Printf("task %d running\n", id)
    time.Sleep(200 * time.Millisecond)
    fmt.Printf("task %d done\n", id)
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()

    s := newSema(4) // at most 4 concurrent tasks
    var wg sync.WaitGroup
    for i := 0; i < 20; i++ {
        wg.Add(1)
        go work(ctx, i, s, &wg)
    }
    wg.Wait()
}
```

The buffered channel `chan struct{}` has zero per-message overhead and integrates with `context` for cancellation. For weighted permits in Go, use `golang.org/x/sync/semaphore.NewWeighted`.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Models capacity, not just exclusion. | No ownership: any thread can release. |
| Atomic weighted operations possible. | Easy to leak permits in error paths. |
| Works across processes (POSIX named semaphores). | Easy to over-release and inflate capacity. |
| Composes well with async runtimes. | Generally not re-entrant. |
| Conceptually simple; few lines of code. | Fairness vs throughput is a real trade-off. |
| Standardized API across languages. | Debugging deadlocks is hard without tooling. |

---

## Use Cases

- **Connection pools** for databases, HTTP clients, gRPC channels.
- **Worker pools** that cap CPU- or memory-bound concurrency.
- **Rate limiters** for outbound API calls.
- **Bounded buffers** for producer-consumer pipelines.
- **Backpressure** in streaming systems (Kafka consumers, Flink operators).
- **License management** in software with N concurrent-user limits.
- **Throttling background jobs** so they do not starve foreground requests.
- **Coordinating phases** in parallel algorithms (combined with barriers).
- **Limiting filesystem handles** in tools that walk huge directory trees.

---

## Coding Patterns

### RAII / `with` / `defer` for safe release

```python
async with sem:
    await do_work()
```

```cpp
std::lock_guard<std::counting_semaphore<8>> _(sem); // C++20
```

```go
s.acquire(ctx); defer s.release()
```

```java
sem.acquire();
try { work(); } finally { sem.release(); }
```

The unifying idea: bind `release` to scope exit so no return path leaks a permit.

### `tryAcquire` for non-blocking probes

```java
if (sem.tryAcquire()) {
    try { fastPath(); } finally { sem.release(); }
} else {
    queueForLater();
}
```

Use `tryAcquire(timeout)` to bound waits and surface backpressure as an error instead of an indefinite hang.

### Timed Acquire as Health Signal

If `acquire(timeout)` returns false in production, that is a metric, not a bug. Emit it. A rising rate of timeouts usually means downstream slowness.

### Double Semaphore for Hand-Off

When you need a strict rendezvous (producer cannot continue until consumer has taken the item), use two binary semaphores in lockstep:

```text
ready  = Semaphore(0)
done   = Semaphore(0)

producer:
    item = build()
    ready.release()
    done.acquire()

consumer:
    ready.acquire()
    use(item)
    done.release()
```

This is the textbook *rendezvous pattern* and underlies many CSP-style channel implementations.

### Turnstile (Multiplex)

A `Semaphore(N)` whose only job is to let exactly N threads through a section at once. Useful for limiting concurrency on a hot resource (e.g., "no more than 10 threads in this `decode` function").

---

## Clean Code

- **Name the resource, not the primitive.** `dbConnections` is better than `sem`. A reader should know what each permit represents.
- **Pair `acquire` with `release` at the same lexical level.** Never `acquire` in one function and `release` in another unless you wrap them in an RAII handle.
- **Comment the invariant.** `// invariant: empty + full == CAPACITY` at the top of the buffer file saves hours of debugging.
- **Centralize semaphore creation.** Avoid scattering `new Semaphore(...)` across the codebase; place them in a config-driven factory so capacities can be tuned in one spot.
- **Expose metrics.** Wrap `acquire`/`release` to count waits, average wait time, and current permit usage. Without metrics, semaphores are invisible to operators.
- **Prefer higher-level abstractions** (executors, channels, rate-limiter libraries) when they cover your case; reach for raw semaphores only when those abstractions are not enough.

---

## Best Practices

1. **Always release in `finally` / `defer` / `Drop`.**
2. **Default to fair semaphores for user-facing latency, unfair for internal throughput.**
3. **Use `tryAcquire(timeout)` in production code paths**; unbounded waits are a liability.
4. **Treat capacity as configuration**, not a magic constant; tune it under realistic load.
5. **Never share one global semaphore across unrelated subsystems.**
6. **Log permit exhaustion**; it is one of the highest-signal events your service can produce.
7. **Combine with a circuit breaker** when wrapping external dependencies; the semaphore caps in-flight, the breaker stops sending entirely when failure rate is high.
8. **Document weighted-permit cost models** in code comments; otherwise nobody knows why one task asks for `acquire(7)`.
9. **For async code, audit cancellation paths**; a half-acquired permit is a leak.
10. **Prefer hand-off semantics** (e.g., a `BlockingQueue`) when you need ordering and bounded buffering together.

---

## Edge Cases & Pitfalls

- **Spurious wakeups.** Some implementations may wake a waiter that then loses the race for the permit. Always re-check the condition after `acquire` if you use one.
- **Permit leak on exception.** Forgetting `release` in error paths is the single most common bug. Linters can catch it (e.g., `try-with-resources` in Java).
- **Over-release.** Calling `release` twice for one `acquire` raises capacity. There is no automatic recovery; you must restart or rebuild the semaphore.
- **Cancellation during acquire.** In async runtimes, ensure cancellation cleans up queue state.
- **Priority inversion.** A low-priority thread holding a permit can block a high-priority one indefinitely. On real-time systems, use priority-inheritance mutexes instead.
- **Deadlock by ordering.** Acquiring multiple semaphores in different orders across threads is a recipe for deadlock; impose a global order.
- **Interaction with `fork()` (POSIX).** Forking a process holding a named semaphore can leave the child holding permits the parent thinks are free.
- **Permit starvation under bursty load.** Unfair semaphores can let one thread grab the same permit repeatedly while others wait.
- **Capacity overflow.** On a `Semaphore(Integer.MAX_VALUE)`, repeated `release` can wrap; rare, but real in long-lived services.
- **Tests that pass under low contention.** A semaphore bug often surfaces only under load. Add stress tests that run thousands of acquire/release cycles.

---

## Common Mistakes

1. **Mutex inside semaphore wait.** Acquiring a mutex first and then blocking on a semaphore that only another mutex holder can release. Deadlock.
2. **Releasing in the wrong scope.** A function acquires, returns a value, and forgets to release; the caller assumes the callee handled it.
3. **Using a binary semaphore as a mutex.** Works in the happy path; fails under reentrancy and erases ownership semantics.
4. **Confusing `Semaphore(0)` with a closed semaphore.** Zero permits is a valid initial state used in signaling; it does not mean "broken."
5. **Calling blocking `acquire` from an event loop.** In Node, Python asyncio, or Tokio, this freezes the entire runtime.
6. **Forgetting to release on shutdown.** Long-lived services should drain in-flight permits cleanly before exit.
7. **Mixing fair and unfair semantics across replicas.** Two service instances configured differently produce confusing tail latency patterns.
8. **Treating `tryAcquire(0)` as a peek.** It removes a permit on success; you cannot non-destructively check availability.
9. **Using semaphores for ordering.** A semaphore guarantees count, not order. If you need ordering, use a queue.
10. **Choosing capacity by guess.** Pick capacity from a load test or a Little's Law estimate, not from "feels right."

---

## Tricky Points

- **Fairness is not transitive.** A fair semaphore guarantees FIFO among waiters at *that* semaphore. If a thread holds two fair semaphores, the global pattern can still starve someone.
- **Weighted acquire is atomic but not preemptive.** A request for `acquire(10)` waits until 10 permits are simultaneously available. Smaller requests may slip past on an unfair semaphore, starving the big one.
- **Hand-off vs barging interacts with cancellation.** A fair semaphore that hands off may "hand off to a dead waiter" if cancellation arrived a microsecond earlier; implementations must re-deliver.
- **`Semaphore.drainPermits()`** returns and removes all available permits. Useful for shutdown ("nobody new gets in"), dangerous for reasoning ("where did my capacity go?").
- **`Semaphore.reducePermits(N)`** permanently lowers the maximum. There is no symmetric `increasePermits`; you achieve growth via `release`. The asymmetry is intentional but surprising.
- **Async semaphores have no thread affinity.** A coroutine that acquired on one OS thread may resume on another; do not pair semaphores with thread-local state.
- **POSIX `sem_post` is async-signal-safe**, which is why it is one of the few synchronization primitives allowed in signal handlers.

---

## Test Yourself

1. What invariant does a counting semaphore preserve?
2. Why must `empty.acquire()` come before `mutex.acquire()` in a bounded-buffer producer?
3. Give one workload where fair semaphores beat unfair, and one where unfair beats fair.
4. Describe the deadlock in the naive dining philosophers solution and one fix.
5. What is a "permit leak," and which language feature helps prevent it?
6. How does `asyncio.Semaphore` differ from `threading.Semaphore` in cost and semantics?
7. Why is `release` not required to be called by the same thread that called `acquire`?
8. What happens if you call `release()` more times than `acquire()`?
9. How would you implement a rate limiter that allows 100 requests per second using a semaphore plus a timer?
10. Why can a `Semaphore(1)` be used as a mutex but is not generally interchangeable with one?

---

## Tricky Questions

1. **A queue of 1000 small `acquire(1)` calls precedes a single `acquire(50)` call on an unfair semaphore with 50 permits. Will the big request ever proceed?** Not guaranteed: small calls will keep barging past. On a fair semaphore, the big call would be served when its turn arrives.
2. **You set `Semaphore(8, true)` for a database pool and observe higher tail latency than `Semaphore(8, false)`. Why might that be desirable anyway?** Fairness gives every caller bounded waiting; under unfair, a thread doing tight retry loops can starve other threads.
3. **A coroutine awaits a `Semaphore` and is cancelled. The semaphore's permit count drops by 1. Is this a bug?** Yes — the runtime should remove the cancelled waiter from the queue without consuming a permit. Verify your runtime's behavior.
4. **You add `acquire(N)` and `release(N)` weighted operations to a semaphore. A thread does `acquire(3)` and then forgets, releasing only `release(1)`. What is the effect over time?** Permanent capacity loss of 2; eventually the pool deadlocks. There is no way to detect this without external bookkeeping.
5. **A `Semaphore(0)` is used as a signal between two threads. Thread A `acquire()`s, thread B `release()`s. Is this faster or slower than a condition variable for the same task?** Often comparable; semaphores have simpler API but condition variables let you combine with arbitrary predicates.
6. **In dining philosophers with the arbiter (`Semaphore(4)`), can two philosophers still deadlock?** No — at most four are in the eating section, so at least one always finds both forks free.
7. **Two services share a `Semaphore` over IPC (named POSIX semaphore). One crashes mid-acquire. What happens?** Capacity is permanently reduced; recovery requires destroying and recreating the semaphore. This is why most modern systems prefer per-process semaphores and explicit IPC protocols.

---

## Cheat Sheet

| API (Java) | Meaning |
|------------|---------|
| `new Semaphore(N)` | Create with N permits, unfair. |
| `new Semaphore(N, true)` | Create fair (FIFO). |
| `acquire()` | Block until a permit is available. |
| `acquire(int n)` | Block until n permits are available, atomically. |
| `tryAcquire()` | Non-blocking attempt. |
| `tryAcquire(t, unit)` | Wait up to t for a permit. |
| `release()` | Return one permit. |
| `release(int n)` | Return n permits. |
| `availablePermits()` | Snapshot; do not use for decisions. |
| `drainPermits()` | Take all currently available. |
| `reducePermits(int n)` | Shrink maximum permanently. |

| Pattern | Initial permits | Notes |
|---------|----------------|-------|
| Mutex (binary) | 1 | Prefer a real mutex if available. |
| Signal | 0 | One thread waits, another posts. |
| Bounded buffer | empty=N, full=0, mutex=1 | Acquire capacity *before* mutex. |
| Worker pool | N | RAII / try-finally release. |
| Rate limiter | burst | Combine with timer for per-second rate. |
| Dining arbiter | N-1 | One fewer than total philosophers. |

---

## Summary

Semaphores are deceptively simple. They are a counter with two operations, and yet they support the construction of bounded buffers, rate limiters, worker pools, and rendezvous protocols — the entire toolkit of classical concurrency. The middle-level skill set is knowing which flavor (fair, unfair, weighted, async) fits the workload, knowing the three textbook problems by heart, and knowing where the foot-guns live: permit leaks, over-release, deadlock by ordering, and starvation.

The pragmatic mindset: prefer higher-level abstractions when they cover your case, and reserve semaphores for the moments when nothing else gives you the right grip on the problem. When you do reach for one, name the resource, release in `finally`, instrument the wait time, and bound your acquires with a timeout. That is the difference between a semaphore that quietly does its job and one that quietly destroys your weekend.

---

## What You Can Build

- A connection pool with timeouts, metrics, and graceful drain on shutdown.
- A rate-limited outbound HTTP client used by a worker queue.
- A producer-consumer pipeline with bounded backpressure between stages.
- A bounded worker pool that runs CPU-heavy jobs without OOM.
- A semaphore-based fair rate limiter per tenant in a multi-tenant API.
- A coordination layer in a job scheduler that enforces "no more than K of this kind of job at once."
- A test harness that exercises your bounded buffer under adversarial schedules.

---

## Further Reading

- Allen B. Downey, *The Little Book of Semaphores* — the canonical exercise book.
- Java `java.util.concurrent.Semaphore` Javadoc, especially the section on fairness.
- Brian Goetz et al., *Java Concurrency in Practice*, chapter 5.
- Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*, chapter on synchronization primitives.
- Tokio docs: `tokio::sync::Semaphore` and its design notes.
- Python `asyncio` source: `Lock`, `Semaphore`, `BoundedSemaphore`.
- Go `golang.org/x/sync/semaphore` for the weighted semaphore implementation.
- Edsger W. Dijkstra, *Cooperating Sequential Processes* (1965) — the original.

---

## Related Topics

- [Mutex](../01-mutex/README.md) — when you need ownership and exclusion, not capacity.
- [Condition Variables](../03-condition-variable/README.md) — for predicate-based waiting.
- [Channels](../../03-message-passing/01-channels/README.md) — bounded buffers as language primitives.
- [Rate Limiting](../../../../../system-design/throttling/rate-limiting/README.md) — token bucket and leaky bucket.
- [Backpressure](../../../../../system-design/streaming/backpressure/README.md) — semaphores as a backpressure mechanism.
- [Dining Philosophers](../../04-classic-problems/dining-philosophers/README.md) — full treatment.
- [Readers-Writers Lock](../04-rwlock/README.md) — a higher-level primitive built on similar ideas.

---

## Diagrams & Visual Aids

**Bounded buffer permit flow.**

```text
producer                  buffer                  consumer
   |                        |                        |
   | empty.acquire() ------>|                        |
   |                        |                        |
   | mutex.acquire() ------>|                        |
   | push(item) ----------->|                        |
   | mutex.release()        |                        |
   |                        |                        |
   | full.release() ------->|<------ full.acquire()  |
   |                        |                        |
   |                        |<--- mutex.acquire()    |
   |                        |---- pop(item) -------->|
   |                        |<--- mutex.release()    |
   |                        |                        |
   |                        |<--- empty.release()    |
```

**Fair vs unfair queue behavior.**

```text
fair (FIFO):     [A B C D] -> permit released -> A acquires, queue: [B C D]
unfair (barge):  [A B C D] -> permit released, new arrival E grabs it -> queue: [A B C D]
```

**Dining philosophers with arbiter.**

```text
                 +-------------------+
                 |  arbiter (sem=4)  |
                 +-------------------+
                  |    |    |    |
              P0  P1  P2  P3  P4
              (at most 4 may try to eat at once;
               at least one always gets both forks)
```

**Weighted semaphore.**

```text
budget = 1024 KB
  +-----------------------------------------+
  | task A: acquire(128)   running          |
  | task B: acquire(256)   running          |
  | task C: acquire(64)    running          |
  | task D: acquire(1024)  waiting          |
  +-----------------------------------------+
   used = 448, free = 576, queued = D (needs 1024)
```

**Async semaphore lifecycle.**

```text
coroutine -> acquire() -> pending future
                |               |
                | permit free?  |
                v               v
            yes: resume    no: park in waiter list
                              |
                  release() pops waiter -> schedule resume
```

These diagrams are the smallest set you need to keep in your head when reasoning about semaphores in production code. If you can sketch them on a whiteboard from memory, you have internalized the middle-level material.
