---
layout: default
title: httptest — Tasks
parent: net/http/httptest
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/04-httptest/tasks/
---

# httptest — Tasks

[← Back](../)

Hands-on exercises that move from the simplest `ResponseRecorder` test to a multi-server fan-out. Solve them in order. Each task has a description, a starter handler or client, and an explicit acceptance criterion. Aim to finish each task in under twenty minutes; if you take longer, re-read the relevant section in `junior.md` or `middle.md`.

## Task 1 — Test a handler with NewRecorder

Goal. Write the smallest possible handler test using `httptest.NewRecorder` and `httptest.NewRequest`.

The handler:

```go
func HelloHandler(w http.ResponseWriter, r *http.Request) {
    name := r.URL.Query().Get("name")
    if name == "" {
        name = "world"
    }
    fmt.Fprintf(w, "hello, %s", name)
}
```

Requirements.

1. Use `httptest.NewRequest("GET", "/?name=Ada", nil)`.
2. Use `httptest.NewRecorder()`.
3. Call `HelloHandler(rec, req)` directly.
4. Assert `rec.Code == 200`.
5. Assert `rec.Body.String() == "hello, Ada"`.

Acceptance.

```
PASS: TestHelloHandler (0.00s)
```

Use `go test -run TestHelloHandler -v`.

## Task 2 — Test a client against NewServer

Goal. Write a function that fetches a JSON object from a URL and decodes it. Test it against `httptest.NewServer`.

The function:

```go
type User struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
}

func FetchUser(client *http.Client, baseURL string, id int) (*User, error) {
    resp, err := client.Get(fmt.Sprintf("%s/users/%d", baseURL, id))
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
    }
    var u User
    if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
        return nil, err
    }
    return &u, nil
}
```

Requirements.

1. Build a test server with `httptest.NewServer` whose handler returns `{"id":42,"name":"Ada"}` for `/users/42` and 404 otherwise.
2. Register `t.Cleanup(server.Close)`.
3. Call `FetchUser(http.DefaultClient, server.URL, 42)` and assert the returned `*User`.
4. Add a sub-test that requests `/users/99` and expects an error.

Acceptance.

```
=== RUN   TestFetchUser
=== RUN   TestFetchUser/found
=== RUN   TestFetchUser/not_found
--- PASS: TestFetchUser (0.00s)
```

## Task 3 — Test a TLS handshake

Goal. Show that `httptest.NewTLSServer` rejects clients without the test cert and accepts `server.Client()`.

Setup.

```go
ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusNoContent)
}))
t.Cleanup(ts.Close)
```

Requirements.

1. Call `http.Get(ts.URL)` with the default client. Assert the returned error contains `"certificate signed by unknown authority"`.
2. Call `ts.Client().Get(ts.URL)`. Assert no error and `resp.StatusCode == 204`.
3. Bonus: build a custom `*http.Client` whose `Transport.TLSClientConfig.RootCAs` includes `ts.Certificate()` and verify it also succeeds.

Acceptance. Both positive sub-tests pass; the negative sub-test asserts on the error message.

## Task 4 — Build a redirect-chain test

Goal. Test a client that must follow exactly three redirects.

Server.

```go
mux := http.NewServeMux()
mux.HandleFunc("/a", func(w http.ResponseWriter, r *http.Request) {
    http.Redirect(w, r, "/b", http.StatusFound)
})
mux.HandleFunc("/b", func(w http.ResponseWriter, r *http.Request) {
    http.Redirect(w, r, "/c", http.StatusFound)
})
mux.HandleFunc("/c", func(w http.ResponseWriter, r *http.Request) {
    http.Redirect(w, r, "/d", http.StatusFound)
})
mux.HandleFunc("/d", func(w http.ResponseWriter, r *http.Request) {
    fmt.Fprint(w, "done")
})
ts := httptest.NewServer(mux)
t.Cleanup(ts.Close)
```

Requirements.

1. Use the default `http.Client` (which follows up to 10 redirects).
2. Issue `GET /a` and assert the final body is `"done"`.
3. Configure a second client with `CheckRedirect: func(...) error { return http.ErrUseLastResponse }`. Assert it stops at `/a` and the response has `Location: /b`.
4. Configure a third client whose `CheckRedirect` returns an error after the second redirect. Assert the returned error wraps `http.Client`'s error type.

Acceptance. Three sub-tests, all PASS.

## Task 5 — Middleware that injects a request ID

Goal. Test a middleware that adds an `X-Request-ID` header to the response and propagates it through `r.Context()` to the next handler.

Middleware sketch.

