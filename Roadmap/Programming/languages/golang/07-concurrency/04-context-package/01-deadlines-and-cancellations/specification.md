# Deadlines and Cancellations — Specification

[← Back to index](junior.md)

This document is the formal description of the contract: what every implementation of `context.Context` must do, what the constructors guarantee, and the rules governing the cancellation tree.

## 1. Interface Contract

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

Every method must be safe to call concurrently from multiple goroutines.

### 1.1 Deadline

- Returns `(t, true)` if the context will be canceled at or before `t`.
- Returns `(time.Time{}, false)` if no deadline exists.
- Once a deadline is set on a context, it must not change.
- The returned time is in absolute terms (UTC or any monotonic-bearing time); compare with `time.Now`.

### 1.2 Done

- Returns a channel that is closed when the context is canceled or its deadline expires.
- May return `nil` for contexts that can never be canceled (e.g. `Background()`, `TODO()`, `WithoutCancel(...)`).
- Successive calls must return the **same** channel instance.
- The channel must be closed at most once.
- Reading from a closed channel must always succeed; never blocks.

### 1.3 Err

- Returns `nil` until `Done()`'s channel is closed.
- After `Done()` closes, returns:
  - `Canceled` if the context was canceled by a call to its associated cancel function.
  - `DeadlineExceeded` if the context was canceled because the deadline passed.
  - For derived chains: returns the cancellation reason from the **closest cancelable ancestor**.
- Successive calls must return the **same** error.
- Once non-nil, must not transition back to nil.

### 1.4 Value

- `Value(key)` returns the value associated with `key` for any ancestor in the chain that called `WithValue` for that key.
- If multiple ancestors set the same key, returns the **closest** (deepest in the chain).
- Returns `nil` if no ancestor has the key.
- Must be deterministic and safe for concurrent calls.
- Must not allocate on lookup (most implementations do not).

## 2. Constructors

### 2.1 Background and TODO

```go
func Background() Context
func TODO() Context
```

- Both return a non-nil empty `Context`.
- `Background` is the documented root for the program (main, init, tests).
- `TODO` is a placeholder for code paths that should later be wired with a real context.
- Both implementations must:
  - Return `nil` from `Done()`.
  - Return `nil` from `Err()`.
  - Return `(time.Time{}, false)` from `Deadline()`.
  - Return `nil` from `Value(any)`.
- `Background` and `TODO` are global singletons (no allocation per call).

### 2.2 WithCancel

```go
func WithCancel(parent Context) (ctx Context, cancel CancelFunc)
```

- Panics if `parent == nil`.
- Returns a new context that is canceled when:
  - `cancel` is called, **or**
  - The parent's `Done()` channel is closed.
- `Err()` returns `Canceled` if `cancel` was called first; otherwise the parent's `Err`.
- `cancel` is idempotent: calling it more than once has no additional effect.
- `cancel` must be called by the caller; failing to call it before the context goes out of scope leaks resources.

### 2.3 WithDeadline

```go
func WithDeadline(parent Context, d time.Time) (ctx Context, cancel CancelFunc)
```

- Panics if `parent == nil`.
- Returns a new context that is canceled when:
  - The deadline `d` is reached, **or**
  - `cancel` is called, **or**
  - The parent's `Done()` channel is closed.
- If the parent already has an earlier deadline, the new deadline is ignored and the new context inherits the parent's.
- If `d` is already in the past, the returned context is already canceled and `cancel` immediately becomes a no-op for the deadline portion.
- `Err()` returns:
  - `DeadlineExceeded` when the deadline is the cause.
  - `Canceled` when `cancel` was called first.
  - The parent's `Err()` when the parent canceled first.
- `cancel` must be called by the caller for resource cleanup, even if the deadline will fire.

### 2.4 WithTimeout

```go
func WithTimeout(parent Context, d time.Duration) (ctx Context, cancel CancelFunc)
```

- Equivalent to `WithDeadline(parent, time.Now().Add(d))`.
- All other guarantees match `WithDeadline`.

### 2.5 WithValue

```go
func WithValue(parent Context, key, val any) Context
```

- Panics if `parent == nil`.
- Panics if `key == nil`.
- Panics if `key`'s dynamic type is not comparable.
- Returns a context where `Value(key)` returns `val`, otherwise delegating to `parent.Value`.
- `Done`, `Err`, and `Deadline` are passed through unchanged.
- The key should typically be a private type to avoid collision; comparable but unique to the package.

### 2.6 WithCancelCause (Go 1.20+)

```go
func WithCancelCause(parent Context) (ctx Context, cancel CancelCauseFunc)

type CancelCauseFunc func(cause error)
```

- Like `WithCancel` but records a cause.
- `cancel(cause)` cancels the context. If `cause == nil`, the cause defaults to `Canceled`.
- `ctx.Err()` returns `Canceled` (for backward compatibility) when the cause is non-nil.
- `Cause(ctx)` returns the recorded cause, walking up to the closest ancestor that has one.

### 2.7 WithDeadlineCause / WithTimeoutCause (Go 1.21+)

```go
func WithDeadlineCause(parent Context, d time.Time, cause error) (Context, CancelFunc)
func WithTimeoutCause(parent Context, d time.Duration, cause error) (Context, CancelFunc)
```

- Like `WithDeadline`/`WithTimeout` but specify the cause that will be reported by `Cause(ctx)` when the deadline fires.

### 2.8 WithoutCancel (Go 1.21+)

