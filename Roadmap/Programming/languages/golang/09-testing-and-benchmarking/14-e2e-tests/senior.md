---
layout: default
title: E2E Tests — Senior
parent: E2E Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/14-e2e-tests/senior/
---

# E2E Tests — Senior

[← Back](../)

A senior engineer owns the shape of the E2E suite as a long-lived asset.
The tests must keep working as the team grows, the infrastructure evolves,
and the SUT acquires more dependencies. The technical work is mostly the
same; the leverage comes from a small number of architectural choices made
correctly once.

## The pyramid contract

Every team that takes testing seriously eventually writes down — or
implicitly enforces — a contract that constrains what goes into each
layer. A workable contract:

- **Unit**: in-process, no I/O, no time, no goroutines unless explicitly
  required by the unit under test. Sub-millisecond.
- **Integration**: in-process, real adjacent components (DB, Redis, file
  system). Sub-second.
- **E2E**: out-of-process SUT, real wiring, client-perspective only.
  Single-digit seconds per test ideally; tens of seconds tolerated for
  flows that cannot be smaller.

When a bug is filed, the senior asks: "what is the smallest layer that
would have caught this?" If the answer is unit, the team writes a unit
test; the bug does not become an E2E test by default. E2E tests inherit
their cost forever, and that cost compounds. A pyramid that tilts inverted
will not be fixed by adding more runners; it will be fixed by writing more
unit tests for the same risks.

## Designing the SUT to be testable from the outside

A surprising number of E2E flake stories trace back to the SUT, not the
test. A service that does not expose a reliable readiness signal forces
the test to poll random endpoints. A service that mutates time only via
`time.Now` makes deadline-sensitive flows untestable in finite wall-clock.

The interventions a senior pushes for:

- A **readiness endpoint** that returns 200 only when migrations are
  applied, dependencies are reachable, and background workers have
  started. The E2E suite waits on this before running any test. The
  endpoint is part of the deploy contract.
- An **operations API** namespaced under `/ops/...` (admin-only) that
  exposes commands the suite needs but the public API does not: force a
  worker to drain, advance an internal scheduler, eject a connection
  from a pool. These are explicitly designed for tests and ops, with
  separate authorization.
- A **deterministic ID** option for tests. Allow the test, when
  authenticated with a privileged token, to supply an idempotency key
  that becomes the row's primary key. Tests then know the ID without
  parsing the response.
- A **logical clock hook**: a header `X-Test-Now: <RFC3339>` accepted only
  from the test tenant which the service uses in lieu of `time.Now` for
  business logic (not for monotonic measurements). This lets a 30-day
  expiry flow be tested in 30 seconds.

These are production-grade interventions. They are not test-only debug
toggles. They have auth, audit, and observability — the same as any other
admin surface.

## The Eventually pattern in production

`require.Eventually` is fine for one-off polls. A long-running suite
deserves a more capable helper:

```go
type Probe[T any] struct {
    Name     string
    Deadline time.Duration
    Tick     time.Duration
    Fn       func(context.Context) (T, error)
    Done     func(T) bool
}

func Wait[T any](t *testing.T, p Probe[T]) T {
    t.Helper()
    if p.Deadline == 0 {
        p.Deadline = 30 * time.Second
    }
    if p.Tick == 0 {
        p.Tick = 200 * time.Millisecond
    }
    ctx, cancel := context.WithTimeout(t.Context(), p.Deadline)
    defer cancel()

    start := time.Now()
    var last T
    var lastErr error
    attempts := 0
    for {
        attempts++
        v, err := p.Fn(ctx)
        last, lastErr = v, err
        if err == nil && p.Done(v) {
            t.Logf("probe %q satisfied after %s, %d attempts", p.Name, time.Since(start), attempts)
            return v
        }
        select {
        case <-ctx.Done():
            t.Fatalf("probe %q deadline %s exceeded; %d attempts; last=%v err=%v",
                p.Name, p.Deadline, attempts, last, lastErr)
            return last
        case <-time.After(p.Tick):
        }
    }
}
```

The helper logs the number of attempts. Reviewing those numbers across a
suite reveals tests that pass on the first attempt (deadline is fine) and
tests that pass only on the 50th attempt (deadline is concealing a real
performance regression in the SUT).

## Shared infra, per-tenant isolation

Two patterns work for environment sharing. Each has trade-offs.

**Pattern A: shared staging, per-tenant isolation.** One long-lived
environment exists; every test allocates a unique tenant. The environment
mirrors production topology and includes load balancers, sidecars, and
realistic networks. Drawback: contamination is possible. Mitigation: a
nightly purge of `e2e-*` tenants older than a week, and an alert when the
tenant count exceeds a threshold.

**Pattern B: ephemeral env per run.** A `kind` or `k3d` cluster spins up
in CI, applies the manifests, runs the suite, tears down. Each PR sees a
fresh world. Drawback: startup tax is real (60-180 s on most CI runners
to bring up Kubernetes + workloads + migrations). Mitigation: pre-pull and
cache images, snapshot migrations.

Mature teams use both: pattern A for the nightly full suite (closest to
production) and pattern B for per-commit smoke (closest to PR feedback).

## Browser E2E without a flake army

`github.com/chromedp/chromedp` and `github.com/playwright-community/playwright-go`
both work. The choice is less important than how you use them.

**Stable selectors.** Do not rely on CSS classes that the design system
might rename. Use `data-testid` attributes baked into the frontend
specifically for tests. The frontend code looks like:

```html
<button data-testid="checkout-confirm">Confirm</button>
```

and the test looks like:

```go
chromedp.Click(`[data-testid="checkout-confirm"]`)
```

Renaming `class="btn btn-primary"` to `class="button button--accent"`
breaks the styling, not the suite.

