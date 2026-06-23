---
layout: default
title: WaitGroup in Tests — Tasks
parent: WaitGroup in Tests
grand_parent: Testing Concurrent Code
nav_order: 7
permalink: /roadmap/programming-languages/golang/07-concurrency/13-testing-concurrent-code/03-waitgroup-in-tests/tasks/
---

# WaitGroup in Tests — Tasks

[← Back to WaitGroup in Tests](./)

A graded set of hands-on exercises. Each task includes a target, the starter code (or pseudocode), an expected behaviour, and the grading criteria. Run each finished task with `go test -race -count=10` before considering it complete.

---

## Task 1 — Fix the missing barrier (Easy)

**Target.** This test passes locally and flakes in CI. Add a barrier so it never flakes.

**Starter.**

```go
package counter

import (
    "sync"
    "testing"
)

type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c *Counter) Get() int { c.mu.Lock(); defer c.mu.Unlock(); return c.n }

func TestInc100(t *testing.T) {
    c := &Counter{}
    for i := 0; i < 100; i++ {
        go c.Inc()
    }
    if c.Get() != 100 {
        t.Errorf("Get = %d, want 100", c.Get())
    }
}
```

**Expected.** A WaitGroup with `Add(100)` before the loop, `Done` inside each call. After `wg.Wait`, the assertion holds.

**Grading.**

- [ ] Test passes 1000 times in a row with `-race -count=1000`.
- [ ] No `time.Sleep` in the test.
- [ ] `Add` is in the test goroutine, before the loop.

---

## Task 2 — Implement `WaitTimeout` (Easy)

**Target.** Write the canonical `WaitTimeout` helper.

**Signature.**

```go
func WaitTimeout(t *testing.T, wg *sync.WaitGroup, d time.Duration)
```

**Expected behaviour.**

- Returns when `wg.Wait` returns, if within `d`.
- Calls `t.Fatalf` if `d` elapses first, with a clear message.
- Marks itself as a helper.

**Test of the helper.** Write two unit tests:

```go
func TestWaitTimeoutSucceeds(t *testing.T) {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() { time.Sleep(10 * time.Millisecond); wg.Done() }()
    WaitTimeout(t, &wg, 100 * time.Millisecond)
}

func TestWaitTimeoutFails(t *testing.T) {
    fakeT := &recordingT{}
    var wg sync.WaitGroup
    wg.Add(1)               // never Done
    WaitTimeout(fakeT, &wg, 10 * time.Millisecond)
    if !fakeT.fataled {
        t.Errorf("WaitTimeout did not call Fatalf")
    }
}
```

**Grading.**

- [ ] `WaitTimeout` calls `t.Helper`.
- [ ] On success path, no `t.Fatalf` is called.
- [ ] On timeout path, `t.Fatalf` is called once with a useful message.

---

## Task 3 — Rewrite a sleep-based test (Easy)

**Target.** Replace `time.Sleep` with a real barrier.

**Starter.**

```go
func TestStartsAndStops(t *testing.T) {
    s := NewService()
    s.Start()
    time.Sleep(100 * time.Millisecond)   // wait for service to be ready
    if !s.Ready() {
        t.Fatal("not ready")
    }
    s.Stop()
    time.Sleep(100 * time.Millisecond)   // wait for service to stop
    if s.Running() {
        t.Fatal("still running")
    }
}
```

**Expected.** Use a polling deadline with a hard cap. Or, if `Service` exposes a `Done()` channel, use that.

**Grading.**

- [ ] No `time.Sleep` outside the inner polling loop.
- [ ] Every wait has a hard cap with a clear failure message.

---

## Task 4 — Add `goleak` to a leaky test (Easy)

**Target.** Add `goleak.VerifyNone` to a test that currently passes despite leaking a goroutine. Confirm the test now fails. Then fix the leak. Confirm the test passes.

**Starter.**

```go
func TestRunUntilCancelled(t *testing.T) {
    ctx := context.Background()       // BUG: cancelled context never created
    go RunUntilCancelled(ctx)
}
```

`RunUntilCancelled(ctx)` is an infinite loop until `ctx.Done()`.

**Expected.**

- Step 1: add `defer goleak.VerifyNone(t)`. The test fails with a leaked goroutine.
- Step 2: replace `ctx` with `WithCancel`, defer `cancel`, use a WaitGroup with cleanup. The test passes.

**Grading.**

