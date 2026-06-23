# Mocking Time — Junior Level

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
> Focus: "Why does my cache-expiry test take 30 seconds, and how do I make it take 30 microseconds?"

You have written a TTL cache. The entries expire after 5 minutes. You want a test that proves an entry expires correctly. The naive version looks like this:

```go
func TestCacheExpires(t *testing.T) {
    c := NewCache(5 * time.Minute)
    c.Set("k", "v")
    time.Sleep(5*time.Minute + time.Second) // wait it out
    if _, ok := c.Get("k"); ok {
        t.Fatal("entry should be gone")
    }
}
```

The test works. It is also useless. Nobody runs a 5-minute test in CI, and you cannot run the suite locally without going to lunch. Worse, if you shorten the TTL to one second so the test finishes fast, you have changed the thing you are testing — you no longer know whether the *real* 5-minute TTL works.

The clean fix is to take `time.Now`, `time.Sleep`, `time.After`, `time.Tick`, and `time.AfterFunc` out of the cache's hands and replace them with a tiny abstraction called a **clock**. Production wires in a real clock that calls into the standard library. Tests wire in a fake clock that you control: `clock.Advance(5 * time.Minute)` does in a nanosecond what `time.Sleep(5 * time.Minute)` does in five minutes.

After reading this file you will:

- Know why time is a dependency, not a constant of nature
- Define a `Clock` interface and implement both production and fake versions
- Write your first test with `github.com/jonboulle/clockwork`
- Know the difference between `Advance`, `BlockUntil`, and `AfterFunc` on a fake clock
- Recognise the three families: hand-rolled, `clockwork`, `benbjohnson/clock`, and Go 1.24's `testing/synctest`
- Avoid the two beginner traps: missing `Advance` calls, and code paths that still read `time.Now` behind your back
- Be ready to test a TTL cache, a retry loop, and a token-bucket limiter in zero wall time

You do not need to know about `synctest` bubbles, scheduler internals, or how to build your own fake clock yet. Those come at the middle, senior, and professional levels. This file is about taking your first test from "30 seconds and flaky" to "1 millisecond and deterministic."

---

## Prerequisites

- **Required:** Go 1.21 or newer. Many examples work on older versions; the `testing/synctest` parts need Go 1.24+.
- **Required:** Familiarity with the standard `time` package: `time.Now`, `time.Sleep`, `time.After`, `time.Tick`, `time.AfterFunc`, `time.Duration`.
- **Required:** Comfort writing a basic Go test with `*testing.T`.
- **Helpful:** Some exposure to interfaces and dependency injection — you do not need to be expert at either; this file uses both at their simplest.
- **Helpful:** Experience writing one flaky concurrent test in your career. The motivation lands harder when you have lost a Friday to one.

If you can write `func TestX(t *testing.T)` and define an interface with one method, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Clock** | A small abstraction with methods like `Now`, `Sleep`, `After`, `NewTimer`, `NewTicker`, `AfterFunc`. Production uses a real implementation; tests use a fake. |
| **Real clock** | A `Clock` implementation that delegates every method to the `time` package. Behaves identically to using `time` directly. |
| **Fake clock** | A `Clock` implementation whose time only moves when the test calls `Advance(d)`. Returns immediately from sleeps when the deadline has passed in fake time. |
| **`Advance(d)`** | Move the fake clock forward by `d`, firing any timers and tickers that were waiting at or before the new time. |
| **`BlockUntil(n)`** | On a fake clock, wait until at least `n` goroutines are blocked on a sleep, timer, or ticker. Used to avoid `Advance` races. |
| **`clockwork`** | The `github.com/jonboulle/clockwork` library. Most widely used fake clock; small, mature API. |
| **`benbjohnson/clock`** | The `github.com/benbjohnson/clock` library. The other established choice; similar to `clockwork` with a few API differences. |
| **`testing/synctest`** | A Go 1.24+ standard-library package that runs a goroutine inside a "bubble" with fake time, no library required. |
| **Wall time** | Real time as observed outside the test. The thing your tests must not depend on. |
| **Fake time** | Time inside the test, controlled by the test. Advances only when you say so. |
| **Monotonic clock** | The Go runtime tracks an unaffected-by-NTP counter on `time.Time` values. Most clocks expose only the wall portion. |
| **Quiescent** | The state where every goroutine is blocked, waiting, or done. Used by `synctest` to decide when it is safe to advance time. |
| **Timer leak** | A `time.Timer` or `time.AfterFunc` callback that fires after the test ends, often into a closed channel. |

---

## Core Concepts

### Time is a dependency

Most code reads time through the standard library:

```go
expiry := time.Now().Add(5 * time.Minute)
// ...
if time.Now().After(expiry) { evict() }
```

Functionally, this is the same as calling out to an external service. The function's behaviour depends on a value it did not receive as an argument. That makes the function hard to test, just like calling `http.Get` would.

