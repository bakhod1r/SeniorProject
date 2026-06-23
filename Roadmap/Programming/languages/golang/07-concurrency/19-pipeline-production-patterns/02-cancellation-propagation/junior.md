---
layout: default
title: Cancellation Propagation — Junior
parent: Cancellation Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/02-cancellation-propagation/junior/
---

# Cancellation Propagation — Junior Level

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
> Focus: "How do I stop a pipeline cleanly? What is a done channel? Why does `context.Context` show up everywhere?"

A Go pipeline is a chain of stages connected by channels. Each stage is one or more goroutines that read from an input channel, do some work, and write to an output channel. The pleasure of the pattern is that it composes naturally: producer to filter to consumer, each its own goroutine, communicating only through channels.

The pain of the pattern arrives the first time something needs to stop early. Maybe the user cancelled the request. Maybe a deadline expired. Maybe a downstream stage encountered an error and the upstream stages must stop producing. Maybe the whole program is shutting down.

If a stage does not know how to stop, it leaks. A leaked stage holds memory, holds the channels it was reading or writing, and on a slightly larger scale holds connections, files, and database transactions. One leaked pipeline per request is a slow but certain memory leak. One leaked pipeline per error path is a faster one.

**Cancellation propagation** is the contract that says: when one part of the pipeline decides to stop, every other part learns and stops too. There are two main mechanisms in Go for expressing this contract.

1. **The done channel.** A single channel, usually called `done`, that the orchestrator closes to broadcast "stop." Every stage selects on it and exits when it fires.
2. **`context.Context`.** The standard library's structured version of the done channel, with built-in support for deadlines, cancellation values, and child contexts.

In modern Go, `context.Context` is the answer almost every time. The done channel still appears in small examples and in internal pipelines that do not need timeouts or values. Both rest on the same primitive: a channel that closes to signal "everyone stop."

After reading this file you will:

- Know what cancellation propagation means and why a pipeline cannot work without it.
- Know how to use a done channel to stop a single stage.
- Know the basic `context.Context` API: `context.Background`, `context.WithCancel`, `ctx.Done`, `ctx.Err`.
- Understand the difference between sending cancellation upstream and downstream.
- Recognise the simplest leak: a goroutine selecting on input but not on cancel.
- Be able to write a producer-consumer pipeline that stops cleanly on `Ctrl-C`.

You do not need to know about `errgroup`, custom context implementations, propagation across RPC boundaries, or graceful shutdown protocols. Those come at middle, senior, and professional levels.

---

## Prerequisites

- **Required:** Comfort with goroutines and channels — what `chan T` is, how `<-ch` blocks, how `close(ch)` works, what `for v := range ch` does.
- **Required:** Familiarity with `select` statement on channels.
- **Required:** Go 1.18 or newer.
- **Helpful:** Awareness that channels can be closed exactly once and that receiving from a closed channel returns the zero value immediately.
- **Helpful:** Some exposure to `context.Context` from HTTP handlers (`r.Context()`).

If you can write a producer goroutine that sends into a channel and a consumer goroutine that ranges over it, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Cancellation** | The act of telling a goroutine to stop the work it is currently doing, as soon as it can, and exit. |
| **Cancellation propagation** | The mechanism by which a cancel signal reaches every goroutine that needs to stop. |
| **Done channel** | A channel — usually `chan struct{}` — that the controller closes to broadcast "stop." Stages select on it. |
| **`context.Context`** | The standard interface that carries cancellation, deadlines, and request-scoped values. Returned by `context.Background`, `context.WithCancel`, `context.WithTimeout`, `context.WithDeadline`, `context.WithValue`. |
| **`ctx.Done()`** | Returns a channel that is closed when the context is cancelled. The same role as a manual done channel. |
| **`ctx.Err()`** | Returns the reason the context was cancelled: `context.Canceled`, `context.DeadlineExceeded`, or `nil` if still live. |
| **Cancel function** | The `cancel func()` returned by `context.WithCancel` etc. Calling it triggers cancellation. Always called eventually via `defer`. |
| **Upstream** | Earlier stages of a pipeline; producers feeding into the current stage. |
| **Downstream** | Later stages of a pipeline; consumers reading from the current stage. |
| **Drain** | Reading the remaining values from a channel until it is closed, so that the sender is not blocked. |
| **Leak** | A goroutine that does not exit. A pipeline stage that ignores cancellation is a leak factory. |
| **Graceful shutdown** | Stopping the pipeline in a way that finishes in-flight work, closes resources, and does not corrupt state. |

---

## Core Concepts

### Why pipelines need cancellation at all

A function call has a natural exit: the function returns. The caller has the value; the frame is gone. Memory is freed. Nothing lingers.

A goroutine has no natural exit. The runtime started it, but the runtime cannot decide when it should stop — only the program logic knows when the work is done or no longer wanted. If the program logic does not encode "stop now," the goroutine runs forever, or more precisely until it blocks on something that never unblocks.

In a sequential program this is fine because every function eventually returns. In a concurrent program built around channels, the natural exit for many goroutines is "my input channel closed and I finished draining it." That works as long as the input channel does close. The moment the input is an infinite source (an HTTP stream, a tick source, a connection accept loop, a database cursor that paginates forever), the goroutine has no end.

Cancellation is the engineered exit. It is the signal "stop, even if your input is still flowing." Without it, every infinite-source pipeline leaks the first time it is no longer wanted.

Think about how many places this matters:

- HTTP handlers that fan out to backends and want to abort when the client disconnects.
- CLIs that read from stdin and need to exit on `Ctrl-C`.
- Long-poll endpoints that should release goroutines when the client times out.
- Streaming database queries that should be cancelled when the request scope ends.
- Background reconciliation loops that must exit when the program is shutting down.

In each of these, the goroutine has no natural end. Cancellation provides one.

### A stage that ignores cancellation leaks

The smallest possible pipeline stage looks like this:

```go
func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}
```

This stage closes `out` cleanly when `in` is closed. That covers one termination path — the upstream end-of-input. But there is another path nobody told this stage about: what if `in` never closes and the downstream consumer has gone away? The send `out <- v * v` blocks forever. The stage is leaked.

A correct stage must also exit when somebody signals "stop." That signal is the done channel or `ctx.Done()`.

### The done-channel pattern

A done channel is a `chan struct{}` that is closed to signal cancellation. `struct{}` carries no data; the channel exists only to be closed. Every stage selects on it:

```go
func square(done <-chan struct{}, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case out <- v * v:
            case <-done:
                return
            }
        }
    }()
    return out
}
```

Now the stage has two exit paths:

1. `in` closed and the `range` loop ends.
2. `done` closed and the `select` returns.

When the controller wants to stop the whole pipeline, it calls `close(done)`. All stages see it, exit their loops, and close their own output channels. The cancellation propagates from the controller through every stage.

### Why `chan struct{}`?

`struct{}` is the empty type. It occupies zero bytes. A `chan struct{}` is a "signal-only" channel; you cannot send useful data, only the fact "a send happened." For done channels we never even send — we only close. The close is what every receiver sees.

### `context.Context` is the structured done channel

`context.Context` is an interface. Its key methods are:

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

A done channel and a small bookkeeping struct, in interface clothing. You get a `Context` by calling one of the factory functions:

```go
ctx := context.Background()                       // root, never cancelled
ctx, cancel := context.WithCancel(parent)         // manual cancel
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
ctx, cancel := context.WithDeadline(parent, t)
```

Each factory except `Background` returns a `cancel` function. You must call it. The convention is `defer cancel()`. The `Done()` channel closes when:

- The cancel function is called, or
- The deadline passes, or
- The parent context is cancelled.

Pass `ctx` as the first parameter to any function whose work should be cancellable:

```go
func square(ctx context.Context, in <-chan int) <-chan int {
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
```

This is the same as the done-channel version. `ctx.Done()` *is* a done channel. The only difference is that `context.Context` is the agreed-upon convention across the entire Go ecosystem — HTTP handlers, database drivers, RPC libraries, and almost every modern Go package take a `Context` as their first argument and respect cancellation.

### Upstream vs downstream cancellation

A pipeline has a flow direction: upstream stages produce, downstream stages consume. Cancellation can flow in either direction.

- **Downstream cancellation** is the common case. The consumer decides to stop, propagates `cancel()` to the context, every stage sees `ctx.Done()` close, and the whole pipeline shuts down. This is the model for "user closed the request, stop computing."
- **Upstream cancellation** is when a downstream stage encounters an error and asks the producer to stop. The downstream calls `cancel()` on the shared context, the upstream sees it via `ctx.Done()`, and stops producing. The pipeline then drains and closes.

In both cases the underlying mechanism is the same channel-close. The difference is *who* makes the call. With `context.Context`, the cancel function can be passed to any stage that might need to trigger shutdown.

### Stages must select on both `ctx.Done()` and the channel op

The single rule that catches most pipeline bugs is:

> Every blocking channel send and every blocking channel receive in a stage must be inside a `select` whose other case is `<-ctx.Done()`.

If you receive without selecting, you cannot be unblocked. If you send without selecting, you cannot be unblocked. Every block point is a potential leak.

```go
// WRONG — unblockable send
out <- v

// RIGHT
select {
case out <- v:
case <-ctx.Done():
    return
}

// WRONG — unblockable receive
v := <-in

// RIGHT
select {
case v, ok := <-in:
    if !ok { return }
    // ...
case <-ctx.Done():
    return
}
```

The `range` form of receive (`for v := range in`) is a special case: it stops naturally when the channel closes, so it does not block forever if the upstream eventually closes the channel. It still leaks if the upstream never closes. The safe rule is: even `range` loops should have a `select` body or a way to bail out.

### The minimum viable cancellation signal

Strip everything else away and the bare-bones cancellation primitive is:

```go
done := make(chan struct{})
// ... somewhere ...
close(done)
// ... in another goroutine ...
<-done // unblocks the instant close(done) runs
```

That's it. Two lines of code that the entire `context` package is built around. The channel is opened by the orchestrator, the channel is closed by the orchestrator, and any number of goroutines select on it to learn that they should stop. Closing a channel is the only operation in Go that broadcasts to every receiver simultaneously. No mutex, no condition variable, no atomic. Just a channel close.

Once you internalise that closing a channel is "broadcast stop," the rest of cancellation follows mechanically. `ctx.Done()` is the same channel. `context.WithCancel` is a constructor that wraps the channel and the close in a function. `context.WithTimeout` is the same construction plus a `time.AfterFunc` that calls `cancel` for you.

### The `select` is non-deterministic, on purpose

If two cases of a `select` are ready at the same time, Go picks one at random. This matters for cancellation because it means that even after `cancel()` has fired and `ctx.Done()` is closed, the stage may still do one more send or receive before it sees the cancellation. The cancellation case has no priority.

```go
select {
case out <- v:    // both ready
case <-ctx.Done(): // both ready
}
```

If both are ready, `select` picks at random. This is correct: it guarantees the consumer sees the in-flight value eventually if it does the next read, and it guarantees the stage exits eventually if it loops back. It is wrong to assume that adding `<-ctx.Done()` to a select makes cancellation strictly higher priority than the data path.

Implication: cancellation is *eventually* delivered, not instantly. A pipeline with a deep buffer can take a few iterations of `select` choices to flush. For most applications this is fine. For latency-critical cancellation, design buffers small and document the worst-case lag.

### What happens to in-flight values when cancellation fires

Consider:

