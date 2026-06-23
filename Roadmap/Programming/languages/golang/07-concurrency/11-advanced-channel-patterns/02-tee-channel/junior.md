# Tee-Channel — Junior Level

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
> Focus: "I have one channel and two consumers. How do I give both of them every value, without the slow one freezing the fast one?"

The **tee-channel** pattern duplicates a stream. One input channel goes in; two output channels come out. Every value sent to the input appears on both outputs, in the same order. The name comes from the Unix `tee` command, which forks standard input into a file *and* standard output at the same time.

A tiny example sketches the shape:

```go
in := producer()                // <-chan int
a, b := tee(done, in)           // two <-chan int

go consume("logger", a)
go consume("processor", b)
```

Both consumers receive every value from `in`. Neither sees a subset; neither sees a copy that drifts out of sync. The two outputs are *the same stream, twice*.

This file answers the questions a junior Go developer faces the first time they need this:

- Why can't I just `range` over the same channel from two places?
- Why does sending to two channels in a loop deadlock or stall?
- What is the "nil-channel-after-send" trick I keep hearing about?
- How is this different from fan-out, which I have already learned?
- How is this different from a full pub/sub broadcast?

After reading you will be able to write `tee` from scratch, explain when to use it, and recognise the bug pattern of "I read the channel twice and lost half the values."

Tee is the second member of the *channel combinator* family. The first was [or-done-channel](../01-or-done-channel/junior.md). The next will be [bridge-channel](../03-bridge-channel/junior.md). Each combinator is small. Together they make pipelines composable.

---

## Prerequisites

- **Required:** You can write `go f()`, `make(chan int)`, and `for v := range ch`.
- **Required:** You understand channel close: who closes, how a receiver detects close with the `v, ok := <-ch` two-value form.
- **Required:** You can write a `select` statement with two cases.
- **Required:** You have read or covered [01-or-done-channel/junior.md](../01-or-done-channel/junior.md). The `done` channel idiom carries over.
- **Helpful:** Familiarity with fan-out and fan-in from [05-concurrency-patterns/02-fan-out](../../05-concurrency-patterns/02-fan-out/). Knowing that fan-out *partitions* a stream will make the contrast clearer.
- **Helpful:** Awareness of the Unix `tee` command. `echo hello | tee file.txt` writes `hello` to both the screen and `file.txt`. We are doing exactly that, in goroutines, with channels.
- **Helpful:** Generics (Go 1.18+). Our final implementation uses `[T any]`.

If `go run` works for you and you can already write a pipeline of two stages, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Tee** | A pattern that takes one input channel and produces two output channels, each receiving every value from the input. |
| **Stream duplication** | Producing two copies of an ordered sequence of values, so that two consumers can read independently. Tee is the channel-shaped version of this idea. |
| **Broadcast** | A pattern in which one publisher delivers each value to N subscribers. Tee is broadcast with N fixed at 2; a broadcast hub allows dynamic N. |
| **Fan-out** | A pattern in which one input is *split* across N workers, each worker receiving a *subset*. Different from tee, which gives every worker the *full set*. |
| **Backpressure** | A property of a pipeline in which a slow consumer slows the producer down. Tee preserves backpressure by sending to both outputs before reading the next input. |
| **`nil` channel** | A channel value that is uninitialised (the zero value for `chan T`). Sending to or receiving from a `nil` channel blocks forever. In a `select`, a `nil` case is *disabled*. |
| **Done channel** | A `chan struct{}` (or `<-chan struct{}`) closed by the caller to signal "stop". The tee goroutine selects on it to exit promptly. |
| **Combinator** | A small reusable function that takes channels and returns channels, composing transformations on streams. `or-done`, `tee`, `bridge`, and `or` are the four classic combinators. |
| **Lossy variant** | A version of tee that drops a value to one output if that output is not ready, instead of blocking. Trades correctness for liveness. |
| **Asymmetric tee** | A tee in which one output is buffered (or lossy) and the other is not, used when the two consumers have different latency profiles. |

---

## Core Concepts

### One reader, one channel, one path through it

A Go channel is **not** a list you can iterate twice. Every value sent into a channel is received exactly once by exactly one receiver. If you `range` over the same channel from two goroutines, the values are *split* between them — that is fan-out, not duplication.

```go
// THIS IS NOT TEE — this is fan-out.
in := producer()
go func() { for v := range in { logger(v) } }()
go func() { for v := range in { processor(v) } }()
```

Half the values go to `logger`, half to `processor`, and which half is up to the scheduler. If you wanted both consumers to see every value, this code silently destroys your stream.

The lesson: **to duplicate, someone must explicitly send to two channels.** The question is *who* and *how*.

### The naive "send to both" loop

The obvious first try:

```go
func teeNaive(in <-chan int) (<-chan int, <-chan int) {
    a := make(chan int)
    b := make(chan int)
    go func() {
        defer close(a)
        defer close(b)
        for v := range in {
            a <- v
            b <- v
        }
    }()
    return a, b
}
```

This is correct in the sense that every value reaches both outputs. It is also *fragile*. The two sends are sequential: the goroutine sends to `a`, waits for `a`'s consumer, then sends to `b`, waits for `b`'s consumer, then loops. If consumer `a` is slow, consumer `b` waits behind it even though `b`'s value is already prepared.

