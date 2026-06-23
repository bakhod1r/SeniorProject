---
layout: default
title: httptest — Interview
parent: net/http/httptest
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/04-httptest/interview/
---

# httptest — Interview

[← Back](../)

A bank of interview questions for `net/http/httptest`. Answers stay short on purpose; if a candidate cannot explain the why in one or two sentences, they probably do not understand the package.

## Basics

**1. What is `httptest.NewRequest` for and how does it differ from `http.NewRequest`?**
`httptest.NewRequest` builds a *server-side* `*http.Request` for handler tests. `http.NewRequest` builds an outgoing *client* request. The first sets `RequestURI` and `RemoteAddr`; the second does not.

**2. What is `httptest.NewRecorder` and what interface does it implement?**
It returns a `*ResponseRecorder` that implements `http.ResponseWriter`, plus `http.Flusher` via its `Flush` method. It captures status, headers, and body in memory.

**3. What's the difference between `NewRecorder` and `NewServer` testing styles?**
`NewRecorder` is in-process — no socket, no goroutine boundary, fastest. `NewServer` binds a real TCP listener on `127.0.0.1:0`, so it tests the full HTTP stack including parsing and connection management.

**4. Why does `NewServer` use `127.0.0.1:0` instead of a fixed port?**
Port `0` asks the kernel for a free ephemeral port, so multiple tests can run in parallel without colliding.

**5. How do you obtain the test server's URL?**
Through `server.URL`, which is a string like `http://127.0.0.1:54321` with no trailing slash.

**6. Must you call `server.Close()` and why?**
Yes. `Close` releases the listener (port) and waits for outstanding requests. Forgetting it leaks goroutines and TCP sockets across test runs.

**7. What does `t.Cleanup(server.Close)` give you over `defer server.Close()`?**
It runs even when subtests with `t.Parallel` run after the parent function returns; `defer` would fire too early.

**8. What is `httptest.NewTLSServer`?**
A test server that speaks HTTPS using an internally generated self-signed certificate.

**9. How do you verify the TLS handshake against the self-signed cert?**
Use `server.Client()`, which returns an `*http.Client` whose `Transport` has the test cert in its root pool.

**10. What is `httptest.NewUnstartedServer` for?**
It returns a `*Server` whose listener is open but the goroutine has not yet been started. You can mutate `Config` (timeouts, error log) or `EnableHTTP2`, then call `Start` or `StartTLS`.

## Behavior and semantics

**11. What status code does `ResponseRecorder.Code` default to?**
`200`. If the handler never calls `WriteHeader`, the recorder reports 200 even if no body was written.

**12. What does `ResponseRecorder.Result()` return?**
A `*http.Response` snapshot, useful for code that already speaks `*http.Response` — e.g. assertions on cookies via `(*Response).Cookies()`.

**13. When is `ResponseRecorder.Result()` safe to call?**
After the handler returns. Calling it while a handler goroutine still writes is racy.

**14. Does `ResponseRecorder` implement `http.Hijacker`?**
No. Tests that need hijacking must use `httptest.NewServer` with a real connection.

**15. Does `ResponseRecorder` implement `http.CloseNotifier`?**
No. Use `r.Context().Done()` instead — `CloseNotifier` is itself deprecated.

**16. What does `Server.Client()` give you beyond `&http.Client{}`?**
The returned client has the server's certificate in its root CA pool. It also disables persistent connections in some Go versions to keep test isolation predictable.

**17. What is `Server.CloseClientConnections`?**
A way to forcibly drop existing keep-alive connections without closing the listener. Useful when testing retry logic in clients.

**18. Can you enable HTTP/2 on a test server?**
Yes — set `server.EnableHTTP2 = true` on an `httptest.NewUnstartedServer` and call `StartTLS`. HTTP/2 requires TLS.

**19. What `RemoteAddr` does `httptest.NewRequest` set?**
`192.0.2.1:1234` from RFC 5737's TEST-NET-1 range, ensuring the address is never routable.

**20. What `Host` does `httptest.NewRequest` set if `target` is `/foo`?**
`example.com`.

## Common bugs

**21. A test passes when run alone but fails when run with `-race`. What's a likely cause?**
A handler under test writes to a shared variable from a goroutine while the test's main goroutine reads `recorder.Body` or `recorder.Result()`. Synchronise the goroutine before reading.

