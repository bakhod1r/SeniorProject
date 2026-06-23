---
layout: default
title: Cancellation Propagation — Find the Bug
parent: Cancellation Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/02-cancellation-propagation/find-bug/
---

# Cancellation Propagation — Find the Bug

Each snippet has a cancellation-related bug. Find it, explain it, and write the fix. Solutions are at the bottom of this file.

---

## Bug 1: the eager producer

```go
func produce(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < 100; i++ {
            out <- i
            if ctx.Err() != nil {
                return
            }
        }
    }()
    return out
}
```

What's wrong with this producer?

---

## Bug 2: the forgotten defer

```go
func process(parent context.Context, items []Item) error {
    ctx, _ := context.WithTimeout(parent, 5*time.Second)
    for _, item := range items {
        if err := doItem(ctx, item); err != nil {
            return err
        }
    }
    return nil
}
```

What's the bug?

---

## Bug 3: the captured loop variable

```go
func processAll(ctx context.Context, items []Item) {
    for _, item := range items {
        go func() {
            process(ctx, item)
        }()
    }
}
```

What's the bug, and does it affect cancellation?

---

## Bug 4: the leaked consumer

```go
func consume(ctx context.Context, in <-chan int) {
    for v := range in {
        select {
        case <-ctx.Done():
            return
        default:
        }
        process(v)
    }
}
```

What can leak here?

---

## Bug 5: the cancel from the wrong scope

```go
func runWorker(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    go worker(ctx)
    cancel() // <-- cancels immediately
}
```

What's happening?

---

## Bug 6: the silent timeout

```go
func handler(w http.ResponseWriter, r *http.Request) {
    db.Query("SELECT * FROM table")
    fmt.Fprintln(w, "OK")
}
```

Why is this dangerous under load?

---

## Bug 7: the unguarded send

```go
func stage(ctx context.Context, in <-chan int, out chan<- int) {
    for v := range in {
        out <- v * 2
        if ctx.Err() != nil {
            return
        }
    }
}
```

What happens if the downstream consumer stops reading?

---

## Bug 8: the double close

```go
func combine(ctx context.Context, a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for v := range a {
            out <- v
        }
        close(out)
    }()
    go func() {
        for v := range b {
            out <- v
        }
        close(out)
    }()
    return out
}
```

What's wrong?

---

## Bug 9: the errgroup with wrong context

```go
func runAll(parent context.Context) error {
    g, _ := errgroup.WithContext(parent)
    g.Go(func() error {
        return work(parent) // <-- 
    })
    g.Go(func() error {
        return work(parent)
    })
    return g.Wait()
}
```

What's the issue?

---

## Bug 10: the defer-in-loop

```go
func processBatch(parent context.Context, items []Item) error {
    for _, item := range items {
        ctx, cancel := context.WithTimeout(parent, time.Second)
        defer cancel()
        if err := process(ctx, item); err != nil {
            return err
        }
    }
    return nil
}
```

What's wrong?

---

## Bug 11: cancel before drain

```go
func find(ctx context.Context, target int, in <-chan int) (int, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    for v := range in {
        if v == target {
            cancel()
            return v, nil // <-- early return
        }
    }
    return 0, errors.New("not found")
}
```

What can go wrong?

---

## Bug 12: the missing close

```go
func filter(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for v := range in {
            if v%2 == 0 {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }
    }()
    return out
}
```

The downstream `range out` hangs. Why?

---

## Bug 13: select with default

```go
func poll(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
            checkSomething()
        }
    }
}
```

What's the performance issue?

---

## Bug 14: context-less Sleep

```go
func retry(ctx context.Context, fn func() error) error {
    for i := 0; i < 3; i++ {
        if err := fn(); err == nil {
            return nil
        }
        time.Sleep(time.Second) // <-- 
    }
    return errors.New("max attempts")
}
```

Bug?

---

## Bug 15: handler that ignores ctx

```go
func handler(w http.ResponseWriter, r *http.Request) {
    rows, err := db.Query("SELECT * FROM big_table WHERE x = $1", x)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    defer rows.Close()
    for rows.Next() {
        // ...
    }
}
```

