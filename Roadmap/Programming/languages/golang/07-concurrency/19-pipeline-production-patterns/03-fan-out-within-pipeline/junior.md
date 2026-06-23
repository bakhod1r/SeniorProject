---
layout: default
title: Junior
parent: Fan-Out Within Pipeline
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/03-fan-out-within-pipeline/junior/
---

# Fan-Out Within a Pipeline Stage — Junior Level

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
> Focus: "My pipeline stage is slow. Can I just run more copies of it in parallel?"

A Go pipeline is a chain of stages connected by channels. The classic example reads items from a source, transforms each one, and writes the result to a sink:

```
source -> transform -> sink
```

If every stage takes roughly the same time per item, the pipeline runs as fast as any one stage. But in practice one stage is almost always slower than the others. The slow stage might be:

- A CPU-heavy calculation: image resize, JSON parse, signature verification, image compression
- A network call: HTTP request to a third-party API, DNS lookup, gRPC call
- A database write: insert or upsert per row, schema validation
- A disk operation: writing a large file, computing a hash, fsync on each record
- A blocking syscall: encryption, signing, calling out to a binary

When one stage is ten times slower than its neighbours, the whole pipeline runs at one-tenth speed. The fast stages spend most of their time blocked on the channel, waiting for the slow stage to drain. The producer has nowhere to send. The consumer has nothing to read. The CPU runs at five percent. This is the symptom you have probably seen in production logs: throughput drops, the queue grows, latency climbs, but the box is barely warm.

**Fan-out within a pipeline stage** is the standard cure. Instead of running a single goroutine for the slow stage, you run N copies. Each copy reads from the same upstream channel and writes to the same downstream channel. The fast stages on either side never need to change.

```
                +-> worker1 -+
                |            |
source -> ......+-> worker2 -+...... -> sink
                |            |
                +-> workerN -+
```

This is the most common production-grade fix for a slow pipeline stage. It is also where most bugs creep in: lost items, deadlocks, goroutine leaks, results arriving out of order, the downstream channel closed too early, the WaitGroup unbalanced, the context never cancelled, the workers stuck on a full channel.

The good news: the pattern itself is small. About fifteen lines of Go expresses the whole idea. Read those fifteen lines, recognise them, write them from memory, and you will already write better Go than most of the code in production today. The whole rest of this file expands on what those fifteen lines mean, why they look the way they do, and which traps will trip you up the first time you customise them.

After reading this file you will:

- Know what "fan-out within a stage" means and why it works
- Be able to spawn N workers that share an input channel
- Use `sync.WaitGroup` to close the output channel exactly once
- Recognise that fan-out destroys input order, and understand the first naive way to think about that
- Write the canonical "unordered fan-out" template by heart
- Avoid the three most common first-time bugs: closing the output channel from a worker, leaving the WaitGroup unbalanced, and forgetting that fan-out and fan-in are two different things
- Tell apart "fan-out adds parallelism" from "fan-out adds magic"
- Understand the difference between fan-out within a pipeline (one input channel, many workers) and fan-out across pipelines (many independent pipelines for many independent inputs)

You do not need to understand context cancellation deeply, errgroup, ordered fan-out with sequence numbers, or how to tune N to a tail-latency target. Those belong to middle and senior levels and build directly on what you learn here.

---

## Prerequisites

- **Required:** You have written and run a simple Go pipeline with two or three stages connected by channels. If you have not, the standard "go.dev/blog/pipelines" article is a forty-minute warm-up before you read this.
- **Required:** You know the `go` keyword, how to start a goroutine, and that the program exits when `main` returns. The goroutine basics in 01-goroutines/01-overview cover this in depth.
- **Required:** You can read and write unbuffered and buffered channels and you know what `close(ch)` does. In particular: closing a channel never panics readers; sending to a closed channel always panics. The first half of this rule keeps us alive, the second half is the leading cause of fan-out crashes.
- **Required:** You know `sync.WaitGroup.Add`, `Done`, and `Wait`. You know the rule that `Add` must happen before the goroutine starts, never inside it.
- **Required:** You can read directional channel types: `<-chan T` means receive-only, `chan<- T` means send-only.
- **Helpful:** You have read the chapter on the producer-consumer pattern (chapter 18 of this concurrency track).
- **Helpful:** You have written code where one slow function dominated the runtime of a loop and you noticed the bottleneck. Profiling or just adding a stopwatch is enough to internalise this experience.
- **Helpful:** You have used `go test -race` at least once and have seen what a race report looks like.
- **Helpful:** You know what a closure is and that goroutines capture variables by reference. Most non-obvious fan-out bugs are closure bugs in disguise.

If you can write a function that reads from a channel of integers, doubles each value, and writes it to another channel, you have everything you need. If you can additionally write a test that uses two goroutines and a `WaitGroup`, you are very well prepared.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Pipeline** | A sequence of stages connected by channels, where each stage is one or more goroutines that read from an input channel and write to an output channel. |
| **Stage** | One logical step in a pipeline. A stage can be implemented by one goroutine (serial) or by many goroutines (fan-out). From outside the stage looks like a single function: one input channel in, one output channel out. |
| **Fan-out** | Replacing one goroutine in a stage with N goroutines that all read from the same input channel. The whole purpose: parallelise that stage. |
| **Fan-in** | The mirror of fan-out: many goroutines write to one output channel. In an in-pipeline fan-out, fan-in is automatic — all N workers write to the same downstream channel — so we rarely build it explicitly. |
| **Worker** | One of the N goroutines that make up a fanned-out stage. |
| **Worker pool** | A set of long-lived worker goroutines that drain a shared input channel until it is closed. |
| **Ordered fan-out** | Fan-out that preserves input order in the output stream. Requires sequence numbers and reordering buffers. Costs latency and memory. |
| **Unordered fan-out** | Fan-out that does not preserve order. Simplest, fastest, default unless the consumer needs order. |
| **Concurrency (N)** | The number of workers in the fanned-out stage. Often called the *width* of the stage. |
| **Width** | Synonym for concurrency N. Some books say "the stage has width 8" instead of "n = 8". |
| **Backpressure** | A slow downstream consumer making the upstream block. Bounded channels propagate backpressure naturally. |
| **Goroutine leak** | A worker that never exits, usually because its input channel is never closed or because it is blocked on a downstream send that nobody reads. |
| **Closer goroutine** | The single goroutine whose only job is to call `wg.Wait()` and then `close(out)`. Separating this from the workers is a structural property of the pattern. |
| **`sync.WaitGroup`** | The primitive used to wait for all N workers to finish before closing the output channel. |
| **`range ch`** | Reads from `ch` until it is closed. The idiomatic way for a worker to drain its input. |
| **Bottleneck stage** | The stage in a pipeline that limits overall throughput. Fan-out is the answer to a bottleneck stage. |
| **Saturation** | The point past which adding more workers no longer increases throughput, because some other resource (CPU, network, DB pool) is already maxed out. |
| **Throughput** | Items processed per second across the whole pipeline. The metric fan-out actually improves. |
| **Latency** | Time from input arriving at the head of the pipeline to its corresponding output emerging at the tail. Fan-out *does not* improve per-item latency; it only improves throughput. |
| **Independent items** | Items whose processing does not depend on previous or future items. Fan-out only works for independent items. |
| **Item ID / sequence number** | A monotonically increasing integer attached to each item. The basis of ordered fan-out. |
| **Producer** | The goroutine (or stage) that writes items into the input channel of the fanned-out stage. |
| **Consumer** | The goroutine (or stage) that reads items from the output channel of the fanned-out stage. |
| **Job** | One unit of work flowing through the channel. Often used interchangeably with "item". |
| **Result** | The output of one job. Often a struct that carries the input, the output, and an optional error. |

---

## Core Concepts

### A pipeline runs at the speed of its slowest stage

This is the most important sentence in this whole file. Pipelines are not magic. Stage A feeds stage B feeds stage C. If B handles 100 items per second and A produces 1000, then 900 of those items every second pile up in the channel between A and B — or, more often, A blocks on the send and slows itself down to match B.

The output of your pipeline is therefore exactly as fast as your *slowest* stage. Speeding up the others costs CPU for nothing. The only fix is to make the slow stage itself faster — either by changing its algorithm or by running multiple copies of it in parallel.

Most engineers, the first time they meet this fact, try the algorithm route: replace a slow regex, switch a JSON library, batch some DB calls. That is sometimes the right call. But when the slow stage is dominated by waiting — for a network response, a disk seek, a database commit — the algorithm cannot be fixed. The only knob left is "more workers running this same algorithm in parallel". That is fan-out.

### Fan-out turns one stage into N stages that share a channel

The simplest possible serial pipeline looks like this:

```go
out := make(chan int)
go func() {
    defer close(out)
    for v := range in {
        out <- slow(v)
    }
}()
```

One goroutine reads `in`, calls `slow`, writes `out`. If `slow` takes 100 ms per item, the stage handles 10 items per second.

Now fan it out into four workers:

```go
out := make(chan int)
var wg sync.WaitGroup
for w := 0; w < 4; w++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range in {
            out <- slow(v)
        }
    }()
}
go func() {
    wg.Wait()
    close(out)
}()
```

Four goroutines now read from `in`. Whenever a worker becomes free it grabs the next available item. If `slow` still takes 100 ms, the stage handles roughly 40 items per second — four times the throughput, for the same code.

That is the entire idea of fan-out within a stage. Everything else in this file is detail. Look at this snippet until the shape of it is obvious. Notice that:

- The output channel is created once, outside the loop.
- The WaitGroup is created once, outside the loop.
- Each worker is a goroutine that ranges over the input until it is closed.
- The closer goroutine is *not* a worker — it waits, then closes.
- The function returns `out` to the caller.

### Each item is consumed by exactly one worker

A channel does not broadcast. When two goroutines both call `<-ch` and one item arrives, exactly one of them gets it. So multiple workers reading from the same input channel automatically share the work: each item goes to whichever worker happens to be ready. This is sometimes called *competing consumers*. No coordinator, no router, no map: the channel itself is the dispatcher.

This is the property that makes fan-out so simple in Go. In other languages you build the dispatcher: a thread-safe queue, a task scheduler, a pool of futures. In Go the dispatcher is just `for v := range in`.

### The dispatch is fair-ish, not strictly fair

When N workers compete on the same channel, the Go runtime does not guarantee strict round-robin fairness. It guarantees that some ready worker will receive the value. In practice, modern Go schedulers are good enough that work spreads roughly evenly when items take roughly equal time. When item times vary, faster workers naturally pick up more items — which is exactly what you want.

You should never write code that depends on "worker 0 will receive the first item" or "workers round-robin perfectly". They will not. The channel is a dispatcher, not a load balancer with policies.

### Closing the output channel is not the workers' job

This is the bug that catches almost every newcomer. A worker thinks "I am done, let me close `out`." But there are still three other workers writing to `out`. The next write will panic with `send on closed channel` and crash the whole program.

The rule is simple and absolute: **the output channel of a fan-out stage must be closed exactly once, after all workers have finished, by a single dedicated closer goroutine.** That closer typically waits on a `sync.WaitGroup` whose counter equals the number of workers.

```go
go func() {
    wg.Wait()
    close(out)
}()
```

This pattern is sometimes called the "closer goroutine" or "wg.Wait closer". You will write it in almost every fan-out you ever build. It is the single most distinctive piece of code in a fan-out stage; when reading unfamiliar Go in a code review, the presence or absence of this snippet tells you whether the author has been bitten before.

### Fan-out does not preserve order

If three workers each pick up an item, the one that finishes first writes its result first — regardless of which input came first. Inputs `1, 2, 3` can come out as `2, 3, 1` or `3, 1, 2` or any other permutation. For many tasks this is fine: dispatching emails, refreshing caches, computing independent hashes. For others — anything where the consumer expects a specific order — this is a correctness bug.

For now, at the junior level, assume that **fan-out within a stage is unordered**. We will come back to ordered fan-out in middle.md. If you need ordering and you are at this level of experience, the safest thing is: do not fan out, or use only one worker.

### Fan-out adds throughput, not latency

This is the second most important sentence after "a pipeline runs at the speed of its slowest stage". Fan-out makes the *pipeline* faster overall, but it does not make any individual item faster. A single item still spends `slow()` ms in the slow stage. If your concern is "the user is waiting on this one item", fan-out does not help; you need to fix `slow()` itself.

Think of it like checkout lanes. Opening more lanes does not make your specific transaction faster. It makes the *line* shorter. Fan-out is about the line, not about you.

### The workers must be stateless with respect to each other

Two workers reading the same channel must not depend on what the other worker did. If worker A's result depends on worker B's previous result, you do not have a fan-out — you have a misnamed sequential pipeline. The "independent items" property is a hard prerequisite.

Common sources of accidental shared state:

- A package-level counter that workers increment.
- A shared map for caching results across workers.
- A single HTTP client with a low connection limit (workers serialise on the connection).
- A shared mutable buffer reused inside the worker.

When in doubt, run with `go test -race`. The race detector will catch most of these.

### Closing the input channel is the producer's job

A fan-out stage does not close its input. The producer that feeds the input is responsible for closing it when no more items are coming. When the input closes, all workers' `range` loops exit, all `wg.Done()` calls happen, the closer's `wg.Wait()` returns, and the output is closed. The whole shutdown is a chain reaction triggered by the producer closing its output.

This is the most important property of pipeline lifecycle: **the producer of a channel is also its closer.** If your fan-out stage closes the input itself, you broke this rule and have probably introduced a panic or a leak.

### Buffered output makes the stage smoother, not faster

A buffered output channel does not increase throughput in steady state. It only smooths out short-term mismatch between workers and consumer. If the consumer is permanently slower than the workers, the buffer fills up and workers block on send — same as unbuffered. If the consumer is permanently faster, the buffer is irrelevant.

A small buffer (N to 2N) is a good default. A huge buffer hides bugs and inflates memory.

---

## Real-World Analogies

### Supermarket checkout lanes
A supermarket has one entrance (the source) and one exit (the sink). In the middle, instead of one cashier serving everyone, there are six lanes in parallel. Customers (items) join whichever lane is shortest. The store throughput multiplies by roughly six. But customers do not necessarily leave in the order they arrived — the customer with five items overtakes the one with fifty. That is exactly the trade-off of unordered fan-out: throughput up, order gone.

If you open more lanes than the store has customers, the extra lanes sit idle. That is the analogue of "N too high": no benefit, plus the cost of keeping a cashier on payroll. If you open too few lanes, the queue stretches out the door. That is N too low.

### Call centre
Calls come in on one number. They are distributed across N agents. The number of agents is your concurrency. Add more agents and average wait time drops. Take agents away and the queue piles up. The router (channel) does not care which agent picks up — just that someone does.

A real call centre also has the same problem of variable call lengths. A two-minute call and a forty-minute call cost the same channel send. The slow call hogs its agent for a long time; the other agents pick up the slack. Fan-out does the same thing automatically.

### A team writing the same kind of bug ticket
You have a sprint board with 200 small tickets, each takes about an hour. One developer takes a week. Five developers in parallel take a day. The work is naturally fan-out-able: tickets are independent, any developer can pick the next available one, and nobody cares which developer fixed which bug. Order does not matter — the project ships when the last ticket is done.

This analogy also shows what fan-out cannot do. If the next ticket depends on the previous one being done, you cannot fan out — only one developer can work at a time, and adding people does not help. Real pipelines have the same property: independent items are fan-outable; dependent items are not.

### Highway tolls
One lane backs up for kilometres. Open four lanes and traffic flows. Drivers arrive in one order and may leave in another, depending on which lane was fastest. Same trade-off again. Toll plazas are also a nice example of "saturate the resource": the limit is not the number of lanes but the throughput of the road on the other side. Adding lanes past that limit just moves the queue.

### Hospital triage
The waiting room is the channel. Many doctors (workers) read from it. Each patient is handled by exactly one doctor. If you need patients to leave in arrival order, fan-out is the wrong shape; if you just need them all seen as fast as possible, fan-out is exactly right.

### Pizza place with multiple ovens
Customers order at one counter. Orders go to the kitchen. The kitchen has N ovens. Each oven bakes one pizza at a time, but all ovens run in parallel. Orders complete in the order the ovens finish, not the order they were placed. A simple Margherita finishes before a "everything on it, please" — even if the latter was ordered first. Fan-out behaviour in five sentences.

### Mail-sorting machines
A single mail sorter handles 1000 letters an hour. Six sorters in parallel handle 6000 letters an hour. The letters do not necessarily come out in the order they went in. The post office did not care; what they cared about was that all letters left the building by 9pm.

---

## Mental Models

### Many mouths on one straw
Picture the input channel as a straw and the workers as mouths. Whoever sucks first gets the next sip. Nobody schedules the mouths; the straw cannot give the same sip to two mouths.

### Workers are stateless drainers
A correct worker has almost no state of its own. It reads, processes, writes, repeats. When the input channel closes, the `range` loop ends, the worker exits. Stateless workers compose without surprises.

If you find yourself adding fields to your worker — counters, caches, retry state — pause. Often that state belongs in a separate stage or in the item itself.

### The fan-out stage is a single logical box
From the outside, the stage still has one input and one output. The fact that there are N goroutines inside is an implementation detail of that stage. Upstream and downstream stages do not know and do not need to know.

This is why fan-out is such an effective refactor: you change the inside of a function, and no caller is affected. The signature is the same, the semantics for the caller are the same, the throughput is just N times higher.

### Throughput vs latency
Fan-out improves *throughput* — how many items per second — but does very little for *latency* of a single item. A single item still takes `slow()` ms. If a single item is critical, fan-out is not the tool.

Many production-pain conversations confuse these two. "It is slow" can mean "p99 latency is 4s" (a per-item latency problem, often unfixable by fan-out) or "we are 30 minutes behind on the queue" (a throughput problem, exactly the case for fan-out).

### The closer is a separate role
Workers process items. The closer waits for workers and closes the output. These are different jobs, done by different goroutines, on purpose. Mixing them is the canonical bug.

### The graph of channels and goroutines
Draw your pipeline as a graph. Each node is either a goroutine or a channel. Each edge is "writes to" or "reads from". A correct fan-out stage looks like this:

```
in (channel)
  +-- read by worker 0 -- write to out (channel)
  +-- read by worker 1 -- write to out
  +-- read by worker 2 -- write to out
  +-- read by worker 3 -- write to out
wg (WaitGroup, decremented on worker exit)
  +-- waited on by closer -- close(out)
```

If you cannot draw this for your pipeline, your pipeline probably has a structural problem.

### "Workers are dishwashers"
Each worker stands at a station, takes the next dirty dish from a shared rack, washes it, places it on a shared "clean" rack. None of them coordinates with the others. The rack is the channel. There is no schedule — first-available wins. When the dirty rack is empty (input closed), each dishwasher takes off their gloves and leaves. The kitchen closes when the last dishwasher leaves (`wg.Wait()` returns) and the staff turns off the lights (`close(out)`).