- [ ] `goleak` reports the original leak.
- [ ] After fix, `goleak` reports no leak.
- [ ] Cleanup uses `cancel` *before* `wg.Wait`.

---

## Task 5 — Implement the start-barrier helper (Medium)

**Target.** Write a `StartBarrier()` helper that returns a receive-only channel and a fire function.

**Signature.**

```go
func StartBarrier() (start <-chan struct{}, fire func())
```

**Expected.**

```go
start, fire := StartBarrier()
for i := 0; i < N; i++ {
    go func() {
        <-start
        contended()
    }()
}
fire()
```

All N goroutines wake within microseconds. `fire` is idempotent (calling it twice does not panic).

**Grading.**

- [ ] First `fire()` releases all parked goroutines.
- [ ] Second `fire()` is a no-op (sync.Once is fine).
- [ ] No data race under `-race`.

---

## Task 6 — Race-test a counter (Medium)

**Target.** Use the start-barrier pattern to test that `Counter.Inc` is race-free.

**Starter.**

```go
type Counter struct{ n int64 }
func (c *Counter) Inc() { c.n++ }              // BUG: not atomic
func (c *Counter) Get() int64 { return c.n }
```

**Expected.** Race test with 100 goroutines and start barrier. Run with `-race -count=10`. The test must report a race.

Then fix `Inc` (use `atomic.Int64`). Re-run. The test must pass.

**Grading.**

- [ ] Original code: race reported.
- [ ] Fixed code: no race, counter correct.
- [ ] Test uses start barrier.
- [ ] Test uses `WaitTimeout`.

---

## Task 7 — Test a pub/sub bus (Medium)

**Target.** Two subscribers receive a single published message. The test must be deterministic.

**Signatures.**

```go
type Bus struct{ ... }
func (b *Bus) Subscribe(topic string) <-chan string
func (b *Bus) Publish(topic, msg string)
```

**Expected test.**

```go
func TestBus(t *testing.T) {
    bus := NewBus()
    var readyWG, recvWG sync.WaitGroup
    readyWG.Add(2)
    recvWG.Add(2)

    received := make([]string, 2)
    for i := 0; i < 2; i++ {
        i := i
        go func() {
            ch := bus.Subscribe("topic")
            readyWG.Done()
            received[i] = <-ch
            recvWG.Done()
        }()
    }
    readyWG.Wait()
    bus.Publish("topic", "hello")
    WaitTimeout(t, &recvWG, 2*time.Second)

    for i, m := range received {
        if m != "hello" {
            t.Errorf("received[%d] = %q, want %q", i, m, "hello")
        }
    }
}
```

**Grading.**

- [ ] Two barriers (ready, recv) before publish/assert.
- [ ] `WaitTimeout` used.
- [ ] Test passes deterministically under `-race -count=100`.

---

## Task 8 — Build a `SpawnAndWait` helper (Medium)

**Target.** A higher-order helper that hides the WaitGroup boilerplate.

**Signature.**

```go
func SpawnAndWait(t *testing.T, n int, body func(i int))
```

**Expected.** Spawns `n` goroutines, each calling `body(i)`, waits up to 5 seconds.

**Grading.**

- [ ] Uses `t.Helper`.
- [ ] No race on the spawned goroutines.
- [ ] Test that uses it is one line.

---

## Task 9 — Detect a `Wait`-before-`Add` race (Medium)

**Target.** Write a test that demonstrates the `Wait`-before-`Add` race. Run with `-race` and confirm the detector flags it.

**Starter.**

```go
func TestRacyAdd(t *testing.T) {
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        go func() {
            wg.Add(1)
            defer wg.Done()
        }()
    }
    wg.Wait()
}
```

**Expected.**

- Run `go test -race`. Race detector reports a race on the WaitGroup state.
- Fix: move `Add(4)` before the loop.
- Re-run. No race.

**Grading.**

- [ ] Original code triggers race detector.
- [ ] Fixed code does not.
- [ ] Both versions are committed to the repo.

---

## Task 10 — Reproduce a double-`Done` panic (Medium)

**Target.** Write code that triggers `panic: sync: negative WaitGroup counter`. Then fix it.

**Starter.**

```go
go func() {
    defer wg.Done()
    if err := work(); err != nil {
        wg.Done()    // extra Done
        return
    }
}()
```

**Expected.** Run the test. It panics. Remove the extra `Done`. Re-run. No panic.

