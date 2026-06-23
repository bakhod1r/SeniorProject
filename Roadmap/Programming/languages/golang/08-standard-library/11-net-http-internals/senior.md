# 8.11 `net/http` Internals — Senior

> **Audience.** You've shipped HTTP services and run them under load.
> This file is the precise contract: what `Server` does per conn, what
> `ResponseWriter` guarantees and forbids, the `Hijacker`/`Flusher`
> opt-ins, how `ResponseController` replaces the type assertions, the
> `Transport` connection pool, HTTP/2 transparent upgrade, and the
> systems-level details that separate code that mostly works from
> code that survives.

## 1. The per-conn lifecycle, exactly

Inside `Server.Serve`:

```go
for {
    rw, err := l.Accept()
    if err != nil { /* accept loop, with a Temporary() backoff */ }
    c := srv.newConn(rw)
    c.setState(c.rwc, StateNew, runHooks)
    go c.serve(ctx)
}
```

Each accepted conn gets one goroutine running `c.serve`. Inside
`serve`, the loop is:

1. **Recover panics.** Any panic from the handler is caught here. The
   server logs the stack and either closes the conn or, if a response
   header was already sent, just aborts.
2. **TLS handshake** if the listener is `tls.Listener` and the conn
   isn't yet handshaken.
3. **Loop reading requests.**
   - Read request line + headers (subject to `ReadHeaderTimeout` and
     `MaxHeaderBytes`).
   - Build `*Request` and `response` (the unexported `ResponseWriter`
     impl).
   - Call `srv.Handler.ServeHTTP(rw, req)`.
   - Drain the request body if the handler didn't.
   - Send the response (write `Content-Length` if known, or
     transfer-encoding chunked, then headers, then body).
   - Decide whether to keep the conn open: HTTP/1.1 + no `Connection:
     close` + body-state OK → loop. Otherwise close.
4. **Close the conn** when the loop ends (peer closed, deadline,
   shutdown, error, etc.).

The `Server.ConnState` hook fires at every state transition:

```go
srv.ConnState = func(c net.Conn, state http.ConnState) {
    // StateNew, StateActive, StateIdle, StateHijacked, StateClosed
}
```

Use it for connection-count gauges, conn-level metrics, or to panic
loudly when conns linger in `StateIdle` longer than `IdleTimeout`
suggests they should.

## 2. The `ResponseWriter` contract — the hidden rules

```go
type ResponseWriter interface {
    Header() Header
    Write([]byte) (int, error)
    WriteHeader(statusCode int)
}
```

What the docs say, with the parts that bite emphasized:

> `Header` returns the header map that will be sent by `WriteHeader`.
> The Header map also is the mechanism with which Handlers can set HTTP
> trailers. **Changing the header map after a call to `WriteHeader` (or
> `Write`) has no effect** unless the modified headers are trailers.

> `Write` writes the data to the connection as part of an HTTP reply.
> If `WriteHeader` has not yet been called, `Write` calls
> `WriteHeader(http.StatusOK)` before writing the data. **If the
> Header does not contain a `Content-Type` line, Write adds a
> `Content-Type` set to the result of passing the initial 512 bytes of
> written data to `DetectContentType`.**

> `WriteHeader` sends an HTTP response header with the provided status
> code. **`WriteHeader` should be called only once per response.**

The five rules:

1. **Headers are committed on the first `Write` or `WriteHeader`.**
   After that, changes to `w.Header()` are silently dropped (with a
   log line). The `Content-Length` is the most common victim — set it
   before any `Write`.
2. **`WriteHeader` is allowed exactly once.** A second call is logged
   with `"http: superfluous response.WriteHeader call"` and ignored.
3. **`Write` auto-detects `Content-Type` if you didn't set it.** This
   sniffs the first 512 bytes via `http.DetectContentType`. For JSON
   responses, set `Content-Type: application/json` *before* `Write`,
   or the sniffer guesses (often correctly, sometimes not).
