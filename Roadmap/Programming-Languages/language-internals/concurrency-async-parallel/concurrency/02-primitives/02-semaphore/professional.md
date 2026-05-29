# Semaphore — Professional Level

> **Topic:** [Semaphore](README.md)
> **Focus:** history, library design, governance, alternatives

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

At the professional level, the semaphore stops being "the primitive you call P/V on" and becomes a **governance lever** for a system. You no longer just write `sem.acquire(); work(); sem.release()`. You decide where in the architecture a semaphore should live, what it represents in business terms (concurrent payment requests, parallel DB connections, in-flight uploads), and what alternatives are better when you need handoff, ownership, or rate shaping rather than concurrency limits.

This document is the long arc: the historical roots from Dijkstra's 1965 paper, the System V quirks that shaped UNIX semantics for decades, the design decisions behind today's library APIs (Polly, Resilience4j, Go's `semaphore.Weighted`, Tokio's `Semaphore`), and the migration stories you will live through as a senior engineer — moving away from semaphores into actor mailboxes, queues, or token buckets when the concurrency-limit model stops fitting the problem.

If a mid-level engineer reaches for a semaphore because "it's what I know," a professional engineer reaches for one because they have ruled out four other tools first.

---

## Prerequisites

Before this document you should be comfortable with:

- **Junior**: counting permits, `acquire`/`release`, binary vs counting semaphores.
- **Middle**: fairness, starvation, weighted permits, deadlock avoidance, semaphore vs mutex tradeoffs.
- **Senior**: futex-based implementations, queue internals, performance under contention, interaction with thread schedulers.
- General resilience patterns: timeouts, retries, circuit breakers, bulkheads.
- An async runtime model (Tokio, async/await, futures) and at least one ecosystem's resilience library.

---

## Glossary

| Term | Meaning |
|---|---|
| **P operation** | Dijkstra's term for `acquire` / `wait` / `down`. From Dutch *Prolaag* (try to lower). |
| **V operation** | Dijkstra's term for `release` / `signal` / `up`. From Dutch *Verhogen* (raise). |
| **System V semaphore** | UNIX kernel semaphore family with `semget`, `semop`, `semctl`, and the `SEM_UNDO` flag. |
| **SEM_UNDO** | Flag asking the kernel to reverse a process's net semaphore changes if it dies. |
| **POSIX semaphore** | Newer named/unnamed semaphore API: `sem_open`, `sem_wait`, `sem_post`. |
| **Bulkhead** | Resilience pattern that limits concurrent calls to an isolated section so one failure does not sink the ship. |
| **Weighted semaphore** | Semaphore where each acquire takes N permits, modelling resource cost. |
| **Token bucket** | Rate-limiter that issues tokens at a fixed rate up to a cap; bursts allowed up to the cap. |
| **Leaky bucket** | Rate-limiter modelled as a queue draining at fixed rate; smooths bursts. |
| **Permit leak** | Bug where a permit is acquired but never released, slowly draining capacity to zero. |
| **Over-release** | Bug where a permit is released without a corresponding acquire, raising effective capacity beyond design. |
| **Actor mailbox** | Queue feeding a single-threaded actor; an alternative to concurrency limits via semaphores. |
| **try_acquire_owned** | Tokio API returning a guard owning the permit, transferable across tasks. |

---

## Core Concepts

### 1. History — Dijkstra's *Cooperating Sequential Processes* (1965)

The semaphore was invented by **Edsger W. Dijkstra** in his 1965 manuscript *Cooperating Sequential Processes* (EWD123). At the time, the dominant synchronization tool was the **busy-wait loop** on a shared flag. Dijkstra wanted a primitive that would let processes **block** efficiently, without burning CPU, and could be implemented atomically by hardware or a small kernel.

He named the two operations after Dutch verbs:

- **P** for *Prolaag*, a contraction Dijkstra coined from *probeer te verlagen* — "try to lower."
- **V** for *Verhogen* — "to raise."

The semaphore had three rules:

1. An integer counter `s >= 0`.
2. `P(s)`: when `s > 0`, decrement and continue; otherwise block until `s > 0`.
3. `V(s)`: increment `s`; wake one waiter if any.

Crucially, P and V were defined as **atomic** — Dijkstra invented the abstraction precisely so programmers would not need to reason about the interleavings inside them. He explicitly noted that the implementation was the OS or hardware's problem.

The 1965 paper also introduced:

- The **producer/consumer problem** with bounded buffer, solved by two counting semaphores (`empty`, `full`) plus a mutex.
- The **dining philosophers problem**.
- The **sleeping barber problem** (informally).

Every modern concurrency textbook descends from this paper. When you write `sem.acquire()` today, you are still issuing a P.

### 2. System V semaphores — quirks and SEM_UNDO

When UNIX needed an IPC primitive in the early 1980s, AT&T introduced **System V IPC**, which included **semaphore sets**. The API is famously awkward:

```c
int semid = semget(key, nsems, IPC_CREAT | 0600);
struct sembuf op = { .sem_num = 0, .sem_op = -1, .sem_flg = SEM_UNDO };
semop(semid, &op, 1);
```

Key System V design choices that still affect production systems:

- **Sets, not single counters.** You create N semaphores at once. `semop` performs a batch of operations atomically or not at all — useful for compound conditions, hard to reason about.
- **Kernel-resident, not in-memory.** A semaphore set lives in the kernel and survives process death by default. You have to `semctl(IPC_RMID)` to delete it. Leaked sets accumulate; `ipcs -s` shows them.
- **`SEM_UNDO`** — a flag asking the kernel to record the net change made by a process and **reverse it** if the process exits without an explicit cleanup. Designed to prevent permit leaks when a holder crashes. In practice it is the source of many surprises: undo lists have limits, can fail silently, and interact poorly with `fork()`.
- **`ftok`** — generates a key from a path and project ID. Two different files mapping to the same inode can collide. Many production outages traced back to `ftok` reuse after a filesystem reset.
- **Permission model** — semaphores have UID/GID and a mode, like a file. Cross-user IPC requires explicit mode bits.
- **Tunables** — `kernel.sem` in `sysctl` controls the maximum number of semaphores, sets, and operations. Defaults vary across distros and have caused real outages when migrating workloads.

POSIX semaphores (`sem_open`, `sem_wait`, `sem_post`) were introduced later as a cleaner alternative: process-shared **or** thread-shared, named **or** unnamed, no `SEM_UNDO`, no set semantics. Most modern code uses POSIX or higher-level wrappers; System V remains in legacy systems like Oracle, PostgreSQL (historically), and the Linux kernel's own SysV IPC tests.

### 3. Designing a library that exposes semaphore-like governance

When you build a library, you almost never want to expose a raw semaphore. You want to expose a **policy** that internally uses a semaphore. Three case studies:

#### 3.1 Polly (.NET) — `BulkheadPolicy`

```csharp
var bulkhead = Policy.BulkheadAsync(
    maxParallelization: 10,
    maxQueuingActions: 50,
    onBulkheadRejectedAsync: ctx => Log(ctx));
await bulkhead.ExecuteAsync(() => httpClient.GetAsync(url));
```

Polly wraps a `SemaphoreSlim` plus a queue counter. The consumer sees a *policy*, not a primitive. The library owns:

- Acquire timing (before vs after queueing).
- Rejection semantics (throws `BulkheadRejectedException`).
- Observability hooks (`onBulkheadRejectedAsync`).
- Composition with other policies (retry, circuit breaker, timeout).

#### 3.2 Resilience4j (Java) — `Bulkhead` and `ThreadPoolBulkhead`

Resilience4j offers two flavors:

- **`Bulkhead`** — a `SemaphoreBulkhead` that limits concurrent calls without owning threads.
- **`ThreadPoolBulkhead`** — a bounded thread pool with a bounded queue. This is *not* a semaphore but solves the same governance problem when you also need work-stealing or queueing.

The library exposes:

```java
BulkheadConfig config = BulkheadConfig.custom()
    .maxConcurrentCalls(20)
    .maxWaitDuration(Duration.ofMillis(500))
    .build();
Bulkhead bulkhead = Bulkhead.of("payments", config);
```

The choice between semaphore- and thread-pool-bulkhead is itself a design decision worth a paragraph in your architecture docs.

#### 3.3 Go — `golang.org/x/sync/semaphore.Weighted`

```go
sem := semaphore.NewWeighted(int64(maxBytes))
if err := sem.Acquire(ctx, costInBytes); err != nil { return err }
defer sem.Release(costInBytes)
```

Go's standard semaphore takes a `context.Context` for cancellation and accepts **weighted permits**, modelling cost-sensitive resources like memory budgets. The API teaches a lesson: every modern concurrency primitive should be **cancellable** and **costed**.

### 4. The Bulkhead pattern — semaphore as failure isolation

In ship design, a bulkhead is a vertical wall that confines flooding to one compartment. The **Bulkhead pattern** in software, popularized by Michael Nygard in *Release It!*, applies the same idea: partition your concurrency budget so a misbehaving downstream cannot drain all threads.

Concretely:

- Allocate **separate semaphores per dependency** (`paymentSem`, `inventorySem`, `searchSem`).
- If `payment` slows down, only `paymentSem` saturates; `inventory` keeps serving requests.
- Without bulkheads, a slow dependency consumes all worker threads until your service stops responding to *any* request.

A bulkhead is just a counting semaphore + a rejection policy + a name. The naming is half the value: dashboards and alerts can attribute saturation to a specific dependency.

### 5. When semaphore is the wrong tool

| Problem | Wrong primitive | Right primitive |
|---|---|---|
| Mutual exclusion of a critical section owned by one thread | Binary semaphore | **Mutex** — has ownership; only the locker can unlock |
| Handing off a value from producer to consumer | Counting semaphore + shared variable | **Channel** / blocking queue — built for handoff |
| Counting how many things are in flight, accurately | Semaphore counter inspection | **Atomic counter** + sampling — semaphores' internal count is not a reliable gauge |
| Smoothing burst traffic at fixed rate | Semaphore released by a timer | **Token bucket / leaky bucket** — designed for rate, not concurrency |
| Bounded work queue with backpressure | Semaphore guarding `unbounded.add` | **Bounded queue** — atomic capacity check + condition variable |
| Coordinating once-only initialization | Binary semaphore | **`sync.Once` / std::call_once** — purpose-built |

Reach for a semaphore only when the question is literally "how many of these may run at once."

### 6. Semaphore vs token bucket vs leaky bucket — the rate-limiter taxonomy

| Property | Semaphore | Token bucket | Leaky bucket |
|---|---|---|---|
| Limits | Concurrency (in-flight count) | Rate (calls/sec) with burst | Rate (calls/sec) smoothed |
| Burst handling | Allows immediate concurrent burst up to N | Allows burst up to bucket capacity | Smooths bursts into steady drip |
| Implementation | Counter + waiter queue | Counter incremented by timer | FIFO queue drained on timer |
| Failure mode | Caller blocks or is rejected | Caller blocks until token available | Caller waits in queue |
| Best for | Resource governance (DB conns, file handles) | API quotas with bursty clients | Outbound rate to fragile downstream |

