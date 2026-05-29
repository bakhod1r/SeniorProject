# CSP — Middle Level

> **Topic:** [CSP](README.md)
> **Focus:** Go idioms, select, close semantics, pipelines, context

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

At the junior level, CSP is mostly a vocabulary: processes, channels, send,
receive. At the middle level, CSP becomes a construction kit. You stop asking
"how do I send a value to another goroutine?" and you start asking "how do I
shape this dataflow so that cancellation propagates cleanly, no goroutine
leaks, no channel is closed twice, and back-pressure flows the right
direction?"

Go is the most popular practical incarnation of CSP, so this page is centered
on Go idioms. We will look at how `select` actually behaves, what closing a
channel really means, how pipelines hold together, why `context.Context` and
channels are the same shape of idea, and which mistakes are easy to make
without realizing it.

The mental shift is this: at the middle level, you stop thinking about
*individual* channels and start thinking about *graphs* of channels.
A pipeline is a chain. A fan-out is a star. A fan-in is a funnel. A worker
pool is a fan-out followed by a fan-in. Cancellation is a signal that
propagates against the direction of data flow. Once you can draw the graph,
the code almost writes itself.

We will also be honest about the parts that bite. `close` is broadcast, but
only the owner is allowed to close. `nil` channels block forever and can be
used as a switch inside `select`. `default` turns a blocking `select` into a
non-blocking probe. A buffered channel is *not* a queue you can rely on for
ordering across producers. Goroutine leaks are silent until your process runs
out of memory or stops shutting down cleanly.

By the end of this page you should be able to design a three-stage pipeline
with cancellation, build a worker pool that drains cleanly, and explain to a
colleague why `close(done)` is a broadcast and why `for v := range ch` ends
when the channel is closed and drained.

---

## Prerequisites

Before reading this page you should be comfortable with:

- **Junior-level CSP** — what a channel is, what send and receive do, the
  difference between buffered and unbuffered channels, what a goroutine is.
- **Basic Go syntax** — `go f()`, `chan T`, `make(chan T, n)`, `for ... range`,
  function values, closures.
- **Blocking semantics** — sends block when there is no receiver (or the
  buffer is full), receives block when there is no sender (or the buffer is
  empty).
- **Synchronization basics** — what a happens-before relationship is, why
  shared mutable state without coordination is broken.
- **Error handling in Go** — multiple return values, the `error` interface,
  `defer`.

If any of that is shaky, read the junior page on CSP first, then come back.

---

## Glossary

| Term | Meaning |
|------|---------|
| `select` | Control structure that waits on multiple channel operations and proceeds with one that is ready; if multiple are ready, one is chosen pseudo-randomly. |
| `default` | A case inside `select` that fires when no other case is ready; turns the `select` into a non-blocking probe. |
| Directional channel | A channel type restricted to one direction: `chan<- T` is send-only, `<-chan T` is receive-only. Used to make APIs explicit. |
| Range-over-channel | `for v := range ch` reads values until `ch` is closed and drained; the loop then exits cleanly. |
| `context.Context` | Standard library value that carries a deadline, cancellation signal, and request-scoped values across API boundaries. |
| Done channel | An idiomatic `chan struct{}` (or `ctx.Done()`) used as a one-way broadcast: closing it tells every reader to stop. |
| `WaitGroup` | A counter-based barrier (`sync.WaitGroup`) used to wait until a known set of goroutines has finished; not a substitute for cancellation. |

---

## Core Concepts

### Go-Idiomatic Patterns

Go's standard playbook for concurrency reuses a small set of shapes. Once you
recognize them, most concurrent code looks familiar.

**Fan-out.** One producer feeds many workers. The producer sends jobs into a
single channel; multiple goroutines receive from that channel. The runtime
load-balances naturally because each receive consumes one value.

**Fan-in.** Many producers feed one consumer. Each producer writes into its
own channel (or all into a shared one); a merger goroutine reads from all and
forwards the values to a single output channel.

**Pipeline.** A series of stages connected by channels. Each stage receives
from an input channel, does some work, and sends to an output channel. The
last stage's output is the result.

**Worker pool.** Fan-out plus fan-in plus a fixed number of workers. The pool
caps concurrency, which matters when work consumes expensive resources like
database connections or file handles.

