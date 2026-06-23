---
layout: default
title: Junior
parent: Backpressure
grand_parent: Production Patterns
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/01-backpressure/junior/
---

# Backpressure — Junior Level

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
> Focus: "Why does my queue grow forever? What does it mean to put a number in `make(chan T, N)`?"

**Backpressure** is the simplest idea in concurrent systems and the one that beginners reach for last. It is the practice of letting a slow consumer say "I am full, slow down" to a fast producer — instead of pretending the consumer can keep up.

Imagine a water tap above a glass. The tap can run as fast as it likes; the glass can hold a fixed amount. If you keep pouring, water spills onto the table. The right answer is not a bigger glass — it is a tap that *stops* when the glass is full. That stopping is backpressure.

In Go, the most direct mechanism for backpressure is the **bounded channel**:

```go
ch := make(chan Job, 100)
```

When the channel holds 100 jobs and the producer tries to send the 101st, the producer **blocks**. It does not crash. It does not silently drop the job. It does not allocate more memory. It waits. That waiting is the producer feeling the consumer's pressure.

This single sentence — "the producer blocks" — is more important than it looks. It is the entire engine of in-process backpressure. Every other technique you will read about in the middle and senior pages (semaphores, AIMD, token buckets, gRPC flow control) is a more sophisticated version of the same idea: *the producer must be slowed down by the consumer, not by hope*.

After reading this file you will:

- Understand the difference between an unbounded queue and a bounded channel
- Know why `make(chan T)` and `make(chan T, 10_000_000)` are both usually wrong
- Be able to spot the "unbounded buffer" antipattern in code
- Use `select` with `default` to *try* a send and give up
- Use `context.Context` to put a timeout on a send
- Recognise that backpressure is a property of the *boundary*, not of any one component
- Know the three first-line responses when the queue is full: **block**, **drop**, or **reject**
- Build a small HTTP server that returns 503 under load instead of melting down
- Build a small worker pool with `Submit`, `TrySubmit`, and `SubmitCtx` methods
- Read a metric like "buffer fill = 95/100" and know whether to be worried

You do not need to know about AIMD, token buckets, semaphores, queue theory, or distributed flow control yet. Those come at the middle and senior levels. This file is about the moment you decide how big your buffer is and what happens when it fills.

---

## Prerequisites

- **Required:** Working knowledge of goroutines and the `go` keyword.
- **Required:** Working knowledge of channels: `make(chan T)`, `ch <- x`, `<-ch`, and the difference between buffered and unbuffered.
- **Required:** Awareness of `select` with multiple cases.
- **Required:** Ability to read and run a small `main` package — `go run main.go` and inspect output.
- **Helpful:** A first encounter with `context.Context` and `context.WithTimeout`.
- **Helpful:** Awareness that goroutines and channel buffers live in heap memory and contribute to RSS.
- **Helpful:** Have once used `top`, `htop`, or `Activity Monitor` to watch a Go program's memory grow. The visual reinforces why bounded buffers matter.

If you can write a producer-consumer with one goroutine and one channel, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Backpressure** | A signal from a downstream consumer to an upstream producer that means "slow down." The opposite of an unbounded queue. |
| **Bounded channel** | A channel made with a fixed buffer: `make(chan T, N)`. Sends block when the buffer is full. |
| **Unbuffered channel** | A channel with buffer 0. Sender and receiver must rendezvous; the send completes only when a receive is happening. The strictest form of backpressure. |
| **Blocking send** | A send (`ch <- x`) where the goroutine pauses until the channel has room. This is Go's default behaviour and the simplest form of backpressure. |
| **Non-blocking send** | A send wrapped in `select` with a `default` case. If the channel is full, the `default` runs and the send is skipped. |
| **Load shedding** | Dropping work on purpose when the system is overloaded. The most common form is "if the queue is full, return an error to the caller." |
| **Drop policy** | The rule for choosing *which* work to drop. Newest? Oldest? Lowest priority? At junior level the answer is usually "newest" because it is simplest. |
| **Producer** | A goroutine that puts work into a channel. |
| **Consumer / Worker** | A goroutine that takes work out of a channel and does it. |
| **Queue** | Any data structure that holds work between producer and consumer. A buffered channel *is* a queue. |
| **Unbounded queue** | A queue with no maximum size. In Go this looks like an `append` to a slice with no checks, or a `list.PushBack` with no limit. Almost always a bug. |
| **Saturation** | The state where the consumer is the bottleneck and the buffer between producer and consumer is full. |
| **HTTP 503 / 429** | The two HTTP status codes a service returns when it is overloaded (Service Unavailable) or rate-limited (Too Many Requests). The natural way to surface backpressure to a remote caller. |
| **Admission control** | Deciding at the *entry* of a system whether to accept a new request. The earliest form of backpressure: if you are full, never start the work. |
| **In-flight** | The number of items currently being processed (not waiting in queue, not finished). Sometimes called "work in progress" (WIP). |
| **Queue depth** | The number of items currently sitting in the queue waiting to be picked up. |
| **Capacity** | The maximum value of queue depth + in-flight. The total work the system is willing to hold at once. |
| **Watermarks (high/low)** | Threshold levels on queue depth that trigger actions, e.g. "above 80% start shedding, below 50% stop shedding." |

---

## Core Concepts

### 1. A bounded channel is the simplest backpressure mechanism

When you write `make(chan Job, 100)`, you are saying three things at once:

1. The queue between producers and consumers will hold *at most* 100 jobs.
2. Producers will *block* (wait) when the queue is full.
3. The memory cost is bounded — at most `100 * sizeof(Job)` plus channel overhead.

That blocking is the producer feeling the consumer's pressure. The producer cannot run faster than the consumer for long, because the buffer fills up and the producer freezes.

Compare with an unbounded queue:

```go
// Antipattern — no backpressure.
var queue []Job
var mu sync.Mutex

func produce(j Job) {
    mu.Lock()
    queue = append(queue, j)
    mu.Unlock()
}
```

If producers run faster than consumers, `queue` grows forever. RSS climbs. The GC has more work. Eventually Linux's OOM killer arrives. There is no signal anywhere in this code that says "slow down."

The fix is one line:

```go
queue := make(chan Job, 100) // bounded — and now sends block when full
```

The replacement is not just smaller code. It is *correct* code. The bounded channel is one of Go's most undersold features: it solves a problem that other languages need libraries for.

### 2. The buffer size is a policy choice, not an optimisation knob

Beginners pick channel buffer sizes by guessing or by copying examples. The buffer size is actually a **policy decision** that answers: "How much work am I willing to absorb if the consumer pauses for a moment?"

- Buffer 0 (unbuffered): "I am willing to absorb nothing. The producer must wait for the consumer at every step."
- Buffer 1: "I am willing to absorb one item — enough to let a small jitter pass."
- Buffer 100: "I am willing to absorb 100 items. After that the producer waits."
- Buffer 1,000,000: "I am willing to absorb a million items. That is almost the same as unbounded — it just delays the OOM."

A useful default for a backpressure-sensitive system is a buffer around the size of the worker pool, or 2× to 4× the number of workers. That is enough to keep workers busy across small consumption jitters, and small enough that memory stays bounded.

Think of buffer size as a "shock absorber." Real systems have momentary jitter — the GC runs, a disk flush takes 50 ms, a downstream service hiccups. A small buffer absorbs that jitter without forcing every producer to wait. A buffer larger than the jitter is wasted; it only delays the inevitable backpressure signal.

### 3. Block, drop, or reject — pick one

When the buffer is full, there are three reasonable responses:

- **Block**: the producer waits. Best when the producer is "in-process" code that has nothing else useful to do, or when the producer represents an external client whose request is already committed.
- **Drop**: the producer throws the work away. Best for telemetry, logs, metrics — work where losing a sample is fine.
- **Reject**: the producer returns an error to *its* caller, propagating backpressure further upstream. Best for HTTP servers, RPC handlers, anything driven by an external caller who can be told to retry.

Mixing these is fine; what matters is making a choice. Silent unbounded growth is not on the list.

A useful mantra: **Block when waiting is cheap. Drop when work is fungible. Reject when the caller can decide.**

### 4. `select` with `default` turns a blocking send into a try-send

```go
select {
case ch <- j:
    // sent
default:
    // dropped or rejected — the channel was full
}
```

This is the Go-native idiom for non-blocking send. The `default` case runs *only* if no other case is ready immediately. With one send case and `default`, the meaning is "try to send; if you cannot, do something else right now."

Beware: `default` does **not** mean "wait a moment and try again." It means "give up immediately if no case is ready." The behaviour is instantaneous.

### 5. `context` puts a deadline on a send

```go
select {
case ch <- j:
    return nil
case <-ctx.Done():
    return ctx.Err()
}
```

