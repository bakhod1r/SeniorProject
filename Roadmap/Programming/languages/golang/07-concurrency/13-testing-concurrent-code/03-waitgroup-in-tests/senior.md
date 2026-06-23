---
layout: default
title: WaitGroup in Tests — Senior
parent: WaitGroup in Tests
grand_parent: Testing Concurrent Code
nav_order: 3
permalink: /roadmap/programming-languages/golang/07-concurrency/13-testing-concurrent-code/03-waitgroup-in-tests/senior/
---

# WaitGroup in Tests — Senior

[← Back to WaitGroup in Tests](./)

At this level we stop writing one-off tests and start designing the *testing surface* of concurrent code. The central pattern is the **start barrier** — making N goroutines wait on a single signal, then releasing them simultaneously to maximise contention. This is the technique that gives the race detector its best shot at finding bugs. We also cover deterministic ordering across goroutines, shared helper libraries, the relationship between `WaitGroup` and `errgroup.Group` for real test harnesses, and the discipline of running concurrent tests under `-race -count=N`.

---

## 1. The start-barrier pattern for race testing

The race detector is a sampling tool. It instruments memory accesses and reports a race when two non-synchronised accesses hit the same address. If the two accesses are temporally far apart, the detector may miss the race on any given run. To find a race reliably, you must make the racing accesses *happen at the same instant on different cores*.

The start barrier does exactly that:

```go
func TestConcurrentMapWrite(t *testing.T) {
    m := NewMap()
    const N = 100
    start := make(chan struct{})

    var wg sync.WaitGroup
    wg.Add(N)
    for i := 0; i < N; i++ {
        i := i
        go func() {
            defer wg.Done()
            <-start                       // park here
            m.Set(i, i*i)                 // contended op
        }()
    }
    close(start)                          // fire the gun
    wg.Wait()

    for i := 0; i < N; i++ {
        if v, ok := m.Get(i); !ok || v != i*i {
            t.Errorf("m.Get(%d) = (%v, %v), want (%d, true)", i, v, ok, i*i)
        }
    }
}
```

Mechanics:

- 100 goroutines park on `<-start` before doing any work.
- The test goroutine `close(start)` — every parked goroutine wakes within microseconds of each other.
- Each one races into `m.Set(i, ...)` with the others.
- If `Map.Set` has a race, the detector almost certainly catches it.

Without the start barrier, the goroutines spawn one at a time over hundreds of microseconds; the first ones may finish before the last ones start. Contention is minimal. The race detector may report nothing on a hundred runs.

### Why a single `close` instead of a `select` per goroutine

`close(start)` is one operation. Every parked receiver wakes on the same instant. If you instead sent `N` values to a channel, you would release goroutines one at a time, defeating the purpose.

### Why `Add(N)` outside the loop and the goroutine

The start barrier relies on all `N` goroutines being parked before `close(start)`. The `Add(N)` outside the loop is a one-time atomic; the spawn loop is fast (microseconds). By the time the test goroutine reaches `close(start)`, all `N` workers are at `<-start`.

If you `Add(1)` inside each goroutine, you have a race: the test goroutine cannot be sure all workers have registered. Symptoms: `wg.Wait` returns early because some `Add`s have not happened yet.

### How many goroutines

For race testing on a typical 8-core machine, 50–200 goroutines is the sweet spot. Fewer and the OS scheduler doesn't oversubscribe enough to find races. More and the test becomes slow without finding more bugs.

### Combining with `-count`

```
go test -race -run TestConcurrentMapWrite -count=100
```

100 runs of the same test. Each run gets a slightly different schedule. A race that hits once in 50 runs becomes statistically certain to be observed in 100 runs.

---

## 2. Two-phase barriers: setup, then start

Sometimes the goroutines need to do *non-racing* setup before they all hit the contended operation. Use two barriers:

```go
var setupWG, finishWG sync.WaitGroup
setupWG.Add(N)
finishWG.Add(N)
start := make(chan struct{})

for i := 0; i < N; i++ {
    i := i
    go func() {
        defer finishWG.Done()

        // Phase 1: setup
        local := prepare(i)
        setupWG.Done()

        // Phase 2: wait, then race
        <-start
        contendedOp(local)
    }()
}

setupWG.Wait()      // all goroutines ready
close(start)        // fire
finishWG.Wait()     // all done
```

Order:

1. Test spawns N goroutines.
2. Each goroutine does its private setup, calls `setupWG.Done`, parks on `<-start`.
3. Test sees `setupWG.Wait` return — all goroutines parked.
4. Test closes `start`. All goroutines wake simultaneously.
5. Each runs the contended operation and calls `finishWG.Done`.
6. Test sees `finishWG.Wait` return. Assertions.

Two WaitGroups, one start channel. The pattern scales to N phases.

---

## 3. Deterministic ordering across goroutines

The Go scheduler does not guarantee any particular interleaving. To assert "event A happened before event B" inside a test, you cannot rely on timing — you must drive the order.

Two techniques:

### 3a. Hand-rolled rendezvous with channels

```go
phase1Done := make(chan struct{})
phase2Done := make(chan struct{})

var wg sync.WaitGroup
wg.Add(2)
go func() {
    defer wg.Done()
    phase1Work()
    close(phase1Done)
    <-phase2Done
    phase3Work()
}()
go func() {
    defer wg.Done()
    <-phase1Done
    phase2Work()
    close(phase2Done)
}()

wg.Wait()
```

Two goroutines, four phases, deterministic order: 1 → 2 → 3.

### 3b. `synctest` (Go 1.24+)

Inside a `synctest.Run` bubble, the scheduler is deterministic and "virtual time" replaces real time. WaitGroups inside the bubble work as expected; the difference is that `time.Sleep` and `time.After` advance virtual time, not wall-clock time. See `02-deterministic-testing/middle.md`.

`synctest.Wait()` (from the same package) is a stronger barrier: it returns only when *every* goroutine in the bubble is blocked, capturing a true quiescent state. For tests that need "the system has settled," it is unmatched.

---

## 4. Shared helper libraries

Once your project has 20 concurrent tests, the boilerplate becomes unbearable. Lift it into a `testutil` package.

```go
package testutil

import (
    "context"
    "sync"
    "testing"
    "time"

    "go.uber.org/goleak"
)

// WaitTimeout fails the test if wg.Wait does not return within d.
func WaitTimeout(t *testing.T, wg *sync.WaitGroup, d time.Duration) {
    t.Helper()
    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
    case <-time.After(d):
        t.Fatalf("WaitGroup did not finish within %v", d)
    }
}

// StartBarrier returns a channel and a "fire" function. All goroutines
// receiving on the channel proceed simultaneously when fire is called.
func StartBarrier() (start <-chan struct{}, fire func()) {
    ch := make(chan struct{})
    return ch, func() { close(ch) }
}

// WithCancelCtx wires a context.WithCancel with cleanup.
func WithCancelCtx(t *testing.T) context.Context {
    t.Helper()
    ctx, cancel := context.WithCancel(context.Background())
    t.Cleanup(cancel)
    return ctx
}

// NoLeak registers goleak.VerifyNone(t) as a cleanup (runs last in LIFO).
func NoLeak(t *testing.T) {
    t.Helper()
    t.Cleanup(func() { goleak.VerifyNone(t) })
}

// Eventually polls cond every tick until true or d elapses.
func Eventually(t *testing.T, cond func() bool, d, tick time.Duration, msg string) {
    t.Helper()
    deadline := time.Now().Add(d)
    for time.Now().Before(deadline) {
        if cond() {
            return
        }
        time.Sleep(tick)
    }
    t.Fatalf("eventually: %s (timed out after %v)", msg, d)
}

// SpawnAndWait spawns n goroutines running body and waits with a timeout.
func SpawnAndWait(t *testing.T, n int, d time.Duration, body func(i int)) {
    t.Helper()
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        i := i
        go func() {
            defer wg.Done()
            body(i)
        }()
    }
    WaitTimeout(t, &wg, d)
}

// RaceTest spawns n goroutines that all wait on a start barrier, then run body.
func RaceTest(t *testing.T, n int, d time.Duration, body func(i int)) {
    t.Helper()
    start, fire := StartBarrier()
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        i := i
        go func() {
            defer wg.Done()
            <-start
            body(i)
        }()
    }
    fire()
    WaitTimeout(t, &wg, d)
}
```

