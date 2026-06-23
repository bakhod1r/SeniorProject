---
layout: default
title: WaitGroups — Optimize
parent: WaitGroups
grand_parent: sync Package
nav_order: 9
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/02-waitgroups/optimize/
---

# WaitGroups — Optimize

← Back to WaitGroups

The WaitGroup is cheap, but using it in the wrong place is a common source of inefficiency and complexity. This page collects refactors: cases where the WaitGroup should be replaced with something else.

For every example we explain *why* the original is suboptimal and *what* the better idiom is.

---

## Optimization 1 — WaitGroup-of-1 → done channel

**Before**

```go
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    work()
}()
wg.Wait()
```

**After**

```go
done := make(chan struct{})
go func() {
    defer close(done)
    work()
}()
<-done
```

**Why.** A WaitGroup is overkill for a single goroutine. The done-channel pattern is more flexible: you can `select` on it with a timeout or a context, and it composes naturally into channel-based pipelines.

If you don't need the flexibility (no timeout, no select), either form is fine — the WaitGroup version is one line shorter to read.

---

## Optimization 2 — `WaitGroup` + error-channel → `errgroup`

**Before**

```go
errs := make(chan error, len(items))
var wg sync.WaitGroup
wg.Add(len(items))
for _, it := range items {
    go func(it Item) {
        defer wg.Done()
        if err := process(it); err != nil {
            errs <- err
        }
    }(it)
}
wg.Wait()
close(errs)
var firstErr error
for err := range errs {
    if firstErr == nil {
        firstErr = err
    }
}
return firstErr
```

**After**

```go
var g errgroup.Group
for _, it := range items {
    it := it
    g.Go(func() error { return process(it) })
}
return g.Wait()
```

**Why.** `errgroup` already encapsulates the WaitGroup-plus-error-channel pattern. The original is correct but hand-rolled. The replacement is shorter, has fail-fast semantics with `WithContext`, and gets concurrency limits via `SetLimit` for free.

Use `errgroup` whenever the goroutines can fail and you want first-error semantics.

---

## Optimization 3 — One goroutine per item → bounded worker pool

**Before**

```go
var wg sync.WaitGroup
wg.Add(len(items))
for _, it := range items {
    go func(it Item) {
        defer wg.Done()
        process(it)              // expensive
    }(it)
}
wg.Wait()
```

If `len(items)` is a million, spawning a million goroutines is wasteful (memory, scheduler overhead, contention on shared resources).

**After**

```go
const workers = 64
jobs := make(chan Item)
var wg sync.WaitGroup
wg.Add(workers)
for i := 0; i < workers; i++ {
    go func() {
        defer wg.Done()
        for it := range jobs {
            process(it)
        }
    }()
}
for _, it := range items {
    jobs <- it
}
close(jobs)
wg.Wait()
```

**Why.** A fixed pool bounds memory and reduces scheduling churn. If `process` makes external calls (DB, HTTP), the pool also serves as a concurrency limit on the downstream system.

For pre-bounded `errgroup`:

```go
g := new(errgroup.Group)
g.SetLimit(64)
for _, it := range items {
    it := it
    g.Go(func() error { return process(it) })
}
err := g.Wait()
```

`SetLimit(64)` makes `Go` block until a slot frees up, equivalent to a 64-worker pool but in `errgroup` style.

---

## Optimization 4 — Per-item WaitGroup → batched WaitGroup

**Before**

```go
for _, batch := range batches {
    for _, it := range batch.Items {
        var wg sync.WaitGroup       // per-item!
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            process(it)
        }(it)
        wg.Wait()
    }
}
```

This serialises everything inside each batch — the `Wait` blocks before the next iteration spawns. Why have a goroutine at all?

**After**

```go
for _, batch := range batches {
    var wg sync.WaitGroup
    wg.Add(len(batch.Items))
    for _, it := range batch.Items {
        go func(it Item) {
            defer wg.Done()
            process(it)
        }(it)
    }
    wg.Wait()
}
```

**Why.** Move the WaitGroup to the batch level. All items in a batch run in parallel; each batch is sequential. This gives you the parallelism you wanted from the goroutines.

