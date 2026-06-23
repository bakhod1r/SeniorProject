# WaitGroup in Tests — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "I started a goroutine in my test. My assertion ran before it finished. What now?"

A `*testing.T` does not magically know about your goroutines. The `Test...` function is just a normal Go function — when it returns, `go test` moves on to the next one. If the test body spawned a goroutine and did not wait for it, three bad things can happen, in increasing order of pain:

1. The goroutine finishes after the assertion. The assertion fails when it should have passed.
2. The goroutine finishes after the test function returns. The assertion passed, but a stray goroutine writes to a buffer that the test framework has already reused. The next test fails for an unrelated reason.
3. The goroutine panics after the test function returns. The whole `go test` process dies with `--- FAIL` against a random test, and the stack trace points nowhere useful.

The cure is to **wait** inside the test. The classical tool is `sync.WaitGroup`. The pattern looks like this:

```go
func TestParallelWork(t *testing.T) {
    var wg sync.WaitGroup
    results := make([]int, 4)

    wg.Add(4)
    for i := 0; i < 4; i++ {
        i := i
        go func() {
            defer wg.Done()
            results[i] = compute(i)
        }()
    }
    wg.Wait()

    for i, r := range results {
        if r != expected(i) {
            t.Errorf("results[%d] = %d, want %d", i, r, expected(i))
        }
    }
}
```

Three lines do the real work: `wg.Add(4)` registers the four pending goroutines, `defer wg.Done()` decrements once per goroutine, and `wg.Wait()` blocks the test until every goroutine has finished. Only then do the assertions run. The test is now deterministic — at least about *finishing*. (Determinism about *order* of finishing is a different problem; we get to it in the senior file.)

After reading this file you will:

- Know why a test that spawns goroutines almost always needs a barrier
- Be able to write the canonical `wg.Add / wg.Done / wg.Wait` block from memory
- Understand `t.Cleanup` and when to put `wg.Wait()` inside it
- Recognise — and refuse to write — the `time.Sleep(100 * time.Millisecond)` antipattern
- Know what the race detector reports when `Add` and `Wait` race
- Have a first encounter with `goleak.VerifyNone(t)` and what it protects against

You do not need to know about `testing/synctest`, fake clocks, or virtual time yet. Those are middle-level tools. You do not need to write your own helper library. We use the standard library only.

---

## Prerequisites

- **Required:** Go 1.21+ (any modern version will do; nothing here is version-gated).
- **Required:** Comfort with `go test`, `t.Errorf`, `t.Fatal`. If you have written one normal table-driven test, you are ready.
- **Required:** A basic feel for `sync.WaitGroup` — see [03-sync-package/02-waitgroups/junior](../../03-sync-package/02-waitgroups/junior/). You should know that `Add` increments a counter, `Done` decrements it, and `Wait` blocks until it hits zero.
- **Required:** Familiarity with `go func() { ... }()` and `defer`. The pattern `defer wg.Done()` is the first line inside almost every test goroutine.
- **Helpful:** Awareness of the race detector — `go test -race`. We will run every example with it.
- **Helpful:** Some intuition about flaky tests (tests that pass locally and fail in CI).

If `go test -race ./...` works on your laptop and you have ever debugged a test that fails 1 in 50 runs, you have the right context.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Synchronisation barrier** | A point in the test code that blocks until a defined event has happened. `wg.Wait()` is a barrier. So is `<-done`. |
| **`sync.WaitGroup`** | A counter with `Add`, `Done`, and `Wait`. The most common test barrier. |
| **`Add(n)`** | Increment the WaitGroup counter by `n`. Must be called before the corresponding `Wait`. |
| **`Done()`** | Decrement the WaitGroup counter by 1. Equivalent to `Add(-1)`. Almost always written as `defer wg.Done()`. |
| **`Wait()`** | Block until the WaitGroup counter reaches zero. |
| **`t.Cleanup(f)`** | A function registered on the testing framework to run after the test ends (including on `t.Fatal`). Cleanups run in LIFO order. |
| **`t.Fatal` / `t.FailNow`** | Mark the test as failed and stop the *current goroutine*. Critically: it stops only the goroutine that called it. Calling `t.Fatal` from a spawned goroutine does **not** stop the test. |
| **Goroutine leak** | A goroutine still alive after the test has ended. Survives into the next test, the next package, or the end of the `go test` process. |
| **`goleak`** | A library (`go.uber.org/goleak`) that fails the test if any goroutine other than the test runner is still alive at teardown. |
| **Flaky test** | A test that sometimes passes and sometimes fails on identical input, due to timing or scheduling. |
| **Start barrier** | A pattern where many goroutines wait on a common signal before starting work, used to maximise contention for race detection. |
| **Fan-out** | One goroutine spawns N workers and waits for all of them. |
| **`time.Sleep` antipattern** | Using `time.Sleep` to "wait for" a goroutine to finish. Always wrong. |

---

## Core Concepts

### A test goroutine is not "owned" by the test

When you write `go work()` inside a test function, the spawned goroutine is just another goroutine. It is not registered with `*testing.T`. The test function can return, and that goroutine keeps running. The `go test` binary does not exit until all `Test...` functions have finished, but it does not wait for stray goroutines launched inside them.

```go
func TestLeaky(t *testing.T) {
    go func() {
        time.Sleep(2 * time.Second)
        t.Log("hello from the future")     // dangerous
    }()
    // function returns immediately
}
```

This test "passes" because the body has no assertion. But two seconds later, a goroutine calls `t.Log` on a `*testing.T` whose test has long ended. Modern Go (1.16+) catches this exact case and reports `panic: Log in goroutine after TestLeaky has completed`. The cure is to wait inside the test.

### `wg.Wait` is a memory-ordering boundary, not just a counter

`wg.Wait` does more than count. It establishes a **happens-before** relationship between every `wg.Done()` and the code following `wg.Wait()`. Anything a spawned goroutine wrote to memory before its `wg.Done()` is visible to the test after `wg.Wait()` returns — without further locking. This is exactly the property a test assertion needs.

