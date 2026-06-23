# Unlimited Goroutines — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is wrong with `for _, x := range xs { go f(x) }`? My program runs fine on small inputs."

A Go beginner learns three things almost in the same hour:

1. The `go` keyword spawns a goroutine.
2. Goroutines are cheap — millions can fit in memory.
3. Concurrency is fast.

Those three facts collide into one tempting pattern: any time the code has a slice and a function, "just `go` it." A loop over `xs` becomes a loop that spawns one goroutine per element. It feels like the right idiom — concurrent, parallel, fast. On tests with 10 items, it works.

On production with 10 million items it brings the service down.

This file is about the single most common production-grade concurrency mistake in Go code: **the unbounded fan-out**. Specifically:

```go
for _, x := range xs {
    go process(x)
}
```

There is no limit on how many goroutines this will create. The size of `xs` decides it. If `xs` comes from outside — from a network request, a database query, a queue message, a file the user uploaded — the *attacker* decides how many goroutines your service spawns. That is a denial-of-service vector.

After reading this file you will:

- Recognise the `for ... go ...` pattern on sight and react to it
- Understand why "goroutines are cheap" is a half-truth that does not justify infinite fan-out
- Know the three standard cures — worker pool, channel semaphore, `errgroup.SetLimit`
- Be able to refactor a small unbounded loop into a bounded one in under five minutes
- Understand the DoS framing and why this is a security issue, not just a performance issue
- Be ready for the middle-level deep dive into capacity planning and backpressure

You do not yet need to understand scheduler internals, the GMP model, or admission control. Those come later. This file is the first encounter — recognise the shape, learn the cure.

---

## Prerequisites

- **Required:** Comfort with goroutines and the `go` keyword. Read [01-goroutines/01-overview](../../01-goroutines/01-overview/) first.
- **Required:** Familiarity with channels, at least buffered and unbuffered. Read [02-channels](../../02-channels/) first.
- **Required:** Basic `sync.WaitGroup` for "wait for N goroutines to finish."
- **Helpful:** Awareness of `errgroup` from `golang.org/x/sync/errgroup`.
- **Helpful:** Some exposure to monitoring (a memory graph in Grafana or `pprof`).
- **Helpful:** Awareness of OS limits — open file descriptors, virtual memory, socket counts.

If you have written and run a small program that uses `go f()` and `wg.Wait()`, you are ready. The new ideas in this file are about *quantity* and *limits*, not new syntax.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Unbounded fan-out** | Spawning one goroutine per input item without a cap. The input size decides the goroutine count. |
| **Worker pool** | A fixed number of long-lived goroutines that consume jobs from a channel. The cap is set once. |
| **Semaphore** | A counter that limits how many holders can proceed at once. In Go, a buffered channel of size N, or `semaphore.Weighted`. |
| **`errgroup.SetLimit`** | A method on `errgroup.Group` (Go 1.20+) that limits how many `Go(func)` calls may run concurrently. The simplest bounded fan-out. |
| **Backpressure** | The signal — usually "block here until capacity frees up" — that prevents an upstream producer from outrunning a downstream consumer. |
| **Admission control** | Refusing or queueing new work when capacity is already used. A higher-level form of backpressure. |
| **DoS (Denial of Service)** | An attack or accident that makes a service unavailable by exhausting its resources. Unbounded fan-out is a DoS vector. |
| **OOM (Out of Memory)** | The kernel state where memory is exhausted; on Linux, the OOM killer terminates processes. The usual end-state of unbounded spawn. |
| **`runtime.NumGoroutine()`** | Returns the current number of running goroutines. The fastest way to detect a leak or unbounded spawn at runtime. |
| **Goroutine leak** | A goroutine that never exits. Related but distinct: unbounded fan-out spawns *too many*; a leak fails to *clean up*. |
| **`GOMEMLIMIT`** | Go 1.19+ environment variable; a soft cap on heap size. Does not save you from a flood of goroutine stacks. |
| **`GOMAXPROCS`** | Maximum OS threads that may execute Go code simultaneously. Does *not* limit goroutine count. |
| **Stack** | Each goroutine has its own stack, starting at ~2 KB and growing as needed. Millions of stacks add up. |
| **Refactor playbook** | A repeatable procedure to convert one unbounded loop into a bounded form, with metrics and tests. |

---

## Core Concepts

### The anti-pattern

This is the shape to recognise:

```go
func handle(items []Item) {
    for _, it := range items {
        go process(it)
    }
}
```

Five lines. No `WaitGroup`, no channel, no errgroup, no cap. It does three wrong things at once:

1. **No bound** — if `items` has a million entries, a million goroutines are spawned.
2. **No completion** — the caller does not wait, so errors and results are lost.
3. **No observability** — nothing reports how many are in flight.

The "no bound" part is the focus of this file. The other two are pre-conditions for unsafety: even if you fix them, an unbounded fan-out is still wrong.

A small variant looks safer but is not:

```go
var wg sync.WaitGroup
for _, it := range items {
    wg.Add(1)
    go func(it Item) {
        defer wg.Done()
        process(it)
    }(it)
}
wg.Wait()
```

