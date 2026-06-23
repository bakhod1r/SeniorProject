---
layout: default
title: WaitGroups — Senior
parent: WaitGroups
grand_parent: sync Package
nav_order: 3
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/02-waitgroups/senior/
---

# WaitGroups — Senior

← Back to WaitGroups

At the senior level we move beyond "how to use WaitGroup" and look at:

- The exact happens-before guarantees the Go memory model assigns to `Add`, `Done`, and `Wait`.
- When `errgroup` should be your default and when `WaitGroup` still wins.
- Combining WaitGroup with `context.Context` for cancellable fan-out.
- Fan-out / fan-in patterns and their interaction with channels.
- WaitGroup ergonomics for libraries.

---

## 1. The Go memory model and WaitGroup

The Go memory model defines happens-before relationships between synchronisation operations. For `WaitGroup`:

> "In the terminology of the Go memory model, the call to `wg.Done()` synchronises before the return of any `wg.Wait()` call that it unblocks."

Concretely:

```
goroutine A           goroutine B
                      wg.Add(1)
                      go { ... wg.Done() }   // (D)
                      wg.Wait()              // (W)
                      // observes everything done before (D)
```

Any write performed in goroutine A before its `wg.Done()` is visible to goroutine B after `wg.Wait()` returns. This is what allows the standard pattern of "fill a slice in goroutines, read it after Wait" to be correct without any additional synchronisation:

```go
out := make([]int, len(items))
var wg sync.WaitGroup
wg.Add(len(items))
for i, it := range items {
    go func(i int, it Item) {
        defer wg.Done()
        out[i] = compute(it)              // write
    }(i, it)
}
wg.Wait()
// all writes to out[*] are visible here
process(out)
```

If `Wait` did not provide this guarantee, you'd need a mutex or atomics around every store and load. The memory model spares you that.

The dual rule: positive `Add` calls must happen-before the matching `Wait`. Without that, the counter could be observed as zero too early.

---

## 2. Why `Add` must precede `Wait`: a concurrency-theoretic view

Think of the counter as a *strict atomic*. A `Wait` reads the counter; if it sees zero, it returns. If `Add(1)` is concurrent with `Wait`, you have a write-read race on the same atomic word: the read may legally observe the pre-Add value. Then `Wait` returns, the goroutine starts, and there is no waiter.

This is not a bug in `WaitGroup` — it is a consequence of how all counter-based barriers must work. The same constraint exists for Java's `Phaser`, C++'s `std::latch`, and `pthread_barrier_t`. The fix is the same in all languages: register before forking.

---

## 3. errgroup internals (a guided tour)

`x/sync/errgroup` is small enough to read in one sitting:

```go
type Group struct {
    cancel  context.CancelFunc
    wg      sync.WaitGroup
    sem     chan token
    errOnce sync.Once
    err     error
}

func (g *Group) Go(f func() error) {
    if g.sem != nil { g.sem <- token{} }
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        defer func() { if g.sem != nil { <-g.sem } }()
        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil { g.cancel(g.err) }
            })
        }
    }()
}

func (g *Group) Wait() error {
    g.wg.Wait()
    if g.cancel != nil { g.cancel(g.err) }
    return g.err
}
```

Observations:

- The internal mechanism is a `sync.WaitGroup` plus a `sync.Once` for first-error capture.
- `Add` is called in `Go`, *before* the inner `go` keyword — exactly the rule we taught.
- `errOnce` ensures the first error is the one returned, even if multiple workers fail.
- `cancel` propagates the error to the context, telling other workers to stop.
- `sem` is a buffered channel used as a counting semaphore for `SetLimit`.

If you understand this, you understand `errgroup`. The rest is API niceties.

---

## 4. Choosing between WaitGroup and errgroup

```
Question                                    | Use
--------------------------------------------|---------------
Tasks return errors?                        | errgroup
Need to fail-fast on first error?           | errgroup + WithContext
Need to bound concurrency?                  | errgroup.SetLimit
Just side effects, no errors?               | WaitGroup
Long-lived background loops (servers)?      | WaitGroup
Standard library / no x deps allowed?       | WaitGroup
Mixed lifetime, you spawn-on-demand?        | WaitGroup or errgroup, taste
```

A subtle point: `errgroup.WithContext` cancels the context only on the *first* error. If you want to keep running other tasks even after one fails (collecting all errors), use plain `WaitGroup` plus `errors.Join`.

---

## 5. WaitGroup with context cancellation

The WaitGroup itself doesn't know about cancellation. You combine them:

```go
func runAll(ctx context.Context, items []Item) {
    var wg sync.WaitGroup
    wg.Add(len(items))
    for _, it := range items {
        go func(it Item) {
            defer wg.Done()
            select {
            case <-ctx.Done():
                return
            default:
            }
            process(ctx, it)
        }(it)
    }
    wg.Wait()
}
```

