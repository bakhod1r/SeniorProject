# Context Tree — Middle

[← Back to index](junior.md)

## From Picture to Mechanism

At junior level we drew the tree and observed that cancellation flows downward. At middle level we ask: *how*? What does the runtime actually do when you call `cancel()`? What does each `With...` function add to the tree, and what does the resulting object look like? Why is there a hidden goroutine in some derivations and not in others?

This file is for the engineer who can already use context but wants to reason about its costs and edge cases at production scale.

## The Five Node Types

A live context can be one of five concrete kinds (plus your own custom implementations, which we discourage).

| Node | Constructor | What it adds |
|------|-------------|--------------|
| `emptyCtx` | `Background()`, `TODO()` | The root. No state. |
| `cancelCtx` | `WithCancel`, `WithCancelCause` | A `Done` channel, an `Err`, optional `cause`, a `children` map. |
| `timerCtx` | `WithTimeout`, `WithDeadline`, `WithDeadlineCause`, `WithTimeoutCause` | Embeds `cancelCtx` + a `time.Timer` + a deadline. |
| `valueCtx` | `WithValue` | A `key`/`value` pair. No cancellation of its own. |
| `withoutCancelCtx` | `WithoutCancel` | Hides the parent's `Done` and `Err`. Keeps values. |

`AfterFunc` does not create a node. It registers a callback on an existing node (typically a `cancelCtx`).

## How a `With...` Call Modifies the Tree

Every cancelable `With...` does three things:

1. Allocates a new struct embedding the parent.
2. Calls `propagateCancel(parent, newNode)` to wire the cancel cascade.
3. Returns the new node and a `cancel` function bound to it.

`propagateCancel` is the workhorse. We will look at it in detail in `senior.md`. For now, the contract is:

> `propagateCancel` arranges that, the moment the parent's `Done()` fires, the new child's `cancel` runs.

When the parent is itself a `cancelCtx` or `timerCtx`, the wiring is purely a map insertion — no goroutine. When the parent is some other kind of `Context` (a custom one, or one wrapped by middleware), `propagateCancel` spawns a watcher goroutine that selects on `parent.Done()` and `child.Done()`. That goroutine is the price of polymorphism.

## Cascading: The Step-by-Step

Suppose your tree is:

```
B (Background)
 |
 P (WithCancel)
 |
 +-- A (WithTimeout)
 |    |
 |    +-- A1 (WithCancel)
 |    +-- A2 (WithValue then WithCancel)
 |
 +-- C (WithCancelCause)
      |
      +-- C1 (WithDeadline)
```

You call `cancelP()`. The runtime executes, in order:

1. Acquires `P.mu`.
2. Sets `P.err = Canceled`, `P.cause = Canceled`.
3. Closes `P.done` (or stores the `closedchan` sentinel if `Done()` had never been called).
4. Iterates `P.children`. The order is map-iteration order — non-deterministic.
5. For each child (say `A`), calls `child.cancel(false, Canceled, Canceled)`.
6. The recursive call locks `A.mu`, sets fields, closes `A.done`, walks `A.children` (so `A1`, `A2`), and so on.
7. Each frame returns; `P.children` is set to `nil` to free memory.
8. `P.mu` is released.

Two consequences worth internalising:

- The cascade runs synchronously on the caller of `cancelP()`. If your tree is huge, your call to `cancel()` is slow.
- The whole subtree is locked under each node's mutex *in turn* (not all at once). There is no global lock.

## First-Deadline-Wins, in Detail

`WithDeadline(parent, t)` checks the parent's deadline first:

```go
if cur, ok := parent.Deadline(); ok && cur.Before(t) {
    // Parent already has an earlier deadline.
    return WithCancel(parent)
}
```

If the parent's deadline is already earlier than `t`, allocating a timer for `t` would be pointless — the parent will cancel first. So Go falls back to a plain `WithCancel`, saving the timer allocation. The returned context still has a deadline (`Deadline()` walks the parent), but no `time.Timer` is started.

When does this matter? Imagine:

```go
req := http.Request{...}
ctx, cancel := context.WithTimeout(req.Context(), 5*time.Second)
defer cancel()

ctx2, cancel2 := context.WithTimeout(ctx, 10*time.Minute)
defer cancel2()
```

`ctx2` looks like it has a 10-minute timeout, but the parent already fires at 5 seconds, so the inner timer is never created. `ctx2.Deadline()` returns the *outer* deadline, not 10 minutes.

The implication: **you cannot extend a deadline by deriving**. To run a task past a parent's deadline, derive a new tree from `Background()` (or use `WithoutCancel`).

## `WithoutCancel` — Detaching From the Tree

`WithoutCancel(parent)` returns a node whose:

- `Done()` returns `nil` — never fires.
- `Err()` returns `nil` always.
- `Deadline()` returns `(time.Time{}, false)`.
- `Value(k)` delegates to `parent`.

You can think of it as: "Same value chain, fresh cancellation slate." It does not unregister anything from the parent — it just exposes a different interface.

You can derive cancellation from a `WithoutCancel`. For example:

```go
detached := context.WithoutCancel(req.Context())
ctx, cancel := context.WithTimeout(detached, 30*time.Second)
defer cancel()
go writeAuditLog(ctx)
```

Now the audit log gets its own 30-second budget, independent of the request.

A subtle point: `WithoutCancel` does not block goroutines that read `parent.Done()`. Those still fire on the original parent's cancellation. Only contexts derived from the `WithoutCancel` node are protected.

## `AfterFunc` — Cleanup Without a Goroutine

```go
stop := context.AfterFunc(ctx, func() {
    db.Close()
})
```

`AfterFunc` registers `f` to run when `ctx` is cancelled. If `ctx` is already cancelled, `f` runs immediately in a new goroutine. The returned `stop` deregisters `f`. `stop()` returns true if it cancelled the pending call, false if `f` had already started.

Internally, `AfterFunc` adds a special kind of child to the `cancelCtx`'s children map — an `afterFuncCtx`. When the parent cancels, the cascade fires this child, which runs `f` in a goroutine. There is no permanent watcher goroutine; the goroutine is spawned only on cancellation.

Compare to the pre-1.21 pattern:

```go
// Old style — costs one goroutine per cleanup, for the life of the context.
go func() {
    <-ctx.Done()
    db.Close()
}()
```

`AfterFunc` is strictly cheaper because the cleanup goroutine doesn't exist until it's needed.

## `WithCancelCause` and the Cause Side-Channel

```go
ctx, cancel := context.WithCancelCause(parent)
cancel(errors.New("upstream timeout"))
```

The `cause` is stored separately from `err`. `Err()` still returns `context.Canceled` for compatibility. `context.Cause(ctx)` returns the cause, walking the tree:

- If this node has a cause, return it.
- Otherwise, walk up the parent chain to find the *closest* cancelled ancestor that has a cause.
- If no ancestor has a cause, return the last cancelled ancestor's `Err()`.

So if a deep child is cancelled by a near ancestor that did not set a cause, but a grand-grand-parent has a cause, you may still get back that ancestor's cause — depending on which ancestor cancelled first.

In practice: set the cause at the point of failure.

```go
func handle(ctx context.Context, req Req) error {
    ctx, cancel := context.WithCancelCause(ctx)
    defer cancel(nil) // nil cause means "no override; use Canceled"

    if err := check(req); err != nil {
        cancel(fmt.Errorf("rejected: %w", err))
        return err
    }
    return do(ctx, req)
}
```

`defer cancel(nil)` is the idiomatic cleanup: it does not override an earlier cause.

## Go 1.21 Additions: `WithDeadlineCause` and `WithTimeoutCause`

These mirror the cause API for deadlines. When the timer fires, the cause is the supplied error instead of `context.DeadlineExceeded`.

```go
ctx, cancel := context.WithTimeoutCause(parent, time.Second, errors.New("slow downstream"))
defer cancel()
<-ctx.Done()
// ctx.Err()   == context.DeadlineExceeded
// Cause(ctx)  == errors.New("slow downstream")
```

This is the cleanest way to attribute timeouts in a fan-in scenario where many parents could be the killer.

## Width vs Depth — When Tree Shape Hurts

