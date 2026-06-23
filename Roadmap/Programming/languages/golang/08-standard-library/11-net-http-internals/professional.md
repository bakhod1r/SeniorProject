# 8.11 `net/http` Internals — Professional

> **Audience.** You've shipped HTTP services that take real traffic
> and you've seen them struggle. This file is the production
> playbook: reverse proxies you control, retries with backoff and
> idempotency, `httptrace` for diagnostics, certificate hot-reload,
> observability, and the failure modes that show up only past a few
> thousand RPS.

## 1. `httputil.ReverseProxy` in depth

The minimal proxy is one line:

```go
proxy := httputil.NewSingleHostReverseProxy(target)
```

What it does internally:

1. Sets a `Director` that rewrites the request URL to point at
   `target`.
2. Strips hop-by-hop headers (`Connection`, `Keep-Alive`, etc.).
3. Adds `X-Forwarded-For` with the client's address.
4. Calls `Transport.RoundTrip` (defaults to `http.DefaultTransport`).
5. Streams the response back, including bodies of any size.

For production, use `&httputil.ReverseProxy{}` directly:

```go
proxy := &httputil.ReverseProxy{
    Rewrite: func(pr *httputil.ProxyRequest) {
        pr.SetURL(target)
        pr.Out.Host = pr.In.Host          // preserve original host
        pr.SetXForwarded()
    },
    Transport: customTransport,
    ModifyResponse: func(resp *http.Response) error {
        resp.Header.Del("Server")
        return nil
    },
    ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
        log.Printf("proxy error: %v", err)
        http.Error(w, "upstream error", http.StatusBadGateway)
    },
    BufferPool: newBufPool(),
}
```

The `Rewrite` field (Go 1.20+) is the modern equivalent of `Director`
+ post-hooks. It receives a `ProxyRequest` with both `In` (original
client request) and `Out` (the request that will be sent upstream).

`ModifyResponse` runs after the upstream response arrives but before
the body streams to the client. Use it to strip headers, change
status codes, or capture metrics.

`ErrorHandler` runs when `Transport.RoundTrip` returns an error
*before* a status was sent. Default behavior is to write 502 Bad
Gateway with a default body. Override to log structured error info
or to return a friendlier message.

`BufferPool` lets you provide a `sync.Pool` of buffers used during
copy. Default is a 32 KiB allocation per copy; with thousands of
concurrent proxies, that's measurable pressure on the GC.

## 2. Header sanitization — what the proxy does for you

The hop-by-hop headers stripped by `ReverseProxy` (per RFC 7230):

- `Connection`
- `Keep-Alive`
- `Proxy-Authenticate`
- `Proxy-Authorization`
- `Te`
- `Trailers`
- `Transfer-Encoding`
- `Upgrade`

Plus any header listed inside `Connection:` is also stripped (a custom
hop-by-hop signal).

What it does *not* strip and you should consider:

- `Forwarded` — RFC 7239, the standard replacement for the X-* family.
  `ReverseProxy.SetXForwarded` sets `X-Forwarded-For/Host/Proto` but
  not RFC 7239 `Forwarded`. Add it explicitly if your stack expects
  it.
- `X-Real-IP` — non-standard but common. Set or pass through depending
  on whether you trust the upstream proxy.
- `Authorization` — passed through. If you don't want upstream to see
  the user's auth, strip it in `Rewrite`.

Trust boundary: `ReverseProxy` does *not* validate `X-Forwarded-For`
against any allowlist. If your service is exposed directly to the
internet, parse `X-Forwarded-For` only from headers your edge proxy
adds, not from the client's input.

## 3. Buffer pool for reverse proxy

```go
type bufPool struct{ p sync.Pool }

func newBufPool() *bufPool {
    return &bufPool{p: sync.Pool{New: func() any {
        b := make([]byte, 32*1024)
        return &b
    }}}
}

func (b *bufPool) Get() []byte  { return *b.p.Get().(*[]byte) }
func (b *bufPool) Put(buf []byte) { b.p.Put(&buf) }
```

`httputil.BufferPool` is the interface; this is the canonical impl.
The `*[]byte` indirection avoids the slice-header allocation that a
plain `sync.Pool` of slices incurs (`Get` returns `any`, which would
otherwise box).

## 4. Retries: when, where, and why

`http.Client` does not retry. By design — it doesn't know whether your
request is idempotent. Retries belong in a wrapper:

```go
func retryRoundTrip(rt http.RoundTripper, attempts int) http.RoundTripper {
    return roundTripFunc(func(r *http.Request) (*http.Response, error) {
        if r.Body != nil && r.GetBody == nil {
            return rt.RoundTrip(r) // can't replay
        }
        var lastErr error
        for i := 0; i < attempts; i++ {
            if i > 0 {
                if r.GetBody != nil {
                    body, err := r.GetBody()
                    if err != nil { return nil, err }
                    r.Body = body
                }
                time.Sleep(backoff(i))
            }
            resp, err := rt.RoundTrip(r)
            if err == nil && resp.StatusCode < 500 {
                return resp, nil
            }
            if resp != nil {
                io.Copy(io.Discard, resp.Body)
                resp.Body.Close()
            }
            lastErr = err
        }
        return nil, lastErr
    })
}

type roundTripFunc func(*http.Request) (*http.Response, error)
func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
```

Five rules:

1. **Only retry idempotent requests.** GET, HEAD, OPTIONS, PUT,
   DELETE — yes. POST and PATCH — only if the server documents
   idempotency keys or the body says so. Default to no.
2. **Replay needs `GetBody`.** Without it, the body is consumed and
   the second attempt sends an empty body. Better to fail fast than
   silently corrupt.
3. **Drain failed responses.** Otherwise the conn doesn't go back in
   the pool.
4. **Backoff with jitter.** A retry storm without jitter
   synchronizes failures. `backoff(i) = base * 2^i + rand(0, base)`.
5. **Cap total retries and total wall time.** Without a wall-clock
   cap, a slow upstream + retries can violate your SLO worse than no
   retries at all.

For "give up if the parent context is dead":

```go
select {
case <-r.Context().Done():
    return nil, r.Context().Err()
case <-time.After(backoff(i)):
}
```

## 5. Idempotency keys — the server side

When clients retry POSTs, the server needs to deduplicate:

```go
func createOrder(w http.ResponseWriter, r *http.Request) {
    key := r.Header.Get("Idempotency-Key")
    if key == "" {
        http.Error(w, "missing key", http.StatusBadRequest)
        return
    }
    if cached, ok := idemCache.Lookup(key); ok {
        writeJSON(w, cached.Status, cached.Body)
        return
    }
    // ... do the work, store result keyed by `key` ...
}
```

Stripe's specification is the canonical reference: keys are 36-char
UUIDs, scoped per merchant, retained for 24 hours. The server stores
the first response and serves it on every replay within the window.

Without an idempotency key, retries on POST risk duplicate work. With
one, a 30-second timeout + retry loop is safe.

## 6. `httptrace` — instrumenting client requests

```go
import "net/http/httptrace"

trace := &httptrace.ClientTrace{
    DNSStart:    func(info httptrace.DNSStartInfo)        { ... },
    DNSDone:     func(info httptrace.DNSDoneInfo)         { ... },
    ConnectStart: func(network, addr string)              { ... },
    ConnectDone:  func(network, addr string, err error)   { ... },
    TLSHandshakeStart: func()                              { ... },
    TLSHandshakeDone:  func(s tls.ConnectionState, err error) { ... },
    GotConn:      func(info httptrace.GotConnInfo)        { ... },
    WroteHeaders: func()                                  { ... },
    GotFirstResponseByte: func()                          { ... },
}
ctx := httptrace.WithClientTrace(req.Context(), trace)
req = req.WithContext(ctx)
resp, err := client.Do(req)
```

The hooks fire at exact points in the request lifecycle. For
production observability, the most useful are:

- `GotConn.Reused` — was this conn from the pool, or freshly dialed?
- `DNSDone` — DNS latency.
- `ConnectDone` — TCP connect latency.
- `TLSHandshakeDone` — TLS handshake latency.
- `GotFirstResponseByte` — server-side processing latency, isolated
  from network.

Latency budgets become precise: if `GotConn` to `WroteHeaders` is
slow, the request body is large or the upstream is slow at reading.
If `WroteHeaders` to `GotFirstResponseByte` is slow, the upstream is
slow at processing. Without `httptrace`, you only see total time.

`httptrace` works on per-request basis — pass a context with the
trace into `Do`. You can install a global trace on every request via
a wrapping `RoundTripper`.

## 7. `Transport` connection pool tuning under load

Default settings (`http.DefaultTransport`):

| Field | Default | Recommended for service-to-service |
|-------|---------|-----------------------------------|
| `MaxIdleConns` | 100 | 1000+ |
| `MaxIdleConnsPerHost` | 2 | 100+ |
| `MaxConnsPerHost` | 0 (unlimited) | bound by upstream's accept queue |
| `IdleConnTimeout` | 90s | match upstream's IdleTimeout - 5s |
| `ResponseHeaderTimeout` | 0 (no timeout) | 5s typical |
| `ExpectContinueTimeout` | 1s | leave |

The single change that yields the biggest difference for high-RPS
backend traffic: raise `MaxIdleConnsPerHost`. Default of 2 means under
load the client opens, closes, opens, closes — port exhaustion and
connect latency dominate.

