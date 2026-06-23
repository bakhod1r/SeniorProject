# Context Internals — Specification

[← Back to index](index.md)

## Purpose

This page is the formal contract every `context.Context` implementation must obey, plus the runtime guarantees the standard library types make on top of that contract. It is the reference you cite in design discussions and code reviews when arguing whether a behaviour is required, optional, or accidental.

References to `the package` mean the `context` package in the Go standard library. References to `the runtime` mean the Go runtime as of Go 1.22.

---

## 1. The Context Interface

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done()    <-chan struct{}
    Err()     error
    Value(key any) any
}
```

All four methods must be implemented. Any object satisfying this interface is a `Context`.

### 1.1 `Deadline()` contract

- If no deadline is set, returns the zero `time.Time` and `false`.
- If a deadline is set, returns the deadline and `true`.
- May be called any number of times. Return values must be **stable**: if it ever returns `(d, true)`, subsequent calls must return `(d, true)` with the same `d`.
- May be called concurrently from any number of goroutines.

### 1.2 `Done()` contract

- Returns a `<-chan struct{}`.
- If the context can never be canceled, returns `nil`. (Receiving from nil blocks forever.)
- Otherwise, returns a non-nil channel that **closes** when the context is canceled.
- The channel value returned must be **stable**: subsequent calls must return the same channel (or both `nil`).
- Closure must be observable to all goroutines after a successful cancel.
- May be called concurrently.

### 1.3 `Err()` contract

- Before cancellation: returns `nil`.
- After cancellation: returns a non-nil error. The error must satisfy `errors.Is(err, context.Canceled)` or `errors.Is(err, context.DeadlineExceeded)` for standard contexts; custom implementations may return other errors but must remain consistent.
- After cancellation: subsequent calls must return the **same** error value.
- Must not return a non-nil error while `Done()` is unclosed. This is the strongest synchronisation requirement in the interface.

### 1.4 `Value(key)` contract

- May return `nil` for any key.
- Must be safe to call concurrently.
- For a fixed key, returned values may change only if the implementation explicitly mutates (the standard types do not).
- Lookups must traverse the parent chain when this context does not directly hold a value for `key`.
- Implementations should use unique unexported types as keys to avoid collisions.

---

## 2. Sentinel Values

### 2.1 `context.Canceled`

A package-level `error`. Value: `errors.New("context canceled")`. Returned by `Err()` when the cause of cancellation is a manual call to a `CancelFunc`.

### 2.2 `context.DeadlineExceeded`

A package-level `error` of type `deadlineExceededError`. Value: implements `Error() string == "context deadline exceeded"`, `Timeout() bool == true`, `Temporary() bool == true`.

Returned by `Err()` when a context cancels due to its deadline expiring.

### 2.3 `closedchan`

An unexported package-level channel of type `chan struct{}`, closed at package init. Used internally as the shared "already-done" channel for contexts whose `Done()` was never observed before cancellation.

Not part of the public contract, but observable: a context's `Done()` channel may compare equal across multiple canceled contexts that share `closedchan`.

---

## 3. Standard Context Types

The package provides nine concrete types. Six are observable through the public API; three (`stopCtx`, `afterFuncCtx`, `emptyCtx`) are internal.

### 3.1 `emptyCtx`

- Zero-sized struct.
- `Deadline()` returns `(time.Time{}, false)`.
- `Done()` returns `nil`.
- `Err()` returns `nil`.
- `Value(any)` returns `nil`.

### 3.2 `backgroundCtx`

- Embeds `emptyCtx`.
- `String()` returns `"context.Background"`.
- Returned by `context.Background()`.

### 3.3 `todoCtx`

- Embeds `emptyCtx`.
- `String()` returns `"context.TODO"`.
- Returned by `context.TODO()`.

### 3.4 `cancelCtx`

- Carries a parent, a mutex, a lazily-allocated done channel, a children map, an atomic error, and a cause error.
- Returned by `context.WithCancel` and `context.WithCancelCause`.
- May be in two states: pre-cancel (err=nil, done=nil or open) and post-cancel (err non-nil, done closed or closedchan).
- Mutable state transitions monotonically from pre- to post-cancel; never back.

### 3.5 `timerCtx`

- Embeds `cancelCtx`, adds a `*time.Timer` and a `time.Time` deadline.
- Returned by `context.WithDeadline`, `context.WithTimeout`, `context.WithDeadlineCause`, `context.WithTimeoutCause`.
- The timer fires `cancel(true, DeadlineExceeded, cause)` at the deadline.
- The timer is stopped on manual cancel (via the returned `CancelFunc`).

### 3.6 `valueCtx`

- Holds a parent, a key, and a value.
- Returned by `context.WithValue`.
- Immutable after construction. No mutex; no allocation beyond the struct itself.

### 3.7 `withoutCancelCtx`

- Holds only a parent.
- Returned by `context.WithoutCancel`.
- `Done()` returns nil; `Err()` returns nil; `Deadline()` returns zero values.
- `Value()` forwards to `value()` with `self` (so the boundary semantic for `&cancelCtxKey` is preserved).

### 3.8 `afterFuncCtx` (internal)

- Embeds `cancelCtx`. Adds a `sync.Once` and a callback `f`.
- Used internally by `context.AfterFunc`.
- The user does not name this type; the only handle is the returned `stop func() bool`.

### 3.9 `stopCtx` (internal)

- Wraps a parent context with a `stop func() bool`.
- Used internally by `propagateCancel` when the parent satisfies the `afterFuncer` interface.
- Allows `removeChild` to find the right `stop` function to unregister.

---

## 4. Constructor Behaviour

### 4.1 `Background() Context`

Returns the singleton `backgroundCtx{}`. Always returns a context with no deadline, no cancellation, no values. Pure function.

### 4.2 `TODO() Context`

Returns the singleton `todoCtx{}`. Behaves identically to `Background` semantically but is distinct as a type for documentation purposes.

### 4.3 `WithCancel(parent) (Context, CancelFunc)`

- Panics if `parent` is nil.
- Allocates a fresh `cancelCtx`.
- Sets up parent linkage via `propagateCancel`.
- Returns the new context and a `CancelFunc` that, when called, cancels the new context with `context.Canceled`.
- Multiple calls to the `CancelFunc` are safe; subsequent calls are no-ops.

### 4.4 `WithCancelCause(parent) (Context, CancelCauseFunc)`

- Identical to `WithCancel` except the returned function takes an `error` argument.
- When called, the context is canceled with `context.Canceled` as `Err()` and the supplied error as `Cause()`.
- A nil cause is treated as if `Cause = Err = Canceled`.

### 4.5 `WithDeadline(parent, d) (Context, CancelFunc)`

- Panics if `parent` is nil.
- If `parent` has an earlier deadline than `d`, returns `WithCancel(parent)` (no timer allocated).
- If `d` has already passed, returns a context that is already canceled with `DeadlineExceeded`.
- Otherwise, arms a `time.Timer` to fire at `d`. Returns the context and a `CancelFunc` for manual cancellation with `Canceled`.

### 4.6 `WithDeadlineCause(parent, d, cause) (Context, CancelFunc)`

- Same as `WithDeadline` plus a custom cause for the deadline-expiry case.
- When the deadline fires: `Err()` returns `DeadlineExceeded`, `Cause()` returns `cause`.
- When the manual `CancelFunc` is called: `Err()` and `Cause()` both return `Canceled`.

### 4.7 `WithTimeout(parent, d)`, `WithTimeoutCause(parent, d, cause)`

Defined as `WithDeadline(parent, time.Now().Add(d))` and `WithDeadlineCause(parent, time.Now().Add(d), cause)`.

### 4.8 `WithValue(parent, k, v) Context`

- Panics if `parent` is nil.
- Panics if `k` is nil.
- Panics if `k`'s type is not comparable (checked via `reflectlite`).
- Returns a `*valueCtx` carrying `(parent, k, v)`.

### 4.9 `WithoutCancel(parent) Context`

- Panics if `parent` is nil.
- Returns a `withoutCancelCtx` wrapping `parent`.
- The returned context inherits values but not cancellation or deadline.

### 4.10 `AfterFunc(ctx, f) func() bool`

- Schedules `f` to run on a fresh goroutine after `ctx` is canceled.
- Returns a `stop` function; calling `stop()` cancels the scheduling.
- `stop()` returns `true` if `f` was successfully prevented from running; `false` otherwise.
- If `ctx` is already canceled when `AfterFunc` is called, `f` runs immediately on a new goroutine.

### 4.11 `Cause(c) error`

- Walks the chain to find the nearest `*cancelCtx`.
- If found, returns its stored `cause`.
- If not found (chain has no cancelCtx, or is bounded by `WithoutCancel`), returns `c.Err()`.

---

## 5. Synchronisation Guarantees

### 5.1 Done-Err Ordering

For any context `c` and any goroutine G observing `c.Err() != nil`, G must also observe `c.Done()` as closed.

The package enforces this via `Err()`'s implementation:

```go
func (c *cancelCtx) Err() error {
    if err := c.err.Load(); err != nil {
        <-c.Done()  // synchronisation barrier
        return err.(error)
    }
    return nil
}
```

The `<-c.Done()` ensures a happens-before edge from the `close(d)` in `cancel` to the return from `Err`.

### 5.2 Cancel Idempotency

Calling `cancel` twice (whether explicitly or via the `defer cancel()` idiom plus an earlier call) is safe:

- The second call observes `err.Load() != nil` and returns immediately.
- The done channel remains closed.
- The cause set by the first call is preserved.

### 5.3 Cascading Cancel Order

When a `cancelCtx` is canceled:

- Its `err` and `cause` are set first.
- Its `done` channel is closed second.
- Its children are canceled third, in arbitrary (map iteration) order.
- Its `children` field is set to nil fourth.

All four steps occur under the cancel context's mutex. External observers see them in order via the published `Err`/`Done` interface.

### 5.4 Children Map Drainage

After cancellation, the `children` map is set to `nil`. Any subsequent attempt to register a child (via `propagateCancel`) instead immediately cancels the child:

```go
if err := p.err.Load(); err != nil {
    child.cancel(false, err.(error), p.cause)
}
```

This is the "race with parent cancel" case: a child created concurrently with the parent's cancellation is born already-canceled.

### 5.5 Concurrency of Reads

`Done()`, `Err()`, `Deadline()`, `Value()` are all safe to call concurrently from any number of goroutines. The standard implementations use lock-free reads where possible.

### 5.6 Concurrency of Cancels

Multiple goroutines may simultaneously attempt to cancel the same context. Exactly one wins (the one that first acquires the mutex with `err.Load() == nil`); the others observe the canceled state and return.

---

## 6. Parent-Child Linkage Rules

### 6.1 Recognition

`propagateCancel` recognises three categories of parent:

1. **Uncancellable** (`Done() == nil`): no registration.
2. **Standard cancelable** (chain includes a `*cancelCtx`, with matching done channel): registered in parent's children map.
3. **Custom cancelable**: handled either by `afterFuncer` interface (recommended) or by a forwarder goroutine (fallback).

### 6.2 Registration

A child registers itself with the nearest recognised `*cancelCtx` ancestor. Intermediate value-only wrappers (`valueCtx`) are transparent — the child registers with the cancelCtx *behind* the value chain, not with each value wrapper.

This is achieved via the `&cancelCtxKey` sentinel lookup in `value()`.

### 6.3 Unregistration

A child unregisters from its parent when its own `cancel(true, ...)` runs. The unregistration:

- Looks up the parent via `parentCancelCtx`.
- Takes the parent's mutex.
- Deletes the child from the parent's children map (if the map is non-nil).

If the parent has already cancelled (and nilled the map), unregistration is a no-op.

### 6.4 `WithoutCancel` Boundary

A context derived from `WithoutCancel(parent)` is **not** linked to `parent`'s cancellation. The boundary is enforced in two places:

- `withoutCancelCtx.Done()` returns `nil`, so `propagateCancel` returns early in branch 1.
- `value()`'s case for `withoutCancelCtx` returns `nil` for `&cancelCtxKey`, so `parentCancelCtx` cannot reach across the boundary.

---

## 7. Resource Management

### 7.1 Goroutine Costs

- `WithCancel`, `WithDeadline`, `WithTimeout`, `WithValue`, `WithoutCancel`: zero goroutines per call, **provided** the parent is a recognised standard type.
- `WithCancel` etc. against a custom non-recognised parent: one forwarder goroutine per call.
- `AfterFunc`: one goroutine *only when* the callback fires.

### 7.2 Heap Costs

See the allocation table on the [professional.md](professional.md) page. Summary:

- `Background`/`TODO`: 0 bytes per call.
- `WithCancel`: ~80 bytes (cancelCtx) + ~16 bytes (closure).
- `WithDeadline`/`WithTimeout`: ~80 bytes + ~64 bytes (timer) + ~16 bytes (closure).
- `WithValue`: ~48 bytes + potential boxing of value into `any`.
- `WithoutCancel`: ~16 bytes.

### 7.3 Timer Costs

A `*time.Timer` armed by `time.AfterFunc` consumes a slot in the runtime's timer heap. Slots are reclaimed when:

- The timer fires (it removes itself).
- `timer.Stop()` is called (the `timerCtx.cancel` method does this).

A leaked timer (un-stopped, un-fired) consumes one slot for its full duration. At high QPS with un-cancelled `WithTimeout`, this becomes a significant runtime cost.

### 7.4 Map Costs

A `cancelCtx.children` map is allocated only when the first child registers. Each child adds one slot. The map is reclaimed when the parent cancels (`children = nil`).

A leaked children map (parent never cancels, never has its children removed) grows unboundedly. This is the most common context-related memory leak.

---

## 8. Cause Semantics

### 8.1 Default Cause

For contexts created without an explicit cause (i.e., via `WithCancel`, `WithDeadline`, `WithTimeout`):

- After cancellation, `Cause(c) == Err(c)`.
- For manual cancellation: both are `Canceled`.
- For deadline expiry: both are `DeadlineExceeded`.

### 8.2 Custom Cause

For contexts created with `WithCancelCause`, `WithDeadlineCause`, `WithTimeoutCause`:

- After cancellation, `Err(c)` returns the standard error (`Canceled` or `DeadlineExceeded`).
- `Cause(c)` returns the user-supplied error (if non-nil) or falls back to `Err`.

### 8.3 Cause Across `WithoutCancel`

A child of `WithoutCancel(parent)` has its own (nil) cause. The parent's cause is **not** propagated:

- `Cause(WithoutCancel(parent))` always returns `nil` (because `Err` is also nil).
- After cancelling the parent, `Cause` of the WithoutCancel-derived context remains `nil` — that derivation never cancels.

### 8.4 Cause Across Deep Chains

`Cause` walks up to the nearest `*cancelCtx`. If multiple ancestors have causes (e.g., grandparent and parent both cancel), the **nearest** ancestor's cause is returned. Each `cancelCtx` carries its own independent cause.

---

## 9. Implementation Requirements for Custom Contexts

If you implement a custom `Context`:

### 9.1 Must

- Implement all four methods.
- Make all methods safe for concurrent use.
- Ensure `Done` channel identity is stable across calls.
- Ensure `Err` non-nil implies `Done` closed (synchronisation).
- Ensure `Err` is monotonic (once non-nil, stays the same non-nil value).
- Ensure `Deadline` results are monotonic.

### 9.2 Should

- Implement `String() string` for diagnostic readability.
- Forward `Value(&cancelCtxKey)` to expose the underlying cancelable, if any.
- Implement `AfterFunc(func()) func() bool` if cancellation can be registered as a callback.

### 9.3 Must Not

- Mutate values returned by `Value`.
- Return distinct channel values from successive `Done()` calls.
- Return non-nil `Err` while `Done` is unclosed.

---

## 10. Versioning

The `context` package's API surface and semantics have evolved monotonically since Go 1.7:

| Go version | Added / changed |
|------------|-----------------|
| 1.7        | `context` enters standard library. Interface and basic functions unchanged from `x/net/context`. |
| 1.16       | `signal.NotifyContext` added (in `os/signal`, builds on `context`). |
| 1.20       | `WithCancelCause`, `Cause`, `CancelCauseFunc` added. |
| 1.21       | `AfterFunc`, `WithoutCancel`, `WithDeadlineCause`, `WithTimeoutCause` added. |
| 1.22       | Documentation clarifications; no API additions. |

No API has been removed or had its semantics changed. Code written against Go 1.7's `context` still works on Go 1.22.

---

## 11. References

- Go source: `src/context/context.go` (all sections of this spec reference this file).
- Tests: `src/context/x_test.go` and `src/context/context_test.go`.
- Original blog post: "Go Concurrency Patterns: Context" by Sameer Ajmani, 2014.
- Proposal for `WithCancelCause`: https://go.dev/issue/51365.
- Proposal for `AfterFunc`, `WithoutCancel`: https://go.dev/issue/57928.

Next: [interview.md](interview.md) — internal-mechanism interview questions from junior to staff level.
