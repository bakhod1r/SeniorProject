# Deadlines and Cancellations — Middle

[← Back to index](junior.md)

## Picture the Tree

A `Context` is a node in a tree. Every `WithCancel`, `WithTimeout`, or `WithDeadline` creates a child node and links it to its parent. The root is always `Background()` (or `TODO()` while you wire things up).

```
                          ┌──────────────┐
                          │  Background  │
                          └──────┬───────┘
                                 │
                  ┌──────────────┴──────────────┐
                  │                             │
            ┌─────▼──────┐               ┌──────▼─────┐
            │ WithCancel │               │ WithTimeout │
            └─────┬──────┘               └─────┬──────┘
                  │                             │
        ┌─────────┴─────────┐                   │
        ▼                   ▼                   ▼
  WithTimeout         WithCancel           WithDeadline
        │                   │                   │
       ...                 ...                 ...
```

Two rules govern the tree:

1. **Cancellation flows down.** Cancelling a node cancels every descendant.
2. **Cancellation never flows up.** Cancelling a child does not affect the parent or its siblings.

That is why `request.Context()` cancellation (from the HTTP server) reaches every database call, RPC, and goroutine spawned inside the handler — they all derive their contexts from the request's context.

## Anatomy of a Derive

When you write:

```go
ctx, cancel := context.WithTimeout(parent, 2*time.Second)
```

Internally three things happen:

1. A `timerCtx` struct is built. It holds the parent, a deadline, and a `time.Timer`.
2. The new node is added to `parent.children` (a `map[canceler]struct{}`) so the parent can cascade-cancel it.
3. The timer is started; when it fires, the node calls `cancel(true, DeadlineExceeded, nil)` on itself.

The returned `cancel` function:

- Removes this node from the parent's `children` map.
- Stops the timer (if any).
- Closes `Done`.
- Sets `Err` (if not already set).
- Recursively cancels every child of this node.

So `cancel()` is more than "fire a signal" — it **prunes the tree**.

## Why You Must Defer cancel()

Two failure modes if you forget.

**Mode A: short-lived parent, long-lived child resource.** If you derive with `WithTimeout` and never call `cancel`, the underlying `time.Timer` lives until the deadline expires. For 100 ms timeouts that may not matter; for 5-minute timeouts on a busy server you accumulate millions of pending timers.

