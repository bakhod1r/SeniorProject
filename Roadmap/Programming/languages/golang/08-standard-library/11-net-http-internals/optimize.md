# 8.11 `net/http` Internals — Optimize

> **Audience.** Your service is correct but slow. This file covers
> the allocations, the syscalls, the connection pool, the buffer
> sizing, the parser cost, and the HTTP/2 trade-offs that move
> latency and throughput numbers. Profile first; the optimizations
> here have non-trivial complexity costs.

## 1. Profile before optimizing

```go
import _ "net/http/pprof"

go func() { http.ListenAndServe(":6060", nil) }()
```

Then:

```
go tool pprof -http=:8081 http://localhost:6060/debug/pprof/profile?seconds=30
go tool pprof -http=:8081 http://localhost:6060/debug/pprof/heap
go tool pprof -http=:8081 http://localhost:6060/debug/pprof/allocs
go tool pprof -http=:8081 http://localhost:6060/debug/pprof/goroutine
```

For HTTP-specific allocation hotspots, `pprof.allocs` (alloc_objects)
shows where allocations come from per request. If `bytes.NewBuffer`,
`Header.Add`, or `*url.URL` parsing are at the top, the optimizations
in this file are relevant.

For latency under load, `pprof.profile` plus `runtime/trace` for the
slow tail. `GODEBUG=gctrace=1` plus access logs lets you correlate GC
pauses with p99 latency spikes.

## 2. Allocation hotspots in handlers

Per request, the server allocates:

- `*Request` — one large struct.
- `Header` — at minimum 1 map allocation.
- `*Response` (the unexported writer) — one struct.
- A 4 KiB `bufio.Writer` per request.
- A 4 KiB `bufio.Reader` per conn (reused on keep-alive).

Your handler typically adds:

- `r.Body` reads — buffer per call.
- JSON decoding — slice growth.
- `fmt.Sprintf`, string concatenation — strings.
- `time.Now`, `time.Since` — heap escape if they cross a function
  boundary.
- Logging — formatted strings.

Reduce by:

1. **Don't `fmt.Sprintf` in hot paths.** Use `strconv.AppendInt`,
   `strconv.FormatInt`. For log lines, `slog` with structured fields
   is cheaper than format strings.
2. **Reuse buffers via `sync.Pool`.** For per-request scratch space,
   a pool keyed by buffer size. Be careful: a goroutine that returns
   a buffer with sensitive data leaks it to the next user — clear
   first.
3. **Stream bodies; don't materialize.** `json.NewEncoder(w).Encode`
   instead of `json.Marshal` + `w.Write`.
4. **Don't allocate per-request loggers.** Build one logger per
   handler at startup and pass through context if needed.

## 3. Connection pooling — the right defaults under load

```go
transport := &http.Transport{
    MaxIdleConns:          1000,
    MaxIdleConnsPerHost:   100,
    IdleConnTimeout:       90 * time.Second,
    TLSHandshakeTimeout:   10 * time.Second,
    ExpectContinueTimeout: 1 * time.Second,
    DialContext: (&net.Dialer{
        Timeout:   5 * time.Second,
        KeepAlive: 30 * time.Second,
    }).DialContext,
    ForceAttemptHTTP2: true,
}
```

The single field that yields the biggest difference for
service-to-service traffic: `MaxIdleConnsPerHost: 100` (default 2).

Math: with 1000 RPS to one backend and average request duration of
50ms, you need ~50 conns in flight. Default `MaxIdleConnsPerHost: 2`
means 48 conns per second open, request, close — re-paying handshake.
With 100 idle, the steady state is 50 in-flight + 50 idle = no churn.

For HTTP/2, only one conn is needed (multiplexing). HTTP/2 makes the
per-host pool size mostly irrelevant; what matters is the
`MaxConcurrentStreams` setting on the conn.

## 4. Bypass `Header` map allocation when you know the keys

`Header.Set` allocates if the canonical key isn't already in the
map. For high-RPS handlers writing the same header set every time:

```go
// Pre-canonicalize once at startup:
const ctJSON = "Content-Type"
var jsonValue = []string{"application/json"}

// In handler (avoids the canonicalize-and-allocate):
w.Header()[ctJSON] = jsonValue
```

This is uglier and skirts the public API. Profile first; the
`Header.Set` overhead is rarely the top cost.

## 5. Use `httptest.NewRecorder` carefully in benchmarks

```go
func BenchmarkHandler(b *testing.B) {
    req := httptest.NewRequest("GET", "/", nil)
    for i := 0; i < b.N; i++ {
        rec := httptest.NewRecorder()
        handler.ServeHTTP(rec, req)
    }
}
```

