---
layout: default
title: errgroup — Professional
parent: errgroup
grand_parent: errgroup and x/sync
ancestor: Concurrency
nav_order: 4
permalink: /roadmap/programming-languages/golang/07-concurrency/06-errgroup-x-sync/01-errgroup/professional/
---

# errgroup — Professional Level

← Back to errgroup index

Source-level walk-through of `golang.org/x/sync/errgroup`. The file is approximately 130 lines. Numbers below refer to the version current in mid-2024; the algorithm has been stable since `SetLimit` and `TryGo` landed.

Source: <https://cs.opensource.google/go/x/sync/+/master:errgroup/errgroup.go>

---

## 1. The struct

```go
type Group struct {
    cancel func(error)

    wg sync.WaitGroup

    sem chan token

    errOnce sync.Once
    err     error
}

type token struct{}
```

Five fields. Each has a single, narrow responsibility.

### 1.1 `cancel func(error)`

Set by `WithContext`. It is the cancel function returned by `context.WithCancelCause`, not `context.WithCancel`. The signature `func(error)` is the giveaway. When errgroup invokes `cancel(err)`, the derived context is cancelled and `context.Cause(ctx)` returns `err` (not just `context.Canceled`).

For a zero-value `Group` (no `WithContext`), `cancel` is `nil` and is checked before being called.

The version history matters: before March 2023, errgroup used `context.WithCancel` and `cancel func()`. The switch to `WithCancelCause` preserves the original error as the cancellation cause, which makes debugging much easier. Old code that did `if errors.Is(err, context.Canceled)` still works, but new code can do `errors.Is(context.Cause(ctx), myError)` to recover the root cause.

### 1.2 `wg sync.WaitGroup`

The classic counter. Every `Go`/`TryGo` calls `wg.Add(1)` before spawning and the goroutine calls `wg.Done()` on exit. `Wait` calls `wg.Wait()` first, then handles cancel and returns `err`.

### 1.3 `sem chan token`

The concurrency limiter. `nil` if `SetLimit` was never called (unbounded). Otherwise a buffered channel of capacity `n`. Each `Go` sends a `token{}` into `sem` before spawning; each goroutine receives a `token` from `sem` (via `defer`) when it returns. The channel's buffer capacity *is* the limit.

`token` is a zero-size struct. Sending and receiving cost nothing but a synchronization point.

When `Go` cannot send (because the buffer is full), it *blocks* — providing backpressure. When `TryGo` cannot send, it uses a `select { default: }` to return `false` without blocking.

### 1.4 `errOnce sync.Once`

Guards the recording of the first error. Each goroutine's `defer` checks if its error is non-nil; if so, it calls `errOnce.Do(func() { g.err = err; if g.cancel != nil { g.cancel(err) } })`. Subsequent errors find the Once already fired and silently drop their error.

`sync.Once` provides both mutual exclusion and a happens-before guarantee: the value of `g.err` written inside `Do` is visible to anyone who calls `Do` later (or reads `g.err` after `wg.Wait`).

### 1.5 `err error`

The recorded first error. Default `nil`. Written exactly once under the protection of `errOnce`. Read by `Wait` *after* `wg.Wait` returns (which gives a happens-before fence).

---

## 2. `Go`

```go
func (g *Group) Go(f func() error) {
    if g.sem != nil {
        g.sem <- token{}
    }

    g.wg.Add(1)
    go func() {
        defer g.done()

        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil {
                    g.cancel(g.err)
                }
            })
        }
    }()
}
```

Step by step:

1. **`if g.sem != nil { g.sem <- token{} }`** — if a limit is set, acquire a slot. Blocks if the buffer is full.
2. **`g.wg.Add(1)`** — register the goroutine. Note this happens *after* the semaphore acquire, so a producer blocked on the semaphore has not yet incremented the WaitGroup. (`Wait` blocks on the WaitGroup; producers blocked on `sem` are not "in" the group yet.)
3. **`go func() { ... }()`** — spawn the actual worker.
4. Inside the goroutine, `defer g.done()` runs at the end. `done` releases the semaphore slot and decrements the WaitGroup (see section 5).
5. Call `f()`. If it returns a non-nil error, fire `errOnce.Do`: record the error, cancel the derived context.

### 2.1 Ordering subtleties

