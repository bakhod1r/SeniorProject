---
layout: default
title: httptest — Professional
parent: net/http/httptest
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/04-httptest/professional/
---

# httptest — Professional

[← Back](../)

This file collects production-grade patterns for `httptest`: OAuth callback flows, webhook receivers, canned response replay, multi-server fan-out, and how `httptest` interoperates with `go-vcr` and `gock` when you cannot fully control the URL.

## OAuth 2.0 authorization-code flow

OAuth is one of the messiest things to test because it involves a redirect-driven dance across three actors: your client, the authorization server, and the resource server. `httptest` lets you simulate the authorization server in-process so your client code can be tested without any real network.

```go
func TestOAuthFlow(t *testing.T) {
    // Authorization server mocks /auth and /token endpoints.
    authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        switch r.URL.Path {
        case "/auth":
            // Redirect back to client with code.
            redirect := r.URL.Query().Get("redirect_uri") + "?code=test-code&state=" + r.URL.Query().Get("state")
            http.Redirect(w, r, redirect, http.StatusFound)
        case "/token":
            r.ParseForm()
            if r.Form.Get("code") != "test-code" {
                http.Error(w, "bad code", http.StatusBadRequest)
                return
            }
            w.Header().Set("Content-Type", "application/json")
            fmt.Fprint(w, `{"access_token":"at-1","token_type":"Bearer","expires_in":3600}`)
        default:
            http.NotFound(w, r)
        }
    }))
    t.Cleanup(authServer.Close)

    // Configure your OAuth client with authServer.URL as both Auth and Token endpoints.
    cfg := oauth2.Config{
        ClientID:     "id",
        ClientSecret: "secret",
        Endpoint: oauth2.Endpoint{
            AuthURL:  authServer.URL + "/auth",
            TokenURL: authServer.URL + "/token",
        },
        RedirectURL: "http://localhost/callback",
    }

    // Exchange test-code for a token.
    tok, err := cfg.Exchange(context.Background(), "test-code")
    if err != nil {
        t.Fatal(err)
    }
    if tok.AccessToken != "at-1" {
        t.Fatalf("got token %q", tok.AccessToken)
    }
}
```

Note three patterns. First, the authorization server is one `httptest.Server` that multiplexes both endpoints on a `switch r.URL.Path`. Second, the redirect chain is exercised by the OAuth library; you don't have to simulate the browser. Third, `t.Cleanup` guarantees the server shuts down even if the test fatals.

For PKCE, your handler should verify `code_verifier` matches the previously seen `code_challenge`; store the challenge in a per-test map keyed by `state`.

## Webhook receiver tests

When your code *sends* webhooks, you want a fake receiver that records what arrived.

```go
type recordedRequest struct {
    Headers http.Header
    Body    []byte
}

func newWebhookRecorder(t *testing.T) (*httptest.Server, func() []recordedRequest) {
    var (
        mu   sync.Mutex
        recs []recordedRequest
    )
    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        body, _ := io.ReadAll(r.Body)
        mu.Lock()
        recs = append(recs, recordedRequest{Headers: r.Header.Clone(), Body: body})
        mu.Unlock()
        w.WriteHeader(http.StatusAccepted)
    }))
    t.Cleanup(ts.Close)

    return ts, func() []recordedRequest {
        mu.Lock()
        defer mu.Unlock()
        return append([]recordedRequest(nil), recs...)
    }
}

func TestWebhookSender(t *testing.T) {
    ts, snapshot := newWebhookRecorder(t)
    sender := NewSender(ts.URL)
    sender.Send(context.Background(), Event{ID: "evt-1"})

    recs := snapshot()
    if len(recs) != 1 {
        t.Fatalf("got %d", len(recs))
    }
    if recs[0].Headers.Get("X-Signature") == "" {
        t.Fatal("no signature header")
    }
}
```

The `snapshot` closure is the cleanest way to expose the recorded state without leaking the mutex. Lock around appends because the underlying `http.Server` calls the handler in a goroutine per connection.

## Replaying canned responses

When you have a JSON contract from a partner that you must match exactly, store the canned responses as files and serve them from a tiny dispatcher.