The remedy is to inject the dependency:

```go
type Clock interface {
    Now() time.Time
}

func IsExpired(c Clock, deadline time.Time) bool {
    return c.Now().After(deadline)
}
```

Now `IsExpired` is a pure function of its arguments. In production you pass a real clock that returns `time.Now()`. In tests you pass a fake clock and set its time directly.

### A minimum useful Clock interface

For most code, this is enough:

```go
type Clock interface {
    Now() time.Time
    Sleep(d time.Duration)
    After(d time.Duration) <-chan time.Time
    NewTimer(d time.Duration) Timer
    NewTicker(d time.Duration) Ticker
    AfterFunc(d time.Duration, f func()) Timer
}

type Timer interface {
    Chan() <-chan time.Time
    Stop() bool
    Reset(d time.Duration) bool
}

type Ticker interface {
    Chan() <-chan time.Time
    Stop()
    Reset(d time.Duration)
}
```

You do not have to handwrite this. `clockwork` and `benbjohnson/clock` both export interfaces that look almost exactly like this. Most projects import one of them.

### Two implementations: real and fake

The real implementation is one-line wrappers:

```go
type realClock struct{}

func (realClock) Now() time.Time                              { return time.Now() }
func (realClock) Sleep(d time.Duration)                       { time.Sleep(d) }
func (realClock) After(d time.Duration) <-chan time.Time      { return time.After(d) }
// ... and so on
```

The fake keeps an internal "current time" and a list of pending wakeups:

```go
type fakeClock struct {
    mu       sync.Mutex
    now      time.Time
    sleepers []*sleeper // each one wants to wake at a specific time
}

func (c *fakeClock) Advance(d time.Duration) {
    c.mu.Lock()
    c.now = c.now.Add(d)
    // wake any sleeper whose deadline has passed
    c.mu.Unlock()
}
```

You almost never need to write this yourself. You read the source of `clockwork` once to see how it works, then you use the library.

### Advance is the heart of the test

The test owns time. It calls `Advance(d)` to move the fake clock forward, and any timer waiting for `d` or less fires.

```go
fc := clockwork.NewFakeClock()
ch := fc.After(time.Second)
fc.Advance(time.Second)
<-ch // returns immediately
```

The test loop becomes:

1. Do something that arms a timer.
2. Advance the clock just past the deadline.
3. Verify the side effect happened.

No `time.Sleep`, no flake.

### Production vs test wiring

Most code accepts the clock as a constructor parameter:

```go
type Cache struct {
    clock Clock
    // ...
}

func NewCache(clock Clock, ttl time.Duration) *Cache { ... }
```

Production:

```go
c := NewCache(clockwork.NewRealClock(), 5*time.Minute)
```

Test:

```go
fc := clockwork.NewFakeClock()
c := NewCache(fc, 5*time.Minute)
```

The same code under test, but the test owns time.

---

## Real-World Analogies

### Mocking time is like a film set

In a movie, "noon" is whenever the lighting director says it is. The real sun is not in charge; the lamps are. Your tests should work the same way: the test is the lighting director, the production code is the actor. Real time outside the studio is irrelevant.

### A fake clock is like a board game timer

Monopoly does not care what time of day it is. A turn ends when somebody says "next." A retry-with-backoff test should not care what time of day it is either. The test says "next minute" with `Advance(time.Minute)` and the system reacts.

### The Clock interface is the door to the outside world

Production code that calls `time.Now()` is reaching through the wall directly. The `Clock` interface is a doorway. Tests can hang a different door behind it (a fake one) without renovating the room.

### `synctest` is a soundstage

In Go 1.24, `synctest.Run(func() { ... })` is a soundstage where all of `time.Sleep`, `time.After`, `time.NewTimer` are intercepted by the runtime and run on fake time. You do not even need a library — the standard library plays the part of the lighting director.

---

## Mental Models

### Model 1: Time is data

Stop thinking of `time.Now()` as a function. Think of it as data that flows into your function. Like any input data, it should arrive through a parameter. Once it does, your function is testable.

### Model 2: The fake clock is a queue of alarms

Internally a fake clock is a list of `(deadline, notify channel)` pairs. `Advance` finds every pair with `deadline ≤ now` and sends on the channel. That is the entire algorithm.

### Model 3: `BlockUntil` is "wait for the alarms to be set"

The most subtle bug in fake-time tests is calling `Advance` before the production code has had a chance to arm its timer. `BlockUntil(1)` solves this: "wait until at least one goroutine is asleep on this clock."

```go
go cache.Get("k") // may call fc.After internally
fc.BlockUntil(1)  // wait until the call arms
fc.Advance(5 * time.Minute)
```

### Model 4: Real time is a global; clocks make it local

`time.Now()` is functionally a global variable. A `Clock` instance is a value you pass around. Replacing a global with a value is the move that makes any code testable, not just time-dependent code.

