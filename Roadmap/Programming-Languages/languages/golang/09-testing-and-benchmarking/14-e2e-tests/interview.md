---
layout: default
title: E2E Tests — Interview
parent: E2E Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/14-e2e-tests/interview/
---

# E2E Tests — Interview

[← Back](../)

## Q1. Define the boundary of an E2E test for a Go HTTP service.

Answer. The boundary is the same boundary a production client sees. The
service is started as its own process (or pod), it talks to real instances of
its dependencies (Postgres, Redis, Kafka), and the test drives it over HTTP
using `net/http`. No `httptest.NewServer`, no in-process function calls,
no mocked database. If a hop in production is missing in the test, the test
is integration, not E2E.

Follow-up. Is a test that runs the service in a goroutine within the test
binary an E2E test? No. Same process, same memory, same observability. It
is integration with one process boundary fewer than production.

## Q2. When should you NOT write an E2E test?

Answer. When a faster layer can cover the same risk. Pure logic belongs in
unit tests; component interaction belongs in integration tests. E2E is for
flows where the value lies in the wiring being correct — auth roundtrips,
schema migrations applied to a live DB, cross-service calls, deployment
health. The pyramid principle: many unit, fewer integration, fewest E2E.

Follow-up. A bug got past your unit and integration tests. Your manager says
"add an E2E test." What do you push back with? Ask: what is the smallest
test that would have caught this? If the answer is unit, fix the unit suite
instead. An E2E test inherits its cost forever; using it as a safety net for
weak lower layers tilts the pyramid.

## Q3. How do you keep parallel E2E tests from clobbering each other?

Answer. Per-tenant isolation. Each test allocates a unique tenant ID (UUID
or `t-<run>-<i>`), creates all its data under that tenant, and queries with
that tenant in scope. The shared environment never sees overlapping primary
keys across tests. For external services that lack tenant semantics (S3
buckets, queue names), the test prefixes resources with the tenant ID and
cleans them up in `t.Cleanup`.

Follow-up. What if the SUT does not support tenants? Then you have two
choices: serialise the suite (cheap to start, painful as it grows) or fork
the SUT design conversation with the service owners. Most SaaS shaped
services should be multi-tenant for production reasons anyway; testing is
just one of the forcing functions.

## Q4. A test passes locally but fails 1 in 20 in CI. What do you check first?

Answer. Timing. Look for fixed `time.Sleep` calls, missing waits after an
async write, and reliance on default timeouts. The local machine usually
has lower latency than CI, masking races. The fix is to replace timing
assumptions with deadline-bounded polling — `require.Eventually` or a
ticker-driven loop until the observed state matches.

Follow-up. The test polls correctly but still flakes. What next? Examine the
polling interval vs the SUT's behaviour. If the SUT only updates state every
500 ms and you poll every 100 ms with a 1-second deadline, you have two
attempts that may both miss the update. Either lengthen the deadline or, if
the SUT exposes one, hook a webhook/event probe that fires on state change.

## Q5. What is the relationship between E2E and contract tests?

Answer. Contract tests (Pact, OpenAPI-driven) verify that two services agree
on the shape of their interface without running them together. They are cheap
and fast. E2E verifies that the wired system actually executes the agreed
contract. You want contract tests at every boundary and E2E for a small set
of critical flows. Contract tests cannot detect a misconfigured load
balancer; E2E can. E2E cannot reliably catch a backwards-incompatible schema
change on a downstream service the suite does not exercise; contracts can.

Follow-up. Where does an OpenAPI fixture fit? Generate a Go HTTP client from
the spec; use it in E2E tests. Drift between spec and server surfaces as a
4xx or a decode error before your assertions run — the contract is being
verified for free.

## Q6. How do you handle test data that lives in a shared staging database?

Answer. Three rules:

1. Every test creates its own tenant/user/account and writes only there.
2. The tenant prefix encodes the run ID so a leaked tenant from a previous
   run is identifiable (`e2e-<run>-<i>`).
3. A nightly job purges tenants older than a week. This is the safety net,
   not the primary cleanup.

Follow-up. A leaked tenant has 10M rows and is slowing down the DB. What
went wrong, and what is the immediate action? Immediate action: hard-delete
the tenant via the admin API or a SQL `DELETE WHERE tenant_id = $1`. Root
cause: a test that exited via `os.Exit` without running `t.Cleanup`, or a
table that the cleanup logic does not know about. Audit the schema for
tenant-scoped tables the janitor is missing.

