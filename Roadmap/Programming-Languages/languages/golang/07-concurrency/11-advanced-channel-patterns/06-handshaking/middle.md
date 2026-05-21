---
layout: default
title: Handshaking — Middle
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/06-handshaking/middle/
---

# Handshaking — Middle

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Bidirectional Handshakes](#bidirectional-handshakes)
5. [`chan chan T` and the Rendezvous Pattern](#chan-chan-t-and-the-rendezvous-pattern)
6. [Worker Request/Ack Loops](#worker-requestack-loops)
7. [Mutexes, `sync.Cond`, and the Channel Alternative](#mutexes-synccond-and-the-channel-alternative)
8. [Handshakes with Context](#handshakes-with-context)
9. [Composing Handshakes](#composing-handshakes)
10. [Mental Models](#mental-models)
11. [Pros & Cons](#pros--cons)
12. [Use Cases](#use-cases)
13. [Coding Patterns](#coding-patterns)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Self-Assessment Checklist](#self-assessment-checklist)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

> Focus: "I have a worker that needs to coordinate with two other goroutines. How do I make sure the right one gets the right answer? When is `chan chan T` actually useful? What does Pike's rendezvous pattern look like in real code?"

At junior level you learned the building blocks: started channels, stop/stopped pairs, reply channels embedded in requests. At middle level you compose them.

The middle-level handshake repertoire covers three things:

1. **Bidirectional handshakes**: the requester sends a request and reads a reply on the *same handshake*, with both ends synchronised.
2. **`chan chan T`**: a channel whose elements are themselves channels. This sounds esoteric until you see the worker-pool dispatch loop where it makes the whole structure click.
3. **Rendezvous patterns**: synchronous handoffs where two goroutines meet exactly at one point and exchange a value.

You will also learn to compare the channel approach with the mutex / `sync.Cond` approach, because that is the comparison your team lead will ask about in code review.

What you will be able to do by the end:

- Implement a worker pool whose dispatcher uses `chan chan Job` to route work to idle workers.
- Recognise the rendezvous pattern in `time.Tick`, `runtime.Gosched`, and your own code.
- Decide between a channel handshake and a `sync.Cond` for a given problem.
- Build handshakes that respect `context.Context` cancellation.

What is still ahead: large-scale supervisor trees, graceful shutdown with drained handshakes, leader election. Those are in [Senior](senior.md).

---

## Prerequisites

- **Required:** All of [Junior](junior.md): started channels, stop/stopped pairs, reply channels.
- **Required:** Comfortable with `select` and multi-case channel operations.
- **Required:** You have used `context.Context` in production code.
- **Required:** You know what a mutex is and you have used `sync.Mutex.Lock/Unlock`.
- **Helpful:** Familiarity with `sync.WaitGroup`, `sync.Once`, `sync.Cond`.
- **Helpful:** You have read at least one of Pike's concurrency talks.

If you have ever built a worker pool from scratch, you are at the right level.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Bidirectional handshake** | A handshake where the same goroutine pair exchanges multiple signals — usually request + reply on dedicated channels. |
| **Rendezvous** | A synchronous meeting point on an unbuffered channel; sender blocks until receiver arrives, and vice versa. |
| **`chan chan T`** | A channel whose elements are channels of T. Used in dispatch patterns where workers advertise their availability. |
| **Worker self-registration** | The pattern where a worker, upon becoming idle, sends its own input channel onto a shared dispatch channel. |
| **Backpressure** | The condition where a busy consumer slows the producer because no acknowledgement returns. |
| **Fan-out** | One producer, many consumers, each receiving from the same channel. |
| **Fan-in** | Many producers, one consumer; values from multiple channels merged into one. |
| **`sync.Cond`** | A condition variable: goroutine waits on `Wait`, woken by `Signal` or `Broadcast`. Pre-channel synchronisation primitive. |
| **Lazy initialisation** | The pattern where setup is deferred until the first use, often guarded by `sync.Once` or a started channel. |
| **Promotion ack** | A handshake where a new leader/owner waits for the previous one to step down before activating. |

---

## Bidirectional Handshakes

A bidirectional handshake is a request followed by a reply on the same handshake pair. The simplest version is the request struct from [Junior](junior.md) with an embedded reply channel:

```go
type Op struct {
    Key   string
    Reply chan string
}

ops := make(chan Op)
go func() {
    cache := map[string]string{}
    for op := range ops {
        op.Reply <- cache[op.Key]
    }
}()

reply := make(chan string, 1)
ops <- Op{Key: "name", Reply: reply}
answer := <-reply
```

The handshake is symmetric: the requester sends on `ops`, the worker sends on `Reply`, and the protocol is `send op → wait → receive answer`. This is the building block for any RPC-like in-process pattern.

### Multi-step bidirectional handshake

Sometimes you need more than request + reply. Consider a worker that must confirm receipt before processing:

```go
type Op struct {
    Key      string
    Received chan struct{} // worker acknowledges receipt
    Reply    chan string   // worker delivers answer
}

ops := make(chan Op)
go func() {
    cache := map[string]string{"name": "alice"}
    for op := range ops {
        close(op.Received) // ack: I've taken ownership
        time.Sleep(10 * time.Millisecond)
        op.Reply <- cache[op.Key]
    }
}()

received := make(chan struct{})
reply := make(chan string, 1)
ops <- Op{Key: "name", Received: received, Reply: reply}
<-received               // requester knows op is in-flight
fmt.Println("processing...")
fmt.Println(<-reply)
```

Now the requester gets two signals: "I have your op" (early ack) and "here is the answer" (late reply). Useful when the operation is slow and the caller wants to release some resource as soon as the worker has taken ownership.

### When to make the request struct generic

If your request struct grows beyond three fields, give it a generic envelope:

```go
type Request[Q any, R any] struct {
    Query Q
    Reply chan R
}
```

Then specialise:

```go
type GetRequest = Request[string, string]
type SetRequest = Request[KeyValue, error]
```

The pattern is the same; the types make the protocol legible at the call site.

---

## `chan chan T` and the Rendezvous Pattern

`chan chan T` is a channel whose elements are themselves channels of T. The first time you see it, the syntax is jarring. Once you see it in context, it makes sense.

### The motivating problem

Imagine a worker pool. Jobs arrive on a channel; workers consume them. The naive approach:

```go
jobs := make(chan Job)
for i := 0; i < N; i++ {
    go func() {
        for j := range jobs {
            process(j)
        }
    }()
}
```

This works, but it is "first available worker takes the next job." The dispatcher cannot:

- See which workers are idle vs busy.
- Pin jobs to specific workers (sticky routing).
- Implement per-worker backpressure.

### Enter `chan chan Job`

Give each worker its own input channel. Workers, when idle, advertise themselves by sending *their own channel* onto a shared dispatch channel:

```go
type Job func()

pool := make(chan chan Job, N) // dispatch channel

worker := func() {
    in := make(chan Job)
    for {
        pool <- in // "I am free; give me work"
        j := <-in  // receive the job
        j()
    }
}

dispatcher := func(jobs <-chan Job) {
    for j := range jobs {
        w := <-pool // get an idle worker's channel
        w <- j      // hand them the job
    }
}

for i := 0; i < N; i++ {
    go worker()
}
go dispatcher(externalJobs)
```

The dispatch is a rendezvous. The dispatcher picks up `w` (the worker's input channel) only when a worker is provably idle. The job sent on `w` reaches an already-blocked-and-ready receiver. No queueing, no lost backpressure, no shared mutex.

### Why this is a "handshake"

The worker's `pool <- in` is one half of the handshake — "I am ready." The dispatcher's `<-pool` is the other — "acknowledged, here is your job." Only after both sides synchronise does the job change hands. That synchronisation point is what `chan chan T` gives you.

### Tour of `chan chan T` in production

You will see this pattern in:

- `gocraft/work` and similar Go worker-pool libraries.
- The Go scheduler's internal "work-stealing" idiom (conceptually, not exactly).
- gRPC connection management — though there it is hidden behind `Pool` abstractions.

The pattern is rare in everyday application code because most pools can use a shared channel; you reach for `chan chan T` when you need explicit "I am idle" semantics.

---

## Worker Request/Ack Loops

A common variant is the request/ack loop, where the worker processes one task at a time and signals "give me another" with a fresh request. The loop is:

```go
type Task struct {
    ID int
    // ...
}

req := make(chan struct{})       // "give me work"
ack := make(chan Task)           // here is your work
done := make(chan struct{})      // "I am done"

go func() {
    tasks := []Task{{1}, {2}, {3}, {4}}
    for {
        select {
        case <-req:
            if len(tasks) == 0 {
                close(ack) // no more
                return
            }
            ack <- tasks[0]
            tasks = tasks[1:]
        case <-done:
            return
        }
    }
}()

go func() {
    for {
        req <- struct{}{}
        t, ok := <-ack
        if !ok {
            return
        }
        process(t)
    }
}()
```

The worker explicitly asks ("`req <- struct{}{}`") before receiving. The producer responds with one task per request. This is the canonical backpressure pattern: the producer cannot overwhelm the consumer because every task delivery is bracketed by an ack.

### Compared to a buffered channel

A buffered channel `tasks := make(chan Task, 100)` achieves similar throughput but allows the producer to *get ahead* by up to 100 tasks. The request/ack loop holds the producer exactly one task ahead of the consumer. Use buffered channels when you want batching; use request/ack when you want strict pacing.

### Variant: request/ack with cancellation

```go
for {
    select {
    case req <- struct{}{}:
    case <-ctx.Done():
        return ctx.Err()
    }
    select {
    case t, ok := <-ack:
        if !ok {
            return nil
        }
        process(t)
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Both legs of the handshake become cancellable. The consumer can break out of the loop without waiting for the producer to respond.

---

## Mutexes, `sync.Cond`, and the Channel Alternative

For coordinating shared state, Go gives you two roads: channels and the `sync` package. When should you pick which?

### `sync.Cond` for condition-based waiting

`sync.Cond` is a condition variable: a goroutine takes a mutex, checks a predicate, and either proceeds or calls `cond.Wait`, which atomically releases the mutex and parks. Another goroutine calls `cond.Signal` or `cond.Broadcast` to wake waiters.

```go
type Queue struct {
    mu   sync.Mutex
    cond *sync.Cond
    data []int
}

func (q *Queue) Push(v int) {
    q.mu.Lock()
    defer q.mu.Unlock()
    q.data = append(q.data, v)
    q.cond.Signal()
}

func (q *Queue) Pop() int {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.data) == 0 {
        q.cond.Wait()
    }
    v := q.data[0]
    q.data = q.data[1:]
    return v
}
```

This works, and at high contention can be more efficient than channels (no channel allocation per item). But it has problems:

- `cond.Wait` does not respect `context.Context`. You cannot break out on cancellation.
- The mutex must be held when calling `Wait` and `Signal`. Easy to forget.
- The predicate must be rechecked after waking (spurious wakeups). Easy to forget the `for` loop.

### The channel alternative

```go
type Queue struct {
    in   chan int
    out  chan int
    quit chan struct{}
}

func (q *Queue) Run() {
    var buf []int
    for {
        var sendOut chan<- int
        var nextOut int
        if len(buf) > 0 {
            sendOut = q.out
            nextOut = buf[0]
        }
        select {
        case v := <-q.in:
            buf = append(buf, v)
        case sendOut <- nextOut:
            buf = buf[1:]
        case <-q.quit:
            return
        }
    }
}
```

This pattern — sometimes called "the dynamic select" — uses a `nil` channel to disable a case. `sendOut` is `nil` when the buffer is empty, which means `sendOut <- ...` blocks forever (and so is never selected). When the buffer has data, `sendOut` becomes `q.out` and the case is enabled.

The channel version integrates with cancellation, never deadlocks on a forgotten `Signal`, and reads top-to-bottom.

### When to choose channels

- The synchronisation is between a small number of goroutines.
- You need cancellation or timeouts.
- You want the code to compose with `select` and `context`.
- You prefer the protocol to be visible in the channel types, not buried in mutex use.

### When to choose `sync.Cond`

- Many waiters and frequent signals (channel allocation hurts).
- A complex predicate that requires re-checking under a lock.
- You are interoperating with a codebase that already uses `sync.Cond`.

For most application-level code, channels win. `sync.Cond` is more of a primitive-layer tool — used by the standard library (`http.Server`, `database/sql.DB`) but rarely needed in everyday code.

---

## Handshakes with Context

Every blocking handshake should respect `context.Context`. The pattern is `select`-with-Done:

```go
func ask(ctx context.Context, in chan<- Req, q string) (Result, error) {
    reply := make(chan Result, 1)
    select {
    case in <- Req{Query: q, Reply: reply}:
    case <-ctx.Done():
        return Result{}, ctx.Err()
    }
    select {
    case r := <-reply:
        return r, nil
    case <-ctx.Done():
        return Result{}, ctx.Err()
    }
}
```

Two selects, one for the send, one for the receive. Each can be aborted by context cancellation.

### Passing context to the worker

A worker that does expensive computation should also receive the context, so it can abort:

```go
type Req struct {
    Ctx   context.Context
    Query string
    Reply chan Result
}

func worker(in <-chan Req) {
    for r := range in {
        if r.Ctx.Err() != nil {
            // requester already gave up; skip
            continue
        }
        r.Reply <- compute(r.Ctx, r.Query)
    }
}
```

The worker checks the context before doing expensive work. If the requester has timed out, the worker skips and moves on.

### When to use ctx and when to use a stop channel

- `ctx` is for *request-scoped* cancellation: this particular call should give up.
- A `stop` channel is for *lifecycle-scoped* cancellation: the whole service should shut down.

A service typically has both: a long-lived `stop` channel, and per-request `ctx`. The two compose: cancelling the service-level context cascades into every in-flight request context if you derive them from the service context.

---

## Composing Handshakes

Real services chain handshakes together.

### Started + stopped + ready handshake

```go
type Service struct {
    started chan struct{}
    stop    chan struct{}
    stopped chan struct{}
}

func (s *Service) Run() {
    defer close(s.stopped)
    if err := s.init(); err != nil {
        return
    }
    close(s.started)
    for {
        select {
        case <-s.stop:
            s.cleanup()
            return
        case ev := <-s.events:
            s.handle(ev)
        }
    }
}

func (s *Service) WaitStarted(ctx context.Context) error {
    select {
    case <-s.started:
        return nil
    case <-s.stopped:
        return errors.New("service stopped before starting")
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (s *Service) Stop(ctx context.Context) error {
    close(s.stop)
    select {
    case <-s.stopped:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Three handshakes in one struct:

- `WaitStarted` — block until the service has finished init.
- `Stop` — request shutdown and block until cleanup completes.
- `<-s.stopped` (also exposed by `WaitStarted`) — catch the case where init failed and the goroutine returned without ever signalling started.

This is a complete lifecycle handshake. You can drop it into any service.

### Fan-out / fan-in with handshake

```go
func ProcessAll(ctx context.Context, items []Item) ([]Result, error) {
    results := make(chan Result, len(items))
    g, ctx := errgroup.WithContext(ctx)
    for _, it := range items {
        it := it
        g.Go(func() error {
            r, err := process(ctx, it)
            if err != nil {
                return err
            }
            select {
            case results <- r:
                return nil
            case <-ctx.Done():
                return ctx.Err()
            }
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    close(results)
    var out []Result
    for r := range results {
        out = append(out, r)
    }
    return out, nil
}
```

The `errgroup.WithContext` is itself a handshake: `Wait()` returns only after every goroutine has finished. The result channel is buffered so individual workers don't block on each other; the context cancellation cascades to all workers if any one returns an error.

---

## Mental Models

### Channels are wires; handshakes are conversations

A wire is the medium; a conversation is the protocol. `chan struct{}` is a wire; "close it when you're ready" is a conversation. Two wires plus rules ("close A when ready, then I close B when stopped") give you a multi-step conversation.

### `chan chan T` is "let me give you a private line"

A `chan chan T` is the way one goroutine hands another a private direct line. "I will give you a channel. Send your reply on it. I will read from it." Once both have the channel, they can communicate without any intermediary.

### Rendezvous is "both of us at the same point in time"

Sender blocks until receiver arrives. Receiver blocks until sender arrives. The send and the receive happen simultaneously. Use this when you need provable simultaneity — for example, a value handoff where you do not want the sender to proceed until the receiver has it.

---

## Pros & Cons

### Pros

- **Composable.** `select`, `context.Context`, `errgroup` all compose with channel handshakes.
- **Visible protocol.** The channel types and the `select` statements document the protocol.
- **No lock discipline.** No mutex to forget; no `cond.Wait` outside a `for`.
- **Cancellable.** Every blocking op can be guarded by `<-ctx.Done()`.

### Cons

- **Verbose.** A full lifecycle handshake is 30+ lines of boilerplate.
- **Performance overhead.** Per-request channel allocation costs more than mutex ops at very high QPS.
- **Easy to leak goroutines.** A goroutine waiting on a channel that no one will close stays parked forever.
- **`chan chan T` has a learning curve.** Junior readers stumble on the syntax.

The trade is usually worth it. The cons are real but addressable; the pros are structural.

---

## Use Cases

### A goroutine that owns mutable state

State that is mutated by one goroutine only, read via request/ack from many. Replaces a `sync.Mutex` around the data.

### A worker pool with per-worker queuing

`chan chan T` for the dispatch, with each worker having its own bounded input. Good when workers have different costs (e.g., per-worker rate limits).

### Pipelines

Stages connected by channels, with handshakes for backpressure between stages. Each stage's input channel acts as both the data conduit and the backpressure signal.

### State machines

The state-machine goroutine owns the state. Inputs arrive on a channel. Each event triggers a transition. State queries arrive as request structs with reply channels.

---

## Coding Patterns

### Hide the channels behind a method

```go
func (s *Service) Get(ctx context.Context, k string) (string, error) {
    reply := make(chan string, 1)
    select {
    case s.ops <- Op{Kind: "get", Key: k, Reply: reply}:
    case <-ctx.Done():
        return "", ctx.Err()
    }
    select {
    case v := <-reply:
        return v, nil
    case <-ctx.Done():
        return "", ctx.Err()
    }
}
```

Callers do not see the channel; they call `Get`. The handshake is an implementation detail.

### Single owner per channel

```go
type Service struct {
    in   chan Op     // closed by Stop
    quit chan struct{} // closed by Stop
    done chan struct{} // closed by Run on exit
}
```

Stop owns `in` and `quit`. Run owns `done`. Document at the type level.

### Always use `select` with a default for non-blocking sends

```go
select {
case s.events <- e:
default:
    // dropped event
    s.dropped.Inc()
}
```

When you have a busy channel and you do not want to block the producer, give it an escape hatch.

---

## Common Mistakes

### Mistake 1: Holding a mutex across a channel send

```go
s.mu.Lock()
defer s.mu.Unlock()
s.out <- v // can block forever if downstream is also waiting on s.mu
```

Release the lock before the send, or restructure so the channel ops don't happen under the lock.

### Mistake 2: Forgetting to read the reply

```go
ops <- Op{Reply: make(chan string, 1)} // reply is allocated but never read
```

The reply channel is garbage-collected; no harm done if it's buffered. If unbuffered, the worker blocks forever.

### Mistake 3: Same channel for two protocols

```go
// "stop" channel doubles as "drained" channel
close(stop) // does this mean "please stop" or "I have stopped"?
```

One channel, one meaning. If you need both signals, you need both channels.

### Mistake 4: Buffering a channel just to avoid debugging a deadlock

A buffered channel masks the deadlock — the producer doesn't block on send, but the consumer is still missing. Fix the missing receive, don't paper over it with a buffer.

---

## Tricky Points

### Why does `<-pool` block until a worker advertises?

`pool` is unbuffered (or empty). `<-pool` reads from it; if no worker has yet sent, the read blocks. When a worker sends its inner channel on `pool`, the dispatcher's read completes. That is the dispatcher's proof that *a worker is now idle and ready*.

### How does the dispatcher know which worker to pick?

It does not — it picks whichever worker sent first. Fairness is FIFO by the order workers reached `pool <- in`. If you need explicit policy (priority, sticky), build it into the worker's advertisement (e.g., `pool <- workerHandle{ch: in, priority: 5}`).

### Why is `nil` channel useful in `select`?

A `nil` channel never sends or receives. In a `select`, the case with the nil channel is effectively disabled. You can dynamically enable/disable cases by setting the channel to `nil` or to a real channel:

```go
var sendOut chan<- int
if hasData {
    sendOut = q.out
}
select {
case sendOut <- next:
    // ...
case <-q.quit:
    return
}
```

When `hasData` is false, `sendOut` is nil and the send case is dead. When true, the case becomes live.

---

## Self-Assessment Checklist

You are ready for [Senior](senior.md) when you can:

- [ ] Implement a worker pool with `chan chan Job` dispatch from scratch.
- [ ] Identify a rendezvous in code and explain why it is unbuffered.
- [ ] Decide between `sync.Cond` and channels for a given problem, with justification.
- [ ] Implement a request/ack loop with context cancellation in both directions.
- [ ] Use a `nil` channel in a `select` to disable a case dynamically.
- [ ] Wrap a service's channels behind methods so callers never see them.

---

## Summary

Middle-level handshakes are about composition.

- **Bidirectional handshakes** carry both a request and a reply on dedicated channels.
- **`chan chan T`** lets idle workers self-register on a dispatch channel; the dispatcher's read is the worker's "I am idle" acknowledgement.
- **Rendezvous** uses an unbuffered channel for provable simultaneity of send and receive.
- **Request/ack loops** create strict backpressure: the producer holds at most one item ahead of the consumer.
- **`sync.Cond`** still has a place, but channels usually win for application-level coordination.
- **Context cancellation** must be respected in every blocking handshake.

These are the patterns you reach for when one goroutine owns state and another needs to ask it questions. Master them and most service-internal coordination problems become two-paragraph designs.

---

## Further Reading

- Pike, R. *Advanced Go Concurrency Patterns* (Google I/O 2013): https://talks.golang.org/2013/advconc.slide
- Pike, R. *Concurrency Is Not Parallelism*: https://blog.golang.org/waza-talk
- Cox-Buday, K. *Concurrency in Go* (O'Reilly), chapters 3–4.
- Go standard library: `database/sql.DB.Close` source — a real-world lifecycle handshake.
- [Junior](junior.md) — the building blocks.
- [Senior](senior.md) — supervisors, graceful shutdown, N-way barriers.
- [Professional](professional.md) — production-grade examples and observability.
