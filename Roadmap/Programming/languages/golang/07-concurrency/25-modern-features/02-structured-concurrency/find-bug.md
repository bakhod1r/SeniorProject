---
layout: default
title: Structured Concurrency — Find the Bug
parent: Structured Concurrency
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/02-structured-concurrency/find-bug/
---

# Structured Concurrency — Find the Bug

[← Back](../)

Each snippet below contains exactly one structured-concurrency bug. Try to
spot it before reading the diagnosis. All snippets compile and most pass
small unit tests; the failures emerge under race, load, or in production.

## Bug 1 — Bare `go` leaks

```go
func StartReport(ctx context.Context, db *sql.DB) {
    go func() {
        if err := generateReport(ctx, db); err != nil {
            log.Printf("report: %v", err)
        }
    }()
}
```

**Diagnosis.** The caller has no way to wait for `generateReport`, cancel it
beyond the passed-in `ctx`, or observe its error. If the process exits via
`os.Exit` or another goroutine panics, the report is silently abandoned. In a
long-running service this leaks goroutines on every invocation.

**Fix.** Return a join-able handle, or accept an `errgroup.Group` and a
context from the caller:

```go
func StartReport(ctx context.Context, g *errgroup.Group, db *sql.DB) {
    g.Go(func() error { return generateReport(ctx, db) })
}
```

## Bug 2 — `errgroup.Group{}` without `WithContext`

```go
func loadAll(ctx context.Context) (User, Posts, error) {
    var g errgroup.Group
    var u User
    var p Posts

    g.Go(func() error {
        var err error
        u, err = fetchUser(ctx)
        return err
    })
    g.Go(func() error {
        var err error
        p, err = fetchPosts(ctx)
        return err
    })

    if err := g.Wait(); err != nil {
        return User{}, nil, err
    }
    return u, p, nil
}
```

**Diagnosis.** If `fetchUser` fails fast, `fetchPosts` keeps running because
no derived context is cancelled. The function waits for the (potentially
long) `fetchPosts` even though its result is already useless. This is
wasted work and, worse, can keep upstream resources busy.

**Fix.** Use `errgroup.WithContext` and pass the derived context to children:

```go
g, gctx := errgroup.WithContext(ctx)
g.Go(func() error { … fetchUser(gctx) … })
g.Go(func() error { … fetchPosts(gctx) … })
```

## Bug 3 — `Wait` before `Go`

```go
func runBatch(items []Item) error {
    var g errgroup.Group
    err := g.Wait() // <-- here

    for _, it := range items {
        it := it
        g.Go(func() error { return process(it) })
    }
    return err
}
```

**Diagnosis.** `Wait` sees an empty `WaitGroup` and returns `nil` immediately.
The `Go` calls then schedule goroutines that are never joined by anyone.
`runBatch` returns "successfully" while the batch is still running, and the
caller may close resources the goroutines still need.

**Fix.** `Wait` must come after every `Go`:

```go
for _, it := range items {
    it := it
    g.Go(func() error { return process(it) })
}
return g.Wait()
```

## Bug 4 — Goroutine ignores `ctx`

```go
func loadAll(ctx context.Context) error {
    g, gctx := errgroup.WithContext(ctx)
    g.Go(func() error {
        return fetchA(gctx) // respects context
    })
    g.Go(func() error {
        time.Sleep(10 * time.Second) // ignores gctx
        return doB()
    })
    return g.Wait()
}
```

**Diagnosis.** If `fetchA` fails, `gctx` is cancelled, but goroutine B sleeps
through the cancellation. `g.Wait` blocks for the full 10 seconds. Multiply
by many requests and the service queues up.

**Fix.** Use a cancellable sleep:

```go
select {
case <-time.After(10 * time.Second):
case <-gctx.Done():
    return gctx.Err()
}
```

## Bug 5 — Panic in `Go` callback

```go
func runTasks(ctx context.Context, tasks []Task) error {
    g, gctx := errgroup.WithContext(ctx)
    for _, t := range tasks {
        t := t
        g.Go(func() error {
            return t.Run(gctx) // may panic on invalid input
        })
    }
    return g.Wait()
}
```

**Diagnosis.** `errgroup` does not catch panics. A panic in `t.Run` skips
`g.wg.Done()`, so `g.Wait` blocks forever and the parent function never
returns. In production this looks like a "stuck" request that never times
out (until the surrounding context cancels — but `Wait` still waits for the
panicked goroutine, which never marks itself done).

Actually, the goroutine *does* unwind through `defer g.done()` in newer
`errgroup` versions if the panic propagates — but it still crashes the
process. Either way, you almost certainly want defensive recovery in
production library code.

**Fix.** Wrap the callback to recover:

```go
g.Go(func() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("task panic: %v\n%s", r, debug.Stack())
        }
    }()
    return t.Run(gctx)
})
```

## Bug 6 — Capturing the loop variable (pre-1.22)