## Q7. Walk me through a chromedp test that logs in and asserts on a dashboard.

Answer.

```go
func TestE2E_DashboardShowsName(t *testing.T) {
    alloc, cancel := chromedp.NewExecAllocator(context.Background(),
        append(chromedp.DefaultExecAllocatorOptions[:],
            chromedp.Headless)...)
    defer cancel()
    ctx, cancel2 := chromedp.NewContext(alloc)
    defer cancel2()

    var greeting string
    err := chromedp.Run(ctx,
        chromedp.Navigate(baseURL+"/login"),
        chromedp.SendKeys(`#email`, "alice@example.com"),
        chromedp.SendKeys(`#password`, "secret"),
        chromedp.Click(`button[type=submit]`),
        chromedp.WaitVisible(`#greeting`),
        chromedp.Text(`#greeting`, &greeting),
    )
    require.NoError(t, err)
    require.Equal(t, "Hello, Alice", greeting)
}
```

Key points: a headless allocator scoped to the test or `TestMain`, an explicit
`WaitVisible` instead of sleep, and an assertion on user-visible text.

Follow-up. Why `WaitVisible` and not `WaitReady`? `WaitReady` returns when
the node is in the DOM; `WaitVisible` adds the constraint that the node has
non-zero size. The first lets you click an invisible button; the second
does not. Match what a user can actually do.

## Q8. How do smoke tests relate to E2E tests?

Answer. A smoke test is a small subset of E2E that runs after deploy against
the freshly-deployed environment. It answers "is anything obviously broken?"
The full E2E suite answers "do the flows we care about still work?" Smoke
tests are tighter: a handful of critical paths, sub-minute wall-clock,
deployment blockers if they fail. Same code, different `-run` filter and
different runtime budget.

Follow-up. How do you choose which tests are smoke? Walk the user funnel —
sign up, log in, create the central object, observe the central object —
and pick one test per step. If anything in that line fails, the deploy is
not safe.

## Q9. CI is slow because the E2E suite takes 45 minutes. What do you do?

Answer. In order: measure (find the top-10 slowest tests), parallelise
(per-tenant isolation + `t.Parallel`), prune (move tests that don't need to
be E2E down the pyramid), cache (Docker layers, kind node image, DB
snapshots), shard (split by package across CI workers). Last resort: pay for
more runners. Often the first three steps yield a 5-10x speedup with no
extra spend.

Follow-up. What is the diminishing-returns moment? When the suite's wall
clock approaches `max(individual test duration)`. After that, more workers
only help if the slowest individual test becomes faster.

## Q10. Should E2E tests run on every commit?

Answer. Usually no. Run a smoke subset on every commit (under 5 min) and the
full suite nightly or on merge to main. Per-commit full E2E pushes CI
wall-clock past the patience threshold and discourages people from looking
at failures. Cheap, fast feedback wins; comprehensive feedback runs on its
own schedule.

Follow-up. The team wants per-commit full E2E for "safety." How do you
respond? Show the data: nightly failure cadence and the bugs they caught,
versus the CI cost. If nightly catches < 1 bug a week, the per-commit run
will catch the same bugs while burning 168x more compute. If nightly
catches many bugs, the underlying issue is unit/integration coverage, not
E2E frequency.

## Q11. Describe a failure-artefact capture strategy.

Answer. Wrap each test with a `t.Cleanup` that runs only on `t.Failed()`.
It writes, into `$E2E_ARTIFACTS_DIR/<test-name>/`: the last 200 lines of
container logs, a transcript of the failing HTTP call, and for browser
tests a screenshot plus an `outerHTML` dump. The CI job uploads the
directory as a build artefact. The cost is zero on passing tests and a few
hundred milliseconds on failing ones, which is the right ratio.

## Q12. How do you test a CLI binary?

Answer. Build it in `TestMain`, then drive it with `os/exec`. For
interactive prompts, attach a pseudo-terminal via `github.com/creack/pty`
so the binary thinks it has a TTY and you can write into stdin like a
human. Assert on stdout, stderr, and exit code. The binary is the SUT;
nothing inside it is mocked.

## Q13. What is the purpose of the `e2e` build tag?

Answer. To keep E2E tests out of the default `go test ./...` run.
Developers iterating on a unit test should not wait for a docker-compose
stack to come up. The tag is the opt-in: `go test -tags=e2e` runs the
suite; without it, the file is invisible to the compiler. The same
mechanism lets CI jobs separately invoke unit, integration, and E2E
runs.

## Q14. Walk me through what happens when an E2E test fails in CI.

Answer.

1. The test calls `t.Fatal` (or similar). The `t.Cleanup` functions
   run in LIFO order.
2. A cleanup function detects `t.Failed()` and writes artefacts:
   container logs, HTTP transcript, browser screenshot, request IDs.
3. The CI step exits non-zero. A post-step uploads the artefact
   directory.
4. The team's failure-notification rule fires (Slack, PagerDuty, etc.).
5. An on-call engineer reads the failure name, checks the uploaded
   artefacts, and either fixes the test, files a bug against the SUT,
   or quarantines the test.

The whole flow takes 5-15 minutes if the artefacts are good and the
failure is clear, hours if the test was written badly and produces a
generic "assertion failed" with no context.

## Q15. The team wants 95%+ E2E coverage. How do you respond?

Answer. Coverage at the E2E layer is the wrong metric. You can have 95%
code coverage from E2E and still miss the bug that matters because the
test exercised the line without asserting on its behaviour. Push for
metrics that actually correlate with shipped quality: bug catch rate,
mean time to triage, flake rate. If the team insists on a percentage,
target it at the unit layer where line coverage is informative.

## Q15a. Tell me about a flaky E2E test you fixed.

Sample answer (adapt to your own experience). "We had a checkout test
that passed in CI 19 times in 20. The failure message said 'timeout
waiting for order status confirmed.' I added the last observed status
to the failure message — turned out the status was stuck at
'processing.' Looking at the SUT logs, the worker that confirms
orders had a race condition on a shared cache. The 'fix' for the test
was to expose the worker's queue depth via the admin API and poll on
that instead, but the real fix was a code change in the SUT to
serialise the cache update. The test caught a real bug that production
had not yet hit."

The structure: what was flaky, what diagnostic improved the signal,
what the root cause was, what the fix was. Interviewers want to see
your debugging process, not a list of buzzwords.

## Q16. How do you handle a service that has both an HTTP API and a gRPC API?

Answer. Write E2E tests against both. They share a backend, but the
serialisation layers and middleware can drift. A common bug pattern:
HTTP middleware enforces a header that gRPC middleware does not, or
vice versa. Only running tests against both surfaces catches it. Use
the same typed client pattern (one per protocol) so the test logic
stays simple.

## Q17. What is your stance on test parallelism?

Answer. Tests should be parallel by default. The exceptions are tests
that mutate shared state (a global config flag, a singleton resource)
or tests where parallelism would mask a race. For E2E specifically,
parallelism requires per-tenant isolation; without it, parallel runs
race. The shape: every test calls `t.Parallel()` immediately after
constructing its tenant, and the tenant is unique per test.

## Q18. How do you decide which tests to run on every commit vs nightly?

Answer. Two criteria. First, runtime: anything that exceeds the
per-commit budget (5-8 minutes total) goes to nightly. Second,
criticality: critical user journeys run on every commit even if they
are slow, because catching a regression there at 3 PM is much cheaper
than catching it at 3 AM the next morning. Negotiate the budget with
the team and stick to it; do not let the per-commit suite drift to
20 minutes.

## Q18a. What is the difference between `chromedp` and `playwright-go`?

Answer. Both drive a real browser. `github.com/chromedp/chromedp` is
Chrome-only and lighter to install (it talks to whatever Chrome the
machine has). `github.com/playwright-community/playwright-go` is a Go
binding for Playwright; it ships its own browser-install command and
supports Chromium, Firefox, and WebKit. For Go-only teams that test
only on Chrome, chromedp is the simpler choice. For teams that need
cross-browser coverage or that already use Playwright in another
language, playwright-go wins. Both work for almost every E2E
scenario; the choice is mostly about installation and team
familiarity.

## Q19. What do you do when an E2E test fails on the first attempt and passes on retry?

Answer. Investigate the first failure before accepting the green
retry. The standard library does not retry; if you added retry logic
in CI, that is the layer to question. A test that fails-then-passes
often points at a real intermittent bug in the SUT — a race, a slow
dependency, an event-ordering issue. If you accept the retry without
investigation, you have trained the suite to hide problems. The
correct response: file a ticket, capture the artefacts from the first
failure, and only mark the run green if a human has confirmed it was
a known transient.
