---
layout: default
title: WaitGroup in Tests — Find the Bug
parent: WaitGroup in Tests
grand_parent: Testing Concurrent Code
nav_order: 8
permalink: /roadmap/programming-languages/golang/07-concurrency/13-testing-concurrent-code/03-waitgroup-in-tests/find-bug/
---

# WaitGroup in Tests — Find the Bug

[← Back to WaitGroup in Tests](./)

A library of buggy concurrent tests. For each one: read the code, predict the failure mode, then read the diagnosis. The goal is to recognise the bug *before* the race detector tells you. Once you can spot these patterns at a glance, your concurrent-test reviews speed up tenfold.

---

## Bug 1 — Missing `Add`

```go
func TestMissingAdd(t *testing.T) {
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        i := i
        go func() {
            defer wg.Done()
            results[i] = i * i
        }()
    }
    wg.Wait()
    // assertions
}
```

**What is wrong?**

No `wg.Add` anywhere. The counter starts at zero. `wg.Wait` returns immediately. The deferred `wg.Done` calls then panic with `panic: sync: negative WaitGroup counter`.

**Fix.**

```go
wg.Add(4)
```

before the loop. Or `wg.Add(1)` inside each iteration (slightly slower but readable).

---

## Bug 2 — `Wait` before `Add`

```go
func TestRacyAdd(t *testing.T) {
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        go func() {
            wg.Add(1)
            defer wg.Done()
            doWork()
        }()
    }
    wg.Wait()
}
```

**What is wrong?**

`Add(1)` may run *after* `wg.Wait()` reads the counter as zero. `Wait` returns early; the assertion runs on uninitialised data. The Go race detector reports a data race between `Add` and `Wait`.

**Fix.**

```go
wg.Add(4)                  // before the loop
for i := 0; i < 4; i++ {
    go func() {
        defer wg.Done()
        doWork()
    }()
}
wg.Wait()
```

---

## Bug 3 — `time.Sleep` as a barrier

```go
func TestStartsWorking(t *testing.T) {
    s := NewService()
    s.Start()
    time.Sleep(100 * time.Millisecond)
    if !s.Ready() {
        t.Error("not ready")
    }
}
```

**What is wrong?**

The 100 ms is "enough" today. On CI under load with `-race`, it isn't. The test flakes.

**Fix.**

```go
deadline := time.Now().Add(2 * time.Second)
for time.Now().Before(deadline) {
    if s.Ready() {
        return
    }
    time.Sleep(5 * time.Millisecond)
}
t.Fatal("not ready within 2s")
```

Or, if the service exposes a `Ready()` channel, `<-s.Ready()` with a `select` timeout.

---

## Bug 4 — `t.Fatal` from a goroutine

```go
func TestFatalFromGoroutine(t *testing.T) {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := work(); err != nil {
            t.Fatal(err)              // BUG
        }
    }()
    wg.Wait()
}
```

**What is wrong?**

`t.Fatal` calls `runtime.Goexit` for the current goroutine. The worker goroutine terminates, `defer wg.Done()` runs, `wg.Wait` returns. The test continues — but the failure flag may not be visible if the test goroutine has already moved on. Worse, if `t.Fatal` runs while another goroutine is doing more setup, the cleanup may double-run.

**Fix.**

```go
if err := work(); err != nil {
    t.Errorf("work: %v", err)         // Errorf is goroutine-safe
}
```

`t.Errorf` sets a failure flag without terminating the goroutine. The test goroutine returns normally, observes the flag, and reports failure at the end.

---

## Bug 5 — Passing WaitGroup by value

```go
func spawn(wg sync.WaitGroup, work func()) {
    wg.Add(1)
    go func() {
        defer wg.Done()
        work()
    }()
}

func TestSpawn(t *testing.T) {
    var wg sync.WaitGroup
    spawn(wg, doA)
    spawn(wg, doB)
    wg.Wait()                          // returns immediately
}
```

**What is wrong?**

`spawn` receives a *copy* of the WaitGroup. The `Add(1)` operates on the copy; the test's `wg` is unchanged. `Wait` sees zero and returns. The goroutines run unsupervised.

`go vet` catches this with: `spawn passes lock by value: sync.WaitGroup contains sync.noCopy`.

**Fix.**

```go
func spawn(wg *sync.WaitGroup, work func()) {
    wg.Add(1)
    go func() {
        defer wg.Done()
        work()
    }()
}
spawn(&wg, doA)
```

