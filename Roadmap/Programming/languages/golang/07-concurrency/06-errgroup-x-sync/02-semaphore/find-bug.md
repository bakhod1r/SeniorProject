# x/sync semaphore — Find the Bug

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Bug 1 — The Disappearing Release](#bug-1-the-disappearing-release)
3. [Bug 2 — Defer Before Error Check](#bug-2-defer-before-error-check)
4. [Bug 3 — Mismatched Weights](#bug-3-mismatched-weights)
5. [Bug 4 — Acquire Inside Goroutine](#bug-4-acquire-inside-goroutine)
6. [Bug 5 — Forgotten Context](#bug-5-forgotten-context)
7. [Bug 6 — Re-Entrant Deadlock](#bug-6-re-entrant-deadlock)
8. [Bug 7 — Cross-Semaphore Deadlock](#bug-7-cross-semaphore-deadlock)
9. [Bug 8 — Untrusted Weight](#bug-8-untrusted-weight)
10. [Bug 9 — Double Release](#bug-9-double-release)
11. [Bug 10 — Acquire Past Context](#bug-10-acquire-past-context)
12. [Bug 11 — Held Slot Across Wait](#bug-11-held-slot-across-wait)
13. [Bug 12 — Capacity Resize Attempt](#bug-12-capacity-resize-attempt)
14. [Bug 13 — Acquire-Then-Spawn Inversion](#bug-13-acquire-then-spawn-inversion)
15. [Bug 14 — Loop Variable Capture](#bug-14-loop-variable-capture)
16. [Answer Key](#answer-key)

---

## How to Use This File

Each section presents broken code. Read it carefully, predict the failure mode, then check the answer key.

The bugs are real ones seen in code review. Some are classic Go pitfalls applied to semaphores; some are semaphore-specific.

---

## Bug 1 — The Disappearing Release

```go
import "golang.org/x/sync/semaphore"

var sem = semaphore.NewWeighted(8)

func handle(ctx context.Context, item Item) error {
    if err := sem.Acquire(ctx, 1); err != nil {
        return err
    }
    if item.Skippable {
        return nil
    }
    err := process(ctx, item)
    sem.Release(1)
    return err
}
```

What is the bug?

Hint: trace the execution for `item.Skippable == true`.

---

## Bug 2 — Defer Before Error Check

```go
func handle(ctx context.Context) error {
    err := sem.Acquire(ctx, 1)
    defer sem.Release(1)
    if err != nil {
        return err
    }
    return doWork()
}
```

What is the bug?

Hint: imagine `Acquire` returns `context.Canceled`.

---

## Bug 3 — Mismatched Weights

```go
func resize(ctx context.Context, img *Image) error {
    cost := int64(img.Width * img.Height * 4)
    if err := sem.Acquire(ctx, cost); err != nil {
        return err
    }
    defer sem.Release(int64(img.Width * img.Height * 4))
    img.Resize(800, 600)  // mutates img!
    return nil
}
```

What is the bug?

Hint: what is `img.Width` after `Resize(800, 600)`?

---

## Bug 4 — Acquire Inside Goroutine

```go
sem := semaphore.NewWeighted(8)
var wg sync.WaitGroup
for _, item := range items { // len(items) == 1_000_000
    item := item
    wg.Add(1)
    go func() {
        defer wg.Done()
        sem.Acquire(ctx, 1)
        defer sem.Release(1)
        process(item)
    }()
}
wg.Wait()
```

What is the bug?

Hint: count goroutines alive at any moment.

---

## Bug 5 — Forgotten Context

```go
func work(item Item) error {
    if err := sem.Acquire(nil, 1); err != nil {
        return err
    }
    defer sem.Release(1)
    return process(item)
}
```

What is the bug?

Hint: try running this in a playground.

---

## Bug 6 — Re-Entrant Deadlock

```go
var sem = semaphore.NewWeighted(1)

func A(ctx context.Context) error {
    if err := sem.Acquire(ctx, 1); err != nil { return err }
    defer sem.Release(1)
    return B(ctx)
}

func B(ctx context.Context) error {
    if err := sem.Acquire(ctx, 1); err != nil { return err }
    defer sem.Release(1)
    return doWork()
}
```

What is the bug?

Hint: what if `A` calls `B`?

---

## Bug 7 — Cross-Semaphore Deadlock

```go
var memSem = semaphore.NewWeighted(1 << 30)
var cpuSem = semaphore.NewWeighted(8)

func handlerA(ctx context.Context, item Item) error {
    memSem.Acquire(ctx, item.Cost)
    defer memSem.Release(item.Cost)
    cpuSem.Acquire(ctx, 1)
    defer cpuSem.Release(1)
    return processA(item)
}

func handlerB(ctx context.Context, item Item) error {
    cpuSem.Acquire(ctx, 1)
    defer cpuSem.Release(1)
    memSem.Acquire(ctx, item.Cost)
    defer memSem.Release(item.Cost)
    return processB(item)
}
```

What is the bug?

Hint: run handlerA and handlerB concurrently when both semaphores are nearly saturated.

---

## Bug 8 — Untrusted Weight

```go
func handler(w http.ResponseWriter, r *http.Request) {
    size, _ := strconv.ParseInt(r.URL.Query().Get("size"), 10, 64)
    if err := sem.Acquire(r.Context(), size); err != nil {
        http.Error(w, "busy", 503)
        return
    }
    defer sem.Release(size)
    write(w, size)
}
```

What is the bug?

Hint: what does an attacker pass for `size`?

---

## Bug 9 — Double Release

```go
func work(ctx context.Context) error {
    if err := sem.Acquire(ctx, 1); err != nil { return err }
    defer sem.Release(1)
    if err := stage1(); err != nil {
        sem.Release(1)  // "free the slot early on error"
        return err
    }
    return stage2()
}
```

What is the bug?

Hint: count Releases on the error path.

---

## Bug 10 — Acquire Past Context

```go
func work(ctx context.Context) error {
    parent, cancel := context.WithCancel(ctx)
    defer cancel()

    if err := sem.Acquire(parent, 1); err != nil { return err }
    defer sem.Release(1)
    return process(ctx)
}
```

This one is subtle. What is the bug? (Hint: not a bug per se, but a *waste*.)

Hint: when is `parent` cancelled, and what does it gain you here?

---

## Bug 11 — Held Slot Across Wait

```go
func work(ctx context.Context, urls []string) error {
    if err := sem.Acquire(ctx, 1); err != nil { return err }
    defer sem.Release(1)

    var wg sync.WaitGroup
    for _, u := range urls {
        u := u
        wg.Add(1)
        go func() {
            defer wg.Done()
            fetchWithLongTimeout(ctx, u) // could take minutes
        }()
    }
    wg.Wait()
    return nil
}
```

What is the bug?

Hint: how long is the slot held?

---

## Bug 12 — Capacity Resize Attempt

```go
type ConfigurableSem struct {
    s *semaphore.Weighted
}

func (c *ConfigurableSem) SetCapacity(n int64) {
    c.s = semaphore.NewWeighted(n)
}
```

What is the bug?

Hint: what happens to goroutines currently holding slots from the old semaphore?

---

## Bug 13 — Acquire-Then-Spawn Inversion

```go
sem := semaphore.NewWeighted(8)
var wg sync.WaitGroup
for _, item := range items {
    item := item
    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := sem.Acquire(ctx, 1); err != nil { return }
        defer sem.Release(1)
        process(item)
    }()
    // intent: throttle spawning at this point
}
wg.Wait()
```

What is the bug? Compare to the desired pattern.

Hint: the comment describes the intent. Is the code matching the intent?

---

## Bug 14 — Loop Variable Capture

```go
sem := semaphore.NewWeighted(4)
for _, item := range items {
    sem.Acquire(ctx, 1)
    go func() {
        defer sem.Release(1)
        process(item)  // closes over loop variable
    }()
}
```

Pre-Go 1.22, what is the bug? Post-Go 1.22?

Hint: which `item` does each goroutine see?

---

## Answer Key

### Bug 1 — The Disappearing Release

The `item.Skippable` early return takes the function out *after* `Acquire` succeeded but *before* `Release`. The slot is leaked. After enough leaks, the semaphore is permanently saturated.

**Fix:**
```go
if err := sem.Acquire(ctx, 1); err != nil { return err }
defer sem.Release(1)
if item.Skippable { return nil }
return process(ctx, item)
```

### Bug 2 — Defer Before Error Check

When `Acquire` returns an error, *no slot was taken*. But the `defer sem.Release(1)` is already registered. The function returns, defer runs, `Release(1)` panics because cumulative releases > cumulative acquires.

**Fix:**
```go
if err := sem.Acquire(ctx, 1); err != nil { return err }
defer sem.Release(1)
```

Defer only after a successful acquire.

### Bug 3 — Mismatched Weights

`img.Resize(800, 600)` mutates `img.Width` and `img.Height`. The deferred `Release` recomputes them from the resized image — a different value. Either the release underflows (panic) or leaks (silent).

**Fix:**
```go
cost := int64(img.Width * img.Height * 4)
sem.Acquire(ctx, cost)
defer sem.Release(cost)
```

Capture the weight in a local; never recompute.

### Bug 4 — Acquire Inside Goroutine

One million goroutines are spawned immediately. They all park inside `Acquire(ctx, 1)`. Each goroutine costs ~2 KB of stack plus closure overhead. Total memory: 2+ GB. The semaphore is doing its concurrency-limiting job, but the spawn rate is uncapped.

**Fix:** acquire *before* spawning:
```go
for _, item := range items {
    item := item
    if err := sem.Acquire(ctx, 1); err != nil { return err }
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer sem.Release(1)
        process(item)
    }()
}
```

Now the loop runs at semaphore speed.

### Bug 5 — Forgotten Context

`sem.Acquire(nil, 1)` panics with `nil context.Context.Done called`. The `Acquire` implementation calls `ctx.Done()` early; nil ctx causes a method call on a nil interface.

**Fix:** pass `context.Background()` if you have nothing else.

### Bug 6 — Re-Entrant Deadlock

When `A(ctx)` calls `B(ctx)`, `A` already holds the only slot (capacity 1). `B`'s `Acquire` blocks forever — `A` cannot release because it is waiting for `B`. Deadlock.

`semaphore.Weighted` is *not* re-entrant.

**Fixes:**
- Avoid nested same-semaphore acquires.
- Or split the work so the inner function takes the slot from the outer.
- Or use a re-entrant lock (not provided by `x/sync`).

### Bug 7 — Cross-Semaphore Deadlock

Classic AB-BA deadlock:
- `handlerA` holds memSem, waits for cpuSem.
- `handlerB` holds cpuSem, waits for memSem.

Neither can proceed.

**Fix:** establish a global ordering for acquisitions — e.g., "always memSem before cpuSem" — and apply it everywhere.

### Bug 8 — Untrusted Weight

An attacker passes `size = math.MaxInt64`. `Acquire` blocks until ctx cancels. If `r.Context()` has no deadline, the request blocks indefinitely. Even if it does cancel, the goroutine has been pinned for the full deadline. DOS.

**Fix:** validate `size`:
```go
if size <= 0 || size > maxAllowed { http.Error(w, "bad size", 400); return }
```

### Bug 9 — Double Release

On the error path, `sem.Release(1)` runs explicitly, then `defer sem.Release(1)` runs again. The second one panics with `"semaphore: released more than held"`.

**Fix:** trust the defer; do not release manually:
```go
defer sem.Release(1)
if err := stage1(); err != nil { return err }
return stage2()
```

### Bug 10 — Acquire Past Context

`parent` is a child of `ctx`. The `Acquire(parent, 1)` differs from `Acquire(ctx, 1)` only in that `parent` can be cancelled by `cancel()` — which happens on function exit via `defer cancel()`. Since you do not call `cancel()` before `Acquire` returns, the `parent` cancellation never helps the Acquire.

The bug: `parent` and `cancel` are useless. They add allocation and confusion without changing behaviour.

**Fix:** just use `ctx` directly.

If you wanted a bounded-wait acquire:
```go
acqCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
defer cancel()
sem.Acquire(acqCtx, 1)
```

Then `cancel()` matters — it releases the timer resource. But you should pass `ctx` (not `acqCtx`) to `process`.

### Bug 11 — Held Slot Across Wait

The slot is acquired before `wg.Wait()` and released after. During the wait, the slot is held for the duration of the *slowest* `fetchWithLongTimeout`. If that is minutes, the slot is unavailable to all other goroutines for minutes. The semaphore is *coarser-grained* than the work it gates.

**Fix:** Acquire per fetch, not around the wait:
```go
for _, u := range urls {
    u := u
    if err := sem.Acquire(ctx, 1); err != nil { return err }
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer sem.Release(1)
        fetchWithLongTimeout(ctx, u)
    }()
}
wg.Wait()
```

### Bug 12 — Capacity Resize Attempt

After `SetCapacity`, the old semaphore is garbage-collected — *but* goroutines that called `Acquire` on the old one are still holding slots on the old instance. Their eventual `Release` operates on the old `*semaphore.Weighted`, which is unreachable. The new semaphore has no record of those holders. Capacity is effectively unenforced.

**Fix:** `semaphore.Weighted` does not support resize. Either:
- Restart the process for capacity changes.
- Build a custom limiter with proper handoff (drain old before installing new).

### Bug 13 — Acquire-Then-Spawn Inversion

The comment says "throttle spawning". But spawning happens *before* `Acquire`. The throttling occurs inside the goroutine — meaning all goroutines spawn first, then queue at `Acquire`. Same problem as Bug 4.

**Fix:** acquire before spawning.

### Bug 14 — Loop Variable Capture

**Pre-Go 1.22:** `item` is a loop variable shared across iterations. By the time the goroutine runs, `item` is the last value (or any in-between value). Workers process the wrong items.

**Post-Go 1.22:** The loop variable is fresh per iteration; the bug is fixed at the language level. But you should still write `item := item` for compatibility with older codebases.

**Fix:**
```go
for _, item := range items {
    item := item // shadow per iteration (or rely on Go 1.22+ semantics)
    sem.Acquire(ctx, 1)
    go func() {
        defer sem.Release(1)
        process(item)
    }()
}
```

---

## Closing Note

If you found all 14 bugs unaided, you have internalised the semaphore failure modes. Most are not specific to semaphores — they are concurrency and resource-handling bugs that semaphores amplify. The defensive habits are:

- `defer Release` immediately after `Acquire` success.
- Capture weights in locals.
- Acquire outside the goroutine spawn.
- Validate untrusted weights against capacity.
- Pick one global ordering for multi-semaphore code.
- Pass real `ctx`, never nil.
- Recognise non-re-entrancy.

These rules cost nothing to follow and avoid every bug above.
