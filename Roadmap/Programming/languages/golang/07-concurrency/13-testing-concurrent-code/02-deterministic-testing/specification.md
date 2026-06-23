# Deterministic Testing — Specification

## Table of Contents
1. [Scope](#scope)
2. [`testing/synctest` Package Contract](#testingsynctest-package-contract)
3. [`synctest.Run`](#synctestrun)
4. [`synctest.Wait`](#synctestwait)
5. [Virtual Clock Semantics](#virtual-clock-semantics)
6. [Bubble Membership Rules](#bubble-membership-rules)
7. [Bubble-Aware Operations](#bubble-aware-operations)
8. [Error and Panic Modes](#error-and-panic-modes)
9. [Interaction with `-race`](#interaction-with--race)
10. [Versioning and Stability](#versioning-and-stability)
11. [Reference Conformance Tests](#reference-conformance-tests)

---

## Scope

This document specifies the observable behaviour of the `testing/synctest` package as of Go 1.25 (graduated from experiment) and Go 1.24 (experimental via `GOEXPERIMENT=synctest`). Any deviation between this document and the official Go specification is a defect in this document; the official source of truth is `pkg.go.dev/testing/synctest` and the Go release notes.

This document also specifies the conventions that apply to deterministic testing in general: the API contract of fake clock libraries, the conventions around `-count`, `-race`, `-cpu`.

---

## `testing/synctest` Package Contract

The package exposes two functions:

```go
package synctest

// Run executes f in a new bubble. Returns when f and all bubble
// goroutines have completed. Panics if any bubble goroutine remains
// running when f returns.
func Run(f func())

// Wait blocks the calling goroutine until every other goroutine in
// the bubble is blocked. Panics if called outside a bubble.
// Panics if called concurrently from another goroutine in the same
// bubble.
func Wait()
```

No other exported symbols. Future versions may add helpers; the two functions above are the stable surface.

---

## `synctest.Run`

### Signature

```go
func Run(f func())
```

### Behaviour

1. Allocates a new bubble. Each `Run` call gets a fresh, isolated bubble. Bubbles cannot be nested; calling `Run` from inside a bubble panics with `"synctest: Run called from within a bubble"` (or equivalent).
2. The calling goroutine is treated as the bubble's "main" goroutine for the duration of `f`'s execution.
3. While `f` runs, every `go` statement creates a goroutine that is a member of this bubble. The membership is recursive: goroutines started by bubble members are also bubble members.
4. Inside the bubble, calls to time-related functions in the `time` package and `context` package use the bubble's virtual clock.
5. `Run` blocks until `f` returns *and* every bubble-member goroutine has exited.
6. If `f` returns while any bubble goroutine is still alive, `Run` waits until they exit or panics if the bubble is deadlocked.
7. If any bubble goroutine panics, the panic is propagated through `Run`. Other bubble goroutines are not automatically cancelled; the bubble waits for them to exit.

### Determinism guarantees

- Two invocations of `Run` with the same `f`, on the same Go version, with no other inputs, must produce the same observable outcome.
- The bubble scheduler picks goroutines in a deterministic order. The order is unspecified but stable across runs.
- Map iteration inside the bubble follows the same randomised order as outside (Go does not change this).

### Limitations

- Real I/O (network, file, OS) is not isolated; calls into it consume real time and are not deterministic.
- CGo is opaque to the bubble.
- Calling `runtime.GC` inside the bubble has its usual effect; it is not virtualised.

---

## `synctest.Wait`

### Signature

```go
func Wait()
```

### Behaviour

1. Must be called from within a bubble. Otherwise panics with `"synctest: Wait called outside a bubble"`.
2. Blocks the caller until **every other goroutine in this bubble is blocked or has exited**.
3. "Blocked" means parked on a bubble-aware operation (see "Bubble-Aware Operations" below).
4. While waiting, the runtime may advance the virtual clock to fire pending timers, which can unblock goroutines, which then run until they block again. `Wait` returns only when no further progress is possible without external input.
5. If the only remaining bubble goroutine is the caller, `Wait` returns immediately.
6. If another goroutine is already waiting via `Wait`, calling `Wait` from a second goroutine panics with `"synctest: concurrent Wait calls"`.
7. If the bubble is deadlocked (no goroutines runnable, no pending timers, `Wait` outstanding), the runtime reports a deadlock and panics.

### Use cases

- Replaces "give the system a moment to settle" `time.Sleep` calls.
- Lets the test observe a stable state after triggering some action.
- Combined with virtual time, gives instant pseudo-real-time tests.

---

## Virtual Clock Semantics

Inside a bubble:

- `time.Now()` returns the bubble's virtual time.
- `time.Sleep(d)` returns when virtual time has advanced by at least `d`.
- `time.After(d)` returns a channel that produces the (virtual) current time after `d` virtual duration.
- `time.NewTimer(d)`, `time.NewTicker(d)` register timers in the bubble's timer heap.
- `time.AfterFunc(d, fn)` schedules `fn` to run at virtual `now + d`.
- `time.Since(t)`, `time.Until(t)` compute against virtual `now`.
- `context.WithTimeout`, `context.WithDeadline` use virtual time.

The virtual clock starts at an unspecified but fixed value when `Run` is entered. Tests should not rely on a particular start value; use deltas.

The virtual clock advances when:

- A bubble goroutine calls `time.Sleep`, `time.After`, etc. — the goroutine blocks, and if no other bubble goroutine is runnable, the runtime advances to the earliest pending deadline.
- A bubble goroutine calls `synctest.Wait`, all others are blocked, and there are pending timers.

The virtual clock does **not** advance when:

- Bubble goroutines are runnable (executing).
- Real-time operations are pending.

---

## Bubble Membership Rules

- The goroutine that enters `synctest.Run` becomes a temporary bubble member for the duration of `f`.
- Any goroutine started via `go` from a bubble member is also a member.
- Membership is hereditary; a goroutine started by a member is a member.
- Membership is permanent until exit; a goroutine cannot leave the bubble.
- Goroutines outside the bubble that interact with bubble channels still operate; the bubble does not virtualise them.
- It is undefined behaviour to pass a bubble-internal `*time.Timer` to a non-bubble goroutine.

---

## Bubble-Aware Operations

These standard library operations are tracked by the bubble (cause `active` to decrement on block, increment on unblock):

| Package | Operation |
|---------|-----------|
| `time` | `Sleep`, `After`, `NewTimer`, `NewTicker`, `AfterFunc`, timer channel reads |
| (built-in) | Channel send, channel receive |
| `sync` | `Mutex.Lock`, `RWMutex.Lock`/`RLock`, `Cond.Wait`, `WaitGroup.Wait`, `Once.Do` |
| `context` | `Done()` channel reads when the context has a virtual-time deadline |

Operations **not** tracked:

| Operation | Why |
|-----------|-----|
| `runtime.Gosched` | Yield, not a block |
| Atomic ops | Never block |
| System calls | Opaque to runtime |
| CGo calls | Opaque to runtime |
| `unsafe` operations | No semantics |
| Direct `runtime.Goexit` | Terminates the goroutine; the bubble sees it as exit |

Calling an untracked blocking operation from a bubble goroutine can cause `Wait` to hang. The runtime detects long-running bubble deadlocks and panics.

---

## Error and Panic Modes

| Condition | Outcome |
|-----------|---------|
| Bubble goroutine alive after `Run` returns | Runtime panic, "goroutine remained running" |
| `Wait` called outside a bubble | Panic |
| Two concurrent `Wait` calls in same bubble | Panic |
| `Run` called inside a bubble | Panic |
| Bubble deadlock (all blocked, no timers) | Panic |
| Bubble goroutine panics | Propagates through `Run` |
| Bubble goroutine calls `runtime.Goexit` | Goroutine terminates cleanly |

Panics from inside a bubble propagate up through `Run` and may be caught by a deferred `recover` in the test outside the bubble.

---

## Interaction with `-race`

`testing/synctest` is fully compatible with `-race`. The race detector instruments all bubble goroutines normally. A test should run under both:

```
go test -race ./...
go test ./...   # without race
```

A race detected inside a bubble is a real race. The bubble's cooperative scheduling does not relax memory model rules.

---

## Versioning and Stability

- Go 1.24: experimental, behind `GOEXPERIMENT=synctest`.
- Go 1.25: graduated, no flag required.
- Go 1.26+: stable API; future changes will follow normal Go compatibility rules.

Future planned additions (subject to change):

- `synctest.Test(t *testing.T, f func(*testing.T))` — a `Run`-equivalent that takes `*testing.T` for ergonomics.
- Helpers for stepping the virtual clock explicitly.

Treat anything beyond `Run` and `Wait` as experimental until your Go version's release notes confirm.

---

## Reference Conformance Tests

A correct `testing/synctest` implementation passes:

1. **Virtual sleep.** `synctest.Run(func() { start := time.Now(); time.Sleep(time.Hour); if time.Since(start) != time.Hour { panic("bug") } })`.
2. **Wait on idle.** `synctest.Run(func() { go func() {}(); synctest.Wait() })` returns.
3. **Leak detection.** `synctest.Run(func() { go func() { select {} }() })` panics.
4. **Deadlock detection.** `synctest.Run(func() { ch := make(chan int); <-ch })` panics.
5. **Multiple timers.** Order matches deadline order, not registration order, when deadlines differ.
6. **Context virtualisation.** `context.WithTimeout(ctx, 5*time.Second)` cancels at virtual t+5s.
7. **Channel passthrough.** A channel sent from outside the bubble to a bubble goroutine works normally.
8. **Panic propagation.** A bubble goroutine panic propagates through `Run`.
9. **No nesting.** `synctest.Run(func() { synctest.Run(...) })` panics.
10. **`Wait` outside bubble.** Calling `synctest.Wait` from a non-bubble goroutine panics.

Any deterministic-testing harness that claims `synctest` compatibility must pass these.

---

End of specification.