---

## Bug 6 — Double `Done`

```go
go func() {
    defer wg.Done()
    if err := work(); err != nil {
        wg.Done()                      // BUG: extra Done
        return
    }
    moreWork()
}()
```

**What is wrong?**

On the error path, two `Done`s for one `Add`. Counter goes negative → panic.

**Fix.** Remove the explicit `Done`:

```go
go func() {
    defer wg.Done()
    if err := work(); err != nil {
        return                         // defer Done is enough
    }
    moreWork()
}()
```

---

## Bug 7 — `defer wg.Wait()` at top of test

```go
func TestDeferWait(t *testing.T) {
    var wg sync.WaitGroup
    defer wg.Wait()                    // BUG
    wg.Add(2)
    go func() { defer wg.Done(); ... }()
    go func() { defer wg.Done(); ... }()
    if state != want { t.Errorf(...) }
}
```

**What is wrong?**

The defer runs *after* the assertion, not before. The assertion runs while the goroutines are still working. The test reads racy, inconsistent state.

**Fix.** Inline the `wg.Wait()`:

```go
go func() { defer wg.Done(); ... }()
go func() { defer wg.Done(); ... }()
wg.Wait()
if state != want { t.Errorf(...) }
```

---

## Bug 8 — `goleak` deferred before cleanup runs

```go
func TestServer(t *testing.T) {
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithCancel(context.Background())
    var wg sync.WaitGroup
    wg.Add(1)
    go func() { defer wg.Done(); s.Run(ctx) }()
    t.Cleanup(func() { cancel(); wg.Wait() })
}
```

**What is wrong?**

`defer goleak.VerifyNone(t)` runs *before* `t.Cleanup` callbacks. So `goleak` looks at the goroutines while the server is still running. The test fails with a spurious "leak."

**Fix.** Register `goleak` as a Cleanup, placed *first* so it pops last:

```go
t.Cleanup(func() { goleak.VerifyNone(t) })
t.Cleanup(func() { cancel(); wg.Wait() })
```

---

## Bug 9 — Cleanup ordering deadlock

```go
ctx, cancel := context.WithCancel(context.Background())
var wg sync.WaitGroup
wg.Add(1)
go func() { defer wg.Done(); runUntilCancel(ctx) }()

t.Cleanup(cancel)
t.Cleanup(wg.Wait)                     // BUG: registered later → runs first
```

**What is wrong?**

LIFO: `wg.Wait` runs first. The goroutine waits for `cancel`. `cancel` has not run. Deadlock until the test framework's 10-minute timeout kills the binary.

**Fix.** Order the registrations so `cancel` pops first:

```go
t.Cleanup(wg.Wait)                     // registered first → runs last
t.Cleanup(cancel)                      // registered later → runs first
```

Or, simpler:

```go
t.Cleanup(func() { cancel(); wg.Wait() })
```

---

## Bug 10 — Concurrent `Add` from a child without happens-before

```go
var wg sync.WaitGroup
go func() {
    wg.Add(1)
    go func() {
        defer wg.Done()
        leaf()
    }()
}()
wg.Wait()
```

**What is wrong?**

The outer `go func` may not have called `Add(1)` yet by the time `wg.Wait` runs. `Wait` returns. Race.

Even worse, the child `Add` and the test's `Wait` may both see zero, but Add then increments and Done decrements — the test passes incorrectly on the first run and fails on the next.

**Fix.** Coordinate the spawn:

```go
var wg sync.WaitGroup
wg.Add(1)                              // for the inner work
go func() {
    defer wg.Done()
    leaf()
}()
wg.Wait()
```

If you really need a parent-spawns-child pattern, use a separate setup phase with its own WaitGroup.

---

## Bug 11 — Reading shared state without barrier

```go
func TestAccumulator(t *testing.T) {
    var sum int
    var wg sync.WaitGroup
    wg.Add(100)
    for i := 1; i <= 100; i++ {
        i := i
        go func() {
            defer wg.Done()
            sum += i                   // BUG: unsynchronised
        }()
    }
    wg.Wait()
    if sum != 5050 { t.Errorf(...) }
}
```

**What is wrong?**

100 goroutines all read-modify-write `sum`. Race. `wg.Wait` synchronises the *finish*, but the racing accesses *before* `Done` are still races.

**Fix.** Either use `atomic.Int64`, or have each goroutine write to a private slot:

```go
parts := make([]int, 100)
for i := 1; i <= 100; i++ {
    i := i
    go func() {
        defer wg.Done()
        parts[i-1] = i
    }()
}
wg.Wait()
sum := 0
for _, p := range parts { sum += p }
```

---

## Bug 12 — Goroutine leaks on test failure

```go
func TestEarlyFail(t *testing.T) {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        time.Sleep(10 * time.Second)
        useResource()
    }()
    if precondition() == false {
        t.Fatal("precondition")
    }
    wg.Wait()
}
```

**What is wrong?**

If `t.Fatal` triggers, the test exits but the 10-second sleep goroutine continues. It will eventually call `useResource()` on a state that has been torn down.

**Fix.** Make the goroutine context-aware and tear it down in a Cleanup:

```go
ctx, cancel := context.WithCancel(context.Background())
t.Cleanup(cancel)
t.Cleanup(wg.Wait)

wg.Add(1)
go func() {
    defer wg.Done()
    select {
    case <-time.After(10 * time.Second):
        useResource()
    case <-ctx.Done():
        return
    }
}()
```

(Or skip the test if the precondition fails *before* spawning anything.)

---

## Bug 13 — Closing a channel multiple times

```go
done := make(chan struct{})
var wg sync.WaitGroup
wg.Add(N)
for i := 0; i < N; i++ {
    go func() {
        defer wg.Done()
        if someCondition() {
            close(done)                // BUG: multiple goroutines may close
        }
    }()
}
wg.Wait()
<-done
```

**What is wrong?**

Multiple goroutines may call `close(done)`. The second close panics: `close of closed channel`.

**Fix.** Use `sync.Once`:

```go
var once sync.Once
...
if someCondition() {
    once.Do(func() { close(done) })
}
```

Or have a single goroutine designated to close.

---

## Bug 14 — Channel deadlock from forgotten `close`

```go
func TestPipeline(t *testing.T) {
    in := make(chan int)
    out := make(chan int)
    go func() { for v := range in { out <- v * 2 } }()

    for i := 0; i < 5; i++ { in <- i }
    // forgot close(in)
    var sum int
    for v := range out { sum += v }     // hangs forever
}
```

**What is wrong?**

The pipeline goroutine ranges over `in`. With no `close(in)`, it blocks forever waiting for more input. The test's `for range out` blocks forever waiting for a value the pipeline will never send.

**Fix.** Close `in` after sending all values:

```go
for i := 0; i < 5; i++ { in <- i }
close(in)
```

And the pipeline goroutine should close `out` after `range` ends:

```go
go func() { defer close(out); for v := range in { out <- v * 2 } }()
```

---

## Bug 15 — `WaitTimeout` without `t.Helper`

```go
func WaitTimeout(t *testing.T, wg *sync.WaitGroup, d time.Duration) {
    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
    case <-time.After(d):
        t.Fatalf("timeout")
    }
}
```

**What is wrong?**

No `t.Helper()`. When the test fails, the error attribution points at the line inside `WaitTimeout`, not at the calling test. Debugging is harder.

**Fix.** Add as first line:

```go
t.Helper()
```

---

## Bug 16 — Subtests sharing a WaitGroup

```go
func TestSubtests(t *testing.T) {
    var wg sync.WaitGroup
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            wg.Add(1)
            go func() {
                defer wg.Done()
                work(tc)
            }()
        })
    }
    wg.Wait()                          // BUG
}
```

**What is wrong?**

Subtests with `t.Parallel` schedule their bodies *after* `TestSubtests` returns. The outer `wg.Wait` runs immediately (no subtest has called `Add` yet) and returns. Then the subtests run, each calling `Add` and `Done` on a WaitGroup nobody waits on.

**Fix.** Each subtest manages its own WaitGroup:

```go
t.Run(tc.name, func(t *testing.T) {
    t.Parallel()
    var subWG sync.WaitGroup
    subWG.Add(1)
    go func() { defer subWG.Done(); work(tc) }()
    subWG.Wait()
})
```

---

## Bug 17 — `errgroup.Wait` ignored

```go
g := new(errgroup.Group)
for i := 0; i < N; i++ {
    g.Go(func() error { return work(i) })
}
// forgot g.Wait()
```

**What is wrong?**

Without `g.Wait()`, the test returns before the goroutines have done anything meaningful, and errors are silently dropped.

**Fix.**

```go
if err := g.Wait(); err != nil {
    t.Fatal(err)
}
```

---