**Grading.**

- [ ] First version panics.
- [ ] Fixed version does not.
- [ ] Explain in a comment why the original is wrong.

---

## Task 11 — Implement `Eventually` (Medium)

**Target.** Re-implement `assert.Eventually` from scratch.

**Signature.**

```go
func Eventually(t *testing.T, cond func() bool, waitFor, tick time.Duration, msg string)
```

**Expected.**

- Polls `cond` every `tick` until it returns true or `waitFor` elapses.
- On success: returns silently.
- On timeout: `t.Fatalf` with the message.

**Grading.**

- [ ] Both branches covered by unit tests.
- [ ] Uses `t.Helper`.
- [ ] Tick interval respected (no busy loop).

---

## Task 12 — `t.Cleanup` ordering bug (Medium)

**Target.** Demonstrate the LIFO cleanup ordering bug and fix it.

**Buggy code.**

```go
ctx, cancel := context.WithCancel(context.Background())
var wg sync.WaitGroup

t.Cleanup(wg.Wait)
t.Cleanup(cancel)

wg.Add(1)
go func() { defer wg.Done(); runUntilCancel(ctx) }()
```

Will this code deadlock? Why?

**Expected analysis.** Order at teardown (LIFO): `cancel` runs first (registered later → popped first), then `wg.Wait`. *This is the correct order*. The code does *not* deadlock.

Now write the buggy variant:

```go
t.Cleanup(cancel)
t.Cleanup(wg.Wait)    // registered later → runs first
```

This deadlocks: `wg.Wait` waits for the goroutine, which waits for `cancel`, which hasn't run.

**Grading.**

- [ ] Correctly identify which version deadlocks.
- [ ] Fix using a single Cleanup with both calls.

---

## Task 13 — Build a `Harness` (Hard)

**Target.** Build a test harness for a service-like API.

**Skeleton.**

```go
type Harness struct {
    t      *testing.T
    server *Server
    ctx    context.Context
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func NewHarness(t *testing.T) *Harness {
    // start server, register cleanup, wait for ready
}

func (h *Harness) Stop() {
    // cancel, wait with timeout
}

func (h *Harness) Submit(req Request) Response {
    // forward to server
}
```

**Expected behaviour.**

- `NewHarness` starts the server, registers `t.Cleanup(h.Stop)`, blocks until `server.Ready()` returns true (with 2-second timeout).
- `Stop` cancels the context and waits for the goroutine, with 2-second timeout.
- Tests using the harness are one-liner-easy.

**Grading.**

- [ ] No `time.Sleep` outside the inner polling loop.
- [ ] `goleak` reports no leak after harness teardown.
- [ ] Three example tests using the harness compile and pass under `-race`.

---

## Task 14 — Test re-using a WaitGroup across waves (Hard)

**Target.** Write a test that re-uses one WaitGroup across three waves of work, verifying the result after each wave.

**Pseudocode.**

```go
var wg sync.WaitGroup
for wave := 0; wave < 3; wave++ {
    wg.Add(N)
    spawn(wave, N, &wg)
    WaitTimeout(t, &wg, 2*time.Second)
    if !verify(wave) { t.Errorf(...) }
}
```

**Grading.**

- [ ] Each wave's `Done` count exactly matches `Add(N)`.
- [ ] No race between waves.
- [ ] Test passes under `-race -count=100`.

---

## Task 15 — `errgroup` for first-error fan-out (Hard)

**Target.** Replace a hand-rolled WaitGroup fan-out with `errgroup.Group`. Verify the first error short-circuits.

**Starter.**

```go
results := make([]int, len(items))
errs := make([]error, len(items))
var wg sync.WaitGroup
wg.Add(len(items))
for i, x := range items {
    i, x := i, x
    go func() {
        defer wg.Done()
        v, err := work(x)
        results[i] = v
        errs[i] = err
    }()
}
wg.Wait()
for _, e := range errs {
    if e != nil { t.Fatal(e) }
}
```

**Expected.**

```go
g, ctx := errgroup.WithContext(context.Background())
results := make([]int, len(items))
for i, x := range items {
    i, x := i, x
    g.Go(func() error {
        v, err := work(ctx, x)
        if err != nil { return err }
        results[i] = v
        return nil
    })
}
if err := g.Wait(); err != nil {
    t.Fatal(err)
}
```

**Grading.**