That ordering bias is acceptable in many cases (more on this later). The real problem appears when we add `done`: with sequential sends, the goroutine cannot react to cancellation between the two sends without growing increasingly tangled. We want one place — a `select` — that picks whichever send is ready first.

### The nil-channel-after-send trick

This is the *single most important* idea in this file.

In a `select`, a `case` whose channel is `nil` is **disabled**. The runtime never picks it. By setting one of the output channels to `nil` after we successfully send on it, we tell the next iteration of `select` "stop offering this case." A second iteration then sends only on the other output. After the second send, both have been delivered, and we move on.

```go
func tee(done <-chan struct{}, in <-chan int) (<-chan int, <-chan int) {
    out1 := make(chan int)
    out2 := make(chan int)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            // Local aliases that we will nil-out as we send.
            var a, b chan int = out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-done:
                    return
                case a <- v:
                    a = nil   // disable this case next iteration
                case b <- v:
                    b = nil
                }
            }
        }
    }()
    return out1, out2
}
```

Walk through one value `v`:

- First iteration: both `a` and `b` are valid. Whichever consumer is ready first wins. Say `a`. We send `v` on `a`. Then we set `a = nil`.
- Second iteration: `a` is now `nil`. That case is disabled. Only `b <- v` and `<-done` remain. We wait for `b`'s consumer to receive. Done.

Two sends, no ordering bias — whichever is ready first goes first. Cancellation via `done` is checked at every iteration. The whole thing is twelve lines.

This trick — *nil out a channel inside a `select` to mark "I'm finished with this case"* — appears throughout Go's concurrency vocabulary. Memorise it. You will use it in `bridge`, in worker shutdown, in pause/resume patterns, in priority selection.

### Why we use generics in the real version

The integer example is for clarity. In a real codebase you want one tee that works for any payload:

```go
func Tee[T any](done <-chan struct{}, in <-chan T) (<-chan T, <-chan T) {
    out1, out2 := make(chan T), make(chan T)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            var a, b chan T = out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-done:
                    return
                case a <- v:
                    a = nil
                case b <- v:
                    b = nil
                }
            }
        }
    }()
    return out1, out2
}
```

Generics let `Tee` work for `chan int`, `chan Event`, `chan []byte`, anything. Pre-1.18 code repeats this scaffolding per type or uses `interface{}` with type assertions; both are uglier.

### Closing semantics

When `in` is closed, the `for v := range in` loop exits. The two `defer close(...)` statements then close `out1` and `out2`. Both consumers see EOF on their respective ranges. Clean shutdown.

When `done` is closed, the goroutine returns *immediately* — possibly leaving the current value undelivered. The two `defer close(...)` still fire, so consumers also see EOF. They may have received one fewer value than the producer sent. That is the cancellation contract: cancellation is allowed to drop in-flight work.

A producer that wants "deliver everything, then stop" should close `in` itself, not signal `done`.

### Backpressure is intentional

A tee that respects backpressure is one in which **the producer cannot get ahead of the slowest consumer**. Our implementation respects it: until both outputs have received `v`, the next iteration of `for v := range in` cannot start. That is good. It means the channel buffer up the chain does not balloon under a slow consumer.

If one consumer is consistently slow, the *whole pipeline* slows to match. That is by design. The cure for "I have one fast consumer and one slow consumer that should not block each other" is **not** tee; it is a buffered tee or a broadcast hub with drop-on-overflow. We cover those at middle and senior level. At junior level, embrace backpressure as a feature.

### Capacity and buffering

The simple tee uses unbuffered output channels. If you want one path to have a small burst tolerance, you can buffer it:

```go
out1 := make(chan T, 8) // burst-tolerant
out2 := make(chan T)    // strict
```

The tee body does not change. The unbuffered side still paces the producer; the buffered side absorbs short stalls. This is the *asymmetric* variant.

---

## Real-World Analogies

### The Unix `tee` command

The pattern's namesake. The Unix command:

```bash
echo "hello" | tee output.txt
```

reads a line from standard input and writes it to **both** a file (`output.txt`) and standard output. You see it on the terminal and you have it on disk. One source, two sinks, same content.

Pipeline form makes the analogy direct:

```bash
make build 2>&1 | tee build.log | grep error
```

`tee` duplicates `make`'s output to `build.log` *and* into the next stage of the pipeline. Our Go `tee` does the same with goroutines instead of file descriptors.

### Photocopying a memo

Imagine a manager with a memo to distribute to two departments. She does not have two copies; she has one. So she photocopies it — produces two identical copies — and hands one to each department head. The original memo (the input channel value) yields two outputs.

The two department heads then read at their own pace. Importantly, the manager does not start the next memo until *both* copies are accepted. If accounting is slow today, marketing waits too. That's backpressure in human form.

### A T-pipe in plumbing

In plumbing, a T-pipe is a fitting with one inlet and two outlets. Water enters from one side and flows out of both. If you close a valve on one outlet, water builds up — eventually the inlet can't accept more. That's backpressure: closing one consumer's path stalls the whole flow.

A tee-channel is a T-pipe for data. The two outlets are independent consumers; the inlet is the producer; flow stops if either outlet is blocked.

### Live TV broadcast to two rooms

