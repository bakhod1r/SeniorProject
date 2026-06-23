---
layout: default
title: errgroup — Find the Bug
parent: errgroup
grand_parent: errgroup and x/sync
ancestor: Concurrency
nav_order: 8
permalink: /roadmap/programming-languages/golang/07-concurrency/06-errgroup-x-sync/01-errgroup/find-bug/
---

# errgroup — Find the Bug

← Back to errgroup index

Twenty real-world buggy snippets. Each has a single hidden defect that has caused production outages, race-detector failures, or silent data corruption somewhere. Try to spot the bug yourself before reading the explanation.

---

## Bug 1 — Captured loop variable

```go
func process(items []Item) error {
    var g errgroup.Group
    for _, item := range items {
        g.Go(func() error {
            return doWork(item)
        })
    }
    return g.Wait()
}
```

**Bug.** Pre-Go 1.22: every goroutine sees the *same* `item` — whatever the last iteration left in it. All goroutines call `doWork` with the final element.

**Fix.**

```go
for _, item := range items {
    item := item
    g.Go(func() error { return doWork(item) })
}
```

Or upgrade to Go 1.22+ where this is fixed at the language level.

---

## Bug 2 — Ignored context

```go
func fetchAll(ctx context.Context, urls []string) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, u := range urls {
        u := u
        g.Go(func() error {
            return fetch(u) // takes no ctx
        })
    }
    return g.Wait()
}
```

**Bug.** When one fetch fails, `errgroup` cancels `ctx`. But `fetch` does not read it, so the other goroutines run to completion regardless. The "fail fast" promise is silently broken; the function returns as slowly as the slowest URL.

**Fix.** Change `fetch(u)` to `fetch(ctx, u)` and make `fetch` honour the context.

---

## Bug 3 — Using ctx after Wait

```go
func loadAll(parent context.Context) (Data, error) {
    g, ctx := errgroup.WithContext(parent)
    var partA, partB Data
    g.Go(func() error { var err error; partA, err = loadA(ctx); return err })
    g.Go(func() error { var err error; partB, err = loadB(ctx); return err })
    if err := g.Wait(); err != nil {
        return Data{}, err
    }
    final, err := loadC(ctx, partA, partB) // BUG
    if err != nil { return Data{}, err }
    return final, nil
}
```

**Bug.** `g.Wait` cancels `ctx` on return. `loadC` sees `ctx.Err() == context.Canceled` and aborts immediately.

**Fix.** Pass `parent` to `loadC`, not the derived `ctx`.

---

## Bug 4 — Setting limit after Go

```go
var g errgroup.Group
g.Go(func() error { return doA() })
g.SetLimit(4)
g.Go(func() error { return doB() })
```

**Bug.** `SetLimit` panics: "errgroup: modify limit while 1 goroutines in the group are still active." (Even if `doA` is finished, the timing of when the goroutine releases the WaitGroup vs when `SetLimit` runs is not in your control without explicit synchronisation.)

**Fix.** Move `SetLimit` to before any `Go`:

```go
var g errgroup.Group
g.SetLimit(4)
g.Go(func() error { return doA() })
g.Go(func() error { return doB() })
```

---

## Bug 5 — SetLimit(0)

```go
var g errgroup.Group
g.SetLimit(0)
g.Go(func() error { return doWork() })
g.Wait() // never returns
```

**Bug.** `SetLimit(0)` creates an unbuffered channel. The first `Go` tries to send into it. There's no receiver. Deadlock.

**Fix.** Use `-1` for unbounded or a positive integer for bounded:

```go
g.SetLimit(-1) // unlimited
// or
g.SetLimit(8)  // up to 8
```

---

## Bug 6 — Log and swallow

```go
g.Go(func() error {
    if err := process(item); err != nil {
        log.Printf("error: %v", err)
        return nil
    }
    return nil
})
```

**Bug.** The closure returns `nil` regardless of whether `process` failed. `g.Wait()` returns `nil`. The caller thinks everything succeeded. The derived context (if any) was never cancelled.

**Fix.** Return the error:

```go
g.Go(func() error {
    if err := process(item); err != nil {
        return fmt.Errorf("processing item: %w", err)
    }
    return nil
})
```

---

## Bug 7 — Race on shared map

```go
func loadAll(items []string) (map[string]int, error) {
    var g errgroup.Group
    result := make(map[string]int)
    for _, k := range items {
        k := k
        g.Go(func() error {
            v, err := load(k)
            if err != nil { return err }
            result[k] = v // RACE
            return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return result, nil
}
```

**Bug.** Concurrent writes to a map are a race (and a runtime panic if the runtime detects it). Errgroup does not synchronise map access.

**Fix.** Use a `sync.Mutex`:

```go
var mu sync.Mutex
// ...
g.Go(func() error {
    v, err := load(k)
    if err != nil { return err }
    mu.Lock()
    result[k] = v
    mu.Unlock()
    return nil
})
```

Or use `sync.Map`, or write to a slice indexed by position and assemble the map after `Wait`.

---

## Bug 8 — Self-deadlock with Wait inside Go

```go
var g errgroup.Group
g.Go(func() error {
    // ...
    return g.Wait() // deadlock
})
g.Wait()
```

**Bug.** The inner `Wait` waits for itself. Self-deadlock. The outer `Wait` also blocks forever.

**Fix.** Don't call `Wait` from inside a goroutine in the same group.

---

## Bug 9 — Reusing a Group

```go
var g errgroup.Group
g.Go(func() error { return doA() })
g.Wait()
g.Go(func() error { return doB() }) // undefined
g.Wait()
```

**Bug.** Reusing a `Group` after `Wait` is undefined behaviour. The cancel function (if any) was already called, `errOnce` is fired, the internal state is partly consumed.

**Fix.** Create a new `Group`:

```go
var g errgroup.Group
g.Go(func() error { return doA() }); g.Wait()
var g2 errgroup.Group
g2.Go(func() error { return doB() }); g2.Wait()
```

---

## Bug 10 — Closure that never returns

```go
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error {
    for {
        if work() { return nil }
    }
})
g.Go(func() error { return doB(ctx) })
g.Wait()
```

**Bug.** The first closure has no `ctx.Done()` check. If `work` keeps returning false, the goroutine runs forever, even if `doB` fails and `ctx` is cancelled.

**Fix.**

```go
g.Go(func() error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
        if work() { return nil }
    }
})
```

---

## Bug 11 — Buffered channel never closed

```go
g, ctx := errgroup.WithContext(ctx)
ch := make(chan int, 16)
g.Go(func() error {
    for _, x := range inputs {
        ch <- x
    }
    // forgot to close(ch)
    return nil
})
g.Go(func() error {
    for v := range ch { // blocks forever after producer finishes
        process(v)
    }
    return nil
})
g.Wait()
```

**Bug.** Without `close(ch)`, the consumer's `range` blocks forever after the producer is done. The producer exits, the consumer hangs, `Wait` never returns.

**Fix.** `defer close(ch)` inside the producer goroutine.

---

## Bug 12 — Unbuffered err channel + early return

```go
func process(items []Item) (Result, error) {
    g, ctx := errgroup.WithContext(ctx)
    var result Result
    for _, x := range items {
        x := x
        g.Go(func() error {
            r, err := work(ctx, x)
            if err != nil { return err }
            result = r // RACE — multiple goroutines write result
            return nil
        })
    }
    if err := g.Wait(); err != nil { return Result{}, err }
    return result, nil
}
```

**Bug.** All goroutines write to the same `result`. They race. (Also: only the last writer wins, but which one is non-deterministic.) Plus, no per-task uniqueness — all goroutines compute then overwrite.

**Fix.** Decide what you really want: one result picked among many, all results collected, or per-key results. For "first success":

```go
var result Result
var mu sync.Mutex
var once sync.Once
g.Go(func() error {
    r, err := work(ctx, x)
    if err != nil { return err }
    once.Do(func() { result = r })
    return nil
})
```

For "all results": use a slice indexed by position.

---

## Bug 13 — TryGo used wrong

