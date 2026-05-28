# `net/http` — Specification

## 1. Introduction

`net/http` is the Go standard library's HTTP/1.1 and HTTP/2 implementation: client, server, transport, multiplexer, header model, cookie jar, and the surrounding utilities. The package implements substantial parts of more than a dozen IETF RFCs — message syntax, semantics, the HTTP/2 binary framing layer, cookies, basic caching directives, ALPN negotiation, and several adjacent specifications. None of those RFCs is the document a Go developer reads to predict behaviour. The practical specification of `net/http` is the package itself: the stable types, the documented method signatures, the Go 1 compatibility promise that pins them, and the source files under `src/net/http/` in the Go tree.

This is unusual. Most "specifications" for an HTTP library cite the wire-level RFC and treat the implementation as one of several conforming candidates. With `net/http`, the implementation *is* the contract that production code depends on. The RFCs constrain what the package may do on the wire; the package's exported API — and its documented behaviour around shutdown, redirects, connection pooling, idempotent retries, and HTTP/2 negotiation — constrains what application code may rely on. Both layers matter, but the second is the one Go programmers must internalise.

The framing of this document follows that priority. The wire RFCs are listed for completeness in Section 2; the bulk of the specification — Sections 5 through 12 — describes the stdlib types, their contracts, and the GODEBUG knobs that toggle behaviour at runtime. Section 13 names the source files that hold the authoritative implementation for each subsystem so that a reader pursuing a specific behaviour can go straight to the code.

---

## 2. RFCs implemented

`net/http` is not a verified implementation of any single RFC; it tracks a moving target across several. The packages whose implementation falls within `net/http` itself or within `golang.org/x/net/http2` and related supporting modules cover:

| RFC | Title | Coverage in `net/http` |
|-----|-------|------------------------|
| **RFC 9110** | HTTP Semantics | Methods, status codes, header semantics, conditional requests, range requests, content negotiation. Replaces RFC 7230–7235. |
| **RFC 9111** | HTTP Caching | Cache-Control parsing for client-side reuse via the `Transport`; full caching layer is not provided — `net/http` does not implement a response cache by default. |
| **RFC 9112** | HTTP/1.1 Message Syntax | Wire-level parsing of request and response messages, chunked transfer encoding, persistent connection management, request smuggling defences. Replaces RFC 7230. |
| **RFC 7540** | HTTP/2 | Binary framing, multiplexing, HPACK header compression, stream lifecycle, flow control, server push (server push is opt-in client side and deprecated by browsers). Implemented in `golang.org/x/net/http2` and vendored into the stdlib. |
| **RFC 9113** | HTTP/2 (revised) | Tracks the 2022 revision that obsoletes RFC 7540; vendored HTTP/2 has been progressively updated to match. |
| **RFC 6265** | HTTP State Management (Cookies) | `http.Cookie`, `CookieJar` interface, and `net/http/cookiejar` implement parsing, serialisation, and public-suffix-aware jar semantics. |
| **RFC 6265bis** | Cookies (revised) | `SameSite` attribute, `__Host-` and `__Secure-` cookie prefixes (parsed; enforcement is application-level). |
| **RFC 7234** | HTTP/1.1 Caching | Predecessor of RFC 9111; cited in older Go releases. |
| **RFC 7235** | HTTP/1.1 Authentication | `WWW-Authenticate`, `Authorization`, basic and digest schemes. `http.Request.BasicAuth` and `SetBasicAuth` cover the basic scheme. |
| **RFC 7617** | Basic Authentication scheme | The exact base64 encoding used by `BasicAuth`. |
| **RFC 7239** | Forwarded HTTP Extension | Parsed by application code; not normalised by the stdlib. |
| **RFC 8446** | TLS 1.3 | Used by `http.Transport` and `http.Server` via `crypto/tls`; ALPN tokens `http/1.1` and `h2` are negotiated for HTTP version selection. |
| **RFC 7301** | TLS ALPN | The mechanism `net/http` uses to enable HTTP/2 automatically when both peers support it. |
| **RFC 8470** | Using Early Data in HTTP | Early data (0-RTT) is not enabled by default in `net/http`. |

