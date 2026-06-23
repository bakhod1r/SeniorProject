---
layout: default
title: Tasks
parent: Graceful Shutdown
grand_parent: Production Patterns
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/04-graceful-shutdown/tasks/
---

# Graceful Shutdown — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are sketched at the end.

---

## Easy

### Task 1 — Make Ctrl+C exit cleanly

Write a minimal HTTP server on `:8080` that responds "hello" after 2 seconds. Make Ctrl+C trigger graceful shutdown: in-flight requests must complete before the process exits.

- Use `signal.NotifyContext` and `http.Server.Shutdown`.
- Run the server. Start a slow request with `curl http://localhost:8080/`. Press Ctrl+C while it's running.
- Expected: the curl receives "hello"; the server then exits cleanly.

**Goal.** Learn the minimum graceful shutdown pattern.

---

### Task 2 — Add a deadline

Modify Task 1 to bound `Shutdown` with a 5-second deadline. If a handler takes longer than 5 seconds, the deadline should fire and `Close` should be called as fallback.

- Use `context.WithTimeout(context.Background(), 5*time.Second)`.
- Test: make the handler sleep 10 seconds; press Ctrl+C; verify `Close` runs.

**Goal.** Understand deadline-bounded shutdown.

---

### Task 3 — `errors.Is(err, http.ErrServerClosed)`

Add proper error handling for `ListenAndServe`'s return. The error after `Shutdown` is `http.ErrServerClosed`; this is success, not failure.

- Without `errors.Is`, every shutdown logs an "error."
- With it, shutdown is silent (or "exited cleanly" if you choose to log).

**Goal.** Learn the idiom for `ListenAndServe`'s error.

---

### Task 4 — Background ticker

Add a goroutine that prints "tick" every 5 seconds. On shutdown, the ticker must stop.

- Use `time.NewTicker` in a `select` with `<-ctx.Done()`.
- Verify with `runtime.NumGoroutine()` that the count returns to baseline after shutdown.

**Goal.** Make background goroutines shutdown-aware.

---

### Task 5 — Readiness probe

Add `/healthz` (always 200) and `/readyz` (200 normally, 503 during shutdown). Use an atomic boolean to track readiness.

- Flip readiness to false at the start of shutdown.
- Sleep 3 seconds before calling `Shutdown` to simulate LB drain.

**Goal.** Implement the readiness pattern.

---

## Medium

### Task 6 — Multiple subsystems with `errgroup`

Build a service with two HTTP servers (API on :8080, metrics on :9090) and a background worker. Use `errgroup` to coordinate. Each shuts down when the signal arrives.

- Drain in parallel: API and metrics simultaneously.
- Wait for the worker to finish its current job (use a channel + `WaitGroup`).

**Goal.** Coordinate multiple subsystems.

---

### Task 7 — Dependency order

Build a service with a Postgres connection (use a stub if no DB is available). Open the DB before the server starts; close it AFTER the server has drained.

- Verify: during shutdown, log "draining server"; after drain, log "closing DB"; after close, log "exited."
- Bug to avoid: closing the DB before the server, causing handlers to see "use of closed pool" errors.

**Goal.** Learn reverse-startup-order shutdown.

---

### Task 8 — Phase machine

Implement a small `Lifecycle` struct that holds a stack of `Close` functions. On shutdown, it pops them in LIFO order, with a per-phase deadline.

- API: `lc.Add(func(context.Context) error)`, `lc.Shutdown(ctx context.Context) error`.
- Test with three phases. Verify they run in LIFO order.

**Goal.** Build the basic phase-machine pattern.

---

### Task 9 — Per-handler timeout

Add middleware that caps each handler at 10 seconds. If a request exceeds, the handler's context is cancelled.

- Implement as `func(http.Handler) http.Handler`.
- Verify: a handler sleeping 15 seconds returns to the client after 10 seconds with whatever it has so far (or 504 if you choose to emit one).

**Goal.** Bound the shutdown's tail latency.

---

### Task 10 — Integration test

Write a Go test that:

1. Starts your server in a subprocess.
2. Issues a 2-second slow request.
3. Sends SIGTERM 200ms into the request.
4. Asserts: the slow request completes successfully, and the process exits within 5 seconds.

- Use `os/exec` and `process.Signal(syscall.SIGTERM)`.
- Use a select with `time.After(5*time.Second)` to bound the wait.

**Goal.** Test the shutdown path.

---

## Hard

### Task 11 — WebSocket registry

