# Context Tree — Specification

[← Back to index](junior.md)

This file is a precise, normative description of the cancellation tree built by Go's `context` package. It is written so that a careful reader could re-implement a compatible package from it.

## Scope

The specification covers the public surface of the `context` package as of Go 1.21, including:

- `Background`, `TODO`
- `WithCancel`, `WithCancelCause`
- `WithDeadline`, `WithDeadlineCause`, `WithTimeout`, `WithTimeoutCause`
- `WithValue`
- `WithoutCancel`
- `AfterFunc`
- `Cause`, `Canceled`, `DeadlineExceeded`

It does not cover unexported implementation details that may change between versions.

## Definitions

**Context.** A value satisfying the `Context` interface:

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

**Cancellation tree.** The directed tree formed by all live contexts, where each non-root context has exactly one parent: the first argument passed to the constructor that produced it.

**Root.** A context with no parent. The values returned by `Background()` and `TODO()` are roots.

**Derived context.** A context produced by any `With...` function. Its parent is the constructor's first argument.

**Descendant.** Any context reachable from a node by following child edges.

**Cancellation event.** The moment a node's `Done()` channel transitions from open to closed.

## Invariants

### I1. Root immutability

For any root `r`:

- `r.Done()` returns `nil`.
- `r.Err()` returns `nil`.
- `r.Deadline()` returns `(time.Time{}, false)`.
- `r.Value(k)` returns `nil` for every `k`.

A root never experiences a cancellation event.

### I2. Edge stability

A context's parent is determined at construction and never changes. The tree is append-only with respect to nodes; nodes are not re-parented.

### I3. Cancellation monotonicity

For any context `c`:

- `c.Done()` either has been closed (cancellation event has occurred) or has not.
- Once closed, it stays closed.
- Once `c.Err()` returns a non-nil error, it returns the same non-nil error on every subsequent call.
- Once `Cause(c)` returns a non-nil error, the value it returns may not change (subject to the cause-walk rules in I7).

### I4. Downward cascade

If a context `p` undergoes a cancellation event, then every descendant `d` of `p` for which the cancellation tree edge from `p` to `d` does not cross a `WithoutCancel` boundary will also undergo a cancellation event before `p.Cancel` returns to its caller.

A "cross of a `WithoutCancel` boundary" means: somewhere on the path from `p` to `d`, there is a node `w` such that `w` was created by `WithoutCancel(parentOfW)`.

### I5. No upward propagation

If a context `c` undergoes a cancellation event, the ancestors of `c` are not affected. Their `Done()` channels do not close as a consequence of `c`'s cancellation.

### I6. Sibling isolation

If `a` and `b` are siblings (share the same immediate parent), cancellation of `a` does not affect `b`.

### I7. Cause walk

For any context `c`:

- If `c` was created with `WithCancelCause` or `WithTimeoutCause`/`WithDeadlineCause`, and its cancel was invoked with a non-nil cause `e`, then after the cancellation event, `Cause(c) == e`.
- If `c` has not undergone a cancellation event, `Cause(c)` returns `nil`.
- If `c` has undergone a cancellation event but no node in the path from `c` to root has set a cause, `Cause(c)` returns `c.Err()`.
- If `c` itself has no cause but an ancestor has one and is also cancelled, `Cause(c)` may return that ancestor's cause.

The exact walk is: find the nearest cancelled ancestor (including `c` itself) whose `cause` field is non-nil; return that. If none, return `c.Err()`.

## Constructors

### `Background() Context`

Returns a process-global root. The returned value is the same on every call within a process.

### `TODO() Context`

Returns a root semantically distinct from `Background` (for the purposes of `String()`), but behaviourally identical.

### `WithCancel(parent Context) (Context, CancelFunc)`

Creates a node `c` whose parent is `parent`. Returns `c` and a function `cancel` such that:

- Calling `cancel()` causes `c` to undergo a cancellation event with `Err() == Canceled` and `Cause(c) == Canceled` (subject to I7).
- Calling `cancel()` more than once has no further effect (it is idempotent).
- If `parent` has already undergone a cancellation event before `WithCancel` returns, then `c` has already undergone one too, with `Err()` equal to `parent.Err()`.

### `WithCancelCause(parent Context) (Context, CancelCauseFunc)`

Like `WithCancel`, but `cancel` takes an `error` argument that becomes `c`'s cause. If the argument is `nil`, the cause defaults to `Canceled`. Otherwise the cause is exactly the argument passed.

### `WithDeadline(parent Context, d time.Time) (Context, CancelFunc)`

Creates a node `c` whose parent is `parent`, with the following behaviour:

