---
layout: default
title: Cleanup Ordering — Tasks
parent: Cleanup Ordering
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/03-cleanup-ordering/tasks/
---

# Cleanup Ordering — Hands-On Tasks

Practical exercises for mastering cleanup ordering in Go. Each task has a problem statement, hints, and a reference solution. Work through them in order.

---

## Task 1: Basic File Copy with Proper Close

**Problem.** Write a function `copyFile(src, dst string) error` that copies the contents of `src` to `dst`. Use `defer` for cleanup. Handle close errors properly: if the read or write succeeded but a close fails, return the close error. If multiple operations fail, return the first failure.

**Hint.** Use a named return value. The deferred close should only set the return if no other error has been reported.

**Reference solution.**

```go
package main

import (
    "io"
    "os"
)

func copyFile(src, dst string) (err error) {
    in, err := os.Open(src)
    if err != nil {
        return err
    }
    defer func() {
        if cerr := in.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    out, err := os.Create(dst)
    if err != nil {
        return err
    }
    defer func() {
        if cerr := out.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    _, err = io.Copy(out, in)
    return err
}
```

---

## Task 2: Worker with Cancel-Drain-Close

**Problem.** Write a `Worker` type that processes string messages from a channel. It should:
1. Have a `Submit(msg string)` method.
2. Have a `Stop(ctx context.Context) error` method that:
   - Stops accepting new messages.
   - Drains buffered messages.
   - Returns when all messages are processed or the context expires.
3. Be safe for concurrent use of Submit and Stop.

**Hint.** Use a context, a WaitGroup, and `sync.Once`. The processing goroutine should drain on cancel.

**Reference solution.**

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
)

type Worker struct {
    in     chan string
    ctx    context.Context
    cancel context.CancelFunc
    wg     sync.WaitGroup
    once   sync.Once
    err    error
}

func NewWorker(buf int) *Worker {
    ctx, cancel := context.WithCancel(context.Background())
    w := &Worker{
        in:     make(chan string, buf),
        ctx:    ctx,
        cancel: cancel,
    }
    w.wg.Add(1)
    go w.run()
    return w
}

func (w *Worker) run() {
    defer w.wg.Done()
    for {
        select {
        case <-w.ctx.Done():
            // drain
            for {
                select {
                case m := <-w.in:
                    process(m)
                default:
                    return
                }
            }
        case m := <-w.in:
            process(m)
        }
    }
}

func process(m string) {
    fmt.Println("processed:", m)
}

func (w *Worker) Submit(m string) error {
    select {
    case w.in <- m:
        return nil
    case <-w.ctx.Done():
        return errors.New("worker stopped")
    }
}

func (w *Worker) Stop(ctx context.Context) error {
    w.once.Do(func() {
        w.cancel()
        done := make(chan struct{})
        go func() { w.wg.Wait(); close(done) }()
        select {
        case <-done:
        case <-ctx.Done():
            w.err = ctx.Err()
        }
    })
    return w.err
}

func main() {
    w := NewWorker(10)
    for i := 0; i < 5; i++ {
        w.Submit(fmt.Sprintf("m%d", i))
    }
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    w.Stop(ctx)
}
```

---

## Task 3: AfterFunc with Synchronisation

**Problem.** Write a function `runWithDeadlineAndCleanup(ctx context.Context, run func() error, cleanup func()) error` that:
1. Runs `run()` in a goroutine.
2. If `ctx` is cancelled before `run` completes, calls `cleanup()`.
3. Always waits for `cleanup` (if triggered) to finish before returning.
4. Returns `run`'s error or `ctx.Err()`.

**Hint.** Use `context.AfterFunc` and a `WaitGroup` for the cleanup.

**Reference solution.**

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "time"
)

func runWithDeadlineAndCleanup(ctx context.Context, run func() error, cleanup func()) error {
    var wg sync.WaitGroup
    wg.Add(1)
    stop := context.AfterFunc(ctx, func() {
        defer wg.Done()
        cleanup()
    })
    defer func() {
        if stop() {
            wg.Done() // never ran
        }
        wg.Wait()
    }()
    return run()
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()
    err := runWithDeadlineAndCleanup(ctx,
        func() error {
            time.Sleep(100 * time.Millisecond)
            return errors.New("done")
        },
        func() {
            fmt.Println("cleanup ran")
        },
    )
    fmt.Println(err)
}
```

