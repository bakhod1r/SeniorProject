---
layout: default
title: Specification
parent: Unlimited Goroutines
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 5
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/01-unlimited-goroutines/specification/
---

# Unlimited Goroutines — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Formal Anti-Pattern Definition](#formal-anti-pattern-definition)
3. [The `go` Statement (Language Spec)](#the-go-statement-language-spec)
4. [Runtime Behaviour of Goroutine Creation](#runtime-behaviour-of-goroutine-creation)
5. [The GMP Model](#the-gmp-model)
6. [Runtime Guarantees](#runtime-guarantees)
7. [Runtime Non-Guarantees](#runtime-non-guarantees)
8. [Memory Model Interactions](#memory-model-interactions)
9. [Resource Limits](#resource-limits)
10. [GOMAXPROCS Interactions](#gomaxprocs-interactions)
11. [Stack Growth Specification](#stack-growth-specification)
12. [Channel Backpressure Specification](#channel-backpressure-specification)
13. [Semaphore Semantics](#semaphore-semantics)
14. [`errgroup.SetLimit` Specification](#errgroupsetlimit-specification)
15. [Goroutine Lifetime](#goroutine-lifetime)
16. [Invariants of a Bounded Fan-Out](#invariants-of-a-bounded-fan-out)
17. [Failure Modes](#failure-modes)
18. [Detection Specification](#detection-specification)
19. [`GODEBUG` Knobs](#godebug-knobs)
20. [Links to Go Runtime Source](#links-to-go-runtime-source)
21. [References](#references)

---

## Introduction

This document specifies, as precisely as possible, the runtime behaviour relevant to the "unlimited goroutines" anti-pattern. It distinguishes:

- **Normative behaviour** (what Go *guarantees*): the Language Specification, the Memory Model.
- **Implementation behaviour** (what the current Go runtime *does*): scheduler, runtime, GC.
- **Documented behaviour** (what packages and tools *promise*): `runtime`, `sync`, `golang.org/x/sync`.

The anti-pattern itself is not in any Go specification. It is a *pattern*, not a language construct. This document defines it formally and links it to the underlying mechanisms.

---

## Formal Anti-Pattern Definition

**Definition.** A Go program exhibits the **unlimited goroutines anti-pattern** when, at some statement S, the count of `go` invocations executed since program start is unbounded as a function of an input I to which S is reachable.

Formally, let `count(S, input)` be the number of times S is executed when the program is fed `input`. The program exhibits the anti-pattern at S if there exists no constant `K` such that for all valid `input`, `count(S, input) ≤ K`.

**Equivalently** (informally): if there exists an input that causes the program to spawn more goroutines than the number of distinct invocations is bounded by the input's size, S is *unbounded by control flow*.

Note that this definition is about *count*, not concurrent liveness. A loop that spawns N goroutines sequentially, where each terminates before the next starts, is technically unbounded by count but bounded in concurrency. In practice the anti-pattern always involves concurrent liveness — the spawned goroutines overlap.

**Refined definition (with concurrency).** A program exhibits the **unbounded-concurrent-fan-out anti-pattern** if, for some bounded resource R consumed by spawned goroutines, the simultaneous count of goroutines holding R is unbounded as a function of the input.

R is typically:
- Memory (each goroutine consumes stack + heap).
- File descriptors.
- Connections (database, HTTP).
- Tokens at a downstream service.

When R is exceeded, the program fails.

---

## The `go` Statement (Language Spec)

From the Go Programming Language Specification:

> A "go" statement starts the execution of a function call as an independent concurrent thread of control, or goroutine, within the same address space.
>
> GoStmt = "go" Expression .
>
> The expression must be a function or method call; as with defer statements, parentheses around a built-in function call are illegal. Function value and parameters are evaluated as usual in the calling goroutine, but unlike with a regular call, program execution does not wait for the invoked function to complete. Instead, the function begins executing independently in a new goroutine. When the function terminates, its goroutine also terminates. If the function has any return values, they are discarded when the function completes.

Key formal points:

1. `go` is a statement, not an expression.
2. The argument to `go` must be a function or method *call*, not a function value.
3. Function values and arguments are evaluated in the calling goroutine, before the new goroutine starts.
4. Return values are discarded.

The specification places no bound on how many goroutines a program can have. It also places no bound on what `go` does at runtime — the implementation is free to manage scheduling, stack allocation, and so on.

This permissive specification is what enables the anti-pattern: there is no language-level prohibition on writing `for { go ... }`. The bound is the programmer's responsibility.

---

## Runtime Behaviour of Goroutine Creation

When `go f()` executes, the Go runtime performs the following (per `runtime.newproc` in `src/runtime/proc.go`):

1. **Allocate or reuse a `g` struct.** The runtime maintains a free list (`gFree`). If a free `g` is available, it is reused; otherwise a new one is allocated (~1 KB plus stack).

2. **Allocate the initial stack.** The default initial stack is 2 KB (Go 1.21+) — actually, the runtime's `_StackMin` is `2048` bytes; the stack is allocated from the heap.

3. **Copy the function arguments.** The arguments to `f` are copied onto the new goroutine's stack. This copy happens *eagerly* — even before the goroutine is scheduled.

4. **Initialize the `g` struct.** The status is set to `_Grunnable`. The PC is set to point at `f`. The stack pointer is set.

5. **Enqueue on the local P's run queue.** The new goroutine is placed on the calling P's local run queue. If the queue is full (256 entries), half is moved to the global queue.

6. **Possibly wake a parked M.** If no M is currently looking for work and the local P has work, the runtime may wake a parked M to handle it.

Total cost: typically 200-500 ns under uncontended conditions, dominated by allocation. Under heavy fan-out, the cost rises because of run queue rebalancing and lock contention on the global queue.

### Implications for the anti-pattern

- The cost of `go` is non-zero. At 1 million `go` statements per second, the runtime spends ~500ms/s just on `newproc`.
- Stack allocation creates GC pressure proportional to the spawn rate.
- The local run queue saturation moves work to the global queue, which is a contention point.

### `g0` and scheduling stack

Each M has a `g0`, a special goroutine with a large stack used for scheduling decisions. When an M is running goroutine code, the user `g` is active. When it is making scheduling decisions, it switches to `g0`.

`g0`'s stack is typically 8 KB. It is not counted in goroutine totals; it is per-M.

---

## The GMP Model

The Go runtime scheduler maps:

- **G** (goroutine): a unit of execution. Many per program.
- **M** (machine, an OS thread): runs goroutines. As many as needed.
- **P** (processor, a scheduling context): owns a local run queue. `GOMAXPROCS` of them.

Relationships:

- Every running G is bound to an M.
- Every running M is bound to a P (otherwise it cannot run user code).
- A P with no work tries to steal from another P, then sleeps.
- An M with no P (e.g., blocked on syscall) cannot run user code.

The state diagram:

```
G states:
  _Gidle (initial)
  _Grunnable (queued, can be scheduled)
  _Grunning (currently executing on an M)
  _Gsyscall (executing a syscall)
  _Gwaiting (blocked on a channel, mutex, etc.)
  _Gdead (finished, available for reuse)

M states:
  Running (bound to P, running G)
  Spinning (bound to P, looking for work)
  Idle (no P, no work, parked)

P states:
  Running (bound to M, has G to run)
  Idle (no M)
```

### Scheduling decisions

When an M's bound P has no goroutine to run, the M (via `findRunnable`):

1. Checks its local P's run queue.
2. Checks the global run queue (every 61st iteration to prevent starvation).
3. Checks the net poller for ready I/O.
4. Tries to steal half of another P's local queue.
5. If still empty, parks (the M becomes idle).

The 61 is a Mersenne prime chosen to avoid synchronisation patterns with other periodic events.

### `newproc` and `goready`

When a goroutine is created (`newproc`) or unblocked (`goready`), it is placed on the local P's run queue (if there's capacity) or the global queue (if local is full).

The `wakep` function may wake a sleeping M if there is one and there is excess work.

---

## Runtime Guarantees

The following are *guarantees* from the Go specification and runtime documentation:

1. **`go` starts a new concurrent thread.** The goroutine is logically independent from the caller; the caller may proceed to the next statement.

2. **Arguments are evaluated in the caller.** Before the new goroutine starts, its function arguments are fully evaluated. This means a deferred argument value is captured by the caller, not by the new goroutine.

3. **Goroutines are preemptible (since Go 1.14).** A goroutine in a tight loop can be preempted by the runtime via async preemption.

4. **`main` exits → program exits.** When `func main` returns, the program terminates immediately, including all other goroutines.

5. **Channel operations follow happens-before.** A receive from a channel happens-after the corresponding send (formally specified in the Memory Model).

6. **`sync.Mutex.Unlock` happens-before subsequent `Lock`s of the same mutex.**

7. **Garbage collection does not lose pointers.** A goroutine holding a pointer to an object keeps that object live.

8. **Stack growth is invisible to user code.** The runtime may copy a stack to grow it; references to stack variables are updated. (Except for `unsafe.Pointer` aliasing, which is documented as undefined.)

---

## Runtime Non-Guarantees

The following are explicitly *not* guaranteed:

1. **The order in which goroutines run.** The scheduler may run goroutines in any order on any M.

2. **Fairness.** A starved goroutine is *not* guaranteed to eventually run. In practice, the runtime provides reasonable fairness, but the spec does not promise it.

3. **The exact moment of preemption.** The runtime decides when to preempt, based on heuristics.

4. **The exact stack size.** A goroutine's stack may grow or shrink at any GC. Code that relies on a specific stack size is incorrect.

5. **`runtime.NumGoroutine()` precision.** The count may include or exclude goroutines in transition states.

6. **Goroutine identity.** Goroutines do not have a public identity. The `g` struct has a `goid`, but it is not part of the API.

7. **Goroutine local storage.** There is none. Use `context.Context`.

8. **Maximum goroutine count.** There is no documented maximum. The practical limit is memory.

9. **The cost of `go`.** Documented as "lightweight," but the exact cost is not specified.

10. **`GOMAXPROCS = 0` semantics.** The behaviour of setting GOMAXPROCS to zero is not documented; in practice, the runtime treats it as 1.

These non-guarantees matter for the anti-pattern because relying on any of them (e.g., "the runtime will starve the goroutines I don't want to run") is incorrect.

---

## Memory Model Interactions

The Go Memory Model (`go.dev/ref/mem`) defines when one goroutine's reads observe another's writes. Key statements relevant to the anti-pattern:

1. **`go f()` happens-before `f`'s execution starts.** Whatever the caller did before the `go` statement is observable to `f` on entry.

2. **`f`'s exit happens-before the corresponding event observed by another goroutine.** If goroutine A spawned `f` and later observes `f`'s completion (via a channel close, a waitgroup signal, etc.), A observes everything `f` did.

3. **Channels synchronise.** A send `ch <- v` synchronises with the corresponding receive `<-ch` (or vice versa, on a buffered channel).

4. **Mutex.Unlock synchronises with the next Lock.**

5. **`sync/atomic` operations are sequentially consistent.**

### Implication for unbounded fan-out

If the parent spawns N goroutines and does not wait for them, the parent has no guarantee that any of them has executed when the parent proceeds. The lifetime of the spawned goroutines is *not* bound to the parent's; only an explicit synchronisation makes it so.

This is why structured concurrency (`errgroup.Wait`) is important: it provides the synchronisation point that makes the lifetimes nested.

---

## Resource Limits

The following resources can be exhausted by unlimited goroutines:

### Heap memory

Each goroutine starts with a 2 KB stack but typically grows to 8-64 KB under realistic call chains. Heap allocations made during execution add to this. There is no language-level limit; the practical limit is the host's memory.

In a container with a memory limit, the kernel kills the process at the limit (OOMKilled).

### Stack

A goroutine's stack can grow up to `runtime/debug.SetMaxStack` (default 1 GB). Reaching this triggers panic `runtime: goroutine stack exceeds 1000000000-byte limit`.

This rarely happens for unbounded fan-out — the limit is per goroutine, not aggregate. It's typically reached by runaway recursion.

### Thread (OS) count

When a goroutine performs a blocking syscall, an M is dedicated to it. If many goroutines block in syscalls simultaneously, many Ms are created. `runtime/debug.SetMaxThreads` (default 10 000) caps this.

Exceeding it: `runtime: program exceeds 10000-thread limit`.

### File descriptors

Each TCP connection, file open, etc. consumes an FD. The OS ulimit (typically 65 535 in production) caps the total.

Exceeding it: syscall errors `EMFILE` (this process) or `ENFILE` (system-wide).

### Database connection pool

Application-level limit, typically 10-200. Exceeded by:
- Configurable via `db.SetMaxOpenConns`.
- New `db.Conn` calls block.

### TCP ephemeral ports

Outbound connections use ports 32 768 - 60 999 (Linux default). About 28 000 ports.

Exceeded: `bind: address already in use` or `connect: cannot assign requested address`.

### Goroutine count itself

There is no hard runtime limit, but practical limits emerge:
- GC pauses grow with goroutine count.
- Scheduler overhead grows.
- Stack scanning takes proportional time.

At millions of goroutines, the runtime works but performance is degraded.

---

## GOMAXPROCS Interactions

`GOMAXPROCS` is the maximum number of OS threads that can simultaneously execute Go code. Defaults to `runtime.NumCPU()`.

### Effect on the anti-pattern

`GOMAXPROCS` does *not* limit goroutine count. It limits the parallelism of execution. With GOMAXPROCS=4 and 10 000 goroutines:
- Only 4 execute at any instant.
- 9 996 are runnable (queued) or waiting.

The 9 996 still consume memory.

### When to lower GOMAXPROCS

In a container with CPU limit < host CPU count, default GOMAXPROCS over-allocates Ps. Use `go.uber.org/automaxprocs` or set explicitly.

### When to raise GOMAXPROCS

Rarely. The default is usually correct. Raising beyond CPU count causes scheduler thrash without throughput gain.

### Setting at runtime

```go
import "runtime"
runtime.GOMAXPROCS(8)
```

Returns the previous value. Setting to 0 is treated as 1.

### Reading

`runtime.GOMAXPROCS(0)` returns the current value without changing it.

---

## Stack Growth Specification

A goroutine's stack starts at `_StackMin` (currently 2048 bytes). When the goroutine's call depth exceeds the stack, the runtime:

1. Detects the overflow via a stack guard check at every function prologue.
2. Allocates a new stack twice the size.
3. Copies the old stack to the new.
4. Updates all pointers on the stack to reference the new locations.
5. Frees the old stack.

Cost: linear in the stack size. For deep recursion, growth is amortised O(1) per call.

The stack can also shrink during GC, if usage is < 1/4 of the allocated size.

### Implication for the anti-pattern

If a goroutine's stack grows to 64 KB and 1 million goroutines exist, total stack memory = 64 GB. The runtime cannot do this; OOM occurs.

Bounded fan-out keeps the count low, keeping aggregate stack memory predictable.

---

## Channel Backpressure Specification

A buffered channel of capacity N:
- Holds up to N values in a ring buffer.
- `ch <- v` blocks if the buffer is full and no receiver is waiting.
- `<-ch` blocks if the buffer is empty and no sender is waiting.

An unbuffered channel:
- Has capacity 0.
- `ch <- v` blocks until a receiver is ready.
- `<-ch` blocks until a sender is ready.

A closed channel:
- Sends panic.
- Receives return the zero value (with `ok = false` in the two-value form).

### FIFO order

Channels are FIFO for waiters:
- Senders block in the order they arrive.
- Receivers block in the order they arrive.
- When a value becomes available, the first waiter gets it.

This FIFO behaviour is the basis for using channels as semaphores: a `chan struct{}` of capacity N is a FIFO counting semaphore.

### `select` semantics

A `select` with multiple ready cases chooses uniformly at random. With `default`, the `default` runs immediately if no case is ready.

---

## Semaphore Semantics

`golang.org/x/sync/semaphore.Weighted` semantics:

### `NewWeighted(n int64) *Weighted`

Creates a semaphore with total capacity `n`. `n` must be non-negative.

### `Acquire(ctx context.Context, n int64) error`

Attempts to acquire `n` units. If `cur + n <= capacity`, succeeds immediately. Otherwise blocks until either:
- Capacity becomes available (returns nil).
- `ctx` is cancelled (returns `ctx.Err()`).

`n` may exceed the semaphore's capacity, but the call will never succeed in that case (unless every other holder releases, which the FIFO discipline may prevent indefinitely).

### `Release(n int64)`

Releases `n` units. Does *not* check that the units were previously acquired; releasing more than was acquired drives the internal counter negative.

If the released units satisfy the requirements of the first FIFO waiter, that waiter is signalled. If not, no waiter is signalled.

### `TryAcquire(n int64) bool`

Non-blocking acquire. Returns true if `n` units were acquired; false otherwise.

### Invariants

- After construction, `cur = 0`.
- After Acquire(n) succeeds, `cur += n`.
- After Release(n), `cur -= n`.
- `cur` should remain in `[0, capacity]` if used correctly.

The semaphore does not enforce the invariant `cur <= capacity` in `Release`; releasing more than acquired is a bug.

### FIFO

Waiters are queued in FIFO order. A waiter of size N cannot be passed over by a waiter of size 1 that arrived later, even if the size-1 request would fit.

This prevents starvation of large requests but means small requests may wait longer than necessary. Designers wanting non-FIFO behaviour should not use this semaphore.

---

## `errgroup.SetLimit` Specification

`golang.org/x/sync/errgroup.Group.SetLimit(n int)`:

### Semantics

- `n < 0`: no limit.
- `n == 0`: every `Go` call deadlocks (effectively unusable; do not call SetLimit(0)).
- `n > 0`: at most `n` goroutines run concurrently in this group.

### `Go(f func() error)`

When `SetLimit(n)` is set with `n > 0`:
- If fewer than `n` goroutines are currently running in this group, `Go` starts `f` immediately.
- If `n` goroutines are running, `Go` blocks until one finishes, then starts `f`.

### `TryGo(f func() error) bool`

- If fewer than `n` running, starts `f` and returns true.
- If `n` running, returns false without starting.

### `Wait() error`

Blocks until all `Go`-started goroutines complete. Returns the first non-nil error returned by any of them. The order of errors observed is non-deterministic; only the first one (by some ordering) is kept, the rest are discarded.

### Context interaction

If created with `WithContext`, the group has a derived context `gctx`. If any goroutine returns a non-nil error, `gctx` is cancelled (and the error is recorded). Other goroutines that observe `gctx.Done()` should exit.

`Wait` cancels `gctx` after all goroutines complete, regardless of error.

### Restrictions

- `SetLimit` must be called *before* the first `Go` call. After that, it panics.
- `SetLimit(0)` makes `Go` deadlock; do not use.
- `Go` may block; `TryGo` does not.

### Implementation detail

The limit is implemented internally as a `chan token` of capacity `n`. `Go` sends to the channel before spawning; the spawned goroutine receives from it on exit. This is a `chan struct{}` semaphore.

---

## Goroutine Lifetime

A goroutine's lifetime begins when `go f()` executes. It ends when:

- `f` returns normally.
- `f` panics (the goroutine terminates; the panic is not propagated unless recovered).
- `main` returns (the runtime terminates the process, ending all goroutines).
- `runtime.Goexit()` is called (the goroutine terminates after running deferred functions).

### Goroutine reuse

Internally, the runtime reuses `g` structs from `gFree`. But each `g` only runs one goroutine at a time; a "reuse" happens after termination.

### Liveness and GC

A goroutine is *live* (not GC-eligible) if it is in any state other than `_Gdead`. The GC traces from every live goroutine's stack and finds reachable heap objects.

### Implication for the anti-pattern

Leaked goroutines (waiting forever on a channel, for example) are live. They are not GC'd. Their stacks consume memory indefinitely.

---

## Invariants of a Bounded Fan-Out

A correctly bounded fan-out maintains these invariants:

### Invariant 1: At-most-N concurrent

At any instant, at most N goroutines spawned by this fan-out are alive.

Enforcement: semaphore, channel, or `errgroup.SetLimit`.

### Invariant 2: Eventual termination

Every spawned goroutine eventually terminates.

Enforcement: bounded work per goroutine, context cancellation.

### Invariant 3: No-leak

After the fan-out's parent function returns, no spawned goroutine remains alive.

Enforcement: `wg.Wait()`, `g.Wait()`, or equivalent join.

### Invariant 4: Error propagation

If any goroutine errors, the parent observes the error (or at least one error if multiple occur).

Enforcement: errgroup error aggregation, or a custom result channel.

### Invariant 5: Cancellation propagation

If the parent's context is cancelled, all spawned goroutines observe the cancellation.

Enforcement: passing the context to every goroutine, using `errgroup.WithContext`.

### Invariant 6: Resource release

Every resource acquired by a goroutine is released before the goroutine terminates.

Enforcement: `defer` statements for every acquire.

Violating any of these invariants makes the fan-out incorrect or leak-prone.

---

## Failure Modes

Formal failure modes of unbounded fan-out:

### Failure mode 1: Heap exhaustion

- Goroutine count × per-goroutine memory > available heap.
- Symptom: out-of-memory panic, OOMKill, slow GC.
- Detection: heap profile, OOM logs.

### Failure mode 2: Stack memory exhaustion

- Sum of goroutine stack sizes > available memory.
- Special case of heap exhaustion when stacks dominate.
- Detection: pprof goroutine count, per-goroutine stack sizes.

### Failure mode 3: FD exhaustion

- Open connections > ulimit -n.
- Symptom: `EMFILE` errors, `accept: too many open files`.
- Detection: count of open FDs vs ulimit.

### Failure mode 4: Connection pool exhaustion

- Goroutines waiting for connections > pool size.
- Symptom: latency climbs; eventually timeouts.
- Detection: `db.Stats().WaitCount` increasing.

### Failure mode 5: Scheduler thrash

- Runnable count >> GOMAXPROCS.
- Symptom: CPU saturated but throughput low; high `findRunnable` time.
- Detection: `go tool trace` shows long scheduling delays.

### Failure mode 6: GC pause amplification

- Stack scan time × goroutines per GC > acceptable pause.
- Symptom: p99 latency spikes correlate with GC.
- Detection: `GODEBUG=gctrace=1`.

### Failure mode 7: Downstream cascade

- Service A's unbounded fan-out into B causes B to fail; A's retries amplify; recovery is slow.
- Symptom: B unavailable; A's queue grows; A eventually fails too.
- Detection: downstream-side rate limiting metrics.

Each failure mode has a unique detection signal. A complete monitoring setup covers all of them.

---

## Detection Specification

To detect the anti-pattern at runtime or build time:

### Runtime detection

1. **Goroutine count.** `runtime.NumGoroutine()` as a Prometheus metric. Alert on growth or absolute value.

2. **Allocation rate.** `runtime.MemStats.Mallocs` rate. Spikes correlate with fan-out events.

3. **GC pause.** `runtime.MemStats.PauseTotalNs` rate. Growing means GC is busy.

4. **Stack count.** `runtime.MemStats.StackInuse`. Approximates stack memory of all goroutines.

5. **Pprof.** `/debug/pprof/goroutine` shows stacks; high counts on a single stack are the smoking gun.

### Build-time detection

1. **Static analysis.** Custom AST analyser detects `go` statements inside `for range` over slices/channels.

2. **Test harness.** Unit/integration tests that assert `runtime.NumGoroutine()` stays bounded.

3. **Goleak.** `go.uber.org/goleak` fails tests if goroutines remain at suite end.

### Production detection

1. **Continuous profiling.** Pyroscope/Polar Signals capture profiles every 10 seconds; the count of goroutines per stack is queryable.

2. **Alerting.** Prometheus rules: alert on derivative > threshold.

3. **Health endpoint.** A custom `/health` that returns degraded if `NumGoroutine` is excessive.

---

## `GODEBUG` Knobs

Environment variable `GODEBUG` toggles runtime debug behaviour. Relevant for this anti-pattern:

### `GODEBUG=schedtrace=N`

Every N milliseconds, prints scheduler state to stderr. Useful to see run queue lengths.

### `GODEBUG=scheddetail=1`

Combined with `schedtrace`, prints per-P and per-M detail.

### `GODEBUG=gctrace=1`

Prints each GC cycle's stats: phase durations, heap sizes, goal.

### `GODEBUG=allocfreetrace=1`

Logs every allocation and free. Very slow but useful for finding allocation hot spots.

### `GODEBUG=netdns=go`

Forces Go's pure-DNS resolver. Bypasses libc resolver. Relevant when many goroutines do DNS.

### `GODEBUG=asyncpreemptoff=1`

Disables async preemption (Go 1.14+). Useful when debugging preemption-sensitive code.

### `GODEBUG=cgocheck=2`

Stricter cgo pointer checks. Slow; used for diagnostics.

These knobs don't change normal program behaviour; they add diagnostic output or change debug paths.

---

## Links to Go Runtime Source

For the engineer who wants to read the source:

- **`src/runtime/proc.go`**: scheduler core. Functions `newproc`, `findRunnable`, `schedule`, `gopark`, `goready`.
- **`src/runtime/runtime2.go`**: data structures (`g`, `m`, `p`, `sched`, etc.).
- **`src/runtime/chan.go`**: channel implementation. `chansend`, `chanrecv`, `closechan`.
- **`src/runtime/sema.go`**: low-level semaphore (used by `sync.Mutex`).
- **`src/runtime/lock_futex.go`** / **`lock_sema.go`**: low-level mutex.
- **`src/runtime/select.go`**: select implementation.
- **`src/runtime/mgc.go`**: GC.
- **`src/runtime/mheap.go`**, **`mcache.go`**, **`mcentral.go`**: heap allocator.
- **`src/runtime/preempt.go`**: preemption logic.
- **`src/runtime/netpoll.go`**, **`netpoll_*`** : network poller.

These files are written in Go (some assembly stubs for the lowest level). Each is a few hundred to a few thousand lines. They are readable; they include detailed comments.

The full runtime is approximately 30 000 lines of Go and 5 000 lines of assembly. It is approachable for a determined reader.

---

## References

### Normative

- **The Go Programming Language Specification**: https://go.dev/ref/spec
- **The Go Memory Model**: https://go.dev/ref/mem
- **Effective Go**: https://go.dev/doc/effective_go
- **`runtime` package documentation**: https://pkg.go.dev/runtime
- **`sync` package documentation**: https://pkg.go.dev/sync
- **`context` package documentation**: https://pkg.go.dev/context

### Supplementary

- **`golang.org/x/sync` documentation**: https://pkg.go.dev/golang.org/x/sync
- **`golang.org/x/sync/errgroup`**: https://pkg.go.dev/golang.org/x/sync/errgroup
- **`golang.org/x/sync/semaphore`**: https://pkg.go.dev/golang.org/x/sync/semaphore
- **`go.uber.org/goleak`**: https://pkg.go.dev/go.uber.org/goleak
- **`go.uber.org/automaxprocs`**: https://pkg.go.dev/go.uber.org/automaxprocs

### Runtime source

- Go runtime: https://github.com/golang/go/tree/master/src/runtime
- `proc.go`: https://github.com/golang/go/blob/master/src/runtime/proc.go
- `chan.go`: https://github.com/golang/go/blob/master/src/runtime/chan.go
- `runtime2.go`: https://github.com/golang/go/blob/master/src/runtime/runtime2.go

### Blog posts and talks

- Rob Pike, "Concurrency is not Parallelism" (2012)
- Rob Pike, "Go Concurrency Patterns" (2012)
- Sameer Ajmani, "Advanced Go Concurrency Patterns" (2013)
- Dmitry Vyukov, "Go Scheduler: Implementing Language with Lightweight Concurrency" (2014)
- Kavya Joshi, "Understanding Channels" (GopherCon 2017)

### External resources

- Bryan C. Mills, "Rethinking Classical Concurrency Patterns" (GopherCon 2018)
- Mat Ryer's posts on Pace.dev about concurrency patterns
- Dave Cheney's blog: dave.cheney.net (especially the post "Never start a goroutine without knowing how it will stop")

These references constitute the authoritative literature on Go concurrency. Reading them in sequence builds a foundation that this document presupposes.

---

## Conclusion

The unlimited goroutines anti-pattern arises from the Go language's permissive specification: `go` can be invoked anywhere, with any argument count, with no bound. The runtime accepts whatever the program requests, up to physical resource limits.

The cure is to *bound by construction*: every fan-out call site is wrapped in a primitive (semaphore, errgroup, pool) that enforces an upper limit. This is not a language feature; it is a discipline.

This specification has defined the anti-pattern formally, enumerated runtime behaviours that matter, listed guarantees and non-guarantees, and pointed to the source. Future engineers reading this file should be able to look up any specific behaviour, find an authoritative answer, and act on it.

End of Specification file.
