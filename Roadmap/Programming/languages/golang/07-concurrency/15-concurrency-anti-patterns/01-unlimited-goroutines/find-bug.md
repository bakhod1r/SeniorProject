---
layout: default
title: Find Bug
parent: Unlimited Goroutines
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 8
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/01-unlimited-goroutines/find-bug/
---

# Unlimited Goroutines — Find the Bug

> Each snippet contains a bug related to unlimited goroutines or its consequences (OOM, scheduler thrash, FD exhaustion, leak, deadlock from saturation). Read the code, identify the bug, explain the root cause, propose a fix, and describe how to verify.

---

## Bug 1 — The classic fan-out

```go
func ProcessFiles(paths []string) {
    for _, p := range paths {
        go func(p string) {
            data, _ := os.ReadFile(p)
            _ = process(data)
        }(p)
    }
}
```

**Find the bug.** What goes wrong when `len(paths)` is large?

**Root cause.** Unbounded fan-out. Each path spawns one goroutine, each opening a file (consuming an FD), reading the file into memory (consuming heap), and processing it. With 100 000 paths, you spawn 100 000 goroutines. FD limit (typically 65 535) is hit; subsequent `os.ReadFile` calls fail with `EMFILE`. Memory consumption is `100 000 × file_size`; OOM is likely.

Additionally, the function returns immediately; the caller has no way to know when processing is done or what errors occurred.

**Fix.**

```go
func ProcessFiles(ctx context.Context, paths []string) error {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(32) // sized to FD limit / fan-out factor
    for _, p := range paths {
        p := p
        g.Go(func() error {
            data, err := os.ReadFile(p)
            if err != nil { return err }
            return process(gctx, data)
        })
    }
    return g.Wait()
}
```

**Verification.**
- Unit test with 1000 paths; assert `runtime.NumGoroutine()` stays below 50 during execution.
- Integration test with a real file system; assert all files processed.
- Use `lsof -p <pid>` during a stress run; FD count should be bounded.

---

## Bug 2 — The fire-and-forget cleanup

```go
func handler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    if err := processSync(body); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    go cleanup(body)
    w.WriteHeader(http.StatusOK)
}
```

**Find the bug.** What happens under sustained load if `cleanup` is occasionally slow?

**Root cause.** Each request fires a `cleanup` goroutine. If `cleanup` takes 30 seconds occasionally and the request rate is 100/s, 3000 in-flight cleanup goroutines accumulate. Each holds `body` (potentially MBs of data). Memory grows; eventually OOM.

Worse: when the pod restarts (rolling deploy, OOM), in-flight cleanups are lost. Data loss.

**Fix.** Use a bounded background pool with drain-on-shutdown:

```go
var cleanupPool = pool.New(pool.Config{Workers: 16, QueueDepth: 1024})

func init() { cleanupPool.Start(context.Background()) }

func handler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    if err := processSync(body); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    job := cleanupJob{data: body}
    if !cleanupPool.TrySubmit(job) {
        // backpressure: do cleanup synchronously
        cleanup(body)
    }
    w.WriteHeader(http.StatusOK)
}

func gracefulShutdown(ctx context.Context) error {
    return cleanupPool.Stop(ctx)
}
```

**Verification.**
- Load test with 100 RPS for 10 minutes; goroutine count stable.
- Inject artificial slowness in `cleanup`; verify TrySubmit returns false and synchronous path takes over.
- Test graceful shutdown: pending cleanups drain.

---

## Bug 3 — The infinite consumer

```go
func StartProcessor(events <-chan Event) {
    go func() {
        for ev := range events {
            go process(ev) // unbounded inner spawn
        }
    }()
}
```

**Find the bug.**

**Root cause.** The outer goroutine reads events; the inner `go process(ev)` spawns one goroutine per event. If events arrive at 1000/s and process takes 1s, 1000 goroutines accumulate per second. Goroutine count grows linearly with consumer lag.

**Fix.** Use a bounded worker pool:

```go
func StartProcessor(ctx context.Context, events <-chan Event) {
    const workers = 32
    var wg sync.WaitGroup
    jobs := make(chan Event, workers*2)
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for ev := range jobs {
                process(ctx, ev)
            }
        }()
    }
    go func() {
        defer close(jobs)
        for ev := range events {
            select {
            case <-ctx.Done():
                return
            case jobs <- ev:
            }
        }
    }()
    go func() { wg.Wait() }()
}
```

The bound is `workers` concurrent processings. If events arrive faster, the `jobs <- ev` blocks, propagating backpressure to the events channel.

**Verification.**
- Stress test: 10 000 events/s for 1 minute; goroutine count stable around `workers + few`.
- Slow `process` artificially; verify backpressure propagates.

---

## Bug 4 — Recursive walk explosion

```go
func Walk(dir string) {
    entries, _ := os.ReadDir(dir)
    for _, e := range entries {
        if e.IsDir() {
            go Walk(filepath.Join(dir, e.Name()))
        } else {
            fmt.Println(e.Name())
        }
    }
}
```

**Find the bug.**

**Root cause.** Recursive unbounded fan-out. For a tree with branching factor B and depth D, the fan-out is up to `B^D`. For a typical filesystem (B=10, D=5), that's 100 000 goroutines. Each holds the path memory and opens the directory for reading (consuming FDs).

Also: there's no synchronisation; the caller has no way to know when Walk completes.

**Fix.** Use a shared semaphore plus a WaitGroup:

```go
type walker struct {
    sem *semaphore.Weighted
    wg  sync.WaitGroup
}

func (w *walker) walk(ctx context.Context, dir string) {
    w.wg.Add(1)
    go func() {
        defer w.wg.Done()
        if err := w.sem.Acquire(ctx, 1); err != nil { return }
        defer w.sem.Release(1)
        entries, err := os.ReadDir(dir)
        if err != nil { return }
        for _, e := range entries {
            full := filepath.Join(dir, e.Name())
            if e.IsDir() {
                w.walk(ctx, full)
            } else {
                fmt.Println(e.Name())
            }
        }
    }()
}

func Walk(ctx context.Context, dir string, concurrency int64) {
    w := &walker{sem: semaphore.NewWeighted(concurrency)}
    w.walk(ctx, dir)
    w.wg.Wait()
}
```

**Verification.**
- Walk a large directory; assert peak goroutine count <= concurrency + 5.
- Walk and Wait; verify Wait returns when complete.
- Use pprof during walk; confirm no leaked goroutines.

---

## Bug 5 — The ticker spawn

```go
func StartHealthCheck(endpoints []string) {
    ticker := time.NewTicker(30 * time.Second)
    go func() {
        for range ticker.C {
            for _, ep := range endpoints {
                go checkHealth(ep)
            }
        }
    }()
}
```

**Find the bug.** What happens if `checkHealth` takes > 30 seconds (e.g., on a slow endpoint)?

**Root cause.** Each tick fans out `len(endpoints)` goroutines. If a previous tick's goroutines have not finished, the new tick's goroutines stack on top. With 100 endpoints and 30s timeouts, after 5 minutes you have 10 × 100 = 1000 goroutines all checking the same endpoints simultaneously.

**Fix.** One worker pool drains health checks; ticker enqueues but bounded:

```go
func StartHealthCheck(ctx context.Context, endpoints []string) {
    ticker := time.NewTicker(30 * time.Second)
    go func() {
        defer ticker.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-ticker.C:
                g, gctx := errgroup.WithContext(ctx)
                g.SetLimit(8)
                checkCtx, cancel := context.WithTimeout(gctx, 25*time.Second)
                for _, ep := range endpoints {
                    ep := ep
                    g.Go(func() error { return checkHealth(checkCtx, ep) })
                }
                _ = g.Wait()
                cancel()
            }
        }
    }()
}
```

Each tick spawns at most 8 goroutines, each with a 25s timeout (less than the 30s tick interval). The bounded `g.Wait` ensures the previous batch completes before the next tick.

**Verification.**
- Artificially slow one endpoint; verify only one check is in flight for that endpoint at any time.
- Run for 10 minutes; goroutine count stays bounded.

---

## Bug 6 — Pagination boundary

