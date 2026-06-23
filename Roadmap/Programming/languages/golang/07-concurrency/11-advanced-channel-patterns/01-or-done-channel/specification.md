# Or-Done-Channel — Specification

This document is the contract for any implementation of the `orDone` combinator in Go. It is precise enough to drive tests, lint rules, and code-review.

## 1. Signature

```go
func orDone[T any](done <-chan struct{}, c <-chan T) <-chan T
```

### 1.1 Parameter constraints

- `done` is a receive-only channel of `struct{}`.
- `c` is a receive-only channel of element type `T`.
- Neither `done` nor `c` is required to be non-nil. A `nil` channel is permitted but disables the corresponding case in the internal `select` (effectively, no cancellation if `done == nil`; no data if `c == nil`).

### 1.2 Return value

- A receive-only channel of element type `T`.
- Owned by `orDone`. Callers MUST NOT close it. Callers MAY read from it.
- Closed exactly once by the internal goroutine, via `defer close(out)`.

### 1.3 Type parameter

- `T any` — the element type. Implementations MAY include constraints (e.g., `comparable`) for derived combinators, but the canonical form has no constraint.

---

## 2. Behaviour

### 2.1 Forwarding

For every value `v` received from `c` while `done` has not been closed, `orDone` MUST forward `v` on the returned channel, in the order received.

### 2.2 Termination

The internal goroutine MUST exit in any of the following situations, and only these:

1. `done` is observed closed during the outer select.
2. `done` is observed closed during the inner select.
3. `c` is observed closed (`ok == false` from `v, ok := <-c`).

On exit, the goroutine MUST close the returned channel before returning. This MUST be implemented via `defer close(out)` to guarantee closure on every return path.

### 2.3 Ordering

The relative order of values forwarded MUST match the order received from `c`. `orDone` is a pass-through; it does not reorder.

### 2.4 In-flight values on cancellation

If `done` closes after `orDone` has received `v` from `c` but before `v` has been delivered on `out`, `v` MAY be discarded. The caller MUST NOT assume `v` was delivered. If "deliver-then-exit" semantics are required, use a different combinator.

### 2.5 Closure of input

`orDone` MUST NOT close `c`. `c` is owned by its producer.

### 2.6 Closure of done

`orDone` MUST NOT close `done`. `done` is owned by the cancelling caller.

---

## 3. Concurrency

### 3.1 Goroutine count

`orDone` MUST spawn exactly one goroutine on each call. The goroutine MUST exit under the termination conditions in §2.2.

### 3.2 Goroutine leak prevention

The implementation MUST NOT leak the spawned goroutine under any of the following conditions:

- `done` closes while the goroutine is blocked on the outer select.
- `done` closes while the goroutine is blocked on the inner select (sending `out <- v`).
- `c` closes while the goroutine is blocked on the outer select.
- The caller stops reading from the returned channel and then closes `done`.

### 3.3 Happens-before edges

A value `v` received from the returned channel by the caller establishes the standard channel happens-before edge from the corresponding `c`-receive inside `orDone`'s goroutine, which transitively establishes a happens-before edge from the producer's send on `c`.

A close of the returned channel observed by the caller (`v, ok := <-out` returning `ok == false`) establishes a happens-before edge from the close call inside `orDone`'s goroutine.

---

## 4. Performance Targets

These are guidelines, not requirements. Implementations should meet them on commodity x86_64 hardware running modern Go (1.21+):

- Goroutine startup overhead: < 5 µs.
- Per-value channel hop: < 200 ns when no contention.
- Memory: one goroutine stack (initial 2 KB) plus the output channel (small constant).

Implementations that miss these by more than 2x should be examined for accidental complexity (extra allocations, unnecessary heap escapes, etc.).

---

## 5. Required Test Coverage

A conforming implementation MUST pass at minimum the following tests.

### 5.1 Pass-through