Note: this exercise has a subtle bug. If `stop()` returns true, we manually decrement the WaitGroup — but we're decrementing it once even though `wg.Done` would have decremented it once. So the total is 1 increment and 1 decrement. Correct.

If `stop()` returns false, the AfterFunc was already running. We `wg.Wait()` for it. Correct.

---

## Task 4: LifecycleManager

**Problem.** Implement a `LifecycleManager` with these methods:
- `Add(c Component)` to register components.
- `Start(ctx) error` to start each in registration order; unwind on failure.
- `Stop(ctx) error` to stop each in reverse order; join errors.

`Component` is an interface with `Name() string`, `Start(ctx) error`, and `Stop(ctx) error`.

**Hint.** Use `errors.Join` for multi-component failures.

**Reference solution.**

```go
package main

import (
    "context"
    "errors"
    "fmt"
)

type Component interface {
    Name() string
    Start(ctx context.Context) error
    Stop(ctx context.Context) error
}

type Manager struct {
    items   []Component
    started []Component
}

func (m *Manager) Add(c Component) { m.items = append(m.items, c) }

func (m *Manager) Start(ctx context.Context) error {
    for _, c := range m.items {
        if err := c.Start(ctx); err != nil {
            // unwind
            for i := len(m.started) - 1; i >= 0; i-- {
                _ = m.started[i].Stop(context.Background())
            }
            m.started = nil
            return fmt.Errorf("start %s: %w", c.Name(), err)
        }
        m.started = append(m.started, c)
    }
    return nil
}

func (m *Manager) Stop(ctx context.Context) error {
    var errs []error
    for i := len(m.started) - 1; i >= 0; i-- {
        if err := m.started[i].Stop(ctx); err != nil {
            errs = append(errs, fmt.Errorf("stop %s: %w", m.started[i].Name(), err))
        }
    }
    m.started = nil
    return errors.Join(errs...)
}
```

---

## Task 5: Graceful HTTP Shutdown

**Problem.** Write a `main` function that:
1. Starts an HTTP server on `:0`.
2. Handles SIGINT/SIGTERM to trigger graceful shutdown.
3. Shutdown should drain in-flight requests with a 10-second deadline.
4. Logs each shutdown step.

**Reference solution.**

```go
package main

import (
    "context"
    "log/slog"
    "net/http"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    mux := http.NewServeMux()
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        time.Sleep(100 * time.Millisecond)
        w.Write([]byte("ok\n"))
    })

    srv := &http.Server{Addr: ":0", Handler: mux}
    go func() {
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            slog.Error("listen", "err", err)
        }
    }()

    slog.Info("server started")
    <-ctx.Done()
    slog.Info("shutdown signal received")

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        slog.Error("shutdown", "err", err)
    } else {
        slog.Info("clean shutdown")
    }
}
```

---

## Task 6: Idempotent Close

**Problem.** Write a `SafeCloser` type that wraps an `io.Closer` and makes `Close` idempotent. Multiple calls to Close should return the same error (from the first call).

**Hint.** `sync.Once`.

**Reference solution.**

```go
package main

import (
    "fmt"
    "io"
    "sync"
)

type SafeCloser struct {
    c    io.Closer
    once sync.Once
    err  error
}

func NewSafeCloser(c io.Closer) *SafeCloser {
    return &SafeCloser{c: c}
}

func (s *SafeCloser) Close() error {
    s.once.Do(func() { s.err = s.c.Close() })
    return s.err
}

type fakeCloser struct{ n int }

func (f *fakeCloser) Close() error {
    f.n++
    return fmt.Errorf("close #%d", f.n)
}

func main() {
    c := NewSafeCloser(&fakeCloser{})
    fmt.Println(c.Close())
    fmt.Println(c.Close())
    fmt.Println(c.Close())
}
```

Output: same error three times. The underlying `fakeCloser.Close` runs once.

---

## Task 7: Error Propagation from Multiple Closers

**Problem.** Write `closeAll(closers ...io.Closer) error` that closes each closer and joins all non-nil errors.

**Reference solution.**

```go
package main

import (
    "errors"
    "io"
)

func closeAll(closers ...io.Closer) error {
    var errs []error
    for _, c := range closers {
        if err := c.Close(); err != nil {
            errs = append(errs, err)
        }
    }
    return errors.Join(errs...)
}
```

Usage:

```go
defer closeAll(file, conn, db)
```

Or `defer closeAll` in reverse order if you want LIFO via explicit ordering.

