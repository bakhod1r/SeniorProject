---
layout: default
title: Partial Cancellation — Middle
parent: Partial Cancellation
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/02-partial-cancellation/middle/
---

# Partial Cancellation — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Scoped Contexts](#scoped-contexts)
5. [Fan-Out with Per-Branch Cancellation](#fan-out-with-per-branch-cancellation)
6. [Choosing Between `WithoutCancel`, `WithTimeout`, and `WithDeadline`](#choosing-between-withoutcancel-withtimeout-and-withdeadline)
7. [Detached Subtasks in Larger Orchestrations](#detached-subtasks-in-larger-orchestrations)
8. [Cancelling One errgroup Branch Without Cancelling Others](#cancelling-one-errgroup-branch-without-cancelling-others)
9. [Interaction with `singleflight`, `sync.Once`, and Caches](#interaction-with-singleflight-synconce-and-caches)
10. [Pipelines and Partial Cancellation](#pipelines-and-partial-cancellation)
11. [Error Handling in Detached Branches](#error-handling-in-detached-branches)
12. [Real-World Architectures](#real-world-architectures)
13. [Tests for Partial-Cancellation Behaviour](#tests-for-partial-cancellation-behaviour)
14. [Edge Cases at Middle Level](#edge-cases-at-middle-level)
15. [Common Anti-Patterns at Middle Level](#common-anti-patterns-at-middle-level)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

The junior file taught you the single most common use of `context.WithoutCancel`: detached cleanup at the end of a request. That is one shape of partial cancellation. At middle level, you start to see the *general* problem: many real workflows are *trees* of subtasks, and you often want to cancel one subtree without affecting the others.

Examples that motivate this level:

- A request fans out to three downstream services. One is slow. You want to abandon it but keep the other two.
- A pipeline has stages A → B → C. Stage B failed for one item. You want to drop that item but keep the pipeline running.
- An errgroup is running five tasks. One is best-effort and failing — you do not want its failure to cancel the four others.
- A detached audit goroutine itself spawns sub-operations. Some of those should respect the audit's deadline; some should not.

These shapes do not have a single API call that solves them. They are composed of three building blocks:

- `context.WithCancel`, `context.WithTimeout`, `context.WithDeadline` — to give a subtask its own bounded lifetime.
- `context.WithoutCancel` — to break the chain so an inner subtask is not cancelled by an outer one.
- Manual goroutines that watch multiple cancellation signals at once.

At middle level, you learn to compose these three building blocks into the shapes your application needs. The standard library does not give you "cancel only branch B" out of the box; you build it from primitives.

This file teaches you:

- Scoped contexts: per-subtask cancellation that does not reach back up.
- Fan-out where each branch is independently cancellable.
- The decision matrix for choosing between detach, timeout, deadline, and cancel.
- Cancelling one branch of an errgroup without aborting others.
- Partial cancellation in pipelines.
- The interaction with single-flight, `sync.Once`, and caches.
- A small but realistic detached-supervisor design.

By the end, you should be able to design a 100-goroutine workflow where you can name, for each goroutine, which lifetime owns it.

---

## Prerequisites

- The junior file — you must know `context.WithoutCancel` cold.
- Comfortable with `errgroup.WithContext`.
- Familiar with `select` statements with multiple cases.
- Have written at least one fan-out/fan-in workflow.
- Know what `singleflight.Group` does, even if you have not used it.
- Comfortable with `sync.WaitGroup`, `sync.Once`, `sync.Mutex`.

If you have ever debugged a "but the other goroutines kept running" surprise, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Scoped context** | A child context whose lifetime is bounded to one subtask, independent of siblings. |
| **Fan-out** | Spawning N sibling goroutines from one parent. |
| **Fan-in** | Collecting results from N sibling goroutines into one consumer. |
| **errgroup** | `golang.org/x/sync/errgroup`. A coordinated group of goroutines with shared cancellation on first error. |
| **Branch cancellation** | Cancelling one subtask without affecting siblings or parent. |
| **Detached subtree** | A subtree whose root is created with `WithoutCancel`, so its lifetime is independent of its lexical parent. |
| **Single-flight** | `golang.org/x/sync/singleflight`. Deduplicates concurrent requests for the same key. |
| **Pipeline** | A chain of stages connected by channels, each stage typically a goroutine. |
| **Backpressure** | Signal from a slow consumer to upstream producers to slow down. |
| **Cleanup-on-cancel** | Code that runs when a context is cancelled. Typically registered via `defer` or `AfterFunc`. |
| **Deadline propagation** | Inheriting a deadline from a parent context. `WithoutCancel` discards this. |
| **Cause propagation** | Inheriting a cancellation cause via `context.Cause`. `WithoutCancel` discards this. |
| **Supervisor** | A goroutine that owns a set of worker goroutines and orchestrates their lifecycle. |
| **Bulkhead** | An isolation boundary that prevents a failure in one subsystem from affecting others. |

---

## Scoped Contexts

A *scoped* context is a context that lives only for the duration of one subtask. It is created with `WithCancel`, `WithTimeout`, or `WithDeadline`, and its cancellation does not reach back up to the parent.

### The basic pattern

```go
func fetchA(parent context.Context) (Result, error) {
    ctx, cancel := context.WithTimeout(parent, 2*time.Second)
    defer cancel()
    return callServiceA(ctx)
}
```

The cancellation of `ctx` (whether by `cancel()`, timeout, or parent cancellation) only affects `fetchA`. The parent is unaffected by the `cancel()` call.

This is *scope* — each function has its own cancellation scope, and the cancellation only flows downward.

### When scoped contexts collide with partial cancellation

The conventional scoped pattern is fine until you want a *sibling* of `fetchA` to keep running even if `fetchA`'s parent is cancelled. That is when `WithoutCancel` enters.

```go
func handler(parent context.Context) {
    res, _ := fetchA(parent) // scoped to handler; respects parent
    _ = res

    // Side-effect that must outlive handler:
    detached := context.WithoutCancel(parent)
    go writeAudit(detached, res)
}
```

The first call uses the parent's cancellation; the second does not. Each line is a scope decision.

### Scope at every level of the tree

A real handler may have many scope decisions:

```go
func handler(parent context.Context) {
    // Scope 1: the whole handler. Inherits parent.
    ctx := parent

    // Scope 2: a quick lookup with its own timeout.
    lookupCtx, lookupCancel := context.WithTimeout(ctx, 500*time.Millisecond)
    user, err := lookupUser(lookupCtx, userID)
    lookupCancel()
    if err != nil {
        return
    }

    // Scope 3: the main work, inheriting parent's cancellation.
    res, err := mainWork(ctx, user)
    if err != nil {
        return
    }

    // Scope 4: detached cleanup with its own bounded lifetime.
    detached := context.WithoutCancel(ctx)
    auditCtx, auditCancel := context.WithTimeout(detached, 5*time.Second)
    go func() {
        defer auditCancel()
        writeAudit(auditCtx, res)
    }()
}
```

Four distinct scopes:

- Scope 1 inherits the parent's cancellation directly.
- Scope 2 has a tighter timeout but still inherits parent cancellation.
- Scope 3 inherits the parent's cancellation directly.
- Scope 4 is detached from the parent and has its own timeout.

Naming each scope explicitly in your mental model is the difference between writing correct partial-cancellation code and writing code that "mostly works."

---

## Fan-Out with Per-Branch Cancellation

A common middle-level shape: one parent goroutine spawns N sibling subtasks. You want to cancel one of them — perhaps because its result is no longer needed — without affecting the others.

### Naive approach: one cancel per branch

```go
func fanOut(parent context.Context, items []Item) {
    var wg sync.WaitGroup
    cancels := make([]context.CancelFunc, len(items))
    for i, item := range items {
        ctx, cancel := context.WithCancel(parent)
        cancels[i] = cancel
        wg.Add(1)
        go func(i int, it Item) {
            defer wg.Done()
            process(ctx, it)
        }(i, item)
    }
    // To cancel branch 3:
    cancels[3]()
    wg.Wait()
}
```

Each branch has its own cancel function. Cancelling one branch leaves the others running. Cancelling the parent cancels all.

### Why detach is sometimes the right answer

If you want a branch to *survive* the parent being cancelled — because, say, it is a cleanup that must run regardless — start the branch from a detached context:

```go
detached := context.WithoutCancel(parent)
ctx, cancel := context.WithTimeout(detached, 10*time.Second)
go func() { defer cancel(); cleanup(ctx) }()
```

Now `cleanup` is unaffected by the parent and has its own 10-second budget.

### Combining the two ideas

You can have a fan-out where some branches inherit parent cancellation and some are detached:

```go
func handler(parent context.Context) {
    // Primary fan-out: respects parent cancellation.
    g, ctx := errgroup.WithContext(parent)
    g.Go(func() error { return fetchA(ctx) })
    g.Go(func() error { return fetchB(ctx) })
    _ = g.Wait()

    // Detached fan-out: independent of parent cancellation.
    detached := context.WithoutCancel(parent)
    go writeAudit(detached, /* ... */)
    go emitMetric(detached, /* ... */)
}
```

The errgroup fan-out uses parent cancellation. The post-response fan-out is detached. Each is its own cancellation scope.

### Granular per-branch deadlines

Sometimes each branch should have its *own* deadline, derived from the parent but tighter:

```go
func fanOut(parent context.Context, items []Item) {
    var wg sync.WaitGroup
    for _, item := range items {
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            ctx, cancel := context.WithTimeout(parent, deadlineFor(it))
            defer cancel()
            process(ctx, it)
        }(item)
    }
    wg.Wait()
}
```

Each goroutine creates its own `WithTimeout`. The deadlines vary per item. The parent is the common ancestor.

### Fan-out with a "first failure cancels all but one" rule

Sometimes you want first-failure-cancels-all behaviour except for one branch (often a logger or a metric emitter) that should keep going. Compose errgroup for the cancellable branches and a separate detached goroutine for the un-cancellable one:

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })

// Sibling that should keep running even if A or B fails.
detached := context.WithoutCancel(parent)
go alwaysLog(detached)

err := g.Wait()
```

The detached logger is not part of the errgroup, so the errgroup's cancellation does not affect it.

---

## Choosing Between `WithoutCancel`, `WithTimeout`, and `WithDeadline`

A frequent middle-level confusion: which of these four (`WithCancel`, `WithTimeout`, `WithDeadline`, `WithoutCancel`) do I want at each node?

The decision is about *answers* to four orthogonal questions:

1. Should this subtree be cancelled when the parent is? → if not, start with `WithoutCancel`.
2. Should this subtree have its own bounded lifetime? → if yes, layer `WithTimeout` or `WithDeadline`.
3. Should this subtree be cancellable on demand? → if yes, layer `WithCancel`.
4. Should this subtree carry additional values? → if yes, layer `WithValue`.

You compose them in any order. The most common compositions are:

- `WithCancel(parent)` — respects parent, plus its own cancellation.
- `WithTimeout(parent, d)` — respects parent, plus its own deadline.
- `WithTimeout(WithoutCancel(parent), d)` — ignores parent cancellation, has its own deadline.
- `WithCancel(WithoutCancel(parent))` — ignores parent cancellation, plus its own cancellation.

### A complete reference table

| Want                                                              | Compose                                                  |
|-------------------------------------------------------------------|----------------------------------------------------------|
| Subtask cancelled when parent cancelled                            | (use parent directly)                                    |
| Subtask with its own deadline, cancelled when parent cancelled     | `WithTimeout(parent, d)`                                 |
| Subtask with its own cancel button, cancelled when parent cancelled | `WithCancel(parent)`                                     |
| Subtask survives parent cancellation, no deadline                   | `WithoutCancel(parent)`                                  |
| Subtask survives parent cancellation, has its own deadline          | `WithTimeout(WithoutCancel(parent), d)`                  |
| Subtask survives parent, has cancel button, has deadline            | `WithCancel + WithTimeout + WithoutCancel`               |
| Subtask survives parent, dies at process shutdown                    | `WithoutCancel(parent)` + supervisor watching processCtx |

Memorise the first six rows. The seventh is custom logic, covered later.

### When deadlines from the parent should *not* be inherited

A subtle scenario: the parent context has a deadline of 30 seconds (the request budget). You spawn a detached cleanup goroutine that needs to do work for up to 5 minutes (a slow batch write).

If you use `parent` directly, the cleanup is cancelled at 30 seconds. Bug.
If you use `WithoutCancel(parent)`, the cleanup has no deadline. Risk.
If you use `WithTimeout(WithoutCancel(parent), 5*time.Minute)`, the cleanup has its own 5-minute budget independent of the parent's 30 seconds. Correct.

The detach + bound pattern is exactly the recipe for "I need a different deadline than the parent."

### When the parent deadline *should* be inherited

The opposite case: the parent has a 30-second deadline, and your subtask should never exceed that deadline, but you also want a tighter 10-second internal budget. Use `WithTimeout(parent, 10*time.Second)`. The effective deadline is `min(parent, 10s) = 10s`. The cancellation propagates both ways: parent timeout fires → child cancelled; child timeout fires → child cancelled (but not parent).

`WithTimeout` and `WithDeadline` *never* extend the parent's deadline. They only tighten it. This is sometimes called "monotonic deadline."

---

## Detached Subtasks in Larger Orchestrations

In a microservice, a single user-facing request often triggers a small workflow of database reads, downstream calls, and cleanup operations. Some are bound to the request lifecycle; some are not.

### The "outer trunk, inner branches" model

Picture the workflow as a tree:

```
request (lifetime: client connection)
├── load user                 (inherits)
├── load cart                 (inherits)
├── place order               (inherits)
│   ├── reserve inventory     (inherits)
│   ├── charge payment        (inherits)
│   └── write order row       (inherits)
└── DETACH HERE
    ├── write audit row       (detached, own timeout)
    ├── send confirmation email (detached, own timeout)
    └── refresh search index   (detached, own timeout)
```

Everything above `DETACH HERE` shares the parent's lifetime. Everything below has been pulled out of the parent's tree and lives independently.

In code:

```go
func (s *Server) placeOrder(ctx context.Context, req PlaceOrderRequest) (*Order, error) {
    user, err := s.users.Load(ctx, req.UserID)
    if err != nil {
        return nil, err
    }
    cart, err := s.carts.Load(ctx, req.UserID)
    if err != nil {
        return nil, err
    }
    order, err := s.orders.Place(ctx, user, cart)
    if err != nil {
        return nil, err
    }

    // DETACH HERE: side-effects that must outlive the request.
    detached := context.WithoutCancel(ctx)
    s.detached.Run(detached, "audit", 5*time.Second, func(c context.Context) error {
        return s.audit.Record(c, order)
    })
    s.detached.Run(detached, "email", 10*time.Second, func(c context.Context) error {
        return s.email.SendConfirmation(c, user.Email, order)
    })
    s.detached.Run(detached, "index", 30*time.Second, func(c context.Context) error {
        return s.search.Reindex(c, order)
    })

    return order, nil
}
```

The first half of the function uses `ctx` everywhere. The second half uses `detached`. The boundary is clear.

### Why three separate detached goroutines, not one?

You could put all three side-effects into a single detached goroutine that runs them sequentially. Why three?

- **Independence.** If `audit` fails, you still want `email` to run. Sequential coupling would prevent that.
- **Different deadlines.** Audit must complete in 5 seconds; email may take 10; search may take 30. Sequential coupling would force a single, longest deadline.
- **Different retry policies.** Audit retries 3 times; email retries 5; search does not retry at all.
- **Parallelism.** Three independent operations finish faster in parallel.

The cost is three goroutines instead of one. Three goroutines is negligible compared to the network calls they make.

### When sequential is right

Sometimes the operations *do* depend on each other:

- Generate a receipt PDF.
- Upload it to S3.
- Email a link to the user.

These must run in order. Wrap them in a single detached goroutine:

```go
s.detached.Run(parent, "post_order", 60*time.Second, func(c context.Context) error {
    pdf, err := generatePDF(c, order)
    if err != nil {
        return err
    }
    url, err := uploadPDF(c, pdf)
    if err != nil {
        return err
    }
    return s.email.SendReceipt(c, user.Email, url)
})
```

One goroutine, one detached context, sequential operations.

### Mixed parallel and sequential

A common shape: emit audit and metric in parallel, then send notifications sequentially. Use an inner errgroup:

```go
s.detached.Run(parent, "post_order", 60*time.Second, func(c context.Context) error {
    g, gctx := errgroup.WithContext(c)
    g.Go(func() error { return s.audit.Record(gctx, order) })
    g.Go(func() error { return s.metrics.Emit(gctx, order) })
    if err := g.Wait(); err != nil {
        return err
    }
    return s.notify.Send(c, order)
})
```

The outer goroutine is detached. The inner errgroup runs two operations in parallel using the detached context. If either fails, the errgroup cancels its inner context and the parallel operations stop. Then the notification runs sequentially.

---

## Cancelling One errgroup Branch Without Cancelling Others

`errgroup.WithContext` propagates first-error cancellation: when any goroutine returns a non-nil error, the shared context is cancelled and the others should bail out. This is the right default for "all-or-nothing" fan-out.

When you want "best-effort" fan-out — where one branch failing should not cancel others — you have three options.

### Option 1: Use a plain `errgroup.Group` without `WithContext`

```go
var g errgroup.Group
g.Go(func() error { return fetchA(parent) })
g.Go(func() error { return fetchB(parent) })
g.Go(func() error { return fetchC(parent) })
err := g.Wait()
```

Without `WithContext`, there is no shared cancellation. Each goroutine uses the parent context directly. One failure does not cancel the others.

The trade-off: you lose the "stop everything on first error" behaviour, which is sometimes desired.

### Option 2: Wrap the failing branch to swallow its error

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })
g.Go(func() error {
    err := fetchOptional(ctx)
    if err != nil {
        log.Printf("optional failed: %v", err)
        return nil // not propagated to errgroup
    }
    return nil
})
err := g.Wait()
```

The optional branch returns `nil` even on failure. The errgroup never sees its error and does not cancel siblings. The actual failure is logged separately.

### Option 3: Detach the best-effort branch

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })

// Best-effort sibling that should not participate in errgroup cancellation.
detached := context.WithoutCancel(parent)
go func() {
    defer recoverPanic("optional")
    _ = fetchOptional(detached)
}()

err := g.Wait()
```

The best-effort sibling does not even join the errgroup. It is detached from the errgroup's shared context. If A or B fails, the errgroup cancels its context — the detached sibling is unaffected.

### Choosing among the three

- Option 1: when there is no notion of "primary" vs "optional" — every branch is independent.
- Option 2: when you want to keep the errgroup structure but make one branch lenient.
- Option 3: when the best-effort branch should also be best-effort *waiting* — i.e., you do not even want the errgroup's `Wait` to block on it.

Option 3 is the most common at middle level.

---

## Interaction with `singleflight`, `sync.Once`, and Caches

Partial cancellation interacts with concurrency primitives in subtle ways.

### `singleflight`

`singleflight.Group` deduplicates concurrent calls for the same key. Only one goroutine actually does the work; others wait for the result.

The subtle question: which context is passed to the work function? If two requests A and B both want the same key, only one of them calls the work function. Say A's call wins. The work function uses A's context. Now B is waiting. If A is cancelled, the work function aborts; B sees a context-cancelled error too — even though B was not cancelled.

A common fix: pass a detached context to the work function:

```go
v, err, _ := sf.Do(key, func() (any, error) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    return load(ctx, key)
})
```

The work function is independent of any single caller's cancellation. Whichever caller arrives first triggers it; others wait for the same value. If one caller cancels, the load continues.

The trade-off: if *all* callers cancel, the load still runs. For very expensive loads, this may be wasteful.

A more refined pattern: count callers; cancel only when the last one disappears. This is more code; we cover it at the senior level.

### `sync.Once`

`sync.Once` ensures a function runs at most once. It is simpler than `singleflight` and does not return values. Same problem: the first caller's cancellation may affect the work.

Same solution: have the work function use a detached context.

### Caches with refresh

A cache that supports background refresh has the same shape. The user request triggers a stale-while-revalidate refresh; the request itself returns the stale value; the refresh runs in the background.

```go
func (c *Cache) Get(ctx context.Context, key string) (any, error) {
    if v, ok := c.lookup(key); ok {
        if c.isStale(key) {
            detached := context.WithoutCancel(ctx)
            go c.refresh(detached, key) // background
        }
        return v, nil
    }
    // Cache miss: load synchronously.
    return c.load(ctx, key)
}
```

The synchronous load uses the request context (so it is cancelled if the request is). The background refresh uses a detached context.

### `sync.Mutex` and detached operations

A subtle pitfall: a detached goroutine that holds a mutex blocks other goroutines, including request-bound ones. If the detached goroutine takes a long time, the request-bound goroutines waiting for the mutex effectively inherit the detached goroutine's lifetime.

```go
func (s *Service) update(ctx context.Context) {
    s.mu.Lock()
    defer s.mu.Unlock()
    // ... long work ...
}

// Detached goroutine:
go func() {
    detached := context.WithoutCancel(parent)
    s.service.update(detached) // holds the mutex for a long time
}()

// Request-bound goroutine:
s.service.update(ctx) // waits for the mutex
```

The request-bound goroutine waits in `Lock()`. Its context cancellation does not unlock the mutex. If the detached goroutine takes 30 seconds, the request goroutine waits 30 seconds — even if its own context was cancelled at 1 second.

The fix is to make the mutex-protected operations short, or to use a context-aware lock primitive (e.g., a channel-based semaphore).

---

## Pipelines and Partial Cancellation

A *pipeline* is a chain of stages connected by channels. Each stage is one or more goroutines. Cancellation in pipelines is usually all-or-nothing: cancelling the head stops everything downstream.

Partial cancellation in pipelines is useful for two things:

1. Dropping a single item without stopping the pipeline.
2. Letting one stage shut down independently of others.

### Dropping a single item

In a pipeline like A → B → C, suppose B fails for one item. The item should be dropped, but A should keep producing and C should keep consuming.

Item-level cancellation is *not* a context concern — it is a control-flow concern. The stage simply does not forward the item:

```go
func stageB(in <-chan Item, out chan<- Result) {
    for it := range in {
        res, err := process(it)
        if err != nil {
            log.Printf("dropped %v: %v", it.ID, err)
            continue
        }
        out <- res
    }
}
```

But each item processing call may need a per-item context with a deadline:

```go
func stageB(parent context.Context, in <-chan Item, out chan<- Result) {
    for it := range in {
        ctx, cancel := context.WithTimeout(parent, 2*time.Second)
        res, err := process(ctx, it)
        cancel()
        if err != nil {
            continue
        }
        out <- res
    }
}
```

If the parent is cancelled, all per-item contexts are cancelled. If only one item times out, only that item is dropped.

### Stage-level partial cancellation

Sometimes a stage needs to be shut down independently. For example, a metrics-emission stage that you want to drain even if the data stages have stopped.

Each stage owns its own context:

```go
type Pipeline struct {
    dataCtx    context.Context
    metricsCtx context.Context
}

func (p *Pipeline) Start() {
    go dataStage(p.dataCtx)
    go metricsStage(p.metricsCtx)
}
```

Cancelling `dataCtx` stops the data stages. The metrics stage continues until `metricsCtx` is cancelled. Each stage has its own bulkhead.

### Combining the two

Within a single stage, items may have per-item contexts derived from the stage's context. Cancelling the stage cancels all in-flight items.

```go
func dataStage(stageCtx context.Context, in <-chan Item, out chan<- Result) {
    for it := range in {
        select {
        case <-stageCtx.Done():
            return // stage cancelled
        default:
        }
        ctx, cancel := context.WithTimeout(stageCtx, 2*time.Second)
        res, err := process(ctx, it)
        cancel()
        if err != nil {
            continue
        }
        out <- res
    }
}
```

The stage checks its own context before processing each item.

---

## Error Handling in Detached Branches

At middle level, error handling for detached branches needs more structure than the junior-level "log and continue."

### Pattern: errors channel

A central errors channel collected by a supervisor:

```go
type Supervisor struct {
    errs chan error
}

func (s *Supervisor) Go(parent context.Context, name string, fn func(context.Context) error) {
    ctx := context.WithoutCancel(parent)
    go func() {
        defer recoverPanic(name)
        if err := fn(ctx); err != nil {
            s.errs <- fmt.Errorf("%s: %w", name, err)
        }
    }()
}

func (s *Supervisor) Errors() <-chan error { return s.errs }
```

A separate goroutine reads from `s.Errors()` and logs, alerts, or otherwise handles the errors.

### Pattern: dead-letter queue

Failed events go to a durable buffer that a separate worker drains:

```go
func auditDetached(parent context.Context, ev Event, dlq DLQ) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    if err := db.InsertAudit(ctx, ev); err != nil {
        log.Printf("audit failed, enqueuing to DLQ: %v", err)
        dlq.Enqueue(ev)
    }
}
```

The DLQ ensures eventual consistency. The request itself returns immediately.

### Pattern: structured logging

Every detached failure is logged with the trace ID for correlation:

```go
func auditDetached(parent context.Context, ev Event) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    if err := db.InsertAudit(ctx, ev); err != nil {
        traceID := traceIDFromCtx(ctx)
        log.Printf("audit failed trace=%s err=%v", traceID, err)
    }
}
```

Since `WithoutCancel` preserves values, the trace ID is still available. This is essential for debugging — a failed audit in production should be traceable back to the original request.

### Pattern: per-event metrics

Track success/failure rates per detached operation:

```go
func auditDetached(parent context.Context, ev Event) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    if err := db.InsertAudit(ctx, ev); err != nil {
        metrics.Inc("audit_failed")
        return
    }
    metrics.Inc("audit_succeeded")
}
```

A dashboard can show audit success rate over time. A regression in this rate signals a problem.

---

## Real-World Architectures

Three small but realistic architectures that use partial cancellation as a core design element.

### Architecture 1: Audit-Logging Service

A service that wraps an underlying business service and adds audit logging.

```go
type AuditLogger interface {
    Log(ctx context.Context, ev Event) error
}

type WrappedService struct {
    inner Service
    audit AuditLogger
    pool  *DetachedPool
}

func (s *WrappedService) DoThing(ctx context.Context, req Req) (Resp, error) {
    resp, err := s.inner.DoThing(ctx, req)
    s.pool.Run(ctx, "audit", 5*time.Second, func(c context.Context) error {
        return s.audit.Log(c, Event{Req: req, Resp: resp, Err: err})
    })
    return resp, err
}
```

The audit fires regardless of whether the inner call succeeded. The audit is detached, so it survives request cancellation. The audit has its own deadline.

### Architecture 2: Search Index Updater

A service that, after every write to the primary database, updates the search index in the background.

```go
type SearchUpdater struct {
    pool *DetachedPool
}

func (s *Service) Save(ctx context.Context, doc Document) error {
    if err := s.db.Save(ctx, doc); err != nil {
        return err
    }
    s.searchUpdater.pool.Run(ctx, "index", 30*time.Second, func(c context.Context) error {
        return s.search.Index(c, doc)
    })
    return nil
}
```

If the primary write fails, the index update is not attempted. If the primary write succeeds, the index update runs detached. The user does not wait for the index update.

### Architecture 3: Email Confirmation Service

A signup endpoint sends a confirmation email asynchronously.

```go
type SignupService struct {
    pool *DetachedPool
}

func (s *SignupService) Signup(ctx context.Context, req SignupReq) (User, error) {
    user, err := s.users.Create(ctx, req)
    if err != nil {
        return User{}, err
    }
    s.pool.Run(ctx, "email_confirmation", 10*time.Second, func(c context.Context) error {
        return s.email.SendConfirmation(c, user.Email)
    })
    return user, nil
}
```

The user gets back a `User` object immediately. The email arrives a few hundred milliseconds later.

---

## Tests for Partial-Cancellation Behaviour

Testing partial cancellation requires three kinds of test.

### Test 1: Verify the detach actually detaches

```go
func TestDetachSurvivesParentCancel(t *testing.T) {
    parent, cancel := context.WithCancel(context.Background())
    detached := context.WithoutCancel(parent)
    cancel()
    if detached.Err() != nil {
        t.Fatal("detached should not be cancelled when parent is")
    }
}
```

This is trivial but worth having as a regression test for refactors.

### Test 2: Verify detached work completes after parent cancel

```go
func TestDetachedWorkCompletes(t *testing.T) {
    var ran atomic.Bool
    parent, cancel := context.WithCancel(context.Background())
    detached := context.WithoutCancel(parent)
    done := make(chan struct{})
    go func() {
        defer close(done)
        time.Sleep(50 * time.Millisecond)
        if detached.Err() == nil {
            ran.Store(true)
        }
    }()
    cancel()
    <-done
    if !ran.Load() {
        t.Fatal("detached work did not complete")
    }
}
```

This is more realistic — it asserts that a goroutine using a detached context runs to completion even when the parent is cancelled mid-flight.

### Test 3: Verify the supervisor drains correctly

```go
func TestSupervisorDrains(t *testing.T) {
    var counter atomic.Int32
    s := NewSupervisor(context.Background())
    for i := 0; i < 100; i++ {
        s.Run(context.Background(), "test", time.Second, func(c context.Context) error {
            counter.Add(1)
            return nil
        })
    }
    drainCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    if err := s.Drain(drainCtx); err != nil {
        t.Fatal("drain failed:", err)
    }
    if counter.Load() != 100 {
        t.Fatalf("expected 100 runs, got %d", counter.Load())
    }
}
```

This verifies that the supervisor's `Drain` waits for all in-flight detached goroutines.

### Test 4: Verify error counting

```go
func TestSupervisorCountsErrors(t *testing.T) {
    var errs atomic.Int32
    s := NewSupervisorWithErrHook(context.Background(), func(err error) {
        errs.Add(1)
    })
    for i := 0; i < 10; i++ {
        s.Run(context.Background(), "fail", time.Second, func(c context.Context) error {
            return errors.New("nope")
        })
    }
    drainCtx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    _ = s.Drain(drainCtx)
    if errs.Load() != 10 {
        t.Fatalf("expected 10 errors, got %d", errs.Load())
    }
}
```

### Test 5: Verify panic recovery

```go
func TestSupervisorRecoversPanics(t *testing.T) {
    s := NewSupervisor(context.Background())
    s.Run(context.Background(), "panic", time.Second, func(c context.Context) error {
        panic("oops")
    })
    drainCtx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    if err := s.Drain(drainCtx); err != nil {
        t.Fatal("drain failed:", err)
    }
    // If we get here, the panic was recovered.
}
```

---

## Edge Cases at Middle Level

- **Detached context whose parent is cancelled before detach.** Works fine. The detach reads the parent's *value* chain, which is still intact. Cancellation state of the parent does not affect the detached context.
- **Nested detaches.** `WithoutCancel(WithoutCancel(parent))` is legal but semantically pointless. The double-detach is identical to a single detach.
- **Detached context wrapped in another detached context wrapped in a timeout.** The timeout fires; the detached lifetime in between is irrelevant.
- **Detached context used as a parent of an errgroup.** The errgroup's cancellation flows down into its goroutines but does not flow up into the detached parent. This is sometimes useful — the errgroup is internally cancellable while the outer detached context is not.
- **Detached context used in an `AfterFunc`.** `AfterFunc` on a detached context never fires, because the detached context is never cancelled. To get a "fires after delay" behaviour, layer `WithTimeout` on the detached context.
- **Detached context that crosses a goroutine pool.** If you submit work to a worker pool, the worker's context is *not* the detached context unless you arrange it. Always pass the detached context as a value into the work, not as the worker's loop context.

---

## Common Anti-Patterns at Middle Level

### Anti-pattern: detaching too late

```go
go func() {
    detached := context.WithoutCancel(parent)
    // ... but the parent was already cancelled before we got here ...
    work(detached)
}()
```

Detaching after the parent is cancelled still works (the values are preserved). But if the work depends on values that are themselves time-sensitive (a short-lived per-request token), the values may be stale.

The fix: detach at the call site of `go`, not inside the goroutine.

### Anti-pattern: detaching the inner errgroup context

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error {
    detached := context.WithoutCancel(ctx)
    return work(detached) // ignores errgroup cancellation
})
```

The errgroup's cancellation is meant to coordinate the group. Detaching from it defeats the coordination. If you want this goroutine to not respect the errgroup, do not put it in the errgroup in the first place.

### Anti-pattern: chaining `WithoutCancel` and `WithCancel`

```go
ctx, cancel := context.WithCancel(context.WithoutCancel(parent))
// ... cancel() is the only way to cancel this ...
```

This is sometimes correct — you want a manually-cancellable detached subtree. But the `cancel` function is now the only way to cancel. If the goroutine forgets to call it, you have a leak.

### Anti-pattern: passing a detached context through middleware

```go
func middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := context.WithoutCancel(r.Context()) // <-- bad
        r = r.WithContext(ctx)
        next.ServeHTTP(w, r)
    })
}
```

The downstream handler no longer respects client disconnect. Every database call, every downstream HTTP call, every cache lookup will keep running after the client gives up. This is almost never what you want.

The fix is to only detach at the *spawning* point of a detached goroutine, never at the level of the entire request.

### Anti-pattern: pretending detached work is free

A handler that detaches three operations is, from the handler's perspective, fast — the response goes out immediately. But the three detached goroutines are using CPU and database connections. If the handler is called a thousand times per second, you have three thousand detached goroutines outstanding. Each one needs a database connection. The connection pool exhausts. The system grinds to a halt.

Detached does not mean free. Account for the resource cost.

---

## Cheat Sheet

```
// Compose for any combination of (parent-cancel) × (own-deadline) × (own-cancel)
ctx = context.WithCancel(parent)              // inherits parent + own cancel
ctx = context.WithTimeout(parent, d)          // inherits parent + own deadline
ctx = context.WithoutCancel(parent)           // ignores parent, no deadline
ctx = context.WithTimeout(
        context.WithoutCancel(parent), d)     // ignores parent + own deadline

// Common patterns
detached := context.WithoutCancel(parent)
ctx, cancel := context.WithTimeout(detached, 5*time.Second)
go func() { defer cancel(); work(ctx) }()

// Best-effort errgroup branch: detach to escape the group
g, gctx := errgroup.WithContext(parent)
detached := context.WithoutCancel(parent)
go bestEffort(detached) // not part of the group

// singleflight: use detached inside the work
sf.Do(key, func() (any, error) {
    ctx := context.WithoutCancel(parent)
    return load(ctx, key)
})
```

---

## Summary

At middle level, partial cancellation stops being about a single API call and becomes about *composition*. You learn to make scope decisions per subtask, to compose `WithoutCancel`, `WithCancel`, `WithTimeout`, and `WithDeadline` into the shapes you need, and to coordinate detached and request-bound branches in the same workflow.

Three skills define this level:

1. Naming, for each subtask, what owns its lifetime.
2. Choosing the right composition of cancellation derivations.
3. Designing fan-out, errgroup, and pipeline patterns with selective cancellation.

The senior level moves to architecture: how detached subtasks integrate with graceful shutdown, distributed tracing, and the broader service lifecycle.

---

## Further Reading

- `golang.org/x/sync/errgroup` — pay particular attention to `WithContext`.
- `golang.org/x/sync/singleflight` — and the issue about cancellation between callers.
- `context.AfterFunc` (Go 1.21) — its interaction with `WithoutCancel`.
- The Go runtime's source for `WithCancel` and `WithCancelCause` (`src/context/context.go`).
- The OpenTelemetry Go SDK's span lifecycle code — they wrestle with exactly these problems.

---

## Deeper Patterns

### Pattern: The Coordinator Goroutine

Some workflows need a long-running coordinator that orchestrates many detached operations. The coordinator owns the supervisor and the process context. Handlers submit work to it.

```go
type Coordinator struct {
    process context.Context
    work    chan Work
    wg      sync.WaitGroup
}

type Work struct {
    Parent context.Context
    Name   string
    Timeout time.Duration
    Fn     func(context.Context) error
}

func NewCoordinator(processCtx context.Context, workers int) *Coordinator {
    c := &Coordinator{
        process: processCtx,
        work:    make(chan Work, workers*4),
    }
    for i := 0; i < workers; i++ {
        c.wg.Add(1)
        go c.run()
    }
    return c
}

func (c *Coordinator) run() {
    defer c.wg.Done()
    for {
        select {
        case w := <-c.work:
            c.do(w)
        case <-c.process.Done():
            return
        }
    }
}

func (c *Coordinator) do(w Work) {
    ctx := context.WithoutCancel(w.Parent)
    ctx, cancel := context.WithTimeout(ctx, w.Timeout)
    defer cancel()
    defer recoverPanic(w.Name)
    if err := w.Fn(ctx); err != nil {
        log.Printf("%s: %v", w.Name, err)
    }
}

func (c *Coordinator) Submit(parent context.Context, name string, timeout time.Duration, fn func(context.Context) error) {
    select {
    case c.work <- Work{Parent: parent, Name: name, Timeout: timeout, Fn: fn}:
    case <-c.process.Done():
    }
}

func (c *Coordinator) Drain(ctx context.Context) error {
    close(c.work)
    done := make(chan struct{})
    go func() { c.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func recoverPanic(name string) {
    if r := recover(); r != nil {
        log.Printf("%s panic: %v", name, r)
    }
}
```

This is the seed of an internal "detached work" service. Handlers submit; the coordinator processes; the process owns the lifecycle.

### Pattern: Per-Operation Lifetime Tracking

For debugging or capacity planning, track every in-flight detached operation:

```go
type TrackedSupervisor struct {
    *Coordinator
    inflight sync.Map // map[opID]Info
}

type Info struct {
    Name      string
    Start     time.Time
    TraceID   string
}

func (s *TrackedSupervisor) Submit(parent context.Context, name string, timeout time.Duration, fn func(context.Context) error) {
    id := newOpID()
    s.inflight.Store(id, Info{
        Name: name, Start: time.Now(),
        TraceID: traceIDFromCtx(parent),
    })
    s.Coordinator.Submit(parent, name, timeout, func(ctx context.Context) error {
        defer s.inflight.Delete(id)
        return fn(ctx)
    })
}

func (s *TrackedSupervisor) Inflight() []Info {
    var out []Info
    s.inflight.Range(func(_, v any) bool {
        out = append(out, v.(Info))
        return true
    })
    return out
}
```

An admin endpoint can show what is currently in flight. Useful when a deployment is stuck on draining.

### Pattern: Capacity-Bounded Detached Pool

A naive detached pool spawns one goroutine per submission. At high throughput, this can overwhelm the database (each goroutine opens a connection) or the network (each goroutine creates a request).

The fix is a bounded worker pool:

```go
type BoundedPool struct {
    work    chan Work
    process context.Context
    wg      sync.WaitGroup
}

func NewBoundedPool(processCtx context.Context, n int) *BoundedPool {
    p := &BoundedPool{
        work:    make(chan Work, n*8),
        process: processCtx,
    }
    for i := 0; i < n; i++ {
        p.wg.Add(1)
        go p.loop()
    }
    return p
}

func (p *BoundedPool) loop() {
    defer p.wg.Done()
    for w := range p.work {
        p.do(w)
    }
}

func (p *BoundedPool) do(w Work) {
    ctx := context.WithoutCancel(w.Parent)
    ctx, cancel := context.WithTimeout(ctx, w.Timeout)
    defer cancel()
    defer recoverPanic(w.Name)
    _ = w.Fn(ctx)
}

func (p *BoundedPool) Submit(parent context.Context, name string, timeout time.Duration, fn func(context.Context) error) error {
    w := Work{Parent: parent, Name: name, Timeout: timeout, Fn: fn}
    select {
    case p.work <- w:
        return nil
    case <-p.process.Done():
        return p.process.Err()
    default:
        return errors.New("pool full")
    }
}
```

`Submit` returns an error when the pool is saturated. The handler can decide what to do — drop the event, write to a DLQ, or backpressure.

### Pattern: Detached With Shutdown Hook

A detached operation that should run, with the option to "speed up" or "shut down" when the process exits:

```go
func (p *Pool) detachedWithShutdown(parent context.Context, fn func(context.Context, <-chan struct{})) {
    ctx := context.WithoutCancel(parent)
    p.wg.Add(1)
    go func() {
        defer p.wg.Done()
        defer recoverPanic("detached")
        fn(ctx, p.process.Done())
    }()
}
```

The function receives both a context and a separate "stop hint" channel. Long operations can check the stop channel and abort gracefully:

```go
p.detachedWithShutdown(parent, func(ctx context.Context, stop <-chan struct{}) {
    for i := 0; i < 1000; i++ {
        select {
        case <-stop:
            return
        default:
        }
        processItem(ctx, i)
    }
})
```

---

## Three Worked Architectures

### Architecture A: A High-Throughput Webhook Sender

A service that receives webhook delivery requests and sends them asynchronously. Must survive client disconnect, must be drained at shutdown, must have bounded retries.

```go
type WebhookSender struct {
    pool    *BoundedPool
    client  *http.Client
}

func NewWebhookSender(processCtx context.Context) *WebhookSender {
    return &WebhookSender{
        pool: NewBoundedPool(processCtx, 100),
        client: &http.Client{Timeout: 10 * time.Second},
    }
}

func (s *WebhookSender) Send(parent context.Context, w Webhook) error {
    return s.pool.Submit(parent, "webhook", 60*time.Second, func(ctx context.Context) error {
        return s.deliver(ctx, w)
    })
}

func (s *WebhookSender) deliver(ctx context.Context, w Webhook) error {
    delays := []time.Duration{0, time.Second, 5 * time.Second, 30 * time.Second}
    for i, d := range delays {
        if d > 0 {
            select {
            case <-time.After(d):
            case <-ctx.Done():
                return ctx.Err()
            }
        }
        if err := s.attempt(ctx, w); err == nil {
            return nil
        } else if i == len(delays)-1 {
            return err
        }
    }
    return nil
}

func (s *WebhookSender) attempt(ctx context.Context, w Webhook) error {
    req, err := http.NewRequestWithContext(ctx, "POST", w.URL, bytes.NewReader(w.Body))
    if err != nil {
        return err
    }
    resp, err := s.client.Do(req)
    if err != nil {
        return err
    }
    resp.Body.Close()
    if resp.StatusCode >= 500 {
        return fmt.Errorf("server %d", resp.StatusCode)
    }
    return nil
}
```

The handler enqueues; the pool processes; the operation has its own 60-second budget; retries are bounded; the pool has 100 workers; on shutdown, the pool drains.

### Architecture B: A Metric Aggregator

A service that emits metrics. To avoid one network call per metric, it buffers and flushes in batches.

```go
type MetricEmitter struct {
    in      chan Metric
    out     chan []Metric
    process context.Context
}

func NewMetricEmitter(processCtx context.Context) *MetricEmitter {
    e := &MetricEmitter{
        in:      make(chan Metric, 1000),
        out:     make(chan []Metric, 10),
        process: processCtx,
    }
    go e.batcher()
    go e.flusher()
    return e
}

func (e *MetricEmitter) Emit(parent context.Context, m Metric) {
    select {
    case e.in <- m:
    case <-e.process.Done():
    default: // drop on overflow
    }
}

func (e *MetricEmitter) batcher() {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    var batch []Metric
    for {
        select {
        case m := <-e.in:
            batch = append(batch, m)
            if len(batch) >= 100 {
                e.out <- batch
                batch = nil
            }
        case <-ticker.C:
            if len(batch) > 0 {
                e.out <- batch
                batch = nil
            }
        case <-e.process.Done():
            if len(batch) > 0 {
                e.out <- batch
            }
            close(e.out)
            return
        }
    }
}

func (e *MetricEmitter) flusher() {
    for batch := range e.out {
        ctx, cancel := context.WithTimeout(e.process, 5*time.Second)
        _ = pushMetrics(ctx, batch)
        cancel()
    }
}

func pushMetrics(ctx context.Context, batch []Metric) error { return nil }
type Metric struct{ Name string; Value float64 }
```

The handler's `Emit` is non-blocking. The batcher accumulates and flushes; the flusher pushes batches to the network. At shutdown, the batcher flushes the final batch and closes the channel; the flusher drains. Partial cancellation appears as: the per-flush context uses the process context, *not* any request's context.

### Architecture C: A Saga Orchestrator

A multi-step business workflow with detached compensating actions on failure.

```go
type Saga struct {
    pool    *BoundedPool
    process context.Context
}

func (s *Saga) Run(parent context.Context, steps []Step) error {
    var completed []Step
    for _, step := range steps {
        if err := step.Do(parent); err != nil {
            // Failure: trigger compensating actions detached.
            for _, prev := range completed {
                p := prev
                s.pool.Submit(parent, "compensate", 30*time.Second, func(ctx context.Context) error {
                    return p.Compensate(ctx)
                })
            }
            return err
        }
        completed = append(completed, step)
    }
    return nil
}

type Step interface {
    Do(ctx context.Context) error
    Compensate(ctx context.Context) error
}
```

The main `Run` uses the parent context. The compensating actions are detached — they must run even if the caller has given up.

---

## Going Deeper on `singleflight`

`singleflight` is one of the most subtle interactions with partial cancellation. Let us trace through several scenarios.

### Scenario 1: One caller, normal completion

Caller A calls `sf.Do("key", load)`. `load` starts. `load` finishes. A gets the value.

No interesting cancellation behaviour.

### Scenario 2: Two callers, neither cancels

Caller A calls `sf.Do("key", load)`. `load` starts using *A's* context. Caller B calls `sf.Do("key", load)`. B does not run `load`; it waits. `load` finishes. Both A and B get the value.

The value is good for both. No issue.

### Scenario 3: A cancels before load finishes

Caller A calls `sf.Do("key", load)`. `load` starts. A's caller cancels A's context. What happens to `load`?

The work function inside `singleflight` receives the *first caller's* context. When A cancels, the work function (if it uses A's context) aborts. Caller B, who joined after A but did not cancel, sees the cancelled error too — even though B did not cancel.

This is surprising. B did nothing wrong, but its result is determined by A's cancellation.

### Scenario 4: Detached context in the work function

```go
sf.Do("key", func() (any, error) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    return load(ctx, key)
})
```

Now A's cancellation does not affect the work function. The load runs to completion. Both A and B get the value — A may have already given up, but B receives a real value.

The trade-off: if *no one* needs the value any more, the load still runs. For very expensive loads, this can waste resources. The senior file discusses how to refcount the work and cancel only when the last caller leaves.

### A unified pattern

For loads that are cheap to repeat: do not bother with `singleflight`; just let each caller load.
For loads that are expensive but tolerate "best-effort completion": use `singleflight` with a detached work context.
For loads that are expensive and should be cancellable: use `singleflight` with refcounting.

---

## A Detailed Walk: From `r.Context()` to a Drained Detached Pool

Let us build a complete service top to bottom, with every partial-cancellation decision called out.

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// 1. Process context: cancelled at shutdown.
func main() {
	processCtx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	pool := NewPool(processCtx, 50)
	srv := &Server{pool: pool}

	httpServer := &http.Server{
		Addr:    ":8080",
		Handler: srv,
	}

	go func() {
		<-processCtx.Done()
		shutdownCtx, c := context.WithTimeout(context.Background(), 30*time.Second)
		defer c()
		_ = httpServer.Shutdown(shutdownCtx)
		_ = pool.Drain(shutdownCtx)
	}()

	log.Println("listening on :8080")
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	<-processCtx.Done()
}

type Pool struct {
	process context.Context
	work    chan func(context.Context)
	wg      sync.WaitGroup
	inflight atomic.Int32
}

func NewPool(processCtx context.Context, n int) *Pool {
	p := &Pool{
		process: processCtx,
		work:    make(chan func(context.Context), n*4),
	}
	for i := 0; i < n; i++ {
		p.wg.Add(1)
		go p.loop()
	}
	return p
}

func (p *Pool) loop() {
	defer p.wg.Done()
	for fn := range p.work {
		p.inflight.Add(1)
		fn(p.process)
		p.inflight.Add(-1)
	}
}

func (p *Pool) Submit(parent context.Context, name string, timeout time.Duration, fn func(context.Context) error) {
	detached := context.WithoutCancel(parent)
	wrapped := func(processCtx context.Context) {
		ctx, cancel := context.WithTimeout(detached, timeout)
		defer cancel()
		defer func() {
			if r := recover(); r != nil {
				log.Printf("%s panic: %v", name, r)
			}
		}()
		if err := fn(ctx); err != nil {
			log.Printf("%s: %v", name, err)
		}
	}
	select {
	case p.work <- wrapped:
	case <-p.process.Done():
	}
}

func (p *Pool) Drain(ctx context.Context) error {
	close(p.work)
	done := make(chan struct{})
	go func() { p.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

type Server struct {
	pool *Pool
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Main work uses r.Context()
	fmt.Fprintln(w, "ok")

	// Detached work uses the pool
	s.pool.Submit(r.Context(), "audit", 5*time.Second, func(ctx context.Context) error {
		// pretend to write to DB
		time.Sleep(50 * time.Millisecond)
		return nil
	})
}
```

Trace through the lifecycle:

1. **Main work in the handler** uses `r.Context()`. If the client disconnects, this work is cancelled.
2. **Submit to the pool** detaches the context. The pool's worker uses the detached context.
3. **Inside the worker**, a `WithTimeout` gives the work its own 5-second budget.
4. **At shutdown**, the process context is cancelled. The handler's `r.Context()` is cancelled (it sits inside the HTTP server's child context tree). The pool's `Submit` checks `p.process.Done()` and refuses new submissions. The drain closes the work channel and waits for the workers to finish.

Every line in this 80-line file has a reason. This is the canonical middle-level architecture.

---

## When You Should Not Detach

Just because you can detach does not mean you should. Five anti-cases where detaching is the wrong call.

### Anti-case 1: Wasting downstream resources

A search service has a 200ms p99 latency. A client gives up after 100ms. If you detach the search call, you keep using the search service for another 100ms producing a result no one will read. Multiply by a million requests per day — that is 100,000 wasted search operations.

Cancellation exists to *avoid* this waste. Detaching defeats it.

### Anti-case 2: Holding expensive resources

A query that holds a row-level lock on the database. The client disconnects. If you detach, the query keeps the lock. Other queries waiting on that row are blocked. The system grinds.

### Anti-case 3: User-visible work

A handler renders HTML for the user. The user gives up. Detaching the render is purely wasted CPU — there is no user to receive the result.

### Anti-case 4: Speculative work

A handler speculatively prefetches three items, hoping one of them will be the right one. If the user cancels, all three should be cancelled.

### Anti-case 5: Cleanup that does not need to outlive the request

A handler opens three connections to downstream services. If the request is cancelled, all three should be closed. Detaching the connection-close is pointless — the connections are not useful to anyone else.

The rule of thumb: detach only when the *side-effect* itself is the goal, not when the caller's value extraction is.

---

## A Field Guide: Reading Production Logs

When you see a log line like:

```
audit failed trace=abc123 err=context deadline exceeded
```

What does it tell you?

- `trace=abc123` — the request's trace ID. The detached context preserved it.
- `err=context deadline exceeded` — *not* the parent's deadline. The detached context has no parent deadline. This is the *detached* operation's own timeout firing. The downstream is too slow.

A common confusion: assuming `context deadline exceeded` always means the request timed out. In detached operations, it usually means the *operation's own* timeout fired.

When you see:

```
audit failed trace=abc123 err=context canceled
```

This is more surprising. The detached context cannot be cancelled by the parent. So why "canceled"? Probably:

- The detached context was layered with `WithCancel`, and somebody called `cancel()`.
- The detached context was layered with `WithoutCancel(WithCancel(...))`, and the inner cancel was called *before* the detach was applied — but the detach should still ignore this.

Tracing through these scenarios in logs is a senior-level skill. At middle level, just be aware that "context canceled" can come from a layered cancel, not just from the parent.

---

## Patterns From Other Languages

How do other languages express partial cancellation? Comparing helps cement the Go model.

### Java

Java's `CompletableFuture` does not have a direct equivalent of `WithoutCancel`. The closest pattern is to *not* pass the parent's cancellation token, or to use `CompletableFuture.thenApplyAsync` with a different executor. Java's structured concurrency proposal (Loom) introduces similar concepts.

### C# / .NET

`CancellationToken` is propagated explicitly. A `CancellationToken.None` is the equivalent of `context.Background()`. To preserve some values, you would build a custom `IServiceProvider` or `IRequestContextAccessor`.

### Rust / Tokio

`tokio::task::spawn` runs a future on the runtime. If the parent is dropped, the child continues unless you arrange otherwise. This is the *opposite* default of Go's context model — Go cancels by default; Rust runs by default. Both have their fans.

### Kotlin coroutines

`CoroutineScope.cancel()` cancels a scope. Detached child scopes are created with `SupervisorJob`. The model is similar to Go's: explicit cancellation, explicit scope.

The Go model is one of the cleaner ones because cancellation is *explicit and uniform*. `WithoutCancel` is a small, focused addition that fits the existing model.

---

## Practice: A 12-Step Exercise

Build a service from scratch that demonstrates every middle-level concept. Twelve steps:

1. Create a `Pool` struct with bounded workers and a process context.
2. Add a `Submit` method that detaches the parent context and bounds the operation.
3. Add a `Drain` method that closes the work channel and waits for workers.
4. Add a `recoverPanic` helper that logs panics by name.
5. Add an HTTP server with one handler that does some "main work" using `r.Context()`.
6. After the main work, submit a detached audit to the pool.
7. After the audit, submit a detached email to the pool.
8. Add a `signal.NotifyContext` to the main function for graceful shutdown.
9. On shutdown, close the HTTP server and drain the pool with a 30-second budget.
10. Add structured logging that includes the trace ID in every log line.
11. Add metrics counting submissions, successes, and failures.
12. Write tests that verify: detach survives parent cancel; drain waits for all in-flight; panics do not crash the process; shutdown respects the budget.

By the time you finish step 12, you can write production-grade partial-cancellation code.

---

## Closing Words for Middle-Level Engineers

`WithoutCancel` is a small API. Partial cancellation is a deep practice. The gap between knowing the API and using it well is the gap between junior and middle level.

Three skills mark mastery:

1. You think about lifetime *before* you write the goroutine.
2. You name, for each scope, what owns its cancellation.
3. You can spot, on review, when a colleague has detached too aggressively or not aggressively enough.

The senior file moves to architecture, cross-cutting concerns, and the integration with tracing, logging, and distributed systems.

---

## Appendix: Pop Quiz

1. What is the difference between `WithoutCancel(parent)` and `WithCancel(parent)`?
2. What is `context.WithTimeout(WithoutCancel(parent), d)`?
3. If two goroutines call `singleflight.Do` for the same key and the first one cancels, what happens to the second?
4. How do you prevent the second goroutine from being affected?
5. Can `errgroup.WithContext` cancel a detached sibling?
6. When should you *not* detach?
7. What does `AfterFunc` do on a detached context?
8. How do you wait for all detached goroutines at shutdown?
9. What is a bulkhead in this context?
10. Why is sequential detached work sometimes wrong?

### Answers

1. `WithoutCancel` ignores parent cancellation; `WithCancel` adds a cancel button while still respecting parent.
2. A detached context with its own deadline.
3. The second goroutine sees the same cancelled error.
4. Use a detached context inside the work function.
5. No — the errgroup's cancellation context does not reach into detached siblings.
6. When the work is for the user, holds expensive resources, or is speculative.
7. Nothing — the detached context is never cancelled.
8. Use a `WaitGroup` and a `Drain` method.
9. An isolation boundary between failure domains; detached work creates a bulkhead.
10. Sequential coupling forces one big deadline, blocks independent retries, and loses parallelism.

---

## Appendix: A Sample Code Review Checklist

When reviewing PRs that introduce detached work, check:

- [ ] Is `WithoutCancel` used, not `context.Background()`?
- [ ] Is there a timeout or deadline downstream of the detach?
- [ ] Is the detached goroutine recovered from panics?
- [ ] Is there logging that includes the trace ID?
- [ ] Is there a metric for success/failure?
- [ ] Is the detached work tracked by a supervisor for shutdown?
- [ ] Is the operation idempotent enough to retry?
- [ ] Does the comment explain *why* this work must outlive the request?

If any answer is no, ask the author about it. Detached work is one of the easiest places to introduce subtle bugs.

---

## A Final Worked Example: Migrating an errgroup to Mixed Lifetimes

Before:

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })
g.Go(func() error { return logVisit(ctx) }) // <-- best-effort
err := g.Wait()
```

Problem: if `logVisit` fails, the errgroup cancels its context, and `fetchA` and `fetchB` are aborted. Worse, if `fetchA` fails, `logVisit` is cancelled — meaning we lose the visit log on every error.

After:

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })

// logVisit is best-effort and must outlive the errgroup.
detached := context.WithoutCancel(parent)
pool.Submit(detached, "log_visit", 5*time.Second, func(c context.Context) error {
    return logVisit(c)
})

err := g.Wait()
```

Now `logVisit` is detached. It always runs, regardless of `fetchA` or `fetchB` failures. It has its own 5-second budget. The errgroup is purely for the two critical fetches.

The PR diff is six lines. The behavioural change is substantial.

---

## Pattern Catalogue (Middle Level)

A dozen named patterns you should recognise on sight at middle level.

### Pattern: Detach-And-Track

```go
type tracker struct {
    wg sync.WaitGroup
}

func (t *tracker) Go(parent context.Context, fn func(context.Context)) {
    t.wg.Add(1)
    ctx := context.WithoutCancel(parent)
    go func() { defer t.wg.Done(); fn(ctx) }()
}

func (t *tracker) Wait() { t.wg.Wait() }
```

The simplest reusable abstraction. Track every detached goroutine for shutdown.

### Pattern: Detach-And-Time-Out

```go
func detachTimeout(parent context.Context, d time.Duration) (context.Context, context.CancelFunc) {
    return context.WithTimeout(context.WithoutCancel(parent), d)
}
```

A one-liner you call dozens of times. Wraps the most common composition.

### Pattern: Detach-And-Retry

```go
func detachRetry(parent context.Context, attempts int, base time.Duration, fn func(context.Context) error) {
    ctx := context.WithoutCancel(parent)
    go func() {
        for i := 0; i < attempts; i++ {
            c, cancel := context.WithTimeout(ctx, 2*time.Second)
            err := fn(c)
            cancel()
            if err == nil {
                return
            }
            time.Sleep(time.Duration(i+1) * base)
        }
    }()
}
```

Bounded retry detached from the parent.

### Pattern: Multi-Lifetime Bridge

A goroutine that listens to two lifetimes: its operation's deadline and the process shutdown signal.

```go
func detachWithBridge(parent context.Context, process context.Context, fn func(context.Context)) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithCancel(ctx)
    go func() {
        select {
        case <-process.Done():
            cancel()
        case <-ctx.Done():
        }
    }()
    go func() { defer cancel(); fn(ctx) }()
}
```

The work goroutine sees its context cancelled when the process is shutting down. The work has no influence on the parent.

### Pattern: First-Wins-Cancel-Others

A fan-out where the first successful result cancels the rest.

```go
func firstWins(parent context.Context, fns []func(context.Context) (any, error)) (any, error) {
    ctx, cancel := context.WithCancel(parent)
    defer cancel()
    results := make(chan any, len(fns))
    errs := make(chan error, len(fns))
    for _, f := range fns {
        f := f
        go func() {
            v, err := f(ctx)
            if err != nil {
                errs <- err
                return
            }
            results <- v
        }()
    }
    select {
    case v := <-results:
        cancel()
        return v, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

Not detached — this uses the parent's cancellation actively. But it is a common shape that mixes per-branch cancellation with parent cancellation.

### Pattern: All-Wait-Best-Effort

A fan-out where all goroutines run to completion; failures are logged but do not abort siblings.

```go
func allBestEffort(parent context.Context, fns []func(context.Context) error) {
    var wg sync.WaitGroup
    for _, f := range fns {
        wg.Add(1)
        f := f
        go func() {
            defer wg.Done()
            if err := f(parent); err != nil {
                log.Printf("best-effort failed: %v", err)
            }
        }()
    }
    wg.Wait()
}
```

This is *not* detached — it still uses the parent's cancellation. But it differs from errgroup in that one failure does not cancel siblings.

### Pattern: Detached With Health Check

A long-running detached goroutine that periodically reports its health.

```go
func detachedHealth(parent context.Context, name string, fn func(context.Context), interval time.Duration) {
    ctx := context.WithoutCancel(parent)
    health := make(chan struct{}, 1)
    go fn(ctx) // assume fn signals via health channel
    go func() {
        t := time.NewTicker(interval)
        defer t.Stop()
        for {
            select {
            case <-health:
                metrics.Inc("detached_alive", "name", name)
            case <-t.C:
                metrics.Inc("detached_silent", "name", name)
            }
        }
    }()
}
```

The detached goroutine is monitored. If it goes silent, the metric reflects this. Useful for detecting hung detached work.

### Pattern: Cascaded Detach

A detached goroutine that itself spawns further detached work.

```go
func parent(ctx context.Context) {
    detached := context.WithoutCancel(ctx)
    go func() {
        // Inside this goroutine, further detaches are legal.
        child := context.WithoutCancel(detached) // already detached, second detach is fine
        go func() { /* ... */ _ = child }()
    }()
}
```

Each level of detach is a no-op for the outer detach, but legal. The pattern shows up when reusable libraries don't know if their input is already detached.

### Pattern: Re-Attach to Process

A detached operation that wants to be cancelled at process shutdown but not at request cancellation.

```go
func detachReattachProcess(parent, process context.Context, fn func(context.Context)) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithCancel(ctx)
    go func() {
        defer cancel()
        select {
        case <-process.Done():
            return
        case <-ctx.Done():
            return
        }
    }()
    go fn(ctx)
}
```

The work goroutine sees its context cancelled when the process is cancelled. The parent has no influence.

### Pattern: Conditional Detach

Sometimes you detach only if a condition is met (e.g., a feature flag).

```go
func conditionalDetach(parent context.Context, detach bool, fn func(context.Context)) {
    var ctx context.Context = parent
    if detach {
        ctx = context.WithoutCancel(parent)
    }
    go fn(ctx)
}
```

The same code path supports both modes. Useful during rollouts of partial-cancellation behaviour.

### Pattern: Detached Pipeline Stage

A pipeline stage that runs in detached mode for cleanup-style processing.

```go
func detachedStage(parent context.Context, in <-chan Item, process func(context.Context, Item) error) {
    ctx := context.WithoutCancel(parent)
    go func() {
        for it := range in {
            c, cancel := context.WithTimeout(ctx, time.Second)
            _ = process(c, it)
            cancel()
        }
    }()
}
```

The stage drains `in` even after the parent is cancelled. Useful when `in` is a buffered channel that may still have items.

### Pattern: Detach-And-Funnel

Many parents, one detached pool. Each parent's lifetime is tracked, but the pool runs work using its own detached context.

```go
type Funnel struct {
    pool *Pool
}

func (f *Funnel) Submit(parent context.Context, fn func(context.Context) error) {
    // Pool internally detaches.
    f.pool.Submit(parent, "funnel", 5*time.Second, fn)
}
```

The handler's view is simple: submit and forget. The pool's view is structured: detach, time, recover, track.

---

## Worked Example: Reconciling a Three-Service Fan-Out

A handler needs results from three services A, B, C. A and B are critical (failure means abort). C is best-effort (failure is logged but does not abort).

### Naive (wrong) version

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })
g.Go(func() error { return fetchC(ctx) })
err := g.Wait()
```

Problem: if C fails, the errgroup cancels A and B too. C should be best-effort, not "best-effort that cancels the others on failure."

### Improved version

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })

// C is best-effort. Use a separate non-error-wrapping goroutine.
var cResult atomic.Value
var cWG sync.WaitGroup
cWG.Add(1)
go func() {
    defer cWG.Done()
    if res, err := fetchC(parent); err == nil {
        cResult.Store(res)
    } else {
        log.Printf("C failed: %v", err)
    }
}()

err := g.Wait()
cWG.Wait()
```

Now C does not participate in the errgroup. C succeeds or fails independently. Both A/B (errgroup) and C (separate goroutine) respect parent cancellation.

### Detached version (different requirements)

If C is *also* "must run even if A or B fails":

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })

// C runs detached; A/B failure does not cancel it.
detached := context.WithoutCancel(parent)
pool.Submit(detached, "fetchC", 5*time.Second, func(c context.Context) error {
    return fetchC(c)
})

err := g.Wait()
```

Three versions, three different requirements, three different shapes. Reading "fan out three services" without specifying lifetime is ambiguous; reading it with lifetime specified makes the right shape obvious.

---

## The Math of Detached Goroutine Bounds

For capacity planning, you need to bound the number of detached goroutines.

Suppose:

- Requests arrive at rate `r` per second.
- Each request spawns `d` detached operations.
- Each operation takes `t` seconds.

Then the steady-state number of detached goroutines is `r × d × t`. If `r = 1000`, `d = 3`, `t = 5`, you have 15,000 detached goroutines at any moment.

15,000 goroutines is fine (each costs ~2 KB stack, so ~30 MB). But:

- 15,000 database connections is not fine.
- 15,000 simultaneous HTTP calls to a downstream is not fine.
- 15,000 file descriptors is not fine.

The detached pool's bounded worker pattern caps this. With a pool of 100 workers:

- Workers in flight: 100.
- Queue depth: depends on burst tolerance.

If your steady-state demand exceeds 100, the queue grows. Eventually `Submit` returns "pool full" and you drop work.

Capacity planning checklist:

- What is the steady-state submission rate?
- What is the worst-case burst rate?
- What is the average operation duration?
- What is the maximum acceptable queue depth?
- What is the maximum number of concurrent downstream operations the system can sustain?

Set the worker count to balance these. Set the queue depth to absorb bursts without going unbounded.

---

## A Subtle Bug: The "Almost Detached" Goroutine

```go
go func() {
    ctx := context.WithoutCancel(parent)
    work(ctx)
}()
```

Subtle issue: between the `go` statement and the `WithoutCancel` call, the goroutine may not yet have detached. If the parent is cancelled before `WithoutCancel` runs, the detached context still works (it preserves values), but if `work` is short and depends on `parent` directly (somehow), there is a race.

The fix is to capture the detached context *before* spawning:

```go
detached := context.WithoutCancel(parent)
go func() {
    work(detached)
}()
```

Now the detach is deterministic. The goroutine sees a fully-formed detached context from line one.

This is a minor issue in practice — the race is between "goroutine starts" and "context.WithoutCancel returns," which is sub-microsecond. But it is good hygiene.

---

## A Subtle Bug: Detach With Stale Closures

```go
func handler(r *http.Request) {
    user := loadUser(r.Context()) // user.Token has 5-minute TTL
    detached := context.WithoutCancel(r.Context())
    go func() {
        time.Sleep(10 * time.Minute) // beyond user.Token's TTL
        callDownstream(detached, user.Token)
    }()
}
```

The token expired five minutes before the call. The downstream rejects it.

The fix is to refresh per-detached-call credentials, or to fetch them fresh in the detached goroutine:

```go
go func() {
    time.Sleep(10 * time.Minute)
    user := loadUser(detached) // fresh load
    callDownstream(detached, user.Token)
}()
```

Or use a credentials provider that knows how to refresh.

---

## A Subtle Bug: Detach With Closures Over Mutable State

```go
counter := 0
for i := 0; i < 10; i++ {
    counter++
    detached := context.WithoutCancel(parent)
    go func() {
        recordVisit(detached, counter) // <-- captured by reference
    }()
}
```

Pre-Go 1.22, all 10 goroutines see `counter == 10`. Even with the per-iteration loop variable fix, this is the *same* bug as the captured-loop-variable, just one level deeper because of the detach distraction.

The fix: pass `counter` (or `i`) as a parameter:

```go
for i := 0; i < 10; i++ {
    counter++
    n := counter // local copy
    detached := context.WithoutCancel(parent)
    go func() {
        recordVisit(detached, n)
    }()
}
```

`WithoutCancel` does nothing to fix the goroutine-closure bug. Both fixes are still needed.

---

## Conclusion to Middle Level

At middle level, partial cancellation is no longer a single API call. It is a discipline: thinking about lifetime, composing primitives, bounding work, recovering from failure, tracking for shutdown.

You have learned:

- Scoped contexts and how they differ from detached contexts.
- The four-way decision matrix for context derivations.
- Mixed errgroup and detached fan-outs.
- The interaction with singleflight, sync.Once, caches, and pipelines.
- Twelve named patterns you can spot in code reviews.
- Capacity planning for detached pools.
- Subtle bugs and how to avoid them.

The senior file moves to architecture: the role of partial cancellation in graceful shutdown, observability, and production-grade service design.

Before moving on, build the 12-step exercise from earlier. The mechanics matter; the intuition follows the mechanics.

---

## Practical Studies

### Study 1: Migrating an Audit System

A team had been calling `auditLog(ctx, event)` synchronously in their handlers. p99 latency was 250ms, of which 80ms was audit logging. The product team wanted p99 < 200ms.

The team's first instinct: spawn the audit in a goroutine.

```go
// Before:
auditLog(ctx, event)
return resp