### Model 5: `synctest` is "fake time without the interface tax"

If you do not want to touch your production code with a `Clock` parameter, `synctest.Run` lets the standard `time` package itself behave like a fake clock inside the bubble. The cost is Go 1.24+ and a slight performance overhead on the bubble.

---

## Pros & Cons

### Pros of mocking time

- **Fast tests.** A test that exercises a 24-hour scheduler runs in microseconds.
- **Deterministic tests.** Two runs of the same test always produce the same result. No flakes from CPU load or GC pauses.
- **Edge-case coverage.** You can test "what if the clock jumps backwards an hour" or "what if the TTL is `math.MaxInt64`" without waiting decades.
- **Better design.** Code that takes a `Clock` is easier to compose, audit, and reuse than code that touches the global clock.

### Cons

- **Boilerplate.** Every production constructor grows a `Clock` parameter.
- **Diligence required.** A single forgotten `c.clock.Now()` (in favour of `time.Now()`) silently breaks determinism.
- **Library choice.** `clockwork`, `benbjohnson/clock`, and `synctest` all exist and have similar but not identical APIs.
- **Subtle races.** `Advance` before the production code has armed a timer is a common bug. `BlockUntil` fixes it but adds rope to trip on.
- **No help for system calls.** `net.Dial`, `os.File.Read`, and any blocking syscall is still on real time. You may need additional shims.

When mocking time is overkill: a script that runs once a day, a CLI that exits after a few seconds, a binary that does not have unit tests at all. For long-lived services with timers, it is essential.

---

## Use Cases

- **TTL caches.** Verify eviction at exactly the configured TTL.
- **Rate limiters.** Test that the bucket refills at the right rate and that bursts cap correctly.
- **Retry loops with backoff.** Confirm exponential delays in sub-millisecond test time.
- **Schedulers.** Verify a job runs at 03:00 UTC daily without waiting until 03:00.
- **Heartbeat and keepalive.** Test that a connection sends a ping every N seconds and disconnects after M missed responses.
- **Deadlines and context timeouts.** Drive `context.WithDeadline` from a fake clock.
- **Token expiry.** JWTs, OAuth tokens, session cookies — every expiry-driven security feature.
- **Distributed coordination.** Heartbeat-based leader election, gossip protocols, lease renewals.
- **Backoff and circuit breakers.** Verify the half-open state opens after exactly the configured cooldown.

---

## Code Examples

### Example 1: The Clock interface and a real implementation

```go
package clock

import "time"

type Clock interface {
    Now() time.Time
    Sleep(d time.Duration)
    After(d time.Duration) <-chan time.Time
}

type realClock struct{}

func New() Clock { return realClock{} }

func (realClock) Now() time.Time                          { return time.Now() }
func (realClock) Sleep(d time.Duration)                   { time.Sleep(d) }
func (realClock) After(d time.Duration) <-chan time.Time  { return time.After(d) }
```

Production code calls `clock.New()`. Tests do not.

### Example 2: TTL cache that takes a clock

```go
package cache

import (
    "sync"
    "time"
)

type entry struct {
    value    string
    expireAt time.Time
}

type Cache struct {
    mu    sync.Mutex
    data  map[string]entry
    clock Clock
    ttl   time.Duration
}

type Clock interface {
    Now() time.Time
}

func New(c Clock, ttl time.Duration) *Cache {
    return &Cache{
        data:  make(map[string]entry),
        clock: c,
        ttl:   ttl,
    }
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data[k] = entry{value: v, expireAt: c.clock.Now().Add(c.ttl)}
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    e, ok := c.data[k]
    if !ok || c.clock.Now().After(e.expireAt) {
        delete(c.data, k)
        return "", false
    }
    return e.value, true
}
```

Every read of "now" goes through `c.clock`. There is no `time.Now()` left in the file.

### Example 3: The cache test, with `clockwork`

```go
package cache

import (
    "testing"
    "time"

    "github.com/jonboulle/clockwork"
)

func TestCacheExpires(t *testing.T) {
    fc := clockwork.NewFakeClock()
    c := New(fc, 5*time.Minute)

    c.Set("k", "v")
    if v, ok := c.Get("k"); !ok || v != "v" {
        t.Fatalf("got %q,%v want v,true", v, ok)
    }

    fc.Advance(5*time.Minute + time.Second)

    if _, ok := c.Get("k"); ok {
        t.Fatal("entry should be expired")
    }
}
```

The test runs in microseconds. Compare to the original 5-minute version.

### Example 4: A retry loop with exponential backoff

```go
package retry

import (
    "context"
    "time"
)

type Clock interface {
    Now() time.Time
    After(d time.Duration) <-chan time.Time
}

func Do(ctx context.Context, clock Clock, attempts int, op func() error) error {
    var err error
    delay := 100 * time.Millisecond
    for i := 0; i < attempts; i++ {
        if err = op(); err == nil {
            return nil
        }
        if i == attempts-1 {
            break
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-clock.After(delay):
        }
        delay *= 2
    }
    return err
}
```