Add a WebSocket endpoint to your server. Maintain a registry of active WebSockets. On shutdown:

1. Send a close frame (status 1001 "going away") to all WebSockets.
2. Wait up to 5 seconds for client-initiated close.
3. Force-close stragglers.

- Use `gorilla/websocket` or `nhooyr.io/websocket`.
- Register the drain via `http.Server.RegisterOnShutdown`.

**Goal.** Handle hijacked connections.

---

### Task 12 — Distributed lock release

Acquire a Redis-based distributed lock at startup. Release it during shutdown (as a phase in your lifecycle stack).

- Use `redis/go-redis` and a simple SET NX EX pattern.
- Verify: after shutdown, the lock is no longer in Redis.

**Goal.** Release external resources on shutdown.

---

### Task 13 — Kafka producer flush

Use `segmentio/kafka-go` (or `sarama`) to produce messages. Add a flush phase to your shutdown that ensures all pending messages are sent before the producer is closed.

- `producer.Close()` already flushes; but exposed as a phase, you can observe its duration.
- Test: produce 100 messages just before shutdown; verify all reach Kafka.

**Goal.** Flush async pipelines.

---

### Task 14 — `BaseContext` and handler cancellation

Set `http.Server.BaseContext` to return your root context. Add a slow handler that observes `r.Context()`. On shutdown, verify the handler exits promptly via context cancellation.

- Without `BaseContext`, `r.Context()` is not cancelled by shutdown.
- With it, the handler aborts as soon as the signal arrives.

**Goal.** Speed up drain via handler-level cancellation.

---

### Task 15 — Per-phase metrics

Instrument the phase machine to emit Prometheus metrics: `shutdown_phase_duration_seconds{phase}`, `shutdown_phase_started_total{phase}`, `shutdown_phase_failed_total{phase}`.

- Use `prometheus/client_golang`.
- After shutdown, verify the metrics are observable on `/metrics`.

**Goal.** Add production observability.

---

### Task 16 — Chaos test for slow downstream

Write a test that:

1. Starts a mock "slow downstream" HTTP server with a 20-second response delay.
2. Starts your service pointing at the mock as a backend.
3. Issues a request that triggers the downstream call.
4. Sends SIGTERM 100ms in.
5. Asserts: the service force-closes within the configured deadline (e.g., 10 seconds).

- This tests the fallback `Close` path.
- Verify the `force_close_total` metric increments.

**Goal.** Test the fallback path explicitly.

---

### Task 17 — `preStop` HTTP hook

Implement an `/admin/prestop` endpoint that:

1. Flips readiness to false.
2. Logs the preStop event.
3. Waits 5 seconds.
4. Returns 200.

Configure K8s `lifecycle.preStop.httpGet.path` to this endpoint.

- Test locally with a curl simulating the hook.
- Verify the readiness is flipped and the sleep happens.

**Goal.** Wire application-managed preStop.

---

### Task 18 — Goroutine leak detection

Add `go.uber.org/goleak` to your test suite. Verify that no goroutines leak after each test.

- Common leaks: tickers without `Stop()`, signal channels without `signal.Stop`, background workers without `ctx`-watching.
- Fix all leaks until goleak passes.

**Goal.** Prove the absence of goroutine leaks.

---

### Task 19 — Tracing per phase

Instrument each shutdown phase with an OpenTelemetry span. After shutdown, the trace should be exported (assume an in-memory exporter for testing).

- Verify: the trace has one root span ("shutdown") and one child span per phase.
- Span attributes: phase name, duration, error (if any).

**Goal.** Add distributed-tracing-grade observability.

---

### Task 20 — Resilience under signal storm

Send SIGTERM 100 times in rapid succession to your service. Verify:

1. Only one shutdown sequence runs.
2. The process still exits cleanly.
3. No panics or weird logging.

- Implementation hint: shutdown should be triggered once. Subsequent signals are no-ops.

**Goal.** Make shutdown idempotent.

---

## Solutions

Solutions are sketches; adapt to your codebase.

### Solution 1

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "log"
    "net/http"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
        time.Sleep(2 * time.Second)
        fmt.Fprintln(w, "hello")
    })

    srv := &http.Server{Addr: ":8080", Handler: mux}

    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    go func() {
        if err := srv.ListenAndServe(); err != nil &&
            !errors.Is(err, http.ErrServerClosed) {
            log.Fatalf("server: %v", err)
        }
    }()

    <-ctx.Done()
    log.Println("shutting down")

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Printf("shutdown error: %v", err)
        _ = srv.Close()
    }
    log.Println("exited")
}
```

### Solution 4 — Background ticker

```go
func runTicker(ctx context.Context) {
    t := time.NewTicker(5 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            log.Println("ticker exiting")
            return
        case <-t.C:
            log.Println("tick")
        }
    }
}
```

### Solution 5 — Readiness probe

```go
var ready atomic.Bool

