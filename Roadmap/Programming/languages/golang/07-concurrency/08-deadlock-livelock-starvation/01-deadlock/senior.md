# Deadlock in Go — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Lock-Order Rank Pattern](#the-lock-order-rank-pattern)
3. [Implementing a Ranked Mutex in Go](#implementing-a-ranked-mutex-in-go)
4. [Static Analysis: Detecting Inversions Without Running](#static-analysis-detecting-inversions-without-running)
5. [Architectural Patterns That Prevent Deadlock by Design](#architectural-patterns-that-prevent-deadlock-by-design)
6. [Single-Writer Pattern (Actor Model)](#single-writer-pattern-actor-model)
7. [Lock-Free and Wait-Free Data Structures](#lock-free-and-wait-free-data-structures)
8. [Timeouts on Acquisition as Last-Resort Prevention](#timeouts-on-acquisition-as-last-resort-prevention)
9. [Distributed Deadlocks](#distributed-deadlocks)
10. [Comparison: Java, Pthreads, Rust](#comparison-java-pthreads-rust)
11. [Production Case Studies](#production-case-studies)
12. [Designing a Deadlock-Resistant Service](#designing-a-deadlock-resistant-service)
13. [Postmortem Template for Deadlock Incidents](#postmortem-template-for-deadlock-incidents)
14. [Self-Assessment](#self-assessment)
15. [Summary](#summary)

---

## Introduction

At middle level you learned to diagnose existing deadlocks. At senior level you learn to prevent them by construction: codify a lock order, encode it in types if possible, choose data-structure shapes that cannot deadlock, push state ownership to a single goroutine when locks become too dangerous.

The senior question is not "how do I fix this deadlock?" but "how do I design the next system so this class of deadlock cannot happen at all?"

After this file you will:

- Apply the **lock-order rank** pattern to a multi-mutex package and enforce it at runtime.
- Sketch a static analyzer that catches lock-inversion bugs at compile time.
- Decide when to abandon mutexes in favor of single-writer goroutines or lock-free structures.
- Use timeouts on lock acquisition (`TryLock` + backoff) as a defense layer, knowing when it is appropriate and when it is a smell.
- Recognise distributed deadlocks across services and the standard mitigations.
- Compare Go's deadlock posture to Java, pthreads, and Rust, and explain the design tradeoffs.
- Write a deadlock-incident postmortem that addresses root cause, not just the patch.

---

## The Lock-Order Rank Pattern

The single most powerful technique to prevent deadlock in any system with more than one mutex: **assign every lock a rank**, and never acquire a lock of rank R while holding a lock of rank R or higher. The cycle in the wait graph is gone, because waits only go in one direction (from low rank to high rank).

A rank is just an integer. The discipline says:

- Document the rank of every mutex in the system.
- Maintain a thread-local list (or in Go: goroutine-local — we'll come to that) of currently held ranks.
- On `Lock(rank)`, assert that `rank > max(currently_held)`. If not, panic.
- On `Unlock(rank)`, remove from the list.

The pattern is older than Go — Linux kernel locks have this since 1995 (`lockdep`). Solaris had it. FreeBSD has `WITNESS`. Java has `Lock` ordering helpers in concurrent libraries. Go has nothing built in, but the pattern is easy to add.

Example ranks for a hypothetical service:

```
rank 10:  config mutex            (cold path, leaf)
rank 20:  cache mutex             (per-shard)
rank 30:  connection pool mutex
rank 40:  request session mutex
rank 50:  router mutex            (root, hottest)
```

Acquisition rule: acquire ranks in *increasing* order. So a request handler that holds the router mutex (50) cannot acquire the cache mutex (20) without first releasing the router. This shapes the design: the handler typically does router work, releases, then does cache work.

Designing the ranks is itself an architectural exercise. A common rule of thumb:

- Root locks (those near the front door of the system) get the highest rank.
- Leaf locks (those that protect small, well-isolated state) get the lowest rank.
- Locks that protect "second-level" state — caches, pools — get middle ranks.

If you find yourself wanting to acquire a higher-ranked lock while holding a lower-ranked one, the design is wrong. Either the lower-ranked lock is too coarse, or the dependency is in the opposite direction from what the ranks describe. Rethink.

---

## Implementing a Ranked Mutex in Go

Go does not expose goroutine-local storage, but we can attach the held-ranks list to a `context.Context` or — more commonly — track it in a `sync.Map` keyed by goroutine ID (extracted via runtime tricks, which we'll avoid here for portability) or via a `sync.Pool`. The cleanest approach is to pass an explicit "lock tracker" through call chains; in practice most codebases that adopt ranks use `context` or a per-request struct.

A minimal pattern using `context`:

```go
package ranklock

import (
    "context"
    "fmt"
    "sort"
    "sync"
)

type ctxKey struct{}

type held struct {
    ranks []int
}

func attach(ctx context.Context) context.Context {
    return context.WithValue(ctx, ctxKey{}, &held{})
}

type Mutex struct {
    mu   sync.Mutex
    rank int
    name string
}

func New(name string, rank int) *Mutex {
    return &Mutex{rank: rank, name: name}
}

func (m *Mutex) Lock(ctx context.Context) {
    h, ok := ctx.Value(ctxKey{}).(*held)
    if ok {
        if len(h.ranks) > 0 {
            top := h.ranks[len(h.ranks)-1]
            if m.rank <= top {
                panic(fmt.Sprintf(
                    "ranklock: acquiring %q (rank %d) while holding rank %d",
                    m.name, m.rank, top))
            }
        }
        h.ranks = append(h.ranks, m.rank)
    }
    m.mu.Lock()
}

func (m *Mutex) Unlock(ctx context.Context) {
    m.mu.Unlock()
    h, ok := ctx.Value(ctxKey{}).(*held)
    if ok {
        for i := len(h.ranks) - 1; i >= 0; i-- {
            if h.ranks[i] == m.rank {
                h.ranks = append(h.ranks[:i], h.ranks[i+1:]...)
                break
            }
        }
        sort.Ints(h.ranks) // optional: keep sorted for invariants
    }
}
```

Use:

```go
ctx := ranklock.attach(context.Background())

cacheMu := ranklock.New("cache", 20)
routerMu := ranklock.New("router", 50)

// OK: router (50) then cache (20)? NO — that's increasing? No, 50 then 20 is DECREASING.
// The rule is acquire in INCREASING rank, so cache (20) first, then router (50).

cacheMu.Lock(ctx)
routerMu.Lock(ctx) // OK: 50 > 20
// work
routerMu.Unlock(ctx)
cacheMu.Unlock(ctx)
```

If you reverse:

```go
routerMu.Lock(ctx)
cacheMu.Lock(ctx) // panics: acquiring "cache" (rank 20) while holding rank 50
```

The panic stops development-time bugs immediately. In production you may want a non-fatal mode that logs the violation but continues, since a panic that takes down a service is worse than a deadlock you have not yet experienced.

Tradeoffs:

- The pattern requires passing `context.Context` through every call. Most well-designed Go code already does this.
- It adds two `Map` lookups per `Lock`/`Unlock`. Measure: usually 1-2% overhead, sometimes worse on hot paths.
- It catches violations only when the violating goroutine runs. A path that has never been exercised will not panic until it is exercised.

To handle goroutine spawning correctly, each goroutine needs a fresh held-ranks slice, since the spawned goroutine does not inherit the holder. The wrapping `Lock` can detect this if you pass the context properly, but you need to handle:

```go
go func(ctx context.Context) {
    // ctx here may carry held ranks from parent, but the goroutine itself holds nothing
}()
```

The cleanest fix is to clone the context with a fresh `held` struct at each `go` statement, or to require explicit `ranklock.attach(ctx)` at goroutine entry. Production implementations use a wrapper `Go(ctx, fn)` that does this attachment automatically.

---

## Static Analysis: Detecting Inversions Without Running

The ranked-mutex approach catches inversions at *runtime*, on the violating code path. Better: catch them at *compile time*, before deployment.

Tools that exist:

- **`go vet` with custom analyzers** (the `go/analysis` framework). You can write a pass that builds a call graph, finds every `Lock` call, and reports inversions.
- **`dingo-hunter`** (research project) — type-based deadlock checker for Go channel programs.
- **`gocritic`** has some lock-related checks but not full inversion analysis.
- **`staticcheck`** flags some misuse (locking a copied mutex, `sync.WaitGroup` value receivers) but not order inversion.

Sketch of a custom analyzer:

1. Walk every function in the package.
2. For each function, compute the set of mutexes that may be held when it returns.
3. For each `mu.Lock()` call, intersect with the per-call-site held set to determine "this lock is acquired while these are held."
4. Across the whole program, build a graph: edge from `A → B` if any call site holds A and acquires B.
5. Run a cycle detection (Tarjan's SCC) on the graph. Any non-trivial SCC is a potential lock inversion.

Practical issues:

- Mutexes accessed via interfaces or stored in `any` are invisible to the analyzer.
- Lock acquisitions inside callbacks or function-typed parameters require interprocedural analysis.
- Common false positives: `sync.RWMutex.Lock` and `sync.RWMutex.RLock` are distinct operations on the same mutex; the analyzer must understand both.

For projects with strict deadlock-freedom requirements (kernel code, control-plane services), the cost of writing or adopting such a tool is amortized over years of incidents prevented.

---

## Architectural Patterns That Prevent Deadlock by Design

Lock ordering is one tool. Several others remove the conditions for deadlock entirely.

**Pattern: hierarchical decomposition.** Each module owns its own state and its own mutex. Modules form a DAG; calls only flow downward in the DAG. Lower modules never call back up. Since the call graph is a DAG, the lock-acquisition graph is also a DAG — no cycle possible. This is just lock ordering, implicit in the module structure.

**Pattern: state ownership by a single goroutine.** Instead of shared state behind a mutex, each piece of state belongs to one goroutine. Other goroutines communicate with it via channels. The owner serializes operations; there is no mutex. This eliminates the mutex deadlock surface entirely, replacing it with a channel deadlock surface (smaller and easier to reason about). See the next section.

**Pattern: copy-on-write.** Shared state is immutable. Updates produce a new copy, and a single atomic pointer swap publishes the new state. Readers do not lock — they read the pointer. Writers do not lock multiple things — they prepare the new state outside any critical section, then atomically swap. Deadlock is impossible because there is no held lock to wait on.

**Pattern: short-lived locks only.** Adopt a strict rule: any function that holds a lock must not call any function outside its own package. Then deadlock requires two locks in one package; one package can be audited and ordered. Cross-package deadlocks become impossible.

**Pattern: optimistic concurrency.** Use `sync/atomic` compare-and-swap loops instead of mutexes for small operations. CAS loops cannot deadlock because they never block — they retry. Cost: limited to operations that can be expressed as a single atomic update.

---

## Single-Writer Pattern (Actor Model)

The actor model — popularized by Erlang and adopted by Akka, Orleans, and others — replaces shared-memory-plus-locks with goroutines that own state and communicate via channels. In Go it looks like:

```go
type Counter struct {
    inc   chan struct{}
    query chan chan int
    quit  chan struct{}
}

func NewCounter() *Counter {
    c := &Counter{
        inc:   make(chan struct{}),
        query: make(chan chan int),
        quit:  make(chan struct{}),
    }
    go c.run()
    return c
}

func (c *Counter) run() {
    n := 0
    for {
        select {
        case <-c.inc:
            n++
        case reply := <-c.query:
            reply <- n
        case <-c.quit:
            return
        }
    }
}

func (c *Counter) Inc()      { c.inc <- struct{}{} }
func (c *Counter) Get() int  { r := make(chan int); c.query <- r; return <-r }
func (c *Counter) Close()    { close(c.quit) }
```

The `Counter` state — the integer `n` — is touched only by the owner goroutine. No mutex, no inversion. The deadlock surface is the channel operations:

- `Inc()` blocks if `run` is not currently servicing. Cannot deadlock unless the actor is dead.
- `Get()` blocks while waiting for the reply. Cannot deadlock unless the actor is dead.

If two actors call each other in a cycle — actor A sends to actor B and waits for a reply, B sends to A and waits — you have *channel* deadlock. The actor model does not magically prevent cycles; it just shifts the surface. The advantage is that channel-based wait graphs are usually shallower and easier to inspect than mutex-based ones.

When to use:

- State with complex invariants that would otherwise need multiple mutexes.
- State that needs to coordinate background work (timers, periodic flushes) with user calls.
- Code where the locking discipline keeps getting violated.

When not to use:

- Hot, tiny operations. Channel send-receive costs ~100 ns minimum, vs. ~20 ns for an uncontended `sync.Mutex`. Actor-based counters lose to atomic counters by 10x.
- Synchronous query-heavy access. Each `Get()` is a synchronous round-trip; in tight loops this is slow.

---

## Lock-Free and Wait-Free Data Structures

For some shapes, you can avoid mutexes entirely using atomic operations. Go gives you `sync/atomic` and `atomic.Value`, both of which can be combined into surprisingly powerful patterns.

**`atomic.Value` for shared configuration:**

```go
type Config struct { /* ... */ }

var cfg atomic.Value // *Config

func GetConfig() *Config {
    return cfg.Load().(*Config)
}

func UpdateConfig(c *Config) {
    cfg.Store(c)
}
```

Readers do a single atomic load — no lock, no contention, no deadlock. The writer prepares a new `*Config` and stores it atomically. Multiple writers can race; if you care, serialize them externally.

**Compare-and-swap counters:**

```go
type Counter struct{ n int64 }
func (c *Counter) Add(d int64) { atomic.AddInt64(&c.n, d) }
func (c *Counter) Load() int64 { return atomic.LoadInt64(&c.n) }
```

No lock. No deadlock.

**Lock-free queues (e.g., Michael-Scott):** Possible in Go using atomic pointers, but the implementation is subtle and rarely worth it over channels or `sync.Mutex`. Used in performance-critical contexts (network packet queues, lock-free schedulers).

**Caveats:**

- Lock-free does not mean wait-free. Lock-free guarantees the system as a whole makes progress; a specific operation may be retried many times under contention.
- Memory ordering subtleties matter. Go's memory model permits some reorderings; you must use `atomic.Load`/`Store`/`Add` (not raw assignments) to get the right barriers.
- Code that touches `unsafe.Pointer` and `atomic.CompareAndSwapPointer` is hard to read, hard to review, and easy to get wrong.

When mutexes get hard to reason about, the right answer is usually "split the data" or "use an actor" — not "go lock-free."

---

## Timeouts on Acquisition as Last-Resort Prevention

You can break the **no preemption** Coffman condition by giving lock acquisition a deadline:

```go
import "sync"

func TryLockWithTimeout(mu *sync.Mutex, d time.Duration) bool {
    deadline := time.Now().Add(d)
    for time.Now().Before(deadline) {
        if mu.TryLock() {
            return true
        }
        time.Sleep(1 * time.Millisecond)
    }
    return false
}
```

Caller:

```go
if !TryLockWithTimeout(&mu, 100*time.Millisecond) {
    return errors.New("could not acquire lock in time")
}
defer mu.Unlock()
// work
```

This is **the last resort.** Why?

- The spin-and-sleep loop wastes CPU and adds latency.
- If you reach a point where you cannot acquire a lock in 100 ms, your system is in a degraded state — possibly a deadlock — and timing out only spreads the error.
- The "give up" path must produce a sane error for the caller. Often the caller's error path is what triggers further retries that worsen the contention.

Use timeouts on acquisition when:

- You are integrating with code you do not own that may hold a lock indefinitely.
- You have a strict SLO and prefer to fail fast on contention rather than block.
- You are building a circuit breaker — after N consecutive lock-acquisition timeouts, declare a subsystem unhealthy.

Do not use timeouts in place of proper lock ordering. They mask design bugs.

---

## Distributed Deadlocks

The Coffman conditions apply across machines as well as within one. Two services, each waiting on the other, form a distributed deadlock. The wait graph crosses network boundaries.

Examples:

- **Service A waits for service B's response to release a database row lock.** Service B is processing a request that needs the same row. A holds DB row; B holds B's local request mutex and waits for A's response. Cycle.
- **Synchronous saga without timeouts.** A → B → C → A in a multi-step transaction. Each holds a row in its own DB; each waits for the next.
- **Cross-service `Lock` over a distributed lock service.** Two services each acquire half of a logical resource and ask for the other half.

Mitigations (cookbook level):

- **Timeouts everywhere.** Every RPC has a context deadline. Every database transaction has a `lock_timeout`. Every distributed lock has an expiry.
- **Single-writer for distributed state.** Use a primary owner (a leader, a partition leader) so that no two services own the same data.
- **Sagas, not synchronous chains.** Long workflows are decomposed into asynchronous steps with explicit compensations on failure. There is no held resource across the wait.
- **Idempotent retries.** Failed steps can be retried without breaking invariants. Combined with timeouts, this resolves most distributed deadlocks.
- **Two-phase commit (2PC) only if you must.** 2PC famously can deadlock the coordinator with participants. Avoid it.

Detection at the distributed level is hard. PostgreSQL detects deadlocks across DB connections (and aborts one transaction with a deadlock error). Kafka has no such mechanism. Custom microservice frameworks rarely do. The practical answer is **timeouts plus observability**: if a request flow takes longer than expected, surface it; if it never returns, kill it.

---

## Comparison: Java, Pthreads, Rust

### Java

- **No built-in deadlock detector.** The JVM does not abort on deadlock. You diagnose with `jstack <pid>`, which prints all thread stacks (analogous to Go's `SIGQUIT`). `jstack -l` annotates with "Found one Java-level deadlock" when it detects a cycle in the lock graph.
- **`ThreadMXBean.findDeadlockedThreads()`** in `java.lang.management` returns thread IDs involved in a deadlock cycle, programmatically.
- **Java has reentrant locks.** `synchronized` is reentrant by default, so same-thread recursion does not deadlock. Go's `sync.Mutex` does not — this is a frequent surprise for Java migrants.
- **`tryLock(timeout)` on `ReentrantLock`** is standard library, no helper needed.
- **`StampedLock`** offers optimistic reads, like a fast `RWMutex`.

### Pthreads (C/C++)

- **No detector built in.** Deadlocks hang silently.
- **Helgrind** (Valgrind tool) and **ThreadSanitizer (TSan)** detect lock-order inversions dynamically. TSan is widely used at Google and elsewhere.
- **`pthread_mutex_trylock`** is standard.
- **PTHREAD_MUTEX_RECURSIVE** mutex type allows reentrant locking.
- **`pthread_mutex_setprioceiling`** implements priority ceiling protocol, which prevents priority-inversion-induced deadlock.

### Rust

- **Rust does not prevent deadlock** despite ownership/borrowing. The borrow checker prevents data races, not deadlocks.
- **`std::sync::Mutex<T>`** is *not* poisoning-safe by default — a panic while holding the lock "poisons" it and subsequent `lock()` returns `Err`. This is the Rust equivalent of "released on panic," but the caller must explicitly handle the poison case or unwrap.
- **No built-in detector.** Use `parking_lot::Mutex` for better performance and optional deadlock detection.
- **`parking_lot::deadlock` module** provides programmatic deadlock detection — opt-in, runtime-cost.

### Go's position

- **Built-in detector for full-program deadlock.** Friendlier to beginners than any of the above.
- **No partial detection.** Worse than Java's `jstack -l` for production.
- **No reentrancy.** Like pthreads (with default mutex), unlike Java's `synchronized`.
- **No standard `TryLock` with timeout.** `sync.Mutex.TryLock` exists (Go 1.18+) but no `LockWithTimeout`.
- **Channels** are a unique escape hatch — no other mainstream language has them with such first-class status.

The Go runtime's deadlock posture is "narrow tool that catches the loudest case at zero cost; everything else is your problem." Production Go shops compensate with observability and discipline.

---

## Production Case Studies

### Case 1: the cache-and-DB deadlock

A service had:

```go
type Cache struct {
    mu    sync.Mutex
    items map[string]*Item
}

func (c *Cache) Get(ctx context.Context, key string) (*Item, error) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if item, ok := c.items[key]; ok {
        return item, nil
    }
    item, err := db.LoadItem(ctx, key) // <-- DB call inside lock
    if err != nil {
        return nil, err
    }
    c.items[key] = item
    return item, nil
}
```

Under load: a request comes in for a missing key. The handler acquires `c.mu` and calls `db.LoadItem`. The DB pool is at capacity because some other goroutine is waiting on a row lock. That other goroutine is held up by a `pgx` health-check that, in this version, requires a lock the cache holder needs to release first. Cycle.

Symptom in production: every Cache.Get call from then on hangs. The runtime detector does not fire — other goroutines are alive. `pprof goroutine` showed dozens stacked behind `sync.runtime_SemacquireMutex` for `c.mu`.

Fix: never call the DB while holding the cache lock. Use a singleflight pattern:

```go
func (c *Cache) Get(ctx context.Context, key string) (*Item, error) {
    c.mu.Lock()
    if item, ok := c.items[key]; ok {
        c.mu.Unlock()
        return item, nil
    }
    c.mu.Unlock()

    v, err, _ := c.sf.Do(key, func() (any, error) {
        return db.LoadItem(ctx, key)
    })
    if err != nil {
        return nil, err
    }
    item := v.(*Item)

    c.mu.Lock()
    c.items[key] = item
    c.mu.Unlock()
    return item, nil
}
```

The lock is held only around the map access. The DB call happens outside. `singleflight.Group` ensures duplicate concurrent requests for the same key share one DB load. Deadlock impossible.

### Case 2: the WaitGroup-after-Wait drift

A worker pool:

```go
for batch := range batches {
    var wg sync.WaitGroup
    for _, job := range batch {
        wg.Add(1)
        go func(j Job) {
            defer wg.Done()
            process(j)
        }(job)
    }
    wg.Wait()
}
```

This works. Now imagine a refactor where `process` spawns a follow-up:

```go
func process(j Job, wg *sync.WaitGroup) {
    // ...
    if j.NeedsFollowUp() {
        wg.Add(1)
        go func() {
            defer wg.Done()
            followUp(j)
        }()
    }
}
```

If the follow-up `Add` happens after the outer `wg.Wait` has been reached (because the main worker is fast and the follow-up branch is taken late), you have an `Add` while `Wait` is blocked. The Go documentation says:

> Note that calls with a positive delta that occur when the counter is zero must happen before a Wait.

When the counter goes from 1 to 0 (the main worker's `Done`), `Wait` returns. The follow-up `Add` then races. In some Go versions this panics with "WaitGroup is reused before previous Wait has returned"; in others it silently misbehaves.

Fix: use a separate `WaitGroup` for follow-ups, or restructure so the main worker waits for its own follow-up before calling `Done`:

```go
go func(j Job) {
    defer wg.Done()
    process(j)
    // process waits for its own follow-up internally before returning
}(job)
```

### Case 3: the cgo-masked deadlock

A service used a C library for cryptographic operations. The C function held an internal pthread mutex during the call. A Go goroutine held a Go mutex and called the C function. Another Go goroutine, in the C library's internal callback, tried to acquire the Go mutex.

The cycle: Go mutex held → C mutex acquired → C callback to Go → Go mutex needed. Classic inversion across the language boundary.

The runtime detector did not fire because the cgo goroutines counted as alive. The deadlock manifested as "all crypto operations hang" while the rest of the service worked. Took hours to find.

Lesson: callbacks from C into Go are a deadlock surface; never hold a Go lock across a cgo call into a library that may call back. This is the same rule as "never hold a lock across an external call," but the C boundary makes it harder to spot in review.

---

## Designing a Deadlock-Resistant Service

Checklist for any new concurrent service:

1. **Inventory every mutex.** Write them down. Group by what they protect.
2. **Assign ranks.** Order them in a directed graph. If you cannot, refactor until you can.
3. **For each lock, list every function that acquires it.** Audit each function: does it call any code that might acquire a higher-or-equal-ranked lock?
4. **Choose channels over mutexes when state is owned by one operation.** A queue, a stream, a producer-consumer should be channel-based.
5. **Use `errgroup.WithContext` for fan-out work.** Cancellation propagates automatically.
6. **Set context timeouts on every external call.** DB, RPC, file I/O.
7. **Add `goleak.VerifyNone(t)` to every test.** Catches leaks early.
8. **Expose `/debug/pprof/`.** Free observability.
9. **Add a heartbeat metric.** Worker goroutines tick a counter; liveness probe fails if any worker has not ticked in N seconds.
10. **Document the lock order in package doc.** Future contributors must know.

If you adopt these ten practices, deadlock should be a rare, diagnosable event rather than a routine production incident.

---

## Postmortem Template for Deadlock Incidents

For every deadlock that reaches production, the postmortem should answer:

**Trigger.** What request, schedule, or input caused the deadlock to manifest? Was it a code path that had never executed before, or a long-standing latent bug?

**Cycle.** What was the wait graph? Goroutine A held what, waited on what, which goroutine B held what, etc. Name the resources, not just hex addresses.

**Detection delay.** How long did it take to notice? Did monitoring fire? `go_goroutines` rising, request P99 latency rising, error rate, or a customer complaint?

**Diagnosis tools.** `pprof goroutine`, `SIGQUIT`, `goleak`, log inspection, manual code reading. Which were useful?

**Root cause.** Which Coffman condition was unintentionally satisfied? Was there a lock-order assumption that broke? A `select` without `ctx.Done`? A producer that did not close?

**Patch.** The immediate fix.

**Preventive measure.** The systemic change. A lock-order doc, an analyzer, a test, a refactor to channels, an architectural shift to single-writer.

**Tests.** Specifically, what test or assertion would have caught this? Add it.

A team that runs this template after every deadlock incident slowly accumulates institutional knowledge and infrastructure that makes the next one rarer. A team that just patches and moves on is destined to repeat.

---

## Self-Assessment

- [ ] I can design a lock-order rank for a multi-mutex package and justify each rank.
- [ ] I can implement a runtime rank checker that panics on inversion.
- [ ] I know when to switch from mutex-protected shared state to a single-owner goroutine.
- [ ] I can recognise the cache-and-DB deadlock pattern in code review.
- [ ] I understand `atomic.Value` and when to use it instead of `sync.RWMutex`.
- [ ] I can compare Go's deadlock detection to Java's, pthreads', and Rust's, and explain the design tradeoffs.
- [ ] I know when timeout-based acquisition is appropriate and when it is a smell.
- [ ] I can identify a distributed deadlock from latency and goroutine metrics.
- [ ] I write a useful deadlock postmortem.

---

## Summary

Senior-level deadlock work is about design, not diagnosis. The lock-order rank pattern, properly applied, makes mutex inversion impossible by construction. Architectural choices — single-writer goroutines, copy-on-write, channels, atomic values — eliminate whole classes of deadlock from a service's surface. Timeouts and `TryLock` are last-resort defensive layers, useful when you do not own the code that might hang.

Distributed deadlocks generalize the Coffman conditions across services. The mitigations are the same in spirit: break hold-and-wait via timeouts, break circular wait via ordering, prefer single ownership over shared state. Detection at the distributed level is rarely automatic; you rely on observability and timeouts to convert hangs into errors.

Cross-language perspective: Go's runtime detector is friendly but narrow. Java's `jstack -l`, pthreads' Helgrind/TSan, and Rust's `parking_lot` all offer richer production deadlock tooling. Go shops compensate with `pprof`, `goleak`, custom analyzers, and disciplined design.

The professional level builds on this with the runtime internals — how `gopark` and `goready` interact with the dead-detector, what the trace shows, and how to extend the runtime for partial deadlock detection.
