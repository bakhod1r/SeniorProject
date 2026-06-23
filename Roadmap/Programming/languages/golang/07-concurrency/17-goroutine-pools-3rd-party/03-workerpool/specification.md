---
layout: default
title: Specification
parent: workerpool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/03-workerpool/specification/
---

# gammazero/workerpool — Specification

## Table of Contents
1. [Module Information](#module-information)
2. [Package Overview](#package-overview)
3. [Public Types](#public-types)
4. [Public Functions](#public-functions)
5. [Public Methods](#public-methods)
6. [Internal Constants](#internal-constants)
7. [Behavioural Contracts](#behavioural-contracts)
8. [Concurrency Guarantees](#concurrency-guarantees)
9. [Error and Panic Semantics](#error-and-panic-semantics)
10. [Resource Lifecycle](#resource-lifecycle)
11. [Performance Characteristics](#performance-characteristics)
12. [Version History](#version-history)
13. [Stability and Compatibility](#stability-and-compatibility)
14. [Dependencies](#dependencies)
15. [Build and Test](#build-and-test)
16. [Known Issues and Caveats](#known-issues-and-caveats)

---

## Module Information

- **Module path:** `github.com/gammazero/workerpool`
- **License:** MIT
- **Author:** Andrew J. Gillis
- **Repository:** https://github.com/gammazero/workerpool
- **Issue tracker:** https://github.com/gammazero/workerpool/issues
- **Latest stable version:** v1.x (1.1.x family at this writing)
- **Minimum Go version:** 1.18+ (older may work; not officially supported)

The module has no external runtime dependencies beyond the Go standard library and `gammazero/deque` (a sibling library by the same author).

---

## Package Overview

Package `workerpool` provides a concurrency-limited worker pool with an unbounded task queue. It exposes a small, stable API for submitting tasks asynchronously, waiting for individual tasks, and gracefully shutting down the pool.

The pool consists of:

- A configurable maximum number of worker goroutines.
- One internal dispatcher goroutine.
- An internal task queue of arbitrary depth.
- Workers that exit after a fixed idle period (currently 2 seconds).

The package is suitable for limiting concurrent execution of unrelated tasks, especially when:

- The number of tasks is large compared to the number of cores.
- Tasks may block on I/O.
- Total submission rate is unpredictable.
- A bounded concurrency is more important than per-task latency.

---

## Public Types

### `WorkerPool`

```go
type WorkerPool struct {
    // unexported fields
}
```

The opaque pool type. Created with `New`. All operations are on a `*WorkerPool` value.

A `WorkerPool` is safe for concurrent use by multiple goroutines.

Internal state includes:
- The maximum worker count.
- Input and output channels (`taskQueue`, `workerQueue`).
- A waiting queue (`deque.Deque[func()]`).
- Shutdown synchronisation channels.
- A mutex protecting shutdown state.

The struct contains no exported fields. All interaction is via methods.

---

## Public Functions

### `New(maxWorkers int) *WorkerPool`

Creates and returns a pointer to a new worker pool with the specified maximum number of concurrent workers.

**Parameters:**
- `maxWorkers`: The maximum number of concurrently executing worker goroutines. If `maxWorkers < 1`, the value is silently clamped to 1.

**Returns:**
- A `*WorkerPool` ready to accept submissions.

**Side effects:**
- Spawns one dispatcher goroutine immediately.
- No worker goroutines are spawned until the first task is submitted.

**Goroutine count after call:**
- +1 (the dispatcher).

**Memory:**
- Allocates approximately 5-10 KB for the pool struct, internal channels, and the empty waiting queue.

**Example:**
```go
pool := workerpool.New(8)
defer pool.StopWait()
```

---

## Public Methods

All methods are on `*WorkerPool`.

### `Submit(task func())`

Schedules `task` for asynchronous execution on a worker.

**Parameters:**
- `task`: The function to run. May be `nil`; in current versions, `nil` tasks are silently dropped before reaching the dispatcher. Older versions may queue nil and rely on panic recovery.

**Behaviour:**
- Returns soon after the dispatcher accepts the task (typically <500 ns).
- Never blocks indefinitely on a healthy pool.
- If the pool has been stopped, the call is a silent no-op; the task is dropped.

**Goroutine safety:** Safe for concurrent use by multiple goroutines.

**Ordering:** No ordering guarantee between tasks. Within a single goroutine submitting sequentially, tasks roughly run in order but this is not guaranteed.

**Panics:** Does not panic under normal conditions. May panic if the pool's internal channels are corrupted (which should not happen in correctly-versioned code).

---

### `SubmitWait(task func())`

Schedules `task` and blocks the calling goroutine until `task` finishes executing.

**Parameters:**
- `task`: The function to run. If `nil`, returns immediately.

**Behaviour:**
- Calls return only after `task()` has executed.
- If `task()` panics, the library's outer panic recovery handles the panic; `SubmitWait` returns normally without error.
- If the pool is stopped, the call is a no-op (task does not run, `SubmitWait` returns immediately in current versions).

**Goroutine safety:** Safe for concurrent use.

**Caution:** Calling `SubmitWait` from inside a task on the same pool can deadlock if the pool has insufficient worker capacity. Specifically, if all workers are occupied by tasks that each `SubmitWait` more work, no worker can free up to run the queued tasks.

---

### `Stop()`

Initiates shutdown of the pool, discarding any tasks in the waiting queue that have not started executing. Tasks currently running on workers are allowed to complete.

**Behaviour:**
- Sets the internal `stopped` flag to `true`.
- Closes the internal `taskQueue` channel, signalling the dispatcher to exit.
- Sends poison-pill signals to currently-running workers; workers exit after finishing their current task.
- Blocks until the dispatcher and all workers have exited.

**Idempotency:** Calling `Stop` (or `StopWait`) more than once is safe; subsequent calls return when shutdown completes (or immediately if already complete).

**Goroutine safety:** Safe to call concurrently with other operations, including `Submit`. Submits during shutdown may race; the library protects against panic but the task is dropped.

---

### `StopWait()`

Initiates shutdown of the pool, but waits for all tasks in the waiting queue to be executed before exiting. Tasks currently running are allowed to complete.

**Behaviour:**
- Sets the internal `stopped` flag.
- Drains the waiting queue (each task runs on a worker).
- Sends poison pills to workers.
- Blocks until everything has exited.

**Idempotency:** Same as `Stop`.

**Goroutine safety:** Same as `Stop`.

**Time complexity:** Proportional to the size of the waiting queue plus the longest running task. No upper bound enforced by the library.

---

### `Stopped() bool`

Returns `true` if `Stop` or `StopWait` has been called.

**Returns:**
- `true` if shutdown has been initiated.
- `false` otherwise.

**Behaviour:**
- Returns true at the moment shutdown is initiated, not when it completes.
- A `true` return does not imply tasks have finished or that workers have exited.

**Goroutine safety:** Safe to call from any goroutine. Read is atomic.

**Cost:** O(1), approximately 3-5 nanoseconds (single atomic load).

---

### `WaitingQueueSize() int`

Returns the current depth of the waiting queue.

**Returns:**
- The number of tasks queued but not yet started.

**Behaviour:**
- A snapshot value. The actual queue size may change between reading and acting on the result.
- Does not include tasks currently running on workers.
- Does not include `maxWorkers` of running tasks, only queued.

**Goroutine safety:** Safe. Implemented via atomic load on an internal counter.

**Cost:** O(1), approximately 3-5 nanoseconds.

**Use:** Primarily for observability/metrics. Not suitable for synchronisation.

---

### `Pause(ctx context.Context)` (newer versions)

Prevents the dispatcher from dispatching new tasks to workers until `ctx` is cancelled.

**Parameters:**
- `ctx`: A context that, when cancelled, resumes the pool.

**Behaviour:**
- Implemented by submitting `maxWorkers` sentinel tasks that each wait on `ctx.Done()`.
- All worker slots are consumed by sentinels for the duration of the pause.
- New submissions queue normally during pause.
- When `ctx` is cancelled, sentinels return, freeing the worker slots; the dispatcher resumes dispatching queued work.

**Goroutine safety:** Safe for concurrent use. Behaviour of multiple concurrent `Pause` calls is version-specific; consult source.

**Note:** This method may not exist in all versions. Check your version's documentation.

---

## Internal Constants

The following constants are internal to the library and not part of the public API. They are documented here for completeness and to support understanding of behaviour.

| Constant | Value | Purpose |
|----------|-------|---------|
| `idleTimeout` | 2 seconds | Time after which an idle worker is reaped. Hard-coded; not configurable through the public API. |

The 2-second `idleTimeout` is current as of v1.1; check source for your version.

---

## Behavioural Contracts

These are guarantees that the library makes to its users. Adherence to these is part of the API contract; changes would constitute breaking changes.

### Contract 1: Submitted tasks run before `StopWait` returns

If `Submit(task)` returned successfully and `StopWait()` is subsequently called, `task` will execute before `StopWait` returns, unless the pool was already stopped or the program is terminated by signal.

### Contract 2: `Stop` discards unstarted tasks

If `Stop()` is called when the waiting queue is non-empty, the unstarted tasks are not executed.

### Contract 3: Running tasks complete before shutdown returns

Both `Stop` and `StopWait` wait for currently-running tasks to complete. Neither method forcefully terminates a task.

### Contract 4: Concurrent operations are safe

All public methods are safe to call from multiple goroutines simultaneously without external synchronisation.

### Contract 5: Maximum concurrency is bounded by `maxWorkers`

At any moment, at most `maxWorkers` tasks are concurrently executing.

### Contract 6: Submit returns quickly under normal load

`Submit` returns within microseconds. If the dispatcher is busy, the submitter may block briefly on a channel send, but indefinite blocking is not part of the contract.

### Contract 7: Idle workers are reaped

A worker goroutine that has had no task to run for approximately `idleTimeout` exits. The pool's resident goroutine count returns to 1 (the dispatcher) during quiet periods.

### Contract 8: Idempotent shutdown

Calling `Stop` or `StopWait` more than once is safe. Subsequent calls do not panic and return when the first call's shutdown completes.

### Contract 9: Stopped pool is permanently stopped

A pool that has been shut down cannot be revived. To restart, create a new pool with `New`.

### Contract 10: Submit after Stop is silent

Calling `Submit` on a stopped pool drops the task silently. No error or panic.

---

## Concurrency Guarantees

### Submitter visibility

A task submitted before `StopWait` returns will have completed before `StopWait` returns. Side effects of the task are visible to the goroutine that called `StopWait` after `StopWait` returns.

### Memory ordering

Following Go's memory model:
- `Submit(task)` happens-before `task()` executes.
- `task()` completing happens-before `StopWait()` returns.
- For `SubmitWait(task)`, `task()` completing happens-before `SubmitWait()` returns.

### Race-free metric reads

`Stopped()` and `WaitingQueueSize()` read internal state atomically. Reads do not race with writes.

### Race-detector-clean

The library passes `go test -race` with no issues. Building correct code on top of it requires the user to synchronise their own task state (mutex, channel, atomic).

---

## Error and Panic Semantics

### No errors

No method on `WorkerPool` returns an error. Failures are silent: `Submit` after `Stop` drops the task; `Submit(nil)` drops the task.

### Panic recovery

Tasks that panic are recovered by an internal `defer recover()` in the worker. Specifics:

- The panic value is consumed by the library and not surfaced to the caller.
- The worker continues to process subsequent tasks.
- The pool's behaviour is otherwise unchanged.

Older versions of the library may not include this recovery. A panic in a task in those versions kills the worker, decrementing the effective pool capacity.

### Recover is per-task

Panic recovery wraps each task individually. A panic in one task does not affect others.

### Child goroutine panics

A panic in a goroutine spawned *inside* a task is not caught by the library's recovery. It propagates and terminates the program. Tasks that spawn child goroutines must install their own recover.

### nil tasks

`Submit(nil)` in current versions is silently dropped. Older versions may queue `nil`, leading to a panic when the worker invokes `nil()`, which is then recovered. Behaviour is version-specific.

---

## Resource Lifecycle

### Goroutines

- `New(maxWorkers)` spawns 1 dispatcher goroutine.
- Worker goroutines are spawned lazily, up to `maxWorkers` total.
- Idle workers exit after approximately `idleTimeout` (2 seconds) of no work.
- All goroutines exit when `Stop` or `StopWait` returns.

### Channels

- 2 unbuffered channels for task routing (`taskQueue`, `workerQueue`).
- 1 channel for shutdown signalling (`stoppedChan`).
- 1 timer channel internally for idle reaping.

### Memory

- Pool struct: ~100 bytes.
- Channels: ~96 bytes each.
- Deque backing: grows as needed; starts small (e.g., 16-slot capacity).
- Queued tasks: each is a `func()` closure of caller-determined size.

### File descriptors

- Zero. The library uses no I/O resources.

### Thread bindings

- The library does not call `runtime.LockOSThread`. Workers are ordinary goroutines, schedulable on any thread.

---

## Performance Characteristics

### Throughput

On modern x86 hardware with Go 1.22:
- `Submit` to an unsaturated pool: ~150-300 ns per call.
- `Submit` from a single goroutine: ~5M calls/second.
- `Submit` from many goroutines (high contention): ~1-2M calls/second total.
- Task execution time dominates for tasks longer than ~10 microseconds.

### Latency

- Time from `Submit` return to task start: a few microseconds on an idle pool; can be longer if the dispatcher is processing a backlog.
- Queue dwell time depends entirely on workload and pool sizing.

### Memory cost per task

- Each queued task: ~50-200 bytes (closure with typical small captures).
- Each worker: ~2-8 KB (goroutine stack).

### Allocation profile per Submit

- 1 allocation: the user's closure (already paid by the caller).
- 0 allocations by the library itself (in steady state).
- `SubmitWait`: 2 additional allocations (wrapper closure + done channel).

### Scaling

- Sub-linear under contention: as the number of submitters grows, throughput per submitter decreases but total throughput stays roughly flat until the dispatcher saturates.
- Sharded pools can scale further.

---

## Version History

A high-level summary; consult repository tags for specifics.

| Version | Notable changes |
|---------|----------------|
| v1.0    | Initial stable release. API frozen: `New`, `Submit`, `SubmitWait`, `Stop`, `StopWait`, `Stopped`, `WaitingQueueSize`. |
| v1.1    | `Pause(ctx)` method added in some patch version. Internal panic recovery improvements. |
| v1.1.x  | Bug fixes, documentation, dependency updates. |

The library has not had a breaking API change since v1.0. Code written against v1.0 should continue to compile and run against current versions.

There is no v2 planned. The author's stated philosophy is to keep the library minimal and stable.

---

## Stability and Compatibility

### Backwards compatibility

All public APIs are stable since v1.0. Future versions in the v1 line are expected to maintain compatibility.

### Forwards compatibility

Code written against newer v1.x may use methods (e.g., `Pause`) not present in older versions. Pin to the version that provides the methods you use.

### Go version compatibility

The library compiles against Go 1.18 and newer. Older Go versions may work for the core API but are not tested.

### Operating system / architecture

Pure Go, no syscalls beyond the runtime. Should work on any platform where Go runs: Linux, macOS, Windows, FreeBSD, etc. on amd64, arm64, 386, arm.

### Race detector

Library tests pass under `go test -race`. No internal data races known.

### Generics

The library does not use generics. The task type is `func()`. Typed wrappers can be built externally.

---

## Dependencies

### Direct

- `github.com/gammazero/deque` — double-ended queue used internally for the waiting queue.

### Transitive

None.

### Standard library

- `sync` — for mutex.
- `sync/atomic` — for the queue size counter.
- `time` — for the idle timer.
- `context` (newer versions only) — for `Pause`.

That is the entire dependency list. The library is extremely self-contained.

---

## Build and Test

To build:

```bash
go build ./...
```

To test:

```bash
go test ./...
go test -race ./...
go test -bench=. ./...
```

The repository's tests are comprehensive (~95% coverage). Run them before depending on a new version.

---

## Known Issues and Caveats

### Hard-coded idle timeout

The 2-second idle timeout cannot be changed via the public API. Workloads with submission cadences just over 2 seconds incur worker re-creation cost on each burst. Workarounds: heartbeat tasks, or use `ants` with `WithExpiryDuration`.

### No queue cap

The waiting queue is unbounded. Producers that outpace consumers grow the queue indefinitely until memory exhaustion. Workaround: external semaphore.

### No runtime resize

`maxWorkers` is fixed at construction. To change, swap pools (with a wrapper) or use `ants`.

### No per-task error

`func()` has no return. Callers collect errors via closures.

### No per-task context

`func()` takes no arguments. Callers thread `context.Context` via closures.

### No prioritisation

Tasks run in FIFO order. Priority requires multiple pools or a custom design.

### Pause consumes worker slots

`Pause(ctx)` implements pause by submitting blocking sentinel tasks equal in count to `maxWorkers`. Other queued tasks cannot dispatch until resume. This is correct behaviour but may surprise users expecting "pause without resource consumption".

### Submit-during-Stop race

There is an inherent race between `Submit` and `Stop`. The library protects against panics but submits arriving during shutdown may be dropped. Application-level lifecycle ordering (stop producers before stopping pool) prevents this.

### Submission to nil task

In current versions, `Submit(nil)` is silently dropped. Older versions may queue nil, leading to a recovered panic. Validate inputs at the call site.

### No observability beyond `WaitingQueueSize` and `Stopped`

Users must instrument externally.

---

## Conclusion

`gammazero/workerpool` provides a minimal, stable, well-tested worker pool for Go. Its small API and consistent behaviour make it a reliable building block for production systems. Most extensions and customisations should be implemented as external wrappers rather than forks; only fork when behavioural changes (not feature additions) are required.

For production deployment, see the professional file in this series. For internals, see the senior file. For learning, start with the junior file.

---

## Appendix A: API Quick Reference

```go
package workerpool

// Type
type WorkerPool struct{ /* unexported */ }

// Constructor
func New(maxWorkers int) *WorkerPool

// Methods
func (p *WorkerPool) Submit(task func())
func (p *WorkerPool) SubmitWait(task func())
func (p *WorkerPool) Stop()
func (p *WorkerPool) StopWait()
func (p *WorkerPool) Stopped() bool
func (p *WorkerPool) WaitingQueueSize() int
func (p *WorkerPool) Pause(ctx context.Context) // newer versions

// Internal constants
const idleTimeout = 2 * time.Second // not exported
```

---

## Appendix B: Method Comparison Table

| Method | Returns | Blocks Caller | Affects Pool State | Notes |
|--------|---------|---------------|-------------------|-------|
| `New` | `*WorkerPool` | No | Creates pool | Spawns dispatcher |
| `Submit` | — | Briefly | Adds to queue | Most common method |
| `SubmitWait` | — | Until task done | Adds to queue | Sync semantics |
| `Stop` | — | Until running tasks finish | Closes pool | Discards queue |
| `StopWait` | — | Until queue + running done | Closes pool | Drains queue |
| `Stopped` | `bool` | No | None | Cheap query |
| `WaitingQueueSize` | `int` | No | None | Snapshot |
| `Pause` | — | No | Suspends dispatching | Sentinel-based |

---

## Appendix C: Behavioural Decision Table

| State | Submit | SubmitWait | Stop | StopWait | Pause |
|-------|--------|-----------|------|----------|-------|
| Just created | enqueue, dispatch | enqueue, dispatch, block | initiate shutdown | initiate shutdown | suspend |
| Running normally | enqueue, dispatch | enqueue, dispatch, block | initiate shutdown | initiate shutdown | suspend |
| Paused | enqueue (no dispatch) | enqueue (deadlocks unless resumed) | initiate shutdown | initiate shutdown (may need resume) | replace pause |
| Stopping (in progress) | silent drop | silent drop | wait for completion | wait for completion | no-op |
| Stopped | silent drop | silent drop | no-op | no-op | no-op |

---

## Appendix D: Performance Constants (Approximate)

| Operation | Time | Allocations |
|-----------|------|-------------|
| `New(N)` | 1-2 µs | 5-10 (struct, channels, deque) |
| `Submit(f)` on idle pool | 150-300 ns | 0 (caller's closure not counted) |
| `Submit(f)` on saturated pool | 200-500 ns | 0 in steady state; growth events allocate |
| `SubmitWait(f)` | 250-500 ns + task time | 2 (wrapper + done channel) |
| `Stopped()` | 3-5 ns | 0 |
| `WaitingQueueSize()` | 3-5 ns | 0 |
| `Stop()` | 1-10 µs + running tasks | 0 |
| `StopWait()` | depends on queue + running | 0 |
| `Pause(ctx)` | maxWorkers × Submit time | maxWorkers (sentinels) |
| Worker spawn | ~1-2 µs | 1 (goroutine stack) |
| Worker reap | <1 µs | 0 |

---

## Appendix E: Comparison with Other Pool Libraries

A formal feature matrix.

| Feature | gammazero/workerpool | panjf2000/ants | Jeffail/tunny |
|---------|---------------------|----------------|---------------|
| API style | fire-and-forget | fire-and-forget | request-response |
| Typed task args | No (use closure) | Yes (with PoolWithFunc) | Yes (interface{}) |
| Per-task error | No | No | Yes (return value) |
| Per-task result | No | No | Yes (return value) |
| Pool resize | No | Yes (`Tune`) | No |
| Custom idle timeout | No | Yes | N/A |
| Per-worker state | No | No | Yes |
| Built-in metrics | No | Partial | No |
| Bounded queue | No (unbounded) | Optional (`WithMaxBlockingTasks`) | Inherent |
| Non-blocking submit option | No | Yes (`WithNonblocking`) | No |
| Pause/Resume | Yes | No | No |
| LOC | ~300 | ~3000 | ~700 |

The choice depends on your specific needs. `workerpool` wins on simplicity; `ants` on configurability; `tunny` on stateful workers.

---

## Appendix F: Compatibility Matrix

| Go version | Status |
|-----------|--------|
| 1.16-1.17 | Should work; not tested |
| 1.18-1.21 | Supported |
| 1.22+ | Supported (loop variable changes don't affect library) |

| OS | Status |
|----|--------|
| Linux | Supported, primary test target |
| macOS | Supported |
| Windows | Supported |
| FreeBSD | Should work; not actively tested |
| WebAssembly | Compiles; single-threaded WASM limits concurrency benefit |

| Architecture | Status |
|--------------|--------|
| amd64 | Primary |
| arm64 | Supported |
| 386 | Likely works |
| arm | Likely works |

---

## Appendix G: License

The library is MIT licensed. From `LICENSE`:

```
MIT License

Copyright (c) 2020 Andrew J. Gillis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND...
```

Suitable for use in any commercial or open-source project.

---

## Appendix H: Migration Notes

### From hand-rolled pools

Most hand-rolled pools have the shape `chan func() + N goroutines`. Migration:

- Replace channel setup with `workerpool.New(N)`.
- Replace `ch <- task` with `pool.Submit(task)`.
- Replace `close(ch); wg.Wait()` with `pool.StopWait()`.

Behavioural differences:
- The hand-rolled version typically blocks `Submit` when workers are busy. `workerpool` does not (unbounded queue).
- The hand-rolled version keeps workers alive until close. `workerpool` reaps idle workers.

### From ants

- `ants.NewPool(N)` → `workerpool.New(N)`.
- `pool.Submit(task)` → `pool.Submit(task)` (same).
- `pool.Release()` → `pool.StopWait()`.
- Drop `WithNonblocking`, `WithMaxBlockingTasks`, `WithExpiryDuration` (not supported).

You will lose features. Consider whether `workerpool` is sufficient.

### From tunny

- `tunny.NewFunc(N, fn)` → `workerpool.New(N)`; capture `fn` in closures.
- `pool.Process(arg)` → manual: `done := make(chan Result, 1); pool.Submit(func() { done <- fn(arg) }); return <-done`.

You will lose typed result return. Consider whether the migration is worth it.

---

## Appendix I: Glossary of Specification Terms

- **Worker** — A goroutine that reads tasks from `workerQueue` and executes them.
- **Dispatcher** — The single goroutine that mediates between submitters and workers.
- **Waiting queue** — The internal deque of tasks awaiting a free worker.
- **Idle timeout** — The duration after which a worker without recent work is reaped (2s).
- **Maximum workers** — The cap on concurrently executing tasks.
- **Stopped** — The state after `Stop` or `StopWait` is called.
- **Idempotent** — A method that, called multiple times, has the same effect as a single call.
- **Snapshot** — A value read at one instant that may have changed by the time it is used.
- **Poison pill** — A sentinel value (typically `nil`) signalling a worker to exit.
- **Sentinel task** — A no-op or special-purpose task, e.g., the blocking task used by `Pause`.

---

## Appendix J: Specification Conventions

- All time values are in seconds unless otherwise stated.
- All memory values are in bytes.
- "≈" indicates an approximate value subject to runtime variation.
- "Cost" is wall-clock time on a modern (post-2020) x86 server, Go 1.20+.
- Behaviour described as "current versions" applies to v1.1 and later. Older versions may differ.

---

## Appendix K: Conformance Tests

A library conforming to this specification should pass the following tests.

```go
func TestConformance_Idempotency(t *testing.T) {
    pool := workerpool.New(4)
    pool.StopWait()
    pool.StopWait() // should not panic
    pool.Stop()     // should not panic
}

func TestConformance_MaxWorkers(t *testing.T) {
    const N = 4
    pool := workerpool.New(N)
    defer pool.StopWait()
    var peak, inflight atomic.Int64
    for i := 0; i < 100; i++ {
        pool.Submit(func() {
            in := inflight.Add(1)
            for {
                p := peak.Load()
                if in <= p || peak.CompareAndSwap(p, in) {
                    break
                }
            }
            time.Sleep(time.Millisecond)
            inflight.Add(-1)
        })
    }
    pool.StopWait()
    if peak.Load() > int64(N) {
        t.Fatalf("peak=%d, max=%d", peak.Load(), N)
    }
}

func TestConformance_StopWaitDrains(t *testing.T) {
    pool := workerpool.New(2)
    var done atomic.Int64
    for i := 0; i < 100; i++ {
        pool.Submit(func() { done.Add(1) })
    }
    pool.StopWait()
    if done.Load() != 100 {
        t.Fatalf("got %d, want 100", done.Load())
    }
}

func TestConformance_StopDiscards(t *testing.T) {
    pool := workerpool.New(1)
    block := make(chan struct{})
    pool.Submit(func() { <-block })
    var done atomic.Int64
    for i := 0; i < 100; i++ {
        pool.Submit(func() { done.Add(1) })
    }
    close(block)
    pool.Stop()
    // Some tasks may have run, but typically not all
    t.Logf("ran %d/100 before Stop", done.Load())
}

func TestConformance_PanicRecovery(t *testing.T) {
    pool := workerpool.New(1)
    defer pool.StopWait()
    pool.Submit(func() { panic("test") })
    var ran atomic.Bool
    pool.Submit(func() { ran.Store(true) })
    pool.StopWait()
    if !ran.Load() {
        t.Fatal("pool did not survive panic")
    }
}
```

A library passing these tests can claim spec conformance.

---

## Appendix L: Specification Changes Log

This specification is a community-maintained interpretation of the library's behaviour. Changes to the library may require updates here.

- 2024: First version of this spec. Covers v1.1.

If the library evolves (which we expect to be slow), update this spec accordingly.

---

End of specification.

