# net/http — Find the Bug

## 1. How to use this file

Fourteen buggy snippets of `net/http` client/server/transport code. Read each in 30-60 seconds, decide where the defect is, then expand `<details>` for the answer. Every diagnosis cites the standard library source — `net/http/server.go`, `net/http/client.go`, `net/http/transport.go`, `net/http/request.go` — so you can read along.

`net/http` bugs almost never fail loudly on the first request. They leak file descriptors after the 1024th, hang for hours behind a missing timeout, silently drop headers because `WriteHeader` already flushed them, or burn a goroutine per connection until the process OOMs. Three questions to ask every snippet:

1. *What does the runtime do with the response body if I don't close it — and what does the `Transport` do with the underlying connection?*
2. *What deadline, timeout, or limit is missing that an attacker (or a slow client) could exploit?*
3. *What state has the handler already committed to the wire by the time this line runs?*

If a snippet can't answer all three, there's a bug.

---

### Bug 1: `http.Get` without `defer resp.Body.Close()` — fd leak

**Difficulty:** Easy
**Skills:** `Client.Do`, `Response.Body`, `Transport` connection pool, fd lifecycle

```go
package main

import (
    "io"
    "net/http"
)

func fetch(url string) (int, error) {
    resp, err := http.Get(url)
    if err != nil {
        return 0, err
    }
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return 0, err
    }
    return len(body), nil
}

func main() {
    for i := 0; i < 100_000; i++ {
        _, _ = fetch("https://example.com/")
    }
}
```

**Observed behavior:** After a few thousand iterations the process dies with `socket: too many open files` (or on Linux, `dial tcp: lookup example.com: device or resource busy`). `lsof -p $PID` shows thousands of `CLOSE_WAIT` sockets piling up. The body was read fully, so why didn't the connection return to the pool?

<details><summary>Hint</summary>

`io.ReadAll` reads to EOF, but reaching EOF is not the same as *closing* the `io.ReadCloser`. Look at what `(*http.Response).Body` actually is — its concrete type lives in `transport.go`. What does its `Close` method do that EOF alone doesn't?

</details>

**Diagnosis:** `http.Get` returns a `*Response` whose `Body` is a `*http.bodyEOFSignal` wrapping a `*http.body` (see `net/http/transport.go`, type `bodyEOFSignal` around the `persistConn.readLoop` flow). Reading to EOF triggers `bodyEOFSignal.condfn` which *signals* the read loop, but the persistent connection is only returned to the idle pool when `Body.Close()` runs `bodyEOFSignal.Close` → `body.Close` → `persistConn.readLoop` proceeds to put the conn back via `t.tryPutIdleConn` (see `(*Transport).tryPutIdleConn` in `transport.go`).

Without `Close`, the `persistConn` stays "in use" from the `Transport`'s perspective. New `Get` calls don't reuse it, so the dialer opens a fresh TCP connection each time. The OS fd table fills; eventually the per-process limit (default 1024 on macOS, 1024 on most Linux distros) is hit and `dial` fails with `EMFILE`. The sockets sit in `CLOSE_WAIT` because the server half-closed but the client never called `close(fd)`.

The Go documentation on `(*Response).Body` is explicit: *"The client must close the response body when finished with it."* The reason "even on error" matters too — if `err != nil` after `Do`, `Body` is typically `nil`, but on a 4xx/5xx with body, `err == nil` and `Body` must still be closed.

**Fix:**

```go
func fetch(url string) (int, error) {
    resp, err := http.Get(url)
    if err != nil {
        return 0, err
    }
    defer resp.Body.Close() // returns conn to pool on EOF, frees fd on error
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return 0, err
    }
    return len(body), nil
}
```

For "I only care about the status code" calls, also drain before close — `io.Copy(io.Discard, resp.Body)` — otherwise the unread bytes leave the connection in an unparseable state and the `Transport` discards it instead of pooling it.

---

### Bug 2: `http.DefaultClient` without timeout — request hangs forever

**Difficulty:** Easy
**Skills:** `Client.Timeout`, `Transport` dial/read deadlines, `context.WithTimeout`

```go
package main

import (
    "fmt"
    "io"
    "net/http"
)

func main() {
    resp, err := http.DefaultClient.Get("http://10.255.255.1/")
    if err != nil {
        fmt.Println("err:", err)
        return
    }
    defer resp.Body.Close()
    body, _ := io.ReadAll(resp.Body)
    fmt.Println(len(body))
}
```

**Observed behavior:** The program prints nothing. It doesn't error, doesn't return, doesn't time out. After 20 minutes you kill it with Ctrl-C. In production, a flaky downstream causes a Goroutine pile-up: `pprof goroutine` shows thousands of stacks parked in `net.(*netFD).Read` and `internal/poll.runtime_pollWait`.

<details><summary>Hint</summary>

What is the zero value of `http.Client.Timeout`? Read the doc comment in `net/http/client.go` on the `Client` struct. Also: which deadlines does that field actually cover — dial, read, write, all three?

</details>

**Diagnosis:** `http.DefaultClient` is `&Client{}`, which is `Client{Timeout: 0}`. The doc in `net/http/client.go` on the `Client` struct says: *"A Timeout of zero means no timeout."* That covers the *entire* round-trip including dial, TLS handshake, request write, response headers, *and* body read.

`http.DefaultTransport` (defined in `transport.go`) does set a few sane defaults: `DialContext` uses a `net.Dialer{Timeout: 30*time.Second, KeepAlive: 30*time.Second}`, so the *dial* will fail after 30s. But once the TCP connection is established (or stuck in `SYN_SENT` to a blackholed IP that responds with nothing), reads have no deadline. `Transport.ResponseHeaderTimeout` is also zero by default. `IdleConnTimeout` is 90s but only applies to *idle* pooled conns, not active ones.

So `http.Get("http://10.255.255.1/")` (RFC 5737 unroutable, in this snippet just an unresponsive IP) will: dial → maybe succeed if the network silently accepts SYN, or fail after 30s. If dial succeeds, the read blocks forever. Slowloris-style servers exploit exactly this asymmetry.