1. Producer sends `42` into channel `mid`.
2. Filter receives `42`, computes `42*42 = 1764`.
3. Filter is about to send `1764` to channel `out`.
4. `cancel()` fires.
5. Filter selects: cases are `out <- 1764` and `<-ctx.Done()`. Both are ready (consumer is reading on the other end; ctx is cancelled).
6. Random choice. Could go either way.

The value `1764` is either delivered downstream or quietly dropped. It is in-flight: not in any channel buffer, not yet visible to the consumer, but already computed.

This is normally fine — cancellation by definition means "we no longer care about the rest of the work." But if your stage is doing something with side effects (writing to a database, sending an email, incrementing a counter), then "we might or might not finish the current item" is a genuinely interesting business decision. For idempotent or read-only stages it does not matter; for side-effecting stages it does, and you may need explicit "commit-or-cancel" semantics rather than the casual `select` pattern.

### How big is the cancellation latency?

The latency between `cancel()` and a stage actually exiting is bounded by:

- The cost of waking a goroutine that is in `select` (microseconds).
- Any non-cancellable work currently in flight in that stage (the body of `work()` between two selects).
- The scheduler getting to that goroutine on some thread.

For a stage that does light per-item work and selects frequently, cancellation latency is sub-millisecond. For a stage that computes for 30 seconds per item with no internal selects, cancellation latency can be 30 seconds. The cure is to thread `ctx` down into the per-item work too, so the work itself can be cancelled mid-iteration.

```go
func work(ctx context.Context, v Item) Result {
    // long computation with check-points
    if ctx.Err() != nil {
        return Result{}
    }
    // ... step 1 ...
    if ctx.Err() != nil {
        return Result{}
    }
    // ... step 2 ...
}
```

A polled `ctx.Err()` check is cheap (atomic load) and gives the work the same cancellability the outer loop has.

---

## Real-World Analogies

### Cancellation is the fire alarm

Each stage in a pipeline is a worker in a building. The done channel is the fire alarm. When the alarm goes off, every worker stops what they are doing and walks to the exit. They do not call each other to ask permission. They hear the alarm and leave.

The crucial property of an alarm is that it is broadcast: everyone hears it at the same time. Closing a channel has the same property: every goroutine selecting on it is unblocked simultaneously.

### Context is the building wiring

Pulling a fire alarm in a building does not magically alert every worker; the alarm needs wiring to every room. `context.Context` is the wiring. You pull the alarm in one place (call `cancel()`), and the signal travels through every child context, eventually reaching every goroutine that selected on `ctx.Done()`.

A goroutine that did not subscribe to the wiring — that did not select on `ctx.Done()` — does not hear the alarm. It is the worker who left their radio at home.

### Deadlines are timers attached to the alarm

`context.WithTimeout(parent, 5*time.Second)` is "if nobody calls `cancel()` within 5 seconds, the alarm fires automatically." Useful when the operation has a hard limit but you forgot to enforce it manually.

### Upstream vs downstream: river analogy

A pipeline is a river. Upstream stages are the source; downstream stages are the mouth.

- *Downstream cancellation:* the dam closes at the mouth, the river backs up, and the source stops pumping (because there is no point producing if nobody is drinking).
- *Upstream cancellation:* the source itself stops (drought), and everything below dries up.

In Go terms, both look the same to a stage in the middle: `ctx.Done()` fires, and the stage exits.

---

## Mental Models

### Model 1: "Close once, see many"

A closed channel is observable to every receiver. Closing it is the only synchronisation primitive in Go that broadcasts to N readers at once without iteration. Done channels and `ctx.Done()` are exactly that.

```go
done := make(chan struct{})
go func() { for { select { case <-done: return; default: ... } } }() // listener 1
go func() { for { select { case <-done: return; default: ... } } }() // listener 2
close(done) // both listeners unblock
```

This is why every cancellation primitive in Go ends up being a close on a channel: it is the cheapest way to broadcast.

### Model 2: "Context is a tree, not a chain"

Contexts form a tree rooted at `context.Background()`. When you call `WithCancel`, `WithTimeout`, etc., the new context is a child of the parent. Cancelling a parent cancels all descendants. Cancelling a child does not cancel siblings or the parent.

```
Background()
   └── ctx1 = WithTimeout(Background, 30s)
         ├── ctx2 = WithCancel(ctx1)   // pipeline overall
         │     ├── ctx2a = WithCancel(ctx2)   // stage A
         │     └── ctx2b = WithCancel(ctx2)   // stage B
         └── ctx3 = WithCancel(ctx1)   // unrelated task
```

If `ctx1` times out, every descendant cancels. If you cancel `ctx2`, both stages cancel but `ctx3` does not.

### Model 3: "Two reasons to stop"

A stage stops for one of two reasons:

1. **End of stream.** Upstream finished, channel closed, no more work — normal completion.
2. **Cancelled.** Somebody fired the alarm — abnormal termination.

Both must lead to the same cleanup: close the output channel, release any resources, return. The `select` pattern handles both, the `range` covers (1), and the `<-ctx.Done()` case covers (2).

### Model 4: "If you spawn it, you cancel it"

For every goroutine you start, you should be able to point at the line where it exits. If the answer is "when the channel closes," you should also be able to point at where the channel closes. If the answer is "when the context is cancelled," you should be able to point at the `cancel()` call. No goroutine should be uncancellable.

---

## Pros & Cons

### Done channel pattern — Pros

- **Trivially simple.** One `chan struct{}`, one `close`. No imports.
- **Broadcasts to N goroutines at once.**
- **No bookkeeping struct, no extra heap allocations.**

### Done channel pattern — Cons

- **No deadlines.** You wire timeouts yourself with `time.After` or `time.NewTimer`.
- **No values.** Cannot carry request IDs or auth tokens.
- **Not standardised.** Every codebase invents its own. Library functions cannot accept "a done channel" generically.

### `context.Context` — Pros

- **Standard.** Every Go library knows how to propagate it.
- **Deadlines and timeouts built in.** No manual `time.After` plumbing.
- **Composes via parent-child relations.** Cancel a parent and the whole subtree stops.
- **Values for request-scoped data.** Trace IDs, user IDs.

### `context.Context` — Cons

- **Allocates per derived context.** Tiny but non-zero.
- **Easy to forget `defer cancel()`** and leak goroutines waiting on the timer.
- **Easy to overuse `WithValue`** as a backdoor for parameters.

---

## Use Cases

| Scenario | Why cancellation matters |
|---|---|
| HTTP handler running a pipeline | When the client disconnects, the handler must abort the pipeline or waste CPU and DB connections. |
| CLI tool with `Ctrl-C` | The signal handler cancels the root context and every goroutine exits cleanly. |
| Database batch job with a deadline | If 30 seconds elapse without completion, cancel and roll back. |
| Fan-out to N services, take first answer | When one returns, cancel the rest. |
| Worker pool draining on shutdown | The controller signals cancel; workers finish their current item and exit. |
| Streaming RPC | The RPC framework cancels the per-call context when the client closes the stream. |

---

## Code Examples

### Example 1: A producer that ignores cancellation (BUG)

```go
package main

import "fmt"

func produce(out chan<- int) {
    for i := 0; ; i++ {
        out <- i
    }
}

func main() {
    ch := make(chan int)
    go produce(ch)
    for i := 0; i < 3; i++ {
        fmt.Println(<-ch)
    }
    // main returns; producer is leaked, blocked on send
}
```

`produce` has no way to stop. When `main` stops reading, the next `out <- i` blocks forever. The goroutine survives until process exit. In a long-running server this is a leak per call.

### Example 2: Fixing it with a done channel

```go
package main

import "fmt"

func produce(done <-chan struct{}, out chan<- int) {
    defer close(out)
    for i := 0; ; i++ {
        select {
        case out <- i:
        case <-done:
            return
        }
    }
}

func main() {
    done := make(chan struct{})
    defer close(done)

    ch := make(chan int)
    go produce(done, ch)

    for i := 0; i < 3; i++ {
        fmt.Println(<-ch)
    }
    // defer close(done) fires, producer exits
}
```

The producer now has two cases. When `main` returns and `close(done)` runs, the producer's `select` unblocks and the function returns. `defer close(out)` then closes the output channel so any straggler readers also see EOF.

### Example 3: Same idea with `context.Context`

```go
package main

import (
    "context"
    "fmt"
)

func produce(ctx context.Context, out chan<- int) {
    defer close(out)
    for i := 0; ; i++ {
        select {
        case out <- i:
        case <-ctx.Done():
            return
        }
    }
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    ch := make(chan int)
    go produce(ctx, ch)

    for i := 0; i < 3; i++ {
        fmt.Println(<-ch)
    }
}
```

`context.Context` replaces the manual done channel. `defer cancel()` is the equivalent of `defer close(done)`.

### Example 4: A two-stage pipeline with cancellation

```go
package main

import (
    "context"
    "fmt"
)

func produce(ctx context.Context, out chan<- int) {
    defer close(out)
    for i := 0; i < 100; i++ {
        select {
        case out <- i:
        case <-ctx.Done():
            return
        }
    }
}

func square(ctx context.Context, in <-chan int, out chan<- int) {
    defer close(out)
    for v := range in {
        select {
        case out <- v * v:
        case <-ctx.Done():
            return
        }
    }
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    nums := make(chan int)
    squares := make(chan int)

    go produce(ctx, nums)
    go square(ctx, nums, squares)

    for i := 0; i < 5; i++ {
        fmt.Println(<-squares)
    }
    // defer cancel() stops both stages
}
```

Both stages share the same context. Cancel once, both stop. The output channels are closed by their owning goroutines.

### Example 5: Stopping a pipeline with a deadline

```go
ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
defer cancel()

nums := make(chan int)
go produce(ctx, nums)

for v := range nums {
    fmt.Println(v)
}
fmt.Println("done:", ctx.Err())
```

The producer races against the timer. After 100 ms `ctx.Done()` fires, the producer exits, `close(nums)` runs, and the consumer's `range` ends. `ctx.Err()` is `context.DeadlineExceeded`.

### Example 6: A consumer that stops by cancelling the context

```go
func consume(ctx context.Context, cancel context.CancelFunc, in <-chan int) {
    for v := range in {
        if v > 10 {
            cancel() // tell the rest of the pipeline to stop
            return
        }
        fmt.Println(v)
    }
}
```

This is upstream cancellation. The consumer decides to stop based on a condition, and the producer at the top sees `ctx.Done()` and exits.

### Example 7: `select` with a `default` is wrong for cancellation

```go
// WRONG
for {
    select {
    case <-ctx.Done():
        return
    default:
        // tight CPU loop
    }
}
```

A `default` case turns `select` into a non-blocking poll. The goroutine burns a CPU core checking for cancellation millions of times per second. Use a blocking `select` on the actual channel operation, with `ctx.Done()` as a separate case. Only use `default` when you genuinely have non-blocking semantics to express.

### Example 8: Handling `Ctrl-C` at the top

```go
package main

import (
    "context"
    "os"
    "os/signal"
    "syscall"
)

func main() {
    ctx, cancel := signal.NotifyContext(context.Background(),
        os.Interrupt, syscall.SIGTERM)
    defer cancel()

    runPipeline(ctx)
}
```

`signal.NotifyContext` (Go 1.16+) returns a context cancelled on signal. The whole pipeline that uses `ctx` shuts down on `Ctrl-C`.

### Example 9: Receive with `select` on the input channel

```go
func filter(ctx context.Context, in <-chan int, out chan<- int) {
    defer close(out)
    for {
        select {
        case <-ctx.Done():
            return
        case v, ok := <-in:
            if !ok {
                return // upstream finished
            }
            if v%2 == 0 {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }
    }
}
```