What's the cancellation bug?

---

## Bug 16: cancel-after-success

```go
ctx, cancel := context.WithTimeout(context.Background(), time.Second)
defer cancel()
result, err := doWork(ctx)
if err != nil {
    return err
}
saveToBackground(ctx, result) // <-- 
return nil
```

Why is this risky?

---

## Bug 17: the wedged producer

```go
func produce(done <-chan struct{}, out chan<- int) {
    for i := 0; i < 100; i++ {
        out <- i // <-- 
    }
    close(out)
}
```

Why does this leak?

---

## Bug 18: race on the cancel function

```go
type Worker struct {
    cancel context.CancelFunc
}

func (w *Worker) Start(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    w.cancel = cancel
    go w.run(ctx)
}

func (w *Worker) Stop() {
    w.cancel()
}
```

What if `Stop` is called before `Start` completes?

---

## Bug 19: the asymmetric cancel

```go
func parallel(ctx context.Context, fns []func(context.Context) error) error {
    var wg sync.WaitGroup
    errCh := make(chan error, len(fns))
    for _, fn := range fns {
        fn := fn
        wg.Add(1)
        go func() {
            defer wg.Done()
            if err := fn(ctx); err != nil {
                errCh <- err
            }
        }()
    }
    wg.Wait()
    close(errCh)
    return <-errCh
}
```

What's wrong with returning errors this way?

---

## Bug 20: the optimistic cancel

```go
go func() {
    if condition {
        cancel()
    }
}()
expensive(ctx) // <-- 
```

What's wrong with this race?

---

## Solutions

### Bug 1 — Eager producer

The send `out <- i` is not cancellable. After `cancel`, the send blocks if the consumer has stopped reading. The `ctx.Err()` check is after the send — too late.

Fix:

```go
for i := 0; i < 100; i++ {
    select {
    case out <- i:
    case <-ctx.Done():
        return
    }
}
```

### Bug 2 — Forgotten defer

The `_` discards the cancel function. The timer leaks (lives until it fires). `go vet` catches this as `lostcancel`.

Fix: assign and defer:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
```

### Bug 3 — Captured loop variable

In Go < 1.22, all goroutines share the same `item`. By the time they run, `item` is the last value. Cancellation works fine; the bug is the value.

Fix (works on all versions): `item := item` before the goroutine, or pass as parameter.

### Bug 4 — Leaked consumer

If `in` is never closed, the `range` blocks forever even after `ctx.Done()`. The `default` in the select makes it a non-blocking check, so it polls each iteration — but only when an item arrives. Between items, the consumer is blocked.

Fix:

```go
for {
    select {
    case <-ctx.Done():
        return
    case v, ok := <-in:
        if !ok {
            return
        }
        process(v)
    }
}
```

### Bug 5 — Cancel from the wrong scope

`cancel()` is called immediately after starting the worker, cancelling the context the worker just received. The worker exits immediately.

Fix: don't cancel until you actually want to. Use `defer cancel()` if appropriate.

### Bug 6 — Silent timeout

`db.Query` is not context-aware. If the client disconnects, the query continues until the DB returns. DB connections accumulate.

Fix: `db.QueryContext(r.Context(), "SELECT ...")`.

### Bug 7 — Unguarded send

If the consumer stops, `out <- v*2` blocks forever. The `ctx.Err()` check happens after, too late.

Fix:

```go
select {
case out <- v*2:
case <-ctx.Done():
    return
}
```

### Bug 8 — Double close

Both goroutines try to close `out`. The second `close` panics.

Fix: use a `WaitGroup` and a single closer:

```go
var wg sync.WaitGroup
wg.Add(2)
go func() { defer wg.Done(); for v := range a { out <- v } }()
go func() { defer wg.Done(); for v := range b { out <- v } }()
go func() { wg.Wait(); close(out) }()
```

### Bug 9 — Wrong context

The errgroup's context is discarded (`_`). The goroutines use `parent`, which does not cancel on sibling errors.

Fix:

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return work(ctx) })
```

### Bug 10 — Defer in loop