This is "I will wait, but only for as long as the caller is willing." It is the bridge between in-process backpressure (the channel buffer) and external backpressure (the caller's timeout).

In a chain of services, every send-with-context inherits the timeout from the original incoming request. If the original client's deadline is 1 second, no internal queue should hold the work for longer than that. The deadline is the leash that prevents queues from accumulating stale work.

### 6. Backpressure flows upstream

If your HTTP handler sends to a channel and the channel is full, the handler blocks. While it is blocked, the goroutine sits there. Other connections still arrive at the server. If the server has no limit on concurrent handlers, you have a leak. The fix is to *also* bound the handlers — for example with a semaphore — so the pressure flows all the way back to the TCP socket and from there to the client.

A backpressure-aware system is one where pressure has a path to flow all the way back to whoever is causing the load. Anywhere that path is broken, queues grow.

This is the most counterintuitive part for beginners: **backpressure has to be installed everywhere**. One unbounded queue anywhere in the pipeline ruins the whole thing. It is like a chain — the weakest link sets the strength.

### 7. The "fast path" and the "shed path" are both code

Junior programmers tend to write only the fast path: "submit a job to the queue, worker processes it." The shed path — "queue is full, reject the request, increment a counter, log an error" — is equally important code and equally tested code. If your only test is "send 10 jobs, see them processed," you have not tested backpressure at all.

A working backpressure-aware service needs:

- A fast path that runs under normal load.
- A shed path that runs under overload.
- A way to switch between them based on a measurable signal (queue depth, in-flight count, latency).

### 8. The buffer is not the limit; the in-flight count is

A subtle point. Suppose you have 4 workers and a buffer of 100. The *real* system capacity is 104 — 100 waiting plus 4 in flight. Every item beyond the 105th will block the producer. When you size a buffer, count the workers too.

For latency-sensitive systems, you want the *in-flight* count to be small (workers are utilised, but no one waits too long) and the buffer to be very small or zero (queueing time adds to tail latency). For throughput-oriented systems, a larger buffer absorbs jitter and keeps workers busy.

---

## Real-World Analogies

- **A water tap and a glass.** The glass is the buffer. The tap is the producer. The drinker is the consumer. Backpressure is the rule "stop pouring when the glass is full" rather than "let it overflow."
- **A supermarket checkout.** There are N cashiers (workers). Customers queue (buffer). If the queue exceeds the store's capacity, new customers are turned away at the door (reject) or a queue limit is enforced (drop).
- **A factory conveyor belt.** When the assembly station is slow, the belt fills up. A sensor stops the belt before it overflows onto the floor.
- **A printer queue.** You have all seen what happens when no one prunes it. That is the absence of backpressure.
- **An elevator.** It has a maximum capacity. If you try to overload it, the doors do not close. The elevator rejects work above its rated load instead of breaking.
- **Restaurant reservations.** A restaurant could let everyone walk in. Instead it caps the dining-room size by accepting bookings up to N. The reservation system is the admission control; the dining room is the bounded buffer; the kitchen is the worker pool.
- **A highway on-ramp meter.** When the freeway is congested, the on-ramp signal slows new cars from joining. The freeway is the system; the on-ramp meter is the backpressure mechanism.

---

## Mental Models

### The pipe model

Think of your system as a series of pipes joined by tanks (channels). The producer pours water in. Each tank has a fixed capacity. When a tank fills, the pipe upstream stops. Backpressure is the propagation of that "stop" signal all the way back to the tap.

In this model:

- A bounded channel = a tank with a fixed level switch.
- An unbounded queue = a tank with no level switch — it overflows.
- A `select` with `default` = a tank with an overflow drain that throws water away.
- A `context.Done()` case = a tank with a timer that gives up after N seconds.

### The credit model

Some systems model backpressure as **credits**: the consumer hands the producer N credits, and the producer may send up to N items. Each receive returns a credit. When credits run out, the producer waits. A buffered channel of capacity N is exactly this model — the buffer slots *are* the credits.

This model is useful when you want to think about flow control across a network. HTTP/2 and gRPC have explicit flow-control windows that are credits. Inside Go, the buffered channel is the implicit version of the same idea.

### The "who pays" model

When the system is overloaded, *someone* pays the cost. The choices are:

- The producer pays (blocking).
- The work itself pays (dropping).
- The caller pays (rejecting with 503).
- Everyone pays (slow degradation, then OOM crash).

Backpressure design is choosing who pays, deliberately.

### Little's law in one sentence

The average number of items in a system equals arrival rate times average time spent. `L = λ × W`. If you cap `L` (with a buffer), then `λ` and `W` cannot both grow. Either arrivals must slow, or latency must rise. There is no escape.

For juniors, the practical takeaway is: when a queue fills, the system is telling you the consumer is the bottleneck. The right response is rarely "make the queue bigger." It is "make the consumer faster, or admit fewer items."

---

## Pros & Cons

**Pros**

- Bounded memory usage even under sustained overload.
- Latency stays predictable because queues do not grow unboundedly.
- Failures are surfaced early and explicitly rather than as opaque slowdowns.
- The system gracefully transitions from "fast" to "full" rather than from "fast" to "crashed."
- Easier to debug: when a queue is full, you have a concrete number to look at, not an unbounded mess.
- Plays well with client retries: a 503 with a `Retry-After` header lets clients back off intelligently.

**Cons**

- Producers can no longer assume sends are instant. Code must handle waits or rejections.
- Choosing buffer sizes and drop policies is a design decision that requires thought.
- Backpressure must be propagated end-to-end; a single missing link defeats it.
- Sometimes blocking the producer is worse than dropping work — the choice is non-trivial.
- Tail latency can become *worse* if the buffer is large and full: items wait in queue for the full processing time × queue depth.
- Easy to test the happy path; easy to forget the overload path.

---

## Use Cases

- HTTP servers behind a bounded worker pool.
- Background job consumers behind a bounded channel.
- Metrics and log shippers where dropping is preferable to blocking.
- Stream-processing pipelines where a slow downstream step should slow the upstream source.
- Rate-limited outbound API clients where exceeding the limit must block the caller.
- File-ingestion pipelines where files are read, parsed, transformed, and written.
- Notification fan-out where one event produces many downstream calls.
- Database write batchers where you accumulate writes up to a cap and flush.

---

## Code Examples

### Example 1 — The unbounded queue antipattern

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

// Bad: queue grows without bound under load.
type BadQueue struct {
    mu    sync.Mutex
    items []int
}

func (q *BadQueue) Push(x int) {
    q.mu.Lock()
    q.items = append(q.items, x)
    q.mu.Unlock()
}

func (q *BadQueue) Pop() (int, bool) {
    q.mu.Lock()
    defer q.mu.Unlock()
    if len(q.items) == 0 {
        return 0, false
    }
    x := q.items[0]
    q.items = q.items[1:]
    return x, true
}

func main() {
    q := &BadQueue{}

    // Producer: fast.
    go func() {
        for i := 0; ; i++ {
            q.Push(i)
        }
    }()

    // Consumer: slow.
    go func() {
        for {
            if x, ok := q.Pop(); ok {
                _ = x
                time.Sleep(10 * time.Microsecond)
            }
        }
    }()

    time.Sleep(2 * time.Second)
    q.mu.Lock()
    fmt.Println("queue size:", len(q.items))
    q.mu.Unlock()
}
```

Run this and you will see millions of items piled up in two seconds. There is no backpressure anywhere. Worse, the slice keeps growing and copies grow more expensive over time, so consumer throughput drops further as the queue grows. This is the textbook collapse mode.

### Example 2 — The bounded channel fix

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int, 100) // bounded buffer = bounded memory

    // Producer.
    go func() {
        for i := 0; ; i++ {
            ch <- i // blocks when full — this is backpressure
        }
    }()

    // Consumer.
    go func() {
        for x := range ch {
            _ = x
            time.Sleep(10 * time.Microsecond)
        }
    }()

    time.Sleep(2 * time.Second)
    fmt.Println("buffer size:", len(ch))
}
```

Run this and the buffer size stabilises at 100. The producer is implicitly throttled by the consumer. Memory stays flat. The producer's "speed" is now exactly the consumer's speed, which is the desired property.

### Example 3 — Non-blocking send (drop on full)

```go
package main

import "fmt"

func trySend(ch chan int, x int) bool {
    select {
    case ch <- x:
        return true
    default:
        return false
    }
}

func main() {
    ch := make(chan int, 2)
    fmt.Println(trySend(ch, 1)) // true
    fmt.Println(trySend(ch, 2)) // true
    fmt.Println(trySend(ch, 3)) // false — dropped
}
```

This is the drop policy: when the buffer is full, the work is silently discarded. Use only when losing the item is acceptable.

A common improvement is to count drops so they are visible in metrics:

```go
var droppedCount uint64

func trySendOrDrop(ch chan<- int, x int) {
    select {
    case ch <- x:
    default:
        atomic.AddUint64(&droppedCount, 1)
    }
}
```

Drops without a counter are bugs waiting to happen — you have no signal that the system is dropping work.

### Example 4 — Send with timeout

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "time"
)

func send(ctx context.Context, ch chan<- int, x int) error {
    select {
    case ch <- x:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func main() {
    ch := make(chan int, 1)
    ch <- 999 // pre-fill so the next send must wait

    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()

    if err := send(ctx, ch, 42); err != nil {
        fmt.Println("rejected:", errors.Is(err, context.DeadlineExceeded))
    }
}
```

This is the reject policy: the caller gets an error and can decide to retry, fail the request, or surface a 503 to its own caller.

### Example 5 — Producer-consumer with WaitGroup and clean shutdown

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    jobs := make(chan int, 16)
    var wg sync.WaitGroup

    // Start 4 workers.
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := range jobs {
                time.Sleep(20 * time.Millisecond)
                _ = j
                _ = id
            }
        }(i)
    }

    // Producer: 100 jobs, then close.
    for i := 0; i < 100; i++ {
        jobs <- i // blocks when buffer is full
    }
    close(jobs)

    wg.Wait()
    fmt.Println("all done")
}
```

The producer blocks naturally whenever the workers cannot keep up. Memory stays bounded at 16 jobs in the buffer plus 4 in-flight in the workers. Closing the channel signals the workers to exit when there is no more work.

### Example 6 — Reject incoming HTTP requests when overloaded

```go
package main

import (
    "fmt"
    "net/http"
)

var sem = make(chan struct{}, 100) // at most 100 concurrent requests

func handler(w http.ResponseWriter, r *http.Request) {
    select {
    case sem <- struct{}{}:
        defer func() { <-sem }()
    default:
        http.Error(w, "server busy", http.StatusServiceUnavailable)
        return
    }

    fmt.Fprintln(w, "ok")
}

func main() {
    http.HandleFunc("/", handler)
    _ = http.ListenAndServe(":8080", nil)
}
```

This is the simplest form of admission control. The first 100 in-flight requests are accepted; further requests are rejected with 503 until something finishes. With this in place, the server's RSS stays bounded under load, and clients receive a clear signal rather than a hung connection.

### Example 7 — Sending a batch with a deadline

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func sendBatch(ctx context.Context, ch chan<- int, items []int) (int, error) {
    sent := 0
    for _, it := range items {
        select {
        case ch <- it:
            sent++
        case <-ctx.Done():
            return sent, ctx.Err()
        }
    }
    return sent, nil
}

func main() {
    ch := make(chan int, 2)
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()

    n, err := sendBatch(ctx, ch, []int{1, 2, 3, 4, 5})
    fmt.Println("sent", n, "err", err)
}
```

The function returns partial success: how many items it managed to send before the deadline. This is more useful than an all-or-nothing API for many real systems.

### Example 8 — Counters for observability

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

type Counters struct {
    Sent    uint64
    Dropped uint64
    Blocked uint64
}

func (c *Counters) Submit(ch chan int, x int) {
    select {
    case ch <- x:
        atomic.AddUint64(&c.Sent, 1)
    default:
        // Could not send immediately. Try again with a tiny wait.
        select {
        case ch <- x:
            atomic.AddUint64(&c.Sent, 1)
            atomic.AddUint64(&c.Blocked, 1)
        case <-time.After(5 * time.Millisecond):
            atomic.AddUint64(&c.Dropped, 1)
        }
    }
}

func main() {
    ch := make(chan int, 2)
    c := &Counters{}
    for i := 0; i < 100; i++ {
        c.Submit(ch, i)
    }
    fmt.Printf("sent=%d dropped=%d blocked=%d\n", c.Sent, c.Dropped, c.Blocked)
}
```

Three counters — sent, blocked, dropped — give an operator everything they need to see what is happening at the boundary. Without them, the system is opaque.

### Example 9 — A bounded queue with explicit `Push` and `Pop` semantics

```go
package main

import (
    "errors"
    "fmt"
)

type BoundedQueue struct {
    ch chan int
}

func NewBoundedQueue(cap int) *BoundedQueue {
    return &BoundedQueue{ch: make(chan int, cap)}
}

func (q *BoundedQueue) TryPush(x int) error {
    select {
    case q.ch <- x:
        return nil
    default:
        return errors.New("queue full")
    }
}

func (q *BoundedQueue) Pop() (int, bool) {
    x, ok := <-q.ch
    return x, ok
}

func (q *BoundedQueue) Len() int { return len(q.ch) }
func (q *BoundedQueue) Cap() int { return cap(q.ch) }
func (q *BoundedQueue) Close()   { close(q.ch) }

func main() {
    q := NewBoundedQueue(2)
    fmt.Println(q.TryPush(1)) // nil
    fmt.Println(q.TryPush(2)) // nil
    fmt.Println(q.TryPush(3)) // queue full
    fmt.Println(q.Len(), "/", q.Cap())
}
```

Wrapping the channel in a struct exposes `Len`, `Cap`, `TryPush`, and `Pop` — a small library that the rest of the codebase can use without having to think about channel mechanics.

### Example 10 — Worker pool with all three submit policies

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "time"
)

type Job func()

type Pool struct {
    jobs chan Job
    wg   sync.WaitGroup
}

func NewPool(workers, buffer int) *Pool {
    p := &Pool{jobs: make(chan Job, buffer)}
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for j := range p.jobs {
                j()
            }
        }()
    }
    return p
}

// Submit blocks until accepted.
func (p *Pool) Submit(j Job) {
    p.jobs <- j
}

// TrySubmit returns false if the queue is full.
func (p *Pool) TrySubmit(j Job) bool {
    select {
    case p.jobs <- j:
        return true
    default:
        return false
    }
}