---

## Pros & Cons

### Pros
- Linear throughput scaling up to the saturation point of the bottleneck resource (CPU cores, network sockets, DB connections)
- The rest of the pipeline stays untouched: same channel types, same upstream and downstream code
- The pattern is short, idiomatic, and easy to recognise in code review
- Goroutines are cheap; you can run dozens or hundreds of workers per stage
- Backpressure still works: if the downstream is slow, all workers block on send and the upstream notices
- No external dependency: just the standard library
- Easy to test: vary N in tests, run with `-race`
- Easy to instrument: count items per worker, time per worker, errors per worker

### Cons
- Output order is lost unless you add sequence numbers and reordering
- You must close the output channel exactly once — easy to get wrong
- Choosing N is a real design decision; too high wastes CPU or hammers an external service, too low under-uses the bottleneck
- Errors are now plural: N workers can each fail independently; reporting is harder
- Goroutine leaks are easier to introduce, because cancellation now affects N goroutines instead of one
- Memory pressure: more in-flight work at once, more buffered items, more allocations
- Debugging is harder: stack traces show many similar-looking workers
- Tail latency can be worse: a single slow item still hogs a worker; the queue grows behind it
- Per-tenant fairness is not built in: a noisy tenant can hog all workers in a multi-tenant pipeline

### When NOT to use fan-out within a stage

- The stage is already fast enough. Do not optimise what is not slow.
- The stage's work cannot be parallelised. Sequential dependencies between items kill fan-out.
- The bottleneck is downstream. Speeding up the slow stage just shifts the bottleneck and gains you nothing.
- The order of outputs is critical and you cannot afford the latency cost of ordered fan-out.
- The total work is small (a few items) and the coordination overhead dominates.

---

## Use Cases

- **Image processing pipeline**: read filenames, resize images, write thumbnails. The resize stage is CPU-bound — fan-out across CPU cores.
- **JSON-to-database loader**: parse JSON records, validate, write to database. The DB write stage is often the bottleneck; fan-out within the DB connection limit.
- **URL crawler**: read URLs, fetch HTTP, write response body. HTTP fetch is the slow stage; fan-out to many concurrent fetches.
- **Email sender**: read addresses, send via SMTP, log result. Network-bound; fan-out works well.
- **Hash computation**: read files, compute SHA-256, write digest. CPU-bound; fan-out scales linearly with cores.
- **Log enricher**: read log lines, look up user/account info, write enriched line. The lookup is the slow stage.
- **Webhook dispatcher**: read events, POST each to a customer URL, record outcome. Network latency dominates; fan-out is essential.
- **Encrypted backup**: read files, encrypt blocks, write to object storage. Encryption is CPU-bound; uploads are network-bound; both stages benefit from fan-out.
- **Search index builder**: read documents, tokenise, build per-document postings, write to shard. Tokenise stage is CPU-bound.
- **PDF generator**: read records, render PDF, write to disk. PDF render is the bottleneck.
- **Video transcoder**: read frames or segments, encode, write output. Both CPU-bound and network-bound depending on the input/output target.
- **DNS resolver bulk job**: read hostnames, resolve via DNS, write IPs. Network-bound, plenty of room for fan-out up to the DNS resolver's rate limit.

In each case, the same structural property: the items are independent of each other and the bottleneck stage is a function with no per-item dependency.

---

## Code Examples

### 1. The naive serial pipeline (the starting point)

We start with a one-worker stage so we can see the bottleneck.

```go
package main

import (
    "fmt"
    "time"
)

// slow simulates a 100 ms CPU or network operation.
func slow(v int) int {
    time.Sleep(100 * time.Millisecond)
    return v * v
}

// stage reads in, calls slow on each value, writes to out, closes out.
func stage(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- slow(v)
        }
    }()
    return out
}

func main() {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 1; i <= 10; i++ {
            in <- i
        }
    }()

    start := time.Now()
    for v := range stage(in) {
        fmt.Println(v)
    }
    fmt.Println("elapsed:", time.Since(start))
}
```

Run this. It takes about 1 second: ten items, 100 ms each, one worker. Now the single-worker baseline is established. Save this as `01_serial.go`; we will rewrite it three more times.

### 2. The first fan-out: four workers

We add four workers. The shape of the function does not change: it still takes one input channel and returns one output channel. Internally, four goroutines drain the input.

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func slow(v int) int {
    time.Sleep(100 * time.Millisecond)
    return v * v
}

// fanOut spawns n workers that each drain in and write to out.
func fanOut(in <-chan int, n int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for w := 0; w < n; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range in {
                out <- slow(v)
            }
        }()
    }
    // Closer: waits for all workers, then closes out exactly once.
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func main() {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 1; i <= 10; i++ {
            in <- i
        }
    }()

    start := time.Now()
    for v := range fanOut(in, 4) {
        fmt.Println(v)
    }
    fmt.Println("elapsed:", time.Since(start))
}
```

The elapsed time drops from about 1 second to about 0.3 seconds (10 items / 4 workers, rounded up). The output values appear out of order — that is the expected behaviour of unordered fan-out.

Save this as `02_fanout.go`. Run it three times. Note that:

- The total time is roughly `ceil(N_items / N_workers) * per_item_time`.
- The order of outputs differs between runs.
- The shape of the public API is identical to the serial version.

### 3. Logging which worker handled which item

Add worker IDs so you can see the dispatch live. This is the example you should run when you first learn the pattern.

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type result struct {
    workerID int
    value    int
    squared  int
}

func slow(v int) int {
    time.Sleep(50 * time.Millisecond)
    return v * v
}

func fanOut(in <-chan int, n int) <-chan result {
    out := make(chan result)
    var wg sync.WaitGroup
    for w := 0; w < n; w++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for v := range in {
                out <- result{workerID: id, value: v, squared: slow(v)}
            }
        }(w)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func main() {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 1; i <= 12; i++ {
            in <- i
        }
    }()
    for r := range fanOut(in, 3) {
        fmt.Printf("worker %d: %d^2 = %d\n", r.workerID, r.value, r.squared)
    }
}
```

You will see lines like:

```
worker 1: 2^2 = 4
worker 0: 1^2 = 1
worker 2: 3^2 = 9
worker 0: 4^2 = 16
...
```

The output order varies between runs. Note: each item is owned by exactly one worker; no item is processed twice. Note also the closure trick: `go func(id int) { ... }(w)` passes `w` as a parameter so each worker has its own copy of its ID. Without that, all workers would share the same `w` variable (in Go versions before 1.22) and report the same ID.

### 4. Buffered output channel

If the downstream consumer is bursty or slightly slower than the workers, an unbuffered output channel makes every worker pause on each send. A small buffer lets workers continue while the consumer catches up.

```go
out := make(chan result, n*2) // small buffer per worker
```

A rule of thumb: a buffer of one or two times the number of workers is plenty. Larger buffers hide problems rather than solve them.

Here is the full version with buffered output:

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func slow(v int) int {
    time.Sleep(50 * time.Millisecond)
    return v
}

