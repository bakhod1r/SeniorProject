# Context Internals — Find the Bug

[← Back to index](index.md)

## How to Read This Page

Each numbered section is a Go snippet that compiles and looks plausible but contains a bug rooted in the **internals** of the `context` package. Read the snippet, find the bug, then read the analysis to check yourself.

The bugs progress from "junior would notice" to "only someone who has read the source." All bugs are real — most were observed in production code reviews.

---

## Bug 1 — The Discarded CancelFunc

```go
func startWorker(parent context.Context) {
    ctx, _ := context.WithCancel(parent)
    go func() {
        for {
            select {
            case <-ctx.Done():
                return
            case <-time.After(time.Second):
                doWork()
            }
        }
    }()
}
```

### What's wrong?

The `CancelFunc` is discarded with `_`. This means the new cancelCtx will live in `parent.children` forever — until `parent` itself cancels.

If `parent` is `context.Background()` or a long-lived server context, this is a permanent leak: one `cancelCtx` plus one entry in the parent's children map, per call.

### Internal mechanism

`context.WithCancel(parent)` calls `propagateCancel(parent, child)`. If parent is a recognised `*cancelCtx`, the child is registered in `parent.children[child] = struct{}{}`. Only `child.cancel(true, ...)` followed by `removeChild` removes that entry.

By discarding the cancel func, you remove the only way the entry is ever deleted.

### Fix

```go
ctx, cancel := context.WithCancel(parent)
// ensure cancel is eventually called — pass it into the goroutine
go func() {
    defer cancel()
    // ...
}()
```

`go vet -lostcancel` catches this.

---

## Bug 2 — The Value-Type Receiver

```go
type myCtx struct {
    context.Context
    span string
}

func (m myCtx) Value(key any) any {
    if key == spanKey {
        return m.span
    }
    return m.Context.Value(key)
}

func wrap(ctx context.Context, span string) context.Context {
    return myCtx{Context: ctx, span: span}
}
```

### What's wrong?

This compiles and "works" for value lookup. But when `context.WithCancel(wrap(ctx, "abc"))` is called, `propagateCancel` cannot recognise the underlying cancelCtx through `myCtx`.

Why not? Because `parentCancelCtx` calls `parent.Value(&cancelCtxKey)`. The `myCtx.Value` method only intercepts `spanKey`; for other keys it delegates to `m.Context.Value(key)`. That should pass through.

But there is a second check: `pdone, _ := p.done.Load().(chan struct{}); if pdone != done { return nil, false }`. Here `done == myCtx.Done()`, which is inherited from the embedded `Context` — same as `m.Context.Done()`. So `pdone == done` should hold.

So actually `parentCancelCtx` should succeed. Where is the bug?

### The real bug

Each `myCtx` is a *value*, not a pointer. Every time it is passed through an interface, it is copied. The `m.Context` field is a 16-byte interface header — copying preserves the same underlying type, so `Done()` returns the same channel. So far fine.

But consider this:

```go
ctx := wrap(context.Background(), "abc")
ctx, _ = context.WithCancel(ctx)  // derive a cancelCtx ON TOP of myCtx
ctx = wrap(ctx, "def")            // wrap again
```

Now the outer `myCtx` wraps a `cancelCtx`. When we ask `ctx.Value(&cancelCtxKey)`, the outer `myCtx.Value` delegates to its `Context`, which is the cancelCtx — which returns itself. So far still fine.

The actual subtle bug emerges when the *cancelCtx* is between two layers of `myCtx`:

```go
ctx := wrap(context.Background(), "outer")
ctx, _ := context.WithCancel(ctx)
ctx = wrap(ctx, "inner")  // wraps the cancelCtx
child, _ := context.WithCancel(ctx)
```

`propagateCancel` calls `parentCancelCtx(ctx)`. `ctx.Value(&cancelCtxKey)` walks through the outer myCtx → cancelCtx (which returns itself). Then the channel check: `parent.Done()` returns `myCtx.Done()` which forwards to the embedded cancelCtx's `Done`. Same channel. Both match. Fast path engaged.