The Go project does not publish a conformance matrix mapping each RFC clause to an implementation file. The package's behaviour is the de facto specification; the RFCs are the upper bound on what is permitted on the wire. Several RFC features are intentionally omitted — HTTP/3 (QUIC), HTTP server push at scale, on-disk response caching, the full digest authentication scheme, and early-data (0-RTT) handshake support. Application code that needs these uses third-party modules or `golang.org/x` packages that sit beside `net/http` rather than inside it.

References:

- RFC 9110 — <https://datatracker.ietf.org/doc/html/rfc9110>
- RFC 9112 — <https://datatracker.ietf.org/doc/html/rfc9112>
- RFC 7540 — <https://datatracker.ietf.org/doc/html/rfc7540>
- RFC 9113 — <https://datatracker.ietf.org/doc/html/rfc9113>
- RFC 6265 — <https://datatracker.ietf.org/doc/html/rfc6265>
- RFC 9111 — <https://datatracker.ietf.org/doc/html/rfc9111>
- RFC 8446 (TLS 1.3) — <https://datatracker.ietf.org/doc/html/rfc8446>
- RFC 7301 (ALPN) — <https://datatracker.ietf.org/doc/html/rfc7301>

---

## 3. Stable types under the Go 1 compatibility promise

The Go 1 compatibility document at <https://go.dev/doc/go1compat> binds the exported surface of `net/http` against breaking changes within the Go 1.x release line. The following types are the load-bearing identities application code depends on:

| Type | Role |
|------|------|
| `http.Server` | Accept-loop, TLS termination, connection state machine, graceful shutdown. |
| `http.Client` | High-level request issuance, redirect policy, cookie jar integration, timeout. |
| `http.Transport` | Connection pooling, dialing, TLS handshake, HTTP/1 vs HTTP/2 selection, idempotent retry. |
| `http.Request` | The parsed (server) or constructed (client) request: method, URL, headers, body, context. |
| `http.Response` | The received (client) or rendered (server) response: status, headers, body, trailer. |
| `http.Handler` | The interface every server-side handler satisfies: `ServeHTTP(ResponseWriter, *Request)`. |
| `http.HandlerFunc` | Function-typed adapter that lets `func(ResponseWriter, *Request)` satisfy `Handler`. |
| `http.ResponseWriter` | The interface a handler uses to set headers, write a status line, and stream the response body. |
| `http.ServeMux` | The default routing tree; method-aware and pattern-aware since Go 1.22. |
| `http.Header` | `map[string][]string` with canonicalising accessors (`Get`, `Set`, `Add`, `Del`, `Values`). |
| `http.Cookie` | The cookie value object with all RFC 6265 attributes; serialised via `String()`. |
| `http.CookieJar` | The interface a `Client` consults to read and write cookies across redirects and requests. |
| `http.RoundTripper` | The interface `Transport` satisfies; the unit of pluggable transport behaviour. |
| `http.Pusher` | Optional server-side interface for HTTP/2 server push; rarely used since browsers deprecated push. |
| `http.Hijacker` | Optional `ResponseWriter` interface for taking over the connection (WebSocket upgrade, proxies). |
| `http.Flusher` | Optional `ResponseWriter` interface for streaming response bodies. |
| `http.CloseNotifier` | Deprecated; superseded by `Request.Context().Done()`. |

Sentinel values pinned by the compatibility promise include `http.ErrServerClosed`, `http.ErrHandlerTimeout`, `http.ErrAbortHandler`, `http.ErrBodyNotAllowed`, `http.ErrContentLength`, `http.ErrHijacked`, `http.ErrLineTooLong`, `http.ErrMissingFile`, `http.ErrNoCookie`, `http.ErrNoLocation`, `http.ErrNotMultipart`, `http.ErrNotSupported`, `http.ErrShortBody`, `http.ErrSkipAltProtocol`, `http.ErrUseLastResponse`, `http.ErrWriteAfterFlush`.

