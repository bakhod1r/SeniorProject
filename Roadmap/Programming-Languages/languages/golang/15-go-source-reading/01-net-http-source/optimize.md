# net/http — Optimization

## 1. How to use this file

Fourteen scenarios where `net/http` code allocates more, blocks longer, or wastes connections versus what the stdlib actually offers. Each entry has a **Before** (code + benchmark) and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT).

Anchored at Go 1.23, amd64, loopback. Numbers are reproducible-shape — run `go test -bench=. -benchmem` on your hardware before quoting them. `net/http` cost is dominated by four things: per-request connection setup, per-request allocations (buffers, headers, request IDs), unread response bodies blocking keep-alive, and synchronous timeouts that aren't actually set. Most wins remove one of those four from the hot path. Reading order: Ex. 1, 3, 10, 12 (the connection-reuse cluster), then Ex. 4, 5, 8 (the allocation cluster), then any order. Ex. 1, 12, 13 are the ones most senior reviews flag.

---

## 2. Exercise 1 — Per-request `http.Client` allocation

A worker calls a downstream API in a loop, building a fresh `http.Client{}` per call. Each client gets its own `Transport`, so every request opens a new TCP+TLS connection. Connection pooling never engages.

```go
func fetch(url string) ([]byte, error) {
    client := &http.Client{Timeout: 5 * time.Second}
    resp, err := client.Get(url)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

```
BenchmarkPerRequestClient-8   200   6800000 ns/op   42000 B/op   180 allocs/op  // localhost TLS
```

<details><summary>After</summary>

One package-level client, shared. `http.Client` and its `Transport` are safe for concurrent use; the `Transport` is what holds the idle-connection pool.

```go
var httpClient = &http.Client{Timeout: 5 * time.Second}