func fanOut(in <-chan int, n int) <-chan int {
    out := make(chan int, n*2) // buffered output
    var wg sync.WaitGroup
    for w := 0; w < n; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range in {
                out <- slow(v)
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func main() {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 1; i <= 20; i++ {
            in <- i
        }
    }()
    for v := range fanOut(in, 4) {
        fmt.Println(v)
        time.Sleep(10 * time.Millisecond) // simulate slightly slow consumer
    }
}
```

When the consumer is slower than the workers, the buffer fills up to its capacity. After that, workers block on send — and that is correct backpressure, telling the workers "do not get ahead of the consumer".

### 5. Fan-out a CPU-bound transformation

CPU-bound stages should fan out with N equal to the number of cores you want to use, often `runtime.NumCPU()`.

```go
package main

import (
    "crypto/sha256"
    "encoding/hex"
    "fmt"
    "runtime"
    "sync"
)

func hash(data []byte) string {
    sum := sha256.Sum256(data)
    return hex.EncodeToString(sum[:])
}

func hashStage(in <-chan []byte, n int) <-chan string {
    out := make(chan string)
    var wg sync.WaitGroup
    for w := 0; w < n; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for data := range in {
                out <- hash(data)
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func main() {
    in := make(chan []byte)
    go func() {
        defer close(in)
        for i := 0; i < 100; i++ {
            in <- []byte(fmt.Sprintf("payload-%d", i))
        }
    }()
    for h := range hashStage(in, runtime.NumCPU()) {
        fmt.Println(h)
    }
}
```

On an 8-core machine you will see roughly 8x speedup over a single worker. Past `runtime.NumCPU()`, more workers do not help and may slightly hurt due to scheduler overhead.

### 6. Fan-out an I/O-bound transformation

I/O-bound stages can use far more workers than cores; the network does the waiting, not the CPU.

```go
package main

import (
    "fmt"
    "io"
    "net/http"
    "sync"
)

func fetch(url string) (int, error) {
    resp, err := http.Get(url)
    if err != nil {
        return 0, err
    }
    defer resp.Body.Close()
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return 0, err
    }
    return len(body), nil
}

type fetchResult struct {
    url   string
    bytes int
    err   error
}

func fetchStage(in <-chan string, n int) <-chan fetchResult {
    out := make(chan fetchResult)
    var wg sync.WaitGroup
    for w := 0; w < n; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for url := range in {
                size, err := fetch(url)
                out <- fetchResult{url: url, bytes: size, err: err}
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func main() {
    urls := []string{
        "https://example.com",
        "https://example.org",
        "https://example.net",
    }
    in := make(chan string)
    go func() {
        defer close(in)
        for _, u := range urls {
            in <- u
        }
    }()
    for r := range fetchStage(in, 8) {
        if r.err != nil {
            fmt.Printf("error %s: %v\n", r.url, r.err)
            continue
        }
        fmt.Printf("ok %s: %d bytes\n", r.url, r.bytes)
    }
}
```

Sixteen workers, each handling network latency, will dramatically outperform one. The CPU is mostly idle while waiting on sockets.

### 7. Producer, fanned-out stage, consumer — full small pipeline

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func producer() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 1; i <= 20; i++ {
            out <- i
        }
    }()
    return out
}

func process(in <-chan int, workers int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range in {
                time.Sleep(20 * time.Millisecond)
                out <- v * 10
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func consumer(in <-chan int) {
    for v := range in {
        fmt.Println(v)
    }
}

func main() {
    consumer(process(producer(), 4))
}
```

The shape of the pipeline reads like a sentence: `consumer(process(producer(), 4))`. Each stage takes one input channel and returns one output channel, regardless of how many goroutines run inside.

### 8. Counting items per worker for fairness sanity check

When you first learn the pattern, it is worth verifying that the workload spreads evenly.

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

func main() {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 0; i < 100; i++ {
            in <- i
        }
    }()

    const n = 4
    var counts [n]int64
    var wg sync.WaitGroup
    for w := 0; w < n; w++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for range in {
                time.Sleep(5 * time.Millisecond)
                atomic.AddInt64(&counts[id], 1)
            }
        }(w)
    }
    wg.Wait()

    for i, c := range counts {
        fmt.Printf("worker %d processed %d\n", i, c)
    }
}
```

The distribution will be close to 25/25/25/25 because all items take the same time. With variable per-item costs, faster workers naturally pick up more.

### 9. A generic fan-out helper using Go generics

If you find yourself writing the same fan-out boilerplate over and over, abstract it. Generics make this clean.

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

// FanOut takes an input channel, a worker count, and a work function.
// It returns an output channel that will be closed when all input is processed.
func FanOut[T, U any](in <-chan T, n int, work func(T) U) <-chan U {
    out := make(chan U)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range in {
                out <- work(v)
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func main() {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 1; i <= 8; i++ {
            in <- i
        }
    }()
    out := FanOut(in, 3, func(v int) string {
        time.Sleep(50 * time.Millisecond)
        return fmt.Sprintf("processed %d", v)
    })
    for s := range out {
        fmt.Println(s)
    }
}
```

This `FanOut` helper is reusable across types: integers in, strings out; URLs in, fetch results out; bytes in, hashes out. The `work` function is the only thing that changes.

### 10. Combining fan-out with a result struct that carries the input

To correlate outputs with inputs without ordering, carry the input forward.

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Job struct {
    ID    int
    Input string
}

type Result struct {
    Job    Job
    Output string
    Err    error
}

func process(job Job) Result {
    time.Sleep(20 * time.Millisecond)
    if job.ID%7 == 0 {
        return Result{Job: job, Err: fmt.Errorf("simulated failure on id %d", job.ID)}
    }
    return Result{Job: job, Output: fmt.Sprintf("done(%s)", job.Input)}
}

func stage(in <-chan Job, n int) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range in {
                out <- process(j)
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func main() {
    in := make(chan Job)
    go func() {
        defer close(in)
        for i := 1; i <= 20; i++ {
            in <- Job{ID: i, Input: fmt.Sprintf("payload-%d", i)}
        }
    }()
    for r := range stage(in, 4) {
        if r.Err != nil {
            fmt.Printf("FAIL id=%d: %v\n", r.Job.ID, r.Err)
            continue
        }
        fmt.Printf("OK   id=%d: %s\n", r.Job.ID, r.Output)
    }
}
```

The output is out of order, but each result carries its `Job.ID` so the consumer always knows which input it came from. This is the pattern you will use in 80% of real fan-out code.

### 11. Two fanned-out stages in a row

You can chain fanned-out stages. Each has its own WaitGroup and closer.

```go
package main

import (
    "fmt"
    "strings"
    "sync"
)

func upper(in <-chan string, n int) <-chan string {
    out := make(chan string)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for s := range in {
                out <- strings.ToUpper(s)
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func exclaim(in <-chan string, n int) <-chan string {
    out := make(chan string)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for s := range in {
                out <- s + "!"
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func main() {
    in := make(chan string)
    go func() {
        defer close(in)
        for _, s := range []string{"hello", "world", "fan", "out"} {
            in <- s
        }
    }()
    for v := range exclaim(upper(in, 3), 2) {
        fmt.Println(v)
    }
}
```

Note: between the two stages, order is already lost. Compounding fan-out stages compound the loss. If you need order at the end, only one stage in the chain can be fanned out (or all must use ordered fan-out).

### 12. The wrong way (do not do this)

For contrast, here is a buggy fan-out. Read it, point at each defect, and only then look at the explanation.

```go
package main

import "fmt"

func badFanOut(in <-chan int, n int) <-chan int {
    out := make(chan int)
    for w := 0; w < n; w++ {
        go func() {
            for v := range in {
                out <- v * 2
            }
            close(out) // BUG: each worker closes out
        }()
    }
    return out
}

func main() {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 1; i <= 5; i++ {
            in <- i
        }
    }()
    for v := range badFanOut(in, 4) {
        fmt.Println(v)
    }
}
```

Defects:

1. Each worker calls `close(out)`. The first worker that exits closes it; the second worker that tries to send to a closed channel panics. Result: `panic: send on closed channel`.
2. There is no WaitGroup. There is no coordinated shutdown.
3. The output channel is unbuffered, so workers will block writing if the consumer is slow — which is normal — but the lack of a proper closer means the consumer's range never ends gracefully even if no panic happens.

The fix is the canonical template with a WaitGroup and a single closer goroutine.

---

## Coding Patterns

### Pattern: the canonical unordered fan-out

You will write this so often it should be muscle memory:

```go
func FanOut[T, U any](in <-chan T, n int, work func(T) U) <-chan U {
    out := make(chan U)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range in {
                out <- work(v)
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

Read this code until it is obvious. It is the seed of every fan-out pattern in this whole subtree.

### Pattern: the closer goroutine

The piece that closes the output channel is *not* one of the workers. It is a separate goroutine whose only job is to wait and close.

```go
go func() {
    wg.Wait()
    close(out)
}()
```

Resist the temptation to merge this into a worker, even when there is "only one worker right now". The pattern stays the same whether N is 1 or 1000.

### Pattern: one WaitGroup per stage

Each fanned-out stage owns its own WaitGroup. Do not share a WaitGroup across stages. Sharing leads to confusion about which stage is "really" done.

### Pattern: workers as anonymous functions vs named functions

For a single small transformation, anonymous functions inside the fan-out helper are fine. For a more complex worker, write it as a named function and call it from the loop.

```go
func worker(in <-chan Job, out chan<- Result) {
    for j := range in {
        out <- handle(j)
    }
}
// ...
for i := 0; i < n; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        worker(in, out)
    }()
}
```

A named worker is easier to test in isolation.

### Pattern: result struct with original input

Because order is lost, downstream often needs to know which input produced which output. Carry the input along inside the result struct:

```go
type Result struct {
    Input  Job
    Output Value
    Err    error
}
```

This is the cheapest form of "I lost order but I want to correlate" — much simpler than ordered fan-out and good enough for the majority of use cases.

### Pattern: pass concurrency from configuration, not constants

```go
type Config struct {
    HashWorkers  int
    FetchWorkers int
    WriteWorkers int
}
```

Each stage's width is named, separately tunable, and not hard-coded. In tests, set them all to 1 for determinism (single-worker fan-out preserves order trivially).

### Pattern: small generic helper, custom worker per use

The `FanOut[T, U]` helper is reusable, but for stages that need extra state (a connection pool, a configured client, a logger), define the worker inline:

```go
func crawl(in <-chan string, n int, client *http.Client, log *slog.Logger) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for url := range in {
                resp, err := client.Get(url)
                if err != nil {
                    log.Warn("fetch", "url", url, "err", err)
                    out <- Result{URL: url, Err: err}
                    continue
                }
                resp.Body.Close()
                out <- Result{URL: url, Status: resp.StatusCode}
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

The `client` and `log` are shared by all workers, but each worker uses them through their own concurrent-safe methods.

### Pattern: per-worker pre-allocated buffers

If your worker allocates a 1 MB buffer on each call, move the allocation outside the inner loop:

```go
for i := 0; i < n; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        buf := make([]byte, 1<<20) // one per worker, reused for each item
        for item := range in {
            out <- process(item, buf)
        }
    }()
}
```

Each worker has its own `buf` — no sharing, no races, no per-item allocation. This is one of the easiest performance wins in fan-out code.

### Pattern: stop a fan-out by closing its input

A fanned-out stage stops when its input is closed. To shut it down cleanly, close the input from the producer. The shutdown cascades:

1. Producer closes `in`.
2. Each worker's `range in` exhausts and returns.
3. Each worker calls `wg.Done()`.
4. Closer's `wg.Wait()` returns.
5. Closer calls `close(out)`.
6. Consumer's `range out` exhausts and returns.

This is the only correct way to stop a fan-out at the junior level. Context-based cancellation is a middle-level upgrade for "stop *immediately*, even with items still in flight".

---

## Clean Code

- **Name the helper for what the stage does, not for the fan-out shape.** `hashFiles(in, n)` is better than `fanOutHash(in, n)`. The caller cares about hashing; the fan-out is internal.
- **Keep the worker body short.** If it is more than ~20 lines, extract a function and call it from the worker loop.
- **Pass N as a parameter, not a global constant.** Tests need to vary N. Production needs to tune N. Hard-coded `4` is a smell.
- **Document ordering.** If the fan-out is unordered, say so in the doc comment of the helper. If it is ordered, say so and explain how.
- **One channel direction per parameter.** Workers should take `in <-chan T` and `out chan<- U`, never `chan T`. Direction-typed channels make worker bugs visible at compile time.
- **Avoid mixing concerns in the worker loop.** A worker reads, calls one function, writes. If you find yourself doing retries, metrics, and parsing inside the worker, those probably want their own stages.
- **Return the output channel as `<-chan T`, not `chan T`.** The caller cannot accidentally close or send to it.
- **No anonymous "magic numbers".** A value like `n*2` for the output buffer should be a named constant or a comment explaining why.
- **Test at N=1.** Every fan-out helper should be tested with a single worker. If it breaks at N=1, it is not a fan-out problem — it is a logic bug that fan-out happens to expose.
- **Avoid `sync.Mutex` inside workers.** If you find yourself reaching for a mutex, the work is probably not as independent as you thought. Restructure.

---

## Product Use / Feature

In a real product, fan-out within a stage shows up as the answer to a specific operational pain. Some examples:

- A nightly ETL job that ran in 9 hours now runs in 90 minutes because the DB-write stage was fanned out to 6 workers (one per available DB connection).
- An image-thumbnail service whose p95 latency dropped from 4 s to 800 ms after the resize stage was fanned out across CPU cores.
- A webhook dispatcher whose backlog cleared in 5 minutes instead of 5 hours after fan-out was added to the HTTP-post stage.
- A log enricher whose throughput went from 2k lines/s to 18k lines/s after the user-lookup stage was widened to 32 workers, each reusing one HTTP/2 connection.
- A bulk export job that previously timed out on large customers now completes for any customer because the rendering stage fans out to 16 workers and finishes in under the timeout.
- A search indexing pipeline that previously fell behind every Black Friday now keeps up because the tokeniser stage scales to all cores during peak.

In each case, the user-visible feature did not change. The user simply saw "faster". This is typical of pipeline tuning: the architecture stays, one stage grows wider.

The feature definition of fan-out is therefore not "do something new" but "do the same thing N times faster". When you present this to product or to a non-technical reviewer, the framing is:

- Before: throughput X, p95 Y, backlog Z.
- Change: widen one slow stage from 1 worker to N workers.
- After: throughput X', p95 Y', backlog Z'.
- Risk: ordering. Verify that no consumer downstream relies on input order.
- Cost: more CPU during peak, more concurrent connections to dependencies, more memory in flight.

That is the entire engineering decision in one screen.

---

## Error Handling

At the junior level, the simplest and best policy is: **carry the error inside the result struct.**

```go
type Result struct {
    Input Job
    Out   Value
    Err   error
}
```

The worker never returns an error to anyone; it puts the error into the result and writes it downstream. The consumer decides what to do.

```go
go func() {
    defer wg.Done()
    for j := range in {
        v, err := doWork(j)
        out <- Result{Input: j, Out: v, Err: err}
    }
}()
```

This is the right default because:

- It keeps the worker loop simple.
- It preserves backpressure — errors flow through the same channel as successes.
- It lets the consumer collect, log, retry, or fail fast, depending on the use case.
- The fan-out helper does not need any error parameter or aggregator.

What you should *not* do at this level:

- Panic on error inside the worker. Panics in goroutines kill the program.
- Log and silently swallow. The consumer needs to know.
- Use a separate error channel. It complicates correctness (when do you close it? what about ordering?) for no real benefit at this scale.

Cancellation on first error — "stop the world on any failure" — is an errgroup pattern and belongs to middle.md.

### Worker-local errors vs systemic errors

There are two kinds of errors a worker can produce:

1. **Worker-local**: this specific item failed. Bad input, transient network error, DB constraint violation. The other items can still be processed.
2. **Systemic**: the underlying resource is broken. DB is down, API key revoked, disk full. All workers will fail in the same way.

The result-struct pattern handles both, but the consumer's reaction should differ. For a worker-local error, log and continue. For a systemic error, stop the pipeline. At junior level, you can detect "systemic" simply by counting consecutive failures and stopping if the count crosses a threshold. More elegant solutions live at middle level (errgroup, context cancellation, circuit breakers).

### A small example of error counting

```go
fail := 0
for r := range stage {
    if r.Err != nil {
        fail++
        if fail > 100 {
            log.Fatal("too many errors, aborting")
        }
        continue
    }
    fail = 0
    handle(r)
}
```

This is crude but effective. In production you would log structured error counts to a metrics system, but the principle is the same: the consumer is in charge of "do I keep going?".

---

## Security Considerations

Fan-out is not specifically a security topic, but a few things bite at this level:

- **Resource exhaustion via unbounded N.** If `n` comes from user input or untrusted config, an attacker can request `n = 1_000_000` workers and exhaust memory or file descriptors. Always clamp N to a sane upper bound.
- **Connection limits on external services.** Fan-out an HTTP call to 500 workers and you may DoS the third party, breaking your contract with them and possibly getting your IP banned.
- **Database connection limits.** Postgres default is 100 connections. Fanning out to 200 DB writers gives you connection-exhaustion errors and unhappy DBAs.
- **Per-tenant fairness.** A naive fan-out treats all input items the same. In a multi-tenant system, one noisy tenant can starve others by filling the queue. This is a real production issue addressed at senior and professional level.
- **Log injection.** When all workers log to the same stream, malicious input that controls log fields (worker IDs, item IDs) can confuse later log parsing. Always escape user-controlled fields in log lines.
- **Shared mutable state.** Workers must not share mutable state without synchronisation. The whole appeal of fan-out is statelessness; keep it that way.
- **Authentication tokens.** If each worker has its own auth token, ensure tokens are not logged. If workers share a token (typical for a service-to-service call), watch for rate limiting by the upstream.
- **PII in error messages.** Workers that include input data in error messages may leak PII when results flow into logs. Sanitise.
- **Timing attacks.** Order of completion is observable. If timing leaks sensitive information (cryptographic comparison, password verification), do not fan out that stage.
- **Replay protection.** If each item carries a nonce or token, two workers must not process the same nonce. Channels guarantee single delivery, but external retries or buffering must not duplicate.

---

## Performance Tips

- **Pick N by the bottleneck, not by intuition.** CPU-bound: roughly `runtime.NumCPU()`. Network-bound: many more, up to the connection limit of the remote. Database-bound: at most the connection-pool size.
- **Measure with one worker first.** Compute the throughput of N=1, then verify that N workers give you roughly N times that until saturation. If it does not, the bottleneck is elsewhere.
- **Don't over-buffer.** A buffer of N to 2N is usually enough. Big buffers hide problems and inflate memory.
- **Watch out for "false sharing" of results.** If the worker writes into a shared slice indexed by item ID without synchronisation, you have a race. The channel-based pattern in this file avoids this entirely.
- **Reuse expensive objects.** If the worker needs an HTTP client, a regex, a hasher — create it *outside* the worker loop and reuse it.
- **Pre-allocate buffers in the worker.** A worker that allocates a 1 MB buffer per call and throws it away is wasting more than the call.
- **Profile, do not guess.** Use `pprof` to see where the worker actually spends time. The bottleneck is not always where you think.
- **Watch CPU utilisation.** If you have 8 cores but CPU is at 100% across all of them, you are CPU-bound and more workers will not help. If CPU is at 10% and all workers are blocked on the network, you can add more workers.
- **Reuse `bufio` readers/writers.** A buffered reader created per item is much slower than one reused across items.
- **Avoid `fmt.Sprintf` hot paths.** It allocates. Use `strconv` and byte slices where it matters.
- **Use sync.Pool for short-lived heavy allocations.** Workers naturally reuse pool objects since each one drains many items in sequence.
- **Aggregate metrics outside the worker.** Sending a metric on every item adds overhead. Counters per worker, flushed periodically by a separate goroutine, scale better.

---

## Best Practices

- Always close the output channel from a single dedicated closer goroutine.
- Always use a WaitGroup whose counter matches the number of workers exactly.
- Always declare worker functions with directional channel types.
- Always pass N as a parameter to the fan-out helper.
- Always document whether the helper preserves order.
- Prefer carrying errors in the result struct over a separate error channel.
- Prefer named worker functions for non-trivial work.
- Prefer small buffers; large buffers are a smell.
- Verify with `go test -race` that no shared state is silently mutated.
- Add a `pprof` block or simple counters to confirm worker utilisation in production.
- Default to unordered fan-out. Only adopt ordered fan-out when the downstream really needs it.
- Test the empty input case explicitly.
- Test the N=1 case explicitly.
- Test the producer-error case (producer panics or returns early).
- Test the consumer-abandons case at middle level when you learn cancellation.
- Always return `<-chan T` from a fan-out helper, not `chan T`.
- Wrap each worker body in `defer recover()` if it calls untrusted code.
- Log worker entry/exit at debug level so leaks are visible.
- Make N configurable, not hard-coded, from day one.

---

## Edge Cases & Pitfalls

- **Empty input.** If `in` is empty and closed immediately, the workers exit immediately, the WaitGroup counter reaches zero, and the closer closes `out`. Verify your code handles this gracefully — no items, no panic.
- **N = 0.** A fan-out with zero workers never drains the input. The closer waits forever. Guard against `n < 1`.
- **N = 1.** This is the trivial case and should still work. Use it as a sanity test.
- **Slow downstream.** If the consumer is much slower than the workers, all workers block on send to `out`. This is correct backpressure but may be surprising the first time you see it.
- **Panic in worker.** A panic in any one worker crashes the program. Wrap the worker body in `defer recover()` if work items can produce panics from third-party code.
- **Worker leak when in is never closed.** If your producer forgets to `close(in)`, workers `range` forever. The closer never fires, and the consumer hangs. Producers must close their output.
- **Items lost when consumer abandons.** If the consumer stops reading from `out` but does not signal the producer or workers, workers block on send, the WaitGroup never reaches zero, the closer never runs. Goroutines leak. We will fix this with context cancellation in middle.md.
- **Mixed item sizes.** If most items are fast and a few are very slow, a single slow item can hog a worker. Throughput is fine on average but tail latency suffers. This is a structural property of fan-out and is addressed at senior level with priority queues or sub-stage tuning.
- **Producer dies mid-stream.** If the producer panics before closing `in`, workers wait forever. Make sure your producer has `defer close(in)` in its own goroutine.
- **Closer fires too early.** Only one source of `Wait()` completion: all `Done()` calls happen. If anyone calls `Done()` without a matching `Add(1)`, the counter goes negative and the program panics.
- **Goroutine count balloons.** If a fan-out is nested inside a per-request goroutine, you get N workers per request. A thousand requests per second means a thousand fan-outs alive at once. Move fan-outs to be long-lived where possible.
- **Items processed twice.** If two pipelines share the same input channel, both pipelines' workers compete on it. Each item is processed once total, not once per pipeline. This is usually a bug.
- **Channel send blocks forever.** If the output channel is read by nobody (e.g., the consumer goroutine returned early), every worker eventually blocks on send.

---

## Common Mistakes

- **Closing `out` from a worker.** Causes `panic: send on closed channel` in the other workers.
- **Calling `wg.Add(1)` inside the goroutine.** Race: the closer's `wg.Wait()` may run before `Add` and return immediately. Always `Add` before `go func()`.
- **Forgetting `defer wg.Done()`.** Worker exits on a path that does not call `Done`, the closer waits forever, the consumer hangs.
- **Using a single `chan T` instead of `<-chan T` and `chan<- U` in the worker signature.** Direction is one of Go's quietest safety features.
- **Spawning goroutines inside the worker loop.** Now there are N*M goroutines, the structure is unclear, and lifetimes are confused.
- **Sharing a result slice with index assignment.** Looks faster than a channel; introduces a data race.
- **Hard-coding N.** Hard to test, hard to tune.
- **Treating fan-out as a way to add parallelism to anything.** Fan-out only helps if the worker actually has parallelisable work. Fanning out a stage that already saturates a single core does nothing.
- **Confusing fan-out with fan-in.** Fan-out is one producer, many workers. Fan-in is many producers, one consumer. In a fanned-out pipeline stage, the *output side* is implicitly fan-in (many workers writing to one downstream channel), but the fan-in is automatic — not a separate construct.
- **Using a slice to "fan out" instead of channels.** A slice plus N goroutines indexing into it is not fan-out; it is shared state. Stick to channels.
- **Closing `in` from inside a worker.** The worker is a consumer of `in`, not its owner. Closing `in` from a worker is a category error.
- **Mixing fan-out with shared mutable state.** Two workers updating the same map crash with "concurrent map writes" at runtime.
- **Sending to `out` after `wg.Done`.** Done says "I am leaving"; sending to `out` after that is a violation of your own contract with the closer.
- **Counting items in a non-atomic int from each worker.** Use `atomic` or a per-worker counter.

---

## Common Misconceptions

- **"More workers is always faster."** False. Beyond the saturation point of the bottleneck, more workers add scheduling overhead and contention and slow you down.
- **"Fan-out preserves order if I close the output channel correctly."** False. Closing has nothing to do with order. Order is lost the moment two goroutines race on a send.
- **"Workers should share state for efficiency."** Usually false. The cost of synchronising shared state often dwarfs the cost of allocating fresh state per worker.
- **"Channels are slow, I should use a mutex-protected slice."** Almost always false at this level. Channels are fast enough that they are rarely the bottleneck in a fan-out stage; the workload is.
- **"The closer goroutine is optional."** False in fan-out. With one worker you could `defer close(out)` inside the worker. With many workers, you must not.
- **"Fan-out makes a single request faster."** False. It makes throughput faster across many requests, not any single one.
- **"Fan-out is the same as worker pool."** Mostly the same in practice. A worker pool tends to be long-lived (request-scoped or process-scoped); a fan-out in a pipeline is usually scoped to the lifetime of one input stream.
- **"I can replace `for v := range in` with `select` and it will be more efficient."** Almost never. `range` is the cleanest expression; reach for `select` only when you also need to listen to a `ctx.Done()`.
- **"Fan-out is bound by `GOMAXPROCS`."** False for I/O-bound work. Goroutines blocked on the network are parked off the OS thread; thousands can wait at once.
- **"Fan-out improves CPU cache hits."** False, often the opposite. Fan-out tends to spread work across cores, which can reduce cache locality. Whether this matters depends on the workload.

---

## Tricky Points

- **The number of goroutines is N+1, not N.** Each fan-out spawns N workers plus one closer.
- **The closer is the only goroutine that touches `wg.Wait()`.** Do not call `Wait` anywhere else for that group.
- **The `for v := range in` loop ends when `in` is closed *and* drained.** The worker does not exit on `close(in)` alone — it processes all remaining buffered items first.
- **`close(in)` is not a signal to *abort* the workers.** It is a signal that "no more items are coming". Workers still drain whatever is left. If you want to abort, use context cancellation (middle level).
- **The output channel can be buffered without changing correctness.** The pattern is identical for buffered and unbuffered output.
- **The input channel is shared.** All N workers share one channel; Go guarantees that exactly one goroutine receives each value, even under concurrent reads.
- **`wg.Add(n)` once before the loop is equivalent to `wg.Add(1)` inside the loop.** Either is correct as long as `Add` happens before `go`.
- **The closer goroutine costs almost nothing.** It is one goroutine, waiting on a counter, that runs for microseconds total. Do not optimise it away.
- **Workers do not need to know N.** A worker only knows its own loop and its own channels. The fact that there are N of them is invisible to it.
- **A `nil` channel blocks forever on send and on receive.** If you accidentally pass a nil input channel to your fan-out, the workers block immediately and the closer waits forever. The bug is silent; no error, just hang.
- **Send and receive on the *same* channel from the *same* goroutine can deadlock.** If your worker reads `in` and also writes to `in` (e.g., to retry), you can deadlock yourself. Fan-out reads from `in` and writes to a different channel `out`; never to `in`.
- **`range` on a closed buffered channel still yields buffered items.** Closing a channel does not discard pending data.
- **A panic inside a deferred close that is hidden by another panic can disappear.** Do not put `close(out)` inside a worker's defer.

---

## Test

```go
package fanout

import (
    "sort"
    "sync"
    "testing"
)

func square(v int) int { return v * v }

func fanOut(in <-chan int, n int, work func(int) int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range in {
                out <- work(v)
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func TestFanOutProcessesEachItemExactlyOnce(t *testing.T) {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 1; i <= 50; i++ {
            in <- i
        }
    }()

    var got []int
    for v := range fanOut(in, 8, square) {
        got = append(got, v)
    }
    if len(got) != 50 {
        t.Fatalf("expected 50 outputs, got %d", len(got))
    }
    sort.Ints(got)
    for i := 1; i <= 50; i++ {
        if got[i-1] != i*i {
            t.Fatalf("expected %d at index %d, got %d", i*i, i-1, got[i-1])
        }
    }
}

func TestFanOutClosesOutputExactlyOnce(t *testing.T) {
    in := make(chan int)
    close(in)
    out := fanOut(in, 4, square)
    // out must close even with empty input.
    _, ok := <-out
    if ok {
        t.Fatal("expected closed channel on empty input")
    }
}

func TestFanOutWithSingleWorker(t *testing.T) {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 1; i <= 5; i++ {
            in <- i
        }
    }()
    got := 0
    for range fanOut(in, 1, square) {
        got++
    }
    if got != 5 {
        t.Fatalf("expected 5 outputs, got %d", got)
    }
}

func TestFanOutWithManyWorkers(t *testing.T) {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 1; i <= 1000; i++ {
            in <- i
        }
    }()
    got := 0
    for range fanOut(in, 100, square) {
        got++
    }
    if got != 1000 {
        t.Fatalf("expected 1000 outputs, got %d", got)
    }
}

func TestFanOutNoLeaks(t *testing.T) {
    // This is a smoke test; run with -race.
    for trial := 0; trial < 100; trial++ {
        in := make(chan int)
        go func() {
            defer close(in)
            for i := 0; i < 10; i++ {
                in <- i
            }
        }()
        for range fanOut(in, 4, square) {
        }
    }
}
```

Run with `go test -race`. All tests should pass. The `-race` flag is non-negotiable for fan-out code; it catches the kind of shared-state bug that is the leading cause of "works on my machine, fails in production".

### Benchmarking

```go
func BenchmarkFanOut(b *testing.B) {
    for _, n := range []int{1, 2, 4, 8, 16, 32} {
        b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                in := make(chan int)
                go func() {
                    defer close(in)
                    for j := 0; j < 1000; j++ {
                        in <- j
                    }
                }()
                for range fanOut(in, n, square) {
                }
            }
        })
    }
}
```

The benchmark will show diminishing returns past a certain N. For a trivial `square` function the returns diminish quickly because the per-item work is too small to benefit from concurrency. For a 50 ms `time.Sleep` per item, the returns are linear up to the number of items.

---

## Tricky Questions

1. *Why does the closer have to be a separate goroutine? Why can't I just `wg.Wait(); close(out)` after the for loop?*
   Because the for loop is inside `main` or the caller, which is also the consumer reading from `out`. `wg.Wait()` would block waiting for workers, but workers are blocked sending to `out` because the consumer is not reading yet. Deadlock.

2. *I have one worker. Do I still need a WaitGroup and a closer?*
   You technically do not — one worker can `defer close(out)` itself. But keeping the same structure for N=1 means going from one worker to many is a one-line change. Consistency is worth more than the line you save.

3. *If two workers receive the same item from the channel, is that possible?*
   No. Go guarantees each channel send is delivered to exactly one receive operation. The channel itself coordinates the dispatch.

4. *Can I use the same channel for input and output of the same stage?*
   No, never. A worker reading and writing to the same channel can read its own output, creating duplicates and infinite loops. Always input and output are separate channels.

5. *Why does my output never close?*
   Most common cause: the producer never closes the input channel. Workers `range` forever, the WaitGroup never reaches zero, the closer never runs.

6. *Is fan-out free?*
   No. Each worker is a goroutine with its own stack. Spawning thousands of workers per stage costs memory and scheduler attention. At hundreds of workers you start seeing diminishing returns from scheduler contention.

7. *Does fan-out improve latency?*
   Throughput yes, single-item latency no. A single item still takes one worker's full time.

8. *I added more workers and throughput went down. Why?*
   Either you exhausted the bottleneck (CPU, DB connections, network bandwidth) and added overhead, or you added contention on a shared resource (a mutex, a connection pool that now thrashes).

9. *What if my worker panics?*
   The whole program crashes. At junior level, treat workers as functions that must not panic. Wrap third-party calls in `defer recover()` if needed.

10. *Order of outputs is non-deterministic across runs. Is that a problem?*
    Only if your downstream depends on order. If yes, you need ordered fan-out (middle.md). If no, this is the expected and correct behaviour.

11. *Can I close the input channel from inside the fan-out function?*
    No. The input channel is owned by the producer, not by the fan-out stage. Closing it from the wrong side breaks the producer-closes-its-output rule and may cause panic in the producer.

12. *What is the difference between `wg.Add(n)` before the loop and `wg.Add(1)` inside the loop?*
    Functionally none, as long as Add happens before the goroutine starts. Either is acceptable. `Add(1)` inside the loop is more flexible if the loop body is complex.

13. *Should I use buffered or unbuffered channels for `in` and `out`?*
    The input channel's buffering is decided by the producer, not the fan-out. The output channel is unbuffered by default; add a small buffer (N to 2N) if benchmarks show backpressure-induced underutilisation.

14. *Can I dynamically add or remove workers during a run?*
    Not with the simple template in this file. Adding workers mid-run requires synchronisation on the WaitGroup that the simple template does not handle. This is a senior-level pattern.

15. *Why use a channel and not a sync.Cond?*
    Channels combine signalling and data transfer in one operation. `sync.Cond` requires a separate signalling step plus a shared queue. The channel-based pattern is simpler and almost always correct enough.

---

## Cheat Sheet

```go
// Canonical unordered fan-out.
func FanOut[T, U any](in <-chan T, n int, work func(T) U) <-chan U {
    out := make(chan U)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range in {
                out <- work(v)
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

Rules of thumb:

- N for CPU-bound: ~`runtime.NumCPU()`.
- N for network-bound: up to remote-side connection limit, often 16–256.
- N for DB-bound: at most the connection-pool size.
- Output buffer: N to 2N is plenty.
- Always close the output from one closer goroutine.
- Always carry errors in the result struct.
- Default to unordered. Only add ordering if the consumer needs it.
- Always `wg.Add` before `go`.
- Always `defer wg.Done()` inside the goroutine.
- Always test at N=1 to ensure logic is correct independent of fan-out.
- Always test at N>>1 to ensure shutdown and ordering behaviour.
- Always run with `-race`.

---

## Self-Assessment Checklist

- [ ] I can write the canonical unordered fan-out template from memory.
- [ ] I can explain why the closer is a separate goroutine.
- [ ] I can spot a fan-out where the workers close the output channel and predict the bug.
- [ ] I can pick N appropriately for CPU-bound, network-bound, and DB-bound stages.
- [ ] I know that order is lost in unordered fan-out and I can demonstrate it with a small program.
- [ ] I carry errors in the result struct rather than a side channel.
- [ ] I always use directional channel types in worker signatures.
- [ ] I never call `wg.Add(1)` inside the goroutine.
- [ ] I can write a small test that asserts "every input item appears in the output exactly once".
- [ ] I know that the consumer must keep reading the output or the workers will block.
- [ ] I know that closing the input channel is the producer's job, not the stage's.
- [ ] I can chain two fanned-out stages and reason about ordering at each stage boundary.
- [ ] I can pre-allocate per-worker buffers when the work needs them.
- [ ] I can describe what happens when N=0 and when the input channel is nil.
- [ ] I can name three security concerns specific to fan-out (resource exhaustion, third-party DoS, per-tenant unfairness).

---

## Summary

Fan-out within a pipeline stage is the standard cure for "one slow stage poisons the whole pipeline". You spawn N worker goroutines that share an input channel, each one drains the channel, and all of them write into a single output channel. A dedicated closer goroutine waits on a WaitGroup and closes the output exactly once when all workers exit.

The pattern multiplies throughput but loses order. For most stages — independent network calls, independent hashing, independent DB writes — order does not matter and unordered fan-out is exactly the right tool. When ordering matters, you move on to sequence numbers and reorder buffers, which we cover in middle.md.

Three rules will protect you from almost every fan-out bug at this level: close the output from one closer, add to the WaitGroup before `go`, and use directional channel types. If you internalise these and the canonical template, you can write a correct fanned-out pipeline stage in any project.

Beyond correctness, the next concern is *how many workers*. CPU-bound work matches CPU cores. Network-bound work can use many more workers because each one is mostly waiting. Database-bound work is capped by the connection pool. Hard-coding N is a smell; thread it through configuration so it can be tuned in tests and in production without code changes.

The pattern composes. A pipeline with three stages, each fanned out to its own N, is a small extension of what you learned here. The only new concern as the pipeline grows is keeping the lifecycle clean — closing inputs in order, propagating cancellation, and not leaking goroutines.

---

## What You Can Build

- A multi-threaded image thumbnailer that reads filenames from stdin, resizes in parallel, and writes thumbnails to disk
- A URL prober that takes a list of 10k URLs and reports HTTP status, latency, and body size, finishing in seconds instead of minutes
- A SHA-256 hasher that walks a directory tree and writes a manifest of file hashes
- A simple log enricher that reads log lines, fetches user metadata via HTTP, and writes enriched lines
- A toy ETL that pulls rows from CSV, parses, validates, and writes to a database, with the write stage fanned out to match the connection-pool size
- A webhook fan-out service that delivers events to N customer endpoints in parallel
- A duplicate-finder that hashes files and groups identical hashes, with the hash stage fanned out
- A bulk DNS resolver that resolves 100k hostnames
- A markdown-to-HTML converter that processes a thousand pages, each rendered by an independent worker
- A "diff this directory against that bucket" tool that fans out the per-file compare across cores
- A bulk image-OCR job that fans out the OCR stage and writes structured JSON to a database
- A nightly "verify all customer integrations" job that fans out per-customer pings

Pick one. Build it. Watch the wall-clock time drop as you increase N. Watch what happens at N=1, N=4, N=64. Watch what happens when the downstream consumer stops reading. These experiments make the pattern stick.

---

## Further Reading

- Sameer Ajmani, "Go Concurrency Patterns: Pipelines and cancellation", go.dev/blog/pipelines
- Bryan C. Mills, "Rethinking Classical Concurrency Patterns", GopherCon 2018
- Katherine Cox-Buday, *Concurrency in Go* (O'Reilly), chapter on pipelines and fan-out/fan-in
- Dave Cheney, "Channel Axioms" — the rules that make fan-out reasonable
- Effective Go, the "Channels" section
- The Go standard library: `sync.WaitGroup`, `runtime.NumCPU`
- The Go FAQ on goroutine scheduling
- Rob Pike, "Concurrency is not parallelism" (talk) — the foundational distinction
- The Go source code: `src/runtime/chan.go` for the channel implementation; not bedtime reading but instructive

---

## Related Topics

- Producer-consumer pattern (the simpler shape this generalises)
- Fan-in (multiple producers into one channel)
- Worker pool (long-lived workers draining a job queue)
- Context cancellation (how to stop fan-out cleanly — middle.md)
- errgroup (errors and cancellation across a fan-out — middle.md)
- Ordered fan-out with sequence numbers (middle.md)
- Backpressure (how slow consumers slow producers)
- Tail-latency tuning (senior and professional level)
- Rate limiting (often paired with fan-out to respect external limits)
- Adaptive concurrency (dynamic N — professional level)
- Pipelining vs batching (chapter 4 of this section: batching can reduce the need for fan-out)
- Fan-out across pipelines (running many independent pipelines in parallel, a different shape)

---

## Diagrams & Visual Aids

Serial stage:

```
in -> [worker] -> out
```

Fan-out stage with four workers:

```
        +-> [worker 0] -+
        |               |
in ---->+-> [worker 1] -+----> out
        |               |
        +-> [worker 2] -+
        |               |
        +-> [worker 3] -+
```

Lifecycle:

```
producer closes in
   |
   v
range loops in workers end
   |
   v
each worker calls wg.Done
   |
   v
wg.Wait in closer returns
   |
   v
closer calls close(out)
   |
   v
consumer's range over out ends
```

Throughput vs N (idealised, until bottleneck saturates):

```
throughput
  |
  |              .........
  |          ....         saturation
  |       ...
  |     ..
  |    .
  |   .
  |  .
  | .
  +-------------------------> N
  1   2  4   8  16   32  64
```

The flat region after saturation is where adding more workers stops helping — often the moment to stop tuning N and look at the bottleneck resource instead.

Item ownership during fan-out:

```
in: [1] [2] [3] [4] [5] [6] [7] [8]
      v   v   v   v       v       v
    w0  w1  w2  w3      w1      w0
                  v   v       v       v
                  w0  w2      w3      w1
out: 2 1 3 4 ... (some permutation of inputs after processing)
```

The order of `in` does not correspond to the order of `out`, but every input shows up in the output exactly once.

Pipeline with two fanned-out stages:

```
source --> [stage A: N=2] --> [stage B: N=4] --> sink
              w0  w1            w0 w1 w2 w3
```

Each stage has its own WaitGroup, its own closer, and its own output channel. The pipeline as a whole has 2 + 4 + 2 = 8 goroutines for the worker stages alone (workers plus closers), in addition to source and sink.

The mental model in one paragraph: every fanned-out stage is a small black box with a uniform shape — one input channel in, one output channel out, N workers inside, one closer at the end. Pipelines compose these boxes in series. The complexity of the whole pipeline grows linearly in the number of stages; the per-stage complexity is the canonical fifteen-line template you have now seen a dozen times.

---

## Appendix A: Walking Through the Canonical Template, Line by Line

The template again, with line numbers and an explanation of each:

```go
1  func FanOut[T, U any](in <-chan T, n int, work func(T) U) <-chan U {
2      out := make(chan U)
3      var wg sync.WaitGroup
4      for i := 0; i < n; i++ {
5          wg.Add(1)
6          go func() {
7              defer wg.Done()
8              for v := range in {
9                  out <- work(v)
10             }
11         }()
12     }
13     go func() {
14         wg.Wait()
15         close(out)
16     }()
17     return out
18 }
```

Line 1: the helper is generic over input type `T` and output type `U`. The work function maps `T` to `U`. In a non-generic codebase, you write one of these per concrete pair of types and that is fine.

Line 2: the output channel is unbuffered by default. If you measure backpressure underutilisation, change to `make(chan U, n*2)` or similar.

Line 3: one WaitGroup per stage. Never shared across stages.

Line 4: the loop that spawns workers. Run it `n` times. Note that `i` is not used inside the worker; if you need an ID, pass it as `go func(id int) { ... }(i)`.

Line 5: `Add` happens before `go`. Always. This is the single most important line ordering in the whole pattern.

Line 6: the worker goroutine starts. Note no parameters; the worker captures `in`, `out`, `work`, and `wg` from the enclosing function. The capture is fine because none of those are loop variables — they are all stable across iterations.

Line 7: `defer wg.Done()` is the very first statement in the worker. This guarantees `Done` runs even if the worker body panics or returns early.

Line 8: `for v := range in` drains the input channel until it closes. Each iteration gets exactly one value, and Go's channel runtime guarantees that no two workers ever see the same value.

Line 9: the work, then the send. If the consumer is slow, `out <-` blocks here. That is backpressure.

Line 13–16: the closer. A separate goroutine that does nothing except wait for all workers and then close the output. Notice it is `go func() { ... }()`, not a deferred call from the helper. The helper returns immediately so the consumer can start reading; the closer is asynchronous.

Line 17: returning the output channel as `<-chan U` — receive-only — prevents the caller from accidentally writing to or closing it.

That is the whole template, every line accounted for. If you can read this without consulting notes, you understand fan-out well enough to write correct production code at the junior level.

---

## Appendix B: A Day in the Life of a Worker

Picture a single worker goroutine, one of N, in the middle of its life. Step through what it does.

1. **Birth.** The fan-out helper executed `go func() { ... }()`. The Go runtime allocated a goroutine struct (around 200 bytes) and a 2 KB stack. The goroutine landed on a runqueue. Some microseconds later, the scheduler picked it up.
2. **First read.** It executes `for v := range in`. The runtime checks whether `in` has a buffered item. If yes, it takes it. If no, the goroutine parks itself on `in`'s receive queue and yields the OS thread.
3. **Wake-up.** The producer sends a value. The runtime takes one parked receiver and resumes it. Our worker now has `v`.
4. **Work.** It calls `work(v)`. This might take 100 ns (a hash computation) or 100 ms (an HTTP call). The OS thread runs the work; if the work blocks on syscall I/O, the runtime parks the goroutine and uses the OS thread for someone else. Our worker is patient.
5. **Send.** It computes the result and runs `out <- result`. If a consumer is reading, the value is handed directly. If not, the worker parks on `out`'s send queue.
6. **Repeat.** The loop continues. Steps 2–5 repeat for every item.
7. **Death.** Eventually `range in` returns because `in` was closed by the producer and is empty. The defer fires: `wg.Done()`. The worker exits. Its stack is freed.

Multiply by N workers, all running in parallel, sharing the same `in` and `out`. The picture above happens N times at once, with the channel coordinating dispatch.

The Go runtime is what makes this cheap. In another language you would write an `Executor` and a `ThreadPool` and a `BlockingQueue`. In Go you write fifteen lines and the runtime handles the rest.

---

## Appendix C: Sketching a Real-World Pipeline

Suppose you are writing a service that processes uploaded receipts: image preview, OCR, parsing, validation, DB write. Sketch the stages:

```
upload -> [thumbnail] -> [OCR] -> [parse] -> [validate] -> [DB write] -> done
```

Measure each stage's per-item time, in production or in a benchmark:

```
thumbnail: 30 ms (CPU)
OCR:        400 ms (CPU + GPU)
parse:      5 ms  (CPU)
validate:   20 ms (CPU + small DB lookups)
DB write:   80 ms (DB)
```

Total per-item if all stages were serial in one goroutine: 535 ms. If items arrive at 10/s, you need at least 5.35 "effective workers" of capacity. The OCR stage alone needs about four workers to keep up.

The simplest fan-out plan:

- OCR: 4 workers (CPU-bound, fan-out across cores)
- DB write: 6 workers (matches connection pool size)
- Other stages: 1 worker each (already fast enough)

Pipeline throughput becomes limited by whichever stage is still the bottleneck. After OCR is fanned out to 4, the OCR stage processes 4 × (1000/400) = 10 items/s. Match the input rate.

This is the kind of back-of-the-envelope thinking you do every time you design a fan-out plan. Measure, identify the bottleneck, widen it just enough.

---

## Appendix D: Common Layouts on a Whiteboard

When you sketch fan-out on a whiteboard, you will draw one of these three layouts. Each is a sketch you should recognise instantly.

**Layout 1: serial baseline.**
```
[A] -> [B] -> [C]
```
One goroutine per stage. The slowest stage is the bottleneck.

**Layout 2: one stage fanned out.**
```
[A] -> [B x 4] -> [C]
```
Stage B is now four workers. Pipeline throughput is bounded by `max(A, B/4, C)` (in per-second terms).

**Layout 3: multiple stages fanned out.**
```
[A x 2] -> [B x 4] -> [C x 3]
```
Each stage has its own width. Pipeline throughput is bounded by the narrowest effective width.

A diagram like this should be the first thing on the whiteboard in any "the pipeline is slow" conversation. It forces you to identify the bottleneck before you change any code.

---

## Appendix E: A Mental Checklist Before You Press "Run"

Before you run a fan-out program for the first time, walk through this list:

1. Is `in` closed by the producer? If yes, where? Trace it.
2. Is `out` closed by exactly one goroutine? Trace it.
3. Is `wg.Add` called exactly N times, before any goroutine starts?
4. Is `wg.Done` called exactly once per worker, via `defer`?
5. Is `wg.Wait` called exactly once, in the closer?
6. Is the consumer reading from `out`? If not, who is?
7. Will the consumer keep reading until `out` is closed?
8. Does the worker share any mutable state with another worker? If yes, is it safe under `-race`?
9. Is N a sensible number for the bottleneck (cores, connections, rate limits)?
10. What happens if `n == 0` or `in` is `nil`? Have you guarded against it?

Run through this list for any new fan-out you write. Most production bugs are violations of items 1, 2, or 8.

---

## Appendix F: Vocabulary Recap

You should be able to use these terms naturally in conversation. If any feels unclear, return to the Glossary section.

- pipeline, stage, worker, fan-out, fan-in, width, concurrency
- closer goroutine, WaitGroup, range over channel
- ordered fan-out vs unordered fan-out
- throughput vs latency
- bottleneck, saturation
- backpressure
- independent items, sequence number
- competing consumers

Mastery is being able to say "this stage's width is too low for the bottleneck, and the consumer is single-threaded so backpressure is high" and have it mean exactly one thing to your team.