Status code constants (`http.StatusOK`, `http.StatusNotFound`, and so on through `http.StatusNetworkAuthenticationRequired`) and method constants (`http.MethodGet` through `http.MethodTrace`) are similarly stable.

---

## 4. Subpackages

`net/http` is the trunk; the following subpackages extend it. Stability follows the Go 1 promise except where noted.

| Package | Purpose | Stability |
|---------|---------|-----------|
| `net/http/httptest` | In-process server and recorder for testing handlers and clients. | Stable. |
| `net/http/httputil` | Reverse proxy (`ReverseProxy`), request and response dumping, chunked-encoding helpers. | Stable. |
| `net/http/pprof` | Exposes `runtime/pprof` profiles over HTTP under `/debug/pprof/`. | Stable. |
| `net/http/cookiejar` | The `Jar` type satisfying `CookieJar`; uses `golang.org/x/net/publicsuffix` for domain matching. | Stable. |
| `net/http/cgi` | RFC 3875 CGI client and server. | Stable. |
| `net/http/fcgi` | FastCGI client and server. | Stable. |
| `net/http/internal` | Chunked-encoding state machine and other helpers; not part of the public surface. | **Not stable** — internal use only. |
| `net/http/internal/ascii` | ASCII case-insensitive comparison helpers. | **Not stable** — internal use only. |
| `net/http/httptrace` | Hooks for instrumenting client requests (DNS, connect, TLS, write, first byte). | Stable. |

`golang.org/x/net/http2` is a separate module whose code is vendored into the standard library and exposed through `net/http`. Its exported API is not directly visible to standard-library consumers; the `http.Transport.ForceAttemptHTTP2` and the GODEBUG `http2*` knobs are the public controls.

Documentation index: <https://pkg.go.dev/net/http>.

---

## 5. The `http.Handler` contract

`http.Handler` is a single-method interface:

```go
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}
```

The server invokes `ServeHTTP` once per request. The contract:

1. The handler may read `r.Body` until EOF; it may also choose not to read it. The server is responsible for draining and closing the body after `ServeHTTP` returns.
2. The handler may write a response via the `ResponseWriter` in any combination of `Header()`, `WriteHeader(status int)`, and `Write([]byte)` calls subject to the ordering rules in Section 6.
3. The handler may return without writing anything; the server synthesises `200 OK` with an empty body.
4. The handler must not retain references to `r`, `w`, or any of their components after `ServeHTTP` returns. The values are not safe for use outside the handler call.
5. The handler may panic; the server recovers, logs the panic (unless it equals `http.ErrAbortHandler`), and aborts the connection without writing further data. `http.ErrAbortHandler` panics are silent — used when a handler has decided to disconnect mid-response.
6. The handler's goroutine is governed by `r.Context()`. The context is cancelled when the client disconnects, when the server is shutting down, or when a per-handler timeout fires.

The contract pins what the server guarantees and what the handler must not do; everything else is convention.

Composition rules:

- A handler may delegate to another handler by calling its `ServeHTTP` with the same `w` and `r` (the middleware idiom).
- A handler may construct a new `*Request` from `r` (via `r.WithContext` or `r.Clone`) before delegating; modifying `r` in place is permitted but discouraged because downstream code may have captured references to fields.
- A handler may wrap the `ResponseWriter` in a new type that satisfies `ResponseWriter` plus the optional interfaces it intends to forward; wrappers that do not forward `Flush`, `Hijack`, or `Push` correctly are the most common cause of broken streaming responses.

`http.HandlerFunc` is the standard adapter: `type HandlerFunc func(ResponseWriter, *Request)` with a `ServeHTTP` method that calls the function. It enables passing function literals where a `Handler` is required.

---

## 6. `ResponseWriter` contract

`http.ResponseWriter` mediates header construction, status writing, and body streaming. The ordering rules are precise and cause the majority of subtle handler bugs.

