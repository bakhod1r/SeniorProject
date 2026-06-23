# Or-Done-Channel — Optimisation Notes

A practical guide to making `orDone`-based code faster, leaner, or simpler. Most of these techniques are micro-optimisations relevant only in hot paths; the baseline pattern is fast enough for the vast majority of pipelines.

---

## When to Optimise

Before reaching for any technique here, measure. `orDone` adds:

- One goroutine (~2 KB stack).
- One channel hop per value (~50–150 ns).

For a stream below ~100,000 values per second, these costs disappear in noise. Optimise `orDone` itself only when:

- `pprof` shows the `orDone` goroutine consuming measurable CPU.
- The pipeline emits more than 1M values/sec.
- A latency budget (e.g., sub-millisecond) is being violated.
- Allocator pressure from per-value heap allocations is visible.

If none of these apply, the canonical 15-line `orDone` is your final answer. Do not refactor what is not slow.

---

## Optimisation 1: Inline the Loop

Most consumer code can replace `for v := range orDone(done, c)` with an inline select:

```go
for {
    select {
    case <-done:
        return
    case v, ok := <-c:
        if !ok {
            return
        }
        handle(v)
    }
}
```

### Wins

- Eliminates one goroutine.
- Eliminates one channel hop per value (`out` is gone).
- Eliminates `defer close(out)`.

### Costs

- Cancellation logic is now repeated in every consumer.
- Slightly less readable in long chains of stages.

### When to apply

In the *terminal* stage of a pipeline (the one with `for v := range orDone(done, finalStage)` and no downstream channel). Forwarding stages still benefit from the wrapper because they need the dual-select anyway.

---

## Optimisation 2: Use `eachOrDone` for Terminal Stages

A named helper for the inline form:

```go
func eachOrDone[T any](done <-chan struct{}, c <-chan T, fn func(T)) {
    for {
        select {
        case <-done:
            return
        case v, ok := <-c:
            if !ok {
                return
            }
            fn(v)
        }
    }
}
```

Use site:

```go
eachOrDone(done, results, func(r Result) {
    log.Printf("%v", r)
})
```

Same performance as inlining, but the cancellation logic is factored out. Useful when you have many terminal stages with similar shape.

---

## Optimisation 3: Combine Adjacent Stages

In a five-stage pipeline:

```go
nums := count(done)
squared := square(done, nums)
filtered := filter(done, squared, predicate)
mapped := mapStage(done, filtered, fn)
for v := range orDone(done, mapped) {
    sink(v)
}
```

Each stage is a goroutine + channel. Five stages = five extra hops per value.

Combine `square + filter` and `filter + map` if they always run together:

```go
nums := count(done)
processed := transform(done, nums, func(n int) (Result, bool) {
    sq := n * n
    if !predicate(sq) {
        return Result{}, false
    }
    return mapped(sq), true
})
for v := range orDone(done, processed) {
    sink(v)
}
```

The combined `transform` stage runs all three operations in one goroutine. Cost: 1 hop instead of 3. Trade: reduced composability, easier-to-test units become harder.

Use only when measured throughput justifies it. The five-stage form is more maintainable.

---

## Optimisation 4: Buffered Output

For workloads with bursty consumers:

```go
func orDoneBuffered[T any](done <-chan struct{}, c <-chan T, n int) <-chan T {
    out := make(chan T, n)
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
                    return
                }
            }
        }
    }()
    return out
}
```

A buffer of N smooths jitter: the producer can race ahead by N values without blocking.

### Sizing

- N = 0 (unbuffered): strict back-pressure, lowest memory.
- N = small (4-16): smooths brief consumer pauses.
- N = large (1024+): rare; only when you have specific batching needs.

Each buffer slot costs `sizeof(T)` bytes. For large types, prefer smaller buffers and rely on the consumer's responsiveness.

### Caveat

A buffered `orDone` can mask back-pressure problems. If the consumer is permanently slower than the producer, the buffer fills, then back-pressure kicks in anyway — but you've added latency. Buffers are not a substitute for matching producer and consumer rates.