The verbose form. Both the receive and the send are guarded by `ctx.Done()`. Always cancellable, never leaks.

### Example 10: Checking `ctx.Err()` after the loop

```go
for v := range in {
    process(v)
}
if err := ctx.Err(); err != nil {
    return err
}
return nil
```

After a `range` exits because the channel closed, you may still want to know whether the close was the normal end of stream or the result of cancellation. `ctx.Err()` tells you: `nil` if still live, `context.Canceled` if `cancel()` was called, `context.DeadlineExceeded` if the timer fired.

### Example 11: Three-stage pipeline shut down cleanly

```go
package main

import (
    "context"
    "fmt"
    "strings"
    "sync"
    "time"
)

func gen(ctx context.Context, words []string) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        for _, w := range words {
            select {
            case out <- w:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func upper(ctx context.Context, in <-chan string) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        for w := range in {
            select {
            case out <- strings.ToUpper(w):
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func sink(ctx context.Context, in <-chan string, wg *sync.WaitGroup) {
    defer wg.Done()
    for w := range in {
        select {
        case <-ctx.Done():
            return
        default:
        }
        fmt.Println(w)
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()
    words := []string{"the", "quick", "brown", "fox"}
    var wg sync.WaitGroup
    wg.Add(1)
    go sink(ctx, upper(ctx, gen(ctx, words)), &wg)
    wg.Wait()
}
```

All three stages share `ctx`. If the work takes less than 200 ms, the pipeline completes normally; otherwise the deadline trips and every stage exits. The `WaitGroup` join is what stops `main` from returning prematurely.

### Example 12: Cancellation in a long-running per-item computation

```go
func cpuStage(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            result, ok := slowWork(ctx, v)
            if !ok {
                return
            }
            select {
            case out <- result:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func slowWork(ctx context.Context, v int) (int, bool) {
    sum := 0
    for i := 0; i < 1_000_000; i++ {
        if i%1024 == 0 {
            if ctx.Err() != nil {
                return 0, false
            }
        }
        sum += i ^ v
    }
    return sum, true
}
```

The inner loop polls `ctx.Err()` every 1024 iterations. This gives the work an effective cancellation latency of around a microsecond rather than the full million iterations. The cost of an `atomic.LoadInt32`-equivalent check is negligible compared to the work between checks.

### Example 13: A receive that drains after cancellation

After cancelling, the controller may need to drain a channel so the producer can return. Without the drain, the producer can block on its last send.

```go
ctx, cancel := context.WithCancel(context.Background())
out := stage(ctx, source)
cancel()
// Drain
for range out {
}
```

The producer sees `<-ctx.Done()` and tries to exit. But if it had already entered the `select` and chose the send case, it is mid-send. The consumer's drain loop reads that value and lets the send complete; the producer then loops, sees the cancel, and exits properly.

Without the drain, the producer could be stuck on the last `out <- v` send forever. The drain is the courtesy that completes the protocol.

### Example 14: Watching cancellation from outside the pipeline

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

go func() {
    <-ctx.Done()
    fmt.Println("pipeline cancelled because:", ctx.Err())
}()
```

A separate observer goroutine can react to cancellation — perhaps to log, to alert, or to flush metrics. It is still subject to the same rule: it must select on `ctx.Done()` and then return.

### Example 15: Passing the HTTP request context to a pipeline

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    out := buildPipeline(ctx)
    for v := range out {
        if _, err := fmt.Fprintln(w, v); err != nil {
            return
        }
    }
}
```

`r.Context()` is automatically cancelled when the client disconnects. Passing it into the pipeline makes the pipeline self-clean on disconnect. This is the most common production case for cancellation propagation.

---

## Coding Patterns

### Pattern 1: The cancellable stage template

Every pipeline stage in junior code should look like this:

```go
func Stage(ctx context.Context, in <-chan In) <-chan Out {
    out := make(chan Out)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-in:
                if !ok {
                    return
                }
                result := work(v)
                select {
                case out <- result:
                case <-ctx.Done():
                    return
                }
            }
        }
    }()
    return out
}
```

Receive guarded, send guarded, output closed on exit. Memorise it.

### Pattern 2: `defer cancel()` at the call site

Anywhere you create a context with cancel, defer the cancel:

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
```

If the function exits early, the cancel still runs. The pipeline always gets the signal.

### Pattern 3: Pass context as the first parameter

By Go convention, `ctx context.Context` is always the first parameter:

```go
func Square(ctx context.Context, in <-chan int) <-chan int { ... }
```

Never store a context in a struct field except in narrow framework cases. Always pass it explicitly so its lifetime is visible.

### Pattern 4: `signal.NotifyContext` for graceful shutdown

```go
ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
defer cancel()
runApp(ctx)
```

The whole app stops on `Ctrl-C` and so does every cancellable goroutine inside.

### Pattern 5: Cancel-and-wait

Cancelling a pipeline does not wait for it to finish; it only signals. To wait for full shutdown, pair `cancel()` with a `WaitGroup`:

```go
ctx, cancel := context.WithCancel(context.Background())
var wg sync.WaitGroup
wg.Add(2)
go func() { defer wg.Done(); stageA(ctx, ...) }()
go func() { defer wg.Done(); stageB(ctx, ...) }()

cancel()
wg.Wait() // now every stage has actually exited
```

The pattern shows up whenever you need to know that the pipeline is fully dead — for instance, before closing a database connection that the pipeline shares.

### Pattern 6: Cancel after the first error

A consumer that decides to stop on the first error calls `cancel()` and exits:

```go
out := pipeline(ctx, in)
for r := range out {
    if r.Err != nil {
        cancel()
        return r.Err
    }
}
```

The remaining stages see `<-ctx.Done()` and exit. The downstream consumer's drain (the `range` continuing until the channel closes) cleans up in-flight values.

### Pattern 7: Distinguishing cancellation from completion

```go
for v := range out {
    handle(v)
}
if ctx.Err() != nil {
    return ctx.Err() // cancelled
}
return nil // normal completion
```

A `range` ending could mean "we finished" or "we were cancelled and the producer noticed." `ctx.Err()` is the distinguisher.

---

## Clean Code

- **Always pass `ctx` as the first parameter.** Stages without `ctx` cannot participate in cancellation.
- **Always `defer cancel()`.** Otherwise the timer or cancel resources leak.
- **Always wrap blocking channel operations in `select` with `<-ctx.Done()`.** Every block point is a potential leak.
- **Always close the output channel from the producing goroutine.** The owner closes; never close from the consumer side.
- **Never put a `default` case in a cancellation `select`** unless you specifically want non-blocking semantics. The default turns the loop into a busy-wait.

---

## Product Use / Feature

| Product feature | How cancellation propagation helps |
|---|---|
| HTTP request handler | Cancels the work pipeline when the client disconnects, saving CPU and DB resources. |
| CLI with `Ctrl-C` | `signal.NotifyContext` cancels every goroutine in the program tree. |
| Search-as-you-type backend | A new keystroke cancels the previous query's pipeline. |
| Batch ETL with deadline | A timeout context aborts the run if it exceeds the SLA, returning partial output. |
| Microservice request | The incoming gRPC `Context` flows into outgoing calls; one cancel stops the whole fan-out. |

---

## Error Handling

Cancellation is technically a form of error. `ctx.Err()` returns:

- `nil` — context is still live.
- `context.Canceled` — somebody called `cancel()`.
- `context.DeadlineExceeded` — the deadline passed.

After a pipeline exits, the caller checks `ctx.Err()` to know why. Returning `ctx.Err()` is a common pattern:

```go
for v := range out {
    process(v)
}
return ctx.Err()
```

`nil` if the pipeline ran to completion; the cancellation reason otherwise.

The standard library uses these errors widely. For example, `net/http.Server.Shutdown` returns `context.DeadlineExceeded` if the deadline elapses before shutdown completes; `database/sql.QueryContext` returns `context.Canceled` if the context is cancelled mid-query.

---

## Security Considerations

- **A leaked pipeline holds memory and possibly secrets.** Buffered work units, request bodies, or auth tokens can outlive the request. Always cancellable.
- **Cancellation must reach external resources.** A goroutine waiting on `db.Query(...)` without `ctx` will still run the query to completion even if the parent cancelled. Pass `ctx` through to every blocking call.
- **Do not include sensitive data in `context.Value`.** It is intended for request-scoped values, not for secrets — though the values do not normally cross goroutine boundaries beyond the context tree, treating it as a backchannel is poor hygiene.
- **Long-running unbounded pipelines are denial-of-service vectors.** A request that triggers a pipeline that does not honour the request's context can be used to exhaust server resources.

---

## Performance Tips

- **`ctx.Done()` is free until it fires.** It is a closed channel test; cost is a few nanoseconds. Selecting on it adds no measurable overhead.
- **`context.WithTimeout` allocates a small struct and starts a timer.** Negligible in absolute terms, measurable if you call it in a tight inner loop. Move it outside the loop.
- **Closing a channel is O(1) and broadcasts to all receivers without iteration.** It is the cheapest fan-out primitive Go offers.
- **Use one context per pipeline, not one per stage.** Derived child contexts are useful when a stage needs its own deadline; otherwise the shared context is enough.

---

## Best Practices

1. Always pass `ctx context.Context` as the first parameter to a stage function.
2. Always `defer cancel()` at the call site of `WithCancel`/`WithTimeout`/`WithDeadline`.
3. Always guard every blocking channel op with `<-ctx.Done()` in a `select`.
4. Always close the output channel from the producing goroutine, in a `defer`.
5. Always check `ctx.Err()` after a pipeline run to detect cancellation.
6. Never put `ctx` in a struct field for general use — pass it through call chains.
7. Never use `default` in a cancellation `select` unless you mean non-blocking semantics.
8. Prefer `context.Context` over a custom done channel in any code that crosses package boundaries.
9. Use `signal.NotifyContext` for the top-level `Ctrl-C` cancel rather than rolling your own signal handler.
10. Use the race detector (`go test -race`) to catch close-and-use bugs in cancellation paths.

---

## Edge Cases & Pitfalls

### Stage sends without a `select`

```go
for v := range in {
    out <- transform(v) // unblockable
}
```

If the downstream stops reading and the context is cancelled, this send blocks forever. The goroutine never exits. The pipeline leaks.

Fix: wrap in `select`.

### Forgotten `defer cancel()`

```go
ctx, _ := context.WithTimeout(parent, 5*time.Second)
runPipeline(ctx)
```

Without `cancel()`, the timer resources stick around until the deadline. On a high-RPS server this accumulates. `go vet` flags this with `lostcancel`.

### Cancelling the parent does not close children's channels

`cancel()` closes `ctx.Done()`. It does *not* close the pipeline's data channels (`out`, `nums`, etc.). Those are closed by the goroutines themselves when they observe cancellation. If your code forgets to `defer close(out)`, the downstream `range` hangs even after cancellation.

### Reading from a closed channel returns zero values forever

```go
close(in)
v := <-in // 0, false
v = <-in  // 0, false — never blocks
```

A loop that reads without checking `ok` becomes an infinite spin after the channel closes. Use `v, ok := <-in; if !ok { return }`.

### Cancelling before the pipeline starts is fine

If `ctx` is already cancelled when the stage starts, the first `select` unblocks immediately on `<-ctx.Done()` and the stage exits. No special-case logic needed.

### Two cancels are fine; calling `cancel()` after close is fine

Calling `cancel()` twice has no effect. Calling it after the context is already cancelled (e.g. by deadline) is fine. The cancel function is idempotent.

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| No `ctx` parameter in a stage | Add it as the first parameter, propagate everywhere. |
| Unguarded send `out <- v` | Wrap in `select { case out <- v: case <-ctx.Done(): return }`. |
| Forgetting `defer close(out)` | Always close the output from the producing goroutine. |
| Forgetting `defer cancel()` | Always defer the cancel of any `WithCancel`/`WithTimeout`. |
| `default` case in a cancellation `select` | Remove it; the `select` should block. |
| Calling `cancel()` from somewhere that races with the work | Fine — `cancel` is idempotent and safe to call concurrently. |
| Storing `ctx` in a struct field | Pass it through arguments; structs should not capture lifetimes. |

---

## Common Misconceptions

> *"Closing a channel cancels everything reading from it."* — Closing the *done* channel does, because every reader was selecting on it. Closing a data channel only signals end-of-stream to its receivers; it does not propagate further by itself.

> *"`ctx.Done()` is a method that polls."* — No. It returns a `<-chan struct{}` that is closed when the context is cancelled. You use it with `select`. Calling it many times is cheap; it returns the same channel.

> *"Cancellation is instant."* — It is asynchronous. A goroutine sees `ctx.Done()` on the next `select` iteration. There is always a small lag.

> *"`context.Context` carries the cancel function."* — No. The cancel function is returned separately by `context.WithCancel(parent)`. The context only exposes `Done()` and `Err()`. The function is held by the creator.

> *"I can cancel only one stage."* — Only if you give that stage its own child context. By default, every stage shares the same context and they all cancel together.

> *"`time.After` is the right way to do timeouts."* — `time.After` leaks the timer until it fires. For cancellation, use `context.WithTimeout`, which calls `Stop()` on the timer when the cancel function is invoked.

> *"A cancelled context cannot be used."* — Wrong. A cancelled context can still be used to call `ctx.Err()`, `ctx.Done()`, `ctx.Value(...)`. What it cannot do is unblock anyone — every `<-ctx.Done()` returns immediately, and every operation that depends on the context being live will exit immediately. That is by design.

> *"I need a fresh context per stage."* — Usually not. The pipeline owns one context; every stage shares it. Per-stage contexts are useful only when a stage has its own deadline or its own cancel reason.

> *"`select` randomly picks; that is non-determinism I cannot test."* — You can test that the pipeline eventually exits, that no goroutine leaks (with `runtime.NumGoroutine`), and that `ctx.Err()` becomes non-nil. You cannot test the exact value count when cancellation races with the data flow, but you do not need to.

> *"`signal.NotifyContext` replaces every prior signal handler."* — It registers handlers via `signal.Notify`. If you also `signal.Notify` separately for the same signals, both fire. `signal.NotifyContext` does the right thing only if it is the single owner of those signals.

---

## Walkthrough: building a cancellable word-count pipeline

Let us walk through a small but realistic pipeline: read words from a slice of inputs, normalise them, count how many start with each letter, and print the totals. Then make it cancellable end to end.

### Step 1: the non-cancellable version

```go
package main

