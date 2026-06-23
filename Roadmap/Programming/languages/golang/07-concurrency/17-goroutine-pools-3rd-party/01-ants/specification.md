---
layout: default
title: Specification
parent: ants
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/01-ants/specification/
---

# ants — Specification

[← Back](../)

This file is the precise API reference for `github.com/panjf2000/ants/v2`. It covers:

- All public types.
- All constructors.
- All methods.
- All functional options.
- All sentinel errors.
- v1 → v2 differences and notable changes across v2 minor versions.

The canonical source is the GoDoc at <https://pkg.go.dev/github.com/panjf2000/ants/v2>. This file is a structured summary, useful as a single-page reference.

---

## Package

```go
import "github.com/panjf2000/ants/v2"
```

Package name: `ants`. Import path: `github.com/panjf2000/ants/v2`. Module path differs from v1 (which is at the bare path without `/v2`).

---

## Package-Level Constants

```go
const (
	OPEN   = 0  // pool is accepting work
	CLOSED = 1  // pool is shut down
)
```

Pool state values. Used internally but visible. Most users do not reference these directly.

```go
const DefaultAntsPoolSize = math.MaxInt32
```

Default size of the package-level pool used by `ants.Submit`. Effectively unlimited.

```go
const DefaultCleanIntervalTime = time.Second
```

Default `ExpiryDuration`. Idle workers are reaped after one second.

---

## Package-Level Sentinel Errors

All errors implement the standard `error` interface. Compare with `errors.Is` or `==`.

```go
var (
	ErrLackPoolFunc       = errors.New("must provide function for pool")
	ErrInvalidPoolExpiry  = errors.New("invalid expiry for pool")
	ErrInvalidPoolSize    = errors.New("invalid pool size")
	ErrInvalidPoolIndex   = errors.New("invalid pool index")
	ErrPoolClosed         = errors.New("this pool has been closed")
	ErrPoolOverload       = errors.New("too many goroutines blocked on submit or Nonblocking is set")
	ErrInvalidLoadBalancingStrategy = errors.New("invalid load-balancing strategy")
	ErrTimeout            = errors.New("operation timed out")
)
```

Notes:
- `ErrLackPoolFunc` is returned by `NewPoolWithFunc(N, nil)`.
- `ErrInvalidPoolSize` for `NewPool(0)` or invalid negative (other than `-1`).
- `ErrInvalidPoolExpiry` for `WithExpiryDuration(0)` or negative.
- `ErrPoolClosed` returned by `Submit`/`Invoke` after `Release`.
- `ErrPoolOverload` returned by `Submit`/`Invoke` in non-blocking mode at cap, or when `MaxBlockingTasks` is hit.
- `ErrTimeout` returned by `ReleaseTimeout` if drain exceeds deadline.

---

## Package-Level Functions (Default Pool)

The package maintains a default global pool. Convenience entry points:

```go
func Submit(task func()) error
func Release()
func Reboot()
func Running() int
func Free() int
func Cap() int
```

These operate on a default pool of size `DefaultAntsPoolSize` (effectively unlimited). Use sparingly — most applications should create their own pool.

`Reboot` restarts the default pool after `Release` has closed it.

---

## Type: Option

```go
type Option func(opts *Options)
```

A functional option used to configure a pool. Pass as variadic arguments to constructors.

### Type: Options

```go
type Options struct {
	ExpiryDuration   time.Duration
	PreAlloc         bool
	MaxBlockingTasks int
	Nonblocking      bool
	PanicHandler     func(interface{})
	Logger           Logger
	DisablePurge     bool
}
```

The fields the options modify. Not typically referenced directly; use the `With...` functions.

### Type: Logger

```go
type Logger interface {
	Printf(format string, args ...interface{})
}
```

The logger interface. `log.Logger` satisfies it.

---

## Option Functions

### WithExpiryDuration

```go
func WithExpiryDuration(expiryDuration time.Duration) Option
```

Sets the idle expiry for workers. Default: 1 second. Must be > 0 (else `NewPool` returns `ErrInvalidPoolExpiry`).

### WithPreAlloc

```go
func WithPreAlloc(preAlloc bool) Option
```

If true, the pool uses a fixed-size circular buffer for its worker queue. Trade flexibility for predictable memory. Default: false.

### WithMaxBlockingTasks

```go
func WithMaxBlockingTasks(maxBlockingTasks int) Option
```

Maximum number of submitters that may be simultaneously blocked in `Submit` (blocking mode). Beyond this, submitters get `ErrPoolOverload`. Default: 0 (unlimited).

### WithNonblocking

```go
func WithNonblocking(nonblocking bool) Option
```

If true, `Submit`/`Invoke` returns `ErrPoolOverload` immediately when the pool is full, instead of blocking. Default: false.

### WithPanicHandler

