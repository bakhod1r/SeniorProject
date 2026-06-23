# 8.11 `net/http` Internals — Middle

> **Audience.** You're comfortable with [junior.md](junior.md) and you
> ship Go services that talk HTTP both ways. This file covers the
> server timeouts in detail, the middleware patterns you actually
> reach for, graceful shutdown, the client `Transport` and pool
> tuning, multipart, file uploads, and context propagation — the
> day-job material between "it works" and "it survives load."

## 1. The five timeouts on `http.Server`

```go
srv := &http.Server{
    Addr:              ":8080",
    Handler:           mux,
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       30 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       120 * time.Second,
    MaxHeaderBytes:    1 << 14, // 16 KiB
}
```

What each one actually controls:

| Field | What it bounds |
|-------|----------------|
| `ReadHeaderTimeout` | Time from accept to end-of-request-headers |
| `ReadTimeout` | Time from accept to end-of-request-body |
| `WriteTimeout` | Time from end-of-headers to response sent |
| `IdleTimeout` | Time between requests on a keep-alive conn |
| `MaxHeaderBytes` | Cap on the size of request line + headers |

`ReadHeaderTimeout` is the slow-loris defense. Without it, a peer can
send one byte every 29 seconds for a year and stay connected. Set it to
single-digit seconds; legitimate clients send headers in milliseconds.

`ReadTimeout` covers headers *and* body. If your handler streams a
large upload, this timeout fires while the upload is in progress. For
streaming endpoints, set `ReadTimeout` to 0 and use
`ResponseController.SetReadDeadline` per request to manage it
explicitly (covered in senior.md).

`WriteTimeout` is similarly per-request — but the timer starts when the
request body is fully read, *not* when the request was accepted. For
long-running responses, the same trick applies: set `WriteTimeout: 0`
and manage with `ResponseController`.

`IdleTimeout` defaults to `ReadTimeout` if zero. Set it to your reverse
proxy's keepalive interval plus a margin (typically 60–120s).

`MaxHeaderBytes` defaults to 1 MiB, which is huge. 16 KiB is plenty for
any legitimate HTTP/1.1 request and protects you from slowloris-style
header floods.

## 2. Why timeouts matter — the math

A server with no `ReadHeaderTimeout` and 1024 max conns can be DoS'd by
1024 slow-loris connections that never finish a request. Each one
holds a goroutine, a TCP socket, and a file descriptor.

With `ReadHeaderTimeout = 5s`, the same attacker can hold 1024 conns
for at most 5 seconds before they get closed and recycled. The attack
becomes a 1024-slot game with 5-second turns, which is much harder to
sustain.

The same logic applies to slow body uploads (`ReadTimeout`) and slow
response readers (`WriteTimeout`). Every blocking I/O op needs a
deadline; the server timeouts are the "default deadline" for the
common cases.

## 3. Graceful shutdown

```go
ctx, stop := signal.NotifyContext(context.Background(),
    os.Interrupt, syscall.SIGTERM)
defer stop()

srv := &http.Server{Addr: ":8080", Handler: mux}

go func() {
    if err := srv.ListenAndServe(); err != nil &&
        !errors.Is(err, http.ErrServerClosed) {
        log.Fatal(err)
    }
}()

<-ctx.Done()

shutdownCtx, cancel := context.WithTimeout(context.Background(),
    30*time.Second)
defer cancel()

if err := srv.Shutdown(shutdownCtx); err != nil {
    log.Printf("shutdown: %v", err)
}
```

What `Shutdown` does, in order:

1. Closes all listeners — no new conns accepted.
2. Closes all idle conns — they're not in a request, no harm.
3. Waits for active handlers to return.
4. When all handlers have returned (or `shutdownCtx` is canceled),
   it returns.

`ListenAndServe` returns `http.ErrServerClosed` when `Shutdown` is
called cleanly. Treat that as success, not an error.

If `shutdownCtx` expires first, `Shutdown` returns the context error
and any handlers still running keep running — your process exits with
them mid-flight. The 30-second budget above is what most services
use; trim it if your handlers should never take that long, raise it
if you have legitimate long-running streams.

`http.Server.Close()` is the hard kill: closes everything including
in-flight conns immediately. Use it as a last resort if `Shutdown`
won't return.

### `RegisterOnShutdown`

```go
srv.RegisterOnShutdown(func() {
    // Close the WebSocket-like long-poll fan-out so handlers can return.
    cancelAllSubscriptions()
})
```