import (
    "fmt"
    "strings"
)

func words(inputs []string) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        for _, line := range inputs {
            for _, w := range strings.Fields(line) {
                out <- w
            }
        }
    }()
    return out
}

func normalise(in <-chan string) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        for w := range in {
            out <- strings.ToLower(strings.Trim(w, ".,!?"))
        }
    }()
    return out
}

func count(in <-chan string) map[rune]int {
    counts := make(map[rune]int)
    for w := range in {
        if len(w) == 0 {
            continue
        }
        counts[rune(w[0])]++
    }
    return counts
}

func main() {
    in := []string{"The quick brown fox", "jumps over the lazy dog"}
    counts := count(normalise(words(in)))
    for r, n := range counts {
        fmt.Printf("%c: %d\n", r, n)
    }
}
```

Compiles, runs, prints. Three stages: `words`, `normalise`, `count`. The first two are goroutines; the last is the consumer on the main goroutine. The input is a finite slice, so every channel eventually closes and every goroutine eventually exits. No cancellation needed.

### Step 2: introducing a long-running source

Replace the slice with a generator that yields infinitely:

```go
func words(ctx context.Context) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        i := 0
        for {
            w := fmt.Sprintf("word%d", i)
            select {
            case out <- w:
                i++
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

Now the source is infinite. Without `ctx`, the goroutine would loop forever. With `ctx`, calling `cancel()` somewhere in the parent terminates the producer cleanly.

### Step 3: cancelling the entire pipeline on a deadline

```go
ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
defer cancel()
counts := count(ctx, normalise(ctx, words(ctx)))
```

Each stage takes `ctx` and threads it through its `select`. After 100 ms, the deadline fires, `ctx.Done()` closes, and all three stages exit on their next `select` iteration. The map returned by `count` contains however many words were processed in the window.

### Step 4: cancelling the entire pipeline on a key found

Suppose `count` wants to stop early if it sees a magic word. It cannot return early without leaking the upstream producers — they will block on the next send forever. So it calls `cancel()` and then drains:

```go
func count(ctx context.Context, cancel context.CancelFunc, in <-chan string) map[rune]int {
    counts := make(map[rune]int)
    for w := range in {
        if w == "magic" {
            cancel()
            // continue ranging until the channel closes so the producer can exit
            continue
        }
        if len(w) == 0 {
            continue
        }
        counts[rune(w[0])]++
    }
    return counts
}
```

Why continue the range? Because the producer is in a `select` that may be blocked on a send. If the consumer simply `return`-s, the producer is stuck on `out <- "magic"` forever — because there is no one to receive. By keeping the range running, the consumer drains the channel, the producer's send completes, the producer loops and sees `ctx.Done()`, exits, closes its output, and the chain unwinds. The `range` then exits naturally and `count` returns.

### Step 5: wiring `signal.NotifyContext`

To make `Ctrl-C` work:

```go
func main() {
    ctx, cancel := signal.NotifyContext(context.Background(),
        os.Interrupt, syscall.SIGTERM)
    defer cancel()
    counts := count(ctx, cancel, normalise(ctx, words(ctx)))
    for r, n := range counts {
        fmt.Printf("%c: %d\n", r, n)
    }
}
```

`Ctrl-C` cancels the same context everything else uses. The pipeline drains, the totals print, the program exits. No goroutine left behind.

### Lessons from the walkthrough

1. Cancellation is wired in once at the top and threaded down by passing `ctx` to every stage.
2. The consumer that decides to stop must call `cancel()` and drain, not `return`.
3. Adding a deadline or a signal hook is a one-line change because the rest already respects `ctx`.
4. Every stage looks the same: `defer close(out); select { case out <- v: case <-ctx.Done(): return }`.

---

## Tricky Points

### `ctx.Done()` may be `nil`

For `context.TODO()` and `context.Background()`, `Done()` returns `nil`. A `select` case on a `nil` channel never fires, so this is safe — the `Done` case is effectively disabled. But code that does `<-ctx.Done()` without a `select` on a `Background` context blocks forever. Always use `select`.

### Cancelling once cancels every descendant, in some order

There is no documented order in which descendants are cancelled, but the close on each `ctx.Done()` is sequential. In practice, the runtime walks the children. A descendant that fires immediately on `ctx.Done()` may see the parent close before a sibling does.

### `defer cancel()` runs after panic

If your pipeline panics, the deferred `cancel()` still runs (defer fires on panic). The cancel cleans up the timer and any child goroutines. Combined with `recover()`, this is part of safe panic boundaries.

### `WithValue` does not pass values to goroutines magically

`context.WithValue(parent, "user", uid)` makes `ctx.Value("user")` return `uid` for that context and all descendants. The value is read by anyone who has the context, in any goroutine. The propagation is via the tree, not by side effects.

### A `nil` parent is forbidden

`context.WithCancel(nil)` panics. The parent must always be a valid context — usually `context.Background()` at the top of a program, or the inherited context from a framework like `net/http` or `gRPC`. The compiler does not catch this; `go vet` does in many cases.

### `cancel` is safe but the resources it tracks are not free

Each `WithCancel` allocates an internal struct and registers it with the parent. If you create thousands of child contexts in a loop and never cancel them, the parent's list of children grows. The Go runtime cleans up when the parent cancels, but until then the children are tracked. For long-running parents (e.g. an HTTP server context), `defer cancel()` on every child is mandatory.

### `select` evaluation order does not exist

People sometimes write the cancellation case first hoping it gets priority:

```go
select {
case <-ctx.Done():
    return
case v := <-in:
    ...
}
```

The order in the source has no effect on which case wins when both are ready. Style guides may prefer putting `<-ctx.Done()` first for readability, but it is not a priority signal.

### `Done()` is the same channel each call

Every call to `ctx.Done()` returns the same channel. Storing it in a local once is a micro-optimisation that is occasionally useful in hot loops, but not necessary in normal code.

```go
done := ctx.Done()
for {
    select {
    case <-done:
        return
    case v := <-in:
        ...
    }
}
```

The runtime is fine with `ctx.Done()` called every iteration; the cost is one interface method dispatch.

### Closing a channel twice panics

`close(out)` twice panics with "close of closed channel". With cancellation, the failure mode is: stage A and stage B both write to the same channel and try to close it on exit. Solution: pick a single closer (usually the upstream stage), or use a different shutdown protocol (covered later).

### `select` with both cases ready picks randomly

This was mentioned earlier but deserves its own entry. When the producer in a stage is in:

```go
select {
case out <- v:
case <-ctx.Done():
}
```

and both cases are ready, the value `v` is delivered or dropped at random. Code that relies on "as soon as cancellation fires, no more values flow" is wrong; values can still flow up to one more per stage after cancellation.

### Receiving from a closed `Done` returns immediately, forever

After `ctx.Done()` closes, every subsequent `<-ctx.Done()` returns instantly with the zero value of `struct{}`. This is desirable: once cancelled, every code path becomes fast-fail. It is also a footgun in a tight loop:

```go
for {
    select {
    case <-ctx.Done():
        // ...
    default:
        // ...
    }
}
```

becomes a hot busy-loop after cancellation. Always `return` from the `<-ctx.Done()` case.

### `WithCancel(WithCancel(parent))` is fine but stacks resources

Nesting cancel contexts compounds: each call allocates a small struct and a goroutine watcher (in older Go) or a tree entry (in newer Go). Avoid nesting more than two or three deep without a reason. The pattern of one root context per request, optionally one child per stage, is standard.

---

## Cancellation in HTTP request handlers — a practical detour

The most common production case for cancellation propagation is an HTTP handler that does work on behalf of a request. The `http.Request` value comes with a `Context()` method that returns a context cancelled when the client disconnects or the server is shutting down. Threading that context through your handler is what saves you when a client closes the connection mid-query.

### What `r.Context()` is cancelled on

- The client closes the TCP connection (the most common case).
- The server is shutting down (`http.Server.Shutdown`).
- The handler returns (after the response is written).
- An explicit `http.ResponseController.SetWriteDeadline` fires.

### A handler with a slow downstream

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    rows, err := db.QueryContext(ctx, "SELECT * FROM big_table")
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    defer rows.Close()
    for rows.Next() {
        var n int
        if err := rows.Scan(&n); err != nil {
            return
        }
        fmt.Fprintln(w, n)
    }
}
```

If the client disconnects mid-scan, `ctx` cancels. The driver sees it and aborts the query. The next `rows.Next()` returns false; `rows.Err()` returns `context.Canceled`. The handler returns. No goroutine, no DB connection, nothing leaks.

If you had used `db.Query` instead of `db.QueryContext`, the query would run to completion regardless of the client. That is the kind of leak you want to find and fix.

### A handler that fans out to a pipeline

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    out := buildPipeline(ctx)
    enc := json.NewEncoder(w)
    for v := range out {
        if err := enc.Encode(v); err != nil {
            return
        }
    }
    if ctx.Err() != nil {
        return
    }
}
```

The pipeline is wired to the request context. When the client disconnects, every stage of the pipeline cancels and exits. The handler also returns. The total goroutine cost of one cancelled request is zero.

### Server shutdown

```go
srv := &http.Server{Addr: ":8080", Handler: mux}
go srv.ListenAndServe()

<-shutdownCh
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(ctx)
```

`Shutdown` waits for in-flight handlers to finish, but cancels each `r.Context()`. If your handlers respect their request context, they exit on `Shutdown`. If they ignore it, `Shutdown` blocks until the timeout, then forcibly closes the connections.

Designing your handlers around request-context cancellation is the single highest-leverage Go server hygiene rule.

---

## Test

```go
// pipeline_cancel_test.go
package pipeline_test

import (
    "context"
    "testing"
    "time"
)

func TestPipelineCancels(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    nums := make(chan int)
    go func() {
        defer close(nums)
        for i := 0; ; i++ {
            select {
            case nums <- i:
            case <-ctx.Done():
                return
            }
        }
    }()
    <-nums
    <-nums
    cancel()
    // Drain to ensure the goroutine exits
    for range nums {
    }
}

func TestPipelineDeadline(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()
    nums := make(chan int)
    go func() {
        defer close(nums)
        for i := 0; ; i++ {
            select {
            case nums <- i:
            case <-ctx.Done():
                return
            }
        }
    }()
    count := 0
    for range nums {
        count++
    }
    if ctx.Err() != context.DeadlineExceeded {
        t.Fatalf("want DeadlineExceeded, got %v", ctx.Err())
    }
}
```

Run with `go test -race`. The drain after `cancel()` is essential — without it, the test may exit while the goroutine is still in the middle of sending.

---

## Tricky Questions

**Q.** What is the difference between `context.Background()` and `context.TODO()`?

**A.** Operationally none — both return a context that is never cancelled, has no deadline, and has no values. The convention is: `Background` is the root of a real context tree (e.g. in `main`); `TODO` is a placeholder for "I have not yet decided what context to use here." Static analysis tools like `staticcheck` warn on `TODO` to remind you.

---

**Q.** What happens if a stage receives from `in` but does not select on `<-ctx.Done()`?

**A.** If `in` never closes, the receive blocks forever and the goroutine leaks even after `cancel()`. If `in` eventually closes (because the upstream stage saw cancellation and closed its output), the receive completes and the stage can exit. The bug is latent: it depends on whether upstream is well-behaved.

---

**Q.** Can two goroutines share the same `cancel` function safely?

**A.** Yes. `CancelFunc` is safe for concurrent use. Calling it twice has no effect after the first.

---

**Q.** Why do we use `chan struct{}` for done channels?

**A.** Because `struct{}` is zero bytes and we never send a value — only close. The channel exists only to be closed, and the close is what every receiver observes. Any element type would work, but `chan struct{}` documents intent.

---

**Q.** What is `ctx.Err()` before any cancellation?

**A.** `nil`. It returns `context.Canceled` after `cancel()` is called, and `context.DeadlineExceeded` after the deadline elapses.

---

**Q.** What is wrong with this stage?

```go
func bad(ctx context.Context, in <-chan int, out chan<- int) {
    for v := range in {
        out <- v * 2
    }
}
```

**A.** Two problems. First, the send `out <- v * 2` is not guarded by `<-ctx.Done()`, so if the consumer stops reading and `ctx` is cancelled, the stage leaks. Second, the function does not close `out`. If the consumer is ranging over `out`, the range never ends. Fix: take `in <-chan int` and return `<-chan int`, with `defer close(out)` inside the goroutine.

---

**Q.** If a stage panics, does cancellation propagate to other stages?

**A.** Not on its own. An unrecovered panic terminates the whole process, so in a sense every other goroutine "stops" too — by dying. If you `recover` the panic inside the stage's goroutine, the cancellation must still be triggered explicitly: call `cancel()` from the deferred recover, and the rest of the pipeline will see `ctx.Done()` and exit.

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            cancel()
        }
    }()
    runStage(ctx, in, out)
}()
```

---

**Q.** Why is `defer cancel()` important even if you do not think you need to cancel?

**A.** `WithTimeout` and `WithDeadline` start a `time.AfterFunc`. The associated resources stick around until the timer fires or you call `cancel`. If your function returns before the deadline, the timer continues to consume scheduler time until it eventually fires. `defer cancel()` cleans up immediately. The `lostcancel` analyser in `go vet` flags missing cancels.

---

**Q.** Can a child context outlive its parent?

**A.** No. When the parent is cancelled, every child's `Done()` channel closes too. A child can be cancelled while the parent is still live, but the reverse is impossible.

---

**Q.** What does `context.Cause(ctx)` (Go 1.20+) do that `ctx.Err()` does not?

**A.** `context.WithCancelCause` lets you cancel a context with a custom error. `context.Cause(ctx)` returns that error; `ctx.Err()` still returns `context.Canceled`. This is useful when you want the cancellation reason to include the upstream error.

---

## Deep-dive: closures, captures, and cancellation

A subtle interaction worth being aware of as a junior: the `ctx` you receive in a function is captured by every goroutine you spawn inside it. That is normally what you want — every stage sees the same cancellation. But if you ever rebind `ctx` in a loop, the captures get tangled. Consider:

```go
func runAll(parent context.Context, jobs []Job) {
    for _, j := range jobs {
        ctx, cancel := context.WithTimeout(parent, 5*time.Second)
        defer cancel() // BUG: defers stack up; cancels fire only at function exit
        go run(ctx, j)
    }
}
```

Two issues here. First, `defer cancel()` postpones the cancel until `runAll` returns, so all the per-job timers leak until the loop is finished. If `runAll` runs for an hour, every per-job cancel sticks around for an hour. Second, the inner `ctx` is captured by the goroutine; if the loop reuses a variable named `ctx` somewhere outside, the captures could shift. The fix is to put the per-job logic in its own function:

```go
func runAll(parent context.Context, jobs []Job) {
    for _, j := range jobs {
        go runOne(parent, j)
    }
}