In other words: after `wg.Wait()`, you may read the slice that goroutines wrote to, with no race, no atomic, no mutex.

### `Add(n)` must happen before `Wait`

If `Wait` reads the counter and sees zero, it returns immediately. If `Add` had not been called yet, the counter *was* zero — even though you intended to spawn N goroutines. The result: `Wait` returns, the assertion runs, the goroutines run later, the test passes for the wrong reason. Always call `Add(N)` in the test goroutine **before** launching any worker.

```go
// CORRECT
wg.Add(len(items))
for _, it := range items {
    go func(it Item) {
        defer wg.Done()
        process(it)
    }(it)
}
wg.Wait()
```

```go
// WRONG — Add races with Wait
for _, it := range items {
    go func(it Item) {
        wg.Add(1)            // (A)
        defer wg.Done()
        process(it)
    }(it)
}
wg.Wait()                    // (B) may run before (A)
```

In the wrong version, `Wait` may run before any goroutine has called `Add`. The counter is zero, `Wait` returns, the test asserts on uninitialised state.

### A spawned goroutine cannot call `t.Fatal`

The testing package's `t.Fatal`, `t.FailNow`, and `t.SkipNow` use `runtime.Goexit` to stop *the current goroutine*. If you call `t.Fatal` from a spawned goroutine, you stop the spawned goroutine — the test continues running, possibly to a successful end. The Go documentation says:

> A test ends when its Test function returns or calls any of the methods FailNow, Fatal, Fatalf, SkipNow, Skip, or Skipf. Those methods, as well as the Parallel method, must be called only from the goroutine running the Test function.

So inside a goroutine you must use `t.Errorf`, which only sets a failure flag, and then **let the goroutine return** and `wg.Wait` finish before the test function decides whether to fail. The full pattern:

```go
func TestParallel(t *testing.T) {
    var wg sync.WaitGroup
    wg.Add(4)
    for i := 0; i < 4; i++ {
        i := i
        go func() {
            defer wg.Done()
            if got := compute(i); got != expected(i) {
                t.Errorf("compute(%d) = %d, want %d", i, got, expected(i))
            }
        }()
    }
    wg.Wait()
}
```

`t.Errorf` is safe from any goroutine. `t.Fatal` is not.

### `time.Sleep` is never the right barrier

The most common bad-pattern in newcomer tests:

```go
go work()
time.Sleep(100 * time.Millisecond)   // "wait for goroutine"
assert(state)
```

The sleep is "long enough" today on this laptop. Tomorrow it is too short under CI load. The day after, a flaky failure ships to production. Every sleep is either too short (sometimes) or too long (always). Use a barrier instead.

If you cannot avoid waiting on a real-world condition (e.g., a network round-trip in an integration test), use a *polling deadline with a hard cap*:

```go
deadline := time.Now().Add(2 * time.Second)
for time.Now().Before(deadline) {
    if conditionTrue() {
        return
    }
    time.Sleep(5 * time.Millisecond)
}
t.Fatal("condition never true within 2s")
```

This is still inferior to a barrier, but it has a definite failure mode — bounded latency and a clear error message — instead of a silent flake.

### `t.Cleanup` is the test's `defer`

Anything you write as `defer cleanup()` inside the test body could equally well be `t.Cleanup(cleanup)`. The difference: `t.Cleanup` runs *even if `t.Fatal` is called*, in LIFO order, and runs after subtests have finished. For tests that spawn long-running goroutines, the cleanup is the natural place to call `cancel()` and `wg.Wait()`:

```go
ctx, cancel := context.WithCancel(context.Background())
t.Cleanup(cancel)

var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    runUntilCancelled(ctx)
}()
t.Cleanup(wg.Wait)
```

The first cleanup cancels the context (signalling the goroutine to stop). The second cleanup waits for it. Because cleanups run LIFO, `wg.Wait` runs *after* `cancel` — exactly what we want.

---

## Real-World Analogies

### Waiting for everyone at the trailhead

You and three friends are hiking. The trailhead has a sign: "Group photo here." You agree: everyone parks the car, drops off gear, then meets at the sign. The sign is `wg.Wait`. Each friend dropping their gear is `wg.Done`. Setting "four friends" up front is `wg.Add(4)`. If you take the photo before the slowest friend arrives, the photo is wrong. If you forgot to count Sarah in `Add`, you might take the photo while she is still in the car.

### The dinner party host

A host (the test) invites guests (goroutines). The host serves dessert (the assertion) after every guest has finished their main course (`wg.Done`). If the host serves dessert too early, half the guests are still eating. If the host did not count Sarah when setting the table (`Add`), Sarah never gets dessert and nobody notices.

### The arrivals board at an airport

The board waits until every flight (goroutine) has landed (`Done`). Only then does it display "all clear" (`Wait` returns). The board does not display "all clear" based on a timer — that would be `time.Sleep` and would be wrong every busy day.

### A construction crew with a foreman

The foreman (test goroutine) calls `Add(10)`, dispatches 10 workers, and stands in the office (`Wait`) reading the paper. When the last worker hangs up their hard hat (`Done`), the foreman closes up shop (assertion runs). The foreman does not walk around guessing whether everyone is done — that would be `time.Sleep`.

---

## Mental Models

### Mental model 1: `WaitGroup` is a countdown latch

Think of `wg.Add(n)` as setting a kitchen timer to `n` rings. Each `Done` is one ring. `Wait` blocks until all rings have happened. The timer cannot un-ring, so once `Wait` returns, the test moves on permanently.

### Mental model 2: `Wait` is a memory barrier

The Go memory model promises that anything written by a goroutine before its `Done` is visible to the goroutine doing `Wait`, after `Wait` returns. So the slice your goroutines wrote to is now safe to read. This is the secret that makes test assertions clean — no atomics, no mutexes, just `Wait` and then read.

### Mental model 3: Goroutines are draft children

The test is the parent. The spawned goroutines are the children. The parent must wait for every child before going home. `Add` is registering the children. `Done` is each child saying "I'm done." `Wait` is the parent standing at the door.