---

## Optimisation 5: Batch Values

If the per-hop overhead dominates, batch:

```go
func orDoneBatched[T any](done <-chan struct{}, c <-chan T, batchSize int) <-chan []T {
    out := make(chan []T)
    go func() {
        defer close(out)
        batch := make([]T, 0, batchSize)
        flush := func() bool {
            if len(batch) == 0 {
                return true
            }
            select {
            case out <- batch:
                batch = make([]T, 0, batchSize)
                return true
            case <-done:
                return false
            }
        }
        for {
            select {
            case <-done:
                return
            case v, ok := <-c:
                if !ok {
                    flush()
                    return
                }
                batch = append(batch, v)
                if len(batch) >= batchSize {
                    if !flush() {
                        return
                    }
                }
            }
        }
    }()
    return out
}
```

Per-value channel overhead drops by `batchSize`. For `batchSize = 100`, you pay ~150 ns per 100 values instead of per 1 value. The consumer iterates each batch in a tight loop:

```go
for batch := range orDoneBatched(done, src, 100) {
    for _, v := range batch {
        handle(v)
    }
}
```

### Trade

- Higher per-value latency: a value waits up to `batchSize-1` other values before delivery.
- Use only when per-value throughput is the bottleneck, not per-value latency.
- A periodic flush (`time.After`) helps avoid stalls when the producer slows down.

---

## Optimisation 6: Reduce Allocations

The canonical `orDone` allocates:

1. The output channel.
2. The closure for `go func() { ... }`.
3. Per-value heap escapes if `T` is large.

### Reusing channels

If you spawn `orDone` thousands of times per second, channel allocation becomes measurable. Pool channels:

```go
var chanPool = sync.Pool{
    New: func() any { return make(chan int, 1) },
}

func orDonePooled(done <-chan struct{}, c <-chan int) <-chan int {
    out := chanPool.Get().(chan int)
    go func() {
        defer chanPool.Put(out)
        defer close(out) // <-- but closed channels cannot be reused!
        // ...
    }()
    return out
}
```

This does *not* work as written: once a channel is closed, it cannot be reused. The pool would hand out closed channels. For real reuse, you need a channel-replacement pool that allocates new channels but reuses backing slices — non-trivial.

In practice, channel allocations are fast enough (~few hundred ns) that pooling is rarely worth the complexity. Spend the engineering effort elsewhere.

### Avoiding closure captures

If the `orDone` function captures local variables, the closure escapes to the heap. Reduce this by passing parameters explicitly:

```go
// Worse: captures done and c via closure
go func() { ... }()

// Better: function-typed go statement (allocates once at compile time)
go orDoneLoop(done, c, out)

func orDoneLoop[T any](done <-chan struct{}, c <-chan T, out chan<- T) {
    defer close(out)
    // ...
}
```

In modern Go (1.21+), the compiler is smart enough that these often optimize to the same code. Measure before refactoring.

---

## Optimisation 7: Skip the Goroutine

If you do not need an asynchronous interface, do not create one. The simplest "non-orDone" form is:

```go
func consume(done <-chan struct{}, c <-chan T, fn func(T)) {
    for {
        select {
        case <-done:
            return
        case v, ok := <-c:
            if !ok {
                return
            }
            fn(v)
        }
    }
}
```