func runOne(parent context.Context, j Job) {
    ctx, cancel := context.WithTimeout(parent, 5*time.Second)
    defer cancel()
    run(ctx, j)
}
```

Each invocation of `runOne` has its own scope, so its `defer cancel()` fires when the goroutine returns, not when the outer loop ends. This is one of those "small change, big difference" patterns worth internalising.

---

## Cheat Sheet

```go
// Create
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

// With timeout
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()

// Top-level signal-based
ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
defer cancel()

// Cancellable stage template
func stage(ctx context.Context, in <-chan T) <-chan U {
    out := make(chan U)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-in:
                if !ok { return }
                u := work(v)
                select {
                case out <- u:
                case <-ctx.Done():
                    return
                }
            }
        }
    }()
    return out
}

// After the pipeline
return ctx.Err()
```

---

## Self-Assessment Checklist

- [ ] I can name the two main cancellation primitives in Go.
- [ ] I can write a stage template that cancels on `ctx.Done()`.
- [ ] I always `defer cancel()` after `context.WithCancel`.
- [ ] I understand that closing a channel broadcasts to every receiver.
- [ ] I can explain why an unguarded send may leak.
- [ ] I know the difference between `context.Canceled` and `context.DeadlineExceeded`.
- [ ] I can wire `signal.NotifyContext` for `Ctrl-C` cancellation.
- [ ] I know why `default` in a cancellation `select` is usually wrong.
- [ ] I can distinguish upstream cancellation from downstream cancellation.
- [ ] I check `ctx.Err()` after a pipeline run.

---

## Summary

Cancellation propagation is the contract that says "when one part of the pipeline stops, all parts stop." It is built on a single primitive: closing a channel broadcasts to every receiver. Manual done channels work for small examples; `context.Context` is the ecosystem-wide standard for everything else.

Every pipeline stage must select on `ctx.Done()` at every block point: receive from input, send to output, and any other blocking call. If a stage forgets, it leaks: the goroutine survives past the request, holds memory, holds connections, and silently accumulates over time.

You now know the basic shape: pass `ctx` as the first parameter, `defer cancel()` at the call site, wrap channel operations in `select` with `<-ctx.Done()`, close output channels in `defer` from the producing goroutine. The next step is wiring this through multi-stage pipelines and combining cancellation with error propagation.

---

## What You Can Build

After mastering this material:

- A `Ctrl-C`-cancellable producer-consumer that prints numbers until interrupted.
- A two-stage filter pipeline that stops cleanly on context cancellation.
- An HTTP handler that runs a streaming pipeline tied to the request context.
- A worker that respects a deadline and returns `context.DeadlineExceeded`.
- A CLI that ranges over a result channel and exits on the first `Ctrl-C`.

---

## Further Reading

- The Go Blog — *Go Concurrency Patterns: Pipelines and cancellation*: <https://go.dev/blog/pipelines>
- `context` package docs: <https://pkg.go.dev/context>
- The Go Blog — *Context*: <https://go.dev/blog/context>
- *Concurrency in Go* by Katherine Cox-Buday — chapters on cancellation and the done channel.
- `signal.NotifyContext` docs: <https://pkg.go.dev/os/signal#NotifyContext>

---

## Related Topics

- Channels and `select` — the underlying primitive for cancellation.
- `errgroup` — combining cancellation with error propagation.
- `sync.WaitGroup` — waiting for stages to finish exiting.
- Graceful shutdown — stopping a server with in-flight work.
- HTTP `Request.Context()` — request-scoped cancellation.

---

## A longer mental model: pipelines as small operating systems

It helps to step back and think of a Go pipeline as a tiny operating system. The "processes" are goroutines, the "IPC" is channels, and the "shutdown signal" is `ctx.Done()`. The orchestrator that builds the pipeline is the init process; the leaves are user processes.

In Linux, when a process dies, its file descriptors are closed and any process blocking on them gets EOF or EPIPE. The same principle applies in Go: when a stage exits, it closes its output channel, and downstream stages reading on it see EOF (a closed channel) on their next receive. The shutdown signal is the equivalent of `SIGTERM`, with the channel close being the equivalent of "all file descriptors closed."

What makes Go's version pleasant is that everything is in user space and the wiring is in plain code. You read the source and you can trace exactly how a `Ctrl-C` becomes a `ctx.Done()` becomes a `select` choice becomes a `return` becomes a `close(out)` becomes the next stage's `range` ending. It is the cleanest version of cooperative shutdown that any mainstream language offers.

The flip side is that you must do this wiring deliberately. The runtime will not insert it for you. A goroutine that does not select on `ctx.Done()` is the equivalent of a Linux process that ignores `SIGTERM`: it has to be killed forcefully. In a server, "forcefully" means `kill -9`, which in Go terms is "the process exits because something else crashed." That is not shutdown; that is termination.

Cancellation propagation is the discipline of designing a goroutine so that it always has a polite exit path. A polite goroutine wins on three axes: it does not leak in steady state, it does not leak under shutdown, and it does not leak under error.

---

## A second mental model: cancellation as flow control

`ctx.Done()` is sometimes described as a flow-control primitive. The metaphor is apt: in TCP, the sender slows down when the receiver's window shrinks; in Go pipelines, the sender stops entirely when the receiver's `ctx.Done()` closes. Both are about preventing the sender from doing work that nobody will consume.

The difference is granularity. TCP flow control is continuous: the window grows and shrinks. Go cancellation is binary: open or closed. There is no "partial cancel." This binary nature is a strength — there are no edge cases around "half-cancelled" — but it does mean that fine-grained back-pressure is a separate concern, handled by buffered channels and bounded worker pools.

For now, treat cancellation as "the consumer has gone away; stop producing." That is the whole semantics.

---

## Pitfalls revisited: the leak gallery

Let me enumerate the most common ways a junior pipeline leaks. Each of these has been observed in real production code. They are listed in roughly the order in which a junior Go developer encounters them.

### Leak 1: producer with no cancel case

```go
go func() {
    for i := 0; ; i++ {
        out <- i
    }
}()
```

The send is unblockable. When the consumer stops reading, this goroutine is wedged forever. Fix: `select` with `<-ctx.Done()`.

### Leak 2: consumer that returns without draining

```go
for v := range out {
    if found(v) {
        return // upstream may still be sending
    }
}
```

The producer is in `select { case out <- v: case <-ctx.Done(): }`. The consumer's return means no one is reading `out`. The producer's send is blocked. If `ctx` is not also cancelled, the producer waits forever. Fix: cancel and drain, or rely on cancellation to bail out the producer.

### Leak 3: forgotten `defer close(out)`

```go
go func() {
    for v := range in {
        out <- v * 2
    }
}()
```

If `in` closes normally, the goroutine exits but `out` is never closed. Any downstream `range out` hangs. Fix: `defer close(out)` at the top.

### Leak 4: missing `defer cancel()`

```go
ctx, _ := context.WithTimeout(parent, 5*time.Second)
runPipeline(ctx)
```

The underscore discards the cancel. The internal timer survives. Worse, `go vet` may not catch every case. Fix: always `cancel := ...; defer cancel()`.

### Leak 5: send to a buffered channel of capacity 1, no one reads

```go
ch := make(chan int, 1)
go func() { ch <- compute() }()
return // no read
```

The send completes because the buffer has room, but the goroutine has finished its work and exited cleanly — this is fine. Now reverse:

```go
ch := make(chan int) // unbuffered
go func() { ch <- compute() }()
return // no read
```

The unbuffered send blocks because there is no reader. The goroutine never completes. This is the classic "result channel never read" leak. Fix: buffer of size 1, or guarantee a read.

### Leak 6: `time.After` in a select that loops

```go
for {
    select {
    case v := <-in:
        process(v)
    case <-time.After(time.Second):
        timeout()
    }
}
```

Every iteration starts a new timer; on every `<-in` win, the timer leaks until the second elapses. Fix: `timer := time.NewTimer(...)`, reset on use, `defer timer.Stop()`.

### Leak 7: cancelling but not waiting

```go
cancel()
return
```

The goroutines have been signalled, but they have not yet exited. If you also close shared resources (DB pool, file), they may still be in use. Fix: pair `cancel()` with a `WaitGroup.Wait()` for an ordered shutdown.

### Leak 8: stage that holds external resources past cancellation

```go
func stage(ctx context.Context, in <-chan int) <-chan int {
    f, _ := os.Open("data")
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            // f used here
            out <- v
        }
    }()
    return out
}
```

`f` is never closed. Even worse, if the goroutine returns because of cancellation, `f.Close()` is not called. Fix: `defer f.Close()` inside the goroutine.

### Leak 9: panic inside a goroutine that holds output channel

```go
go func() {
    defer close(out)
    for v := range in {
        process(v) // panics on bad v
        out <- v
    }
}()
```

If `process` panics, `defer close(out)` runs (defers fire on panic), but the panic then propagates up the goroutine and the process dies. Sometimes that is fine; sometimes you want to log and continue. Fix: `defer func() { recover(); cancel() }()` plus log.

### Leak 10: the "background" goroutine forgotten in a struct

```go
type Cache struct {
    data map[string]any
}