`defer cancel()` runs at function return, not loop iteration. Cancels accumulate.

Fix: wrap in an IIFE or move to a function:

```go
for _, item := range items {
    err := func() error {
        ctx, cancel := context.WithTimeout(parent, time.Second)
        defer cancel()
        return process(ctx, item)
    }()
    if err != nil {
        return err
    }
}
```

### Bug 11 — Cancel before drain

When `find` returns early, no one reads `in`. The producer may be wedged on its next send. Goroutine leaks.

Fix: drain on early exit:

```go
go func() {
    for range in {
    }
}()
return v, nil
```

Or design the producer to also respect the shared `ctx`.

### Bug 12 — Missing close

The goroutine has no `defer close(out)`. When `in` closes or `ctx` cancels, the goroutine returns but `out` stays open. Downstream `range out` hangs.

Fix: add `defer close(out)` at the top of the goroutine.

### Bug 13 — Select with default (busy poll)

The `default` makes the select non-blocking. After `cancel`, `<-ctx.Done()` always wins; the loop exits immediately. But before that, the goroutine busy-spins `checkSomething()` continuously, pegging a core.

Fix: do not use `default` for cancellation. Block on the actual condition, with `<-ctx.Done()` as one option.

### Bug 14 — Context-less Sleep

`time.Sleep` cannot be cancelled. Cancellation does not interrupt the retry.

Fix:

```go
select {
case <-ctx.Done():
    return ctx.Err()
case <-time.After(time.Second):
}
```

### Bug 15 — Handler ignores ctx

`db.Query` (not `QueryContext`) does not see client disconnect. The query runs to completion. Resources leak under load.

Fix: `db.QueryContext(r.Context(), ...)`.

### Bug 16 — Cancel after success

`saveToBackground(ctx, ...)` uses a context that is about to be cancelled by `defer cancel()`. If `save` is async, it sees a cancelled context immediately.

Fix: use a fresh context for background work, or `context.WithoutCancel(ctx)`.

### Bug 17 — Wedged producer

The send `out <- i` is not guarded by `done`. If the consumer stops, the producer wedges. The producer never sees `done`.

Fix:

```go
select {
case out <- i:
case <-done:
    return
}
```

### Bug 18 — Race on cancel

If `Stop` runs concurrently with `Start`, `w.cancel` may be `nil`. The `Stop` panics.

Fix: synchronise initialization (mutex, sync.Once, or constructor pattern).

### Bug 19 — Asymmetric cancel

If multiple goroutines error, only the first is read (channel has capacity but only one read). The rest are lost. Also, on success, the channel is empty, and `<-errCh` returns the zero value (nil error) — actually correct here because of the close, but only because of the close. Slightly fragile.

Fix: collect all errors:

```go
var errs []error
for e := range errCh {
    errs = append(errs, e)
}
return errors.Join(errs...)
```

Or use `errgroup`.

### Bug 20 — Optimistic cancel

If the goroutine runs and calls `cancel()` before `expensive(ctx)` starts, then `expensive` sees a pre-cancelled context. Depending on the function, this may exit immediately. The "if condition" was meant to cancel only if needed, but the timing race means it can cancel pre-emptively.

Fix: synchronise the cancel decision. For example, do the check before spawning:

```go
if condition {
    return
}
expensive(ctx)
```

If the cancel must be asynchronous (e.g. external trigger), document the race and accept that `expensive` may not start.

---

## Tips for finding cancellation bugs

- Look for `time.Sleep` — should be `select` with `time.After`.
- Look for unguarded sends and receives — should be in `select` with `<-ctx.Done()`.
- Look for missing `defer cancel()` after `WithCancel`/`WithTimeout`.
- Look for missing `defer close(out)` in producer goroutines.
- Look for `default` in cancellation `select` — usually wrong.
- Look for context stored in struct fields — usually a sign of misuse.
- Look for `db.Query` without `QueryContext` — leak waiting to happen.
- Run with `go test -race` to catch races.
- Use `goleak` to find goroutine leaks.

The bugs above are paraphrased from real production code. Internalising the fixes makes them easier to spot in the wild.