**Visibility before action.** Always wait for the target to be visible
(and enabled, when relevant) before interacting. The shorthand:

```go
func clickWhenReady(sel string) chromedp.Tasks {
    return chromedp.Tasks{
        chromedp.WaitVisible(sel),
        chromedp.WaitEnabled(sel),
        chromedp.Click(sel),
    }
}
```

**Capture on failure.** Wire a `t.Cleanup` that takes a screenshot and
dumps the rendered HTML when the test failed. Keep the JS console output
too; it often points to the real cause.

```go
func browserArtifacts(t *testing.T, ctx context.Context) {
    t.Helper()
    t.Cleanup(func() {
        if !t.Failed() {
            return
        }
        dir := artifactDir(t)
        var png []byte
        var html string
        _ = chromedp.Run(ctx,
            chromedp.CaptureScreenshot(&png),
            chromedp.OuterHTML("html", &html),
        )
        os.WriteFile(filepath.Join(dir, "page.png"), png, 0o644)
        os.WriteFile(filepath.Join(dir, "page.html"), []byte(html), 0o644)
    })
}
```

**Login via API, drive UI only when needed.** The slowest part of any
browser test is rendering. Bypass login by hitting the API, set the
returned cookie on the browser context, then drive only the screen the
test cares about. A typical test goes from 25 seconds to 4.

## Driving CLIs

Many Go ecosystems include a CLI shipped alongside the service. The CLI is
its own SUT.

```go
func TestE2E_CLIGreet(t *testing.T) {
    cmd := exec.Command("./bin/mytool", "greet", "--name=Alice")
    out, err := cmd.CombinedOutput()
    require.NoError(t, err, "output: %s", out)
    require.Contains(t, string(out), "Hello, Alice")
}
```

Interactive CLIs need a PTY. The `github.com/creack/pty` library spawns a
process attached to a pseudo-terminal so the CLI sees a real TTY and your
test can write prompts:

```go
import "github.com/creack/pty"

func TestE2E_CLIPrompt(t *testing.T) {
    cmd := exec.Command("./bin/mytool", "greet")
    ptmx, err := pty.Start(cmd)
    require.NoError(t, err)
    defer ptmx.Close()

    var out bytes.Buffer
    done := make(chan struct{})
    go func() { _, _ = io.Copy(&out, ptmx); close(done) }()

    fmt.Fprintln(ptmx, "Alice")
    cmd.Wait()
    <-done

    require.Contains(t, out.String(), "Hello, Alice")
}
```

For commands that read stdin without a TTY (because the test is fine
piping bytes), skip the PTY:

```go
cmd := exec.Command("./bin/mytool", "greet")
cmd.Stdin = strings.NewReader("Alice\n")
out, _ := cmd.Output()
```

## Idempotency and isolation

A senior writes tests that survive being run twice in a row without manual
cleanup. Two techniques.

**Tenant-scoped data.** Every row carries a tenant ID. The test sees only
its tenant. Re-runs land in a new tenant and never see the old one.

**Idempotency keys.** When the SUT supports them, the test passes a
deterministic key derived from the test name plus the run ID. Replaying
the same key returns the same row instead of creating a duplicate. The
test then asserts on identity, not on count.

The lazy version of isolation — "I will just delete everything at the
start" — does not survive parallelism. The moment two tests run together,
one truncates the other's state mid-flight.

## Test data lifecycle

Shared envs accrete data. Three layers of defence:

1. **Per-test cleanup.** Every resource the test creates is deleted in
   `t.Cleanup`. Failures still trigger cleanup.
2. **Per-suite sweep.** At the start of the suite, delete any tenants
   matching the current `RUN_ID` prefix that survived prior crashes.
3. **Nightly janitor.** A scheduled job deletes `e2e-*` tenants older than
   a week. This is the catch-all.

Document the schema so the janitor knows where to look. A new feature that
introduces a tenant-scoped table without telling the janitor will silently
leak rows.

## CI scheduling

A working schedule:

| Trigger        | Suite           | Wall-clock budget | Blocks |
|----------------|-----------------|-------------------|--------|
| PR push        | unit + smoke    | ≤ 5 min           | merge  |
| Merge to main  | unit + smoke    | ≤ 5 min           | deploy |
| Post-deploy    | smoke           | ≤ 2 min           | promote |
| Nightly        | full E2E        | ≤ 30 min          | release-tagging |
| Weekly         | full + load     | ≤ 2 h             | release |

Smoke runs on every change. Full runs on its own schedule. The full suite
result is reviewed every morning by the on-call. New failures get tickets;
old failures get unwound or quarantined.

## Flake budget

A test that flakes makes engineers ignore failures. The cure is policy:

- Two flakes in seven days → automatic quarantine (marked with `t.Skip`
  and a `// FLAKE-<ticket>` comment).
- Quarantined tests appear in a daily report.
- Two weeks in quarantine without a fix → delete the test. If the risk
  matters, write a smaller test that does not flake.

Track the quarantine count as a leading indicator of suite health.

## Cost discipline

E2E runners cost real money. Track the monthly bill alongside the test
count. Three questions every quarter:

1. Did the E2E suite catch any production-relevant bug we would have
   missed otherwise?
2. Did anything in production break that the E2E suite should have caught
   but did not?
3. What fraction of CI minutes does E2E consume vs unit + integration?

A healthy team answers question 1 with at least a few examples per
quarter, question 2 with concrete plans to add the missing coverage, and
question 3 with E2E in the 10-30% band — not 70%.

## Test harness design

The harness is the code that brings up the environment, builds the SUT,
configures the suite, and runs the tests. A well-designed harness is a
small library — a few hundred lines — and a contract.

The contract:

- `harness.Setup(t *testing.T)` returns a `*Env` with the URLs,
  tokens, and clients the test needs.
- `harness.Cleanup` runs automatically via `t.Cleanup`.
- `harness.Env` is read-only after Setup; tests do not mutate it.
- Environment selection (compose vs kind vs external) is invisible
  to the test.

```go
type Env struct {
    BaseURL string
    Token   string
    Client  *Client
    DB      *sql.DB  // for audit queries only
    Logs    LogReader
}

func Setup(t *testing.T) *Env { /* ... */ }
```

Tests look identical regardless of mode:

```go
func TestE2E_X(t *testing.T) {
    env := harness.Setup(t)
    env.Client.Orders.Create(...)
}
```

This pattern keeps environment changes invisible to test authors. A
team that adds a new env (say, swapping kind for k3d for speed)
touches the harness, not the 200 tests.

## Capturing logs the right way

A test's failure artefacts must include enough to diagnose without a
re-run. For containerised SUTs, the canonical sources:

- Container stdout/stderr (`docker logs <id>` or `kubectl logs
  <pod>`).
- The structured-log query URL for the test's request IDs.
- Any panic stacks the SUT emitted.

A `LogReader` abstraction lets the harness swap implementations:

```go
type LogReader interface {
    Tail(ctx context.Context, service string, n int) ([]string, error)
}

type dockerComposeLogs struct{ projectDir string }

func (d *dockerComposeLogs) Tail(ctx context.Context, svc string, n int) ([]string, error) {
    out, err := exec.CommandContext(ctx, "docker", "compose", "-f",
        d.projectDir+"/compose.yml", "logs", "--tail",
        strconv.Itoa(n), svc).Output()
    if err != nil {
        return nil, err
    }
    return strings.Split(string(out), "\n"), nil
}
```

`kubectl` and external (Loki / CloudWatch) implementations are
similar shape, different commands.

## Picking a CI provider's primitives

Each CI provider exposes slightly different primitives. The senior's
job is to map the suite onto them without coupling the suite to one
vendor.

- **Artefact upload.** GitHub Actions, GitLab CI, CircleCI all
  support it. The path is a parameter. Keep the suite emitting to a
  generic `$E2E_ARTIFACTS_DIR` and let the CI step glob it.
- **Matrix / parallelism.** Provider-specific. The suite produces
  shards via `go test -shard=...` (a custom helper) so any matrix
  size works.
- **Timeouts.** Every provider has a job timeout. Set it generously
  inside the provider and let the suite enforce a tighter timeout
  via `go test -timeout`. Two layers of defence.
- **Secret injection.** Every provider supports env-var secrets. The
  suite reads `E2E_TOKEN` and similar; never reads a vendor-specific
  variable like `GITHUB_TOKEN` directly.

The principle: the suite knows nothing about its CI vendor. Switching
from GitHub Actions to GitLab CI changes the workflow file, not the
Go code.

## Designing for observability of the SUT under test

The SUT must be observable in the same ways production is observable.
Tests that rely on internal log scraping or on `kubectl exec` into a
pod to read a file have leaked into integration territory. The right
shape:

- Metrics endpoints on every service (`/metrics` Prometheus
  scrape). Tests can hit `/metrics` to assert that a counter
  incremented, without coupling to internal state.
- Structured logs shipped to a query-able store. The test does not
  read logs during the assertion, but a failed test's artefacts
  include a saved query URL.
- Traces captured for the test's request IDs. A failed test that
  attaches a Jaeger / Tempo trace URL is dramatically more
  diagnosable than one that does not.

```go
// Set a known request ID on every E2E request.
req.Header.Set("X-Request-ID", testRequestID(t))
t.Cleanup(func() {
    if t.Failed() {
        url := tracesURL(testRequestID(t))
        t.Logf("trace: %s", url)
    }
})
```

The trace URL in the test output saves an engineer ten minutes of
mining logs for the failing request.

## The wire vs the wire

A subtle senior-level distinction: there is a difference between "the
test talks to the SUT over HTTP" and "the test talks to the SUT over
the same network path production traffic takes." A test that runs in
the same Kubernetes namespace as the SUT and hits its ClusterIP
service is exercising a subset of the production network path —
specifically, the LoadBalancer / Ingress hop is bypassed.

Production traffic typically traverses:

1. DNS resolution to the public endpoint.
2. CDN / WAF (if present).
3. External load balancer (cloud).
4. Ingress controller in the cluster.
5. Service mesh sidecar (if present).
6. The pod itself.

Each hop can fail in ways your in-cluster E2E test cannot catch. The
solution: a small subset of "external" E2E tests that run from outside
the cluster and exercise the full network path. They are the most
expensive tests in the suite (they cross internet boundaries) but they
catch the highest-impact bugs (a misconfigured WAF rule that drops
your API token, an ingress that misroutes a path prefix).

Keep external E2E to a handful of tests. Run them post-deploy as
smoke.

## SUT version vs test version

A senior decides what happens when the SUT and the test disagree on
the API. Three policies, choose one:

**Tests track the live SUT.** When the SUT changes, the tests change
in the same PR. The suite always matches whatever is deployed.
Downside: cannot run last week's tests against this week's deploy to
detect a regression.

**Tests track the latest stable API.** The suite verifies the
documented contract. The SUT can have an unreleased feature flag;
the suite ignores it. Useful when the contract is the unit of
delivery.

**Tests are versioned alongside releases.** Each release tag has a
matching test tag. CI runs the tests from the release tag against the
release artefact. The strictest policy, used by teams that care about
historical reproducibility.

Most teams pick option 1 because it is simplest. Option 3 is worth
the overhead for compliance-driven environments.

## E2E vs synthetic monitoring

