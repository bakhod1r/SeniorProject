# Context Tree — Senior

[← Back to index](junior.md)

## Reading the Source

The `context` package is one of the cleanest examples of careful concurrent programming in the standard library. Most of its work happens in three places: the `cancelCtx` struct, the `propagateCancel` function, and the `cancel` method. Once you can read those, you understand the whole tree.

We will reproduce the relevant code in pseudocode (close enough to the real source that you can map line-for-line) and discuss the trade-offs.

### `cancelCtx`

```go
type cancelCtx struct {
    Context // embedded parent

    mu       sync.Mutex            // protects the fields below
    done     atomic.Value          // chan struct{}, lazily allocated
    children map[canceler]struct{} // set to nil after cancel
    err      error                 // set once, under mu
    cause    error                 // since Go 1.20, set with err
}
```

Three lazinesses to notice:

1. **`done` is lazy.** It is only allocated when something calls `Done()`. Many short request-scoped contexts never have a watcher; they don't pay for a channel.
2. **`children` is lazy.** It is allocated on the first call to `propagateCancel` that registers a child.
3. **`cause` is implicit.** If never set, it equals `err`.

`atomic.Value` is used for `done` because `Done()` may be called concurrently with `cancel()`. Atomic load makes that race-free without contesting `mu`.

### The `cancel` method

```go
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
        return // already cancelled — first-write-wins
    }
    c.err = err
    c.cause = cause
    d, _ := c.done.Load().(chan struct{})
    if d == nil {
        c.done.Store(closedchan) // sentinel
    } else {
        close(d)
    }
    for child := range c.children {
        // NOTE: child holds its own mu, so deadlock-free only because
        // we never grab a child's mu while holding parent.mu... except
        // here. The recursion is safe because children form a tree:
        // no cycles, and a child cannot back-cancel its parent.
        child.cancel(false, err, cause)
    }
    c.children = nil
    c.mu.Unlock()

    if removeFromParent {
        removeChild(c.Context, c)
    }
}
```

Key invariants:

- **First-write-wins.** Only the first cancellation sets `err`/`cause`. Later cancellations are no-ops.
- **`closedchan` sentinel.** If nobody ever called `Done()` on this node, the runtime hands out a pre-closed singleton instead of allocating a fresh channel.
- **Children cancel recursively under parent's lock.** This is the load-bearing line. We will look at it more carefully in a moment.
- **`removeFromParent` is `false` during cascade.** When a parent is cancelling its children, there is no need for each child to call `removeChild(parent, child)` — the parent will reset `children = nil` anyway. `removeFromParent = true` only when the cancel is called from user code (the returned `CancelFunc`).

### `propagateCancel`

```go
func propagateCancel(parent Context, child canceler) {
    done := parent.Done()
    if done == nil {
        return // parent is never cancellable (e.g. Background, WithoutCancel)
    }
    select {
    case <-done:
        child.cancel(false, parent.Err(), Cause(parent))
        return
    default:
    }
    if p, ok := parentCancelCtx(parent); ok {
        p.mu.Lock()
        if p.err != nil {
            child.cancel(false, p.err, p.cause)
        } else {
            if p.children == nil {
                p.children = make(map[canceler]struct{})
            }
            p.children[child] = struct{}{}
        }
        p.mu.Unlock()
    } else {
        // Parent is custom; we cannot register in its children map.
        // Spawn a goroutine that forwards the signal.
        go func() {
            select {
            case <-parent.Done():
                child.cancel(false, parent.Err(), Cause(parent))
            case <-child.Done():
            }
        }()
    }
}
```

Two paths:

- **Fast path:** `parent` is a built-in `cancelCtx` (or `timerCtx`, which embeds one). Register the child in `p.children` under `p.mu`. Cost: one map insert.
- **Slow path:** `parent` is a custom `Context`. The runtime cannot reach into a foreign struct, so it spawns a goroutine that selects on `parent.Done()` and the new child's `Done()`. Every derived cancelable child of a custom context spawns one goroutine.

