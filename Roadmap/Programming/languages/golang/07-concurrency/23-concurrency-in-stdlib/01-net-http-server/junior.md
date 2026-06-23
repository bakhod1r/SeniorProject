---
layout: default
title: net/http Server Concurrency — Junior
parent: net/http Server Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/01-net-http-server/junior/
---

# net/http Server Concurrency — Junior Level

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Your first server](#your-first-server)
6. [What is a goroutine-per-connection model](#what-is-a-goroutine-per-connection-model)
7. [Lifecycle of one HTTP request](#lifecycle-of-one-http-request)
8. [Handler runs on its own goroutine](#handler-runs-on-its-own-goroutine)
9. [Many requests at the same time](#many-requests-at-the-same-time)
10. [Persistent connections (keep-alive)](#persistent-connections-keep-alive)
11. [HTTP/2 in one paragraph](#http2-in-one-paragraph)
12. [ResponseWriter is not safe for concurrent use](#responsewriter-is-not-safe-for-concurrent-use)
13. [Request bodies and concurrency](#request-bodies-and-concurrency)
14. [r.Context() and cancellation](#rcontext-and-cancellation)
15. [Spawning goroutines from handlers](#spawning-goroutines-from-handlers)
16. [Race conditions in handlers](#race-conditions-in-handlers)
17. [Shared state across handlers](#shared-state-across-handlers)
18. [The race detector](#the-race-detector)
19. [Graceful shutdown for beginners](#graceful-shutdown-for-beginners)
20. [Server timeouts in plain terms](#server-timeouts-in-plain-terms)
21. [Mental models](#mental-models)
22. [Coding patterns](#coding-patterns)
23. [Clean code](#clean-code)
24. [Error handling](#error-handling)
25. [Security considerations](#security-considerations)
26. [Performance tips](#performance-tips)
27. [Best practices](#best-practices)
28. [Edge cases and pitfalls](#edge-cases-and-pitfalls)
29. [Common mistakes](#common-mistakes)
30. [Common misconceptions](#common-misconceptions)
31. [Tricky points](#tricky-points)
32. [Test](#test)
33. [Tricky questions](#tricky-questions)
34. [Cheat sheet](#cheat-sheet)
35. [Self-assessment checklist](#self-assessment-checklist)
36. [Summary](#summary)
37. [What you can build](#what-you-can-build)
38. [Further reading](#further-reading)
39. [Related topics](#related-topics)

---

## Introduction
> Focus: *what happens between `http.ListenAndServe` and your handler running, who runs your handler, and what concurrency rules you must respect.*

The Go HTTP server makes a striking promise. You write one function — `func(w http.ResponseWriter, r *http.Request)` — and the standard library serves it concurrently to as many clients as the operating system can hand it connections. You do not start any goroutines. You do not manage any thread pools. You do not poll any sockets. And yet thousands of clients can talk to your server at the same time, each receiving correct responses.

This file is about how that promise is implemented and what it asks of you in return. The trick is short: every new TCP connection becomes a new goroutine, and inside that goroutine the server reads the HTTP request, calls your handler, and writes the response, one request at a time. There is no thread pool. There is no async/await ceremony. A connection is a goroutine, and a goroutine is cheap.

But that simplicity hides a few rules. Your handler runs on a goroutine you didn't create. Other handlers, serving other clients, run on other goroutines you didn't create. If they share any state — a counter, a map, a buffer, a struct — that sharing is concurrent and unprotected by default. The same race-detector warnings, the same data-race rules, the same `sync.Mutex` discipline that you learn in basic Go concurrency apply directly inside HTTP handlers.

This file teaches you, at the junior level:
1. The goroutine-per-connection model — what it means, what it costs, what it gives you.
2. The lifecycle of one HTTP request, from `Accept` to your handler returning.
3. How keep-alive turns one connection into many requests, sharing one goroutine.
4. What `http.ResponseWriter` will and won't tolerate from your code.
5. What `r.Context()` is for, and why ignoring it leaks goroutines.
6. The most common concurrency bugs a junior programmer writes in handlers, and how to fix them.

You will not yet learn how `(*conn).serve` is written line by line (`middle.md`) or how HTTP/2 multiplexes streams over one connection with one framer goroutine and one writer goroutine (`senior.md`). You will learn the *user-visible* concurrency model: what to assume, what to avoid, what to test.

By the end you should be able to write a server that does not corrupt responses under concurrent clients, does not leak goroutines when clients disconnect, and shuts down gracefully on SIGINT.

---

## Prerequisites

- **Required.** You can write and run Go programs.
- **Required.** You have used `go func()` and `chan` at least once.
- **Required.** You understand that goroutines run concurrently and that shared variables can race.
- **Helpful.** You have built a tiny HTTP client with `http.Get` and read a response.
- **Helpful.** You have written a `sync.Mutex`-protected counter.

You do *not* need to know:
- Anything about HTTP/2 framing, settings, or flow control.
- The Go memory model in detail.
- How the runtime scheduler picks which OS thread runs your goroutine.

A working installation of Go 1.21 or later is assumed. Most examples work on any 1.20+ version, but `slog` and `atomic.Int64` style examples need 1.19+.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Goroutine** | A lightweight thread managed by the Go runtime. Cheap to create (~2 KB initial stack) and switch. Many goroutines run on a small number of OS threads. |
| **net.Listener** | An object that represents a server socket. Created by `net.Listen("tcp", ":8080")`. Its `Accept` method blocks until a new TCP client connects. |
| **Accept loop** | The `for { conn, _ := ln.Accept(); go serve(conn) }` pattern that turns one server socket into a stream of per-connection goroutines. |
| **`*http.Server`** | The Go struct that holds server configuration (timeouts, handlers, TLS) and runs the accept loop. `http.ListenAndServe` creates one internally. |
| **`http.Handler`** | An interface with one method: `ServeHTTP(ResponseWriter, *Request)`. Everything serving HTTP in Go ultimately implements this. |
| **`http.HandlerFunc`** | An adapter making a plain function `func(w, r)` satisfy `http.Handler`. |
| **`http.ResponseWriter`** | The interface a handler uses to send the response. NOT safe for concurrent use. |
| **`*http.Request`** | The parsed incoming request: method, URL, headers, body. Read-only from the handler's perspective (don't mutate). |
| **Keep-alive** | HTTP/1.1 default behaviour where one TCP connection serves many sequential requests. |
| **Hijack** | Calling `w.(http.Hijacker).Hijack()` to take over the raw TCP connection from the server. Used for WebSockets, custom protocols. |
| **`r.Context()`** | A `context.Context` tied to the request's lifetime. Cancelled when the client disconnects or the handler returns. |
| **Graceful shutdown** | Stopping the server such that in-flight requests are allowed to finish. `Server.Shutdown(ctx)`. |
| **Forceful close** | Stopping the server immediately, interrupting any in-flight requests. `Server.Close()`. |
| **Race condition** | A bug that happens when two goroutines access the same memory and at least one is a write, without synchronisation. |
| **`-race` flag** | `go run -race` or `go test -race`: enables the race detector, which instruments memory accesses and reports races at runtime. |
| **HTTP/1.1** | Text-based HTTP. One request at a time per connection (with keep-alive, many sequential). |
| **HTTP/2** | Binary, multiplexed HTTP. Many concurrent streams per connection. Used over TLS by default. |

---

## Core Concepts

### One connection = one goroutine

The single most important sentence in this file:

> Every accepted TCP connection becomes one new goroutine. Your handler runs on that goroutine.

When you write:

```go
http.ListenAndServe(":8080", handler)
```

the Go standard library does this, conceptually:

```go
ln, _ := net.Listen("tcp", ":8080")
for {
    conn, _ := ln.Accept()
    go func() {
        // read the request from conn
        // call handler(w, r)
        // write the response to conn
        // maybe loop for keep-alive
        // close conn
    }()
}
```

This is the *goroutine-per-connection* model. It is the standard pattern for Go network servers. It is what makes the API so simple: you write a synchronous handler; the goroutine is your concurrency.

### The handler is synchronous from your perspective

Inside a handler, code runs top to bottom. You don't have to think about callbacks, promises, or futures. You read the request body. You compute. You write the response. You return.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    name := r.URL.Query().Get("name")
    fmt.Fprintf(w, "hello, %s\n", name)
}
```

This handler is plain sequential code. It just happens to be running on a goroutine spawned by the server, simultaneously with many other instances of itself running for other clients.

### Concurrency comes from other goroutines, not your handler

Your *one* call to your handler is sequential. But there are many *concurrent* calls to your handler, one per client. They run in parallel.

This is the key concurrency property:

> Each call to your handler runs serially. Different calls to your handler run concurrently with each other.

Anything inside one call is safe in isolation. Anything *shared* across calls — a global variable, a heap-allocated struct, a database connection — must be protected.

### The server starts goroutines, never destroys them on its own

Once `(*conn).serve` is running, the server itself doesn't stop it; the goroutine ends when the handler returns AND the connection closes (for keep-alive, after all requests complete). If your handler blocks forever, that goroutine blocks forever. The server has no "kill thread" mechanism.

This is why honouring `r.Context()` matters: it is the *signal* that the server gives your handler to ask for early return.

---

## Your first server

Let's write a server, run it, and observe the goroutines.

```go
package main

import (
    "fmt"
    "net/http"
    "runtime"
)

func handler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "Hello from goroutine count: %d\n", runtime.NumGoroutine())
}

func main() {
    http.HandleFunc("/", handler)
    http.ListenAndServe(":8080", nil)
}
```

Run it:
```
go run main.go
```

In another terminal:
```
$ curl http://localhost:8080/
Hello from goroutine count: 4
$ curl http://localhost:8080/
Hello from goroutine count: 4
```

The number is small (a handful of runtime goroutines plus the accept loop's). Why doesn't it grow? Because each `curl` is a one-shot HTTP/1.1 request: the client opens a connection, sends one request, reads the response, closes. By the time the response is returned, the server-side goroutine has already moved on or exited.

Now let's keep a connection open. Use `curl --keepalive-time 60 --next` style or just write a Go client:

```go
package main

import (
    "fmt"
    "io"
    "net/http"
    "time"
)

func main() {
    c := &http.Client{}
    for i := 0; i < 5; i++ {
        resp, _ := c.Get("http://localhost:8080/")
        body, _ := io.ReadAll(resp.Body)
        resp.Body.Close()
        fmt.Print(string(body))
        time.Sleep(time.Second)
    }
}
```

The Go HTTP client reuses connections by default. The server sees five requests on one connection — same goroutine. The reported `runtime.NumGoroutine()` should stay constant.

### What the server did under the hood

For your benefit, here is the simplified flow that the standard library implemented behind `http.ListenAndServe`:

```go
// roughly equivalent to ListenAndServe(":8080", nil)

ln, _ := net.Listen("tcp", ":8080")
srv := &http.Server{Handler: http.DefaultServeMux}

// the accept loop
for {
    conn, err := ln.Accept()
    if err != nil { /* shutdown handling */ }
    c := srv.newConn(conn)
    go c.serve(ctx)
}
```

Where `c.serve(ctx)` is, roughly:

```go
func (c *conn) serve(ctx context.Context) {
    defer recover-and-cleanup()
    
    for { // keep-alive loop
        w, err := c.readRequest(ctx)
        if err != nil { return }
        c.server.Handler.ServeHTTP(w, w.req)
        w.finishRequest()
        if !c.canReuse() { return }
    }
}
```

So one TCP connection gives you one goroutine, and that goroutine handles many requests sequentially.

---

## What is a goroutine-per-connection model

The phrase "goroutine-per-connection" deserves unpacking because it implies several things at once.

### One: a goroutine is created per accepted connection

The accept loop creates a new goroutine each time `Accept()` returns a connection. The goroutine does not pre-exist. It is not pulled from a pool. It is `go newGoroutineFunc()`.

This is cheap. A goroutine starts with a 2 KB stack (which grows on demand) and a tiny runtime descriptor. Creating one is ~hundreds of nanoseconds. The runtime handles thousands per second easily.

### Two: that goroutine owns the connection

The connection is not shared. The accept-loop goroutine never reads from or writes to it again. The serving goroutine has exclusive use of the `net.Conn`.

This is why you don't need locks around `bufio.Reader` and `bufio.Writer` that wrap the connection — only one goroutine touches them.

### Three: the goroutine ends when the connection ends

When `(*conn).serve` returns — because the client closed, because keep-alive expired, because of an error — its goroutine ends. The conn is closed. The OS releases the file descriptor.

### Four: there is no maximum

By default, the server accepts as many connections as the OS lets it accept. If a client opens 100,000 connections, the server spawns 100,000 goroutines. Each takes ~10-20 KB after a typical handler. 100k goroutines = ~1-2 GB. That's why production servers cap connection counts (see `professional.md`).

### Five: HTTP/2 changes the rule

For HTTP/2, the rule is one goroutine per *connection* plus one per *stream*. Many streams per connection, each with its own handler goroutine. We'll cover this in detail in `senior.md`.

For HTTP/1.1 (the common case at this level), one goroutine handles one connection — and many requests on it if keep-alive is on.

### Compare: thread-per-connection vs goroutine-per-connection

In C or Java, "thread per connection" is impractical because OS threads cost ~1 MB of stack each. You move to thread pools, event loops (`epoll`, `kqueue`), or async runtimes.

In Go, goroutines are managed by the runtime, multiplexed onto a small number of OS threads via the M:N scheduler. A blocked goroutine doesn't block its OS thread (the scheduler parks it and picks another). Goroutines on idle network reads are entirely off-CPU.

So Go's "naive" goroutine-per-connection model gives you the *programming* model of thread-per-connection but the *runtime cost* of event-driven I/O.

---

## Lifecycle of one HTTP request

Let's walk through what happens for one HTTP/1.1 request, from the client's `connect()` to the handler's `return`.

### Step 1: Listener accept

The accept-loop goroutine calls `ln.Accept()`. This blocks on `accept()` syscall (which, under the hood, parks the goroutine until the kernel says a new connection is ready). When a client connects:

```go
conn, _ := ln.Accept()
```

`conn` is a `net.Conn` backed by a TCP socket file descriptor.

### Step 2: Spawn the per-connection goroutine

```go
c := srv.newConn(conn)
go c.serve(ctx)
```

`newConn` wraps the raw conn in a `*conn` struct holding `bufio.Reader` and `bufio.Writer`, request-parsing state, hijack flag, etc. Then a new goroutine starts running `c.serve(ctx)`.

### Step 3: TLS handshake (if HTTPS)

Inside `c.serve`, if the listener is TLS:
```go
tlsConn := tls.Server(c.rwc, srv.TLSConfig)
if err := tlsConn.HandshakeContext(ctx); err != nil { return }
```

This runs synchronously on the per-connection goroutine. Handshake takes 1-2 RTTs.

### Step 4: Read the request

```go
req, err := http.ReadRequest(c.bufr)
```

`ReadRequest` parses the request line ("GET /foo HTTP/1.1") and headers. The body is left as an `io.Reader` that the handler can read from.

If headers haven't fully arrived, the read blocks. This is when `ReadHeaderTimeout` fires.

### Step 5: Build ResponseWriter and Request

The server constructs an `*http.response` (the internal type implementing `http.ResponseWriter`) and a fully-populated `*http.Request`.

### Step 6: Start the cancel-context goroutine

The server starts a background goroutine that watches the connection for a remote-close (peer sent FIN) and, if it occurs, cancels `r.Context()`. This is how `r.Context().Done()` becomes signalled when the client gives up.

### Step 7: Call your handler

```go
srv.Handler.ServeHTTP(w, req)
```

This is your code running. You read, compute, write.

### Step 8: Finish the response

When `ServeHTTP` returns, the server's `finishRequest`:
- Flushes any buffered output (`bufio.Writer.Flush`).
- Reads and discards any remaining body bytes (so the next request can be parsed).
- Writes the chunked-encoding trailer if applicable.
- Updates per-connection state.

### Step 9: Keep-alive decision

The server checks: was this a `Connection: close` request? Was there an error? Is the client HTTP/1.0? Based on this, either:
- Loop back to step 4 to read the next request on the same connection.
- Or close the connection.

### Step 10: Connection close (eventually)

When the loop exits, the goroutine `Close`s the conn, runs `ConnState` callback with `StateClosed`, and returns. Goroutine ends.

---

## Handler runs on its own goroutine

Now the key fact for application code:

> Your `handler(w, r)` function runs on a goroutine that was spawned by the server. You did not start it.

This has practical implications.

### You can use blocking operations freely

Inside a handler you can:
- Read a file synchronously.
- Run a `time.Sleep`.
- Make an HTTP request to another server.
- Query a database.

You will not block other requests. Other requests are on other goroutines.

```go
func slowHandler(w http.ResponseWriter, r *http.Request) {
    time.Sleep(5 * time.Second)
    w.Write([]byte("done\n"))
}
```

This works fine even with thousands of concurrent clients. Each sleep is one goroutine. Go's scheduler parks sleeping goroutines off-CPU.

### You can also block forever (bug!)

Because the server doesn't kill your goroutine, if you write:

```go
func badHandler(w http.ResponseWriter, r *http.Request) {
    select {} // block forever
}
```

That goroutine never exits. The connection is held open forever (no `WriteTimeout` set by default). Memory and file descriptors accumulate. This is the "goroutine leak."

### What goroutine ID do handlers run on?

If you do:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "gid=%d\n", gid())
}
```

(where `gid()` extracts the goroutine ID from `runtime.Stack`), then:
- One curl: gid = some N (depends on server activity).
- Another curl (separate connection): different gid.
- Two curls with keep-alive (same connection, sequential): SAME gid.

This is observable proof that one connection = one goroutine, but the *value* of the goroutine ID is an implementation detail. Don't use goroutine IDs in production code.

---

## Many requests at the same time

Let's say 100 clients hit your server simultaneously. What happens?

```
client 1 -> Accept -> goroutine 100, handler running
client 2 -> Accept -> goroutine 101, handler running
client 3 -> Accept -> goroutine 102, handler running
...
client 100 -> Accept -> goroutine 199, handler running
```

100 goroutines, each running `handler(w, r)` in parallel. They don't interact unless they share state.

### Shared state must be protected

If your handler reads or writes a package-level variable, 100 concurrent handlers race.

**Buggy:**
```go
var requestCount int

func handler(w http.ResponseWriter, r *http.Request) {
    requestCount++ // race
    fmt.Fprintf(w, "request #%d\n", requestCount)
}
```

Under `-race`, you'll see:
```
WARNING: DATA RACE
Read at 0x... by goroutine 12:
  main.handler.func1 ...
Previous write at 0x... by goroutine 9:
  main.handler.func1 ...
```

**Fixed with atomic:**
```go
import "sync/atomic"

var requestCount atomic.Int64

func handler(w http.ResponseWriter, r *http.Request) {
    n := requestCount.Add(1)
    fmt.Fprintf(w, "request #%d\n", n)
}
```

**Fixed with mutex:**
```go
import "sync"

var mu sync.Mutex
var requestCount int

func handler(w http.ResponseWriter, r *http.Request) {
    mu.Lock()
    requestCount++
    n := requestCount
    mu.Unlock()
    fmt.Fprintf(w, "request #%d\n", n)
}
```

### What if you don't share state?

If a handler only touches its `w` and `r` parameters and local variables, it's automatically safe across calls. The handler doesn't share anything to race on.

```go
func safe(w http.ResponseWriter, r *http.Request) {
    n := time.Now().UnixNano()
    fmt.Fprintf(w, "now=%d\n", n)
}
```

No shared state → no race possible (other than races inside `time.Now`, which is safe).

### Concurrency in practice

Most production handlers DO share state: a database handle, a cache, a configuration struct, a logger. These are passed around safely because:
- `*sql.DB` is safe for concurrent use (internally pooled).
- A `*log.Logger` is safe for concurrent use (internally locked).
- Configuration is often read-only after init, so no synchronisation needed.
- Caches use `sync.Map` or mutex-protected maps.

Each shared resource in your design must be evaluated: is it safe for concurrent use? If not, lock it.

---

## Persistent connections (keep-alive)

HTTP/1.1's `Connection: keep-alive` (the default) lets one TCP connection carry many requests. After the response, the connection stays open; the next request arrives on the same conn.

### Goroutine reuse

For keep-alive, the same per-connection goroutine handles all the requests on that conn:

```
goroutine N:
  read request 1
  call handler(w, r1)
  finish response 1
  read request 2          <-- same goroutine
  call handler(w, r2)     <-- same goroutine
  finish response 2
  ...
```

Sequentially within one conn, never concurrently.

### Why this matters

If two handlers share a `*sync.Mutex`, contention between them only happens across *different* connections — not within one. So a single client hammering one connection sees zero lock contention. Many concurrent clients on different connections see real contention.

### `IdleTimeout`

After the response, the goroutine reads for the next request. If no request arrives within `IdleTimeout`, the connection closes. The goroutine ends.

Default `IdleTimeout` is `0`, which means "fall back to `ReadTimeout`." If `ReadTimeout` is also `0`, connections idle indefinitely (subject to OS keepalive).

Recommendation: always set `IdleTimeout` (e.g., `60*time.Second`) so idle clients don't pin goroutines forever.

### Disabling keep-alive

```go
srv.SetKeepAlivesEnabled(false)
```

After this, every response has `Connection: close` and the server closes the conn after responding. Use during shutdown to drain clients faster.

---

## HTTP/2 in one paragraph

HTTP/2 is a binary, multiplexed protocol. One TCP connection carries many concurrent *streams*, each with its own request and response. The Go server (via `golang.org/x/net/http2`, bundled into `net/http`) implements HTTP/2 transparently when TLS is used:

- One goroutine per TCP connection runs the framer (reads frames, decodes them).
- Frames belong to streams; one goroutine per active stream runs the handler.
- A separate goroutine serialises outgoing frames so they don't interleave on the wire.

So an HTTP/2 connection with 50 active streams is 1 framer goroutine + 1 writer goroutine + 50 handler goroutines = 52 goroutines for one conn.

For details, see `senior.md`. At the junior level: just know that HTTP/2 is transparent to your handler; the only handler-visible difference is that `Hijack()` doesn't work (HTTP/2 doesn't support raw conn takeover).

---

## ResponseWriter is not safe for concurrent use

Quote the doc:

> A ResponseWriter may not be used after the Handler.ServeHTTP method has returned.

And less explicitly but equally true:

> A ResponseWriter may not be used concurrently from multiple goroutines.

This means: only your handler goroutine should call `w.Write`, `w.WriteHeader`, `w.Header().Set`, etc. Never spawn a goroutine that also calls these.

### Why?

`http.ResponseWriter` is backed by per-connection buffers and headers. The server's state machine assumes one goroutine drives the response. Two goroutines writing simultaneously can:
- Corrupt buffered bytes.
- Race on `WriteHeader` (which can be called only once).
- Race on header map updates.
- Race on chunked-encoding state.

### Race example

```go
func bad(w http.ResponseWriter, r *http.Request) {
    go func() {
        w.Write([]byte("from goroutine\n")) // RACE
    }()
    w.Write([]byte("from main\n"))
}
```

`go run -race`:
```
WARNING: DATA RACE
Write at 0x... by goroutine 8:
  net/http.(*response).Write ...
Previous write at 0x... by goroutine 7:
  net/http.(*response).Write ...
```

### Use after handler returns

```go
func worse(w http.ResponseWriter, r *http.Request) {
    go func() {
        time.Sleep(time.Second)
        w.Write([]byte("late\n")) // use-after-return
    }()
}
```

By the time the goroutine writes, the handler has returned. The server has cleaned up the response (potentially closed the conn). Writing now is undefined.

### Pattern: forward via channel

If you must do work in a goroutine, return results to the handler via a channel:

```go
func okPattern(w http.ResponseWriter, r *http.Request) {
    out := make(chan string, 1)
    go func() {
        out <- doSlowWork(r.Context())
    }()
    select {
    case s := <-out:
        w.Write([]byte(s))
    case <-r.Context().Done():
        return
    }
}
```

The handler goroutine writes to `w`; the inner goroutine just produces a string. No race.

---

## Request bodies and concurrency

`r.Body` is an `io.ReadCloser`. Reading it follows the standard `io.Reader` rules:

- Read until EOF.
- Read may block waiting for more bytes.
- Read returns errors if connection drops.

Key concurrency rule: **`r.Body` is owned by the handler's goroutine**. Don't read it from another goroutine, and don't read it after the handler returns.

### Reading the body

```go
func upload(w http.ResponseWriter, r *http.Request) {
    body, err := io.ReadAll(r.Body)
    if err != nil { http.Error(w, err.Error(), 400); return }
    fmt.Fprintf(w, "got %d bytes\n", len(body))
}
```

Simple. The `ReadAll` blocks until EOF or error. The handler goroutine blocks too — that's fine, other goroutines aren't affected.

### Closing the body

You don't need to close `r.Body` in handlers. The server does it for you after the handler returns. Closing early can be useful to release the connection sooner for keep-alive:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    r.Body.Close() // optional: signals "I'm done with the body"
    // ...
}
```

But not closing is also fine.

### Large bodies

`io.ReadAll(r.Body)` allocates a slice as large as the body. For a 10 GiB upload, that's 10 GiB of memory. Dangerous.

Cap the body size with `http.MaxBytesReader`:

```go
r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // cap at 1 MiB
body, err := io.ReadAll(r.Body)
if err != nil {
    // err is *http.MaxBytesError if exceeded
    http.Error(w, "body too large", http.StatusRequestEntityTooLarge)
    return
}
```

Or stream-decode (especially for JSON):

```go
var req MyRequest
if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
    http.Error(w, err.Error(), 400)
    return
}
```

`json.Decoder` reads incrementally; doesn't buffer the whole body.

### Reading body from multiple goroutines

Don't. `r.Body` is not safe for concurrent reads. Even if you think you're tagging reads with offsets — the underlying stream is sequential.

If you need to fan out the body to multiple consumers, read it once into memory (with size cap), then share the byte slice (immutable from there on):

```go
body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
// body is now an immutable []byte safe to share with goroutines
go process1(body)
go process2(body)
```

---

## r.Context() and cancellation

`r.Context()` returns a `context.Context` for the request. It is **cancelled** when any of:

1. The client closes its connection.
2. (HTTP/2) The client sends RST_STREAM.
3. The handler returns.

So:
- During the handler call, `r.Context()` is alive (not cancelled) unless the client has disconnected.
- After the handler returns, `r.Context()` is always cancelled.

### Why this matters

If your handler does long-running work — calling another service, querying a database, computing — and the client gives up, you want to abandon that work too. `r.Context().Done()` is how you find out.

### Propagating to downstream calls

```go
func proxy(w http.ResponseWriter, r *http.Request) {
    req, _ := http.NewRequestWithContext(r.Context(), "GET", "http://upstream/data", nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil { /* ctx cancelled? */ }
    defer resp.Body.Close()
    io.Copy(w, resp.Body)
}
```

If the client disconnects, `r.Context()` is cancelled. The downstream `req` inherits cancellation; the HTTP client aborts. The handler returns quickly.

Same for database calls — use `*Context` variants:

```go
rows, err := db.QueryContext(r.Context(), "SELECT ...")
```

### Selecting on Done()

For your own goroutines or channels:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    work := make(chan result, 1)
    go func() {
        work <- doWork()
    }()
    select {
    case res := <-work:
        // write res
    case <-r.Context().Done():
        return // client disconnected
    }
}
```

### Ignoring r.Context() leads to leaks

```go
func leaky(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    // ignore r.Context() entirely
    time.Sleep(time.Minute) // simulates slow work
    w.Write(body)
}
```

If the client disconnects, the server's read on `r.Body` may error (because the conn is closed), but `time.Sleep(time.Minute)` runs to completion. The goroutine is alive for a full minute, holding memory. With many disconnecting clients, this leaks.

Fix:
```go
select {
case <-time.After(time.Minute):
    w.Write(body)
case <-r.Context().Done():
    return
}
```

Or use `context.WithTimeout(r.Context(), ...)` for a hard deadline.

---

## Spawning goroutines from handlers

Sometimes you need to do something asynchronously: fan out to multiple services, write to a log queue, push a metric. Goroutines from a handler need three things:

1. They must NOT write to `r.Body` or `w`.
2. They must observe cancellation (typically via `r.Context()`).
3. They must not survive past the time they're needed.

### Fan-out pattern

```go
func fanout(w http.ResponseWriter, r *http.Request) {
    type result struct{ src, body string }
    out := make(chan result, 3)
    for _, src := range []string{"a", "b", "c"} {
        src := src // capture
        go func() {
            req, _ := http.NewRequestWithContext(r.Context(), "GET", "http://"+src, nil)
            resp, err := http.DefaultClient.Do(req)
            if err != nil { out <- result{src: src, body: "err: "+err.Error()}; return }
            defer resp.Body.Close()
            body, _ := io.ReadAll(resp.Body)
            out <- result{src: src, body: string(body)}
        }()
    }
    for i := 0; i < 3; i++ {
        select {
        case r := <-out:
            fmt.Fprintf(w, "%s: %s\n", r.src, r.body)
        case <-r.Context().Done():
            return
        }
    }
}
```

Each fan-out goroutine inherits `r.Context()` through `NewRequestWithContext`. If the client disconnects, all three downstream calls are cancelled. The main handler observes `<-r.Context().Done()` and returns.

### Fire-and-forget pattern

Sometimes you want a goroutine to outlive the handler, e.g., push a metric to an external system:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("ok"))
    
    // detach from request context
    go func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        pushMetric(ctx, "request_count", 1)
    }()
}
```

The goroutine uses `context.Background` (not `r.Context()`), so the request's cancellation doesn't kill it. It has its own 5-second budget. The handler returns immediately; the goroutine runs in the background.

**Caveat.** Fire-and-forget goroutines are not waited for by `Server.Shutdown`. On shutdown they may be killed mid-flight if the process exits before they finish. For mission-critical async work, use a real background-worker pattern with its own shutdown handling.

---

## Race conditions in handlers

A race condition in a handler is no different from any other Go race. The race detector (`-race`) catches it.

### Race on a shared variable

```go
var lastClient string

func handler(w http.ResponseWriter, r *http.Request) {
    lastClient = r.RemoteAddr // race
    fmt.Fprintln(w, "ok")
}
```

Two concurrent clients write `lastClient` at the same time. Race.

Fix: atomic value, mutex, or scope per-request.

### Race on a shared map

```go
var visits = map[string]int{}

func handler(w http.ResponseWriter, r *http.Request) {
    visits[r.URL.Path]++ // race
}
```

`map` writes are not goroutine-safe in Go. This races immediately and may even crash with "concurrent map writes."

Fix:
```go
var (
    mu     sync.Mutex
    visits = map[string]int{}
)

func handler(w http.ResponseWriter, r *http.Request) {
    mu.Lock()
    visits[r.URL.Path]++
    mu.Unlock()
}
```

Or `sync.Map`:
```go
var visits sync.Map

func handler(w http.ResponseWriter, r *http.Request) {
    v, _ := visits.LoadOrStore(r.URL.Path, new(atomic.Int64))
    v.(*atomic.Int64).Add(1)
}
```

### Race on a struct field

```go
type Cache struct {
    data map[string]string
}

var cache = &Cache{data: map[string]string{}}

func handler(w http.ResponseWriter, r *http.Request) {
    cache.data[r.URL.Path] = "visited" // race
}
```

Same problem: shared mutable struct without synchronisation.

Fix: embed a `sync.RWMutex` in the struct:
```go
type Cache struct {
    mu   sync.RWMutex
    data map[string]string
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    c.data[k] = v
    c.mu.Unlock()
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock()
    v, ok := c.data[k]
    c.mu.RUnlock()
    return v, ok
}
```

### Race on an interface variable

```go
var logger *log.Logger // package-level

func setLogger(l *log.Logger) {
    logger = l // race if called concurrently with handlers
}
```

Pointer reassignment of `*Logger` is technically a race per the memory model. Fix:
```go
var logger atomic.Pointer[log.Logger]

func setLogger(l *log.Logger) {
    logger.Store(l)
}

func handler(w http.ResponseWriter, r *http.Request) {
    logger.Load().Println("hit")
}
```

Or use `sync.RWMutex`.

---

## Shared state across handlers

Most production servers have shared state. Common examples:

| State | Concurrency tool |
|------|------------------|
| `*sql.DB` | None — internally safe |
| `*log.Logger` | None — internally safe |
| Configuration loaded at startup, never written | None — read-only after init |
| Cache (map of values) | `sync.RWMutex` or `sync.Map` |
| Counter, gauge | `atomic.Int64` |
| Rate limiter | `golang.org/x/time/rate.Limiter` — internally safe |
| Connection to upstream (gRPC, redis) | Usually safe by contract — check docs |
| Stateful business object | `sync.Mutex` (or rewrite to be immutable) |

### `*sql.DB` is safe

```go
var db *sql.DB

func init() {
    db, _ = sql.Open("postgres", "...")
}

func handler(w http.ResponseWriter, r *http.Request) {
    rows, _ := db.QueryContext(r.Context(), "SELECT 1")
    // ...
}
```

Many concurrent handlers call `db.QueryContext`. `*sql.DB` is a connection pool; safe for concurrent use.

### Configuration loaded at startup

If your config is loaded once at startup and never mutated:

```go
var cfg Config

func init() {
    cfg = loadConfig()
}

func handler(w http.ResponseWriter, r *http.Request) {
    // read-only access to cfg, no locks needed
    fmt.Fprintf(w, "hello, %s", cfg.Greeting)
}
```

Read-only sharing is safe without synchronisation, *as long as* you can prove no goroutine ever writes after the writes-happen-before-reads boundary. `init()` runs before `main()` and before any handler, so this is fine.

### Hot reload of config

If you want to swap the config at runtime:

```go
var cfg atomic.Pointer[Config]

func init() {
    cfg.Store(loadConfig())
}

func reload() {
    cfg.Store(loadConfig())
}

func handler(w http.ResponseWriter, r *http.Request) {
    c := cfg.Load()
    fmt.Fprintf(w, "hello, %s", c.Greeting)
}
```

`atomic.Pointer` makes the pointer write/read atomic; readers always see a complete `*Config`.

---

## The race detector

`go run -race` or `go test -race` instruments memory accesses. It reports any unsynchronised concurrent read/write to the same memory location.

### Running

```
go run -race main.go
```

Slower (~5-10x), uses more memory. Use during development and testing, NOT production.

### Sample output

```
==================
WARNING: DATA RACE
Write at 0x00c0000a8050 by goroutine 8:
  main.handler()
      /app/main.go:15 +0x4a
  net/http.HandlerFunc.ServeHTTP()
      /usr/local/go/src/net/http/server.go:2136 +0x47
...
Previous write at 0x00c0000a8050 by goroutine 7:
  main.handler()
      /app/main.go:15 +0x4a
...
```

It tells you the address, the writing goroutines, and the lines of code involved.

### When the race detector misses things

- Untaken code paths — the race only triggers if both racing accesses actually execute.
- Subtle timing — sometimes a race is hard to reproduce; run tests many times.
- Outside-Go code (cgo) — not instrumented.

So passing `-race` doesn't prove absence of races. But every race the detector catches is a real bug.

### Running tests under -race

In your CI:
```
go test -race ./...
```

This should be a standard part of every Go project's pipeline.

---

## Graceful shutdown for beginners

`http.ListenAndServe` blocks forever; how do you stop the server?

### `Server.Shutdown(ctx)`

Use `*http.Server` directly:

```go
package main

import (
    "context"
    "log"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    srv := &http.Server{
        Addr:    ":8080",
        Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            time.Sleep(2 * time.Second)
            w.Write([]byte("ok"))
        }),
    }

    go func() {
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            log.Fatal(err)
        }
    }()

    // wait for signal
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
    <-sigCh

    log.Println("shutting down...")
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := srv.Shutdown(ctx); err != nil {
        log.Println("shutdown error:", err)
    }
}
```

What happens on Ctrl-C:
1. `signal.Notify` writes to `sigCh`.
2. `<-sigCh` returns.
3. `srv.Shutdown(ctx)` is called.
4. Server closes the listener (no new accepts).
5. Idle connections close immediately.
6. Active connections finish their current request, then close.
7. When all in-flight requests are done, `Shutdown` returns nil.
8. If 10 seconds pass first, `Shutdown` returns `context.DeadlineExceeded`.

### Pitfall: `ListenAndServe` error

When `Shutdown` runs, `ListenAndServe` returns `http.ErrServerClosed`. That's not a real error; check for it:

```go
if err := srv.ListenAndServe(); err != http.ErrServerClosed {
    log.Fatal(err)
}
```

Otherwise normal shutdown looks like a crash.

### `Server.Close()` for emergencies

If `Shutdown` hangs (e.g., one handler blocking forever), call `Close()` to forcibly close all connections:

```go
if err := srv.Shutdown(ctx); err != nil {
    log.Println("forced close")
    srv.Close()
}
```

---

## Server timeouts in plain terms

Server timeouts control how long the server is willing to wait at various phases. Defaults are `0` (no timeout), which is dangerous in production.

| Field | Plain English |
|------|---------------|
| `ReadHeaderTimeout` | How long the client gets to send the request headers. |
| `ReadTimeout` | How long the client gets to send the entire request (headers + body). |
| `WriteTimeout` | How long the server has to send the response. |
| `IdleTimeout` | How long to keep an idle keep-alive connection open. |

### Why timeouts exist

Without timeouts:
- A slow attacker can keep thousands of connections open, sending headers one byte at a time, exhausting your server's file descriptors and goroutines (slowloris attack).
- A misbehaving client can never finish reading a response, holding the conn forever.

### Reasonable defaults

```go
srv := &http.Server{
    Addr:              ":8080",
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       30 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       60 * time.Second,
    Handler:           mux,
}
```

For upload-heavy services, raise `ReadTimeout` or set it to `0` (no overall body limit) but keep `ReadHeaderTimeout` short.

For long-poll/SSE, leave `WriteTimeout` at `0` and use `r.Context().Done()` inside the handler.

---

## Mental models

### Model 1 — The receptionist and the workers

The accept loop is a receptionist who greets every arriving guest and assigns each one a personal assistant (a goroutine). The assistant escorts the guest through the entire interaction: reads what they want, calls the appropriate department, brings back the result, says goodbye, escorts them out.

If a guest stays around for more business (keep-alive), the same assistant serves them again.

Many guests in the lobby = many assistants = many goroutines.

### Model 2 — Email auto-responder

Imagine an inbox that auto-spawns a process per incoming email. Each process reads the email, replies, exits. Concurrent emails = concurrent processes. They don't see each other unless they touch a shared file (= shared state needing locks).

### Model 3 — Restaurant kitchen

Many cooks (goroutines) take orders (requests) and prepare them. The kitchen (the server) has shared equipment (state). The cooks must coordinate use of the equipment (locks). Without coordination, two cooks reach for the same knife at the same time (race condition).

### Model 4 — Mailbox per request

`r.Context()` is a mailbox the server can send a "cancel" message to. If your handler ignores the mailbox, you keep working after the client has hung up. Polite handlers check the mailbox periodically (via `select` with `<-r.Context().Done()`).

---

## Coding patterns

### Pattern 1 — Use `http.NewRequestWithContext` for upstream

```go
req, err := http.NewRequestWithContext(r.Context(), "GET", url, nil)
if err != nil { ... }
resp, err := http.DefaultClient.Do(req)
```

Propagates cancellation.

### Pattern 2 — Buffered channel for goroutine results

```go
out := make(chan result, 1) // size 1 so producer never blocks
go func() { out <- doWork() }()
select {
case res := <-out:
case <-r.Context().Done():
    return
}
```

Avoids leaks if the producer outlasts the consumer.

### Pattern 3 — Always set timeouts

```go
srv := &http.Server{
    ReadHeaderTimeout: 5 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       60 * time.Second,
    Handler: mux,
}
```

Never use `http.ListenAndServe` for production.

### Pattern 4 — Recover panics in middleware

```go
func recoverer(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if err := recover(); err != nil {
                log.Printf("panic: %v\n%s", err, debug.Stack())
                http.Error(w, "internal error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

The stdlib has its own panic recover at the conn level, but middleware lets you choose the response.

### Pattern 5 — Sequential reads of request data

```go
func handler(w http.ResponseWriter, r *http.Request) {
    body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
    if err != nil { http.Error(w, err.Error(), 400); return }
    // process body, write response
    w.Write([]byte("ok"))
}
```

Read body in handler goroutine, never in spawned goroutines.

---

## Clean code

Some clean-code rules specific to HTTP handlers.

### Use named types for request/response shapes

Don't unpack JSON into `map[string]any`. Use struct types:

```go
type CreateUserRequest struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}

type CreateUserResponse struct {
    ID string `json:"id"`
}

func createUser(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, err.Error(), 400)
        return
    }
    // ...
    json.NewEncoder(w).Encode(CreateUserResponse{ID: id})
}
```

### Separate routing from logic

```go
// router.go
mux := http.NewServeMux()
mux.HandleFunc("/users", users.Create)
mux.HandleFunc("/users/", users.Get)

// users/handler.go
func Create(w http.ResponseWriter, r *http.Request) { ... }
func Get(w http.ResponseWriter, r *http.Request) { ... }
```

### Reuse logic, not handlers

Don't share state through global handlers; share through services.

```go
type UserService struct {
    db *sql.DB
}

func (s *UserService) Create(w http.ResponseWriter, r *http.Request) {
    // use s.db
}

func main() {
    db := openDB()
    us := &UserService{db: db}
    mux := http.NewServeMux()
    mux.HandleFunc("/users", us.Create)
}
```

Now `UserService` is testable in isolation.

### Avoid `http.DefaultServeMux`

It's package-level mutable state. Multiple `init()` functions can register conflicting handlers. Use your own `*http.ServeMux`:

```go
mux := http.NewServeMux()
mux.HandleFunc(...)
srv := &http.Server{Handler: mux}
```

---

## Error handling

In handlers, errors fall into:

1. **Client errors (4xx).** Return with `http.Error(w, msg, status)` and stop.
2. **Server errors (5xx).** Log internally; return a generic message to the client.
3. **Cancellation.** `r.Context().Err()` is `context.Canceled` or `context.DeadlineExceeded`; usually just return without writing.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    if err := validate(r); err != nil {
        http.Error(w, err.Error(), 400)
        return
    }
    result, err := doWork(r.Context())
    if err != nil {
        if errors.Is(err, context.Canceled) {
            return // client gave up
        }
        log.Printf("doWork: %v", err)
        http.Error(w, "internal error", 500)
        return
    }
    json.NewEncoder(w).Encode(result)
}
```

### Don't leak internal errors

Avoid:
```go
http.Error(w, err.Error(), 500)  // leaks db connection strings, file paths, etc.
```

Better:
```go
log.Printf("internal: %v", err)
http.Error(w, "internal error", 500)
```

### Headers must be set before WriteHeader

```go
w.Header().Set("Content-Type", "application/json")
w.Header().Set("X-Request-ID", reqID)
w.WriteHeader(http.StatusOK) // headers locked here
json.NewEncoder(w).Encode(result)
```

Once `WriteHeader` is called (explicitly or implicitly by the first `Write`), the headers are sent and can't be changed.

---

## Security considerations

### Slowloris

Attacker opens many connections, sends headers one byte per second. Without `ReadHeaderTimeout`, all those connections stay open. Set it:

```go
ReadHeaderTimeout: 5 * time.Second,
```

### Body size

Without limits, an attacker can POST 100 GiB. Use `http.MaxBytesReader`:

```go
r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // 10 MiB
```

### Header size

`MaxHeaderBytes` defaults to 1 MiB. Tighten for stricter limits:

```go
srv.MaxHeaderBytes = 16 << 10 // 16 KiB
```

### Connection count

By default, unlimited. Combine with `golang.org/x/net/netutil.LimitListener`:

```go
ln = netutil.LimitListener(ln, 10000)
```

### TLS

Use `srv.ListenAndServeTLS(certFile, keyFile)` with TLS 1.2+:

```go
srv.TLSConfig = &tls.Config{
    MinVersion: tls.VersionTLS12,
}
```

### Don't trust client headers

`X-Forwarded-For`, `User-Agent`, etc. are attacker-controlled. Validate, sanitize, never reflect into HTML without escaping.

---

## Performance tips

These are introductory; `optimize.md` has the deep dive.

### Reuse buffers with `sync.Pool`

For hot-path allocations:

```go
var pool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func handler(w http.ResponseWriter, r *http.Request) {
    buf := pool.Get().(*bytes.Buffer)
    buf.Reset()
    defer pool.Put(buf)
    fmt.Fprintf(buf, "hello %s", r.URL.Query().Get("name"))
    w.Write(buf.Bytes())
}
```

### Avoid `fmt.Sprintf` in hot paths

```go
// slow
msg := fmt.Sprintf("hello %s", name)

// faster
msg := "hello " + name
```

For more complex formatting, use `strconv.AppendInt`/`AppendFloat` to build slices without allocation.

### Don't `ReadAll` if you can stream

```go
// allocates whole body
body, _ := io.ReadAll(r.Body)
json.Unmarshal(body, &req)

// streams
json.NewDecoder(r.Body).Decode(&req)
```

### Compress responses

```go
import "compress/gzip"

func handler(w http.ResponseWriter, r *http.Request) {
    if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
        w.Header().Set("Content-Encoding", "gzip")
        gz := gzip.NewWriter(w)
        defer gz.Close()
        gz.Write(largeBody)
        return
    }
    w.Write(largeBody)
}
```

---

## Best practices

1. Always use `*http.Server`, never `http.ListenAndServe` directly for production.
2. Set `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout`.
3. Pass `r.Context()` to every downstream call.
4. Don't share `http.ResponseWriter` or `r.Body` with other goroutines.
5. Handle `http.ErrServerClosed` as the success case.
6. Recover panics in middleware.
7. Use `-race` in tests.
8. Set `MaxBytesReader` on every body read.
9. Don't expose `net/http/pprof` on a public port.
10. Use structured logging (`log/slog`).

---

## Edge cases and pitfalls

### "It works on localhost but breaks in production"

Localhost has zero latency, no packet loss. Production has both. Symptoms:
- Race conditions surface (timing changes).
- Timeouts fire (server slower under real network).
- Goroutine leaks (slow clients pin goroutines longer).

Test with artificial latency (`tc qdisc` on Linux, Toxiproxy) before deploying.

### "My response is truncated"

Likely causes:
- `WriteTimeout` fired before the response finished.
- Handler panicked and the recovery sent partial output.
- Client closed the connection mid-response.
- You called `WriteHeader` twice (second call ignored, but logged).

### "Some requests are very slow randomly"

Could be:
- GC pauses (large heap, frequent allocation).
- Lock contention on a shared resource.
- Connection limit reached (kernel SYN queue overflow).
- Database slowness with no query timeout.

`pprof` and `runtime/trace` are the diagnostic tools.

### "Goroutines keep climbing"

Classic leak. See `find-bug.md` and `professional.md` for diagnosis.

### "I get `EOF` reading the body sometimes"

Client disconnected before sending the full body. Check `r.Context().Err()` to confirm.

---

## Common mistakes

1. **Spawning a goroutine to write to `w`.** Race + use-after-return.
2. **Using `context.Background()` for upstream calls inside handlers.** Loses cancellation.
3. **Not setting timeouts on `*http.Server`.** Slowloris vulnerability.
4. **Calling `WriteHeader` after `Write`.** First `Write` implicitly calls `WriteHeader(200)`; later explicit call is ignored.
5. **Reading `r.Body` after handler returns.** Use-after-free.
6. **`fmt.Sprintf` in hot paths.** Allocates; slow at scale.
7. **Mutating `r` from handlers.** Don't; pass derived data instead.
8. **Closing `w` or `r.Body` and continuing to use them.** Don't.

---

## Common misconceptions

> "Handlers run on a thread pool."

No. Each connection gets a fresh goroutine. Goroutines are not pooled by `net/http`.

> "`r.Context()` cancels when the handler returns."

True, but more importantly, it cancels when the *client* disconnects mid-handler.

> "`Server.Shutdown` returns when the listener closes."

No. It returns when the listener is closed AND all in-flight requests have finished AND all idle conns are closed.

> "I can write to `w` from any goroutine as long as I take a mutex."

Technically you can, but it's still a use-after-return bug if your goroutine writes after the handler returns. Don't do it.

> "HTTP/1.1 keep-alive sends requests in parallel."

No — keep-alive is sequential request/response pairs on one connection. Parallelism comes from multiple connections or HTTP/2.

> "`http.ListenAndServe` is single-threaded."

No — it serves concurrent connections concurrently. The accept loop is one goroutine, each connection is another, and so on.

---

## Tricky points

### The body is consumed when you don't read it

If your handler doesn't fully read `r.Body`, the server reads-and-discards remaining bytes after the handler returns (so the next request can be parsed). This can take noticeable time for large unread bodies.

If you don't want this, set `r.Body = http.MaxBytesReader(w, r.Body, 1)` early to truncate, or close the connection with `Connection: close`.

### `Flusher` and chunked transfer

If you want to stream a response (e.g., SSE), use `Flusher`:

```go
func sse(w http.ResponseWriter, r *http.Request) {
    fl, ok := w.(http.Flusher)
    if !ok { http.Error(w, "no streaming", 500); return }
    w.Header().Set("Content-Type", "text/event-stream")
    for i := 0; i < 10; i++ {
        fmt.Fprintf(w, "data: %d\n\n", i)
        fl.Flush() // pushes to client immediately
        time.Sleep(time.Second)
        if r.Context().Err() != nil { return }
    }
}
```

Without `Flush()`, the response sits in the server's write buffer until the handler returns.

### `Connection: Upgrade` doesn't go through your handler in HTTP/2

WebSockets require HTTP/1.1 (with `Hijack()`). On HTTP/2, the upgrade is invalid. If your handler does `Hijack()` and the connection is HTTP/2, you get `http.ErrNotSupported`.

### `http.HandlerFunc(fn)` is just a type cast

```go
type HandlerFunc func(ResponseWriter, *Request)
func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) { f(w, r) }
```

No goroutines involved. It's just a way to make a function value satisfy `http.Handler`.

---

## Test

Write a simple test for a handler:

```go
package main

import (
    "io"
    "net/http"
    "net/http/httptest"
    "testing"
)

func TestHandler(t *testing.T) {
    req := httptest.NewRequest("GET", "/?name=Bob", nil)
    rec := httptest.NewRecorder()
    handler(rec, req)
    resp := rec.Result()
    body, _ := io.ReadAll(resp.Body)
    if string(body) != "hello, Bob\n" {
        t.Errorf("got %q", body)
    }
}
```

`httptest.NewRecorder` is a fake `http.ResponseWriter`. `httptest.NewRequest` is a fake `*http.Request`. No goroutines or sockets needed.

For end-to-end:

```go
func TestServer(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(handler))
    defer srv.Close()
    
    resp, _ := http.Get(srv.URL + "/?name=Bob")
    body, _ := io.ReadAll(resp.Body)
    resp.Body.Close()
    if string(body) != "hello, Bob\n" {
        t.Errorf("got %q", body)
    }
}
```

`httptest.NewServer` starts a real server on a random port. `srv.Close()` shuts it down.

Run with `-race`:

```
go test -race ./...
```

---

## Tricky questions

### Q1. Inside a handler, you call `go someFunc(r.Context())`. The handler then returns. Is the goroutine still alive?

**A.** Yes, the goroutine is alive, but its context is cancelled. `someFunc` should observe `<-ctx.Done()` and exit quickly. If it doesn't, leak.

### Q2. You call `w.Write` and then `w.WriteHeader(404)`. What status does the client see?

**A.** 200. The first `Write` implicitly set status to 200. The later `WriteHeader(404)` is ignored (and logged).

### Q3. The server is in `Shutdown` and `Shutdown` is blocking. What causes it to unblock?

**A.** Either:
- All active connections become idle (their handlers return), then they close → `Shutdown` returns nil.
- The ctx passed to `Shutdown` is cancelled → returns `ctx.Err()`.

### Q4. Why is there no `Server.MaxHandlers` field?

**A.** There isn't one. You implement concurrency limits with `golang.org/x/net/netutil.LimitListener` (connection-level), middleware (request-level), or `http2.Server.MaxConcurrentStreams` (HTTP/2 streams).

### Q5. Two connections, each running a handler. The handlers share a `*sync.Mutex`. Is this safe?

**A.** Yes, that's exactly what `sync.Mutex` is for. The two handlers contend on the lock; one waits for the other.

### Q6. After `Hijack()`, who reads from the conn?

**A.** Your code. The server is out of the picture.

### Q7. What's the difference between `http.Handler` and `http.HandlerFunc`?

**A.** `Handler` is an interface (`ServeHTTP(w, r)`). `HandlerFunc` is a concrete function type that adapts a plain function to satisfy the interface.

---

## Cheat sheet

```go
// Build server
srv := &http.Server{
    Addr:              ":8080",
    Handler:           mux,
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       30 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       60 * time.Second,
    MaxHeaderBytes:    1 << 16,
}

// Run + graceful shutdown
go func() {
    if err := srv.ListenAndServe(); err != http.ErrServerClosed {
        log.Fatal(err)
    }
}()
sig := make(chan os.Signal, 1)
signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
<-sig
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
srv.Shutdown(ctx)

// Handler with cancellation
func h(w http.ResponseWriter, r *http.Request) {
    req, _ := http.NewRequestWithContext(r.Context(), "GET", url, nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil { http.Error(w, err.Error(), 502); return }
    defer resp.Body.Close()
    io.Copy(w, resp.Body)
}

// Concurrency-safe shared map
var (
    mu sync.RWMutex
    m  = map[string]string{}
)

// Body size limit
r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

// Race detector
go test -race ./...
```

---

## Self-assessment checklist

- [ ] I can write a server that survives `go test -race` with simulated concurrent clients.
- [ ] I can explain why `http.ResponseWriter` is not safe for concurrent use.
- [ ] I can propagate `r.Context()` to all downstream operations.
- [ ] I can implement graceful shutdown.
- [ ] I know all four timeout fields and when each fires.
- [ ] I can find shared state in my code and decide whether it needs locking.
- [ ] I can describe what happens between `ln.Accept()` and `handler(w, r)`.
- [ ] I can spawn a goroutine from a handler without leaking it.
- [ ] I can run `pprof` and find a goroutine leak.
- [ ] I can decide when to use `sync.Map`, `sync.RWMutex`, or `atomic.Pointer`.

---

## Summary

The Go `net/http` server uses a goroutine-per-connection model. Each accepted TCP connection becomes one new goroutine; that goroutine reads requests, calls your handler, and writes responses, one at a time per HTTP/1.1 (many concurrent streams per HTTP/2). Your handler runs synchronously inside that goroutine; concurrency comes from many such goroutines running in parallel.

Your responsibilities as a handler author:
1. Don't touch `http.ResponseWriter` from other goroutines or after returning.
2. Propagate `r.Context()` to anything that takes a context.
3. Don't read `r.Body` outside the handler call.
4. Protect any state shared across handler instances with `sync.Mutex`, `sync/atomic`, or immutability.
5. Set server timeouts so a slow client can't hold a goroutine forever.
6. Handle graceful shutdown via `Server.Shutdown`.

The race detector (`go test -race`) is your safety net for concurrent-access bugs. Use it in CI. `pprof` is your tool for diagnosing leaks. Production servers configure timeouts, structured logging, signal handling, and connection limits.

---

## What you can build

After this file you can build:
- A REST API with concurrent clients.
- A graceful-shutdown server with SIGINT handling.
- A handler that fans out to multiple upstream services with cancellation.
- A streaming response handler using `Flusher`.
- A simple in-memory cache backed by a mutex-protected map.
- A panic-recovery middleware.
- A request-logging middleware.

You should NOT yet attempt:
- A WebSocket server (needs `Hijack()` knowledge).
- A custom rate limiter at the connection level (needs `netutil.LimitListener` understanding).
- A high-throughput production server (read `middle.md`, `senior.md`, `professional.md` first).

---

## Further reading

- [Go `net/http` docs](https://pkg.go.dev/net/http) — the canonical reference.
- "Go's HTTP server: a deep dive" — search GopherCon talks.
- Effective Go's section on concurrency.
- The Go memory model: <https://go.dev/ref/mem>.
- `middle.md` in this subsection — walks through `(*conn).serve` line by line.

---

## Related topics

- 21-concurrent-data-structures — `sync.Map`, lock-free patterns.
- 22-memory-ordering-barriers — what `sync/atomic` actually does on the CPU.
- Future: 02-net-conn (in this section) — the lower-layer `net.Listener` and `net.Conn` model.

---

## Diagrams and Visual Aids

```
+------------------+        Accept        +------------------+
|  net.Listener    | -------------------> |   *conn (state)  |
+------------------+                      +---------+--------+
                                                    |
                                                    | go c.serve(ctx)
                                                    v
                                          +--------------------+
                                          | Per-conn goroutine |
                                          |  - reads requests  |
                                          |  - calls handler   |
                                          |  - writes responses|
                                          +--------------------+
```

```
Connection lifecycle (HTTP/1.1 with keep-alive)

  Accept -> spawn goroutine -> TLS handshake (if TLS)
                              \
                               +-> readRequest
                               |       |
                               |       v
                               |   buildRequest
                               |       |
                               |       v
                               |   handler.ServeHTTP(w, r)
                               |       |
                               |       v
                               |   finishRequest
                               |       |
                               |       v
                               |   if keepalive: loop
                               |   else: break
                               v
                            close conn -> goroutine ends
```

```
Concurrent connections, separate goroutines

   client A -> conn A -> goroutine G_A -> handler running
   client B -> conn B -> goroutine G_B -> handler running    <-- parallel
   client C -> conn C -> goroutine G_C -> handler running
   ...

   shared state needs locks/atomics
   per-handler state is local, no sharing
```

```
r.Context() cancellation flow

  client closes conn ----------+
                                \
  HTTP/2 RST_STREAM -----------+--> cancelCtx() called
                                /
  handler returns -------------+
                                \
                                 v
                          r.Context().Done() closed
                                |
                                v
                     downstream calls observe cancellation
                          (db queries, upstream HTTP)
```

---

## Extended worked examples

This section walks through five small but complete programs that illustrate the concurrency points discussed above. Each is runnable and small enough to read in one sitting. If you can write each of these without looking, you have absorbed the chapter.

### Example 1 — Counting connections vs counting requests

We expose two counters: total accepted connections and total HTTP requests. They differ because of keep-alive.

```go
package main

import (
    "fmt"
    "net"
    "net/http"
    "sync/atomic"
    "time"
)

var (
    connCount atomic.Int64
    reqCount  atomic.Int64
)

type countingListener struct {
    net.Listener
}

func (l *countingListener) Accept() (net.Conn, error) {
    c, err := l.Listener.Accept()
    if err == nil {
        connCount.Add(1)
    }
    return c, err
}

func handler(w http.ResponseWriter, r *http.Request) {
    reqCount.Add(1)
    fmt.Fprintf(w, "conn=%d req=%d\n", connCount.Load(), reqCount.Load())
}

func main() {
    ln, _ := net.Listen("tcp", ":8080")
    ln = &countingListener{Listener: ln}
    srv := &http.Server{
        Handler:           http.HandlerFunc(handler),
        ReadHeaderTimeout: 5 * time.Second,
        IdleTimeout:       30 * time.Second,
    }
    srv.Serve(ln)
}
```

Test:
```
# new connection per request
$ for i in 1 2 3; do curl http://localhost:8080/; done
conn=1 req=1
conn=2 req=2
conn=3 req=3

# keep-alive: one connection, many requests
$ curl --keepalive-time 60 http://localhost:8080/ http://localhost:8080/ http://localhost:8080/
conn=4 req=4
conn=4 req=5
conn=4 req=6
```

The lesson: in HTTP/1.1, request count grows with each request; connection count grows only when a new TCP connection is opened.

### Example 2 — A handler that observes client disconnect

This handler does slow work and is correctly cancellable.

```go
package main

import (
    "fmt"
    "net/http"
    "time"
)

func slow(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    for i := 0; i < 10; i++ {
        select {
        case <-time.After(time.Second):
            fmt.Fprintf(w, "tick %d\n", i)
            if f, ok := w.(http.Flusher); ok {
                f.Flush()
            }
        case <-ctx.Done():
            // client disconnected; clean up
            fmt.Println("client gave up at tick", i)
            return
        }
    }
    fmt.Fprintln(w, "done")
}

func main() {
    http.HandleFunc("/slow", slow)
    http.ListenAndServe(":8080", nil)
}
```

Test:
```
$ curl http://localhost:8080/slow
tick 0
tick 1
...
```

Press Ctrl-C mid-stream. The server prints "client gave up at tick N" and the handler returns. No leak.

If the handler ignored `ctx.Done()`, it would keep running for all 10 seconds regardless.

### Example 3 — Shared cache with `sync.RWMutex`

A simple in-memory cache shared across all handlers.

```go
package main

import (
    "fmt"
    "net/http"
    "strings"
    "sync"
)

type Cache struct {
    mu   sync.RWMutex
    data map[string]string
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    v, ok := c.data[k]
    return v, ok
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data[k] = v
}

var cache = &Cache{data: map[string]string{}}

func handler(w http.ResponseWriter, r *http.Request) {
    k := strings.TrimPrefix(r.URL.Path, "/")
    switch r.Method {
    case http.MethodGet:
        if v, ok := cache.Get(k); ok {
            fmt.Fprintln(w, v)
        } else {
            http.NotFound(w, r)
        }
    case http.MethodPut:
        var sb strings.Builder
        // limit body to 1 MiB; in real code use http.MaxBytesReader
        if _, err := sb.ReadFrom(r.Body); err != nil {
            http.Error(w, err.Error(), 400)
            return
        }
        cache.Set(k, sb.String())
        w.WriteHeader(http.StatusCreated)
    default:
        http.Error(w, "method not allowed", 405)
    }
}

func main() {
    http.HandleFunc("/", handler)
    http.ListenAndServe(":8080", nil)
}
```

`RWMutex` lets many readers proceed in parallel; writers exclude all readers. Under `-race`, this should be clean.

### Example 4 — Fan-out to multiple services with `errgroup`

`golang.org/x/sync/errgroup` is a small helper for "wait for N goroutines, propagate the first error, share cancellation."

```go
package main

import (
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "sync"

    "golang.org/x/sync/errgroup"
)

func fanout(w http.ResponseWriter, r *http.Request) {
    g, ctx := errgroup.WithContext(r.Context())
    var mu sync.Mutex
    results := map[string]string{}

    sources := []string{
        "https://httpbin.org/get",
        "https://httpbin.org/uuid",
        "https://httpbin.org/headers",
    }

    for _, src := range sources {
        src := src
        g.Go(func() error {
            req, _ := http.NewRequestWithContext(ctx, "GET", src, nil)
            resp, err := http.DefaultClient.Do(req)
            if err != nil { return err }
            defer resp.Body.Close()
            body, err := io.ReadAll(resp.Body)
            if err != nil { return err }
            mu.Lock()
            results[src] = string(body)
            mu.Unlock()
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), 502)
        return
    }
    json.NewEncoder(w).Encode(results)
}

func main() {
    http.HandleFunc("/fan", fanout)
    http.ListenAndServe(":8080", nil)
}
```

Three concurrent requests share `r.Context()`. If any fails or the client disconnects, the group's context cancels, and the other in-flight requests abort. The mutex protects the result map.

### Example 5 — Graceful shutdown with background workers

```go
package main

import (
    "context"
    "log"
    "net/http"
    "os"
    "os/signal"
    "sync"
    "syscall"
    "time"
)

type Worker struct {
    ch   chan string
    done chan struct{}
}

func (w *Worker) Run() {
    defer close(w.done)
    for msg := range w.ch {
        log.Println("processing:", msg)
        time.Sleep(time.Second) // simulate work
    }
}

func (w *Worker) Stop() {
    close(w.ch)
    <-w.done
}

func main() {
    worker := &Worker{ch: make(chan string, 100), done: make(chan struct{})}
    go worker.Run()

    srv := &http.Server{
        Addr: ":8080",
        Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            select {
            case worker.ch <- r.URL.Path:
                w.Write([]byte("queued"))
            case <-r.Context().Done():
                return
            }
        }),
    }

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            log.Fatal(err)
        }
    }()

    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
    <-sigCh
    log.Println("shutdown initiated")

    // 1. Stop accepting HTTP.
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := srv.Shutdown(ctx); err != nil {
        log.Println("shutdown:", err)
    }

    // 2. Stop the worker (after all handlers finished enqueueing).
    worker.Stop()

    wg.Wait()
    log.Println("clean exit")
}
```

The order is critical:
1. Stop HTTP first so no new items are enqueued.
2. Stop the worker, which drains its queue.

If you stopped the worker first, the still-running handlers would deadlock trying to send into a closed channel.

---

## Concurrency anti-patterns specific to handlers

### Anti-pattern 1 — `time.AfterFunc` writing to `w`

```go
func bad(w http.ResponseWriter, r *http.Request) {
    time.AfterFunc(time.Second, func() {
        w.Write([]byte("late")) // race + use-after-return
    })
    w.Write([]byte("now"))
}
```

`time.AfterFunc` runs its function on a goroutine spawned by the runtime. By the time it fires, the handler has returned. Don't write to `w` from it.

### Anti-pattern 2 — Storing `*Request` in a queue

```go
var queue = make(chan *http.Request, 100)

func handler(w http.ResponseWriter, r *http.Request) {
    queue <- r
    w.Write([]byte("queued"))
}

func processQueue() {
    for r := range queue {
        // r.Body is closed/reused by now!
        body, _ := io.ReadAll(r.Body)
        // garbage or panic
    }
}
```

After the handler returns, `r.Body` is no longer valid. Extract what you need *inside* the handler, then enqueue the extracted data:

```go
type job struct {
    path string
    body []byte
    headers http.Header
}

var queue = make(chan job, 100)

func handler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
    select {
    case queue <- job{path: r.URL.Path, body: body, headers: r.Header.Clone()}:
        w.Write([]byte("queued"))
    case <-r.Context().Done():
        return
    }
}
```

### Anti-pattern 3 — Sleeping while holding a global lock

```go
var mu sync.Mutex

func handler(w http.ResponseWriter, r *http.Request) {
    mu.Lock()
    defer mu.Unlock()
    time.Sleep(time.Second) // blocks ALL other handlers
    w.Write([]byte("ok"))
}
```

Every other handler waiting on `mu` is also blocked. Hold the lock only for the critical section.

### Anti-pattern 4 — Calling `http.Get` from a handler without context

```go
func proxy(w http.ResponseWriter, r *http.Request) {
    resp, _ := http.Get("http://upstream/data") // uses context.Background()
    defer resp.Body.Close()
    io.Copy(w, resp.Body)
}
```

If `upstream` hangs, this handler hangs forever. Use `NewRequestWithContext`.

### Anti-pattern 5 — Closing channels from many goroutines

```go
var ch = make(chan int)

func handler(w http.ResponseWriter, r *http.Request) {
    ch <- 42
    close(ch) // many handlers will panic on second close
}
```

Channels must be closed exactly once. From handler code, closing a shared channel is almost always wrong. The owning goroutine (often the receiver) should close.

### Anti-pattern 6 — Mutating `r.Header` from middleware after handler started

```go
func middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        next.ServeHTTP(w, r)
        r.Header.Set("X-Logged", "true") // weird; harmless but pointless
    })
}
```

After `next.ServeHTTP` returns, modifying `r.Header` does nothing observable. Worse, if `next` spawned a goroutine still reading headers, you have a race. Don't mutate.

### Anti-pattern 7 — Goroutine pools "to limit concurrency"

```go
var pool = make(chan struct{}, 100)

func handler(w http.ResponseWriter, r *http.Request) {
    pool <- struct{}{}
    defer func() { <-pool }()
    // ...
}
```

This blocks the handler's goroutine waiting for the pool. The server already spawned the goroutine; you didn't save anything. The goroutine still exists, holding a stack and `*Request`. To actually limit concurrency, return early (503) when full:

```go
select {
case pool <- struct{}{}:
    defer func() { <-pool }()
    // do work
default:
    http.Error(w, "too busy", 503)
    return
}
```

---

## Diving slightly deeper: how the accept loop actually iterates

The real accept loop is in `net/http/server.go` around line 3260. Simplified:

```go
func (srv *Server) Serve(l net.Listener) error {
    var tempDelay time.Duration
    ctx := context.WithValue(baseCtx, ServerContextKey, srv)
    for {
        rw, err := l.Accept()
        if err != nil {
            select {
            case <-srv.getDoneChan():
                return ErrServerClosed
            default:
            }
            if ne, ok := err.(net.Error); ok && ne.Temporary() {
                if tempDelay == 0 { tempDelay = 5 * time.Millisecond } else { tempDelay *= 2 }
                if tempDelay > time.Second { tempDelay = time.Second }
                srv.logf("Accept error: %v; retrying in %v", err, tempDelay)
                time.Sleep(tempDelay)
                continue
            }
            return err
        }
        tempDelay = 0
        c := srv.newConn(rw)
        c.setState(c.rwc, StateNew, runHooks)
        go c.serve(ctx)
    }
}
```

Junior takeaways:
- Accept returns an error if the listener is closed; the server checks `doneChan` to distinguish shutdown from a real error.
- On a temporary error (e.g., "too many open files"), the loop backs off exponentially (5ms, 10ms, 20ms, ..., capped at 1s) rather than spinning.
- `setState` and `newConn` are bookkeeping; `go c.serve(ctx)` is the actual goroutine spawn.

Don't worry about the details. The pattern is "Accept → spawn goroutine → repeat."

---

## When NOT to use `net/http`

`net/http` is the right answer for 95% of HTTP services. But there are edge cases:

1. **Extreme throughput** (millions of req/s on a single box). `fasthttp` (github.com/valyala/fasthttp) gives ~2x throughput by reusing request/response structs and not following the `net/http` API contracts. Trade-off: incompatible API; some things harder.
2. **HTTP/3 (QUIC).** Use `quic-go`; `net/http` only supports h1/h2.
3. **Very specific TLS needs.** `net/http` exposes most via `tls.Config`; for unusual cases (custom ALPN handlers, exotic ciphers), you may want a lower-level TLS layer.
4. **Embedded systems.** A toy server with `net.Conn` and hand-written parsing is smaller.

For a normal API server, web service, or proxy, `net/http` is correct.

---

## A note on `http.ServeMux`

`http.ServeMux` is a simple router. It's safe for concurrent use of registered handlers, but registration is not (you should register all handlers at startup, before serving).

```go
mux := http.NewServeMux()
mux.HandleFunc("/", handler)        // register at startup
mux.HandleFunc("/users", users)
// don't call HandleFunc after Server starts!

srv := &http.Server{Addr: ":8080", Handler: mux}
go srv.ListenAndServe()
```

For richer routing (path params, regex), use `chi`, `gorilla/mux`, or in Go 1.22+ the enhanced `net/http` route patterns:

```go
mux.HandleFunc("GET /users/{id}", getUser) // Go 1.22+
```

This doesn't change concurrency; routing happens per request and dispatches to your handler the same way.

---

## Recap

You now know:
- Goroutine-per-connection: one goroutine per accepted TCP conn, handling many requests (HTTP/1.1 keep-alive).
- `http.ResponseWriter` and `r.Body` are bound to the handler goroutine; never share with spawned goroutines.
- `r.Context()` cancels when the client disconnects or the handler returns.
- Goroutines from handlers must observe cancellation and not write to `w` after return.
- Shared state across handlers needs `sync.Mutex`/`sync.RWMutex`/`sync/atomic` or immutability.
- Server timeouts (`ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout`) are mandatory in production.
- `Server.Shutdown(ctx)` for graceful shutdown; `Server.Close()` for forceful.
- `go test -race` catches concurrent-access bugs.

The next file, `middle.md`, opens up `net/http/server.go` and walks through `(*conn).serve` line by line. You'll see exactly which goroutines the server creates, how the active-connection map works, and the precise sequence of state transitions.