4. **Trailers are special.** Headers prefixed with `Trailer:` (declared
   in `w.Header()` before `WriteHeader`) can be set after the body is
   written. Only useful with HTTP/1.1 chunked encoding or HTTP/2.
5. **`Write` may flush at any time.** It can split your body across
   multiple TCP packets, including before the response is complete.
   For chunked transfer-encoding, each `Write` is potentially its own
   chunk. For backpressure-sensitive code, use `ResponseController`.

The `Write` return value: `(n, err)`. On error, the conn is broken;
your handler can stop, but writing more won't reach the client. The
server records the error and will close the conn after the handler
returns.

### Write before WriteHeader: what happens

```go
w.Write([]byte("hello"))
// Server has now sent: HTTP/1.1 200 OK
// (with auto-detected Content-Type and either Content-Length or
//  Transfer-Encoding: chunked)
w.WriteHeader(500) // logged "superfluous", ignored
```

The status code is committed on the first byte to the wire. You cannot
"un-200" a response.

## 3. The buffering model

`response` (the unexported impl) has a `bufio.Writer` of 4 KiB by
default. Small writes accumulate; the buffer flushes when it fills,
when the handler returns, or when `Flush` is called.

Implications:

- A handler that writes 10 small JSON responses to the same conn
  doesn't issue 10 syscalls — they batch into one.
- For chunked transfer-encoding, each *flush* is one chunk on the
  wire, not each `Write`. That's why streaming endpoints must call
  `Flush` (or `Flusher.Flush`) explicitly.
- The buffer is sized for typical responses; very large responses
  flush continuously and don't see a benefit.

You can't directly read or change the response buffer from outside. The
server controls it. `ResponseController.Flush` is the public API to
push buffered bytes early.

## 4. `http.Flusher`, `http.Hijacker`, and the legacy assertions

Three optional interfaces a `ResponseWriter` *might* implement:

```go
type Flusher interface  { Flush() }
type Hijacker interface { Hijack() (net.Conn, *bufio.ReadWriter, error) }
type Pusher interface   { Push(target string, opts *PushOptions) error } // HTTP/2
```

The classic check:

```go
if f, ok := w.(http.Flusher); ok { f.Flush() }
```

The pitfall: any wrapper around `ResponseWriter` (your `recordingWriter`
from middle.md, an instrumentation library, a compression wrapper)
breaks the type assertion unless it also implements the interface.
Adding `Flush`/`Hijack` to every wrapper is tedious and error-prone.

### `ResponseController` (Go 1.20+) — the modern fix

```go
rc := http.NewResponseController(w)

if err := rc.Flush(); err != nil { ... }
if err := rc.SetReadDeadline(t); err != nil { ... }
if err := rc.SetWriteDeadline(t); err != nil { ... }
conn, buf, err := rc.Hijack()
```

`ResponseController` walks the unwrap chain — if the outer
`ResponseWriter` has an `Unwrap() ResponseWriter` method, it follows
the chain until it finds a writer that supports the operation.

Wrappers that should compose with `ResponseController` implement
`Unwrap`:

```go
type recordingWriter struct {
    http.ResponseWriter
    status int
}

func (r *recordingWriter) Unwrap() http.ResponseWriter { return r.ResponseWriter }
```

Now `http.NewResponseController(rw).Flush()` walks past `recordingWriter`
to the underlying response. This is the right pattern for new code —
don't bolt `Flush()` and `Hijack()` onto every wrapper by hand.

## 5. `Hijacker` — taking over the conn

```go
hj, ok := w.(http.Hijacker)
if !ok { http.Error(w, "no hijack", 500); return }
conn, buf, err := hj.Hijack()
if err != nil { ... }
defer conn.Close()
```

`Hijack` does several things at once:

1. Stops the server's response machinery for this conn.
2. Returns the underlying `net.Conn`.
3. Returns a `*bufio.ReadWriter` already wrapping the conn — the buffer
   may already contain bytes the server read from the client (from a
   pipelined next request, for instance).
4. The conn moves to `StateHijacked`. The server stops tracking it
   for graceful shutdown.

You're now responsible for:

- Closing the conn.
- Not calling any `ResponseWriter` method after hijack — it'll panic
  or do nothing.
- The buffered bytes in `buf.Reader` — read those before raw conn
  reads, or you'll skip them.

Use cases: WebSocket upgrade, long-lived custom protocols over the
same port, RPC tunneling. After Hijack, `http.Server.Shutdown` cannot
gracefully close the conn — it's not in the server's tracking anymore.

The legacy `http.CloseNotifier` is **deprecated** in Go 1.11+. Use
`r.Context()` instead — it's canceled when the client disconnects.

## 6. Request body — semantics in detail

`r.Body` is an `io.ReadCloser` with these guarantees:

- **It's never nil** for an `http.Request` received by a handler. For
  GET-without-body requests, it's a body that returns EOF on the first
  read.
- **Closing it is optional in handlers.** The server closes it on
  handler return. But closing early frees the conn earlier.
- **Reading short or not at all** prevents the conn from being reused
  for the next request — the server must close the conn.
- **`r.Body.Close()` does not drain.** It just marks the stream
  finished. If you want the conn to be reusable for keep-alive, you
  need to *read to EOF* (or close the conn).

The server has a small per-conn drain budget — it'll read up to a few
KiB after the handler returns to give itself a chance at keep-alive.
For larger pending bodies it just closes.

### `ContentLength` and the body type

| Situation | `r.ContentLength` | `r.Body` |
|-----------|------------------|----------|
| Request with `Content-Length: N` | N | reads exactly N bytes then EOF |
| Request with `Transfer-Encoding: chunked` | -1 | reads until end-of-chunks |
| GET / HEAD with no body | 0 | EOF on first read |
| Request with neither | 0 | EOF on first read |

Don't trust `ContentLength` for size limits — use `MaxBytesReader`,
which works regardless of how the body is framed.

### `r.Body.Close` errors

For HTTP/1.1, closing the body before it's drained signals to the
server that you want the conn closed. For HTTP/2, closing sends a
`RST_STREAM` to abort that single stream while keeping the conn open.

## 7. `MaxBytesReader` — what it actually does

```go
r.Body = http.MaxBytesReader(w, r.Body, max)
```

Three distinct effects:

1. Subsequent `Read` calls return an error (`*MaxBytesError` since Go
   1.19) once the cap is exceeded.
2. The error is returned to the handler — `io.ReadAll` or
   `json.Decoder` propagate it.
3. The `ResponseWriter` is told to close the conn after the response.
   This prevents an attacker from continuing to upload after you
   stopped reading.

```go
var mbe *http.MaxBytesError
if errors.As(err, &mbe) {
    http.Error(w, "request too large", http.StatusRequestEntityTooLarge)
    return
}
```

Without `MaxBytesReader`, an oversized body keeps streaming into the
TCP recv buffer even though your handler returned an error — it can
fill the buffer and stall.

## 8. The `Transport` connection pool

`http.Transport` is the client-side connection pool plus protocol
state machine. Internals worth knowing:

```go
type Transport struct {
    Proxy                  func(*Request) (*url.URL, error)
    DialContext            func(ctx context.Context, network, addr string) (net.Conn, error)
    TLSClientConfig        *tls.Config
    TLSHandshakeTimeout    time.Duration
    DisableKeepAlives      bool
    DisableCompression     bool
    MaxIdleConns           int
    MaxIdleConnsPerHost    int
    MaxConnsPerHost        int
    IdleConnTimeout        time.Duration
    ResponseHeaderTimeout  time.Duration
    ExpectContinueTimeout  time.Duration
    ForceAttemptHTTP2      bool
}
```

The pool is keyed by `(scheme, host:port, proxy, ...)`. Idle conns sit
in two structures:

- A per-key linked list (LRU).
- A global counter and a global limit (`MaxIdleConns`).

`RoundTrip` flow:

1. Pick the connect key.
2. Look for an idle conn for the key. If present and healthy, return.
3. Otherwise, dial. Respects `MaxConnsPerHost` — if N conns are
   already open or pending, the call blocks on a per-host channel.
