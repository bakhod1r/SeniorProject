---
layout: default
title: httptest — Middle
parent: net/http/httptest
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/04-httptest/middle/
---

# httptest — Middle

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [TLS test servers](#tls-test-servers)
5. [The self-signed certificate](#the-self-signed-certificate)
6. [server.Client and why you should prefer it](#serverclient-and-why-you-should-prefer-it)
7. [Customising the transport](#customising-the-transport)
8. [Testing middleware chains](#testing-middleware-chains)
9. [Testing http.Client code](#testing-httpclient-code)
10. [NewUnstartedServer and pre-start configuration](#newunstartedserver-and-pre-start-configuration)
11. [Customising the listener](#customising-the-listener)
12. [Port-zero binding explained](#port-zero-binding-explained)
13. [Manual server on :0 versus httptest](#manual-server-on-0-versus-httptest)
14. [t.Cleanup, helpers, and shared servers](#tcleanup-helpers-and-shared-servers)
15. [Subtests with httptest](#subtests-with-httptest)
16. [Race-safety across parallel tests](#race-safety-across-parallel-tests)
17. [Testing timeouts](#testing-timeouts)
18. [Testing retries](#testing-retries)
19. [Inspecting requests received by the server](#inspecting-requests-received-by-the-server)
20. [Configurable response servers](#configurable-response-servers)
21. [Common mistakes](#common-mistakes)
22. [Best practices](#best-practices)
23. [Self-assessment checklist](#self-assessment-checklist)
24. [Summary](#summary)
25. [Further reading](#further-reading)

---

## Introduction

You can now write basic handler tests with `ResponseRecorder` and client tests with `NewServer`. This file extends both styles to cover patterns you will use daily on a production codebase:

- TLS test servers with the package's self-signed certificate.
- Middleware chain testing — does the auth middleware actually inject the user into the context?
- Testing arbitrary `*http.Client` code — even code you didn't write.
- Pre-start configuration via `NewUnstartedServer` for setting timeouts, error logs, and HTTP/2.
- Parallel-safe cleanup with `t.Cleanup` and `t.Helper`.
- Testing retry logic by deliberately failing the first N requests.

Everything here builds on `junior.md`. If you skipped that file, go read it first — the recorded-handler and server-with-cleanup patterns are assumed.

---

## Prerequisites

- You completed the junior file.
- You know that `t.Parallel` makes a test run alongside its siblings.
- You know `sync.Mutex` and `sync/atomic` exist.
- You have used the `context` package at least once (`context.WithCancel`, `context.WithTimeout`).
- You can write middleware as a function `func(http.Handler) http.Handler`.

---

## Glossary

- **TLS** — Transport Layer Security. Used by HTTPS.
- **Self-signed certificate** — a certificate whose signer is the certificate itself, not a trusted Certificate Authority. The browser/client must explicitly trust it.
- **Root CA pool** — the set of certificates a TLS client trusts as anchors. `crypto/tls.Config.RootCAs`.
- **Transport** — the `http.RoundTripper` an `*http.Client` uses to send requests. Default: `http.DefaultTransport`.
- **Middleware** — a function that wraps a handler with extra behavior. Signature `func(http.Handler) http.Handler`.

---

## TLS test servers

`httptest.NewTLSServer(handler)` returns a `*Server` that speaks HTTPS. It listens on `127.0.0.1:0`, generates a self-signed certificate at startup, and configures the underlying `*http.Server` with that certificate. The URL is `https://127.0.0.1:port`.

```go
ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "hello over TLS")
}))
t.Cleanup(ts.Close)
```

If you `http.Get(ts.URL)` with the default client, you get:

```
Get "https://127.0.0.1:54321": x509: certificate signed by unknown authority
```

This is *good* — TLS is doing its job. The default client doesn't know about the test cert. You have two options to make it work:

1. Use `ts.Client()` (recommended).
2. Build a custom transport with the cert in the root pool.

Both are covered below.

---

## The self-signed certificate

The certificate used by `NewTLSServer` is built into the package. From the source (`src/net/http/httptest/server.go` and `src/internal/testcert`):

- The CN is `example.com`.
- The Subject Alternative Names cover `example.com`, `localhost`, `127.0.0.1`, and `::1`.
- Validity: `Jan 1 1970` to `Dec 31 2049`. You will be retired before it expires.
- Key type and size are fixed; modern Go versions may generate a fresh keypair at process start (see the source for specifics).

The cert is *not* signed by any CA. Trying to verify it against the system trust store fails. Verification works only when the test client has the cert installed in its `RootCAs` pool.

You can fetch the cert directly:

```go
cert := ts.Certificate() // *x509.Certificate
fmt.Println(cert.Subject.CommonName) // "example.com"
```

This is useful when your code under test takes a `*x509.CertPool` (not a `*http.Client`) and you need to install the cert manually.

---

## server.Client and why you should prefer it

`*Server.Client()` returns an `*http.Client` whose `Transport` is configured to trust the test server's certificate. Use it as a drop-in for `http.DefaultClient`:

```go
ts := httptest.NewTLSServer(handler)
t.Cleanup(ts.Close)

resp, err := ts.Client().Get(ts.URL)
```

Three reasons to prefer it:

1. **It works for both `NewServer` and `NewTLSServer`.** For the plain HTTP variant, the returned client is roughly equivalent to a default client. Using `ts.Client()` everywhere means a test that starts as plain HTTP and later upgrades to TLS doesn't need to change.

2. **It doesn't reuse global state.** `http.DefaultClient` and `http.DefaultTransport` are shared globals. If a previous test mutated them (e.g. set a custom `Proxy`), your test inherits the mutation. `ts.Client()` returns a fresh client.

3. **The TLS config is right.** The cert is in the root pool. No `InsecureSkipVerify`. No surprise during a future TLS upgrade.

```go
client := ts.Client()
client.Timeout = 5 * time.Second // safe to customise further
```

The returned client is your client; mutate it freely.

---

## Customising the transport

If your code under test takes an `*http.Transport` (not a client), you may want to build the transport yourself but reuse the cert. Pattern:

```go
ts := httptest.NewTLSServer(handler)
t.Cleanup(ts.Close)

certPool := x509.NewCertPool()
certPool.AddCert(ts.Certificate())

transport := &http.Transport{
    TLSClientConfig: &tls.Config{
        RootCAs: certPool,
    },
}

client := &http.Client{Transport: transport}
resp, err := client.Get(ts.URL)
```

Or copy the configuration from `ts.Client()`:

```go
client := ts.Client()
clone := client.Transport.(*http.Transport).Clone()
clone.MaxIdleConns = 0
clone.DisableKeepAlives = true

newClient := &http.Client{Transport: clone}
```

This is the right path when your production code accepts a `*http.Transport` for, say, propagating tracing headers. The test still uses the test cert; the test still verifies the chain.

Anti-pattern:

```go
client := &http.Client{
    Transport: &http.Transport{
        TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
    },
}
```

This works but disables verification entirely. If a future regression breaks your *production* TLS code, this test will not catch it. Always prefer adding the test cert to the root pool.

---

## Testing middleware chains

A middleware in Go looks like:

```go
func Logger(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Printf("%s %s", r.Method, r.URL.Path)
        next.ServeHTTP(w, r)
    })
}
```

Testing it requires two things: a fake `next` to see what was passed, and assertions on the `ResponseWriter`. The recorder handles the second; you write the first.

```go
func TestLogger(t *testing.T) {
    var got *http.Request

    inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        got = r
        w.WriteHeader(http.StatusOK)
    })

    mw := Logger(inner)

    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/path", nil)
    mw.ServeHTTP(rec, req)

    if rec.Code != http.StatusOK {
        t.Fatalf("status = %d", rec.Code)
    }
    if got == nil {
        t.Fatal("inner handler not called")
    }
    if got.URL.Path != "/path" {
        t.Fatalf("inner saw path = %q", got.URL.Path)
    }
}
```

The pattern generalises. For a middleware that injects a value into the context:

```go
type userKey struct{}

func AuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        tok := r.Header.Get("Authorization")
        if tok != "Bearer good" {
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }
        ctx := context.WithValue(r.Context(), userKey{}, "alice")
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

func TestAuthMiddleware(t *testing.T) {
    tests := []struct {
        name    string
        token   string
        wantCode int
        wantUser string
    }{
        {"valid", "Bearer good", 200, "alice"},
        {"invalid", "Bearer bad", 401, ""},
        {"missing", "", 401, ""},
    }
    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            var seenUser string
            inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                if v, ok := r.Context().Value(userKey{}).(string); ok {
                    seenUser = v
                }
                w.WriteHeader(http.StatusOK)
            })

            mw := AuthMiddleware(inner)
            rec := httptest.NewRecorder()
            req := httptest.NewRequest("GET", "/", nil)
            if tc.token != "" {
                req.Header.Set("Authorization", tc.token)
            }
            mw.ServeHTTP(rec, req)

            if rec.Code != tc.wantCode {
                t.Fatalf("status = %d, want %d", rec.Code, tc.wantCode)
            }
            if seenUser != tc.wantUser {
                t.Fatalf("user = %q, want %q", seenUser, tc.wantUser)
            }
        })
    }
}
```

A handful of patterns to note in this code:

- We use a closure (`seenUser`) to record what the inner handler observed. The test is sequential, so no mutex is needed.
- We test the middleware in isolation, not the whole pipeline. The inner handler is a stub.
- We test all three branches: valid, invalid, missing. The matrix is small enough to enumerate.

Chained middleware tests:

```go
func TestChain(t *testing.T) {
    chain := Logger(RequestID(AuthMiddleware(myHandler)))

    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer good")
    chain.ServeHTTP(rec, req)

    if rec.Code != 200 {
        t.Fatalf("status = %d", rec.Code)
    }
    if rec.Header().Get("X-Request-ID") == "" {
        t.Fatal("missing X-Request-ID")
    }
}
```

Test the chain as a whole when the interaction between middlewares matters. Test each one in isolation when their contracts are independent.

---

## Testing http.Client code

If you wrote a function

```go
func FetchUser(client *http.Client, baseURL string, id int) (*User, error)
```

then testing it is mechanical: build a server that returns the canned response, hand the function the server's URL.

```go
func TestFetchUser(t *testing.T) {
    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path != "/users/42" {
            http.NotFound(w, r)
            return
        }
        w.Header().Set("Content-Type", "application/json")
        fmt.Fprint(w, `{"id":42,"name":"Ada"}`)
    }))
    t.Cleanup(ts.Close)

    u, err := FetchUser(ts.Client(), ts.URL, 42)
    if err != nil {
        t.Fatal(err)
    }
    if u.ID != 42 || u.Name != "Ada" {
        t.Fatalf("got %+v", u)
    }
}
```

The key dependency-injection point is that `FetchUser` takes `client` and `baseURL` as parameters. If your function instead uses `http.DefaultClient.Get("https://api.example.com/...")`, you cannot test it with `httptest`. Refactor.

```go
// Untestable
func FetchUser(id int) (*User, error) {
    resp, err := http.Get(fmt.Sprintf("https://api.example.com/users/%d", id))
    // ...
}

// Testable
type APIClient struct {
    HTTPClient *http.Client
    BaseURL    string
}

func (c *APIClient) FetchUser(id int) (*User, error) {
    resp, err := c.HTTPClient.Get(fmt.Sprintf("%s/users/%d", c.BaseURL, id))
    // ...
}
```

The refactor is small and improves more than testability — it makes the production code configurable for different environments (staging, prod).

---

## NewUnstartedServer and pre-start configuration

`httptest.NewServer` starts the server immediately. You cannot set timeouts, swap the error log, or enable HTTP/2 after the fact. `NewUnstartedServer` solves this:

```go
ts := httptest.NewUnstartedServer(handler)
ts.Config.ReadTimeout = 500 * time.Millisecond
ts.Config.WriteTimeout = 500 * time.Millisecond
ts.Config.ErrorLog = log.New(io.Discard, "", 0) // silence noisy logs
ts.Start()
t.Cleanup(ts.Close)
```

`ts.Config` is the underlying `*http.Server`. Anything you can set on a real server, you can set here before calling `Start()`. After `Start()` mutating `Config` is undefined; do it earlier.

For HTTP/2:

```go
ts := httptest.NewUnstartedServer(handler)
ts.EnableHTTP2 = true
ts.StartTLS() // HTTP/2 requires TLS
t.Cleanup(ts.Close)

resp, _ := ts.Client().Get(ts.URL)
fmt.Println(resp.Proto) // "HTTP/2.0"
```

Note: `EnableHTTP2` is only honoured by `StartTLS`, not `Start`. HTTP/2 over plaintext (h2c) is not supported by the stdlib `*http.Server` without extra packages.

---

## Customising the listener

The default listener binds to `127.0.0.1:0`. If you need a different address (e.g. to test IPv6 paths), build the listener yourself:

```go
l, err := net.Listen("tcp", "[::1]:0")
if err != nil {
    t.Fatal(err)
}

ts := httptest.NewUnstartedServer(handler)
ts.Listener = l
ts.Start()
t.Cleanup(ts.Close)
```

`ts.URL` is populated from the listener's address, so even with a custom listener you get a usable URL.

Don't do this just to pick a fixed port — that breaks parallel tests. Do it when you genuinely need IPv6, a Unix socket, or a custom `net.Listener` that injects fault behavior.

---

## Port-zero binding explained

When you call `net.Listen("tcp", "127.0.0.1:0")` (or `httptest.NewServer` does it for you), the kernel:

1. Allocates an ephemeral port from the configured range (`net.ipv4.ip_local_port_range` on Linux).
2. Binds the socket to `127.0.0.1:port`.
3. Returns the listener with `Addr()` reporting the assigned port.

Ephemeral ports are typically in `49152-65535` on Linux, `32768-60999` on default Linux configurations, or a wider range on other systems. They are released when the socket closes — *eventually*. There's a `TIME_WAIT` state of up to 60 seconds.

In practice, this never matters for tests under a thousand iterations. It matters when you run `go test -count=100000` on a build server and start getting "address already in use". Fix by calling `Close` (you should be calling it anyway) and by spacing out runs.

---

## Manual server on :0 versus httptest

Before `httptest` existed, the pattern was:

```go
l, _ := net.Listen("tcp", "127.0.0.1:0")
srv := &http.Server{Handler: handler}
go srv.Serve(l)

url := "http://" + l.Addr().String()
// ... tests ...

srv.Shutdown(context.Background())
```

Compare to:

```go
ts := httptest.NewServer(handler)
t.Cleanup(ts.Close)
url := ts.URL
```

The manual style:

- Forces you to write the readiness check yourself (`go srv.Serve(l)` returns before listening? No — `Listen` is what binds; `Serve` is the accept loop). Actually the manual style happens to work because `Listen` opens the socket synchronously. But it's fragile.
- Forces you to write `Shutdown` instead of `Close`.
- Forces you to construct the URL string yourself.
- Provides no TLS helper.

There is exactly one case where the manual style wins: when you need a `net.Listener` that isn't TCP — say, a `net.Pipe` for in-memory transport. Even then, `NewUnstartedServer` with a custom listener gets you most of the way.

---

## t.Cleanup, helpers, and shared servers

For a suite that creates similar test servers, factor out a helper:

```go
func startAPIServer(t *testing.T) *httptest.Server {
    t.Helper()
    mux := http.NewServeMux()
    mux.HandleFunc("/users", listUsers)
    mux.HandleFunc("/users/", getUser)
    ts := httptest.NewServer(mux)
    t.Cleanup(ts.Close)
    return ts
}

func TestUsersList(t *testing.T) {
    ts := startAPIServer(t)
    // ...
}
```

Three things to note:

- `t.Helper()` makes test failures point to the caller's line, not the helper's.
- The helper registers `t.Cleanup` itself, so callers don't have to remember.
- The helper takes a `*testing.T`, so it can use `t.Fatal` if setup fails.

For a *truly* shared server across all tests in a package (e.g. a stateless catalog API):

```go
var sharedServer *httptest.Server

func TestMain(m *testing.M) {
    sharedServer = httptest.NewServer(buildHandler())
    code := m.Run()
    sharedServer.Close()
    os.Exit(code)
}

func TestSomething(t *testing.T) {
    resp, _ := sharedServer.Client().Get(sharedServer.URL + "/path")
    // ...
}
```

Use sparingly. State across tests is hard to reason about.

---

## Subtests with httptest

Subtests via `t.Run` are the right structure for table-driven HTTP tests:

```go
func TestHandlers(t *testing.T) {
    ts := httptest.NewServer(myMux)
    t.Cleanup(ts.Close)

    tests := []struct {
        name   string
        path   string
        code   int
        body   string
    }{
        {"home", "/", 200, "welcome"},
        {"not_found", "/missing", 404, "404 page not found\n"},
        {"redirect", "/old", 301, ""},
    }
    for _, tc := range tests {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            resp, err := ts.Client().Get(ts.URL + tc.path)
            if err != nil {
                t.Fatal(err)
            }
            defer resp.Body.Close()
            if resp.StatusCode != tc.code {
                t.Fatalf("code = %d", resp.StatusCode)
            }
        })
    }
}
```

Adding `t.Parallel()` to each subtest is safe as long as the server is stateless. If the handler mutates state, you have a race.

---

## Race-safety across parallel tests

The race detector (`go test -race`) is your friend. A test suite that runs clean under `-race` is one where:

- Every handler write to shared state is protected.
- Every test that uses `t.Parallel` has independent server state (or shared-but-locked state).
- Every assertion happens after the goroutine that wrote the asserted value has synchronised.

Common race patterns and fixes:

**Race 1.** Handler increments a counter; test reads it.

```go
var n int
h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    n++ // RACE
})
```

Fix: `atomic.Int64`.

```go
var n atomic.Int64
h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    n.Add(1)
})
// test: n.Load()
```

**Race 2.** Handler appends to a slice; test reads it.

```go
var got []string
h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    got = append(got, r.URL.Path) // RACE
})
```

Fix: mutex around the slice, snapshot before assertion.

```go
var (
    mu  sync.Mutex
    got []string
)
h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    mu.Lock()
    got = append(got, r.URL.Path)
    mu.Unlock()
})
// test: mu.Lock(); defer mu.Unlock(); ...
```

**Race 3.** Closure captures a variable later mutated by the test goroutine.

```go
for i := 0; i < 3; i++ {
    t.Run(fmt.Sprint(i), func(t *testing.T) {
        t.Parallel()
        ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            fmt.Fprint(w, i) // RACE — i mutates
        }))
        // ...
    })
}
```

Fix: capture `i` in the loop.

```go
for i := 0; i < 3; i++ {
    i := i // capture
    t.Run(fmt.Sprint(i), func(t *testing.T) { ... })
}
```

Run `go test -race ./...` on every commit. Race-free tests are a property of the test, not the production code; you have to actively maintain it.

---

## Testing timeouts

Server timeouts (`ReadTimeout`, `WriteTimeout`, `IdleTimeout`) bound how long the server tolerates slow clients. Test them with `NewUnstartedServer`:

```go
func TestServerWriteTimeout(t *testing.T) {
    handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        time.Sleep(200 * time.Millisecond)
        fmt.Fprint(w, "late")
    })

    ts := httptest.NewUnstartedServer(handler)
    ts.Config.WriteTimeout = 50 * time.Millisecond
    ts.Start()
    t.Cleanup(ts.Close)

    _, err := ts.Client().Get(ts.URL)
    if err == nil {
        t.Fatal("expected timeout error")
    }
}
```

Client timeouts on the calling side:

```go
client := ts.Client()
client.Timeout = 50 * time.Millisecond

_, err := client.Get(ts.URL)
if !errors.Is(err, context.DeadlineExceeded) && !os.IsTimeout(err) {
    t.Fatalf("err = %v", err)
}
```

Keep test timeouts short (tens of milliseconds, not seconds). A slow test is a flaky test.

---

## Testing retries

Retry logic needs a server that fails the first N requests. The classic pattern:

```go
func TestRetry(t *testing.T) {
    var attempts atomic.Int64

    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        n := attempts.Add(1)
        if n < 3 {
            http.Error(w, "transient", http.StatusServiceUnavailable)
            return
        }
        w.Write([]byte("ok"))
    }))
    t.Cleanup(ts.Close)

    client := NewRetryClient(ts.Client(), 5) // your retry wrapper
    resp, err := client.Get(ts.URL)
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()

    if got := attempts.Load(); got != 3 {
        t.Fatalf("attempts = %d, want 3", got)
    }
}
```

Two `atomic.Int64` patterns appear together: count attempts, return success on the third. The test verifies both that the final response is correct *and* that the retry happened the right number of times.

Variants:

- Fail with different status codes (5xx vs 4xx) to test that only 5xx is retried.
- Fail with a connection reset (use `ts.CloseClientConnections()` mid-flight) to test network-level retries.
- Return a `Retry-After` header to test backoff respect.

---

## Inspecting requests received by the server

When you want to assert "the client sent the right request", record the request inside the handler:

```go
func TestClientHeaders(t *testing.T) {
    var got *http.Request

    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        got = r // safe — only one request in this test
        w.WriteHeader(http.StatusOK)
    }))
    t.Cleanup(ts.Close)

    client := ts.Client()
    req, _ := http.NewRequest("POST", ts.URL+"/path", strings.NewReader("body"))
    req.Header.Set("X-Foo", "bar")
    client.Do(req)

    if got == nil {
        t.Fatal("server never received a request")
    }
    if got.Header.Get("X-Foo") != "bar" {
        t.Fatalf("X-Foo = %q", got.Header.Get("X-Foo"))
    }
    body, _ := io.ReadAll(got.Body)
    if string(body) != "body" {
        t.Fatalf("body = %q", body)
    }
}
```

For multiple requests, collect them in a slice under a mutex (the race-2 pattern above).

Caveat: `got = r` captures a pointer to a request that the server may still be reading from. If you want to capture the *bytes*, read the body inside the handler before the assignment.

---

## Configurable response servers

A small library of helpers makes most tests one-liners:

```go
type respConfig struct {
    Status int
    Header http.Header
    Body   []byte
    Delay  time.Duration
}

func server(t *testing.T, cfg respConfig) *httptest.Server {
    t.Helper()
    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if cfg.Delay > 0 {
            time.Sleep(cfg.Delay)
        }
        for k, v := range cfg.Header {
            w.Header()[k] = v
        }
        if cfg.Status != 0 {
            w.WriteHeader(cfg.Status)
        }
        w.Write(cfg.Body)
    }))
    t.Cleanup(ts.Close)
    return ts
}
```

Used like:

```go
ts := server(t, respConfig{
    Status: 503,
    Body:   []byte(`{"error":"unavailable"}`),
})
```

Don't over-engineer. If your test needs an unusual response, write the handler inline. A 5-line handler in a test is clearer than a 50-line config struct.

---

## Common mistakes

**Calling `ts.Close()` twice.** Idempotent in Go 1.20+, but earlier versions would panic. Always call once.

**Calling `ts.Start()` twice.** Panics. Use `NewUnstartedServer` only when you need pre-start configuration; then `Start()` once.

**Setting `ts.Config` after `Start`.** Has no effect. The server has already captured the values.

**Using `InsecureSkipVerify` instead of `ts.Client()`.** Masks real verification bugs.

**Mutating `ts.URL` to "fix" it.** Don't. Read-only.

**Calling `t.Cleanup(ts.Close)` from a goroutine.** Cleanups must be registered on the *test* goroutine. Doing it from a worker goroutine is a race on `*testing.T`.

**Expecting `EnableHTTP2 = true` to upgrade a plain `NewServer`.** It's only honoured by `StartTLS`. HTTP/2 cannot run cleartext through `httptest`.

---

## Best practices

- **One server per test, unless it's stateless.** Stateless = no in-memory mutation. The catalog returns the same JSON every time? Share it via `TestMain`.
- **`ts.Client()` instead of `http.DefaultClient`.** Future-proofs TLS upgrades and avoids global state.
- **Helpers for setup, never for assertions.** A helper that asserts hides the failing line.
- **`t.Helper()` in every test helper.** Failures point to the caller.
- **`-race` on every CI run.** Without it, the test passes locally and fails in production.
- **Short timeouts.** Anything over 200ms in a unit test is a smell.
- **Keep handlers in tests under 20 lines.** Long handlers in tests are a sign your production handler is too complex.

---

## Self-assessment checklist

- [ ] You can write a TLS test with `httptest.NewTLSServer` and assert against `ts.Client()`.
- [ ] You can build a custom transport that trusts the test cert.
- [ ] You can test a middleware in isolation with a stub `next` handler.
- [ ] You can refactor a function that calls `http.Get` to be testable.
- [ ] You know when to use `NewUnstartedServer` versus `NewServer`.
- [ ] You can write a parallel-safe handler that records every request without a race.
- [ ] You can test retry logic by failing the first N requests.
- [ ] You can test client and server timeouts with sub-second values.
- [ ] You always pair `httptest.NewServer` with `t.Cleanup` from a `t.Helper()`-marked helper.

---

## Summary

You have learned how to test TLS, middleware chains, and `*http.Client` code with `httptest`. You know to use `ts.Client()` for TLS verification, `NewUnstartedServer` for pre-start configuration, and helpers with `t.Helper()` to keep test code tidy. You can write retries, timeouts, and request-inspection tests without flakes.

Next:

- `senior.md` — streaming, chunked encoding, hijack limits, context and deadline propagation.
- `professional.md` — OAuth, webhooks, multi-server fan-out, go-vcr/gock interop.

---

## Further reading

- `src/net/http/httptest/server.go` — the source for `NewServer`, `NewTLSServer`, and `Client()`.
- `src/net/http/serve_test.go` — extensive use of `httptest` to test the server itself.
- Russ Cox, "Don't use Go's default HTTP client (in production)" — sets up the case for injecting your own `*http.Client`.
- `golang.org/x/net/http2` — for tests that need explicit HTTP/2 frame inspection.

---

## Appendix A — Authentication middleware deep dive

Authentication is one of the most common middlewares in production code. Let's build a thorough test suite for a JWT-style middleware that:

1. Reads a token from the `Authorization: Bearer <token>` header.
2. Validates the token against a secret.
3. Injects the claims (user ID, scope) into the request context.
4. Returns 401 on missing or invalid tokens.

The middleware:

```go
type claims struct {
    UserID string
    Scope  []string
}

type claimsKey struct{}

func ClaimsFromContext(ctx context.Context) (claims, bool) {
    c, ok := ctx.Value(claimsKey{}).(claims)
    return c, ok
}

func AuthMiddleware(verify func(token string) (claims, error)) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            authHeader := r.Header.Get("Authorization")
            if !strings.HasPrefix(authHeader, "Bearer ") {
                http.Error(w, "missing bearer token", http.StatusUnauthorized)
                return
            }
            token := strings.TrimPrefix(authHeader, "Bearer ")
            c, err := verify(token)
            if err != nil {
                http.Error(w, "invalid token", http.StatusUnauthorized)
                return
            }
            ctx := context.WithValue(r.Context(), claimsKey{}, c)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

The test suite — note how a small `fakeVerify` is sufficient; we don't need a real JWT library:

```go
func fakeVerify(token string) (claims, error) {
    switch token {
    case "good-admin":
        return claims{UserID: "u1", Scope: []string{"admin"}}, nil
    case "good-user":
        return claims{UserID: "u2", Scope: []string{"read"}}, nil
    default:
        return claims{}, errors.New("bad token")
    }
}

func TestAuth_Valid(t *testing.T) {
    var seen claims
    inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        c, _ := ClaimsFromContext(r.Context())
        seen = c
        w.WriteHeader(http.StatusOK)
    })

    mw := AuthMiddleware(fakeVerify)(inner)

    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer good-admin")
    mw.ServeHTTP(rec, req)

    if rec.Code != http.StatusOK {
        t.Fatalf("code = %d", rec.Code)
    }
    if seen.UserID != "u1" {
        t.Fatalf("UserID = %q", seen.UserID)
    }
    if len(seen.Scope) != 1 || seen.Scope[0] != "admin" {
        t.Fatalf("Scope = %v", seen.Scope)
    }
}

func TestAuth_Missing(t *testing.T) {
    inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        t.Fatal("inner should not be called")
    })
    mw := AuthMiddleware(fakeVerify)(inner)

    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/", nil)
    mw.ServeHTTP(rec, req)

    if rec.Code != http.StatusUnauthorized {
        t.Fatalf("code = %d", rec.Code)
    }
}

func TestAuth_Invalid(t *testing.T) {
    inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        t.Fatal("inner should not be called")
    })
    mw := AuthMiddleware(fakeVerify)(inner)

    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer wrong")
    mw.ServeHTTP(rec, req)

    if rec.Code != http.StatusUnauthorized {
        t.Fatalf("code = %d", rec.Code)
    }
}

func TestAuth_MalformedHeader(t *testing.T) {
    cases := []string{
        "Basic dXNlcjpwYXNz", // wrong scheme
        "Bearer",              // no token
        "bearer good-admin",   // wrong case
        "Bearer  good-admin",  // double space
    }
    for _, h := range cases {
        h := h
        t.Run(h, func(t *testing.T) {
            inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
            mw := AuthMiddleware(fakeVerify)(inner)

            rec := httptest.NewRecorder()
            req := httptest.NewRequest("GET", "/", nil)
            req.Header.Set("Authorization", h)
            mw.ServeHTTP(rec, req)

            if rec.Code != http.StatusUnauthorized {
                t.Fatalf("code = %d for header %q", rec.Code, h)
            }
        })
    }
}
```

Observations.

- We don't test the JWT library. We test the middleware's contract: did it parse the header, did it call `verify`, did it inject claims on success, did it short-circuit on failure?
- We assert that `inner` is *not* called on failure. A subtle bug class: middleware that returns 401 but also calls `next` anyway.
- We enumerate the malformed-header cases as a table. Four lines of test data, one parameterised test function.

For end-to-end testing — combining `AuthMiddleware` with a `httptest.NewServer` — the pattern is the same as in [Testing http.Client code](#testing-httpclient-code). Mount the middleware on a mux, start the server, hit it with a real HTTP client.

---

## Appendix B — Rate-limit middleware testing

A rate limiter that allows `N` requests per second. Token-bucket style. The middleware:

```go
type Limiter interface {
    Allow() bool
}

func RateLimit(l Limiter) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if !l.Allow() {
                http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

To test, inject a fake limiter:

```go
type allowN struct {
    remaining atomic.Int64
}

func (a *allowN) Allow() bool {
    return a.remaining.Add(-1) >= 0
}

func TestRateLimit(t *testing.T) {
    l := &allowN{}
    l.remaining.Store(3)

    inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    })
    mw := RateLimit(l)(inner)

    ts := httptest.NewServer(mw)
    t.Cleanup(ts.Close)

    var ok, throttled int
    for i := 0; i < 5; i++ {
        resp, _ := ts.Client().Get(ts.URL)
        resp.Body.Close()
        switch resp.StatusCode {
        case 200:
            ok++
        case 429:
            throttled++
        }
    }

    if ok != 3 || throttled != 2 {
        t.Fatalf("ok=%d throttled=%d", ok, throttled)
    }
}
```

A real time-windowed limiter is harder to test deterministically. Strategies:

- **Inject a clock.** Make the limiter take `func() time.Time`. Pass a fake clock in tests.
- **Tight bursts.** Hit the endpoint as fast as Go can in a loop; assert that *more than N* responses come back 429. Doesn't pin the exact count but catches gross misconfiguration.
- **Per-test limiter.** Build a fresh limiter per test; no state across tests.

Don't `time.Sleep` between requests to "let the bucket refill". Slow, flaky, unnecessary.

---

## Appendix C — Logging middleware testing

A logger middleware that writes structured logs and propagates a request ID:

```go
type reqIDKey struct{}

func RequestID(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Request-ID")
        if id == "" {
            id = newID() // assume deterministic in tests; inject if needed
        }
        ctx := context.WithValue(r.Context(), reqIDKey{}, id)
        w.Header().Set("X-Request-ID", id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

func Logger(w io.Writer) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
            id, _ := r.Context().Value(reqIDKey{}).(string)
            start := time.Now()
            wrapped := &statusRecorder{ResponseWriter: rw, status: 200}
            next.ServeHTTP(wrapped, r)
            fmt.Fprintf(w, "%s %s %d %s %v\n", id, r.Method, wrapped.status, r.URL.Path, time.Since(start))
        })
    }
}

type statusRecorder struct {
    http.ResponseWriter
    status int
}

func (s *statusRecorder) WriteHeader(code int) {
    s.status = code
    s.ResponseWriter.WriteHeader(code)
}
```

Test:

```go
func TestLogger_WritesLine(t *testing.T) {
    var buf bytes.Buffer
    inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusCreated)
    })
    chain := RequestID(Logger(&buf)(inner))

    rec := httptest.NewRecorder()
    req := httptest.NewRequest("POST", "/users", nil)
    req.Header.Set("X-Request-ID", "test-id")
    chain.ServeHTTP(rec, req)

    out := buf.String()
    if !strings.Contains(out, "test-id POST 201 /users") {
        t.Fatalf("log line = %q", out)
    }
}
```

Two key choices.

- The logger takes `io.Writer`. In production it's `os.Stderr`; in tests it's a `*bytes.Buffer`. Standard dependency injection.
- The status is captured by wrapping the `ResponseWriter`. The wrapper implements `WriteHeader` and forwards. This is a common pattern; it's also testable on its own:

```go
func TestStatusRecorder(t *testing.T) {
    rec := httptest.NewRecorder()
    sr := &statusRecorder{ResponseWriter: rec, status: 200}

    sr.WriteHeader(http.StatusTeapot)
    if sr.status != http.StatusTeapot {
        t.Fatalf("recorded status = %d", sr.status)
    }
    if rec.Code != http.StatusTeapot {
        t.Fatalf("inner code = %d", rec.Code)
    }
}
```

Three layers — the wrapper, the logger, the chain — each tested independently. Composition makes the tests trivial.

---

## Appendix D — A cheat sheet for parallelisation

| Situation | Use `t.Parallel`? | Use `t.Cleanup`? | Notes |
|---|---|---|---|
| `NewRecorder` test, no shared state | Yes | N/A (no resource) | Pure functions, parallel-safe. |
| `NewServer` test, fresh server per test | Yes | Yes | The server is local to the test. |
| `NewServer` test, shared server, stateless handler | Yes | Cleanup the server in `TestMain` | OK if the handler doesn't mutate. |
| `NewServer` test, shared server, stateful handler | No | Cleanup in `TestMain` | Mutation across tests is fragile. |
| Subtest table with `t.Run` | Yes per subtest | Once for the server | Standard table-driven pattern. |
| Test that mutates `http.DefaultClient` | No | N/A | Avoid mutating globals entirely. |

When in doubt: parallel + per-test server + `t.Cleanup`. It scales well and breaks predictably when state is shared.

---

## Appendix E — Testing cookie-based session middleware

Session cookies are the basic shape of stateful web auth. Test them by sending a cookie and asserting the handler accepts it.

```go
type sessionStore struct {
    mu       sync.Mutex
    sessions map[string]string // id -> user
}

func SessionMiddleware(s *sessionStore) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            c, err := r.Cookie("session")
            if err != nil {
                http.Error(w, "no session", http.StatusUnauthorized)
                return
            }
            s.mu.Lock()
            user, ok := s.sessions[c.Value]
            s.mu.Unlock()
            if !ok {
                http.Error(w, "bad session", http.StatusUnauthorized)
                return
            }
            ctx := context.WithValue(r.Context(), userKey{}, user)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}

func TestSession_Valid(t *testing.T) {
    store := &sessionStore{sessions: map[string]string{"sid-1": "alice"}}
    inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        u := r.Context().Value(userKey{})
        fmt.Fprint(w, u)
    })
    mw := SessionMiddleware(store)(inner)

    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/", nil)
    req.AddCookie(&http.Cookie{Name: "session", Value: "sid-1"})
    mw.ServeHTTP(rec, req)

    if rec.Code != 200 {
        t.Fatalf("code = %d", rec.Code)
    }
    if rec.Body.String() != "alice" {
        t.Fatalf("body = %q", rec.Body.String())
    }
}
```

For an end-to-end test, use a `*http.Client` with a cookie jar:

```go
func TestSession_EndToEnd(t *testing.T) {
    store := &sessionStore{sessions: map[string]string{"sid-1": "alice"}}
    ts := httptest.NewServer(SessionMiddleware(store)(myHandler))
    t.Cleanup(ts.Close)

    jar, _ := cookiejar.New(nil)
    client := ts.Client()
    client.Jar = jar

    // Manually inject the cookie before the first request.
    u, _ := url.Parse(ts.URL)
    jar.SetCookies(u, []*http.Cookie{{Name: "session", Value: "sid-1", Path: "/"}})

    resp, err := client.Get(ts.URL + "/me")
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        t.Fatalf("code = %d", resp.StatusCode)
    }
}
```

The jar pattern matters when your test issues a login (which sets the cookie) followed by an authenticated request (which sends it back). With a jar, the client handles cookie storage for you.

## Appendix F — File-upload handler testing

Multipart uploads need a multipart body. Testing with `httptest.NewRequest`:

```go
func TestUpload(t *testing.T) {
    var buf bytes.Buffer
    mw := multipart.NewWriter(&buf)
    mw.WriteField("name", "ada")
    fw, _ := mw.CreateFormFile("avatar", "ada.png")
    fw.Write([]byte("fake-png-bytes"))
    mw.Close()

    req := httptest.NewRequest("POST", "/upload", &buf)
    req.Header.Set("Content-Type", mw.FormDataContentType())

    rec := httptest.NewRecorder()
    UploadHandler(rec, req)

    if rec.Code != http.StatusCreated {
        t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
    }
}
```

The handler parses with `r.ParseMultipartForm(maxMemory)`. Common bugs:

- The handler reads the file before checking its `Content-Type` (security risk).
- The handler accepts files larger than the configured limit (DoS risk).
- The handler doesn't close the file from `r.FormFile`, leaking file descriptors.

Each is a separate test case with appropriately-sized inputs.

---

[← Back](../)
