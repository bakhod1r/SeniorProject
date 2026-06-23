---
layout: default
title: Senior
parent: Unlimited Goroutines
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 3
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/01-unlimited-goroutines/senior/
---

# Unlimited Goroutines — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Senior Mindset: Concurrency as a Resource](#the-senior-mindset-concurrency-as-a-resource)
3. [A Taxonomy of Bounded-Fan-Out Patterns](#a-taxonomy-of-bounded-fan-out-patterns)
4. [Backpressure as the Primary Cure](#backpressure-as-the-primary-cure)
5. [Semaphores in Depth](#semaphores-in-depth)
6. [`golang.org/x/sync/semaphore` Internals and Usage](#golangorgxsyncsemaphore-internals-and-usage)
7. [`errgroup.SetLimit` and the Group Pattern](#errgrouplimit-and-the-group-pattern)
8. [Bounded Worker Pools at Scale](#bounded-worker-pools-at-scale)
9. [Request-Scoped Concurrency Budgets](#request-scoped-concurrency-budgets)
10. [Multi-Tier Bounding](#multi-tier-bounding)
11. [Per-Tenant and Per-Resource Quotas](#per-tenant-and-per-resource-quotas)
12. [Admission Control and Queue Management](#admission-control-and-queue-management)
13. [Goroutine Leak Detection with goleak](#goroutine-leak-detection-with-goleak)
14. [The Bounded Pipeline Anti-Pattern Test Harness](#the-bounded-pipeline-anti-pattern-test-harness)
15. [Production Case Studies](#production-case-studies)
16. [Failure Modes Beyond OOM](#failure-modes-beyond-oom)
17. [Designing for Graceful Degradation](#designing-for-graceful-degradation)
18. [The Refactor Playbook](#the-refactor-playbook)
19. [Cross-Service Concurrency Contracts](#cross-service-concurrency-contracts)
20. [Self-Assessment](#self-assessment)
21. [Summary](#summary)

---

## Introduction

At junior level the lesson was "do not write `for ... { go ... }` without a bound." At middle level the lesson was "choose the bound from a model — CPU count, downstream capacity, in-flight memory budget — and implement it with a worker pool, semaphore, or `errgroup.SetLimit`." At senior level the question moves up one layer: how do you design a *system* in which the bound is a first-class architectural property, propagated through every layer, observable in production, and verified by tests that will catch a regression months from now?

A senior Go engineer is rarely the person who writes the first `for ... go` in a codebase. They are the person who answers, six months later, "why did pod-3 OOM at 03:17 UTC while pods 1, 2, 4, 5 were healthy?" and discovers that one tenant on pod-3 triggered a code path with an unbounded `range` over their own catalogue. The fan-out itself was added to the codebase a year ago by an engineer who had only worked with bounded inputs. The bound was implicit in the dataset; nothing in the type system, in the lint configuration, or in the tests prevented an unbounded input from arriving.

This document is about *how to make the bound explicit*. It covers:

- The patterns that turn an unbounded loop into a bounded one (semaphore, errgroup with limit, worker pool, batch dispatcher).
- The library APIs you should know to a level where you can read their source: `golang.org/x/sync/semaphore`, `golang.org/x/sync/errgroup`, `sync.Cond` for hand-rolled cases.
- The practice of attributing a concurrency budget to a request, a tenant, a resource, or a downstream service.
- Leak detection (`go.uber.org/goleak`) and how to integrate it into your CI.
- A small library of production case studies — what failed, why, what the fix was, and what the team measured after.

By the end you should be able to design a service that is *provably* bounded: someone can pull a number out of the design and say "we will never have more than 4096 in-flight requests in this process, because here is the chain of `Acquire`/`SetLimit`/`make(chan, N)` calls that enforce it."

---

## The Senior Mindset: Concurrency as a Resource

The most damaging mental model for a senior engineer is "goroutines are cheap, so use as many as you need." This was true in 2012 and is still cited in talks and documentation. It is misleading in 2026 for three reasons:

1. **The goroutine is the cheap part. The work it does is not.** A goroutine that issues a database query holds a connection. A goroutine that uploads to S3 holds a TCP socket and a TLS buffer. A goroutine that calls a downstream service contributes to that service's load. The bound you care about is rarely "how many goroutines can the runtime hold?" — it is "how many *resources of type X* can my service safely hold open simultaneously?"
2. **Aggregate cost is non-linear.** Ten thousand idle goroutines cost a few tens of megabytes. Ten thousand goroutines each contending for the same `sync.Mutex` push the scheduler into a degenerate state where every wake-up triggers a re-acquire and the throughput collapses. The runtime is engineered for high goroutine *count*, not for arbitrarily high *contention*. Contention scales with the square of contenders in the worst case.
3. **The blast radius matters more than the average.** A service that comfortably runs at 5000 goroutines for an hour, then briefly spikes to 500 000 because a single user uploaded a large CSV, is a service whose 99.99-percentile is measured by the spike, not by the average. The bound is what determines whether the spike is a small latency bump or a pod restart that triggers a partial outage.

The senior mindset is the opposite of "goroutines are cheap." It is **"concurrency is a finite resource, the size of which I am responsible for choosing and defending."**

### A short vocabulary

| Term | Meaning |
|------|---------|
| **Fan-out** | One goroutine spawns N goroutines for parallel work. |
| **Fan-in** | N goroutines feed results to one collector. |
| **Backpressure** | A slow consumer signals upstream to slow down, rather than dropping or buffering unboundedly. |
| **Admission control** | A gate at the entry to the system that rejects work when downstream is saturated. |
| **Bound** | A number above which the system refuses to allocate more of some resource (goroutines, connections, memory). |
| **Concurrency budget** | The total number of in-flight units of work a logical scope is allowed. |
| **Drop policy** | What happens when work arrives while at the bound: block, drop, return-error, age out. |
| **Tenant isolation** | A bound applied per-user so one tenant cannot exhaust the budget for another. |
| **Quota** | A long-term bound (often per-time-window); contrasts with a concurrency bound which is "in flight at this instant." |

This vocabulary will recur throughout the document. The distinction between "bound" and "budget" matters: a bound is a hard ceiling enforced by a primitive (semaphore, channel buffer); a budget is the allocation of that ceiling across logical scopes (per-tenant, per-handler).

### How the senior thinks about every `go` statement

Before you write `go`, mentally check:

1. **Who is calling this code path?** A library function called from an unknown number of goroutines must not itself add unbounded fan-out, because the fan-out compounds. A leaf function in a request handler with a bounded input can be more relaxed.
2. **What input drives the count?** If the count is a function of user-supplied data (slice length, JSON array size, line count of an upload), the bound is your responsibility, not the user's. If the count is a function of a known-finite resource (number of CPU cores, number of shards in your own database), the bound exists implicitly and you only need to make it explicit in a comment or assertion.
3. **What happens at 10x the worst case?** Imagine the worst input you have seen multiplied by ten. Will the system absorb it (good), shed load gracefully (good), queue indefinitely (bad), or crash (worst)?
4. **What is the resource downstream?** Does each goroutine consume a database connection from a pool of 50? An OS file descriptor from a ulimit of 65 535? A slot in a remote API that returns 429 above 100/s? The bound on goroutines should be derived from the smallest downstream resource.
5. **Is the parent's lifetime bounded?** The goroutine cannot outlive the parent if the parent waits for it. If the parent is a request handler with a 30-second timeout, the goroutine inherits that bound. If the parent is `main`, the goroutine can live forever.

Five questions, every spawn site. After a few months it becomes reflexive.

---

## A Taxonomy of Bounded-Fan-Out Patterns

There are four families of bounded-fan-out pattern in idiomatic Go. Knowing all four — and when each is appropriate — is part of the senior toolkit.

### Family 1: The fixed worker pool

```go
package pool

import (
    "context"
    "sync"
)

type Job func(ctx context.Context) error

type Pool struct {
    workers int
    jobs    chan Job
    wg      sync.WaitGroup
}

func New(workers, queue int) *Pool {
    p := &Pool{
        workers: workers,
        jobs:    make(chan Job, queue),
    }
    return p
}

func (p *Pool) Start(ctx context.Context) {
    for i := 0; i < p.workers; i++ {
        p.wg.Add(1)
        go p.worker(ctx)
    }
}

func (p *Pool) worker(ctx context.Context) {
    defer p.wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case job, ok := <-p.jobs:
            if !ok {
                return
            }
            _ = job(ctx)
        }
    }
}

func (p *Pool) Submit(ctx context.Context, j Job) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case p.jobs <- j:
        return nil
    }
}

func (p *Pool) Stop() {
    close(p.jobs)
    p.wg.Wait()
}
```

Use when: the pool is long-lived (process-lifetime), jobs are uniform, and you want backpressure to bubble up to callers naturally via `Submit` blocking.

Trade-offs: requires explicit lifecycle (`Start` and `Stop`), errors must be carried in the `Job` closure (or via a separate result channel), and a slow job parks a worker.

### Family 2: The per-call semaphore

```go
package fanout

import (
    "context"

    "golang.org/x/sync/semaphore"
)

func ProcessAll(ctx context.Context, items []Item, fn func(context.Context, Item) error) error {
    sem := semaphore.NewWeighted(64)
    errCh := make(chan error, len(items))

    for _, it := range items {
        if err := sem.Acquire(ctx, 1); err != nil {
            return err
        }
        go func(it Item) {
            defer sem.Release(1)
            if err := fn(ctx, it); err != nil {
                errCh <- err
            }
        }(it)
    }

    if err := sem.Acquire(ctx, 64); err != nil {
        return err
    }
    close(errCh)
    var firstErr error
    for err := range errCh {
        if firstErr == nil {
            firstErr = err
        }
    }
    return firstErr
}
```

Use when: the fan-out is per-call (one batch, one set of inputs, finite duration), and you want a simple inline pattern without the ceremony of `Start`/`Stop`.

Trade-offs: error handling is manual (you must wire your own channel); the loop body is more verbose than `errgroup.Go`; care is required to release on every exit path (panic, ctx cancel, early return).

### Family 3: `errgroup.WithContext` plus `SetLimit`

```go
package fanout

import (
    "context"

    "golang.org/x/sync/errgroup"
)

func ProcessAll(ctx context.Context, items []Item, fn func(context.Context, Item) error) error {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(64)

    for _, it := range items {
        it := it
        g.Go(func() error {
            return fn(gctx, it)
        })
    }
    return g.Wait()
}
```

Use when: this is the default for per-call fan-out in modern Go (1.20+). It composes context cancellation, error aggregation, and a concurrency limit into a single primitive. There is rarely a good reason to write Family 2 instead, unless you need fine-grained Acquire/Release semantics (e.g. weighted tokens).

Trade-offs: `SetLimit` does not provide weighted tokens (every job costs 1). For weighted jobs, fall back to `semaphore`. The implementation queues `Go` calls when at the limit, which means `g.Go` blocks the *caller*; this is usually what you want (it produces backpressure into the loop), but be aware of it.

### Family 4: The pipeline of bounded stages

```go
package pipeline

import (
    "context"
    "sync"
)

type Stage[In, Out any] struct {
    Workers int
    Fn      func(context.Context, In) (Out, error)
}

func Run[In, Out any](ctx context.Context, in <-chan In, s Stage[In, Out]) <-chan Out {
    out := make(chan Out, s.Workers)
    var wg sync.WaitGroup
    for i := 0; i < s.Workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range in {
                r, err := s.Fn(ctx, v)
                if err != nil {
                    continue
                }
                select {
                case <-ctx.Done():
                    return
                case out <- r:
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

Use when: the work is naturally a chain (parse → transform → write), each stage has its own concurrency, and you want the upstream to apply backpressure to the downstream simply by the buffered channel filling up.

Trade-offs: pipelines hide structure inside channels and require careful close-cascade discipline; error handling is awkward unless you wrap the value type with a result struct; complex topologies (fan-out from one stage into N parallel downstreams) need careful design.

### Choosing among the four

| Situation | Family |
|-----------|--------|
| One batch of N items, want all results, one place to handle errors. | **3 — errgroup.SetLimit** |
| Long-running service that accepts jobs over time. | **1 — fixed pool** |
| Weighted jobs (some cost 1, some cost 8). | **2 — semaphore** |
| Stream-shaped data, multiple processing stages, throughput-oriented. | **4 — pipeline** |

In a typical microservice you will mostly use Family 3 inside request handlers and Family 1 for background workers. Families 2 and 4 are reserved for specialised cases.

---

## Backpressure as the Primary Cure

The defining property of a bounded fan-out is not that "at most N goroutines exist at once." It is that "if work arrives faster than the system can process it, the producer is slowed or told to stop, rather than the system silently growing without bound."

Backpressure is the *signal* by which the bound is communicated to the producer. Without backpressure, a bound is just a queue size — when the queue fills, you have to decide what happens, and most of the time the right answer is "the producer waits."

### Backpressure shapes

There are three shapes of backpressure in Go:

1. **Blocking send on a buffered channel.** The producer's `ch <- v` blocks when the buffer is full. The producer is naturally stalled.
2. **Blocking `Acquire` on a semaphore.** The producer's `sem.Acquire(ctx, 1)` blocks when no tokens are available. Equivalent to (1).
3. **Returning a "try later" error.** The producer's `Submit` returns immediately with `ErrFull`, and the caller must decide whether to retry, drop, or fail.

Shapes (1) and (2) are *implicit* backpressure: the caller does not need to know what to do; they just wait. Shape (3) is *explicit* backpressure: the caller must implement a retry policy, a drop policy, or a fail policy.

In a request-handling context, you almost always want shape (3) at the *outermost* boundary (the HTTP handler), because the client will time out anyway. You almost always want shape (1) or (2) at *inner* boundaries (between worker pools), because the producer is also a goroutine and waiting is cheap.

### A worked example: end-to-end backpressure in a CSV importer

Imagine a service that imports CSV files into a database. The flow:

```
HTTP POST → parse CSV → enrich each row → write to DB
```

If a user uploads a 10 GB CSV, the naive flow `for _, row := range rows { go enrich(row); go write(row) }` will fan out 100 million goroutines, exhaust memory, exhaust the DB connection pool, and crash. The bounded version:

```go
package importer

import (
    "context"
    "encoding/csv"
    "io"
    "net/http"

    "golang.org/x/sync/errgroup"
)

type Service struct {
    EnrichPool int // e.g. 32
    DBPool     int // e.g. 16 (matches DB connection pool size)
    BufferRows int // e.g. 256
}

func (s *Service) Import(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    rows := make(chan []string, s.BufferRows)
    enriched := make(chan EnrichedRow, s.BufferRows)

    g, gctx := errgroup.WithContext(ctx)

    g.Go(func() error {
        defer close(rows)
        cr := csv.NewReader(r.Body)
        for {
            row, err := cr.Read()
            if err == io.EOF {
                return nil
            }
            if err != nil {
                return err
            }
            select {
            case <-gctx.Done():
                return gctx.Err()
            case rows <- row:
            }
        }
    })

    enrichG, enrichCtx := errgroup.WithContext(gctx)
    enrichG.SetLimit(s.EnrichPool)
    g.Go(func() error {
        defer close(enriched)
        for row := range rows {
            row := row
            enrichG.Go(func() error {
                e, err := enrich(enrichCtx, row)
                if err != nil {
                    return err
                }
                select {
                case <-enrichCtx.Done():
                    return enrichCtx.Err()
                case enriched <- e:
                }
                return nil
            })
        }
        return enrichG.Wait()
    })

    writeG, writeCtx := errgroup.WithContext(gctx)
    writeG.SetLimit(s.DBPool)
    g.Go(func() error {
        for e := range enriched {
            e := e
            writeG.Go(func() error {
                return writeRow(writeCtx, e)
            })
        }
        return writeG.Wait()
    })

    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    w.WriteHeader(http.StatusOK)
}

type EnrichedRow struct {
    ID    string
    Value string
}

func enrich(ctx context.Context, row []string) (EnrichedRow, error) { return EnrichedRow{}, nil }
func writeRow(ctx context.Context, e EnrichedRow) error             { return nil }
```

Trace the backpressure:

- If `writeRow` is slow, `writeG.Go` blocks (it's at limit), so the loop reading `enriched` stalls.
- If the `enriched` channel buffer fills, the `enrich` goroutine's send blocks.
- If `enrichG.Go` is at limit, the loop reading `rows` stalls.
- If the `rows` channel buffer fills, the CSV reader's send blocks.
- The CSV reader's `r.Body.Read` stops being called.
- TCP backpressure flows back to the client, who sees their `POST` slow down.

The client's upload speed is now governed by the database's write speed, with bounded memory in between. This is what end-to-end backpressure looks like.

If `r.Context()` is cancelled (client disconnect), every stage sees `gctx.Done()`, closes its channels, and returns. No goroutine leaks.

### When to drop instead of block

End-to-end backpressure is the right default. There are two situations where dropping is better:

1. **Stale-tolerant work.** If the work is "send a real-time price update to a websocket client," and a new update has arrived while you were waiting to send the previous one, dropping the previous update is correct. The consumer wants freshness, not completeness.
2. **Unfair producers.** If one producer is faster than the rest and you don't want them to monopolise the pipeline, drop their excess and serve everyone.

The drop policy must be explicit:

```go
select {
case ch <- v:
case <-ctx.Done():
    return ctx.Err()
default:
    droppedCounter.Inc()
}
```

Note the `default`: without it, the `select` blocks. With it, the send is non-blocking and the drop is counted.

---

## Semaphores in Depth

A semaphore is a counter that supports two operations:

- `Acquire(n)`: block until `count >= n`, then `count -= n`.
- `Release(n)`: `count += n`, wake any waiters whose `n` is now available.

A binary semaphore (`n = 1`) is essentially a mutex. A counting semaphore with capacity `C` is the canonical way to limit concurrency to at most `C`.

### Counting vs weighted

The simplest semaphore counts indistinguishable tokens. Every `Acquire(1)` takes one token; every `Release(1)` returns one. This is the case for "at most 64 in-flight HTTP requests."

A *weighted* semaphore counts variable-size tokens. `Acquire(8)` reserves 8 units of capacity; `Acquire(1)` reserves 1. This is useful when jobs have different "cost":

- A small task costs 1 unit; a large task costs 4. A capacity-of-32 semaphore admits 32 small or 8 large or any mix.
- A small HTTP request costs 1; a large request costs 16 (proportional to memory footprint).

`golang.org/x/sync/semaphore` is weighted. `errgroup.SetLimit` is counting only.

### Hand-rolled counting semaphore

The simplest implementation in Go is a buffered channel:

```go
type Sem struct{ ch chan struct{} }

func NewSem(n int) *Sem { return &Sem{ch: make(chan struct{}, n)} }
func (s *Sem) Acquire() { s.ch <- struct{}{} }
func (s *Sem) Release() { <-s.ch }
```

A `chan struct{}` with capacity N is a perfectly correct counting semaphore. `Acquire` blocks when N elements are already in the channel; `Release` un-blocks one waiter. The implementation is two lines and is what you should use when you don't need weighted tokens, context cancellation on Acquire, or fairness guarantees.

Adding context cancellation:

```go
func (s *Sem) Acquire(ctx context.Context) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case s.ch <- struct{}{}:
        return nil
    }
}
```

Now `Acquire` returns an error when the context is cancelled — useful in handlers that must abandon work when the client disconnects.

### Fairness

A `chan struct{}` semaphore is *FIFO* among waiters: the first goroutine to block on `ch <- struct{}{}` is the first to be admitted when a `Release` happens. The Go channel implementation maintains a FIFO queue of waiters per direction.

If you do not need FIFO fairness — for example, if all waiters are equivalent and "first wins" is fine — the channel implementation is more than sufficient. If you need *priority* (one waiter type should be admitted before another), the channel is not enough; you need a custom implementation with a priority queue.

### When to choose the standard library `Mutex` instead

A `sync.Mutex` is a binary semaphore. If your bound is 1 (one in-flight at a time), use `Mutex`. Reasons:

- It is more familiar to readers.
- It plays well with the race detector.
- It does not allocate a channel.

For any bound greater than 1, a counting semaphore (channel or `x/sync/semaphore`) is correct; `Mutex` is not.

---

## `golang.org/x/sync/semaphore` Internals and Usage

The standard counting/weighted semaphore in Go is `golang.org/x/sync/semaphore`. The package is small enough that every senior Go engineer should be able to read it and explain how it works.

### The public API

```go
package semaphore

func NewWeighted(n int64) *Weighted

type Weighted struct {
    // unexported
}

func (s *Weighted) Acquire(ctx context.Context, n int64) error
func (s *Weighted) TryAcquire(n int64) bool
func (s *Weighted) Release(n int64)
```

`NewWeighted(N)` creates a semaphore of total capacity N. `Acquire(ctx, n)` waits until n units are available, then takes them; it returns `ctx.Err()` if the context is cancelled before acquisition. `TryAcquire(n)` is the non-blocking version: it returns true if it acquired, false otherwise. `Release(n)` returns n units, possibly waking waiters.

### How it works

The implementation maintains:

- `size`: the total capacity (immutable after construction).
- `cur`: the currently allocated tokens.
- `waiters`: a FIFO list of waiters, each described by `{n: requested count, ready: channel to signal}`.
- `mu`: a mutex protecting `cur` and `waiters`.

`Acquire(ctx, n)` algorithm:

1. Lock `mu`.
2. If `cur + n <= size` and `waiters` is empty (or only later-arrived waiters), increment `cur` by `n`, unlock, return nil.
3. Otherwise create a waiter with a `ready` channel, append to `waiters`, unlock.
4. Block on `select` between `ctx.Done()` and `ready`.
5. If `ctx.Done()` fires first, remove yourself from `waiters` and try to consume your slot (in case Release was racing).
6. Return.

`Release(n)` algorithm:

1. Lock `mu`.
2. Decrement `cur` by `n`.
3. While `waiters` is non-empty and the head waiter's `n` fits in the remaining capacity: pop them, increment `cur` by their `n`, signal their `ready`.
4. Unlock.

Two properties to note:

- **FIFO fairness.** A waiter who requested 4 cannot be passed over by a later waiter who requested 1, even if 1 fits and 4 does not. The package deliberately blocks small later waiters behind large earlier waiters to prevent starvation. This is sometimes the wrong policy (you may prefer "fill the slot if you can"), but it is a deliberate choice.
- **No starvation guarantee for large weights.** If you request `n` equal to or larger than `size`, you will block until *every* current holder has released; you can be starved indefinitely if releases are bursty. In practice, if you find yourself acquiring close to `size`, your design is probably wrong — the weight system is meant for fractional reservations.

### A real Acquire/Release with ctx cancellation

```go
package crawler

import (
    "context"
    "net/http"

    "golang.org/x/sync/semaphore"
)

type Crawler struct {
    sem    *semaphore.Weighted
    client *http.Client
}

func New(maxInFlight int64) *Crawler {
    return &Crawler{
        sem:    semaphore.NewWeighted(maxInFlight),
        client: &http.Client{},
    }
}

func (c *Crawler) Fetch(ctx context.Context, url string) (*http.Response, error) {
    if err := c.sem.Acquire(ctx, 1); err != nil {
        return nil, err
    }
    defer c.sem.Release(1)

    req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    if err != nil {
        return nil, err
    }
    return c.client.Do(req)
}
```

This is what a per-call concurrency limit looks like in production. The semaphore is owned by the `Crawler` and shared across goroutines. Each call to `Fetch` waits for a slot.

Note three details:

1. The `Acquire` uses `ctx`, so a cancelled request does not consume a slot it cannot use.
2. The `defer Release(1)` matches the `Acquire(ctx, 1)`. If you `Acquire(ctx, 8)`, you must `Release(8)`. Mismatches are catastrophic — releasing more than you acquired drives `cur` negative (the package does not check) and corrupts the semaphore.
3. The `Release` happens whether the HTTP call succeeded or failed.

### Weighted use case: memory-budgeted decoder

```go
package decoder

import (
    "context"
    "fmt"

    "golang.org/x/sync/semaphore"
)

type Pool struct {
    memBudget *semaphore.Weighted
}

func NewPool(memMB int64) *Pool {
    return &Pool{memBudget: semaphore.NewWeighted(memMB)}
}

func (p *Pool) Decode(ctx context.Context, sizeMB int64, data []byte) ([]byte, error) {
    if sizeMB > 256 {
        return nil, fmt.Errorf("image too large: %d MB", sizeMB)
    }
    if err := p.memBudget.Acquire(ctx, sizeMB); err != nil {
        return nil, err
    }
    defer p.memBudget.Release(sizeMB)
    return decodeImpl(data, sizeMB)
}

func decodeImpl(data []byte, sizeMB int64) ([]byte, error) { return nil, nil }
```

The pool has a total memory budget. A small image consumes 1 MB; a large image consumes 256 MB. The semaphore allows many small concurrent decodes or few large ones, with the *total memory footprint* bounded. This is the canonical use case for the weighted semaphore.

### Common mistakes

**Mistake 1: Release-before-Acquire on the error path.**

```go
if err := sem.Acquire(ctx, 1); err != nil {
    sem.Release(1) // BUG — never acquired
    return err
}
```

The `Release` corrupts the semaphore. The fix is the `defer` idiom: acquire first, then `defer Release(1)`, then do the work.

**Mistake 2: Holding the semaphore across the wrong scope.**

```go
sem.Acquire(ctx, 1)
result, err := doSlowWork()
if cacheUnsafe(result) {
    return err
}
sem.Release(1)
// ...
```

If the early return path forgets to release, the semaphore leaks. Always `defer Release(1)` immediately after `Acquire`. Restructure the code to avoid early returns between Acquire and Release.

**Mistake 3: Mixing weighted and counting use.**

If one caller does `Acquire(1)` and another does `Acquire(8)` on the same semaphore, with no clear semantics for what the weights mean, you have an underspecified system. Document the meaning of the weight (1 unit = 1 MB, or 1 unit = 1 connection) and stick to it.

**Mistake 4: `TryAcquire` without a retry plan.**

```go
if !sem.TryAcquire(1) {
    return errors.New("busy")
}
```

This is fine if "busy" is a meaningful response to the caller. It is not fine if the caller has no way to handle "busy" other than to retry in a tight loop — that is just a spin lock with extra steps. Prefer `Acquire` with a context deadline.

---

## `errgroup.SetLimit` and the Group Pattern

`golang.org/x/sync/errgroup` is the workhorse of bounded per-call fan-out. It was already a great primitive when it had only `Go` and `Wait`. The addition of `SetLimit` in 2022 made it the default choice.

### The API

```go
package errgroup

type Group struct {
    // unexported
}

func WithContext(ctx context.Context) (*Group, context.Context)

func (g *Group) Go(f func() error)
func (g *Group) TryGo(f func() error) bool
func (g *Group) SetLimit(n int)
func (g *Group) Wait() error
```

Two constructors: the zero value `Group{}` is usable but has no shared cancellation context; `WithContext` creates a derived context that is cancelled when any `Go` returns a non-nil error or `Wait` returns. Use `WithContext` 99% of the time.

`SetLimit(n)` configures the group to allow at most `n` concurrent goroutines. If `n` is negative, there is no limit (the default). Calling `SetLimit` after any `Go` has been called panics — you must set the limit before the first `Go`.

`Go(f)` enqueues `f` for execution. If the group is at the limit, `Go` blocks until a slot is free. `TryGo(f)` is the non-blocking version: it returns true if it started f, false if it would have blocked.

`Wait()` blocks until all `Go`'d functions have returned, then returns the first non-nil error (if any).

### Worked example

```go
package fetcher

import (
    "context"
    "io"
    "net/http"

    "golang.org/x/sync/errgroup"
)

type Fetcher struct {
    Client       *http.Client
    Concurrency  int
}

func (f *Fetcher) FetchAll(ctx context.Context, urls []string) (map[string][]byte, error) {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(f.Concurrency)

    results := make(map[string][]byte, len(urls))
    var mu sync.Mutex

    for _, u := range urls {
        u := u
        g.Go(func() error {
            req, err := http.NewRequestWithContext(gctx, http.MethodGet, u, nil)
            if err != nil {
                return err
            }
            resp, err := f.Client.Do(req)
            if err != nil {
                return err
            }
            defer resp.Body.Close()
            body, err := io.ReadAll(resp.Body)
            if err != nil {
                return err
            }
            mu.Lock()
            results[u] = body
            mu.Unlock()
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}

// somewhere
import "sync"
var _ sync.Mutex
```

Note three patterns:

1. **The `u := u` shadow.** Pre-Go 1.22 this is required to capture the per-iteration value. On Go 1.22+ the loop variable is per-iteration by default, but the explicit shadow remains a clear signal and is portable.
2. **The `gctx` is what the goroutines use.** If any `Go` returns an error, `gctx` is cancelled, which signals every other goroutine to abandon their HTTP request.
3. **Shared state needs its own synchronisation.** The errgroup does not synchronise access to the `results` map. We add a `sync.Mutex`.

### `Go` blocks when at limit — why this matters

Consider:

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(4)
for _, u := range hugeList {
    u := u
    g.Go(func() error { return slowFetch(gctx, u) })
}
return g.Wait()
```

If `hugeList` has 10 million entries and `slowFetch` takes 1 second, the `for` loop will not pile up 10 million enqueued goroutines. It will execute 4 goroutines, then `g.Go` will block on the 5th, then proceed when one finishes. The "fan-out" is, in fact, "fan in slow motion."

This is the *desired* behaviour, but it has a subtle implication: the loop's iteration speed is governed by the worker speed. If you wanted to also do other work in the loop (e.g. log progress), you can:

```go
for i, u := range hugeList {
    u := u
    if i%100 == 0 {
        log.Printf("submitted %d / %d", i, len(hugeList))
    }
    g.Go(func() error { return slowFetch(gctx, u) })
}
```

The log line prints every 100 successful submissions, which is approximately every 100 / 4 = 25 seconds of wall time — useful for monitoring.

### When `TryGo` is the right choice

`TryGo` is rarely the right choice. The reason `Go`'s blocking behaviour exists is that it produces backpressure: the loop slows down to match the workers. `TryGo` lets the loop run ahead at full speed, dropping work that does not fit. This is correct only when "drop" is acceptable.

A legitimate `TryGo` use case: a periodic health check that should never queue up.

```go
for {
    select {
    case <-tick.C:
        if !g.TryGo(healthCheck) {
            log.Println("skipping health check: still running previous")
        }
    case <-ctx.Done():
        return
    }
}
```

If a health check takes longer than the tick interval, we skip the next one rather than queue it. The metric we care about is "is the system healthy now," not "has every scheduled check ever run."

### Pitfall: `SetLimit` does not bound `Wait()`-related buffering

`errgroup.SetLimit(n)` limits *concurrent execution*, not the in-flight queue. There is no queue — `Go` blocks the caller. This is different from a worker pool, where `Submit` puts items in a queue.

If you want a queue (so producer can move on while workers process), you have to add one yourself:

```go
type bounded struct {
    g    *errgroup.Group
    gctx context.Context
    in   chan func() error
}

func newBounded(ctx context.Context, concurrency, queue int) *bounded {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(concurrency)
    b := &bounded{g: g, gctx: gctx, in: make(chan func() error, queue)}
    g.Go(func() error {
        for fn := range b.in {
            fn := fn
            g.Go(fn)
        }
        return nil
    })
    return b
}
```

But this hides backpressure inside the buffered channel and adds complexity. Prefer plain `Go` (which produces backpressure naturally) unless you have a documented reason for a queue.

---

## Bounded Worker Pools at Scale

For long-lived services, the worker pool is the dominant pattern. A worker pool has three components:

1. **An input channel** for jobs.
2. **A fixed set of goroutines** that read from the input channel.
3. **A lifecycle controller** (Start, Stop, Wait).

The hard part is not the basic structure; it is making the pool *production-grade*: cleanly stoppable, observable, robust to panics, and well-behaved under load.

### A production worker pool

```go
package pool

import (
    "context"
    "errors"
    "fmt"
    "log"
    "runtime/debug"
    "sync"
    "sync/atomic"
    "time"
)

type Job interface {
    ID() string
    Execute(ctx context.Context) error
}

type Pool struct {
    workers     int
    queue       chan Job
    sem         chan struct{}
    inflight    int64
    submitted   int64
    completed   int64
    failed      int64
    panicked    int64

    started     atomic.Bool
    stopOnce    sync.Once
    stopped     chan struct{}
    workersWG   sync.WaitGroup
    ctx         context.Context
    cancel      context.CancelFunc

    onPanic     func(jobID string, panicValue interface{})
    onComplete  func(jobID string, dur time.Duration, err error)
}

type Config struct {
    Workers    int
    QueueDepth int
    OnPanic    func(jobID string, panicValue interface{})
    OnComplete func(jobID string, dur time.Duration, err error)
}

func New(cfg Config) *Pool {
    if cfg.Workers <= 0 {
        cfg.Workers = 1
    }
    if cfg.QueueDepth < 0 {
        cfg.QueueDepth = 0
    }
    if cfg.OnPanic == nil {
        cfg.OnPanic = func(id string, v interface{}) {
            log.Printf("pool: job %s panicked: %v\n%s", id, v, debug.Stack())
        }
    }
    if cfg.OnComplete == nil {
        cfg.OnComplete = func(string, time.Duration, error) {}
    }
    return &Pool{
        workers:    cfg.Workers,
        queue:      make(chan Job, cfg.QueueDepth),
        sem:        make(chan struct{}, cfg.Workers),
        stopped:    make(chan struct{}),
        onPanic:    cfg.OnPanic,
        onComplete: cfg.OnComplete,
    }
}

func (p *Pool) Start(ctx context.Context) {
    if !p.started.CompareAndSwap(false, true) {
        return
    }
    p.ctx, p.cancel = context.WithCancel(ctx)
    for i := 0; i < p.workers; i++ {
        p.workersWG.Add(1)
        go p.worker(i)
    }
}

func (p *Pool) worker(id int) {
    defer p.workersWG.Done()
    for {
        select {
        case <-p.ctx.Done():
            return
        case job, ok := <-p.queue:
            if !ok {
                return
            }
            p.run(job)
        }
    }
}

func (p *Pool) run(job Job) {
    atomic.AddInt64(&p.inflight, 1)
    defer atomic.AddInt64(&p.inflight, -1)
    start := time.Now()
    var err error
    func() {
        defer func() {
            if r := recover(); r != nil {
                atomic.AddInt64(&p.panicked, 1)
                p.onPanic(job.ID(), r)
                err = fmt.Errorf("panic: %v", r)
            }
        }()
        err = job.Execute(p.ctx)
    }()
    if err != nil {
        atomic.AddInt64(&p.failed, 1)
    }
    atomic.AddInt64(&p.completed, 1)
    p.onComplete(job.ID(), time.Since(start), err)
}

func (p *Pool) Submit(ctx context.Context, job Job) error {
    if !p.started.Load() {
        return errors.New("pool not started")
    }
    atomic.AddInt64(&p.submitted, 1)
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-p.ctx.Done():
        return errors.New("pool stopped")
    case p.queue <- job:
        return nil
    }
}

func (p *Pool) TrySubmit(job Job) bool {
    if !p.started.Load() {
        return false
    }
    select {
    case p.queue <- job:
        atomic.AddInt64(&p.submitted, 1)
        return true
    default:
        return false
    }
}

func (p *Pool) Stop(ctx context.Context) error {
    var stopErr error
    p.stopOnce.Do(func() {
        close(p.queue)
        done := make(chan struct{})
        go func() {
            p.workersWG.Wait()
            close(done)
        }()
        select {
        case <-done:
            // workers exited cleanly
        case <-ctx.Done():
            stopErr = ctx.Err()
            p.cancel()
            <-done
        }
        close(p.stopped)
    })
    return stopErr
}

func (p *Pool) Stats() (submitted, completed, failed, panicked, inflight int64) {
    return atomic.LoadInt64(&p.submitted),
        atomic.LoadInt64(&p.completed),
        atomic.LoadInt64(&p.failed),
        atomic.LoadInt64(&p.panicked),
        atomic.LoadInt64(&p.inflight)
}
```

This pool is approximately 130 lines and demonstrates the production-grade features:

- **Idempotent `Start` and `Stop`** via `atomic.Bool` and `sync.Once`.
- **Graceful shutdown with timeout**: `Stop(ctx)` waits for workers but if `ctx` expires it cancels the workers' context and waits anyway.
- **Panic recovery** per job, with an injectable handler.
- **Atomic counters** for metrics, exposed via `Stats`.
- **Backpressure**: `Submit` blocks (via the channel send) when the queue is full and the context is alive.
- **TrySubmit** for drop-on-overflow callers.

### Sizing the pool — a senior-level approach

The naive answer is `runtime.NumCPU()`. The senior answer is "measure."

#### Step 1: Identify the bottleneck

For each pool, ask:

- Is the job CPU-bound? If so, pool size = `NumCPU()` to `2 × NumCPU()`.
- Is the job I/O-bound? If so, pool size = downstream concurrency limit.
- Is the job memory-bound? Pool size = budget / per-job-memory.
- Is the job mixed? Use Little's Law: throughput × latency = in-flight. Pick a target throughput and known latency; the product is the pool size.

#### Step 2: Validate with a benchmark

```go
package pool_test

import (
    "context"
    "fmt"
    "testing"
    "time"

    "yourpkg/pool"
)

type fakeJob struct {
    id  string
    dur time.Duration
}

func (f fakeJob) ID() string                          { return f.id }
func (f fakeJob) Execute(_ context.Context) error     { time.Sleep(f.dur); return nil }

func BenchmarkPoolSizes(b *testing.B) {
    for _, n := range []int{1, 2, 4, 8, 16, 32, 64, 128, 256, 512} {
        b.Run(fmt.Sprintf("workers=%d", n), func(b *testing.B) {
            p := pool.New(pool.Config{Workers: n, QueueDepth: n * 4})
            p.Start(context.Background())
            defer func() { _ = p.Stop(context.Background()) }()
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                _ = p.Submit(context.Background(), fakeJob{id: "", dur: 10 * time.Millisecond})
            }
            b.StopTimer()
            // wait for drain
            for {
                _, c, _, _, inflight := p.Stats()
                if c == int64(b.N) && inflight == 0 {
                    break
                }
                time.Sleep(time.Millisecond)
            }
        })
    }
}
```

Run with `go test -bench BenchmarkPoolSizes -benchtime=10s`. Plot the throughput vs. pool size. You will see throughput rise, plateau, and (often) fall as contention dominates. The optimum is the plateau's left edge.

#### Step 3: Pin the value with a justification

In production code, never write `Workers: 64` without a comment:

```go
p := pool.New(pool.Config{
    // 64 workers chosen via load test on 2026-03-15.
    // Bottleneck: downstream image-resizer with capacity 64 req/s.
    // Above 64 we hit 429s; below 32 we leave throughput on the table.
    Workers:    64,
    QueueDepth: 256,
})
```

The comment is for the engineer who, two years from now, will be asked "why 64? Can we make it 128?" The answer should not require an archeological dig through git blame.

---

## Request-Scoped Concurrency Budgets

A request-scoped concurrency budget is a bound applied for the duration of a single request. The simplest example: a request handler that fans out to 8 backends in parallel.

```go
func (s *Service) Handle(ctx context.Context, req Request) (Response, error) {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(8)

    results := make([]BackendResult, len(s.backends))
    for i, b := range s.backends {
        i, b := i, b
        g.Go(func() error {
            r, err := b.Query(gctx, req)
            if err != nil {
                return err
            }
            results[i] = r
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return Response{}, err
    }
    return aggregate(results), nil
}
```

This is fine for a single backend list. The bound is 8 — meaning at most 8 goroutines spawned by this handler exist simultaneously.

### The compound problem

Now imagine the service has 1000 concurrent requests, each fanning out to 8 backends. That is 8000 simultaneous backend calls — and 8000 goroutines, plus the 1000 handler goroutines. If your downstream has a connection pool of size 100, you have 80x oversubscribed it.

The per-request bound is not enough. You need a service-wide bound. Two ways to add it:

#### Option A: A shared semaphore

```go
type Service struct {
    backends    []Backend
    backendSem  *semaphore.Weighted // shared, total capacity 100
}

func NewService(backends []Backend, totalBudget int64) *Service {
    return &Service{
        backends:   backends,
        backendSem: semaphore.NewWeighted(totalBudget),
    }
}

func (s *Service) Handle(ctx context.Context, req Request) (Response, error) {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(8)

    results := make([]BackendResult, len(s.backends))
    for i, b := range s.backends {
        i, b := i, b
        g.Go(func() error {
            if err := s.backendSem.Acquire(gctx, 1); err != nil {
                return err
            }
            defer s.backendSem.Release(1)
            r, err := b.Query(gctx, req)
            if err != nil {
                return err
            }
            results[i] = r
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return Response{}, err
    }
    return aggregate(results), nil
}
```

Now every backend call across every request acquires from the same semaphore. Total in-flight backend calls = at most 100.

#### Option B: Limit at the source — admission control

```go
type Service struct {
    backends []Backend
    requests *semaphore.Weighted // max in-flight requests
}

func (s *Service) Handler(w http.ResponseWriter, r *http.Request) {
    if !s.requests.TryAcquire(1) {
        http.Error(w, "service overloaded", http.StatusServiceUnavailable)
        return
    }
    defer s.requests.Release(1)
    // ... proceed normally; each request fans out to 8, total 8 × N requests
}
```

If `requests` has capacity 12, the max fan-out is 8 × 12 = 96, comfortably within the 100-connection pool.

Option B is preferable when the policy is "shed load at the edge." Option A is preferable when the policy is "queue requests but limit downstream impact."

### Allocating a budget across heterogeneous backends

What if the 8 backends have different capacities? Backend 1 can handle 10 concurrent calls; backend 2 only 4; backends 3–8 are cloud-scale and effectively unlimited.

You need a *per-backend* semaphore, not a shared one:

```go
type Backend struct {
    Name     string
    Capacity int
    sem      *semaphore.Weighted
}

func NewBackend(name string, capacity int) *Backend {
    return &Backend{Name: name, Capacity: capacity, sem: semaphore.NewWeighted(int64(capacity))}
}

func (b *Backend) Query(ctx context.Context, req Request) (BackendResult, error) {
    if err := b.sem.Acquire(ctx, 1); err != nil {
        return BackendResult{}, err
    }
    defer b.sem.Release(1)
    return b.queryImpl(ctx, req)
}

func (b *Backend) queryImpl(ctx context.Context, req Request) (BackendResult, error) {
    return BackendResult{}, nil
}
```

Each backend's `Query` self-limits. The request-scoped errgroup limits per-request parallelism. Together they form a layered bound: per-request bound 8, per-backend bound { 10, 4, ∞, ∞, ∞, ∞, ∞, ∞ }.

---

## Multi-Tier Bounding

Real services have many tiers, each with its own bound. A typical layout:

```
ingress (admission control: 200 concurrent requests)
  → request handler (8 in-flight backend calls)
    → backend client (per-backend cap: 4 to 10)
      → connection pool (50 connections)
        → downstream service (its own capacity)
```

Each tier's bound should be derived from the tier below. Working from the bottom:

1. The downstream service publishes "we can serve 100 req/s before degrading."
2. Your connection pool sized 50 with avg call duration 500ms means in-flight 50, throughput 100/s — matches.
3. The per-backend cap of 10 means at most 10 of your goroutines wait in the connection pool queue at once.
4. The 8-in-flight-per-request and 200 concurrent requests means 1600 max backend calls in flight. Backend cap of 10 means 160 across all backends — well within 50.
5. The 200 concurrent requests bound is set so memory at peak is below 1 GB.

The arithmetic ensures no tier can overwhelm the tier below it. This is the architecture review you do before launching a service.

### Visualising the bound stack

For documentation purposes, draw a small ASCII table:

```
+----------------------+----------+---------------+
| Tier                 | Bound    | Justification |
+----------------------+----------+---------------+
| HTTP server          | 200      | mem budget    |
| Per-request fan-out  | 8        | response p99  |
| Per-backend          | 10       | downstream    |
| Connection pool      | 50       | DB capacity   |
| Downstream service   | 100 rps  | their SLO     |
+----------------------+----------+---------------+
```

This table belongs in your service's README or runbook. New engineers will read it; future you will reread it during incident response.

### When tiers conflict

If tier A's bound implies more work than tier B can absorb, the system will exhibit head-of-line blocking at tier B. Symptoms:

- Goroutines pile up at tier B's semaphore (visible in `pprof goroutine`).
- Tier A's queue fills (visible in your metrics).
- Latency p99 climbs.

The fix is to lower tier A's bound or raise tier B's capacity. There is no other answer.

### A worked sizing exercise

Service: PDF report generator. Each request renders one PDF using a headless Chrome subprocess (50 MB RAM, 2s wall time).

- Pod has 4 GB RAM. After overhead, 3 GB is available for PDFs.
- 3 GB / 50 MB = 60 concurrent renders maximum on this pod.
- Conservatively, target 80% utilisation: 48 concurrent renders.
- Per request, fan-out = 1 (one PDF per request).
- So admission control should allow at most 48 concurrent requests.

At 2s per render and 48 concurrent renders, throughput = 24 req/s per pod. If your peak is 200 req/s, you need 200/24 ≈ 9 pods, plus headroom for hot pods, so 12 pods.

This is the kind of arithmetic that should appear in a design doc. Numbers are wrong sometimes — but a wrong number is debuggable; a missing number is not.

---

## Per-Tenant and Per-Resource Quotas

Multi-tenant services need to isolate one tenant's load from another's. The mechanism is per-tenant semaphores.

### Per-tenant concurrency cap

```go
type TenantPool struct {
    mu    sync.RWMutex
    sems  map[string]*semaphore.Weighted
    limit int64
}

func NewTenantPool(perTenantLimit int64) *TenantPool {
    return &TenantPool{
        sems:  make(map[string]*semaphore.Weighted),
        limit: perTenantLimit,
    }
}

func (tp *TenantPool) sem(tenant string) *semaphore.Weighted {
    tp.mu.RLock()
    s, ok := tp.sems[tenant]
    tp.mu.RUnlock()
    if ok {
        return s
    }
    tp.mu.Lock()
    defer tp.mu.Unlock()
    if s, ok = tp.sems[tenant]; ok {
        return s
    }
    s = semaphore.NewWeighted(tp.limit)
    tp.sems[tenant] = s
    return s
}

func (tp *TenantPool) Acquire(ctx context.Context, tenant string) error {
    return tp.sem(tenant).Acquire(ctx, 1)
}

func (tp *TenantPool) Release(tenant string) {
    tp.sem(tenant).Release(1)
}
```

Now each tenant has at most `limit` in-flight requests. A noisy tenant cannot starve others.

Caveats:

- The map grows monotonically. Each unique tenant ID adds a semaphore. In a system with many tenants, GC of unused entries is a separate concern — usually a periodic sweep that removes entries with `cur == 0`.
- The per-tenant bound is in addition to the global bound. Both must be acquired.

### Per-resource quota

A different shape: limit concurrency *per resource*, where resource = a specific database, file, or external account.

```go
type ResourcePool struct {
    mu   sync.Mutex
    sems map[string]chan struct{}
    capacity int
}

func NewResourcePool(capacity int) *ResourcePool {
    return &ResourcePool{
        sems:     make(map[string]chan struct{}),
        capacity: capacity,
    }
}

func (rp *ResourcePool) Do(ctx context.Context, resourceID string, fn func() error) error {
    rp.mu.Lock()
    s, ok := rp.sems[resourceID]
    if !ok {
        s = make(chan struct{}, rp.capacity)
        rp.sems[resourceID] = s
    }
    rp.mu.Unlock()

    select {
    case s <- struct{}{}:
        defer func() { <-s }()
        return fn()
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Useful for: per-S3-bucket throttling, per-customer-API-key throttling, per-document edit locks.

### The combination

In a production multi-tenant service, you typically have:

1. A global concurrency cap (ingress).
2. A per-tenant concurrency cap (fairness).
3. A per-downstream concurrency cap (downstream protection).
4. A per-resource cap (resource protection).

A single request flowing through the system has to acquire from all four (in order, from outermost to innermost). The complexity sounds high, but each acquisition is one line of code:

```go
func (s *Service) handle(ctx context.Context, tenant, resource string) error {
    if err := s.global.Acquire(ctx, 1); err != nil { return err }
    defer s.global.Release(1)
    if err := s.byTenant.Acquire(ctx, tenant); err != nil { return err }
    defer s.byTenant.Release(tenant)
    return s.byResource.Do(ctx, resource, func() error {
        if err := s.backend.Acquire(ctx, 1); err != nil { return err }
        defer s.backend.Release(1)
        return doWork(ctx)
    })
}
```

Five lines for four bounds. The code reads as a layered acquisition, exactly mirroring the design.

---

## Admission Control and Queue Management

Admission control is the practice of *deciding at the edge* whether to accept a request, rather than starting work and discovering halfway through that you can't finish it.

### Token bucket admission

```go
package admission

import (
    "context"
    "errors"
    "sync"
    "time"
)

var ErrRejected = errors.New("admission: rejected")

type TokenBucket struct {
    mu       sync.Mutex
    tokens   float64
    capacity float64
    rate     float64
    last     time.Time
}

func NewTokenBucket(capacity, rate float64) *TokenBucket {
    return &TokenBucket{tokens: capacity, capacity: capacity, rate: rate, last: time.Now()}
}

func (tb *TokenBucket) Allow() bool {
    tb.mu.Lock()
    defer tb.mu.Unlock()
    now := time.Now()
    elapsed := now.Sub(tb.last).Seconds()
    tb.tokens = min(tb.capacity, tb.tokens+elapsed*tb.rate)
    tb.last = now
    if tb.tokens < 1 {
        return false
    }
    tb.tokens--
    return true
}

func min(a, b float64) float64 {
    if a < b {
        return a
    }
    return b
}

func (tb *TokenBucket) Wait(ctx context.Context) error {
    for {
        if tb.Allow() {
            return nil
        }
        // tokens replenish at rate `rate` per second.
        // worst-case wait for 1 token = 1/rate seconds.
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(time.Duration(float64(time.Second) / tb.rate)):
        }
    }
}
```

Token bucket bounds *rate* (requests per second), not concurrency. Combine with a semaphore for concurrency: rate limits the steady-state load, concurrency limits the peak load.

### Adaptive admission with Little's Law

Little's Law: `L = λW`, where L is in-flight count, λ is arrival rate, W is mean response time.

If you measure W (your service's p50 latency) and have a target L (your concurrency budget), you can derive the maximum λ — the rate at which you can safely admit work.

```go
type AdaptiveAdmitter struct {
    targetInFlight int
    avgLatencyEMA  float64 // exponential moving average, seconds
    alpha          float64 // smoothing constant
    mu             sync.Mutex
}

func (a *AdaptiveAdmitter) Observe(latencySec float64) {
    a.mu.Lock()
    defer a.mu.Unlock()
    if a.avgLatencyEMA == 0 {
        a.avgLatencyEMA = latencySec
    } else {
        a.avgLatencyEMA = a.alpha*latencySec + (1-a.alpha)*a.avgLatencyEMA
    }
}

func (a *AdaptiveAdmitter) MaxRPS() float64 {
    a.mu.Lock()
    defer a.mu.Unlock()
    if a.avgLatencyEMA == 0 {
        return float64(a.targetInFlight)
    }
    return float64(a.targetInFlight) / a.avgLatencyEMA
}
```

Then use `MaxRPS()` to size the token bucket dynamically. As the service slows down (W rises), the admission rate falls. As the service speeds up, the rate rises. This is a form of *self-tuning admission*.

For production this needs more sophistication (jitter, hysteresis, observation windows), but the principle is clear: measure, predict, adjust.

### CoDel as a queueing strategy

Codel (Controlled Delay) is a queueing algorithm originally from network routers. It tracks the minimum delay observed in a queue over a window; if the delay exceeds a threshold, it starts dropping packets at increasing rates.

A Go implementation for job queues:

```go
type CoDel struct {
    target   time.Duration
    interval time.Duration
    firstDrop time.Time
    dropping bool
    count    int
}

// Push: returns false if the job should be dropped.
func (c *CoDel) Push(now time.Time, queueDelay time.Duration) bool {
    if queueDelay < c.target {
        c.firstDrop = time.Time{}
        return true
    }
    if c.firstDrop.IsZero() {
        c.firstDrop = now.Add(c.interval)
        return true
    }
    if now.Before(c.firstDrop) {
        return true
    }
    c.count++
    c.firstDrop = now.Add(c.interval / time.Duration(c.count))
    return false // drop
}
```

CoDel is useful for tail-latency-sensitive systems. If your service is mostly fast but occasionally queues build up, CoDel sheds load to prevent unbounded latency.

---

## Goroutine Leak Detection with goleak

`go.uber.org/goleak` is the standard tool for detecting goroutine leaks in tests. Every senior Go codebase should have it integrated.

### The basics

```go
package mypkg_test

import (
    "testing"

    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

`VerifyTestMain` runs after the test suite and fails if any goroutines are still alive (excluding those known to be benign — Go's runtime keeps some background goroutines). If any test in the package leaked, the suite fails.

### Per-test verification

```go
func TestFoo(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ... test body
}
```

This is stricter: every test individually must not leak. Useful when you suspect specific tests of leaking but the test suite passes overall.

### Configuring goleak

Real systems often have unavoidable long-running goroutines (a logger flush, a metrics shipper, a database connection pool's keep-alive). Add them to the ignore list:

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m,
        goleak.IgnoreTopFunction("github.com/foo/bar.(*Pool).keepAlive"),
        goleak.IgnoreCurrent(),
    )
}
```

`IgnoreCurrent` captures the goroutines alive at the time `TestMain` calls `goleak`. Anything that exists *before* tests start is not a leak.

`IgnoreTopFunction` matches goroutines whose stack-top function matches the given name. Use the fully-qualified function name (you can find it in a panic stack trace).

### A test that catches an unbounded-spawn bug

```go
package fanout_test

import (
    "context"
    "testing"
    "time"

    "go.uber.org/goleak"
    "yourpkg/fanout"
)

func TestProcessAll_NoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)

    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()

    items := make([]fanout.Item, 1000)
    err := fanout.ProcessAll(ctx, items, func(ctx context.Context, item fanout.Item) error {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(50 * time.Millisecond):
            return nil
        }
    })

    _ = err
}
```

If `ProcessAll` spawns 1000 goroutines and the context is cancelled before they finish, but `ProcessAll` returns without waiting, goleak will catch it: the test function returns while goroutines are still alive.

A correct `ProcessAll` waits for all goroutines (via `errgroup.Wait` or equivalent) before returning, so no leak.

### Leak detection in production

`goleak` is a test tool. For production, you measure goroutine count via:

```go
import "runtime"

func goroutineCount() int { return runtime.NumGoroutine() }
```

Expose it as a Prometheus gauge:

```go
var GoroutineGauge = promauto.NewGaugeFunc(prometheus.GaugeOpts{
    Name: "process_goroutines",
}, func() float64 { return float64(runtime.NumGoroutine()) })
```

In production, alert if the goroutine count *grows* without bound or stays above a threshold for a sustained period. A leaking service has a goroutine count graph that looks like a sawtooth (climb between restarts).

### `pprof goroutine` profile

For ad-hoc debugging in production, the `pprof` goroutine profile gives a stack trace for every live goroutine, grouped by trace. Trigger via:

```
curl http://localhost:6060/debug/pprof/goroutine?debug=1
```

The output is a list of stacks; the count next to each tells you how many goroutines share that stack. If you see "10342 goroutines with stack `myFunc → http.Client.Do → net.netFD.Read`," you have a leak.

For complete coverage, take *two* profiles, 30 seconds apart, and diff. The goroutines that appear in both — same stack, same count or growing — are the leaks. The ones that exist briefly are normal request handlers.

---

## The Bounded Pipeline Anti-Pattern Test Harness

A test harness is a piece of test infrastructure that *forces* the anti-pattern to manifest. You write one per anti-pattern and run it on every PR.

### Harness 1: Goroutine count limit

```go
package fanout_test

import (
    "context"
    "runtime"
    "testing"

    "yourpkg/fanout"
)

const maxGoroutines = 256

func TestFanout_RespectsGoroutineLimit(t *testing.T) {
    base := runtime.NumGoroutine()
    items := make([]fanout.Item, 10000)

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    done := make(chan struct{})
    go func() {
        _ = fanout.ProcessAll(ctx, items, func(ctx context.Context, item fanout.Item) error {
            <-ctx.Done()
            return nil
        })
        close(done)
    }()

    // While the work is in progress, sample the goroutine count.
    for i := 0; i < 20; i++ {
        cur := runtime.NumGoroutine()
        if cur-base > maxGoroutines {
            t.Fatalf("goroutine count %d exceeded limit %d (base %d)", cur, maxGoroutines, base)
        }
    }

    cancel()
    <-done
}
```

This test deliberately feeds 10 000 items into a function with a 256-goroutine bound and verifies the bound holds. If someone removes the `SetLimit` call, this test catches it.

### Harness 2: Memory bound

```go
func TestFanout_RespectsMemoryLimit(t *testing.T) {
    items := make([]fanout.Item, 1000)
    runtime.GC()
    var msBefore runtime.MemStats
    runtime.ReadMemStats(&msBefore)

    ctx := context.Background()
    err := fanout.ProcessAll(ctx, items, func(ctx context.Context, item fanout.Item) error {
        // allocate something
        _ = make([]byte, 1<<20) // 1 MB
        return nil
    })
    if err != nil {
        t.Fatal(err)
    }

    var msAfter runtime.MemStats
    runtime.ReadMemStats(&msAfter)
    peak := msAfter.HeapInuse
    const budget = 256 * (1 << 20) // 256 MB
    if peak > budget {
        t.Fatalf("peak heap %d exceeded budget %d", peak, budget)
    }
}
```

This test verifies the memory bound holds. It is approximate (heap measurements include GC heuristics) but catches gross regressions.

### Harness 3: Throughput floor

Bounding helps only if it does not destroy throughput. The harness:

```go
func TestFanout_AchievesThroughput(t *testing.T) {
    items := make([]fanout.Item, 10000)
    start := time.Now()
    err := fanout.ProcessAll(context.Background(), items, func(ctx context.Context, item fanout.Item) error {
        time.Sleep(time.Millisecond)
        return nil
    })
    if err != nil {
        t.Fatal(err)
    }
    elapsed := time.Since(start)
    minThroughput := 5000 / time.Second // items / sec
    actual := time.Duration(len(items)) * time.Second / elapsed
    if actual < minThroughput {
        t.Fatalf("throughput %v below floor %v", actual, minThroughput)
    }
}
```

If someone "fixes" the unbounded fan-out by serialising the work (replacing `g.Go` with direct calls), the throughput collapses and this test catches it.

### Integrating the harnesses

Put the three harnesses in a `bounds_test.go` file. Run on every PR. Update the bounds whenever you intentionally change them (and document why in the commit).

---

## Production Case Studies

### Case Study 1: The 4 AM webhook fanout

**System.** A SaaS platform sends webhooks to customer endpoints when events occur. The webhook dispatcher reads events from Kafka and, for each event, fans out to all configured customer endpoints.

**Bug.** The fan-out was unbounded: `for _, ep := range endpoints { go dispatch(ep, event) }`. For most customers `len(endpoints)` was 1 to 10. One customer added 5000 endpoints (they were testing).

**Incident.** At 4 AM UTC the event volume from that customer spiked (a batch job ran). 5000 endpoints × 200 events/s = 1 000 000 goroutines/s being spawned. The Go runtime grew from 800 MB to 32 GB in 90 seconds. The pod was OOM-killed.

**Cascading failure.** Kafka consumer group rebalanced to surviving pods. They received the customer's events and spawned 1 000 000 goroutines/s. They OOM-killed. Rebalance again. Repeat. All 8 pods were down for 14 minutes.

**Fix.** Bounded the dispatch with a per-customer semaphore:

```go
sem := perCustomerSems.Get(event.CustomerID, 64)
if err := sem.Acquire(ctx, 1); err != nil { ... }
defer sem.Release(1)
go dispatch(ep, event)
```

Plus a global cap of 4096 in-flight dispatches.

**Lessons.**
- The bound must be enforced where it matters. Per-customer here, because one customer's behaviour drove the spike.
- A test with 5000 endpoints did not exist; bounds-violation tests would have caught this in CI.
- The rebalance cascade is worse than the original fault. Bounds prevent the cascade.

### Case Study 2: The "free goroutine" cleanup

**System.** A file-processing service spawns a goroutine to clean up temp files after each request.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    tmp := processUpload(r)
    go cleanupTempFile(tmp) // fire and forget
    w.WriteHeader(http.StatusOK)
}
```

**Bug.** `cleanupTempFile` opens an S3 connection to record the cleanup. Under load, the goroutine count grew unboundedly because the S3 client occasionally blocked for tens of seconds.

**Incident.** Memory usage rose 50 MB per minute. After 24 hours, OOM. Service restart "fixed" it. Restarts recurred daily.

**Diagnosis.** `pprof goroutine` showed 5000 goroutines parked in `s3.Client.PutObject`.

**Fix.** A bounded worker pool consuming cleanup tasks from a channel. Handler enqueues; pool drains.

```go
var cleanupPool = pool.New(pool.Config{Workers: 16, QueueDepth: 1024})

func init() { cleanupPool.Start(context.Background()) }

func handler(w http.ResponseWriter, r *http.Request) {
    tmp := processUpload(r)
    if !cleanupPool.TrySubmit(cleanupJob{tmp: tmp}) {
        log.Println("cleanup queue full; cleaning synchronously")
        cleanupTempFile(tmp)
    }
    w.WriteHeader(http.StatusOK)
}
```

**Lessons.**
- "Fire and forget" is unbounded fan-out spelled with extra steps.
- Background work belongs in a pool, not a `go`.
- Have a graceful degradation path (here: synchronous cleanup) when the pool is full.

### Case Study 3: The reader-spawning sync

**System.** A sync service reads documents from S3 and writes them to an internal store. The naive version:

```go
for _, key := range keys {
    go func(k string) {
        body := s3Get(k)
        store.Put(k, body)
    }(key)
}
```

**Bug.** `keys` was a paginated S3 list result; the average page was 1000 entries but occasional pages were 100 000.

**Incident.** A monthly sync triggered the 100 000-entry page. The service spawned 100 000 goroutines, each holding an S3 client connection. The S3 client connection pool was exhausted; new connections failed; goroutines blocked. Memory climbed because each goroutine held the partial response in a buffer. OOM.

**Fix.** Replaced with errgroup.SetLimit(32) — derived from the S3 client's max connections, which was 50, leaving headroom for unrelated calls.

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(32)
for _, key := range keys {
    key := key
    g.Go(func() error {
        body, err := s3Get(gctx, key)
        if err != nil { return err }
        return store.Put(gctx, key, body)
    })
}
return g.Wait()
```

**Lessons.**
- Pagination boundaries hide the true input size. Don't assume "a page" is small.
- Derive your bound from the smallest downstream resource.
- A simple one-line change (`SetLimit(32)`) fixed a complete outage.

### Case Study 4: The retry storm

**System.** A microservice calls a downstream API. On failure, it retries up to 3 times with exponential backoff. Retries run as goroutines:

```go
for _, item := range items {
    go func(it Item) {
        for attempt := 0; attempt < 3; attempt++ {
            if err := callAPI(it); err == nil { return }
            time.Sleep(time.Duration(attempt+1) * time.Second)
        }
    }(item)
}
```

**Bug.** Two compounding issues. First, the fan-out is unbounded over `items`. Second, when the downstream fails (which causes all items to retry), the retry sleep keeps the goroutine alive while doing nothing.

**Incident.** The downstream had a brief outage. All N items entered the retry loop. Each goroutine slept 1 + 2 + 3 = 6 seconds in total. For 6 seconds, all N goroutines were alive. N = 50 000. The Go runtime survived but the connection pool was exhausted for those 6 seconds — every subsequent request also failed during that window. The downstream came back; the service did not (because all 50 000 retries hit it simultaneously when it recovered, triggering another retry storm).

**Fix.** A bounded retry pool with jitter:

```go
sem := semaphore.NewWeighted(32)
for _, item := range items {
    item := item
    go func() {
        for attempt := 0; attempt < 3; attempt++ {
            if err := sem.Acquire(ctx, 1); err != nil { return }
            err := callAPI(item)
            sem.Release(1)
            if err == nil { return }
            jitter := time.Duration(rand.Intn(1000)) * time.Millisecond
            time.Sleep(time.Duration(attempt+1)*time.Second + jitter)
        }
    }()
}
```

Even better: a circuit breaker that short-circuits when the downstream is known to be down.

**Lessons.**
- Retries amplify unbounded fan-out. A retry storm is worse than the original failure.
- Use jitter to spread the load over time.
- Combine with circuit breakers to detect downstream failure.

### Case Study 5: The slow-leak

**System.** An HTTP service uses `context.Background()` (not `r.Context()`) for a sub-task spawned per request:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    go indexThing(context.Background(), thing) // wrong context
    w.WriteHeader(http.StatusOK)
}
```

**Bug.** Subtle. The handler returns immediately, so requests complete quickly. The `indexThing` goroutine continues regardless of client disconnect. Under most loads this is fine. But `indexThing` occasionally takes 60s under load. At 10 req/s, you accumulate 600 in-flight `indexThing` goroutines.

**Incident.** Service worked fine at 5 req/s in QA. In production at peak (100 req/s), goroutine count grew to 6000 and stayed there. Memory climbed proportionally. No crash, but elevated latency and a slow leak (the goroutines did eventually finish, but the average concurrency was 10x the request rate).

**Fix.** Use a bounded background pool. Handler enqueues; pool processes. The handler does not return until the job is enqueued (so backpressure flows to the client).

**Lessons.**
- `go func() { ... }(...)` is always a fan-out, even when it looks like "just one goroutine."
- Per-request background work should still be bounded across requests.
- Use `r.Context()` for everything in a request — even fire-and-forget work — unless you have a documented reason not to.

### Case Study 6: The unbounded reader

**System.** A stream-processing service reads messages from a Kafka topic and dispatches each:

```go
for msg := range consumer.Messages() {
    go process(msg)
}
```

**Bug.** When the consumer lags (catching up after a restart), `consumer.Messages()` delivers messages as fast as Kafka can. The service spawns goroutines as fast as messages arrive. At 50 000 msg/s for 30s after a restart, the goroutine count peaks at 1.5 million.

**Incident.** Restart caused OOM in the lag-catch-up phase. The restart loop took 4 hours to converge (because each restart restarted the lag).

**Fix.** Bounded pool with backpressure to the consumer:

```go
pool := pool.New(pool.Config{Workers: 100, QueueDepth: 1000})
pool.Start(ctx)
for msg := range consumer.Messages() {
    if err := pool.Submit(ctx, processJob{msg: msg}); err != nil { return }
}
```

The `Submit` blocks when the queue is full, which slows the `range`, which causes Kafka's offset commit lag to grow — but that's correct: the service signals "I am at capacity, slow down."

**Lessons.**
- Consumer lag during catch-up is a hidden trigger for fan-out explosions.
- Bounded pools naturally apply backpressure to consumers via blocking submit.
- The fix is small (10 lines) but the savings (4-hour outage → no outage) is enormous.

---

## Failure Modes Beyond OOM

The most visible failure mode of unbounded fan-out is OOM. There are several less-visible ones that are equally damaging.

### Scheduler thrash

When the runnable goroutine count vastly exceeds GOMAXPROCS, the scheduler spends a disproportionate share of its time picking the next goroutine. With work-stealing, a P that has nothing to run scans other Ps' queues. With many runnable goroutines, the scan is short; with a million, it is long. The effective CPU available to user code drops.

Symptoms:
- High `runtime.SchedStats` (`go tool trace` shows scheduler events).
- CPU saturated but wall-clock progress slow.
- Latency p99 climbs disproportionately to p50.

Mitigation: bounded fan-out keeps runnable count proportional to GOMAXPROCS.

### File descriptor exhaustion

Every TCP connection, every file open, every Unix-domain socket consumes an FD. The default ulimit is often 1024 (development) or 65 535 (production). If your fan-out is "one goroutine per connection," you cap at ulimit.

Once you hit ulimit:
- New connections fail with `EMFILE` ("too many open files").
- Existing connections continue working — until they need to open a sub-resource.
- Goroutines pile up blocked on connect/accept; memory grows.

Mitigation: bound concurrency below ulimit. Reserve headroom for non-request FDs (logs, metrics, profiling endpoints).

### Connection pool exhaustion

Database connection pools have a fixed maximum (e.g. `MaxOpenConns: 50`). Unbounded fan-out into a database operation means N goroutines compete for 50 connections. The 51st through Nth block on `db.Conn`. If their context is short, they time out; if it is long, they accumulate.

Symptoms:
- `sql.DB` stats (`db.Stats()`) show `WaitCount` and `WaitDuration` climbing.
- Application-level p99 climbs but database-level p99 is fine.

Mitigation: bound fan-out *below* MaxOpenConns. Rule of thumb: pool size = MaxOpenConns × 0.8.

### Memory allocator pressure

Each goroutine allocates from its P's local cache (`mcache`). High goroutine churn forces the allocator to refill caches frequently from `mcentral`, increasing lock contention in the allocator.

Symptoms (visible in `pprof alloc_space` or `go tool trace`):
- High allocation rate.
- `mcentral` lock contention in the heap profile.
- GC running more frequently.

Mitigation: reuse goroutines via a pool. A pool of 100 workers handling 1M jobs sequentially allocates far less than 1M goroutines.

### GC pause amplification

GC scans every goroutine's stack. With more goroutines, the stack-scan phase is longer. With a million live goroutines, even a "concurrent" GC pauses noticeably while it enumerates stacks.

Symptoms:
- `GODEBUG=gctrace=1` shows large `STW` durations.
- Latency p99 spikes correlate with GC events.

Mitigation: bounded goroutine count keeps stack-scan cost predictable.

### Logging back-pressure

Each goroutine that logs adds to the log buffer. With unbounded fan-out, log writes become a contention point: every `log.Printf` call serialises through the logger's mutex. The serialisation can dominate.

Symptoms:
- `pprof` profile shows time in `log.Output`.
- Goroutines stuck in `log.(*Logger).Output → bufio.(*Writer).Write → syscall.Write`.

Mitigation: bounded concurrency, plus asynchronous logging (e.g. `zap` with a `WriteSyncer` that batches writes).

### Connection refused — outbound

When you fan out to make HTTP calls, your process opens TCP connections. If the destination has accept queue limits or connection-rate limits, your fan-out can hit them. Result: `connection refused` or `connection reset` errors.

Mitigation: bound concurrency to the destination's known capacity. Coordinate with the destination team if needed.

### Cascading failure to dependents

Your service has callers. Unbounded fan-out in your service degrades your latency. Your callers' retries amplify this. The result is a cascading failure across services.

Mitigation: bound your fan-out; advertise your concurrency limits in the API doc; reject excess load at the edge.

---

## Designing for Graceful Degradation

Bounds are necessary. But what happens *at* the bound is policy. Three policies, in increasing order of sophistication:

### Policy 1: Reject

When at capacity, return an error immediately. The caller is responsible for handling the rejection.

```go
if !sem.TryAcquire(1) {
    http.Error(w, "service overloaded", http.StatusServiceUnavailable)
    return
}
defer sem.Release(1)
```

Pros: caller has full control; load-shedding is explicit.
Cons: caller must implement a retry-with-backoff; rude to clients.

### Policy 2: Wait

When at capacity, block the caller until a slot opens. Apply a deadline so the wait is bounded.

```go
ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
defer cancel()
if err := sem.Acquire(ctx, 1); err != nil {
    http.Error(w, "timeout waiting", http.StatusGatewayTimeout)
    return
}
defer sem.Release(1)
```

Pros: smooths load spikes; clients don't have to retry.
Cons: under sustained overload, the queue grows and latency degrades for everyone.

### Policy 3: Degrade

When at capacity, return a *degraded* response. The caller gets a partial answer rather than no answer.

```go
type Response struct { Items []Item; Degraded bool }

func (s *Service) List(ctx context.Context) (Response, error) {
    if !s.sem.TryAcquire(1) {
        // serve from cache, mark degraded
        return Response{Items: s.cache.Get(), Degraded: true}, nil
    }
    defer s.sem.Release(1)
    items, err := s.refreshFromDB(ctx)
    if err != nil { return Response{}, err }
    s.cache.Set(items)
    return Response{Items: items, Degraded: false}, nil
}
```

Pros: callers always get something; tail latency is bounded.
Cons: requires a degradation strategy (cache, default value, partial response); risk of serving stale data without realising.

### Combining policies by tier

A typical pattern:

- Edge tier: Reject (HTTP 503 with `Retry-After`).
- Middle tier: Wait with deadline.
- Background tier: Degrade or drop.

This gives clients of the public API explicit signals (use them in retry/backoff), gives internal callers smooth load shedding, and prevents background work from starving foreground work.

---

## The Refactor Playbook

You inherit a codebase with hundreds of unbounded fan-out sites. How do you fix them all?

### Step 1: Inventory

Run a grep:

```
git grep -n "go func" -- '*.go'
git grep -n "^\s*go " -- '*.go'
```

Tag each site with: file, line, input (slice? channel? scalar?), bound (none, comment, structural).

Hundreds of sites is normal in a large codebase. Categorise:

- **Safe**: the input is provably small (a fixed iteration, a small enum).
- **Lurking**: the input is bounded in current usage but not by contract.
- **Hot**: the input is or could be large.

### Step 2: Add a lint

Use a custom analyser (`golang.org/x/tools/go/analysis`) that flags `go` statements inside `for` loops whose iteration variable comes from a slice or channel. The lint should be a warning at first, an error after a transition period.

A starter analyser:

```go
package gofor

import (
    "go/ast"

    "golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{
    Name: "gofor",
    Doc:  "checks for `go` inside `for` over slices/channels",
    Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    for _, f := range pass.Files {
        ast.Inspect(f, func(n ast.Node) bool {
            forStmt, ok := n.(*ast.RangeStmt)
            if !ok {
                return true
            }
            ast.Inspect(forStmt.Body, func(b ast.Node) bool {
                if gs, ok := b.(*ast.GoStmt); ok {
                    pass.Reportf(gs.Pos(), "go inside for range; ensure bounded fan-out")
                }
                return true
            })
            return true
        })
    }
    return nil, nil
}
```

Run it in CI. Every new unbounded fan-out gets flagged.

### Step 3: Refactor by severity

Hot sites first. For each:

1. Identify the bound. What is the smallest downstream resource? What is the memory budget?
2. Insert `errgroup.SetLimit(N)` or a worker pool.
3. Add a bounds test (see "Bounded Pipeline Anti-Pattern Test Harness").
4. Run load tests to verify throughput is preserved.
5. Deploy.

Then lurking sites. Then safe sites (add a comment documenting the bound; no code change needed).

### Step 4: Establish a "no new fan-out" rule

PRs that add `go` inside a `for` over user-supplied data must include a bound, with a comment explaining why the bound is what it is. Make this a code review rule and add it to your style guide.

### Step 5: Build observability

Add a Prometheus gauge for `runtime.NumGoroutine()`. Add per-pool gauges for `inflight`. Alert if the goroutine count exceeds a threshold.

This is the lasting layer: even if a future PR introduces an unbounded fan-out, the metric will catch it.

---

## Cross-Service Concurrency Contracts

In a microservice architecture, each service has its own concurrency bounds. These bounds form an implicit contract between services:

- Service A says "I can handle 100 concurrent requests."
- Service B (a caller of A) says "I will not send more than 100."
- The contract is enforced by both: A by load-shedding, B by client-side concurrency limits.

### Server-side enforcement

Service A enforces with an admission control middleware:

```go
type AdmissionMiddleware struct {
    sem *semaphore.Weighted
}

func (m *AdmissionMiddleware) Wrap(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !m.sem.TryAcquire(1) {
            w.Header().Set("Retry-After", "1")
            http.Error(w, "overloaded", http.StatusServiceUnavailable)
            return
        }
        defer m.sem.Release(1)
        next.ServeHTTP(w, r)
    })
}
```

### Client-side enforcement

Service B enforces with a bounded HTTP client:

```go
type Client struct {
    http *http.Client
    sem  *semaphore.Weighted
}

func (c *Client) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
    if err := c.sem.Acquire(ctx, 1); err != nil {
        return nil, err
    }
    defer c.sem.Release(1)
    return c.http.Do(req.WithContext(ctx))
}
```

Sized to match: `c.sem` capacity = service A's capacity / number of B-instance pods (so the aggregate B-side limit ≤ A-side limit).

### Capacity negotiation

In a perfectly engineered system, the bounds are negotiated:

- A publishes "capacity: 100 RPS, max-in-flight: 50."
- B knows "there are 5 B-pods; each gets 10 in-flight and 20 RPS."
- A token-bucket and semaphore in B enforce these.

In a real system, the bounds are documented in runbooks and reviewed quarterly. The capacity is measured (load tests) and re-confirmed when the system changes.

### Pitfall: cross-service amplification

If A's capacity is X and B fans out to C, D, E (each with its own capacity), B's effective bound is `min(B_max, C_max, D_max, E_max) / fan-out`. The arithmetic is fiddly but the conclusion is universal: bounds compound, and the slowest downstream is the cap on everyone.

---

## Self-Assessment

Before claiming senior-level competence with this anti-pattern, answer:

1. Can you explain the differences between `errgroup.SetLimit`, `semaphore.Weighted`, and a hand-rolled `chan struct{}` semaphore? When do you use each?
2. Given a service that fans out 8 backend calls per request and serves 200 concurrent requests, what is the bound on simultaneous backend goroutines? What is your strategy to prevent it from oversubscribing a connection pool of 50?
3. What does end-to-end backpressure look like in a 3-stage pipeline? Sketch the code.
4. Name three failure modes of unbounded fan-out *other than* OOM. What metric tells you each is happening?
5. How does `goleak.VerifyTestMain` detect a leak? What is the difference between `IgnoreCurrent` and `IgnoreTopFunction`?
6. Given a Kafka consumer that processes messages with one goroutine per message, how do you bound it without dropping messages?
7. What is Little's Law? How do you use it to derive a concurrency bound from a target throughput and an observed latency?
8. Write a 50-line test that fails if the codebase reintroduces unbounded fan-out. Explain how it works.
9. Describe a real incident caused by unbounded fan-out. What was the bound that was missing? Where was it placed in the fix?
10. In a per-tenant-bounded service, what prevents the semaphore map from leaking entries for tenants that no longer exist?

If you cannot answer half of these without checking notes, you have more to learn. If you can answer all of them, you are ready to lead a refactor.

---

## Summary

- Treat concurrency as a finite resource. Every `go` statement is a draw against a budget.
- Choose between worker pool, semaphore, errgroup-with-limit, and pipeline based on the shape of the work.
- Backpressure is end-to-end: it must flow from the consumer back to the producer through every stage.
- `golang.org/x/sync/semaphore` is weighted and FIFO. `errgroup.SetLimit` is counting only but combines limit, error aggregation, and context cancellation into one primitive.
- A production worker pool has Start, Stop, panic recovery, metrics, and bounded Submit. About 130 lines.
- Multi-tier bounds compound. Document the bound stack. Derive each tier's bound from the tier below it.
- Per-tenant and per-resource semaphores prevent one tenant from monopolising the service.
- Admission control at the edge is the cheapest place to shed load.
- `go.uber.org/goleak` should be in every package's `TestMain`. `runtime.NumGoroutine()` should be a Prometheus gauge.
- Failure modes go far beyond OOM: scheduler thrash, FD exhaustion, GC pause amplification, allocator contention, cascading failure to dependents.
- Refactor systematically: inventory → lint → fix hot sites → fix lurking sites → no-new-fan-out rule → observability.
- Cross-service bounds are a contract. Both server and client enforce.

Mastering this anti-pattern is, in a sense, mastering production-grade Go concurrency. Everything you build on top — distributed locks, queues, schedulers — assumes you can reason about how many goroutines exist at every instant and why.

---

## Appendix A: Worked Code Patterns

### A.1 — A reusable bounded job runner

The following type is the "Swiss army knife" of bounded fan-out for senior work. It composes a worker pool, a result channel, error aggregation, and panic recovery into one re-usable component.

```go
package runner

import (
    "context"
    "errors"
    "fmt"
    "runtime/debug"
    "sync"
    "sync/atomic"
)

type Result[T any] struct {
    Value T
    Err   error
}

type Runner[In, Out any] struct {
    workers int
    fn      func(context.Context, In) (Out, error)

    in      chan In
    out     chan Result[Out]
    done    chan struct{}
    wg      sync.WaitGroup
    closed  atomic.Bool
}

func New[In, Out any](workers int, fn func(context.Context, In) (Out, error)) *Runner[In, Out] {
    return &Runner[In, Out]{
        workers: workers,
        fn:      fn,
        in:      make(chan In, workers*2),
        out:     make(chan Result[Out], workers*2),
        done:    make(chan struct{}),
    }
}

func (r *Runner[In, Out]) Start(ctx context.Context) {
    for i := 0; i < r.workers; i++ {
        r.wg.Add(1)
        go r.worker(ctx)
    }
    go func() {
        r.wg.Wait()
        close(r.out)
        close(r.done)
    }()
}

func (r *Runner[In, Out]) worker(ctx context.Context) {
    defer r.wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case v, ok := <-r.in:
            if !ok {
                return
            }
            r.runOne(ctx, v)
        }
    }
}

func (r *Runner[In, Out]) runOne(ctx context.Context, v In) {
    var (
        result Out
        err    error
    )
    func() {
        defer func() {
            if rec := recover(); rec != nil {
                err = fmt.Errorf("panic: %v\n%s", rec, debug.Stack())
            }
        }()
        result, err = r.fn(ctx, v)
    }()
    select {
    case <-ctx.Done():
    case r.out <- Result[Out]{Value: result, Err: err}:
    }
}

func (r *Runner[In, Out]) Submit(ctx context.Context, v In) error {
    if r.closed.Load() {
        return errors.New("runner closed")
    }
    select {
    case <-ctx.Done():
        return ctx.Err()
    case r.in <- v:
        return nil
    }
}

func (r *Runner[In, Out]) Close() {
    if r.closed.CompareAndSwap(false, true) {
        close(r.in)
    }
}

func (r *Runner[In, Out]) Results() <-chan Result[Out] { return r.out }
func (r *Runner[In, Out]) Done() <-chan struct{}       { return r.done }
```

Usage:

```go
type URL string
type Body []byte

func main() {
    ctx := context.Background()
    fetcher := New[URL, Body](16, func(ctx context.Context, u URL) (Body, error) {
        req, _ := http.NewRequestWithContext(ctx, "GET", string(u), nil)
        resp, err := http.DefaultClient.Do(req)
        if err != nil { return nil, err }
        defer resp.Body.Close()
        return io.ReadAll(resp.Body)
    })
    fetcher.Start(ctx)

    go func() {
        defer fetcher.Close()
        for _, u := range manyURLs {
            _ = fetcher.Submit(ctx, URL(u))
        }
    }()

    for res := range fetcher.Results() {
        if res.Err != nil { log.Println(res.Err); continue }
        log.Printf("got %d bytes", len(res.Value))
    }
}
```

The pattern of "producer goroutine + bounded pool + result channel" is the workhorse of throughput-oriented Go services. Once you have a type like `Runner`, you stop writing the wiring each time.

### A.2 — A retry-aware bounded executor

Retries multiply fan-out. A bounded executor with retries:

```go
package executor

import (
    "context"
    "math"
    "math/rand"
    "time"

    "golang.org/x/sync/semaphore"
)

type Policy struct {
    Concurrency int
    MaxAttempts int
    BaseDelay   time.Duration
    MaxDelay    time.Duration
    JitterFrac  float64 // 0.0 - 1.0
}

type Executor struct {
    sem    *semaphore.Weighted
    policy Policy
}

func New(p Policy) *Executor {
    return &Executor{
        sem:    semaphore.NewWeighted(int64(p.Concurrency)),
        policy: p,
    }
}

func (e *Executor) Do(ctx context.Context, op func(context.Context) error) error {
    var lastErr error
    for attempt := 0; attempt < e.policy.MaxAttempts; attempt++ {
        if err := e.sem.Acquire(ctx, 1); err != nil { return err }
        err := op(ctx)
        e.sem.Release(1)
        if err == nil { return nil }
        lastErr = err
        if !retryable(err) { return err }
        if attempt+1 == e.policy.MaxAttempts { break }
        delay := backoff(attempt, e.policy.BaseDelay, e.policy.MaxDelay, e.policy.JitterFrac)
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(delay):
        }
    }
    return lastErr
}

func retryable(err error) bool {
    // Application-specific; commonly: temporary, timeout, 5xx.
    return true
}

func backoff(attempt int, base, max time.Duration, jitter float64) time.Duration {
    d := float64(base) * math.Pow(2, float64(attempt))
    if d > float64(max) { d = float64(max) }
    j := d * jitter * (rand.Float64()*2 - 1)
    return time.Duration(d + j)
}
```

The key insight: the semaphore is *released between retries*. While the retry waits, the slot is available for another caller. This prevents retry storms from saturating the executor.

### A.3 — A drain-on-cancel pool

Some pools must drain in-flight work even when cancelled, because the work is committing to a database and abandoning it would leave a corrupt state. Drain-on-cancel:

```go
package drainpool

import (
    "context"
    "sync"
    "time"
)

type Job func() error

type Pool struct {
    workers int
    drainTO time.Duration
    in      chan Job
    wg      sync.WaitGroup
    stop    chan struct{}
}

func New(workers int, drainTimeout time.Duration) *Pool {
    return &Pool{
        workers: workers,
        drainTO: drainTimeout,
        in:      make(chan Job),
        stop:    make(chan struct{}),
    }
}

func (p *Pool) Start() {
    for i := 0; i < p.workers; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for j := range p.in {
                _ = j()
            }
        }()
    }
}

func (p *Pool) Submit(j Job) bool {
    select {
    case <-p.stop:
        return false
    case p.in <- j:
        return true
    }
}

func (p *Pool) Shutdown(ctx context.Context) error {
    close(p.stop)
    close(p.in)
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    drainCtx, cancel := context.WithTimeout(ctx, p.drainTO)
    defer cancel()
    select {
    case <-done:
        return nil
    case <-drainCtx.Done():
        return context.DeadlineExceeded
    }
}
```

`Shutdown` waits up to `drainTimeout` for in-flight jobs to complete. After that, it returns the deadline error, but the workers continue (to avoid abandoning partial DB transactions). The pattern: cancellation is a *request*, not a *demand*. The owner of the pool decides when to give up.

### A.4 — A leaky-bucket goroutine spawner

Rate-limiting the rate of *spawning* (not just the count of live goroutines):

```go
package spawner

import (
    "context"
    "time"

    "golang.org/x/time/rate"
)

type Spawner struct {
    rl *rate.Limiter
}

func New(perSec float64, burst int) *Spawner {
    return &Spawner{rl: rate.NewLimiter(rate.Limit(perSec), burst)}
}

func (s *Spawner) Go(ctx context.Context, fn func(context.Context)) error {
    if err := s.rl.Wait(ctx); err != nil {
        return err
    }
    go fn(ctx)
    return nil
}
```

`rl.Wait` blocks until a token is available (or the context is cancelled). The pattern is useful when the cost is not in the steady-state goroutine count but in the spawn churn (e.g. each spawn triggers an HTTP handshake or a TLS negotiation).

Caveat: this bounds the rate but not the live count. Combine with a semaphore for both.

### A.5 — A bounded futures pattern

Sometimes you want the ergonomics of `f := launch(...)` followed by `f.Wait()` — a "future" or "promise." Bounded:

```go
package future

import (
    "context"

    "golang.org/x/sync/semaphore"
)

type Future[T any] struct {
    done chan struct{}
    val  T
    err  error
}

func (f *Future[T]) Wait(ctx context.Context) (T, error) {
    var zero T
    select {
    case <-ctx.Done():
        return zero, ctx.Err()
    case <-f.done:
        return f.val, f.err
    }
}

type Pool struct {
    sem *semaphore.Weighted
}

func New(concurrency int64) *Pool {
    return &Pool{sem: semaphore.NewWeighted(concurrency)}
}

func Submit[T any](p *Pool, ctx context.Context, fn func(context.Context) (T, error)) (*Future[T], error) {
    if err := p.sem.Acquire(ctx, 1); err != nil {
        return nil, err
    }
    f := &Future[T]{done: make(chan struct{})}
    go func() {
        defer p.sem.Release(1)
        defer close(f.done)
        f.val, f.err = fn(ctx)
    }()
    return f, nil
}
```

The user code:

```go
pool := New(16)
fs := make([]*Future[Result], 0, len(items))
for _, it := range items {
    f, err := Submit(pool, ctx, func(ctx context.Context) (Result, error) { return work(ctx, it) })
    if err != nil { return err }
    fs = append(fs, f)
}
for _, f := range fs {
    r, err := f.Wait(ctx)
    if err != nil { return err }
    use(r)
}
```

This pattern combines bounded concurrency with the "wait for all" ergonomics. It is more verbose than `errgroup` but gives you per-future error handling.

---

## Appendix B: Reading the Runtime

You cannot reason about goroutine bounds without understanding what the runtime does with them. Three runtime files are worth reading at the senior level.

### B.1 — `src/runtime/proc.go`

The scheduler. Key functions:

- `newproc`: called by the `go` statement. Allocates a `g` struct and puts it on a P's local run queue.
- `findRunnable`: the main scheduling loop, called by an M when it needs work. Polls local queue, then global queue, then steals from other Ps, then checks the net poller, then sleeps.
- `gopark`: the universal "block this goroutine" entry point.
- `goready`: the universal "wake this goroutine" entry point.

What to look for at senior level:

- The `runqsize` is bounded (256 per P). When a P's queue fills, half is dumped to the global queue. This is the runtime's own form of backpressure.
- `findRunnable` has heuristics for fairness (steal evenly, check global queue every 61 schedules to avoid starvation). The constant 61 is a Mersenne prime to avoid resonance with other counters.
- `gopark` does not allocate; it suspends an existing g.

### B.2 — `src/runtime/chan.go`

Channel implementation. Key functions:

- `chansend`: the send half.
- `chanrecv`: the receive half.
- `closechan`: close.

What to look for:

- The buffered case is a ring buffer; sender writes at `sendx`, receiver reads at `recvx`.
- When the channel is full, `chansend` parks the goroutine on `sendq` (a FIFO list of waiting senders).
- When a receiver arrives, it pops from `sendq` and copies the value directly — bypassing the buffer if a sender is waiting. This is an optimization.

Why this matters: a `chan struct{}` semaphore inherits this optimization. When a release wakes a waiter, the waiter is scheduled immediately, not after a buffer dance.

### B.3 — `golang.org/x/sync/semaphore/semaphore.go`

About 130 lines. Read it. The state machine is:

- `cur`: currently allocated tokens.
- `waiters`: a `container/list.List` of pending acquirers.
- `mu`: a single mutex.

Notable design choices:

- Waiters are processed in FIFO order. The runtime channel does the same.
- A waiter holds a `ready chan struct{}` that is closed (not sent) when its turn comes. This is more efficient than sending.
- The context cancellation path uses a select to wait on either `ready` or `ctx.Done()`. If `ctx.Done()` wins, the waiter must remove itself from the list (the race window is handled with a re-acquire of the mutex).

### B.4 — `golang.org/x/sync/errgroup/errgroup.go`

The implementation of `SetLimit`:

```go
func (g *Group) SetLimit(n int) {
    if n < 0 {
        g.sem = nil
        return
    }
    if len(g.sem) != 0 {
        panic("errgroup: modify limit while " + ...) // paraphrased
    }
    g.sem = make(chan token, n)
}
```

The "semaphore" is a `chan token` with capacity n. `Go` does:

```go
func (g *Group) Go(f func() error) {
    if g.sem != nil {
        g.sem <- token{} // blocks if full
    }
    g.wg.Add(1)
    go func() {
        defer g.done()
        if err := f(); err != nil {
            g.errOnce.Do(func() { g.err = err; if g.cancel != nil { g.cancel(g.err) } })
        }
    }()
}
```

So `SetLimit(n)` is just a buffered channel of capacity n used as a semaphore. The implementation is intentionally simple. You could have written it yourself.

The takeaway: there is no magic. `SetLimit` is a 2-line addition that turns a structured-concurrency primitive into a bounded one. Knowing this lets you reason about its cost (one channel send per goroutine spawn — negligible) and its behaviour (FIFO when at limit, like every channel).

---

## Appendix C: Patterns Across Other Languages

For perspective, consider how other languages solve the same problem.

### C.1 — Java executor service

`java.util.concurrent.ExecutorService` is the canonical bounded executor:

```java
ExecutorService pool = Executors.newFixedThreadPool(16);
List<Future<Result>> futures = items.stream()
    .map(it -> pool.submit(() -> work(it)))
    .toList();
for (Future<Result> f : futures) {
    use(f.get());
}
pool.shutdown();
```

The Java pattern enforces a bound via the fixed-size executor. The Go equivalent is `errgroup.SetLimit`. Notable differences:

- Java threads are heavy (~1 MB stacks); Go goroutines are light (~2 KB initial stack).
- Java's bound is more important *for memory*; Go's bound is more important *for downstream resources*.
- Java has a `Callable<T>` interface; Go uses closures.

### C.2 — Rust Tokio's `JoinSet`

Tokio (the async runtime for Rust) provides a `JoinSet`:

```rust
let mut set = JoinSet::new();
for item in items {
    set.spawn(work(item));
}
while let Some(res) = set.join_next().await {
    use_result(res);
}
```

`JoinSet` does not bound concurrency by itself. To bound, use a `Semaphore`:

```rust
let sem = Arc::new(Semaphore::new(16));
for item in items {
    let permit = sem.clone().acquire_owned().await.unwrap();
    set.spawn(async move {
        let _permit = permit;
        work(item).await
    });
}
```

The pattern is similar to Go's hand-rolled semaphore approach. Rust requires more boilerplate because of move semantics; Go's GC hides the lifetime management.

### C.3 — Python asyncio's `gather` with `Semaphore`

Python's asyncio:

```python
import asyncio
sem = asyncio.Semaphore(16)
async def bounded(item):
    async with sem:
        return await work(item)
results = await asyncio.gather(*[bounded(it) for it in items])
```

This is *very* close to the Go pattern. Python's GIL means there is no true parallelism for CPU-bound work, but for I/O-bound work the pattern is identical.

### C.4 — Why Go's pattern looks similar across languages

All async/concurrent runtimes converge on the same abstractions: a primitive for "spawn a task" and a primitive for "bound how many spawn at once." The names differ (`go` / `spawn` / `async` / `Executors.newFixedThreadPool`) but the shape is universal: bounded fan-out.

The lesson: bounded fan-out is not a Go-specific best practice; it is a *concurrency* best practice. The patterns you learn in Go translate to every other modern runtime.

---

## Appendix D: Common Misconceptions

### D.1 — "Goroutines are free"

False. The runtime is efficient at managing many goroutines, but each goroutine consumes 2 KB minimum, a `g` struct, scheduler overhead, and GC stack-scan time. At 100 000+, these add up. More importantly, each goroutine often holds an external resource that is far more expensive.

### D.2 — "If I add a bound, throughput will suffer"

Almost always false. A correctly-sized bound *increases* throughput by reducing contention. An incorrectly-sized bound reduces throughput, but the fix is to measure and resize, not to remove the bound.

### D.3 — "I'll add the bound when it's needed"

False. The day you "need" the bound, your system is already on fire. Add the bound before launch; tune it later.

### D.4 — "The Go runtime will protect me"

False. The Go runtime is fast but not bulletproof. It will let you spawn 10 million goroutines if you ask. The protection is your responsibility.

### D.5 — "Adding a bound is hard"

False. `errgroup.SetLimit(N)` is one line. Adding a worker pool is 50 lines. The cost of *not* adding a bound is potentially hours of outage. The cost-benefit is overwhelming.

### D.6 — "My input is always small"

Maybe true today; certainly not true forever. The input grows; the assumption breaks silently. Bound the unknown.

### D.7 — "I'll use a channel; that's a bound"

A `make(chan T, N)` channel is a bound *on the buffer*, not on the consumer count. If you spawn one goroutine per send, the channel does not bound the goroutines. Add an explicit limit.

### D.8 — "errgroup is for errors; I don't need it for limits"

`errgroup.SetLimit` exists. Use it. The two responsibilities (error aggregation and limiting) compose into one primitive.

### D.9 — "Limits are for production; my dev environment is fine"

Your CI is your dev environment for concurrency bugs. A test that loops 100 000 times will OOM your laptop just as it would OOM a production pod. Test with bounds.

### D.10 — "I have a circuit breaker, so I don't need a semaphore"

Circuit breakers and semaphores solve different problems. A circuit breaker stops calls when downstream is *failing*. A semaphore stops calls when downstream is *saturated* (but not yet failing). You need both.

---

## Appendix E: Operational Patterns

### E.1 — The Concurrency Dashboard

A senior engineer running a service in production should have a dashboard showing, at minimum:

- `process_goroutines` — `runtime.NumGoroutine()`. Should be flat or slowly varying.
- `pool_<name>_inflight` — current size of each pool.
- `pool_<name>_queue_depth` — current queue size of each pool.
- `pool_<name>_submitted_total` — counter.
- `pool_<name>_completed_total` — counter.
- `pool_<name>_failed_total` — counter.
- `semaphore_<name>_waiters` — gauge of how many goroutines are blocked waiting.

The dashboard should *answer at a glance*: "is anything backed up?" If `inflight == capacity` for any pool over a sustained period, the pool is saturated.

### E.2 — Alerting rules

- Alert: `process_goroutines > 50000` for 5m → "goroutine count high, investigate."
- Alert: `derivative(process_goroutines) > 100/s` for 1m → "goroutine count growing, likely leak."
- Alert: `pool_x_queue_depth == pool_x_queue_max` for 1m → "pool x saturated, downstream slow."
- Alert: `semaphore_y_waiters > 100` for 1m → "concurrency budget exhausted."

Tune thresholds to your baseline. The pattern is: alert on shape (saturation, growth) not on absolute count.

### E.3 — Incident playbook

When an alert fires:

1. Capture `/debug/pprof/goroutine?debug=1` to a file. This is your stack trace inventory.
2. Capture `/debug/pprof/heap?seconds=30` for memory.
3. Capture `/debug/pprof/profile?seconds=30` for CPU.
4. Run `go tool pprof -top -cum <file>` for the top consumers.
5. Identify which call site is producing the most goroutines.
6. Cross-reference against a known-good baseline.

The pprof outputs should be stored as artifacts. After the incident, you have evidence for the postmortem and a reproducer.

### E.4 — Capacity planning loop

Quarterly:

1. Measure peak load over the past quarter.
2. Plot it against pod count and pool sizes.
3. Project the next quarter's load (typically 2x for a growing product).
4. Decide whether to add pods, increase pool sizes, or add isolation.
5. Re-run load tests with the new configuration.
6. Update the bound-stack documentation.

The output: a one-page summary that any on-call engineer can read to understand the current capacity. The summary belongs in source-controlled documentation, not a Confluence page that drifts.

---

## Appendix F: Anti-Pattern Variants

The unlimited-goroutines anti-pattern has several variants. Each appears in real code; each requires the same fix (a bound) but with a different mechanic.

### F.1 — The recursive spawn

```go
func walk(dir string) {
    entries, _ := os.ReadDir(dir)
    for _, e := range entries {
        if e.IsDir() {
            go walk(filepath.Join(dir, e.Name())) // exponential fan-out
        }
    }
}
```

Each directory spawns a goroutine per subdirectory. In a deep tree, you fan out exponentially. Fix: a shared semaphore plus a wait group:

```go
type Walker struct {
    sem *semaphore.Weighted
    wg  sync.WaitGroup
}

func (w *Walker) Walk(ctx context.Context, dir string) {
    w.wg.Add(1)
    go func() {
        defer w.wg.Done()
        if err := w.sem.Acquire(ctx, 1); err != nil { return }
        defer w.sem.Release(1)
        entries, _ := os.ReadDir(dir)
        for _, e := range entries {
            if e.IsDir() {
                w.Walk(ctx, filepath.Join(dir, e.Name()))
            }
        }
    }()
}
```

### F.2 — The fan-out within a fan-out

```go
for _, batch := range batches {
    go func(b Batch) {
        for _, item := range b.Items {
            go process(item) // nested fan-out
        }
    }(batch)
}
```

If batches = 100 and items per batch = 1000, you fan out 100 000 goroutines. Fix: one bound around the nested structure, sized to the *product*:

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(64)
for _, batch := range batches {
    for _, item := range batch.Items {
        item := item
        g.Go(func() error { return process(gctx, item) })
    }
}
return g.Wait()
```

The two-level fan-out becomes one flat bounded fan-out.

### F.3 — The "every message" handler

```go
for msg := range ch {
    go handle(msg)
}
```

Common in Kafka consumers, websocket message routers, NATS subscribers. Fix: a bounded pool driven by the channel.

### F.4 — The timer-driven spawn

```go
ticker := time.NewTicker(time.Second)
for range ticker.C {
    go doScheduledWork() // accumulates if doScheduledWork is slow
}
```

If `doScheduledWork` takes longer than 1 second, goroutines pile up. Fix: a single worker plus a `try`-style submit, dropping ticks if busy.

### F.5 — The library that quietly spawns

Some libraries spawn goroutines internally for callbacks, watchers, or notifications. Without a bound on *callers*, the library's goroutines proliferate. Always check library docs for "does this spawn?" and bound the caller side.

### F.6 — The `defer go`

```go
func handle(req Request) error {
    defer func() { go cleanup(req) }() // fire-and-forget cleanup
    return process(req)
}
```

Every request spawns a cleanup goroutine. Under load, cleanup goroutines pile up. Fix: enqueue cleanup to a pool.

---

## Appendix G: Decision Trees

When you encounter a fan-out situation, walk through:

```
                Need to fan out?
                       |
              +--------+--------+
              |                 |
       Bounded input?     User input?
              |                 |
        No   Yes               Yes
              |                 |
         Inline calls    Need bound (always)
                              |
                +-------------+-------------+
                |             |             |
          One batch?    Long-lived?    Streaming?
                |             |             |
        errgroup.SetLimit  Worker pool   Pipeline
                                              |
                                       Bounded stages
```

```
            Choosing the bound:
                    |
       +------------+------------+
       |                         |
  CPU-bound?              I/O-bound?
       |                         |
  NumCPU()*2          Downstream connection limit
       |                         |
       |                  +------+------+
       |                  |             |
       |             Connection?    Memory?
       |                  |             |
       |             pool size      budget / per-job
       +------------+------------+
       |
  Measure
       |
  Iterate
```

A senior engineer internalises these trees and applies them in code review.

---

## Appendix H: Glossary (extended)

| Term | Definition |
|------|------------|
| **Acquire** | Request a token from a semaphore; block if none available. |
| **Admission control** | Reject work at the edge when the system is at capacity. |
| **Admission rate** | The rate at which the edge admits work, often token-bucketed. |
| **Backoff** | Delay between retries, typically exponentially increasing. |
| **Backpressure** | A slow consumer's signal that the producer should slow down. |
| **Batch dispatcher** | A goroutine that accumulates items and dispatches them in chunks. |
| **Bound** | An enforced maximum on a resource (goroutines, in-flight, memory). |
| **Bounded fan-out** | A fan-out with a known, enforced upper bound on concurrency. |
| **Budget** | An allocation of a total bound to a logical scope. |
| **Burst** | A short-lived spike in load above the steady-state rate. |
| **Circuit breaker** | A switch that disables calls to a known-failing downstream. |
| **CoDel** | A queue-management algorithm that drops when delay exceeds a threshold. |
| **Concurrency limit** | The maximum simultaneous in-flight operations. |
| **Concurrency primitive** | A building block (mutex, semaphore, channel) for coordination. |
| **Context cancellation** | The mechanism by which a deadline or signal propagates through call chains. |
| **Drain** | The process of finishing in-flight work before stopping. |
| **errgroup** | `golang.org/x/sync/errgroup`, the bounded-fan-out primitive. |
| **Fan-in** | N goroutines feed results to a single collector. |
| **Fan-out** | One goroutine spawns N parallel sub-tasks. |
| **FD** | File descriptor; the kernel's handle for an open file/socket. |
| **GMP** | Go's scheduler model: Goroutines × Machine threads × Processors. |
| **Goleak** | `go.uber.org/goleak`, a goroutine-leak detector for tests. |
| **Goroutine** | A lightweight unit of execution managed by the Go runtime. |
| **Graceful degradation** | Returning a partial response rather than failing entirely. |
| **Head-of-line blocking** | A slow item delays all subsequent items in a queue. |
| **Inflight** | Currently being processed; in-flight count = current concurrency. |
| **Job** | A unit of work submitted to a pool. |
| **Latency** | Time between request start and response. |
| **Leak** | A goroutine that never terminates and accumulates over time. |
| **Limiter** | A primitive that bounds rate or concurrency. |
| **Little's Law** | L = λW; in-flight = arrival rate × mean response time. |
| **OOM** | Out-of-memory; the kernel kills the process. |
| **Pool** | A fixed set of worker goroutines plus a job queue. |
| **PProf** | Go's profiling tool; produces CPU, heap, and goroutine profiles. |
| **Quota** | A rate or volume limit over a time window. |
| **Race** | A concurrent unsynchronised access to shared memory. |
| **Rate limiter** | A primitive that bounds operations per unit time. |
| **Retry storm** | Cascading retries amplifying a downstream failure. |
| **Semaphore** | A counter that supports `Acquire(n)` and `Release(n)`. |
| **Shed load** | Reject excess work explicitly. |
| **Submit** | Enqueue a job into a pool. |
| **Throughput** | Operations completed per unit time. |
| **Token bucket** | A rate-limit algorithm where tokens accrue at a fixed rate. |
| **Worker pool** | See **Pool**. |

---

## Appendix I: References and Further Reading

- "Concurrency in Go" by Katherine Cox-Buday — Chapter 4 on patterns.
- The Go blog: "Go Concurrency Patterns" by Rob Pike (2012).
- The Go blog: "Pipelines and cancellation" (2014).
- `golang.org/x/sync` README — overview of semaphore, errgroup, singleflight.
- `go.uber.org/goleak` README — usage and configuration.
- "Designing Data-Intensive Applications" by Martin Kleppmann — Chapter 11 on stream processing has parallel themes.
- Brendan Gregg's "Systems Performance" — the cost-model framing for resources beyond memory.
- The Go runtime source: `src/runtime/proc.go`, `src/runtime/chan.go`. Approachable, well-commented.

---

## Appendix J: Deep Dive into errgroup Source

It is worth walking through the actual `errgroup` implementation once. The package is small enough (about 130 lines across two files) to read in one sitting.

### J.1 — The `Group` struct

```go
type Group struct {
    cancel func(error)
    wg     sync.WaitGroup
    sem    chan token
    errOnce sync.Once
    err    error
}

type token struct{}
```

Note:

- `sem chan token` is a buffered channel of empty structs. Its capacity is the limit (from `SetLimit`). A `nil` channel means no limit (operations on `nil` channels block forever, but `SetLimit(-1)` clears the channel, and the code checks for nil before operating on it).
- `errOnce` ensures only the *first* error is reported via `Wait`. This is intentional: with many goroutines failing on the same root cause, you usually want one signal, not N.
- `cancel` is the cancellation function from `WithContext`. When `cancel` is called with the error, every goroutine using the derived context observes cancellation.

### J.2 — `Go` and the limit interaction

```go
func (g *Group) Go(f func() error) {
    if g.sem != nil {
        g.sem <- token{}
    }
    g.wg.Add(1)
    go func() {
        defer g.done()
        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil {
                    g.cancel(g.err)
                }
            })
        }
    }()
}

func (g *Group) done() {
    if g.sem != nil {
        <-g.sem
    }
    g.wg.Done()
}
```

The crucial line is `g.sem <- token{}`. This is what makes `Go` block when at limit. The send blocks because the channel buffer is full; only when another goroutine calls `done()` (which receives from `g.sem`) does a slot open.

Consequences:

1. The limit applies to *running* goroutines, not *queued* ones. There is no queue.
2. The caller of `Go` is the one that blocks. This makes the caller's loop produce backpressure naturally.
3. `Go` does not return an error or a "couldn't start" signal. Either it starts the goroutine or it blocks.

### J.3 — `TryGo`

```go
func (g *Group) TryGo(f func() error) bool {
    if g.sem != nil {
        select {
        case g.sem <- token{}:
            // proceed
        default:
            return false
        }
    }
    g.wg.Add(1)
    go func() {
        defer g.done()
        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil {
                    g.cancel(g.err)
                }
            })
        }
    }()
    return true
}
```

`TryGo` is `Go` with a non-blocking send. The `default` branch handles the "already at limit" case by returning false.

### J.4 — `Wait`

```go
func (g *Group) Wait() error {
    g.wg.Wait()
    if g.cancel != nil {
        g.cancel(g.err)
    }
}
```

`Wait` is two lines. It waits on the wait group, then cancels the context. The cancellation at the end is important: it ensures `gctx.Done()` is closed when `Wait` returns, so any caller using `gctx` for further work sees cancellation.

### J.5 — Reading takeaways

After reading the source, you should be comfortable with:

- The semaphore is just a `chan token`. You could write this yourself in 5 lines.
- `Go` blocks the caller, never queues.
- `TryGo` is the same with a non-blocking send.
- `Wait` joins and cancels.

This is one of the cleanest concurrency primitives in any standard library. The simplicity is the point: the abstraction is exactly the right thickness.

---

## Appendix K: Profiling Bounded Fan-Out

Once you have bounded fan-out in place, you need to *verify* it works as intended in production. Profiling is the tool.

### K.1 — The goroutine profile

The most useful profile for this anti-pattern. Trigger:

```
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

Or save to a file:

```
curl -s http://localhost:6060/debug/pprof/goroutine?debug=1 > goroutines.txt
```

The `debug=1` text format is human-readable. It groups goroutines by stack. Example output:

```
goroutine profile: total 1245
512 @ 0x40123a 0x402345 0x402567 ...
#       0x40123a        github.com/foo/bar.worker+0x4a
#       0x402345        runtime.goroutineRun+0x12
...
```

`512` means 512 goroutines share this stack. They are all parked at `worker`. The next line down lists where `worker` is. You can identify pools by their stack signatures.

### K.2 — The execution trace

```
go tool trace
```

With a saved trace:

```go
import "runtime/trace"

func init() {
    f, _ := os.Create("trace.out")
    trace.Start(f)
    // ... run app ...
    // trace.Stop()
}
```

The trace shows per-P timelines. Look for:

- Long gaps where no goroutine runs (scheduler starvation, GC pauses).
- Periods of high goroutine creation (a fan-out site).
- The exact moments goroutines move between Ps (work-stealing).

For bounded fan-out verification: the goroutine count visible in the trace should plateau at your limit; periods where it spikes above indicate a bug.

### K.3 — The block profile

```
import "runtime"
runtime.SetBlockProfileRate(1) // every blocking event
```

Then `pprof http://localhost:6060/debug/pprof/block` shows which goroutines blocked, for how long, and on what. A bounded fan-out with `SetLimit(N)` will show blocking on the channel send in `errgroup.Go`. This is *expected* — the block is the backpressure mechanism. A surprise blocking pattern indicates a design flaw.

### K.4 — The mutex profile

```
runtime.SetMutexProfileFraction(1)
```

`pprof http://localhost:6060/debug/pprof/mutex` shows mutex contention. With bounded fan-out, contention should be low. If you see high contention on a shared map, replace with `sync.Map` or a sharded structure.

### K.5 — Memory profile

`pprof http://localhost:6060/debug/pprof/heap` shows what is allocated. Run with `--alloc_objects` for allocation counts, `--inuse_space` for live allocations.

For bounded fan-out verification: peak heap should be proportional to the bound. Spikes correlate to fan-out events. If heap grows unboundedly, you have a leak somewhere (often a goroutine holding a buffer past its useful life).

### K.6 — Continuous profiling

In production, run a continuous profiler (Pyroscope, Datadog Profiler, Polar Signals). It samples profiles every few seconds and stores them, so you can:

- Diff profiles before and after a deploy.
- Identify the regression point of a memory leak.
- Compare goroutine count at peak vs trough.

Continuous profiling makes the unbounded-goroutines anti-pattern *visible*: you see the goroutine count rise over hours, and you have the stacks to identify the culprit.

---

## Appendix L: Anti-Pattern Catalogue Recap

To consolidate, here are the anti-patterns this document addresses, each with a one-line cure:

| Anti-pattern | Cure |
|--------------|------|
| `for _, x := range input { go work(x) }` | `g.SetLimit(N)` |
| `go cleanup()` after every request | Bounded background pool |
| `for msg := range ch { go handle(msg) }` | Bounded consumer pool |
| Recursive `go walk(child)` | Shared semaphore + WaitGroup |
| Retry loops with naked `go` | Bounded retry executor |
| Ticker spawning goroutines | Single worker + `try`-style submit |
| Fan-out within fan-out | Flatten to single bounded loop |
| Library spawning callbacks | Bound the caller side |
| Defer-go for cleanup | Enqueue to drain pool |
| Pagination boundary | Bound *across* pages |

If you see any of these in code review, the cure is one of the listed primitives. The phrase to use: "this is unbounded fan-out; add a `SetLimit` derived from [downstream resource]."

---

## Appendix M: Reading Existing Bounds

When you encounter an existing bounded fan-out, ask:

1. **Where is the bound declared?** Should be one place, named, commented.
2. **What is its value?** A number is fine; a configured value is better.
3. **What's the justification?** A comment, a runbook entry, or a load test result.
4. **What's the unit?** "32" — 32 what? Goroutines? Memory bytes? Connections?
5. **What enforces it?** A semaphore, a channel buffer, an errgroup limit, an HTTP server's `MaxRequestsInFlight`.
6. **What's the policy at the bound?** Block, drop, error, degrade.
7. **What metric tells me it's at the bound?** `pool_x_inflight == pool_x_capacity`, `sem_y_waiters > 0`.

If any of these are unanswerable from the codebase, the bound is *unowned*. An unowned bound will be removed by a future engineer who doesn't understand it. Make the bound visible, justified, monitored.

---

## Appendix N: When NOT to Bound

A small but important set of cases where bounding is wrong:

1. **You are writing a runtime or scheduler.** The bound on goroutines is what *you* are providing. Adding a meta-bound makes you a queue, not a runtime.
2. **The "fan-out" is over a fixed small set.** If you fan out to 8 backends and 8 is hard-coded, the bound is the static iteration. Adding a `SetLimit(8)` is redundant and signals to readers "there could be more."
3. **You are explicitly modeling unbounded sources.** A websocket server accepting connections is structurally one goroutine per connection. The bound is on *accepts*, not on the loop. Documenting this is fine.
4. **You are prototyping.** In a throwaway script, a bound is overengineering. Be honest that you are prototyping.

In every other case, bound.

---

## Appendix O: Test Patterns

A few test patterns specific to bounded fan-out.

### O.1 — Fake slow worker

```go
func slowFn(d time.Duration) func(context.Context) error {
    return func(ctx context.Context) error {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(d):
            return nil
        }
    }
}
```

Use to simulate downstream that takes a known time. Pair with `time.Now()` measurements to verify throughput.

### O.2 — Counting inflight peak

```go
var (
    inflight atomic.Int64
    peak     atomic.Int64
)

func instrumented(fn func(context.Context) error) func(context.Context) error {
    return func(ctx context.Context) error {
        cur := inflight.Add(1)
        for {
            p := peak.Load()
            if cur <= p { break }
            if peak.CompareAndSwap(p, cur) { break }
        }
        defer inflight.Add(-1)
        return fn(ctx)
    }
}
```

After the test, `peak.Load()` is the maximum concurrency observed. Assert it equals the bound.

### O.3 — Timing assertion

```go
func TestBound_ThroughputMatchesBound(t *testing.T) {
    const (
        items = 100
        bound = 10
        jobDur = 100 * time.Millisecond
    )
    start := time.Now()
    g, gctx := errgroup.WithContext(context.Background())
    g.SetLimit(bound)
    for i := 0; i < items; i++ {
        g.Go(func() error { time.Sleep(jobDur); _ = gctx; return nil })
    }
    _ = g.Wait()
    elapsed := time.Since(start)
    expected := time.Duration(items/bound) * jobDur
    if elapsed < expected || elapsed > expected*2 {
        t.Errorf("elapsed %v not near expected %v", elapsed, expected)
    }
}
```

The test asserts that with 100 items, bound 10, and 100ms per item, the total time is about 10 × 100ms = 1s. A bound of N means N items run in parallel, so total time = items/N × duration.

### O.4 — Leak detection in subtests

```go
func TestEverything(t *testing.T) {
    defer goleak.VerifyNone(t)
    t.Run("case1", func(t *testing.T) {
        // ...
    })
    t.Run("case2", func(t *testing.T) {
        // ...
    })
}
```

The deferred `VerifyNone` runs after all subtests, catching leaks from any of them.

### O.5 — Stress test

```go
func TestUnderStress(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping stress test in short mode")
    }
    for i := 0; i < 10000; i++ {
        runOnce(t)
        if i%1000 == 0 {
            t.Logf("iteration %d, goroutines: %d", i, runtime.NumGoroutine())
        }
    }
}
```

Run with `go test -run TestUnderStress -timeout 30m`. Watch the goroutine count: if it grows monotonically, there is a leak.

---

## Appendix P: A Summary Mental Model

Reduce the senior-level material to one mental model:

> *Every goroutine is a draw against a finite budget. The budget is set by the smallest downstream resource. The bound is enforced by a primitive (semaphore, channel buffer, errgroup limit). At the bound, work either blocks, drops, errors, or degrades. The policy is chosen per-tier. Monitoring confirms reality matches design. Tests prevent regression.*

If you can recite this from memory, and can identify each clause in a code change, you are ready.

The senior level of "unlimited goroutines" is not about avoiding `for ... go`. It is about *owning the bound stack* of a production system, top to bottom, and being the engineer the team turns to when "why did pod-3 OOM" comes up.

---

## Appendix Q: Worked Refactor Example — From Unbounded to Bounded

Here is a complete worked example: a small service that started unbounded, was refactored over three iterations to bounded, observable, and tenant-isolated.

### Q.1 — Iteration 0: The naive implementation

```go
package report

import (
    "context"
    "encoding/json"
    "io"
    "net/http"
)

type Service struct {
    storage Storage
}

type Storage interface {
    GetReport(ctx context.Context, id string) (*Report, error)
    PutEnriched(ctx context.Context, r *Report) error
}

type Report struct {
    ID    string `json:"id"`
    Body  []byte `json:"body"`
}

func (s *Service) BatchEnrich(w http.ResponseWriter, r *http.Request) {
    var ids []string
    if err := json.NewDecoder(r.Body).Decode(&ids); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    for _, id := range ids {
        go func(id string) {
            rep, err := s.storage.GetReport(context.Background(), id)
            if err != nil { return }
            enriched := enrich(rep)
            _ = s.storage.PutEnriched(context.Background(), enriched)
        }(id)
    }
    w.WriteHeader(http.StatusAccepted)
}

func enrich(r *Report) *Report { return r }
func main() { _ = io.EOF }
```

Problems:

1. Unbounded fan-out: one goroutine per ID.
2. Uses `context.Background()`, so client disconnect doesn't cancel.
3. Errors are silently dropped.
4. Returns 202 before any work is done; client has no way to know if it succeeded.
5. No bounds, no observability, no metrics.

### Q.2 — Iteration 1: Add a bound

```go
package report

import (
    "context"
    "encoding/json"
    "net/http"

    "golang.org/x/sync/errgroup"
)

type Service struct {
    storage Storage
    EnrichConcurrency int
}

func (s *Service) BatchEnrich(w http.ResponseWriter, r *http.Request) {
    var ids []string
    if err := json.NewDecoder(r.Body).Decode(&ids); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    g, gctx := errgroup.WithContext(r.Context())
    g.SetLimit(s.EnrichConcurrency)
    for _, id := range ids {
        id := id
        g.Go(func() error {
            rep, err := s.storage.GetReport(gctx, id)
            if err != nil { return err }
            enriched := enrich(rep)
            return s.storage.PutEnriched(gctx, enriched)
        })
    }
    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    w.WriteHeader(http.StatusOK)
}
```

Improvements:

- Bounded fan-out via `errgroup.SetLimit`.
- Uses `r.Context()`, so client disconnect cancels.
- Errors aggregated; first error returned.
- Returns 200 only when all work succeeds.

Remaining issues:

- No metrics.
- No tenant isolation.
- `EnrichConcurrency` is unconfigured.

### Q.3 — Iteration 2: Add metrics and tenant isolation

```go
package report

import (
    "context"
    "encoding/json"
    "net/http"
    "sync"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
    "golang.org/x/sync/errgroup"
    "golang.org/x/sync/semaphore"
)

var (
    enrichInflight = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "enrich_inflight",
    }, []string{"tenant"})
    enrichDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name: "enrich_duration_seconds",
    }, []string{"tenant", "status"})
)

type Service struct {
    storage Storage
    EnrichConcurrency int
    PerTenantLimit int64

    tenantsMu sync.Mutex
    tenants   map[string]*semaphore.Weighted
}

func (s *Service) tenantSem(tenant string) *semaphore.Weighted {
    s.tenantsMu.Lock()
    defer s.tenantsMu.Unlock()
    if s.tenants == nil {
        s.tenants = make(map[string]*semaphore.Weighted)
    }
    sem, ok := s.tenants[tenant]
    if !ok {
        sem = semaphore.NewWeighted(s.PerTenantLimit)
        s.tenants[tenant] = sem
    }
    return sem
}

func (s *Service) BatchEnrich(w http.ResponseWriter, r *http.Request) {
    tenant := r.Header.Get("X-Tenant-ID")
    if tenant == "" {
        http.Error(w, "missing tenant", http.StatusBadRequest)
        return
    }
    var ids []string
    if err := json.NewDecoder(r.Body).Decode(&ids); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    sem := s.tenantSem(tenant)
    g, gctx := errgroup.WithContext(r.Context())
    g.SetLimit(s.EnrichConcurrency)
    for _, id := range ids {
        id := id
        g.Go(func() error {
            if err := sem.Acquire(gctx, 1); err != nil { return err }
            defer sem.Release(1)
            timer := prometheus.NewTimer(enrichDuration.WithLabelValues(tenant, "ok"))
            enrichInflight.WithLabelValues(tenant).Inc()
            defer enrichInflight.WithLabelValues(tenant).Dec()
            rep, err := s.storage.GetReport(gctx, id)
            if err != nil {
                timer.ObserveDuration()
                enrichDuration.WithLabelValues(tenant, "error").Observe(0)
                return err
            }
            enriched := enrich(rep)
            if err := s.storage.PutEnriched(gctx, enriched); err != nil {
                return err
            }
            timer.ObserveDuration()
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    w.WriteHeader(http.StatusOK)
}
```

Improvements:

- Per-tenant semaphore prevents one tenant from starving others.
- Prometheus metrics for in-flight count and duration.
- Status label (ok / error) for sliced histograms.

Remaining issues:

- Per-tenant map grows monotonically. Acceptable if tenant count is bounded; problematic for high-cardinality services.
- No admission control: a tenant blasting in 1M IDs in one request still blocks for a long time. Mitigation: a max-batch-size limit at parse time.

### Q.4 — Iteration 3: Admission control and max batch

```go
package report

import (
    "context"
    "encoding/json"
    "errors"
    "net/http"
    "sync"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
    "golang.org/x/sync/errgroup"
    "golang.org/x/sync/semaphore"
)

const MaxBatchSize = 1000

var ErrBatchTooLarge = errors.New("batch too large")

var (
    enrichRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "enrich_requests_total",
    }, []string{"tenant", "outcome"})
)

type Service struct {
    storage Storage
    EnrichConcurrency int
    PerTenantLimit int64
    GlobalLimit int64

    global    *semaphore.Weighted
    tenantsMu sync.RWMutex
    tenants   map[string]*semaphore.Weighted
}

func New(storage Storage, enrichConc int, perTenant, global int64) *Service {
    return &Service{
        storage: storage,
        EnrichConcurrency: enrichConc,
        PerTenantLimit: perTenant,
        GlobalLimit: global,
        global: semaphore.NewWeighted(global),
        tenants: make(map[string]*semaphore.Weighted),
    }
}

func (s *Service) tenantSem(tenant string) *semaphore.Weighted {
    s.tenantsMu.RLock()
    sem, ok := s.tenants[tenant]
    s.tenantsMu.RUnlock()
    if ok { return sem }
    s.tenantsMu.Lock()
    defer s.tenantsMu.Unlock()
    if sem, ok = s.tenants[tenant]; ok { return sem }
    sem = semaphore.NewWeighted(s.PerTenantLimit)
    s.tenants[tenant] = sem
    return sem
}

func (s *Service) BatchEnrich(w http.ResponseWriter, r *http.Request) {
    tenant := r.Header.Get("X-Tenant-ID")
    if tenant == "" {
        http.Error(w, "missing tenant", http.StatusBadRequest)
        return
    }
    var ids []string
    if err := json.NewDecoder(r.Body).Decode(&ids); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        enrichRequestsTotal.WithLabelValues(tenant, "bad_request").Inc()
        return
    }
    if len(ids) > MaxBatchSize {
        http.Error(w, "batch too large", http.StatusRequestEntityTooLarge)
        enrichRequestsTotal.WithLabelValues(tenant, "too_large").Inc()
        return
    }
    if !s.global.TryAcquire(1) {
        w.Header().Set("Retry-After", "1")
        http.Error(w, "overloaded", http.StatusServiceUnavailable)
        enrichRequestsTotal.WithLabelValues(tenant, "rejected").Inc()
        return
    }
    defer s.global.Release(1)

    sem := s.tenantSem(tenant)
    g, gctx := errgroup.WithContext(r.Context())
    g.SetLimit(s.EnrichConcurrency)
    for _, id := range ids {
        id := id
        g.Go(func() error {
            if err := sem.Acquire(gctx, 1); err != nil { return err }
            defer sem.Release(1)
            rep, err := s.storage.GetReport(gctx, id)
            if err != nil { return err }
            return s.storage.PutEnriched(gctx, enrich(rep))
        })
    }
    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        enrichRequestsTotal.WithLabelValues(tenant, "error").Inc()
        return
    }
    w.WriteHeader(http.StatusOK)
    enrichRequestsTotal.WithLabelValues(tenant, "ok").Inc()
}
```

Final form:

- Bounded fan-out per request (`SetLimit`).
- Per-tenant concurrency limit.
- Global admission control (`TryAcquire`).
- Max batch size (request validation).
- Metrics for every outcome.

### Q.5 — The diff that matters

The unbounded-to-bounded diff is essentially:

```diff
- go func(id string) { ... }(id)
+ g, gctx := errgroup.WithContext(r.Context())
+ g.SetLimit(s.EnrichConcurrency)
+ for _, id := range ids {
+   id := id
+   g.Go(func() error { ... })
+ }
+ if err := g.Wait(); err != nil { ... }
```

Five lines added, one removed. The change is small. The impact — going from "OOMs at 10 000 IDs" to "handles arbitrary input safely" — is massive.

### Q.6 — Lessons from this refactor

1. The bound itself is one line. The infrastructure around it (metrics, admission, tenant isolation) is the bulk.
2. Each iteration introduces one new property. Don't try to write iteration 3 first; you will get the API wrong.
3. Metrics from the start. The metric labels survive across iterations.
4. Configuration values (`EnrichConcurrency`, `PerTenantLimit`, `GlobalLimit`) are deliberate. Make them visible in your service config, not hard-coded.

---

## Appendix R: Quiz Answers (Self-Assessment)

For the self-assessment questions earlier in this document, brief answers:

1. **errgroup.SetLimit vs semaphore.Weighted vs chan struct{}.** SetLimit is counting only, includes error aggregation. Weighted supports weighted tokens, FIFO fairness, and explicit Acquire/Release. chan struct{} is the simplest counting case, no library dependency.

2. **8 backends × 200 requests = 1600 simultaneous; with a connection pool of 50, oversubscribed 32x.** Add a shared semaphore of 50 across all requests, or admission-control at 6 concurrent requests (6 × 8 = 48 < 50).

3. **End-to-end backpressure in a 3-stage pipeline:** each stage has a bounded input channel; when the downstream stage is slow, its input fills, blocking the upstream's send; this propagates back to the source.

4. **Failure modes beyond OOM:** scheduler thrash (visible via `go tool trace`); FD exhaustion (visible via `lsof` or process FD count metric); GC pause amplification (visible via `GODEBUG=gctrace=1`).

5. **goleak.VerifyTestMain** runs after the test suite, calls `pprof.Lookup("goroutine")`, filters out known-benign stacks, fails if any remain. `IgnoreCurrent` snapshots existing goroutines; `IgnoreTopFunction` filters by stack-top function name.

6. **Kafka consumer with one goroutine per message:** use a bounded worker pool with the consumer feeding `Submit`; `Submit` blocks when full; Kafka offset commit lags, signalling backpressure.

7. **Little's Law:** L = λW. If target throughput λ = 100/s and observed latency W = 0.5s, in-flight L = 50. Set the concurrency bound to 50.

8. **50-line bounds test:** spawn at saturating load, sample `runtime.NumGoroutine()` periodically, assert maximum is ≤ bound + small constant. See Appendix Q.

9. **Real incident:** see Case Study 1 (webhook fanout). Missing bound: per-customer fan-out cap. Fix location: at the `go dispatch` call site.

10. **Per-tenant map leak prevention:** periodic sweep that removes entries where the semaphore's current count is zero. Trade-off: a brief window where a re-arriving tenant gets a fresh semaphore.

---

## Appendix S: Final Notes for the Senior Engineer

The point of this document is not to scare you away from `go func()`. Goroutines are an enabling technology; Go would not exist without them. The point is to teach you to *spend* them wisely.

A senior engineer's relationship with the `go` keyword is the same as a senior engineer's relationship with `malloc` in C: respectful, deliberate, instrumented, and always answering the question "how many of these am I allocating, and what is the upper bound?"

When you can answer that question for every `go` in your codebase, when you have metrics that confirm the answer in production, and when you have tests that fail if the answer becomes "unknown" — then you have mastered the unlimited-goroutines anti-pattern. Not because you avoid `go`, but because you have made it accountable.

End of Senior file.



