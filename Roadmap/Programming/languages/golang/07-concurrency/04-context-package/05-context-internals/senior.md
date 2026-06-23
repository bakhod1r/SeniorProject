# Context Internals — Senior

[← Back to index](index.md)

## Table of Contents
1. [Beyond the cancelCtx Workhorse](#beyond-the-cancelctx-workhorse)
2. [timerCtx — Embedding cancelCtx](#timerctx--embedding-cancelctx)
3. [How WithDeadline Picks the Right Timer Time](#how-withdeadline-picks-the-right-timer-time)
4. [The Race Between Timer Fire and Manual Cancel](#the-race-between-timer-fire-and-manual-cancel)
5. [valueCtx — The Linear-Chain Lookup](#valuectx--the-linear-chain-lookup)
6. [The value() Master Function](#the-value-master-function)
7. [withoutCancelCtx — Decoupling Lifetimes](#withoutcancelctx--decoupling-lifetimes)
8. [afterFuncCtx and the AfterFunc Protocol](#afterfuncctx-and-the-afterfunc-protocol)
9. [stopCtx — The Bridge Type](#stopctx--the-bridge-type)
10. [How Cause Actually Works](#how-cause-actually-works)
11. [The Children-Map Memory Story Revisited](#the-children-map-memory-story-revisited)
12. [Reading propagateCancel for Custom Types](#reading-propagatecancel-for-custom-types)

---

## Beyond the cancelCtx Workhorse

The middle page covered `cancelCtx` as the centrepiece. The senior page covers the other five concrete types and the helper functions that make them work together: `timerCtx`, `valueCtx`, `withoutCancelCtx`, `afterFuncCtx`, `stopCtx`, plus `Cause()` and the master `value()` traversal.

Each of these is small. The interesting part is the **interaction** with `cancelCtx` and the runtime — and the design choices that keep them efficient.

---

## timerCtx — Embedding cancelCtx

`WithDeadline` and `WithTimeout` produce a `timerCtx`. The type is dense:

```go
type timerCtx struct {
    cancelCtx
    timer *time.Timer // Under cancelCtx.mu.

    deadline time.Time
}
```

Three things to notice:

1. **It embeds `cancelCtx`, not just *contains* one.** Embedding gives `timerCtx` all the cancellation methods (`Done`, `Err`, plumbing through `propagateCancel`) for free. From the outside, a `timerCtx` *is a* `cancelCtx`.
2. **The timer is "Under cancelCtx.mu."** — a comment, but important. The embedded `cancelCtx`'s mutex protects the timer field too. There is no separate mutex.
3. **The deadline is stored, not just inferred.** Even though the timer knows when it will fire, the deadline is needed by `Deadline()` to satisfy the interface.

Only one method needs to be overridden:

```go
func (c *timerCtx) Deadline() (deadline time.Time, ok bool) {
    return c.deadline, true
}
```

And `cancel` extends the parent's logic to also stop the timer:

```go
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

This method first calls into the embedded `cancelCtx.cancel` with `removeFromParent=false` (because timerCtx will handle the parent unlink itself). Then if `removeFromParent` is true, it calls `removeChild` directly. Finally, it stops the timer.

The reason for *not* propagating `removeFromParent=true` to the embedded cancelCtx's cancel is subtle: the embedded `cancelCtx.Context` is the **parent of the timerCtx itself** (because `propagateCancel` stored it there). If we asked `cancelCtx.cancel` to remove from parent, it would look up `c.Context` and try to remove this `cancelCtx` from the parent's children — but the parent registered the *outer `timerCtx`*, not the embedded `cancelCtx`. The wrapper's identity matters.

So the timerCtx handles the parent unlink with its own pointer:

```go
removeChild(c.cancelCtx.Context, c)  // passing the outer c
```

This is a small but careful detail. Get the pointer identity wrong and the children map gets corrupted.

---

## How WithDeadline Picks the Right Timer Time

```go
func WithDeadlineCause(parent Context, d time.Time, cause error) (Context, CancelFunc) {
    if parent == nil {
        panic("cannot create context from nil parent")
    }
    if cur, ok := parent.Deadline(); ok && cur.Before(d) {
        // The current deadline is already sooner than the new one.
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

Several optimisations layered:

### Optimisation: Skip Timer When Parent Has Earlier Deadline

```go
if cur, ok := parent.Deadline(); ok && cur.Before(d) {
    return WithCancel(parent)
}
```

If the parent's deadline is already earlier than the requested one, the new deadline is never reachable: the parent will cancel first. So we skip allocating a timer entirely and return a plain `WithCancel`. One less timer, one less goroutine on the runtime timer heap, one less callback to schedule.

### Optimisation: Skip Timer When Deadline Has Passed

```go
dur := time.Until(d)
if dur <= 0 {
    c.cancel(true, DeadlineExceeded, cause)
    return c, func() { c.cancel(false, Canceled, nil) }
}
```

If the deadline is already in the past (`d` is before `time.Now()`), there is no point arming a timer for the past. Cancel immediately with `DeadlineExceeded`, return the canceled context.

### The Tiny Race-Free Slot

```go
c.mu.Lock()
defer c.mu.Unlock()
if c.err.Load() == nil {
    c.timer = time.AfterFunc(dur, func() {
        c.cancel(true, DeadlineExceeded, cause)
    })
}
```

After `propagateCancel`, the parent might *already* have cancelled this child (because the parent was already canceled). Between `propagateCancel` returning and us reaching this line, another goroutine could have observed our cancellation. So we check `err.Load() == nil` under the lock before arming the timer.

If the context is already canceled, we skip the timer. No leaked `time.Timer` watching for a deadline that no longer matters.

---

## The Race Between Timer Fire and Manual Cancel

Suppose a deadline is set for 200 ms, and at exactly 200 ms two events happen:

1. The timer fires and calls `c.cancel(true, DeadlineExceeded, cause)`.
2. The user calls the returned `CancelFunc`, which calls `c.cancel(true, Canceled, nil)`.

Which one wins?

Whichever takes the mutex first. The other one sees `err.Load() != nil` at the top of `cancel` and returns immediately. So either `Err()` returns `DeadlineExceeded` or `Canceled`, but never both. The losing call is a no-op.

The package documentation guarantees this: "After Err returns a non-nil error, successive calls to Err return the same error." Race-resistant.

### What About the Timer After Cancel?

Suppose the user calls `cancel()` first. `c.cancel(true, Canceled, nil)` runs:

1. Sees `err.Load() == nil`, takes the path.
2. Stores `err = Canceled`, sets cause, closes done, drops children.
3. Releases mutex.
4. Calls `removeChild`.
5. Then (in the timerCtx-specific override) takes the mutex again to stop the timer.

The mutex round-trip in step 5 is necessary because between releasing the lock in step 3 and acquiring it again in step 5, another goroutine could conceivably interact with `c.timer`. In practice the only such other interaction is the timer firing itself — and if it fires, it tries to take the mutex too, sees `err` is already non-nil, and bails out. The timer's eventual `Stop()` then is a no-op (because the timer either already ran or was already stopped).

The whole dance handles two concurrent cancels (one from each source) without ever leaving an inconsistent state.

---

## valueCtx — The Linear-Chain Lookup

```go
type valueCtx struct {
    Context
    key, val any
}

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
```

Three checks at the top:

1. Parent must be non-nil.
2. Key must be non-nil.
3. Key must be comparable. This uses `reflectlite` (a stripped-down reflect for the runtime) to check the dynamic type's `Comparable()` property. Without this check, looking up the value would panic at runtime with "comparing uncomparable type" — better to fail at `WithValue` time.

The struct itself is tiny: just three fields, all pointer-sized (the embedded `Context` is an interface value, which is two words but the value still fits in 4 words total ignoring alignment).

### `valueCtx.Value` and Tail Recursion

```go
func (c *valueCtx) Value(key any) any {
    if c.key == key {
        return c.val
    }
    return value(c.Context, key)
}
```

The exit pattern is to call `value(c.Context, key)`, an unexported helper that does the actual traversal. Why factor it out? Because the lookup is uniform across all context types — it walks the parent chain looking for a `valueCtx` (or returns the underlying `cancelCtx` if asked for the special `&cancelCtxKey`).

The recursion is into a function, not into `c.Value`. This means the call stack does **not** grow with chain depth: `value()` is an iterative loop, not a recursive function. We'll see that next.

---

## The value() Master Function

This is the heart of context lookup:

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
                // This implements Cause(ctx) == nil
                // when ctx is created using WithoutCancel.
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

Several design points:

### 1. It Is an Iterative Loop

Instead of recursion, `value()` rebinds `c` and loops. Stack depth stays constant. Chain depth of 1,000 contexts costs 1,000 iterations, not 1,000 stack frames.

### 2. Each Type Has a Specialised Case

For `valueCtx`, check the key, possibly return. For `cancelCtx`, intercept the magic `&cancelCtxKey` query. For `timerCtx`, same magic key returns the **embedded** `cancelCtx` pointer — this is how `parentCancelCtx` can find the real cancelable inside a `timerCtx`. For `withoutCancelCtx`, the magic key returns `nil` — this is how `Cause(WithoutCancel(ctx))` returns `nil`.

The `default` case handles custom user types: forward the call to their `Value` method and stop iterating.

### 3. backgroundCtx and todoCtx Terminate

Returning `nil` for these singletons stops the walk. Without this, we would loop forever (well, actually we would call `emptyCtx.Value` which returns `nil`, so it would not loop — but explicitly catching the singletons saves the function call).

### 4. The Magic Key Is the Type-Recognition Mechanism

The `&cancelCtxKey` queries are used internally by `parentCancelCtx` to find the innermost cancelable. They never appear in user code. They are the package's reflection-free way to do typed lookups.

Each path through `value()` is short. The hot path — a deep `valueCtx` chain — does one pointer comparison and one pointer rebind per iteration. At chain depth 10, the function is still nanoseconds.

But it is still O(depth). If you have hundreds of values, you pay.

---

## withoutCancelCtx — Decoupling Lifetimes

Added in Go 1.21. Source:

```go
type withoutCancelCtx struct {
    c Context
}

func (withoutCancelCtx) Deadline() (deadline time.Time, ok bool) { return }
func (withoutCancelCtx) Done() <-chan struct{}                    { return nil }
func (withoutCancelCtx) Err() error                               { return nil }

func (c withoutCancelCtx) Value(key any) any {
    return value(c, key)
}
```

It is a value-type, not a pointer-type — note `(withoutCancelCtx)` not `(*withoutCancelCtx)`. This is intentional: copying is cheap (the struct is just one interface value, two words) and there are no mutable fields.

### Behaviour Walkthrough

| Method     | Returns | Effect |
|------------|---------|--------|
| `Deadline` | zero, false | No deadline |
| `Done`     | `nil`   | Permanently un-cancellable |
| `Err`      | `nil`   | Never errored |
| `Value`    | walks `value()` | Inherits values from parent |

So this context **carries forward all values** but **strips all cancellation**. The relationship between `WithoutCancel(ctx)` and `ctx`:

- Cancellation of `ctx` does **not** propagate to `WithoutCancel(ctx)`.
- Values set on `ctx` (or ancestors) **are** visible to `WithoutCancel(ctx)`.

### How `value()` Handles It

Look at the special case in `value()`:

```go
case withoutCancelCtx:
    if key == &cancelCtxKey {
        return nil
    }
    c = ctx.c
```

When walking the chain *upward* from a child of `WithoutCancel`, if anyone asks for `&cancelCtxKey` (the internal "find me a cancelCtx" sentinel), we return `nil`. This stops the search at the boundary.

Why? Because `WithoutCancel` represents a hard cancellation boundary. A child below it should not be linked to an ancestor cancelCtx via `parentCancelCtx`. If we did not stop the search here, `propagateCancel` would find the grandparent cancelCtx and register the child there — defeating the entire purpose of `WithoutCancel`.

This is one of the most elegant bits of the package: a four-line case that maintains the boundary semantics for free.

---

## afterFuncCtx and the AfterFunc Protocol

`AfterFunc(ctx, f)` schedules `f` to run when `ctx` is canceled. The implementation:

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
    a.once.Do(func() {
        go a.f()
    })
}
```

This is dense. Let us unpack the lifecycle.

### Step 1: Setup

`AfterFunc` constructs an `afterFuncCtx` with the callback `f` stashed. It calls `propagateCancel(ctx, a)` to link this fake "child" context to its parent. Now when the parent cancels, this `afterFuncCtx` will be canceled too, which will trigger its overridden `cancel`.

### Step 2: The Sync.Once Latch

There are two possible outcomes:

- **Parent cancels first.** `propagateCancel`'s wiring fires `a.cancel(...)`. Inside `cancel`, `a.once.Do(func() { go a.f() })` runs — it executes the closure exactly once, spawning a goroutine that runs `f`.

- **User calls `stop()` first.** The closure runs `a.once.Do(func() { stopped = true })`. The `once` is consumed *without* spawning the goroutine. The subsequent `if stopped { a.cancel(...) }` cancels the context to clean up its parent registration.

### Step 3: The Race

If `stop()` and parent cancellation race, the `sync.Once` semantics resolve it: only one of the two closures actually runs (whichever calls `once.Do` first). The losing path runs nothing.

This is the textbook use of `sync.Once`: not for one-time initialisation, but for **at-most-once dispatching of one of two competing actions**.

### What `stop()` Returns

The boolean tells you which side won:

- `true` — `stop()` was first. `f` has not run and never will.
- `false` — `f` either already ran or is about to run on its goroutine.

This lets the caller decide whether to do the cleanup themselves (`true` case) or let the AfterFunc do it (`false` case). The pattern is used by `Lease`-style resource management.

### Why a New Goroutine?

`go a.f()` runs `f` asynchronously. Why? Because we are inside the parent's `cancel` call, holding parent's mutex (the cascade in `cancelCtx.cancel` holds `mu` while iterating children). If `f` did anything blocking — sent on a channel, took a lock — we would block the entire parent's cascade. The goroutine isolates `f` from the cancellation machinery.

The downside is one goroutine per AfterFunc fire. Cheap, but not free. For very hot AfterFunc usage, this is worth knowing.

---

## stopCtx — The Bridge Type

`stopCtx` is the *internal* glue used when `cancelCtx.propagateCancel` encounters a parent that implements the `afterFuncer` interface (a custom `AfterFunc(func()) func() bool` method):

```go
type stopCtx struct {
    Context
    stop func() bool
}
```

Walking `propagateCancel` again:

```go
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
```

This branch is for **user-defined custom contexts** that implement an `AfterFunc` method. The package treats this as a hint: "you can register callbacks with me; please do, instead of spawning a goroutine."

The child's stored parent is rewrapped as a `stopCtx`. This wrapper holds the `stop` function so that `removeChild` can call it:

```go
func removeChild(parent Context, child canceler) {
    if s, ok := parent.(stopCtx); ok {
        s.stop()
        return
    }
    // ...
}
```

When the child is canceled and `removeFromParent=true`, `removeChild` calls `s.stop()` to unregister the callback from the parent's `AfterFunc` mechanism. Clean.

The `afterFuncer` interface is exported documentation-wise (it appears in `AfterFunc`'s godoc) but the type `stopCtx` is unexported. It is an implementation detail of how the package interoperates with custom types.

---

## How Cause Actually Works

`context.Cause(ctx)` is the public accessor:

```go
func Cause(c Context) error {
    if cc, ok := c.Value(&cancelCtxKey).(*cancelCtx); ok {
        cc.mu.Lock()
        defer cc.mu.Unlock()
        return cc.cause
    }
    // There is no cancelCtxKey value, so we know that c is
    // not a descendant of some Context created by WithCancelCause.
    // Therefore, there is no specific cause to return.
    // If this is not one of the standard Context types,
    // it might still have an ancestor created by WithCancelCause.
    // In that case, we return the Err of the context.
    // This serves the purpose of having Cause behave similarly to Err
    // when there is no specific cause.
    return c.Err()
}
```

Two steps:

1. **Walk up the chain to find the nearest `cancelCtx`.** Uses the magic `&cancelCtxKey` trick.
2. **Read its `cause` field** under the mutex (because `cause` is not atomic).

If no `cancelCtx` is in the chain (e.g., we are below a `WithoutCancel` boundary, or there is no cancelable parent at all), fall back to `c.Err()`.

### The withoutCancelCtx Boundary Reappears

Because `withoutCancelCtx`'s `Value` returns `nil` for the magic key (we saw this in `value()`), `Cause(WithoutCancel(parent))` returns `Err()` — which is `nil`. This implements the documented semantic that `WithoutCancel` produces a context whose `Cause` is `nil`.

### Returns Pre-Cancel

Before cancellation, `cause` is `nil` and `Err()` is also `nil`. `Cause` returns `nil`. Consistent with "no cause yet."

### Returns Post-Cancel

After cancellation:

- If `WithCancelCause` was used and a cause was supplied: returns that cause.
- If `WithCancel` was used (no cause): returns `nil` from the mutex-protected read (cause field was never set... wait).

Hmm, let me re-check that last bullet. Look at `cancelCtx.cancel`:

```go
if cause == nil {
    cause = err
}
// ...
c.cause = cause
```

When called via `WithCancel`'s returned `CancelFunc`:

```go
return c, func() { c.cancel(true, Canceled, nil) }
```

…the `cause` passed in is `nil`. But the cancel method substitutes `cause = err`, so `c.cause` becomes `Canceled` (the err). Hence `Cause(ctx)` returns `Canceled` after a plain `WithCancel`-driven cancellation.

For `WithCancelCause`:

```go
return c, func(cause error) { c.cancel(true, Canceled, cause) }
```

If the user passes `cause = errors.New("user cancelled")`, then `c.cause = "user cancelled"`. `Cause(ctx)` returns it. `Err(ctx)` still returns `Canceled`. Two different values for two different questions.

This dual-error design lets you log "deadline exceeded" via `Err` while reporting "user clicked cancel" via `Cause`. Diagnostics improve massively.

---

## The Children-Map Memory Story Revisited

We covered children-map cleanup on the middle page. At senior level, two extra wrinkles:

### Wrinkle 1: The Map Itself Is Allocated Lazily

Look at the relevant branch in `propagateCancel`:

```go
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
```

Note `if p.children == nil { p.children = make(...) }`. The map is created **only when the first child registers**. A `cancelCtx` with no children has a nil map and pays zero map overhead.

This matters: many cancelCtxes never have children. A leaf `WithTimeout` at the bottom of a call chain has no descendants — its map stays nil. No 48-byte hash bucket array allocated.

### Wrinkle 2: The Map Stores `canceler`, Not `Context`

```go
children map[canceler]struct{}
```

`canceler` is the unexported interface:

```go
type canceler interface {
    cancel(removeFromParent bool, err, cause error)
    Done() <-chan struct{}
}
```

Only `*cancelCtx`, `*timerCtx`, and `*afterFuncCtx` implement it. Custom user types do **not** — they cannot satisfy an unexported interface. That is why custom types go down the slow path with a forwarder goroutine.

The map's key being a `canceler` (a small interface, two words) means the map's storage cost is the bucket headers plus 2 words per entry. Reasonable.

---

## Reading propagateCancel for Custom Types

If you implement a custom context, what does `propagateCancel` actually do with it?

### Case A: Your type wraps `*cancelCtx` and forwards `Done()` and `Value(&cancelCtxKey)`

In this case, `parentCancelCtx` succeeds. Your type is treated like an internal `*cancelCtx`. Fast path, no goroutine.

### Case B: Your type returns `nil` from `Done()`

`propagateCancel` sees `done == nil` and returns early. No registration, no goroutine. The child still has its own cancellation source (manual `cancel()` call). Correct behaviour for "I am uncancellable like Background."

### Case C: Your type returns a non-nil `Done()` but does not pass the `parentCancelCtx` check

This is the slow path: forwarder goroutine. Each child you derive will spawn one. If your type is at the top of every request, every `WithCancel(req.Ctx)` derives via the slow path.

Mitigation: implement the `afterFuncer` interface:

```go
type MyContext struct { /* ... */ }

func (m *MyContext) AfterFunc(f func()) (stop func() bool) {
    // register f to run on cancellation
    // return a stop function
}
```

Now `propagateCancel` takes the `afterFuncer` branch — no goroutine, just a callback.

### Case D: Your type embeds `*cancelCtx` directly

```go
type MyContext struct {
    *context.cancelCtx  // wishful — cancelCtx is unexported
}
```

You cannot. `cancelCtx` is unexported. There is no way for user code to get a `*cancelCtx` value into a custom type.

The closest you can come is to *contain* a `cancelable` derived context and forward `Done`, `Err`, `Deadline`, plus `Value` (forwarding the magic key to the inner cancelCtx). If you do this exactly right, `parentCancelCtx` recognises you. This is the technique used by `golang.org/x/net/trace`-style libraries.

The risk: forget one of the methods and you silently fall to the slow path. Every minor Go release I have read the package's tests to verify nothing changed. Worth doing.

---

Next: [professional.md](professional.md) — every type and every method, in order, with allocation accounting.