Given `c` containing values `v1, v2, ..., vN` and then closed, with `done` never closed, the returned channel MUST yield `v1, v2, ..., vN` in order and then close.

### 5.2 Cancellation before any value

Given `done` closed before any value is sent on `c`, the returned channel MUST close without yielding any value.

### 5.3 Cancellation mid-stream

Given `c` continuously producing values and `done` closed after some have been forwarded, the returned channel MUST close in bounded time (< 1 second under no other load), with no goroutine leak.

### 5.4 Cancellation on blocked send

Given the caller stops reading from the returned channel and `done` is then closed, the internal goroutine MUST exit. This test is the canonical "inner-select" check.

### 5.5 Input closure

Given `c` is closed without `done` being closed, the returned channel MUST close after forwarding any remaining buffered values from `c`.

### 5.6 Concurrent done close

Given multiple consumers reading from the returned channel and `done` closed by an independent goroutine, all consumers' `range` loops MUST exit.

### 5.7 No leak

After every test, `go.uber.org/goleak` MUST report no goroutines leaked.

---

## 6. Required Documentation

Public implementations MUST document:

- The closure conditions for the returned channel.
- The behaviour for in-flight values on cancellation (Drop).
- The requirement that `done` be eventually closed for goroutine cleanup if `c` does not also close.
- The fact that `orDone` does not stop the producer of `c`.

A minimum acceptable docstring:

```go
// orDone forwards values from c on a new channel until either done is
// closed or c is closed, whichever happens first. The returned channel
// is closed exactly once by orDone. Values received from c after done
// closes may be discarded. orDone does not close c.
```

---

## 7. Non-Goals

The pattern explicitly does NOT provide:

- Deadlines or timeouts. (Use `context.WithTimeout` and pass `ctx.Done()` as `done`.)
- Drain semantics. (Build `drainOrDone` separately.)
- Error propagation. (Embed errors in `T` or use a sibling channel.)
- Reverse cancellation (consumer telling producer to stop). The producer must observe `done` independently.
- Reopening after close. Once the returned channel is closed, it stays closed; the operation is monotonic.

---

## 8. Variants

The following variants are sometimes used and have well-defined semantics, but are NOT the canonical `orDone`. They MUST be named differently.

### 8.1 `orDoneCtx`

```go
func orDoneCtx[T any](ctx context.Context, c <-chan T) <-chan T {
    return orDone(ctx.Done(), c)
}
```

Identical semantics to `orDone`, with `done` sourced from `ctx.Done()`.

### 8.2 `drainOrDone`

When `done` closes, the goroutine drains remaining values from `c` (without further cancellation observation) before exiting. Trade-off: cancellation latency is bounded by the time to drain `c`.

### 8.3 `bufferedOrDone`

The returned channel is buffered with capacity `n`. Otherwise identical. Buffer allows producer to race ahead by up to `n` values; on cancellation, buffered values may or may not be drained, depending on the consumer.

### 8.4 `eachOrDone`

```go
func eachOrDone[T any](done <-chan struct{}, c <-chan T, fn func(T))
```

A terminal form: no output channel, no extra goroutine. Calls `fn(v)` for each value until cancellation or input closure. Faster for terminal stages.

---

## 9. Reference Implementation

This is the canonical body. Any implementation matching it (up to renaming) is conforming.

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

Implementations that deviate from this structure (single-select, no defer, etc.) MUST justify the deviation in code review and prove via test that they meet §2, §3, and §5.

---

## 10. Versioning

The `orDone` signature should be considered stable once published. Backward-incompatible changes (changing parameter order, removing the type parameter, changing return type) MUST be versioned as a new symbol (`orDoneV2`) and the old form retained for at least one major release with a deprecation notice.

---

This specification, kept in sync with the implementation, makes `orDone` reviewable in a few minutes. It also makes regressions visible: any implementation drift away from §2 or §3 is a bug, not a stylistic choice.