4. Once the conn is established, write the request, read the response.
5. After the response body is closed, return the conn to the pool
   (subject to `MaxIdleConns` and `MaxIdleConnsPerHost`).

### When conns leave the pool

- `IdleConnTimeout` expires while idle.
- The peer closes (server hit its `IdleTimeout`).
- The conn returned an error — never reused.
- The response body wasn't fully drained — broken framing, can't
  reuse.
- `Transport.CloseIdleConnections()` is called.

The single most common reason for "TIME_WAIT explosion" on HTTP
clients is failing to drain bodies on the error path:

```go
defer resp.Body.Close()
if resp.StatusCode != 200 {
    return fmt.Errorf("status %d", resp.StatusCode) // body not drained
}
```

The conn isn't reusable; every request opens a new conn; ports run out
under load. Always:

```go
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()
```

## 9. `Request.GetBody` and the redirect/retry replay

When a redirect or retry needs to resend the same body, the body must
be re-readable. `*Request.GetBody` is a function that returns a fresh
copy:

```go
type Request struct {
    Body    io.ReadCloser
    GetBody func() (io.ReadCloser, error)
}
```

`http.NewRequest` populates `GetBody` automatically when the body is a
`*bytes.Buffer`, `*bytes.Reader`, or `*strings.Reader` (anything where
the bytes are already in memory). For a `os.File` or `io.Pipe`, it's
nil — and a redirect that requires resending the body fails with
"http: 307 redirect: missing GetBody".

Workaround: read the file/pipe into a buffer first, or set `GetBody`
manually:

```go
data, _ := io.ReadAll(slowSource)
req, _ := http.NewRequest("POST", url, bytes.NewReader(data))
// GetBody is set automatically for bytes.Reader.
```

For one-shot uploads where you don't expect redirects, leave `GetBody`
nil and trust that 200 will arrive without a 307.

## 10. HTTP/2 transparent upgrade

Since Go 1.6, the standard `http.Server` and `http.Transport` support
HTTP/2 transparently when TLS is in use. The triggers:

- Server: ALPN advertises `h2` and `http/1.1`. The client picks `h2`,
  the conn becomes HTTP/2.
- Client: when TLS handshake selects `h2` via ALPN, the response is
  read as HTTP/2.

What this means for handlers:

- `ServeHTTP` is called with a `*Request` whose `r.ProtoMajor == 2`.
- `r.Body` reads from a single HTTP/2 stream (not the conn). Many
  streams can share one conn.
- `Hijack` is *not* supported on HTTP/2 — you get an error. Use
  `Flusher` or full streaming responses instead.
- Server push (`http.Pusher`) is available but most clients (browsers)
  have removed support; it's effectively dead.

To opt out (e.g., disable for compatibility with a buggy client):

```go
srv.TLSNextProto = make(map[string]func(*http.Server, *tls.Conn, http.Handler))
```

This empties the protocol-upgrade map, so ALPN won't pick `h2`.

### h2c — HTTP/2 over cleartext

The default server only does HTTP/2 over TLS. For `h2c` (cleartext
HTTP/2, used by gRPC over plaintext), use
`golang.org/x/net/http2/h2c.NewHandler` to wrap your handler. The
stdlib doesn't enable h2c by default — explicit opt-in.

## 11. Setting per-request timeouts via `ResponseController`

For long-running streams, the server-wide `ReadTimeout` /
`WriteTimeout` are the wrong granularity. Set them to 0 and use:

```go
func stream(w http.ResponseWriter, r *http.Request) {
    rc := http.NewResponseController(w)

    // Short deadline for receiving headers; longer for body.
    rc.SetReadDeadline(time.Now().Add(5 * time.Second))

    // Read the request body...

    rc.SetReadDeadline(time.Time{}) // clear

    rc.SetWriteDeadline(time.Now().Add(60 * time.Second))
    // Stream the response.
}
```

`SetReadDeadline` and `SetWriteDeadline` map to the underlying
`net.Conn`'s deadlines. They reset for each `Read`/`Write` until you
clear them.

