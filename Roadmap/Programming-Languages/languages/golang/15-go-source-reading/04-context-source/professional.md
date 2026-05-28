# context — Source Walkthrough

> Focus: a line-by-line read of Go 1.22+ `context/context.go`. The package is a single file (~700 lines), one interface, six concrete types, and one helper. Cancellation propagation, value lookup, and deadline plumbing are implemented with a lazy channel, a `children` set, and a chain walk. Every API surface — `WithCancel`, `WithCancelCause`, `WithDeadline`, `WithTimeout`, `WithValue`, `WithoutCancel`, `AfterFunc`, `Cause` — is a thin wrapper over the same five types. Read the file once with this map and the implementation becomes obvious.

---

## 1. The `Context` interface and package shape

`context` is a single-file standard-library package. The whole API surface is declared in `context.go` (one test file, one X-test file, no internal subpackages). This is deliberate — the package is a contract more than an implementation, and the contract is one interface:

```go
// from context/context.go, simplified
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

Four methods, no extension points, no `Cancel()` on the interface itself. Cancellation is *given to the caller* by the `WithCancel` family, not exposed as a method. That's the entire reason the package works — a callee receives a `Context` and can only observe (`Done`, `Err`, `Deadline`, `Value`); only the constructor's caller can cancel.

The package exposes six concrete types, all unexported:

```
emptyCtx          — Background(), TODO()
cancelCtx         — WithCancel, WithCancelCause
timerCtx          — WithDeadline, WithTimeout (embeds cancelCtx)
valueCtx          — WithValue
withoutCancelCtx  — WithoutCancel  (Go 1.21)
afterFuncCtx      — AfterFunc      (Go 1.21)
```

Every public constructor returns a `Context` interface backed by one of these. The chain a context forms is a linked list of `parent Context` fields; `Value` and cancellation walk that list.

---

## 2. `emptyCtx` — `Background()` and `TODO()`

The two roots of every context tree are the same struct under different identities:

```go
// from context/context.go, simplified
type emptyCtx struct{}

func (emptyCtx) Deadline() (time.Time, bool) { return time.Time{}, false }
func (emptyCtx) Done() <-chan struct{}       { return nil }
func (emptyCtx) Err() error                  { return nil }
func (emptyCtx) Value(any) any               { return nil }

type backgroundCtx struct{ emptyCtx }
type todoCtx struct{ emptyCtx }

func (backgroundCtx) String() string { return "context.Background" }
func (todoCtx) String() string       { return "context.TODO" }

var (
    background = backgroundCtx{}
    todo       = todoCtx{}
)

func Background() Context { return background }
func TODO() Context       { return todo }
```

The struct has no fields — it's a zero-size value. `Done()` returns `nil`, which in Go is a valid `<-chan struct{}` that blocks forever on receive. That's what makes `select { case <-ctx.Done(): ... }` work for a never-cancelled root: the case is permanently unready, never selected.

`Background()` and `TODO()` are byte-for-byte identical at runtime; the type wrappers exist solely so `fmt.Sprint(ctx)` and stack traces can tell them apart. `TODO()` is a documentation marker for "I haven't decided yet" — `errcheck`-style lints can flag it.

---

## 3. `cancelCtx` — the heart of the package

```go
// from context/context.go, simplified
type cancelCtx struct {
    Context                              // parent

    mu       sync.Mutex                  // protects following fields
    done     atomic.Value                // of chan struct{}, created lazily, closed by first cancel call
    children map[canceler]struct{}       // set to nil by the first cancel call
    err      error                       // set to non-nil by the first cancel call
    cause    error                       // set to non-nil by the first cancel call
}