**This is the single biggest reason to avoid implementing your own `Context`.** Wrappers added by middleware (a `Context` that adds a logger, for example) silently turn each request's cancellation tree into a goroutine-per-derive forest.

`parentCancelCtx` is a runtime-internal helper that walks up the parent chain through `valueCtx` nodes (which embed their parent transparently) until it finds a real `cancelCtx`, or returns `(nil, false)` if it cannot find one.

### `removeChild`

```go
func removeChild(parent Context, child canceler) {
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

Called when a user invokes the `CancelFunc` returned by `WithCancel` (or when a timer fires in `timerCtx`). It removes the child from the parent's map so the entry can be GCed.

If you forget `defer cancel()`, the child stays in the parent's map until either the parent cancels or the child is GCed. As long as the parent is reachable, the child is reachable through `parent.children`, so it cannot be GCed. Hence the memory leak.

### `timerCtx`

```go
type timerCtx struct {
    cancelCtx
    timer    *time.Timer
    deadline time.Time
}

func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
    if cur, ok := parent.Deadline(); ok && cur.Before(d) {
        return WithCancel(parent) // first-deadline-wins short-circuit
    }
    c := &timerCtx{
        cancelCtx: newCancelCtx(parent),
        deadline:  d,
    }
    propagateCancel(parent, c)
    if dur := time.Until(d); dur <= 0 {
        c.cancel(true, DeadlineExceeded, nil)
        return c, func() { c.cancel(false, Canceled, nil) }
    }
    c.timer = time.AfterFunc(dur, func() {
        c.cancel(true, DeadlineExceeded, nil)
    })
    return c, func() { c.cancel(true, Canceled, nil) }
}
```

`timerCtx` embeds `cancelCtx`, so its cascade behaviour is identical. The only addition is a `time.Timer` that fires the cancel on deadline expiry. The user-returned `CancelFunc` stops the timer (inside `cancel` via `c.timer.Stop()` — omitted here) and removes the child from its parent.

### `valueCtx`

```go
type valueCtx struct {
    Context // parent
    key, val any
}

func (c *valueCtx) Value(key any) any {
    if c.key == key {
        return c.val
    }
    return c.Context.Value(key)
}
```

`valueCtx` has no cancellation state of its own. `Done()`, `Err()`, and `Deadline()` all delegate to the embedded `Context`. Only `Value` is overridden.

This means: if you call `WithCancel(someValueCtx)`, `propagateCancel` walks up through the `valueCtx` to the *real* parent — the `cancelCtx` somewhere above — and registers there. The cascade ignores `valueCtx` entirely.

`parentCancelCtx` handles this skip:

```go
func parentCancelCtx(parent Context) (*cancelCtx, bool) {
    done := parent.Done()
    if done == closedchan || done == nil {
        return nil, false
    }
    p, ok := parent.Value(&cancelCtxKey).(*cancelCtx)
    // ...
}
```

It uses a sentinel key (`&cancelCtxKey`) that `cancelCtx.Value` answers with `c` itself. So `parent.Value(&cancelCtxKey)` walks through `valueCtx` nodes and returns the nearest `*cancelCtx` ancestor. Elegant.

### `withoutCancelCtx`

```go
type withoutCancelCtx struct {
    c Context
}

func (withoutCancelCtx) Deadline() (time.Time, bool) { return time.Time{}, false }
func (withoutCancelCtx) Done() <-chan struct{}        { return nil }
func (withoutCancelCtx) Err() error                   { return nil }
func (w withoutCancelCtx) Value(key any) any          { return w.c.Value(key) }
```

`WithoutCancel` returns this wrapper. Crucially, `Done()` returns `nil`. When `propagateCancel` runs against a child of `withoutCancelCtx`, it sees `done == nil` and returns immediately — no registration, no watcher. The detached child is a standalone subtree.

`Value` still delegates, so request-scoped values propagate.

### `AfterFunc`

Implemented as a special child:

```go
type afterFuncCtx struct {
    cancelCtx
    once sync.Once
    f    func()
}

