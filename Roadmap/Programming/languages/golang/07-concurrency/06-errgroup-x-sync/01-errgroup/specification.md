---
layout: default
title: errgroup — Specification
parent: errgroup
grand_parent: errgroup and x/sync
ancestor: Concurrency
nav_order: 5
permalink: /roadmap/programming-languages/golang/07-concurrency/06-errgroup-x-sync/01-errgroup/specification/
---

# errgroup — Specification

← Back to errgroup index

The authoritative method-by-method contract for `golang.org/x/sync/errgroup`. This page is intended as a reference: signatures, preconditions, postconditions, and observable behaviour. Examples are minimal; deeper discussion lives in the level-tiered files.

---

## Package

```go
package errgroup

import "golang.org/x/sync/errgroup"
```

Import path: `golang.org/x/sync/errgroup`. Not in the standard library. Maintained by the Go team in the `golang.org/x/sync` repository.

Minimum Go version: 1.20 (for `context.WithCancelCause`). The package itself has no `go.mod` constraint, but pre-1.20 Go cannot compile the current version.

To add to a project:

```bash
go get golang.org/x/sync@latest
```

---

## Types

### `type Group`

```go
type Group struct {
    // unexported fields
}
```

A `Group` collects goroutines working on subtasks of a common task. It is safe to use the zero value. A `Group` must not be copied after first use.

The zero-value behaviour:

- `Go` and `TryGo` work but cancellation on error is unavailable.
- `Wait` returns the first non-nil error from spawned goroutines, or `nil`.
- `SetLimit(n)` and `SetLimit(-1)` may be called before any `Go`/`TryGo`.

### `type token`

Internal. Not exported. Used as the message type for the concurrency-limit channel. Zero size.

---

## Functions

### `func WithContext(ctx context.Context) (*Group, context.Context)`

Returns a new `Group` and a derived `context.Context`.

**Preconditions:**
- `ctx` must not be `nil`.

**Postconditions:**
- The returned `*Group` is fresh and ready to use.
- The returned `context.Context` is a child of `ctx`. It is cancelled when:
  1. Any function passed to `Go` or `TryGo` returns a non-nil error, **or**
  2. `Wait` returns (whichever comes first).
- The cancellation cause (`context.Cause`) is the first non-nil error returned by any worker, if any; otherwise `context.Canceled`.

**Notes:**
- Cancellation is fired exactly once via `sync.Once` internally.
- The derived context is invalid for use after `Wait` returns.

---

## Methods

### `func (g *Group) Go(f func() error)`

Calls the given function in a new goroutine.

**Preconditions:**
- `f` must not be `nil`. The library does not nil-check; a nil `f` would crash the spawned goroutine.
- If `SetLimit(n)` was called with `n >= 0`, then at most `n` calls to `Go`/`TryGo` may be active at the call site simultaneously. Excess calls **block** until a slot is free.

**Postconditions:**
- The goroutine runs `f`.
- If `f` returns a non-nil error, the *first* such error across all goroutines in the group is recorded as the group error, and the derived context (if any) is cancelled.

**Behavioural notes:**
- Returns immediately if no limit is set or a slot is free.
- Returns after blocking on the limit channel if a limit is set and full.
- The closure receives no arguments; pass values via closure capture or named function args.
- Panics in `f` are **not** caught. They propagate as in any goroutine.

---

### `func (g *Group) TryGo(f func() error) bool`

Like `Go` but non-blocking with respect to the concurrency limit.

**Preconditions:**
- `f` must not be `nil`.

**Postconditions:**
- Returns `true` if a goroutine was successfully spawned.
- Returns `false` if a limit is set and currently full; no goroutine is spawned in this case.
- If no limit is set, always returns `true`.

**Behavioural notes:**
- The semaphore check uses `select { case sem <- token: ; default: return false }`. This is non-blocking.
- A `false` return does not retry; you must call `TryGo` again later if you want to retry.
- Available in `golang.org/x/sync` versions from May 2023 onward.

---

### `func (g *Group) Wait() error`

Blocks until all function calls from `Go` and `TryGo` have returned, then returns the first non-nil error (if any) from them.

**Preconditions:**
- May be called at most once per `Group`. Subsequent calls have undefined behaviour.
- Should not be called concurrently with `Go` or `TryGo` on the same group from a different goroutine, unless you can guarantee all spawns happen-before `Wait` is called.

**Postconditions:**
- Returns `nil` if every `Go`/`TryGo` callback returned `nil`.
- Returns the first non-nil error otherwise. "First" is the first to win the `sync.Once` race; this is non-deterministic when multiple errors occur near-simultaneously.
- After `Wait` returns, the derived context (if any) is cancelled with cause = returned error.

**Behavioural notes:**
- If zero goroutines were spawned, returns `nil` immediately.
- `Wait` calls the cancel function on return regardless of error. The derived context becomes invalid after `Wait` returns.

---

### `func (g *Group) SetLimit(n int)`

Limits the number of active goroutines in this group to at most `n`.

**Preconditions:**
- `n` may be any int.
- Must not be called while there are goroutines running in the group. If `len(internal_sem_channel) != 0` (i.e. some goroutine is between its semaphore send and its semaphore receive), `SetLimit` panics.

**Postconditions:**
- If `n < 0`: removes the limit. The internal semaphore channel is set to `nil`.
- If `n == 0`: sets an unbuffered channel. Any subsequent `Go` will block forever; any subsequent `TryGo` will return `false`. **Avoid `n == 0`.**
- If `n > 0`: allocates a new buffered channel of capacity `n`. Subsequent `Go`/`TryGo` use it as a semaphore.

