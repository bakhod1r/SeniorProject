# Deadlock in Go — Specification

## Scope

This document specifies the observable behaviour of the Go runtime with respect to deadlock detection. It covers the contract between user code and the runtime, not the internal implementation (which is in [professional](professional.md)).

---

## Terminology

- **Goroutine.** A user-space concurrent unit of execution, scheduled by the Go runtime. Defined by the Go Programming Language Specification (the Go spec) under "Go statements."
- **System goroutine.** A goroutine spawned by the runtime for its own bookkeeping (garbage collection, finalizers, scavenging, trace reading). Not user-visible; not counted by the deadlock detector.
- **Parked goroutine.** A goroutine in `_Gwaiting` or `_Gpreempted` state — i.e., not eligible to execute on any thread.
- **Runnable goroutine.** A goroutine in `_Grunnable`, `_Grunning`, or `_Gsyscall` state — i.e., able to execute or currently executing.
- **Whole-program deadlock.** A program state in which every non-system goroutine is parked and no external wakeup source (timer, netpoller, cgo) can transition any of them to runnable.
- **Partial deadlock.** A program state in which a strict subset of goroutines is in a wait cycle, while other goroutines remain runnable.

---

## Detection Contract

### When the runtime aborts with `fatal error: all goroutines are asleep - deadlock!`

The runtime guarantees that this error is emitted **if and only if** all of the following hold simultaneously:

1. The number of non-system, non-parked user goroutines is zero.
2. No timer is pending in the runtime's timer heap.
3. No file descriptor is registered with the network poller.
4. No goroutine is in a cgo call.
5. No goroutine is locked to an OS thread via `runtime.LockOSThread` and currently running.
6. The runtime is not in the middle of panic recovery or program shutdown.

If any one of these conditions is false, the runtime will not abort, even if a logical deadlock exists.

### Stack output format

When the runtime aborts, it writes to standard error:

1. The literal string `fatal error: all goroutines are asleep - deadlock!\n`.
2. A blank line.
3. For each goroutine, a block of the form:
   ```
   goroutine <id> [<state>]:
   <stack frame 1>
       <file>:<line> +0x<offset>
   <stack frame 2>
       <file>:<line> +0x<offset>
   ...
   ```
4. After all blocks, the process exits with status 2.

The `<state>` is one of a fixed set of strings (`chan receive`, `chan send`, `select`, `semacquire`, `sync.Mutex.Lock`, `sync.WaitGroup.Wait`, etc.). The exact set is defined in `runtime/runtime2.go` as `waitReasonStrings`.

The exit code 2 distinguishes deadlock from ordinary panic (exit 2 generally, but the message differentiates).

### Inhibitors of detection

The following conditions inhibit the detector even when a logical deadlock exists:

- **A live `time.Sleep`, `time.After`, `time.Ticker`, `time.AfterFunc`, or any timer registered with the runtime.** The runtime treats pending timers as future wakeup sources.
- **An open network listener or connection.** The netpoller goroutine is considered alive.
- **An active cgo call.** The runtime cannot inspect foreign code.
- **A goroutine in a tight non-blocking loop using `runtime.Gosched`.** The goroutine is `_Grunnable`, not parked, so the count is non-zero.
- **A finalizer goroutine processing finalizers.**

User code that wishes to make whole-program deadlock detectable in tests should avoid these inhibitors during the suspect region.

---

## Primitives and Their Park Reasons

The following table specifies the `[state]` string that appears in a stack dump for each blocking primitive.

| Primitive | Operation | Parked state string |
|---|---|---|
| Channel | unbuffered or full send | `chan send` |
| Channel | unbuffered or empty receive | `chan receive` |
| Channel | `for range` on empty channel | `chan receive` |
| `select` | no case ready | `select` |
| `sync.Mutex` | `Lock` on held mutex | `sync.Mutex.Lock` (Go 1.20+) / `semacquire` (older) |
| `sync.RWMutex` | `Lock` on held mutex | `sync.RWMutex.Lock` / `semacquire` |
| `sync.RWMutex` | `RLock` with pending write | `sync.RWMutex.RLock` / `semacquire` |
| `sync.WaitGroup` | `Wait` with non-zero counter | `sync.WaitGroup.Wait` / `semacquire` |
| `sync.Cond` | `Wait` for signal | `sync.Cond.Wait` / `semacquire` |
| `sync.Once` | concurrent `Do` of pending `f` | `sync.Once.Do` / `semacquire` |
| `time.Sleep` | sleeping | `sleep` |
| `runtime.Gosched` | (does not park, yields only) | — |
| GC stop-the-world | GC running | `GC waiting` |