A common architectural mistake is using a semaphore to enforce calls-per-second. It doesn't. A semaphore enforces calls-at-once. If each call takes 10ms, a semaphore of 10 allows ~1000 calls/sec; if each takes 1s, the same semaphore allows ~10 calls/sec. The rate is a *side effect of latency*, not a guarantee.

### 7. Anti-patterns

#### 7.1 Semaphore used as mutex (loses ownership safety)

```java
Semaphore lock = new Semaphore(1);
lock.acquire();
try { criticalSection(); }
finally { lock.release(); }
```

Functionally similar to a mutex, but with two losses:

- **No ownership** — any thread can call `release()`, even one that didn't acquire. A mutex would throw `IllegalMonitorStateException`.
- **No reentrancy semantics** — a `ReentrantLock` lets the holder re-enter; a binary semaphore deadlocks.

Use this only when you specifically need cross-thread release (e.g., signal from a different thread than the acquirer). Otherwise prefer `Mutex` / `ReentrantLock`.

#### 7.2 Over-release

```java
try {
    sem.acquire();
    work();
    sem.release();   // first release
} finally {
    sem.release();   // duplicate release on exception path
}
```

The semaphore's permit count drifts upward past the configured maximum. Capacity becomes a lie. Symptom: occasional overload despite "limit" being respected.