```go
func SyncAll(ctx context.Context, client APIClient) error {
    pageToken := ""
    for {
        resp, err := client.List(ctx, pageToken)
        if err != nil { return err }
        for _, item := range resp.Items {
            go syncOne(ctx, item)
        }
        pageToken = resp.NextPageToken
        if pageToken == "" { return nil }
    }
}
```

**Find the bug.**

**Root cause.** Each page spawns `len(resp.Items)` goroutines. If pages are 100 items and there are 1000 pages, total fan-out is 100 000. The bound is the *total* across pages, not per-page.

Also: the function returns when pagination completes but the spawned goroutines may still be running. The caller has no way to wait.

**Fix.** Bounded across all pages, with proper synchronisation:

```go
func SyncAll(ctx context.Context, client APIClient) error {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(64)

    pageToken := ""
    for {
        resp, err := client.List(gctx, pageToken)
        if err != nil { return err }
        for _, item := range resp.Items {
            item := item
            g.Go(func() error { return syncOne(gctx, item) })
        }
        pageToken = resp.NextPageToken
        if pageToken == "" { break }
    }
    return g.Wait()
}
```

The errgroup is *outside* the pagination loop, so it spans all pages. `SetLimit(64)` caps the total in-flight.

**Verification.**
- Mock the client to return 1000 pages of 100 items each.
- Assert peak goroutine count <= 100.
- Assert all 100 000 items synced before SyncAll returns.

---

## Bug 7 — The deferred close after fan-out

```go
func DownloadAll(ctx context.Context, urls []string) (map[string][]byte, error) {
    results := make(map[string][]byte)
    var mu sync.Mutex
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(8)
    transport := &http.Transport{}
    defer transport.CloseIdleConnections()
    client := &http.Client{Transport: transport}
    for _, u := range urls {
        u := u
        g.Go(func() error {
            req, _ := http.NewRequestWithContext(gctx, "GET", u, nil)
            resp, err := client.Do(req)
            if err != nil { return err }
            defer resp.Body.Close()
            body, _ := io.ReadAll(resp.Body)
            mu.Lock()
            results[u] = body
            mu.Unlock()
            return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return results, nil
}
```

**Find the bug.** This looks bounded. What's wrong?

**Root cause.** Subtle: the `transport.CloseIdleConnections()` runs at function return. But the function returns *after* `g.Wait`. By then, all goroutines are done, and idle connections are correctly closed. So this is actually fine, *except* — what's the bound on connections to a single host?

The transport has no `MaxConnsPerHost`. If `urls` contains 100 URLs to the same host, the transport opens up to 8 connections to that host (matching the errgroup limit). That's fine.

But if `urls` contains URLs to many different hosts and the same hosts repeat, the transport's connection pool may grow without bound (default `MaxIdleConns: 100`, `MaxIdleConnsPerHost: 2`). For 50 unique hosts, 50 × 2 = 100 idle connections accumulate.

**The actual bug:** if `urls` is huge but unique hosts, you accumulate idle connections in the transport's pool until `MaxIdleConns` is hit, then connections start being closed/reopened with overhead.

**Fix.** Tune the transport explicitly:

```go
transport := &http.Transport{
    MaxConnsPerHost:     8,
    MaxIdleConns:        100,
    MaxIdleConnsPerHost: 2,
    IdleConnTimeout:     90 * time.Second,
}
```

This isn't a goroutine bug per se but a related concurrency-resource bug. Connection pools are part of the bound stack.

**Verification.**
- Run with 100 URLs to 50 unique hosts.
- Inspect connection metrics: `transport.IdleConnTotal`.
- Assert connection count stays bounded.

---

## Bug 8 — The unbounded retry storm

```go
func ProcessAll(ctx context.Context, items []Item) {
    for _, item := range items {
        item := item
        go func() {
            for {
                err := tryProcess(ctx, item)
                if err == nil { return }
                time.Sleep(time.Second)
            }
        }()
    }
}
```

**Find the bug.**

**Root cause.** Two issues:

1. Unbounded fan-out: one goroutine per item.
2. Unbounded retries: each goroutine retries forever on failure. If the downstream is down, all N goroutines spin in retry loops indefinitely, holding goroutines and resources.

