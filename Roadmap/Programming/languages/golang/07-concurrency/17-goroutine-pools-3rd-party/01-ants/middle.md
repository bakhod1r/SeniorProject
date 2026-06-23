---
layout: default
title: Middle
parent: ants
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/01-ants/middle/
---

# ants — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Mental Model Refresh](#mental-model-refresh)
5. [PoolWithFunc — Specialised Pools](#poolwithfunc--specialised-pools)
6. [The Functional Options API](#the-functional-options-api)
7. [Option: WithExpiryDuration](#option-withexpiryduration)
8. [Option: WithPreAlloc](#option-withprealloc)
9. [Option: WithMaxBlockingTasks](#option-withmaxblockingtasks)
10. [Option: WithNonblocking](#option-withnonblocking)
11. [Option: WithPanicHandler](#option-withpanichandler)
12. [Option: WithLogger and WithDisablePurge](#option-withlogger-and-withdisablepurge)
13. [Tune — Dynamic Resizing](#tune--dynamic-resizing)
14. [ReleaseTimeout — Graceful Shutdown](#releasetimeout--graceful-shutdown)
15. [Error Handling Patterns](#error-handling-patterns)
16. [Coding Patterns](#coding-patterns)
17. [Performance Tips](#performance-tips)
18. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
19. [Common Mistakes](#common-mistakes)
20. [Common Misconceptions](#common-misconceptions)
21. [Tricky Points](#tricky-points)
22. [Test](#test)
23. [Tricky Questions](#tricky-questions)
24. [Cheat Sheet](#cheat-sheet)
25. [Self-Assessment Checklist](#self-assessment-checklist)
26. [Summary](#summary)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams](#diagrams)

---

## Introduction

> Focus: "I know `NewPool` and `Submit`. Now I want to control panic behaviour, blocking semantics, idle expiry, and pool sizing — and I want to use the same function pool repeatedly with different arguments efficiently."

In `junior.md` you used `ants.NewPool(N)` and `pool.Submit(func() { ... })`. That is enough for a hundred small programs. It is not enough for production. Real services need:

- A way to handle **panics** in tasks visibly, with structured logging or metrics.
- A way to make `Submit` **non-blocking** and reject overflow rather than silently queueing back-pressure on producers.
- A way to **bound the number of blocked submitters** so that an unexpected slowdown does not balloon goroutine count.
- A way to **expire idle workers** at a configurable rate so memory does not stay pinned to a peak burst.
- A way to **submit a hot function many times** without allocating a closure each time — the `PoolWithFunc` variant.
- A way to **resize the pool at runtime** as load changes.
- A way to **shut down gracefully**, waiting for in-flight tasks with a deadline.

This file covers all of the above. The API surface here is small — a dozen options, two methods — but each option encodes a real engineering decision that you'll be asked to defend in code review. The point of this file is not just "what does each option do," but "when do you reach for it and what trade-off does it represent."

By the end you will:

- Know every functional option in the `ants` v2 API and the failure mode each one addresses.
- Know when to choose `Pool` vs `PoolWithFunc` and what the per-call allocation difference is.
- Know how to install a panic handler that reports to a metric system, not just stderr.
- Know how `Tune` works and what it does *not* do (it does not preempt).
- Know how to shut down a pool gracefully with `ReleaseTimeout`, and what happens to in-flight tasks if you exceed the deadline.
- Know how to compose `ants` with `context.Context` for cancellation.

You do *not* yet need to understand internals — worker stack, lock-free path, `MultiPool` shard selection. Those are in `senior.md`.

---

## Prerequisites

- Comfortable with everything in `junior.md`. If `NewPool` / `Submit` / `Release` / `Tune` are not yet automatic, go back.
- Comfortable with `context.Context` — what it is, how it propagates, how to cancel it. We'll use it for cancellation throughout.
- Comfortable with `sync.Pool` — the standard-library object pool. Useful for understanding why `WithPreAlloc` has the effects it does.
- Familiar with functional-options patterns. The shape is `func(*config)` and you pass them as variadic arguments to a constructor. If you've used `grpc.NewServer(opts...)` or `redis.NewClient(opts...)`, the pattern carries over.
- Familiar with reading Go documentation. Some details we cover are version-dependent and the canonical source is the GoDoc and the `options.go` file in the repo.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`PoolWithFunc`** | A specialised pool whose every task runs the same function. The function is supplied at pool creation. Tasks are submitted as `interface{}` arguments via `Invoke(arg)`. Trades flexibility for performance — no per-call closure allocation. |
| **`Option`** | A value of type `ants.Option`, internally `func(*Options)`. Used to configure a pool via functional options. Pass as variadic to `NewPool(size, opts...)`. |
| **Idle expiry** | The mechanism by which workers that have been waiting for a task longer than `ExpiryDuration` are killed. Default: 1 second. Controlled by `WithExpiryDuration`. |
| **Janitor / purger** | A single background goroutine started by `NewPool` that periodically scans the idle stack and kills expired workers. Disabled by `WithDisablePurge(true)`. |
| **Pre-allocated pool** | A pool created with `WithPreAlloc(true)` that uses a fixed-size circular buffer for its worker queue instead of a dynamically resizing slice. Trades flexibility (can't shrink below original cap) for predictable memory. |
| **Non-blocking mode** | Mode set by `WithNonblocking(true)`. `Submit` returns `ErrPoolOverload` instead of blocking when the pool is full. |
| **Max blocking tasks** | The cap (default 0 = unlimited) on how many submitter goroutines may be simultaneously blocked in `Submit` when the pool is full and blocking mode is enabled. Set with `WithMaxBlockingTasks(N)`. |
| **Panic handler** | A function `func(interface{})` invoked when a task panics. Replaces the default `log.Printf` behaviour. Set with `WithPanicHandler`. |
| **`Tune(size int)`** | Atomically updates the pool's capacity. Does not preempt running tasks. New submits respect the new cap. |
| **`ReleaseTimeout(d time.Duration)`** | Like `Release` but waits up to `d` for in-flight tasks to finish. Returns `ErrTimeout` if the deadline expires. |

---

## Mental Model Refresh

Before each option, hold this picture in your head:

```
                    Submit (blocks if full, default)
caller -->----------------------------------------------> pool
                                                           |
                                                   +--- worker stack (LIFO)
                                                   |    [w1] [w2] [w3] ...
                                                   |
                                                   +--- running count
                                                   |
                                                   +--- waiting submitters (queue of *cond*)
                                                   |
                                                   +--- janitor (idle expiry)
                                                   |
                                                   +--- options (cap, expiry, handler, flags)
```

Every option you'll learn modifies one of these subsystems:

- `WithExpiryDuration` → janitor's deadline.
- `WithPreAlloc` → worker stack data structure.
- `WithMaxBlockingTasks` → cap on the waiting-submitters queue.
- `WithNonblocking` → bypass the waiting-submitters queue entirely.
- `WithPanicHandler` → installed inside each worker's `recover()` path.
- `WithLogger` → output sink for default panic handler.
- `WithDisablePurge` → turn the janitor off entirely.

Tune affects `cap`. `ReleaseTimeout` interacts with running count.

---

## PoolWithFunc — Specialised Pools

The first major thing you missed in `junior.md`: `PoolWithFunc`.

### The shape

```go
type PoolWithFunc struct { /* unexported */ }

func NewPoolWithFunc(size int, pf func(interface{}), opts ...Option) (*PoolWithFunc, error)

func (p *PoolWithFunc) Invoke(arg interface{}) error
func (p *PoolWithFunc) Release()
// ... and Tune, Cap, Free, Running, identical to Pool
```

You provide the function at construction time. You submit only the argument. The pool stores the function pointer once and reuses it. There is no closure per submit — `Invoke` sends the argument to the worker's input channel directly.

### When to use it

Use `PoolWithFunc` when:

- You are submitting **the same function** with millions of different arguments per second.
- Closure allocation cost shows up in `pprof`.
- Your task naturally takes one argument (or a struct containing many).

Stick with `Pool` when:

- You submit a variety of different functions.
- Per-call closure allocation is not a hotspot (most apps).
- You need the flexibility to capture multiple variables in the closure.

### Minimal example

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

func main() {
	var wg sync.WaitGroup

	pool, err := ants.NewPoolWithFunc(8, func(arg interface{}) {
		defer wg.Done()
		n := arg.(int)
		_ = n * n
	})
	if err != nil {
		panic(err)
	}
	defer pool.Release()

	for i := 0; i < 1000; i++ {
		wg.Add(1)
		_ = pool.Invoke(i)
	}
	wg.Wait()
	fmt.Println("done")
}
```

A few things to notice:

- The function passed to `NewPoolWithFunc` takes `interface{}` (or `any` in Go 1.18+).
- The worker is responsible for asserting the type. There's no compile-time check that `Invoke`'s argument matches.
- `wg.Done` is `defer`-red inside the function, just like with `Pool`. The mechanics of `WaitGroup` are unchanged.
- You cannot mix functions in one `PoolWithFunc`. If you need to, you need multiple pools.

### Why is it faster?

Two reasons:

1. **No closure allocation.** With `Pool.Submit(func() { f(arg) })`, the literal closure allocates because `arg` escapes to the heap. With `PoolWithFunc.Invoke(arg)`, the argument is passed by value (or pointer) on a channel. No new function value, no allocated environment.

2. **Smaller scheduler footprint.** The worker's main loop is `for arg := range taskChan { f(arg) }` — a single channel receive per task. The `Pool` worker's loop is `for task := range taskChan { task() }` — same number of operations, but each task is a heap-allocated `func()`. The pool with-func amortises that.

In benchmarks (the library's own `benchmark_test.go`), `PoolWithFunc` is about 20–30% faster than `Pool` for trivial tasks at very high rates. For non-trivial work (anything taking >10 µs), the difference disappears in the noise — your task dominates.

### Type assertions inside the function

The function inside `PoolWithFunc` typically does:

```go
func(arg interface{}) {
	n, ok := arg.(int)
	if !ok {
		log.Printf("bad arg type %T", arg)
		return
	}
	// ... use n
}
```

The `ok` form is safer in production — a wrong-type `Invoke` should not panic. In hot loops where you control all submitters, the bare assertion `arg.(int)` is fine.

For complex tasks, pass a pointer to a struct:

```go
type job struct {
	URL  string
	Dest string
}

pool, _ := ants.NewPoolWithFunc(50, func(arg interface{}) {
	j := arg.(*job)
	fetch(j.URL, j.Dest)
})
```

The struct can be allocated from a `sync.Pool` and returned after use for true zero-allocation submission.

### Generics in newer versions

`ants` versions 2.10+ ship a generics-friendly variant (`PoolWithFuncGeneric[T]` or similar — the exact name depends on the release). It uses type parameters so you can write:

```go
pool, _ := ants.NewPoolWithFuncGeneric[int](8, func(n int) { /* ... */ })
pool.Invoke(42)
```

No type assertion needed. We will not lean on this in examples because the API is newer and less stable across minor versions, but if you are on a recent ants, it is worth using.

---

## The Functional Options API

Every constructor in `ants` v2 accepts variadic options:

```go
ants.NewPool(size int, opts ...Option) (*Pool, error)
ants.NewPoolWithFunc(size int, pf func(interface{}), opts ...Option) (*PoolWithFunc, error)
ants.NewMultiPool(size, sizePerPool int, lbs LoadBalancingStrategy, opts ...Option) (*MultiPool, error)
```

`Option` is `func(*Options)`. The `Options` struct holds all configuration. The pattern lets you specify any subset, in any order, leaving the rest at their defaults.

### Default values

If you call `NewPool(N)` with no options, you get:

- `ExpiryDuration`: 1 second
- `PreAlloc`: false
- `MaxBlockingTasks`: 0 (unlimited)
- `Nonblocking`: false (blocking on full)
- `PanicHandler`: nil (default logs panics with `log.Printf` to stderr)
- `Logger`: a default `log.Logger` writing to stderr
- `DisablePurge`: false (janitor enabled)

Anything you don't override stays at the default. Anything you do override applies only to that pool.

### Discoverability

Each option is a top-level function in the `ants` package:

```go
ants.WithExpiryDuration(5 * time.Second)
ants.WithPreAlloc(true)
ants.WithMaxBlockingTasks(1000)
ants.WithNonblocking(true)
ants.WithPanicHandler(myHandler)
ants.WithLogger(myLogger)
ants.WithDisablePurge(false)
```

In your IDE, `ants.With` followed by autocomplete reveals them all. There is no global config — you must pass options to every pool you create. (Many teams wrap `NewPool` in their own factory to enforce defaults.)

### Composing options

```go
pool, err := ants.NewPool(100,
	ants.WithExpiryDuration(30*time.Second),
	ants.WithPanicHandler(reportPanic),
	ants.WithNonblocking(true),
	ants.WithMaxBlockingTasks(0), // ignored in non-blocking mode
)
```

Order does not matter. Each option is applied to the `Options` struct in sequence. The last option that sets a field wins, if any options collide.

### Saving an options bundle for reuse

```go
var defaultOpts = []ants.Option{
	ants.WithExpiryDuration(30 * time.Second),
	ants.WithPanicHandler(reportPanic),
}

func newServicePool(size int, extra ...ants.Option) (*ants.Pool, error) {
	opts := append(defaultOpts, extra...)
	return ants.NewPool(size, opts...)
}
```

This is the standard "service factory" pattern. Junior teams should adopt it early — it ensures every pool in the program has the same panic handler installed.

---

## Option: WithExpiryDuration

```go
ants.WithExpiryDuration(d time.Duration)
```

Controls how long a worker may sit idle before the janitor kills it.

### Default

1 second. Most apps never change this.

### When to increase it

- Bursty workloads: tasks arrive in bunches separated by quiet periods of minutes. With a 1-second expiry, workers are killed during the quiet period and have to be respawned. Increase to, say, 60 seconds.
- Large workers: each worker holds a connection or other expensive state. You want to keep them warm.

### When to decrease it

- Memory-tight environments: you want to release worker stacks as quickly as possible after a peak.
- Low-throughput batch jobs: you'd rather pay the spawn cost than keep idle workers around.

### What happens at expiry

The janitor wakes periodically (typically every `ExpiryDuration / 10`, but implementation-defined). It scans the idle stack, identifies workers whose last activity is older than `ExpiryDuration`, sends them a `nil` task, and removes them from the stack. The worker's loop sees the `nil`, breaks, and the goroutine exits. The `goWorker` struct may be returned to the `sync.Pool` for reuse.

### Code example

```go
pool, _ := ants.NewPool(50, ants.WithExpiryDuration(30*time.Second))
defer pool.Release()
```

After this, idle workers live 30 seconds before being killed.

### Watch out for

- The expiry is *per idle period*, not per worker lifetime. A worker that processes a task every 25 seconds will live forever (assuming default 30s expiry).
- `WithExpiryDuration(0)` is invalid — returns `ErrInvalidPoolExpiry` from `NewPool`. To disable expiry entirely, use `WithDisablePurge(true)`.
- The janitor itself is a goroutine. Its cost is one goroutine per pool — usually negligible — but worth knowing for resource accounting.

### Tuning recipe

Inspect `pool.Running()` over time. If it spikes to N then drops to 0 quickly, you're paying spawn cost on every spike. Increase `ExpiryDuration` until `Running` stays elevated through expected quiet periods, then drops at the long-term quiet point.

---

## Option: WithPreAlloc

```go
ants.WithPreAlloc(true)
```

Controls the internal data structure of the worker stack. When `true`, the pool uses a fixed-size **circular array** instead of a dynamic slice for the idle queue.

### Default

`false`. Most apps should not change this.

### When to enable

- You need predictable, bounded memory. Pre-alloc allocates the worker slots at construction time and never grows them.
- You expect the pool to always run near full capacity. The pre-allocated structure avoids the slice-growth costs.

### When *not* to enable

- The pool may often be largely idle. With pre-alloc, the structure is still allocated.
- You may need to `Tune` the pool larger. With pre-alloc, growing past the original cap requires reallocating.

### Behavioural difference

With `WithPreAlloc(true)`:

- The pool allocates a slice of length `size` at construction time.
- Workers are added to and removed from the slice via head/tail pointers (circular).
- `Tune(N)` where `N > original size` may panic or return an error in older versions; in newer versions it migrates to a larger circular buffer.

Without `WithPreAlloc`:

- The pool uses a slice that grows up to `cap` as needed.
- `Tune` always works and is amortised O(1).

### Code example

```go
pool, _ := ants.NewPool(1000, ants.WithPreAlloc(true))
defer pool.Release()
```

For a high-throughput, always-busy pool, this is a tiny memory and CPU win — but only measurable under sustained load. For most apps it is invisible.

### Watch out for

- The internal queue data structure is different between pre-alloc and non-pre-alloc. Bug reports sometimes apply to one mode and not the other.
- You cannot toggle `PreAlloc` after construction. Pick at `NewPool`.

---

## Option: WithMaxBlockingTasks

```go
ants.WithMaxBlockingTasks(n int)
```

In default blocking mode, when the pool is full, `Submit` blocks the caller. This option caps how many callers may be simultaneously blocked. Caller `N+1` gets `ErrPoolOverload`.

### Default

0, meaning unlimited blocked callers.

### Why you might want a cap

You configured `NewPool(100)` to cap workers at 100. But your producers are unbounded — if 10 million tasks arrive in a burst, you have 10 million goroutines blocked in `Submit`. That's not what you wanted: each blocked submitter is a `g` struct, a stack, a scheduler entry.

`WithMaxBlockingTasks(1000)` says: "I am willing to have up to 1000 callers blocked at once. Anyone past that gets an error, and the producer must decide what to do."

### Code example

```go
pool, _ := ants.NewPool(100, ants.WithMaxBlockingTasks(1000))
defer pool.Release()

err := pool.Submit(task)
if errors.Is(err, ants.ErrPoolOverload) {
	// 100 workers busy + 1000 callers waiting + you are the 1101st
	// — bail out, log, retry with backoff
}
```

### Backpressure shape

With this option, your system has three concurrency tiers:

```
producer --> [up to 1000 waiting] --> [100 workers] --> downstream
```

The waiting tier is sized to match acceptable latency. Bigger queue = more latency tolerance but more memory. Smaller queue = lower latency but more error rate under spike.

### Interaction with `WithNonblocking`

If you set both `WithNonblocking(true)` and `WithMaxBlockingTasks(N)`, the non-blocking flag wins. There's no queue at all; either accept or reject immediately. The `MaxBlockingTasks` value is ignored.

### Tuning recipe

Pick `MaxBlockingTasks` such that:

`MaxBlockingTasks * AverageTaskTime ≤ AcceptableTailLatency`

For example: tasks take 20 ms average, you tolerate p99 latency of 1 second. Max waiting is `1000 / 20 = 50`. So `WithMaxBlockingTasks(50)`. Beyond that, return an error and let the producer retry or drop.

---

## Option: WithNonblocking

```go
ants.WithNonblocking(true)
```

Make `Submit` (or `Invoke`) never block. If the pool is full, return `ErrPoolOverload` immediately.

### Default

`false`. `Submit` blocks until a worker is free.

### When to enable

- Producers do other useful work and should not be stalled waiting on the pool.
- You want to apply your own backpressure (e.g., enqueue to a real queue like Redis or Kafka if the in-process pool is full).
- You want strict admission control: any overload is an error your caller handles, not a silent slowdown.

### Code example

```go
pool, _ := ants.NewPool(100, ants.WithNonblocking(true))
defer pool.Release()

err := pool.Submit(task)
switch {
case err == nil:
	// accepted
case errors.Is(err, ants.ErrPoolOverload):
	// pool full
	metrics.PoolDrops.Inc()
case errors.Is(err, ants.ErrPoolClosed):
	// shutting down
default:
	// unexpected
}
```

### Behaviour at the boundary

If `Cap=100` and `Running=100`, the next `Submit` returns `ErrPoolOverload` immediately. If `Running=99`, the next `Submit` succeeds (it grabs the 100th slot). There is no race window — `Submit` either acquires a slot atomically or rejects.

### Common mistakes with non-blocking

- **Ignoring the error.** The task disappears. Your callers see "everything looks fine" but no work was done.
- **Retrying immediately in a tight loop.** You'll burn CPU without yielding.
- **Treating `ErrPoolOverload` as a real error to log loudly.** Under heavy load, you'll spam logs. Use a sampled counter instead.

### Retry recipe

```go
for {
	err := pool.Submit(task)
	if err == nil { break }
	if errors.Is(err, ants.ErrPoolClosed) { return err }
	if errors.Is(err, ants.ErrPoolOverload) {
		select {
		case <-ctx.Done(): return ctx.Err()
		case <-time.After(backoff()):
		}
		continue
	}
	return err
}
```

`backoff()` returns increasing durations (e.g., 1 ms → 2 ms → 4 ms → 100 ms). Always include a context check so cancellation works.

---

## Option: WithPanicHandler

```go
ants.WithPanicHandler(func(panicValue interface{}))
```

The most important option to set in production. Replaces the default `log.Printf` with a handler of your choice.

### Default behaviour

Without a handler, a panic in a task is caught by the worker, logged via `ants`'s internal logger, and the worker continues. The log line looks like:

```
worker exits from panic: <value>; stack:
goroutine 17 [running]:
...
```

### Why default isn't enough

- The log line goes to stderr by default. In a server with structured logs, this becomes plain text mixed in.
- There's no metric, no alert, no traceability.
- The panic value's type is lost — you can't programmatically extract it.

### Custom handler example

```go
import (
	"log"
	"runtime/debug"

	"github.com/panjf2000/ants/v2"
)

func reportPanic(p interface{}) {
	stack := debug.Stack()
	log.Printf("PANIC in pool task: %v\nstack:\n%s", p, stack)
	// metrics, sentry, etc.
}

pool, _ := ants.NewPool(100, ants.WithPanicHandler(reportPanic))
```

### Integrating with metrics

```go
func panicHandler(p interface{}) {
	metrics.PoolPanics.Inc()
	log.Errorf("pool panic: %+v", p)
}
```

### Integrating with Sentry / OpsGenie / etc.

```go
func panicHandler(p interface{}) {
	sentry.CaptureException(fmt.Errorf("task panic: %v", p))
}
```

In production, **always install a panic handler**, even if it's a no-op that just calls the default. It documents that you considered panics and made a deliberate choice.

### What the handler must not do

- It must not panic itself. If it does, the worker dies. (Some versions of `ants` recover even from the handler; don't rely on it.)
- It must not block forever. If it does, the worker is stuck.
- It must be goroutine-safe. It may be called from many worker goroutines simultaneously.

### Reading the stack

The default `debug.Stack()` captures the panicking goroutine's stack. Useful for diagnostics. Be aware: in production, full stacks can be large and PII-laden. Consider redacting before sending to external services.

---

## Option: WithLogger and WithDisablePurge

Two minor but useful options.

### WithLogger

```go
ants.WithLogger(logger)
```

Replaces the default `log.Logger`-compatible logger used internally for panic logging when no custom panic handler is set. Useful for routing `ants`'s output through your structured logger.

The interface is:

```go
type Logger interface {
	Printf(format string, args ...interface{})
}
```

This matches the standard `log.Logger`. Your favourite logger (zap, zerolog, logrus) probably has a `.Printf`-style adapter.

Example:

```go
type zapAdapter struct{ l *zap.SugaredLogger }
func (z *zapAdapter) Printf(f string, a ...interface{}) { z.l.Infof(f, a...) }

pool, _ := ants.NewPool(100, ants.WithLogger(&zapAdapter{l: zap.S()}))
```

Once you install a `WithPanicHandler`, the logger is rarely invoked — the handler short-circuits the default path. But `ants` also uses the logger for other diagnostic messages internally.

### WithDisablePurge

```go
ants.WithDisablePurge(true)
```

Disables the janitor goroutine entirely. Idle workers never expire. Workers only exit on `Release`.

When to use:

- Steady-state pool that's never idle. You don't need the janitor.
- Pool that holds expensive resources (database connections) you don't want to reopen.
- Very low-throughput pool where janitor's polling is more cost than benefit.

When not to use:

- Bursty workloads where you do want memory released after a peak.

The trade-off is straightforward: one goroutine saved + workers stay warm forever vs memory not freed between peaks.

```go
pool, _ := ants.NewPool(100, ants.WithDisablePurge(true))
```

After `Release`, the pool tears down normally — workers are signalled and exit. Disabling purge only affects the idle-expiry behaviour during normal operation.

---

## Tune — Dynamic Resizing

```go
func (p *Pool) Tune(size int)
func (p *PoolWithFunc) Tune(size int)
```

Changes the capacity of the pool atomically. Safe to call concurrently with `Submit` or `Invoke`.

### Semantics

- New cap takes effect immediately for *future* admission decisions.
- In-flight tasks are not interrupted. If `Running > newSize`, you have to wait for tasks to finish before `Running` drops to `newSize`.
- New `Submit` calls block (or reject) according to the new cap.
- `Tune(0)` is invalid (some versions ignore it silently, some return error).
- `Tune(-1)` may or may not be supported as "unlimited" — check your version.

### Example: load-aware autoscaling

```go
ticker := time.NewTicker(10 * time.Second)
go func() {
	for range ticker.C {
		load := measureLoad()
		switch {
		case load > 0.9:
			pool.Tune(pool.Cap() + 50)
		case load < 0.3 && pool.Cap() > 50:
			pool.Tune(pool.Cap() - 25)
		}
	}
}()
```

A toy autoscaler. Real implementations use queue depth (your own counter, since the pool has no internal queue) or downstream latency as the signal.

### Watch out for

- Don't `Tune` from inside a task. Conceptually valid, practically dangerous — a misbehaving task can shrink the pool that's running it.
- Don't `Tune` in a hot loop. Each `Tune` takes a brief lock; doing it thousands of times per second is wasteful.
- After `Tune` down, `Running > Cap` is transiently legal. Treat `Free()` cautiously.

### Race-safe inspection

```go
runs, cap := pool.Running(), pool.Cap()
```

Each call is individually safe. Together they may be inconsistent — `Running` may be from a moment before `Cap`. Don't compute `runs/cap` and treat it as a strict ratio.

---

## ReleaseTimeout — Graceful Shutdown

```go
func (p *Pool) ReleaseTimeout(timeout time.Duration) error
func (p *PoolWithFunc) ReleaseTimeout(timeout time.Duration) error
```

`Release` plus wait for in-flight tasks, up to a deadline.

### Default `Release`

`Release` is asynchronous w.r.t. running tasks. It signals idle workers, sets the closed flag, but does *not* wait for `Running` to drop to 0. Your function may return while tasks are still running.

### `ReleaseTimeout`

Calls `Release`, then polls `Running` until it reaches 0 or the timeout expires. Returns `nil` on graceful exit or `ErrTimeout` if the timeout fires.

### Example

```go
pool, _ := ants.NewPool(100)
// ... use pool ...

if err := pool.ReleaseTimeout(30 * time.Second); err != nil {
	log.Printf("pool did not drain in time: %v", err)
	// At this point some tasks are still running. Most production
	// systems then proceed to exit anyway. The goroutines will be
	// killed by os.Exit.
}
```

### Comparison

| Method | Returns when |
|--------|---------------|
| `Release()` | Idle workers signalled. In-flight tasks may still run. |
| `ReleaseTimeout(d)` | All workers gone, or `d` elapsed. |

For graceful shutdown of a server, `ReleaseTimeout` is what you want. Plumb it into your SIGTERM handler:

```go
sigs := make(chan os.Signal, 1)
signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
<-sigs
log.Println("shutting down")
if err := pool.ReleaseTimeout(30 * time.Second); err != nil {
	log.Println("forced shutdown:", err)
}
```

### What if tasks don't finish in time?

The pool is "closed" but workers continue running tasks. If you `os.Exit` next, the OS reclaims them. If you don't, you have leaked goroutines.

To force tasks to exit on `Release`, you must thread a `context.Context` through them — see the cancellation pattern below.

---

## Error Handling Patterns

A consolidated view of how to handle errors at this level.

### Pattern 1 — Fall back to inline execution

If `Submit` is rejected, just run the task on the calling goroutine:

```go
if err := pool.Submit(task); err != nil {
	task()
}
```

Pros: never drops a task. Cons: the calling goroutine becomes the executor, defeating the pool's protection.

### Pattern 2 — Drop and count

```go
if err := pool.Submit(task); err != nil {
	metrics.Dropped.Inc()
}
```

Pros: simple, observable. Cons: tasks are lost.

### Pattern 3 — Retry with backoff

Shown earlier. Useful when overload is transient.

### Pattern 4 — Escalate to a real queue

```go
if err := pool.Submit(task); err != nil {
	enqueueToRedis(task)
}
```

Pros: never drops. Cons: needs a real queue, adds latency.

### Pattern 5 — Bound the producer

```go
if err := pool.Submit(task); err != nil {
	// stop accepting new work
	server.SetReadyForTraffic(false)
}
```

Pros: keeps the system healthy. Cons: needs cooperative load shedder.

### Choosing

There is no universal right answer. The choice depends on the cost of dropping vs the cost of latency. For user-facing APIs, retry/queue. For background batch, drop and replay later. For real-time analytics, drop and approximate.

---

## Coding Patterns

### Pattern 1 — Context-aware Submit

The pool doesn't take a context. You add one yourself.

```go
func submitCtx(ctx context.Context, p *ants.Pool, task func(context.Context)) error {
	return p.Submit(func() {
		task(ctx)
	})
}
```

Inside `task`, you can `select { case <-ctx.Done(): return; default: }` to short-circuit if the context is cancelled before the task starts.

### Pattern 2 — Submit with deadline propagation

```go
func submitDeadline(p *ants.Pool, deadline time.Time, task func(context.Context)) error {
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	return p.Submit(func() {
		defer cancel()
		task(ctx)
	})
}
```

Cancel propagates through `task`. If the task returns before the deadline, `cancel` is called immediately.

### Pattern 3 — Context-aware Pool (wrapper)

```go
type ContextPool struct {
	p *ants.Pool
}

func (c *ContextPool) Submit(ctx context.Context, task func(context.Context)) error {
	return c.p.Submit(func() {
		select {
		case <-ctx.Done(): return
		default:
		}
		task(ctx)
	})
}
```

This pattern hides the closure and lets callers pass a context naturally.

### Pattern 4 — errgroup over ants

```go
g, ctx := errgroup.WithContext(ctx)
for _, x := range items {
	x := x
	g.Go(func() error {
		errCh := make(chan error, 1)
		err := pool.Submit(func() {
			errCh <- doWork(ctx, x)
		})
		if err != nil { return err }
		return <-errCh
	})
}
return g.Wait()
```

The `errgroup` provides cancellation and first-error semantics. The pool provides worker reuse. The cost: an `errCh` per task. For high throughput, prefer Pattern 5.

### Pattern 5 — errgroup limit + ants pool

```go
// errgroup limits concurrency; pool reuses goroutines.
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(pool.Cap())
for _, x := range items {
	x := x
	g.Go(func() error {
		return submitAndWait(ctx, pool, func() error { return doWork(ctx, x) })
	})
}
return g.Wait()
```

Where `submitAndWait` blocks until the pool runs the task. More complex but more efficient.

### Pattern 6 — Multi-error collection

```go
type result struct{ err error }
results := make([]result, len(items))

var wg sync.WaitGroup
for i, x := range items {
	i, x := i, x
	wg.Add(1)
	_ = pool.Submit(func() {
		defer wg.Done()
		results[i].err = doWork(x)
	})
}
wg.Wait()

var errs []error
for _, r := range results {
	if r.err != nil { errs = append(errs, r.err) }
}
return errors.Join(errs...)
```

`errors.Join` (Go 1.20+) gives you a single error wrapping all individual errors.

### Pattern 7 — Bounded fan-out fan-in

```go
in := make(chan int, 100)
out := make(chan int, 100)

go func() {
	defer close(in)
	for _, x := range items { in <- x }
}()

var wg sync.WaitGroup
for x := range in {
	x := x
	wg.Add(1)
	_ = pool.Submit(func() {
		defer wg.Done()
		out <- process(x)
	})
}
go func() { wg.Wait(); close(out) }()

for r := range out { handle(r) }
```

Classic fan-out, fan-in over a pool.

### Pattern 8 — Backpressure on a slow consumer

```go
// Producer
for ev := range events {
	ev := ev
	if err := pool.Submit(func() { handle(ev) }); err != nil {
		// non-blocking and overloaded
		droppedCounter.Inc()
	}
}
```

If `WithNonblocking(true)`, the producer drops on overload. If blocking, the producer naturally slows down — the channel `events` fills up, the upstream sender blocks.

### Pattern 9 — Per-tenant pool

```go
type TenantPools struct {
	mu    sync.Mutex
	pools map[string]*ants.Pool
}

func (t *TenantPools) Get(tenant string) *ants.Pool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if p, ok := t.pools[tenant]; ok { return p }
	p, _ := ants.NewPool(50, ants.WithPanicHandler(reportPanic))
	t.pools[tenant] = p
	return p
}
```

Each tenant has its own pool. One tenant's burst doesn't affect another. Trade-off: many pools means many janitors and many idle workers — measure.

### Pattern 10 — Hot-swappable pool size from config

```go
type DynamicPool struct {
	pool *ants.Pool
}

func (d *DynamicPool) ReconfigureFrom(cfg *Config) {
	d.pool.Tune(cfg.PoolSize)
	// Other options can't be changed at runtime; rebuild if needed.
}
```

Wire this up to your config-reload signal (SIGHUP). For runtime changes that don't fit `Tune`, rebuild the pool (release old, construct new, swap atomically).

### Pattern 11 — PoolWithFunc with struct argument

```go
type job struct {
	URL  string
	Dst  string
	Done chan error
}

pool, _ := ants.NewPoolWithFunc(50, func(arg interface{}) {
	j := arg.(*job)
	j.Done <- fetch(j.URL, j.Dst)
})

j := &job{URL: u, Dst: d, Done: make(chan error, 1)}
_ = pool.Invoke(j)
err := <-j.Done
```

Structured invocation. The `Done` channel is the result-return mechanism. Buffered with size 1 so the worker can always write without blocking.

### Pattern 12 — PoolWithFunc with sync.Pool struct recycling

```go
var jobPool = sync.Pool{New: func() any { return &job{Done: make(chan error, 1)} }}

j := jobPool.Get().(*job)
j.URL = u; j.Dst = d
_ = pool.Invoke(j)
err := <-j.Done
jobPool.Put(j)
```

Zero allocations per task in steady state.

---

## Performance Tips

### Tip 1 — Profile before optimising

Default `ants.NewPool(N)` is fast enough for most workloads. Don't tune unless you have a measured problem.

### Tip 2 — Prefer `PoolWithFunc` for hot loops

If `pprof` shows `runtime.newobject` (closure allocation) hot in your submit path, switch to `PoolWithFunc`.

### Tip 3 — Use `WithPreAlloc` for steady-state pools

If your pool is always near full and you don't `Tune` often, `WithPreAlloc(true)` gives slightly better cache locality and avoids slice growth.

### Tip 4 — Don't make the pool huge "just in case"

A 100k-worker pool that's mostly idle is 200 MB of stack memory. Tighter cap = better.

### Tip 5 — Tune up before peaks, down after

If you know peaks happen at noon, `Tune` up at 11:55 and `Tune` down at 13:05. The expiry mechanism will handle the rest.

### Tip 6 — `WithExpiryDuration` longer for warm-up sensitive workers

If your task opens a TCP connection that takes 50 ms to establish, you don't want workers expiring on every quiet second. Set expiry to a minute or more.

### Tip 7 — Watch janitor cost

The janitor wakes every `ExpiryDuration / 10`. For very long expiry (hours), the janitor barely runs — cheap. For very short expiry (milliseconds), the janitor is busy — measurable.

### Tip 8 — Submit batching

Instead of submitting 1000 small tasks, submit one task that processes 1000 items. Saves 999 submit operations.

```go
chunkSize := 100
for i := 0; i < len(items); i += chunkSize {
	chunk := items[i:min(i+chunkSize, len(items))]
	_ = pool.Submit(func() { for _, x := range chunk { process(x) } })
}
```

Trade-off: larger chunks reduce overhead but increase tail latency (slow chunks block one worker for longer).

### Tip 9 — Match cap to `GOMAXPROCS` only for CPU work

For pure CPU work, `cap = GOMAXPROCS` is optimal. Anything larger wastes memory; anything smaller wastes CPU.

### Tip 10 — Limit per-task allocations

A task that allocates 100 small slices puts pressure on GC. Use `sync.Pool` to recycle.

---

## Edge Cases & Pitfalls

### Pitfall 1 — `Invoke` with nil

`pool.Invoke(nil)` is *legal*. Your function receives `nil` as the argument. If your function doesn't handle nil, it'll panic, and the panic handler will catch it. Always validate input.

### Pitfall 2 — Type assertion panics

```go
n := arg.(int) // panics if arg is not int
```

Use the comma-ok form in production: `n, ok := arg.(int); if !ok { return }`.

### Pitfall 3 — `WithExpiryDuration(0)` is invalid

It returns `ErrInvalidPoolExpiry` from `NewPool`. Use `WithDisablePurge(true)` to disable expiry instead.

### Pitfall 4 — `Tune(0)` is invalid

Treats as no-op or returns silently — version-dependent. To stop accepting tasks, `Release` or build admission control on top.

### Pitfall 5 — Panic handler called from worker goroutine

The handler runs on the worker that just experienced the panic. The worker is still alive (it will continue), but its current stack is the panicking one. Be careful not to access goroutine-local state expecting "main goroutine."

### Pitfall 6 — `Submit` from inside panic handler

Don't `Submit` more tasks from within the panic handler. You're in the worker's goroutine; submitting may deadlock if the pool is full and you're inside the worker that would have freed up.

### Pitfall 7 — `ReleaseTimeout` does not interrupt

If your tasks ignore context cancellation, `ReleaseTimeout` will time out and return error, but tasks keep running. To force interruption, plumb a `context.Context` through your tasks.

### Pitfall 8 — Options applied after `NewPool` are ignored

`Options` is read at construction. Modifying the `Options` struct (if you somehow got a reference) does nothing. To change behaviour, build a new pool.

### Pitfall 9 — `WithNonblocking` and `WithMaxBlockingTasks` conflict

Non-blocking wins. `MaxBlockingTasks` is ignored.

### Pitfall 10 — Panic in `PoolWithFunc`'s function

The panic handler still catches it. The worker continues. But the type assertion on the argument is a common panic source; the panic value is a `*runtime.TypeAssertionError`, not your application error.

---

## Common Mistakes

### Mistake 1 — Setting `WithExpiryDuration` to a tiny value

```go
ants.WithExpiryDuration(10 * time.Millisecond)
```

Workers die almost instantly. You pay spawn cost constantly. Default is 1 second; rarely should you go below 100 ms.

### Mistake 2 — Disabling purge "just in case"

```go
ants.WithDisablePurge(true) // I want max performance!
```

Workers live forever. Memory never released after a peak. Only do this for pools that are truly always busy.

### Mistake 3 — Misunderstanding `WithNonblocking`

```go
ants.WithNonblocking(true)
pool.Submit(task) // ignored error
```

In non-blocking mode, errors are common. Ignoring them means dropping tasks silently.

### Mistake 4 — Trusting `Tune` to preempt

```go
pool.Tune(0) // I want to stop all work
```

`Tune(0)` is invalid (and even if it worked semantically, it wouldn't preempt). Use `Release` or context cancellation.

### Mistake 5 — Forgetting to type-check in `PoolWithFunc`

```go
ants.NewPoolWithFunc(8, func(arg interface{}) {
	n := arg.(int) // panics on wrong type
})
```

Always check with comma-ok in production.

### Mistake 6 — Panic handler that panics

```go
func panicHandler(p interface{}) {
	panic(fmt.Sprintf("got panic: %v", p)) // worker dies
}
```

Logging shouldn't panic. Use defensive code.

### Mistake 7 — `ReleaseTimeout` without context propagation

Tasks ignore the deadline. Timeout fires, error returned, tasks still running, goroutines leak.

### Mistake 8 — One `PoolWithFunc` for multiple use cases

`PoolWithFunc` is one function. If you have two use cases, you need two pools. Don't multiplex by argument type — it's slow and error-prone.

### Mistake 9 — Treating `WithLogger` as a panic handler

`WithLogger` only affects messages that go through the default logger. With a `WithPanicHandler`, the logger isn't used for panics. Set both if you want logged-and-handled.

### Mistake 10 — `Tune` in a hot loop

```go
for /* every event */ {
	pool.Tune(computeOptimalSize())
	_ = pool.Submit(task)
}
```

`Tune` takes a lock. Calling it tens of thousands of times per second is wasted. Tune on a clock (every 10 seconds), not per event.

---

## Common Misconceptions

### Misconception 1 — "`PoolWithFunc` is strictly faster than `Pool`."

Only for trivial tasks at high rate. For non-trivial work the closure allocation cost is noise; `Pool`'s flexibility is worth more.

### Misconception 2 — "`Tune` resizes immediately."

The cap is updated immediately. The *running count* takes time to follow if you tune down.

### Misconception 3 — "`WithExpiryDuration` kills busy workers."

No. Only idle workers. A worker that has been processing tasks continuously never expires.

### Misconception 4 — "`Release` waits for tasks."

It does not. `ReleaseTimeout` does.

### Misconception 5 — "Non-blocking mode is faster."

Non-blocking and blocking modes have the same hot-path performance. Non-blocking is about *backpressure semantics*, not speed.

### Misconception 6 — "`WithPreAlloc` is a perf win in all cases."

It's a perf win for steady, full pools. For sparse pools, it just allocates memory you're not using.

### Misconception 7 — "The pool has a queue."

It does not. Callers are the queue.

### Misconception 8 — "Panic handler is invoked once per task."

Only on panic. If your task doesn't panic, the handler is never called.

---

## Tricky Points

### Tricky 1 — Option ordering matters when conflicting

If you pass `WithNonblocking(false)` after `WithNonblocking(true)`, blocking wins. Each option is just a function applied to the options struct in order.

### Tricky 2 — `Tune` cannot make a pool unlimited

`Tune(-1)` is not equivalent to creating with `NewPool(-1)`. The "unlimited" mode is set at construction. To change, rebuild.

### Tricky 3 — `WithPreAlloc(true)` may use more memory upfront

Pre-alloc allocates the worker queue immediately. A `NewPool(10000, WithPreAlloc(true))` uses memory for 10000 slots at creation, even if zero workers are spawned. Without pre-alloc, memory grows as workers are added.

### Tricky 4 — `ExpiryDuration` interacts with task duration

If your task takes 30 seconds and `ExpiryDuration` is 1 second, the worker doesn't expire during the task (it's not idle). After the task, the worker becomes idle, and the *next* expiry check applies. There's no weird interaction.

### Tricky 5 — `WithPanicHandler` does not replace internal logging

In some versions, the internal logger still emits the panic stack even when a panic handler is set. To suppress, install a no-op logger via `WithLogger(noopLogger)`.

### Tricky 6 — `Submit` errors are sticky

If `Submit` returns `ErrPoolClosed`, you can't retry. The pool is dead. Distinguish from `ErrPoolOverload` which is transient.

### Tricky 7 — `ReleaseTimeout` may return nil but tasks still running

In some edge versions, `ReleaseTimeout(0)` returns immediately without waiting. Use a positive value.

### Tricky 8 — `PoolWithFunc` errors propagate the same as `Pool`

`Invoke` returns the same error types as `Submit`. The interface is consistent.

### Tricky 9 — Argument lifetime in `PoolWithFunc`

The argument you pass to `Invoke` is held by reference (it's an `interface{}`). The worker may receive it asynchronously. Don't mutate the underlying value between `Invoke` and task execution.

### Tricky 10 — Panic in option construction

If an option function panics (very unusual, but possible if you write one), `NewPool` panics — there's no recover.

---

## Test

### Q1
What is the default value of `ExpiryDuration`?

**A.** 1 second.

### Q2
What does `WithDisablePurge(true)` do?

**A.** Disables the janitor goroutine. Idle workers never expire and only exit on `Release`.

### Q3
What is the difference between `Submit` and `Invoke`?

**A.** `Submit` (on `Pool`) takes a `func()`. `Invoke` (on `PoolWithFunc`) takes an `interface{}` argument; the function was set at pool creation. `Invoke` avoids per-call closure allocation.

### Q4
When does `Submit` return `ErrPoolOverload`?

**A.** When the pool is full *and* `WithNonblocking(true)` is set, *or* when blocking mode has reached `WithMaxBlockingTasks(N)` already blocked callers.

### Q5
When does `Submit` return `ErrPoolClosed`?

**A.** When `Release` (or `ReleaseTimeout`) has been called and the pool is in closed state.

### Q6
What does `Tune(20)` do if `Running` is currently 50?

**A.** Sets cap to 20 immediately. Running tasks continue. New submits block (or reject) until `Running <= 20`. No tasks are interrupted.

### Q7
How do you ensure panics are reported to your metric system?

**A.** Install `ants.WithPanicHandler(handler)` where `handler` reports to your metrics.

### Q8
What is the default panic behaviour without `WithPanicHandler`?

**A.** The pool catches the panic with `recover`, logs it via the internal logger (defaults to stderr), and the worker continues.

### Q9
What does `ReleaseTimeout(30 * time.Second)` return if a task is still running after 30 seconds?

**A.** `ants.ErrTimeout`. The pool is closed but tasks are still running.

### Q10
Why might you set `WithPreAlloc(true)`?

**A.** For steady-state pools where memory predictability matters and you don't `Tune` up. Saves slice-growth cost at the price of allocating worker slots upfront.

### Q11
What happens if the panic handler itself panics?

**A.** Behaviour is version-dependent. In recent versions, the outer recover catches it and the worker continues. Best practice: don't let the handler panic.

### Q12
What does `WithMaxBlockingTasks(0)` mean?

**A.** Unlimited blocked callers. The default.

### Q13
Is `Tune` safe to call from multiple goroutines?

**A.** Yes. It uses atomic operations / mutex internally.

### Q14
What happens to existing blocked submitters when you `Tune` up?

**A.** They are woken (some of them) because new slots become available. They acquire slots in FIFO-ish order.

### Q15
Why might `WithPreAlloc(true)` not work well with `Tune`?

**A.** Pre-alloc uses a fixed-size structure. Growing past the original size requires reallocating, which is more expensive than the slice approach.

---

## Tricky Questions

### TQ1
**Q.** I have `pool, _ := ants.NewPool(100, ants.WithNonblocking(true), ants.WithMaxBlockingTasks(1000))`. What does the `MaxBlockingTasks` do here?

**A.** Nothing. Non-blocking mode means there are no blocked callers; `MaxBlockingTasks` is irrelevant.

### TQ2
**Q.** I `Submit` a task that calls `pool.Tune(5)` on the same pool, which has cap 100. What happens?

**A.** `Tune` runs inside the task. The pool's cap drops to 5. If 50 tasks are running, they continue. Subsequent submits block until `Running <= 5`. Legal but smelly.

### TQ3
**Q.** I have `pool, _ := ants.NewPoolWithFunc(8, func(arg interface{}) { ... })`. Can I call `pool.Submit(func(){...})`?

**A.** No. `Submit` is not a method on `PoolWithFunc`. Only `Invoke(arg)` is. Use `Pool` if you need to submit arbitrary functions.

### TQ4
**Q.** My panic handler does `pool.Submit(reportTask)`. The pool is full. What happens?

**A.** Likely deadlock. The panic handler runs on a worker; that worker is now blocked in `Submit`; no worker can free up while the panic handler is running. Either submit to a *different* pool, or send the report on a buffered channel.

### TQ5
**Q.** I set `WithExpiryDuration(1 * time.Hour)`. Memory still grows over time. Why?

**A.** Maybe not workers leaking. Check your task closures — they may be retaining references the workers hold. Or your `PoolWithFunc` argument structs are leaking.

### TQ6
**Q.** I want to drop tasks during shutdown but allow them during normal operation. How?

**A.** Toggle non-blocking mode via a wrapper, not by reconfiguring the pool. Have your submit method check a `shutting_down` flag and either submit or drop.

### TQ7
**Q.** I configured `WithMaxBlockingTasks(0)` and my goroutines explode under load. Why?

**A.** 0 means *unlimited*, not zero. Set a real number like 100.

### TQ8
**Q.** Does `Submit` participate in any goroutine-id-style fairness?

**A.** No. Whichever blocked goroutine the runtime happens to wake first gets the next slot. No FIFO guarantee across goroutines.

### TQ9
**Q.** I have `Submit` returning nil but the task never runs. Why?

**A.** The task is enqueued to a worker but maybe a `Release` happened between submit and execution. Or your task itself returns immediately. Add a print at the very start of the task to confirm.

### TQ10
**Q.** Can I `Tune` to a value larger than my original `NewPool(N)`?

**A.** Yes, without `WithPreAlloc`. With `WithPreAlloc(true)`, behaviour is version-dependent — some versions allow it (and reallocate), some return an error.

---

## Cheat Sheet

```go
// Common production pool
pool, err := ants.NewPool(100,
	ants.WithExpiryDuration(30*time.Second),
	ants.WithPanicHandler(reportPanic),
	ants.WithNonblocking(true),
)
defer pool.Release()

// Submit with error handling
switch err := pool.Submit(task); {
case err == nil:
case errors.Is(err, ants.ErrPoolOverload): metrics.Dropped.Inc()
case errors.Is(err, ants.ErrPoolClosed):   return err
}

// Specialised pool for hot loops
fpool, _ := ants.NewPoolWithFunc(100, func(arg interface{}) {
	j := arg.(*job)
	process(j)
}, ants.WithPanicHandler(reportPanic))
defer fpool.Release()
_ = fpool.Invoke(&job{...})

// Resize
pool.Tune(200)

// Graceful shutdown
if err := pool.ReleaseTimeout(30 * time.Second); err != nil {
	log.Printf("forced shutdown: %v", err)
}
```

### Option summary

| Option | Default | When to set |
|--------|---------|-------------|
| `WithExpiryDuration(d)` | 1 s | Long-lived expensive workers; bursty workloads |
| `WithPreAlloc(bool)` | false | Steady-state pools, memory predictability |
| `WithMaxBlockingTasks(n)` | 0 | Cap blocked-submitter goroutine count |
| `WithNonblocking(bool)` | false | Explicit admission control |
| `WithPanicHandler(fn)` | nil | Always set in production |
| `WithLogger(l)` | std log | Route through structured logger |
| `WithDisablePurge(bool)` | false | Always-busy pools, expensive workers |

---

## Self-Assessment Checklist

- [ ] Set up a pool with a custom panic handler that prints "PANIC: <value>".
- [ ] Convert a `Pool` based program to `PoolWithFunc` and verify allocations dropped.
- [ ] Configure a non-blocking pool with `MaxBlockingTasks` (which should be ignored) and explain why.
- [ ] Write a wrapper that adds context-aware cancellation to `Submit`.
- [ ] Use `Tune` to grow and shrink a pool while it processes a load test.
- [ ] Use `ReleaseTimeout` to drain a pool with a 30-second deadline.
- [ ] Combine `errgroup` and `ants` for context-aware fan-out.
- [ ] List the trade-offs between blocking and non-blocking submit modes.
- [ ] Identify when `PoolWithFunc` is worth the lost flexibility.

---

## Summary

You learned:

- `PoolWithFunc` for specialised hot-loop pools and `Invoke` for argument-only submission.
- The full set of functional options: `WithExpiryDuration`, `WithPreAlloc`, `WithMaxBlockingTasks`, `WithNonblocking`, `WithPanicHandler`, `WithLogger`, `WithDisablePurge`.
- `Tune` for dynamic resizing and what it does (and does not) do.
- `ReleaseTimeout` for graceful shutdown and the limits of cooperative cancellation.
- Patterns for error handling: fall-back-to-inline, drop, retry, escalate, bound producer.
- Patterns for context-aware execution and integration with `errgroup`.
- Common mistakes: tiny expiry, ignored non-blocking errors, panics in panic handlers.

Production-grade observability, multi-tenant patterns, and `MultiPool` come next.

---

## Further Reading

- `options.go` in the `ants` repo — concise definitions of every option.
- `pool_with_func.go` — the specialised pool's implementation. Short and worth reading.
- The library's `examples/` directory.
- Andy Pan's GopherCon China talk on `ants` design (linked from README).

## Related Topics

- `05-context` — `context.Context` propagation, deadlines, cancellation.
- `06-sync-once` — `sync.Once` for first-error wiring.
- `18-errgroup` — `errgroup` with `SetLimit` and integration with `ants`.
- `12-graceful-shutdown` — signal handling, `ReleaseTimeout`, draining patterns.

---

## Diagrams

### Diagram 1 — PoolWithFunc layout

```
                Invoke(arg) -->|                              |
                               |       argument channel        |
caller ----------------------->|---->[worker_1: runs fixedFunc(arg)]
                               |---->[worker_2: runs fixedFunc(arg)]
                               |---->[worker_3: runs fixedFunc(arg)]
                                |
                                +--- shared function pointer
```

No closure per call — only the argument crosses the channel.

### Diagram 2 — Non-blocking vs blocking

```
Blocking mode:
caller --Submit--> [full] --[wait]--> [worker free] --> running

Non-blocking mode:
caller --Submit--> [full] --> ErrPoolOverload

Blocking with MaxBlockingTasks(N):
caller --Submit--> [full, queue < N] --[wait]--> running
caller --Submit--> [full, queue == N] --> ErrPoolOverload
```

### Diagram 3 — Tune timing

```
t=0:  cap=100, running=50      Tune(10) called
t=0+: cap=10,  running=50      (no preemption)
...   cap=10,  running=49
...   cap=10,  running=48
...
t=∞:  cap=10,  running<=10     new submits respect cap
```

### Diagram 4 — ReleaseTimeout flow

```
ReleaseTimeout(d):
  Release() -- signal idle workers
  loop:
    if Running() == 0: return nil
    if elapsed >= d:   return ErrTimeout
    sleep small interval
```

### Diagram 5 — Panic handling

```
worker.run() {
  for task := range taskCh {
    func() {
      defer func() {
        if r := recover(); r != nil {
          options.PanicHandler(r) // or default log
        }
      }()
      task()
    }()
  }
}
```

The handler runs inside the deferred recover. The worker continues to the next task.

---

## Deep Dive: PoolWithFunc Lifecycle

To really understand when to reach for `PoolWithFunc`, walk through the lifecycle of an invocation.

### Step 1 — Construction

```go
pool, _ := ants.NewPoolWithFunc(8, fixedFunc, opts...)
```

At construction:

1. The `Options` struct is built from defaults plus your overrides.
2. The pool struct is allocated with cap=8.
3. The internal worker queue (slice or circular buffer, per `WithPreAlloc`) is initialised but empty.
4. The function pointer `fixedFunc` is stored once on the pool struct.
5. The janitor goroutine is started (unless `WithDisablePurge(true)`).
6. No worker goroutines exist yet.

### Step 2 — First Invoke

```go
err := pool.Invoke(42)
```

Inside `Invoke`:

1. Check if the pool is closed (atomic load of a flag). If yes → `ErrPoolClosed`.
2. Try the fast path: pop an idle worker from the LIFO stack. With cap=8 and zero idle workers, fast path fails.
3. Take the lock. If running count `< cap`, increment running and spawn a new worker goroutine.
4. Send the argument to the worker's input channel.
5. Return nil.

The worker goroutine:

```go
func (w *goWorkerWithFunc) run() {
	go func() {
		defer recoverAndReinsert()
		for arg := range w.argCh {
			if arg == nil { break } // poison pill for shutdown/expiry
			w.pool.poolFunc(arg)
			w.recycle()
		}
	}()
}
```

After running, the worker calls `recycle` which pushes itself back to the idle stack and updates its last-active timestamp.

### Step 3 — Subsequent Invokes

The fast path succeeds: pop a recently-used worker (top of stack). Send the argument. Return. No new goroutine, no allocation (the argument is sent by interface value, but interfaces are pointer-sized).

### Step 4 — Pool Full

```go
err := pool.Invoke(arg) // pool already at cap with no idle workers
```

In blocking mode (default), the caller registers on an internal `sync.Cond`-like structure and waits. When any worker finishes, it signals the cond, the caller wakes, retries.

In non-blocking mode, the caller gets `ErrPoolOverload` immediately.

### Step 5 — Idle Expiry

After `ExpiryDuration` of inactivity, the janitor kills the worker (sends nil on `argCh`). The goroutine breaks its loop and the `goWorkerWithFunc` struct is returned to the `sync.Pool` for reuse.

If a new `Invoke` arrives later, a fresh worker goroutine is created (but the struct may be recycled from the `sync.Pool`).

### Step 6 — Release

```go
pool.Release()
```

Sets the closed flag, signals all idle workers to exit (nil on argCh), and wakes all blocked callers (they see closed flag and return `ErrPoolClosed`).

### Comparing with Pool

The lifecycle of `Pool` is structurally identical, but the worker's input channel is `chan func()` instead of `chan interface{}`. Each `Submit` sends a closure value; the closure typically captures variables and is heap-allocated.

```
Pool.Submit:        caller --[chan func()]--> worker.run task()
PoolWithFunc.Invoke: caller --[chan interface{}]--> worker.run fixedFunc(arg)
```

Both are O(1) on the fast path. `Invoke` saves the allocation of the closure.

---

## Deep Dive: WithExpiryDuration

The janitor is the most over-thought option in `ants`. Most of its behaviour is hidden behind one parameter.

### How often does the janitor run?

The janitor sleeps `ExpiryDuration / 10` by default (in some versions, exactly `ExpiryDuration`). So with default 1 second expiry, the janitor wakes 10 times per second. That's cheap, even with many pools.

### What does a janitor pass look like?

```go
func (p *Pool) purgeStaleWorkers() {
	ticker := time.NewTicker(p.options.ExpiryDuration)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
		case <-p.closeCh:
			return
		}
		if p.IsClosed() { return }
		p.lock.Lock()
		expired := p.workers.findExpired(p.options.ExpiryDuration)
		p.lock.Unlock()
		for _, w := range expired {
			w.argCh <- nil // poison pill
		}
	}
}
```

(Simplified; the real code is in `pool.go`.) The janitor takes the lock, finds expired workers, releases the lock, and signals them outside the lock. This keeps lock hold time short.

### What if `ExpiryDuration` is very long?

The janitor wakes rarely. Workers live a long time. Memory accumulates. Not necessarily bad — just match it to your traffic.

### What if `ExpiryDuration` is very short?

The janitor wakes often. Workers are killed quickly. You pay spawn cost on every reuse. CPU usage goes up.

### Sweet spot

For most apps, 5–60 seconds is reasonable. The default 1 second is a defensive choice — it errs on releasing memory.

### Disabling expiry entirely

`WithDisablePurge(true)`. No janitor goroutine, no expiry. Workers only die on `Release`.

```go
pool, _ := ants.NewPool(100, ants.WithDisablePurge(true))
```

This is appropriate for:

- Pools with expensive workers (DB connections, GPU contexts).
- Pools that are always busy.
- Tests where janitor timing introduces flakiness.

---

## Deep Dive: WithPanicHandler in Practice

Real production code uses panic handlers for three things:

### 1. Reporting to monitoring

```go
func reportPanic(p interface{}) {
	stack := debug.Stack()
	sentry.CaptureException(&runtimeError{value: p, stack: stack})
	metrics.PanicsTotal.WithLabelValues("pool", os.Getenv("SERVICE")).Inc()
	log.Errorf("pool panic: %v\n%s", p, stack)
}
```

### 2. Distinguishing panic types

```go
func reportPanic(p interface{}) {
	switch v := p.(type) {
	case *url.Error:
		// network panic; treat as transient
		metrics.NetworkPanics.Inc()
	case runtime.Error:
		// runtime panic; bug
		metrics.BugPanics.Inc()
	default:
		metrics.UnknownPanics.Inc()
	}
	log.Errorf("pool panic %T: %v", p, p)
}
```

### 3. Restarting the program for critical panics

```go
func reportPanic(p interface{}) {
	log.Errorf("pool panic: %v", p)
	if isCritical(p) {
		// can't continue safely
		os.Exit(1)
	}
}
```

Use sparingly — letting one task crash the whole program defeats the pool's recovery design. But sometimes a particular kind of panic (e.g., out of memory) indicates the process is doomed.

### Don'ts

- Don't allocate a lot in the handler. It runs in a panicking stack; memory might be tight.
- Don't take locks the rest of your program holds. Deadlock risk.
- Don't return values. The handler's signature is `func(interface{})` — no return.

---

## Cancellation Patterns in Depth

The pool has no context. You add one. There are three places to thread cancellation:

### Place 1 — Around Submit

If `Submit` may block, you may want to give up.

```go
done := make(chan error, 1)
go func() { done <- pool.Submit(task) }()
select {
case err := <-done:
	// submitted (or error)
case <-ctx.Done():
	return ctx.Err()
}
```

Cost: one goroutine per call. For occasional submits, fine. For hot loops, expensive.

Alternative: use `WithNonblocking(true)` and your own retry loop:

```go
for {
	err := pool.Submit(task)
	if err == nil { return nil }
	if errors.Is(err, ants.ErrPoolClosed) { return err }
	select {
	case <-ctx.Done(): return ctx.Err()
	case <-time.After(backoff()):
	}
}
```

### Place 2 — Inside the task

Most important. Without this, `ReleaseTimeout` is meaningless.

```go
_ = pool.Submit(func() {
	select {
	case <-ctx.Done():
		return
	default:
	}
	doWork(ctx)
})
```

The `select` at the top short-circuits if the context is already cancelled when the worker picks up the task. The `doWork(ctx)` call is expected to honour `ctx.Done()` mid-execution.

### Place 3 — In Release

Treat your context cancel as a precursor to `ReleaseTimeout`:

```go
<-ctx.Done()
if err := pool.ReleaseTimeout(30 * time.Second); err != nil {
	log.Println("forced shutdown:", err)
}
```

Combined with Place 2, this gives a graceful drain: context cancel → tasks abort mid-flight → workers idle → `ReleaseTimeout` succeeds quickly.

### Putting it together — ContextPool wrapper

```go
type ContextPool struct {
	p     *ants.Pool
	ctx   context.Context
	cancel context.CancelFunc
}

func NewContextPool(parent context.Context, size int) (*ContextPool, error) {
	p, err := ants.NewPool(size, ants.WithNonblocking(true))
	if err != nil { return nil, err }
	ctx, cancel := context.WithCancel(parent)
	return &ContextPool{p: p, ctx: ctx, cancel: cancel}, nil
}

func (c *ContextPool) Submit(task func(context.Context)) error {
	return c.p.Submit(func() {
		select {
		case <-c.ctx.Done():
			return
		default:
		}
		task(c.ctx)
	})
}

func (c *ContextPool) Close(timeout time.Duration) error {
	c.cancel()
	return c.p.ReleaseTimeout(timeout)
}
```

Now callers have a clean API: pass `Context` to `Submit`, call `Close(timeout)` for graceful shutdown.

---

## A Realistic Service Example

To anchor the options, here's a sketch of a notification service using `ants` with production-grade options.

```go
package notify

import (
	"context"
	"log"
	"runtime/debug"
	"time"

	"github.com/panjf2000/ants/v2"
)

type Service struct {
	pool *ants.Pool
	ctx  context.Context
}

func New(ctx context.Context, size int) (*Service, error) {
	p, err := ants.NewPool(size,
		ants.WithExpiryDuration(60*time.Second),
		ants.WithNonblocking(true),
		ants.WithMaxBlockingTasks(0), // ignored
		ants.WithPanicHandler(panicHandler),
	)
	if err != nil {
		return nil, err
	}
	return &Service{pool: p, ctx: ctx}, nil
}

func panicHandler(p interface{}) {
	log.Printf("notify pool panic: %v\n%s", p, debug.Stack())
	// metrics.PanicsTotal.WithLabelValues("notify").Inc()
}

func (s *Service) Notify(user, msg string) error {
	return s.pool.Submit(func() {
		select {
		case <-s.ctx.Done():
			return
		default:
		}
		sendPush(s.ctx, user, msg)
	})
}

func (s *Service) Stats() (running, free, cap int) {
	return s.pool.Running(), s.pool.Free(), s.pool.Cap()
}

func (s *Service) Close(timeout time.Duration) error {
	return s.pool.ReleaseTimeout(timeout)
}

func sendPush(ctx context.Context, user, msg string) {
	_ = ctx
	_ = user
	_ = msg
}
```

What this gets you:

- Cap on concurrent push operations.
- Visibility via `Stats`.
- Panic reporting.
- Non-blocking submit: if the pool is overloaded, the caller gets an error and can decide to retry or drop.
- Graceful shutdown via `Close`.

Worth ~50 lines and you have a production-grade notification service core.

---

## Worked Mini-Project: Bounded Job Runner With Options

Let's expand the crawler from `junior.md` with middle-level options.

### Spec

- Read URLs from a file.
- Pool size 50, configurable via flag.
- Idle workers expire after 60 seconds.
- Non-blocking submit — if overloaded, log and skip.
- Panic handler that increments a counter.
- On SIGTERM, drain for 30 seconds, then exit.

### Implementation

```go
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/panjf2000/ants/v2"
)

var panics int64

func panicHandler(p interface{}) {
	atomic.AddInt64(&panics, 1)
	log.Printf("PANIC: %v\n%s", p, debug.Stack())
}

func main() {
	in := flag.String("in", "urls.txt", "input file")
	out := flag.String("out", "out", "output dir")
	c := flag.Int("c", 50, "concurrency")
	flag.Parse()

	if err := os.MkdirAll(*out, 0o755); err != nil {
		log.Fatal(err)
	}

	pool, err := ants.NewPool(*c,
		ants.WithExpiryDuration(60*time.Second),
		ants.WithNonblocking(true),
		ants.WithPanicHandler(panicHandler),
	)
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigs
		log.Println("shutdown signal received")
		cancel()
	}()

	f, err := os.Open(*in)
	if err != nil { log.Fatal(err) }
	defer f.Close()

	var wg sync.WaitGroup
	var ok, fail, dropped int64
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			break
		default:
		}
		u := strings.TrimSpace(scanner.Text())
		if u == "" { continue }
		wg.Add(1)
		err := pool.Submit(func() {
			defer wg.Done()
			select {
			case <-ctx.Done():
				atomic.AddInt64(&dropped, 1)
				return
			default:
			}
			if err := fetch(ctx, u, *out); err != nil {
				atomic.AddInt64(&fail, 1)
				return
			}
			atomic.AddInt64(&ok, 1)
		})
		if err != nil {
			wg.Done()
			if errors.Is(err, ants.ErrPoolOverload) {
				atomic.AddInt64(&dropped, 1)
			} else {
				log.Printf("submit error: %v", err)
				break
			}
		}
	}

	wg.Wait()
	if err := pool.ReleaseTimeout(30 * time.Second); err != nil {
		log.Printf("forced shutdown: %v", err)
	}
	fmt.Printf("ok=%d fail=%d dropped=%d panics=%d\n",
		ok, fail, dropped, atomic.LoadInt64(&panics))
}

func fetch(ctx context.Context, url, outDir string) error {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil { return err }
	resp, err := http.DefaultClient.Do(req)
	if err != nil { return err }
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("%s: %s", url, resp.Status)
	}
	name := strings.NewReplacer("/", "_", ":", "_").Replace(url)
	dst, err := os.Create(filepath.Join(outDir, name))
	if err != nil { return err }
	defer dst.Close()
	_, err = io.Copy(dst, resp.Body)
	return err
}
```

What this demonstrates:

- All four middle-level options in one place.
- Non-blocking submit with proper error handling.
- Context cancellation plumbed into both submit and task.
- `ReleaseTimeout` for graceful shutdown.
- Panic handler counting panics for visibility.

This is the same shape almost any production batch job takes.

---

## More Test Questions

### Q16
You set `WithExpiryDuration(0)`. What happens?

**A.** `NewPool` returns `ErrInvalidPoolExpiry`. Zero is invalid. Use `WithDisablePurge(true)` if you want no expiry.

### Q17
You set `WithLogger(nil)`. What happens?

**A.** Behaviour depends on version. Some versions fall back to default; some panic. Don't pass nil.

### Q18
Can `ReleaseTimeout(0)` be useful?

**A.** It's the same as `Release` in most versions — fire-and-forget. If timeout is 0, it returns immediately.

### Q19
Is `pool.Tune(currentCap)` a no-op?

**A.** Effectively yes. The atomic update is performed, but no state changes meaningfully.

### Q20
You set `WithMaxBlockingTasks(-1)`. What happens?

**A.** Treated as 0 (unlimited) in most versions. Don't pass negative.

### Q21
You install a panic handler that takes 100 ms. What's the cost?

**A.** Each panic delays the worker by 100 ms while running the handler. If panics are rare, irrelevant. If panics happen on every other task (a sign of a bug, but possible), worker throughput drops dramatically.

### Q22
You call `Invoke` with a struct value (not a pointer). Is the struct copied?

**A.** Yes. The `interface{}` wraps the value. Receiver gets a copy. For large structs, prefer pointers.

### Q23
You call `Invoke(nil)`. What happens?

**A.** The function receives nil. If your function does a type assertion (`arg.(*Job)`), it panics on nil. If it checks first, it can return cleanly.

### Q24
Does `Tune` affect blocked submitters?

**A.** Yes. Tuning up frees slots and wakes blocked submitters. Tuning down doesn't kick them out — they remain blocked until tasks finish.

### Q25
Are option functions safe to share across many `NewPool` calls?

**A.** Yes. Each option function is read-only. Building a `var defaultOpts = []ants.Option{...}` slice and reusing it is idiomatic.

---

## More Tricky Questions

### TQ11
**Q.** I want a "kill switch" that drops everything immediately. How?

**A.** `Release` sets closed flag; future submits get `ErrPoolClosed`. But in-flight tasks keep running. To kill them, your tasks must honour context cancellation. There's no built-in "kill all running tasks" — Go has no thread interrupt.

### TQ12
**Q.** I want priority. Some tasks are urgent.

**A.** `ants` has no priority. Either build two pools (urgent + bulk) or wrap the pool with your own priority queue and use the pool as a worker farm.

### TQ13
**Q.** I have 100 pools, each cap 10. Can I make a `MultiPool`?

**A.** `MultiPool(100, 10, RoundRobin)` gives you 100 sub-pools of cap 10 each. Behaviour-wise similar; performance-wise, one shared lock per sub-pool vs one global lock per `MultiPool`. See `senior.md`.

### TQ14
**Q.** My panic handler is called twice for one panic. How?

**A.** Likely your task started its own goroutine and that one panicked. Your panic handler caught the original panic; the spawned goroutine's panic kills the program (unless you `recover` there too). Don't spawn goroutines inside tasks unless you recover them.

### TQ15
**Q.** Can I reuse the same option for two pools?

**A.** Yes. Options are pure functions; they have no per-pool state.

### TQ16
**Q.** I see `pool.Cap() == 100` but `pool.Running() == 200`. How?

**A.** You called `Tune(100)` while 200 tasks were running. They continue. `Running > Cap` is legal transiently.

### TQ17
**Q.** My non-blocking pool returns `ErrPoolOverload` immediately even when it's empty. Why?

**A.** Probably you call `Submit` from a goroutine that holds the pool's lock somehow (unusual). More commonly, you have two pools and are calling `Submit` on the wrong one.

### TQ18
**Q.** `PoolWithFunc` lets me have one function. I want polymorphic dispatch. How?

**A.** Use `Pool` with closures (the natural answer), or use `PoolWithFunc` where the function does an `interface` type switch. The switch adds a small overhead but keeps the API.

### TQ19
**Q.** I want submit to be cancellable but my context is short-lived. How?

**A.** Use non-blocking mode + retry with backoff + context check. Don't try to thread the context into `Submit` itself — there's no API.

### TQ20
**Q.** Pool A submits to Pool B. Pool B submits to Pool A. Both non-blocking. Is there a deadlock risk?

**A.** No deadlock — non-blocking returns errors. Risk is dropped tasks. Each `Submit` may fail; ensure callers handle errors.

---

## Best Practices (Middle Level)

1. **Always install a panic handler.** Even if it just calls `log.Printf`. Documents intent.
2. **Pick blocking vs non-blocking deliberately.** Default blocking; non-blocking only when you have an admission story.
3. **Use `WithMaxBlockingTasks` as an upper bound on goroutine count.** Without it, blocked submitters can be unbounded.
4. **`WithExpiryDuration` should match your workload's quiet periods.** 1 s default for spiky web traffic; longer for batch.
5. **Plumb `context.Context` into your tasks.** Always. The pool won't do it for you.
6. **Use `ReleaseTimeout` for graceful shutdown.** Pair with `signal.Notify`.
7. **Prefer `PoolWithFunc` for measurably-hot loops.** Default to `Pool` for everything else.
8. **Don't over-tune.** Most apps work fine with `NewPool(N, WithPanicHandler(...))` and nothing else.
9. **Test your pool under load.** Synthetic load tests reveal capacity, expiry, and recovery behaviour you can't see in unit tests.
10. **Document why a pool exists.** Every pool in your codebase should have a comment explaining the workload, the chosen size, and any non-default options.

---

## Performance Tips (extended)

### Tip 11 — Submit cost is dominated by closure allocation

For trivial tasks, allocating the `func()` closure is 50–80% of the cost. `PoolWithFunc` eliminates this.

### Tip 12 — Avoid sync.Map inside tasks if you can

`sync.Map` is slower than `RWMutex`-protected map for read-heavy maps with few keys. Profile.

### Tip 13 — Buffer your channels if tasks read/write them

A worker that blocks on an unbuffered channel send is a wasted worker. Buffer where reasonable.

### Tip 14 — Avoid `time.Now()` per task if not needed

For high-rate tasks, even `time.Now()` is measurable. Cap to "once per 10 tasks" if you can.

### Tip 15 — Use `runtime/pprof` to profile

```go
import _ "net/http/pprof"
go http.ListenAndServe(":6060", nil)
```

Then `go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30`.

### Tip 16 — Watch out for sync.WaitGroup contention

Many goroutines `Add`/`Done`-ing a single `WaitGroup` becomes a contention point. Split into multiple `WaitGroup`s if needed.

### Tip 17 — Pre-create your sync.Pools

If your task uses `sync.Pool` for buffers, instantiate the pool at startup, not per request.

### Tip 18 — Match panic handler to severity

A heavy handler (Sentry + metrics) for true bugs. A light handler (counter increment only) for expected exceptional cases. Don't use the same one for both — you'll either overwhelm Sentry or miss real bugs.

### Tip 19 — Audit your `Invoke` argument types

If you pass `int` to one `Invoke` and `string` to another, the type switch in your function is your bottleneck. Use distinct pools or pass a struct.

### Tip 20 — Don't share a `PoolWithFunc` across function variants

If you need three functions, use three pools. Don't dispatch inside the single function via type switch — it muddles purpose.

---

## Edge Cases (extended)

### Edge 16 — `Invoke` on a freshly-released pool

If `Invoke` is called right after `Release`, you may race with the closed flag. Should always return `ErrPoolClosed`. If not, it's a library bug. Report.

### Edge 17 — Race on `Tune` vs `Submit`

Both are safe individually. The combined behaviour is well-defined: `Tune` updates cap atomically; new submits see the new cap; in-flight submits committed under the old cap.

### Edge 18 — `WithPreAlloc(true)` with a very large size

If `size = 1_000_000`, pre-alloc allocates a slice of 1M slots. That's ~8 MB (for pointer-sized entries). Possibly fine; possibly wasteful if pool is never that big.

### Edge 19 — `Submit` inside `Invoke`

A task in `PoolWithFunc` calls `pool2.Submit(...)`. This is fine if `pool2` is a different pool. If `pool2` is the same `Pool` (not `PoolWithFunc`), it works as long as `pool2` is not full and waiting on the current pool.

### Edge 20 — `ReleaseTimeout(d)` with d longer than reasonable

A 10-hour timeout is legal. The function will sleep for hours if necessary. Not what most apps want; use 30s–60s.

---

## Common Misconceptions (extended)

### Misconception 9 — "`WithExpiryDuration` controls how long submitters wait."

No. It controls idle worker expiry. Submitter waits are unbounded unless you set `WithMaxBlockingTasks`.

### Misconception 10 — "I need `WithPreAlloc` for production."

You don't. Default works fine for most cases. Use pre-alloc only if you've measured a benefit.

### Misconception 11 — "`PoolWithFunc` is type-safe."

It is not. `interface{}` argument means runtime type assertion. The generics-friendly variant in newer versions changes this, but base `PoolWithFunc` is not type-safe.

### Misconception 12 — "Non-blocking mode is for high-throughput."

It's not. Non-blocking is for admission control. Blocking mode has identical throughput; it just slows down producers when the pool is full.

### Misconception 13 — "`Tune` is expensive."

It's a quick atomic + maybe a wake of blocked submitters. Cheap. Just don't call it in a tight loop.

### Misconception 14 — "Panic handler runs in a separate goroutine."

It runs in the worker's goroutine, inside the deferred recover. Same stack as the panic.

### Misconception 15 — "`Release` cancels pending submits."

It does. Blocked submitters are woken and return `ErrPoolClosed`. But in-flight tasks continue.

---

## Coding Patterns (extended)

### Pattern 13 — Bulkhead per service

```go
type Client struct {
	googlePool *ants.Pool
	awsPool    *ants.Pool
	internalPool *ants.Pool
}

func (c *Client) CallGoogle(req Req) error {
	return c.googlePool.Submit(func() { /* ... */ })
}
```

Each downstream service has its own pool. A slow Google doesn't starve AWS calls.

### Pattern 14 — Submit + result via channel

```go
result := make(chan int, 1)
_ = pool.Submit(func() { result <- doWork() })
return <-result
```

For one-off "submit and wait" calls. For many at once, prefer the WaitGroup pattern.

### Pattern 15 — Worker farm with shared state

```go
type Counter struct {
	mu sync.Mutex
	n  int
}

cnt := &Counter{}
for i := 0; i < 1000; i++ {
	_ = pool.Submit(func() {
		cnt.mu.Lock()
		cnt.n++
		cnt.mu.Unlock()
	})
}
```

The mutex serialises access. For very high counters, `atomic.Int64` is faster.

### Pattern 16 — Submit then forget (truly async)

```go
type Server struct {
	pool *ants.Pool
}

func (s *Server) HandleRequest(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	_ = s.pool.Submit(func() {
		processAsync(body)
	})
	w.WriteHeader(http.StatusAccepted)
}
```

The HTTP request returns 202 immediately. Processing happens on a pool worker. If the pool is full and blocking, the HTTP request slows down (back-pressure). If non-blocking, the request gets a 503.

### Pattern 17 — Cancellable Submit with Timeout

```go
func submitOrTimeout(p *ants.Pool, task func(), d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	done := make(chan error, 1)
	go func() { done <- p.Submit(task) }()
	select {
	case err := <-done:
		return err
	case <-timer.C:
		return errors.New("submit timeout")
	}
}
```

Simple but allocates a goroutine. For hot loops, use non-blocking mode + retry.

### Pattern 18 — Per-pool stats endpoint

```go
http.HandleFunc("/pool", func(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "running=%d free=%d cap=%d\n",
		pool.Running(), pool.Free(), pool.Cap())
})
```

Plumb to `/metrics` for Prometheus.

### Pattern 19 — Reload pool size from config

```go
func (s *Service) Reload(cfg *Config) {
	s.pool.Tune(cfg.PoolSize)
}
```

Wire to SIGHUP or a config-update event.

### Pattern 20 — Submit batch in single call

```go
func submitBatch(pool *ants.Pool, batch []int) error {
	return pool.Submit(func() {
		for _, x := range batch {
			process(x)
		}
	})
}
```

Better submit cost when batch is small. Trade-off: tail latency.

---

## Self-Assessment Checklist (extended)

- [ ] Distinguish `WithExpiryDuration` (idle workers) from `WithMaxBlockingTasks` (blocked submitters).
- [ ] Choose between `Pool` and `PoolWithFunc` for a given workload.
- [ ] Implement a panic handler that reports to your metric system.
- [ ] Build a context-aware Submit wrapper.
- [ ] Configure non-blocking mode and write a sane retry loop.
- [ ] Implement graceful shutdown with `ReleaseTimeout` + context cancellation.
- [ ] Tune a pool dynamically based on load.
- [ ] Recognise when `WithPreAlloc(true)` is worth setting.

---

## Cheat Sheet (extended)

### Choosing Pool vs PoolWithFunc

```
Need different functions per submit?   → Pool
Submit > 100k/sec the same function?   → PoolWithFunc (or with-func generic)
Need argument-only invocation?         → PoolWithFunc
Want maximum flexibility?              → Pool
```

### Choosing blocking vs non-blocking

```
Producer should slow down naturally?   → blocking (default)
Want explicit admission control?       → non-blocking
Have a fallback queue?                 → non-blocking + escalation
Don't care about overload?             → blocking, no MaxBlockingTasks
```

### Choosing expiry duration

```
Always busy?            → DisablePurge(true)
Spiky web traffic?      → 1 s default
Bursty batch (minutes)? → 60 s
Memory-tight?           → 100 ms (rarely)
```

### Common options recipe

```go
// Production pool
pool, _ := ants.NewPool(size,
	ants.WithExpiryDuration(30*time.Second),
	ants.WithNonblocking(true),
	ants.WithPanicHandler(panicHandler),
)
defer pool.ReleaseTimeout(30 * time.Second)
```

---

## Summary

You learned the middle-level surface of `ants`:

- `PoolWithFunc` for hot-loop submission without closure allocation.
- The seven functional options and what failure mode each addresses.
- `Tune` for runtime resizing (without preemption).
- `ReleaseTimeout` for graceful shutdown (with the limits of cooperative cancellation).
- Patterns for context-aware tasks, error handling, and integration with `errgroup`.
- The trade-offs of every option choice.

In `senior.md` you'll see the internals — worker stack, lock-free fast path, sync.Pool reuse, `MultiPool` sharding, MGRR (round-robin / least-tasks) strategies. The middle-level API is enough for 95% of production code; the senior view is for performance work, debugging, and library-level decisions.

---

## Extended Examples

### Extended Example A — Two-tier pool with overflow to queue

A common production pattern is to use a fast in-memory pool for the hot path, and overflow to a durable queue (Redis, Kafka) for the cold path.

```go
type TwoTier struct {
	pool *ants.Pool
	q    *RedisQueue
}

func (t *TwoTier) Submit(task Task) error {
	err := t.pool.Submit(func() { t.handle(task) })
	if err == nil {
		return nil
	}
	if errors.Is(err, ants.ErrPoolOverload) {
		// Pool full; push to Redis for later processing.
		return t.q.Push(task)
	}
	return err
}
```

The hot path stays cheap; rare overflow handled by a slower-but-reliable backend.

### Extended Example B — Latency-aware Tune

Adjust the pool size based on observed latency. If tasks are taking too long, shrink (less concurrency = less contention). If queue is empty, grow.

```go
type Adaptive struct {
	pool   *ants.Pool
	target time.Duration
	min    int
	max    int
}

func (a *Adaptive) Run() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		p99 := observedP99()
		cap := a.pool.Cap()
		switch {
		case p99 > a.target*2 && cap > a.min:
			a.pool.Tune(cap - cap/10)
		case a.pool.Free() == 0 && cap < a.max:
			a.pool.Tune(cap + cap/10)
		}
	}
}
```

10-second cycle. 10% adjustment. Hysteresis on the upper bound prevents flapping. Real adaptive pools use PID controllers; this is the sketch.

### Extended Example C — Multi-pool batch processor

You have three pools for three task types. Coordinate them.

```go
type Processor struct {
	parsePool, validatePool, persistPool *ants.Pool
}

func (p *Processor) Process(items []Item) error {
	g, ctx := errgroup.WithContext(context.Background())
	for _, item := range items {
		item := item
		g.Go(func() error {
			parsed := make(chan Parsed, 1)
			_ = p.parsePool.Submit(func() {
				parsed <- parse(item)
			})
			validated := make(chan Validated, 1)
			_ = p.validatePool.Submit(func() {
				validated <- validate(<-parsed)
			})
			done := make(chan error, 1)
			_ = p.persistPool.Submit(func() {
				done <- persist(ctx, <-validated)
			})
			return <-done
		})
	}
	return g.Wait()
}
```

Each item flows parse → validate → persist, across three pools. The flow is built from channels. The `errgroup` provides the wait-and-error semantics on the outside.

This is one of many shapes; another is a "pipeline" pool chain. Use whatever fits your latency / batch requirements.

### Extended Example D — Pool with circuit breaker

If many tasks are failing, stop submitting and let the system recover.

```go
type CircuitPool struct {
	pool        *ants.Pool
	failures    int64
	threshold   int64
	tripUntil   atomic.Value // time.Time
}

func (c *CircuitPool) Submit(task func() error) error {
	if until := c.tripUntil.Load(); until != nil {
		if t := until.(time.Time); time.Now().Before(t) {
			return errors.New("circuit open")
		}
	}
	return c.pool.Submit(func() {
		if err := task(); err != nil {
			if atomic.AddInt64(&c.failures, 1) > c.threshold {
				c.tripUntil.Store(time.Now().Add(30 * time.Second))
				atomic.StoreInt64(&c.failures, 0)
			}
		}
	})
}
```

After 100 failures, the circuit opens for 30 seconds, then half-open behaviour can be implemented. This is a sketch — real circuit breakers use libraries like `gobreaker` — but it shows how to layer on top of `ants`.

### Extended Example E — Submit with optional cancellation

```go
type CancellableTask struct {
	cancel chan struct{}
	work   func(<-chan struct{})
}

func (t *CancellableTask) Submit(pool *ants.Pool) error {
	return pool.Submit(func() { t.work(t.cancel) })
}

func (t *CancellableTask) Cancel() { close(t.cancel) }
```

The task watches its `cancel` channel and short-circuits if closed. Simpler than threading `context.Context` if you only need cancellation, not deadlines.

---

## Additional Coding Patterns

### Pattern 21 — Pre-checked Submit

```go
if pool.IsClosed() { return ErrServiceDown }
if err := pool.Submit(task); err != nil { return err }
```

Pre-check avoids paying the submit cost when you know the pool is dead. Optional optimisation.

### Pattern 22 — Submit-time logging

```go
func (s *Service) submit(task func()) error {
	start := time.Now()
	err := s.pool.Submit(task)
	if d := time.Since(start); d > 100*time.Millisecond {
		log.Warnf("slow submit: %v", d)
	}
	return err
}
```

If submit takes long, the pool is over-saturated. Logging exposes this.

### Pattern 23 — Tracing context propagation

```go
func submitTraced(ctx context.Context, pool *ants.Pool, name string, task func(context.Context)) error {
	ctx, span := tracer.Start(ctx, name)
	return pool.Submit(func() {
		defer span.End()
		task(ctx)
	})
}
```

OpenTelemetry context inside the task. Span ends when the task completes.

### Pattern 24 — Submit dedup

```go
type DedupPool struct {
	pool  *ants.Pool
	inflight sync.Map // key -> struct{}
}

func (d *DedupPool) Submit(key string, task func()) error {
	_, loaded := d.inflight.LoadOrStore(key, struct{}{})
	if loaded { return errors.New("duplicate") }
	return d.pool.Submit(func() {
		defer d.inflight.Delete(key)
		task()
	})
}
```

Avoid submitting the same key twice while the first is in flight. Pattern shows up in cache rehydration and request coalescing.

### Pattern 25 — Submit pinned to a worker (unsupported)

`ants` does not let you pin a task to a specific worker. If you need pinning (because of OS thread locality), you need one pool per pin and route yourself. This is rarely needed outside of GPU contexts.

### Pattern 26 — Slow-start ramp

```go
for i := 0; i < cap; i++ {
	pool.Tune(i + 1)
	time.Sleep(100 * time.Millisecond)
}
```

Ramp up pool size slowly to avoid overwhelming downstream. Useful at startup. Once warmed, leave the pool at full cap.

---

## Performance Tips (further extended)

### Tip 21 — Watch for false sharing on counter padding

If you maintain per-worker counters in adjacent memory, false sharing kills perf. Pad with `[64]byte` or `_ [56]byte`.

### Tip 22 — Profile the panic path

A common bug: panic handler is heavy and gets called from a stack that's already deep. Add `time.Now()` measurements around `panicHandler` invocation to confirm it's fast.

### Tip 23 — Test under realistic input

Synthetic benchmarks lie. Run the pool against realistic input rates and measure end-to-end latency, not pool internals.

### Tip 24 — Cap GOMAXPROCS in containers

Inside Kubernetes, `GOMAXPROCS` defaults to the host's CPU count, not the container's CPU limit. Use `uber-go/automaxprocs` or set explicitly. Wrong `GOMAXPROCS` ruins all pool perf reasoning.

### Tip 25 — Coalesce small submits

If your producer makes 10 submits in a row, all with similar data, batch them: one submit with all 10 items. Saves submit overhead.

---

## Final Test Round

### Q26
Can I have a pool of `PoolWithFunc`s?

**A.** Sure — just `ants.NewPoolWithFunc` is one type. You can have multiple instances, each with its own fixed function. Use a map or a struct.

### Q27
What happens if I `Invoke(arg)` but the worker function panics?

**A.** The panic is caught by the worker's recover. The panic handler is called. The worker continues to the next invocation.

### Q28
Does `ReleaseTimeout` interrupt the panic handler?

**A.** No. The panic handler runs inside the worker's recover. `ReleaseTimeout` waits for `Running` to drop to 0, which means waiting for the worker to finish whatever it's doing, including the handler.

### Q29
Can I implement priority pools by composing `ants.Pool`s?

**A.** Yes. Have an "urgent" pool and a "bulk" pool. Submit to urgent for high-priority work, fall back to bulk on overload. Or use a single pool and pre-sort your tasks before submitting.

### Q30
Does `Tune` notify subscribers?

**A.** No. There's no event system. You have to poll `Cap()` if you care.

---

## Final Tricky Questions

### TQ21
**Q.** My pool processes 10k req/sec. CPU profile shows `runtime.morestack_noctxt` is hot. Is this normal?

**A.** It means goroutines are growing their stacks. Each `Submit` may have a different closure body that needs more stack. Common, hard to avoid. Possible mitigation: pre-warm the pool so the workers' stacks grow once and then stay grown.

### TQ22
**Q.** I see `runtime.gcBgMarkWorker` hot. The pool is fine — what's wrong?

**A.** Heap allocations from your tasks are pressuring GC. Use `sync.Pool` for transient objects. The pool itself doesn't allocate much.

### TQ23
**Q.** Can `ants` be used in a WASM build?

**A.** Yes. `ants` doesn't depend on OS threading directly; it uses Go's runtime which works on WASM (with single-threaded scheduling). Performance characteristics differ.

### TQ24
**Q.** Multiple pools share a `*log.Logger`. Is that safe?

**A.** `log.Logger` is goroutine-safe. Multiple pools writing to it concurrently is fine.

### TQ25
**Q.** I want to dedupe submits within a short window.

**A.** Use the dedup pattern with a TTL. Or use a `singleflight.Group` (`golang.org/x/sync/singleflight`) to coalesce identical work.

---

## A Final Note on Defaults

The defaults in `ants` are good. If you've worked through this file and don't yet have a specific reason to set an option, *don't*. The mental cost of remembering "why is `WithExpiryDuration` 30 seconds here" is real. Many production code bases get into trouble by tuning every option to feel like they've done their homework.

The minimal-but-complete production pool:

```go
pool, err := ants.NewPool(size,
	ants.WithPanicHandler(panicHandler),
)
```

Add options only when you have:

- A measurement showing the default isn't good.
- A test that proves the change helps.
- A comment explaining why for the next reader.

Anything else is speculative tuning. Resist.

---