type canceler interface {
    cancel(removeFromParent bool, err, cause error)
    Done() <-chan struct{}
}
```

Five fields, all of them designed around the "cancelled exactly once" invariant:

- `Context` (embedded) — the parent. `cancelCtx` inherits `Deadline()` and `Value()` from this; only `Done()` and `Err()` are overridden.
- `mu` — guards `children`, `err`, `cause`, and the `done` slot's transition from nil to a closed channel.
- `done atomic.Value` — holds a `chan struct{}` *if* anyone called `Done()` or `cancel`. Lazy: a context that's never observed never allocates a channel.
- `children map[canceler]struct{}` — every descendant `canceler` so a parent cancel can fan out. Nil-after-cancel is the "already cancelled" sentinel.
- `err`, `cause` — the cancellation reason. `err` is one of `Canceled`, `DeadlineExceeded`; `cause` is the user-supplied root cause from `CancelCauseFunc`.

The lazy channel is the cleverest piece. `Done()`:

```go
// from context/context.go, simplified
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

Double-checked locking. The fast path is one `atomic.Load`; the slow path acquires `mu` and allocates. Most cancel contexts never have `Done()` called (the goroutine watches the parent), so the channel is never allocated. On a 100-deep tree where only the leaves call `Done`, you save 100× channel allocations.

`Err()` is symmetric but locks unconditionally:

```go
func (c *cancelCtx) Err() error {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.err
}
```

No double-check because `err` is written under the mutex without an atomic flag. A caller that wants race-free fast path uses `<-ctx.Done()` then `Err()`; the channel close *happens-before* the `err` assignment is visible (§12).

---

## 4. `WithCancel` and `WithCancelCause`

The public surface is two lines wrapping a constructor:

```go
// from context/context.go, simplified
func WithCancel(parent Context) (Context, CancelFunc) {
    c := withCancel(parent)
    return c, func() { c.cancel(true, Canceled, nil) }
}

func WithCancelCause(parent Context) (Context, CancelCauseFunc) {
    c := withCancel(parent)
    return c, func(cause error) { c.cancel(true, Canceled, cause) }
}

func withCancel(parent Context) *cancelCtx {
    if parent == nil {
        panic("cannot create context from nil parent")
    }
    c := &cancelCtx{}
    c.Context = parent
    propagateCancel(parent, c)
    return c
}
```

Both produce the same `*cancelCtx`. The only difference is the closure the caller is handed: `CancelFunc` (no argument) versus `CancelCauseFunc` (one error). Both call `c.cancel(true, Canceled, ...)` — `true` means "remove me from my parent's children set" (so a no-op cancel on an already-cancelled subtree doesn't keep the parent's map alive).

`propagateCancel` is where the chain is wired (§5). If `parent.Done()` returns nil — the parent is unobservable, like `Background()` — `propagateCancel` is a no-op. The new context still has its parent's `Deadline`/`Value`, but no one will ever cancel it from above.

---

## 5. `propagateCancel` — the chain walk