```go
type reqIDKey struct{}

func RequestID(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Request-ID")
        if id == "" {
            id = "test-id"
        }
        w.Header().Set("X-Request-ID", id)
        ctx := context.WithValue(r.Context(), reqIDKey{}, id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

Requirements.

1. Use `NewRecorder` only — no server.
2. Wrap a tiny inner handler that asserts `r.Context().Value(reqIDKey{}) == "test-id"`.
3. Assert `rec.Header().Get("X-Request-ID") == "test-id"`.
4. Add a second sub-test that pre-sets `X-Request-ID: from-client` on the request and verifies it round-trips.

Acceptance. Both sub-tests pass; `rec.Code == 200`.

## Task 6 — Race-detector sweep

Goal. Run the entire test suite from Tasks 1-5 with `-race -count=10` and confirm no race detector hits.

Requirements.

1. Add `t.Parallel()` to every test function in the suite.
2. Add `t.Cleanup` instead of `defer` for every `server.Close()`.
3. Run `go test -race -count=10 ./...`. Assert "ok" with no `WARNING: DATA RACE` output.

Acceptance.

```
ok      yourmodule/path     0.300s
```

## Task 7 — Replay canned responses

Goal. Build a tiny canned-response server keyed by URL path.

API.

```go
func CannedServer(t *testing.T, responses map[string]string) *httptest.Server {
    h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        body, ok := responses[r.URL.Path]
        if !ok {
            http.NotFound(w, r)
            return
        }
        fmt.Fprint(w, body)
    })
    ts := httptest.NewServer(h)
    t.Cleanup(ts.Close)
    return ts
}
```

Requirements.

1. Write a test that uses `CannedServer` with three paths.
2. Each sub-test should `t.Parallel()`.
3. Assert each path returns the expected body and status.

Acceptance. Three sub-tests, all PASS, run under `-race`.

## Stretch — Server with `EnableHTTP2`

Build an unstarted server, set `EnableHTTP2 = true`, call `StartTLS`, and assert via `resp.Proto == "HTTP/2.0"`. This requires importing `golang.org/x/net/http2` only if you need to inspect frames; for the protocol check, `ts.Client()` is sufficient.

## Task 8 — Test a context-cancellation handler

Goal. Verify that a handler returns early when the client cancels.

The handler:

```go
func LongHandler(w http.ResponseWriter, r *http.Request) {
    select {
    case <-time.After(5 * time.Second):
        fmt.Fprint(w, "late")
    case <-r.Context().Done():
        return
    }
}
```

Requirements.

1. Start the server with `httptest.NewServer(LongHandler)`.
2. Issue a request with `context.WithCancel`.
3. Cancel after 50ms.
4. Assert the request returns within 200ms (not 5 seconds).
5. Use a `sync.WaitGroup` or done-channel to know when the handler actually returns.

Acceptance. Test completes under 500ms total.

## Task 9 — Test a streaming JSON producer

Goal. Test a handler that emits a JSON array element-by-element using a `json.Encoder` and `Flusher`.

Handler.

```go
func StreamJSON(w http.ResponseWriter, r *http.Request) {
    flusher := w.(http.Flusher)
    w.Header().Set("Content-Type", "application/x-ndjson")
    enc := json.NewEncoder(w)
    for i := 0; i < 5; i++ {
        enc.Encode(map[string]int{"i": i})
        flusher.Flush()
    }
}
```

Requirements.

1. Start the handler in a `httptest.NewServer`.
2. Read the response with a `bufio.Scanner` line-by-line.
3. Decode each line into a `map[string]int`.
4. Assert exactly 5 objects, each with the correct `i` value.

Acceptance.

```
=== RUN   TestStreamJSON
--- PASS: TestStreamJSON (0.00s)
```

## Task 10 — Test middleware composition order

Goal. Three middlewares, in order: `A`, `B`, `C`. Each appends a token to a header. The expected final value is `"A B C"`.

Setup.

```go
func appender(token string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            v := r.Header.Get("X-Trace")
            if v != "" {
                v += " "
            }
            v += token
            r.Header.Set("X-Trace", v)
            next.ServeHTTP(w, r)
        })
    }
}
```

Requirements.

1. Compose: `appender("A")(appender("B")(appender("C")(inner)))`.
2. The inner handler echoes `X-Trace` into the response.
3. Test that the response body is `"A B C"`.
4. Bonus: test that reversing the order gives `"C B A"`.

Acceptance. Two sub-tests, both PASS.

## Task 11 — Test connection-reuse behavior

Goal. Demonstrate that `ts.Client()` reuses connections by default.

Requirements.

1. Build a handler that records `r.RemoteAddr` (port differs per connection).
2. Issue 5 requests with `ts.Client()`.
3. Collect all observed `RemoteAddr` values.
4. Assert that exactly one unique remote port appears (connection was reused).
5. Build a second client with `Transport.DisableKeepAlives = true`. Issue 5 requests. Assert 5 unique ports.

Acceptance. Both assertions hold; tests pass under `-race`.

## Task 12 — Goleak integration

Goal. Add `goleak` to the test suite from previous tasks and verify no goroutine leaks.

Requirements.

1. Add `import "go.uber.org/goleak"` to a single `TestMain`.
2. Call `goleak.VerifyTestMain(m)`.
3. Run the full suite. Verify exit code is 0.
4. Introduce a deliberate leak in one task (start a goroutine that never returns). Verify goleak fails.

Acceptance. With the leak, exit code is non-zero; output mentions the leaked stack.

## Task 13 — Compare NewRecorder and NewServer cost

Goal. Write two benchmarks comparing the cost per request of `NewRecorder` vs `NewServer`.

Setup.

```go
func BenchmarkRecorder(b *testing.B) {
    req := httptest.NewRequest("GET", "/", nil)
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        rec := httptest.NewRecorder()
        MyHandler(rec, req)
    }
}

func BenchmarkServer(b *testing.B) {
    ts := httptest.NewServer(http.HandlerFunc(MyHandler))
    defer ts.Close()
    client := ts.Client()
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        resp, _ := client.Get(ts.URL)
        io.Copy(io.Discard, resp.Body)
        resp.Body.Close()
    }
}
```

Requirements.

1. Run both with `go test -bench=. -benchmem -count=5`.
2. Record ns/op and allocs/op for each.
3. Compare with `benchstat`.
4. Write a one-paragraph summary of the gap.

Acceptance. The recorder benchmark should be 10-50x faster per op.

---

[← Back](../)