// After:
go auditLog(ctx, event)
return resp
```

p99 dropped to 170ms — but the audit failure rate jumped from 0.02% to 4%. Investigation showed that the audit goroutines were being cancelled mid-write when the response closed the connection.

The fix:

```go
go auditLog(context.WithoutCancel(ctx), event)
```

p99 stayed at 170ms; audit failure rate dropped back to 0.02%.

Lessons:

- The synchronous version was implicitly "ride on the request's lifetime." Moving to a goroutine without adjusting the context broke that assumption.
- The cost of `WithoutCancel` is negligible compared to the cost of the audit write.
- The latency improvement (80ms) and the correctness fix (audit failure rate) are independent — you must do both.

### Study 2: Migrating a Notification System

A notifications service sent webhooks synchronously after every order. p99 latency was 600ms, dominated by the webhook (300ms p99).

The team moved webhooks to a queue (`writeToQueue(ctx, webhook)`) and processed them asynchronously. The queue write was 5ms; the webhook delivery moved to a background worker.

But: the queue write used the request context. If the client disconnected, the queue write failed. Webhooks were lost on disconnect.

The fix:

```go
go func() {
    detached := context.WithoutCancel(ctx)
    detached, cancel := context.WithTimeout(detached, 2*time.Second)
    defer cancel()
    _ = writeToQueue(detached, webhook)
}()
```

Or, better, route through a detached pool with retry.

Lessons:

- Even a "fast" operation like a queue write can fail if the context is cancelled at the wrong moment.
- `WithoutCancel` is not only for slow operations; it is for *any* operation that should outlive the request.

### Study 3: A Pipeline That Lost Items

A data pipeline read items from Kafka, processed them, and wrote to a database. Cancellation of the pipeline's context was supposed to gracefully drain in-flight items.

The team noticed that on shutdown, some in-flight items were lost. Investigation showed:

- The pipeline's context was cancelled.
- The processing goroutines saw the cancellation and tried to gracefully drain.
- The database write used the same context. The write was cancelled mid-statement. Items were lost.

The fix: the database write step used a detached context with its own timeout.

```go
func writeItem(parent context.Context, item Item) error {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    return db.Insert(ctx, item)
}
```

On shutdown, the pipeline stopped pulling new items, but in-flight writes completed within their own deadlines.

Lessons:

- Cancellation should propagate where you *want* it, not everywhere.
- Detached operations are a natural fit for "completing in-flight work" during shutdown.

---

## A Long Word on `context.AfterFunc`

`context.AfterFunc` was added alongside `WithoutCancel` in Go 1.21. Its signature:

```go
func AfterFunc(ctx context.Context, f func()) (stop func() bool)
```

It registers `f` to be called in its own goroutine when `ctx` is cancelled. The returned `stop` function cancels the registration; it returns `true` if the registration was cancelled before `f` ran.

How does it interact with `WithoutCancel`?

### Scenario 1: `AfterFunc` on a detached context

```go
detached := context.WithoutCancel(parent)
context.AfterFunc(detached, func() { fmt.Println("never") })
```

`f` never runs, because `detached` is never cancelled. The registration is leaked unless you call `stop()`.

This is a *bug* in nearly every case. Why would you register a callback that you know will never fire?

### Scenario 2: `AfterFunc` on a layered timeout

```go
detached := context.WithoutCancel(parent)
ctx, _ := context.WithTimeout(detached, 5*time.Second)
context.AfterFunc(ctx, func() { fmt.Println("timed out") })
```

`f` runs when the 5-second timeout fires. Useful for "log when this operation times out."

### Scenario 3: `AfterFunc` for cleanup on parent cancellation

```go
context.AfterFunc(parent, func() {
    detached := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(detached, 10*time.Second)
    defer cancel()
    cleanup(ctx)
})
```

When the parent is cancelled, `f` fires. Inside `f`, we detach (so the cleanup is not affected by the parent's cancellation) and time-bound the cleanup. This is the "run cleanup on cancellation" pattern.

### Pattern: Bracketing cleanup

```go
func WithCleanup(parent context.Context, cleanup func(context.Context)) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancel(parent)
    stop := context.AfterFunc(ctx, func() {
        detached := context.WithoutCancel(parent)
        c, cancel := context.WithTimeout(detached, 10*time.Second)
        defer cancel()
        cleanup(c)
    })
    return ctx, func() {
        stop()
        cancel()
    }
}
```

Caller uses it like:

```go
ctx, cancel := WithCleanup(parent, runFinalizer)
defer cancel()
// ... use ctx ...
```

When `cancel()` is called (or the parent is cancelled), `AfterFunc` fires, the cleanup runs with a detached and bounded context.

This is one of the rare patterns where `AfterFunc` and `WithoutCancel` work beautifully together.

---

## Performance Considerations

### Allocation cost of `WithoutCancel`

The `withoutCancelCtx` struct is small — one pointer to the parent. The cost is roughly the same as a `WithValue` allocation. Negligible.

### Allocation cost of `WithTimeout` on a detached context

`WithTimeout` allocates a `cancelCtx` plus a `timerCtx`. ~200 bytes. Plus the timer itself. Plus a goroutine for the timer callback (in older Go versions; modern versions multiplex timers).

This is more expensive than `WithoutCancel`, but still cheap. The dominant cost in any detached operation is the goroutine and the I/O it does.

### Goroutine cost

Spawning a goroutine is ~2 microseconds. The goroutine's stack starts at ~2 KB.

For a service doing 10,000 requests per second, each spawning 3 detached goroutines: 30,000 detached goroutines per second, or ~60 MB of stack. Fine on any modern server. But check it.

### Channel cost

The detached pool uses a channel. Channels are cheap (~96 bytes), but check the queue depth in production. A queue that constantly hits capacity is a signal of overload.

### Database connection cost

Detached operations often hold database connections. Each open connection has a fixed cost (memory in the database, file descriptor on the server). Bound the connection pool, not just the goroutine pool.

A common pattern: the worker pool has 100 workers; the database pool has 20 connections. The workers wait for connections. Effective concurrency is 20, not 100.

### Memory cost of preserved values

A detached context preserves all values from the parent. If those values include large structures (a deserialized response, a buffer), they stay in memory for as long as the detached goroutine runs.

For high-throughput services, this can become a real memory cost. The fix is to extract what you need at the detach point:

```go
type DetachedAudit struct {
    TraceID string
    UserID  string
    Order   *Order
}

