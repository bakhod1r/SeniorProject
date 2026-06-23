---
layout: default
title: Partial Cancellation — Specification
parent: Partial Cancellation
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/02-partial-cancellation/specification/
---

# Partial Cancellation — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Normative Sources](#normative-sources)
3. [`context.WithoutCancel`](#contextwithoutcancel)
4. [`context.AfterFunc`](#contextafterfunc)
5. [`context.Cause`](#contextcause)
6. [`context.WithCancelCause`](#contextwithcancelcause)
7. [`context.WithDeadlineCause` and `context.WithTimeoutCause`](#contextwithdeadlinecause-and-contextwithtimeoutcause)
8. [Interaction Matrix](#interaction-matrix)
9. [Version History](#version-history)
10. [Non-Guarantees](#non-guarantees)
11. [References](#references)

---

## Introduction

The behaviour of partial cancellation in Go is documented in the standard library's `context` package. This file collects the normative statements that govern its semantics.

The relevant APIs are:

- `context.WithoutCancel` (Go 1.21).
- `context.AfterFunc` (Go 1.21).
- `context.Cause` (Go 1.20).
- `context.WithCancelCause` (Go 1.20).
- `context.WithDeadlineCause` (Go 1.21).
- `context.WithTimeoutCause` (Go 1.21).

Each is documented with a precise contract. This file quotes the contracts and highlights subtle clauses.

---

## Normative Sources

The authoritative documentation lives at:

- `https://pkg.go.dev/context` — the public package documentation.
- `src/context/context.go` — the implementation.
- The Go release notes for versions that added the relevant APIs.

When the documentation and implementation disagree, the implementation wins (and a bug is filed). In practice, the standard library is well-maintained and disagreements are rare.

---

## `context.WithoutCancel`

### Signature

```go
func WithoutCancel(parent Context) Context
```

### Behavior (from official documentation)

> WithoutCancel returns a copy of parent that is not canceled when parent is canceled. The returned context returns no Deadline or Err, and its Done channel is nil. Calling Cause on the returned context returns nil.

### Key normative points

1. **"copy of parent"** — values are preserved. Lookups via `Value(key)` walk to the parent.
2. **"not canceled when parent is canceled"** — cancellation does not propagate from parent to the returned context.
3. **"no Deadline"** — `Deadline()` returns `(time.Time{}, false)`.
4. **"no Err"** — `Err()` returns `nil` always.
5. **"Done channel is nil"** — `Done()` returns `nil`. A receive on a nil channel blocks forever.
6. **"Calling Cause on the returned context returns nil"** — `Cause(detached) == nil` regardless of whether the parent had a cause.

### Edge case: nil parent

`WithoutCancel(nil)` panics with the message "cannot create context from nil parent".

### Edge case: already-cancelled parent

`WithoutCancel(cancelled)` returns a working detached context. The parent's cancellation state is irrelevant — only its value chain matters to the detached context.

### Composition

The returned context may be wrapped further:

- `WithCancel(detached)` creates a cancellable context whose lifetime is independent of the parent.
- `WithTimeout(detached, d)` adds a deadline.
- `WithValue(detached, k, v)` adds a value.

These compositions behave the same as wrapping any other context.

---

## `context.AfterFunc`

### Signature

```go
func AfterFunc(ctx Context, f func()) (stop func() bool)
```

### Behavior (from official documentation)

> AfterFunc arranges to call f in its own goroutine after ctx is done (canceled or timed out). If ctx is already done, AfterFunc calls f immediately in its own goroutine.
>
> Multiple calls to AfterFunc on a context operate independently; one does not replace another.
>
> Calling the returned stop function stops the association of ctx with f. It returns true if the call stopped f from being run. If stop returns false, either the context is done and f has been started in its own goroutine; or f was already stopped. The stop function does not wait for f to complete before returning. If the caller needs to know whether f is completed, it must coordinate with f explicitly.
>
> If ctx has a "AfterFunc(func()) func() bool" method, AfterFunc will use it to schedule the call.

### Key normative points

1. **`f` runs in a goroutine** — never inline.
2. **If `ctx` is already done, `f` runs immediately** — no delay.
3. **Multiple AfterFuncs are independent** — each registration is separate.
4. **`stop` returns true if it stopped `f`** — false if `f` already started or was already stopped.
5. **`stop` does not wait for `f`** — synchronisation must be explicit.
6. **`afterFuncer` interface** — custom contexts can opt in for efficient scheduling.

### Edge case: detached context

`AfterFunc(WithoutCancel(parent), f)` registers `f`, but `f` never runs because the detached context is never cancelled. The registration is effectively leaked unless `stop()` is called.

### Edge case: stop before fire

If `stop()` is called before the context is cancelled, the registration is removed and `f` will not run. Subsequent cancellation of the context does not fire `f`.

### Edge case: stop after fire

If the context is cancelled and `f` starts running, calling `stop()` returns false. `f` continues to completion.

---

## `context.Cause`

### Signature

```go
func Cause(c Context) error
```

### Behavior (from official documentation)

> Cause returns a non-nil error explaining why c was canceled. The first cancellation of c or one of its parents sets the cause. If that cancellation happened via a call to CancelCauseFunc(err), then Cause returns err. Otherwise Cause(c) returns the same value as c.Err(). Cause returns nil if c has not been canceled yet.

### Key normative points

1. **Walks ancestors** — looks for a `cancelCtx` in the chain.
2. **Returns the stored cause** — if found.
3. **Falls back to `c.Err()`** — if no cancelCtx ancestor.
4. **Returns nil before cancellation** — until the context is cancelled.
5. **First cancellation wins** — once set, the cause is immutable.

### Edge case: detached context

`Cause(WithoutCancel(parent))` returns nil. The walk for `cancelCtxKey` is interrupted at the `withoutCancelCtx` boundary, which explicitly returns nil. The fallback to `c.Err()` also returns nil.

### Edge case: layered cancel on detached

`Cause(WithCancelCause(WithoutCancel(parent)))` returns the cause set by the inner `WithCancelCause`'s cancel function. The detach does not affect this layer's cause.

---

## `context.WithCancelCause`

### Signature

```go
func WithCancelCause(parent Context) (Context, CancelCauseFunc)
type CancelCauseFunc func(cause error)
```

### Behavior (from official documentation)

> WithCancelCause behaves like WithCancel but returns a CancelCauseFunc instead of a CancelFunc. Calling cancel with a non-nil error ("the cause") records that error in ctx; it can then be retrieved using Cause(ctx). Calling cancel with nil sets the cause to Canceled.

### Key normative points

1. **Like `WithCancel`** — same parent inheritance, same children propagation.
2. **`cancel(nil)` sets cause to `Canceled`** — never sets cause to nil.
3. **`cancel(err)` stores `err` as cause** — retrievable via `Cause(ctx)`.

### Edge case: multiple calls to cancel

Only the first call's cause is stored. Subsequent calls are no-ops.

---

## `context.WithDeadlineCause` and `context.WithTimeoutCause`

### Signatures

```go
func WithDeadlineCause(parent Context, d time.Time, cause error) (Context, CancelFunc)
func WithTimeoutCause(parent Context, timeout time.Duration, cause error) (Context, CancelFunc)
```

### Behavior (from official documentation)

> WithDeadlineCause behaves like WithDeadline but also sets the cause of the returned Context when the deadline is exceeded. The returned CancelFunc does not set the cause.
>
> WithTimeoutCause behaves like WithTimeout but also sets the cause of the returned Context when the timeout expires. The returned CancelFunc does not set the cause.

### Key normative points

1. **Cause is set when the deadline/timeout fires** — only then.
2. **Cancel function does not set cause** — calling cancel manually sets cause to `Canceled`.
3. **`Err()` is still `DeadlineExceeded`** — the cause is separate.

### Edge case: cancel before deadline

If the cancel function is called before the deadline fires, the cause is set to `Canceled` (not the supplied cause). The supplied cause is reserved for the deadline-fire path.

---

## Interaction Matrix

| Operation | `Done()` | `Err()` | `Cause()` | `Deadline()` |
|---|---|---|---|---|
| `WithCancel` not cancelled | open channel | nil | nil | inherited |
| `WithCancel` cancelled | closed | `Canceled` | `Canceled` | inherited |
| `WithCancelCause` cancelled with cause | closed | `Canceled` | `cause` | inherited |
| `WithTimeout` not fired | open | nil | nil | own |
| `WithTimeout` fired | closed | `DeadlineExceeded` | `DeadlineExceeded` | own |
| `WithTimeoutCause` fired | closed | `DeadlineExceeded` | `cause` | own |
| `WithoutCancel(p)` always | nil | nil | nil | (zero, false) |
| `WithCancel(WithoutCancel(p))` cancelled | closed | `Canceled` | `Canceled` | (zero, false) |
| `WithTimeoutCause(WithoutCancel(p), d, c)` fired | closed | `DeadlineExceeded` | `c` | own |

This matrix is the formal specification of behaviour.

---

## Version History

| Version | Addition |
|---|---|
| Go 1.7 | `Context`, `WithCancel`, `WithDeadline`, `WithTimeout`, `WithValue`, `Background`, `TODO` |
| Go 1.20 | `WithCancelCause`, `Cause` |
| Go 1.21 | `WithoutCancel`, `AfterFunc`, `WithDeadlineCause`, `WithTimeoutCause` |

Older versions of Go do not have `WithoutCancel`. Code targeting Go 1.20 or earlier must hand-roll an equivalent.

---

## Non-Guarantees

The following are *not* guaranteed:

- The internal types (`withoutCancelCtx`, `cancelCtx`, etc.) are not part of the public API. Code should not depend on them.
- The exact memory layout of context structs may change between Go versions.
- The performance characteristics (allocation cost, lookup cost) are not guaranteed.
- The exact format of `String()` output is informational, not specified.
- The internal `goroutines` counter is for tests, not public consumption.

Code that relies on any of these is fragile and may break.

---

## References

- `https://pkg.go.dev/context` — package documentation.
- `https://go.dev/doc/go1.20` — Go 1.20 release notes.
- `https://go.dev/doc/go1.21` — Go 1.21 release notes.
- `https://github.com/golang/go/issues/40221` — WithoutCancel proposal.
- `https://github.com/golang/go/issues/56661` — AfterFunc proposal.
- `src/context/context.go` — implementation in the Go source tree.

---

## Summary

Six functions form the partial-cancellation API:

1. `WithoutCancel` — detach lifetime, preserve values.
2. `AfterFunc` — run callback on cancellation.
3. `Cause` — retrieve descriptive cancellation cause.
4. `WithCancelCause` — cancel with a cause.
5. `WithDeadlineCause` — deadline that sets a cause on fire.
6. `WithTimeoutCause` — timeout variant of the above.

Together they complete Go's cancellation story. Each has a precise contract documented in the standard library. Code that uses them must respect those contracts.

When in doubt, read the documentation. When the documentation is unclear, read the source. When the source is unclear, file an issue.

---

## Appendix: Formal Quotes With Annotations

### Quote 1

> WithoutCancel returns a copy of parent that is not canceled when parent is canceled.

Annotation: "copy" here means logical copy — the value chain is preserved, but the lifetime is independent.

### Quote 2

> The returned context returns no Deadline or Err, and its Done channel is nil.

Annotation: three independent claims. Each is verifiable by calling the corresponding method.

### Quote 3

> Calling Cause on the returned context returns nil.

Annotation: even if the parent had a cause set via `WithCancelCause`, the detached context has cause nil.

### Quote 4

> AfterFunc arranges to call f in its own goroutine after ctx is done.

Annotation: "in its own goroutine" — never inline, never in the cancelling goroutine.

### Quote 5

> If ctx is already done, AfterFunc calls f immediately in its own goroutine.

Annotation: "immediately" means without delay, but still in a new goroutine.

### Quote 6

> Multiple calls to AfterFunc on a context operate independently; one does not replace another.

Annotation: each registration is a separate handler.

### Quote 7

> Calling the returned stop function stops the association of ctx with f.

Annotation: stop is the only way to cancel a registration.

### Quote 8

> It returns true if the call stopped f from being run.

Annotation: true means "f will not run because of this stop." False means "f either already ran or was already stopped."

### Quote 9

> The stop function does not wait for f to complete before returning.

Annotation: stop is non-blocking. If you need to know when f finishes, you must synchronise separately.

### Quote 10

> Cause returns a non-nil error explaining why c was canceled.

Annotation: non-nil after cancellation; nil before.

---

## Appendix: Subtle Specification Corners

### Corner 1: Cause vs Err

`ctx.Err()` returns one of two errors: `Canceled` or `DeadlineExceeded`. `Cause(ctx)` may return a custom error supplied to a CancelCauseFunc or a deadline-cause variant.

The distinction:
- `Err` is the *category* of cancellation.
- `Cause` is the *specific* cause.

For most code, `Err` is sufficient. `Cause` is for differentiating between multiple reasons for the same category.

### Corner 2: When is Cause set?

`Cause` is set:
- When `CancelCauseFunc(err)` is called.
- When `WithDeadlineCause` or `WithTimeoutCause`'s deadline fires.

`Cause` is *not* set:
- By plain `WithCancel`'s cancel function.
- By plain `WithDeadline` or `WithTimeout`'s deadline fire.
- By the cancel function returned from `WithDeadlineCause` or `WithTimeoutCause` (only the deadline-fire path sets the supplied cause).

### Corner 3: Stop semantics

After calling `stop()`:
- If `stop` returned true: `f` will not run.
- If `stop` returned false: either `f` is running, has run, or `stop` was previously called (and returned true).

The semantics are deliberately precise. Use the return value to decide your next action.

### Corner 4: `afterFuncer` interface

A custom Context type can implement:

```go
AfterFunc(func()) func() bool
```

to participate efficiently in cancellation. The standard library uses this when it can find such an implementation in the chain.

This is an advanced library-author feature. Application code rarely needs it.

### Corner 5: Concurrent cancel and stop

If `cancel` and `stop` race:
- The first to win the `sync.Once` inside the afterFuncCtx wins.
- The other is a no-op.
- The return value of `stop` reflects whether it was first.

This is determined by the order of operations in the runtime scheduler. It is racy by construction.

---

## Appendix: Relationship to `select`

The `select` statement is the canonical way to wait on cancellation:

```go
select {
case <-ctx.Done():
    return ctx.Err()
case <-someChannel:
    // ...
}
```

For a detached context, `ctx.Done()` is nil. A receive on nil blocks forever. The `select` only fires on the other case.

This is the desired behaviour for detached work — the cancellation-aware path is dead code on detached contexts.

To opt out, use `Err()` polling:

```go
if err := ctx.Err(); err != nil {
    return err
}
```

`Err()` always returns nil for a detached context (until layered with cancellation). The polling check passes.

---

## Appendix: Memory Model Implications

The Go memory model specifies happens-before relationships for context operations:

- A call to `cancel` happens-before any return from `Done()` that observes the closed channel.
- A call to `cancel` happens-before any subsequent `Err()` call that returns non-nil.
- A call to `CancelCauseFunc(err)` happens-before any subsequent `Cause(ctx)` call that returns err.

For `WithoutCancel`, since there is no mutable state, no memory ordering matters.

These guarantees are essential for race-free use of contexts across goroutines.

---

## Appendix: Compatibility Promises

The Go 1 compatibility promise covers the public `context` API. The following are guaranteed not to change:

- Function signatures.
- Documented behaviour.
- Error values (`Canceled`, `DeadlineExceeded`).
- The general contract of `Context` interface methods.

The following are not guaranteed:

- Implementation details (struct layout, internal types).
- Performance characteristics (allocation, lookup cost).
- Internal-package exports (anything in `internal/...`).

Code that depends on the latter is at risk.

---

## Appendix: Behaviour Under Concurrent Use

The `Context` interface is safe for concurrent use. Specifically:

- Multiple goroutines may call any method on the same context concurrently.
- Cancel functions are safe to call from any goroutine.
- Cancel functions may be called multiple times; only the first has effect.

The standard library uses mutexes internally to ensure thread safety.

For custom Context types, the implementation must provide the same guarantees.

---

## Final Note

This specification file collects the formal contracts. The professional file walks through the implementation. The senior file covers architectural usage. The middle file covers patterns. The junior file covers basics.

Together, they form the complete partial-cancellation curriculum. Refer to whichever level fits your need.