Now your tests are short:

```go
func TestConcurrentInc(t *testing.T) {
    testutil.NoLeak(t)
    c := NewCounter()
    testutil.RaceTest(t, 100, 2*time.Second, func(_ int) {
        c.Inc()
    })
    if c.Get() != 100 {
        t.Errorf("Get = %d, want 100", c.Get())
    }
}
```

One helper line replaces a dozen lines of boilerplate.

---

## 5. The relationship between `WaitGroup` and `errgroup.Group`

`errgroup.Group` is essentially:

```go
type Group struct {
    wg    sync.WaitGroup
    once  sync.Once
    err   error
    cancel func()
}
```

It wraps a WaitGroup with three additions:

1. `Go(func() error)` — spawns a goroutine and registers `Add`/`Done` automatically.
2. First-error capture — the first goroutine that returns non-nil wins.
3. Optional context cancellation — `WithContext` returns a derived context that is cancelled on first error.

Use `errgroup` in tests when:

- All goroutines must succeed.
- A single error should fail the test.
- You want short-circuit cancellation (the failing goroutine cancels the others).

Use raw `WaitGroup` in tests when:

- Goroutines do not return errors (e.g., they call `t.Errorf` directly).
- You want explicit control over the WaitGroup (e.g., re-using across phases).
- You are doing race testing and the goroutines must all run in parallel without short-circuit cancellation.

### `errgroup` with a start barrier

```go
g, ctx := errgroup.WithContext(testutil.WithCancelCtx(t))
start, fire := testutil.StartBarrier()
for i := 0; i < N; i++ {
    i := i
    g.Go(func() error {
        select {
        case <-start:
        case <-ctx.Done():
            return ctx.Err()
        }
        return work(i)
    })
}
fire()
if err := g.Wait(); err != nil {
    t.Fatal(err)
}
```

Each goroutine selects on both the start barrier and the context, so a context cancellation during setup still propagates.

---

## 6. Designing testable concurrent APIs

A concurrent API is testable when:

- It exposes a deterministic completion event (e.g., `Stop` blocks until all internal goroutines have exited).
- It accepts a context for cancellation.
- Internal goroutines select on the context so cancellation is prompt.
- It exposes counters or hooks for observation (e.g., `Processed() int`).

The test code that consumes such an API is simple — a barrier on `Stop`, a poll on `Processed`. The complexity lives in the API, where it belongs.

Counter-example: an API whose only completion signal is "wait long enough." Any test of such an API is flaky.

### Hook injection

A common technique: an optional `OnDone func()` callback. The test injects a function that records when the event happened.

```go
type Worker struct {
    OnDone func(id int)
}

// in production: OnDone is nil and ignored
// in tests: OnDone increments a counter and closes a channel
```

The test then waits on the test channel, not on a sleep.

---

## 7. CI flake budgets and `-count`

A *flake budget* is a policy: "this test must pass 999 in 1000 runs to be considered stable." Concrete check:

```
go test -race -run TestX -count=1000 -timeout 10m
```

A test that fails twice or more is flaky. Most flakes trace to:

- A missing barrier (sleep instead of `wg.Wait`).
- An `Add`-after-`Wait` race.
- A goroutine that does not respect context cancellation.
- A polling loop with too-tight a deadline.