**Mode B: long-lived parent, finished child.** Each call to `WithCancel(parent)` adds an entry to `parent.children`. If you do not call `cancel`, that entry persists for the life of the parent. A long-lived parent (a server's `Background()` derivative) accumulates ghost entries until it is GCed.

`go vet -lostcancel` catches every path where the cancel function escapes unused.

```
$ go vet ./...
./svc.go:23:2: the cancel function returned by context.WithTimeout
              should be called, not discarded, to avoid a context leak
```

`golangci-lint` enables `lostcancel` by default. Treat warnings as errors.

## The Five Cancel Patterns

There are five idiomatic shapes for using `cancel`. Recognise each.

### Pattern 1 — Function-scoped defer

```go
func (s *Service) GetUser(ctx context.Context, id int) (*User, error) {
    ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
    defer cancel()
    return s.db.QueryUser(ctx, id)
}
```

The cancel runs when the function returns. Most common pattern in handler code.

### Pattern 2 — Cancel on first error

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()

errCh := make(chan error, 2)
go work(ctx, errCh, "a")
go work(ctx, errCh, "b")

for i := 0; i < 2; i++ {
    if err := <-errCh; err != nil {
        cancel() // stop the other one
        return err
    }
}
```

Two goroutines race; the first failure cancels the survivor. `errgroup.WithContext` packages this.

### Pattern 3 — Cancel on graceful shutdown

```go
ctx, cancel := context.WithCancel(context.Background())
go runServer(ctx)

sigs := make(chan os.Signal, 1)
signal.Notify(sigs, os.Interrupt)
<-sigs
cancel() // tell the server to begin shutdown
```

The cancel here is the explicit signal triggered by SIGINT.

### Pattern 4 — Cancel passed across goroutines

```go
type Job struct {
    cancel context.CancelFunc
}

func (j *Job) Stop() { j.cancel() }
```

Storing a cancel in a struct is allowed and useful. Storing the **context** in a struct is what is discouraged.

### Pattern 5 — Cancel in tests

```go
func TestSlowOp(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()

    if err := slowOp(ctx); err != nil {
        t.Fatal(err)
    }
}
```

Even short tests should have an upper bound; otherwise a hung test blocks CI.

## Deadline Arithmetic

Deadlines are absolute. When a context is derived from a parent that already has a deadline, the **earlier of the two** wins.

```go
parent, _   := context.WithTimeout(context.Background(), 5*time.Second)
child,  _   := context.WithTimeout(parent, 10*time.Second)

d, _ := child.Deadline()
fmt.Println(d.Sub(time.Now())) // ≈ 5s, not 10s
```

This is the most important property to understand: you cannot **extend** a parent's deadline by deriving with a longer one.

```
parent ──┤                     ├── 5s
child  ──┤                              ├── 10s (requested)
                                              ↓
actual ──┤                     ├── 5s
```

Use this for **deadline budgeting**:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    // r.Context() may already carry a request deadline from the server.

    dbCtx, cancel := context.WithTimeout(r.Context(), 200*time.Millisecond)
    defer cancel()
    user, err := loadUser(dbCtx, r.URL.Query().Get("id"))
    if err != nil { ... }

    apiCtx, cancel2 := context.WithTimeout(r.Context(), 800*time.Millisecond)
    defer cancel2()
    if err := callExternal(apiCtx, user); err != nil { ... }
}
```

The DB has 200 ms or whatever's left of the request, whichever is sooner.

## Asking "How Much Time Do I Have Left?"

```go
if d, ok := ctx.Deadline(); ok {
    remaining := time.Until(d)
    if remaining < 50*time.Millisecond {
        return ErrInsufficientBudget
    }
}
```

Useful in two places:

- **At the start of an expensive step** — bail early if you know you can't finish.
- **When sub-allocating budget across N sub-calls** — divide the remaining budget.

```go
remaining := time.Until(deadline)
perCall := remaining / time.Duration(len(targets))
for _, t := range targets {
    sub, cancel := context.WithTimeout(ctx, perCall)
    callOne(sub, t)
    cancel()
}
```

## Cancellation Propagation Across Goroutines

When you launch a goroutine, **always** pass it a context derived from the parent. Otherwise the goroutine has no way to know it should stop.

```go
// BAD
func handler(w http.ResponseWriter, r *http.Request) {
    go cleanup() // disconnected from r.Context() — leaks past response
}

// GOOD
func handler(w http.ResponseWriter, r *http.Request) {
    go cleanup(r.Context())
}
```

But! The opposite mistake is also common. If `cleanup` does asynchronous work that should outlive the request, deriving from `r.Context()` causes premature cancellation.

```go
// Probably BAD if we want the audit to finish even after the response is sent
func handler(w http.ResponseWriter, r *http.Request) {
    go audit(r.Context(), r) // canceled when handler returns
}
```

We address this case with `WithoutCancel` (Go 1.21+) or by deriving from `Background()`:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    auditCtx := context.WithoutCancel(r.Context()) // values flow, cancel does not
    go audit(auditCtx, r)
}
```

## go vet -lostcancel

The `lostcancel` analyzer is bundled with `go vet` and runs by default. It complains about:

```go
// Case A — discarded
ctx, _ := context.WithCancel(parent)

// Case B — assigned but only used on some paths
ctx, cancel := context.WithCancel(parent)
if x {
    return ctx.Err()
}
defer cancel()

