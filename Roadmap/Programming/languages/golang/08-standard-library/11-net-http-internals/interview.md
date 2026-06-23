# 8.11 `net/http` Internals — Interview

> Questions you should be able to answer cold. Each one tests a
> specific contract or systems detail; the answer sketches what a
> good response covers, not a verbatim script.

## Server-side fundamentals

### 1. Walk through what happens between `http.ListenAndServe` and your handler running.

Listener binds, `Server.Serve` loops on `Accept`, each accepted conn
gets one goroutine running `c.serve`. That goroutine reads request
line and headers (subject to `ReadHeaderTimeout` and
`MaxHeaderBytes`), builds `*Request`, wraps the conn in a
`ResponseWriter`, looks up the handler via `Server.Handler`
(typically a `ServeMux`), and calls `ServeHTTP`. After return, the
server flushes pending response, drains the request body if needed,
and either reads the next request (HTTP/1.1 keep-alive) or closes the
conn.

Key fact: one goroutine per *conn*, not per request. Keep-alive
reuses the goroutine for subsequent requests on the same conn.

### 2. What does `WriteHeader` actually do, and what's the contract?

It sends the HTTP status line plus current headers on the wire. Rules:

- May be called at most once. Subsequent calls log
  "superfluous WriteHeader call" and are ignored.
- After it's called (or after the first `Write`, which calls
  `WriteHeader(200)` for you), changes to `w.Header()` are silently
  ignored except for trailers.
- The first 512 bytes of `Write` may auto-set `Content-Type` if not
  already set, via `DetectContentType`.

Translate to: set headers, call `WriteHeader`, then `Write`. Or just
`Write` and let it default to 200.

### 3. Why is `http.Get` dangerous in production?

Uses `http.DefaultClient`, which has no timeout. A slow or
unresponsive server hangs your goroutine forever. Always create your
own `*http.Client` with `Timeout` set, and reuse it across the
program.

Bonus: `DefaultTransport` is shared, so independent libraries that
both use `http.Get` can affect each other through the shared idle
pool.

### 4. What are the five timeouts on `http.Server` and what does each cover?

- `ReadHeaderTimeout`: accept to end-of-headers. Slow-loris defense.
- `ReadTimeout`: accept to end-of-body. Covers headers + body.
- `WriteTimeout`: end-of-body to response sent.
- `IdleTimeout`: gap between requests on a keep-alive conn.
- `MaxHeaderBytes`: cap on request line + headers.

For streaming endpoints (SSE, long polling), set `ReadTimeout` and
`WriteTimeout` to 0 and use `ResponseController` per-request.

### 5. How does `Shutdown` differ from `Close`?

`Shutdown(ctx)`:
1. Closes listeners (no new accepts).
2. Closes idle conns.
3. Waits for active handlers to return, up to `ctx` deadline.
4. Returns; `ListenAndServe` returns `http.ErrServerClosed`.

`Close()` is the hard kill: closes everything immediately, including
in-flight conns. Use it when `Shutdown` won't return in time.

For long-running handlers (SSE, websockets), `RegisterOnShutdown` lets
you signal them to wind down at the *start* of shutdown, before it
waits.

### 6. Why does the server recover panics, and what does it actually do?

Per-conn goroutine has a `defer recover()`. Without it, a panicked
handler would crash the whole process. The stdlib recovery logs the
stack and aborts the response (sending whatever was already written
plus a connection close).

It does *not* call your error tracker or write a clean 500 — that's
your middleware's job.

### 7. What's `http.ErrAbortHandler`?

A sentinel panic value that the server treats specially: no log line,
no further response. Used by middleware that wants to terminate a
handler silently from deep in the stack. Almost no application code
should panic with this directly.

## Routing

### 8. What changed in `ServeMux` in Go 1.22?

Patterns now support method prefix, host prefix, and path wildcards:

- `"GET /users/{id}"` — method + wildcard.
- `"{file...}"` — capture the rest of the path.
- `"api.example.com/users"` — host-restricted.
- `"/users/{$}"` — exact match without subtree.

Wildcards are accessed via `r.PathValue("name")`. Conflicting
patterns at registration panic.

### 9. Why use `http.NewServeMux()` instead of the package-level `http.HandleFunc`?

Package-level `HandleFunc` writes to `http.DefaultServeMux`, a global.
Any imported package can register handlers on it. You can't see what
it contains; you can't pass it to a custom `Server` cleanly. Always
create your own mux.

