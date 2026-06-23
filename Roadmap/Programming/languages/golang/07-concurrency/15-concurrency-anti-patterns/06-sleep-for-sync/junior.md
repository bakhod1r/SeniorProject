# Sleep for Synchronization — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use--feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
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
29. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction
> Focus: "I started a goroutine, then I `time.Sleep`'d, then I asserted. Sometimes it passes, sometimes it fails. Why?"

The single most prominent rule of testing concurrent Go code is this:

> **Never use `time.Sleep` to synchronise a test. Ever.**

Write it on a sticky note. Tape it to your monitor. Tattoo it on the inside of your forearm. You will need it more than you think, because the anti-pattern *feels right* every time a beginner reaches for it.

Here is the shape of the bug:

```go
func TestWorker(t *testing.T) {
    w := NewWorker()
    go w.Run()

    time.Sleep(100 * time.Millisecond) // hope the worker has started

    w.Submit("task")

    time.Sleep(100 * time.Millisecond) // hope the worker has finished

    if got := w.Done(); got != 1 {
        t.Fatalf("got %d done, want 1", got)
    }
}
```

The test reads English and looks reasonable: "start the worker, give it a moment, send a task, give it a moment, check the result." But it is broken in four different ways at once:

1. **It is racy.** 100ms is a guess. On a fast laptop the worker finishes in 1ms and the test passes. On a slow shared-CI runner the worker has not even started after 100ms and the test fails. The same code, the same inputs, two different outcomes.
2. **It is slow.** Even when it passes, you paid 200ms per run. Multiply by 500 tests in your package and you have wasted 100 seconds of CI time on sleeps that did nothing useful.
3. **It hides bugs.** If you tune the sleep up to 1 second to make the test pass, you have not fixed the race — you have just buried it. The first time the system is genuinely slow (a deploy, a GC pause, a noisy neighbour on the build farm), the test will fail again.
4. **It teaches the wrong reflex.** A developer who writes `time.Sleep` once will write it ten more times. Soon every test in the suite has a sprinkling of sleeps, the suite is flaky, and people stop trusting test failures.

The cure is to **wait for a specific event**, not for an arbitrary amount of time. Events are deterministic: "the goroutine called `Done`" is true or false, no clock involved. Time is an approximation.

After reading this file you will:

- Recognise the `go work(); time.Sleep(d); assert(...)` smell on sight.
- Know the four reasons it is wrong, by heart.
- Be able to rewrite each occurrence as a `chan struct{}` close, a `WaitGroup`, or a `context` cancellation.
- Have a clear mental rule for the rare cases where `time.Sleep` is acceptable (hint: not in tests).
- Have first contact with `testing/synctest` as a deterministic alternative for time-driven code.

---

## Prerequisites

You should already be comfortable with:

- Spawning goroutines with `go f()`.
- Sending and receiving on channels, including `close(ch)` as a broadcast.
- The role of `sync.WaitGroup`: `Add`, `Done`, `Wait`.
- Writing a basic `func TestFoo(t *testing.T)` and running `go test`.
- The race detector: `go test -race`.

If `wg.Add(3); ... wg.Wait()` is unfamiliar, read `07-sync-package/01-waitgroup/junior.md` first. If you have never seen `select { case <-ch: ... }`, read `02-channels/01-buffered-vs-unbuffered/junior.md`.

You do not need to know `testing/synctest`, fake clocks, or `errgroup` yet. We will introduce each at the level it belongs.

---

## Glossary

- **`time.Sleep(d)`**: a function that blocks the current goroutine for at least duration `d`. It is *not* a synchronization primitive — it knows nothing about other goroutines.
- **Synchronization primitive**: a tool whose contract is "this call returns when a specific condition is true". Channels, mutexes, `sync.WaitGroup`, `sync.Cond`, `sync.Once`. `time.Sleep` is not on this list.
- **Flaky test**: a test that sometimes passes and sometimes fails on the same code, depending on timing.
- **Wall-clock time**: real time as measured by a clock on the wall. What `time.Sleep` consumes.
- **Deterministic test**: a test whose pass/fail result depends only on the code under test, not on timing or scheduling.
- **Barrier**: a synchronization point at which one or more goroutines wait until a condition is met. `wg.Wait()` and `<-ch` are barriers.
- **Quiescence**: a state in which no goroutine is doing work — every goroutine is blocked waiting for input or has exited. Many concurrent tests want to assert at a quiescent point.
- **Polling**: repeatedly checking a condition with small delays. Sometimes acceptable in tests when no other barrier is available; always worse than a real barrier.
- **`testing/synctest`**: an experimental (Go 1.24) / standard (Go 1.25+) package that provides virtual time and goroutine tracking for tests, eliminating the need for sleep entirely.
- **Tickless test**: a test that takes microseconds of wall-clock time regardless of how much virtual time the code under test consumes.