```go
func runAll(ctx context.Context, items []Item) error {
    g, gctx := errgroup.WithContext(ctx)
    for _, it := range items {
        g.Go(func() error { return process(gctx, it) })
    }
    return g.Wait()
}
```

**Diagnosis.** On Go 1.21 and earlier, `it` is one variable reused across
iterations. By the time the goroutines run, every closure sees the last
value of `it`. Bug manifests as "always processes the last item, N times".

**Fix.** Either upgrade to Go 1.22+ (per-iteration variable) *or* rebind:

```go
for _, it := range items {
    it := it
    g.Go(func() error { return process(gctx, it) })
}
```

## Bug 7 — Shared mutable state without sync

```go
func collectStats(ctx context.Context, ids []string) (map[string]int, error) {
    g, gctx := errgroup.WithContext(ctx)
    result := make(map[string]int)
    for _, id := range ids {
        id := id
        g.Go(func() error {
            n, err := count(gctx, id)
            if err != nil { return err }
            result[id] = n // unsynchronised map write
            return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return result, nil
}
```

**Diagnosis.** Concurrent writes to a Go map are a data race; the runtime
will detect it (`fatal error: concurrent map writes`) and crash. The bug
hides on cold paths and explodes under load.

**Fix.** Either pre-allocate slots and write to distinct indices (slice, not
map), guard the map with a `sync.Mutex`, or use `sync.Map`:

```go
var mu sync.Mutex
…
g.Go(func() error {
    n, err := count(gctx, id)
    if err != nil { return err }
    mu.Lock()
    result[id] = n
    mu.Unlock()
    return nil
})
```

## Bug 8 — `SetLimit` after `Go`

```go
g, gctx := errgroup.WithContext(ctx)
g.Go(func() error { return work(gctx) })
g.SetLimit(8) // <-- panic risk
```

**Diagnosis.** `SetLimit` panics if any goroutines are still active in the
group. The race is non-deterministic: if the `Go` callback returns before
`SetLimit` runs, you get away with it. Otherwise: `panic: errgroup: modify
limit while N goroutines in the group are still active`.

**Fix.** Always set the limit *before* the first `Go`.

## Bug 9 — Forgetting to read result variables after `Wait`

```go
g, _ := errgroup.WithContext(ctx)
var users []User
g.Go(func() error {
    var err error
    users, err = fetchUsers(ctx)
    return err
})
go reportProgress(users) // reads users before Wait
_ = g.Wait()
```

**Diagnosis.** Two problems. First, `reportProgress` reads `users` racing
with the goroutine's write — the race detector will fire. Second, even
without the race, the read happens before the write, so `users` is `nil`.
Structured concurrency dictates: read shared results *only* after `Wait`.

**Fix.** Sequence the read after `Wait`:

```go
if err := g.Wait(); err != nil { … }
reportProgress(users)
```

## Bug 10 — Closing a channel from inside `Go`, reading outside

```go
ch := make(chan Result)
g, gctx := errgroup.WithContext(ctx)
g.Go(func() error {
    defer close(ch)
    for _, x := range work {
        select {
        case ch <- process(x):
        case <-gctx.Done():
            return gctx.Err()
        }
    }
    return nil
})
for r := range ch { use(r) } // outside the group
_ = g.Wait()
```

**Diagnosis.** The function returns from the `for range ch` loop when `close`
runs — but if the producer returns an error, the loop ends and the caller
proceeds with partial output. Worse, the caller might `return` early on a
problem and never call `g.Wait`, leaving the goroutine stranded.

**Fix.** Either fully process the range *and* call `Wait`, or restructure so
the range loop is inside the same scope that owns the group:

```go
g.Go(func() error {
    for r := range ch { use(r) }
    return nil
})
return g.Wait() // single ownership boundary
```

## Bug 11 — Cancellation cause clobbered

```go
g, gctx := errgroup.WithContext(ctx)
g.Go(func() error { return errA })
g.Go(func() error { return errB })
_ = g.Wait()
cause := context.Cause(gctx) // which error?
```

**Diagnosis.** This is not a bug per se but a frequent surprise:
`context.Cause` returns only the *first* recorded error, not both. If you
need both, you must collect them yourself with a slice and a mutex, since
`errgroup` deliberately keeps only the first.

## Bug 12 — Daemon shoved into `errgroup`

```go
g, gctx := errgroup.WithContext(ctx)
g.Go(func() error {
    for range time.Tick(time.Second) {
        select {
        case <-gctx.Done(): return nil
        default: flush()
        }
    }
})
g.Go(func() error { return processRequest(gctx) })
return g.Wait() // never returns
```

**Diagnosis.** The first `Go` is a daemon that runs until `gctx` is cancelled.
The second `Go` is a short-lived task. `Wait` blocks until *both* are done,
so the function hangs until something external cancels `ctx`. Mixing
short-lived siblings with infinite daemons in one group is a structural
mistake.

**Fix.** Separate daemons from request-scoped work. Daemons get their own
lifecycle (`Start`/`Stop`); request work uses its own `errgroup`.
