---
layout: default
title: errgroup — Middle
parent: errgroup
grand_parent: errgroup and x/sync
ancestor: Concurrency
nav_order: 2
permalink: /roadmap/programming-languages/golang/07-concurrency/06-errgroup-x-sync/01-errgroup/middle/
---

# errgroup — Middle Level

← Back to errgroup index

At junior level we learned the four methods. At middle level we move from "I can write a `g.Go`" to "I know what each method actually does, when to use which pattern, and what subtle problems break production code." We focus on three pillars: `SetLimit` and `TryGo` semantics, context propagation discipline, and structured-concurrency patterns at production scale.

---

## 1. The four-method contract, revisited

| Method | Returns | Blocks? | Panics? |
|---|---|---|---|
| `g.Go(f)` | nothing | only when a limit is set and full | no |
| `g.TryGo(f)` | `bool` (true if started) | never | no |
| `g.Wait()` | `error` (first non-nil or nil) | until all spawned goroutines return | no |
| `g.SetLimit(n)` | nothing | never | yes, if called while goroutines are active or with n<-1 |
| `errgroup.WithContext(p)` | `(*Group, ctx)` | never | no |

Two of these can block: `Go` (when the limit is full) and `Wait` (until all goroutines finish). Two can never block: `TryGo` and `SetLimit`. One can panic: `SetLimit`.

### 1.1 `Go` blocking is the most surprising thing

```go
var g errgroup.Group
g.SetLimit(3)
for i := 0; i < 1000; i++ {
    i := i
    g.Go(func() error { time.Sleep(time.Second); return nil })
}
```

The loop body looks like 1000 fire-and-forget calls. It is not. After `Go` #3, the 4th call **blocks** the calling goroutine (often `main`) until one of the first three finishes. The loop takes ~333 seconds to even complete, and `g.Wait` adds nothing on top.

This is by design — it provides backpressure. But it is the single most surprising aspect of `SetLimit`. Document it loudly when you introduce it to a codebase.

### 1.2 `TryGo` is the escape hatch

```go
for ev := range events {
    if !g.TryGo(func() error { return handle(ev) }) {
        // limit full; do something else
        backlog <- ev
        // or
        droppedCounter.Inc()
    }
}
```

`TryGo` returns immediately. It is the right primitive when:

- You have a real-time producer and the consumer must not stall.
- You want to spill overflow into a queue.
- You want to drop excess load with a counter.
- You want to log "we're at capacity" without blocking.

`TryGo` is not "try once and retry" — call it again later if you want.

### 1.3 `SetLimit` semantics in detail

```go
func (g *Group) SetLimit(n int)
```

- `n > 0`: at most `n` goroutines from `Go`/`TryGo` may be running.
- `n < 0`: no limit (default).
- `n == 0`: nothing may run. **Avoid.** Any `Go` blocks forever; any `TryGo` returns false.
- Calling after any `Go` has been called: panics with "errgroup: modify limit while there are still active goroutines."

So in practice: call `SetLimit` once, immediately after declaring the group, before any `Go`.

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(8)
for _, x := range xs {
    // ...
}
```

You cannot dynamically resize the limit while goroutines are flying. If you need that, use `semaphore.Weighted` directly.

---

## 2. Manual `WaitGroup + chan error` revisited

Even with errgroup widely available, you still see hand-rolled versions in older codebases. Knowing the differences is part of being a competent code reviewer.

### 2.1 Three subtle bugs in the manual pattern

```go
var wg sync.WaitGroup
errCh := make(chan error)            // BUG 1: unbuffered

