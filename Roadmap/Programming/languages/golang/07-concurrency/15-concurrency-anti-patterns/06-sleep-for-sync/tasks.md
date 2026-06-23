---
layout: default
title: Tasks
parent: Sleep for Sync
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 7
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/06-sleep-for-sync/tasks/
---

# Sleep for Synchronization — Tasks

## How To Use This File

Each task includes:

- A short description.
- Starter code or a buggy test.
- Acceptance criteria (objective, testable).
- A hint, hidden by default — try the task before reading.

Difficulty is graded `[J]` (junior, ~30 min), `[M]` (middle, ~1-2 h), `[S]` (senior, ~3-5 h), `[P]` (professional, ~1+ day).

---

## Task 1 [J]. Refactor A Simple Sleep-Based Test

Convert the following test to use `sync.WaitGroup`. The test must pass `-race` and contain no `time.Sleep` outside a safety timeout.

```go
func TestCounter(t *testing.T) {
    var c Counter
    for i := 0; i < 100; i++ {
        go c.Inc()
    }
    time.Sleep(200 * time.Millisecond)
    if c.Value() != 100 {
        t.Errorf("got %d, want 100", c.Value())
    }
}
```

**Acceptance**:

- Test passes with `go test -race -count=100`.
- No `time.Sleep` in the test body.
- Test runtime under 10ms.

**Hint** (try first): `wg.Add(100)`, `defer wg.Done()` inside each goroutine, `wg.Wait()` before the assertion.

---

## Task 2 [J]. Replace A Sleep With A Channel

The following pattern is everywhere in legacy code. Refactor.

```go
func TestServerReady(t *testing.T) {
    s := NewServer()
    go s.Listen()
    time.Sleep(100 * time.Millisecond)
    if _, err := http.Get(s.Addr()); err != nil {
        t.Fatal(err)
    }
}
```

The `Server` type currently has no readiness API. You may modify the `Server` type.

**Acceptance**:

- `Server` exposes a `Ready()` method returning a `<-chan struct{}` that closes when listening.
- Test uses `<-s.Ready()` instead of `time.Sleep`.
- Test passes deterministically.

**Hint**: add a `ready chan struct{}` field; `close(ready)` after `net.Listen` succeeds.

---

## Task 3 [J]. Convert A Sleep-Based Status Check

```go
func TestWorker_Status(t *testing.T) {
    w := NewWorker()
    go w.Run()
    time.Sleep(50 * time.Millisecond)
    if w.Status() != Running {
        t.Fatal("not running")
    }
    w.Stop()
    time.Sleep(50 * time.Millisecond)
    if w.Status() != Stopped {
        t.Fatal("not stopped")
    }
}
```

Refactor to observe state transitions via a channel-based subscription rather than sleeps.

**Acceptance**:

- No `time.Sleep` in test (safety timeouts OK).
- Test deterministic.

**Hint**: `w.OnStateChange(func(s State))` callback; ship state changes into a buffered channel; test reads from channel.

---

## Task 4 [M]. Build A Simple `Clock` Interface

Define a `Clock` interface with `Now`, `Sleep`, `After`, `NewTimer`. Provide:

- A `RealClock` implementation using `time.*`.
- A `FakeClock` implementation with `Advance(d)` for tests.

**Acceptance**:

- A unit test for `FakeClock` proves it correctly fires timers when advanced.
- A `Retry` function that takes a `Clock`, tested deterministically with `FakeClock`.

**Hint**: the fake clock maintains a sorted list of pending fires; `Advance` walks the list and fires those whose time has come.

---

## Task 5 [M]. Refactor To Use `errgroup`

Replace the sleep-based pattern with `errgroup`:

```go
func TestDownloadAll(t *testing.T) {
    for _, u := range testURLs {
        u := u
        go download(u)
    }
    time.Sleep(2 * time.Second)
    if got := downloaded(); len(got) != len(testURLs) {
        t.Errorf("got %d, want %d", len(got), len(testURLs))
    }
}
```

**Acceptance**:

- Uses `errgroup.WithContext`.
- Propagates first error.
- Test runtime equals the slowest download, not 2 seconds.

**Hint**: `g, ctx := errgroup.WithContext(ctx); for ... { g.Go(func() error { return download(ctx, u) }) }; g.Wait()`.

---

## Task 6 [M]. Adopt `synctest` For A Cache TTL Test

