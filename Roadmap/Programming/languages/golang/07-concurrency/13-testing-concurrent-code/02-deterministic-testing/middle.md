# Deterministic Testing — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Testing Toolbox at Middle](#the-testing-toolbox-at-middle)
3. [`testing/synctest` — Go 1.24+](#testingsynctest-go-124)
4. [Inside `synctest.Run` — Bubbles and Isolation](#inside-synctestrun-bubbles-and-isolation)
5. [`synctest.Wait` — Detecting Quiescence](#synctestwait-detecting-quiescence)
6. [Virtual Time Inside a Bubble](#virtual-time-inside-a-bubble)
7. [Fake Clocks Outside `synctest`](#fake-clocks-outside-synctest)
8. [Injecting `time.Now` — Dependency Patterns](#injecting-timenow-dependency-patterns)
9. [`clockwork`, `benbjohnson/clock`, and `quartz`](#clockwork-benbjohnsonclock-and-quartz)
10. [Quiescent-State Testing](#quiescent-state-testing)
11. [Pseudo-Random Seeds for Reproducibility](#pseudo-random-seeds-for-reproducibility)
12. [Rewriting a Flaky Cache Test End-to-End](#rewriting-a-flaky-cache-test-end-to-end)
13. [Rewriting a Flaky Retry Test End-to-End](#rewriting-a-flaky-retry-test-end-to-end)
14. [Anti-Patterns at Middle](#anti-patterns-at-middle)
15. [Coding Style for Deterministic Tests](#coding-style-for-deterministic-tests)
16. [`-count`, `-race`, and `-cpu` in CI](#-count--race-and--cpu-in-ci)
17. [Common Errors and Recoveries](#common-errors-and-recoveries)
18. [Self-Assessment](#self-assessment)
19. [Summary](#summary)

---

## Introduction

At junior level you learned the rule: never use `time.Sleep` to synchronise a test, always use a channel or WaitGroup as an explicit barrier. That rule covers maybe 60% of concurrent tests. The remaining 40% involve **time** itself — timeouts, backoffs, TTLs, scheduled tasks, debouncers, circuit breakers — and you cannot test those with channels alone.

This file covers the middle-level toolbox:

- **`testing/synctest`** (Go 1.24+, experimental): a bubble of controlled goroutines with virtual time. Inside a bubble, the scheduler is co-operative and time advances only when every goroutine is blocked. This is the single biggest improvement to Go concurrent testing in a decade.
- **Fake clocks**: a `Clock` interface that replaces `time.Now`, `time.After`, `time.NewTimer`. Tests advance time manually. Libraries: `github.com/jonboulle/clockwork`, `github.com/benbjohnson/clock`, `cdr.dev/slog/sloggers/sloghuman` (no), `github.com/coder/quartz`.
- **Quiescent-state testing**: instead of asserting after a fixed duration, wait until the system stops doing work, then assert.
- **Reproducible randomness**: seed all `math/rand` use with a fixed value; log the seed; failures replay exactly.

By the end you will be comfortable rewriting any flaky test that involves time or background goroutines. You will know when to reach for `synctest`, when a hand-rolled fake clock is enough, and when neither is needed.

---

## The Testing Toolbox at Middle

| Tool | When to use |
|------|-------------|
| `chan struct{}` barrier | One-shot "goroutine finished" |
| `sync.WaitGroup` | N independent goroutines completed |
| `for range out` drain | Pipeline-style test |
| `errgroup.Group` | Goroutines that may error |
| Injected `Clock` interface | Anything that touches time |
| `testing/synctest` (1.24+) | Time + concurrency together |
| `goleak.VerifyTestMain` | Confirm no goroutine leaks |
| `-count=N -race` | Catch low-frequency flakes |
| `-cpu 1,2,4,8` | Spot CPU-count-dependent assumptions |

The middle-level skill is choosing the right tool for the situation and combining them cleanly.

---

## `testing/synctest` — Go 1.24+

Go 1.24 introduces an experimental package, `testing/synctest`, that solves the hardest part of concurrent testing: combining concurrency with time. To enable it on 1.24, build with `GOEXPERIMENT=synctest`. In 1.25+ it is graduated and importable directly.

```go
import "testing/synctest"

func TestRetryBackoff(t *testing.T) {
    synctest.Run(func() {
        // Inside this bubble:
        //   - time.Now starts at a fixed value
        //   - time.Sleep does not consume wall-clock time
        //   - goroutines spawned here are tracked
        //   - synctest.Wait() blocks until all bubble goroutines are blocked
    })
}
```

What you get inside `synctest.Run`:

1. **Isolated time.** Calls to `time.Now`, `time.Sleep`, `time.After`, `time.NewTimer` use a *virtual clock*. The clock advances only when every goroutine in the bubble is blocked on something that depends on time.
2. **Goroutine tracking.** Goroutines started inside the bubble are tracked. `synctest.Wait` waits for all of them to be blocked.
3. **Deterministic scheduling.** The scheduler treats the bubble as one logical unit; preemption rules do not surprise you.
4. **No leak.** When `Run` returns, all bubble goroutines must have exited. Otherwise it panics. This catches leaks automatically.

The simplest possible bubble:

```go
func TestSimpleBubble(t *testing.T) {
    synctest.Run(func() {
        start := time.Now()
        time.Sleep(10 * time.Second)
        elapsed := time.Since(start)
        if elapsed != 10*time.Second {
            t.Fatalf("virtual time: got %v want 10s", elapsed)
        }
    })
}
```

The `time.Sleep(10 * time.Second)` returns immediately in wall-clock time but advances the virtual clock by exactly 10 seconds. The test runs in microseconds.

---

## Inside `synctest.Run` — Bubbles and Isolation

A **bubble** is the set of goroutines started by `synctest.Run(f)` and any goroutines they themselves start. Bubble goroutines are:

- Subject to the bubble's virtual clock.
- Tracked for `synctest.Wait`.
- Required to exit before `Run` returns.

Goroutines outside the bubble — including the main test goroutine before `Run` is called, or goroutines started in `TestMain` — are unaffected.

```go
func TestBubble(t *testing.T) {
    // Outside bubble — real time.
    realStart := time.Now()

    synctest.Run(func() {
        // Inside bubble — virtual time.
        bubbleStart := time.Now() // virtual t=0

        go func() {
            time.Sleep(time.Hour) // advances virtual clock
        }()

        synctest.Wait() // waits for the goroutine above to block

        // Now virtual clock has advanced by 1 hour.
        if elapsed := time.Since(bubbleStart); elapsed != time.Hour {
            t.Fatalf("got %v want 1h", elapsed)
        }
    })

    // Outside bubble — real time.
    realElapsed := time.Since(realStart)
    // realElapsed is microseconds, not an hour.
}
```

The bubble draws a clean boundary. You can mix real-time and virtual-time logic in the same test.

### Bubbles cannot leak goroutines

If a goroutine inside the bubble fails to exit before `Run` returns, the runtime panics. This is intentional: leak detection comes free.

```go
synctest.Run(func() {
    go func() {
        for {} // never exits
    }()
})
// panics: "synctest: goroutine remained running after Run returned"
```

This forces you to write clean shutdown logic inside the bubble.

---

## `synctest.Wait` — Detecting Quiescence

`synctest.Wait()` blocks the calling goroutine until **every other goroutine in the bubble is blocked**. "Blocked" means waiting on a channel, mutex, timer, or other synchronisation primitive — not running.

This is the most useful primitive in `synctest`. It replaces every `time.Sleep(100 * time.Millisecond)` you ever wrote in a test:

```go
// BEFORE
go worker.Start()
time.Sleep(100 * time.Millisecond) // hope worker has reached steady state
worker.Submit(task)

// AFTER (inside synctest.Run)
go worker.Start()
synctest.Wait() // worker is now blocked, waiting for input
worker.Submit(task)
```

`Wait` is **the** deterministic alternative to "give it a moment." It returns instantly in wall-clock time but only when the system is truly idle.

### When `Wait` returns

It returns when:

- All other bubble goroutines are blocked on a channel send/receive, mutex, semaphore, or timer.
- All other bubble goroutines have exited.
- Or both.

It does **not** return while any other goroutine is runnable. So you can be confident the system has reached a stable point.

### When `Wait` deadlocks

If every goroutine (including the caller) is blocked, the bubble deadlocks and the runtime reports it. This is a fast, clear failure — not a hang.

### Wait and Time interact

If goroutines are blocked on `time.Sleep` or `time.After`, the virtual clock advances to the soonest deadline, then those goroutines wake up. So:

```go
synctest.Run(func() {
    go func() {
        time.Sleep(time.Minute)
        fmt.Println("woke")
    }()
    synctest.Wait() // virtual clock jumps to t=1m, goroutine wakes, runs, exits
    // "woke" has printed by this point
})
```

This is the magic that makes TTL and backoff tests instantaneous.

---

## Virtual Time Inside a Bubble

Virtual time is the bubble's biggest feature. Operations that depend on time:

- `time.Now`: returns the bubble's current virtual time.
- `time.Sleep(d)`: advances virtual time by `d` (when the bubble can advance).
- `time.After(d)`: returns a channel that fires at virtual t+d.
- `time.NewTimer(d)`, `time.NewTicker(d)`: scheduled in virtual time.

A 1-hour timeout test runs in microseconds. A retry loop with 30 seconds of backoff between attempts completes in real-time microseconds.

```go
func TestTimeout(t *testing.T) {
    synctest.Run(func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()

        done := make(chan struct{})
        go func() {
            <-ctx.Done()
            close(done)
        }()

        synctest.Wait() // goroutine is waiting on ctx.Done; virtual clock advances to 5s
        select {
        case <-done:
            // expected
        default:
            t.Fatal("ctx did not cancel after 5 virtual seconds")
        }
    })
}
```

In real time the test finishes in under 100 microseconds.

---

## Fake Clocks Outside `synctest`

On Go versions before 1.24, or when you cannot use `testing/synctest` for some reason (e.g., your code interacts with the OS in ways the bubble does not support), you fall back to an injected `Clock` interface and a fake implementation.

The pattern:

```go
type Clock interface {
    Now() time.Time
    Sleep(d time.Duration)
    After(d time.Duration) <-chan time.Time
    NewTimer(d time.Duration) Timer
}

type Timer interface {
    C() <-chan time.Time
    Stop() bool
    Reset(d time.Duration) bool
}
```

Production uses a `realClock` whose methods call `time.Now()`, `time.Sleep`, etc. Tests use a `fakeClock` that maintains a virtual time field and advances on demand.

Hand-rolled fake clock (simplified):

```go
type fakeClock struct {
    mu     sync.Mutex
    now    time.Time
    timers []*fakeTimer
}

func newFakeClock(t time.Time) *fakeClock { return &fakeClock{now: t} }

func (c *fakeClock) Now() time.Time {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
    c.mu.Lock()
    c.now = c.now.Add(d)
    fired := make([]*fakeTimer, 0)
    remaining := make([]*fakeTimer, 0)
    for _, t := range c.timers {
        if !t.fireAt.After(c.now) {
            fired = append(fired, t)
        } else {
            remaining = append(remaining, t)
        }
    }
    c.timers = remaining
    c.mu.Unlock()
    for _, t := range fired {
        t.ch <- c.now
    }
}
```

Real-world libraries handle the edge cases for you. Recommend one of:

- **`github.com/jonboulle/clockwork`** — small, popular, simple `FakeClock` with `Advance`.
- **`github.com/benbjohnson/clock`** — slightly richer; also widely used.
- **`github.com/coder/quartz`** — newer, designed around the synctest model.

The injection pattern is universal: production wires `realClock`, tests wire `fakeClock`.

---

## Injecting `time.Now` — Dependency Patterns

The classic mistake is hard-coding `time.Now()` calls deep inside your code. Refactor to inject a clock at construction time:

```go
// BEFORE: untestable.
type Cache struct {
    items map[string]entry
}

func (c *Cache) Set(k, v string, ttl time.Duration) {
    c.items[k] = entry{value: v, expiresAt: time.Now().Add(ttl)}
}

// AFTER: testable.
type Clock interface {
    Now() time.Time
}

type Cache struct {
    clock Clock
    items map[string]entry
}

func New(clock Clock) *Cache {
    return &Cache{clock: clock, items: make(map[string]entry)}
}

func (c *Cache) Set(k, v string, ttl time.Duration) {
    c.items[k] = entry{value: v, expiresAt: c.clock.Now().Add(ttl)}
}
```

In tests:

```go
clk := clockwork.NewFakeClock()
cache := New(clk)
cache.Set("k", "v", 10*time.Second)
clk.Advance(5 * time.Second)
// not yet expired
clk.Advance(6 * time.Second)
// now expired
```

The change is small but it makes every time-dependent test deterministic.

### Default-constructed clocks

For ergonomics, allow `nil` to mean "use real clock":

```go
func New(clock Clock) *Cache {
    if clock == nil {
        clock = realClock{}
    }
    return &Cache{clock: clock, items: make(map[string]entry)}
}
```

Now production code `New(nil)` works as expected, and tests pass `New(fakeClock)`.

---

## `clockwork`, `benbjohnson/clock`, and `quartz`

A quick library comparison:

| Library | API style | Best for |
|---------|-----------|----------|
| `jonboulle/clockwork` | `clock.Now()`, `clock.Sleep()`, `clock.After()`, fake supports `Advance`, `BlockUntilContext` | Most projects, mature, simple |
| `benbjohnson/clock` | `clock.Now()`, `clock.Timer(d)`, `clock.Ticker(d)`, fake supports `Add` | Projects that need full timer/ticker semantics |
| `coder/quartz` | Designed for `synctest` interop, smaller surface | New projects on Go 1.24+ |

Both `clockwork` and `benbjohnson/clock` give you a `FakeClock` whose `Advance(d)` or `Add(d)` moves virtual time and fires any pending timers/tickers. Both also expose `BlockUntilContext` / blocking helpers to wait for a goroutine to subscribe before advancing.

A common pattern with `clockwork`:

```go
clk := clockwork.NewFakeClock()
go func() {
    <-clk.After(time.Minute)
    close(done)
}()
// goroutine subscribed
clk.BlockUntilContext(ctx, 1) // wait until 1 timer subscribed
clk.Advance(time.Minute)
<-done
```

`BlockUntilContext` avoids the race where the test advances the clock *before* the goroutine has called `After`. Without it the goroutine subscribes to a timer that has already fired and waits forever.

---

## Quiescent-State Testing

A **quiescent state** is a moment when no goroutine is making progress. Every goroutine is blocked on a channel, mutex, timer, or has exited. The system is "at rest."

Quiescence is the right moment to assert. Asserting earlier risks reading mid-transition state. Asserting later wastes time and may interleave with new activity.

Three ways to detect quiescence:

1. **`testing/synctest.Wait`** — built in, gold standard on Go 1.24+.
2. **Hand-rolled "all blocked" detection** — using `runtime.Stack` to inspect goroutine states. Brittle but possible.
3. **Domain-specific quiescence signals** — `worker.WaitIdle()`, `pool.Drain()` etc. Best when feasible.

For most code, design a quiescence API explicitly:

```go
type Worker struct {
    in    chan Task
    idle  chan struct{}
}

func (w *Worker) loop() {
    for {
        select {
        case t, ok := <-w.in:
            if !ok {
                return
            }
            t.Run()
        default:
            // mark idle
            select {
            case w.idle <- struct{}{}:
            default:
            }
        }
    }
}

func (w *Worker) WaitIdle() { <-w.idle }
```

This is verbose. `synctest.Wait` is much nicer.

---

## Pseudo-Random Seeds for Reproducibility

If your tests use randomness — pick test inputs at random, shuffle order, generate property-based examples — seed the RNG with a known value:

```go
var seed = flag.Int64("seed", 0, "PRNG seed; 0 for time-based")

func TestSomething(t *testing.T) {
    s := *seed
    if s == 0 {
        s = time.Now().UnixNano()
    }
    t.Logf("seed=%d", s)
    rng := rand.New(rand.NewSource(s))
    // use rng
}
```

When the test fails, the log shows the seed. Re-run with `-seed=N` to reproduce the exact case.

For sub-tests, fan out from one root seed:

```go
root := rand.New(rand.NewSource(seed))
for i := 0; i < 100; i++ {
    sub := rand.New(rand.NewSource(root.Int63()))
    t.Run(fmt.Sprintf("case-%d", i), func(t *testing.T) {
        // use sub
    })
}
```

A seed-driven test is deterministic by construction. A seed-driven flake replays the failing case verbatim.

---

## Rewriting a Flaky Cache Test End-to-End

Suppose we have a TTL cache:

```go
type Cache struct {
    mu    sync.Mutex
    items map[string]entry
}

type entry struct {
    value     string
    expiresAt time.Time
}

func (c *Cache) Set(k, v string, ttl time.Duration) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.items[k] = entry{v, time.Now().Add(ttl)}
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    e, ok := c.items[k]
    if !ok || time.Now().After(e.expiresAt) {
        return "", false
    }
    return e.value, true
}
```

The flaky test:

```go
func TestCacheTTL_Flaky(t *testing.T) {
    c := &Cache{items: make(map[string]entry)}
    c.Set("k", "v", 50*time.Millisecond)
    if _, ok := c.Get("k"); !ok {
        t.Fatal("expected hit")
    }
    time.Sleep(100 * time.Millisecond) // hope TTL has expired
    if _, ok := c.Get("k"); ok {
        t.Fatal("expected miss after TTL")
    }
}
```

Three problems:

1. The test takes 100ms per run.
2. On slow CI, the cache might not have expired yet (clock skew, scheduling).
3. The test reads `time.Now` deep inside the cache; no way to control it from outside.

### Fix step 1: inject the clock

```go
type Clock interface {
    Now() time.Time
}

type Cache struct {
    clock Clock
    mu    sync.Mutex
    items map[string]entry
}

func New(clock Clock) *Cache {
    return &Cache{clock: clock, items: make(map[string]entry)}
}

func (c *Cache) Set(k, v string, ttl time.Duration) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.items[k] = entry{v, c.clock.Now().Add(ttl)}
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    e, ok := c.items[k]
    if !ok || c.clock.Now().After(e.expiresAt) {
        return "", false
    }
    return e.value, true
}
```

### Fix step 2: use a fake clock

```go
func TestCacheTTL_Deterministic(t *testing.T) {
    clk := clockwork.NewFakeClock()
    c := New(clk)

    c.Set("k", "v", 50*time.Millisecond)
    if _, ok := c.Get("k"); !ok {
        t.Fatal("expected hit at t=0")
    }

    clk.Advance(49 * time.Millisecond)
    if _, ok := c.Get("k"); !ok {
        t.Fatal("expected hit at t=49ms")
    }

    clk.Advance(2 * time.Millisecond) // total: 51ms
    if _, ok := c.Get("k"); ok {
        t.Fatal("expected miss at t=51ms")
    }
}
```

Result: runs in microseconds, passes on every machine, tests the exact boundary.

### Same test with `testing/synctest`

```go
func TestCacheTTL_Synctest(t *testing.T) {
    synctest.Run(func() {
        c := New(realClockUsingTimeNow{}) // virtual time inside the bubble
        c.Set("k", "v", 50*time.Millisecond)
        if _, ok := c.Get("k"); !ok {
            t.Fatal("expected hit at t=0")
        }
        time.Sleep(49 * time.Millisecond)
        if _, ok := c.Get("k"); !ok {
            t.Fatal("expected hit at t=49ms")
        }
        time.Sleep(2 * time.Millisecond)
        if _, ok := c.Get("k"); ok {
            t.Fatal("expected miss at t=51ms")
        }
    })
}
```

Here `realClockUsingTimeNow{}` calls `time.Now()` directly, but inside the bubble `time.Now` returns virtual time. So you do not even need a `Clock` interface — `synctest` takes care of it. The trade-off is the bubble's constraints; review the spec.

---

## Rewriting a Flaky Retry Test End-to-End

Suppose `Retry(ctx, fn, opts)` calls `fn` up to N times with exponential backoff:

```go
func Retry(ctx context.Context, fn func() error, max int, base time.Duration) error {
    var last error
    delay := base
    for i := 0; i < max; i++ {
        if err := fn(); err == nil {
            return nil
        } else {
            last = err
        }
        select {
        case <-time.After(delay):
        case <-ctx.Done():
            return ctx.Err()
        }
        delay *= 2
    }
    return last
}
```

A naive flaky test:

```go
func TestRetry_Flaky(t *testing.T) {
    calls := 0
    fn := func() error {
        calls++
        if calls < 3 { return errors.New("transient") }
        return nil
    }
    start := time.Now()
    err := Retry(context.Background(), fn, 5, 100*time.Millisecond)
    if err != nil { t.Fatal(err) }
    if calls != 3 { t.Fatalf("calls=%d want 3", calls) }
    // backoff was 100ms + 200ms = 300ms before success
    if elapsed := time.Since(start); elapsed < 250*time.Millisecond {
        t.Fatalf("too fast: %v", elapsed)
    }
}
```

300ms minimum, hard to keep under timeouts in CI, and the timing assertion is intrinsically brittle.

### Synctest rewrite

```go
func TestRetry_Synctest(t *testing.T) {
    synctest.Run(func() {
        calls := 0
        fn := func() error {
            calls++
            if calls < 3 { return errors.New("transient") }
            return nil
        }
        start := time.Now()
        err := Retry(context.Background(), fn, 5, 100*time.Millisecond)
        if err != nil { t.Fatal(err) }
        if calls != 3 { t.Fatalf("calls=%d want 3", calls) }
        elapsed := time.Since(start)
        want := 300 * time.Millisecond
        if elapsed != want {
            t.Fatalf("virtual elapsed %v want %v", elapsed, want)
        }
    })
}
```

The test runs in microseconds and asserts an *exact* virtual duration. No flake possible.

### Clockwork rewrite (Go <1.24 or no-synctest)

```go
func Retry(ctx context.Context, clk clockwork.Clock, fn func() error, max int, base time.Duration) error {
    var last error
    delay := base
    for i := 0; i < max; i++ {
        if err := fn(); err == nil {
            return nil
        } else {
            last = err
        }
        select {
        case <-clk.After(delay):
        case <-ctx.Done():
            return ctx.Err()
        }
        delay *= 2
    }
    return last
}

func TestRetry_Clockwork(t *testing.T) {
    clk := clockwork.NewFakeClock()
    calls := 0
    fn := func() error {
        calls++
        if calls < 3 { return errors.New("transient") }
        return nil
    }
    done := make(chan error, 1)
    go func() { done <- Retry(context.Background(), clk, fn, 5, 100*time.Millisecond) }()

    // Each Retry iteration calls fn, then subscribes to clk.After.
    // We must wait for the subscription before advancing.
    clk.BlockUntilContext(context.Background(), 1)
    clk.Advance(100 * time.Millisecond)
    clk.BlockUntilContext(context.Background(), 1)
    clk.Advance(200 * time.Millisecond)
    if err := <-done; err != nil { t.Fatal(err) }
    if calls != 3 { t.Fatalf("calls=%d want 3", calls) }
}
```

More moving parts than synctest but no real-time waits.

---

## Anti-Patterns at Middle

### Sleeping "just to be safe" in a synctest bubble

`synctest.Wait` and virtual `time.Sleep` already make sleep useless. Real `time.Sleep` inside a bubble advances virtual time, which is fine, but real waits outside a bubble defeat the purpose. Resist the urge.

### Advancing the fake clock before the goroutine subscribes

```go
go func() {
    <-clk.After(time.Second) // not yet subscribed when test advances
}()
clk.Advance(time.Second)
// goroutine waits forever
```

Use `BlockUntilContext` or equivalent to wait for the subscription.

### Mixing real and fake clocks

If half your dependencies use the injected fake clock and half use `time.Now` directly, the test is half deterministic. Pick a side. With `synctest`, this is automatic.

### Asserting wall-clock duration in tests

Even with a fast machine, `if elapsed > 50*time.Millisecond { t.Fatal }` is flaky. Use virtual elapsed or do not assert on duration at all.

### Using `t.Parallel` with shared fake clocks

A `clockwork.FakeClock` is per-test state. Two parallel subtests sharing one clock race against each other. Each test creates its own clock.

### Using `time.AfterFunc` outside synctest without a wrapper

`time.AfterFunc` schedules a callback. Tests cannot intercept it without wrapping. Wrap it: `func (c *Clock) AfterFunc(d, fn) Timer`.

---

## Coding Style for Deterministic Tests

- One bubble per test. Do not nest `synctest.Run` (the runtime disallows it anyway).
- One fake clock per test. Pass it explicitly to each constructor.
- Helpers like `advanceAndWait(clk, d)` reduce boilerplate.
- Name virtual durations as constants: `const backoff = 100 * time.Millisecond`.
- Log virtual time in failure messages: `t.Fatalf("at t=%v: got %v", clk.Now(), got)`.
- Keep bubble functions short. If a bubble body grows past 50 lines, extract sub-helpers (still inside the bubble).

---

## `-count`, `-race`, and `-cpu` in CI

A solid concurrent test pipeline runs three jobs:

1. **Standard.** `go test ./...` — fast, gated on every PR.
2. **Race.** `go test -race ./...` — gated on every PR.
3. **Stress.** `go test -race -count=100 ./internal/concurrent/...` — nightly.

For especially load-sensitive areas, add a fourth job that varies CPU:

```
go test -race -cpu 1,2,4,8 -count=20 ./internal/scheduler/
```

`-cpu 1,2,4,8` runs each test four times, once with `GOMAXPROCS=1`, then 2, 4, 8. Tests that depend on a particular `GOMAXPROCS` will fail one of these, surfacing the assumption.

The stress job catches bugs that show up once in 100 runs. The CPU sweep catches bugs that depend on parallel scheduling. Together they leave very little room for flakes to survive.

---

## Common Errors and Recoveries

### "synctest: goroutine remained running"

A bubble goroutine did not exit before `Run` returned. Find it: usually a missing `cancel()`, a missing `close(ch)`, or a goroutine still waiting on a channel. Fix the shutdown path in the code under test.

### "synctest: deadlock"

Every goroutine in the bubble is blocked and none can advance. Cause: either you forgot to send on a channel, or `synctest.Wait` waited on a no-progress state. Add a missing send/close.

### Fake clock advances but goroutine still waits

The goroutine subscribed *after* the advance. Use `BlockUntilContext` before advancing, or restructure to advance only after the subscription.

### "test passes locally, fails in CI"

Almost certainly a real-time assumption. Check for `time.Sleep`, `time.After` without a fake clock, or assertions on `time.Since`.

### `go test -count=N` keeps the same TestMain state

Yes, `TestMain` runs once per test binary, not once per `-count` iteration. Be careful about global state in `TestMain`.

---

## Self-Assessment

- [ ] I can write a `synctest.Run` test that exercises a 1-hour timeout in microseconds.
- [ ] I can refactor a `Cache` that calls `time.Now` to accept an injected clock.
- [ ] I know when to use `synctest.Wait` instead of `time.Sleep`.
- [ ] I can use `clockwork.BlockUntilContext` correctly.
- [ ] I can explain why a fake clock advance before subscription causes a hang.
- [ ] I run new concurrent tests with `-race -count=50 -cpu 1,2,4,8`.
- [ ] I seed `math/rand` for reproducibility and log the seed.
- [ ] I detect quiescence with `synctest.Wait`, not `time.Sleep`.

---

## Summary

Middle-level deterministic testing is about taming time. `testing/synctest` (Go 1.24+) wraps a block of test code in a bubble where time is virtual, goroutines are tracked, and `Wait` blocks until the system is quiescent. Outside the bubble, an injected `Clock` interface with a fake implementation (`clockwork`, `benbjohnson/clock`, or `quartz`) gives the same control with more boilerplate. The discipline is to never depend on wall-clock duration in a test, to advance time deliberately, and to use repeat-runs (`-count`, `-race`, `-cpu`) to confirm stability. Master these tools and 95% of concurrent tests become deterministic, fast, and trustworthy.