func (a *afterFuncCtx) cancel(removeFromParent bool, err, cause error) {
    a.cancelCtx.cancel(false, err, cause)
    if removeFromParent {
        removeChild(a.Context, a)
    }
    a.once.Do(func() { go a.f() })
}

func AfterFunc(ctx Context, f func()) (stop func() bool) {
    a := &afterFuncCtx{f: f}
    a.cancelCtx.Context = ctx
    propagateCancel(ctx, a)
    return func() bool {
        stopped := false
        a.once.Do(func() { stopped = true })
        if stopped {
            removeChild(ctx, a)
        }
        return stopped
    }
}
```

(Real source is more careful; this is for shape.) Two design points:

- The callback is run **in a new goroutine** — so it cannot deadlock the cascade by trying to acquire locks the cascade holds.
- `stop()` uses the same `once` to deregister, racing the callback safely.

If you call `stop()` after the cascade has already fired but before `f` has run, `stop()` returns `false` and `f` still runs. This is intentional: once the runtime has decided to invoke `f`, the user cannot cancel that decision.

## The Race Profile

Several races could happen in a tree under load. The package avoids them with careful invariants.

**Race 1: `Done()` and `cancel()` concurrent.**

```go
go func() { <-ctx.Done() }()
go cancel()
```

`Done()` does an atomic load. `cancel()` takes `mu`, then atomically stores `closedchan` or closes the existing channel. The atomic.Value ensures the reader either gets `nil` (initial), the user-allocated `chan struct{}`, or `closedchan` — never a torn value.

**Race 2: two `cancel()`s on the same node.**

```go
go cancel()
go cancel()
```

Both grab `mu`. The first sets `err`. The second finds `err != nil` and returns. First-write-wins.

**Race 3: child cancellation overlapping parent cancellation.**

Parent cancels at the same instant the user calls `childCancel()`. Both acquire their own `mu`. The parent's cascade calls `child.cancel(false, ...)`, which finds the child already cancelled (because user got there first) — returns. No double-effect, no deadlock.

**Race 4: deadlock between parent.mu and child.mu.**

The parent's cascade holds `parent.mu` while calling `child.cancel(false, ...)`. That call acquires `child.mu`. Could a chain of locks deadlock? No, because:

- Children never lock parents.
- The lock order is strictly *down the tree*.

`removeChild` acquires `parent.mu` from a child's cancel function — but only with `removeFromParent = true`, which the cascade does *not* set. So during cascade, no child reaches up.

## `Cause` Walk

`context.Cause(ctx)` walks up the parent chain looking for the original cancellation cause:

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

The walk uses the same `cancelCtxKey` trick. If the nearest `cancelCtx` ancestor has a cause, return it. Otherwise fall back to `Err()`.

This means `Cause` is O(depth) for the first call and is locked once. A tree of depth 10 incurs about 10 interface-call hops to find the nearest cancel ancestor.

## The Watcher Goroutine for Custom Contexts

We mentioned this in passing; here is the full cost.

Suppose someone wrote:

```go
type loggingCtx struct{ context.Context }
func (loggingCtx) Done() <-chan struct{} { ... } // wraps parent
```

Now every middleware in the chain wraps `req.Context()` in a `loggingCtx`. When the handler derives a child:

```go
ctx, cancel := context.WithCancel(loggingCtxInstance)
```

`parentCancelCtx(loggingCtxInstance)` cannot find a built-in `cancelCtx` directly through `loggingCtx` (because `loggingCtx`'s `Value` method does not answer `&cancelCtxKey` — or if it embeds and forwards, it works). Real-world: many custom contexts don't implement the value forwarding correctly. The runtime falls back to the goroutine path.

For each derive, one goroutine. For a fan-out of 100, 100 goroutines. Multiply by request rate.

The fix: do not implement `Context` yourself. Use `WithValue` to attach data; let the runtime see the real ancestor.

## Tree Depth and Stack

The cascade is implemented with explicit recursion (`for child := range c.children { child.cancel(...) }`). A depth-10 tree uses 10 stack frames per cancel. The Go runtime's stacks grow as needed, but in extreme cases a million-deep tree could cause a stack overflow. Real apps stay well below.

## The `closedchan` Sentinel

```go
var closedchan = make(chan struct{})
func init() { close(closedchan) }
```

A single closed channel shared across the whole process. Any `Done()` call on an already-cancelled node returns this singleton. Two consequences:

- Comparing channels: `if ctx.Done() == closedchan` would work but is internal; user code cannot reach the sentinel.
- Many cancelled contexts share the same `Done()` value. This is by design: a closed channel is always ready, so identity doesn't matter.

## A Worked Example of Cascade Timing

```go
b := context.Background()
p, cancelP := context.WithCancel(b)
a, _ := context.WithCancel(p)
a1, _ := context.WithCancel(a)
a2, _ := context.WithCancel(a)
c, _ := context.WithCancel(p)