---

## Core Concepts

### `time.Sleep` is not a synchronization primitive

The signature is:

```go
func Sleep(d Duration)
```

That is all. It takes a duration. It returns no value. It accepts no condition, no channel, no goroutine handle, no context. It knows nothing about the rest of your program. It tells the Go runtime: "park this goroutine for at least `d`, then make it runnable again". Whether *another* goroutine has done anything in that interval is not its concern.

Contrast with the actual primitives:

| Call | Returns when |
|------|--------------|
| `<-ch` | A value is sent on `ch`, or `ch` is closed |
| `ch <- x` | A receiver is ready, or buffer has space |
| `wg.Wait()` | The counter reaches 0 |
| `mu.Lock()` | Lock is available |
| `<-ctx.Done()` | Context is cancelled |
| `time.Sleep(d)` | At least `d` has elapsed |

The first five tie their return to a *program event*. The last one ties its return to *the clock*. A program event is deterministic; a clock measurement is not.

### Why "almost always" still fails

A common defence is: "but the work only takes 1 ms, and I sleep for 100 ms — that is a 100x margin, surely that is safe?" No. There are three reasons your margin is not safe:

1. **Scheduling.** Your test thread may not get scheduled for 100 ms at a time on a busy CI runner. The 100x margin disappears when the scheduler decides to run a different process.
2. **Cold start.** The first call into a package may load code, allocate, JIT-warm caches, hit a slow file system. Cold work is 10-100x slower than warm.
3. **Compound delays.** If your test has five sleeps of 100 ms each, your suite runs in 500 ms even on a fast machine. Compound that across hundreds of tests and your CI bill grows.

### What the anti-pattern actually achieves

A `time.Sleep` "synchronization" delivers, in practice:

- A test that passes most of the time on the developer's laptop.
- A test that fails 1 in 50 runs on CI.
- A flake culture in which engineers re-run failing pipelines until they pass instead of investigating.
- Lost trust in the test suite: when every test is "probably flaky", a real regression slides through.

### What you should do instead

For each of the three things a sleep is trying to do, there is a precise replacement:

| Sleep purpose | Real fix |
|---------------|----------|
| Wait for one goroutine to finish | `chan struct{}` closed on exit, or `wg.Wait()` |
| Wait for N goroutines to finish | `sync.WaitGroup` |
| Wait for a value | Receive on a result channel |
| Wait for cancellation to propagate | `<-ctx.Done()` |
| Wait for a timer to fire (under test) | Mocked clock + `Advance(d)`, or `testing/synctest` |
| Wait for "everything to be done" | `synctest.Wait()` inside a bubble |
| Polite backoff in production | `time.Sleep` *inside* `select` with `ctx.Done` |

You will spend the rest of this file practising each.

---

## Real-World Analogies

**Microwaving popcorn.** A `time.Sleep` is like setting the microwave for 3 minutes regardless of what is inside. Sometimes the popcorn finishes in 90 seconds; you waste 90 seconds and risk burning. Sometimes it needs 4 minutes; you open the door to a bag of mostly unpopped kernels. The right answer is "stop when popping slows to one pop per two seconds" — a *condition*, not a duration.

**Waiting at a coffee shop.** Telling a friend "be there in 10 minutes" and then sitting in the shop for 10 minutes regardless of whether they arrive in 2 or in 20 is a sleep. Tying a string to your wrist so the friend can tug it when they walk in is a channel. One wastes your time, the other wastes none.

**Phone ringing.** Picking up the phone after it has rung for "long enough" is a sleep. Picking up when it actually rings is a channel receive. You would never write a phone that picks up after a fixed delay regardless of ringing — but people write tests that way every day.

**Boarding a plane.** Air traffic control does not say "wait 5 minutes then take off". It says "take off when cleared". The wait is bounded by a *signal* from the tower, not by a clock. Aviation got this right in 1930; many test suites still get it wrong in 2026.

---

## Mental Models

### The "what if it is 10x slower" test

Whenever you type `time.Sleep` in a test, ask yourself: *what if my CI is 10x slower than my laptop right now?* If the answer is "the test fails", the sleep is wrong. If the answer is "still passes but is 10x slower", the sleep is still wrong, just slowly wrong.

Apply the inverse too: *what if my CI is 10x faster?* If the answer is "still slow, because I sleep 100 ms regardless", the sleep is wrong.

The only sleep that passes both tests is the one that *does not exist*.

### Events versus durations