Synchronous. One goroutine (the caller's). No extra channel. Zero per-value overhead beyond the single select.

This is *not* `orDone` — there is no returned channel, no fan-out potential. But for terminal stages, it is the optimal shape.

---

## Optimisation 8: Skip `select` with Atomic Flag

For very hot CPU-bound loops where the channel send/receive itself is too slow, replace the dual-select with an atomic boolean check:

```go
var cancelled atomic.Bool

go func() {
    <-done
    cancelled.Store(true)
}()

for {
    if cancelled.Load() {
        return
    }
    v := computeNext()
    sink(v)
}
```

### Wins

- No channel select. The flag check is a single load (~1 ns).
- No goroutine context switch.

### Costs

- Polling only — cannot wake a blocked goroutine. The loop body must be non-blocking.
- Cancellation latency = time to next `if cancelled.Load()`. May be milliseconds if the loop body is long.
- Loses the rendezvous semantics of channels.

Use only for tight CPU loops where channel selects are measurable overhead. For I/O loops, channels are always better.

---

## Optimisation 9: Channel-of-Pointers vs Channel-of-Values

If `T` is large (more than ~64 bytes), passing values through the channel copies them on every hop. The total per-value cost rises with `sizeof(T)`.

```go
ch := make(chan BigStruct) // copies BigStruct on every send/receive
```

Switch to pointers:

```go
ch := make(chan *BigStruct) // copies a pointer, ~8 bytes
```

### Caveat

Pointers introduce sharing. If the producer mutates `*v` after sending, the consumer may see torn state. The cardinal rule: **relinquish ownership when you send**. Either:

- Don't touch the pointer after sending it.
- Use immutable types (interfaces with no mutating methods).
- Allocate fresh for each send.

For small `T` (a few words), channel-of-values is cheaper because no heap allocation is needed. For large `T`, channel-of-pointers wins by avoiding the copy. Measure.

---

## Optimisation 10: Replace `chan struct{}` with `context.Context`

Despite what you might assume, `context.WithCancel` is *not* slower than a bare done channel for typical use. The `ctx.Done()` channel is allocated on first call and reused; cancellation closes it; the receive cost is identical to a bare channel.

`context` has:

- A small per-context overhead at creation (~100 ns).
- Identical per-cancel cost.
- Better idiomatic fit with the standard library.

If your code already plumbs `context.Context`, use it. Maintaining a parallel `done` channel is duplicated effort, not optimisation.

---

## Optimisation 11: Lock-Free Alternatives

For ultra-high-throughput data planes (millions of values per second per core), Go channels are sometimes the bottleneck. Consider:

- **Ring buffers** (e.g., the `lockring` package or hand-rolled atomic circular buffers).
- **Disruptor patterns** (LMAX-style; rarely seen in Go but possible).
- **`sync/atomic`-based handoff** (single-producer-single-consumer with a small ring).

These are dramatically more complex and only pay off above ~10M values/sec per channel. For 99% of Go code, channels and `orDone` are the right shape.

---

## Optimisation 12: Profile-Driven Composition

Before any of the above, run pprof:

```bash
go test -bench=. -cpuprofile=cpu.out
go tool pprof cpu.out
```

In the profile, look for:

- Time in `runtime.chansend` / `runtime.chanrecv` / `runtime.selectgo`.
- Time spent in `orDone`'s goroutine.
- Allocations attributed to `orDone`-related lines.

If channel operations are *not* in the top 5% of CPU time, optimising them is a waste. Look elsewhere — JSON encoding, database queries, regex — for the real hotspots.

---

## Decision Tree

```
Is the pipeline measurably slow because of orDone?
  No  -> stop. Use canonical orDone.
  Yes -> continue.

Are you in the terminal consumer?
  Yes -> inline the select or use eachOrDone. Done.
  No  -> continue (forwarding stage).

Is per-value latency a problem?
  Yes -> avoid batching; inline the select inside the forwarder.
  No  -> consider batching for throughput.

Are allocations the bottleneck?
  Yes -> pass pointers; reduce closure captures.
  No  -> continue.

Is the throughput above 10M values/sec?
  Yes -> consider lock-free alternatives, not orDone.
  No  -> the canonical or inlined orDone is sufficient.
```

---

## Summary

The canonical `orDone` is fast enough for almost everything. Optimisations are surgical, not blanket. The most reliable wins:

1. Inline the select in terminal stages (saves one goroutine + channel).
2. Combine adjacent stages when both are hot.
3. Batch values when per-value overhead dominates.
4. Use buffered output sparingly to smooth jitter.
5. Pass pointers for large element types.

Resist optimising what is not slow. The 15-line canonical pattern is the right default — its small size and reliability are themselves optimisations of engineering effort.