cancelP()
```

The runtime path:

1. `cancelP()` calls `p.cancel(true, Canceled, Canceled)`.
2. `p.mu.Lock()`.
3. `p.err = Canceled`. `p.cause = Canceled`.
4. `close(p.done)` (if allocated) or store `closedchan`.
5. Iterate `p.children`. Suppose order is `a, c`.
6. Call `a.cancel(false, ...)`.
   - `a.mu.Lock()`. Set fields. Close `a.done`. Iterate `a.children = {a1, a2}`.
   - Call `a1.cancel(false, ...)`. Lock, set, close. Children empty.
   - Call `a2.cancel(false, ...)`. Lock, set, close. Children empty.
   - `a.children = nil`. Unlock `a`.
7. Call `c.cancel(false, ...)`. Same as above.
8. `p.children = nil`. Unlock `p`.
9. Outer caller: `removeChild(b, p)` (no-op because Background has no children map).

The whole cascade runs on the goroutine that called `cancelP()`. Total time: O(N) under a chain of locks, but each lock is held briefly. For 1000 nodes, the cascade typically completes in tens of microseconds.

## The `Stop()` Decision

When you call `cancel()` on a `timerCtx`, the runtime calls `c.timer.Stop()`. If the timer has already fired (deadline reached), `Stop` returns `false` — the cancellation has already happened. The user's call becomes a no-op via the first-write-wins check.

If the timer is still pending, `Stop` returns `true`. Now the user's cancel proceeds as if it were a plain `WithCancel`'s cancel.

## Production Stories

Two patterns I have seen in production:

### Story 1: Cascade Storm

A pool of 100,000 idle goroutines each held a child context derived from a shared root. Some bug caused the root to cancel every second (a flapping deadline). Each cancel cascaded into 100,000 children, holding `root.mu` for milliseconds. Latency spiked.

The fix was twofold: (1) reduce the cancel rate, (2) flatten the tree so each goroutine derived only when about to do work, not eagerly at startup.

### Story 2: Goroutine Leak via Custom Context

A homemade `Context` wrapper added structured logging fields. Every RPC derived `WithCancel` from it. Each derive spawned a watcher goroutine. Under load the process accumulated millions of goroutines. The fix: drop the custom context, use `WithValue` with a logger key.

## When to Reach for `WithoutCancel` and `AfterFunc`

- **`WithoutCancel`** when a background task must outlive the trigger and you want value propagation. Audit logs, asynchronous notifications, metrics emission.
- **`AfterFunc`** for synchronous resource cleanup — closing a connection, releasing a semaphore — that you used to write as a `<-ctx.Done()` goroutine.

If you are migrating from Go 1.20 or earlier, audit your `<-ctx.Done()` goroutines and replace them with `AfterFunc` where possible.

## Summary

The `cancelCtx`-`propagateCancel`-`cancel` triad is small and elegant. Trees are wired through `children` maps with lazy allocation; cancellation cascades depth-first under per-node mutexes; the only goroutine overhead is the watcher created when the parent is a non-built-in `Context`. Once you have read the source — and we strongly recommend doing so — every subtle behaviour of the API (first-deadline-wins, idempotent cancel, `Cause` propagation, `WithoutCancel` short-circuit) follows from one or two lines of code.