So actually this *is* fine. The myCtx implementation pattern works.

### The actual gotcha

The bug is **when** the embedded `Context` is itself a value type like `myCtx`:

```go
inner := wrap(context.Background(), "a")        // value
inner, _ = context.WithCancel(inner)            // pointer
outer := wrap(inner, "b")                       // value, embedding pointer
outer = wrap(outer, "c")                        // value, embedding value, embedding pointer
```

This still works in terms of `parentCancelCtx`. But every `wrap()` allocates a new `myCtx` value, then boxes it into an interface. Each call allocates roughly 32 bytes (struct + iface header). Over a hot path you accumulate many wrapper allocations.

The real fix is to consolidate values:

```go
type myCtx struct {
    context.Context
    span, traceID, userID string
}
```

One wrapper, three fields, one allocation.

---

## Bug 3 — The Inverted `defer cancel()`

```go
func handler() {
    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    if !validate() {
        return
    }
    defer cancel()
    doWork(ctx)
}
```

### What's wrong?

The `defer cancel()` is placed *after* the `validate()` check. If `validate()` returns false, `cancel()` is never called.

Result: the `timerCtx` and its `time.Timer` are leaked until the timer fires (or until process exit).

### Internal mechanism

`context.WithTimeout` constructs a `timerCtx` and arms `time.AfterFunc(dur, func() { c.cancel(true, DeadlineExceeded, cause) })`. This places a record in the runtime's timer heap. The record is removed only when the timer fires or `Stop()` is called.

`Stop()` is called inside `timerCtx.cancel`, which is invoked by the returned `CancelFunc`. Without that call, the timer entry persists for the full 200 ms.

200 ms per leaked context, multiplied by however many requests fail validation, is a measurable backlog in the runtime timer heap. With many such leaks, the timer heap grows and `runtime.timerproc` spends more cycles on bookkeeping.

### Fix

```go
ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
defer cancel()
if !validate() {
    return
}
doWork(ctx)
```

`defer cancel()` immediately after the constructor. Always.

---

## Bug 4 — The Custom Context Without Forwarding

```go
type traceCtx struct {
    parent context.Context
    span   string
}

func (t *traceCtx) Deadline() (time.Time, bool) { return t.parent.Deadline() }
func (t *traceCtx) Done() <-chan struct{}       { return t.parent.Done() }
func (t *traceCtx) Err() error                  { return t.parent.Err() }
func (t *traceCtx) Value(key any) any {
    if key == spanKey {
        return t.span
    }
    return nil  // <-- bug
}
```

### What's wrong?

`Value(key)` returns `nil` for any key other than `spanKey`. It should delegate to `t.parent.Value(key)` for unknown keys.

### Internal consequences

1. **Lookup of any other value fails.** Trace IDs, user IDs, anything previously set with `WithValue` on the parent disappears.
2. **`parentCancelCtx` cannot find the inner cancelCtx.** Because `Value(&cancelCtxKey)` returns nil, any `WithCancel(traceCtx)` falls to the slow path. Every derivation spawns a forwarder goroutine.
3. **`Cause(traceCtx)` returns `Err()` (not the actual cause).** Because the cause lookup walks through `Value(&cancelCtxKey)` and finds nothing.

### Fix

```go
func (t *traceCtx) Value(key any) any {
    if key == spanKey {
        return t.span
    }
    return t.parent.Value(key)  // delegate
}
```

The custom context must always fall back to the parent for unknown keys. Otherwise it severs the value chain.

---

## Bug 5 — The Re-Set Done Channel

```go
type pausableCtx struct {
    context.Context
    done chan struct{}
}

func (p *pausableCtx) Done() <-chan struct{} {
    if p.done == nil {
        p.done = make(chan struct{})
    }
    return p.done
}

func (p *pausableCtx) Pause()  { close(p.done); p.done = make(chan struct{}) }
func (p *pausableCtx) Resume() { /* ... */ }
```

### What's wrong?

The custom `Done()` returns different channel values across calls. This violates the spec: "The returned channel value must be stable."