`RegisterOnShutdown` runs callbacks at the start of `Shutdown`, before
it waits for handlers. Use it to release resources that long-running
handlers are blocked on — without this, `Shutdown` waits forever for
handlers that won't return on their own.

## 4. The middleware pattern in production

The wrapper-handler pattern from junior.md, formalized:

```go
type Middleware func(http.Handler) http.Handler

func chain(h http.Handler, m ...Middleware) http.Handler {
    for i := len(m) - 1; i >= 0; i-- {
        h = m[i](h)
    }
    return h
}

handler := chain(myHandler, recoverPanic, logRequests, authRequired, rateLimit)
```

Middleware order matters and is the source of subtle bugs:

- **Recovery first (outermost).** If anything below panics, recovery
  catches it. Putting recovery inside `logRequests` means a panic
  bypasses your access logs.
- **Logging next.** You want every request logged, including ones that
  authentication rejects.
- **Authentication, authorization, rate limiting.** In that order.
- **Your handler last.** It runs once auth and limits have approved.

A canonical recovery middleware:

```go
func recoverPanic(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic: %v\n%s", rec, debug.Stack())
                http.Error(w, "internal error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

The stdlib `http.Server` does its *own* per-conn recovery — a panicked
handler doesn't crash the process. But the stdlib's recovery just logs
the stack trace and aborts the response (sending a partial response to
the client). Your own middleware lets you control the response and
report to your error tracker.

## 5. Capturing the response status from middleware

Middleware that wants to log the status code needs to wrap
`ResponseWriter`. The recipe:

```go
type recordingWriter struct {
    http.ResponseWriter
    status  int
    written int64
}

func (r *recordingWriter) WriteHeader(code int) {
    r.status = code
    r.ResponseWriter.WriteHeader(code)
}

func (r *recordingWriter) Write(b []byte) (int, error) {
    if r.status == 0 {
        r.status = http.StatusOK
    }
    n, err := r.ResponseWriter.Write(b)
    r.written += int64(n)
    return n, err
}

func logRequests(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        rw := &recordingWriter{ResponseWriter: w}
        next.ServeHTTP(rw, r)
        log.Printf("%s %s %d %d %v",
            r.Method, r.URL.Path, rw.status, rw.written, time.Since(start))
    })
}
```

Two pitfalls baked into this:

1. **`Write` may run without `WriteHeader`.** Default 200. Cover that
   case.
2. **Wrapping `ResponseWriter` hides interface methods.** `Hijacker`,
   `Flusher`, `Pusher` — all of them disappear because Go interface
   satisfaction goes by method set. We'll fix this in senior.md with
   `http.ResponseController`.

## 6. Context propagation through the request

Every `*http.Request` has a `Context()`. The server cancels it when:

- The client disconnects (TCP RST or FIN).
- The handler returns.
- The server is shut down.

Pass that context to every downstream call:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()

    // Database call respects the context.
    rows, err := db.QueryContext(ctx, "SELECT ...")
    if err != nil { ... }

    // Outbound HTTP respects it.
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    resp, err := httpClient.Do(req)
    ...
}
```

If you want a per-handler timeout, derive it:

```go
ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
defer cancel()
```

Now the downstream call dies after 5 seconds *or* when the client
disconnects, whichever comes first.

### Adding values to the context

```go
type ctxKey struct{ name string }

var userKey = &ctxKey{"user"}

func authRequired(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        user, err := authenticate(r)
        if err != nil {
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }
        ctx := context.WithValue(r.Context(), userKey, user)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

func currentUser(r *http.Request) *User {
    u, _ := r.Context().Value(userKey).(*User)
    return u
}
```

Two rules:

1. **Use a private key type.** Never use `string` or untyped values as
   context keys — they collide silently across packages. The `ctxKey`
   struct above is a typed sentinel.
2. **Context values are for request-scoped, immutable data.** Auth
   identity, request ID, tenant. Not configuration. Not loggers
   (mostly). Not anything that changes during the request.

## 7. The `http.Client` and its `Transport`

```go
client := &http.Client{
    Timeout: 10 * time.Second,
    Transport: &http.Transport{
        MaxIdleConns:          100,
        MaxIdleConnsPerHost:   10,
        MaxConnsPerHost:       0, // unlimited
        IdleConnTimeout:       90 * time.Second,
        TLSHandshakeTimeout:   10 * time.Second,
        ExpectContinueTimeout: 1 * time.Second,
        DialContext: (&net.Dialer{
            Timeout:   5 * time.Second,
            KeepAlive: 30 * time.Second,
        }).DialContext,
    },
}
```