// SubmitCtx blocks until accepted or the context is done.
func (p *Pool) SubmitCtx(ctx context.Context, j Job) error {
    select {
    case p.jobs <- j:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (p *Pool) Close() {
    close(p.jobs)
    p.wg.Wait()
}

func main() {
    p := NewPool(2, 4)
    defer p.Close()

    // Use Submit when waiting is acceptable.
    p.Submit(func() { time.Sleep(50 * time.Millisecond) })

    // Use TrySubmit for non-essential work.
    if !p.TrySubmit(func() { fmt.Println("hi") }) {
        fmt.Println("dropped")
    }

    // Use SubmitCtx for caller-driven timeouts.
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
    defer cancel()
    if err := p.SubmitCtx(ctx, func() {}); errors.Is(err, context.DeadlineExceeded) {
        fmt.Println("rejected: deadline")
    }
}
```

This is the API every production worker pool should expose: three submission modes, one for each backpressure policy.

### Example 11 — Bounded HTTP handler with timeout

```go
package main

import (
    "context"
    "net/http"
    "time"
)

var sem = make(chan struct{}, 50)

func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 200*time.Millisecond)
    defer cancel()

    select {
    case sem <- struct{}{}:
        defer func() { <-sem }()
    case <-ctx.Done():
        http.Error(w, "busy", http.StatusServiceUnavailable)
        return
    }

    // Do work.
    w.WriteHeader(http.StatusOK)
    _, _ = w.Write([]byte("ok\n"))
}

func main() {
    http.HandleFunc("/", handler)
    _ = http.ListenAndServe(":8080", nil)
}
```

This handler waits up to 200 ms for a slot, then returns 503. Under load, latency stays bounded at roughly 200 ms plus the work time, instead of growing unboundedly with queue depth.

### Example 12 — Channel-of-channels for slow consumers

```go
package main

import (
    "fmt"
    "time"
)

type Result struct {
    Value int
    Err   error
}

func runJob(input int) <-chan Result {
    out := make(chan Result, 1) // buffer 1: producer never blocks if consumer is slow
    go func() {
        defer close(out)
        time.Sleep(10 * time.Millisecond)
        out <- Result{Value: input * 2}
    }()
    return out
}

func main() {
    r := runJob(21)
    time.Sleep(50 * time.Millisecond) // pretend consumer is slow
    fmt.Println(<-r)
}
```

When a goroutine wants to send exactly one result and then exit, a buffer of 1 means it does not have to wait for the consumer. This is the "no-wait return" pattern and is technically backpressure-free, on purpose, for the single-result case.

---

## Coding Patterns

### Pattern 1 — The bounded worker pool

```go
type Pool struct {
    jobs chan Job
    wg   sync.WaitGroup
}

func NewPool(workers, buffer int) *Pool {
    p := &Pool{jobs: make(chan Job, buffer)}
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go p.worker()
    }
    return p
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for j := range p.jobs {
        j.Run()
    }
}

func (p *Pool) Submit(j Job) {
    p.jobs <- j // blocks when buffer full — backpressure
}