```go
// from context/context.go, simplified
func propagateCancel(parent Context, child canceler) {
    done := parent.Done()
    if done == nil {
        return // parent is never canceled
    }
    select {
    case <-done:
        // parent is already canceled
        child.cancel(false, parent.Err(), Cause(parent))
        return
    default:
    }

    if p, ok := parentCancelCtx(parent); ok {
        // parent is a *cancelCtx (possibly via embedding)
        p.mu.Lock()
        if p.err != nil {
            // parent was canceled between the select above and now
            child.cancel(false, p.err, p.cause)
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
        // parent implements an AfterFunc method (1.21+)
        a.AfterFunc(func() {
            child.cancel(false, parent.Err(), Cause(parent))
        })
        return
    }

    // Last resort: spawn a goroutine that watches parent's Done.
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

Three cases, in order of preference:

1. **Parent is a `*cancelCtx`** — register the child in `parent.children`. Cancel propagation is O(1) per child via the map; no goroutines, no channels. The 99% case.
2. **Parent implements `AfterFunc`** — Go 1.21 interface fast-path. A non-stdlib `Context` (an `otelContext`, `gin.Context`, etc.) can opt into efficient propagation by exposing an `AfterFunc` method.
3. **Goroutine fallback** — neither of the above. Spawn a watcher goroutine selecting on `parent.Done()` and `child.Done()`. Costs ~2 KB of stack plus scheduler overhead per `WithCancel` call.

The goroutine case is the one production teams should care about. Wrapping a `context.Context` in your own type (to attach a request ID or a trace span) without exposing the underlying `*cancelCtx` forces every downstream `WithCancel` to spawn a goroutine. A request that creates 50 child contexts costs 50 goroutines just for cancellation watching. Either embed `context.Context` cleanly (so `parentCancelCtx` finds the inner `*cancelCtx`) or implement `AfterFunc` yourself.

The `select { case <-done: default }` check before locking is an optimisation: if the parent is already cancelled, cancel the child synchronously and skip the map insert.

---

## 6. `cancelCtx.cancel` — the central state transition

```go
// from context/context.go, simplified
func (c *cancelCtx) cancel(removeFromParent bool, err, cause error) {
    if err == nil {
        panic("context: internal error: missing cancel error")
    }
    if cause == nil {
        cause = err
    }
    c.mu.Lock()
    if c.err != nil {
        c.mu.Unlock()
        return // already canceled
    }
    c.err = err
    c.cause = cause
    d, _ := c.done.Load().(chan struct{})
    if d == nil {
        c.done.Store(closedchan) // never observed; install pre-closed sentinel
    } else {
        close(d)
    }
    for child := range c.children {
        // NOTE: child.cancel acquires child.mu while we hold c.mu
        child.cancel(false, err, cause)
    }
    c.children = nil
    c.mu.Unlock()

    if removeFromParent {
        removeChild(c.Context, c)
    }
}
```

Five things happen, in order, under `mu`:

1. **Idempotency check** — `c.err != nil` means someone already cancelled. Return.
2. **Set the error** — `c.err`, `c.cause` are written; this is the linearization point.
3. **Signal `Done`** — if a channel was allocated, close it. If not, store the package-level `closedchan` (a `chan struct{}` closed at init) so any later `Done()` call sees a closed channel without allocating.
4. **Cancel children** — iterate `c.children` and recurse. Children are cancelled with `removeFromParent=false` because the whole map is about to be nil'd anyway.
5. **Drop the children map** — `c.children = nil` allows GC to reclaim it.

After unlocking, `removeFromParent` triggers a `removeChild(c.Context, c)` call — this walks up to the nearest `*cancelCtx` ancestor and deletes `c` from its `children`. The `removeFromParent=true` flag is set when the user calls `CancelFunc` directly; it's `false` when cancellation propagates from above (the parent is about to drop the whole map).

The lock-ordering note is critical: this function acquires `c.mu`, then while holding it calls `child.cancel(false, ...)` which acquires `child.mu`. A child cancelling its own subtree only ever locks downward — never the parent. Locks are acquired in tree-traversal order, so no cycle is possible.

`closedchan` is the small but elegant trick:

```go
// from context/context.go, simplified
var closedchan = make(chan struct{})
func init() { close(closedchan) }
```

A pre-closed channel reused forever. A context that's cancelled before anyone calls `Done()` returns this sentinel; zero allocation, zero overhead.

---

## 7. `timerCtx` — `WithDeadline` and `WithTimeout`

```go
// from context/context.go, simplified
type timerCtx struct {
    cancelCtx                // embeds; inherits propagation machinery
    timer    *time.Timer     // under cancelCtx.mu
    deadline time.Time
}

func (c *timerCtx) Deadline() (time.Time, bool) {
    return c.deadline, true
}

func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
    return WithDeadlineCause(parent, d, nil)
}

func WithDeadlineCause(parent Context, d time.Time, cause error) (Context, CancelFunc) {
    if parent == nil { panic("cannot create context from nil parent") }
    if cur, ok := parent.Deadline(); ok && cur.Before(d) {
        // parent's deadline is sooner; no need for a timer.
        return WithCancel(parent)
    }
    c := &timerCtx{
        deadline: d,
    }
    c.cancelCtx.Context = parent
    propagateCancel(parent, c)
    dur := time.Until(d)
    if dur <= 0 {
        c.cancel(true, DeadlineExceeded, cause) // deadline already passed
        return c, func() { c.cancel(false, Canceled, nil) }
    }
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.err == nil {
        c.timer = time.AfterFunc(dur, func() {
            c.cancel(true, DeadlineExceeded, cause)
        })
    }
    return c, func() { c.cancel(true, Canceled, nil) }
}

