# 8.11 `net/http` Internals — Specification

> A one-page reference for the contracts that govern `net/http`. The
> sections below are the rules; the longer files in this leaf are
> the explanations.

## 1. `Handler` interface

```go
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}
```

Rules:

1. `ServeHTTP` runs in a goroutine owned by the server (one per
   conn).
2. The server recovers panics from `ServeHTTP`. A panic of
   `http.ErrAbortHandler` is silent; any other value is logged with a
   stack trace.
3. `ServeHTTP` should not retain `r` or `w` past return.
4. The server may have already started writing the response when
   `ServeHTTP` returns; do not call methods on `w` after return.

## 2. `ResponseWriter` interface

```go
type ResponseWriter interface {
    Header() Header
    Write([]byte) (int, error)
    WriteHeader(statusCode int)
}
```

Rules:

1. `Header()` returns a map valid for setting headers until the first
   `Write` or `WriteHeader`. After commit, mutations are silently
   ignored except for trailers.
2. `WriteHeader` may be called at most once. Subsequent calls are
   logged ("superfluous WriteHeader") and ignored.
3. The first `Write` calls `WriteHeader(http.StatusOK)` if not yet
   called.
4. `Write` may auto-set `Content-Type` from the first 512 bytes via
   `DetectContentType` if not already set.
5. `Write` returns an error if the conn is broken; the handler should
   stop writing but continue normally otherwise.
6. Status codes 1xx (except 101) are interim and may be written
   multiple times via `Write1xx` / `WriteHeader` (Go 1.21+).
7. After hijack, `Write`/`WriteHeader`/`Header` panic or no-op; do not
   call them.

## 3. `Request` semantics

| Field | Lifecycle |
|-------|-----------|
| `Method`, `URL`, `Proto*` | Set by server, immutable for handler |
| `Header` | Read-only (changing has no effect) |
| `Body` | `io.ReadCloser`, never nil; closed by server on return |
| `ContentLength` | -1 = chunked; 0 = empty; N = framed |
| `Form`, `PostForm` | Populated by `ParseForm`/`ParseMultipartForm` |
| `MultipartForm` | Populated by `ParseMultipartForm` |
| `RemoteAddr` | `"ip:port"`, set by server |
| `RequestURI` | Raw URI from request line; do not mutate |
| `TLS` | Non-nil if conn is TLS |
| `ctx` | Canceled when client disconnects, handler returns, or server shuts down |

Rules:

1. The handler should not modify `r`. To pass a modified copy, use
   `r.Clone(ctx)` or `r.WithContext(ctx)`.
2. Reading `r.Body` past handler return returns an error; reads
   inside the handler may block on the network.
3. `r.ParseForm` may be called multiple times; subsequent calls are
   no-ops.
4. `r.ParseMultipartForm(maxMem)` reads at most `maxMem` into
   memory; the rest spills to a temp file in `os.TempDir`.

## 4. `Server` configuration

```go
type Server struct {
    Addr              string
    Handler           Handler
    TLSConfig         *tls.Config
    ReadTimeout       time.Duration
    ReadHeaderTimeout time.Duration
    WriteTimeout      time.Duration
    IdleTimeout       time.Duration
    MaxHeaderBytes    int
    TLSNextProto      map[string]func(*Server, *tls.Conn, Handler)
    ConnState         func(net.Conn, ConnState)
    BaseContext       func(net.Listener) context.Context
    ConnContext       func(ctx context.Context, c net.Conn) context.Context
    ErrorLog          *log.Logger
    DisableGeneralOptionsHandler bool
}
```

Defaults:

| Field | Default |
|-------|---------|
| `ReadTimeout` | 0 (no limit) |
| `ReadHeaderTimeout` | 0 (no limit) |
| `WriteTimeout` | 0 (no limit) |
| `IdleTimeout` | falls back to `ReadTimeout` |
| `MaxHeaderBytes` | `DefaultMaxHeaderBytes` = 1 << 20 (1 MiB) |
| `TLSConfig` | nil |
| `BaseContext` | `context.Background` |

Lifecycle methods:

| Method | Behavior |
|--------|----------|
| `ListenAndServe` | Listen on `Addr`, call `Serve` |
| `ListenAndServeTLS` | Same with TLS |
| `Serve(ln)` | Accept loop on existing listener |
| `Shutdown(ctx)` | Stop new accepts, close idle conns, wait for active handlers up to `ctx` deadline |
| `Close` | Hard close: kills in-flight conns immediately |
| `RegisterOnShutdown(fn)` | Adds a callback run at start of `Shutdown` |

`ListenAndServe` returns `http.ErrServerClosed` after `Shutdown` —
treat as success.

## 5. `ConnState` transitions

```
StateNew → StateActive ⇄ StateIdle → StateClosed
                    ↘ StateHijacked → (terminal)
```

| State | Triggered by |
|-------|--------------|
| `StateNew` | conn accepted, before any bytes |
| `StateActive` | first byte of request received |
| `StateIdle` | handler returned, conn in keep-alive |
| `StateHijacked` | `Hijack()` called |
| `StateClosed` | conn closed for any reason |

