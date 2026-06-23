---
layout: default
title: E2E Tests — Middle
parent: E2E Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/14-e2e-tests/middle/
---

# E2E Tests — Middle

[← Back](../)

The junior level is about getting one test to pass. The middle level is
about a suite that runs every night, fails when it should, passes when it
should, and survives a team that grows. The shape of the suite — fixtures,
helpers, environment management, parallelism — is what we care about now.

## Suite layout

A package with E2E tests has at minimum three pieces:

```
test/e2e/
  e2e_test.go       # tests
  fixtures.go       # helpers: HTTP client, tenant setup, polling
  main_test.go      # TestMain: env bring-up, build, cleanup
```

Compile a single client and reuse it across tests. A new
`http.DefaultClient` per call works but loses connection pooling and
hides the cost of TLS handshakes inside the first request.

```go
var httpClient = &http.Client{
    Timeout: 30 * time.Second,
    Transport: &http.Transport{
        MaxIdleConns:        100,
        MaxIdleConnsPerHost: 10,
        IdleConnTimeout:     90 * time.Second,
    },
}
```

## A typed API client

Calling raw `httpClient.Do` works for one test, but ten tests later you
have ten copies of the same JSON dance. Build a small typed client. Keep it
mechanical: every method does one HTTP call and decodes the response.

```go
type Client struct {
    base  string
    token string
    h     *http.Client
}

func NewClient(base, token string) *Client {
    return &Client{base: base, token: token, h: httpClient}
}

type Order struct {
    ID  string `json:"id"`
    SKU string `json:"sku"`
    Qty int    `json:"qty"`
    Status string `json:"status"`
}

func (c *Client) CreateOrder(ctx context.Context, sku string, qty int) (*Order, error) {
    body, _ := json.Marshal(map[string]any{"sku": sku, "qty": qty})
    req, _ := http.NewRequestWithContext(ctx, "POST", c.base+"/orders", bytes.NewReader(body))
    req.Header.Set("Authorization", "Bearer "+c.token)
    req.Header.Set("Content-Type", "application/json")
    resp, err := c.h.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    if resp.StatusCode != 201 {
        b, _ := io.ReadAll(resp.Body)
        return nil, fmt.Errorf("create: status %d body %s", resp.StatusCode, b)
    }
    var out Order
    if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
        return nil, err
    }
    return &out, nil
}

func (c *Client) GetOrder(ctx context.Context, id string) (*Order, error) {
    req, _ := http.NewRequestWithContext(ctx, "GET", c.base+"/orders/"+id, nil)
    req.Header.Set("Authorization", "Bearer "+c.token)
    resp, err := c.h.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        return nil, fmt.Errorf("get: status %d", resp.StatusCode)
    }
    var out Order
    json.NewDecoder(resp.Body).Decode(&out)
    return &out, nil
}
```

Tests now read as English:

```go
order, err := client.CreateOrder(t.Context(), "WIDGET", 3)
require.NoError(t, err)
```

## Polling, properly

Junior-level polling looped on a flag. Middle level uses a helper that
respects context and backs off:

```go
func Eventually[T any](t *testing.T, deadline, tick time.Duration, fn func() (T, bool)) T {
    t.Helper()
    ctx, cancel := context.WithTimeout(t.Context(), deadline)
    defer cancel()
    var last T
    for {
        v, ok := fn()
        if ok {
            return v
        }
        last = v
        select {
        case <-ctx.Done():
            t.Fatalf("eventually: %v (last value %v)", ctx.Err(), last)
        case <-time.After(tick):
        }
    }
}
```

Use it:

```go
final := Eventually(t, 30*time.Second, 200*time.Millisecond,
    func() (*Order, bool) {
        o, err := client.GetOrder(t.Context(), order.ID)
        if err != nil {
            return nil, false
        }
        return o, o.Status == "confirmed"
    })
require.Equal(t, 3, final.Qty)
```

The returned `final` lets you continue assertions without a second GET.

## Tenant isolation for parallelism

Two tests running in parallel against one tenant will race. Two tests
running in parallel against two tenants will not. The fix is to allocate a
fresh tenant per test:

```go
type Tenant struct {
    ID    string
    Admin *Client
}

func newTenant(t *testing.T) *Tenant {
    t.Helper()
    id := "e2e-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
    // admin endpoint that root creates tenants on
    rootCfg := NewClient(baseURL, rootToken)
    require.NoError(t, rootCfg.CreateTenant(t.Context(), id))
    tok, err := rootCfg.MintAdminToken(t.Context(), id)
    require.NoError(t, err)
    t.Cleanup(func() {
        _ = rootCfg.DeleteTenant(context.Background(), id)
    })
    return &Tenant{ID: id, Admin: NewClient(baseURL, tok)}
}
```

Tests:

```go
func TestE2E_OrderPerTenant(t *testing.T) {
    t.Parallel()
    tenant := newTenant(t)
    o, err := tenant.Admin.CreateOrder(t.Context(), "WIDGET", 1)
    require.NoError(t, err)
    require.NotEmpty(t, o.ID)
}
```

Run with `-parallel 16`. Each test sees an empty world.

## Ephemeral environments with docker-compose

If `E2E_BASE_URL` is unset, the suite brings its own env up via
docker-compose. The pattern:

```go
func TestMain(m *testing.M) {
    if os.Getenv("E2E_BASE_URL") == "" {
        url, stop := startCompose()
        defer stop()
        os.Setenv("E2E_BASE_URL", url)
    }
    os.Exit(m.Run())
}

func startCompose() (string, func()) {
    cmd := exec.Command("docker", "compose", "-f", "testdata/compose.yml", "up", "-d")
    if out, err := cmd.CombinedOutput(); err != nil {
        log.Fatalf("compose up: %v\n%s", err, out)
    }
    url := "http://localhost:" + portFor("api", 8080)
    waitHealth(url)
    return url, func() {
        exec.Command("docker", "compose", "-f", "testdata/compose.yml", "down", "-v").Run()
    }
}

func waitHealth(base string) {
    deadline := time.Now().Add(60 * time.Second)
    for time.Now().Before(deadline) {
        if resp, err := http.Get(base + "/health"); err == nil {
            resp.Body.Close()
            if resp.StatusCode == 200 {
                return
            }
        }
        time.Sleep(500 * time.Millisecond)
    }
    log.Fatal("service did not become healthy")
}
```

For Kubernetes-shaped systems, swap docker-compose for `kind` or `k3d`. The
control flow is the same: bring up, wait for health, run, tear down.

## kind / k3d in a sentence each

- `kind` (sigs.k8s.io/kind): runs a Kubernetes cluster inside Docker.
  Good when you want production-shape manifests but lightweight startup.
- `k3d`: runs a `k3s` (lightweight Kubernetes) cluster inside Docker. Faster
  startup than `kind`, slight feature differences from upstream Kubernetes.

Either works. Pick one and write a tiny shell wrapper your `TestMain`
shells out to.

## Smoke vs full

Tag your smoke tests so you can run only them after a deploy:

```go
func TestE2E_Smoke_Health(t *testing.T) { /* ... */ }
func TestE2E_Smoke_Login(t *testing.T)  { /* ... */ }
```

Then:

```
# nightly full run
go test -tags=e2e ./test/e2e/...

# post-deploy smoke
go test -tags=e2e -run 'TestE2E_Smoke_' ./test/e2e/...
```

No separate framework, no separate codebase. Same tests, different filter.

## Contract tests vs E2E

Contract tests answer "do producer and consumer agree on the shape of the
interface?" Pact records consumer expectations; the provider verifies them
in its own test suite. The two services never run together in a contract
test.

You want **both**. A contract test catches a shape change in seconds at
the layer it happens. An E2E test catches a wiring change a contract test
cannot see (a load balancer routing wrong, a feature flag in the wrong
state). Aim to keep most boundary coverage in contracts and a small set of
critical paths in E2E.

OpenAPI fixtures are a lightweight cousin of Pact: generate a Go HTTP
client from your OpenAPI spec, use it in tests, and any drift between
spec and server shows up as a 400 on a field your test sent.

## Failure artefacts

When a test fails on CI, an engineer needs more than a stack trace. Have
the test write artefacts to `$E2E_ARTIFACTS_DIR/<test-name>/`:

```go
func captureOnFail(t *testing.T) {
    t.Cleanup(func() {
        if !t.Failed() {
            return
        }
        dir := filepath.Join(os.Getenv("E2E_ARTIFACTS_DIR"), t.Name())
        os.MkdirAll(dir, 0o755)
        dumpComposeLogs(dir)
    })
}

func dumpComposeLogs(dir string) {
    out, _ := exec.Command("docker", "compose", "-f", "testdata/compose.yml", "logs", "--tail=200").Output()
    os.WriteFile(filepath.Join(dir, "compose.log"), out, 0o644)
}
```

For browser tests add a screenshot and an `outerHTML` dump:

```go
chromedp.Run(ctx,
    chromedp.CaptureScreenshot(&png),
    chromedp.OuterHTML("html", &html),
)
os.WriteFile(filepath.Join(dir, "page.png"), png, 0o644)
os.WriteFile(filepath.Join(dir, "page.html"), []byte(html), 0o644)
```

## Retries with backoff (when transient errors are expected)

A test that retries a transient 502 is fine. A test that retries a 400 is
hiding a bug. Distinguish:

```go
func doWithRetry(ctx context.Context, h *http.Client, req *http.Request) (*http.Response, error) {
    backoff := 100 * time.Millisecond
    var lastErr error
    for attempt := 0; attempt < 5; attempt++ {
        resp, err := h.Do(req.Clone(ctx))
        if err != nil {
            lastErr = err
        } else if resp.StatusCode == 502 || resp.StatusCode == 503 || resp.StatusCode == 504 {
            resp.Body.Close()
            lastErr = fmt.Errorf("status %d", resp.StatusCode)
        } else {
            return resp, nil
        }
        select {
        case <-ctx.Done():
            return nil, ctx.Err()
        case <-time.After(backoff + time.Duration(rand.Intn(50))*time.Millisecond):
        }
        backoff *= 2
    }
    return nil, lastErr
}
```

Only retry on retryable conditions. Never retry on 4xx other than 408 (request
timeout) and 429 (rate limited).

## What changes vs junior

At this level your tests stop being scripts and start being a system: a
client library, a polling helper, a tenant factory, an env bring-up. The
test code is engineered with the same care as the service code. When you
look back at a middle-level suite a year later you can still understand
how a test gets from "given some data" to "then the response is correct"
without reading the framework's source.

## A short note on Testcontainers

`github.com/testcontainers/testcontainers-go` is the most common
alternative to docker-compose for Go-driven environment bring-up.
The shape:

```go
ctx := context.Background()
req := testcontainers.ContainerRequest{
    Image:        "postgres:16",
    ExposedPorts: []string{"5432/tcp"},
    Env:          map[string]string{"POSTGRES_PASSWORD": "secret"},
    WaitingFor:   wait.ForLog("database system is ready"),
}
pg, _ := testcontainers.GenericContainer(ctx,
    testcontainers.GenericContainerRequest{ContainerRequest: req, Started: true})
defer pg.Terminate(ctx)
host, _ := pg.Host(ctx)
port, _ := pg.MappedPort(ctx, "5432")
```

Testcontainers gives you Go-native control over containers with
typed waits. It is heavier than docker-compose for a multi-service
stack (you wire each container yourself) but lighter for a single
dependency. For most E2E suites, docker-compose is enough;
Testcontainers is the right answer when integration-test patterns
bleed into E2E.

## Test fixtures, builders, and factories

A middle-level suite makes data setup ergonomic. Three patterns,
often combined.

**Fixtures.** Static data loaded from `testdata/`. Best for things
that do not vary (a list of countries, a known-good catalog).

```go
//go:embed testdata/catalog.json
var defaultCatalog []byte
```

`go:embed` ships the data into the binary; no path resolution at
runtime. Useful when the suite runs in containers where filesystem
layout is unpredictable.

**Builders.** A fluent API for constructing test data with sensible
defaults plus overrides.

```go
user := NewUserBuilder(tenant).WithEmail("alice@example.com").Create(t)
```

The default `email` field is `random@example.com`; the override
sets it explicitly when the test cares.

**Factories.** A function that creates a complete object graph in
one call: an order with three line items, an invoice, a payment.

```go
checkout := factories.PaidCheckout(t, tenant) // ten lines of setup, one call
```

Factories belong to feature teams; builders are usually shared in
the harness; fixtures are global. The senior pushes for the shared
ones to stay shared and the team-specific ones to stay team-specific.

## Verifying contracts alongside E2E

Pact and OpenAPI are the two common contract toolchains. Their place
relative to E2E:

- A **producer** records the contract it promises. For OpenAPI, that
  is the spec file shipped with the service. For Pact, that is the
  pact file the consumer wrote.
- A **consumer** verifies its code against the producer's contract. For
  OpenAPI, that means generating a client from the spec and using it.
  For Pact, that means running the consumer's pact tests.
- The **system** is verified by E2E. Both producer and consumer run;
  the test exercises the real wire.

A common pitfall: treating contract tests as a substitute for E2E.
They are complementary. Contracts catch shape drift; E2E catches
wiring drift. You want both, and you want to know which catches what.

A concrete example. Service A advertises `GET /widgets/{id}` returning
`{name, sku}`. Service B's generated client expects exactly that
shape. A contract test passes. Now A is deployed behind a load balancer
that rewrites `/widgets/...` to `/v2/widgets/...`. B can no longer
reach the endpoint. The contract test is still green; E2E catches it.

## Observability of the test suite itself

A suite that emits metrics about its own runs is easier to keep
healthy. Useful counters:

- `e2e_test_duration_seconds{test="..."}` — histogram per test.
- `e2e_test_attempts{test="..."}` — number of attempts inside polling
  helpers per test.
- `e2e_test_outcome{test="...", outcome="pass|fail|skip"}` — counter.

Push these to your metrics backend at the end of each run. The
dashboards reveal:

- Tests whose duration grew slowly over a quarter (creeping slowness).
- Tests whose poll-attempts count crept up (the SUT is getting
  slower at the operation the test waits for).
- Tests whose pass rate dropped (newly flaky, should be quarantined).

Without metrics, the suite drifts silently. With them, the drift is a
graph the team looks at every Monday.

## Versioning the test suite alongside the SUT

