---
layout: default
title: errgroup — Tasks
parent: errgroup
grand_parent: errgroup and x/sync
ancestor: Concurrency
nav_order: 7
permalink: /roadmap/programming-languages/golang/07-concurrency/06-errgroup-x-sync/01-errgroup/tasks/
---

# errgroup — Practice Tasks

← Back to errgroup index

A graded set of exercises. Each task includes a problem statement, a starter snippet (sometimes), an expected behaviour, and a hint section. Solutions live in the "Reference solution" subsection for self-checking. Do not peek until you have something compilable.

---

## Task 1 (Junior) — Convert manual WaitGroup to errgroup

**Problem.** Convert the following to use `errgroup.Group`. Preserve the "return the first error" semantics.

```go
func processAll(items []Item) error {
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
}
```

**Hints.**

- The errgroup version is roughly 6 lines.
- Remember `item := item` for Go &lt; 1.22.

**Reference solution.**

```go
func processAll(items []Item) error {
    var g errgroup.Group
    for _, item := range items {
        item := item
        g.Go(func() error { return process(item) })
    }
    return g.Wait()
}
```

---

## Task 2 (Junior) — Three parallel HTTP fetches

**Problem.** Write a function `fetchThree(ctx context.Context, urls [3]string) ([3][]byte, error)` that fetches all three URLs in parallel and returns their bodies. If any fetch fails, abort the others and return the error.

**Reference solution.**

```go
func fetchThree(ctx context.Context, urls [3]string) ([3][]byte, error) {
    g, ctx := errgroup.WithContext(ctx)
    var bodies [3][]byte
    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
            if err != nil { return err }
            resp, err := http.DefaultClient.Do(req)
            if err != nil { return err }
            defer resp.Body.Close()
            b, err := io.ReadAll(resp.Body)
            if err != nil { return err }
            bodies[i] = b
            return nil
        })
    }
    if err := g.Wait(); err != nil { return [3][]byte{}, err }
    return bodies, nil
}
```

Note: the array indices are disjoint, so writes to `bodies` are race-free.

---

## Task 3 (Junior) — Bounded parallel sum

**Problem.** Given `nums []int` and a function `heavy(n int) int` that is CPU-bound, compute the sum of `heavy(n)` for every `n`. Use at most `runtime.NumCPU()` goroutines.

**Reference solution.**

```go
func parallelSum(nums []int) int {
    var g errgroup.Group
    g.SetLimit(runtime.NumCPU())
    partial := make([]int, len(nums))
    for i, n := range nums {
        i, n := i, n
        g.Go(func() error {
            partial[i] = heavy(n)
            return nil
        })
    }
    _ = g.Wait()
    total := 0
    for _, p := range partial {
        total += p
    }
    return total
}
```

---

## Task 4 (Junior) — Service startup

**Problem.** Write a function `startServices(ctx context.Context) error` that starts three components in parallel: `startDB(ctx)`, `startCache(ctx)`, `startHTTP(ctx)`. Each returns `error`. If any one fails, abort the others and return the error.

**Reference solution.**

```go
func startServices(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return startDB(ctx) })
    g.Go(func() error { return startCache(ctx) })
    g.Go(func() error { return startHTTP(ctx) })
    return g.Wait()
}
```

---

## Task 5 (Middle) — Parallel map with bound

**Problem.** Implement a generic `parallelMap` with bounded concurrency:

```go
func parallelMap[I, O any](
    ctx context.Context,
    in []I,
    limit int,
    fn func(context.Context, I) (O, error),
) ([]O, error)
```

**Hints.** Allocate the output slice up-front. Use disjoint indices. Thread `ctx`.

**Reference solution.**

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

---

## Task 6 (Middle) — Cancel on success

**Problem.** Given `candidates []string` and `matches(ctx context.Context, s string) bool`, find the *first* matching candidate. As soon as one is found, cancel the rest and return.

**Hints.** Use a sentinel error to signal "found."

**Reference solution.**