A single live TV feed goes to two rooms. If you pause the feed for room A, room B also stops — because there's only one feed. That's our tee. If instead each room had its own DVR buffering the feed, slow room A would not slow room B — but each room is buffering for itself, which is now a buffered tee. The infrastructure choice matches the requirements.

### Carbon copy on a letter

In the era before scanners, you typed a letter on a typewriter with carbon paper underneath. Each keystroke produced both the original and the carbon copy *simultaneously*. The carbon copy was an exact replica — same words, same order. Tee is the digital equivalent: each value, when emitted, produces both copies in lockstep.

---

## Mental Models

### One pump, two valves

Picture a hand-operated pump. Each pump stroke pushes water into a manifold with two outlet valves. You pump once and both valves get the same pulse. If either valve is closed, the manifold pressure rises and the pump becomes hard to push. That is the producer-side feedback of tee.

### Two for the price of one

For every `recv` from `in`, the tee performs *two* `send`s. The throughput of the tee is bounded by `1 / max(send-time-on-out1, send-time-on-out2)`. If both consumers are equally fast, tee adds negligible overhead. If one is ten times slower, the tee runs at the slower pace.

### The `select` as a fair arbiter

`select` picks a ready case uniformly at random when more than one is ready. Combined with the nil-after-send trick, this means whichever consumer is faster on a given iteration gets the value first. There is no fixed priority between `out1` and `out2`. Over many values, the average load on both consumers' receive-side is the same.

### A pipeline stage with one in, two out

In the stream-processing literature, a stage with one input and one output is a *transform*. A stage with one input and many outputs is a *splitter*. Tee is a splitter where the splitting rule is "every output gets every value." Mentally place it next to *map*, *filter*, *fan-out* on the bestiary of pipeline stages.

### A goroutine you do not see

The caller writes `a, b := tee(done, in)` and moves on. The fact that there is an internal goroutine driving the duplication is hidden. As a junior, get used to this style: combinators that look like pure functions but quietly spawn goroutines. Always ask: *who owns the goroutine? when does it exit?* For tee the answer is: it exits when `in` closes or `done` closes, whichever first. If neither happens, the goroutine leaks.

---

## Pros & Cons

### Pros

- **Tiny and reusable.** A correct generic tee is ~15 lines. Drop it into any pipeline.
- **Composable.** Works with `or-done`, `bridge`, `errgroup`, and any other channel-shaped stage.
- **Preserves backpressure.** No hidden buffering, no silent drops in the default form.
- **No locks.** All synchronisation is through channels — no `sync.Mutex`, no `sync.Map`.
- **Order-preserving.** Each output sees values in the same order as the input.

### Cons

- **N is fixed at two.** Need three consumers? Either chain two tees (`a, b := tee(in); c, d := tee(b)`) or use a broadcast hub. Chaining adds latency and complexity; a hub is the cleaner answer past N=3.
- **Slow consumer slows producer.** This is a feature *and* a footgun. If you do not want it, you need a buffered or lossy variant.
- **One goroutine per tee.** Cheap but not free. A pipeline of 50 tees costs 50 goroutines.
- **Cancellation drops in-flight values.** If `done` fires between the two sends, only one output saw `v`. Consumers see different counts. Idempotent consumers do not care; non-idempotent ones might.
- **Not a substitute for pub/sub.** No topics, no dynamic subscribe/unsubscribe, no per-subscriber buffering policy. Tee is a primitive, not a framework.

---

## Use Cases

### Logging alongside processing

A request stream feeds a business pipeline. Operations wants every request also written to a structured log for audit. Tee fits:

```go
requests := source()
toLog, toBiz := Tee(done, requests)
go writeAudit(toLog)
go processBusiness(toBiz)
```

Audit is allowed to be the bottleneck during incidents — that is correct. If you cannot persist the audit trail, you must not silently drop requests; you must apply backpressure to the producer. Tee gives you that for free.

### Tracing alongside business logic

A streaming RPC server processes messages. Tracing wants a copy of every message envelope. The trace exporter can be slow during certain windows; you want the server's processing speed to reflect that pressure, so the upstream client throttles itself. Tee preserves the linkage.

### Metric extraction

A stream of events feeds both a counter aggregator (cheap) and a downstream processor (heavy). Both want every event, neither wants to lose any. Tee them.

### Mirror traffic for shadow tests

You are testing a new version of a service. Real production traffic flows to the old service; you also want to send a copy to the new service to compare behaviour. Tee the request channel; one branch goes to old, one to new. (Production-ready mirror traffic usually wants the *lossy* asymmetric variant — middle level covers it.)

### Branching off for transformation comparison

You want to compare two implementations of the same transform on the same stream. Tee gives both implementations identical input. After the tee, you fan-in their outputs and compare.

### Forking a generator

A test fixture generator emits values. Two test goroutines each need the full sequence. Tee the generator's output.

### Where tee is the *wrong* tool

- **More than three consumers.** Use a broadcast hub. Chaining tees becomes a binary tree.
- **Dynamic subscription.** Tee's two outputs are fixed at creation. If consumers join and leave at runtime, use a hub.
- **Independent failure tolerance.** If one consumer crashing must not affect the other, tee's backpressure couples them. You need a hub with per-subscriber drop policy.

---

## Code Examples

### Example 1: A complete runnable tee