When the SUT releases a new major API version, the E2E suite must
follow. Two approaches:

**Branch the suite.** Keep `v1/` and `v2/` test directories side by
side. Each tests its respective API. Useful when both versions are
live in production simultaneously.

**Parameterise the client.** A single suite takes an `API_VERSION`
env var; the client routes requests to the matching URL prefix.
Useful when only one version is live at a time.

The mistake: rewrite the v1 tests to use the v2 API and call the work
done. You have lost the v1 coverage for the period both APIs are
live. Branch first, retire the old branch when traffic to v1 is gone.

## When to delete an E2E test

A test that has not failed in a year is either covering something that
does not change or covering something that no longer matters. Audit
yearly:

- Has the feature it covers been removed? Delete.
- Is it covered by a unit or integration test added since? Delete.
- Has it ever caught a bug in production? Keep.
- Is it part of the smoke set? Keep regardless of failure history.

A growing suite is not always a healthy suite. Pruning is a feature.

## Test organisation as the suite grows

A 10-test suite can live in one file. A 100-test suite needs structure.
The natural grouping is by feature area, mirroring the SUT's bounded
contexts:

```
test/e2e/
  e2e_test.go          // TestMain, shared setup
  helpers.go
  client/              // typed API client
  orders/
    orders_test.go     // TestE2E_Orders_*
    fixtures.go
  billing/
    billing_test.go
  smoke/
    smoke_test.go      // TestE2E_Smoke_*
```

Each feature folder is its own package. Shared helpers go in the parent
package and are imported. This layout scales to several hundred tests
without becoming a single 5000-line file.

The smoke folder is special: it contains only the deploy-blocking
tests. Running `go test -tags=e2e ./test/e2e/smoke/...` is the
post-deploy gate.

## Choosing the wait strategy

Three wait strategies cover most cases:

**Polling.** The default. Cheap, simple, works on anything observable
via the API.

**Long-polling on a webhook endpoint.** When the SUT publishes events
to a webhook, the test stands up a small `httptest.NewServer` to
receive them. (Note: this is allowed in E2E because the webhook
listener is part of the test, not part of the SUT.) The test blocks on
a channel until the expected event arrives or the deadline fires.

```go
ch := make(chan Event, 16)
srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    var e Event
    json.NewDecoder(r.Body).Decode(&e)
    ch <- e
    w.WriteHeader(204)
}))
defer srv.Close()

// register srv.URL as a webhook target on the SUT
configureWebhook(t, srv.URL)

select {
case e := <-ch:
    require.Equal(t, "order.confirmed", e.Type)
case <-time.After(30 * time.Second):
    t.Fatal("webhook event not received")
}
```

**Subscription via WebSocket / SSE.** When the SUT exposes a streaming
channel, the test subscribes and reads from it. Same shape as the
webhook pattern but the test is the client, not the server.

The choice depends on how the SUT signals events to clients. Match
the test to the real client behaviour.

## Working with feature flags

A service in production has feature flags. Your E2E suite needs to
exercise them both on and off. The pattern:

- The SUT exposes an admin API that sets a flag per tenant.
- The test allocates a tenant, sets the flag, runs the scenario,
  cleans up.

```go
tenant := newTenant(t)
require.NoError(t, tenant.SetFlag(t.Context(), "new_checkout", true))
order := tenant.PlaceOrder(t, "WIDGET", 3)
require.Equal(t, "new_checkout_v2", order.Workflow)
```

Per-tenant flags let you run on-flag and off-flag tests in parallel:
two tenants, two flag values, two scenarios, one suite. A
globally-scoped flag (the old style) serialises the suite.

## Time-sensitive flows

Tests that exercise time-based logic — a coupon that expires after 7
days, a session that times out after 30 minutes — should not literally
wait. Two options:

**Mockable clock in the SUT.** The SUT reads its clock from an
interface; an admin endpoint can advance it. The test calls the
endpoint instead of sleeping. Production behaviour and test behaviour
diverge only at the clock boundary.

**Configurable durations.** The 7-day expiry is read from config. The
test sets it to 7 seconds. Production keeps 7 days. The downside: the
test now exercises a slightly different code path (timer firing fast),
which can mask bugs that only manifest at production durations.

Most teams use a mix. Pick the option that matches the bug class you
are most worried about.

## Cross-region or multi-cluster E2E

Some services run in multiple regions. An E2E test that exercises
"write to region A, read from region B" needs both clusters in the
test environment.

For most teams this is overkill. A single-region E2E suite plus a
small cross-region smoke test (one or two scenarios that explicitly
verify replication) is enough. Full cross-region E2E becomes worth it
only when replication is a high-frequency source of bugs.

## Designing the typed client

The earlier sketch of an API client is the seed. As the suite grows,
shape the client into something maintainable.