```go
func WithoutCancel(parent Context) Context
```

- Returns a context whose `Done()` returns `nil`, `Err()` returns `nil`, `Deadline()` returns `(time.Time{}, false)`.
- `Value` calls delegate to `parent`.
- The returned context is **never canceled**, even when the parent is.
- Useful for detaching long-running tasks while preserving request-scoped values.

### 2.9 AfterFunc (Go 1.21+)

```go
func AfterFunc(ctx Context, f func()) (stop func() bool)
```

- Registers `f` to run on its own goroutine when `ctx` is canceled.
- If `ctx` is already canceled, `f` runs immediately on a new goroutine.
- `stop()` deregisters `f`. Returns `true` if `f` had not been started; `false` otherwise.
- Multiple `AfterFunc` calls on the same context register independently.

## 3. Cancellation Semantics

### 3.1 Cancellation Tree

- Every context derived via `WithCancel`, `WithDeadline`, `WithTimeout`, `WithCancelCause`, `WithDeadlineCause`, or `WithTimeoutCause` is a **child** of its parent.
- The cancellation tree is acyclic by construction: each derived context has exactly one parent.

### 3.2 Cancellation Direction

- Cancellation propagates from parent to descendants.
- A child's cancel does not affect the parent or siblings.
- A `WithoutCancel`-derived child is detached from the parent's cancellation but still inherits values.

### 3.3 Cancellation Atomicity

- A given context is canceled at most once.
- The `Done` channel close is the synchronization event that establishes happens-before for all subsequent reads of `Err`, `Cause`, etc.
- Concurrent calls to `cancel` are safe; only the first effective call wins.

### 3.4 Cascade Order

- When a parent cancels, its children cancel synchronously, depth-first, before the parent's `cancel` returns.
- Custom `Context` implementations that are not recognized by the runtime cause the runtime to start a goroutine forwarder that will eventually call cancel on the child.

## 4. Sentinel Errors

```go
var Canceled         = errors.New("context canceled")
var DeadlineExceeded error // implements net.Error with Timeout() == true
```

- `Canceled` is a plain sentinel. `errors.Is(err, context.Canceled)` matches it.
- `DeadlineExceeded` satisfies `net.Error`'s `Timeout()` returning true. Useful for retry logic.

## 5. Cause

```go
func Cause(ctx Context) error
```

- Returns the cause of the **closest** canceled ancestor that recorded one.
- If no ancestor recorded a cause, returns `ctx.Err()`.
- If `ctx` is not canceled, returns `nil`.

## 6. Value Semantics

- Lookup is linear in the depth of the value chain.
- Keys must be comparable; using a built-in type like `string` or `int` is allowed but discouraged because of collision risk.
- The recommended pattern is a private unexported struct type:
  ```go
  type traceIDKey struct{}
  ctx = context.WithValue(ctx, traceIDKey{}, id)
  ```
- Storing very large values is discouraged; values cannot be cleaned up except by GC after the chain is unreferenced.

## 7. Concurrency Safety

- All methods on every `Context` returned by the standard library are safe for concurrent use.
- Custom `Context` implementations must guarantee the same.
- A `CancelFunc` is safe for concurrent use.
- The `Done` channel is safe to receive from concurrently; receivers all wake when it closes.

## 8. Memory Model

- The close of `Done` happens-before any subsequent read of `Err()` or `Cause(ctx)`.
- A successful receive from `ctx.Done()` happens-before subsequent operations in the receiving goroutine.
- A call to `cancel()` happens-before any subsequent close of `ctx.Done()` (often the same instant).

## 9. Resource Lifecycle

- Each `WithCancel`/`WithDeadline`/`WithTimeout` allocates a `cancelCtx` or `timerCtx` plus, lazily, a `Done` channel.
- A `timerCtx` holds a `time.Timer`; `cancel()` stops the timer.
- Failing to call `cancel()` causes the entry to live in the parent's `children` map until the parent is itself canceled or GCed.

## 10. Error Wrapping

- Many standard library functions wrap context errors. For example, `*sql.DB.QueryContext` may return `fmt.Errorf("query: %w", ctx.Err())`.
- Always use `errors.Is(err, context.Canceled)` and `errors.Is(err, context.DeadlineExceeded)` rather than `==`.

## 11. Anti-Patterns (Normative)

The package documentation specifies:

- "Do not pass a nil Context, even if a function permits it."
- "Do not store Contexts inside a struct type; instead, pass a Context explicitly to each function that needs it."
- "The Context should be the first parameter, typically named ctx."
- "Use context Values only for request-scoped data that transits processes and APIs, not for passing optional parameters to functions."

These are normative requirements; tooling (`go vet`, `staticcheck`) enforces them.

## 12. Compatibility

- The `context` package's interface must not change in a way that breaks `Context` implementers.
- New constructors (`WithCancelCause`, `WithoutCancel`, `AfterFunc`, etc.) extend the package without breaking existing code.
- Deprecation of `Canceled` or `DeadlineExceeded` would be a Go 2-level change.

## 13. Build Tags and Variants

The runtime's context implementation is the same on all platforms. There are no build-tag-specific variants. The `time.Timer` used inside `timerCtx` uses the platform's `runtime.timer`.

## 14. Reserved Behaviour

- `context.TODO()` and `context.Background()` may be optimized to return the same singleton — never assume distinctness via `==`.
- `time.Time{}` (zero value) is the canonical "no deadline" marker.
- Custom contexts must not panic on any method call when constructed correctly.