`NewRecorder` is faster than spinning up `httptest.NewServer`, but
the `httptest.ResponseRecorder` has different allocation behavior
than the real server. For accurate numbers on the data plane, use
`NewServer` plus a real client and measure both.

For unit-level allocation counts:

```go
func BenchmarkHandler(b *testing.B) {
    b.ReportAllocs()
    req := httptest.NewRequest("GET", "/", nil)
    rec := httptest.NewRecorder()
    for i := 0; i < b.N; i++ {
        rec.Body.Reset()
        handler.ServeHTTP(rec, req)
    }
}
```

`b.ReportAllocs()` is essential — it reports allocs/op separately
from time/op, which is the harder number to move.

## 6. JSON: `Decoder` vs `Unmarshal`

For request bodies:

```go
// Streaming (preferred): no full-body allocation.
err := json.NewDecoder(r.Body).Decode(&v)

// Whole-body (worse): allocates a []byte the size of the body.
data, _ := io.ReadAll(r.Body)
err := json.Unmarshal(data, &v)
```

For response bodies:

```go
// Streaming (preferred):
json.NewEncoder(w).Encode(v)

// Whole-body (worse): allocates the JSON in memory before writing.
data, _ := json.Marshal(v)
w.Write(data)
```

The encoder appends a `\n` after the encoded value (chunked-style).
For most APIs that's fine. For strict format compatibility, use
`json.Marshal` followed by `w.Write`.

For very high throughput with stable payload schemas, consider
`encoding/json/v2` (Go 1.25+ proposal) or `github.com/goccy/go-json`
or `easyjson` (codegen). Each has trade-offs; stdlib is the safest
default.

## 7. Buffer pool for ReverseProxy

`httputil.ReverseProxy` allocates a 32 KiB buffer per request when
copying. For high-RPS proxies, that's a lot of GC pressure. Provide
a `BufferPool`:

```go
type bufPool struct{ p sync.Pool }

func (b *bufPool) Get() []byte  { return *b.p.Get().(*[]byte) }
func (b *bufPool) Put(buf []byte) { b.p.Put(&buf) }

proxy := &httputil.ReverseProxy{
    BufferPool: &bufPool{p: sync.Pool{New: func() any {
        b := make([]byte, 32*1024)
        return &b
    }}},
    Rewrite: ...,
}
```

The `*[]byte` indirection avoids the slice-header alloc when `Get`
returns `any`.

## 8. Avoid building strings for headers

```go
// BAD: allocates a new string per call.
w.Header().Set("X-Trace-Id", fmt.Sprintf("%d-%s", time.Now().Unix(), id))

// BETTER: reuse a buffer from a pool, or use strconv.AppendInt + concat.
var b strings.Builder
b.Grow(32)
b.WriteString(strconv.FormatInt(time.Now().Unix(), 10))
b.WriteByte('-')
b.WriteString(id)
w.Header().Set("X-Trace-Id", b.String())
```

In hot paths, the difference adds up. Use `pprof.allocs` to verify.

## 9. HTTP/2 on the server: tune `MaxConcurrentStreams`

The default HTTP/2 server limits 250 concurrent streams per conn:

```go
import "golang.org/x/net/http2"

http2.ConfigureServer(srv, &http2.Server{
    MaxConcurrentStreams: 1000,
    MaxReadFrameSize:     1 << 20,
})
```

For internal RPC-style services (one client, many concurrent calls),
raise this. For public APIs, leave the default.

`MaxReadFrameSize` defaults to 1 MiB. Larger values allow the
peer to send larger frames — more bytes per syscall, less CPU.
Trade-off: larger memory usage per stream.

## 10. Disable transparent gzip if you don't want it

```go
transport.DisableCompression = true
```

`http.Transport` adds `Accept-Encoding: gzip` and decompresses
responses transparently. The decompression has CPU cost; if your
upstream sends already-compressed payloads (images, video, parquet),
this is wasted work. Disable it.

For the server side, `net/http` does *not* compress responses
automatically — you handle that yourself or via a middleware
(`github.com/golang/gddo/httputil/header` and similar).

## 11. `io.Copy` from `*tls.Conn` to `*os.File` — cost path

When proxying file downloads, `io.Copy(file, resp.Body)` runs through
a 32 KiB user-space buffer because TLS prevents `sendfile`. There's
no zero-copy path for TLS in stdlib.

What you can do:

- Use a larger `io.CopyBuffer` size (1 MiB) to amortize syscall
  overhead.
- For non-TLS, `io.Copy(file, conn)` may use `sendfile` if both sides
  are real fds. The stdlib runtime handles this on Linux when the
  source is a `*net.TCPConn` and the dest is a `*os.File`.

