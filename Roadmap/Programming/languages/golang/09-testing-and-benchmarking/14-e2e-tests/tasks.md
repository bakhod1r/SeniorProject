---
layout: default
title: E2E Tests — Tasks
parent: E2E Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/14-e2e-tests/tasks/
---

# E2E Tests — Tasks

[← Back](../)

Each task ships a small Go service or CLI and asks you to write an end-to-end
test against it. Treat the SUT as a black box. Build tag `e2e` is assumed
for all tests in `test/e2e/`.

## Task 1 — API smoke test

Service `cmd/orders` exposes `POST /orders` (creates an order) and
`GET /orders/{id}` (returns one). Both require header `Authorization: Bearer
$TOKEN`.

Write `TestE2E_OrderRoundTrip` that:

1. Reads `E2E_BASE_URL` and `E2E_TOKEN` from env. Skip the test if either is
   empty.
2. Creates an order with body `{"sku": "WIDGET", "qty": 3}`.
3. Polls `GET /orders/{id}` until status is `confirmed`, with a 10s deadline
   and 200ms interval.
4. Asserts the response body has the original sku and qty.

Use `net/http` directly. No third-party HTTP libraries.

Acceptance: the test passes against a healthy service, and fails clearly
(naming the exceeded deadline) when the worker that confirms orders is
stopped.

## Task 2 — Tenant isolation helper

Write a helper `func newTenant(t *testing.T) Tenant` that:

- Creates a tenant via `POST /admin/tenants` with name `e2e-<random>`.
- Returns a `Tenant{ID, AdminToken}` struct.
- Registers `t.Cleanup` to delete the tenant.

Then write two parallel tests that each call `newTenant` and confirm they
receive distinct IDs. The point is to prove that `t.Parallel()` works with
the helper.

Acceptance: `go test -tags=e2e -race -parallel 4 ./test/e2e/...` passes
and the admin API logs show two distinct `CreateTenant` calls.

## Task 3 — Eventually helper

Without using testify, write a generic poll helper:

```go
func Eventually(t *testing.T, deadline time.Duration, tick time.Duration, fn func() bool)
```

It must:

- Call `fn` immediately, then every `tick` until `fn` returns true or
  `deadline` elapses.
- On timeout, call `t.Fatalf` with the deadline and tick used.
- Respect `t.Context()` if available (Go 1.24+).

Cover it with a unit test that exercises both success and timeout paths.

Bonus: add a `func Never(t, deadline, tick, fn)` variant that fails if `fn`
ever becomes true within the deadline — useful for asserting "this stays
false for N seconds."

## Task 4 — chromedp login

The webapp at `$E2E_BASE_URL` has `/login` (email + password form) and
`/dashboard` (shows `#greeting` after login). Using
`github.com/chromedp/chromedp`:

1. Start a headless browser in `TestMain`, reuse it across tests via
   `chromedp.NewContext`.
2. Write `TestE2E_LoginShowsGreeting` that logs in with seed user
   `alice@example.com` / `secret` and asserts the greeting text matches
   `"Hello, Alice"`.
3. On failure, capture a screenshot to `$E2E_ARTIFACTS_DIR`.

Acceptance: the screenshot includes the unexpected greeting text and the
suite exits non-zero.

## Task 5 — playwright-go variant

Repeat task 4 using `github.com/playwright-community/playwright-go`. The
suite must skip cleanly if `PWDEBUG=1` is set and the browser binary is not
installed.

Compare the wall-clock time and the artefact quality of chromedp vs
playwright-go. Note the differences in the README of the suite.

## Task 6 — CLI E2E

The binary `bin/mytool` accepts `mytool greet --name=Alice` and prints
`Hello, Alice` to stdout. Build the binary in `TestMain` via
`go build -o bin/mytool ./cmd/mytool` and write `TestE2E_GreetPrintsName`
using `os/exec`.

Bonus: write `TestE2E_GreetInteractive` that uses `github.com/creack/pty`
to drive an interactive prompt (`mytool greet` with no flags asks for the
name on stdin).

