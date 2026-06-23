# Fan-In — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Order Preservation Trade-offs](#order-preservation-trade-offs)
3. [Stable k-way Merge](#stable-k-way-merge)
4. [Backpressure Topology](#backpressure-topology)
5. [Dynamic N: `reflect.Select`](#dynamic-n-reflectselect)
6. [Memory Model and Visibility](#memory-model-and-visibility)
7. [Lifecycle Patterns](#lifecycle-patterns)
8. [Layered Fan-In](#layered-fan-in)
9. [Telemetry and Observability](#telemetry-and-observability)
10. [Capacity Planning](#capacity-planning)
11. [Production Failure Modes](#production-failure-modes)
12. [Library Design](#library-design)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

At the senior level, fan-in stops being a code snippet and becomes a design tool. You decide:

- Whether to preserve order or accept interleaving.
- How to handle dynamic input cardinality.
- How to instrument the merge for production telemetry.
- How the merge interacts with surrounding backpressure and lifecycle.

This file assumes fluency with the middle-level material — generics, ctx, errgroup. The new content is the design judgement.

---

## Order Preservation Trade-offs

The default merge is *unordered*. For three reasons:

1. The Go scheduler does not guarantee fairness.
2. Forwarder goroutines may hit `out <- v` at any time.
3. Even within one input, two values can race for the output.

If your domain requires order, you have four options:

| Option | Order | Latency | Throughput |
|--------|-------|---------|-----------|
| Default merge | None | Low | High |
| Sorted downstream (buffer all) | Total | Bounded by total input size | Drops to 0 streaming |
| Tag and re-sort | Per-input | Adds latency = max stragglers | High if stragglers small |
| K-way merge | Stable | Higher constant cost | High if input streams ordered |

A k-way merge is the standard choice for "merge N already-sorted streams in order". Build with `container/heap`.

---

## Stable k-way Merge

Each input must already be ordered. The merge picks the smallest-current-head from N inputs, emits it, advances that input.

```go
import "container/heap"

type kHead[T any] struct {
    Val   T
    Index int // input index
    Less  func(a, b T) bool
}

type kHeap[T any] struct {
    items []kHead[T]
}

func (h kHeap[T]) Len() int            { return len(h.items) }
func (h kHeap[T]) Less(i, j int) bool  { return h.items[i].Less(h.items[i].Val, h.items[j].Val) }
func (h kHeap[T]) Swap(i, j int)       { h.items[i], h.items[j] = h.items[j], h.items[i] }
func (h *kHeap[T]) Push(x any)         { h.items = append(h.items, x.(kHead[T])) }
func (h *kHeap[T]) Pop() any           { n := len(h.items); x := h.items[n-1]; h.items = h.items[:n-1]; return x }

func StableMerge[T any](
    ctx context.Context,
    less func(a, b T) bool,
    cs ...<-chan T,
) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        h := &kHeap[T]{}
        // seed with one head per input
        heads := make([]<-chan T, len(cs))
        copy(heads, cs)
        for i, c := range cs {
            select {
            case <-ctx.Done(): return
            case v, ok := <-c:
                if ok {
                    heap.Push(h, kHead[T]{Val: v, Index: i, Less: less})
                }
            }
        }
        for h.Len() > 0 {
            top := heap.Pop(h).(kHead[T])
            select {
            case <-ctx.Done(): return
            case out <- top.Val:
            }
            select {
            case <-ctx.Done(): return
            case v, ok := <-heads[top.Index]:
                if ok {
                    heap.Push(h, kHead[T]{Val: v, Index: top.Index, Less: less})
                }
            }
        }
    }()
    return out
}
```

Cost per emission: `O(log N)` heap operations. Inputs must each be ordered; if they are not, the result is undefined.

When k-way merge is the right tool:
- Merging sorted log files by timestamp.
- Merging sorted database shards.
- Combining sorted Kafka partitions into one stream.

When it is not:
- Inputs are not individually ordered.
- Order is not actually required by consumers.

---

## Backpressure Topology

Standard fan-in produces a *single* backpressure point: the output channel. Every producer is throttled by it equally. This has two consequences:

- **Fairness**: no producer overwhelms others.
- **Head-of-line blocking**: a slow consumer slows every producer to the same rate.

You can change the topology:

### Per-producer buffer
Wrap each producer in a buffered channel. Each producer has its own queue:

```
producer A ─▶ buf(64) ─┐
producer B ─▶ buf(64) ─┼──▶ Merge ─▶ consumer
producer C ─▶ buf(64) ─┘
```

Consumer slowdowns hit each producer at the same rate but with a delay equal to the buffer drain time. Useful when producers have soft real-time requirements.

### Drop-on-full
Replace `out <- v` with `select { case out <- v: default: drop(v) }` for low-priority telemetry. Producer never blocks; old values are discarded under load.

### Priority merging
If some producers must always reach the consumer, use `select` ordering with the high-priority channel first, plus a fallback `default` for low-priority.

---

## Dynamic N: `reflect.Select`

When N is not known at compile time, the WaitGroup pattern still works (variadic). But for a single-goroutine `select` with N cases, you need `reflect.Select`:

```go
import "reflect"

func DynamicMerge[T any](ctx context.Context, cs []<-chan T) <-chan T {
    out := make(chan T)
    cases := make([]reflect.SelectCase, len(cs)+1)
    cases[0] = reflect.SelectCase{
        Dir:  reflect.SelectRecv,
        Chan: reflect.ValueOf(ctx.Done()),
    }
    for i, c := range cs {
        cases[i+1] = reflect.SelectCase{
            Dir:  reflect.SelectRecv,
            Chan: reflect.ValueOf(c),
        }
    }

    go func() {
        defer close(out)
        active := len(cs)
        for active > 0 {
            chosen, recv, ok := reflect.Select(cases)
            if chosen == 0 {
                return // ctx
            }
            if !ok {
                cases[chosen].Chan = reflect.Value{} // disable
                active--
                continue
            }
            select {
            case <-ctx.Done(): return
            case out <- recv.Interface().(T):
            }
        }
    }()
    return out
}
```

Trade-offs:

- One goroutine instead of N+1. Less scheduler overhead at high N.
- Reflect-based dispatch is ~10x slower per `select` call than native.
- Disabled cases (closed channels) are skipped by giving them a `nil` Chan value.
- The interface{} round-trip imposes a small allocation cost per value.

Use `reflect.Select` when N is large (>100), known only at runtime, and producers are slow enough that the reflect overhead is dwarfed by per-value work. Otherwise the WaitGroup variadic merge is faster and clearer.

---

## Memory Model and Visibility

A value sent on an input channel is observed by the forwarder goroutine via the *receive*. The receive establishes happens-before: writes the producer made before the send are visible to the forwarder.

The forwarder then sends on the output channel. That send happens-before the consumer's receive. Transitively, the producer's writes are visible to the consumer.

Implication: data wrapped in a struct sent through fan-in does not need additional synchronisation. The channel sends form an unbroken chain of happens-before edges.

But: do not retain a pointer to a sent value in the producer and mutate it after sending. The consumer may now see torn state. Standard rule: relinquish ownership when you send.

---

## Lifecycle Patterns

### Pattern: long-lived merge with dynamic registration
A service merges output from a dynamically growing set of producers (e.g. Kafka consumers per topic, one new consumer per topic discovery). Static fan-in with a slice is wrong because the slice changes.

Approach: a *manager* goroutine owns the merge. It has its own input channel that carries `Register` and `Unregister` events. On register, it spawns a forwarder; on unregister, it signals the forwarder to stop.

```go
type registry[T any] struct {
    in  chan registerCmd[T]
    out chan T
    ctx context.Context
}

type registerCmd[T any] struct {
    id   string
    src  <-chan T
    done chan struct{}
}
```

This is essentially a "supervisor" pattern. Senior production fan-ins look like this.

### Pattern: bounded lifetime
A merge scoped to a single request closes when the request handler returns. Drain pending values, cancel ctx, wait for forwarders. Use `goleak` in tests.

---

## Layered Fan-In

For very high N (10,000 producers), one channel becomes the bottleneck. Layer the merge into a tree:

```
1000 producers ─▶ 10 merges of 100 each ─▶ 1 merge of 10 ─▶ consumer
```

Each leaf merge has its own goroutine pool and output buffer. The tree has `O(log N)` depth and the root channel sees `1/branching_factor` of the load per send compared to a flat merge.

Layering helps only when the flat merge is the measured bottleneck. For a few hundred inputs it usually is not. Profile first.

---

## Telemetry and Observability

A production fan-in deserves metrics:

- **Pending count**: items in the output buffer (if buffered).
- **Per-producer rate**: emissions per second per input.
- **Drop count**: if drop-on-full is used.
- **Consumer lag**: time from producer send to consumer receive.
- **Forwarder goroutine count**: should equal N.

Emit via Prometheus or your metrics library. A simple wrapper:

```go
func MergeWithMetrics[T any](
    ctx context.Context,
    metrics *Metrics,
    cs ...<-chan T,
) <-chan T {
    instrumented := make([]<-chan T, len(cs))
    for i, c := range cs {
        instrumented[i] = tap(ctx, c, metrics, i)
    }
    return Merge(ctx, instrumented...)
}

func tap[T any](ctx context.Context, in <-chan T, m *Metrics, idx int) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for v := range in {
            m.Inc(idx)
            select {
            case <-ctx.Done(): return
            case out <- v:
            }
        }
    }()
    return out
}
```

Each input is wrapped in a per-input tap that increments a counter; the tapped channels are then merged.

---

## Capacity Planning

For a high-throughput merge:

1. **Throughput cap** = single channel send cost ≈ 50-150ns. So ~10-20 million sends/sec on one channel.
2. **Goroutine count** = N + 1. Each goroutine ~8 KB stack initial. 10,000 producers ≈ 80 MB stack memory.
3. **Output buffer** = N values worst-case, plus jitter slack. Default unbuffered.
4. **Consumer rate** must match producer aggregate rate or backpressure dominates.

If you need >20M values/sec, you should not be using channels; consider lock-free queues or batched dispatch.

---

## Production Failure Modes

### Slow input drains its forwarder
A producer that is slow does not break the merge. It just contributes fewer values. The forwarder spends most of its time blocked on receive. Fine.

### Producer leaks (never closes)
The forwarder goroutine never exits. The closer never fires. The output stays open forever. Fix: producers must close on exit; add a watchdog timer if necessary.

### Consumer dies
Without ctx, every forwarder blocks on `out <- v`. Solution: always wire ctx through.

### Slow consumer pins memory
Backpressure works, but if the producer side has its own buffer, that buffer fills. Memory rises until OOM. Solution: cap buffers at every layer.

### Race on shared element type
If two producers send the same `*T` (shared pointer) and both mutate it, the consumer sees torn data. Solution: use values, not shared pointers; or copy on send.

---

## Library Design

A senior-level library API for fan-in:

```go
// Package channels provides concurrency primitives.

// Merge fans values from any number of input channels into a single output
// channel. It is the canonical fan-in.
//
// Closing semantics: the output channel is closed when (a) ctx is cancelled,
// or (b) every input channel has been closed by its producer. Producers
// MUST close their channels on completion; failing to do so leaks goroutines.
//
// Order: cross-channel order is NOT preserved. Use StableMerge for ordered
// merging of pre-sorted streams.
//
// Goroutines: Merge uses len(cs) + 1 goroutines internally.
//
// Errors: Merge does not surface errors. Encode them in T or use a sibling
// error channel.
func Merge[T any](ctx context.Context, cs ...<-chan T) <-chan T

// StableMerge performs a k-way merge of N pre-sorted streams using a heap.
// `less` defines the ordering. Inputs must each be sorted in ascending order
// according to `less`; otherwise the result is undefined.
//
// Cost: O(log N) per emitted element.
func StableMerge[T any](ctx context.Context, less func(a, b T) bool, cs ...<-chan T) <-chan T

// MergeWithMetrics wraps Merge with per-input emission counters.
func MergeWithMetrics[T any](ctx context.Context, metrics *Metrics, cs ...<-chan T) <-chan T
```

Three documented contracts: closing, ordering, error policy. Without them, every caller will guess and most will guess wrong.

---

## Cheat Sheet

| Need | Tool |
|------|------|
| Plain merge | `Merge` (variadic) |
| Sorted merge | `StableMerge` (heap) |
| Dynamic N | `reflect.Select` |
| Per-producer buffer | wrap each input in `buffer(c, n)` |
| Drop on full | `select { case out <- v: default: }` |
| Priority | `select` with ordered cases + `default` |
| Telemetry | tap each input |

---

## Summary

Senior fan-in is about design judgement: when to preserve order (k-way merge), when to use reflect for dynamic N, how to layer for high throughput, how to instrument for production. The merge function itself is small; the *system* that uses it is the engineering work. With these tools you can drop fan-in into any production data pipeline with confidence about lifecycle, telemetry, and failure modes.