Two extreme tree shapes:

- **Deep, narrow:** request -> middleware1 -> middleware2 -> ... -> handler. Many `valueCtx` nodes piling up. `ctx.Value(k)` walks the chain — O(depth).
- **Wide, shallow:** one parent with 10,000 cancelable children. `cancel()` holds the parent's lock while iterating all 10,000.

Most real apps are deep (4–10 levels) and modestly wide (1–20 children per node). Both are cheap.

Problems show up when:

- A streaming server holds 10,000 connections, each registered as a direct child of `Background()`. Their parent is never cancelled, so they stay in `Background()`'s children map... but `Background()` is an `emptyCtx`; it has no children map. Plain `WithCancel(Background())` does not register at the parent (Background's `Done()` is nil, so `propagateCancel` returns early).

In other words, deriving from `Background` is cheap — there is no parent to register with. Deriving from a real `cancelCtx` is more expensive when many children share it. If you have 10,000 worker goroutines all derived from one cancelable parent, the parent's `children` map holds 10,000 entries until those workers' `cancel()` functions run.

## `Cause` Across `WithoutCancel`

Because `WithoutCancel` short-circuits cancellation, calling `Cause` on a context derived from it never reaches the parent's cause. The detached context lives or dies on its own.

```go
parent, cancel := context.WithCancelCause(context.Background())
detached := context.WithoutCancel(parent)
cancel(errors.New("boom"))

fmt.Println(context.Cause(detached)) // <nil>
fmt.Println(detached.Err())          // <nil>
```

## Diagnostics: Spotting Bad Trees

A few smells to watch for:

1. **Many short-lived children of a long-lived parent.** Each one must be cancelled or it lingers. Run a leak detector or a runtime goroutine dump after load.
2. **Deep `WithValue` chains.** Each lookup is O(depth). Cache hot keys in local variables.
3. **Custom contexts wrapping standard contexts.** Every derived child spawns a goroutine.
4. **`cancel` saved in a struct field.** Almost always wrong — the lifecycle decouples from scope.
5. **`defer cancel()` inside a loop.** Cancels stack until the function returns.

### A simple instrumentation

```go
type tree struct {
    sync.Mutex
    nodes map[uintptr]string
}

var globalTree = &tree{nodes: map[uintptr]string{}}

func WithLabel(parent context.Context, label string) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancel(parent)
    p := reflect.ValueOf(&ctx).Pointer()
    globalTree.Lock()
    globalTree.nodes[p] = label
    globalTree.Unlock()
    return ctx, func() {
        globalTree.Lock()
        delete(globalTree.nodes, p)
        globalTree.Unlock()
        cancel()
    }
}
```

This is for diagnostics, not production. Open-telemetry spans accomplish the same thing more sustainably.

## Pattern: Request -> Handler -> Fan-Out

The canonical tree:

```go
func handler(w http.ResponseWriter, req *http.Request) {
    ctx, cancel := context.WithTimeout(req.Context(), 5*time.Second)
    defer cancel()

    ctx = context.WithValue(ctx, requestIDKey, newID())

    results := make(chan result, 3)
    var eg errgroup.Group
    for _, svc := range []string{"users", "orders", "billing"} {
        svc := svc
        eg.Go(func() error {
            cctx, cancelSvc := context.WithTimeout(ctx, 1*time.Second)
            defer cancelSvc()
            r, err := call(cctx, svc)
            if err != nil {
                return err
            }
            results <- r
            return nil
        })
    }

    if err := eg.Wait(); err != nil {
        http.Error(w, err.Error(), http.StatusBadGateway)
        return
    }
    close(results)
    // ...
}
```

The tree:

```
req.Context
   |
   WithTimeout 5s
        |
   WithValue requestID
        |
   +--- WithTimeout 1s (users)
   +--- WithTimeout 1s (orders)
   +--- WithTimeout 1s (billing)
```

If `errgroup` returns an error from `users`, its `WithTimeout` cancels (deferred), then `errgroup`'s context cancels (in newer `errgroup.WithContext`), then the outer `WithTimeout` cascade — every still-running call sees `<-cctx.Done()` and stops.

