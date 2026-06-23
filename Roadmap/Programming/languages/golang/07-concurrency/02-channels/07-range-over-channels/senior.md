# Range Over Channels — Senior Level

> Focus: "Ownership, lifecycle, and architecture. When `range` is the right abstraction, when it is not, and how Go 1.23's `range`-over-func reshapes the choice."

## Table of Contents

1. [Channel Ownership and the Range Contract](#channel-ownership-and-the-range-contract)
2. [Structured Concurrency and Range](#structured-concurrency-and-range)
3. [Range vs Select — A Deeper Comparison](#range-vs-select--a-deeper-comparison)
4. [Range vs Go 1.23 Range-Over-Func](#range-vs-go-123-range-over-func)
5. [Pipeline Design at Scale](#pipeline-design-at-scale)
6. [Backpressure, Cancellation, and Resource Management](#backpressure-cancellation-and-resource-management)
7. [Error Propagation Strategies](#error-propagation-strategies)
8. [Leak Prevention as an Architecture Constraint](#leak-prevention-as-an-architecture-constraint)
9. [Range Idioms in Standard Library and Major Frameworks](#range-idioms-in-standard-library-and-major-frameworks)
10. [Designing for Replay and Observability](#designing-for-replay-and-observability)
11. [Anti-Patterns at Scale](#anti-patterns-at-scale)
12. [When Not to Use Channels At All](#when-not-to-use-channels-at-all)

---

## Channel Ownership and the Range Contract

At senior level, the most useful frame is *channel ownership*. A channel is owned by exactly one goroutine — the goroutine that has the authority to send and to close. Everyone else is a receiver.

A `range` consumer is, by definition, *not* an owner. It can only receive. The owner decides when the stream ends.

### Ownership rules

1. **One owner per channel.** The owner is the goroutine that sends and closes.
2. **Owner closes exactly once.** The close is the owner's last act.
3. **Non-owners (consumers) never send and never close.**
4. **Direction-typed channels (`<-chan`, `chan<-`) express ownership in the type system.** A function that takes `<-chan T` is declaring "I am a consumer; I will not close this."
5. **For multiple senders, the "owner" is a synthetic role**: a closer goroutine that waits for the senders and closes. The senders are still not closing — the owner role is decoupled into a separate goroutine.

Once you frame channels this way, `range`'s rules become obvious: the consumer is *forbidden* from closing because it is not the owner. The producer *must* close because that is the only way to tell consumers the stream ended.

### The contract a `range` consumer implies

A consumer that writes `for v := range ch` is committing to:

- Process every value the producer sends, in order.
- Not consume forever — only until the channel is closed.
- Trust the producer to close.
- Not modify or close the channel.

If the consumer cannot meet these commitments (because it may need to bail out early), it should not use `range`. It should use `select`.

### Subtle case: the consumer bails out

```go
for v := range ch {
    if shouldStop() {
        return
    }
    process(v)
}
```

The consumer returns, but the producer keeps sending. The next send blocks. The producer goroutine leaks.

The fix is to *signal back to the producer*: usually via a context, a `done` channel, or an upstream cancellation. The consumer's early exit must be visible to the owner, who can then stop and close.

This is why production pipelines almost always use context-aware producers — so consumers can cancel cleanly without leaking the producer.

---

## Structured Concurrency and Range

*Structured concurrency* is the principle that the lifetime of a goroutine should be contained within the lifetime of its parent. No "fire and forget"; every goroutine is awaited by someone.

`range` over channels is a useful tool for structured concurrency precisely because it tells you when the producer is done. The `defer close(ch)` is the producer's way of saying "I am done sending"; the consumer's `range` exit is its way of saying "I have observed that I am done receiving."

A complete structured-concurrency pipeline looks like:

```go
func run(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    ch := make(chan Item, 64)

    g.Go(func() error {
        defer close(ch)
        return produce(ctx, ch)
    })

    g.Go(func() error {
        for it := range ch {
            if err := process(ctx, it); err != nil {
                return err
            }
        }
        return nil
    })

    return g.Wait()
}
```

The `errgroup.WithContext` ties the lifetimes together. If either goroutine returns an error, the context is cancelled; the producer respects the cancellation and returns; `defer close(ch)` runs; the consumer's `range` drains and exits; `g.Wait()` returns the error.

This is structured concurrency in Go: a parent (`run`) starts children (`produce`, `consume`), the parent's `g.Wait` cannot return until both children have exited, and a cancellation cascades cleanly.

### Why `range` is structured-concurrency-friendly

`range`'s exit condition is fully described by the channel state: closed + drained. There is no extra signalling layer. The producer's `close` is both "I am done" and "drain the buffer first." The consumer's `range` exit is the natural consequence. No `select { case <-done }` to add, no extra coordination protocol — the channel itself is the rendezvous.

This is in contrast to many threading models where shutdown requires its own protocol (interrupt flag, atomic boolean, cooperative cancel token).

---

## Range vs Select — A Deeper Comparison

| Aspect | `range` | `select` |
|---|---|---|
| Channels per loop | Exactly one | Many |
| Cancellation built-in? | Via channel close only | Via any case (e.g., `<-ctx.Done()`) |
| Non-blocking poll? | No | Yes, with `default` |
| Timeouts | Only by closing the channel | Native: `<-time.After(d)` |
| Read + write in one step | No | Yes |
| Code shape | One line + body | Loop + cases |
| Runtime cost | One receive per iteration | Cases evaluated each iteration |
| Compile target | `chanrecv2` + branch | `runtime.selectgo` |

The choice is not aesthetic. It is a question of how many failure modes you need to handle.

A `range` consumer handles exactly one: "the channel closed." Everything else — timeouts, cancellation, multiple inputs, side conditions — requires `select`.

### A useful guideline

- **One input, no cancellation, no timeout, lifecycle equals the channel's** → `range`.
- **Multiple inputs, or needs cancellation, or needs timeouts** → `select`.
- **Multiple inputs AND no concept of "input closed"** (e.g., infinite event streams) → `select` with stop signalling.

### `range` over a channel that "doesn't close"

Some channels are designed never to close (e.g., a long-lived event bus). For such channels, `range` is the wrong tool by definition — it will never exit. You must use `select` with a separate stop signal (typically `ctx.Done()`).

A useful design check: ask "does this channel have a natural end?" If yes (job queue, batch processing, request stream), use `range`. If no (pub/sub, event bus, control plane), use `select`.

---

## Range vs Go 1.23 Range-Over-Func

Go 1.23 introduced "range over function" — a generalisation of the `range` keyword to any function with a specific signature.

```go
// Go 1.23+:
for v := range seq.Values { // seq.Values is an iter.Seq[T]
    process(v)
}
```

Where `iter.Seq[T]` is `func(yield func(T) bool)`. The iterator function is called once; inside, it calls `yield` for each value; `yield` returns `false` if the loop body wants to stop.

This is a *pull-based* iterator. The body asks for the next value; the iterator produces it synchronously.

### How is it different from range-over-channel?

| Aspect | `range` over channel | `range` over func (1.23) |
|---|---|---|
| Producer execution | A separate goroutine | Same goroutine as the loop |
| Concurrency | Yes — producer can run on another core | No — synchronous |
| Cancellation | Channel close, plus `select` for richer control | `yield` returns `false` to stop early |
| Leak risk | High if producer never closes | None — iterator returns when loop ends |
| Overhead | Channel synchronisation per value | Function call per value |
| Use case | Concurrent producer/consumer | Lazy, on-demand iteration |

The two are *not* equivalent and not interchangeable.

### When to use which

**Use `range` over channel when:**

- The producer is genuinely concurrent — running on its own goroutine, possibly its own core.
- Producer and consumer can run at different speeds; you want buffering.
- The stream comes from network, disk, or another goroutine's work.
- Multiple consumers might compete for values (fan-out).

**Use `range` over func when:**

- You want a lazy iterator that runs synchronously with the consumer.
- There is no concurrency benefit (computation, not I/O).
- Leak safety is paramount (the iterator is automatically cancelled if the loop exits).
- You want to iterate a data structure — map, tree, sequence — with custom logic.

### Example: same problem, two solutions

Iterating positive integers up to `n`, with early exit.

#### Channel version (pre-1.23 style)

```go
func count(n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 1; i <= n; i++ {
            out <- i
        }
    }()
    return out
}

for v := range count(10) {
    if v > 5 { break } // LEAK: producer goroutine still tries to send
    fmt.Println(v)
}
```

The producer leaks on early `break`. To fix, you need a context or done channel.

#### Func iterator version (Go 1.23)

```go
func count(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 1; i <= n; i++ {
            if !yield(i) {
                return
            }
        }
    }
}

for v := range count(10) {
    if v > 5 { break }
    fmt.Println(v)
}
```

No goroutine, no leak. The `break` causes `yield` to return `false`, which signals the iterator to return.

For pure iteration, range-over-func is safer and simpler. For concurrent processing (separate goroutine), channels remain necessary.

### Composability: bridging the two

Go 1.23 lets you adapt between channels and iterator functions:

```go
func chanSeq[T any](ch <-chan T) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range ch {
            if !yield(v) {
                return
            }
        }
    }
}
```

Now a channel can be consumed as a func iterator — and an early `break` actually terminates the consumer cleanly (though it does not cancel the producer; you still need a context for that).

### What this means for the future of channels

`range`-over-func does not replace `range`-over-channel. It replaces the *common misuse* of channels as lazy generators. Many uses of channels in Go 1.22 and earlier were really "I want a lazy sequence" — for those, 1.23 iterators are simpler and leak-proof. Channels remain the right tool for *actual concurrency*: separate goroutines, separate work, buffering, fan-out.

A useful test: "if I removed the `go` keyword in front of my producer, would this still work?" If yes, you do not need a channel — use an iterator function.

---

## Pipeline Design at Scale

A small three-stage pipeline is easy. A 12-stage pipeline with branches, joins, and per-stage parallelism is not. At scale, the design questions become:

### 1. How many goroutines per stage?

A single goroutine per stage is the canonical shape, but it serialises that stage. If `transform` is CPU-heavy, you want `N` goroutines all `range`ing the same input.

```go
func parallelStage(in <-chan A, n int) <-chan B {
    out := make(chan B)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for a := range in {
                out <- transform(a)
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

The stage is now `N` workers, all `range`ing `in`. Order is no longer preserved (different workers finish at different times). If order matters, you need sequence numbers or a sort pass.

### 2. Where do buffers go?

Each channel between stages is a queue. Large buffers absorb bursts; small buffers tightly couple stages. Choose per stage based on:

- Burstiness of the producer.
- Cost of producing.
- Latency tolerance.

A common pattern: large buffer at the head of the pipeline (catch input bursts), small buffers between intermediate stages (so backpressure propagates quickly), one large buffer at the tail (smooth out variable downstream consumption).

### 3. How do you observe a pipeline?

Each `range` consumer in a stage is an opportunity for metrics:

```go
for v := range in {
    inboundCounter.Inc()
    start := time.Now()
    out <- transform(v)
    transformDuration.Observe(time.Since(start).Seconds())
}
```

A useful pattern is wrapping a stage in a generic instrumented adapter that knows nothing about the value type but counts and times. With Go generics, this can be one function.

### 4. How do you handle a stage failure?

A stage that panics, even with `defer close(out)`, still terminates the program. For production:

```go
go func() {
    defer close(out)
    defer func() {
        if r := recover(); r != nil {
            log.Printf("stage panic: %v", r)
            // optionally signal upstream cancellation
        }
    }()
    for v := range in {
        out <- safeTransform(v)
    }
}()
```

The `defer close(out)` runs first (recall that defers run in LIFO order), so downstream still gets the close signal. The `recover` then catches the panic.

A more sophisticated design: each stage runs under an `errgroup`, and any non-nil error cancels the context, which the producers respect, which closes all channels, which drains all consumers — clean cascade shutdown.

---

## Backpressure, Cancellation, and Resource Management

Channels provide *natural* backpressure: a producer sending to a full buffer blocks. This is a feature, not a bug. The producer slows to match the consumer.

`range` participates in this naturally: the consumer's processing time controls how quickly the channel drains, which controls when the producer's next send unblocks. No explicit rate limiter is needed.

### What goes wrong

- **Unbuffered consumer with slow body.** Producer blocks per value. Throughput drops to 1/process-time.
- **Huge buffer with no backpressure.** Producer pumps data faster than consumer can drain; memory grows; eventually OOM.
- **Buffered consumer with non-cooperative producer.** Producer dumps everything in the buffer and exits; consumer drains and exits. Works, but uses memory equal to the entire stream — not a stream, a load.

### Backpressure budget

A good design has a *budget*: how many in-flight items, total, across the pipeline. If you have 10 stages and each has a buffer of 100, you have 1000 items in flight at peak. That has to fit in memory and not break SLA.

The `range` consumer is the rate-limiter for everything upstream. If you want a strict rate limit, drop a `time.Sleep` or a token bucket in front of the body. But a more reliable pattern is to size the buffers to enforce the limit.

### Cancellation cascade

When the consumer must stop:

1. Consumer's loop sees a cancellation (via `select` with `<-ctx.Done()`).
2. Consumer returns. (Or, more idiomatically: cancel the *producer*'s context, let it close, let the consumer drain.)
3. Producer's context is cancelled (because parent cancelled).
4. Producer returns, `defer close(out)` runs.
5. Consumer drains buffer (often optional, depending on whether work-in-progress matters) and exits.

Designing for "cancel upstream, let it drain downstream" is the standard architecture for graceful shutdown. The `range` consumer is unchanged — it just sees the producer close earlier.

### Resource lifetime

Channels and the goroutines reading them often hold resources: open files, DB connections, in-flight HTTP requests. A leaked `range` consumer leaks all these. Two safeguards:

- `defer cleanup()` at the top of the consumer body.
- A bounded timeout on the entire pipeline, so a stuck stage cannot hold resources forever.

---

## Error Propagation Strategies

Five patterns, each with trade-offs:

### Strategy 1: Errors in the value type

```go
type Result struct {
    Val int
    Err error
}

for r := range results {
    if r.Err != nil { handle(r.Err); continue }
    use(r.Val)
}
```

Simple. Errors stay in-band. Easy to test. Best for "many independent items, each may fail."

### Strategy 2: Separate error channel

```go
go produce(values, errs)
for {
    select {
    case v, ok := <-values:
        if !ok { return nil }
        use(v)
    case err := <-errs:
        return err
    }
}
```

Best when errors are rare and should *stop* the pipeline. Forces you out of `range` into `select`.

### Strategy 3: `errgroup.Group`

```go
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error {
    defer close(values)
    return produce(ctx, values)
})
g.Go(func() error {
    for v := range values {
        if err := process(v); err != nil { return err }
    }
    return nil
})
return g.Wait()
```

The cleanest pattern for "if anyone fails, cancel everyone." The first error becomes the result; the context cancels; all goroutines exit; `g.Wait` returns.

### Strategy 4: Panic and recover

Only useful when errors are truly exceptional. Wrap each stage in `recover` and convert the panic to an error sent on the error channel.

### Strategy 5: Sentinel value

```go
const EndOfStream = -1
for v := range ch {
    if v == EndOfStream { return }
    use(v)
}
```

A bad pattern. Conflates "value" and "control." Use only as a last resort.

### Which to choose

| Workload | Recommendation |
|---|---|
| Many independent items, some may fail | Strategy 1 (errors in result) |
| Pipeline where any failure should abort | Strategy 3 (errgroup) |
| Failures are rare and should stop the world | Strategy 2 (error channel) |
| Recoverable third-party code | Strategy 4 (recover) |

---

## Leak Prevention as an Architecture Constraint

At scale, the question is not "did I write `defer close(out)` here?" but "can I guarantee no `range` will hang?" This is a *system-level* property.

Tactics:

### Always context-aware producers

If every producer respects a context, cancelling the context propagates down to every `range` consumer. No bespoke shutdown protocol.

### Bound every pipeline with a timeout

```go
ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
defer cancel()
```

The pipeline cannot run forever. If a stage hangs, the timeout fires, the context cancels, and the entire pipeline tears down. Combine with structured concurrency (`errgroup.WithContext`).

### Audit `range` sites

A static check: for every `for v := range ch`, find the corresponding `close(ch)`. If you cannot find it, you have a potential leak. Code review checklist item.

### Test for termination

For every long-lived consumer goroutine, write a test that closes the input and asserts the goroutine exits within some timeout. If your stage hangs in a test, it will hang in production.

### Monitor `runtime.NumGoroutine`

In production, `runtime.NumGoroutine` increasing over time without bound is a smoking gun. Alert on it. Most goroutine leaks come from `range` loops on never-closed channels.

---

## Range Idioms in Standard Library and Major Frameworks

### `net/http` SSE handlers

```go
for event := range events {
    fmt.Fprintf(w, "data: %s\n\n", event)
    flusher.Flush()
}
```

The producer is the application logic; the consumer is the HTTP handler writing to the response. When the producer closes (or context cancels), the handler returns and the response ends.

### `errgroup` itself

`golang.org/x/sync/errgroup` does not internally use `range`, but its `Wait` semantics work nicely with goroutines that themselves `range` over channels — see *Structured Concurrency* above.

### `context.Context` cancellation chains

`ctx.Done()` returns a channel that is closed when the context is cancelled. A common pattern is:

```go
for {
    select {
    case <-ctx.Done():
        return
    case v, ok := <-ch:
        if !ok { return }
        process(v)
    }
}
```

This is "range with cancellation" — `select` with two-value receive. The canonical upgrade from `range` for context-aware consumers.

### Kubernetes informers

Informers (controller-runtime, client-go) often expose work queues as channels. Controllers `range` the queue:

```go
for {
    key, quit := queue.Get()
    if quit { return }
    process(key)
    queue.Done(key)
}
```

(Not a `range` syntax because of the `Done` ack pattern, but conceptually the same shape.)

### Database drivers and streaming responses

Many DB drivers expose row iteration via channels:

```go
rows := db.QueryStream(...)
for r := range rows {
    process(r)
}
```

The driver closes the channel when the query is done. `range` ends. Note: with Go 1.23, many libraries now offer iterator-function alternatives, but channel APIs remain because the consumer often runs on its own goroutine.

---

## Designing for Replay and Observability

A `range` loop is opaque: from outside the goroutine, you cannot tell how many values it has processed or what it is waiting on. For production observability:

### Metrics inside the loop

```go
for v := range in {
    metrics.RangeReceived.Inc()
    process(v)
    metrics.RangeProcessed.Inc()
}
```

Bracket the body with counters. Difference between received and processed reveals processing latency or backlog.

### Tracing

```go
for v := range in {
    ctx, span := tracer.Start(ctx, "stage.process")
    process(ctx, v)
    span.End()
}
```

Each iteration is a span. Trace tree shows per-value processing inside a parent pipeline span.

### Logging the close

```go
defer close(out)
defer log.Printf("producer exiting: produced %d items", count)
```

So the operator sees in logs when the producer ends and how much it produced.

### Replay

A `range`-based pipeline cannot replay — once a value is consumed, it is gone from the channel. For replay, you need a persistent log (Kafka, NATS Streaming, an event store). The `range` consumer becomes the consumer-side of a durable subscription, with offsets and acknowledgements.

---

## Anti-Patterns at Scale

### Anti-pattern: nested `range` inside a request handler

```go
http.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
    ch := slowProducer()
    for v := range ch {
        w.Write([]byte(v))
    }
})
```

If `slowProducer` does not respect the request context, a client disconnect leaves the handler stuck consuming. Always pass the request context down to the producer.

### Anti-pattern: `range` over a "global event bus"

A long-lived application-wide channel that goroutines `range` over works on day 1 and bites you on day 30 when someone adds a goroutine that forgets to drain. The channel fills, all senders block, the application freezes.

Fix: bounded buffers + non-blocking sends with drop policy, or a pub/sub library (not a raw channel).

### Anti-pattern: `range` as iteration over a finite slice

```go
ch := make(chan int, len(items))
for _, x := range items {
    ch <- x
}
close(ch)
for v := range ch {
    use(v)
}
```

You wrote a channel to iterate a slice in the same goroutine. Just iterate the slice. Channels are for concurrency, not for replacing `for i := range slice`.

### Anti-pattern: shared mutable values through `range`

```go
type State struct { Count int }
ch := make(chan *State)
go func() { ch <- &state; ch <- &state; close(ch) }()
for s := range ch {
    s.Count++  // racing with everything else holding *State
}
```

Sending pointers does not give ownership. The producer still holds `&state`; the consumer mutates it; race detector fires. Either send by value or document that the producer relinquishes the pointer.

---

## When Not to Use Channels At All

`range` over channels is excellent for concurrent producer/consumer. But not every problem needs channels:

- **Pure data iteration**: use a `for i, v := range slice` or, post-1.23, a func iterator.
- **Shared counter or flag**: use `sync/atomic`. Sending a counter increment as a channel value is silly.
- **Mutual exclusion**: use `sync.Mutex`. A channel-based mutex (`ch := make(chan struct{}, 1)`) is slower and less clear.
- **Single-writer, single-reader, low-frequency**: a buffered channel works, but so does a single shared variable with a memory barrier.
- **Bounded queue with strong ordering across producers**: a `chan T` of size N works, but for very high throughput consider lock-free queues (third-party).
- **Pub/sub at scale**: channels do not multicast. Use a pub/sub library.

The senior judgement: *channels are a synchronisation primitive that happens to also be a queue.* When you need synchronisation between two or more goroutines, channels (and `range`) shine. When you need only a data structure or only mutual exclusion, simpler primitives are better.

---

## Putting It Together

The senior mental model of `range` over channels:

1. `range` is the consumer's commitment to follow the channel to its natural end, set by its owner.
2. Ownership is the design contract: one owner, one close, many consumers safe to `range`.
3. Structured concurrency (`errgroup` + `context`) is the right home for `range`-based pipelines.
4. `range` is for *concurrency*; Go 1.23 range-over-func is for *iteration*. Choose the right tool.
5. Pipelines compose because each stage is just a `range` + `defer close`. Add stages without redesigning shutdown.
6. Cancellation works by cancelling upstream and letting the close cascade downstream.
7. Errors propagate by either embedding in the value, using `errgroup`, or upgrading to `select`.
8. Leaks are an architecture concern: audit, test, monitor, bound every pipeline with a timeout.

The next level — professional — covers exactly how the compiler turns `for v := range ch` into runtime calls, what `chanrecv2` does, and how the assembly compares to a manual loop.
