---
layout: default
title: E2E Tests — Find the Bug
parent: E2E Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/14-e2e-tests/find-bug/
---

# E2E Tests — Find the Bug

[← Back](../)

Each snippet below is a Go E2E test (or supporting code) with a real defect.
Find it, name it, and propose the fix.

## Bug 1 — The friendly sleep

```go
func TestE2E_OrderShipped(t *testing.T) {
    id := createOrder(t)
    time.Sleep(2 * time.Second) // wait for worker
    require.Equal(t, "shipped", statusOf(t, id))
}
```

Bug. Fixed sleep. On a slow CI runner the worker may take 3 seconds; on a
fast laptop it takes 200 ms. The test is either flaky or slow.

Fix. Poll until the expected state is observed, with an explicit deadline.

```go
require.Eventually(t, func() bool {
    return statusOf(t, id) == "shipped"
}, 30*time.Second, 100*time.Millisecond)
```

## Bug 2 — Shared tenant

```go
const tenantID = "e2e-tenant"

func TestE2E_CreateUser(t *testing.T) {
    t.Parallel()
    createUser(t, tenantID, "alice")
    require.Equal(t, 1, countUsers(t, tenantID))
}

func TestE2E_DeleteUser(t *testing.T) {
    t.Parallel()
    createUser(t, tenantID, "bob")
    deleteUser(t, tenantID, "bob")
    require.Equal(t, 0, countUsers(t, tenantID))
}
```

Bug. Both tests run in parallel against the same tenant. One test's `count`
sees the other test's data.

Fix. Allocate a fresh tenant per test:

```go
tenant := newTenant(t) // returns unique ID; t.Cleanup deletes it
createUser(t, tenant.ID, "alice")
```

## Bug 3 — Browser without wait

```go
chromedp.Run(ctx,
    chromedp.Navigate(baseURL+"/login"),
    chromedp.SendKeys(`#email`, "alice@example.com"),
    chromedp.SendKeys(`#password`, "secret"),
    chromedp.Click(`button[type=submit]`),
    chromedp.Text(`#greeting`, &greeting),
)
```

Bug. After `Click`, the navigation to `/dashboard` is asynchronous.
`chromedp.Text` reads from the login page where `#greeting` does not exist.

Fix. Insert `chromedp.WaitVisible('#greeting')` before reading.

## Bug 4 — Token in URL

```go
req, _ := http.NewRequest("GET",
    fmt.Sprintf("%s/orders/%s?token=%s", baseURL, id, token), nil)
resp, _ := client.Do(req)
```

Bug. Auth token in the URL. It will appear in server access logs, in proxy
logs, in `t.Logf` output, and in any HTTP recording the suite saves on
failure. This is a credential leak waiting to happen.

Fix. Use the `Authorization` header:

```go
req.Header.Set("Authorization", "Bearer "+token)
```

## Bug 5 — Errors silently dropped

```go
resp, _ := http.Get(baseURL + "/health")
require.Equal(t, 200, resp.StatusCode)
```

Bug. The `err` from `http.Get` is ignored. If the network fails or the
server is down, `resp` is nil and the next line panics with a nil pointer
dereference — masking the real failure.

Fix.

```go
resp, err := http.Get(baseURL + "/health")
require.NoError(t, err)
defer resp.Body.Close()
require.Equal(t, 200, resp.StatusCode)
```

## Bug 6 — Cleanup that races

```go
func TestE2E_OrderRoundTrip(t *testing.T) {
    id := createOrder(t)
    go deleteOrder(t, id) // cleanup in background
    require.Equal(t, "confirmed", statusOf(t, id))
}
```

Bug. The cleanup goroutine may delete the order before the assertion runs.
Even if it doesn't, calling `t.Fatal` from another goroutine is undefined
when the test has already returned.

Fix. Use `t.Cleanup`:

```go
id := createOrder(t)
t.Cleanup(func() { deleteOrder(t, id) })
```

## Bug 7 — No deadline on the test context

```go
ctx := context.Background()
chromedp.Run(ctx, chromedp.Navigate(url), chromedp.WaitVisible(`#x`))
```

Bug. No deadline. If `#x` never appears, the test hangs until the CI
runner's wall-clock kill (often 30+ minutes), producing zero diagnostics.

Fix.

```go
ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
defer cancel()
chromedp.Run(ctx, /* ... */)
```

## Bug 8 — Reused port

```go
func TestMain(m *testing.M) {
    cmd := exec.Command("go", "run", "./cmd/svc", "-addr=:8080")
    _ = cmd.Start()
    time.Sleep(2 * time.Second)
    os.Exit(m.Run())
}
```

Bug. Hard-coded `:8080`. A second test binary on the same host (parallel
CI, developer running the suite twice) collides with EADDRINUSE.

Fix. Bind to `:0` (kernel assigns a free port), discover the port via the
service's startup log line or a `/health` endpoint that echoes the listen
address, and pass it to tests via env.

## Bug 9 — Retry on bad request

```go
func doRetry(req *http.Request) (*http.Response, error) {
    var lastErr error
    for i := 0; i < 5; i++ {
        resp, err := http.DefaultClient.Do(req)
        if err == nil && resp.StatusCode < 500 {
            return resp, nil
        }
        lastErr = err
        time.Sleep(time.Second)
    }
    return nil, lastErr
}
```

