# Mocking Time — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing Time-Aware APIs](#designing-time-aware-apis)
3. [Schedulers and Cron-Style Tasks](#schedulers-and-cron-style-tasks)
4. [Heartbeat, Lease, and Leader Election](#heartbeat-lease-and-leader-election)
5. [Hybrid Logical Clocks and Distributed Time](#hybrid-logical-clocks-and-distributed-time)
6. [Testing Across Goroutine Trees](#testing-across-goroutine-trees)
7. [Combining Fake Clocks with `context`](#combining-fake-clocks-with-context)
8. [Test-Suite Architecture for Time-Heavy Code](#test-suite-architecture-for-time-heavy-code)
9. [Operational Concerns: Real-Time Drift, NTP Jumps, Sleep Anomalies](#operational-concerns-real-time-drift-ntp-jumps-sleep-anomalies)
10. [Anti-Patterns at Scale](#anti-patterns-at-scale)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)

---

## Introduction

At middle level you knew the libraries and could write a fake-clock test for a TTL cache. Senior level is where you decide what testable looks like for an entire subsystem — a scheduler, a distributed lease, a replication protocol. You are the person who reviews PRs and says "this is testable" or "rip this out and inject a clock." That requires not just knowing how `clockwork.Advance` works but having a strong sense of:

- What APIs should look like so they remain testable two years later.
- Where time crosses goroutine boundaries and how to keep the fake clock unified.
- How to model real-world clock anomalies (NTP jumps, sleep, suspend) in tests.
- How to keep a 5,000-test suite fast and deterministic when half the tests touch time.

This file is opinionated. The patterns here come from Kubernetes, etcd, CockroachDB, and similar systems where a single time bug can take a region down.

---

## Designing Time-Aware APIs

### Take a clock; do not take "current time" as a parameter

A common middle-level mistake is to write:

```go
func (s *Session) Expired(now time.Time) bool {
    return now.After(s.deadline)
}
```

It looks injectable. It is not. Now every caller has to remember to pass a consistent `now`, and the API has lost the ability to schedule its own work (`After`, `NewTimer`). The right shape:

```go
type Session struct {
    clock Clock
    // ...
}
func (s *Session) Expired() bool {
    return s.clock.Now().After(s.deadline)
}
```

A `Clock` is a long-lived dependency, like a `*sql.DB`. Inject it once at construction.

### Hide the clock from the public API

Callers should not have to know your type uses a clock. The exported signature should be the same as the standard library equivalent:

```go
type Cache struct {
    clock Clock // unexported
}

func NewCache(ttl time.Duration, opts ...Option) *Cache { ... } // clock via Option
```

If your library is well known, exposing `WithClock` as an option is fine. Forcing every caller to pass a real clock is not.

### Functional options for the clock

```go
type Option func(*Cache)
func WithClock(c Clock) Option { return func(x *Cache) { x.clock = c } }

func NewCache(ttl time.Duration, opts ...Option) *Cache {
    c := &Cache{clock: clockwork.NewRealClock(), ttl: ttl}
    for _, o := range opts { o(c) }
    return c
}
```

Production: `NewCache(5 * time.Minute)`. Tests: `NewCache(5*time.Minute, WithClock(fc))`.

### A Clock interface per package vs a shared one

For a small library, define a one-method `Clock` interface in your own package. It documents what your library actually uses and means callers can supply a minimal fake.

For a large application, define one `Clock` interface (or import `clockwork.Clock` directly) and use it everywhere. The cost of one big interface is small; the benefit of consistency is large.

---

## Schedulers and Cron-Style Tasks

A scheduler is the canonical time-driven system. Cron, Kubernetes CronJobs, GitHub Actions schedules — all of them.

### Design

```go
type Scheduler struct {
    clock clockwork.Clock
    jobs  []job
}

type job struct {
    name string
    next time.Time
    every time.Duration
    fn   func(context.Context) error
}

func (s *Scheduler) Run(ctx context.Context) error {
    for {
        s.mu.Lock()
        var nextJob *job
        for i := range s.jobs {
            if nextJob == nil || s.jobs[i].next.Before(nextJob.next) {
                nextJob = &s.jobs[i]
            }
        }
        s.mu.Unlock()

        if nextJob == nil {
            return nil
        }
        wait := nextJob.next.Sub(s.clock.Now())
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-s.clock.After(wait):
            _ = nextJob.fn(ctx)
            nextJob.next = nextJob.next.Add(nextJob.every)
        }
    }
}
```

### Test

```go
func TestSchedulerFiresOnSchedule(t *testing.T) {
    fc := clockwork.NewFakeClock()
    s := &Scheduler{clock: fc}
    fires := make(chan string, 10)
    s.AddJob("a", 5*time.Minute, func(ctx context.Context) error {
        fires <- "a"
        return nil
    })

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    go s.Run(ctx)

    for i := 0; i < 3; i++ {
        fc.BlockUntil(1)
        fc.Advance(5 * time.Minute)
        if name := <-fires; name != "a" {
            t.Fatalf("got %q", name)
        }
    }
}
```

Three fires of a 5-minute job in microseconds of wall time. The same test under real time would take 15 minutes.

### Cron expressions

Cron expressions like `0 3 * * *` (every day at 03:00 UTC) need a parser that takes a starting `time.Time` and returns the next fire time. Such parsers must accept the time, not call `time.Now`. The popular `robfig/cron/v3` package does this correctly — `Schedule.Next(t time.Time)` takes an explicit timestamp.

When you write your own cron-style scheduler, follow the same rule: parsing returns a `Schedule`, scheduling asks `Schedule.Next(clock.Now())`.

---

## Heartbeat, Lease, and Leader Election

A leader election in a distributed system holds a lease for, say, 10 seconds. The leader renews every 3 seconds. If a renewal misses by more than 10 seconds, the lease is considered expired and another node may become leader.

### Design

```go
type Lease struct {
    clock     Clock
    holder    string
    expireAt  time.Time
    duration  time.Duration
}

func (l *Lease) Renew(now time.Time) {
    l.expireAt = now.Add(l.duration)
}

func (l *Lease) Valid() bool {
    return l.clock.Now().Before(l.expireAt)
}
```

### Test for a missed heartbeat

```go
func TestLeaseExpiresOnMissedHeartbeat(t *testing.T) {
    fc := clockwork.NewFakeClock()
    l := &Lease{clock: fc, duration: 10 * time.Second}
    l.Renew(fc.Now())

    fc.Advance(9 * time.Second)
    if !l.Valid() {
        t.Fatal("still within lease")
    }

    fc.Advance(2 * time.Second) // 11s total
    if l.Valid() {
        t.Fatal("lease should have expired at 10s")
    }
}
```

### Test for a renewed lease

```go
func TestLeaseRenewExtends(t *testing.T) {
    fc := clockwork.NewFakeClock()
    l := &Lease{clock: fc, duration: 10 * time.Second}
    l.Renew(fc.Now())

    fc.Advance(9 * time.Second)
    l.Renew(fc.Now())            // renew at 9s
    fc.Advance(9 * time.Second)  // total 18s
    if !l.Valid() {
        t.Fatal("should still be valid after renewal")
    }
}
```

### A more complete leader loop

```go
type LeaderLoop struct {
    clock          Clock
    renewInterval  time.Duration
    leaseDuration  time.Duration
    onLost         func()
}

func (l *LeaderLoop) Run(ctx context.Context, renew func() error) error {
    ticker := l.clock.NewTicker(l.renewInterval)
    defer ticker.Stop()
    last := l.clock.Now()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-ticker.Chan():
            if err := renew(); err != nil {
                if l.clock.Now().Sub(last) > l.leaseDuration {
                    l.onLost()
                    return err
                }
                continue
            }
            last = l.clock.Now()
        }
    }
}
```

Testing this needs `BlockUntil` after every `Advance` because the ticker re-arms.

---

## Hybrid Logical Clocks and Distributed Time

In a distributed system, each node has its own clock. `time.Now()` on node A differs from node B by tens of milliseconds even under NTP. CockroachDB and many similar systems use a **Hybrid Logical Clock** (HLC) that combines wall-clock time with a Lamport-style counter to produce globally-monotonic timestamps.

### Sketch

```go
type HLC struct {
    mu       sync.Mutex
    physical time.Time // last wall-clock reading
    logical  uint32    // counter for ties
    clock    Clock     // injectable
}

func (h *HLC) Now() Timestamp {
    h.mu.Lock()
    defer h.mu.Unlock()
    pt := h.clock.Now()
    if pt.After(h.physical) {
        h.physical = pt
        h.logical = 0
    } else {
        h.logical++
    }
    return Timestamp{Physical: h.physical, Logical: h.logical}
}

func (h *HLC) Update(remote Timestamp) Timestamp {
    h.mu.Lock()
    defer h.mu.Unlock()
    pt := h.clock.Now()
    switch {
    case pt.After(h.physical) && pt.After(remote.Physical):
        h.physical = pt
        h.logical = 0
    case h.physical.After(remote.Physical):
        h.logical++
    case remote.Physical.After(h.physical):
        h.physical = remote.Physical
        h.logical = remote.Logical + 1
    default:
        h.logical = max(h.logical, remote.Logical) + 1
    }
    return Timestamp{Physical: h.physical, Logical: h.logical}
}
```

Without a `Clock`, this is untestable. With one, you can model:

- Clock skew between nodes (two HLCs with two different fake clocks).
- Clock jumps backwards (advance one fake clock by a negative).
- Concurrent updates from many nodes (two goroutines, both with `BlockUntil`).

### Test for ordering under skew

```go
func TestHLCMonotonicAcrossNodes(t *testing.T) {
    fa := clockwork.NewFakeClockAt(time.Unix(1000, 0))
    fb := clockwork.NewFakeClockAt(time.Unix(990, 0)) // b is 10s behind
    a := &HLC{clock: fa}
    b := &HLC{clock: fb}

    ts := a.Now()
    received := b.Update(ts)
    if received.Compare(ts) <= 0 {
        t.Fatal("HLC violated monotonicity under negative skew")
    }
}
```

You cannot run this test against real wall clocks. Fake clocks make it routine.

---

## Testing Across Goroutine Trees

Real systems have a tree of goroutines: server → handler → worker pool → connection. Each layer may set timers. A fake clock has to drive all of them.

### One clock for the tree

```go
fc := clockwork.NewFakeClock()
server := NewServer(WithClock(fc))
client := NewClient(WithClock(fc))
```

Production code constructs all components with the same clock. In a real binary that clock is the real one; in tests, the fake one.

### `BlockUntil(n)` for multiple sleepers

```go
// 3 goroutines each arm a timer
fc.BlockUntil(3)
fc.Advance(time.Second)
```

The `n` is the *concurrent* number of sleepers, not cumulative. If your code arms-fires-arms in a loop, you still expect `n` to be the count blocked at one instant.

### `synctest.Wait` as the goroutine-tree barrier

`synctest.Wait` is `BlockUntil` generalised: it waits for the *whole bubble* to be quiescent, including channel receives and other blocking operations. For complex trees, `synctest` is friendlier than chasing sleeper counts.

```go
synctest.Run(func() {
    server := NewServer()
    client := NewClient(server.Addr())
    go client.Run()
    time.Sleep(time.Hour) // fake; advances when all goroutines block
    synctest.Wait()
    // assert
})
```

### Goroutines that never block on time

If a goroutine spins on `for { select { case x := <-ch: ... } }`, it is never "sleeping" — so `BlockUntil` will never count it. Make sure every long-lived goroutine has at least one channel that blocks under normal load.

---

## Combining Fake Clocks with `context`

`context.WithDeadline` and `context.WithTimeout` use `time.Now` internally. They are *not* affected by your fake clock unless you build a `Clock`-aware variant.

### Why this matters

```go
ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
defer cancel()
err := op(ctx) // op uses fake clock, but ctx is real
```

If `op` blocks on `<-fc.After(time.Hour)`, advancing the fake clock by an hour does not cancel `ctx`. The real-time deadline will fire eventually. Mixing fake and real time produces tests that pass slowly.

### Solution 1: do not use `context.WithTimeout` in tests under fake clock

Provide a `CancelOn` helper that uses the fake clock:

```go
func CancelOn(ctx context.Context, clock Clock, d time.Duration) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancel(ctx)
    go func() {
        select {
        case <-ctx.Done():
        case <-clock.After(d):
            cancel()
        }
    }()
    return ctx, cancel
}
```

Now the context's effective deadline is on the fake clock.

### Solution 2: use `synctest` so `context.WithTimeout` is also fake

Inside `synctest.Run`, `time.Now` is fake, so `context.WithTimeout` is fake. This is one of the killer features of `synctest`: you get fake `context` deadlines for free.

---

## Test-Suite Architecture for Time-Heavy Code

A project with hundreds of time-dependent tests benefits from convention.

### One helper file: `internal/testclock`

```go
package testclock

import (
    "testing"
    "github.com/jonboulle/clockwork"
)

func NewFakeClock(t *testing.T) clockwork.FakeClock {
    fc := clockwork.NewFakeClockAt(time.Unix(1_700_000_000, 0))
    t.Cleanup(func() { /* possibly drain sleepers */ })
    return fc
}
```

Every test calls `testclock.NewFakeClock(t)` instead of constructing its own. Fixes one bug = fixes it everywhere.

### Deterministic starting time

`NewFakeClockAt(time.Unix(N, 0))` gives every test the same start. Assertions like `entry.expireAt == time.Unix(N+TTL, 0)` are now trivial.

### Parallel tests get their own clocks

```go
func TestParallel(t *testing.T) {
    t.Parallel()
    fc := testclock.NewFakeClock(t)
    // ...
}
```

Shared clocks across parallel tests cause cascading flakes.

### Tag time-heavy tests for selective running

```go
//go:build timetest
```

In CI, time-heavy tests run separately. In day-to-day development, they are still fast enough to run with the rest.

---

## Operational Concerns: Real-Time Drift, NTP Jumps, Sleep Anomalies

Real clocks misbehave in ways your tests must simulate.

### Backwards jumps

NTP may step the clock backwards by seconds. Most code does not handle this. Tests can simulate with `fc.Advance(-time.Hour)` (`clockwork` allows negative advances). Verify your TTL cache does not return a negative duration that wraps a `time.Duration` to near `MaxInt64`.

### Forward jumps

Same with forward steps of minutes. Verify rate limiters do not give out a million tokens because elapsed appears to be a minute.

### Suspend / resume

After a laptop wakes from sleep, `time.Now()` jumps forward by hours. The monotonic clock still increases. `time.Since` reports correct elapsed monotonic time, but `time.Now()` minus a stored wall-time reports the jump. Pick the right comparison in production code; test both.

### Leap seconds

The Go `time` package does not adjust for leap seconds explicitly. In long-running production they are typically a non-issue, but if your code aggregates over exact second boundaries, write a test that advances over a fake leap-second second.

### Time zone changes

`time.LoadLocation` reads OS data; a fake clock has no opinion. Make sure all comparisons use `UTC` or an explicit location, and test daylight-saving boundaries with appropriate `time.Time` values, not just durations.

---

## Anti-Patterns at Scale

### Multiple `Clock` interfaces in one binary

`pkg/cache.Clock`, `pkg/limit.Clock`, `pkg/health.Clock`. Each has a slightly different method set. A test now must construct three fakes, all wired to the same fake clock. Either unify on `clockwork.Clock` or accept the wiring boilerplate.

### A fake clock in production through a build tag mistake

```go
//go:build !test
var Clock = realClock{}

//go:build test
var Clock = clockwork.NewFakeClock()
```

If `test` tag accidentally ships, the production server's auth tokens never expire. Use injection, not tags.

### Sharing the fake clock through a global

```go
var TestClock clockwork.FakeClock // package-level

func TestX(t *testing.T) {
    TestClock = clockwork.NewFakeClock()
    ...
}
```

Parallel tests race the global. Use a local per test.

### Drift-by-Sleep in CI

A test that uses real `time.Sleep(100*time.Millisecond)` to "give the goroutine a chance to do its thing" passes on a fast laptop, fails on a heavily-loaded CI runner. Use `BlockUntil` or `synctest.Wait`.

### Asserting "approximately N seconds"

```go
if d := fc.Now().Sub(start); d < 9*time.Second || d > 11*time.Second {
    t.Fatal("...")
}
```

With a fake clock you can assert `==`. Approximations only belong in real-time tests.

---

## Cheat Sheet

```text
DESIGN:
  - Inject Clock at construction, not per-call
  - Use functional options: NewX(opts ...Option), WithClock
  - One clock per binary; pass it through the goroutine tree
  - context.WithTimeout is real-time unless inside synctest

PATTERNS:
  - Scheduler: select on ticker, BlockUntil after each Advance
  - Heartbeat: Renew(clock.Now()), Valid() compares with clock.Now()
  - HLC: physical = clock.Now(), logical breaks ties

DISTRIBUTED:
  - Multiple fake clocks for multi-node tests
  - Negative Advance for backwards-jumping NTP
  - Forward Advance for laptop wake

TEST SUITE:
  - testclock.NewFakeClock(t) helper
  - NewFakeClockAt(deterministic time)
  - Each parallel test owns its clock
  - synctest.Wait > BlockUntil for goroutine trees

AVOID:
  - Real time.Sleep in tests
  - Multiple Clock interfaces in one binary
  - context.WithTimeout under a fake clock (use CancelOn or synctest)
  - Asserting approximate durations under fake time
```

---

## Summary

At senior level you treat `Clock` as a foundational dependency: every component that touches time accepts one at construction, the binary creates exactly one in `main`, and the test suite has a helper that builds a deterministic fake. Schedulers, leases, leader-election, hybrid logical clocks — all of them are testable in a few hundred lines when time is a parameter. The hard parts are not the libraries (`clockwork` and `benbjohnson/clock` are both fine and `synctest` covers the rest) but the architecture: one clock per binary, no shared globals, parallel tests own their clocks, `context.WithTimeout` lives inside `synctest` or behind a fake-aware helper. Once that structure is in place, a 5,000-test suite stays fast and never flakes on time-related assertions.
