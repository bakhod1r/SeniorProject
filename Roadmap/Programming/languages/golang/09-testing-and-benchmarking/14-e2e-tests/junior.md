---
layout: default
title: E2E Tests — Junior
parent: E2E Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/14-e2e-tests/junior/
---

# E2E Tests — Junior

[← Back](../)

## What "end-to-end" actually means

You have probably written three kinds of tests already:

- A **unit test** calls a function and checks its return value. Nothing else
  is running.
- An **integration test** wires a small number of real components together —
  for example, a handler talking to a real Postgres in a Docker container.
- An **end-to-end test** runs the system the way a real user would run it.
  The service is started as its own process, the database is the real
  Postgres, the cache is the real Redis, and the test pretends to be the
  client. It sends an HTTP request, or clicks a button in a browser, or
  invokes a CLI binary. It does not know — and does not care — how the
  service is built inside.

The defining feature of E2E is the **client's perspective**. The test sees
what a real client sees: HTTP responses, rendered HTML, CLI output, error
codes. Everything inside the system is opaque. If a class of bug only shows
up when all the pieces are wired together — for example, the load balancer
strips a header your handler relies on — only an E2E test catches it. If a
bug shows up inside one function regardless of wiring, a unit test catches
it more cheaply.

## E2E vs integration in plain words

| Question                                  | Integration | E2E |
|-------------------------------------------|-------------|-----|
| Does the SUT run as a separate process?   | Sometimes   | Always |
| Is the real production database used?     | Often       | Always |
| Is the test calling internal functions?   | Sometimes   | Never  |
| Can it run with `httptest.NewServer`?     | Yes         | No |
| Does it cover the full network path?      | Partial     | Yes |
| How long does one test take?              | 0.1-1 s     | 1-30 s |

The line is not always sharp in practice. A useful rule: if you can replace
the SUT with an in-process call without rewriting the test, it is
integration. If you cannot, it is E2E.

There is a related rule of thumb: an E2E test does not import the SUT's
internal packages. If your test file has

```go
import "github.com/me/myservice/internal/orders"
```

you are reaching into the service's guts. That is integration territory. An
E2E test only imports `net/http`, your typed API client, and standard test
infrastructure.

## Your first API E2E test

Suppose you have a service running at `http://localhost:8080` exposing a
health endpoint. The simplest possible E2E test:

```go
//go:build e2e

package e2e

import (
    "io"
    "net/http"
    "os"
    "testing"
)

func TestE2E_HealthOK(t *testing.T) {
    baseURL := os.Getenv("E2E_BASE_URL")
    if baseURL == "" {
        t.Skip("E2E_BASE_URL not set")
    }
    resp, err := http.Get(baseURL + "/health")
    if err != nil {
        t.Fatalf("GET /health: %v", err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        body, _ := io.ReadAll(resp.Body)
        t.Fatalf("status %d, body %s", resp.StatusCode, body)
    }
}
```

There is no in-process server, no `httptest`. The test talks HTTP to a
service it does not own. That is end-to-end.

The `//go:build e2e` tag matters. By default `go test ./...` will skip this
file. You opt in:

```
go test -tags=e2e ./test/e2e/...
```

Why? Because E2E tests are slow and need an environment. You do not want
them running during a normal local edit-test loop. A developer fixing a
typo should not wait three minutes for a docker-compose stack to come up.
Build tags let the suite stay out of the default path while remaining a
first-class part of the codebase.

## Reading the environment

A working E2E suite reads its target from environment variables. Hardcoding
`localhost:8080` makes the test useful only on the machine that wrote it.

```go
var (
    baseURL = os.Getenv("E2E_BASE_URL")
    token   = os.Getenv("E2E_TOKEN")
)

func requireEnv(t *testing.T) {
    t.Helper()
    if baseURL == "" {
        t.Skip("E2E_BASE_URL not set")
    }
}
```

Skip — do not fail — when the env is missing. That way running the suite
without configuration produces an obvious "skipped" message rather than a
red CI build. The convention is to skip cleanly so a developer who runs
`go test -tags=e2e ./...` on their laptop without setting anything up does
not get a wall of red.

If you want the suite to be stricter (fail when the env is missing in CI),
add a `E2E_REQUIRED=1` knob and check it once in `TestMain`:

```go
func TestMain(m *testing.M) {
    if os.Getenv("E2E_REQUIRED") == "1" && baseURL == "" {
        log.Fatal("E2E_REQUIRED=1 but E2E_BASE_URL is empty")
    }
    os.Exit(m.Run())
}
```

CI sets `E2E_REQUIRED=1`; laptops do not.

## Creating data and reading it back

A common shape: POST to create something, GET to read it back, assert that
what we get matches what we sent.