func fetch(url string) ([]byte, error) {
    resp, err := httpClient.Get(url)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

```
BenchmarkSharedClient-8   12000   95000 ns/op   8400 B/op   42 allocs/op
```

~70× faster, ~4× less garbage.

**Why faster:** Each new `Client` carries a fresh `Transport`, and `Transport` is where the keep-alive pool lives. Sharing the client means request 2+ reuses an idle TCP connection — no `connect()`, no TLS handshake, no new goroutine for `readLoop`/`writeLoop`. The per-request cost drops from "open a socket" to "pull a `persistConn` off a free list."
**Trade-off:** A buggy long-lived `Transport` (leaked goroutines, stuck `persistConn`s) now affects every caller. One bad host can starve the per-host pool. Mitigate with `MaxIdleConnsPerHost` and `IdleConnTimeout` (see Ex. 3, 9).
**When NOT:** One-shot CLIs that exit after one request — the savings vanish. Tests where you want isolation between cases. Code calling many unrelated hosts where pool sizing tuned for one host hurts another.
</details>

---

## 3. Exercise 2 — `io.ReadAll(resp.Body)` for every response

A proxy reads every upstream response fully into memory before forwarding. Even 200 MB responses get buffered before a single byte goes to the downstream writer.

```go
func proxy(w http.ResponseWriter, upstream *http.Response) error {
    body, err := io.ReadAll(upstream.Body)
    if err != nil { return err }
    w.WriteHeader(upstream.StatusCode)
    _, err = w.Write(body)
    return err
}
```

```
BenchmarkReadAllProxy-8   3   430000000 ns/op   210000000 B/op   28 allocs/op  // 200 MB body
```

<details><summary>After</summary>

Stream with `io.Copy`. The `bufio`-backed response body and the `ResponseWriter` already buffer — there's no reason to materialize the full payload.

```go
func proxy(w http.ResponseWriter, upstream *http.Response) error {
    w.WriteHeader(upstream.StatusCode)
    _, err := io.Copy(w, upstream.Body)
    return err
}
```

```
BenchmarkCopyProxy-8   28   42000000 ns/op   32768 B/op   3 allocs/op
```

~10× faster, ~6400× less memory.

**Why faster:** `io.ReadAll` grows a `[]byte` with append — multiple `growslice` realloc/copy cycles, each capped by `MaxInt` but practically OOM-limited. `io.Copy` uses a 32 KB internal buffer and pumps it; peak memory stays bounded regardless of body size. Bytes hit the wire as they arrive, so client-perceived latency drops too.
**Trade-off:** You can't retry mid-stream — partial bytes already left the writer. Mid-stream errors from upstream are visible only as truncated responses downstream. Logging response size requires a `countingWriter` wrapper instead of `len(body)`.
**When NOT:** You need the full body for signing/verification before forwarding. The body is small enough (< 64 KB) that `io.ReadAll` fits in one allocation. You're parsing JSON — `json.NewDecoder` already streams; see Ex. 4.
</details>

---

## 4. Exercise 3 — Default `MaxIdleConnsPerHost = 2`

A service fans out to one downstream API at high concurrency. The default `Transport` caps idle connections **per host** at 2, so the 3rd+ concurrent request closes its connection after use. The next request re-handshakes.

```go
var httpClient = &http.Client{Timeout: 5 * time.Second} // default Transport: MaxIdleConnsPerHost=2
```

```
BenchmarkDefaultPool-8   3000   400000 ns/op   18000 B/op   95 allocs/op  // 100 concurrent
```

<details><summary>After</summary>

Set `MaxIdleConnsPerHost` to match your concurrency. `MaxConnsPerHost` caps the absolute ceiling; leave it 0 (unlimited) unless you're protecting the upstream.

```go
var httpClient = &http.Client{
    Timeout: 5 * time.Second,
    Transport: &http.Transport{
        MaxIdleConns:        200,
        MaxIdleConnsPerHost: 100,
        IdleConnTimeout:     90 * time.Second,
        ForceAttemptHTTP2:   true,
    },
}
```

```
BenchmarkTunedPool-8   45000   25000 ns/op   3200 B/op   18 allocs/op
```

~16× faster.

**Why faster:** With the default cap of 2, concurrent requests beyond that close their TCP after returning to the pool — `putIdleConn` calls `c.close()` because the slot is full. New requests pay the full handshake. Raising the cap lets `getConn` find an idle connection instead of dialing.
**Trade-off:** Each idle connection holds a file descriptor and ~16 KB of buffers. 100 idle conns × 10 hosts = 1000 FDs you must size `ulimit` for. `IdleConnTimeout` of 90 s means the server's idle timeout must be ≥ that, or you'll race a server-side close. Some load balancers (older AWS NLBs) silently drop idle conns at 350 s — set lower if affected.
**When NOT:** Calling many unrelated hosts at low concurrency — wastes FDs. Calling APIs behind aggressive idle-killers (some serverless gateways close at 5 s) — set `IdleConnTimeout` shorter. Calling HTTP/2 servers where one connection multiplexes many streams; tune `MaxConcurrentStreams` server-side instead.
</details>

---

## 5. Exercise 4 — `json.Marshal` then `Write`

An API handler marshals a response struct into a `[]byte`, then writes it. The intermediate slice is allocated, populated, and immediately discarded.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    resp := buildResponse(r)
    data, err := json.Marshal(resp)
    if err != nil { http.Error(w, err.Error(), 500); return }
    w.Header().Set("Content-Type", "application/json")
    w.Write(data)
}
```

```
BenchmarkMarshalThenWrite-8   200000   7200 ns/op   2400 B/op   18 allocs/op  // 5 KB JSON
```

<details><summary>After</summary>

`json.NewEncoder(w).Encode(resp)` writes directly to `w` using a small internal buffer. No full-payload intermediate slice.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    resp := buildResponse(r)
    w.Header().Set("Content-Type", "application/json")
    if err := json.NewEncoder(w).Encode(resp); err != nil {
        // headers already sent; log and bail
        log.Printf("encode: %v", err)
    }
}
```

```
BenchmarkEncoderDirect-8   330000   4400 ns/op   720 B/op   8 allocs/op
```

~1.6× faster, ~3× less garbage.

**Why faster:** `json.Marshal` calls `json.MarshalAppend(nil, v)`, growing a `bytes.Buffer` to hold the full payload, then copies into the response. `Encoder` streams into the writer with a reusable 4 KB scratch buffer. Allocs drop because no big `[]byte` materializes.
**Trade-off:** `Encoder.Encode` appends a trailing newline (often desired, sometimes not — strip if your contract forbids it). Headers must be set before the first `Encode` call (which calls `Write`, locking in the status). Errors mid-encode mean a half-written body with a 200 already sent — log, don't retry.
**When NOT:** You need the marshaled bytes for signing (webhook payloads, JWT). You're caching the result — marshal once, write many. Very small responses (< 256 B) where the intermediate slice fits in one alloc and the encoder's setup cost dominates.
</details>

---

## 6. Exercise 5 — `bytes.Buffer` per request to slurp the body