```go
package main

import (
    "fmt"
    "time"
)

func produce(done <-chan struct{}) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 1; i <= 5; i++ {
            select {
            case <-done:
                return
            case out <- i:
            }
        }
    }()
    return out
}

func Tee[T any](done <-chan struct{}, in <-chan T) (<-chan T, <-chan T) {
    out1, out2 := make(chan T), make(chan T)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            var a, b chan T = out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-done:
                    return
                case a <- v:
                    a = nil
                case b <- v:
                    b = nil
                }
            }
        }
    }()
    return out1, out2
}

func main() {
    done := make(chan struct{})
    defer close(done)

    in := produce(done)
    out1, out2 := Tee(done, in)

    go func() {
        for v := range out1 {
            fmt.Println("consumer-1:", v)
        }
    }()

    for v := range out2 {
        fmt.Println("consumer-2:", v)
        time.Sleep(10 * time.Millisecond)
    }
}
```

Output (interleaving may vary slightly):
```
consumer-1: 1
consumer-2: 1
consumer-1: 2
consumer-2: 2
consumer-1: 3
consumer-2: 3
consumer-1: 4
consumer-2: 4
consumer-1: 5
consumer-2: 5
```

Each value appears exactly twice — once per consumer.

### Example 2: Tee paired with `or-done-channel`

Tee inside the goroutine selects on `done`; consumers outside can also use `orDone` to wrap their loops:

```go
func orDone[T any](done <-chan struct{}, c <-chan T) <-chan T {
    valStream := make(chan T)
    go func() {
        defer close(valStream)
        for {
            select {
            case <-done:
                return
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case valStream <- v:
                case <-done:
                    return
                }
            }
        }
    }()
    return valStream
}

func main() {
    done := make(chan struct{})
    defer close(done)
    in := produce(done)
    a, b := Tee(done, in)

    for v := range orDone(done, a) {
        _ = v // ...
    }
    for v := range orDone(done, b) {
        _ = v
    }
}
```

In practice you wrap each `range` with `orDone` so callers never write raw `for v := range ch` against a long-lived stream.

### Example 3: Asymmetric tee (one buffered side)

```go
func TeeAsym[T any](done <-chan struct{}, in <-chan T, buf int) (<-chan T, <-chan T) {
    out1 := make(chan T, buf) // burst-tolerant
    out2 := make(chan T)      // strict pacing
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            var a, b chan T = out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-done:
                    return
                case a <- v:
                    a = nil
                case b <- v:
                    b = nil
                }
            }
        }
    }()
    return out1, out2
}
```

The buffered side absorbs short stalls (size `buf`). The unbuffered side still applies backpressure. The body is unchanged — the difference is the channel creation.

### Example 4: Chaining tee to fan out to three

```go
in := producer()
a, rest := Tee(done, in)
b, c := Tee(done, rest)
// a, b, c each receive every value
```

This works for N=3, even N=4. Past that it becomes a tree you do not want to maintain — switch to a hub.

### Example 5: Tee with a transformation on one branch

```go
in := producer()
raw, alsoRaw := Tee(done, in)

// Transform the second branch into squared values.
squared := make(chan int)
go func() {
    defer close(squared)
    for v := range alsoRaw {
        select {
        case <-done:
            return
        case squared <- v * v:
        }
    }
}()

// raw and squared can now be consumed independently.
```

This shows that the "two outputs" need not stay parallel forever. They can diverge into different pipelines, each carrying every original value (or a derived form of it).

---

## Coding Patterns

### Always pass `done` first

```go
out1, out2 := Tee(done, in)
```

`done` as the first parameter mirrors how `context.Context` appears first in modern Go signatures. It is a hint to readers: this function spawns work that respects cancellation.

### Always close output channels in the goroutine

```go
go func() {
    defer close(out1)
    defer close(out2)
    ...
}()
```

Two `defer`s, one per output. They run even on early return from `done`. This guarantees consumers can `range` safely and will see EOF.

### Always check `done` before sending

The inner `select` includes `<-done`. Without it, the tee would block on a send to an output channel whose consumer has gone away.

### Use generics over `interface{}`

`func Tee[T any]` works for every payload type with no runtime cost. Pre-generics tee with `interface{}` forces type assertions on every value — verbose and error-prone.

### Name your outputs by purpose

```go
audit, business := Tee(done, requests)
```

Beats:

```go
out1, out2 := Tee(done, requests)
```

The reader of the next stage cares which branch is which.

---

## Clean Code

A clean `tee` package looks like this:

```go
// Package channels provides small combinators on channel streams.
package channels

// Tee duplicates each value from in onto two output channels.
// Both outputs receive every value in the same order.
// The internal goroutine returns when in is closed or done is closed,
// whichever happens first. Both output channels are closed on return.
//
// Backpressure: the slower consumer paces the producer.
func Tee[T any](done <-chan struct{}, in <-chan T) (<-chan T, <-chan T) {
    out1, out2 := make(chan T), make(chan T)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            a, b := out1, out2
            for range [2]struct{}{} {
                select {
                case <-done:
                    return
                case a <- v:
                    a = nil
                case b <- v:
                    b = nil
                }
            }
        }
    }()
    return out1, out2
}
```

Notes on style:
- Doc comment explains semantics, not implementation.
- `for range [2]struct{}{}` reads as "do twice" without an unused index variable.
- No log statements, no metrics, no panic recovery — combinators stay minimal.

---

## Product Use / Feature

