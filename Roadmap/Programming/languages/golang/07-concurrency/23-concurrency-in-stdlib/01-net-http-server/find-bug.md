---
layout: default
title: net/http Server Concurrency — Find the Bug
parent: net/http Server Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/01-net-http-server/find-bug/
---

# net/http Server Concurrency — Find the Bug

[← Back](../)

> Each snippet contains a real concurrency bug. Find it, explain it, fix it.

---

## Bug 1 — Background goroutine writing to ResponseWriter

```go
func handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/plain")
    w.WriteHeader(http.StatusOK)
    go func() {
        time.Sleep(time.Second)
        w.Write([]byte("hello from background\n"))
    }()
    w.Write([]byte("hello from handler\n"))
}
```

**Bug.** Two goroutines write to `w` concurrently. Even worse, the background goroutine runs after `ServeHTTP` returns — the server may have already closed the connection. The race detector flags this; in production you'll see corrupt responses or panics inside `bufio.Writer`.

**Fix.** Don't spawn at all if you can avoid it. If the data really must come from a goroutine, use a channel and have the handler write:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/plain")
    w.WriteHeader(http.StatusOK)
    w.Write([]byte("hello from handler\n"))

    ch := make(chan []byte, 1)
    go func() {
        time.Sleep(time.Second)
        ch <- []byte("hello after delay\n")
    }()
    select {
    case b := <-ch:
        w.Write(b)
    case <-r.Context().Done():
        return
    }
}
```

---

## Bug 2 — Missing context propagation on upstream call

```go
func proxy(w http.ResponseWriter, r *http.Request) {
    resp, err := http.Get("https://slow-upstream.example.com/data")
    if err != nil {
        http.Error(w, err.Error(), 502)
        return
    }
    defer resp.Body.Close()
    io.Copy(w, resp.Body)
}
```

**Bug.** `http.Get` uses `context.Background()` — it doesn't observe `r.Context()`. If the client disconnects, the upstream call keeps running. Goroutine leak + wasted upstream resources.

**Fix.** Use `http.NewRequestWithContext`:

```go
func proxy(w http.ResponseWriter, r *http.Request) {
    req, err := http.NewRequestWithContext(r.Context(), "GET", "https://slow-upstream.example.com/data", nil)
    if err != nil { http.Error(w, err.Error(), 500); return }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { http.Error(w, err.Error(), 502); return }
    defer resp.Body.Close()
    io.Copy(w, resp.Body)
}
```

Now upstream cancels when the client disconnects.

---

## Bug 3 — Leaking goroutine via unbuffered channel

```go
func handler(w http.ResponseWriter, r *http.Request) {
    result := make(chan string) // unbuffered
    go func() {
        result <- computeExpensive() // blocks forever if no one reads
    }()
    select {
    case s := <-result:
        w.Write([]byte(s))
    case <-r.Context().Done():
        return // goroutine still blocked sending
    }
}
```

**Bug.** If the client disconnects (`ctx.Done()` fires) before `computeExpensive` finishes, the handler returns but the inner goroutine is still blocked trying to send on the unbuffered channel. Permanent leak.

**Fix.** Use a buffered channel of size 1 so the producer never blocks:

```go
result := make(chan string, 1)
```

Now the producer can send freely; if no one reads, the goroutine still exits.

---

## Bug 4 — Time-based race in graceful shutdown

```go
func main() {
    srv := &http.Server{Addr: ":8080", Handler: ...}
    go srv.ListenAndServe()
    
    time.Sleep(time.Minute) // run for a minute
    srv.Shutdown(context.Background())
    // exit
}
```

**Bug.** `Shutdown(context.Background())` has no deadline; if any handler hangs forever, the program never exits. Also, the `ListenAndServe` error is discarded.

**Fix.** Add a deadline and capture the listen error:

```go
errCh := make(chan error, 1)
go func() { errCh <- srv.ListenAndServe() }()