### Example 5: Test for the retry loop

```go
package retry

import (
    "context"
    "errors"
    "testing"
    "time"

    "github.com/jonboulle/clockwork"
)

func TestRetryBackoff(t *testing.T) {
    fc := clockwork.NewFakeClock()
    attempts := 0
    op := func() error {
        attempts++
        if attempts < 3 {
            return errors.New("transient")
        }
        return nil
    }

    done := make(chan error, 1)
    go func() {
        done <- Do(context.Background(), fc, 5, op)
    }()

    // First failure → arms After(100ms)
    fc.BlockUntil(1)
    fc.Advance(100 * time.Millisecond)
    // Second failure → arms After(200ms)
    fc.BlockUntil(1)
    fc.Advance(200 * time.Millisecond)
    // Third attempt succeeds

    if err := <-done; err != nil {
        t.Fatalf("want nil err, got %v", err)
    }
    if attempts != 3 {
        t.Fatalf("want 3 attempts, got %d", attempts)
    }
}
```

This is the entire pattern: launch goroutine, `BlockUntil`, `Advance`, repeat.

### Example 6: `testing/synctest` (Go 1.24+)

```go
//go:build go1.24

package cache

import (
    "testing"
    "testing/synctest"
    "time"
)

func TestCacheExpiresSynctest(t *testing.T) {
    synctest.Run(func() {
        c := newWithRealTime(5 * time.Minute) // uses time.Now internally
        c.Set("k", "v")
        time.Sleep(5*time.Minute + time.Second) // fake inside the bubble
        if _, ok := c.Get("k"); ok {
            t.Fatal("entry should be expired")
        }
    })
}
```

Inside the bubble, `time.Sleep` does not sleep — it advances fake time. No `Clock` interface needed. Bear in mind: every goroutine touched by the test must be inside the bubble.

### Example 7: `benbjohnson/clock` equivalent

```go
package cache

import (
    "testing"
    "time"

    "github.com/benbjohnson/clock"
)

func TestCacheExpiresBenbjohnson(t *testing.T) {
    mock := clock.NewMock()
    c := New(mock, 5*time.Minute) // assumes New accepts an interface that mock satisfies
    c.Set("k", "v")
    mock.Add(5*time.Minute + time.Second)
    if _, ok := c.Get("k"); ok {
        t.Fatal("entry should be expired")
    }
}
```

Difference from `clockwork`: `Add` instead of `Advance`. Same idea.

### Example 8: `AfterFunc` with a fake clock

```go
type Scheduler struct {
    clock clockwork.Clock
}

func (s *Scheduler) RunIn(d time.Duration, f func()) {
    s.clock.AfterFunc(d, f)
}

func TestSchedulerRunsAtTime(t *testing.T) {
    fc := clockwork.NewFakeClock()
    s := &Scheduler{clock: fc}
    ran := make(chan struct{})
    s.RunIn(time.Hour, func() { close(ran) })

    fc.Advance(time.Hour)
    select {
    case <-ran:
    case <-time.After(time.Second):
        t.Fatal("callback did not run")
    }
}
```

`AfterFunc` is the trickiest method to fake — see Pitfalls.

---

## Coding Patterns

### Pattern 1: Constructor injection

Every type that uses time accepts a `Clock` in its constructor.

```go
func NewWidget(clock Clock) *Widget { ... }
```

Default to a real clock if `nil` is passed, for ergonomic call sites:

```go
func NewWidget(clock Clock) *Widget {
    if clock == nil {
        clock = clockwork.NewRealClock()
    }
    return &Widget{clock: clock}
}
```

### Pattern 2: Functional option

```go
type Widget struct{ clock Clock }
type Option func(*Widget)

func WithClock(c Clock) Option { return func(w *Widget) { w.clock = c } }

func NewWidget(opts ...Option) *Widget {
    w := &Widget{clock: clockwork.NewRealClock()}
    for _, o := range opts { o(w) }
    return w
}
```

Production: `NewWidget()`. Tests: `NewWidget(WithClock(fc))`.

### Pattern 3: Package-level clock variable (discouraged)

```go
var clk Clock = realClock{}

// tests swap it:
oldClk := clk
clk = fakeClock{}
defer func() { clk = oldClk }()
```

It works but it is racy when tests run in parallel and bug-prone in general. Avoid.

### Pattern 4: Use `clockwork.Clock` directly

`clockwork` exports an interface `clockwork.Clock` that already has every method. You can use it as your own type instead of defining a new interface:

```go
type Cache struct {
    clock clockwork.Clock
}
```

This couples your code to `clockwork` but cuts the boilerplate.

### Pattern 5: `synctest` for greenfield code