**Group by resource.** The `Orders` client lives in `client/orders.go`,
the `Tenants` client in `client/tenants.go`. A single mega-client with
fifty methods rots faster than five focused clients of ten methods each.

```go
type Client struct {
    base  string
    token string
    h     *http.Client

    Orders  *OrdersClient
    Tenants *TenantsClient
}

func New(base, token string) *Client {
    c := &Client{base: base, token: token, h: defaultClient()}
    c.Orders = &OrdersClient{c: c}
    c.Tenants = &TenantsClient{c: c}
    return c
}
```

**Return typed errors.** A 404 from `GetOrder` is different from a
network failure. Wrap both in typed errors so the test can branch
cleanly:

```go
type APIError struct {
    Status int
    Code   string
    Msg    string
}

func (e *APIError) Error() string {
    return fmt.Sprintf("api: status %d code %s: %s", e.Status, e.Code, e.Msg)
}

func IsNotFound(err error) bool {
    var ae *APIError
    return errors.As(err, &ae) && ae.Status == 404
}
```

Tests now write `require.True(t, client.IsNotFound(err))` instead of
fragile string matches.

**Allow per-call overrides.** Some tests need a longer timeout or a
different auth context. The client takes a context and trusts the caller
to set the deadline.

```go
func (c *OrdersClient) Get(ctx context.Context, id string) (*Order, error) {
    req, _ := http.NewRequestWithContext(ctx, "GET", c.c.base+"/orders/"+id, nil)
    // ...
}
```

Inside the test:

```go
ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
defer cancel()
order, err := client.Orders.Get(ctx, id)
```

## Polling with backoff

The earlier `Eventually` helper used a fixed tick. For long deadlines,
exponential backoff is more efficient: poll fast at first, then back
off as it becomes likely the wait will be long.

```go
func EventuallyBackoff[T any](
    t *testing.T,
    deadline time.Duration,
    init, max time.Duration,
    fn func() (T, bool),
) T {
    t.Helper()
    ctx, cancel := context.WithTimeout(t.Context(), deadline)
    defer cancel()
    tick := init
    var last T
    for {
        v, ok := fn()
        if ok {
            return v
        }
        last = v
        select {
        case <-ctx.Done():
            t.Fatalf("backoff poll: deadline %s; last %v", deadline, last)
            return last
        case <-time.After(tick):
        }
        tick *= 2
        if tick > max {
            tick = max
        }
    }
}
```

For a 5-minute deadline with init 100ms and max 5s, the sequence of
polls is 100ms, 200ms, 400ms, 800ms, 1.6s, 3.2s, 5s, 5s, ... — fast at
the start when the answer is likely close, slow once the wait is
clearly long.

## Idempotency and re-running

A well-designed E2E suite can run twice in a row without manual
intervention. The discipline:

1. Every test uses a unique scope (tenant ID, idempotency key) derived
   from the test name plus a random component. Running the same test
   twice produces two distinct scopes; neither sees the other.
2. Tests do not assume an empty world. A test that counts rows and
   expects exactly N is brittle; a test that counts rows tagged with
   its own scope and expects exactly N is robust.
3. If the SUT supports idempotency keys, the test reuses the same key
   per resource within one run. Replaying the key returns the same
   record, so retries do not create duplicates.

The two-run rule is the cheapest self-test of suite hygiene. Run the
suite twice locally; if the second run fails because of state from the
first, the suite has a leak. Find it before CI does.

## The flaky test triage flow

When a test flakes — passes locally, fails occasionally in CI — work
through this list before declaring it a quirk:

1. Is there a fixed `time.Sleep` in the test or any of its helpers?
   Replace with polling.
2. Is the polling deadline tight relative to the SUT's worst-case
   latency? Loosen the deadline or, better, identify why the SUT is
   slow.
3. Is the test relying on order of events from a non-ordered source
   (Kafka without partition key, multiple goroutines)? Sort the
   observations before asserting.
4. Is the test sharing state with another test (a global counter, a
   singleton tenant)? Isolate.
5. Is the test sensitive to clock skew between the test and the SUT?
   Use the SUT's own timestamps where possible.

The first four are bugs in the test. The fifth is often a bug in the
SUT's clock handling that production has not yet exposed.

## kind and k3d for Kubernetes-shaped systems

For services that ship as Kubernetes manifests, the realistic E2E env is
a Kubernetes cluster — not a docker-compose stack. Two popular options:

**`kind`** (`sigs.k8s.io/kind`) runs upstream Kubernetes inside Docker.
Use it when you want full Kubernetes API compatibility and do not mind
the startup cost (60-120 s on a CI runner).

```bash
kind create cluster --name e2e
kubectl --context kind-e2e apply -f testdata/k8s/
kubectl --context kind-e2e wait --for=condition=Available deployment/api
```

**`k3d`** runs `k3s` (lightweight Kubernetes) inside Docker. Faster
startup (15-40 s) at the cost of minor feature differences vs upstream
Kubernetes.