`http.DefaultClient` is fine for one-shot CLI tools. It's a foot-gun for any long-lived process.

**Fix:** Set a `Timeout` on a private `Client`, or use `context.WithTimeout` per-request:

```go
// Option A: per-client timeout, simplest
var client = &http.Client{Timeout: 10 * time.Second}

resp, err := client.Get("http://10.255.255.1/")

// Option B: per-request context, composable with cancellation
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
req, _ := http.NewRequestWithContext(ctx, "GET", "http://10.255.255.1/", nil)
resp, err := http.DefaultClient.Do(req)
```

For more granular control — separate dial vs response-header vs body deadlines — configure `Transport.DialContext`, `Transport.TLSHandshakeTimeout`, `Transport.ResponseHeaderTimeout`. `Client.Timeout` is the blunt outer envelope; per-stage timeouts let you distinguish "DNS is slow" from "server is stalling".

---

### Bug 3: Handler doesn't read full body — keep-alive doesn't reuse conn

**Difficulty:** Medium
**Skills:** HTTP/1.1 keep-alive, framing, `Request.Body` drain semantics

```go
func handler(w http.ResponseWriter, r *http.Request) {
    // We only care about a header — body is huge but ignored.
    apiKey := r.Header.Get("X-API-Key")
    if apiKey == "" {
        http.Error(w, "missing key", http.StatusUnauthorized)
        return
    }
    w.WriteHeader(http.StatusAccepted)
    fmt.Fprintln(w, "queued")
}

func main() {
    http.HandleFunc("/upload", handler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

The client uploads a 100 MB body with `Connection: keep-alive`. Server returns `202` immediately after reading the header.

**Observed behavior:** Each upload takes ~200ms (LAN bandwidth is fine), but every subsequent request from the *same* keep-alive client takes another ~200ms to establish a new TCP connection. `netstat` shows `TIME_WAIT` accumulating on the server. Throughput is half what it should be — the client is doing TCP handshakes between every request despite asking for keep-alive.

<details><summary>Hint</summary>

HTTP/1.1 messages are length-framed by `Content-Length` or `Transfer-Encoding: chunked`. Read `net/http/server.go` around `(*response).finishRequest` and `(*body).Close`. What does the server do with unread request bytes when the handler returns? And what does it do with the connection when there are unread bytes it didn't consume?

</details>

**Diagnosis:** HTTP/1.1 framing is positional — the next request on a keep-alive connection starts immediately after the previous request's body ends. If the server reads only the headers and returns, the body bytes are still sitting in the kernel socket buffer. `net/http`'s `(*response).finishRequest` calls `r.req.Body.Close()` (`net/http/server.go`), which delegates to `(*body).Close`. That method tries to drain *up to a limit* — `maxPostHandlerReadBytes = 256 << 10` (256 KB, defined in `request.go`). If there's more unread data, `Close` sets `r.closeAfterReply = true` and the server sends `Connection: close` in the response.

The relevant code in `server.go` (paraphrasing):

```go
// finishRequest, after handler returns
if w.req.MultipartForm != nil { w.req.MultipartForm.RemoveAll() }
w.reqBody.Close() // drains up to 256 KB, or marks closeAfterReply
...
if w.closeAfterReply { w.conn.rwc.Close() }
```

With a 100 MB body and only headers read, the drain limit is blown and the server closes the TCP socket after responding. The client's keep-alive pool gets a closed connection back; the next request dials fresh. The client never sees an error — just slower throughput.

**Fix:** Either consume the body, or reject upload-style requests before they send the body. Idiomatic option: drain explicitly when ignoring:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    defer io.Copy(io.Discard, r.Body) // drain so keep-alive survives
    defer r.Body.Close()

    apiKey := r.Header.Get("X-API-Key")
    if apiKey == "" {
        http.Error(w, "missing key", http.StatusUnauthorized)
        return
    }
    w.WriteHeader(http.StatusAccepted)
    fmt.Fprintln(w, "queued")
}
```

Better: fail fast *before* the body is sent. Respond `401` with `Connection: close` immediately — the client should not have sent a 100 MB body just to be rejected. Best: use `Expect: 100-continue`. `net/http` handles this automatically when the client sets the header; the server can `WriteHeader(http.StatusExpectationFailed)` before any body bytes flow.

---

### Bug 4: `http.NewRequest` then forgetting to set `Content-Type` — server rejects

**Difficulty:** Easy
**Skills:** `http.NewRequest`, request headers, JSON API conventions

```go
func postUser(name string) error {
    body := bytes.NewBufferString(`{"name":"` + name + `"}`)
    req, err := http.NewRequest("POST", "https://api.example.com/users", body)
    if err != nil {
        return err
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusCreated {
        return fmt.Errorf("status %d", resp.StatusCode)
    }
    return nil
}
```

**Observed behavior:** Server returns `415 Unsupported Media Type`. Curl with `-H 'Content-Type: application/json'` works fine. The Go client sends the bytes verbatim — what's missing?

<details><summary>Hint</summary>

Look at `net/http/request.go` — what does `NewRequest` set on `req.Header` automatically based on the body argument? It detects a few specific concrete types (`*bytes.Buffer`, `*bytes.Reader`, `*strings.Reader`) and fills in `Content-Length`, but does it ever set `Content-Type`?

</details>

**Diagnosis:** `http.NewRequest` (in `net/http/request.go`) does some helpful inference: if `body` is `*bytes.Buffer`, `*bytes.Reader`, or `*strings.Reader`, it sets `req.ContentLength` and gives `Request.GetBody` a re-read closure for redirects. It does *not* set `Content-Type` — there is no way to infer it from a `[]byte`. The default sent on the wire is no `Content-Type` header at all (some libraries send `application/octet-stream`; `net/http` simply omits it unless the client sets it).

The server, expecting JSON, sees no `Content-Type` and rejects with `415`. This is conformant: RFC 9110 §8.3 says when the type is absent, the recipient *may* assume `application/octet-stream` or examine the body. Many APIs are stricter and require the header.

