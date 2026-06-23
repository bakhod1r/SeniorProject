---
layout: default
title: E2E Tests — Optimize
parent: E2E Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/14-e2e-tests/optimize/
---

# E2E Tests — Optimize

[← Back](../)

E2E suites are the slowest, most expensive layer of the pyramid. The temptation
is to throw machines at them. Before you do, optimize the suite itself. Every
minute removed from the suite is a minute saved on every CI run, every
developer iteration, every nightly cycle.

## 1. Cut the startup tax

Naive E2E suites pay full environment startup per test. A 60-test suite that
boots a docker-compose stack each time will run for the lifetime of the
heat-death of the universe. Boot once per suite, not once per test.

```go
func TestMain(m *testing.M) {
    env := startEnv()           // docker-compose up, wait for /health
    defer env.Stop()
    code := m.Run()
    if code != 0 {
        env.DumpLogs()
    }
    os.Exit(code)
}
```

If a single test mutates global state (a feature flag, a schema), isolate that
test in its own subprocess invocation — do not penalize the other 59 tests.

A second category of startup tax is the build itself. If your suite builds
the binary in `TestMain` (correct), build with `-trimpath` and
`-buildvcs=false` and cache the result. On CI, set `GOCACHE` to a path that
survives across builds — the second invocation skips compilation entirely.

## 2. Parallelize per-tenant

The standard parallel pattern: every test allocates a fresh tenant ID and a
fresh user inside that tenant. Tests touch only their own tenant. With 32
parallel workers and tenant-scoped data, a 1-hour serial suite drops to 2-3
minutes wall-clock.

```go
func TestE2E_Order(t *testing.T) {
    t.Parallel()
    tenant := newTenant(t) // unique per call
    // ... test uses tenant.ID for all data
}
```

Cap `-parallel` to the number of cores on the runner and to the connection
pool size on the SUT. Set `t.Parallel()` only after expensive setup so
serialized setup work runs at full speed.

Watch for hidden serialization. A test that takes a global mutex — say to
reset a feature flag — turns a parallel suite into a serial one. Replace
the mutex with per-tenant feature flags whenever possible.

## 3. Skip the browser when an API call suffices

Browser-driven tests are 10-100x slower than API tests. Reserve them for
flows that exercise actual frontend behavior (forms, routing, hydration).
Login, data setup, and assertions on backend state should go through the
API. A common pattern: log in via API, set the resulting cookie/token on the
browser context, then drive only the UI step that matters.

```go
token := apiLogin(t, "alice@example.com")
ctx, cancel := chromedp.NewContext(allocCtx)
defer cancel()
chromedp.Run(ctx,
    chromedp.Navigate("https://app.example.com"),
    setCookie("session", token),
    chromedp.Navigate("https://app.example.com/dashboard"),
    chromedp.WaitVisible(`#dashboard-header`),
)
```

The handful of seconds saved per test, multiplied by hundreds of tests, is the
difference between a 3-minute suite and a 30-minute suite.

## 4. Reuse browser contexts when safe

In `chromedp`, allocate the browser once per test binary, not per test. Each
test gets its own context via `chromedp.NewContext(parentCtx)` which spawns a
fresh tab. Tabs are cheap; browsers are not.

```go
var rootCtx context.Context

func TestMain(m *testing.M) {
    alloc, cancelAlloc := chromedp.NewExecAllocator(context.Background(),
        chromedp.Headless,
        chromedp.NoSandbox,
    )
    defer cancelAlloc()
    rootCtx, _ = chromedp.NewContext(alloc)
    if err := chromedp.Run(rootCtx); err != nil {
        log.Fatal(err)
    }
    os.Exit(m.Run())
}
```

`playwright-go` follows the same shape: launch once in `TestMain`, allocate
a fresh `BrowserContext` per test for isolation, close on cleanup.

## 5. Tighten waits

Conditional polling beats fixed sleep. A test that sleeps 5s "to be safe"
multiplied by 200 tests adds 17 minutes of pure idle. Replace with poll-until,
deadline-bounded:

```go
require.Eventually(t, func() bool {
    return statusOf(orderID) == "shipped"
}, 30*time.Second, 100*time.Millisecond)
```

`Eventually` returns as soon as the predicate is true; the cap is only a
ceiling. Pick the poll interval based on the cheapest probe (100ms for
in-memory state, 500ms for a database round-trip, 1s for an external API).

Even better: when the SUT can push, use a webhook or SSE channel and `select`
on it. The test wakes up when the event happens, not when the next tick
fires.

## 6. Cache infrastructure

The slowest steps in a fresh CI environment are pulling images and bringing
up Postgres. Cache:

- Docker layer cache (`docker buildx --cache-from`).
- `kind` node image (pin a version, prewarm in the runner image).
- `k3d` images (similar — pin and prewarm).
- Postgres `data/` snapshot at the "post-migrations, no rows" point. Restore
  with `pg_restore` or by mounting a tmpfs volume seeded once.

For CI providers that bill per minute, an extra 5 GB of cache often costs
less than 30 extra seconds of compute.

## 7. Run only what changed

For per-commit CI, run a smoke subset (10-20 critical paths) plus the tests
touching modules in the diff. Use Go's `-run` with a regex assembled from
changed packages. Run the full nightly suite once a day.

```bash
go test -tags=e2e -run 'TestE2E_(Order|Checkout|Login)' ./test/e2e/...
```

A simple `git diff --name-only origin/main...HEAD` plus a mapping file
("paths under cmd/orders → TestE2E_Order.*") usually covers it without a
sophisticated test selector.

## 8. Measure before optimizing

`go test -tags=e2e -v ./test/e2e/... 2>&1 | grep -E 'PASS|FAIL' | sort -k3 -n`
gives you per-test durations. The top 10 slowest tests are usually
responsible for 80% of the wall-clock time. Fix those first. Common culprits:
a 60-second timeout that fires every run, a polling loop with too-coarse an
interval, a test that does setup work usable by ten other tests.

Run the suite twice and watch for tests whose duration varies by more than
2x between runs — they have hidden timing dependencies and will eventually
become flake sources.

## 9. Budget

Define and enforce a wall-clock budget. Per-commit smoke: ≤ 5 min. Nightly
full suite: ≤ 30 min. A test that pushes the budget past the cap must either
move down the pyramid (rewrite as integration) or earn its keep by covering
a flow nothing else covers.

A budget is meaningful only if it has an owner. Assign the budget to a
person — usually a tech lead — who reviews monthly and either prunes or
optimizes.

A useful tool: a "slowest tests" report generated by every CI run.

```bash
go test -tags=e2e -v -json ./test/e2e/... |
  jq -r 'select(.Action=="pass") | "\(.Elapsed) \(.Test)"' |
  sort -rn | head -20