## 12. The `Server` panics in handlers, exactly

`http.Server` recovers panics inside `ServeHTTP`. Code:

```go
defer func() {
    if err := recover(); err != nil && err != ErrAbortHandler {
        const size = 64 << 10
        buf := make([]byte, size)
        buf = buf[:runtime.Stack(buf, false)]
        c.server.logf("http: panic serving %v: %v\n%s",
            c.remoteAddr, err, buf)
    }
    if !c.hijacked() {
        c.close()
    }
}()
```

What it doesn't do:

- Doesn't call your error tracker. Add your own recovery middleware.
- Doesn't write a response — if no response was started, the client
  sees the conn close mid-request. With your own recovery middleware,
  you can write a clean 500.

`http.ErrAbortHandler` is the special panic value the server treats as
"silent abort" — no log, no response. Useful when middleware decides
to terminate the request without responding (the response-writer is
already in some weird state).

```go
panic(http.ErrAbortHandler)
```

This is the only sanctioned way to abort a handler from deep in a call
stack without unwinding. Almost no application code should use it.

## 13. The `Server.ConnState` hook

```go
srv.ConnState = func(c net.Conn, state http.ConnState) {
    switch state {
    case http.StateNew:    activeConns.Add(1)
    case http.StateClosed: activeConns.Add(-1)
    }
}
```

States, in order:

1. **`StateNew`** — TCP accept just happened, before any bytes.
2. **`StateActive`** — first byte arrived, request is being read.
3. **`StateIdle`** — handler returned, conn is in keep-alive idle.
4. **`StateActive`** again on the next request, or `StateClosed`.
5. **`StateHijacked`** — `Hijack()` was called.
6. **`StateClosed`** — terminal.

Use `ConnState` for accurate conn-level metrics. Don't do heavy work
in the callback; it runs in the conn goroutine and blocks request
processing.

## 14. Custom `RoundTripper`

```go
type RoundTripper interface {
    RoundTrip(*Request) (*Response, error)
}
```

This is what `http.Client` calls. Wrap `http.Transport` for
client-side middleware:

```go
type loggingTransport struct{ rt http.RoundTripper }

func (l *loggingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
    start := time.Now()
    resp, err := l.rt.RoundTrip(r)
    log.Printf("%s %s %v err=%v", r.Method, r.URL, time.Since(start), err)
    return resp, err
}

client := &http.Client{
    Transport: &loggingTransport{rt: http.DefaultTransport},
}
```

The contract for `RoundTrip` is strict:

1. **Don't modify the `Request`.** Specifically don't modify
   `r.Header` or `r.URL`. If you need to change them, clone with
   `r.Clone(ctx)`.
2. **Don't read or close the request body if it's `nil`.** Some
   GET/HEAD requests have nil bodies.
3. **On success, return a non-nil `Response`** whose `Body` reads the
   response. The caller closes it.
4. **On error, the body must be nil-or-closed.** A non-nil response
   with a non-nil body is leaking.

For retries, see professional.md.

## 15. The `Request.Clone` method

To pass a request to multiple consumers (e.g., race two backends):

```go
ctx := r.Context()
r1 := r.Clone(ctx)
r2 := r.Clone(ctx)
```

`Clone` deep-copies headers, the URL, and metadata. It does *not*
copy the body — the body is still a single stream that one consumer
will drain. For requests with bodies that need to be re-sent, use
`GetBody`.

## 16. HTTP smuggling and the request-line size

HTTP smuggling occurs when a frontend and a backend disagree on where
one request ends and the next begins. Common vectors:

- `Content-Length` and `Transfer-Encoding: chunked` both present —
  some servers prefer one, some the other.
- A space in the request line.
- An unfolded header line.

Go's `http.Server` rejects most of these with strict parsing. The
defaults to know:

- `Content-Length` and `Transfer-Encoding` together: the server
  drops `Content-Length` and uses chunked, per RFC 7230.
- Headers split across multiple lines with continuation (deprecated
  by RFC 7230) are rejected.