<-signalCh // SIGINT etc.
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
if err := srv.Shutdown(ctx); err != nil {
    log.Printf("shutdown: %v", err)
    srv.Close() // force close
}
if err := <-errCh; err != http.ErrServerClosed {
    log.Fatal(err)
}
```

---

## Bug 5 — Reading body after handler returns

```go
func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        body, _ := io.ReadAll(r.Body)
        log.Printf("body: %s", body)
    }()
    w.Write([]byte("ok"))
}
```

**Bug.** The handler returns immediately, releasing `r.Body` for the server to clean up. The background goroutine then reads from a body the server may have already closed/reused. Race, possibly silent corruption.

**Fix.** Read the body *before* returning, then process asynchronously:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    body, err := io.ReadAll(r.Body)
    if err != nil { http.Error(w, err.Error(), 400); return }
    go func() {
        log.Printf("body: %s", body) // own copy
    }()
    w.Write([]byte("ok"))
}
```

Note: even now, the goroutine outlives the handler — it doesn't observe `r.Context()`. If you want cancellation, propagate ctx too.

---

## Bug 6 — Storing the request for later use

```go
type pendingStore struct {
    mu       sync.Mutex
    requests []*http.Request
}

func (s *pendingStore) handler(w http.ResponseWriter, r *http.Request) {
    s.mu.Lock()
    s.requests = append(s.requests, r)
    s.mu.Unlock()
    w.Write([]byte("queued"))
}

func (s *pendingStore) processLater() {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, r := range s.requests {
        body, _ := io.ReadAll(r.Body) // BUG
        // ...
    }
}
```

**Bug.** After the handler returns, the server closes/reuses `r.Body`. `processLater` reads from a body that's gone. Worse: `r.Context()` is already cancelled.

**Fix.** Extract everything you need *inside* the handler, store the copy:

```go
type pendingItem struct {
    method string
    url    string
    body   []byte
    header http.Header
}

func (s *pendingStore) handler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    item := &pendingItem{
        method: r.Method, url: r.URL.String(),
        body: body, header: r.Header.Clone(),
    }
    s.mu.Lock()
    s.items = append(s.items, item)
    s.mu.Unlock()
    w.Write([]byte("queued"))
}
```

---

## Bug 7 — Shared map written from handlers

```go
var counts = map[string]int{}

func handler(w http.ResponseWriter, r *http.Request) {
    counts[r.URL.Path]++ // BUG
    fmt.Fprintf(w, "%d", counts[r.URL.Path])
}
```

**Bug.** Many handler goroutines write the same map concurrently. `-race` flags it; in production you get either a corrupt count or a runtime crash ("concurrent map writes").

**Fix.** Use `sync.Map` for sparse keys, or `sync.RWMutex` + plain map, or `expvar.Map`:

```go
var counts sync.Map

func handler(w http.ResponseWriter, r *http.Request) {
    // load-or-store an *atomic.Int64
    v, _ := counts.LoadOrStore(r.URL.Path, new(atomic.Int64))
    n := v.(*atomic.Int64).Add(1)
    fmt.Fprintf(w, "%d", n)
}
```

For dense keys, `sync.RWMutex` + `map[string]int` is fine and often faster than `sync.Map`.

---

## Bug 8 — Shared bufio.Writer across handlers

```go
var sharedLogBuf = bufio.NewWriter(os.Stdout)

func handler(w http.ResponseWriter, r *http.Request) {
    sharedLogBuf.WriteString("hit: " + r.URL.Path + "\n") // BUG
    sharedLogBuf.Flush()
    w.Write([]byte("ok"))
}
```

**Bug.** `bufio.Writer` is not safe for concurrent use. Two handlers calling `WriteString` simultaneously corrupt the buffer.

**Fix.** Wrap in `sync.Mutex`, or use `log.Logger` (internally locked), or `os.Stdout.Write` directly (POSIX writes ≤ PIPE_BUF are atomic-ish, but not guaranteed).

```go
var logMu sync.Mutex

func handler(w http.ResponseWriter, r *http.Request) {
    logMu.Lock()
    sharedLogBuf.WriteString("hit: " + r.URL.Path + "\n")
    sharedLogBuf.Flush()
    logMu.Unlock()
    w.Write([]byte("ok"))
}
```