```

The top 20 list is the prioritised optimisation backlog. Knock the
biggest down first.

## 12. The TestMain ordering trap

If `TestMain` brings up the env and then runs tests, the env stays up
for the entire `m.Run()` call. If two test packages each have their
own `TestMain` and they run sequentially in `go test ./...`, each
package brings up its own env. Two minutes per package × ten packages
= twenty wasted minutes.

Fix: a single shared package owns the env. Other packages import it
and assume it is up.

```go
// test/e2e/internal/env/env.go
var Shared *Env  // populated by an init step in the parent TestMain

// test/e2e/orders/orders_test.go
import "test/e2e/internal/env"
// uses env.Shared, does not start its own
```

The parent runs all sub-suites in one `go test` invocation; the env
is shared.

## 13. Compose vs Testcontainers vs kind

For environment bring-up, three popular choices:

- **docker compose** — declarative YAML, easy to read, slow to bring
  up because all services start together.
- **testcontainers-go** — programmatic, services started one by one
  with explicit waits, easier to debug because each container has a
  Go object you can inspect.
- **kind / k3d** — full Kubernetes, slowest, most realistic for
  Kubernetes-native services.

The right choice is the one that matches production. Optimisation
trade-offs differ: compose benefits from pre-pulled images;
testcontainers benefits from reuse mode (`testcontainers.WithReuse`)
which keeps containers alive across test binary runs; kind benefits
from pre-warmed node images and pinned versions.

## 14. The lazy-init pattern

Some setup is needed only for a subset of tests. Lazy-initialise it:

```go
var (
    kafkaOnce sync.Once
    kafkaURL  string
)

func ensureKafka(t *testing.T) string {
    t.Helper()
    kafkaOnce.Do(func() { kafkaURL = startKafka() })
    return kafkaURL
}
```

Tests that need Kafka call `ensureKafka(t)`. Tests that do not skip
the startup. A suite of 100 tests where only 10 use Kafka saves 90%
of the Kafka start cost.

The pattern requires care with cleanup: `sync.Once`-initialised
state cannot be torn down by `t.Cleanup` because it lives across
tests. Move teardown to `TestMain` or a top-level cleanup. The
trade-off: a small amount of extra wiring for a large amount of
saved time.

## 15. Parallel browser tabs

`chromedp` lets you allocate one browser and many tabs. Tabs are
much cheaper than browsers. A 50-test browser suite that allocates a
browser per test pays the launch cost 50 times; allocating a tab per
test pays once. Numbers from a typical CI runner: browser launch
~1.5 s, tab launch ~50 ms. Per-test browser is ~75 s of startup
across the suite; per-test tab is ~2.5 s.

The catch: tabs share cookies and storage by default. Use
`chromedp.NewContext(parent, chromedp.WithBrowserContext("test-N"))`
to get an isolated browser context per test, which is the right
trade-off between speed (one browser process) and isolation (no
shared state across tabs).

## 10. Reuse expensive fixtures

Some fixtures are expensive: a populated catalog of 10k items, a tenant
with 100 users, a pre-computed report. Create them once in `TestMain` and
let read-only tests share them. Tests that mutate the fixture allocate their
own copy.

```go
var sharedCatalog *Catalog

func TestMain(m *testing.M) {
    sharedCatalog = seedCatalog()
    os.Exit(m.Run())
}
```

The discipline that makes this safe: tests must declare intent. A test that
takes the shared fixture as a read-only view writes its name into a list;
a test that needs to mutate calls `forkCatalog()` and gets its own copy.

## 11. Stop the bleeding before the optimisation

If the suite is unreliable, optimizing it for speed is wasted effort —
nobody trusts the green run anyway. Restore reliability first (fix
flake-prone waits, fix shared state) and only then squeeze the clock. A
reliable 30-minute suite is more useful than a flaky 5-minute one.