## Pattern: Background Continuation

```go
func handler(w http.ResponseWriter, req *http.Request) {
    res, err := do(req.Context(), req)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }

    // Audit log must run regardless of whether the client disconnects.
    audit := context.WithoutCancel(req.Context())
    audit, cancel := context.WithTimeout(audit, 10*time.Second)
    go func() {
        defer cancel()
        if err := writeAudit(audit, res); err != nil {
            log.Printf("audit: %v", err)
        }
    }()

    w.Write(res.JSON())
}
```

The `WithoutCancel` cuts the request's cancellation; the `WithTimeout` re-establishes a bounded budget for the audit.

## Pattern: AfterFunc for Connection Close

```go
func server(ctx context.Context, ln net.Listener) {
    context.AfterFunc(ctx, func() { ln.Close() })
    for {
        conn, err := ln.Accept()
        if err != nil {
            return
        }
        go serve(conn)
    }
}
```

When the caller cancels, `ln.Close()` fires; `Accept` returns an error; the loop exits. No extra goroutine to manage.

## Pattern: Per-Worker Cause

```go
ctx, cancel := context.WithCancelCause(parent)
defer cancel(nil)

for _, w := range workers {
    go func(w Worker) {
        if err := w.Run(ctx); err != nil {
            cancel(fmt.Errorf("worker %s: %w", w.Name(), err))
        }
    }(w)
}
<-ctx.Done()
if c := context.Cause(ctx); c != nil && !errors.Is(c, context.Canceled) {
    return c
}
```

The first worker to fail names itself in the cause. Others stopping later see the same cause.

## When to Use Which

| You want... | Use |
|-------------|-----|
| A cancel button on a node | `WithCancel` |
| Same + reason | `WithCancelCause` |
| Auto-cancel after duration | `WithTimeout` / `WithTimeoutCause` |
| Auto-cancel at clock time | `WithDeadline` / `WithDeadlineCause` |
| Pass a request-scoped value | `WithValue` |
| Cleanup hook on cancellation | `AfterFunc` |
| Survive parent cancellation | `WithoutCancel` |

If you need both detach **and** new deadline, derive `WithoutCancel` then `WithTimeout`.

## Common Tree Mistakes

### Mistake: orphaned subtree

```go
ctx, cancel := context.WithCancel(parent)
go func() {
    defer cancel()
    work(ctx)
}()
// caller returns. cancel runs via defer. work has 0ms to react.
```

If you want the worker to run to completion, do not cancel on the caller's return. Use `WithoutCancel` to detach.

### Mistake: parent shadowing

```go
ctx := req.Context()
ctx = context.Background() // overwrites request context!
```

A typo or careless refactor that replaces the parent with `Background()` orphans the rest of the tree from the request's cancellation.

### Mistake: cancelling from many places

A `CancelFunc` is safe to call concurrently — but if multiple goroutines hold it and all might call it, the *first* one wins for the cause. Avoid spreading cancel ownership.

## Testing Trees

A helpful test harness records the order of cancellations:

```go
func TestCascadeOrder(t *testing.T) {
    parent, cancel := context.WithCancel(context.Background())
    children := make([]context.Context, 5)
    var fired sync.Map

    for i := range children {
        i := i
        ctx, _ := context.WithCancel(parent)
        children[i] = ctx
        go func() {
            <-ctx.Done()
            fired.Store(i, time.Now())
        }()
    }

    cancel()
    time.Sleep(50 * time.Millisecond)
    fired.Range(func(k, v any) bool {
        t.Logf("child %v fired at %v", k, v)
        return true
    })
}
```

Run with `-race`. Cancellation is depth-first and synchronous, so all five `fired.Store` calls happen within microseconds. Their order is map-iteration order, not insertion order.

## Summary

The context tree's behaviour is fully determined by five node kinds, one cascade rule (parents cancel children), one deadline rule (first deadline wins), and two opt-ins (`WithCancelCause`, `WithoutCancel`). `AfterFunc` is a convenience for cleanup hooks that previously required a dedicated goroutine. Once you can sketch the tree your code builds and walk the cascade in your head, you have everything you need at this level.
