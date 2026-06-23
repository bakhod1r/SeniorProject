# Goroutine Best Practices — Optimize

> Each section presents working-but-poorly-disciplined Go code and rewrites it to production grade. The point is not to make it run faster but to make it correct, observable, and operable. The rewrites apply the twelve rules from junior consistently.

---

## How to use this file

1. Read the "Before" code.
2. List which rules it violates and the operational risks they create.
3. Sketch a rewrite in your head.
4. Read the "After" code.
5. Compare. Note which rules were applied and how.

---

## Optimization 1: Fan-out with hand-rolled `WaitGroup`+`chan error`

### Before

```go
func fetchAll(urls []string) ([]Response, error) {
    var wg sync.WaitGroup
    results := make([]Response, len(urls))
    errCh := make(chan error, len(urls))

    for i, url := range urls {
        wg.Add(1)
        go func(i int, url string) {
            defer wg.Done()
            r, err := http.Get(url)
            if err != nil {
                errCh <- err
                return
            }
            defer r.Body.Close()
            results[i] = parseResponse(r)
        }(i, url)
    }
    wg.Wait()
    close(errCh)

    for err := range errCh {
        if err != nil {
            return nil, err
        }
    }
    return results, nil
}
```

### Violations

- No `context.Context` (Rule 4).
- No bounded concurrency — 1000 URLs spawn 1000 goroutines (Rule 10).
- Hand-rolled coordination where `errgroup` would do (Rule 6).
- First error doesn't cancel peers; they all run.
- No `recover` on the goroutines (Rule 5).
- `http.Get` does not respect any timeout; can hang forever.

### After

```go
func fetchAll(ctx context.Context, urls []string) ([]Response, error) {
    results := make([]Response, len(urls))
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(16)

    for i, url := range urls {
        i, url := i, url
        g.Go(func() (err error) {
            defer func() {
                if r := recover(); r != nil {
                    err = fmt.Errorf("panic fetching %s: %v", url, r)
                }
            }()
            req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
            if err != nil {
                return err
            }
            resp, err := http.DefaultClient.Do(req)
            if err != nil {
                return err
            }
            defer resp.Body.Close()
            results[i] = parseResponse(resp)
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

### Rules applied

- 4: `ctx` threaded; HTTP request respects it.
- 5: recover at goroutine boundary, converted to error.
- 6: `errgroup` replaces hand-rolled coordination.
- 10: `SetLimit(16)` bounds concurrency.
- 1: clear exit story — each goroutine returns when the HTTP request completes or `ctx` cancels.

### Observable benefits

- First error cancels peers (saves work and downstream load).
- Shutdown via `ctx` is immediate.
- Concurrency bounded; doesn't OOM on 100 000 URLs.
- Panics surface as errors, not process crashes.

---

## Optimization 2: Worker pool reading from a queue

### Before

```go
func consumeQueue(q Queue) {
    for {
        msg, err := q.Receive()
        if err != nil {
            log.Println("recv:", err)
            continue
        }
        go process(msg)
    }
}
```

### Violations

- No exit (Rule 1).
- No context (Rule 4).
- Unbounded goroutines per message (Rule 10).
- No recover (Rule 5).
- Errors from `process` are silently lost.

### After

```go
func consumeQueue(ctx context.Context, q Queue, workers int) error {
    msgs := make(chan Msg, workers)
    g, ctx := errgroup.WithContext(ctx)

    // Producer: reads from q, pushes to msgs.
    g.Go(func() error {
        defer close(msgs)
        for {
            select {
            case <-ctx.Done():
                return ctx.Err()
            default:
            }
            msg, err := q.Receive(ctx)
            if err != nil {
                if ctx.Err() != nil {
                    return ctx.Err()
                }
                return fmt.Errorf("receive: %w", err)
            }
            select {
            case msgs <- msg:
            case <-ctx.Done():
                return ctx.Err()
            }
        }
    })

    // Workers: read from msgs.
    for i := 0; i < workers; i++ {
        i := i
        g.Go(func() error {
            for {
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case msg, ok := <-msgs:
                    if !ok {
                        return nil
                    }
                    if err := processWithRecover(ctx, i, msg); err != nil {
                        log.Printf("worker %d: %v", i, err)
                    }
                }
            }
        })
    }

    return g.Wait()
}