The `WaitGroup` solves "completion." It does *not* solve "bound." The line `go func(...)` still spawns one goroutine per item.

### Why "goroutines are cheap" misleads beginners

The Go documentation and almost every tutorial says goroutines are cheap. They are: ~2 KB of stack, microseconds to spawn. So why is a million of them a problem?

Three reasons:

1. **Stacks compound.** 1 million goroutines × 2 KB minimum stack = 2 GB just for stacks. Many goroutines exceed 2 KB once they call into the standard library; 8 KB or 16 KB per goroutine is realistic.
2. **The work each goroutine does is rarely free.** If `process(it)` opens a database connection or makes an HTTP call, you now have a million connections to open. Your pool has 100 slots. The rest queue and time out.
3. **The scheduler and GC pay for every goroutine.** GC has to scan every live goroutine stack. With a million live, GC cycles get noticeably longer. The scheduler has to balance and steal across a million runnable Gs. The cost is not zero, even when goroutines are idle.

The textbook is right about *one* goroutine. It is wrong if you read it as "any quantity is cheap."

### What the program looks like at the system level

When a Go service unbounded-fan-outs on a 10-million-element input, an outside observer sees:

- Memory usage climbs from 200 MB to 30 GB in seconds.
- CPU usage stays *low* — the goroutines are mostly waiting on I/O or memory allocation.
- Downstream services (databases, HTTP backends) report timeouts, refused connections, queue overflow.
- Eventually the kernel OOM killer terminates the process. The service restarts. The first request after restart is the same input. The cycle repeats.

This is the textbook *brownout-then-crash* failure mode. It is hard to debug because the proximate cause (OOM) is far from the root cause (one `go` keyword in a loop).

### The DoS framing

If the input that drives the fan-out comes from a user — a request body, a query parameter, a queued message — then *the user controls how many goroutines your service spawns*. That is a denial-of-service vulnerability.

Concretely:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    var ids []string
    json.NewDecoder(r.Body).Decode(&ids)
    for _, id := range ids {
        go fetchAndStore(id)  // attacker decides len(ids)
    }
    w.WriteHeader(204)
}
```

A request with `ids = [1, 2, ..., 1_000_000]` spawns a million goroutines per HTTP request. A few such requests crash the service. No CVE will be filed because it is "your bug, not Go's bug," but the impact is identical to a vulnerability.

We will return to this in the Security Considerations section.

### The three standard cures

There are exactly three idiomatic ways to bound a fan-out in Go. Memorise all three.

**Cure 1 — Worker pool.** A fixed number of long-lived goroutines drain a channel of jobs:

```go
jobs := make(chan Item, 64)
var wg sync.WaitGroup
for i := 0; i < 8; i++ { // 8 workers
    wg.Add(1)
    go func() {
        defer wg.Done()
        for it := range jobs {
            process(it)
        }
    }()
}
for _, it := range items {
    jobs <- it
}
close(jobs)
wg.Wait()
```

**Cure 2 — Channel as semaphore.** Spawn a goroutine per item, but block until a slot frees:

```go
sem := make(chan struct{}, 8) // capacity 8
var wg sync.WaitGroup
for _, it := range items {
    wg.Add(1)
    sem <- struct{}{} // acquire (blocks at 8)
    go func(it Item) {
        defer wg.Done()
        defer func() { <-sem }() // release
        process(it)
    }(it)
}
wg.Wait()
```

**Cure 3 — `errgroup.SetLimit`.** Shortest in Go 1.20+:

```go
import "golang.org/x/sync/errgroup"