| Operation | Allowed when | After-effects |
|-----------|--------------|---------------|
| `Header()` | Any time before the first `Write` or `WriteHeader`. After that point, the returned map is still mutable but changes are not transmitted in the response head; only `Trailer` values added before the first `Write` are sent as trailers. | Returns the same `Header` map across calls. |
| `WriteHeader(status int)` | Exactly once per response. Subsequent calls log a warning to the server's error log and are otherwise ignored. | Freezes the response head. Headers set after this call are ignored (with the trailer exception above). |
| `Write([]byte)` | Any time. The first `Write` implicitly calls `WriteHeader(http.StatusOK)` if `WriteHeader` has not been called. | After the first `Write`, status and headers are committed. The body is streamed; for HTTP/1.1 connections without a `Content-Length` header the server enables chunked transfer encoding automatically. |

Additional rules:

- Headers under the implicit-content-type rule: if the handler does not set `Content-Type` before the first `Write`, the server sniffs the first 512 bytes of the body and calls `http.DetectContentType`, then writes the resulting MIME type.
- `Content-Length` is set automatically by the server if the entire response body fits in a single `Write` and the handler has not set it manually.
- Setting a header to a value with invalid bytes (control characters, CR, LF) causes the response to fail; the server treats the connection as broken.
- The `ResponseWriter` may also satisfy `Flusher`, `Hijacker`, `Pusher`, or `CloseNotifier`; handlers use type assertions to detect support. As of Go 1.20, `http.NewResponseController(w)` is the preferred way to access these optional methods without per-interface assertions.

Reference implementation: `src/net/http/server.go`, the `response` struct.

---

## 7. `Server.Shutdown` semantics

`Server.Shutdown(ctx context.Context) error` performs a graceful shutdown:

1. Stops accepting new connections on listeners associated with the server.
2. Closes all idle keep-alive connections immediately.
3. Waits for active connections to return to idle state, then closes them.
4. Returns `nil` when all connections have drained, or the context's error if the context fires first.

Long-running handlers (server-sent events, WebSockets via `Hijacker`) do not return to idle naturally; the application must observe `Server.RegisterOnShutdown(func())` callbacks or `Server.BaseContext`'s cancellation to terminate them voluntarily. If they do not, `Shutdown` waits until the context expires and then returns the context's error; in-flight handlers are left running on the abandoned connections.

`Server.Close()` is the abrupt counterpart: closes listeners, then forcibly closes all connections (idle and active), returning immediately. Handlers in flight see write errors on their `ResponseWriter` and `r.Context().Err()` set to `context.Canceled`.

`http.ErrServerClosed` is returned from `ListenAndServe` and `Serve` to signal that `Shutdown` or `Close` was the cause of the loop exit, distinguishing graceful termination from a listener error.

Reference: `src/net/http/server.go`, `Server.Shutdown`.

---

## 8. `ServeMux` (Go 1.22 syntax)

Go 1.22 introduced method-aware and pattern-aware routing for the default mux. Patterns have the form:

```
[METHOD] [HOST]/[PATH]
```

| Element | Examples | Notes |
|---------|----------|-------|
| Method | `GET`, `POST`, `DELETE` | Optional; omitted means any method. A request whose method does not match returns `405 Method Not Allowed` with an `Allow` header listing methods registered for the path. |
| Host | `api.example.com`, `{subdomain}.example.com` | Optional. Host-specific patterns take precedence over host-agnostic ones. |
| Path segment | `/users`, `/users/{id}`, `/files/{path...}` | Static segments match literally. `{name}` matches a single segment and binds it to `r.PathValue("name")`. `{name...}` matches one or more trailing segments. |
| Trailing slash | `/users/` | Matches the path and any subpath unless a more specific pattern is registered. `/users/{$}` matches `/users/` exactly without subpath matching. |

Precedence is by specificity, computed from the pattern's structure rather than registration order. The mux rejects ambiguous registrations at registration time with a clear error explaining which two patterns conflict.