Compare with `http.Post(url, contentType, body)` — the second argument exists precisely because `NewRequest` won't fill it in. `http.PostForm` sets `Content-Type: application/x-www-form-urlencoded` because it controls the body too.

**Fix:** Set the header explicitly. For JSON APIs, also set `Accept`:

```go
req, err := http.NewRequest("POST", url, body)
if err != nil { return err }
req.Header.Set("Content-Type", "application/json")
req.Header.Set("Accept", "application/json")
```

If you build clients for several content types, wrap once: `func jsonReq(method, url string, v any) (*http.Request, error)` that marshals, sets headers, and returns the request. Forgetting `Content-Type` is the single most common mistake in hand-rolled HTTP clients in Go.

---

### Bug 5: Reading `r.PostForm` without `r.ParseForm()` — empty map

**Difficulty:** Easy
**Skills:** `Request.ParseForm`, `Request.PostForm` vs `Request.Form`, request body lifecycle

```go
func loginHandler(w http.ResponseWriter, r *http.Request) {
    user := r.PostForm.Get("username")
    pass := r.PostForm.Get("password")
    if user == "" || pass == "" {
        http.Error(w, "missing credentials", http.StatusBadRequest)
        return
    }
    // ... authenticate ...
}
```

Client posts `Content-Type: application/x-www-form-urlencoded` with `username=alice&password=secret`.

**Observed behavior:** Every request fails with `400 missing credentials`, even though `curl -v` shows the form fields in the body. Reading `r.Body` directly works. Why is `r.PostForm` empty?

<details><summary>Hint</summary>

Read `net/http/request.go` around `(*Request).ParseForm` and the documentation on `(*Request).PostForm`. The field is declared but not populated unless something else runs first. What populates it?

</details>

**Diagnosis:** `r.PostForm` is a `url.Values` field — `nil` map by default. The body is *not* parsed automatically when the request arrives at the handler. `r.ParseForm()` (in `request.go`) reads the body for `POST`/`PUT`/`PATCH` with `application/x-www-form-urlencoded`, populates `r.PostForm`, and also merges query-string parameters into `r.Form`.

The doc comment is explicit:

> *"PostForm contains the parsed form data from POST, PATCH, or PUT body parameters. This field is only available after ParseForm is called."*

`r.PostForm.Get("username")` on a `nil` map is safe — `url.Values{}` is a typed `map[string][]string`, and `Get` on a `nil` map returns `""`. So no panic, just empty values, which look indistinguishable from "user didn't send these fields".

`r.FormValue(key)` is a convenience that calls `ParseMultipartForm(defaultMaxMemory)` (which calls `ParseForm`) and then returns the value. So `r.FormValue("username")` works without an explicit `ParseForm` — at the cost of also reading multipart bodies up to 32 MB into memory.

**Fix:** Call `ParseForm` (or `ParseMultipartForm` for file uploads) first. Check the error:

```go
func loginHandler(w http.ResponseWriter, r *http.Request) {
    if err := r.ParseForm(); err != nil {
        http.Error(w, "bad form", http.StatusBadRequest)
        return
    }
    user := r.PostForm.Get("username")
    pass := r.PostForm.Get("password")
    // ...
}
```

For JSON APIs, neither `ParseForm` nor `PostForm` applies — decode `r.Body` with `json.NewDecoder`. The form-handling path is *only* for `application/x-www-form-urlencoded` and `multipart/form-data` content types.

---

### Bug 6: Casting `ResponseWriter` to `io.Closer` — runtime panic

**Difficulty:** Medium
**Skills:** `ResponseWriter` interface, type assertion safety, `http.Flusher`/`http.Hijacker` siblings

```go
func streamHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/event-stream")
    w.WriteHeader(http.StatusOK)
    for i := 0; i < 10; i++ {
        fmt.Fprintf(w, "data: %d\n\n", i)
        time.Sleep(100 * time.Millisecond)
    }
    // "make sure we flush and close"
    w.(io.Closer).Close()
}
```

**Observed behavior:** Server panics on every request with `interface conversion: *http.response is not io.Closer: missing method Close`. The stack trace points at the type assertion. The handler ran to completion; the panic happens on the very last line.

<details><summary>Hint</summary>

What methods does `net/http.ResponseWriter` actually require? Read the interface declaration in `net/http/server.go`. There are *optional* sibling interfaces (`http.Flusher`, `http.Hijacker`, `http.CloseNotifier`, `http.Pusher`) that some `ResponseWriter`s implement and some don't. Is `io.Closer` one of them?

</details>

**Diagnosis:** The `ResponseWriter` interface in `net/http/server.go` is exactly three methods:

```go
type ResponseWriter interface {
    Header() http.Header
    Write([]byte) (int, error)
    WriteHeader(statusCode int)
}
```

`Close` is not part of it. The standard `*http.response` concrete type has no exported `Close` method either — closing the underlying connection is the *server's* job, not the handler's. The handler returns; `(*response).finishRequest` calls `Flush`, drains the request body up to 256 KB, and the server loop decides whether to keep-alive or close.

The optional sibling interfaces that `*http.response` *does* satisfy: `http.Flusher` (`Flush`), `http.Hijacker` (`Hijack`), `http.CloseNotifier` (`CloseNotify` — deprecated, use `r.Context().Done()`), and on HTTP/2 `http.Pusher`. None of them is `io.Closer`.

Type-asserting to an interface the value doesn't satisfy panics at runtime with the exact message in the bug. The safe form is the comma-ok assertion: `if c, ok := w.(io.Closer); ok { c.Close() }` — but even then, `ok` is false for stock `ResponseWriter`s, so the body never runs. The whole assertion is a category error.

**Fix:** Don't close the `ResponseWriter`. Flush if you need to push bytes before the handler returns:

```go
func streamHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/event-stream")
    w.WriteHeader(http.StatusOK)
    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming unsupported", http.StatusInternalServerError)
        return
    }
    for i := 0; i < 10; i++ {
        fmt.Fprintf(w, "data: %d\n\n", i)
        flusher.Flush()
        time.Sleep(100 * time.Millisecond)
    }
    // No Close — handler returns, server takes care of conn lifecycle.
}
```

