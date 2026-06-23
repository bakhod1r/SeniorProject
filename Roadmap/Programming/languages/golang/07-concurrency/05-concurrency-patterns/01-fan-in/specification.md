# Fan-In — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Formal Definition](#formal-definition)
3. [Function Signature](#function-signature)
4. [Preconditions](#preconditions)
5. [Postconditions](#postconditions)
6. [Closing Protocol](#closing-protocol)
7. [Cancellation Semantics](#cancellation-semantics)
8. [Memory Model Edges](#memory-model-edges)
9. [Ordering Semantics](#ordering-semantics)
10. [Resource Bounds](#resource-bounds)
11. [Concurrency Invariants](#concurrency-invariants)
12. [Edge Cases](#edge-cases)
13. [Reference Implementation](#reference-implementation)
14. [Compliance Checks](#compliance-checks)
15. [Summary](#summary)

---

## Introduction

This file is the formal specification of fan-in. It states the contract a `Merge` function must satisfy. Implementations may differ in performance and structure but must respect this contract.

---

## Formal Definition

Let `T` be an arbitrary Go type. Let `c_1, c_2, ..., c_N` be receive channels of element type `T`. Let `ctx` be a `context.Context`.

**`Merge(ctx, c_1, ..., c_N)`** returns a receive channel `out` of element type `T` such that:

1. Every value `v` ever sent on any `c_i` and received by Merge before cancellation is eventually sent on `out` exactly once, *or* `ctx` is cancelled and the value is silently dropped.
2. After all `c_i` are closed (and all values drained, if not cancelled), `out` is closed.
3. After `ctx.Done()` becomes ready, `out` is closed in finite time regardless of the state of the `c_i`.
4. No goroutine spawned by Merge remains alive after `out` is closed.

---

## Function Signature

```go
func Merge[T any](ctx context.Context, cs ...<-chan T) <-chan T
```

- `ctx`: cancellation control. May be `context.Background()` for unconditional merging.
- `cs`: zero or more receive-only channels of type `T`. May be `nil` slice; behaviour is `out` closed immediately after the call returns.
- Return: a receive-only channel of type `T`.

---

## Preconditions

- Each `c_i` must be a valid channel (initialised). Passing a `nil` channel is undefined behaviour: forwarders block forever on receive.
- Each producer of `c_i` must close `c_i` exactly once when it has no more values to send.
- The caller must drain `out` until it is closed, *or* cancel `ctx` to release the merge.
- The caller must not close `out`. Doing so panics on the next forwarder send.

---

## Postconditions

- `out` is a fresh channel created by Merge.
- `out` is closed by Merge exactly once.
- The number of values received from `out` is at most the sum of values sent on all `c_i` before any closure.
- If `ctx` is never cancelled and every producer eventually closes its channel after sending all values, the number of values received from `out` is exactly that sum (no loss).
- After `out` is closed, all internal goroutines have exited.

---

## Closing Protocol

The closing protocol is the critical correctness property. Stated precisely:

- Let `T_close(c_i)` be the time when `c_i` is closed.
- Let `T_drain(c_i)` be the time when Merge's forwarder for `c_i` has received all values and exited.
- Let `T_cancel` be the time `ctx.Done()` becomes ready (∞ if never).
- Let `T_close_out` be the time `out` is closed.

Then:
- If `T_cancel = ∞`: `T_close_out = max(T_drain(c_1), ..., T_drain(c_N)) + ε`.
- If `T_cancel < ∞`: `T_close_out ≤ T_cancel + δ`, where `δ` is bounded by the time for all forwarders to observe the cancel and the closer goroutine to schedule.

The bound `δ` is in practice a few milliseconds on a healthy system, but is not formally bounded by the spec.

---

## Cancellation Semantics

When `ctx.Done()` becomes ready:

1. Each forwarder, on its next iteration of the two-select sandwich, observes `<-ctx.Done()` and returns.
2. The closer goroutine, after every forwarder has called `wg.Done`, closes `out`.
3. Any value in flight (received from `c_i` but not yet sent on `out`) is silently dropped.
4. Subsequent receives on `out` return the zero value with `ok=false`.

---

## Memory Model Edges

Let `s` be a send `c_i <- v` in producer P, and `r` be a receive `v' = <-out` in consumer C. Then:

- The send `s` happens-before its matching receive in the forwarder F.
- The send `out <- v` in F happens-before `r`.
- By transitivity, `s` happens-before `r`.

Therefore: any memory writes P performs before the send `s` are visible to C after the receive `r`. Producers may safely "transfer ownership" of memory through fan-in.

Producers must NOT mutate the value they sent; the consumer may read it concurrently.

---

## Ordering Semantics

- Within a single input channel `c_i`, the order of values received from `out` matches the order they were sent on `c_i`.
- Across inputs (`c_i` and `c_j`, i ≠ j), no order is guaranteed. The runtime scheduler is the sole arbiter.
- Two values sent at "the same time" (no happens-before between them) may appear on `out` in either order on different runs.

For stable cross-input ordering, use a k-way merge based on a comparison function, not Merge.

---

## Resource Bounds

- Goroutines spawned by Merge: exactly `N + 1` (one forwarder per input plus one closer).
- Channels created by Merge: exactly 1 (`out`).
- Memory: bounded by the closure environment (small constant) plus the WaitGroup (small constant) plus the buffer of `out` (caller's choice; default 0).
- Lifetime of internal goroutines: from Merge's invocation until either (a) all inputs are closed and drained, or (b) `ctx` is cancelled.

---

## Concurrency Invariants

1. **Single closer**: only the closer goroutine calls `close(out)`. Forwarders never close `out`.
2. **WaitGroup matched**: every `wg.Add` matches exactly one `wg.Done`.
3. **No double-Done**: each forwarder calls `wg.Done` exactly once via defer.
4. **No double-close**: `close(out)` is invoked exactly once.
5. **No leaked goroutine**: after `out` is closed, every internal goroutine has exited.

A correctness proof for any implementation must establish all five.

---

## Edge Cases

- **N = 0**: WaitGroup counter is 0, closer fires immediately, `out` is closed in finite time after Merge returns. The caller's `range out` exits at once.
- **N = 1**: equivalent to forwarding `c_1`. Allowed but wasteful (one extra forwarder, one closer).
- **All `c_i` already closed**: forwarders' range loops exit at once; closer fires; `out` closed.
- **Mix of closed and open `c_i`**: closed inputs drop out silently; open inputs continue feeding `out`.
- **Same channel passed twice**: two forwarders compete for receive; behaviour is well-defined but rarely intended.
- **`nil` channel**: the forwarder's `range` over a `nil` channel blocks forever. WaitGroup never reaches zero. `out` never closes (unless `ctx` cancels). Implementations may panic, skip, or accept; the spec allows any of these.

---

## Reference Implementation

```go
func Merge[T any](ctx context.Context, cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case v, ok := <-c:
                    if !ok {
                        return
                    }
                    select {
                    case <-ctx.Done():
                        return
                    case out <- v:
                    }
                }
            }
        }(c)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

This implementation satisfies every clause above. It is the canonical form.

---

## Compliance Checks

A test suite for any Merge implementation should verify:

1. `Merge(ctx)` (no inputs) returns a channel that is closed.
2. `Merge(ctx, c)` (one input) yields exactly the values sent on `c`, in order, and closes when `c` does.
3. `Merge(ctx, c1, c2)` yields the union of values sent (multiset), closes after both inputs close.
4. Cancelling `ctx` mid-stream causes `out` to close in finite time.
5. After `out` is closed, `goleak.VerifyNone(t)` passes.
6. Race detector reports no races under stress (`-race -count=100`).

---

## Summary

Fan-in's contract is precise: every value flows once, the output closes when inputs close or ctx cancels, no goroutines leak, and only the closer closes the output. Cross-input order is not preserved. The reference implementation is small and idiomatic; alternative implementations must satisfy the same five concurrency invariants and the closing protocol's timing bounds.