Think of every concurrent test as a sequence of *events* — moments when something specific happens — and decide what each event is. "Goroutine started", "task accepted", "result produced", "shutdown completed". For each event, write down the *signal* that marks it. A closed channel. A wg counter reaching 0. A return from `Wait`. A response on a result channel.

Now run the test in your head: each line either *causes* an event or *waits for* an event. There should be no `time.Sleep`. If you cannot find a signal for some event, you have a missing API in the production code — usually a "done" channel that should have been exposed for testing.

### The deterministic principle

A test is deterministic when, given the same code, it always produces the same result. `time.Sleep` introduces non-determinism by making the test depend on wall-clock time. Removing every sleep from a test is equivalent to removing every external timing dependency. Combined with seeded randomness and fixed time-of-day, your test becomes a pure function from "the code" to "pass/fail".

---

## Pros & Cons

### "Pros" of `time.Sleep` for synchronization

There are none. Every apparent benefit is a disguised cost.

| Apparent benefit | Real cost |
|------------------|-----------|
| Easy to type | Hides the missing signal in the production code |
| Looks like the system "settles" | System is never proven to have settled |
| Works on my machine | Fails on every other machine, eventually |
| Quick fix for one test | Becomes the default reflex for every test |

### Cons (the honest list)

- Wall-clock time consumed in every run, even when the work is instant.
- Flakiness proportional to suite size.
- Test failures do not point at real bugs; they look like infrastructure problems.
- Tuning the duration up makes the test slower; tuning down makes it flakier; no value is correct.
- Encourages writing production code without "done" channels, because the test "did not need one".
- Co-existence with `-race`: a test with a sleep will sometimes win the race and pass without `-race`, then fail under `-race` because the race detector slows the program down.

---

## Use Cases

The anti-pattern shows up in three families of test:

### 1. "Worker has started"

```go
go worker.Run()
time.Sleep(50 * time.Millisecond) // assume started
worker.Submit(task)
```

The worker probably has not even reached its main loop in 50 ms on a cold start. Replace with a `started` channel closed in the worker's first line.

### 2. "Work has finished"

```go
worker.Submit(task)
time.Sleep(100 * time.Millisecond) // assume done
assertResult()
```

Replace with a `done` channel or a result channel.

### 3. "Background loop has run at least once"

```go
go cache.RefreshLoop(50 * time.Millisecond)
time.Sleep(200 * time.Millisecond) // assume refreshed several times
assertRefreshed()
```

Replace with a mocked clock and `clock.Advance(200 * time.Millisecond)`, or with `testing/synctest`. Real time is not what the loop cares about; *virtual time* is.

In production code, `time.Sleep` has its own legitimate uses (backoff, throttling), but always paired with `select` and `ctx.Done` — never as a synchronization point with another goroutine.

---

## Code Examples

### The broken pattern, in detail

```go
package worker

import (
    "sync/atomic"
    "testing"
    "time"
)

type Worker struct {
    in   chan string
    done int32
}

func NewWorker() *Worker {
    return &Worker{in: make(chan string, 4)}
}

func (w *Worker) Run() {
    for range w.in {
        atomic.AddInt32(&w.done, 1)
    }
}

func (w *Worker) Submit(s string) {
    w.in <- s
}

func (w *Worker) Stop() {
    close(w.in)
}

func (w *Worker) Done() int32 {
    return atomic.LoadInt32(&w.done)
}

// BROKEN — sleep-based synchronization.
func TestWorker_Broken(t *testing.T) {
    w := NewWorker()
    go w.Run()

    w.Submit("a")
    w.Submit("b")
    w.Submit("c")

    time.Sleep(100 * time.Millisecond)

    if got := w.Done(); got != 3 {
        t.Fatalf("got %d done, want 3", got)
    }
}
```

This test:

- Passes on a fast laptop 999/1000 times.
- Fails on a noisy CI 1/50 times.
- Wastes 100 ms per run even when it passes.
- Will eventually start failing when the work changes to "process an HTTP call" and 100 ms is no longer enough.

### Fix 1 — `chan struct{}` close

Expose a "done" signal from the worker. The cleanest way is to close the input channel and wait for the worker to exit:

```go
func TestWorker_Fixed_Close(t *testing.T) {
    w := NewWorker()
    exited := make(chan struct{})
    go func() {
        w.Run()
        close(exited)
    }()

    w.Submit("a")
    w.Submit("b")
    w.Submit("c")
    w.Stop()

    <-exited // deterministic barrier

    if got := w.Done(); got != 3 {
        t.Fatalf("got %d done, want 3", got)
    }
}
```