- If `parent.Deadline()` returns `(t, true)` with `t.Before(d)`, then `WithDeadline` is equivalent to `WithCancel(parent)` — no timer is created, and `c.Deadline()` returns the parent's deadline.
- Otherwise, a timer is started. When the timer fires at time `d`, `c` undergoes a cancellation event with `Err() == DeadlineExceeded` and `Cause(c) == DeadlineExceeded`.
- If `time.Now()` is already after or at `d` when `WithDeadline` is called, `c` is cancelled before `WithDeadline` returns.
- The returned `cancel` function may be called to cancel `c` early. Calling it stops the timer; the cancellation Err becomes `Canceled`.

### `WithDeadlineCause(parent Context, d time.Time, cause error) (Context, CancelFunc)`

Like `WithDeadline`, but when the timer fires, the cause is set to `cause` instead of `DeadlineExceeded`. `Err()` is still `DeadlineExceeded`.

### `WithTimeout(parent Context, dur time.Duration) (Context, CancelFunc)`

Equivalent to `WithDeadline(parent, time.Now().Add(dur))`.

### `WithTimeoutCause(parent Context, dur time.Duration, cause error) (Context, CancelFunc)`

Equivalent to `WithDeadlineCause(parent, time.Now().Add(dur), cause)`.

### `WithValue(parent Context, key, val any) Context`

Creates a node `c` whose parent is `parent` and whose `Value(k)` returns:

- `val` if `k == key`.
- `parent.Value(k)` otherwise.

`c`'s `Done()`, `Err()`, and `Deadline()` delegate to `parent`. `c` undergoes a cancellation event if and only if `parent` does.

`key` must be comparable and should not be of a built-in type. Defining a private type for keys is required to avoid collisions.

### `WithoutCancel(parent Context) Context`

Creates a node `c` whose parent is `parent` but:

- `c.Done()` returns `nil`.
- `c.Err()` returns `nil`.
- `c.Deadline()` returns `(time.Time{}, false)`.
- `c.Value(k)` delegates to `parent.Value(k)`.

`c` never undergoes a cancellation event, regardless of the parent's state.

Descendants of `c` are not affected by `parent`'s cancellation events. They may undergo cancellation if they have their own `With...` derivation.

## `AfterFunc`

```go
func AfterFunc(ctx Context, f func()) (stop func() bool)
```

Registers `f` to be called when `ctx` undergoes a cancellation event. Semantics:

- `f` is invoked at most once.
- `f` runs in its own goroutine, not on the cascade goroutine.
- If `ctx` has already undergone a cancellation event when `AfterFunc` is called, `f` is scheduled immediately.
- If `ctx` will never undergo a cancellation event (e.g., a root, a `WithoutCancel`), `f` will never be invoked.
- `stop()` deregisters `f`. It returns:
  - `true` if `f` had not started and is now guaranteed not to run.
  - `false` if `f` has already started (or completed) or had already been deregistered.

Multiple `AfterFunc` calls on the same context register independent callbacks. Each is invoked.

## `Cause`

```go
func Cause(c Context) error
```

Returns the original cancellation cause, per I7. Returns `nil` if `c` has not undergone a cancellation event.

## `Canceled` and `DeadlineExceeded`

```go
var Canceled = errors.New("context canceled")
var DeadlineExceeded error = deadlineExceededError{}
```

Both are exported, comparable with `errors.Is`. `DeadlineExceeded`'s `Timeout()` method returns `true` (it implements `net.Error`).

## Memory and Goroutine Cost

The specification does not mandate specific implementation costs, but compatible implementations must:

- Not allocate a `Done()` channel for nodes whose `Done()` is never called and which are not cancelled.
- Not allocate a `children` map for nodes that have no cancelable children.
- Not spawn a permanent goroutine per derivation when both parent and child are built-in node types.
- Spawn at most one goroutine per derivation when the parent is a non-built-in `Context` whose `Done()` is non-nil.

## Concurrency

All methods on `Context` are safe for concurrent use. The returned `cancel` functions are safe for concurrent use; calls from multiple goroutines do not interfere.

The order in which descendants undergo cancellation events during a cascade is not specified. Implementations are free to use any order, including non-deterministic ones.

## Errors

- `Err()` after a `WithCancel` cancellation returns `Canceled`.
- `Err()` after a deadline-driven cancellation returns `DeadlineExceeded`.
- `Err()` before any cancellation event returns `nil`.
- `Cause()` follows I7.

## Compatibility

Implementations claiming compatibility with this specification:

- Must satisfy I1–I7.
- Must implement every constructor with the described semantics.
- May add additional methods or types (e.g., for instrumentation) without breaking I1–I7.
- May choose any deterministic or non-deterministic cascade order.

## Non-Goals

This specification does not describe:

- The exact wire-up algorithm (`propagateCancel`).
- The choice of data structure for `children`.
- The exact mechanism for AfterFunc registration.
- Custom contexts implemented outside the standard library.

Those are implementation details and may differ between versions of Go.