func init() {
    ready.Store(true)
}

mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
    w.WriteHeader(http.StatusOK)
})
mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
    if !ready.Load() {
        http.Error(w, "draining", http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
})

// on shutdown:
ready.Store(false)
time.Sleep(3 * time.Second)
_ = srv.Shutdown(shutdownCtx)
```

### Solution 6 — `errgroup` for multiple subsystems

```go
g, gctx := errgroup.WithContext(rootCtx)

g.Go(func() error {
    if err := apiSrv.ListenAndServe(); err != nil &&
        !errors.Is(err, http.ErrServerClosed) {
        return err
    }
    return nil
})
g.Go(func() error {
    if err := metricsSrv.ListenAndServe(); err != nil &&
        !errors.Is(err, http.ErrServerClosed) {
        return err
    }
    return nil
})
g.Go(func() error {
    <-gctx.Done()
    ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
    defer cancel()
    eg, ectx := errgroup.WithContext(ctx)
    eg.Go(func() error { return apiSrv.Shutdown(ectx) })
    eg.Go(func() error { return metricsSrv.Shutdown(ectx) })
    return eg.Wait()
})
return g.Wait()
```

### Solution 8 — Phase machine (skeleton)

See [middle.md](./middle.md) "Recipe: a lifecycle manager struct" for a working implementation.

### Solution 10 — Integration test

```go
func TestGracefulShutdown(t *testing.T) {
    cmd := exec.Command("go", "run", "./cmd/server")
    require.NoError(t, cmd.Start())
    defer cmd.Process.Kill()

    time.Sleep(500 * time.Millisecond) // wait for bind

    reqDone := make(chan int, 1)
    go func() {
        resp, err := http.Get("http://localhost:8080/")
        if err == nil {
            reqDone <- resp.StatusCode
        } else {
            reqDone <- -1
        }
    }()

    time.Sleep(100 * time.Millisecond)
    require.NoError(t, cmd.Process.Signal(syscall.SIGTERM))

    select {
    case code := <-reqDone:
        require.Equal(t, 200, code)
    case <-time.After(5 * time.Second):
        t.Fatal("request did not complete")
    }

    done := make(chan error, 1)
    go func() { done <- cmd.Wait() }()
    select {
    case err := <-done:
        require.NoError(t, err)
    case <-time.After(5 * time.Second):
        t.Fatal("process did not exit")
    }
}
```

### Solution 11 — WebSocket registry

```go
type WSRegistry struct {
    mu    sync.Mutex
    conns map[*websocket.Conn]struct{}
}

func (r *WSRegistry) Add(c *websocket.Conn) {
    r.mu.Lock()
    r.conns[c] = struct{}{}
    r.mu.Unlock()
}

func (r *WSRegistry) Remove(c *websocket.Conn) {
    r.mu.Lock()
    delete(r.conns, c)
    r.mu.Unlock()
}

func (r *WSRegistry) DrainAll(ctx context.Context) {
    r.mu.Lock()
    conns := make([]*websocket.Conn, 0, len(r.conns))
    for c := range r.conns {
        conns = append(conns, c)
    }
    r.mu.Unlock()

    // Phase 1: send close frame
    for _, c := range conns {
        _ = c.WriteControl(websocket.CloseMessage,
            websocket.FormatCloseMessage(1001, "going away"),
            time.Now().Add(time.Second))
    }

    // Phase 2: wait briefly
    deadline := time.Now().Add(5 * time.Second)
    for time.Now().Before(deadline) {
        r.mu.Lock()
        n := len(r.conns)
        r.mu.Unlock()
        if n == 0 { return }
        select {
        case <-ctx.Done(): break
        case <-time.After(100 * time.Millisecond):
        }
    }

    // Phase 3: force-close
    r.mu.Lock()
    conns = conns[:0]
    for c := range r.conns {
        conns = append(conns, c)
    }
    r.mu.Unlock()
    for _, c := range conns {
        _ = c.Close()
    }
}
```

### Final notes

Each task builds on the previous. Work through them in order; by Task 20 you have a production-grade graceful shutdown system.

After all 20, you can claim deep practical fluency in graceful shutdown patterns.