The exact string is the value of `waitReasonStrings[g.waitreason]` for the parked goroutine.

---

## Guarantees Under Detection

### Determinism

If a program reaches a whole-program deadlock state, the runtime will detect it within a bounded time. The bound is implementation-defined; in practice, detection happens within one scheduler tick (typically < 10 ms) of the final park.

The runtime does **not** guarantee that a program with a logical deadlock will *always* reach the detected state. If a timer keeps the detector silent, the program runs indefinitely.

### Reproducibility

Whole-program deadlock detection is deterministic with respect to program input: a program that deadlocks on input X will produce the same `fatal error` message on every run with input X, regardless of CPU count or `GOMAXPROCS`.

Partial deadlock is not deterministic in this sense. Timing variations (when goroutines park, when locks are taken) can make a partial deadlock manifest on one run and not another.

### Stack accuracy

The stack frames printed in the deadlock dump are accurate at the moment of detection. Each frame's file:line refers to the exact source location where the goroutine was blocked.

The mutex address shown in frames like `sync.runtime_SemacquireMutex(0xC000010030, 0x0, 0x1)` is the address of the `uint32` semaphore counter inside the mutex. To map it to a named mutex, the user must record `&yourMutex.sema` separately.

---

## Behaviours That Are *Not* Specified

The Go runtime does not guarantee:

- **Partial deadlock detection.** A subset of goroutines in a wait cycle while others are alive is not detected, ever, in any version of Go.
- **Lock order enforcement.** Acquiring two mutexes in different orders in different goroutines is not flagged by `sync.Mutex` or `sync.RWMutex`.
- **Reentrancy.** `sync.Mutex.Lock` called twice on the same goroutine deadlocks. It is not promoted to a recursive lock.
- **Fairness.** Goroutines waiting on a `sync.Mutex` are not guaranteed FIFO order. (Recent Go versions implement a hybrid policy with starvation prevention, but the spec does not require a specific order.)
- **Timeout semantics.** `sync.Mutex.TryLock` returns `false` if the lock is held; it does not wait. There is no built-in `LockWithTimeout`.
- **Cycle reporting.** When the detector fires, the printed stacks are complete, but the cycle in the wait graph is not explicitly identified. The user must reconstruct it from the stacks.

---

## Concurrency-Primitive Discipline

The Go specification and the documentation for the `sync` package impose disciplines whose violation can produce deadlock. Selected:

### `sync.Mutex` / `sync.RWMutex`