func WithTimeout(parent Context, t time.Duration) (Context, CancelFunc) {
    return WithDeadline(parent, time.Now().Add(t))
}
```

`timerCtx` is `cancelCtx` plus a `*time.Timer`. Two important details:

- **Deadline tightening only.** If the parent's deadline is already sooner than `d`, the constructor falls back to `WithCancel(parent)` — no timer, no extra cancel machinery. A child with a later deadline than the parent is just a `cancelCtx`. This means a `WithTimeout(ctx, 60*time.Second)` inside a request whose parent has 5 seconds left allocates *no* timer.
- **Already-expired deadline.** If `time.Until(d) <= 0`, the context is cancelled immediately with `DeadlineExceeded`. The `CancelFunc` returned is still valid; calling it is a no-op (idempotent cancel).

`timerCtx` overrides `cancel` to stop the timer:

```go
// from context/context.go, simplified
func (c *timerCtx) cancel(removeFromParent bool, err, cause error) {
    c.cancelCtx.cancel(false, err, cause) // remove from parent below
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

Stop the timer (no-op if already fired) and nil it. The double-`removeChild` interleave is because `cancelCtx.cancel` is called with `removeFromParent=false` — the inner cancel doesn't know about the embedding wrapper, so the outer cancel handles parent removal explicitly.

---

## 8. `valueCtx` — `WithValue` and chain lookup

```go
// from context/context.go, simplified
type valueCtx struct {
    Context        // parent
    key, val any
}

func (c *valueCtx) Value(key any) any {
    if c.key == key {
        return c.val
    }
    return value(c.Context, key)
}

func WithValue(parent Context, key, val any) Context {
    if parent == nil { panic("cannot create context from nil parent") }
    if key == nil    { panic("nil key") }
    if !reflectlite.TypeOf(key).Comparable() {
        panic("key is not comparable")
    }
    return &valueCtx{Context: parent, key: key, val: val}
}
```

One key, one value, one parent pointer. To look up a key, walk up the chain. `value` is the package-level walker:

```go
// from context/context.go, simplified
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
                return nil // a withoutCancelCtx has no associated *cancelCtx
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

The whole chain walk is an iterative type switch — no recursion, no stack growth. Each known stdlib context type advances `c` to its parent and continues; an unknown wrapper falls through to `c.Value(key)` (which may itself walk).

Two interesting cases:

- `cancelCtxKey` is a package-private sentinel. `parentCancelCtx` (§11) uses `parent.Value(&cancelCtxKey)` to locate the nearest `*cancelCtx` ancestor. The switch arms for `*cancelCtx` and `*timerCtx` return the cancel context itself when this special key is queried.
- `withoutCancelCtx` returns `nil` for the cancel-context key, even if its parent has one — that's how `WithoutCancel` blocks cancellation propagation while still letting value lookup pass through.

**Key contract**: keys must be comparable. The package panics in `WithValue` if not. Idiomatic keys are unexported empty struct types, one per package, to avoid collisions.

---

## 9. `withoutCancelCtx` — `WithoutCancel` (Go 1.21)

```go
// from context/context.go, simplified
type withoutCancelCtx struct {
    c Context
}

func (withoutCancelCtx) Deadline() (time.Time, bool) { return time.Time{}, false }
func (withoutCancelCtx) Done() <-chan struct{}       { return nil }
func (withoutCancelCtx) Err() error                  { return nil }
func (w withoutCancelCtx) Value(key any) any         { return value(w, key) }

func WithoutCancel(parent Context) Context {
    if parent == nil { panic("cannot create context from nil parent") }
    return withoutCancelCtx{c: parent}
}
```

A `Context` that inherits *values only*. `Done()` returns `nil` (never fires), `Err()` returns `nil`, `Deadline()` returns the zero value. Value lookup walks through `w.c` via `value(w, key)`.

The use case is a background task whose lifetime is decoupled from the originating request:

```go
go func() {
    bg := context.WithoutCancel(reqCtx) // keep trace IDs, drop cancellation
    if err := writeAuditLog(bg, event); err != nil {
        log.Error(err)
    }
}()
```

Before 1.21, the idiom was `context.Background()` plus manual re-attachment of values. `WithoutCancel` makes the intent explicit and preserves the value chain.

---

## 10. `afterFuncCtx` — `AfterFunc` (Go 1.21)

```go
// from context/context.go, simplified
type afterFuncCtx struct {
    cancelCtx
    once     sync.Once
    f        func()
}

func AfterFunc(ctx Context, f func()) (stop func() bool) {
    a := &afterFuncCtx{f: f}
    a.cancelCtx.Context = ctx
    propagateCancel(ctx, a)
    return func() bool {
        stopped := false
        a.once.Do(func() {
            stopped = true
        })
        if stopped {
            a.cancel(true, removeFromCancelParent, nil)
        }
        return stopped
    }
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

`AfterFunc` registers `f` to run when `ctx` is cancelled. Internally, it builds a fake `cancelCtx` whose `cancel` method, on first invocation, runs `f` in a fresh goroutine. The `stop` returned lets the caller abort registration before `f` fires (via `sync.Once` to ensure `f` runs at most once).

Two important properties:

- `f` is invoked from a *new* goroutine. It does not block the cancelling goroutine, and a panicking `f` will not bring down the canceller — but it will crash the program (no `recover` is installed).
- `stop()` returning `true` means `f` *will not* run. `false` means `f` is already running or has run.

This is the building block teams used to hand-roll before 1.21: "do X when ctx is cancelled" without polling `Done()` in a goroutine.

---

## 11. `parentCancelCtx` — locating the cancel ancestor

```go
// from context/context.go, simplified
var cancelCtxKey int

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

Used by `propagateCancel` (§5) and `removeChild` to find the nearest `*cancelCtx` ancestor. The trick: every stdlib context type implements `Value(&cancelCtxKey)` to return its nearest enclosing `*cancelCtx` (see §8's switch). So one call to `parent.Value(&cancelCtxKey)` walks the chain and returns the right pointer.

The double-check `pdone != done` exists because a user could wrap a `*cancelCtx` in a custom type that re-implements `Done()` to return a different channel. In that case, the canceller would close `p.done` but the wrapper's `Done()` would never fire — they'd be desynchronised. `parentCancelCtx` refuses to register against an ancestor whose `Done` channel doesn't match what the parent claims, falling through to the goroutine watcher.

---

## 12. Race-free patterns

The cancel/done race is the subtlest piece of the package. Two writers can race:

- Goroutine A reads `<-ctx.Done()` (channel close).
- Goroutine A immediately reads `ctx.Err()`.
- Goroutine B was the canceller, running `c.err = err; close(c.done)`.

Without synchronisation, A could see the closed channel but still observe `c.err == nil` (stale read). The package guarantees this doesn't happen via two devices:

1. **`mu` brackets both writes.** `cancel` sets `c.err` *and* installs/closes the `done` channel under `mu`. `Err()` acquires `mu` before reading. So `Err()` either sees the pre-cancel state (`nil`) or the post-cancel state (`err`); never a torn read.
2. **The channel close itself is a happens-before edge.** Go memory model: a `close(ch)` happens-before any `<-ch` returns. So a goroutine that selects on `ctx.Done()` and then reads `ctx.Err()` is guaranteed to see the post-cancel `err` — provided `err` was assigned *before* `close(done)` in the same goroutine.

The implementation orders writes correctly:

```go
c.err = err           // (1) assign first
c.cause = cause       // (2)
close(d)              // (3) close second — happens-before any <-d return
```

This is why the field order inside `cancel` matters and is preserved across versions. Reversing it would break the happens-before guarantee.

The lazy `done atomic.Value` is the other race-sensitive piece. The `atomic.Load`/`atomic.Store` pair ensures a `Done()` reader either sees `nil` (must take the slow path) or a valid channel; never a partially-written interface header.

---

## 13. The goroutine spawned by `propagateCancel`

This is the cost you pay for wrapping `context.Context` poorly. Re-examining §5:

```go
// fallthrough case in propagateCancel
goroutines.Add(1)
go func() {
    select {
    case <-parent.Done():
        child.cancel(false, parent.Err(), Cause(parent))
    case <-child.Done():
    }
}()
```

This goroutine exists for every `WithCancel(parent)` where `parent`:

- Is not a stdlib `*cancelCtx`, `*timerCtx`, etc.
- Does not implement `AfterFunc` (the 1.21+ optimisation).
- Has `parent.Done() != nil` (so it's observable but its cancel chain is invisible to us).

Three costs:

- ~2 KB initial stack per goroutine (grows to ~4–8 KB once `select` machinery runs).
- Scheduler overhead per channel signal.
- The goroutine lives until *either* parent or child is cancelled. A child cancel cleans it up via `<-child.Done()`; if you forget `defer cancel()`, the goroutine leaks until the parent goes.

The `goroutines.Add(1)` is a test-only counter; in production, it's unused. The package tests assert the count goes back to zero, which is how the standard library catches accidental goroutine spawns.

For framework authors: if you wrap a `context.Context` (gin, fiber, gRPC interceptors), embed it directly so `parent.Value(&cancelCtxKey)` succeeds. If you can't (because you want to override `Done()`), implement `AfterFunc(f func()) (stop func() bool)` to opt into the 1.21+ fast path.

---

## 14. Function-style additions: `context.Cause`, `context.AfterFunc`, `context.WithoutCancel`

Newer APIs (1.20+) extend the package without breaking the `Context` interface. They're package-level functions, not methods:

```go
// from context/context.go, simplified
func Cause(c Context) error {
    if cc, ok := c.Value(&cancelCtxKey).(*cancelCtx); ok {
        cc.mu.Lock()
        defer cc.mu.Unlock()
        return cc.cause
    }
    return c.Err()
}
```

`Cause` walks up to the cancel ancestor via the `cancelCtxKey` trick (§11) and reads `cause`. If no cancel ancestor exists, it falls back to `Err()` — for non-cancel-cause contexts, `Cause` and `Err` agree.

`AfterFunc` (§10) and `WithoutCancel` (§9) follow the same pattern: package-level constructors that wrap one of the internal types. The reason for not adding methods to the interface is *backward compatibility* — every third-party `Context` implementation written before 1.20 must still satisfy the interface. Adding methods would break them.

This is also why `Cause` exists rather than `ctx.Cause()`. A third-party `Context` that's never seen a `*cancelCtx` ancestor can't return a meaningful cause; the package-level helper handles the fallback uniformly.

---

## 15. The context tree, visualised

```
                       Background()
                            |
                            v
                    +---------------+
                    | cancelCtx A   |   <- WithCancel(Background())
                    | done:  chan   |
                    | err:   nil    |
                    | child: {B, C} |
                    +---------------+
                       |         |
              +--------+         +--------+
              v                           v
      +---------------+           +---------------+
      | timerCtx B    |           | valueCtx C    |   <- WithValue(A, k, v)
      | cancelCtx     |           | parent: A     |
      | deadline:30s  |           | key: requestID|
      | timer: *Timer |           | val: "xyz-1"  |
      | child: {D}    |           +---------------+
      +---------------+                   |
              |                           v
              v                   +---------------+
      +---------------+           | cancelCtx E   |   <- WithCancel(C)
      | cancelCtx D   |           | parent: C     |
      | parent: B     |           | child: nil    |
      | child: nil    |           +---------------+
      +---------------+

  Cancel propagation (top -> down):
    A.cancel() -> close A.done -> iterate A.children -> B.cancel(), C.cancel()
    B.cancel() -> close B.done, stop B.timer -> iterate B.children -> D.cancel()
    C.cancel() -> close C.done (C is cancelCtx? no, valueCtx -> nothing)
                  Wait: C is valueCtx, not cancelCtx.
                  Cancel does NOT propagate through valueCtx.
                  E was registered with A via parentCancelCtx walk.
                  So actually A.children = {B, E}, NOT {B, C}.

  Corrected: registration walks up via parentCancelCtx until a *cancelCtx is found.
    - B's parent is A -> A.children[B]
    - C's parent is A but C is a valueCtx, not a canceler -> not in any children map
    - E's parent is C (valueCtx); parentCancelCtx(C) walks up via Value(&cancelCtxKey)
      -> finds A -> A.children[E]
    - D's parent is B (timerCtx, which embeds cancelCtx) -> B.children[D]

  Final children sets:
    A.children = {B, E}
    B.children = {D}

  Value lookup (bottom -> up):
    E.Value(requestID)
      -> E is cancelCtx, key != &cancelCtxKey, c = E.Context = C
      -> C is valueCtx, C.key == requestID, return C.val "xyz-1"
```

The tree of *parent pointers* is the inheritance hierarchy: deadline, values, "what is my parent's `Done` channel". The tree of *cancel registrations* (`children` maps) is sparser — only `cancelCtx`/`timerCtx`/`afterFuncCtx` participate. `valueCtx` and `withoutCancelCtx` are transparent to cancellation.

---

## 16. Reading order recommendation

The file is ~700 lines and reads top-to-bottom, but a first read benefits from jumping around. Suggested order:

1. **`Context` interface** (top of file, ~20 lines). The contract.
2. **`emptyCtx` and `Background()`/`TODO()`** (~30 lines). The simplest implementation; baseline for everything else.
3. **`cancelCtx` struct and `Done()`/`Err()`** (~50 lines). The shape of cancellation state.
4. **`cancelCtx.cancel`** (~40 lines). The state transition. Read this with the lock-ordering note (§6) in mind.
5. **`WithCancel` and `WithCancelCause`** (~20 lines). Trivial wrappers; confirms the constructor pattern.
6. **`propagateCancel`** (~50 lines). The chain-walk that ties parents to children.
7. **`parentCancelCtx` and `cancelCtxKey`** (~30 lines). The Value-key trick used everywhere.
8. **`valueCtx` and `WithValue` and the `value(...)` walker** (~60 lines). Value lookup, including how the cancel-key special case works.
9. **`timerCtx` and `WithDeadline`/`WithTimeout`** (~80 lines). Embeds `cancelCtx`; mostly extends `cancel` and adds deadline check.
10. **`withoutCancelCtx` and `WithoutCancel`** (~20 lines). 1.21 addition; teaches by what it doesn't inherit.
11. **`afterFuncCtx` and `AfterFunc`** (~50 lines). 1.21 addition; the `sync.Once` registration pattern.
12. **`Cause`** (~15 lines). Function-style API and how it walks to find the cause.

After this read, the entire file should be transparent: every public function is a thin constructor; every type is one of five shapes; the interesting logic lives in `cancel`, `propagateCancel`, and `value`. The clever bits — lazy channels, `closedchan`, `cancelCtxKey`, the `done` channel identity check in `parentCancelCtx` — are micro-optimisations on top of a small, regular structure.

Pair this read with `runtime/trace` capturing `task.End` events from a real request: you'll see `cancelCtx.cancel` being called recursively down a real tree, with timers stopping and `Done` channels closing. That's the package's whole behaviour, end to end.

---

## Further reading

- `context/context.go` — the single file, Go 1.22+
- `context/x_test.go` — propagation tests including goroutine-leak assertions
- `runtime/trace` — visualise context tree cancellation in real workloads
- Go 1.21 release notes — `WithoutCancel`, `AfterFunc`, `WithDeadlineCause`
- Sameer Ajmani, *Go Concurrency Patterns: Context* (2014) — the original design rationale
- `golang.org/x/net/trace` — historical context predecessor, useful for "why the API looks like this"
- The Go Memory Model — channel-close happens-before semantics that `cancelCtx` relies on
- `google.golang.org/grpc/internal/transport` — production usage of `WithTimeout` chains under load