**22. Why might a CI run leak hundreds of ports?**
Forgetting `server.Close()` in a test that creates servers in a loop. Each leaks one listener until the process exits.

**23. What's wrong with `defer ts.Close()` inside a function that calls `t.Run(... go ...)`?**
If the subtest runs in parallel with the parent, `defer` may fire before the subtest finishes, closing the server underneath it.

**24. Why might `http.Get(server.URL)` fail with `x509: certificate signed by unknown authority`?**
The test server is a TLS server but the client is the default `http.Client`. Switch to `server.Client()` or install `server.Certificate()` in the transport's root pool.

**25. A test hangs on `server.Close()`. Why?**
A handler is still running and never returns — perhaps it's blocked on a channel send or read from a stalled body. `Close` calls `Shutdown` and waits.

## Advanced

**26. How do you simulate a slow server?**
In the handler, call `time.Sleep` or write a few bytes, `Flush()`, then sleep, then write more. With `httptest.NewServer`, the client sees real chunked behavior.

**27. How do you simulate a server that disconnects mid-response?**
Implement the handler with `http.Hijacker`, take the underlying conn, write partial bytes, then `conn.Close()`. The client will see `unexpected EOF`.

**28. How do you test streaming with `ResponseRecorder` only?**
You generally cannot — `ResponseRecorder` buffers in memory and does not stream. Use `httptest.NewServer` for streaming tests.

**29. How do you assert that a handler set a cookie?**
Call `rec.Result().Cookies()` and inspect, or read `rec.Header().Get("Set-Cookie")` for the raw line.

**30. How is `httptest` better than running an actual local server on `:0`?**
Less boilerplate, automatic shutdown via `Close`, integration with `Server.Client()` for TLS, no manual readiness check.

**31. What's the cost of `NewRecorder` per call?**
Cheap — a few allocations for `bytes.Buffer` and `http.Header`. Suitable for thousands of unit tests.

**32. What's the cost of `NewServer` per call?**
One real listener, one accept loop goroutine, one connection per request. Acceptable per test, expensive per benchmark iteration.

**33. Why does Go's standard library itself test HTTP handlers with `httptest`?**
Because handlers are the contract the package exposes. The package tests itself the way users test their code, catching regressions in middleware, redirects, and timeouts.

**34. Can `httptest` test middleware that calls `next.ServeHTTP`?**
Yes — wrap the middleware around a handler that records what it received (`w.Header()`, `r.Context()`, body) and assert from outside.

**35. When should you use `gock` or `go-vcr` instead of `httptest`?**
When the system under test calls an external service whose URL is hard-coded and not parameterisable. `httptest` is the first choice if the code accepts a configurable base URL.

## Streaming and protocol

**36. How would you test a handler that streams chunked output?**
Use `httptest.NewServer`. Inside the handler, type-assert to `http.Flusher` and call `Flush()` between writes. In the test, read `resp.Body` incrementally with `bufio.Scanner`, asserting on the chunks as they arrive.

**37. Can `ResponseRecorder` model `Transfer-Encoding: chunked`?**
No. It buffers all writes into one `bytes.Buffer` and returns them at the end. There is no client to see chunks individually.

**38. How do you test a handler that uses `http.Hijacker` to upgrade to WebSocket?**
With `httptest.NewServer`. Dial it manually with `net.Dial` and write a raw HTTP/1.1 upgrade request, then read the 101 response and continue with the negotiated protocol. The recorder cannot hijack.

**39. How do you assert that an HTTP response was sent over HTTP/2?**
After getting the response, check `resp.Proto == "HTTP/2.0"`. To force HTTP/2 in tests, set `EnableHTTP2 = true` on an `NewUnstartedServer` and call `StartTLS`.

**40. What's the difference between `Server.Close` and `Server.CloseClientConnections`?**
`Close` shuts down the listener and waits for handlers to finish. `CloseClientConnections` forcibly drops keep-alive connections without affecting the listener — useful for testing client retry behavior.

## Race-safety and parallelism

**41. Two parallel subtests share an `httptest.Server`. What synchronisation does the handler need?**
Any shared mutable state inside the handler needs `sync.Mutex` or `sync/atomic`. The accept loop is concurrent; multiple handler goroutines may run simultaneously.

