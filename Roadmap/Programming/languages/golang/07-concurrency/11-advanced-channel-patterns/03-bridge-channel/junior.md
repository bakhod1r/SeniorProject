# Bridge-Channel — Junior Level

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
> Focus: "I have a channel that yields channels. How do I turn it into a single, simple stream of values?"

The **bridge-channel** pattern solves one of the more awkward shapes you will meet in Go concurrency: a producer that hands you `<-chan <-chan T` — a channel whose elements are themselves channels of `T`. Each inner channel is a short, finite sub-stream. The outer channel is potentially unbounded. The consumer just wants `<-chan T` and a normal `for v := range out` loop.

`bridge` is the adapter that closes that gap. It reads inner channels one at a time, forwards every value to a single output channel, and moves on to the next inner channel when the current one closes. The result: an unbroken, flat stream that the consumer can iterate without ever seeing the layered shape.

```go
chanStream := producePages(ctx) // <-chan <-chan Row
rows := bridge(done, chanStream) // <-chan Row
for row := range rows {
    process(row)
}
```

The name comes from *Concurrency in Go* by Katherine Cox-Buday (O'Reilly, 2017). She introduced `or-done`, `tee`, `bridge`, and `or` as a small vocabulary of channel combinators. `bridge` is the one you reach for when the producer's natural output is "a sequence of streams" rather than "a stream of values."

After reading this file you will:

- Recognise the channel-of-channels shape and explain why it is sometimes the right design.
- Write the generic `bridge` function from memory in fewer than twenty lines.
- Compose `bridge` with `or-done` so that consumer cancellation propagates to every inner channel.
- Use `bridge` to flatten paginated APIs, batch processors, and multiplexed queries.
- Avoid the most common bugs: blocked inner reads, dropped values when cancelling mid-batch, and nil inner channels.

You do not yet need to know about backpressure across long bridge chains, dynamic re-balancing, or the difference between bridge and a streaming `flatMap`. Those come later. Right now we focus on the shape, the function, and the daily-use cases.

---

## Prerequisites

- **Required:** Go 1.18 or newer. The bridge function in this page is generic; without type parameters you would either lose type safety or write one bridge per element type.
- **Required:** Comfort with channels: `make(chan T)`, sending, receiving, the `range` form over a channel, and the closing convention.
- **Required:** Familiarity with goroutines, especially the lifecycle: start, run, finish. A `bridge` always starts one helper goroutine.
- **Required:** Awareness of the **or-done-channel** pattern. We use it inside `bridge` for cancellation. If you have not read the `01-or-done-channel` page, read its Core Concepts section first.
- **Helpful:** A working `select` statement under your belt — bridge does not need a complicated one, but you need to recognise the `<-done` + value-receive idiom.
- **Helpful:** Experience with `context.Context`. The examples can be adapted to take a `ctx` instead of a `done` channel, and we show both forms.

If you can read the line `for v := range ch { ... }` and explain what happens when `ch` is closed, and you have read at least one chapter of *Concurrency in Go*, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Bridge** | A function that consumes `<-chan <-chan T` and produces `<-chan T` by iterating inner channels in order. |
| **Channel of channels** | A channel whose element type is itself a channel. Written `chan chan T` for bidirectional, `<-chan <-chan T` for receive-only outer with receive-only inners. |
| **Inner channel** | One element of the outer channel; a short-lived sub-stream of `T` values. |
| **Outer channel** | The channel whose elements are inner channels; the "stream of streams." |
| **Flatten** | The intuitive verb for what bridge does: take a 2-level shape and collapse it to 1 level. |
| **Or-done-channel** | A combinator that wraps a stream channel with a cancellation signal, exiting as soon as either is observable. Used inside bridge for safe cancellation. |
| **Done channel** | A `<-chan struct{}` that is closed when the consumer is no longer interested. `close(done)` is broadcast: every reader sees it immediately. |
| **`struct{}`** | A zero-byte type used as the element type of done channels. Carries no data — only the "signal happened" semantics. |
| **Goroutine leak** | A goroutine that is started but never exits. The biggest risk in channel-of-channels code is leaking the goroutine that drains an inner channel. |
| **Pagination** | A common producer pattern where data arrives one page at a time; each page can naturally be modelled as one inner channel. |
| **Backpressure** | The slowing-down of a producer when a consumer reads slowly. Bridge inherits the consumer's pace and propagates it through to the producer of inner streams. |

---

## Core Concepts

### The shape: `<-chan <-chan T`

Read the type left-to-right: "a receive-only channel whose elements are receive-only channels of T." It looks unusual at first but it appears naturally in three situations:

1. A producer that processes work in **batches**, where each batch's results are themselves a stream.
2. A producer that **paginates** an external API; one page = one inner channel.
3. A producer that **fans queries out to dynamic subsystems** and surfaces each subsystem's result stream.

A consumer that wants a single flat sequence cannot just `range` over the outer channel — that would give it inner channels, not values. It cannot easily nest `range` either, because every inner channel must be read to completion before moving on, and any cancellation must reach inside.

### The generic `bridge` function

This is the headline implementation. Memorise its shape.

```go
// bridge flattens a channel of channels into a single channel.
// It exits when chanStream is closed *and* the current inner channel is
// drained, or when done is closed.
func bridge[T any](
    done <-chan struct{},
    chanStream <-chan <-chan T,
) <-chan T {
    valStream := make(chan T)
    go func() {
        defer close(valStream)
        for {
            var stream <-chan T
            select {
            case maybeStream, ok := <-chanStream:
                if !ok {
                    return
                }
                stream = maybeStream
            case <-done:
                return
            }
            for val := range orDone(done, stream) {
                select {
                case valStream <- val:
                case <-done:
                    return
                }
            }
        }
    }()
    return valStream
}
```

Read it like this:

- The outer `for` loop pulls one inner channel at a time from `chanStream`.
- The `select` on the first read is the cancellation guard at the outer level.
- The inner `for val := range orDone(done, stream)` drains the inner channel, wrapped with `orDone` so cancellation reaches inside the inner read.
- The nested `select` on the send is the cancellation guard at the forwarding step.

Everything else is detail. Bridge is **one outer loop, one inner loop, three places to check `done`**.

### The `orDone` combinator (recap)

`bridge` depends on `orDone`. Here it is for completeness:

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
                }
            }
        }
    }()
    return valStream
}
```

Without `orDone`, the inner `for range` in `bridge` would happily block on `<-stream` forever even after `done` was closed, leaking a goroutine per inner channel.

### Order of values: strictly serial

Bridge does **not** interleave inner channels. It reads inner channel #1 to completion, then #2, then #3, and so on. The output is the concatenation of the inner streams, in the order the outer channel emitted them. This is the principal difference from fan-in, which interleaves and is non-deterministic.

If you want interleaving — many inner channels processed in parallel — you do not want bridge. You want fan-in. We will revisit the comparison in middle level.

### Closing semantics

`bridge` closes its output `valStream` in exactly two situations:

1. The outer `chanStream` is closed by the producer **and** the last inner channel was fully drained.
2. The consumer closed `done` before that happened.

Either way, the consumer's `for v := range out` loop exits cleanly. There is no need for the consumer to call any cleanup function.

### One goroutine per bridge — no more

`bridge` launches **one** helper goroutine. It does *not* launch one goroutine per inner channel. That is the whole reason it can be lossless and ordered: there is a single stream of control reading and forwarding. Compare this with fan-in, which deliberately launches one goroutine per input so it can read them in parallel.

This single-goroutine property keeps bridge cheap. Even if you bridge a million inner channels over the lifetime of a program, you have at most one extra running goroutine at any moment.

---

## Real-World Analogies

### A buffet conveyor that swaps trays

Imagine a long conveyor belt in a buffet. Trays slide along it; on each tray sit small bowls. A diner stands at the end and wants only the bowls, not the trays. A helper at the start of the belt opens each tray, slides the bowls onto a second narrow belt for the diner, and moves on to the next tray. The diner sees a single stream of bowls. The helper is the bridge.

### Reading albums one track at a time

You ask a music app: "play me everything in the queue." The queue is a list of albums; each album is a sequence of tracks. You don't want to think about album boundaries — you just want music. The bridge is the playlist engine that opens album 1, plays tracks 1..N, then opens album 2, plays its tracks, and so on. The output is one long stream of tracks, even though the input was a stream of albums.

### A river fed by tributaries one at a time

A main river is fed by a series of tributaries. Each tributary flows for a while and then dries up. A new tributary joins, then dries up too. From far downstream you don't see the boundaries — you see one river. Bridge is the geometry that joins each tributary's flow into the same downstream channel.

### Reading paginated search results

You issue a query that returns 50 pages. Each page is its own little file with 100 rows. You want one cursor that yields rows in order. Bridge is the page-fetching middleware: open page 1, yield its 100 rows, fetch page 2, yield its 100, and so on. The consumer never sees the pagination.

---

## Mental Models

### "Concatenate, don't merge"

The single sentence that captures bridge: **concatenate**, don't merge. Inner channels are joined end to end, not blended. If you ever find yourself wanting to interleave them, you are looking at the wrong tool.

### "One outer loop, one inner loop, three escape hatches"

Bridge's structure is fixed:

- Outer loop: pull next inner channel.
- Inner loop: drain it.
- Escape on `done` in three places: outer select, inner select-on-send, inside `orDone`.

If you remember the structure, you can reconstruct the function from scratch under interview pressure.

### "Bridge is a flatMap that doesn't reorder"

If you have used `flatMap` or `concat` in Rx, RxJS, Project Reactor, or Akka Streams, bridge is the Go equivalent: it concatenates inner observables in the order they arrive, without interleaving. The functional name is **concat** in Rx; the Cox-Buday name is **bridge**.

### "Cancellation must reach inside"

A common new-engineer error is to assume that closing `done` is enough to stop bridge. It will stop the outer loop, but if the inner channel is being read with plain `range`, that range will block forever. The fix — `orDone` around the inner channel — is non-negotiable. Without it, bridge is a leak waiting to happen.

---

## Pros & Cons

### Pros

- **One-liner for the consumer.** No nested `for range` loops; just `for v := range bridge(done, stream)`.
- **Type-safe with generics.** Works for any `T` with a single helper.
- **Single goroutine cost.** One helper, regardless of how many inner streams.
- **Lossless and ordered.** Every value is forwarded exactly once, in input order.
- **Composable.** Fits into pipelines next to map/filter/fan-in/fan-out without ceremony.
- **Cancellation-safe** when wrapped with `orDone` — and the canonical implementation always is.

### Cons

- **Strictly serial.** Cannot exploit parallelism across inner channels. If you need parallel reads, fan-in is the tool.
- **Blocks on slow inner channels.** A single inner channel that produces values slowly stalls every subsequent inner channel.
- **No back-pressure visibility for the producer.** The producer of inner channels does not know how full each inner is when bridge picks it up.
- **Easy to misuse with non-closing inner channels.** If an inner channel never closes, bridge never moves on. Always design inner channels to close.
- **Two-level type signature is unusual in Go.** Code reviewers may be surprised; document the shape in package docs.

---

## Use Cases

### Paginated API ingestion

A search endpoint returns 50 pages of results. The producer goroutine fetches page N, sends it as an inner channel of rows, and moves to page N+1. Bridge gives the consumer a flat stream of rows. The consumer code is unchanged from the case where there is no pagination at all.

### Batch processing with sub-stream results

You queue 200 batches for processing. Each batch produces a sub-stream of records as it completes. The dispatcher sends each batch's output channel onto an outer channel. Bridge concatenates them into one flat output for downstream stages.

### Multiplexed query result sets

A SQL-like engine processes a query that consists of N sub-queries executed in sequence (because each depends on the previous). Each sub-query has its own result channel. Bridge produces the union as a single stream.

### Log file replay

A debugger replays N rotated log files. Each file is opened and streamed line-by-line as an inner channel, then closed. Bridge concatenates them in chronological order.

### Per-session WebSocket message streams

A backend manages user sessions. Each session has a finite life and a finite stream of messages. As sessions arrive, they are sent as inner channels onto an outer "all sessions" channel. Bridge produces the global ordered stream of messages — useful for billing or auditing.

### Iterating over a directory of CSV files

A scanner walks a directory. For each file it opens a goroutine that streams rows out as an inner channel; when the file is done, the channel closes. Bridge produces one flat stream of rows across all files.

---

## Code Examples

### Minimal working example

```go
package main