`ConnState` callback runs in the conn goroutine; do not block.

## 6. `Client` and `Transport`

`Client.Timeout`: total wall-clock budget covering dial, TLS, request
write, response headers, response body. Zero = no timeout.

`Transport` pool keys: `(scheme, host:port, proxyURL, isH2)`. Idle
conns recycled per LRU.

| Field | Default | Effect |
|-------|---------|--------|
| `MaxIdleConns` | 100 | Total idle conns across all keys |
| `MaxIdleConnsPerHost` | 2 | Idle conns per key |
| `MaxConnsPerHost` | 0 (∞) | Total conns per key |
| `IdleConnTimeout` | 90s | Max time idle in pool |
| `TLSHandshakeTimeout` | 10s | Per-handshake cap |
| `ResponseHeaderTimeout` | 0 | Time from request-write to response-headers |
| `ExpectContinueTimeout` | 1s | Wait for `100 Continue` |
| `DisableKeepAlives` | false | Force one-shot conns |
| `DisableCompression` | false | Disable transparent gzip |
| `ForceAttemptHTTP2` | true (default) | Try HTTP/2 over TLS |

`RoundTripper` contract:

1. Do not modify the input `Request`.
2. On nil error, return non-nil `Response` whose `Body` reads the
   response. Caller closes `Body`.
3. On non-nil error, return nil `Response`, or a non-nil `Response`
   with closed-or-nil `Body`.
4. Honor `req.Context()` for cancellation.

## 7. Body framing

Server sends one of:

- `Content-Length: N` — exactly N body bytes follow.
- `Transfer-Encoding: chunked` — chunks until terminating zero-length
  chunk.
- `Connection: close` — body until conn closes.

Server picks based on:

- Handler set `Content-Length` header → use that (subject to truncation
  rules).
- Handler `Write` returned for the entire response before flush →
  compute and set `Content-Length`.
- Handler streams (multiple flushes) → chunked.
- HTTP/1.0 → `Connection: close`.

## 8. Optional `ResponseWriter` interfaces

| Interface | Method | Purpose |
|-----------|--------|---------|
| `Flusher` | `Flush()` | Push buffered output to client |
| `Hijacker` | `Hijack()` | Take ownership of conn (HTTP/1 only) |
| `Pusher` | `Push(target, opts)` | HTTP/2 server push (deprecated) |
| `CloseNotifier` | `CloseNotify()` | **Deprecated.** Use `r.Context().Done()` |

`http.NewResponseController(w)` is the modern, wrapper-safe way to
call these. Wrappers should implement `Unwrap() ResponseWriter` so
the controller can find the underlying writer.

## 9. `MaxBytesReader`

```go
r.Body = http.MaxBytesReader(w, r.Body, max)
```

- Subsequent reads return `*MaxBytesError` once `max` is exceeded.
- The underlying conn is marked for close on response complete.

## 10. `ServeMux` (Go 1.22+) pattern syntax

`[METHOD] [HOST]/[PATH]`

| Element | Form | Effect |
|---------|------|--------|
| METHOD | `GET `, `POST `, `*` | Restrict by method (omitted = any) |
| HOST | `api.example.com/` | Restrict by `Host:` header |
| PATH segment | literal | Exact match |
| PATH segment | `{name}` | Captures one segment |
| PATH suffix | `{name...}` | Captures rest of path |
| PATH suffix | `/` | Subtree (matches itself + descendants) |
| PATH suffix | `{$}` | Exact match (no subtree) |

Conflicting patterns at registration → panic.

## 11. Hop-by-hop headers (RFC 7230)

Stripped by `ReverseProxy` automatically:

- `Connection`
- `Keep-Alive`
- `Proxy-Authenticate`
- `Proxy-Authorization`
- `Te`
- `Trailers`
- `Transfer-Encoding`
- `Upgrade`

Plus any header name listed in `Connection:`.

## 12. Errors and sentinels

| Sentinel | Meaning |
|----------|---------|
| `http.ErrServerClosed` | `Server.Serve` exited because `Shutdown`/`Close` was called |
| `http.ErrAbortHandler` | Panic value to terminate handler silently |
| `http.ErrBodyNotAllowed` | `Write` on a 1xx/204/304 response |
| `http.ErrHijacked` | Method called on a hijacked conn |
| `http.ErrContentLength` | More bytes written than declared `Content-Length` |
| `http.ErrUseLastResponse` | `CheckRedirect` returns this to stop following redirects |
| `*http.MaxBytesError` | Body exceeded `MaxBytesReader` cap |
| `*url.Error` | Wraps client-side errors with Op + URL |

## 13. `Request.Context` cancellation triggers

The context is canceled when **any** of:

- The client closes the conn (TCP RST/FIN).
- The handler returns.
- The server is `Shutdown` or `Close`d.
- A `BaseContext` ancestor is canceled.

Handlers that propagate the context to downstream calls (DB, HTTP)
get cancellation for free.

## 14. Cross-references

- [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md),
  [professional.md](professional.md) — narrative coverage of the
  rules above.
- [`../10-net/specification.md`](../10-net/specification.md) — the
  underlying `Conn` and `Listener` rules.