### Internal consequences

`parentCancelCtx(pausableCtx)` performs:

```go
done := parent.Done()
// ...
pdone, _ := p.done.Load().(chan struct{})
if pdone != done { return nil, false }
```

`pdone` comes from the *inner* cancelCtx's stored channel (if it has one), while `done` comes from the user's overridden `Done()` — which is a freshly-allocated channel different from anything the inner cancelCtx knows about.

Result: the channel identity check fails, slow path engaged, forwarder goroutines pile up.

### Worse consequence

The "pause" mechanism does not work either: closing the channel and replacing it does not un-cancel anything that has already observed the close. Anybody who received from the *old* channel sees it closed forever; anybody who calls `Done()` after `Pause()` gets the *new* channel, which is open.

So a goroutine that called `Done()` before `Pause()` thinks the context is canceled, while a goroutine that called `Done()` after `Pause()` thinks the context is fine. State desynchronisation across observers.

### Fix

Pause/resume is fundamentally incompatible with the Go `Context` interface — `Done` is monotone-closed. Use a separate primitive (a `chan struct{}` with explicit reset semantics, or `sync.Cond`) instead of overloading context.

---

## Bug 6 — The Atomic Err Without Done Synchronisation

```go
type fastCtx struct {
    err atomic.Value  // error
}

func (c *fastCtx) Deadline() (time.Time, bool) { return time.Time{}, false }
func (c *fastCtx) Done() <-chan struct{}       { return c.done }  // assume some channel
func (c *fastCtx) Err() error {
    if err := c.err.Load(); err != nil {
        return err.(error)  // returns immediately without ensuring Done is closed
    }
    return nil
}
func (c *fastCtx) Value(any) any { return nil }
```

### What's wrong?

The `Err()` method returns a non-nil error without first ensuring `Done()` is closed. Spec violation.

### Internal consequences

Suppose two goroutines: G1 sets the error and closes the channel; G2 reads `Err()`.

Race: G1 stores err atomically. G2 loads err — sees non-nil. G2 returns the error to the caller. The caller proceeds assuming the context is canceled.

But G1 hasn't yet closed the done channel. Anyone *else* selecting on `Done()` is still blocked. The system is in an inconsistent state.

In the standard library, the cancelCtx fixes this with:

```go
if err := c.err.Load(); err != nil {
    <-c.Done()  // synchronisation barrier
    return err.(error)
}
```

The `<-c.Done()` forces a happens-before edge that publishes the close.

### Fix

Add the receive:

```go
func (c *fastCtx) Err() error {
    if err := c.err.Load(); err != nil {
        <-c.Done()
        return err.(error)
    }
    return nil
}
```

Or reorder the writes in your cancel path: close the channel **first**, store the err **second**. Then atomic `Load` returning non-nil implies the close has already happened (under TSO memory model; on weaker models you still need a barrier).

---