**42. A test passes locally but `go test -race -count=100` produces intermittent failures. How do you diagnose?**
Run with `-race -count=100 -v` and look for the race detector's stack traces — they pin the racing reads/writes to specific lines.

**43. Why is `t.Cleanup` preferable to `defer` for `server.Close`?**
`t.Cleanup` waits for parallel subtests to finish before running. `defer` runs when the function returns, possibly before the parallel subtests start executing.

**44. Can `httptest.NewServer` itself race with concurrent requests?**
The server's accept loop is safe. The application handler is *your* code; if it mutates shared state without synchronisation, you have a race.

**45. Two tests both use `t.Setenv` to set the same variable. What happens?**
Each `t.Setenv` is scoped to the test; the variable is restored when the test ends. Two tests running in parallel that both call `t.Setenv("X", ...)` may see each other's values briefly. Avoid `t.Setenv` in parallel tests for the same variable.

## Production patterns

**46. How would you test code that calls a third-party HTTP API with a hard-coded URL?**
Either refactor to make the URL injectable, or wrap your code's transport and use `gock` to intercept. `httptest` cannot help if you can't change the URL.

**47. How do you test retry-with-backoff logic without making tests slow?**
Inject the backoff function (e.g. `backoff func(attempt int) time.Duration`). In tests, return zero. In production, return exponential delays.

**48. What does `httptest` offer over building a server with `net.Listen("tcp", "127.0.0.1:0")` + `srv.Serve`?**
Automatic Close that waits for handlers, automatic TLS via `NewTLSServer`, an `http.Client` preconfigured for the server's cert via `Client()`, and a guarantee that `URL` is populated before the function returns.

**49. How do you test that your handler propagates `r.Context()` to outgoing requests?**
Spin up a downstream `httptest.NewServer` that records `r.Context().Deadline()`. Issue a request to your handler with a context that has a deadline. Verify the downstream saw a deadline that traces back to the original.

**50. Can `httptest` test gRPC?**
Not directly. gRPC uses its own transport. Use `bufconn` (from `google.golang.org/grpc/test/bufconn`) for in-memory gRPC tests.

## Trick questions

**51. Does `httptest.NewRecorder()` ever return nil?**
No. It always returns a valid `*ResponseRecorder` with `Code: 200` and an empty `bytes.Buffer`.

**52. Does `httptest.NewServer` always bind to IPv4?**
On systems with IPv4 enabled, yes. On IPv6-only systems, it binds to `[::1]`. Hard-coding the address in tests is wrong.

**53. What is the default `User-Agent` of `ts.Client()`?**
`Go-http-client/1.1` for HTTP/1.1; `Go-http-client/2.0` for HTTP/2. Both are set by the transport, not by `httptest`.

**54. Is `httptest.NewRequest` safe to call from a benchmark loop?**
Yes, but each call allocates a fresh `*http.Request`. For maximum speed, build one request outside the loop and reuse it (if the body is nil or seekable).

**55. Can you `httptest.NewServer(nil)`?**
You can, but every request gets a 404 because there's no handler. The server starts fine; the absence of a handler is treated as `DefaultServeMux`, which has no routes registered in tests.

## Live coding (under five minutes each)

**56. Write the smallest possible handler test.**

```go
func TestSmall(t *testing.T) {
    rec := httptest.NewRecorder()
    h(rec, httptest.NewRequest("GET", "/", nil))
    if rec.Code != 200 {
        t.Fail()
    }
}
```

That's all. Six lines.

**57. Write a test that asserts a handler sets the Content-Type header.**

```go
func TestContentType(t *testing.T) {
    rec := httptest.NewRecorder()
    h(rec, httptest.NewRequest("GET", "/", nil))
    if rec.Header().Get("Content-Type") != "application/json" {
        t.Fatalf("ct = %q", rec.Header().Get("Content-Type"))
    }
}
```

**58. Write a test that asserts a POST body was decoded correctly.**

```go
func TestPost(t *testing.T) {
    body := strings.NewReader(`{"x":1}`)
    req := httptest.NewRequest("POST", "/", body)
    req.Header.Set("Content-Type", "application/json")
    rec := httptest.NewRecorder()
    h(rec, req)
    if rec.Code != 201 {
        t.Fatalf("code = %d", rec.Code)
    }
}
```