If the parent leaves without waiting, the children are orphaned — they run on with no supervision and may set fire to the kitchen (the next test) by writing to memory that has been reused.

### Mental model 4: Tests are batch jobs, not streams

A test is a one-shot batch: set up, run, assert, tear down. Streaming patterns (publish-subscribe, hot loops) do not fit a test directly. To test a streaming system, you typically run a finite slice of the stream and synchronise on its end with a WaitGroup or a `done` channel.

---

## Pros & Cons

### WaitGroup as a test barrier

**Pros:**

- Standard library, no dependencies.
- Zero allocation in the steady-state pattern.
- Establishes happens-before, so no manual locking around shared test state.
- Mirrors production code one-to-one — your test code looks like the code under test.

**Cons:**

- No timeout. If a goroutine hangs, the test hangs forever. (Solved with `WaitTimeout`, see middle.md.)
- No error propagation. If a goroutine wants to fail the test, it must use `t.Errorf` from inside the goroutine, which then triggers a failure flag — not as direct as `errgroup.Group.Wait()` returning an error.
- The `Add` / `Wait` ordering rule is subtle. Easy to get wrong in dynamic-fan-out tests.

### Channels as test barriers

**Pros:**

- Naturally combine with `select` and `time.After` for a timeout.
- Carry data — the goroutine can report its result through the channel itself.
- Visible in goroutine dumps if you hang: `chan receive` vs `sync.WaitGroup.Wait`.

**Cons:**

- More verbose for plain fan-out.
- Easy to leak: forgetting to close, or sending to a buffered channel nobody drains.
- The pattern grows quickly when fan-in counts are dynamic.

### `time.Sleep` as a test barrier

**Pros:**

- Trivial to write.

**Cons:**

- Wrong. Will flake. Will be slow. Use anything else.

---

## Use Cases

### Fan-out test: process a slice in parallel

You have a function that runs N tasks in parallel. The test feeds it a fixed input and checks every result.

```go
func TestFanOut(t *testing.T) {
    items := []int{1, 2, 3, 4, 5}
    results := make([]int, len(items))

    var wg sync.WaitGroup
    wg.Add(len(items))
    for i, it := range items {
        i, it := i, it
        go func() {
            defer wg.Done()
            results[i] = it * it
        }()
    }
    wg.Wait()

    for i, r := range results {
        if want := items[i] * items[i]; r != want {
            t.Errorf("results[%d] = %d, want %d", i, r, want)
        }
    }
}
```

### Background worker test: start, do something, stop

You have a server-like worker. The test starts it, sends one event, asserts on the side effect, and shuts it down cleanly.

```go
func TestWorker(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    t.Cleanup(cancel)

    w := NewWorker()
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        w.Run(ctx)
    }()
    t.Cleanup(wg.Wait)

    w.Submit(Event{ID: 1})

    // wait for the event to be processed
    select {
    case <-w.Done(1):
    case <-time.After(2 * time.Second):
        t.Fatal("event 1 not processed within 2s")
    }
}
```

### Stress test: hammer a structure from many goroutines

The whole point is to maximise concurrent access. Use a start barrier so all goroutines begin at the same instant, increasing contention for the race detector.

```go
func TestConcurrentSet(t *testing.T) {
    s := NewSet()
    start := make(chan struct{})
    var wg sync.WaitGroup
    const n = 100
    wg.Add(n)
    for i := 0; i < n; i++ {
        i := i
        go func() {
            defer wg.Done()
            <-start                       // wait for the gun
            s.Add(i)
        }()
    }
    close(start)                          // fire the gun
    wg.Wait()

    if got := s.Len(); got != n {
        t.Errorf("Len = %d, want %d", got, n)
    }
}
```

(We expand on the start-barrier pattern in [senior.md](senior.md).)

### Leak-detection test: catch stray goroutines

You suspect a function leaks a goroutine on the error path. Add `goleak`:

```go
import "go.uber.org/goleak"

func TestParserNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)

    _, err := Parse(brokenInput)
    if err == nil {
        t.Fatal("expected error")
    }
}
```

If `Parse` leaks, the deferred verifier fails the test with the stack trace of the leaked goroutine.

---

## Code Examples

### Example 1: the canonical fan-out

```go
package wgtest

import (
    "sync"
    "testing"
)

func square(x int) int { return x * x }

func TestSquareAll(t *testing.T) {
    in := []int{1, 2, 3, 4}
    out := make([]int, len(in))

    var wg sync.WaitGroup
    wg.Add(len(in))
    for i, x := range in {
        i, x := i, x
        go func() {
            defer wg.Done()
            out[i] = square(x)
        }()
    }
    wg.Wait()

    want := []int{1, 4, 9, 16}
    for i := range want {
        if out[i] != want[i] {
            t.Errorf("out[%d] = %d, want %d", i, out[i], want[i])
        }
    }
}
```

Run with `go test -race`. The race detector verifies that the writes `out[i] = ...` do not race with the reads in the assertion — they don't, because `wg.Wait()` synchronises them.

### Example 2: assertion inside the goroutine

When the goroutine itself can decide whether the result is correct, you can let it call `t.Errorf` directly. **Do not** call `t.Fatal`.

```go
func TestEachWorker(t *testing.T) {
    var wg sync.WaitGroup
    wg.Add(4)
    for i := 0; i < 4; i++ {
        i := i
        go func() {
            defer wg.Done()
            got := square(i)
            if got != i*i {
                t.Errorf("square(%d) = %d, want %d", i, got, i*i)
            }
        }()
    }
    wg.Wait()
}
```

The `t.Errorf` calls accumulate. If any goroutine fails, the test fails at the end. The test never hangs because every goroutine eventually returns.

### Example 3: `t.Cleanup` for graceful teardown

```go
func TestServer(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    t.Cleanup(cancel)                     // (1) signal stop

    s := NewServer()
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        s.Serve(ctx)
    }()
    t.Cleanup(wg.Wait)                    // (2) wait for stop

    // body of the test...
}
```