func newDetachedAudit(parent context.Context, order *Order) *DetachedAudit {
    return &DetachedAudit{
        TraceID: traceIDFromCtx(parent),
        UserID:  userIDFromCtx(parent),
        Order:   order,
    }
}
```

The detached goroutine uses `DetachedAudit` instead of the full context. The parent's other values are dropped.

This is overkill for most services. Consider it for very high throughput.

---

## A Wider View: Partial Cancellation in Distributed Systems

Partial cancellation in a single process is simple compared to its distributed analogue. In a distributed system, you cannot cancel a downstream operation by closing a context — the downstream is a separate process. You can only *not* call it.

But the principle is the same. A user-facing service A makes a critical call to B and a best-effort call to C. If A's caller cancels, A wants:

- To abort the call to B (the call is still in flight; A signals abort via the HTTP connection close).
- To let C run to completion (A returns first; C's request is queued and processed by C later).

Translating to Go:

- A uses the request context for the call to B.
- A detaches and uses a detached context for the call to C.

If C is itself a long-running operation, A's call to C may not even wait for C's response. A enqueues a request to C's queue and returns. C's request lives in the queue independent of A's lifetime.

This is the *outbox pattern*: the side-effect is written to a durable buffer, and a separate worker processes it. Partial cancellation in the producing service becomes "write to the outbox and return"; the outbox is the lifetime boundary.

---

## Reading and Writing the Standard Patterns

By now you should be able to read this code in five seconds:

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })

detached := context.WithoutCancel(parent)
pool.Submit(detached, "log", time.Second, logVisit)

if err := g.Wait(); err != nil {
    return err
}
```