func (p *Pool) Close() {
    close(p.jobs)
    p.wg.Wait()
}
```

### Pattern 2 — The try-submit variant

```go
func (p *Pool) TrySubmit(j Job) bool {
    select {
    case p.jobs <- j:
        return true
    default:
        return false
    }
}
```

### Pattern 3 — The context-aware submit

```go
func (p *Pool) SubmitCtx(ctx context.Context, j Job) error {
    select {
    case p.jobs <- j:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

### Pattern 4 — Counted submit

```go
type CountedPool struct {
    Pool
    submitted, dropped uint64
}

func (p *CountedPool) Submit(j Job) bool {
    if p.TrySubmit(j) {
        atomic.AddUint64(&p.submitted, 1)
        return true
    }
    atomic.AddUint64(&p.dropped, 1)
    return false
}
```

### Pattern 5 — Watermark-based shedding

```go
type WatermarkPool struct {
    jobs chan Job
    high int
}

func (p *WatermarkPool) Submit(j Job) bool {
    if len(p.jobs) > p.high {
        return false // shed before fully full
    }
    select {
    case p.jobs <- j:
        return true
    default:
        return false
    }
}
```

Shedding *before* the buffer is full preserves a small reserve for high-priority work or for clearing the queue. It is a step up from "all or nothing."

### Pattern 6 — Bounded fan-out

```go
func fanout(ctx context.Context, in <-chan int, n int) []<-chan int {
    outs := make([]<-chan int, n)
    for i := 0; i < n; i++ {
        c := make(chan int, 1)
        outs[i] = c
        go func(c chan<- int) {
            defer close(c)
            for {
                select {
                case x, ok := <-in:
                    if !ok {
                        return
                    }
                    select {
                    case c <- x:
                    case <-ctx.Done():
                        return
                    }
                case <-ctx.Done():
                    return
                }
            }
        }(c)
    }
    return outs
}
```

The outer `select` reads from input; the inner `select` writes to output. Both respect cancellation. The output channels are bounded — a slow downstream consumer eventually slows the dispatcher, which slows the input.

---

## Clean Code

- Always make the buffer size a named constant or configurable parameter, never a magic number scattered through the code.
- Document the policy chosen at each channel: "buffer 100, sender blocks when full" should appear in a comment or doc string.
- Keep producers and consumers in separate files or packages when the channel is the only contract between them.
- Prefer `chan<- T` and `<-chan T` directionality in function signatures — it forces correct usage and documents intent.
- Wrap your worker pools in a `Submit / SubmitCtx / TrySubmit` API. Do not expose the raw channel.
- Name your channels for what they carry, not for what they are: `jobs`, `events`, `results`, not `ch`, `c`, `queue`.
- Put the backpressure policy at the boundary of a package, not deep in some helper function. The reader of the API should see it.
- If a function blocks, say so in its doc: `// Submit blocks until the job is accepted or the queue is closed.`

---

## Product Use / Feature

- A web server that returns 503 under load instead of timing out is **available**. A web server that holds connections open for 30 seconds while the queue grows is *worse than down* — clients retry and amplify the storm.
- A metrics shipper that drops 0.1% of samples under spikes is acceptable. A metrics shipper that runs the host out of RAM and crashes is not.
- A background email sender that holds emails in a bounded queue is fine. One that holds them in an unbounded slice will eventually lose them all when the process is killed.
- A push-notification fan-out that drops the slowest 1% of recipients is doing its job. One that holds onto every recipient is a memory leak waiting to happen.
- A WebSocket server that disconnects slow clients after a queue fills up is being a good citizen. One that holds messages forever is a resource bomb.

Backpressure is a product feature, not just a tech detail: it is what makes the difference between "the site is slow" and "the site is down."

---

## Error Handling

- A blocking send is not an error; it is intentional wait. Do not log it.
- A dropped send is an error condition — increment a counter, log at a low rate.
- A rejected send (context cancelled) is the caller's signal that the system is overloaded — return it up the call stack.
- Never `panic` when a queue is full. The right answer is always one of: block, drop, or reject.
- Wrap errors with `fmt.Errorf("submit: %w", err)` so callers can `errors.Is(err, context.DeadlineExceeded)` to distinguish overload from other failures.
- Do not return a generic `"error"` string. Distinguish overload (`ErrBusy`) from other errors so retry logic can be different.

```go
var ErrBusy = errors.New("system busy")

func (p *Pool) TrySubmit(j Job) error {
    select {
    case p.jobs <- j:
        return nil
    default:
        return ErrBusy
    }
}
```

---

## Security Considerations

- An attacker who can flood your producer side will exhaust your buffer. Without backpressure, this becomes an OOM kill — a trivial DoS. Bounded channels turn that DoS into 503 responses, which is far better.
- Authentication does not make this go away. Authorised users can also misbehave.
- Be careful with "drop oldest" policies on security-relevant queues (audit logs, fraud signals). Dropping these may itself be a security event. Sometimes the right answer is "block, propagate, surface."
- If your service drops audit logs under load, log the drop count separately so security operations know the gap exists.
- For login endpoints, consider per-IP rate limiting upstream of the worker pool — otherwise a botnet can occupy all the slots and starve legitimate users.

---

## Performance Tips

- A buffer of 2× to 4× the number of workers is a good starting heuristic. Measure before tuning.
- Avoid buffer sizes that approach the available memory divided by item size. They turn backpressure into "delayed OOM."
- Profile your producer-blocking time. If producers spend > 50% of their time blocked, the system is saturated; adding workers or capacity is the real fix.
- Do not microbenchmark channel throughput in isolation — measure the end-to-end pipeline. Buffer size affects latency more than throughput.
- Use `len(ch)` and `cap(ch)` to expose buffer fill in metrics.
- Prefer `chan struct{}` for semaphores — the empty struct is zero bytes per slot.
- Avoid creating channels in hot paths; create them once and reuse.

---

## Best Practices

- Every channel that crosses a goroutine boundary in a long-lived service should be bounded.
- Every component that accepts work should expose a `Submit`, `TrySubmit`, and `SubmitCtx` API.
- Every overload should produce a metric: `submit_blocked_total`, `submit_dropped_total`, `submit_rejected_total`.
- Choose a policy and stick to it across the pipeline. Mixing "block here, drop there, reject elsewhere" without a plan leads to surprising behaviour.
- Test the overload path. The "happy path" is easy. The "all buffers full" path is where most bugs live.
- When tuning, change one parameter at a time — buffer size, worker count, or timeout — and measure.
- Treat queue depth as a first-class metric, alongside RPS and error rate.

---

## Edge Cases & Pitfalls

- **Closing a full channel is fine, but sending to a closed channel panics.** Be sure your producer stops sending before you close.
- **`len(ch)` is a snapshot, not a guarantee.** By the time you act on it, it may have changed.
- **`select` with multiple sendable cases picks pseudo-randomly.** Do not assume priority order.
- **A goroutine blocked on a full channel is not GC-able.** A leak here is permanent.
- **Buffered channels do not order strictly across senders.** Items from different senders may interleave.
- **A `select` with `case <-ctx.Done()` and `case ch <- x` where `ctx` is already done may still pick the send case** — the runtime chooses pseudo-randomly between ready cases.
- **A `nil` channel in `select` is never ready.** This is useful for disabling a case, but trips up beginners.
- **`time.After` in a `select` allocates a new timer every iteration.** Use `time.NewTimer` for hot loops.

---

## Common Mistakes

1. Using a slice as a queue and never bounding its length.
2. Setting buffer sizes like `1 << 20` "just to be safe." This is unbounded in disguise.
3. Treating `default` in `select` as "wait a bit, then drop." It does not wait at all.
4. Forgetting to handle the rejected case. The caller silently sees a corrupt result.
5. Closing a channel from the consumer side. Always close from the sole sender.
6. Using buffered channels of capacity 1 as semaphores when `chan struct{}` is clearer.
7. Using `time.Sleep` to "wait for the queue to drain" instead of explicit signalling.
8. Ignoring the context inside the worker — workers should also check `ctx.Done()` on long operations.
9. Not differentiating drop from reject in logs and metrics.
10. Sizing the buffer based on peak load rather than steady-state load + jitter margin.

---

## Common Misconceptions

- "Bigger buffers are always better." False. Bigger buffers hide problems and increase latency. They are an explicit tradeoff.
- "Unbuffered channels are slow." False. They are the strongest form of backpressure and add minimal overhead.
- "Backpressure means rate limiting." Related but different. Rate limiting caps throughput; backpressure caps work-in-progress.
- "Backpressure is a library concern." It is an architectural concern that touches every layer.
- "Backpressure is only for high-scale systems." False. Even a small CLI tool can OOM under a hostile input file. Bounding is always a good habit.
- "Channels are the only way." False. Semaphores, `sync.Cond`, atomic counters, and `golang.org/x/sync/semaphore` all implement variants of the same idea. Channels are the most idiomatic, not the only option.

---

## Tricky Points

- A `select` with both a send case and a `<-ctx.Done()` case is not the same as a send with timeout — `ctx.Err()` is the right signal, not a synthetic error.
- `cap(ch) == 0` for unbuffered channels. Code that assumes `cap(ch) > 0` is buggy on unbuffered ones.
- The Go runtime does not "fairly" pick between blocked senders. Starvation is theoretically possible under contention; in practice it is rare.
- Closing a channel does not flush it. Receivers can still drain remaining buffered items after close.
- `chan T` is a value type by reference — copying a channel variable does not create a new channel. All copies refer to the same underlying queue.
- `len(ch) == cap(ch)` does not guarantee the next send will block — by the time you act, a receiver may have run.

---

## Test

```go
package main

import (
    "testing"
    "time"
)

func TestBoundedChannelBlocks(t *testing.T) {
    ch := make(chan int, 2)
    ch <- 1
    ch <- 2

    done := make(chan struct{})
    go func() {
        ch <- 3 // should block
        close(done)
    }()

    select {
    case <-done:
        t.Fatal("send did not block on full channel")
    case <-time.After(20 * time.Millisecond):
        // expected: still blocked
    }

    <-ch
    select {
    case <-done:
        // expected: send completed once buffer freed
    case <-time.After(100 * time.Millisecond):
        t.Fatal("send did not unblock after receive")
    }
}

func TestTrySendDropsWhenFull(t *testing.T) {
    ch := make(chan int, 1)
    ch <- 1
    select {
    case ch <- 2:
        t.Fatal("expected drop")
    default:
    }
}
```

---

## Tricky Questions

1. What happens if you send to a `nil` channel? *Blocks forever.*
2. What happens if you receive from a `nil` channel? *Blocks forever.*
3. What happens if you send to a closed channel? *Panic.*
4. What does `select {}` with no cases do? *Blocks forever.*
5. Can a single goroutine be both producer and consumer on the same channel? *Yes, but easy to deadlock.*
6. If two goroutines are blocked on a send to the same full channel and one receive happens, which send unblocks? *Pseudo-random; no guarantee.*
7. If a buffered channel has capacity 3 and contains 3 items, is `len(ch)` always 3? *No — by the time the assignment happens, a receiver may have popped one. The value is a snapshot.*
8. What is `cap(ch)` for `make(chan T)`? *Zero.*

---

## Cheat Sheet

| Need | Pattern |
|------|---------|
| Bounded queue | `make(chan T, N)` |
| Strict rendezvous | `make(chan T)` (unbuffered) |
| Try send, drop on full | `select { case ch <- x: default: }` |
| Send with deadline | `select { case ch <- x: case <-ctx.Done(): }` |
| Try receive | `select { case x := <-ch: default: }` |
| Bound concurrent work | semaphore: `make(chan struct{}, N)` |
| Reject under load | 503 / `context.DeadlineExceeded` |
| Drop under load | non-blocking send |
| Block under load | plain `<-` send |
| Watermark shedding | `if len(ch) > high { return ErrBusy }` |

---

## Self-Assessment Checklist

- [ ] I can explain the difference between a bounded and unbounded queue.
- [ ] I can choose between block / drop / reject for a given component.
- [ ] I can write a non-blocking send and a context-aware send.
- [ ] I can wrap a worker pool in a `Submit / TrySubmit / SubmitCtx` API.
- [ ] I have at least one metric exposing queue depth in a real project.
- [ ] I never use `append` on a shared slice as a queue.
- [ ] I always document the backpressure policy at each channel.
- [ ] I can write a test that proves a bounded channel blocks when full.
- [ ] I can size a buffer using "2x worker count" as a starting heuristic.
- [ ] I expose drop and reject counters as metrics in any service I write.

---

## Summary

Backpressure is the discipline of letting slow consumers push back on fast producers. In Go the building block is the bounded channel: `make(chan T, N)` plus a blocking send. When the buffer fills, the producer must choose: wait, drop, or reject. Picking — and propagating — that choice across the system is the work of backpressure design. Unbounded queues are the most common Go concurrency bug after goroutine leaks, and the fix is almost always smaller. Buffer sizes are policy decisions, not optimisation knobs.

## What You Can Build

- A small HTTP echo server that rejects requests with 503 when 100 are in flight.
- A bounded worker pool with `Submit`, `TrySubmit`, and `SubmitCtx` methods.
- A log shipper that drops samples when its outgoing channel is full and increments a counter.
- A producer-consumer benchmark that compares a bounded channel to an unbounded slice and shows the memory difference.
- A toy load-tester that pushes a server past its admission limit and verifies the server returns 503s rather than timing out.

## Further Reading

- Go blog: "Go Concurrency Patterns: Pipelines and cancellation"
- "Concurrency is not parallelism" — Rob Pike's talk
- Bartosz Milewski's "Beautiful Concurrency" essays
- The `golang.org/x/sync/semaphore` package documentation
- "Little's Law in Five Minutes" — many summaries available

## Related Topics

- Worker pools and dynamic scaling
- Rate limiting and token buckets
- Graceful shutdown and drain patterns
- Circuit breakers (defensive, not corrective)
- `context.Context` cancellation propagation

## Diagrams & Visual Aids

```
Producer ──► [bounded channel: ████░░░░░░ 4/10] ──► Consumer
                       │
                       │ when full, producer:
                       ├── blocks   (default)
                       ├── drops    (select+default)
                       └── rejects  (select+ctx.Done)
```

```
Without backpressure:         With backpressure:
Producer ───►   ∞ queue       Producer ───► [N] ───► Consumer
                                 ▲                  │
                                 └── "I'm full" ◄───┘
RSS climbs forever.           RSS stays bounded.
OOM eventually.               503 / drop / block.
```

```
Block | Drop | Reject — which to pick?

  Producer is internal      → Block.   Producer has nothing else to do.
  Item is fungible (logs)   → Drop.    Better lose 1% than crash.
  Producer is external      → Reject.  Tell the caller; let them decide.
  Mixed / pipeline boundary → Reject upward, drop at telemetry edges,
                              block at strict in-process steps.
```

```
The four states of a queue
  empty   ░░░░░░░░░░  consumer faster than producer; healthy
  filling ████░░░░░░  steady state; healthy
  full    ██████████  producer is blocking / dropping / rejecting
  growing ##########  the queue is unbounded — bug, not a state
```

---

## Extended Walkthrough 1 — Anatomy of a Buffer-Free Pipeline

Let us trace, step by step, what happens when you send into a full buffered channel.

1. Producer calls `ch <- x`.
2. The Go runtime checks the channel's internal state: is there a waiting receiver? Is there room in the buffer?
3. If a receiver is parked, the runtime hands the value directly to the receiver and wakes it. No buffer interaction.
4. If there is buffer space, the runtime copies the value into the next buffer slot and returns.
5. If neither is true (full and no waiter), the runtime puts the producer goroutine on the channel's sender wait queue and parks it.
6. Time passes. Other goroutines run.
7. A consumer eventually calls `<-ch`. The runtime sees the parked sender, copies the value from the sender's stack into the consumer's stack, and wakes the sender. The sender's send returns.

Notice what does *not* happen: no allocation, no slice growth, no resize. The buffer is a fixed ring; the wait queue is a linked list of parked goroutines. Both have constant memory cost. This is the engine that makes backpressure cheap.

Now contrast with the unbounded-slice queue:

1. Producer calls `Push`.
2. The mutex is acquired.
3. The slice is appended. If the underlying array is full, a new one twice as large is allocated, and the old contents copied.
4. The mutex is released.

Step 3 is the killer: under sustained overload, copies grow O(N) and the heap bloats. The producer never feels the consumer. Backpressure is absent.

Run this short program to feel the difference:

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func memMB() uint64 {
    var ms runtime.MemStats
    runtime.ReadMemStats(&ms)
    return ms.HeapAlloc / 1024 / 1024
}

func main() {
    fmt.Println("start", memMB(), "MB")

    ch := make(chan [1024]byte, 100)
    go func() {
        for i := 0; ; i++ {
            ch <- [1024]byte{}
        }
    }()
    // No consumer. Just watch the heap.

    for i := 0; i < 5; i++ {
        time.Sleep(time.Second)
        fmt.Println("t+", i+1, "s", memMB(), "MB")
    }
}
```

Memory stays flat. The producer simply blocks after filling 100 slots. No leak, no growth.

Now flip the buffer to an unbounded slice (use the `BadQueue` from Example 1) and rerun. Memory climbs every second until OOM. The difference is the entire lesson of this page.

---

## Extended Walkthrough 2 — A Day in the Life of an HTTP Server Without Backpressure

Picture an HTTP server that:

- Accepts every incoming connection.
- Starts a goroutine per request.
- Each goroutine queries a database, formats the response, and writes it.

The server runs happily for months at 100 RPS. One day a marketing campaign brings 10,000 RPS for ten minutes. Here is what happens:

1. **t=0 s.** RPS jumps from 100 to 10,000. The accept goroutine accepts every connection. Goroutine count climbs from 100 to 1,000 to 5,000.
2. **t=5 s.** Database connection pool (let's say 50 connections) is fully utilised. Goroutines pile up waiting for a connection. Goroutine count: 8,000.
3. **t=10 s.** RSS climbs from 200 MB to 1 GB. The GC starts running every 200 ms. CPU goes from 30% to 80%.
4. **t=20 s.** Each request takes 3 seconds instead of 50 ms because every step waits for resources held by other requests. Clients begin timing out and retrying.
5. **t=30 s.** Retries amplify the load to 20,000 RPS. Goroutine count: 30,000. RSS: 4 GB.
6. **t=45 s.** The host runs out of memory. OOM killer terminates the process. The service is down.
7. **t=50 s.** A replica picks up the load. With 20,000 RPS hitting the replica, the same death spiral begins.
8. **t=120 s.** Half the fleet is dead. Incident page.

Now picture the same scenario with backpressure: a semaphore of 200 concurrent requests, with `SubmitCtx` and a 100 ms deadline.

1. **t=0 s.** RPS jumps to 10,000. First 200 requests are accepted; the next 9,800 see a full semaphore.
2. **t=0 s.** Of those 9,800, requests wait up to 100 ms for a slot. Most see the deadline expire and receive 503.
3. **t=10 s.** RSS stays at 250 MB. Goroutine count at 200. CPU at 70%.
4. **t=30 s.** Steady state: throughput ~ 4,000 RPS (the system's real capacity), 503s ~ 6,000 RPS.
5. **t=600 s.** Campaign ends. RPS returns to 100. 503s drop to zero. The service was always up. No incident.

The difference is the addition of two lines of code:

```go
sem := make(chan struct{}, 200)
// in handler: select { case sem <- struct{}{}: ... default: 503 }
```

This is what backpressure pays for.

---

## Extended Walkthrough 3 — Building a Bounded Job Server Step by Step

Let us build a real little service. We will start with the bad version and iterate.

### Iteration 1 — Naive (no backpressure)

```go
package main

import (
    "fmt"
    "net/http"
    "time"
)

func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        // pretend this is real work
        time.Sleep(2 * time.Second)
    }()
    fmt.Fprintln(w, "queued")
}

func main() {
    http.HandleFunc("/job", handler)
    http.ListenAndServe(":8080", nil)
}
```

Hit this with `wrk -t4 -c1000 -d30s http://localhost:8080/job`. The server replies "queued" instantly to every request. Run it for a minute. Watch `top` — RSS climbs to gigabytes. Watch `runtime.NumGoroutine` — it climbs to hundreds of thousands. Eventually the kernel kills the process. No backpressure anywhere.

### Iteration 2 — Bounded channel

```go
var jobs = make(chan func(), 100)

func init() {
    for i := 0; i < 4; i++ {
        go func() {
            for j := range jobs {
                j()
            }
        }()
    }
}

func handler(w http.ResponseWriter, r *http.Request) {
    jobs <- func() { time.Sleep(2 * time.Second) }
    fmt.Fprintln(w, "queued")
}
```

Better. Now the queue is bounded to 100, and we have 4 workers. But there is still a problem: the handler `jobs <- ...` *blocks* when the queue is full. Under heavy load, handler goroutines stack up waiting for a queue slot. We have moved the unboundedness from the queue to the handler goroutines.

### Iteration 3 — Try-send, return 503

```go
func handler(w http.ResponseWriter, r *http.Request) {
    select {
    case jobs <- func() { time.Sleep(2 * time.Second) }:
        fmt.Fprintln(w, "queued")
    default:
        http.Error(w, "busy", http.StatusServiceUnavailable)
    }
}
```

Now under overload, excess requests are rejected immediately. The handler never blocks. Goroutine count stays roughly constant. RSS stays bounded.

