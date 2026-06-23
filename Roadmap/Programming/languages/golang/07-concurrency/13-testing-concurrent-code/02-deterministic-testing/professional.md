# Deterministic Testing — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Inside `testing/synctest` — Bubble Internals](#inside-testingsynctest-bubble-internals)
3. [The Bubble Scheduler](#the-bubble-scheduler)
4. [Virtual Time Implementation](#virtual-time-implementation)
5. [Detecting Quiescence at Runtime](#detecting-quiescence-at-runtime)
6. [Goroutine Tagging and Tracking](#goroutine-tagging-and-tracking)
7. [`Wait` Semantics and Race Conditions](#wait-semantics-and-race-conditions)
8. [Building Your Own Deterministic Harness](#building-your-own-deterministic-harness)
9. [Comparison with Other Languages](#comparison-with-other-languages)
10. [Limits of Determinism in a Real-World Runtime](#limits-of-determinism-in-a-real-world-runtime)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

At professional level you go below the API surface. You learn how `testing/synctest` is implemented in the Go runtime, why certain operations are safe in a bubble and others are not, and how to reproduce or extend the technique in environments that do not yet have it.

The material in this file is based on the Go 1.24/1.25 runtime sources (`src/runtime/synctest.go`, `src/runtime/proc.go` paths touching `synctestGroup`), the original design proposals (Go issue 67434 and the related design doc), and the experience of teams that built equivalent harnesses by hand before `synctest` existed.

After reading this file you will:

- Read and reason about the `synctestGroup` runtime data structure.
- Explain why `synctest.Wait` is fundamentally a runtime feature, not a library feature.
- Build a fake-clock + scheduler simulator if you target a Go version without `synctest`.
- Decide when to extend Go's testing capabilities and when to live within them.
- Recognise the limits: things determinism cannot give you.

---

## Inside `testing/synctest` — Bubble Internals

`synctest.Run(f)` enters a new bubble. Under the hood the runtime:

1. Allocates a `synctestGroup` structure with: a virtual clock (`now`), a set of tracked goroutines, a heap of pending timers, an idle counter.
2. Tags the current goroutine as the bubble owner.
3. Runs `f`. Every `go` statement during `f`'s execution attaches the new goroutine to the bubble's group.
4. When `f` returns, the runtime asserts every tracked goroutine has exited. If not, panics.

The key structure (paraphrasing the runtime source):

```go
type synctestGroup struct {
    mu sync.Mutex
    waiter      *g
    waiting     bool
    active      int
    total       int
    now         time.Time
    timers      timerHeap
}
```

- `active`: number of bubble goroutines that are currently runnable (not blocked on a synctest-aware operation).
- `total`: number of bubble goroutines, runnable or blocked.
- `now`: virtual clock.
- `timers`: pending virtual-time timers, ordered by fire time.
- `waiter`: the goroutine currently inside `synctest.Wait`, if any.

The runtime decrements `active` whenever a bubble goroutine blocks on a channel, mutex, timer, or other synctest-tracked operation, and increments it when the goroutine unblocks. When `active == 0` and a `Wait` call is outstanding, the runtime unblocks the waiter.

When `active == 0` with no waiter, the runtime advances the virtual clock to the earliest timer's deadline, fires that timer, and continues.

---

## The Bubble Scheduler

Inside a bubble the scheduler behaves cooperatively. Specifically:

- A blocked goroutine is *deterministically* the next one woken when its blocking condition is satisfied.
- The runtime does not introduce arbitrary preemption between bubble goroutines as it would outside the bubble. Each goroutine runs until it blocks or yields.
- Goroutines outside the bubble continue under the normal scheduler.

This is why a `synctest` test feels closer to a co-routine system than to a thread system. The interleaving is constrained, repeatable, and easier to reason about. The trade-off is that race conditions involving truly parallel execution are muted; `synctest` is not a substitute for `-race` testing on the production scheduler.

### `runtime.Gosched()` inside a bubble

`runtime.Gosched()` still works inside a bubble: it places the current goroutine at the back of the runnable queue. But because the bubble runs goroutines in a deterministic order, `Gosched` does not introduce non-determinism. It is a useful way to force a yield point during step-by-step assertions.

---

## Virtual Time Implementation

The bubble keeps a single `time.Time` value (`now`) and a heap of pending virtual timers. Calls to:

- `time.Now()` return `now`.
- `time.Sleep(d)` schedules a wake-up at `now + d`, blocks until then.
- `time.After(d)` is `time.NewTimer(d).C()`.
- `time.NewTimer(d)`, `time.NewTicker(d)` register entries in the timer heap.

When the runtime detects `active == 0`, it pops the soonest timer, advances `now` to that timer's deadline, fires the timer, and continues. If multiple timers have the same deadline, the order is well-defined (registration order or heap order, depending on implementation).

### Why this matters

A 1-hour `time.Sleep` consumes microseconds of wall clock. A 100-step backoff sequence (each step waiting seconds) finishes instantly. Long timeouts are not a test cost.

### Constraint: blocking on real I/O does not count

The bubble can only advance the virtual clock when all bubble goroutines are blocked on *bubble-aware* operations. A goroutine blocked on `net.Read` is opaque to the bubble; the bubble cannot advance virtual time, because real I/O could complete at any moment and change the state. This is the source of `synctest`'s limitation around real I/O.

---

## Detecting Quiescence at Runtime

`synctest.Wait()` is implemented as: "park the caller until `active == 0` and the caller is the only outstanding `Wait`." The runtime tracks `active` precisely because each blocking primitive in the standard library has a synctest-aware path.

Affected primitives (in Go 1.24/1.25):

- Channel send/receive.
- Mutex Lock/Unlock.
- RWMutex.
- Cond Wait / Broadcast / Signal.
- WaitGroup Wait.
- Once Do.
- Timer / Ticker channels.
- `context.Done()` via internal channels.

Operations the bubble cannot track (without library changes):

- `sync.Map` internals (probably tracked; check version).
- Atomic operations: these never block, so no tracking needed.
- CGo blocking: opaque.
- Direct syscall: opaque.

Any goroutine in an opaque state effectively prevents `active` from reaching 0. `Wait` either blocks forever (caught as a deadlock by the runtime) or never returns. Senior engineers must know which operations are safe in a bubble.

---

## Goroutine Tagging and Tracking

When a goroutine is started inside a bubble, the runtime tags its `g` struct with a pointer to the `synctestGroup`. When that goroutine itself starts a new goroutine, the new one inherits the tag. The transitive closure of "goroutines descended from the bubble entry" forms the bubble.

When `Run` returns:

- The runtime iterates the goroutine table.
- Any goroutine still tagged with this bubble triggers a panic.

The panic includes stack traces of the leaked goroutines, similar to `goleak`. This is why `synctest` is also a leak detector.

---

## `Wait` Semantics and Race Conditions

`synctest.Wait` has subtle semantics worth memorising:

- Returns when all bubble goroutines other than the caller are blocked.
- "Blocked" excludes goroutines that have exited (they no longer count toward `total`).
- If the caller is the only bubble goroutine left, `Wait` returns immediately.
- A goroutine that re-enters a runnable state while `Wait` is checking causes a re-check; the runtime ensures atomicity.
- If a bubble goroutine becomes runnable as a result of advancing virtual time, that counts as work; `Wait` does not return until those goroutines block again.

This last point is important: `Wait` does not just freeze at the first idle state. It advances time to fire any pending timers, lets goroutines run, and repeats until truly idle.

### Calling `Wait` from inside a sub-goroutine

`synctest.Wait` can be called from any bubble goroutine, but only one at a time. Two concurrent `Wait` calls in the same bubble panic.

### `Wait` after a panic

If a bubble goroutine panics, the bubble enters an "aborting" state and `Run` propagates the panic. `Wait` returns immediately so the bubble can unwind.

---

## Building Your Own Deterministic Harness

If your project is stuck on Go 1.23 or earlier, or you need cross-cutting deterministic testing across multiple processes, you can build a harness yourself. The recipe:

1. **Inject a `Clock` interface.** Production uses real time; tests use a fake.
2. **Inject a `Scheduler` interface.** Production runs goroutines normally; tests use a single-threaded driver.
3. **Avoid the standard library's blocking primitives in production code.** Use only your own queue / mutex / channel abstractions that the harness can introspect.

This is significant engineering effort. CockroachDB, FoundationDB, TigerBeetle, and a handful of other databases do it. For most teams, waiting for `synctest` or using `clockwork` is the right call.

### A minimal hand-rolled bubble (sketch)

```go
type bubble struct {
    mu      sync.Mutex
    now     time.Time
    timers  []*virtualTimer
    runQ    []func()
    active  int
}

func (b *bubble) Go(f func()) {
    b.mu.Lock()
    b.active++
    b.runQ = append(b.runQ, f)
    b.mu.Unlock()
}

func (b *bubble) Wait() {
    for {
        b.mu.Lock()
        if b.active == 0 && len(b.runQ) == 0 {
            b.mu.Unlock()
            return
        }
        if len(b.runQ) > 0 {
            f := b.runQ[0]
            b.runQ = b.runQ[1:]
            b.mu.Unlock()
            f()
            continue
        }
        // advance time to next timer
        if len(b.timers) == 0 {
            b.mu.Unlock()
            panic("deadlock")
        }
        next := b.timers[0]
        b.timers = b.timers[1:]
        b.now = next.fireAt
        b.runQ = append(b.runQ, next.fire)
        b.active++
        b.mu.Unlock()
    }
}
```

A real harness handles channels, cancellation, panics. The skeleton illustrates the core: track active work, advance time when idle, expose `Wait` for tests.

---

## Comparison with Other Languages

| Language | Equivalent | Notes |
|----------|------------|-------|
| Erlang/Elixir | `:meck` for time, BEAM scheduler is naturally cooperative | OTP gives much of this for free |
| Rust async | `tokio::time::pause()`, `tokio::test`, `loom` | `loom` does exhaustive interleaving exploration |
| Java | `MockedConstruction` + `Awaitility`, `Test-Containers`, `Loom` virtual threads | No first-class `synctest` analogue |
| Python asyncio | `asyncio.sleep` is virtual under `pytest-asyncio` with mocks; `freezegun` for time | Coop scheduler helps |
| Kotlin | `TestCoroutineScope`, `runTest`, `advanceTimeBy` | Closest in spirit to `synctest` |
| C++ | None standard; custom harnesses | FoundationDB-style flow simulator |

Go's `synctest` is closest to Kotlin's `TestCoroutineScope` in design and spirit: a bubble of cooperative coroutines with virtual time and `advanceTimeBy`-style helpers. Rust's `loom` is more ambitious: it explores all possible interleavings, finding bugs `synctest` would miss. Each design has trade-offs.

---

## Limits of Determinism in a Real-World Runtime

Even with `synctest`, some sources of non-determinism remain:

- **Map iteration order.** Go intentionally randomises map range to discourage reliance. If a test compares ordered map iterations, it can flake. Fix: sort keys.
- **GC scheduling.** `runtime.GC()` can run at unpredictable times. If a test asserts on heap state, it can flake. Fix: explicit `runtime.GC()` calls before observations.
- **`select` choice.** When multiple cases are ready, `select` picks at random. A test that depends on which case fires is non-deterministic. Fix: design so only one case is ready at a time.
- **Goroutine ID order.** Goroutines are not numbered deterministically; do not assert on `runtime.Stack` text directly.
- **OS-level operations.** File systems, network, system clock outside `synctest`. Mock at the boundary.
- **CGo.** Anything in CGo land is opaque to the runtime. Avoid in deterministic tests.
- **Generics monomorphisation.** Compiler may produce different code; not a test concern, but recall it when reading assembly.

These are the irreducible limits. Beyond them, no language-level tool can give you full determinism; you fall back to property testing, replay testing, or model checking.

---

## Self-Assessment

- [ ] I can explain the `synctestGroup` structure and its role.
- [ ] I can identify which standard library primitives are bubble-aware.
- [ ] I can describe the `Wait` algorithm and its termination conditions.
- [ ] I have built a minimal hand-rolled bubble for my own learning.
- [ ] I know the differences between `synctest`, Kotlin's `TestCoroutineScope`, and Rust's `loom`.
- [ ] I can list the remaining sources of non-determinism even with `synctest`.
- [ ] I can decide between `synctest`, simulator, and property testing for any given problem.

---

## Summary

`testing/synctest` is a runtime-level feature, not a library. The runtime tracks a per-bubble `synctestGroup` containing the virtual clock, the timer heap, and the active-goroutine count. Bubble-aware blocking primitives decrement `active`; when `active == 0`, the runtime advances time or wakes the waiter. The result is a deterministic, cooperatively scheduled sandbox for testing concurrency and time together. Knowing the internals tells you where the bubble does and does not work, when to roll your own harness, and how to combine `synctest` with property testing, replay testing, and simulators for the cases the bubble cannot reach. The remaining irreducible non-determinism — map iteration, `select` randomness, GC, OS — is small enough that disciplined teams can write tests that genuinely never flake.
