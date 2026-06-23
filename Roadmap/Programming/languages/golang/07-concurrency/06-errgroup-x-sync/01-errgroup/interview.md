---
layout: default
title: errgroup — Interview
parent: errgroup
grand_parent: errgroup and x/sync
ancestor: Concurrency
nav_order: 6
permalink: /roadmap/programming-languages/golang/07-concurrency/06-errgroup-x-sync/01-errgroup/interview/
---

# errgroup — Interview Questions

← Back to errgroup index

A bank of questions an interviewer can pull from to probe `errgroup` knowledge at junior, middle, senior, and professional level. Each question comes with the expected answer, the follow-ups you should expect, and the red flags that suggest the candidate is bluffing.

---

## Section 1 — Junior

### Q1. What does `errgroup.Group` do?

**Expected:** It is a helper from `golang.org/x/sync/errgroup` that bundles a group of goroutines: spawn them with `Go(func() error)`, wait for all with `Wait()`, get the first non-nil error.

**Red flags:** Confusing it with `sync.WaitGroup` (which has no error tracking) or `context.Context` (which has no spawning).

---

### Q2. What is the difference between `errgroup.Group` and `sync.WaitGroup`?

**Expected:** Three things:

1. `errgroup` collects an error; `WaitGroup` does not.
2. `errgroup` has a function-style API (`Go(func() error)`); `WaitGroup` has counter-style (`Add` / `Done`).
3. `errgroup` with `WithContext` provides automatic context cancellation on first error; `WaitGroup` does not.

**Follow-up:** Which has lower overhead per task? *(About the same. errgroup adds a Once check and possibly a channel send; both negligible.)*

---

### Q3. What does `errgroup.WithContext` return?

**Expected:** `(*Group, context.Context)`. The context is a child of the parent passed in; it cancels when (a) any goroutine returns a non-nil error, or (b) `Wait` returns.

**Red flag:** Saying it returns `(context.Context, cancel)` — that's `context.WithCancel`, not errgroup.

---

### Q4. What does `g.Wait()` return?

**Expected:** The first non-nil error returned by any goroutine in the group, or `nil` if all returned `nil`.

**Follow-up:** What if three goroutines fail? *(Only the first error is returned. The others are silently dropped.)*

---

### Q5. Convert this manual code to errgroup.

```go
var wg sync.WaitGroup
errCh := make(chan error, len(items))
for _, item := range items {
    wg.Add(1)
    go func(it Item) {
        defer wg.Done()
        if err := process(it); err != nil {
            errCh <- err
        }
    }(item)
}
wg.Wait()
close(errCh)
var firstErr error
for err := range errCh {
    if firstErr == nil { firstErr = err }
}
return firstErr
```

**Expected:**

```go
var g errgroup.Group
for _, item := range items {
    item := item
    g.Go(func() error { return process(item) })
}
return g.Wait()
```

**Red flag:** Forgetting `item := item` (for Go &lt; 1.22). Forgetting `return g.Wait()`.

---

### Q6. Is `errgroup` in the standard library?

**Expected:** No. It is in `golang.org/x/sync/errgroup`. Maintained by the Go team but outside the stdlib so it can evolve faster.

---

### Q7. What happens if I forget to call `Wait`?

**Expected:** The function returns with goroutines still running. They will eventually finish, but errors will be silently lost. If they reference stack variables via closure, those escape to the heap and live on. It is a structural concurrency violation; always pair `Go` with `Wait`.

---

## Section 2 — Middle

### Q8. What does `g.SetLimit(n)` do?

**Expected:** Limits the number of concurrently running goroutines to `n`. Subsequent `Go` calls *block* until a slot is free. `-1` removes the limit (default). Must be called before any `Go`.

**Follow-up:** What happens if I call `SetLimit(0)`? *(Bad: `Go` blocks forever. It allocates an unbuffered channel; sending to it blocks until a receiver, but there will never be one because nothing has been sent yet.)*

**Follow-up:** What if I call `SetLimit` after starting goroutines? *(Panic: "errgroup: modify limit while N goroutines in the group are still active".)*

---

### Q9. What does `g.TryGo(f)` do? When would you use it?

