---
layout: default
title: net/http Server Concurrency — Interview
parent: net/http Server Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/01-net-http-server/interview/
---

# net/http Server Concurrency — Interview Questions

[← Back](../)

> Practice questions from junior to staff. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. How does `http.ListenAndServe` handle concurrent requests?

**Model answer.** It runs an accept loop in `(*Server).Serve`. For each accepted TCP connection it spawns a new goroutine: `go c.serve(ctx)`. That goroutine reads HTTP requests from the connection (one at a time per HTTP/1.1) and calls the handler. Many connections in flight = many goroutines.

**Common wrong answers.**
- "It uses a thread pool." (No — Go does not pool goroutines for handlers; one fresh goroutine per connection.)
- "Each request gets its own goroutine." (Half right — each *connection* gets its own goroutine. With keep-alive, many requests share one goroutine sequentially.)

**Follow-up.** *What about HTTP/2?* HTTP/2 multiplexes streams; the framer reads frames in one goroutine and dispatches each stream to its own goroutine.

---

### Q2. Is `http.ResponseWriter` safe for concurrent use?

**Model answer.** No. The handler should call `w.Write` and `w.Header` only from the handler's own goroutine. If you spawn a goroutine that also writes to `w`, you have a race (the race detector catches it).

**Follow-up.** *How do you stream data to the client from a background goroutine?* You don't — you forward through a channel and let the handler write to `w`. Or you use `Flusher.Flush()` to send periodic updates, still from the handler goroutine.

---

### Q3. When does `r.Context()` get cancelled?

**Model answer.** When (a) the client closes its connection, (b) for HTTP/2, when the client sends RST_STREAM, or (c) when the handler returns. The server runs a goroutine that watches the connection and calls the cancel function when one of these events occurs.

**Common wrong answers.** "Only when the handler returns." (No — most importantly, when the client disconnects mid-handler.)

---

### Q4. What's the difference between `Server.Shutdown` and `Server.Close`?

**Model answer.** `Shutdown` is graceful: stops accepting new connections, waits for in-flight handlers to finish, closes idle connections immediately. `Close` is forceful: immediately closes the listener and every active connection, interrupting in-flight handlers (their `r.Context()` is cancelled).

**Follow-up.** *How do you wait for in-flight requests with a deadline?* Pass a `context.WithTimeout` to `Shutdown`. If the timeout fires, `Shutdown` returns `context.DeadlineExceeded`; you can then call `Close` to force exit.

---

### Q5. What is keep-alive in HTTP/1.1?

**Model answer.** A persistent connection: after a request/response, the connection is kept open for the next request from the same client. Saves the TCP and TLS handshake cost. The Go server keeps the same goroutine alive in a loop reading more requests until idle timeout, error, or peer closes.

---

### Q6. What does `Server.IdleTimeout` control?

**Model answer.** How long an idle keep-alive connection stays open between requests. After this, the server closes the connection (and its serving goroutine exits). Without `IdleTimeout`, connections stay open indefinitely (subject to OS keepalive). The default in Go 1.21+ is to use `ReadTimeout` as the idle timeout if `IdleTimeout` is zero.

---

### Q7. Why is `defer body.Close()` important in handlers? *(trick — it's actually about clients)*

**Model answer.** In handlers, the server already closes the request body after the handler returns. You do NOT need to close it. You should close it only if you want to release the connection early for keep-alive reuse — but typically you don't bother. This is in contrast to the *client* side where you MUST `defer resp.Body.Close()` to free the connection back to the pool.

---

## Middle

### Q8. Walk through `(*conn).serve` from start to finish.

**Model answer.**
1. Defer panic recovery (logs panic, closes connection).
2. If TLS, perform the TLS handshake. This is a blocking call on the same goroutine — no separate handshake goroutine in Go's design (the server uses `tls.Conn.HandshakeContext` since Go 1.17).
3. Start a background goroutine that watches `closeNotifyCh` and cancels the connection's context when the client closes.
4. Enter the request loop:
   - `c.readRequest(ctx)` parses one HTTP/1.1 request.
   - Build `*Request`, `ResponseWriter`.
   - Set deadlines based on `WriteTimeout`/`ReadTimeout`.
   - Call `serverHandler{c.server}.ServeHTTP(w, req)` which dispatches to user handler.
   - `w.finishRequest()` flushes buffered output.
   - If the connection is reusable (no `Connection: close`, request body fully read, no error), loop. Otherwise close.
5. Close the connection, run `ConnState` callback with `StateClosed`.

---

### Q9. What is the `ConnState` callback used for?

**Model answer.** It is invoked by the server every time a connection transitions state: `StateNew` → `StateActive` → `StateIdle` → `StateClosed` (with `StateHijacked` as an alternate exit). It's used for metrics (counting in-flight connections), debugging, and rate limiting at the connection level.