---

## Optimization 5 — WaitGroup + result channel → pre-allocated slice

**Before**

```go
type Result struct {
    I int
    V int
}
results := make(chan Result, len(items))
var wg sync.WaitGroup
wg.Add(len(items))
for i, it := range items {
    go func(i int, it Item) {
        defer wg.Done()
        results <- Result{I: i, V: compute(it)}
    }(i, it)
}
wg.Wait()
close(results)

out := make([]int, len(items))
for r := range results {
    out[r.I] = r.V
}
return out
```

**After**

```go
out := make([]int, len(items))
var wg sync.WaitGroup
wg.Add(len(items))
for i, it := range items {
    go func(i int, it Item) {
        defer wg.Done()
        out[i] = compute(it)            // each goroutine writes to its own index
    }(i, it)
}
wg.Wait()
return out
```

**Why.** The channel + struct + drain dance is unnecessary when the output is a slice indexed by position. Each goroutine writes to a unique index; `Wait` provides the visibility guarantee. The result is shorter, faster (no channel ops), and correct.

For very wide arrays where adjacent writes might cause false sharing on per-CPU data, pad the elements (rare; only at extreme throughput).

---

## Optimization 6 — WaitGroup ping-pong reuse → fresh WaitGroup per round

**Before**

```go
var wg sync.WaitGroup

for round := 0; round < N; round++ {
    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func() {
            defer wg.Done()
            doRound()
        }()
    }
    go monitor()                       // also touches wg!
    wg.Wait()
}
```

When `monitor` is involved, the boundaries between rounds blur. Reuse becomes fragile.

**After**

```go
for round := 0; round < N; round++ {
    var wg sync.WaitGroup              // fresh per round
    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func() {
            defer wg.Done()
            doRound()
        }()
    }
    wg.Wait()
    monitor()                           // synchronous, after the round
}
```

**Why.** A fresh WaitGroup per iteration eliminates any chance of the next round's `Add` racing with the current round's `Wait`. The cost is one allocation per round (16 bytes) — negligible.

Reuse is allowed but rarely worth the cognitive overhead.

---

## Optimization 7 — Streaming pattern with WaitGroup → channel-only

**Before**

```go
var wg sync.WaitGroup
wg.Add(workers)
results := make([]Result, 0)
var mu sync.Mutex

for i := 0; i < workers; i++ {
    go func() {
        defer wg.Done()
        for it := range jobs {
            r := process(it)
            mu.Lock()
            results = append(results, r)
            mu.Unlock()
        }
    }()
}
producer(jobs)
close(jobs)
wg.Wait()
```

The mutex is needed because `results` is shared. The WaitGroup is needed because there's no other completion signal.

**After**

```go
out := make(chan Result)
var wg sync.WaitGroup
wg.Add(workers)
for i := 0; i < workers; i++ {
    go func() {
        defer wg.Done()
        for it := range jobs {
            out <- process(it)
        }
    }()
}
go func() {
    wg.Wait()
    close(out)
}()

producer(jobs)
close(jobs)

var results []Result
for r := range out {
    results = append(results, r)
}
```

**Why.** The pipeline pattern — output channel + closer goroutine — eliminates the mutex. The "closer" goroutine waits on the WaitGroup and closes `out`, which makes downstream `range` terminate cleanly. The WaitGroup is still used internally, but its scope is contained inside the pipeline stage.

This composes: each stage looks identical, and stages can be chained.

---

## Optimization 8 — Atomic counter instead of WaitGroup for "any one finished"

**Before**

```go
var wg sync.WaitGroup
wg.Add(workers)
done := make(chan struct{})
for i := 0; i < workers; i++ {
    go func() {
        defer wg.Done()
        if try() {
            select {
            case done <- struct{}{}:
            default:
            }
        }
    }()
}
go func() { wg.Wait(); close(done) }()
<-done
```

We want to wait for *any* worker to succeed, but the WaitGroup waits for *all*.

**After**

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