A close cousin of E2E: synthetic monitoring runs E2E-like checks
continuously against production. The technical implementation overlaps
heavily — same client, same waits, similar assertions. The differences:

- Synthetic checks run forever, not once per CI build.
- Synthetic checks tolerate background failures (a single failed
  synthetic does not page; a pattern of failures does).
- Synthetic checks must not interfere with production data
  (read-only or per-monitor tenant).

Some teams unify the codebase: the same test file runs as both an
E2E test and a synthetic check, with the synthetic mode behind a
build tag or flag. Others keep them separate. The unification saves
maintenance; the separation lets each evolve to its own rhythm. Pick
based on team size.

## Pull-based vs push-based events

Your SUT may use an event bus (Kafka, Pulsar, SQS). E2E tests for
event flows have two flavours:

**Pull.** The test consumes from the topic directly. Simple but
fragile: it couples the test to the topic name and partition layout,
and it competes with the production consumer if you point it at
shared topics.

**Push.** The test stands up an HTTP webhook receiver and registers
it with the SUT. The SUT posts events to the receiver. The test
asserts on what the receiver got.

Push is more decoupled. The test sees only what the SUT chose to
emit, not internal topic noise. The SUT-side webhook registration is
typically a thin admin API.

```go
events := make(chan Event, 8)
srv := startWebhookReceiver(t, events)
tenant := newTenant(t)
require.NoError(t, tenant.RegisterWebhook(t.Context(), srv.URL))
// ... trigger something on the SUT ...
select {
case e := <-events:
    require.Equal(t, "order.confirmed", e.Type)
case <-time.After(30 * time.Second):
    t.Fatal("no event received")
}
```

## The deploy-time test cycle

A senior-managed pipeline includes E2E in the deploy itself, not just
in CI. The shape:

1. Build artefact.
2. Push to staging.
3. Run smoke E2E against staging. Block on failure.
4. Promote to canary (small % of production).
5. Run external smoke E2E against the canary. Block on failure.
6. Roll forward to 100%.
7. Optionally: run a small smoke set against production for the next
   hour and alert on failure (catches issues that emerge under real
   traffic).

The discipline is to make rollback automatic when any block-on
condition fails. A pipeline that requires a human to acknowledge a
failed smoke test before rolling back will not roll back fast enough.

## Multi-tenant data audits

For a SaaS-shaped service, the E2E suite's biggest blind spot is
cross-tenant leakage. A test that runs as tenant A and accidentally
reads tenant B's data exposes a real production-risk bug. Two
techniques:

**Negative tests.** Every test that reads data also makes one
cross-tenant attempt and asserts it returns 404 (not 403 — 404 leaks
existence).

```go
tenantA := newTenant(t)
tenantB := newTenant(t)
order := tenantA.CreateOrder(t, "WIDGET", 1)

// Cross-tenant read must fail with 404.
_, err := tenantB.Admin.GetOrder(t.Context(), order.ID)
require.True(t, IsNotFound(err))
```

**Audit queries.** At the end of the suite, a janitor queries the
shared DB for rows tagged with one tenant but referenced by another.
A non-zero result is an automatic ticket on the security team.

## Cost of an E2E flake to the organisation

A senior thinks in flake-cost, not flake-count. Every flake:

- Wastes a CI run (compute cost).
- Wastes engineer attention triaging (people cost).
- Erodes trust in the suite (cultural cost, hardest to recover).

Roughly: a flake that triggers a re-run on a 10-minute job costs ~10
minutes of compute plus ~5 minutes of engineer attention. If your
suite flakes 5 times a day, that is 25 minutes of compute and 25
minutes of attention daily. Over a year: 100 hours of attention
across the team. That is a person-month spent on a problem nobody is
formally working on.

The point of a flake budget and a quarantine policy is to make this
cost visible and create a forcing function to fix it. A senior who
does not enforce the policy is not saving time; they are deferring
the cost to a future quarter where the cost will be larger.

## Migrating a legacy suite

Inheriting a 500-test E2E suite that everybody hates? The migration
plan:

1. Add metrics (test duration, attempt counts, pass rate).
2. Quarantine the top 10% by flake rate. CI goes green; the team
   stops ignoring failures.
3. Triage one quarantined test per sprint. Fix or delete.
4. Add a typed client and a polling helper. Migrate new tests to it
   immediately; backfill the old tests opportunistically.
5. Set a six-month deadline to reach < 0.5% flake rate. If you miss,
   replan.

A common temptation is to rewrite the whole suite. Resist. Suites
that grew over years have institutional knowledge baked in; a
rewrite usually loses 10% of coverage in subtle ways. Incremental
migration is slower but safer.

## Cross-team patterns

When the SUT is a platform — used by many teams — the platform team
maintains the framework (TestMain, tenant factory, polling helpers,
artefact upload) and exposes it as a Go module. Feature teams import
the module and write tests using its primitives.

```go
import "github.com/myorg/e2elib"

func TestE2E_OrderRoundTrip(t *testing.T) {
    tenant := e2elib.NewTenant(t)
    // ...
}
```

The platform team owns the framework's API stability. Breaking
changes go through a deprecation cycle. This is the same discipline
as any internal library — applied to test infrastructure.

## SUT contract: the readiness pact

A senior pushes for a clear readiness contract between the SUT and
the test suite. The contract:

- `/health` returns 200 only when the SUT is fully ready to serve
  production traffic: migrations applied, dependencies reachable,
  background workers running, caches warmed if applicable.
- `/health` returns 503 (with a JSON body explaining what is not
  ready) otherwise.
- The test suite waits on `/health` returning 200 before running a
  single test.

A SUT that lies on `/health` (returns 200 before it is genuinely
ready) makes the test suite flaky. The fix is at the SUT, not the
test.