import (
    "fmt"
)

func bridge[T any](done <-chan struct{}, chanStream <-chan <-chan T) <-chan T {
    valStream := make(chan T)
    go func() {
        defer close(valStream)
        for {
            var stream <-chan T
            select {
            case maybeStream, ok := <-chanStream:
                if !ok {
                    return
                }
                stream = maybeStream
            case <-done:
                return
            }
            for val := range orDone(done, stream) {
                select {
                case valStream <- val:
                case <-done:
                    return
                }
            }
        }
    }()
    return valStream
}

func orDone[T any](done <-chan struct{}, c <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            select {
            case <-done:
                return
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case out <- v:
                case <-done:
                }
            }
        }
    }()
    return out
}

// produce 10 inner channels, each holding the values 0..2.
func genStreams() <-chan <-chan int {
    chanStream := make(chan (<-chan int))
    go func() {
        defer close(chanStream)
        for i := 0; i < 10; i++ {
            inner := make(chan int)
            go func() {
                defer close(inner)
                for j := 0; j < 3; j++ {
                    inner <- j
                }
            }()
            chanStream <- inner
        }
    }()
    return chanStream
}

func main() {
    done := make(chan struct{})
    defer close(done)
    for v := range bridge(done, genStreams()) {
        fmt.Println(v)
    }
}
```

Output:

```
0 1 2 0 1 2 0 1 2 0 1 2 0 1 2 0 1 2 0 1 2 0 1 2 0 1 2 0 1 2
```

Thirty values, in concatenation order. The consumer sees a flat stream and has no idea that the producer emits in pages of three.

### Cancellation mid-stream

```go
done := make(chan struct{})
go func() {
    time.Sleep(20 * time.Millisecond)
    close(done)
}()
n := 0
for v := range bridge(done, slowStreams()) {
    _ = v
    n++
}
fmt.Println("received before cancel:", n)
```

The consumer receives whatever values flowed before `done` closed, then the loop exits cleanly. No goroutine leaks: bridge's goroutine and the inner `orDone` goroutines all exit when they see `done`.

### Bridge with context

Bridge is usually shown with a `done` channel, but `context.Context` works equally well. Just substitute `<-ctx.Done()` everywhere:

```go
func bridgeCtx[T any](ctx context.Context, chanStream <-chan <-chan T) <-chan T {
    valStream := make(chan T)
    go func() {
        defer close(valStream)
        for {
            var stream <-chan T
            select {
            case maybeStream, ok := <-chanStream:
                if !ok {
                    return
                }
                stream = maybeStream
            case <-ctx.Done():
                return
            }
            for {
                select {
                case <-ctx.Done():
                    return
                case v, ok := <-stream:
                    if !ok {
                        goto next
                    }
                    select {
                    case valStream <- v:
                    case <-ctx.Done():
                        return
                    }
                }
            }
        next:
        }
    }()
    return valStream
}
```

Either style is fine. Modern code tends toward `context.Context`; the original Cox-Buday vocabulary uses `done`. Pick one for your codebase and stick with it.

### Pagination example

```go
type Row struct{ ID int }