A handler reads the request body into a fresh `bytes.Buffer` per call to compute a hash before parsing. Every request allocates a fresh 4 KB buffer that grows by `append`.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    var buf bytes.Buffer
    if _, err := io.Copy(&buf, r.Body); err != nil { http.Error(w, err.Error(), 400); return }
    sum := sha256.Sum256(buf.Bytes())
    process(buf.Bytes(), sum)
}
```

```
BenchmarkBufferPerReq-8   40000   34000 ns/op   8200 B/op   6 allocs/op  // 4 KB body
```

<details><summary>After</summary>

`sync.Pool` of `*bytes.Buffer`. Reset and return to the pool on the way out.

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func handler(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    if _, err := io.Copy(buf, r.Body); err != nil { http.Error(w, err.Error(), 400); return }
    sum := sha256.Sum256(buf.Bytes())
    process(buf.Bytes(), sum)
}
```

```
BenchmarkPooledBuffer-8   140000   8400 ns/op   320 B/op   1 allocs/op
```

~4× faster, ~25× less garbage.

**Why faster:** Pooled buffers retain their backing array between uses. The first few requests grow buffers to typical body size; subsequent requests skip `growslice`. Allocation count drops to 1 (the `sha256` `[32]byte`).
**Trade-off:** A request with a 10 MB body grows a buffer to 10 MB, then returns it to the pool — now every borrower carries that capacity. Defend by checking `cap(buf.Bytes())` and discarding oversized buffers before `Put`. `sync.Pool` items can be GC'd between uses, so the pool is a hint, not a guarantee.
**When NOT:** Bodies are streamed directly to disk/upstream (don't materialize at all — see Ex. 2). Bodies vary wildly in size — pool churn from oversized-buffer rejections defeats the win. Hot path that processes < 1k req/s where the 8 KB/op is invisible.
</details>

---

## 7. Exercise 6 — `strings.Contains` routing

A handler dispatches by inspecting `r.URL.Path` with `strings.Contains` / `HasPrefix`. Every request walks the conditional chain; adding routes is O(routes).

```go
func handler(w http.ResponseWriter, r *http.Request) {
    switch {
    case strings.HasPrefix(r.URL.Path, "/api/v1/users/"):
        handleUsers(w, r)
    case strings.HasPrefix(r.URL.Path, "/api/v1/orders/"):
        handleOrders(w, r)
    case strings.Contains(r.URL.Path, "/health"):
        handleHealth(w, r)
    default:
        http.NotFound(w, r)
    }
}
```

```
BenchmarkStringContainsRoute-8   1500000   780 ns/op   96 B/op   2 allocs/op
```

<details><summary>After</summary>

Go 1.22+ `ServeMux` patterns: method-aware, path-parametric, exact-match-first.

```go
mux := http.NewServeMux()
mux.HandleFunc("GET /api/v1/users/{id}", handleUser)
mux.HandleFunc("POST /api/v1/users", createUser)
mux.HandleFunc("GET /api/v1/orders/{id}", handleOrder)
mux.HandleFunc("GET /health", handleHealth)
http.ListenAndServe(":8080", mux)

func handleUser(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")
    // ...
}
```

```
BenchmarkServeMuxRoute-8   4000000   290 ns/op   48 B/op   1 allocs/op
```

~2.7× faster, half the garbage.

**Why faster:** `ServeMux` builds a trie of patterns at registration time; lookup is O(path-segments), not O(routes). Method matching is integrated — no separate `if r.Method != "GET"` per handler. Manual `strings.HasPrefix` chains also miss method mismatches (returning 200 + wrong body on a wrong-method request).
**Trade-off:** Locks you to stdlib patterns — no regex routes, no per-route middleware shortcut without a wrapper. Path-parameter parsing happens even when the handler doesn't use it. Pattern conflicts (overlapping routes) error at `Handle`-time — fail fast, but means you must register in a tested order.
**When NOT:** Single-route services (a webhook receiver). Routes computed dynamically at runtime from config (use a third-party router with `Add(pattern)`). Pre-1.22 codebase you can't upgrade — the method matcher backports won't be there.
</details>

---

## 8. Exercise 7 — Headers set via map literal

A client request builder constructs headers as a `map[string][]string` literal, then assigns to `req.Header`. The literal allocates a map and 1-element slices per key; `req.Header` may already be a usable empty map.

```go
func send(url, token, traceID string) (*http.Response, error) {
    req, _ := http.NewRequest("POST", url, nil)
    req.Header = http.Header{
        "Authorization": {"Bearer " + token},
        "X-Trace-Id":    {traceID},
        "Content-Type":  {"application/json"},
        "Accept":        {"application/json"},
    }
    return httpClient.Do(req)
}
```

```
BenchmarkHeaderLiteral-8   500000   2900 ns/op   720 B/op   12 allocs/op
```

<details><summary>After</summary>

Use `Set`/`Add` on the already-allocated `req.Header`. `Set` canonicalizes the key via `textproto.CanonicalMIMEHeaderKey` once; literals skip canonicalization, breaking case-insensitive lookups silently.

```go
func send(url, token, traceID string) (*http.Response, error) {
    req, _ := http.NewRequest("POST", url, nil)
    h := req.Header
    h.Set("Authorization", "Bearer "+token)
    h.Set("X-Trace-Id", traceID)
    h.Set("Content-Type", "application/json")
    h.Set("Accept", "application/json")
    return httpClient.Do(req)
}
```

```
BenchmarkHeaderSet-8   900000   1600 ns/op   320 B/op   5 allocs/op
```

~1.8× faster, ~2× less garbage. Also: case-correct.

**Why faster:** Literal `http.Header{...}` allocates a brand-new map (replacing the one `NewRequest` already created) and one `[]string` per key. `Set` reuses the existing map, growing it inline; values stored at canonical keys hit the lookup fast path. Allocation count drops because the per-key slice is amortized inside the map's value array.
**Trade-off:** `Set` overwrites; `Add` appends. Mixing them on the same key is a bug source. Multi-valued headers (`Set-Cookie`, `Vary`) need `Add`. Canonicalization changes `x-trace-id` → `X-Trace-Id` — fine for HTTP but surprises stringly-typed downstream code.
**When NOT:** Building a header set once at startup that you immediately copy onto every request (literal + `for k,v := range h { req.Header[k] = v }` is the same cost). Code paths where < 100 req/s makes 2 μs invisible.
</details>

---

## 9. Exercise 8 — `bufio.NewReader(body)` per call

A handler wraps `r.Body` in `bufio.NewReader` per request to do line-by-line parsing. The 4 KB default buffer allocates every time.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    br := bufio.NewReader(r.Body)
    for {
        line, err := br.ReadString('\n')
        if errors.Is(err, io.EOF) { break }
        if err != nil { http.Error(w, err.Error(), 400); return }
        processLine(line)
    }
}
```

```
BenchmarkBufioPerReq-8   60000   22000 ns/op   4400 B/op   3 allocs/op
```

<details><summary>After</summary>

Pool the `*bufio.Reader`. `Reset(io.Reader)` rebinds the underlying source without reallocating the buffer.

```go
var brPool = sync.Pool{
    New: func() any { return bufio.NewReaderSize(nil, 4096) },
}

