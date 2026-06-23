---
layout: default
title: httptest — Find the Bug
parent: net/http/httptest
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/04-httptest/find-bug/
---

# httptest — Find the Bug

[← Back](../)

Each block presents a test that *looks* correct, then asks a single question: *what breaks?* The answers are immediately below — but try first. Bugs are drawn from real CI failures.

## Bug 1 — Missing server.Close

```go
func TestUserAPI(t *testing.T) {
    h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprint(w, `{"ok":true}`)
    })
    ts := httptest.NewServer(h)

    resp, err := http.Get(ts.URL)
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    // ... assertions
}
```

What's wrong?

The test never calls `ts.Close()`. Each invocation leaks one listener and one accept-loop goroutine. With `go test -count=100` you'll exhaust ephemeral ports and your colleagues will hate you. Fix: `t.Cleanup(ts.Close)` right after `httptest.NewServer`.

## Bug 2 — Shared server across parallel subtests, mutated state

```go
type counterHandler struct{ n int }

func (h *counterHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    h.n++
    fmt.Fprintf(w, "%d", h.n)
}

func TestCounter(t *testing.T) {
    h := &counterHandler{}
    ts := httptest.NewServer(h)
    t.Cleanup(ts.Close)

    for i := 0; i < 5; i++ {
        i := i
        t.Run(fmt.Sprintf("req-%d", i), func(t *testing.T) {
            t.Parallel()
            resp, _ := http.Get(ts.URL)
            defer resp.Body.Close()
            // ...
        })
    }
}
```

What's wrong?

`counterHandler.n` is incremented from multiple goroutines (each connection runs in its own). The race detector flags it. Either guard `n` with `sync/atomic` (`atomic.Int64`) or use a `sync.Mutex`. The bug is *in the handler*, but it only manifests because parallel subtests amplify concurrency.

## Bug 3 — Using actual network instead of httptest

```go
func TestProductionAPI(t *testing.T) {
    resp, err := http.Get("https://api.example.com/users/1")
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    var u User
    json.NewDecoder(resp.Body).Decode(&u)
    if u.Name != "Ada" {
        t.Fatalf("got %q", u.Name)
    }
}
```

What's wrong?

This isn't a unit test — it's a flaky end-to-end test against a public endpoint. The CI is at the mercy of TLS expirations, rate limits, and the team that owns `api.example.com`. Replace with `httptest.NewServer` returning canned JSON, and make the base URL injectable into the code under test.

## Bug 4 — Reading body after server.Close

```go
ts := httptest.NewServer(...)
resp, _ := http.Get(ts.URL)
ts.Close()
body, _ := io.ReadAll(resp.Body)
fmt.Println(string(body))
```

What's wrong?

`Server.Close` closes the listener and calls `Shutdown`, which closes any open connections. The body read may succeed if the response was already buffered into the client's internal buffer, *or* may return `read: connection reset` depending on timing. Read and close `resp.Body` *before* closing the server.

## Bug 5 — defer ts.Close inside parallel subtest spawner

```go
func TestParallelClients(t *testing.T) {
    ts := httptest.NewServer(handler)
    defer ts.Close()

    for i := 0; i < 3; i++ {
        i := i
        t.Run(fmt.Sprintf("%d", i), func(t *testing.T) {
            t.Parallel()
            _, _ = http.Get(ts.URL)
        })
    }
}
```

What's wrong?

`t.Parallel` deferrs the subtests until the parent returns. But `defer ts.Close()` runs *when the parent returns*, before the parallel subtests execute. The subtests hit a closed server. Replace `defer` with `t.Cleanup` — `Cleanup` waits for all subtests, including parallel ones.

## Bug 6 — Forgetting to set Host on cross-domain assertions

```go
req := httptest.NewRequest("POST", "/login", strings.NewReader("user=ada"))
req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
LoginHandler(rec, req)
// later assertion:
if req.Host != "auth.example.com" {
    t.Fatal("Host should be auth.example.com")
}
```

What's wrong?

`httptest.NewRequest("POST", "/login", ...)` sets `Host` to `"example.com"`. If your handler routes on `Host`, you must pass an absolute URL: `httptest.NewRequest("POST", "http://auth.example.com/login", ...)`. The bug is misdiagnosed — the handler isn't broken; the test built the wrong request.

## Bug 7 — RecordHeader assertions on canonicalised case

```go
rec := httptest.NewRecorder()
handler(rec, req)
if rec.Header().Get("x-request-id") == "" { // looks fine
    t.Fatal("missing X-Request-ID")
}
if _, ok := rec.HeaderMap["x-request-id"]; !ok {
    t.Fatal("missing header in map")
}
```

What's wrong?

