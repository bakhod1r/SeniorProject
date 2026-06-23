---
layout: default
title: Senior
parent: Fan-Out Within Pipeline
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/03-fan-out-within-pipeline/senior/
---

# Fan-Out Within a Pipeline Stage — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Architecture View](#architecture-view)
4. [Concurrency Budgets](#concurrency-budgets)
5. [Work-Stealing Topologies](#work-stealing-topologies)
6. [Ordered Windows](#ordered-windows)
7. [Backpressure as Coordination](#backpressure-as-coordination)
8. [Per-Key Fan-Out](#per-key-fan-out)
9. [Tail Latency in Fan-Out](#tail-latency-in-fan-out)
10. [Designing for Cancellation Domains](#designing-for-cancellation-domains)
11. [Failure Domains and Bulkheads](#failure-domains-and-bulkheads)
12. [Code Examples](#code-examples)
13. [Coding Patterns](#coding-patterns)
14. [Operational Concerns](#operational-concerns)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Tricky Points](#tricky-points)
20. [Test](#test)
21. [Tricky Questions](#tricky-questions)
22. [Cheat Sheet](#cheat-sheet)
23. [Self-Assessment Checklist](#self-assessment-checklist)
24. [Summary](#summary)
25. [Further Reading](#further-reading)
26. [Related Topics](#related-topics)
27. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "We have many pipelines, many stages, many concurrency knobs. How do we structure them so the system is operable, correct, and fast under realistic load?"

At the junior level you learned the canonical fan-out. At middle, you added ordering, cancellation, and error policy. At senior level, fan-out is no longer a single helper but a unit of architecture. Decisions you make about width, queueing, and failure isolation interact with other parts of the system. A misconfigured fan-out in stage B can starve stage A, exhaust a downstream service, or cause cascading goroutine leaks that manifest as memory growth hours later.

This file is about the architectural questions:

- How are concurrency budgets allocated across stages and across pipelines?
- When do you adopt work-stealing topologies (per-worker queues with stealing) versus the standard "shared channel" dispatch?
- How does fan-out interact with backpressure, especially across multiple stages?
- How do you implement per-key fan-out (ordered within a key, parallel across keys)?
- What is the relationship between fan-out width and tail latency? Why does increasing N sometimes make p99 worse?
- How do you isolate failure domains so one slow tenant does not poison the whole pipeline?
- How do cancellation domains (which context cancels what) shape the topology?

The reader of this file has built three or four production pipelines, has seen them break, and is now designing the next one with both eyes open.

---

## Prerequisites

- Comfortable with the junior and middle fan-out files.
- Experience operating a pipeline in production (or at least running one under load in staging).
- Familiarity with `pprof`, `runtime/trace`, and `metrics`/`prometheus`-style instrumentation.
- Understanding of `context.Context` lineage and inheritance.
- Has read on backpressure, bounded queues, and Little's law.

---

## Architecture View

### A pipeline is a directed graph of stages

Not just a linear chain. A real pipeline often has:

- A source stage that produces from disk, a database query, or a stream.
- Several transformation stages, some fanned out.
- A side-channel for metrics or audit logs.
- A sink that writes to a database, queue, or external API.
- A graceful shutdown coordinator that drains and flushes.

Drawing the graph is the senior's first move when faced with a slow or buggy pipeline. The graph reveals where channels exist, where goroutines live, where backpressure propagates, and where cancellation must reach.

```
source --> [fetch x N] --> [parse x M] --> [enrich x P] --> [write x Q] --> sink
              |
              v
           metrics
```

Each `[stage x N]` is a fanned-out stage. Each arrow is a channel. The widths N, M, P, Q are independently tunable. The metrics goroutine is a side branch.

### The width assignment problem

Given that the pipeline runs on a fixed machine with C cores, has D concurrent DB connections available, and is rate-limited by an external API at R req/s, how do you allocate widths?

The constraints:

- Sum of CPU-bound stages' widths ≤ C (often), unless stages are not simultaneously CPU-bound.
- Sum of DB-bound stages' widths ≤ D.
- Network-bound stage width × per-worker request rate ≤ R.

The objective: maximise throughput while keeping p95 latency under an SLO.

In practice the system is not balanced; some stages are 10x slower than others. The maximum throughput is the throughput of the most constrained stage. Widening unconstrained stages helps nothing.

### Two extreme topologies

**Extreme A: one shared channel, N workers.** The default. Easy to reason about. Optimal dispatch (whoever is free picks up next). Loses order. Single point of contention on the channel for very high QPS (millions/s).

**Extreme B: per-worker queues.** Each worker has its own input channel. A dispatcher routes by some key (round-robin, hash, affinity). Preserves order within a queue. Avoids contention. Can suffer head-of-line blocking.

Most real systems are between: a small number of shared-channel groups, or a per-key router with shared channels per key.

### The minimum mental graph for a fanned-out stage

Even for a single stage, the mental graph is:

```
in -> [N workers] -> out
            |
            +--- ctx (cancellation)
            +--- limiter (rate, concurrency)
            +--- metrics
            +--- errgroup or similar (errors)
            +--- backpressure (via channel send blocking)
```

Six concerns touch every stage. The unified pattern in this file is to thread each through the worker's outer loop as `select` cases or as captured dependencies. Reviewing existing fan-out code, ask: does the worker observe cancellation? Does it report metrics? Does it report errors? Does it respect a limiter? If any of these are missing, the stage is incomplete.

---

## Concurrency Budgets

### Why budgets matter

A pipeline has finite resources: CPU cores, DB connections, network sockets, external rate limits. Each fanned-out stage consumes some of these. Without budgets, stages compete and the slowest-to-back-off wins. The result is unpredictable: sometimes stage A starves, sometimes stage B, depending on load and scheduling.

A *concurrency budget* is an explicit allocation: "stage X may use up to K of resource R at a time". The mechanism is usually a semaphore or a bounded worker pool with a hard cap.

```go
type Budgets struct {
    CPU map[string]int // stage name -> max concurrent CPU-bound workers
    DB  map[string]int // stage name -> max concurrent DB operations
}
```

In code, a budget is enforced by:

- `errgroup.SetLimit(n)` for finite lists.
- A channel-based semaphore: `sem := make(chan struct{}, n); sem <- struct{}{}; ... <-sem`.
- `golang.org/x/sync/semaphore` for weighted budgets.

### Weighted semaphores for heterogeneous work

Some items cost more than others. A 1 KB document and a 50 MB document share a stage but should not count equally against a memory or CPU budget. `golang.org/x/sync/semaphore`:

```go
sem := semaphore.NewWeighted(int64(memBudget))
for j := range in {
    j := j
    weight := int64(j.Size)
    if err := sem.Acquire(ctx, weight); err != nil {
        return err
    }
    go func() {
        defer sem.Release(weight)
        process(j)
    }()
}
```

This lets you over-provision in worker count (lots of goroutines waiting on the semaphore) while still bounding the resource cost. Useful when item costs are highly variable.

### Hierarchical budgets

Budgets can nest:

```
Tenant A budget: 100 concurrent ops
  Stage 1 budget: 30
  Stage 2 budget: 50
  Stage 3 budget: 20
Tenant B budget: 50 concurrent ops
  ...
```

A worker takes a token from the tenant pool and a token from the stage pool. If either is empty, it waits. This is over-engineered for most systems but standard for multi-tenant SaaS pipelines.

### Avoiding budget exhaustion deadlock

Two stages share a resource pool. Stage A holds a token waiting for stage B. Stage B's tokens are all held by stage A waiting for B. Classic deadlock.

The fix: never hold a token while waiting for the same pool. Acquire-do-release within a single function. Don't span budget acquisition across stage boundaries. If two stages truly share a resource, model them as a single stage.

### Visibility: expose budgets in metrics

```go
metrics.budgetUsed.WithLabelValues("stage").Set(float64(used))
metrics.budgetLimit.WithLabelValues("stage").Set(float64(limit))
```

Alert when used/limit > 0.9 for any sustained period — that is your bottleneck stage. Tuning is most effective when you can see exactly which budget is saturated.

---

## Work-Stealing Topologies

### When the shared-channel pattern stops being enough

The default fan-out has every worker reading from one channel. At very high QPS (millions of items/s, microsecond-scale work), the channel itself becomes a contended hot spot. The Go runtime serialises channel sends and receives via internal locks; under heavy contention you see throughput plateau and CPU profile show time spent inside `chansend`/`chanrecv`.

The fix: give each worker its own input channel (a *local queue*) and add a *steal* mechanism: when a worker's queue is empty, it tries to steal from another worker's queue.

### A simple work-stealing fan-out

```go
type Worker[T any] struct {
    id    int
    queue chan T
    others []chan T
}

func (w *Worker[T]) run(out chan<- T, done <-chan struct{}) {
    for {
        select {
        case <-done:
            return
        case v := <-w.queue:
            out <- process(v)
        default:
            // try to steal
            for _, other := range w.others {
                select {
                case v := <-other:
                    out <- process(v)
                    goto nextIter
                default:
                }
            }
            // nothing to steal — block on own queue
            select {
            case <-done:
                return
            case v := <-w.queue:
                out <- process(v)
            }
        }
    nextIter:
    }
}
```

This is a sketch; production-grade work stealing (such as in the Go runtime) is much more subtle. The key idea: workers prefer their own queue, steal only when idle, and never block on a steal attempt.

### When to use work stealing

Almost never in a typical Go pipeline. The shared-channel default is fast enough up to hundreds of thousands of items/s. Work stealing pays off when:

- The work per item is sub-microsecond (parsing fixed-size records in tight loops).
- The pipeline runs on machines with many cores (32+).
- Profiles show channel contention as the bottleneck.

For most pipelines, the much easier optimisation is to *batch* items so each channel send carries N items, not one. Batching reduces channel traffic by N× without changing the dispatch model.

### Affinity vs balance

Per-worker queues raise the question of routing policy:

- **Round-robin:** simple, balanced, no affinity.
- **Hash by key:** items with the same key go to the same worker. Useful for stateful per-key processing.
- **Affinity:** the worker that produced an item also processes its next stage (data locality, CPU cache wins).
- **Least-loaded:** dispatcher picks the worker with the shortest queue.

Each policy has implementation cost and operational behaviour. Hash-by-key is the most common production choice when there is a natural key (user ID, session ID, partition).

---

## Ordered Windows

### Strict order vs windowed order

The middle level introduced sequence-number reorder. In practice, strict order is overkill for many use cases. What you often need is *windowed* order:

- Items within a window of size W are emitted in input order.
- Items in different windows may be emitted out of order.

A window of one is unordered; a window of all is strict order. A window of, say, 16 means "we are willing to wait for at most 15 items to arrive before declaring this one ready".

### Sliding-window reorder

```go
func reorderWindow[U any](in <-chan Tagged[U], window int64) <-chan U {
    out := make(chan U)
    go func() {
        defer close(out)
        next := int64(0)
        pending := make(map[int64]U)
        for t := range in {
            pending[t.Seq] = t.Val
            for {
                v, ok := pending[next]
                if ok {
                    out <- v
                    delete(pending, next)
                    next++
                    continue
                }
                // gap detected. If oldest pending item is more than `window` ahead of `next`, advance past the gap.
                var oldest int64 = -1
                for s := range pending {
                    if oldest == -1 || s < oldest {
                        oldest = s
                    }
                }
                if oldest > 0 && oldest-next >= window {
                    next = oldest
                    continue
                }
                break
            }
        }
        // drain remaining
        for {
            v, ok := pending[next]
            if !ok {
                next++
                if len(pending) == 0 {
                    return
                }
                continue
            }
            out <- v
            delete(pending, next)
            next++
        }
    }()
    return out
}
```

This buffer emits items in order up to the window; if an item is more than `window` positions behind, it is skipped (the producer is assumed to have given up on that sequence number).

### Choosing window size

A window of `2N` (where N is the worker count) is a common default. The intuition: at most N items are in flight; the next N items in the queue plus the in-flight items give us 2N positions of look-ahead. Beyond that, something has gone wrong and waiting longer does not help.

### Strict order vs causal order

Strict order is "exactly the input sequence". Causal order is "an item that depends on a previous item arrives after it, but unrelated items may interleave". Causal order requires per-key fan-out (next section); strict order requires reorder buffers.

---

## Backpressure as Coordination

### Channels propagate backpressure naturally

When the downstream consumer is slow, the workers block on sending to `out`. The workers then stop reading from `in`. The producer blocks on sending to `in`. The whole pipeline slows down to match the consumer.

This is *correct* behaviour. Backpressure is the pipeline's communication mechanism: "I cannot accept more right now."

### Bounded channels are the policy

The buffer size on each channel determines how much slack the pipeline has. An unbuffered channel means hand-off-only; a buffer of 100 means up to 100 items can pile up before the producer blocks.

For most stages: buffer = N to 2N (where N is worker count). This is enough to smooth short-term variance without hiding sustained mismatch.

### When backpressure hurts: head-of-line

Backpressure is fine when slowdowns are uniform. When a single slow item blocks the consumer, all workers eventually block. Throughput drops to one slow item per unit time, not N.

Fixes:

- Make the consumer faster.
- Add a buffer between stages so the consumer can fall behind temporarily.
- Drop or sideline slow items via a timeout per-item in the worker.
- Use a priority queue so slow items do not block fast ones.

### Multi-stage backpressure cascades

A slow downstream causes the immediate upstream to block, which causes its upstream to block, all the way to the source. The source must observe this and either:

- Wait (steady-state backpressure).
- Drop items (load shedding).
- Apply admission control (rate-limit the input).

Production pipelines need a policy for what to do at the source under sustained backpressure. The default (block) is fine if the source can wait (file, paginated query). For real-time inputs (Kafka, RPC), dropping or shedding may be required.

### Detecting and instrumenting backpressure

Two metrics tell you whether backpressure is active:

- Queue depth (the buffered count of each channel).
- Worker idle time (per-worker time not spent processing).

If queue depth is at the buffer limit consistently and workers are processing nonstop, you are backpressured. If queue depth is zero and workers are mostly idle, you are upstream-limited (the producer is slow).

Wire these into your dashboards. Backpressure interpretation is the most common operational skill for senior pipeline owners.

---

## Per-Key Fan-Out

### When items group by a natural key

Sometimes items in a stream group by some natural key — user ID, partition, region, customer. The grouping has a property: items with the same key must be processed in order; items with different keys are independent.

This is *per-key fan-out*: ordered within each key, parallel across keys. The pattern is common in:

- Per-user state machines: events for user A must be processed in order; user A and user B are independent.
- Per-partition Kafka consumers: each partition is ordered; partitions are parallel.
- Per-account billing: events for an account must be ordered; accounts independent.

### Implementation: hash to worker

The simplest implementation: hash the key to a worker index. All items for that key go to that worker. Each worker has its own queue; items in that queue are processed in order.

```go
func perKey(in <-chan KeyedItem, n int) <-chan Result {
    queues := make([]chan KeyedItem, n)
    for i := range queues {
        queues[i] = make(chan KeyedItem, 16)
    }
    out := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range queues[i] {
                out <- process(j)
            }
        }()
    }
    go func() {
        for j := range in {
            h := hash(j.Key) % uint32(n)
            queues[h] <- j
        }
        for _, q := range queues {
            close(q)
        }
    }()
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

A worker only sees items for its assigned keys. Within the worker, processing is sequential, so order is preserved. Across workers, processing is parallel.

### Key imbalance: the hot-key problem

If one key is much more active than others (a celebrity user, a hot partition), its assigned worker is overloaded and the others idle. This is the *hot-key problem* and is the canonical failure mode of per-key fan-out.

Mitigations:

- Split hot keys into sub-keys (`user-42-shard-0`, `user-42-shard-1`). Requires the consumer to tolerate intra-key reordering or to merge sub-keys downstream.
- Use a load-aware dispatcher that watches per-worker queue depths and re-routes hot keys.
- Accept the imbalance if it is small enough.

The trade-off is between ordering guarantees and load balance. Per-key fan-out picks ordering; lower-ordering models (per-shard, per-bucket) pick balance.

### Per-key plus shared-channel hybrid

A practical hybrid: route items by key prefix to a small set of pools, then within each pool use shared-channel fan-out. The router needs only `log N` routing decisions; load balance within a pool is automatic. Used in many large-scale Kafka consumer libraries.

---

## Tail Latency in Fan-Out

### Mean throughput vs p99 latency

Fan-out improves mean throughput. It does very little for the latency of any *single* item; the bottleneck per item is still the per-item work. But the *distribution* of latencies changes:

- Mean: improves with more workers, up to saturation.
- Median: similar to mean.
- p99: can get worse with more workers, due to queueing variability and shared-resource contention.

This is counterintuitive and the source of many "we added more workers and made the system slower" stories.

### Why p99 worsens with more workers

Three effects:

1. **Shared resource contention.** N workers competing for one DB connection pool, one HTTP/2 stream, one mutex — beyond the resource's capacity, each new worker adds queuing delay rather than throughput.
2. **Variability amplification.** With N workers each doing roughly equal work, the slowest of N tends to be much slower than the median. The pipeline's p99 is dominated by the slowest worker's variance.
3. **GC pressure.** More workers means more allocations per second. GC pauses become more frequent or longer, hitting tail latency.

### Mitigating tail latency

- **Hedged requests.** Send the same request to two workers; take the first response. Reduces p99 dramatically at the cost of 2x mean resource usage.
- **Bounded concurrency.** A hard cap on N that you tune empirically. Past the cap, additional input waits in the queue (which adds queuing latency but smooths variance).
- **Priority queues.** Slow items get their own queue so they do not block fast ones.
- **Per-item timeouts.** Cancel slow items rather than waiting. Combined with retries, this often beats waiting.
- **Smaller items.** Break large items into pieces. Per-piece latency is lower; aggregate latency may be similar.

The senior-level skill is recognising that "the mean is fine, the p99 is awful" is a *different* problem from "throughput is too low" — and that adding workers helps the second but often hurts the first.

### Little's law applied to fan-out

Little's law: average number of items in the system = arrival rate × average residence time. For a fan-out stage:

```
items_in_stage = arrival_rate * mean_latency
```

If arrival rate is 1000/s and mean latency is 50 ms, you have ~50 items concurrently in the stage on average. That implies N = 50 workers is roughly the saturation point (assuming each worker handles one item at a time). Below 50, queue grows; above 50, workers idle.

Little's law gives you the first-cut sizing for N: estimate arrival rate, estimate per-item latency, multiply.

---

## Designing for Cancellation Domains

### Not all cancellations cancel the same things

A real system has multiple cancellation domains:

- Request cancellation: this one user gave up; cancel everything tied to their request.
- Job cancellation: this batch was killed by an operator; cancel the pipeline.
- Shutdown cancellation: the process is exiting; drain everything cleanly.
- Tenant cancellation: this tenant exceeded quota; cancel their work.

If everything shares one context, cancelling one of these cancels all. That is usually wrong.

### Layered contexts

The typical layering:

```
process ctx (lives for the program's lifetime)
   |
   v
job ctx (lives for one pipeline run)
   |
   v
batch ctx (lives for one batch of items)
   |
   v
item ctx (lives for one item's processing)
```

Each layer is `context.WithCancel(parent)`. Cancelling a child does not affect the parent. Cancelling a parent cancels all descendants.

A worker observes the *item* context for most operations; the parent contexts cascade automatically.

### Workers cross domains

A worker often serves many items across many jobs. Its goroutine lifetime is tied to the worker pool's lifetime, not to any one item. The worker's outer loop watches the *worker-pool* context; each item's work watches the *item* context.

```go
for {
    select {
    case <-poolCtx.Done():
        return
    case j, ok := <-in:
        if !ok {
            return
        }
        process(j.Ctx, j) // each item has its own context
    }
}
```

The worker may continue serving other items after one item is cancelled. That is correct: cancelling one item does not stop the worker.

### Detaching from request context

A typical mistake: a request handler kicks off background processing using the request's context. When the request returns, its context is cancelled, and the background work dies. The fix: detach to a longer-lived context.

```go
go func() {
    detached := context.WithoutCancel(reqCtx)
    longRunning(detached)
}()
```

`context.WithoutCancel` (Go 1.21+) gives you a context with the request's values but its own (non-cancelled) cancellation chain. Before 1.21, you would create a new background context and copy values manually.

In fan-out, this matters when items submitted by a request must outlive the request. Decide explicitly: do they inherit the request's cancellation or not?

---

## Failure Domains and Bulkheads

### One slow tenant should not poison everything

A multi-tenant pipeline with one shared fan-out stage has a problem: when tenant A submits items that take 10 seconds each, tenant A's items occupy the workers and tenant B's items queue up. Tenant B sees its pipeline grinding to a halt due to tenant A.

This is the *noisy neighbour* problem. The solution: isolate failure domains via *bulkheads*.

### Implementation: per-tenant worker pools

Give each tenant (or class of tenants) its own worker pool. Tenant A's pool has K_A workers; tenant B's has K_B. Their pools do not share workers, do not share channels, and do not block each other.

```go
type TenantStage struct {
    pools map[string]*WorkerPool
}

func (s *TenantStage) Submit(tenant string, j Job) {
    pool, ok := s.pools[tenant]
    if !ok {
        // perhaps a default small pool, or reject
    }
    pool.Submit(j)
}
```

This costs memory (one pool per tenant) but provides hard isolation. Suitable for systems with a small number of tenants (say, < 100).

### Implementation: per-tenant semaphores

For many small tenants, dedicated pools are too much. Instead, share workers but cap concurrent items per tenant via a semaphore:

```go
sem := tenantSems[tenant]
if err := sem.Acquire(ctx, 1); err != nil {
    return err
}
defer sem.Release(1)
// share the worker pool but bounded by tenant
```

A misbehaving tenant fills its semaphore and gets queued; well-behaved tenants are not affected.

### Quotas vs reservations

A *quota* is an upper bound: "tenant A may use up to 10 workers". A *reservation* is a lower bound: "tenant A is guaranteed at least 5 workers". Production systems often have both: small reservations and larger quotas, with the difference used by whichever tenant is currently active.

### Detecting bulkhead breaches

Per-tenant queue depth and per-tenant in-flight count. Alert when any tenant's queue or in-flight exceeds N standard deviations from baseline. The breach often presages outage.

---

## Code Examples

### 1. Stage with concurrency budget via weighted semaphore

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"

    "golang.org/x/sync/semaphore"
)

type Job struct {
    ID     int
    Weight int64
}

func processStage(ctx context.Context, in <-chan Job, budget int64) <-chan int {
    out := make(chan int)
    sem := semaphore.NewWeighted(budget)
    var wg sync.WaitGroup
    go func() {
        defer wg.Wait()
        for j := range in {
            if err := sem.Acquire(ctx, j.Weight); err != nil {
                return
            }
            j := j
            wg.Add(1)
            go func() {
                defer wg.Done()
                defer sem.Release(j.Weight)
                time.Sleep(time.Duration(j.Weight) * time.Millisecond)
                select {
                case <-ctx.Done():
                    return
                case out <- j.ID:
                }
            }()
        }
    }()
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func main() {
    ctx := context.Background()
    in := make(chan Job)
    go func() {
        defer close(in)
        for i := 0; i < 20; i++ {
            in <- Job{ID: i, Weight: int64((i%5 + 1) * 20)}
        }
    }()
    for id := range processStage(ctx, in, 100) {
        fmt.Println("done", id)
    }
}
```

The weighted semaphore caps the total in-flight weight at 100. Small jobs run more concurrently; large jobs hold more budget and limit concurrency.

### 2. Per-key fan-out with hashing

```go
package main

import (
    "fmt"
    "hash/fnv"
    "sync"
)

type Item struct {
    Key string
    Val int
}

func perKey(in <-chan Item, n int, work func(Item) Item) <-chan Item {
    queues := make([]chan Item, n)
    for i := range queues {
        queues[i] = make(chan Item, 8)
    }
    out := make(chan Item)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            for it := range queues[i] {
                out <- work(it)
            }
        }()
    }
    go func() {
        for it := range in {
            h := fnv.New32a()
            h.Write([]byte(it.Key))
            queues[h.Sum32()%uint32(n)] <- it
        }
        for _, q := range queues {
            close(q)
        }
    }()
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func main() {
    in := make(chan Item)
    go func() {
        defer close(in)
        for i := 0; i < 30; i++ {
            in <- Item{Key: fmt.Sprintf("user-%d", i%5), Val: i}
        }
    }()
    seen := make(map[string][]int)
    var mu sync.Mutex
    for it := range perKey(in, 4, func(x Item) Item {
        return x
    }) {
        mu.Lock()
        seen[it.Key] = append(seen[it.Key], it.Val)
        mu.Unlock()
    }
    for k, vs := range seen {
        fmt.Println(k, vs)
    }
}
```

Within each key the values appear in input order. Across keys, order is arbitrary.

### 3. Hedged fan-out for tail latency

```go
func hedged(ctx context.Context, fn func(context.Context) (string, error)) (string, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    results := make(chan struct {
        v   string
        err error
    }, 2)
    go func() {
        v, err := fn(ctx)
        results <- struct {
            v   string
            err error
        }{v, err}
    }()
    select {
    case <-time.After(50 * time.Millisecond):
        // primary slow; hedge
        go func() {
            v, err := fn(ctx)
            results <- struct {
                v   string
                err error
            }{v, err}
        }()
    case r := <-results:
        return r.v, r.err
    }
    r := <-results
    return r.v, r.err
}
```

Issue the second call only if the first is slow. The first to succeed cancels the other.

### 4. Multi-tenant fan-out with per-tenant pools

```go
type TenantPool struct {
    workers int
    queue   chan Job
}

type Stage struct {
    pools map[string]*TenantPool
    mu    sync.Mutex
}

func (s *Stage) Submit(tenant string, j Job) {
    s.mu.Lock()
    p, ok := s.pools[tenant]
    if !ok {
        p = &TenantPool{workers: 4, queue: make(chan Job, 32)}
        for i := 0; i < p.workers; i++ {
            go func() {
                for j := range p.queue {
                    process(j)
                }
            }()
        }
        s.pools[tenant] = p
    }
    s.mu.Unlock()
    p.queue <- j
}
```

Each tenant gets its own queue and workers. Tenant A's slow items do not block tenant B.

---

## Coding Patterns

### Pattern: stages with explicit context, config, and budget

```go
func writeStage(ctx context.Context, cfg WriteConfig, in <-chan Record) <-chan Result {
    out := make(chan Result, cfg.OutputBuffer)
    sem := semaphore.NewWeighted(cfg.MaxConcurrent)
    // ...
    return out
}
```

Every senior-level stage takes ctx, config, input. Returns output. No globals, no implicit state.

### Pattern: structured shutdown via root cancel

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
// run pipeline
done := pipeline(ctx, ...)
select {
case <-sigterm:
    cancel()
case err := <-done:
    if err != nil {
        log.Println(err)
    }
}
```

A single cancel propagates to every fan-out, every worker, every send. The shutdown is structured and observable.

### Pattern: tenant-tagged contexts

```go
type tenantKey struct{}
ctx := context.WithValue(parent, tenantKey{}, "tenant-A")
```

Workers can read the tenant tag and route metrics or apply per-tenant policies without changing call signatures.

### Pattern: instrumented stage wrapper

```go
func instrument(name string, inner Stage) Stage {
    return func(ctx context.Context, in <-chan Item) <-chan Item {
        out := inner(ctx, in)
        go func() {
            for range out {
                metrics.Inc(name + "_out")
            }
        }()
        return out
    }
}
```

Decorator pattern around a stage. Adds metrics without touching the stage's internals.

---

## Operational Concerns

- **Dashboards.** Every stage should report: items in, items out, errors, in-flight, queue depth, worker idle time, p50/p95/p99 per-item time.
- **Alerts.** Queue depth at limit for >2 minutes. Worker idle ratio >50% (upstream-limited) or <5% (saturated). Error rate >1%.
- **Runbooks.** When the alert fires, what does the operator do? "Increase stage X's width" is one answer; "throttle the input" is another; "kill and restart" is a fallback.
- **Capacity planning.** Use Little's law to predict required workers under expected load. Provision for 2x peak.
- **Failure isolation.** Pipelines should survive one stage failing. Use bulkheads, circuit breakers, and per-stage retries.
- **Graceful shutdown.** SIGTERM should trigger a context cancel that allows in-flight items to complete (or persist to a queue for resumption).
- **Replay safety.** If the pipeline crashes, can it resume without reprocessing items or losing items? Design the source side accordingly.

---

## Performance Tips

- **Batching beats fan-out for very-fine-grained work.** If per-item work is < 10 us, batch 100 items per channel send. Fan-out widths can then be lower.
- **Profile the channel.** If `runtime.chanrecv` is in the top of your CPU profile, channels are contended. Batch, shard, or go work-stealing.
- **GOMAXPROCS matters.** In containerised environments, default GOMAXPROCS may not match container CPU limits. Use `automaxprocs` or set explicitly.
- **GC pressure.** Each item allocation costs; reuse buffers and structs via `sync.Pool`. Profile heap allocations under load.
- **Lock contention inside workers.** A shared mutex serialises workers. Refactor to per-worker state or atomic operations.
- **Cache locality.** Hot items processed by the same worker stay in L1/L2 cache. Affinity routing can outperform pure round-robin on cache-sensitive workloads.

---

## Best Practices

- Express the pipeline as a graph in documentation. Update it when topology changes.
- Treat width N as a configuration parameter at every stage.
- Budget per-stage and per-tenant resources explicitly.
- Use weighted semaphores for heterogeneous item costs.
- Use per-key fan-out only when natural keys exist and the hot-key problem is acceptable or mitigated.
- Choose policies (continue-on-error, fail-fast, first-success) per stage.
- Distinguish cancellation domains and choose them deliberately.
- Wire dashboards before launching to production.
- Test with realistic load including the noisy-neighbour scenario.
- Run with `-race` and goroutine-leak detection in CI.
- Document each stage's contract: order, error policy, cancellation behaviour, expected width.

---

## Edge Cases & Pitfalls

- **Budget exhaustion deadlock.** Two stages each holding tokens from the other's pool. Audit acquire/release scopes.
- **Hot key starvation.** One key occupies its worker forever; sub-key split is needed.
- **Reorder buffer leak.** A producer that occasionally skips a sequence number leaves the buffer waiting. Either guarantee contiguity or use windowed reorder.
- **Context inheritance.** A child stage inheriting the wrong context. Result: cancellations propagate where you didn't want them.
- **GC stop-the-world during heavy fan-out.** Allocations across many goroutines amplify GC pauses. Profile and tune.
- **Workers holding DB transactions.** A worker that begins a transaction and waits hours holds a connection. Use short transactions and re-acquire.
- **Closer waiting on a leaked worker.** A worker that swallows context cancellation and waits forever stalls the entire stage's shutdown. Audit every worker for cancellation observation.

---

## Common Mistakes

- One global concurrency limit applied to all stages — usually wrong, every stage has its own bottleneck.
- Sharing one `errgroup` across the whole pipeline — first error cancels everything, which may be wrong for some stages.
- Per-key fan-out without hot-key mitigation — works until the celebrity user signs up.
- Strict order via reorder buffer with unbounded memory — fine until a slow worker pins 100 MB.
- Fan-out widths copied between similar-looking systems without re-measuring the bottleneck.
- Detached contexts that never time out, leading to leaked background work.

---

## Tricky Points

- A weighted semaphore can fail on `Acquire` if the requested weight exceeds the total budget. Always check the return value.
- `context.WithoutCancel` (1.21+) detaches cancellation but keeps values. Use deliberately.
- A bulkhead's per-tenant pool size becomes part of the SLA. Document it.
- `sync.Pool` is per-P, not per-goroutine; pool objects can move between goroutines. Avoid storing state in pool objects across uses.
- A fan-out stage that emits to a *broadcast* (one input to many parallel consumers) is not a fan-out; it is a tee. Different pattern.
- Hedged requests double resource usage. Use only when tail latency is more valuable than the extra cost.
- Cancellation observation is per-goroutine, not per-pipeline. A worker that does not check `ctx.Done()` between operations cannot be cancelled mid-operation.

---

## Test

```go
func TestBudgetEnforced(t *testing.T) {
    ctx := context.Background()
    const budget = 4
    in := make(chan Job)
    var concurrent int32
    var maxConcurrent int32
    out := stageWithBudget(ctx, in, budget, func(j Job) {
        c := atomic.AddInt32(&concurrent, 1)
        if c > atomic.LoadInt32(&maxConcurrent) {
            atomic.StoreInt32(&maxConcurrent, c)
        }
        time.Sleep(10 * time.Millisecond)
        atomic.AddInt32(&concurrent, -1)
    })
    go func() {
        defer close(in)
        for i := 0; i < 100; i++ {
            in <- Job{ID: i, Weight: 1}
        }
    }()
    for range out {
    }
    if maxConcurrent > budget {
        t.Fatalf("max concurrent %d exceeded budget %d", maxConcurrent, budget)
    }
}

func TestPerKeyOrdering(t *testing.T) {
    in := make(chan Item)
    go func() {
        defer close(in)
        for i := 0; i < 100; i++ {
            in <- Item{Key: fmt.Sprintf("k%d", i%5), Val: i}
        }
    }()
    perKeyValues := make(map[string][]int)
    var mu sync.Mutex
    for it := range perKey(in, 4, func(x Item) Item { return x }) {
        mu.Lock()
        perKeyValues[it.Key] = append(perKeyValues[it.Key], it.Val)
        mu.Unlock()
    }
    for k, vs := range perKeyValues {
        for i := 1; i < len(vs); i++ {
            if vs[i] < vs[i-1] {
                t.Fatalf("key %s out of order: %v", k, vs)
            }
        }
    }
}
```

---

## Tricky Questions

1. *Why does adding workers sometimes increase p99 latency?*
   Workers share resources (DB pool, network, GC). Past the resource's capacity, additional workers queue rather than execute, adding latency. Also, GC pressure scales with allocation rate, which scales with worker count.

2. *When is per-key fan-out wrong?*
   When keys are highly skewed (hot-key problem) and you have no mitigation, or when items must be processed in *global* order, not per-key order.

3. *How do you size workers from Little's law?*
   N ≈ arrival rate × per-item latency. Round up; add 20% margin. If actual N is much less than this, queue grows; much more, workers idle.

4. *What is a hedged request and when is it useful?*
   Send the same work to two workers; take the first response. Useful when tail latency is dominated by occasional slow instances. Costs roughly 2x resources.

5. *How do you prevent a slow tenant from starving others?*
   Bulkheads: per-tenant worker pools, per-tenant semaphores, or per-tenant quotas. Choice depends on tenant count and isolation strength needed.

6. *Why is `sync.Pool` per-P (per processor) and not per-goroutine?*
   Goroutines migrate between Ps; pool storage is per-P for cache-locality and low contention. The trade-off: pool objects may not be local to your goroutine on return.

7. *What is a cancellation domain?*
   A scope of code that should be cancelled together. Distinct domains use distinct contexts. Domains can be request, job, batch, item, tenant, or process.

8. *How does fan-out interact with circuit breakers?*
   A circuit breaker should be per downstream dependency. Workers consult the breaker before calling out. When open, the breaker short-circuits with an error; fan-out workers carry that error through the pipeline.

9. *What happens to in-flight items when SIGTERM arrives?*
   Depends on policy. Typical: cancel context, wait up to a deadline for in-flight items to complete or persist, then force-exit. A pipeline should drain gracefully when possible.

10. *Why might you prefer batching over wider fan-out for high-throughput stages?*
    Batching amortises per-call overhead (allocations, channel sends, RPC framing) without adding goroutines or contention. Fan-out adds parallelism; batching reduces per-item overhead. For very fast work, batching often wins.

---

## Cheat Sheet

```
Width:        bottleneck × Little's law
Order:        strict reorder | windowed | per-key | unordered
Failure:      continue | fail-fast | first-success | hedged
Budget:       per-stage semaphore | per-tenant pool | per-key affinity
Cancellation: domain per ctx layer | item / batch / job / process
Topology:     shared channel | per-worker queue | work-stealing | tee
Backpressure: bounded channels, queue-depth alerts
Observability: in, out, err, in-flight, queue, idle, p50/p95/p99
```

---

## Self-Assessment Checklist

- [ ] I can draw the architecture graph of a real pipeline including channels, goroutines, and contexts.
- [ ] I can allocate concurrency budgets across stages and tenants.
- [ ] I can choose between shared-channel, per-worker, per-key, and work-stealing topologies and justify each.
- [ ] I can implement and reason about reorder buffers and windowed reorder.
- [ ] I can describe how p99 latency relates to N and to shared resources.
- [ ] I can implement bulkheads and per-tenant isolation.
- [ ] I can identify cancellation domains and choose contexts accordingly.
- [ ] I can detect and diagnose backpressure with metrics.
- [ ] I can configure dashboards and alerts for a production pipeline.
- [ ] I can design graceful shutdown for a fan-out stage.

---

## Summary

Senior-level fan-out is not a helper; it is a unit of architecture. The decisions you make about width, ordering, cancellation, and failure isolation shape the whole pipeline's operational behaviour. The standard library and `errgroup` give you primitives; the senior's job is to compose them into a system that behaves under realistic load — heterogeneous items, multi-tenant traffic, occasional failure, graceful shutdown, observability for debugging.

Three habits define this level:

1. Draw the graph before changing code.
2. Budget resources explicitly per stage and per tenant.
3. Distinguish cancellation domains, ordering requirements, and failure policies on a per-stage basis.

The patterns themselves are not new. The skill is choosing among them with confidence and operating the resulting system in production.

---

## Further Reading

- "Designing Data-Intensive Applications" (Kleppmann) — streams, ordering, backpressure
- Google SRE Book, chapter on adaptive load
- "Hedged requests at scale" — Tail at Scale paper, Dean & Barroso
- `golang.org/x/sync/semaphore` documentation
- `golang.org/x/sync/errgroup` source
- Bryan Mills, "Concurrency in the Face of Side-effects", GopherCon 2022
- Russ Cox, "Go's work-stealing scheduler"

---

## Related Topics

- Pipeline production patterns (this section, all chapters)
- Backpressure (chapter 8)
- Rate limiting (chapter 9)
- Circuit breakers (chapter 11)
- Tail-latency engineering (professional level of this file)
- Multi-tenant scheduling (covered in distributed systems track)

---

## Diagrams & Visual Aids

Multi-stage pipeline with per-stage budgets:

```
source (1) -> fetch (8, budget=16) -> parse (4) -> write (DB, sem=10) -> sink (1)
                 |                       |             |
                 v                       v             v
              ctx, mtr              ctx, mtr        ctx, mtr
```

Per-key router:

```
in -> [hash(k) % N] -> queue[h] -> worker[h] -> out
```

Hedged request flow:

```
caller -> primary worker  -+
                          v -> first response wins -> caller
caller -+--> hedge worker -+
        |
     50ms delay
```

Cancellation domains:

```
process ctx
   +-- job ctx
        +-- batch ctx
             +-- item ctx (one per item)
```

Bulkhead:

```
tenant A -> [pool A: 4 workers]
tenant B -> [pool B: 4 workers]
tenant C -> [pool C: 2 workers]
```