---

## Task 8: Time-Bounded Cleanup

**Problem.** Write a function `cleanupWithDeadline(ctx context.Context, fn func() error) error` that:
1. Runs `fn()` in a goroutine.
2. Returns when `fn` completes or `ctx` expires, whichever first.
3. If `ctx` expires, returns `ctx.Err()` immediately; the goroutine may continue running.

**Reference solution.**

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "time"
)

func cleanupWithDeadline(ctx context.Context, fn func() error) error {
    done := make(chan error, 1)
    go func() { done <- fn() }()
    select {
    case err := <-done:
        return err
    case <-ctx.Done():
        return ctx.Err()
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()
    err := cleanupWithDeadline(ctx, func() error {
        time.Sleep(100 * time.Millisecond)
        return nil
    })
    if errors.Is(err, context.DeadlineExceeded) {
        fmt.Println("cleanup did not finish in time")
    }
}
```

---

## Task 9: Drain a Channel on Cancel

**Problem.** Write a function `drainConsumer(ctx context.Context, in <-chan int, process func(int))` that consumes from `in` until cancelled, then drains remaining buffered values, then returns.

**Reference solution.**

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func drainConsumer(ctx context.Context, in <-chan int, process func(int)) {
    for {
        select {
        case <-ctx.Done():
            // drain
            for {
                select {
                case v, ok := <-in:
                    if !ok { return }
                    process(v)
                default:
                    return
                }
            }
        case v, ok := <-in:
            if !ok { return }
            process(v)
        }
    }
}

func main() {
    ch := make(chan int, 10)
    for i := 0; i < 5; i++ { ch <- i }
    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()
    drainConsumer(ctx, ch, func(v int) { fmt.Println(v) })
}
```

---

## Task 10: A Component with Full Lifecycle

**Problem.** Implement a `MetricsExporter` component that:
1. Has Start(ctx) that begins a background goroutine emitting metrics every 10ms.
2. Has Stop(ctx) that:
   - Stops the goroutine.
   - Flushes any pending metrics (with a 5-second internal timeout).
   - Returns when complete or ctx expires.
3. Is idempotent.
4. Has a `Name() string` method returning `"metrics"`.

**Hint.** Use the same template as Worker (Task 2) with an explicit flush step.

**Reference solution.**

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type MetricsExporter struct {
    cancel context.CancelFunc
    done   chan struct{}
    once   sync.Once
    err    error
    queue  chan string
}

func NewMetricsExporter() *MetricsExporter {
    return &MetricsExporter{
        done:  make(chan struct{}),
        queue: make(chan string, 100),
    }
}

func (m *MetricsExporter) Name() string { return "metrics" }

func (m *MetricsExporter) Start(parent context.Context) error {
    ctx, cancel := context.WithCancel(parent)
    m.cancel = cancel
    go m.run(ctx)
    return nil
}

func (m *MetricsExporter) run(ctx context.Context) {
    defer close(m.done)
    t := time.NewTicker(10 * time.Millisecond)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            // flush
            for {
                select {
                case x := <-m.queue:
                    fmt.Println("emit:", x)
                default:
                    return
                }
            }
        case <-t.C:
            fmt.Println("tick")
        }
    }
}

func (m *MetricsExporter) Stop(ctx context.Context) error {
    m.once.Do(func() {
        m.cancel()
        select {
        case <-m.done:
        case <-ctx.Done():
            m.err = ctx.Err()
        }
    })
    return m.err
}

func main() {
    e := NewMetricsExporter()
    e.Start(context.Background())
    time.Sleep(30 * time.Millisecond)
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    e.Stop(ctx)
    e.Stop(ctx) // safe
}
```

---

## Task 11: Trace Probe Helper

**Problem.** Write `trace(name string) func()` that returns a closure for use as `defer trace("op")()`. It should:
1. Log "enter <name>" when called.
2. Log "exit <name> after <duration>" when the returned closure runs.

**Reference solution.**

```go
package main

import (
    "fmt"
    "time"
)

func trace(name string) func() {
    start := time.Now()
    fmt.Println("enter", name)
    return func() {
        fmt.Println("exit", name, "after", time.Since(start))
    }
}

func doWork() {
    defer trace("doWork")()
    time.Sleep(20 * time.Millisecond)
}

