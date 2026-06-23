# Tee-Channel — Specification

## Table of Contents
1. [Scope and Intent](#scope-and-intent)
2. [Signature](#signature)
3. [Inputs](#inputs)
4. [Outputs](#outputs)
5. [Functional Requirements](#functional-requirements)
6. [Non-Functional Requirements](#non-functional-requirements)
7. [Semantic Rules](#semantic-rules)
8. [Failure Modes and Their Contract](#failure-modes-and-their-contract)
9. [Variants and Their Specifications](#variants-and-their-specifications)
10. [Reference Implementation](#reference-implementation)
11. [Compliance Tests](#compliance-tests)

---

## Scope and Intent

This specification defines the behaviour of the `Tee` channel combinator in Go. The combinator takes a single input channel and produces two output channels such that every value sent on the input is delivered, in order, to both outputs.

The specification covers the symmetric unbuffered form (the canonical tee) and references the buffered, asymmetric, and lossy variants in [section 9](#variants-and-their-specifications).

The intent is to provide enough contract that:

- Implementations can claim conformance.
- Callers can rely on documented invariants.
- Tests can verify conformance.

---

## Signature

```go
func Tee[T any](done <-chan struct{}, in <-chan T) (<-chan T, <-chan T)
```

A `context.Context`-aware variant is permitted:

```go
func Tee[T any](ctx context.Context, in <-chan T) (<-chan T, <-chan T)
```

Both signatures must satisfy the same semantic rules. Internally, the context-aware form converts `ctx.Done()` to the `done` channel.

---

## Inputs

| Parameter | Type | Constraints |
|-----------|------|-------------|
| `done` | `<-chan struct{}` | May be `nil` only if the caller guarantees `in` will be closed. Implementations may panic if `done == nil`. |
| `in` | `<-chan T` | Must not be `nil`. Implementations should panic with a clear message if `in == nil`. |

`done` is *signal-only*: closing it requests termination. Sending values on it is not part of the contract.

`in` is the value stream. The caller is responsible for closing `in` when the stream ends.

---

## Outputs

| Channel | Type | Direction |
|---------|------|-----------|
| `out1` | `<-chan T` | Read-only to caller |
| `out2` | `<-chan T` | Read-only to caller |

Both outputs are unbuffered in the canonical form. Both are closed by the tee goroutine when it terminates.

The caller must not close either output. The type system enforces this; do not subvert it.

---

## Functional Requirements

**FR1 — Order preservation.** If the input emits values `v1, v2, ..., vN` in that order, each output emits the same values in the same order. No reordering. No skipping. No duplication.

**FR2 — Duplication.** Every value successfully consumed from the input is delivered to *both* outputs, subject to FR3.

**FR3 — Cancellation drop.** When `done` is closed, the tee terminates at the next decision point. A value that was received from `in` but not yet sent to both outputs is delivered to *at most one* output. Both outputs are closed immediately thereafter.

**FR4 — Output closure on clean shutdown.** When `in` is closed and drained, both outputs are closed.

**FR5 — Output closure on cancellation.** When `done` is closed, both outputs are closed, whether or not all values were delivered.

**FR6 — Goroutine termination.** The internal goroutine exits within finite time of either `in` closing or `done` closing.

**FR7 — Backpressure preservation.** The combinator does not buffer values internally beyond what the output channel buffer (if any) permits. The producer's pace is bounded by the slower consumer's pace.

**FR8 — No silent drops in the canonical form.** Symmetric unbuffered tee never drops a value except via FR3 cancellation. Lossy variants must be explicitly named and documented.

---

## Non-Functional Requirements

**NFR1 — Concurrency safety.** The combinator is safe to call from any goroutine. The returned channels are safe to read from concurrently with other operations on the same channel (Go channel semantics).

**NFR2 — Allocation profile.** The combinator allocates exactly: two output channels, one goroutine stack, and any closure captures introduced by the implementation. No per-value allocation in the canonical form.

**NFR3 — Latency.** Per-value overhead is bounded by `O(channel_send) * 2 + O(selectgo)`. On commodity x86_64 hardware, ~150-250 ns per value when both consumers are ready.

**NFR4 — Throughput.** The canonical tee achieves at minimum 1 M values/second on commodity hardware when consumers are CPU-bound and immediate.

**NFR5 — Memory footprint.** Constant in time. The combinator does not accumulate state beyond a single in-flight value during the send loop.

---

## Semantic Rules

**SR1 — Selection fairness.** When both outputs are ready to receive, the choice of which receives the value first is governed by Go's `select` fairness: uniform-random among ready cases.

**SR2 — Nil-channel disabling.** Implementations *may* use the technique of setting an output channel variable to `nil` after sending, to disable that case in subsequent `select` iterations within the same input value's delivery loop. This is the canonical and recommended implementation.

**SR3 — Reentrancy.** The combinator's outputs may themselves be inputs to other combinators (including other tees). No restriction on nesting depth.

**SR4 — Generic type constraint.** `T` must satisfy `any`. There is no constraint on `T` being comparable, hashable, or copyable beyond Go's standard requirements.

**SR5 — Done channel polymorphism.** A `done <-chan struct{}` parameter may be substituted by `ctx.Done()` from a `context.Context` in implementations that adopt the context-aware variant.

---

## Failure Modes and Their Contract

| Mode | Cause | Specified Behaviour |
|------|-------|---------------------|
| `in` is nil | Caller bug | Implementation may panic. |
| `done` is nil | Caller bug or intentional "no cancel" | Implementation should support; tee runs until `in` closes. |
| `in` closes before any value sent | Empty stream | Both outputs close immediately; goroutine exits. |
| `done` closes before any value sent | Pre-cancelled | Both outputs close immediately; goroutine exits. |
| Output read by no consumer | Caller bug | Goroutine blocks on first send to that output forever, unless `done` fires. |
| External close of an output | Caller bug, requires type-system subversion | `panic("send on closed channel")` from the goroutine. |
| Producer panic before close | Producer bug | `for v := range in` exits when the producer's deferred close fires; if the producer fails to close, tee leaks. |
| Consumer panic before drain | Consumer bug | If consumer was reading from one output, that output's sends now block; tee stalls. |
| `done` and `in` close simultaneously | Race | Implementation may take either path. Outputs close; goroutine exits. |

---

## Variants and Their Specifications

### Symmetric Buffered Tee

```go
func TeeBuf[T any](done <-chan struct{}, in <-chan T, buf int) (<-chan T, <-chan T)
```

Both outputs are buffered with capacity `buf`. All functional requirements unchanged except FR7 (backpressure): the buffer absorbs up to `buf` items per output before the producer is paced.

### Asymmetric Buffered Tee

```go
func TeeAsym[T any](done <-chan struct{}, in <-chan T, bufA, bufB int) (<-chan T, <-chan T)
```

Each output has its own buffer. `bufA = 0` keeps that side strict. FR7 modified per-output.

### Lossy Asymmetric Tee

```go
func TeeLossy[T any](
    done <-chan struct{}, in <-chan T, bufLossy int,
) (out, lossy <-chan T, droppedCounter func() uint64)
```

The `lossy` output uses non-blocking send (`select` with `default`). FR8 relaxed for `lossy` only: values may be dropped when the buffer is full. The `droppedCounter` returns a monotonic count of dropped values, suitable for monitoring.

The `out` channel retains all FR1-FR8 guarantees of the canonical form.

### N-way Tee (chained)

Implementation is composition, not a new combinator. For N outputs, build a balanced binary tree of `N-1` tees. Behavioural specification matches the symmetric tee at each node.

---

## Reference Implementation

```go
// Package channels provides composable channel combinators.
package channels

// Tee duplicates each value from in onto two output channels.
//
// Specification: see specification.md in this directory.
//
// Both outputs receive every value from in, in order. The internal goroutine
// terminates when in is closed and drained, or when done is closed, whichever
// occurs first. Both outputs are closed on termination.
//
// Backpressure: the slower consumer paces the producer. Tee never silently
// drops values; cancellation may leave one value undelivered to at most one
// output.
//
// Panics if in is nil.
func Tee[T any](done <-chan struct{}, in <-chan T) (<-chan T, <-chan T) {
    if in == nil {
        panic("channels: Tee called with nil input")
    }
    out1, out2 := make(chan T), make(chan T)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            a, b := out1, out2
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
    return out1, out2
}
```

This implementation satisfies FR1-FR8 and NFR1-NFR5. Conformance can be verified with the test suite below.

---

## Compliance Tests

A conformant implementation must pass each of these tests (sketched):

1. `TestTeeDuplicatesAllValues` — feed 1000 values; both outputs collect exactly 1000, in order, identical.
2. `TestTeeOnEmptyInput` — close `in` immediately; both outputs close without yielding values; no goroutine leak.
3. `TestTeeOnPreClosedDone` — close `done` before sending; both outputs close; no values delivered.
4. `TestTeeCancellationMidStream` — send 100 values; close `done` at value 50; both outputs close; counts differ by at most 1.
5. `TestTeeBackpressure` — fast consumer + slow consumer with 100ms per receive. Total wall time >= 100 * 100ms (within scheduler tolerance).
6. `TestTeeNoLeak` — `runtime.NumGoroutine` before and after a full run. After must equal before.
7. `TestTeeOrderPreservation` — values are integers `1..N`; assert strictly increasing on each output.
8. `TestTeeFairness` — over 10000 iterations, count which output receives the value "first" (via timestamps). Distribution should be within 5% of 50/50.

Lossy variants additionally require:

9. `TestLossyDropsUnderPressure` — block the lossy consumer; verify `droppedCounter` increases.
10. `TestLossyCriticalNeverDrops` — block the lossy consumer; verify the critical output still delivers every value.

This specification, together with the reference implementation and the compliance test suite, defines what "tee" means in this codebase.