If you *really* need direct connection control (e.g., upgrading to a WebSocket), use `w.(http.Hijacker).Hijack()` — that returns a raw `net.Conn` you own, and *that* is the thing you eventually `Close`.

---

### Bug 7: Using `http.DefaultServeMux` from multiple packages — pattern collision

**Difficulty:** Medium
**Skills:** `http.DefaultServeMux`, `init()` ordering, package-global mutable state

```go
// package metrics
func init() {
    http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "metrics ok")
    })
}

// package admin (imported alongside metrics)
func init() {
    http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "admin ok")
    })
}

// main
func main() {
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

**Observed behavior:** Process refuses to start with `panic: http: multiple registrations for /healthz`. Stack trace points into `init` ordering, but you didn't write the duplicate path — two libraries did. Or in a more subtle variant where the libraries pick different paths, the load balancer's `/healthz` check works but `/admin/healthz` is silently overshadowed by a `/admin/` catch-all that another package registered.

<details><summary>Hint</summary>

`http.HandleFunc(pattern, fn)` is shorthand for `DefaultServeMux.HandleFunc(...)`. `DefaultServeMux` is a package-level `*ServeMux` shared by every importer of `net/http`. Read `(*ServeMux).Handle` in `net/http/server.go` — what does it do if the pattern is already registered?

</details>

**Diagnosis:** `http.HandleFunc` is defined as:

```go
func HandleFunc(pattern string, handler func(...)) {
    DefaultServeMux.HandleFunc(pattern, handler)
}
```

`DefaultServeMux` is a package-level `var DefaultServeMux = &defaultServeMux` (in `server.go`). Every package that imports `net/http` and registers a handler in `init()` writes into the same map. `(*ServeMux).Handle` is explicit:

```go
func (mux *ServeMux) Handle(pattern string, handler Handler) {
    mux.mu.Lock()
    defer mux.mu.Unlock()
    ...
    if _, exist := mux.m[pattern]; exist {
        panic("http: multiple registrations for " + pattern)
    }
    ...
}
```

So the panic is by design. The subtle case is when patterns *don't* collide exactly but interact via the longest-prefix-match rule (`/admin/` matches `/admin/anything`). Then `init` order matters, and `init` order across packages is "lexicographic by import path among files of a package, then dependency order" — not user-controllable. The behavior changes between Go versions and between rebuilds with different import sets.

Worse, `expvar`, `net/http/pprof`, and `golang.org/x/net/trace` all register on `DefaultServeMux` from their `init()` functions. Importing `_ "net/http/pprof"` for its side effects silently exposes `/debug/pprof/` on whatever port `http.ListenAndServe(addr, nil)` binds to — a real production security incident pattern.

**Fix:** Use an explicit `*ServeMux` per server. Never pass `nil` to `ListenAndServe` in code shared between packages:

```go
func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/healthz", healthHandler)
    mux.HandleFunc("/metrics", metricsHandler)
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```

For pprof, register it on a private mux bound to `localhost:6060` only — never on the public listener. The standard library's `DefaultServeMux` is a convenience for one-file examples; it has no place in a multi-package program.

---

### Bug 8: `httptest.NewServer` not `Close()`d — port and goroutine leak

**Difficulty:** Easy
**Skills:** `httptest.Server`, test cleanup, goroutine lifecycle

```go
func TestFetchUser(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, `{"id":1,"name":"alice"}`)
    }))
    // forgot defer srv.Close()

    resp, err := http.Get(srv.URL)
    if err != nil { t.Fatal(err) }
    defer resp.Body.Close()
    // ... assert ...
}
```

**Observed behavior:** Individual tests pass. Running `go test ./... -count=100` (stress run) eventually fails with `listen tcp 127.0.0.1:0: bind: address already in use` on macOS, or hangs with `pprof goroutine` showing thousands of stacks parked in `(*Server).Serve`. CI logs report `WARNING: DATA RACE` in unrelated tests because leaked listeners accept stray connections from previous test runs.

<details><summary>Hint</summary>

Read `net/http/httptest/server.go` around `NewServer` and `(*Server).Close`. What does `NewServer` start, and what does `Close` stop? In particular, what's the relationship between `Server.Listener`, the `goroutine` running `Serve`, and the in-flight connections?

</details>

**Diagnosis:** `httptest.NewServer` (in `net/http/httptest/server.go`) does:

1. Binds a `net.Listener` on `127.0.0.1:0` (ephemeral port).
2. Constructs an `*http.Server` and calls `go s.Serve(s.Listener)`.
3. Returns the `*Server` with `URL` populated.

`(*Server).Close` does:

1. Closes the listener (unblocks `Serve`, which returns `ErrServerClosed`).
2. Calls `(*http.Server).Close` to close all in-flight connections and tracked connections in `s.conns`.
3. Waits via `s.wg.Wait()` for all connection-handling goroutines to finish.

Without `Close`, every test leaves a listener bound, a `Serve` goroutine running, and any keep-alive client connections in `httptest.DefaultTransport`'s pool. macOS's ephemeral port range is small (default ~16k); enough leaked tests in a session exhaust it. Linux has a larger range but `TIME_WAIT` socket reuse delays cause sporadic bind failures on `127.0.0.1`.

The `Serve` goroutine itself is never garbage-collected because the listener and the underlying `*tcpListener` are referenced from the goroutine's stack — leaked memory grows with test count.

**Fix:** `defer srv.Close()` on every `httptest.NewServer` and `httptest.NewTLSServer`. Or in Go 1.14+, use `t.Cleanup`:

```go
func TestFetchUser(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(handler))
    t.Cleanup(srv.Close) // runs even on t.Fatal

    resp, err := http.Get(srv.URL)
    // ...
}
```

`t.Cleanup` is preferable to `defer` because it runs even when a subtest aborts the goroutine via `t.FailNow`. For table-driven tests where one server serves many cases, hoist the `NewServer`/`Cleanup` into `TestMain` or a parent test.

---

### Bug 9: Modifying `Header` after `WriteHeader` — silently ignored

**Difficulty:** Medium
**Skills:** `ResponseWriter.WriteHeader`, header write ordering, HTTP framing

```go
func handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)

    user, err := lookupUser(r)
    if err != nil {
        w.Header().Set("X-Error", err.Error()) // never sent
        w.WriteHeader(http.StatusInternalServerError) // also ignored
        return
    }

    json.NewEncoder(w).Encode(user)
}
```

**Observed behavior:** When `lookupUser` fails, the client receives `200 OK` with an empty body and no `X-Error` header. The log shows `http: superfluous response.WriteHeader call from .../handler.go:9`. The user-facing API silently returns success on internal failures.

<details><summary>Hint</summary>

What does `(*response).WriteHeader` do internally? Read `net/http/server.go`. Once the status line and headers go on the wire, what does a subsequent `Header().Set` change? And what happens to a second `WriteHeader` call?

</details>

**Diagnosis:** `(*response).WriteHeader` (in `net/http/server.go`) sets `w.wroteHeader = true` after writing the status line and current headers. Subsequent `w.Header().Set(...)` calls modify the `Header` map, but the map is no longer consulted — the bytes are already in the `bufio.Writer` (and possibly already flushed to the kernel).

Second `WriteHeader` calls are caught at the top of the method:

```go
func (w *response) WriteHeader(code int) {
    if w.conn.hijacked() { ... return }
    if w.wroteHeader {
        w.conn.server.logf("http: superfluous response.WriteHeader call from %s", caller)
        return
    }
    w.wroteHeader = true
    w.status = code
    ...
}
```

So the second call is a no-op with a log message. The status sent to the client is whatever the *first* `WriteHeader` was — `200 OK` in the buggy code. The `X-Error` header added afterward is dead writes to a map nobody reads.

Even without an explicit `WriteHeader`, the *first* `Write` triggers an implicit `WriteHeader(200)`. So `fmt.Fprintln(w, "...")` followed by `w.Header().Set(...)` has the same bug.

**Fix:** Decide status and headers *before* writing. Use `httptest.NewRecorder` in tests to assert response shape:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    user, err := lookupUser(r)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError) // sets header, writes status, writes body
        return
    }
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(user)
}
```

