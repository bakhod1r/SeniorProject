# Worker Pools — Specification

## Table of Contents
1. [Scope](#scope)
2. [Notation](#notation)
3. [Channels: State Model](#channels-state-model)
4. [`sync.WaitGroup` Semantics](#syncwaitgroup-semantics)
5. [`errgroup.Group` Contract](#errgroupgroup-contract)
6. [Memory Model Implications](#memory-model-implications)
7. [Pool Invariants](#pool-invariants)
8. [Closure Discipline](#closure-discipline)
9. [Panic Semantics](#panic-semantics)
10. [Shutdown Protocol](#shutdown-protocol)
11. [Context Propagation Rules](#context-propagation-rules)
12. [Conformance Tests](#conformance-tests)

---

## Scope

This document specifies the formal behaviour of the worker pool pattern in Go: what guarantees the language and standard library make, what programs must do to remain well-defined, and what the boundary is between guaranteed behaviour and implementation detail.

Sources:
- The Go Programming Language Specification ("language spec").
- The Go memory model (<https://go.dev/ref/mem>).
- `sync` package documentation (<https://pkg.go.dev/sync>).
- `golang.org/x/sync/errgroup` documentation.
- `context` package documentation.

---

## Notation

- `chan T` — bidirectional channel.
- `<-chan T` — receive-only channel.
- `chan<- T` — send-only channel.
- `CloseChan(c)` — calling `close(c)`.
- `WG` — a `sync.WaitGroup`.
- `WG.add(n)`, `WG.done()`, `WG.wait()` — its three operations.
- `n` — the number of workers (pool size). `n ≥ 1`.

---

## Channels: State Model

A channel is in exactly one of three states:

1. **Open, empty.** Receivers block (or `select` falls through). Senders proceed if buffered with capacity left, else block.
2. **Open, has value.** Receivers proceed. Senders proceed if buffered with capacity left, else block.
3. **Closed.** Receivers proceed. They observe `(zero, false)` for the comma-ok form once drained. Senders panic.

State transitions:

```text
       Open ──── close(c) ────▶ Closed
        ▲                          
        │                          
  (constructor make)               
```

A closed channel cannot transition back to open. `close` of a `nil` channel panics. `close` of an already-closed channel panics. Sends on a closed channel panic.

### Receive on closed

The Go spec guarantees:
- Receive on a closed channel returns the zero value of T immediately.
- Comma-ok receive returns `(zero, false)`.
- `for v := range c` exits when c is closed *and* drained.

### Send on closed

```go
defer func() {
    if r := recover(); r != nil { /* "send on closed channel" */ }
}()
c <- v
```

The panic is the language's only signal — there is no precondition check available before send.

---

## `sync.WaitGroup` Semantics

A `sync.WaitGroup` exposes three operations: `Add(int)`, `Done()`, `Wait()`. `Done()` is shorthand for `Add(-1)`.

### Counter rules

- The internal counter starts at 0.
- `Add(n)` adds `n` to the counter (n may be negative).
- The counter must never be negative; doing so panics.
- `Wait()` returns when the counter reaches zero.

### Synchronisation guarantees

The `sync` package documentation specifies:

> Note that calls with a positive delta that occur when the counter is zero must happen before a Wait. Calls with a positive delta, or calls with a negative delta that start when the counter is greater than zero, may happen at any time.

In plain language: **`Add(n>0)` must happen before any concurrent `Wait()` if the counter could be zero at that point.** This is why we put `Add` *before* `go func()`.

### Memory model

A successful `Done()` synchronizes-with the return of `Wait()`. Effects (writes) that happen-before `Done()` are visible to code after `Wait()` returns. This is what makes "spawn → work → Done; Wait → read results" correct.

### Reuse

A WaitGroup may be reused after `Wait()` returns *and* the counter is zero. Adding to a WaitGroup while another Wait is outstanding is undefined.

---

## `errgroup.Group` Contract

`golang.org/x/sync/errgroup` provides:

```go
type Group struct{ /* ... */ }
func WithContext(ctx) (*Group, ctx)
func (g *Group) Go(f func() error)
func (g *Group) Wait() error
func (g *Group) SetLimit(n int)
func (g *Group) TryGo(f func() error) bool
```

### Behaviour

1. `Go(f)` runs `f` in a new goroutine.
2. The first non-nil error returned by any `f` is captured.
3. If created with `WithContext`, the context is cancelled the moment any `f` returns non-nil error or panics.
4. `Wait()` blocks until all goroutines return, then returns the first error captured.
5. `SetLimit(n)` (n > 0) bounds concurrent goroutines to n. `Go` blocks if the limit is reached. `SetLimit(-1)` removes the limit. Calling `SetLimit` after `Go` is a panic.
6. `TryGo` returns false instead of blocking when the limit is reached.

### Panic propagation

A panic in a goroutine spawned via `Go` propagates after `Wait` returns. The panic is re-raised by `Wait`. (Earlier versions of errgroup did not have this behaviour; modern versions do.)

### Cancellation

The context returned by `WithContext` is cancelled exactly when:
- The first error occurs, or
- `Wait` returns, whichever comes first.

`Wait` does not cancel the parent context.

---

## Memory Model Implications

The Go memory model defines happens-before relationships that pool code must respect.

### Channel send/receive

- A send on a channel happens-before the corresponding receive from that channel.
- The closing of a channel happens-before a receive that returns because the channel is closed.

This is what makes `for j := range jobs { ... }` safe with `close(jobs)`: every prior send happens-before the receive.

### WaitGroup

- A call to `Done()` happens-before the return of any `Wait()` call that observes the counter dropping to zero.

So writes a worker performs before `Done()` are visible to the closer goroutine after `Wait()`.

### Mutexes vs channels for shared state

Channels enforce happens-before by themselves. Shared variables outside channel synchronisation need a `sync.Mutex` or atomic. A common pool bug: a worker writes to a shared map and the consumer reads it without any synchronisation other than receiving on the results channel. That *is* sufficient if and only if the write happens before the send. Practical rule: write-then-send, receive-then-read.

```go
// Correct
m[k] = v        // write
results <- r    // send: happens-before receive
// in consumer:
r := <-results
useMap()        // sees m[k] = v
```

---

## Pool Invariants

A canonical worker pool has the following invariants, which programs must preserve:

### I1 — Single closer of `jobs`

Exactly one goroutine calls `close(jobs)`, and it does so exactly once. Multiple closers panic. Zero closers leak.

### I2 — Single closer of `results`

Exactly one goroutine calls `close(results)`, after all senders have terminated. Standard idiom: `go func(){ wg.Wait(); close(results) }()`.

### I3 — Add before spawn

`wg.Add(1)` is called before `go workerFunc()`. Equivalently, `wg.Add(n)` once before launching `n` workers.

### I4 — Done on every exit

Every worker calls `wg.Done()` exactly once on every code path. Achieved by `defer wg.Done()` at the top.

### I5 — No send on closed

After `close(jobs)`, no goroutine sends on `jobs`. After `close(results)`, no goroutine sends on `results`.

### I6 — Workers receive only

Workers do not close `jobs` or `results`. They are receivers (of `jobs`) and senders (of `results`).

### I7 — Result handling completeness

For every job sent into `jobs`, exactly one of:
- A result is sent into `results`.
- An error is recorded.
- The pool is cancelled (and the job is dropped).

### I8 — Bounded concurrency

At any moment, the number of goroutines actively executing `process(j)` is ≤ `n`.

---

## Closure Discipline

The "who closes which channel" question has a deterministic answer:

| Channel | Closer | When |
|---------|--------|------|
| `jobs` | Producer | After all sends complete |
| `results` | Closer goroutine | After `wg.Wait()` returns |
| Per-worker stop chan (if used) | Supervisor | On shutdown |
| `ctx.Done` (cancellation chan inside context) | Cancel function | Implicit; never close manually |

Violations:

- **Closing `jobs` from a worker.** Workers receive; closing on the receive side leads to send-side panics if the producer is still running. Even if the producer has finished, this conflates ownership.
- **Closing `results` from a worker.** Same channel may have other senders still active. Other workers will panic.
- **Closing the same channel from multiple producers.** Use a sync.Once or a channel-based barrier.

---

## Panic Semantics

A goroutine that panics without recovering crashes the program. In a worker pool:

- Worker panic → program crash unless `recover` is in scope.
- Producer panic → program crash unless `recover` is in scope. `defer close(jobs)` still runs (deferred functions run during unwinding).
- Closer goroutine panic → program crash. The closer is small and rarely panics in practice.

### Recover in workers

```go
go func() {
    defer wg.Done()
    defer func() {
        if r := recover(); r != nil {
            // log; optionally re-panic to crash the program
        }
    }()
    for j := range jobs {
        // process — may panic
    }
}()
```

After recovery, the worker exits naturally (deferred Done runs). The pool effectively shrinks by 1. If you want the pool to keep its size, the worker must restart itself on panic.

### errgroup panic behaviour

Modern errgroup (Go 1.20+) propagates panics: `g.Wait()` re-raises the panic. Older versions silently absorbed it.

---

## Shutdown Protocol

The canonical shutdown sequence:

```text
1. Producer stops accepting new submissions.
2. Producer signals "no more jobs": close(jobs).
3. Workers complete in-flight job, observe range exit, run defer Done.
4. wg.Wait() returns in the closer goroutine.
5. Closer calls close(results).
6. Consumer's range exits.
7. Caller of the pool returns / cleans up.
```

This is *drain* shutdown. Every job submitted before step 1 completes (modulo errors).

### Cancel shutdown

```text
1. Cancel context.
2. Producer's select on ctx.Done returns; producer stops sending.
   (Producer may still close(jobs) on its way out.)
3. Workers' select on ctx.Done returns. Workers exit immediately
   without finishing the current job — unless the worker honors the
   ctx mid-process, the in-flight job will still complete.
4. wg.Wait() returns.
5. Closer closes results.
```

Important: cancellation does not interrupt arbitrary code. A worker in the middle of a CPU loop ignoring `ctx.Done()` will finish its iteration. Only ctx-aware code (HTTP, DB, channel ops in a select) responds promptly.

### Hybrid

Try to drain. If drain exceeds a deadline, cancel.

```go
close(jobs)
select {
case <-done:
case <-time.After(timeout):
    cancel()
    <-done
}
```

---

## Context Propagation Rules

### Deriving

- `context.WithCancel(parent)` → child cancelled when parent is cancelled or `cancel()` is called.
- `context.WithTimeout(parent, d)` → child cancelled at `time.Now()+d` or parent cancellation.
- `context.WithDeadline(parent, t)` → child cancelled at `t` or parent cancellation.

A pool typically uses `WithCancel` so external code can call `cancel()` to stop everything.

### `errgroup.WithContext`

```go
g, ctx := errgroup.WithContext(parent)
```

`ctx` is cancelled at:
- `cancel()` on the parent's chain.
- The first non-nil error returned by any `g.Go`.
- `g.Wait()` returning (whichever first).

Using `ctx` inside spawned goroutines is the standard way to propagate "fail fast" cancellation.

### Always `defer cancel()`

Every `WithCancel`/`WithTimeout`/`WithDeadline` must be paired with `defer cancel()` to release the timer goroutine and resources, even if the context completed naturally.

---

## Conformance Tests

The following tests verify a worker-pool implementation conforms to the spec:

### T1 — Drain ordering

Submit N jobs, close, Wait. Every job's result is observed exactly once.

### T2 — Cancellation respects ctx

Submit M >> N jobs, cancel after K < M. Worker count returns to baseline within timeout. No goroutine leaks.

### T3 — No panic on double close

A pool that calls `close(jobs)` once is safe. A pool with multiple closers must guard with `sync.Once`.

### T4 — Bounded concurrency

Instrument `process` with an atomic counter. Maximum observed concurrent calls ≤ N at any time.

### T5 — Panic safety

A worker that panics on one job does not crash the program if `recover` is in scope. Pool reports an error and continues with N-1 (or restarts).

### T6 — Producer error path

Producer that returns early with `defer close(jobs)` causes graceful pool shutdown. No leaks.

### T7 — Context inside process

`process(ctx, j)` that respects ctx returns early on cancellation. Verified by injecting a cancellable HTTP call.

### T8 — Result for every job (non-cancelled)

In a non-cancelled run, the count of jobs in equals the count of results out, regardless of order.

### T9 — errgroup conformance

Errgroup-based pool: first error cancels ctx; Wait returns that error; all other goroutines exit.

### T10 — Memory stability

Run pool for 1M jobs. Heap stable; goroutine count stable; no growth.

A reference implementation passing T1–T10 is a conformant pool.

---

This specification is descriptive of the conventional Go pool pattern, not a language-level requirement. The language guarantees the channel and WaitGroup semantics; the pool pattern is an idiom that builds on them.