`<-exited` blocks until `w.Run` returns, which happens only after the channel has been drained. No timing assumption. Test runs in microseconds. Reliable on every machine.

### Fix 2 — `sync.WaitGroup`

For multiple workers:

```go
func TestPool_Fixed_WG(t *testing.T) {
    var wg sync.WaitGroup
    var done int32

    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            doWork()
            atomic.AddInt32(&done, 1)
        }()
    }

    wg.Wait()

    if got := atomic.LoadInt32(&done); got != 5 {
        t.Fatalf("got %d, want 5", got)
    }
}
```

`wg.Wait()` returns precisely when all five workers have finished. Zero sleep.

### Fix 3 — result channel

For a one-shot worker that produces a value:

```go
func TestCompute(t *testing.T) {
    out := make(chan int, 1)
    go func() {
        out <- compute(42)
    }()

    got := <-out

    if got != 84 {
        t.Fatalf("got %d, want 84", got)
    }
}
```

The receive blocks until the goroutine sends. No sleep, no race.

### Fix 4 — `context.Context` cancellation

For testing cancellation paths:

```go
func TestServer_Shutdown(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    s := NewServer()
    done := make(chan struct{})
    go func() {
        s.Serve(ctx)
        close(done)
    }()

    cancel()

    select {
    case <-done:
        // Server exited as expected.
    case <-time.After(2 * time.Second):
        t.Fatal("server did not shut down within 2s of cancel")
    }
}
```

Note the `time.After` here: it is a *failure timeout*, not a *synchronization point*. We are not assuming shutdown takes 2 s; we are saying "if it takes more than 2 s, fail". This is the one pattern where waiting with a clock is acceptable in a test, because the clock is the *upper bound*, not the *trigger*.

### Fix 5 — Mocked clock for time-driven code

For code that *cares* about time (a TTL cache, a debouncer, a retry loop), inject a clock:

```go
type Clock interface {
    Now() time.Time
    Sleep(d time.Duration)
}

type Cache struct {
    clk  Clock
    data map[string]entry
}

type entry struct {
    val     string
    expires time.Time
}

func (c *Cache) Set(k, v string, ttl time.Duration) {
    c.data[k] = entry{val: v, expires: c.clk.Now().Add(ttl)}
}

func (c *Cache) Get(k string) (string, bool) {
    e, ok := c.data[k]
    if !ok || c.clk.Now().After(e.expires) {
        return "", false
    }
    return e.val, true
}
```

In tests, a fake clock controls `Now()`:

```go
type FakeClock struct{ t time.Time }

func (f *FakeClock) Now() time.Time          { return f.t }
func (f *FakeClock) Sleep(d time.Duration)   { f.t = f.t.Add(d) }
func (f *FakeClock) Advance(d time.Duration) { f.t = f.t.Add(d) }

func TestCache_TTL(t *testing.T) {
    fc := &FakeClock{t: time.Unix(0, 0)}
    c := &Cache{clk: fc, data: map[string]entry{}}
    c.Set("k", "v", time.Minute)

    fc.Advance(30 * time.Second)
    if _, ok := c.Get("k"); !ok {
        t.Fatal("key should still be valid at 30s")
    }

    fc.Advance(31 * time.Second)
    if _, ok := c.Get("k"); ok {
        t.Fatal("key should have expired at 61s")
    }
}
```

The test takes microseconds and tests an exact TTL boundary. A sleep-based version would either take 61 seconds or be flaky around the boundary.

### Fix 6 — `testing/synctest` (Go 1.24+)

For code that mixes goroutines and time:

```go
func TestRetry_Synctest(t *testing.T) {
    synctest.Run(func() {
        start := time.Now()
        var attempts int
        ok := retry(3, time.Second, func() bool {
            attempts++
            return attempts == 3
        })
        elapsed := time.Since(start)

        if !ok {
            t.Fatal("retry should have succeeded on attempt 3")
        }
        if elapsed != 2*time.Second {
            t.Fatalf("got elapsed %v, want 2s", elapsed)
        }
    })
}
```

The retry sleeps twice (between attempt 1 and 2, between 2 and 3). Inside `synctest.Run`, those sleeps return instantly in wall-clock time but advance the virtual clock exactly. The test verifies both correctness and timing in milliseconds of real time.

---

## Coding Patterns

### Pattern: "started" signal

When a goroutine has setup work, expose a `ready` channel:

```go
type Server struct {
    ready chan struct{}
}

func (s *Server) Run() {
    s.setUp()
    close(s.ready) // signal: I am ready
    s.serve()
}

func TestServer(t *testing.T) {
    s := &Server{ready: make(chan struct{})}
    go s.Run()
    <-s.ready // deterministic
    // ... proceed with test
}
```

