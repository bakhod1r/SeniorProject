---
layout: default
title: Specification
parent: tunny
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/02-tunny/specification/
---

# tunny — Specification

## Overview

`github.com/Jeffail/tunny` is a Go package providing a synchronous, fixed-size goroutine pool with first-class support for stateful workers and per-call cancellation.

The public API surface is small. This file is the precise reference. All other files in this series build on the semantics defined here.

Import path: `github.com/Jeffail/tunny`
Package name: `tunny`

---

## Types

### Pool

```go
type Pool struct {
    // unexported fields
}
```

A `Pool` is the central type. It holds a fixed number of long-lived worker goroutines, dispatches payloads to them, and returns results.

A `Pool` value is safe for concurrent use by multiple goroutines.

Created via `New`, `NewFunc`, or `NewCallback`. Released via `Close`.

The zero value of `Pool` is invalid. Always use a constructor.

### Worker

```go
type Worker interface {
    Process(payload interface{}) interface{}
    BlockUntilReady()
    Interrupt()
    Terminate()
}
```

Implemented by user types. Defines what a single worker does. See "Worker contract" below for full method semantics.

The pool holds a fixed number of `Worker` instances (one per slot), created by the factory passed to `New`.

---

## Constructors

### New

```go
func New(n int, ctor func() Worker) *Pool
```

Creates a pool of `n` workers. The factory `ctor` is called `n` times; each call must return a fresh `Worker` instance.

Preconditions:
- `n >= 1`. Passing `n < 1` panics.
- `ctor` must not be nil. Passing nil panics.

Postconditions:
- Returns a pointer to a fully-constructed `Pool`.
- All `n` worker goroutines are spawned and ready to receive payloads.

Notes:
- `ctor` is called sequentially. If construction is slow, the constructor itself blocks for that time.
- A panic inside `ctor` propagates out of `New`.

### NewFunc

```go
func NewFunc(n int, f func(interface{}) interface{}) *Pool
```

Convenience wrapper around `New`. Creates a pool of stateless workers, each wrapping `f`.

Equivalent to:

```go
New(n, func() Worker {
    return &funcWorker{f: f}
})
```

…where `funcWorker.Process` invokes `f` and the other methods are no-ops.

Preconditions:
- `n >= 1`.
- `f` must not be nil.

Postconditions:
- Same as `New`.

### NewCallback

```go
func NewCallback(n int) *Pool
```

Creates a pool whose payloads are themselves `func()` values. Workers invoke the function and discard its return value.

Equivalent to:

```go
New(n, func() Worker {
    return &callbackWorker{}
})
```

…where `callbackWorker.Process(p)` casts `p` to `func()` and invokes it.

Preconditions:
- `n >= 1`.

Postconditions:
- Same as `New`.

Notes:
- If the payload is not a `func()`, the worker returns `nil` (current implementation; future implementations may panic).

---

## Methods on `*Pool`

### Process

```go
func (p *Pool) Process(payload interface{}) interface{}
```

Submits `payload` for processing and returns the worker's result.

Semantics:
- Blocks until a worker is available and has finished processing.
- Goroutine-safe.
- No cancellation support — caller cannot give up before the worker returns.
- Returns whatever `Worker.Process` returned.

Preconditions:
- The pool must not be closed. Calling `Process` on a closed pool panics with `ErrPoolNotRunning`.

### ProcessTimed

```go
func (p *Pool) ProcessTimed(payload interface{}, timeout time.Duration) (interface{}, error)
```

Submits `payload` with a per-call deadline.

Semantics:
- Blocks until a worker has finished, OR the total elapsed time exceeds `timeout`.
- If the deadline elapses, returns `(nil, ErrJobTimedOut)`.
- If the pool is closed during the call, returns `(nil, ErrPoolNotRunning)`.
- If a deadline fires while a worker is mid-`Process`, the pool invokes `Worker.Interrupt` on that worker.

Returns:
- `(result, nil)` on success.
- `(nil, ErrJobTimedOut)` on timeout.
- `(nil, ErrPoolNotRunning)` if the pool was closed.

Notes:
- The timeout covers all phases: waiting for a worker, sending the payload, and receiving the result.
- The worker may not honour `Interrupt`; in that case the worker keeps running after the caller has timed out.

### ProcessCtx

```go
func (p *Pool) ProcessCtx(ctx context.Context, payload interface{}) (interface{}, error)
```

Submits `payload` bound to a `context.Context`.