// Case C — leaked into closure that may not run
ctx, cancel := context.WithCancel(parent)
go func() {
    if shouldRun {
        defer cancel()
        ...
    }
}()
```

Run as part of CI:

```bash
go vet -vettool=$(which lostcancel) ./...
```

Or just `go vet ./...` — `lostcancel` is built-in.

## Cancelation in Loops

Two shapes appear constantly. The first is the worker loop:

```go
func consumer(ctx context.Context, in <-chan Job) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case job, ok := <-in:
            if !ok {
                return nil // upstream closed
            }
            if err := process(ctx, job); err != nil {
                return err
            }
        }
    }
}
```

The second is the iterator over a finite slice that occasionally checks for cancellation:

```go
func processAll(ctx context.Context, items []Item) error {
    for i, item := range items {
        if i%100 == 0 { // cheap periodic check
            if err := ctx.Err(); err != nil {
                return err
            }
        }
        if err := process(ctx, item); err != nil {
            return err
        }
    }
    return nil
}
```

`ctx.Err()` is non-blocking; you can call it as often as you like. `<-ctx.Done()` is for `select`.

## Joining Cancellation Sources

There is no built-in `WithMerge`. If you need a context that is canceled when *either* of two contexts cancels, derive a child from one and a goroutine forwards from the other:

```go
func mergeCancel(a, b context.Context) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancel(a)
    go func() {
        select {
        case <-b.Done():
            cancel()
        case <-ctx.Done():
        }
    }()
    return ctx, cancel
}
```

In Go 1.21+ a cleaner solution uses `context.AfterFunc`:

```go
func mergeCancel(a, b context.Context) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancel(a)
    stop := context.AfterFunc(b, cancel)
    return ctx, func() {
        stop()
        cancel()
    }
}
```

`AfterFunc` registers `cancel` to run when `b` is cancelled or its deadline expires; no extra goroutine needed.

## context.AfterFunc (Go 1.21+)

`AfterFunc(ctx, f)` schedules `f` to run on its own goroutine when `ctx` is canceled or expires. It returns a `stop` function you can call if you want to deregister.

```go
stop := context.AfterFunc(ctx, func() {
    log.Printf("request abandoned, releasing resources")
    pool.Release(handle)
})
defer stop()
```

If `ctx` is already done, `f` is called immediately. If `stop()` is called before cancellation, `f` will not run. If `f` was already called, `stop()` returns false.

This is the right tool when you want a cleanup hook **without** running a select loop.

## context.WithoutCancel (Go 1.21+)

`WithoutCancel(parent)` returns a context that:

- Inherits **values** from the parent.
- Does **not** propagate cancellation.

That is exactly what you need for "fire and forget" tasks that should outlive the request:

```go
func sendOrder(ctx context.Context, o Order) error {
    if err := db.Save(ctx, o); err != nil {
        return err
    }
    // Audit must complete even if the request is cancelled.
    go audit(context.WithoutCancel(ctx), o)
    return nil
}
```

Trace IDs and tenant IDs in the parent's values still come along; the cancel signal does not.

## context.WithCancelCause and Cause (Go 1.20+)

Sometimes you want to record **why** something was cancelled. Plain `cancel()` always sets `Err()` to `context.Canceled`, hiding the real reason. `WithCancelCause` gives you a richer flavor:

```go
ctx, cancel := context.WithCancelCause(parent)

go func() {
    if err := monitor(ctx); err != nil {
        cancel(fmt.Errorf("monitor failed: %w", err))
    }
}()

<-ctx.Done()
fmt.Println(ctx.Err())              // context canceled
fmt.Println(context.Cause(ctx))     // monitor failed: connection refused
```

Rules:

- `ctx.Err()` still returns `Canceled` or `DeadlineExceeded` for backwards compatibility.
- `context.Cause(ctx)` returns the first non-nil cause set anywhere up the chain.
- For `WithDeadlineCause`/`WithTimeoutCause` (Go 1.21+) the cause is the value you supplied if the deadline fires.

Useful in long pipelines where the original failure should bubble up so logs say *"connection lost"* instead of just *"canceled"*.

## A Worked Example: Bounded Fan-Out

A common production task: query four upstream services in parallel, return as soon as you have answers from at least three, give up on the slowest one. Cancel everything if the request deadline is approaching.

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "math/rand"
    "sync"
    "time"
)

type result struct {
    src string
    val int
    err error
}

func fetch(ctx context.Context, src string) result {
    delay := time.Duration(rand.Intn(800)) * time.Millisecond
    select {
    case <-ctx.Done():
        return result{src, 0, ctx.Err()}
    case <-time.After(delay):
        return result{src, rand.Intn(100), nil}
    }
}

func bestOfThree(ctx context.Context, srcs []string) ([]result, error) {
    if len(srcs) < 3 {
        return nil, errors.New("need at least 3 sources")
    }
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    out := make(chan result, len(srcs))
    var wg sync.WaitGroup
    for _, s := range srcs {
        wg.Add(1)
        go func(s string) {
            defer wg.Done()
            out <- fetch(ctx, s)
        }(s)
    }
    go func() { wg.Wait(); close(out) }()

    var got []result
    for r := range out {
        if r.err != nil {
            continue
        }
        got = append(got, r)
        if len(got) == 3 {
            cancel() // cancel the slow ones
            break
        }
    }
    return got, nil
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 600*time.Millisecond)
    defer cancel()

    rs, _ := bestOfThree(ctx, []string{"a", "b", "c", "d"})
    for _, r := range rs {
        fmt.Printf("%s = %d\n", r.src, r.val)
    }
}
```