## Bug 7 — The Background-Derived Detached Job

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    go func() {
        // detached job; do not cancel when request ends
        detached := context.Background()
        if err := audit.Send(detached, r); err != nil {
            log.Printf("audit failed: %v", err)
        }
    }()
}
```

### What's wrong?

The detached goroutine uses `context.Background()` directly. This loses access to:

- The request's trace ID (set with `WithValue`).
- The request's user ID, tenant ID, etc.
- Any propagated tracing span.

The intent — "do not be cancelled when the request ends" — is correct. But discarding the values is collateral damage.

### Internal mechanism

`Background()` returns a singleton `backgroundCtx`. It has no values. `r.Context()` carries an entire chain of `valueCtx`s set by middleware. Switching to `Background()` discards that chain.

### Fix (Go 1.21+)

Use `context.WithoutCancel`:

```go
detached := context.WithoutCancel(r.Context())
```

This strips cancellation but keeps values. The audit log will carry the right trace ID.

Pre-1.21, the workaround was a manual unwrap of specific keys into a fresh context. Ugly. The 1.21 addition solved this exact bug class.

---

## Bug 8 — The Children Map Inside a `select`

```go
func waitForAny(ctx context.Context, chans []<-chan struct{}) error {
    for _, ch := range chans {
        c, _ := context.WithCancel(ctx)
        go func(ch <-chan struct{}) {
            select {
            case <-ch:
            case <-c.Done():
            }
        }(ch)
    }
    // wait for any one to fire ...
}
```

### What's wrong?

For each channel, a new `cancelCtx` is created — and its `CancelFunc` is discarded. Each creates an entry in `ctx.children`.

If `len(chans) == 1000`, you add 1000 entries to the parent's children map. They persist until the parent cancels.

### Internal mechanism

`WithCancel(ctx)` registers each child in `ctx.children`. Discarding the cancel func means each child stays in the map until the parent cancellation cascades.

If the parent is long-lived (e.g., a server's root context), the entries leak permanently. The map grows in O(N) of `waitForAny` calls per call. Eventually millions of entries.

### Fix

```go
for _, ch := range chans {
    c, cancel := context.WithCancel(ctx)
    go func(ch <-chan struct{}, cancel context.CancelFunc) {
        defer cancel()
        select {
        case <-ch:
        case <-c.Done():
        }
    }(ch, cancel)
}
```

Now each goroutine cancels its own context on exit, triggering `removeChild`.

---

## Bug 9 — The Timer Race

```go
func withFreshTimeout(parent context.Context, d time.Duration) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancel(parent)
    timer := time.AfterFunc(d, func() {
        cancel()
    })
    return ctx, func() {
        timer.Stop()
        cancel()
    }
}
```

### What's wrong?

Subtle: when the timer fires after the user has already called the returned `CancelFunc`, the timer's closure tries to `cancel()` again. This is harmless because cancel is idempotent — but `timer.Stop()` returned false in the user's CancelFunc, so the timer was already running. The closure was scheduled on a goroutine inside the runtime timer subsystem, and runs eventually.

The bigger issue: this re-implements `context.WithTimeout` poorly. It allocates an extra layer (cancelCtx + timer) when the package's `WithTimeout` does both in one (timerCtx).

### Internal mechanism

`context.WithTimeout(parent, d)` returns a `*timerCtx` that embeds the cancelCtx and has the timer as a field, under the same mutex. The implementation handles the cancel-vs-fire race correctly inside one struct.

This DIY version uses two separate objects coordinated externally. The race conditions are more subtle:

- `cancel()` is called twice in some race orderings — fine, idempotent.
- `timer.Stop()` in the CancelFunc may return false (timer about to fire), and the timer's closure runs `cancel()` after the user's `cancel()` — still fine.
- But `timer.Stop()` may return true (timer not fired) while the timer's closure is *already running* concurrently — both call `cancel()`, both safe.

### Fix

Just use `context.WithTimeout`:

```go
return context.WithTimeout(parent, d)
```

Don't reinvent. The bug here is "rolling your own primitive when the standard library has a tested one that uses fewer allocations."

---

## Bug 10 — The Misaligned `removeFromParent`

You are implementing a custom Context that embeds `*context.cancelCtx`-style internals. Suppose you have:

```go
type customCtx struct {
    cancelCtxLike
    extra string
}