`t.Cleanup` callbacks run LIFO. We registered `cancel` first and `wg.Wait` second, so the order at teardown is: `wg.Wait`, `cancel`. That is wrong. Fix by swapping:

```go
    t.Cleanup(wg.Wait)                    // registered first → runs last
    t.Cleanup(cancel)                     // registered second → runs first
```

Or, more readable, do it both at once:

```go
    t.Cleanup(func() {
        cancel()
        wg.Wait()
    })
```

I prefer the second form. It puts the order in plain sight.

### Example 4: WaitGroup race when `Add` is inside the goroutine

This compiles, runs, and is wrong:

```go
func TestRacyAdd(t *testing.T) {
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        go func() {
            wg.Add(1)                     // (A)
            defer wg.Done()
            work()
        }()
    }
    wg.Wait()                             // (B)
}
```

Under `go test -race`, this reports a data race between (A) and (B). The fix: move `Add` to the outer goroutine.

```go
func TestRacyAddFixed(t *testing.T) {
    var wg sync.WaitGroup
    wg.Add(4)                             // before any goroutine starts
    for i := 0; i < 4; i++ {
        go func() {
            defer wg.Done()
            work()
        }()
    }
    wg.Wait()
}
```

### Example 5: counting on `len(items)`

A common safety habit:

```go
wg.Add(len(items))
for _, it := range items {
    it := it
    go func() {
        defer wg.Done()
        process(it)
    }(...)
}
```

`Add(len(items))` is faster than calling `Add(1)` inside the loop (one atomic instead of `len(items)`), but the main reason to write it this way is clarity: the count is right next to the loop that produces the work. If you change the loop, you change the `Add`.

### Example 6: the antipattern (do not ship)

```go
func TestBad(t *testing.T) {
    state := 0
    go func() {
        time.Sleep(10 * time.Millisecond)
        state = 42
    }()
    time.Sleep(50 * time.Millisecond)     // "wait for it"
    if state != 42 {
        t.Errorf("state = %d, want 42", state)
    }
}
```

Three bugs at once:

- `time.Sleep` is the wait.
- `state` is read from one goroutine and written from another with no synchronisation — a data race.
- The test will pass on a fast machine and flake on a slow one.

The fix: a barrier and either a mutex or pass-the-result-via-channel.

```go
func TestGood(t *testing.T) {
    done := make(chan int, 1)
    go func() {
        done <- 42
    }()
    select {
    case state := <-done:
        if state != 42 {
            t.Errorf("state = %d, want 42", state)
        }
    case <-time.After(time.Second):
        t.Fatal("timeout waiting for state")
    }
}
```

---

## Coding Patterns

### Pattern A: classic fan-out

Use when you have a fixed-size slice of work and want all results before asserting.

```go
var wg sync.WaitGroup
wg.Add(N)
for i := 0; i < N; i++ {
    i := i
    go func() {
        defer wg.Done()
        results[i] = compute(i)
    }()
}
wg.Wait()
```

### Pattern B: result channel with timeout

Use when one goroutine produces one result and you want a timeout in the test.

```go
done := make(chan T, 1)
go func() {
    done <- compute()
}()
select {
case v := <-done:
    assertEqual(t, v, want)
case <-time.After(2 * time.Second):
    t.Fatal("timeout")
}
```

### Pattern C: `t.Cleanup` for cancel + wait

Use when a goroutine runs for the whole test duration.

```go
ctx, cancel := context.WithCancel(context.Background())
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    runUntilCancelled(ctx)
}()
t.Cleanup(func() {
    cancel()
    wg.Wait()
})
```

### Pattern D: start barrier

Use to maximise concurrency for race testing.

```go
start := make(chan struct{})
var wg sync.WaitGroup
wg.Add(N)
for i := 0; i < N; i++ {
    i := i
    go func() {
        defer wg.Done()
        <-start
        contended(i)
    }()
}
close(start)
wg.Wait()
```

### Pattern E: `goleak` defer

Use whenever you suspect a function may leak a goroutine.

```go
defer goleak.VerifyNone(t)
```

Or at package level:

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

---

## Clean Code

A clean concurrent test reads almost like a sequential one. The barrier sits at the seam, not scattered through the body.

**Smelly:**

```go
func TestThing(t *testing.T) {
    wg := sync.WaitGroup{}
    for _, it := range items {
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            r := process(it)
            mu.Lock()
            results = append(results, r)
            mu.Unlock()
            t.Logf("processed %v", it)
        }(it)
    }
    time.Sleep(50 * time.Millisecond)
    wg.Wait()
    if len(results) != len(items) {
        t.Errorf(...)
    }
}
```

Problems: `Add` inside the loop, sleep before `Wait`, locking that does nothing because `Wait` already synchronises, `t.Logf` from a goroutine is fine but mixed in distracts the reader.

**Clean:**

```go
func TestThing(t *testing.T) {
    results := make([]Result, len(items))
    var wg sync.WaitGroup
    wg.Add(len(items))
    for i, it := range items {
        i, it := i, it
        go func() {
            defer wg.Done()
            results[i] = process(it)
        }()
    }
    wg.Wait()

    for i, r := range results {
        if !valid(items[i], r) {
            t.Errorf("results[%d] for %v is invalid: %v", i, items[i], r)
        }
    }
}
```

Pre-allocated slice — no lock. Pre-counted `Add`. One barrier. Assertions afterwards.

### Test helpers belong in helper files

If a `WaitTimeout` or `goleak`-style helper appears in three different `_test.go` files, lift it into `testhelpers_test.go` or its own internal package. Tests should describe *what is tested*, not the plumbing.

### Mark helpers with `t.Helper()`

Inside any function that takes a `*testing.T` and asserts on its behalf, call `t.Helper()` as the first line. Test failures will then point to the calling test, not the helper.