g := new(errgroup.Group)
g.SetLimit(8)
for _, it := range items {
    it := it // safe even on Go 1.22+; explicit and clear
    g.Go(func() error {
        return process(it)
    })
}
if err := g.Wait(); err != nil {
    log.Print(err)
}
```

Each cure has trade-offs (covered in middle.md), but any of the three is acceptable. *No cure* is not.

---

## Real-World Analogies

### The buffet line

A buffet has 50 dishes. Each customer can grab one plate and serve themselves. Now imagine each customer also brings 100 friends — and each friend grabs a plate the moment they arrive. Within seconds the line collapses, the kitchen runs out, and nobody eats. The cure is not "more plates"; it is a host who lets only N people into the line at a time.

Unbounded fan-out is the un-hosted buffet.

### The hospital triage

When 50 patients arrive at once, a triage nurse decides who goes in now, who waits, and who is sent home. A hospital without triage — every patient walked directly into a room — would run out of rooms and doctors instantly. Worker pools are triage; the channel is the waiting room.

### Calling 100 plumbers at once

Your pipe is leaking. You think: "I will call every plumber in the city. Surely one will arrive." Now 100 plumbers show up at your door simultaneously, charging trip fees. You had wanted *one*. Spawning 1000 goroutines to call an external API is the same thing — the downstream sees 1000 simultaneous calls and either refuses or melts.

### The water-park slide

A slide accepts one rider every 2 seconds. The line forms. If the lifeguard let 50 people on the slide every 2 seconds, they would pile up at the bottom and someone would drown. Goroutines are the riders; the slide is the downstream service. The lifeguard is your semaphore.

---

## Mental Models

### "Concurrency is a tap, not a fire hose"

You are filling a bucket from a tap. The bucket has a hole at the bottom (the downstream service). If the tap pours faster than the hole drains, the bucket overflows. The tap is your `for ... go ...` loop. The hole is the rate at which the downstream can absorb work. A semaphore turns the fire hose back into a tap.

### "The goroutine count is a budget, not a feature"

When you write `go f()`, mentally subtract one from a budget. The budget is finite — bounded by memory, by downstream capacity, by file descriptors. A bounded loop respects the budget; an unbounded loop pretends the budget is infinite.

### "The input is hostile"

Assume every list you iterate came from an attacker. If you would not spawn a million goroutines for a friendly request, you must not spawn them for a hostile one. The size of the input is a parameter under attacker control. Concurrency must be a parameter under *your* control.

### "Backpressure flows upstream"

A bounded fan-out propagates "I am full" backwards: the worker pool's channel fills, the producer blocks, the producer's own caller eventually feels it. An unbounded fan-out swallows backpressure: the producer cannot tell that work is piling up. By the time you notice, the program is already in the failure mode.

---

## Pros & Cons

### Pros of the anti-pattern (why it tempts)

| Pro | Reality |
|-----|---------|
| Short code | Three lines vs. ten for a bounded pool |
| Looks "Go-idiomatic" | It is not — Go idioms include bounds |
| Works on small inputs | Until production has a 100x input |
| Maximum theoretical parallelism | Real parallelism is bounded by cores, not goroutines |

### Cons of the anti-pattern

| Con | Severity |
|-----|---------|
| Memory exhaustion → OOM | Critical — service dies |
| Downstream overload → cascading failures | Critical — neighbouring services dies |
| No observability of in-flight work | High — debugging is painful |
| DoS vector when input is untrusted | Critical — security incident |
| GC pressure from many stacks | High — latency spikes |
| Scheduler overhead | Medium — visible at scale |
| Burns the user's trust | High — repeat incidents end careers |

There is no scenario where "unbounded fan-out" wins over "bounded fan-out with a generous cap." The cap can be very large. It just cannot be infinite.

---

## Use Cases

When you see code that *seems* to require unbounded fan-out, the answer is almost always a *bounded* fan-out with the right cap.

| You think you need… | You actually want… |
|-----|-----|
| Parallel HTTP fetches over N URLs | Worker pool of 16–64 workers |
| Process every row of a million-row DB result | Bounded errgroup with 8–16 limit |
| Spawn a goroutine per WebSocket connection | One per connection is acceptable *if you cap connection count at the listener* |
| Process every line of a log file | Worker pool; stream the file, do not load it |
| Fan-out per item in a queue message | Bounded pool sized to downstream capacity |
| Run N independent computations in parallel | Bounded pool of `runtime.NumCPU()` |
| Send notifications to every user | Bounded pool with backpressure |
| Crawl every URL on a website | Bounded crawler with a queue and a worker pool |

The "one per connection" case deserves a footnote: it is acceptable because the *listener* already bounds the connection count, either through OS file descriptor limits or explicit `net/http.Server.MaxConn` configuration. The cap is enforced earlier in the pipeline.

---

## Code Examples

### Example 1 — The anti-pattern in its purest form

```go
package main

import (
    "fmt"
    "time"
)

func process(id int) {
    time.Sleep(100 * time.Millisecond)
    fmt.Println("done", id)
}

func main() {
    for i := 0; i < 100_000; i++ {
        go process(i) // unbounded
    }
    time.Sleep(2 * time.Second)
}
```

Run this; observe memory grow to several hundred MB. Bump the loop bound to 10_000_000 and watch the process die.

### Example 2 — The simplest fix: `errgroup.SetLimit`

```go
package main

import (
    "fmt"
    "time"

    "golang.org/x/sync/errgroup"
)

func process(id int) error {
    time.Sleep(100 * time.Millisecond)
    fmt.Println("done", id)
    return nil
}

func main() {
    g := new(errgroup.Group)
    g.SetLimit(16)
    for i := 0; i < 100_000; i++ {
        i := i
        g.Go(func() error { return process(i) })
    }
    _ = g.Wait()
}
```

Memory stays flat. Throughput is throttled by the limit, which is what we want.

### Example 3 — Worker pool, the explicit form

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type job struct{ id int }

func worker(id int, jobs <-chan job, wg *sync.WaitGroup) {
    defer wg.Done()
    for j := range jobs {
        time.Sleep(100 * time.Millisecond)
        fmt.Println("worker", id, "did", j.id)
    }
}

func main() {
    const workers = 8
    jobs := make(chan job, 64)
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go worker(w, jobs, &wg)
    }
    for i := 0; i < 1000; i++ {
        jobs <- job{id: i}
    }
    close(jobs)
    wg.Wait()
}
```