func (c *customCtx) cancel(removeFromParent bool, err, cause error) {
    c.cancelCtxLike.cancel(true, err, cause)  // <-- bug
    if removeFromParent {
        removeChild(c.parent, c)
    }
}
```

### What's wrong?

Calling the embedded `cancelCtxLike.cancel` with `removeFromParent=true` makes the inner type also try to remove itself from its parent. Then your wrapper *also* calls `removeChild`. Both attempt the same removal.

Worse, in the standard library, the embedded `cancelCtx.Context` stores the parent pointer — which is the *outer* `customCtx`. So the inner cancel's `removeChild` looks for `cancelCtxLike` inside `customCtx`'s parent registration — but the parent registered `customCtx`, not `cancelCtxLike`. The removal fails silently.

The end result: the wrapper is never removed from its parent's children map. Leak.

### Fix

Always pass `false` to the inner cancel and let the outer wrapper handle the parent unlink:

```go
func (c *customCtx) cancel(removeFromParent bool, err, cause error) {
    c.cancelCtxLike.cancel(false, err, cause)
    if removeFromParent {
        removeChild(c.parent, c)
    }
}
```

This is exactly the pattern `timerCtx.cancel` uses. The lesson: when embedding a cancelCtx-like type, never let the embedded type believe it owns the parent relationship.

---

## Bug 11 — The Map Iteration Lock Mistake

You are reimplementing `cancelCtx.cancel` and write:

```go
func (c *cancelCtx) cancel(err error) {
    c.mu.Lock()
    c.err = err
    close(c.done)
    children := c.children
    c.children = nil
    c.mu.Unlock()

    for child := range children {
        child.cancel(err)
    }
}
```

### What's wrong?

You release the mutex before iterating children. A concurrent `propagateCancel` from another goroutine could try to register a new child:

```go
p.mu.Lock()
if err := p.err.Load(); err != nil {
    child.cancel(false, err.(error), p.cause)
} else {
    p.children[child] = struct{}{}  // map is nil here
}
```

The check `p.err.Load() != nil` would pass and the child would be canceled directly, but the order between our setting `err` and them loading it depends on the atomic. If they raced through before our atomic was observable, they could try `p.children[child] = struct{}{}` on a nil map — panic.

Actually no: in this DIY version, we set `c.err` under the mutex, not atomically. So once the mutex is released, the err is observable. The race window is closed.

But wait: we set `children = nil` under the mutex, but the test in `propagateCancel` is `if p.err.Load() != nil` — they look at `err`, not `children`. So once `err` is non-nil, they take the cancel-immediately branch, not the add-to-map branch. Safe.

So actually, this code is mostly correct *as long as the propagateCancel logic checks err before mutating children*. The standard library does this.

### The actual bug

The actual bug is that the cascading `child.cancel(err)` happens *outside* the mutex. Suppose a child is registered (under the parent's mutex), and immediately afterward we cancel the parent. The cancel cascade reads `children` outside the lock — but in this DIY version, we *snapshotted* `children` and nilled the live field under the lock, so we have a stable snapshot.

OK so this code is actually safer than I first claimed. Why might it still be wrong?

### The real issue

The standard library iterates *under* the lock:

```go
for child := range c.children {
    child.cancel(false, err, cause)
}
c.children = nil
c.mu.Unlock()
```

By cascading under the lock, the standard library ensures that all children are canceled before any external observer can do something based on this context's cancellation. Specifically, a child of a child cannot register itself between our atomic err store and our cascade.

In your DIY version, between releasing the lock and iterating the snapshot, a *grandchild* could try to register itself with one of the snapshotted children. The grandchild would see the child as not-yet-canceled (the cascade hasn't reached it), register itself, and *only then* see the cascade hit the parent's child. The grandchild would be canceled correctly but the ordering of observability is weakened.

For most uses this is fine. For strictly-ordered cancel semantics across deep trees, the standard library's lock-held cascade is more conservative.

### Fix

Match the standard library: cascade under the lock:

```go
c.mu.Lock()
c.err = err
close(c.done)
for child := range c.children {
    child.cancel(err)  // recursively takes child's lock
}
c.children = nil
c.mu.Unlock()
```

Acceptable because the lock order (parent first, then child) avoids deadlock.

---

## Bug 12 — The `select` Without `Done`

```go
func wait(ctx context.Context) {
    select {
    case <-time.After(time.Hour):
        log.Println("done waiting")
    }
}
```

### What's wrong?

This goroutine ignores `ctx.Done()`. Even if the context is canceled, it sits for an hour.

### Internal mechanism

Nothing wrong with the `context` internals; the bug is the consumer. But the consequence is that the context's cancellation reaches `ctx.children` but never the goroutine waiting on `time.After`. The goroutine is stuck.

`time.After` itself leaks: a `time.Timer` armed for an hour holds a slot in the timer heap until it fires.

### Fix

```go
select {
case <-time.After(time.Hour):
case <-ctx.Done():
    return
}
```

Or, since `time.After` leaks on cancel, use `time.NewTimer` + `Stop`:

```go
t := time.NewTimer(time.Hour)
defer t.Stop()
select {
case <-t.C:
case <-ctx.Done():
}
```

This is the canonical lesson: contexts work, but only if consumers actually select on `Done`.

---

## Bug 13 — The `WithValue` of an Uncomparable Key

```go
type sliceKey []byte

