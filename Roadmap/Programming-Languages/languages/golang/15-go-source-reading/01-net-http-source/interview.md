## `net/http` Source Reading — Interview

## 1. How to use this file

25 questions in interview order — junior to staff — plus a "what not to say" list and a 5-minute prep checklist. Each question has a **short answer** (two to five sentences, the length you'd give in the room) and where it matters a **follow-up to expect**. Read top to bottom on first pass; on revision skim and re-read only the ones you stumbled on. `net/http` is a pattern-rich package: the signal is whether you've actually read `server.go`, `transport.go`, `client.go`, and `serve_mux.go` once, or whether you only know the surface API. Concrete behaviours — that `DefaultServeMux` is a global, that `http.Get` does not close the body for you, that `Transport` reuses TCP connections per `(scheme, host)` — are the difference between a memorized cheat sheet and someone who can debug a live server.

---

## 2. Junior questions (Q1–Q5)

### Q1. What is `net/http`?

**Short answer:** `net/http` is the Go standard library's HTTP/1.1 and HTTP/2 client and server. It gives you `http.Server` and `http.Client` plus a routing primitive (`http.ServeMux`), a handler interface (`http.Handler`), and a transport for connection pooling (`http.Transport`). One package covers parse, serve, dial, pool, multiplex, and TLS — it is unusually batteries-included by stdlib standards. Most production Go services use it directly rather than reaching for a framework, which is why reading its source is mandatory if you want to call yourself senior.

**Follow-up:** Why is reading `net/http` worth the time vs just using a framework? Answer: every Go framework (Gin, Echo, Chi) is a thin wrapper over `net/http` — they re-use `http.Server`, `http.ResponseWriter`, `http.Request`. Bugs you hit in production almost always trace back to stdlib behaviour (`Transport` reuse, body-not-closed, ServeMux semantics), so you have to know the layer the framework hides.

---

### Q2. What's the difference between `http.Handle` and `http.HandleFunc`?

**Short answer:** `Handle(pattern, handler)` takes an `http.Handler` — a value with a `ServeHTTP(w, r)` method. `HandleFunc(pattern, fn)` takes a plain function `func(w, r)` and wraps it with `http.HandlerFunc`, a type that satisfies `http.Handler` by calling itself. Mechanically they end up in the same `ServeMux` map; `HandleFunc` is just sugar for "I don't want to declare a type for this one handler." Use `Handle` when your handler has dependencies it needs to carry (DB pool, logger) and you've made a struct for it; use `HandleFunc` for ad-hoc closures.

**Follow-up:** What is `http.HandlerFunc` exactly? Answer: a named function type `type HandlerFunc func(ResponseWriter, *Request)` with a single method `func (f HandlerFunc) ServeHTTP(w, r) { f(w, r) }`. It's the canonical example of a function-as-interface adapter in the stdlib — worth memorizing.

---

### Q3. What are the risks of using `http.DefaultServeMux`?

**Short answer:** `DefaultServeMux` is a package-level global that every `import` in your process shares. Three risks: (1) **route collisions across packages** — any imported library can call `http.Handle("/foo", ...)` and silently register a route on *your* server. (2) **expvar and pprof side effects** — importing `net/http/pprof` for its side effects registers `/debug/pprof/*` on the default mux, which is fine for ops endpoints but disastrous if you exposed it publicly without realizing. (3) **testing pain** — you can't easily isolate two test cases that both touch the default mux. The fix is to construct your own `mux := http.NewServeMux()` and pass it explicitly to `http.Server{Handler: mux}`.

**Follow-up:** When is `DefaultServeMux` acceptable? Answer: small CLIs, examples, throwaway scripts. Never in a production service, and never in a library you publish — registering on the default mux from a library is a hostile act.

---

### Q4. Does `http.Get(url)` close the response body for you?

**Short answer:** No. `http.Get` returns a `*http.Response` whose `Body io.ReadCloser` must be explicitly closed by the caller, even on a non-2xx status, even on an empty body. Forgetting `defer resp.Body.Close()` is the single most common bug in Go HTTP code: the underlying TCP connection stays checked out of the `Transport`'s pool until GC eventually runs the finalizer, by which point the pool is exhausted, new requests stall, and you see `dial tcp: socket: too many open files` in production. Always pair the request with a `defer` immediately after the error check.

```go
resp, err := http.Get(url)
if err != nil { return err }
defer resp.Body.Close()
```

**Follow-up:** What if the request errored — is `resp` nil? Answer: yes, when `err != nil` the `resp` is nil and there's nothing to close. The pattern is: check err first, return on error, then defer close. Calling `defer resp.Body.Close()` *before* the err check panics on nil deref.

---

### Q5. Why does `http.DefaultClient` have no timeouts?

**Short answer:** Historical compatibility — `http.DefaultClient` was defined in Go 1.0 before the `Timeout` field existed on `http.Client`, and adding a default would silently break every program that depended on long-poll or streaming behaviour. So the default is "wait forever," and it's on you to construct your own client with explicit timeouts for production code. The official Go blog and `net/http` docs both call this out: never use `http.DefaultClient`, `http.Get`, `http.Post`, or `http.PostForm` in production — they all funnel through the timeout-less default.

```go
client := &http.Client{Timeout: 10 * time.Second}
resp, err := client.Get(url)
```

**Follow-up:** What's the minimum production timeout config? Answer: `Client.Timeout` for the overall request, plus a custom `Transport` with `DialContext` timeout, `TLSHandshakeTimeout`, `ResponseHeaderTimeout`, `IdleConnTimeout`, `ExpectContinueTimeout`. The single `Client.Timeout` covers the worst case; the per-phase ones give finer-grained protection against slow-loris-style attacks.

---

## 3. Middle questions (Q6–Q12)

### Q6. Walk through what happens from `http.ListenAndServe` to a handler running.

**Short answer:** `ListenAndServe(addr, handler)` constructs a `Server{Addr: addr, Handler: handler}` and calls `Server.ListenAndServe()`, which calls `net.Listen("tcp", addr)` to get a `*net.TCPListener` and then `Server.Serve(listener)`. `Serve` is an infinite `for` loop: `Accept()` blocks until a TCP connection arrives, then `srv.newConn(rwc)` wraps the raw conn and `go c.serve(connCtx)` spawns a goroutine per connection. Inside `c.serve`, the request is read via `c.readRequest(ctx)`, dispatched to `serverHandler{srv}.ServeHTTP(w, r)`, which falls through to the user's `Handler` (or `DefaultServeMux` if nil). When `ServeHTTP` returns, the response is finalized, the connection either closes or returns to the keepalive idle state for the next request.

```
ListenAndServe → Serve → for { Accept; go c.serve(ctx) } → readRequest → handler.ServeHTTP
```

**Follow-up:** What runs `c.serve` — one goroutine per request or per connection? Answer: per **connection**. HTTP/1.1 keepalive reuses the same connection (and thus the same `c.serve` goroutine) for many sequential requests on that conn. HTTP/2 multiplexing is different — one goroutine accepts the conn and a separate goroutine handles each stream. The "one goroutine per request" mental model is wrong for HTTP/1.1.

---

### Q7. What is `ServeMux` and how does it match routes?

**Short answer:** `ServeMux` is the stdlib's HTTP request multiplexer — a map from URL patterns to handlers. Pre-1.22, matching was simple: longest matching prefix wins, patterns ending in `/` are prefix matches, patterns without `/` are exact. No path parameters, no method matching, no precedence rules beyond longest match. Internally it's a `map[string]muxEntry` plus a sorted slice for prefix patterns. It's deliberately minimal because Go's philosophy was "routing is small, write your own if you need more" — which is why every framework ships its own router.

**Follow-up:** Why didn't `ServeMux` have path params for 14 years? Answer: deliberate scope minimization. The team viewed routing as a domain that frameworks should own, and they wanted `net/http` to stay focused on the wire protocol. The 1.22 change (pattern syntax, method matching, `{id}` params) reversed that stance because the ecosystem had clearly converged on those features.

---

### Q8. How does `http.Transport` pool connections?

**Short answer:** `Transport` keeps an internal map `idleConn map[connectMethodKey][]*persistConn`, keyed by `(scheme, host, port, proxy)`. When you call `client.Do(req)`, `Transport.roundTrip` looks up the key, pops an idle connection if available, otherwise dials a new one via `dialConn`. After the response body is read and closed, the connection is returned to the idle pool via `tryPutIdleConn`. Limits: `MaxIdleConns` (global cap), `MaxIdleConnsPerHost` (per-host cap, default 2!), `MaxConnsPerHost` (active+idle cap, 0 means unlimited), `IdleConnTimeout` (eviction after idle). The default `MaxIdleConnsPerHost: 2` is the single biggest production footgun in the stdlib — it forces re-dialling under any reasonable load.

**Follow-up:** What's the connection lifecycle exactly? Answer: `getConn(req, cm)` returns a `*persistConn` either from the idle pool or freshly dialed. After the request, `pconn.readLoop` calls `tryPutIdleConn` if the response said "keep-alive". If the pool is full or `tryPutIdleConn` fails, the conn is closed. Forgetting `Body.Close()` means `readLoop` never reaches the put-back logic, so the conn leaks until GC's finalizer eventually closes it.

---

### Q9. Why must you call `resp.Body.Close()`?

**Short answer:** `resp.Body` is a `*http.body` that wraps the underlying `persistConn`'s read buffer. Closing it (a) drains remaining bytes from the socket so the next request on the same keepalive conn doesn't start mid-response, and (b) signals the `Transport` that the conn is reusable, triggering `tryPutIdleConn`. Skip the close and the conn stays checked out of the pool until GC's finalizer eventually closes it — which can be seconds or minutes, plenty of time to exhaust the pool. The performance impact is dramatic: a hot loop calling an HTTP API without `Body.Close()` will degrade from ~10k req/s to ~50 req/s (one new TCP+TLS handshake per call) within a few seconds.

**Follow-up:** What if you don't care about the body — do you still have to read it? Answer: yes, ideally `io.Copy(io.Discard, resp.Body)` before `Close()` so the conn can be reused. Closing without draining means the next request has to discard whatever's left on the wire, which `net/http` does by closing the conn rather than reading-and-discarding. Drain + close is the cheap-keepalive path; close-without-drain is the discard-conn path.

---

### Q10. What changed in `ServeMux` in Go 1.22?

**Short answer:** Three additions. (1) **Method matching** — `mux.HandleFunc("GET /users", h)` matches only GETs; previously you'd switch on `r.Method` inside the handler. (2) **Path wildcards** — `"/users/{id}"` extracts `id` via `r.PathValue("id")`. (3) **Strict tail matching** — `"/users/{id}/posts"` matches only that shape, not `/users/1/posts/extra`. The new pattern syntax also defines a deterministic precedence rule (most specific wins) replacing the old longest-prefix-wins. This was the biggest change to `net/http` in a decade, and it answers "do I still need chi/gorilla-mux for a basic API?" with "often, no."

**Follow-up:** Is 1.22 mux now production-ready as a router? Answer: for most CRUD APIs, yes. You still want chi or echo if you need middleware chains, route groups, sub-routers, or named routes. But for a 10-endpoint internal service, stdlib mux is now sufficient — that was not true pre-1.22.

---

### Q11. How do you do graceful shutdown?

**Short answer:** `Server.Shutdown(ctx)` is the canonical answer. It stops accepting new connections, waits for in-flight requests to finish, closes idle keepalive conns, and returns when (a) all handlers have returned or (b) the context expires. The pattern is to spawn the server in a goroutine, block the main goroutine on a signal channel, then call `Shutdown` with a bounded context.

```go
srv := &http.Server{Addr: ":8080", Handler: mux}
go func() { srv.ListenAndServe() }()

sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
<-sigCh

ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(ctx)
```

**Follow-up:** What does `Shutdown` *not* do? Answer: it doesn't cancel in-flight handlers. If a handler is blocked on a database query, `Shutdown` waits for it. To force cancellation, the handler must select on `r.Context().Done()` — `Server` cancels each request's context when `Shutdown` is called, but only the handler can react to it.

---

### Q12. Why is `Hijack` useful?

**Short answer:** `ResponseWriter.(http.Hijacker).Hijack()` lets the handler take over the raw TCP connection from the `Server`. After hijacking, `net/http` stops managing the conn — no automatic response, no keepalive, no timeouts. This is the escape hatch for protocols that diverge from request/response: WebSockets (upgrade to bidirectional framing), HTTP CONNECT tunnels (TCP proxying), Server-Sent Events with non-standard framing, or any custom binary protocol that uses HTTP for the handshake. `gorilla/websocket` and `nhooyr.io/websocket` both call `Hijack` to take over the conn after the upgrade handshake.

```go
hj, ok := w.(http.Hijacker)
if !ok { http.Error(w, "no hijacker", 500); return }
conn, buf, err := hj.Hijack()
if err != nil { return }
defer conn.Close()
// now you own the TCP conn
```

**Follow-up:** When should you *not* hijack? Answer: when stock SSE works (use `http.Flusher` instead), when stock chunked transfer works (just write to `w`), or when you'd be reinventing HTTP/2 multiplexing. Hijacking on HTTP/2 returns `ErrNotSupported` because there's no single TCP conn to take over — that alone disqualifies it for many use cases.

---

## 4. Senior questions (Q13–Q20)

### Q13. Tune a server for 10K concurrent connections — what timeouts and limits?

**Short answer:** Six parameters, plus OS-level limits.

```go
srv := &http.Server{
    Addr:              ":8080",
    Handler:           mux,
    ReadHeaderTimeout: 5 * time.Second,    // slow-loris defence
    ReadTimeout:       30 * time.Second,   // full request body
    WriteTimeout:      60 * time.Second,   // response complete
    IdleTimeout:       120 * time.Second,  // keepalive eviction
    MaxHeaderBytes:    1 << 20,            // 1MB, default is enough for most
}
```

(1) `ReadHeaderTimeout` is the most important — it's specifically the slow-loris kill switch and should be small (1–10s). (2) `ReadTimeout` covers the full request including body — set generously for large uploads, tight for JSON APIs. (3) `WriteTimeout` is end-to-end response time — set per the slowest legitimate response. (4) `IdleTimeout` controls keepalive conn eviction. (5) OS limits: `ulimit -n` for file descriptors (default 1024 is fatal at 10k conns — raise to 100k+); `net.core.somaxconn` for the accept queue; `net.ipv4.ip_local_port_range` for ephemeral ports on the client side. (6) Memory: each idle conn holds ~4KB read buffer + ~4KB write buffer + goroutine stack (~2KB initial), so 10k conns ≈ 100MB minimum.

**Follow-up:** What about Linux-specific tuning? Answer: increase `fs.file-max` and `nofile` limits; tune `net.ipv4.tcp_max_syn_backlog`; consider `SO_REUSEPORT` for multi-process listeners; disable Nagle (`TCP_NODELAY`) for low-latency APIs. `net/http` doesn't expose `SO_REUSEPORT` directly — use `golang.org/x/net/internal/socket` or a custom `Listener`.

---

### Q14. Walk through HTTP/2 negotiation.

**Short answer:** Two paths. (1) **HTTPS/ALPN** — during the TLS handshake, the client sends `ALPN` (Application-Layer Protocol Negotiation) with `["h2", "http/1.1"]`; the server picks `h2` if it supports it. Both sides then speak HTTP/2 over the encrypted conn. This is how 99% of HTTP/2 happens in production. (2) **Cleartext upgrade (h2c)** — the client sends an HTTP/1.1 request with `Upgrade: h2c` and the connection preface; the server responds with `101 Switching Protocols`. Rarely used; mostly for backend-to-backend where TLS is terminated upstream.

In Go: `http.Server` auto-enables HTTP/2 over TLS when you configure `TLSConfig` properly (Go links in `golang.org/x/net/http2` via `http2.ConfigureServer` automatically on `ListenAndServeTLS`). For h2c, you need `golang.org/x/net/http2/h2c.NewHandler(handler, &http2.Server{})` explicitly. To disable HTTP/2 (sometimes needed for streaming compatibility): set `TLSNextProto` to a non-nil empty map.

**Follow-up:** Why would you disable HTTP/2? Answer: (a) HTTP/2 multiplexes streams over a single TCP conn, so head-of-line blocking on a slow stream affects others; HTTP/1.1 with multiple TCP conns can be faster for some workloads. (b) Some intermediaries (older load balancers) misbehave with HTTP/2. (c) Server-Sent Events on HTTP/2 don't get the "one stream per SSE channel" semantics people expect. (d) `Hijack` doesn't work on HTTP/2.

---

### Q15. How do you avoid header injection?

**Short answer:** Header injection happens when user-controlled data is written into response headers verbatim and includes `\r\n`, splitting one header into two (or worse, ending the header section early and injecting a body). Go's `Header.Set` and `Header.Add` *do not* sanitize — they trust the caller. The defence is at the boundary: validate or sanitize any string that originated from user input before it goes into `w.Header().Set(name, value)`. Specifically, reject `\r`, `\n`, and `\x00` in header values, and reject control chars in header names. `net/http` does validate header *names* against the RFC 7230 token grammar via `http.ValidHeaderFieldName`, but values are caller responsibility.

```go
if strings.ContainsAny(value, "\r\n\x00") {
    http.Error(w, "invalid header", 400); return
}
w.Header().Set("X-Custom", value)
```

**Follow-up:** Is `Location` header redirect safe? Answer: `http.Redirect(w, r, url, status)` does call `urlPathEscape` on the URL before setting Location, which neutralizes `\r\n` in the path. But if you build the Location URL yourself with `w.Header().Set("Location", userInput)`, you're back to manual validation. Prefer `http.Redirect` always.

---

### Q16. Compare `httputil.ReverseProxy` vs writing your own.

**Short answer:** `httputil.ReverseProxy` is the stdlib's production-tested reverse proxy: it handles hop-by-hop header stripping (Connection, Upgrade, Proxy-*), Host header rewriting, X-Forwarded-For chaining, request body streaming, response streaming, WebSocket upgrade pass-through (via `Hijack`), and graceful error responses. Writing your own means re-implementing all of that plus likely getting one of them wrong — especially hop-by-hop header handling, which is a CVE waiting to happen. Reach for `ReverseProxy` first; write your own only when you need behaviour it doesn't expose (custom retry semantics, request mirroring, content rewriting at scale).

```go
proxy := &httputil.ReverseProxy{
    Rewrite: func(r *httputil.ProxyRequest) {
        r.SetURL(target)
        r.SetXForwarded()
    },
    ErrorHandler: func(w, r, err) { ... },
}
```

Senior moves: (a) use the 1.20+ `Rewrite` callback instead of the older `Director` — it gets both the inbound and outbound request and handles forwarded headers correctly; (b) set `ErrorHandler` to control upstream-failure responses; (c) consider `ModifyResponse` for response rewriting; (d) configure the underlying `Transport` (don't use `DefaultTransport`) for connection pool tuning.

**Follow-up:** What does `ReverseProxy` *not* do well? Answer: (a) no built-in retry logic — if you want retries on upstream 5xx, you have to wrap the `Transport`. (b) no circuit breaker. (c) no load balancing across multiple upstreams — `Rewrite` picks one URL per request, so you implement LB in the `Rewrite` callback. (d) request body buffering: by default `ReverseProxy` streams, which is good for memory but means you can't retry a request whose body has already been sent. For these, look at `caddy`, `traefik`, or a service mesh.

---

### Q17. How to debug a "p99 latency spike" in an HTTP server?

**Short answer:** Six layers, in order. (1) **First confirm it's the server, not the client or network** — check upstream load balancer p99 vs server-reported p99; if upstream is high and server-reported is low, you're queuing somewhere outside the server. (2) **Per-route breakdown** — instrument by route (method + path template); often the spike is one slow endpoint, not the whole server. (3) **Goroutine and conn counts via `expvar` or `runtime/metrics`** — sudden conn exhaustion or goroutine spike means downstream blocked. (4) **pprof CPU and block profiles** — `import _ "net/http/pprof"`; `/debug/pprof/profile?seconds=30` for CPU, `/debug/pprof/block` for sync blocking, `/debug/pprof/goroutine?debug=2` for goroutine dump. (5) **GC pauses** — `GODEBUG=gctrace=1` or `runtime/metrics`; a 10ms GC pause every few seconds shows up as p99 spike on a 1ms-median service. (6) **Downstream timeouts** — slow database, slow cache, slow external API; check whether handler p99 minus downstream p99 is the actual server overhead.

Senior moves: (a) use distributed tracing (OpenTelemetry) before you need it, not after; trace IDs let you join client-side latency to server-side spans; (b) compare *tail* latency to *median* latency, not average — averages hide bimodal distributions; (c) check `Server.IdleTimeout` and `KeepAliveConfig` — keepalive timeouts that don't match the upstream LB can cause periodic re-dials that show as p99.

**Follow-up:** What's a common Go-specific cause of p99 spikes? Answer: GC pauses on large heaps. The fix is to reduce allocations (pool buffers, reuse slices, prefer stack allocation), tune `GOGC` (lower = more frequent shorter GCs), or for extreme cases use `runtime.SetMemoryLimit`. Goroutine preemption pre-1.14 also caused tail-latency spikes on CPU-bound handlers; 1.14+ added asynchronous preemption and fixed it.

---

### Q18. Show how to build middleware.

**Short answer:** Middleware in `net/http` is a function `func(http.Handler) http.Handler` — it takes the next handler in the chain and returns a wrapper. Compose chains by nesting calls; or build a tiny chain helper. The pattern is the same as decorator — wrap a handler with cross-cutting behaviour without changing the handler's signature.

```go
func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        rw := &statusRecorder{ResponseWriter: w, status: 200}
        next.ServeHTTP(rw, r)
        log.Printf("%s %s %d %s", r.Method, r.URL.Path, rw.status, time.Since(start))
    })
}

func Recover(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                http.Error(w, "internal error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

mux := http.NewServeMux()
mux.HandleFunc("/api", apiHandler)
handler := Logging(Recover(mux))
http.ListenAndServe(":8080", handler)
```

Senior moves: (a) wrap `ResponseWriter` to capture status code, byte count, etc., for logging; (b) middleware that wraps `ResponseWriter` must implement `http.Flusher`, `http.Hijacker`, `http.Pusher` if downstream code needs them — wrapping breaks the type assertion otherwise; (c) order matters — `Recover` should be outermost so panics in `Logging`'s post-handler code are also caught; (d) for context propagation, use `r.WithContext(newCtx)` and pass the new request to `next.ServeHTTP`.

**Follow-up:** What about middleware that wraps `ResponseWriter` and breaks `Flusher`? Answer: this is the classic gotcha. The fix is to expose the underlying writer's interfaces via your wrapper. Either embed `http.ResponseWriter` and forward the methods, or implement the interfaces explicitly:

```go
func (rw *statusRecorder) Flush() {
    if f, ok := rw.ResponseWriter.(http.Flusher); ok { f.Flush() }
}
```

Without this, `http.Flusher` assertion in the inner handler returns false even though the underlying writer supports it.

---

### Q19. Pitfalls of `http.DefaultTransport`.

**Short answer:** Five. (1) **`MaxIdleConnsPerHost: 2`** — the default cap is too low for any service that talks to a single backend; bump it. (2) **No `MaxConnsPerHost`** — unlimited active conns means a backend outage can flood your process with stuck dials. (3) **`IdleConnTimeout: 90s`** — fine usually, but if your upstream LB closes idle conns at 60s, you'll race between client-side reuse and server-side close, causing `EOF` errors on first request after idle. Match it: set `IdleConnTimeout` lower than your LB's `idle_timeout`. (4) **`DialContext` timeout: 30s** — too generous; many services want 5–10s. (5) **It's a package global** — anyone importing your code can mutate it, and tests that swap it leak across packages. Production code should construct its own `Transport` per `Client`.

```go
transport := &http.Transport{
    MaxIdleConns:        100,
    MaxIdleConnsPerHost: 100,
    MaxConnsPerHost:     100,
    IdleConnTimeout:     30 * time.Second,
    DialContext: (&net.Dialer{
        Timeout:   5 * time.Second,
        KeepAlive: 30 * time.Second,
    }).DialContext,
    TLSHandshakeTimeout:   5 * time.Second,
    ResponseHeaderTimeout: 10 * time.Second,
    ExpectContinueTimeout: 1 * time.Second,
}
client := &http.Client{Transport: transport, Timeout: 30 * time.Second}
```

**Follow-up:** Should you create one `Client` or many? Answer: one per upstream service (one for the database REST API, one for the auth API, etc.). Each has its own `Transport` with pool limits tuned to that backend. Sharing one `Client` across all upstreams means all backends compete for the same idle pool — you can't tune them independently.

---

### Q20. How does `context.WithTimeout` propagate?

**Short answer:** `Server` derives a per-request context from the connection context (which it cancels on `Shutdown`) and attaches it to the `Request` via `r.WithContext`. Handlers see this context via `r.Context()`. When a handler wraps it with `context.WithTimeout(r.Context(), d)` and passes the new context to a downstream call (database query, outbound HTTP request, `Transport.RoundTrip`), cancellation propagates: when the timeout fires *or* the parent context is cancelled, the downstream call sees `ctx.Done()` close and aborts.

For outbound HTTP, `req = req.WithContext(ctx); client.Do(req)` causes `Transport.RoundTrip` to monitor `ctx.Done()` and forcibly close the connection if the context expires. The closed conn doesn't go back to the idle pool — it's discarded. So context cancellation is a real network signal, not just a Go-level abort.

```go
ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
defer cancel()
req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
resp, err := client.Do(req)
```

**Follow-up:** What happens if I `WithTimeout(r.Context(), longer)` than the request's own deadline? Answer: the *child* context can only be more restrictive than the parent. If the parent has a deadline of 10s and you ask for 30s, the child's effective deadline is still 10s. `context.WithTimeout` does the right thing: the inherited deadline wins. Same logic for `Server.WriteTimeout` — if it's 5s and your handler creates a 30s context, the underlying write fails at 5s regardless.

---

## 5. Staff/Architect questions (Q21–Q25)

### Q21. When would you use `fasthttp` instead of `net/http`?

**Short answer:** Rarely, and only with eyes open. `fasthttp` (valyala/fasthttp) achieves ~10x throughput on micro-benchmarks by (a) reusing request and response objects via `sync.Pool`, (b) refusing to allocate immutable headers, (c) using a different `RequestHandler` signature, (d) skipping HTTP/2 entirely. The trade: it's API-incompatible with `net/http`, can't use any middleware or library written for stdlib, has its own ecosystem (router, etc.), and the "must not retain references after handler returns" rule is a sharp footgun that has caused real CVEs. Use it when (a) you're CPU-bound on parsing and serving (rare — most services are I/O or downstream-bound), (b) you're building a load generator or proxy where throughput is the product, (c) you have measured `net/http` and found it the bottleneck after tuning. Otherwise, stay with stdlib.

**Follow-up:** What about HTTP/3 (QUIC) — is that a reason to leave stdlib? Answer: yes, currently — stdlib `net/http` doesn't ship HTTP/3 yet. `quic-go` is the production implementation. The Go team has discussed HTTP/3 support but it's not in the standard tree as of 1.22. If you need HTTP/3 today, you reach outside stdlib.

---

### Q22. Design an HTTP/3 (QUIC) transport for Go.

**Short answer:** Five pieces. (1) **UDP-based transport** — QUIC runs over UDP; your "dial" is `net.ListenUDP` + a QUIC library (`quic-go`) doing the handshake. There's no TCP conn to pool; you pool QUIC sessions instead. (2) **Stream multiplexing per session** — one QUIC session multiplexes many streams without head-of-line blocking; one HTTP request = one stream. Your transport's pool is `map[host][]*quic.Connection`, not `map[host][]*persistConn`. (3) **0-RTT resumption** — QUIC supports sending the request in the first handshake packet for known servers. Your transport caches the session ticket per host and uses it for warm restarts; tradeoff is replay risk for non-idempotent methods (gate POST/PUT/DELETE behind 1-RTT). (4) **Connection migration** — QUIC connections survive client IP changes (Wi-Fi → cellular). The transport needs to detect this and not invalidate the session. (5) **`http.RoundTripper` interface compatibility** — your transport implements `RoundTrip(*http.Request) (*http.Response, error)` so callers can swap it in without changing the `http.Client` API. The stdlib type stays the same; the transport changes.

The hard parts: (a) you can't reuse `net/http`'s connection management — write it from scratch; (b) UDP middle-box traversal (some networks block UDP/443); fall back to HTTP/2 over TCP when QUIC fails. `quic-go/http3` does (a)+(b) already.

**Follow-up:** When does HTTP/3 actually help? Answer: high-latency or lossy networks (mobile, satellite, congested Wi-Fi). On a clean datacenter link with 0.1ms RTT and 0% loss, HTTP/2 and HTTP/3 are indistinguishable. The wins are about head-of-line blocking elimination (one slow stream doesn't stall others) and 0-RTT (cuts handshake on warm reuse). Datacenter-internal traffic rarely needs it; mobile-client traffic often does.

---

### Q23. Discuss the trade-offs in stdlib's "one goroutine per conn" model.

**Short answer:** Pros: (a) **simple programming model** — handler code is synchronous, no callback hell, no explicit state machines; (b) **Go's scheduler does the right thing** — goroutines are cheap (~2KB initial stack) and the M:N scheduler handles I/O blocking transparently; (c) **per-request isolation** — panics in one handler don't crash other goroutines (with `Server.Recover` or middleware); (d) **stdlib code is readable** — `server.go` is ~3000 lines, much shorter than equivalent event-loop code. Cons: (a) **memory cost at extreme scale** — 1M concurrent conns × ~10KB per goroutine = 10GB; event-loop servers (nginx, envoy) handle the same in ~1GB; (b) **scheduler overhead** at 100k+ goroutines, GC scan time grows with goroutine count (improved a lot in Go 1.20+ but still real); (c) **context-switch latency** — for sub-millisecond-latency services, goroutine wake-ups add ~1-10μs vs an event loop's direct callback.

Where Go's model wins: 1k–100k concurrent conns with non-trivial per-request work (DB query, downstream API call) — the sweet spot of most Go services. Where it loses: extreme C10M (1M+ idle conns) with minimal per-request work — chat servers with WebSockets at scale; here you either accept the memory cost or hand-roll an event-loop server in Go using `epoll` directly.

**Follow-up:** Has Go ever considered moving to an event-loop model? Answer: no, deliberately. The whole point of goroutines is to make synchronous code work at concurrent scale; introducing async/await or callbacks would split the language ecosystem. The Go team would rather optimize goroutine cost (which they've done in 1.14 async preemption, 1.19 soft memory limit, 1.21 PGO) than change the programming model.

---

### Q24. Critique the 1.22 mux changes.

**Short answer:** The wins: method matching and path params close the gap with frameworks for basic CRUD; new users don't need a routing library on day one; deterministic precedence rules (most specific wins) are clearer than longest-prefix-wins. The criticisms: (a) **breaking change in spirit** — old `ServeMux` behaviour subtly differs; patterns with `{}` braces that "worked" pre-1.22 (as literal strings) silently changed meaning. The team mitigated with a strict pattern syntax that errors on ambiguity, but it's still a soft compatibility break. (b) **half a router** — there's no route grouping, no middleware chains, no sub-routers, no named routes for reverse URL generation; for anything beyond CRUD you're back to chi/echo. (c) **`PathValue(name)` instead of typed extraction** — every value is a string; framework users used to typed `int`/`uuid` params in route registration; stdlib makes you parse. (d) **no reflection on registered routes** — you can't list "what routes does this mux serve?" which is useful for OpenAPI generation; frameworks expose it. (e) **performance** — the new matcher is slightly slower than the old prefix map for simple cases; benchmarks show 100–200ns added per match. Probably worth it for the features but worth noting.

**Follow-up:** Should the team have done more, or less? Answer: opinions vary. The "more" camp wanted middleware chains and route groups in stdlib; the "less" camp wanted to keep `ServeMux` minimal and let frameworks own the rest. The 1.22 cut split the difference. The pragmatic read: 1.22 is enough for many internal APIs but not enough to displace frameworks for serious public-facing services — which is probably the right line.

---

### Q25. How would you add metrics without changing handler signatures?

**Short answer:** Middleware that wraps `http.Handler` and records per-request stats. Since middleware is just `func(http.Handler) http.Handler`, you can layer metrics without touching any handler code. The recorder wraps `ResponseWriter` to capture status and bytes, times the handler call, and emits to your metrics system (Prometheus, OpenTelemetry, statsd).

```go
func Metrics(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        rw := &recorder{ResponseWriter: w, status: 200}
        next.ServeHTTP(rw, r)
        labels := prometheus.Labels{
            "method": r.Method,
            "route":  routePattern(r),  // mux-aware route template
            "status": strconv.Itoa(rw.status),
        }
        requestDuration.With(labels).Observe(time.Since(start).Seconds())
        requestBytes.With(labels).Observe(float64(rw.bytes))
        requestsTotal.With(labels).Inc()
    })
}
```

Staff moves: (a) label by *route template*, not raw path — `/users/{id}` not `/users/12345` — otherwise Prometheus cardinality explodes; with 1.22 mux you can extract the template via `r.Pattern` (proposed) or via a side table; (b) histogram buckets must match SLO targets — don't use Prometheus defaults blindly; (c) avoid measuring inside the hot path beyond a single `time.Since` and a label lookup; expensive label computation in hot middleware is its own perf bug; (d) export both per-route and per-status — alerting on 5xx rate per route catches per-endpoint regressions; (e) propagate trace context (`traceparent` header) into the request context so downstream calls join the same trace.

The deeper point: middleware is the right answer for *any* cross-cutting concern in `net/http` — metrics, logging, tracing, auth, rate-limiting, panic recovery, request ID injection. Handlers stay focused on business logic; the chain handles operational concerns. That separation is the reason `net/http`'s minimal API has survived 14 years without growing.

**Follow-up:** What about per-handler metrics that need handler-specific labels (e.g., `payment_amount_bucket`)? Answer: handlers can write directly to their own metrics — middleware is for *generic* per-request metrics; handler-specific business metrics live in the handler. Don't try to make middleware "know about" every handler's domain; the boundary is generic-vs-specific.

---

## 6. What NOT to say

- **"Just use Gin / Echo, stdlib is too low-level."** Signals you've never read `net/http` source and don't understand what the framework is wrapping.
- **"`http.Get` is fine for production."** It uses `DefaultClient`, which has no timeouts — production fail.
- **"You don't need to close the response body if you don't read it."** You absolutely do; the conn leaks until GC otherwise. This is the #1 Go HTTP bug.
- **"`DefaultServeMux` is just a convenience."** It's a process-global with security implications (pprof side effects, library route collisions). Real services build their own mux.
- **"HTTP/2 is always better than HTTP/1.1."** No — head-of-line blocking, intermediary incompatibility, and `Hijack` not supported are real reasons to disable it.
- **"Go is faster than fasthttp."** No — fasthttp is measurably faster on micro-benchmarks. The honest answer is "it's faster but the trade-offs are usually not worth it."
- **"`MaxIdleConnsPerHost` default of 2 is reasonable."** It is a footgun and you should know it.
- **"Middleware should mutate the request directly."** Always use `r.WithContext(newCtx)` to derive a new request; mutating the original is a footgun across the chain.
- **"`Server.Shutdown` cancels in-flight handlers."** It doesn't — it waits for them. The handler has to react to `r.Context().Done()`.
- **"`net/http` doesn't have HTTP/2."** It does, automatically over TLS since Go 1.6. What it doesn't have yet is HTTP/3.
- **"Timeouts are a TLS concern."** No — `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout` are all `http.Server` fields; slow-loris attacks happen at the HTTP layer.
- **"I'd write my own reverse proxy because `httputil.ReverseProxy` is too simple."** That's a CVE waiting to happen. Hop-by-hop headers, forwarded headers, WebSocket upgrades — stdlib gets all of this right; you probably won't.

---

## 7. 5-minute prep checklist

Run through this list right before the interview. If you can answer each in one breath, you're ready.

- [ ] **`net/http` in one sentence.** Stdlib HTTP/1.1 + HTTP/2 client and server, with `Handler`, `ServeMux`, `Server`, `Client`, `Transport`.
- [ ] **`Handle` vs `HandleFunc`.** `Handle` takes a `Handler` interface; `HandleFunc` takes a function and wraps it in `HandlerFunc`.
- [ ] **Why not `DefaultServeMux` in production.** It's a global; any imported package can register routes; pprof side-effect imports.
- [ ] **`http.Get` does NOT close body.** Always `defer resp.Body.Close()` after err check. Forgetting it leaks connections until GC.
- [ ] **`DefaultClient` has no timeout.** Production must construct `&http.Client{Timeout: ...}` with a custom `Transport`.
- [ ] **`ListenAndServe` flow.** `Listen → Serve → Accept loop → go c.serve → readRequest → handler.ServeHTTP`.
- [ ] **One goroutine per connection.** Not per request (keepalive reuses). HTTP/2 spawns one goroutine per stream.
- [ ] **`Transport` pool key.** `(scheme, host, port, proxy)`. Default `MaxIdleConnsPerHost: 2` is too low.
- [ ] **Why close body.** Drains conn for keepalive reuse + signals Transport to return conn to idle pool.
- [ ] **1.22 mux additions.** Method matching, `{id}` path params, deterministic precedence, `r.PathValue`.
- [ ] **Graceful shutdown.** `Server.Shutdown(ctx)` waits for handlers; handlers must select on `r.Context().Done()` to cancel work.
- [ ] **`Hijack`.** Take over the TCP conn for WebSockets, CONNECT tunnels, custom protocols. HTTP/2 doesn't support it.
- [ ] **10K conn tuning.** `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout`, `MaxHeaderBytes`, OS `ulimit -n`.
- [ ] **HTTP/2 negotiation.** ALPN over TLS picks `h2`; h2c over cleartext via `Upgrade: h2c`.
- [ ] **Header injection.** `Header.Set` doesn't sanitize; reject `\r\n\x00` in user-controlled values.
- [ ] **`ReverseProxy` does hop-by-hop stripping + Host rewriting + X-Forwarded for free.** Don't roll your own.
- [ ] **p99 spike checklist.** Per-route metrics → pprof CPU/block → GC pauses → downstream latency.
- [ ] **Middleware shape.** `func(http.Handler) http.Handler`. Wrap `ResponseWriter` for status; forward `Flusher`/`Hijacker`.
- [ ] **`DefaultTransport` pitfalls.** Low `MaxIdleConnsPerHost`, no `MaxConnsPerHost`, `IdleConnTimeout` mismatched with LB, package global.
- [ ] **Context propagation.** `r.Context()` cancels on `Shutdown`; pass through to downstream `client.Do(req.WithContext(ctx))`.
- [ ] **fasthttp trade-off.** ~10x throughput, but no HTTP/2, API-incompatible, retain-reference footgun. Rarely worth it.
- [ ] **HTTP/3 path.** Not in stdlib yet; use `quic-go/http3`. Wins on lossy/high-RTT networks.
- [ ] **Goroutine-per-conn trade-off.** Simple synchronous handlers; memory cost at 1M+ idle conns; sweet spot 1k–100k.
- [ ] **1.22 mux criticism.** Half a router — no groups, no middleware chain, no typed params, slight perf regression.
- [ ] **Metrics via middleware.** Wrap handler; label by *route template* not raw path to avoid cardinality blow-up.

---