But: every excess request gets a 503. Even one that arrives 5 ms after the queue clears would have succeeded if we had waited. We are being too eager to drop.

### Iteration 4 — Try-send with a short wait

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 50*time.Millisecond)
    defer cancel()
    j := func() { time.Sleep(2 * time.Second) }
    select {
    case jobs <- j:
        fmt.Fprintln(w, "queued")
    case <-ctx.Done():
        http.Error(w, "busy", http.StatusServiceUnavailable)
    }
}
```

Now the handler waits up to 50 ms for a slot. Small jitter in consumer speed is absorbed; sustained overload still produces 503s. This is the policy you want for most user-facing services: a short tolerance, then reject.

### Iteration 5 — Metrics

```go
var (
    accepted = expvar.NewInt("accepted")
    rejected = expvar.NewInt("rejected")
    queueLen = expvar.NewInt("queue_len")
)

func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 50*time.Millisecond)
    defer cancel()
    j := func() { time.Sleep(2 * time.Second) }
    select {
    case jobs <- j:
        accepted.Add(1)
        queueLen.Set(int64(len(jobs)))
        fmt.Fprintln(w, "queued")
    case <-ctx.Done():
        rejected.Add(1)
        http.Error(w, "busy", http.StatusServiceUnavailable)
    }
}
```

Now we have a metrics endpoint at `/debug/vars` that an operator can scrape. They can see at a glance whether the system is shedding load. This is observability — and it is the most important thing about a real-world backpressure setup. Without metrics, the system silently drops work and nobody knows.

### Iteration 6 — Graceful shutdown

```go
func main() {
    srv := &http.Server{Addr: ":8080"}
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)

    go func() {
        <-sigs
        srv.Shutdown(context.Background())
        close(jobs)
    }()

    srv.ListenAndServe()
    // wait for workers...
}
```

A real service must drain. Stop accepting new HTTP requests, then let existing jobs in the channel finish before closing. Drain pattern is covered in the next page.

The final result, after six small iterations, is a service that:

- Has bounded memory.
- Surfaces overload as 503.
- Absorbs small jitter without rejecting.
- Reports its load to observers.
- Shuts down cleanly.

That is the difference between a hobby program and a production service.

---

## Anti-Pattern Gallery

### Anti-pattern 1 — The infinite buffer

```go
ch := make(chan T, 1<<30)
```

A billion-slot buffer is unbounded in spirit. You will hit OOM long before you fill it. This is "I do not want to think about backpressure" disguised as "I picked a big number."

Fix: pick a number you can defend. Usually < 10,000.

### Anti-pattern 2 — Spawn-per-arrival

```go
http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    go doWork()
    w.Write([]byte("queued"))
})
```

Each request spawns a goroutine with no limit on the spawn count. The goroutine count itself becomes the unbounded queue. Memory grows with goroutines.

Fix: use a worker pool with a bounded channel, or a semaphore in the handler.

### Anti-pattern 3 — The runaway logger

```go
go func() {
    for {
        select {
        case msg := <-logCh:
            slowLogWrite(msg)
        }
    }
}()

// elsewhere
logCh <- "hello"
```

If the logger is slower than the producers, `logCh` is full and producers block. If `logCh` is unbuffered, every log call blocks the producer until the disk is happy. A logger that blocks the application is a logger that brings the application down.

Fix: bound the channel and use non-blocking send. Drop logs under overload, but count drops:

```go
select {
case logCh <- msg:
default:
    atomic.AddUint64(&drops, 1)
}
```

### Anti-pattern 4 — The dropped error

```go
select {
case ch <- x:
default:
    // queue full, drop silently
}
```

Drops are sometimes the right answer — but never silently. Always count and log.

### Anti-pattern 5 — The "queue will catch up" myth

"The queue is growing right now, but the consumer will catch up tomorrow." It will not. If the average producer rate exceeds the average consumer rate, the queue grows linearly forever. Backpressure is the only escape.

Fix: measure rates. If producer > consumer on average, you have a real capacity problem; bigger buffers are a delay, not a fix.

### Anti-pattern 6 — Sending to a closed channel

```go
close(ch)
go func() { ch <- 1 }() // panic somewhere later
```

Closing a channel from one goroutine while another may still send produces a runtime panic. Always make sure all senders have stopped before closing.

Fix: make a single goroutine responsible for closing. Use `context.Done()` to signal senders to stop.

### Anti-pattern 7 — Mixing block and drop semantics

```go
for _, x := range items {
    select {
    case ch <- x:
    default:
        // drop
    }
}
ch <- final // blocks
```

The loop drops on full, but the final send blocks. A reader of this code has no idea what the policy is. Inconsistency confuses operators and hides bugs.

Fix: pick one policy per channel. Document it.

---

## A Tiny Benchmark You Can Run Locally

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func runUnbounded(n int) (time.Duration, uint64) {
    var mu sync.Mutex
    var q []int
    runtime.GC()
    var ms1 runtime.MemStats
    runtime.ReadMemStats(&ms1)

    start := time.Now()
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < n; i++ {
            mu.Lock()
            q = append(q, i)
            mu.Unlock()
        }
    }()
    wg.Wait()

    var ms2 runtime.MemStats
    runtime.ReadMemStats(&ms2)
    return time.Since(start), ms2.HeapAlloc - ms1.HeapAlloc
}

func runBounded(n, cap int) (time.Duration, uint64) {
    ch := make(chan int, cap)
    runtime.GC()
    var ms1 runtime.MemStats
    runtime.ReadMemStats(&ms1)

    start := time.Now()
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for x := range ch {
            _ = x
        }
    }()
    for i := 0; i < n; i++ {
        ch <- i
    }
    close(ch)
    wg.Wait()

    var ms2 runtime.MemStats
    runtime.ReadMemStats(&ms2)
    return time.Since(start), ms2.HeapAlloc - ms1.HeapAlloc
}

func main() {
    const n = 1_000_000

    d1, m1 := runUnbounded(n)
    fmt.Printf("unbounded: %v, +%d KB\n", d1, m1/1024)

    d2, m2 := runBounded(n, 100)
    fmt.Printf("bounded(100): %v, +%d KB\n", d2, m2/1024)
}
```

You will typically find the unbounded version uses 10–50 MB of heap and the bounded version uses < 1 KB. The bounded version is also faster in real systems because there is no GC pressure. The benchmark drives home the point in five seconds.

---

## A Word on Channels vs `sync.Cond` vs Atomics

You can implement backpressure with any synchronisation primitive. Channels are idiomatic but not magic.

- **Channels** read naturally for queues. A buffered channel *is* a queue.
- **`sync.Cond`** is sometimes used by libraries that need to signal "queue has space" or "queue has work" with custom data structures. More flexible, much more error-prone.
- **Atomic counters** count items in flight. Combined with a `sync.Cond` or channel for signalling, they implement the same patterns.
- **`golang.org/x/sync/semaphore`** is a weighted semaphore — useful when items have different weights (e.g., a tiny job and a huge one both compete for a fixed budget).

For juniors, channels are the right default. Pull in `sync.Cond` or weighted semaphores only when you have a measured reason.

---

## A Note on Memory Profiling

If you suspect a leaky queue, take a heap profile:

```sh
go tool pprof http://localhost:8080/debug/pprof/heap
```

In the profile, look for `make.chan` and slice growth in queue types. A channel buffer that consumes megabytes is a sign of an oversized buffer; a slice that grows over hours is the unbounded-slice antipattern.

The `runtime/pprof` package can also dump goroutine stacks. A backpressure-related leak often shows up as thousands of goroutines parked on `chan send`. Each parked goroutine corresponds to a producer that the consumer never caught up to.

---

## Migrating From a Hand-Rolled Queue

If you inherit code that uses a slice + mutex as a queue, here is the standard migration:

1. Identify the producer side and the consumer side.
2. Replace the slice with `make(chan T, N)` where N is your chosen buffer size.
3. Replace `Push` with `ch <- x` (or non-blocking `select` if drops are OK).
4. Replace `Pop` with `<-ch`.
5. Move ownership of the close to a single goroutine — usually the topmost producer.
6. Remove the mutex. Channels are already synchronised.
7. Add `len(ch)` and `cap(ch)` to your metrics.
8. Add a test that pushes more than N items and verifies the producer blocks or rejects.

The migration is usually a net code reduction. The hand-rolled queue had 100 lines; the channel-based one has 20.

---

## Closing Thoughts (for Juniors)

If you take away one thing from this page, take this: **every queue in your program must have a maximum size, and you must decide what happens when it fills.**

If you have not chosen between block, drop, and reject, the runtime has chosen for you — and the runtime has chosen "let memory grow until the OS kills us." That is the default in a language with a garbage collector and no exception for queues. Pick on purpose.

Beyond this, backpressure has another effect that takes time to appreciate: it makes systems honest. A service with no backpressure reports "everything is fine" right up until the OOM kill, because slow degradation looks the same as healthy slowness. A service with backpressure reports overload as 503 the moment it occurs, giving operators a chance to scale, page, or shed traffic upstream. That honesty is the difference between operating a service and being operated by one.

In the next levels we will look at semaphores, AIMD, token buckets, queue theory, and distributed backpressure. They are all variations on the theme of this page: stop pretending the consumer can keep up.

---

## Frequently Asked Junior Questions

**Q: My program blocks forever when I send to a channel. What did I do wrong?**

A: Probably one of: no goroutine is ever reading, the reader returned before reading, or the channel is unbuffered and the reader is busy. Run with `GODEBUG=schedtrace=1000` or take a goroutine dump (`SIGQUIT` on Linux) to see what is parked where.

**Q: Should buffers ever be larger than 1000?**

A: Rarely. If you find yourself wanting > 1000, ask whether you are using the buffer as a queue (use a real queue with bounded admission) or as a shock absorber (a smaller buffer is enough). Numbers in the millions almost always indicate a missing capacity plan.

**Q: My channel is `make(chan T, 100)` but `len(ch)` shows 0 and the producer is fast. Why?**

A: Because the consumer is keeping up. That is the happy path. Watch `len(ch)` under sustained load to see if it climbs.

**Q: Is it safe to call `len(ch)` and `cap(ch)` on a closed channel?**

A: Yes. `len` returns the number of remaining buffered items. `cap` returns the original capacity. Receivers can still drain a closed channel.

**Q: My HTTP handler does `ch <- x` and the server hangs under load. What is happening?**

A: The handler goroutines pile up waiting for queue slots. Use `select` with `default` (drop), or `select` with `<-ctx.Done()` (timeout + 503).

**Q: Is `make(chan T, 1)` a useful pattern?**

A: Very. It is a "one-slot mailbox." Common uses: one-shot result delivery, "latest value wins" registers (combined with non-blocking send), or "edge-triggered" notifications.

**Q: Do I need to close every channel?**

A: No. Closing is only necessary when consumers use `range` over the channel or check the second return value of `<-`. Long-lived channels in long-running services often never close.

**Q: What's the difference between `select { case ch <- x: default: }` and `if len(ch) < cap(ch) { ch <- x }`?**

A: The first is atomic; the second has a race window. Always prefer the first.

**Q: Can I make a "priority queue" with channels?**

A: Not directly; channels are FIFO with no priority. The standard trick is two channels — a high-priority one and a low-priority one — read in a `select`. If both are ready, the runtime picks pseudo-randomly. For strict priority, use two-stage: read the high-priority one first with non-blocking, then fall back.

**Q: I see `make(chan T, 0)` in some code. Is that the same as `make(chan T)`?**

A: Yes. Both make an unbuffered channel.

---

## A Tiny Decision Tree

```
Is the producer fully under your control and willing to wait?
├── YES → Blocking send (`ch <- x`)
└── NO → Is losing the work acceptable?
         ├── YES → Non-blocking send (`select default`)
         └── NO  → Send with deadline (`select <-ctx.Done()`)
                  └── On timeout, return 503 / error to caller.
```

If you cannot answer "is losing the work acceptable?", you are not ready to ship the feature. Backpressure design is a question you must answer, not skip.

---