Wildcards bound by `{name}` are read with `r.PathValue("name") string`. The catch-all `{name...}` form binds the remainder of the path.

The old (pre-1.22) mux behaviour can be restored with `GODEBUG=httpmuxgo121=1` for the lifetime of the process. The compatibility knob is intended for migration; new code should adopt the 1.22 syntax.

Reference: `src/net/http/pattern.go`, `src/net/http/routing_tree.go`, `src/net/http/server.go` (the `ServeMux` type).

Proposal: <https://github.com/golang/go/issues/61410>.

---

## 9. `Client` redirect policy

`http.Client.CheckRedirect func(req *Request, via []*Request) error` controls redirect handling. Default behaviour:

1. The client follows redirects for `301`, `302`, `303`, `307`, `308` status codes.
2. The default policy stops after 10 redirects and returns the most recent response wrapped in an error containing `http.ErrUseLastResponse` semantics.
3. The client copies certain headers from the original request to the redirect target (`Authorization`, `Cookie`, `WWW-Authenticate`) only when the target host is the same as the source host. Cross-host redirects strip sensitive headers.
4. For `303` redirects, the method becomes `GET` and the body is dropped, per RFC 9110. For `307` and `308`, the method and body are preserved; for `301` and `302`, the historical behaviour (`POST` becomes `GET`) is followed for compatibility with widely deployed implementations.

To customise:

```go
client := &http.Client{
    CheckRedirect: func(req *Request, via []*Request) error {
        if len(via) >= 3 {
            return http.ErrUseLastResponse // stop redirecting; return the response
        }
        return nil
    },
}
```

Returning `http.ErrUseLastResponse` causes the client to return the latest response and a nil error; the caller receives the redirect response itself rather than following it. Returning any other error aborts and propagates the error to the caller.

Setting `Client.CheckRedirect` to `func(*Request, []*Request) error { return http.ErrUseLastResponse }` disables redirects entirely.

Reference: `src/net/http/client.go`, `Client.do`.

---

## 10. `Transport` — connection pooling, retries, cancellation

`http.Transport` is the default `RoundTripper` and the core of the HTTP/1.1 and HTTP/2 client. Key semantics:

**Connection pool.** The transport maintains a pool of idle keep-alive connections keyed by `(scheme, host, proxy)`. Configuration:

| Field | Default | Meaning |
|-------|---------|---------|
| `MaxIdleConns` | 100 | Maximum total idle connections across all hosts. |
| `MaxIdleConnsPerHost` | 2 | Maximum idle connections per host. Bumping this is the single most common transport tuning for high-fan-out clients. |
| `MaxConnsPerHost` | 0 (unlimited) | Maximum total connections per host (idle plus in-use). |
| `IdleConnTimeout` | 90s | How long an idle connection sits in the pool before being closed. |
| `DisableKeepAlives` | false | If true, every request opens a new connection. |
| `DisableCompression` | false | If true, the transport does not request gzip and does not auto-decompress responses. |

**Idempotent retry.** The transport retries a request once on a fresh connection if all of the following hold:

1. The request method is idempotent (`GET`, `HEAD`, `OPTIONS`, `TRACE`, `PUT`, `DELETE`) or carries a non-nil `Request.GetBody` set by the caller (and the request body is replayable).
2. The first attempt used a pooled connection that the server closed before sending any response bytes.
3. The error is one of a small set recognised as "fresh connection problem" rather than a deliberate server response.

The retry happens transparently; the caller sees one successful response and no indication that the first attempt was discarded. Non-idempotent requests (`POST` without `GetBody`) are never retried by the transport.

**Cancellation.** Two mechanisms:

1. `Request.Context()` — cancelling the context aborts the in-flight request, closes the underlying connection, and causes `RoundTrip` to return the context's error. This is the modern idiom.
2. `Request.Cancel` (deprecated) — a `chan struct{}` whose close cancels the request. Pre-context API; new code uses contexts.