The check at the top is a fast path: if the context is already cancelled, skip the work. The deeper integration is to pass `ctx` *into* `process`, which then honours cancellation in I/O calls.

A timeout-on-Wait pattern:

```go
done := make(chan struct{})
go func() { wg.Wait(); close(done) }()

select {
case <-done:
case <-ctx.Done():
    // we've timed out; the goroutines are still running
    // we must still wait or we leak
    <-done
    return ctx.Err()
}
```

You can never abandon a `Wait` early without leaking — the goroutines will run to completion regardless.

---

## 6. Fan-out / fan-in with WaitGroup

Classic pipeline:

```go
func pipeline(in <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup

    workers := runtime.NumCPU()
    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                out <- transform(v)
            }
        }()
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

The "closer" goroutine is the key idiom: a separate goroutine waits for all workers, then closes the output channel. This signals downstream that no more values will arrive. Without this closer, `Wait` would block in the producer's goroutine and deadlock.

Memorise this layout — it's the spine of every Go pipeline stage.

---

## 7. Library API: hide your WaitGroup

When designing libraries, exposing a `WaitGroup` in your API is almost always a mistake. The caller can copy it, miscount it, or call `Wait` from the wrong place. Hide it behind methods:

```go
type Worker struct {
    wg     sync.WaitGroup
    cancel context.CancelFunc
}

func (w *Worker) Start(ctx context.Context) {
    ctx, w.cancel = context.WithCancel(ctx)
    w.wg.Add(1)
    go func() {
        defer w.wg.Done()
        w.run(ctx)
    }()
}

func (w *Worker) Stop() {
    w.cancel()
    w.wg.Wait()
}
```

The caller sees `Start` and `Stop`, never the `WaitGroup`. Internal correctness is your responsibility.

Embedding a `sync.WaitGroup` (anonymously) in a struct is also bad practice because it leaks `Add`, `Done`, and `Wait` onto the surface API.

---

## 8. WaitGroup and panic safety

If a goroutine panics, the program crashes — but only after the panic propagates up its goroutine's stack. If the goroutine had `defer wg.Done()`, the deferred call runs as part of panic unwinding, which means the WaitGroup is decremented before the program crashes. That's the right behaviour: any other waiting goroutines are released so finalisers and cleanup can run.

If you want a safer "recover and continue" pattern:

```go
go func() {
    defer wg.Done()
    defer func() {
        if r := recover(); r != nil {
            log.Printf("panic in worker: %v", r)
        }
    }()
    work()
}()
```

The order matters: `defer wg.Done()` is registered first, so it runs *last* during unwinding (LIFO). The `recover` runs first, and if it eats the panic, `Done` still fires normally. If you reverse the order, a panic leaks past `recover` and `Done` may not run.

Wait — actually, both orderings result in `Done` running, because `defer` always runs during panic unwinding. The reason to put `defer wg.Done()` *first* is purely for clarity: it's the last thing to fire and signals "this goroutine is finished".

---

## 9. WaitGroup with a result, but no errgroup

If you need results but can't take an `x/sync` dependency, here's a typed wrapper using only the standard library:

```go
type Task[T any] func() T

func Parallel[T any](tasks []Task[T]) []T {
    out := make([]T, len(tasks))
    var wg sync.WaitGroup
    wg.Add(len(tasks))
    for i, t := range tasks {
        go func(i int, t Task[T]) {
            defer wg.Done()
            out[i] = t()
        }(i, t)
    }
    wg.Wait()
    return out
}
```

Note the use of generics (Go 1.18+) and per-index writes. This is a perfectly idiomatic, allocation-light fan-out. For error-returning tasks, swap `T` for `(T, error)` and zip back together.

---

## 10. False sharing and per-index writes

When multiple goroutines write to *adjacent* slice indices, those indices may share a CPU cache line, causing **false sharing** — the cores invalidate each other's cache lines on every write, even though they're touching different memory locations.

```go
counts := make([]int64, runtime.NumCPU())   // 64-byte cache line, 8 bytes per int
```

For high-throughput hot loops you want each worker writing to its own cache line:

```go
type padded struct {
    v int64
    _ [7]int64       // pad to 64 bytes
}
counts := make([]padded, runtime.NumCPU())
```

This rarely matters at the senior level; we mention it because the "fan out, write to slice indexed by goroutine ID" pattern is common and false sharing can silently halve throughput.

---

## 11. WaitGroup vs counting-channel idiom

Two equivalent patterns for "wait for N goroutines":

**WaitGroup**
```go
var wg sync.WaitGroup
wg.Add(N)
for i := 0; i < N; i++ {
    go func() { defer wg.Done(); work() }()
}
wg.Wait()
```

**Counting channel**
```go
done := make(chan struct{}, N)
for i := 0; i < N; i++ {
    go func() { defer func() { done <- struct{}{} }(); work() }()
}
for i := 0; i < N; i++ {
    <-done
}
```

The counting-channel form is slightly more flexible — you can `select` on `done` together with a timeout — but more verbose. Pick WaitGroup for ergonomics, channels for flexibility.

---

## 12. WaitGroup in test helpers

Tests that need to wait for a side effect ("did the cache get warmed?") often use a small WaitGroup:

```go
func TestCacheWarmup(t *testing.T) {
    cache := NewCache()
    var wg sync.WaitGroup
    wg.Add(1)

    cache.OnWarmedUp(func() { wg.Done() })
    cache.WarmUp(ctx)

    waitOrTimeout(t, &wg, 2*time.Second)
    require.True(t, cache.IsWarm())
}