## Hands-on Walkthrough: Build a Mini Email Sender

Goal: an in-process service that accepts emails via a method and sends them in the background, with backpressure.

```go
package mail

import (
    "context"
    "errors"
    "sync"
    "sync/atomic"
)

type Email struct {
    To, Subject, Body string
}

type Sender struct {
    inbox    chan Email
    wg       sync.WaitGroup
    sent     atomic.Uint64
    dropped  atomic.Uint64
    rejected atomic.Uint64
}

var ErrBusy = errors.New("mail sender busy")

func NewSender(workers, buffer int, send func(Email) error) *Sender {
    s := &Sender{inbox: make(chan Email, buffer)}
    for i := 0; i < workers; i++ {
        s.wg.Add(1)
        go func() {
            defer s.wg.Done()
            for e := range s.inbox {
                if err := send(e); err == nil {
                    s.sent.Add(1)
                }
            }
        }()
    }
    return s
}

// Submit waits up to ctx.Deadline for a slot.
func (s *Sender) Submit(ctx context.Context, e Email) error {
    select {
    case s.inbox <- e:
        return nil
    case <-ctx.Done():
        s.rejected.Add(1)
        return ErrBusy
    }
}

// TrySubmit drops on full.
func (s *Sender) TrySubmit(e Email) bool {
    select {
    case s.inbox <- e:
        return true
    default:
        s.dropped.Add(1)
        return false
    }
}

func (s *Sender) Close() {
    close(s.inbox)
    s.wg.Wait()
}

func (s *Sender) Stats() (sent, dropped, rejected uint64, queue int) {
    return s.sent.Load(), s.dropped.Load(), s.rejected.Load(), len(s.inbox)
}
```

This is 60 lines of Go that:

- Bounds memory (queue size = buffer).
- Bounds in-flight work (workers).
- Supports blocking with timeout (`Submit`).
- Supports drop-on-full (`TrySubmit`).
- Exposes counters for observability.
- Shuts down cleanly (`Close`).

Build it. Add a small `main` that calls `TrySubmit` in a loop with a deliberately slow `send` function. Watch `Stats()`. You have built backpressure.

---

## Appendix: How Channels Work (Just Enough for Now)

A buffered channel in Go is a small struct that contains:

- A ring buffer of `cap` slots.
- A mutex for internal state.
- A list of goroutines waiting to send.
- A list of goroutines waiting to receive.
- A closed flag.

When you send:

- Lock the mutex.
- If a receiver is waiting, hand the value directly and wake the receiver. Unlock. Done.
- Else if the buffer has room, copy the value into the next slot. Unlock. Done.
- Else, add yourself to the senders-waiting list. Unlock. Park.

When you receive: the mirror image.

Two takeaways:

1. The data structure is fixed-size. No allocations during normal send/receive (after construction).
2. The wait queues are FIFO at the runtime level, but `select` randomisation means application-visible ordering across multiple cases is pseudo-random.

You do not need to memorise the internals to use channels well — but knowing that "the buffer is a ring, the wait is a list, and the operations are O(1)" is enough to explain why bounded channels scale and unbounded slices do not.

---

## Appendix: Reading List of Real-World Failures

Backpressure is best learned by reading post-mortems. A few public examples (paraphrased; search for the real reports):

- A streaming service's video transcoder used an unbounded `chan Job`. A spike in uploads pushed millions of jobs into the queue. RSS hit 50 GB. The OOM killer terminated the worker. Restart fed the same backlog back in. Cascade until the upstream API was paused manually. Fix: bounded queue, drop on full, return 429 to uploader.
- A search service had a fan-out where each query hit 50 shards. Each shard's call had no timeout. One slow shard caused every query to wait. Goroutines piled up. RSS climbed. Fix: per-shard timeouts, drop slow shards, return partial results.
- A log shipper used unbuffered channels into a slow upstream. Producers (every line of every server) were blocked on the unbuffered channel. Effectively, the slow upstream slowed every server. Fix: bounded channel with non-blocking send and a drop counter.
- A gaming chat service used `for { msg := <-clientCh; broadcast(msg) }` per connection. A slow client's `broadcast` was synchronous and blocked the read of new messages. The server's memory ballooned with backed-up TCP. Fix: per-client outbox with bounded buffer; slow clients are dropped.

Each of these is a different shape of the same mistake: somewhere in the pipeline, a producer can outrun the consumer. The fix in each case is the bounded channel and a deliberate drop / reject / block policy.

---

## Appendix: When to Use Unbuffered Channels

An unbuffered channel is the *strictest* backpressure: the sender does not return until the receiver is ready. This is often exactly what you want when:

- Two goroutines need a strict handshake. E.g., a goroutine that publishes results one at a time; a consumer that wants them serially.
- You want producer and consumer to run in lockstep. No buffering, no jitter absorption.
- You want to ensure that if the consumer dies, the producer blocks rather than queues up work that will be lost.

The common belief that unbuffered channels are "slow" is wrong. The overhead per operation is similar to buffered. The reason to add a buffer is to absorb jitter, not to gain performance.

Example: a UDP listener that hands each packet to a parser via an unbuffered channel will rate-limit itself to the parser's speed. If the parser is too slow, the kernel UDP buffer fills and packets are dropped at the OS layer — which is *fine*. Backpressure has been pushed all the way down to the kernel. Adding a Go-side buffer just adds heap memory before the same drop.

---

## Appendix: A Mini Glossary of Production Failure Modes

| Failure mode | What it looks like | Root cause | Fix |
|---|---|---|---|
| **Unbounded queue** | RSS grows linearly under load | Unbounded slice or huge channel buffer | Bound the queue |
| **Goroutine leak** | Goroutine count climbs forever | Goroutines blocked on a channel no one reads | Add `ctx.Done` to every select |
| **Death by retry** | Spike of 10× normal RPS after a brief outage | Clients retry without backoff | Server returns 503 with `Retry-After`; clients implement jitter+backoff |
| **Queue head-of-line block** | One slow job stalls all subsequent ones | FIFO queue with mixed work | Separate queues per job class; bounded each |
| **Slow disk = slow app** | Latency suddenly 100× when disk is slow | Logger or audit writer is in-line and blocks | Move to bounded channel + async writer |
| **Auth burst** | Login storms saturate the whole service | Auth is in-line and slow | Bound auth concurrency; reject excess with 503 |
| **Single-client greed** | One client's traffic crowds out others | No per-client quota | Per-client semaphore or token bucket |

You will see these failure modes repeatedly across your career. The fix is almost always "bound something."

---

## Appendix: Tiny Quiz

Read each scenario and choose: block, drop, or reject.

1. A user clicked "submit" on a form. Their request is in your handler. The downstream queue is full.
   * **Reject.** Return 503 quickly and let the client retry or show an error.
2. A metrics agent inside a worker has 10,000 metric samples buffered. The internal channel to the network sender is full.
   * **Drop.** Losing a few samples is acceptable; blocking the worker is not.
3. An in-process pipeline transforms uploaded video. Stage 2 is slower than stage 1. The buffer between them is full.
   * **Block.** Stage 1 has nothing else to do; let it wait.
4. A WebSocket message arrives. The per-client outbox is full because the client is slow.
   * **Reject (disconnect).** Hold up the client; do not consume server memory for a slow remote.
5. A background indexer is rebuilding an index. The work-item channel is full.
   * **Block.** The indexer is internal and serial; waiting is fine.
6. An admin's request to delete a record hits a full queue.
   * **Reject** with a clear error so the admin retries. Do not silently drop admin work.

If you got fewer than five right, re-read the "Block, drop, or reject" section.

---

## Appendix: Defensive Idioms

A few defensive habits to adopt early:

```go
// 1. Always cancel a context you derived.
ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
defer cancel()
```

```go
// 2. Always pair WaitGroup Add and Done.
wg.Add(1)
go func() {
    defer wg.Done()
    // ...
}()
```

```go
// 3. Pre-declare directionality on channel params.
func produce(out chan<- Job)             // can only send
func consume(in <-chan Job)              // can only receive
func relay(in <-chan Job, out chan<- Job) // typed both ways
```

```go
// 4. Close from a single owner.
type closer struct{ once sync.Once; ch chan T }
func (c *closer) Close() { c.once.Do(func() { close(c.ch) }) }
```

```go
// 5. Log drops at low rate.
var lastLog atomic.Int64
if atomic.AddUint64(&drops, 1) % 1000 == 0 {
    log.Println("dropped", drops, "items")
}
```

Each of these is a tiny line of defence against a class of bugs you will encounter sooner or later.

---

## Appendix: A Final Story

A junior engineer once shipped an internal service that polled a database every second and wrote work items into a Go channel. The consumer was a slow legacy system. The channel was made with `make(chan Job, 100000)` — a hundred thousand slots, "to be safe."

For two months, life was good. The consumer kept up. The buffer never went above 50 items. The service ran in 100 MB of RAM.

Then a configuration change made the consumer twice as slow. The producer's rate did not change. The buffer began filling. At hour 6, the buffer was full. The producer started blocking. The poll loop started running every 1 second + queue-wait time. Items piled in the database table that fed the producer.

At hour 12, the database table was 5 million rows and growing. The DBA paged on disk usage. The producer's poll query started taking 30 seconds because the table was so large. The producer was now sending one batch every 30 seconds. Items piled in the table faster. The cycle continued.

At hour 24, the database's WAL filled the disk. The database crashed. The service was down.

The first fix on call was "make the buffer bigger." It would have only deferred the crash. The real fix was:

- Bound the buffer to something small (100).
- Use `select` with `default` to drop on full and count drops.
- Add a metric on drop rate.
- Alert when drop rate > 0.

After the fix, the same load slowed the consumer but did not crash anything. The producer dropped items it could not deliver and increased the drop counter. Operators saw the metric, recognised the slow consumer, and fixed it during business hours. No incident.

The lesson is the lesson of this entire page: backpressure is what turns a quietly broken system into a loudly degraded one. Loudly is much better.

---

## Appendix: Glossary of Idioms (Quick Reference)

| Idiom | Meaning |
|---|---|
| `ch <- x` | Blocking send |
| `select { case ch <- x: default: }` | Non-blocking send |
| `select { case ch <- x: case <-ctx.Done(): }` | Send with timeout/cancel |
| `<-ch` | Blocking receive |
| `x, ok := <-ch` | Receive with "closed" flag |
| `for x := range ch { ... }` | Drain until closed |
| `close(ch)` | Mark channel as closed (do this once, from the producer side) |
| `len(ch)` | Current number of buffered items |
| `cap(ch)` | Maximum buffer size |
| `make(chan T)` | Unbuffered |
| `make(chan T, N)` | Buffer of N |
| `chan<- T` | Send-only channel parameter |
| `<-chan T` | Receive-only channel parameter |
| `chan struct{}` | Cheap signal channel; no payload |

---

## Final Self-Check

If you read this whole page, you should now be able to answer "yes" to all of the following:

- I can read a buffered channel declaration and tell you what it buys.
- I can recognise an unbounded queue in unfamiliar code at a glance.
- I can write a 50-line worker pool that supports three submit modes.
- I can describe what happens when an HTTP server has no admission control.
- I can pick block, drop, or reject for any given producer/consumer pair, and defend my choice.
- I know that backpressure must travel end-to-end, and that one missing link defeats it.
- I have at least one observable metric per channel in any system I write.

If you said yes to all seven, you are ready for `middle.md`. There we will look at semaphores (the next level up from buffered channels), bounded fan-in/fan-out, propagating context across pipelines, watermark-based shedding, and how to instrument a real production worker pool.

---

## Appendix: A Long-Form Case Study — Rebuilding an Image-Resize Service

This case study walks through a complete journey from a naive Go service to a backpressure-aware one. Every change is in response to a real problem that arises from running the service under load.

### The starting point

