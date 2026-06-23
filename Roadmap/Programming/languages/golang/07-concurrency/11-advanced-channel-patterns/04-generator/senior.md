# Generator Pattern — Senior Level

> Focus: "When channel generators are the right tool, when Go 1.23 `range`-over-func iterators are, and how to design source stages that scale."

At senior level, the generator is no longer a recipe — it is one of several iteration mechanisms in the Go toolbox. This file works through that choice deliberately, then layers on the architectural concerns: backpressure budgets, structured concurrency, replay, observability, and the patterns that emerge in production codebases.

## Table of Contents

1. [Channel Generator vs Range-Over-Func (Go 1.23)](#channel-generator-vs-range-over-func-go-123)
2. [Choosing Between Concurrent and Synchronous Iteration](#choosing-between-concurrent-and-synchronous-iteration)
3. [Backpressure and Buffer Design](#backpressure-and-buffer-design)
4. [Structured Concurrency Around Generators](#structured-concurrency-around-generators)
5. [Generator as a Source of Sources](#generator-as-a-source-of-sources)
6. [Observability and Diagnostics](#observability-and-diagnostics)
7. [Generators in the Standard Library and Major Frameworks](#generators-in-the-standard-library-and-major-frameworks)
8. [Anti-Patterns at Scale](#anti-patterns-at-scale)
9. [Designing for Replay and Resumption](#designing-for-replay-and-resumption)
10. [When Not to Use a Channel Generator](#when-not-to-use-a-channel-generator)

---

## Channel Generator vs Range-Over-Func (Go 1.23)

Go 1.23 introduced *iterator functions* and `range`-over-func. A function with one of these signatures can be the right-hand side of `for ... range`:

```go
type Seq[V any] func(yield func(V) bool)
type Seq2[K, V any] func(yield func(K, V) bool)
```

Compare a counter as a channel generator versus an iterator:

```go
// Channel generator
func Counter(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}

// Iterator (Go 1.23+)
func CounterSeq() iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; ; i++ {
            if !yield(i) {
                return
            }
        }
    }
}
```

Both can be ranged:

```go
for v := range Counter(ctx) { ... }    // channel
for v := range CounterSeq() { ... }    // iterator
```

The differences are deep:

| Dimension | Channel generator | `iter.Seq` |
|---|---|---|
| Goroutine | One per generator | None |
| Cost per item | ~50ns channel op + scheduler latency | ~5ns function call |
| Concurrent consumers | One channel can be read by many goroutines (each gets a different value) | Each `range` invocation creates a fresh iteration |
| Cancellation | `ctx`, `done`, or returning early from `range` | Consumer returns `false` from `yield` |
| Backpressure | Built in via blocking sends | None; iterator runs as fast as consumer pulls |
| Composability with channel pipelines | Direct | Must adapt to a channel |
| Composability with sync code | Awkward | Direct |
| Eager vs lazy | Lazy, but pre-fetches one due to channel buffer (or zero if unbuffered) | Lazy; pull-driven |
| Error handling | Side channel or `Result[T]` | Trailing accessor or `Seq2[V, error]` |
| Resource cleanup | `defer` inside the goroutine | `defer` inside the iterator function body |

The key insight: **channel generators add concurrency; iterators do not**. If the producer needs to run concurrently with the consumer (because the producer is I/O-bound and the consumer is CPU-bound, or vice versa), a channel generator is appropriate. If the producer is computationally lightweight and there is no parallelism benefit, an iterator is faster and simpler.

### Adapting between the two

Iterator → channel (when you need to plug a synchronous iterator into a concurrent pipeline):

```go
func ToChan[T any](ctx context.Context, seq iter.Seq[T]) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for v := range seq {
            select {
            case <-ctx.Done():
                return
            case out <- v:
            }
        }
    }()
    return out
}
```

Channel → iterator (when you have a legacy `<-chan T` and a new API expects `iter.Seq`):

```go
func FromChan[T any](ch <-chan T) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range ch {
            if !yield(v) {
                return
            }
        }
    }
}
```

Note: `FromChan` does *not* cancel the producer when the consumer stops; the channel keeps yielding to nowhere. You still need a `ctx` upstream.

### The senior-level decision

- **Default to `iter.Seq`** for in-process iteration that does not benefit from concurrency. It is faster, simpler, and avoids goroutine plumbing.
- **Use a channel generator** when the source must run concurrently with the consumer, multiple consumers will read from it, or it is the head of a fan-out/fan-in/tee/bridge pipeline.

The wrong default leads either to slow synchronous code wrapped in goroutines, or to concurrent code that doesn't actually parallelise anything.

---

## Choosing Between Concurrent and Synchronous Iteration

A useful framework: ask three questions.

1. **Is the producer I/O-bound and the consumer CPU-bound (or the inverse)?** If yes, a channel generator overlaps them — real wall-clock gain.
2. **Will multiple consumers read from this source?** If yes, only a channel can fan-out values. An iterator restarts per consumer.
3. **Is this stage in a longer pipeline of channel stages?** If yes, stay channels; converting to iterator and back adds cost.

If all three answers are "no", choose `iter.Seq`.

A common mistake at senior level is to keep writing channel generators out of muscle memory long after the original concurrency motivation has gone. Re-evaluate when the surrounding architecture changes.

---

## Backpressure and Buffer Design

A channel generator inherits backpressure from its output channel. The question becomes: how much buffer?

The wrong answers:
- **Unbuffered always.** Fine for many cases but introduces per-item scheduling latency on every send.
- **Buffer of 1000 always.** Hides true throughput mismatches and inflates memory; deadlocks surface in production only.
- **Tune at the producer.** Sometimes the right knob; sometimes it should sit at the consumer.

The senior-level approach:

1. **Default unbuffered.** Measure first.
2. **Profile under realistic load.** Look at `runtime.chansend` time in pprof.
3. **If the producer waits often on `out <-`,** the consumer is the bottleneck. Adding buffer at the generator only delays the visible block; the real fix is fanning out the consumer.
4. **If the consumer waits often on `<-out`,** the producer is the bottleneck. A small buffer (8-32) at the generator smooths jitter; fan-out at the producer scales it.
5. **For bursty producers** (e.g., reading 4KB at a time, yielding many small values), a buffer matching one burst (e.g., 64 items) reduces scheduler pressure.

A buffer is a *latency vs throughput* trade. More buffer means more in-flight items, which means higher per-item latency in steady state but less stall time. Pick a number, measure, justify it in a comment.

### Adaptive buffering

In long-lived systems you sometimes want a buffer whose effective size changes with load. Implement this *outside* the generator with a separate "buffer stage":

```go
gen → buffer(N) → consumer
```

This keeps the generator simple and lets you replace the buffer stage with rate-limiting, batching, or dropping policies later.

---

## Structured Concurrency Around Generators

A generator spawns a goroutine. In a structured-concurrency model, the parent must guarantee that the goroutine exits before the parent returns.

```go
func run(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)

    var src <-chan Item
    g.Go(func() error {
        ch, err := Source(ctx)
        if err != nil {
            return err
        }
        src = ch // race: do not do this
        return nil
    })
    // ...
}
```

This is wrong: `src` is set inside the goroutine but read outside, racy. The correct shape is to construct synchronously, then run inside the group:

```go
func run(ctx context.Context) error {
    src, err := Source(ctx)
    if err != nil {
        return err
    }

    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error {
        return consume(ctx, src)
    })
    return g.Wait()
}
```

`Source` returns `(chan, error)` synchronously; the streaming goroutine inside `Source` ties its lifetime to `ctx`. When `g.Wait` returns, `ctx` is cancelled (because errgroup cancels on first error), so the source goroutine drains and exits.

The contract: a generator's internal goroutine *must* exit when the `ctx` passed in is cancelled. The parent's `g.Wait` is allowed to return only after the goroutine has exited. Verify both with leak-detection tests.

### Goroutine leak detection in tests

`go.uber.org/goleak`:

```go
func TestNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithCancel(context.Background())
    out := Counter(ctx)
    <-out
    cancel()
    for range out { } // drain
}
```

If the generator leaks, the test fails. Wire this into every package that spawns goroutines.

---

## Generator as a Source of Sources

Sometimes a generator yields *other* generators. Classic example: paginating across multiple tenants, where each tenant produces its own stream:

```go
func Tenants(ctx context.Context) <-chan (<-chan Event) {
    out := make(chan (<-chan Event))
    go func() {
        defer close(out)
        for _, t := range listTenants(ctx) {
            select {
            case <-ctx.Done():
                return
            case out <- TenantEvents(ctx, t):
            }
        }
    }()
    return out
}
```

The `bridge` channel flattens these into a single `<-chan Event`. This decoupling lets the discovery logic and the per-tenant streaming logic stay independent. Tenant rotation, retry, and rate-limiting can be inserted between `Tenants` and `bridge` without touching either.

### Trade-offs

- A channel-of-channels has higher latency than a single flat channel (two channel ops per item).
- It composes beautifully with structured concurrency: each inner channel's lifetime is independent; cancelling the outer cancels all.
- Use only when the source naturally factors into substreams. Forcing this shape on a flat source adds complexity.

---

## Observability and Diagnostics

A channel generator is a black box once it starts. To observe it:

1. **Counter metric:** increment a Prometheus counter on every send. Gives a throughput dashboard.
2. **Latency histogram:** measure time between two successive sends to detect stalls.
3. **Saturation gauge:** report `len(out) / cap(out)` for buffered channels. A perpetually full buffer means consumer is too slow.
4. **Cancel-reason log:** when the goroutine exits due to `<-ctx.Done()`, log `ctx.Err()` (`context.Canceled` vs `context.DeadlineExceeded`). Distinguishes "we cancelled" from "we timed out".
5. **Goroutine label:** `pprof.SetGoroutineLabels(ctx, pprof.Labels("source", "lines"))`. Now `go tool pprof` can attribute work to the source stage.

The senior-level discipline: every long-lived generator in production has at least the cancel-reason log and a saturation metric.

---

## Generators in the Standard Library and Major Frameworks

Generators appear under many names:

- **`bufio.Scanner`**: not channel-based, but the canonical sync iterator pattern; `Scan()` + `Err()` mirrors what a Result-typed channel generator achieves concurrently.
- **`sql.Rows`**: a cursor; `Next() + Scan()` plus `Err()`. Wrap with a channel generator if downstream is concurrent.
- **`http.Response.Body`** as an `io.Reader`: yields bytes synchronously; convert to `<-chan []byte` if needed.
- **`filepath.WalkDir`**: callback-based; convert to a channel generator for cancellable directory walks.
- **`kafka-go` reader's `ReadMessage`**: callback-style; a thin channel generator wrapper turns it into a pipeline source.
- **`iter.Seq` / `iter.Seq2`** (Go 1.23): the idiomatic sync iterator. Use directly when concurrency is not needed.

The pattern: standard library APIs are mostly pull-based and synchronous; channel generators are the adapter layer between pull-sync and push-concurrent.

---

## Anti-Patterns at Scale

- **Spawning a generator per request.** A high-RPS service that creates a generator goroutine per request burns scheduling. Pool the generator if its source can be shared.
- **Unbounded fan-out from one generator.** If 100 consumers race for values from one generator, the generator becomes the bottleneck. Tee instead.
- **Generator → goroutine → channel → goroutine → channel** for every transform. Each hop costs ~50ns and scheduler latency. Fuse trivial transforms into the generator goroutine or use `iter.Seq` for in-process work.
- **A generator that closes its own input.** A consumer that morphed into a producer; sign of a broken design. Restructure.
- **Generator with shared state in its closure mutated outside.** Race condition waiting to bite; capture by value, not by reference.
- **One huge `select`** in the generator with five `case` arms covering ctx, done, retry timer, pause signal, and the send. Split it: outer `select` for control, inner `select` for send.

---

## Designing for Replay and Resumption

In long-running ETL or event streaming, the consumer may crash and need to resume from a checkpoint. A channel generator that cannot resume costs you the entire stream on every restart.

Design for replay by exposing the *cursor*, not just the values:

```go
type Event struct {
    Cursor string
    Data   []byte
}

func Stream(ctx context.Context, from string) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        cursor := from
        for {
            batch, err := fetch(ctx, cursor)
            if err != nil {
                return
            }
            for _, e := range batch {
                select {
                case <-ctx.Done():
                    return
                case out <- e:
                }
            }
            if len(batch) == 0 {
                return
            }
            cursor = batch[len(batch)-1].Cursor
        }
    }()
    return out
}
```

The consumer persists the last successfully processed `Cursor`. On restart, it calls `Stream(ctx, lastCursor)`. The generator's state lives in the cursor, not in the goroutine.

A generator without an exposed cursor is fine for tests and short pipelines, but not for production streams that must survive restarts.

---

## When Not to Use a Channel Generator

The senior's most important skill is recognising when *not* to reach for this pattern:

- **Tight in-process iteration over a slice.** `for _, v := range s` is faster and simpler.
- **Synchronous transforms (map, filter, take).** `iter.Seq` chains beautifully and avoids the channel tax.
- **A single one-shot value.** A function returning `T` (or `(T, error)`) is enough; you do not need a channel for one value.
- **A producer that must coordinate with the consumer step-by-step (request-response).** Use direct calls or a request/response channel pair, not a stream.
- **Heavy CPU work where the channel send overhead would dominate** — for example, yielding one int per nanosecond of work. Either batch (yield `[]int`) or use `iter.Seq`.
- **Code that will be tested with `goleak`** but where you cannot guarantee cancellation discipline among all callers. Synchronous iteration removes the leak surface entirely.

Reach for a channel generator when the producer and consumer benefit from running concurrently, when multiple consumers will read, or when this stage will join a longer channel pipeline. Otherwise, prefer the simpler tool.

---

At senior level, the generator is no longer a recipe to follow — it is a design choice to defend. Know the alternatives, know the costs, and know which question made you pick the channel.