```go
for _, item := range items {
    item := item
    if err := g.TryGo(func() error { return process(item) }); err != nil {
        log.Println(err)
    }
}
```

**Bug.** `TryGo` returns `bool`, not `error`. The code does not compile: "cannot use g.TryGo(...) (untyped bool value) as type error in assignment."

**Fix.**

```go
if !g.TryGo(func() error { return process(item) }) {
    log.Println("limit full")
}
```

---

## Bug 14 — Errgroup inside HTTP middleware with wrong parent

```go
func middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        g, ctx := errgroup.WithContext(context.Background()) // BUG
        for _, p := range r.URL.Query()["preload"] {
            p := p
            g.Go(func() error { return preload(ctx, p) })
        }
        if err := g.Wait(); err != nil {
            http.Error(w, err.Error(), 500)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

**Bug.** Using `context.Background()` instead of `r.Context()` means the preload goroutines do not cancel when the client disconnects. The handler will continue preloading even if the request was abandoned.

**Fix.**

```go
g, ctx := errgroup.WithContext(r.Context())
```

---

## Bug 15 — Errgroup in long-running goroutine with request context

```go
func startBackgroundWorker(r *http.Request) {
    go func() {
        g, ctx := errgroup.WithContext(r.Context()) // BUG
        for {
            // ...
        }
    }()
}
```

**Bug.** Using `r.Context()` for a long-running worker means the worker dies the moment the HTTP request finishes. Background work should not be tied to a request lifetime.

**Fix.** Use `context.Background()` or a service-scoped context that outlives the request.

---

## Bug 16 — Panic in goroutine

```go
g.Go(func() error {
    var p *Payload
    return process(p.Value) // nil dereference panic
})
g.Go(func() error { return slowOp() })
g.Wait()
```

**Bug.** The first closure panics. Errgroup does not recover panics. The process crashes; the second goroutine (and any concurrent HTTP requests in the same process) die.

**Fix.** Wrap with `defer recover()`:

```go
g.Go(func() error {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("panic: %v", r)
        }
    }()
    return process(p.Value)
})
```

The recover swallows the panic but loses the error. To convert it:

```go
g.Go(func() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return process(p.Value)
})
```

Note the named return value `err` so the deferred function can set it.

---

## Bug 17 — Reading errgroup error twice from concurrent goroutines

```go
var g errgroup.Group
g.Go(func() error { return doA() })
g.Go(func() error { return doB() })
go func() { fmt.Println(g.Wait()) }()
fmt.Println(g.Wait())
```

**Bug.** Two concurrent `Wait` calls. The internal `sync.WaitGroup.Wait` is OK with that, but the cancel function (if `WithContext`) is called twice. More importantly: it's undefined to call `Wait` more than once on the same group, and the two readers may see different errors (or both see `nil` if there's no error). The race detector may flag this.

**Fix.** Call `Wait` exactly once. If you need the result in two places, capture it:

```go
err := g.Wait()
fmt.Println(err)
go func() { fmt.Println(err) }()
```

---

## Bug 18 — Closure references stack pointer that escapes

```go
func startAll() error {
    var g errgroup.Group
    for i := 0; i < 5; i++ {
        x := compute(i)
        g.Go(func() error {
            return store(&x) // captures x by reference
        })
    }
    return g.Wait()
}
```

**Bug.** Each `x` is a fresh variable per iteration (since Go 1.22; before, you'd need `x := x`). But `store(&x)` captures by *pointer*. If the goroutine holds onto the pointer after the iteration loop, it has a valid pointer (escape analysis bumps `x` to the heap). However, if multiple iterations capture different `&x` values, that's fine; if you intended all goroutines to share one value, this is wrong; if you intended each to have its own, this is right but confusing.

The real bug: if you wrote `&x` thinking it would prevent loop-variable issues, you got escape-to-heap as a side effect, but if `compute(i)` is expensive, each iteration *also* heap-allocates one `x`. Likely fine, but the code is unclear about intent.

**Fix.** Be explicit:

```go
for i := 0; i < 5; i++ {
    x := compute(i)
    g.Go(func() error {
        return store(x) // pass by value if x is small, or &x explicitly
    })
}
```

---

## Bug 19 — Wait not called

```go
func startAll(items []Item) {
    var g errgroup.Group
    for _, x := range items {
        x := x
        g.Go(func() error { return process(x) })
    }
    // forgot g.Wait()
}
```

**Bug.** Function returns immediately. Goroutines may not have run yet. If `process` is called with a stack-only argument, escape analysis bumps it to the heap, so memory is fine — but the caller cannot observe completion, and errors are silently lost.

**Fix.** `return g.Wait()` (and change the signature to `error`). Or, if fire-and-forget is intentional, use a different abstraction — errgroup is for "wait for all of these."

---

## Bug 20 — Errgroup that always succeeds because of nil-error closure

```go
type job struct {
    err error
}