success := make(chan struct{}, 1)
var g errgroup.Group
g.SetLimit(workers)
for i := 0; i < workers; i++ {
    g.Go(func() error {
        if try(ctx) {
            select {
            case success <- struct{}{}:
                cancel()
            default:
            }
        }
        return nil
    })
}
go func() { _ = g.Wait() }()
<-success
```

**Why.** The "first success wins" pattern is `context.WithCancel` cancelling the rest. WaitGroup alone can't express "stop the others when one succeeds"; `errgroup.WithContext` plus a success channel can.

Even simpler: if `try` returns an error on failure and nil on success, you can let `errgroup.WithContext` handle it directly with a sentinel "abort" error.

---

## Optimization 9 — `sync.Once` instead of "is initialised?" + WaitGroup

**Before**

```go
var (
    initWG sync.WaitGroup
    initialised bool
    initMu sync.Mutex
)

func ensureInit() {
    initMu.Lock()
    if !initialised {
        initialised = true
        initWG.Add(1)
        go func() {
            defer initWG.Done()
            doInit()
        }()
    }
    initMu.Unlock()
    initWG.Wait()
}
```

**After**

```go
var initOnce sync.Once

func ensureInit() {
    initOnce.Do(doInit)
}
```

**Why.** `sync.Once` is purpose-built for "run exactly once and let everyone else wait until it's done". It's lock-free on the fast path (after init) and uses a mutex only on the first concurrent call. The original is functional but reinvents a wheel that is much smaller and faster.

---

## Optimization 10 — Manual counter → atomic counter

For the rare case where you want to count completions without blocking:

**Before**

```go
type Stats struct {
    wg     sync.WaitGroup
    mu     sync.Mutex
    done   int
}

func (s *Stats) MarkDone() {
    s.mu.Lock()
    s.done++
    s.mu.Unlock()
    s.wg.Done()
}
```

**After**

```go
type Stats struct {
    wg   sync.WaitGroup
    done atomic.Int64
}