```go
func TestE2E_CreateAndFetchOrder(t *testing.T) {
    requireEnv(t)

    body := strings.NewReader(`{"sku":"WIDGET","qty":3}`)
    req, _ := http.NewRequest("POST", baseURL+"/orders", body)
    req.Header.Set("Authorization", "Bearer "+token)
    req.Header.Set("Content-Type", "application/json")

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        t.Fatalf("POST: %v", err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != 201 {
        t.Fatalf("POST status %d", resp.StatusCode)
    }

    var created struct {
        ID  string `json:"id"`
        SKU string `json:"sku"`
        Qty int    `json:"qty"`
    }
    if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
        t.Fatal(err)
    }

    // Read back.
    req2, _ := http.NewRequest("GET", baseURL+"/orders/"+created.ID, nil)
    req2.Header.Set("Authorization", "Bearer "+token)
    resp2, err := http.DefaultClient.Do(req2)
    if err != nil {
        t.Fatal(err)
    }
    defer resp2.Body.Close()

    var got struct {
        SKU string `json:"sku"`
        Qty int    `json:"qty"`
    }
    json.NewDecoder(resp2.Body).Decode(&got)
    if got.SKU != "WIDGET" || got.Qty != 3 {
        t.Fatalf("got %+v", got)
    }
}
```

A few things to notice. The auth token is in a header, not a query string.
Bodies are closed with `defer`. Status codes are checked before the body is
trusted. The struct fields use `json` tags so the decoder works even if
your struct field names differ from the wire field names.

Why bother decoding into a typed struct instead of `map[string]any`? Because
`json.Unmarshal` decodes JSON numbers into `float64` when the target is
`any`. An assertion like `require.Equal(t, 3, m["qty"])` will fail because
`3 != 3.0`. A typed struct sidesteps the entire category of confusion.

## What if the action is asynchronous?

Real systems often acknowledge a request before the work is done. Your
order is "created" instantly but only becomes "confirmed" after a background
worker processes it. A naive test:

```go
time.Sleep(2 * time.Second)
assertStatus(t, id, "confirmed")
```

This is wrong even when it works. On a slow CI runner two seconds is not
enough; on a fast laptop it is more than enough; you have built a flaky
test in a single line. Replace `time.Sleep` with **polling**:

```go
func waitFor(t *testing.T, deadline time.Duration, fn func() bool) {
    t.Helper()
    end := time.Now().Add(deadline)
    for time.Now().Before(end) {
        if fn() {
            return
        }
        time.Sleep(200 * time.Millisecond)
    }
    t.Fatalf("condition not met within %s", deadline)
}

waitFor(t, 30*time.Second, func() bool {
    return statusOf(t, id) == "confirmed"
})
```

Poll a probe, give it a deadline, fail loudly if the deadline is missed.

The deadline is a maximum, not a target. A test that almost always finishes
in 200ms with a 30s deadline is doing the right thing: it returns
immediately when the condition is met and only burns time on the rare slow
case. Setting a 1-second deadline because "it shouldn't take more than a
second" is how you create a flake.

## Browser tests, gently

For a web frontend you can drive a real Chrome via `github.com/chromedp/chromedp`.
A minimal example:

```go
func TestE2E_LoginShowsDashboard(t *testing.T) {
    ctx, cancel := chromedp.NewContext(context.Background())
    defer cancel()

    var greeting string
    err := chromedp.Run(ctx,
        chromedp.Navigate(baseURL+"/login"),
        chromedp.SendKeys(`#email`, "alice@example.com"),
        chromedp.SendKeys(`#password`, "secret"),
        chromedp.Click(`button[type=submit]`),
        chromedp.WaitVisible(`#greeting`),
        chromedp.Text(`#greeting`, &greeting),
    )
    if err != nil {
        t.Fatal(err)
    }
    if greeting != "Hello, Alice" {
        t.Fatalf("got %q", greeting)
    }
}
```

`WaitVisible` is the browser equivalent of polling. Never assume the page
finished loading just because `Click` returned — that only means the click
event fired, not that the next page rendered.

If your project prefers Playwright, the equivalent library is
`github.com/playwright-community/playwright-go`. Both work; the team picks
one and sticks with it. `chromedp` is lighter to install (only needs Chrome
on the system); `playwright-go` ships with installation tooling for multiple
browsers and tends to have a richer API for modern web patterns.

A note on selectors. `#greeting` is a CSS ID selector. In practice you want
selectors that survive design refactors — usually `data-testid="greeting"`
attributes baked into the frontend specifically for tests. Selectors based
on visible text or on style classes are fragile.

## CLI tests

If the SUT is a CLI binary, build it first and then exec it:

```go
func TestMain(m *testing.M) {
    cmd := exec.Command("go", "build", "-o", "bin/mytool", "./cmd/mytool")
    if out, err := cmd.CombinedOutput(); err != nil {
        log.Fatalf("build: %v\n%s", err, out)
    }
    os.Exit(m.Run())
}

func TestE2E_Greet(t *testing.T) {
    out, err := exec.Command("./bin/mytool", "greet", "--name=Alice").Output()
    if err != nil {
        t.Fatal(err)
    }
    if strings.TrimSpace(string(out)) != "Hello, Alice" {
        t.Fatalf("got %q", out)
    }
}
```

