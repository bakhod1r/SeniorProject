# Mocking Time — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Anatomy of a Fake Clock](#anatomy-of-a-fake-clock)
3. [`testing/synctest` Internals](#testingsynctest-internals)
4. [Library Comparison Under the Hood](#library-comparison-under-the-hood)
5. [Monkey-Patching `time.Now`: How and Why Not](#monkey-patching-timenow-how-and-why-not)
6. [Building Your Own Fake Clock for a Special Need](#building-your-own-fake-clock-for-a-special-need)
7. [Performance and Scale](#performance-and-scale)
8. [Cheat Sheet](#cheat-sheet)
9. [Summary](#summary)

---

## Introduction

Professional level is where you stop being a user of fake clocks and become someone who can debug, extend, or write one. You may need to:

- Diagnose a deadlock in `clockwork.BlockUntil`.
- Decide whether `testing/synctest` is safe for a critical-path test.
- Build a fake clock with semantics neither library provides (per-goroutine clocks, simulated NTP jumps, leap seconds).
- Compare and contrast the three approaches for a tech talk or a design doc.
- Reject monkey-patching `time.Now` in a code review with a concrete explanation.

This file goes one level deeper than libraries: how the implementations work, where they trade off, and what to do when you outgrow them.

---

## Anatomy of a Fake Clock

A fake clock is, at its core, three pieces:

1. A protected current time `now`.
2. A list (or heap) of pending wakeups: `(deadline, channel-or-callback, id)`.
3. An `Advance` operation that moves `now` and fires every wakeup with `deadline ≤ now`.

`clockwork`'s `fakeClock` (paraphrased to highlight structure):

```go
type fakeClock struct {
    l        sync.RWMutex
    sleepers []*sleeper
    waiters  []*blocker // for BlockUntil
    time     time.Time
}

type sleeper struct {
    until time.Time
    done  chan time.Time
}
```

`After(d)`:

```go
func (fc *fakeClock) After(d time.Duration) <-chan time.Time {
    fc.l.Lock()
    defer fc.l.Unlock()
    done := make(chan time.Time, 1)
    if d <= 0 {
        done <- fc.time
        return done
    }
    s := &sleeper{until: fc.time.Add(d), done: done}
    fc.sleepers = append(fc.sleepers, s)
    fc.notifyBlockers()
    return done
}
```

`Advance(d)`:

```go
func (fc *fakeClock) Advance(d time.Duration) {
    fc.l.Lock()
    defer fc.l.Unlock()
    fc.time = fc.time.Add(d)
    var still []*sleeper
    for _, s := range fc.sleepers {
        if !s.until.After(fc.time) {
            s.done <- fc.time
            close(s.done)
        } else {
            still = append(still, s)
        }
    }
    fc.sleepers = still
}
```

`BlockUntil(n)`:

```go
func (fc *fakeClock) BlockUntil(n int) {
    fc.l.Lock()
    if len(fc.sleepers) >= n {
        fc.l.Unlock()
        return
    }
    b := &blocker{c: make(chan struct{})}
    fc.waiters = append(fc.waiters, b)
    fc.l.Unlock()
    <-b.c
}

// notifyBlockers is called whenever sleepers list grows
func (fc *fakeClock) notifyBlockers() {
    var still []*blocker
    for _, b := range fc.waiters {
        if len(fc.sleepers) >= b.n {
            close(b.c)
        } else {
            still = append(still, b)
        }
    }
    fc.waiters = still
}
```

Two observations:

- `Advance` does not yield to other goroutines between firing sleepers. If sleeper A's wakeup triggers code that registers sleeper B, B's registration races the next assertion.
- `BlockUntil` is satisfied by *any* `n` sleepers, not by *specific* sleepers. If your code can register stray sleepers (a background ticker), the count includes them.

These are inherent to the architecture, not bugs.

---

## `testing/synctest` Internals

`testing/synctest` (Go 1.24+) is implemented in the runtime, not in pure Go. The key concept is a **bubble**:

- `synctest.Run(f)` runs `f` and any goroutines it spawns inside an isolated scheduling group.
- Within the bubble, `time.Now`, `time.Sleep`, `time.After`, `time.NewTimer`, `time.NewTicker`, `time.AfterFunc` consult a per-bubble fake clock.
- When every goroutine in the bubble is *durably blocked* (channel operation, select, sleep, mutex contention), the runtime advances the fake clock to the next pending wakeup. This is called **quiescence**.
- `synctest.Wait` blocks until the bubble is quiescent.

### Quiescence rules

- A goroutine blocked on a mutex *inside the bubble* counts as blocked.
- A goroutine blocked on a channel *with a sender inside the bubble* may or may not be progressable.
- A goroutine blocked on I/O (network, files) is *not* durably blocked — the runtime cannot tell when it will unblock. Real I/O inside a bubble defeats `synctest`.

### Why it can be exact

Unlike `clockwork`, where `Advance` must be called by the test, `synctest` advances time when the runtime knows nothing else can happen. The advance is always to the next wakeup, so there is no "did I advance enough?" question.

### Cost

`synctest.Run` adds bookkeeping per goroutine. Benchmarks (Go 1.24 release notes) show overhead on the order of microseconds per goroutine per scheduling event, comparable to `-race`. For unit tests this is invisible.

### Limitations

- Real I/O cannot be made fake. `net.Dial` to localhost is still real.
- `cgo` callbacks are not bubble-aware.
- `runtime.Gosched()` is fine.
- `sync.WaitGroup` works.
- Some packages that spawn goroutines outside the test (e.g., a goroutine started by the standard library) are not in the bubble.

---

## Library Comparison Under the Hood

| Aspect | `clockwork` | `benbjohnson/clock` | `testing/synctest` |
|---|---|---|---|
| Where it lives | userland library | userland library | runtime + stdlib |
| Production code change | yes (inject Clock) | yes (inject Clock) | none |
| Determinism | high if you `BlockUntil` | medium (no built-in `BlockUntil` in v1.3) | very high |
| Step granularity | exact `Advance(d)` | exact `Add(d)` | implicit, to next wakeup |
| Multiple bubbles | many `FakeClock`s | many `Mock`s | many `Run`s, each isolated |
| Negative time | `Advance(-d)` works | `Add(-d)` works | not idiomatic |
| Concurrent test friendly | yes (per-clock) | yes (per-mock) | yes (per-Run) |
| Go version | any | any | 1.24+ |
| Goroutine count overhead | linear in sleepers | linear in sleepers | runtime-tracked, microseconds |

In tech-talk shorthand: `clockwork` is the workhorse, `benbjohnson/clock` is the elder sibling, `synctest` is the future.

---

## Monkey-Patching `time.Now`: How and Why Not

A third school of thought patches the function table of `time.Now` at runtime. Libraries: `bouk/monkey` (archived), `agiledragon/gomonkey` (active fork), and various smaller projects. The idea:

```go
import "github.com/agiledragon/gomonkey/v2"

func TestX(t *testing.T) {
    fakeNow := time.Unix(1000, 0)
    patch := gomonkey.ApplyFunc(time.Now, func() time.Time { return fakeNow })
    defer patch.Reset()
    // ... code that calls time.Now sees fakeNow
}
```

### Why it is tempting

- No code change in production.
- No `Clock` interface.
- Works with libraries you cannot fork.

### Why it is bad

- **Go upgrades break it.** The trick relies on overwriting instructions or function descriptors. Go 1.x updates can change those.
- **Architecture-specific.** ARM, AMD64, RISC-V — different patching code paths.
- **Unsafe under `-race`.** Patches do not synchronise with TSan. False-positive reports.
- **Unsafe under inlining.** If `time.Now` is inlined into the caller, the patch is invisible.
- **Not goroutine-local.** Patching is process-wide. Two parallel tests fight.
- **Breaks dynamic linking on some platforms.** Recent Go on macOS with code-signing enforces W^X.

In short: it works until it doesn't, and when it doesn't, the failure is silent and obscure. Use `synctest` or a `Clock` interface.

---

## Building Your Own Fake Clock for a Special Need

Sometimes the built-in fakes are not enough. Examples:

- **Per-goroutine clocks** to simulate distributed-system clock skew.
- **NTP-like jumps** with hooks to inject programmable behaviour.
- **Recording** every call to inspect later.

### Skeleton

```go
type Clock interface {
    Now() time.Time
    Sleep(d time.Duration)
    After(d time.Duration) <-chan time.Time
    NewTimer(d time.Duration) *Timer
}

type FakeClock struct {
    mu       sync.Mutex
    now      time.Time
    sleepers []*sleeper
    record   []Event
}

type Event struct {
    Kind     string
    Time     time.Time
    Duration time.Duration
}

type sleeper struct {
    deadline time.Time
    ch       chan time.Time
}

func (f *FakeClock) After(d time.Duration) <-chan time.Time {
    f.mu.Lock()
    defer f.mu.Unlock()
    f.record = append(f.record, Event{Kind: "After", Time: f.now, Duration: d})
    s := &sleeper{deadline: f.now.Add(d), ch: make(chan time.Time, 1)}
    f.sleepers = append(f.sleepers, s)
    return s.ch
}

func (f *FakeClock) Advance(d time.Duration) {
    f.mu.Lock()
    defer f.mu.Unlock()
    f.now = f.now.Add(d)
    var alive []*sleeper
    for _, s := range f.sleepers {
        if !s.deadline.After(f.now) {
            s.ch <- f.now
        } else {
            alive = append(alive, s)
        }
    }
    f.sleepers = alive
}

func (f *FakeClock) Events() []Event {
    f.mu.Lock()
    defer f.mu.Unlock()
    out := make([]Event, len(f.record))
    copy(out, f.record)
    return out
}
```

### Adding NTP-like behaviour

```go
func (f *FakeClock) Jump(d time.Duration) {
    f.mu.Lock()
    defer f.mu.Unlock()
    f.now = f.now.Add(d)
    // do NOT fire sleepers based on new now if jumping backwards
}
```

A backwards jump shouldn't fire sleepers; that is the whole point of testing NTP step-back.

### Adding determinism guarantees

Sort sleepers by deadline before firing so order is reproducible across runs:

```go
sort.SliceStable(f.sleepers, func(i, j int) bool {
    return f.sleepers[i].deadline.Before(f.sleepers[j].deadline)
})
```

### When to build one

Only when you can articulate a specific gap in `clockwork` or `synctest`. Reinventing for fun creates a maintenance burden no team thanks you for.

---

## Performance and Scale

Fake clocks rarely show up in profiles, but a few cases matter.

### Hot-loop fake-clock benchmarks

A benchmark of a rate limiter that calls `clock.Now()` in a tight loop measures the *clock implementation*, not the limiter. `clockwork.realClock.Now()` is about as fast as `time.Now()` (a few ns). `fakeClock.Now()` takes a mutex (~30 ns). Benchmark with the production implementation.

### Many sleepers

A test that arms 100,000 timers under `clockwork` has O(n) `Advance` cost. For most tests that is fine. If it is not, use `synctest`, which uses a heap internally and is O(log n).

### `BlockUntil` polling overhead

`clockwork`'s `BlockUntil` waits on a channel that closes when notifyBlockers fires. There is no polling. The "spin" misconception comes from earlier versions of the library; the modern implementation is event-driven.

### Production cost of an injected `Clock`

`realClock.Now()` has one extra indirect call versus `time.Now()`. The Go compiler often inlines small interface methods when the interface is monomorphic; if not, the indirection is single-digit nanoseconds. Not a real concern.

---

## Cheat Sheet

```text
FAKE CLOCK ANATOMY:
  - now: protected time
  - sleepers: list of (deadline, channel) pairs
  - Advance: move now, fire wakeups <= now
  - BlockUntil: wait for n sleepers to be registered

SYNCTEST INTERNALS:
  - per-bubble fake clock in runtime
  - quiescence: all goroutines blocked -> advance time
  - I/O is not durably blocked -> defeats the bubble
  - Wait blocks until quiescent

COMPARE:
  clockwork           - userland, exact Advance, BlockUntil
  benbjohnson/clock   - older, no built-in BlockUntil
  synctest            - runtime, exact via quiescence, Go 1.24+
  monkey-patch        - DO NOT USE in production code

CUSTOM FAKE:
  - only when libraries fall short
  - record events for offline analysis
  - sort sleepers by deadline for determinism

PERFORMANCE:
  - realClock cost ~ time.Now()
  - fakeClock cost ~ time.Now() + mutex
  - many sleepers: synctest scales better than clockwork
```

---

## Summary

At professional level you understand a fake clock as a small state machine: a current time, a list of pending wakeups, and one operation that moves the first and fires the second. `clockwork` and `benbjohnson/clock` implement that pattern in userland with sensible defaults; `testing/synctest` (Go 1.24+) moves the same idea into the runtime by tying time advancement to scheduler quiescence. Each has trade-offs you can articulate concretely, and you can build a custom fake clock when the off-the-shelf options fall short. You also know the failure modes of monkey-patching `time.Now` well enough to reject it in a review with specifics. The end goal: a test suite where time is one of the most boring parts of the code, not the source of half your flakes.