func process(jobs []*job) error {
    var g errgroup.Group
    for _, j := range jobs {
        j := j
        g.Go(func() error {
            j.err = work(j) // stores error on job
            return nil       // BUG: errgroup sees nil
        })
    }
    return g.Wait() // always returns nil
}
```

**Bug.** The closure stores the error on the job but returns `nil` to errgroup. `g.Wait` returns `nil` regardless of how many jobs failed. The caller gets a false success. If using `WithContext`, no cancellation ever fires.

**Fix.** Either return the error from the closure:

```go
g.Go(func() error {
    if err := work(j); err != nil {
        j.err = err
        return err
    }
    return nil
})
```

Or, if you genuinely want all-errors style, return `nil` deliberately and collect:

```go
// (see Task 8 in tasks.md for the correct multi-error pattern)
```

---

## Bonus — Subtle bug list

A few extra subtle ones you may encounter:

### Bonus A — Passing `g` by value to a helper

```go
func startWorker(g errgroup.Group, item Item) {
    g.Go(func() error { return process(item) })
}
```

`errgroup.Group` contains `sync.WaitGroup` which must not be copied. `go vet` catches it with `copylocks`. Always pass by pointer:

```go
func startWorker(g *errgroup.Group, item Item) {
    g.Go(func() error { return process(item) })
}
```

### Bonus B — Returning `*errgroup.Group` from a function

```go
func newGroup() *errgroup.Group {
    g, _ := errgroup.WithContext(context.Background())
    return g
}
```

This is valid but the discarded context is useless — the caller has no way to thread it. Return both, or accept the context as a parameter:

```go
func newGroup(parent context.Context) (*errgroup.Group, context.Context) {
    return errgroup.WithContext(parent)
}
```

### Bonus C — Closure that returns sentinel-style success

```go
var errDone = errors.New("done")

g.Go(func() error {
    if work() { return errDone }
    return nil
})
err := g.Wait()
if errors.Is(err, errDone) { /* treat as success */ }
```

This works (we've used it in tasks). The bug pattern is to *also* treat real errors as "done" because you forgot to distinguish. Always pair sentinel-based control flow with an `errors.Is` check that excludes the sentinel.

---

## How to use this file

1. Cover the bug explanation with your hand.
2. Read the snippet.
3. Spend 30 seconds spotting the bug.
4. Read the explanation.
5. Move on.

A senior Go engineer should catch 18 of 20 within 30 seconds each. A staff engineer should propose the fix without reading the explanation.

---

## Common themes

- **Loop-variable capture** (Bug 1, 18) — universal pre-1.22 trap.
- **Ignored context** (Bug 2, 10) — the most common errgroup-specific bug.
- **Lifecycle confusion** (Bug 3, 14, 15) — context is alive when you don't want it, dead when you do.
- **API misuse** (Bug 4, 5, 9, 13) — calling methods in the wrong order or with the wrong signature.
- **Error semantics** (Bug 6, 20) — log-and-swallow, or storing-and-not-returning.
- **Concurrency on shared state** (Bug 7, 12) — errgroup doesn't synchronise your data.
- **Panic vs error** (Bug 16) — errgroup doesn't catch panics.
- **Group reuse / Wait discipline** (Bug 8, 9, 17, 19) — Wait once, never reuse.

If you internalise these eight themes, you will catch nearly every errgroup bug in code review.