Build in `TestMain` (or once at the start of the package) so individual
tests do not pay the compile cost.

What if the CLI is interactive — it reads from stdin, writes a prompt,
reads more? Plain `os/exec` works when the input is non-interactive (you
can pipe bytes into `cmd.Stdin`). For real terminal interaction (a curses
UI, a confirmation prompt that disables echo), you need a pseudo-terminal.
The library `github.com/creack/pty` gives you one in a few lines:

```go
import "github.com/creack/pty"

cmd := exec.Command("./bin/mytool", "greet")
ptmx, err := pty.Start(cmd)
if err != nil {
    t.Fatal(err)
}
defer ptmx.Close()

fmt.Fprintln(ptmx, "Alice")
out, _ := io.ReadAll(ptmx)
require.Contains(t, string(out), "Hello, Alice")
```

The CLI now sees a real TTY on stdin and stdout, so it does not switch into
non-interactive mode.

## Where do tests live?

A typical layout:

```
repo/
  cmd/orders/         # service binary
  internal/...        # service code
  test/
    e2e/
      e2e_test.go     # //go:build e2e
      helpers.go
      testdata/
```

The `test/e2e/` directory keeps E2E separate from unit tests in
`internal/`, and the build tag makes accidental inclusion impossible. The
`testdata/` subdirectory holds anything the suite needs at runtime: a
docker-compose file, sample payloads, certificate fixtures. `go test`
treats `testdata/` as special: it never compiles its contents, so you can
put non-Go files there freely.

## A complete starter example

Putting the pieces together, a small but realistic E2E test file:

```go
//go:build e2e

package e2e

import (
    "bytes"
    "context"
    "encoding/json"
    "net/http"
    "os"
    "strings"
    "testing"
    "time"
)

var (
    baseURL = os.Getenv("E2E_BASE_URL")
    token   = os.Getenv("E2E_TOKEN")
    client  = &http.Client{Timeout: 10 * time.Second}
)

func TestE2E_Health(t *testing.T) {
    if baseURL == "" {
        t.Skip("E2E_BASE_URL not set")
    }
    req, _ := http.NewRequestWithContext(t.Context(), "GET", baseURL+"/health", nil)
    resp, err := client.Do(req)
    if err != nil {
        t.Fatalf("health: %v", err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        t.Fatalf("health status %d", resp.StatusCode)
    }
}

func TestE2E_CreateOrder(t *testing.T) {
    if baseURL == "" || token == "" {
        t.Skip("missing env")
    }
    body, _ := json.Marshal(map[string]any{"sku": "WIDGET", "qty": 3})
    req, _ := http.NewRequestWithContext(t.Context(), "POST",
        baseURL+"/orders", bytes.NewReader(body))
    req.Header.Set("Authorization", "Bearer "+token)
    req.Header.Set("Content-Type", "application/json")
    resp, err := client.Do(req)
    if err != nil {
        t.Fatalf("post: %v", err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != 201 {
        t.Fatalf("status %d", resp.StatusCode)
    }
    var got struct{ ID string }
    json.NewDecoder(resp.Body).Decode(&got)
    if !strings.HasPrefix(got.ID, "ord_") {
        t.Fatalf("unexpected id %q", got.ID)
    }
}
```

This is enough to start: a build tag, env-driven config, a typed decode, a
specific status check, and the use of `t.Context()` so the test inherits
the timeout the test framework sets.

## What a junior should not do yet

- Do not invent your own test harness that bundles a fake DB into the
  service. That defeats the point of E2E.
- Do not write E2E tests for every change. Most changes are better tested
  with a unit or integration test. E2E is for whole-flow assurance.
- Do not run E2E on every save. Run unit on save; run E2E on commit or on
  demand.
- Do not bypass auth by reading the SUT's environment variables for a
  secret. Use the same login flow a client would.

## Common confusions

**"My test uses `httptest.NewServer`. Is that E2E?"** No. That is integration.
The handler is still in your process, the routes are still your routes,
the network stack is loopback. E2E means a separate process bound to a port
you do not control.

**"My test starts a goroutine that runs the server."** Still integration.
Same process, same memory, same observability. The goroutine is a
convenience for the test, not a production deployment.

**"My test mocks the database with sqlmock."** Definitely not E2E. The
purpose of E2E is to catch wiring bugs that show up only when the real
database is talking. Mocks hide those bugs.

**"My test runs against staging."** Closer. If staging mirrors production
topology (same load balancer, same DNS, same database vendor and version)
then yes. If staging swaps in a SQLite database "for speed," you are back
to integration.

## When to skip writing the E2E test

A useful rule: write the test that would have caught the bug you are
afraid of. If a code change cannot break the wiring — say, a refactor
within one function — an E2E test does not add information. If a code
change touches the wiring — adds a new dependency, changes a route,
modifies the deploy manifest — an E2E test pays for itself.

