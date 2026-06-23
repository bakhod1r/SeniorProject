# Tee-Channel — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Tee vs Fan-Out vs Broadcast](#tee-vs-fan-out-vs-broadcast)
3. [The Asymmetric Tee](#the-asymmetric-tee)
4. [Lossy Tee for Non-Critical Branches](#lossy-tee-for-non-critical-branches)
5. [Tee with `context.Context`](#tee-with-contextcontext)
6. [Chaining Tee Beyond N=2](#chaining-tee-beyond-n-2)
7. [Tee Inside `errgroup` Pipelines](#tee-inside-errgroup-pipelines)
8. [Tee of Pointers vs Tee of Values](#tee-of-pointers-vs-tee-of-values)
9. [Testing Strategy](#testing-strategy)
10. [Anti-Patterns](#anti-patterns)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)

---

## Introduction

Junior level showed you the canonical tee: one goroutine, two outputs, the nil-channel-after-send trick. Middle level is about *placing* tee in real pipelines. The mechanics are settled; the choices are now editorial — when to buffer, when to drop, when to abandon tee for a hub, and how tee composes with context-aware error handling.

We will assume the generic signature is given:

```go
func Tee[T any](done <-chan struct{}, in <-chan T) (<-chan T, <-chan T)
```

and we will iterate on its variants and its placement.

---

## Tee vs Fan-Out vs Broadcast

The three patterns are easy to confuse because they all involve "one channel becomes many." The distinction is *what each downstream sees*.

| Pattern | Inputs | Outputs | Each output receives |
|---------|--------|---------|----------------------|
| Fan-out | 1 | N (variable) | a partition of the stream |
| Tee | 1 | 2 (fixed) | the entire stream |
| Broadcast hub | 1 | N (variable) | the entire stream |

Read that table twice. The defining axis is *partition versus duplication*. The secondary axis is *static N versus dynamic N*.

### Why fan-out is NOT tee

Fan-out is used when *the work is the same and the order does not matter*. Five workers each pull from one channel; each value is processed by *exactly one* worker; throughput scales with worker count. If a worker is slow, others keep up by taking more values. There is no notion of "every worker sees every value" — that would defeat the purpose of fan-out, which is load distribution.

Tee is used when *each output stage is different* and *each one needs every value*. Logger and processor; audit and search index; trace and business path. Slow consumer slows the producer, by design.

A test you can apply: if you imagine doubling one consumer (running two of it), does the system semantics change?
- **Fan-out:** doubling a worker speeds the system up. Workers are interchangeable.
- **Tee:** doubling a consumer is meaningless. Each consumer is unique.

### Why tee is NOT a broadcast hub

Broadcast hubs in Go are usually mutex-guarded maps of subscribers, with `Subscribe()`, `Unsubscribe()`, and a per-subscriber buffered channel plus a drop policy. They handle:

- Dynamic N (subscribers come and go).
- Per-subscriber overflow policy (block, drop newest, drop oldest).
- Topics or filters.
- Independent subscriber lifecycles.

Tee handles none of that. Tee is a primitive — two outputs, fixed, coupled, in-order, no policy. When you find yourself adding subscribe/unsubscribe to tee, you are reinventing a hub poorly. Switch.

The boundary is somewhere between N=2 and N=4. With N=3, chaining one extra tee is clean. With N=5, you have a binary tree of four tees: maintenance overhead, latency, and asymmetric backpressure (the deepest leaves wait for the most ancestors). Use a hub.

### Cross-reference

For full broadcast see [`05-concurrency-patterns/06-broadcast-pattern`](../../05-concurrency-patterns/06-broadcast-pattern/). The middle-level file there builds a small `Hub[T]` library with overflow policies — read it next if you are about to reach for tee at N≥4.

---

## The Asymmetric Tee

The default tee couples its two consumers. If consumer B is slower, A waits behind B. In many real pipelines that is wrong: you want B to *try* to keep up, but you do not want B's slowness to harm A.

The asymmetric tee buffers one side:

```go
func TeeAsym[T any](done <-chan struct{}, in <-chan T, bufB int) (<-chan T, <-chan T) {
    outA := make(chan T)             // strict
    outB := make(chan T, bufB)       // slack
    go func() {
        defer close(outA)
        defer close(outB)
        for v := range in {
            a, b := outA, outB
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
    return outA, outB
}
```

How it behaves:

- If both consumers keep up, behaviour is identical to the unbuffered tee.
- If B falls behind by fewer than `bufB` items, the buffer absorbs the lag; A is unaffected.
- If B falls behind by `bufB` items, the buffer fills, B's send blocks, and the producer reverts to the unbuffered-tee behaviour: full coupling.

That is the right property: *bounded* decoupling. You are not introducing unbounded latency; you are buying a quantum of slack. Choose `bufB` based on the worst-case burst you expect, plus a safety factor.

When the slow side really must never block the fast side, see the next section.

---

## Lossy Tee for Non-Critical Branches

Sometimes the second branch is best-effort: a metrics sink, a debug tap, a sampling exporter. You would rather drop a value than slow the producer.

```go
func TeeLossy[T any](done <-chan struct{}, in <-chan T, bufB int) (
    outA <-chan T, outB <-chan T, dropped *uint64,
) {
    a := make(chan T)
    b := make(chan T, bufB)
    var d uint64
    go func() {
        defer close(a)
        defer close(b)
        for v := range in {
            // Critical branch: must deliver.
            select {
            case <-done:
                return
            case a <- v:
            }
            // Best-effort branch: try, drop on overflow.
            select {
            case b <- v:
            default:
                atomic.AddUint64(&d, 1)
            }
        }
    }()
    return a, b, &d
}
```

Differences from the symmetric tee:

- The two sends are now *sequential*, not selected. The critical branch goes first.
- The second send uses `default`, which converts a blocking send into a no-op when the buffer is full.
- A counter exposes the drop rate so operators can alarm on it.

This is no longer truly "tee" in the strict sense — the two branches are not equivalent. But the pattern is so common in production that it deserves the name *asymmetric lossy tee*. Document the contract clearly: branch B may lose values; branch A never does.

Variants:

- **Drop-newest** (above): the new value is dropped if the buffer is full.
- **Drop-oldest**: the oldest buffered value is dropped to make room for the new one. Requires an internal dequeue or a chan-with-replace trick; complicates the implementation.
- **Sample-1-in-N**: branch B receives only every Nth value. Cheap and often what you really wanted.

---

## Tee with `context.Context`

Modern Go code uses `context.Context` rather than a bare `done` channel. Tee adapts trivially:

```go
func Tee[T any](ctx context.Context, in <-chan T) (<-chan T, <-chan T) {
    out1, out2 := make(chan T), make(chan T)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            a, b := out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-ctx.Done():
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

Two practical reasons to prefer `context.Context`:

1. **Composition with libraries.** `errgroup.WithContext`, `net/http`, `database/sql` — they all accept a context. Wiring tee's cancellation to the same context is one line.
2. **Cancellation reason.** `ctx.Err()` distinguishes `context.Canceled` from `context.DeadlineExceeded`. A bare `done` channel cannot.

Reasons to keep the bare `done`:

- The combinator is meant to be reused outside contexts (e.g., in a library with its own lifecycle).
- The team has a strong house style of channel-only combinators (the Cox-Buday vocabulary).

Both styles are valid. Be consistent within a codebase.

---

## Chaining Tee Beyond N=2

For N=3:

```go
a, rest := Tee(ctx, in)
b, c := Tee(ctx, rest)
// a, b, c each receive every value
```

For N=4:

```go
a, x := Tee(ctx, in)
b, y := Tee(ctx, x)
c, d := Tee(ctx, y)
```

What goes wrong as N grows:

- **Goroutine count** is N-1.
- **Latency** is logarithmic if you tree it carefully, linear if you chain naively. The example above is linear (each new output forks at the tail).
- **Backpressure topology** becomes confusing. A slow consumer deep in the chain still slows everything, but tracing why is harder.

Tree the chain to keep latency log-shaped:

```go
ab, cd := Tee(ctx, in)
a, b := Tee(ctx, ab)
c, d := Tee(ctx, cd)
// 3 tees, depth 2
```

This is structurally identical to building a binary tree of fan-out duplicators. By the time you draw it on a whiteboard you usually realise a hub is simpler. Past N=4, switch.

---

## Tee Inside `errgroup` Pipelines

`errgroup.Group` makes lifecycle management cleaner. Tee fits in naturally:

```go
import "golang.org/x/sync/errgroup"

func RunPipeline(ctx context.Context, src <-chan Event) error {
    g, ctx := errgroup.WithContext(ctx)
    toAudit, toBiz := Tee(ctx, src)

    g.Go(func() error { return ship(ctx, toAudit) })
    g.Go(func() error { return process(ctx, toBiz) })

    return g.Wait()
}
```

How errors propagate:

1. `process` returns an error.
2. `errgroup` cancels `ctx`.
3. The tee goroutine's next `select` picks `<-ctx.Done()` and returns.
4. Both output channels close.
5. `ship`'s `for v := range toAudit` exits on EOF.
6. `g.Wait()` returns the first error.

Notice the tee goroutine is *not* `g.Go(...)`. It does not return an error. If you want it to:

```go
func TeeErr[T any](ctx context.Context, in <-chan T) (<-chan T, <-chan T, func() error) {
    out1, out2 := make(chan T), make(chan T)
    errOnce := func() error { return ctx.Err() }
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            a, b := out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-ctx.Done():
                    return
                case a <- v:
                    a = nil
                case b <- v:
                    b = nil
                }
            }
        }
    }()
    return out1, out2, errOnce
}
```

`errOnce` lets the caller surface `ctx.Err()` if it wants tee's exit reason. Usually you do not — the consumers' own errors are more informative.

---

## Tee of Pointers vs Tee of Values

The Go channel runtime sends a *copy* of whatever value type you push. For a small value like `int`, that copy is cheap and the two consumers see independent integers. For a struct that contains pointers — slices, maps, interfaces, channels — the channel copies the *header*, and the two consumers' values *alias the same backing storage*.

Concrete example:

```go
type Event struct {
    ID   string
    Tags []string
}

in := make(chan Event)
a, b := Tee(ctx, in)

go func() {
    for ev := range a {
        ev.Tags[0] = "rewritten-by-A"
    }
}()
go func() {
    for ev := range b {
        fmt.Println(ev.Tags[0]) // may print "rewritten-by-A"
    }
}()
```

The two `ev` variables are independent struct copies, but their `Tags` slice headers point to the same underlying array. Mutation through one observable from the other.

Three responses:

1. **Treat tee values as immutable.** Document this. Code review enforces.
2. **Deep-copy at the tee.** Add a `Clone()` method to your payload and call it inside tee for one branch. Doubles the allocation cost.
3. **Tee primitives, not aggregates.** If your stream carries `int`, `string`, `time.Time`, you are safe. Refactor to send IDs and have consumers fetch by ID if mutation is a real concern.

Most pipelines treat tee values as immutable. If you cannot, you have a deeper design problem than tee.

---

## Testing Strategy

A tee implementation deserves three categories of test:

### 1. Correctness: both outputs receive the same sequence

```go
func TestTeeDuplicates(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    in := make(chan int)
    a, b := Tee(ctx, in)

    go func() {
        for i := 0; i < 1000; i++ {
            in <- i
        }
        close(in)
    }()

    var got1, got2 []int
    var wg sync.WaitGroup
    wg.Add(2)
    go func() { defer wg.Done(); for v := range a { got1 = append(got1, v) } }()
    go func() { defer wg.Done(); for v := range b { got2 = append(got2, v) } }()
    wg.Wait()

    if !reflect.DeepEqual(got1, got2) {
        t.Fatal("outputs diverged")
    }
}
```

### 2. Cancellation: closing `ctx` stops the goroutine and closes both outputs

Use `runtime.NumGoroutine()` before and after to assert no leak.

```go
func TestTeeNoLeak(t *testing.T) {
    before := runtime.NumGoroutine()
    ctx, cancel := context.WithCancel(context.Background())
    in := make(chan int)
    a, b := Tee(ctx, in)
    go func() { in <- 1 }()
    <-a
    cancel()
    // Drain to allow goroutine exit.
    for range a { }
    for range b { }
    time.Sleep(10 * time.Millisecond)
    after := runtime.NumGoroutine()
    if after > before {
        t.Errorf("leaked %d goroutines", after-before)
    }
}
```

### 3. Backpressure: slow consumer paces producer

```go
func TestTeeBackpressure(t *testing.T) {
    ctx := context.Background()
    in := make(chan int)
    a, b := Tee(ctx, in)

    sent := 0
    go func() {
        for ; sent < 100; sent++ {
            in <- sent
        }
        close(in)
    }()

    go func() { for range a {} }() // fast
    time.Sleep(20 * time.Millisecond)
    if sent > 1 {
        t.Errorf("producer ran ahead of slow consumer: sent=%d", sent)
    }
    for range b { /* unblock now */ }
}
```

The third test verifies a design intent that no code-coverage tool will catch.

### What not to test

- The exact ordering of `out1` vs `out2` first-receive per value. It is intentionally non-deterministic.
- The internal goroutine count of tee itself. Implementation detail.

---

## Anti-Patterns

### Tee then immediately fan-in

```go
a, b := Tee(ctx, in)
merged := fanIn(a, b)
```

`merged` now carries every value *twice*. If that is what you want, fine. Usually it is a thinko — the author forgot tee duplicates.

### Tee with no consumer on one side

```go
a, _ := Tee(ctx, in)
```

The `_` discards the channel. Nobody reads `out2`. The first send to `out2` blocks forever. Producer stalls. Tee goroutine leaks.

If you truly want one output, you do not want tee.

### Tee inside a per-request handler

```go
func handle(w, r) {
    in := source(r)
    a, b := Tee(ctx, in)
    ...
}
```

Each request spawns a tee goroutine. Per-request goroutine spawn is fine; per-request *pipeline topology* is usually wasteful. If the same tee shape applies to all requests, build it at startup and feed it.

### Tee to "save a copy in case I need it"

```go
a, archive := Tee(ctx, in)
go func() { for range archive {} } // discards
```

You are paying for tee's overhead but throwing away its value. Drop the tee.

### Tee with hard-coded types instead of generics

In Go 1.18+ there is no excuse for `teeInt`, `teeString`, `teeEvent`. One generic `Tee[T any]` covers all.

### Cancellation by closing `in` *and* `done` simultaneously

The combinator's contract is "stop on whichever happens first." Doing both at once means you cannot reason about how many values were delivered. Pick one as the canonical shutdown signal.

---

## Cheat Sheet

```
Pattern         Outputs   Each output sees   N variable   Typical use
-------------   -------   ----------------   ----------   --------------------
fan-out         N         partition          yes          load balancing
tee             2         full duplicate     no           dual-sink ingestion
chained tee     3-4       full duplicate     no           tee with one extra
broadcast hub   N         full duplicate     yes          pub/sub
```

```
Tee variants:
  symmetric unbuffered  — strict backpressure, default
  symmetric buffered    — bursts smoothed equally
  asymmetric buffered   — one side has slack, other strict
  lossy asymmetric      — best-effort branch may drop
```

```
Always:
  defer close(out1); defer close(out2)
  select on done as the first case
  nil out the channel after each send

Never:
  share one output channel between two tees
  spawn tee per request when topology is static
  ignore the second output
```

---

## When Tee Touches a Slow Upstream

Most discussion of tee assumes a fast producer and one or more consumers. The reverse case — slow producer, fast consumers — is also worth a moment.

If `in` produces one value per second and both consumers can process millions per second, tee does no useful work most of the time. The goroutine is parked on `for v := range in`, waiting. Each value triggers two sends, both immediate. Throughput is bounded by the producer.

This is the correct behaviour, but it has a subtlety: if you have N tees downstream from a slow producer, each tee burns one goroutine to do nothing for most of the second. In a system with thousands of low-rate streams (e.g., per-connection telemetry), the aggregate goroutine count can grow alarming. Mitigations:

- Coalesce multiple low-rate streams into one higher-rate stream before tee.
- Use a single hub instead of many tees when many low-rate producers fan out to the same set of consumers.

For a single low-rate stream with two consumers, tee remains the right tool. The cost of one parked goroutine is negligible.

---

## Composing Tee with Filter and Map Stages

Tee often appears between transformation stages. The composition is straightforward but worth illustrating.

```go
// raw -> filter -> tee -> [map_a -> sink_a, map_b -> sink_b]

raw := source()
filtered := filter(ctx, raw, isInteresting)
ta, tb := Tee(ctx, filtered)
mappedA := mapper(ctx, ta, transformA)
mappedB := mapper(ctx, tb, transformB)
go drain(ctx, mappedA, sinkA)
go drain(ctx, mappedB, sinkB)
```

Each stage is a small combinator that takes `ctx` and a channel and returns a channel. Tee is one of those combinators; it just happens to return two channels. The pipeline composes left-to-right and the entire shape reads as a single sentence: filter the raw stream, split it into two paths, transform each path, drain to its sink.

Generic helpers make this even cleaner:

```go
func Pipe[A, B any](ctx context.Context, in <-chan A, f func(A) B) <-chan B {
    out := make(chan B)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case <-ctx.Done():
                return
            case out <- f(v):
            }
        }
    }()
    return out
}
```

Now:

```go
ta, tb := Tee(ctx, filtered)
sinkA := Pipe(ctx, ta, transformA)
sinkB := Pipe(ctx, tb, transformB)
```

Each line is a verb. The shape of the pipeline matches the shape of the data flow.

---

## When Tee Must Synchronise the Two Branches

A rare but real requirement: the two consumers must see the same value at the same time. Strict tee does *not* guarantee simultaneity — it guarantees order and completeness. One consumer may be ahead of the other by some number of values, depending on their relative pace and the buffer sizes.

If true synchronisation is required, you need a different primitive: a barrier between the two consumers, or a transaction. Examples where this matters:

- A two-phase commit where both sinks must acknowledge before the producer advances.
- A correctness test that compares the two outputs at every value.

For (2), test code that consumes both outputs and asserts equality is the right approach — it does not need tee to be synchronous; it just needs to drain both and compare. For (1), tee is the wrong tool entirely; you want explicit per-value ack from both consumers, which is closer to a two-phase commit protocol.

Tee provides *order-preserving duplication*, not *synchronous delivery*. Be sure you want the former.

---

## Operational Concerns at Middle Level

A few things to think about once tee is in production:

### Metrics

Expose counters for values into `in`, values out of `out1`, values out of `out2`. In a healthy strict tee, all three counts converge to the same value over time (modulo a small in-flight window). Drift indicates a stuck consumer.

### Logging

Do not log inside the tee body — it would inflate the cost of every value. Logging belongs in consumers. If you need to see traffic through tee, use a sampled debug log in the consumer.

### Health checks

Tee itself has no health check; it is a goroutine. Its health is "is the goroutine running?" which can be probed indirectly via the counters above. A counter that stops incrementing while `in` still produces is a smoking gun.

### Profiling

`go tool pprof` against a CPU profile will show `runtime.selectgo` and `runtime.chansend` high in the call tree if tee is hot. That's normal. If `runtime.gopark` dominates, your consumers are slow and your goroutine is mostly parked — also normal, not a bug.

---

## Summary

Middle level is the level where you stop asking "how does tee work?" and start asking "should I use tee here, or a buffered tee, or a lossy tee, or a hub?" The choices line up along three axes: how much backpressure coupling do you want, how many outputs do you need, and how dynamic is the consumer set.

The symmetric unbuffered tee is the safe default. Switch to buffered when bursts are bounded and known. Switch to lossy asymmetric when one branch is non-critical. Switch to a hub the moment you need dynamic subscribe or N > 3. Everything else — generics, context, errgroup integration, profiling, metrics — is plumbing on top of the same six-line core.