```go
var errFound = errors.New("found")

func findFirst(ctx context.Context, candidates []string) (string, error) {
    g, ctx := errgroup.WithContext(ctx)
    var match string
    var mu sync.Mutex
    for _, c := range candidates {
        c := c
        g.Go(func() error {
            if matches(ctx, c) {
                mu.Lock()
                if match == "" { match = c }
                mu.Unlock()
                return errFound
            }
            return nil
        })
    }
    err := g.Wait()
    if errors.Is(err, errFound) { return match, nil }
    if err != nil { return "", err }
    return "", errors.New("no match")
}
```

The mutex is used to record the first match deterministically; without it, two simultaneous winners could each write `match`, and you'd get whichever the scheduler ran last.

---

## Task 7 (Middle) — Producer with drop on overflow

**Problem.** Read items from `producer <-chan Item` and process each with up to 4 goroutines. If 4 are already busy, drop the item and increment `drops`.

**Reference solution.**

```go
func processWithDrop(ctx context.Context, producer <-chan Item) (drops int, err error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(4)
    for item := range producer {
        item := item
        if !g.TryGo(func() error { return process(ctx, item) }) {
            drops++
        }
    }
    return drops, g.Wait()
}
```

---

## Task 8 (Middle) — All-errors collection

**Problem.** Like Task 1 (process all items), but return *all* errors, not just the first. Use `errors.Join`.

**Reference solution.**

```go
func processAllCollect(items []Item) error {
    var g errgroup.Group
    var mu sync.Mutex
    var errs []error
    for _, item := range items {
        item := item
        g.Go(func() error {
            if err := process(item); err != nil {
                mu.Lock()
                errs = append(errs, fmt.Errorf("item %v: %w", item.ID, err))
                mu.Unlock()
            }
            return nil
        })
    }
    _ = g.Wait()
    return errors.Join(errs...)
}
```

---

## Task 9 (Middle) — Pipeline with three stages

**Problem.** Build a three-stage pipeline:

1. Reader produces `Raw` items into `chan Raw`.
2. Parser reads `Raw`, produces `Parsed` into `chan Parsed`.
3. Writer reads `Parsed` and stores them.

Use one errgroup for all three stages.

**Reference solution.**

```go
func pipeline(ctx context.Context) error {
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
        for p := range parsed {
            if err := write(ctx, p); err != nil { return err }
        }
        return nil
    })
    return g.Wait()
}
```

Note the `defer close(channel)` after each producer stage. Without it, the consumer hangs.

---

## Task 10 (Senior) — Quorum write

**Problem.** Given 5 replicas, write to all 5 in parallel. Return success as soon as 3 succeed. Cancel the remaining writes.

**Reference solution.**

```go
var errQuorum = errors.New("quorum reached")

func quorumWrite(ctx context.Context, replicas []string, payload []byte) error {
    g, ctx := errgroup.WithContext(ctx)
    var ok int32
    need := int32((len(replicas) / 2) + 1)
    for _, r := range replicas {
        r := r
        g.Go(func() error {
            if err := write(ctx, r, payload); err != nil {
                return nil // failures don't count, don't abort
            }
            if atomic.AddInt32(&ok, 1) == need {
                return errQuorum
            }
            return nil
        })
    }
    err := g.Wait()
    if errors.Is(err, errQuorum) { return nil }
    return errors.New("quorum not reached")
}
```

**Variant:** Add failure tracking so the function aborts if more than `len(replicas) - need` writes have failed (quorum impossible).

---

## Task 11 (Senior) — Weighted concurrency with semaphore

**Problem.** Each task has a `Weight int`. Total weight in flight must not exceed 100. Process all tasks; fail fast on first error.

**Reference solution.**

```go
func processWeighted(ctx context.Context, tasks []Task) error {
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
}
```

`SetLimit` cannot do weights. Always pair errgroup with `semaphore.Weighted` for heterogeneous tasks.

---

## Task 12 (Senior) — Crawler with depth and per-host limit