Acceptance: both tests pass on Linux and macOS. (The PTY test can be
skipped on Windows.)

## Task 7 — Ephemeral docker-compose env

Write a `TestMain` that:

1. Reads `E2E_BASE_URL`. If set, use it (assume external env).
2. Otherwise, shells out to `docker compose up -d` from `testdata/compose/`,
   waits for `/health` on the published port, and tears down on exit.
3. Sets `E2E_BASE_URL` for the suite.

Tests must not know which mode they are in.

Bonus: handle Ctrl-C in `TestMain` so a developer-killed run still tears
down the compose stack.

## Task 8 — Failure artefacts

Extend the suite from any prior task with a `defer` in each test that, on
`t.Failed()`:

- Writes the last 200 lines of each compose service log to
  `$E2E_ARTIFACTS_DIR/<test>/<svc>.log`.
- For browser tests, also writes a PNG screenshot and a DOM dump.

Demonstrate the path by introducing a deliberate failing assertion.

Acceptance: the artefacts directory contains a per-test subdirectory whose
contents are sufficient to diagnose the failure without re-running the
suite.

## Task 9 — Retry with backoff

Wrap an HTTP call helper so that retryable failures (connection reset,
HTTP 502/503/504) are retried up to 5 times with exponential backoff
(100ms × 2^n) and jitter. Non-retryable failures (4xx other than 408 and
429) return immediately. Cover with a unit test that uses
`httptest.NewServer` to inject specific responses.

Acceptance: the unit test demonstrates both retry and immediate-return
behaviour. The helper does not retry on context cancellation.

## Task 10 — Per-tenant parallel suite

Convert a 5-test sequential suite into a parallel suite using the
`newTenant` helper from Task 2. Verify that:

- All tests pass with `go test -tags=e2e -parallel 4 ./test/e2e/...`.
- The wall-clock time drops to roughly `max(individual durations)` and not
  `sum(individual durations)`.
- No test leaks data into another tenant (assert by counting rows in the
  shared DB after each test).

Bonus: record the before/after timings in a `BENCHMARKS.md` next to the
suite.

## Task 11 — kind cluster E2E

Stand up a `kind` cluster in `TestMain`, apply the manifests in
`testdata/k8s/`, port-forward the service, and run the API smoke test from
Task 1 against it. Acceptance: the cluster is gone after the test binary
exits and `kind get clusters` shows no leftovers.

## Task 12 — Contract test bridge

Generate a Go HTTP client from the service's OpenAPI spec (any generator
of your choice). Rewrite the Task 1 test to use the generated client.
Observe what happens when the spec drifts from the server — change a field
name in the spec and re-run the test.

## Task 13 — Quarantine harness

Add a `quarantined(name, ticket)` helper that reads a YAML file of
quarantined test names and skips matching tests with a useful message
pointing at the ticket. Demonstrate by quarantining a test, observing
it skip in CI, removing it from the YAML, and observing it run again.

```yaml
# quarantine.yml
- name: TestE2E_OldFlakyThing
  ticket: https://bugs.example.com/12345
  added: 2026-05-15
```

Acceptance: the suite reports quarantined tests in its output but does
not fail on them.

## Task 14 — Request ID propagation

Every HTTP call from your E2E client sends an `X-Request-ID` header
unique per test (use `uuid.NewString`). The SUT's logs include this ID
in every log line for the request. Demonstrate the trace by:

1. Running a test.
2. Capturing the request ID from the test log.
3. Searching the SUT's log output for that ID.
4. Confirming you can reconstruct the request lifecycle from the log
   lines alone.

## Task 15 — Smoke vs full

Tag five tests with `TestE2E_Smoke_` prefix; leave the rest of the
suite tagged normally. Run:

```bash
# smoke only
go test -tags=e2e -run 'TestE2E_Smoke_' ./test/e2e/...
# full
go test -tags=e2e ./test/e2e/...
```

Confirm both subsets pass. Measure the wall-clock time of each.
Document the smoke set's selection rationale in a SMOKE.md file.

## Task 16a — Per-test request ID dashboard

Extend the artefact upload with a JSON manifest:

```json
{
  "test": "TestE2E_OrderRoundTrip",
  "request_ids": ["abc-...", "def-..."],
  "duration_ms": 1234,
  "outcome": "fail"
}
```

A small dashboard reads these manifests and lets a developer click
through to the SUT's log query for any request ID. Acceptance: a
failed test produces a clickable manifest within the artefact
directory.

## Task 16 — Artefact viewer

Build a tiny static-site generator that reads `$E2E_ARTIFACTS_DIR` and
produces an HTML page per test with links to its screenshot, logs, and
HTTP transcript. Useful for sharing E2E failures in a pull-request
comment or a chat message.

Acceptance: a single command transforms an artefact directory into a
browseable HTML report. The report works offline.

## Task 17 — Eventually with backoff

Extend the `Eventually` helper from Task 3 to support exponential
backoff with a configurable initial tick and max tick. Demonstrate
with a probe that becomes true at a random time within a 30-second
window; show that the helper polls aggressively at first and backs
off, keeping wall-clock idle low.

Acceptance: the test passes with both fixed-tick and backoff modes;
the backoff mode performs fewer total polls for long waits.

## Task 18 — Cross-tenant negative test

Using the `newTenant` helper, write a test that:

1. Creates two tenants A and B.
2. Creates an order in A.
3. Attempts to read the order via B's credentials.
4. Asserts the response is 404 (not 403 — 403 leaks existence).

Acceptance: the test passes against a correctly-implemented service
and fails clearly against one that returns 403.

## Task 19 — Kafka event observer

For a SUT that publishes Kafka events, write a small in-process
consumer that records the events the SUT emits during a test. The
test asserts on the recorded events. Use a unique consumer group
per test to avoid cross-test interference.

Acceptance: tests assert "the SUT emitted event X within 10 seconds
of action Y" without polling the database.

## Task 20 — Nightly vs PR runner config

Write two CI configurations (GitHub Actions YAML or equivalent):
one for per-PR (smoke only, < 8 minutes) and one for nightly
(full suite, < 30 minutes). Both upload artefacts on failure. The
nightly config sends a Slack notification on failure; the PR config
does not.

## Task 21 — Two-run idempotence check

Add a CI step that runs the full E2E suite twice in a row, in the
same environment, without environment teardown between runs. The
suite must pass both times. Acceptance: a deliberately broken
cleanup (a test that does not delete its tenant) is detected on
the second run by a row-count assertion in `TestMain` finalisation.

## Task 22 — chromedp screenshot on every test

Modify the browser harness so every test (passing or failing)
captures a screenshot at the end. Pass-time screenshots go to a
"passes" subdirectory; fail-time go to "fails". Useful for visual
regression review. Disable in CI by default; enable with
`E2E_CAPTURE_PASSES=1`.

## Task 23 — Per-test compose project

When the suite brings up its own compose stack, give each test
binary a unique compose project name (e.g. `e2e-${PID}`) so two
parallel `go test` invocations on the same host do not collide.

Acceptance: starting two suites simultaneously on one machine
produces two isolated stacks; each tears down cleanly.

## Task 24 — pty-driven CLI session

For the CLI binary, write an interactive session test that:

1. Starts the binary via `github.com/creack/pty`.
2. Sends three commands in sequence (`set name=Alice`, `greet`,
   `quit`).
3. Reads the output between each command (use a deadline so a
   silent hang fails fast).
4. Asserts on the final output.

Bonus: verify the binary handles a SIGINT (Ctrl-C) gracefully —
the test sends a SIGINT and asserts the binary exits with code 130.

## Task 25 — Webhook receiver

The SUT can be configured with a webhook URL. Write a test that:

1. Stands up an in-process `httptest.NewServer` to receive
   webhooks (this is allowed in E2E because the receiver is part of
   the test, not the SUT).
2. Configures the SUT to post webhooks to that URL.
3. Triggers an action on the SUT.
4. Asserts the webhook payload arrived within 30 seconds with the
   expected shape.

Acceptance: the test fails clearly when the webhook is misrouted
(wrong URL) and when the payload shape is unexpected.