```bash
k3d cluster create e2e
kubectl --context k3d-e2e apply -f testdata/k8s/
```

The choice between them is usually team preference plus the depth of
Kubernetes feature usage. For most application services, k3d is fine;
for tests that exercise admission webhooks or specific scheduler
behaviour, kind is closer to production.

Wrap the cluster bring-up in `TestMain` so each test binary owns its
cluster. Tear down on exit. If the suite runs in CI on a shared runner,
include the runner ID in the cluster name so two concurrent jobs do not
collide.

```go
clusterName := "e2e-" + os.Getenv("CI_JOB_ID")
exec.Command("kind", "create", "cluster", "--name", clusterName).Run()
t.Cleanup(func() {
    exec.Command("kind", "delete", "cluster", "--name", clusterName).Run()
})
```

## Port-forward, ingress, or NodePort?

Tests need to reach the service running in the cluster. Three options:

- **Port-forward** (`kubectl port-forward svc/api 8080:80`). Simplest;
  binds a local port to the in-cluster service. Drawback: an extra
  process to manage and a port to keep alive.
- **NodePort**. Expose the service on a port on each node. Good for kind
  where the node maps to a fixed Docker container port.
- **Ingress + DNS hack**. Run an ingress controller in the cluster and
  add an entry to `/etc/hosts`. Realistic, but slow to set up.

For most test suites, port-forward via a background process is the
right balance. A small helper:

```go
func portForward(ctx context.Context, t *testing.T, svc string) string {
    t.Helper()
    cmd := exec.CommandContext(ctx, "kubectl", "port-forward",
        "svc/"+svc, ":80")
    stdout, _ := cmd.StdoutPipe()
    require.NoError(t, cmd.Start())
    t.Cleanup(func() { cmd.Process.Kill() })

    // Parse "Forwarding from 127.0.0.1:54321 -> 80" line.
    sc := bufio.NewScanner(stdout)
    for sc.Scan() {
        if port := extractPort(sc.Text()); port != "" {
            return "http://127.0.0.1:" + port
        }
    }
    t.Fatal("port-forward did not announce port")
    return ""
}
```

The binding-to-zero pattern (`svc/api:0:80` → kubectl picks a free
local port) avoids collisions when the suite runs in parallel.

## Postgres in E2E

Real databases catch real bugs. The pattern: bring up a Postgres
container in the same compose stack as the SUT; let the SUT run its
migrations on startup; assert through the API only — do not query the
DB directly from the test.

Why "do not query the DB"? Because querying the DB couples the test to
the schema. A schema change that does not affect the API breaks the
test. Tests should bind to the API contract, not the schema.

There is a controlled exception: a janitor query that counts rows for
a leak check at the end of the test run. This is operational, not
assertive — the test does not fail on a row count, it just logs it for
a human to review.

```go
// at the very end of TestMain
db, _ := sql.Open("pgx", os.Getenv("E2E_DB_DSN"))
var n int
db.QueryRow("SELECT count(*) FROM orders WHERE tenant_id LIKE 'e2e-%'").Scan(&n)
log.Printf("e2e tenant orders remaining: %d", n)
```

A non-zero count after teardown means a test forgot to clean up. The
log line is your early-warning system.

## Network policies and the SUT

A service that runs in production behind a strict network policy may
allow only specific source IPs to reach it. Your E2E test from a CI
runner does not satisfy the source-IP constraint. Two responses:

1. Provision a test-only ingress that allows the CI runner range.
2. Run the suite from inside the cluster (as a pod) so it has a
   cluster-local source.

Option 2 is more production-realistic but harder to set up. Option 1 is
the common compromise. Either way, make the policy explicit and version
it alongside the service: a future deploy that changes the policy
should also update the test ingress.

## gRPC E2E

For gRPC services, the equivalent of `net/http` is the generated client
plus `google.golang.org/grpc`. The shape mirrors HTTP:

```go
conn, err := grpc.Dial(grpcAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
require.NoError(t, err)
defer conn.Close()

client := orderspb.NewOrdersServiceClient(conn)

resp, err := client.CreateOrder(t.Context(), &orderspb.CreateOrderRequest{
    Sku: "WIDGET", Qty: 3,
})
require.NoError(t, err)
require.NotEmpty(t, resp.OrderId)
```

A few gRPC-specific gotchas:

- Auth is usually a header (`metadata.AppendToOutgoingContext(ctx,
  "authorization", "Bearer "+token)`). The `client.CreateOrder` call uses
  this context.
- Errors carry a status code (`codes.Unauthenticated`, `codes.NotFound`)
  in addition to a message. Assert on the code for stable tests:
  `require.Equal(t, codes.NotFound, status.Code(err))`.
- Streaming RPCs require a receive loop, and the loop needs an explicit
  deadline lest the test hang waiting for a server that never closes.

For services that expose both HTTP and gRPC, write the E2E test against
both interfaces. They share a backend, but the framing layers can drift.

