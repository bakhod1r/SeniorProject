---
layout: default
title: Middle
parent: Sleep for Sync
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 2
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/06-sleep-for-sync/middle/
---

# Sleep for Synchronization — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Replacements Playbook](#the-replacements-playbook)
3. [`sync.WaitGroup`: Waiting For N Goroutines To Finish](#syncwaitgroup-waiting-for-n-goroutines-to-finish)
4. [Channels As Notifications](#channels-as-notifications)
5. [`context.Context`: Coordinating Cancellation And Deadlines](#contextcontext-coordinating-cancellation-and-deadlines)
6. [`sync.Cond`: Waiting For Predicates Under A Mutex](#synccond-waiting-for-predicates-under-a-mutex)
7. [`errgroup`: Structured Concurrency With Errors](#errgroup-structured-concurrency-with-errors)
8. [Polling Helpers: When You Really Cannot Subscribe](#polling-helpers-when-you-really-cannot-subscribe)
9. [Fake Clocks And `clockwork`](#fake-clocks-and-clockwork)
10. [`testing/synctest` In Anger](#testingsynctest-in-anger)
11. [Refactoring Recipes: Before And After](#refactoring-recipes-before-and-after)
12. [Why Tuning The Sleep Never Works](#why-tuning-the-sleep-never-works)
13. [The Cost Of Flaky Tests](#the-cost-of-flaky-tests)
14. [When `time.Sleep` Is Genuinely Acceptable](#when-timesleep-is-genuinely-acceptable)
15. [Designing Production Code That Is Easy To Test](#designing-production-code-that-is-easy-to-test)
16. [Detecting The Anti-Pattern In Code Review](#detecting-the-anti-pattern-in-code-review)
17. [Linting And Static Analysis](#linting-and-static-analysis)
18. [Edge Cases And Pitfalls](#edge-cases-and-pitfalls)
19. [Common Mistakes](#common-mistakes)
20. [Common Misconceptions](#common-misconceptions)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [Further Reading](#further-reading)

---

## Introduction

> Focus: "I know `time.Sleep` is wrong. What exactly do I write instead, for every case?"

The junior file established the rule: **never use `time.Sleep` to synchronise**. At the middle level the rule is no longer the lesson. The lesson is the *catalogue of replacements*: there is one for every situation where a beginner would have reached for `time.Sleep`, and you should be able to pick the right one in seconds.

A confident middle-level Go engineer should be able to look at any test that contains `time.Sleep` and answer two questions out loud:

1. *What event* is this sleep waiting for?
2. *Which primitive* makes that event observable without the sleep?

If you can answer those, the refactor writes itself. This file gives you the vocabulary and the patterns to make both answers automatic.

After reading this you will:

- Pick correctly between `WaitGroup`, channel, `context`, `Cond`, `errgroup`, and a polling helper.
- Refactor sleep-based tests into deterministic, fast tests without changing what they assert.
- Distinguish "waiting for work" (channel, `Cond`) from "waiting for time" (fake clock, `synctest`).
- Recognise the small number of places where `time.Sleep` is the *right* answer in production code.
- Read a code review diff and flag every sleep that should not be there.

---

## The Replacements Playbook

Every `time.Sleep` in your codebase fits into one of the following buckets. Memorise this mapping; it is the entire middle-level skill in one table.

| Pattern of the original code | The event you are actually waiting for | Replace `time.Sleep` with |
| --- | --- | --- |
| `go f(); time.Sleep(d); assert that f finished` | "f has returned" | `wg.Wait()` (one goroutine) or `wg.Wait()` after `wg.Add(n)` (many) |
| `go f(); time.Sleep(d); assert that f produced a value` | "f sent on a channel" | block on `<-ch` |
| `go f(); time.Sleep(d); cancel f` | "the test wants to cancel" | call `cancel()` on a `context.CancelFunc` |
| `start server; time.Sleep(d); send request` | "server is listening" | use a `chan struct{}` that the server closes after `Listen` |
| `start watcher; time.Sleep(d); modify file; time.Sleep(d); assert watcher saw it` | "watcher fired its callback" | callback writes to a buffered channel; test reads from it |
| `time.Sleep(d); check that retry happened` | "retry was invoked" | inject a fake clock, advance it; or `synctest.Wait()` |
| `time.Sleep(d); check that timer fired` | "timer expired" | inject a fake clock; or use `synctest` and let virtual time tick |
| `time.Sleep(d); poll a condition` | "condition became true" | `require.Eventually` with a short interval, or a `sync.Cond` notification |
| `time.Sleep(d); throttle in production` | "ratelimiter says you may go" | `golang.org/x/time/rate.Limiter` or `time.Ticker` with `<-tick.C` |

If the sleep cannot be slotted into one of the rows above, the code is doing something exotic and you should walk through what real event the sleep is supposed to approximate. There is *always* a real event. `time.Sleep` is never inherently meaningful; it is a stand-in for some condition the author was too tired to express.

---

## `sync.WaitGroup`: Waiting For N Goroutines To Finish

The single most common shape of the anti-pattern is "I spawned a goroutine and now I need to know when it is done". `sync.WaitGroup` solves exactly this problem.

### Anatomy

A `WaitGroup` is a counter of pending tasks.

```go
var wg sync.WaitGroup

wg.Add(1)
go func() {
    defer wg.Done()
    doWork()
}()

wg.Wait() // blocks until the counter reaches zero
```

Three rules:

1. **Call `Add` before the `go` statement**, not inside the goroutine. If you call `Add` inside the goroutine, the parent may reach `Wait` before `Add` runs and exit early.
2. **Call `Done` exactly once per `Add`.** A `defer wg.Done()` at the top of the goroutine is the idiomatic way to guarantee this even if the body panics.
3. **Never reuse a `WaitGroup` across phases.** Once `Wait` has returned, treat the value as consumed. Create a new one for the next phase.

### Refactor: single goroutine

Before — racy, slow, smells of sleep:

```go
func TestWorker_Single(t *testing.T) {
    var done bool
    go func() {
        doExpensiveThing()
        done = true
    }()

    time.Sleep(200 * time.Millisecond) // hope it finished

    if !done {
        t.Fatal("worker did not finish")
    }
}
```

After — deterministic, fast, race-detector-clean:

```go
func TestWorker_Single(t *testing.T) {
    var wg sync.WaitGroup
    wg.Add(1)
    var done bool
    go func() {
        defer wg.Done()
        doExpensiveThing()
        done = true
    }()

    wg.Wait()

    if !done {
        t.Fatal("worker did not finish")
    }
}
```

Two things to note:

- The 200ms wait is gone. The test now takes exactly as long as `doExpensiveThing` actually takes.
- `done` is written and read in a happens-before relationship: the write inside the goroutine happens before `wg.Done()`, which happens before `wg.Wait()` returns, which happens before the read in `t.Fatal`. The race detector is happy.

### Refactor: many goroutines

Before — multiple sleeps, multiple gambles:

```go
func TestFanOut(t *testing.T) {
    counts := make([]int, 10)
    for i := range counts {
        i := i
        go func() {
            counts[i] = compute(i) // imagine each takes a variable time
        }()
    }

    time.Sleep(500 * time.Millisecond) // hope all finish

    for i, c := range counts {
        if c != expected(i) {
            t.Errorf("counts[%d] = %d, want %d", i, c, expected(i))
        }
    }
}
```

This test has a *second* problem on top of the sleep: even after the sleep, the writes to `counts[i]` are racy. There is no synchronisation between the goroutines and the main test, so the race detector will flag the read in the `for i, c := range counts` loop. Fixing the sleep also fixes the race.

After:

```go
func TestFanOut(t *testing.T) {
    counts := make([]int, 10)
    var wg sync.WaitGroup
    wg.Add(len(counts))
    for i := range counts {
        i := i
        go func() {
            defer wg.Done()
            counts[i] = compute(i)
        }()
    }

    wg.Wait()

    for i, c := range counts {
        if c != expected(i) {
            t.Errorf("counts[%d] = %d, want %d", i, c, expected(i))
        }
    }
}
```

The race is gone because `wg.Wait()` establishes happens-before on every `wg.Done()` call.

### When `WaitGroup` is the wrong tool

`WaitGroup` only tells you "all goroutines exited". It does *not* tell you:

- Which goroutine finished first.
- Whether any goroutine returned an error (it has no return slot).
- That a goroutine reached a particular intermediate state (e.g. "started listening").

For those cases reach for channels, `errgroup`, or `Cond`. The next sections cover each.

### `WaitGroup.Go` in Go 1.25+

Go 1.25 added `WaitGroup.Go`, which combines `Add(1)` and the `go func()` launch into one call:

```go
var wg sync.WaitGroup
wg.Go(func() {
    doWork()
})
wg.Wait()
```

Functionally equivalent to the longer form, less to type, no chance of forgetting `Done`. Use it everywhere you can on modern Go.

---

## Channels As Notifications

When you do not need a counter — when one event firing once is enough — use a channel as a one-shot notification.

### The "closed channel as broadcast" pattern

A goroutine signals "I am ready" or "I am done" by **closing** a channel. Every reader sees the close immediately and proceeds. This is the canonical replacement for `time.Sleep(d); /* expect server to be listening */`.

```go
func TestServer_Listens(t *testing.T) {
    ready := make(chan struct{})
    go func() {
        ln, err := net.Listen("tcp", "127.0.0.1:0")
        if err != nil {
            t.Error(err)
            close(ready)
            return
        }
        // tell test the listener exists
        close(ready)
        // accept loop ...
    }()

    <-ready // blocks until the server has closed `ready`
    // proceed with the test
}
```

Note that the close happens *after* `net.Listen` returns successfully, not before `go func()` is launched. The signal must come from inside the work, not before it. A naive engineer might write `close(ready)` at the start of the goroutine and then `time.Sleep` to "wait for the listener", reintroducing the original bug.

### Single value with buffered channel

When you need to ship a *value* (not just a notification), use a buffered channel of capacity 1 so the sender does not block if the test loses interest:

```go
func TestProducer(t *testing.T) {
    result := make(chan int, 1)
    go func() {
        result <- expensiveCompute()
    }()

    select {
    case v := <-result:
        if v != 42 {
            t.Errorf("got %d, want 42", v)
        }
    case <-time.After(5 * time.Second):
        t.Fatal("compute did not finish within 5s")
    }
}
```

Three points:

- The buffer (`make(chan int, 1)`) means the goroutine does not leak if the test fails before reading.
- `time.After` is *not* the same anti-pattern as `time.Sleep`. It is a **safety timeout**: a backstop so a broken implementation does not hang the test forever. 5 seconds is huge on purpose; in the happy path it never fires.
- The test runs as fast as `expensiveCompute` runs, with a 5-second insurance policy that almost never gets used.

### Multiple values

If the goroutine emits several values, the channel doubles as the notification *and* the result stream:

```go
func TestStream(t *testing.T) {
    ch := make(chan event, 16)
    go func() {
        defer close(ch)
        for _, e := range syntheticEvents {
            ch <- e
        }
    }()

    var got []event
    for e := range ch {
        got = append(got, e)
    }

    if !reflect.DeepEqual(got, syntheticEvents) {
        t.Errorf("got %v, want %v", got, syntheticEvents)
    }
}
```

The `for e := range ch` loop exits exactly when the producer closes the channel. No sleep, no timeout, no race.

### "Did the goroutine reach point X?"

Sometimes you need to assert that a goroutine has reached a particular intermediate state. The pattern is the same as ready/done but with as many channels as you have checkpoints:

```go
type checkpoints struct {
    started   chan struct{}
    accepted  chan struct{}
    processed chan struct{}
    finished  chan struct{}
}

func runWorker(c checkpoints) {
    close(c.started)
    job := waitForJob()
    close(c.accepted)
    process(job)
    close(c.processed)
    cleanup()
    close(c.finished)
}
```

Each phase is observable from a test:

```go
func TestWorker_Phases(t *testing.T) {
    c := checkpoints{
        started:   make(chan struct{}),
        accepted:  make(chan struct{}),
        processed: make(chan struct{}),
        finished:  make(chan struct{}),
    }
    go runWorker(c)

    <-c.started
    submitJob()
    <-c.accepted
    // observe intermediate state
    <-c.processed
    // observe near-final state
    <-c.finished
    // assert end state
}
```

This is verbose, but it is *correct*. A test that sleeps between phases is wrong; a test that synchronises on real events is right. Make peace with the line count.

### Time-bounded waits

Inside tests, every blocking channel receive should be wrapped in a `select` with a generous safety timeout. Otherwise a hung implementation hangs your CI run for 10 minutes until the per-test deadline fires.

A small helper makes this readable:

```go
func recvOr(t *testing.T, ch <-chan struct{}, timeout time.Duration, what string) {
    t.Helper()
    select {
    case <-ch:
    case <-time.After(timeout):
        t.Fatalf("timed out waiting for %s after %s", what, timeout)
    }
}

// usage
recvOr(t, c.started, 5*time.Second, "worker to start")
```

5 seconds is a *test-budget* number, not a *production-latency* number. If the operation should take 2ms in the happy path, 5s is 2500× margin and the test never feels it.

---

## `context.Context`: Coordinating Cancellation And Deadlines

Cancellation is the other side of the same coin: instead of "tell me when you are done" it is "tell yourself when to stop". A test that does `go work(); time.Sleep(d); /* and now stop */` is using sleep as a deadline; the right primitive is `context`.

### Cancelling a goroutine

```go
func TestWorker_CancelsCleanly(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan struct{})

    go func() {
        defer close(done)
        worker(ctx)
    }()

    // ... drive the test ...

    cancel()

    select {
    case <-done:
    case <-time.After(2 * time.Second):
        t.Fatal("worker did not exit after cancel")
    }
}
```

`worker(ctx)` is required to honour `ctx.Done()` and return promptly. The test asserts that the worker actually does so; if it does not, the safety timeout fires and the test fails with a clear message.

### Replacing sleep-based timeouts

Before — sleep as a cancellation timer:

```go
func TestRunner_StopsAfter(t *testing.T) {
    r := NewRunner()
    go r.Run()

    time.Sleep(100 * time.Millisecond)
    r.Stop()
    time.Sleep(50 * time.Millisecond)

    if r.IsRunning() {
        t.Error("runner still running after stop")
    }
}
```

After — context with explicit deadline:

```go
func TestRunner_StopsAfter(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    r := NewRunner()
    done := make(chan struct{})
    go func() {
        defer close(done)
        r.Run(ctx)
    }()

    cancel()
    select {
    case <-done:
    case <-time.After(2 * time.Second):
        t.Fatal("runner did not stop after cancel")
    }

    if r.IsRunning() {
        t.Error("runner still running after stop")
    }
}
```

The shape is identical to the previous pattern; the difference is conceptual. `cancel()` is an explicit "stop now" signal, not a "approximately stop sometime in the next 50ms" hope.

### Deadlines vs timeouts

If your production code uses `context.WithTimeout(ctx, d)`, your test does not have to use the same duration. Use a short timeout in tests (e.g. 100ms) so the deadline path is exercised quickly, but pair it with a fake clock or `synctest` so the test does not actually wait 100ms of wall-clock time. We cover both below.

---

## `sync.Cond`: Waiting For Predicates Under A Mutex

`sync.Cond` is the textbook tool for "wait until some predicate becomes true under a lock". A surprising number of `time.Sleep` calls in production code are masking a missing `Cond`.

### The shape

```go
type bounded struct {
    mu      sync.Mutex
    notFull *sync.Cond
    notEmpty *sync.Cond
    buf     []item
    cap     int
}

func newBounded(cap int) *bounded {
    b := &bounded{cap: cap}
    b.notFull = sync.NewCond(&b.mu)
    b.notEmpty = sync.NewCond(&b.mu)
    return b
}

func (b *bounded) Push(x item) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for len(b.buf) == b.cap {
        b.notFull.Wait()
    }
    b.buf = append(b.buf, x)
    b.notEmpty.Signal()
}

func (b *bounded) Pop() item {
    b.mu.Lock()
    defer b.mu.Unlock()
    for len(b.buf) == 0 {
        b.notEmpty.Wait()
    }
    x := b.buf[0]
    b.buf = b.buf[1:]
    b.notFull.Signal()
    return x
}
```

Why a `for` loop and not `if`? Because `Wait` can spuriously wake up, and even when it does not, by the time the waiter reacquires the lock the predicate may have flipped again (another consumer beat you to the only item). Always **re-check the predicate in a loop**. The Go documentation states this explicitly.

### The wrong way: spin with sleep

The anti-pattern that `sync.Cond` cures is "poll the predicate, sleep, repeat":

```go
// wrong
func (b *bounded) Pop() item {
    for {
        b.mu.Lock()
        if len(b.buf) > 0 {
            x := b.buf[0]
            b.buf = b.buf[1:]
            b.mu.Unlock()
            return x
        }
        b.mu.Unlock()
        time.Sleep(time.Millisecond) // hope something arrives
    }
}
```

This works in the sense that the program does not deadlock, but it burns CPU on a tight 1ms cycle, and adds latency to every pop: even if a producer sends a microsecond after you started sleeping, you still wait the full millisecond. `sync.Cond` removes both costs: the consumer parks until a producer explicitly signals, and wakes up immediately when the signal arrives.

### Should you prefer channels?

In most Go code, yes. A buffered channel is a `Cond`-protected bounded queue with friendlier semantics:

```go
ch := make(chan item, capacity)
// producer:
ch <- x
// consumer:
x := <-ch
```

Use `sync.Cond` when:

- The predicate is more complex than "the queue has space" / "the queue has an item" (e.g. "the queue has at least *k* items").
- You need to broadcast to many waiters at once (`cond.Broadcast`) and start them running in parallel.
- You are implementing a primitive that is itself going to be wrapped by channel-like users.

Otherwise reach for a channel. We discuss `Cond` here because removing `time.Sleep` polling from legacy code is a frequent middle-level task.

---

## `errgroup`: Structured Concurrency With Errors

`golang.org/x/sync/errgroup` is `WaitGroup + first error + context cancellation`. It is the idiomatic top-level coordinator for "run N things, fail the whole thing if any one fails".

### Basic shape

```go
import "golang.org/x/sync/errgroup"

func fetchAll(ctx context.Context, urls []string) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, u := range urls {
        u := u
        g.Go(func() error {
            return fetch(ctx, u)
        })
    }
    return g.Wait()
}
```

`g.Wait()` returns the first non-nil error. The context passed to each `fetch` is cancelled as soon as any one returns an error, which causes the rest to bail early. There is no `time.Sleep` anywhere, and there does not need to be.

### Replacing sleep-based fan-out tests

Before:

```go
func TestParallelDownloads(t *testing.T) {
    for _, u := range testURLs {
        u := u
        go download(u)
    }
    time.Sleep(2 * time.Second) // hope they all finish
    assertAllDownloaded(t)
}
```

After:

```go
func TestParallelDownloads(t *testing.T) {
    g, ctx := errgroup.WithContext(context.Background())
    for _, u := range testURLs {
        u := u
        g.Go(func() error {
            return download(ctx, u)
        })
    }
    if err := g.Wait(); err != nil {
        t.Fatal(err)
    }
    assertAllDownloaded(t)
}
```

`g.Wait` blocks for exactly the duration of the slowest download, and the test sees a real error rather than a delayed false positive.

### Concurrency limits

Recent versions of `errgroup` accept `g.SetLimit(n)` to cap parallel goroutines. Use it when fan-out can be unbounded (e.g. one task per row in a 10M-row file): you keep structured-concurrency semantics without exhausting connections or memory.

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, row := range rows {
    row := row
    g.Go(func() error { return process(ctx, row) })
}
return g.Wait()
```

`g.Go` blocks when the limit is reached, which is exactly the semantics you want — no sleep, no semaphore boilerplate.

---

## Polling Helpers: When You Really Cannot Subscribe

Occasionally you have to interact with a system you do not own that exposes no event hook. The only observable is "call this function, get the current state". In those cases poll, but poll *correctly*.

### `testify/assert.Eventually`

```go
import "github.com/stretchr/testify/assert"

assert.Eventually(t, func() bool {
    return service.ConnectedClients() == 3
}, 5*time.Second, 10*time.Millisecond)
```

Reads as "this predicate must become true within 5 seconds; I will check every 10 milliseconds." On a fast path the predicate becomes true on the first or second check and the call returns in microseconds. On a slow path the call waits up to 5 seconds and only then fails. This is the *correct* shape of "poll with a timeout": short interval, long total budget.

### A standalone version

Without testify:

```go
func waitFor(t *testing.T, total, step time.Duration, what string, cond func() bool) {
    t.Helper()
    deadline := time.Now().Add(total)
    for time.Now().Before(deadline) {
        if cond() {
            return
        }
        time.Sleep(step)
    }
    t.Fatalf("timed out after %s waiting for %s", total, what)
}
```

Yes, this contains `time.Sleep`. The sleep here is *bounded* (10ms) and is the *minimum* polling interval, not a guess about how long the work takes. Crucially, the function returns as soon as the predicate is true; the sleep is the slack, not the total.

### When polling is a smell

If you can replace the polling with a callback, do so. If you can replace it with a fake clock and a deterministic `synctest`, do so. Polling helpers are the **last resort**, kept for third-party APIs that genuinely offer no other observable.

---

## Fake Clocks And `clockwork`

For code whose correctness depends on time itself — retry backoff, expiration, deadlines, rate limiters — sleeping in tests is doubly wrong: it is racy *and* it is slow. The cure is to inject a fake clock.

### Injecting a clock interface

```go
type Clock interface {
    Now() time.Time
    Sleep(time.Duration)
    After(time.Duration) <-chan time.Time
    NewTicker(time.Duration) *Ticker
}

type realClock struct{}
func (realClock) Now() time.Time                  { return time.Now() }
func (realClock) Sleep(d time.Duration)           { time.Sleep(d) }
func (realClock) After(d time.Duration) <-chan time.Time { return time.After(d) }
func (realClock) NewTicker(d time.Duration) *Ticker     { return &Ticker{C: time.NewTicker(d).C, _: ...} }
```

Production code accepts a `Clock`. Tests pass in a fake one whose virtual time advances only when the test wants it to.

### `clockwork` library

`github.com/jonboulle/clockwork` provides a battle-tested fake clock with this interface. A test looks like:

```go
import "github.com/jonboulle/clockwork"

func TestRetry_Backoff(t *testing.T) {
    clk := clockwork.NewFakeClock()
    r := NewRetrier(clk, 3, time.Second, time.Minute)

    var attempts int
    var lastTime time.Time
    err := r.Do(func() error {
        attempts++
        lastTime = clk.Now()
        return errors.New("transient")
    })

    // first attempt at t=0; next at t=1s; next at t=2s; then it gives up.
    clk.Advance(1 * time.Second)
    clk.Advance(2 * time.Second)

    if err == nil {
        t.Fatal("expected error after retries exhausted")
    }
    if attempts != 3 {
        t.Errorf("got %d attempts, want 3", attempts)
    }
}
```

The whole test takes microseconds because no real time elapses; `clk.Advance` makes virtual time jump forward, triggering any timers that should have fired.

### Wiring fake clocks into a retry library

The production retry function should look like:

```go
type Retrier struct {
    clk      clockwork.Clock
    max      int
    base, cap time.Duration
}

func (r *Retrier) Do(op func() error) error {
    var lastErr error
    for i := 0; i < r.max; i++ {
        if err := op(); err == nil {
            return nil
        } else {
            lastErr = err
        }
        if i+1 == r.max {
            break
        }
        delay := backoff(r.base, r.cap, i)
        select {
        case <-r.clk.After(delay):
        }
    }
    return lastErr
}
```

The `select { case <-r.clk.After(delay): }` is what makes the function testable. When `clk` is a real clock, the goroutine sleeps in the real scheduler. When `clk` is a fake clock, the goroutine parks until the test advances virtual time.

### Common mistakes with fake clocks

- **Calling `time.Now()` directly inside production code.** Once you decide to use a clock interface, all time accesses must go through it. A single direct `time.Now()` call leaks reality into the test and brings the flakiness back.
- **Forgetting to advance the clock.** A `clk.After(d)` channel only fires when virtual time crosses `d`. If the test does not call `clk.Advance`, the channel never fires and the test deadlocks (or hits its safety timeout).
- **Advancing too far.** Some fake clocks fire timers eagerly when advanced past their fire time. If you advance 10s in one call and three retries should each have happened, you may get one combined fire instead. Use small advances or your library's "advance to next timer" helper.

---

## `testing/synctest` In Anger

Go 1.24 introduced `testing/synctest`, which runs a function in a *bubble* where the global clock is virtual and the runtime can detect when every goroutine in the bubble is blocked (called *durably blocked*). It is the closest Go has come to a built-in deterministic time-travel testing primitive.

### What it gives you

Inside `synctest.Test(t, func(t *testing.T) { ... })`:

- `time.Now()`, `time.Sleep`, `time.After`, `time.NewTimer`, `time.NewTicker` all use the bubble's virtual clock.
- The clock advances automatically to the next timer fire when every goroutine in the bubble is durably blocked.
- `synctest.Wait()` blocks until all goroutines in the bubble are durably blocked, giving you a barrier where you can safely observe state.

### A retry test, the synctest way

```go
import "testing/synctest"

func TestRetry_Backoff_Synctest(t *testing.T) {
    synctest.Test(t, func(t *testing.T) {
        r := NewRetrier(realClock{}, 3, time.Second, time.Minute)
        var attempts int
        start := time.Now()

        err := r.Do(func() error {
            attempts++
            return errors.New("transient")
        })

        if err == nil {
            t.Fatal("expected error")
        }
        if attempts != 3 {
            t.Errorf("attempts = %d, want 3", attempts)
        }
        if elapsed := time.Since(start); elapsed != 3*time.Second {
            t.Errorf("elapsed = %s, want 3s of virtual time", elapsed)
        }
    })
}
```

Notice that the test does *not* inject a fake clock. The `Retrier` calls real `time.Sleep`, but inside the bubble that translates to virtual sleep. The test reads `time.Since(start)` and gets exactly the virtual elapsed time, which it can assert on as a first-class property. You can now write *"the retrier waited exactly 1s before attempt 2 and exactly 2s before attempt 3"* as a deterministic test.

### When to prefer synctest over clockwork

- **synctest** when you can write the test on Go 1.24+ and want to keep production code free of clock injection.
- **clockwork** (or a hand-rolled `Clock` interface) when you need backwards compatibility, or when you want to fake the clock in a *non-test* context (e.g. a simulation harness).
- Either is correct; neither is `time.Sleep`.

### synctest pitfalls

- Goroutines escaping the bubble. If your production code spawns a goroutine that calls into a different package which uses an OS pipe, the read on the pipe is not durably blocked and `synctest` cannot advance time. The test will hang. Keep bubbled tests pure-Go and avoid syscalls.
- Tickers that never stop. `time.Ticker` keeps firing forever inside a bubble; if your code does not call `tk.Stop()`, the bubble never quiesces. Audit ticker usage.
- Calling `runtime.Gosched()` inside a bubble does not advance virtual time. It is a no-op for synctest purposes.

---

## Refactoring Recipes: Before And After

Let us walk through a handful of real refactors at the middle level.

### Recipe 1: pub-sub callback

Before:

```go
func TestBus_Publish(t *testing.T) {
    var got []string
    b := NewBus()
    b.Subscribe("topic", func(m string) {
        got = append(got, m)
    })

    b.Publish("topic", "hello")
    time.Sleep(50 * time.Millisecond)

    if len(got) != 1 || got[0] != "hello" {
        t.Errorf("got = %v, want [hello]", got)
    }
}
```

After:

```go
func TestBus_Publish(t *testing.T) {
    got := make(chan string, 1)
    b := NewBus()
    b.Subscribe("topic", func(m string) {
        got <- m
    })

    b.Publish("topic", "hello")

    select {
    case m := <-got:
        if m != "hello" {
            t.Errorf("got %q, want %q", m, "hello")
        }
    case <-time.After(2 * time.Second):
        t.Fatal("subscriber never received")
    }
}
```

The subscriber callback ships its observation through a buffered channel. The test blocks on that channel rather than guessing at delay.

### Recipe 2: file watcher

Before:

```go
func TestWatcher_FiresOnWrite(t *testing.T) {
    dir := t.TempDir()
    var saw bool
    w := NewWatcher(dir, func(name string) {
        saw = true
    })
    defer w.Close()
    go w.Run()
    time.Sleep(100 * time.Millisecond)

    _ = os.WriteFile(filepath.Join(dir, "a"), []byte("hi"), 0o644)
    time.Sleep(500 * time.Millisecond)

    if !saw {
        t.Error("watcher did not fire")
    }
}
```

After:

```go
func TestWatcher_FiresOnWrite(t *testing.T) {
    dir := t.TempDir()
    events := make(chan string, 8)
    w := NewWatcher(dir, func(name string) { events <- name })
    defer w.Close()

    ready := make(chan struct{})
    go func() {
        w.Run()
        close(ready)
    }()
    w.WaitReady() // expose readiness from the watcher itself

    _ = os.WriteFile(filepath.Join(dir, "a"), []byte("hi"), 0o644)

    select {
    case got := <-events:
        if !strings.HasSuffix(got, "a") {
            t.Errorf("event = %q, want suffix /a", got)
        }
    case <-time.After(5 * time.Second):
        t.Fatal("watcher never reported the write")
    }
}
```

`WaitReady` is a new method on the watcher: it blocks until the `fsnotify` (or other backend) has registered the directory. Exposing it is a small production-code change for a large testability win.

### Recipe 3: rate limiter

Before:

```go
func TestLimiter_AllowsTwoPerSecond(t *testing.T) {
    l := NewLimiter(2, time.Second)

    if !l.Allow() || !l.Allow() {
        t.Fatal("first two should be allowed")
    }
    if l.Allow() {
        t.Fatal("third should be denied")
    }
    time.Sleep(1100 * time.Millisecond) // hope tokens refill
    if !l.Allow() {
        t.Fatal("token should be available after refill")
    }
}
```

After (with a clock interface):

```go
func TestLimiter_AllowsTwoPerSecond(t *testing.T) {
    clk := clockwork.NewFakeClock()
    l := NewLimiter(clk, 2, time.Second)

    if !l.Allow() || !l.Allow() {
        t.Fatal("first two should be allowed")
    }
    if l.Allow() {
        t.Fatal("third should be denied")
    }
    clk.Advance(time.Second + time.Millisecond)
    if !l.Allow() {
        t.Fatal("token should be available after refill")
    }
}
```

Test runtime drops from ~1.1s to microseconds.

### Recipe 4: cache expiration

Before:

```go
func TestCache_Expires(t *testing.T) {
    c := NewCache(100 * time.Millisecond)
    c.Set("k", "v")
    if v, ok := c.Get("k"); !ok || v != "v" {
        t.Fatal("not set")
    }
    time.Sleep(150 * time.Millisecond)
    if _, ok := c.Get("k"); ok {
        t.Fatal("not expired")
    }
}
```

After (with synctest):

```go
func TestCache_Expires(t *testing.T) {
    synctest.Test(t, func(t *testing.T) {
        c := NewCache(100 * time.Millisecond)
        c.Set("k", "v")
        if v, ok := c.Get("k"); !ok || v != "v" {
            t.Fatal("not set")
        }
        time.Sleep(150 * time.Millisecond) // virtual sleep
        if _, ok := c.Get("k"); ok {
            t.Fatal("not expired")
        }
    })
}
```

The body is the same, but inside the bubble the 150ms sleep is virtual.

### Recipe 5: a worker that should not start work until told

Before:

```go
func TestWorker_DoesNotStartEarly(t *testing.T) {
    w := NewWorker()
    go w.Run()
    time.Sleep(100 * time.Millisecond)
    if w.Started() {
        t.Error("worker started before signal")
    }
    w.Start()
    time.Sleep(100 * time.Millisecond)
    if !w.Started() {
        t.Error("worker did not start after signal")
    }
}
```

After:

```go
func TestWorker_DoesNotStartEarly(t *testing.T) {
    w := NewWorker()
    started := make(chan struct{})
    w.OnStart(func() { close(started) })
    go w.Run()

    select {
    case <-started:
        t.Fatal("worker started before signal")
    case <-time.After(50 * time.Millisecond):
        // ok: stayed idle for 50ms
    }

    w.Start()
    select {
    case <-started:
    case <-time.After(2 * time.Second):
        t.Fatal("worker did not start after signal")
    }
}
```

Two asymmetric waits: "stay quiet for 50ms" and "fire within 2s". Both are bounded and explicit. The first is the rare *correct* use of a sleep-like primitive in a test: a *negative* assertion ("X should not happen yet"). We discuss this in the next-but-one section.

---

## Why Tuning The Sleep Never Works

A frequent rationalisation is "the sleep is fine, I just need to pick a longer duration that always works". This is wrong, and the wrongness is structural, not a matter of tuning.

### Argument 1: the duration is a property of the slowest machine, not of your laptop

Your dev laptop finishes the work in 5ms. The CI runner under heavy load might take 200ms. A flaky integration test under contention can take 2 seconds. If you tune the sleep to the worst observed case, you pay that cost on every run, including the 99% of runs that did not need it.

### Argument 2: the slow machine's slowest behaviour is unbounded

Imagine the worst-case CI run today is 2s and you sleep 3s. Tomorrow the same CI runner is rebooted onto noisier hardware, or its kernel is updated to one that has a 10x scheduling jitter on small VMs, or someone adds a noisy neighbour. The test is suddenly flaky again at 3s. You bump to 5s. Repeat indefinitely. There is no fixed point.

### Argument 3: even the *passing* runs lie

A test that passes after `time.Sleep(100 * time.Millisecond)` does not assert "the worker finished". It asserts "the worker had finished by 100ms after the call". The first part is the property you wanted; the second part is irrelevant *and* false in general. Once you accept that the second part can vary while the first is constant, the sleep was never the right assertion.

### Argument 4: tuning destroys the failure signal

If the test eventually does fail because something is broken, you would like the failure to say so loudly. A sleep-based test fails *because the sleep was too short*. The failure message says nothing about the root cause, so when an oncall engineer triages it at 3am they will reach for the wrong tool (bump the sleep) and miss the real bug.

### Counter: "but I just need the test to pass once"

This is the most honest version of the argument and it is still wrong. The cost of a flaky test compounds. You will rerun it. Your colleagues will rerun it. Your CI will retry it. Eventually somebody will mark it skip, and now you have a test that asserts nothing. The work you saved by sleeping for 100ms is paid back ten times over in trust, retries, and skipped coverage.

---

## The Cost Of Flaky Tests

Flaky tests are not free. They have a measurable cost on a team, and `time.Sleep` is the single biggest source of flakiness in Go test suites.

### Direct CI cost

A test that takes 500ms instead of 5ms costs 99x as much CI time. Multiplied across 1000 tests in a package and 50 packages in a repo, that adds up to many minutes per build. Multiplied across builds per day and engineers on the team, you are easily losing an engineer-week per quarter on sleep.

### Retry cost

CI systems frequently retry flaky tests. A 30s test that flakes 5% of the time and retries once on failure averages 31.5s per build (30 + 0.05 * 30) but is also a non-deterministic distribution: 5% of builds take 60s instead of 30s, eating into deadlines.

### Trust cost

Once developers learn that a failure can "just be flakiness", they stop reading failure messages carefully. Real bugs hide in retried failures. A team that retries failures without investigating is one minor refactor away from a production incident that was already failing in CI but was rerun green.

### Cognitive cost

Every time a developer writes `time.Sleep(...)` they have to choose a number. That choice is mental load. Multiplied across a 100-test file, the cumulative load is significant. Deterministic primitives have no such choice — the test is "wait for the event", full stop.

### Reproducibility cost

Sleep-based tests cannot be deterministically reproduced. "It passed on my machine" becomes a permanent fixture of the codebase. Bug reports become hopeless because nobody can rerun the failing case.

---

## When `time.Sleep` Is Genuinely Acceptable

A short list of cases where `time.Sleep` is the right answer. They are all in non-test code paths.

1. **Production polling of an external system that has no callback.** A nightly job that polls "is the AWS export ready?" every 30 seconds is fine. The 30s is a real business choice about load on the upstream API, not a guess about timing.
2. **Rate limiting / throttling.** Sleeping between requests in a script to be polite to an API is fine, though `time.Ticker` or a real rate limiter is often nicer.
3. **Test "negative" assertions: assert that something does **not** happen within a bounded window.** As shown earlier, "wait 50ms, then check that the worker did not start" is acceptable. The sleep is the negative budget, not the positive synchronisation.
4. **Backoff in production code, where the duration is the *whole point*.** A retry loop with exponential backoff sleeps because waiting is what backoff means.
5. **Demos and one-off scripts.** A demo that wants to look slow and dramatic in a screencast can sleep.

For everything else: not in production code (use a ticker / timer / rate limiter / channel), and never in tests as a positive synchronisation tool.

### Negative assertions: how to write them well

```go
select {
case <-events:
    t.Fatal("event fired before it should have")
case <-time.After(50 * time.Millisecond):
    // expected: no event within 50ms
}
```

50ms here is a *test budget*: how long you are willing to spend proving the negative. It does not have to be tuned for the slow machine because the *failure* condition (the channel firing) is fast and deterministic; only the success path (no fire) waits.

Even so, a deterministic alternative inside `synctest` is preferred when available:

```go
synctest.Test(t, func(t *testing.T) {
    // ... setup ...
    time.Sleep(50 * time.Millisecond) // virtual; instant in wall clock
    synctest.Wait()
    select {
    case <-events:
        t.Fatal("event fired")
    default:
        // ok
    }
})
```

The `synctest.Wait()` ensures all goroutines are durably blocked before you peek at the channel, so there is no race between "test checks" and "event fires later".

---

## Designing Production Code That Is Easy To Test

The middle-level realisation is that **untestable code is a design smell, not a fixed property of the world**. If your test has to `time.Sleep` because the production code exposes no events, the production code is the bug.

### Expose readiness

Long-running services should have a `Ready()` channel or `WaitReady()` method that closes/returns when the service is in a steady state. Production callers ignore it; tests use it.

```go
type Server struct {
    ready chan struct{}
}

func (s *Server) Run() error {
    ln, err := net.Listen("tcp", s.addr)
    if err != nil {
        close(s.ready) // close even on error so waiters unblock
        return err
    }
    close(s.ready)
    return s.serve(ln)
}

func (s *Server) WaitReady() { <-s.ready }
```

### Accept a clock

Code that reads time should accept a `Clock` (or take advantage of `synctest`). Avoid `time.Now()` and `time.Sleep` calls inside business logic; they pull reality into the unit-under-test and prevent fast deterministic tests.

### Use channels for observability

If something happens to your service that an external observer might want to assert on, expose it as a channel. Production callers don't have to read it; tests can.

```go
type Cache struct {
    evictions chan string // unbuffered; readers must drain or block writers
}

func (c *Cache) Evictions() <-chan string { return c.evictions }
```

(Be careful: an unbuffered channel that nobody reads can block the producer indefinitely. A small buffer and a "drop if full" pattern is often safer in production.)

### Make goroutine shutdown observable

Every long-running goroutine should provide a way to say "I have exited cleanly". Either a `Done()` method returning a `<-chan struct{}`, or accept a `WaitGroup`, or expose a `Stopped()` channel. Tests rely on this to assert that cancellation works.

```go
type Worker struct {
    done chan struct{}
}

func (w *Worker) Done() <-chan struct{} { return w.done }

func (w *Worker) Run(ctx context.Context) {
    defer close(w.done)
    // ...
}
```

---

## Detecting The Anti-Pattern In Code Review

When you are reviewing a Go diff, every `time.Sleep(` is a red flag. Run through this checklist:

1. **Is it in a test file (`_test.go`)?** If yes, very strong presumption it is the anti-pattern. Ask: "What event are you waiting for?" The author almost always has an answer; you can then point them at the right primitive.
2. **Is it in production code?** Ask: "Why this duration? What changes if it is 10x bigger or smaller?" Acceptable answers: "It is the configured polling interval / backoff base / throttle delay". Unacceptable: "I dunno, seemed about right."
3. **Is it inside a retry loop?** If yes, the duration should be configurable, jittered, and ideally driven by a `Clock` so it is testable.
4. **Is it inside a `for` loop without other blocking operations?** Probably a poll-and-sleep. Ask: "Can the producer notify instead? Can this be a `sync.Cond` or a channel receive?"
5. **Is it right before an assertion?** Almost certainly a sleep-for-sync. Refactor.
6. **Is the duration a "round" number like 100ms / 500ms / 1s?** Suspect a guess.

A useful code-review comment template:

> This `time.Sleep` synchronises on wall-clock time rather than on the event you actually care about (which I think is `XYZ`). Suggest replacing with `<channel/WaitGroup/synctest>` so the test is deterministic and fast.

---

## Linting And Static Analysis

`time.Sleep` is hard to ban categorically because it has legitimate uses. But you can flag it in test files automatically.

### `go vet` and `staticcheck`

Neither flags `time.Sleep` directly, but `staticcheck` rules SA1006 and SA1015 catch related anti-patterns (`time.Tick` leaking, etc.). Run `staticcheck` in CI.

### A custom check

```go
// not real golangci-lint syntax, sketch:
import "github.com/quasilyte/go-ruleguard/dsl"

func banSleepInTests(m dsl.Matcher) {
    m.Match(`time.Sleep($_)`).
        Where(m.File().Name.Matches(`_test\.go$`)).
        Report("time.Sleep in tests is almost always wrong; use a channel, WaitGroup, or synctest")
}
```

A `go-ruleguard` rule like the above flags every `time.Sleep` in `_test.go` files. False positives (negative assertions, deliberate throttle in flaky-by-nature integration tests) are reviewed and either fixed or suppressed with a `// nolint` comment that documents *why*.

### Code-search hygiene

Run periodically:

```
git grep -nE 'time\.Sleep\(' '*_test.go'
```

Treat the count as a debt metric. Lower it.

---

## Edge Cases And Pitfalls

### Edge case: `time.Sleep(0)`

`time.Sleep(0)` is a no-op, but historically Go used to yield the goroutine. Some legacy code uses `time.Sleep(0)` as a "yield" — replace with `runtime.Gosched()` or, ideally, with a proper synchronisation primitive.

### Edge case: very small sleeps (`time.Sleep(time.Microsecond)`)

These sleep at least one OS-scheduler tick, which on Linux is typically 1-15ms. A "1 microsecond sleep" is a 1+ ms sleep in practice. If you need true microsecond resolution, you cannot have it with `time.Sleep`; use a spin loop with `runtime.Gosched()` (rare).

### Edge case: clock skew with `time.Now()` and `time.Since()`

Go's `time.Time` carries a monotonic clock reading by default, so `time.Since(start)` is immune to wall-clock jumps. But if you strip the monotonic reading (with `t.Round(0)`) or pass times in/out of marshalling, the monotonic part is gone and now your "elapsed" can be negative when the system clock jumps backwards.

### Pitfall: sleeping under a mutex

```go
mu.Lock()
time.Sleep(d)
mu.Unlock()
```

is a way to make every other goroutine wait `d` more. Sometimes intentional, usually a bug. Never sleep under a lock unless you are very sure.

### Pitfall: sleeping after defer

```go
defer mu.Unlock()
mu.Lock()
time.Sleep(d)
// other work
```

The sleep is still under the lock; `defer` runs at *function return*, not at the statement.

### Pitfall: cancellation that does not cancel sleep

`time.Sleep(d)` ignores context. If you write:

```go
go func() {
    for {
        select {
        case <-ctx.Done():
            return
        default:
        }
        time.Sleep(time.Second)
        doWork()
    }
}()
```

then cancelling `ctx` does not interrupt the sleep — the goroutine sleeps a full second before noticing. The fix is to make the wait itself cancellable:

```go
select {
case <-ctx.Done():
    return
case <-time.After(time.Second):
}
doWork()
```

Or, on Go 1.23+, use `context.AfterFunc` for a cleaner pattern.

### Pitfall: forgotten timer leaks

```go
for {
    select {
    case <-time.After(time.Second):
        // ...
    case <-ctx.Done():
        return
    }
}
```

Each `time.After` allocates a new timer. When `ctx.Done()` wins, the timer is not stopped and leaks until it fires. In a long-lived loop this leaks. Use `time.NewTimer` + `t.Stop` + `t.Reset` for repeated waits.

### Pitfall: `time.Sleep` and `runtime.LockOSThread`

If your goroutine is locked to an OS thread (e.g. CGo with OpenGL), a sleep parks the thread, not just the goroutine. Other goroutines that need the thread cannot run on it. Avoid sleep in locked goroutines.

---

## Common Mistakes

1. **Adding `time.Sleep` "just to be safe" around a fix.** The sleep is not safe; it is silently flaky. If the underlying race is fixed, the sleep is unnecessary; if it is not fixed, the sleep is a coverup.
2. **Refactoring sleep to `time.After` and calling it deterministic.** `time.After` is a timer that fires after a real duration. Replacing `time.Sleep(d)` with `<-time.After(d)` changes nothing about determinism.
3. **Using `runtime.Gosched()` as a "lighter" sleep.** `Gosched` yields the goroutine but does not wait for any event. It can spin a CPU for milliseconds without making progress on the predicate you care about.
4. **Polling without a backoff.** A poll loop that calls `cond()` every 0 nanoseconds is a CPU-burning spin. If you must poll, use `time.Sleep(1 * time.Millisecond)` between checks and a budget for total wait.
5. **Polling with a too-long interval.** Polling every second when the work usually completes in 1ms means the test takes 1s. Choose the polling interval to be ~1% of the budget.
6. **Mixing real and fake clocks.** If part of the production code under test uses `time.Now()` directly and part uses an injected clock, only one half is testable. Pick one approach and apply it consistently.
7. **Forgetting to wrap goroutine lifetimes with `WaitGroup`/`errgroup`.** A test that spawns goroutines and does not wait for them might pass while goroutines are still running, leaving them to leak into the next test and produce mysterious failures there.
8. **Calling `wg.Add(1)` inside the goroutine.** As discussed, this is a race; always call `Add` in the caller.
9. **Re-using a `WaitGroup` after `Wait` returns.** The internal counter is in a delicate state. Allocate a new one for the next phase.
10. **Misusing `time.Tick`.** `time.Tick` returns a channel that ticks forever and cannot be stopped, leaking the underlying timer. Use `time.NewTicker` and call `Stop()` in production code.

---

## Common Misconceptions

- **"Sleep is fine because my work is bounded."** Your work might be bounded on your laptop. On a contended CI runner it is not.
- **"100ms is so much longer than the work; it cannot fail."** It can. GC pauses, page faults, kernel scheduling delays, and noisy neighbours regularly push goroutine wakeup latency past 100ms on shared infrastructure.
- **"`time.Sleep` blocks the OS thread."** It blocks the goroutine only; the runtime parks the goroutine and reuses the thread for others.
- **"`synctest` is just a fake clock."** It is more: it understands when goroutines are durably blocked and automatically advances virtual time.
- **"If I use `-race` I catch all sleep-related issues."** The race detector catches data races, not flakiness. A sleep-based test that races between "did the goroutine start" and "is it done" might be perfectly race-free but still flaky.
- **"`time.Sleep` is bad in production too."** Not always. Backoff, throttle, polling intervals are all legitimate sleeps in production code. The anti-pattern is *sleep-as-synchronisation*, which is mostly a test phenomenon.

---

## Test

Try writing the following from memory (no compiler).

1. A test for a worker pool of size 4 that processes 1000 tasks. The test must finish in under 10ms of test runtime and assert that all tasks ran exactly once.
2. A test that asserts a `Cache.Set("k", "v")` followed by `Cache.Get("k")` after 100ms returns nothing, using `synctest` (no real wall-clock sleep).
3. A test that asserts a goroutine exits within 100ms after `cancel()` is called on its context, with a 2-second safety timeout.
4. A test that asserts a retry library performs exactly 3 attempts with exponential backoff (1s, 2s, 4s), using `clockwork`.
5. A negative-assertion test: a worker that is told `Pause()` should not consume from its queue for at least 100ms. Write it with `synctest`.

Each test should:

- Run in deterministic time.
- Pass `-race` cleanly.
- Have no `time.Sleep` outside the `synctest` bubble or a bounded polling helper.

---

## Tricky Questions

1. **"My test has a `time.Sleep(0)`. Surely that is harmless?"**
   It is a no-op or a minimal yield. Replace with `runtime.Gosched()` if you actually need to yield, or remove entirely if it does nothing.

2. **"I cannot get rid of the last `time.Sleep` because the third-party library spawns goroutines internally and exposes no synchronisation."**
   Wrap the library. Have the wrapper expose a `Ready` channel and a `Wait()`. If the library truly cannot be made deterministic, isolate it behind a polling helper with a tight interval and a long budget — not a single fixed sleep.

3. **"`testing/synctest` is unavailable because we are on Go 1.22. What do I do?"**
   Inject a `Clock` interface or use `clockwork`. The pattern is the same; only the mechanism differs.

4. **"My test uses `time.Sleep(10 * time.Millisecond)` to let the scheduler run a goroutine. Is that ok?"**
   No. Use a channel notification or `synctest.Wait()`. "Letting the scheduler run" is not a property tests can rely on; the runtime can pause for 100ms under load and your 10ms is wishful thinking.

5. **"I write rate-limited code that should make at most 2 requests per second. How do I test it without real time?"**
   Inject a `Clock`. The limiter consults `clk.Now()` and your test advances `clk` and asserts that requests issued after the advance are allowed.

6. **"What if my goroutine uses `time.After` in a `select`? Will synctest handle it?"**
   Yes. Inside a synctest bubble, `time.After` consults the bubble's virtual clock, and the bubble will advance the clock to the next timer fire when every goroutine is durably blocked.

7. **"I have a test that sleeps to wait for a Kubernetes pod to become ready. There is no notification API. What now?"**
   Polling helper with a sane interval (1 second) and a generous budget (60 seconds), or a watch on the Kubernetes API. Never a single fixed sleep.

8. **"Is `time.Sleep` an allocation hot spot?"**
   The runtime allocates a small timer per sleep. In hot paths this matters. Use `time.NewTimer` + `Reset` to reuse, or restructure to avoid sleeping in hot paths.

---

## Cheat Sheet

| Situation | Replacement |
| --- | --- |
| Wait for one goroutine to finish | `WaitGroup` (or `WaitGroup.Go` in Go 1.25+) |
| Wait for many goroutines, no error needed | `WaitGroup` |
| Wait for many goroutines, propagate first error | `errgroup` |
| Wait for a single event (e.g. "ready") | close a `chan struct{}` |
| Wait for a value from one producer | buffered `chan T` of cap 1 |
| Wait for a value from many producers | unbuffered `chan T`, drain on consumer |
| Cancel goroutine on test cleanup | `context.WithCancel` + `defer cancel()` |
| Test code that depends on time | inject a `Clock` (clockwork) or use `testing/synctest` |
| Wait for a third-party with no API | `require.Eventually` (small interval, large budget) |
| Negative assertion: "X should not fire" | `select { case <-x: fail; case <-time.After(d): }` |
| Wait until queue has K items | `sync.Cond` with `for predicate { c.Wait() }` |

Compact rules:

- Never `time.Sleep` to synchronise.
- Always pair a blocking receive with a safety timeout.
- Always pair a goroutine with a way to wait for its exit.
- Always pair a clock-dependent function with an injected `Clock` or a synctest bubble.
- Always pair a `time.NewTimer` / `NewTicker` with a `Stop()` in `defer`.

---

## Self-Assessment Checklist

After this file you should be able to do all of the following without hesitation:

- [ ] Take a `go work(); time.Sleep(d); assert` test and refactor to `WaitGroup`-based join in under a minute.
- [ ] Take a test that sleeps to wait for a callback and refactor to a buffered-channel observer.
- [ ] Replace a sleep-driven cache expiration test with a `synctest`-based version.
- [ ] Inject a `clockwork.Clock` into a retry helper and write a sub-millisecond test that exercises three retries.
- [ ] Write a test that asserts "the worker has not started yet" using a select with a bounded timeout, not a fixed sleep.
- [ ] Recognise and flag every `time.Sleep` in a code review and suggest the right replacement.
- [ ] Name the four reasons "tuning the sleep" is structurally wrong, not merely inconvenient.
- [ ] Articulate the small list of cases where `time.Sleep` is acceptable in production code.

If any of these is shaky, return to the relevant section.

---

## Summary

`time.Sleep` is never the right answer to "how do I wait for the goroutine to finish?". The right answers are a small, named, well-understood set: `WaitGroup`, channels, `context`, `Cond`, `errgroup`, polling helpers, fake clocks, `synctest`. Each is the *unique* correct answer to a specific question:

- "When are all goroutines done?" → `WaitGroup` / `errgroup`.
- "Has a specific event happened?" → channel receive.
- "Stop running now" → `context` cancel.
- "Predicate became true under a lock" → `Cond`.
- "Did this happen within a window?" → `select` with `time.After` (safety timeout, not synchronisation).
- "Did this happen at the right *virtual* time?" → fake clock or `synctest`.
- "Third-party API has no event hook" → `Eventually`/polling helper.

A test suite that contains no `time.Sleep` (outside polling helpers and `synctest` bubbles) runs faster, fails more honestly, and resists tuning-treadmill. Aim for zero. Treat any sleep that creeps in as debt to repay.

At the senior level we will look at the architectural consequences of this discipline: how observable quiescence falls out of well-structured concurrency, how to roll out the discipline across a team, how to eradicate the pattern from a 100K-LOC legacy codebase, and how to design APIs that resist re-introduction.

---

## Further Reading

- `testing/synctest` package documentation (Go 1.24+).
- `golang.org/x/sync/errgroup` package documentation.
- `github.com/jonboulle/clockwork` — fake clock implementation widely used in Go.
- "The Go Memory Model" — for understanding why `WaitGroup.Wait` establishes happens-before.
- Russ Cox, "Notes on Concurrency" — particularly the section on observable quiescence.
- Bryan Mills, "Rethinking Classical Concurrency Patterns" — GopherCon talk that takes apart many anti-patterns including sleep-for-sync.
- `cmd/vet` and `staticcheck` documentation for static checks you can run today.
- The neighboring subsection `07-sync-package/05-cond/` for a deep dive on `sync.Cond`.
- The neighboring subsection `06-context-package/02-cancellation/` for context-driven shutdown.
- The neighboring subsection `12-testing-concurrent-code/` for the broader testing methodology.