```go
func WithPanicHandler(panicHandler func(interface{})) Option
```

Sets the function called when a task panics. Default: nil (the pool logs the panic via the internal logger).

### WithLogger

```go
func WithLogger(logger Logger) Option
```

Sets the logger used by the pool. Default: a `log.Logger` writing to stderr.

### WithDisablePurge

```go
func WithDisablePurge(disable bool) Option
```

If true, disables the janitor goroutine. Idle workers do not expire. Default: false.

---

## Type: Pool

```go
type Pool struct {
	// unexported fields
}
```

The main goroutine pool. Each `Pool` has a fixed (tunable) capacity and a LIFO stack of reusable workers.

### Constructor

```go
func NewPool(size int, options ...Option) (*Pool, error)
```

Creates a new pool with the given capacity. Pass `-1` for unlimited (rarely useful). Returns `ErrInvalidPoolSize` if `size == 0` or other invalid values.

### Methods

```go
func (p *Pool) Submit(task func()) error
```

Schedules a task. Returns `nil`, `ErrPoolClosed`, or `ErrPoolOverload`. In blocking mode, may block until a worker is free.

```go
func (p *Pool) Running() int
```

Number of workers currently executing or idle (alive goroutines).

```go
func (p *Pool) Free() int
```

`Cap() - Running()`. Number of additional workers that could be spawned without exceeding cap.

```go
func (p *Pool) Cap() int
```

Current pool capacity. Updated by `Tune`.

```go
func (p *Pool) Waiting() int
```

Number of goroutines currently blocked in `Submit` (relevant in blocking mode).

```go
func (p *Pool) Tune(size int)
```

Atomically changes the cap. Does not preempt running tasks. Tune up wakes blocked submitters; tune down takes effect for future admissions.

```go
func (p *Pool) IsClosed() bool
```

Returns true if `Release` has been called.

```go
func (p *Pool) Release()
```

Closes the pool. Signals idle workers to exit. Does not wait for in-flight tasks. Idempotent.

```go
func (p *Pool) ReleaseTimeout(timeout time.Duration) error
```

`Release` plus waits up to `timeout` for `Running` to reach 0. Returns `ErrTimeout` if exceeded.

```go
func (p *Pool) Reboot()
```

Restarts a previously released pool. After `Reboot`, `Submit` works again. The pool's options are preserved.

---

## Type: PoolWithFunc

```go
type PoolWithFunc struct {
	// unexported fields
}
```

A specialised pool that runs the same function with different arguments. The function is supplied at construction; tasks are submitted via `Invoke(arg)`.

### Constructor

```go
func NewPoolWithFunc(size int, pf func(interface{}), options ...Option) (*PoolWithFunc, error)
```

`pf` must be non-nil; otherwise returns `ErrLackPoolFunc`.

### Methods

```go
func (p *PoolWithFunc) Invoke(arg interface{}) error
```

Schedules `pf(arg)`. Same error model as `Pool.Submit`.

```go
func (p *PoolWithFunc) Running() int
func (p *PoolWithFunc) Free() int
func (p *PoolWithFunc) Cap() int
func (p *PoolWithFunc) Waiting() int
func (p *PoolWithFunc) Tune(size int)
func (p *PoolWithFunc) IsClosed() bool
func (p *PoolWithFunc) Release()
func (p *PoolWithFunc) ReleaseTimeout(timeout time.Duration) error
func (p *PoolWithFunc) Reboot()
```

Same semantics as `Pool`'s versions.

---

## Type: MultiPool

```go
type MultiPool struct {
	// unexported fields
}
```

A sharded pool of `Pool`s. Useful for high-contention workloads.

### Constructor

```go
func NewMultiPool(size, sizePerPool int, lbs LoadBalancingStrategy, options ...Option) (*MultiPool, error)
```

- `size`: number of sub-pools.
- `sizePerPool`: cap per sub-pool.
- `lbs`: load balancing strategy (`RoundRobin` or `LeastTasks`).

### Methods

```go
func (mp *MultiPool) Submit(task func()) error
func (mp *MultiPool) Running() int
func (mp *MultiPool) Free() int
func (mp *MultiPool) Cap() int
func (mp *MultiPool) Waiting() int
func (mp *MultiPool) Tune(size int)
func (mp *MultiPool) IsClosed() bool
func (mp *MultiPool) ReleaseTimeout(timeout time.Duration) error
func (mp *MultiPool) Release() error
func (mp *MultiPool) Reboot()
```

Aggregate methods sum across sub-pools.

---

## Type: MultiPoolWithFunc

```go
type MultiPoolWithFunc struct {
	// unexported fields
}
```

Sharded version of `PoolWithFunc`.

### Constructor

```go
func NewMultiPoolWithFunc(size, sizePerPool int, fn func(interface{}), lbs LoadBalancingStrategy, options ...Option) (*MultiPoolWithFunc, error)
```