### 10. How would you implement a router that supports method-specific 405 responses?

Up to Go 1.22, you wrap your own dispatch. From Go 1.22, `ServeMux`
already does this — register `"GET /foo"` and `POST /foo` returns 405
with `Allow: GET` automatically.

## Body and headers

### 11. Why must you drain `resp.Body` before closing it?

The HTTP client returns conns to the pool only if they're in a clean
state. An undrained body means there are bytes the server already
sent that the client hasn't consumed — the framing is uncertain, the
conn isn't reusable. Always:

```go
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()
```

Without the drain, the conn closes after the response, and under load
you exhaust ephemeral ports.

### 12. What does `http.MaxBytesReader` do beyond capping reads?

Two effects:
1. Reads return `*MaxBytesError` once the cap is exceeded.
2. Marks the conn for close after the response — so an attacker can't
   keep streaming bytes past the cap into the kernel buffer.

Without it, an oversized upload fills the recv buffer even after your
handler bailed.

### 13. When is `Request.GetBody` populated, and why does it matter?

`http.NewRequest` sets `GetBody` when the body is a `*bytes.Buffer`,
`*bytes.Reader`, or `*strings.Reader` — anything that's already in
memory. It's a function that returns a fresh reader for the same
bytes.

Matters for redirects (3xx) and for retries: replaying a request
needs `GetBody`. For an `os.File` or `io.Pipe` body, `GetBody` is
nil; a redirect that requires resending the body fails.

### 14. What's the difference between `r.Header.Get("X")` and `r.Header["X"]`?

`Get` canonicalizes the key (`"content-type"` → `"Content-Type"`) and
returns the first value. `r.Header["X"]` is a literal map access; if
the actual stored key is `"Content-Type"` and you ask for `"content-type"`,
you get nil. Always use `Get`.

## Client and Transport

### 15. Why is the default `MaxIdleConnsPerHost` of 2 wrong for service-to-service traffic?

Under sustained load, only 2 idle conns are kept per backend. The
3rd, 4th, ... conns close immediately after the response. You re-pay
the dial cost (handshake + TLS + slow-start) on every excess
request, and you accumulate TIME_WAIT entries on the client side.
Bump to 10–100 for heavily-used backends.

### 16. How does Go pick HTTP/2 over HTTP/1.1?

Server-side: `http.Server` with TLS advertises `h2` and `http/1.1`
via ALPN. The client picks `h2`, the conn becomes HTTP/2. To opt
out: set `srv.TLSNextProto = make(map[string]...)`.

Client-side: `http.Transport` with TLS attempts `h2` via ALPN
(`ForceAttemptHTTP2 = true` by default since Go 1.6+).

For h2c (cleartext HTTP/2), use `golang.org/x/net/http2/h2c.NewHandler`.

### 17. What's `Hijack`, and why does it not work on HTTP/2?

`Hijack()` returns the underlying `net.Conn`, releasing it from the
server. Used for WebSocket upgrade and other custom protocols on the
same port.

HTTP/2 multiplexes many streams on one conn; "taking over the conn"
would clobber other in-flight streams. The spec doesn't allow it.
WebSocket-over-HTTP/2 has its own RFC (8441) but support is limited.

### 18. What's the difference between `Client.Timeout` and a context deadline?

`Client.Timeout` is the total wall-clock budget covering dial, TLS,
write, headers, body. It's set once on the client and applies to
every request.

A context deadline (`http.NewRequestWithContext(ctx, ...)`) is
per-request and propagates through the request chain. Better for
per-call SLOs and for cancellation tied to upstream signals.

Use both: `Client.Timeout` as the global cap, context for per-call
control.

### 19. What's a `RoundTripper`'s contract?

```go
type RoundTripper interface {
    RoundTrip(*Request) (*Response, error)
}
```

Rules:
- Don't modify the input request (use `req.Clone(ctx)`).
- On success, return a non-nil response; caller closes the body.
- On error, return nil response or a response with closed body.
- Honor `req.Context()` for cancellation.

Wrap `http.Transport` to add logging, retries, metrics, auth.

## Lifecycle and concurrency

### 20. How is `r.Context()` canceled?

When **any** of these happen:
- Client closes the conn (TCP RST/FIN).
- The handler returns.
- The server is `Shutdown` or `Close`d.
- A `BaseContext` ancestor is canceled.

Replaces the deprecated `http.CloseNotifier`.

### 21. What's `Server.BaseContext` for?

