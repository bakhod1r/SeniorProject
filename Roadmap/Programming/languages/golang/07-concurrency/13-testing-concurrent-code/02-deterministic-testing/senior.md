# Deterministic Testing — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing Concurrent Code for Determinism](#designing-concurrent-code-for-determinism)
3. [The Clock Boundary](#the-clock-boundary)
4. [Observation Points for Quiescence](#observation-points-for-quiescence)
5. [Test Doubles for Concurrent Dependencies](#test-doubles-for-concurrent-dependencies)
6. [`synctest` at Scale — When to Use, When Not To](#synctest-at-scale-when-to-use-when-not-to)
7. [Reproducible Randomness for Property Testing](#reproducible-randomness-for-property-testing)
8. [CI Flake Budgets and SLOs](#ci-flake-budgets-and-slos)
9. [Catching Order-Dependent Bugs with Scheduler Shuffling](#catching-order-dependent-bugs-with-scheduler-shuffling)
10. [Goroutine Leak Gates in CI](#goroutine-leak-gates-in-ci)
11. [The Single-Goroutine Driver Pattern](#the-single-goroutine-driver-pattern)
12. [Replaying Production Traces in Tests](#replaying-production-traces-in-tests)
13. [Cross-Process Determinism](#cross-process-determinism)
14. [Anti-Patterns That Seniors Still Catch in Reviews](#anti-patterns-that-seniors-still-catch-in-reviews)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction

At middle level you mastered the toolbox: channels, WaitGroups, fake clocks, `testing/synctest`, repeat-runs. At senior level you stop being the user of these tools and start being the architect who decides how a service is designed so that those tools can be applied at all.

A test cannot be deterministic if the code under test is not designed to allow determinism. A function that calls `time.Now()` deep in a method body cannot be tested with virtual time without `synctest`. A worker pool with no shutdown signal cannot be tested with channel barriers. A `go someBackgroundJob()` buried in `init()` cannot be tested at all.

After this file you will:

- Design APIs that expose enough surface for deterministic tests (clock injection, ready/done signals, shutdown handles).
- Operate a CI strategy that catches flakes early: nightly stress jobs, `-cpu` sweeps, leak gates, flake-rate dashboards.
- Choose between `synctest`, fake clocks, single-goroutine drivers, and replay testing for any given codebase.
- Write tests that capture production failure modes deterministically by replaying captured traces.
- Catch test-design smells in code review without running the test: "this goroutine has no observation point" should be a comment you make on autopilot.

This file is opinionated. Senior engineers own the testing strategy of a system, not just the tests.

---

## Designing Concurrent Code for Determinism

The biggest leverage point is upstream of the test. If you design the production code to be observable, testable, and shutdownable from the outset, every test becomes simpler.

### Three properties of testable concurrent code

1. **Observable.** Every internal state transition that a test might want to assert on has a name and a way to be observed. Either a method returns it, or a channel emits it, or an event hook is invoked.
2. **Bounded.** Every spawned goroutine has a clearly defined lifecycle. It starts at a known point, exits at a known point. No background goroutines hide in `init`.
3. **Injectable.** Every external dependency — clock, random source, network, file system — is reachable via an interface that tests can replace.

These three properties are also the prerequisites for good production design. Tests do not corrupt your architecture; they reveal whether you have one.

### Anti-example: untestable timer

```go
type Job struct {
    next time.Time
}

func (j *Job) Run() {
    for {
        if time.Now().After(j.next) {
            j.do()
            j.next = time.Now().Add(time.Minute)
        }
        time.Sleep(time.Second)
    }
}
```

No clock injection, no shutdown, infinite loop, mandatory `time.Sleep`. No deterministic test possible. Refactor before writing tests.

### Testable version

```go
type Job struct {
    clock  Clock
    period time.Duration
    cancel context.CancelFunc
    done   chan struct{}
}

func (j *Job) Start(ctx context.Context) {
    ctx, j.cancel = context.WithCancel(ctx)
    j.done = make(chan struct{})
    go j.loop(ctx)
}

func (j *Job) Stop() {
    j.cancel()
    <-j.done
}

func (j *Job) loop(ctx context.Context) {
    defer close(j.done)
    t := j.clock.NewTicker(j.period)
    defer t.Stop()
    for {
        select {
        case <-t.C():
            j.do()
        case <-ctx.Done():
            return
        }
    }
}
```

Clock injected, cancellation explicit, `Stop` blocks until shutdown — a perfectly testable shape. Use `synctest` or `clockwork` to advance the ticker virtually and verify per-period behaviour.

---

## The Clock Boundary

The "clock boundary" is the set of all places where production code calls `time.Now`, `time.Sleep`, `time.After`, `time.NewTimer`, `time.NewTicker`, `time.AfterFunc`, or reads `time.Time` values from external systems.

A clean clock boundary is small, named, and crossed only in known places.

Pattern: introduce a single `Clock` interface in your `internal/` package:

```go
package clock

type Clock interface {
    Now() time.Time
    Since(t time.Time) time.Duration
    Sleep(d time.Duration)
    After(d time.Duration) <-chan time.Time
    NewTimer(d time.Duration) Timer
    NewTicker(d time.Duration) Ticker
    AfterFunc(d time.Duration, f func()) Timer
}

type Timer interface {
    C() <-chan time.Time
    Stop() bool
    Reset(d time.Duration) bool
}

type Ticker interface {
    C() <-chan time.Time
    Stop()
    Reset(d time.Duration)
}
```

Every consumer takes a `Clock`. Production wires `clock.Real()`. Tests wire a fake. The boundary is one import, one interface, and a code-review checklist item: "no `time.X` calls outside `internal/clock`."

On Go 1.25+, `testing/synctest` removes the need for this boundary entirely. Until then, the boundary is the gold standard for time-dependent code.

### Banning `time.X` outside the boundary

Use a linter to enforce. With `golangci-lint`, the `depguard` rule:

```yaml
linters-settings:
  depguard:
    rules:
      no-direct-time-outside-clock:
        deny:
          - pkg: time
            desc: "Use internal/clock instead of time directly"
        files:
          - $all
          - "!internal/clock/**"
```

Now the compiler-adjacent tooling enforces what code review used to.

---

## Observation Points for Quiescence

A test asserts after a barrier. A barrier requires an observation point in the code. If the code does not expose one, tests resort to sleeping. So: design observation points.

### Patterns

**Ready channel** — the goroutine signals when it has reached steady state.

```go
type Server struct { ... }
func (s *Server) Run(ready chan<- struct{}) { ... }
```

**Done channel** — the goroutine signals when it has exited.

```go
func (s *Server) Stop() <-chan struct{} { return s.done }
```

**Idle event** — the goroutine signals each time it enters the idle state.

```go
type Worker struct {
    onIdle chan struct{}
}
```

The test calls `Submit`, then waits on `onIdle`. Once idle, the worker has processed the submitted work.

**Event hook** — for fine-grained inspection.

```go
type Pool struct {
    OnTaskStart func(t Task)
    OnTaskDone  func(t Task)
}
```

The test sets the hook to a closure that records or counts, then asserts.

### Inside `synctest`, observation points are usually unnecessary

`synctest.Wait` already detects quiescence at the runtime level, so you do not need `idleChan` or hooks. Outside `synctest`, you design these points explicitly.

### A reusable testing API

```go
type Inspectable interface {
    WaitIdle(ctx context.Context) error
}
```

If a goroutine-owning type implements this, tests use it like:

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
require.NoError(t, w.WaitIdle(ctx))
```

Generic, composable, and matches the way Go services already accept contexts.

---

## Test Doubles for Concurrent Dependencies

External dependencies — databases, message queues, HTTP clients — must be replaceable in tests with doubles whose timing and concurrency are deterministic.

Three flavours:

- **Stub.** Returns canned data immediately. Useful for trivial cases.
- **Fake.** A behaviour-preserving in-memory implementation. Useful for end-to-end tests of business logic.
- **Recording double.** Records every call; the test asserts on the recorded calls.

For concurrent tests, the double should be:

- **Thread-safe.** It will be called from goroutines.
- **Synchronous.** No internal goroutines, no real timers. If the production interface is async, the double can be async but its async behaviour must be controllable by the test (e.g., a channel the test can close to release pending calls).
- **Inspectable.** The test can read counters, sequence, last argument, etc.

A typical recording fake:

```go
type FakeDB struct {
    mu      sync.Mutex
    queries []string
    next    error
    nextRow Row
}

func (f *FakeDB) Query(q string) (Row, error) {
    f.mu.Lock()
    defer f.mu.Unlock()
    f.queries = append(f.queries, q)
    return f.nextRow, f.next
}

func (f *FakeDB) Queries() []string {
    f.mu.Lock()
    defer f.mu.Unlock()
    return append([]string(nil), f.queries...) // copy
}
```

`Queries()` returns a copy to avoid mutation races in the test.

---

## `synctest` at Scale — When to Use, When Not To

`testing/synctest` is the most powerful tool in this article, but it has constraints. Knowing where it shines and where it fails is a senior-level skill.

### `synctest` shines for

- **Timers, tickers, timeouts.** Virtual time. A 24-hour test runs in microseconds.
- **Goroutine coordination.** `Wait` is the cleanest quiescence detector.
- **Context cancellation chains.** Virtual time means timeouts fire instantly.
- **Backoff and retry logic.** Verify exact backoff sequence without waiting.
- **State machines with periodic ticks.** Advance and inspect.

### `synctest` struggles with

- **OS-level I/O.** `net.Dial`, `os.Open`, syscalls. These block on real I/O and the bubble cannot virtualise them.
- **CGo-bound goroutines.** A goroutine in a CGo call is not preemptible by the synctest scheduler.
- **Global state used by code outside the bubble.** `init`-time goroutines, package-level tickers, etc.
- **Truly parallel workloads.** Inside the bubble, goroutines are cooperatively scheduled; CPU parallelism is muted.
- **Real-time properties.** "This handler responds in under 50ms" is not a virtual-time property and is not the right kind of test for `synctest`.

### Decision matrix

| Scenario | Use `synctest`? | Alternative |
|----------|-----------------|-------------|
| Cache with TTL | Yes | Fake clock |
| Retry with backoff | Yes | Fake clock + WaitGroup |
| HTTP server handling requests | Use `httptest` outside synctest | — |
| Worker pool draining a channel | Yes | Drain barrier |
| Heartbeat loop | Yes | Fake clock |
| Database integration test | No — uses real I/O | Test container |
| CPU-bound concurrency stress | No — needs real parallelism | `-race -count=N` |

### `synctest` mixed with real I/O

If the test needs both virtual time and real I/O, two patterns help:

- Wrap the I/O behind an interface and use a fake inside the bubble; do the real I/O test in a separate, non-bubble test.
- Run a real server in a goroutine outside the bubble, communicate with it via channels that are valid across the bubble boundary (channels work fine).

The second is fiddly; prefer the first.

---

## Reproducible Randomness for Property Testing

Senior teams write property tests over their concurrent code: "for any input matching this shape, the output satisfies this invariant." Property tests amplify the determinism question, because each run generates fresh inputs.

### `testing/quick`, `gopter`, `rapid`

Go ships `testing/quick`. Better libraries: `pgregory.net/rapid` (modern, shrinking, well-maintained) and `github.com/leanovate/gopter`.

Pattern with `rapid`:

```go
func TestQueueInvariant(t *testing.T) {
    rapid.Check(t, func(rt *rapid.T) {
        ops := rapid.SliceOf(rapid.Custom(genOp)).Draw(rt, "ops")
        q := NewQueue()
        for _, op := range ops {
            op.apply(q)
            invariantOk(rt, q)
        }
    })
}
```

`rapid` automatically logs the seed and shrinks failing inputs. On failure, the test prints the exact sequence to reproduce.

### Combining property tests with `synctest`

```go
func TestSchedulerInvariant(t *testing.T) {
    rapid.Check(t, func(rt *rapid.T) {
        synctest.Run(func() {
            scenario := drawScenario(rt)
            scenario.Run()
            scenario.AssertInvariants(rt)
        })
    })
}
```

Each property iteration runs in a fresh bubble. Failures shrink and reproduce deterministically.

### Seed logging

Always log the seed on failure. `rapid` does this automatically; if you roll your own, do not forget:

```go
t.Logf("seed=%d", seed)
```

A failure that does not log the seed is irreproducible.

---

## CI Flake Budgets and SLOs

A "flake budget" is the maximum acceptable flake rate, expressed as failures per N runs. Mature teams treat it as an SLO and track it.

Typical targets:

- **Critical path tests:** 0 failures per 10,000 runs.
- **Integration tests:** 0 failures per 1,000 runs.
- **End-to-end tests:** less than 1 failure per 1,000 runs.

To measure, run each test repeatedly in a nightly job and record outcomes. A test exceeding the budget is filed as a bug, owned by the originating team, and prioritised.

### Dashboard fields

- Test name.
- Pass count last 7 days.
- Fail count last 7 days.
- Flake rate.
- Owner.
- Status: green / warning / red.

### Quarantine

If a test crosses red, it is moved to a "quarantine" package excluded from gating CI. The owner has X days to fix or delete. Quarantine prevents one flaky test from blocking the whole pipeline while still applying pressure.

### Stress job

A nightly stress job runs the entire suite with `-race -count=20 -cpu 1,2,4,8`. Failures here are pre-emptive: they catch flakes before they hit gating CI.

---

## Catching Order-Dependent Bugs with Scheduler Shuffling

The standard Go scheduler picks an order. Most of the time, that order is similar across runs. Tests that pass on the standard order can fail on an "unusual" order.

Tools to nudge the scheduler:

- **`runtime.Gosched()` between operations.** Forces a scheduling point. Not always honoured, but a hint.
- **`GODEBUG=asyncpreemptoff=0`** (default) enables async preemption, which interrupts long-running goroutines.
- **`GODEBUG=gctrace=1`** triggers more GC-induced preemption.
- **`-cpu` sweep.** Different `GOMAXPROCS` values produce different interleavings.
- **`testing/synctest`** explores the cooperative-scheduled space; combine with `rapid` to randomise ordering.

For production-grade order-dependent bug hunting, run the suite under `-race` with `-cpu 1,2,4,8,16,32 -count=50` nightly. If a test passes here, you have strong evidence of robustness.

### A "chaos" mode

Some teams add a build tag `chaos` that injects randomised `runtime.Gosched` and `time.Sleep(time.Nanosecond)` into the test code:

```go
//go:build chaos

func init() {
    chaos = true
}

func MaybeYield() {
    if chaos && rand.Intn(8) == 0 {
        runtime.Gosched()
    }
}
```

Sprinkled in the code under test, this shuffles interleavings. Run nightly under chaos to find new orderings. **Note:** this is the rare case where deliberately non-determinism is a test technique, but only when its non-determinism is reproducible via a logged seed.

---

## Goroutine Leak Gates in CI

A deterministic test that leaks a goroutine is still a bug. Use `goleak` to detect:

```go
package mypkg

import (
    "testing"
    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

After every test in the package, `goleak` checks `runtime.Stack` for unexpected goroutines. If any remain, the test fails with their stack traces.

In gating CI, every package has `goleak.VerifyTestMain`. Combined with `synctest`'s own leak check (the bubble panics on residual goroutines), tests cannot ship leaks.

### Allowing legitimate background goroutines

Some packages legitimately spawn long-lived goroutines (HTTP server pools, metric exporters). Use `goleak.IgnoreTopFunction("...")` to whitelist them:

```go
goleak.VerifyTestMain(m,
    goleak.IgnoreTopFunction("github.com/exporter/foo.bar"),
)
```

Document each ignore with a comment. An unjustified ignore is technical debt.

---

## The Single-Goroutine Driver Pattern

Some concurrent code is too hostile to deterministic testing. Workarounds: refactor it into a single-goroutine **driver** for tests.

Pattern:

```go
type Engine struct {
    in  chan Event
}

func (e *Engine) Step() {
    select {
    case ev := <-e.in:
        e.handle(ev)
    default:
    }
}
```

In production, a goroutine loops `for { e.Step() }`. In tests, the test calls `e.Step()` directly — no goroutine — and feeds events one at a time. The engine logic is exercised exactly the same way, but the scheduler is removed.

This is a powerful pattern for state machines and event handlers. It forces a clean separation between "logic" and "driving the logic," which is good architecture anyway.

### When the single-goroutine driver is the right call

- State machines with no internal parallelism.
- Event-driven systems with one consumer.
- Reducer-style code: `state = step(state, event)`.

### When it is wrong

- Workloads that intentionally parallelise.
- Tests of concurrency itself.
- Any case where the goroutine is the unit under test.

---

## Replaying Production Traces in Tests

Mature teams capture production failure modes and convert them into deterministic regression tests.

### Capture

When an incident reveals a concurrency bug, capture the relevant events: log lines, queue depths, request rates, timing data. Convert into a fixture file:

```json
[
  {"at": "0ms",  "ev": "request", "id": 1},
  {"at": "10ms", "ev": "request", "id": 2},
  {"at": "15ms", "ev": "upstream_error", "id": 1},
  ...
]
```

### Replay

The test reads the fixture, drives the system at virtual time:

```go
func TestIncident_2026_01_15(t *testing.T) {
    synctest.Run(func() {
        s := NewServer(...)
        events := loadFixture(t, "incidents/2026-01-15.json")
        for _, e := range events {
            advanceTo(e.at)
            s.Inject(e)
        }
        synctest.Wait()
        // assert: no leaked request, response sent for id=1, etc.
    })
}
```

Now the incident is a permanent regression test that runs in microseconds.

### Trace formats

Use OpenTelemetry traces or `runtime/trace` exports. Tooling: `golang.org/x/exp/trace` parses execution traces; you can convert them into fixtures.

---

## Cross-Process Determinism

Some systems span processes (microservices, leader election, multi-node coordination). Deterministic testing extends to these via:

- **In-process simulation.** Run "node A" and "node B" as two goroutines in the same test, communicating via channels. Inject a fake network with a controllable delivery order.
- **Lamport timestamps.** Logical clocks that order events without wall-clock time.
- **Deterministic schedulers like FoundationDB's flow simulator** — translated to Go via `cockroachdb/cockroach`'s `simulator` package (real-world example).
- **Jepsen-style tests** for distributed correctness; less deterministic but explicit about partition modelling.

CockroachDB's simulation framework runs a whole cluster in one process with virtualised time and network. Tests like `TestRaftLeaseExtension` exercise scenarios that would be impossible to reproduce in a real cluster but are routine in the simulator.

For most teams, in-process simulation with channels and synctest is enough. Push to a true simulator only when integration tests stop being tractable.

---

## Anti-Patterns That Seniors Still Catch in Reviews

The senior eye spots these in PRs without needing to run the test:

### 1. `time.Sleep(50 * time.Millisecond)` anywhere in `_test.go`

Comment: "Replace with a barrier. What event are you actually waiting for?"

### 2. `runtime.Gosched()` as a synchroniser

Comment: "Gosched is a hint, not a guarantee. Use a channel."

### 3. `assert(elapsed < 100*time.Millisecond)`

Comment: "Wall-clock duration is not a test target. Use virtual time or remove the assertion."

### 4. `t.Parallel()` plus a global mutable variable

Comment: "These tests will race when parallel. Move state into the test."

### 5. A goroutine spawned in code under test with no shutdown signal

Comment: "Add a `Close` or `Stop`; otherwise the test cannot wait for it cleanly."

### 6. Reading `time.Now()` deep in production code

Comment: "Inject a Clock. Otherwise this is untestable with virtual time."

### 7. `select { case <-ch: case <-time.After(d): t.Fatal(...) }` with d < 1 second

Comment: "Use 5 seconds minimum, or `t.Deadline()`-based. Short timeouts produce false positives in CI."

### 8. `for { select {...} }` with no exit case

Comment: "Add ctx.Done() or a stop channel. This goroutine cannot be tested for termination."

### 9. A property test with no `t.Logf("seed=%d", seed)`

Comment: "Log the seed; failures must be reproducible."

### 10. `goleak` not present in `TestMain`

Comment: "Add `goleak.VerifyTestMain`. The package can leak today."

These nine reflexes save weeks of debugging.

---

## Self-Assessment

- [ ] I can refactor an untestable timer-based job into a testable shape in one sitting.
- [ ] I can describe the clock boundary and enforce it with a linter.
- [ ] I know three observation point patterns and pick the right one per situation.
- [ ] I know when `synctest` is the right tool and when to fall back to fake clocks.
- [ ] I can write a property test for a concurrent invariant using `rapid` with seed logging.
- [ ] I have set up a flake budget for my team and track flake rate.
- [ ] I run `-cpu 1,2,4,8 -count=20 -race` nightly on the concurrent suite.
- [ ] I add `goleak.VerifyTestMain` to every package I own.
- [ ] I have captured a production incident as a deterministic replay test.
- [ ] I catch all ten anti-patterns above in code review.

---

## Summary

Senior-level deterministic testing is an architectural concern. You shape the production code so that tests can be deterministic at all: inject the clock, expose shutdown handles, gate the clock boundary with a linter, define quiescence APIs. You operate the CI strategy that makes flakes visible: nightly stress jobs, flake-rate dashboards, leak gates, `-cpu` sweeps. You know when to reach for `synctest`, when to drop down to fake clocks, when to write a single-goroutine driver, and when to spin up an in-process simulator. You catch test-design smells in PR reviews on instinct. The payoff is a CI that means something and a team that trusts every red.
