---
layout: default
title: Partial Cancellation — Find the Bug
parent: Partial Cancellation
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/02-partial-cancellation/find-bug/
---

# Partial Cancellation — Find the Bug

> Each snippet contains a real partial-cancellation bug: a missing detach, a missing timeout, a missing recovery, a wrong context, a leaked goroutine, a panic killing the process. Find it, explain it, fix it.

---

## Bug 1 — Cancelled audit

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    writeResponse(w)
    go func() {
        _ = audit.Write(ctx, event)
    }()
}
```

**Bug.** The goroutine uses `r.Context()`. When the response is written and the connection closes, `r.Context()` is cancelled. The audit insert sees a cancelled context and aborts. Audit rows are lost.

**Fix.** Detach with `WithoutCancel`:

```go
detached := context.WithoutCancel(ctx)
go func() {
    _ = audit.Write(detached, event)
}()
```

Better: also bound with a timeout and recover from panics.

---

## Bug 2 — Missing timeout

```go
func handler(w http.ResponseWriter, r *http.Request) {
    detached := context.WithoutCancel(r.Context())
    go audit.Write(detached, event)
}
```

**Bug.** The detached context has no deadline. If the audit database is slow or hung, the goroutine runs forever. Repeated under load, this leaks goroutines.

**Fix.** Add a timeout:

```go
ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
go func() {
    defer cancel()
    _ = audit.Write(ctx, event)
}()
```

---

## Bug 3 — Missing recovery

```go
func handler(w http.ResponseWriter, r *http.Request) {
    detached := context.WithoutCancel(r.Context())
    go func() {
        audit.Write(detached, event)
    }()
}
```

**Bug.** If `audit.Write` panics (perhaps on a malformed event), the entire process crashes. Goroutine panics are fatal unless recovered.

**Fix.**

```go
go func() {
    defer func() {
        if rec := recover(); rec != nil {
            log.Printf("audit panic: %v", rec)
        }
    }()
    audit.Write(detached, event)
}()
```

---

## Bug 4 — Background instead of WithoutCancel

```go
func handler(w http.ResponseWriter, r *http.Request) {
    writeResponse(w)
    go audit.Write(context.Background(), event)
}
```

**Bug.** The goroutine uses `context.Background()` instead of `WithoutCancel`. The trace ID, user ID, request ID, and other request values are lost. Audit rows have no trace context — debugging is harder.

**Fix.**

```go
go audit.Write(context.WithoutCancel(r.Context()), event)
```

---

## Bug 5 — Detached middleware

```go
func detachMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := context.WithoutCancel(r.Context())
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

**Bug.** The entire handler runs with a detached context. Every downstream call (database, HTTP, cache) ignores client disconnect. The server wastes resources on requests the client has given up on.

**Fix.** Remove the middleware. Detach only at specific points where the work must outlive the request.

---

## Bug 6 — AfterFunc on detached

```go
detached := context.WithoutCancel(parent)
context.AfterFunc(detached, func() {
    log.Println("parent cancelled")
})
```

**Bug.** `AfterFunc` registers a callback for cancellation. The detached context is never cancelled. The callback never fires. The registration is leaked (until `stop()` is called or the process exits).

**Fix.** Use `AfterFunc` on the parent, not the detached:

```go
context.AfterFunc(parent, func() {
    log.Println("parent cancelled")
})
```

Or layer cancellation:

```go
ctx, cancel := context.WithCancel(detached)
defer cancel()
context.AfterFunc(ctx, func() { /* ... */ })
```

---

## Bug 7 — Lost goroutine at shutdown

```go
func handler(w http.ResponseWriter, r *http.Request) {
    detached := context.WithoutCancel(r.Context())
    go audit.Write(detached, event)
}
```

**Bug.** No tracking. At shutdown, in-flight detached goroutines may be killed before completing. Audit rows are lost.

**Fix.** Track with a WaitGroup:

```go
var auditWG sync.WaitGroup

func handler(w http.ResponseWriter, r *http.Request) {
    auditWG.Add(1)
    detached := context.WithoutCancel(r.Context())
    go func() {
        defer auditWG.Done()
        ctx, cancel := context.WithTimeout(detached, 5*time.Second)
        defer cancel()
        _ = audit.Write(ctx, event)
    }()
}

func Shutdown(ctx context.Context) error {
    done := make(chan struct{})
    go func() { auditWG.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

---

## Bug 8 — Detach inside errgroup goroutine

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error {
    detached := context.WithoutCancel(ctx)
    return fetchA(detached)
})
```

**Bug.** The errgroup's purpose is to coordinate cancellation among its goroutines. Detaching inside a goroutine defeats this — the goroutine ignores the errgroup's cancellation. If sibling fails, this goroutine keeps running.

**Fix.** If this goroutine should be coordinated, use `ctx` directly:

```go
g.Go(func() error { return fetchA(ctx) })
```

If this goroutine should be independent, do not put it in the errgroup:

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return fetchA(ctx) }) // coordinated

detached := context.WithoutCancel(parent)
go bestEffortFetch(detached) // independent
```

---

## Bug 9 — Singleflight without detach

```go
v, err, _ := sf.Do(key, func() (any, error) {
    return load(parent, key)
})
```

**Bug.** The work function uses the *first caller's* context. If the first caller cancels, the work is cancelled, and *all* waiting callers see the cancellation error — even those who did not cancel.

**Fix.** Use a detached context in the work function:

```go
v, err, _ := sf.Do(key, func() (any, error) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
    defer cancel()
    return load(ctx, key)
})
```

---

## Bug 10 — Cancel function called too early

```go
func handler(w http.ResponseWriter, r *http.Request) {
    detached := context.WithoutCancel(r.Context())
    ctx, cancel := context.WithTimeout(detached, 5*time.Second)
    cancel() // <-- BUG: cancels immediately
    go func() {
        if err := audit.Write(ctx, event); err != nil {
            log.Printf("audit: %v", err)
        }
    }()
}
```

**Bug.** `cancel()` is called immediately, cancelling the context before the goroutine even starts. The audit write fails with "context canceled."

**Fix.** Defer the cancel inside the goroutine:

```go
go func() {
    defer cancel()
    if err := audit.Write(ctx, event); err != nil {
        log.Printf("audit: %v", err)
    }
}()
```

---

## Bug 11 — Channel closed twice

```go
type Pool struct {
    work chan func()
}

func (p *Pool) Drain() {
    close(p.work)
}

// Called twice (e.g., from two shutdown handlers).
```

**Bug.** Closing a closed channel panics. If `Drain` is called twice (e.g., from `SIGTERM` and from `main` returning), the second close panics.

**Fix.** Use a sync.Once or a draining sentinel:

```go
type Pool struct {
    work    chan func()
    drainOnce sync.Once
}