"Two parallel critical fetches, plus a best-effort log that does not participate in the errgroup's cancellation."

And this:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
v, err, _ := sf.Do("user:"+id, func() (any, error) {
    c := context.WithoutCancel(ctx)
    c, cancel := context.WithTimeout(c, 30*time.Second)
    defer cancel()
    return load(c, id)
})
```

"Singleflight-deduplicated load. The user-facing context has a 5-second budget. The actual load has a 30-second budget detached from the caller, so multiple callers share the result even if one cancels."

If you read these idiomatically, you have reached middle-level fluency.

---

## Closing Thought: Lifetime as a First-Class Design Concept

In most languages, lifetime is implicit. Go made it explicit with `context.Context`. Partial cancellation is the natural extension: explicit *partial* lifetime. You can now say in code "this operation has lifetime A; that one has lifetime B; the third has lifetime C," and the compiler and runtime help you keep them straight.

A few years from now, "every operation has a context" will be as basic to Go as "every error is a value." Partial cancellation will be how you express the more interesting parts of that contract.

---

## A Library Tour: How Real Codebases Use `WithoutCancel`

To consolidate, here is how four real Go libraries use partial cancellation.

### OpenTelemetry Go SDK

The OpenTelemetry SDK exports spans asynchronously. The span exporter receives spans from a buffer and ships them to a collector. The exporter's context is independent of the user request that produced the spans.

Internally, the SDK uses a process-lifetime context for the exporter. Spans are buffered and shipped on a timer. When the user's request ends, the spans have already been buffered and the request context is no longer needed.

The lesson: span export is the canonical "outlive the request" operation. OpenTelemetry uses a queue plus a worker, not detached-per-request goroutines.

### gRPC server interceptors

gRPC server interceptors can spawn detached cleanup after the call has been responded to. The pattern is similar to HTTP middleware: detach from the call context, time-bound the cleanup, recover panics.

### Sarama (Kafka client)

When producing messages, Sarama allows you to send asynchronously. Internally, Sarama uses worker goroutines that process messages independent of the caller's context. The caller's context is preserved as metadata but not as a lifetime signal.

### Resty / net/http clients

Most HTTP clients accept a `context.Context` for the call. If you want a fire-and-forget call:

```go
go func() {
    detached := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(detached, 10*time.Second)
    defer cancel()
    req, _ := http.NewRequestWithContext(ctx, "POST", url, body)
    _, _ = http.DefaultClient.Do(req)
}()
```

The HTTP call has its own timeout. The parent's lifetime does not affect it.

---

## A Pragmatic Summary

Here are the seven things you should walk away with at middle level:

1. `WithoutCancel` is for detaching lifetime; it preserves values.
2. Always pair detach with a bound.
3. Mix detach with errgroup carefully — detached siblings do not participate in errgroup cancellation.
4. Singleflight callers can affect each other's cancellation; detach inside the work function to fix.
5. Pipelines benefit from detached "drain" stages that complete in-flight work on shutdown.
6. A bounded detached pool is the production-grade abstraction.
7. Capacity-plan detached work: goroutines × duration × rate = steady-state load.

---

## A Pragmatic Anti-Summary

Here are the seven things you should *not* do:

1. Detach because "context errors are annoying."
2. Detach without a bound.
3. Detach without recovery.
4. Detach into an unbounded pool.
5. Detach work that should die with the request.
6. Detach inside middleware that wraps the entire request.
7. Forget to drain detached work at shutdown.

If any of these apply to code you wrote this week, refactor.

---

## Forward Pointer to Senior Material

The senior file covers:

- Detached work as an architectural building block.
- Integration with graceful shutdown protocols.
- Distributed tracing across the detach boundary.
- Supervisor patterns and their failure modes.
- Backpressure on detached pools.
- The relationship to structured concurrency proposals.
- The migration from "every handler spawns its own detached goroutines" to "the platform owns the detached layer."

The professional file goes into:

- The internals of `withoutCancelCtx` and `propagateCancel`.
- Why `Cause` is not propagated and what the implications are.
- The semantics of `AfterFunc` on cancelled, never-cancelled, and detached contexts.
- The relationship to `runtime.AddCleanup` and finalizers.
- Comparisons with cancellation primitives in other languages.

Read those after you have run the 12-step exercise. The patterns make more sense once you have built them yourself.

---

## A Reflective Closing

Partial cancellation is one of the topics where the difference between "knows the API" and "uses it well" is large. The API is one function call. Using it well requires thinking about lifetime, naming scopes, designing for failure, and instrumenting for observation.

At middle level, you should be able to:

- Look at any goroutine spawn and answer "what owns its lifetime?"
- Look at any context derivation and answer "what does it inherit?"
- Spot the four anti-patterns from this file in a code review.
- Write a detached-pool abstraction that handles bounded retry, recovery, logging, metrics, and drain.

If you can do all four, move on to senior. If you can do three of four, build the 12-step exercise. If you can do two of four, re-read the middle file from the top — the gap will close with focused practice.

The next time you are reviewing a PR that adds a goroutine, ask out loud: "what is this goroutine's lifetime?" Most of the time, the author has not thought about it. Helping them think about it is the most valuable code-review feedback you can give.

---

## A Worked Comparison: Three Pool Implementations

### Implementation A: Unbounded fire-and-forget

```go
type FireAndForgetPool struct{}