**Follow-up.** *Where in the code is it called?* In `(*conn).setState` in `server.go`. The state transitions happen in `(*conn).serve` at well-defined points.

---

### Q10. How does the server track active connections for shutdown?

**Model answer.** A map `Server.activeConn` of `*conn` → struct{}, protected by `Server.mu`. Each new connection registers in `setState(StateNew)`. On shutdown, `Server.Shutdown` iterates the map, closes idle connections immediately, and polls until no active connections remain.

---

### Q11. What does `Server.SetKeepAlivesEnabled(false)` do?

**Model answer.** It tells the server not to honour keep-alive on new requests — every response will include `Connection: close`. After serving the current request, the connection closes. It's commonly used during graceful shutdown to drain clients faster.

---

### Q12. Why does `(*conn).serve` reset deadlines per request?

**Model answer.** Each new request starts with fresh `ReadTimeout`/`WriteTimeout` budgets. The server calls `c.rwc.SetReadDeadline(time.Now().Add(d))` at the start of the request and `SetWriteDeadline` when starting to write. Otherwise the cumulative time across many requests on a keep-alive connection would exhaust the timeout.

---

### Q13. What's `ReadHeaderTimeout` for, and why is it useful?

**Model answer.** It caps the time the server spends reading request *headers* (not the body). Set this small (a few seconds) to protect against slowloris attacks where a client sends headers one byte at a time. `ReadTimeout` covers the entire request including the body; for big uploads, you can't set `ReadTimeout` small. `ReadHeaderTimeout` lets you have a short header limit and a longer body limit.

---

### Q14. Describe the role of `(*conn).cancelCtx`.

**Model answer.** When the server creates the per-request context, it stores a cancel function. A background goroutine watches the underlying socket via `closeNotify` and calls `cancelCtx` when it detects the peer has closed. This propagates cancellation to `r.Context()`, so any handler-spawned goroutine can observe `<-r.Context().Done()` and exit.

---

### Q15. What happens if a handler panics?

**Model answer.** The deferred recover in `(*conn).serve` catches it, logs the panic and stack trace via `Server.ErrorLog`, and closes the connection. The server keeps running; only that one connection dies. Other concurrent connections are unaffected.

**Follow-up.** *Is there a way to customize this?* Yes: wrap your handler in middleware that recovers itself. The server's recover is a last-resort safety net.

---

## Senior

### Q16. Describe the HTTP/2 server's goroutine layout.

**Model answer.**
- **One** accept goroutine in `(*Server).Serve`.
- **One** goroutine per connection that performs the HTTP/2 handshake, then enters `http2serverConn.serve`.
- That goroutine is the **frame reader**: it reads frames in a tight loop and dispatches them via channel sends to other goroutines.
- A **frame writer** goroutine drains a channel of frames to be sent and writes them on the wire (serialised — only one goroutine writes).
- **One goroutine per stream** that runs the user handler.

So a single HTTP/2 connection has 1 (reader) + 1 (writer) + N (per stream) goroutines, all sharing one `*http2serverConn`.

---

### Q17. How does HTTP/2 flow control work in Go?

**Model answer.** Each stream has a send window (peer-controlled, how much we can send) and a receive window (we-controlled, how much we tell peer to send). Initial windows are SETTINGS-negotiated. As we read DATA frames, we shrink our receive window; when it's low enough, we send WINDOW_UPDATE. As we write DATA frames, the framer waits for window credit; if the stream window is exhausted but the connection window has credit, it blocks (or, in Go's implementation, schedules a write-when-window-available event). The framer never blocks on application code: backpressure is exposed to handlers via short `Write` returns that the standard `Flusher`/`ResponseWriter` interfaces hide.

---

### Q18. What happens during `Hijack()`?

**Model answer.**
1. The handler calls `w.(http.Hijacker).Hijack()`.
2. The server sets `c.hijacked = true` under `c.mu`.
3. The server stops doing anything else with the conn: no read deadlines, no write deadlines, no further read/write, no response finalisation.
4. The bufio.Reader/Writer (with any unread bytes) and the raw `net.Conn` are returned to the handler.
5. The handler now owns the conn and must close it.
6. The server marks the conn `StateHijacked` (no further state transitions).

**Common wrong answers.** "The server keeps reading from the connection." (No — total ownership transfer.)

---

### Q19. How does `Server.Shutdown` know when to return?

**Model answer.** After closing the listener and idle conns, it polls `Server.activeConn` and `len(s.listeners)` periodically (every ~500ms in current Go) until both are empty, then closes `doneChan` and returns. The context passed to `Shutdown` can cancel the wait early.

