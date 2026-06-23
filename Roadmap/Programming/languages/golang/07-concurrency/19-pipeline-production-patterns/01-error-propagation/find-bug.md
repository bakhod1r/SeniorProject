---
layout: default
title: Find the Bug
parent: Error Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/01-error-propagation/find-bug/
---

# Error Propagation in Pipelines — Find the Bug

> Each snippet contains a real bug: a leak, race, deadlock, swallowed error, lost cancellation, or misuse of a primitive. Find it, explain it, fix it.

---

## Bug 1 — Forgotten close

```go
func run(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    out := make(chan Item)

    g.Go(func() error {
        for _, it := range items {
            select {
            case <-ctx.Done(): return ctx.Err()
            case out <- it:
            }
        }
        return nil
    })

    g.Go(func() error {
        for v := range out {
            fmt.Println(v)
        }
        return nil
    })

    return g.Wait()
}
```

**Bug.** The producer's loop ends but `close(out)` is never called. The consumer's `for range out` blocks forever. `g.Wait()` blocks.

**Fix.** `defer close(out)` at the top of the producer goroutine.

---

## Bug 2 — Unguarded send

```go
g.Go(func() error {
    defer close(out)
    for _, it := range items {
        out <- it  // blocks if downstream stopped
    }
    return nil
})
```

**Bug.** No `select` on `ctx.Done()`. If a downstream stage fails and stops reading, this goroutine blocks forever on the send. `g.Wait()` never returns.

**Fix.**

```go
select {
case <-ctx.Done(): return ctx.Err()
case out <- it:
}
```

---

## Bug 3 — Captured loop variable

```go
g, ctx := errgroup.WithContext(ctx)
for _, url := range urls {
    g.Go(func() error {
        return fetch(ctx, url)
    })
}
return g.Wait()
```

**Bug.** In Go <1.22, `url` is captured by reference. All goroutines may see the same URL (the last). Output is non-deterministic.

**Fix.** Shadow the variable:

```go
for _, url := range urls {
    url := url
    g.Go(func() error {
        return fetch(ctx, url)
    })
}
```

In Go 1.22+, per-iteration scoping is the default, but explicit shadowing is safer for compatibility.

---

## Bug 4 — Swallowed error

```go
g.Go(func() error {
    err := work()
    if err != nil {
        log.Println("err:", err)
        return nil  // BUG
    }
    return nil
})
```

**Bug.** The error is logged but `nil` is returned. The pipeline reports success even though work failed. Callers have no idea.

**Fix.** Return the error:

```go
if err != nil {
    return fmt.Errorf("work: %w", err)
}
```

---

## Bug 5 — Lost wrapping

```go
return fmt.Errorf("step1: %s", err)
```

**Bug.** `%s` formats the error as a string. The wrap chain is lost. `errors.Is(returnedErr, originalSentinel)` returns false.

**Fix.** Use `%w`:

```go
return fmt.Errorf("step1: %w", err)
```

---

## Bug 6 — Reading before Wait

```go
var sum int
g.Go(func() error {
    sum = compute()
    return nil
})
fmt.Println(sum)  // BUG: race
g.Wait()
```

**Bug.** Reading `sum` before `g.Wait()` returns. The goroutine may not have finished yet. Race detector flags it.

**Fix.** Read after `Wait`:

```go
g.Wait()
fmt.Println(sum)
```

---

## Bug 7 — Multiple senders, ambiguous close

```go
g, ctx := errgroup.WithContext(ctx)
out := make(chan int)
for i := 0; i < 3; i++ {
    g.Go(func() error {
        defer close(out)  // BUG
        for j := 0; j < 10; j++ {
            out <- j
        }
        return nil
    })
}
```

**Bug.** Three goroutines all `defer close(out)`. The first close is fine; the second and third panic with "close of closed channel."

**Fix.** Use a coordinator that closes after all producers finish:

```go
var wg sync.WaitGroup
for i := 0; i < 3; i++ {
    wg.Add(1)
    g.Go(func() error {
        defer wg.Done()
        for j := 0; j < 10; j++ {
            select {
            case <-ctx.Done(): return ctx.Err()
            case out <- j:
            }
        }
        return nil
    })
}
go func() { wg.Wait(); close(out) }()
```

---

## Bug 8 — SetLimit after Go

```go
g, ctx := errgroup.WithContext(ctx)
for _, item := range items {
    g.Go(func() error { return process(item) })
}
g.SetLimit(4)  // BUG: panics
return g.Wait()
```

**Bug.** `SetLimit` after `Go` panics.

**Fix.** Set the limit before any `Go`:

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(4)
for _, item := range items {
    g.Go(func() error { return process(item) })
}
```

---

## Bug 9 — Panic in g.Go

```go
g.Go(func() error {
    if condition {
        panic("oops")
    }
    return nil
})
```

**Bug.** A panic in `g.Go` crashes the whole program. The pipeline's structured error handling is bypassed.

**Fix.** Recover with named return:

```go
g.Go(func() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    if condition {
        panic("oops")
    }
    return nil
})
```

---

## Bug 10 — Bare `go` inside g.Go

```go
g.Go(func() error {
    go logProgress(ctx)  // BUG: untracked
    return doWork(ctx)
})
```

**Bug.** `logProgress` is spawned but not tracked by the errgroup. It may outlive the pipeline. If it doesn't exit on ctx.Done(), it leaks.

**Fix.** Use a nested errgroup or wait explicitly:

```go
g.Go(func() error {
    inner, ctx := errgroup.WithContext(ctx)
    inner.Go(func() error { return logProgress(ctx) })
    err := doWork(ctx)
    if werr := inner.Wait(); err == nil { err = werr }
    return err
})
```

---

## Bug 11 — Ignored context in DB call

```go
g.Go(func() error {
    rows, err := db.Query("SELECT * FROM ...")
    if err != nil { return err }
    // ...
})
```

**Bug.** No context passed to `Query`. If errgroup cancels, the query continues. The goroutine waits for the query result indefinitely.

**Fix.** Use `QueryContext`:

```go
rows, err := db.QueryContext(ctx, "SELECT * FROM ...")
```

---

## Bug 12 — Compensator order

```go
func rollback(steps []Step) {
    for _, s := range steps {
        s.Compensate(ctx)
    }
}
```

**Bug.** Compensators run in forward order. Earlier compensators may try to undo state that depended on later steps still being in place.

**Fix.** Iterate in reverse:

```go
for i := len(steps) - 1; i >= 0; i-- {
    steps[i].Compensate(ctx)
}
```

---

## Bug 13 — Wrap nil

```go
if err != nil {
    err = doMore()
}
return fmt.Errorf("step: %w", err)
```

**Bug.** If `err` becomes nil after `doMore`, `%w` wraps nil. The returned error is non-nil but its `Unwrap` returns nil. Confusing chain.

**Fix.** Check if there's actually an error to wrap:

```go
if err != nil {
    return fmt.Errorf("step: %w", err)
}
return nil
```

---

## Bug 14 — Hangs on sibling failure

```go
g, ctx := errgroup.WithContext(ctx)
in := make(chan int)
g.Go(func() error {
    defer close(in)
    for i := 0; i < 1000; i++ {
        in <- i  // no select on ctx.Done()
    }
    return nil
})
g.Go(func() error {
    for v := range in {
        if v == 5 { return errors.New("stop") }
    }
    return nil
})
return g.Wait()
```

**Bug.** When the consumer returns at v=5, errgroup cancels ctx, but the producer's `in <- i` blocks (channel unbuffered, no receiver). Pipeline hangs.

**Fix.** `select` on `ctx.Done()` in the producer's send.

---

## Bug 15 — Recovery without logging

```go
defer func() { _ = recover() }()
```

**Bug.** The panic is silenced. No stack trace, no log. Bug is hidden.

**Fix.** Log the panic and convert to error:

```go
defer func() {
    if r := recover(); r != nil {
        log.Error("panic", "value", r, "stack", string(debug.Stack()))
        err = fmt.Errorf("panic: %v", r)
    }
}()
```

---

## Bug 16 — Mutex inside hot path

```go
var mu sync.Mutex
var results []Result
for _, item := range items {
    item := item
    g.Go(func() error {
        r := process(item)
        mu.Lock()
        results = append(results, r)
        mu.Unlock()
        return nil
    })
}
```

**Bug.** Functional but inefficient. Mutex contention serialises the result append. For high item counts, throughput suffers.

**Fix.** Use the result-slot pattern:

```go
results := make([]Result, len(items))
for i, item := range items {
    i, item := i, item
    g.Go(func() error {
        results[i] = process(item)
        return nil
    })
}
```

---

## Bug 17 — `==` comparison on wrapped error

```go
if err == io.EOF {
    // handle
}
```

**Bug.** If anyone wrapped EOF (e.g., `fmt.Errorf("read: %w", io.EOF)`), the `==` check fails.

**Fix.** Use `errors.Is`:

```go
if errors.Is(err, io.EOF) {
    // handle
}
```

---

## Bug 18 — Double Wait

```go
err1 := g.Wait()
err2 := g.Wait()  // BUG: undefined behavior
```

**Bug.** `errgroup` is single-use. Calling `Wait` twice is not specified to work and may misbehave.

**Fix.** Call `Wait` exactly once. If you need to wait from multiple places, store the error:

```go
err := g.Wait()
// use err multiple times
```

---

## Bug 19 — Reading channel after panic

```go
g.Go(func() error {
    if condition { panic("oops") }
    out <- v
    close(out)
    return nil
})
```

**Bug.** If panic happens before `out <- v` and `close(out)`, downstream readers block. The panic propagates but `defer close(out)` was not used.

**Fix.** `defer close(out)` at the top:

```go
g.Go(func() error {
    defer close(out)
    // ...
})
```

---

## Bug 20 — Mixing errgroup with bare goroutines

```go
g, ctx := errgroup.WithContext(ctx)
g.Go(work1)
go work2(ctx)  // BUG: not tracked
return g.Wait()
```

**Bug.** `work2` is not tracked by `g`. `Wait` returns when `work1` returns, even if `work2` is still running. If `work2` writes to shared state, race.

**Fix.** Both work via `g.Go`:

```go
g.Go(work1)
g.Go(func() error { work2(ctx); return nil })
```

---

## Bug 21 — Ignored TryGo return

```go
g.SetLimit(4)
for _, item := range items {
    item := item
    g.TryGo(func() error { return process(item) })  // BUG
}
```

**Bug.** `TryGo` returns false when at capacity. The item is dropped silently.

**Fix.** Either use `Go` (which blocks) or handle the false return:

```go
if !g.TryGo(...) {
    // back off, retry, or skip
}
```

---

## Bug 22 — Confusing cancel order

```go
ctx, cancel := context.WithTimeout(parent, 30*time.Second)
g, gctx := errgroup.WithContext(ctx)
g.Go(work)
cancel()  // BUG: cancels before g.Wait
return g.Wait()
```

**Bug.** `cancel()` is called before `Wait`, cancelling the context immediately. Work has barely started; it sees the cancellation right away.

**Fix.** `defer cancel()`:

```go
ctx, cancel := context.WithTimeout(parent, 30*time.Second)
defer cancel()
g, gctx := errgroup.WithContext(ctx)
g.Go(work)
return g.Wait()
```

---

## Bug 23 — String matching on errors

```go
if strings.Contains(err.Error(), "not found") {
    // handle
}
```

**Bug.** Fragile. Error message can change. Doesn't work through wraps that change the prefix.

**Fix.** Define a sentinel and use `errors.Is`:

```go
var ErrNotFound = errors.New("not found")
// in source: return fmt.Errorf("...: %w", ErrNotFound)
// in caller:
if errors.Is(err, ErrNotFound) { ... }
```

---

## Bug 24 — Wait on partially-initialised group

```go
var g errgroup.Group
done := make(chan struct{})
go func() {
    g.Wait()  // BUG
    close(done)
}()
g.Go(work1)
g.Go(work2)
<-done
```

**Bug.** The first `g.Wait` runs before any `Go`. `Wait` returns immediately (no work pending). `done` fires. Then `g.Go(work1)` runs and adds work that nobody waits for.

**Fix.** Wait after all `Go` calls:

```go
g.Go(work1)
g.Go(work2)
err := g.Wait()
```

---

## Bug 25 — Compensator that's not idempotent

```go
Compensate: func(ctx context.Context) error {
    return db.ExecContext(ctx, "INSERT INTO refunds ...")
}
```

**Bug.** If the compensator runs twice (retry, crash mid-rollback), it inserts two refund rows.

**Fix.** Use idempotent operation:

```go
return db.ExecContext(ctx, "INSERT INTO refunds ... ON CONFLICT (charge_id) DO NOTHING")
```

Or check before inserting.

---

## Bug 26 — Inflexible retry

```go
for i := 0; i < 5; i++ {
    err := op()
    if err == nil { return nil }
    time.Sleep(time.Second)
}
```

**Bug.** Three issues:
1. Retries permanent errors (no `isTransient` check).
2. No cancellation (`time.Sleep` blocks).
3. No jitter (thundering herd).

**Fix.**

```go
for i := 0; i < 5; i++ {
    err := op()
    if err == nil { return nil }
    if !isTransient(err) { return err }
    backoff := time.Duration(1<<i) * 100 * time.Millisecond
    jitter := time.Duration(rand.Int63n(int64(backoff)))
    select {
    case <-ctx.Done(): return ctx.Err()
    case <-time.After(backoff + jitter):
    }
}
```

---

## Bug 27 — Forgetting to return ctx.Err

```go
g.Go(func() error {
    for v := range in {
        select {
        case <-ctx.Done():
            // BUG: doesn't return
        case out <- transform(v):
        }
    }
    return nil
})
```

**Bug.** The `<-ctx.Done()` case runs but doesn't return. The loop continues. The select keeps firing on the closed `Done()` channel.

**Fix.** Return:

```go
case <-ctx.Done():
    return ctx.Err()
