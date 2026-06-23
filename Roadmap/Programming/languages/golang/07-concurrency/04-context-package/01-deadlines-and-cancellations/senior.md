# Deadlines and Cancellations — Senior

[← Back to index](junior.md)

## Reading the Source

The `context` package is small — under a thousand lines of Go — and worth reading line by line. We recap the key types here in pseudocode so we can reason about behavior without flipping back and forth.

### The Empty Context

```go
type emptyCtx int

func (*emptyCtx) Deadline() (time.Time, bool) { return time.Time{}, false }
func (*emptyCtx) Done() <-chan struct{}        { return nil }
func (*emptyCtx) Err() error                   { return nil }
func (*emptyCtx) Value(any) any                { return nil }

var (
    background = new(emptyCtx)
    todo       = new(emptyCtx)
)
```

`Background()` and `TODO()` return distinct pointers, but their behavior is identical. They differ only by `String()` output, used in error messages and `fmt`.

The crucial property: `Done()` returns `nil`. A nil channel **blocks forever** in a `select`. That is exactly what you want — if there is no cancellation, the case never fires.

### cancelCtx — The Heart

```go
type cancelCtx struct {
    Context // embedded parent

    mu       sync.Mutex
    done     atomic.Value     // chan struct{}, lazily initialized
    children map[canceler]struct{}
    err      error            // set under mu
    cause    error            // since Go 1.20
}
```

Notable design decisions:

- **`done` is lazy.** The channel is only allocated on first call to `Done()`. Many requests never spawn a goroutine that selects on Done; their cancelCtx never allocates the channel.
- **`children` is also lazy.** Only allocated when a new derived cancelable child registers.
- **One mutex.** Everything mutating state (cancel, deregister, propagate) holds `mu`.

The `cancel` method is the load-bearing function:

```go
func (c *cancelCtx) cancel(removeFromParent bool, err, cause error) {
    c.mu.Lock()
    if c.err != nil { // already cancelled
        c.mu.Unlock()
        return
    }
    c.err = err
    c.cause = cause
    d, _ := c.done.Load().(chan struct{})
    if d == nil {
        c.done.Store(closedchan) // sentinel pre-closed channel
    } else {
        close(d)
    }
    for child := range c.children {
        child.cancel(false, err, cause) // cascade
    }
    c.children = nil
    c.mu.Unlock()

    if removeFromParent {
        removeChild(c.Context, c)
    }
}
```

Key observations:

- **First-write wins** — only the first cancellation sets `err`/`cause`.
- **Cascade is depth-first** while holding `c.mu`. Children's cancels happen synchronously.
- **`removeFromParent` is false in cascade** because we're already locking everything; we set `children = nil` so memory drops.
- **`closedchan` is a global sentinel**. If `Done()` is never called before cancel, we don't need to allocate a channel — we just hand out the pre-closed singleton.

### timerCtx — Deadlines Built On cancelCtx

```go
type timerCtx struct {
    cancelCtx
    timer *time.Timer
    deadline time.Time
}
```

`WithDeadline(parent, t)` returns a `timerCtx`. The constructor:

```go
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
    if cur, ok := parent.Deadline(); ok && cur.Before(d) {
        // Parent already has an earlier deadline; just chain a cancelCtx.
        return WithCancel(parent)
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

Two optimisations to notice:

1. **Earlier parent deadline short-circuits.** If `parent.Deadline()` is already before `d`, `WithDeadline` returns a plain `WithCancel` rather than allocating a timer that would never fire.
2. **Already-passed deadline is immediate.** No timer, just synchronous cancel.

### propagateCancel

The function that wires a child to its parent:

```go
func propagateCancel(parent Context, child canceler) {
    done := parent.Done()
    if done == nil {
        return // parent is never cancelled
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
        // parent is some custom Context; spawn a goroutine to forward cancel
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

- **Fast path:** parent is a known `cancelCtx` — just register in its children map.
- **Slow path:** parent is a custom Context implementation — spawn a goroutine that forwards the signal.

That goroutine is a real cost. If you implement your own `Context`, every derived cancelable child spawns a goroutine. Avoid custom contexts unless you have a good reason.

## Race-Free Cancellation

Several invariants make context safe to share across goroutines:

1. **`Done()` is atomic-loaded.** Multiple readers can call `Done()` concurrently.
2. **Channel close is one-shot.** Multiple goroutines can `<-c.Done()`; they all wake at once, deterministically.
3. **`Err()` is locked but stable.** Once set, it never changes. After `Done()` closes, you may safely read `Err()` without further synchronization (a happens-before is established by the close).

```go
go func() {
    <-ctx.Done()
    if errors.Is(ctx.Err(), context.DeadlineExceeded) { ... }
}()
```

The goroutine never races on `ctx.Err()` because the close-channel happens-before its receive.

## WithCancelCause — Why a Cause?

A common production complaint: `ctx.Err() == context.Canceled` says nothing about *who* canceled. Was it the user closing the connection? A deadline? An upstream error?

`WithCancelCause` (Go 1.20) addresses that:

```go
ctx, cancel := context.WithCancelCause(parent)

// Anywhere in the goroutine tree:
cancel(errors.New("upstream auth-service returned 401"))

// In a downstream consumer:
err := ctx.Err()                    // context.Canceled (legacy)
cause := context.Cause(ctx)         // upstream auth-service returned 401
```

`Cause` walks up the tree and returns the first non-nil cause. If no `WithCancelCause` cancel was called, `Cause(ctx) == ctx.Err()`.

Critical detail: `ctx.Err()` is **unchanged** for backwards compatibility. Code paths that compare `ctx.Err()` to `context.Canceled` keep working. `Cause` is the new richer view.

### When to use Cause

- **Long pipelines** where the original failure should bubble up. Logs become "upstream timed out" instead of "canceled".
- **Multi-source orchestrators** — `errgroup.WithContextCause` returns the first error directly.
- **Distributed-tracing spans** that record cancellation reasons.

When *not* to use:

- **Library boundaries.** Returning `Cause` to the caller leaks internals; convert to a real domain error before returning.
- **Within a single function.** If you have the cause locally, return it as your error directly — don't smuggle it through the context.

## WithoutCancel — Decoupling Lifetime From Values

Pre-Go-1.21 there was no way to say "give me this context's values but not its cancellation." Common workarounds were ugly:

```go
type valueCtx struct{ context.Context }
func (v valueCtx) Done() <-chan struct{} { return nil }
// ... and so on
```

`WithoutCancel(parent)` (Go 1.21) does this directly:

```go
auditCtx := context.WithoutCancel(r.Context())
go runAudit(auditCtx) // outlives the request, sees its values
```

Properties:

- `Deadline()` returns `(time.Time{}, false)` regardless of parent.
- `Done()` returns `nil`.
- `Err()` always returns `nil`.
- `Value(k)` delegates to parent.

It is a values-only view of the parent. Use it when you intentionally need a longer-lived task to keep request-scoped tags (trace IDs, tenant IDs) without inheriting the request's deadline.

## AfterFunc — Cleanup Without a Goroutine

Suppose you allocated a remote handle that must be released when a request is canceled:

```go
handle, _ := pool.Acquire(ctx)
stop := context.AfterFunc(ctx, func() {
    pool.Release(handle)
})
defer stop() // cancel the registration if we release manually first
```

`AfterFunc` returns `stop func() bool`:

- `stop()` deregisters the function. Returns `false` if the function has already started or finished.
- If `ctx` is already done when `AfterFunc` is called, `f` runs immediately on its own goroutine.

Internals: `AfterFunc` registers as if it were a child cancelCtx, but its only effect on cancellation is to call `f`. No new goroutine is started until cancellation actually fires.

This is the right primitive for **resource-cleanup** semantics: you do not want a forever-running select goroutine; you want a callback exactly once.

## Custom Context Implementations

You can implement `Context` yourself, but think twice. Cases where it's reasonable:

1. **Request-scoped values typed as a struct** to avoid `interface{}` lookup on every call. Wrap a parent and override only `Value`.
2. **Per-tenant context** that adds a deadline computed from tenant config.

A minimal value-only override:

```go
type tenantCtx struct {
    context.Context
    tenant string
}

type tenantKey struct{}

func (t *tenantCtx) Value(k any) any {
    if k == (tenantKey{}) {
        return t.tenant
    }
    return t.Context.Value(k)
}

func WithTenant(parent context.Context, t string) context.Context {
    return &tenantCtx{Context: parent, tenant: t}
}
```

Pitfalls when overriding:

- **Do not override Done/Err/Deadline lightly.** The runtime's `propagateCancel` falls back to its slow-path goroutine when it cannot find a recognised `cancelCtx` ancestor, costing you one goroutine per derived cancelable child.
- **Embed the parent.** Forwarding everything except `Value` is the safe pattern.

## Cancellation Is Cooperative

The `Context` type is **not magic**. Calling `cancel()` does not preempt the goroutine. The goroutine must check `<-ctx.Done()` itself. If it doesn't, cancellation does nothing.

```go
// This goroutine is uninterruptible regardless of context.
go func(ctx context.Context) {
    for { /* tight CPU loop */ }
}(ctx)
```

Design every long-running operation to either:

- Block on `<-ctx.Done()` directly,
- Or call `ctx.Err()` periodically inside loops,
- Or call into a stdlib function that respects context (`net.Dialer`, `db.QueryContext`, etc.).

In CPU-bound code, the only way to cooperate is a periodic `ctx.Err()` check.

## Cancellation and Deferred Cleanup Order

When a goroutine returns due to cancellation, deferred functions run as usual:

```go
func work(ctx context.Context) {
    f, _ := os.Create("/tmp/out")
    defer f.Close()

    for {
        select {
        case <-ctx.Done():
            return // f.Close() runs here
        case ev := <-stream:
            fmt.Fprintln(f, ev)
        }
    }
}
```

What you must avoid: deferring a function that *blocks indefinitely on a parent context*. Because the cancel cascade is synchronous within the parent's `mu`, a long-running child cancel pins the parent.

```go
// BAD: slow cancel
ctx, cancel := context.WithCancel(parent)
context.AfterFunc(ctx, func() {
    time.Sleep(time.Hour) // blocks goroutine but at least it's its own goroutine
})
```

`AfterFunc` runs on its **own** goroutine — that's the safety belt. The cascade itself is short.

## Real-World Example: Cancelable Pipeline

Suppose we want to crawl a list of URLs in parallel, retry transient failures, and stop the whole thing on context cancellation. Here's the senior-grade implementation:

```go
package crawler

import (
    "context"
    "errors"
    "fmt"
    "net/http"
    "sync"
    "time"

    "golang.org/x/sync/errgroup"
)

type Crawler struct {
    Client      *http.Client
    Concurrency int
    Retries     int
}

func (c *Crawler) Run(ctx context.Context, urls []string) (map[string]int, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(c.Concurrency)

    var mu sync.Mutex
    results := make(map[string]int)

    for _, u := range urls {
        u := u
        g.Go(func() error {
            return c.fetchOne(ctx, u, &mu, results)
        })
    }
    return results, g.Wait()
}

func (c *Crawler) fetchOne(ctx context.Context, url string, mu *sync.Mutex, out map[string]int) error {
    var lastErr error
    for attempt := 0; attempt <= c.Retries; attempt++ {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }

        req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
        if err != nil {
            return err
        }
        resp, err := c.Client.Do(req)
        if err != nil {
            if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
                return err
            }
            lastErr = err
            backoff(ctx, attempt)
            continue
        }
        resp.Body.Close()

        mu.Lock()
        out[url] = resp.StatusCode
        mu.Unlock()
        return nil
    }
    return fmt.Errorf("%s: %w", url, lastErr)
}

func backoff(ctx context.Context, attempt int) {
    d := time.Duration(1<<attempt) * 100 * time.Millisecond
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-ctx.Done():
    case <-t.C:
    }
}
```

What makes this senior-grade:

- `errgroup.WithContext` produces a context cancelled by **either** the parent or the first failure.
- Every blocking step (the HTTP call, the backoff sleep) respects `ctx`.
- We distinguish context errors (return immediately) from transient errors (retry).
- Backoff uses `time.NewTimer` + `defer Stop()` — never `time.Sleep`.
- `errgroup.SetLimit` bounds concurrency.

## Diagnostics: Where Did the Cancel Come From?

A common production puzzle: the log says "context canceled" but you don't know why. Three techniques:

**1. Use `WithCancelCause` and log `context.Cause(ctx)`.** This is the cheapest; just remember to attach a cause at every cancel call site.

**2. Capture a stack trace at cancel.** Wrap `cancel` to log `runtime.Stack`:

```go
ctx, baseCancel := context.WithCancel(parent)
cancel := func() {
    log.Printf("cancel called from:\n%s", debug.Stack())
    baseCancel()
}
```

**3. Convert canonical errors at boundaries.** When returning from a handler, translate `context.Canceled` from a downstream call into a domain error that records the source ("upstream-timeout", "client-closed", etc.). The cause does not have to come from the context — it can come from your error wrapping.

## Performance: What Does Cancellation Cost?

Per-context overhead, measured roughly on a modern Linux machine:

| Operation                                  | Cost (rough) |
|--------------------------------------------|--------------|
| `Background()`/`TODO()`                    | 0 — global   |
| `WithCancel(parent)`                       | ~250 ns + one `cancelCtx` alloc |
| `WithTimeout(parent, d)`                   | ~600 ns + one `timerCtx` alloc + one `time.Timer` alloc |
| `WithValue(parent, k, v)`                  | ~100 ns + one `valueCtx` alloc |
| `<-ctx.Done()` on uncanceled cancelCtx     | one channel receive (~30 ns) |
| `Done()` first call (allocates chan)       | one chan alloc |
| Cascading cancel of N children             | O(N), all under one parent's mu |

In hot paths (per request, fine), in inner loops (avoid).

## Cancellation Is Not Authorisation

A subtle anti-pattern: using context to enforce permissions.

```go
// ANTI-PATTERN
func DoAdminThing(ctx context.Context) error {
    if isAdmin(ctx) {
        return realDoAdminThing(ctx)
    }
    return ErrForbidden
}
```

Why bad: anyone can call `DoAdminThing` directly with a forged context that has `isAdmin` set. Context values are **convention**, not security. Permission checks belong at the boundary (HTTP middleware, RPC interceptor) and the result becomes a typed parameter, not a context value.

## Summary For The Senior Reviewer

When reviewing a PR that adds `context.Context`:

1. **Tree shape:** is every blocking call wired to the same root?
2. **Cancel discipline:** is every `cancel` deferred, every `WithoutCancel` justified?
3. **Deadline budgeting:** does sub-call's deadline fit within the parent's remaining time?
4. **Done discipline:** every loop has a `<-ctx.Done()` branch.
5. **Error matching:** every comparison uses `errors.Is`.
6. **Cause when ambiguous:** if cancellation reason is non-trivial, `WithCancelCause`.
7. **No values for control flow:** request IDs, traces only. Optional flags go in struct fields.

Next: in [professional.md](professional.md) we cover allocation cost in depth, custom context implementations, and AfterFunc patterns for cleanup-heavy services.