A concurrent `Wait` cannot see `wg.Add(1)` for this goroutine until it returns from blocking on `sem <- token{}`. This is correct: a goroutine waiting for a slot is *not* part of the group yet. Once it has a slot, `wg.Add(1)` makes it observable.

This also means: if you call `g.Wait()` *between* `Go` calls, and one of those `Go`s is blocked on `sem`, `Wait` returns based on whatever goroutines *had* already added themselves. The blocked `Go` then unblocks, calls `wg.Add(1)`, and starts a goroutine that runs *after* `Wait` returned. **Calling `Wait` while other producers are still adding tasks is a bug.**

### 2.2 Error-once mechanics

```go
g.errOnce.Do(func() {
    g.err = err
    if g.cancel != nil {
        g.cancel(g.err)
    }
})
```

The first goroutine to lose the race wins. Subsequent goroutines find `errOnce` already done and skip the block entirely. Their errors are dropped.

The cancel call happens *inside* the Once. This means cancellation is exactly-once. If two goroutines fail simultaneously, only one will trigger cancellation.

After cancellation, the derived context's `ctx.Done()` channel is closed, which wakes any goroutine selecting on it.

---

## 3. `TryGo`

```go
func (g *Group) TryGo(f func() error) bool {
    if g.sem != nil {
        select {
        case g.sem <- token{}:
            // slot acquired, proceed
        default:
            return false
        }
    }

    g.wg.Add(1)
    go func() {
        defer g.done()
        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil {
                    g.cancel(g.err)
                }
            })
        }
    }()
    return true
}
```

Identical to `Go` except for the non-blocking `select` on `sem`. If `sem` is `nil` (no limit), the `if g.sem != nil` block is skipped and `TryGo` always returns `true` after spawning.

This is why `TryGo` returns `true` immediately when no limit is set: with no limit, there is no "full" state to bounce off.

---

## 4. `Wait`

```go
func (g *Group) Wait() error {
    g.wg.Wait()
    if g.cancel != nil {
        g.cancel(g.err)
    }
    return g.err
}
```

Three steps:

1. **`g.wg.Wait()`** — block until every spawned goroutine has called `Done` via `g.done`.
2. **`g.cancel(g.err)`** — if `WithContext` was used, cancel the derived context. This happens *after* `wg.Wait`, so it does not race with workers. The cancel is idempotent; if a goroutine already triggered it via `errOnce`, this is a no-op.
3. **`return g.err`** — the recorded first error (or `nil`).

### 4.1 The "cancel on Wait return" cleanup

Calling `cancel` on the way out is the reason `ctx` should not be used after `Wait`. The cancellation is part of the cleanup, freeing context-tree resources.

If `Wait` returned a non-nil error and a goroutine had already called `cancel(err)` via `errOnce`, the second `cancel(g.err)` is harmless. `context.WithCancelCause` returns a cancel function that records the first cause and ignores subsequent calls.

### 4.2 Concurrent `Wait` calls

The library does not guard against multiple concurrent `Wait`s. The behaviour is what you'd expect from concurrent calls to `sync.WaitGroup.Wait` (defined: returns when counter is zero) followed by races on `g.cancel` and `g.err`. The error read is fine because `sync.WaitGroup.Wait` is a release fence and `g.err` was written under `errOnce.Do` before any `Done` that follows it. The double `cancel` is harmless.

But: calling `Wait` twice is undefined. Don't.

---

## 5. `done`

```go
func (g *Group) done() {
    if g.sem != nil {
        <-g.sem
    }
    g.wg.Done()
}
```

Receive from `sem` (releasing the slot) *before* decrementing the WaitGroup. This order matters: if `wg.Done` were first, a `Wait` that races could observe counter = 0 and return, while we still have a token outstanding. By draining the token first, we ensure the slot is released *before* we leave the group's accounting.

In practice this is hard to observe because `Wait` does not interact with `sem`. But it is the conservative ordering.

---

## 6. `SetLimit`

```go
func (g *Group) SetLimit(n int) {
    if n < 0 {
        g.sem = nil
        return
    }
    if len(g.sem) != 0 {
        panic(fmt.Errorf("errgroup: modify limit while %v goroutines in the group are still active", len(g.sem)))
    }
    g.sem = make(chan token, n)
}
```

