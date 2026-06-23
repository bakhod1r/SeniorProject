# Starvation — Specification

## Table of Contents
1. [Scope](#scope)
2. [Definitions](#definitions)
3. [Guarantees](#guarantees)
4. [Non-Guarantees](#non-guarantees)
5. [Runtime Mechanisms](#runtime-mechanisms)
6. [API Surface](#api-surface)
7. [Observability Contract](#observability-contract)
8. [Versioning](#versioning)

---

## Scope

This document specifies, for Go programs targeting Go 1.18 and newer:

- The conditions under which starvation can and cannot occur on the standard concurrency primitives.
- The fairness guarantees the runtime offers and the ones it explicitly does not.
- The observability hooks available for detecting starvation.
- The behaviour to expect of `sync.Mutex`, `sync.RWMutex`, channels, `select`, and the scheduler.

Behaviour described as a guarantee is part of Go's compatibility promise and will not change without a documented migration path. Behaviour described as an implementation detail may change between Go releases.

---

## Definitions

**Starvation.** A goroutine `G` starves on resource `R` if and only if:

1. `G` is waiting for `R` (is in a runtime state that depends on `R` becoming available).
2. `R` becomes available infinitely often (or at least once during the observation window).
3. Each time `R` becomes available, some other goroutine — not `G` — consumes it.

A goroutine that is *blocked* (waiting on a primitive that will never fire) is in *deadlock*, not starvation. A goroutine that is *running* but making no useful progress is in *livelock*, not starvation.

**Fairness.** A primitive is *fair* if every waiter is served within a bounded number of releases. The bound may depend on the number of currently waiting goroutines.

**Tail latency.** The latency of a request at a high percentile, typically p99 or higher.

**Critical section.** The code between an acquire and a release of a mutual-exclusion primitive.

---

## Guarantees

### `sync.Mutex`

- (G1) `Lock` and `Unlock` are safe to call from any goroutine in any order, as long as `Unlock` is only called by the goroutine that holds the lock and only when the lock is held.
- (G2) Since Go 1.9, no waiter remains parked for more than approximately 1 ms beyond the longest-running critical section. The exact wording: a waiter that has been parked for more than `starvationThresholdNs` (1e6 ns = 1 ms) at the time it wakes will switch the mutex to starvation mode, after which it is guaranteed to receive the lock from the next `Unlock`.
- (G3) The set of operations on a single `sync.Mutex` is linearisable: there is a total order consistent with program order in each goroutine and with the lock's transition history.

### `sync.RWMutex`

- (G4) `RLock`/`RUnlock` and `Lock`/`Unlock` are pairwise safe: many `RLock`s can be active simultaneously; `Lock` blocks until all `RLock`s have released and no other writer is active.
- (G5) When `Lock` is pending, new `RLock` calls block until the writer completes. This prevents indefinite reader admission from starving the writer due to *new* readers; it does not bound the wait caused by *already-active* readers.
- (G6) After a writer's `Unlock`, all readers parked at the moment of unlock are woken before the next writer can acquire (assuming no other writer was already racing).

### Channels

- (G7) Sends and receives on a buffered channel are FIFO with respect to senders and receivers respectively. That is, if goroutine `S1` calls `ch <- v1` strictly before `S2` calls `ch <- v2`, and both block, then `S1` resumes before `S2`.
- (G8) Sends and receives on an unbuffered channel pair up senders and receivers; the choice of which parked goroutine is paired is implementation-defined but is effectively pseudo-random in current implementations.
- (G9) `close` on a channel wakes all receivers; each subsequent receive returns the zero value and `ok == false`.

### `select`

- (G10) When multiple `select` cases are ready at the moment of evaluation, the runtime picks one uniformly at random among the ready cases.
- (G11) If no case is ready and there is a `default`, `default` is taken immediately.
- (G12) If no case is ready and there is no `default`, the goroutine blocks until at least one case becomes ready.

### Scheduler

- (G13) Since Go 1.14, a goroutine that runs continuously without entering the runtime is preempted asynchronously after approximately 10 ms.
- (G14) Goroutines created with the `go` keyword become runnable immediately; scheduling order between equally-runnable goroutines is implementation-defined.
- (G15) `runtime.Gosched` is a hint to the scheduler; it does not guarantee that another goroutine runs, but it allows the scheduler to consider other goroutines.

---

## Non-Guarantees

### `sync.Mutex`

- (N1) `sync.Mutex` does not guarantee strict FIFO order of acquisition. In normal mode, a goroutine entering `Lock` for the first time may acquire the lock before goroutines that have been waiting longer. Starvation mode makes this property eventually-fair, not strictly-FIFO.
- (N2) `Lock` is not cancellable. A goroutine parked in `Lock` ignores `context.Context` cancellation.
- (N3) `sync.Mutex` is not reentrant. A goroutine that calls `Lock` on a mutex it already holds will deadlock.

### `sync.RWMutex`

- (N4) `Lock` (writer) is not bounded in wait time. A long-running reader can delay a writer indefinitely.
- (N5) `RWMutex` does not implement writer priority. Writers wait their turn behind both existing readers and the inner writer-vs-writer mutex.

### `select`

- (N6) `select` does not provide ordered or weighted case selection. Any priority among cases must be implemented in user code (typically with a two-stage select pattern).
- (N7) `select` over a fixed list of cases is fair *only* with respect to readiness. Bias in readiness rates produces bias in case selection.

### Scheduler

- (N8) There is no goroutine priority at the runtime level. Application-level priority must be implemented in user code.
- (N9) Work-stealing rebalances Ps; it does not rebalance Ms or goroutines tied to a specific M (e.g., via `runtime.LockOSThread`).
- (N10) The 10 ms preempt slice is best-effort. Heavy GC, system calls, or assembly without safe points can extend it.

---

## Runtime Mechanisms

### Starvation mode (mutex)

- Triggered when any single waiter has been parked for more than 1 ms.
- Disables the CAS fast path: every acquire enters the slow path and queues.
- `Unlock` calls `runtime_Semrelease(&sema, true, 1)` to hand off the lock directly to the parked waiter.
- Mode is cleared when the last waiter or a waiter whose own wait was short acquires the lock.

### Writer-pending bit (RWMutex)

- When a writer arrives, it atomically subtracts `rwmutexMaxReaders` (1<<30) from `readerCount`, making the field negative.
- New `RLock` calls see the negative value, park on `readerSem`.
- `RUnlock` decrements `readerWait`; the last one wakes the writer.

### Async preemption (scheduler)

- The scheduler tracks each G's start time. After 10 ms of continuous execution, it sets the G's `preempt` flag and signals the M.
- Signal handler interrupts at a safe point, switches the G's PC to a runtime preemption function.
- The G resumes later, possibly on a different P.

### Work-stealing

- An idle M acquires an idle P, finds its LRQ empty, and steals half the contents of another P's LRQ.
- Periodically (every 61 schedticks) an M checks the GRQ to drain it.

---

## API Surface

The following identifiers are relevant for starvation analysis and mitigation. None of them are unique to "starvation" — they are general concurrency tools whose correct use prevents starvation.

| Identifier | Package | Purpose |
|------------|---------|---------|
| `sync.Mutex.Lock` / `Unlock` | sync | Mutual exclusion with auto-fairness via starvation mode. |
| `sync.RWMutex.RLock` / `RUnlock` / `Lock` / `Unlock` | sync | Read-mostly mutual exclusion with reader-bias and writer-pending hint. |
| `sync.Cond` | sync | Condition variable; useful for custom fair queueing. |
| `runtime.Gosched` | runtime | Yield to the scheduler. |
| `runtime.SetMutexProfileFraction` | runtime | Enable mutex contention profiling. |
| `runtime.SetBlockProfileRate` | runtime | Enable block profiling. |
| `runtime/metrics` | runtime/metrics | Read `/sync/mutex/wait/total:seconds`. |
| `context.WithTimeout` / `WithCancel` | context | Bound waits for any cancellable operation. |
| `time.After` / `time.NewTimer` | time | Add a timeout case to `select`. |
| `runtime.LockOSThread` / `UnlockOSThread` | runtime | Pin a goroutine to an OS thread; opts out of normal stealing. Avoid for fairness. |

---

## Observability Contract

A Go program targeting the standard library provides:

- (O1) **Mutex profile.** With `runtime.SetMutexProfileFraction(N)`, the runtime samples mutex contention events. The profile attributes wait time to acquisition sites.
- (O2) **Block profile.** With `runtime.SetBlockProfileRate(R)`, the runtime samples blocking events on channels, mutexes, and other primitives.
- (O3) **`runtime/metrics`.** The metric `/sync/mutex/wait/total:seconds` is a monotonically increasing total of seconds spent waiting on mutexes across all goroutines. Other metrics relevant to scheduling: `/sched/latencies:seconds`, `/sched/goroutines:goroutines`.
- (O4) **Stack dumps.** `runtime.Stack` or `SIGQUIT` produces a full goroutine stack dump including each goroutine's wait reason.
- (O5) **`GODEBUG=schedtrace=N`.** Emits scheduler statistics every N ms to stderr.
- (O6) **`GODEBUG=asyncpreemptoff=1`.** Disables async preemption for diagnosis.

A program operator can require:

- An explicit p99 latency SLO for each user-facing operation.
- An alert on `/sync/mutex/wait/total:seconds` increase rate.
- A periodic snapshot of mutex and block profiles in production.

---

## Versioning

This specification reflects Go 1.18 through Go 1.22 (current at writing). Notable historical points:

- **Go 1.9:** introduced `sync.Mutex` starvation mode.
- **Go 1.14:** introduced async preemption.
- **Go 1.18:** generics; no scheduler/sync changes affecting starvation behaviour.
- **Go 1.19:** `runtime/metrics` mutex wait surfaced as an official metric.
- **Go 1.20:** profile improvements; no behavioural change.
- **Go 1.21:** scheduler-related tweaks (timer goroutines distributed; not directly fairness-affecting).

Future Go releases may tighten or relax the guarantees here. Code that depends on a guarantee should reference the Go version it targets in a comment near the dependency.