- The first line is bounded by `MaxHeaderBytes` (with the headers).
  Default 1 MiB; lower it.

For frontend-backend pairs (nginx + Go, ALB + Go), set the same parser
strictness on both. Mixed strictness is the foothold.

## 17. The body-write contract on the server

```go
func handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Length", "5")
    w.WriteHeader(200)
    w.Write([]byte("hello world")) // 11 bytes!
}
```

What happens: the server has committed `Content-Length: 5`. Subsequent
`Write` calls are *truncated* — the server lets you write 5 bytes,
silently drops the rest, and logs nothing. The client sees
`"hello"` and a clean conn.

Don't set `Content-Length` manually unless you know it. The default
behavior — let the server compute it from the buffered output, or
fall back to chunked — is correct.

The mirror case: under-writing.

```go
w.Header().Set("Content-Length", "100")
w.WriteHeader(200)
w.Write([]byte("short")) // 5 bytes; handler returns
```

The server sends 5 bytes, then closes the conn (because the framing is
broken — it can't keep-alive on a partial response). The client sees
"short" plus a connection close, which most clients treat as an
error.

## 18. `http.Server.BaseContext` and `ConnContext`

```go
srv := &http.Server{
    BaseContext: func(_ net.Listener) context.Context {
        // Return a context that's canceled at server shutdown.
        return baseCtx
    },
    ConnContext: func(ctx context.Context, c net.Conn) context.Context {
        // Add per-conn values (remote addr, TLS info).
        return context.WithValue(ctx, connKey, c.RemoteAddr())
    },
}
```

`BaseContext` is the context every request starts from. By default
it's `context.Background()`. Set it to a context tied to your shutdown
signal so handlers can observe global cancellation.

`ConnContext` runs once per accepted conn and lets you attach
per-conn metadata that all requests on that conn inherit (TLS handshake
result, peer cert, conn-id).

## 19. Pitfalls collected

| Pitfall | What goes wrong |
|---------|-----------------|
| Wrapping `ResponseWriter` without `Unwrap` | `Flusher`/`Hijacker` type assertions in middleware silently fail |
| Setting headers after `Write` | Silently dropped; logged at debug level |
| Reading `r.Body` after the handler returns | Body is closed; reads return error |
| Using `DefaultClient` / `DefaultTransport` in libraries | Pool collides with the application's pool |
| Calling `Hijack` on HTTP/2 | Returns error; HTTP/2 has no equivalent |
| `defer cancel()` after returning from handler | Context already canceled by server; cancel is a no-op |
| Setting `Content-Length` manually | Truncates over-sized writes silently |
| Forgetting `MaxBytesReader` on uploads | Trivial OOM DoS |
| Reusing `Request` across goroutines without `Clone` | Header mutations race |
| Calling `(*http.Server).Close` instead of `Shutdown` | In-flight handlers killed mid-write |
| `Transport.MaxIdleConnsPerHost = 0` (left default) | Default of 2 is too low for service-to-service |

## 20. Cross-references

- [`../10-net/senior.md`](../10-net/senior.md) — `net.Conn` deadlines
  that drive every HTTP timeout.
- [`../03-time/`](../03-time/junior.md) — the timer wheel behind deadlines.
- [`../05-os/senior.md`](../05-os/senior.md) — `signal.NotifyContext`
  for shutdown, fd limits.
- [`../13-crypto/`](../13-crypto/junior.md) — `tls.Config` for the server, ALPN
  negotiation, certificate reload.
- [`../01-io-and-file-handling/senior.md`](../01-io-and-file-handling/senior.md) —
  body draining, `Close` semantics that apply to `r.Body` and
  `resp.Body`.

## 21. What to read next

- [professional.md](professional.md) — reverse proxy patterns,
  certificate hot-reload, retries, `httptrace`, observability.
- [specification.md](specification.md) — the formal contracts
  distilled to a one-pager.
- [optimize.md](optimize.md) — when the contract is correct but the
  performance isn't.
- [find-bug.md](find-bug.md) — drills targeting items in this file.