Three branches:

1. **`n < 0`** — unbounded. Set `sem` to `nil`. `Go` checks `if g.sem != nil` and skips. (This is the only documented way to clear a limit.)
2. **`len(g.sem) != 0`** — there are outstanding tokens, meaning goroutines are running. Panic. The check is `len`, not "has anyone ever called Go" — it allows you to reconfigure after `Wait` returns (the buffer is empty then). But in practice, do not rely on that — make a new Group.
3. Otherwise, allocate a new buffered channel of capacity `n`. `n == 0` is allowed; it produces a channel of capacity 0, which is an unbuffered channel. **Sending to an unbuffered channel without a receiver blocks forever.** Hence `SetLimit(0)` makes `Go` block forever — almost certainly a bug.

### 6.1 Why is the panic only on `len(g.sem) != 0`?

Because the only way for the channel buffer to be non-empty is that `Go` was called and the goroutine has not yet called `done`. If all spawned goroutines have completed, the buffer is empty even though the group is "used." This is a deliberate weak invariant; the library does not track whether `Go` has ever been called.

### 6.2 Why is there no atomic write to `sem`?

`SetLimit` is documented as: call it before any `Go`. Under that discipline, no other goroutine touches `sem`, so no atomic is needed. If you call `SetLimit` concurrently with `Go`, behaviour is undefined — and there is no panic to catch you.

---

## 7. `WithContext`

```go
func WithContext(ctx context.Context) (*Group, context.Context) {
    ctx, cancel := context.WithCancelCause(ctx)
    return &Group{cancel: cancel}, ctx
}
```

Two lines. Wrap the parent context with `WithCancelCause` (Go 1.20+) and store the cancel function on the group.

The returned `*Group` is non-nil; the returned `context.Context` is the *derived* context, not the parent.

### 7.1 Why `WithCancelCause` and not `WithCancel`?

Pre-1.20 errgroup used `WithCancel`. The cancel function had signature `func()`. The cause was always `context.Canceled`, losing the original error.

`WithCancelCause` returns `func(error)`. When errgroup calls `g.cancel(err)`, `context.Cause(ctx)` returns `err`. This lets downstream code unwrap the real cause:

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return io.ErrShortWrite })
// ...
g.Wait() // returns io.ErrShortWrite
// ctx.Err() is context.Canceled
// context.Cause(ctx) is io.ErrShortWrite
```

This is an important diagnostics improvement and the main reason to use a recent `golang.org/x/sync`.

---

## 8. Atomic considerations

Errgroup's coordination relies on:

- `sync.WaitGroup` provides release/acquire semantics on `Done`/`Wait`.
- `sync.Once` provides release/acquire on the first/subsequent `Do`.
- Channel send/receive provides release/acquire on `sem`.

These primitives ensure that:

- The write `g.err = err` inside `errOnce.Do` is visible to readers in `Wait`.
- The cancel function's effect (closing `ctx.Done()`) is visible to any goroutine selecting on `ctx.Done()`.
- The semaphore token's "ownership" (held by exactly one goroutine at a time, up to `n` total) is correct.

There are no raw atomics in the errgroup source. The library composes higher-level primitives.

---

## 9. Race detector behaviour

Errgroup itself is race-free. Bugs in *your* code that errgroup hosts are not hidden:

- A race on a shared map inside a closure shows up under `-race` as the closure's read/write conflict.
- A race on the result slice when two goroutines write to the same index shows up under `-race`.
- A race on the captured loop variable (pre-1.22) shows up under `-race` if the test scheduling exposes it.

Run `go test -race -count=10` to surface scheduling-dependent races.

---

## 10. Memory and allocation profile

Per `Group`:

- 24 bytes for the struct (rough — depends on alignment).
- 0 bytes if no `WithContext` (no cancel field cost).
- ~64 bytes for the cancel closure if `WithContext`.
- `(n × 8) + 96` bytes for the limit channel if `SetLimit(n)` (channel header + buffer).

Per `Go` call:

- 1 allocation for the goroutine's stack frame and closure capture (varies).
- 1 channel send to `sem` if limited.
- 1 `wg.Add` (atomic counter update).
- No allocation on success path (no error).
- On first error: 1 `errOnce.Do` (cheap after first), 1 `cancel` call.

Allocation overhead is dominated by the closure (the captured `f` and its environment), not by errgroup. If you call `g.Go(f)` a million times, the million closures dominate. Errgroup contributes a few atomics and a few channel operations per task.

---

## 11. Comparison with the manual implementation

To validate the "errgroup is just WaitGroup + Once + cancel" mental model, here is a from-scratch implementation that matches the public API closely:

```go
type Group struct {
    cancel  context.CancelCauseFunc
    wg      sync.WaitGroup
    sem     chan struct{}
    errOnce sync.Once
    err     error
}