**Follow-up.** *Why polling instead of a single channel close?* Active connections only transition to closed when their `(*conn).serve` goroutine returns from its loop. Each transition takes the `Server.mu`. Polling is simpler than tracking outstanding work with a `WaitGroup` (which would require careful registration on every Add).

---

### Q20. What's the bug in this code?

```go
func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        time.Sleep(5 * time.Second)
        w.Write([]byte("late response"))
    }()
    w.Write([]byte("immediate response"))
}
```

**Model answer.** Three bugs:
1. **Race on `w`.** Two goroutines write to `w` concurrently.
2. **Use after handler returns.** The goroutine writes to `w` 5 seconds after `ServeHTTP` returns. The server has likely already closed the connection or sent the response. `ResponseWriter` documentation explicitly forbids this.
3. **Goroutine leak on client disconnect.** If the client closes before 5 seconds, the spawned goroutine still runs; it doesn't observe `r.Context().Done()`.

**Fix.** Don't spawn at all — if you really need async, return a channel result and have the *handler* write the final value, observing `r.Context().Done()`:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    result := make(chan []byte, 1)
    go func() {
        select {
        case <-time.After(5*time.Second):
            result <- []byte("done")
        case <-r.Context().Done():
            return
        }
    }()
    select {
    case b := <-result:
        w.Write(b)
    case <-r.Context().Done():
        return
    }
}
```

---

### Q21. How does the server limit total goroutines?

**Model answer.** Out of the box, it doesn't. Every accepted connection spawns a goroutine; under SYN flood you get one goroutine per accepted TCP conn. Production servers add middleware that bounds in-flight requests (semaphores) or limit listeners (`netutil.LimitListener`) to cap the connection count before the goroutine is spawned.

For HTTP/2, `http2.Server.MaxConcurrentStreams` caps streams per connection (default 250), but a single attacker could open many connections.

---

### Q22. What does `Server.MaxHandlers` do? *(trick — it doesn't exist in net/http)*

**Model answer.** It doesn't exist in `net/http`. `http2.Server` has fields like `MaxConcurrentStreams` and `IdleTimeout`, and you can implement a limit with `netutil.LimitListener` (from `golang.org/x/net/netutil`) or middleware. Some interview prompts use `MaxHandlers` to test whether candidates make up APIs.

---

### Q23. Explain `WriteTimeout` and a subtle pitfall.

**Model answer.** `WriteTimeout` sets the deadline for the entire response write (status, headers, body). The server calls `c.rwc.SetWriteDeadline(time.Now().Add(d))` *before* invoking the handler. So the handler has at most `WriteTimeout` to write the response.

**Pitfall.** If your handler does long work *before* writing (e.g., a slow database query), the write deadline is already counting against that work. You can't "extend" the deadline mid-handler without calling the underlying `net.Conn.SetWriteDeadline` (which requires `Hijack()`).

**Workaround.** For long-running handlers, structure the work so writes happen incrementally with `Flusher.Flush()`, keeping the connection active.

---

## Staff

### Q24. Design a graceful shutdown for an HTTP server that includes WebSocket connections.

**Model answer.** `Server.Shutdown` waits for `activeConn` to drain, but hijacked connections are NOT in `activeConn` after hijack. So WebSockets won't be waited for. You need a separate registry:

```go
type wsRegistry struct {
    mu    sync.Mutex
    conns map[*websocket.Conn]struct{}
}

func (r *wsRegistry) Add(c *websocket.Conn) { /* ... */ }
func (r *wsRegistry) Remove(c *websocket.Conn) { /* ... */ }