If you are starting fresh and on Go 1.24+, you may skip the `Clock` interface entirely and use `synctest.Run` in tests. The cost is one more level of nesting and the restriction that all goroutines stay inside the bubble.

---

## Clean Code

- **One clock per process.** Every long-lived object that needs time gets the same clock. Do not let one component see fake time and another see real time.
- **Never call `time.Now` in production code that has a clock.** Linters can enforce this. The `revive` or `staticcheck` rule `time-now` plus a custom check work.
- **Name parameters consistently.** `clock` not `c`, `clk`, `now`, or `time`.
- **Inject from the top.** `main` constructs the real clock; everything below receives it. Treat the clock the same way you treat a `*sql.DB`.
- **Keep tests fast.** A fake-clock test that takes more than 10 ms is a smell — usually a real `time.Sleep` snuck in.

```go
// Bad: real time inside business logic
deadline := time.Now().Add(c.ttl)

// Good: clock injected
deadline := c.clock.Now().Add(c.ttl)
```

---

## Product Use / Feature

Real systems that depend on fake time in tests:

- **Kubernetes** uses `clockwork`-style clocks in its workqueues and controllers. The leader-election test suite advances the fake clock to expire leases.
- **etcd** mocks its `raftLog` time to drive election timeouts deterministically.
- **Vault** ships a `physical.Clock` interface to test token TTLs.
- **Prometheus** uses a fake clock in scraper tests so the test for a 15-second scrape interval finishes in milliseconds.
- **CockroachDB** uses a `hlc.ManualClock` to drive its hybrid logical clock in tests.

The pattern is so universal that the absence of `Clock` in a new Go project is a red flag.

---

## Error Handling

The clock interface itself rarely returns errors. The errors come from what the clock drives:

- **Context cancellation while waiting.** Always `select` between `clock.After(d)` and `<-ctx.Done()`.

```go
select {
case <-clock.After(d):
case <-ctx.Done():
    return ctx.Err()
}
```

- **Timer leaks.** If you call `clock.After(time.Hour)` and the surrounding context cancels in 10 ms, the timer goroutine in `clockwork`'s fake clock still sits in the sleeper list. For long-running tests with many timers, prefer `NewTimer` and call `Stop` on cleanup.

- **Re-arming a timer.** `Timer.Reset` is subtle even on the real clock; on a fake clock the semantics follow the real ones. Always drain the channel before resetting if there is any chance the timer fired.

- **`AfterFunc` panics.** If the callback panics, the production code panics too. Test what should happen in that case — usually nothing good — and recover only at the boundary you control.

---

## Security Considerations

Time is part of security, not just performance:

- **Token expiry.** A token-expiry test that uses real time is slow; one that uses fake time is fast and deterministic. The same fake clock can verify "token expired exactly at TTL, not 1 ms earlier" — a property no real-time test can confirm.
- **Backoff against brute force.** Rate-limit and lockout tests should run under fake time. A real-time test invites cheating with sub-second delays that pass locally and fail under CI load.
- **Clock skew.** Production clocks jump (NTP), drift, and occasionally go backwards. A fake clock can model the skew: `fc.Advance(-time.Hour)` is allowed in `clockwork`. Test that your auth code does not panic on backwards time.
- **Replay attacks.** When verifying replay-protection windows, fake time lets you test "exactly at the boundary" instead of guessing.
- **Do not use fake clocks in production.** A real clock is the right choice for live code. A fake clock that leaks into production through a misconfigured build tag is a security hole — auth tokens would never expire.

---

## Performance Tips

- **Fake clocks are cheap.** A `clockwork.FakeClock.Advance` is O(n) in number of pending sleepers, which is usually small. Benchmarks rarely show it as a hot spot.
- **`BlockUntil` polls.** Some implementations spin-poll waiting for goroutines to enter the sleeper state. If your test has many concurrent goroutines, `BlockUntil` may take a few hundred microseconds. Still much faster than real time.
- **Real clocks: `time.Now` is fast.** A real-clock implementation that delegates to `time.Now` costs ~50 ns. The clock interface itself does not slow production down.
- **Avoid `time.Tick` in long-running code.** `time.Tick` cannot be stopped, so it leaks. Prefer `time.NewTicker`. The same applies to fake clocks.
- **Don't poll the fake clock.** A test that says `for fc.Now().Before(deadline) { fc.Advance(time.Second) }` is correct but ugly. Advance by the right amount once.

---

## Best Practices

- **Always inject the clock.** Do not call `time.Now` from any code path that has tests.
- **Use one library across the project.** Mixing `clockwork`, `benbjohnson/clock`, and `synctest` in the same module is unnecessary cognitive overhead.
- **`BlockUntil(n)` before `Advance(d)`** whenever the production code arms timers in a goroutine. Without it, `Advance` can race the arming and the test flakes.
- **Use `t.Cleanup` to stop tickers.** Even fake tickers should be stopped to keep the test tidy.
- **Prefer `NewTimer` + `Stop`** over `After`. `After` leaks until the deadline.
- **Test the boundary, not just the inside.** Test what happens at `ttl - 1 ns`, exactly `ttl`, and `ttl + 1 ns`.
- **Keep the clock interface small.** Add methods only when you need them. The big `clockwork.Clock` interface is acceptable if you import the library; do not invent your own with 12 methods up front.