- The lock must not be copied after first use. (Enforced by `go vet`'s `copylocks` analyzer; not enforced at runtime.)
- A `RWMutex.Lock` while readers hold `RLock`, and another goroutine then requests `RLock`, may deadlock — current implementation gives priority to the pending writer to prevent writer starvation, but if the reader is reentrant on the same goroutine, deadlock.

### `sync.WaitGroup`

- A `WaitGroup`'s counter must not go negative. `Add(n)` where `n` would drop the counter below zero panics; this is not a deadlock but is fatal.
- Calls to `Add` with a positive delta while a `Wait` is in progress are unspecified — the documentation says they must happen before `Wait`.
- A `WaitGroup` reused after `Wait` returns is permitted only if no `Add` calls overlap.

### `sync.Cond`

- `Wait` must be called with the associated `L` held. The documentation says behaviour is unspecified otherwise.
- `Wait` should be in a loop checking the condition, because spurious wakeups are allowed (and happen with `Broadcast`).

### Channels

- A `nil` channel blocks forever on send and receive. In a `select`, a `nil` channel case is silently inactive.
- A closed channel returns the zero value on receive without blocking; send on a closed channel panics.
- The receiver's "ok" idiom (`v, ok := <-ch`) distinguishes a closed channel (`ok == false`) from a normal receive.

### `context.Context`

- `WithCancel`, `WithTimeout`, `WithDeadline` return a `cancel` function. Failing to call `cancel` leaks resources (an internal goroutine in some implementations). Not a deadlock; flagged by `go vet`'s `lostcancel` analyzer.
- `Done()` returns a channel that is closed when the context is cancelled or expired. Reading from `Done()` of a cancelled context returns the zero value immediately.

---

## Differences Across Go Versions

| Version | Change |
|---|---|
| 1.0 | Initial detector with whole-program-only semantics. |
| 1.14 | Async preemption added; goroutines in tight loops no longer indefinitely prevent detection (they can now be preempted). |
| 1.18 | `sync.Mutex.TryLock` and `sync.RWMutex.TryLock` added. |
| 1.20 | Stack dump uses descriptive wait reasons (`sync.Mutex.Lock`) instead of `semacquire`. |
| 1.21 | Improvements to timer wheel; sleeping goroutines tracked more precisely. |
| 1.22 | `for` loop variable per-iteration semantics; eliminates a class of deadlock-by-closure-capture in `WaitGroup` patterns. |

---

## Tools and Their Contracts

### `go vet`

- **`copylocks`**: detects passing `sync.Mutex`-containing types by value. Sound (no false negatives for the patterns it covers), conservative.
- **`lostcancel`**: detects `context.WithCancel` whose `cancel` is not called on all paths. Best-effort; can produce false positives in code with non-trivial control flow.
- Neither analyzer detects lock order inversion, missing `Unlock`, or channel deadlocks.

### `goleak` (`go.uber.org/goleak`)

- `goleak.VerifyTestMain(m)` or `goleak.VerifyNone(t)` asserts no goroutines outlive the test.
- Catches any goroutine that has not exited, including deadlocked ones.
- Provides options `IgnoreCurrent`, `IgnoreTopFunction`, `Cleanup` for filtering.

### `net/http/pprof`

- `/debug/pprof/goroutine?debug=1` — counts by unique stack.
- `/debug/pprof/goroutine?debug=2` — full text dump (same format as `kill -3`).
- No deadlock-specific filtering; the user identifies cycles manually.

### `kill -3` / `SIGQUIT`

- Default handler prints all goroutine stacks to stderr, then exits with status 2.
- Suppressible: a user-installed `signal.Notify` for `SIGQUIT` overrides the default.

---

## Implementation Notes (Non-Normative)

The detector lives in `runtime/proc.go::checkdead`. It is invoked from `stoplockedm`, `notesleep`, and adjacent functions, all on the slow path of "an OS thread has no goroutine to run."

The detector's runtime cost is paid once per "M idle" transition. For most programs this is negligible (a few times per second). For programs with extreme park/unpark churn (e.g., 10M ops/sec), the detector's cost is still under 1% of total CPU.

The detector does not run on every block. It runs when the scheduler is about to park the last available M. So a program with M=4 (4 OS threads) and many goroutines pays for the check only when all four Ms become idle simultaneously.

---

## Compliance Checklist for Library Authors

If you publish a Go library that uses concurrency primitives, conform to:

- [ ] No exported types contain `sync.Mutex` by value (only by pointer); `go vet` `copylocks` passes.
- [ ] Every `context.Context`-taking function selects on `ctx.Done` during blocking operations.
- [ ] Every `sync.Mutex.Lock` is followed by a `defer Unlock` on the next line, or has a documented justification for not using `defer`.
- [ ] Every goroutine the library spawns has a documented termination condition; calling code can wait for or signal termination.
- [ ] Tests use `goleak.VerifyTestMain` or `goleak.VerifyNone` per test.
- [ ] Any function that acquires more than one mutex documents the acquisition order in its godoc comment.
- [ ] Any function that takes a callback specifies whether the callback runs with the library's locks held.

Following these rules does not guarantee deadlock-freedom, but failure to follow them is almost always responsible for the deadlocks that occur in client code.