func (p *Pool) Drain() {
    p.drainOnce.Do(func() { close(p.work) })
}
```

---

## Bug 12 — Stale token in detached call

```go
func handler(w http.ResponseWriter, r *http.Request) {
    token := tokenFromCtx(r.Context())
    detached := context.WithoutCancel(r.Context())
    go func() {
        time.Sleep(10 * time.Minute)
        // token's TTL is 5 minutes; it has expired
        callDownstream(detached, token)
    }()
}
```

**Bug.** The captured `token` has a 5-minute TTL. The detached goroutine uses it 10 minutes later. The downstream rejects the expired token. The call fails.

**Fix.** Use a long-lived service-account token, or refresh in the detached goroutine.

---

## Bug 13 — Unbounded fan-out

```go
func processBatch(items []Item) {
    for _, it := range items {
        go func(it Item) {
            ctx := context.WithoutCancel(parent)
            _ = process(ctx, it)
        }(it)
    }
}
```

**Bug.** Spawning one detached goroutine per item is unbounded. For a batch of 10,000 items, 10,000 concurrent goroutines hit the database simultaneously.

**Fix.** Use a bounded pool:

```go
for _, it := range items {
    it := it
    _ = pool.Submit(parent, "process", func(ctx context.Context) error {
        return process(ctx, it)
    })
}
```

The pool's worker count caps concurrency.

---

## Bug 14 — Wrong cancel passed to defer

```go
detached := context.WithoutCancel(parent)
ctx, cancel := context.WithTimeout(detached, 5*time.Second)
ctx2, cancel2 := context.WithCancel(ctx)
defer cancel() // <-- BUG: defers the outer cancel
go work(ctx2)
```

**Bug.** The defer cancels the timeout-context, not the inner cancel-context. The inner one is leaked.

**Fix.**

```go
defer cancel2()
defer cancel()
```

Or restructure so each cancel has a clear owner.

---

## Bug 15 — Context capture across loop

```go
for _, item := range items {
    detached := context.WithoutCancel(parent)
    go func() {
        process(detached, item) // <-- BUG: captures loop var
    }()
}
```

**Bug.** Before Go 1.22, the loop variable `item` is shared. All goroutines see the same final value.

**Fix.** Pass as parameter or copy locally:

```go
for _, item := range items {
    item := item
    detached := context.WithoutCancel(parent)
    go func() { process(detached, item) }()
}
```

In Go 1.22+, the per-iteration scoping fixes this automatically, but writing the explicit version is still clearer.

---

## Bug 16 — Drain that does not wait

```go
func (p *Pool) Drain() error {
    close(p.work)
    return nil
}
```

**Bug.** Drain returns immediately without waiting for in-flight work. In-flight work may be killed when the process exits.

**Fix.**

```go
func (p *Pool) Drain(ctx context.Context) error {
    close(p.work)
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

---

## Bug 17 — Submit during drain

```go
func (p *Pool) Submit(work func()) {
    p.work <- work
}

func (p *Pool) Drain() {
    close(p.work)
}

// If Submit is called after Drain, sending on a closed channel panics.
```

**Bug.** After draining, new submissions panic.

**Fix.** Add a draining sentinel:

```go
func (p *Pool) Submit(work func()) error {
    select {
    case <-p.draining:
        return errors.New("draining")
    default:
    }
    select {
    case p.work <- work:
        return nil
    case <-p.draining:
        return errors.New("draining")
    }
}
```

---

## Bug 18 — Cause expected to propagate

```go
parent, cancel := context.WithCancelCause(context.Background())
detached := context.WithoutCancel(parent)
cancel(errors.New("specific"))
if cause := context.Cause(detached); cause == nil {
    log.Println("BUG: expected cause to propagate")
}
```

**Bug.** The author expected `Cause(detached)` to return "specific". It returns nil. `Cause` does not propagate across `WithoutCancel`.

**Fix.** This is the documented behaviour. The author must understand it. If they need cause information, they should layer their own cancellation on top.

---

## Bug 19 — Drain budget too small

```go
func main() {
    // ... server setup ...
    <-shutdown
    drainCtx, _ := context.WithTimeout(context.Background(), 1*time.Second)
    pool.Drain(drainCtx)
}
```

**Bug.** A 1-second drain budget is too small for operations that take 5+ seconds. Most in-flight work is killed.

**Fix.** Allocate a budget appropriate for the longest operation:

```go
drainCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
pool.Drain(drainCtx)
```

Coordinate with Kubernetes `terminationGracePeriodSeconds`.

---

## Bug 20 — Detach with a struct field context

```go
type Service struct {
    ctx context.Context
}

func (s *Service) Background() {
    detached := context.WithoutCancel(s.ctx)
    go work(detached)
}
```

**Bug.** `s.ctx` is set once and reused. If it was a request context, it is stale. If it was the process context, the detach is redundant.

**Fix.** Pass the context explicitly:

```go
func (s *Service) Background(parent context.Context) {
    detached := context.WithoutCancel(parent)
    go work(detached)
}
```

Don't store contexts in struct fields.

---

## Summary

Twenty common bugs. Each takes minutes to fix. Each can cost hours of production debugging if missed.

Review code for these patterns. Add lints where possible. Train new engineers to spot them.

The pattern of partial-cancellation bugs is small. Once you know the patterns, you find them on sight.