---

## Edge Cases & Pitfalls

### Pitfall 1: Goroutine still uses `time.Now` behind your back

```go
func (c *Cache) cleanup() {
    for range time.Tick(c.cleanupInterval) { // BUG: real ticker
        c.evictExpired()
    }
}
```

The cache's `Get` uses the injected clock, but the cleanup goroutine uses `time.Tick`. Test passes, production behaviour matches, but the test for the cleanup loop will hang forever. Replace with `c.clock.NewTicker`.

### Pitfall 2: `Advance` before the timer is armed

```go
fc := clockwork.NewFakeClock()
go func() { c.SlowOp(fc) }() // calls fc.After internally
fc.Advance(time.Second)      // BUG: maybe armed, maybe not
```

If the scheduler has not yet got to `c.SlowOp`, the timer is not in the sleeper list, and `Advance` does nothing. The test flakes 1% of runs. Fix with `fc.BlockUntil(1)`.

### Pitfall 3: `AfterFunc` runs on a different goroutine

```go
ran := false
fc.AfterFunc(time.Second, func() { ran = true })
fc.Advance(time.Second)
if !ran { t.Fatal("...") } // BUG: data race + maybe not run yet
```

`AfterFunc` schedules the callback on the fake clock's internal goroutine. Use a channel:

```go
ran := make(chan struct{})
fc.AfterFunc(time.Second, func() { close(ran) })
fc.Advance(time.Second)
<-ran
```

### Pitfall 4: `synctest` and external goroutines

Inside `synctest.Run`, all goroutines you spawn share fake time. A goroutine *outside* the bubble does not. If your test makes an HTTP call to a real server, that server is on real time. `synctest` is the right tool for pure-Go pure-in-memory tests; not for integration tests.

### Pitfall 5: `time.Now()` in a third-party library

A library you depend on may call `time.Now()` internally with no way to inject a clock. You may need to wrap or fork. `synctest` (Go 1.24+) helps here because it fakes the global `time` package, not just an interface.

### Pitfall 6: Forgetting to drain `time.After`'s channel

Each `clock.After(d)` returns a channel that holds one value. If you do not receive it, the value is garbage-collected when the channel is. On a fake clock, the sleeper is removed from the list when fired, but the channel still holds the value until the test ends.

### Pitfall 7: Test sets a deadline in the past

```go
fc := clockwork.NewFakeClock()
deadline := fc.Now().Add(-time.Second) // past!
ctx, _ := context.WithDeadline(ctx, deadline)
```

Behaviour is identical to real time: the context is already cancelled. No bug per se; just don't be surprised.

---

## Common Mistakes

1. **Using `time.Sleep` in a test "just for a moment."** Even 10 ms accumulated across 1000 tests is 10 seconds of CI time. Replace.
2. **Calling `Advance` from inside the goroutine being tested.** `Advance` is a test concern, never a production concern.
3. **Defining a `Clock` interface but never using it.** Half-converted code uses real time in critical paths and fake time elsewhere. Audit.
4. **Sharing one `*FakeClock` across `t.Parallel` tests.** Each parallel test should own its own clock.
5. **Asserting wall-clock duration in a fake-clock test.** `fc.Now().Sub(start)` is meaningful; `time.Since(start)` is not.
6. **Using `time.Now()` for randomness seeding.** If you use `rand.New(rand.NewSource(time.Now().UnixNano()))` and you have faked time, your seeds collide. Inject the seed instead.
7. **Forgetting `t.Cleanup` for tickers.** Even fake tickers leak across tests.

---

## Common Misconceptions

