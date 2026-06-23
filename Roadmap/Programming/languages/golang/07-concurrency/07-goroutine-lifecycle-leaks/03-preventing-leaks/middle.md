# Preventing Goroutine Leaks — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Structured Concurrency in Go](#structured-concurrency-in-go)
3. [`errgroup` as the Default Tool](#errgroup-as-the-default-tool)
4. [The Start/Stop Struct Pattern](#the-startstop-struct-pattern)
5. [Context Propagation in a Real Service](#context-propagation-in-a-real-service)
6. [Test-Time Leak Detection with goleak](#test-time-leak-detection-with-goleak)
7. [Bounded Shutdown](#bounded-shutdown)
8. [Refactoring Leaky Code](#refactoring-leaky-code)
9. [Code Review for New Goroutines](#code-review-for-new-goroutines)
10. [Self-Assessment](#self-assessment)
11. [Summary](#summary)

---

## Introduction

The junior level taught the five canonical leak patterns and their fixes. At middle level, you stop treating leaks as individual bugs and start treating them as a class of problem that good structure eliminates. The shift is from "I will remember to add `<-ctx.Done()`" to "I write code in a shape where it is hard to forget."

This file covers the small handful of patterns that, applied consistently, make leaks rare:

- **Structured concurrency**: goroutines live within the scope of their starter.
- **The Start/Stop struct**: every long-lived goroutine is wrapped in a type that exposes its lifecycle.
- **goleak in CI**: every test asserts the absence of leaks automatically.

You should already be comfortable with `context.Context`, `errgroup`, and the owner rule from the junior file. This file assumes those are reflexes.

---

## Structured Concurrency in Go

### What structured concurrency means

A concurrent operation is *structured* when:

1. Its goroutines are started within a defined lexical scope.
2. The scope cannot return until all its goroutines have stopped.
3. Errors from any goroutine propagate to the scope.
4. Cancellation flows from the scope down to the goroutines.

In other words, the goroutines live and die within the function that started them. There is no leftover concurrency when the function returns.

Go does not have a built-in structured concurrency primitive (Kotlin has `coroutineScope`, Swift has `TaskGroup`). But `errgroup.WithContext` is close enough that it serves the same purpose in practice. Use it.

### The unstructured anti-pattern

```go
func ProcessOrder(o Order) error {
    go sendConfirmation(o)   // unstructured: outlives ProcessOrder
    go updateAnalytics(o)    // same
    return save(o)
}
```

`ProcessOrder` returns long before its spawned work finishes. The function's caller has no idea whether the side effects succeeded. If the process exits a millisecond later, both background goroutines are killed mid-flight. This is the shape of every "we sometimes lose analytics" production puzzle.

### The structured version

```go
func ProcessOrder(ctx context.Context, o Order) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return sendConfirmation(ctx, o) })
    g.Go(func() error { return updateAnalytics(ctx, o) })
    if err := g.Wait(); err != nil {
        return err
    }
    return save(ctx, o)
}
```

Now `ProcessOrder` does not return until both children have completed. If either fails, the context is cancelled and the other is given a chance to abort cleanly. There are no orphaned goroutines.

### When you really do need fire-and-forget

Some operations *should* outlive the request. Audit logging, async email, metrics flush. The correct pattern is not `go logEvent(...)`. It is a *queue*:

```go
type EventBus struct {
    in     chan Event
    cancel context.CancelFunc
    done   chan struct{}
}
```

The request hands the event to the bus, the bus has its own owned goroutine, and shutdown drains the bus. Fire-and-forget at the call site, structured at the system level.

---

## `errgroup` as the Default Tool

### Why `errgroup` over raw `WaitGroup`

`sync.WaitGroup` waits. `errgroup` waits *and* collects the first error *and* cancels a derived context on error. The triple is what you need in 90% of real fan-out code. Writing it by hand is verbose and gets bugs:

```go
// Bug-prone hand-roll
var wg sync.WaitGroup
errCh := make(chan error, len(items))
for _, item := range items {
    wg.Add(1)
    go func(item Item) {
        defer wg.Done()
        if err := work(item); err != nil {
            errCh <- err
            // BUG: no cancellation; siblings keep working
        }
    }(item)
}
wg.Wait()
close(errCh)
var firstErr error
for err := range errCh {
    if firstErr == nil {
        firstErr = err
    }
}
```

Equivalent with `errgroup`:

```go
g, ctx := errgroup.WithContext(parent)
for _, item := range items {
    item := item
    g.Go(func() error { return work(ctx, item) })
}
return g.Wait()
```

Shorter, correct by construction, and the context is wired up.

### `SetLimit` for bounded concurrency

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(16)
for _, item := range items {
    item := item
    g.Go(func() error { return work(ctx, item) })
}
return g.Wait()
```

`SetLimit(N)` makes `g.Go` block when N goroutines are already running. This replaces the old "buffered channel as semaphore" pattern with a single line.

Pick the limit empirically:

- CPU-bound: `runtime.GOMAXPROCS(0)`.
- Network to one host: 8–64, depending on what the host tolerates.
- Network to many hosts: 256–1024 if downstream and upstream both handle it.

### `errgroup.TryGo`

Go 1.22 added `TryGo`, which returns `false` if the limit is reached instead of blocking. Useful for back-pressure-aware queues. Don't use it as a load shedder without thinking about what happens to the dropped work.

### Limitations

- `errgroup` returns the *first* error. If you need all errors, aggregate them yourself (mutex + slice, or `errors.Join`).
- `errgroup` cancels on first error. If you want all workers to complete regardless, catch errors inside each `Go` body.
- `errgroup` does not give you partial results. Design your work function to update shared state on success and leave it unchanged on failure.

---

## The Start/Stop Struct Pattern

The pattern from junior.md, formalised. Any service or component that owns goroutines should look like this:

```go
type Component struct {
    cancel context.CancelFunc
    done   chan struct{}
    // ...component state...
}

func NewComponent(parent context.Context, cfg Config) (*Component, error) {
    ctx, cancel := context.WithCancel(parent)
    c := &Component{cancel: cancel, done: make(chan struct{})}
    if err := c.init(cfg); err != nil {
        cancel()
        return nil, err
    }
    go c.run(ctx)
    return c, nil
}

func (c *Component) Close() error {
    c.cancel()
    <-c.done
    return c.shutdownErr
}
```

The pattern's invariants:

1. **Constructor takes a parent context.** The component does not mint its own. Lifecycle is bounded by the caller.
2. **Constructor returns an error.** If initialisation fails, the goroutine is never started and the cancel is called to release context resources.
3. **`Close` is idempotent.** Cancel twice is a no-op; reading a closed channel is fine. (If you store state about whether `Close` was called, protect with `sync.Once`.)
4. **`Close` waits.** It does not return until the goroutine has finished. The caller can rely on "after `Close`, no goroutines remain."
5. **Shutdown errors are surfaced.** If the goroutine encountered an error during shutdown, `Close` returns it.

### Multiple goroutines per component

```go
type Component struct {
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func New(parent context.Context) *Component {
    ctx, cancel := context.WithCancel(parent)
    c := &Component{cancel: cancel}
    c.wg.Add(2)
    go func() { defer c.wg.Done(); c.loopA(ctx) }()
    go func() { defer c.wg.Done(); c.loopB(ctx) }()
    return c
}

func (c *Component) Close() {
    c.cancel()
    c.wg.Wait()
}
```

`WaitGroup` replaces the single `done` channel. Same idea.

### `sync.Once` for safe double-close

```go
type Component struct {
    cancel   context.CancelFunc
    wg       sync.WaitGroup
    closeOnce sync.Once
}

func (c *Component) Close() {
    c.closeOnce.Do(func() {
        c.cancel()
        c.wg.Wait()
    })
}
```

If `Close` may be called from multiple paths (a signal handler, a defer, a test cleanup), `sync.Once` keeps it safe.

---

## Context Propagation in a Real Service

### The chain

```
main(ctx)
  -> server.Run(ctx)
    -> handler(ctx)
      -> service.Do(ctx)
        -> repo.Query(ctx)
          -> db.QueryContext(ctx, ...)
```

Every layer takes `ctx` as the first argument and passes it down. The `db.QueryContext` call is what eventually respects cancellation; if the chain is broken anywhere, the database query keeps running even after the HTTP client has hung up.

### Where to derive new contexts

Three legitimate places to call `context.WithCancel`, `WithTimeout`, or `WithDeadline`:

1. **At the top of `main`** (signal-driven cancellation).
2. **At a request boundary** (per-request timeout).
3. **At a component constructor that owns a goroutine** (component-scoped lifetime).

Everywhere else, propagate the incoming context as-is.

### Per-request timeout

```go
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
    defer cancel()
    result, err := h.svc.Do(ctx, parse(r))
    // ...
}
```

`r.Context()` is cancelled by the HTTP server when the client disconnects. Layering a timeout on top gives you both safety nets.

### Storing contexts: don't

```go
// Wrong
type Worker struct {
    ctx context.Context
}

func (w *Worker) Do() error {
    return work(w.ctx)
}
```

The context stored at construction is stale for any new call. Pass `ctx` per call:

```go
type Worker struct{}

func (w *Worker) Do(ctx context.Context) error {
    return work(ctx)
}
```

The single exception is a component that owns a goroutine: that struct may hold the `cancelFunc` for *its own* context, because the context's lifetime equals the component's. Even then, prefer to keep the `context.Context` value local to the goroutine.

### Context values are not for parameters

`context.WithValue` is for request-scoped *cross-cutting* data (request ID, trace span, auth subject). It is not for function arguments. If `work(ctx)` needs an option, pass it as an explicit parameter.

---

## Test-Time Leak Detection with goleak

### Setup

```go
// In every package with concurrent code.

package mypkg

import (
    "testing"

    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

`VerifyTestMain` runs all tests, then checks that no goroutines remain outside the standard library set. If any are found, the test binary exits non-zero with a goroutine dump.

### Per-test verification

For finer granularity:

```go
func TestSomething(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ... test body ...
}
```

The defer runs after the test body and fails the test if goroutines leak.

### Allowing known third-party goroutines

Some libraries (database drivers, observability SDKs) start background goroutines that legitimately outlive your test. Use `IgnoreTopFunction`:

```go
goleak.VerifyTestMain(m,
    goleak.IgnoreTopFunction("github.com/some/pkg.bgWorker"),
)
```

Keep the allowlist small and reviewed. Every entry is a goroutine you have decided is safe.

### CI integration

Run `go test ./...` with goleak enabled in `TestMain` and the CI catches leaks before merge. Make this the default for every new package.

A useful CI step: `go test -count=10 -race ./...`. The combination of repeated runs and the race detector catches leaks that depend on timing.

### What goleak cannot catch

- Leaks that take longer than the test to manifest (the goroutine is started but doesn't get to the leak point in time).
- Leaks in code paths the test doesn't exercise.
- Leaks across process restarts (per-test goleak is in-process).

Pair goleak with `pprof` snapshots in staging to catch the rest.

---

## Bounded Shutdown

### The shutdown contract

`Close` should:

1. Return quickly under normal conditions (sub-second is the rule of thumb for most services).
2. Have a maximum wait time. If a goroutine refuses to exit, log it and proceed.
3. Surface errors that occurred during shutdown.

### Implementation

```go
func (c *Component) Close(ctx context.Context) error {
    c.cancel()
    done := make(chan struct{})
    go func() {
        c.wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return c.shutdownErr
    case <-ctx.Done():
        log.Printf("component close timed out: %v", ctx.Err())
        return ctx.Err()
    }
}
```

The caller passes a context with a timeout: `ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)`. If shutdown exceeds the timeout, the component logs the lingering goroutines (production code would also dump them via `pprof`) and returns an error. The lingering goroutines are now a known problem, not a silent rot.

### Reaping order

In a service with N components, the order of `Close` calls matters:

1. Stop accepting new work (close the front door: HTTP listener, queue consumer).
2. Wait for in-flight work to drain (the request handlers, the message processors).
3. Close backing resources (database pool, cache, external clients).

Reverse the construction order on shutdown. The first component built (often the database client) is the last one to close.

```go
// Construction
db := NewDB(ctx)
cache := NewCache(ctx, db)
api := NewAPI(ctx, db, cache)

// Shutdown
api.Close(ctx)
cache.Close(ctx)
db.Close(ctx)
```

A common bug: closing the database before the API, which then panics when its in-flight request tries to query a closed pool.

---

## Refactoring Leaky Code

### Step 1 — Identify the goroutine

Search for `go ` in the file. For each match, ask:

- What is its owner?
- What is its stop signal?
- Where is the wait?

If any answer is "none," it leaks.

### Step 2 — Wrap in a struct

If the goroutine lives inside a function, extract it into a method on a struct. The struct holds the cancel and the wait:

```go
// Before
func startBackgroundFlusher() {
    go func() {
        for {
            time.Sleep(time.Second)
            flush()
        }
    }()
}

// After
type Flusher struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func StartFlusher(parent context.Context) *Flusher {
    ctx, cancel := context.WithCancel(parent)
    f := &Flusher{cancel: cancel, done: make(chan struct{})}
    go func() {
        defer close(f.done)
        t := time.NewTicker(time.Second)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                flush()
            }
        }
    }()
    return f
}

func (f *Flusher) Close() {
    f.cancel()
    <-f.done
}
```

### Step 3 — Thread the context

If the function chain doesn't take `ctx`, add it. Start from the entry point (HTTP handler, RPC method, `main`) and work inwards. Resist the temptation to call `context.Background()` to "fix the signature" — that severs the chain.

### Step 4 — Add goleak

Drop `goleak.VerifyTestMain(m)` into a `TestMain` in the package. Run tests. The leaks you missed will fail loudly.

### Step 5 — Audit channel closes

Search for `close(` in the file. For each, ask:

- Is the closer the unique sender?
- Is it called exactly once?
- Is it called after all sends are done?

If the answer to any of the three is "no" or "maybe," fix it.

---

## Code Review for New Goroutines

Whenever a diff adds a `go ` statement, the reviewer asks:

1. **Owner**: which struct or function holds the means to stop this goroutine?
2. **Stop signal**: what closes its loop? Almost always `<-ctx.Done()`.
3. **Wait**: how does the caller know it has stopped?
4. **Context**: does the goroutine accept `ctx` as a parameter, and does it pass it to downstream calls?
5. **Channels**: are buffers sized for the worst case? Is `close()` the sender's responsibility?
6. **Tickers/Timers**: paired with `defer Stop()`?
7. **Panic recovery**: if this code can panic, is recovery in place?
8. **Test**: does a test exercise the cancellation path?
9. **goleak**: does the package have goleak enabled?

Reject the PR if any of 1, 2, 3 are unclear. The rest can be follow-ups.

### Reviewer's heuristics

- A `go func()` deeper than one level in a function is suspicious. The exit story is far from the spawn point.
- A bare `go someMethod()` with no surrounding `errgroup`, `WaitGroup`, or struct is almost always a bug.
- A `context.Background()` outside of `main` or a top-level service constructor is a smell.
- A `time.After` inside a loop is a smell (use a single reused timer or a ticker).
- A select with only one case (other than `ctx.Done()`) defeats the purpose; use a plain receive.

---

## Self-Assessment

- [ ] You can articulate why structured concurrency matters and why Go's lack of a built-in primitive is not a problem given `errgroup`.
- [ ] You can write the Start/Stop struct pattern from memory, including the `sync.Once` variant.
- [ ] You can explain why storing a `context.Context` in a struct field is usually wrong.
- [ ] You have set up `goleak.VerifyTestMain` in at least one project and seen it fail intentionally.
- [ ] You can describe the reaping order for a service with three components and explain why the order matters.
- [ ] When reviewing a PR with a new `go` statement, you ask the right three questions (owner, stop, wait) before approving.

---

## Summary

At middle level, leak prevention becomes a property of structure, not vigilance. The tools — `errgroup.WithContext`, the Start/Stop struct, `goleak.VerifyTestMain` — combine to make the easy thing the right thing.

- Structured concurrency keeps goroutines lexically scoped: they live and die with the function that started them.
- The Start/Stop struct pattern wraps every long-lived goroutine in a type with explicit lifecycle.
- Context propagates from `main` down, never reset in the middle.
- goleak in `TestMain` catches regressions at PR time.
- Bounded shutdown gives every `Close` a maximum wait and surfaces remaining leaks as known incidents.

The senior file applies these patterns at the boundary of a library, where the same discipline becomes a contract on the type's external API.