## Eventual consistency at the edge

A service that writes to Postgres and then publishes an event to Kafka
has two consistency boundaries: the DB commit and the Kafka publish.
The API responds 201 as soon as the DB commits; the downstream
consumer sees the event some time later.

An E2E test that asserts "downstream consumer received event X within
30 seconds" requires either:

- A downstream observer the test can query (a small service that
  records the events it has seen). The test polls the observer.
- A side-effect that bubbles back through the SUT's API (an order goes
  from `pending` to `confirmed` only after the downstream consumer
  acknowledges).

The first is more direct; the second is more realistic. The choice
depends on how much test scaffolding the team is willing to deploy.

A common mistake: asserting on a Kafka topic directly via a test-only
consumer. This works but couples the test to the broker's topic name
and partition layout. Prefer asserting on observable state somewhere in
the application stack.

## Working with a `db.sql` snapshot

For suites that need a populated database — a catalog of 10k items, a
graph of related records — seeding via the API at test time is too slow.
The pattern: load a SQL dump once in `TestMain`.

```go
func seed(dsn string) {
    cmd := exec.Command("psql", dsn, "-f", "testdata/seed.sql")
    if out, err := cmd.CombinedOutput(); err != nil {
        log.Fatalf("seed: %v\n%s", err, out)
    }
}
```

Keep the seed file under `testdata/`. Version it. Update it when the
schema changes. A drifted seed file is a slow-rolling outage waiting to
happen — migrations applied at SUT startup will fail against a stale
dump, and the next E2E run will look like a regression in the SUT.

## Schema migrations in E2E

The SUT runs its own migrations on startup. Your test should not run
migrations directly. The reason: tests asserting on a fresh
post-migrations schema implicitly cover the migration path the
production deploy will take. If the test bypasses migrations and seeds
a hand-crafted schema, you have lost that coverage.

Watch the SUT's startup log for the migration step:

```
INFO migration applied: 0042_add_archived_column
INFO http listener bound: 0.0.0.0:8080
```

A `/health` endpoint that returns 200 only after migrations complete
is the right readiness signal. The test waits on `/health`, the SUT
declares ready only when it is genuinely ready, and migrations happen
exactly as they will in production.

## Pyramid pressure

The middle engineer is the person on the team who keeps the pyramid honest.
"We had a bug, let's add an E2E test" is the wrong default. The right
default is "what is the smallest test that would have caught it?" If the
answer is "a unit test", write the unit test. E2E is reserved for things
nothing else can catch — schema migration applied to a real DB,
cross-service auth, deployment configuration.

## Recording HTTP transcripts on failure

When a test fails, the engineer needs to see the exact bytes that
crossed the wire. Add a transport that records request and response and
flushes the recording on test failure.

```go
type recordingTransport struct {
    inner http.RoundTripper
    log   []string
    mu    sync.Mutex
}

func (rt *recordingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
    reqDump, _ := httputil.DumpRequestOut(req, true)
    resp, err := rt.inner.RoundTrip(req)
    rt.mu.Lock()
    rt.log = append(rt.log, string(reqDump))
    if resp != nil {
        respDump, _ := httputil.DumpResponse(resp, true)
        rt.log = append(rt.log, string(respDump))
    }
    rt.mu.Unlock()
    return resp, err
}

func newRecordingClient(t *testing.T) *http.Client {
    rt := &recordingTransport{inner: http.DefaultTransport}
    t.Cleanup(func() {
        if !t.Failed() {
            return
        }
        path := filepath.Join(artifactDir(t), "http.log")
        os.WriteFile(path, []byte(strings.Join(rt.log, "\n---\n")), 0o644)
    })
    return &http.Client{Transport: rt, Timeout: 30 * time.Second}
}
```

`httputil.DumpRequestOut` and `DumpResponse` produce human-readable
records of headers and body. The cost is mostly the body buffering;
acceptable for E2E.

A caveat: dump output contains auth tokens. Add a redaction step before
writing:

```go
redacted := regexp.MustCompile(`(?i)(authorization:\s*bearer\s+)\S+`).
    ReplaceAllString(s, "${1}REDACTED")
```

## Working with WebSocket and Server-Sent Events

Some services expose real-time channels. For WebSocket, the standard
library is enough for tests:

```go
import "github.com/coder/websocket"

conn, _, err := websocket.Dial(t.Context(), wsURL, nil)
require.NoError(t, err)
defer conn.CloseNow()

err = conn.Write(t.Context(), websocket.MessageText, []byte("hello"))
require.NoError(t, err)

_, msg, err := conn.Read(t.Context())
require.NoError(t, err)
require.Equal(t, []byte("hello back"), msg)
```

For SSE, an `http.Response` body is a sequence of `data: ...` lines.
A small reader loop with a deadline:

```go
req, _ := http.NewRequestWithContext(t.Context(), "GET", baseURL+"/events", nil)
req.Header.Set("Accept", "text/event-stream")
resp, _ := client.Do(req)
defer resp.Body.Close()

sc := bufio.NewScanner(resp.Body)
deadline := time.Now().Add(10 * time.Second)
for sc.Scan() && time.Now().Before(deadline) {
    if strings.HasPrefix(sc.Text(), "data: order-confirmed") {
        return
    }
}
t.Fatal("did not receive expected event")
```

The deadline is essential. An SSE channel that goes silent and never
closes hangs the test until the binary timeout fires.

## CI integration

A middle engineer wires the suite into CI without surprises. The shape:

- Define an `e2e` job in the CI config. It depends on `unit` and
  `integration` passing first.
- The `e2e` job has a generous timeout (30-45 min) and uploads the
  artefact directory on failure.
- The job runs on a dedicated runner pool when E2E is resource-heavy,
  not the same pool as unit tests.
- Cache Docker images and Go modules to cut startup time.

```yaml
e2e:
  needs: [unit, integration]
  timeout-minutes: 45
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-go@v5
      with:
        go-version: '1.24'
    - run: go build ./...
    - run: docker compose -f test/e2e/testdata/compose.yml up -d
    - run: go test -tags=e2e -v -timeout=30m ./test/e2e/...
      env:
        E2E_REQUIRED: '1'
        E2E_ARTIFACTS_DIR: ${{ github.workspace }}/artifacts
    - if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: e2e-artifacts
        path: ${{ github.workspace }}/artifacts
```

The artefact upload is the difference between "the test failed" and
"the test failed and here is exactly what happened." Make it
automatic.

## Patterns to know by heart

A middle engineer recognises and uses without prompting:

**Page Object / Screen Object.** For browser E2E, factor each page into a
struct with methods that perform actions: `LoginPage.Submit(email,
password)`. Tests read as English; selector changes touch one struct, not
fifty tests.

```go
type LoginPage struct{ ctx context.Context }

func (p LoginPage) Submit(email, password string) error {
    return chromedp.Run(p.ctx,
        chromedp.SendKeys(`[data-testid="email"]`, email),
        chromedp.SendKeys(`[data-testid="password"]`, password),
        chromedp.Click(`[data-testid="submit"]`),
        chromedp.WaitVisible(`[data-testid="greeting"]`),
    )
}
```

**Builders for test data.** Instead of repeating ten lines of order
construction in every test, build a `OrderBuilder` with sensible defaults:

```go
type OrderBuilder struct{ sku string; qty int; tenant *Tenant }

func (b OrderBuilder) WithSKU(s string) OrderBuilder { b.sku = s; return b }
func (b OrderBuilder) WithQty(n int) OrderBuilder    { b.qty = n; return b }
func (b OrderBuilder) Create(t *testing.T) *Order {
    return b.tenant.CreateOrder(t, b.sku, b.qty)
}

// Usage:
order := NewOrder(tenant).WithSKU("WIDGET").Create(t)
```

The defaults make 80% of tests one-line; the builder method-chain makes
the 20% explicit.

**Scoped fixtures via `t.Cleanup`.** Every resource a test creates is
torn down by a `t.Cleanup` registered at creation time. The test does not
end with a cleanup block; cleanup is co-located with creation.

```go
func (c *Client) CreateOrder(t *testing.T, sku string, qty int) *Order {
    // ... POST /orders ...
    order := decoded
    t.Cleanup(func() { c.DeleteOrder(context.Background(), order.ID) })
    return order
}
```

Cleanup runs in LIFO order, so an order created after a tenant is
deleted before the tenant — correctly.

## Debugging a failing E2E suite

When the suite turns red, the diagnostic order at this level is:

1. Read the failing test's output. Did it produce a useful message?
   If not, fix the message before fixing the bug.
2. Read the artefacts. Screenshots, container logs, HTTP transcripts.
   For most failures the artefact tells you what happened.
3. Re-run only the failing test (`go test -run '^TestE2E_X$'`). A test
   that fails alone is a deterministic bug; a test that passes alone
   but fails in the suite has a shared-state issue.
4. Re-run in a loop (`for i in $(seq 1 50); do go test ...; done`). If
   it fails 50 out of 50, the bug is consistent. If it fails 5 out of
   50, the bug is timing-related.
5. Bisect git history if the failure is new. `git bisect run go test
   -run '...'` finds the commit that introduced the regression.

The most expensive mistake at this level: assuming the test is broken
without checking the SUT. A flaky test often points at a real SUT bug
that production has not yet hit. Treat flake as a yellow flag, not a
green one.

## What changes from middle to senior

A middle engineer keeps a healthy suite running. A senior engineer
shapes the suite for the future: which tests should exist at all, what
hooks the SUT should expose for testability, how the budget evolves as
the system grows. The technical mechanics are the same; the leverage
moves up a layer.

