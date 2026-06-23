---
layout: default
title: WaitGroup in Tests — Professional
parent: WaitGroup in Tests
grand_parent: Testing Concurrent Code
nav_order: 4
permalink: /roadmap/programming-languages/golang/07-concurrency/13-testing-concurrent-code/03-waitgroup-in-tests/professional/
---

# WaitGroup in Tests — Professional

[← Back to WaitGroup in Tests](./)

This is the level at which you stop reaching for tools and start building them. You read `sync.WaitGroup`'s implementation. You know why `goleak` whitelists certain functions. You design test harnesses that other engineers will use for years. You decide which helpers go in `testutil`, which become a separate `qa` library, and which must be reinvented per package because the abstractions leak.

---

## 1. Inside `sync.WaitGroup`

`WaitGroup` is 100 lines of carefully tuned code in `src/sync/waitgroup.go`. The interesting parts:

```go
type WaitGroup struct {
    noCopy noCopy
    state1 atomic.Uint64
    state2 atomic.Uint32
}
```

`state1` packs two 32-bit counters into one 64-bit atomic word:

- High 32 bits: the *counter* (number of pending `Done`s).
- Low 32 bits: the *waiter count* (number of goroutines currently in `Wait`).

`Add(delta)` atomically adds `delta << 32` to `state1`. If the result's high half is zero and the waiter count is non-zero, it releases all waiters.

`Wait` first does an atomic load. If the counter is zero, return. Otherwise atomically increment the waiter count and park on a runtime semaphore. The release in `Add` does a `runtime_Semrelease` for each waiter.

`Done()` is literally `Add(-1)`.

Implications for tests:

- `Add` and `Wait` racing is a real race in the Go memory model. The race detector reports it because both atomics target the same word with non-atomic-vs-atomic semantics in some implementations (older Go: the panic check on negative counters). The modern detector also flags the logical race.
- A `WaitGroup` cannot detect "you forgot `Add`." It only knows the current counter. If the counter is zero and you call `Wait`, you get an immediate return — silent and dangerous.
- `Wait` reading a zero counter has the same happens-before semantics as a successful unlock — but only with respect to the `Done`s that preceded. If there were no `Done`s, there is nothing to establish a happens-before with.

### `noCopy` and `go vet`

`noCopy` is a zero-size type whose `Lock`/`Unlock` methods cause `go vet` to flag copies. Try:

```go
func bad(wg sync.WaitGroup) {}    // passes by value
```

`go vet ./...` reports `bad passes lock by value: sync.WaitGroup contains sync.noCopy`. Always pass `*sync.WaitGroup`.

---

## 2. Inside `goleak`

`goleak.Find` walks every goroutine's stack via `runtime.Stack`, parses the function names, and filters against a list of "expected" goroutines. The default ignore list includes:

- `testing.RunTests` (the test framework)
- `runtime.gopark` callers from the GC
- `runtime/trace.Start`'s background reader
- `time.Sleep` (from the runtime timer goroutine, when present)

Anything else is reported as a leak.

The implementation:

```go
func Find(options ...Option) error {
    cur := goroutineID()
    opts := buildOpts(options...)
    deadline := time.Now().Add(opts.maxRetryAttempts)
    for {
        gs := findLeaks(cur, opts)
        if len(gs) == 0 {
            return nil
        }
        if time.Now().After(deadline) {
            return goroutineToError(gs)
        }
        time.Sleep(opts.retryInterval)
    }
}
```

It retries because shutdown is asynchronous — a goroutine may take milliseconds to wake on context cancel. The default is 5 attempts × 20 ms = 100 ms.

For tests that run a server, the 100 ms grace is usually enough. For tests with slow shutdown (TCP listener draining), increase via `goleak.WithRetryAttempts(...)`.

---

## 3. Designing a test harness

A "harness" is the shared infrastructure that wraps the system under test. Typical components:

```go
type Harness struct {
    t      *testing.T
    ctx    context.Context
    cancel context.CancelFunc
    wg     sync.WaitGroup
    server *Server
}

func NewHarness(t *testing.T) *Harness {
    t.Helper()
    ctx, cancel := context.WithCancel(context.Background())
    h := &Harness{
        t:      t,
        ctx:    ctx,
        cancel: cancel,
        server: NewServer(),
    }
    h.start()
    t.Cleanup(h.Stop)
    return h
}

func (h *Harness) start() {
    h.wg.Add(1)
    go func() {
        defer h.wg.Done()
        h.server.Run(h.ctx)
    }()
    h.waitUntilReady()
}

func (h *Harness) waitUntilReady() {
    h.t.Helper()
    deadline := time.Now().Add(2 * time.Second)
    for time.Now().Before(deadline) {
        if h.server.Ready() {
            return
        }
        time.Sleep(5 * time.Millisecond)
    }
    h.t.Fatal("server never became ready")
}

func (h *Harness) Stop() {
    h.t.Helper()
    h.cancel()
    done := make(chan struct{})
    go func() { h.wg.Wait(); close(done) }()
    select {
    case <-done:
    case <-time.After(2 * time.Second):
        h.t.Fatal("harness did not stop within 2s")
    }
}
```

