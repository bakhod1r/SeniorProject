# Deadlines and Cancellations — Tasks

[← Back to index](junior.md)

Hands-on exercises that build muscle memory for context cancellation. Each task lists a goal, a starter signature, expected behavior, and a hint section. Solutions are at the end. Solve them in order; later tasks reuse skills from earlier ones.

## Task 1 — Cancellable Counter

**Goal.** Write a function `Count(ctx, every)` that prints an incrementing integer every `every` duration, stopping cleanly on cancellation.

```go
func Count(ctx context.Context, every time.Duration)
```

Behaviour:

- Prints `0`, `1`, `2`, ... at intervals of `every`.
- Returns when `ctx` is canceled, *not* a moment later.
- Stops the underlying ticker before returning.

**Hint.** Use `time.NewTicker` and select on its `C` and `ctx.Done()`. Defer `t.Stop()`.

---

## Task 2 — Deadline-Aware Sleep

**Goal.** Implement `Sleep(ctx, d)` that sleeps `d` but returns early on cancellation. It should return `ctx.Err()` if canceled, `nil` if the sleep completed.

```go
func Sleep(ctx context.Context, d time.Duration) error
```

Behaviour:

- Behaves like `time.Sleep(d)` if `ctx` is never canceled.
- Returns `context.Canceled` (or `DeadlineExceeded`) the moment cancel fires.

**Hint.** `time.NewTimer(d)` plus a `select`.

---

## Task 3 — Best of Three

**Goal.** Given three URLs, fetch all three concurrently and return the response from whichever finishes first. Cancel the slow ones.

```go
func BestOfThree(ctx context.Context, urls [3]string) (string, error)
```

Behaviour:

- Returns as soon as the first non-error response arrives.
- Slow goroutines see `ctx.Done()` and exit.
- Returns the original `ctx.Err()` if all three error or are canceled before any responds.

**Hint.** Derive an inner `WithCancel(ctx)`; cancel it on first success. Buffered result channel.

---

## Task 4 — Bounded Worker Pool

**Goal.** A worker pool of `n` workers consumes jobs from `jobs` and sends results to `results`. Stops cleanly when `ctx` is canceled or `jobs` is closed.

```go
type Job struct{ ID int }
type Result struct{ ID int; Value int; Err error }

func RunPool(ctx context.Context, n int, jobs <-chan Job, results chan<- Result)
```

Behaviour:

- Reads from `jobs` until closed; on each, computes a result and writes to `results`.
- Returns when ctx is canceled, regardless of remaining jobs.
- `results` is closed by the function before it returns.

**Hint.** Spawn `n` workers with `sync.WaitGroup`. Each loops on `select { case <-ctx.Done(); case j, ok := <-jobs }`. After `wg.Wait()`, close `results`.

---

## Task 5 — Hierarchical Cancel

**Goal.** Build a tree of contexts. Cancel a middle node and verify only its descendants are affected.

```go
func main() {
    root := context.Background()

    parent, parentCancel := context.WithCancel(root)
    defer parentCancel()

    sib1, _ := context.WithCancel(root)   // sibling of parent
    childA, _ := context.WithCancel(parent)
    childB, _ := context.WithCancel(parent)

    parentCancel()

    // Print which contexts are canceled.
}
```

Print three lines: which of `sib1`, `childA`, `childB` are canceled.

**Hint.** A small helper:

```go
func canceled(name string, ctx context.Context) {
    select {
    case <-ctx.Done():
        fmt.Println(name, "canceled:", ctx.Err())
    default:
        fmt.Println(name, "still running")
    }
}
```

---

## Task 6 — Periodic Health Check

**Goal.** Write a function that calls a health endpoint every 5 s, retrying on failure with exponential backoff up to 30 s. Stops on context cancel.

```go
func Healthz(ctx context.Context, url string)
```

Behaviour:

- On 200 OK, log "ok" and wait 5 s before next try.
- On error, log error and wait `2^attempt * 1s`, capped at 30 s.
- All sleeps respect ctx.

**Hint.** Two helpers: `do(ctx, url)` for the HTTP call, `wait(ctx, d)` for cancellable sleep.

---

## Task 7 — Cancel Cause Propagation

**Goal.** A pipeline of three stages: `read → transform → write`. Each stage is its own goroutine connected by channels. If any stage fails, the others must stop with the failing stage's error visible via `context.Cause`.

```go
func RunPipeline(ctx context.Context, in <-chan int, out chan<- string) error
```

**Hint.** `context.WithCancelCause(ctx)`; when any stage errors, call `cancel(stageErr)`.

---

## Task 8 — Time-Bounded Read

**Goal.** Read from `r io.Reader` with a per-read deadline of `d`. Return as soon as you have at least one byte, or when the context is canceled.

```go
func ReadByByte(ctx context.Context, r io.Reader, d time.Duration) ([]byte, error)
```

Behaviour:

- Each individual read is wrapped with `WithTimeout(ctx, d)`.
- If `ctx` is canceled, return its error immediately.
- Wrap the reader to check context before each `Read`.

**Hint.** A small wrapper:

```go
type ctxReader struct{ ctx context.Context; r io.Reader }
func (c *ctxReader) Read(p []byte) (int, error) {
    if err := c.ctx.Err(); err != nil { return 0, err }
    return c.r.Read(p)
}
```

---

## Task 9 — AfterFunc Cleanup

**Goal.** Acquire a "lease" identified by a string. Implement `Acquire(ctx, id)` that returns a `*Lease` and arranges for `release(id)` to run automatically when `ctx` is canceled. The user can also call `Lease.Release()` to release manually.

```go
type Lease struct { /* ... */ }
func Acquire(ctx context.Context, id string) (*Lease, error)
func (l *Lease) Release()
```

Behaviour:

- `release(id)` runs exactly once.
- Calling `Release()` while ctx is alive cancels the after-func registration.
- Calling `Release()` after ctx canceled is a no-op (release already ran).

**Hint.** `context.AfterFunc(ctx, func(){ release(id) })`. Track whether stop returned `true`.

---

## Task 10 — Deadline Splitter

**Goal.** Given a context with a deadline, split the remaining time across N sub-tasks proportionally. Each sub-task runs `work(ctx)` with its slice; if `work` returns before its slice expires, the unused budget rolls over to the next.

```go
func RunSplit(ctx context.Context, weights []float64, work func(context.Context) error) error
```

Behaviour:

- `weights` sum to 1.0 (normalise if not).
- Each sub-task gets `WithTimeout(ctx, slice)` where `slice = remaining * weight`.
- Errors from any sub-task abort the rest.

**Hint.** Capture `ctx.Deadline()` once at the top. Track elapsed time and recompute remaining for each iteration.

---

## Task 11 — WithoutCancel Audit

**Goal.** A handler runs `serve(ctx)` and on completion fires off `audit(ctx)` in a goroutine. The audit must complete even if `ctx` is canceled. Trace IDs from `ctx` should still be visible in the audit.

```go
func Handle(ctx context.Context, req Request)
```

**Hint.** `auditCtx := context.WithoutCancel(ctx); auditCtx, cancel := context.WithTimeout(auditCtx, 5*time.Second); go func() { defer cancel(); audit(auditCtx, req) }()`.

---

## Task 12 — Bug Hunt

**Goal.** Find the three bugs in this code:

```go
func process(parent context.Context, items []Item) error {
    ctx, _ := context.WithTimeout(parent, 5*time.Second)

    for _, item := range items {
        time.Sleep(100 * time.Millisecond)
        if err := handleItem(ctx, item); err != nil {
            return err
        }
    }
    return nil
}
```

Identify them, then fix.