If downstream is unavailable for 1 hour, you have 50 000 goroutines (assuming 50 000 items), each doing one call per second = 50 000 RPS against the failing downstream, which is the worst possible response to its failure.

**Fix.** Bound fan-out + bounded retries + circuit breaker:

```go
breaker := gobreaker.NewCircuitBreaker(gobreaker.Settings{
    Name: "downstream",
    ReadyToTrip: func(c gobreaker.Counts) bool {
        return c.TotalFailures > 10 && float64(c.TotalFailures)/float64(c.Requests) > 0.5
    },
})

func ProcessAll(ctx context.Context, items []Item) error {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(16)
    for _, item := range items {
        item := item
        g.Go(func() error {
            for attempt := 0; attempt < 3; attempt++ {
                _, err := breaker.Execute(func() (any, error) {
                    return nil, tryProcess(gctx, item)
                })
                if err == nil { return nil }
                if errors.Is(err, gobreaker.ErrOpenState) { return err }
                d := time.Duration(1<<attempt) * 500 * time.Millisecond
                select {
                case <-gctx.Done(): return gctx.Err()
                case <-time.After(d):
                }
            }
            return errors.New("max attempts exceeded")
        })
    }
    return g.Wait()
}
```

**Verification.**
- Inject downstream failure; verify breaker opens; verify retries stop after 3 attempts.
- Goroutine count stable during downstream outage.

---

## Bug 9 — Library callback fan-out

```go
package mylib

type Watcher struct {
    onChange func(key string)
}

func (w *Watcher) Start(ctx context.Context) {
    go func() {
        for {
            select {
            case <-ctx.Done():
                return
            case k := <-w.eventCh:
                go w.onChange(k) // spawn per event
            }
        }
    }()
}
```

**Find the bug.** This is library code; what is the contract violation?

**Root cause.** The library spawns one goroutine per event delivered to `onChange`. Callers don't see the spawn. If `onChange` is slow or events are frequent, goroutines accumulate in the caller's process. The caller has no way to limit this; the library decided for them.

This is a hidden fan-out. The user reads the API "calls onChange on each event" and assumes it's serial; it isn't.

**Fix.** The library should either:
1. Document that `onChange` is called concurrently and let the caller bound it.
2. Provide a bounded pool internally with a configurable limit.

```go
type WatcherConfig struct {
    OnChange     func(key string)
    MaxConcurrent int // 0 = serial; -1 = unlimited
}

type Watcher struct {
    cfg WatcherConfig
    sem *semaphore.Weighted
}

func NewWatcher(cfg WatcherConfig) *Watcher {
    w := &Watcher{cfg: cfg}
    if cfg.MaxConcurrent > 0 {
        w.sem = semaphore.NewWeighted(int64(cfg.MaxConcurrent))
    }
    return w
}

func (w *Watcher) callOnChange(ctx context.Context, key string) {
    if w.sem == nil {
        w.cfg.OnChange(key)
        return
    }
    if err := w.sem.Acquire(ctx, 1); err != nil { return }
    defer w.sem.Release(1)
    w.cfg.OnChange(key)
}
```

**Verification.**
- Test with `MaxConcurrent: 0` (serial); verify no concurrent calls.
- Test with `MaxConcurrent: 8`; verify max 8 concurrent.
- Document the behaviour.

---

## Bug 10 — Caller of an unbounded library

```go
import "github.com/example/uploader"

func uploadAll(items []Item) {
    uploader.UploadEach(items, func(item Item) error {
        return processItem(item) // called concurrently by the library
    })
}
```

**Find the bug.** Assume `uploader.UploadEach` calls the callback for each item concurrently (without bound).

**Root cause.** Even if `uploadAll` looks innocent, the library's hidden concurrency means our `processItem` is called from N concurrent goroutines, where N = `len(items)`. If `processItem` opens a database connection, we exhaust the pool. If it allocates memory, we OOM.

**Fix.** Add a semaphore *around* the callback:

```go
func uploadAll(ctx context.Context, items []Item) {
    sem := semaphore.NewWeighted(16)
    uploader.UploadEach(items, func(item Item) error {
        if err := sem.Acquire(ctx, 1); err != nil { return err }
        defer sem.Release(1)
        return processItem(ctx, item)
    })
}
```