- [ ] `errgroup.Group` used.
- [ ] Workers receive `ctx` and cancel on first error.
- [ ] Result slice fully populated when no error.

---

## Task 16 — Stress-test a custom lock (Hard)

**Target.** You have a custom `MyLock`. Write a stress test that uses 100 goroutines × 1000 iterations × 100 trials with the start-barrier pattern. Run under `-race`.

**Pseudocode.**

```go
for trial := 0; trial < 100; trial++ {
    counter = 0
    start, fire := StartBarrier()
    var wg sync.WaitGroup
    wg.Add(100)
    for i := 0; i < 100; i++ {
        go func() {
            defer wg.Done()
            <-start
            for j := 0; j < 1000; j++ {
                lock.Lock()
                counter++
                lock.Unlock()
            }
        }()
    }
    fire()
    WaitTimeout(t, &wg, 30*time.Second)
    if counter != 100000 {
        t.Fatalf("trial %d: counter = %d", trial, counter)
    }
}
```

**Grading.**

- [ ] Test catches any mutual-exclusion violation.
- [ ] Test catches any data race.
- [ ] Test runs in under 30 seconds with `-race`.

---

## Task 17 — Quiescent assertion (Hard, requires Go 1.24+)

**Target.** Use `testing/synctest` and `synctest.Wait` to assert that a system reaches a quiescent state.

**Pseudocode.**

```go
import "testing/synctest"

func TestQuiescence(t *testing.T) {
    synctest.Run(func() {
        s := New()
        for _, x := range inputs { s.Submit(x) }
        synctest.Wait()
        if !s.Done() {
            t.Error("system not done after quiescence")
        }
    })
}
```

**Grading.**

- [ ] Test compiles only with Go 1.24+.
- [ ] `synctest.Wait` is used instead of polling.
- [ ] Test runs in milliseconds (virtual time).

---

## Task 18 — Package-wide `goleak` (Hard)

**Target.** Add `TestMain` with `goleak.VerifyTestMain` to a package. Allowlist known runtime functions if needed.

**Steps.**

1. Add the function.
2. Run the test suite. Look at any leak reports.
3. For each leak: either fix it or add an `IgnoreTopFunction` and justify in a comment.

**Grading.**

- [ ] `TestMain` present.
- [ ] All real leaks fixed.
- [ ] Each ignore has a one-line comment explaining why.

---

## Task 19 — Fix the LIFO ordering for `goleak` (Hard)

**Target.** A test uses `defer goleak.VerifyNone(t)` and reports a spurious leak because the cleanup logic hasn't run yet. Refactor.

**Starter.**

```go
func TestServer(t *testing.T) {
    defer goleak.VerifyNone(t)            // BUG: runs before Cleanup
    ctx, cancel := context.WithCancel(context.Background())
    var wg sync.WaitGroup
    wg.Add(1)
    go func() { defer wg.Done(); s.Run(ctx) }()
    t.Cleanup(func() { cancel(); wg.Wait() })
}
```

**Expected.**

```go
func TestServer(t *testing.T) {
    t.Cleanup(func() { goleak.VerifyNone(t) })   // runs last
    ctx, cancel := context.WithCancel(context.Background())
    var wg sync.WaitGroup
    wg.Add(1)
    go func() { defer wg.Done(); s.Run(ctx) }()
    t.Cleanup(func() { cancel(); wg.Wait() })    // runs first
}
```

**Grading.**

- [ ] `goleak.VerifyNone` runs after cancel and wait.
- [ ] No spurious leak reports.
- [ ] Test passes deterministically.

---

## Task 20 — Capstone (Hard)

**Target.** Take an existing concurrent test in a real repository (your own or an open-source one). Audit it for:

1. Missing barriers (`time.Sleep`, etc.).
2. `Add` / `Wait` race.
3. Missing `goleak` verification.
4. `t.Fatal` from spawned goroutines.
5. `t.Cleanup` ordering bugs.

Write a PR (or a private patch) that fixes the issues. Run `go test -race -count=100` to confirm.

**Grading.**

- [ ] At least three issues identified.
- [ ] Each fix is minimal and explained.
- [ ] Test stability verified over `count=100`.

---

## Summary

Twenty tasks, graded from "fix a missing `Add`" to "audit a real codebase." Work through them in order. Run each finished task under `-race -count=10` minimum, and you'll find that concurrent-testing instincts that took years to develop in production codebases internalise in a few weeks of deliberate practice.