**Answer (don't peek):**

1. Cancel discarded.
2. `time.Sleep` in cancel-aware loop.
3. No periodic check of `ctx.Err()` for early exit when `handleItem` is fast.

---

## Solutions

### Solution 1

```go
func Count(ctx context.Context, every time.Duration) {
    t := time.NewTicker(every)
    defer t.Stop()
    n := 0
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            fmt.Println(n)
            n++
        }
    }
}
```

### Solution 2

```go
func Sleep(ctx context.Context, d time.Duration) error {
    if d <= 0 {
        return ctx.Err()
    }
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-t.C:
        return nil
    }
}
```

### Solution 3

```go
type fetchResult struct{ body string; err error }

func BestOfThree(ctx context.Context, urls [3]string) (string, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    out := make(chan fetchResult, len(urls))
    for _, u := range urls {
        u := u
        go func() {
            req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
            resp, err := http.DefaultClient.Do(req)
            if err != nil {
                out <- fetchResult{"", err}
                return
            }
            defer resp.Body.Close()
            b, err := io.ReadAll(resp.Body)
            out <- fetchResult{string(b), err}
        }()
    }

    var lastErr error
    for i := 0; i < len(urls); i++ {
        r := <-out
        if r.err == nil {
            return r.body, nil
        }
        lastErr = r.err
    }
    return "", lastErr
}
```

### Solution 4

```go
func RunPool(ctx context.Context, n int, jobs <-chan Job, results chan<- Result) {
    var wg sync.WaitGroup
    wg.Add(n)
    for w := 0; w < n; w++ {
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case j, ok := <-jobs:
                    if !ok {
                        return
                    }
                    select {
                    case <-ctx.Done():
                        return
                    case results <- Result{ID: j.ID, Value: j.ID * 2}:
                    }
                }
            }
        }()
    }
    go func() { wg.Wait(); close(results) }()
}
```

### Solution 5

```go
canceled("sib1", sib1)     // still running
canceled("childA", childA) // canceled
canceled("childB", childB) // canceled
```

### Solution 6

```go
func Healthz(ctx context.Context, url string) {
    attempt := 0
    for {
        if err := do(ctx, url); err != nil {
            log.Println("error:", err)
            d := time.Duration(1<<min(attempt, 5)) * time.Second
            if err := Sleep(ctx, d); err != nil {
                return
            }
            attempt++
            continue
        }
        log.Println("ok")
        attempt = 0
        if err := Sleep(ctx, 5*time.Second); err != nil {
            return
        }
    }
}

func do(ctx context.Context, url string) error {
    req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return err }
    resp.Body.Close()
    if resp.StatusCode != 200 { return fmt.Errorf("status %d", resp.StatusCode) }
    return nil
}
```

### Solution 7

```go
func RunPipeline(parent context.Context, in <-chan int, out chan<- string) error {
    ctx, cancel := context.WithCancelCause(parent)
    defer cancel(nil)

    mid := make(chan int, 8)

    go func() {
        defer close(mid)
        for v := range in {
            select {
            case <-ctx.Done():
                return
            case mid <- v:
            }
        }
    }()

    go func() {
        defer close(out)
        for v := range mid {
            if v < 0 {
                cancel(fmt.Errorf("negative input %d", v))
                return
            }
            select {
            case <-ctx.Done():
                return
            case out <- fmt.Sprintf("v=%d", v*2):
            }
        }
    }()

    <-ctx.Done()
    return context.Cause(ctx)
}
```

### Solution 8

```go
func ReadByByte(ctx context.Context, r io.Reader, d time.Duration) ([]byte, error) {
    var buf bytes.Buffer
    cr := &ctxReader{ctx: ctx, r: r}
    for {
        readCtx, cancel := context.WithTimeout(ctx, d)
        cr.ctx = readCtx
        b := make([]byte, 1)
        n, err := cr.Read(b)
        cancel()
        if err != nil {
            return buf.Bytes(), err
        }
        if n > 0 {
            buf.Write(b[:n])
            return buf.Bytes(), nil
        }
    }
}
```

### Solution 9

```go
type Lease struct {
    id      string
    once    sync.Once
    stop    func() bool
    release func(string)
}

func Acquire(ctx context.Context, id string) (*Lease, error) {
    if err := remoteAcquire(ctx, id); err != nil {
        return nil, err
    }
    l := &Lease{id: id, release: remoteRelease}
    l.stop = context.AfterFunc(ctx, func() { l.release(id) })
    return l, nil
}

func (l *Lease) Release() {
    l.once.Do(func() {
        if l.stop() {
            l.release(l.id)
        }
    })
}
```

### Solution 10

```go
func RunSplit(ctx context.Context, weights []float64, work func(context.Context) error) error {
    deadline, ok := ctx.Deadline()
    if !ok {
        return errors.New("context has no deadline")
    }
    var total float64
    for _, w := range weights { total += w }
    for i, w := range weights {
        remaining := time.Until(deadline)
        if remaining <= 0 {
            return context.DeadlineExceeded
        }
        slice := time.Duration(float64(remaining) * (w / total))
        sub, cancel := context.WithTimeout(ctx, slice)
        err := work(sub)
        cancel()
        if err != nil {
            return fmt.Errorf("step %d: %w", i, err)
        }
        // recompute total for remaining steps
        total -= w
    }
    return nil
}
```

### Solution 11

```go
func Handle(ctx context.Context, req Request) {
    if err := serve(ctx, req); err != nil {
        log.Println(err)
    }
    auditCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
    go func() {
        defer cancel()
        if err := audit(auditCtx, req); err != nil {
            log.Println("audit:", err)
        }
    }()
}
```

### Solution 12

```go
func process(parent context.Context, items []Item) error {
    ctx, cancel := context.WithTimeout(parent, 5*time.Second)
    defer cancel()

    for i, item := range items {
        if i%50 == 0 {
            if err := ctx.Err(); err != nil {
                return err
            }
        }
        if err := handleItem(ctx, item); err != nil {
            return err
        }
        // No time.Sleep — control via the per-item handleItem.
    }
    return nil
}
```

---

## Stretch Tasks

- **A.** Implement `WithCancelMerge(a, b)` that returns a context canceled when either `a` or `b` cancels. (Hint: `AfterFunc`.)
- **B.** Write a benchmark comparing `WithValue(parent, k1, v1)` chained six times vs a single `WithValue(parent, key, struct{...}{})`. Report ns/op and B/op.
- **C.** Build a lightweight scheduler that runs jobs at fixed intervals and shuts down cleanly on `SIGINT`. Use `signal.NotifyContext`.
- **D.** Reproduce the slow-path goroutine cost: write a custom `Context` and benchmark `WithCancel` derivation count. Compare to deriving from `Background`.
- **E.** Add `WithCancelCause`-style logging to the worker pool: every cancel records `who-canceled, when, why`.

These tasks compound. After all twelve plus stretch, you have practical fluency with every cancellation API in the Go runtime.