The library's unbounded callbacks are now bounded by the semaphore. Each callback waits for a slot.

Alternative: replace the library with one that bounds internally.

**Verification.**
- Load test with `len(items) = 10 000`.
- Assert process pool stable.
- Audit other libraries used by the project for similar issues.

---

## Bug 11 — Connection pool starvation by goroutine flood

```go
type Service struct {
    db *sql.DB
}

func (s *Service) Query(ctx context.Context, keys []string) ([]Row, error) {
    rows := make([]Row, len(keys))
    var wg sync.WaitGroup
    for i, k := range keys {
        wg.Add(1)
        go func(i int, k string) {
            defer wg.Done()
            row, _ := s.db.QueryRowContext(ctx, "SELECT ... WHERE k = ?", k).Scan(&rows[i])
            _ = row
        }(i, k)
    }
    wg.Wait()
    return rows, nil
}
```

**Find the bug.**

**Root cause.** Unbounded fan-out. For 1000 keys, 1000 goroutines compete for the `s.db` connection pool (default 0 = unlimited, but practically bounded by what PostgreSQL allows, often 100).

When the pool is full, additional `QueryRow` calls block on `db.Conn`. With 1000 goroutines and 100 connections, 900 are blocked. They each hold a goroutine + the query parameters. If the context has no deadline, they wait indefinitely.

Also: errors from `QueryRowContext` are silently discarded.

**Fix.** Bounded fan-out matching the DB pool:

```go
func (s *Service) Query(ctx context.Context, keys []string) ([]Row, error) {
    rows := make([]Row, len(keys))
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(80) // matches s.db pool of 100, leaving headroom
    for i, k := range keys {
        i, k := i, k
        g.Go(func() error {
            return s.db.QueryRowContext(gctx, "SELECT ... WHERE k = ?", k).Scan(&rows[i])
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return rows, nil
}
```

Also set `s.db.SetMaxOpenConns(100)` explicitly.

**Verification.**
- Stress test with 10 000 keys; assert no `db.Stats().WaitCount` growth.
- Assert all rows populated.
- Assert errors returned.

---

## Bug 12 — Defer-go for shutdown

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    server := startHTTPServer()
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGTERM)
    <-sigs
    go server.Shutdown(ctx)
}
```

**Find the bug.**

**Root cause.** `main` does `go server.Shutdown(ctx)` and then returns. When `main` returns, the program exits *immediately*, killing the Shutdown goroutine. The server's shutdown does not actually complete: in-flight requests are abruptly terminated, connections are not drained.

The `defer cancel()` does nothing useful here (cancel is called as the process exits anyway).

**Fix.** Wait for shutdown to complete:

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    server := startHTTPServer()
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGTERM)
    <-sigs
    shutdownCtx, cancelShutdown := context.WithTimeout(ctx, 30*time.Second)
    defer cancelShutdown()
    if err := server.Shutdown(shutdownCtx); err != nil {
        log.Printf("shutdown error: %v", err)
    }
}
```

No `go`. `Shutdown` blocks `main` until complete or timeout.

**Verification.**
- Send SIGTERM during a long request; verify the request completes before the process exits.
- Verify the process exits within the 30s budget even if Shutdown hangs.

---

## Summary

These 12 bugs cover the most common manifestations of the unlimited-goroutines anti-pattern in real Go code:

1. **Bug 1, 4, 6:** Direct unbounded fan-out (loop over data + `go`).
2. **Bug 2, 12:** Fire-and-forget without bound.
3. **Bug 3, 5:** Indirect fan-out (consumer pattern, ticker).
4. **Bug 7, 11:** Resource exhaustion downstream (connections).
5. **Bug 8:** Retry amplification.
6. **Bug 9, 10:** Library-driven fan-out (hidden).

Each bug has the same shape: an action is repeated as many times as input/event count, with no bound. The fix in each case is to add a bound (semaphore, errgroup limit, pool) and to ensure proper synchronisation (Wait or join).

The patterns repeat. Once you see them, you cannot un-see them.

End of Find-Bug file.