For each flake, do not "retry" — find the missing barrier. The senior discipline is to *never accept* a flake.

### Combining `-race` and `-count`

`-race` slows tests 5–10x. `-count=100` is 100x. Together that is 500x. Practical pattern:

- Local: `go test -race -count=10` after major changes.
- PR CI: `go test -race -count=3`.
- Nightly: `go test -race -count=100`.
- Per-commit: `go test -race -count=1`.

The nightly run catches subtle flakes that PR CI misses.

---

## 8. Quiescent-state assertions

Sometimes the test wants to assert "the system has settled — no goroutine is doing anything." This is a *quiescent state*. Two ways to assert it:

### 8a. `synctest.Wait()` (Go 1.24+)

```go
synctest.Run(func() {
    sys := New()
    sys.Submit(input)
    synctest.Wait()           // all bubble goroutines blocked
    if !sys.Done() {
        t.Error("not done after quiescence")
    }
})
```

`synctest.Wait` returns only when every goroutine in the bubble is parked. It is the closest Go has to a global "stop the world" barrier.

### 8b. Polling

```go
testutil.Eventually(t, sys.Done, 2*time.Second, 5*time.Millisecond, "system done")
```

Less precise but works in any Go version. Tradeoff: the test takes up to 2 seconds when the system is stuck.

For new code, prefer `synctest`. For older codebases, polling is fine.

---

## 9. Leak detection across test packages

`goleak.VerifyTestMain(m)` checks at the end of *every* `Test*` function in a package. To check across packages, you need build-system support:

```go
// in each package's *_test.go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m,
        // package-specific ignores
        goleak.IgnoreTopFunction("github.com/myorg/pkg.flushMetrics"),
    )
}
```

For a project-wide policy, lift the ignores into a shared file and call:

```go
func TestMain(m *testing.M) {
    testutil.VerifyTestMainStandard(m)
}
```

where `VerifyTestMainStandard` calls `goleak.VerifyTestMain` with the project-wide ignore list.

### What to ignore vs. what to fix

- Genuine long-lived singletons (one-time `init` goroutines that log forever) → ignore.
- Test-spawned goroutines that should have died but didn't → fix.
- Library goroutines you cannot stop (e.g., `database/sql` driver pool) → ignore, with a comment pointing at the upstream bug.

Each ignore is a tax on future debugging. Fight the urge to ignore.

---

## 10. `t.Parallel` and barriers

`t.Parallel` runs subtests concurrently. Each subtest has its own `*testing.T`. Inside a parallel subtest, a WaitGroup works exactly as in a serial test — the subtest's goroutines are its own.

The hazard: parallel subtests sharing state.

```go
var counter int
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        counter++          // RACE across parallel subtests
    })
}
```

Each subtest writes `counter` from a different goroutine. Race detector catches it. Fix: don't share state across parallel subtests, or guard it with a mutex (then the test is checking the mutex, not the code).

### Parallel race tests

For a stress test, running 8 parallel copies of the same race test is a cheap way to increase coverage:

```go
for i := 0; i < 8; i++ {
    i := i
    t.Run(fmt.Sprintf("worker-%d", i), func(t *testing.T) {
        t.Parallel()
        testutil.RaceTest(t, 100, 2*time.Second, func(_ int) {
            shared.Inc()
        })
    })
}
```

Eight parallel race tests, each spawning 100 goroutines, all hammering a shared singleton. The race detector loves this.

---

## 11. Reusing a WaitGroup across waves

Re-using is legal if the test goroutine sequences the waves. After `Wait` returns, the WaitGroup is at zero. `Add(M)` for the next wave is safe because the test goroutine's program order provides happens-before.