for _, x := range xs {
    wg.Add(1)
    go func() {                       // BUG 2: x captured
        defer wg.Done()
        if err := process(x); err != nil {
            errCh <- err              // BUG 1 manifests here: blocks if no reader
        }
    }()
}
wg.Wait()
close(errCh)
var err error
for e := range errCh {
    err = e                           // BUG 3: returns last error, not first
}
```

- **Bug 1: unbuffered errCh.** If we never `range` over `errCh` until after `wg.Wait`, the senders block forever. We have a deadlock that the runtime will detect as "all goroutines are asleep." Fix: buffer to `len(xs)`.
- **Bug 2: loop-variable capture** (Go &lt; 1.22). All goroutines see the final `x`.
- **Bug 3: last-error-wins.** The range loop overwrites `err` on every iteration. The "first error" we wanted is lost.

The errgroup version doesn't have these problems. It uses an internal `sync.Once` that records the first error and only the first error, and buffering is handled by the `WaitGroup` itself.

### 2.2 The errgroup equivalent

```go
var g errgroup.Group
for _, x := range xs {
    x := x
    g.Go(func() error { return process(x) })
}
return g.Wait()
```

The library handles all three concerns. The only manual discipline left is `x := x` (until Go 1.22), and `return` style instead of channel-send style for errors.

### 2.3 When the manual pattern is still appropriate

Two situations where errgroup is *not* a strict win:

- **You want all errors, not just the first.** Then collect into `[]error` with a `Mutex` and call `errors.Join` at the end.
- **You need per-task callbacks (e.g., "send this success/failure to a metrics queue").** A channel-based pattern is more natural.

For "wait for all and stop on first error," errgroup wins on every axis.

---

## 3. Context propagation, in depth

`WithContext` returns a context that is cancelled when:

1. Any goroutine in the group returns a non-nil error, **or**
2. `Wait` returns.

This means the derived context's lifetime is bounded by `Wait`. **It is invalid to use after `Wait` returns.** Code that retains and uses `ctx` later will see immediate cancellation.

### 3.1 The "thread the context" rule

Every blocking operation in your closure must accept the context. The errgroup library cancels the context but cannot interrupt your goroutine. The following are equivalent in terms of the library's behaviour:

```go
g.Go(func() error { return slowWork() })     // ignores ctx
g.Go(func() error { return slowWork(ctx) })  // respects ctx
```

In the first version, errgroup cancels the context on first error, but `slowWork()` keeps running. `Wait` blocks until `slowWork` returns of its own accord. The "early cancel" is lost.

In the second version, `slowWork` reads `ctx.Done()` (or passes `ctx` to its own I/O), so it exits early. `Wait` returns quickly with the first error.

The library cannot enforce this. Code review must.

### 3.2 The `select` discipline

For long-blocking work that cannot itself accept a context (e.g., a CPU loop or a third-party blocking call), wrap with `select`:

```go
g.Go(func() error {
    resultCh := make(chan Result, 1)
    go func() { resultCh <- expensiveCompute() }()
    select {
    case r := <-resultCh:
        store(r)
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
})
```

Caveat: the inner goroutine still runs to completion. You have not killed it; you have only stopped waiting on it. The "abandoned goroutine" is a leak by another name. For CPU work this is usually acceptable; for resource-holding work (open file, DB transaction) it is not.

### 3.3 Combine with `context.WithTimeout` and `context.WithDeadline`

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()

g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return fetch(ctx, urlA) })
g.Go(func() error { return fetch(ctx, urlB) })
err := g.Wait()
```

Two cancellation sources now: the 5-second deadline and the first-error fan-out. Either fires, the derived `ctx` cancels, the workers exit. `err` can be `context.DeadlineExceeded`, `context.Canceled` (if the worker propagated it after seeing the timeout cancellation), or the actual work error.

### 3.4 Errgroup respects parent cancellation

If the *parent* context is cancelled before the group finishes, the derived `ctx` cancels too. Workers can see it. This is just how `context.WithCancel` chains work. The errgroup library does nothing special here.

---

## 4. Patterns: fan-out, fan-in, pipeline

### 4.1 Fan-out

"Send the same request to N backends, take all answers."

```go
type Result struct {
    Backend string
    Value   int
    Err     error
}

func fanOut(ctx context.Context, backends []string) ([]Result, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(len(backends))
    results := make([]Result, len(backends))
    for i, b := range backends {
        i, b := i, b
        g.Go(func() error {
            v, err := query(ctx, b)
            results[i] = Result{Backend: b, Value: v, Err: err}
            return err // first failure cancels the rest
        })
    }
    if err := g.Wait(); err != nil {
        return results, err // partial results plus error
    }
    return results, nil
}
```

Decision point: do you fail fast or collect all errors? With errgroup-as-shown, you fail fast. To collect all, return `nil` from the closure but record the error in `results[i].Err`.

### 4.2 Fan-in

"Aggregate the results of N goroutines into one channel."

errgroup is not directly a fan-in primitive — that's a channel pattern. But errgroup composes with it:

```go
out := make(chan Item, 100)
g, ctx := errgroup.WithContext(ctx)
for _, src := range sources {
    src := src
    g.Go(func() error {
        return src.Stream(ctx, out)
    })
}
go func() {
    g.Wait()
    close(out) // signal "no more items"
}()
for item := range out {
    handle(item)
}
```

The classic "close-the-channel-after-Wait" pattern is captured in one anonymous goroutine. The reader drains `out` until the close.

### 4.3 Pipeline

"Stage 1 reads input, stage 2 transforms, stage 3 writes output. Run all stages concurrently."

```go
g, ctx := errgroup.WithContext(ctx)
raw := make(chan Raw, 16)
parsed := make(chan Parsed, 16)

g.Go(func() error {
    defer close(raw)
    return readInputs(ctx, raw)
})
g.Go(func() error {
    defer close(parsed)
    for r := range raw {
        p, err := parse(r)
        if err != nil { return err }
        select {
        case parsed <- p:
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return nil
})
g.Go(func() error {
    return writeOutputs(ctx, parsed)
})
return g.Wait()
```

Three stages, three goroutines, two channels. Errgroup glues them together: if any stage returns an error, `ctx` cancels, all stages drain or exit, `Wait` returns the error.

The `defer close(channel)` calls are essential. Without them, downstream stages block forever waiting for input that will never come.

### 4.4 Parallel-map with bounded fan-out

```go
func parallelMap[I, O any](
    ctx context.Context, in []I, limit int,
    fn func(context.Context, I) (O, error),
) ([]O, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(limit)
    out := make([]O, len(in))
    for i, v := range in {
        i, v := i, v
        g.Go(func() error {
            r, err := fn(ctx, v)
            if err != nil {
                return err
            }
            out[i] = r
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return out, nil
}
```

Reusable. Plug into any project. The limit is the only knob you tune.

---

## 5. Error semantics

### 5.1 First error wins

```go
g.Go(func() error { time.Sleep(10*time.Millisecond); return errA })
g.Go(func() error { time.Sleep(20*time.Millisecond); return errB })
```

`errA` returns first. `Wait` returns `errA`. `errB` is silently dropped (and the derived ctx is already cancelled by then, so a third worker observing `ctx.Done()` would return `ctx.Err()`, also dropped).

### 5.2 The order is not deterministic

Two failures racing for "first." Whichever the Go scheduler dispatches the `errOnce.Do` for first wins. In tests, do not assert on *which* of several simultaneous errors is returned — assert that the returned error is one of the expected set.

### 5.3 Wrap with `fmt.Errorf` for debuggability

```go
g.Go(func() error {
    if err := loadConfig(); err != nil {
        return fmt.Errorf("loadConfig: %w", err)
    }
    return nil
})
g.Go(func() error {
    if err := loadCerts(); err != nil {
        return fmt.Errorf("loadCerts: %w", err)
    }
    return nil
})
```

Now the error returned by `Wait` tells you which stage failed.

### 5.4 Collecting all errors

If you really need all errors, switch to manual collection:

```go
var (
    mu   sync.Mutex
    errs []error
)
for _, x := range xs {
    x := x
    g.Go(func() error {
        if err := process(x); err != nil {
            mu.Lock()
            errs = append(errs, err)
            mu.Unlock()
        }
        return nil // tell errgroup we succeeded — we collect ourselves
    })
}
_ = g.Wait()
return errors.Join(errs...)
```

Note we return `nil` from the closure: we don't want errgroup to short-circuit. The cost is that we lose `WithContext`'s "cancel on first error" benefit. Choose your trade-off.

### 5.5 The `errgroup` library does *not* wrap errors

`Wait` returns exactly the `error` value your closure returned (or `nil`). It does not add a prefix, does not call `errors.Join`, does not annotate with a goroutine name. If you want any of that, wrap it yourself before returning from the closure.

---

## 6. Anti-patterns

### 6.1 Ignoring `ctx` in the goroutine

```go
g, ctx := errgroup.WithContext(ctx)
for _, x := range xs {
    x := x
    g.Go(func() error {
        return process(x) // ctx not threaded
    })
}
```

The library cancels `ctx` on first failure. The goroutines do not read `ctx.Done()`. They run to completion. The cancellation does nothing.

This is the **single most common errgroup bug** in real codebases. Always thread the context.

### 6.2 Using `ctx` after `Wait`

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return doA(ctx) })
g.Wait()