func waitOrTimeout(t *testing.T, wg *sync.WaitGroup, d time.Duration) {
    t.Helper()
    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
    case <-time.After(d):
        t.Fatalf("timeout after %v", d)
    }
}
```

Avoid `Wait()` directly in tests without a timeout — a buggy test that hangs is far worse than one that fails.

---

## 13. Performance: WaitGroup is cheap, but not free

`Add`, `Done`, and `Wait` are implemented with atomic operations on a 64-bit state word. A typical `Add` is one or two atomic CAS operations (~10ns on modern x86). For most workloads this is negligible.

Cases where it matters:

- **Hot loops that fan out per item**: starting a goroutine per byte parsed is silly; the WaitGroup overhead is in the noise but the `go` statement itself is ~1µs. Batch.
- **Pipeline stages with millions of small items**: don't use one WaitGroup per item; use one per *batch* of items.
- **Producer-consumer with millions of completions**: a buffered channel with a count is sometimes faster.

Microbenchmark a WaitGroup-of-one against a `chan struct{}`:

```go
func BenchmarkWaitGroup(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        wg.Add(1)
        go func() { wg.Done() }()
        wg.Wait()
    }
}

func BenchmarkChan(b *testing.B) {
    for i := 0; i < b.N; i++ {
        done := make(chan struct{})
        go func() { close(done) }()
        <-done
    }
}
```

On Go 1.22 these typically come within ~20% of each other; the goroutine launch dominates.

---

## 14. WaitGroup with reuse — when it's actually fine

The reuse rule says: don't have an `Add` race with the previous `Wait`. There is one common safe pattern: a long-lived "round" loop.

```go
type Coordinator struct {
    wg    sync.WaitGroup
    items chan Item
}

func (c *Coordinator) RunRound(items []Item) {
    c.wg.Add(len(items))
    for _, it := range items {
        c.items <- it
    }
    c.wg.Wait()                    // round ends; all workers idle
}
```

Each `RunRound` call is a complete cycle: `Add`, then `Wait`. There is no overlap between rounds. This is reuse, and it is safe.

Where reuse goes wrong is when round N+1's `Add` may execute before round N's `Wait` returns — typically because of `select` shenanigans or because someone called `RunRound` from two goroutines. Don't.

---

## 15. The "done" goroutine pattern

Used by `pipeline` in §6 and elsewhere:

```go
go func() {
    wg.Wait()
    close(out)
}()
```

This little goroutine has a job: wait for the pool, then close the result channel. Its purpose is to convert "all workers are done" (which the WaitGroup tracks) into "the channel is closed" (which downstream `range` loops respect). It is the single bridge between the WaitGroup world and the channel world.

You'll see it in `errgroup`, in `singleflight`, in every well-written pipeline. Recognise it on sight.

---

## 16. Anti-patterns to avoid

| Anti-pattern                                | Why it's bad                                       |
|---------------------------------------------|----------------------------------------------------|
| `Add` inside the goroutine                  | Races with `Wait`                                  |
| `WaitGroup` passed by value                 | Counter is in a copy                               |
| Embedding `sync.WaitGroup` in public struct | Leaks `Add/Done/Wait` onto the type's API          |
| Reusing without clean round boundaries      | `Add` may race with previous `Wait`                |
| WaitGroup-per-item in a hot loop            | Better to batch                                    |
| Using WaitGroup to collect results          | Use a channel or pre-allocated slice               |
| Using WaitGroup for error propagation       | Use `errgroup`                                     |
| `Wait` without a timeout in tests           | Hangs the test runner                              |

---

## 17. Self-check

1. Why is `Done` synchronisation-before any unblocked `Wait` from the memory model's point of view?
2. Why does `errgroup` internally call `Add` *before* the `go` statement?
3. What's the safest way to add a timeout to `wg.Wait()`?
4. Why does writing to per-index slice slots not need a mutex after a WaitGroup-bound fan-out?
5. When would you prefer a counting channel over a WaitGroup?

If these feel comfortable, move to [professional.md](professional.md) for the runtime internals.

---

## 18. Going deeper

- [professional.md](professional.md) — `state`, `sema`, `noCopy`, the implementation
- [specification.md](specification.md) — the formal API contract
- [find-bug.md](find-bug.md) — apply this knowledge to broken code
- [optimize.md](optimize.md) — when to replace WaitGroup entirely