The root context every request inherits from. Default is
`context.Background()`. Set to a context tied to your shutdown signal
so handlers see global cancellation:

```go
shutdownCtx, _ := signal.NotifyContext(context.Background(), os.Interrupt)
srv.BaseContext = func(_ net.Listener) context.Context { return shutdownCtx }
```

### 22. What states does `ConnState` report and when?

`StateNew` (TCP accept) → `StateActive` (first byte) ⇄ `StateIdle`
(handler returned, keep-alive) → `StateClosed`. `StateHijacked` is
terminal.

Use for conn-count gauges. Don't block in the callback — it runs in
the conn goroutine.

### 23. How would you wrap `ResponseWriter` to record status codes without breaking `Flusher`?

Implement `Unwrap() ResponseWriter`:

```go
type recordingWriter struct {
    http.ResponseWriter
    status int
}
func (r *recordingWriter) WriteHeader(c int) {
    r.status = c
    r.ResponseWriter.WriteHeader(c)
}
func (r *recordingWriter) Unwrap() http.ResponseWriter { return r.ResponseWriter }
```

Then in handlers, use `http.NewResponseController(w).Flush()` instead
of `w.(http.Flusher).Flush()`. The controller walks the unwrap chain.

## Production patterns

### 24. How do you implement graceful shutdown that drains in-flight requests?

```go
ctx, _ := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
go srv.ListenAndServe()
<-ctx.Done()
shutdownCtx, _ := context.WithTimeout(ctx, 30*time.Second)
srv.Shutdown(shutdownCtx)
```

For LB-fronted services, also flip a readiness probe to "unready"
before calling `Shutdown` and wait the LB's deregister period
(typically 5–15s) so traffic stops arriving.

### 25. How would you reload TLS certificates without restarting?

Use `tls.Config.GetCertificate`, called per-handshake:

```go
tlsCfg := &tls.Config{
    GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
        return reloader.current(), nil
    },
}
```

A goroutine watches the cert files (timer or fsnotify) and updates
the `reloader`'s atomic pointer. New conns get the new cert; old
conns keep their cert until they close.

### 26. When would you use `httptrace`?

For diagnosing latency in client requests. The hooks fire at exact
points: `DNSStart`, `ConnectStart`, `TLSHandshakeDone`,
`GotFirstResponseByte`. You can isolate "is it DNS, network, TLS,
upstream processing, or body transfer?" — without it, all you see is
total time.

Install via `httptrace.WithClientTrace(ctx, trace)` per-request, or
globally via a wrapping `RoundTripper`.

### 27. What's the right way to retry a request, and what could go wrong?

Wrap `RoundTripper`. Rules:
- Only retry idempotent methods (GET, HEAD, OPTIONS, PUT, DELETE).
- For POST, require an idempotency key and document it on the API.
- Replay needs `GetBody`; without it, the second attempt sends an
  empty body.
- Drain failed responses before retry.
- Backoff with jitter to avoid retry storms.
- Cap total retry time (and respect context deadline).

### 28. How does `httputil.ReverseProxy` handle hop-by-hop headers?

Strips them before forwarding (per RFC 7230): `Connection`,
`Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `Te`,
`Trailers`, `Transfer-Encoding`, `Upgrade`. Plus any header listed in
the `Connection:` value.

It also adds `X-Forwarded-For` (via `SetXForwarded` or the modern
`Rewrite` hook).

## Bug-finding

### 29. A handler sets `Content-Length: 5` then writes 11 bytes. What happens?

The server writes only the first 5 bytes; the rest is silently
discarded. The client sees `"hello"` and a clean conn. There's no
error to the handler — the framing wins.

Don't set `Content-Length` manually unless you know it. Default is
correct.

### 30. A POST handler reads `r.Body` partially, returns 400. Why does the next request on this conn fail?

If the conn is HTTP/1.1 with `Content-Length`, the unread bytes are
"in the pipe." The next request line you read might actually be the
tail of the previous request's body — request smuggling, basically.

The server tries to drain a small budget after the handler returns,
but if there's more, it closes the conn. The client may or may not
realize, depending on HTTP/1.1 retry semantics.

Lesson: with `MaxBytesReader`, this is contained. Without it, large
unread bodies fill the kernel recv buffer and stall.

## Cross-references

- [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md),
  [professional.md](professional.md) for full coverage.
- [find-bug.md](find-bug.md) for code-reading drills based on the
  topics above.
- [`../10-net/interview.md`](../10-net/interview.md) for socket-level
  questions that underpin this material.
