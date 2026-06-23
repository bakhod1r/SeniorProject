# Bridge-Channel — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Bridge in System-Level Designs](#bridge-in-system-level-designs)
3. [Cross-Process Bridge: Streams over the Wire](#cross-process-bridge-streams-over-the-wire)
4. [Bridge as a Compiler-Friendly Abstraction](#bridge-as-a-compiler-friendly-abstraction)
5. [Bridge in High-Throughput Pipelines](#bridge-in-high-throughput-pipelines)
6. [Bridge in Reliability and Replay](#bridge-in-reliability-and-replay)
7. [Bridge in the Go Ecosystem](#bridge-in-the-go-ecosystem)
8. [Designing Public APIs That Use Bridge](#designing-public-apis-that-use-bridge)
9. [Bridge as a Teaching Tool](#bridge-as-a-teaching-tool)
10. [Future Directions: Iterators, Channels v2](#future-directions-iterators-channels-v2)
11. [Summary](#summary)

---

## Introduction

At professional level, the question is no longer "how do I write bridge?" but "where does bridge fit in a system, and how does it interact with the rest of the architecture?" Bridge is a tiny function. The systems that contain it are not.

We focus on five themes:

- **System role.** Bridge as a shape adapter at the boundary between subsystems.
- **Public API design.** When `<-chan T` is the right contract, and when it isn't.
- **Throughput.** What bridge costs in real pipelines, and how to keep it fast.
- **Reliability.** Bridge in replay, recovery, and idempotent processing.
- **Future.** How bridge evolves as Go gains `iter.Seq` and richer concurrency primitives.

The original pattern is from Katherine Cox-Buday's *Concurrency in Go* (O'Reilly, 2017). The professional perspective takes it further into production systems thinking.

---

## Bridge in System-Level Designs

A useful design heuristic: **bridge lives at a seam where ownership changes hands.**

- The producer owns its goroutines, its inner channels, and its closing discipline.
- The consumer owns its iteration loop and its context.
- Bridge owns nothing except its own helper goroutine and output channel.

That makes bridge a natural firewall between subsystems written by different teams or maintained at different rates. The producer team can change pagination strategy, add retries, swap underlying transports — as long as it keeps emitting `<-chan <-chan T` with the closing discipline. The consumer team sees a flat `<-chan T` and is unaffected.

In practice this manifests as the canonical wrapping:

```go
package userexport

func (s *Service) StreamUsers(ctx context.Context, query Query) <-chan User {
    return Bridge(ctx, s.paginate(ctx, query))
}

func (s *Service) paginate(ctx context.Context, query Query) <-chan <-chan User { /* internal */ }
```

The public method exposes `<-chan User`. The internal method exposes the two-level shape, which only the package uses.

---

## Cross-Process Bridge: Streams over the Wire

Inside a single process, bridge is trivial. Across processes — gRPC, NATS, Kafka — the same logical shape arises but needs a different implementation.

### gRPC server-side bridge

A streaming gRPC RPC that produces results in pages can use bridge internally:

```go
func (s *Server) ListAll(req *pb.ListReq, stream pb.Svc_ListAllServer) error {
    ctx := stream.Context()
    for row := range Bridge(ctx, s.paginate(ctx, req)) {
        if err := stream.Send(row.toProto()); err != nil {
            return err
        }
    }
    return nil
}
```

The seam between paginated internal storage and the RPC is the bridge.

### Client-side bridge across shards

A client that fans a query out to N shards may want to surface all results as one flat stream. Two approaches:

1. **Fan-in.** If order doesn't matter — most common case.
2. **Bridge.** If shards must be queried in a specific order (e.g. by time window).

A common bug: confusing the two. If you bridge across N shards expecting parallelism, you get serial reads — the second shard never sends a value until the first is exhausted.

### Bridge over a message broker

Inner "channels" can be conceptual: a sequence of topics, each itself a finite stream. A consumer that bridges over them:

```go
for _, topic := range topics {
    inner := consumeUntilEOF(ctx, topic)
    chanStream <- inner
}
```

The seam: each topic is a finite sub-stream; the consumer wants a flat stream. The same semantic shape as the in-process pattern.

---

## Bridge as a Compiler-Friendly Abstraction

Go's compiler does not optimise channel operations heavily. Each channel send/receive is a function call into `runtime.chansend` / `runtime.chanrecv`. Bridge therefore costs roughly:

- One channel op per inner channel acquisition (outer receive).
- One channel op per value (inner receive).
- One channel op per value (output send).
- Plus the `OrDone` overhead — one extra channel op per value if not inlined.

Total: ~3 channel ops per value, ~50–150 ns on modern CPUs. Bridge does not generally show up in CPU profiles unless the rest of the work per value is itself trivial.

Things that *do* show up:

- Allocations from `make(chan T)` when inner channels are short. If you bridge a million 1-element inner channels per second, the allocator hurts. Solution: encourage the producer to batch.
- Goroutine creation per inner channel if your `OrDone` is fresh each time. Bridge launches one OrDone per inner channel.

For most code, none of this matters. For the rare hot path:

- Use a single inlined-OrDone bridge variant.
- Switch to `iter.Seq` (Go 1.23+) — no helper goroutine, no per-inner allocation.

---

## Bridge in High-Throughput Pipelines

In an ETL pipeline that processes hundreds of millions of records:

```go
src := paginatedSource(ctx, query)                 // <-chan <-chan Row
flat := Bridge(ctx, src)                            // <-chan Row
parsed := parsePool(ctx, flat, 8)                   // <-chan ParsedRow
enriched := enrichPool(ctx, parsed, 16)             // <-chan EnrichedRow
batched := batch(ctx, enriched, 5000)               // <-chan []EnrichedRow
writeBatches(ctx, batched, sink)
```

Bridge sits near the source. Downstream, fan-out pools introduce parallelism. The bridge keeps producer order, but the parallel pools downstream reshuffle — so global order is not preserved. If that matters, sort downstream; if not, bridge near the source is correct.

A subtle production lesson: **don't put bridge in the middle of a hot pipeline.** Its serial semantics there are usually wrong. Bridge is near the boundaries: source-side or sink-side, where the stream-of-streams shape is natural.

### Capacity math

Suppose pagination delivers 100 rows per page, page latency is 50 ms, downstream can process 5000 rows/sec.

- Pure bridge throughput: 100 rows / 50 ms = 2000 rows/sec. Bridge is the bottleneck.
- BridgeParallel(k=4) throughput: 4 × 2000 = 8000 rows/sec, exceeds consumer.

If the consumer is the bottleneck (5000 rows/sec) and bridge alone can do 2000, you need parallelism upstream. Either use `BridgeParallel` or pre-fetch pages concurrently and emit them onto `chanStream` as they finish — losing the serial-arrival guarantee but maintaining the bridge interface.

---

## Bridge in Reliability and Replay

A common pattern: a recovery routine replays a series of WAL segments. Each segment is a finite stream of entries. The recovery system bridges across segments to produce a single replay stream, then feeds it into the apply loop.

The reliability concerns:

- **Idempotency.** The apply loop must handle replays of already-applied entries. Bridge doesn't dedupe.
- **Partial replay.** If recovery is cancelled mid-segment, the next run must continue from the right place. Bridge doesn't checkpoint; the apply loop does.
- **Order.** The order of segments must match the WAL's logical order. Bridge preserves the order of inner-channel arrivals; the producer must arrange segments correctly.

Bridge is a passive shape adapter. It does not provide reliability features. Pair it with explicit checkpointing in the consumer.

### Crash safety

If the bridge process crashes mid-stream, the inner channels' producers are killed. On the next run, the producer must be able to resume. Common designs:

- Cursor-based pagination: the cursor is the resume token.
- Offset-based reads: the consumer commits offsets periodically.

Bridge does nothing for crash safety; it just streams. Design the producer and consumer for resumability.

---

## Bridge in the Go Ecosystem

The Go standard library does not include bridge. Several third-party libraries do something equivalent or composable:

- **`github.com/reugn/go-streams`** — provides a stream-processing DSL with operators like `FlatMap` that play the bridge role.
- **`github.com/destel/rill`** — concurrency-focused stream operators; includes ordered flatten.
- **`sourcegraph/conc`** — collection of concurrency utilities; not bridge-specific but covers related ground.

When choosing a library:

- If your codebase already uses Cox-Buday-style hand-written combinators, prefer to keep the vocabulary consistent.
- If you adopt a library, accept its naming. `FlatMap` and `Concat` are common library names for what we call `bridge`.
- Be wary of libraries that hide cancellation. The library must accept `context.Context` and observe it through every value.

The most common reason teams write bridge themselves: control over allocation, instrumentation, and exact semantics. The function is small enough that hand-rolling is reasonable.

---

## Designing Public APIs That Use Bridge

When designing a package that exposes streaming data, the choice is between:

1. **Expose `<-chan T`.** Wrap bridge inside the package. Consumers see a flat stream.
2. **Expose `iter.Seq[T]`.** Pure-Go iteration; synchronous; no goroutine boundary.
3. **Expose a callback.** `Each(ctx, func(T) error) error`. No streaming type at all.
4. **Expose `<-chan <-chan T`.** Forces consumers to bridge.

Recommendations:

- For Go 1.22 and earlier: option 1. The flat channel is idiomatic and composable with the rest of your concurrency code.
- For Go 1.23+: option 2 for synchronous consumers, option 1 for concurrent. Sometimes both, side by side.
- Option 3 is fine for one-off iteration but kills composability.
- Option 4 is almost always wrong. The two-level shape is internal.

A pattern that ages well:

```go
// Iter returns a synchronous iterator over the result set.
func (q *Query) Iter(ctx context.Context) iter.Seq[Row] { ... }

// Stream returns an asynchronous channel of results.
func (q *Query) Stream(ctx context.Context) <-chan Row { ... }
```

Both delegate to the same internal `paginate`-returning-`<-chan <-chan Row` function. Bridge sits inside one method; an iterator adapter sits inside the other.

---

## Bridge as a Teaching Tool

Bridge is one of the clearest examples of "the right shape, well chosen." Use it in onboarding to illustrate:

- The importance of distinguishing **shape** (concatenation) from **execution** (serial vs parallel).
- The composition of small combinators (`bridge`, `orDone`, `tee`, `or`) into larger pipelines.
- The discipline of ownership (who closes what).
- The role of `context.Context` in propagating cancellation.

An exercise that lands well: ask a candidate to extend bridge to a parallel variant, then to discuss what they have given up. Most stumble on the order-preservation difference. That stumble is the lesson.

---

## Future Directions: Iterators, Channels v2

Go 1.23 introduced range-over-func and `iter.Seq[T]`. This changes bridge's role:

- For synchronous, single-goroutine consumers, `iter.Seq[T]` removes the need for a helper goroutine and a channel. A function returning `iter.Seq[T]` is bridge-without-goroutine.
- For concurrent producers and consumers, channels remain the natural fit. Bridge stays as it is.

There is ongoing discussion in the Go community about higher-level stream primitives. None has landed in the standard library. For now, bridge remains a hand-written or third-party combinator.

A modest prediction: the channel-of-channels shape will become *less* common over time, as more producers expose `iter.Seq` directly or as more libraries offer flat-stream APIs out of the box. But it will not disappear — paginated APIs and batch dispatchers are inherently two-level, and bridge will remain the natural adapter.

---

## Summary

At professional level, bridge is less about the function and more about the design decision it represents: a shape adapter between subsystems with different natural shapes. Place it at seams, wrap it behind typed public APIs, observe it with metrics, never put it in a hot inner loop, and accept that its strict serial semantics are a feature for ordered concatenation and a limitation for parallel work. The function is twenty lines; the architectural craft around it is the rest of the job.