func setKey(ctx context.Context) context.Context {
    return context.WithValue(ctx, sliceKey{1, 2, 3}, "val")
}
```

### What's wrong?

`[]byte` is not comparable. `WithValue` panics on construction:

```
panic: key is not comparable
```

### Internal mechanism

Inside `WithValue`:

```go
if !reflectlite.TypeOf(key).Comparable() {
    panic("key is not comparable")
}
```

The check is enforced at construction time so that future `Value()` lookups (which use `key == c.key`) do not panic at lookup time with a less helpful message.

### Fix

Use a non-slice key:

```go
type sliceKey struct{}  // empty struct, comparable
// or:
type stringKey string
```

The package documentation strongly recommends using unexported empty structs as keys to avoid both collisions and uncomparable types.

---

## Bug 14 — The Persistent `WithoutCancel` Inside a Loop

```go
func processStream(ctx context.Context, stream <-chan Event) {
    for ev := range stream {
        evCtx := context.WithoutCancel(ctx)
        evCtx, cancel := context.WithTimeout(evCtx, 5*time.Second)
        defer cancel()  // <-- bug
        handle(evCtx, ev)
    }
}
```

### What's wrong?

Two bugs:

1. **`defer cancel()` inside a loop.** Defers accumulate; they only fire when `processStream` returns. For a long-lived stream, you collect `cancel` calls and run them all at the end. Until then, the corresponding `timerCtx`es are not cleaned up.
2. **`WithoutCancel` inside a hot loop** is rarely needed. If the intent was "give each event 5 seconds independently of parent cancellation," then yes — but each event's WithoutCancel allocates a wrapper that survives forever in `ctx.children` (well, no — `WithoutCancel` does not register with the parent; that's the whole point. But the `timerCtx` derived from it does its own thing, independent.)

Actually let me reconsider. `context.WithoutCancel(ctx)` returns a `withoutCancelCtx{c: ctx}`. The returned context's `Done()` is nil. So `propagateCancel` of any further derivation from `evCtx` sees `Done() == nil` and returns early — no registration. Then `WithTimeout(evCtx, 5*time.Second)` allocates a fresh `timerCtx` whose parent (in `c.Context`) is `evCtx` (the `withoutCancelCtx`). No registration in any cancellation tree.

So no children-map leak. The bug is just the `defer cancel()` in a loop.

### Internal consequences

Each iteration defers `cancel()`. Defers run in reverse order at function return. If the stream has 1 million events, you defer 1 million functions. Stack usage grows. More importantly, the corresponding timers (held inside each timerCtx) are not stopped until the very end.

If an event was handled and returned in 100 ms, the timerCtx is still pending until function return. The timer in the runtime timer heap is still alive. For 1M events at 100 ms each (with 5s timeouts), you accumulate up to 50M unstopped timer-seconds in the heap.

### Fix

Move the cleanup into the loop body:

```go
for ev := range stream {
    func() {
        evCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
        defer cancel()
        handle(evCtx, ev)
    }()
}
```

Anonymous function scopes the defer.

---

## Bug 15 — The Forgotten `propagateCancel`

You are writing a custom cancelable context that you want recognized by the standard library's `parentCancelCtx`:

```go
type myCancelCtx struct {
    context.Context
    done chan struct{}
    mu   sync.Mutex
    err  error
}

func (c *myCancelCtx) Done() <-chan struct{} { return c.done }
func (c *myCancelCtx) Err() error            { c.mu.Lock(); defer c.mu.Unlock(); return c.err }