```

---

## Bug 28 — Hidden synchronization issue

```go
var done bool
g.Go(func() error {
    done = true
    return nil
})
g.Wait()
fmt.Println(done)  // OK
go func() { fmt.Println(done) }()  // BUG: race
```

**Bug.** The second `go func()` reads `done` concurrently with the writing goroutine, depending on timing. Even though `g.Wait` provides happens-before for the first read, the second goroutine is unsynchronised.

**Fix.** Use `sync/atomic` or finish all goroutines before reading.

---

## Bug 29 — Closing without all senders done

```go
g.Go(producer)
g.Go(producer)  // two producers
g.Go(func() error {
    defer close(out)  // BUG: who's the sender?
    for v := range out {
        // ...
    }
    return nil
})
```

**Bug.** The "closer" is also a consumer. It can't know when producers are done.

**Fix.** Closer should be a coordinator that waits for producers:

```go
go func() { wg.Wait(); close(out) }()
```

---

## Bug 30 — Ignoring g.Wait return

```go
g.Go(work)
g.Wait()
return nil  // BUG: discards error
```

**Bug.** The error from `Wait` is discarded. Any failure is silent.

**Fix.** Return the error:

```go
if err := g.Wait(); err != nil { return err }
return nil
```

---

## Summary

These bugs are the recurring themes:

1. **Missing close**: `defer close(out)` is mandatory in senders.
2. **Missing select**: every blocking op needs `<-ctx.Done()`.
3. **Lost errors**: log AND return; never swallow.
4. **String formatting instead of wrapping**: use `%w`.
5. **Race conditions**: don't share without sync.
6. **Hidden panics**: recover at goroutine boundaries.
7. **Wrong primitive**: `==` instead of `errors.Is`; bare `go` instead of `g.Go`.

Practice spotting these in code review. They're the most common pipeline bugs in real codebases.

After a hundred reviews, you'll spot them instantly.