**Problem.** Crawl a website starting from one URL, follow links, do not exceed depth 3, and never have more than 4 in-flight requests per host.

**Outline.**

```go
type Crawler struct {
    maxDepth int
    hostSem  map[string]*semaphore.Weighted
    mu       sync.Mutex
    visited  map[string]bool
}

func (c *Crawler) Crawl(ctx context.Context, start string) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return c.crawl(ctx, g, start, 0) })
    return g.Wait()
}

func (c *Crawler) crawl(ctx context.Context, g *errgroup.Group, url string, depth int) error {
    if depth > c.maxDepth { return nil }
    if !c.markVisited(url) { return nil }
    sem := c.semFor(url)
    if err := sem.Acquire(ctx, 1); err != nil { return err }
    defer sem.Release(1)

    links, err := fetch(ctx, url)
    if err != nil { return err }
    for _, l := range links {
        l := l
        g.Go(func() error { return c.crawl(ctx, g, l, depth+1) })
    }
    return nil
}
```

**Discussion.** Recursion through `g.Go` inside a goroutine that is itself in `g` works because errgroup's `Add` is goroutine-safe. The depth-3 cap and visited map prevent infinite spawning.

---

## Task 13 (Senior) — Errgroup with retries

**Problem.** Each task may fail transiently. Retry each up to 3 times with exponential backoff. Fail fast on non-retryable errors.

**Reference solution.**

```go
func processWithRetry(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, x := range items {
        x := x
        g.Go(func() error {
            backoff := 100 * time.Millisecond
            for attempt := 0; attempt < 3; attempt++ {
                err := process(ctx, x)
                if err == nil { return nil }
                if !isRetryable(err) { return err }
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case <-time.After(backoff):
                    backoff *= 2
                }
            }
            return fmt.Errorf("item %v: retries exhausted", x.ID)
        })
    }
    return g.Wait()
}
```

Note: the `time.After` is wrapped in `select` so cancellation interrupts the wait.

---

## Task 14 (Senior) — Race against deadline

**Problem.** Run a slow operation, but cap total wall time at 2 seconds. Return early with `context.DeadlineExceeded` if the operation is not done.

**Reference solution.**

```go
func withDeadline(parent context.Context) error {
    ctx, cancel := context.WithTimeout(parent, 2*time.Second)
    defer cancel()
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return slowOp(ctx) })
    return g.Wait()
}
```

The outer `WithTimeout` enforces the deadline. The inner `WithContext` is technically redundant for one goroutine, but kept for consistency and to make extension to more goroutines trivial.

---

## Task 15 (Professional) — Implement errgroup yourself

**Problem.** Implement a minimal `Group` with `Go`, `Wait`, `WithContext`, `SetLimit`, `TryGo`. Match the public API and behaviour.

**Reference solution.** See `professional.md` Section 11. Hand-write it from scratch on a whiteboard.

---

## Task 16 (Professional) — Add panic recovery

**Problem.** Wrap `errgroup.Group` in a new type that converts panics in worker functions to errors:

```go
type SafeGroup struct { /* ... */ }
func (sg *SafeGroup) Go(f func() error)
func (sg *SafeGroup) Wait() error
```

**Reference solution.**

```go
type SafeGroup struct {
    g errgroup.Group
}

func NewSafeGroup() *SafeGroup { return &SafeGroup{} }

func (sg *SafeGroup) Go(f func() error) {
    sg.g.Go(func() (err error) {
        defer func() {
            if r := recover(); r != nil {
                err = fmt.Errorf("panic in worker: %v", r)
            }
        }()
        return f()
    })
}

func (sg *SafeGroup) Wait() error { return sg.g.Wait() }
```

Now a panic in a worker becomes an error like any other.

**Variant:** Capture the stack trace.

```go
defer func() {
    if r := recover(); r != nil {
        buf := make([]byte, 4096)
        n := runtime.Stack(buf, false)
        err = fmt.Errorf("panic: %v\n%s", r, buf[:n])
    }
}()
```