func NewCache() *Cache {
    c := &Cache{data: map[string]any{}}
    go func() {
        for range time.Tick(time.Second) {
            c.evict()
        }
    }()
    return c
}
```

The `Cache`'s evictor goroutine has no exit. Every `NewCache` leaks one goroutine. Fix: accept `ctx`, store the cancel function, and `Close()` calls cancel. Or use `time.Ticker` with `defer ticker.Stop()` in a cancellable loop.

These ten cover the bulk of "my goroutine count keeps growing" bugs at the junior level. The fixes all reduce to: every stage has `ctx`, every block has a `select` on `ctx.Done()`, every output is closed in a `defer`, every cancel is `defer cancel()`.

---

## Practical Recipes

This section collects small, self-contained patterns you can paste into a project. Each one is a complete, compilable snippet with an explanation.

### Recipe 1: "Stop after first N items"

A consumer needs only the first N values from a pipeline. After it has them, it cancels and drains.

```go
func first(ctx context.Context, cancel context.CancelFunc, in <-chan int, n int) []int {
    out := make([]int, 0, n)
    for v := range in {
        if len(out) < n {
            out = append(out, v)
            if len(out) == n {
                cancel()
            }
        }
    }
    return out
}
```

Why does the range continue after `cancel()`? Because we have to drain `in` so the producer's last send completes. Without the drain, the producer is stuck and the goroutine leaks.

### Recipe 2: "Stop on first error"

```go
type Result struct {
    Value int
    Err   error
}

func sink(ctx context.Context, cancel context.CancelFunc, in <-chan Result) error {
    for r := range in {
        if r.Err != nil {
            cancel()
            // drain
            for range in {
            }
            return r.Err
        }
        // process r.Value
    }
    return ctx.Err()
}
```

The first error causes cancellation; the explicit drain loop reads remaining values so producers can exit.

### Recipe 3: "Cancel after a duration of inactivity"

A pipeline should cancel if no values flow for some time. Use a timer that resets on each value.

```go
func inactivity(ctx context.Context, cancel context.CancelFunc, in <-chan int, idle time.Duration) {
    timer := time.NewTimer(idle)
    defer timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case v, ok := <-in:
            if !ok {
                return
            }
            if !timer.Stop() {
                select {
                case <-timer.C:
                default:
                }
            }
            timer.Reset(idle)
            process(v)
        case <-timer.C:
            cancel()
            return
        }
    }
}

func process(v int) {}
```

The timer is reset every time a value arrives. If `idle` elapses with no values, `<-timer.C` wins and we cancel.

### Recipe 4: "Cancel before the pipeline starts"

You may be handed a context that is already cancelled. Stages should handle this gracefully — the first `select` they enter should pick `<-ctx.Done()` and return immediately. The template at the start of this file does this correctly: the first thing it does in the loop is select. No special-case needed.

```go
ctx, cancel := context.WithCancel(context.Background())
cancel() // pre-cancelled
out := stage(ctx, source)
// out closes almost immediately
for range out {
}
```

### Recipe 5: "Convert a callback API to a cancellable channel"

Some libraries expose a callback API rather than a channel. To bridge:

```go
func subscribe(ctx context.Context, src func(func(string)) func()) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        stop := src(func(msg string) {
            select {
            case out <- msg:
            case <-ctx.Done():
            }
        })
        defer stop()
        <-ctx.Done()
    }()
    return out
}
```

The bridge spawns a goroutine that subscribes via the callback. The callback delivers messages with a `select` so it does not block on a stalled consumer. When `ctx` cancels, we unsubscribe and exit.

### Recipe 6: "Forward cancellation to a separate cleanup goroutine"

You have a goroutine doing cleanup that should run on cancellation but not block on `ctx.Done()`:

```go
go func() {
    <-ctx.Done()
    cleanup()
}()
```

A simple watcher. Useful when the cleanup is itself fast and synchronous.

### Recipe 7a: "Cancel propagation with `context.AfterFunc` (Go 1.21+)"

`context.AfterFunc` registers a callback that runs when a context is cancelled:

```go
stop := context.AfterFunc(ctx, func() {
    log.Println("ctx cancelled, cleaning up")
})
defer stop()
```

`stop` returns a bool indicating whether the function was unregistered before it ran. This is the cleanest way to react to cancellation without a watcher goroutine.

### Recipe 7b: "Cancel-with-cause for richer errors"

`context.WithCancelCause` lets you attach an error reason:

```go
ctx, cancel := context.WithCancelCause(parent)
defer cancel(nil)

// later
cancel(errors.New("source failed"))