- *"`time.Sleep(time.Millisecond)` is harmless."* It is harmless until you have 1000 tests doing it. Then your suite is a second slower.
- *"My code is too simple to need a clock."* The smallest TTL cache or the smallest backoff loop already benefits.
- *"`testing/synctest` replaces `clockwork`."* Only for code inside a bubble and only on Go 1.24+. Real code with libraries that spawn goroutines outside the bubble still needs a `Clock` interface.
- *"A fake clock makes my tests slower because of locks."* Measurement disagrees. Lock cost in a 10-goroutine test is dozens of nanoseconds.
- *"Mocking time is a code smell — the function should be pure."* Pure functions are great, but a TTL cache is by definition impure. Mocking time is the principled way to make it testable anyway.
- *"`clock.Patch` (monkey-patching) is just as good."* It is not. See [Tricky Points](#tricky-points).

---

## Tricky Points

### Monotonic time on `time.Time`

A real `time.Time` carries a monotonic component used by `time.Since` and friends. A fake clock typically does not. `time.Since(c.clock.Now())` on a real clock and on a fake clock can return different shapes if you compare directly with arithmetic. Stick to `Sub` and `Add` on values; do not strip the monotonic portion accidentally with `t.Round(0)`.

### `Advance` is not atomic for downstream consumers

When `Advance(time.Hour)` fires three timers, the order of side effects is the order in the internal sleeper list — not necessarily the order in which they were armed. If your test depends on order, sort by deadline or assert by set.

### Negative durations

`clockwork.Advance(-time.Hour)` moves the clock backwards. Most production code does not handle backwards time. Decide what you want and test it.

### `time.Now` and `monotonic` strip in JSON

`time.Time.MarshalJSON` drops the monotonic reading. Round-tripping through JSON changes time equality. Not strictly a fake-clock issue but bites alongside it.

### `clockwork` returns `nil` from `BlockUntilContext` on error

If you use `BlockUntilContext` (available in newer `clockwork`) and the context cancels, you get `nil, ctx.Err()`. Forgetting to check is a flake source.

### Monkey-patching `clock.Patch` is not safe

A third option some projects pick: a library called `bouk/monkey` or `agiledragon/gomonkey` that overwrites the function table of `time.Now` at runtime. It is fragile (broken by Go upgrades), unsafe under `-race`, and not portable. Avoid.

---

## Test

Try these to confirm you understand the level.

1. Write a `Clock` interface with `Now`, `Sleep`, `After`, and `AfterFunc`. Implement the real version. (10 minutes.)
2. Build a TTL cache with `Set`, `Get`, and a TTL of 30 seconds. Inject the clock. Write a test that proves expiry happens at exactly 30s, not 29 or 31. (20 minutes.)
3. Convert the test to use `github.com/jonboulle/clockwork`. Confirm it runs in under 1 ms. (10 minutes.)
4. Add a background "cleanup" goroutine that walks the cache every 10 seconds. Test that it ticks at the right interval using `BlockUntil`. (30 minutes.)
5. Rewrite the test with `testing/synctest` (Go 1.24+). Compare cognitive load. (15 minutes.)
6. Implement a retry function `Retry(ctx, attempts, op)` with exponential backoff. Write a test that verifies the third attempt happens at exactly `100ms + 200ms + 400ms` of fake time after the first failure. (30 minutes.)
7. Write a token-bucket rate limiter `Allow()` driven by `clock.Now`. Test that after 1 second the bucket is full. (30 minutes.)

If all seven take under 3 hours combined, you have the junior fundamentals.

---

## Tricky Questions

1. **Why is `time.Sleep(time.Millisecond)` in a test a code smell?** It commits the test to real time and accumulates.
2. **What does `BlockUntil(1)` do?** Wait until at least one goroutine is blocked on this fake clock's sleep/timer/ticker.
3. **What is the difference between `clockwork.Advance` and `clock.Add`?** Nothing semantic; they are the same operation in two libraries.
4. **Can `synctest` test code that calls a real database?** Not really. Database calls hit the OS, which is on real time. `synctest` fakes the Go `time` package.
5. **What happens to a `clock.After(d)` channel if no one reads it?** The internal sleeper fires anyway when `Advance` is called; the value sits unread in the channel buffer until GC.
6. **Can two parallel tests share a fake clock?** They can, but you almost never want to. Each test owns its own.
7. **Is calling `time.Now` ever OK in production code that has tests?** Only at the boundary that constructs the clock — typically `main`. Never inside business logic.
8. **What is the cost of injecting `Clock` everywhere?** One extra parameter per constructor and a small amount of indirection. Trivial.

---

## Cheat Sheet

```text
WHY:    test in fake time, not wall time
HOW:    inject a Clock interface, use real impl in prod, fake in tests

INTERFACE (minimum useful):
  Now() time.Time
  Sleep(d time.Duration)
  After(d time.Duration) <-chan time.Time
  NewTimer / NewTicker / AfterFunc

LIBRARIES:
  github.com/jonboulle/clockwork     - most popular
  github.com/benbjohnson/clock        - other established choice
  testing/synctest                    - Go 1.24+, no library needed

CLOCKWORK 101:
  fc := clockwork.NewFakeClock()
  fc.Advance(d)         // move time forward
  fc.BlockUntil(n)      // wait for n sleepers
  fc.AfterFunc(d, fn)   // schedule callback

TEST LOOP:
  go productionCode(fc)
  fc.BlockUntil(1)
  fc.Advance(d)
  // assert side effect

PITFALLS:
  - leftover time.Now / time.Tick in code under test
  - Advance before timer is armed (use BlockUntil)
  - AfterFunc callback runs on another goroutine (use channel)
  - synctest bubble does not extend to external goroutines

NEVER:
  - time.Sleep in tests
  - monkey-patch time.Now
  - share a FakeClock across parallel tests
```

---

## Self-Assessment Checklist

- [ ] I can explain why `time.Now` is a dependency
- [ ] I can write a `Clock` interface and its real implementation
- [ ] I can write a `Cache` that takes a `Clock` and prove expiry with a fake clock
- [ ] I know what `Advance`, `BlockUntil`, and `AfterFunc` do on a fake clock
- [ ] I know the three options: `clockwork`, `benbjohnson/clock`, `testing/synctest`
- [ ] I can spot a real `time.Now` call inside code that should be on the injected clock
- [ ] I never use `time.Sleep` in a test
- [ ] I use `BlockUntil` before `Advance` when arming happens in a goroutine
- [ ] I keep `Clock` parameters small and consistent
- [ ] I understand why monkey-patching `time.Now` is a bad answer

If you check all of these, you are ready for middle level.

---

## Summary

Time-dependent Go code is testable only when time is a dependency you control. The standard pattern is to define a `Clock` interface, plug a real implementation in production, and a fake implementation in tests. The fake clock advances only when the test calls `Advance(d)`. Three solutions: `github.com/jonboulle/clockwork` (most popular), `github.com/benbjohnson/clock` (similar), and Go 1.24's `testing/synctest` (no library, runtime support). Common pitfalls: leftover `time.Now` calls, `Advance` before timers are armed (use `BlockUntil`), `AfterFunc` callbacks running on the clock's goroutine. With this pattern, tests for 5-minute TTLs, 24-hour schedulers, and exponential-backoff retries run in microseconds and never flake.

---

## What You Can Build

With junior-level mocking-time skills you can already build:

- A unit-test suite for a TTL cache that finishes in milliseconds even though TTLs are minutes.
- A retry-with-backoff library, fully tested without real waits.
- A scheduled-job runner whose tests run jobs in fake time.
- A heartbeat / health-check loop with deterministic tests.
- A token-bucket rate limiter with reproducible bucket-fill assertions.
- A session-token expiry verifier that tests the exact-millisecond boundary.

---

## Further Reading

- `github.com/jonboulle/clockwork` README
- `github.com/benbjohnson/clock` README
- Go 1.24 release notes — `testing/synctest`
- Damian Gryski, "Testing Time" — short blog post that motivated many projects to add `Clock`
- Russ Cox, "Software Engineering at Google" — section on time in tests
- The `kubernetes/utils/clock` package source code for an industrial-grade interface

---

## Related Topics

- [02-deterministic-testing](../02-deterministic-testing/) — broader determinism patterns; `testing/synctest`
- [03-waitgroup-in-tests](../03-waitgroup-in-tests/) — synchronisation primitives in tests
- [05-concurrent-fuzzing](../05-concurrent-fuzzing/) — combining fuzzing with mocked time
- `07-concurrency/11-advanced-channel-patterns/05-ratelimiter/` — fake-clock tests for rate limiters
- `07-concurrency/12-lock-free-programming/` — when `atomic.Int64` is your clock substitute

---

## Diagrams & Visual Aids

### Real time vs fake time

```
Real clock:        |------|------|------|------|--->   (seconds tick at 1 Hz)
                      ^                             test waits real seconds

Fake clock:        |--------------------------|--->   (jumps on Advance)
                   ^   ^   ^   ^             ^         no real time passes
                   Advance points; everything in between is instant.
```

### The Clock interface, the two implementations, and the test wiring

```
              +--------------------+
              |  Clock interface   |
              |  Now/After/...     |
              +--------------------+
                 ^               ^
                 |               |
   +-------------+--+      +-----+------------+
   |  realClock     |      |  fakeClock       |
   |  → time.Now    |      |  Advance(d)      |
   |  → time.After  |      |  BlockUntil(n)   |
   +----------------+      +------------------+
        used by                 used by
        main, prod              tests

```

### `Advance` fires every timer up to the new time

```
Before Advance(2s):
  now = 0
  sleepers: [deadline=1s, deadline=1.5s, deadline=3s]

After Advance(2s):
  now = 2s
  sleepers: [deadline=3s]
  signalled: deadline=1s, deadline=1.5s   (channels received)
```

### `BlockUntil(1)` waits for arming

```
Test goroutine:                   Production goroutine:
  go prod()
  fc.BlockUntil(1)  --------+
                            |     fc.After(1s)   <-- arms here
                            +--->  now BlockUntil returns
  fc.Advance(1s)
  assert side effect
```

### `synctest` bubble

```
+-----------------------------------------+
|  synctest.Run(func() {                  |
|     g1 := go A()                        |
|     g2 := go B()                        |
|     time.Sleep(5*time.Minute) // FAKE   |
|     // assertions                       |
|  })                                     |
+-----------------------------------------+
              |
              v
      runtime hooks `time` to advance fake time
      when the bubble is quiescent
```
