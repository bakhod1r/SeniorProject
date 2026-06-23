# Bridge-Channel — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Generic Bridge with Context](#generic-bridge-with-context)
3. [Bridge vs Fan-In: Different Shapes](#bridge-vs-fan-in-different-shapes)
4. [Composing with Or-Done and Tee](#composing-with-or-done-and-tee)
5. [Bridge as a Pipeline Stage](#bridge-as-a-pipeline-stage)
6. [Backpressure and Inner Channel Buffering](#backpressure-and-inner-channel-buffering)
7. [Bounded Bridges and Timeouts](#bounded-bridges-and-timeouts)
8. [Errors Through Bridge](#errors-through-bridge)
9. [Pagination, Batches, Sub-Queries](#pagination-batches-sub-queries)
10. [Idiomatic Code](#idiomatic-code)
11. [Anti-Patterns](#anti-patterns)
12. [Testing Strategy](#testing-strategy)
13. [Performance Profile](#performance-profile)
14. [Tricky Cases](#tricky-cases)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)

---

## Introduction

You learned the basic bridge in the junior page. Now we tighten it: generic with context, integrated with the rest of the Cox-Buday vocabulary, composed inside pipelines, and compared head-to-head with fan-in so you know exactly when each is right.

Three changes at the middle level:

1. The signature carries `context.Context` rather than a bare `done` channel.
2. We treat bridge as a *pipeline stage* and discuss composition with map, filter, fan-in, fan-out.
3. We make a precise comparison with fan-in — the most common reason to misuse bridge.

The bridge function comes from *Concurrency in Go* by Katherine Cox-Buday (O'Reilly, 2017), where it is part of a coherent vocabulary of stream combinators. At middle level the goal is to make bridge feel as routine as a `for range`.

---

## Generic Bridge with Context

The context-aware version:

```go
package channels

import "context"

func Bridge[T any](ctx context.Context, chanStream <-chan <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            var stream <-chan T
            select {
            case <-ctx.Done():
                return
            case s, ok := <-chanStream:
                if !ok {
                    return
                }
                stream = s
            }
            for v := range OrDone(ctx, stream) {
                select {
                case <-ctx.Done():
                    return
                case out <- v:
                }
            }
        }
    }()
    return out
}
```

`OrDone` is the context-aware sibling of `orDone`:

```go
func OrDone[T any](ctx context.Context, c <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case <-ctx.Done():
                    return
                case out <- v:
                }
            }
        }
    }()
    return out
}
```

Two helpers, both generic, both 20 lines. They form the foundation for everything else in this section.

The signature convention: `ctx` first, channel(s) second, return one output channel. Match it everywhere so callers don't have to remember per-function quirks.

---

## Bridge vs Fan-In: Different Shapes

This is the comparison every Go engineer should be able to draw on a whiteboard.

| Property | Bridge | Fan-In |
|----------|--------|--------|
| Input shape | `<-chan <-chan T` (dynamic over time) | `...<-chan T` (fixed N at call time) |
| Output | One channel `<-chan T` | One channel `<-chan T` |
| Reading style | Serial: drain one, move to next | Parallel: all N are read concurrently |
| Order | Concatenation of inputs | Interleaved, non-deterministic |
| Goroutine cost | One helper | One helper *per input* |
| Use when | Inner streams arrive over time, no need to interleave | Many concurrent producers feed one consumer |
| Backpressure | Affects current inner only | Distributes across all inputs |

The most useful rule: **if you know all the inputs at the call site, fan-in. If they appear over time, bridge.**

Take a producer that paginates an API:

- The producer does *not* know how many pages there are.
- Pages arrive one at a time, naturally serial.
- The order matters (page 1 then page 2 then page 3).

That is bridge.

Take a system that aggregates events from N known goroutines (one per region, four regions):

- The N is fixed and known up front.
- All regions emit concurrently.
- Order doesn't matter; just merge them.

That is fan-in.

If you want **dynamic-N parallel**, neither pure bridge nor fan-in is right. You need a worker pool that consumes the outer channel of channels and merges, or you need fan-in over the bridge's output if the inner channels are themselves slow.

### A hybrid example

Sometimes you want both: dynamic N from over time, but parallel reads. The pattern is bridge for shape, then fan-in for concurrency:

```go
// Inner channels arrive over time, but we want to read up to K of them in parallel.
// Sketch: maintain a slice of currently-active inner channels and fan them in;
// add a new inner channel when one finishes. This is no longer pure bridge —
// it is a custom orchestrator. Document it clearly and write thorough tests.
```

Don't reach for the hybrid unless measurements show pure bridge is too slow.

---

## Composing with Or-Done and Tee

Bridge is one of four small combinators in the Cox-Buday vocabulary. They compose:

- `OrDone(ctx, c)` — adds cancellation to a single channel.
- `Bridge(ctx, cs)` — concatenates a stream of streams.
- `Tee(ctx, c)` — splits one channel into two.
- `Or(ctx, cs...)` — closes when any of N inputs closes.

Common compositions:

```go
// Bridge then split into two consumers.
flat := Bridge(ctx, chanStream)
a, b := Tee(ctx, flat)
go consumeAuditLog(a)
go consumeMetrics(b)
```

```go
// Or-Done on the outer chanStream itself (rare but legal).
outer := OrDone(ctx, chanStream) // <-chan <-chan T
flat := Bridge(ctx, outer)
```

The second one is interesting: it shows that combinators nest. The outer is itself a channel; or-done it just like any channel.

```go
// Bridge + fan-in for a hybrid.
flat := Bridge(ctx, chanStream)
heavy := process(ctx, flat)
final := FanIn(ctx, heavy, /* other sources */)
```

The combinators are designed to be small, opinionated, and stateless. They compose because they obey the same convention: ctx first, owner of the output goroutine closes the output.

---

## Bridge as a Pipeline Stage

If your pipeline-stage type is

```go
type Stage[In, Out any] func(ctx context.Context, in <-chan In) <-chan Out
```

then bridge does not fit directly because its input is `<-chan <-chan T`, not `<-chan T`. But it fits naturally when you generalise the stage type:

```go
type Flattener[T any] func(ctx context.Context, in <-chan <-chan T) <-chan T

var BridgeStage Flattener[Row] = Bridge[Row]
```

Where it fits in a pipeline:

```go
chanStream := paginatedPages(ctx, query)        // <-chan <-chan Row
flat       := Bridge(ctx, chanStream)            // <-chan Row
enriched   := MapStage(enrichRow)(ctx, flat)     // <-chan Row
filtered   := FilterStage(isInteresting)(ctx, enriched)
batched    := BatchStage(100)(ctx, filtered)     // <-chan []Row
sink       := writeBatches(ctx, batched)
```

Bridge appears once, near the source. After it, every downstream stage works on a flat `<-chan Row` and never needs to know about pagination.

If you find yourself wanting two bridges in one pipeline, you almost certainly have one too many levels of nesting in your producer. Refactor the producer to emit a single flat stream when possible.

---

## Backpressure and Inner Channel Buffering

Bridge's output is canonically unbuffered. That means: the consumer's pace controls the inner channel's pace, which controls the producer's pace. Backpressure is end-to-end.

What happens if inner channels are buffered?

- The producer of an inner channel can run ahead by `cap(inner)` items.
- Bridge still drains the buffer one item at a time at the consumer's pace.
- When bridge moves on to the next inner channel, the previous inner's buffer is garbage-collected.

A common micro-optimisation: buffer inner channels lightly (4–16) to absorb burstiness in producer-side work. Don't buffer the outer `chanStream` or the bridge's output — backpressure must reach the producer.

Bigger buffers cost more memory but reduce the chance of producer stalls. Profile before tuning. In most cases, unbuffered everything is correct.

---

## Bounded Bridges and Timeouts

In production code the bridge often needs a deadline:

```go
ctx, cancel := context.WithTimeout(parent, 30*time.Second)
defer cancel()
for row := range Bridge(ctx, fetchPages(ctx, client)) {
    process(row)
}
```

When the timeout fires, every stage observing the same `ctx` unwinds:

- `fetchPages` stops issuing new HTTP calls.
- The current inner channel's producer sees `ctx.Done()` and bows out.
- `Bridge` sees `ctx.Done()` and exits.
- The `for row := range` loop terminates.

This is the canonical end-to-end cancellation. The discipline is: every goroutine in the chain must select on `ctx.Done()` somewhere in its hot loop. If even one doesn't, the chain leaks.

Avoid pairing bridge with `time.After` directly. Always go through `context.WithTimeout`, both for consistency and because it propagates to the rest of the chain.

---

## Errors Through Bridge

Bridge does not understand errors. It moves values. There are three conventional patterns:

**1. `Result[T]` wrapper.** Producers wrap each value:

```go
type Result[T any] struct {
    Val T
    Err error
}
```

Inner channels are `<-chan Result[T]`. Bridge concatenates them. Consumers branch on `Err`. This is the most pipeline-friendly form because every stage forwards the wrapper without special-casing.

**2. Parallel error channel.** Producers maintain a separate `<-chan error`. Consumers select on both. Works for small pipelines; gets complex past three stages.

**3. Sentinel error channel inside the outer.** The producer can emit a special inner channel that yields one error value and closes. The consumer must recognise it. Hacky; avoid.

In practice option 1 wins for any pipeline more than two stages long. The bridge function itself does not change; you just bridge `Result[Row]` instead of `Row`.

### Cancellation vs error

When an inner channel's producer hits an error, two choices:

- Emit the error as a `Result[T]{Err: err}` and let the consumer decide.
- Cancel the shared `ctx` and unwind the whole chain.

Choose based on whether the error is recoverable. A bad row in page 47 is per-row; a network failure is whole-chain.

---

## Pagination, Batches, Sub-Queries

The three real-world patterns where bridge shines.

### Pagination

```go
func Pages(ctx context.Context, client *Client) <-chan <-chan Row {
    out := make(chan (<-chan Row))
    go func() {
        defer close(out)
        cursor := ""
        for {
            page, next, err := client.Fetch(ctx, cursor)
            if err != nil {
                return
            }
            inner := make(chan Row)
            go func(rows []Row) {
                defer close(inner)
                for _, r := range rows {
                    select {
                    case inner <- r:
                    case <-ctx.Done():
                        return
                    }
                }
            }(page)
            select {
            case out <- inner:
            case <-ctx.Done():
                return
            }
            if next == "" {
                return
            }
            cursor = next
        }
    }()
    return out
}

rows := Bridge(ctx, Pages(ctx, client))
```

The consumer treats `rows` as a flat `<-chan Row`. The whole pagination machinery is encapsulated.

### Batch processing

```go
// Each batch produces a sub-stream of records as it completes.
func RunBatches(ctx context.Context, batches []Batch) <-chan <-chan Record {
    out := make(chan (<-chan Record))
    go func() {
        defer close(out)
        for _, b := range batches {
            inner := process(ctx, b) // <-chan Record, closes when done
            select {
            case out <- inner:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

records := Bridge(ctx, RunBatches(ctx, batches))
```

### Sub-queries

```go
// A multi-stage query whose stages each produce a result stream.
func Query(ctx context.Context, plan Plan) <-chan <-chan Row {
    out := make(chan (<-chan Row))
    go func() {
        defer close(out)
        for _, stage := range plan.Stages {
            inner := execute(ctx, stage)
            select {
            case out <- inner:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

All three patterns share the same shape: a producer that emits inner channels one after another, each finite, each closed. Bridge is the universal flattener.

---

## Idiomatic Code

- Pass `context.Context` first.
- Use generics. A non-generic bridge is a code-smell.
- Return `<-chan T`, not `chan T`. Receivers should not be able to close it.
- Always pair bridge with `OrDone` on the inner read. Never inline a bare `range`.
- Document the producer's contract: "Each emitted channel is closed by the producer after its values are sent."
- Name the result variable for the domain: `rows`, `events`, `messages` — not `out`.
- One bridge per `chanStream`. If two consumers need the output, `Tee` it after the bridge.

---

## Anti-Patterns

### Returning `<-chan <-chan T` from a public API

Forces every consumer to know about the two-level shape. Bridge it inside the package; expose `<-chan T`.

### Manually nesting `for range` instead of using bridge

```go
for inner := range chanStream {
    for v := range inner {
        // ...
    }
}
```

No cancellation. No graceful close. No goroutine boundary. The instant you add cancellation, you reinvent bridge worse. Just call bridge.

### Buffering the output of bridge for "performance"

The output is the place backpressure must reach. Buffering it decouples the producer and the consumer, which is rarely what you want and easy to break.

### Reading the outer `chanStream` from two bridges

Two bridges race for inner channels; each gets a subset. Use one bridge, then tee.

### Mixing bridge and fan-in semantics in one helper

If your function reads `<-chan <-chan T` but spawns one goroutine per inner channel and merges, you have written a fan-in over a bridge — sometimes correct, but should not be named "bridge." Use distinct names.

---

## Testing Strategy

### Property 1: order is preserved

For any input sequence of inner channels with known contents, the output is the concatenation. Property-based test:

```go
func TestBridgePreservesOrder(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        batches := rapid.SliceOf(rapid.SliceOf(rapid.Int())).Draw(t, "batches")
        chanStream := make(chan (<-chan int), len(batches))
        var want []int
        for _, b := range batches {
            inner := make(chan int, len(b))
            for _, v := range b {
                inner <- v
                want = append(want, v)
            }
            close(inner)
            chanStream <- inner
        }
        close(chanStream)
        ctx, cancel := context.WithCancel(context.Background())
        defer cancel()
        var got []int
        for v := range Bridge(ctx, chanStream) {
            got = append(got, v)
        }
        if !reflect.DeepEqual(got, want) {
            t.Fatalf("got %v, want %v", got, want)
        }
    })
}
```

### Property 2: cancellation always terminates

For any context cancellation at any point, bridge's output closes within bounded time. Test by cancelling at random intervals during a long run and asserting the output channel closes.

### Property 3: no goroutine leaks

Use `goleak.VerifyTestMain` from `go.uber.org/goleak` to assert that after every test, no goroutines from bridge remain.

### Edge cases as unit tests

- Empty outer channel — bridge closes output immediately.
- Empty inner channel — bridge moves to next.
- Outer closes mid-inner — bridge drains the inner first, then exits.
- Cancel mid-inner — bridge exits before draining.

---

## Performance Profile

Each value through bridge involves:

- One receive on the outer (once per inner).
- One receive on the inner (per value).
- One send on the output (per value).
- The OrDone helper adds one more channel hop per value.

That is roughly 2-3 channel operations per value, plus the goroutine context switches. On modern hardware that is on the order of 50–200 ns per value. For most workloads, irrelevant. For 10M+ items/sec workloads, consider inlining the OrDone logic to drop one channel hop.

The single-goroutine cost is fixed. Bridge does not scale with inner channel count for memory.

If profiling reveals bridge is hot, the usual remedies:

- Batch values: send slices instead of individual items.
- Buffer inner channels (not the output).
- Inline OrDone.
- Replace with a slice-of-slices and a flat range when streaming isn't needed.

---

## Tricky Cases

### Producer goroutine for inner closes before bridge starts reading

Not a problem. The inner channel's values may be buffered, or the inner producer may have blocked on its send. Either way, when bridge reads, the values are delivered.

### Outer `chanStream` itself comes from another bridge

Bridge of bridges. Legal but rare; usually a sign the data shape is over-nested. Refactor.

### Many inner channels close very quickly

Bridge handles a million empty inner channels fine, but the constant cost of allocating channels dominates. Consider whether the producer could emit values directly instead of wrapping them in channels.

### Inner channel sends on a non-channel sender

Bridge does not care who sends to the inner channel. Could be one goroutine, could be many. Bridge just reads.

### Closing `done` (or cancelling ctx) inside the consumer loop

Legal. Bridge exits at the next select check.

---

## Cheat Sheet

```go
// Signature
Bridge[T any](ctx context.Context, chanStream <-chan <-chan T) <-chan T

// Shape it solves
producer:  <-chan <-chan T
bridge -->  <-chan T

// Compared to fan-in
bridge: serial, concat, dynamic-over-time, 1 goroutine
fan-in: parallel, interleaved, fixed-at-call-time, N goroutines

// Always
- ctx first
- OrDone inner reads
- producer closes inner channels
- one bridge per chanStream

// Never
- buffer output
- return <-chan <-chan T from public API
- mix bridge with parallel reads under the same name
```

---

## Summary

At middle level, bridge becomes routine: a generic, context-aware combinator with a precise signature and a precise contract. The key insight is the shape difference from fan-in: bridge is dynamic-N-over-time, serial; fan-in is fixed-N-at-call-time, parallel. Compose bridge with OrDone, Tee, and your pipeline stage type to keep the code small and the cancellation correct. Use it whenever the producer's natural output is a sequence of finite sub-streams: pagination, batches, multi-stage queries.