func main() {
    doWork()
}
```

---

## Task 12: Recover-and-Log Goroutine Launcher

**Problem.** Write `safeGo(name string, fn func())` that starts `fn` in a goroutine, recovering from panics and logging them with the goroutine's name.

**Reference solution.**

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func safeGo(name string, fn func()) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                fmt.Printf("panic in %s: %v\n%s\n", name, r, debug.Stack())
            }
        }()
        fn()
    }()
}

func main() {
    safeGo("worker-1", func() {
        panic("boom")
    })
    safeGo("worker-2", func() {
        fmt.Println("worker 2 ok")
    })
    time.Sleep(100 * time.Millisecond)
}
```

---

## Task 13: Cleanup on Cause

**Problem.** Write a function `cancelWithCause(ctx, parent context.Context) error` that registers an AfterFunc on `ctx` to log the cause when `ctx` is cancelled. Return the cause when the function completes.

**Reference solution.**

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "time"
)

func cancelWithCause(ctx context.Context) error {
    stop := context.AfterFunc(ctx, func() {
        cause := context.Cause(ctx)
        fmt.Println("cancelled because:", cause)
    })
    defer stop()
    <-ctx.Done()
    return context.Cause(ctx)
}

func main() {
    ctx, cancel := context.WithCancelCause(context.Background())
    go func() {
        time.Sleep(20 * time.Millisecond)
        cancel(errors.New("user aborted"))
    }()
    err := cancelWithCause(ctx)
    fmt.Println("final:", err)
}
```

---

## Task 14: Compose Three Cleanups

**Problem.** Write a function that:
1. Acquires a mutex.
2. Opens a file.
3. Begins a transaction.

On any failure or successful return, releases in reverse order.

**Reference solution.**

```go
package main

import (
    "errors"
    "fmt"
    "os"
    "sync"
)

var mu sync.Mutex

type tx struct{ committed bool }
func (t *tx) Commit() error   { t.committed = true; return nil }
func (t *tx) Rollback() error { return nil }

func work(path string) (err error) {
    mu.Lock()
    defer mu.Unlock()

    f, err := os.Open(path)
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()

    t := &tx{}
    defer func() {
        if err != nil {
            if rerr := t.Rollback(); rerr != nil {
                err = errors.Join(err, rerr)
            }
        }
    }()

    fmt.Println("doing work")
    return t.Commit()
}

func main() {
    fmt.Println(work("/etc/hostname"))
}
```

---

## Task 15: Two-Phase Shutdown

**Problem.** Build a service with two-phase shutdown:
- Phase 1 (Drain): each component stops accepting new work.
- Phase 2 (Close): each component releases resources.

The phases run sequentially across all components.

**Reference solution.**

```go
package main

import (
    "context"
    "errors"
    "fmt"
)

type Component interface {
    Name() string
    Drain(ctx context.Context) error
    Close(ctx context.Context) error
}

type Service struct {
    components []Component
}

func (s *Service) Shutdown(ctx context.Context) error {
    var errs []error
    for _, c := range s.components {
        if err := c.Drain(ctx); err != nil {
            errs = append(errs, fmt.Errorf("drain %s: %w", c.Name(), err))
        }
    }
    for _, c := range s.components {
        if err := c.Close(ctx); err != nil {
            errs = append(errs, fmt.Errorf("close %s: %w", c.Name(), err))
        }
    }
    return errors.Join(errs...)
}
```

---

## Task 16: AfterFunc with WaitGroup

**Problem.** Write a wrapper around `context.AfterFunc` that adds a `Wait` method to block until the callback finishes (or never runs if deregistered).

**Reference solution.**

```go
package main

import (
    "context"
    "fmt"
    "sync"
)

type WaitableAfterFunc struct {
    stop func() bool
    done chan struct{}
    once sync.Once
}

func NewWaitableAfterFunc(ctx context.Context, fn func()) *WaitableAfterFunc {
    w := &WaitableAfterFunc{done: make(chan struct{})}
    w.stop = context.AfterFunc(ctx, func() {
        defer w.once.Do(func() { close(w.done) })
        fn()
    })
    return w
}

func (w *WaitableAfterFunc) Stop() bool {
    if w.stop() {
        w.once.Do(func() { close(w.done) })
        return true
    }
    return false
}