Semantics:
- Like `ProcessTimed` but using `ctx.Done()` as the cancellation signal.
- If `ctx.Done()` fires, returns `(nil, ctx.Err())`.
- If the pool is closed, returns `(nil, ErrPoolNotRunning)`.
- On cancellation mid-`Process`, the pool invokes `Worker.Interrupt`.

Returns:
- `(result, nil)` on success.
- `(nil, ctx.Err())` on cancellation. `ctx.Err()` is one of `context.DeadlineExceeded` or `context.Canceled`.
- `(nil, ErrPoolNotRunning)` if pool was closed.

Notes:
- Preferred over `ProcessTimed` in modern Go code.

### Close

```go
func (p *Pool) Close()
```

Closes the pool. After `Close` returns:
- All worker goroutines have exited.
- `Worker.Terminate` has been invoked on each worker.
- The pool's internal channels are closed.

Semantics:
- Blocks until all in-flight `Process` calls have completed.
- Calling `Process`, `ProcessTimed`, or `ProcessCtx` after `Close` is undefined (typically panics or returns `ErrPoolNotRunning`).
- Calling `Close` more than once panics with "close of closed channel".

Notes:
- Use `defer pool.Close()` in normal code.
- If you may call `Close` multiple times, wrap with `sync.Once`.
- `Close` does NOT interrupt in-flight `Process` calls. They finish naturally before workers terminate.

### GetSize

```go
func (p *Pool) GetSize() int
```

Returns the current number of workers in the pool.

Semantics:
- Reflects the most recent `SetSize` call (or the initial `n`).
- Returns 0 after `Close`.

### SetSize

```go
func (p *Pool) SetSize(n int)
```

Changes the number of workers.

Semantics:
- Growing: spawns new workers using the factory. They are immediately available.
- Shrinking: stops the excess workers. Each is allowed to finish its current `Process` before terminating.
- Blocks until all excess workers (when shrinking) have terminated.
- Goroutine-safe.

Preconditions:
- `n >= 1` is recommended. `n == 0` halts the pool (no workers but still open).

Notes:
- `SetSize` cannot resurrect workers that have been terminated. Each `SetSize` increase spawns fresh workers via the factory.
- If shrinking workers are slow to finish their current `Process`, `SetSize` blocks accordingly.

### QueueLength

```go
func (p *Pool) QueueLength() int64
```

Returns the current count of callers in `Process`, `ProcessTimed`, or `ProcessCtx` — including both those waiting for a worker and those currently being processed.

Semantics:
- Atomic read of an internal counter.
- Roughly equal to "number of goroutines currently using the pool".

Notes:
- `QueueLength - GetSize()` is the approximate queue depth (when positive). When negative, the pool has slack.
- For monitoring, sample on a timer.

---

## Worker Contract

### Process

```go
Process(payload interface{}) interface{}
```

Invoked by the pool when a payload has been assigned to this worker.

Requirements:
- May read and modify worker-local state (struct fields).
- Must not access state shared with other workers without synchronisation.
- May be called many times over the worker's lifetime.
- Must not block forever. Should respect cancellation via cooperation with `Interrupt`.
- Must not call `pool.Process` recursively on the same pool unless deadlock is impossible.

Return value:
- Whatever the user code returns. Becomes the result of the originating `Process`/`ProcessTimed`/`ProcessCtx` call.

Panics:
- A panic in `Process` is NOT recovered by tunny. The panic propagates up the worker goroutine, fires deferreds (`Terminate`), then terminates the process. Always recover yourself if you cannot trust the work.

### BlockUntilReady

```go
BlockUntilReady()
```

Invoked by the pool before each `Process`. The worker may block to apply backpressure (e.g. wait for a rate-limit token).

Requirements:
- Empty implementation is allowed and common.
- Should return promptly when ready.
- Should not block forever — that traps the worker.
- Called from the worker's goroutine.

Notes:
- Called every iteration, including iterations that consume an `interruptChan` event with no work.
- A long `BlockUntilReady` reduces effective pool size dynamically.

### Interrupt

```go
Interrupt()
```

Invoked by tunny when a `ProcessTimed`/`ProcessCtx` deadline fires while the worker is mid-`Process`.

Requirements:
- Must be idempotent. May be called when `Process` is not actually running.
- Must be safe to call concurrently with `Process` (different goroutines).
- Should signal `Process` to stop cooperatively (e.g. cancel a context, set a flag).

Notes:
- Tunny does NOT verify that `Process` honours `Interrupt`. If you implement an empty `Interrupt`, deadlines still fire from the caller's perspective but workers waste cycles.
- Called from the goroutine that invoked `ProcessTimed`/`ProcessCtx`, not the worker's goroutine.