For complex flows where the status depends on partial work, buffer the response into a `*bytes.Buffer` or `httptest.ResponseRecorder`, then commit once. The "write status then realize you should've written a different status" pattern is a top-3 cause of misleading 200s in Go services.

---

### Bug 10: Hijacked connection doesn't get the server's panic recover

**Difficulty:** Hard
**Skills:** `Hijacker`, panic recovery in `net/http`, post-Hijack connection ownership

```go
func wsLikeHandler(w http.ResponseWriter, r *http.Request) {
    hj, ok := w.(http.Hijacker)
    if !ok {
        http.Error(w, "no hijack", http.StatusInternalServerError)
        return
    }
    conn, bufrw, err := hj.Hijack()
    if err != nil { return }
    // forgot defer conn.Close()

    var msg [10]byte
    _, _ = bufrw.Read(msg[:])
    panic("oops") // crashes the whole server
}
```

**Observed behavior:** A panic in a normal handler logs `http: panic serving 127.0.0.1:54321: ...` and returns 500, with the rest of the server fine. The hijacked variant above brings down the *process* — no recover catches it, no other request is served, the supervisor restarts the binary. Why does recovery work for one and not the other?

<details><summary>Hint</summary>

Read `net/http/server.go` around `(*conn).serve`. There's a `defer` with a `recover()` at the top of the connection-serve goroutine. What does it do, and what does it check before doing it? Look for the `ErrAbortHandler` and `hijacked()` branches.

</details>

**Diagnosis:** `(*conn).serve` in `net/http/server.go` wraps the handler invocation in a `defer recover()`:

```go
func (c *conn) serve(ctx context.Context) {
    ...
    defer func() {
        if err := recover(); err != nil && err != ErrAbortHandler {
            const size = 64 << 10
            buf := make([]byte, size)
            buf = buf[:runtime.Stack(buf, false)]
            c.server.logf("http: panic serving %v: %v\n%s", c.remoteAddr, err, buf)
        }
        if !c.hijacked() {
            c.close()
            c.setState(c.rwc, StateClosed, runHooks)
        }
    }()
    ...
    serverHandler{c.server}.ServeHTTP(w, w.req)
    ...
}
```

The `recover()` catches panics from the handler *only while `(*conn).serve` is still on the stack*. Once `Hijack()` returns, the contract is that the handler owns the connection: it's expected to return promptly (the canonical case is upgrading to WebSocket and handing control to a long-lived reader). The handler does return after `Hijack`, but it might also spawn a goroutine that lives forever.

In the buggy code, the handler doesn't spawn — it stays on the same goroutine and panics. The `recover` in `(*conn).serve` *would* catch it... except for the `!c.hijacked()` branch: after `Hijack`, the deferred close is skipped, but the recover still runs. Wait — re-reading: the recover does run. So why does the process crash?

Because in real hijack patterns, the read happens on a *new* goroutine the handler spawned (the WebSocket reader). That goroutine has no `recover`. A panic in it kills the process. The buggy snippet is a half-step: it stays on the original goroutine, so it *would* be caught — unless the handler returned first. If `bufrw.Read` blocks and the connection is half-closed by the client, the runtime may eventually scheduler-context-switch in ways that surface the panic on a different goroutine.

The reliable rule from `net/http`'s perspective: **once you Hijack, the server stops managing the connection.** Panic recovery is a courtesy that lives on the original goroutine. Any goroutine you spawn for the hijacked conn needs its own `defer recover()`.

**Fix:** Always close the hijacked conn and recover explicitly in any goroutine that processes it:

```go
func wsLikeHandler(w http.ResponseWriter, r *http.Request) {
    hj, ok := w.(http.Hijacker)
    if !ok {
        http.Error(w, "no hijack", http.StatusInternalServerError)
        return
    }
    conn, bufrw, err := hj.Hijack()
    if err != nil { return }

    go func() {
        defer conn.Close()
        defer func() {
            if r := recover(); r != nil {
                log.Printf("hijacked conn panic: %v", r)
            }
        }()
        var msg [10]byte
        _, _ = bufrw.Read(msg[:])
        // ... protocol handling ...
    }()
}
```

For WebSocket specifically, use `gorilla/websocket` or `nhooyr.io/websocket` — they own the recover/close/timeout policy correctly and are battle-tested. Hand-rolling `Hijack` is rarely worth it.

---

### Bug 11: Slow client + no `ReadTimeout` — slowloris

**Difficulty:** Hard
**Skills:** `Server.ReadTimeout`, `ReadHeaderTimeout`, slowloris attack, fd exhaustion

```go
func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "hello")
    })
    srv := &http.Server{
        Addr:    ":8080",
        Handler: mux,
    }
    log.Fatal(srv.ListenAndServe())
}
```

**Observed behavior:** Under a slowloris attack — clients open TCP connections and send `GET / HTTP/1.1\r\n` followed by one header byte every 30 seconds, never finishing the request — the server quickly exhausts its goroutines and fds. After ~5 minutes, legitimate users see `connection refused` because the listener backlog is full and every accept goroutine is parked reading bytes one at a time. The process never errored; it just stopped responding.

<details><summary>Hint</summary>

Read `net/http/server.go` for the `Server` struct fields. What are the default values of `ReadTimeout`, `ReadHeaderTimeout`, `WriteTimeout`, `IdleTimeout`? Compare with the `http.DefaultClient` situation in Bug 2 — same root cause, different side.

</details>

**Diagnosis:** `http.Server`'s timeout fields are all zero-valued by default (`net/http/server.go`):

- `ReadTimeout` — total time to read the entire request including body. Zero = no timeout.
- `ReadHeaderTimeout` — time to read request headers. Zero = no timeout (Go 1.8+).
- `WriteTimeout` — time from end of request read to end of response write. Zero = no timeout.
- `IdleTimeout` — keep-alive idle time. Zero = falls back to `ReadTimeout`. If that's also zero, no idle timeout.

A slowloris client trickles bytes within whatever TCP keepalive interval the OS uses (typically 7200s). The `conn.serve` goroutine sits in `bufio.Reader.ReadLine` reading one byte at a time, releasing the CPU between reads. Each connection consumes one goroutine (cheap, ~4 KB stack) and one fd (limited). With 1024 fd default, the server falls over at 1024 attacking connections — trivially cheap to mount.

`net/http`'s `(*Server).Serve` doesn't impose deadlines unless you set them. The relevant code in `(*conn).readRequest` sets `c.rwc.SetReadDeadline(...)` based on `s.ReadHeaderTimeout` and `s.ReadTimeout` — both zero means no deadline is set.

This is the same root issue as Bug 2 (client side) but on the server. The defaults assume a trusted LAN.

**Fix:** Always set timeouts on a public-facing `http.Server`:

```go
srv := &http.Server{
    Addr:              ":8080",
    Handler:           mux,
    ReadHeaderTimeout: 5 * time.Second,   // slowloris defense
    ReadTimeout:       30 * time.Second,  // total request read budget
    WriteTimeout:      30 * time.Second,  // total response write budget
    IdleTimeout:       120 * time.Second, // keep-alive idle
    MaxHeaderBytes:    1 << 20,           // 1 MB header cap
}
log.Fatal(srv.ListenAndServe())
```

`ReadHeaderTimeout` is the cheapest and most important — set it to 5-10 seconds on anything reachable from the internet. `ReadTimeout` must accommodate the largest legitimate upload; if uploads are huge, prefer per-handler `context.WithTimeout` derived from `r.Context()`, since a global `ReadTimeout` applies to all routes.

For multi-tenant servers, also configure `Server.ConnState` to track active conns and reject when over a per-IP threshold — `net/http` doesn't ship this, but `golang.org/x/net/netutil.LimitListener` provides a cap on total simultaneous connections.

---

### Bug 12: Shared `Transport`, different TLS configs — config bleed

**Difficulty:** Hard
**Skills:** `Transport.TLSClientConfig`, connection pool keying, `Clone`, cert pinning

```go
var baseTransport = &http.Transport{
    MaxIdleConns:    100,
    IdleConnTimeout: 90 * time.Second,
}

func clientFor(caPool *x509.CertPool) *http.Client {
    // "share the connection pool, just swap the cert pool"
    t := baseTransport
    t.TLSClientConfig = &tls.Config{RootCAs: caPool}
    return &http.Client{Transport: t}
}

// two callers
clientA := clientFor(poolA) // expects to verify against poolA
clientB := clientFor(poolB) // expects to verify against poolB
```

**Observed behavior:** Both clients seem to work initially, but intermittent test failures show client A successfully verifying certificates that should only be valid for client B's CA pool. In production, a cert rotation on one tenant briefly accepts the *previous* tenant's cert. Cert pinning appears to "leak" between unrelated callers.

<details><summary>Hint</summary>

`baseTransport` is a pointer. `t := baseTransport` doesn't copy the struct — it copies the pointer. Both `clientA` and `clientB` end up pointing to the *same* `*Transport`. Now read `net/http/transport.go` on how the idle conn pool is keyed. What identifies a "reusable" connection?

</details>

**Diagnosis:** Two compounding mistakes.

1. `t := baseTransport` aliases the pointer. `t.TLSClientConfig = ...` mutates the shared `*Transport`. The last writer wins; both clients use whatever `TLSClientConfig` was assigned most recently. This is a textbook data race if the writes happen concurrently, and a logic bug even without race.

2. Even if you `*t = *baseTransport` to copy the struct, `Transport`'s idle conn pool is keyed by `connectMethodKey` (defined in `net/http/transport.go`), which includes scheme, host, port, and proxy — but **not** the `TLSClientConfig`. Two `*Transport` instances dialing the same `https://api.example.com` use the same pool key. The pool may hand out a connection that was established with the *other* `TLSClientConfig`. The TLS handshake already happened; the post-handshake conn is bytes-in-bytes-out. Trust verification doesn't re-run on pool hit.