```go
func WaitTimeout(t *testing.T, wg *sync.WaitGroup, d time.Duration) {
    t.Helper()
    done := make(chan struct{})
    go func() {
        wg.Wait()
        close(done)
    }()
    select {
    case <-done:
    case <-time.After(d):
        t.Fatalf("WaitGroup did not finish within %v", d)
    }
}
```

---

## Product Use / Feature

### Why we test concurrent code at all

Production concurrent code earns its testing only when:

- Multiple goroutines touch the same state.
- Ordering matters (an event must happen before another).
- Lifecycle matters (something starts, runs, and must stop cleanly).

For these systems a test must do three things: drive concurrency, observe its end, and assert. A WaitGroup barrier is the cheapest "observe its end."

### CI flake budgets

A common policy: a test that fails more than once in 1000 runs is broken. To check, run:

```
go test -race -run TestSomething -count=1000
```

If you see two or more failures, the test is flaky. Most flakes turn out to be a missing barrier (sleep instead of `wg.Wait`) or a leaked goroutine that mutates state in the next test. The fixes are in this file.

### Server boot tests

For services, the first concurrent test is usually "boot up, accept one request, shut down." It looks like this:

```go
func TestServerBoot(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        Serve(ctx)
    }()
    t.Cleanup(func() {
        cancel()
        wg.Wait()
    })

    waitForListen(t, ":8080")
    resp, err := http.Get("http://localhost:8080/health")
    // ... assertions
}
```

The `waitForListen` helper is itself a barrier — typically a poll with a 2-second timeout. Without it, the `http.Get` races the listener.

---

## Error Handling

### When a goroutine returns an error

A common ask: the spawned goroutine produces an error and the test should fail with that error. Three choices:

**Choice 1: `t.Errorf` inside the goroutine.**

```go
go func() {
    defer wg.Done()
    if err := work(); err != nil {
        t.Errorf("work: %v", err)
    }
}()
```

Simplest, works for most tests. Cannot use `t.Fatal` here.

**Choice 2: error channel.**

```go
errs := make(chan error, N)
for i := 0; i < N; i++ {
    go func() {
        errs <- work()
    }()
}
for i := 0; i < N; i++ {
    if err := <-errs; err != nil {
        t.Errorf("worker %d: %v", i, err)
    }
}
```

Convenient for collecting and reporting.

**Choice 3: `errgroup.Group`.**

```go
import "golang.org/x/sync/errgroup"

var g errgroup.Group
for i := 0; i < N; i++ {
    i := i
    g.Go(func() error { return work(i) })
}
if err := g.Wait(); err != nil {
    t.Fatal(err)
}
```

The cleanest for "all workers must succeed." Combines `WaitGroup` with first-error semantics.

### Goroutine panics in a test

If a spawned goroutine panics, the whole `go test` process dies. The test framework cannot trap a panic in another goroutine. Recover inside the goroutine if the panic is expected behaviour you are testing:

```go
go func() {
    defer wg.Done()
    defer func() {
        if r := recover(); r != nil {
            t.Errorf("worker panicked: %v", r)
        }
    }()
    work()
}()
```

If the panic is *not* expected, **do not** recover. Let it crash the test — the stack trace is exactly what you need.

### Timeouts on `Wait`