---

## Task 17 (Professional) — Multi-error errgroup

**Problem.** Wrap `errgroup.Group` to collect all errors instead of just the first:

```go
type MultiGroup struct { /* ... */ }
func (mg *MultiGroup) Go(f func() error)
func (mg *MultiGroup) Wait() error // returns errors.Join of all errors
```

**Reference solution.**

```go
type MultiGroup struct {
    g    errgroup.Group
    mu   sync.Mutex
    errs []error
}

func (mg *MultiGroup) Go(f func() error) {
    mg.g.Go(func() error {
        if err := f(); err != nil {
            mg.mu.Lock()
            mg.errs = append(mg.errs, err)
            mg.mu.Unlock()
        }
        return nil // always succeed so errgroup doesn't short-circuit
    })
}

func (mg *MultiGroup) Wait() error {
    _ = mg.g.Wait()
    mg.mu.Lock()
    defer mg.mu.Unlock()
    return errors.Join(mg.errs...)
}
```

Note we return `nil` from the inner closure: we manage errors ourselves and don't want errgroup to cancel a context we're not providing.

---

## Task 18 (Professional) — Errgroup with active-count metric

**Problem.** Track the maximum number of concurrently active goroutines using `expvar` or atomics.

**Reference solution.**

```go
type MeteredGroup struct {
    g       errgroup.Group
    active  atomic.Int64
    maxSeen atomic.Int64
}

func (mg *MeteredGroup) Go(f func() error) {
    mg.g.Go(func() error {
        n := mg.active.Add(1)
        for {
            old := mg.maxSeen.Load()
            if n <= old || mg.maxSeen.CompareAndSwap(old, n) {
                break
            }
        }
        defer mg.active.Add(-1)
        return f()
    })
}

func (mg *MeteredGroup) Wait() error { return mg.g.Wait() }
func (mg *MeteredGroup) MaxConcurrency() int64 { return mg.maxSeen.Load() }
```

Use in tests to verify `SetLimit` works:

```go
mg := &MeteredGroup{}
mg.g.SetLimit(4)
for i := 0; i < 100; i++ {
    mg.Go(func() error {
        time.Sleep(10 * time.Millisecond)
        return nil
    })
}
_ = mg.Wait()
require.LessOrEqual(t, mg.MaxConcurrency(), int64(4))
```

---

## Task 19 (Professional) — Backpressure design

**Problem.** Design and implement an event handler that:

- Accepts events from a producer at unbounded rate.
- Processes at most 8 concurrently.
- If the producer outpaces the consumer by more than 1000 buffered, sheds load and returns the oldest event to the producer.

This stress-tests your understanding of `TryGo`, buffered channels, and overflow handling. Sketch first, then write.

---

## Task 20 (Professional) — Compare with conc

Re-implement Task 5 (`parallelMap`) using `github.com/sourcegraph/conc/pool`. Compare LoC, readability, and behaviour with the errgroup version. Argue which is preferable for this case.

---

## Solutions checklist

For each task you complete, verify:

- [ ] You compiled without warnings (including `go vet`).
- [ ] You ran the code under `go test -race`.
- [ ] You threaded `ctx` into every blocking call.
- [ ] You captured loop variables (or you're on Go 1.22+).
- [ ] You handle the empty input case (`len(in) == 0` returns immediately with nil error).
- [ ] You handle the all-success and all-failure cases.
- [ ] You documented any non-obvious decision in a comment.

---

## Difficulty progression

- Tasks 1–4 introduce the basic API.
- Tasks 5–9 introduce `SetLimit`, `TryGo`, and patterns.
- Tasks 10–14 combine errgroup with semaphores, retries, and deadlines.
- Tasks 15–20 challenge you to extend errgroup or build something larger.

You should be able to solve every task on a whiteboard by the time you finish senior level. Tasks 15–20 are appropriate for technical interviews at staff level or system-design rounds.