**Done channel.** A channel used purely as a signal. Closing it tells every
reader that they should stop. The values sent over the channel do not matter,
which is why `chan struct{}` is the idiomatic type.

### `select` Deep Dive

`select` is the heart of Go's CSP. It waits on multiple channel operations
and proceeds with whichever is ready first.

```go
select {
case v := <-in:
    handle(v)
case out <- result:
    // sent
case <-time.After(time.Second):
    // timeout
default:
    // nothing ready right now
}
```

Key facts:

- **All cases are evaluated** before `select` starts waiting. Sub-expressions
  on the right-hand side of `<-` and the value sent on a send case are
  computed up front.
- **If multiple cases are ready**, one is chosen pseudo-randomly. This is
  important for fairness: you cannot rely on case order for priority.
- **`default` runs immediately** if no other case is ready. This turns a
  blocking `select` into a non-blocking probe.
- **A `nil` channel case is never ready.** This is useful: you can disable a
  case dynamically by setting the channel variable to `nil`.
- **Send cases** are part of `select` too. `case out <- v:` is ready when
  some goroutine is receiving from `out` (or the buffer has space).

The pseudo-random choice has consequences. If you want priority semantics
(for example, "always check the cancellation channel first"), you have to
build it explicitly with a nested `select`:

```go
select {
case <-ctx.Done():
    return ctx.Err()
default:
}
select {
case <-ctx.Done():
    return ctx.Err()
case v := <-in:
    process(v)
}
```

### Closing Semantics

Closing a channel is the most subtle part of Go's CSP, and the source of
most production bugs.

What `close(ch)` does:

1. Marks the channel as closed.
2. **Every current and future receive returns immediately** with the zero
   value and `ok == false`. This is the broadcast property: one close signals
   every reader at once.
3. **Every future send panics.** Sending on a closed channel is a runtime
   error.
4. **Closing an already-closed channel panics.** Double close is a runtime
   error.

The standard rule of thumb: **only the sender should close a channel, and
only when no further sends will happen.** A receiver that closes a channel is
playing with fire because senders cannot tell that the channel is closed
without crashing.

When ownership is fan-in (many producers, one consumer), no single producer
owns the channel. The usual solutions are either to wrap the producers in a
`sync.WaitGroup` and have one goroutine close the channel after `Wait()`, or
to use a separate "done" channel to signal stop and close *that* instead.

Range-over-channel is the natural reader for closed channels:

```go
for v := range ch {
    // runs until ch is closed AND drained
}
```

The loop reads until the channel is closed and all buffered values have been
consumed; then it exits cleanly. This is the cleanest way to consume a
pipeline stage.

### Directional Channel Types

Go lets you restrict a channel to one direction in a type:

- `chan T` — both directions.
- `chan<- T` — send only.
- `<-chan T` — receive only.

Functions that produce data should return `<-chan T`. Functions that consume
data should accept `<-chan T`. Functions that take an output channel should
accept `chan<- T`. The compiler then enforces that producers do not
accidentally read, and consumers do not accidentally write or close.

```go
func produce() <-chan int { /* ... */ }
func consume(in <-chan int) { /* ... */ }
func forward(in <-chan int, out chan<- int) { /* ... */ }
```

This is a small habit with a big payoff: a producer that returns `<-chan T`
*cannot be closed by the caller*. Ownership is encoded in the type.

### `context.Context` and Channels

`context.Context` is, fundamentally, a channel-based cancellation primitive
wrapped in an interface:

```go
type Context interface {
    Deadline() (time.Time, bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

`ctx.Done()` returns a receive-only channel that is closed when the context
is canceled. Notice the type: `<-chan struct{}`. You cannot send on it, you
cannot close it directly. You wait on it inside `select`:

```go
select {
case <-ctx.Done():
    return ctx.Err()
case v := <-in:
    process(v)
}
```

This is the idiom. Every long-running operation in Go should accept a
`context.Context`, and every blocking operation inside should `select` on
`ctx.Done()` alongside its real work. Cancellation propagation in pipelines
is just this idiom applied at every stage.

### Common Patterns

**Ticker** — periodic events:

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for {
    select {
    case <-t.C:
        tick()
    case <-ctx.Done():
        return
    }
}
```

