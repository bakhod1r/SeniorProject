# Or-Done-Channel — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Cost Model](#cost-model)
3. [Inlining vs Wrapping](#inlining-vs-wrapping)
4. [Backpressure and Buffer Topology](#backpressure-and-buffer-topology)
5. [Memory Model and Visibility](#memory-model-and-visibility)
6. [Composition with Other Combinators](#composition-with-other-combinators)
7. [Multi-Source Cancellation Design](#multi-source-cancellation-design)
8. [API Design](#api-design)
9. [Lifecycle and Supervision](#lifecycle-and-supervision)
10. [Production Failure Modes](#production-failure-modes)
11. [Telemetry](#telemetry)
12. [When `orDone` Is the Wrong Tool](#when-ordone-is-the-wrong-tool)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

At the senior level, `orDone` is no longer a teaching exercise. You evaluate it against alternatives, you account for its cost, you reason about its interaction with the rest of the pipeline, and you decide whether to expose it directly, inline it, or hide it behind a higher-level abstraction.

This file assumes fluency with the middle-level material — generics, `context.Context`, leak testing — and goes after the engineering judgement.

The pattern, again:

```go
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
                    return
                }
            }
        }
    }()
    return out
}
```

It will appear in this file mostly as a baseline for comparison.

---

## Cost Model

Three resources are spent every time `orDone` is invoked:

| Resource | Cost (modern x86_64, Go 1.23, no contention) |
|---|---|
| Goroutine startup | ~1.5–3 µs |
| Per-value channel hop (send + receive) | ~50–150 ns |
| Stack memory for the goroutine | ~2 KB initial, may grow |
| Heap allocation for closure | ~32 bytes if the inner func captures |

For a stream of 1,000,000 elements per second:

- Per-value overhead: 50–150 ns × 1M = 50–150 ms/s. That is 5–15% of one CPU core, *just for the extra hop*.
- Goroutine memory: one extra goroutine. Negligible.

For a stream of 100 elements per second, the overhead is invisible.

**Rule of thumb.** If your stream is below 100K elements/second, `orDone` is free. Between 100K and 1M, measure. Above 1M, inline.

A single `orDone` is cheap. *Stacked* `orDone`s — three or four layers — multiply the cost. In a pipeline with five stages each wrapping its input with `orDone`, every value crosses five extra channels. That is five times the per-hop cost.

---

## Inlining vs Wrapping

The wrapper:

```go
for v := range orDone(done, c) {
    use(v)
}
```

The inlined version:

```go
for {
    select {
    case <-done:
        return
    case v, ok := <-c:
        if !ok {
            return
        }
        use(v)
    }
}
```

The inlined version is faster:

- No extra goroutine.
- No extra channel.
- No extra select-on-send. (`use(v)` is presumed not to block.)

The wrapper is more readable:

- The loop body is plain.
- Cancellation logic is hidden.
- Composes with other stages by passing channels around.

In a *terminal* stage — one whose output is not another channel — the wrapper has no inner-select problem because there is no `out <- v` to block on. The inlined form is clearly cheaper and only marginally less clean.

In a *forwarding* stage — one that sends to its own `out` channel — both forms need the dual select; the wrapper version pays for an extra hop on top of that. Senior judgement: inline in hot paths, wrap in cold ones.

A reasonable compromise: define `orDone` *and* a sibling `eachOrDone`:

```go
// eachOrDone runs fn for every value from c until done closes or c closes.
// Avoids the extra goroutine/channel hop of orDone.
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

This is the right tool for the *terminal* consumer that wants cancellable iteration without a goroutine cost.

---

## Backpressure and Buffer Topology

The wrapped channel changes the backpressure shape of a pipeline.

Before `orDone`:

```
producer ----(c)----> consumer
```

The producer is throttled directly by the consumer's receive rate.

After `orDone` (unbuffered):

```
producer ----(c)----> orDone goroutine ----(out)----> consumer
```

There is one slot of "buffer" between producer and consumer — the value the `orDone` goroutine has just received from `c` and is about to send to `out`. While that send is pending, the goroutine cannot receive again, so the producer is blocked. Behaviour is roughly the same as the unwrapped case, with one extra context switch per value.

After `orDone` (buffered, capacity N):

```
producer ----(c)----> orDone goroutine ----(out, cap=N)----> consumer
```

Now there are N+1 slots between producer and consumer. Producer can race ahead by up to N values. If the consumer is suddenly slow, the producer can fill the buffer before observing backpressure.

For cancellation, the buffer matters: when `done` closes, the `orDone` goroutine exits immediately, but the consumer can still drain values from `out` that were already in the buffer — if it chooses to read. In most code, the consumer's `range out` will see the close and exit; the buffered values are silently dropped.

If you need cancellation to "drain then exit" rather than "abandon", you must implement a different policy. See the `drainOrDone` variant.

---

## Memory Model and Visibility

Channel sends and receives establish happens-before edges. The chain in a wrapped pipeline:

1. Producer writes `v` and sends on `c`.
2. `orDone` goroutine receives `v` from `c`.
3. `orDone` goroutine sends `v` on `out`.
4. Consumer receives `v` from `out`.

By transitivity, all writes the producer made before step 1 are visible to the consumer at step 4.

`done` works the same way: closing `done` happens-before the goroutine's receive on `<-done`. State the cancelling goroutine wrote before `close(done)` is visible to every goroutine that observes the close.

This is why a small flag like `outcome.Cancelled` (set just before `return` in the `orDone` goroutine) can be read by the consumer after the `range` exits *without* a mutex — the channel close establishes the necessary edge.

But: the *order* of writes after the close is your responsibility. If both the producer and the cancelling goroutine write to the same variable, you have a race unless you use atomics or a lock. Channel sends do not synchronise writes among unrelated goroutines.

---

## Composition with Other Combinators

`orDone` is the simplest channel combinator. The family includes:

| Combinator | Effect | Built atop |
|---|---|---|
| `orDone(done, c)` | Make `c` cancellable | `select` |
| `take(done, c, n)` | First `n` values of `c` | `orDone` |
| `repeat(done, vs...)` | Endlessly cycle through `vs` | `select` |
| `tee(done, c)` | Split `c` into two readers | `orDone` |
| `bridge(done, chans)` | Flatten a `<-chan <-chan T` | `orDone` |
| `fanIn(done, cs...)` | Merge N channels into one | `orDone` + `WaitGroup` |
| `fanOut(done, c, n)` | Distribute `c` to N workers | `orDone` |

Each can be expressed in terms of the others. A well-stocked toolkit looks like:

```go
package channelutil

func OrDone[T any](done <-chan struct{}, c <-chan T) <-chan T { ... }
func Take[T any](done <-chan struct{}, c <-chan T, n int) <-chan T { ... }
func Repeat[T any](done <-chan struct{}, vs ...T) <-chan T { ... }
func Tee[T any](done <-chan struct{}, c <-chan T) (<-chan T, <-chan T) { ... }
func Bridge[T any](done <-chan struct{}, chans <-chan <-chan T) <-chan T { ... }
func FanIn[T any](done <-chan struct{}, cs ...<-chan T) <-chan T { ... }
```

The shape is consistent: `done` first, channel(s) and parameters next, returning channel(s). Once callers learn this convention, all combinators are interchangeable.

The senior insight: when you find yourself writing a one-off `select` block more than twice, lift it into a combinator. The combinator costs less than the next bug.

---

## Multi-Source Cancellation Design

When you have more than two cancellation sources, neither nested `orDone`s nor a single `select` is ideal. Three approaches:

### 1. Merge into one channel

```go
func mergeDone(dones ...<-chan struct{}) <-chan struct{} {
    out := make(chan struct{})
    go func() {
        defer close(out)
        switch len(dones) {
        case 0:
            <-make(chan struct{}) // never
        case 1:
            <-dones[0]
        default:
            cases := make([]reflect.SelectCase, len(dones))
            for i, d := range dones {
                cases[i] = reflect.SelectCase{
                    Dir:  reflect.SelectRecv,
                    Chan: reflect.ValueOf(d),
                }
            }
            reflect.Select(cases)
        }
    }()
    return out
}
```

`reflect.Select` is ~10x slower than a static `select`, but it runs *once* — only when one of the dones fires. The cost is paid at cancellation, not per value. Useful when there are many done sources.

### 2. Build a context tree

```go
parent, cancelParent := context.WithCancel(context.Background())
child, _ := context.WithCancel(parent)
grandchild, _ := context.WithCancel(child)
```

Cancelling `parent` cancels child and grandchild automatically. This is the standard-library way and almost always the right choice when the cancellation sources are arranged hierarchically.

### 3. Atomic boolean + cooperative polling

For very hot loops where channel selects are too expensive:

```go
var cancelled atomic.Bool

for {
    if cancelled.Load() {
        return
    }
    work()
}
```

This trades the rendezvous semantics of channels for a non-blocking flag. It is faster but cannot wake a blocked goroutine — only one that is actively spinning. Reserve for tight CPU-bound loops.

---

## API Design

When you design an API that exposes a channel, your `orDone` choice is part of the contract.

### Option A: Take a `done` channel

```go
func Subscribe(done <-chan struct{}, topic string) <-chan Event {
    // internally uses orDone
}
```

Pros: explicit, no `context` dependency.
Cons: doesn't compose with the broader `context`-centric Go ecosystem.

### Option B: Take a `context.Context`

```go
func Subscribe(ctx context.Context, topic string) <-chan Event {
    // internally uses orDone(ctx.Done(), ...)
}
```

Pros: consistent with the standard library and most third-party code.
Cons: requires a context even when one is overkill.

### Option C: Return a cancellation function

```go
func Subscribe(topic string) (<-chan Event, context.CancelFunc) {
    // internally: ctx, cancel := context.WithCancel(context.Background())
    return orDoneCtx(ctx, raw), cancel
}
```

Pros: the caller does not need to manage a context tree.
Cons: easy to forget to call `cancel()` — leaks.

For library code aimed at modern Go users, **Option B** is the default. Reserve A for very small self-contained packages and C for niche use cases where the caller does not have a natural context.

### Document closure semantics explicitly

Whichever option you choose, the docstring must say:

```go
// Subscribe returns a channel of events for the given topic.
//
// The returned channel is closed when ctx is cancelled or when the
// subscription is terminated server-side. Values pending at the
// moment of cancellation may be dropped.
//
// The caller must drain the channel to allow internal goroutines to
// exit promptly.
func Subscribe(ctx context.Context, topic string) <-chan Event
```

Three sentences cover the three things every caller needs to know: when does it close, what happens to in-flight values, what must the caller do.

---

## Lifecycle and Supervision

In long-running services, `orDone`-wrapped channels are typically owned by a supervisor goroutine — a small "manager" loop that:

1. Owns the `done` channel (creates and eventually closes it).
2. Spawns producer and consumer goroutines.
3. Wraps producer outputs with `orDone(done, ...)`.
4. Tracks workers in a `WaitGroup`.
5. On shutdown: closes `done`, then `wg.Wait()`s, then logs the outcome.

```go
type Service struct {
    done chan struct{}
    wg   sync.WaitGroup
}

func (s *Service) Start() {
    s.done = make(chan struct{})

    src := producer(s.done)
    pipeline := stage1(s.done, orDone(s.done, src))

    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        for v := range orDone(s.done, pipeline) {
            handle(v)
        }
    }()
}

func (s *Service) Stop() {
    close(s.done)
    s.wg.Wait()
}
```

This is a recurring shape. The supervisor *creates* `done`, *owns* it, and *closes* it once. Everyone else takes a read-only view (`<-chan struct{}`).

---

## Production Failure Modes

### 1. `done` is never closed

The most common production bug. A code path returns early without firing the cancellation. Every `orDone` goroutine in the pipeline lives forever. Memory and goroutine count climb.

Mitigation: `defer close(done)` at the spawning site, before any branching logic. Add a `goleak` test that exercises every early-return path.

### 2. Producer ignores `done`

`orDone` cannot stop a producer that does not observe `done`. Worst case: the producer sends synchronously into a channel no one is reading, and blocks forever. The `orDone` goroutine has exited; the producer leaks alone.

Mitigation: every producer in your codebase takes `done` (or `ctx`) and observes it in its send-select.

### 3. Double-close panic

```go
close(done)
close(done) // panic
```

Either guard with `sync.Once` or, better, use `context.WithCancel`, whose `cancel()` is idempotent.

### 4. `done` closed too early during a hot send

When `done` is closed mid-send, the in-flight value is discarded by `orDone`'s inner select. If that value was a `db.Commit` or similar side-effect-bearing operation, you have an *external* effect with no internal record. Mitigate by performing side effects *after* observation, not before sending.

### 5. Slow consumer + buffered `orDone`

A buffered `orDone` lets the producer race ahead. If the consumer stalls, the buffer fills, the producer blocks, and now you have a pipeline-wide stall that took N values longer to detect than the unbuffered case. Mitigate by keeping `orDone` unbuffered unless you have a measured reason.

### 6. Goroutine leak detector flake

`goleak` may report a leak because some background goroutine (such as a network poller) is still alive on test teardown. Wrap with `goleak.IgnoreTopFunction("net/http.(*pollDesc).waitRead")` or similar to suppress noise. But ensure you do not paper over real leaks.

---

## Telemetry

For production pipelines:

- **Wrapped-channel count** — number of live `orDone` goroutines. A monotonic rise without bound is the canonical leak signature.
- **Cancellation latency** — time from `close(done)` to the consumer's `range` exiting. Should be in microseconds; if it climbs, a stage is stuck.
- **In-flight drop count** — values discarded because `done` fired before they were delivered. Useful for "did we lose work?" investigations.
- **Producer-side block time** — time the producer spends in `send`. Rising indicates a consumer slowdown.

Instrument by wrapping `orDone` with a metrics-aware sibling:

```go
func orDoneObs[T any](
    done <-chan struct{},
    c <-chan T,
    m *Metrics,
) <-chan T {
    out := make(chan T)
    go func() {
        m.Inc("ordone.live", 1)
        defer m.Inc("ordone.live", -1)
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
                    m.Inc("ordone.dropped", 1)
                    return
                }
            }
        }
    }()
    return out
}
```

Wrap exactly where you want metrics; do not wrap every `orDone` use unless you genuinely need that granularity.

---

## When `orDone` Is the Wrong Tool

There are real situations where `orDone` is not the right answer:

- **You need to drain on cancel.** `orDone` discards in-flight values. Build `drainOrDone` instead.
- **You need precise back-and-forth signaling.** A simple done-channel is one-shot, broadcast. If you need handshakes, use a request-reply channel or a small state machine.
- **You need bounded delivery time after cancel.** `orDone` exits *when the goroutine next reaches a select*. If the consumer is blocked elsewhere, the goroutine can still be paused. Use `ctx.WithTimeout` to bound the wait.
- **The producer cannot be modified.** `orDone` does not stop the producer, only your view of it. If you need to actually free the upstream goroutine, you must change the producer.
- **You need backpressure from consumer to producer with a buffer in between.** `orDone` adds a buffer of 0 or N values; backpressure is preserved but exact behaviour depends on buffer size.
- **You are inside a hot path where the extra hop is measurable.** Inline the select.

Recognising the wrong tool is the senior skill that distinguishes "knows the pattern" from "knows when to use it."

---

## Cheat Sheet

| Need | Tool |
|---|---|
| Cancellable `range` over a single channel | `orDone(done, c)` |
| Cancellable single-stage consumer, no extra goroutine | `eachOrDone(done, c, fn)` |
| Two cancellation sources | `orDone(done1, orDone(done2, c))` or merged context |
| Many cancellation sources | `reflect.Select` merger or context tree |
| Take first N values cancellably | `take(done, c, n)` |
| Cancellable fan-in / tee / bridge | Built atop `orDone` |
| Drain remaining values on cancel | Custom `drainOrDone` |
| `ctx` interop | `orDoneCtx(ctx, c) = orDone(ctx.Done(), c)` |

---

## Summary

At senior level, `orDone` is no longer just a pattern; it is a piece of the channel-combinator toolkit you use to design pipelines. You know what it costs (one goroutine, one hop), when to inline it (hot paths), how to compose it (nested for two signals, merged or context-tree for more), how to make it observable (live count, drop count, cancel latency), and when to reach for something else (drain, deadlines, no-channel paths).

The pattern itself remains fifteen lines. The judgement around it — API choice, lifecycle ownership, buffer policy, telemetry — is the engineering. With those in hand, channels stop being a source of bugs and start being a tool you can wield with confidence.