```go
package main

import (
    "image"
    "image/jpeg"
    _ "image/png"
    "net/http"
    "github.com/nfnt/resize"
)

func handler(w http.ResponseWriter, r *http.Request) {
    img, _, err := image.Decode(r.Body)
    if err != nil {
        http.Error(w, err.Error(), 400)
        return
    }
    out := resize.Resize(800, 0, img, resize.Lanczos3)
    w.Header().Set("Content-Type", "image/jpeg")
    jpeg.Encode(w, out, nil)
}

func main() {
    http.HandleFunc("/resize", handler)
    http.ListenAndServe(":8080", nil)
}
```

This is the classic Go image service every junior writes. It is correct. It is also a time bomb.

### Symptom 1: Memory blows up under load

We deploy this. A campaign pushes 200 concurrent uploads. The service allocates a 4 MB decoded image per request, a 1 MB resized image, and various intermediate buffers. With 200 in-flight, peak memory is ~1.5 GB.

200 requests is not even a heavy load. What is happening?

There is no limit on concurrent handlers. Every request spawns a new goroutine via `net/http`'s default behaviour. With unbounded concurrency, the memory usage scales linearly with the request rate × the slowest request's duration.

**Fix 1: Admission control.**

```go
var slots = make(chan struct{}, 32)

func handler(w http.ResponseWriter, r *http.Request) {
    select {
    case slots <- struct{}{}:
        defer func() { <-slots }()
    default:
        http.Error(w, "busy", http.StatusServiceUnavailable)
        return
    }
    // ... same as before
}
```

Now at most 32 requests are processed concurrently. Excess requests get 503 instantly. Memory caps at ~256 MB.

But there is a new problem.

### Symptom 2: Brief jitter causes 503 storms

We notice that during normal load (~10 RPS), every few seconds the GC pauses for 80 ms. During that pause, in-flight requests do not complete. New requests find the semaphore full and get 503. Bursts of 503 errors appear in the metrics every few minutes.

The semaphore is *too eager* to reject. A small wait would let most of these through.

**Fix 2: Wait briefly before rejecting.**

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 200*time.Millisecond)
    defer cancel()
    select {
    case slots <- struct{}{}:
        defer func() { <-slots }()
    case <-ctx.Done():
        http.Error(w, "busy", http.StatusServiceUnavailable)
        return
    }
    // ...
}
```

200 ms is long enough to absorb GC pauses and short enough that overload is still surfaced quickly. The 503 storms disappear.

### Symptom 3: Slow clients eat slots

A second symptom appears: occasionally a single slow client uploads a 50 MB file over a 100 KB/s connection. The image decode waits on the slow Body read. The slot is held for 8 minutes. With 32 slots, eight such clients can pin the entire service.

**Fix 3: Cap the read time and body size.**

```go
const maxBody = 10 << 20 // 10 MB
const decodeBudget = 5 * time.Second

func handler(w http.ResponseWriter, r *http.Request) {
    // ... acquire slot as before ...
    r.Body = http.MaxBytesReader(w, r.Body, maxBody)

    ctx, cancel := context.WithTimeout(r.Context(), decodeBudget)
    defer cancel()
    type result struct{ img image.Image; err error }
    ch := make(chan result, 1)
    go func() {
        img, _, err := image.Decode(r.Body)
        ch <- result{img, err}
    }()
    var res result
    select {
    case res = <-ch:
    case <-ctx.Done():
        http.Error(w, "decode too slow", http.StatusGatewayTimeout)
        return
    }
    // ...
}
```

Now a slow client cannot hold a slot for longer than 5 seconds. The 503/504 rate is visible in metrics; the service stays predictable.

### Symptom 4: CPU contention degrades all requests

We move past the input-side issues. Now we observe that during heavy uploads, all 32 in-flight resizes share the machine's 8 CPU cores. Each one runs slower than it would alone. p50 latency creeps from 200 ms to 800 ms.

The "right" concurrency limit is not 32 (the upload rate) but ~8 (the core count for CPU-bound work).

**Fix 4: Separate slots for I/O wait and CPU work.**

```go
var ioSlots = make(chan struct{}, 64)   // tolerate slow uploads
var cpuSlots = make(chan struct{}, 8)   // limit CPU contention

func handler(w http.ResponseWriter, r *http.Request) {
    // acquire ioSlot for the upload duration
    ioSlots <- struct{}{}
    defer func() { <-ioSlots }()

    img, _, err := image.Decode(r.Body)
    if err != nil { http.Error(w, err.Error(), 400); return }

    // upload done; acquire cpuSlot for the resize
    cpuSlots <- struct{}{}
    defer func() { <-cpuSlots }()

    out := resize.Resize(800, 0, img, resize.Lanczos3)
    w.Header().Set("Content-Type", "image/jpeg")
    jpeg.Encode(w, out, nil)
}
```

Now CPU work is bounded to 8 simultaneous resizes; uploads can have up to 64 concurrent users without competing for CPU. p50 stabilises.

### Symptom 5: Metrics, please

Operators ask: "How do we know if the service is overloaded?" We add counters:

```go
var (
    accepted = promauto.NewCounter(prometheus.CounterOpts{Name: "accepted_total"})
    rejected = promauto.NewCounter(prometheus.CounterOpts{Name: "rejected_total"})
    ioBusy   = promauto.NewGauge(prometheus.GaugeOpts{Name: "io_slot_usage"})
    cpuBusy  = promauto.NewGauge(prometheus.GaugeOpts{Name: "cpu_slot_usage"})
)
```

With these, an alerting rule like `rejected_total[5m] > 0.05 * accepted_total[5m]` fires when the service rejects more than 5% of incoming requests — a signal that the service needs more capacity or that traffic has spiked.

### Symptom 6: Drain on shutdown

When deployments roll out, the service receives SIGTERM. The default Go server immediately stops accepting new connections, but in-flight requests are killed mid-resize. Clients see broken pipes.

**Fix 6: Graceful shutdown.**

```go
func main() {
    srv := &http.Server{Addr: ":8080"}
    http.HandleFunc("/resize", handler)
    go func() { srv.ListenAndServe() }()

    sig := make(chan os.Signal, 1)
    signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
    <-sig

    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    srv.Shutdown(ctx)
}
```

`Shutdown` stops accepting new connections and waits up to 30 seconds for in-flight requests to finish. We have full backpressure end-to-end: requests are admitted only when slots are free, denied with 503 under overload, and drained cleanly on shutdown.

### Summary of the journey

| Iteration | Change | What it fixed |
|---|---|---|
| 0 | Naive handler | Nothing. OOM under load. |
| 1 | Semaphore | Bounded memory. |
| 2 | 200 ms wait before 503 | Absorbed GC jitter. |
| 3 | `MaxBytesReader` + decode timeout | Slow clients cannot pin slots. |
| 4 | Separate I/O and CPU semaphores | Right limit for each resource. |
| 5 | Metrics | Operators can see overload. |
| 6 | Graceful shutdown | No half-finished requests. |

Every iteration is a deliberate response to a real problem, and every iteration is a tiny amount of code. Backpressure is not a single technique; it is a discipline that touches every part of the request path.

---

## Appendix: Comparing Backpressure with Adjacent Concepts

### Backpressure vs Rate Limiting

Rate limiting answers "how many requests per second?" Backpressure answers "how much work in flight?"

They are different metrics and different policies. A rate-limited service might accept 1,000 requests/second whether or not they finish in time. A backpressure-aware service accepts only as many as it can process concurrently, regardless of arrival rate.

Both are useful. A real system usually has both: a token-bucket rate limit at the edge (to prevent any one client from monopolising) plus a concurrency-based admission control (to prevent overload of the service overall).

### Backpressure vs Circuit Breaker

A circuit breaker is a defensive mechanism for *outbound* calls. If a downstream service is failing, the circuit breaker stops calling it for a while, returning errors locally. This is graceful degradation.

Backpressure is for *inbound* calls. If we cannot keep up, we tell the caller to slow down (or stop) instead of accepting work we will never finish.

They are different sides of the same coin: both prevent cascading failures.

### Backpressure vs Bulkhead

Bulkhead is the pattern of isolating resources so that failure in one part of the system does not crash the rest. Per-tenant connection pools, per-feature thread pools, separate queues for high- and low-priority work — all are bulkhead patterns.

Backpressure tells you *when* to bulkhead: if one tenant's slow queue is blocking everyone, separate the queues. The bulkhead is the structural change; backpressure is the symptom you treat.

### Backpressure vs Retry

Retry is what the client does when the server says 503. A retry without backoff is worse than no retry: it amplifies the load. Modern retry policies use exponential backoff with jitter so that, even if a thousand clients all retry, they spread out in time.

Backpressure on the server side and intelligent retry on the client side are partners. Each alone is insufficient.

---

## Appendix: Practical Configuration Cheat Sheet

When configuring a new service with backpressure, start with these defaults:

| Parameter | Starting value | Notes |
|---|---|---|
| Worker count | `runtime.NumCPU()` for CPU-bound work | Adjust for I/O-bound up to ~10× cores |
| Buffer size | 2× worker count | Absorbs short jitter |
| Submit timeout | 100–500 ms | Long enough for GC, short enough to surface overload |
| Body size limit | 10 MB (or smaller) | Prevents single-client memory exhaustion |
| Request total timeout | < expected p99 × 2 | Captures slow paths without hanging forever |
| Shutdown grace period | 30 seconds | Time to drain in-flight requests |
| Drop log rate | every 1,000 drops | Avoid log spam, keep visibility |

These are not magic numbers — they are starting points. Measure, tune, repeat.

---

## Appendix: A Mental Exercise

Imagine you are operating a coffee shop with three baristas. Customers arrive at random times. Each drink takes 90 seconds to make. The shop holds a queue of at most 10 customers.

- What happens if 15 customers arrive in 30 seconds?
  - First 13 fit (3 being served, 10 in queue). The 14th and 15th must turn away or wait outside (rejection).
- What if the espresso machine breaks and drinks take 5 minutes?
  - The queue fills. New customers see "queue full" and leave. Memory (the cafe's seating) stays bounded.
- What if you add a fourth barista?
  - Throughput grows by 33%. The queue empties faster. Reject rate drops.
- What if you put the queue outside in the rain with no roof?
  - Customers leave even when there is room. You have introduced a different overload signal: discomfort. That is "drop" by external constraint.

This is exactly how a Go service behaves with bounded channels and a worker pool. Each parameter has a coffee-shop equivalent. If you can run the coffee shop, you can run the service.

---

## Appendix: The Production Backpressure Checklist

Before shipping any concurrent Go service, run through this list:

- [ ] Every channel that crosses a goroutine boundary has a buffer size — and you can defend it.
- [ ] Every entry point (HTTP handler, RPC handler, message-queue consumer) has an admission control.
- [ ] Every blocking send has a context-aware variant.
- [ ] Every drop path increments a counter.
- [ ] Every reject path returns a distinguishable error.
- [ ] Every worker checks `ctx.Done()` on long operations.
- [ ] Every shutdown path drains in-flight work.
- [ ] Every buffer's depth is exposed as a metric.
- [ ] Every rejection rate over 1% has an alert.
- [ ] Every backpressure-related metric is on a dashboard the on-call sees.
- [ ] There is a load test that drives the service past its admission limit and verifies rejections.

If you can tick all eleven, your service has real backpressure. If you cannot, you have a future incident waiting.

---

## Appendix: One More Look at `select`

`select` is the engine of every backpressure pattern in Go. A few details that catch beginners:

- The *order* of `case` clauses does not affect which one is picked. If multiple cases are ready, one is chosen pseudo-randomly.
- A `default` case is taken only if no other case is ready *right now*. There is no waiting.
- A `nil` channel in any case is *never* ready. This is useful for disabling a case dynamically.
- A `select` with only a `default` and no other case is the same as just running the body of `default`.
- A `select` with no cases and no default (`select {}`) blocks forever. Useful for "park this goroutine."

Combining these, a powerful idiom is the **"latest value wins" register**:

```go
type Register[T any] struct {
    ch chan T
}

func NewRegister[T any]() *Register[T] {
    return &Register[T]{ch: make(chan T, 1)}
}