func handler(w http.ResponseWriter, r *http.Request) {
    br := brPool.Get().(*bufio.Reader)
    br.Reset(r.Body)
    defer brPool.Put(br)

    for {
        line, err := br.ReadString('\n')
        if errors.Is(err, io.EOF) { break }
        if err != nil { http.Error(w, err.Error(), 400); return }
        processLine(line)
    }
}
```

```
BenchmarkPooledBufio-8   210000   6300 ns/op   48 B/op   1 allocs/op
```

~3.5× faster, ~90× less garbage.

**Why faster:** `bufio.NewReader` allocates a 4 KB `[]byte` and a `bufio.Reader` struct. Pooling reuses both. `Reset` only updates the source pointer and zeroes the cursor — no buffer realloc.
**Trade-off:** `bufio.Reader` carries unread bytes between uses if you forget to drain to EOF before `Put` — the next borrower sees stale data. Defend with `br.Reset(nil)` before `Put`, or always read to EOF/error. Pool churn under load with bursts isn't free; profile.
**When NOT:** You're using a `bufio` indirectly via `Scanner` — pool the `Scanner` instead (and re-`Buffer()` it). Bodies that fit in one `Read` — skip buffering entirely. Test code where allocation noise doesn't matter.
</details>

---

## 10. Exercise 9 — Default `IdleTimeout = 0`

A server uses `http.Server{}` with no `IdleTimeout`. Idle keep-alive connections live forever from the server's side, but clients (or their middleboxes) close them at unpredictable times. Worse: with `ReadTimeout` also 0, a half-open connection from a vanished client never closes.

```go
srv := &http.Server{
    Addr:    ":8080",
    Handler: mux,
    // no timeouts set
}
srv.ListenAndServe()
```

```
BenchmarkNoIdleTimeout-8   18000   65000 ns/op   2400 B/op   24 allocs/op  // with periodic reconnects
```

<details><summary>After</summary>

Set `IdleTimeout` to match the keep-alive policy you want. 90 s pairs well with most clients' 90 s `Transport.IdleConnTimeout`.

```go
srv := &http.Server{
    Addr:              ":8080",
    Handler:           mux,
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       30 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       90 * time.Second,
}
srv.ListenAndServe()
```

```
BenchmarkIdleTimeout90s-8   45000   24000 ns/op   1100 B/op   12 allocs/op
```

~2.7× faster on a keep-alive-heavy workload.

**Why faster:** With `IdleTimeout` set, the server holds connections open between requests instead of relying on the OS / client to time them out. Clients reuse the TCP+TLS context; the server skips the handshake too. The `state` callback fires on idle transitions, letting the server proactively close idle conns instead of carrying zombies.
**Trade-off:** Setting it too low (5 s) kills keep-alive — clients reconnect constantly. Setting it too high (10 min) starves FDs on memory-poor servers. Coordinate with load balancer / proxy idle timeouts: NLB defaults to 350 s, ALB to 60 s. Mismatch causes 502s on reused-but-closed connections.
**When NOT:** Internal-only services behind a service mesh that handles keep-alive at the proxy layer (set server `IdleTimeout` short, let the mesh hold the pool). One-shot servers (CLI `go test -httptest`) — defaults are fine.
</details>

---

## 11. Exercise 10 — TLS handshake per request

A client calls `https://api.example.com` but uses a fresh `*http.Client` each call (compounding Ex. 1). Every call does a full TLS 1.3 handshake — ~30 ms RTT on a typical link, dominated by certificate verification.