If you are still unsure, ask: "what failure mode does this E2E test catch
that my unit and integration tests do not?" If you cannot name a specific
failure mode, you do not need the E2E test yet.

## The starter checklist

When writing your first E2E test, walk this list:

1. Is there a faster layer (unit, integration) that would catch the same
   bug? If yes, write it there instead.
2. Where is the service running, and how does the test find it?
   (`E2E_BASE_URL` env var.)
3. Is auth needed, and what is the token? (`E2E_TOKEN`, never hard-coded.)
4. Does the action involve async work? If yes, replace any `time.Sleep`
   with polling.
5. What data does the test create, and how will it be cleaned up?
   (`t.Cleanup`, or a unique tenant ID.)
6. Will two copies of this test running side by side step on each other?
   If yes, scope by tenant or run sequentially.
7. Does the test fail loudly when something is wrong? Naming the deadline,
   the URL, and the last observed value in the failure message is worth
   the few extra lines.

This checklist looks simple. The discipline of running through it on every
test is what separates a healthy suite from one nobody trusts.

## A note on `t.Context()`

Since Go 1.24, `testing.T` has a `Context()` method that returns a context
cancelled when the test finishes. Use it everywhere instead of
`context.Background()`. If a test takes too long, the testing framework
cancels its context and your HTTP requests fail with a clear "context
deadline exceeded" — instead of hanging until the CI runner kills the
whole job.

```go
req, _ := http.NewRequestWithContext(t.Context(), "GET", baseURL+"/orders", nil)
```

This is one of the cheapest reliability wins in the suite: every HTTP call
inherits the right cancellation, no manual deadline plumbing required.

## HTTP basics for tests

A working E2E suite needs you to be fluent in three things about HTTP in
Go: how to build a request, how to read a response body without leaking
connections, and how to decode JSON safely.

**Building a request.** Use `http.NewRequestWithContext` rather than the
shortcut `http.Post`. The context lets the test cancel the request when
the deadline expires.

```go
req, err := http.NewRequestWithContext(t.Context(), "POST",
    baseURL+"/orders", bytes.NewReader(body))
if err != nil {
    t.Fatal(err)
}
req.Header.Set("Authorization", "Bearer "+token)
req.Header.Set("Content-Type", "application/json")
resp, err := client.Do(req)
```

`http.NewRequest` ignoring the error is tempting because the only way it
returns an error is a malformed URL. But ignoring errors as a habit
becomes a problem when one of them does fire — better to handle it
explicitly even when it is theoretically impossible.

**Closing the body.** Always close the response body, even when you do
not read it. An unclosed body keeps the connection out of the pool and
exhausts file descriptors over time.

```go
defer resp.Body.Close()
```

If you check the status code and return early before reading the body,
add `io.Copy(io.Discard, resp.Body)` before `Close` so the connection is
reusable for the next call. The standard library reuses keep-alive
connections only if the body is fully drained.

**Decoding JSON.** Decode into a typed struct, not `map[string]any`, for
the reasons explained earlier. If you do need a flexible decode, use
`json.Decoder.UseNumber()` to keep numeric precision:

```go
dec := json.NewDecoder(resp.Body)
dec.UseNumber()
var got map[string]any
dec.Decode(&got)
```

Now `got["qty"]` is a `json.Number`, not a `float64`, and you can convert
it explicitly via `.Int64()`.

## Authentication for tests

Most services require an auth token. Your test obtains one the same way a
real client does. Three common patterns:

**Pre-provisioned token.** A long-lived token stored in a CI secret and
read from `E2E_TOKEN`. Convenient for read-only smoke tests. The downside
is that the token is high-privilege and long-lived, which is a security
risk.

**Service-account login.** A test-only service account whose credentials
are stored in a secret manager. The test exchanges them for a short-lived
token before each run. This is the most production-realistic pattern.

```go
func login(t *testing.T) string {
    body, _ := json.Marshal(map[string]string{
        "client_id":     os.Getenv("E2E_CLIENT_ID"),
        "client_secret": os.Getenv("E2E_CLIENT_SECRET"),
    })
    resp, err := http.Post(baseURL+"/oauth/token", "application/json",
        bytes.NewReader(body))
    require.NoError(t, err)
    defer resp.Body.Close()
    var out struct{ AccessToken string `json:"access_token"` }
    require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
    return out.AccessToken
}
```

**Per-tenant tokens.** When the suite creates a tenant per test, an admin
endpoint mints a token scoped to that tenant. This is the cleanest pattern
for parallel suites: each test's actions are visible only within its own
tenant.

Whatever pattern you use, do not log the token. `t.Logf("got %s", token)`
will deposit the secret in your CI logs forever. If you must log a token
for debugging, log only the first six characters.

## A simple polling helper, fully fleshed out

The polling pattern is so common that you will write a helper for it
within your first week. Make it good. Below is a version with sensible
defaults and a useful failure message:

```go
package e2e

import (
    "context"
    "testing"
    "time"
)

// Eventually polls fn until it returns true or the deadline elapses.
// On timeout, it calls t.Fatalf with the configured deadline and the
// caller-supplied description.
func Eventually(t *testing.T, desc string, deadline, tick time.Duration, fn func() bool) {
    t.Helper()
    if deadline <= 0 {
        deadline = 30 * time.Second
    }
    if tick <= 0 {
        tick = 200 * time.Millisecond
    }
    ctx, cancel := context.WithTimeout(t.Context(), deadline)
    defer cancel()

    attempts := 0
    start := time.Now()
    for {
        attempts++
        if fn() {
            t.Logf("%s satisfied in %s after %d attempts", desc, time.Since(start), attempts)
            return
        }
        select {
        case <-ctx.Done():
            t.Fatalf("%s: deadline %s exceeded after %d attempts", desc, deadline, attempts)
        case <-time.After(tick):
        }
    }
}
```

Usage:

```go
Eventually(t, "order confirmed", 30*time.Second, 200*time.Millisecond, func() bool {
    return statusOf(t, id) == "confirmed"
})
```

Three properties make this helper useful:

1. The description ("order confirmed") appears in the failure message so
   you know which wait failed without reading the file.
2. The number of attempts is logged on success. A test that passes on
   attempt 1 is healthy; a test that passes on attempt 50 is borderline.
3. Defaults make most call sites short — `Eventually(t, "x", 0, 0, fn)`
   uses the defaults.

## Working with JSON bodies

When you find yourself writing the same JSON-encode-and-POST dance
repeatedly, extract a tiny helper:

```go
func postJSON(t *testing.T, url string, body any) *http.Response {
    t.Helper()
    raw, err := json.Marshal(body)
    require.NoError(t, err)
    req, _ := http.NewRequestWithContext(t.Context(), "POST", url,
        bytes.NewReader(raw))
    req.Header.Set("Authorization", "Bearer "+token)
    req.Header.Set("Content-Type", "application/json")
    resp, err := client.Do(req)
    require.NoError(t, err)
    t.Cleanup(func() { resp.Body.Close() })
    return resp
}
```

`t.Cleanup` closes the body when the test ends, even if the test fails
mid-way. The caller can read the body, discard it, do whatever — the
helper handles the close.

## Status code assertions

A common newbie pattern:

```go
require.Equal(t, 200, resp.StatusCode)
```

This fails the test but does not log the body. When the server returns
500, you want to know what the server said in the error response, not
just that it was 500. A better helper:

```go
func requireStatus(t *testing.T, resp *http.Response, want int) {
    t.Helper()
    if resp.StatusCode == want {
        return
    }
    body, _ := io.ReadAll(resp.Body)
    t.Fatalf("status %d (want %d), body %s", resp.StatusCode, want, body)
}
```

The body is now in the failure message; the next reader of the failure
log has what they need without re-running the test.

## A first encounter with the `t.Run` subtest

`t.Run` lets you nest tests. For E2E, the most common use is to share
expensive setup across a group of related assertions:

```go
func TestE2E_Orders(t *testing.T) {
    tenant := newTenant(t)
    order := tenant.CreateOrder(t, "WIDGET", 3)

    t.Run("has correct sku", func(t *testing.T) {
        require.Equal(t, "WIDGET", order.SKU)
    })
    t.Run("has correct qty", func(t *testing.T) {
        require.Equal(t, 3, order.Qty)
    })
    t.Run("status becomes confirmed", func(t *testing.T) {
        Eventually(t, "confirmed", 30*time.Second, 200*time.Millisecond, func() bool {
            return tenant.GetOrder(t, order.ID).Status == "confirmed"
        })
    })
}
```

Each subtest reports independently, so a failure in "status becomes
confirmed" does not hide a failure in "has correct sku." The shared
tenant and order setup runs once.

Be careful with subtests when the inner test calls `t.Parallel()`. The
outer test does not wait for parallel subtests to finish before its
`Cleanup` functions run, which can delete data the subtests still need.
The fix: only mark subtests parallel when each is fully independent of
the outer test's resources.

## Step-by-step: writing your first real test

Let us walk a complete example from "I have a service" to "the test passes
in CI."

**Step 1 — confirm the service starts.** Bring it up manually, hit
`/health` with `curl`. If that does not work, no E2E test will work either.
Solve the manual step first.

```
curl -fsS http://localhost:8080/health
```

**Step 2 — pick the flow.** The first test should cover the smallest
self-contained flow your service has. Create-and-read is a good default. A
multi-step workflow is too much for a first test.

**Step 3 — write the test against a known-good server.** Hard-code the
URL while you iterate; you will switch to env vars when the basic shape
works. Run it. Watch it pass.

**Step 4 — replace hard-coded values with env vars.** Run again. Set the
env var. Watch it still pass.