### Pattern: "done" channel

Mirror of the above, for shutdown:

```go
type Server struct {
    done chan struct{}
}

func (s *Server) Run() {
    s.serve()
    close(s.done)
}

func TestServer_Shutdown(t *testing.T) {
    s := &Server{done: make(chan struct{})}
    go s.Run()
    s.stop()
    <-s.done
}
```

### Pattern: counted finish

When N goroutines must finish:

```go
var wg sync.WaitGroup
for _, w := range workers {
    wg.Add(1)
    go func(w *Worker) {
        defer wg.Done()
        w.Run()
    }(w)
}
wg.Wait()
```

### Pattern: timeout as upper bound

Wrap a barrier with a timeout to convert hang into clean fatal:

```go
select {
case <-done:
case <-time.After(2 * time.Second):
    t.Fatal("did not finish within 2s")
}
```

The `time.After` here is a *safety net*, not a *trigger*. The expected case is `<-done` returning in microseconds.

### Pattern: polling as last resort

When the production code genuinely cannot expose a signal (third-party library, OS-level event), poll with bounded retries:

```go
func waitFor(t *testing.T, cond func() bool, d time.Duration) {
    t.Helper()
    deadline := time.Now().Add(d)
    for time.Now().Before(deadline) {
        if cond() {
            return
        }
        time.Sleep(time.Millisecond)
    }
    t.Fatalf("condition not met within %v", d)
}
```

Use sparingly; this is still time-based, but at least the wait is bounded and the test fails clearly. Prefer adding a signal channel to the production code over polling whenever possible.

---

## Clean Code

- A test that contains `time.Sleep` is a code smell, full stop. Treat it like a global mutable variable.
- Every goroutine in production code should expose at least one signal: a `done` channel, a `wg` to `Wait` on, or a `context` to cancel.
- Tests should communicate intent: `<-server.ready` reads as "wait until the server is ready". `time.Sleep(100 * time.Millisecond)` reads as "I do not understand my own code".
- The duration argument to a sleep should never be a magic number. Either remove the sleep, or it is configuration (test fixture, env var) with a clear name.
- Pair `time.Sleep` with `select` whenever it survives. A bare sleep in production is almost always a bug too.

---

## Product Use / Feature

In production code (not tests), `time.Sleep` has a small number of legitimate uses, all of which require `select`:

### Backoff between retries

```go
for attempt := 0; attempt < maxRetries; attempt++ {
    if err := do(); err == nil {
        return nil
    }
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(backoff(attempt)):
    }
}
```

A bare `time.Sleep(backoff)` would block the caller's context. The `select` lets a cancelled context interrupt the wait.

### Throttling

```go
ticker := time.NewTicker(rate)
defer ticker.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-ticker.C:
        emit()
    }
}
```

Use `time.NewTicker`, not `time.Sleep` in a loop, for periodic work — it does not drift.

### Polite cooldown after a failure

```go
select {
case <-ctx.Done():
    return
case <-time.After(coolDown):
}
```

Same pattern as backoff.

In *all* production uses, the rule is: **pair every sleep with `select` and `ctx.Done`**. A bare `time.Sleep` in production code is almost always a missed cancellation.

---

## Error Handling

The mistakes in this area are not so much "errors" as "design bugs that disguise as test flakes". A few specific traps:

### Trap: assuming a goroutine has panicked

```go
go w.Run()
time.Sleep(time.Second)
// "It's been a second, surely it would have panicked by now."
```

A panic in a goroutine kills the program; you cannot test for it with a sleep. Use `defer recover()` inside the goroutine and a result channel for the recovered value.

### Trap: assuming `time.Sleep` is interruptible

It is not. `time.Sleep(d)` will run for the full `d` even if the surrounding context is cancelled. If you need interruptible sleep, use:

```go
select {
case <-ctx.Done():
    return ctx.Err()
case <-time.After(d):
}
```

### Trap: failing to detect missed events

A sleep does not tell you *which* events fired during the wait. If your test expects exactly one event but the production code emitted two, the sleep cannot tell you. A channel can.

---

## Security Considerations

Sleep-based timing is rarely a direct security issue, but two patterns deserve mention:

### Timing channels in tests

If your test uses `time.Sleep` to "wait for an attacker to do something", you have introduced a race in your security test itself. The attacker may finish faster than expected, the test passes, and you ship a vulnerability. Use signals.

### Sleep as a defence

`time.Sleep` is sometimes used as a defence against timing attacks (constant-time comparison via sleeping). This does not work: the sleep is on the response, but the underlying compare is still variable-time. Use `crypto/subtle.ConstantTimeCompare`, not sleep.