**59. Write a test that follows a redirect using `httptest.NewServer`.**

```go
func TestRedirect(t *testing.T) {
    ts := httptest.NewServer(myMux)
    t.Cleanup(ts.Close)
    resp, err := ts.Client().Get(ts.URL + "/old")
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    body, _ := io.ReadAll(resp.Body)
    if string(body) != "new content" {
        t.Fatalf("body = %q", body)
    }
}
```

**60. Write a test that asserts a 401 when the auth header is missing.**

```go
func TestAuthMissing(t *testing.T) {
    rec := httptest.NewRecorder()
    AuthMiddleware(noopHandler).ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
    if rec.Code != http.StatusUnauthorized {
        t.Fatalf("code = %d", rec.Code)
    }
}
```

## Discussion (5-10 minutes each)

**61. Walk through how `httptest.NewServer` opens a listener and starts the accept loop.**

The function calls `net.Listen("tcp", "127.0.0.1:0")` (falling back to IPv6 if needed). It constructs an `*http.Server` with the user's handler. It captures the listener's address into `ts.URL`. It launches `srv.Serve(listener)` in a goroutine. The function returns. By the time it returns, the listener is bound (the kernel has assigned a port and is ready to accept SYNs). The accept goroutine may not yet have run, but that's fine — the kernel queues incoming connections.

**62. Explain why `ts.Close` is safe to call from `t.Cleanup` registered before any goroutines.**

`Cleanup` runs in LIFO order. Once registered, it will fire when the test's `*testing.T` is finalised, which includes after all subtests have completed. `Close` internally serialises with the accept loop and waits for in-flight handlers via a `sync.WaitGroup`. There is no race because the listener is closed atomically before handlers are notified.

**63. Compare testing strategies: `httptest`, `gock`, `go-vcr`, `bufconn`.**

- `httptest`: standard library, real loopback HTTP. Best when URLs are configurable.
- `gock`: intercepts `http.DefaultTransport` patterns. Best for hard-coded URLs; downside: mutates globals.
- `go-vcr`: records real responses to YAML, replays on subsequent runs. Best for partner APIs you can record once.
- `bufconn`: in-memory `net.Conn` for gRPC. Not for HTTP, but the same idea — no real network.

**64. How would you test a handler that wraps `httputil.ReverseProxy`?**

Run two `httptest.NewServer` instances. One is the upstream that records what it receives. One is the proxy, configured to forward to the upstream's URL. Issue a request to the proxy. Assert on what the upstream observed and what the client received.

**65. Walk through how to test a server that requires mTLS.**

Build a CA-signed client certificate. Configure the server's `tls.Config.ClientAuth = tls.RequireAndVerifyClientCert` and `ClientCAs` with the CA. Build a `*http.Client` whose transport has the client cert in `Certificates` and the server's cert in `RootCAs`. The standard `ts.Client()` does not handle mTLS — you build everything explicitly.

## Failure modes to discuss

**66. What does it look like when a test leaks goroutines?**

`goleak` will report stacks parked in channel receives, `time.Sleep`, or `(*Conn).Read`. Without `goleak`, the test exits cleanly but `pprof` shows growing goroutine counts. CI memory may climb across thousands of test runs in a long-lived runner.

**67. What does it look like when `httptest.NewServer` exhausts ephemeral ports?**

`bind: address already in use` from the underlying listener, or `connect: cannot assign requested address` from the client. On Linux, `netstat -tn | grep TIME_WAIT | wc -l` shows tens of thousands. Fix: ensure every `NewServer` is paired with `Close`.

**68. What does a flaky TLS test look like?**

Intermittent `x509: certificate has expired` if your test cert is real and on a CI runner with skewed time. Use `httptest.NewTLSServer` (the built-in cert is valid until 2049) or freeze time in your test.

**69. What does a race-detector hit look like?**

A multi-line warning starting with `WARNING: DATA RACE` showing two stack traces — the read and the write — and the goroutines that performed each. Always fix; never suppress.

**70. What does a flaky timing test look like?**

`time.Sleep` of 10ms followed by a check, occasionally failing under CPU load. Fix: replace `time.Sleep` with synchronisation primitives (channels, `sync.WaitGroup`, `context`).

---

[← Back](../)