func (s *Stats) MarkDone() {
    s.done.Add(1)
    s.wg.Done()
}
```

**Why.** Mutex is overkill for an integer counter. An atomic add is faster and lock-free. The WaitGroup retains its synchronisation role; the atomic is purely for stats.

---

## Optimization 11 — Wait-with-timeout via wrapper goroutine → `context.Context` plumbing

**Before**

```go
func runAll(items []Item, timeout time.Duration) error {
    var wg sync.WaitGroup
    wg.Add(len(items))
    for _, it := range items {
        go func(it Item) {
            defer wg.Done()
            process(it)              // does not honour cancellation
        }(it)
    }
    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-time.After(timeout):
        return errors.New("timeout")
    }
}
```

The wrapper goroutine leaks if `process` doesn't return.

**After**

```go
func runAll(parent context.Context, items []Item, timeout time.Duration) error {
    ctx, cancel := context.WithTimeout(parent, timeout)
    defer cancel()
    var wg sync.WaitGroup
    wg.Add(len(items))
    for _, it := range items {
        go func(it Item) {
            defer wg.Done()
            process(ctx, it)         // honours cancellation
        }(it)
    }
    wg.Wait()
    return ctx.Err()
}
```

**Why.** Cancellation propagated *into* the workers means they actually return when the deadline expires. No leaking wrapper goroutine, no leaking work. This is the canonical Go idiom: contexts everywhere.

---

## Optimization 12 — Per-item Add(1) → batched Add(N)

**Before**

```go
for _, it := range items {
    wg.Add(1)
    go func(it Item) { defer wg.Done(); process(it) }(it)
}
```

**After**

```go
wg.Add(len(items))
for _, it := range items {
    go func(it Item) { defer wg.Done(); process(it) }(it)
}
```

**Why.** A single atomic increment instead of N. Microoptimisation, but free, and arguably clearer.

This optimisation is *not safe* if some iterations conditionally skip launching a goroutine. In that case, either count exactly the launches or `Done` for skipped iterations to balance the count. (See find-bug.md Bug 11.)

---

## Optimization 13 — `wg.Wait()` then `close(out)` → use `errgroup` directly for fan-in

**Before**

```go
out := make(chan T)
var wg sync.WaitGroup
wg.Add(workers)
for i := 0; i < workers; i++ {
    go func() {
        defer wg.Done()
        producer(out)
    }()
}
go func() {
    wg.Wait()
    close(out)
}()
for v := range out {
    consume(v)
}
```

**After (if errors matter)**

```go
out := make(chan T)
g := new(errgroup.Group)
for i := 0; i < workers; i++ {
    g.Go(func() error {
        return producer(out)
    })
}
go func() {
    _ = g.Wait()
    close(out)
}()
for v := range out {
    consume(v)
}
```

**Why.** Same shape, but you get error propagation for free if `producer` can fail.

---

## Optimization 14 — Don't use WaitGroup for one-shot signal

**Before**

```go
var wg sync.WaitGroup
wg.Add(1)
go func() {
    eventTrigger()
    wg.Done()
}()
wg.Wait()                       // wait for trigger
```

**After**

```go
trigger := make(chan struct{})
go func() {
    eventTrigger()
    close(trigger)
}()
<-trigger
```

**Why.** A `chan struct{}` closed once is the idiomatic one-shot signal. Closing is broadcast — multiple waiters all return — and it's noticeable in pprof traces, unlike a WaitGroup count of 1.

---

## Optimization 15 — Minimise WaitGroup usage in libraries

**Before**

```go
type Cache struct {
    wg sync.WaitGroup       // exposed via embedding
    sync.Mutex
    data map[string]string
}
```

**After**

```go
type Cache struct {
    mu   sync.Mutex
    data map[string]string
    refresh struct {
        wg     sync.WaitGroup    // hidden
        cancel context.CancelFunc
    }
}
```

**Why.** Embedding `sync.WaitGroup` exposes `Add`, `Done`, `Wait` to callers, who can copy or misuse them. Hide internal coordination behind explicit methods (`Start`, `Stop`).

---

## Optimization 16 — Replace WaitGroup with channel for "process one and stop"

**Before**

```go
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    process(item)
}()
wg.Wait()
result := readResult()
```

**After**

```go
result := process(item)            // synchronous!
```

**Why.** This is a real optimization in disguise: the goroutine and WaitGroup do nothing useful if you're going to wait for them anyway. Just call the function. You'd be amazed how often this lurks in real codebases.

A goroutine + WaitGroup is only useful if (a) you want concurrency with other work, or (b) you want a timeout, or (c) you want the function to outlive the caller. For (a), you do other work between `go` and `Wait`. For (b), use a context. For (c), keep the goroutine, drop the Wait.

---

## Summary table

| Pattern                                    | Replacement                                  |
|--------------------------------------------|----------------------------------------------|
| WaitGroup-of-1                             | done channel                                 |
| WaitGroup + error channel                  | errgroup.Group                               |
| Goroutine-per-item with high N             | bounded worker pool                          |
| Per-item WaitGroup                         | batched WaitGroup                            |
| WaitGroup + result channel                 | per-index slice writes                       |
| WaitGroup with shared mutable map          | mutex-protected map or sync.Map              |
| Reuse with overlapping rounds              | fresh WaitGroup per round                    |
| Streaming pattern                          | channel pipeline + closer goroutine          |
| "Any one finished"                         | errgroup + cancel                            |
| One-time init                              | sync.Once                                    |
| Wait with timeout via wrapper              | context.WithTimeout plumbed to workers       |
| Add(1) per iteration                       | Add(len(items)) once                         |
| Embedded WaitGroup in public API           | hidden field with explicit Start/Stop        |
| Goroutine + Wait that's just synchronous   | call the function directly                   |

---

## When *not* to optimise

WaitGroup is fine. It is small, fast, and idiomatic. Don't refactor working code into errgroup just because errgroup is fancier. Refactor when:

- The code is buggy (race-prone reuse, missing cancellation).
- The code is slow (one goroutine per micro-item, unbounded fan-out).
- The code is hard to read (manual error channels, hidden synchronisation).

Otherwise, leave it alone.

---

## Going deeper

- [find-bug.md](find-bug.md) — bugs that motivated some of these refactors
- [senior.md](senior.md) — when WaitGroup is the right tool
- [professional.md](professional.md) — what each WaitGroup operation actually costs