**Behavioural notes:**
- Calling `SetLimit` more than once before any `Go` is allowed. The most recent call wins.
- Calling `SetLimit` after `Wait` returns is allowed (the channel is empty) but pointless — the group should not be reused.
- The panic message includes the number of active goroutines: `"errgroup: modify limit while N goroutines in the group are still active"`.
- Available in `golang.org/x/sync` versions from August 2022 onward.

---

## Concurrency-safety summary

| Method | Safe to call concurrently? |
|--------|---------------------------|
| `Go` | Yes, with itself and `TryGo`. Not safe with `SetLimit`. |
| `TryGo` | Yes, with itself and `Go`. Not safe with `SetLimit`. |
| `Wait` | Once per group. Concurrent `Wait` is undefined. |
| `SetLimit` | No — must run alone, before any `Go`/`TryGo`. |
| `WithContext` | The returned `*Group` is fresh; concurrent use of the *constructor* is meaningless. |

---

## Memory model guarantees

The following happens-before relationships are provided by errgroup:

- A `Go(f)` happens-before the start of the goroutine that runs `f`.
- The completion of `f` happens-before `Wait` returns (in the goroutine that called `Wait`).
- A `cancel` triggered by an erroring goroutine happens-before the `ctx.Done()` channel becomes ready for any goroutine selecting on it.
- The write to `g.err` inside `errOnce.Do` happens-before `Wait` returns and reads `g.err`.

In plain English: once `Wait` returns, every read of the work's output and the work's error is safe in the caller's goroutine.

---

## Error semantics

- The error returned by `Wait` is exactly the first non-nil error returned by any worker. It is *not* wrapped, *not* aggregated, *not* augmented.
- "First" is determined by the runtime's scheduling of `errOnce.Do`. It is not predictable.
- Subsequent errors are silently discarded.
- A nil error from every worker results in `Wait` returning `nil`.

---

## Cancellation cause

When the derived context (from `WithContext`) is cancelled by errgroup, the cause is the first non-nil error from a worker. Retrieve it via `context.Cause(ctx)`. If no error occurred and `Wait` cancelled on the way out, the cause is `context.Canceled`.

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return io.ErrUnexpectedEOF })
_ = g.Wait()
// context.Cause(ctx) == io.ErrUnexpectedEOF
```

---

## Limit semantics

- `Go` blocks on a buffered-channel send when the limit is full.
- `TryGo` uses a non-blocking send and returns `false` on a full buffer.
- A worker releases its slot in a `defer` *before* decrementing the WaitGroup, ensuring `Wait` does not unblock until every slot has been released.
- `SetLimit(-1)` removes the limit; subsequent `Go` calls never block on the limiter.

---

## Interaction with the standard library

| Standard library type | Interaction |
|---|---|
| `context.Context` | `WithContext` accepts and returns; cancellation propagates. |
| `sync.WaitGroup` | Internal field. Drives `Wait`. |
| `sync.Once` | Internal field. Guards first-error recording. |
| `context.CancelCauseFunc` | Internal field (since Aug 2023). Used by `cancel`. |
| Channels | Internal field (`chan token`). Used for limit. |

---

## Compatibility

- The exported API is considered stable. No method has been removed or changed signature since the original 2016 release.
- New methods (`SetLimit`, `TryGo`) are additive.
- The `WithContext` signature has not changed.
- The cancel-cause switch in 2023 is not API-breaking; old code that did not use `context.Cause` still works the same.

---

## Not provided

`errgroup` does **not** provide:

| Feature | Workaround |
|---|---|
| Panic recovery | Use `defer recover()` inside the closure, or switch to `sourcegraph/conc`. |
| Collect all errors | Collect in `[]error` under a `Mutex`; use `errors.Join`. |
| Reset / reuse a `Group` | Allocate a new `Group`. |
| Inspect active count | Track with `atomic.Int64` in your code, or use `semaphore.Weighted`. |
| Weighted concurrency | Use `semaphore.Weighted` directly. |
| Dynamic limit changes | Use `semaphore.Weighted` and manual coordination. |
| Cancel from outside | Cancel the parent context passed to `WithContext`. |
| Wait with timeout | Wrap `Wait` in a goroutine and select on a timer; or use `context.WithTimeout` on the parent. |

---

## Version-by-version capability table

| `x/sync` version | `Go` | `Wait` | `WithContext` | `SetLimit` | `TryGo` | Cancel-cause |
|---|---|---|---|---|---|---|
| Pre-Aug-2022 | yes | yes | yes | no | no | no |
| Aug 2022 – May 2023 | yes | yes | yes | yes | no | no |
| May 2023 – Aug 2023 | yes | yes | yes | yes | yes | no |
| Aug 2023+ | yes | yes | yes | yes | yes | yes |

To get all features: `go get golang.org/x/sync@latest` and use Go 1.20+.

---

## See also

- `pkg.go.dev` reference: <https://pkg.go.dev/golang.org/x/sync/errgroup>
- Source: <https://cs.opensource.google/go/x/sync/+/master:errgroup/errgroup.go>
- Tests: <https://cs.opensource.google/go/x/sync/+/master:errgroup/errgroup_test.go>
- Related: `golang.org/x/sync/semaphore`, `golang.org/x/sync/singleflight`