Imagine you are shipping a feature where every customer event must be written to a Kafka topic *and* also processed in real time to update a search index. Two sinks, same stream.

Without tee, the team often writes:

```go
for event := range events {
    if err := kafka.Send(event); err != nil { return err }
    if err := index.Update(event); err != nil { return err }
}
```

This is fine *until* one of them blocks or you need to scale them independently. With tee:

```go
toKafka, toIndex := Tee(done, events)
go shipToKafka(toKafka)
go updateIndex(toIndex)
```

Now Kafka backpressure pauses the search-index path too, and vice versa, which is exactly the safety property you want during outages — neither sink silently lags behind the other. If you need independent slack, buffer each side.

This is *the* canonical example of where tee delivers value at the product level: dual-sink ingestion where atomicity across sinks is desired.

---

## Error Handling

`tee` itself produces no errors. It moves values; values move or they don't. The error model lives in the producer and the consumers.

Patterns:

1. **Errors as values on the stream.** Make the channel carry `Result[T]` with `Value` and `Err` fields. Tee then duplicates errors to both branches; each consumer decides what to do.
   ```go
   type Result[T any] struct {
       Value T
       Err   error
   }
   ```

2. **Errors via `errgroup`.** Producer and consumers are all `errgroup.Go(...)` tasks; the first error cancels the group. Tee receives the cancellation via `done` (or via context derived from the group).

3. **Errors on a side channel.** A separate `errCh` shared by producer and consumers. Tee does not touch it. Recommended only when error rate is very low.

The wrong choice is *panicking inside tee*. The goroutine has no way to recover usefully; let errors flow as data.

---

## Security Considerations

`tee` does not change the security properties of its stream. But two consumers means **two trust boundaries**. Things to think about:

- **Sensitive data exposure.** If the input stream contains tokens, PII, or secrets, the second consumer (often the "logger" or "audit") might write them to disk or stdout. Strip or hash sensitive fields *before* tee, or apply a transformation on the audit branch.
- **Differential resource limits.** If one branch is hostile (a third-party plugin, say), it can keep its receive slow on purpose and stall the whole pipeline. Use a *lossy* asymmetric tee so the trusted branch is never held hostage.
- **Channel value sharing.** If the payload is a pointer (`*Request`), both consumers see the *same* object. A consumer that mutates it affects the other. Either send copies, send by value, or document the contract.
- **Goroutine leakage.** A tee whose `done` is never closed and whose `in` never closes is a goroutine leak. In long-lived processes this is a DoS vector. Always wire `done` to a process-level shutdown.

---

## Performance Tips

- **Unbuffered tee is fastest in the common case.** No allocation per value, no copying inside the channel runtime.
- **Buffer only when you measure a problem.** A buffer hides backpressure; that is sometimes desired, often not.
- **Beware large payload types.** Tee sends the value twice. If the value is a 4 KB struct, you copy it twice. Send pointers for big payloads, but mind the security note above.
- **Avoid tee inside a hot loop.** Each tee is one goroutine and three channels (`in`, `out1`, `out2`). Spawning a tee per element is anti-pattern.
- **Chained tees compound latency.** Each tee adds one goroutine hop. Three tees in series is 3x the latency of a single hub for the same N=4 fan-out.

---

## Best Practices

1. **One tee per topology, declared at startup.** Tee is plumbing, not per-request logic.
2. **Pair tee with `or-done-channel` on consumers.** Avoids leaks when consumers exit early.
3. **Document which branch carries what.** Use named variables (`audit`, `metrics`) instead of `out1`, `out2`.
4. **Wire `done` to your process shutdown signal.** Either a `context.Context.Done()` or an explicit `done chan`.
5. **Test the slow-consumer case.** Run a benchmark where one consumer sleeps; assert that the producer's send rate matches.
6. **Prefer `Tee[T]` to type-specific copies.** One generic implementation per package, used everywhere.
7. **Do not log inside the tee body.** It defeats the abstraction. Logging belongs in consumers.

---

## Edge Cases & Pitfalls

### Closing `in` mid-flight

The `for v := range in` loop exits as soon as `in` is closed and drained. Any value mid-`select` completes its second send, then the loop exits, then `defer close(out1); close(out2)` fires. Consumers see the same number of values as the producer sent.

### Closing `done` mid-flight

If `done` is closed while the goroutine is in the middle of delivering `v` (after `a <- v`, before `b <- v`), the next iteration of the inner `select` picks `<-done` and returns. **Output `b` never received this `v`.** Output `a` received it. The two outputs disagree by one value.

This is the correct behaviour for cancellation. If your consumers must agree exactly, you need a different pattern (e.g., transactional batch shipping) or a guarantee that `done` closes only after `in` closes.

### `done` and `in` close simultaneously

Both `<-done` and `<-in` can be ready at the same scheduler tick. `range` over `in` notices close on its next read; meanwhile, the inner `select` may pick `done` first. The output may be short by one value, just as in the previous case. Implementations that want "deliver everything in `in` and then stop" should not use `done` for that — they should close `in` and let the goroutine drain.

### Re-using the same `done` for many tees

Perfectly fine. One process-wide `done` cancelling fifty tees at once is the normal pattern.

### Reading from output channels after they close

`v, ok := <-outX` returns the zero value of `T` and `ok=false`. The `for v := range outX` form simply exits the loop. Idiomatic.

