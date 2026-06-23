---
layout: default
title: errgroup — Senior
parent: errgroup
grand_parent: errgroup and x/sync
ancestor: Concurrency
nav_order: 3
permalink: /roadmap/programming-languages/golang/07-concurrency/06-errgroup-x-sync/01-errgroup/senior/
---

# errgroup — Senior Level

← Back to errgroup index

At middle level we mastered the API. At senior level we treat `errgroup` as one component in a concurrency stack: combined with `semaphore.Weighted` for weighted bounds, with `singleflight` for deduplication, with custom retry and backoff, with observability hooks. We also tackle partial-failure policies, which the library deliberately does not opine on, and we study what structured concurrency *should* mean in Go and how errgroup approximates it.

---

## 1. Errgroup as one piece of a concurrency stack

### 1.1 Errgroup + `semaphore.Weighted`

`SetLimit(n)` is uniform — every task counts as 1. Real workloads are heterogeneous. A "fetch 1 KB document" and a "process 200 MB upload" should not consume the same slot.

```go
import (
    "golang.org/x/sync/errgroup"
    "golang.org/x/sync/semaphore"
)

func processJobs(ctx context.Context, jobs []Job) error {
    sem := semaphore.NewWeighted(64) // 64 weight-units total
    g, ctx := errgroup.WithContext(ctx)

    for _, j := range jobs {
        j := j
        if err := sem.Acquire(ctx, j.Weight); err != nil {
            return err // ctx already cancelled
        }
        g.Go(func() error {
            defer sem.Release(j.Weight)
            return process(ctx, j)
        })
    }
    return g.Wait()
}
```

Now a job with weight 16 takes a quarter of the budget; a job with weight 1 takes a sixty-fourth. `errgroup` does the wait/error part, `semaphore.Weighted` does the bounded admission.