Bug. The condition `resp.StatusCode < 500` accepts 4xx responses without
retrying — which is correct. But the loop also does not retry on 502 if
`err == nil`, because the early return path is wrong: `err == nil &&
resp.StatusCode < 500` returns success even for 4xx like 404 (fine) and
returns success for 500+ only when `err != nil` (which never happens for an
HTTP response with a body). Trace it: a 502 returns `(resp, nil)` with
StatusCode 502 → condition `nil && 502 < 500` is false → fall through →
sleep → retry. That part is fine. The bug is different: the request body
(`req.Body`) is consumed on the first attempt and is nil on the second.
The retry sends an empty body.

Fix. Capture the body bytes once, rebuild a fresh `io.Reader` per attempt,
and use `req.Clone(ctx)` with a new body:

```go
body, _ := io.ReadAll(req.Body)
for i := 0; i < 5; i++ {
    cloned := req.Clone(req.Context())
    cloned.Body = io.NopCloser(bytes.NewReader(body))
    // ...
}
```

## Bug 10 — Compose left running on panic

```go
func TestMain(m *testing.M) {
    exec.Command("docker", "compose", "up", "-d").Run()
    code := m.Run()
    exec.Command("docker", "compose", "down", "-v").Run()
    os.Exit(code)
}
```

Bug. If `m.Run()` panics or the process is killed, `down` never runs and
the compose stack leaks. Successive runs start failing because the ports
are held.

Fix. Register a signal handler and use `defer`-style teardown via a wrapper
function:

```go
func TestMain(m *testing.M) {
    up()
    defer down()
    sig := make(chan os.Signal, 1)
    signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
    go func() { <-sig; down(); os.Exit(2) }()
    os.Exit(m.Run())
}
```

`defer` in `TestMain` does not run if `os.Exit` is called, so the wrapper
pattern wraps the call inside a function and uses `defer` correctly inside
it — or registers `down` as `atexit`-style via signal traps.

## Bug 11 — Comparing maps with a typo

```go
got := decodeJSON(resp.Body)
require.Equal(t, map[string]any{"name": "Alice", "age": 30}, got)
```

Bug. JSON numbers decoded into `any` arrive as `float64`, not `int`. The
assertion fails with `30 != 30.0` even though the server returned the
correct value.

Fix. Decode into a typed struct, or use a JSON-aware matcher:

```go
var got struct{ Name string; Age int }
json.NewDecoder(resp.Body).Decode(&got)
require.Equal(t, "Alice", got.Name)
require.Equal(t, 30, got.Age)
```

## Bug 12 — Logging the token

```go
t.Logf("response: %+v", resp.Header)
```

Bug. `resp.Header` may contain a `Set-Cookie` with a session token. On a
failing test, CI logs the header and the token leaks into CI's permanent
archive.

Fix. Redact sensitive headers before logging:

```go
h := resp.Header.Clone()
h.Del("Set-Cookie")
h.Del("Authorization")
t.Logf("response: %+v", h)
```

Or, better, only log on failure with a helper that scrubs known sensitive
fields.

## Bug 13 — `t.Parallel` after shared setup

```go
func TestE2E_OrderShipped(t *testing.T) {
    seedCatalog(t) // global mutation
    t.Parallel()
    // ...
}
```

Bug. `seedCatalog` mutates a global. Running multiple tests in parallel
each calls `seedCatalog` racing on the same global state.

Fix. Do shared setup in `TestMain`, or guard with `sync.Once` if it
must run lazily. The `t.Parallel` call should follow only steps that
are safe to run concurrently with other tests.

## Bug 14 — Decoded type drift

```go
var out struct {
    Order map[string]any
}
json.NewDecoder(resp.Body).Decode(&out)
qty := out.Order["qty"].(int)
```

Bug. JSON numbers in `map[string]any` are `float64`. The type assertion
`.(int)` panics. The test fails not with "expected 3 got 4" but with
"interface conversion: float64 is not int" — useless.

Fix. Use a typed struct:

```go
var out struct {
    Order struct{ Qty int `json:"qty"` }
}
```

Or decode with `UseNumber()` and call `.Int64()` explicitly.

## Bug 15 — Test runs the wrong service

```go
const baseURL = "http://localhost:8080"
```

Bug. Hard-coded URL. The test passes on the laptop where the developer
has their service on 8080 and fails everywhere else.

Fix. Read from `E2E_BASE_URL`. Skip the test if unset. No hard-coded
URLs anywhere in the suite.

## Bug 16 — Cleanup forgets the parent

```go
func TestE2E_OrderInTenant(t *testing.T) {
    tenant := createTenant(t)
    order := createOrder(t, tenant.ID, "WIDGET", 1)
    t.Cleanup(func() { deleteOrder(t, order.ID) })
    // tenant cleanup missing
}
```

Bug. Order cleanup runs, tenant cleanup does not. The tenant accumulates
in the staging database, eventually slowing it down.

Fix. The `createTenant` helper should register its own cleanup:

```go
func createTenant(t *testing.T) Tenant {
    // ... create ...
    t.Cleanup(func() { deleteTenant(t, tenant.ID) })
    return tenant
}
```

Cleanup co-located with creation. The test does not need to remember.

## Bug 17 — Test order dependency

```go
var sharedTenantID string

func TestE2E_CreateTenant(t *testing.T) {
    sharedTenantID = createTenant(t)
}

func TestE2E_UseTenant(t *testing.T) {
    require.NotEmpty(t, sharedTenantID)
    // use it
}
```

Bug. `TestE2E_UseTenant` depends on `TestE2E_CreateTenant` running first.
`go test -run TestE2E_UseTenant` fails. `go test -shuffle on` fails
randomly.

Fix. Each test creates its own tenant. No order dependency.
