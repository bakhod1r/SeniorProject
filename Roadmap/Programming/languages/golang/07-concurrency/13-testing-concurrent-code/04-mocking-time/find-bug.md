# Mocking Time — Find the Bug

Ten code snippets. Each contains at least one bug related to mocking time. Read carefully, identify the bug, write a hypothesis, then check the explanation.

## Table of Contents
1. [Bug 1: `Advance` Before Arming](#bug-1-advance-before-arming)
2. [Bug 2: `AfterFunc` Race](#bug-2-afterfunc-race)
3. [Bug 3: Stray `time.Tick`](#bug-3-stray-timetick)
4. [Bug 4: Real `time.Sleep` in Test](#bug-4-real-timesleep-in-test)
5. [Bug 5: Mixed Clocks](#bug-5-mixed-clocks)
6. [Bug 6: `context.WithTimeout` Under Fake Clock](#bug-6-contextwithtimeout-under-fake-clock)
7. [Bug 7: Leaking Timer in a Loop](#bug-7-leaking-timer-in-a-loop)
8. [Bug 8: `synctest` and Real I/O](#bug-8-synctest-and-real-io)
9. [Bug 9: Shared `FakeClock` Across `t.Parallel`](#bug-9-shared-fakeclock-across-tparallel)
10. [Bug 10: Boundary Off-By-One](#bug-10-boundary-off-by-one)

---

## Bug 1: `Advance` Before Arming

```go
func TestRetry(t *testing.T) {
    fc := clockwork.NewFakeClock()
    op := func() error { return errors.New("fail") }

    go retry.Do(context.Background(), fc, 3, op)

    fc.Advance(100 * time.Millisecond)
    fc.Advance(200 * time.Millisecond)
    fc.Advance(400 * time.Millisecond)
    // assert (omitted)
}
```

**Hypothesis space.** Read it. What is fragile?

<details>
<summary>Answer</summary>

The three `Advance` calls run from the test goroutine; meanwhile the retry's goroutine has not necessarily reached `clock.After(100*time.Millisecond)`. On a fast machine the first `Advance` likely runs before the timer is armed and therefore fires nothing. The test passes most runs and flakes others.

**Fix.** `BlockUntil(1)` before each `Advance`:

```go
fc.BlockUntil(1)
fc.Advance(100 * time.Millisecond)
fc.BlockUntil(1)
fc.Advance(200 * time.Millisecond)
fc.BlockUntil(1)
fc.Advance(400 * time.Millisecond)
```
</details>

---

## Bug 2: `AfterFunc` Race

```go
func TestSchedulerFires(t *testing.T) {
    fc := clockwork.NewFakeClock()
    var ran bool
    fc.AfterFunc(time.Second, func() { ran = true })
    fc.Advance(time.Second)
    if !ran {
        t.Fatal("callback should have run")
    }
}
```

<details>
<summary>Answer</summary>

Two problems.

1. **Data race.** The callback runs on the fake clock's internal goroutine; the test goroutine reads `ran` without synchronisation. `go test -race` flags it.
2. **Visibility timing.** Even ignoring the race, `Advance` may return before the callback runs to completion; the bool may be false even on a normal CPU.

**Fix.** Synchronise on a channel:

```go
done := make(chan struct{})
fc.AfterFunc(time.Second, func() { close(done) })
fc.Advance(time.Second)
<-done
```
</details>

---

## Bug 3: Stray `time.Tick`

```go
type Cache struct {
    clock clockwork.Clock
    // ...
}

func (c *Cache) Start() {
    go func() {
        for range time.Tick(time.Minute) {
            c.evictExpired()
        }
    }()
}
```

<details>
<summary>Answer</summary>

`time.Tick` is a real-time ticker, ignoring the injected clock. A fake-clock test never triggers eviction; the cache's background sweep cannot be tested without waiting a real minute.

**Secondary bug:** `time.Tick` cannot be stopped. The goroutine leaks forever.

**Fix.**

```go
func (c *Cache) Start() {
    go func() {
        t := c.clock.NewTicker(time.Minute)
        defer t.Stop()
        for range t.Chan() {
            c.evictExpired()
        }
    }()
}
```
</details>

---

## Bug 4: Real `time.Sleep` in Test

```go
func TestLimiterRefills(t *testing.T) {
    fc := clockwork.NewFakeClock()
    l := ratelimit.New(fc, 1, 5)
    for i := 0; i < 5; i++ { l.Allow() }

    time.Sleep(time.Second) // give time to refill
    if !l.Allow() {
        t.Fatal("should refill")
    }
}
```

<details>
<summary>Answer</summary>

`time.Sleep` waits real time, but the limiter reads `fc.Now()`. The fake clock never moved; the bucket is still empty. The test fails *and* wastes a second of CI time.

**Fix.**

```go
fc.Advance(time.Second)
if !l.Allow() {
    t.Fatal("should refill")
}
```
</details>

---

## Bug 5: Mixed Clocks

```go
func New(ttl time.Duration) *Cache {
    return &Cache{
        clock: clockwork.NewRealClock(),
        ttl:   ttl,
    }
}

func (c *Cache) WithClock(clock clockwork.Clock) *Cache {
    c.clock = clock
    return c
}

// in main:
cache := cache.New(5 * time.Minute)

// in test:
fc := clockwork.NewFakeClock()
cache := cache.New(5 * time.Minute).WithClock(fc)
```

<details>
<summary>Answer</summary>

The constructor *starts* the background sweeper using the real clock; `WithClock` swaps the field after the goroutine is already running. The sweeper still ticks on real time.

**Fix.** Accept the clock at construction, do not allow swapping after the type has spawned goroutines:

```go
func New(clock clockwork.Clock, ttl time.Duration) *Cache { ... }
```

If you must support both ergonomics, use a functional option:

```go
func New(ttl time.Duration, opts ...Option) *Cache
```
</details>

---

## Bug 6: `context.WithTimeout` Under Fake Clock

```go
func TestOpDeadline(t *testing.T) {
    fc := clockwork.NewFakeClock()
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    err := slowOp(ctx, fc) // blocks on fc.After(time.Hour)
    fc.Advance(2 * time.Second)
    if err != context.DeadlineExceeded { t.Fatal(err) }
}
```

<details>
<summary>Answer</summary>

`context.WithTimeout` reads `time.Now` and arms a real timer. `fc.Advance` does not move that real timer. `slowOp` blocks on `fc.After(time.Hour)`; the test hangs for an hour of real time (or one second if the context deadline expires first, but in the meantime the op did not receive the fake-time advance signal correctly).

**Fix.** Use a fake-clock-aware cancel helper, or wrap the whole test in `synctest.Run` (Go 1.24+), where `context.WithTimeout` becomes fake too.

```go
ctx, cancel := CancelOn(context.Background(), fc, time.Second)
defer cancel()
```
</details>

---

## Bug 7: Leaking Timer in a Loop

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-clock.After(time.Hour):
        process()
    }
}
```

<details>
<summary>Answer</summary>

Each iteration that picks `ctx.Done` leaks the underlying timer in `After`. On a real clock the goroutine lives for an hour after each cancel. On a fake clock the timer leak is invisible but still occupies memory until GC.

**Fix.** Use `NewTimer` and `Stop`/`Reset`:

```go
t := clock.NewTimer(time.Hour)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.Chan():
        process()
        t.Reset(time.Hour)
    }
}
```
</details>

---

## Bug 8: `synctest` and Real I/O

```go
func TestServerScrape(t *testing.T) {
    synctest.Run(func() {
        s := startRealHTTPServer()
        defer s.Close()
        c := scraper.New(s.URL)
        time.Sleep(time.Minute) // expect: many scrape ticks happen
        if c.Count() < 10 {
            t.Fatalf("got %d scrapes", c.Count())
        }
    })
}
```

<details>
<summary>Answer</summary>

`startRealHTTPServer` makes real-time syscalls (`net.Listen`, `accept`, `read`). The bubble cannot advance fake time while any goroutine is blocked on a syscall. `time.Sleep(time.Minute)` hangs for a real minute or times out.

**Fix.** Use an in-memory HTTP transport so all communication stays inside the bubble, or use `clockwork` and inject the clock without `synctest`.
</details>

---

## Bug 9: Shared `FakeClock` Across `t.Parallel`

```go
var globalFC = clockwork.NewFakeClock()

func TestA(t *testing.T) {
    t.Parallel()
    c := cache.New(globalFC, time.Minute)
    c.Set("a", "1")
    globalFC.Advance(2 * time.Minute)
    // ...
}

func TestB(t *testing.T) {
    t.Parallel()
    c := cache.New(globalFC, time.Hour)
    c.Set("b", "2")
    globalFC.Advance(30 * time.Minute)
    // expects entry to still be valid
}
```

<details>
<summary>Answer</summary>

Two parallel tests share a single fake clock. `TestA` advances 2 minutes; `TestB` advances 30 minutes. Each test sees a clock that is moved by the other test's `Advance`. Assertions break in unpredictable ways.

**Fix.** Each test constructs its own `FakeClock`:

```go
func TestA(t *testing.T) {
    t.Parallel()
    fc := clockwork.NewFakeClock()
    // ...
}
```

Globals are a bad fit for parallel tests in general; fake clocks are no exception.
</details>

---

## Bug 10: Boundary Off-By-One

```go
func TestExpiryBoundary(t *testing.T) {
    fc := clockwork.NewFakeClock()
    c := cache.New(fc, 5*time.Second)
    c.Set("k", "v")

    fc.Advance(5 * time.Second)
    if _, ok := c.Get("k"); !ok {
        t.Fatal("entry should still be valid at exactly the TTL")
    }
}
```

The cache's `Get` checks:

```go
if c.clock.Now().After(e.expireAt) { delete }
```

<details>
<summary>Answer</summary>

`time.Time.After` is *strict*: `t.After(t) == false`. The entry was set at `now=0` with `expireAt = 5s`. After `Advance(5s)`, `Now() == 5s == expireAt`. `After` returns false; the entry is *not* deleted. The test expects "still valid at exactly TTL" and passes — which contradicts most intuitive specifications of "TTL = 5 seconds" (usually understood as "gone at 5s").

This is a *specification* bug. Either:

- Document "TTL is the duration of validity; expires at `T+TTL+ε`," and accept this test.
- Or change `Get` to `Now().Before(expireAt) == false → delete` (i.e., expire *at* the boundary).

In practice many caches choose one convention; the bug is having the convention be ambiguous or undocumented. Pick one and stick with it. Test both `Advance(5*time.Second)` and `Advance(5*time.Second + time.Nanosecond)` to lock the contract.
</details>

---

## Bonus Bug: Negative `Advance`

```go
fc := clockwork.NewFakeClock()
deadline := fc.Now().Add(time.Hour)
fc.Advance(-30 * time.Minute) // simulate NTP step-back
// ...
fc.Advance(90 * time.Minute) // total = +60 min, expecting deadline to fire
```

<details>
<summary>Answer</summary>

A backwards `Advance` of 30 min, then a forward 90 min, leaves the clock at +60 minutes — short of the deadline at +1 hour. The deadline was set at the original start. Net forward motion is 60 min, not 90. The timer at +60 fires (it's right at the boundary depending on `After` strictness), the one at +1 hour does not.

**Fix.** Be precise about cumulative time. Negative advances reduce net forward motion. If your goal is to simulate NTP step-back while still firing the original deadline, advance further forward afterwards.
</details>

---

## How to use this file

Read each snippet carefully *before* opening the answer. Write your hypothesis on paper. Compare. If you got eight out of ten on first read, you have internalised the patterns. If you got fewer, re-read junior.md and middle.md and try again.