```go
func canned(t *testing.T, dir string) *httptest.Server {
    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Map "/v1/orders/42" -> "v1_orders_42.json"
        name := strings.TrimPrefix(r.URL.Path, "/")
        name = strings.ReplaceAll(name, "/", "_") + ".json"
        body, err := os.ReadFile(filepath.Join(dir, name))
        if err != nil {
            http.NotFound(w, r)
            return
        }
        w.Header().Set("Content-Type", "application/json")
        w.Write(body)
    }))
    t.Cleanup(ts.Close)
    return ts
}
```

This is the standard-library equivalent of `go-vcr`'s "cassette" concept, without the YAML format. It's enough for most teams; reach for `go-vcr` only if you need to record real responses automatically.

## Multi-server fan-out

Some integration tests need several upstreams. Spawn each as its own `httptest.Server`.

```go
func TestFanout(t *testing.T) {
    auth := httptest.NewServer(authHandler)
    users := httptest.NewServer(usersHandler)
    billing := httptest.NewServer(billingHandler)

    t.Cleanup(auth.Close)
    t.Cleanup(users.Close)
    t.Cleanup(billing.Close)

    app := NewApp(Config{
        AuthURL:    auth.URL,
        UsersURL:   users.URL,
        BillingURL: billing.URL,
    })

    if err := app.HandleOrder(context.Background(), Order{ID: "o-1"}); err != nil {
        t.Fatal(err)
    }
}
```

Three takeaways.

1. Each server gets its own port; tests can run in parallel.
2. Each server can simulate latency, errors, or partial responses without affecting the others.
3. `t.Cleanup` keeps the teardown lines together at the top — easier to read than three `defer`s.

If your app is configured via DNS names instead of URLs, you'll need a custom `Resolver` or `Transport.DialContext` to redirect the lookup. That's a separate trick from `httptest`.

## Integration with go-vcr

`go-vcr` records real HTTP interactions on first run and replays them on subsequent runs. It works at the `http.RoundTripper` layer, so it's orthogonal to `httptest`. The two tools serve different needs:

- `httptest` — when the URL is configurable into the code under test.
- `go-vcr` — when the URL is hard-coded and you need to intercept the transport.

A common pattern is *both*: `httptest` for your own server-side handlers, `go-vcr` for outbound calls to third parties.

```go
func TestWithVCR(t *testing.T) {
    r, _ := recorder.New("fixtures/orders")
    defer r.Stop()

    client := &http.Client{Transport: r}
    // Call code that uses `client` and hits https://api.partner.example
    // First run records; subsequent runs replay.
}
```

Treat the recorded cassette as a fixture you commit to git. Sanitize tokens with a hook.

## Integration with gock

`gock` patches `http.DefaultTransport` to match URLs by pattern. It's similar to `nock` in JavaScript. Use it when:

- You cannot inject an `*http.Client`.
- You need declarative matchers (regex on URL, JSON body, headers).
- You don't want to write a handler.

```go
gock.New("https://api.partner.example").
    Get("/orders/42").
    Reply(200).
    JSON(map[string]string{"id": "42"})
defer gock.Off()

resp, _ := http.Get("https://api.partner.example/orders/42")
```

The trade-off: `gock` mutates global state. In parallel tests, mocks from one test leak into another. Prefer `httptest` if you can.

## Test doubles in middleware

Production middleware (rate-limiting, auth, observability) is best tested with `NewRecorder` plus a fake `next` handler that records what was passed.

```go
type captured struct {
    Ctx context.Context
    URL *url.URL
}

func captureHandler() (*captured, http.Handler) {
    c := &captured{}
    return c, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        c.Ctx = r.Context()
        c.URL = r.URL
        w.WriteHeader(http.StatusOK)
    })
}

func TestAuthMiddleware(t *testing.T) {
    cap, inner := captureHandler()
    mw := AuthMiddleware(inner)

    req := httptest.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer good-token")
    rec := httptest.NewRecorder()
    mw.ServeHTTP(rec, req)

    if rec.Code != 200 {
        t.Fatalf("status %d", rec.Code)
    }
    if v := cap.Ctx.Value(userKey{}); v != "alice" {
        t.Fatalf("user in context: %v", v)
    }
}
```

This pattern is sufficient for 95% of middleware tests. Reach for `NewServer` only when you need real TCP behavior (TLS termination, hijack, streaming).

