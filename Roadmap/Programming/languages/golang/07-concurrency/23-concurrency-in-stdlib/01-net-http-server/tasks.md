---
layout: default
title: net/http Server Concurrency — Tasks
parent: net/http Server Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/01-net-http-server/tasks/
---

# net/http Server Concurrency — Tasks

[← Back](../)

> Hands-on exercises. Each task has a goal, a starter snippet (where relevant), success criteria, and hints. Solutions are not given; the point is the discovery.

---

## Task 1 — Confirm goroutine-per-connection (junior)

**Goal.** Verify that each accepted connection gets its own goroutine.

**Starter:**
```go
package main

import (
    "fmt"
    "net/http"
    "runtime"
)

func main() {
    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintf(w, "goroutines: %d\n", runtime.NumGoroutine())
    })
    http.ListenAndServe(":8080", nil)
}
```

**Steps.**
1. Run the server.
2. From three terminals run `curl --keepalive-time 60 http://localhost:8080/` and keep them open.
3. Hit `/` from a fourth terminal. Note goroutine count.
4. Close one of the keep-alive connections (Ctrl-C). Hit `/` again. Goroutines should drop.

**Success.** You see the goroutine count go up and down by 1 per persistent connection (plus a baseline of a few runtime goroutines).

**Hint.** With HTTP/2, the same TCP connection multiplexes streams — you may need `Connection: close` to force fresh connections per request.

---

## Task 2 — Inspect `(*conn).serve` in source (junior)

**Goal.** Read `(*conn).serve` in the Go source.

**Steps.**
1. Find your Go installation: `go env GOROOT`.
2. Open `$GOROOT/src/net/http/server.go`.
3. Locate `func (c *conn) serve(ctx context.Context)`.
4. Annotate the steps: defer recover; TLS handshake; cancel-context goroutine; request loop.
5. Find the `go` keyword in this function. Count how many goroutines `(*conn).serve` itself launches.

**Success.** You can answer: how many goroutines does serve launch besides itself? (Answer: typically one — the cancel-context watcher — and one TLS handshake goroutine for TLS connections, depending on Go version.)

---

## Task 3 — Implement graceful shutdown (middle)

**Goal.** Write a server with `SIGINT`-triggered graceful shutdown.

**Starter:**
```go
package main

import (
    "context"
    "log"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    srv := &http.Server{
        Addr:    ":8080",
        Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            time.Sleep(5 * time.Second)
            w.Write([]byte("done\n"))
        }),
    }
    go func() {
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            log.Fatal(err)
        }
    }()

    // TODO: catch SIGINT, call srv.Shutdown with 10s deadline,
    // log how many requests were in flight, exit cleanly.
}
```

**Steps.**
1. Use `signal.Notify` to catch `SIGINT` and `SIGTERM`.
2. On signal, call `srv.Shutdown(ctx)` with a `context.WithTimeout`.
3. Test: start 3 slow requests, then send SIGINT. All 3 must complete before the program exits.
4. Test the timeout: start a request with `time.Sleep(20 * time.Second)`; SIGINT with 2-second timeout. `Shutdown` should return `context.DeadlineExceeded`.

**Success.** Your server cleanly drains in-flight requests on SIGINT, or returns an error on timeout.

**Hint.** Use `Server.RegisterOnShutdown(func)` to clean up other resources (e.g., db connections).

---

## Task 4 — pprof a busy server (middle)

**Goal.** Instrument a running server with `net/http/pprof` and inspect goroutine counts under load.

**Starter:**
```go
package main

import (
    "net/http"
    _ "net/http/pprof"
)

func slowHandler(w http.ResponseWriter, r *http.Request) {
    time.Sleep(100 * time.Millisecond)
    w.Write([]byte("ok\n"))
}

func main() {
    http.HandleFunc("/slow", slowHandler)
    http.ListenAndServe(":8080", nil)
}
```

**Steps.**
1. Run the server.
2. Generate load: `hey -z 30s -c 200 http://localhost:8080/slow` (or use `ab`/`wrk`).
3. While running: `curl http://localhost:8080/debug/pprof/goroutine?debug=1` and inspect.
4. Use `go tool pprof http://localhost:8080/debug/pprof/goroutine` and `top` / `list slowHandler`.
5. Stop load. Confirm goroutines drop back to baseline.

**Success.** You can identify (a) the steady-state goroutine count under load, (b) the call stack where most goroutines are blocked, (c) the drop after load stops.

---

## Task 5 — Force a goroutine leak (middle)

**Goal.** Write a handler that leaks a goroutine for every request when the client disconnects early.