### Sending to a tee output channel from outside

The function returns `<-chan T`, so the type system prevents external sends. If you cast away the directionality, you create chaos. Don't.

### Nil input channel

If `in == nil`, the `for v := range in` blocks forever. The goroutine waits on the `done` selection in nested form (none in our code) — wait, in our code there is **no** `select` between `range` and the inner loop. So if `in` is `nil` and `done` is never closed, the goroutine leaks. Validate inputs:

```go
func Tee[T any](done <-chan struct{}, in <-chan T) (<-chan T, <-chan T) {
    if in == nil {
        panic("tee: in is nil")
    }
    ...
}
```

Or, more defensively, structure the outer loop as a `select` too. The senior-level file covers that variant.

### Pre-closed `in`

If `in` is already closed when `Tee` is called, the goroutine sees `range` exit immediately, both outputs close, both consumers see EOF. Harmless.

### Pre-closed `done`

If `done` is already closed, the very first `select` returns. Both outputs close without ever delivering anything. Some callers expect "deliver what you can before stopping"; this implementation does not — it stops at the next decision point. Document it.

---

## Common Mistakes

### Mistake: trying to read the input channel from two goroutines

```go
go func() { for v := range in { useA(v) } }()
go func() { for v := range in { useB(v) } }()
```

This *partitions* the stream. Each goroutine sees a random half. Use `Tee` instead.

### Mistake: forgetting to close outputs on `done`

```go
go func() {
    for v := range in {
        select {
        case <-done:
            return // outputs never close!
        case out1 <- v:
        }
        ...
    }
    close(out1); close(out2)
}()
```

Consumers `range`ing on `out1`/`out2` will block forever waiting for EOF. Always `defer close(...)`.

### Mistake: not nilling out the channel after sending

```go
for i := 0; i < 2; i++ {
    select {
    case out1 <- v:
    case out2 <- v:
    }
}
```

On the second iteration, the `select` could pick the same case again. You would send `v` to `out1` twice and never to `out2`. The nil-after-send trick is what makes this loop correct.

### Mistake: trying to share a single mutex-guarded slice instead of using channels

```go
type teeBuf struct {
    mu     sync.Mutex
    values []int
}
```

You are reinventing pub/sub poorly. Stick with channels.

### Mistake: thinking tee is fan-out

"I have 4 workers; let me tee 4 times." No — that gives every worker every value. Use fan-out for load distribution; use tee for duplication.

### Mistake: ignoring backpressure

"My logger is slow but it's just logging, no big deal." If the logger is in the tee path, its slowness slows everything. Either move the logger off the tee path (fire-and-forget), or make the logger branch lossy.

### Mistake: spawning a tee per request

```go
for req := range requests {
    a, b := Tee(done, singletonChan(req)) // wasteful
    ...
}
```

Tee is for streams, not items. Build the topology once at startup.

---

## Common Misconceptions

### "Tee is just a special case of fan-out."

No. Fan-out partitions; tee duplicates. They are opposites in terms of value flow. Same goroutine count, same channel count, totally different semantics.

### "Tee implements pub/sub."

No. Tee is N=2, fixed at creation, with no subscription. Pub/sub is N variable, with dynamic subscribe/unsubscribe and (usually) per-subscriber buffering policies. Tee is a *primitive* that pub/sub can be built from, but it is not pub/sub.

### "The two outputs are independent."

In throughput, no. They share a producer and the producer paces them both. In data, yes — modifying a value through one branch does not change the value seen by the other (unless the value is a shared pointer, in which case yes, you have an aliasing problem).

### "If I buffer the output channels, my consumers become independent."

Only up to the buffer size. Past it, the producer blocks again. Buffering smooths bursts; it does not decouple consumers.

### "I can replace tee with a simple slice copy."

Tee operates on a *stream over time*. A slice has finite size and is materialised in memory all at once. They solve different problems.

### "Closing `done` is the same as closing `in`."

It isn't. Closing `in` drains the stream cleanly; closing `done` aborts at the next decision point. Use the right one.

---

## Tricky Points

### Why the nil-channel trick works

A `select` evaluates each case's channel expression and skips cases whose channel is `nil`. This is a *deliberate* Go runtime behaviour, documented in the language spec. Setting a channel variable to `nil` between iterations is the idiomatic way to remove a case dynamically without rewriting the `select` statement.

### Why the outer loop is `for v := range in`, not `for { select { case v, ok := <-in: ... } }`

Both work. `range` is shorter and reads more naturally. Use `select` instead when you need to mix the input receive with other cases (e.g., a periodic flush). The senior-level code shows the `select` form.

### Why we cannot do both sends concurrently

We could:
```go
go func() { out1 <- v }()
go func() { out2 <- v }()
```

But now we leak two goroutines per value (until both deliveries happen), and ordering breaks: a later value could be sent first if the second pair's goroutines wake up earlier. The single-goroutine, sequential-with-select form is correct and bounded.

### Why the loop is `for i := 0; i < 2; i++` and not `for { ... if a == nil && b == nil { break } }`

Both work; the counted form is a hair cleaner because you know statically that exactly two iterations happen. The break form involves a stop condition the reader has to verify. Style preference.

### What if `out1` is closed by someone else?