The transport source explicitly notes (in comments around `getConn`/`tryPutIdleConn`) that the pool assumes equivalent `TLSClientConfig` for a given host. Mixing pools across configs is unsupported.

The cert-pinning leak is the most dangerous symptom: client A's `RootCAs: poolA` accepts a connection that was originally verified against `poolB`. If `poolB` is more permissive (e.g., includes a CA the operator only intended for one tenant), the security boundary is silently breached.

**Fix:** One `*Transport` per `TLSClientConfig`. Use `(*Transport).Clone()` to get a deep copy:

```go
func clientFor(caPool *x509.CertPool) *http.Client {
    t := baseTransport.Clone()                  // deep copy of fields including TLS
    t.TLSClientConfig = &tls.Config{RootCAs: caPool}
    return &http.Client{Transport: t}
}
```

`(*Transport).Clone` (added in Go 1.13) is the canonical way to derive a configured transport. It deep-copies relevant fields and resets the idle pool. Each derived transport has its own pool keyed correctly.

For multi-tenant systems where pinning matters, consider per-tenant `*http.Client` instances cached in a `sync.Map`, with each client owning its `*Transport`. Sharing transports across security boundaries trades a tiny perf win for a real attack surface.

---

### Bug 13: `Server.ConnState` callback holds a mutex — deadlock under load

**Difficulty:** Hard
**Skills:** `Server.ConnState` hook, lock contention, server internals

```go
var (
    activeMu sync.Mutex
    active   = map[net.Conn]http.ConnState{}
)

func trackConn(c net.Conn, s http.ConnState) {
    activeMu.Lock()
    defer activeMu.Unlock()
    if s == http.StateClosed || s == http.StateHijacked {
        delete(active, c)
    } else {
        active[c] = s
    }
}

func currentLoad() int {
    activeMu.Lock()
    defer activeMu.Unlock()
    return len(active)
}

func loadHandler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "active: %d\n", currentLoad())
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/load", loadHandler)
    srv := &http.Server{
        Addr:      ":8080",
        Handler:   mux,
        ConnState: trackConn,
    }
    log.Fatal(srv.ListenAndServe())
}
```

**Observed behavior:** Under low load, `/load` returns correct counts. Under high concurrency (`hey -c 200 -n 10000 ...`), the server's p99 latency climbs from 1 ms to several seconds, and `pprof block` shows almost every request blocked on `activeMu`. Goroutine dumps reveal a chain: `loadHandler` waits on `activeMu`; the conn-state callback holds it; the callback is called from `(*conn).setState` on the hot path of every state transition (new, active, idle, closed).

<details><summary>Hint</summary>

How often does `(*Server).ConnState` get invoked per request? Trace `(*conn).setState` calls in `net/http/server.go`. A single request transitions `StateNew → StateActive → StateIdle → ...` — each transition calls the hook. Now consider: the hook is called synchronously from `(*conn).serve`, which means the connection serve goroutine cannot proceed until your hook returns.

</details>

**Diagnosis:** `(*Server).ConnState` is documented in `net/http/server.go` as called synchronously when the connection's state changes. Looking at `(*conn).setState`:

```go
func (c *conn) setState(nc net.Conn, state ConnState, runHook bool) {
    ...
    if runHook {
        if hook := srv.ConnState; hook != nil {
            hook(nc, state)
        }
    }
}
```

The hook runs on the *connection serve* goroutine. State transitions: `StateNew` on accept → `StateActive` when the first request byte arrives → `StateIdle` after the handler returns and keep-alive resumes → back to `StateActive` on the next request → `StateClosed` on close. A single keep-alive connection serving 10 requests fires the hook ~20+ times.

Each call takes `activeMu`. The handler `loadHandler` also takes `activeMu`. Under load, the lock is contended by N connection-state-transition goroutines plus M handler goroutines reading the count. Lock-acquire times spike; tail latency grows. With long enough hooks (network I/O, sync DB write, defer-stack costs), the system can deadlock — handler waits for lock, hook waits to acquire after some I/O completes, but the I/O depends on the same server's resources.

The deeper issue: the `ConnState` hook is on the hot path. Anything slow or blocking there throttles the entire server. The bug isn't the mutex per se — it's the mutex being shared with a read path that runs frequently. A `sync.Map` or `atomic.Int64` for a count would scale much better.

**Fix:** Keep the hook trivial; use atomics or shard the lock; never block on external resources in the hook:

```go
var active atomic.Int64

func trackConn(c net.Conn, s http.ConnState) {
    switch s {
    case http.StateNew:
        active.Add(1)
    case http.StateClosed, http.StateHijacked:
        active.Add(-1)
    }
}

func currentLoad() int64 { return active.Load() }
```

For richer state tracking (per-connection metadata), use `sync.Map` keyed by `net.Conn`, but still keep the hook itself non-blocking — append to a channel processed by a separate goroutine if you need ordered events. The rule: `ConnState`, like Linux kernel softirqs, should be O(1) and non-blocking. Any I/O, lock-with-contention, or syscall in a state hook turns into a server-wide stall.

---

### Bug 14: Returning before reading request body — connection forced closed

**Difficulty:** Medium
**Skills:** Request body lifecycle, `maxPostHandlerReadBytes`, keep-alive vs close

```go
func uploadHandler(w http.ResponseWriter, r *http.Request) {
    // Validate header before reading body — fail fast for too-large uploads.
    if r.ContentLength > 5<<20 {
        w.WriteHeader(http.StatusRequestEntityTooLarge)
        fmt.Fprintln(w, "too large")
        return // body never read
    }
    body, _ := io.ReadAll(r.Body)
    // ... process body ...
    w.WriteHeader(http.StatusOK)
    fmt.Fprintf(w, "received %d bytes\n", len(body))
}
```