```go
var wg sync.WaitGroup
for wave := 0; wave < 3; wave++ {
    wg.Add(N)
    for i := 0; i < N; i++ {
        i := i
        go func() {
            defer wg.Done()
            doWave(wave, i)
        }()
    }
    testutil.WaitTimeout(t, &wg, 2*time.Second)
    assertWave(t, wave)
}
```

Three waves of N workers each. The WaitGroup is reused. The test passes a fresh barrier per wave by virtue of `Wait` resetting the counter to zero.

If any goroutine from wave 0 could outlive `wg.Wait` and call `wg.Add` in parallel with the test goroutine, the pattern breaks. In practice, the goroutines complete fully (calling `Done` *after* their work, not from a child goroutine).

---

## 12. The "barrier graph" for complex tests

For tests with intricate ordering, draw the barrier graph before coding. Nodes are events; edges are happens-before constraints enforced by barriers.

Example: testing a pub/sub system with one publisher and two subscribers.

```
[publisher start]
       |
       v
[subscriber-1 ready]    [subscriber-2 ready]
       |                       |
       +-----------------------+
                |
                v
       [both subscribed]
                |
                v
       [publisher sends message]
                |
                v
[subscriber-1 received]   [subscriber-2 received]
                |                       |
                +-----------------------+
                            |
                            v
                  [assertion: both got msg]
```

Each diamond is a fan-in barrier — a WaitGroup. Each linear edge is a channel. The test code mirrors the graph:

```go
readyWG := sync.WaitGroup{}
readyWG.Add(2)
recvWG := sync.WaitGroup{}
recvWG.Add(2)

bus := NewBus()

go func() {
    sub := bus.Subscribe(topic)
    readyWG.Done()
    msg := <-sub
    if msg != "hello" {
        t.Errorf("subscriber-1 got %q", msg)
    }
    recvWG.Done()
}()
go func() {
    sub := bus.Subscribe(topic)
    readyWG.Done()
    msg := <-sub
    if msg != "hello" {
        t.Errorf("subscriber-2 got %q", msg)
    }
    recvWG.Done()
}()

readyWG.Wait()
bus.Publish(topic, "hello")
testutil.WaitTimeout(t, &recvWG, 2*time.Second)
```

Two barriers, one channel publish, deterministic order. Any concurrent test can be expressed this way once you draw the graph.

---

## 13. Anti-patterns I still see in senior code

### "Use a `time.Sleep` and live with the flake."

No. Find the missing barrier or hook.

### "Skip flaky tests with `t.Skip`."

The bug stays in the code. Worse, future tests inherit the same flake.

### "Set the test timeout to 30 minutes so the build doesn't fail."

You have moved the failure from CI to production.

### "Use `time.Sleep(0)` to yield."

`time.Sleep(0)` yields to the scheduler. It is *occasionally* useful in fuzz harnesses to vary scheduling, but it is not a barrier and does not solve any ordering problem.

### "WaitGroup in production code, sleep in tests."

Inconsistent. If `wg.Wait` is the right primitive in production, it is the right primitive in tests. The test code should look like the production code, not different.

---

## 14. Summary

The senior skills are:

- **Start-barrier pattern.** Make every race-test goroutine wait on one signal, then release them all at once.
- **Two-phase barrier.** Separate per-goroutine setup from the contended operation.
- **Shared helper library.** Build a `testutil` package with `WaitTimeout`, `StartBarrier`, `RaceTest`, `Eventually`, `NoLeak`. Reuse across the project.
- **`errgroup` for first-error fan-out.** `WaitGroup` for fire-and-forget. `synctest.Wait` for quiescent assertions.
- **Designing for testability.** APIs expose deterministic completion, context cancellation, and observation hooks.
- **Flake budgets and `-count`.** Never accept a flaky test; find the missing barrier.
- **Quiescent-state assertions.** Use `synctest.Wait` (Go 1.24+) or polling with a hard cap.

The single move that distinguishes a senior concurrent test from a middle-level one is the start barrier. Master it.