### Methods

Same shape as `MultiPool` but `Invoke(arg)` instead of `Submit`.

---

## Type: LoadBalancingStrategy

```go
type LoadBalancingStrategy int

const (
	RoundRobin LoadBalancingStrategy = 1
	LeastTasks LoadBalancingStrategy = 2
)
```

The two built-in strategies. Custom strategies require forking.

- `RoundRobin`: atomic counter modulo number of sub-pools. O(1) per submit.
- `LeastTasks`: pick sub-pool with lowest `Running()`. O(N) per submit.

Invalid values cause `ErrInvalidLoadBalancingStrategy` from constructors.

---

## API Surface Diagram

```
Package ants

Types:
  - Pool                            (main type)
  - PoolWithFunc                    (specialised single-function pool)
  - MultiPool                       (sharded Pool)
  - MultiPoolWithFunc               (sharded PoolWithFunc)
  - Options                         (config struct)
  - Option                          (config function type)
  - Logger                          (interface)
  - LoadBalancingStrategy           (enum)

Constructors:
  - NewPool(size, opts...) (*Pool, error)
  - NewPoolWithFunc(size, fn, opts...) (*PoolWithFunc, error)
  - NewMultiPool(N, sz, lbs, opts...) (*MultiPool, error)
  - NewMultiPoolWithFunc(N, sz, fn, lbs, opts...) (*MultiPoolWithFunc, error)

Option functions:
  - WithExpiryDuration(d)
  - WithPreAlloc(bool)
  - WithMaxBlockingTasks(n)
  - WithNonblocking(bool)
  - WithPanicHandler(fn)
  - WithLogger(l)
  - WithDisablePurge(bool)

Errors:
  - ErrLackPoolFunc
  - ErrInvalidPoolExpiry
  - ErrInvalidPoolSize
  - ErrInvalidPoolIndex
  - ErrPoolClosed
  - ErrPoolOverload
  - ErrInvalidLoadBalancingStrategy
  - ErrTimeout

Package-level (default pool):
  - Submit(task) error
  - Release()
  - Reboot()
  - Running() int
  - Free() int
  - Cap() int
```

---

## Differences: v1 → v2

| Aspect | v1 | v2 |
|--------|----|----|
| Import path | `github.com/panjf2000/ants` | `github.com/panjf2000/ants/v2` |
| Options | No functional options; explicit setters | Functional options via `With...` |
| Default expiry | Set via setter | Set via `WithExpiryDuration` |
| `MultiPool` | Not available | Available |
| Panic handler | Limited | Full `WithPanicHandler` |
| `Release` | Returns error | Returns void |
| Idempotent Release | No | Yes |

For new code, always use v2.

---

## Notable v2 Minor Version Changes

| Version | Notable change |
|---------|----------------|
| v2.0    | Initial release with functional options. |
| v2.4    | `MultiPool` introduced. |
| v2.5    | `ReleaseTimeout` added. |
| v2.6    | Improvements to `goWorker.run` lifecycle. |
| v2.7    | `WithDisablePurge` added. Multiple panic recovery improvements. |
| v2.8    | Lock-free path optimisations. |
| v2.9    | Worker stack performance improvements. |
| v2.10   | Generics-friendly variants (where supported). |

For exact details, see the CHANGELOG in the repo.

---

## Compatibility Notes

- `ants/v2` requires Go 1.18+ in newer versions (for generics-friendly variants). Older variants compatible with Go 1.13+.
- `ants` is goroutine-safe but `Pool` itself must not be copied (pass `*Pool` always).
- No third-party dependencies beyond the standard library.
- BSD-2-Clause license.

---

## Method Cheat Sheet

```go
// Construction
pool, err := ants.NewPool(size, opts...)
pool, err := ants.NewPoolWithFunc(size, fn, opts...)
mp, err  := ants.NewMultiPool(numShards, sizePerShard, ants.RoundRobin, opts...)
mp, err  := ants.NewMultiPoolWithFunc(numShards, sizePerShard, fn, ants.LeastTasks, opts...)

// Submit work
err := pool.Submit(func() { /* task */ })
err := poolFn.Invoke(arg)
err := mp.Submit(func() { /* task */ })
err := mpFn.Invoke(arg)

// Introspect
n := pool.Running()
n := pool.Free()
n := pool.Cap()
n := pool.Waiting()
b := pool.IsClosed()

// Adjust
pool.Tune(newSize)

// Shutdown
pool.Release()
err := pool.ReleaseTimeout(30 * time.Second)
pool.Reboot()
```

---

## Error Handling Cheat Sheet

