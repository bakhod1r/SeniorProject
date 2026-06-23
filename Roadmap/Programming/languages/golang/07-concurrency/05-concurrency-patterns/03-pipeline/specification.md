# Pipeline — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Formal Definition](#formal-definition)
3. [Stage Signature](#stage-signature)
4. [Preconditions](#preconditions)
5. [Postconditions](#postconditions)
6. [Closing Protocol](#closing-protocol)
7. [Cancellation Semantics](#cancellation-semantics)
8. [Memory Model Edges](#memory-model-edges)
9. [Ordering Semantics](#ordering-semantics)
10. [Resource Bounds](#resource-bounds)
11. [Concurrency Invariants](#concurrency-invariants)
12. [Composition Rules](#composition-rules)
13. [Edge Cases](#edge-cases)
14. [Reference Stage Implementation](#reference-stage-implementation)
15. [Compliance Checks](#compliance-checks)
16. [Summary](#summary)

---

## Introduction

This file is the formal specification of a *pipeline stage*. A pipeline is a composition of stages connected by channels. The contract for the pipeline as a whole follows from the contract of each stage.

---

## Formal Definition

A **stage** is a function:

```go
type Stage[In, Out any] func(ctx context.Context, in <-chan In) <-chan Out
```

For a stage `S`, the contract is:

1. `S(ctx, in)` returns a freshly-created receive channel `out` of type `Out`.
2. `S` spawns one or more goroutines that read from `in` and write to `out`.
3. The goroutines exit when (a) `in` is drained and closed, or (b) `ctx.Done()` is ready.
4. `out` is closed exactly once, after every spawned goroutine has exited.
5. `S` returns immediately; all work is asynchronous.

A **pipeline** is a composition of stages: `Sn(ctx, ... S2(ctx, S1(ctx, source))...)`. Closing of the source's channel cascades through every stage; each stage closes its output when its input is drained, and so on.

---

## Stage Signature

The canonical signature is:

```go
func StageName(ctx context.Context, in <-chan In) <-chan Out
```

Variants:

- **Producer / source**: no `in` parameter. `func Source(ctx context.Context) <-chan Out`.
- **Consumer / sink**: no return. `func Sink(ctx context.Context, in <-chan In)` or `func Sink(ctx context.Context, in <-chan In) error`.
- **Configurable**: take additional parameters. `func Filter(ctx context.Context, in <-chan T, pred func(T) bool) <-chan T`.

Producers and sinks are called *terminal stages*.

---

## Preconditions

- `ctx` is non-nil.
- `in` is a non-nil channel (except for producers).
- Producers eventually close their output if their `for`/`range` body terminates normally.
- Stage authors must use the two-select sandwich (ctx-aware receive AND ctx-aware send).
- Stage's spawned goroutines must call `close(out)` on every exit path (use `defer close(out)`).

---

## Postconditions

- The returned channel is freshly created and not yet closed.
- The output channel is closed when the stage's input is drained AND `ctx` has not been cancelled, OR `ctx` is cancelled.
- After the output channel is closed, all goroutines spawned by the stage have exited.
- For each input value `v` not dropped (due to filter logic) or skipped (due to cancellation), exactly one output value is produced — or N output values for fan-out stages.

---

## Closing Protocol

The pipeline's closing protocol is a chain:

1. Source closes its output when its data source is exhausted.
2. Each subsequent stage's `range` over its input exits when the input is closed.
3. The stage's deferred `close(out)` fires, signalling the next stage.
4. The chain reaches the sink, which sees its input closed and exits.

When `ctx` is cancelled mid-stream:

1. Each stage's two-select sandwich observes `<-ctx.Done()` and returns.
2. Each stage's deferred `close(out)` fires.
3. The chain unwinds in roughly the order the goroutines are scheduled.

The spec does not bound the stage exit time; it depends on whether `work` inside each stage respects `ctx`. The convention: pass `ctx` into any blocking call.

---

## Cancellation Semantics

Cancellation is cooperative:

- Stages that respect ctx exit promptly.
- Stages that ignore ctx (e.g., a long sync.Mutex.Lock or a blocking syscall without ctx) delay propagation.
- The pipeline's overall shutdown time is the max stage exit time.

For deterministic shutdown, all stages must use the two-select sandwich and pass ctx into any potentially blocking sub-call.

---

## Memory Model Edges

For a value `v` produced by stage `S_i` and consumed by stage `S_{i+1}`:

- The send `S_i.out <- v` happens-before the matching receive in `S_{i+1}`.
- All writes `S_i` made before the send are visible to `S_{i+1}` after the receive.

By transitivity, writes in any earlier stage are visible to any later stage that receives a value derived from those writes. This is what makes pipelines safe without explicit synchronisation between stages — the channel sends are the synchronisation.

Stages MUST NOT mutate values they have already sent. The downstream stage may read concurrently; mutation is a race.

---

## Ordering Semantics

- Within a single-goroutine stage (one input, one output, one worker), order is preserved: output order matches input order.
- For a stage with internal fan-out (multiple workers reading the same input), order is generally NOT preserved: faster work calls finish first.
- For a stage with fan-out + downstream merge, order is NOT preserved.
- For order-preserving processing across fan-out, attach a sequence number and re-sort downstream.

---

## Resource Bounds

- A stage spawns `k` goroutines, where `k` depends on the stage (typically 1 for sequential stages, `n` for fan-out stages with `n` workers).
- A stage creates exactly 1 channel (its output).
- Memory is bounded by: closure captures + output channel buffer + per-worker scratch.
- Lifetime: until input is drained AND ctx not cancelled, or ctx is cancelled.

For a pipeline of `K` stages with average `g` goroutines per stage, total goroutines = `K * g`.

---

## Concurrency Invariants

1. **Each stage closes its own output**: not the input, never another stage's channel.
2. **Single close per channel**: each output channel is closed exactly once.
3. **No value duplication**: a single-worker stage produces output values one-to-one with input values (modulo filter logic).
4. **Cancellation cascades**: ctx cancel causes every stage to exit in finite time (assuming stages respect ctx).
5. **No leaked goroutines**: after all stages exit, no goroutine remains.

---

## Composition Rules

For stages `S1: A → B` and `S2: B → C`, the composition `Then(S1, S2): A → C` is defined as:

```go
func Then[A, B, C any](s1 Stage[A, B], s2 Stage[B, C]) Stage[A, C] {
    return func(ctx context.Context, in <-chan A) <-chan C {
        return s2(ctx, s1(ctx, in))
    }
}
```

Composition is associative: `Then(Then(S1, S2), S3) ≡ Then(S1, Then(S2, S3))`.

A pipeline is `Sn ∘ ... ∘ S2 ∘ S1` applied to a source channel.

For parallel stages, the compositional operator is `Parallel(S, n)`:

```go
func Parallel[In, Out any](s Stage[In, Out], n int) Stage[In, Out] {
    return func(ctx context.Context, in <-chan In) <-chan Out {
        outs := make([]<-chan Out, n)
        for i := 0; i < n; i++ {
            outs[i] = s(ctx, in)
        }
        return Merge(ctx, outs...)
    }
}
```

`Parallel(S, n)` violates order preservation but increases throughput.

---

## Edge Cases

- **Empty input**: source closes its output immediately; each stage drains immediately; pipeline completes.
- **Single value**: pipeline processes one value, then drains.
- **Source error**: producer logs and closes early; downstream stages see closure and exit cleanly.
- **Stage panic**: implementation-defined. The spec allows the panic to propagate (terminating the pipeline) or to be recovered (continuing but logging).
- **Ctx cancelled at call site**: every stage exits at first select; `out` closes immediately.

---

## Reference Stage Implementation

```go
func MapStage[In, Out any](
    ctx context.Context,
    in <-chan In,
    f func(In) Out,
) <-chan Out {
    out := make(chan Out)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-in:
                if !ok {
                    return
                }
                r := f(v)
                select {
                case <-ctx.Done():
                    return
                case out <- r:
                }
            }
        }
    }()
    return out
}
```

This satisfies every clause above. The two-select sandwich is mandatory.

---

## Compliance Checks

A test suite for any stage must verify:

1. Empty input → closed output.
2. N input values → at most N output values; in non-fanout stages, exactly N (modulo filter).
3. Cancel ctx mid-stream → output closes in finite time; no goroutine leak.
4. After test, `goleak.VerifyNone(t)` passes.
5. `go test -race` reports no races.

For pipelines (multiple stages composed):

1. End-to-end: known input → known output; assert multiset equality.
2. Cancel: in-flight items dropped; pipeline shuts down; no leak.
3. Source error: pipeline drains gracefully.

---

## Summary

A pipeline stage is a function with the signature `func(ctx, in) out` that spawns goroutines, reads from `in`, writes to `out`, uses the two-select sandwich, and closes `out` on exit. Pipelines compose stages associatively. Closing cascades through the chain; ctx cancellation propagates similarly. Order is preserved in single-worker stages; lost in fan-out stages. The reference implementation is small; the compliance suite is the contract.