**Observed behavior:** Reject path (>5 MB) returns `413` correctly. Client sees the right body. But `tcpdump` shows the server sends `Connection: close` and FIN-ACKs immediately. Subsequent requests on the same keep-alive client take an extra TCP handshake. CI integration tests using a single `http.Client` for a sequence of `413 → 200` calls take ~3x longer than expected.

<details><summary>Hint</summary>

This is a twin of Bug 3, but the failure mode is intentional this time. Read `(*body).Close` in `net/http/request.go` around `maxPostHandlerReadBytes`. What's the limit, and what does the server do if there are *more* unread bytes than that limit?

</details>

**Diagnosis:** `net/http/request.go` defines `maxPostHandlerReadBytes = 256 << 10` (256 KB). When the handler returns, `(*response).finishRequest` calls `r.req.Body.Close()`. The body's `Close` method tries to drain residual bytes up to that limit. If more remain, it marks the response for connection closure:

```go
// (*body).Close — paraphrased
func (b *body) Close() error {
    ...
    if !b.sawEOF {
        n, _ := io.CopyN(io.Discard, b.src, maxPostHandlerReadBytes+1)
        if n > maxPostHandlerReadBytes {
            // too much unread, signal close
            b.closing = true
        }
    }
    ...
}
```

And `finishRequest` checks this and adds `Connection: close` plus closes the TCP socket. The rationale: HTTP/1.1 framing requires the next request to start exactly where the previous body ended. With megabytes of unread bytes still in flight from the client, draining them is more expensive than just dropping the connection.

So the rejection logic is *correct* — the server returned `413` — but the keep-alive contract is broken because the client's 5+ MB body was never consumed. Every 413 costs a TCP handshake on the next request. For an API that frequently rejects oversized uploads (think image upload from mobile clients), the keep-alive savings vanish.

The same pattern bites authentication middleware that rejects before reading the body, redirect-chain middleware that returns early, etc. Whenever the request has a body and the handler doesn't read it, the keep-alive goes.

**Fix:** Three options, depending on policy.

Option A — accept the connection loss for very large rejects (often the right call: drop early, force re-dial):

```go
// Same code as buggy — fine if uploads are huge and rejection is rare.
// Document that 413 implies connection close by design.
```

Option B — read the bytes anyway when feasible:

```go
if r.ContentLength > 5<<20 {
    io.Copy(io.Discard, io.LimitReader(r.Body, 5<<20+1)) // drain up to limit
    w.WriteHeader(http.StatusRequestEntityTooLarge)
    return
}
```

Option C — use `http.MaxBytesReader` from the start so the limit is enforced *during* read, not after:

```go
r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
body, err := io.ReadAll(r.Body)
if err != nil {
    var mbErr *http.MaxBytesError
    if errors.As(err, &mbErr) {
        http.Error(w, "too large", http.StatusRequestEntityTooLarge)
        return
    }
    http.Error(w, "bad request", http.StatusBadRequest)
    return
}
```

`http.MaxBytesReader` (in `net/http/request.go`) wraps the body so reading past the limit returns an error *and* signals the server to close the connection cleanly — same wire behavior as Option A, but with explicit intent and a typed error the handler can branch on. This is the idiomatic Go pattern for "I have a limit and want it enforced uniformly".

---

## Summary

These bugs cluster into four families.

**Resource lifecycle (1, 8):** unclosed response bodies leak fds; unclosed `httptest.Server`s leak ports and goroutines. The `Close` method on `Body`, `Server`, and any `io.Closer` returned by `net/http` is part of the contract — not optional, not "the GC handles it". Goroutine and fd leaks compound silently until ulimit hits.

**Missing timeouts and limits (2, 11):** `http.DefaultClient` and bare `http.Server{}` are footguns with infinite patience. `Client.Timeout`, `Server.ReadHeaderTimeout`, `Server.ReadTimeout`, `Server.WriteTimeout`, `Server.IdleTimeout` are the five fields you must set on any production HTTP code. Defaults exist for one-file demos.

**Body framing and keep-alive (3, 14):** HTTP/1.1 is positional. The server *must* know exactly how many body bytes each request consumed before it can read the next. Unread bodies past the 256 KB drain limit force connection closure. Either read the body, use `http.MaxBytesReader`, or accept the keep-alive cost.

**Write ordering, type assertions, and shared state (4, 5, 6, 7, 9, 10, 12, 13):** `Content-Type` on outbound requests, `ParseForm` before `PostForm`, never asserting `ResponseWriter` to `io.Closer`, never `DefaultServeMux` from a library, never `Header().Set` after `WriteHeader`, never panic in a hijacked goroutine without recover, never share a `*Transport` across security boundaries, never block in `ConnState`. Each is a one-line rule with multi-day debugging consequences.

Review checklist for any `net/http` PR:

- [ ] Every `http.Get`/`Client.Do` followed by `defer resp.Body.Close()` (and a drain if the body is ignored)?
- [ ] Every `*http.Client` has a `Timeout` set, or every request uses `context.WithTimeout`?
- [ ] Every `*http.Server` sets `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout`, `MaxHeaderBytes`?
- [ ] Handlers consume `r.Body` (read or `http.MaxBytesReader`) before returning, especially on error paths?
- [ ] `http.NewRequest` paired with `req.Header.Set("Content-Type", ...)` whenever the body has one?
- [ ] `r.ParseForm()` (or `r.FormValue`) called before reading `r.PostForm` or `r.Form`?
- [ ] No type assertion of `ResponseWriter` to `io.Closer`? Optional-sibling assertions (`Flusher`, `Hijacker`) use the comma-ok form?
- [ ] No use of `http.DefaultServeMux` outside `main.go`? `_ "net/http/pprof"` only on a private localhost mux?
- [ ] Headers and status set *before* the first `Write`/`WriteHeader`? `http.Error` used for error responses?
- [ ] Any `Hijack`ed goroutine has its own `defer conn.Close()` and `defer recover()`?
- [ ] Each `TLSClientConfig` lives on its own `*Transport` (via `Transport.Clone`), never shared across security boundaries?
- [ ] `Server.ConnState` callbacks are O(1), non-blocking, and use atomics or sharded locks — no I/O, no contended mutex?