## 12. Pre-canonicalize URLs

`url.Parse` is not free — it allocates the `*URL` struct, parses
query, builds host. For a hot path that builds requests to the same
URL with only varying paths, parse once and reuse:

```go
base, _ := url.Parse("https://api.example.com")

func makeURL(path string) *url.URL {
    u := *base
    u.Path = path
    return &u
}
```

The `u := *base` copies the struct; mutating `u.Path` doesn't affect
the original.

## 13. `bufio` sizes for big bodies

The default `bufio.Reader` is 4 KiB. For request bodies sent with
chunked encoding or large POSTs, the parser does many small reads.

Inside the server, `Server.ReadBufferSize` (Go 1.21+) lets you tune
the per-conn reader buffer. Bigger buffer = fewer syscalls per
request, more memory per idle conn. Default is 4 KiB; 16 KiB is a
common pick.

```go
srv := &http.Server{
    ReadBufferSize:  16 << 10,
    WriteBufferSize: 16 << 10,
}
```

For a service that handles many small requests on each conn, 4 KiB is
fine. For a service that receives big bodies, 16+ KiB pays off in
fewer syscalls.

## 14. Request reuse via `sync.Pool` (server-side)

For services that build a small per-request "context object" with
the same shape every time:

```go
var reqCtxPool = sync.Pool{
    New: func() any { return &reqContext{} },
}

type reqContext struct {
    user *User
    role string
    // ... small fields ...
}

func (r *reqContext) reset() {
    r.user = nil
    r.role = ""
}

func handler(w http.ResponseWriter, r *http.Request) {
    rc := reqCtxPool.Get().(*reqContext)
    defer func() {
        rc.reset()
        reqCtxPool.Put(rc)
    }()
    // populate and use rc...
}
```

Trade-off: pooled objects can't be used after the handler returns
(or the next user gets a polluted view). Don't put a pooled object
into a context that survives the handler.

## 15. Pre-warmed conn pool

For low-latency services where the first request must be fast,
pre-warm the pool at startup:

```go
func warmPool(client *http.Client, url string, n int) {
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            req, _ := http.NewRequest("OPTIONS", url, nil)
            resp, err := client.Do(req)
            if err == nil {
                io.Copy(io.Discard, resp.Body)
                resp.Body.Close()
            }
        }()
    }
    wg.Wait()
}
```

After warming, `MaxIdleConnsPerHost` conns sit ready in the pool. The
first real request skips dial + TLS.

The trick: the pre-warm can't open more conns than your idle limit
permits. If `MaxIdleConnsPerHost: 100`, fire 100 concurrent OPTIONS;
they all open conns and return them to the pool.

## 16. HTTP/2 vs HTTP/1.1 for backend traffic

For high-RPS service-to-service traffic, HTTP/2 has better tail
latency:

- One conn instead of N — TLS handshake amortized.
- Multiplexed streams — no head-of-line blocking from a slow request.
- Smaller header sizes (HPACK).

Caveats:

- Bug: a single conn means one `goroutine` reads it; very large
  responses on one stream can starve other streams. Tune
  `MaxConcurrentStreams` and consider falling back to HTTP/1.1 for
  truly large transfers.
- HTTP/2 over TLS only (in stdlib). For h2c (cleartext), use
  `golang.org/x/net/http2/h2c`.

For high-RPS public-facing traffic, HTTP/1.1 with keepalive is often
simpler and "good enough" — the latency wins of HTTP/2 are smaller
once a CDN is in front.

## 17. Reduce per-request locking in middleware

A common middleware pattern uses a global rate-limit map:

```go
var (
    mu      sync.Mutex
    counts  = map[string]int{}
)

func rateLimit(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ip := r.RemoteAddr
        mu.Lock()
        counts[ip]++
        n := counts[ip]
        mu.Unlock()
        if n > 100 { http.Error(w, "rate limit", 429); return }
        next.ServeHTTP(w, r)
    })
}
```

Under load, every request takes the mutex. Throughput tops out
around 1M lock/unlock per second per CPU.

Better: shard the map (16 shards keyed by hash mod 16), or use
`sync.Map`, or use atomic counters per IP keyed by a fixed-size
`sync.Map`. For real rate limiting, use a token-bucket library
backed by atomics.

## 18. Reduce TLS handshake cost

TLS 1.3 handshake is one round-trip vs TLS 1.2's two. Make sure your
server allows TLS 1.3:

```go
tlsCfg := &tls.Config{
    MinVersion: tls.VersionTLS12,
    MaxVersion: tls.VersionTLS13,
    // ...
}
```

For session resumption, set `ClientSessionCache` on the client side
and `SessionTicketsDisabled: false` on the server side. With session
resumption, repeat handshakes complete in ~0.5 RTT.