`Client.Timeout` sets an upper bound on the entire request lifecycle (dial, write, response head, full body read). Exceeding it cancels the underlying request context. Finer-grained limits live on `Transport`: `DialContext` carries its own deadline, `TLSHandshakeTimeout` (default 10s), `ResponseHeaderTimeout` (no default), `ExpectContinueTimeout` (default 1s), and `IdleConnTimeout` (default 90s).

**HTTP/2 specifics.** When the transport upgrades a connection to HTTP/2, the pool stores one multiplexed connection per host and dispatches requests as streams. The retry rules above apply to stream errors that resemble fresh-connection errors (`REFUSED_STREAM`, `GOAWAY` with no streams processed). `MaxIdleConnsPerHost` is interpreted differently because a single HTTP/2 connection carries many concurrent streams; the per-stream limit is governed by the peer's `SETTINGS_MAX_CONCURRENT_STREAMS`.

Reference: `src/net/http/transport.go`.

---

## 11. HTTP/2 enabling

HTTP/2 is enabled automatically under these conditions:

1. The client and server both speak TLS.
2. The TLS handshake negotiates the `h2` ALPN token (RFC 7301), which both peers offer by default in Go.
3. The `http.Transport` has not had `TLSNextProto` set to a non-nil map that omits `h2`. Setting `TLSNextProto` to a non-nil map without an `h2` entry disables HTTP/2.

On the server side, `http.Server.TLSNextProto` similarly controls HTTP/2 availability; leaving it nil enables HTTP/2 automatically when serving over TLS. The HTTP/2 implementation is `golang.org/x/net/http2`, vendored into the stdlib; calling `http2.ConfigureServer` or `http2.ConfigureTransport` explicitly is required only when configuring HTTP/2-specific knobs (max concurrent streams, initial window size).

Plaintext HTTP/2 (h2c) is not enabled by default. The `golang.org/x/net/http2/h2c` package provides an opt-in handler wrapper.

`http.Transport.ForceAttemptHTTP2 = true` causes HTTP/2 to be attempted even when a custom `TLSClientConfig` or `DialContext` is set; without this flag, customising those fields silently disables HTTP/2.

Detection of which protocol a connection ended up using is via `Response.Proto` (`"HTTP/1.1"` or `"HTTP/2.0"`) and `Response.ProtoMajor` / `ProtoMinor`. Server-side, the same fields appear on the incoming `Request` and may be used by handlers that need to vary behaviour by protocol (for example, declining HTTP/2 server push for clients that did not negotiate it).

Reference: `src/net/http/h2_bundle.go` (the vendored `golang.org/x/net/http2` source).

---

## 12. GODEBUG knobs

GODEBUG is the runtime configuration channel for behavioural toggles. The `net/http`-relevant knobs:

| Variable | Effect |
|----------|--------|
| `GODEBUG=http2debug=1` | Logs HTTP/2 framing events to stderr at frame granularity. |
| `GODEBUG=http2debug=2` | Logs HTTP/2 framing events including frame payload (verbose). |
| `GODEBUG=http2client=0` | Disables the HTTP/2 client. Requests fall back to HTTP/1.1. |
| `GODEBUG=http2server=0` | Disables the HTTP/2 server. Connections that negotiate `h2` are rejected. |
| `GODEBUG=httpmuxgo121=1` | Restores the pre-Go-1.22 `ServeMux` behaviour for the process lifetime. Patterns lose method awareness and the new wildcard syntax. |
| `GODEBUG=httplaxcontentlength=1` | Restores pre-Go-1.21 lax handling of `Content-Length` headers with invalid values. |
| `GODEBUG=httpservecontentkeepheaders=1` | Restores legacy header-stripping behaviour in `http.ServeContent`. |
| `GODEBUG=tlsmaxrsasize=N` | Caps RSA key sizes accepted in TLS; not `net/http`-specific but applies to HTTPS clients and servers. |
| `GODEBUG=gotypesalias=0|1` | Toggles the `types.Alias` representation in `go/types`; affects code that imports `go/types` from within HTTP tooling. Not directly an `http` knob but commonly co-set during compatibility testing. |