```go
// Wait for readiness with a generous deadline.
func waitReady(base string, deadline time.Duration) error {
    end := time.Now().Add(deadline)
    for time.Now().Before(end) {
        resp, err := http.Get(base + "/health")
        if err == nil {
            io.Copy(io.Discard, resp.Body)
            resp.Body.Close()
            if resp.StatusCode == 200 {
                return nil
            }
        }
        time.Sleep(500 * time.Millisecond)
    }
    return fmt.Errorf("not ready after %s", deadline)
}
```

A flaky suite often has its root cause in a too-permissive
`/health`. Push back.

## Cross-language clients

When the team writes services in Go but consumers in Python /
TypeScript / Java, the E2E suite is the only place where the
real Go server talks to the real Python client. This is not a Go
testing topic strictly, but the senior who runs the suite owns the
shape of the cross-language tests.

A practical approach: keep the Go-driven E2E for the bulk of
coverage, plus a small set of polyglot smoke tests run from each
client language. The polyglot tests catch shape issues that the
generated Go client smooths over (Python's strict JSON parsing
rejects what Go's `json.Decoder` ignores, for example).

## Working with chaos engineering

A senior with a mature E2E suite eventually pushes for chaos
engineering: deliberate fault injection in a controlled environment
to verify the system's resilience properties.

The shape:

1. Pick a property ("a single instance failure does not affect more
   than 1% of requests").
2. Inject the failure (kill a pod, sever a network link, slow a
   dependency).
3. Run a small E2E set against the injured environment.
4. Assert the property held.

Chaos tests are usually scheduled (weekly) rather than per-deploy.
They are also more disruptive: a misbehaving chaos test can take
down the whole staging environment, so the senior coordinates with
operations before scheduling.

Tools like Toxiproxy or Chaos Mesh provide the fault-injection
primitives. The E2E suite invokes them through a thin Go wrapper.

```go
require.NoError(t, chaos.KillPod(t.Context(), "api-1"))
Eventually(t, "requests still succeed", 60*time.Second, 1*time.Second, func() bool {
    resp, err := client.GET(t.Context(), "/health")
    return err == nil && resp.StatusCode == 200
})
```

## Failure analysis for the long term

After a quarter of running the suite, the senior looks at the
failure dataset:

- Which tests have failed at all?
- Of those, which failures were real bugs and which were flake?
- Which tests have never failed in the period?

Tests that have never failed are either covering something
extraordinarily stable or covering something nobody is changing.
Either way they are candidates for retirement: a test that never
fires is paying maintenance cost for no signal.

Tests that have flaked frequently are candidates for redesign:
the test might be poorly written, or the SUT might have a latent
race that occasionally surfaces. The senior decides which case
applies and acts accordingly.

The exercise takes a few hours quarterly. The payoff is a leaner,
more honest suite the next quarter.

## Negotiating the suite with leadership

Leadership sometimes proposes "let's gate every deploy on a green full
E2E run." The senior's reply has three parts:

1. Acknowledge the goal (deploy with confidence).
2. Show the cost (CI minutes per deploy, cycle-time impact).
3. Counter with a cheaper approach (smoke + canary + nightly) that
   meets the goal.

Specific numbers help. If a deploy gated on full E2E takes 35
minutes vs 8 minutes for smoke + canary, and the team deploys 4
times a day, the difference is over 100 minutes per day of
wall-clock — much of it sitting in CI queues. Multiply by team
size and quarter, frame in dollars.

Leadership's instinct (more is safer) is not wrong. The senior's
job is to translate it into the configuration that actually
delivers safety at acceptable cost.

## A reading list

A senior with two free days for testing knowledge gets the most
value from:

- The "Practical Test Pyramid" essay (martinfowler.com) — the
  canonical pyramid framing.
- The chromedp and playwright-go README files and example
  directories — the official patterns for browser-driven tests.
- The kind and k3d documentation — the operating model for
  Kubernetes-shaped test environments.
- One real postmortem from a public source (any of the major
  outage post-mortems published by AWS, Cloudflare, GitHub) — the
  feedback loop from "production behaviour" to "missing test."

After reading, the senior writes a one-page summary of what they
will change in their own suite. The summary is the deliverable; the
reading is the input.

## Closing thought

E2E testing rewards patience. The single test you write today
catches its first real bug six months from now, when someone
deploys a misconfigured load balancer and your suite goes red. The
senior keeps writing tests in the meantime, knowing that the
benefit is far in the future and the cost is right now.

Most teams do not have the patience. The senior provides it.

## Talking to non-engineers about E2E

Product managers, support engineers, and customer success teams have
opinions about E2E. They want "more coverage" and they want it
"yesterday." The senior translates:

- "More coverage" usually means "a specific flow we worry about."
  Identify the flow. Write the test. Cap the discussion at one flow
  per conversation.
- "Faster" means "lower cycle time for a release." The lever is not
  always E2E; sometimes it is unit-test investment or improving the
  on-call rotation.
- "Why did this slip through?" means "what tests did we have, what
  did they cover, what was missing?" Answer with the failure mode,
  not with "we'll add an E2E test."

These conversations build trust. A senior who can explain testing
trade-offs in business terms is rare and valuable.

## Investing in the team, not just the suite

The senior's largest leverage is what they teach. Pair with a
junior on a flaky test; write a postmortem of a bug your suite
should have caught; run a brown-bag on `t.Cleanup` patterns. The
suite improves a little; the team improves a lot.

The seniors who do this best are the ones whose teams keep producing
good test suites after they leave. That is the real metric.

## Sharding the suite across runners

When the suite outgrows a single runner's wall-clock budget, shard
it. The cheapest sharding scheme: hash test names to N buckets and
have each runner take one bucket.

```go
func TestMain(m *testing.M) {
    shard := os.Getenv("E2E_SHARD")
    shardOf := os.Getenv("E2E_SHARD_OF")
    if shard != "" && shardOf != "" {
        filter := mustParseShard(shard, shardOf)
        // ... use filter via os.Args manipulation or testing.Match
    }
    os.Exit(m.Run())
}
```

A simpler variant: by package. CI starts N runners, each with
`./test/e2e/orders/...`, `./test/e2e/billing/...` etc. The split is
coarse but does not require any custom infrastructure.

The trade-off with sharding: every shard pays the environment
bring-up cost. If bring-up is 90 seconds and each shard runs for 5
minutes, you have 30% overhead. Worthwhile when total runtime exceeds
the patience threshold; wasteful below it.

## Selecting tests by impact

Not every E2E test is equally important. A senior tags tests with
labels — `critical`, `regression`, `coverage` — and the CI workflow
selects subsets.

```go
//go:build e2e

func TestE2E_OrderCreate(t *testing.T) {
    Tag(t, "critical", "regression")
    // ...
}

func Tag(t *testing.T, tags ...string) {
    // record tags for later filtering / reporting
}
```

The CI run for post-deploy uses `critical` only (a handful of
tests). The nightly uses `critical + regression`. The weekly uses
everything. Each tier has its own budget and SLA.

A practical refinement: when a test catches a real production
incident, automatically promote it to `critical`. The test has
earned the slot.

## Quarantine without losing coverage

A quarantined test is still valuable — it covers something — but
it cannot block CI. The dance:

1. Mark the test with a quarantine tag and an issue link.
2. Configure CI to run quarantined tests but not fail on their
   failure (typically a separate `go test -run` invocation that
   tolerates failure).
3. Daily report: how many quarantined tests, how many run, how
   many passed today.
4. Bi-weekly review: which quarantined tests have a fix in flight,
   which should be deleted.

The reason to keep running quarantined tests instead of skipping
them: the day they suddenly pass for a week straight, they can
return to the main set. A skipped test never returns.

```go
func TestE2E_OldFlakyThing(t *testing.T) {
    if quarantined("E2E_OLD_THING", "https://bugs/12345") {
        t.Skip("quarantined")
    }
    // ... test body ...
}
```

The `quarantined` helper checks an env var or a config file. The
operations team controls the flag without code changes.

## Building a senior's mental model

The senior carries a small set of invariants that govern decisions:

1. The suite is a product. It has users (engineers, ops), a backlog,
   and SLAs.
2. Every test costs money forever; the marginal cost grows as the
   environment grows.
3. Reliability is a feature, not a polish item. Without it nothing
   else matters.
4. The fastest test that catches the bug wins.
5. The SUT is the customer of the suite. Make it easy to write good
   tests; the team will follow the path of least resistance.
6. Document the patterns; the suite outlasts its authors.

These are not rules; they are heuristics that shift weight in
debates. When two seniors disagree, they usually disagree on which
heuristic to weight higher in the current context. That is healthy.

## Building a senior's career on testing

A senior who owns testing well becomes a force multiplier across
the team. The career payoff:

- Postmortems blame "weak tests" less often; the team's reputation
  for stability improves.
- New hires onboard faster because the test suite teaches them the
  system shape.
- Releases happen on a predictable cadence because the suite gives
  the deploy team confidence.

The downsides: testing work is undervalued in many performance
reviews. The senior must articulate impact in terms of incidents
avoided and engineering hours saved, not lines of test code
written.

## Building a polyglot harness for browser, API, and CLI

A mature suite tests at multiple layers in one binary. The harness
exposes each driver behind a small interface so tests can pick the
right tool.

```go
type Env struct {
    API     *apiclient.Client
    Browser *browser.Driver  // wraps chromedp or playwright
    CLI     *cli.Driver      // wraps os/exec + pty
    Token   string
}

func Setup(t *testing.T) *Env { /* ... */ }
```

Tests routinely combine drivers. A workflow test might:

1. Use `API` to create a tenant and seed data.
2. Use `CLI` to run a migration command that depends on the seeded
   data.
3. Use `Browser` to verify the data is visible in the UI.

```go
func TestE2E_OnboardingFlow(t *testing.T) {
    env := harness.Setup(t)
    tenant := env.API.CreateTenant(t)
    out := env.CLI.Run(t, "migrate", "--tenant", tenant.ID)
    require.Contains(t, out, "migration complete")
    env.Browser.Login(t, tenant.AdminEmail, "test-password")
    env.Browser.Goto(t, "/dashboard")
    require.Equal(t, "Ready", env.Browser.Text(t, `[data-testid="status"]`))
}
```

Each driver hides its boilerplate. The test reads as a script of
user actions, which is what an E2E test is supposed to look like.

## A real `browser.Driver` outline

```go
package browser

import (
    "context"
    "testing"
    "github.com/chromedp/chromedp"
)

type Driver struct {
    alloc context.Context
}

func New(t *testing.T) *Driver {
    opts := append(chromedp.DefaultExecAllocatorOptions[:],
        chromedp.Headless, chromedp.NoSandbox)
    alloc, cancel := chromedp.NewExecAllocator(context.Background(), opts...)
    t.Cleanup(cancel)
    return &Driver{alloc: alloc}
}

type Page struct {
    ctx    context.Context
    cancel context.CancelFunc
    t      *testing.T
}

func (d *Driver) NewPage(t *testing.T) *Page {
    ctx, cancel := chromedp.NewContext(d.alloc)
    t.Cleanup(cancel)
    p := &Page{ctx: ctx, cancel: cancel, t: t}
    t.Cleanup(func() {
        if t.Failed() {
            p.captureArtifacts()
        }
    })
    return p
}

func (p *Page) Goto(url string) {
    p.t.Helper()
    require.NoError(p.t, chromedp.Run(p.ctx, chromedp.Navigate(url)))
}

func (p *Page) Click(selector string) {
    p.t.Helper()
    require.NoError(p.t, chromedp.Run(p.ctx,
        chromedp.WaitVisible(selector),
        chromedp.Click(selector),
    ))
}

func (p *Page) Text(selector string) string {
    p.t.Helper()
    var s string
    require.NoError(p.t, chromedp.Run(p.ctx,
        chromedp.WaitVisible(selector),
        chromedp.Text(selector, &s),
    ))
    return s
}

func (p *Page) captureArtifacts() {
    var png []byte
    var html string
    _ = chromedp.Run(p.ctx,
        chromedp.CaptureScreenshot(&png),
        chromedp.OuterHTML("html", &html),
    )
    // write to artifactDir(p.t) ...
}
```

Each method waits for visibility before interacting, fails the test
on error with a helpful message, and contributes to artefact capture
on failure. Tests using this driver are short and stable.

## A real `cli.Driver` outline

```go
package cli

import (
    "bytes"
    "os/exec"
    "testing"
    "github.com/creack/pty"
)

type Driver struct {
    binPath string
}

func New(binPath string) *Driver { return &Driver{binPath: binPath} }

type Result struct {
    Stdout, Stderr string
    ExitCode       int
}

func (d *Driver) Run(t *testing.T, args ...string) Result {
    t.Helper()
    cmd := exec.CommandContext(t.Context(), d.binPath, args...)
    var stdout, stderr bytes.Buffer
    cmd.Stdout = &stdout
    cmd.Stderr = &stderr
    err := cmd.Run()
    code := 0
    if ee, ok := err.(*exec.ExitError); ok {
        code = ee.ExitCode()
    } else if err != nil {
        t.Fatalf("cli run: %v", err)
    }
    return Result{Stdout: stdout.String(), Stderr: stderr.String(), ExitCode: code}
}

type Interactive struct {
    ptmx *os.File
    cmd  *exec.Cmd
    out  *bytes.Buffer
}

func (d *Driver) RunInteractive(t *testing.T, args ...string) *Interactive {
    t.Helper()
    cmd := exec.CommandContext(t.Context(), d.binPath, args...)
    ptmx, err := pty.Start(cmd)
    require.NoError(t, err)
    out := &bytes.Buffer{}
    go io.Copy(out, ptmx)
    t.Cleanup(func() {
        ptmx.Close()
        cmd.Wait()
    })
    return &Interactive{ptmx: ptmx, cmd: cmd, out: out}
}

func (i *Interactive) Send(line string) { fmt.Fprintln(i.ptmx, line) }
func (i *Interactive) Wait() string     { i.cmd.Wait(); return i.out.String() }
```

A subset of tests need the interactive variant; most use the
batch `Run`. The driver chooses; the test does not see the PTY
boilerplate.

## Cross-cutting timeouts

A senior sets timeouts in three layers and makes sure they nest
correctly:

1. **CI job timeout.** The outermost; usually 30-60 minutes.
2. **Test binary timeout** (`go test -timeout`). The next layer; 20-45
   minutes typically. Shorter than the CI timeout so a hung binary
   gets killed by Go (which dumps goroutines, vastly more useful)
   rather than by the CI runner (which just kills the process).
3. **Per-test deadlines.** Set via `t.Context` or explicit
   `context.WithTimeout` inside tests. 30 seconds to several minutes
   depending on the test.

If the layers do not nest correctly — say, per-test deadline of 40
minutes inside a 30-minute binary timeout — the binary timeout fires
first and you lose the per-test failure information. Check the
arithmetic.

## SIGTERM handling

CI runners cancel jobs with SIGTERM. Long-running E2E suites should
handle SIGTERM gracefully — finish the in-flight test, run cleanup,
emit artefacts.

```go
func TestMain(m *testing.M) {
    ctx, cancel := signal.NotifyContext(context.Background(),
        syscall.SIGTERM, syscall.SIGINT)
    defer cancel()
    env := setupEnv(ctx)
    defer env.Stop()
    code := m.Run()
    if code != 0 {
        env.DumpArtifacts()
    }
    os.Exit(code)
}
```

`signal.NotifyContext` (Go 1.16+) gives a context that cancels on
SIGTERM. The harness uses it for any long-running operations
(compose up, kubectl apply) so they abort cleanly.

## Designing the SUT API for testability

A senior pushes for SUT APIs that make E2E cheap. Three concrete asks:

**Idempotency keys.** A `POST /orders` that accepts `Idempotency-Key:
<uuid>` and returns the same row when called twice with the same key
makes retries safe and makes tests re-runnable without explicit
cleanup of duplicates.

**Bulk fetch with filters.** A `GET /orders?tenant=X&status=pending`
that returns all matching orders lets the test poll for "tenant has
no pending orders" cheaply. Without a filter, the test must page
through everything.

**Predictable IDs.** Sequential IDs leak business metrics (order
volume); random IDs are fine but they should be sortable (ULID,
KSUID) so the test can request "the most recent order this tenant
created" without remembering its ID.

These asks are not test-only concerns. Production benefits from each:
retries are safer, queries are cheaper, debugging is easier. Frame
them as platform improvements and you get more buy-in than framing
them as "things the test team needs."

## The deploy-time canary

A canary deploy that runs a curated E2E subset against the canary
before rolling forward catches bugs that even a green CI run can
miss — because the canary runs in a live environment with real
traffic neighbours, real network latency, and real downstream
dependencies that may have drifted.

The canary E2E set is smaller than smoke: usually 3-5 tests, each
testing a critical user journey. The budget is tight (under 2 min
total). The failure action is automatic rollback, not a human
decision.

```yaml
canary-e2e:
  steps:
    - run: |
        go test -tags=e2e -run 'TestE2E_Canary_' \
          -timeout=2m -v ./test/e2e/...
      env:
        E2E_BASE_URL: ${{ env.CANARY_URL }}
    - if: failure()
      run: ./scripts/rollback.sh
```

The investment to build this is real (canary infra, automatic
rollback, the curated test set) but it pays back the first time it
catches an issue that nightly E2E would have caught the next morning.

## Reading a postmortem retrospectively

When a production incident happens, ask: "what test, if it had
existed, would have caught this in CI?" Not "we should add an E2E
test" — that is too generic — but specifically: at what layer
(unit, integration, E2E) and with what shape (assert that X
happens, assert that Y is rejected) would the test live?

Often the answer is a unit test. A subtle off-by-one in a function
that no E2E can practically exercise — the function is several
indirection layers deep from any client-visible behaviour. The fix
is a unit test for the function.

Sometimes the answer is an integration test. The function works in
isolation but mis-integrates with its database driver. The fix is
an integration test that hits a real DB.

Occasionally the answer is genuinely E2E. The bug is in deployment
configuration, a missing TLS cert, a load balancer routing rule. The
fix is an E2E test of the deployed flow.

A team that uses postmortems to drive test-pyramid investment
balances naturally over time. A team that always reaches for E2E
ends up with a top-heavy suite and no improvement in incident rate.

## Coordinating with infra

The E2E suite is the largest customer of the staging environment.
Two coordination patterns:

**Shared staging.** Many teams share one staging env. The E2E suite
must be polite: clean up its tenants, not exhaust connection
pools, not run during business-hours when humans are testing
manually. Schedule heavy runs for off-hours.

**Per-team staging.** Each team owns its own staging env. More
expensive in infra costs; cheaper in human coordination. As teams
grow, per-team becomes preferable.

The senior's role is to surface the trade-off, not to mandate one
answer. The infra team usually has opinions; respect them.

## Property-based E2E

For a subset of flows, property-based tests find bugs random
input fuzzing misses. The pattern: define an invariant ("after any
sequence of create / update / delete, the order's total equals
its line items sum") and generate random sequences.

```go
func TestE2E_OrderTotalInvariant(t *testing.T) {
    tenant := newTenant(t)
    for i := 0; i < 50; i++ {
        seed := time.Now().UnixNano()
        rng := rand.New(rand.NewSource(seed))
        runRandomSequence(t, tenant, rng)
        total, lines := tenant.GetOrderTotalAndLines(t, orderID)
        require.Equal(t, sum(lines), total, "seed: %d", seed)
    }
}
```

The seed in the failure message lets you reproduce the exact
sequence. Property-based E2E is expensive (each iteration is a full
E2E run) so keep iterations bounded.

## Working with external dependencies

Some E2E flows depend on external services your team does not
control — payment processors, identity providers, email delivery.
Three options:

- **Real, sandboxed.** Use the provider's sandbox endpoint
  (Stripe test mode, Auth0 test tenant). Most realistic;
  network-dependent and slower.
- **Wiremock-style stub.** Run a local stub that records and
  replays HTTP. Fast and deterministic; can drift from real
  provider behaviour.
- **Hybrid.** Real sandbox in nightly; stub in per-commit. Catch
  drift weekly while keeping per-commit fast.

Document which mode each test uses. A test that silently switches
from real to stub when the provider is down is a flake source.

## Schema evolution and E2E

A senior coordinates schema changes that affect the E2E suite. The
pattern:

1. Schema PR lands; SUT applies migrations on next deploy.
2. E2E suite is updated to exercise the new schema in the same PR
   or a follow-up.
3. The old E2E tests still pass — they were written against the
   old contract, which the new schema must still honour.

A schema PR that breaks E2E without updating it is a contract
break, even if the API still compiles. The senior reviews schema
PRs with this lens.

## Disaster-recovery drills

For services that promise an RTO, an E2E suite that exercises the
recovery path is the cheapest insurance. The pattern: in a
non-production env, simulate a failure (database failover,
region outage), run a small E2E set, assert the system recovers
within the budgeted time.

```go
func TestE2E_DR_DBFailover(t *testing.T) {
    require.NoError(t, env.TriggerDBFailover(t.Context()))
    Eventually(t, "service recovers", 60*time.Second, 1*time.Second, func() bool {
        return env.Client.Orders.Create(...) // succeeds
    })
}
```

Run DR tests weekly. Production failures are rare; readiness for
them is what separates a senior team from a junior one.

## Documentation as a senior responsibility

A 500-test suite no one understands is worse than no suite. The
senior writes and maintains:

- A README per test directory describing what the directory covers.
- A CONTRIBUTING note explaining how to add a new test (which
  helpers to use, where to put it, what the build tag is).
- A FLAKE.md tracking the current quarantine list with links to
  the issue tracker.
- An ARCHITECTURE.md describing the harness, the env modes, and the
  artefact layout.

These documents are the only thing standing between the suite and
oblivion when the senior leaves the team. Treat them as code: review
them, update them on PR, delete them when stale.

## What a senior teaches

The technical content of E2E is small enough to learn in a week. What
takes years is judgement: when to write a test, when to delete one, when
to push the SUT to expose a hook instead of working around its absence,
when to accept that the suite is good enough and move on. The seniors who
get this right run small, fast suites everyone trusts. The seniors who
get it wrong run big, slow suites everyone ignores.

The cheapest way to learn the judgement: own a suite for two years.
Watch what breaks. Watch which tests caught real bugs and which were
noise. Watch the relationship between suite quality and production
incident rate. The patterns become obvious from experience in a way
that no document can replace.