`IdleConnTimeout` matters when paired with the upstream's
`IdleTimeout`. If upstream closes after 60s and your client tries to
reuse a 70s-old conn, you get `ECONNRESET` on the next write. Set
client `IdleConnTimeout` to (upstream `IdleTimeout` - small margin).

`ResponseHeaderTimeout` is the deadline from request-sent to
response-headers-received. Different from `Client.Timeout` (which
covers everything). Use it to fail fast on a hung upstream.

## 8. Per-host transports

For a service that talks to many backends with very different
profiles (one fast internal, one slow external), one shared
`Transport` is wrong — its idle pool grows with the slowest host's
traffic. Per-host:

```go
type transportRegistry struct {
    mu sync.RWMutex
    t  map[string]*http.Transport
}

func (r *transportRegistry) get(host string) *http.Transport {
    r.mu.RLock()
    if t, ok := r.t[host]; ok {
        r.mu.RUnlock()
        return t
    }
    r.mu.RUnlock()
    r.mu.Lock()
    defer r.mu.Unlock()
    t := newTransportFor(host)
    r.t[host] = t
    return t
}
```

Tune each transport for its target. Bonus: per-host metrics and
per-host circuit breaking get easier.

## 9. Certificate hot-reload

Long-running TLS servers need to reload certs without restarting:

```go
type certReloader struct {
    mu       sync.RWMutex
    cert     *tls.Certificate
    certFile string
    keyFile  string
}

func (r *certReloader) reload() error {
    c, err := tls.LoadX509KeyPair(r.certFile, r.keyFile)
    if err != nil { return err }
    r.mu.Lock()
    r.cert = &c
    r.mu.Unlock()
    return nil
}

func (r *certReloader) GetCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
    r.mu.RLock()
    defer r.mu.RUnlock()
    return r.cert, nil
}

reloader := &certReloader{certFile: "/etc/cert.pem", keyFile: "/etc/key.pem"}
reloader.reload()

go func() {
    t := time.NewTicker(time.Hour)
    defer t.Stop()
    for range t.C {
        if err := reloader.reload(); err != nil {
            log.Printf("cert reload: %v", err)
        }
    }
}()

srv := &http.Server{
    Addr: ":443",
    TLSConfig: &tls.Config{
        GetCertificate: reloader.GetCertificate,
    },
}
srv.ListenAndServeTLS("", "") // empty paths because GetCertificate is set
```

`GetCertificate` is called per-handshake, so reloading the underlying
cert immediately affects new conns without restarting the server.
Existing conns keep their old cert until they close — that's fine for
short-lived requests.

For SIGHUP-driven reload:

```go
sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGHUP)
go func() {
    for range sigCh {
        if err := reloader.reload(); err != nil {
            log.Printf("cert reload on SIGHUP: %v", err)
        }
    }
}()
```

For ACME / Let's Encrypt automatic reload, `golang.org/x/crypto/acme/autocert`
manages the cert pool itself.

## 10. Observability: structured access logs

A canonical access-log middleware emits one line per request with
fields you can query in your log indexer:

```go
func accessLog(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        rw := &recordingWriter{ResponseWriter: w}
        next.ServeHTTP(rw, r)

        slog.Info("http",
            "method", r.Method,
            "path", r.URL.Path,
            "status", rw.status,
            "bytes", rw.written,
            "duration_ms", time.Since(start).Milliseconds(),
            "remote", r.RemoteAddr,
            "ua", r.Header.Get("User-Agent"),
            "request_id", r.Header.Get("X-Request-Id"),
        )
    })
}
```

Fields to *not* log without sanitization:

- Full URLs (query params often contain tokens, PII).
- `Authorization` header.
- `Cookie` header.
- Request bodies.

Request IDs: if your edge proxy adds `X-Request-Id`, propagate it
through your service via context. Generate one if absent.

## 11. Server metrics worth emitting

Prometheus-style counters and histograms most production HTTP
servers should publish:

| Metric | Type | Labels |
|--------|------|--------|
| `http_requests_total` | Counter | method, path, status |
| `http_request_duration_seconds` | Histogram | method, path |
| `http_response_size_bytes` | Histogram | method, path |
| `http_in_flight_requests` | Gauge | none |
| `http_open_connections` | Gauge | none (via `ConnState`) |

Bucket the path label by route template, not by raw URL. `/users/42`
and `/users/43` should both report as `/users/{id}`. With Go 1.22's
new `ServeMux`, `r.Pattern` (Go 1.23+) gives you the matched
template directly.

Cardinality discipline: if `path` has high cardinality (every
`/items/{sku}` is different), your metric backend dies. Always reduce
to the route template.

## 12. The `http.Server.ConnState` for connection tracking

Pair with a goroutine pool to bound conn-level resource usage:

```go
var openConns int64

srv.ConnState = func(c net.Conn, state http.ConnState) {
    switch state {
    case http.StateNew:
        if atomic.AddInt64(&openConns, 1) > 10000 {
            c.Close() // shed
        }
    case http.StateClosed, http.StateHijacked:
        atomic.AddInt64(&openConns, -1)
    }
}
```

This is a crude but effective DoS shield — past 10k conns, drop new
ones. Production setups put this at the load balancer instead.

## 13. Connection draining for blue-green deploys

When orchestrators rotate pods, the old pod gets `SIGTERM` and is
expected to drain in flight conns and exit:

```go
ctx, cancel := signal.NotifyContext(context.Background(),
    syscall.SIGTERM, syscall.SIGINT)
defer cancel()

go func() { srv.ListenAndServe() }()

<-ctx.Done()

// Stop accepting new requests, mark unhealthy.
healthy.Store(false)

// Give load balancer time to notice.
time.Sleep(10 * time.Second)

// Now drain.
shutdownCtx, c := context.WithTimeout(context.Background(), 30*time.Second)
defer c()
srv.Shutdown(shutdownCtx)
```

The 10-second pre-sleep is the readiness-probe-fail-time. Without it,
the LB still routes new conns to the dying pod. Some orchestrators
support a `preStop` hook that achieves the same effect.

## 14. Zero-downtime restart with fd handover

The pattern is the same as for raw `net` servers from
[`../10-net/professional.md`](../10-net/professional.md), with one
extra step: pass the listener via `*net.TCPListener.File()`, then
`net.FileListener` in the child, and pass to `srv.Serve(ln)`.

`http.Server.ListenAndServe` does not support resuming on an existing
listener — you have to use `Serve` directly when you have an
already-bound listener. The example:

```go
ln, _ := net.Listen("tcp", ":8080")
srv := &http.Server{Handler: handler}
srv.Serve(ln) // not ListenAndServe
```

Now `ln` could come from `net.FileListener` instead of `net.Listen`,
and the parent process can hand it off without dropping conns.
Production tools: `tableflip`, `overseer`.

## 15. The HTTP/2 considerations under load

Some HTTP/2-specific behaviors to know:

1. **One conn per host, many streams.** Default HTTP/2 client opens
   one conn and multiplexes. Idle pool size loses meaning — there's
   typically one conn.
2. **`MaxConcurrentStreams` on the server bounds streams per conn.**
   Default 100; raise for high-fan-out internal services.
3. **HEADERS frames are limited.** `MaxHeaderListSize` (server) and
   the corresponding client setting cap header count + size. Default
   is generous; lower for hardening.
4. **HPACK dynamic table.** Headers are compressed across frames.
   Don't put unique values (request ID, timestamp) in headers if you
   care about the compression — they bust the cache.
5. **`PING` frames** keep idle conns alive. Default in stdlib is to
   ping every 2 minutes; tune via `http2.Transport.ReadIdleTimeout`
   and `PingTimeout` from `golang.org/x/net/http2`.

## 16. A production checklist

Before promoting an HTTP service to "ready":

- [ ] All five `http.Server` timeouts set explicitly (Read*, Write,
      Idle, MaxHeaderBytes).
- [ ] `MaxBytesReader` on every endpoint that accepts a body.
- [ ] Recovery middleware that logs to error tracker and returns 500.
- [ ] Access-log middleware with structured fields and request ID.
- [ ] Metrics: requests, duration histogram, in-flight, conn state.
- [ ] `/healthz` and `/readyz` endpoints; readiness flips false on
      shutdown.
- [ ] `Shutdown` with a context-bounded drain budget.
- [ ] Custom `*http.Client` with Timeout, custom Transport (no
      DefaultClient).
- [ ] `MaxIdleConnsPerHost` raised on outbound transports.
- [ ] Idempotency keys for non-idempotent endpoints.
- [ ] Retry wrapper with backoff + jitter on outbound RoundTripper.
- [ ] Cert hot-reload pattern if TLS.
- [ ] `ResponseController` (not type assertions) for streaming
      handlers.
- [ ] `BaseContext` tied to shutdown signal.
- [ ] `httptrace`-based latency breakdown available in dev.
- [ ] Body draining on every error path.
- [ ] Test that simulates a slow client (Slow Loris).
- [ ] Test that simulates large bodies above the cap.
- [ ] Test that simulates upstream returning 5xx, hangs, RST.

## 17. Cross-references

- [`../10-net/professional.md`](../10-net/professional.md) — listener
  patterns at scale, fd handover, slow-loris resistance at the socket
  layer.
- [`../05-os/`](../05-os/junior.md) — `signal.NotifyContext` for shutdown,
  `SIGHUP` for reload.
- [`../13-crypto/`](../13-crypto/junior.md) — `tls.Config` deep-dive,
  `GetCertificate`, ALPN.
- [`../03-time/`](../03-time/junior.md) — timer-wheel mechanics behind
  every HTTP timeout.