**Step 5 — break the assertion deliberately.** Change `WIDGET` to `WIDGE`
in the expected value. Run again. Read the failure message. Is it useful?
If not, improve the message. The first time a test fails for real in CI,
you want the message to point at the problem without requiring you to
re-run the test locally.

**Step 6 — handle cleanup.** Whatever the test created (an order, a user,
a tenant), make sure it is deleted in `t.Cleanup`. Running the test twice
in a row should produce the same result both times.

**Step 7 — add it to CI.** A new CI job (or step) runs `go test -tags=e2e
./test/e2e/...` against a staging URL. Confirm it passes on a clean run
and fails when you point it at a deliberately broken service.

These seven steps take an afternoon for a junior; doing them in this order
saves a week of debugging when shortcuts come back to haunt you.

## Common HTTP errors and what they mean in E2E

The error messages you see in an E2E test failure are usually one of a
small set. Learning to read them quickly saves time.

**`connection refused`.** Nothing is listening on the port. The service
crashed during startup, the docker-compose stack is not up, or the port
is wrong. Check `docker compose ps` (or `kubectl get pods`); read the
last 100 lines of the SUT's logs.

**`context deadline exceeded`.** The HTTP call took longer than the
context allowed. Either the SUT is slow, the network is congested, or
the deadline is unrealistically tight. Increase the deadline on a
known-slow probe, but first ask whether the slowness is a real issue
worth chasing.

**`EOF`.** The server closed the connection without responding. Usually a
panic on the server side. The SUT's logs should have a stack trace; if
not, the panic happened so early that no logging was attached.

**`tls: handshake failure`.** Certificate mismatch. The test is talking
HTTPS to a server expecting HTTP, or the test does not trust the
server's CA. For local docker-compose stacks, either skip verification
(`InsecureSkipVerify: true` in `tls.Config`) or generate a CA the test
trusts.

**`stream error: stream ID X; PROTOCOL_ERROR`.** HTTP/2 framing
mismatch, usually because the server expects HTTP/1.1 but the client
negotiated HTTP/2. Set `Transport.ForceAttemptHTTP2 = false` to pin
HTTP/1.1.

**`unexpected EOF` while decoding JSON.** The server returned partial
output, probably because it crashed mid-write. Capture the full body
before decoding so the failure message includes whatever bytes arrived.

## The `httptest` trap

The standard library's `net/http/httptest` package is wonderful for
integration tests. It is not E2E. The reason you might be tempted: it is
easy to bring up, fast to tear down, and lets you assert on what the
handler did. Resist. The whole point of E2E is to exercise the wiring,
and `httptest.NewServer` is a server in your test process talking to a
client in your test process — wiring is bypassed.

A reasonable layering:

- Unit test → table-driven, no I/O at all.
- Integration test → `httptest.NewServer` or a Postgres in a docker
  container. Exercises one process.
- E2E test → real deployment, real network. Exercises everything.

The cost of moving an integration test up to E2E is real (slower, more
flaky, more expensive runners) so do not do it without a reason. The
cost of moving an E2E test down to integration is also real (you lose
the wiring coverage) so do not do that either. Pick the right layer for
the risk.

## Running the suite locally vs in CI

The same test code runs in three places:

1. Locally against a docker-compose stack the developer brought up.
2. Locally against a remote staging environment.
3. In CI against a fresh environment built per run.

The differences are managed entirely through environment variables. The
test code itself does not branch on "am I in CI?" except for the
`E2E_REQUIRED=1` check in `TestMain`. If you find yourself writing
`if os.Getenv("CI") != "" { ... }` inside a test, you have leaked
environment logic into test logic. Move it back to env vars.

A reasonable runbook:

```
# laptop, against local compose
docker compose -f testdata/compose.yml up -d
export E2E_BASE_URL=http://localhost:8080
go test -tags=e2e ./test/e2e/...

# laptop, against staging
export E2E_BASE_URL=https://staging.example.com
export E2E_TOKEN=$(cat ~/.staging-token)
go test -tags=e2e -run 'TestE2E_Smoke_' ./test/e2e/...

# CI
export E2E_BASE_URL=<ephemeral-cluster-url>
export E2E_REQUIRED=1
export E2E_ARTIFACTS_DIR=$WORKSPACE/artifacts
go test -tags=e2e -v ./test/e2e/...
```

The flag `-v` prints test names as they run, which is invaluable when a
CI run hangs and you want to know which test is in flight. In CI it is
almost always worth setting.

## Verbose vs quiet runs

Local development benefits from `-v` for the same reason. A failing
test's log lines are interleaved with passing tests' logs; without `-v`,
the failed test's logs are still printed but the context (what was
running just before, how long it ran) is missing.

Set `-count=1` to disable Go's test result caching for the E2E suite. If
the suite genuinely passed last time and nothing changed, Go would skip
it — but for E2E the environment can change without any code change.
Always run.

```
go test -tags=e2e -v -count=1 -timeout=30m ./test/e2e/...
```