`http.Header` keys are canonicalised by `MIMEHeader` rules — `X-Request-Id`, not `x-request-id`. The map lookup fails; the `Get` call succeeds because `Get` canonicalises. Use `Get` consistently or use the canonical form (`"X-Request-Id"`) when indexing the map directly.

## Bug 8 — Using http.DefaultClient against a TLS test server

```go
ts := httptest.NewTLSServer(handler)
t.Cleanup(ts.Close)

resp, err := http.DefaultClient.Get(ts.URL)
if err != nil {
    t.Fatal(err) // x509: certificate signed by unknown authority
}
```

What's wrong?

The self-signed cert isn't in the default root pool. Use `ts.Client()` instead, which has the cert injected. Do *not* set `InsecureSkipVerify` — that would mask real verification bugs in production code paths.

## Bug 9 — Body.Close on a nil body

```go
req := httptest.NewRequest("GET", "/", nil)
defer req.Body.Close()
```

What's wrong?

`httptest.NewRequest` sets `Body` to `http.NoBody`, which has a `Close` returning `nil`. The line is actually safe — but if you ever swap `httptest.NewRequest` for `http.NewRequest` (where `Body` is `nil` for a `nil` reader), the deferred call panics. Always read the docs of the constructor you're using.

## Bug 10 — Leaking goroutines via long-poll handlers

```go
func longPoll(w http.ResponseWriter, r *http.Request) {
    select {
    case <-time.After(30 * time.Second):
        fmt.Fprint(w, "done")
    case <-r.Context().Done():
        return
    }
}
ts := httptest.NewServer(http.HandlerFunc(longPoll))
t.Cleanup(ts.Close)
```

What's wrong?

`ts.Close` calls `Shutdown`, which waits for all handlers to return. The `time.After(30 * time.Second)` keeps the handler alive for the full thirty seconds — your test takes thirty seconds to clean up. The fix is to bound the wait with `r.Context()` *and* to make the test trigger cancellation by closing the client connection (`ts.CloseClientConnections()` before `ts.Close()`).

## Bug 11 — Asserting on response body after server.Close

```go
ts := httptest.NewServer(handler)
resp, _ := http.Get(ts.URL)
ts.Close()
defer resp.Body.Close()

body, _ := io.ReadAll(resp.Body)
if string(body) != "expected" {
    t.Fatal("mismatch")
}
```

What's wrong?

`ts.Close()` closes any open connections. If the body wasn't fully buffered into the client's internal buffer, the read returns `connection reset by peer` — but the test ignores the error from `io.ReadAll`. Symptom: intermittent failures on slower machines where the body hadn't arrived. Fix: read the body fully *before* `Close`.

## Bug 12 — Capturing a loop variable into a handler

```go
for _, path := range []string{"/a", "/b", "/c"} {
    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprint(w, path)
    }))
    t.Cleanup(ts.Close)
    resp, _ := http.Get(ts.URL)
    body, _ := io.ReadAll(resp.Body)
    if string(body) != path {
        t.Errorf("got %q, want %q", body, path)
    }
}
```

What's wrong?

Pre-Go 1.22, the closure captures the *variable* `path`, not its value. By the time the handler runs (potentially after a few goroutine schedules), `path` may have advanced. Symptom: races and wrong assertions. Fix: capture explicitly with `path := path` at the top of the loop body. Go 1.22+ changes the semantics — loop variables are per-iteration — but cross-version code should still capture defensively.

## Bug 13 — Reading req.Body twice

```go
func TestHandler(t *testing.T) {
    body := strings.NewReader(`{"name":"Ada"}`)
    req := httptest.NewRequest("POST", "/", body)

    raw, _ := io.ReadAll(req.Body)
    t.Logf("body: %s", raw)

    rec := httptest.NewRecorder()
    Handler(rec, req)

    if rec.Code != 200 {
        t.Fatal("expected 200")
    }
}
```

What's wrong?

`io.ReadAll(req.Body)` drains the body. When `Handler` then reads `req.Body`, it gets EOF. The handler thinks the request had no body. Symptom: a handler that returns 400 ("missing field") when the test expected 200. Fix: don't read the body in the test, or re-seek/reset it. For `strings.NewReader`, calling `Seek(0, io.SeekStart)` works; better, log without reading.

## Bug 14 — Header set after WriteHeader

```go
func Handler(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    w.Header().Set("X-Foo", "bar") // too late
    fmt.Fprint(w, "ok")
}

func TestHandler(t *testing.T) {
    rec := httptest.NewRecorder()
    Handler(rec, httptest.NewRequest("GET", "/", nil))

    if rec.Header().Get("X-Foo") != "bar" {
        t.Fatal("missing header")
    }
}
```

What's wrong?