func newMyCancel(parent context.Context) (*myCancelCtx, func()) {
    c := &myCancelCtx{Context: parent, done: make(chan struct{})}
    return c, func() {
        c.mu.Lock()
        if c.err == nil {
            c.err = context.Canceled
            close(c.done)
        }
        c.mu.Unlock()
    }
}
```

### What's wrong?

The custom type does not propagate cancellation from `parent`. If `parent` is canceled, `c.done` does not close.

The standard library's `cancelCtx.propagateCancel` watches the parent and cancels the child when the parent fires. This custom type skips that step.

### Internal mechanism

`propagateCancel` is a method on the *standard library's* `cancelCtx`. Custom types do not get it for free. You must implement equivalent logic yourself:

```go
func newMyCancel(parent context.Context) (*myCancelCtx, func()) {
    c := &myCancelCtx{Context: parent, done: make(chan struct{})}
    if pdone := parent.Done(); pdone != nil {
        go func() {
            select {
            case <-pdone:
                c.cancel(parent.Err())
            case <-c.done:
            }
        }()
    }
    return c, func() { c.cancel(context.Canceled) }
}
```

This is exactly the slow-path forwarder goroutine from the standard library. You re-implement it because your custom type cannot benefit from the standard's children-map registration (which is package-private).

### Fix

Either implement the propagation as shown, or use the standard `context.WithCancel` and store your custom state separately:

```go
type myWrapper struct {
    context.Context
    extra string
}