doB(ctx)  // ctx is cancelled
```

`Wait` cancels the derived context on return. `doB` sees `ctx.Err() == context.Canceled`. Use `parent` for follow-up calls.

### 6.3 Setting limit too late

```go
var g errgroup.Group
g.Go(f1)
g.SetLimit(3) // panic
```

Order matters. Set the limit before any spawn.

### 6.4 Reusing a group

```go
var g errgroup.Group
g.Go(f1); g.Wait()
g.Go(f2); g.Wait() // undefined
```

One group, one batch. Make a new group for the next batch.

### 6.5 Forgetting to call `Wait`

```go
func spawn(items []Item) {
    var g errgroup.Group
    for _, x := range items {
        x := x
        g.Go(func() error { return process(x) })
    }
    // missing g.Wait() — function returns with goroutines still running
}
```

If `process` writes to a buffer the caller observes, the caller sees partial results. If a closure references a stack variable, that variable's lifetime is extended via escape analysis but the function frame is gone. Always `g.Wait()`.

### 6.6 Calling `g.Wait` from inside a goroutine in the group

```go
g.Go(func() error {
    return g.Wait() // deadlock
})
```

The inner `Wait` waits for itself. Don't.

### 6.7 Closures that don't return

```go
g.Go(func() error {
    for { /* infinite loop with no ctx check */ }
})
```

The goroutine never returns. `Wait` blocks forever. Always have an exit condition.

---

## 7. Common bugs in error messages

### 7.1 "errgroup: modify limit while there are still active goroutines"

You called `SetLimit` after a `Go`. Move the `SetLimit` to before any `Go`.

### 7.2 Deadlock with "all goroutines are asleep"

You set `SetLimit(0)`, or you have a closure that waits on a channel that no one sends to.

### 7.3 `Wait` returns `nil` but tests fail

Likely cause: a closure that swallows errors (`log.Println(err); return nil`). Find it.

### 7.4 `Wait` returns `context.Canceled` and nothing else

Often the parent context cancelled before any worker had a chance. Check the parent's deadline and any explicit `cancel()` in your code.

---

## 8. Errgroup-like libraries

The Go ecosystem has alternatives. Each makes different trade-offs.

| Library | Strengths | Trade-offs |
|---|---|---|
| `golang.org/x/sync/errgroup` | First-party, smallest API, well-known | No panic recovery, only first error |
| `github.com/sourcegraph/conc` (`conc.WaitGroup`, `pool.Pool`) | Recovers panics, generic, has typed result pools | Bigger dependency, evolves faster |
| `github.com/neilotoole/errgroup` | Drop-in replacement with `Limit()` and `LimitN()` | Forking-adjacent, less canonical |
| `github.com/hashicorp/go-multierror` (combined with WaitGroup) | Collects all errors via `errors.Join`-style aggregation | Manual coordination still needed |

For most production code, stick with `golang.org/x/sync/errgroup`. Reach for `conc` if your workers can panic on untrusted input and you do not want to wrap every body in `defer recover()`.

---

## 9. Testing errgroup code

### 9.1 Deterministic order assertions are wrong

```go
g.Go(func() error { return errA })
g.Go(func() error { return errB })
err := g.Wait()
require.Equal(t, errA, err) // FLAKY
```

`errA` vs `errB` race. Use:

```go
require.Contains(t, []error{errA, errB}, err)
```

Or design tests so only one goroutine can fail.

### 9.2 Use `context.WithCancel` to simulate parent cancellation

```go
parent, cancel := context.WithCancel(context.Background())
g, ctx := errgroup.WithContext(parent)
g.Go(func() error {
    <-ctx.Done()
    return ctx.Err()
})
cancel()
err := g.Wait()
require.ErrorIs(t, err, context.Canceled)
```

### 9.3 Race detector is mandatory

```bash
go test -race ./...
```

errgroup hides nothing from the race detector. If you have a race in your closure, `-race` finds it.

### 9.4 Test the limit

```go
var concurrent int32
var max int32