// elsewhere
if err := context.Cause(ctx); err != nil {
    // err == errors.New("source failed")
}
```

`ctx.Err()` still returns `context.Canceled`; `context.Cause(ctx)` returns the original error. Useful when you want to bubble up "why did we cancel" through the pipeline.

### Recipe 7: "Combine multiple cancellation sources"

Sometimes a stage should stop if any of several contexts is cancelled. Use `context.AfterFunc` (Go 1.21+) or a watcher goroutine:

```go
ctx, cancel := context.WithCancel(parent)
go func() {
    select {
    case <-otherCtx.Done():
        cancel()
    case <-ctx.Done():
    }
}()
```

When `otherCtx` cancels, we cancel `ctx`. When `ctx` cancels first, we exit. Either way the watcher goroutine returns.

---

## Recipe 8: "Per-stage timeouts inside a request"

Sometimes individual stages should have shorter deadlines than the request as a whole. Layer contexts:

```go
func step(parent context.Context) error {
    ctx, cancel := context.WithTimeout(parent, 200*time.Millisecond)
    defer cancel()
    return slowCall(ctx)
}
```

If `parent` is cancelled first, this child cancels too. If the inner 200 ms elapses first, only this step cancels. The outer pipeline continues with the result or the timeout error.

## Recipe 9: "Wrap a non-context API in cancellable form"

A library may accept only a callback or a polling interface. Wrap it:

```go
func cancellableRead(ctx context.Context, r io.Reader, buf []byte) (int, error) {
    type result struct {
        n   int
        err error
    }
    done := make(chan result, 1)
    go func() {
        n, err := r.Read(buf)
        done <- result{n, err}
    }()
    select {
    case res := <-done:
        return res.n, res.err
    case <-ctx.Done():
        return 0, ctx.Err()
    }
}
```

This makes the cancellation observable, but note the goroutine running `r.Read` does *not* get cancelled — only the *caller's view* of it does. The underlying read continues until it returns. In practice, the OS may close the file descriptor or return EOF when the context cancels at a higher level. The leak hazard here is real and is why "wrap a non-cancellable API" is a senior topic to be done carefully.

## Recipe 10: "Cancellation in tests"

Tests use cancellation often. The pattern:

```go
func TestSomething(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    t.Cleanup(cancel)
    // ... test body uses ctx ...
}
```

`t.Cleanup(cancel)` ensures the context is cancelled when the test ends, including on `t.Fatal`. This is the safest pattern in tests: no orphaned goroutines, no shared state across tests.

For tests with timeouts:

```go
ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
t.Cleanup(cancel)
```

The test fails (or times out) within 100 ms whether or not the pipeline finishes.

---

## Mental Models, Part 2

### Model 5: "Cancellation is a contract, not a guarantee of speed"

When `cancel()` fires, the contract is "every cancellable stage will eventually exit." The contract is *not* "every stage exits within X milliseconds." Cancellation latency depends on the size of the work each stage does between selects. A stage that takes a second per item has up to a second of cancellation latency.

This is usually fine. But for latency-sensitive shutdown — for example, "the SIGTERM handler has 30 seconds before the orchestrator kills the process" — you must design stages that select often. The standard idiom is to poll `ctx.Err()` inside long inner loops.

### Model 6: "Cancellation is forward, never backward"

Once a context is cancelled, it stays cancelled. There is no `Uncancel`. If you want to retry, you create a fresh context. This is a feature: the cancelled state is monotonic and observable from any goroutine without further synchronisation.

### Model 7: "The producer is the closer"

In a Go pipeline, by convention, the goroutine that sends to a channel is the goroutine that closes it. The consumer never closes a channel it does not own. With cancellation, the rule does not change: a stage that receives input and produces output is the closer of its own output. When it sees cancellation, it returns; its `defer close(out)` fires.

If two goroutines both write to the same output channel (fan-in), neither can safely close it alone. Either one stage waits for both senders (via `WaitGroup`) and then closes, or you avoid double-write by using a single closer. That pattern is covered at the middle level.

### Model 8: "Channels are not cancellation primitives, but they imitate them perfectly"

Strictly speaking, channels are communication primitives. They do not have "cancel" or "shutdown" as semantic operations. But `close` combined with `select` recovers cancellation semantics cleanly. This is one of the design wins of Go: a single primitive (the channel) plays many roles by combining well with `select`.

---

## Style notes for junior pipeline code

A handful of small style choices make cancellation paths legible.

### Put `ctx` first, always

```go
func Stage(ctx context.Context, in <-chan T, opts Opts) <-chan U
```

Not after `in`. Not in `Opts`. The first parameter. Linters enforce this.

### Use `defer` for symmetry

Every channel created in a stage is closed in `defer`. Every context created with `WithCancel` is cancelled in `defer`. The visual symmetry helps reviewers spot omissions.

### Name your stages

A stage function called `stage1` tells you nothing. A stage called `normaliseWords` tells you what it does. The cancellation path is the same; the readability is much better.

### Document the close path

A short comment at the top of a stage that says "exits when `in` closes or `ctx` cancels; closes `out` on exit" is gold for the next reader.

```go
// square reads ints from in and emits their squares on the returned channel.
// It exits when in is closed or ctx is cancelled, closing its output.
func square(ctx context.Context, in <-chan int) <-chan int { ... }
```

### Avoid embedding `select` four levels deep

If a stage needs more than two nested selects, refactor. Pull the inner block into a helper. The cancellation path should be visible at the top level of the function.

### Use `context.TODO()` while sketching, replace before committing

`TODO` is a flag that says "I have not figured out the context plumbing yet." Linters can be configured to warn on `TODO` in non-test code. Use it while exploring; replace with the real context before merging.

---

## A long walkthrough: cancellation across three goroutines

Let me show a complete script — producer, transformer, consumer — and trace what happens at each step.

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

// Stage 1: produce numbers forever.
func produce(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        defer fmt.Println("producer exit")
        for i := 0; ; i++ {
            select {
            case out <- i:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

// Stage 2: double them.
func double(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        defer fmt.Println("doubler exit")
        for v := range in {
            select {
            case out <- v * 2:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

// Stage 3: print them, exit on parameter `limit`.
func consume(ctx context.Context, cancel context.CancelFunc, in <-chan int, limit int, wg *sync.WaitGroup) {
    defer wg.Done()
    defer fmt.Println("consumer exit")
    count := 0
    for v := range in {
        fmt.Println(v)
        count++
        if count == limit {
            cancel()
            // drain so upstream can exit cleanly
            continue
        }
    }
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    var wg sync.WaitGroup
    wg.Add(1)
    go consume(ctx, cancel, double(ctx, produce(ctx)), 5, &wg)
    wg.Wait()
    fmt.Println("main exit")
}
```

### Trace

1. `main` creates `ctx`, `cancel`.
2. `produce(ctx)` returns a channel. A goroutine starts looping `select` on `out <- i` and `ctx.Done()`.
3. `double(ctx, in)` returns a channel. Another goroutine starts ranging `in`.
4. `consume(ctx, ..., in, 5, ...)` runs on its own goroutine (started inside `go consume(...)`).
5. Numbers 0, 2, 4, 6, 8 print (produced as 0, 1, 2, 3, 4; doubled to 0, 2, 4, 6, 8).
6. After printing `8`, `count == 5`; the consumer calls `cancel()`. `ctx.Done()` closes.
7. The consumer's `continue` keeps the range running. The doubler may have one value in flight; it tries to send. The consumer reads it (the drain). The doubler then re-enters its `select`, sees `<-ctx.Done()`, returns. `close(out_double)` runs.
8. Meanwhile the producer may have a value in flight too. The doubler had read it; the doubler now sees ctx.Done(), but it does not try to send a new value — it returns. Its `close(out)` runs.
9. The consumer's `range` ends because `out_double` is closed.
10. `consume` returns. `wg.Wait()` unblocks. `main` returns.

The four prints we expect to see:

```
0
2
4
6
8
doubler exit
producer exit
consumer exit
main exit
```

(Or "producer exit" may come before "doubler exit"; order depends on scheduling.)

### What if we had `return` instead of `continue` in the consumer?

```go
if count == limit {
    cancel()
    return // <- WRONG
}
```

The consumer leaves the for loop without draining. The doubler is in the middle of sending; the send blocks. The producer is in the middle of sending to the doubler's input; that send blocks. Both goroutines are wedged. With `cancel()` already fired, the `select { case out <- v: case <-ctx.Done(): }` eventually picks the cancel case on the next try, but only after the consumer continues reading. If the consumer returned, no one is reading. The pair is deadlocked until the program exits.

The fix is what we did: `continue` past the trigger, let the range exhaust naturally, then exit.

### Variant: instead of draining, use a tiny goroutine

```go
if count == limit {
    cancel()
    go func() {
        for range in {
        }
    }()
    return
}
```

This is the same as draining in-line but lets the consumer return immediately. The drain goroutine is short-lived: it reads remaining values until the doubler exits and closes its output.

Either form works. In real code the inline drain is more common because it requires fewer goroutines and the cleanup is visible at the call site.

---

## How `context.WithTimeout` actually works

A short look behind the curtain. `WithTimeout(parent, d)` is implemented in terms of `WithDeadline(parent, time.Now().Add(d))`, which in turn:

1. Creates a `timerCtx` that embeds a `cancelCtx`.
2. Records the deadline.
3. Schedules a `time.AfterFunc(d, func() { c.cancel(true, DeadlineExceeded, ...) })`.
4. Returns the `timerCtx` and a `cancel` function that stops the timer and cancels the context.

The timer is the source of automatic cancellation. The `cancel` function lets you stop it early. If you forget to call `cancel`, the timer is alive until it fires — that is what `defer cancel()` prevents.

`time.AfterFunc` schedules a callback to run on the runtime's timer wheel. The cost is small but non-zero: every active deadline-context costs a slot in the wheel and a small struct. For most apps this is invisible; for an app with a million pending deadlines it is something to measure.

---

## How `signal.NotifyContext` works

`signal.NotifyContext(parent, signals...)` returns a context that is cancelled when any of `signals` is received. Implementation:

1. Wrap `parent` in `WithCancel` to get `ctx` and `cancel`.
2. Register a Go channel to receive the listed signals (`signal.Notify`).
3. Start a small goroutine that waits on the signal channel or on `parent.Done()`, then calls `cancel()`.
4. Return `ctx, cancel`.

This is essentially the pattern from Recipe 7 (combine cancellation sources). The standard library wraps it so you do not have to.

A subtle point: signals are delivered to the program globally, not to a specific goroutine. If multiple `NotifyContext`s register for the same signal, they all receive it. The combination of `signal.Reset` and `signal.Stop` controls registration explicitly. For most apps, one `NotifyContext` at the top of `main` is enough.

---

## Cancellation latency in practice

A practical question: when you call `cancel()`, how long until the pipeline is fully shut down? Let me give realistic ranges.

- For a pipeline where each stage selects on `ctx.Done()` and does a few hundred nanoseconds of work per item, the latency is **single-digit microseconds**.
- For a pipeline doing 1 ms of work per item without inner-loop polls, the latency is up to **1 ms per stage**.
- For a pipeline doing 100 ms blocking I/O without context-aware drivers, the latency is **100 ms per stage**, or worse — the blocking I/O may complete before cancellation is seen.
- For a pipeline that uses `db.Query` without `Context`, the latency is **the full query duration**, regardless of context.

The single biggest win for cancellation latency is to thread `ctx` through to every I/O call. `db.QueryContext`, `http.NewRequestWithContext`, `net.Dialer.DialContext` — all the major drivers expose context-aware variants. Use them. Without them, your "cancellable" pipeline is only cancellable in name.

A second win: in any tight inner loop that processes work, poll `ctx.Err()`. The cost is one atomic load; the benefit is the work becomes cancellable mid-iteration.

A third win: keep buffers small. A 100-element buffer in front of a slow consumer means the producer may produce up to 100 more items after cancellation, all of which are wasted work.

---

## Compounding effect: many small leaks

A single leaked goroutine wastes a few kilobytes. A single leaked pipeline wastes whatever resources the pipeline held — a database connection, a TCP socket, a file handle. The damage is not in one leak but in the rate at which they accumulate.

Consider a server doing 1000 requests per second. Each request runs a pipeline of 3 stages. If even 1 in 100 requests leaks one stage:

```
1000 req/s * 3 stages/req * 0.01 leak rate = 30 leaked goroutines/sec
```

After an hour: 108 000 goroutines. After a day: 2.6 million. The memory footprint creeps up, the scheduler does more work, GC pauses lengthen. The error becomes visible only when an alert fires or the process is OOM-killed.

The reason cancellation propagation is treated as production-critical and not as "advanced" is exactly this. Even a 1% leak rate is unsustainable. The discipline must be 0%. The way to achieve 0% is to make every blocking channel op cancellable, every output close in `defer`, every cancel `defer`-ed. Once you internalise the templates, you stop writing leaks.

This is why senior code review focuses heavily on cancellation paths. The bug is rarely "this stage does the wrong thing"; it is almost always "this stage does not exit when it should."

---

## A close look at `context.Background()`

You have used `context.Background()` already, but it is worth seeing what it actually returns. The standard library defines it as a value of type `emptyCtx`, whose `Done()` returns `nil`, `Err()` returns `nil`, and `Value()` returns `nil`. It is the "empty" context: never cancelled, no deadline, no values.

Because `Done()` is `nil`, a `select` case `case <-ctx.Done():` on a `Background` context never fires. That is correct: the case is effectively disabled. If you put `<-ctx.Done()` outside a `select`, on a `Background` context, you block forever.

This is also why `context.TODO()` exists. Operationally it is the same as `Background`, but it documents "I have not figured out which context belongs here yet." Tools like `staticcheck` flag `TODO` in production code so you remember to replace it.

Every other context derives from `Background` by `WithCancel`, `WithDeadline`, `WithTimeout`, `WithValue`, or `WithCancelCause`. The tree is rooted at `Background`.

---

## The done-channel vs context decision

For junior code, when should you use a manual done channel versus `context.Context`?

**Use `context.Context` when:**

- The pipeline crosses a package boundary or a public API.
- The pipeline might use libraries (DB, HTTP, RPC) that already accept `Context`.
- You need deadlines or timeouts.
- You want request-scoped values (trace IDs, user IDs).

**Use a manual done channel when:**

- The whole pipeline is in a single private function with no public surface.
- You are writing a self-contained example or test.
- You want to avoid the `context` import for a tiny utility.

In practice, "almost always use `context`" is the right answer in production code. The done-channel form is mostly a teaching tool to show that there is no magic — `context.Done()` *is* a done channel — and an emergency fallback when you cannot thread a context through (rare).