Notice we use `sem.Acquire(ctx, ...)` *before* `g.Go`. The acquire blocks the producer when the budget is exhausted — same backpressure as `SetLimit`, but weighted. Errgroup itself runs without a limit (it would conflict with the semaphore's bound).

### 1.2 Errgroup + `singleflight`

If concurrent goroutines might compute the same expensive value, deduplicate with `singleflight`:

```go
import "golang.org/x/sync/singleflight"

var sf singleflight.Group

func lookup(ctx context.Context, key string) (Value, error) {
    v, err, _ := sf.Do(key, func() (any, error) {
        return realLookup(ctx, key) // only one runs at a time per key
    })
    if err != nil {
        return Value{}, err
    }
    return v.(Value), nil
}

func loadAll(ctx context.Context, keys []string) ([]Value, error) {
    g, ctx := errgroup.WithContext(ctx)
    out := make([]Value, len(keys))
    for i, k := range keys {
        i, k := i, k
        g.Go(func() error {
            v, err := lookup(ctx, k)
            if err != nil {
                return err
            }
            out[i] = v
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return out, nil
}
```

If `keys = ["a", "b", "a", "a"]`, the three "a" lookups dedupe into one underlying call.

### 1.3 Errgroup + retry/backoff

Errgroup is not a retry library, but you can put retry inside the closure:

```go
g.Go(func() error {
    backoff := time.Millisecond * 100
    for attempt := 0; attempt < 5; attempt++ {
        err := op(ctx)
        if err == nil { return nil }
        if !isRetryable(err) { return err }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(backoff):
            backoff *= 2
        }
    }
    return errors.New("max retries exceeded")
})
```

Three good things happen:

1. The retry honors `ctx.Done()`, so a sibling goroutine's failure aborts further attempts.
2. The retry's `time.After` is wrapped in `select`, so cancellation interrupts the sleep.
3. The final non-retryable error or exhaustion result is returned to errgroup as the "first error" candidate.

### 1.4 Errgroup + observability

Real production code instruments every goroutine:

```go
g, ctx := errgroup.WithContext(ctx)
for _, x := range xs {
    x := x
    g.Go(func() error {
        ctx, span := tracer.Start(ctx, "process_item",
            trace.WithAttributes(attribute.String("item.id", x.ID)))
        defer span.End()

        t := time.Now()
        err := process(ctx, x)
        metrics.WorkDuration.Observe(time.Since(t).Seconds())
        if err != nil {
            span.RecordError(err)
            metrics.WorkErrors.WithLabelValues(x.Type).Inc()
        }
        return err
    })
}
```

Each goroutine starts a span, records its own duration, records its own error. The parent span (from the caller's context) sees them as children. A failed task in OpenTelemetry shows up as a child span with an error event, plus the parent inherits the error through context cancellation.

---

## 2. Partial-failure policies

`errgroup` ships with one policy: "first error wins, derived ctx cancels, the rest race to finish." For some workloads this is wrong.

### 2.1 Best-effort / all-or-nothing-best-effort

"Run all 100 tasks. Return a slice of results. Per-task errors do not abort the rest."

```go
type Outcome struct {
    Val Value
    Err error
}

func bestEffort(ctx context.Context, xs []Input) []Outcome {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(16)

    out := make([]Outcome, len(xs))
    for i, x := range xs {
        i, x := i, x
        g.Go(func() error {
            v, err := process(ctx, x)
            out[i] = Outcome{Val: v, Err: err}
            return nil // never abort the group
        })
    }
    _ = g.Wait()
    return out
}
```

We never return errors from the closure. Errgroup degrades to "WaitGroup with concurrency limit." `WithContext` is still useful because the *parent* ctx can cancel the group.

### 2.2 Quorum / majority

"Send to 5 replicas. As soon as 3 succeed, return success. Cancel the other 2."

errgroup alone cannot express this. Use a custom counter:

```go
func quorum(ctx context.Context, replicas []string, need int) error {
    g, ctx := errgroup.WithContext(ctx)
    var successes int32
    done := make(chan struct{})
    var once sync.Once

    for _, r := range replicas {
        r := r
        g.Go(func() error {
            if err := write(ctx, r); err != nil {
                return nil // failures don't count, but don't abort
            }
            if atomic.AddInt32(&successes, 1) == int32(need) {
                once.Do(func() { close(done) })
            }
            return nil
        })
    }
    select {
    case <-done:
        return nil // quorum reached, abandon the rest
    case <-ctx.Done():
        return ctx.Err()
    }
    // Note: g.Wait is NOT called here; the abandoned goroutines run on.
    // If they hold resources, this leaks. See section 2.3.
}
```

This is half right. The errgroup ergonomics fit. The cleanup of the laggards does not — we abandon them. A better version uses `WithContext` to cancel them and *then* waits:

```go
func quorumClean(ctx context.Context, replicas []string, need int) error {
    g, ctx := errgroup.WithContext(ctx)
    var successes int32

    for _, r := range replicas {
        r := r
        g.Go(func() error {
            if err := write(ctx, r); err != nil {
                return nil
            }
            if atomic.AddInt32(&successes, 1) >= int32(need) {
                return errQuorumReached // sentinel, triggers ctx cancel
            }
            return nil
        })
    }
    err := g.Wait()
    if errors.Is(err, errQuorumReached) {
        return nil
    }
    return err
}
```

Now we wait for everything. The quorum-completing goroutine returns `errQuorumReached`, which cancels the others; they exit promptly because they thread `ctx` into `write`. `Wait` joins them, then we translate the sentinel back to success.

### 2.3 The "abandon goroutines" anti-pattern

Returning from a function with goroutines still running is technically allowed, but:

- Leaked goroutines pin memory (~2 KB stack + closure heap).
- They may hold open files, sockets, DB transactions.
- They may write to a buffer or log after the caller has moved on.

Always either `g.Wait()` before return, or use a long-running supervisor goroutine that calls `g.Wait()` for you. Never just `return` and assume the runtime cleans up.

### 2.4 Aggregated errors with `errors.Join`

For "I want to know about every failure":

```go
var (
    mu sync.Mutex
    errs []error
)
for _, x := range xs {
    x := x
    g.Go(func() error {
        if err := process(x); err != nil {
            mu.Lock()
            errs = append(errs, fmt.Errorf("%v: %w", x.ID, err))
            mu.Unlock()
        }
        return nil
    })
}
_ = g.Wait()
return errors.Join(errs...) // nil if no errors
```

`errors.Join` (Go 1.20+) returns `nil` for empty input and a multi-error that `errors.Is` can traverse.

---

## 3. Structured concurrency: errgroup as Go's best approximation

### 3.1 What structured concurrency means

Coined by Nathaniel J. Smith in 2018. The discipline:

> Any concurrent work spawned by a function must complete before that function returns.

In structured-concurrency languages (Kotlin coroutines with `coroutineScope`, Python's Trio with nurseries, Java with `StructuredTaskScope`), this is enforced at the language level. In Go, it is a *convention* you must maintain manually.

Errgroup is the Go primitive that gets you closest:

```go
func doParallel(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return doA(ctx) })
    g.Go(func() error { return doB(ctx) })
    return g.Wait() // all goroutines complete before this returns
}
```

When `doParallel` returns, all goroutines it spawned have exited. No leaks. No background work. Errors propagate cleanly. This is structured concurrency.

### 3.2 What errgroup does *not* enforce

- **Goroutines you start with raw `go` outside the group are not tracked.** You can still leak.
- **Nested groups must each be `Wait`-ed.** A function that creates a group and forgets to `Wait` is unstructured.
- **Returning a channel that goroutines write to** is unstructured — the consumer is responsible for draining. Errgroup helps with the upstream side (close the channel after `Wait`), but the convention must be maintained.

The discipline is yours. The library helps.

### 3.3 Nested errgroups

```go
func twoLevel(ctx context.Context) error {
    outer, ctx := errgroup.WithContext(ctx)
    for _, group := range groupsOfWork {
        group := group
        outer.Go(func() error {
            inner, ctx := errgroup.WithContext(ctx)
            for _, item := range group.Items {
                item := item
                inner.Go(func() error { return process(ctx, item) })
            }
            return inner.Wait()
        })
    }
    return outer.Wait()
}
```

Each inner group's lifetime is bounded by one outer goroutine. Outer cancellation propagates: if any inner returns an error, outer cancels, all other inner groups' contexts also cancel (they descend from outer's ctx).

Naming convention: prefer `outer/inner` or descriptive names over `g, g2`. Nested groups read better.

### 3.4 Comparison with Kotlin `coroutineScope`

```kotlin
coroutineScope {
    launch { doA() }
    launch { doB() }
}
// when coroutineScope returns, both launches have completed
// if either threw, the other was cancelled, the exception propagated
```

This is essentially `errgroup.WithContext`. Differences:

- Kotlin cancels via *exceptions*; errgroup cancels via *context*. The Go pattern requires more discipline (read `ctx.Done()`).
- Kotlin propagates the first failure as an exception that the parent catches; errgroup returns it from `Wait`.
- Kotlin's coroutines are cancelled at suspension points by the runtime; Go goroutines are cancelled by your code at `select`/`ctx`-aware calls.

Functionally equivalent. Errgroup is Go's `coroutineScope`.

---

## 4. Comparison with `sourcegraph/conc`

`github.com/sourcegraph/conc` is the most popular alternative. Key differences:

| Feature | errgroup | conc |
|---|---|---|
| Zero-value usable | Yes | Yes |
| Bounded concurrency | `SetLimit` | `WithMaxGoroutines` |
| Panic recovery | No | **Yes** — panics are converted to errors |
| Result collection | Per-task return only | `pool.ResultPool[T]` collects typed results |
| Stream processing | Not directly | `stream.Stream` |
| All-errors mode | Manual | Built in |
| Generics | No | Yes (`pool.New().WithErrors().WithMaxGoroutines(n)`) |

A `conc` equivalent:

```go
import "github.com/sourcegraph/conc/pool"

func processAll(ctx context.Context, items []Item) ([]Result, error) {
    p := pool.NewWithResults[Result]().
        WithContext(ctx).
        WithMaxGoroutines(16).
        WithCancelOnError()
    for _, x := range items {
        x := x
        p.Go(func(ctx context.Context) (Result, error) {
            return process(ctx, x)
        })
    }
    return p.Wait()
}
```

Choose `conc` when:

- Your workers can panic on untrusted input and you do not want to `defer recover()` in every closure.
- You need typed result collection without manual indexing.
- You like the fluent builder style.

Choose `errgroup` when:

- You want the smallest dependency.
- You want first-party maintenance.
- The codebase is large enough that "the canonical thing" matters more than the latest convenience.

For production at most companies, errgroup is the right default. Reach for `conc` for specific needs.

---

## 5. Backpressure design

A production system has three coupling points:

1. **Producer rate** — how fast items arrive.
2. **Concurrency limit** — how many run at once.
3. **Consumer rate** — how fast each item completes.

`SetLimit(n)` controls (2). The producer's response when (2) is saturated determines whether the system gracefully degrades or piles up. There are four choices.

### 5.1 Block the producer

```go
for x := range producer {
    x := x
    g.Go(func() error { return process(x) })
}
```

When the limit is full, `Go` blocks. The producer is paused. This is fine if the producer is also blocking and has memory bounded by upstream. It is *not* fine if the producer is reading from a network with no own backpressure.

### 5.2 Drop overflow

```go
for x := range producer {
    x := x
    if !g.TryGo(func() error { return process(x) }) {
        metrics.Drops.Inc()
    }
}
```

`TryGo` returns immediately. Overload is observable via the drop counter, but no work waits. Good for stateless ingestion (metrics, logs) where dropping is acceptable.

### 5.3 Buffer with bounded queue

```go
queue := make(chan Item, 1000)
go func() {
    for x := range producer {
        select {
        case queue <- x:
        default:
            metrics.QueueDrops.Inc()
        }
    }
    close(queue)
}()
for x := range queue {
    x := x
    g.Go(func() error { return process(x) })
}
```

Smoothes burstiness. Trade-off: latency increases when queue fills.

### 5.4 Reject upstream

```go
if g.Full() { return ErrTooBusy } // pseudo — errgroup has no Full()
```

`errgroup` does not expose limit status. Use `semaphore.TryAcquire` if you need the signal.

---

## 6. Cancellation propagation discipline

A production codebase enforces:

- Every public function that does I/O takes `context.Context` as its first argument.
- Every blocking call (HTTP, DB, file, sleep) accepts a context.
- Every `errgroup` is paired with `WithContext` unless cancellation is irrelevant.
- Every test runs with `-race`.
- Every code review for a `g.Go` block checks that `ctx` is threaded.

A lint rule that catches `errgroup.WithContext` followed by a `g.Go` whose closure does not reference `ctx` would catch most of the bugs. A few projects have written custom analyzers for this; it is not in the standard toolchain.

---

## 7. Observability checklist

Production errgroup code should expose:

- **Spawn rate.** How many goroutines per second is the group starting?
- **Active count.** How many are currently running? (Inferable from `SetLimit` and atomics.)
- **Per-task duration histogram.** With labels for the task type.
- **Per-task error counter.** With labels for the failure category.
- **Group completion time.** From first `Go` to `Wait` return.
- **Group outcome.** Success or error class.

OpenTelemetry instrumentation:

```go
g, ctx := errgroup.WithContext(ctx)
ctx, span := tracer.Start(ctx, "fanout.users",
    trace.WithAttributes(attribute.Int("count", len(users))))
defer span.End()

for _, u := range users {
    u := u
    g.Go(func() error {
        ctx, span := tracer.Start(ctx, "process.user",
            trace.WithAttributes(attribute.String("user.id", u.ID)))
        defer span.End()
        if err := process(ctx, u); err != nil {
            span.RecordError(err)
            return err
        }
        return nil
    })
}
if err := g.Wait(); err != nil {
    span.RecordError(err)
    return err
}
return nil
```

Each task is a child span; failures propagate via `span.RecordError`; the parent span ends when `Wait` returns.

---

## 8. Common production gotchas

### 8.1 `errgroup` does not respect `sync.Pool` per-goroutine state

If you use a `sync.Pool` inside the closure to recycle buffers, that is fine. But if you assume "the same goroutine handles successive iterations of a loop" (which is *false* with errgroup — each iteration is a new goroutine), pool-affinity goes out the window.

### 8.2 Buffered channels inside the closure

```go
g.Go(func() error {
    ch := make(chan int, 100)
    go feeder(ch)
    for v := range ch {
        process(v)
    }
    return nil
})
```

The inner `go feeder(ch)` is *not* tracked by `errgroup`. If `feeder` panics, it kills the process. If `feeder` runs forever, you leak. Avoid raw `go` inside errgroup closures unless the inner goroutine's lifetime is provably bounded by the outer.

### 8.3 Returning from `Go` early on context

```go
g.Go(func() error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    return doWork(ctx)
})
```

Sometimes you want to skip work if the context is already cancelled. This is fine, but be aware that `Wait` will then return `context.Canceled` as the first error, not the original cause. Use `ctx.Err()` to distinguish `DeadlineExceeded` vs `Canceled`.

### 8.4 Errgroup inside an HTTP handler

```go
func handler(w http.ResponseWriter, r *http.Request) {
    g, ctx := errgroup.WithContext(r.Context())
    // ...
    if err := g.Wait(); err != nil {
        // ...
    }
}
```

The handler's `r.Context()` is cancelled when the client disconnects. That cancellation flows through the derived ctx to all goroutines. Free disconnect-aware behaviour.

### 8.5 Errgroup inside a long-running service

A long-running service (background worker, cron) should pass `context.Background()` or a service-scoped context, *not* a request-scoped one. Otherwise the work cancels when whatever spawned it returns.

---

## 9. Limits of errgroup

Things errgroup is *not*:

- A goroutine pool. Pools reuse goroutines across many tasks; errgroup spawns one per task.
- A task queue. Errgroup tasks are submitted synchronously by the producer.
- A workflow engine. No retries, no scheduling, no persistence.
- An event bus. No pub/sub.
- Streaming. Tasks return errors, not values; for streams use channels.

If your problem is more than "do these N things in parallel," errgroup is the wrong abstraction. Don't bend it.

---

## 10. Summary

At senior level you should be able to:

- Combine errgroup with `semaphore.Weighted` for heterogeneous workloads.
- Combine errgroup with `singleflight` for deduplication.
- Choose between fail-fast, best-effort, quorum, and all-errors policies, and implement each.
- Recognise the limits of errgroup and reach for `conc` when panic recovery or typed results matter.
- Design backpressure: block, drop, buffer, or reject.
- Treat structured concurrency as a discipline, not a guarantee — errgroup helps, you enforce.
- Instrument errgroup code with tracing and metrics.

Next, **professional** dissects the actual source code: the struct, the `sync.Once`, the cancel function, the limit channel, and every subtle interaction the API hides.