**Starter:**
```go
func leaky(w http.ResponseWriter, r *http.Request) {
    ch := make(chan struct{})
    go func() {
        time.Sleep(60 * time.Second)
        // never closes ch
        ch <- struct{}{}
    }()
    <-ch // blocks until inner goroutine sends
    w.Write([]byte("done\n"))
}
```

**Steps.**
1. Run this server with `net/http/pprof`.
2. Hit `/leaky` with `curl --max-time 1`. The client disconnects before 60s.
3. Repeat 50 times.
4. Check goroutine count via pprof.
5. Wait 60s. Watch the count drop as inner goroutines eventually complete.

**Success.** You see 50+ goroutines accumulate, then disappear after 60s.

**Question.** Why doesn't the handler return when the client disconnects? (Answer: it's blocked on `<-ch` and not observing `r.Context().Done()`.)

---

## Task 6 — Fix the leak with context (middle)

**Goal.** Modify Task 5's handler so it returns immediately on client disconnect.

**Steps.**
1. Pass `r.Context()` to the inner goroutine (or use it directly in the main handler `select`).
2. Use a buffered `chan struct{}` of size 1 so the inner goroutine never blocks.
3. The main handler selects between `<-ch` and `<-r.Context().Done()`.
4. Test again with the disconnect scenario. The goroutine count should rise briefly, then immediately drop as `Context().Done()` triggers.

**Success.** Repeated disconnect requests no longer accumulate goroutines.

---

## Task 7 — Measure connection reuse (middle)

**Goal.** Confirm that HTTP/1.1 keep-alive reuses the same goroutine.

**Steps.**
1. Modify the handler to print `goroutine ID` from `runtime.Stack`:
   ```go
   func gid() int {
       b := make([]byte, 64)
       n := runtime.Stack(b, false)
       s := string(b[:n])
       s = strings.TrimPrefix(s, "goroutine ")
       id, _ := strconv.Atoi(strings.SplitN(s, " ", 2)[0])
       return id
   }
   ```
2. Have the handler reply with `gid()`.
3. Use `curl` with `--keepalive-time 60` and `curl ... --next ...` to send multiple requests on one connection.
4. Verify all requests share the same goroutine ID.
5. Open a fresh connection (separate curl process). New goroutine ID.

**Success.** You confirm that one TCP connection = one goroutine across many requests.

---

## Task 8 — ReadHeaderTimeout vs ReadTimeout (senior)

**Goal.** Demonstrate the difference between `ReadHeaderTimeout` and `ReadTimeout` against a slow client.

**Setup.** Write a "slow client" that connects and sends bytes one per second:

```go
func slowClient(addr string, bytesPerSecond int) {
    conn, _ := net.Dial("tcp", addr)
    defer conn.Close()
    msg := "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n"
    for _, b := range []byte(msg) {
        conn.Write([]byte{b})
        time.Sleep(time.Second / time.Duration(bytesPerSecond))
    }
    io.Copy(io.Discard, conn)
}
```

**Steps.**
1. Run server with `ReadTimeout: 30s` only. Slowloris with 1 B/s. Confirm the server holds the goroutine for the full 30s.
2. Run server with `ReadHeaderTimeout: 5s`. Slowloris. Server closes after 5s.
3. Confirm that a legitimate slow body upload (after headers are sent quickly) still succeeds — `ReadHeaderTimeout` only covers headers.

**Success.** You see the timeout fire at the right time, and you can write a one-paragraph explanation of why both knobs exist.

---

## Task 9 — Custom server with structured logging (senior)

**Goal.** Build a `*http.Server` with: structured access log middleware, panic recovery middleware, `ConnState` callback for per-connection metrics, `ErrorLog` redirected to your logger.

**Required features.**
1. Middleware that logs `method`, `path`, `status`, `duration`.
2. Middleware that recovers panics and returns a 500 with a `trace_id`.
3. `ConnState` callback that maintains a counter of active connections per state.
4. `ErrorLog: log.New(myLogger, "http: ", 0)` so server errors go to your logger.
5. Graceful shutdown with `Server.RegisterOnShutdown` cleaning up metric subscriptions.

**Success.** A server you'd be comfortable running in production, with no goroutine leaks under `-race`.

---

## Task 10 — HTTP/2 vs HTTP/1.1 throughput (senior)

**Goal.** Benchmark HTTP/2 against HTTP/1.1 for many small parallel requests.

**Setup.**
- Server serves `/` returning a fixed 1 KiB body, TLS enabled (so HTTP/2 negotiates).
- Client uses `http.Client` with two `Transport` configs:
  - `ForceAttemptHTTP2: false` → HTTP/1.1
  - `ForceAttemptHTTP2: true` → HTTP/2