### Example 4 — Channel-as-semaphore form

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    const max = 8
    sem := make(chan struct{}, max)
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        i := i
        wg.Add(1)
        sem <- struct{}{}
        go func() {
            defer wg.Done()
            defer func() { <-sem }()
            time.Sleep(100 * time.Millisecond)
            fmt.Println("done", i)
        }()
    }
    wg.Wait()
}
```

### Example 5 — Context-aware bounded fan-out

```go
package main

import (
    "context"
    "fmt"
    "time"

    "golang.org/x/sync/errgroup"
)

func process(ctx context.Context, id int) error {
    select {
    case <-time.After(100 * time.Millisecond):
        fmt.Println("done", id)
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(16)
    for i := 0; i < 1000; i++ {
        i := i
        g.Go(func() error { return process(ctx, i) })
    }
    if err := g.Wait(); err != nil {
        fmt.Println("error:", err)
    }
}
```

When the deadline hits, in-flight work is signalled to stop and remaining work is not started.

### Example 6 — Refactor playbook applied

Before:

```go
func sendNotifications(users []User) {
    for _, u := range users {
        go sendEmail(u)
    }
}
```

After (minimal change):

```go
func sendNotifications(ctx context.Context, users []User) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(32)
    for _, u := range users {
        u := u
        g.Go(func() error { return sendEmail(ctx, u) })
    }
    return g.Wait()
}
```

Three things changed: bound (`SetLimit(32)`), error propagation (`error` return), context (deadline + cancellation). All three are non-negotiable in production code.

---

## Coding Patterns

### Pattern: Fan-out + Fan-in (bounded)

```go
func crawl(ctx context.Context, urls []string) ([]Result, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(16)

    results := make([]Result, len(urls))
    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            r, err := fetch(ctx, u)
            if err != nil {
                return err
            }
            results[i] = r // index-safe; no shared writes to same slot
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

Writing to distinct indices of a pre-sized slice is data-race-free without a mutex. This is a common, safe pattern.

### Pattern: Streaming pool (producer + workers)

```go
func process(ctx context.Context, in <-chan Item) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(8)
    for it := range in {
        it := it
        g.Go(func() error {
            return handle(ctx, it)
        })
    }
    return g.Wait()
}
```

If `in` is itself bounded (a buffered channel from a producer), this entire pipeline has bounded memory.

### Pattern: Pre-allocated worker pool with explicit lifetime

```go
type Pool struct {
    jobs chan Job
    wg   sync.WaitGroup
}

func NewPool(workers, queue int, handler func(Job)) *Pool {
    p := &Pool{jobs: make(chan Job, queue)}
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for j := range p.jobs {
                handler(j)
            }
        }()
    }
    return p
}

func (p *Pool) Submit(j Job) { p.jobs <- j }

func (p *Pool) Close() {
    close(p.jobs)
    p.wg.Wait()
}
```

Use this when the pool's lifetime is longer than a single request — for example, a background batch processor.

### Pattern: Reject when full

```go
type Pool struct {
    jobs chan Job
}

func (p *Pool) TrySubmit(j Job) bool {
    select {
    case p.jobs <- j:
        return true
    default:
        return false
    }
}
```

`TrySubmit` returns `false` instead of blocking. The caller can then reject the request, count a metric, or fall back. This is admission control at the pool boundary.

---

## Clean Code

- Name the cap. A magic `64` in code is a code smell. Use `const maxConcurrency = 64` or `cfg.Concurrency`.
- Make the limit a function parameter or configuration. Hard-coded limits become wrong as the system grows.
- Always pair a fan-out with a `Wait` (or `g.Wait()`). If the caller does not wait, it cannot observe completion or errors.
- Always pair a fan-out with a `context.Context`. Without one, the work cannot be cancelled.
- Keep the goroutine body small — call one function. Cluttered goroutine bodies invite bugs.
- Capture loop variables explicitly until Go 1.22 is your minimum:
  ```go
  for _, x := range xs {
      x := x // explicit; harmless even on Go 1.22+
      g.Go(func() error { return f(x) })
  }
  ```

---

## Product Use / Feature

### Where this matters in a real product

- **Search**. A search request fans out to 8 shards. The cap is the shard count; this is bounded by design. But when a user query "expands" into 10,000 candidate fetches, an unbounded fan-out brings the cluster down.
- **Notifications**. "Send to all subscribers" can be 100 or 10 million. The pool size must be tuned per channel (email, SMS, push) because the downstream rate limits differ.
- **Crawlers**. A web crawler that follows every link unbounded eats memory and gets rate-limited or banned by the target. Bounded crawlers with politeness queues are the norm.
- **Data ingestion**. A Kafka consumer that spawns a goroutine per message ingests faster than it can process and falls behind unboundedly. The bound here is the worker count; the consumer should commit only when the worker pool accepts the message.
- **HTTP gateways**. A reverse proxy that fans out to multiple backends must cap the fan-out, especially when backends share resources.

The pattern is the same: identify the slowest downstream, size the cap to its capacity, propagate backpressure upstream.

---

## Error Handling

### Why unbounded fan-out destroys error handling

In `for _, x := range xs { go f(x) }` there is no way to surface errors. Goroutines panic or return; the caller cannot know which succeeded and which failed. Even when results matter, the loop discards them.

Fix: every fan-out should propagate errors. `errgroup` does this; manual pools must do it explicitly:

```go
results := make([]result, len(items))
errs := make([]error, len(items))
var wg sync.WaitGroup
sem := make(chan struct{}, 16)
for i, it := range items {
    i, it := i, it
    wg.Add(1)
    sem <- struct{}{}
    go func() {
        defer wg.Done()
        defer func() { <-sem }()
        results[i], errs[i] = process(it)
    }()
}
wg.Wait()
for _, err := range errs {
    if err != nil {
        log.Print(err)
    }
}
```

### Panic handling inside a worker

A panic in any goroutine kills the whole program unless recovered. Workers in a pool should `recover` to avoid taking the program down for one bad input:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v", r)
        }
    }()
    handle(j)
}()
```

The pool should also log and continue, not abort. `errgroup` does not recover panics for you — you must add the defer yourself.

### Fail-fast vs. fail-slow

`errgroup.WithContext` is fail-fast: the first error cancels remaining work. A plain `sync.WaitGroup` with per-task errors is fail-slow: every task runs to completion. Choose based on the use case. Ingestion pipelines usually prefer fail-slow (one bad record should not abort a batch). API request handlers prefer fail-fast (one bad shard kills the request).

---

## Security Considerations

### Unbounded fan-out is a DoS vector

State this in your team's threat model: any code path where the input controls the goroutine count is a denial-of-service vulnerability. The attacker submits a request that turns one network operation into a million internal operations. Resource exhaustion follows.

The threat model is:

| Attacker action | Service effect |
|---|---|
| POST a JSON array of 10 million IDs | Service spawns 10 million goroutines, OOM-kills |
| Send 100 such requests concurrently | Service crashes before first one finishes |
| Repeat after restart | Service oscillates between healthy and dead; users see brownouts |

Concrete real-world classes:

- **Batch endpoints.** Any "process this batch" API where the batch size is not capped.
- **Webhook fan-out.** A webhook delivery system that spawns one goroutine per subscriber: a tenant with 1 million subscribers DoSes their own queue.
- **GraphQL resolvers.** A nested resolver that fires one goroutine per child can be exploited by a deeply nested query.
- **File processors.** Upload a CSV with 10 million rows; the parser spawns one goroutine per row.
- **Pub/Sub consumers.** Spawn one goroutine per delivered message without bound → if the broker delivers a backlog of 1 million messages, the consumer dies.

### The defence

1. **Cap the input at the boundary.** Refuse requests with batch size > N at the validation layer.
2. **Bound every fan-out.** Every `go` in a loop has a worker pool, semaphore, or `SetLimit`.
3. **Measure goroutine count.** Export `runtime.NumGoroutine()` as a metric; alert when it exceeds a threshold.
4. **Rate-limit the boundary.** Even with bounded fan-out, request floods can overwhelm. Combine with a request rate limiter.
5. **Apply per-tenant limits.** Otherwise one noisy tenant uses the whole cap and starves others.
6. **Memory limits.** Set `GOMEMLIMIT` and document container memory limits. The OOM killer is a last resort, but you want it to fire on your terms.

### Anti-pattern in security audits

When auditing a Go service, grep the codebase for these:

```
go func(
go process(
go .*Async(
```

Examine every match. For each, ask: "What bounds the number of times this is called?" If the answer is "the input length," and the input can come from untrusted sources, you have found a DoS vector.

### Real-world incident shape (anonymised)

- **Incident A.** A payments service ran nightly reconciliation. The job spawned a goroutine per pending transaction. Normally ~50,000 transactions per night. After a system upgrade caused a backlog, the pending list grew to ~3 million. The reconciliation job OOM-killed every retry. Database open-connection count saturated; downstream services went unreachable. Resolution: bounded pool with `SetLimit(32)`. Backlog cleared in 6 hours of steady processing.

- **Incident B.** An API endpoint accepted "send notification to users" with a list of user IDs. A bug in an upstream caller passed the full user table (~8 million IDs). The service spawned 8 million goroutines, each opening a connection to the email service. The email service refused. The Go service held the connection attempts in flight, hit ~25 GB memory, and was OOM-killed. Resolution: cap batch size to 1000 at the validator, bounded pool internally.

- **Incident C.** A WebSocket server spawned one goroutine per outbound message per connected client. During a broadcast to 200,000 clients of a 1 MB payload, the server briefly held 200,000 goroutines × 1 MB buffered = ~200 GB of intent. The kernel OOM-killed long before the heap stabilised. Resolution: per-client send queue with bounded capacity; broadcast publishes once into a fan-out gate.

The shape repeats: input-controlled fan-out → resource exhaustion → process death.

---

## Performance Tips

- **A bounded pool is faster than unbounded fan-out at scale**, because it avoids the GC/scheduler overhead of carrying millions of in-flight goroutines.
- **Pick the cap from measurement, not from "feels right".** Typical starting points: CPU-bound work → `runtime.NumCPU()`; I/O-bound work → 10–100× CPUs; downstream-bound work → match downstream concurrency limit.
- **Reuse goroutines** via a long-lived pool when work arrives continuously. Spawning is cheap but not free, and warm pools reduce GC pressure.
- **Avoid creating buffered channels larger than needed.** A 1 GB buffered channel is just a slow OOM.
- **Measure `pprof goroutine`** before and after bounding. Expect a dramatic drop.
- **Profile heap allocations**, not just goroutine count. A bounded pool that allocates large objects per job can still OOM.

---

## Best Practices

1. **Default to `errgroup.SetLimit(N)`.** It is the shortest correct form.
2. **Make N configurable.** Today's `16` is tomorrow's `64`. Hard-coded limits are tech debt.
3. **Wrap every fan-out with `context.Context`.** Cancellation propagates through `errgroup.WithContext`.
4. **Cap the input as early as possible.** Even bounded internal pools should be paired with input validation.
5. **Add a `runtime.NumGoroutine()` gauge** to your metrics. Alert on growth or absolute thresholds.
6. **Recover panics in every worker.** One bad input must not kill the pool.
7. **Document the cap.** A comment near `SetLimit(16)` saying "downstream supports 32 concurrent connections" survives the next refactor.
8. **Reject when overloaded** at the entry boundary, rather than queueing unbounded work.
9. **Test with adversarial input sizes.** Unit tests with 10 items hide the bug; tests with 10 million expose it.
10. **Treat untrusted input length as a security parameter.** Validate, cap, and reject.

---

## Edge Cases & Pitfalls

### Pitfall: the loop variable that "isn't a loop variable"

```go
ids := []int{1, 2, 3}
go func() { fmt.Println(ids) }() // OK; ids is captured by reference but not mutated
```

versus

```go
for _, id := range ids {
    go func() { fmt.Println(id) }() // BAD on Go <1.22
}
```

The fix is the explicit shadow (`id := id`) or upgrading to Go 1.22. We covered this in [01-goroutines/06-common-pitfalls](../../01-goroutines/06-common-pitfalls/).

### Pitfall: "the input is always small" famous last words

The first version of the code was tested on 10-element inputs. Six months later, a new caller passes 10,000. A year later, a queue backlog feeds 1,000,000 in one batch. By then nobody remembers the assumption.

Code the cap. Even if it is huge.

### Pitfall: the channel that "should" buffer everything

```go
jobs := make(chan Job, len(items))
for _, it := range items {
    jobs <- it
}
```

This *looks* like a fix (the channel is buffered, no goroutine spawn). It is not — the channel itself now holds `len(items)` jobs in memory, which can OOM the program. Buffering is a tool for smoothing, not a substitute for bounding.

### Pitfall: nested fan-outs multiply

```go
for _, tenant := range tenants { // bounded to 32 by SetLimit
    g.Go(func() error {
        sub := errgroup.Group{}
        sub.SetLimit(32) // tenant-local
        for _, user := range tenant.Users {
            sub.Go(...) // up to 32 per tenant × 32 tenants = 1024 total
        }
        return sub.Wait()
    })
}
```

The total concurrency is the product, not the sum. Cap the inner pool based on the outer cap, or share a single semaphore across all tenants.

### Pitfall: forgetting to close the channel

A worker pool that uses `for j := range jobs` will leak if the producer never `close(jobs)`s. The workers wait forever; the program never exits. Always close producer-side channels.

---

## Common Mistakes

### Mistake 1 — Adding `WaitGroup` without bounding

```go
var wg sync.WaitGroup
for _, x := range xs {
    wg.Add(1)
    go func(x X) {
        defer wg.Done()
        process(x)
    }(x)
}
wg.Wait()
```

`WaitGroup` fixes "wait for completion." It does **not** fix "limit concurrency." Both are needed.

### Mistake 2 — Capping after spawn, not before

```go
sem := make(chan struct{}, 8)
var wg sync.WaitGroup
for _, x := range xs {
    wg.Add(1)
    go func(x X) {           // spawn first
        defer wg.Done()
        sem <- struct{}{}    // wait after spawn
        defer func() { <-sem }()
        process(x)
    }(x)
}
wg.Wait()
```

This still spawns a million goroutines if `len(xs)` is a million. They just sleep on the semaphore. The stacks alone exhaust memory. Acquire the semaphore *before* `go`:

```go
sem <- struct{}{}        // acquire first
wg.Add(1)
go func(x X) {
    defer wg.Done()
    defer func() { <-sem }()
    process(x)
}(x)
```

### Mistake 3 — Using `select` with default to "skip if busy"

```go
select {
case sem <- struct{}{}:
    go process(x)
default:
    // dropped!
}
```

This silently drops work and never tells anybody. If you want to drop, log and count it.

### Mistake 4 — Hard-coding the cap

```go
g.SetLimit(16)
```

Why 16? Three years from now, on faster hardware, with a bigger downstream pool, you want 64. Pull from config.

### Mistake 5 — Using one global pool for everything

A single 16-goroutine pool serving "fast cache lookups" and "slow PDF renders" starves the cache when a render is in flight. Separate pools per workload class.

### Mistake 6 — Ignoring goroutine count in metrics

You cannot fix what you cannot see. Add a `runtime.NumGoroutine()` gauge on day one.

---

## Common Misconceptions

### "Goroutines are free, so spawning a lot is fine."

They are cheap individually. They are not free in aggregate. Memory, GC, scheduler, and downstream consequences scale with count.

### "The Go scheduler handles it."

The scheduler schedules; it does not refuse to schedule. It will happily multiplex a million goroutines onto your eight cores; the cores cannot help that the goroutines collectively want too much memory.

### "If I close the goroutine quickly, it does not count."

Even short-lived goroutines pay a cost. Spawning a million of them in a tight loop is not free.

### "Buffered channels solve everything."

A buffered channel of capacity 1,000,000 *is* an OOM vector. It just spawned no goroutines; it has 1,000,000 items in memory instead.

### "If I do not see OOM in dev, I am fine."

Dev usually feeds small inputs. Production feeds the long tail. Test with adversarially large inputs.

### "errgroup is for error handling, not for limits."

Since Go 1.20, `errgroup.SetLimit(N)` is the canonical bounded fan-out. Use it.

---

## Tricky Points

### Trick: the input feels bounded but is not

```go
for _, batch := range batches { // looks small
    for _, item := range batch.Items { // is huge
        go process(item)
    }
}
```

The outer loop is bounded; the inner is not. The product of the two determines concurrency.

### Trick: the recursive fan-out

```go
func walk(node *Node) {
    for _, child := range node.Children {
        go walk(child) // exponential
    }
}
```

If each node has 10 children and the tree has 20 levels, this spawns 10^20 goroutines. The fix is a worker pool over a queue of nodes, not recursion with `go`.

### Trick: the timer fan-out

```go
for {
    select {
    case <-ticker.C:
        for _, w := range work {
            go process(w)
        }
    }
}
```

Each tick spawns a wave. If processing takes longer than the tick interval, waves accumulate. The cure is a single bounded pool that drains continuously, with the ticker dropping work when full.

### Trick: the helper that "just happens to spawn"

```go
func ProcessUser(u User) {
    go logIt(u)        // helper "just spawns one"
    go notifyIt(u)     // and another
    go indexIt(u)      // and another
}
```

Each call spawns three. A loop over a million users spawns 3 million. The "just one" pattern compounds.

---

## Test

### Test 1 — Verify the cap

Write a test that asserts at most N goroutines are in flight at once:

```go
func TestBoundedFanOut(t *testing.T) {
    var (
        cur  int32
        peak int32
    )
    work := func() {
        n := atomic.AddInt32(&cur, 1)
        for {
            p := atomic.LoadInt32(&peak)
            if n <= p || atomic.CompareAndSwapInt32(&peak, p, n) {
                break
            }
        }
        time.Sleep(10 * time.Millisecond)
        atomic.AddInt32(&cur, -1)
    }

    g := new(errgroup.Group)
    g.SetLimit(8)
    for i := 0; i < 200; i++ {
        g.Go(func() error { work(); return nil })
    }
    _ = g.Wait()

    if peak > 8 {
        t.Fatalf("expected <= 8 concurrent, got %d", peak)
    }
}
```

### Test 2 — Verify with a large input

Run the production code path with 1 million items in a benchmark; observe memory does not grow above a few hundred MB.

### Test 3 — Verify cancellation propagates

```go
func TestCancel(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(8)
    for i := 0; i < 100; i++ {
        i := i
        g.Go(func() error {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case <-time.After(5 * time.Second):
                t.Fatalf("worker %d did not cancel", i)
                return nil
            }
        })
    }
    time.AfterFunc(50*time.Millisecond, cancel)
    if err := g.Wait(); err == nil {
        t.Fatal("expected ctx error")
    }
}
```

---

## Tricky Questions

**Q1. The code below spawns 10 goroutines. Is it the anti-pattern?**

```go
for i := 0; i < 10; i++ {
    go log.Println("hello", i)
}
```

A. The bound is hard-coded (`10`), not input-driven. It is not the anti-pattern as defined here. It is still missing a `WaitGroup`/`errgroup` — the program exits before the prints — but the danger of unbounded fan-out is absent.

**Q2. I run `g.SetLimit(0)`. What happens?**

A. From Go 1.22, `SetLimit(0)` is rejected. On older versions, you may see surprising behaviour. Always pass `>= 1`.

**Q3. I want maximum concurrency. Should I `SetLimit(math.MaxInt32)`?**

A. No. That is unbounded with extra steps. Pick a finite cap based on measurement.

**Q4. The downstream has no documented concurrency limit. How do I pick N?**

A. Start with `runtime.NumCPU()`. Measure. Increase by 2× until throughput plateaus or downstream errors spike, then back off.

**Q5. My queue consumer reads one message at a time. Is fan-out needed?**

A. If processing is slow, yes — but cap it. Read N messages, dispatch to a bounded pool, ack after the pool accepts.

**Q6. Will the Go runtime ever refuse to spawn?**

A. Effectively no. There is no fixed cap. The runtime allocates a stack and adds it to the scheduler. The OS will refuse first (via mmap failure), but that means you have already passed the safe zone.

---

## Cheat Sheet

```
RECOGNISE:        for _, x := range xs { go f(x) }
                  any "go" inside a loop driven by external input
                  any "go" inside a recursive function

CURE 1 (shortest):
    g := new(errgroup.Group)
    g.SetLimit(N)
    for _, x := range xs { x := x; g.Go(func() error { return f(x) }) }
    g.Wait()

CURE 2 (semaphore):
    sem := make(chan struct{}, N)
    for _, x := range xs {
        x := x
        sem <- struct{}{}
        go func() { defer func() { <-sem }(); f(x) }()
    }

CURE 3 (worker pool):
    jobs := make(chan X, queueSize)
    for i := 0; i < N; i++ { go func() { for x := range jobs { f(x) } }() }
    for _, x := range xs { jobs <- x }
    close(jobs)

CAP SIZE:
    CPU-bound  : runtime.NumCPU()
    I/O-bound  : 10x–100x NumCPU
    Downstream : match downstream concurrency limit

ALWAYS:
    - bound every fan-out
    - propagate context
    - return errors
    - recover panics in workers
    - export runtime.NumGoroutine() as metric
    - cap input at the boundary
```

---

## Self-Assessment Checklist

- [ ] I can recognise unbounded fan-out on sight.
- [ ] I can convert any unbounded `for ... go` to a bounded form in five minutes.
- [ ] I know the three idiomatic cures and when to pick each.
- [ ] I understand why "goroutines are cheap" does not justify unlimited spawning.
- [ ] I can explain the DoS vector to a non-Go engineer.
- [ ] I have written a test that asserts the concurrency cap.
- [ ] I export `runtime.NumGoroutine()` from at least one service I maintain.
- [ ] I have at least one production code path where I added `SetLimit` to a previously unbounded loop.
- [ ] I know to cap input length at the validation layer.
- [ ] I never use `for ... go ...` on an input I do not control.

---

## Summary

The unbounded fan-out — `for _, x := range xs { go f(x) }` — is the most damaging concurrency mistake a Go service can make. The size of `xs` decides the goroutine count; when `xs` is large or attacker-controlled, the service exhausts memory, overwhelms its downstream, and dies. The cure is to bound every fan-out with one of three idiomatic forms: a worker pool, a channel semaphore, or `errgroup.SetLimit`. Treat the cap as a security parameter: configure it, measure it, and never rely on the goodwill of input data.

---

## What You Can Build

- A linter that flags `go` inside a `for ... := range ...` block without an enclosing `errgroup.SetLimit` or buffered-channel semaphore.
- A worker pool library with metrics (`pool_active`, `pool_queue_depth`, `pool_rejected_total`).
- A pre-commit hook that scans for `go ` inside loops and refuses to merge without an explanatory comment.
- A debugging tool that polls `runtime.NumGoroutine()` and dumps stack traces when it exceeds a threshold.
- A k6 / ab load-test harness that submits adversarial input sizes to expose unbounded patterns.

---

## Further Reading

- Go blog — "Pipelines and cancellation"
- `golang.org/x/sync/errgroup` documentation, especially `SetLimit`
- `golang.org/x/sync/semaphore` documentation
- Dave Cheney — "Practical Go: Real world advice for writing maintainable Go programs"
- Bryan C. Mills — "Rethinking Classical Concurrency Patterns" (GopherCon)
- OWASP — "Denial of Service Cheat Sheet"

---

## Related Topics

- [05-concurrency-patterns/02-fan-out](../../05-concurrency-patterns/02-fan-out/) — the bounded fan-out pattern in depth
- [06-errgroup-x-sync/02-semaphore](../../06-errgroup-x-sync/02-semaphore/) — `semaphore.Weighted`
- [07-goroutine-lifecycle-leaks](../../07-goroutine-lifecycle-leaks/) — what happens to leaked goroutines
- [14-performance-tuning](../../14-performance-tuning/) — measuring goroutine cost
- [25-famous-bugs-postmortems](../../25-famous-bugs-postmortems/) — real incidents

---

## Diagrams & Visual Aids

### Memory growth under unbounded vs. bounded fan-out

```
Memory
  │              ╱╲   ╱╲  (unbounded; sawtooth, climbs)
  │            ╱   ╲ ╱   ╲ ╱
  │          ╱     ╳      ╳     OOM
  │        ╱      ╱╲     ╱
  │      ╱    ───────────────── (bounded; flat)
  │    ╱
  └──────────────────────────────── time
```

### Backpressure flow

```
Producer ──▶ [bounded queue, cap N] ──▶ Pool (M workers) ──▶ Downstream
   │              full?                                          │
   ◀──────── block / reject ◀──── full? ◀──── overloaded? ◀──────
```

### Anti-pattern shape

```
for _, x := range xs {
        ↓
    go process(x)      ← one spawn per iteration; len(xs) controls count
}                      ← no Wait, no error, no bound
```

### Cure shape

```
g.SetLimit(N)          ← cap declared up-front
for _, x := range xs {
    x := x
    g.Go(func() error  ← submission blocks at N in-flight
        return process(x)
    )
}
g.Wait()               ← waits, propagates errors, cancels via context
```