func (p *FireAndForgetPool) Submit(parent context.Context, fn func(context.Context) error) {
    ctx := context.WithoutCancel(parent)
    go func() {
        defer recover()
        _ = fn(ctx)
    }()
}
```

- Pro: trivial.
- Con: unbounded; no drain; no timeout; no metrics.
- Use: trivial scripts only. Never in production.

### Implementation B: Bounded with drain

```go
type DrainPool struct {
    work    chan func(context.Context)
    process context.Context
    wg      sync.WaitGroup
}

func (p *DrainPool) Submit(parent context.Context, timeout time.Duration, fn func(context.Context) error) bool {
    detached := context.WithoutCancel(parent)
    wrapped := func(_ context.Context) {
        ctx, cancel := context.WithTimeout(detached, timeout)
        defer cancel()
        defer recover()
        _ = fn(ctx)
    }
    select {
    case p.work <- wrapped:
        return true
    case <-p.process.Done():
        return false
    default:
        return false
    }
}
```

- Pro: bounded; drainable; per-task timeout.
- Con: requires more setup; rejects bursts.
- Use: production for non-critical detached work.

### Implementation C: Bounded with priority and DLQ

```go
type PriorityPool struct {
    high chan task
    low  chan task
    dlq  DLQ
    // ... more fields ...
}

