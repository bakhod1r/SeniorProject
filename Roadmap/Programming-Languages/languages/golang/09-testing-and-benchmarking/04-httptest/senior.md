---
layout: default
title: httptest — Senior
parent: net/http/httptest
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/04-httptest/senior/
---

# httptest — Senior

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [What ResponseRecorder cannot do](#what-responserecorder-cannot-do)
5. [Streaming responses with NewServer](#streaming-responses-with-newserver)
6. [Chunked transfer encoding tests](#chunked-transfer-encoding-tests)
7. [Trailers](#trailers)
8. [Flush and the Flusher interface](#flush-and-the-flusher-interface)
9. [Server-sent events with httptest](#server-sent-events-with-httptest)
10. [Hijack and why ResponseRecorder cannot hijack](#hijack-and-why-responserecorder-cannot-hijack)
11. [The Date header in tests](#the-date-header-in-tests)
12. [Context propagation through middleware](#context-propagation-through-middleware)
13. [Deadline propagation tests](#deadline-propagation-tests)
14. [Client disconnect tests](#client-disconnect-tests)
15. [Slow-loris and slow-client simulations](#slow-loris-and-slow-client-simulations)
16. [Connection reuse and CloseClientConnections](#connection-reuse-and-closeclientconnections)
17. [Race-safe assertions on server-side state](#race-safe-assertions-on-server-side-state)
18. [Goroutine leak detection](#goroutine-leak-detection)
19. [Custom listeners — net.Pipe in-memory tests](#custom-listeners--netpipe-in-memory-tests)
20. [Testing HTTP/2 over TLS](#testing-http2-over-tls)
21. [Testing handlers that call other handlers](#testing-handlers-that-call-other-handlers)
22. [Edge cases and pitfalls](#edge-cases-and-pitfalls)
23. [Best practices](#best-practices)
24. [Self-assessment checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [Further reading](#further-reading)

---

## Introduction

This file is about the parts of HTTP that `ResponseRecorder` does not model and `NewServer` does. It covers streaming, chunked encoding, trailers, hijack, context propagation, client disconnect, and the race-safe assertions you need when handlers spawn goroutines. By the end you should be able to test a long-poll endpoint, a server-sent-events stream, and a handler that hijacks the connection — without flakes, without leaks, and without race detector hits.

Why does the seniority of these topics matter? Because most production HTTP bugs are not in the happy path. They are in: a client that disconnects before the server finishes; a handler that holds a goroutine waiting on a channel after the context is cancelled; a streaming response that doesn't flush; a deadline that should propagate down a middleware chain but doesn't. `httptest` is the right tool for testing each, but only if you understand its limitations.

---

## Prerequisites

- You've completed `junior.md` and `middle.md`.
- You know what `http.Flusher`, `http.Hijacker`, and `http.CloseNotifier` are (the last is deprecated).
- You can write a goroutine that listens on a channel and reads from a context.
- You know what `Transfer-Encoding: chunked` is at a high level.
- You can read `net/http`'s `ResponseWriter` documentation and locate where each interface check happens.

---

## Glossary

- **Chunked transfer encoding** — HTTP/1.1's mechanism for streaming a response whose total length isn't known upfront. Each chunk is prefixed with its size in hex.
- **Trailer** — an HTTP header sent *after* the response body, typically used for checksums or final metadata.
- **Hijack** — taking over the underlying `net.Conn` from the HTTP server. Used by WebSocket libraries.
- **Long poll** — a handler that doesn't return until an event happens or the client times out.
- **SSE** — Server-Sent Events. A streaming protocol over HTTP/1.1 with `Content-Type: text/event-stream`.
- **Flusher** — an optional interface a `ResponseWriter` may implement; `Flush()` pushes buffered bytes to the client immediately.

---

## What ResponseRecorder cannot do

`ResponseRecorder` is an excellent stand-in for `http.ResponseWriter`, but it doesn't model the full server. Things it does *not* support:

- **`http.Hijacker`.** No `Hijack()` method. Handlers that hijack will fail their type assertion and (typically) write a 500. This is by design — there's no underlying `net.Conn` to hand back.
- **`http.CloseNotifier`.** Deprecated; nobody should use it. `ResponseRecorder` doesn't implement it; use `r.Context().Done()` instead.
- **Real streaming.** `Flush()` sets `Flushed = true` on the recorder, but everything is still buffered into `rec.Body`. There's no client on the other side to receive partial bytes.
- **Trailer enforcement.** You can write to `rec.Header()` with `Trailer:` keys, and `Result()` will surface them, but there's no protocol-level validation.
- **Real `RemoteAddr`.** It's set to a TEST-NET-1 address. If your handler resolves DNS based on `RemoteAddr`, it'll see a fake.
- **Timeouts.** `ReadTimeout` and `WriteTimeout` are server-side; recorder doesn't have them.
- **Connection state.** No `TLS` field unless `target` was `https://`, and even then it's a synthetic `*tls.ConnectionState`.

When any of these matter, switch to `httptest.NewServer`. The full HTTP/1.1 (or HTTP/2) stack runs, the wire format is real, and the server-side rules apply.

---

## Streaming responses with NewServer

A streaming handler pushes bytes to the client over time without buffering the whole response. The minimal shape:

```go
func StreamHandler(w http.ResponseWriter, r *http.Request) {
    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming unsupported", http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "text/plain")
    for i := 0; i < 5; i++ {
        fmt.Fprintf(w, "line %d\n", i)
        flusher.Flush()
        time.Sleep(10 * time.Millisecond)
    }
}
```

Test it against `httptest.NewServer`:

```go
func TestStream(t *testing.T) {
    ts := httptest.NewServer(http.HandlerFunc(StreamHandler))
    t.Cleanup(ts.Close)

    resp, err := ts.Client().Get(ts.URL)
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()

    if resp.Header.Get("Transfer-Encoding") != "chunked" {
        t.Fatalf("want chunked, got %q", resp.Header.Get("Transfer-Encoding"))
    }

    sc := bufio.NewScanner(resp.Body)
    var lines []string
    for sc.Scan() {
        lines = append(lines, sc.Text())
    }
    if len(lines) != 5 {
        t.Fatalf("got %d lines: %v", len(lines), lines)
    }
}
```

The key observations:

- The server sets `Transfer-Encoding: chunked` automatically when the handler doesn't set `Content-Length` and `Flush()` is called. You don't set it yourself.
- The client receives lines as they're flushed, not all at the end. `bufio.Scanner` consumes them incrementally.
- The `ResponseRecorder` cannot model this — there's no client thread. The bytes would all sit in the buffer.

For finer assertions on chunked boundaries (line-by-line timing), you'd need to read raw bytes:

```go
buf := make([]byte, 1024)
n, _ := resp.Body.Read(buf)
// inspect n bytes, then read again
```

---

## Chunked transfer encoding tests

Chunked encoding is what HTTP/1.1 uses when the body's length isn't known at the start. The server emits chunks of `<hex-size>\r\n<bytes>\r\n` and a terminating `0\r\n\r\n`. Most code doesn't need to inspect chunks directly — Go's HTTP client decodes them transparently — but tests for low-level network code may need to.

To inspect raw chunked output, use `httputil.DumpResponse` or open a raw TCP connection:

```go
conn, _ := net.Dial("tcp", strings.TrimPrefix(ts.URL, "http://"))
defer conn.Close()
fmt.Fprintf(conn, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")

raw, _ := io.ReadAll(conn)
t.Logf("raw response:\n%q", raw)
```

You'll see the chunked framing in `raw`. This is rarely useful in unit tests — `bufio.Scanner` over `resp.Body` is more readable.

If you're writing client code that needs to handle chunked specifically, test by sending oddly-sized chunks from the server:

```go
ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    flusher := w.(http.Flusher)
    w.Write([]byte("a"))
    flusher.Flush()
    w.Write([]byte("bc"))
    flusher.Flush()
    w.Write([]byte("def"))
}))
t.Cleanup(ts.Close)

resp, _ := ts.Client().Get(ts.URL)
body, _ := io.ReadAll(resp.Body)
if string(body) != "abcdef" {
    t.Fatalf("got %q", body)
}
```

The chunks were three (`a`, `bc`, `def`) plus the final close. The client reassembles to `abcdef`. If your client code reads byte-by-byte for some reason, this is the test.

---

## Trailers

Trailers are headers sent *after* the body. They're rare but legal. The handler must declare them in advance:

```go
func TrailerHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Trailer", "X-Md5")
    w.Header().Set("Transfer-Encoding", "chunked") // optional; Go does this automatically
    h := md5.New()
    body := []byte("hello world")
    h.Write(body)
    w.Write(body)
    w.Header().Set("X-Md5", hex.EncodeToString(h.Sum(nil)))
}
```

Test:

```go
func TestTrailer(t *testing.T) {
    ts := httptest.NewServer(http.HandlerFunc(TrailerHandler))
    t.Cleanup(ts.Close)

    resp, err := ts.Client().Get(ts.URL)
    if err != nil {
        t.Fatal(err)
    }
    body, _ := io.ReadAll(resp.Body)
    resp.Body.Close()

    if string(body) != "hello world" {
        t.Fatalf("body = %q", body)
    }
    if got := resp.Trailer.Get("X-Md5"); got != "5eb63bbbe01eeed093cb22bb8f5acdc3" {
        t.Fatalf("trailer = %q", got)
    }
}
```

`resp.Trailer` is populated *after* the body is fully read. If you read `Trailer` before draining `Body`, it's empty.

`ResponseRecorder` has partial support: headers with the `Trailer:` prefix are surfaced in `Result().Trailer`. But there's no enforcement that they were declared in advance, so the recorder doesn't catch protocol bugs.

---

## Flush and the Flusher interface

`http.Flusher` is the contract for pushing buffered bytes to the client. The real server's `ResponseWriter` implements it; `ResponseRecorder` implements it (in the sense of setting `Flushed = true`, not actually flushing because there's no socket).

Pattern for handlers that *require* flushing:

```go
func StreamHandler(w http.ResponseWriter, r *http.Request) {
    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming unsupported", http.StatusInternalServerError)
        return
    }
    // ...
}
```

To test the failure branch with `NewRecorder`:

```go
rec := httptest.NewRecorder()
// rec implements Flusher, so the assertion succeeds — but only Flushed bool is set.
```

You can't easily simulate "this writer doesn't implement Flusher". One trick — wrap the recorder in a struct that only embeds the methods you want to expose:

```go
type noFlush struct {
    http.ResponseWriter
}
// Now noFlush does *not* embed Flush(), so the type assertion fails.
// (Wait — this won't compile if ResponseWriter embeds Flush... it doesn't.
// Flusher is a separate interface; embedding ResponseWriter is fine.)
```

Then:

```go
rec := httptest.NewRecorder()
nf := &noFlush{ResponseWriter: rec}
StreamHandler(nf, httptest.NewRequest("GET", "/", nil))
if rec.Code != http.StatusInternalServerError {
    t.Fatalf("code = %d", rec.Code)
}
```

This is the right way to test "what happens if my writer can't flush" — wrap the recorder to hide the interface.

---

## Server-sent events with httptest

SSE is a streaming protocol with `Content-Type: text/event-stream`, lines starting with `data:`, and a blank line as separator. Test it like any other stream:

```go
func SSEHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/event-stream")
    flusher := w.(http.Flusher)
    for i := 0; i < 3; i++ {
        fmt.Fprintf(w, "data: event-%d\n\n", i)
        flusher.Flush()
    }
}

func TestSSE(t *testing.T) {
    ts := httptest.NewServer(http.HandlerFunc(SSEHandler))
    t.Cleanup(ts.Close)

    resp, err := ts.Client().Get(ts.URL)
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()

    if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
        t.Fatalf("Content-Type = %q", ct)
    }

    sc := bufio.NewScanner(resp.Body)
    var events []string
    for sc.Scan() {
        line := sc.Text()
        if strings.HasPrefix(line, "data: ") {
            events = append(events, strings.TrimPrefix(line, "data: "))
        }
    }
    if len(events) != 3 {
        t.Fatalf("events = %v", events)
    }
}
```

For long-running SSE streams, bound the test with a context:

```go
ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
defer cancel()

req, _ := http.NewRequestWithContext(ctx, "GET", ts.URL, nil)
resp, _ := ts.Client().Do(req)
// read events until ctx fires or stream closes
```

---

## Hijack and why ResponseRecorder cannot hijack

`http.Hijacker` lets a handler take the raw `net.Conn`:

```go
func WSHandler(w http.ResponseWriter, r *http.Request) {
    h, ok := w.(http.Hijacker)
    if !ok {
        http.Error(w, "hijack unsupported", http.StatusInternalServerError)
        return
    }
    conn, bufrw, err := h.Hijack()
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    defer conn.Close()
    // ... raw I/O ...
    bufrw.WriteString("HTTP/1.1 101 Switching Protocols\r\n\r\n")
    bufrw.Flush()
}
```

`ResponseRecorder` does *not* implement `Hijacker`. The type assertion fails. To test a hijacking handler you must use `httptest.NewServer`:

```go
func TestHijack(t *testing.T) {
    ts := httptest.NewServer(http.HandlerFunc(WSHandler))
    t.Cleanup(ts.Close)

    conn, err := net.Dial("tcp", strings.TrimPrefix(ts.URL, "http://"))
    if err != nil {
        t.Fatal(err)
    }
    defer conn.Close()

    fmt.Fprintf(conn, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")

    rdr := bufio.NewReader(conn)
    line, _ := rdr.ReadString('\n')
    if !strings.HasPrefix(line, "HTTP/1.1 101") {
        t.Fatalf("first line = %q", line)
    }
}
```

You're now writing raw TCP. The server's HTTP framing is gone after the hijack; both sides speak whatever protocol they negotiated (WebSocket, raw bytes, custom).

For testing WebSocket libraries (gorilla/websocket, nhooyr/websocket), this is the right shape, but most teams use the library's own test helpers rather than writing raw TCP. `httptest.NewServer` gives you the foundation; the library builds on top.

---

## The Date header in tests

The server adds a `Date` header automatically on every response. In tests, this means:

```go
ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
resp, _ := http.Get(ts.URL)
fmt.Println(resp.Header.Get("Date")) // "Mon, 02 Jan 2006 15:04:05 GMT"
```

This is a problem only for *exact* response comparisons. If you record a "golden" response and assert byte-equality, the `Date` will differ on every run.

Two mitigations:

1. **Strip `Date` before comparing.** `resp.Header.Del("Date")` is a one-liner.
2. **Inject a deterministic time source.** If your handler explicitly sets `Date` from a clock you control, the server's auto-Date is overridden. The standard library respects whatever the handler set.

For most assertions you check specific headers, not the whole header set, and `Date` doesn't come up.

---

## Context propagation through middleware

A middleware chain that injects values, deadlines, or cancellation into the context must be tested for *propagation*. The pattern uses a stub inner handler that snapshots the context:

```go
type ctxSnapshot struct {
    User     string
    Deadline time.Time
    DeadOk   bool
}

func snapshotHandler() (*ctxSnapshot, http.Handler) {
    snap := &ctxSnapshot{}
    return snap, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if u, ok := r.Context().Value(userKey{}).(string); ok {
            snap.User = u
        }
        if d, ok := r.Context().Deadline(); ok {
            snap.Deadline = d
            snap.DeadOk = true
        }
        w.WriteHeader(http.StatusOK)
    })
}

func TestChainPropagates(t *testing.T) {
    snap, inner := snapshotHandler()
    chain := AuthMiddleware(TimeoutMiddleware(5*time.Second, inner))

    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer good")
    chain.ServeHTTP(rec, req)

    if snap.User != "alice" {
        t.Fatalf("user not propagated: %q", snap.User)
    }
    if !snap.DeadOk {
        t.Fatal("deadline not propagated")
    }
}
```

The snapshot trick scales to any number of context values. It's strictly better than asserting on side effects (e.g. "the response body contains the user name") because it tests the *contract* of the middleware: did it set the right value in the context?

---

## Deadline propagation tests

A deadline middleware must set `context.WithDeadline` on the request. To verify it propagates to *outbound* HTTP calls from the handler, you need a downstream test server that records the deadline it saw.

```go
func TestDeadlinePropagates(t *testing.T) {
    var downstreamDeadline time.Time
    var downstreamHasDL bool

    downstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        d, ok := r.Context().Deadline()
        downstreamDeadline = d
        downstreamHasDL = ok
        w.WriteHeader(http.StatusOK)
    }))
    t.Cleanup(downstream.Close)

    upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        req, _ := http.NewRequestWithContext(r.Context(), "GET", downstream.URL, nil)
        resp, err := http.DefaultClient.Do(req)
        if err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }
        resp.Body.Close()
    }))
    t.Cleanup(upstream.Close)

    client := upstream.Client()
    ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
    defer cancel()
    req, _ := http.NewRequestWithContext(ctx, "GET", upstream.URL, nil)
    _, _ = client.Do(req)

    if !downstreamHasDL {
        t.Fatal("downstream did not see a deadline")
    }
    // The propagated deadline should be roughly 500ms from now.
    remaining := time.Until(downstreamDeadline)
    if remaining > 500*time.Millisecond || remaining < 0 {
        t.Fatalf("unexpected remaining: %v", remaining)
    }
}
```

Caveats:

- Server-side `r.Context()` deadline is *not* the same as the client-side deadline. The server's context cancels when the client disconnects, not based on the client's deadline. The deadline doesn't travel over the wire by default — you'd need to encode it in a header (e.g. `Grpc-Timeout` from gRPC).
- This test, as written, won't actually see a deadline on the downstream side unless the upstream handler explicitly propagates the client's deadline by setting `context.WithDeadline` based on a header. Adjust accordingly to your code's convention.

The pattern is the right one: pair two `httptest.NewServer` instances, have the upstream call the downstream, and assert on what the downstream observed.

---

## Client disconnect tests

A handler should react when the client disconnects mid-request. The signal is `r.Context().Done()`. Test:

```go
func TestClientDisconnect(t *testing.T) {
    started := make(chan struct{})
    finished := make(chan struct{})

    handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        close(started)
        select {
        case <-r.Context().Done():
            close(finished)
        case <-time.After(2 * time.Second):
            t.Error("handler did not see disconnect")
            close(finished)
        }
    })

    ts := httptest.NewServer(handler)
    t.Cleanup(ts.Close)

    ctx, cancel := context.WithCancel(context.Background())
    req, _ := http.NewRequestWithContext(ctx, "GET", ts.URL, nil)
    go func() {
        ts.Client().Do(req) // we ignore the error; the cancel will produce one
    }()

    <-started
    cancel()
    <-finished
}
```

Two synchronisation channels (`started`, `finished`) coordinate the test goroutine with the handler. The pattern generalises to any "did the handler respond to event X" test.

---

## Slow-loris and slow-client simulations

A "slow loris" client trickles bytes to exhaust server resources. To simulate one, open a raw TCP connection and send the request a byte at a time:

```go
func TestSlowClient(t *testing.T) {
    ts := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprint(w, "ok")
    }))
    ts.Config.ReadTimeout = 100 * time.Millisecond
    ts.Start()
    t.Cleanup(ts.Close)

    addr := strings.TrimPrefix(ts.URL, "http://")
    conn, err := net.Dial("tcp", addr)
    if err != nil {
        t.Fatal(err)
    }
    defer conn.Close()

    // Send "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n" one byte at a time, slowly.
    msg := "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n"
    for i := 0; i < len(msg); i++ {
        if _, err := conn.Write([]byte{msg[i]}); err != nil {
            break
        }
        time.Sleep(20 * time.Millisecond)
    }

    // Read response — the server should have closed by now.
    conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
    buf := make([]byte, 256)
    n, err := conn.Read(buf)
    if n > 0 {
        t.Fatalf("server responded despite ReadTimeout: %s", buf[:n])
    }
    // err is io.EOF or a network error — both are OK.
    _ = err
}
```

This exercises `ReadTimeout` enforcement. Real DoS protection is more elaborate (`ReadHeaderTimeout`, `Server.ConnState`), and tests for it are similar in shape: raw TCP, deliberately slow, assert the server eventually disconnects.

---

## Connection reuse and CloseClientConnections

`ts.CloseClientConnections()` forcibly closes any open keep-alive connections without waiting for handlers. Useful for testing client retry on connection reset:

```go
func TestClientRetryOnReset(t *testing.T) {
    var attempts atomic.Int64

    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        n := attempts.Add(1)
        if n == 1 {
            // First attempt: hijack and close to simulate connection reset.
            hj, ok := w.(http.Hijacker)
            if !ok {
                t.Error("hijack unsupported")
                return
            }
            conn, _, _ := hj.Hijack()
            conn.Close()
            return
        }
        fmt.Fprint(w, "ok")
    }))
    t.Cleanup(ts.Close)

    client := NewRetryClient(ts.Client(), 3)
    resp, err := client.Get(ts.URL)
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()

    if attempts.Load() != 2 {
        t.Fatalf("attempts = %d", attempts.Load())
    }
}
```

`ts.CloseClientConnections` is a server-side equivalent: instead of failing per-request, it drops *all* open keep-alive connections. Use it when you want to test client behavior on idle-connection invalidation.

---

## Race-safe assertions on server-side state

When the handler updates state that the test goroutine later reads, you need either:

1. A mutex around the state.
2. An atomic.
3. A channel from the handler to the test signaling that the write is done.

Pattern 3 is often the cleanest for one-shot tests:

```go
func TestHandlerWroteX(t *testing.T) {
    var captured string
    done := make(chan struct{})

    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        captured = r.Header.Get("X-Foo")
        close(done)
        w.WriteHeader(http.StatusOK)
    }))
    t.Cleanup(ts.Close)

    req, _ := http.NewRequest("GET", ts.URL, nil)
    req.Header.Set("X-Foo", "bar")
    resp, err := ts.Client().Do(req)
    if err != nil {
        t.Fatal(err)
    }
    resp.Body.Close()

    <-done
    if captured != "bar" {
        t.Fatalf("captured = %q", captured)
    }
}
```

The `<-done` synchronises with the write to `captured`, satisfying the race detector. No mutex needed.

For multiple requests, use a slice + mutex:

```go
var (
    mu      sync.Mutex
    seen    []string
)
ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    mu.Lock()
    seen = append(seen, r.URL.Path)
    mu.Unlock()
    w.WriteHeader(http.StatusOK)
}))
```

Always take `mu` before reading `seen` from the test goroutine.

---

## Goroutine leak detection

A handler that spawns a goroutine and never reaps it leaks. The standard tool is `go.uber.org/goleak`:

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Or per-test:

```go
func TestNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    ts := httptest.NewServer(handler)
    t.Cleanup(ts.Close)
    // ...
}
```

If your test leaks goroutines, `goleak.VerifyTestMain` makes the package's exit code non-zero and prints the leaked goroutine's stack. Common leak sources:

- A handler spawns `go func() { ... <-ch ... }()` and never closes `ch`.
- A handler reads from `r.Body` without bounding the read, and the test sends more bytes than the handler expects.
- `ts.Close()` is missing.

`goleak` is third-party but standard in Go ecosystem. It's the closest thing to a leak detector the language has.

---

## Custom listeners — net.Pipe in-memory tests

For genuinely in-memory transport, `net.Pipe()` creates a paired `net.Conn` with no kernel sockets:

```go
c1, c2 := net.Pipe()
defer c1.Close()
defer c2.Close()

// c1 is the "server" end; c2 is the "client" end.
```

You can wrap one end in a `net.Listener` that returns it once, then use `NewUnstartedServer.Listener = listener`. This gives you HTTP over a Go channel — fully in-process, no socket, no port allocation. Useful for tests that want zero filesystem/network interaction.

Most teams don't bother — `httptest.NewServer` on loopback is fast enough. But for ultra-fast unit suites or for environments where binding to loopback is restricted (some sandboxes), `net.Pipe` is the right answer.

---

## Testing HTTP/2 over TLS

HTTP/2 in `httptest` requires `EnableHTTP2 = true` + `StartTLS`:

```go
ts := httptest.NewUnstartedServer(http.HandlerFunc(handler))
ts.EnableHTTP2 = true
ts.StartTLS()
t.Cleanup(ts.Close)

resp, _ := ts.Client().Get(ts.URL)
if resp.Proto != "HTTP/2.0" {
    t.Fatalf("proto = %q", resp.Proto)
}
```

The `ts.Client()` is preconfigured to negotiate ALPN. The server presents an `h2`-capable certificate. Concurrent streams, multiplexing, and header compression all work out of the box.

For tests that need to verify HTTP/2-specific behavior — server push, stream priorities, GOAWAY frames — you'll need to import `golang.org/x/net/http2` and operate at the framing level. That's outside `httptest`'s scope; `httptest` provides the server, the rest is on `http2`.

---

## Testing handlers that call other handlers

Composition pattern: handler A calls handler B internally (not via HTTP, but via direct function call). Test by recording what B receives:

```go
type recordingHandler struct {
    Got []*http.Request
    mu  sync.Mutex
}

func (h *recordingHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    h.mu.Lock()
    h.Got = append(h.Got, r)
    h.mu.Unlock()
    w.WriteHeader(http.StatusOK)
}

func TestCompositeHandler(t *testing.T) {
    inner := &recordingHandler{}
    outer := NewOuterHandler(inner)

    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/path", nil)
    outer.ServeHTTP(rec, req)

    inner.mu.Lock()
    n := len(inner.Got)
    inner.mu.Unlock()
    if n != 1 {
        t.Fatalf("inner called %d times", n)
    }
}
```

This is the in-process equivalent of the multi-server fan-out tests in `professional.md`. Use direct calls when the handlers are in the same process; use `httptest.NewServer` when they need to be discoverable via URL.

---

## Edge cases and pitfalls

**`ResponseRecorder` does not enforce header validity.** You can set `w.Header().Set("X-Bad\r\nInjection: yes", ...)` in tests and the recorder will happily store it. The real server rejects it. Hand-write a validator if you care.

**`Result().Body` cannot be re-read.** It's a one-shot `io.NopCloser`. Read it into a buffer if you need it twice.

**`Result()` clones headers but not the body.** Mutating `Result().Header` doesn't affect `rec.HeaderMap`, but `Result().Body` and `rec.Body` share the same underlying buffer.

**`ts.Close()` waits for handlers.** A handler that sleeps 30 seconds in a `select` makes your test slow. Bound with `r.Context()` and trigger cancellation by closing the client.

**`http.Client.Timeout` includes connection setup, sending the request, *and* reading the body.** A test that expects "10ms timeout fires while reading body" can be fooled if the body fits in one TCP segment and arrives before the timeout. Use a streaming server that delays mid-body.

**TLS handshake can be slow on first run.** Especially on a cold cache. If your test asserts on sub-100ms latency, run a warm-up request first.

**`net/http` shares `http.DefaultTransport` globally.** If your test mutates it (don't), other tests are affected. Always use `ts.Client()` or a fresh transport.

**`runtime.GOMAXPROCS(1)`** in a benchmark can serialise behavior that's normally concurrent. Tests that depend on real concurrency should not run under GOMAXPROCS=1.

---

## Best practices

- **Use `NewServer` for streaming, hijack, timeouts, TLS.** `NewRecorder` is wrong for any of these.
- **Synchronise reads of handler-side state.** Mutex, atomic, or done-channel — pick one.
- **Run with `-race -count=10`.** Cheap insurance.
- **Use `goleak` in `TestMain`.** Catches handler leaks early.
- **Bound every test with a top-level timeout.** `go test -timeout=30s` (default is 10m; that's too long).
- **Prefer raw TCP over `bufio.Scanner`** when you need to assert on byte boundaries.
- **Snapshot context contents from a stub inner handler.** It's the only way to test middleware contracts.

---

## Self-assessment checklist

- [ ] You can list five things `ResponseRecorder` cannot model.
- [ ] You can write a streaming-response test that asserts on flush boundaries.
- [ ] You can test a hijacking handler using raw TCP.
- [ ] You can test a middleware's context propagation using a snapshot handler.
- [ ] You can simulate a client that disconnects mid-request.
- [ ] You can use `goleak` to detect handler-side goroutine leaks.
- [ ] You can enable HTTP/2 on an `httptest` server.
- [ ] You can write a slow-client test that triggers `ReadTimeout`.
- [ ] You can use `net.Pipe` for a fully in-memory HTTP test.

---

## Summary

This file covered the parts of HTTP that go beyond `ResponseRecorder` and require a real test server: streaming, chunked encoding, trailers, hijack, SSE, context propagation, client disconnect, slow clients, and HTTP/2. You learned the race-safe patterns for asserting on server-side state, how to inspect raw bytes when needed, and how to detect goroutine leaks with `goleak`. The `professional.md` file builds on this with production patterns — OAuth, webhooks, multi-server fan-out.

---

## Further reading

- `src/net/http/server.go` — read the `Hijack`, `Flush`, `Trailer` paths.
- `src/net/http/serve_test.go` — many `httptest`-based tests for streaming, trailers, timeouts.
- `golang.org/x/net/http2` — the HTTP/2 implementation; useful for low-level frame tests.
- `go.uber.org/goleak` — the leak detector.
- Cloudflare blog, "Optimizing Go: HTTP/2 server" — for context on what HTTP/2 tests need to cover.

---

## Appendix A — A long-poll endpoint, fully tested

Long-poll endpoints are the worst combination of streaming and cancellation. The client waits on the connection; the server waits on an event source; either side may go away.

Production handler:

```go
type LongPollServer struct {
    events chan Event
}

func (s *LongPollServer) Wait(w http.ResponseWriter, r *http.Request) {
    select {
    case ev := <-s.events:
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(ev)
    case <-r.Context().Done():
        // Client disconnected. No response — the connection is gone.
        return
    case <-time.After(30 * time.Second):
        // Long-poll timeout. Tell the client to retry.
        w.WriteHeader(http.StatusNoContent)
    }
}
```

Three branches to test. Each needs careful synchronisation.

**Branch 1: an event arrives.**

```go
func TestLongPoll_EventReceived(t *testing.T) {
    s := &LongPollServer{events: make(chan Event, 1)}
    ts := httptest.NewServer(http.HandlerFunc(s.Wait))
    t.Cleanup(ts.Close)

    // Send an event 50ms after the request starts.
    go func() {
        time.Sleep(50 * time.Millisecond)
        s.events <- Event{ID: "evt-1"}
    }()

    resp, err := ts.Client().Get(ts.URL)
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()

    var ev Event
    json.NewDecoder(resp.Body).Decode(&ev)
    if ev.ID != "evt-1" {
        t.Fatalf("ev = %+v", ev)
    }
}
```

**Branch 2: client disconnects.**

```go
func TestLongPoll_ClientDisconnect(t *testing.T) {
    s := &LongPollServer{events: make(chan Event)}
    handlerDone := make(chan struct{})

    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        s.Wait(w, r)
        close(handlerDone)
    }))
    t.Cleanup(ts.Close)

    ctx, cancel := context.WithCancel(context.Background())
    req, _ := http.NewRequestWithContext(ctx, "GET", ts.URL, nil)

    reqDone := make(chan struct{})
    go func() {
        ts.Client().Do(req) // we don't care about the result
        close(reqDone)
    }()

    // Give the handler time to enter the select.
    time.Sleep(50 * time.Millisecond)
    cancel()

    select {
    case <-handlerDone:
        // Good: handler returned because of disconnect.
    case <-time.After(2 * time.Second):
        t.Fatal("handler did not return")
    }
    <-reqDone
}
```

**Branch 3: timeout fires.** Hard to test without making it slow. Solution: refactor `time.After(30*time.Second)` to take an injected duration.

```go
func (s *LongPollServer) waitFor(d time.Duration, w http.ResponseWriter, r *http.Request) {
    select {
    case ev := <-s.events:
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(ev)
    case <-r.Context().Done():
        return
    case <-time.After(d):
        w.WriteHeader(http.StatusNoContent)
    }
}
```

Now the test uses `d = 50 * time.Millisecond` and runs in well under a second:

```go
func TestLongPoll_Timeout(t *testing.T) {
    s := &LongPollServer{events: make(chan Event)}
    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        s.waitFor(50*time.Millisecond, w, r)
    }))
    t.Cleanup(ts.Close)

    resp, err := ts.Client().Get(ts.URL)
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusNoContent {
        t.Fatalf("code = %d", resp.StatusCode)
    }
}
```

Lesson: a handler with a hard-coded 30-second timeout is untestable. Inject the duration. The production wrapper calls `s.waitFor(30*time.Second, w, r)`.

---

## Appendix B — Proxy-handler tests

A reverse-proxy handler that forwards requests to another server, manipulating headers in the process. The Go stdlib has `httputil.ReverseProxy`; testing your customisations of it follows a pattern.

```go
func NewProxy(target *url.URL) http.Handler {
    rp := httputil.NewSingleHostReverseProxy(target)
    director := rp.Director
    rp.Director = func(r *http.Request) {
        director(r)
        r.Header.Set("X-Forwarded-For", r.RemoteAddr)
        r.Header.Del("Cookie") // strip cookies
    }
    return rp
}
```

Test by running two `httptest.NewServer` instances: an upstream that records what it received, and a proxy that forwards to the upstream.

```go
func TestProxy(t *testing.T) {
    var (
        mu  sync.Mutex
        got *http.Request
    )

    upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        mu.Lock()
        got = r.Clone(r.Context())
        mu.Unlock()
        w.WriteHeader(http.StatusOK)
    }))
    t.Cleanup(upstream.Close)

    u, _ := url.Parse(upstream.URL)
    proxy := httptest.NewServer(NewProxy(u))
    t.Cleanup(proxy.Close)

    client := proxy.Client()
    req, _ := http.NewRequest("GET", proxy.URL+"/path", nil)
    req.Header.Set("Cookie", "session=secret")
    resp, _ := client.Do(req)
    resp.Body.Close()

    mu.Lock()
    defer mu.Unlock()
    if got == nil {
        t.Fatal("upstream not called")
    }
    if got.Header.Get("Cookie") != "" {
        t.Fatal("Cookie not stripped")
    }
    if got.Header.Get("X-Forwarded-For") == "" {
        t.Fatal("X-Forwarded-For missing")
    }
}
```

The pattern scales: any number of intermediaries, each its own server, each with its own assertions. The cost is wall-clock time — three servers, three socket setups — but for integration tests this is acceptable.

---

## Appendix C — TLS-mutating tests

When you need to inject specific TLS misconfigurations (expired cert, wrong CN, weak cipher), build your own `tls.Config` and pass it to `NewUnstartedServer`. The package's built-in cert isn't enough.

```go
func TestExpiredCert(t *testing.T) {
    // Generate an expired cert.
    template := x509.Certificate{
        SerialNumber: big.NewInt(1),
        Subject:      pkix.Name{CommonName: "localhost"},
        NotBefore:    time.Now().Add(-2 * time.Hour),
        NotAfter:     time.Now().Add(-1 * time.Hour),
        KeyUsage:     x509.KeyUsageDigitalSignature,
        ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
        IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
    }
    key, _ := rsa.GenerateKey(rand.Reader, 2048)
    derBytes, _ := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
    cert := tls.Certificate{
        Certificate: [][]byte{derBytes},
        PrivateKey:  key,
    }

    ts := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprint(w, "hello")
    }))
    ts.TLS = &tls.Config{Certificates: []tls.Certificate{cert}}
    ts.StartTLS()
    t.Cleanup(ts.Close)

    // Build a client that doesn't trust this cert.
    leaf, _ := x509.ParseCertificate(derBytes)
    pool := x509.NewCertPool()
    pool.AddCert(leaf)
    client := &http.Client{
        Transport: &http.Transport{
            TLSClientConfig: &tls.Config{RootCAs: pool},
        },
    }

    _, err := client.Get(ts.URL)
    if err == nil {
        t.Fatal("expected expired-cert error")
    }
    if !strings.Contains(err.Error(), "expired") && !strings.Contains(err.Error(), "valid") {
        t.Logf("err = %v", err)
    }
}
```

The boilerplate is significant — generating a cert is mechanical — but the test is real. It exercises the production code's behavior when faced with an expired cert.

You'll also use this pattern to test:

- Hostname mismatch (cert CN/SAN doesn't match URL).
- Untrusted root (cert chain doesn't end at a trusted CA).
- TLS version negotiation (server only accepts TLS 1.3; client only speaks TLS 1.2).

In each case, the test server's `tls.Config` is the lever. `httptest` is just the harness.

---

## Appendix D — A field guide to `r.Context()` semantics

`r.Context()` carries cancellation. The server cancels it when the connection closes. Handlers must check it.

Truth table:

| Event | `r.Context().Done()` closed? | `r.Context().Err()` returns |
|---|---|---|
| Client closes connection | Yes | `context.Canceled` |
| `ts.Close()` (server shutdown) | Yes | `context.Canceled` |
| `ts.CloseClientConnections()` | Yes | `context.Canceled` |
| Server's `WriteTimeout` exceeded | Yes (after the timeout fires) | `context.DeadlineExceeded` (sometimes) or `Canceled` |
| Handler runs to completion | No | nil (not closed) |

Tests for each row are the patterns from earlier sections. The key principle: any handler that may block for non-trivial time must `select` on `r.Context().Done()`. Tests should provoke each cancellation and assert the handler returns promptly.

A common mistake is to assert on the exact `Err()` value. Implementations may change. Assert on "the context is done" (`select` with timeout, or `<-r.Context().Done()` with a timeout guard), not on the specific error.

---

## Appendix E — Race detector intuition

The race detector watches reads and writes across goroutines. It hits on:

- Two goroutines writing to the same variable.
- One goroutine writing while another reads.
- A read that happens "before" a write in source order but "after" it in goroutine schedule order, with no synchronisation between them.

Examples that *trigger* the race detector:

```go
var x int
go func() { x = 1 }()
fmt.Println(x) // RACE
```

```go
var x int
ch := make(chan struct{})
go func() {
    x = 1
    // forgot to send on ch
}()
<-ch
fmt.Println(x) // RACE (ch blocks forever, but the detector still warns)
```

Examples that *do not* trigger:

```go
var x int
ch := make(chan struct{})
go func() {
    x = 1
    close(ch)
}()
<-ch
fmt.Println(x) // OK — close-then-receive establishes happens-before
```

```go
var x atomic.Int64
go func() { x.Store(1) }()
_ = x.Load() // OK — atomics establish happens-before
```

```go
var (
    mu sync.Mutex
    x int
)
go func() {
    mu.Lock()
    x = 1
    mu.Unlock()
}()
mu.Lock()
fmt.Println(x) // OK
mu.Unlock()
```

For tests, the rule is: when the handler writes to a variable the test reads, you must have *some* synchronisation between them. The test's reception of the HTTP response *does not* automatically synchronise with the handler's write — the response can be flushed before the assignment completes. Use a channel, mutex, or atomic.

---

## Appendix F — Connection-pooling intricacies

`*http.Client` reuses TCP connections via the transport's keep-alive pool. Tests that depend on connection-reuse behavior — or want to defeat it — need to know how this works.

The default `http.Transport.MaxIdleConnsPerHost = 2`. After two idle connections, the third gets a new TCP setup. For a server that records `RemoteAddr` per request:

```go
ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, r.RemoteAddr)
}))
t.Cleanup(ts.Close)

client := ts.Client()
seen := map[string]struct{}{}
for i := 0; i < 10; i++ {
    resp, _ := client.Get(ts.URL)
    body, _ := io.ReadAll(resp.Body)
    resp.Body.Close()
    seen[string(body)] = struct{}{}
}
t.Logf("unique connections: %d", len(seen))
```

You should see `1` (reuse). To force fresh connections:

```go
trans := client.Transport.(*http.Transport).Clone()
trans.DisableKeepAlives = true
client = &http.Client{Transport: trans}
```

Now you see `10` unique connections.

When testing per-connection behavior (e.g. a circuit breaker that opens per connection, not per request), `DisableKeepAlives = true` is essential.

## Appendix G — Server-side timing assertions

A handler that takes longer than X ms should fail; a test should pin this.

```go
func TestHandlerLatency(t *testing.T) {
    ts := httptest.NewServer(http.HandlerFunc(myHandler))
    t.Cleanup(ts.Close)

    start := time.Now()
    resp, err := ts.Client().Get(ts.URL)
    elapsed := time.Since(start)
    if err != nil {
        t.Fatal(err)
    }
    resp.Body.Close()

    if elapsed > 100*time.Millisecond {
        t.Errorf("latency = %v, want < 100ms", elapsed)
    }
}
```

Caveat: CI machines vary in speed. Set the threshold high enough that legitimate workloads pass, low enough that regressions are caught. Or measure relative latency in a benchmark instead.

For p99 latency assertions:

```go
const N = 200
latencies := make([]time.Duration, N)
for i := 0; i < N; i++ {
    start := time.Now()
    resp, _ := ts.Client().Get(ts.URL)
    resp.Body.Close()
    latencies[i] = time.Since(start)
}
sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
p99 := latencies[N*99/100]
if p99 > 200*time.Millisecond {
    t.Errorf("p99 = %v", p99)
}
```

Useful for load-shedding tests where the handler should remain fast under stress.

## Appendix H — Inspecting the underlying http.Server

`httptest.Server.Config` is the `*http.Server` the package created. You can inspect or modify almost everything about it — *before* `Start`.

```go
ts := httptest.NewUnstartedServer(handler)
ts.Config.ReadTimeout = 100 * time.Millisecond
ts.Config.WriteTimeout = 100 * time.Millisecond
ts.Config.IdleTimeout = 200 * time.Millisecond
ts.Config.MaxHeaderBytes = 4096
ts.Config.ErrorLog = log.New(io.Discard, "", 0)
ts.Config.ConnState = func(c net.Conn, state http.ConnState) {
    // observe connection state changes
}
ts.Start()
t.Cleanup(ts.Close)
```

The `ConnState` callback is particularly useful for tests of connection-lifecycle behavior. It fires on every state transition (`StateNew`, `StateActive`, `StateIdle`, `StateHijacked`, `StateClosed`). You can count transitions and assert.

```go
var states sync.Map
ts.Config.ConnState = func(c net.Conn, s http.ConnState) {
    states.LoadOrStore(c.RemoteAddr().String(), &[]http.ConnState{})
    if v, ok := states.Load(c.RemoteAddr().String()); ok {
        *v.(*[]http.ConnState) = append(*v.(*[]http.ConnState), s)
    }
}
```

This kind of instrumentation is rarely needed but invaluable when debugging "why are connections piling up?" issues.

## Appendix I — Custom dialers for fault injection

For tests that need to inject network faults (latency, packet loss, refused connections), wrap the dialer:

```go
type slowDialer struct {
    base    *net.Dialer
    latency time.Duration
}

func (d *slowDialer) Dial(network, addr string) (net.Conn, error) {
    conn, err := d.base.Dial(network, addr)
    if err != nil {
        return nil, err
    }
    return &slowConn{Conn: conn, latency: d.latency}, nil
}

type slowConn struct {
    net.Conn
    latency time.Duration
}

func (c *slowConn) Read(b []byte) (int, error) {
    time.Sleep(c.latency)
    return c.Conn.Read(b)
}
```

Then:

```go
client := ts.Client()
trans := client.Transport.(*http.Transport).Clone()
trans.DialContext = (&slowDialer{base: &net.Dialer{}, latency: 50 * time.Millisecond}).DialContext
client = &http.Client{Transport: trans}
```

Tests for retry, timeout, and circuit-breaker logic frequently use this pattern. The dialer is the lowest layer where you can inject faults that look like real network failures.

---

[← Back](../)