Tests now look like:

```go
func TestHandlerX(t *testing.T) {
    h := NewHarness(t)
    resp := h.server.Call("/x")
    if resp.Status != 200 { t.Errorf(...) }
}
```

The barrier discipline is fully hidden. Engineers write straight-line test code. The harness ensures clean teardown.

### Trade-offs of harnesses

- **Pro:** Tests are fast to write and read.
- **Pro:** Teardown is consistent — every test stops the server, no leaks.
- **Con:** Hides the synchronisation, so when a test does flake, it is less obvious where the missing barrier is.
- **Con:** Tightly couples the test to the harness. Refactoring the server's lifecycle ripples through every test.

For small projects, write tests directly. For services with 50+ tests and one canonical lifecycle, build the harness.

---

## 4. `testify/assert`'s wait helpers

The `testify` library does not export a `WaitGroup` helper, but `assert.Eventually` and `assert.Never` cover most needs.

```go
assert.Eventually(t, cond func() bool, waitFor time.Duration, tick time.Duration, msgAndArgs ...interface{}) bool
```

Implementation sketch:

```go
func Eventually(t TestingT, cond func() bool, waitFor, tick time.Duration, msgAndArgs ...interface{}) bool {
    h, ok := t.(tHelper)
    if ok { h.Helper() }
    ch := make(chan bool, 1)
    timer := time.NewTimer(waitFor)
    defer timer.Stop()
    ticker := time.NewTicker(tick)
    defer ticker.Stop()
    for tickC := ticker.C; ; {
        select {
        case <-timer.C:
            return Fail(t, "Condition never satisfied", msgAndArgs...)
        case <-tickC:
            tickC = nil
            go func() { ch <- cond() }()
        case v := <-ch:
            if v { return true }
            tickC = ticker.C
        }
    }
}
```

Notes:

- `cond` runs in its own goroutine, so a slow `cond` doesn't block the tick loop.
- The pattern of nil-ing `tickC` while waiting for `ch` prevents two overlapping `cond` calls.
- The function returns `bool` so you can chain: `if !assert.Eventually(...) { return }`.

For most tests, `assert.Eventually` is the right tool. For tests that wait specifically on a `WaitGroup`, use your own `WaitTimeout` — it produces a better failure message ("WaitGroup did not finish within 2s" beats "Condition never satisfied").

### `assert.Never`

`assert.Never(t, cond, waitFor, tick)` fails if `cond` ever returns true within `waitFor`. Used for negative assertions: "this goroutine should *not* trigger event X within 1 second."

---

## 5. `quicktest` and other libraries

`github.com/frankban/quicktest` provides a `qt.C` test context with checker-based assertions:

```go
c := qt.New(t)
c.Assert(value, qt.Equals, expected)
```

It does not directly include a `WaitTimeout` but combines with channels naturally.

`github.com/maxatome/go-testdeep` is similar — declarative assertion library, no concurrent-test extensions.

For most Go projects, `testify` plus a small `testutil` package is sufficient. Heavier frameworks add cognitive load without proportional benefit.

---

## 6. Concurrent benchmarks

Benchmarks of concurrent code use `b.RunParallel`:

```go
func BenchmarkConcurrentInc(b *testing.B) {
    c := NewCounter()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Inc()
        }
    })
}
```

`RunParallel` creates `GOMAXPROCS` goroutines, each looping on `pb.Next()`. It internally handles all the WaitGroup-style synchronisation. Reset-and-run boilerplate disappears.

For a custom number of goroutines, use `b.SetParallelism(n)` which multiplies `GOMAXPROCS` by `n`.

Note: benchmarks run for `b.N` iterations chosen automatically. Race-test patterns (start barrier, etc.) don't fit benchmarks — benchmarks measure throughput, not race coverage.

---

## 7. The `Sync` test pattern for production primitives

When you build a new sync primitive (a custom lock, a lock-free queue, a barrier of your own), the tests look like the ones we've been writing — but with much higher repetition counts and explicit ordering.