## Production checklist

- [ ] Every `httptest.NewServer` or `httptest.NewTLSServer` is paired with `t.Cleanup(server.Close)`.
- [ ] Tests run green under `go test -race -count=10 ./...`.
- [ ] No production code path depends on `httptest`. The package belongs in test files only.
- [ ] Mutable handler state across parallel subtests is protected by `sync.Mutex` or `sync/atomic`.
- [ ] TLS tests use `server.Client()`, never `InsecureSkipVerify`.
- [ ] Tests do not depend on the public network. CI passes with no outbound DNS.
- [ ] Canned responses are versioned in-repo, not regenerated on every CI run.
- [ ] Long-running tests bound the handler with `r.Context()` and cancel via `CloseClientConnections`.

---

## Pagination boundary testing

Pagination is a category of bugs that hides in production. The pattern: a server returns lists in pages of N, with a `Link` header pointing to the next page. The client must walk all pages and stop when there's no `Link: rel="next"`.

Test by simulating a finite list and counting how many requests the client makes:

```go
func TestPaginationClient(t *testing.T) {
    items := make([]int, 250)
    for i := range items {
        items[i] = i
    }
    pageSize := 100

    var requestCount atomic.Int64

    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        requestCount.Add(1)
        page, _ := strconv.Atoi(r.URL.Query().Get("page"))
        if page == 0 {
            page = 1
        }
        start := (page - 1) * pageSize
        end := start + pageSize
        if end > len(items) {
            end = len(items)
        }
        if start >= len(items) {
            w.WriteHeader(http.StatusNotFound)
            return
        }
        if end < len(items) {
            w.Header().Set("Link", fmt.Sprintf(`<%s?page=%d>; rel="next"`, r.URL.Path, page+1))
        }
        json.NewEncoder(w).Encode(items[start:end])
    }))
    t.Cleanup(ts.Close)

    all, err := WalkPaginated(ts.Client(), ts.URL+"/items")
    if err != nil {
        t.Fatal(err)
    }
    if len(all) != 250 {
        t.Fatalf("got %d items", len(all))
    }
    if n := requestCount.Load(); n != 3 {
        t.Fatalf("requests = %d, want 3", n)
    }
}
```

The test asserts both correctness (all 250 items returned) and efficiency (exactly 3 requests). A naïve client that re-fetches page 1 would fail the second assertion.

Edge cases worth testing:

- Empty list (zero pages).
- Exact page-size multiple (300 items, page size 100 — 3 pages, no overflow).
- Off-by-one boundary (101 items, page size 100 — should make 2 requests).
- Page server returns no `Link` header → client must not request another page.

---

## Idempotency-key middleware

A `POST /payments` endpoint that accepts an `Idempotency-Key` header. Repeated calls with the same key should return the original response, not create a duplicate payment.

Production test:

```go
type idempotentStore struct {
    mu      sync.Mutex
    results map[string][]byte
}

func IdempotencyMiddleware(s *idempotentStore) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            key := r.Header.Get("Idempotency-Key")
            if key == "" {
                next.ServeHTTP(w, r)
                return
            }
            s.mu.Lock()
            cached, ok := s.results[key]
            s.mu.Unlock()
            if ok {
                w.Write(cached)
                return
            }
            rec := httptest.NewRecorder()
            next.ServeHTTP(rec, r)
            body := rec.Body.Bytes()
            s.mu.Lock()
            s.results[key] = body
            s.mu.Unlock()
            w.Write(body)
        })
    }
}

func TestIdempotency(t *testing.T) {
    var created atomic.Int64

    inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        n := created.Add(1)
        fmt.Fprintf(w, `{"id":%d}`, n)
    })

    store := &idempotentStore{results: map[string][]byte{}}
    mw := IdempotencyMiddleware(store)(inner)

    ts := httptest.NewServer(mw)
    t.Cleanup(ts.Close)

    var got [3]string
    for i := 0; i < 3; i++ {
        req, _ := http.NewRequest("POST", ts.URL+"/pay", nil)
        req.Header.Set("Idempotency-Key", "key-1")
        resp, _ := ts.Client().Do(req)
        body, _ := io.ReadAll(resp.Body)
        resp.Body.Close()
        got[i] = string(body)
    }

    if got[0] != got[1] || got[1] != got[2] {
        t.Fatalf("responses differ: %v", got)
    }
    if n := created.Load(); n != 1 {
        t.Fatalf("inner called %d times, want 1", n)
    }
}
```