```go
func TestCacheExpiry(t *testing.T) {
    c := NewCache()
    c.Set("k", "v", 100*time.Millisecond)
    time.Sleep(50 * time.Millisecond)
    if v, _ := c.Get("k"); v != "v" {
        t.Errorf("expected v, got %v", v)
    }
    time.Sleep(60 * time.Millisecond)
    if v, _ := c.Get("k"); v != nil {
        t.Errorf("expected nil, got %v", v)
    }
}
```

**Acceptance**:

- Wrapped in `synctest.Test`.
- Sleeps remain (now virtual).
- Test runtime under 1ms.

**Hint**: just wrap the whole body in `synctest.Test(t, func(t *testing.T) { ... })`. No code changes inside.

---

## Task 7 [M]. Build An `Eventually` Polling Helper

Write `Eventually(t, total, step, what, cond)` that polls `cond` and fails if not true within `total`.

**Acceptance**:

- Returns immediately when `cond` is true.
- Fails with a descriptive message on timeout.
- Default step is 10ms, default total is 5s.
- Used in a test that asserts an external system reaches a state.

**Hint**: see middle.md section on polling helpers.

---

## Task 8 [M]. Refactor A Sleep-Based Retry Test

```go
func TestRetry_Backoff(t *testing.T) {
    var attempts int
    err := Retry(3, time.Second, func() error {
        attempts++
        return errors.New("fail")
    })
    // currently this test takes 3+ seconds because Retry sleeps
}
```

Refactor `Retry` to accept a `Clock` and the test to use a fake clock. Assert exact attempt count and backoff intervals.

**Acceptance**:

- Test runtime under 10ms.
- Asserts exact gaps between attempts (1s, 2s).

**Hint**: see middle.md "Refactor: rate limiter" pattern.

---

## Task 9 [M]. Implement A Bounded Queue With `sync.Cond`

A bounded queue with `Push(x)` (blocks when full) and `Pop()` (blocks when empty). Use `sync.Cond` to avoid sleep-based polling.

**Acceptance**:

- `Push` and `Pop` are correct under concurrent use.
- Race-detector clean.
- No `time.Sleep` anywhere in the implementation.

**Hint**:

```go
for len(q.buf) == q.cap { q.notFull.Wait() }
```

---

## Task 10 [S]. Design A Retry Library

Build a retry library with:

- Configurable max attempts.
- Exponential backoff with full jitter.
- Cap on max delay.
- Per-attempt timeout via per-attempt context.
- Context cancellation respected.
- Classifier function for retryable errors.
- `OnAttempt` hook.

Cover with deterministic tests using `synctest` and/or `clockwork`. Cover at least 10 scenarios.

**Acceptance**:

- API matches: `Retrier.Do(ctx, op) error`.
- 10+ tests, all deterministic.
- Race-detector clean.

**Hint**: see senior.md retry library section.

---

## Task 11 [S]. Build A `Debouncer` With Observable Quiescence

A `Debouncer` that calls `fn` after `d` of quiet from the last `Trigger`. Expose `WaitFired()` so tests can synchronise.

**Acceptance**:

- `Trigger` followed by `WaitFired` works deterministically.
- `synctest`-based test asserts that 5 triggers within `d` collapse to 1 call.
- `synctest`-based test asserts triggers separated by `d+ε` produce 2 calls.

**Hint**: store a `chan struct{}` that is closed when the latest scheduled call completes.

---

## Task 12 [S]. Add A Lint Rule

Write a custom golangci-lint (`go-ruleguard` or analyzer) plugin that flags `time.Sleep` calls in `*_test.go` files, with an allowlist mechanism via `//nolint:nosleep // reason` comments.

**Acceptance**:

- Catches sleeps in test files.
- Respects allowlist comments.
- Passes on a clean codebase.
- Includes 5 unit tests.

**Hint**: see professional.md "Custom golangci-lint plugin" section.

---

## Task 13 [S]. Implement A Test-Time Scheduler

Build a `Scheduler` interface with `Schedule(when time.Time, fn func())` and a `ManualScheduler` that records pending callbacks instead of firing them. Tests can `RunNext()` to fire the earliest one.

**Acceptance**:

- Production code uses `Scheduler` interface; production scheduler uses `time.AfterFunc`.
- Tests use `ManualScheduler`.
- A test for a "delayed greeting" feature: schedule a greeting in 1 hour, advance manually, assert greeting was called.