It shouldn't be — the type system says it's `<-chan T` to consumers. If something casts and closes it, the next `out1 <- v` panics with "send on closed channel" and the goroutine dies. Don't.

### Fairness over many values

`select` chooses uniformly at random among ready cases. Over many values, both outputs are equally likely to be served "first" within an iteration. There is no built-in priority — if you need one, you have to express it explicitly (e.g., always try `a` first, then fall back to `select`).

---

## Test

A short test suite for `Tee`:

```go
package channels_test

import (
    "sync"
    "testing"
    "time"

    "example.com/channels"
)

func TestTeeDeliversEachValueToBoth(t *testing.T) {
    done := make(chan struct{})
    defer close(done)

    in := make(chan int)
    out1, out2 := channels.Tee(done, in)

    go func() {
        for i := 1; i <= 100; i++ {
            in <- i
        }
        close(in)
    }()

    var got1, got2 []int
    var wg sync.WaitGroup
    wg.Add(2)
    go func() { defer wg.Done(); for v := range out1 { got1 = append(got1, v) } }()
    go func() { defer wg.Done(); for v := range out2 { got2 = append(got2, v) } }()
    wg.Wait()

    if len(got1) != 100 || len(got2) != 100 {
        t.Fatalf("expected 100,100, got %d,%d", len(got1), len(got2))
    }
    for i := 0; i < 100; i++ {
        if got1[i] != i+1 || got2[i] != i+1 {
            t.Fatalf("mismatch at %d: %d %d", i, got1[i], got2[i])
        }
    }
}

func TestTeeStopsOnDone(t *testing.T) {
    done := make(chan struct{})
    in := make(chan int, 1)
    out1, out2 := channels.Tee(done, in)

    in <- 1
    // drain only one side, then signal done
    <-out1
    close(done)

    // Both outputs must eventually close.
    timeout := time.After(time.Second)
    for _, c := range []<-chan int{out1, out2} {
        for {
            select {
            case _, ok := <-c:
                if !ok { goto next }
            case <-timeout:
                t.Fatal("output did not close on done")
            }
        }
    next:
    }
}

func TestTeeBackpressure(t *testing.T) {
    done := make(chan struct{})
    defer close(done)
    in := make(chan int)
    out1, out2 := channels.Tee(done, in)

    start := time.Now()
    go func() {
        for i := 0; i < 5; i++ {
            in <- i
        }
        close(in)
    }()

    go func() { for range out1 { /* fast */ } }()
    go func() {
        for range out2 {
            time.Sleep(50 * time.Millisecond) // slow
        }
    }()

    // Wait for both to finish.
    for range out1 { }
    // Producer should have been paced by slow consumer.
    if elapsed := time.Since(start); elapsed < 200*time.Millisecond {
        t.Errorf("backpressure not respected: %v", elapsed)
    }
}
```

The third test is the *interesting* one: it verifies the design intent that the slow consumer paces the producer. If a future "optimisation" silently buffers, this test catches it.

---

## Tricky Questions

**Q: If `out1` is closed by a consumer (impossible normally, but suppose), what happens?**
A: The next `out1 <- v` panics. Type system prevents this; don't subvert it.

**Q: Does the order of `case a <- v` versus `case b <- v` matter?**
A: No. `select` is order-independent among ready cases.

**Q: What if `T` is a slice or map?**
A: Both outputs receive the *same* slice/map header. They share underlying storage. Mutate at your own risk.

**Q: How do I get three outputs without a hub?**
A: Chain two tees: `a, x := Tee(done, in); b, c := Tee(done, x)`. Adds one goroutine.

**Q: Why is `done` typed `<-chan struct{}` and not `context.Context`?**
A: Either works. The Cox-Buday vocabulary predates the context idiom. Modern code often uses `context.Context.Done()` to derive the channel.

**Q: Does the inner `select` always run exactly two iterations per input value?**
A: Yes, unless `done` fires. After two successful sends, both `a` and `b` are `nil`, but we exit the loop on the counter, not on a nil check. So strictly: two iterations or early return.

**Q: Is the goroutine guaranteed to exit if I close both `done` and `in`?**
A: Yes. Either trigger ends it.

**Q: Why not implement tee with `sync.Mutex` and a slice?**
A: You would be implementing a buffered queue, then a delivery scheduler, then handling close, then re-implementing what channels give you for free. Don't.

**Q: What is the throughput of tee compared to a single channel?**
A: Roughly half. Each input value requires two sends. In practice, channel send is ~50 ns; tee adds one goroutine hop and one extra send, so expect ~120 ns per value end-to-end on commodity hardware.

**Q: Does tee preserve message boundaries when `T = []byte`?**
A: Yes — each slice header sent over the channel is delivered as one value. The bytes themselves are aliased between branches.

---

## Cheat Sheet

```text
PATTERN     PURPOSE                                     N (outputs)
---------   -----------------------------------------   -----------
fan-out     load-balance one input across N workers     N variable, partitions stream
tee         duplicate one input to two consumers        N = 2, full duplication
broadcast   duplicate one input to N consumers          N variable, full duplication
or-done     unify cancel + stream into one channel      N = 1
```