Note the use of `httptest.NewRecorder` inside the middleware — yes, you can use it in production code, not just tests, as a way to capture a handler's output before forwarding. It's a legitimate pattern.

---

## Distributed tracing propagation

Modern systems propagate trace context via the W3C `traceparent` header. Test that your code does this end-to-end.

```go
func TestTracingPropagates(t *testing.T) {
    var receivedHeader string
    var receivedMutex sync.Mutex

    downstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        receivedMutex.Lock()
        receivedHeader = r.Header.Get("Traceparent")
        receivedMutex.Unlock()
        w.WriteHeader(http.StatusOK)
    }))
    t.Cleanup(downstream.Close)

    upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        req, _ := http.NewRequestWithContext(r.Context(), "GET", downstream.URL, nil)
        req.Header.Set("Traceparent", r.Header.Get("Traceparent"))
        resp, err := http.DefaultClient.Do(req)
        if err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }
        resp.Body.Close()
    }))
    t.Cleanup(upstream.Close)

    req, _ := http.NewRequest("GET", upstream.URL, nil)
    req.Header.Set("Traceparent", "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")
    resp, _ := upstream.Client().Do(req)
    resp.Body.Close()

    receivedMutex.Lock()
    defer receivedMutex.Unlock()
    if receivedHeader == "" {
        t.Fatal("downstream did not see Traceparent")
    }
    if !strings.HasPrefix(receivedHeader, "00-0af7651916cd43dd8448eb211c80319c") {
        t.Fatalf("trace id changed: %q", receivedHeader)
    }
}
```

In real OpenTelemetry code, the SDK handles propagation automatically. Your test would assert the trace ID survives, perhaps with a span ID that changes (since each hop creates a new span).

---

## Health-check probe testing

Health probes are deceptively easy to get wrong. The standard production pattern:

- `/healthz` — liveness — returns 200 unless the process is hung.
- `/readyz` — readiness — returns 200 only when downstream dependencies are healthy.

A common bug: `/readyz` returns 200 even when the database is down because the check is shallow. Test by mocking each dependency.

```go
func TestReadyz(t *testing.T) {
    db := &fakeDB{healthy: true}
    cache := &fakeCache{healthy: true}

    handler := ReadyzHandler(db, cache)

    rec := httptest.NewRecorder()
    handler.ServeHTTP(rec, httptest.NewRequest("GET", "/readyz", nil))
    if rec.Code != http.StatusOK {
        t.Fatalf("healthy = %d", rec.Code)
    }

    db.healthy = false
    rec = httptest.NewRecorder()
    handler.ServeHTTP(rec, httptest.NewRequest("GET", "/readyz", nil))
    if rec.Code != http.StatusServiceUnavailable {
        t.Fatalf("db unhealthy = %d", rec.Code)
    }
}
```