**Hint**: keep a min-heap of pending callbacks.

---

## Task 14 [S]. Build A Flake Detector

Write a tool that runs a Go test suite N times under varying `GOMAXPROCS` (1, 2, 4, 8) and reports per-test failure rates. Output a CSV ranked by flake rate.

**Acceptance**:

- Runs `go test -count=1 -cpu=1,2,4,8` N times.
- Parses output (or uses `-json`).
- Produces a CSV.
- Tested on a synthetic suite with deliberately flaky tests.

**Hint**: use `os/exec` and `encoding/json` for the `-json` output.

---

## Task 15 [P]. Write A Migration Plan Document

For a hypothetical 5000-test codebase with 1200 `time.Sleep` calls, write a 5-page migration plan with phases, owners, KPIs, and timeline. Include:

- Discovery methodology.
- Classification table.
- Prioritisation rubric.
- Per-phase milestones.
- Communication plan for affected teams.
- Risk register.

**Acceptance**:

- Document includes all sections above.
- Includes a Gantt-style timeline.
- Reviewed by at least one peer (in the imagined scenario).

---

## Task 16 [P]. Implement A Production-Grade Retry Service

Build a microservice (in Go) that wraps outbound HTTP calls with retry, jitter, classification, and observability. Exposes:

- HTTP endpoint: `POST /retry` with body containing target URL and retry policy.
- Prometheus metrics: `retry_attempts_total`, `retry_wait_seconds`, `retry_success_total`.
- OpenTelemetry traces for each attempt.
- Configurable max in-flight (via `semaphore.Weighted`).

**Acceptance**:

- End-to-end test using `httptest.Server` to simulate failures.
- Unit tests using `synctest` for retry timing.
- Integration test using a real upstream (testcontainers nginx).
- Documented API in OpenAPI.

---

## Task 17 [P]. Audit A Real Open-Source Codebase

Pick a Go open-source project (e.g. `prometheus/prometheus`, `kubernetes/client-go`). Run:

```sh
git grep -nE 'time\.Sleep\(' -- '*_test.go'
```

For each hit:

- Classify the replacement bucket.
- Propose a refactor for the top 5 by impact.
- File at least one issue or pull request to upstream with the proposal.

**Acceptance**:

- A report with all classifications.
- 5 refactor proposals.
- At least 1 issue/PR filed.

---

## Task 18 [P]. Build A Test-Time Dashboard

Set up a system that:

- Runs the test suite on every commit (CI).
- Records per-test pass/fail in a database (PostgreSQL or similar).
- Computes rolling 30-day flake rate per test.
- Plots in Grafana.
- Alerts when any test crosses 1% flake.

**Acceptance**:

- Working end-to-end, with a screenshot of the dashboard.
- At least one alert configured and tested.

---

## Task 19 [P]. Implement A Test Quiescence Library

A library that, given a goroutine or `context.Context`, blocks until all spawned goroutines reach a quiescent state. Inspired by `synctest.Wait` but usable outside bubbled tests.

**Acceptance**:

- Public API: `quiescence.Wait(ctx, timeout) error`.
- Detects "all goroutines in the tracked set are blocked".
- Documented limitations (external I/O, etc.).
- Unit tests for the happy path and the timeout path.

**Hint**: this is essentially impossible to do perfectly without runtime support; do your best and document the limitations.

---

## Task 20 [P]. Lead An Eradication Programme (Roleplay)

You are the staff engineer assigned to lead a 1-quarter programme to eradicate `time.Sleep` from a 200-engineer Go monorepo. Produce:

- A 1-page exec summary for VP Eng.
- A 5-page detailed plan for engineering teams.
- A 30-min lunch-and-learn slide deck.
- A code-review checklist.
- A monthly dashboard mockup.
- A risk register with mitigation strategies.

**Acceptance**:

- All deliverables produced.
- At least one peer review for each.
- A retrospective written *after* the imagined 1-quarter programme reflecting on what went well/poorly.

---

## Notes On Working Through These Tasks

- The junior tasks should each take 30 minutes; if you are struggling, re-read `middle.md`.
- The middle tasks are the heart of the section; do all of them.
- The senior tasks build skills you will use in real teams.
- The professional tasks are projects; treat them as small open-source repos and put them on your portfolio.

Whichever tasks you do, share your solutions for review. A code reviewer who knows this material will catch subtle re-introductions of the anti-pattern.