```go
func fetch(url string) ([]byte, error) {
    client := &http.Client{} // fresh Transport — no session reuse
    resp, err := client.Get(url)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

```
BenchmarkTLSPerReq-8   60   18000000 ns/op   95000 B/op   320 allocs/op  // real network
```

<details><summary>After</summary>

Shared client + tuned `Transport`. With keep-alive, only the first request pays the handshake; subsequent requests reuse the TLS session over the same TCP. Even on cold connections, `Transport.TLSClientConfig.ClientSessionCache` lets resumption kick in.

```go
var httpClient = &http.Client{
    Timeout: 10 * time.Second,
    Transport: &http.Transport{
        MaxIdleConnsPerHost: 100,
        IdleConnTimeout:     90 * time.Second,
        TLSClientConfig: &tls.Config{
            ClientSessionCache: tls.NewLRUClientSessionCache(64),
        },
        ForceAttemptHTTP2: true,
    },
}
```

```
BenchmarkTLSReused-8   18000   62000 ns/op   2800 B/op   18 allocs/op
```

~290× faster on warm connections.

**Why faster:** TLS handshake is two RTTs in TLS 1.2, one in TLS 1.3 — plus a CPU spike for ECDHE + certificate chain validation (~5 ms on common hardware). Keep-alive skips the whole thing for request 2+. `ClientSessionCache` reuses session tickets across reconnects, dropping cold-start to a 0-RTT handshake.
**Trade-off:** Shared sessions across goroutines is fine, but `ClientSessionCache` size of 64 means high-churn workloads still miss. Pinning HTTP/2 with `ForceAttemptHTTP2` means one TCP per host multiplexes — but a stuck stream blocks the connection. Some servers send `Connection: close` periodically — your pool will leak slots until cleanup.
**When NOT:** You're calling a unique host every time (web crawler) — keep-alive doesn't help and the cache fills with one-shot sessions. mTLS environments where session resumption is disabled for compliance. Tests where you want isolated TLS state per case.
</details>

---

## 12. Exercise 11 — `httputil.DumpRequest` on the hot path

A logging middleware uses `httputil.DumpRequest(r, true)` to print every request. The body is read into memory, replaced with a fresh reader, and the whole thing is formatted via `fmt`.

```go
func loggingMiddleware(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        dump, err := httputil.DumpRequest(r, true)
        if err == nil { log.Printf("req:\n%s", dump) }
        h.ServeHTTP(w, r)
    })
}
```

```
BenchmarkDumpRequest-8   8000   165000 ns/op   18000 B/op   85 allocs/op
```

<details><summary>After</summary>

Structured logging with explicit fields. No body buffering, no full-request formatting; capture only what a debugger needs.

```go
func loggingMiddleware(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        sw := &statusWriter{ResponseWriter: w, status: 200}
        h.ServeHTTP(sw, r)
        slog.Info("http",
            "method", r.Method,
            "path", r.URL.Path,
            "status", sw.status,
            "bytes", sw.written,
            "dur_ms", time.Since(start).Milliseconds(),
            "remote", r.RemoteAddr,
        )
    })
}

