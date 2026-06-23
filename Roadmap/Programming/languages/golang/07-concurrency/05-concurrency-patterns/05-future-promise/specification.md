# Future / Promise Pattern — Specification

## Table of Contents
1. [Scope](#scope)
2. [Notation](#notation)
3. [Future Contract](#future-contract)
4. [State Transitions](#state-transitions)
5. [Memory Model Properties](#memory-model-properties)
6. [Cancellation Semantics](#cancellation-semantics)
7. [Combinator Contracts](#combinator-contracts)
8. [Memoized Future](#memoized-future)
9. [Single-Use Invariants](#single-use-invariants)
10. [Failure and Panic Modes](#failure-and-panic-modes)
11. [Conformance Tests](#conformance-tests)
12. [Non-Requirements](#non-requirements)

---

## Scope

This document specifies the contract a Go future must obey to be considered correct. It does not specify a particular implementation. Two futures with identical observable behaviour for all programs are equivalent.

A *future* in this document is an object of type `Future[T]` (or any equivalent shape returning `<-chan Result[T]`) representing a single asynchronous computation that produces exactly one of:

- a value of type `T` together with a nil error, or
- a non-nil error and a zero value of `T`.

---

## Notation

- `F` denotes a future.
- `F.start` is the wall-clock time at which the underlying goroutine was spawned.
- `F.fulfil` is the wall-clock time at which the result struct was written to the result channel (or, for memoized futures, the closing of the done channel).
- `F.await(ctx)` is an invocation of the await operation with a given context.
- "happens-before" (`hb`) is the partial order defined in the Go memory model.

---

## Future Contract

A future `F` shall satisfy:

**F1 (Single result).** Exactly one of the following events occurs after `F.start`:
- A `Result{Val, nil}` is delivered.
- A `Result{zero, err}` with `err != nil` is delivered.
- The hosting process terminates.

**F2 (No spurious wakeup).** A successful `F.await(ctx)` returns either the result delivered per F1 or a context error per C1 (below). It never returns a value that was not produced by the underlying computation.

**F3 (Goroutine termination).** The goroutine spawned by `F`'s constructor terminates after producing the result, unless the work itself is non-terminating. Implementations must not retain a goroutine "in reserve" between `F.fulfil` and process exit.

**F4 (Buffered delivery).** The result channel of a single-shot future shall have capacity at least 1. The producing goroutine must be able to send its result without a concurrent receive.

**F5 (Receive-only API).** Public APIs that return a future shall return a receive-only channel or a wrapper type that does not expose send semantics.

---

## State Transitions

A future has three observable states:

```
   PENDING ──[producer sends]──> FULFILLED ──[consumer reads]──> CONSUMED
```

- **PENDING:** the result channel is empty and not closed; the producer goroutine has not yet sent.
- **FULFILLED:** the result is buffered but has not been received by any consumer.
- **CONSUMED:** the result has been received by exactly one consumer.

For a memoized future, the states are:

```
   PENDING ──[work completes]──> RESOLVED (multi-readable, terminal)
```

State transitions are monotonic. A future shall not transition from any state back to PENDING.

---

## Memory Model Properties

**M1 (Send happens-before receive).** For a single-shot future implemented as a buffered channel, the send of the result happens-before the corresponding receive completes. All writes performed by the producing goroutine prior to the send are visible to the receiving goroutine after the receive.

**M2 (Close happens-before receive of closed).** For a memoized future implemented with a closed done-channel, the close happens-before any receive that returns because the channel is closed. All writes to memoized fields prior to the close are visible to subsequent readers.

**M3 (Once happens-before continuation).** When `sync.Once.Do(f)` returns, all writes within `f` are visible to any subsequent goroutine that observes `Do` having returned.

These properties allow returning arbitrary value types from a future without explicit synchronisation by the caller.

---

## Cancellation Semantics

**C1 (Await with cancelled context).** If `ctx` passed to `F.await(ctx)` becomes cancelled before the result is delivered, `F.await` shall return `(zero, ctx.Err())` and shall not block longer than the time required to detect cancellation.

**C2 (Work cancellation).** The work function may take a context. If it does, cancellation of that context shall propagate to `F.fulfil` returning an error whose chain contains `context.Canceled` or `context.DeadlineExceeded` (per `errors.Is`).

**C3 (Awaiter independence).** Cancellation of one awaiter's context shall not affect other awaiters of the same memoized future.

**C4 (No leak on abandonment).** If the future is abandoned (no awaiter ever observes the result), the producing goroutine shall still terminate. This is the *raison d'être* of F4.

---

## Combinator Contracts

### AwaitAll

```
AwaitAll(ctx, F1, ..., Fn) returns ([]T, error)
```

**A1.** If every `Fi.await(ctx)` returns `(vi, nil)`, then `AwaitAll` returns `([v1, ..., vn], nil)`.

**A2.** If any `Fi.await(ctx)` returns `(_, err)` with `err != nil`, `AwaitAll` returns `(zero, err')` where `err'` wraps `err`. Implementations may either short-circuit (return on first error) or wait for all (and return the first error encountered).

**A3.** If `ctx` is cancelled before all results are received, `AwaitAll` returns `(zero, ctx.Err())`. Outstanding futures continue independently.

### AwaitAny

```
AwaitAny(ctx, F1, ..., Fn) returns (T, error)
```

**Y1.** If any `Fi` returns `(vi, nil)`, `AwaitAny` returns `(vi, nil)` for some such `i`.

**Y2.** If every `Fi.await(ctx)` returns `(_, ei)` with `ei != nil`, `AwaitAny` returns `(zero, err')` where `err'` wraps at least one of the `ei` (typically the last).

**Y3.** If `ctx` is cancelled before any success, `AwaitAny` returns `(zero, ctx.Err())`.

**Y4.** `AwaitAny` does not by itself cancel the losing futures. A canceling variant shall derive a child context and cancel it on return.

### Map

```
Map(F, f) returns a future F'

  F resolves to (v, nil)   =>  F' resolves to (f(v), nil)
  F resolves to (_, err)   =>  F' resolves to (zero, err)
```

`Map` shall not invoke `f` unless `F` resolves successfully. `Map` shall preserve cancellation: cancelling `F'`'s await is independent of `F`'s underlying work.

### FlatMap

```
FlatMap(F, f) returns a future F''

  F resolves to (v, nil)
    => f(v) returns a future F'
    => F''.result = F'.result

  F resolves to (_, err)
    => F''.result = (zero, err) without invoking f
```

`f` shall be invoked at most once.

---

## Memoized Future

A memoized future shall satisfy F1–F3 and additionally:

**B1 (Multi-read).** Any number of awaiters may call `Await` on a memoized future. Each call shall return the same `(val, err)` pair.

**B2 (Single execution).** The work function shall be invoked at most once across all awaiters and the lifetime of the future.

**B3 (Broadcast completion).** When the work completes, all currently blocked awaiters shall unblock without waiting for one another.

**B4 (Late-arrival).** Any awaiter calling `Await` after resolution shall return immediately with the resolved value.

---

## Single-Use Invariants

For a single-shot future (the canonical channel-based shape), exactly one awaiter shall receive the result. A second receive from the result channel is undefined behaviour by this specification — implementations may block forever, panic, or return a zero value depending on whether the channel was closed.

Implementations should document the single-use property. Library callers should avoid second awaits and, if multi-read is needed, wrap with a memoized future or share via a `sync.Once`-backed cache.

---

## Failure and Panic Modes

**P1 (Panic in work).** A panic in the work function whose recovery is not arranged by the future shall terminate the hosting process per Go semantics.

**P2 (Recovered panic).** A future implementation may recover panics in the work function and convert them to errors. If it does, the documentation shall state the precise error type or message format used.

**P3 (Panic in combinator continuation).** A panic in a `Map`/`FlatMap` continuation function shall be handled per the future implementation's panic policy. The default (no recovery) is acceptable.

---

## Conformance Tests

An implementation may be tested for conformance by the following programs.

**T1 (Resolution).** Construct a future that returns 42. Await it. Expect 42, nil.

**T2 (Buffer-1).** Construct a future. Do not await. Sleep long enough for the work to complete. Verify the producing goroutine has exited (e.g. via `goleak`).

**T3 (Cancellation).** Construct a future whose work blocks on its context. Cancel the await context. Verify `Await` returns within bounded time with `context.Canceled`.

**T4 (AwaitAll success).** Construct three futures resolving to 1, 2, 3. Expect `[1,2,3]` from `AwaitAll`.

**T5 (AwaitAll failure).** Construct three futures, the middle one resolving to an error. Expect a non-nil error from `AwaitAll`.

**T6 (AwaitAny success).** Construct three futures resolving in 100ms, 50ms, 200ms. Expect the 50ms result.

**T7 (Memo single execution).** Construct a memoized future whose work increments a counter. Await it from 100 goroutines. Expect the counter to equal 1.

**T8 (Memo multi-read).** Construct a memoized future. Await from 10 goroutines. Each must receive the same value.

**T9 (Map happens-before).** Construct `F` returning a struct with field `x = 1`. `Map(F, fn)` where `fn` reads `x`. Expect `fn` to observe `x = 1` without explicit synchronisation.

**T10 (No leak).** Run T1–T9 under `go.uber.org/goleak`. Expect no leaked goroutines.

---

## Non-Requirements

The following are explicitly *not* required by this specification.

**N1.** A future is not required to support multiple awaiters in the single-shot form. Memoization is a separate type.

**N2.** A future is not required to expose progress signals (e.g. percent-complete).

**N3.** A future is not required to be cancellable from the consumer side via a method call. Cancellation is via the work function's context.

**N4.** A future is not required to be serialisable across process boundaries. Cross-process futures are a separate abstraction (e.g. promise pipelining in Cap'n Proto).

**N5.** A future is not required to compose with `context.Context` deadlines for timing out the *await* unless `ctx` is passed to `Await`. Constructors that take a ctx may use it for the work; the await is governed by the ctx passed to `Await`.

**N6.** A future implementation is not required to be allocation-free. Implementations may optimise via pools but are not obligated.