func processWithRecover(ctx context.Context, id int, msg Msg) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("worker %d panic: %v", id, r)
        }
    }()
    return process(ctx, msg)
}
```

### Rules applied

- 1: producer and workers each exit on `ctx.Done()` or channel close.
- 4: `ctx` throughout.
- 5: `processWithRecover` boundary.
- 6: `errgroup`.
- 10: fixed `workers` count bounds concurrency.

### Observable benefits

- Bounded memory under load.
- Graceful shutdown: cancel `ctx`, producer stops pulling, workers drain `msgs`, all exit.
- Per-worker error logging; a panic in one message doesn't crash the rest.

---

## Optimization 3: Background ticker

### Before

```go
func flusher() {
    for {
        time.Sleep(time.Second)
        flush()
    }
}

// in main:
go flusher()
```

### Violations

- No exit story (Rule 1).
- No context (Rule 4).
- No recover (Rule 5).
- `time.Sleep` for the loop is technically a ticker, but doesn't compose with cancellation.

### After

```go
func runFlusher(ctx context.Context, interval time.Duration) error {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("flusher panic: %v\n%s", r, debug.Stack())
        }
    }()
    ticker := time.NewTicker(interval)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-ticker.C:
            if err := flush(ctx); err != nil {
                log.Printf("flush: %v", err)
            }
        }
    }
}

// in main:
g.Go(func() error { return runFlusher(ctx, time.Second) })
```

### Rules applied

- 1: returns when `ctx` cancels.
- 4: context threaded; `flush` accepts it.
- 5: recover at the loop boundary.
- 8: ticker, not sleep, so it composes with `select`.

### Observable benefits

- On SIGTERM, the flusher stops within one tick interval at most.
- Panics don't crash the service.

---

## Optimization 4: HTTP handler spawning background work

### Before

```go
func handler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    go saveToS3(body)
    w.WriteHeader(202)
}
```

### Violations

- No exit story (Rule 1) — `saveToS3` may run after the server shuts down.
- No context (Rule 4) — request context isn't threaded; `saveToS3` can't know if the request was abandoned.
- No recover (Rule 5).
- Unbounded spawning per request (Rule 10).
- The detached goroutine outlives the handler; nothing tracks completion.

### After

```go
type Server struct {
    saver *BackgroundSaver
}

type BackgroundSaver struct {
    sem chan struct{}
    wg  sync.WaitGroup
}

func NewBackgroundSaver(concurrency int) *BackgroundSaver {
    return &BackgroundSaver{
        sem: make(chan struct{}, concurrency),
    }
}

func (b *BackgroundSaver) Save(ctx context.Context, body []byte) error {
    select {
    case b.sem <- struct{}{}:
    case <-ctx.Done():
        return ctx.Err()
    }
    b.wg.Add(1)
    go func() {
        defer b.wg.Done()
        defer func() { <-b.sem }()
        defer func() {
            if r := recover(); r != nil {
                log.Printf("save panic: %v", r)
            }
        }()
        if err := saveToS3(ctx, body); err != nil {
            log.Printf("save failed: %v", err)
        }
    }()
    return nil
}