For probes that talk to *real* HTTP dependencies (e.g. a downstream API's `/healthz`), use `httptest.NewServer`:

```go
func TestReadyz_DownstreamUnhealthy(t *testing.T) {
    var downstreamHealthy atomic.Bool
    downstreamHealthy.Store(true)

    downstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if downstreamHealthy.Load() {
            w.WriteHeader(http.StatusOK)
        } else {
            w.WriteHeader(http.StatusServiceUnavailable)
        }
    }))
    t.Cleanup(downstream.Close)

    handler := ReadyzWithDownstream(downstream.URL + "/healthz")
    rec := httptest.NewRecorder()
    handler.ServeHTTP(rec, httptest.NewRequest("GET", "/readyz", nil))
    if rec.Code != http.StatusOK {
        t.Fatalf("got %d", rec.Code)
    }

    downstreamHealthy.Store(false)
    rec = httptest.NewRecorder()
    handler.ServeHTTP(rec, httptest.NewRequest("GET", "/readyz", nil))
    if rec.Code != http.StatusServiceUnavailable {
        t.Fatalf("got %d", rec.Code)
    }
}
```

`atomic.Bool` is the cleanest way to flip a handler's behavior mid-test without a race.

---

## Circuit-breaker tests

A circuit breaker opens after N consecutive failures and closes after a cooldown. Testing it requires controlling time.

The breaker:

```go
type Breaker struct {
    threshold int
    cooldown  time.Duration
    failures  atomic.Int64
    openedAt  atomic.Int64 // unix nano
    now       func() time.Time
}

func (b *Breaker) Allow() bool {
    if openedAt := b.openedAt.Load(); openedAt > 0 {
        if b.now().UnixNano()-openedAt < int64(b.cooldown) {
            return false
        }
        b.openedAt.Store(0) // half-open: allow one trial
        b.failures.Store(0)
    }
    return true
}

func (b *Breaker) Record(success bool) {
    if success {
        b.failures.Store(0)
        return
    }
    if int(b.failures.Add(1)) >= b.threshold {
        b.openedAt.Store(b.now().UnixNano())
    }
}
```

The middleware wraps an `http.Client`-style call. Test by injecting a fake clock:

```go
func TestBreaker_OpensAfterFailures(t *testing.T) {
    now := time.Now()
    b := &Breaker{
        threshold: 3,
        cooldown:  time.Second,
        now:       func() time.Time { return now },
    }

    for i := 0; i < 3; i++ {
        if !b.Allow() {
            t.Fatalf("breaker open at i=%d", i)
        }
        b.Record(false)
    }
    if b.Allow() {
        t.Fatal("breaker should be open")
    }

    // Advance time past cooldown.
    now = now.Add(2 * time.Second)
    if !b.Allow() {
        t.Fatal("breaker should be half-open")
    }
}
```

Integration with `httptest`:

```go
func TestBreaker_HTTPIntegration(t *testing.T) {
    var failNext atomic.Bool
    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if failNext.Load() {
            http.Error(w, "fail", http.StatusInternalServerError)
            return
        }
        w.WriteHeader(http.StatusOK)
    }))
    t.Cleanup(ts.Close)

    now := time.Now()
    b := &Breaker{threshold: 3, cooldown: time.Second, now: func() time.Time { return now }}
    failNext.Store(true)
    client := BreakerClient(ts.Client(), b)

    for i := 0; i < 3; i++ {
        resp, _ := client.Get(ts.URL)
        if resp != nil {
            resp.Body.Close()
        }
    }

    // Fourth request: breaker should refuse without hitting the server.
    var requestsAfter atomic.Int64
    ts.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        requestsAfter.Add(1)
        w.WriteHeader(http.StatusOK)
    })

    _, err := client.Get(ts.URL)
    if err == nil {
        t.Fatal("expected breaker error")
    }
    if requestsAfter.Load() != 0 {
        t.Fatal("request hit server despite open breaker")
    }
}
```

Note: `ts.Config.Handler` assignment after `Start` is not officially supported. The right way is to swap the handler with a wrapper that delegates:

```go
type swappableHandler struct {
    h atomic.Pointer[http.Handler]
}

func (s *swappableHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    h := *s.h.Load()
    h.ServeHTTP(w, r)
}
```

Then store the initial handler at start, swap atomically during the test.

---

## Production checklist (extended)

In addition to the checklist above:

- [ ] Every middleware has a unit test using `httptest.NewRecorder` with a stub `next`.
- [ ] Every outbound HTTP call has an integration test using `httptest.NewServer` for the dependency.
- [ ] Health probes are tested for both healthy and unhealthy states of each dependency.
- [ ] Retry, circuit-breaker, and rate-limit middleware are tested with deterministic clocks (injected `now func() time.Time`).
- [ ] Authentication failures are tested for all 401 paths (missing, invalid, expired, malformed).
- [ ] Pagination clients are tested for empty, full, and boundary cases.
- [ ] Idempotency middleware is tested for repeated calls with the same key.
- [ ] Trace context propagation is asserted end-to-end (`traceparent` header survives a hop).
- [ ] TLS hostname mismatches and expired certs are tested at least once (using a custom `tls.Config`).
- [ ] No test depends on `time.Sleep` longer than 100ms. If it does, refactor the production code to accept an injectable clock or timeout.

A team that follows this list will have a test suite that runs under 30 seconds, finds bugs before staging, and doesn't flake.

---

[← Back](../)