Notice the discipline:

1. The internal `WithCancel` is so we can cancel the slow remainder once we have what we need.
2. `defer cancel()` runs on every exit path — including the `len(got) == 3` early break.
3. The outer `WithTimeout` ensures the entire operation respects the request deadline.

## Common Middle-Level Pitfalls

### Cancelled vs DeadlineExceeded — wrap, don't compare

```go
// BAD — works only if err is *literally* the sentinel
if err == context.Canceled { ... }

// GOOD
if errors.Is(err, context.Canceled) { ... }
```

The standard library wraps these errors as it crosses package boundaries. `errors.Is` walks the chain.

### Cancel after return

If you `defer cancel()` but **also** want to call it before return, that is fine — `cancel` is idempotent.

```go
defer cancel()
if x {
    cancel() // safe, no-op on second call
    return
}
```

### Long-lived goroutine with child of request

Do not derive a long-running background worker's context from a request's context — the request will cancel and your worker dies. Use `context.WithoutCancel` if you need values, or start from `Background()` if you do not.

### Context as a "cancellation token" in a struct

Storing **the cancel function** in a struct is fine.
Storing **the context** in a struct is the smell.

```go
type Worker struct {
    cancel context.CancelFunc // OK
}

type BadWorker struct {
    ctx context.Context // smell
}
```

## Tooling Round-Up

| Tool                        | What it catches                                  |
|-----------------------------|--------------------------------------------------|
| `go vet -lostcancel`        | Discarded or non-deferred cancel functions       |
| `golangci-lint contextcheck`| Functions that should accept `ctx` but do not    |
| `staticcheck SA1012`        | Passing nil to `context.Background`-only call    |
| `staticcheck SA1029`        | Using built-in types as `context.Value` keys     |
| `go test -race`             | Data races on cancellable resources              |

## Mental Model

After reading this you should picture every Go server like this:

```
HTTP request arrives
   │
   ▼
http.Server creates request.Context (with optional ReadHeaderTimeout)
   │
   ├── handler does:
   │      ctx, cancel := WithTimeout(r.Context(), 1s); defer cancel()
   │      ├── DB call: db.QueryContext(ctx, ...)
   │      ├── RPC:     client.Get(ctx, ...)
   │      └── goroutine: go work(ctx, ...)
   │
   ▼
response written or deadline expires → cancel cascade
```

Every blocking thing is on the tree. The tree dies together. That is what context buys you.

## Checklist Before Merging Context Code

- [ ] Every exported function that blocks takes `ctx context.Context` as first arg.
- [ ] No nil context anywhere; use `context.TODO` while wiring up.
- [ ] Every `WithCancel`/`WithTimeout`/`WithDeadline` has a `defer cancel()`.
- [ ] No `time.Sleep` inside cancellable loops; use `select` with `ticker.C` or `time.After`.
- [ ] No context stored in struct fields.
- [ ] `r.Context()` is always derived, never replaced with `Background()` inside a handler (unless intentionally with `WithoutCancel`).
- [ ] `go vet ./...` clean.

Next: in [senior.md](senior.md) we open the runtime and read the actual source of `cancelCtx`, `timerCtx`, and `propagateCancel`.