### Terminate

```go
Terminate()
```

Invoked exactly once when the worker's goroutine is about to exit.

Requirements:
- Release any owned resources (connections, files, buffers).
- Must be safe to call once; idempotency not strictly required but recommended.
- Called after the last `Process` invocation finishes.

Notes:
- Called only via `Close` or `SetSize` (shrinking). Not called if the process exits abnormally.
- Always runs in the worker's goroutine.

---

## Sentinel Errors

### ErrPoolNotRunning

```go
var ErrPoolNotRunning = errors.New("the pool is not running")
```

Returned by `ProcessTimed` and `ProcessCtx` when the pool has been closed.

### ErrJobTimedOut

```go
var ErrJobTimedOut = errors.New("job request timed out")
```

Returned by `ProcessTimed` when the deadline elapses before the worker finishes.

---

## Concurrency Semantics

- Multiple goroutines may call `Process`, `ProcessTimed`, `ProcessCtx`, `QueueLength`, `GetSize` concurrently. All are safe.
- `Close` and `SetSize` are serialised internally via a mutex; multiple concurrent calls do not corrupt state but may interleave in non-deterministic ways.
- `Process` of one caller is not guaranteed to dispatch to a specific worker; the choice is pseudo-random among ready workers.
- Channel send-receive provides happens-before semantics: the caller's writes to the payload happen-before the worker's reads; the worker's writes to the result happen-before the caller's reads.

---

## Dispatch Algorithm

The dispatcher is implicit, not a separate goroutine. It works as follows:

1. Each `Worker` runs in its own goroutine driven by `workerWrapper.run`.
2. Each worker calls `BlockUntilReady` and then offers itself by sending a `workRequest` on the pool's shared `reqChan`.
3. A caller in `Process` reads from `reqChan` — the runtime matches it with a pending worker send.
4. The caller writes the payload on the worker's per-call `jobChan`; the worker reads it.
5. The worker invokes `Process` and writes the result on the per-call `retChan`.
6. The caller reads the result.
7. The worker loops back to step 2.

The shared `reqChan` is unbuffered. The per-worker `jobChan` and `retChan` are typically buffered with capacity 1.

---

## Failure Modes Beyond the Returned Errors

The API returns only `ErrPoolNotRunning`, `ErrJobTimedOut`, and `ctx.Err()`. The following failure modes are not represented in the return values:

- **Worker panic.** Crashes the process. Recover yourself.
- **`Close` called twice.** Panics. Use `sync.Once` if needed.
- **`Process` after `Close`.** Panics with `ErrPoolNotRunning` (or send-on-closed-channel).
- **Worker blocked in `BlockUntilReady` forever.** Worker is unavailable indefinitely.
- **Worker ignores `Interrupt`.** Caller times out cleanly; worker keeps running.

---

## Version Compatibility

Tunny's API has been stable for years. The types and method signatures described here apply to all recent versions (v0.1.x). Future major versions may change `interface{}` to `any`, but the semantics are expected to remain.

---

## Notes on Implementation

- The library is ~400 lines of Go.
- It depends only on the Go standard library.
- It does not use cgo.
- It does not call `runtime.LockOSThread`.
- It does not perform reflection.
- It does not use `unsafe`.

---

## Permissions and Threading

- All operations are goroutine-safe unless noted.
- Workers run as ordinary goroutines, scheduled by the Go runtime.
- Workers are not pinned to OS threads.

---

## Memory Footprint

- A `Pool` itself is ~100 bytes.
- Each `workerWrapper` is ~100 bytes plus the `Worker`'s memory.
- Worker goroutines start at ~2 KB stack each.
- Per-call: payload and result are boxed into `interface{}` (heap allocation for non-trivial values).

---

## Lifetime Diagram

```
ctor() -> Worker instance
                 │
                 ▼
            for ever (until Close or SetSize-shrink):
                BlockUntilReady()
                Process(payload)
                 │
                 ▼
            (loop)
                 │
                 ▼
            Terminate()
                 │
                 ▼
            goroutine exit
```

---

## Quick Reference

```go
import "github.com/Jeffail/tunny"

// Constructors
pool := tunny.NewFunc(n, func(p any) any { ... })
pool := tunny.New(n, func() tunny.Worker { return &myWorker{} })
pool := tunny.NewCallback(n)

// Submission
result := pool.Process(payload)                              // sync, no cancellation
result, err := pool.ProcessTimed(payload, 100*time.Millisecond) // with timeout
result, err := pool.ProcessCtx(ctx, payload)                  // with context

// Management
n := pool.GetSize()
pool.SetSize(newN)
queue := pool.QueueLength()

// Shutdown
pool.Close()
```

