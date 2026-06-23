# Context Internals — Middle

[← Back to index](index.md)

## Table of Contents
1. [From Users to Implementers](#from-users-to-implementers)
2. [The cancelCtx Struct in Detail](#the-cancelctx-struct-in-detail)
3. [propagateCancel — The Linker](#propagatecancel--the-linker)
4. [The parentCancelCtx Optimisation](#the-parentcancelctx-optimisation)
5. [The Slow Path: A Forwarder Goroutine](#the-slow-path-a-forwarder-goroutine)
6. [removeChild — Breaking the Link](#removechild--breaking-the-link)
7. [Lazy Done Channel Allocation](#lazy-done-channel-allocation)
8. [The closedchan Trick](#the-closedchan-trick)
9. [Atomic err Plus Mutex — Why Both?](#atomic-err-plus-mutex--why-both)
10. [Walking the cancel Method Step by Step](#walking-the-cancel-method-step-by-step)
11. [How the Children Map Drains](#how-the-children-map-drains)
12. [What Happens on Double Cancel](#what-happens-on-double-cancel)
13. [Reading the cancelCtx Source](#reading-the-cancelctx-source)

---

## From Users to Implementers

At junior level we toured the types from outside. At middle level we trace the actual control flow when you call `context.WithCancel(parent)`. Three things happen, in this order:

1. A `cancelCtx` struct is heap-allocated.
2. `propagateCancel` is called to link this child to its parent.
3. A `CancelFunc` closure is returned.

The first is mundane allocation. The third is a closure that calls `c.cancel(true, Canceled, nil)`. The interesting work is in step two: `propagateCancel` is the function that wires the cancellation tree together, and its implementation choices dominate the package's performance.

We will spend most of this page on that one function — and on the `cancel` method that fires when the wiring eventually pays off.

---

## The cancelCtx Struct in Detail

Reproduced verbatim from `src/context/context.go`:

```go
type cancelCtx struct {
    Context // the embedded parent

    mu       sync.Mutex            // protects following fields
    done     atomic.Value          // of chan struct{}, created lazily,
                                   // closed by first cancel call
    children map[canceler]struct{} // set to nil by the first cancel call
    err      atomic.Value          // set to non-nil by the first cancel call
    cause    error                 // set to non-nil by the first cancel call
}
```

The choice of atomics + mutex is deliberate. The two fields that may need to be read from many goroutines at once — `done` and `err` — are atomics, so reads do not have to take the mutex. The other fields are accessed only when there is a write happening (cancel time, child registration), so the mutex is fine.

Imagine a hot loop:

```go
for ctx.Err() == nil {
    work()
}
```

This is allowed to be **lock-free** because `Err()` is implemented as an atomic load. If `Err` were behind the mutex, every iteration would acquire and release a lock, which would dominate the loop. The atomic+mutex split makes the hot path cheap.

A handy summary:

| Field      | Atomic? | Lock-protected? | Why |
|------------|---------|-----------------|-----|
| `Context`  | No (set once at construction, then immutable) | No | Embedded parent never changes |
| `mu`       | n/a — it *is* the lock | n/a | |
| `done`     | Yes (`atomic.Value`) | Also under mu when storing | Reads must be fast |
| `children` | No | Yes | Mutated only at child register / cancel |
| `err`      | Yes (`atomic.Value`) | Also under mu when storing | `Err()` must be fast |
| `cause`    | No | Yes | Read only via `Cause(ctx)`, which already takes mu |

Why store `err` and `cause` differently? `err` must be read on every `Err()` call (potentially in a hot loop), so atomic. `cause` is read only when somebody explicitly asks via `context.Cause(ctx)`, which is rare — a mutex-protected read is fine.

---

## propagateCancel — The Linker

This is the function that connects a freshly-created child to its parent. Read it carefully:

```go
func (c *cancelCtx) propagateCancel(parent Context, child canceler) {
    c.Context = parent

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
        // parent is a *cancelCtx, or derives from one.
        p.mu.Lock()
        if err := p.err.Load(); err != nil {
            // parent has already been canceled
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
        // parent implements an AfterFunc method.
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

Five branches, each handling a different parent shape. Reading top to bottom:

1. **Parent's `Done()` is `nil`** — parent is `Background`/`TODO` or some similar uncancelable. There is nothing to listen to. Return immediately. The child still functions as a cancel target if its own `CancelFunc` is invoked, but cancellation does not flow down because there is no cancellation to flow.
2. **Parent is already canceled** — the `select { case <-done: }` succeeds. We cancel the child immediately and return. The child never gets registered anywhere because its lifetime has effectively ended.
3. **Parent is a known `*cancelCtx`** (or wraps one in a recognisable way) — `parentCancelCtx(parent)` returns the underlying `*cancelCtx`. We register ourselves in `parent.children` and return. No goroutine spawned.
4. **Parent implements `AfterFunc(func()) func() bool`** — a custom interface. We register a callback. When the parent cancels, our callback fires and cancels us.
5. **Otherwise** — the slow path. Spawn a goroutine that does a two-case select on `parent.Done()` and `child.Done()`. When either fires, we react.

The branches are ordered by frequency: case 3 (recognised `*cancelCtx`) is by far the most common in real code. The slow path is reserved for custom contexts.

---

## The parentCancelCtx Optimisation

The crucial helper:

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

How does this work? Two clever tricks:

### Trick 1: `&cancelCtxKey` as a Sentinel

The package declares an unexported package-level variable:

```go
var cancelCtxKey int
```

Its address — `&cancelCtxKey` — is used as a private context key. The `cancelCtx.Value` method is overridden to return *itself* when this key is queried:

```go
func (c *cancelCtx) Value(key any) any {
    if key == &cancelCtxKey {
        return c
    }
    return value(c.Context, key)
}
```

So `parent.Value(&cancelCtxKey)` walks up the chain (through any `valueCtx` wrappers) until it finds a `cancelCtx`, which returns itself. If the chain has no `cancelCtx`, we get `nil`.

This is how `parentCancelCtx` pierces through arbitrarily many `valueCtx` wrappers to find the innermost real cancelable. It is a brilliant little protocol: the unexported `cancelCtxKey` lets the package do reflection-free type recognition through the `Value` interface.

### Trick 2: The `done` Channel Cross-Check

Even after we have a `*cancelCtx` in hand, we need to ensure it is the *real* cancel source for the parent. Someone might have wrapped a `cancelCtx` in a custom type that overrides `Done()` to return a *different* channel. In that case, we must not register ourselves on the inner `cancelCtx`'s children list — because cancelling the outer wrapper would not flow through to that channel.

The check:

```go
pdone, _ := p.done.Load().(chan struct{})
if pdone != done {
    return nil, false
}
```

Compares the parent's `Done()` channel against the inner `cancelCtx`'s `done` channel. If they match, the cancelable is the authoritative source. If they differ, fall back to the slow path.

This is a beautiful piece of defensive design. It accommodates custom contexts that wrap a `cancelCtx` for their parent but want different cancellation semantics.

---

## The Slow Path: A Forwarder Goroutine

If `parentCancelCtx` returns `(nil, false)` and there's no `AfterFunc` method, we hit:

```go
goroutines.Add(1)
go func() {
    select {
    case <-parent.Done():
        child.cancel(false, parent.Err(), Cause(parent))
    case <-child.Done():
    }
}()
```

This goroutine sits in a `select`. It is parked on two channels:

- The parent's `Done()` — wakes when the parent cancels.
- The child's `Done()` — wakes when the child cancels (so we can exit and stop watching the parent).

When either fires, the goroutine runs once and exits. It is small and bounded.

But it is still a goroutine. Each one costs ~2 KB of stack while parked, plus scheduler bookkeeping. If you derive 100,000 cancelable contexts off a custom-implemented parent, you spawn 100,000 forwarder goroutines.

The package keeps a counter for tests:

```go
var goroutines atomic.Int32
```

You can read it via `runtime/debug` or by inspecting the package's tests. It is incremented each time the slow path fires.

### When Does the Slow Path Fire?

In normal Go code, **never**. Every standard-library context type is recognised by `parentCancelCtx`. The slow path fires only when:

1. You define a **custom type** that implements `context.Context` but does not wrap a recognisable cancelCtx and does not implement `AfterFunc`.
2. You wrap a stdlib context but override `Done()` in a way that changes the channel identity.
3. A testing mock implements the interface without delegating.

For framework authors writing their own context types, this is the most important page in this document.

---

## removeChild — Breaking the Link

When a child cancels, we need to remove it from the parent's `children` map so the parent does not leak references. That is what `removeChild` does:

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

Two cases:

1. **`parent` is a `stopCtx`** — the parent had registered an `AfterFunc` callback for this child. Call `stop()` to unregister it.
2. **`parent` is a recognised `*cancelCtx`** — delete this child from its children map.

Note that the slow-path case is not represented here. The forwarder goroutine handles its own cleanup: when the child's `Done` fires, the goroutine's select takes the `<-child.Done()` branch and the goroutine exits. There is no separate map entry to remove.

### Why removeChild Matters

Without it, every child your code creates would stay in its parent's `children` map *forever*, even after the child completed. Long-running parents (think `context.Background()` plus a top-level cancelCtx in `main`) would accumulate millions of dead children, exhausting memory.

The Go runtime cannot rescue you here. The `children` map holds *live* references — these are not weak references. GC will not collect a child that the parent's map still points to.

This is why **you must call the returned `CancelFunc`**, even when the work completed naturally. Calling it triggers the `removeFromParent=true` branch in `cancel`, which calls `removeChild`. Skipping this is a classic context leak. `go vet -lostcancel` catches it.

---

## Lazy Done Channel Allocation

Let us re-read `Done`:

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

Two reads of `c.done.Load()`. Why?

This is **double-checked locking**. The first read is atomic and lock-free — if the channel already exists, we return without touching the mutex at all. The second read happens inside the lock; it ensures we do not allocate twice if two goroutines race on the first read.

It works because `atomic.Value.Store` and `atomic.Value.Load` are correctly ordered with respect to each other.

### Why Lazy?

Many contexts never have `Done` observed:

- A handler creates `ctx, cancel := context.WithTimeout(...)`, calls a downstream service, the downstream service succeeds *before* the deadline, and we never enter a select on `ctx.Done()`.
- A goroutine derives a context just to pass to a method that takes `context.Context` but does not actually block.

In these cases, the channel allocation would be wasted. Go's standard library habit is to defer allocation until the moment of need; `cancelCtx.Done` is a textbook example.

The cost saved is one `make(chan struct{})`, which is a 96-byte heap allocation plus the runtime channel descriptor. Per-request, small. At 200k req/s, real.

---

## The closedchan Trick

Look at the `cancel` method:

```go
func (c *cancelCtx) cancel(removeFromParent bool, err, cause error) {
    // ...
    d, _ := c.done.Load().(chan struct{})
    if d == nil {
        c.done.Store(closedchan)
    } else {
        close(d)
    }
    // ...
}
```

When `cancel` runs and the channel was never allocated, instead of allocating a fresh closed channel, we substitute the package-global `closedchan`:

```go
var closedchan = make(chan struct{})

func init() {
    close(closedchan)
}
```

This is one channel, closed at package init time. Every cancelled-but-never-observed context shares it.

A later call to `Done()` on a canceled-but-never-observed context returns this shared channel:

```go
d := c.done.Load()
if d != nil {
    return d.(chan struct{}) // returns closedchan
}
```

The caller does not know or care that it is shared. From the outside, a closed channel is a closed channel. Memory saved, behaviour preserved.

This trick — substituting a singleton "already-done" channel — is one of the most economical decisions in the package.

---

## Atomic err Plus Mutex — Why Both?

Why is `err` an `atomic.Value` even though we always store it inside the mutex? Two reasons:

1. **Reads do not need the mutex.** `Err()` is called frequently. Avoiding lock acquisition on the read path is a big win.
2. **`Err` may need to be visible before `cancel` finishes.** Suppose goroutine A calls `cancel`, while goroutine B is in `Err()`. If B reads through the mutex, it might block until A is done. If B reads atomically, B sees the new error as soon as A has stored it — *before* A has finished closing the done channel.

But wait: returning a non-nil `err` *before* the done channel has been closed would violate the spec. The spec says: "If Done is not yet closed, Err returns nil. If Done is closed, Err returns a non-nil error explaining why."

So the implementation has to be careful. Re-read `Err()`:

```go
func (c *cancelCtx) Err() error {
    if err := c.err.Load(); err != nil {
        // Ensure the done channel has been closed before returning a non-nil error.
        <-c.Done()
        return err.(error)
    }
    return nil
}
```

After atomically loading `err`, if it is non-nil, we receive from `Done()` — which forces a "happens-before" relationship: by the time we have received from `Done`, the channel has been closed, which means `cancel` has run the `close(d)` (or stored `closedchan`).

So the invariant *spec said `Done` is closed before `Err` is non-nil* is preserved even though the atomic store and the channel close are technically two separate operations.

This is subtle. It is the kind of code you write only after the race detector has yelled at you a few times.

---

## Walking the cancel Method Step by Step

Here is the full body, annotated:

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

Numbered walk:

1. **Sanity checks** — `err` cannot be `nil`; if `cause` is `nil`, fall back to `err`.
2. **Take the mutex.**
3. **Check idempotency** — if already canceled (`err.Load() != nil`), return. This is what makes `cancel` safe to call repeatedly: subsequent calls are no-ops.
4. **Store the error and cause.**
5. **Close the done channel** — either close the lazily-allocated one or substitute `closedchan`.
6. **Cascade to children** — for each child registered with us, call its `cancel` recursively. The comment notes that we are calling into the child's mutex while holding our own. This is safe because the lock order is always parent-to-child; there is no opposing direction.
7. **Drop the children map** — set to `nil`. This releases references and lets the runtime GC the freed children.
8. **Release the mutex.**
9. **If `removeFromParent` is true** (i.e., this is the *external* cancel call, not a cascading one), remove ourselves from our parent's children map.

The lock-order observation is important. If two cancel calls raced from two unrelated parents trying to cancel overlapping subtrees, we would need a global lock order to avoid deadlock. The package's structure — cancel always cascades down — provides that order naturally.

### Why `removeFromParent` Is Different for Cascading vs External

The argument `removeFromParent` is `true` only when called from the outside (your `CancelFunc` closure). When `cancel` recurses into children, it passes `false` because the parent is about to set `c.children = nil` anyway — there is no point in each child also trying to delete itself from a map that is about to be wiped.

This shaves a lock acquisition per child during cascade. For a wide fan-out, it adds up.

---

## How the Children Map Drains

Walk through this scenario:

```go
root, cancel := context.WithCancel(context.Background())
defer cancel()

for i := 0; i < 1000; i++ {
    sub, _ := context.WithCancel(root)
    go work(sub)
}
```

We register 1000 children in `root.children`. None of the sub-contexts have their `cancel` called (we threw away the cancel func — a bug, but let's continue).

When the work goroutines finish, the sub-contexts become unreachable from user code. But they are still **reachable from `root.children`**. They will not be garbage-collected.

Now `cancel()` runs at the end of the outer function:

1. The root's `cancel` method fires.
2. It cascades into each of the 1000 children, setting their `err` and closing their `done`.
3. It then sets `root.children = nil`.
4. Now the sub-contexts are unreachable from user code *and* from the parent. GC can free them.

So the memory leak (children retained while parent lives) lasts only as long as the parent. If `root` lives for the whole process, those 1000 sub-contexts leak for the whole process. If `root` is short-lived, the leak is bounded.

The lesson: **discarding a `CancelFunc` is only safe if the parent will cancel soon**.

---

## What Happens on Double Cancel

What if you call `cancel()` twice? The idempotency check at the top of `cancel` handles it:

```go
c.mu.Lock()
if c.err.Load() != nil {
    c.mu.Unlock()
    return // already canceled
}
```

The second call takes the mutex, sees that `err` is already non-nil, releases the mutex, and returns. Done channel stays closed. Children map stays nil. Everything is a no-op.

This is why `defer cancel()` is safe even when you call `cancel()` explicitly earlier. Defer always fires; the second invocation is a no-op.

### Cause Semantics on Double Cancel

`WithCancelCause` returns a `CancelCauseFunc` that takes an error. If you call it twice with different causes:

```go
ctx, cancel := context.WithCancelCause(parent)
cancel(errors.New("first reason"))
cancel(errors.New("second reason"))
```

The second call is a no-op. The cause stays "first reason". This is consistent with the `err` semantics — first cancellation wins, subsequent ones are silently dropped.

---

## Reading the cancelCtx Source

Best way to internalise this material: open `src/context/context.go` and read these functions in order:

| Order | Function/Type        | Lines (approx) |
|-------|----------------------|----------------|
| 1     | `Context` interface  | 71-160         |
| 2     | `emptyCtx` + singletons | 181-225     |
| 3     | `WithCancel` + `withCancel` | 240-285 |
| 4     | `parentCancelCtx`    | 382-398        |
| 5     | `removeChild`        | 399-415        |
| 6     | `canceler` interface | 417-422        |
| 7     | `closedchan` + init  | 423-428        |
| 8     | `cancelCtx` type     | 431-442        |
| 9     | `cancelCtx.Value`    | 441-446        |
| 10    | `cancelCtx.Done`     | 448-461        |
| 11    | `cancelCtx.Err`      | 463-473        |
| 12    | `cancelCtx.propagateCancel` | 475-528 |
| 13    | `cancelCtx.cancel`   | 549-580        |

Line numbers drift between Go versions, but the order of definitions is stable. The cumulative reading time is about an hour.

Things to underline as you read:

- The four sync primitives in `cancelCtx`: one mutex, two `atomic.Value`, one `error`, one `map`.
- The five branches in `propagateCancel`.
- The two-level check in `parentCancelCtx`: `Value(&cancelCtxKey)` plus the `done` channel cross-check.
- The `closedchan` substitution in `cancel`.
- The atomic-load-then-receive pattern in `Err`.

Next: [senior.md](senior.md) — `timerCtx`, `valueCtx`, `afterFuncCtx`, `withoutCancelCtx`, and what `Cause` actually looks like underneath.