Default values follow the GODEBUG default version policy in <https://go.dev/doc/godebug>: knobs introduced for a release default to the new behaviour for code that declares that release in `go.mod`, and to the legacy behaviour for older `go.mod` versions.

Reference: <https://pkg.go.dev/runtime#hdr-Environment_Variables> and the per-release "Changes to the standard library" section of the release notes.

---

## 13. Source files of authoritative interest

The path prefix `src/net/http/` is rooted at the Go source tree (<https://github.com/golang/go/tree/master/src/net/http>).

| File | Subsystem |
|------|-----------|
| `server.go` | `Server`, `ServeMux`, `Handler`, `ResponseWriter`, the connection state machine. The single largest file in the package. |
| `client.go` | `Client`, redirect policy, `Do`, `Get`, `Post`, `Head`. |
| `transport.go` | `Transport`, connection pool, dialer, idempotent retry, alt-protocol switching. |
| `request.go` | `Request` parsing, header reading, body decoding, `ParseForm`. |
| `response.go` | `Response` parsing, body framing, trailer handling. |
| `header.go` | `Header` map, canonical header keys, header serialisation. |
| `cookie.go` | `Cookie` parsing and serialisation, `SetCookie`. |
| `cookie_secure.go` | `__Host-` and `__Secure-` cookie prefix handling. |
| `pattern.go` | `ServeMux` pattern parser (1.22+). |
| `routing_tree.go` | `ServeMux` routing trie (1.22+). |
| `routing_index.go` | `ServeMux` ambiguity detection (1.22+). |
| `responsecontroller.go` | `http.NewResponseController` and the consolidated optional-method accessors. |
| `h2_bundle.go` | The vendored `golang.org/x/net/http2` implementation. Single file by build process; treat as read-only. |
| `transfer.go` | Chunked encoding, body framing on read and write. |
| `fs.go` | `FileServer`, `ServeFile`, `ServeContent`, file-system handler logic. |
| `triv.go` | Test-only trivial HTTP server example. |
| `roundtrip.go` | The `RoundTripper` interface assertion and helper functions. |
| `sniff.go` | `DetectContentType` MIME sniffing per the WHATWG MIME Sniffing Standard. |
| `socks_bundle.go` | Vendored SOCKS proxy support. |
| `proxy.go` | HTTP proxy configuration parsing (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`). |
| `status.go` | Status code constants and `StatusText`. |
| `method.go` | Method constants. |

Subpackage entry points:

| Path | Subsystem |
|------|-----------|
| `src/net/http/httptest/server.go` | `httptest.Server`. |
| `src/net/http/httptest/recorder.go` | `httptest.ResponseRecorder`. |
| `src/net/http/httputil/reverseproxy.go` | `httputil.ReverseProxy`. |
| `src/net/http/pprof/pprof.go` | `pprof` HTTP handlers. |
| `src/net/http/cookiejar/jar.go` | `cookiejar.Jar`. |

The canonical browser link for any of these: <https://github.com/golang/go/blob/master/src/net/http/server.go> and analogues.

---

## 14. Compatibility scope

The Go 1 compatibility promise (<https://go.dev/doc/go1compat>) covers the exported identifiers of `net/http` and its subpackages excluding `internal/`. Specifically:

| Stable | Not stable |
|--------|------------|
| Exported types, constants, variables, and function signatures of `net/http`, `net/http/httptest`, `net/http/httputil`, `net/http/cookiejar`, `net/http/cgi`, `net/http/fcgi`, `net/http/pprof`, `net/http/httptrace`. | Anything under `net/http/internal/`, including the chunked-encoding parser. |
| Documented behaviour where the documentation explicitly states the guarantee (`Server.Shutdown`, `Client.Do`). | Behavioural detail not covered by documentation — exact connection-pool reuse heuristics, exact wire-level timing of idle close, exact buffer sizes. |
| Sentinel errors (`http.ErrServerClosed`, `http.ErrHandlerTimeout`, and the others). | Error message strings — formatting of errors is allowed to change. |
| The set of GODEBUG knobs documented for a release. | Defaults of GODEBUG knobs change across releases per the GODEBUG default version policy. |
| The HTTP/2 *behavioural* surface exposed through `net/http`. | The vendored `golang.org/x/net/http2` API as it would appear if imported directly — that module evolves on its own schedule. |

Behavioural changes that are *not* breaking under the promise but do affect application code: changes to MIME sniffing, changes to default header normalisation, changes to default cipher suites, and changes to redirect-header propagation rules across cross-host hops. These are documented in the release notes for the affected version.

---

## 15. Notable proposals

| Proposal | Subject | Status |
|----------|---------|--------|
| <https://github.com/golang/go/issues/61410> | Go 1.22 `ServeMux` enhancements: method matching, host matching, path wildcards. | Implemented in Go 1.22. |
| <https://github.com/golang/go/issues/54136> | `http.NewResponseController(w)` consolidating optional `ResponseWriter` methods (`Flusher`, `Hijacker`, deadline setters) under a single accessor. | Implemented in Go 1.20. |
| <https://github.com/golang/go/issues/36973> | `http.Server.RegisterOnShutdown` hook for graceful shutdown of long-running handlers. | Implemented in Go 1.13. |
| <https://github.com/golang/go/issues/48324> | `Request.Context` propagation through `httputil.ReverseProxy`. | Implemented in Go 1.20. |
| <https://github.com/golang/go/issues/30948> | Per-request connection state hooks via `httptrace`. | Implemented incrementally across Go 1.17–1.20. |
| <https://github.com/golang/go/issues/57005> | Replacing the chunked-encoding parser to address request-smuggling defences. | Implemented across Go 1.20–1.22. |
| <https://github.com/golang/go/issues/53960> | Strict `Content-Length` parsing (governed by `GODEBUG=httplaxcontentlength`). | Implemented in Go 1.21. |
| <https://github.com/golang/go/issues/65035> | Improved HTTP/2 server timeouts and slowloris defences. | Tracked; partial implementation. |

The issue tracker at <https://github.com/golang/go/issues?q=is%3Aissue+label%3Anet%2Fhttp> is the live index.

---

## 16. Bug reporting

`net/http` bugs are filed on the Go issue tracker. The intake path:

1. Reproduce against `gotip` (`go install golang.org/dl/gotip@latest && gotip download && gotip <build>`) or against the latest stable release.
2. Reduce to a minimal program — ideally one that uses `httptest.Server` so the report is self-contained.
3. File at <https://github.com/golang/go/issues/new/choose> selecting the "Bug Report" template.
4. Apply or request the `NeedsInvestigation` and `net/http` labels.
5. For security-sensitive issues (request smuggling, header injection, TLS bypass), use the private disclosure channel at <https://go.dev/security> rather than the public tracker.

The active maintainers for `net/http` are listed in `src/net/http/CONTRIBUTORS` historically and in the per-file blame on `github.com/golang/go` currently; the package owners are part of the Go team and respond on the tracker.

The release-notes index at <https://go.dev/doc/devel/release> records all `net/http` changes per release; the "Changes to the standard library" section of each minor release is the authoritative changelog.

Reading order for a developer approaching the `net/http` source for the first time:

1. `server.go` first — it contains the connection state machine, the `Handler` and `ResponseWriter` types, and the `Server` shutdown logic. Most behavioural questions resolve here.
2. `transport.go` next — the client-side counterpart and the most complex file in the package by control flow.
3. `request.go` and `response.go` — message reading and writing; small enough to read in one sitting once the server and transport context is understood.
4. `pattern.go` and `routing_tree.go` for the post-1.22 mux implementation.
5. `h2_bundle.go` last and only when needed; it is large, machine-bundled, and exists mainly to keep `golang.org/x/net/http2` in lockstep with the stdlib.