Setting a header *after* `WriteHeader` has no effect — the headers were flushed when `WriteHeader` was called. But `ResponseRecorder` is permissive: it still allows `Header().Set` and the assertion passes locally. In production (real server), the header doesn't make it to the client. Symptom: passing test, failing browser. The bug is in the handler; the test masks it.

Two fixes: set the header *before* `WriteHeader`, and consider a stricter recorder wrapper that panics on post-write header mutations.

## Bug 15 — Using net.DefaultResolver in tests

```go
func TestExternalAPI(t *testing.T) {
    resp, err := http.Get("https://api.example.com/users/1")
    if err != nil {
        t.Skip("offline; skipping")
    }
    // ...
}
```

What's wrong?

Tests that `t.Skip` when offline are tests that don't run on CI. They will rot. Replace with `httptest.NewServer` and remove the external dependency. A test you can run anywhere is a test that catches bugs.

---

## Bonus — five more in 30 seconds each

**Bug A.** Setting `req.URL.RawQuery = "name=Ada"` *after* the handler reads `r.URL.Query()`. Order matters; queries are parsed lazily.

**Bug B.** `ts.URL + "users"` (missing slash) results in a URL `http://127.0.0.1:portusers`. Always use `ts.URL + "/users"`.

**Bug C.** `rec.HeaderMap["X-Foo"] = []string{"bar"}` after the handler has called `Header().Set` may overwrite or duplicate. Use `Set` consistently.

**Bug D.** A test that uses `httptest.NewServer` but checks `if resp.StatusCode != 200` without first checking `err`. If `Get` failed, `resp` is nil; the next line panics.

**Bug E.** A `for _, tc := range tests` loop that uses `t.Parallel()` but shares a `ts` declared in the outer scope. If a test mutates server state, others see it.

## Bug 16 — Asserting on body before checking err

```go
resp, err := ts.Client().Get(ts.URL)
defer resp.Body.Close() // PANIC if err is non-nil
if err != nil {
    t.Fatal(err)
}
```

What's wrong?

When `Get` errors, `resp` is `nil`. `resp.Body` panics with a nil-pointer dereference. The `defer` is reached before the `nil` check. Fix: move `defer` after the error check.

```go
resp, err := ts.Client().Get(ts.URL)
if err != nil {
    t.Fatal(err)
}
defer resp.Body.Close()
```

## Bug 17 — Hidden time dependency

```go
func TestRateLimit(t *testing.T) {
    l := NewLimiter(3) // 3 per second
    ts := httptest.NewServer(RateLimit(l)(handler))
    t.Cleanup(ts.Close)

    var ok int
    for i := 0; i < 5; i++ {
        resp, _ := ts.Client().Get(ts.URL)
        resp.Body.Close()
        if resp.StatusCode == 200 {
            ok++
        }
    }
    if ok != 3 {
        t.Fatalf("ok = %d", ok)
    }
}
```

What's wrong?

The test makes five requests with no synchronisation. On a slow CI machine, the requests may span more than one second, so the bucket refills and *all five* succeed. The test passes locally and fails in CI (or vice versa). Fix: inject a clock into the limiter and freeze time.

## Bug 18 — `select` on closed channel masking missed signal

```go
done := make(chan struct{})
ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    close(done)
    w.WriteHeader(200)
}))
t.Cleanup(ts.Close)

select {
case <-done:
    // test continues
case <-time.After(50 * time.Millisecond):
    t.Fatal("handler did not run")
}
```

What's wrong?

The test issues no request. Of course the handler doesn't run. The `select` waits 50ms then fails. This is a classic copy-paste error: someone removed the `http.Get` call and forgot to remove the synchronisation. Always trace the data flow.

## Bug 19 — Wrong handler for the path

```go
mux := http.NewServeMux()
mux.HandleFunc("/users", listUsers)
mux.HandleFunc("/users/", getUser) // catches "/users/42"

ts := httptest.NewServer(mux)
t.Cleanup(ts.Close)

resp, _ := ts.Client().Get(ts.URL + "/users/")
// expected listUsers, got getUser with empty id
```

What's wrong?

`http.ServeMux` matches the longest prefix. `/users/` matches `getUser` (with the catch-all). The intent was `listUsers` for `/users` (no trailing slash). Fix: pick consistent path semantics, document them, and test both `/users` and `/users/` explicitly.

## Bug 20 — Forgotten t.Helper

```go
func assertJSON(t *testing.T, body []byte, want any) {
    var got any
    if err := json.Unmarshal(body, &got); err != nil {
        t.Fatalf("unmarshal: %v", err) // points to this line, not the caller
    }
    if !reflect.DeepEqual(got, want) {
        t.Fatalf("got %v, want %v", got, want)
    }
}
```

What's wrong?

Missing `t.Helper()`. When the helper fails, the test output points to `assertJSON`, not to the caller. You waste time finding which test failed. Fix:

```go
func assertJSON(t *testing.T, body []byte, want any) {
    t.Helper()
    // ...
}
```

## Bug 21 — Asserting on Status text instead of code

```go
if !strings.Contains(rec.Body.String(), "Not Found") {
    t.Fatal("expected not found")
}
```

What's wrong?

The body may contain `"Not Found"` for reasons unrelated to status (e.g. the API returned `{"error":"Resource Not Found"}` with a 200 status because of a misconfigured error handler). Always assert on the status code first.

```go
if rec.Code != http.StatusNotFound {
    t.Fatalf("code = %d", rec.Code)
}
```

## Bug 22 — Forgetting that NewRecorder doesn't truncate

```go
func TestTwoCalls(t *testing.T) {
    rec := httptest.NewRecorder()

    h1(rec, httptest.NewRequest("GET", "/", nil))
    if rec.Code != 200 {
        t.Fatalf("h1 code = %d", rec.Code)
    }

    h2(rec, httptest.NewRequest("GET", "/", nil))
    if rec.Body.String() != "h2 body" {
        t.Fatalf("h2 body = %q", rec.Body.String()) // includes h1's body too
    }
}
```

What's wrong?

The recorder accumulates writes. The body after `h2` includes whatever `h1` wrote. The right fix is to use a fresh recorder per call. If you must reuse, reset `rec.Body.Reset()`.

## Bug 23 — Server doesn't respect Accept header in tests

```go
// Handler:
func h(w http.ResponseWriter, r *http.Request) {
    if r.Header.Get("Accept") == "application/xml" {
        w.Header().Set("Content-Type", "application/xml")
        fmt.Fprint(w, "<root/>")
        return
    }
    w.Header().Set("Content-Type", "application/json")
    fmt.Fprint(w, `{}`)
}

// Test:
func TestXML(t *testing.T) {
    rec := httptest.NewRecorder()
    h(rec, httptest.NewRequest("GET", "/", nil)) // no Accept header
    if rec.Header().Get("Content-Type") != "application/xml" {
        t.Fatalf("ct = %q", rec.Header().Get("Content-Type"))
    }
}
```

What's wrong?

The test forgot to set `Accept: application/xml`. The handler correctly returned JSON; the test wrongly expected XML. Read your test as if you were a fresh visitor — does the input justify the expected output?

## Bug 24 — Race between handler and assertion

```go
var captured string
ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    captured = r.Header.Get("X-Foo") // RACE: no synchronisation
    w.WriteHeader(200)
}))
t.Cleanup(ts.Close)

resp, _ := ts.Client().Get(ts.URL)
resp.Body.Close()

if captured != "" { // RACE: read may happen before write completes
    t.Fatal("captured")
}
```

What's wrong?

The HTTP client returns when the response headers arrive, possibly before the handler finishes writing to `captured`. The test reads a stale value. The race detector catches this. Fix: synchronise with a channel or read the captured value inside the handler before responding.

## Bug 25 — Re-using a test certificate across versions

```go
cert, _ := tls.LoadX509KeyPair("testdata/cert.pem", "testdata/key.pem")
ts := httptest.NewUnstartedServer(h)
ts.TLS = &tls.Config{Certificates: []tls.Certificate{cert}}
ts.StartTLS()
```

What's wrong?

If `testdata/cert.pem` has an expiry date in the past, TLS handshake fails with "certificate has expired". Worse: tests pass locally because your `cert.pem` is fresh, but fail in CI a year later when it expires. Fix: use `httptest.NewTLSServer` (the bundled cert is valid until 2049) or regenerate the cert programmatically at test start.

---

## Quick-fire bug spotting

For each snippet, identify the issue in ten seconds.

**Q1.**
```go
ts := httptest.NewServer(h)
go ts.Close() // why is this dangerous?
```
Closing in a goroutine races with `t.Cleanup`. Always Close synchronously.

**Q2.**
```go
req := httptest.NewRequest("get", "/", nil)
```
Lowercase method may be normalised, but it's bad style and on some Go versions panics. Use `"GET"`.

**Q3.**
```go
ts := httptest.NewTLSServer(h)
resp, _ := http.Get(ts.URL)
```
Default client doesn't trust the cert; the `Get` fails. Ignored error masks the bug.

**Q4.**
```go
mux := http.NewServeMux()
mux.HandleFunc("/users", h)
ts := httptest.NewServer(mux)
ts.Client().Get(ts.URL + "users")
```
Missing slash. URL becomes `http://...portusers`. DNS or parse error.

**Q5.**
```go
rec := httptest.NewRecorder()
rec.Body = nil
h(rec, req)
fmt.Println(rec.Body.String())
```
Nil pointer dereference. Body must be non-nil to call `.String()`.

---

[← Back](../)