**Expected:** Like `Go` but non-blocking. Returns `true` if a goroutine started, `false` if the limit was full and nothing happened. Use it when you want to drop overflow or push to a backlog instead of blocking the producer.

**Follow-up:** What does it return when no limit is set? *(Always `true` — no full state to bounce off.)*

---

### Q10. What is the bug in this code?

```go
g, ctx := errgroup.WithContext(ctx)
for _, url := range urls {
    url := url
    g.Go(func() error {
        return fetch(url) // no ctx
    })
}
g.Wait()
```

**Expected:** `ctx` is not threaded into `fetch`. When one goroutine fails, errgroup cancels `ctx`, but the others don't observe it — they run to completion. The "cancel on first error" benefit is lost.

**Fix:** `return fetch(ctx, url)`.

---

### Q11. What is the bug here?

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return doA(ctx) })
g.Wait()
doB(ctx)
```

**Expected:** `g.Wait` cancels `ctx` on return. `doB` sees `ctx.Err() == context.Canceled` immediately. Use `parent` for `doB`.

---

### Q12. Does errgroup recover panics?

**Expected:** No. A panic in any goroutine spawned via `g.Go` propagates and kills the process. If your code can panic, wrap it with `defer recover()` inside the closure.

**Follow-up:** Which library does recover panics? *(`github.com/sourcegraph/conc`.)*

---

### Q13. What ordering guarantee does errgroup provide?

**Expected:** Goroutines run concurrently; their relative order is not specified. The error returned by `Wait` is the *first* one — but "first" means "first to win the `sync.Once` race," which is scheduling-dependent and not predictable. Don't write tests that assume which of several simultaneous errors is returned.

---

### Q14. How would you implement "wait for the first success, cancel the rest"?

**Expected:** Inside the closure, return a sentinel error like `errFound` on success. The first to do so causes `errgroup` to cancel `ctx`. The others see `ctx.Done()` and return `ctx.Err()`. After `Wait`, treat `errFound` as success:

```go
err := g.Wait()
if errors.Is(err, errFound) { return nil }
return err
```

---

### Q15. Can I reuse a `Group` after `Wait`?

**Expected:** No. The behaviour is undefined. Allocate a new `Group`.

---

## Section 3 — Senior

### Q16. How do you collect *all* errors from a group, not just the first?

**Expected:**

```go
var mu sync.Mutex
var errs []error
for _, x := range xs {
    x := x
    g.Go(func() error {
        if err := process(x); err != nil {
            mu.Lock()
            errs = append(errs, err)
            mu.Unlock()
        }
        return nil // never abort the group
    })
}
_ = g.Wait()
return errors.Join(errs...)
```

By returning `nil` from the closure, we prevent errgroup from cancelling the context. We collect errors ourselves. `errors.Join` (Go 1.20+) returns `nil` for an empty slice.

**Trade-off:** We lose the "stop early on first error" benefit. The caller pays for every error to surface.

---

### Q17. You have heterogeneous tasks: some are "small" (cost 1) and some are "large" (cost 10). How do you bound parallelism by total weight?

**Expected:** `SetLimit` is uniform — every task is weight 1. Switch to `semaphore.Weighted`:

```go
sem := semaphore.NewWeighted(100)
g, ctx := errgroup.WithContext(ctx)
for _, t := range tasks {
    t := t
    if err := sem.Acquire(ctx, t.Weight); err != nil {
        return err
    }
    g.Go(func() error {
        defer sem.Release(t.Weight)
        return run(ctx, t)
    })
}
return g.Wait()
```

The semaphore handles weighted admission; errgroup handles wait/error.

---

### Q18. How would you implement quorum (3 of 5 succeed)?

**Expected:** Track successes atomically. The third success returns a sentinel error to cancel the rest. Wait, then translate the sentinel to success.

```go
var ok int32
errQ := errors.New("quorum-reached")
g, ctx := errgroup.WithContext(ctx)
for _, r := range replicas {
    r := r
    g.Go(func() error {
        if err := write(ctx, r); err != nil { return nil }
        if atomic.AddInt32(&ok, 1) >= 3 { return errQ }
        return nil
    })
}
err := g.Wait()
if errors.Is(err, errQ) { return nil }
return err
```

**Follow-up:** What if 4 of 5 fail before 3 succeed? *(Wait returns `nil` because we returned `nil` on failures. You need to also count failures and abort if you can no longer reach quorum.)*

---

### Q19. Why does `Go` block when the limit is full instead of dropping the task?

**Expected:** Backpressure. By blocking the producer, the system rate-limits itself upstream. If `Go` dropped silently, the producer would race ahead and overload memory. If you want drop semantics, use `TryGo`.

---

### Q20. How does errgroup's behaviour change if I pass an already-cancelled context?

**Expected:** The derived context starts already cancelled. Goroutines that read `ctx.Done()` immediately see it. `g.Wait` returns whatever the workers return — if they all return `ctx.Err()`, then `Wait` returns `context.Canceled` (the first one to record it). If the workers ignore `ctx`, they run normally.

---

### Q21. Compare errgroup with `sourcegraph/conc`.

**Expected:** Both implement structured concurrency. Differences:

| | errgroup | conc |
|---|---|---|
| Origin | First-party (Go team) | Third-party (Sourcegraph) |
| Panic recovery | No | Yes |
| Multi-error | No | Yes (via `pool`) |
| Generics | No | Yes |
| Typed results | No | Yes |

Choose errgroup as the default; reach for conc when your work can panic on untrusted input or you want typed-result collection.

---

### Q22. What's the cost of `WithContext` versus plain `Group`?

**Expected:** One `context.WithCancelCause` allocation (the derived context + cancel closure). At spawn time, no extra cost. At first-error time, one cancel call. Negligible compared to any real work. The benefit (cancellation propagation) is almost always worth it for I/O.

---

## Section 4 — Professional

### Q23. Walk through the `Go` method line by line.

**Expected:**

```go
func (g *Group) Go(f func() error) {
    if g.sem != nil { g.sem <- token{} }     // 1. acquire slot if limited
    g.wg.Add(1)                              // 2. register
    go func() {
        defer g.done()                       // 3. release slot + Done
        if err := f(); err != nil {          // 4. run f
            g.errOnce.Do(func() {
                g.err = err                  // 5. record first error
                if g.cancel != nil {
                    g.cancel(g.err)          // 6. cancel derived ctx
                }
            })
        }
    }()
}
```

The semaphore acquire happens *outside* the goroutine. The `wg.Add` happens *outside* the goroutine. The error and cancel are guarded by `sync.Once`.

---

### Q24. Why does the goroutine call `<-g.sem` before `wg.Done()` in `done()`?

**Expected:** To ensure the slot is released *before* the WaitGroup counter drops to zero. If we did `Done` first, a racing `Wait` could observe zero and return while the slot is still held — not directly harmful (Wait doesn't touch sem), but the conservative ordering ensures `len(sem) == 0` whenever `Wait` returns. This is what makes `SetLimit` safe to call after `Wait` (though you shouldn't reuse the group).

---

### Q25. Why `sync.Once` and not a mutex?

**Expected:** Once provides exactly the semantics needed: run the recording-and-cancel block exactly once, no matter how many goroutines try. A mutex would require an additional flag check, more code, and the same effect.

---

### Q26. What changed when errgroup switched from `WithCancel` to `WithCancelCause`?

**Expected:** Pre-change, the derived context's `ctx.Err()` was always `context.Canceled` after a failure — the original error was lost in the context tree. Post-change, `context.Cause(ctx)` returns the original error. This is purely additive; old code that read `ctx.Err()` still works.

---

### Q27. The struct has five fields. Name them and explain.

**Expected:**

- `cancel func(error)` — derived-context cancel; nil if not `WithContext`.
- `wg sync.WaitGroup` — the join counter.
- `sem chan token` — concurrency limiter; nil if no `SetLimit`.
- `errOnce sync.Once` — guards first-error recording.
- `err error` — the recorded first error.

---

### Q28. What is the memory cost of an errgroup?

**Expected:** Roughly 24 bytes for the struct (depending on alignment). Plus `~64 bytes` for the cancel closure if `WithContext`. Plus `n × 8 + 96` for the limit channel if `SetLimit(n)`. Per goroutine: a few atomics, no allocation on the happy path beyond the closure.

---

### Q29. The documentation says "the Group must not be copied after first use." Why?

**Expected:** It contains `sync.WaitGroup` and `sync.Once`, both of which have internal state that cannot be safely copied. Copying after use would clone half of the state, breaking the invariants. `go vet` catches this with the `copylocks` check.

---

### Q30. Suppose two goroutines fail simultaneously with errors A and B. Which does `Wait` return?

**Expected:** Whichever wins the `sync.Once` race. This is not deterministic; it depends on the runtime scheduler. The contract is "first non-nil error," but "first" means "first to enter `Do`." Tests must accept either.

---

## Section 5 — Coding tasks

### T1. Implement parallel-map.

```go
func parallelMap[I, O any](
    ctx context.Context,
    in []I,
    limit int,
    fn func(context.Context, I) (O, error),
) ([]O, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(limit)
    out := make([]O, len(in))
    for i, v := range in {
        i, v := i, v
        g.Go(func() error {
            r, err := fn(ctx, v)
            if err != nil { return err }
            out[i] = r
            return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return out, nil
}
```

Should run on a whiteboard in 5 minutes.

---

### T2. Implement a bounded crawler that fetches URLs from a channel.

```go
func crawl(ctx context.Context, urls <-chan string, limit int) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(limit)
    for {
        select {
        case <-ctx.Done():
            return g.Wait()
        case u, ok := <-urls:
            if !ok { return g.Wait() }
            u := u
            g.Go(func() error { return fetch(ctx, u) })
        }
    }
}
```

---

### T3. Implement a function that returns as soon as 3 of 5 succeed.

(See Q18.)

---

## Section 6 — Real-world scenarios

### S1. Code review: this PR adds errgroup to a function that fetches from 3 services. The reviewer notices the closures call `service.Get(url)` instead of `service.Get(ctx, url)`. What is your feedback?

**Expected:** Block the PR until the context is threaded. Without it, the `WithContext` is decorative — first error does not stop the others. Show the fix.

---

### S2. Production bug: an endpoint using errgroup is hanging. `pprof` shows hundreds of goroutines blocked on the limit channel. What happened?

**Expected:** One of the spawned goroutines is stuck (deadlock, infinite loop, blocked I/O without ctx). Its slot is never released. New `Go` calls block forever. Find the stuck goroutine via `goroutine` profile, fix it to honour `ctx.Done()`.

---

### S3. A teammate replaces `errgroup` with `conc.WaitGroup` "for safety." Is this an improvement?

**Expected:** Depends. `conc.WaitGroup.Go` takes `func()`, not `func() error` — they lose error reporting. If they meant `conc.pool.Pool`, that recovers panics, which can be a real win if the workers run untrusted code. For trusted I/O code, errgroup is still simpler and more canonical.

---

### S4. Your team adopts errgroup widely. After a month, you notice production CPU dropped 5 % despite no functional changes. Plausible?

**Expected:** Yes. The "drop on first error" behaviour saves CPU when one of 5 fan-out calls fails: the other 4 abort instead of running to completion. Across many requests this adds up. (Also possible: errgroup happened to coincide with another optimisation; don't claim causation without measurement.)

---

## Red-flag answers to listen for

- "errgroup is just sync.WaitGroup." (Missing error and cancel.)
- "errgroup catches panics." (False.)
- "Wait returns all errors." (False.)
- "I can reuse a Group." (False.)
- "SetLimit can be called any time." (False.)
- "TryGo errors out when full." (False — it returns `bool`.)
- "WithContext returns a cancel function." (False — only the context. The cancel is internal.)
- "Go runs synchronously." (Wrong — it spawns a goroutine and returns; only blocks if limit is full.)

---

## Sample 30-minute screen

A reasonable screen: 5 conceptual (Q1–Q7), one coding (T1), one bug (S1 or S2), one design (S3).

A reasonable senior+ screen: 3 senior (Q16, Q17, Q21), one professional (Q23 or Q24), one coding with constraint (T3).