func (p *PriorityPool) loop() {
    for {
        select {
        case t := <-p.high:
            p.do(t)
        default:
            select {
            case t := <-p.high:
                p.do(t)
            case t := <-p.low:
                p.do(t)
            }
        }
    }
}

func (p *PriorityPool) do(t task) {
    ctx, cancel := context.WithTimeout(context.WithoutCancel(t.parent), t.timeout)
    defer cancel()
    if err := t.fn(ctx); err != nil {
        p.dlq.Enqueue(t)
    }
}
```

- Pro: priority lanes; failure path; observability.
- Con: substantially more complex.
- Use: critical detached work in production.

The three implementations represent a spectrum from "smallest possible" to "production-grade." Pick the right level of sophistication for the problem.

---

## A Compact Glossary, Annotated

| Term | Brief |
|---|---|
| Detach | `WithoutCancel(parent)` |
| Bound | `WithTimeout(detached, d)` |
| Track | `wg.Add(1)` + `defer wg.Done()` |
| Recover | `defer recover()` |
| Drain | wait for `wg` on shutdown |
| Pool | bounded worker pool over a work channel |
| Supervisor | a long-running goroutine that orchestrates workers |
| Bridge | a goroutine that watches multiple cancellation signals |
| Funnel | many parents, one pool |
| Bulkhead | isolation of failure between detached subtrees |
| DLQ | dead-letter queue for permanently failed work |

Memorise these terms. They are the vocabulary of partial cancellation at middle level.

---

## Final Worked Mini-Project

Build a service that:

- Accepts orders via HTTP POST.
- Saves them to a database (synchronous, request-bound).
- Sends a Kafka event (detached, time-bound, retried up to 3 times).
- Writes an audit row (detached, time-bound, not retried).
- Refreshes a cache key (detached, time-bound).
- Sends a confirmation email (detached, time-bound, retried up to 5 times).
- Drains all detached work on shutdown with a 60-second budget.

Constraints:

- The total handler latency must be the latency of the database save only.
- All detached work must include the request's trace ID.
- All detached work must be bounded.
- All detached panics must be recovered.
- The pool must be bounded to 200 workers.

If you can write this service from scratch in under two hours, you have mastered middle-level partial cancellation. Save the result; it is a useful template.

