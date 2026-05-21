---
layout: default
title: httptest — Junior
parent: net/http/httptest
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/04-httptest/junior/
---

# httptest — Junior

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Why a special package for HTTP testing](#why-a-special-package-for-http-testing)
5. [Two ways to test HTTP code](#two-ways-to-test-http-code)
6. [Your first ResponseRecorder test](#your-first-responserecorder-test)
7. [Reading the recorded response](#reading-the-recorded-response)
8. [httptest.NewRequest in detail](#httptestnewrequest-in-detail)
9. [Status codes and headers](#status-codes-and-headers)
10. [Testing query strings and form bodies](#testing-query-strings-and-form-bodies)
11. [Testing JSON handlers](#testing-json-handlers)
12. [Your first NewServer test](#your-first-newserver-test)
13. [Talking to NewServer with http.Get](#talking-to-newserver-with-httpget)
14. [Calling server.Close](#calling-serverclose)
15. [Why t.Cleanup is safer than defer](#why-tcleanup-is-safer-than-defer)
16. [Asserting on response bodies](#asserting-on-response-bodies)
17. [Testing 404 and other error paths](#testing-404-and-other-error-paths)
18. [Multiple endpoints on one server](#multiple-endpoints-on-one-server)
19. [Testing redirects](#testing-redirects)
20. [Testing cookies](#testing-cookies)
21. [Common mistakes](#common-mistakes)
22. [Mental models](#mental-models)
23. [Self-assessment checklist](#self-assessment-checklist)
24. [Summary](#summary)
25. [Further reading](#further-reading)

---

## Introduction

This file teaches you to test HTTP code in Go without leaving the standard library. By the end you will be able to take a function that looks like

```go
func MyHandler(w http.ResponseWriter, r *http.Request) { ... }
```

and write a `func TestMyHandler(t *testing.T)` that exercises it, asserts on the status code, headers, and body, and runs in under a millisecond. You will also be able to take a function that looks like

```go
func FetchUser(client *http.Client, baseURL string, id int) (*User, error) { ... }
```

and test it against an in-process HTTP server that you start, talk to, and tear down in the same test.

These two patterns — `ResponseRecorder` for the inside of your handler, `NewServer` for the outside — are the bread and butter of HTTP testing in Go. Everything else (TLS, streaming, hijack, race-safety) is a refinement on top of these two.

The package is `net/http/httptest`. It lives in the standard library, in `$GOROOT/src/net/http/httptest/`. You will not need any third-party dependency to follow this file. You will need Go 1.21 or later, the `testing` package, and a small handler you wrote yourself.

A note before we start. The first time you write `httptest.NewRequest(...)` you may think it looks redundant — why not just call `http.NewRequest`? They differ in subtle but important ways, and we cover the difference in detail in [httptest.NewRequest in detail](#httptestnewrequest-in-detail). Until you are sure why they differ, prefer `httptest.NewRequest` in tests of *server-side* code. It is a one-line decision with no downside.

---

## Prerequisites

- You can write Go programs and run `go test`.
- You have written at least one handler with `http.HandlerFunc` or a `http.ServeMux`.
- You know that handlers are called by the standard library, not by you directly.
- You can read JSON from `io.Reader` with `json.NewDecoder`.
- You know what `t.Run` does (it creates a sub-test).

You do **not** need to know:

- The internals of `net/http`'s server loop.
- HTTP/2 framing.
- TLS internals.

We will treat handlers and clients as black boxes. The point of `httptest` is to test the contract — the request goes in, the response comes out — without depending on the implementation of either side.

---

## Glossary

- **`*http.Request`** — a struct that represents an HTTP request. The same type is used for both incoming (server-side) and outgoing (client-side) requests, but the fields populated differ.
- **`http.ResponseWriter`** — an interface a handler writes into. The real implementation in `net/http` writes to a TCP socket; in tests we substitute a `*ResponseRecorder`.
- **Handler** — anything implementing `http.Handler` (i.e. `ServeHTTP(ResponseWriter, *Request)`). `http.HandlerFunc` adapts a function into a `Handler`.
- **`httptest.ResponseRecorder`** — an in-memory `ResponseWriter` that records the status, headers, and body the handler wrote.
- **`httptest.Server`** — a real local HTTP server bound to a random port on `127.0.0.1`. Tests can talk to it like any real server.
- **Loopback** — the local-only network on `127.0.0.1` (IPv4) or `::1` (IPv6). Traffic never leaves the host.
- **`t.Cleanup`** — a method on `*testing.T` that registers a function to run when the test (and any subtests) finish.

---

## Why a special package for HTTP testing

You could test HTTP code without `httptest`. Suppose you write a handler:

```go
func Hello(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "hello")
}
```

You could "test" it by running `http.ListenAndServe(":8080", http.HandlerFunc(Hello))` in a goroutine, sending a GET request from another goroutine, and comparing the body. But that test would:

- Pick a fixed port and fail if the port is in use.
- Race on startup — your goroutine spawning the request might run before the server is listening.
- Leak the server when the test ends, because nothing closed it.
- Cost ~10ms for the TCP handshake on every run.

`net/http/httptest` solves each of those problems. It picks a random free port, returns *after* the listener is open, lets you `Close` deterministically, and offers a `ResponseRecorder` that bypasses TCP entirely. It is the package the Go authors built so that the `net/http` package could test itself.

---

## Two ways to test HTTP code

There are two test styles for HTTP code in Go, and you will use both:

1. **In-process — `ResponseRecorder`.** Call your handler directly. Pass it a `*ResponseRecorder` that pretends to be `http.ResponseWriter`. After the handler returns, inspect what the recorder captured.

2. **Over a socket — `httptest.NewServer`.** Start an actual HTTP server, bound to `127.0.0.1:0`. Talk to it with `http.Get` or any `*http.Client`. The server URL is in `server.URL`.

Use style 1 when you are testing the handler itself. Use style 2 when you are testing the *client* that talks to a handler, or when you need a real TCP connection (TLS, streaming, hijack).

There is no third way. Anything more elaborate is a wrapper around one of these two.

---

## Your first ResponseRecorder test

Let's start with the smallest possible test. Suppose you have:

```go
// hello.go
package myapi

import (
    "fmt"
    "net/http"
)

func Hello(w http.ResponseWriter, r *http.Request) {
    fmt.Fprint(w, "hello")
}
```

The test:

```go
// hello_test.go
package myapi

import (
    "net/http/httptest"
    "testing"
)

func TestHello(t *testing.T) {
    req := httptest.NewRequest("GET", "/", nil)
    rec := httptest.NewRecorder()

    Hello(rec, req)

    if rec.Code != 200 {
        t.Fatalf("status = %d, want 200", rec.Code)
    }
    if got := rec.Body.String(); got != "hello" {
        t.Fatalf("body = %q, want %q", got, "hello")
    }
}
```

That is the entire test. Five lines of meaningful code:

1. `httptest.NewRequest` builds a synthetic `*http.Request` as if a client had sent it.
2. `httptest.NewRecorder` builds a `*ResponseRecorder` that implements `http.ResponseWriter`.
3. `Hello(rec, req)` calls the handler directly, passing the recorder where the real server would pass its own writer.
4. `rec.Code` is the status code the handler set. It defaults to `200` if the handler never calls `WriteHeader`.
5. `rec.Body.String()` is the body the handler wrote.

Run it:

```
$ go test -run TestHello -v
=== RUN   TestHello
--- PASS: TestHello (0.00s)
PASS
ok  myapi  0.205s
```

Notice the duration — most of the 200ms is the test binary's startup. The actual test took microseconds.

---

## Reading the recorded response

`ResponseRecorder` exposes a small surface. The fields you read are:

- `rec.Code` — the status code as an `int`. Defaults to `200`.
- `rec.Body` — a `*bytes.Buffer` with whatever the handler wrote. You can call `rec.Body.String()` for the text, `rec.Body.Bytes()` for raw bytes, or `rec.Body.Read(...)` to consume incrementally.
- `rec.HeaderMap` — the `http.Header` map. You can also call `rec.Header()` which returns the same map.
- `rec.Flushed` — `true` if the handler called `Flush()` on the recorder.

There is also `rec.Result()`, which returns a `*http.Response` snapshot:

```go
resp := rec.Result()
defer resp.Body.Close()

cookies := resp.Cookies()
ct := resp.Header.Get("Content-Type")
```

Use `Result()` when you have code that already accepts `*http.Response` — e.g. cookie parsing via `(*http.Response).Cookies()`, or shared assertions between integration and unit tests. For plain status-and-body assertions, the direct fields are simpler.

A pitfall: `rec.Result()` returns a *snapshot*. Calling it twice gives you two `*http.Response` objects, each with its own copy of the body. Reading the body once exhausts the underlying buffer. The fix is to call `Result()` exactly once per test.

---

## httptest.NewRequest in detail

`httptest.NewRequest` looks deceptively similar to `http.NewRequest`. They are different. `httptest.NewRequest` builds a *server-side* request — one that looks like what your server would have parsed off the wire. `http.NewRequest` builds an *outgoing* request meant to be sent by `client.Do`.

The signature is:

```go
func NewRequest(method, target string, body io.Reader) *http.Request
```

What you get back:

- `RequestURI` is set (server requests have it; client requests do not).
- `Proto` is `"HTTP/1.1"`.
- `Host` is taken from `target` if it has an authority, else `"example.com"`.
- `RemoteAddr` is `"192.0.2.1:1234"` — a test-only address (RFC 5737 TEST-NET-1).
- `Body` is wrapped in an `io.NopCloser`; `ContentLength` is set if the body is a `*bytes.Reader`, `*bytes.Buffer`, or `*strings.Reader`.
- `TLS` is `nil` unless `target` starts with `https://`, in which case a minimal `*tls.ConnectionState` is filled.

A few examples:

```go
// Simple GET
req := httptest.NewRequest("GET", "/users/42", nil)

// POST with JSON body
body := strings.NewReader(`{"name":"Ada"}`)
req := httptest.NewRequest("POST", "/users", body)
req.Header.Set("Content-Type", "application/json")

// Different host (for host-based routing)
req := httptest.NewRequest("GET", "http://api.example.com/users", nil)
```

If you forget to set `Content-Type` on a POST, your handler will see `r.Header.Get("Content-Type") == ""` — exactly as a real client that forgot to set it. Tests should not silently fix mistakes the user could make in production.

A note on panics: `httptest.NewRequest` panics if `method` is invalid (e.g. contains a space) or `target` cannot be parsed. That's deliberate — it means you discover bad test code at test-write time, not at production time.

---

## Status codes and headers

A handler writes a status code by calling `w.WriteHeader(code)`. If it never calls `WriteHeader`, the first `Write` implicitly writes `200 OK`. In tests:

```go
func Status(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusCreated)
    fmt.Fprint(w, `{"id":42}`)
}

func TestStatus(t *testing.T) {
    rec := httptest.NewRecorder()
    Status(rec, httptest.NewRequest("GET", "/", nil))

    if rec.Code != http.StatusCreated {
        t.Fatalf("code = %d", rec.Code)
    }
}
```

A header is set with `w.Header().Set(key, value)` *before* the first `Write` or `WriteHeader`. After the first write, headers are frozen — modifying them has no effect. The same rule applies in tests; `ResponseRecorder` enforces it the same way the real writer does.

To assert on a header:

```go
if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
    t.Fatalf("Content-Type = %q", ct)
}
```

For multi-value headers like `Set-Cookie`:

```go
for _, c := range rec.Header().Values("Set-Cookie") {
    t.Logf("cookie line: %s", c)
}
```

A common mistake: setting `Content-Length` by hand. Don't. The server (or recorder) tracks bytes written and sets the header automatically. If you set it wrong, clients hang waiting for bytes that never come.

---

## Testing query strings and form bodies

Query strings are part of the URL, so they go into the `target` argument:

```go
req := httptest.NewRequest("GET", "/search?q=golang&page=2", nil)
```

Inside the handler, `r.URL.Query()` returns a `url.Values` map you can inspect or use `Get("q")` on.

Form bodies (POSTed `application/x-www-form-urlencoded`) need a body reader and a `Content-Type`:

```go
form := url.Values{}
form.Set("name", "Ada")
form.Set("email", "ada@example.com")

req := httptest.NewRequest("POST", "/users", strings.NewReader(form.Encode()))
req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
```

In the handler, `r.ParseForm()` populates `r.PostForm`. Without the `Content-Type` header, the handler won't parse the body.

Multipart forms (`multipart/form-data`) need `mime/multipart.Writer`:

```go
var buf bytes.Buffer
mw := multipart.NewWriter(&buf)
mw.WriteField("name", "Ada")
fw, _ := mw.CreateFormFile("avatar", "ada.png")
fw.Write(pngBytes)
mw.Close()

req := httptest.NewRequest("POST", "/upload", &buf)
req.Header.Set("Content-Type", mw.FormDataContentType())
```

The handler then calls `r.ParseMultipartForm(maxMemory)`. Tests for multipart uploads are verbose but mechanical.

---

## Testing JSON handlers

JSON in, JSON out — the most common modern handler shape:

```go
type CreateUser struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}

type User struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`
    Email string `json:"email"`
}

func CreateUserHandler(w http.ResponseWriter, r *http.Request) {
    var in CreateUser
    if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
        http.Error(w, "bad json", http.StatusBadRequest)
        return
    }
    out := User{ID: 1, Name: in.Name, Email: in.Email}
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusCreated)
    json.NewEncoder(w).Encode(out)
}
```

Test it:

```go
func TestCreateUser(t *testing.T) {
    body := strings.NewReader(`{"name":"Ada","email":"ada@x.com"}`)
    req := httptest.NewRequest("POST", "/users", body)
    req.Header.Set("Content-Type", "application/json")
    rec := httptest.NewRecorder()

    CreateUserHandler(rec, req)

    if rec.Code != http.StatusCreated {
        t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
    }

    var got User
    if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
        t.Fatalf("decode: %v", err)
    }
    want := User{ID: 1, Name: "Ada", Email: "ada@x.com"}
    if got != want {
        t.Fatalf("got %+v, want %+v", got, want)
    }
}
```

Negative path:

```go
func TestCreateUser_BadJSON(t *testing.T) {
    body := strings.NewReader(`not json`)
    req := httptest.NewRequest("POST", "/users", body)
    rec := httptest.NewRecorder()

    CreateUserHandler(rec, req)

    if rec.Code != http.StatusBadRequest {
        t.Fatalf("status = %d", rec.Code)
    }
}
```

Tip: `json.NewEncoder(w).Encode` writes a trailing newline. If you assert on body bytes exactly, account for it (`"{...}\n"`).

---

## Your first NewServer test

`NewServer` is the second style. Use it when the code under test is a *client* — something that calls `http.Get`, `http.Post`, or builds requests with `http.NewRequest` and sends them. You can't pass a `ResponseRecorder` to such code; it expects a URL.

The minimal setup:

```go
func TestClient(t *testing.T) {
    handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprint(w, "hello from server")
    })

    ts := httptest.NewServer(handler)
    t.Cleanup(ts.Close)

    resp, err := http.Get(ts.URL)
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()

    body, _ := io.ReadAll(resp.Body)
    if string(body) != "hello from server" {
        t.Fatalf("body = %q", body)
    }
}
```

What's happening:

1. `httptest.NewServer(handler)` creates an `*http.Server` whose `Handler` is `handler`, binds a listener to `127.0.0.1:0`, and starts the accept loop in a goroutine. The function returns *after* the listener is open.

2. `ts.URL` is a string like `http://127.0.0.1:54321` (port chosen by the kernel). You can prefix paths: `ts.URL + "/users/42"`.

3. `http.Get(ts.URL)` opens a TCP connection to that port. The server accepts it, parses the request, runs the handler, and writes the response.

4. `t.Cleanup(ts.Close)` schedules `ts.Close()` to run when the test ends. We'll see in [Why t.Cleanup is safer than defer](#why-tcleanup-is-safer-than-defer) why this is preferred over `defer`.

The cost: one TCP handshake on loopback (microseconds), one goroutine per connection (the server-side accept loop is already running). For most tests, this is fine. For thousands of iterations in a benchmark, prefer `ResponseRecorder`.

---

## Talking to NewServer with http.Get

`http.Get` is convenient but limited. For anything beyond a plain GET you'll want `http.NewRequest` + `client.Do`:

```go
client := ts.Client() // recommended; we'll see why under TLS
req, err := http.NewRequest("POST", ts.URL+"/users", strings.NewReader(`{"name":"Ada"}`))
if err != nil {
    t.Fatal(err)
}
req.Header.Set("Content-Type", "application/json")
req.Header.Set("Authorization", "Bearer test-token")

resp, err := client.Do(req)
if err != nil {
    t.Fatal(err)
}
defer resp.Body.Close()
```

Two things to note:

- We used `ts.Client()` instead of `http.DefaultClient`. For non-TLS servers this is mostly equivalent, but it future-proofs the test if you later switch to `httptest.NewTLSServer` (covered in `middle.md`).
- We *always* close `resp.Body`. Failing to close leaks connections from the client's transport.

If your client code is wrapped in a function like

```go
func FetchUser(baseURL string, id int) (*User, error) { ... }
```

then your test is even simpler:

```go
u, err := FetchUser(ts.URL, 42)
```

Make `baseURL` an argument. That's all the dependency injection you need.

---

## Calling server.Close

`ts.Close()` does three things:

1. Closes the listener so no new connections are accepted.
2. Calls `Shutdown` on the underlying `*http.Server`, which waits for in-flight handlers to return.
3. Closes any idle keep-alive connections.

The contract: after `Close` returns, no handler is still running and no listener is open. The port is released back to the kernel.

If you forget `Close`:

- The listener keeps occupying its port for the lifetime of the test process.
- The accept-loop goroutine keeps running.
- Tests run in series eventually exhaust ephemeral ports (typically after thousands of leaks).

The race detector will not flag a missing `Close`. The test will pass. The leak is silent.

Always pair `httptest.NewServer` with a `Close` call. The two ways to schedule it:

```go
// Style A — defer
ts := httptest.NewServer(handler)
defer ts.Close()
// ...

// Style B — t.Cleanup
ts := httptest.NewServer(handler)
t.Cleanup(ts.Close)
// ...
```

`t.Cleanup` is strictly safer. The next section shows why.

---

## Why t.Cleanup is safer than defer

`defer` runs when the enclosing function returns. `t.Cleanup` runs when the test (and all of its parallel subtests) finish.

In a non-parallel test, the two are equivalent. In a test that creates parallel subtests, they differ:

```go
func TestParallel(t *testing.T) {
    ts := httptest.NewServer(handler)
    defer ts.Close() // BUG

    for i := 0; i < 3; i++ {
        i := i
        t.Run(fmt.Sprint(i), func(t *testing.T) {
            t.Parallel()
            // hits ts.URL
        })
    }
}
```

The `t.Parallel` call defers the subtests until after the parent function returns. The parent returns *before* the subtests run. `defer ts.Close()` then fires while the subtests are still trying to use the server.

With `t.Cleanup`:

```go
func TestParallel(t *testing.T) {
    ts := httptest.NewServer(handler)
    t.Cleanup(ts.Close)
    // ... same loop ...
}
```

`Cleanup` waits for the subtests. The server stays alive until they all finish.

A second reason to prefer `Cleanup`: it's idempotent. You can call `t.Cleanup` from anywhere — including helpers — and all cleanups run in LIFO order. `defer` only works inside the function it appears in.

A third reason: `Cleanup` runs even when the test fails with `t.Fatal`. `defer` does too, but only if the failure is in the same function. A `t.Fatal` from a helper fired via `t.Cleanup` would skip the `defer` in the helper.

The discipline is: **whenever you create a resource in a test, register its cleanup with `t.Cleanup` immediately on the next line.**

---

## Asserting on response bodies

There are three common assertion styles:

**Exact-match.** Best for short, deterministic responses:

```go
if got := rec.Body.String(); got != "hello" {
    t.Fatalf("body = %q, want %q", got, "hello")
}
```

**JSON-aware.** Best when you want to ignore key order or formatting:

```go
var got, want map[string]any
json.Unmarshal(rec.Body.Bytes(), &got)
json.Unmarshal([]byte(`{"name":"Ada"}`), &want)
if !reflect.DeepEqual(got, want) {
    t.Fatalf("got %v, want %v", got, want)
}
```

**Struct-decode.** Best when you have a Go type to decode into:

```go
var u User
if err := json.NewDecoder(rec.Body).Decode(&u); err != nil {
    t.Fatalf("decode: %v", err)
}
if u.Name != "Ada" {
    t.Fatalf("name = %q", u.Name)
}
```

For longer responses, store the expected payload in a "golden file" and compare:

```go
want, _ := os.ReadFile("testdata/expected.json")
if !bytes.Equal(rec.Body.Bytes(), want) {
    t.Fatalf("body mismatch")
}
```

Golden files have a dedicated chapter in this roadmap; for now, treat them as a tool you'll learn about later.

---

## Testing 404 and other error paths

Handlers that distinguish error cases need negative tests. The shape is the same — different inputs, different expected outputs:

```go
func TestUser_NotFound(t *testing.T) {
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/users/9999", nil)

    UserHandler(rec, req)

    if rec.Code != http.StatusNotFound {
        t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
    }
}
```

If your handler returns errors in a JSON envelope:

```go
type ErrResp struct {
    Error string `json:"error"`
}

func TestUser_NotFound_JSON(t *testing.T) {
    rec := httptest.NewRecorder()
    UserHandler(rec, httptest.NewRequest("GET", "/users/9999", nil))

    if rec.Code != http.StatusNotFound {
        t.Fatalf("code = %d", rec.Code)
    }
    var e ErrResp
    if err := json.NewDecoder(rec.Body).Decode(&e); err != nil {
        t.Fatalf("decode: %v", err)
    }
    if e.Error == "" {
        t.Fatal("empty error message")
    }
}
```

Cover three error categories per endpoint:

1. **Input errors** — bad JSON, missing fields, invalid types. Expected: 400.
2. **Auth errors** — missing/invalid token. Expected: 401 or 403.
3. **Resource errors** — not found, conflict. Expected: 404 or 409.

You don't need to enumerate every possible bad input. One representative test per category is enough.

---

## Multiple endpoints on one server

A test server can host many endpoints via `http.ServeMux`:

```go
func TestAPI(t *testing.T) {
    mux := http.NewServeMux()
    mux.HandleFunc("/users", listUsers)
    mux.HandleFunc("/users/", getUser) // trailing slash matches /users/{id}

    ts := httptest.NewServer(mux)
    t.Cleanup(ts.Close)

    // ... multiple tests against the same server ...
}
```

Or pass an existing application's handler:

```go
app := NewApp(deps)
ts := httptest.NewServer(app.Handler())
```

This is the closest your tests can get to running the full app — the same router, the same middleware, the same handlers. Only the upstreams (databases, partners) differ, and those are usually injected as dependencies you've already mocked.

If you have a chi/gorilla router:

```go
r := chi.NewRouter()
r.Get("/users", listUsers)
ts := httptest.NewServer(r)
```

The shape is identical. `httptest.NewServer` accepts any `http.Handler`.

---

## Testing redirects

Handlers that issue redirects need testing on two axes: did they redirect, and to where?

```go
func TestRedirect(t *testing.T) {
    mux := http.NewServeMux()
    mux.HandleFunc("/old", func(w http.ResponseWriter, r *http.Request) {
        http.Redirect(w, r, "/new", http.StatusMovedPermanently)
    })
    mux.HandleFunc("/new", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprint(w, "new content")
    })

    ts := httptest.NewServer(mux)
    t.Cleanup(ts.Close)

    // Default client follows up to 10 redirects.
    resp, err := http.Get(ts.URL + "/old")
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()

    body, _ := io.ReadAll(resp.Body)
    if string(body) != "new content" {
        t.Fatalf("body = %q", body)
    }
    if resp.Request.URL.Path != "/new" {
        t.Fatalf("final URL path = %q", resp.Request.URL.Path)
    }
}
```

To test that the redirect *headers* are correct (without following), disable redirect-following:

```go
client := &http.Client{
    CheckRedirect: func(*http.Request, []*http.Request) error {
        return http.ErrUseLastResponse
    },
}

resp, err := client.Get(ts.URL + "/old")
if err != nil {
    t.Fatal(err)
}
defer resp.Body.Close()

if resp.StatusCode != http.StatusMovedPermanently {
    t.Fatalf("code = %d", resp.StatusCode)
}
if loc := resp.Header.Get("Location"); loc != "/new" {
    t.Fatalf("Location = %q", loc)
}
```

For handler-only tests (no server), use `ResponseRecorder`:

```go
rec := httptest.NewRecorder()
RedirectHandler(rec, httptest.NewRequest("GET", "/old", nil))

if rec.Code != http.StatusMovedPermanently {
    t.Fatalf("code = %d", rec.Code)
}
if loc := rec.Header().Get("Location"); loc != "/new" {
    t.Fatalf("Location = %q", loc)
}
```

---

## Testing cookies

Cookies set by handlers appear in `Set-Cookie` headers:

```go
func TestSetCookie(t *testing.T) {
    h := func(w http.ResponseWriter, r *http.Request) {
        http.SetCookie(w, &http.Cookie{
            Name:  "session",
            Value: "abc123",
            Path:  "/",
        })
        fmt.Fprint(w, "ok")
    }

    rec := httptest.NewRecorder()
    h(rec, httptest.NewRequest("GET", "/", nil))

    cookies := rec.Result().Cookies()
    if len(cookies) != 1 {
        t.Fatalf("cookies = %d", len(cookies))
    }
    if cookies[0].Name != "session" || cookies[0].Value != "abc123" {
        t.Fatalf("cookie = %+v", cookies[0])
    }
}
```

To send a cookie to a handler:

```go
req := httptest.NewRequest("GET", "/profile", nil)
req.AddCookie(&http.Cookie{Name: "session", Value: "abc123"})
```

End-to-end (server-style) cookie tests usually use the client's `CookieJar`:

```go
jar, _ := cookiejar.New(nil)
client := &http.Client{Jar: jar}
client.Get(ts.URL + "/login") // sets cookie
client.Get(ts.URL + "/profile") // sends cookie back
```

The `Jar` field automates cookie storage and resubmission between requests.

---

## Common mistakes

**Forgetting `t.Cleanup(ts.Close)`.** Symptom: tests pass individually but fail under `-count=100` with "too many open files" or "address already in use". Fix: always register cleanup on the next line after `httptest.NewServer`.

**Mixing up `http.NewRequest` and `httptest.NewRequest`.** Both compile and run, but `http.NewRequest` produces a *client* request — `RequestURI` is empty, `RemoteAddr` is zero. Handlers that inspect those fields misbehave under the wrong constructor. Use `httptest.NewRequest` for handler tests.

**Setting `Content-Length` by hand.** The server (and recorder) tracks bytes written. If you set the header, you'll mis-set it, and clients hang. Don't.

**Reading `rec.Body` twice via `Result()`.** Each `rec.Result()` returns a new `*http.Response` whose `Body` is a `NopCloser` over the same buffer. Reading once exhausts the buffer; subsequent reads see EOF. Call `Result()` once and reuse, or read `rec.Body` directly.

**Asserting on header case.** `http.Header` canonicalises keys. `Set("x-foo", ...)` becomes `X-Foo`. `Get("x-foo")` works because `Get` canonicalises too, but `HeaderMap["x-foo"]` does not. Stick to `Get`/`Set` when in doubt.

**Calling `defer ts.Close()` in a function that spawns parallel subtests.** The parent returns before the subtests run; the `defer` fires too early. Use `t.Cleanup`.

**Relying on `http.DefaultClient` against a TLS test server.** The self-signed cert is not in the default root pool, so `http.DefaultClient.Get(ts.URL)` fails with "certificate signed by unknown authority". Use `ts.Client()`.

**Not closing `resp.Body`.** Even in tests. Even when you've already read the body to EOF. The transport pools connections; an unclosed body holds the connection.

**Asserting on absolute URLs in redirect tests.** `http.Redirect` accepts relative paths and may rewrite them. Assert on the path you handed in (`/new`), not the full URL.

---

## Mental models

**Model 1 — The recorder is a paper handler.** Imagine the handler reaches into the recorder and writes status, headers, and body onto separate sheets of paper. After the handler returns, you read each sheet at your leisure. There is no socket, no goroutine, no race. The handler runs to completion before any assertion fires.

**Model 2 — The server is a tiny real server.** When you write `httptest.NewServer(h)`, you have a real `*http.Server` listening on a real port on `127.0.0.1`. The test process is both client and server. Every request goes through the full HTTP/1.1 stack. The only thing missing is the public network.

**Model 3 — `t.Cleanup` is the test's defer.** A test's "function" is not just `func TestX(t *testing.T)` — it's the entire tree of `t.Run` calls that may execute concurrently. `defer` runs at the wrong layer. `t.Cleanup` runs at the right one.

**Model 4 — `httptest` is the friend of `net/http`.** Both packages were written together by the Go authors. `httptest` knows about `RequestURI`, `RemoteAddr`, and `TLS` so that handlers tested with it see what they would see in production. It is the cooperating partner, not a third-party wrapper.

---

## Self-assessment checklist

- [ ] You can write a `ResponseRecorder` test in under thirty seconds.
- [ ] You can explain the difference between `httptest.NewRequest` and `http.NewRequest`.
- [ ] You always pair `httptest.NewServer` with `t.Cleanup(ts.Close)`.
- [ ] You can test a JSON-in/JSON-out handler with both positive and negative cases.
- [ ] You know when to use `NewRecorder` (handler test) vs `NewServer` (client test).
- [ ] You know why `t.Cleanup` is safer than `defer` in tests with parallel subtests.
- [ ] You always close `resp.Body` in tests, even when you've already read the body.
- [ ] You can extract cookies from a recorded response.
- [ ] You can disable redirect-following in an `*http.Client` to assert on redirect headers.
- [ ] You can mount multiple endpoints on one `httptest.NewServer` via `http.ServeMux`.

---

## Summary

You have learned the two foundational tools of HTTP testing in Go: `httptest.NewRecorder` for in-process handler tests and `httptest.NewServer` for over-the-socket client tests. You can write tests for status codes, headers, JSON bodies, redirects, and cookies. You know to register cleanup with `t.Cleanup`, not `defer`. You know to use `httptest.NewRequest` for server-side requests.

What's next:

- `middle.md` — TLS, middleware chains, the server's `Client()` method, port-zero binding, testing `http.Client` code in production patterns.
- `senior.md` — streaming, chunked encoding, context propagation, hijack limits, deadline tests.
- `professional.md` — OAuth flows, webhooks, multi-server fan-out, go-vcr/gock interop.

You do not need to read those in order if you have an immediate problem to solve. But you should read them eventually — the package is small, and there is real depth below the surface.

---

## Further reading

- `src/net/http/httptest/` — the source. Read `recorder.go` and `server.go` end-to-end. Both files are under 400 lines.
- `httptest.NewRequest` example in `src/net/http/httptest/example_test.go`.
- `httptest.NewServer` example in the same file.
- The `net/http` package's own tests (`src/net/http/*_test.go`) — many use `httptest`, and they are a free training set for idiomatic style.

---

## Appendix A — A worked example, end to end

Suppose you are building a small URL-shortener API with two endpoints:

```
POST /shorten   {"url":"https://..."}  -> 201 {"code":"abc123"}
GET  /{code}                            -> 302 Location: <original URL>
```

Here is what the test file looks like, written from scratch, with no skipped steps.

```go
package shortener

import (
    "encoding/json"
    "io"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"
)

type store struct {
    m map[string]string
}

func newStore() *store { return &store{m: map[string]string{}} }

func (s *store) save(code, url string) { s.m[code] = url }
func (s *store) get(code string) (string, bool) {
    v, ok := s.m[code]
    return v, ok
}
```

The handlers:

```go
func ShortenHandler(s *store) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        var in struct{ URL string `json:"url"` }
        if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
            http.Error(w, "bad json", http.StatusBadRequest)
            return
        }
        if in.URL == "" {
            http.Error(w, "missing url", http.StatusBadRequest)
            return
        }
        code := generateCode() // assume deterministic in tests
        s.save(code, in.URL)
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusCreated)
        json.NewEncoder(w).Encode(map[string]string{"code": code})
    }
}

func RedirectHandler(s *store) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        code := strings.TrimPrefix(r.URL.Path, "/")
        target, ok := s.get(code)
        if !ok {
            http.NotFound(w, r)
            return
        }
        http.Redirect(w, r, target, http.StatusFound)
    }
}
```

The tests:

```go
func TestShorten(t *testing.T) {
    s := newStore()
    rec := httptest.NewRecorder()
    body := strings.NewReader(`{"url":"https://golang.org"}`)
    req := httptest.NewRequest("POST", "/shorten", body)

    ShortenHandler(s)(rec, req)

    if rec.Code != http.StatusCreated {
        t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
    }
    var out struct{ Code string `json:"code"` }
    if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
        t.Fatal(err)
    }
    if out.Code == "" {
        t.Fatal("empty code")
    }
    if v, ok := s.get(out.Code); !ok || v != "https://golang.org" {
        t.Fatalf("store missing entry: %v", s.m)
    }
}

func TestRedirect_NotFound(t *testing.T) {
    s := newStore()
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/nope", nil)

    RedirectHandler(s)(rec, req)

    if rec.Code != http.StatusNotFound {
        t.Fatalf("code = %d", rec.Code)
    }
}

func TestRedirect_Found(t *testing.T) {
    s := newStore()
    s.save("abc", "https://golang.org")
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/abc", nil)

    RedirectHandler(s)(rec, req)

    if rec.Code != http.StatusFound {
        t.Fatalf("code = %d", rec.Code)
    }
    if loc := rec.Header().Get("Location"); loc != "https://golang.org" {
        t.Fatalf("Location = %q", loc)
    }
}
```

And an integration test against an `httptest.NewServer`:

```go
func TestFullFlow(t *testing.T) {
    s := newStore()
    mux := http.NewServeMux()
    mux.Handle("/shorten", ShortenHandler(s))
    mux.HandleFunc("/", RedirectHandler(s))

    ts := httptest.NewServer(mux)
    t.Cleanup(ts.Close)

    // Step 1: shorten.
    body := strings.NewReader(`{"url":"https://example.com"}`)
    req, _ := http.NewRequest("POST", ts.URL+"/shorten", body)
    req.Header.Set("Content-Type", "application/json")

    resp, err := ts.Client().Do(req)
    if err != nil {
        t.Fatal(err)
    }
    var out struct{ Code string `json:"code"` }
    json.NewDecoder(resp.Body).Decode(&out)
    resp.Body.Close()

    if out.Code == "" {
        t.Fatal("no code returned")
    }

    // Step 2: follow shortened URL — but disable redirect-following so we can
    // inspect the 302 directly.
    noRedirect := *ts.Client()
    noRedirect.CheckRedirect = func(*http.Request, []*http.Request) error {
        return http.ErrUseLastResponse
    }
    resp, err = noRedirect.Get(ts.URL + "/" + out.Code)
    if err != nil {
        t.Fatal(err)
    }
    if resp.StatusCode != http.StatusFound {
        t.Fatalf("status = %d", resp.StatusCode)
    }
    if loc := resp.Header.Get("Location"); loc != "https://example.com" {
        t.Fatalf("Location = %q", loc)
    }
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}
```

Read the file as a whole — three small handler tests, one integration test, no helpers, no third-party libraries. Every assertion sits next to the call it's about. The integration test runs against a real loopback HTTP server. None of it leaks. None of it races.

This is the shape of a `httptest`-fluent test suite. Aim to write yours this way.

---

## Appendix B — Frequently asked questions from juniors

**Why do I need both `NewRequest` and `NewRecorder`?**
Because `ServeHTTP(ResponseWriter, *Request)` takes both. The request is the input; the recorder is the writer the handler will write into. They're not interchangeable.

**Can I reuse a recorder across multiple handler calls?**
You can but you shouldn't. The state (status, headers, body) accumulates. Tests become unreadable. Create a fresh recorder per call.

**Why does my test pass but the body looks empty?**
Likely your handler is writing to `w` *after* returning early via `http.Error`, which closes the response. Read the handler top-to-bottom and confirm only one write happens.

**Why is `rec.Code` 200 when my handler didn't set one?**
That's the default. Go's `ResponseWriter` semantics: if you `Write` without `WriteHeader`, the status is 200. The recorder follows the same rule.

**Why does `httptest.NewServer` need its own Close?**
Because it owns a real TCP listener and a goroutine. Closing the test process eventually frees them, but tests run as part of a longer process (`go test`), and leaks accumulate.

**What happens if I forget `defer resp.Body.Close()`?**
The transport pools the connection but never returns it to the pool until GC closes the body. Under `-race -count=100`, you'll exhaust file descriptors. Always close.

**Can I write the test before the handler exists?**
Yes — that's TDD. Write the test, watch it fail, write the handler, watch it pass. `httptest` makes this easy because tests don't need any infrastructure.

**Should I test the framework or my code?**
Your code. If `http.ServeMux` is buggy, that's a Go bug and you can't fix it. Tests should exercise *your* handlers and *your* middleware, not the standard library.

**Why does `httptest.NewRequest` set `Host` to `example.com`?**
Because the RFC requires a Host header on HTTP/1.1 requests, and `example.com` is a reserved hostname for examples (RFC 2606). The package picks a safe default.

**How do I test a handler that reads environment variables?**
Use `t.Setenv("MY_VAR", "value")` at the start of the test. It's automatically restored when the test ends. `httptest` doesn't help; this is a `testing` concern.

---

## Appendix D — Reading the source

If you have Go installed, the entire `httptest` package is on your machine. Find it:

```bash
$ go env GOROOT
/usr/local/go
$ ls $(go env GOROOT)/src/net/http/httptest/
example_test.go  httptest.go  httptest_test.go  recorder.go  recorder_test.go  server.go  server_test.go
```

Open `recorder.go` first. The whole file is under 250 lines including comments and copyright. Read it top to bottom. You will see how `Header()`, `Write()`, `WriteHeader()`, and `Flush()` work — they are short methods that do exactly what you'd expect.

Then open `server.go`. Skip the TLS certificate generation at the top; come back to it later. Read `NewServer`, `NewUnstartedServer`, `Start`, `StartTLS`, `Close`, `Client`. Each is a handful of lines.

Reading the standard library is one of the highest-leverage things a junior Go programmer can do. The code is well-commented, idiomatic, and direct. Spend an hour with `httptest` before you ever read another tutorial.

## Appendix E — A flowchart for "which API do I use?"

```
Are you testing a handler (you wrote ServeHTTP)?
  -> Use httptest.NewRecorder + httptest.NewRequest. Done.

Are you testing client code (you wrote http.Get/Post/Do)?
  -> Use httptest.NewServer. Inject ts.URL into your code.

Does your code need TLS?
  -> Use httptest.NewTLSServer instead. Always use ts.Client() to call it.

Do you need to set ReadTimeout, WriteTimeout, ErrorLog, or EnableHTTP2?
  -> Use httptest.NewUnstartedServer, mutate ts.Config or ts.EnableHTTP2, then Start.

Are you testing a middleware?
  -> Use httptest.NewRecorder with a stub inner handler that records what it saw.
```

That's it. Four constructors, one decision tree.

## Appendix C — A 60-second cheat sheet

```go
// Handler test
req := httptest.NewRequest("GET", "/path", nil)
rec := httptest.NewRecorder()
MyHandler(rec, req)
// assert: rec.Code, rec.Body.String(), rec.Header().Get(...)

// Client test
ts := httptest.NewServer(handler)
t.Cleanup(ts.Close)
resp, err := ts.Client().Get(ts.URL + "/path")
// assert: resp.StatusCode, body, headers

// TLS test
ts := httptest.NewTLSServer(handler)
t.Cleanup(ts.Close)
resp, _ := ts.Client().Get(ts.URL) // use ts.Client() not http.DefaultClient

// Pre-start config
ts := httptest.NewUnstartedServer(handler)
ts.Config.ReadTimeout = 100 * time.Millisecond
ts.Start()
t.Cleanup(ts.Close)
```

Keep this card next to the keyboard for the first ten or twenty tests you write. After that, you'll have it memorised.

---

[← Back](../)