```go
err := pool.Submit(task)
switch {
case err == nil:
	// accepted
case errors.Is(err, ants.ErrPoolClosed):
	// pool released
case errors.Is(err, ants.ErrPoolOverload):
	// pool full and non-blocking, or MaxBlockingTasks hit
}
```

For construction:

```go
pool, err := ants.NewPool(size, opts...)
switch {
case err == nil:
case errors.Is(err, ants.ErrInvalidPoolSize):
case errors.Is(err, ants.ErrInvalidPoolExpiry):
case errors.Is(err, ants.ErrLackPoolFunc):
case errors.Is(err, ants.ErrInvalidLoadBalancingStrategy):
}
```

---

## Options Cheat Sheet

```go
// Default expiry (1s) — most apps don't change
ants.WithExpiryDuration(60 * time.Second)

// Pre-alloc worker queue
ants.WithPreAlloc(true)

// Cap on blocked submitters (0 = unlimited)
ants.WithMaxBlockingTasks(1000)

// Non-blocking mode
ants.WithNonblocking(true)

// Panic handler — recommended in production
ants.WithPanicHandler(func(p interface{}) {
	log.Errorf("pool panic: %v", p)
})

// Custom logger
ants.WithLogger(myLogger)

// Disable janitor entirely
ants.WithDisablePurge(true)
```

---

## Default Pool Cheat Sheet

```go
// Convenience for one-off use
err := ants.Submit(func() { doWork() })

// Inspect
ants.Running()
ants.Free()
ants.Cap()

// Shut down
ants.Release()
ants.Reboot()
```

The default pool has `Cap = math.MaxInt32`. Use sparingly.

---

## Method Behaviour Summary

| Method | Blocking? | Goroutine-safe? | Returns error? |
|--------|-----------|-----------------|----------------|
| `NewPool` | No | n/a | Yes |
| `Submit` | Yes (default) / No (with `WithNonblocking`) | Yes | Yes |
| `Invoke` | Same as `Submit` | Yes | Yes |
| `Running` | No | Yes | No |
| `Free` | No | Yes | No |
| `Cap` | No | Yes | No |
| `Waiting` | No | Yes | No |
| `IsClosed` | No | Yes | No |
| `Tune` | No | Yes | No |
| `Release` | No | Yes | No (v2) |
| `ReleaseTimeout` | Yes | Yes | Yes |
| `Reboot` | No | Yes | No |

---

## State Diagram

```
            NewPool                    Reboot
            ------>  +-----------+ <--------+
                     |   open    |          |
                     +-----+-----+          |
                           |                |
                           | Release        |
                           v                |
                     +-----------+          |
                     |  closed   |----------+
                     +-----------+
                           |
                           | (eventually GC'd)
                           v
                         gone
```

While open: `Submit`/`Invoke` succeeds (subject to cap and mode).
While closed: `Submit`/`Invoke` returns `ErrPoolClosed`. `Reboot` returns to open.

---

## Default Values Summary

| Option | Default |
|--------|---------|
| `ExpiryDuration` | 1 second |
| `PreAlloc` | false |
| `MaxBlockingTasks` | 0 (unlimited) |
| `Nonblocking` | false (blocking) |
| `PanicHandler` | nil (default logger) |
| `Logger` | stderr `log.Logger` |
| `DisablePurge` | false |

---

## Internal Constants

The library uses several internal constants (not exported):

- Worker channel buffer size: 1.
- Janitor wake interval: `ExpiryDuration` (or `/ 10` in some versions).
- Spinlock spin count before yield: implementation-dependent.

These are not part of the public API and may change between versions.

---

## Method Argument and Return Types

Quick types reference:

```go
NewPool(size int, options ...Option) (*Pool, error)
NewPoolWithFunc(size int, pf func(interface{}), options ...Option) (*PoolWithFunc, error)
NewMultiPool(size, sizePerPool int, lbs LoadBalancingStrategy, options ...Option) (*MultiPool, error)

(*Pool).Submit(task func()) error
(*PoolWithFunc).Invoke(arg interface{}) error
(*Pool).Tune(size int)              // no return
(*Pool).Release()                    // no return
(*Pool).ReleaseTimeout(d time.Duration) error
(*Pool).Reboot()                     // no return
(*Pool).Running() int
(*Pool).Free() int
(*Pool).Cap() int
(*Pool).Waiting() int
(*Pool).IsClosed() bool
```

---

## End of Specification

For deeper coverage of each method's semantics, see:

- `junior.md` — basic usage of `NewPool`, `Submit`, `Release`.
- `middle.md` — options and `PoolWithFunc`.
- `senior.md` — internals.
- `professional.md` — production patterns.
- `interview.md` — Q&A on this material.
- `tasks.md`, `find-bug.md`, `optimize.md` — exercises.

The exact behaviour of edge cases (e.g., what `Submit` does during `Release`) is in `senior.md`. The numbers in this spec are the canonical defaults.

---