- 1000 sequential requests, 100 parallel requests, 100 parallel × 10 sequential each.

**Measure.** Wall clock per benchmark, goroutine count on the server, allocations per request (`runtime/metrics`).

**Success.** You produce a table of results and a one-paragraph interpretation. Note where HTTP/2 wins and where the per-stream overhead bites.

---

## Task 11 — Hijack to WebSocket (staff)

**Goal.** Implement minimal WebSocket handshake via `Hijack()`.

**Steps.**
1. Handler reads the `Sec-WebSocket-Key` header, computes the accept value (SHA-1 + base64).
2. Writes the `101 Switching Protocols` response manually.
3. Calls `Hijack()` to take ownership of the conn.
4. After hijack, reads ping/pong frames in a goroutine.
5. On `Server.Shutdown`, the hijacked conn must be closed (NOT by the server — by your tracked registry).

**Success.** Hijacked connections drain on shutdown; no goroutine leak after.

**Hint.** Maintain `map[*net.Conn]struct{}` under a mutex; close all on shutdown.

---

## Task 12 — Cancellation propagation audit (staff)

**Goal.** In an existing codebase (your own or a sample), find every place where `r.Context()` should be passed but isn't.

**Steps.**
1. `git grep "http.Get\|http.Post\|http.PostForm"` — these don't take a context. Each call inside a handler is a potential cancellation hole.
2. `git grep "context.Background\|context.TODO"` inside handler files — `Background` inside a handler usually means cancellation is being thrown away.
3. `git grep "db.Query\|db.Exec"` without `Context` — same problem.

For each find, refactor to pass `r.Context()` (or a derived ctx). Add a test that disconnects the client mid-request and verifies the upstream call is cancelled (use `httptest.NewServer` for the upstream, check ctx).

**Success.** A list of fixes and a test demonstrating cancellation now propagates end-to-end.

---

## Task 13 — Bound goroutines with a semaphore (staff)

**Goal.** Add a global concurrency limit to your server.

**Approach 1: middleware.** Channel-based semaphore wrapping every handler. On overflow, return 503.

**Approach 2: netutil.** Use `netutil.LimitListener(ln, N)` to cap accepted connections.

**Approach 3: HTTP/2 only.** Set `http2.Server.MaxConcurrentStreams`.

**Steps.**
1. Implement all three.
2. Benchmark each: throughput, latency P99, rejection rate.
3. Note which approach has which side effects (e.g., LimitListener bottlenecks behind keep-alive; middleware doesn't).

**Success.** A table comparing approaches; recommendation for your workload.

---

## Task 14 — Build a custom net.Listener with rate limiting (staff)

**Goal.** Wrap `net.Listener.Accept` to apply per-IP connection-rate limits.

**Steps.**
1. Type `type limitedListener struct { net.Listener; limiter *rate.Limiter }`.
2. Override `Accept`: accept, then check `limiter.Allow()`; if not, close the conn and accept again.
3. Per-IP: keep a `map[string]*rate.Limiter` under a mutex; evict idle entries.
4. Pass to `Server.Serve(yourListener)`.
5. Test with a flood from one IP; confirm only N/sec connections proceed.

**Success.** Rate limiting works at the TCP layer (before any HTTP parsing); load test shows attacker IP is throttled while legitimate IPs continue.

---

## Task 15 — Implement the cancel-context watcher (staff)

**Goal.** Reproduce, in user code, the goroutine that the server uses to cancel `r.Context()` on client disconnect.

**Setup.** Use `Hijack()` to get raw conn access, then build cancellation:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    h, ok := w.(http.Hijacker)
    if !ok { http.Error(w, "no hijack", 500); return }
    conn, _, err := h.Hijack()
    if err != nil { return }
    defer conn.Close()
    
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    
    // watcher: when conn closes, cancel ctx
    go func() {
        var buf [1]byte
        for {
            conn.SetReadDeadline(time.Now().Add(time.Second))
            _, err := conn.Read(buf[:])
            if err != nil && !isTimeout(err) {
                cancel()
                return
            }
            select {
            case <-ctx.Done(): return
            default:
            }
        }
    }()
    
    // do work with ctx...
}
```

**Steps.**
1. Implement; test that `kill -9` on the client triggers ctx cancellation.
2. Compare with the stdlib approach (read on a closed conn returns EOF immediately on Linux).
3. Note pitfalls: long deadlines mean late detection; short deadlines waste CPU.

**Success.** Working watcher; understanding of why the stdlib uses a similar pattern.

---