var g errgroup.Group
g.SetLimit(3)
for i := 0; i < 20; i++ {
    g.Go(func() error {
        c := atomic.AddInt32(&concurrent, 1)
        for {
            old := atomic.LoadInt32(&max)
            if c <= old || atomic.CompareAndSwapInt32(&max, old, c) {
                break
            }
        }
        time.Sleep(50 * time.Millisecond)
        atomic.AddInt32(&concurrent, -1)
        return nil
    })
}
_ = g.Wait()
require.LessOrEqual(t, max, int32(3))
```

---

## 10. Summary

At middle level you should be able to:

- Read someone's `errgroup` code and tell whether they correctly thread `ctx`.
- Choose between `Go` (blocking when limit full) and `TryGo` (non-blocking) based on the workload's backpressure needs.
- Identify the three bugs in the typical hand-rolled `WaitGroup + chan error` (loop capture, unbuffered errCh, last-error-wins).
- Recognise the "ignored ctx" anti-pattern in code review.
- Build fan-out, fan-in, pipeline, and parallel-map skeletons from memory.
- Collect all errors when needed, rather than just the first.
- Test errgroup code with the race detector and without flakiness.

Next, **senior** covers integration with `semaphore.Weighted`, partial-failure policies in production systems, observability, and structured-concurrency idioms from other languages applied to Go.