---

## Errors Returned

```go
var (
    ErrPoolNotRunning = errors.New("the pool is not running")
    ErrJobTimedOut    = errors.New("job request timed out")
)
```

---

## Worker Interface Summary

```go
type Worker interface {
    Process(payload interface{}) interface{}  // do work
    BlockUntilReady()                          // wait until ready
    Interrupt()                                // stop current work
    Terminate()                                // release resources
}
```

---

## Method Summary (Pool)

| Method          | Signature                                                    | Blocking? | Errors                            |
|-----------------|--------------------------------------------------------------|-----------|-----------------------------------|
| `Process`       | `(payload any) any`                                          | Yes       | Panics on closed pool             |
| `ProcessTimed`  | `(payload any, t time.Duration) (any, error)`                 | Yes       | ErrJobTimedOut, ErrPoolNotRunning |
| `ProcessCtx`    | `(ctx context.Context, payload any) (any, error)`             | Yes       | ctx.Err(), ErrPoolNotRunning      |
| `Close`         | `()`                                                          | Yes       | Panics on double-close            |
| `GetSize`       | `() int`                                                      | No        | -                                 |
| `SetSize`       | `(n int)`                                                     | Yes       | -                                 |
| `QueueLength`   | `() int64`                                                    | No        | -                                 |

---

## End of Specification

For deep-dive context, see:

- [junior.md](junior.md) — Process/NewFunc tutorial.
- [middle.md](middle.md) — Worker interface, ProcessTimed, ProcessCtx.
- [senior.md](senior.md) — Internals.
- [professional.md](professional.md) — Production deployment.

The specification is intentionally short. Read alongside the source for full clarity.

---

## Appendix — Compile-Time Interface Assertion

To verify your type satisfies `Worker`:

```go
var _ tunny.Worker = (*MyWorker)(nil)
```

This line compiles to nothing at runtime but fails the build if `*MyWorker` does not satisfy the interface.

---

## Appendix — Error Wrapping

Tunny's sentinel errors are returned directly. To check:

```go
if errors.Is(err, tunny.ErrJobTimedOut) {
    // ...
}
```

`errors.Is` works because the errors are package-level sentinels.

You can wrap them when returning from your own functions:

```go
return fmt.Errorf("processing failed: %w", err)
```

Callers can still match with `errors.Is`.

---

## Appendix — Sample Worker Skeleton

For copy-paste:

```go
type myWorker struct {
    // fields
    mu     sync.Mutex
    cancel context.CancelFunc
}

func (w *myWorker) Process(p any) (out any) {
    defer func() {
        if r := recover(); r != nil {
            out = fmt.Errorf("panic: %v", r)
        }
    }()

    ctx, cancel := context.WithCancel(context.Background())
    w.mu.Lock()
    w.cancel = cancel
    w.mu.Unlock()
    defer func() {
        w.mu.Lock()
        w.cancel = nil
        w.mu.Unlock()
        cancel()
    }()

    return doWork(ctx, p)
}

func (w *myWorker) BlockUntilReady() {}

func (w *myWorker) Interrupt() {
    w.mu.Lock()
    if w.cancel != nil {
        w.cancel()
    }
    w.mu.Unlock()
}

func (w *myWorker) Terminate() {
    // release resources
}

var _ tunny.Worker = (*myWorker)(nil)
```

This is the canonical shape.

---

## Appendix — Typed Generic Wrapper

For Go 1.18+:

```go
type Pool[In, Out any] struct {
    inner *tunny.Pool
}

func NewPool[In, Out any](n int, fn func(context.Context, In) (Out, error)) *Pool[In, Out] {
    return &Pool[In, Out]{
        inner: tunny.New(n, func() tunny.Worker {
            return &worker[In, Out]{fn: fn}
        }),
    }
}

func (p *Pool[In, Out]) Run(ctx context.Context, in In) (Out, error) {
    r, err := p.inner.ProcessCtx(ctx, in)
    if err != nil {
        var z Out
        return z, err
    }
    res := r.(Result[Out])
    return res.Value, res.Err
}

func (p *Pool[In, Out]) Close() { p.inner.Close() }

// helper types
type Result[T any] struct { Value T; Err error }
type worker[In, Out any] struct { fn func(context.Context, In) (Out, error) /* ... */ }
```

Hides `interface{}` from callers. Recommended.

---

End of specification. Refer to other files for context.
