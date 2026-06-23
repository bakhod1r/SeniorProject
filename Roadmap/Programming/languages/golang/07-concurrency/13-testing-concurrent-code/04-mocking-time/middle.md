# Mocking Time — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [`clockwork` in Depth: Every Method, Every Pitfall](#clockwork-in-depth-every-method-every-pitfall)
3. [`benbjohnson/clock` and the API Differences That Matter](#benbjohnsonclock-and-the-api-differences-that-matter)
4. [`testing/synctest` (Go 1.24+) — Fake Time Without an Interface](#testingsynctest-go-124-fake-time-without-an-interface)
5. [`BlockUntil`, `AfterFunc`, and Timing Races](#blockuntil-afterfunc-and-timing-races)
6. [TTL Cache End-to-End](#ttl-cache-end-to-end)
7. [Token Bucket Limiter Under a Fake Clock](#token-bucket-limiter-under-a-fake-clock)
8. [Retry-with-Backoff and Jitter](#retry-with-backoff-and-jitter)
9. [Anti-Patterns](#anti-patterns)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)

---

## Introduction

Junior gave you the vocabulary, the `Clock` interface, and a first test under fake time. Middle level digs into the real-world details:

- Every method on `clockwork.Clock` and what it costs.
- How `clockwork` and `benbjohnson/clock` differ — and when one is better than the other.
- The `testing/synctest` package added in Go 1.24, which lets you keep real `time` calls in your production code and still get fake time in tests.
- The exact dance — `BlockUntil` → `Advance` → drain — that prevents flakes.
- Three industrial examples worked end to end: TTL cache, token bucket, retry-with-backoff.

By the end you should be comfortable picking a library, writing fake-clock tests that do not flake, and recognising the small set of patterns that recur in every codebase.

---

## `clockwork` in Depth: Every Method, Every Pitfall

`clockwork.Clock` (current version: v0.4 at the time of writing) exposes the following operations:

```go
type Clock interface {
    After(d time.Duration) <-chan time.Time
    Sleep(d time.Duration)
    Now() time.Time
    Since(t time.Time) time.Duration
    NewTicker(d time.Duration) Ticker
    NewTimer(d time.Duration) Timer
    AfterFunc(d time.Duration, f func()) Timer
}
```

`FakeClock` adds:

```go
type FakeClock interface {
    Clock
    Advance(d time.Duration)
    BlockUntil(n int)
    BlockUntilContext(ctx context.Context, n int) error
}
```

### `Now`, `Since`, `Sleep`

Trivial. `Now` returns the current fake time. `Since(t)` is `Now().Sub(t)`. `Sleep(d)` blocks the calling goroutine until `now + d` has been reached by `Advance` calls.

### `After`, `NewTimer`

`After(d)` and `NewTimer(d)` register a sleeper at `now + d`. When `Advance` (or `Sleep` in another goroutine) moves the clock to or past that deadline, the channel receives the fake-time value. `NewTimer` returns a `Timer` whose `Stop` removes it from the list.

### `NewTicker`

`NewTicker(d)` is a chain of `NewTimer` events spaced by `d`. After `Advance(2.5*d)` you get two ticks delivered (not three; the partial third re-arms). Always `Stop` your tickers — fake-clock tickers leak too.

### `AfterFunc`

`AfterFunc(d, f)` schedules a callback. **The callback runs on a goroutine spawned by the fake clock, not the test goroutine.** This is the source of most "my test sees an old value" bugs:

```go
done := make(chan struct{})
ran := false
fc.AfterFunc(time.Second, func() {
    ran = true        // BUG: race with test goroutine
    close(done)
})
fc.Advance(time.Second)
<-done                // now ran is visible, but only because close synchronises
```

The reliable shape is "callback signals via channel, test reads channel."

### `Advance(d)`

Moves the clock forward and fires every sleeper with deadline ≤ new now. Cost is O(n) in pending sleepers. Calling `Advance` twice quickly is the same as one bigger call — the intermediate state is invisible.

### `BlockUntil(n)`

Spin-polls (with backoff) until at least `n` sleepers are registered. The classic shape:

```go
go func() { c.Get("k") }() // may call fc.After internally
fc.BlockUntil(1)
fc.Advance(time.Hour)
```

Without `BlockUntil`, the `Advance` can race the registration and fire on an empty list. The test passes 99% of the time and flakes the other 1%.

### `BlockUntilContext(ctx, n)`

Same as `BlockUntil` but bails out if the context cancels. Useful in tests that have a hard timeout:

```go
ctx, cancel := context.WithTimeout(context.Background(), time.Second)
defer cancel()
if err := fc.BlockUntilContext(ctx, 1); err != nil {
    t.Fatal("production code never armed a timer")
}
```

### Constructors

```go
clockwork.NewRealClock()              // production
clockwork.NewFakeClock()              // fake, starts at "now"
clockwork.NewFakeClockAt(time.Time{}) // fake, starts at given time
```

Use `NewFakeClockAt(time.Unix(0,0))` if you want totally deterministic timestamps in assertions.

---

## `benbjohnson/clock` and the API Differences That Matter

`github.com/benbjohnson/clock` (v1.3) covers the same ground with a slightly different API.

| Concept | `clockwork` | `benbjohnson/clock` |
|---|---|---|
| Construct fake | `NewFakeClock()` | `NewMock()` |
| Advance time | `Advance(d)` | `Add(d)` |
| Set absolute time | `NewFakeClockAt(t)` | `Set(t)` |
| Wait for sleepers | `BlockUntil(n)` | `WaitTimer(n)` (in newer forks) or `time.Sleep` workarounds |
| Interface name | `Clock` | `Clock` |

Differences that matter in practice:

- `benbjohnson/clock` does not have a built-in `BlockUntil` in v1.3. You either sleep a tiny amount of real time (ugly) or use `WaitTimer` from a fork or a custom barrier.
- `clockwork` has fewer methods but offers `BlockUntilContext`.
- `benbjohnson/clock` is closer in API to the standard `time` package — fewer renames.
- Both work fine with the race detector.

Pick one and stick with it. Switching mid-project is mechanical but tedious.

```go
// clockwork
fc := clockwork.NewFakeClock()
fc.Advance(time.Second)

// benbjohnson/clock
mock := clock.NewMock()
mock.Add(time.Second)
```

For new code, `clockwork` is the broader choice and has more momentum. `benbjohnson/clock` is solid for projects already using it.

---

## `testing/synctest` (Go 1.24+) — Fake Time Without an Interface

Go 1.24 added `testing/synctest`, a package that runs code in a "bubble" where the standard `time` package itself behaves like a fake clock and the runtime knows when every goroutine is blocked.

```go
//go:build go1.24

package mypkg

import (
    "testing"
    "testing/synctest"
    "time"
)

func TestSleep(t *testing.T) {
    synctest.Run(func() {
        start := time.Now()
        time.Sleep(5 * time.Minute) // fake!
        if time.Since(start) < 5*time.Minute {
            t.Fatal("fake time should still pass exactly 5m")
        }
    })
}
```

Inside the bubble:

- `time.Now`, `time.Sleep`, `time.After`, `time.NewTimer`, `time.NewTicker`, `time.AfterFunc` all use the bubble's fake clock.
- When every goroutine in the bubble is blocked on time or on a channel, the runtime advances the clock to the next pending wakeup.
- `synctest.Wait()` returns when the bubble reaches a quiescent state.

### What `synctest` gives you

- No `Clock` interface required. Production code can keep `time.Now()`.
- Truly deterministic: the runtime knows the precise wakeup order.
- Faster than `clockwork` for tests that spawn many timers.

### What it does not give you

- **External goroutines.** Goroutines launched outside `Run` are on real time. `net.Dial`, `os.File.Read`, child processes — all real.
- **Pre-Go-1.24 compatibility.** If your project supports Go 1.21, you cannot rely on it.
- **Mid-test peeks at fake time.** You cannot "step" the clock by exact amounts — you `time.Sleep` and the runtime decides. For fine-grained boundary tests, `clockwork.Advance(exactly X)` is more direct.

### Choosing between interface and `synctest`

| You need | Pick |
|---|---|
| Code works on Go 1.21 | `clockwork` or `benbjohnson/clock` |
| Stepping by exact amounts | `clockwork.Advance(d)` |
| Production code already calls `time.Now` and you cannot refactor | `synctest` |
| Determinism across hundreds of timers | `synctest` |
| Need to test only a function, not a goroutine tree | Either |

Many projects use both: `synctest` for end-to-end concurrency tests, `clockwork` for unit tests of `Clock`-injecting components.

---

## `BlockUntil`, `AfterFunc`, and Timing Races

The two most common bugs in fake-clock tests are:

1. `Advance` runs before the production code arms the timer.
2. The test asserts a side effect before `AfterFunc`'s callback finished.

### Shape A: production arms a timer in the test goroutine

```go
deadline := fc.After(time.Second) // armed synchronously
fc.Advance(time.Second)
<-deadline
```

Safe. The arming happens before `Advance` because they are in the same goroutine.

### Shape B: production arms a timer in a worker goroutine

```go
go func() {
    select {
    case <-fc.After(time.Second):
        log.Println("woke up")
    }
}()
fc.Advance(time.Second) // RACE: After may not be armed yet
```

Fix:

```go
go func() {
    select {
    case <-fc.After(time.Second):
        log.Println("woke up")
    }
}()
fc.BlockUntil(1)
fc.Advance(time.Second)
```

### Shape C: chained timers

A worker that sleeps, does work, sleeps, does work...

```go
go func() {
    for {
        <-fc.After(time.Second)
        process()
    }
}()
fc.BlockUntil(1)         // first After is armed
fc.Advance(time.Second)
fc.BlockUntil(1)         // second After is armed
fc.Advance(time.Second)
```

Each iteration arms a new timer; `BlockUntil` after each `Advance`.

### Shape D: `AfterFunc` callback

```go
done := make(chan struct{})
fc.AfterFunc(time.Second, func() {
    work()
    close(done)
})
fc.Advance(time.Second)
<-done
```

Always synchronise on a channel, never on a bare bool.

---

## TTL Cache End-to-End

A production-quality, fake-clock-testable TTL cache.

### Implementation

```go
package cache

import (
    "sync"
    "time"

    "github.com/jonboulle/clockwork"
)

type entry struct {
    value    string
    expireAt time.Time
}

type Cache struct {
    mu     sync.Mutex
    data   map[string]entry
    clock  clockwork.Clock
    ttl    time.Duration
    done   chan struct{}
    sweep  time.Duration
}

func New(clock clockwork.Clock, ttl, sweep time.Duration) *Cache {
    c := &Cache{
        data:  make(map[string]entry),
        clock: clock,
        ttl:   ttl,
        sweep: sweep,
        done:  make(chan struct{}),
    }
    go c.background()
    return c
}

func (c *Cache) Close() { close(c.done) }

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

func (c *Cache) background() {
    t := c.clock.NewTicker(c.sweep)
    defer t.Stop()
    for {
        select {
        case <-c.done:
            return
        case <-t.Chan():
            c.evictAll()
        }
    }
}

func (c *Cache) evictAll() {
    now := c.clock.Now()
    c.mu.Lock()
    defer c.mu.Unlock()
    for k, e := range c.data {
        if now.After(e.expireAt) {
            delete(c.data, k)
        }
    }
}
```

### Test

```go
func TestCacheTTL(t *testing.T) {
    fc := clockwork.NewFakeClock()
    c := New(fc, 5*time.Minute, time.Minute)
    defer c.Close()

    c.Set("k", "v")
    if v, ok := c.Get("k"); !ok || v != "v" {
        t.Fatalf("got %q,%v want v,true", v, ok)
    }

    fc.Advance(5 * time.Minute) // boundary
    if _, ok := c.Get("k"); ok {
        t.Fatal("at TTL boundary, entry must be gone (After is strict)")
    }
}

func TestCacheSweep(t *testing.T) {
    fc := clockwork.NewFakeClock()
    c := New(fc, 30*time.Second, 10*time.Second)
    defer c.Close()

    c.Set("k", "v")
    fc.BlockUntil(1) // background ticker is armed

    // First sweep at 10s: still alive
    fc.Advance(10 * time.Second)
    fc.BlockUntil(1)
    if _, ok := c.Get("k"); !ok {
        t.Fatal("still within TTL")
    }

    // Sweep at 40s: gone
    fc.Advance(40 * time.Second)
    fc.BlockUntil(1)
    if _, ok := c.Get("k"); ok {
        t.Fatal("expected eviction by background sweep")
    }
}
```

Notice the `BlockUntil(1)` after every `Advance`. The background ticker re-arms each tick.

---

## Token Bucket Limiter Under a Fake Clock

A token-bucket limiter that gives out one token per second, capped at burst 5.

```go
package ratelimit

import (
    "sync"
    "time"

    "github.com/jonboulle/clockwork"
)

type Limiter struct {
    mu       sync.Mutex
    clock    clockwork.Clock
    rate     float64 // tokens per second
    burst    float64
    tokens   float64
    last     time.Time
}

func New(clock clockwork.Clock, rate, burst float64) *Limiter {
    return &Limiter{
        clock:  clock,
        rate:   rate,
        burst:  burst,
        tokens: burst,
        last:   clock.Now(),
    }
}

func (l *Limiter) Allow() bool {
    l.mu.Lock()
    defer l.mu.Unlock()
    now := l.clock.Now()
    elapsed := now.Sub(l.last).Seconds()
    l.tokens = min(l.burst, l.tokens+elapsed*l.rate)
    l.last = now
    if l.tokens >= 1 {
        l.tokens--
        return true
    }
    return false
}

func min(a, b float64) float64 {
    if a < b {
        return a
    }
    return b
}
```

### Test

```go
func TestLimiterRefills(t *testing.T) {
    fc := clockwork.NewFakeClock()
    l := New(fc, 1, 5) // 1 token/sec, burst 5

    // Consume the burst
    for i := 0; i < 5; i++ {
        if !l.Allow() {
            t.Fatalf("burst should allow 5 immediately; failed at %d", i)
        }
    }
    if l.Allow() {
        t.Fatal("after burst, should reject")
    }

    // 1 second of fake time = 1 token
    fc.Advance(time.Second)
    if !l.Allow() {
        t.Fatal("should have refilled to 1 token")
    }

    // 10 seconds = bucket caps at burst, not 10
    fc.Advance(10 * time.Second)
    for i := 0; i < 5; i++ {
        if !l.Allow() {
            t.Fatalf("burst should be full again; failed at %d", i)
        }
    }
    if l.Allow() {
        t.Fatal("after burst, should reject again")
    }
}

func TestLimiterFractional(t *testing.T) {
    fc := clockwork.NewFakeClock()
    l := New(fc, 2, 1) // 2/sec, burst 1
    l.Allow()          // consume

    fc.Advance(500 * time.Millisecond) // 1 token at this rate
    if !l.Allow() {
        t.Fatal("should refill to exactly 1 token at 500ms")
    }
}
```

The fake clock makes "what happens at exactly 500 ms" a deterministic question.

---

## Retry-with-Backoff and Jitter

```go
package retry

import (
    "context"
    "math/rand"
    "time"

    "github.com/jonboulle/clockwork"
)

type Strategy struct {
    Clock    clockwork.Clock
    Base     time.Duration
    Max      time.Duration
    Attempts int
    Rand     *rand.Rand
}

func (s Strategy) Do(ctx context.Context, op func() error) error {
    var err error
    delay := s.Base
    for i := 0; i < s.Attempts; i++ {
        if err = op(); err == nil {
            return nil
        }
        if i == s.Attempts-1 {
            break
        }
        // full jitter
        actual := time.Duration(s.Rand.Int63n(int64(delay)))
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-s.Clock.After(actual):
        }
        delay *= 2
        if delay > s.Max {
            delay = s.Max
        }
    }
    return err
}
```

### Test

```go
func TestRetrySucceedsOnThird(t *testing.T) {
    fc := clockwork.NewFakeClock()
    s := Strategy{
        Clock:    fc,
        Base:     100 * time.Millisecond,
        Max:      time.Second,
        Attempts: 5,
        Rand:     rand.New(rand.NewSource(1)), // deterministic
    }
    attempts := 0
    op := func() error {
        attempts++
        if attempts < 3 {
            return errFlaky
        }
        return nil
    }
    done := make(chan error, 1)
    go func() { done <- s.Do(context.Background(), op) }()

    fc.BlockUntil(1)
    fc.Advance(time.Second) // big jump past first backoff
    fc.BlockUntil(1)
    fc.Advance(time.Second) // big jump past second backoff

    if err := <-done; err != nil {
        t.Fatalf("want nil, got %v", err)
    }
    if attempts != 3 {
        t.Fatalf("want 3, got %d", attempts)
    }
}
```

Deterministic `Rand` keeps the jitter reproducible, fake clock keeps the time deterministic. Together: a retry test that never flakes.

---

## Anti-Patterns

### `time.Sleep` in tests

```go
time.Sleep(2 * time.Second) // wait for background to do its work
```

Always wrong in a fake-clock world. Use `BlockUntil`, channels, or `synctest.Wait`.

### Mixing real and fake clocks

```go
c := New(clockwork.NewFakeClock(), ttl, sweep)
// ... but the metrics layer inside still calls time.Now()
```

Audit and inject everywhere.

### Forgetting to stop tickers

```go
t := fc.NewTicker(time.Second)
// ... no t.Stop()
```

Even fake tickers leak across tests when `t.Parallel` is involved.

### Using `time.After` in production for cancellable waits

```go
select {
case <-ctx.Done():
case <-time.After(time.Hour): // leaks until 1 hour passes
}
```

Use `time.NewTimer(...).Stop()` or `clock.NewTimer(...).Stop()`. On a fake clock, the leak is much less visible but still present.

### Asserting wall time

```go
start := time.Now()
... fake time work ...
if time.Since(start) > 100*time.Millisecond { ... } // meaningless
```

Use `fc.Now().Sub(start)` if you actually care about elapsed *fake* time.

### Patching `time.Now` with monkey libraries

`gomonkey`, `bouk/monkey`. They are fragile (Go upgrades break them), unsafe under `-race`, and not portable. Use an interface.

---

## Cheat Sheet

```text
LIBRARIES:
  github.com/jonboulle/clockwork    Advance / BlockUntil / BlockUntilContext
  github.com/benbjohnson/clock      Add / Set
  testing/synctest (Go 1.24+)       Run / Wait

CLOCKWORK METHODS:
  Now, Since                        time inspection
  Sleep, After, NewTimer            wait primitives
  NewTicker                         repeating wait
  AfterFunc                         callback in d
  Advance(d), BlockUntil(n)         test-only

CHOOSE:
  Go 1.21 compat               -> clockwork
  Existing code uses time.Now  -> synctest
  Large goroutine trees        -> synctest
  Exact-boundary assertions    -> clockwork.Advance

PATTERN (most common):
  fc := clockwork.NewFakeClock()
  prod := NewWidget(fc)
  go prod.Run()
  fc.BlockUntil(1)
  fc.Advance(d)
  // assert

AVOID:
  time.Sleep in tests
  monkey-patched time.Now
  asserting wall clock under a fake clock
  forgetting to stop tickers (even fake)
```

---

## Summary

`clockwork` and `benbjohnson/clock` are the two established libraries; pick one and use it everywhere. `testing/synctest` (Go 1.24+) is the standard-library answer when you cannot refactor production code to inject a `Clock`. In every flavor, the test loop is the same: launch the production code, wait for it to arm its timers (`BlockUntil`), step the clock past their deadlines (`Advance` or, in `synctest`, just `time.Sleep`), and verify the side effect. TTL caches, token-bucket limiters, and retry-with-backoff loops all fall out of this pattern in a few lines. The recurring traps are mixing real and fake clocks, missing `BlockUntil`, and `AfterFunc` callbacks racing the test assertion.