func (w *WaitableAfterFunc) Wait() { <-w.done }

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    waf := NewWaitableAfterFunc(ctx, func() { fmt.Println("callback") })
    cancel()
    waf.Wait()
    fmt.Println("done")
}
```

---

## Task 17: errgroup with Cleanup

**Problem.** Use `errgroup.WithContext` to spawn three workers, each of which opens a file and processes it. Each worker's file must close cleanly. The first error cancels all workers.

**Reference solution.**

```go
package main

import (
    "context"
    "fmt"
    "os"

    "golang.org/x/sync/errgroup"
)

func worker(ctx context.Context, path string) error {
    f, err := os.Open(path)
    if err != nil { return err }
    defer f.Close()
    // simulate work
    return nil
}

func main() {
    g, ctx := errgroup.WithContext(context.Background())
    paths := []string{"/etc/hostname", "/etc/hosts", "/etc/passwd"}
    for _, p := range paths {
        p := p
        g.Go(func() error { return worker(ctx, p) })
    }
    if err := g.Wait(); err != nil {
        fmt.Println(err)
    }
}
```

---

## Task 18: A Test for Cleanup

**Problem.** Write a test that asserts a `Service` does not leak goroutines after Start/Stop.

**Reference solution.**

```go
package myservice

import (
    "context"
    "runtime"
    "testing"
    "time"
)

func TestNoLeak(t *testing.T) {
    baseline := runtime.NumGoroutine()
    for i := 0; i < 100; i++ {
        s := New()
        if err := s.Start(context.Background()); err != nil {
            t.Fatal(err)
        }
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        if err := s.Stop(ctx); err != nil {
            t.Fatal(err)
        }
        cancel()
    }
    runtime.GC()
    runtime.GC()
    if n := runtime.NumGoroutine(); n > baseline+2 {
        t.Errorf("leaked goroutines: baseline=%d after=%d", baseline, n)
    }
}
```

---

## Task 19: Cleanup with `t.Cleanup`

**Problem.** Write a test helper `tempDB(t *testing.T) *DB` that creates a database connection and registers `t.Cleanup` to close it.

**Reference solution.**

```go
package db_test

import (
    "testing"
)

func tempDB(t *testing.T) *DB {
    db, err := connect()
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { db.Close() })
    return db
}

func TestUse(t *testing.T) {
    db := tempDB(t)
    // ... use db ...
    // db is closed automatically when test ends
}
```

---

## Task 20: Complete End-to-End Service

**Problem.** Write a `main` function that:
1. Creates a LifecycleManager.
2. Registers three components: HTTP server, worker pool, metrics exporter.
3. Starts all with a 30-second deadline.
4. Waits for SIGTERM.
5. Stops all in reverse order with a 30-second deadline.
6. Logs every phase.

**Hint.** Combine Tasks 4, 5, and 10. This is the integration test of your knowledge.

**Reference solution.** Left as an exercise. Combine the previous tasks. The structure is:

```go
func main() {
    ctx, stop := signal.NotifyContext(...)
    defer stop()
    var m Manager
    m.Add(NewHTTPServer())
    m.Add(NewWorkerPool())
    m.Add(NewMetricsExporter())
    startCtx, _ := context.WithTimeout(ctx, 30*time.Second)
    if err := m.Start(startCtx); err != nil { ... }
    <-ctx.Done()
    stopCtx, _ := context.WithTimeout(context.Background(), 30*time.Second)
    m.Stop(stopCtx)
}
```

---

## Bonus Tasks

### Bonus 1: Cleanup with Retry

Write a `cleanupWithRetry(ctx, fn func() error, attempts int)` that retries `fn` up to `attempts` times with exponential backoff, until success or context expires.

### Bonus 2: Cleanup with Circuit Breaker

Modify Bonus 1 to skip future calls if a circuit breaker has opened.

### Bonus 3: Test Multi-Phase Shutdown

Write a test that asserts components are stopped in correct order using a recording mechanism.

### Bonus 4: Profile Defer Cost

Write a benchmark comparing open-coded defer, heap defer, and explicit cleanup. Use `pprof` to verify.

### Bonus 5: Implement `safeStop`

Write a helper that wraps a Stop call with panic recovery, converting any panic into an error.

---

## How to Practice

1. Code each task by hand. Do not copy the reference solutions until you have tried.
2. Run each program and verify the output.
3. Modify tasks to add complications: more components, parallel shutdown, error injection.
4. Write tests for each task.
5. Time yourself: aim to complete Tasks 1-10 in an hour after practising.

Cleanup ordering is a skill built by repetition. The patterns become muscle memory.

---

End of tasks.