Pin the cipher suite list to ones with hardware-accelerated AES-GCM:

```go
tlsCfg.CipherSuites = []uint16{
    tls.TLS_AES_128_GCM_SHA256,
    tls.TLS_AES_256_GCM_SHA384,
    tls.TLS_CHACHA20_POLY1305_SHA256,
}
```

(For TLS 1.3, cipher suites can't be configured; the list above is
ignored. For TLS 1.2 fallback, it matters.)

## 19. Keep `Server.MaxHeaderBytes` tight

```go
srv.MaxHeaderBytes = 16 << 10 // 16 KiB
```

Default is 1 MiB. Lowering it has two effects:

1. Faster failure on malicious clients sending huge headers.
2. Smaller per-request peak memory (the parser allocates a buffer
   of this size if needed).

For typical APIs, 16 KiB is plenty. Cookies and Authorization headers
are the things that grow; if your app has very large cookies, raise
the cap.

## 20. Avoid `http.Error` in hot paths

`http.Error` does several things: sets `Content-Type`, sets
`X-Content-Type-Options: nosniff`, calls `WriteHeader`, writes the
message + a newline. For high-RPS error paths (auth rejections,
rate limits), this is more work than necessary.

For pre-allocated error responses:

```go
var (
    errAuth = []byte(`{"error":"unauthorized"}` + "\n")
)

func unauthorizedJSON(w http.ResponseWriter) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusUnauthorized)
    w.Write(errAuth)
}
```

The `[]byte` is a global; no per-call allocation.

## 21. Use `Server.ReadHeaderTimeout` instead of per-handler deadlines

A handler that does `c.SetReadDeadline` per-request via
`ResponseController` is more flexible but has overhead — each call is
a syscall (`SetReadDeadline`). For services where every request has
the same timeout, set `ReadHeaderTimeout` on the server and skip
per-handler deadlines.

## 22. Connection-level metrics: use `ConnState` not middleware

A middleware that increments a counter per request runs once per
*request*. A `ConnState` callback runs once per *conn-state-change*.
For "active conns" gauges, `ConnState` is cheaper:

```go
var openConns int64
srv.ConnState = func(c net.Conn, state http.ConnState) {
    switch state {
    case http.StateNew:    atomic.AddInt64(&openConns, 1)
    case http.StateClosed: atomic.AddInt64(&openConns, -1)
    }
}
```

For "requests in flight", a middleware is required (since `ConnState`
fires on conn changes, not request changes).

## 23. Avoid context leaks via cancel functions

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
    defer cancel()
    // ...
}
```

`context.WithTimeout` registers a timer with the runtime. Without
`defer cancel()`, the timer leaks until it fires. Under load, this
adds up — your timer wheel grows, GC pressure rises.

Always pair `WithTimeout` / `WithCancel` with `defer cancel()`. The
`govet` checker catches missing `cancel()` calls.

## 24. Final checklist for "fast HTTP"

- [ ] One shared `*http.Client` and `*http.Transport` per program.
- [ ] `MaxIdleConnsPerHost` raised for hot backends.
- [ ] `*http.Server` with `ReadBufferSize`/`WriteBufferSize` tuned.
- [ ] Pre-allocated error responses (no `http.Error` per request).
- [ ] `BufferPool` set on `httputil.ReverseProxy`.
- [ ] JSON via `Decoder`/`Encoder`, not `Unmarshal`/`Marshal`.
- [ ] No `fmt.Sprintf` in hot paths.
- [ ] `pprof.allocs` checked under sustained load.
- [ ] HTTP/2 enabled where it helps; disabled where it doesn't.
- [ ] TLS session resumption enabled.
- [ ] No `cancel()` leaks in handlers.
- [ ] Metrics emitted via `ConnState` for conn gauges.
- [ ] Path labels in metrics use route templates, not raw URLs.
- [ ] `pprof` endpoint behind admin auth.
- [ ] Load test that holds 10k RPS for 30 minutes without GC pause
      regressions.

## 25. Cross-references

- [`../10-net/optimize.md`](../10-net/optimize.md) — socket-layer
  optimizations underlying every HTTP optimization here.
- [`../03-time/`](../03-time/junior.md) — timer-wheel cost behind context
  deadlines and server timeouts.
- [`../04-encoding-json/`](../04-encoding-json/junior.md) — JSON-specific
  optimizations beyond `Decoder`/`Encoder`.
- [`../13-crypto/`](../13-crypto/junior.md) — TLS handshake cost,
  session resumption, cipher suites.
- [senior.md](senior.md), [professional.md](professional.md) — the
  contracts and patterns these optimizations build on.