func (r *Register[T]) Set(v T) {
    select {
    case r.ch <- v:
    default:
        // buffer full — discard the old value, store the new one
        <-r.ch
        r.ch <- v
    }
}

func (r *Register[T]) Get() T {
    return <-r.ch
}
```

This is backpressure with a twist: instead of dropping the new value, we drop the *old* one. Useful for last-known-status registers where stale data is worse than fresh.

---

## Appendix: How `context` Plays with Backpressure

`context.Context` is the lubricant of every backpressure pattern that involves timeouts. Two rules:

1. **Always check `ctx.Done()` in any `select` that involves a blocking channel operation.** If you forget, your goroutine can block forever even when the caller has given up.
2. **Always derive a context with a deadline from incoming requests.** If the request has a 1-second deadline, every internal step inherits it. Internal queues do not hold stale work beyond the deadline.

```go
func handle(ctx context.Context, j Job) error {
    select {
    case workCh <- j:
    case <-ctx.Done():
        return ctx.Err()
    }
    // ...
}
```

Without the `ctx.Done()` case, a stuck queue means a stuck handler means a stuck request. With it, overload surfaces as `context.DeadlineExceeded` and the client sees a clear error.

---

## Appendix: Reading Goroutine Dumps

When debugging a hung server, send SIGQUIT and read the goroutine dump. Backpressure-related issues show up as patterns:

- Thousands of goroutines blocked on `chan send` → an unbounded producer with a slow consumer.
- Thousands of goroutines blocked on `chan receive` → an over-provisioned worker pool with no work.
- One goroutine blocked on `chan send` and another on `chan receive` on different channels → a coordinated deadlock; check for closed channels or missing close calls.
- Many goroutines blocked on `select` with `ctx.Done()` cases → expected; these are just waiting for their context to fire.

Reading goroutine dumps is a skill you build over time. The shapes are reasonably consistent: bounded channels under saturation, unbounded queues under leak, and lost contexts under bugs.

---

## Appendix: A Plea For Honesty

Many junior engineers, when they discover backpressure, want to add it everywhere immediately. The temptation is understandable but premature. Backpressure is appropriate when:

- You have producers and consumers running at different rates.
- The work passes through a queue (explicit or implicit).
- Overload is a real risk for the service's traffic profile.

Backpressure is overkill when:

- You are writing a one-shot CLI tool.
- The work fits comfortably in memory and runs in a single goroutine.
- The "queue" is one item long and synchronous.

Discipline does not mean reflex. Decide on purpose where backpressure helps and where it just complicates the code.

That said: most production services with concurrent workloads need backpressure. The default is *yes*. The exceptions prove the rule.

---

## Appendix: Worked Exercises

The following short exercises are designed to be done in 10–20 minutes each. They build a concrete intuition for the patterns you have read about. Each one fits in a single `main.go`.

### Exercise A — Build a "Latest 10" event log

Build an in-memory event log that keeps only the 10 most recent events. New events arrive concurrently; readers can read the full list at any time.

Constraints:

- Memory must be O(10), regardless of how many events arrive.
- Writers must never block (this is a telemetry use case).
- Readers should get a consistent snapshot.

Solution sketch:

```go
type EventLog struct {
    mu   sync.Mutex
    ring [10]string
    next int
    full bool
}

func (l *EventLog) Add(e string) {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.ring[l.next] = e
    l.next = (l.next + 1) % len(l.ring)
    if l.next == 0 { l.full = true }
}

func (l *EventLog) Snapshot() []string {
    l.mu.Lock()
    defer l.mu.Unlock()
    if !l.full {
        out := make([]string, l.next)
        copy(out, l.ring[:l.next])
        return out
    }
    out := make([]string, len(l.ring))
    copy(out, l.ring[l.next:])
    copy(out[len(l.ring)-l.next:], l.ring[:l.next])
    return out
}
```

This is "drop oldest" backpressure: when the ring is full, the new entry overwrites the oldest. No queue grows. No writer blocks.

### Exercise B — A simple admission controller

Write a struct with `Try(ctx context.Context) (release func(), err error)`. The struct should allow at most N concurrent holders; further callers wait until either a slot frees or the context expires.

Solution sketch:

```go
type Admit struct {
    sem chan struct{}
}

func NewAdmit(n int) *Admit {
    return &Admit{sem: make(chan struct{}, n)}
}

func (a *Admit) Try(ctx context.Context) (func(), error) {
    select {
    case a.sem <- struct{}{}:
        return func() { <-a.sem }, nil
    case <-ctx.Done():
        return func() {}, ctx.Err()
    }
}
```

Use it in an HTTP handler:

```go
release, err := admit.Try(ctx)
if err != nil {
    http.Error(w, "busy", 503); return
}
defer release()
```

You have built admission control in 12 lines.

### Exercise C — Bounded broadcaster

Write a struct that lets producers publish messages and subscribers receive copies. Each subscriber has a bounded buffer; slow subscribers are dropped (or disconnected).

Solution sketch:

```go
type Broadcaster struct {
    mu     sync.Mutex
    subs   map[chan string]struct{}
}

func (b *Broadcaster) Subscribe(buf int) <-chan string {
    ch := make(chan string, buf)
    b.mu.Lock()
    if b.subs == nil { b.subs = map[chan string]struct{}{} }
    b.subs[ch] = struct{}{}
    b.mu.Unlock()
    return ch
}

func (b *Broadcaster) Publish(m string) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for ch := range b.subs {
        select {
        case ch <- m:
        default:
            // slow subscriber: drop the message (or disconnect entirely)
            close(ch)
            delete(b.subs, ch)
        }
    }
}
```

Slow subscribers are removed; fast subscribers see every message; the broadcaster itself never blocks on a slow consumer. This is the model used by chat servers and event buses.

### Exercise D — Watermark-based admission

Implement a worker pool that *starts* rejecting submits when the queue fills past 80%, and *stops* rejecting only when the queue drops below 40%. This is hysteresis — common in industrial control.

Solution sketch:

```go
type HysteresisPool struct {
    jobs       chan func()
    high, low  int
    shedding   atomic.Bool
}

func (p *HysteresisPool) Submit(j func()) bool {
    l := len(p.jobs)
    if p.shedding.Load() {
        if l < p.low { p.shedding.Store(false) }
    } else {
        if l > p.high { p.shedding.Store(true) }
    }
    if p.shedding.Load() { return false }
    select {
    case p.jobs <- j:
        return true
    default:
        return false
    }
}
```

Hysteresis prevents thrashing when the queue oscillates around a single threshold. The price is a small lag in reacting; for most workloads it is a net win.

### Exercise E — Token bucket on a channel

Implement a token bucket as a refilling channel. Each "request to enter" pulls a token; a goroutine refills tokens at a fixed rate.

Solution sketch:

```go
type Bucket struct {
    tokens chan struct{}
}

func NewBucket(capacity int, rate time.Duration) *Bucket {
    b := &Bucket{tokens: make(chan struct{}, capacity)}
    go func() {
        t := time.NewTicker(rate)
        for range t.C {
            select {
            case b.tokens <- struct{}{}:
            default:
            }
        }
    }()
    return b
}

func (b *Bucket) Take(ctx context.Context) error {
    select {
    case <-b.tokens:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

This is rate limiting in 20 lines, using only channels. Callers `Take` a token before doing work; if no tokens are available, they wait (with cancellation support).

Each of these exercises uses only patterns from this page. You can build all five in an afternoon. Together they cover most of the backpressure primitives you will need in your first year of Go.

---

## Appendix: Common Junior Pitfalls — Walked Through

Below are three real bug patterns from junior Go code, walked through line by line.

### Bug 1: The "I'll buffer it for now" channel

```go
ch := make(chan Event, 100000)
go func() {
    for e := range ch {
        send(e)
    }
}()
// Later, anywhere in the app:
ch <- e
```

The author thought: "100,000 is enough for any spike." Then their app saw a 1M-event campaign. Memory climbed to 1.5 GB. The send loop fell behind. RSS triggered an OOM in production.

The fundamental error: treating buffer size as "enough." There is no "enough" if the producer can outpace the consumer indefinitely. The right design is a *small* buffer + a drop or reject policy.

Fix:

```go
ch := make(chan Event, 100) // small
select {
case ch <- e:
default:
    drops.Inc() // operators see this and decide what to do
}
```

### Bug 2: The blocking handler

```go
func handler(w http.ResponseWriter, r *http.Request) {
    workQueue <- parseRequest(r) // blocks if full
    fmt.Fprint(w, "queued")
}
```

Under load, every handler goroutine waits for a queue slot. The server keeps accepting connections (the OS does that automatically). Goroutine count climbs. RSS climbs. Eventually OOM.

The mistake: the handler blocks, but the *server accept loop* does not. Backpressure is broken at the boundary.

Fix:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 100*time.Millisecond)
    defer cancel()
    select {
    case workQueue <- parseRequest(r):
        fmt.Fprint(w, "queued")
    case <-ctx.Done():
        http.Error(w, "busy", 503)
    }
}
```

Now backpressure flows from the queue, through the handler, to the client. The client decides to retry or give up; the server stays healthy.

### Bug 3: The forgotten close

```go
ch := make(chan Job, 10)
go func() {
    for j := range ch {
        j.Run()
    }
}()
for _, j := range jobs {
    ch <- j
}
// (never close(ch))
```

The producer finishes. The consumer is stuck on `range ch`, waiting for more. The goroutine leaks forever.

Fix: close the channel when the producer is done.

```go
for _, j := range jobs {
    ch <- j
}
close(ch)
```

But be careful: if multiple producers send, the close must happen *after* all of them. Coordinating this is what `sync.WaitGroup` is for:

```go
var wg sync.WaitGroup
for _, p := range producers {
    wg.Add(1)
    go func(p Producer) {
        defer wg.Done()
        for j := range p.Run() {
            ch <- j
        }
    }(p)
}
go func() { wg.Wait(); close(ch) }()
```

---

## Appendix: A Visual Map of This Page

```
                                  ┌───────────────────┐
                                  │   BACKPRESSURE    │
                                  │  (this page)      │
                                  └─────────┬─────────┘
                                            │
                ┌───────────────────────────┼──────────────────────────┐
                │                           │                          │
        ┌───────▼────────┐         ┌────────▼────────┐        ┌────────▼─────────┐
        │  Bounded       │         │  Block / Drop   │        │  Propagation     │
        │  channels      │         │  / Reject       │        │  across hops     │
        └───────┬────────┘         └────────┬────────┘        └────────┬─────────┘
                │                           │                          │
       make(chan T, N)              select { default }         ctx flows downstream
       len, cap                     select { ctx.Done() }      503 / 429 to caller
       sender blocks                                            metrics at boundaries
                │                           │                          │
                └───────────────────────────┴──────────────────────────┘
                                            │
                                ┌───────────▼────────────┐
                                │  Production-ready      │
                                │  worker pool with      │
                                │  Submit / TrySubmit /  │
                                │  SubmitCtx +           │
                                │  metrics + shutdown    │
                                └────────────────────────┘
```

If you can draw and explain this diagram from memory, you have learned the page.

---

## Appendix: A Final Test of Understanding

Without looking back, answer each of the following in one sentence:

1. What is the simplest mechanism for backpressure in Go?
2. What are the three policies for "queue is full"?
3. When should you choose "drop"?
4. What is the difference between admission control and rate limiting?
5. Why is `make(chan T, 1_000_000)` bad?
6. What does `select { case ch <- x: default: }` do?
7. What is the role of `context.Context` in backpressure?
8. What metric should always accompany a drop policy?
9. What is Little's law, in plain English?
10. What is the most common Go concurrency bug, after goroutine leaks?

If you can answer all ten without hesitation, you have the foundation. The next pages — middle and senior — build on this base by introducing semaphores, AIMD, distributed flow control, and queue theory. Each is a deeper version of the same idea: stop pretending the consumer can keep up.

Good. You have made it through. Now go write some bounded channels.