The `-timeout` is the wall-clock kill for the test binary. Set it
generously enough that a slow but legitimate run completes, and tightly
enough that a hung run does not consume the entire CI budget. Thirty
minutes is a common starting point.

## Reading test output

Go's test output has a consistent shape. A passing test prints:

```
=== RUN   TestE2E_Health
--- PASS: TestE2E_Health (0.12s)
```

A failing test prints the `t.Fatalf` message and the file:line where it
fired:

```
=== RUN   TestE2E_Order
    e2e_test.go:42: status 500 (want 201), body {"error":"db unavailable"}
--- FAIL: TestE2E_Order (1.34s)
```

Read the failure line first; the file:line is the assertion that fired,
not necessarily the root cause. If the failure message includes the
response body (as in the example), the root cause is often visible
right there.

When `t.Run` subtests are involved, the path is hierarchical:

```
--- FAIL: TestE2E_Orders (1.20s)
    --- FAIL: TestE2E_Orders/status_becomes_confirmed (0.95s)
```

You can re-run just that subtest:

```
go test -tags=e2e -run 'TestE2E_Orders/status_becomes_confirmed' ./test/e2e/...
```

The slash in the test name is significant. `go test -run` treats the part
before the slash as a regex on the outer test and the part after as a
regex on the subtest.

## Skipping vs failing

`t.Skip` and `t.Fatal` look similar but mean very different things.

- `t.Skip` says "this test cannot run in this environment." The test
  result is neither pass nor fail. Use for missing env vars, unsupported
  platforms, optional dependencies.
- `t.Fatal` says "the system under test is wrong." The result is fail.
  Use for genuine assertion failures.

Mixing them up either hides bugs (you skip a test that should have
failed) or causes red CI that nobody trusts (you fail a test that should
have skipped). The mental model: skip is "I am not running today"; fail
is "I ran and the SUT was broken."

There is a third state — `t.SkipNow()` after a partial run, or a
conditional skip mid-test. Be sparing with these; a test that decides
mid-flight to skip is harder to reason about than a test that decides up
front.

## Working with cookies and sessions

Many web apps use cookie-based sessions instead of bearer tokens. The
standard library handles cookies via `http.CookieJar`:

```go
jar, _ := cookiejar.New(nil)
client := &http.Client{Jar: jar, Timeout: 10 * time.Second}

// Login: server sets Set-Cookie: session=...
loginResp, _ := client.Post(baseURL+"/login", "application/json",
    strings.NewReader(`{"email":"alice@example.com","password":"secret"}`))
loginResp.Body.Close()

// Subsequent calls automatically include the session cookie.
homeResp, _ := client.Get(baseURL + "/home")
```

The cookie jar persists across calls on the same client. Each test
should construct its own client so cookies do not leak between tests.

A common mistake: using `http.DefaultClient` for the login and a
different client for the subsequent call. The login cookie sits on the
default client; the subsequent call sees no cookie and returns 401. Use
one client per test.

## Headers you almost always need to set

When in doubt, set these explicitly:

- `Authorization: Bearer <token>` — auth.
- `Content-Type: application/json` — when sending JSON.
- `Accept: application/json` — when expecting JSON. Some services switch
  format based on this header.
- `X-Request-ID: <uuid>` — a per-test UUID that flows through to server
  logs. When a test fails in CI, you can search the SUT's logs for the
  request ID and see exactly what the server did.

```go
reqID := uuid.NewString()
req.Header.Set("X-Request-ID", reqID)
t.Logf("request id: %s", reqID)
```

The `t.Logf` only prints on `-v` or on failure, so it does not clutter
the green path.

## Working with file uploads

If your SUT accepts file uploads, build a `multipart/form-data` body:

```go
func uploadFile(t *testing.T, url, field, filename string, content []byte) *http.Response {
    t.Helper()
    var buf bytes.Buffer
    w := multipart.NewWriter(&buf)
    part, err := w.CreateFormFile(field, filename)
    require.NoError(t, err)
    _, err = part.Write(content)
    require.NoError(t, err)
    w.Close()

    req, _ := http.NewRequestWithContext(t.Context(), "POST", url, &buf)
    req.Header.Set("Content-Type", w.FormDataContentType())
    req.Header.Set("Authorization", "Bearer "+token)
    resp, err := client.Do(req)
    require.NoError(t, err)
    return resp
}
```

`w.FormDataContentType()` builds the right boundary string; do not try to
hand-roll it.

## Working with downloads

For tests that exercise a download endpoint, stream the body to a temp
file and check the size or checksum:

```go
func TestE2E_DownloadReport(t *testing.T) {
    req, _ := http.NewRequestWithContext(t.Context(), "GET",
        baseURL+"/reports/"+id+"/download", nil)
    req.Header.Set("Authorization", "Bearer "+token)
    resp, err := client.Do(req)
    require.NoError(t, err)
    defer resp.Body.Close()
    require.Equal(t, 200, resp.StatusCode)

    tmp, err := os.CreateTemp(t.TempDir(), "report-*")
    require.NoError(t, err)
    n, err := io.Copy(tmp, resp.Body)
    require.NoError(t, err)
    require.Greater(t, n, int64(1024), "report should be at least 1 KB")
}
```