```go
func TestMyLockMutualExclusion(t *testing.T) {
    const Iterations = 1000
    const Goroutines = 8

    var lock MyLock
    var counter int

    for trial := 0; trial < 100; trial++ {
        counter = 0
        start, fire := testutil.StartBarrier()
        var wg sync.WaitGroup
        wg.Add(Goroutines)
        for i := 0; i < Goroutines; i++ {
            go func() {
                defer wg.Done()
                <-start
                for j := 0; j < Iterations; j++ {
                    lock.Lock()
                    counter++
                    lock.Unlock()
                }
            }()
        }
        fire()
        testutil.WaitTimeout(t, &wg, 30*time.Second)

        if counter != Iterations*Goroutines {
            t.Fatalf("trial %d: counter = %d, want %d",
                trial, counter, Iterations*Goroutines)
        }
    }
}
```

100 trials × 8 goroutines × 1000 iterations × race detector overhead = a ten-second test that catches almost every locking bug. The start barrier maximises contention per trial.

---

## 8. Test instrumentation and chaos

For really stubborn races, instrument the system under test with hooks:

```go
type Server struct {
    OnAccept func(conn net.Conn)
    OnRead   func(buf []byte)
    OnError  func(err error)
}
```

The test injects hooks that record events, sleep at adversarial moments, or panic on demand:

```go
s.OnAccept = func(c net.Conn) {
    // Force the accepted goroutine to wait, raising the chance of contention.
    <-start
}
```

This is *not* `time.Sleep` — it is a deliberate scheduling point you control. The hook makes a race more likely; the test fails deterministically when it does.

Libraries like `gleak`-style packages (uber-go's `gleak`, gnatsd's chaos hooks) generalise this.

---

## 9. Negative testing: "this should leak"

Occasionally you want to verify that a *bug* leaks a goroutine, before fixing it. Reverse `goleak`:

```go
func TestParserLeaksOnError(t *testing.T) {
    before := runtime.NumGoroutine()
    _, err := Parse(brokenInput)
    if err == nil {
        t.Fatal("expected error")
    }
    runtime.GC()
    time.Sleep(50 * time.Millisecond)    // let leaked goroutine settle
    after := runtime.NumGoroutine()
    if after <= before {
        t.Errorf("expected leak: before=%d after=%d", before, after)
    }
}
```

This *uses* `time.Sleep` deliberately — the test is about a leak that may take a moment to manifest. The 50 ms is bounded; the failure mode is clear. Acceptable in this niche.

---

## 10. WaitGroup in fuzzing

`go test -fuzz` runs the fuzz target millions of times. Inside the fuzz body, concurrent goroutines work the same as in tests:

```go
func FuzzConcurrent(f *testing.F) {
    f.Fuzz(func(t *testing.T, input []byte) {
        const N = 4
        var wg sync.WaitGroup
        wg.Add(N)
        for i := 0; i < N; i++ {
            i := i
            go func() {
                defer wg.Done()
                _ = parseSlice(input, i)
            }()
        }
        wg.Wait()
    })
}
```

The race detector under fuzz is one of the most powerful bug-finding combinations in Go. A fuzz seed plus a start barrier plus 24 hours of CPU time will find races no other tool can.

---

## 11. Engineering the project-wide policy

A mature Go project has written rules:

1. Every `_test.go` file in package `pkg` may import `pkg/internal/testutil`.
2. `testutil` provides `WaitTimeout`, `StartBarrier`, `RaceTest`, `Eventually`, `NoLeak`. No other wait primitives are allowed.
3. `time.Sleep` is banned in tests outside `testutil`. Enforced by a `staticcheck` analyzer or a custom linter.
4. Every package has `TestMain` calling `goleak.VerifyTestMain`.
5. CI runs `go test -race -count=3` on every PR.
6. Nightly runs `go test -race -count=100` and pages on any failure.

Encoded as a lint rule:

```go
// banned identifiers
forbidigo:
  - identifier: time.Sleep
    msg: "use testutil.Eventually or testutil.WaitTimeout instead"
    exclude:
      - "**/internal/testutil/**"
      - "**/*_real_io_test.go"
```

Now the rules enforce themselves. Future engineers write barrier-based tests by default.

---

## 12. Summary

At the professional level, WaitGroup-in-tests is no longer a pattern — it is a *policy*. You read the standard library's implementation, you know the cost of every helper, you build harnesses that hide the synchronisation for everyday tests while exposing it for the tests that exercise concurrency itself. You ship a `testutil` package and a lint rule that bans `time.Sleep`. You run `-race -count=100` nightly. Most importantly, you treat every flake as a real bug, never as an inconvenience to skip past. The goal is not "tests usually pass." The goal is "tests always pass, or they always fail, and the failure points at the bug."
