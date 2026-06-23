# Mocking Time — Specification

## Table of Contents
1. [Scope](#scope)
2. [`Clock` Interface Contract](#clock-interface-contract)
3. [`clockwork.Clock` and `clockwork.FakeClock`](#clockworkclock-and-clockworkfakeclock)
4. [`benbjohnson/clock.Clock` and `clock.Mock`](#benbjohnsonclockclock-and-clockmock)
5. [`testing/synctest` Contract](#testingsynctest-contract)
6. [Compatibility Matrix](#compatibility-matrix)
7. [Failure Modes](#failure-modes)

---

## Scope

This document specifies the contract a "clock" type must obey to be usable as a drop-in replacement for the standard library `time` calls. It also specifies the test-only API additions (`Advance`, `BlockUntil`, `Run`) that fake implementations expose.

The reference implementations are:

- `github.com/jonboulle/clockwork` v0.4.0
- `github.com/benbjohnson/clock` v1.3.5
- `testing/synctest` in Go 1.24

Behavioural details that differ between these are explicitly called out.

---

## `Clock` Interface Contract

A `Clock` is any type satisfying at minimum:

```go
type Clock interface {
    Now() time.Time
}
```

Most code requires more:

```go
type Clock interface {
    Now() time.Time
    Sleep(d time.Duration)
    Since(t time.Time) time.Duration
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

### Behavioural requirements

- `Now()` is non-blocking and side-effect-free.
- `Sleep(d)` returns no earlier than `d` of *clock time* after the call (not necessarily wall time).
- `After(d)` returns a `<-chan time.Time` that receives one value, the time of receipt (in clock time), exactly once.
- `NewTimer(d).Chan()` behaves like `After(d)`, with the option to `Stop` or `Reset`.
- `NewTicker(d).Chan()` receives a value every `d` of clock time until `Stop` is called.
- `AfterFunc(d, f)` invokes `f` on some goroutine after `d` of clock time has elapsed. The goroutine identity is implementation-defined.

### Real-clock implementations

For a real implementation, "clock time" is wall time. The behaviour is identical to calling the corresponding `time` package function directly.

### Fake-clock implementations

For a fake implementation, "clock time" is the implementation's internal `now`, which advances only when test code calls `Advance` (or, in `synctest`, when the runtime advances it during quiescence).

### Monotonicity

- A real clock's `Now()` is monotonic-strip-free: the returned value carries a monotonic component (Go spec).
- Fake clocks typically do not carry a monotonic component; `Now()` returns a wall-clock-only value.
- Tests that depend on monotonic semantics should use a real clock or use `synctest`.

---

## `clockwork.Clock` and `clockwork.FakeClock`

### Interface

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

type FakeClock interface {
    Clock
    Advance(d time.Duration)
    BlockUntil(n int)
    BlockUntilContext(ctx context.Context, n int) error
}
```

### Constructors

- `NewRealClock() Clock`
- `NewFakeClock() FakeClock` — starts at `time.Now()` (captured once at construction).
- `NewFakeClockAt(t time.Time) FakeClock` — starts at `t`.

### `Advance(d)`

- `d` may be positive, zero, or negative.
- Fires every sleeper with `deadline.After(now)` false (i.e., `deadline ≤ now`).
- Fire order is implementation-defined; current implementation is registration order, filtered by deadline.

### `BlockUntil(n)`

- Blocks the calling goroutine until at least `n` sleepers (from `After`, `NewTimer`, `NewTicker`, `AfterFunc`, `Sleep`) are currently registered.
- Returns immediately if `n` sleepers are already registered when called.
- "Sleeper" includes goroutines currently blocked in `Sleep`.

### `BlockUntilContext(ctx, n)`

- Like `BlockUntil` but cancellable. Returns `ctx.Err()` if the context cancels first.

### Guarantees

- `Advance` is atomic from the perspective of subsequent `Now()` calls: after `Advance` returns, `Now()` reflects the new time.
- `Advance` is not atomic from the perspective of fired sleepers: a goroutine awoken by `Advance` may run before `Advance` returns to its caller.

---

## `benbjohnson/clock.Clock` and `clock.Mock`

### Interface

```go
type Clock interface {
    After(d time.Duration) <-chan time.Time
    AfterFunc(d time.Duration, f func()) *Timer
    Now() time.Time
    Since(t time.Time) time.Duration
    Sleep(d time.Duration)
    Tick(d time.Duration) <-chan time.Time
    Ticker(d time.Duration) *Ticker
    Timer(d time.Duration) *Timer
}
```

`Timer` and `Ticker` are concrete types, not interfaces.

### Constructors

- `New() Clock` — real clock
- `NewMock() *Mock` — fake clock starting at Unix epoch

### `Mock` extras

```go
func (m *Mock) Add(d time.Duration)
func (m *Mock) Set(t time.Time)
```

- `Add(d)` advances time by `d`. Fires any pending wakeups.
- `Set(t)` jumps to absolute time `t`.

### Notes

- No `BlockUntil` equivalent in v1.3. Workarounds: use `time.Sleep(microsecond)` between arming and `Add` (ugly), or use a fork.
- `Tick` returns a leak-prone channel like `time.Tick`. Prefer `Ticker`.

---

## `testing/synctest` Contract

### API

```go
package synctest

func Run(f func())
func Wait()
```

### Semantics

- `Run(f)` starts `f` in a new goroutine inside an isolated **bubble**.
- All goroutines spawned by `f` (transitively) are in the same bubble.
- Within the bubble, `time.Now`, `time.Sleep`, `time.After`, `time.NewTimer`, `time.NewTicker`, `time.AfterFunc`, and `time.Tick` consult a per-bubble fake clock.
- The runtime advances the bubble's clock when every goroutine in the bubble is **durably blocked**.
- `Wait()` blocks until the bubble is in a durably-blocked state.

### Durably blocked

A goroutine is durably blocked when:

- It is blocked on a channel inside the bubble.
- It is blocked on a `sync` primitive inside the bubble.
- It is blocked on `time.Sleep` or a timer.
- It is blocked on `runtime.Gosched()`.

A goroutine is **not** durably blocked when:

- It is performing I/O (network, file, syscall).
- It is blocked on a channel with a sender outside the bubble.
- It is in cgo.

### Time advancement

- When all goroutines are durably blocked, the runtime advances the bubble's clock to the earliest pending timer deadline.
- Time may not advance past a real-time deadline imposed externally (e.g., a test timeout).

### Restrictions

- `Run` may not be called recursively.
- Goroutines escape the bubble if they outlive `Run`. Standard practice: every goroutine in `Run` is joined before `Run` returns.
- The bubble is not GC-visible from outside; references in the bubble keep objects alive normally.

### Compatibility

- Available from Go 1.24.0.
- The package is in the standard library, no module dependency required.

---

## Compatibility Matrix

| Need | `clockwork` | `benbjohnson/clock` | `synctest` |
|---|---|---|---|
| Go 1.21+ | yes | yes | no |
| Go 1.24+ | yes | yes | yes |
| `BlockUntil` | yes | no (workaround) | implicit via `Wait` |
| Context-aware block | yes (`BlockUntilContext`) | no | `Wait` returns when quiescent |
| Negative time | yes | yes | no |
| Multiple concurrent fakes | yes | yes | yes (per `Run`) |
| Production code untouched | no | no | yes |
| Real I/O inside test | yes | yes | breaks bubble |
| Exact `Advance(d)` | yes | yes (`Add(d)`) | no |
| Step to next wakeup automatically | no | no | yes |

---

## Failure Modes

### `Advance` races arming

A test calls `Advance` before production code calls `After`. Result: `Advance` fires nothing; production goroutine waits forever.

**Mitigation:** `BlockUntil(n)` before `Advance`, or `synctest.Wait`.

### `BlockUntil(n)` counts wrong

The production code arms more or fewer sleepers than expected (e.g., a background ticker contributes a sleeper). `BlockUntil(1)` returns immediately for the ticker, before the actual code arms.

**Mitigation:** know your sleeper count; consider `synctest` which avoids the counting.

### Goroutine escapes the bubble

In `synctest.Run`, a goroutine started before `Run` or via a non-bubble path is on real time.

**Mitigation:** spawn all goroutines inside `Run`. Use `Wait` to ensure none escape.

### Real I/O inside a `synctest` bubble

A `net.Dial` call is real-time. The bubble cannot advance time while a goroutine is blocked on it. Test hangs or times out.

**Mitigation:** isolate I/O behind an interface and provide an in-memory fake for tests under `synctest`.

### Monotonic time mismatch

Production code uses `time.Since` (which uses monotonic). Fake clock returns wall-only `time.Time`. `Since` falls back to wall computation; usually correct, but `Round(0)` strips monotonic and changes equality semantics.

**Mitigation:** within fake clocks, prefer `clock.Since(t)` over `time.Since(t)`.

### `AfterFunc` callback on a foreign goroutine

`fakeClock.AfterFunc` runs the callback on a goroutine the fake controls. The test goroutine must synchronise (e.g., via channel) before asserting.

**Mitigation:** always synchronise on a channel; never on a bool.

### Negative `Advance` does not un-fire sleepers

Once a sleeper has fired, calling `Advance(-d)` does not un-receive the value. This is a non-reversibility; tests cannot rewind state.

**Mitigation:** construct a fresh `FakeClock` per test when state matters.