The one place a done channel is still common: internal state machines that already have a "stop" signal and do not benefit from `context`'s richer features. For example, a worker pool with its own shutdown mechanism may use `chan struct{}` for internal stop signalling and accept `ctx` from the outside.

---

## Beyond the basic template: shape variations you will encounter

The "select on receive, do work, select on send" template is the canonical shape, but real code has variations. Recognising them helps you read existing code and write your own.

### Variation A: producer with internal source loop

```go
func source(ctx context.Context) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        ticker := time.NewTicker(100 * time.Millisecond)
        defer ticker.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case t := <-ticker.C:
                ev := Event{At: t}
                select {
                case out <- ev:
                case <-ctx.Done():
                    return
                }
            }
        }
    }()
    return out
}
```

Two-level `select`: outer chooses between cancellation and tick; inner guards the send. Each level returns on cancellation. The `ticker.Stop()` is in `defer`, so the timer is cleaned up regardless of how we exit.

### Variation B: stage with batch processing

```go
func batch(ctx context.Context, in <-chan int, size int) <-chan []int {
    out := make(chan []int)
    go func() {
        defer close(out)
        buf := make([]int, 0, size)
        flush := func() bool {
            if len(buf) == 0 {
                return true
            }
            select {
            case out <- buf:
                buf = make([]int, 0, size)
                return true
            case <-ctx.Done():
                return false
            }
        }
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-in:
                if !ok {
                    flush()
                    return
                }
                buf = append(buf, v)
                if len(buf) == size && !flush() {
                    return
                }
            }
        }
    }()
    return out
}
```

This stage accumulates items into a slice and emits the slice when full. Cancellation can fire while there are buffered items; the design chooses to silently drop them (the `!flush()` branch returns without emitting). If your application wanted to deliver the last batch, you would `flush()` before the cancellation-driven return. The choice is application-specific.

### Variation C: stage with periodic flush

A stage that emits accumulated work either when the batch is full or when a tick passes:

```go
func periodicBatch(ctx context.Context, in <-chan int, size int, interval time.Duration) <-chan []int {
    out := make(chan []int)
    go func() {
        defer close(out)
        buf := make([]int, 0, size)
        timer := time.NewTimer(interval)
        defer timer.Stop()
        flush := func() {
            if len(buf) == 0 {
                return
            }
            select {
            case out <- buf:
                buf = make([]int, 0, size)
            case <-ctx.Done():
            }
        }
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-in:
                if !ok {
                    flush()
                    return
                }
                buf = append(buf, v)
                if len(buf) == size {
                    flush()
                    timer.Reset(interval)
                }
            case <-timer.C:
                flush()
                timer.Reset(interval)
            }
        }
    }()
    return out
}
```

Three-way `select`: cancel, input, timer. All three lead to coherent behaviour. The pattern shows up in metrics emitters, log buffers, and message batchers.

### Variation D: stage that does fan-out internally

The stage launches sub-goroutines for parallel work but exposes a single output channel:

```go
func parallelMap(ctx context.Context, in <-chan int, workers int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                r := expensive(v)
                select {
                case out <- r:
                case <-ctx.Done():
                    return
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

func expensive(int) int { return 0 }
```

`workers` goroutines each run the template. A separate "closer" goroutine waits for all workers and closes the output. This is the standard fan-out-then-merge shape, covered in detail at middle level.

### Variation E: stage that fans in multiple inputs

```go
func merge(ctx context.Context, ins ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(ins))
    for _, in := range ins {
        go func(in <-chan int) {
            defer wg.Done()
            for v := range in {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }(in)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

Each input has its own goroutine forwarding to `out`. The closer waits for all of them. Cancellation reaches each forwarder via its `select`.

These shapes — single, batch, periodic, fan-out, fan-in — cover the vast majority of pipeline stages in real code. They share the same skeleton: every block point in `select`, every output closed in `defer`, every cancel `defer`-ed.

---

## Reading the `context` package source

A short tour of the standard library will solidify the model. The `context` package source is at `src/context/context.go`. The essential parts:

```go
// Context is the interface.
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}

// emptyCtx is the type of Background and TODO.
type emptyCtx struct{}

func (emptyCtx) Deadline() (time.Time, bool) { return time.Time{}, false }
func (emptyCtx) Done() <-chan struct{}        { return nil }
func (emptyCtx) Err() error                   { return nil }
func (emptyCtx) Value(any) any                { return nil }

// cancelCtx is the type returned by WithCancel.
type cancelCtx struct {
    Context
    mu       sync.Mutex
    done     atomic.Value // chan struct{}, closed on cancel
    children map[canceler]struct{}
    err      error
}

func (c *cancelCtx) cancel(removeFromParent bool, err, cause error) {
    c.mu.Lock()
    if c.err != nil {
        c.mu.Unlock()
        return // already cancelled
    }
    c.err = err
    d, _ := c.done.Load().(chan struct{})
    if d == nil {
        c.done.Store(closedchan)
    } else {
        close(d)
    }
    for child := range c.children {
        child.cancel(false, err, cause)
    }
    c.children = nil
    c.mu.Unlock()
    if removeFromParent {
        removeChild(c.Context, c)
    }
}
```

The pattern: a single mutex protects the err field and the children map. On cancel, it sets the error, closes the done channel (which broadcasts), and recursively cancels children. Future calls to `Done()` return a closed channel; `Err()` returns the recorded error. The cancellation is permanent — there is no path back.

What the source tells you:

1. Cancellation cascades down the tree by direct recursion.
2. The done channel is a single object per context — every `ctx.Done()` returns the same channel.
3. Repeated cancels are a no-op (the `if c.err != nil` guard).
4. After cancel, the children map is cleared — descendants are responsible for releasing themselves.

This matches the mental model exactly: close a single channel, broadcast to readers, cascade to children.

---

## A note on `errgroup` (preview)

The middle level covers `errgroup.Group` in depth. As a junior, you should know it exists and that it combines cancellation with error propagation:

```go
import "golang.org/x/sync/errgroup"

g, ctx := errgroup.WithContext(parentCtx)
g.Go(func() error { return stageA(ctx) })
g.Go(func() error { return stageB(ctx) })
err := g.Wait()
```

`errgroup.WithContext` returns a `ctx` that is cancelled when any `g.Go` returns a non-nil error. So one failing stage cancels the others through the shared context. `g.Wait()` returns the first error (or nil if all succeed).

This is the answer to "how do I cancel siblings when one of them fails?" for almost every real pipeline. You will use it constantly at middle and above. For now, recognise the shape: it is a `WaitGroup` plus an internal `cancel` call on the first error.

---

## Worked example: a graceful HTTP server with a pipeline

Putting it all together: a server that handles requests by running a small pipeline, all cancellable on `SIGTERM`.

```go
package main

import (
    "context"
    "fmt"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func produce(ctx context.Context, n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            select {
            case out <- i:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func square(ctx context.Context, in <-chan int) <-chan int {
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

func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    for v := range square(ctx, produce(ctx, 100)) {
        if _, err := fmt.Fprintln(w, v); err != nil {
            return
        }
    }
}

func main() {
    rootCtx, cancel := signal.NotifyContext(context.Background(),
        os.Interrupt, syscall.SIGTERM)
    defer cancel()

    srv := &http.Server{
        Addr:    ":8080",
        Handler: http.HandlerFunc(handler),
        BaseContext: func(net.Listener) context.Context {
            return rootCtx
        },
    }

    go func() {
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            fmt.Println("server:", err)
        }
    }()

    <-rootCtx.Done()
    shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer shutdownCancel()
    srv.Shutdown(shutdownCtx)
}
```

Three forms of cancellation cooperate here:

1. The per-request context (`r.Context()`) — fires when the client disconnects, propagating through the pipeline.
2. The root context (`rootCtx`) — fires on `SIGTERM`, wired into every request via `BaseContext`.
3. The shutdown context (`shutdownCtx`) — gives the server 30 seconds to drain in-flight requests.

This is the full toolkit at junior level. Middle level deepens it with `errgroup`, fan-out cancellation, and structured shutdown protocols.

---

## Diagrams & Visual Aids

### Pipeline with cancellation wire

```
   +-----------+    in    +----------+    out   +-----------+
   | producer  | -------> |  square  | -------> | consumer  |
   +-----------+          +----------+          +-----------+
        |                      |                       |
        +----[ctx.Done()]------+-----[ctx.Done()]------+
                              |
                         cancel()
```

### Lifecycle of a cancellable stage

```
   start --> loop:
                select {
                    <-ctx.Done() ----> close(out); return
                    v, ok := <-in:
                        if !ok ----> close(out); return
                        do work
                        select {
                            out <- result: ---> loop
                            <-ctx.Done(): ----> close(out); return
                        }
                }
```

### Closing the done channel broadcasts

```
   done (open)        +--- stage A blocked on <-done
                      +--- stage B blocked on <-done
                      +--- stage C blocked on <-done

   close(done)        all three unblock simultaneously
```

### Context tree

```
        Background
            |
       WithTimeout (30s)
        /          \
   WithCancel    WithCancel
   pipeline A    pipeline B
     /   \
  stage  stage
   1      2
```

Cancelling `WithTimeout` cancels both pipelines and all their stages.

### Upstream vs downstream cancellation flow

```
   Downstream cancellation:
       producer ---> stage ---> consumer
                                    |
                                    v cancel()
                       <-ctx.Done()-+
       Everything upstream sees ctx.Done(), exits, closes outputs.

   Upstream cancellation:
       producer ---> stage ---> consumer
           |
           v cancel()  (e.g. source error)
       Everything downstream sees ctx.Done() OR ends when its input closes.
```

Either direction is the same physical wire — `ctx.Done()`. The difference is who pulls it.

### Cancellation timing

```
   t0    cancel() called
   t0+   ctx.Done() closes
   t1    stage A loops back to select, sees ctx.Done(), returns
   t1+   defer close(out_A) fires
   t2    stage B sees out_A closed in range, exits
   t2+   defer close(out_B) fires
   t3    consumer ranges past last value, returns

   Latency:  t0 -> t1   == time to finish current per-item work
             t0 -> t3   == sum over all stages
```

For tight pipelines, total cancellation latency is microseconds. For pipelines with heavy per-item work, it depends on how often the work polls `ctx.Err()`.

### Stage exit paths

```
   start
     |
     v
   loop:  ----> input closed?  ---yes---> close(out); return
     |                                       |
     v                                       v
     receive guarded by select         normal completion
     |                                       |
     v                                       |
     work                                    |
     |                                       |
     v                                       |
     send guarded by select <-----------------+
     |
     v
     ctx.Done() fires? ---yes---> close(out); return
                                     |
                                     v
                                  cancelled exit
```

Two exits, both end with `defer close(out)`. The pipeline drains naturally afterwards.

### Memory and lifetime

```
  goroutine
    |   |---- stack (~2 KB)
    |   |---- closure captures (ctx, in, out)
    |   |
    +-- ctx       
        |---- Done() channel
        |---- internal timer (for WithTimeout)
        |---- parent pointer (for tree)
```

A cancelled context releases its internal resources. A live context with a timer keeps the timer until `cancel()`. Hence `defer cancel()`.

### One picture of the whole protocol

```
   +---------+  ctx  +---------+  ctx  +---------+
   | stage 1 |------>| stage 2 |------>| stage 3 |
   +---------+       +---------+       +---------+
        ^                 ^                 ^
        |                 |                 |
        +--- ctx.Done() (shared close) -----+
                          |
                       cancel()
                          ^
                          |
                  (deadline, signal,
                   error, or manual)
```

Three stages, one wire, one switch. That is cancellation propagation at the junior level.

