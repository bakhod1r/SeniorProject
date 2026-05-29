# Semaphore — Senior Level

> **Topic:** [Semaphore](README.md)
> **Focus:** OS implementation, scaling, weighted fair queueing

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

At the junior level a semaphore is "a counter that gates N goroutines". At the middle level you learned how `golang.org/x/sync/semaphore` implements weighted permits with a FIFO waiter list. At the senior level the semaphore stops being a primitive you use and becomes a primitive you design — and you design it not in isolation but as a fairness policy, a backpressure boundary, and a resource governor sitting between your service and a finite physical thing: a database connection slot, a kernel file descriptor, a downstream API quota, a GPU.

This document explores the semaphore the way a kernel engineer, a runtime engineer, and a backend platform engineer use it. We start with the Linux `sem_t` implementation backed by `futex`, walk through System V vs POSIX semaphores, explore weighted fair queueing, then move to production patterns: connection pools, async semaphores with cancellation, backpressure under overload, and the deadlock class that comes from over-releasing permits. By the end you should be able to design a semaphore-backed admission controller for a high-traffic service and reason precisely about its failure modes.

The key shift from middle to senior is that you stop thinking "how do I use a semaphore" and start thinking "is a semaphore the right primitive for this problem, what fairness guarantees do I owe my callers, and what happens when the system is past saturation?"

---

## Prerequisites

You should be comfortable with:

- Junior and middle Semaphore content, especially weighted semaphores and fair queueing
- [Mutex Senior](../01-mutex/senior.md) — futex internals, lock contention profiling
- Linux kernel basics: `futex(2)`, scheduler wakeups, run queues
- Go runtime: `runtime.Semacquire`/`Semrelease`, goroutine parking
- HTTP servers, connection pools, and rate limiting fundamentals
- Backpressure as a concept (queue length, Little's Law, latency under load)
- Cancellation semantics: `context.Context` in Go, `CancellationToken` in .NET, `AbortSignal` in JS

If you have not read [Mutex Senior](../01-mutex/senior.md) the futex section here will move quickly.

---

## Glossary

- **Permit** — a unit of capacity granted by the semaphore; analogous to a ticket
- **Weight** — number of permits a single acquire consumes (weighted semaphore)
- **Futex** — fast userspace mutex syscall on Linux; the kernel primitive that backs most semaphores
- **POSIX semaphore** — IEEE 1003.1 standard: `sem_t`, `sem_wait`, `sem_post`, `sem_open`
- **System V semaphore** — older Unix IPC semaphore API: `semget`, `semop`, `semctl`
- **Named semaphore** — a semaphore identified by a filesystem-like name, shared across processes
- **Unnamed semaphore** — a semaphore embedded in shared memory; lifetime tied to the memory region
- **Weighted fair queueing (WFQ)** — scheduling discipline that gives each class a share proportional to its weight
- **Backpressure** — a feedback signal that tells producers to slow down because consumers are saturated
- **TryAcquire** — non-blocking acquire that returns immediately with success or failure
- **Admission control** — deciding at the ingress whether to accept a request based on system state
- **Resource governor** — a component that bounds the consumption of a finite resource
- **Cancellation propagation** — making a blocked acquire abort cleanly when its caller is cancelled
- **Over-release** — calling `Release` more times than `Acquire`, inflating capacity beyond the limit
- **Sticky permit** — a permit that is held longer than the work that justified acquiring it
- **Permit leak** — failing to release a permit on error paths, depleting capacity over time

---

## Core Concepts

### Linux `sem_t` Implementation — Futex-Backed Wait Queue

The POSIX `sem_t` on Linux glibc is roughly a struct containing an atomic counter and a futex word. The fast paths avoid the kernel entirely:

- `sem_wait`: atomic decrement the counter. If the result is non-negative, return. Otherwise call `futex(FUTEX_WAIT)` until somebody posts.
- `sem_post`: atomic increment. If there were waiters (visible via a flag bit), call `futex(FUTEX_WAKE, 1)` to wake one.

The crucial properties:

1. **Uncontended `sem_wait` and `sem_post` are user-space atomic ops** — typically a single locked instruction on x86, costing ~10-20 nanoseconds. No syscall, no scheduler involvement.
2. **The waiter queue lives in the kernel**, not in glibc. The kernel hash-table-keyed-by-virtual-address futex queue holds the waiters. This means waiter count is not visible from user space without a syscall.
3. **`FUTEX_WAKE` does not transfer the permit directly** — it just wakes a thread, which then re-runs `sem_wait` semantics. This is why naive semaphore implementations can suffer from "stolen wakeup" (a brand-new caller acquires the permit before the woken waiter resumes).
4. **No fairness guarantee** in the kernel futex queue by default. Modern kernels approximate FIFO via the plist, but `FUTEX_WAKE` does not promise the oldest waiter is woken first.

This is why high-quality semaphore libraries (Java's `Semaphore(fair=true)`, Go's `x/sync/semaphore`, .NET's `SemaphoreSlim`) implement their own FIFO waiter list in user space and use a single low-level lock or atomic CAS to manage it. They do not rely on the kernel for fairness.

### Named vs Unnamed Semaphores; Inter-Process Semaphores

POSIX defines two semaphore kinds:

- **Unnamed** (`sem_init(&sem, pshared, value)`) — lives in the memory you allocate. If `pshared=0`, only the creating process can use it. If `pshared=1`, you must place it in shared memory (typically `mmap(MAP_SHARED|MAP_ANONYMOUS)` or POSIX shm) and any process mapping that memory can use it.
- **Named** (`sem_open("/myname", flags, mode, value)`) — kernel-managed object identified by a name in a special namespace (under `/dev/shm` on Linux). Multiple processes call `sem_open` with the same name and get handles to the same semaphore.

Named semaphores are the standard way to coordinate fully unrelated processes (no shared memory, no parent-child relationship). They persist until explicitly `sem_unlink`'d, which is both a power and a footgun: a crashed process leaves the semaphore at whatever count it had, possibly stuck at zero.

Use cases for inter-process semaphores:

- Limiting concurrent invocations of a CLI tool across all shells on a host
- A native-code daemon coordinating with a sidecar
- Old-school job-control systems

Most modern services prefer a network-level limiter (Redis, Consul) over named semaphores because hosts come and go.

### System V Semaphores (Legacy)

The System V IPC interface (`semget`, `semop`, `semctl`) predates POSIX and is uglier but still found in legacy software and some Oracle/PostgreSQL internals.

Key differences from POSIX:

- **Semaphore sets** — `semget` returns an array of semaphores, not one. `semop` takes a list of operations, applied atomically.
- **SEM_UNDO** — you can tag an operation so the kernel automatically reverses it if the process dies. This solves the "process crashed holding the permit" problem that plagues POSIX semaphores.
- **Resource limits** — System V has system-wide limits (`SEMMNI`, `SEMMSL`, etc.) that are tunable but easy to hit.
- **Permissions** — Unix-style owner/group/mode on the IPC object.

You will rarely write new System V semaphore code, but you will read it. The `ipcs` and `ipcrm` commands let you inspect and clean up leaked System V objects.

### Semaphore-as-Channel in Go vs `x/sync/semaphore`

Go has two idiomatic ways to bound concurrency:

```go
// (A) Buffered channel as semaphore
sem := make(chan struct{}, 10)
sem <- struct{}{}    // Acquire
// ... work ...
<-sem                // Release

// (B) golang.org/x/sync/semaphore
sem := semaphore.NewWeighted(10)
sem.Acquire(ctx, 1)
// ... work ...
sem.Release(1)
```

When is each faster or better?

| Property                     | Channel semaphore        | `x/sync/semaphore`         |
|------------------------------|--------------------------|----------------------------|
| Weighted permits             | No (1 per slot only)     | Yes                        |
| Context cancellation         | Manual via `select`      | Built-in                   |
| Fairness                     | FIFO (channel guarantees)| FIFO (explicit waiter list)|
| Uncontended cost             | ~25-40 ns                | ~30-50 ns                  |
| Contended cost               | Channel scheduler        | Mutex + waiter cond        |
| Allocation per acquire       | Zero                     | Zero                       |
| TryAcquire                   | `select { case ... default: }` | Yes              |

**Use a channel when:**
- Permits are uniform (always weight 1)
- You want to integrate with `select` for multiplexed waits
- You prefer zero external dependencies
- Cancellation flows naturally via `ctx.Done()` in `select`

**Use `x/sync/semaphore` when:**
- You need weighted permits (e.g., big requests consume more)
- You want native `ctx` integration without writing `select`
- You need TryAcquire as a first-class operation
- The code reads more clearly as `Acquire(ctx, n)` than channel gymnastics

For high-throughput hot paths with uniform permits, the channel is often a hair faster because it skips one indirection. For anything more complex than "max N concurrent", reach for `x/sync/semaphore`.

### Weighted Fair Queueing — Priority Among Waiters

Default FIFO is fair in arrival order but ignores that some classes of work matter more than others. WFQ assigns each class a weight; each class gets capacity proportional to its weight when contended, but a single class can still burst to full capacity when uncontended.

A semaphore with WFQ typically wraps two pools:

1. A **global** semaphore for total capacity
2. A **per-class** virtual time that determines wake order

In practice, sharded production systems often approximate WFQ with multiple separate semaphores per class, plus a smaller global cap. For instance: an API gateway might have a 1000-permit global semaphore plus per-tenant semaphores of 50 each; the per-tenant cap stops a single tenant from monopolizing, the global cap protects the backend.

True WFQ is necessary when classes are highly dynamic (you cannot pre-allocate per-class semaphores) — see the Linux CFQ disk scheduler or the HTB packet scheduler.

### Resource Governance: Connection Pools, FD Limits, RPC Concurrency

Semaphores are the canonical way to bound a finite resource. The pattern looks the same regardless of what is being bounded:

1. Define the resource limit (e.g., 100 DB connections, 1024 file descriptors, 50 in-flight RPCs).
2. Create a semaphore with that capacity.
3. Acquire before accessing the resource; release after returning it to its pool.
4. Make the acquire context-aware so callers can give up under load.

Examples:

- **Database connection pool**: a `sync.Pool` of connections plus a `semaphore.Weighted` of size `MaxOpenConns`. `database/sql` does exactly this internally.
- **File descriptor governor**: a service opening many sockets uses a semaphore of size `ulimit -n` minus headroom to avoid `EMFILE`.
- **RPC concurrency cap**: gRPC's `MaxConcurrentStreams` is effectively a semaphore enforced at HTTP/2 stream creation.

The semaphore is not the pool — it is the gate guarding the pool. Mixing the two confuses code review; keep them as separate concepts.

### Backpressure Semaphore Pattern (TryAcquire + Drop/503/Retry)

Under overload you have four options:

1. **Queue** — let callers wait. Latency explodes; eventually clients time out anyway, wasting work.
2. **Drop** — `TryAcquire` and return a synthetic "busy" error or HTTP 503. Caller decides whether to retry.
3. **Shed** — drop low-priority work first (requires class-aware semaphore).
4. **Slow** — reduce per-request work (e.g., serve cached/degraded responses). Often combined with shedding.

The backpressure semaphore pattern uses TryAcquire:

```go
if !sem.TryAcquire(1) {
    http.Error(w, "server busy", http.StatusServiceUnavailable)
    metrics.Shed.Inc()
    return
}
defer sem.Release(1)
// ... process ...
```

Critical: pair this with **client retry policies that include jitter and a circuit breaker**. Otherwise dropped requests stampede back as retries and amplify the overload.

### Async Semaphores and the Cancellation Problem

In async runtimes (Go's goroutines + `context`, .NET's `async/await` + `CancellationToken`, Rust's `tokio::sync::Semaphore` + `CancellationToken`), a waiting acquire must respond to cancellation. This sounds simple but hides subtle bugs.

Consider:

```go
err := sem.Acquire(ctx, 1)
if err != nil {
    return err   // ctx cancelled while waiting
}
```

The implementation must atomically:

1. Detect cancellation
2. Remove the waiter from the FIFO list
3. Decide: was this waiter about to be granted a permit? If yes, **transfer the permit to the next waiter**, not release it back as new capacity.

Bug class: if cancellation removes the waiter but a permit was already in flight, that permit is "lost" — capacity silently drops by one until process restart. The Go `x/sync/semaphore` handles this carefully: on cancellation it checks whether the waiter is at the head and was already granted; if so, it re-grants to the next waiter or releases.

In Rust `tokio`, semaphore permits are RAII handles (`SemaphorePermit`); dropping a future-being-awaited correctly returns the permit. This is a strong design.

### Deadlock From Semaphore Over-Release

Over-release is the dual of permit leak:

```go
sem := semaphore.NewWeighted(10)
// ...
sem.Release(1)   // BUG: nothing was acquired
```

The semaphore is now configured for capacity 10 but believes it has 11 free. The first 11 acquirers proceed; what was supposed to be 10 concurrent workers is now 11. If the gated resource has hard capacity 10, work 11 fails (e.g., `database is locked`). Worse, this masks: callers see intermittent failures, traces look normal, the bug hides in a defer chain you do not own.

Some libraries cap the counter at the initial weight to prevent over-release (Java's `Semaphore` does not; .NET's `SemaphoreSlim` allows but you specify both initial and max counts). Go's `x/sync/semaphore` does not cap and will silently inflate.

Defensive techniques:

- Use RAII wrappers (a typed permit handle whose `Close`/`Release` method is idempotent and checks a sentinel)
- Ban manual `Release` outside `defer` blocks via linter or convention
- Make the permit object unique-by-construction (factory returns an `&permit{}` only via `Acquire`)

### Profiling Semaphore Contention

You diagnose semaphore contention by measuring wait time, not just acquisition count:

- **Go**: `go tool pprof -block` (block profile) shows time spent blocked, including in `runtime.Semacquire`. Combine with `pprof.Lookup("goroutine")` to see who is stuck.
- **Linux**: `perf sched`, `perf lock`, eBPF tools like `offcputime` and `runqlat`.
- **Java**: JFR (Java Flight Recorder) `jdk.JavaMonitorWait` event, or async-profiler with `--event lock`.
- **Application metrics**: histogram of acquire latency, gauge of permits-in-use, counter of TryAcquire failures.

A healthy semaphore exhibits:

- Median acquire latency near zero (microseconds)
- P99 acquire latency below your timeout budget
- Permits-in-use rarely at capacity for sustained periods

If P99 wait climbs, your capacity is too low or your downstream is too slow. If permits-in-use is constantly at capacity, you have a queueing problem and adding more permits alone may not fix it — fix the downstream first.

---

## Real-World Analogies

- **Restaurant tables.** 20 tables, party of 4 wants to sit but only 3 tables are open: they wait. Now a party of 8 arrives wanting two adjacent tables — that is a weighted acquire requiring atomic acquisition of 2 permits. The host (semaphore) must hold the next 2 free tables for the bigger party even if smaller parties arrive meanwhile, to avoid starvation.
- **Airport runway.** A runway accepts one takeoff every 90 seconds. The control tower maintains a permit: only one aircraft taxis onto the runway at a time. Pilots that cannot wait (low fuel) declare priority — weighted fair queueing with class precedence.
- **Highway toll plaza.** 10 toll booths, 100 cars. The semaphore is the booth array; cars queue and take the next free booth. Express-pass cars use a separate, smaller semaphore — class-based admission.
- **Concert wristbands.** 5000 attendees, organizer prints 5000 wristbands. Once distributed, the bouncer (acquire) checks wristband presence. If a wristband is destroyed by accident (permit leak) capacity silently shrinks.

---

## Mental Models

### The Semaphore as a Budget

Think of a semaphore as a **monetary budget**. Acquire is "spend N dollars", release is "refund N dollars". The budget is shared across all callers. Two failure modes:

- Spend more than you refund (permit leak) — budget shrinks over time.
- Refund more than you spent (over-release) — budget grows beyond limit, overdraft.

This mental model immediately suggests "always refund what you spent, in `defer`/`finally`", which is the canonical pattern.

### The Semaphore as a Queue's Front Desk

A semaphore in front of a worker pool is a **front desk receptionist**. Visitors (requests) check in. If a desk attendant (permit) is free, the visitor goes through immediately. If not, they sit in the waiting room (waiter queue). Backpressure is the receptionist telling new visitors "we are full, come back later" instead of letting the waiting room overflow.

### The Resource Triangle

For any bounded resource you have three knobs:

```
        Capacity (permits)
              /\
             /  \
            /    \
           /      \
   Latency --------- Throughput
```

Semaphores let you trade among these. More permits = more throughput but also more queueing inside the downstream and higher tail latency. Fewer permits = lower latency under load but lower throughput. Picking the right number is a measurement problem, not a guessing problem.

---

## Code Examples

### 1. Rate Limiter as Semaphore + Token Bucket

A token bucket caps **rate** (tokens per second); a semaphore caps **concurrency**. Real services need both.

```go
package limiter

import (
    "context"
    "time"

    "golang.org/x/sync/semaphore"
    "golang.org/x/time/rate"
)

// AdmissionController caps both concurrency and rate.
type AdmissionController struct {
    concurrency *semaphore.Weighted
    rate        *rate.Limiter
}

func NewAdmissionController(maxInFlight int64, rps float64, burst int) *AdmissionController {
    return &AdmissionController{
        concurrency: semaphore.NewWeighted(maxInFlight),
        rate:        rate.NewLimiter(rate.Limit(rps), burst),
    }
}

// Admit blocks until both a concurrency permit and a rate token are available,
// or ctx is cancelled. Returns a release function the caller must invoke.
func (a *AdmissionController) Admit(ctx context.Context) (release func(), err error) {
    if err := a.rate.Wait(ctx); err != nil {
        return nil, err
    }
    if err := a.concurrency.Acquire(ctx, 1); err != nil {
        return nil, err
    }
    return func() { a.concurrency.Release(1) }, nil
}

// TryAdmit is the backpressure variant.
func (a *AdmissionController) TryAdmit() (release func(), ok bool) {
    if !a.rate.Allow() {
        return nil, false
    }
    if !a.concurrency.TryAcquire(1) {
        return nil, false
    }
    return func() { a.concurrency.Release(1) }, true
}

// Example HTTP handler usage:
//
//   release, ok := ac.TryAdmit()
//   if !ok {
//       http.Error(w, "busy", http.StatusServiceUnavailable)
//       return
//   }
//   defer release()
//   // ... handle ...
var _ = time.Second
```

### 2. SQL Connection Pool with Weighted Permits

Some queries are heavier than others. Bulk loads should not exhaust the pool. Use weighted acquire.

```go
package dbpool

import (
    "context"
    "database/sql"
    "fmt"

    "golang.org/x/sync/semaphore"
)

type WeightedPool struct {
    db        *sql.DB
    permits   *semaphore.Weighted
    maxWeight int64
}

func NewWeightedPool(db *sql.DB, totalPermits int64) *WeightedPool {
    return &WeightedPool{
        db:        db,
        permits:   semaphore.NewWeighted(totalPermits),
        maxWeight: totalPermits,
    }
}

// QueryClass describes how heavy a query is.
type QueryClass int

const (
    ClassLight QueryClass = 1  // simple OLTP read
    ClassMedium QueryClass = 5 // small report
    ClassHeavy QueryClass = 25 // bulk export
)

func (p *WeightedPool) Exec(ctx context.Context, class QueryClass, query string, args ...any) error {
    weight := int64(class)
    if weight > p.maxWeight {
        return fmt.Errorf("query class %d exceeds pool capacity %d", weight, p.maxWeight)
    }
    if err := p.permits.Acquire(ctx, weight); err != nil {
        return err
    }
    defer p.permits.Release(weight)

    _, err := p.db.ExecContext(ctx, query, args...)
    return err
}
```

A heavy bulk export takes 25 permits, so only 4 can run concurrently against a 100-permit pool, leaving 0 for the unlucky 5th — by design. Light reads run hundreds in parallel.

### 3. Backpressure-Aware HTTP Gateway

A gateway in front of a slow downstream. Under sustained overload we shed instead of queueing.

```go
package gateway

import (
    "context"
    "net/http"
    "time"

    "golang.org/x/sync/semaphore"
)

type Gateway struct {
    upstream     http.Handler
    inflight     *semaphore.Weighted
    waitBudget   time.Duration
    sheddingMode bool
}

func New(upstream http.Handler, maxInflight int64, waitBudget time.Duration) *Gateway {
    return &Gateway{
        upstream:   upstream,
        inflight:   semaphore.NewWeighted(maxInflight),
        waitBudget: waitBudget,
    }
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // Hard shed if explicitly enabled (e.g., feature flag from ops).
    if g.sheddingMode {
        if !g.inflight.TryAcquire(1) {
            shed(w, "shedding-mode")
            return
        }
        defer g.inflight.Release(1)
        g.upstream.ServeHTTP(w, r)
        return
    }

    // Normal path: bounded wait.
    ctx, cancel := context.WithTimeout(r.Context(), g.waitBudget)
    defer cancel()

    if err := g.inflight.Acquire(ctx, 1); err != nil {
        shed(w, "wait-timeout")
        return
    }
    defer g.inflight.Release(1)

    g.upstream.ServeHTTP(w, r.WithContext(r.Context()))
}

func shed(w http.ResponseWriter, reason string) {
    w.Header().Set("Retry-After", "1")
    w.Header().Set("X-Shed-Reason", reason)
    w.WriteHeader(http.StatusServiceUnavailable)
    _, _ = w.Write([]byte("server busy"))
}
```

Note the bounded wait via `context.WithTimeout`. Without it, you lose the difference between "I will wait forever" and "I will wait until my SLA expires".

### 4. Async Semaphore with Cancellation (Manual Implementation)

A teaching implementation showing how to handle cancellation correctly. Production code should use `x/sync/semaphore`, but writing this once teaches the invariants.

```go
package asyncsem

import (
    "container/list"
    "context"
    "sync"
)

type waiter struct {
    n     int64
    ready chan struct{} // closed when permits granted
}

type Semaphore struct {
    mu       sync.Mutex
    capacity int64
    used     int64
    waiters  list.List
}

func New(capacity int64) *Semaphore {
    return &Semaphore{capacity: capacity}
}

func (s *Semaphore) Acquire(ctx context.Context, n int64) error {
    s.mu.Lock()
    if s.used+n <= s.capacity && s.waiters.Len() == 0 {
        s.used += n
        s.mu.Unlock()
        return nil
    }
    w := &waiter{n: n, ready: make(chan struct{})}
    elem := s.waiters.PushBack(w)
    s.mu.Unlock()

    select {
    case <-w.ready:
        return nil
    case <-ctx.Done():
        s.mu.Lock()
        select {
        case <-w.ready:
            // We were granted right before cancellation; honor the grant
            // by releasing it cleanly so the next waiter gets a chance.
            s.mu.Unlock()
            s.Release(n)
            return ctx.Err()
        default:
            s.waiters.Remove(elem)
            // Cancellation may have left earlier waiters blocked because we
            // were at the head with weight too large. Re-poke the queue.
            s.dispatchLocked()
            s.mu.Unlock()
            return ctx.Err()
        }
    }
}

func (s *Semaphore) Release(n int64) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.used -= n
    if s.used < 0 {
        panic("asyncsem: negative permit count (over-release)")
    }
    s.dispatchLocked()
}

func (s *Semaphore) dispatchLocked() {
    for s.waiters.Len() > 0 {
        front := s.waiters.Front()
        w := front.Value.(*waiter)
        if s.used+w.n > s.capacity {
            return // head of queue cannot be served; do not skip (FIFO)
        }
        s.used += w.n
        s.waiters.Remove(front)
        close(w.ready)
    }
}
```

Walk through the cancellation branch carefully. Three things happen:

1. We acquired the lock to inspect state.
2. We re-checked the `ready` channel **inside** the lock. If a `Release` happened between our `ctx.Done()` firing and us getting the lock, we may have been granted. We honor the grant (releasing it on the next waiter's behalf) rather than dropping the permit.
3. If we were truly waiting, we remove ourselves from the list and call `dispatchLocked` — head-of-line removal might have freed enough room for a tail waiter (no, FIFO: the next head must be served first; but the next head's weight may be smaller than ours and now fits).

This is the standard pattern. If you write your own semaphore and skip step 2, you have introduced the permit-loss bug.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Bounded resource consumption without explicit polling | Easy to over- or under-release silently |
| Natural backpressure boundary via TryAcquire | Default kernel-level FIFO is best-effort |
| Composable with `context` for clean cancellation | Permit leaks shrink capacity invisibly |
| Cheap on the fast path (uncontended atomic) | Heavy contention turns into kernel queueing |
| Inter-process via named semaphores | Crashed holder = stuck permit unless SEM_UNDO |
| Weighted variant supports heterogeneous workloads | Weighted fairness is harder to reason about |

---

## Use Cases

- Connection pool size cap (databases, HTTP clients, gRPC channels)
- File descriptor / socket budget for a service
- Limiting concurrent invocations of a downstream API to its quota
- Worker pool size enforcement
- Admission control on an HTTP/gRPC server (TryAcquire + 503)
- Per-tenant concurrency caps in a multi-tenant gateway
- Memory budget enforcement (each task takes weight proportional to its working set)
- GPU job scheduling (each job consumes a fraction of memory or compute units)
- Coordinated shutdown: drain pending work without accepting new work
- Inter-process serialization of an exclusive on-disk operation (named semaphore)

---

## Coding Patterns

### Pattern: Acquire-Defer-Release

```go
if err := sem.Acquire(ctx, 1); err != nil {
    return err
}
defer sem.Release(1)
```

`defer` immediately after acquire is the single rule that prevents 80% of bugs.

### Pattern: TryAcquire-or-Shed

```go
if !sem.TryAcquire(1) {
    metrics.Shedded.Inc()
    return ErrBusy
}
defer sem.Release(1)
```

### Pattern: Bounded-Wait Acquire

```go
ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
defer cancel()
if err := sem.Acquire(ctx, 1); err != nil {
    return ErrTimeout
}
defer sem.Release(1)
```

### Pattern: Permit Handle (RAII)

```go
type Permit struct {
    sem      *semaphore.Weighted
    n        int64
    released bool
}

func (p *Permit) Release() {
    if p.released {
        return
    }
    p.released = true
    p.sem.Release(p.n)
}

func Acquire(ctx context.Context, sem *semaphore.Weighted, n int64) (*Permit, error) {
    if err := sem.Acquire(ctx, n); err != nil {
        return nil, err
    }
    return &Permit{sem: sem, n: n}, nil
}
```

Idempotent Release defends against accidental double-release.

### Pattern: Per-Class Semaphore Pool

```go
type ClassLimiter struct {
    global *semaphore.Weighted
    classes map[string]*semaphore.Weighted
}

func (l *ClassLimiter) Acquire(ctx context.Context, class string) error {
    sub := l.classes[class]
    if err := sub.Acquire(ctx, 1); err != nil {
        return err
    }
    if err := l.global.Acquire(ctx, 1); err != nil {
        sub.Release(1)
        return err
    }
    return nil
}
```

Always acquire in the same order across all classes to avoid the per-class/global deadlock (acquire class first, then global — release in reverse).

### Pattern: Drain

```go
func (g *Gateway) Shutdown(ctx context.Context) error {
    return g.inflight.Acquire(ctx, g.capacity)
}
```

Acquiring the full capacity blocks until every in-flight request finishes.

---

## Clean Code

- **Name the semaphore by what it gates**: `dbConnPermits`, `gpuSlots`, `inflightRequests`. Not `sem`, `mu`, `limit`.
- **Keep the acquire-release pair adjacent**: never split across files or types. If you must, document and add a static check.
- **Encapsulate weighted classes as constants or typed enums**: magic numbers in `Acquire(ctx, 7)` are illegible.
- **Make the limit configurable** at startup, not at compile time. Operators need to tune capacity without redeploying.
- **Surface metrics**: every production semaphore should expose permits-in-use, wait latency histogram, and TryAcquire failure count.
- **Prefer libraries over hand rolls**: only write your own semaphore if you have measured a hot path bottleneck or need behavior the library lacks (e.g., LIFO, priorities).

---

## Best Practices

1. **Size by measurement, not guess.** Start with concurrency = downstream's safe maximum. Validate with load test, then add 20% safety margin and forget about it until SLO complaints.
2. **Always use a context-aware acquire.** Bare `sem.Acquire(1)` without a timeout or cancellation is a future incident.
3. **Pair semaphore with circuit breaker.** When downstream is unhealthy, shed early at the breaker; do not let the semaphore queue grow.
4. **Emit a metric per acquire site.** When triage starts you want to know which call site is starving the others.
5. **Use TryAcquire on the hot path.** Latency-sensitive paths should not block on a semaphore unless you can prove the wait is bounded.
6. **Never call `Release` outside `defer` in the same function.** If you do, you are signing up for a future leak.
7. **Cap your weighted classes.** A class consuming the entire pool is a starvation magnet for everyone else; reserve some capacity.
8. **Document the invariant.** "This semaphore caps concurrent calls to BigDownstream at 50 because their SRE asked us to" — written, not folklore.
9. **Drain on shutdown.** Acquire the full capacity (with a deadline) before exiting so you do not orphan work.
10. **Audit cross-class acquire order.** All call sites must acquire in the same order to avoid deadlock.

---

## Edge Cases & Pitfalls

- **Permit leak via error-path defer-forgetting.** Common in long functions with many returns. Fix: extract the gated block into a helper that returns and lets the caller manage `defer`.
- **Over-release in `recover` handlers.** A panic recovery that calls `Release` without checking whether `Acquire` succeeded inflates capacity. Use a sentinel.
- **Semaphore held across blocking I/O on an unrelated resource.** You acquired the DB permit but then made a slow REST call before using the DB; you held the permit for the REST latency. Acquire as late as possible, release as early as possible.
- **Weighted acquire larger than capacity.** Silently blocks forever (or returns immediately with error, depending on library). Guard at the call site: clamp weight to capacity and log.
- **Acquiring inside a hot loop without batching.** 1M `Acquire(1)` calls beat the semaphore to death. Acquire once for a batch.
- **Named POSIX semaphore not unlinked.** Lives forever in `/dev/shm`; on next process start at value zero, your service hangs. Always unlink on clean shutdown.
- **System V semaphore with crashed holder.** Without `SEM_UNDO`, the permit is permanently leaked.
- **Mixing semaphore with mutex on the same resource without ordering.** Classic AB-BA deadlock.
- **Using channel semaphore in a select with a cancellation, but forgetting to release on cancellation.** A common bug: `<- sem` in the select branch leaks the permit if `ctx.Done()` wins concurrently with the send completing.
- **Drain on shutdown with deadline too short.** You release tasks unfinished, corrupting state.

---

## Common Mistakes

- Using `sync.Mutex` where a counting semaphore with N>1 was intended ("we only want one at a time" — until product asks for N).
- Choosing a hand-rolled semaphore over `x/sync/semaphore` "for performance" without measuring (the library is fast).
- Sizing the semaphore by guesswork tied to the machine size, not the downstream limit.
- Using a semaphore on a single-machine process when the downstream is shared across N replicas (you need a distributed limiter).
- Allowing weighted classes to overlap silently (a class can consume 100% of capacity, starving everyone).
- Forgetting that `TryAcquire(false)` makes the load test look better but causes user-visible 503s.
- Logging on every acquire/release (drowns the log; use sampled metrics).
- Treating the semaphore as a queue (it is a counter; queueing is incidental).
- Using `sem_wait` in a signal handler (it is not async-signal-safe; `sem_post` is, `sem_wait` is not).

---

## Tricky Points

- **`sem_post` is async-signal-safe but `sem_wait` is not.** You can post from a signal handler but not wait. This makes semaphores the canonical primitive for "wake the main thread from a signal handler".
- **Wakeup does not transfer ownership.** When a permit becomes available, the wakeup wakes a thread, which then re-decrements. A faster newcomer can steal the permit between wakeup and re-decrement — this is the "wakeup stealing" problem. Production libraries solve this by transferring the permit count under a lock.
- **`x/sync/semaphore` does not bound from above.** `Release` can grow the apparent capacity beyond `NewWeighted`'s argument. If you need bounded capacity, wrap with your own check.
- **Channel-based semaphore preserves FIFO via the channel runtime.** Receivers are FIFO. This is a subtle correctness property if you depend on fairness.
- **Acquire of weight 0 is a no-op but still incurs a function call.** Do not "weight by zero to skip" — branch at the call site.
- **Java `Semaphore(true)` is fair; `Semaphore()` is unfair and noticeably faster.** Default is unfair; fairness costs ~3-5x on contended paths.
- **Cancellation can race with grant.** Implementations must handle "grant won the race" by re-granting, not by leaking the permit.

---

## Test Yourself

1. Why does `sem_post` need to actually invoke `futex(FUTEX_WAKE)` even though it just incremented a counter?
2. Describe the cancellation race between `ctx.Done()` and being granted a permit. How does a correct implementation avoid permit loss?
3. When would you choose `make(chan struct{}, N)` over `semaphore.NewWeighted(N)` in Go?
4. Why is `Semaphore(true)` (fair) in Java slower than the unfair default?
5. A service holds 100 DB connections and uses a 100-permit semaphore. P99 acquire latency is 5 ms but P99 query latency is 200 ms. Is the semaphore the bottleneck?
6. Design a per-tenant + global concurrency cap with two semaphores. In what order do you acquire and release?
7. What does `SEM_UNDO` on System V semaphores do, and why does POSIX lack an equivalent?
8. A bug allows `Release(1)` to be called twice for one `Acquire(1)`. What user-visible symptom would you expect?
9. How would you measure semaphore contention in a Go service?
10. Why is `sem_wait` not safe in a signal handler?

---

## Tricky Questions

1. **You have a semaphore with 10 permits and 100 callers, all calling `Acquire(1)` with a 1-second timeout. What is the throughput if each holder takes 100 ms?**
   10 permits × (1 sec / 100 ms) = 100 requests/sec sustained. Beyond that, callers time out. Tail latency near 1 second for the timed-out 0%.

2. **A library uses `sem_wait` after `fork()` in the child. What can go wrong?**
   POSIX semaphores in shared memory survive `fork` only if you set `pshared=1`. Otherwise the child has a copy of the counter but the kernel waiter queue is process-keyed; the child can deadlock. Glibc's `sem_t` is partially OK across fork for unshared semaphores but waiters from the parent are not inherited.

3. **You wrap a weighted semaphore in your own type and forget to lock around the wait list. What is the failure mode?**
   Lost wakeups or duplicated grants. A waiter sees `granted=false` and parks; meanwhile another goroutine sees `granted=true`. The classic "missed wakeup" race; without proper memory ordering you get hangs that disappear when you add a `printf`.

4. **You add `sem.Release(1)` to `recover()` in case a panic happens before release. What new bug have you created?**
   If the panic happens before `Acquire` succeeded — for instance, in a defer chain — you release a permit you never acquired. Capacity grows by one. Solution: a sentinel `acquired := false; acquired = true after success; in recover only release if acquired`.

5. **What is the difference between a binary semaphore and a mutex?**
   A binary semaphore is a counting semaphore with capacity 1. A mutex additionally has the concept of an owner: only the locker can unlock. A binary semaphore can be posted by any thread, which is the property that makes it useful for cross-thread signaling.

6. **You want admission control with priorities (free tier, paid tier, internal). How do you structure semaphores?**
   Per-class semaphores sized to guaranteed minimums + a shared bonus pool. Internal acquires from bonus first, falls back to its own class. Free tier never touches bonus. Paid tier touches its share + bonus. Acquire order: class first, then bonus. Release in reverse.

7. **Why might you choose a sloppy counter (eventually consistent) for "remaining permits" in a distributed limiter?**
   At 1M QPS the cost of an exact CAS-per-acquire across nodes is prohibitive. A sloppy counter accepts that you might briefly exceed the cap by N (where N is the number of nodes) in exchange for O(1) local operations. The trade is correctness for scale.

8. **A semaphore guards a pool of 50 connections. You add a circuit breaker that, when open, fast-fails. Should the breaker live before or after the semaphore?**
   Before. If the downstream is dead you do not want to consume a permit to discover that. The breaker filters requests; the semaphore caps concurrency for those that pass.

---

## Cheat Sheet

```
Sem types         Counting | Binary | Weighted | Named (IPC) | Unnamed
Linux backing     futex (sem_t) | SysV ipc (semget)
Go libraries      chan struct{} for uniform | x/sync/semaphore for weighted
Acquire shapes    Acquire(ctx,n) | TryAcquire(n) | timed via ctx.WithTimeout
Release shape     Release(n) — must match acquired n
Fast path cost    ~10-50 ns (atomic only)
Slow path cost    park/unpark + 1 syscall pair (~1-10 us)
Fairness          User-space FIFO in good libs; kernel queue is best-effort
Cancellation      Must transfer-on-grant to avoid permit loss
Backpressure      TryAcquire + 503 + Retry-After
Drain             Acquire(ctx, capacity)
Top bugs          Permit leak, over-release, hold across slow I/O,
                  acquire-order deadlock, missing ctx
Metrics to emit   permits_in_use, acquire_latency_seconds (hist),
                  try_acquire_failures_total
```

---

## Summary

A semaphore is the right tool whenever you need to bound concurrent access to a finite resource. At the senior level, the primitive itself is rarely the hard part — futex-backed implementations are fast, well-tested, and standard. The hard parts are:

1. **Sizing**: choosing the permit count by measuring the downstream, not guessing.
2. **Fairness**: deciding whether FIFO is enough, or whether classes deserve guaranteed shares.
3. **Backpressure**: using `TryAcquire` to shed instead of queueing under overload.
4. **Cancellation**: handling the race between `ctx.Done()` and grant correctly.
5. **Operability**: emitting the metrics that let you triage at 3 AM.

Master these and the semaphore stops being a counter and becomes a load-bearing piece of your service's resilience story.

---

## What You Can Build

- **Admission controller for an HTTP/gRPC service** with bounded wait, per-tenant caps, and a global shed valve.
- **Weighted connection pool** for a database where light reads and heavy exports coexist.
- **Async job runner** that caps concurrent jobs and supports cancellation with no permit leak.
- **GPU scheduler** treating memory and compute units as weighted permits.
- **Distributed limiter** layering a local semaphore over a Redis-backed sloppy counter.
- **Drainable worker pool** that shuts down cleanly by acquiring full capacity.
- **Backpressure-aware HTTP middleware** that returns 503 with Retry-After under load.
- **Cross-process file lock alternative** using a named POSIX semaphore with `sem_unlink` on shutdown.
- **Test harness** that injects acquire delays to verify your service's behavior under semaphore starvation.

---

## Further Reading

- The Linux Programming Interface — chapters on POSIX and System V semaphores.
- Ulrich Drepper, "Futexes Are Tricky." Canonical paper on the futex contract.
- `golang.org/x/sync/semaphore` source code — a clean, short reference implementation.
- `tokio::sync::Semaphore` source in Rust — RAII permits and async cancellation done right.
- Java `java.util.concurrent.Semaphore` — fair vs unfair modes; the AQS waiter queue.
- .NET `SemaphoreSlim` source — initialCount + maxCount as a bound on over-release.
- Cindy Sridharan, "Distributed Systems Observability" — backpressure and admission control patterns.
- The CFQ and HTB scheduler docs in the Linux kernel tree — production WFQ implementations.
- Brendan Gregg, "Linux Performance" — using `offcputime` and `runqlat` to find blocked threads.
- Tony Hoare's original "Communicating Sequential Processes" paper — channel-as-semaphore intuition.

---

## Related Topics

- [Semaphore — Junior](junior.md)
- [Semaphore — Middle](middle.md)
- [Semaphore — Optimize](optimize.md)
- [Semaphore — Professional](professional.md)
- [Semaphore — Interview](interview.md)
- [Mutex — Senior](../01-mutex/senior.md)
- [Condition Variables](../03-condition-variables/README.md)
- [Channel-based concurrency](../../03-models/README.md)
- [Backpressure & rate limiting](../../../../../System-Design/reliability/README.md)
- [Connection pooling](../../../../../System-Design/databases/connection-pooling/README.md)
- [Circuit breaker pattern](../../../../../System-Design/reliability/circuit-breaker/README.md)

---

## Diagrams & Visual Aids

### Semaphore state machine

```
            +---------+ Acquire (capacity > 0)
            |         |---------------------------+
            |  open   |                           v
            |         |                       +-------+
            +---------+ <---------------------|  in   |
                ^                Release      | use   |
                |                             +-------+
                |  Acquire (capacity == 0)        |
                |                                 v
            +---------+                       +-------+
            | waiters |<----------------------|  full |
            |  queued |    block-on-acquire   |       |
            +---------+                       +-------+
```

### Futex-backed Acquire fast/slow path

```
Acquire(n):
   atomic dec counter by n
   ┌────────────────────────────────┐
   │ counter >= 0 ?                  │
   │   yes → return (FAST, ~20 ns)   │
   │   no  → futex wait (SLOW path)  │
   └────────────────────────────────┘
                  │
                  v
   kernel parks goroutine/thread on waiter queue
                  │
                  v
   Release → futex wake one → woken thread retries
```

### Layered backpressure

```
            client
              │
              v
   ┌────────────────────┐
   │  rate limiter      │ token-bucket: caps req/sec
   └────────────────────┘
              │
              v
   ┌────────────────────┐
   │  concurrency sem   │ TryAcquire: caps in-flight
   └────────────────────┘
              │
              v
   ┌────────────────────┐
   │  circuit breaker   │ fast-fails when downstream sick
   └────────────────────┘
              │
              v
            downstream
```

### Class-aware admission

```
                          +-----------+
                          |  global   |   cap = 1000
                          +-----------+
                          ^     ^   ^
                          |     |   |
        +---------+   +---------+  +---------+
        |  free   |   |  paid   |  | internal|
        |  cap=200|   |  cap=500|  | cap=300 |
        +---------+   +---------+  +---------+

Acquire order: class first, then global.
Release order: global first, then class.
This avoids deadlock and ensures the class cap is the
inner-most check, so per-class metrics stay clean.
```

### Cancellation race resolution

```
Time →

Goroutine A waiting in Acquire ──park───────────────────────
                                                │
Goroutine B calls Release(1)                    │ grant signaled
                                                ▼
Goroutine A's ctx is cancelled ───────── ctx.Done() fires
                                                ▼
                                         select races

Correct handler under lock:
  if granted-channel closed → re-grant to next waiter
  else → remove self from queue + re-dispatch
```

### Drain on shutdown

```
   normal:    permits_in_use ≤ capacity
                 │
   shutdown:    Acquire(ctx, capacity)
                 │ blocks until all permits returned
                 │ rejects new acquires (full)
                 v
                exit cleanly, no orphaned work
```
