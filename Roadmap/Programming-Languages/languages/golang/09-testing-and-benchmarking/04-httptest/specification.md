---
layout: default
title: httptest — Specification
parent: net/http/httptest
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/04-httptest/specification/
---

# httptest — Specification

[← Back](../)

This file collects the godoc-level facts about `net/http/httptest` from `src/net/http/httptest/` (`httptest.go`, `recorder.go`, `server.go`). Treat it as the reference card you check before writing test code.

## Package summary

```
Package httptest provides utilities for HTTP testing.
```

The package is part of the standard library and depends on `net`, `net/http`, `crypto/tls`, `bufio`, `bytes`, `io`, and `sync`. Source location: `$GOROOT/src/net/http/httptest/`.

It is split into three logical surfaces:

1. Synthetic requests — `NewRequest`.
2. In-process response capture — `ResponseRecorder`, `NewRecorder`.
3. Loopback servers — `Server`, `NewServer`, `NewUnstartedServer`, `NewTLSServer`.

## httptest.NewRequest

Signature:

```go
func NewRequest(method, target string, body io.Reader) *http.Request
```

Documentation: "NewRequest returns a new incoming server Request, suitable for passing to an http.Handler for testing." It panics if `method` is invalid (per `http.NewRequest`'s rules) or `target` cannot be parsed.

Key behaviors from `httptest.go`:

- The returned `*http.Request` has `RequestURI` set, so it looks like a server-side request (handlers see what `(*conn).readRequest` would have produced).
- `Host` is set from `target` if it contains an authority; otherwise it is `"example.com"`.
- If `body` is `nil`, `Body` is set to `http.NoBody`.
- If `body` implements an in-memory reader (`*bytes.Reader`, `*bytes.Buffer`, `*strings.Reader`), `ContentLength` is set to the byte length; otherwise it is `-1`.
- `Proto` is `"HTTP/1.1"`, `ProtoMajor` is `1`, `ProtoMinor` is `1`.
- `RemoteAddr` is `"192.0.2.1:1234"` (a TEST-NET-1 address from RFC 5737, by design unreachable).
- `TLS` is `nil` unless `target` starts with `https://`, in which case a minimal `*tls.ConnectionState` is synthesised.

This is the *server-side* counterpart to `http.NewRequest` (which produces an outgoing client request). Do not confuse the two.

## httptest.ResponseRecorder

Defined in `recorder.go`:

```go
type ResponseRecorder struct {
    Code      int            // the HTTP response code
    HeaderMap http.Header    // the HTTP response headers
    Body      *bytes.Buffer  // if non-nil, the bytes.Buffer to append written data to
    Flushed   bool
    // contains filtered or unexported fields
}
```

Important methods:

- `func NewRecorder() *ResponseRecorder` — returns a recorder with `Code: 200`, an empty `HeaderMap`, and a non-nil `Body`.
- `func (rw *ResponseRecorder) Header() http.Header` — implements `http.ResponseWriter`.
- `func (rw *ResponseRecorder) Write(b []byte) (int, error)` — appends to `Body` if non-nil, otherwise discards. Implicitly calls `WriteHeader(200)` on first write.
- `func (rw *ResponseRecorder) WriteString(s string) (int, error)` — same, but for strings.
- `func (rw *ResponseRecorder) WriteHeader(code int)` — records the status code; further calls are ignored (per `http.ResponseWriter`).
- `func (rw *ResponseRecorder) Flush()` — sets `Flushed = true` and calls `WriteHeader(200)` if not yet called.
- `func (rw *ResponseRecorder) Result() *http.Response` — returns a `*http.Response` snapshot built from the recorder. The response has `Body` set to a `NopCloser` around the `Body` buffer; `StatusCode = Code`; `Header` is a clone of `HeaderMap`; `Proto` is `"HTTP/1.1"`; trailers populated from headers prefixed with `Trailer:`.

`Result` is safe to call after the handler returns. It is *not* safe to call concurrently with the handler still writing.

Subtlety: `ResponseRecorder` does *not* simulate every behavior of the real server's response writer. It does not enforce header validity, does not implement `http.Hijacker`, and does not implement `http.CloseNotifier`. It does implement `http.Flusher` via the `Flush` method above.

## httptest.Server

Defined in `server.go`:

```go
type Server struct {
    URL      string // base URL of form http://ipaddr:port with no trailing slash
    Listener net.Listener
    EnableHTTP2 bool        // by default, HTTP/2 is not enabled
    TLS         *tls.Config // nil if not using TLS
    Config      *http.Server
    // contains filtered or unexported fields
}
```

Fields you may write before `Start`/`StartTLS`:

- `EnableHTTP2` — when true and TLS is enabled, the server advertises and serves HTTP/2.
- `TLS` — TLS configuration when `StartTLS` is used; `httptest` will mutate this to install the self-signed certificate.
- `Config` — the underlying `*http.Server`; modify timeouts, `ErrorLog`, etc. before starting.
- `Listener` — only meaningful for `NewUnstartedServer` if you replace it before `Start`.

## Constructors

```go
func NewServer(handler http.Handler) *Server
func NewTLSServer(handler http.Handler) *Server
func NewUnstartedServer(handler http.Handler) *Server
```

Behavior from `server.go`:

- `NewServer` creates and starts an HTTP server listening on `127.0.0.1:0` (or `[::1]:0` if IPv4 is unavailable). Returns after the listener is open.
- `NewTLSServer` does the same but wraps the listener in TLS using an internally generated, self-signed certificate. Hostname in the cert is `example.com`; SAN covers `example.com` and `127.0.0.1`.
- `NewUnstartedServer` allocates the `Server` but does not start it. Use this when you need to mutate `Config` or `EnableHTTP2` before requests are accepted.

Methods:

```go
func (s *Server) Start()
func (s *Server) StartTLS()
func (s *Server) Close()
func (s *Server) CloseClientConnections()
func (s *Server) Client() *http.Client
func (s *Server) Certificate() *x509.Certificate
```

Notes:

- `Start` panics if called on a server that is already running.
- `StartTLS` panics if called twice or if called on an `httptest.NewServer` (non-TLS) instance.
- `Close` blocks until all outstanding requests return. It calls `Shutdown` on the underlying `http.Server` after closing the listener.
- `CloseClientConnections` forcibly closes any open keep-alive connections without waiting for handlers to return. Useful for testing client retry logic.
- `Client()` returns an `*http.Client` whose `Transport` has the server's certificate installed in its `RootCAs` pool. Using this client guarantees TLS verification succeeds against the test server.
- `Certificate()` returns the parsed leaf certificate the test server presents (only meaningful for TLS).

## Self-signed certificate

The certificate used by `NewTLSServer` is generated by `internal/testcert.LocalhostCert` (see `src/crypto/tls/generate_cert.go` for the standalone tool that produces an analogous cert). It is hard-coded for the lifetime of the `net/http/httptest` package:

- Valid from `Jan 1 00:00:00 1970` to `Dec 31 23:59:59 2049`.
- CN: `example.com`.
- SAN DNS names: `example.com`, `localhost`.
- SAN IPs: `127.0.0.1`, `::1`.
- Key type: 1024-bit RSA (historically; modern Go versions use a generated key per certain conditions).
- It is **not** an issuer; any verification that requires a chain to a CA must use `Server.Client()` or install `Server.Certificate()` into a custom pool.

## Concurrency guarantees

- `Server.Close` is safe to call from a `t.Cleanup` registered before any goroutine spawns; it serialises with the listener's `Accept` loop.
- `ResponseRecorder` is not safe for concurrent use; if the handler under test spawns goroutines that write to the same recorder, callers must add their own synchronisation.
- `Server` itself can be hit concurrently; each accepted connection runs in its own goroutine inside the underlying `http.Server`.

## Versioning notes

- `httptest.NewRequest` was added in Go 1.7. Earlier code uses `http.ReadRequest` on a `bufio.Reader` over a raw HTTP/1.1 payload.
- `Server.Client()` and `Server.Certificate()` were added in Go 1.9.
- The `EnableHTTP2` field was added in Go 1.14.
- The `ResponseRecorder.WriteString` method was added in Go 1.6.

## Source files

```
src/net/http/httptest/
    httptest.go      // NewRequest
    recorder.go      // ResponseRecorder
    server.go        // Server, NewServer, NewTLSServer, NewUnstartedServer
    httptest_test.go // tests
    recorder_test.go
    server_test.go
    example_test.go
```

When in doubt, read `recorder.go` and `server.go` — they are short and authoritative.

## Detailed field reference

### ResponseRecorder fields

```
Code       int           Status code; defaults to 200.
HeaderMap  http.Header   Headers set by the handler.
Body       *bytes.Buffer Body bytes; nil disables capture.
Flushed    bool          True if Flush() was called.
```

The unexported fields (not part of the API) include:

- `result *http.Response` — cached snapshot returned by `Result()`.
- `snapHeader http.Header` — header copy captured at first write.
- `wroteHeader bool` — guard against duplicate `WriteHeader` calls.

### Server fields

```
URL          string         Full base URL; empty until Start.
Listener     net.Listener   The bound listener; replaceable before Start.
EnableHTTP2  bool           Negotiate HTTP/2; requires TLS.
TLS          *tls.Config    TLS configuration; mutated by StartTLS.
Config       *http.Server   Underlying http.Server; tunable before Start.
```

Unexported state on `Server`:

- `cert *x509.Certificate` — the parsed leaf certificate.
- `certPool *x509.CertPool` — pool containing the test cert.
- `wg sync.WaitGroup` — tracks active connections for Close.
- `client *http.Client` — lazily built; returned by `Client()`.

### Methods on Server

```
func (s *Server) Start()
    Starts the server. Panics if called twice.

func (s *Server) StartTLS()
    Starts the server with TLS. Panics if called after Start.

func (s *Server) Close()
    Closes the listener and waits for handlers. Idempotent in Go 1.20+.

func (s *Server) CloseClientConnections()
    Forcibly closes idle and active client connections.
    Does NOT close the listener.

func (s *Server) Client() *http.Client
    Returns an HTTP client configured to talk to this server.
    For TLS servers, the client trusts the test certificate.

func (s *Server) Certificate() *x509.Certificate
    Returns the parsed leaf certificate (TLS only).
```

## Behavioral guarantees

The package documents the following invariants:

1. **Listener is open before Start returns.** Any code that does `httptest.NewServer(h)` followed by `http.Get(ts.URL)` will not race on listener readiness.
2. **Close blocks until all in-flight handlers return.** A test that runs `ts.Close()` is guaranteed the server is fully drained when the call returns.
3. **URL has no trailing slash.** `ts.URL` is `http://127.0.0.1:port` without a trailing `/`. Use string concatenation freely.
4. **TLS cert pool is fresh.** Each `NewTLSServer` may use the same in-process cert (it's shared), but `Server.Client()` always returns a client with that cert in its pool.
5. **NewRequest sets Host.** Even if `target` is just `/path`, `Host` is `example.com`. Never leave it empty.

## Source layout in detail

```
src/net/http/httptest/
    httptest.go         // NewRequest
    httptest_test.go    // tests for NewRequest
    recorder.go         // ResponseRecorder and friends
    recorder_test.go    // tests for ResponseRecorder
    server.go           // Server, NewServer, NewTLSServer, NewUnstartedServer
    server_test.go      // tests for Server
    example_test.go     // godoc examples
```

`httptest.go` is the smallest file in the package — under 100 lines including comments. `recorder.go` is roughly 200 lines. `server.go` is the largest, around 400 lines, mostly setup and TLS configuration.

Worth reading in order of usefulness:

1. `recorder.go` — the model for in-process tests.
2. `httptest.go` — to understand request defaults.
3. `server.go` — to understand TLS setup and Close semantics.
4. `example_test.go` — to see idiomatic patterns.

## Version history (selected)

| Go version | Change |
|---|---|
| 1.7 | Added `httptest.NewRequest`. |
| 1.9 | Added `Server.Client()` and `Server.Certificate()`. |
| 1.10 | Added `(*Server).CloseClientConnections` documented behavior. |
| 1.14 | Added `Server.EnableHTTP2`. |
| 1.17 | Removed deprecated `*ResponseRecorder.HeaderMap` recommendation; `Header()` is preferred. |
| 1.20 | `(*Server).Close` made idempotent. |

If your test must work across older Go versions, refer to the version note for each API.

## Common values

- Default cert validity: `1970-01-01` to `2049-12-31`.
- Default `Host` from `NewRequest`: `example.com`.
- Default `RemoteAddr` from `NewRequest`: `192.0.2.1:1234`.
- Default `Code` on `NewRecorder`: `200`.
- Default `Proto` on requests and responses: `HTTP/1.1`.

These are not configurable. If your code depends on them (e.g. parses `RemoteAddr` for IP filtering), set them explicitly in the test.

## Annotated example from example_test.go

The package's own example file demonstrates idiomatic use:

```go
func ExampleResponseRecorder() {
    handler := func(w http.ResponseWriter, r *http.Request) {
        http.Error(w, "something failed", http.StatusInternalServerError)
    }

    req := httptest.NewRequest("GET", "http://example.com/foo", nil)
    w := httptest.NewRecorder()
    handler(w, req)

    fmt.Printf("%d - %s", w.Code, w.Body.String())
    // Output: 500 - something failed
}

func ExampleServer() {
    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "Hello, client")
    }))
    defer ts.Close()

    res, err := http.Get(ts.URL)
    if err != nil {
        log.Fatal(err)
    }
    greeting, err := io.ReadAll(res.Body)
    res.Body.Close()
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("%s", greeting)
    // Output: Hello, client
}
```

Three observations:

1. The example uses `defer ts.Close()` not `t.Cleanup`. In a real test, `t.Cleanup` is preferred. The example is in package `httptest_test`, not in a test function.
2. The example treats `res.Body.Close` separately from `defer` — closing before reading the next variable. Either style works.
3. The expected output uses the `// Output:` comment, which `go test` verifies. The example is also documentation; godoc renders it inline.

## Comparison to other languages

For context, here is how `httptest` compares to its peers:

- **Java (Spring Boot)** — `MockMvc` for handler testing, `TestRestTemplate` for client testing. Both have heavy framework dependencies.
- **Python (Flask)** — `app.test_client()` returns a synchronous `werkzeug.test.Client` that wraps the app. Equivalent to `ResponseRecorder` but framework-coupled.
- **Node.js (Express)** — `supertest` wraps an Express app and sends real HTTP. Closer to `httptest.NewServer`.
- **Ruby (Rack)** — `Rack::Test` provides `last_response`, similar to `ResponseRecorder`.

Go's `httptest` is the only one of these that ships in the standard library and is fully framework-independent.

## When NOT to use httptest

- Testing the standard library's own HTTP behavior — that's already covered by `net/http`'s own tests.
- Testing a non-HTTP protocol (gRPC, WebSocket framing). Use protocol-specific harnesses.
- Load testing — for that, use `hey`, `vegeta`, or `wrk` against a real server.
- Contract testing — for that, use Pact or schema validation tools.

`httptest` is the right tool when:

- You wrote an `http.Handler` or `*http.Client` code.
- You want fast, deterministic, no-network tests.
- You want to inspect the response in detail.

## Frozen-in-time guarantees

The following will not change across Go versions:

- The `ResponseRecorder.Code` field defaults to 200.
- `NewRequest` sets `RequestURI` and `RemoteAddr`.
- `NewServer` binds to `127.0.0.1:0`.
- `Close` blocks until in-flight handlers return.
- `Client()` returns a fresh `*http.Client` per call.

The following may change:

- The exact value of the test certificate (key size, expiry, signing algorithm). Use `Certificate()` to read it; don't depend on hardcoded fingerprints.
- The exact `RemoteAddr` string. Don't pattern-match on it.
- Whether `Server` uses HTTP/2 by default with `EnableHTTP2 = true` (currently it does; future Go may negotiate automatically).

When in doubt, write tests that depend on observable behavior, not implementation details.

---

[← Back](../)
