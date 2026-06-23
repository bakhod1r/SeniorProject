# Bridge-Channel — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Bridge in a Stream-Algebra Mindset](#bridge-in-a-stream-algebra-mindset)
3. [Implementation Variants](#implementation-variants)
4. [Bridge with Parallelism: a Hybrid](#bridge-with-parallelism-a-hybrid)
5. [Memory and Scheduler Trade-offs](#memory-and-scheduler-trade-offs)
6. [Correctness Proofs and Invariants](#correctness-proofs-and-invariants)
7. [Bridge Inside Distributed Systems](#bridge-inside-distributed-systems)
8. [Observability: Tracing Bridge](#observability-tracing-bridge)
9. [Lifecycle Ownership](#lifecycle-ownership)
10. [Comparison with Reactive Stream Operators](#comparison-with-reactive-stream-operators)
11. [Refactoring Existing Code to Use Bridge](#refactoring-existing-code-to-use-bridge)
12. [When Bridge Is the Wrong Answer](#when-bridge-is-the-wrong-answer)
13. [Production Hardening](#production-hardening)
14. [Architecture Review Checklist](#architecture-review-checklist)
15. [Summary](#summary)

---

## Introduction

At senior level, bridge is no longer a function — it is a design decision. Its presence in your code carries information: "the producer emits sub-streams over time, the consumer wants a flat view, and we will pay a fixed one-goroutine cost to make the seam invisible." The questions to answer at this level are not about the body of the function but about its role in the system.

Three themes:

1. **Algebra.** Bridge is `concatMap` from reactive vocabulary. Knowing the algebra lets you predict where it composes well and where it fights you.
2. **Lifecycle.** Bridge sits at a seam between two ownership domains. Understanding who closes what is the difference between a robust system and a leak farm.
3. **When not.** A senior engineer rejects bridge for the right reasons as often as accepting it.

The pattern was named in Katherine Cox-Buday's *Concurrency in Go* (O'Reilly, 2017). Most senior-level discussions in this file go beyond the book.

---

## Bridge in a Stream-Algebra Mindset

If you have used a reactive library — RxJS, Project Reactor, Akka Streams — you have met bridge before, under different names:

| Library | Name |
|---------|------|
| RxJS | `concatAll`, `concatMap` |
| Project Reactor | `concat`, `concatMap` |
| Akka Streams | `flatMapConcat` |
| Kotlin Flow | `flatMapConcat` |
| Cox-Buday Go | `bridge` |

The common semantics: given an outer stream of inner streams, concatenate the inner streams *in order*, *without interleaving*. The dual operator is `mergeAll` / `flatMap` / `flatMapMerge`, which interleaves — that is fan-in over a bridge's input.

Knowing the algebra has practical value:

- You can reason about composition. `bridge` distributes over identity-preserving stages: `bridge ∘ map f = map f ∘ bridge`.
- You can spot when a *different* operator is what you really need (most often `mergeAll` when you actually want parallel sub-stream consumption).
- You can describe your design to engineers familiar with other ecosystems without re-deriving the pattern.

A useful informal type for thinking:

```
bridge : Stream (Stream a) -> Stream a
flatMap f : (a -> Stream b) -> Stream a -> Stream b
```

`flatMap f xs = bridge (map f xs)`. Bridge is the flattening primitive; everything else builds on it.

---

## Implementation Variants

### 1. The canonical, ctx-first form

```go
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

### 2. Done-channel form (Cox-Buday original)

Take `done <-chan struct{}` instead of `ctx`. Identical structure. Use when integrating with code that pre-dates `context`.

### 3. Iterator-based form

In Go 1.23+, you can return `iter.Seq[T]` instead of a channel:

```go
func BridgeSeq[T any](chanStream <-chan <-chan T) iter.Seq[T] {
    return func(yield func(T) bool) {
        for stream := range chanStream {
            for v := range stream {
                if !yield(v) {
                    return
                }
            }
        }
    }
}
```

Range-over-func gives a synchronous reader, removes the helper goroutine, and removes the need for ctx — the consumer cancels by returning `false` from its body. The cost: no concurrent producer, no cancellation while blocked in an inner receive. Use when the consumer is purely synchronous and the inner channels are well-behaved.

### 4. Inlined-OrDone form

For hot paths where one extra channel hop matters:

```go
func BridgeFast[T any](ctx context.Context, chanStream <-chan <-chan T) <-chan T {
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
            for {
                select {
                case <-ctx.Done():
                    return
                case v, ok := <-stream:
                    if !ok {
                        goto next
                    }
                    select {
                    case <-ctx.Done():
                        return
                    case out <- v:
                    }
                }
            }
        next:
        }
    }()
    return out
}
```

Less readable, one fewer goroutine and one fewer channel per inner stream. Benchmark before adopting.

### 5. Bridge-with-error form

```go
type Result[T any] struct {
    Val T
    Err error
}

func BridgeResults[T any](ctx context.Context, cs <-chan <-chan Result[T]) <-chan Result[T] {
    return Bridge(ctx, cs)
}
```

No structural change. Wrap the type.

---

## Bridge with Parallelism: a Hybrid

Pure bridge is serial. If you need to drain inner channels in parallel — say, each inner channel comes from a separate slow remote shard — you want a hybrid:

```go
// BridgeParallel reads up to K inner channels concurrently and merges their
// values into a single output. Order across inner channels is no longer
// guaranteed.
func BridgeParallel[T any](ctx context.Context, k int, chanStream <-chan <-chan T) <-chan T {
    out := make(chan T)
    sem := make(chan struct{}, k)
    var wg sync.WaitGroup
    go func() {
        defer func() {
            wg.Wait()
            close(out)
        }()
        for {
            select {
            case <-ctx.Done():
                return
            case s, ok := <-chanStream:
                if !ok {
                    return
                }
                select {
                case sem <- struct{}{}:
                case <-ctx.Done():
                    return
                }
                wg.Add(1)
                go func(stream <-chan T) {
                    defer wg.Done()
                    defer func() { <-sem }()
                    for v := range OrDone(ctx, stream) {
                        select {
                        case <-ctx.Done():
                            return
                        case out <- v:
                        }
                    }
                }(s)
            }
        }
    }()
    return out
}
```

This is no longer pure bridge — it is `flatMapMerge` with bounded concurrency. **Document the name change.** Calling it "bridge" causes confusion.

When to choose `BridgeParallel`:

- Each inner channel is independently slow (network, CPU-bound work).
- Order across inner channels does not matter.
- The total number of inner channels is large and serial draining is unacceptable.

When to stick with `Bridge`:

- Order matters.
- Inner channels are quick and the serial cost is negligible.
- You want backpressure to apply per inner stream.

---

## Memory and Scheduler Trade-offs

Bridge's resource costs:

- **Goroutines.** Pure bridge: 1 helper, plus 1 inside `OrDone`, totalling 2 per active bridge instance. Hybrid with K-parallelism: up to K+1 helpers + K OrDones.
- **Channels.** Pure bridge allocates one output channel (lifetime = bridge lifetime). Each `OrDone` allocates one internal channel per inner stream. Per-value cost: 0 allocations on the hot path if all values are by value, not pointer.
- **Scheduler pressure.** Each value through pure bridge causes ~3 channel operations and 2 goroutine context-switches. Negligible at < 1M values/sec.

The two most common "why is bridge slow?" diagnoses:

1. The producer is the bottleneck, not bridge. Replace synthetic benchmarks with realistic ones.
2. The consumer is slow. Bridge is unbuffered; the consumer's pace is the system's pace.

If bridge truly is hot, the levers in order of effectiveness:

1. Batch the value type: send `[]T` instead of `T`.
2. Inline `OrDone`.
3. Switch to `iter.Seq` if the consumer is synchronous.
4. Replace with a flat slice-of-slices when streaming isn't needed.

---

## Correctness Proofs and Invariants

Three invariants to verify when implementing or reviewing bridge.

### Invariant 1: every value is forwarded at most once

Bridge has no internal queue and no retry. Every send is paired one-to-one with a receive from an inner channel. Loss can only happen if the bridge goroutine exits while holding a received value not yet sent — and we ensure this by always selecting the send against `ctx.Done()`. If `done` fires between receive and send, the value is dropped, which is the correct behaviour for cancellation: no value after the cancellation point should be observed.

### Invariant 2: bridge's output closes exactly once

`defer close(out)` is the only close, in exactly one place. The function never returns early without going through the defer.

### Invariant 3: bridge does not close inner channels

This is the contract with the producer. If bridge closes an inner channel that the producer expects to close itself, the producer panics on its next send.

### Termination guarantee

For any input `chanStream` and `ctx`, bridge's output channel closes in bounded time after either:

- `chanStream` is closed and the last inner channel is drained, OR
- `ctx` is cancelled.

Bounded time means: at most one value-receive worth of latency per layer.

Write a stress test that runs many bridges concurrently with random cancellation and asserts every output channel closes within a deadline. Pair with `goleak`.

---

## Bridge Inside Distributed Systems

A common shape: a gRPC server streams responses in batches. Each batch is itself paginated. The server uses `bridge` internally to flatten its work; the client uses something analogous (a per-RPC reader, then a bridge that concatenates RPC results from multiple shards in order).

The hard part: **what counts as "inner"** and **where does the seam live**.

- If you bridge at the RPC layer, an RPC failure unwinds the whole bridge. Correct for atomic queries.
- If you bridge at the shard layer, a shard failure can be swallowed and the consumer is misled into thinking the stream is complete. Always propagate errors through the wrapper.

In a multi-region read fan-out, bridge is rarely the right tool: order across regions doesn't matter. Fan-in is the natural fit. Use bridge when the producer's output is *logically sequential* across sub-streams (paginated reads, time-windowed batches, replay of WAL segments).

### Pitfall: bridge over network with no timeout

A remote producer that stops mid-stream (e.g. TCP RST never delivered) leaves bridge waiting on an inner channel forever. Always pair with `context.WithTimeout` or `context.WithDeadline` at the RPC layer, *not* just at the bridge layer.

---

## Observability: Tracing Bridge

Bridge is invisible by default. To trace it, instrument:

- Outer channel: log when a new inner channel arrives. Counter: "inner_started".
- Inner channel: log when it closes. Counter: "inner_finished". Histogram: "inner_value_count".
- Output: counter: "out_values". Counter: "out_closed_due_to_cancel" vs "out_closed_due_to_eof".

A minimal wrapper:

```go
func TracedBridge[T any](ctx context.Context, name string, chanStream <-chan <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        innerCount := 0
        for {
            var stream <-chan T
            select {
            case <-ctx.Done():
                metrics.IncBridgeCancel(name)
                return
            case s, ok := <-chanStream:
                if !ok {
                    metrics.IncBridgeFinish(name, innerCount)
                    return
                }
                stream = s
                innerCount++
            }
            values := 0
            for v := range OrDone(ctx, stream) {
                select {
                case <-ctx.Done():
                    return
                case out <- v:
                    values++
                }
            }
            metrics.ObserveInnerValues(name, values)
        }
    }()
    return out
}
```

Distributed tracing: pass the `ctx` through; spans are propagated through inner channels' producers. Bridge itself does not need its own span — it sits between spans.

---

## Lifecycle Ownership

The clearest mental model for bridge's lifecycle:

```
producer of chanStream  --owns-->  outer channel; closes when done
producer of each inner  --owns-->  that inner; closes when done
bridge                  --owns-->  output channel; closes when both upstream conditions are met OR ctx is cancelled
consumer                --owns-->  ctx; cancels to signal "stop"
```

Each line is a hard rule. Violations create leaks or panics.

The most common violation: a goroutine other than the one that created the inner channel tries to close it. Bridge cannot enforce this, so document it loudly in the producer's contract.

A useful sanity check: walk the code and label each `close()` call with which goroutine owns it. If two goroutines could close the same channel, you have a bug.

---

## Comparison with Reactive Stream Operators

For engineers coming from RxJS or Reactor, the mapping:

| Go (Cox-Buday) | RxJS | Reactor |
|----------------|------|---------|
| `bridge` | `concatAll` | `concat` |
| `flatMap` (equiv: map+bridge) | `concatMap` | `concatMap` |
| `BridgeParallel(k)` | `mergeAll(k)` | `flatMap(k)` |
| `Or` | `race` | `firstWithSignal` |
| `Tee` | `share` (with replay) | `share` |

Reactive libraries make these operators first-class because the language doesn't have channels. Go has channels, so we get to write the operators as small functions. The downside: each library or codebase ends up with its own version. Standardise within your codebase early.

Operator algebra carries over:

- `bridge ∘ map(f) = map(f) ∘ bridge` — pure map commutes with bridge.
- `bridge ∘ filter(p) ≠ filter(p) ∘ bridge` in general — filtering inner channels doesn't commute, because filter inside bridge filters values within an inner; filter after bridge filters across the whole flat stream.
- Composition with cancellation: a single `ctx` flows through every operator. Don't create per-operator contexts.

---

## Refactoring Existing Code to Use Bridge

Signals that a codebase needs bridge:

1. A function returns `chan T` and the caller has to track "is this a batch?" themselves.
2. A consumer has a hand-written double `for range` over channels.
3. A "page fetcher" returns a slice of pages, each itself a slice, forcing callers to do two loops.
4. Cancellation propagation is broken in a paginated consumer.

The refactor:

1. Identify the producer that emits "groups of values."
2. Restructure it to emit `<-chan <-chan T`.
3. Drop bridge in between.
4. Delete the double `for range` from consumers.

Beware: changing a public function's signature from `<-chan T` to `<-chan <-chan T` is a breaking change. Add a new function rather than mutate; deprecate the old.

---

## When Bridge Is the Wrong Answer

### When inner channels can be merged out-of-order

Use fan-in. Bridge wastes the natural parallelism.

### When values are not naturally streaming

If pages already arrive as slices of slices in memory, just iterate them. No channels needed. Bridge adds goroutine overhead for zero benefit.

### When ordering across the *whole* flat stream must be globally sorted

Bridge concatenates by arrival order of inner channels, not by value order. If you need globally sorted output you need a k-way merge, not bridge.

### When inner channels overlap in time

If two inner channels can be live concurrently and you want to read both as they arrive, you want a `BridgeParallel` or fan-in — not pure bridge.

### When the producer can't be made to close inner channels

Bridge requires inner channels to close. If you cannot make the producer comply, do not use bridge; you will stall.

### When the value type is `chan T` for unrelated reasons

If the channel-of-channels shape is accidental (e.g. some legacy interface), refactor the producer rather than introducing bridge. Bridge is a tool for intentional shapes.

---

## Production Hardening

Beyond the canonical implementation:

- **Wrap in a typed helper.** Hide the `<-chan <-chan T` inside your package; expose only `<-chan T`.
- **Add a goroutine name (Go 1.20+ debug pprof labels).** `pprof.SetGoroutineLabels` lets you name bridge's goroutine for easier diagnosis.
- **Metrics.** Counters for inner-started, inner-finished, values-forwarded, cancellations.
- **Tests.** Unit tests for the four basic shapes (empty outer, empty inner, full stream, cancel-mid). Property test for order preservation. `goleak` test for no leaks.
- **Documentation.** Every producer that emits `<-chan <-chan T` must document: "Each emitted channel is closed by the producer after its values are sent."

---

## Architecture Review Checklist

When reviewing a design that uses bridge, ask:

- [ ] Why is the producer's natural shape `<-chan <-chan T`? Could it be `<-chan T` directly?
- [ ] Does each inner channel have a clear "producer" that closes it?
- [ ] Does cancellation propagate from the consumer to every producer goroutine?
- [ ] Is there a global timeout?
- [ ] Are inner channels buffered? Why?
- [ ] Is the output channel buffered? Why?
- [ ] Does the consumer know the order semantics (concatenation, not sorted)?
- [ ] Is there a metric / log to count inner channels processed?
- [ ] Has a leak test been written?
- [ ] Is bridge wrapped behind a typed helper in the public API?

If you can answer "yes" to all of these, bridge is being used well.

---

## Summary

Bridge at senior level is a vocabulary item and a design decision. It is the channel-of-channels flattener, equivalent to `concatAll` in reactive libraries, useful when the producer's natural output is a sequence of finite sub-streams and the consumer wants a flat view. Its strict serial semantics make it the wrong tool for parallel sub-stream consumption — for that, write a clearly-named hybrid. Its correctness rests on three invariants: at-most-once delivery, single output close, no inner-channel ownership. Its production use needs metrics, leak tests, and clear contract documentation. When all those are in place, bridge is a small, predictable, composable adapter that disappears into the design.