type statusWriter struct {
    http.ResponseWriter
    status, written int
}
func (s *statusWriter) WriteHeader(c int) { s.status = c; s.ResponseWriter.WriteHeader(c) }
func (s *statusWriter) Write(b []byte) (int, error) { n, e := s.ResponseWriter.Write(b); s.written += n; return n, e }
```

```
BenchmarkStructuredLog-8   180000   6800 ns/op   480 B/op   8 allocs/op
```

~24× faster, ~37× less garbage.

**Why faster:** `DumpRequest(r, true)` reads `r.Body` into a buffer, then constructs a fresh `*Request` to format, allocating a `bytes.Buffer` that grows with body size. Body length 100 KB ⇒ 100 KB of formatting work per request. Structured logging extracts six fields directly from request/response state.
**Trade-off:** Lose the verbatim wire-format dump. Bring it back behind a debug flag (`if debug { dump, _ := httputil.DumpRequest(r, true) }`). Body inspection now requires sampling middleware or a separate trace mechanism. `statusWriter` doesn't implement `http.Flusher`/`Hijacker` — wrap as needed for SSE/WebSocket handlers.
**When NOT:** Low-volume debug servers where 165 μs/req is invisible and the dump is the point. Compliance audit trails that legally need the full wire format — pay the cost, but route to a separate async writer. Test fixtures where the dump is asserted against.
</details>

---

## 13. Exercise 12 — `defer resp.Body.Close()` without draining

A client reads `resp.Body` into JSON via `Decode`, then returns on the first parse error. The body is closed but not drained; the underlying connection cannot return to the keep-alive pool.

```go
func fetch(url string) (*Payload, error) {
    resp, err := httpClient.Get(url)
    if err != nil { return nil, err }
    defer resp.Body.Close()

    var p Payload
    if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
        return nil, err // body still has trailing bytes; connection killed
    }
    return &p, nil
}
```

```
BenchmarkNoDrain-8   3000   380000 ns/op   24000 B/op   140 allocs/op  // reconnects often
```

<details><summary>After</summary>

Drain after Decode (or on error). `io.Copy(io.Discard, resp.Body)` pulls any trailing bytes (chunked terminators, whitespace, extra JSON in error responses) so the `persistConn` can be returned.

```go
func fetch(url string) (*Payload, error) {
    resp, err := httpClient.Get(url)
    if err != nil { return nil, err }
    defer func() {
        io.Copy(io.Discard, resp.Body)
        resp.Body.Close()
    }()

    var p Payload
    if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
        return nil, err
    }
    return &p, nil
}
```

```
BenchmarkDrained-8   42000   28000 ns/op   2400 B/op   18 allocs/op
```

~13× faster on a keep-alive workload.

**Why faster:** `Transport.tryPutIdleConn` requires the body to be fully consumed before reusing the connection. An undrained body forces the transport to close the underlying TCP — every subsequent request re-handshakes. Draining is cheap (the body is usually small at this point); reconnects are not.
**Trade-off:** Draining a body that's actually huge (10 MB error page) wastes bandwidth. Cap with `io.CopyN(io.Discard, resp.Body, 64*1024)` if you're worried — if there's more left, the connection isn't worth saving anyway. Forgetting to close (deferring `Close` after early return) is still a leak — drain ≠ close.
**When NOT:** Streaming downloads where you `io.Copy` to disk — body's already drained. Servers known not to support keep-alive (rare). One-shot connections where the next request is far enough away that the idle conn would close anyway.
</details>

---

## 14. Exercise 13 — `ReadHeaderTimeout = 0`

A public-facing server runs with no `ReadHeaderTimeout`. A slowloris-style attacker opens 10k connections and sends headers one byte per minute. Each connection holds a goroutine + buffer until the OS closes the socket.

```go
srv := &http.Server{
    Addr:    ":8080",
    Handler: mux,
    // ReadHeaderTimeout: 0 — wait forever
}
srv.ListenAndServe()
```

```
BenchmarkSlowloris-8   1   8400000000 ns/op   240000000 B/op   42000 allocs/op  // simulated attack
```

<details><summary>After</summary>

Set `ReadHeaderTimeout` to a small value (5 s is generous for real clients, hostile for attackers). This is independent of `ReadTimeout` — headers are bounded even if the body legitimately needs longer.

```go
srv := &http.Server{
    Addr:              ":8080",
    Handler:           mux,
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       30 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       90 * time.Second,
    MaxHeaderBytes:    1 << 20, // 1 MiB
}
srv.ListenAndServe()
```

```
BenchmarkSlowlorisBlocked-8   2000   620000 ns/op   2400 B/op   18 allocs/op  // attackers timed out
```

~13500× lower attack throughput; legitimate traffic unaffected.

**Why faster (and safer):** With no `ReadHeaderTimeout`, the server's accept loop hands each connection to a goroutine that blocks on `Read` until the client finishes headers. Slowloris exploits this — 10k cheap connections eat 10k goroutines + their stacks. Setting the timeout closes incomplete header reads in 5 s; the goroutine dies, the connection releases, and the next legitimate request gets the slot. Go 1.20 made this independent of `ReadTimeout` precisely so streaming-upload servers could bound headers tightly without bounding the body.
**Trade-off:** Mobile clients on weak networks may legitimately need > 5 s to upload headers under packet loss. Bump to 10–15 s if you serve users on 2G/3G. Behind a TLS-terminating proxy (nginx, ALB) you may double-set timeouts — pick one layer as authoritative. `MaxHeaderBytes` defaults to 1 MB; cap it tighter if you know your protocol.
**When NOT:** Internal services on trusted networks behind a firewall + load balancer that already bounds headers — adding it doesn't hurt but isn't load-bearing. Long-poll endpoints where the client legitimately holds the connection open before sending — but those should send headers fast, then wait; `ReadHeaderTimeout` still applies cleanly.
</details>

---

## 15. Exercise 14 — `time.Now()` per request for ID

A middleware generates a request ID via `time.Now().UnixNano()`. Under high concurrency, `time.Now()` is cheap (~20 ns on Linux) but allocates a `time.Time` on some paths, and collisions are possible if two requests hit the same nanosecond on different cores.

```go
func requestIDMiddleware(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := strconv.FormatInt(time.Now().UnixNano(), 10)
        ctx := context.WithValue(r.Context(), "reqID", id)
        h.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

```
BenchmarkTimeNowID-8   1500000   780 ns/op   88 B/op   3 allocs/op
```

<details><summary>After</summary>

Atomic counter for monotonic IDs; collision-free and faster than `time.Now()`. If you need globally unique IDs across instances, pre-generate UUIDs in batches and pop from a ring buffer.

```go
var reqCounter atomic.Uint64

func requestIDMiddleware(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        n := reqCounter.Add(1)
        id := strconv.FormatUint(n, 36) // base36: shorter, still URL-safe
        ctx := context.WithValue(r.Context(), reqIDKey{}, id)
        h.ServeHTTP(w, r.WithContext(ctx))
    })
}

type reqIDKey struct{}
```

```
BenchmarkAtomicID-8   6000000   190 ns/op   24 B/op   1 allocs/op
```

~4× faster, ~3× less garbage. Collision-free by construction.

**Why faster:** `atomic.Add` is one locked instruction (~5 ns). `time.Now()` reads a vDSO clock — fast but still 20–30 ns, and on some kernels falls back to a syscall. Base-36 encoding produces shorter strings (fewer bytes for the same range), saving allocation for the ID string. Using a typed context key (`reqIDKey{}`) instead of a string key avoids `runtime.convT64` for the key.
**Trade-off:** Counter resets on process restart — IDs collide across deploys. For uniqueness across instances, combine with an instance epoch (`fmt.Sprintf("%d-%d", epoch, n)`) or hand out from a pre-generated UUID batch (`bufPool` of 1024 UUIDs refilled in background). The counter wraps at 2^64 — practically irrelevant. `atomic.Add` under 1M+ req/s on a single core gets noisy from cache-line contention — shard the counter per CPU.
**When NOT:** IDs that need to be globally unique and tamper-evident (use UUIDv7 or KSUID). Distributed tracing where the ID format is dictated by the tracer (W3C `traceparent`). Tests that assert on specific ID values — easier to mock the generator than the clock.
</details>

---

## 16. When NOT to optimize

`net/http` cost dominates only when the service is on the hot path of a high-frequency operation. If your handler serves 10 req/s, every optimization here saves microseconds you can't measure: admin endpoints, internal tools, cron-triggered webhooks, batch processors that make one HTTP call per minute. Build with defaults; profile when traffic shows up.

**Profile first.** `net/http` overhead has four signatures in a CPU profile: `crypto/tls.(*Conn).Handshake` on every request → Ex. 1, 3, 10 (connection reuse broken); `runtime.mallocgc` from `bytes.makeSlice` or `bufio.NewReader` → Ex. 5, 8 (pool the allocation); `runtime.netpollblock` with high goroutine counts → Ex. 13 (slowloris-shaped, or unbounded body reads); `runtime.gopark` waiting on `persistConn.alive` → Ex. 12 (undrained bodies killing keep-alive).

**Common premature optimizations:** pooling buffers (Ex. 5, 8) on a 100 req/s service — pool overhead exceeds the alloc savings; tuning `MaxIdleConnsPerHost` (Ex. 3) when you only call one host at low concurrency — the default 2 is fine; replacing `io.ReadAll` with streaming (Ex. 2) for 1 KB bodies — `ReadAll` returns to a stack slot fast; pre-allocated UUIDs (Ex. 14) for a service whose ID format isn't even on a hot path.

**Correctness gaps disguised as optimizations:** shared client (Ex. 1) without `IdleConnTimeout` set — connections accumulate until the server kicks them, then every request 502s; tuned `MaxIdleConnsPerHost` (Ex. 3) higher than your FD ulimit — server panics on accept; `Encoder.Encode` (Ex. 4) where headers were set after `Write` — silently sends 200 on an error path; `ServeMux` patterns (Ex. 6) with overlapping routes that "happen to work" — `Handle` panics at startup in production; undrained body (Ex. 12) where the error response is huge — draining wastes more bandwidth than reconnecting; `ReadHeaderTimeout` too aggressive (Ex. 13) — mobile users on flaky networks get 408s during real outages; atomic counter ID (Ex. 14) reset across deploys collides with stored historical IDs.

**Two perennial myths.** "`http.Client` is expensive to construct" — false; it's the `Transport`'s connection pool that matters. You can construct a `Client{Transport: sharedTransport}` per request and pay nothing. "`io.ReadAll` is always wrong" — also false; for known-small bodies it's the clearest code, and `ReadAll`'s `growslice` shape is fine when total bytes < 16 KB.

---

## 17. Summary

**Always-ship wins** (default in any new `net/http` code): one package-level `*http.Client` with a tuned `Transport` (Ex. 1, 3); set `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout` on every server (Ex. 9, 13); `json.NewEncoder(w).Encode(v)` instead of marshal-then-write (Ex. 4); drain response bodies before close (Ex. 12); use `Set`/`Add` on `req.Header` (Ex. 8); use Go 1.22+ `ServeMux` patterns for routing (Ex. 6).

**Wins behind a profile** (when measurements justify them): pooled `bytes.Buffer` / `bufio.Reader` (Ex. 5, 8, when `mallocgc` shows in the handler); raised `MaxIdleConnsPerHost` (Ex. 3, when `tls.Handshake` shows on warm paths); `io.Copy` instead of `io.ReadAll` (Ex. 2, when peak memory matters); structured logging instead of `DumpRequest` (Ex. 11, when log middleware tops the CPU profile); atomic counter IDs (Ex. 14, when middleware allocations dominate).

**Specialty** (only when the design calls for it): pre-allocated UUID batches with background refill for tamper-resistant IDs at high QPS; per-host `Transport` instances when one upstream's tuning hurts another; HTTP/2-pinned clients with `ForceAttemptHTTP2` and `MaxConcurrentStreams` capped for chatty APIs; `http.Hijacker` upgrades to raw conns for protocols that outgrow `ResponseWriter`.

`net/http` cost is connection setup, allocation, undrained bodies, and unset timeouts. Strip those four from the read path by reusing the right primitive: one `Client` per process, one `Transport` per pool policy, one buffer per worker, one timeout per failure mode. The stdlib's defaults are designed for correctness, not throughput — every optimization here is moving from "works" to "scales." Profile, then pick the lever; the four signatures above tell you which one.
