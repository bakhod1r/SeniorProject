---
layout: default
title: net/http Server Concurrency — Professional
parent: net/http Server Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/01-net-http-server/professional/
---

# net/http Server Concurrency — Professional Level

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Production server template](#production-server-template)
3. [Tuning ReadTimeout, WriteTimeout, IdleTimeout](#tuning-readtimeout-writetimeout-idletimeout)
4. [Structured graceful shutdown](#structured-graceful-shutdown)
5. [pprof on a busy server](#pprof-on-a-busy-server)
6. [Finding handler-leaked goroutines](#finding-handler-leaked-goroutines)
7. [Goroutine quotas and back-pressure](#goroutine-quotas-and-back-pressure)
8. [Custom net.Listener wrappers](#custom-netlistener-wrappers)
9. [ConnState callback for connection metrics](#connstate-callback-for-connection-metrics)
10. [Custom ErrorLog](#custom-errorlog)
11. [Working with TLS handshake timeouts](#working-with-tls-handshake-timeouts)
12. [Memory and GC pressure under load](#memory-and-gc-pressure-under-load)
13. [Coding patterns](#coding-patterns)
14. [Common production mistakes](#common-production-mistakes)
15. [What you can build](#what-you-can-build)

---

## Introduction
> Focus: production-grade `*http.Server` configuration, profiling, and operational hygiene. Assumes everything from junior, middle, and senior.

At the professional level you can stand up an HTTP server that serves real traffic without surprises. You know which knobs to set, which middleware to layer, how to read `pprof` output, how to find a handler that leaks goroutines, and how to write a graceful shutdown that doesn't drop in-flight requests but also doesn't hang on a wedged handler. This file is a catalogue of the patterns and tools that production Go services use, with concrete code.

You should already understand:
- The goroutine-per-connection model and HTTP/1.1 keep-alive loop (junior).
- `(*conn).serve` and the active-connection map (middle).
- HTTP/2 framer / per-stream goroutines, flow control (senior).

This file is about putting all that to work under real load.

---

## Production server template

The default `http.ListenAndServe(":8080", handler)` is fine for prototypes and dangerous in production. Here is a starting template for a real server:

```go
package main

import (
    "context"
    "crypto/tls"
    "errors"
    "log/slog"
    "net"
    "net/http"
    _ "net/http/pprof"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
    
    mux := http.NewServeMux()
    mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    })
    mux.HandleFunc("/api/work", workHandler)
    
    handler := recoverer(logger)(accessLog(logger)(timeout(30*time.Second)(mux)))
    
    srv := &http.Server{
        Addr:              ":8080",
        Handler:           handler,
        ReadHeaderTimeout: 5 * time.Second,
        ReadTimeout:       30 * time.Second,
        WriteTimeout:      60 * time.Second,
        IdleTimeout:       120 * time.Second,
        MaxHeaderBytes:    1 << 16, // 64 KiB
        ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
        ConnContext: func(ctx context.Context, c net.Conn) context.Context {
            return context.WithValue(ctx, connKey{}, c.RemoteAddr().String())
        },
        ConnState: connMetrics.track,
        TLSConfig: &tls.Config{
            MinVersion:               tls.VersionTLS12,
            PreferServerCipherSuites: true,
        },
    }
    
    // pprof on internal port
    go func() {
        _ = http.ListenAndServe("127.0.0.1:6060", nil)
    }()
    
    errCh := make(chan error, 1)
    go func() {
        logger.Info("listening", "addr", srv.Addr)
        errCh <- srv.ListenAndServe()
    }()
    
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
    
    select {
    case sig := <-sigCh:
        logger.Info("shutdown signal", "sig", sig)
    case err := <-errCh:
        if !errors.Is(err, http.ErrServerClosed) {
            logger.Error("server error", "err", err)
            os.Exit(1)
        }
    }
    
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := srv.Shutdown(ctx); err != nil {
        logger.Error("graceful shutdown failed", "err", err)
        _ = srv.Close()
    }
    logger.Info("server stopped")
}
```

Notes on this template:
- **Timeouts are all set.** Defaults are `0` (no timeout), which is unsafe.
- **`ErrorLog`** is wired to your structured logger so server-side errors aren't dropped.
- **`pprof` on a separate port** (127.0.0.1:6060) — internal, not exposed.
- **Signal handling** with a fixed `30s` shutdown deadline. Failed graceful → forceful `Close`.
- **`ConnContext`** to inject per-connection metadata (here, the peer address; could be a TLS cert subject).
- **`ConnState`** to update connection metrics.

---

## Tuning ReadTimeout, WriteTimeout, IdleTimeout

These four fields cover four distinct phases of a connection's life. Misunderstanding them is the most common production bug.

| Field | Covers | Server.go reference |
|------|--------|---------------------|
| `ReadHeaderTimeout` | Time to read the request line + all headers | `server.go:1957` |
| `ReadTimeout` | Time to read the entire request including body | `server.go:1955` |
| `WriteTimeout` | Time to write the entire response (set before handler invocation) | `server.go:1959` |
| `IdleTimeout` | Time between requests on a keep-alive connection | `server.go:1962` |

### Recommended baselines

**For a JSON API with small requests:**
```go
ReadHeaderTimeout: 5*time.Second,
ReadTimeout:       30*time.Second,  // covers a 30s upload at minimum sane rate
WriteTimeout:      30*time.Second,  // covers slow client receivers
IdleTimeout:       120*time.Second, // keep keep-alives for 2 min
```

**For an upload service:**
```go
ReadHeaderTimeout: 5*time.Second,    // slowloris protection
ReadTimeout:       0,                // no overall read deadline
                                     // per-handler: r.Body = http.MaxBytesReader(w, r.Body, 1<<30)
                                     // and use ctx deadline inside the handler
WriteTimeout:      30*time.Second,
IdleTimeout:       60*time.Second,
```

**For a long-poll / SSE server:**
```go
ReadHeaderTimeout: 5*time.Second,
ReadTimeout:       0,                // streams indefinitely
WriteTimeout:      0,                // streams indefinitely (use Flusher and ctx)
IdleTimeout:       0,                // SSE never goes idle
                                     // protect against zombie connections in handler
```

**Slowloris exposure.** Any time `ReadHeaderTimeout` is `0`, you are vulnerable to slowloris. Always set it.

### Why per-request deadlines also matter

Server-level timeouts kill connections. They don't kill handlers running off-network. If your handler does a slow DB query, `WriteTimeout` will fire when the handler eventually returns and tries to write — but the handler itself ran for as long as the DB took.

The fix: use `r.Context()` and `context.WithTimeout` inside handlers:

```go
func workHandler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
    defer cancel()
    rows, err := db.QueryContext(ctx, "SELECT ...")
    if err != nil { ... }
    // ...
}
```

Now if the DB takes too long, the handler exits with `context.DeadlineExceeded` regardless of `WriteTimeout`.

---

## Structured graceful shutdown

`Server.Shutdown(ctx)` is the API; using it correctly requires care.

```go
type App struct {
    srv     *http.Server
    db      *sql.DB
    queue   *workqueue.Queue
    logger  *slog.Logger
    
    shutdownTimeout time.Duration
}

func (a *App) Run() error {
    errCh := make(chan error, 1)
    go func() { errCh <- a.srv.ListenAndServe() }()
    
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
    
    select {
    case <-sigCh:
        return a.Shutdown()
    case err := <-errCh:
        if !errors.Is(err, http.ErrServerClosed) {
            return fmt.Errorf("server crashed: %w", err)
        }
        return nil
    }
}

func (a *App) Shutdown() error {
    a.logger.Info("shutdown started")
    
    ctx, cancel := context.WithTimeout(context.Background(), a.shutdownTimeout)
    defer cancel()
    
    // 1. Stop accepting new HTTP requests.
    srvErr := a.srv.Shutdown(ctx)
    
    // 2. Stop background workers (independent of HTTP).
    a.queue.Stop(ctx)
    
    // 3. Close DB last, after handlers and workers are done.
    if err := a.db.Close(); err != nil {
        a.logger.Warn("db close", "err", err)
    }
    
    if srvErr != nil {
        a.logger.Warn("shutdown timed out, forcing close", "err", srvErr)
        _ = a.srv.Close()
        return srvErr
    }
    a.logger.Info("shutdown completed cleanly")
    return nil
}
```

Order matters:
1. **HTTP server first** so no new requests start.
2. **Background workers second** to drain queues.
3. **DB last** so in-flight queries can complete.

If you close DB first, in-flight handlers fail with "use of closed connection."

### Hijacked connections

`Server.Shutdown` does not wait for hijacked connections (e.g., WebSockets). You need a separate registry. See the WebSocket pattern below.

### Graceful shutdown with WebSockets

```go
type wsReg struct {
    mu    sync.Mutex
    conns map[net.Conn]func()
}

func (r *wsReg) add(c net.Conn, cancel func()) {
    r.mu.Lock()
    if r.conns == nil { r.conns = make(map[net.Conn]func()) }
    r.conns[c] = cancel
    r.mu.Unlock()
}

func (r *wsReg) remove(c net.Conn) {
    r.mu.Lock(); delete(r.conns, c); r.mu.Unlock()
}

func (r *wsReg) shutdown(ctx context.Context) error {
    r.mu.Lock()
    conns := make([]net.Conn, 0, len(r.conns))
    for c, cancel := range r.conns {
        cancel() // signal handler to exit
        conns = append(conns, c)
    }
    r.mu.Unlock()
    
    done := make(chan struct{})
    go func() {
        // wait for handlers to actually close their conns
        for {
            r.mu.Lock(); n := len(r.conns); r.mu.Unlock()
            if n == 0 { close(done); return }
            time.Sleep(50 * time.Millisecond)
        }
    }()
    
    select {
    case <-done: return nil
    case <-ctx.Done():
        for _, c := range conns { c.Close() }
        return ctx.Err()
    }
}
```

In `Shutdown`, call `wsReg.shutdown(ctx)` after `srv.Shutdown(ctx)`.

---

## pprof on a busy server

`net/http/pprof` exposes runtime profiling endpoints. **Never** expose it on a public port.

```go
import (
    _ "net/http/pprof"
    "net/http"
)

func startPprof() {
    go func() { http.ListenAndServe("127.0.0.1:6060", nil) }()
}
```

### Profile types

| Endpoint | What | When to use |
|---------|------|-------------|
| `/debug/pprof/profile?seconds=30` | CPU profile | Find hot functions |
| `/debug/pprof/heap` | Heap snapshot | Find memory hogs |
| `/debug/pprof/goroutine?debug=2` | Live goroutine dump (text) | Find leaked goroutines |
| `/debug/pprof/goroutine` | Goroutine sample (pprof binary) | Profile-tooling goroutine counts |
| `/debug/pprof/block` | Goroutines blocked on synchronisation | Find lock contention (need `runtime.SetBlockProfileRate`) |
| `/debug/pprof/mutex` | Mutex contention | (need `runtime.SetMutexProfileFraction`) |
| `/debug/pprof/trace?seconds=5` | Scheduling trace | Investigate scheduling, GC pauses |

### Workflow

```bash
# Capture goroutine dump while server is busy
curl -s http://127.0.0.1:6060/debug/pprof/goroutine?debug=2 > goroutines.txt
less goroutines.txt

# CPU profile under load
go tool pprof http://127.0.0.1:6060/debug/pprof/profile?seconds=30
(pprof) top
(pprof) list someHotFunction
(pprof) web

# Heap
go tool pprof http://127.0.0.1:6060/debug/pprof/heap
(pprof) top
(pprof) list someAllocSite
```

### Comparing two profiles

After a change, capture before/after profiles. `pprof -base` shows the diff:

```bash
go tool pprof -base before.pprof after.pprof
(pprof) top
```

Negative values in `flat` mean improvement.

---

## Finding handler-leaked goroutines

A leaked handler goroutine is one that survives after `ServeHTTP` should have returned. Common cause: blocking on a channel, mutex, or syscall without observing `r.Context().Done()`.

### Symptom

`runtime.NumGoroutine()` grows over time, even at idle. Eventually OOM.

### Diagnosis

1. Capture `/debug/pprof/goroutine?debug=2`.
2. Look for goroutines stuck in the same handler function across multiple snapshots taken minutes apart.
3. Their stack trace points at the blocking call.

Example dump:
```
goroutine 12345 [chan receive, 5 minutes]:
main.slowHandler(0x..., 0x...)
        /app/main.go:42 +0x80
net/http.HandlerFunc.ServeHTTP(...)
        /usr/local/go/src/net/http/server.go:2136
net/http.(*ServeMux).ServeHTTP(0x..., ...)
        /usr/local/go/src/net/http/server.go:2514 +0x...
net/http.serverHandler.ServeHTTP(...)
        /usr/local/go/src/net/http/server.go:2938 +0x...
net/http.(*conn).serve(0x..., 0x...)
        /usr/local/go/src/net/http/server.go:2009 +0x...
created by net/http.(*Server).Serve in goroutine 7
        /usr/local/go/src/net/http/server.go:3086 +0x...
```

"chan receive, 5 minutes" tells you this goroutine has been stuck for 5 minutes. Its call at `main.go:42` is the bug.

### Fix patterns

Always select with ctx:

```go
// BAD
result := <-ch

// GOOD
select {
case result = <-ch:
case <-r.Context().Done(): return
}
```

For network calls:
```go
// BAD
resp, _ := http.Get(url)

// GOOD
req, _ := http.NewRequestWithContext(r.Context(), "GET", url, nil)
resp, _ := http.DefaultClient.Do(req)
```

For database:
```go
// BAD
rows, _ := db.Query("SELECT ...")

// GOOD
rows, _ := db.QueryContext(r.Context(), "SELECT ...")
```

### Programmatic detection

`uber-go/goleak` integrates with test packages:

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Runs the test, then checks for unexpected goroutines. Fails if any handler-style goroutines remain.

In production, periodically:

```go
go func() {
    for range time.Tick(5 * time.Minute) {
        n := runtime.NumGoroutine()
        if n > goroutineHighWatermark {
            // emit metric, alert, capture stack
            buf := make([]byte, 1<<20)
            buf = buf[:runtime.Stack(buf, true)]
            logger.Warn("high goroutine count", "n", n, "stack", string(buf))
        }
    }
}()
```

---

## Goroutine quotas and back-pressure

Out of the box `*http.Server` has no concurrency limit. Three approaches:

### 1. Connection-level: `netutil.LimitListener`

```go
import "golang.org/x/net/netutil"

ln, _ := net.Listen("tcp", ":8080")
ln = netutil.LimitListener(ln, 10000)
srv.Serve(ln)
```

Beyond N accepted conns, `Accept` blocks. New clients see TCP refused.

### 2. Request-level: semaphore middleware

```go
type limiter struct {
    sem chan struct{}
    h   http.Handler
}

func newLimiter(n int, h http.Handler) *limiter {
    return &limiter{sem: make(chan struct{}, n), h: h}
}

func (l *limiter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    select {
    case l.sem <- struct{}{}:
        defer func() { <-l.sem }()
        l.h.ServeHTTP(w, r)
    case <-r.Context().Done():
        return
    default:
        http.Error(w, "server busy", http.StatusServiceUnavailable)
    }
}
```

Excess requests get 503 immediately. Better UX than TCP refuse.

Variant: queue with bounded wait:

```go
select {
case l.sem <- struct{}{}:
    defer func() { <-l.sem }()
    l.h.ServeHTTP(w, r)
case <-time.After(100 * time.Millisecond):
    http.Error(w, "server busy", http.StatusServiceUnavailable)
case <-r.Context().Done():
    return
}
```

### 3. HTTP/2 stream-level: `MaxConcurrentStreams`

```go
http2s := &http2.Server{MaxConcurrentStreams: 500}
http2.ConfigureServer(srv, http2s)
```

Caps streams per connection. Doesn't cap total streams across all connections.

### Combining

A typical production setup combines all three:
- `LimitListener` caps total connections (memory bound).
- Middleware semaphore caps in-flight handlers (CPU bound).
- `MaxConcurrentStreams` caps per-h2-conn (prevent one client monopolising).

---

## Custom net.Listener wrappers

You can wrap `net.Listener.Accept` to inject per-connection logic. Examples:

### Per-IP connection limit

```go
type ipLimiter struct {
    net.Listener
    mu     sync.Mutex
    counts map[string]int
    maxPerIP int
}

func (l *ipLimiter) Accept() (net.Conn, error) {
    for {
        c, err := l.Listener.Accept()
        if err != nil { return nil, err }
        host, _, _ := net.SplitHostPort(c.RemoteAddr().String())
        l.mu.Lock()
        if l.counts[host] >= l.maxPerIP {
            l.mu.Unlock()
            c.Close()
            continue
        }
        l.counts[host]++
        l.mu.Unlock()
        return &trackedConn{Conn: c, host: host, l: l}, nil
    }
}

type trackedConn struct {
    net.Conn
    host string
    l    *ipLimiter
    once sync.Once
}

func (c *trackedConn) Close() error {
    c.once.Do(func() {
        c.l.mu.Lock()
        c.l.counts[c.host]--
        if c.l.counts[c.host] <= 0 { delete(c.l.counts, c.host) }
        c.l.mu.Unlock()
    })
    return c.Conn.Close()
}
```

`sync.Once` on Close prevents double-decrement; the server may call Close multiple times for hijacked conns and on graceful shutdown.

### Logging listener

```go
type loggingListener struct {
    net.Listener
    logger *slog.Logger
}

func (l *loggingListener) Accept() (net.Conn, error) {
    c, err := l.Listener.Accept()
    if err != nil {
        l.logger.Warn("accept failed", "err", err)
        return nil, err
    }
    l.logger.Debug("accepted", "remote", c.RemoteAddr())
    return c, nil
}
```

Wraps `Accept` for observability.

---

## ConnState callback for connection metrics

`Server.ConnState` is called on every TCP connection state transition:

| State | Transition | When |
|------|------------|------|
| `StateNew` | First state after Accept | Connection created |
| `StateActive` | After read of first byte (or after handler returns and a new request is being read) | Active request in flight |
| `StateIdle` | After handler returns, before next request | Idle, awaiting next request on keep-alive |
| `StateHijacked` | After `Hijack()` | Permanent state for hijacked conns |
| `StateClosed` | Final state | Connection closed |

```go
type connTracker struct {
    new, active, idle, closed, hijacked atomic.Int64
}

func (t *connTracker) track(c net.Conn, state http.ConnState) {
    switch state {
    case http.StateNew:      t.new.Add(1)
    case http.StateActive:   t.active.Add(1)
    case http.StateIdle:     t.idle.Add(1)
    case http.StateHijacked: t.hijacked.Add(1)
    case http.StateClosed:   t.closed.Add(1)
    }
}

func (t *connTracker) report() {
    fmt.Printf("new=%d active=%d idle=%d hijacked=%d closed=%d\n",
        t.new.Load(), t.active.Load(), t.idle.Load(), t.hijacked.Load(), t.closed.Load())
}
```

Note: these are *cumulative* counters. For instantaneous gauges, decrement on transition out:

```go
type connGauge struct {
    inFlight atomic.Int64
}

func (g *connGauge) track(c net.Conn, state http.ConnState) {
    switch state {
    case http.StateNew:
        g.inFlight.Add(1)
    case http.StateClosed, http.StateHijacked:
        g.inFlight.Add(-1)
    }
}
```

`StateHijacked` decrements because the conn is no longer the server's responsibility; track hijacked conns separately if needed.

---

## Custom ErrorLog

`Server.ErrorLog *log.Logger` receives:
- TLS handshake errors.
- HTTP request parsing errors (bad protocol, oversized headers).
- Panics from handlers (after recovery).
- Listener errors.

By default, these go to `log.Default()`. In a structured-logging app:

```go
srv.ErrorLog = slog.NewLogLogger(
    slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}).
        WithAttrs([]slog.Attr{slog.String("source", "http")}),
    slog.LevelWarn,
)
```

Now HTTP errors flow into your structured log with a `source=http` attribute.

### Filtering noise

A common source of noise: TLS handshake errors from scanners hitting your port with garbage:

```
http: TLS handshake error from 198.51.100.1:54321: tls: first record does not look like a TLS handshake
```

These are typically harmless. Wrap your log to drop the most common patterns:

```go
type filteredWriter struct {
    inner io.Writer
}

func (w *filteredWriter) Write(p []byte) (int, error) {
    if bytes.Contains(p, []byte("TLS handshake error")) {
        return len(p), nil // silently drop
    }
    return w.inner.Write(p)
}

srv.ErrorLog = log.New(&filteredWriter{inner: os.Stderr}, "http: ", 0)
```

(In a structured-log world, prefer routing by attribute over substring filtering.)

---

## Working with TLS handshake timeouts

TLS handshakes are per-connection. The handshake runs on the per-connection goroutine inside `(*conn).serve` (around `server.go:1975`).

If the handshake hangs (slow client, network issues), the goroutine is blocked. With Go 1.17+, the server uses `tls.Conn.HandshakeContext` and respects `ReadHeaderTimeout` as the handshake deadline.

For explicit control:

```go
srv.TLSConfig = &tls.Config{
    MinVersion: tls.VersionTLS12,
}
// Server doesn't expose TLSHandshakeTimeout; use ReadHeaderTimeout for that.
```

Note: `http.Transport` (client) has `TLSHandshakeTimeout`. `http.Server` does not — use `ReadHeaderTimeout`.

---

## Memory and GC pressure under load

A busy HTTP server's allocations come from:
1. **Per-request headers parsing** — `bufio` buffers, `textproto.MIMEHeader`.
2. **Request body buffering** — `io.ReadAll` if used, `bufio` otherwise.
3. **Response body marshalling** — `json.Marshal`, `fmt.Sprintf`, string concatenation.
4. **Routing/middleware** — `context.WithValue`, `context.WithTimeout`.

### Tools

- `runtime/metrics` (Go 1.16+): structured access to GC stats.
- `runtime.ReadMemStats`: snapshot of allocation counters.
- `GODEBUG=gctrace=1`: prints GC pauses to stderr.
- `pprof heap`.

### Common wins

- `sync.Pool` for large response buffers.
- `easyjson` or `jsoniter` instead of `encoding/json` for hot endpoints.
- Avoid `fmt.Sprintf` in hot paths; use `strconv.AppendInt` and `append`.
- Pre-allocate slices: `make([]byte, 0, expectedSize)`.
- Reuse `*bytes.Buffer` via pool.

### Watch out for

- `context.WithValue` allocates a small struct per call. Many middleware layers compound.
- `r.URL.Query()` parses on every call; cache the result if used multiple times.
- `r.Header.Get("X-Foo")` is O(N) by header count; for hot lookups consider `r.Header.Values`.

---

## Coding patterns

### Pattern 1 — Request-scoped logger

```go
type loggerKey struct{}

func withLogger(logger *slog.Logger) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            l := logger.With(
                "method", r.Method,
                "path", r.URL.Path,
                "request_id", uuid.NewString(),
            )
            ctx := context.WithValue(r.Context(), loggerKey{}, l)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}

func loggerFrom(ctx context.Context) *slog.Logger {
    if l, ok := ctx.Value(loggerKey{}).(*slog.Logger); ok { return l }
    return slog.Default()
}
```

### Pattern 2 — Recovery middleware

```go
func recoverer(logger *slog.Logger) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            defer func() {
                if rv := recover(); rv != nil {
                    stack := debug.Stack()
                    logger.Error("panic", "panic", rv, "stack", string(stack), "path", r.URL.Path)
                    if !headerWritten(w) {
                        http.Error(w, "internal error", http.StatusInternalServerError)
                    }
                }
            }()
            next.ServeHTTP(w, r)
        })
    }
}
```

### Pattern 3 — Per-handler timeout

```go
func timeout(d time.Duration) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.TimeoutHandler(next, d, "handler timed out")
    }
}
```

`http.TimeoutHandler` runs the inner handler on a separate goroutine and returns 503 + body if it exceeds the deadline. Note: the inner goroutine is not killed; it continues until it returns naturally. So your handler still needs to observe `r.Context().Done()` to actually stop.

### Pattern 4 — Access log

```go
func accessLog(logger *slog.Logger) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            start := time.Now()
            wr := &statusWriter{ResponseWriter: w, status: 200}
            next.ServeHTTP(wr, r)
            logger.Info("access",
                "method", r.Method,
                "path", r.URL.Path,
                "status", wr.status,
                "duration_ms", time.Since(start).Milliseconds(),
                "bytes", wr.bytes,
            )
        })
    }
}

type statusWriter struct {
    http.ResponseWriter
    status int
    bytes  int
}

func (w *statusWriter) WriteHeader(code int) {
    w.status = code
    w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
    n, err := w.ResponseWriter.Write(b)
    w.bytes += n
    return n, err
}
```

Note: `statusWriter` is one goroutine per request — no concurrency concerns. But if you also need to expose `http.Flusher` / `http.Hijacker`, you must implement those interfaces on the wrapper too.

---

## Common production mistakes

### Mistake 1 — Defaulting to `http.ListenAndServe`

The convenience function uses `http.DefaultServeMux` (global mutable state) and has no timeouts. Always construct `*http.Server` explicitly.

### Mistake 2 — Not calling `Server.Close` after `Shutdown` timeout

```go
// BAD
srv.Shutdown(ctx) // hangs forever if handler blocks

// GOOD
if err := srv.Shutdown(ctx); err != nil {
    srv.Close() // force
}
```

### Mistake 3 — Ignoring `ErrServerClosed`

```go
// BAD — treats normal shutdown as error
if err := srv.ListenAndServe(); err != nil { panic(err) }

// GOOD
if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
    panic(err)
}
```

### Mistake 4 — `r.Body` read outside the handler

The body is only valid during the handler call. Reading it from a goroutine spawned by the handler after the handler returns is a race / use-after-free.

### Mistake 5 — Forgetting to set `MaxHeaderBytes`

Default is 1 MiB. Combined with many connections, this is a memory amplification vector. Set to 16-64 KiB unless you have a specific need.

### Mistake 6 — Calling `r.Context()` after handler returns

```go
// BAD
func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        <-r.Context().Done() // r.Context() is cancelled when handler returns
        // anything we do here is on cancelled ctx — instant exit
    }()
}
```

`r.Context()` is cancelled when `ServeHTTP` returns. Goroutines spawned from a handler that hold `r.Context()` will see cancellation almost immediately if the handler returns. Either capture a derived context with longer lifetime, or use `context.Background()` if the work outlives the request.

---

## What you can build

After this file you should be able to:
- Write a production-grade HTTP server from scratch with structured logging, recovery, graceful shutdown, and timeouts.
- Use `pprof` to find leaks, hot paths, and lock contention.
- Configure `*http.Server` for an upload service, a JSON API, or a streaming service.
- Add per-IP rate limiting at the listener level.
- Distinguish handler-level from connection-level concurrency limits.

Next, dive into `senior.md` for the HTTP/2 internals if you haven't, or `specification.md` for the normative references behind the patterns here.