### DoS amplification

If a sleep-based wait is in the *request path* (not just tests), an attacker can hold many requests open for the duration of the sleep, exhausting goroutines. This is rare but worth catching in code review.

---

## Performance Tips

- Replacing 100 ms of sleep with a 10 µs channel receive is a 10,000x speedup. In a test suite with 500 sleeps, that is 50 seconds saved per run.
- A flaky test costs more than its runtime: an engineer has to retry, look, and re-merge. Eliminating one flake saves more developer time per week than most refactors.
- `time.After` allocates a timer; in hot loops, prefer `time.NewTimer` with explicit `Stop` and reset. (Mostly relevant in production, not in tests.)
- The race detector slows the program by 5-20x. Sleep-based tests already wasting time become unbearable under `-race`. Removing sleeps makes `-race` runs *fast*.
- `synctest.Run` blocks of code execute in microseconds regardless of virtual time; entire packages can be tested in under a second.

---

## Best Practices

1. **Audit your test files for `time.Sleep`.** Every occurrence is suspicious. Replace it or document why.
2. **Add a "done" channel or `wg` to every goroutine in production code.** If a test cannot wait for it deterministically, the API is incomplete.
3. **Use `select` + `time.After` only as a failure timeout, not a synchronization barrier.**
4. **Use `testing/synctest` for any code that involves time.** Once your team is on Go 1.24+, no test should use real time.
5. **Configure `go test -race` in CI.** It will not catch every flake, but it will catch the worst ones.
6. **Add a lint rule.** Most projects forbid `time.Sleep` in `*_test.go` via a custom linter. Even a `grep` in `pre-commit` is better than nothing.
7. **Treat every flaky test as a bug.** Do not "re-run" a failing test. Find the missing signal, expose it, fix the test.

---

## Edge Cases & Pitfalls

### `t.Parallel()` makes sleeps worse

`t.Parallel()` schedules many tests on the same `go test` binary. If each one sleeps 100 ms, they may all run *at once*, so wall-clock time may not multiply linearly — but the *CPU time* they consume waiting for nothing does. Worse, parallel sleeps mean more scheduler pressure, more chance of starvation, and more flakes.

### `runtime.Gosched` is not a sleep substitute

A common "trick" is `runtime.Gosched()` instead of `time.Sleep`, hoping the runtime will give the other goroutine a chance. It does not synchronise anything. Treat it as a worse sleep.

### Sub-millisecond sleeps lie

`time.Sleep(1 * time.Microsecond)` does not sleep for 1 µs on most platforms — the OS scheduler has a minimum quantum (often 1-10 ms). The sleep returns when the OS feels like it. Do not assume fine-grained timing.

### Monotonic clock drift

`time.Sleep` uses the monotonic clock, so a system clock jump (NTP correction) does not affect it. But you can still be migrated to a different CPU mid-sleep, or paused (laptop suspend, container throttling). The sleep duration is a *lower bound*, never an upper bound.

### Test caching

`go test` caches results for tests that pass deterministically. A sleep-based test that "always passes" still re-runs because Go knows time was consumed. Removing sleeps speeds up incremental builds dramatically.

---

## Common Mistakes

1. **"I'll just bump it to 500 ms, that's plenty."** Bumping the sleep makes the test pass more often, never always. It also makes the suite slower.
2. **"It works on my machine."** Yes, until the next deploy / next intern / next month.
3. **Sleeping after `wg.Wait`.** `wg.Wait` already returned; the sleep is pure waste.
4. **Sleeping inside a `for { }` instead of using `time.NewTicker`.** Drifts, allocates extra timers under the hood, hides bugs.
5. **Sleeping in `init()`.** `init` runs before `TestMain`; a sleep here pauses the whole test binary boot.
6. **Sleeping in a `defer`.** Adds latency to every test teardown. Search a large codebase and you will find this.
7. **Sleeping in production hot paths.** Each sleep parks one goroutine; under load, you starve your scheduler.

---

## Common Misconceptions

- **"Channels are slow, sleep is fast."** False. A channel receive of an unbuffered channel is on the order of 100 ns. A sleep of any non-zero duration is at least 1 ms on most OSes. The channel is 10,000x faster.
- **"A sleep is more readable than a channel."** Only if you do not understand the channel. After a week, the channel is *more* readable because it says exactly what it waits for.
- **"`time.Sleep` is a synchronization primitive."** It is not. It is a delay primitive. The Go spec is explicit: `time.Sleep` says nothing about happens-before with any other goroutine.
- **"`runtime.Gosched()` is a synchronization barrier."** Also false. It only yields the scheduler.
- **"Once I have `-race` green, my sleeps are safe."** No. `-race` finds *data races*, not *missed-event races*. A test that asserts before the worker has finished may still pass under `-race` if the assertion does not touch the same memory.