func (r *wsRegistry) CloseAll() {
    r.mu.Lock()
    defer r.mu.Unlock()
    for c := range r.conns {
        c.Close(websocket.StatusGoingAway, "shutdown")
    }
}
```

On shutdown: call `srv.Shutdown(ctx)` AND `registry.CloseAll()`, then wait for both. WebSocket handler goroutines should observe ctx and exit.

---

### Q25. Why might `Server.Shutdown` block indefinitely even after `Close`-ing the listener?

**Model answer.** Because in-flight handlers haven't returned. A handler waiting on a slow database query or an upstream service blocks `Shutdown` until it returns. If the handler doesn't observe `r.Context().Done()`, it never knows about the shutdown.

**Fix.** All long-running handlers must propagate `r.Context()` to downstream operations (DB queries, HTTP calls, etc.). Then `Shutdown` ctx cancellation will cascade.

---

### Q26. The HTTP/2 server uses one goroutine for the framer write loop. What's the design rationale, and what's the cost?

**Model answer.** **Rationale.** HTTP/2 frames must not interleave on the wire — a single frame is a unit. Multiple stream writes contending for the same TCP connection would either need a lock around every write or a serialiser goroutine. Go chose the latter: one writer goroutine, fed by a channel, simplifies the per-stream code (handlers write to a buffer, the writer goroutine pulls).

**Cost.** Extra channel sends and goroutine scheduling per write. For tiny responses this can be noticeable. The HTTP/2 server batches frames where possible (writes back-to-back without re-scheduling).

---

### Q27. How do you measure goroutine leaks from handlers in production?

**Model answer.**
- Enable `net/http/pprof`. Periodically fetch `/debug/pprof/goroutine?debug=2`.
- Look for goroutines stuck in the same handler function across multiple samples. Compare goroutine count over time; a steady rise without traffic spike indicates a leak.
- Use `runtime.NumGoroutine()` as a high-level alarm metric.
- Tools like `goleak` (from Uber) can be used in tests.
- In production, set a soft cap (alarm at N goroutines), correlate with shutdown timing (a handler that blocks `Shutdown` is by definition leaked).

---

### Q28. What's the difference between `(*http.Server).ConnState` and middleware?

**Model answer.** `ConnState` fires on *TCP connection* state changes (new/active/idle/closed/hijacked). Middleware fires per *HTTP request*. With keep-alive, many requests happen on one connection — `ConnState` fires once per conn, middleware fires once per request. With HTTP/2, `ConnState` fires once per TCP conn (typically once for the whole HTTP/2 session), while middleware runs per stream.

**Use cases.** `ConnState`: connection-level metrics, per-conn rate limits. Middleware: per-request metrics, per-request auth.

---

### Q29. A handler that spawns a goroutine writing to a `chan` and waits on it from the main goroutine — what could go wrong?

**Model answer.** Several risks:
1. If the goroutine never finishes and the handler doesn't observe `r.Context().Done()`, leak.
2. If the chan is unbuffered and both goroutines try to use `w` afterwards, race.
3. If the handler returns due to ctx cancellation but the goroutine still tries to send, blocked send → leak.

**Robust pattern.**

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    out := make(chan result, 1) // buffer 1 so producer never blocks
    go func() {
        out <- doWork(ctx) // doWork must observe ctx
    }()
    select {
    case res := <-out:
        // write res to w
    case <-ctx.Done():
        return
    }
}
```

Buffered channel + ctx-aware producer + ctx-aware consumer.

---

### Q30. What's the throughput cost of HTTP/2 vs HTTP/1.1 keep-alive in Go?

**Model answer.** For many small concurrent requests from one client, HTTP/2 is faster: one TCP/TLS connection, multiplexed streams. For one big request, HTTP/2 adds overhead: frame parsing, per-stream goroutine startup, flow-control bookkeeping. The framer write goroutine and channel hops add a few microseconds per request.

In practice, HTTP/1.1 keep-alive over one connection serialises requests, so for parallel work HTTP/2 wins. For pipelined throughput (which most clients don't actually do), HTTP/1.1 can edge out HTTP/2.

---

### Q31. Why isn't there a built-in `net/http` middleware system?

**Model answer.** Go's standard library is intentionally minimal. `http.Handler` is the composition point: middleware is just a function `func(http.Handler) http.Handler`. The community has built dozens of routers/middleware libraries on top. The stdlib design lets you compose them without choosing a framework.

**Concurrency angle.** Middleware runs in the same goroutine as the handler; it inherits `r.Context()`, can wrap `w`, and can spawn goroutines (with the same caveats as handlers).

---

### Q32. How would you implement per-request goroutine quotas?

**Model answer.** Wrap the server in a semaphore-based limiter:

```go
type limiter struct {
    sem chan struct{}
    h   http.Handler
}

func (l *limiter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    select {
    case l.sem <- struct{}{}:
        defer func() { <-l.sem }()
        l.h.ServeHTTP(w, r)
    case <-r.Context().Done():
        return
    default:
        http.Error(w, "too busy", http.StatusServiceUnavailable)
    }
}
```

This caps concurrent in-flight handlers (NOT concurrent connections — `MaxConcurrentStreams` does that for HTTP/2; `netutil.LimitListener` does it at TCP).

---

### Q33. Describe a real bug you'd expect to see in a high-traffic Go HTTP server.

**Model answer.** Common bugs:
1. **`r.Context()` not propagated** to downstream service calls → handlers stay alive after client disconnect.
2. **`ResponseWriter` written from background goroutine** → race, sometimes corrupt response.
3. **Long-blocking middleware** (e.g., a sync.Mutex contended across handlers) → goroutine pile-up.
4. **Missing `WriteTimeout`** → slow client pinning a goroutine indefinitely.
5. **`http.Get` without timeout from inside a handler** → cascading hang under upstream failure.
6. **Forgot to close request body** when proxying → connections not reused.
7. **Hijacked connection without manual Close** → fd leak.

---