// fetchPages turns an API client into a stream of pages.
// Each page is a channel that emits its rows then closes.
func fetchPages(done <-chan struct{}, client *Client) <-chan <-chan Row {
    out := make(chan (<-chan Row))
    go func() {
        defer close(out)
        cursor := ""
        for {
            page, next, err := client.Page(cursor)
            if err != nil {
                return
            }
            inner := make(chan Row)
            go func(rows []Row) {
                defer close(inner)
                for _, r := range rows {
                    select {
                    case inner <- r:
                    case <-done:
                        return
                    }
                }
            }(page)
            select {
            case out <- inner:
            case <-done:
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

func processAll(done <-chan struct{}, client *Client) {
    for row := range bridge(done, fetchPages(done, client)) {
        fmt.Println(row.ID)
    }
}
```

The consumer (`processAll`) has no concept of pagination. It just reads rows. That separation is the whole point.

---

## Coding Patterns

### Always pair bridge with `orDone` on the inner channel

The non-negotiable rule. If your bridge's inner read is a plain `for range`, you have a leak when `done` closes mid-inner-channel. Always:

```go
for val := range orDone(done, stream) {
    // ...
}
```

### Producer always closes inner channels

A bridge waits for each inner channel to close before moving on. If the producer forgets to close, bridge stalls forever. Convention: the goroutine that creates an inner channel is the one that closes it, immediately after sending its last value.

```go
go func() {
    defer close(inner) // mandatory
    for _, v := range page {
        inner <- v
    }
}()
```

### Single bridge per `chanStream`

A bridge consumes its outer channel. Two bridges on the same `chanStream` would race for inner channels — undefined behaviour. If two consumers need the same flat stream, run bridge once and `tee` its output.

### Output channel is unbuffered

The canonical bridge uses an unbuffered output, so backpressure propagates all the way to the producer. If you must buffer, document why. Buffered bridges hide pressure and complicate cancellation guarantees.

### Bridge is a leaf — wrap it once

Bridge is a small adapter. Wrap it once in a typed function that exposes only the inputs your call site needs:

```go
func RowStream(done <-chan struct{}, client *Client) <-chan Row {
    return bridge(done, fetchPages(done, client))
}
```

Now the rest of the codebase deals with `<-chan Row`, not `<-chan <-chan Row`.

---

## Clean Code

- Name your bridge result `valStream`, `out`, or the semantic name (`rows`, `events`). Not `c`, not `ch`.
- Name the outer channel `chanStream` to make the level explicit.
- Never inline the `bridge` body into a caller. Keep it as a small named helper.
- Document the closing convention in the producer's doc comment: "Each emitted channel is closed by the producer after its values."
- Keep the `done` parameter first. It matches Cox-Buday's convention and Go's typical pattern.
- Use generics. A non-generic bridge tied to one type is a code-smell — copy-paste lurks.

---

## Product Use / Feature

### A streaming export endpoint

Product wants a CSV download endpoint that streams millions of rows out of a paginated internal API. Without bridge, the handler ends up with nested `range`s, awkward cancellation, and an HTTP handler that is hard to test. With bridge, the handler is:

```go
func exportHandler(w http.ResponseWriter, r *http.Request) {
    done := r.Context().Done()
    enc := csv.NewWriter(w)
    for row := range bridge(done, fetchPages(done, db)) {
        if err := enc.Write(row.toRecord()); err != nil {
            return
        }
    }
    enc.Flush()
}
```

The handler closes cleanly when the client disconnects: `r.Context().Done()` propagates through `bridge` → inner channels → pagination goroutine.

### A batch worker that emits results as it goes

A workflow system processes batches of jobs. Each batch produces a stream of results. Downstream consumers (metrics, alerting, audit log) want one global stream. Bridge converts the batch dispatcher's output (one inner channel per batch) into the flat stream the consumers expect.

### Replaying a series of WAL segments

A database tool wants to replay a series of write-ahead-log segments in order. Each segment is opened, streamed entry-by-entry, and closed. The driver loops over segments and yields each as an inner channel. Bridge produces the flat replay stream.

---

## Error Handling

Channels don't carry errors natively. The two standard approaches:

**1. Result wrapper.** Make the inner channels carry `Result[T]` and let the consumer branch on `err`.

```go
type Result[T any] struct {
    Val T
    Err error
}

func bridge[T any](done <-chan struct{}, chanStream <-chan <-chan Result[T]) <-chan Result[T] {
    /* same body, parameterised on Result[T] */
}
```

**2. Parallel error channel.** The producer maintains a separate `<-chan error`. The consumer selects on both.

The first scales better in pipelines because every stage forwards both value and error together. The second is fine for small pipelines but forces every stage to be aware of two channels.

Whichever you pick, the bridge function itself does not need to change. It treats the values opaquely.

A common bug: a producer goroutine panics inside an inner channel before closing it. The inner channel is never closed, bridge stalls, the consumer sees nothing more, and the diagnosis is hard. Always `defer close(inner)` in the producer, and `defer recover` if the producer might panic.

---

## Security Considerations

- **Memory blow-up.** If the outer `chanStream` runs ahead of consumption (because someone made it buffered), inner channels pile up. A malicious or buggy producer could exhaust memory. Keep `chanStream` unbuffered, or at least bounded.
- **Resource handles in inner channels.** If an inner channel holds file descriptors or network connections, cancellation must actually close them. Bridge's `done` does not close handles for you; it just stops reading. Pair bridge with `defer file.Close()` in the producer.
- **Untrusted upstream sources.** When bridging input from a remote producer (e.g. a gRPC stream of streams), validate the length and content of each inner channel. Bridge does not enforce any limits.
- **Slow consumer DoS.** Because bridge is unbuffered, a slow consumer slows the producer. Usually a feature, not a bug — but in a public-facing system the producer may be holding a per-request transaction. Time-bound long bridges with `context.WithTimeout`.

---

## Performance Tips

- **One goroutine, not N.** Don't try to parallelise bridge by launching one goroutine per inner channel. That is fan-in. Use the right tool.
- **Avoid buffering the output.** A buffered output channel rarely helps and can mask cancellation latency. Profile before you buffer.
- **Inline the `orDone` if hot.** A single bridge in a tight loop adds two goroutines and four channel ops per value. For most code this is irrelevant. For 10M+ items per second, inline the cancellation guard manually.
- **Batch the inner values.** If your inner channel emits individual ints and the consumer is a SQL inserter, prefer sending `[]int` chunks. Bridge then forwards chunks; the bytes per channel-op drop.
- **Drop the bridge in pure-CPU code.** If every value triggers a tiny computation, the channel overhead may dominate. Consider a slice-of-slices and a flat range. Bridge shines when work is non-trivial or I/O-bound.

---

## Best Practices

- **Pair with `orDone` always.** The implementation in this page is the minimum. Anything simpler is a leak.
- **Wrap and rename.** Don't pass `<-chan <-chan T` around your codebase. Bridge it once, expose `<-chan T`.
- **Close inner channels promptly.** The producer of each inner channel must close it. Document this contract.
- **Pass `done` (or `ctx`) first.** Match Go conventions; reviewers expect it.
- **Test the cancellation path.** Write a test that closes `done` halfway through one of the inner channels; assert bridge exits and no goroutines leak.
- **Document the shape in producer doc comments.** "Returns a stream of per-page channels; each is closed after its rows." Make the contract explicit.

---

## Edge Cases & Pitfalls

### A nil inner channel

If the outer producer sends a nil channel, the inner `for val := range orDone(done, nil)` will block forever, because `orDone` is itself ranging over a nil channel inside its select. The bridge never moves on. Guard at the producer side; do not emit nil inner channels.

### An inner channel that never closes

Same effect: bridge waits forever for it to close. The producer that creates an inner channel must close it. If you receive a channel from outside your package and aren't sure, wrap it in a timeout-aware forwarder.

### Outer `chanStream` closes mid-inner

If the outer channel closes while the current inner is still being drained, bridge correctly finishes draining the inner before exiting. The closing of the outer is not seen until the inner is exhausted. This is by design — you get every value the producer promised.

### Empty inner channels

An inner channel that is closed immediately without sending anything is fine. Bridge sees the close, moves on. Zero overhead beyond the channel allocation.

### `done` closed before any reads

If `done` is closed before bridge has time to pull the first inner channel, the outer select fires on `done` and bridge exits. The output channel is closed; the consumer's `for range` sees no values and exits.

### Double close

Bridge closes its output via `defer close(valStream)`. Do not close it from outside. Channels closed twice panic — the same rule as everywhere in Go.

---

## Common Mistakes

### Forgetting `orDone` on the inner read

The classic. The code looks correct, the tests pass when nothing cancels, but the moment a `done` is closed mid-inner-stream, the bridge's goroutine is stuck on `<-stream` forever. Always use `orDone` (or inline a select that watches `done`).

### Inlining bridge instead of using a helper

A nested `for range` over `chanStream` and then over each inner channel "looks like" bridge but quickly accumulates the cancellation, draining, and closing logic at every call site. Move it into a helper.

### Buffering the output channel "for performance"

A buffered output decouples the consumer's pace from the producer's. Backpressure is lost. If the consumer disappears, the buffered values sit in memory. Almost never the right move.

### Reading the same outer channel from two bridges

If two goroutines both read `chanStream` to bridge it, each will get half the inner channels — neither sees the full flat stream. Bridge once, tee its output if multiple consumers need the same flat stream.

### Returning `<-chan <-chan T` from a public package

This is a leak of internal shape. Bridge it inside the package and return `<-chan T`. The two-level type is hard for callers to use and harder still to evolve.

### Treating bridge as fan-in

If your goal is to merge values from many concurrent sources, you want fan-in, not bridge. Bridge serialises; fan-in interleaves. We discuss the comparison in middle level.

---

## Common Misconceptions

### "Bridge is just `for range` plus `for range`"

It is not. A bare double-`range` has no cancellation, no graceful close, and no goroutine boundary. Bridge is the smallest correct combinator that includes all three.

### "Bridge processes inner channels in parallel"

It does not. It reads them one at a time, strictly serial.

### "Buffering the output makes bridge faster"

It changes shape but rarely speeds up the consumer. The consumer's pace is the bottleneck almost always. Buffer only with measurements.

### "`done` is the same as cancelling each inner channel"

`done` does not close inner channels. It just tells the bridge to stop reading. The inner channels are still alive after `done` closes; their producer goroutines should also be watching `done` and bowing out.

### "Bridge belongs in the standard library"

It does not. Like or-done, tee, and other Cox-Buday combinators, it lives in user code or third-party packages. The Go team has not added them, preferring `context.Context` for cancellation and leaving stream patterns to libraries.

---

## Tricky Points

### Why is the inner `select` on send required?

Inside the inner loop, `case valStream <- val` is in a `select` with `<-done`. Without that select, sending `val` could block forever if the consumer disappears, and bridge would never see `done`. The select makes the send cancellable.

### Why range over `orDone`, not over `stream`?

`orDone(done, stream)` produces a channel that closes when `done` closes. Ranging over it makes the inner loop naturally exit on cancellation. Ranging over `stream` directly would block on `<-stream` even if `done` was already closed.

### Why one helper goroutine, not zero?

`bridge` returns a channel; for the caller to range over it, something must send into it. A function cannot "be" a channel. The simplest implementation runs a single helper goroutine that does the reading-and-forwarding. There is no way to avoid that one goroutine in pure Go.

### Why doesn't bridge close inner channels?

A bridge is a reader of inner channels, not their owner. The party who created an inner channel is responsible for closing it. Bridge merely consumes.

### Can bridge be infinite?

Yes. As long as the outer `chanStream` keeps emitting inner channels, and each inner channel eventually closes, bridge runs forever. Memory does not grow because each inner channel is fully drained before the next one is read.

---

## Test

### Basic correctness

```go
func TestBridgeConcatenates(t *testing.T) {
    done := make(chan struct{})
    defer close(done)

    chanStream := make(chan (<-chan int), 3)
    a := make(chan int, 2); a <- 1; a <- 2; close(a)
    b := make(chan int, 2); b <- 3; b <- 4; close(b)
    c := make(chan int, 1); c <- 5; close(c)
    chanStream <- a
    chanStream <- b
    chanStream <- c
    close(chanStream)

    var got []int
    for v := range bridge(done, chanStream) {
        got = append(got, v)
    }
    if !reflect.DeepEqual(got, []int{1, 2, 3, 4, 5}) {
        t.Fatalf("got %v", got)
    }
}
```

### Cancellation test

```go
func TestBridgeCancellation(t *testing.T) {
    done := make(chan struct{})
    chanStream := make(chan (<-chan int))
    inner := make(chan int)
    go func() { chanStream <- inner; close(chanStream) }()
    out := bridge(done, chanStream)
    close(done)
    // Reading after cancel should not block forever.
    select {
    case _, ok := <-out:
        if ok {
            t.Fatal("expected no value")
        }
    case <-time.After(time.Second):
        t.Fatal("bridge did not exit after done")
    }
}
```

### Empty inner channel

```go
func TestBridgeEmptyInner(t *testing.T) {
    done := make(chan struct{})
    defer close(done)
    cs := make(chan (<-chan int), 2)
    empty := make(chan int); close(empty)
    full := make(chan int, 1); full <- 42; close(full)
    cs <- empty
    cs <- full
    close(cs)
    var got []int
    for v := range bridge(done, cs) {
        got = append(got, v)
    }
    if !reflect.DeepEqual(got, []int{42}) {
        t.Fatalf("got %v", got)
    }
}
```

---

## Tricky Questions

**Q: What happens if the producer never closes an inner channel?**
Bridge stalls on it. The next inner channel is never read. Fix: discipline the producer.

**Q: What happens if the consumer stops reading?**
Bridge blocks in `valStream <- val`. The inner select-on-send watches `done`, so closing `done` unblocks it. If the consumer simply abandons the loop without closing `done`, bridge leaks.

**Q: Does bridge guarantee FIFO order across inner channels?**
Yes, strictly. Inner channel #N's values are seen before any value from inner channel #N+1.

**Q: Could you replace bridge with a buffered channel plus a goroutine pool?**
No. Bridge guarantees order and serialises. A pool would parallelise; the output order would no longer match input order.

**Q: How does bridge differ from `or` (the other Cox-Buday combinator)?**
`or` returns a single channel that closes when *any* of N inputs closes. `bridge` reads inputs *in sequence* and produces a flat stream. Different shapes, different uses.

**Q: Why generic `T` and not `interface{}`?**
Type safety, no allocations from boxing, no type assertions at the call site. Pre-1.18 code used `interface{}`; modern code should not.

**Q: Can bridge be implemented without `orDone`?**
Yes, by inlining the select. The result is messier and the cancellation contract harder to reason about. Don't.

---

## Cheat Sheet

```go
// Shape:
//   producer:  <-chan <-chan T
//   consumer:  <-chan T
//   bridge:    converts the first into the second

bridge(done, chanStream) <-chan T

// Always: pair with orDone on inner read.
// Always: producer closes each inner channel.
// Always: pass done (or ctx) first.
// Always: one bridge per chanStream.
// Never:  buffer the output without a measured reason.
// Never:  emit nil inner channels.
// Never:  read the same chanStream from two bridges.
```

Memorise the 18-line generic `bridge` and the 16-line `orDone`. Together they cover 95% of channel-of-channels needs.

---

## Self-Assessment Checklist

- [ ] I can write the generic `bridge` function from scratch in under five minutes.
- [ ] I can explain why the inner read uses `orDone` rather than `range stream`.
- [ ] I can name three real situations where the producer's natural output is `<-chan <-chan T`.
- [ ] I can describe what bridge does that fan-in does not, and vice versa.
- [ ] I can identify a leaked goroutine in a bridge implementation.
- [ ] I can convert a `done`-based bridge to a `context.Context`-based bridge.
- [ ] I can predict bridge's behaviour for: empty inner, nil inner, never-closing inner, `done` closed early.
- [ ] I can write a unit test that proves bridge exits cleanly on cancellation.

---

## Summary

Bridge is the channel-of-channels adapter. It takes `<-chan <-chan T` and gives back `<-chan T` by reading each inner channel to completion in order. The implementation is one helper goroutine, one outer loop, one inner loop with `orDone`, and two select-cancel guards. Pair it with `orDone` for cancellation, with disciplined producers for closing, and with generics for type safety, and you have a small, reliable adapter that turns awkward two-level streams into simple flat ones.

It is not a parallelism tool. It is a shape adapter. Reach for it when your producer's output is naturally a sequence of finite sub-streams and your consumer wants a flat sequence of values.

---

## What You Can Build

- A streaming CSV export from a paginated database query, with proper cancellation.
- A log replayer that concatenates multiple rotated log files into one ordered stream.
- A test harness that drives a worker through a sequence of synthetic batches.
- A wrapper that converts a "callback once per page" API into a Go-friendly `<-chan Row`.
- A workflow engine where each step produces a sub-stream, and the workflow's overall output is the bridge.

---

## Further Reading

- Cox-Buday, K. *Concurrency in Go*. O'Reilly, 2017. Chapter 4: "Concurrency Patterns in Go." The original presentation of bridge, or-done, tee, and or.
- The `01-or-done-channel` page in this section.
- The `02-tee-channel` page in this section.
- The `05-concurrency-patterns/01-fan-in` page — comparison with the dynamic-many-to-one shape.
- Go blog: "Pipelines and cancellation" (https://go.dev/blog/pipelines). Predates context, but the cancellation thinking is the same.
- The `context` package documentation, for the modern cancellation idiom.

---

## Related Topics

- `or-done-channel` — the building block bridge depends on.
- `fan-in` — the related but different shape (dynamic N-over-time vs static N-to-1).
- `pipeline` — bridge is often a stage inside a longer pipeline.
- `generator` — generators often produce sub-streams that bridge then flattens.
- `context.Context` — the modern way to propagate cancellation through bridge.
- `tee-channel` — pair with bridge when one flat stream must feed multiple consumers.

---

## Diagrams & Visual Aids

```
Outer channel of channels:        chanStream
                                    |
                                    | yields  c1, c2, c3, ...
                                    v
                                +-------+
                                | bridge|
                                +-------+
                                    |
                                    v
                              flat stream out
                          (v1.1 v1.2 v2.1 v3.1 v3.2 ...)
```

Concatenation, not interleaving:

```
c1:  [a, b, c]
c2:  [d, e]
c3:  [f, g, h]

bridge output: a, b, c, d, e, f, g, h
```

Compare with fan-in:

```
c1:  [a, b, c]
c2:  [d, e]
c3:  [f, g, h]

fan-in output: a, d, f, b, e, g, c, h   (interleaved, non-deterministic)
```

Cancellation propagation:

```
done closed
    |
    v
bridge's outer select fires --> exit
bridge's inner select fires --> exit
orDone's select fires       --> exit
```

Three escape hatches; all observe the same `done`.