Or simpler — use the standard `log` package which is internally safe:

```go
log.Printf("hit: %s", r.URL.Path)
```

---

## Bug 9 — Calling WriteHeader twice

```go
func handler(w http.ResponseWriter, r *http.Request) {
    if r.URL.Path == "/foo" {
        w.WriteHeader(200)
    }
    // do something
    if someError {
        w.WriteHeader(500) // BUG when /foo path AND error
        return
    }
    w.Write([]byte("ok"))
}
```

**Bug.** `WriteHeader` may be called at most once. The second call logs a warning and is ignored. In a multi-handler middleware chain this is a common bug; you'll send a 200 even though you tried to send 500.

**Fix.** Track whether the header has been written, or use a wrapping writer that exposes `.Wrote()`:

```go
type statusRecorder struct {
    http.ResponseWriter
    wrote bool
    code  int
}

func (sr *statusRecorder) WriteHeader(code int) {
    if sr.wrote { return }
    sr.wrote = true
    sr.code = code
    sr.ResponseWriter.WriteHeader(code)
}
```

Use the recorder in middleware so you can detect double-writes.

---

## Bug 10 — Holding a mutex across w.Write

```go
type cache struct {
    mu   sync.Mutex
    data map[string][]byte
}

func (c *cache) handler(w http.ResponseWriter, r *http.Request) {
    c.mu.Lock()
    defer c.mu.Unlock()
    b, ok := c.data[r.URL.Path]
    if !ok { http.NotFound(w, r); return }
    w.Write(b) // BUG: write under the mutex
}
```

**Bug.** `w.Write` may block on the slow client (especially without `WriteTimeout`). While it blocks, every other handler that wants this mutex is also blocked. One slow client → entire server stalls.

**Fix.** Copy out the byte slice under the mutex, then write outside:

```go
c.mu.Lock()
b, ok := c.data[r.URL.Path]
c.mu.Unlock()
if !ok { http.NotFound(w, r); return }
w.Write(b)
```

If the cache stores mutable bytes, copy under the lock too:

```go
c.mu.Lock()
b, ok := c.data[r.URL.Path]
var copyB []byte
if ok {
    copyB = make([]byte, len(b))
    copy(copyB, b)
}
c.mu.Unlock()
if !ok { ... }
w.Write(copyB)
```

This is the "minimize critical section" rule.

---

## Bug 11 — Hijack without Close

```go
func handler(w http.ResponseWriter, r *http.Request) {
    h, ok := w.(http.Hijacker)
    if !ok { return }
    conn, _, err := h.Hijack()
    if err != nil { return }
    
    go echo(conn) // BUG: handler exits without closing conn
}

func echo(c net.Conn) {
    io.Copy(c, c) // returns on error
    // BUG: doesn't close c
}
```

**Bug.** After `Hijack()`, you own the conn. The handler returns without closing it. The goroutine `echo` also doesn't close. The conn is leaked (and the server can't touch it anymore).

**Fix.** Always defer `conn.Close()` in the goroutine that owns the conn:

```go
go func() {
    defer conn.Close()
    echo(conn)
}()
```

---

## Bug 12 — Atomic increment with non-atomic read

```go
var requests int64

func handler(w http.ResponseWriter, r *http.Request) {
    atomic.AddInt64(&requests, 1)
    // ...
    fmt.Fprintf(w, "request #%d", requests) // BUG: plain read
}
```

**Bug.** The increment is atomic; the read is not. On most architectures the read tears or misses recent writes from other goroutines. The race detector catches it.

**Fix.** Read atomically too:

```go
n := atomic.AddInt64(&requests, 1)
fmt.Fprintf(w, "request #%d", n)
```

Or use the typed `atomic.Int64`:

```go
var requests atomic.Int64

func handler(w http.ResponseWriter, r *http.Request) {
    n := requests.Add(1)
    fmt.Fprintf(w, "request #%d", n)
}
```

---