func WithContext(ctx context.Context) (*Group, context.Context) {
    ctx, cancel := context.WithCancelCause(ctx)
    return &Group{cancel: cancel}, ctx
}

func (g *Group) SetLimit(n int) {
    if n < 0 { g.sem = nil; return }
    if len(g.sem) != 0 { panic("...") }
    g.sem = make(chan struct{}, n)
}

func (g *Group) Go(f func() error) {
    if g.sem != nil { g.sem <- struct{}{} }
    g.wg.Add(1)
    go func() {
        defer func() {
            if g.sem != nil { <-g.sem }
            g.wg.Done()
        }()
        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil { g.cancel(err) }
            })
        }
    }()
}

func (g *Group) TryGo(f func() error) bool {
    if g.sem != nil {
        select {
        case g.sem <- struct{}{}:
        default:
            return false
        }
    }
    g.wg.Add(1)
    go func() { /* same as Go's goroutine body */ }()
    return true
}

func (g *Group) Wait() error {
    g.wg.Wait()
    if g.cancel != nil { g.cancel(g.err) }
    return g.err
}
```

This is essentially the real source. Memorise it. When you understand this skeleton you understand the library.

---

## 12. Comparison with `sourcegraph/conc.WaitGroup`

The relevant `conc` source (simplified):

```go
type WaitGroup struct {
    wg sync.WaitGroup
    pc panicCatcher  // collects recovered panics
}

func (h *WaitGroup) Go(f func()) {
    h.wg.Add(1)
    go func() {
        defer h.wg.Done()
        defer h.pc.try(f)  // pc.try runs f under defer/recover
    }()
}
```

Key differences from errgroup:

- `conc.WaitGroup.Go` takes `func()`, not `func() error`. Errors are not first-class.
- `conc` recovers panics and stores them in `panicCatcher`.
- On `Wait`, `conc` rethrows any captured panic, turning a worker panic into a panic in the caller's goroutine.

For error-driven use, `conc/pool` is the closer analog. `pool.New().WithErrors()` returns a pool whose `Go` takes `func() error`. The internal structure is similar to errgroup but with the panic catcher added.

The cost of the panic catcher: one extra `defer` per goroutine and the storage for the panic value. For most workloads, the cost is negligible compared to the work being done.

---

## 13. What's missing from the API

A list of features errgroup *deliberately does not* provide:

- **`Cancel()` method.** No way to cancel the group from outside without going through the parent context.
- **`Done()` channel.** No way to learn that all goroutines have finished without calling `Wait` (which blocks).
- **`Errors() []error`.** No way to collect all errors.
- **`Active() int`.** No way to query active count.
- **`Reset()`.** No way to reuse a `Group`. Allocate a new one.

Each absent feature is one the team has considered and rejected, usually because it would invite misuse. The minimal API is a feature.

---

## 14. Version history (`golang.org/x/sync/errgroup`)

| Date | Change |
|------|--------|
| Mar 2016 | Initial commit. `Go`, `Wait`, `WithContext`. |
| Aug 2022 | `SetLimit` added. |
| May 2023 | `TryGo` added. |
| Aug 2023 | Switched `WithCancel` to `WithCancelCause` to preserve error cause. |
| 2024 | Minor doc tweaks. |

A short, stable history. The API has not had a breaking change.

---

## 15. Summary

Errgroup is 130 lines of Go. Its design is:

- `sync.WaitGroup` for "wait for all."
- `sync.Once` for "record first error."
- `context.WithCancelCause` for "cancel on first error, preserve cause."
- Buffered channel for "concurrency limit."

Everything else — patterns, anti-patterns, idioms — is built on these primitives. Understanding the source removes all magic.