`t.TempDir()` returns a directory that is automatically cleaned up when
the test ends. No manual deletion needed.

## The retry trap

You will be tempted to wrap every HTTP call in a retry loop. Resist.
Retries hide bugs:

- The test retries because the SUT returned a 400. You assume it was a
  flake. It was a real bug — your test built a malformed request.
- The test retries because the SUT returned 500 once. The 500 was a
  legitimate crash. By retrying you let the suite go green and miss the
  crash.

Retry only on:

- Network errors (connection refused, reset by peer).
- Specific transient statuses (502, 503, 504, 408, 429).
- A small, bounded number of attempts (3-5).
- With backoff so you do not stampede a struggling SUT.

Anything else fails immediately. The cost of a retry that hides a bug is
much higher than the cost of a re-run that catches a real flake.

## Closing thought before moving on

The junior level is about reliability of the individual test. The middle
and senior levels are about reliability of the suite. The good news is
that the habits you build here — explicit deadlines, polling not
sleeping, decoding into typed structs, cleaning up your own data — scale
unchanged into a 500-test suite. If your first ten tests follow these
habits, the next 490 will too. If your first ten tests cut corners, your
500-test suite will be unmaintainable in two quarters and you will be
writing a postmortem about how it got that way.

The cheapest minute you can spend on E2E is the minute you spend doing
it right the first time.

## A glossary

The vocabulary trips up newcomers. Quick definitions in the context of
this page:

- **SUT** — System Under Test. The thing your test is testing. For an
  E2E test, the SUT is a deployed service or binary, not a function.
- **Smoke test** — A small subset of the E2E suite that runs after deploy
  to confirm the new build is reachable and the central flows work. Same
  framework, smaller scope.
- **Idempotency** — A request that, when sent twice, produces the same
  result as if it were sent once. Important for safe retries and for
  re-running tests without manual cleanup.
- **Polling** — Asking the system repeatedly whether a condition is true,
  with a deadline. The E2E alternative to `time.Sleep`.
- **Tenant** — A scope that isolates one customer's data from another's.
  In E2E, each test gets its own tenant so parallel tests do not collide.
- **Artefact** — A file the test writes when it fails (screenshot, log
  dump, HTTP transcript) to help an engineer diagnose without re-running.

If you find yourself confused by a term, write it down and check this list
or ask. Vocabulary mismatches are the most common source of misunderstood
test failures.

## Reading existing E2E suites

When you join a team with an existing E2E suite, start by reading
`TestMain`. It tells you:

- How the env comes up (compose, kind, external?).
- Where artefacts go on failure.
- What env vars the suite reads.
- How the SUT is built (or fetched from a registry).

Then read the helpers file. The shape of the helpers (typed client?
generic raw HTTP? polling primitives?) tells you the suite's maturity. A
suite without a typed client and a polling helper will be full of repeated
boilerplate; a suite with both has been maintained.

Only after that should you write a new test. Following the established
patterns keeps the suite coherent; inventing a new pattern next to an
existing one doubles the maintenance surface.

## A first encounter with flakiness

You will eventually write a test that passes 19 times out of 20. The 20th
run fails with no obvious cause. The local re-run passes. You move on.
This is the moment you learn the most important thing about E2E testing:
the test is not lying. Something in the system can fail in a way that
matters, and the test caught it. Your job is to figure out what.

The diagnostic order:

1. Re-read the failure message. Did the test poll long enough? Did it
   report what value it actually saw? If the message says "timeout
   waiting for status confirmed" without a last-observed value, fix the
   test first so the next failure tells you more.
2. Capture the artefacts. If the suite already writes screenshots and
   container logs on failure, look at them. If it does not, add that
   capability before continuing — you will save yourself hours.
3. Check timing. Does the failure correlate with a deploy, a noisy
   neighbour on the runner, a known slow path? If yes, the SUT or the
   environment may be the cause.
4. Reproduce. Run the failing test in a loop locally; one in twenty often
   becomes one in a hundred in a faster environment, and you cannot fix
   what you cannot reproduce.

Junior engineers often treat flake as "the test is broken." Senior
engineers treat it as a leading indicator that something in the system
is fragile. Both attitudes have a place, but the second is the one that
finds real bugs.

## Why this matters

A team that writes E2E tests well has shorter on-call rotations, fewer
post-deploy rollbacks, and shorter discussions in postmortems. A team that
writes them badly has flaky CI, deploys that go sideways, and the
ever-popular "but it worked on my machine." Learning to write the cheap,
reliable kind of test is one of the higher-leverage skills a junior can
develop.

Start small. One test. Pass it locally. Pass it in CI. Then a second.
Watch what breaks, fix it, and learn the shape of your system from the
outside.