func (b *BackgroundSaver) Shutdown(ctx context.Context) error {
    done := make(chan struct{})
    go func() {
        b.wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (s *Server) handler(w http.ResponseWriter, r *http.Request) {
    body, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    if err := s.saver.Save(r.Context(), body); err != nil {
        http.Error(w, "busy", http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(202)
}
```

### Rules applied

- 1: every spawned goroutine has an exit; `Shutdown` waits.
- 4: `ctx` from the request is threaded; `saveToS3` respects it.
- 5: recover in each goroutine.
- 10: `sem` bounds concurrency.
- 11: `BackgroundSaver` should now have a doc comment about concurrency safety.

### Observable benefits

- Service can shut down gracefully and wait for in-flight saves.
- Backpressure: if the pool is full, the request gets 503 instead of OOM.
- A failing `saveToS3` doesn't crash the server.

---

## Optimization 5: Shared mutable state

### Before

```go
type Stats struct {
    count int
    sum   int
}

func (s *Stats) Add(x int) {
    s.count++
    s.sum += x
}

func (s *Stats) Mean() float64 {
    return float64(s.sum) / float64(s.count)
}
```

Used from many goroutines concurrently.

### Violations

- Race on `count` and `sum` (Rule 9 detected, Rule 7 prevention missing).
- No doc on concurrency safety (Rule 11).

### After (mutex version)

```go
// Stats is safe for concurrent use by multiple goroutines.
type Stats struct {
    mu    sync.Mutex
    count int
    sum   int
}

func (s *Stats) Add(x int) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.count++
    s.sum += x
}

func (s *Stats) Mean() float64 {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.count == 0 {
        return 0
    }
    return float64(s.sum) / float64(s.count)
}
```

### After (atomic version, if `Mean` is rarely called)

```go
// Stats is safe for concurrent use by multiple goroutines.
type Stats struct {
    count atomic.Int64
    sum   atomic.Int64
}

func (s *Stats) Add(x int) {
    s.count.Add(1)
    s.sum.Add(int64(x))
}

func (s *Stats) Mean() float64 {
    // Note: count and sum are read independently; Mean is not atomic
    // across both fields. If consistency is required, use the mutex version.
    c := s.count.Load()
    if c == 0 {
        return 0
    }
    return float64(s.sum.Load()) / float64(c)
}
```

### Rules applied

- 7: appropriate primitive for the workload.
- 9: race-free, verified with `-race`.
- 11: documented safety.

### Observable benefits

- Calling `Stats` concurrently from 1 000 goroutines no longer races.
- Tail latency under contention is bounded by lock fairness.

---

## Optimization 6: Test using `time.Sleep`

### Before

```go
func TestPipeline(t *testing.T) {
    in := make(chan int)
    out := pipeline(in)
    in <- 1
    in <- 2
    in <- 3
    close(in)
    time.Sleep(200 * time.Millisecond)
    if len(collect(out)) != 3 {
        t.Fail()
    }
}
```

### Violations

- `time.Sleep` for synchronisation (Rule 8).
- `collect` may run before pipeline drains.
- Flaky on slow CI.

### After

```go
func TestPipeline(t *testing.T) {
    defer goleak.VerifyNone(t)
    in := make(chan int)
    out := pipeline(in)
    go func() {
        defer close(in)
        in <- 1
        in <- 2
        in <- 3
    }()
    var got []int
    for v := range out {
        got = append(got, v)
    }
    if len(got) != 3 {
        t.Fatalf("got %d, want 3", len(got))
    }
}
```

### Rules applied

- 8: no `time.Sleep`. The `for v := range out` waits until `out` is closed, which `pipeline` must do when its input drains.
- 9: implicit; the test now has a determined synchronisation point.
- 12: `goleak.VerifyNone` catches any leftover goroutines.

### Observable benefits

- Test is deterministic.
- Test fails immediately if `pipeline` doesn't close `out` correctly.
- Test fails if `pipeline` leaks a goroutine.

---

## Optimization 7: Service main with multiple components

### Before

```go
func main() {
    go runHTTPServer()
    go runKafkaConsumer()
    go runMetricsFlusher()
    select {}                              // block forever
}
```

### Violations

- No SIGTERM handling.
- No exit story for the main goroutine (or the children).
- No coordination if one component fails.

### After

```go
func main() {
    if err := run(); err != nil {
        log.Fatal(err)
    }
}

func run() error {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
    go func() {
        <-sigCh
        log.Println("shutdown signal received")
        cancel()
    }()

    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return runHTTPServer(ctx) })
    g.Go(func() error { return runKafkaConsumer(ctx) })
    g.Go(func() error { return runMetricsFlusher(ctx) })

    err := g.Wait()
    if err != nil && err != context.Canceled {
        return err
    }
    return nil
}
```

### Rules applied

- 1: each component returns when `ctx` cancels.
- 4: single root `ctx`.
- 6: `errgroup` coordinates everything.

### Observable benefits

- SIGTERM triggers orderly shutdown.
- One component crashing brings the others down for restart.
- Exit code reflects success or failure.

---

## Optimization 8: Logging panics with structured information

### Before

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Println("recover:", r)
        }
    }()
    work()
}()
```

### Violations

- Not structured; hard to search.
- No stack trace.
- No metric (Rule 12-adjacent: leak/panic visibility).

### After

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            slog.Error("goroutine panic",
                slog.String("name", "worker"),
                slog.Any("panic", r),
                slog.String("stack", string(debug.Stack())),
            )
            metrics.GoroutinePanics.WithLabelValues("worker").Inc()
        }
    }()
    work()
}()
```

### Rules applied

- 5: recover with full observability.

### Observable benefits

- Stack trace tells you where the panic happened.
- Metric on the dashboard tells you panics are happening *now*.
- Structured fields are searchable in log aggregators.

---

## Summary

Every "Before" snippet in this file represents code that works in development and breaks in production. The "After" snippets apply the twelve rules consistently. The pattern of the rewrite is always the same:

1. Add `ctx context.Context` as the first parameter.
2. Add `defer recover` at every goroutine boundary.
3. Bound spawning (errgroup.SetLimit or semaphore).
4. Replace `time.Sleep` with event-based synchronisation.
5. Document concurrency safety on every exported type.
6. Make every goroutine's exit story one comment line.
7. Run `-race` and `goleak` to verify.

Internalise the pattern. When you see a "Before"-shape in your codebase, you should be able to type out the "After" without thinking.