**Throttle** — limit rate by gating on a ticker:

```go
limit := time.Tick(100 * time.Millisecond) // one slot per 100ms
for job := range jobs {
    <-limit
    handle(job)
}
```

**Semaphore-as-channel** — limit concurrency:

```go
sem := make(chan struct{}, 10) // max 10 concurrent
for _, job := range jobs {
    sem <- struct{}{}
    go func(j Job) {
        defer func() { <-sem }()
        handle(j)
    }(job)
}
```

**Debounce** — collapse a burst into a single event:

```go
var pending bool
var timer *time.Timer
for {
    select {
    case <-events:
        if !pending {
            pending = true
            timer = time.NewTimer(100 * time.Millisecond)
        }
    case <-timer.C:
        flush()
        pending = false
    }
}
```

### Buffered Channels as Bounded Queues

A buffered channel of capacity `n` acts like a bounded FIFO queue: sends fill
the buffer until it is full, then block; receives drain the buffer until it
is empty, then block.

This makes buffered channels useful as back-pressure control. A pipeline
stage with a small buffer can absorb bursts but will eventually slow down the
producer when downstream is slow. The buffer size is a design choice: too
small and you lose throughput, too large and you hide back-pressure and
inflate latency.

### Pipeline Stages with Cancellation

A pipeline stage is a function:

```go
func stage(ctx context.Context, in <-chan In) <-chan Out
```

Each stage launches a goroutine that loops:

1. Receive from `in`.
2. Compute output.
3. Send to `out`.
4. On `ctx.Done()`, exit.

The trick is that *both* the receive and the send must respect cancellation.
Otherwise the stage can leak: blocked on a send to a downstream that has
already exited.

### `sync.WaitGroup` vs Channel Close

`WaitGroup` is a barrier: it waits until a counter reaches zero. It does not
signal "stop"; it signals "everyone who was working is done."

Channel close is a broadcast signal: it tells every receiver "no more values
are coming."

You usually need both. `WaitGroup` for "wait for all workers to exit," and a
done channel (or `context.Context`) for "tell them to stop." A common
pattern is to launch N workers reading from `jobs`, close `jobs` when no more
jobs will be sent, wait for the workers with `wg.Wait()`, then close the
output channel.

### Channel of Channel

A channel of channels (`chan chan T`) is a routing primitive. A worker that
wants to receive work sends its own response channel into a shared request
channel; the dispatcher reads the request, picks work for that worker, and
sends back. This gives explicit back-pressure: workers pull, dispatchers do
not push.

### Common Bugs

- **Goroutine leak** — a goroutine blocked forever on a send or receive
  because no one will ever read or write. The goroutine sits in memory until
  the process exits.
- **Double close** — `close(ch)` called twice panics.
- **Send on closed channel** — panics. Closing while another goroutine is
  still sending is a race for crashes.
- **Close from non-owner** — a receiver closing the channel will eventually
  panic a sender.
- **Forgetting `default`** — a `select` without a `default` blocks
  indefinitely if none of the cases are ready.
- **Not checking `ok`** — `v, ok := <-ch` distinguishes "value received"
  from "channel closed, zero value." Forgetting `ok` makes "channel closed"
  look like "received zero."

---

## Real-World Analogies

| Pattern | Analogy |
|---------|---------|
| Fan-out | A dispatcher handing tickets to several clerks; each clerk grabs the next ticket. |
| Fan-in | Several rivers merging into a single delta. |
| Pipeline | An assembly line; each station does one step and passes the part on. |
| Done channel | A factory whistle: when it blows, everyone stops, regardless of where they were. |
| Closing a channel | A "closed" sign on the back door of a kitchen: the next cook to look out knows no more orders are coming. |
| Buffered channel | A short conveyor belt with a fixed number of slots between two workers. |
| `nil` channel | A locked door; nobody can enter or leave through it. |
| `select` with `default` | Glancing at four doors at once; if all are locked, walk away instead of waiting. |
| Semaphore-as-channel | A small bowl of tokens; you have to grab one to enter the room and drop it on the way out. |
| Worker pool | A taxi rank with a fixed number of cars; passengers wait in a queue, drivers take the next one when free. |

