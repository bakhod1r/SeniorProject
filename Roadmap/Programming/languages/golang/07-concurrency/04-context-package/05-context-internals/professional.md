# Context Internals — Professional

[← Back to index](index.md)

## Table of Contents
1. [Reading the Package Cover to Cover](#reading-the-package-cover-to-cover)
2. [File Layout and Imports](#file-layout-and-imports)
3. [The Context Interface — Verbatim](#the-context-interface--verbatim)
4. [Sentinel Errors](#sentinel-errors)
5. [emptyCtx, backgroundCtx, todoCtx](#emptyctx-backgroundctx-todoctx)
6. [Background and TODO Constructors](#background-and-todo-constructors)
7. [The CancelFunc Type](#the-cancelfunc-type)
8. [WithCancel and withCancel](#withcancel-and-withcancel)
9. [WithCancelCause](#withcancelcause)
10. [Cause](#cause-the-public-accessor)
11. [AfterFunc and afterFuncCtx](#afterfunc-and-afterfuncctx)
12. [stopCtx Bridge](#stopctx-bridge)
13. [The cancelCtxKey Sentinel](#the-cancelctxkey-sentinel)
14. [parentCancelCtx Walkthrough](#parentcancelctx-walkthrough)
15. [removeChild Walkthrough](#removechild-walkthrough)
16. [canceler Interface and closedchan](#canceler-interface-and-closedchan)
17. [cancelCtx — Field by Field](#cancelctx--field-by-field)
18. [cancelCtx.Value](#cancelctxvalue)
19. [cancelCtx.Done](#cancelctxdone)
20. [cancelCtx.Err](#cancelctxerr)
21. [cancelCtx.propagateCancel](#cancelctxpropagatecancel)
22. [cancelCtx.cancel](#cancelctxcancel)
23. [withoutCancelCtx](#withoutcancelctx-1)
24. [WithDeadline and WithDeadlineCause](#withdeadline-and-withdeadlinecause)
25. [timerCtx Type and Methods](#timerctx-type-and-methods)
26. [WithTimeout and WithTimeoutCause](#withtimeout-and-withtimeoutcause)
27. [WithValue and valueCtx](#withvalue-and-valuectx)
28. [The value() Iterative Walker](#the-value-iterative-walker)
29. [Allocation Accounting Summary](#allocation-accounting-summary)
30. [Performance Characteristics](#performance-characteristics)
31. [Comparison With Other Runtimes](#comparison-with-other-runtimes)
32. [The 2014–2024 Timeline](#the-2014-2024-timeline)

---

## Reading the Package Cover to Cover

The professional view of the `context` package treats it as a text to be read in full. The file is roughly 800 lines, including comments. You can hold the whole thing in your head once you have seen each piece three or four times.

This page walks the file top to bottom, transcribing the meaningful chunks and annotating each. Line numbers refer to Go 1.22's `src/context/context.go`; they drift slightly between releases but stay within ~10 lines.

The goal is not to memorise the code. The goal is to know, when a bug appears in a deep stack trace, which function the bug is happening in and what its loop invariants are.

---

## File Layout and Imports

```go
package context

import (
    "errors"
    "internal/reflectlite"
    "sync"
    "sync/atomic"
    "time"
)
```

Five imports. Notable: `internal/reflectlite` — a stripped-down `reflect` used only inside the standard library. The full `reflect` package is too heavy for `context` to import (and would create a circular import via `reflect` → `runtime` → `context` chains). `reflectlite` is reused by `errors` and `fmt` for similar reasons.

`sync` and `sync/atomic` are both needed: `sync.Mutex` and `sync.Once` for serialisation, `atomic.Value` and `atomic.Int32` for the lock-free hot paths.

`time` is used only by `WithDeadline` / `WithTimeout`. `errors` is used for `errors.New("context canceled")`.

---

## The Context Interface — Verbatim

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)

    Done() <-chan struct{}

    Err() error

    Value(key any) any
}
```

The interface has a long block of doc comments above it (lines 71–166 in current source). Worth reading. The most important contracts:

- "If `Done` is not yet closed, `Err` returns nil. If `Done` is closed, `Err` returns a non-nil error explaining why."
- "Successive calls to `Err` return the same error." Idempotent.
- "If the context is canceled, `Done` returns a closed channel." It does not return a channel that *will* be closed; it returns one already closed.
- "`Value` should be used only for request-scoped data, not for passing optional parameters." The classic warning.

These are not implementation details. They are the contract every `Context` implementation must obey. The standard library types are merely the canonical implementations.

---

## Sentinel Errors

```go
var Canceled = errors.New("context canceled")

var DeadlineExceeded error = deadlineExceededError{}

type deadlineExceededError struct{}

func (deadlineExceededError) Error() string   { return "context deadline exceeded" }
func (deadlineExceededError) Timeout() bool   { return true }
func (deadlineExceededError) Temporary() bool { return true }
```

Two errors. `Canceled` is a plain `errors.New`. `DeadlineExceeded` is its own type so it can satisfy the `interface { Timeout() bool }` pattern used by `net.Error` — code that does `if ne, ok := err.(net.Error); ok && ne.Timeout()` can detect a context deadline timeout uniformly with a network timeout.

`Temporary() bool` is a legacy interface (`net.Error.Temporary`) that the Go team has soft-deprecated, but it remains for compatibility.

These two errors are the **only** values `Err()` ever returns for standard contexts.

---

## emptyCtx, backgroundCtx, todoCtx

```go
type emptyCtx struct{}

func (emptyCtx) Deadline() (deadline time.Time, ok bool) {
    return
}

func (emptyCtx) Done() <-chan struct{} {
    return nil
}

func (emptyCtx) Err() error {
    return nil
}

func (emptyCtx) Value(key any) any {
    return nil
}

type backgroundCtx struct{ emptyCtx }

func (backgroundCtx) String() string {
    return "context.Background"
}

type todoCtx struct{ emptyCtx }

func (todoCtx) String() string {
    return "context.TODO"
}
```

Three zero-sized types. All implementation work is in `emptyCtx`. The two outer types add only a `String()` method for diagnostics.

These structs are zero bytes. The compiler stores them as singletons: every `backgroundCtx{}` literal refers to the same memory slot. `Background()` is effectively a free function.

---

## Background and TODO Constructors

```go
func Background() Context {
    return backgroundCtx{}
}

func TODO() Context {
    return todoCtx{}
}
```

Each returns a literal value. The interface conversion does involve writing 2 words (the iface header: type pointer + data pointer). The Go compiler optimises this enough that, in practice, both functions are very nearly free.

There is a subtle but important detail: even though `backgroundCtx` and `todoCtx` have the *same* shape (both wrap `emptyCtx`), their iface headers point to **different** type metadata. So `Background() == TODO()` is `false`. Useful for type-switch identification.

---

## The CancelFunc Type

```go
type CancelFunc func()
```

A `CancelFunc` is just a function value. The standard library returns closures that call into the underlying `cancelCtx.cancel`.

`CancelCauseFunc` is the variant for cause-bearing cancellations:

```go
type CancelCauseFunc func(cause error)
```

Same shape, takes one argument.

---

## WithCancel and withCancel

```go
func WithCancel(parent Context) (ctx Context, cancel CancelFunc) {
    c := withCancel(parent)
    return c, func() { c.cancel(true, Canceled, nil) }
}

func withCancel(parent Context) *cancelCtx {
    if parent == nil {
        panic("cannot create context from nil parent")
    }
    c := &cancelCtx{}
    c.propagateCancel(parent, c)
    return c
}
```

`withCancel` is the unexported worker. It:

1. Validates `parent != nil`.
2. Allocates a fresh `cancelCtx` (one heap allocation).
3. Calls `propagateCancel(parent, c)` to set up parent linkage.
4. Returns the pointer.

`WithCancel` wraps this in a closure that calls `c.cancel(true, Canceled, nil)`. The closure itself is heap-allocated when it captures `c`. So per `WithCancel`:

| Allocation             | Size (approx) |
|------------------------|---------------|
| `cancelCtx` struct     | ~64 bytes     |
| `CancelFunc` closure   | ~16 bytes     |

Plus whatever `propagateCancel` allocates if it spawns a forwarder goroutine. In the common case (parent is `*cancelCtx`-derived), it allocates zero — the child is added to the parent's existing children map (or that map is allocated if this is the first child).

---

## WithCancelCause

```go
type CancelCauseFunc func(cause error)

func WithCancelCause(parent Context) (ctx Context, cancel CancelCauseFunc) {
    c := withCancel(parent)
    return c, func(cause error) { c.cancel(true, Canceled, cause) }
}
```

Same internals. The difference is the closure takes a `cause error` argument and forwards it to `c.cancel`. After cancellation, `Err()` returns `Canceled` but `Cause(ctx)` returns the supplied cause.

A nil cause is treated specially by `cancel` itself: `if cause == nil { cause = err }`. So calling `cancel(nil)` produces `Cause(ctx) == Canceled` — identical to `WithCancel`'s default.

---

## Cause — the Public Accessor

```go
func Cause(c Context) error {
    if cc, ok := c.Value(&cancelCtxKey).(*cancelCtx); ok {
        cc.mu.Lock()
        defer cc.mu.Unlock()
        return cc.cause
    }
    return c.Err()
}
```

The path:

1. Find the nearest `*cancelCtx` ancestor via the magic-key lookup.
2. If found, take its lock and read `cause`. The lock is necessary because `cause` is a plain field (not atomic) and may be written concurrently with our read.
3. If not found, fall back to `c.Err()`.

Why `Err()` as fallback? So that for chains that have no cancelable ancestor at all (e.g., raw `Background()` plus pure `WithValue` chain), `Cause` still returns *something sensible*. The choice is to mirror `Err`, which would be `nil` in that case anyway.

There is a subtlety with `WithoutCancel`: because `withoutCancelCtx`'s `Value(&cancelCtxKey)` returns `nil`, the lookup fails — but `Err()` also returns `nil` for `withoutCancelCtx`, so the overall return is still `nil`. Consistent.

---

## AfterFunc and afterFuncCtx

```go
func AfterFunc(ctx Context, f func()) (stop func() bool) {
    a := &afterFuncCtx{
        f: f,
    }
    a.cancelCtx.propagateCancel(ctx, a)
    return func() bool {
        stopped := false
        a.once.Do(func() {
            stopped = true
        })
        if stopped {
            a.cancel(true, Canceled, nil)
        }
        return stopped
    }
}

type afterFuncer interface {
    AfterFunc(func()) func() bool
}

type afterFuncCtx struct {
    cancelCtx
    once sync.Once // either starts running f or stops f from running
    f    func()
}

func (a *afterFuncCtx) cancel(removeFromParent bool, err, cause error) {
    a.cancelCtx.cancel(false, err, cause)
    if removeFromParent {
        removeChild(a.Context, a)
    }
    a.once.Do(func() {
        go a.f()
    })
}
```

Three allocations per `AfterFunc`:

1. `afterFuncCtx` struct (the larger struct because it embeds `cancelCtx`).
2. The `stop` closure.
3. Potential children-map entry on the parent (one map slot).

If the parent is uncancellable (like `Background`), `propagateCancel` returns immediately, the AfterFunc is effectively dead (it can never fire), and `stop()` always returns `true`. Calling `AfterFunc(context.Background(), f)` is a programmer error in spirit — it allocates but never fires.

### The Goroutine That Runs `f`

Inside `afterFuncCtx.cancel`:

```go
a.once.Do(func() {
    go a.f()
})
```

The `go` statement spawns a new goroutine to run `f`. Why not run inline?

Because `cancel` is being called inside the parent's cancel cascade, while holding the parent's mutex. If `f` blocked on anything that the parent's cancellation also wanted, you would deadlock. The new goroutine breaks the lock chain.

Cost: one goroutine creation per fire. Bounded.

---

## stopCtx Bridge

```go
type stopCtx struct {
    Context
    stop func() bool
}
```

Used internally by `propagateCancel`'s `afterFuncer` branch. It wraps the parent and remembers the `stop` function returned by the parent's `AfterFunc`. `removeChild` uses this to unregister:

```go
if s, ok := parent.(stopCtx); ok {
    s.stop()
    return
}
```

`stopCtx` is the only context type that is **not** seen by user code at all — it lives entirely inside the propagation graph as a wrapper around `c.Context`.

---

## The cancelCtxKey Sentinel

```go
var goroutines atomic.Int32

var cancelCtxKey int
```

Two package-globals.

`goroutines` counts the lifetime number of forwarder goroutines spawned by the slow path. Used by tests to verify that the fast path is taken when expected.

`cancelCtxKey` is an unexported `int`. Its **address** — `&cancelCtxKey` — is used as a private context key. The address is unique to this package; no other package can produce it (the variable is unexported). It is the keystone of the package's reflection-free type recognition.

This is a clever pattern: a sentinel key whose identity is enforced by the language's address-of-package-variable semantics. Worth borrowing in your own library code.

---

## parentCancelCtx Walkthrough

```go
func parentCancelCtx(parent Context) (*cancelCtx, bool) {
    done := parent.Done()
    if done == closedchan || done == nil {
        return nil, false
    }
    p, ok := parent.Value(&cancelCtxKey).(*cancelCtx)
    if !ok {
        return nil, false
    }
    pdone, _ := p.done.Load().(chan struct{})
    if pdone != done {
        return nil, false
    }
    return p, true
}
```

Three guards:

1. **Done is closedchan or nil.** A `closedchan` parent is already canceled; we should not register with it. A nil-Done parent has no cancellation source. Either way, the slow path is unnecessary because the child either cancels immediately or is unbound from the parent. Returning `(nil, false)` causes `propagateCancel` to handle each case correctly in subsequent branches.
2. **No `*cancelCtx` in the chain.** Either the chain is pure-value (no cancellation at all — unusual but possible) or it is a custom type that does not expose a `cancelCtx` via the magic key. Slow path.
3. **The discovered cancelCtx's `done` channel does not match the parent's.** Someone wrapped the cancelCtx and overrode `Done()` to return a different channel. We cannot register on the inner cancelCtx because cancelling the outer one would not close the inner's done channel. Slow path.

All three checks are O(1) given that `Value(&cancelCtxKey)` is O(depth). The whole function runs in time proportional to the chain depth of the parent — which is fine because we are about to use the result for as long as the child exists.

---

## removeChild Walkthrough

```go
func removeChild(parent Context, child canceler) {
    if s, ok := parent.(stopCtx); ok {
        s.stop()
        return
    }
    p, ok := parentCancelCtx(parent)
    if !ok {
        return
    }
    p.mu.Lock()
    if p.children != nil {
        delete(p.children, child)
    }
    p.mu.Unlock()
}
```

Two paths:

1. **Parent is a `stopCtx`** (registered via `afterFuncer`) — call `s.stop()` to unregister the callback. The parent's `AfterFunc` machinery will no longer wake us.
2. **Parent is a recognised `*cancelCtx`** — take its mutex, delete this child from its map. Note `if p.children != nil` — the parent may have already cancelled (which sets `children = nil`). In that case there is nothing to delete; do nothing.

This is the only place outside of `cancelCtx.cancel` that mutates `p.children`. The contract: external cancellation removes the child; internal cascade nukes the entire map.

---

## canceler Interface and closedchan

```go
type canceler interface {
    cancel(removeFromParent bool, err, cause error)
    Done() <-chan struct{}
}

var closedchan = make(chan struct{})

func init() {
    close(closedchan)
}
```

`canceler` is the unexported interface used internally for "things that can be canceled directly." Implementations: `*cancelCtx`, `*timerCtx`, `*afterFuncCtx`. Not user types.

`closedchan` is a single pre-closed channel. The package's `init()` function closes it on package load. From then on, receiving from `closedchan` returns immediately. It is the shared "already done" channel that all canceled-but-never-observed contexts borrow.

The first call to `make(chan struct{})` in `init` allocates a few dozen bytes for the hchan structure. After that, every `cancelCtx.cancel` that finds `c.done.Load() == nil` substitutes this one shared channel.

---

## cancelCtx — Field by Field

```go
type cancelCtx struct {
    Context

    mu       sync.Mutex            // protects following fields
    done     atomic.Value          // of chan struct{}, created lazily,
                                   // closed by first cancel call
    children map[canceler]struct{} // set to nil by the first cancel call
    err      atomic.Value          // set to non-nil by the first cancel call
    cause    error                 // set to non-nil by the first cancel call
}
```

Size on 64-bit:

| Field      | Bytes |
|------------|-------|
| Context (interface)        | 16 |
| sync.Mutex                 | 8  |
| atomic.Value (done)        | 16 |
| map[canceler]struct{}      | 8 (pointer to hmap) |
| atomic.Value (err)         | 16 |
| error (cause)              | 16 |
| **Total (before padding)** | 80 |

A `cancelCtx` is ~80 bytes. The map header itself is ~48 bytes when non-nil. A `time.Timer` is another ~64 bytes plus the runtime timer record (~88 bytes). Add it up: a `timerCtx` with one registered child costs roughly 280 bytes of heap.

---

## cancelCtx.Value

```go
func (c *cancelCtx) Value(key any) any {
    if key == &cancelCtxKey {
        return c
    }
    return value(c.Context, key)
}
```

Two clauses:

1. If the magic key is requested, return self. This is how `parentCancelCtx` walks back to the nearest cancelCtx.
2. Otherwise, delegate to the `value()` helper to walk up the chain.

The function does **not** match user-defined keys against any local storage. `cancelCtx` does not hold values. (Only `valueCtx` does.)

---

## cancelCtx.Done

```go
func (c *cancelCtx) Done() <-chan struct{} {
    d := c.done.Load()
    if d != nil {
        return d.(chan struct{})
    }
    c.mu.Lock()
    defer c.mu.Unlock()
    d = c.done.Load()
    if d == nil {
        d = make(chan struct{})
        c.done.Store(d)
    }
    return d.(chan struct{})
}
```

Double-checked locking. Lock-free hot path (the first `Load`). Lock-required cold path (allocate the channel).

After `cancel` runs, the stored value is either an allocated-and-closed channel or `closedchan`. Either way, the first `Load` finds a non-nil value and returns it lock-free.

Cost in the hot path: one atomic load, one type-assert. Both are nanoseconds.

---

## cancelCtx.Err

```go
func (c *cancelCtx) Err() error {
    if err := c.err.Load(); err != nil {
        <-c.Done()
        return err.(error)
    }
    return nil
}
```

Note the `<-c.Done()`. After loading a non-nil error, we *receive* from the done channel before returning. This is the lock-free synchronisation barrier that ensures: by the time the caller has a non-nil `Err`, the done channel is also already closed.

Without this barrier, the spec violation "Err non-nil while Done not closed" could be observed by a fast reader on another core. The receive enforces a happens-before that closes the window.

The `<-c.Done()` returns immediately (because the channel is closed). It is a cheap memory-fence operation. Just enough.

---

## cancelCtx.propagateCancel

```go
func (c *cancelCtx) propagateCancel(parent Context, child canceler) {
    c.Context = parent

    done := parent.Done()
    if done == nil {
        return // parent is never canceled
    }

    select {
    case <-done:
        child.cancel(false, parent.Err(), Cause(parent))
        return
    default:
    }

    if p, ok := parentCancelCtx(parent); ok {
        p.mu.Lock()
        if err := p.err.Load(); err != nil {
            child.cancel(false, err.(error), p.cause)
        } else {
            if p.children == nil {
                p.children = make(map[canceler]struct{})
            }
            p.children[child] = struct{}{}
        }
        p.mu.Unlock()
        return
    }

    if a, ok := parent.(afterFuncer); ok {
        c.mu.Lock()
        stop := a.AfterFunc(func() {
            child.cancel(false, parent.Err(), Cause(parent))
        })
        c.Context = stopCtx{
            Context: parent,
            stop:    stop,
        }
        c.mu.Unlock()
        return
    }

    goroutines.Add(1)
    go func() {
        select {
        case <-parent.Done():
            child.cancel(false, parent.Err(), Cause(parent))
        case <-child.Done():
        }
    }()
}
```

The five branches were detailed on the middle and senior pages. The annotations here:

- **Line `c.Context = parent`** — stores the parent. Note this happens *before* any of the bail-out checks. So even if the parent is uncancellable, the child correctly remembers its parent for `Value` traversal.
- **`done := parent.Done()`** — single call, stored in a local. We need it in three places: nil check, racy receive, and channel-identity check inside `parentCancelCtx`. Caching the local avoids three calls (which could each return different channel values for a misbehaving custom type).
- **`select { case <-done: ... default: }`** — non-blocking probe. We are looking for "parent already canceled at this exact moment." The default branch falls through to the registration paths.
- **`if p, ok := parentCancelCtx(parent); ok`** — the fast path.
- **`if a, ok := parent.(afterFuncer); ok`** — the medium path, for custom types that play nicely.
- **`goroutines.Add(1); go func() { ... }`** — the slow path, with goroutine count incremented for tests.

The order of branches is deliberate: each subsequent one is more expensive. The most common — recognised cancelCtx — is checked first and short-circuits.

---

## cancelCtx.cancel

```go
func (c *cancelCtx) cancel(removeFromParent bool, err, cause error) {
    if err == nil {
        panic("context: internal error: missing cancel error")
    }
    if cause == nil {
        cause = err
    }
    c.mu.Lock()
    if c.err.Load() != nil {
        c.mu.Unlock()
        return // already canceled
    }
    c.err.Store(err)
    c.cause = cause
    d, _ := c.done.Load().(chan struct{})
    if d == nil {
        c.done.Store(closedchan)
    } else {
        close(d)
    }
    for child := range c.children {
        // NOTE: acquiring the child's lock while holding parent's lock.
        child.cancel(false, err, cause)
    }
    c.children = nil
    c.mu.Unlock()

    if removeFromParent {
        removeChild(c.Context, c)
    }
}
```

The complete cancel flow. Key invariants:

- The mutex is held for the entire critical section: idempotency check, state mutation, channel close, cascade. The cascade is inside the lock so that no concurrent child registration can occur (`propagateCancel`'s registration is also under this lock).
- `removeChild` runs *after* releasing the mutex. This avoids holding two parent locks (this one and the grand-parent's) simultaneously, which could deadlock if a concurrent cancellation runs in the opposite direction.
- Children are cancelled with `removeFromParent=false`. They will not try to `removeChild` from us, which is correct because we are about to nuke the entire children map.

A typical cancel cascade looks like:

```
cancel(root, true, Canceled, nil)
  | lock root.mu
  | for each child of root:
  |   cancel(child, false, Canceled, nil)
  |     | lock child.mu
  |     | for each grandchild of child:
  |     |   cancel(grandchild, false, ...)
  |     | unlock child.mu
  | root.children = nil
  | unlock root.mu
  | removeChild(root.parent, root)
```

Lock acquisitions cascade downward only. No deadlock possible.

---

## withoutCancelCtx

```go
func WithoutCancel(parent Context) Context {
    if parent == nil {
        panic("cannot create context from nil parent")
    }
    return withoutCancelCtx{parent}
}

type withoutCancelCtx struct {
    c Context
}

func (withoutCancelCtx) Deadline() (deadline time.Time, ok bool) { return }
func (withoutCancelCtx) Done() <-chan struct{}                    { return nil }
func (withoutCancelCtx) Err() error                               { return nil }

func (c withoutCancelCtx) Value(key any) any {
    return value(c, key)
}

func (c withoutCancelCtx) String() string {
    return contextName(c.c) + ".WithoutCancel"
}
```

Allocations: one small `withoutCancelCtx` struct (one interface field, 16 bytes). No mutex, no map, no atomics. The cheapest derived context in the package.

The interesting choice: `Value` is implemented as `value(c, key)` not `value(c.c, key)`. Why? Because we want `value()` to **see** the `withoutCancelCtx` wrapper in its type switch — that is the only way the boundary for `&cancelCtxKey` is enforced. If we delegated to `value(c.c, ...)`, the wrapper would be invisible and the inner cancelCtx would be exposed across the boundary.

---

## WithDeadline and WithDeadlineCause

```go
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
    return WithDeadlineCause(parent, d, nil)
}

func WithDeadlineCause(parent Context, d time.Time, cause error) (Context, CancelFunc) {
    if parent == nil {
        panic("cannot create context from nil parent")
    }
    if cur, ok := parent.Deadline(); ok && cur.Before(d) {
        return WithCancel(parent)
    }
    c := &timerCtx{
        deadline: d,
    }
    c.cancelCtx.propagateCancel(parent, c)
    dur := time.Until(d)
    if dur <= 0 {
        c.cancel(true, DeadlineExceeded, cause)
        return c, func() { c.cancel(false, Canceled, nil) }
    }
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.err.Load() == nil {
        c.timer = time.AfterFunc(dur, func() {
            c.cancel(true, DeadlineExceeded, cause)
        })
    }
    return c, func() { c.cancel(true, Canceled, nil) }
}
```

The four optimisations recap:

1. **Parent's deadline is earlier** → use `WithCancel` instead, no timer.
2. **Deadline is in the past** → cancel immediately, no timer.
3. **Context already canceled by `propagateCancel`** → skip arming the timer.
4. **Timer is armed under the mutex** → so concurrent cancellation from another path correctly observes the canceled state and skips.

The `time.AfterFunc` call schedules a runtime timer. The closure captures `c` and the `cause`. When it fires, it calls `c.cancel(true, DeadlineExceeded, cause)`.

---

## timerCtx Type and Methods

```go
type timerCtx struct {
    cancelCtx
    timer *time.Timer // Under cancelCtx.mu.

    deadline time.Time
}

func (c *timerCtx) Deadline() (deadline time.Time, ok bool) {
    return c.deadline, true
}

func (c *timerCtx) String() string {
    return contextName(c.cancelCtx.Context) + ".WithDeadline(" +
        c.deadline.String() + " [" +
        time.Until(c.deadline).String() + "])"
}

func (c *timerCtx) cancel(removeFromParent bool, err, cause error) {
    c.cancelCtx.cancel(false, err, cause)
    if removeFromParent {
        removeChild(c.cancelCtx.Context, c)
    }
    c.mu.Lock()
    if c.timer != nil {
        c.timer.Stop()
        c.timer = nil
    }
    c.mu.Unlock()
}
```

Embeds `cancelCtx`. Inherits all methods. Overrides `Deadline`, `String`, `cancel`.

Pointer identity matters for `removeChild`: it must pass `c` (the outer `*timerCtx`), not `&c.cancelCtx` (the embedded type), because the parent registered `c` itself.

The `c.timer.Stop()` call returns whether the timer was stopped before firing. We do not check the return value because either way is fine: if the timer already fired, it called `c.cancel(...)` which already returned due to the idempotency check at the top of cancel.

---

## WithTimeout and WithTimeoutCause

```go
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc) {
    return WithDeadline(parent, time.Now().Add(timeout))
}

func WithTimeoutCause(parent Context, timeout time.Duration, cause error) (Context, CancelFunc) {
    return WithDeadlineCause(parent, time.Now().Add(timeout), cause)
}
```

Two-line wrappers. They compute the deadline from the current time and delegate. The cost is identical to `WithDeadline`.

A subtle point: `time.Now()` is the **wall clock**, not monotonic. If the wall clock jumps backward (NTP correction, suspend/resume), the deadline does not move with it — `time.Time` values in Go carry a monotonic reading by default, and `time.Until(d)` uses the monotonic difference. So system clock skew does not corrupt the timeout in practice. (Source: `time.Time` documentation under "Monotonic Clocks".)

---

## WithValue and valueCtx

```go
func WithValue(parent Context, key, val any) Context {
    if parent == nil {
        panic("cannot create context from nil parent")
    }
    if key == nil {
        panic("nil key")
    }
    if !reflectlite.TypeOf(key).Comparable() {
        panic("key is not comparable")
    }
    return &valueCtx{parent, key, val}
}

type valueCtx struct {
    Context
    key, val any
}
```

Three validity checks before constructing. The comparability check uses `reflectlite`. If you pass `[]byte` as a key, you get `panic("key is not comparable")` at construction time, not a deferred mystery at lookup.

The struct itself is three fields: parent (16 bytes), key (16 bytes), val (16 bytes). Total ~48 bytes plus heap header.

---

## The value() Iterative Walker

```go
func value(c Context, key any) any {
    for {
        switch ctx := c.(type) {
        case *valueCtx:
            if key == ctx.key {
                return ctx.val
            }
            c = ctx.Context
        case *cancelCtx:
            if key == &cancelCtxKey {
                return c
            }
            c = ctx.Context
        case withoutCancelCtx:
            if key == &cancelCtxKey {
                return nil
            }
            c = ctx.c
        case *timerCtx:
            if key == &cancelCtxKey {
                return &ctx.cancelCtx
            }
            c = ctx.Context
        case backgroundCtx, todoCtx:
            return nil
        default:
            return c.Value(key)
        }
    }
}
```

Each case is one of:

- **`*valueCtx`** — check the key, return or continue.
- **`*cancelCtx`** — handle magic key, otherwise continue.
- **`withoutCancelCtx`** — handle magic key as **boundary** (return nil), otherwise continue via `ctx.c` (not `ctx.Context`, because withoutCancelCtx names its parent field `c`).
- **`*timerCtx`** — handle magic key, return `&ctx.cancelCtx` (a pointer into the timerCtx so the cancelCtx's `done` and `err` fields are correctly visible).
- **`backgroundCtx, todoCtx`** — terminate.
- **`default`** — for custom types, delegate to `c.Value(key)` and stop iterating. The custom type's implementation is responsible for traversing further.

The `default` case is what makes the package extensible. A custom Context with its own internal data lookups still participates in `value()` — it just has to implement `Value` correctly.

---

## Allocation Accounting Summary

For a complete request handler:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()  // 0 (from server, already exists)

    ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
    defer cancel()
    // Allocations: timerCtx (1), time.Timer (1), CancelFunc closure (1) = 3

    ctx = context.WithValue(ctx, traceKey{}, "abc")
    // Allocations: valueCtx (1) = 1

    ctx = context.WithValue(ctx, userKey{}, 42)
    // Allocations: valueCtx (1) + boxing of int into any (1) = 2

    result, err := doWork(ctx)
    // Inside doWork, more derivations possible
}
```

Total: roughly 6 allocations per request. At 200k QPS, 1.2M allocs/sec just for the context plumbing.

Per-derivation rules of thumb:

| Constructor                | Heap allocations |
|----------------------------|------------------|
| `Background()`             | 0                |
| `TODO()`                   | 0                |
| `WithCancel(p)`            | 2 (cancelCtx, closure) |
| `WithCancelCause(p)`       | 2                |
| `WithTimeout(p, d)`        | 3 (timerCtx, timer, closure) |
| `WithDeadline(p, t)`       | 3                |
| `WithValue(p, k, v)`       | 1 + boxing of v if non-pointer |
| `WithoutCancel(p)`         | 1                |
| `AfterFunc(p, f)`          | 2 (afterFuncCtx, closure) |
| First registration in parent | +1 (children map) |

---

## Performance Characteristics

Big-O of each operation:

| Operation                    | Complexity |
|------------------------------|------------|
| `Background()`, `TODO()`     | O(1)       |
| `WithCancel(p)`              | O(d) for parentCancelCtx walk, then O(1) |
| `WithTimeout(p, d)`          | O(d) like WithCancel + timer arm |
| `WithValue(p, k, v)`         | O(1)       |
| `ctx.Done()`                 | O(1) amortised |
| `ctx.Err()`                  | O(1) hot, O(d) cold (when err non-nil, also receives from chan) |
| `ctx.Deadline()`             | O(d) (walk to nearest timerCtx) |
| `ctx.Value(key)`             | O(d) (walk chain) |
| `cancel()`                   | O(c) where c is the size of the entire subtree (cascade) |
| `Cause(ctx)`                 | O(d)       |

Where `d` = chain depth and `c` = subtree size at cancel time.

The two non-O(1) read operations (`Value` and `Deadline`) both walk the chain. Each step is a type switch + pointer rebind, in the low-nanosecond range. Chain depths in practice are 3-10; even at 30 the cost is sub-microsecond.

The cancel-cascade O(c) is the only operation whose cost grows with subtree size. In well-structured code with tight scopes, subtrees are small (one or two children). The pathological case is a parent that registered thousands of children, all going dormant simultaneously — the cancel will walk all of them. Bounded; correct.

---

## Comparison With Other Runtimes

Re-examining the comparison from the junior page with more depth.

### C++ — `std::stop_token` (C++20)

```cpp
std::stop_source ss;
std::stop_token st = ss.get_token();
// pass `st` to threads
ss.request_stop();  // analogous to cancel()
```

Differences:

- `stop_token` does **not** carry a deadline. Time-based cancellation requires a separate `std::condition_variable_any::wait_for` with a stop token. Two primitives, not one.
- No value propagation. `stop_token` is purely a flag.
- No parent-child tree. Cancellation is flat.

Internally, `stop_state` (the shared state behind `stop_source`/`stop_token`) uses a mutex + condition variable + callback list. Performance-wise similar to Go's `cancelCtx` minus the tree.

### Java — `CompletableFuture` + cancellation

```java
CompletableFuture<Result> f = client.fetchAsync();
f.orTimeout(200, MILLISECONDS);  // sets a deadline
// later:
f.cancel(true);
```

Differences:

- Cancellation in Java is **best-effort**. The thread inside `f` may or may not check. Go's contract is the same in spirit, but `context.Done()` makes the check trivial.
- No value bag. Java uses `ThreadLocal` for that, which doesn't compose with async pipelines.
- Trees of futures exist via `thenCompose` but cancellation does not propagate by default; you must explicitly `whenComplete` and re-cancel.

The Go model is more uniform.

### Rust — `tokio_util::sync::CancellationToken`

```rust
let token = CancellationToken::new();
let child = token.child_token();
// pass child to spawned task
token.cancel();  // both token and child fire
```

Differences:

- Closest analogue to `context.WithCancel` in any modern language. Tree, propagation, parent-child linkage all present.
- No deadline built in; combine with `tokio::time::timeout` for that.
- No value propagation. Rust's `tracing::Span` covers that orthogonally.

Internally, `CancellationToken` uses an `Arc<TreeNode>` with atomic state. Architecturally very similar to Go's `cancelCtx`.

### C# — `CancellationToken` + `CancellationTokenSource`

```csharp
using var cts = new CancellationTokenSource();
cts.CancelAfter(TimeSpan.FromMilliseconds(200));
var token = cts.Token;
await SomeWork(token);
cts.Cancel();
```

Differences:

- Has both flag-based cancellation and time-based via `CancelAfter`.
- `CancellationTokenSource.CreateLinkedTokenSource(t1, t2)` creates a token canceled when either parent is canceled. Equivalent to a small tree.
- No value bag.

C# has the closest API ergonomics to Go's context. Many Go idioms transfer directly.

### Python — `asyncio.Task` cancellation

```python
task = asyncio.create_task(work())
await asyncio.wait_for(task, timeout=0.2)
task.cancel()
```

Differences:

- Cancellation is implemented as throwing `CancelledError` into the task's coroutine. Different mechanism but similar semantics.
- `asyncio.wait_for` wraps a deadline.
- No built-in tree; `TaskGroup` (Python 3.11+) introduces a partial analogue.
- No value bag; `contextvars` covers that.

`contextvars` is interesting: it is Python's response to "request-local values in async code." Same use case as Go's `context.Value`, very different API.

---

## The 2014–2024 Timeline

| Year | Event |
|------|-------|
| 2014 | Sameer Ajmani publishes `golang.org/x/net/context`. Same API as today, plus a few experimental functions. |
| 2014 | The Go team begins using `context` internally for `net/http`, `database/sql`, gRPC. |
| 2016 | `context` package promoted to standard library in Go 1.7. |
| 2016 | gRPC-Go switches to the standard `context.Context`. |
| 2018 | Go 1.10 — `context` package gets `CancelFunc` documentation improvements, no API changes. |
| 2020 | Go 1.16 — `signal.NotifyContext` introduced. |
| 2022 | Go 1.20 — `WithCancelCause` and `Cause(ctx)` introduced. |
| 2023 | Go 1.21 — `AfterFunc`, `WithoutCancel`, `WithDeadlineCause`, `WithTimeoutCause` introduced. |
| 2024 | Go 1.22 — minor doc clarifications; no new API. |

The package has been remarkably stable. Each release-window addition has been backward-compatible. The original 2014 interface and its semantics survive untouched.

---

## Where to Go From Here

Read the rest of the package's tests at `src/context/x_test.go`. They exercise corner cases — concurrent cancellation, nested derivation, timer-vs-cancel races — that you cannot easily reproduce from public API alone. Pair them with this walk-through, and you have a complete picture.

Beyond the standard library, the most influential third-party packages built on `context`:

- `golang.org/x/sync/errgroup` — cancelable goroutine groups.
- `golang.org/x/sync/semaphore` — context-aware bounded concurrency.
- `go.opentelemetry.io/otel/trace` — values-in-context for tracing spans.
- `google.golang.org/grpc` — gRPC deadlines, propagated over the wire as HTTP/2 headers.

Each one builds on the same eight types we walked through. Knowing the internals lets you read them critically and contribute fixes.

Next: [specification.md](specification.md) — the formal contract every implementation must obey.