`wg.Wait` has no built-in timeout. A goroutine that hangs hangs the test forever. In CI, the test framework will eventually kill the process (Go's `go test -timeout 10m` defaults to 10 minutes), but ten minutes is too long for a fast feedback loop. The `WaitTimeout` helper (see middle.md) wraps `wg.Wait` in a `select` with `time.After` and fails the test cleanly.

---

## Security Considerations

### Secrets in goroutines that outlive the test

If a test goroutine holds a secret in a string and the test goroutine leaks past the test, the secret remains in memory for the rest of the `go test` binary's life. Cleanup with `t.Cleanup` and a `cancel()` ensures the goroutine returns, freeing references.

### Test-only listeners on real network ports

A test that binds to `:8080` and forgets to close the listener leaks not only a goroutine but a port. The next test fails with "address already in use." `t.Cleanup(listener.Close)` and `wg.Wait` solve it.

### Race detector in CI

Run `go test -race` in CI for every package. It is the closest thing to a security audit for concurrent code. The race detector is heavy at runtime (5–10x slowdown) but inexpensive in CI.

---

## Performance Tips

### Pre-allocate before fan-out

```go
results := make([]int, len(items))
```

is better than

```go
var results []int
mu := sync.Mutex{}
// later, in each goroutine: mu.Lock(); results = append(results, r); mu.Unlock()
```

The pre-allocated form avoids the mutex entirely — each goroutine writes to its own index. The `wg.Wait` synchronises everything.

### Avoid `Add(1)` in tight loops

`Add` is one atomic instruction; one `Add(len(items))` is faster than `len(items)` separate `Add(1)`s. For tests this rarely matters, but the readability argument alone is enough — keep the count next to the loop.

### Re-use a `WaitGroup` only on a clear barrier

Once `Wait` has returned, the `WaitGroup` is reusable, but only if there is a happens-before edge from the previous `Wait` to the next `Add`. In tests, that edge is the test body itself — sequential code. So this is fine:

```go
wg.Add(N)
spawn(N)
wg.Wait()
// happens-before edge: continued execution in the test goroutine
wg.Add(M)
spawn(M)
wg.Wait()
```

What is *not* fine: `Add` from one goroutine while another is still inside `Wait` for the same group. Don't do that in tests; it has no use case.

### Parallel subtests

`t.Parallel` lets independent subtests run concurrently. A WaitGroup inside each subtest works fine. The subtests' goroutines do not race because each `t.Parallel` subtest has its own `*testing.T`. Just make sure each subtest waits for its own goroutines before its body returns.

```go
func TestParallelGroup(t *testing.T) {
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            var wg sync.WaitGroup
            wg.Add(len(tc.items))
            for _, it := range tc.items {
                it := it
                go func() {
                    defer wg.Done()
                    _ = process(it)
                }()
            }
            wg.Wait()
        })
    }
}
```

---

## Best Practices

1. Call `Add(N)` in the same goroutine that will call `Wait`, before spawning workers.
2. Use `defer wg.Done()` as the first line inside the goroutine.
3. Capture the loop variable by argument or by a `i := i` rebinding before Go 1.22; from 1.22 onwards, a per-iteration variable is the default, but the rebinding still documents intent.
4. Never use `time.Sleep` as a barrier. Replace with `wg.Wait`, a `done` channel, or a polling deadline with a hard cap.
5. Use `t.Errorf`, not `t.Fatal`, from inside a spawned goroutine.
6. Register `t.Cleanup` for cancel-and-wait when a goroutine outlives the assertion logic.
7. Run `go test -race -count=10` locally before pushing.
8. Add `goleak.VerifyTestMain(m)` (or per-test `goleak.VerifyNone`) when working on code that creates background goroutines.
9. Add a `WaitTimeout` helper to your test package. A test that hangs is worse than a test that fails.
10. Keep barriers visible. One `wg.Wait` at the end of the test body is easier to audit than a dozen `done` channels.

---

## Edge Cases & Pitfalls

### Add(0) is legal, Add(negative) is allowed only as Done

`wg.Add(0)` is a no-op. `wg.Add(-1)` is `wg.Done()`. Going below zero panics: `sync: negative WaitGroup counter`. Tests sometimes hit this by calling `wg.Done()` twice on the same goroutine.

### Wait does not reset

After `Wait` returns, the counter is zero. You can `Add` again and `Wait` again. There is no `Reset`. Re-using is fine if you don't interleave the two phases.

### Empty WaitGroup waits zero

`wg.Wait()` on a WaitGroup that has never had `Add` returns immediately. Useful for "wait if I spawned anything" patterns:

```go
var wg sync.WaitGroup
if shouldSpawn {
    wg.Add(1)
    go func() { defer wg.Done(); work() }()
}
wg.Wait()      // no-op if no goroutine was spawned
```

### A buffered channel as a poor man's WaitGroup

```go
done := make(chan struct{}, N)
for i := 0; i < N; i++ {
    go func() {
        defer func() { done <- struct{}{} }()
        work()
    }()
}
for i := 0; i < N; i++ {
    <-done
}
```

Works, but uses N times more memory and obscures intent. Use a WaitGroup unless you also need to carry data through the channel.

### Don't pass WaitGroup by value

```go
func spawn(wg sync.WaitGroup) {   // BAD: passes a copy
    wg.Add(1)
    go func() {
        defer wg.Done()
        ...
    }()
}
```

`sync.WaitGroup` contains a counter. Copying it makes two unrelated counters. Always pass `*sync.WaitGroup`.

### A `defer wg.Wait()` at function top

```go
func TestStuff(t *testing.T) {
    var wg sync.WaitGroup
    defer wg.Wait()      // runs at the end of the test function
    wg.Add(1)
    go func() { defer wg.Done(); work() }()
    // assertions here
}
```

The assertions run *before* `wg.Wait`. The goroutine may not have finished. This pattern is the wrong way to use defer for tests — almost always you want `wg.Wait` *between* spawn and assertion. Use `t.Cleanup` only when the goroutine is supposed to run for the whole test.

---

## Common Mistakes

### Mistake 1: forgetting `Add`

```go
go func() {
    defer wg.Done()
    work()
}()
wg.Wait()
```

No `Add`. `Wait` returns immediately. `Done` later panics with "negative WaitGroup counter". A failed test if you're lucky; an undetected race if you aren't.

### Mistake 2: `Wait` before `Add`

```go
go func() {
    wg.Add(1)
    defer wg.Done()
    work()
}()
wg.Wait()
```

`Wait` may run before the goroutine has called `Add`. Counter is zero, `Wait` returns, assertion runs on uninitialised data. The race detector reports this exact pattern under `go test -race`.

### Mistake 3: double `Done`

```go
defer wg.Done()
if err != nil {
    wg.Done()    // BAD: paired with the defer
    return
}
```

The defer plus the early `Done` means two decrements for one increment. The counter goes negative — panic.

Fix: choose one. If using `defer`, never call `Done` again.

### Mistake 4: passing `wg` by value

See "Don't pass WaitGroup by value" above.

### Mistake 5: `t.Fatal` from a goroutine

```go
go func() {
    defer wg.Done()
    if !ok {
        t.Fatal("...")   // BAD: only stops this goroutine
    }
}()
```

`t.Fatal` does `runtime.Goexit` for the current goroutine. The goroutine returns. `defer wg.Done()` runs. The test continues. The failure flag is set, so the test does fail at the end, but it does not stop other goroutines from running. If multiple goroutines call `t.Fatal`, you may get scrambled output. Use `t.Errorf`.

### Mistake 6: time.Sleep instead of Wait

Already covered. Worth repeating: every `time.Sleep` in a test is a bug or a hack.

### Mistake 7: forgetting to cancel a context before Wait

```go
ctx, cancel := context.WithCancel(context.Background())
defer wg.Wait()
defer cancel()    // BAD ORDER: defer is LIFO, Wait runs first, then cancel
```

`defer` runs LIFO. So `Wait` runs first — but the goroutine is still running, waiting for context cancel. Deadlock. Fix: register Wait *first* (so it runs last), or wrap both in a single Cleanup.

```go
t.Cleanup(func() { cancel(); wg.Wait() })
```

---

## Common Misconceptions

### "Once I call `go`, the goroutine has started."

The `go` keyword *schedules* the goroutine. It does not promise that the goroutine has executed even one line by the time `go` returns. On a fast machine the new goroutine may run almost immediately; on a busy machine it may not start for milliseconds. Tests cannot rely on it having started — use a barrier.

### "If I close the channel, all goroutines stop."

Closing a channel stops *receivers* on that channel (they see the zero value and `ok=false`). Goroutines that are not receiving on the channel keep running. Closing a channel is not a kill switch.

### "A WaitGroup is a mutex."

A WaitGroup is a counter. It does not protect data. The protection comes from the *happens-before* edge between `Done` and `Wait`. If two goroutines both write to the same memory before their `Done`, they still race with each other.

### "I need a mutex to share state with the test goroutine."

You only need a mutex if goroutines are running *concurrently*. After `wg.Wait()`, they are not. The test goroutine can read any state the workers wrote, without locking.

### "I'll just add `time.Sleep(10ms)` — that's plenty."

It is plenty until it isn't. Under CPU load, under the race detector (5x slowdown), in CI on a shared runner, 10ms can become 200ms. Tests that pass 99 in 100 runs are not stable. Use a barrier.

### "`Wait` returns immediately if no goroutines started."

True — but only because the counter is zero. If you intended to spawn goroutines and forgot to call `Add`, `Wait` lies to you.

---

## Tricky Points

### Why `Add(positive)` must happen before `Wait`

Inside `WaitGroup.Add`, the implementation does an atomic increment. Inside `Wait`, it does an atomic load. If the load sees a stale zero, `Wait` returns. The Go memory model does *not* allow `Wait` to wait for an `Add` that has not happened yet — it has no clairvoyance. Therefore *you* must ensure the order.

The rule: do not start the first `Add(positive)` from inside a goroutine launched without a prior `Add`. In practice this means `Add(N)` in the caller, *before* `go f()`.

### Why `t.Cleanup` LIFO matters

If your test registers two cleanups:

```go
t.Cleanup(wg.Wait)
t.Cleanup(cancel)
```

`cancel` runs first (registered second, popped first), then `wg.Wait`. That is what you want — signal stop, then wait for stop. Reverse the registration and the cleanup deadlocks.

### Why `goleak` runs after `t.Cleanup`

`goleak.VerifyNone(t)` registered as a defer at the start of the test runs after all `t.Cleanup` callbacks — defers in the test function execute before the test framework returns, which is after cleanups. So:

```go
func TestX(t *testing.T) {
    defer goleak.VerifyNone(t)   // (1)
    t.Cleanup(cancel)            // (2)
    t.Cleanup(wg.Wait)           // (3)
    ...
}
```

Order at the end: body returns → defer (1) is scheduled but not run yet, cleanups (3) then (2) run, *then* defer (1) runs. Wait — actually, in Go, deferred calls run *after* cleanups for the test, because `t.Cleanup` callbacks are invoked by the testing package before the test goroutine returns. Let me restate: the defer at line (1) is in the test goroutine; deferred functions run when the test function returns. The cleanups run when the test function returns too, before the test framework records the result. The exact ordering, per the testing documentation, is: deferred functions of the test run first, then cleanups in LIFO order. So `goleak.VerifyNone(t)` actually runs *before* `t.Cleanup(wg.Wait)`.

This is a real gotcha. If you want `goleak` to run last, use it as a cleanup:

```go
t.Cleanup(func() { goleak.VerifyNone(t) })   // registered first → runs last
t.Cleanup(cancel)
t.Cleanup(wg.Wait)
```

Or use `goleak.VerifyTestMain(m)` at the package level, which verifies after the whole test binary's tests are done.

### `t.Parallel` and shared WaitGroup

Two subtests with `t.Parallel` share nothing but the parent test's variables. A shared `var wg sync.WaitGroup` in the parent that both subtests call `Add`/`Wait` on creates a mess. Each subtest should own its own WaitGroup.

---

## Test

A short quiz. Answers in the next section.

1. What is wrong with this test?
   ```go
   func TestX(t *testing.T) {
       go func() { state = 1 }()
       if state != 1 {
           t.Error("state not 1")
       }
   }
   ```

2. Why is this WaitGroup pattern racy?
   ```go
   for i := 0; i < N; i++ {
       go func() {
           wg.Add(1)
           defer wg.Done()
           work()
       }()
   }
   wg.Wait()
   ```

3. What happens if a goroutine in a test calls `t.Fatal`?

4. Why does `time.Sleep` not solve the synchronisation problem?

5. What is the correct order of these `t.Cleanup` registrations to ensure `cancel` runs before `wg.Wait`?
   - `t.Cleanup(cancel)`
   - `t.Cleanup(wg.Wait)`

6. What does `goleak.VerifyNone(t)` check?

7. Is the following safe? Why?
   ```go
   var wg sync.WaitGroup
   wg.Add(1)
   go func() { defer wg.Done(); slice[0] = 42 }()
   wg.Wait()
   fmt.Println(slice[0])
   ```

---

## Tricky Questions

1. **Why does `wg.Wait()` establish a happens-before edge?** Because the implementation contains an atomic store/load pair that the Go memory model treats as a synchronisation event. Every `Done` synchronises-before any `Wait` that returns after the counter reached zero.

2. **Can `WaitGroup` deadlock?** Yes. If `Add(N)` is called but only `M < N` goroutines call `Done`, `Wait` blocks forever.

3. **Why doesn't the test framework just wait for all goroutines for me?** Because Go has no notion of "test-owned goroutines." A goroutine is anonymous. The runtime cannot know which were spawned for which test. You are the only one who knows; you must wait.

4. **If I use `t.Cleanup(cancel)`, do I still need `wg.Wait`?** Yes, unless you are certain the goroutine returns synchronously when the context is cancelled. For most production-like code, `cancel()` only *signals* the goroutine; the goroutine still needs time to finish whatever it was doing, and `wg.Wait` is how you observe that finish.

5. **Why does `go test -race` slow my test down?** The race detector instruments every memory access, adding 5–10x runtime overhead. Tests that pass without `-race` may flake under `-race` because the slowdown changes timing. That is the point: `-race` exposes timing-sensitive bugs.

6. **What is the difference between `WaitGroup` and `errgroup.Group`?** `errgroup.Group` wraps a `WaitGroup` and adds: (a) `g.Go(func() error)` for spawning, (b) first-error collection, (c) optional context cancellation on first error. For tests that need the first error, `errgroup` is cleaner.

7. **Can I copy a `WaitGroup`?** No — its internal counter is one piece of state shared by all participants. Copying creates two independent counters.

8. **What happens if I call `Wait` from multiple goroutines simultaneously?** All of them block until the counter hits zero, then all return. Useful for fan-in barriers.

---

## Cheat Sheet

```go
// Classic fan-out
var wg sync.WaitGroup
wg.Add(N)
for i := 0; i < N; i++ {
    i := i
    go func() {
        defer wg.Done()
        results[i] = compute(i)
    }()
}
wg.Wait()

// Cleanup pattern for long-running goroutines
ctx, cancel := context.WithCancel(context.Background())
var wg sync.WaitGroup
wg.Add(1)
go func() { defer wg.Done(); run(ctx) }()
t.Cleanup(func() { cancel(); wg.Wait() })

// WaitTimeout helper
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

// goleak — at start of test
defer goleak.VerifyNone(t)

// goleak — at package level
func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }
```

**Rules:**

- `Add(N)` in the test goroutine, before `go`.
- `defer wg.Done()` first line in the goroutine.
- No `time.Sleep` as a barrier.
- No `t.Fatal` from a spawned goroutine.
- `t.Cleanup(cancel)` registered *after* (so it runs *before*) `t.Cleanup(wg.Wait)`.

---

## Self-Assessment Checklist

- [ ] I can write the `Add / go / Done / Wait` block from memory without looking it up.
- [ ] I know why `Add` must be called before the corresponding `Wait`.
- [ ] I never use `time.Sleep` as a barrier in a test.
- [ ] I use `t.Errorf` (not `t.Fatal`) inside spawned goroutines.
- [ ] I register `t.Cleanup(cancel)` after `t.Cleanup(wg.Wait)` for long-running goroutines.
- [ ] I run `go test -race` before pushing.
- [ ] I know what `goleak.VerifyNone(t)` reports.
- [ ] I can rewrite a sleep-based test as a barrier-based one.

---

## Summary

Goroutines do not finish for free, and the test framework does not wait for them. The first concurrent-test skill is putting a **barrier** between spawn and assertion. `sync.WaitGroup` is the standard barrier: `Add(N)` in the test goroutine, `defer wg.Done()` first line in each worker, `wg.Wait()` before the assertion. This produces a deterministic finish and a clean memory-ordering edge — assertions can read worker state directly. For tests that own a long-running goroutine, `t.Cleanup(func() { cancel(); wg.Wait() })` is the canonical teardown. For tests that worry about leaks, `defer goleak.VerifyNone(t)` is the canonical guard. Above all, never reach for `time.Sleep` — every sleep is either too short, too slow, or both.

---

## What You Can Build

- A `WaitTimeout(t, wg, 2*time.Second)` helper that fails the test if Wait blocks. (Middle level expands on this.)
- A `goleak`-integrated `TestMain` that fails the whole package if any test leaks a goroutine.
- A flaky-test scanner: a CI step that runs `go test -race -count=50` and flags any test that fails more than once.
- A "fan-out test harness" that spawns N workers against a target function and validates the results in a single deterministic block.
- A `withCancelAndWait(t, run)` helper that hides the cancel/wg/cleanup dance behind a single call.

---

## Further Reading

- [The Go Blog — Go Memory Model](https://go.dev/ref/mem) — the `sync.WaitGroup` happens-before rule.
- [pkg.go.dev — sync.WaitGroup](https://pkg.go.dev/sync#WaitGroup) — the official API doc.
- [pkg.go.dev — testing](https://pkg.go.dev/testing) — `t.Cleanup`, `t.Parallel`, `t.Helper`.
- [go.uber.org/goleak](https://pkg.go.dev/go.uber.org/goleak) — leak detection.
- [pkg.go.dev — golang.org/x/sync/errgroup](https://pkg.go.dev/golang.org/x/sync/errgroup) — first-error-aware WaitGroup.
- [The Go testing book — "Concurrent tests" chapter](https://www.gopl.io/) — historical reference; the patterns still apply.

---

## Related Topics

- [02-deterministic-testing](../02-deterministic-testing/) — `synctest` and broader determinism.
- [01-race-detector-deep](../01-race-detector-deep/) — using `-race` to validate barriers.
- [04-mocking-time](../04-mocking-time/) — replacing real timers, the bigger sibling of "no `time.Sleep`."
- [../../03-sync-package/02-waitgroups/](../../03-sync-package/02-waitgroups/) — the primitive in production code.
- [../../05-context-package/](../../05-context-package/) — `context.WithTimeout` as an alternative deadline source.

---

## Diagrams & Visual Aids

### The barrier pattern (text diagram)

```
Test goroutine            Worker goroutines
--------------            -----------------
wg.Add(3)
go worker(0) ----------> [worker 0 running]
go worker(1) ----------> [worker 1 running]
go worker(2) ----------> [worker 2 running]
                            |
wg.Wait()  <---- Done() <---+ (worker 0)
   |       <---- Done() <---+ (worker 1)
   |       <---- Done() <---+ (worker 2)
   v
(counter == 0, Wait returns)
   |
assert(results)
```

### What `time.Sleep` looks like in the failure case

```
Test goroutine                   Worker goroutine
--------------                   ----------------
go work()    ---> [scheduled, not yet running]
time.Sleep(10ms)                  ...waiting for CPU...
                                  ...CPU busy with other tests...
                                  ...sleep ends...
assert(state == 42)               ...still scheduled, has not run...
FAIL: state == 0
                                  [finally runs] state = 42
```

### `t.Cleanup` LIFO order

```
Register: t.Cleanup(A)    Test body runs
Register: t.Cleanup(B)    Test body returns
Register: t.Cleanup(C)
                          Cleanups run:
                            C    (registered last)
                            B
                            A    (registered first)
```

### Memory ordering at `wg.Wait`

```
Worker:    ... slice[i] = v        wg.Done()
                   (write)             (release fence)
                                        |
                                  happens-before
                                        |
                                        v
Test:                             wg.Wait()           ... read slice[i]
                                  (acquire fence)         (sees v)
```

Anything the worker wrote before `Done` is visible to the test after `Wait`.