---

## Mental Models

**Channels are pipes with capacity.** Unbuffered channels are zero-capacity
pipes: every send must hand off directly to a receive. Buffered channels are
short hoses: sends fill the hose; when full, the sender waits.

**Closing is broadcast, not destruction.** A closed channel is still a
channel; receives keep returning the zero value forever. Think of close as
"the news," not "the obituary."

**`select` is a single decision point.** It evaluates all candidate
operations *at the same instant*. There is no ordering; if multiple are
ready, the choice is fair. To get priority, you nest `select`s.

**Goroutines are cheap, but not free.** Each goroutine that is blocked on a
channel is sitting in scheduler memory. Hundreds of thousands are fine;
hundreds of thousands that leak per request are not.

**Cancellation flows against data flow.** Data goes downstream through the
pipeline. Cancellation goes upstream and outward through `ctx.Done()`. Every
stage listens for both.

**Ownership decides who closes.** The goroutine that creates a channel and
sends to it is its owner. The owner closes it when done. Receivers do not
close. This rule alone prevents most bugs.

**Buffered channels hide back-pressure.** A big buffer feels nice because it
absorbs spikes, but it hides the moment when consumers cannot keep up. Sized
small, the back-pressure is honest.

---

## Code Examples

### Example 1: Three-Stage Pipeline With Graceful Cancellation

A classic pipeline: generate numbers, square them, sum them. Each stage is a
goroutine; each stage respects `ctx.Done()`.

```go
package main

import (
    "context"
    "fmt"
    "time"
)

// gen sends 1..n into the output channel.
func gen(ctx context.Context, n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 1; i <= n; i++ {
            select {
            case out <- i:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

// sq reads from in, sends squares to out.
func sq(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case out <- v * v:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

// sum reads from in until it closes, then returns the total.
func sum(ctx context.Context, in <-chan int) (int, error) {
    total := 0
    for {
        select {
        case v, ok := <-in:
            if !ok {
                return total, nil
            }
            total += v
        case <-ctx.Done():
            return total, ctx.Err()
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()

    numbers := gen(ctx, 1000)
    squares := sq(ctx, numbers)
    result, err := sum(ctx, squares)

    fmt.Printf("sum=%d err=%v\n", result, err)
}
```

Three observations. First, every send is guarded by a `select` with
`ctx.Done()`, so no stage can block forever on a downstream that has already
quit. Second, every stage closes its own output channel when it returns,
which lets the next stage's `range` exit cleanly. Third, `sum` checks `ok` to
distinguish a closed-and-drained input (return total) from a context
cancellation (return error).

### Example 2: Worker Pool That Drains In-Flight Work

A worker pool processes a stream of jobs with bounded concurrency. On
shutdown, in-flight jobs finish; no new jobs are picked up.

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Job struct {
    ID int
}

type Result struct {
    JobID int
    Value string
}

func worker(ctx context.Context, id int, jobs <-chan Job, results chan<- Result, wg *sync.WaitGroup) {
    defer wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case job, ok := <-jobs:
            if !ok {
                return
            }
            // Simulate work.
            time.Sleep(20 * time.Millisecond)
            select {
            case results <- Result{JobID: job.ID, Value: fmt.Sprintf("w%d-done", id)}:
            case <-ctx.Done():
                return
            }
        }
    }
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    jobs := make(chan Job)
    results := make(chan Result)

    var wg sync.WaitGroup
    const workers = 4
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go worker(ctx, i, jobs, results, &wg)
    }

    // Producer: send 20 jobs, then close.
    go func() {
        defer close(jobs)
        for i := 0; i < 20; i++ {
            select {
            case jobs <- Job{ID: i}:
            case <-ctx.Done():
                return
            }
        }
    }()

    // Closer: when all workers exit, close results so the collector can stop.
    go func() {
        wg.Wait()
        close(results)
    }()

    // Collector: print until results closes.
    go func() {
        time.Sleep(100 * time.Millisecond)
        cancel() // simulate shutdown signal
    }()

    for r := range results {
        fmt.Printf("got %+v\n", r)
    }
    fmt.Println("done")
}
```

The shape here is the canonical one: producer owns `jobs` and closes it;
workers own their own send to `results` but no one worker owns the channel,
so a separate goroutine waits on the `WaitGroup` and then closes `results`.
The collector ranges over `results` and exits when the channel closes. The
cancel from outside flips `ctx.Done()`, which every blocking operation in
every goroutine is listening for.

### Example 3: Rate-Limited Request Stream (Token Bucket via Channel)

A token-bucket limiter: a fixed number of tokens regenerate at a rate.
Requests wait for a token before proceeding.

```go
package main