```go
// Memorise this:
out1, out2 := Tee(done, in)

func Tee[T any](done <-chan struct{}, in <-chan T) (<-chan T, <-chan T) {
    out1, out2 := make(chan T), make(chan T)
    go func() {
        defer close(out1); defer close(out2)
        for v := range in {
            a, b := out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-done:
                    return
                case a <- v: a = nil
                case b <- v: b = nil
                }
            }
        }
    }()
    return out1, out2
}
```

Key invariants:
- Outputs receive identical sequences.
- Both outputs close when the goroutine returns.
- Slow consumer paces producer (backpressure).
- Cancellation may drop the in-flight value on one side.

---

## Self-Assessment Checklist

- [ ] I can explain why two `range`s on the same channel give fan-out, not duplication.
- [ ] I can write the nil-channel-after-send trick from memory.
- [ ] I can write `Tee[T any](done, in) (<-chan T, <-chan T)` from scratch.
- [ ] I can contrast tee with fan-out and broadcast in one sentence each.
- [ ] I can name three real-world use cases for tee.
- [ ] I can explain what happens to in-flight values when `done` closes.
- [ ] I know when tee is the wrong tool (more than 3 consumers, dynamic subs, decoupled failure).
- [ ] I can wire tee into a pipeline with `or-done` on the consumers.
- [ ] I can describe the asymmetric buffered variant and when to choose it.
- [ ] I have written a test that verifies backpressure.

---

## Summary

`tee` takes one stream and produces two, each carrying every value from the original. It is the smallest correct solution to the universal problem of "one source, two consumers, both want everything." The implementation in idiomatic Go uses one goroutine, an outer `for v := range in` loop, and an inner two-iteration `select` with the nil-channel-after-send trick. That trick — disabling a `select` case by setting its channel variable to `nil` — is one of the most useful idioms in Go's concurrency toolbox and recurs in the next combinators.

Backpressure is preserved by design. The two outputs are coupled in throughput; if one consumer slows, both slow. That is correct for ingestion patterns where atomicity across sinks matters; it is wrong for patterns where consumers must fail independently. For the latter, reach for a broadcast hub.

Tee is fan-out's cousin in shape but its opposite in intent: fan-out partitions, tee duplicates.

---

## What You Can Build

- A request pipeline that ships every event to both Kafka and a search index.
- A tracing layer that copies every RPC into a side stream for sampling.
- A shadow-traffic harness for comparing old and new service versions.
- A stream debugger that taps into a live channel to print every value while the real consumer keeps working (using lossy asymmetric tee so the debugger never slows production).
- A test generator that emits values into two parallel test goroutines.
- A unit-test helper that captures a stream for assertions while still feeding the real consumer.

---

## Further Reading

- Katherine Cox-Buday, *Concurrency in Go*, O'Reilly 2017, chapter 4 (channel combinators).
- The Go blog: [Go Concurrency Patterns: Pipelines and cancellation](https://go.dev/blog/pipelines).
- `pkg.go.dev/golang.org/x/sync/errgroup` — error-aware coordination of pipeline stages.
- The Unix `tee(1)` man page — historical inspiration.
- Sam Coward's series on channel combinators with generics (search "go tee channel generic").
- The [or-done-channel](../01-or-done-channel/) sibling pattern in this roadmap.

---

## Related Topics

- [01-or-done-channel](../01-or-done-channel/) — cancellation-aware stream wrapping; pair with tee on consumers.
- [03-bridge-channel](../03-bridge-channel/) — flatten a channel of channels into a single stream; appears after tee in pipelines.
- [05-concurrency-patterns/02-fan-out](../../05-concurrency-patterns/02-fan-out/) — the opposite shape: split a stream across workers.
- [05-concurrency-patterns/06-broadcast-pattern](../../05-concurrency-patterns/06-broadcast-pattern/) — full pub/sub when N>2 or dynamic.
- [05-concurrency-patterns/01-pipeline](../../05-concurrency-patterns/01-pipeline/) — the higher-level structure tee plugs into.
- [04-context/](../../04-context/) — the modern alternative to a bare `done` channel.

---

## Diagrams & Visual Aids

### Tee shape

```
              +--------+
   in -----> |  tee   | -----> out1 (consumer A)
              |        |
              |        | -----> out2 (consumer B)
              +--------+
```

### Tee vs Fan-Out

```
TEE:        in --> [tee] --> out1: 1 2 3 4 5
                         \-> out2: 1 2 3 4 5

FAN-OUT:    in --> [   ] --> worker A: 1 3 5
                         \-> worker B: 2 4
```

### Per-value flow inside tee

```
recv v from in
   |
   v
   +--> select { case <-done: return
   |             case a <- v: a = nil
   |             case b <- v: b = nil }
   |
   +--> select (one of a,b now nil) ...
   |
   v
loop
```

### Backpressure

```
in   --> [.][.][.][ ][ ]      buffer fills if consumer B is slow
                  \
                   v
out1 --> [v1][v2][v3]          consumer A keeps draining
out2 --> [v1][v2]              consumer B is slow

Producer cannot send v4 until B accepts v3.
```

### Asymmetric tee

```
              +-----------+
   in -----> | tee (buf=8)| -----> out1 [|||||||| ] (buffered, burst-tolerant)
              |           |
              |           | -----> out2 [           ] (unbuffered, strict)
              +-----------+
```

### Mental model: T-pipe

```
        in
        |
   +----+----+
   |         |
  out1      out2
```

Same shape as the plumbing fitting that gave the pattern its name.