`http.DefaultTransport` already sets reasonable defaults. The fields you
override most often:

| Field | What it controls |
|-------|------------------|
| `MaxIdleConns` | Total idle conns kept across all hosts |
| `MaxIdleConnsPerHost` | Idle conns per host (default: 2 — too low) |
| `MaxConnsPerHost` | Total conns per host (default: 0 = unlimited) |
| `IdleConnTimeout` | Max time an idle conn sits in the pool |
| `DisableKeepAlives` | Force a fresh conn per request (almost never set true) |

The default `MaxIdleConnsPerHost` of 2 is too low for service-to-service
traffic. With heavy load, you'll open a new conn for every third
request. Bump it to 10 or higher for backends you talk to often.

`MaxConnsPerHost` is the upper bound. When reached, additional `Do`
calls block until a conn is free. Set it to bound your impact on a
single backend (or to match the backend's accept queue depth).

### `Client.Timeout` covers everything

```go
client := &http.Client{Timeout: 10 * time.Second}
```

This timer covers:

- Dial
- TLS handshake
- Request write
- Response headers read
- Response body read

If any step takes longer in total than 10 seconds, the client cancels
the request. This is different from setting per-step timeouts on
`Transport` — `Client.Timeout` is the wall-clock budget.

For per-request budgets, prefer `http.NewRequestWithContext(ctx, ...)`
with a context deadline. `Client.Timeout` becomes the global cap; the
context gives you per-call control.

## 8. Reuse one client across the program

`*http.Client`, `*http.Transport`, and `*http.Server` are all safe for
concurrent use. Create them once at startup and share them.

```go
var httpClient = &http.Client{
    Timeout:   10 * time.Second,
    Transport: &http.Transport{ /* ... */ },
}
```

The reason: `Transport` maintains the connection pool. Each new
`Transport` has its own pool. If every function creates its own
`Client`, you have N pools that don't share conns — you might as well
have `DisableKeepAlives = true`.

## 9. Multipart and file uploads

Browsers and `curl -F` send file uploads as `multipart/form-data`. Go
handles them via `r.ParseMultipartForm`:

```go
func upload(w http.ResponseWriter, r *http.Request) {
    // 32 MiB in memory; spill to disk for larger.
    if err := r.ParseMultipartForm(32 << 20); err != nil {
        http.Error(w, "bad form", http.StatusBadRequest)
        return
    }
    file, header, err := r.FormFile("photo")
    if err != nil {
        http.Error(w, "no file", http.StatusBadRequest)
        return
    }
    defer file.Close()

    log.Printf("uploaded %s (%d bytes)", header.Filename, header.Size)

    dst, err := os.Create("/uploads/" + filepath.Base(header.Filename))
    if err != nil { ... }
    defer dst.Close()

    if _, err := io.Copy(dst, file); err != nil { ... }
}
```

The argument to `ParseMultipartForm` is the in-memory cap. Files larger
than this are spilled to a temporary file in `os.TempDir()`. On the
return path, those temp files are cleaned up by the server when the
request ends.

For streaming uploads (no buffering), use `r.MultipartReader` directly:

```go
mr, err := r.MultipartReader()
if err != nil { ... }
for {
    part, err := mr.NextPart()
    if errors.Is(err, io.EOF) { break }
    if err != nil { ... }
    // part is an io.ReadCloser; stream it somewhere.
    io.Copy(dst, part)
    part.Close()
}
```

`MultipartReader` is one-shot; it's incompatible with `ParseMultipartForm`
(you pick one or the other). Use it for very large uploads where you
can't tolerate the memory or disk hit.

**Always cap the total request size with `MaxBytesReader`** before
parsing. `ParseMultipartForm` doesn't bound the total — only the
in-memory portion.

## 10. `http.HandlerFunc` vs `http.Handler` in middleware signatures

A subtle but common pitfall:

```go
// Middleware that accepts http.Handler.
func auth(next http.Handler) http.Handler { ... }

// Adapt a function:
mux.Handle("/", auth(http.HandlerFunc(myFunc)))

// Or take http.HandlerFunc:
func authFn(next http.HandlerFunc) http.HandlerFunc { ... }
mux.Handle("/", authFn(myFunc))
```

The `Handler` interface is more general — your middleware can wrap
any `Handler`, not just functions. The `HandlerFunc` form requires
fewer adapters at call sites but works only with functions.

Most middleware libraries pick `Handler` for the broader API. Either
is fine; pick one and stay consistent.

## 11. Streaming responses with `http.Flusher`

For server-sent events or chunked progress reports, the response can't
be buffered to the end:

```go
func events(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.WriteHeader(http.StatusOK)

    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming unsupported", http.StatusInternalServerError)
        return
    }

    for i := 0; i < 10; i++ {
        select {
        case <-r.Context().Done():
            return
        default:
        }
        fmt.Fprintf(w, "data: tick %d\n\n", i)
        flusher.Flush()
        time.Sleep(time.Second)
    }
}
```

`Flush` pushes any buffered data to the client immediately. Without
it, the response sits in the server's buffer until the handler returns
or the buffer fills.

Three rules for streaming endpoints:

1. **Set `WriteTimeout: 0`** on the server (it'd kill long streams).
   Use `ResponseController` for per-stream timeouts.
2. **Watch `r.Context().Done()`** — without it, you keep writing to a
   disconnected client and waste cycles.
3. **`Flusher` is optional in the interface.** A wrapped
   `ResponseWriter` (e.g., your `recordingWriter`) might not implement
   it. Use `ResponseController` (covered in senior.md) for the safe
   call.

## 12. `httptest.NewServer` for integration tests

```go
func TestUpload(t *testing.T) {
    handler := http.HandlerFunc(upload)
    srv := httptest.NewServer(handler)
    defer srv.Close()

    body := strings.NewReader("file content")
    resp, err := http.Post(srv.URL+"/upload", "text/plain", body)
    if err != nil { t.Fatal(err) }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        t.Errorf("got %d", resp.StatusCode)
    }
}
```

`NewServer` spins up a real HTTP server on a random port. Tests can hit
it with the real client. Pair with `srv.Close()` on teardown.

`httptest.NewRecorder` is faster but less faithful — it implements
`ResponseWriter` with a buffer:

```go
func TestHandler(t *testing.T) {
    req := httptest.NewRequest("GET", "/health", nil)
    rec := httptest.NewRecorder()
    handler.ServeHTTP(rec, req)
    if rec.Code != 200 {
        t.Errorf("status = %d", rec.Code)
    }
}
```

`Recorder` doesn't run the full HTTP machinery — no real listener, no
real conn, no timeouts. For unit tests of handlers, that's a feature.
For integration tests of middleware that depends on real HTTP framing,
use `NewServer`.

## 13. Custom errors: returning JSON

`http.Error` writes `text/plain`. For JSON APIs, write your own
helper:

```go
func writeJSON(w http.ResponseWriter, code int, v any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(code)
    json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
    writeJSON(w, code, map[string]string{"error": msg})
}
```

Use these in handlers:

```go
if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
    writeError(w, http.StatusBadRequest, "invalid json")
    return
}
```

For larger applications, a typed error response with structured fields
(`code`, `message`, `details`) is worth the consistency.

## 14. Reverse-proxying with `httputil.ReverseProxy`

```go
target, _ := url.Parse("http://backend:8080")
proxy := httputil.NewSingleHostReverseProxy(target)
mux.Handle("/api/", proxy)
```

`ReverseProxy` is a `Handler` that forwards requests to another
backend. It handles:

- Copying request headers (with hop-by-hop filtering).
- Streaming the request body to the backend.
- Streaming the response body back.
- Handling errors from the backend.

For most apps, `NewSingleHostReverseProxy` is enough. Customize with
`Director`, `ModifyResponse`, and `ErrorHandler` for richer cases —
covered in professional.md.

## 15. Cross-references

- [`../10-net/middle.md`](../10-net/middle.md) — `Listener`, `Conn`,
  deadlines that the HTTP server uses.
- [`../03-time/`](../03-time/junior.md) — `time.AfterFunc` and the timer wheel
  that powers HTTP server timeouts.
- [`../04-encoding-json/`](../04-encoding-json/junior.md) — `json.Decoder` and
  `Encoder` for streaming bodies.
- [`../05-os/`](../05-os/junior.md) — `signal.NotifyContext` for graceful
  shutdown.
- [`../01-io-and-file-handling/middle.md`](../01-io-and-file-handling/middle.md) —
  `io.Pipe` for streaming uploads, body draining patterns.

## 16. What to read next

- [senior.md](senior.md) — the precise per-conn lifecycle, the
  `ResponseWriter` and `ResponseController` contract, `Hijacker`,
  HTTP/2 transparent upgrade, the Transport pool internals.
- [professional.md](professional.md) — reverse-proxy patterns,
  certificate hot-reload, custom `RoundTripper`, retries and backoff,
  `httptrace`, observability.
- [find-bug.md](find-bug.md) — drills based on the bugs in this file.