import (
    "context"
    "fmt"
    "time"
)

type Limiter struct {
    tokens chan struct{}
    quit   chan struct{}
}

func NewLimiter(burst int, refill time.Duration) *Limiter {
    l := &Limiter{
        tokens: make(chan struct{}, burst),
        quit:   make(chan struct{}),
    }
    // Pre-fill the bucket.
    for i := 0; i < burst; i++ {
        l.tokens <- struct{}{}
    }
    // Refill goroutine.
    go func() {
        t := time.NewTicker(refill)
        defer t.Stop()
        for {
            select {
            case <-t.C:
                select {
                case l.tokens <- struct{}{}:
                default:
                    // bucket full, drop the token
                }
            case <-l.quit:
                return
            }
        }
    }()
    return l
}

func (l *Limiter) Wait(ctx context.Context) error {
    select {
    case <-l.tokens:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (l *Limiter) Close() {
    close(l.quit)
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
    defer cancel()

    l := NewLimiter(3, 100*time.Millisecond)
    defer l.Close()

    for i := 0; i < 10; i++ {
        if err := l.Wait(ctx); err != nil {
            fmt.Printf("req %d aborted: %v\n", i, err)
            return
        }
        fmt.Printf("req %d at %s\n", i, time.Now().Format("15:04:05.000"))
    }
}
```

A buffered channel of capacity `burst` is the bucket; each element is a
token. The refill goroutine tries to add one token per tick but uses a
non-blocking send (`select` with `default`) so it does not block when the
bucket is full. The `Wait` method either grabs a token or honors
cancellation.

---

## Pros & Cons

**Pros of Go-style CSP at the middle level**

- Patterns are composable: pipelines, fan-out, fan-in are all the same shapes
  combined differently.
- `select` plus `context.Context` gives you a clean, uniform cancellation
  story.
- Directional channels make APIs honest at the type level.
- `for ... range` plus `close` gives clean stream termination.
- Goroutines are cheap enough that the right design is usually the obvious
  one.

**Cons**

- Easy to leak goroutines if you forget to honor cancellation.
- Closing rules are subtle: double close and send-on-closed both panic.
- Pseudo-random `select` makes priority surprisingly hard.
- Buffered channels hide back-pressure and complicate latency reasoning.
- "Owner closes" is a convention, not enforced; code review must catch it.
- Pipelines are simple in shape but tricky in shutdown: every stage must
  exit cleanly.

---

## Use Cases

- **Streaming data processing** — pipelines of decode, transform, encode.
- **Worker pools** — capped concurrency for outbound HTTP, DB writes, image
  processing.
- **Rate limiting and throttling** — token buckets, leaky buckets.
- **Coordinated shutdown** — `context.Context` across many goroutines.
- **Fan-out then fan-in aggregation** — parallel queries with combined
  results.
- **Background jobs with cancellation** — long-running goroutines that must
  stop on signal.
- **Pub/sub style broadcast** — close a "version" channel to wake all
  subscribers.

---

## Coding Patterns

- **Owner closes.** The function that creates a channel and writes to it
  closes it. Receivers never close.
- **Range to consume.** `for v := range ch` is the cleanest consumer; it
  ends naturally when the producer closes.
- **`select` with `ctx.Done()` on every blocking op.** This is the single
  habit that prevents goroutine leaks.
- **Return `<-chan T` from producers.** Directional types make ownership
  obvious.
- **Use `chan struct{}` for signaling.** Zero-size value makes intent clear.
- **`WaitGroup` + close pattern.** Workers `wg.Done()`; a separate goroutine
  does `wg.Wait(); close(out)`.
- **Bounded buffer for bounded back-pressure.** Choose buffer size based on
  how much you can absorb before slowing producers.
- **Cancellation propagates through `ctx`.** Pass `ctx` as the first
  argument to any function that does I/O or blocks.

---

## Clean Code

- Name channels by content: `jobs`, `results`, `errs`, not `ch1`, `ch2`.
- Name done channels `done` or `quit`; prefer `ctx.Done()` if possible.
- Keep the goroutine that owns a channel close to the `make`; a reader
  should not have to hunt for who closes.
- One channel per direction of dataflow; do not multiplex unrelated things
  through one channel.
- Document the invariants in a comment above the channel declaration: who
  sends, who receives, who closes, when.
- Keep `select` blocks short; if a case body is long, extract it into a
  function.
- Avoid `time.Sleep` inside goroutines for coordination; it is a code smell.
  Use `time.After` inside `select`, or `time.Ticker`.
- Prefer `context.WithCancel`, `context.WithTimeout`, `context.WithDeadline`
  over hand-rolled done channels in API boundaries.

---

## Best Practices

1. **Always pass `context.Context` as the first parameter** to functions that
   block, do I/O, or spawn goroutines.
2. **Always honor `ctx.Done()`** on every blocking channel op inside a
   long-running goroutine.
3. **Owner closes; receivers do not.** Make this a code-review rule.
4. **Use directional types in signatures.** `<-chan T` for return, `chan<- T`
   for output parameters.
5. **Close once.** Use `sync.Once` if there is even a chance of double-close.
6. **Size buffers deliberately.** "Big buffer to avoid blocking" is almost
   always wrong.
7. **Pair workers with `WaitGroup`** and have a separate goroutine close the
   results channel after `Wait`.
8. **Avoid unbounded fan-out.** Use a worker pool to cap concurrency.
9. **Use `select` with `default` for non-blocking probes**, never for spin
   loops.
10. **Test cancellation paths.** Easy to forget: write a test that cancels
    mid-flight and checks no goroutine remains.

---

## Edge Cases & Pitfalls

- **Send on closed channel panics.** If you cannot prove no sender remains,
  do not close.
- **Receive on closed channel returns zero value immediately, forever.** Use
  the `ok` form to detect close.
- **`select` with all `nil` channels and no `default` blocks forever.** This
  is sometimes used intentionally as "park this goroutine," but more often it
  is a bug.
- **`select` with `default`** never blocks; using it inside a loop with no
  sleep is a spin loop and burns a CPU.
- **A buffered channel with a slow consumer** does not signal back-pressure
  until the buffer is full. Latency in the buffer is invisible.
- **Closing the wrong end of a pipeline** breaks the chain. Only the upstream
  end of a stage closes; downstream observes.
- **Range loop with an unclosed channel** never exits.
- **Multiple producers, single channel: who closes?** Either one of them
  with a `WaitGroup`-driven closer, or none of them and use a done channel.
- **`time.After` in a loop allocates a new timer every iteration**; prefer
  `time.NewTimer` and `Reset`, or `time.NewTicker`.
- **`context.WithTimeout` requires `cancel()`** to release resources;
  `defer cancel()` is a habit, not an option.

---

## Common Mistakes

- Forgetting `default` and assuming `select` is non-blocking.
- Forgetting `ok` in `v, ok := <-ch` and treating zero values as data.
- Closing a channel from the receiver side because "it felt natural."
- Spawning a goroutine that never receives a stop signal.
- Using a `WaitGroup` to mean "stop" instead of "wait for done."
- Calling `close` inside `select` on a possibly-already-closed channel.
- Using a buffered channel of size 1 as a mutex; technically works but is
  confusing. Use `sync.Mutex`.
- Spinning on a `select` with `default` because you forgot you needed to
  actually wait on something.
- Returning a `chan T` (bidirectional) from a producer function and letting
  the caller close it.
- Using `time.Sleep` to "wait for the goroutine to finish" instead of
  proper synchronization.

---

## Tricky Points

- **`select` is fair, not ordered.** If you want priority, you nest
  `select`s.
- **`nil` channels are a feature.** Setting a channel variable to `nil`
  disables that `select` case until you set it back.
- **Closing a channel is a happens-before edge.** All sends that happened
  before close are visible to the receiver after close.
- **A `range` loop over a channel and a `select` with `ctx.Done()` are not
  equivalent.** Range will not exit on cancellation unless the upstream
  closes the channel. Use `select` for cancel-aware consumers.
- **`time.Tick` leaks** if its channel is never garbage-collected; prefer
  `time.NewTicker` with `Stop`.
- **`context.Background()` vs `context.TODO()`** — same behavior, different
  intent. `TODO` says "I will fix this later."
- **Buffered channel close semantics:** the buffered values are still
  receivable after close. The channel becomes "closed" but the buffer drains
  normally.

---

## Test Yourself

1. What happens if you send on a closed channel?
2. What happens if you close an already-closed channel?
3. What does `v, ok := <-ch` return when the channel is closed and drained?
4. What does `select` do when multiple cases are ready?
5. Why is it useful to set a channel variable to `nil` inside a `select`?
6. Who should close a channel in a fan-in pattern?
7. What does `for v := range ch` do when the channel is closed?
8. How do you build a priority `select` (always check `ctx.Done()` first)?
9. What is the difference between `sync.WaitGroup` and a done channel?
10. Why is a giant buffered channel often a bad idea?
11. What does `time.After` allocate, and why might that matter in a hot
    loop?
12. How does cancellation propagate through a pipeline?

---

## Tricky Questions

1. *You have a fan-in with three producers writing to one channel. Who
   closes it?* No single producer can know when "all" are done. Use a
   `WaitGroup`: each producer calls `wg.Done()` when finished; a separate
   goroutine does `wg.Wait(); close(ch)`.
2. *A worker pool keeps running after shutdown. Why?* Likely a worker is
   blocked on a send to `results` and nobody is reading, so the worker never
   reaches its `select` on `ctx.Done()`. Fix: guard the send with `select`
   on `ctx.Done()`.
3. *A `select` with `ctx.Done()` and a receive sometimes processes a value
   after cancellation. Is that a bug?* Not by itself: `select` is fair, and
   if both cases are ready, either can win. To enforce "cancel always
   wins," nest a non-blocking `select` on `ctx.Done()` first.
4. *Range loop never exits.* The upstream producer never closed the channel.
   Check ownership.
5. *Why is `chan struct{}` better than `chan bool` for signaling?* `struct{}`
   is zero-sized; it documents that the value carries no information, only
   the *fact* of the send (or the close).
6. *Can you reopen a closed channel?* No. Make a new one.
7. *What does `defer close(ch)` mean inside a producer goroutine?* It
   guarantees the channel is closed when the goroutine returns, which is
   important if the producer might return early on context cancel.
8. *A buffered channel of size 1: how is it different from a mutex?* It
   gives you an explicit token of "I own this." But for mutual exclusion of
   a critical section, `sync.Mutex` is clearer and faster.

---

## Cheat Sheet

```
Channel state            Receive returns                Send does
---------------------    ---------------------------    --------------------
open, empty              blocks                         blocks (unbuffered)
                                                        ok if buffer not full
open, has values         value, true                    ok if buffer not full
closed, has values       value, true (drain buffer)     PANIC
closed, drained          zero, false (immediately)      PANIC

select rules
- All cases evaluated up front.
- If multiple ready: pseudo-random pick.
- `default` fires when none ready (non-blocking).
- nil channel case: never ready.

Idioms
- producer returns <-chan T
- consumer takes <-chan T
- output param: chan<- T
- signal channel: chan struct{}
- cancellation: pass context.Context, select on ctx.Done()

Ownership
- the goroutine that writes to a channel closes it
- receivers never close
- fan-in: WaitGroup + separate closer goroutine

Patterns
- pipeline: stage(ctx, in) <-chan Out
- fan-out: N goroutines reading from one channel
- fan-in: merge N channels into one
- worker pool: bounded fan-out then fan-in
- semaphore: buffered channel of struct{}
- token bucket: buffered channel, refill goroutine

Don'ts
- do not close from receiver
- do not double-close
- do not send on closed
- do not range without close
- do not skip ctx.Done() in long-running goroutines
- do not size buffer for "performance" without measuring
```

---

## Summary

At the middle level, CSP in Go is about composing channels into graphs that
have a clear shape: pipelines, fan-out, fan-in, worker pools. `select`
combines channels into single decision points; `close` broadcasts to all
receivers; `context.Context` is the standard way to propagate cancellation
through the graph.

The hard rules are: owner closes, receivers do not; honor `ctx.Done()` on
every blocking op; use directional types in signatures; use `WaitGroup` to
wait, not to stop; size buffers small to make back-pressure honest.

The hardest mistakes are the silent ones: goroutine leaks. A goroutine
blocked on a send or receive that will never happen does not crash; it just
sits there. The discipline of `select`-with-`ctx.Done()` everywhere, plus
careful ownership of channel close, eliminates almost all of them.

Master this and you can build streaming systems, worker pools, rate
limiters, and shutdown-safe long-running services with confidence.

---

## What You Can Build

- A streaming ETL pipeline that reads, transforms, and writes records with
  cancellation.
- A bounded-concurrency crawler that respects robots.txt and a rate limit.
- A background job processor with graceful shutdown.
- A pub/sub bus with topic-based fan-out.
- A token-bucket and leaky-bucket rate limiter.
- A retry-with-backoff layer for outbound HTTP calls.
- A request batcher that collects N items or M milliseconds, whichever
  first.
- A health-check aggregator that fans out probes and fans in results.

---

## Further Reading

- Effective Go — Concurrency.
- The Go Memory Model.
- Sameer Ajmani, "Go Concurrency Patterns: Pipelines and cancellation."
- Bryan Mills, "Rethinking Classical Concurrency Patterns" (GopherCon 2018).
- Sameer Ajmani, "Go Concurrency Patterns" (Google I/O 2012).
- "Go Concurrency Patterns: Context."
- Dave Cheney, "Channel axioms" — short list, often quoted.

---

## Related Topics

- [CSP — Junior Level](junior.md)
- [Goroutines and the Scheduler](../../README.md)
- [Channels — Internals](../README.md)
- [Actor Model](../03-actors/README.md)
- [Context Cancellation Patterns](../../../../languages/golang/15-go-source-reading/04-context-source/README.md)
- [Worker Pools](../../README.md)

---

## Diagrams & Visual Aids

**Pipeline.**

```
producer ──> stage1 ──> stage2 ──> consumer
         ch1         ch2         ch3
```

Each arrow is a channel. Each box is a goroutine. Closing a channel
terminates the next stage's range loop.

**Fan-out.**

```
              ┌──> worker1 ──┐
producer ────┼──> worker2 ──┼──> results
              └──> worker3 ──┘
```

One source channel feeds N workers; their outputs converge.

**Fan-in.**

```
producer1 ──┐
producer2 ──┼──> merger ──> consumer
producer3 ──┘
```

The merger goroutine reads from all sources and forwards.

**Cancellation flow.**

```
ctx.Done() closes
     │
     ▼
   ┌───────┐    ┌───────┐    ┌───────┐
   │stage1 │ ──>│stage2 │ ──>│stage3 │
   └───────┘    └───────┘    └───────┘
     ▲            ▲            ▲
     └────────────┴────────────┘
        (each stage selects on ctx.Done())
```

Data flows forward; the cancellation signal is observed independently at
every stage.

**Select with default vs without.**

```
select {                       select {
case v := <-in:                case v := <-in:
    handle(v)                      handle(v)
case <-time.After(t):          case <-time.After(t):
    timeout()                      timeout()
default:                       }
    noop()                     // blocks until one fires
}
// returns immediately if
// no case ready
```

**Owner closes.**

```
   ┌── owner ──> ch ──> reader1
   │                ├──> reader2
   │                └──> reader3
   │
   └── close(ch)   (only the owner)
```

A single arrow into the channel; many arrows out. Only the in-arrow's owner
closes.

**Worker pool with WaitGroup-driven closer.**

```
producer ──> jobs ─┬─> worker1 ─┐
                   ├─> worker2 ─┼─> results ──> consumer
                   └─> worker3 ─┘
                       │
                  wg.Done() each
                       │
                  wg.Wait() in
                  closer goroutine
                       │
                  close(results)
```

This shape is the workhorse: producer closes `jobs`; workers exit when
`jobs` drains; closer waits and then closes `results`; consumer ranges over
`results` and exits.
