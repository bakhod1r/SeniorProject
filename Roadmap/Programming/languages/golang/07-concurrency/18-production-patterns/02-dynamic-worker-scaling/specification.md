---
layout: default
title: Specification
parent: Dynamic Worker Scaling
grand_parent: Production Patterns
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/02-dynamic-worker-scaling/specification/
---

# Dynamic Worker Scaling — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Worker Pool Semantics](#worker-pool-semantics)
3. [Resize Operation Contract](#resize-operation-contract)
4. [ants v2 Public API](#ants-v2-public-api)
5. [tunny Public API](#tunny-public-api)
6. [pond Public API](#pond-public-api)
7. [Channel Operations](#channel-operations)
8. [Atomic Operation Guarantees](#atomic-operation-guarantees)
9. [GOMAXPROCS Interaction](#gomaxprocs-interaction)
10. [Runtime Knobs](#runtime-knobs)
11. [Memory Model Implications](#memory-model-implications)
12. [References](#references)

---

## Introduction

This specification defines the formal contracts of dynamic worker pool operations: what Resize/Tune guarantees, what they do not guarantee, how external coordination interacts with Go's runtime, and the public APIs of major pool libraries.

Where applicable, this references the Go language specification, the Go memory model, and the documentation of `panjf2000/ants`, `Jeffail/tunny`, and `alitto/pond`.

---

## Worker Pool Semantics

### Definition

A **worker pool** is a set of goroutines that consume tasks from a shared queue or per-worker mailbox. The number of workers is bounded.

A **dynamic worker pool** is a worker pool whose worker count (capacity) can change at runtime.

### Invariants

For a correctly-implemented dynamic worker pool:

1. The number of in-flight workers at any time is at most the configured capacity.
2. A task submitted via `Submit` either runs to completion exactly once, or fails immediately with an error/panic. It is never partially run.
3. `Resize(n)` is idempotent within the same value: two `Resize(5)` calls have the same effect as one.
4. `Resize` operations are linearizable: there is a global order across all resize and worker operations.
5. After `Close` returns, no new tasks will run.

### Non-invariants

The following are *not* guaranteed:

1. Resize takes effect immediately. Shrink in particular is often opportunistic.
2. Two tasks submitted in order will execute in order.
3. A task submitted before Resize(smaller) will run before the resize takes effect.
4. The pool's live worker count equals its capacity at every instant.

---

## Resize Operation Contract

### Grow

When called with `target > current`:

- New workers MAY be spawned synchronously (before Resize returns) or asynchronously.
- New workers are functionally identical to existing workers.
- The pool's capacity is updated atomically before Resize returns.

### Shrink

When called with `target < current`:

- The pool's capacity is updated atomically before Resize returns.
- Existing workers SHOULD exit when they next become idle. They MUST NOT abandon in-flight tasks.
- The shrink is bounded by current task durations; it may take any amount of time.

### Bounds

A pool MAY enforce internal bounds (floor, ceiling). If `Resize(target)` exceeds bounds, the pool MAY clamp silently or return an error.

### Concurrency

Multiple concurrent `Resize` calls SHOULD be serialized (mutex or atomic). The final state should reflect the order of calls.

### Atomicity

The pool's `Size()` method returns the current live worker count, which may not match the most recent `Resize` target due to opportunistic shrink.

---

## ants v2 Public API

From `panjf2000/ants` v2 (the most widely-used Go pool library):

### Pool

```go
type Pool struct { ... }

func NewPool(size int, options ...Option) (*Pool, error)
```

Constructs a pool with initial capacity `size`. Returns a pool ready to accept submissions.

#### Methods

```go
func (p *Pool) Submit(task func()) error
```

Submits a task. Returns:
- `nil` on success
- `ErrPoolClosed` if pool is closed
- `ErrPoolOverload` if at capacity and non-blocking

```go
func (p *Pool) Tune(size int)
```

Atomically updates the pool's capacity to `size`. Lazy shrink: workers exit opportunistically. Lazy grow: new workers spawn on demand. `Tune(-1)` enables unlimited capacity.

```go
func (p *Pool) Running() int
```

Returns the number of workers currently executing tasks.

```go
func (p *Pool) Cap() int
```

Returns the current capacity (as set by NewPool or Tune).

```go
func (p *Pool) Free() int
```

Returns `Cap() - Running()`. May be negative briefly during transitions.

```go
func (p *Pool) Release()
```

Closes the pool. Existing tasks finish; no new tasks accepted.

```go
func (p *Pool) ReleaseTimeout(timeout time.Duration) error
```

Like `Release()` but with a timeout. Returns error if not drained in time.

```go
func (p *Pool) IsClosed() bool
```

Returns true after `Release` was called.

### Options

```go
type Option func(*Options)

func WithPreAlloc(preAlloc bool) Option
func WithExpiryDuration(expiryDuration time.Duration) Option
func WithNonblocking(nonblocking bool) Option
func WithMaxBlockingTasks(maxBlockingTasks int) Option
func WithPanicHandler(panicHandler func(interface{})) Option
func WithLogger(logger Logger) Option
func WithDisablePurge(disable bool) Option
```

| Option | Default | Effect |
|--------|---------|--------|
| PreAlloc | false | Allocate workers upfront vs on demand |
| ExpiryDuration | 1s | Idle worker exit timer |
| Nonblocking | false | Submit returns error vs blocks when at cap |
| MaxBlockingTasks | 0 (unlimited) | Limit on Submit-blocking goroutines |
| PanicHandler | nil | Function called when worker panics |
| Logger | nil | Custom logger |
| DisablePurge | false | Disable idle worker purging |

### PoolWithFunc

```go
type PoolWithFunc struct { ... }

func NewPoolWithFunc(size int, pf func(interface{}), options ...Option) (*PoolWithFunc, error)
```

Pool where every task is the same function. Faster (no closure allocation per task).

```go
func (p *PoolWithFunc) Invoke(arg interface{}) error
```

Submits an invocation. Returns ErrPoolOverload, ErrPoolClosed, etc.

### MultiPool

```go
type MultiPool struct { ... }

func NewMultiPool(size, sizePerPool int, ls LoadBalancingStrategy, options ...Option) (*MultiPool, error)
```

Sharded pool: N internal pools, work distributed by load-balancing strategy.

```go
type LoadBalancingStrategy int
const (
    RoundRobin LoadBalancingStrategy = iota
    LeastTasks
)
```

### Default pool

```go
func Submit(task func()) error
func Cap() int
func Running() int
func Tune(size int)
func Release()
```

ants exposes a package-level default pool for convenience.

---

## tunny Public API

From `Jeffail/tunny`:

### Pool

```go
type Pool struct { ... }

func New(n int, ctor func() Worker) *Pool
func NewFunc(n int, f func(interface{}) interface{}) *Pool
func NewCallback(n int) *Pool
```

`New` takes a Worker factory. `NewFunc` wraps a function. `NewCallback` for goroutines with callback dispatch.

#### Methods

```go
func (p *Pool) Process(payload interface{}) interface{}
```

Synchronously submits and waits for result. Blocks if pool is busy.

```go
func (p *Pool) ProcessTimed(payload interface{}, timeout time.Duration) (interface{}, error)
```

Like Process but with timeout. Returns `ErrJobTimedOut` if not started in time.

```go
func (p *Pool) ProcessCtx(ctx context.Context, payload interface{}) (interface{}, error)
```

Process with context. Returns `ctx.Err()` if cancelled.

```go
func (p *Pool) SetSize(n int)
```

Changes the worker count. Eager: shrinking blocks until excess workers terminate.

```go
func (p *Pool) GetSize() int
```

Returns the current number of workers.

```go
func (p *Pool) QueueLength() int64
```

Returns the number of tasks queued (waiting for an idle worker).

```go
func (p *Pool) Close()
```

Closes the pool. All workers terminated.

### Worker

```go
type Worker interface {
    Process(payload interface{}) interface{}
    BlockUntilReady()
    Interrupt()
    Terminate()
}
```

Implementations provide per-worker state and lifecycle hooks.

---

## pond Public API

From `alitto/pond`:

### Pool

```go
type WorkerPool struct { ... }

func New(maxWorkers, maxCapacity int, options ...Option) *WorkerPool
```

Constructs a pool with up to `maxWorkers` workers and a queue of `maxCapacity` tasks.

#### Methods

```go
func (p *WorkerPool) Submit(task func())
```

Submits a task. Blocks if queue is full (unless options).

```go
func (p *WorkerPool) TrySubmit(task func()) bool
```

Returns false if queue full.

```go
func (p *WorkerPool) SubmitAndWait(task func())
```

Submits and waits for completion.

```go
func (p *WorkerPool) Stop()
func (p *WorkerPool) StopAndWait()
```

Closes the pool. `StopAndWait` blocks until tasks complete.

```go
func (p *WorkerPool) Running() int
func (p *WorkerPool) Idle() int
func (p *WorkerPool) Submitted() uint64
func (p *WorkerPool) Completed() uint64
func (p *WorkerPool) WaitingTasks() uint64
```

Various counters and gauges.

### Groups

```go
func (p *WorkerPool) Group() *TaskGroup
func (p *WorkerPool) GroupContext(ctx context.Context) (*TaskGroupWithContext, context.Context)
```

Task groups (like errgroup) for batch operations.

### Options

```go
type Option func(*WorkerPool)

func IdleTimeout(d time.Duration) Option
func MinWorkers(n int) Option
func PanicHandler(f func(interface{})) Option
```

---

## Channel Operations

Dynamic pools rely on channel semantics:

### Send

```go
ch <- v
```

- Blocks if channel is unbuffered and no receiver is ready
- Blocks if channel is buffered and full
- Panics if channel is closed
- Atomic with respect to other operations on the same channel

### Receive

```go
v, ok := <-ch
```

- Blocks if channel is empty
- Returns (zero, false) if channel is closed and drained
- Returns (value, true) otherwise

### Close

```go
close(ch)
```

- Subsequent sends panic
- Subsequent receives return (zero, false) once buffer is drained
- Closing a closed channel panics

### Select

```go
select {
case v := <-ch1: ...
case ch2 <- x: ...
default: ...
}
```

- Picks one ready case; if none, default (if present) or blocks
- Selection is pseudo-random among ready cases

These semantics define how pools' job channels behave under contention.

---

## Atomic Operation Guarantees

From `sync/atomic`:

### Loads and Stores

```go
atomic.LoadInt32(&x)
atomic.StoreInt32(&x, v)
```

- Sequentially consistent on most platforms (Go memory model)
- Slower than non-atomic but faster than mutex

### Compare-and-swap

```go
atomic.CompareAndSwapInt32(&x, old, new)
```

- Atomic check-and-update
- Returns true if x was old (now is new), false otherwise

### Add

```go
atomic.AddInt32(&x, 1)
```

- Atomic increment, returns new value
- Combines load, modify, store into one operation

### Typed atomic (Go 1.19+)

```go
var x atomic.Int32
x.Load()
x.Store(v)
x.Add(1)
x.CompareAndSwap(old, new)
```

Cleaner syntax. Same semantics.

Pools use atomics for counters (running, cap, busy). The combination of atomic + mutex (for cond, free list) is standard.

---

## GOMAXPROCS Interaction

`runtime.GOMAXPROCS(n)` sets the maximum number of OS threads simultaneously executing Go code.

Worker pools and GOMAXPROCS interact:

- CPU-bound pool: ideal size is approximately `GOMAXPROCS`. More workers cause scheduler overhead.
- I/O-bound pool: workers spend time blocked on syscalls. Can have many more workers than GOMAXPROCS.
- The Go scheduler multiplexes goroutines onto threads. If you have 1000 workers but GOMAXPROCS=4, at most 4 workers run simultaneously; the rest wait.

In containerized environments, `GOMAXPROCS` defaults to the host CPU count, which may exceed the container's CFS quota. Use `uber-go/automaxprocs` to align with container limits.

For pool autoscaling decisions:
- CPU-bound: ceiling ≈ GOMAXPROCS * 1.5 (allow brief over-subscription)
- I/O-bound: ceiling based on memory and downstream limits, often much higher

---

## Runtime Knobs

Go runtime knobs that affect worker pools:

### GOGC

```
GOGC=100  (default)
```

Higher = less frequent GC, more memory. Lower = more frequent GC, less memory.

Pools with many short-lived allocations benefit from tuning GOGC. Try GOGC=200 for less GC pressure.

### GOMEMLIMIT

```
GOMEMLIMIT=8GiB  (Go 1.19+)
```

Soft memory limit. GC tries to keep heap below this.

For pools, GOMEMLIMIT prevents OOM during burst-grow.

### GODEBUG

```
GODEBUG=schedtrace=1000  (print scheduler trace every 1000 ms)
GODEBUG=gctrace=1        (print GC trace each cycle)
```

Useful for diagnosing scheduler or GC issues.

### runtime/debug

```go
debug.SetMaxThreads(n)        // max OS threads
debug.SetGCPercent(n)          // set GOGC at runtime
debug.SetMemoryLimit(b)        // set GOMEMLIMIT at runtime
```

For dynamic tuning from within the program.

---

## Memory Model Implications

The Go memory model (`go.dev/ref/mem`) defines when one goroutine's writes are visible to another.

### Happens-before

A `Resize(n)` that updates the capacity establishes a happens-before relationship with a subsequent worker's check of the capacity.

For pool implementations:
- `atomic.Store(&capacity, n)` happens-before `atomic.Load(&capacity)` returning n
- A `chan` send happens-before the corresponding receive
- A `sync.Mutex.Unlock()` happens-before the next `Lock()` succeeds

### Implications

If your pool uses non-atomic writes to capacity but atomic reads in workers, you have a data race. The race detector will flag this.

Always use atomic operations or hold a mutex consistently for shared state.

### sync.Cond

```go
cond.Wait()
cond.Signal()
cond.Broadcast()
```

`Wait` releases the cond's mutex and blocks. `Signal` wakes one waiter; `Broadcast` wakes all.

ants uses `sync.Cond` to coordinate between submitters and workers when blocking is enabled.

---

## References

1. **Go Language Specification**: https://go.dev/ref/spec
2. **Go Memory Model**: https://go.dev/ref/mem
3. **`sync/atomic` package**: https://pkg.go.dev/sync/atomic
4. **`sync` package**: https://pkg.go.dev/sync
5. **`runtime` package**: https://pkg.go.dev/runtime
6. **`runtime/debug` package**: https://pkg.go.dev/runtime/debug
7. **panjf2000/ants**: https://github.com/panjf2000/ants
8. **Jeffail/tunny**: https://github.com/Jeffail/tunny
9. **alitto/pond**: https://github.com/alitto/pond
10. **uber-go/automaxprocs**: https://github.com/uber-go/automaxprocs

### Related specifications

- AWS Auto Scaling (cluster-level reference)
- Kubernetes HPA design documents
- TCP congestion control (AIMD): RFC 5681
- Linux CFS (Completely Fair Scheduler) for thread-level scheduling context

### Implementation references

- `ants/pool.go`: pool struct, lifecycle
- `ants/worker.go`: worker struct, run loop
- `ants/worker_loop_queue.go`: ring buffer free list
- `ants/worker_stack.go`: LIFO free list
- `tunny/tunny.go`: pool implementation
- `pond/pond.go`: pool implementation

These are the authoritative sources. Consult them when in doubt about exact behavior.