Fix: release in `finally` only, or use a guard object (Go's `defer`, Rust's RAII, Java's try-with-resources via custom `AutoCloseable`).

#### 7.3 Permit leak

```java
sem.acquire();
if (cond) return;     // forgot to release
work();
sem.release();
```

The counter drifts downward. After enough leaks, capacity hits zero and the service freezes. Symptom: throughput collapses slowly, often after days.

Fix: always release in `finally`, or use scope-bound guards.

#### 7.4 Using a semaphore instead of a queue

```java
Semaphore sem = new Semaphore(100);
sem.acquire();
backgroundExecutor.submit(() -> { try { process(); } finally { sem.release(); } });
```

This caps concurrency but provides no ordering, no priority, no visibility into pending work. If you actually need queueing semantics — head-of-line, FIFO, priority, fairness, age-based timeout — use a **bounded queue**. A semaphore tells you nothing about who is waiting or for how long.

### 8. Migration story — from semaphores to actor mailboxes

A saturated service we maintained had grown by accretion:

- A `paymentSem` of 50 for outbound calls.
- A `dbSem` of 200 for database access.
- An `auditSem` of 10 for the audit log writer.
- A `retrySem` of 20 used to gate background retries.

Latency was unpredictable. Permit leaks were hidden by lazy releases. The audit semaphore became a bottleneck because release happened *after* a `fsync` in a `finally` block. Saturation in one dependency caused thread pool starvation that bled across bulkheads because callers held permits across multiple semaphore acquires.

We migrated to an **actor model**:

- Each subsystem (`payments`, `audit`, `retries`) became a goroutine reading from a bounded channel.
- Concurrency limits became **channel buffer sizes plus worker counts**.
- Backpressure became natural: a producer that cannot send into a full channel either blocks, times out, or drops.
- Observability became trivial: every channel exposes `len(ch)` / `cap(ch)` — a true gauge.

The lesson: semaphores excel at "limit concurrency in a small, well-bounded section." When acquires nest across subsystem boundaries, or when you need queueing semantics, actor mailboxes are usually clearer.

### 9. Mentoring — how to teach when a semaphore IS the right tool

Three signals to teach juniors:

1. **The resource has a hard count limit.** "Only 8 DB connections." "Only 4 GPU workers." Reach for a semaphore.
2. **You do not need ordering or priority.** Anyone may go next; we only care that not too many go at once.
3. **You do not need to know who is waiting.** If you need to inspect the queue, you need a queue, not a semaphore.

Conversely, three signals to redirect them:

- "I need to wait until the producer adds something." → channel or condition variable.
- "Only the locker should be allowed to unlock." → mutex.
- "I want to limit calls per second." → token bucket.

### 10. Modern alternative: Tokio's `Semaphore` with `try_acquire_owned` and cancellation

Tokio's async semaphore is a sharp design worth studying:

```rust
let sem = Arc::new(Semaphore::new(10));
let permit = sem.clone().acquire_owned().await?;  // owned across tasks
tokio::spawn(async move {
    let _p = permit;  // released on drop
    work().await;
});
```

Notable features:

- **`acquire_owned`** returns an `OwnedSemaphorePermit` that can be moved into a spawned task.
- **Drop releases** — RAII semantics. No `release()` call required; no leak if a task panics or is cancelled.
- **`try_acquire`** is non-blocking and returns `Result`.
- **`close()`** poisons the semaphore so all future acquires fail with `AcquireError`. This is essential for graceful shutdown: signal close, wait for outstanding permits to drop, exit cleanly.

The cancellation story is what makes Tokio's design senior-grade: an `acquire().await` that is cancelled (because the surrounding `select!` chose another branch) cleanly removes itself from the waiter queue. Many older semaphore implementations leak waiters on cancellation, leading to a slow queue bloat that is invisible until it explodes.

---

## Real-World Analogies

- **Library quiet rooms.** The librarian (semaphore) hands out 6 key cards. When all 6 are out, the next student waits in line. Returning a card lets the next student in. The library itself does not care which student returns which card — just the count.
- **Hospital ICU beds.** Bed capacity is a counting semaphore. The bed manager (release policy) is a separate concern: who gets the next bed when one frees up — most acute case, longest waiter, or random — is *not* the bed count's job. That's why a bulkhead library separates "capacity" from "rejection policy."
- **Bridge weight limits.** Some bridges are limited by total tonnage, not vehicle count — a weighted semaphore. A truck consumes 8 permits, a car 1, a motorcycle 0.2. Same primitive, richer semantics.
- **Concert venue.** A binary semaphore guards the stage door (one band at a time). A counting semaphore meters the floor (max 800 attendees). Same hardware, two distinct uses, both essential.

---

## Mental Models

1. **Semaphore as a budget.** You have N units of *something*. Acquires spend; releases refund. Bugs are leaks (refund missed) or theft (extra refund). Audit your finally blocks the way you audit your accounts.
2. **Semaphore as a turnstile.** Counts entries, not identities. If you need identity tracking, the turnstile is the wrong tool — you need a registry.
3. **Semaphore as a backpressure valve.** Upstream pushes; semaphore says no until capacity exists. This is identical in shape to a bounded queue but lacks the queue's FIFO ordering.
4. **Semaphore as a circuit ground.** When closed (counter zero), it stops the flow. Unlike a circuit breaker, it does not *open* — it just blocks. A bulkhead + breaker combination gives you "stop accepting *and* fail fast."

---

## Code Examples

### Example 1 — Resilience4j Bulkhead configuration (Java)

```java
import io.github.resilience4j.bulkhead.Bulkhead;
import io.github.resilience4j.bulkhead.BulkheadConfig;
import io.github.resilience4j.bulkhead.BulkheadRegistry;
import io.github.resilience4j.bulkhead.event.BulkheadOnCallRejectedEvent;

import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;

public class PaymentClient {

    private final Bulkhead bulkhead;
    private final PaymentService delegate;

    public PaymentClient(PaymentService delegate) {
        this.delegate = delegate;

        BulkheadConfig config = BulkheadConfig.custom()
            .maxConcurrentCalls(20)
            .maxWaitDuration(Duration.ofMillis(250))
            .fairCallHandlingStrategyEnabled(true)
            .build();

        BulkheadRegistry registry = BulkheadRegistry.of(config);
        this.bulkhead = registry.bulkhead("paymentsBulkhead");

        // Observability — emit metrics on rejection.
        bulkhead.getEventPublisher()
            .onCallRejected(this::onRejected);
    }

    public PaymentResult charge(ChargeRequest req) {
        Supplier<PaymentResult> guarded =
            Bulkhead.decorateSupplier(bulkhead, () -> delegate.charge(req));
        return guarded.get();
    }

    private void onRejected(BulkheadOnCallRejectedEvent event) {
        // Push to metrics, trigger alerts, do not log every event at INFO.
        Metrics.counter("bulkhead.rejected",
            "name", event.getBulkheadName()).increment();
    }
}
```

Notes:

- `maxWaitDuration` differentiates this from a raw semaphore — callers wait at most 250ms before being rejected.
- `fairCallHandlingStrategyEnabled` selects FIFO. Disable for higher throughput when ordering does not matter.
- Naming the bulkhead (`"paymentsBulkhead"`) is mandatory for production observability.

### Example 2 — Go `semaphore.Weighted` for memory governance

```go
package main

import (
    "context"
    "fmt"
    "log"
    "sync"
    "time"

    "golang.org/x/sync/semaphore"
)

// processor handles uploads but limits TOTAL in-flight bytes, not job count.
type processor struct {
    sem *semaphore.Weighted
}

func newProcessor(memoryBudgetBytes int64) *processor {
    return &processor{
        sem: semaphore.NewWeighted(memoryBudgetBytes),
    }
}

// handle blocks until 'size' bytes of memory budget are available.
// Cancellation via ctx is respected.
func (p *processor) handle(ctx context.Context, name string, size int64) error {
    if size > 1<<30 {
        return fmt.Errorf("payload %s too large: %d", name, size)
    }

    acquireCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
    defer cancel()

    if err := p.sem.Acquire(acquireCtx, size); err != nil {
        return fmt.Errorf("budget acquire failed for %s: %w", name, err)
    }
    defer p.sem.Release(size)

    return p.work(ctx, name, size)
}

func (p *processor) work(ctx context.Context, name string, size int64) error {
    log.Printf("processing %s (%d bytes)", name, size)
    select {
    case <-time.After(100 * time.Millisecond):
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func main() {
    p := newProcessor(10 * 1024 * 1024) // 10 MiB budget

    var wg sync.WaitGroup
    for i := 0; i < 20; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            ctx := context.Background()
            size := int64((i + 1) * 512 * 1024) // 512KiB .. 10MiB
            if err := p.handle(ctx, fmt.Sprintf("job-%d", i), size); err != nil {
                log.Printf("job-%d failed: %v", i, err)
            }
        }(i)
    }
    wg.Wait()
}
```

Why a weighted semaphore is the right tool here:

- The resource is **bytes**, not jobs. A counter-based semaphore would let 100 jobs of 100MB through if you sized it for "100 jobs."
- `context` cancellation is first-class — a slow acquire times out cleanly.
- `defer p.sem.Release(size)` mirrors the acquire weight; *the bug-prone case is mismatched weights*. Linters and code review must catch this.

### Example 3 — Bulkhead refactor from `sync.Mutex` to per-tenant semaphores

Before — a single mutex serializes all tenant work:

```go
type Service struct {
    mu sync.Mutex
    db *DB
}

func (s *Service) Handle(tenantID string, req Request) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.db.Run(tenantID, req)
}
```

Symptoms: noisy tenant blocks everyone. Throughput is capped at 1.

After — per-tenant semaphores with a shared global cap:

```go
package svc

import (
    "context"
    "sync"

    "golang.org/x/sync/semaphore"
)

type Service struct {
    db          *DB
    globalSem   *semaphore.Weighted
    perTenant   sync.Map // tenantID -> *semaphore.Weighted
    perTenantN  int64
}

func NewService(db *DB, globalConcurrency, perTenantConcurrency int64) *Service {
    return &Service{
        db:         db,
        globalSem:  semaphore.NewWeighted(globalConcurrency),
        perTenantN: perTenantConcurrency,
    }
}

func (s *Service) tenantSem(tenantID string) *semaphore.Weighted {
    if v, ok := s.perTenant.Load(tenantID); ok {
        return v.(*semaphore.Weighted)
    }
    sem := semaphore.NewWeighted(s.perTenantN)
    actual, _ := s.perTenant.LoadOrStore(tenantID, sem)
    return actual.(*semaphore.Weighted)
}

func (s *Service) Handle(ctx context.Context, tenantID string, req Request) error {
    tSem := s.tenantSem(tenantID)

    // Acquire tenant slot first — fail fast for noisy tenants.
    if err := tSem.Acquire(ctx, 1); err != nil {
        return err
    }
    defer tSem.Release(1)

    // Then the global slot — protects the shared backend.
    if err := s.globalSem.Acquire(ctx, 1); err != nil {
        return err
    }
    defer s.globalSem.Release(1)

    return s.db.Run(tenantID, req)
}
```

Design notes:

- Acquire order matters. Always acquire **tenant before global** so a noisy tenant's queue does not consume global capacity.
- `sync.Map.LoadOrStore` avoids a "first writer wins, others discard" race when two requests for a new tenant arrive simultaneously.
- Eviction of unused tenant semaphores is omitted for brevity — in production, attach a TTL and a background sweeper to bound memory.

### Example 4 — Async semaphore with task cancellation in Rust (Tokio)

```rust
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Semaphore, AcquireError};
use tokio::time::timeout;

#[derive(Clone)]
pub struct UploadGate {
    sem: Arc<Semaphore>,
}

impl UploadGate {
    pub fn new(max_in_flight: usize) -> Self {
        Self { sem: Arc::new(Semaphore::new(max_in_flight)) }
    }

    pub async fn upload(&self, payload: Vec<u8>) -> Result<UploadResult, UploadError> {
        // Acquire with timeout. If cancelled or timed out,
        // Tokio cleans the waiter from the queue automatically.
        let permit = match timeout(Duration::from_millis(500),
                                   self.sem.clone().acquire_owned()).await {
            Ok(Ok(p)) => p,
            Ok(Err(_)) => return Err(UploadError::Closed),
            Err(_) => return Err(UploadError::Timeout),
        };

        // Permit dropped at end of scope, even on panic.
        let _guard = permit;
        do_upload(payload).await.map_err(UploadError::Io)
    }

    pub fn close(&self) { self.sem.close(); }
}

pub struct UploadResult { /* ... */ }

#[derive(Debug)]
pub enum UploadError {
    Timeout,
    Closed,
    Io(std::io::Error),
}

async fn do_upload(_payload: Vec<u8>) -> std::io::Result<UploadResult> {
    tokio::time::sleep(Duration::from_millis(50)).await;
    Ok(UploadResult {})
}
```

Why this is senior-grade:

- `acquire_owned` returns an `OwnedSemaphorePermit` you can move across `.await` points or into spawned tasks.
- Wrapping with `tokio::time::timeout` gives bounded waits.
- `close()` enables graceful shutdown — pending and future acquires return `AcquireError` so callers can drain.
- No `release` calls at all. RAII does the work.

---

## Pros & Cons

**Pros**

- Tiny, well-understood primitive.
- O(1) acquire and release on the fast path.
- Decouples concurrency limit from the resource itself.
- Works across threads, tasks, and (in System V / POSIX form) processes.
- Foundational building block for bulkheads and pools.

**Cons**

- No ownership semantics — anyone can release.
- No fairness by default in most implementations.
- Encourages "limit concurrency" thinking even when "limit rate" or "queue work" is the right problem.
- Pernicious leak bugs accumulate slowly.
- Inspecting the count gives stale information; not safe as a metric source.
- Nested acquires across subsystems lead to multi-resource deadlock.

---

## Use Cases

| Use case | Why semaphore fits |
|---|---|
| **DB connection pool gate** | Fixed count of physical connections; concurrent borrowers; no ordering needed. |
| **External API bulkhead** | Limit in-flight calls to a partner so they cannot drown your worker pool. |
| **GPU job admission** | N workers, jobs queue at the semaphore; concurrent execution capped. |
| **Memory budget enforcement** | Weighted semaphore on bytes; reject or wait for budget. |
| **Per-tenant fairness** | Per-tenant semaphores + global semaphore prevent noisy-neighbor cascades. |
| **Graceful shutdown gate** | Closeable semaphore (Tokio) stops new acquires; drain in-flight. |
| **Test concurrency limits** | Force exactly N concurrent test workers without rebuilding pool infra. |

---

## Coding Patterns

### Pattern 1 — Guard object (RAII)

Always express acquire/release as a guard whose destructor releases. Examples: Rust `OwnedSemaphorePermit`, C++ `lock_guard`-style wrappers, Go `defer sem.Release(1)`. This eliminates the "forgot to release on exception" bug class.

### Pattern 2 — Acquire with timeout

Every production acquire should be time-bounded. An unbounded `acquire()` hides starvation as latency. Use:

- Java: `tryAcquire(timeout, unit)`.
- Go: `Acquire(ctx, n)` with `context.WithTimeout`.
- Rust: `tokio::time::timeout`.
- .NET: `WaitAsync(timeout)`.

### Pattern 3 — Composed bulkhead + circuit breaker + retry

Compose policies in this order:

```
[retry] -> [circuit breaker] -> [bulkhead] -> [timeout] -> [downstream]
```

- **Retry** re-enters from the top; should be outermost.
- **Circuit breaker** rejects fast when the downstream is unhealthy.
- **Bulkhead** prevents thread exhaustion.
- **Timeout** caps individual call duration.

Putting bulkhead outside circuit breaker means rejected fast-failures still consume bulkhead capacity — usually wrong.

### Pattern 4 — Per-tenant + global semaphore

Two-tier acquire: tenant slot first (fail fast for noisy tenant), then global slot (protect shared backend). Release in reverse order. The pattern in Example 3.

### Pattern 5 — Closeable semaphore for shutdown

Expose `close()` that poisons the semaphore. New acquires fail; outstanding permits drain naturally. Wait for permit count to return to `max` before exiting. Tokio's design encodes this directly.

---

## Clean Code

- **Name what the count means in domain terms**: `paymentBulkhead`, not `sem1`. The name should answer "of what?"
- **Co-locate the semaphore with the resource it guards.** A semaphore floating in a global utils package is a sign of a missing abstraction.
- **Wrap acquire and release together** in a guard. A free `release` call anywhere in the code base is suspicious.
- **Log rejections, not acquires.** Acquires are fast-path and high-volume; rejections are the signal.
- **Expose metrics on the wrapper, not the semaphore.** `bulkhead.rejected{name=payments}` is a stable contract; `Semaphore.availablePermits()` is an implementation detail.
- **Document the size choice.** "Set to 20 because partner API rejects >25 concurrent" — written next to the constant, not lost in a runbook.

---

## Best Practices

1. **Always pair acquire and release with a guard.** Eliminate the manual `release` from your code base where possible.
2. **Bound every acquire with a timeout** in production code paths.
3. **Use weighted semaphores when cost is non-uniform.** A 1MB and 1GB request are not equal.
4. **Separate bulkheads per dependency** to localize saturation.
5. **Order nested acquires consistently** to avoid deadlock.
6. **Publish metrics on rejections, queue depth (if your wrapper has one), and wait time.**
7. **Plan for graceful shutdown.** Use a closeable semaphore or equivalent.
8. **Never inspect `availablePermits()` for control flow** — it is stale by the time you read it.
9. **Prefer ecosystem libraries** (Polly, Resilience4j, Tokio's `Semaphore`) over hand-rolled implementations.
10. **Reserve raw mutexes for mutual exclusion.** Reserve semaphores for capacity governance.

---

## Edge Cases & Pitfalls

- **Acquire across `await` / `yield`** — be deliberate. The permit is held while the task is suspended. Long awaits while holding a permit silently consume capacity.
- **Cancellation while waiting** — verify your runtime cleans up cancelled waiters. Older implementations leak.
- **Permits dropped in destructors during panic / exception** — Rust handles this cleanly; Java requires try-finally; Python's `async with` handles it; ad-hoc C++ does not.
- **`fork()` interaction (System V)** — child inherits the semaphore set ID but not undo lists in the way you expect. POSIX named semaphores are clearer here.
- **Container memory limits** — a semaphore of 1000 means nothing if the OS kills you at 900 connections of memory pressure. Size to *physical* resource limits, not aspiration.
- **Permit count is not a real-time gauge.** Inspecting it for autoscaling decisions creates feedback loops.
- **Re-entrancy** — semaphores are not reentrant. A binary semaphore acquired twice by the same thread deadlocks.

---

## Common Mistakes

| Mistake | What goes wrong | Fix |
|---|---|---|
| Releasing inside the body, not in `finally` | Permit leak on exception | Release in `finally` or use guard |
| Acquiring N, releasing 1 | Counter drifts up | Match weights exactly; assert in tests |
| Using semaphore to limit calls/sec | Doesn't; limits in-flight count | Use token/leaky bucket |
| Reading `availablePermits` for metric | Sample is stale; misleading dashboards | Track rejections and wait time |
| Bulkhead outside breaker outside retry | Bad policy ordering | retry > breaker > bulkhead > timeout |
| One global semaphore guarding many dependencies | One slow dep blocks all | One bulkhead per dependency |
| Holding a permit across a long await/sleep | Starves other callers | Release before slow waits |

---

## Tricky Points

- **Async semaphores and structured concurrency.** Cancelling a parent task should cancel children waiting on a semaphore. Tokio handles this; some Python implementations did not until 3.11.
- **Permit ownership crossing task boundaries.** `acquire_owned` lets you pass a permit into a spawned task. Useful, but the permit's lifetime is now disconnected from the caller's scope — easier to leak if you do not enforce drop discipline.
- **Backpressure shape.** A bulkhead bounded by `maxWait=0` is fast-fail. A bulkhead bounded by `maxWait=Inf` is unbounded queue. Real systems sit in the middle and the right midpoint is workload-dependent.
- **Bulkhead size vs queue size.** Both are knobs. Total in-flight ≈ workers + queued. A 20-worker / 50-queue bulkhead can have 70 pending requests; size your timeouts accordingly.
- **Releasing more than you acquired.** Some libraries allow it (Java's `Semaphore.release(n)` raises the counter); some do not (Tokio's permits are typed). Know yours.
- **Permit cost negotiation.** When weights are dynamic (request size only known after partial read), you may need to over-reserve then refund the difference. Design the API to support `release(actual)` after `acquire(estimate)`.

---

## Test Yourself

1. Why did Dijkstra name the operations P and V?
2. What does `SEM_UNDO` do, and what failure mode does it try to prevent?
3. Why is Resilience4j's `Bulkhead` not just a thin wrapper around `Semaphore`?
4. When is a token bucket strictly better than a semaphore?
5. Why is `Semaphore.availablePermits()` unsafe to use for autoscaling decisions?
6. Describe the bulkhead pattern in one sentence.
7. What does `acquire_owned` enable in Tokio that `acquire` does not?
8. Why is "release in body, not in finally" the most common semaphore bug?
9. What ordering should you apply to retry, circuit breaker, bulkhead, and timeout in a policy chain?
10. Why does using a semaphore as a mutex lose ownership safety?
11. When is a weighted semaphore the right primitive?
12. Why should per-tenant semaphores be acquired *before* the global one?
13. What does it mean to "close" a Tokio semaphore, and why does that help shutdown?
14. Why does inspecting permit count for metrics produce misleading dashboards?

---

## Tricky Questions

**Q1. You inherit a service with a `Semaphore(1)` everywhere. Should you migrate to mutexes?**
Usually yes. A binary semaphore loses ownership safety — any thread can release. A mutex provides ownership, often reentrancy, and clearer intent. Exception: when you genuinely need cross-thread signal/release (one thread acquires, another releases), the semaphore is correct.

**Q2. Your bulkhead's rejection rate is 0% but P99 latency is 10s. Is the bulkhead working?**
Yes — and it is misconfigured. Zero rejections plus high latency means callers are queuing forever. Add `maxWaitDuration`. The bulkhead's job is to fail fast when saturated, not to absorb unbounded queue.

**Q3. Two semaphores `A` and `B`. Workers acquire A then B; cleanup acquires B then A. What happens?**
Classic AB-BA deadlock. Enforce a global lock order or use a single primitive that acquires both atomically.

**Q4. Why do production teams sometimes prefer thread-pool bulkheads over semaphore bulkheads?**
Thread-pool bulkheads isolate the *thread* and its stack from the caller. If the downstream blocks, the bulkhead's threads block, not yours. The semaphore version blocks the caller's thread. Cost: extra context switching, harder propagation of `ThreadLocal` and request context.

**Q5. A weighted semaphore of 100 has callers acquiring weights 60 and 50. Both wait. A 30-weight caller arrives. Should it be allowed to proceed?**
Depends on fairness mode. Strict FIFO fairness says no, even though 30 fits in current capacity (40 free). Non-fair mode says yes, but causes potential starvation of the larger waiters. Most production code chooses fair to keep latency predictable.

**Q6. Your async semaphore is implemented with a `Mutex<VecDeque<Waker>>`. What problem might appear under cancellation?**
If cancelled waiters do not remove themselves, the deque grows monotonically — a memory leak invisible to permit counts. Tokio addresses this with intrusive doubly-linked lists in the waiter so cancellation removes in O(1). Hand-rolled implementations often miss this.

**Q7. Why might `SEM_UNDO` fail to prevent leaks despite being designed to?**
Several reasons: undo lists have configurable max size; a process that exits via `_exit` may bypass it depending on kernel; undo entries are per-process not per-thread, so a thread crash leaves orphaned permits; a fork inherits IDs but not undo state in some kernels.

**Q8. Convert "max 1000 calls/second" into a semaphore. Can you?**
Not directly. A semaphore limits concurrency. If average call latency is 100ms, a semaphore of 100 yields 1000 calls/sec — but only because of the latency. If latency drops to 10ms, you suddenly accept 10,000/sec. Use a token bucket for rate.

---

## Cheat Sheet

```
SEMAPHORE — THE PROFESSIONAL VIEW

PICK A SEMAPHORE WHEN
  + The question is "how many at once?"
  + Resource has a hard count or weight cap
  + No ordering or priority needed
  + No need to inspect who is waiting

PICK SOMETHING ELSE WHEN
  Mutex            -> exclusive ownership of a section
  Channel/Queue    -> handoff, ordering, priority
  Token bucket     -> calls per second with burst
  Leaky bucket     -> smoothed outbound rate
  Actor mailbox    -> queued work + concurrency limit + observable depth
  sync.Once        -> one-time init

PRODUCTION CHECKLIST
  [ ] Acquire is bounded by timeout or context
  [ ] Release is in a guard / finally / defer
  [ ] Weights match between acquire and release
  [ ] Rejections are logged and metered
  [ ] Bulkhead has a name visible on dashboards
  [ ] Per-dependency bulkheads, not one global
  [ ] Graceful shutdown drains permits
  [ ] Cancellation cleans up waiters

ANTI-PATTERNS
  - Semaphore-as-mutex
  - Release without acquire
  - Reading availablePermits for control flow
  - Permit held across long awaits
  - Global semaphore for all dependencies
  - Using semaphore to enforce calls/sec
```

---

## Summary

The semaphore is sixty years old and still earning its keep. At the professional level you treat it as a piece of system architecture: a counter that becomes a *governance policy* when you wrap it with names, timeouts, rejection metrics, and observability. The Bulkhead pattern packages this into a reusable unit; libraries like Polly and Resilience4j codify the wrapper so applications never see a raw `Semaphore`.

You also know when to walk away. A token bucket beats a semaphore for rate. A channel beats it for handoff. A mutex beats it for exclusion. An actor mailbox beats it when work needs to queue and be inspected. Choosing the right primitive is what separates a senior implementation from a professional one.

System V semaphores, with their `SEM_UNDO` and IPC set semantics, remain the educational touchstone for what *not* to expose to application authors. Modern designs — Go's weighted context-aware semaphore, Tokio's owned permits with cancellation — show what mature library APIs look like: cancellable, costed, RAII-guarded, observable.

---

## What You Can Build

- **A library-grade bulkhead** for your language of choice, including named instances, fair/unfair modes, configurable timeout, and Prometheus metrics.
- **A weighted resource budget** (memory, bandwidth, GPU minutes) admission controller.
- **A migration tool** that scans a code base for `Semaphore(1)` uses and proposes mutex replacements with diff suggestions.
- **A per-tenant fairness layer** for a multi-tenant API gateway combining per-tenant and global semaphores with eviction.
- **A graceful shutdown coordinator** built on closeable semaphores that drains in-flight requests on SIGTERM.
- **A "bulkhead lint"** static analyzer that flags acquire without matched release, release-in-non-finally, and `availablePermits` calls used for control flow.

---

## Further Reading

- Edsger W. Dijkstra. *Cooperating Sequential Processes* (EWD123, 1965). The original semaphore paper. Available via the E. W. Dijkstra Archive at the University of Texas at Austin.
- Gregory R. Andrews. *Concurrent Programming: Principles and Practice* (Benjamin/Cummings, 1991). The most thorough treatment of synchronization primitives outside Tanenbaum.
- Maurice Herlihy and Nir Shavit. *The Art of Multiprocessor Programming*, 2nd ed. Chapters on synchronization and semaphores.
- Michael Nygard. *Release It!*, 2nd ed. The Bulkhead pattern in context with other stability patterns.
- Resilience4j documentation: <https://resilience4j.readme.io/docs/bulkhead>.
- Polly documentation: <https://www.pollydocs.org/strategies/rate-limiter.html>.
- Go semaphore package: <https://pkg.go.dev/golang.org/x/sync/semaphore>.
- Tokio `Semaphore` reference: <https://docs.rs/tokio/latest/tokio/sync/struct.Semaphore.html>.
- Linux `semop(2)`, `semget(2)`, `semctl(2)` man pages — for the System V deep dive.
- POSIX `sem_overview(7)` — POSIX semaphores.

---

## Related Topics

- [Mutex](../01-mutex/README.md) — exclusive ownership.
- [Condition Variable](../03-condition-variable/README.md) — signal on state change.
- [Channels and Queues](../../03-coordination/README.md) — handoff and queuing.
- [Bulkhead Pattern](../../../../design-patterns-in-go/README.md) — resilience packaging.
- [Token Bucket and Rate Limiters](../../../distributed-systems/rate-limiting/README.md) — rate vs concurrency.
- [Circuit Breaker](../../../distributed-systems/resilience/circuit-breaker/README.md) — fast-failing dependencies.
- [Actor Model](../../03-coordination/04-actor-model/README.md) — alternative to nested semaphores.

---

## Diagrams & Visual Aids

### Diagram 1 — Bulkhead as failure isolation

```
                +---------------+
   client ----> | payment       |  <-- paymentBulkhead (20 slots)
                +---------------+
                +---------------+
   client ----> | inventory     |  <-- inventoryBulkhead (50 slots)
                +---------------+
                +---------------+
   client ----> | search        |  <-- searchBulkhead (100 slots)
                +---------------+

If 'payment' degrades, its 20 slots saturate.
'inventory' and 'search' keep serving — no thread-pool starvation.
```

### Diagram 2 — Policy composition order

```
   request
     |
     v
  +--------+
  | retry  |   re-issues on transient failure
  +--------+
     |
     v
  +-------------------+
  | circuit breaker   |  fast-fails when downstream unhealthy
  +-------------------+
     |
     v
  +----------+
  | bulkhead |   caps concurrent calls
  +----------+
     |
     v
  +----------+
  | timeout  |   caps single call duration
  +----------+
     |
     v
  downstream
```

### Diagram 3 — Semaphore vs token bucket vs leaky bucket

```
SEMAPHORE (concurrency)            TOKEN BUCKET (rate + burst)
  in-flight: ###...                  tokens: [#####.....]
  cap = 5                            refill 1/100ms, cap 10
  acquires block when full           acquires block when empty

LEAKY BUCKET (smoothed rate)
  queue: [a][b][c][d]
  drain 1 per 100ms
  callers wait in order
```

### Diagram 4 — Per-tenant + global semaphore acquire order

```
   request(tenantID)
     |
     v
   acquire tenantSem[tenantID]     # fail fast for noisy tenant
     |
     v
   acquire globalSem               # protect shared backend
     |
     v
   work
     |
     v
   release globalSem
     |
     v
   release tenantSem
```

### Diagram 5 — Graceful shutdown with closeable semaphore

```
   sem.close()                  # new acquires fail
     |
     v
   wait for outstanding permits to drop
     |
     v
   permits returned to max
     |
     v
   safe to exit
```

### Diagram 6 — Permit leak vs over-release

```
LEAK                                  OVER-RELEASE
acquire  acquire  acquire             acquire   release   release
   |        |        X                   |         |         |
   |        release                      release   (extra)   (extra)
   release  (forgot)                     counter grows past max
counter slowly drifts to zero         apparent "cap" is a lie
service freezes                       overload despite "limit"
```