---

## Tricky Points

- **The Go runtime's `sleepuntil` is implemented in `runtime/time.go`.** A goroutine in `time.Sleep` is on a timer heap, not consuming a P. So sleep does not "burn CPU" — but it does hold a goroutine, which has cost (stack, GC).
- **`time.After(d)` in a tight loop leaks timers.** Each call allocates a `*Timer`; until `d` elapses, it sits on the timer heap. Use `time.NewTimer` and `t.Reset` if you must.
- **Monotonic clock removal.** Calling `time.Now().Round(0)` strips the monotonic reading. Mixing wall and monotonic readings causes confusion when you save and re-load times. Not directly related to sleep but often hits beginners.
- **`testing/synctest` does *not* virtualise system calls.** A goroutine blocked on a real network or file read still blocks the bubble. Mock IO when using `synctest`.
- **Sleep inside a `sync.Mutex`-held critical section** holds the lock for the whole duration. Other goroutines waiting on the same mutex stall. Never sleep with a lock held.

---

## Test

Write a test for the following toy worker that does *not* use `time.Sleep`:

```go
type Counter struct {
    in chan int
    n  int64
}

func (c *Counter) Run() {
    for x := range c.in {
        atomic.AddInt64(&c.n, int64(x))
    }
}
```

Your test must:

- Start the worker.
- Submit values 1, 2, 3.
- Stop the worker.
- Verify that `n == 6`.
- Take less than 1 ms on a normal laptop.

A reference solution:

```go
func TestCounter(t *testing.T) {
    c := &Counter{in: make(chan int)}
    done := make(chan struct{})
    go func() { c.Run(); close(done) }()

    c.in <- 1
    c.in <- 2
    c.in <- 3
    close(c.in)
    <-done

    if got := atomic.LoadInt64(&c.n); got != 6 {
        t.Fatalf("got %d, want 6", got)
    }
}
```

Run with `go test -race -count=1000`. It should pass every time. Now try the broken version with a `time.Sleep(10 * time.Millisecond)` in place of `<-done` and count failures.

---

## Tricky Questions

1. *Q.* I have a goroutine that takes 1 ms. I sleep for 1 second. Is the test safe?
   *A.* No. Safety is binary; "safer" is not safe. Use a signal.

2. *Q.* What about `runtime.Gosched()` between `go f()` and the assertion?
   *A.* Does not synchronise anything. `Gosched` only yields the scheduler; the goroutine may still be runnable but not yet finished.

3. *Q.* Can I use `time.Sleep(0)`?
   *A.* `time.Sleep(0)` returns immediately (effectively a `Gosched`). Useless for synchronization.

4. *Q.* My test passes 1000 times in a row. Surely the sleep is fine?
   *A.* 1000 successes do not prove correctness in concurrency. CI runs are different; a future change will break it.

5. *Q.* The third-party library spawns a goroutine internally. I cannot signal completion. What do I do?
   *A.* If the library exposes a `Wait`, `Close`, or `Done`, use it. If not, poll a public observable property with `waitFor`. Last resort: open an issue on the library to add a signal.

6. *Q.* `time.Sleep` after `wg.Wait`?
   *A.* `wg.Wait` already returned; the sleep is pure overhead. Delete.

7. *Q.* Is `time.Sleep` ever acceptable in test code?
   *A.* Only in helper code that polls a condition (`waitFor`), and only when no signal is available. Even then, the sleep is bounded and inside a polling loop, not a one-shot "wait and hope".

---

## Cheat Sheet

```text
ANTI-PATTERN
  go work()
  time.Sleep(100 * time.Millisecond)
  assert(...)

FIX A — signal channel
  done := make(chan struct{})
  go func() { work(); close(done) }()
  <-done
  assert(...)

FIX B — WaitGroup
  var wg sync.WaitGroup
  wg.Add(N)
  for ... { go func() { defer wg.Done(); work() }() }
  wg.Wait()
  assert(...)

FIX C — result channel
  out := make(chan int, 1)
  go func() { out <- work() }()
  v := <-out
  assert(v == ...)

FIX D — context cancellation
  go server.Serve(ctx)
  cancel()
  <-server.done
  assert(...)

FIX E — fake clock
  fc := &FakeClock{}
  c := &Cache{clk: fc}
  fc.Advance(d)
  assert(c.Get(k) == ...)

FIX F — testing/synctest
  synctest.Run(func() {
      go work()
      synctest.Wait()
      assert(...)
  })

SAFETY NET ONLY
  select {
  case <-done:
  case <-time.After(2 * time.Second):
      t.Fatal("hang")
  }
```