func wrap(parent context.Context, extra string) (*myWrapper, context.CancelFunc) {
    ctx, cancel := context.WithCancel(parent)
    return &myWrapper{Context: ctx, extra: extra}, cancel
}
```

Now you reuse the standard cancellation machinery and only add your wrapper for state.

---

## Bug 16 — The Race Between `cancel()` and Reading `Cause`

```go
ctx, cancel := context.WithCancelCause(parent)
go func() {
    if err := work(ctx); err != nil {
        cancel(err)
    }
}()
go func() {
    <-ctx.Done()
    log.Println("canceled because:", context.Cause(ctx))
}()
```

### What's wrong?

Nothing — `Cause` is safe to call concurrently. After `Done()` fires, `Cause` is guaranteed to return the same value across calls.

But there is a subtle ordering issue: at the moment `Done()` fires, the `cause` field has *just* been set (under the mutex). The second goroutine reads `Cause(ctx)` which takes the mutex, reads `cause`. Guaranteed consistent.

### So what's the trick?

The trick is that this code is *correct*. The temptation is to assume there's a race because `cause` is plain (non-atomic). But the cancel path holds the mutex while setting `cause`, closing `done`, and releasing the mutex. The Cause read takes the mutex too. Mutex provides the ordering.

If you instead read a snapshot:

```go
go func() {
    <-ctx.Done()
    err := ctx.Err()
    // ...
}()
```

`Err()` is lock-free, but it's also guaranteed to be non-nil after `Done()` closes (via the `<-c.Done()` synchronisation inside `Err`).

So the entire pattern is bug-free. Good.

### The actual bug to spot in similar code

The bug emerges if you call `Cause` *before* `Done` closes:

```go
go func() {
    time.Sleep(10 * time.Millisecond)  // arbitrary timing assumption
    log.Println("cause:", context.Cause(ctx))
}()
```

This may print `<nil>` if cancellation has not happened yet. The lesson is to always select on `Done()` first.

---

## Bug 17 — The Nested Timeout Stack

```go
func handler(ctx context.Context) {
    ctx1, c1 := context.WithTimeout(ctx, 30*time.Second)
    defer c1()
    ctx2, c2 := context.WithTimeout(ctx1, 20*time.Second)
    defer c2()
    ctx3, c3 := context.WithTimeout(ctx2, 10*time.Second)
    defer c3()
    work(ctx3)
}
```

### What's wrong?

Three timer allocations when you only need one (the innermost — 10s — is the only one that matters). The outer two are dominated.

### Internal mechanism

`context.WithTimeout(ctx, 30*time.Second)` allocates a `timerCtx` and arms a `time.Timer`. The 30s deadline is correct.

`context.WithTimeout(ctx1, 20*time.Second)` checks if `ctx1.Deadline()` is before the new deadline. It is (30s now > 20s now). The check fails, so a new `timerCtx` is allocated.

Wait — actually, `WithTimeout` calls `WithDeadline(parent, time.Now().Add(d))`. The check `if cur, ok := parent.Deadline(); ok && cur.Before(d)` compares `cur` (30s from now) with `d` (20s from now). `cur.Before(d)` is false (30s is not before 20s). So this check does not trigger and a new timerCtx is allocated. Hmm wait — let me re-read.

Looking again:

```go
if cur, ok := parent.Deadline(); ok && cur.Before(d) {
    return WithCancel(parent)
}
```

If parent's deadline is *earlier* than the new one (cur.Before(d)), we skip allocating a timer. In our case, parent's deadline is 30s, new is 20s. `cur.Before(d)` is `30s.Before(20s) == false`. So we *do* allocate a timer.

OK so three timers in total, each with a closer deadline. Now consider the case where the new deadline is *later* than the parent's:

```go
ctx1, _ := context.WithTimeout(ctx, 10*time.Second)
ctx2, _ := context.WithTimeout(ctx1, 30*time.Second)  // > parent
```

For ctx2, parent's deadline is 10s, requested is 30s. `cur.Before(d)` is `10s.Before(30s) == true`. So we return `WithCancel(parent)` — no new timer allocated. The 30s is unreachable anyway because the parent will cancel at 10s.

### Back to the original bug

In the original code, three timers fire in order 10, 20, 30 seconds. Each is allocated. The 20 and 30-second ones are dominated by the 10-second one — the 10s timer always cancels the chain first.

### Fix

Just use the innermost timeout:

```go
ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
defer cancel()
work(ctx)
```

Three allocations saved.

---

## Bug 18 — The Goroutine Outliving Its Context

```go
func startReader(ctx context.Context, r io.Reader) <-chan []byte {
    out := make(chan []byte)
    go func() {
        defer close(out)
        buf := make([]byte, 4096)
        for {
            n, err := r.Read(buf)  // blocks indefinitely
            if err != nil {
                return
            }
            out <- buf[:n]
        }
    }()
    return out
}
```

### What's wrong?

`r.Read` does not check `ctx.Done()`. If `ctx` is canceled while we are blocked in `Read`, the goroutine sits forever (until the reader returns an error on its own).

### Internal consequences

The context's children-map entry, if any, gets removed when our outer caller (presumably) cancels its own ctx. But this goroutine continues to live. If `r` is a `net.Conn`, the read may eventually fail with a connection reset, but in tests with a `bytes.Buffer` or similar, the read just returns 0 forever.

### Fix

For `net.Conn`, set a deadline that responds to ctx:

```go
go func() {
    defer close(out)
    if d, ok := ctx.Deadline(); ok {
        if conn, ok := r.(net.Conn); ok {
            conn.SetReadDeadline(d)
        }
    }
    // ...
}()
```

For arbitrary readers, wrap with a context-aware reader:

```go
type ctxReader struct {
    ctx context.Context
    r   io.Reader
}
func (cr *ctxReader) Read(p []byte) (int, error) {
    if err := cr.ctx.Err(); err != nil { return 0, err }
    return cr.r.Read(p)
}
```

This checks before each read but cannot interrupt mid-read.

---

## Reflection

The bugs above are all **upstream of the context package's correctness**. The package is correctly implemented. The bugs are in consumers, custom implementations, or careless use of the standard primitives.

Knowing the internals helps in two ways:

1. **You recognise the bug class faster.** "Discarded cancel" maps directly to "children-map leak" in your head.
2. **You write the fix correctly the first time.** "Forwarder goroutine slow path" maps to "implement `afterFuncer` on your custom type."

Without internals knowledge, the same bugs read as inexplicable production issues with no clean diagnosis.

Next: [optimize.md](optimize.md) — performance work informed by the data structures we just walked.