## Bug 18 — Buffered channel mistaken for synchronisation

```go
done := make(chan int, 1)
go func() { done <- compute() }()
v := <-done                            // OK
go func() { done <- compute() }()      // BUG: may block forever or interleave
v2 := <-done
```

**What is wrong?**

Two sends, one receive: works only if buffered = 1 (the second send waits for the first read). With buffer 1, this is *barely* correct but fragile. If you change the buffer or add a third operation, the pattern breaks.

**Fix.** Use two channels, or a WaitGroup, or a slice of results indexed by goroutine.

---

## Bug 19 — Capturing loop variable in pre-1.22 Go

```go
for _, x := range items {
    go func() {
        process(x)                     // BUG on Go < 1.22
    }()
}
```

**What is wrong?**

Before Go 1.22, `x` is shared across iterations. All goroutines see the final value of `x`. The race detector may catch it, but the actual symptom is "all goroutines process the same item."

**Fix.** Either upgrade to Go 1.22+, or shadow:

```go
for _, x := range items {
    x := x
    go func() {
        process(x)
    }()
}
```

Or pass as argument:

```go
go func(x Item) { process(x) }(x)
```

---

## Bug 20 — Sleep inside a polling loop with no deadline

```go
for {
    if cond() { return }
    time.Sleep(10 * time.Millisecond)
}
```

**What is wrong?**

No deadline. If `cond` never becomes true, the test hangs until the framework times out. The 10-minute default is way too long.

**Fix.**

```go
deadline := time.Now().Add(2 * time.Second)
for time.Now().Before(deadline) {
    if cond() { return }
    time.Sleep(10 * time.Millisecond)
}
t.Fatal("cond never true within 2s")
```

---

## Bug 21 — `Add(0)` after spawning

```go
for _, x := range items {
    go func() {
        wg.Add(1)
        defer wg.Done()
        process(x)
    }()
}
wg.Add(0)                              // does nothing useful
wg.Wait()
```

**What is wrong?**

`Add(0)` is a no-op. The race is unresolved. The author thought "calling Add somewhere before Wait" was the rule, but the rule is "Add must happen-before Wait, with a positive delta from zero." `Add(0)` doesn't count.

**Fix.** Move `Add(len(items))` before the loop.

---

## Bug 22 — `wg.Done()` outside `defer`

```go
go func() {
    work()
    wg.Done()                          // BUG: missed if work panics
}()
```

**What is wrong?**

If `work()` panics, `wg.Done()` never runs. The counter never reaches zero. `wg.Wait` hangs forever.

**Fix.**

```go
go func() {
    defer wg.Done()
    work()
}()
```

---

## Bug 23 — Mocking a service with a leaked goroutine

```go
func newFakeService() *fakeService {
    s := &fakeService{out: make(chan event)}
    go func() {
        for ev := range s.in {
            s.out <- transform(ev)
        }
    }()
    return s
}
```

**What is wrong?**

The fake service spawns a goroutine. Nothing in its API closes `s.in` or stops the goroutine. Every test that uses `newFakeService` leaks a goroutine.

**Fix.** Add `Stop` method that closes `s.in` and let the consumer call it (or wire it into `t.Cleanup`).

---

## Bug 24 — `runtime.Gosched` as a barrier

```go
go work()
runtime.Gosched()                      // hopefully work runs?
assert(state)
```

**What is wrong?**

`runtime.Gosched` is a hint to the scheduler. The runtime may run another goroutine or may not. The test relies on the scheduler's mood.

**Fix.** Use a real barrier (channel close, WaitGroup, polling deadline).

---

## Bug 25 — Counting test goroutines with `runtime.NumGoroutine`

```go
before := runtime.NumGoroutine()
go work()
runtime.Gosched()
after := runtime.NumGoroutine()
if after-before != 1 { t.Error(...) }
```

**What is wrong?**

`NumGoroutine` counts background goroutines (GC, timers, etc.) that come and go. The delta is not stable. The test flakes.

**Fix.** Use `goleak` for leak detection. Don't count goroutines in tests.

---

## Summary

Twenty-five bugs, twenty-five tells. Across all of them, the pattern is the same:

- A barrier is missing (or is `time.Sleep`).
- An `Add` is in the wrong goroutine.
- A `Done` is paired with the wrong `Add`.
- Cleanup ordering deadlocks or misses goroutines.
- Shared state is read without synchronisation.

A code review that catches these in five seconds saves a CI debugging session in five hours.
