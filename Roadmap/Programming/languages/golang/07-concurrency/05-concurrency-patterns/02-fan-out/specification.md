# Fan-Out — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Formal Definition](#formal-definition)
3. [Function Signature](#function-signature)
4. [Preconditions](#preconditions)
5. [Postconditions](#postconditions)
6. [Distribution Semantics](#distribution-semantics)
7. [Closing Protocol](#closing-protocol)
8. [Cancellation Semantics](#cancellation-semantics)
9. [Memory Model Edges](#memory-model-edges)
10. [Resource Bounds](#resource-bounds)
11. [Concurrency Invariants](#concurrency-invariants)
12. [Edge Cases](#edge-cases)
13. [Reference Implementation](#reference-implementation)
14. [Compliance Checks](#compliance-checks)
15. [Summary](#summary)

---

## Introduction

This file is the formal specification of fan-out. It states the contract a fan-out function must satisfy, distinct from a worker pool's broader contract. Implementations may differ in performance and structure but must respect this contract.

---

## Formal Definition

Let `T` be the input element type and `R` be the result type. Let `ctx` be a `context.Context`, `in` be a receive channel of `T`, `n` be a positive integer, and `work` be a function of signature `func(context.Context, T) R`.

**`Process(ctx, in, n, work)`** returns a receive channel `out` of `R` such that:

1. For every value `v` received from `in`, exactly one worker calls `work(ctx, v)` and the result is sent on `out`, *or* `ctx` is cancelled and the value is silently dropped.
2. After `in` is closed and drained (and not cancelled), `out` is closed.
3. After `ctx.Done()` becomes ready, `out` is closed in finite time.
4. No goroutine spawned by Process remains alive after `out` is closed.
5. Each value from `in` is processed by exactly one worker (no duplication).

---

## Function Signature

```go
func Process[T, R any](
    ctx context.Context,
    in <-chan T,
    n int,
    work func(context.Context, T) R,
) <-chan R
```

- `ctx`: cancellation control.
- `in`: receive-only input channel.
- `n`: positive integer; number of worker goroutines to spawn.
- `work`: per-item processing function. May block; should respect ctx.
- Return: receive-only output channel.

---

## Preconditions

- `n > 0`. Behaviour for `n ≤ 0` is undefined; implementations may panic.
- `in` must be a valid (non-nil) channel.
- The producer of `in` must close `in` exactly once when there are no more values, *or* `ctx` must be cancelled.
- The caller must drain `out` to completion *or* cancel `ctx`.
- `work` must not retain ownership of `T` beyond its return.

---

## Postconditions

- `out` is a fresh channel created by Process.
- `out` is closed exactly once.
- The number of values received from `out` is at most the number of values sent on `in` before any closure.
- If neither `ctx` cancels nor `work` panics, the number of values received from `out` equals the number of values sent on `in`.
- After `out` is closed, all internal goroutines have exited.

---

## Distribution Semantics

- Each value from `in` is delivered to exactly one worker. No value is delivered to two workers.
- The runtime selects which worker receives each value. The selection is "fair" in expectation but not in any particular pattern.
- The order of values received from `out` is generally NOT the order they were sent on `in`. A faster `work` invocation finishes earlier; a slower one finishes later.
- For order-preserving processing, attach a sequence number to each `T` and re-sort downstream.

---

## Closing Protocol

Define:
- `T_close(in)`: time `in` is closed.
- `T_drain(W_i)`: time worker `W_i` has consumed all values it will and exited.
- `T_cancel`: time `ctx.Done()` becomes ready (∞ if never).
- `T_close_out`: time `out` is closed.

Then:
- If `T_cancel = ∞`: `T_close_out = max(T_drain(W_1), ..., T_drain(W_n)) + ε`.
- If `T_cancel < ∞`: `T_close_out ≤ T_cancel + δ`, where `δ` includes worker reaction time and `work` termination time.

If `work` blocks ignoring ctx, `δ` may be unbounded. The spec requires `work` to terminate in bounded time after ctx cancel; pass ctx to `work` or use deadlines.

---

## Cancellation Semantics

When `ctx.Done()` becomes ready:

1. Each worker observes `<-ctx.Done()` at its next select (the two-select sandwich).
2. Workers in the middle of `work` complete that call (or terminate early if `work` respects ctx).
3. After all workers exit, the closer goroutine closes `out`.
4. Subsequent receives on `out` return the zero value with `ok=false`.

Values held by a worker but not yet processed (received from `in` but ctx fires before `work` runs) are dropped. Values received from `in` and processed but not yet sent to `out` are dropped.

---

## Memory Model Edges

For a value `v` sent on `in` at time `s_in`, processed by a worker into `r`, and received from `out` at time `r_out`:

- Send on `in` happens-before worker's receive of `v`.
- Worker's send `out <- r` happens-before consumer's `r_out`.
- Therefore, all writes preceding the producer's send are visible to the consumer after `r_out`.

Workers MUST NOT share mutable state without synchronisation; doing so is a race per the Go memory model.

---

## Resource Bounds

- Goroutines spawned: exactly `n + 1` (n workers + 1 closer).
- Channels created by Process: exactly 1 (`out`).
- Memory: O(1) constant overhead plus output channel buffer (caller's choice; default 0).
- Lifetime of internal goroutines: from invocation until `out` is closed.

---

## Concurrency Invariants

1. **Worker count is exactly n**: spawned at start, no dynamic adjustment within Process.
2. **No value duplication**: every input value processed at most once.
3. **No value loss in absence of cancel**: if ctx never fires and `work` never panics, every input value produces exactly one output value.
4. **Single closer**: only the closer goroutine calls `close(out)`.
5. **WaitGroup matched**: each worker's `wg.Done` matches its `wg.Add`.

---

## Edge Cases

- **n = 0**: undefined; implementations may panic, return a closed channel, or block.
- **n > number of input values**: some workers idle. They consume the close signal and exit. No issue.
- **`in` already closed**: workers' selects observe close immediately and exit.
- **`work` panics**: behaviour is implementation-defined. The spec allows the panic to propagate (terminating the worker; reducing pool capacity by 1) or to be recovered. For production code, recovery is recommended.
- **Result channel buffer**: caller may receive a buffered output if Process variant supports it. Default unbuffered.
- **`ctx` already cancelled at call**: every worker exits at first select; closer closes `out` immediately.

---

## Reference Implementation

```go
func Process[T, R any](
    ctx context.Context,
    in <-chan T,
    n int,
    work func(context.Context, T) R,
) <-chan R {
    out := make(chan R)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case v, ok := <-in:
                    if !ok {
                        return
                    }
                    r := work(ctx, v)
                    select {
                    case <-ctx.Done():
                        return
                    case out <- r:
                    }
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

This satisfies every clause above. Variants may add panic recovery, batched dispatch, or worker identifiers.

---

## Compliance Checks

A compliance test suite must verify:

1. With `n=1, in=closed-channel`: `out` is closed; no values emitted.
2. With `n=4`, 100 distinct values on `in`: exactly 100 values emitted on `out`; the multiset matches.
3. Cancel `ctx` after 5 values: `out` closes; ≤ 5+n+1 values emitted (small slop for in-flight); no goroutine leak.
4. `work` always returns a constant: `out` carries that constant for every input.
5. Concurrent `work` invocations under `-race`: no race report.
6. `goleak.VerifyNone` after every test.

---

## Summary

Fan-out's contract: distribute every input value to exactly one of n workers, transform it, emit on a single output channel. Closing follows the same two-select-sandwich pattern as fan-in. Cancellation cascades through workers; bounded internal resources; deterministic compliance against the listed invariants. Implementations may add features but must satisfy the spec.