---

## Self-Assessment Checklist

- [ ] I can name four reasons `time.Sleep` is wrong for synchronization.
- [ ] I can rewrite a `go f(); time.Sleep(d); assert(...)` test as a channel close.
- [ ] I know when `time.Sleep` is acceptable in production (paired with `select` + `ctx.Done`).
- [ ] I know when `time.Sleep` is acceptable in tests (never as a synchronizer; only inside a bounded `waitFor` helper as last resort).
- [ ] I can describe the difference between a synchronization point and a failure timeout.
- [ ] I have searched my project for `time.Sleep` in `_test.go` and counted occurrences.
- [ ] I have replaced at least one sleep-based test in my real codebase with a channel barrier.
- [ ] I know the `testing/synctest` import path and what `synctest.Run` does at a high level.
- [ ] I have configured `go test -race -count=N` in at least one project's CI.
- [ ] I refuse to write a sleep-based test, even when in a hurry.

---

## Summary

`time.Sleep` is a delay primitive, not a synchronization primitive. Using it to wait for another goroutine is the most prolific source of flaky Go tests in the wild. Every sleep can be replaced by a deterministic alternative: a channel close for "this goroutine finished", a `WaitGroup` for "N goroutines finished", a context cancellation for "shutdown happened", a fake clock or `testing/synctest` for "time advanced". The mantra is fixed: **never `time.Sleep` in tests**. In production code, `time.Sleep` survives only inside `select { case <-ctx.Done(): ...; case <-time.After(d): ...}`. Anywhere else, you have a synchronization bug waiting to bite.

---

## What You Can Build

After this file you can:

- Audit any Go package and replace its sleep-based tests with deterministic ones.
- Add `ready` / `done` channels to production goroutines so they are testable.
- Write a `waitFor(cond, timeout)` helper for the rare polling cases.
- Use `testing/synctest` for a first time-driven test.
- Defend in code review: "delete this sleep; here is the channel that replaces it".
- Cut a team's flaky-test rate by half in an afternoon.

---

## Further Reading

- Go blog — [The Go Memory Model](https://go.dev/ref/mem). Pay attention to "happens-before" — `time.Sleep` is not in the relation.
- [`testing/synctest`](https://pkg.go.dev/testing/synctest) package documentation.
- "Concurrency in Go" by Katherine Cox-Buday, chapter on goroutine lifecycle.
- The Go issue tracker, search "flaky": shows how often the language team itself replaces sleeps in stdlib tests.

---

## Related Topics

- `02-channels/01-buffered-vs-unbuffered` — channels as the deterministic barrier of choice.
- `07-sync-package/01-waitgroup` — `WaitGroup` mechanics.
- `13-testing-concurrent-code/02-deterministic-testing` — the broader toolbox.
- `13-testing-concurrent-code/03-waitgroup-in-tests` — `WaitTimeout` helper, leak detection.
- `13-testing-concurrent-code/04-mocking-time` — fake clocks in depth.
- `15-concurrency-anti-patterns/05-wait-for-empty-channel` — a close cousin: "is the channel empty yet" is also wrong.

---

## Diagrams & Visual Aids

### Sleep-based test timeline

```
Test goroutine:    go w.Run()  | sleep(100ms) ... | w.Submit | sleep(100ms) ... | assert
Worker goroutine:    start ... | run ...          |   ...    |   running ...    | (maybe done?)

Wall time:        0ms          100ms              ?          200ms              ?
```

The "?" marks the unknowns. The assertion fires at 200 ms regardless of whether the worker has finished.

### Signal-based test timeline

```
Test goroutine:    go w.Run() | w.Submit |          | <-done | assert
Worker goroutine:    start    | accept   | run end  | (done) | (exited)

Wall time:        0ms         <1ms       <1ms       <1ms     <1ms
```

The barrier `<-done` waits for the actual event. Total wall time: microseconds. Result: deterministic.

### Decision flow

```
need to wait for something in a test?
  │
  ├── waiting for goroutine to finish?
  │     ├── one goroutine?    → close(done) + <-done
  │     ├── N goroutines?     → sync.WaitGroup
  │     └── N with errors?    → errgroup.Group
  │
  ├── waiting for cancellation?
  │     └── context.WithCancel + <-ctx.Done
  │
  ├── waiting for time to pass?
  │     ├── code uses Clock?  → fake clock + Advance
  │     └── code uses time.*? → testing/synctest
  │
  └── nothing else works?     → bounded waitFor polling helper

NEVER:
  time.Sleep(d) followed by an assertion.
```
