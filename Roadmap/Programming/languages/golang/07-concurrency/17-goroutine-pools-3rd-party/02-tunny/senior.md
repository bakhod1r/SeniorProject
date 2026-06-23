---
layout: default
title: Senior
parent: tunny
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/02-tunny/senior/
---

# tunny — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Reading the Source — Why and How](#reading-the-source)
4. [Top-Down Tour of the Code](#top-down-tour)
5. [The `Pool` Struct](#the-pool-struct)
6. [The `workerWrapper` Struct](#the-workerwrapper-struct)
7. [The Dispatcher Loop](#the-dispatcher-loop)
8. [How `Process` Actually Works](#how-process-actually-works)
9. [How `ProcessTimed` Adds Deadlines](#how-processtimed-adds-deadlines)
10. [How `ProcessCtx` Plugs In](#how-processctx-plugs-in)
11. [How `BlockUntilReady` Slots In](#how-blockuntilready-slots-in)
12. [How `Interrupt` Is Wired](#how-interrupt-is-wired)
13. [How `Terminate` Is Invoked](#how-terminate-is-invoked)
14. [Close — The Two-Phase Shutdown](#close-the-two-phase-shutdown)
15. [SetSize — Live Resize](#setsize-live-resize)
16. [Payload Channels Explained](#payload-channels-explained)
17. [Comparison With Stdlib Worker-Pool Patterns](#comparison-with-stdlib)
18. [Comparison With ants Internals](#comparison-with-ants-internals)
19. [Comparison With workerpool Internals](#comparison-with-workerpool-internals)
20. [Where Allocations Happen](#where-allocations-happen)
21. [Race Conditions Tunny Avoids](#race-conditions-tunny-avoids)
22. [Race Conditions You Can Introduce](#race-conditions-you-can-introduce)
23. [Memory Model Considerations](#memory-model-considerations)
24. [Scheduler Interaction](#scheduler-interaction)
25. [Extending tunny in Your Own Code](#extending-tunny)
26. [Patterns the Internals Suggest](#patterns-the-internals-suggest)
27. [Best Practices Implied by the Source](#best-practices-implied)
28. [Tricky Points](#tricky-points)
29. [Tricky Questions](#tricky-questions)
30. [Cheat Sheet](#cheat-sheet)
31. [Self-Assessment Checklist](#self-assessment-checklist)
32. [Summary](#summary)
33. [Further Reading](#further-reading)
34. [Related Topics](#related-topics)
35. [Diagrams](#diagrams)

---

## Introduction
> Focus: "What does tunny actually do under the hood, and when do those internals matter to me?"

You have used `Process`, `ProcessCtx`, and the `Worker` interface in production. Now you want to understand exactly what happens between the moment you call `pool.Process(x)` and the moment you receive a result. The senior file is where we open the engine.

Tunny is small enough that you can hold the entire implementation in your head. Roughly:

- A `Pool` struct with two slices (`workers` and `workerWrappers`), a count, and a mutex.
- A `workerWrapper` type — one per worker — that drives its `Worker` through a state machine in a goroutine.
- Two channels per `workerWrapper`: a payload-in channel and a result-out channel.
- A dispatcher loop hidden inside each `workerWrapper.run` method that reads from the inbox, calls `BlockUntilReady`, calls `Process`, sends the result, and listens for interrupt/terminate signals.

That is it. There is no scheduler, no priority queue, no balancing logic — just N goroutines, each independently reading from its own channel. The pool dispatches by writing to whichever channel is currently accepting.

This file walks through the source code in detail, points out the design choices, and connects what you see in the source to behavior you observe at the API.

After reading you should:

- Be able to draw the data structures and the dispatcher loop from memory.
- Be able to predict what tunny does in any unusual scenario — concurrent Close, deeply nested ProcessCtx, factory panic.
- Be able to extend tunny safely (custom Worker wrappers, instrumentation hooks).
- Be able to compare tunny's design with `ants`, `workerpool`, and a naive hand-rolled channel pool.

---

## Prerequisites

- Comfortable with everything in [junior.md](junior.md) and [middle.md](middle.md).
- Familiar with Go's channel semantics in detail — `select`, `close`, send-on-closed (panics), receive-from-closed (zero value).
- Familiar with `sync.Mutex` and `sync.RWMutex` and the difference.
- Familiar with `sync.WaitGroup` and its `Add`/`Done`/`Wait` semantics.
- Have read the source of `sync/atomic` at least once.
- Know what a select on a nil channel does (blocks forever).
- Know the Go memory model basics — happens-before relations between channel send/receive and `Unlock`/`Lock`.

If any of these are shaky, take a detour. The senior file refers to all of them repeatedly.

---

## Reading the Source

Open `github.com/Jeffail/tunny/tunny.go` and `tunny/workerwrapper.go` in your editor side by side. The whole library is on the order of 400 lines of Go. You can read it end to end in under an hour.

We will reference its structure throughout. The exact line numbers shift across versions, but the names of types and methods are stable.

Get the source locally:

```bash
go get github.com/Jeffail/tunny
go env GOMODCACHE
# then navigate into the version's directory
```

Or just read it on GitHub. The point is to have it open while reading this file.

---

## Top-Down Tour

The library exposes:

- The `Pool` type (in `tunny.go`).
- Constructor functions: `New`, `NewFunc`, `NewCallback`.
- The `Worker` interface.
- Process methods: `Process`, `ProcessTimed`, `ProcessCtx`.
- Pool management methods: `Close`, `GetSize`, `SetSize`, `QueueLength`.
- Sentinel errors: `ErrPoolNotRunning`, `ErrJobTimedOut`.

Internally, it has:

- The `workerWrapper` type (one per worker).
- A few helper closures for `NewFunc`/`NewCallback` adapters.

That is the entire surface and the entire internal surface. There are no hidden subsystems.

---

## The Pool Struct

A simplified view of the `Pool` struct as it appears in tunny:

```go
type Pool struct {
    queuedJobs int64

    ctor      func() Worker
    workers   []*workerWrapper
    reqChan   chan workRequest

    workerMut sync.Mutex
}
```

Field walkthrough:

- `queuedJobs int64` — incremented when a caller starts to wait, decremented when the wait ends. Read by `QueueLength`. Accessed via `sync/atomic`.
- `ctor` — the factory passed to `New`. Used by `SetSize` to grow the pool.
- `workers` — a slice of `*workerWrapper`, one per slot.
- `reqChan` — the unbuffered channel that callers send to and workers receive from. The heart of the dispatcher.
- `workerMut` — guards mutations of `workers`. `Process` reads `workers` indirectly (via reqChan), so the mutex is mostly for `SetSize` and `Close`.

Critical observation: there is no per-pool state machine. The pool does not track "running vs stopped" with an enum. Its only state is in the channels — open or closed, with values pending or not. This makes the implementation small and the behaviour, while subtle, derivable from channel semantics.

A subtle consequence: there is no `IsRunning()` predicate. You cannot ask the pool whether it has been closed. You can only attempt a `Process` and observe a panic, or attempt a `ProcessTimed` and observe `ErrPoolNotRunning`.

---

## The workerWrapper Struct

Each worker is wrapped by a `workerWrapper`. Simplified:

```go
type workerWrapper struct {
    worker        Worker
    interruptChan chan struct{}
    reqChan       chan workRequest
    closeChan     chan struct{}
    closedChan    chan struct{}
}
```

And:

```go
type workRequest struct {
    jobChan       chan<- interface{}
    retChan       <-chan interface{}
    interruptFunc func()
}
```

Lots of channels. Each one has a specific job:

- `worker` — the user's `Worker` implementation.
- `interruptChan` — closed by the pool to signal "stop running, you are being killed".
- `reqChan` — the *shared* pool-level channel. Multiple workerWrappers receive from this channel. Whichever is ready first gets the request.
- `closeChan` — used to ask the wrapper to terminate (different from interrupting an in-flight job).
- `closedChan` — closed by the wrapper when it has fully terminated. The pool waits on this.

The `workRequest` is the structure that flows from the caller to the worker. It bundles three things:

- `jobChan` — the channel on which the caller has written the payload.
- `retChan` — the channel on which the caller is waiting for a result.
- `interruptFunc` — a callback the worker invokes when interrupted.

This three-channel structure is what makes `ProcessCtx` and `ProcessTimed` possible without modifying the worker dispatch.

---

## The Dispatcher Loop

The heart of tunny is `workerWrapper.run`. Its essence:

```go
func (w *workerWrapper) run() {
    defer func() {
        close(w.closedChan)
    }()
    defer w.worker.Terminate()

    for {
        w.worker.BlockUntilReady()

        select {
        case <-w.closeChan:
            return
        case req := <-w.reqChan:
            payload := <-req.jobChan
            result := w.worker.Process(payload)
            req.retChan <- result
        case <-w.interruptChan:
            // interrupted before reading a payload — ignore
        }
    }
}
```

This is the pseudocode shape. The real version has slightly more careful handling of edge cases, but this captures the structure.

Walk through it:

1. `Terminate` is deferred. Whenever the loop exits, `Terminate` runs. Followed by closing `closedChan` to signal "I have exited."
2. The outer `for` loop runs forever until something breaks it.
3. Each iteration begins with `BlockUntilReady`. The worker can block here until it is willing to accept work.
4. After `BlockUntilReady` returns, a `select` chooses between three events:
   - The pool wants the worker to terminate (`closeChan` is closed). The loop exits.
   - A caller has a request (`reqChan` has a value). The worker reads the payload, processes it, sends the result.
   - The pool sent an interrupt (`interruptChan` got a value) but the worker was not in `Process`. This event is silently consumed and the loop continues.

The third case is interesting: `interruptChan` is the pool's way of poking the worker. If the worker is currently waiting in `BlockUntilReady` or in the outer `select`, the interrupt is consumed but does nothing — the worker has no work to interrupt. If the worker is mid-`Process` when the interrupt arrives, the pool's code path goes a different way: it calls `worker.Interrupt()` directly, and the worker's `Process` may observe it. The `interruptChan` in this `select` is really for the case where an interrupt arrives just *after* a worker finished processing but before it gets to a new iteration — a small race window that this branch swallows safely.

---

## How Process Actually Works

When you call `pool.Process(payload)`, here is what happens at the line-of-source level:

```go
func (p *Pool) Process(payload interface{}) interface{} {
    atomic.AddInt64(&p.queuedJobs, 1)

    req, open := <-p.reqChan
    if !open {
        panic(ErrPoolNotRunning)
    }

    req.jobChan <- payload
    payload = <-req.retChan

    atomic.AddInt64(&p.queuedJobs, -1)
    return payload
}
```

Step by step:

1. `queuedJobs` is incremented. `QueueLength` reports this counter.
2. The caller receives a `workRequest` from the pool's `reqChan`. This unblocks when a worker has written to `reqChan` saying "I am ready." If the pool is closed, `reqChan` is closed and the receive returns `(zero, false)`, panicking.
3. The caller writes the payload to the worker's `jobChan`.
4. The caller waits on the worker's `retChan` for the result.
5. `queuedJobs` is decremented.
6. The result is returned.

Note the unusual flow: the caller does not write the payload to `reqChan`. The caller *reads* from `reqChan`. The worker is the one that wrote to `reqChan`. This inversion is what makes tunny's API synchronous from the caller's view and elegant from the worker's view.

Visually:

```
Worker (loop):
    BlockUntilReady()
    create workRequest with my jobChan/retChan
    write workRequest to pool.reqChan ─┐
                                       │
                                       ▼
Caller:
    read workRequest from pool.reqChan
    write payload to req.jobChan ─┐
                                  ▼
Worker:
    read payload from req.jobChan
    result := Process(payload)
    write result to req.retChan ─┐
                                 ▼
Caller:
    read result from req.retChan
    return
```

Three channel operations end-to-end. The worker's `jobChan` and `retChan` are created per cycle (or per worker, depending on version) — both buffered channels of size 1 typically.

---

## How ProcessTimed Adds Deadlines

`ProcessTimed` is similar to `Process` but with a `time.Timer` watching the whole thing:

```go
func (p *Pool) ProcessTimed(payload interface{}, timeout time.Duration) (interface{}, error) {
    atomic.AddInt64(&p.queuedJobs, 1)
    defer atomic.AddInt64(&p.queuedJobs, -1)

    timer := time.NewTimer(timeout)
    defer timer.Stop()

    var req workRequest
    var open bool
    select {
    case req, open = <-p.reqChan:
        if !open {
            return nil, ErrPoolNotRunning
        }
    case <-timer.C:
        return nil, ErrJobTimedOut
    }

    select {
    case req.jobChan <- payload:
    case <-timer.C:
        req.interruptFunc()
        return nil, ErrJobTimedOut
    }

    select {
    case result := <-req.retChan:
        return result, nil
    case <-timer.C:
        req.interruptFunc()
        return nil, ErrJobTimedOut
    }
}
```

Three `select` blocks, one per phase:

1. **Queue phase.** Either we get a worker or the timer fires. If the timer fires, no worker is consumed.
2. **Send phase.** Either we hand the payload off or the timer fires. If the timer fires, we invoke `interruptFunc` to let the worker know.
3. **Receive phase.** Either we get a result or the timer fires. Same interrupt path.

The `interruptFunc` is a closure created by the workerWrapper. When called, it calls `worker.Interrupt()` and signals via `interruptChan`. The worker may or may not honour the signal.

Important: the timer is a single timer for all three phases. Time spent in phase 1 reduces what is available for phases 2 and 3. So `ProcessTimed(x, 1*time.Second)` means "give me success or error within 1 second total."

---

## How ProcessCtx Plugs In

`ProcessCtx` is essentially `ProcessTimed` with a context replacing the timer:

```go
func (p *Pool) ProcessCtx(ctx context.Context, payload interface{}) (interface{}, error) {
    atomic.AddInt64(&p.queuedJobs, 1)
    defer atomic.AddInt64(&p.queuedJobs, -1)

    var req workRequest
    var open bool
    select {
    case req, open = <-p.reqChan:
        if !open {
            return nil, ErrPoolNotRunning
        }
    case <-ctx.Done():
        return nil, ctx.Err()
    }

    select {
    case req.jobChan <- payload:
    case <-ctx.Done():
        req.interruptFunc()
        return nil, ctx.Err()
    }

    select {
    case result := <-req.retChan:
        return result, nil
    case <-ctx.Done():
        req.interruptFunc()
        return nil, ctx.Err()
    }
}
```

Same structure, different cancellation source. The difference matters:

- `ProcessTimed` uses a timer that fires once at a fixed time.
- `ProcessCtx` uses `ctx.Done()`, which may fire for any reason — deadline, manual cancel, parent cancel.

This is why `ProcessCtx` is more general. In production code use it; in tests, sometimes `ProcessTimed` is simpler.

---

## How BlockUntilReady Slots In

`BlockUntilReady` is called inside the worker's loop, *before* the worker offers itself to the dispatcher. Until `BlockUntilReady` returns, the worker is not writing to `reqChan`, so callers cannot reach it.

This is the design's elegant point: the worker is the agent that decides when it is ready. The dispatcher is dumb — it just lets workers compete on `reqChan`. If a worker is not ready, it does not write. If multiple workers are ready, whichever one's send to `reqChan` is selected first wins.

There is no "is this worker ready?" query. Readiness is an in-band state expressed by being in or out of `reqChan` send.

Concretely:

- 4 workers, all in `BlockUntilReady` (suspended on a rate limiter).
- Caller arrives, does `<-reqChan`. Blocks. Nobody is sending.
- One worker's `BlockUntilReady` returns. Worker writes to `reqChan`. The send succeeds. Caller unblocks.
- The other three workers remain in `BlockUntilReady`.

This is why a long `BlockUntilReady` reduces effective pool size dynamically. If you have a slow rate limiter, your pool is "smaller than its nominal size" for periods of time.

---

## How Interrupt Is Wired

Two places where `Interrupt` may be invoked:

1. **From `ProcessTimed` / `ProcessCtx` when the deadline fires mid-`Process`.** This is `req.interruptFunc()` in the source above.
2. **From `Close`/`SetSize` when a worker is being terminated mid-`Process`.** This is internal to the pool.

`req.interruptFunc` is a closure that does:

```go
func() {
    select {
    case w.interruptChan <- struct{}{}:
    default:
    }
    w.worker.Interrupt()
}
```

Two things:

- Try to push onto `interruptChan` so the worker's outer select sees it (in case the worker has just returned from `Process` but not yet read a new request).
- Call `worker.Interrupt()` directly. This is the synchronous notification to the user's code.

Note `Interrupt` is called from the *caller's goroutine*, not the worker's. The worker is still in `Process`. The user's code must therefore be safe for concurrent access between `Process` (worker goroutine) and `Interrupt` (caller goroutine). Hence the mutexes in middle-level patterns.

A subtle issue: if the worker has already returned from `Process` and the `Interrupt` call lands a moment later, the user's `Interrupt` runs against a stale state (a `cancel` that has already been invoked, or a channel already closed). Idempotent `Interrupt` implementations handle this gracefully.

---

## How Terminate Is Invoked

`Terminate` is invoked exactly once per worker — when the worker's goroutine is about to exit. The `workerWrapper.run` method has:

```go
defer w.worker.Terminate()
```

This `defer` runs when the loop returns, which happens when:

- `Close` was called on the pool. The pool closed each worker's `closeChan`, which broke the loop.
- `SetSize` was called to shrink the pool. Excess workers had their `closeChan` closed.

In both cases, `Terminate` is the *last* thing the worker does, after any in-flight `Process` has returned.

You can rely on `Terminate` running:

- Exactly once.
- After all `Process` calls on this worker have finished.
- In the worker's goroutine.

You cannot rely on `Terminate` running:

- If the program exits without `Close` (e.g. `panic`).
- If the worker's goroutine is killed by some external means (not possible in normal Go).

---

## Close — The Two-Phase Shutdown

`Pool.Close` is more nuanced than it looks:

```go
func (p *Pool) Close() {
    p.workerMut.Lock()
    defer p.workerMut.Unlock()

    for _, w := range p.workers {
        w.stop()
    }
    for _, w := range p.workers {
        w.join()
    }
    close(p.reqChan)
    p.workers = nil
}
```

`w.stop()` and `w.join()` correspond to "ask to stop" and "wait until stopped" on the workerWrapper.

The two-phase pattern (`stop` then `join`) means all workers are asked to stop simultaneously, then we wait for each to exit. If we did it serially (stop, join, stop, join…), shutdown would be O(n * Process_duration). With the two-phase pattern it is O(max Process_duration).

Then `reqChan` is closed. After this point, any caller still in `<-reqChan` receives `(zero, false)` and panics with `ErrPoolNotRunning`.

The `workers = nil` line is mostly defensive — it releases memory.

`Close` is *not* idempotent in the canonical sense — calling it twice panics because `reqChan` is already closed. To make it idempotent, wrap it yourself with a `sync.Once`.

---

## SetSize — Live Resize

`SetSize` changes the number of workers at runtime:

```go
func (p *Pool) SetSize(n int) {
    p.workerMut.Lock()
    defer p.workerMut.Unlock()

    lWorkers := len(p.workers)
    if lWorkers == n {
        return
    }
    if lWorkers < n {
        // Spawn new workers
        for i := lWorkers; i < n; i++ {
            p.workers = append(p.workers, newWorkerWrapper(p.reqChan, p.ctor()))
        }
        return
    }
    // Shrink — ask the extras to stop
    for _, w := range p.workers[n:] {
        w.stop()
    }
    for _, w := range p.workers[n:] {
        w.join()
    }
    p.workers = p.workers[:n]
}
```

Growing:

- Construct fresh `workerWrapper` instances. Each one starts its goroutine. The new workers immediately participate in dispatch via the shared `reqChan`.

Shrinking:

- Stop the excess workers. Wait for them to finish. Trim the slice.

Implication: `SetSize` can be slow if shrinking workers are mid-`Process`. The mutex is held throughout, so concurrent calls to `Close` or another `SetSize` are serialised.

You can use `SetSize` to implement crude auto-scaling, but be careful about flapping. Most production tunny users size once at startup and never resize.

---

## Payload Channels Explained

Each `workerWrapper` has two channels involved in the round-trip:

- `jobChan` — the caller writes the payload here.
- `retChan` — the worker writes the result here.

These two channels are *per workerWrapper*, but reused across calls. Or, depending on the version, created fresh per call. The semantics are the same: one-shot from the user's perspective. Each call has one payload, one result.

Why two channels and not one (with a struct containing both directions)?

- Symmetry. Going forward and coming back are different events; separate channels make them independently observable.
- Cancellation. If the deadline fires between phase 2 and phase 3, the caller can bail out of `retChan` without affecting `jobChan`'s state.

The buffering: `jobChan` is unbuffered or size-1 depending on version; `retChan` is similar. The choice has no observable effect for the user because the protocol is strictly sequential.

---

## Comparison With Stdlib Worker-Pool Patterns

There is no "stdlib worker pool", but there are canonical patterns. The closest:

### Pattern A — `for range` over a channel of work

```go
jobs := make(chan job)
for i := 0; i < n; i++ {
    go func() {
        for j := range jobs {
            process(j)
        }
    }()
}
// produce jobs
close(jobs)
```

Differences from tunny:

- No result return. You would add a result channel.
- No cancellation per job.
- No `BlockUntilReady` hook.
- No per-worker `Terminate`.
- Submission is non-blocking once `jobs` is buffered.

This pattern is fine for many cases but is essentially the bare bones of what tunny offers.

### Pattern B — semaphore + goroutines

```go
sem := make(chan struct{}, n)
for _, j := range jobs {
    j := j
    sem <- struct{}{}
    go func() {
        defer func() { <-sem }()
        process(j)
    }()
}
```

Differences from tunny:

- One goroutine per job, not one per worker slot.
- No reuse of goroutines.
- No per-worker state.

Performance is similar for short jobs. For long-lived workers with state, tunny's worker reuse wins.

### Pattern C — `errgroup.WithContext` + manual semaphore

```go
g, ctx := errgroup.WithContext(ctx)
sem := semaphore.NewWeighted(int64(n))
for _, j := range jobs {
    j := j
    if err := sem.Acquire(ctx, 1); err != nil { break }
    g.Go(func() error {
        defer sem.Release(1)
        return process(ctx, j)
    })
}
err := g.Wait()
```

This is "rich man's tunny". You get context propagation, error aggregation, bounded concurrency. You do not get per-worker state or `BlockUntilReady`.

Use this when:

- Each job's resource needs are different (some need a DB, some need an HTTP client).
- You want error aggregation rather than per-call results.

Use tunny when:

- All jobs are the same shape.
- Per-worker state is meaningful (buffers, codecs, models).

---

## Comparison With ants Internals

`ants` (`panjf2000/ants`) takes a very different approach. Key differences:

1. **Dynamic pool.** ants can grow up to a configured maximum, and shrink when workers are idle. tunny is fixed-size unless you call `SetSize`.
2. **Closure-on-submit.** ants takes a closure when you `Submit(f)`. tunny takes a payload to a pre-defined `Process`.
3. **Pre-spawned vs lazy.** ants can pre-spawn or grow on demand. tunny pre-spawns all workers.
4. **Object pool for workers.** ants uses a `sync.Pool`-like recycling for worker goroutines to handle the dynamic case. tunny does not — workers are static.

Internals snapshot of ants:

- A wrapping `pool` struct with a `goWorkerCache *sync.Pool` and `workers workerArray`.
- `Submit(task)` either picks a free worker from `workers` or constructs a new one (up to capacity).
- Workers are returned to the cache when idle.
- Idle workers can be reaped after a configurable interval.

Differences in spirit:

- ants is closer in shape to a Java `ThreadPoolExecutor` with core/max sizing and idle reaping.
- tunny is closer to a "fixed bank of long-lived agents" — more like a worker pool of Erlang processes.

Neither is "better". They serve different workloads. ants for spiky, heterogeneous, mostly-IO tasks. tunny for steady-state CPU-bound with stateful workers.

---

## Comparison With workerpool Internals

`gammazero/workerpool` is even simpler:

```go
pool := workerpool.New(n)
pool.Submit(func() { ... })
pool.StopWait()
```

Submission is non-blocking unless the pool's internal queue is also bounded (it is, but large). The queue is `chan func()` of some default size.

Internals:

- A `WorkerPool` struct with a task channel and a max workers count.
- Workers are spawned lazily as tasks queue up, up to the max.
- Idle workers are reaped.

Differences from tunny:

- workerpool is "submit a closure" style — like ants but simpler.
- workerpool has no per-worker state.
- workerpool's submission can block if its queue fills (rare, but possible).

If you want stdlib-feel goroutine reuse with a `func()` API, workerpool is the cleanest choice. If you want stateful workers, tunny.

---

## Where Allocations Happen

Profiling tunny code, the typical allocation sites are:

1. **Per call: `Process(payload any)`.** The `any` boxing may allocate if `payload` is not interface-friendly (struct types, basic types in some Go versions).
2. **Per call: result interface boxing.** Same reason.
3. **Per call: timer for `ProcessTimed`.** `time.NewTimer` allocates a `Timer` struct.
4. **Per pool construction: `workers` slice.** Once.
5. **Per worker construction: the `workerWrapper`.** Once per worker.

Things that do *not* allocate per call (in normal use):

- The `workRequest`. Re-used or stack-allocated.
- The worker's `jobChan` and `retChan`. Created once.

If you want a zero-allocation pool, you must:

- Use a payload type that does not box (e.g. small fixed-size).
- Avoid `ProcessTimed` (or pool the timer yourself).

For most workloads, the per-call allocations are negligible compared to the work itself. But for sub-microsecond workloads, they may dominate.

---

## Race Conditions Tunny Avoids

Tunny is designed to be race-free. The race detector should be silent under normal use. Specifically:

- `Process` is safe to call from any number of goroutines.
- The dispatcher uses channels (atomic by nature) rather than shared variables.
- `queuedJobs` is touched only via `sync/atomic`.
- `workers` slice is mutated only under `workerMut`.

You can verify with:

```bash
go test -race ./...
```

The race detector hooks into channel ops and atomic ops, so any unintentional shared-memory access would be caught.

---

## Race Conditions You Can Introduce

While tunny is race-free, *you* can introduce races in the worker function. The most common:

### Race 1 — worker function reads/writes a package-level variable

```go
var counter int

pool := tunny.NewFunc(8, func(p any) any {
    counter++ // RACE
    return counter
})
```

Eight workers, eight goroutines, all hitting `counter` without synchronization.

Fix: use `atomic.Int64`.

### Race 2 — `Interrupt` reads state `Process` writes

Already covered in middle.md. Always synchronize between methods.

### Race 3 — sharing a `*bytes.Buffer` across workers

```go
shared := &bytes.Buffer{}
pool := tunny.New(8, func() tunny.Worker {
    return &w{buf: shared} // all workers share `shared`
})
```

Eight workers all writing to one buffer. Race. Fix: per-worker buffer.

### Race 4 — closure capturing a loop variable

```go
for _, x := range items {
    go func() {
        pool.Process(x) // captures loop variable
    }()
}
```

Classic Go bug. Fix: `x := x` before the goroutine.

The race detector catches all of these.

---

## Memory Model Considerations

A channel send happens-before the matching receive. So:

- The caller's writes to the payload happen-before the worker's reads from the payload (because send-then-receive on `jobChan`).
- The worker's writes to the result happen-before the caller's reads (because send-then-receive on `retChan`).

You do not need extra synchronization on the payload or result. Tunny's channels provide the memory ordering for free.

This is one of the unsung values of channel-based concurrency: visibility is automatic. Compare to a hand-rolled "set a shared variable then signal a condition variable" pattern, where you must be careful about memory orderings.

---

## Scheduler Interaction

Tunny's worker goroutines are ordinary goroutines. The Go scheduler treats them like any other. A few interactions worth understanding:

### Sysmon and preemption

A worker in a tight loop without function calls used to be uninterruptable. Since Go 1.14, async preemption catches these cases. So a worker that does `for { x++ }` will not freeze the scheduler. But the worker will not exit — async preemption just lets other goroutines run.

### `runtime.LockOSThread`

If a worker calls `runtime.LockOSThread`, it pins itself to an OS thread for the duration. The pinning is per-goroutine, not per-worker. If you `Lock` in one `Process` and forget to `Unlock` before returning, the goroutine remains pinned, which can subtly affect future `Process` calls.

Always `defer runtime.UnlockOSThread()` if you must lock.

### GOMAXPROCS

The worker goroutines are subject to `GOMAXPROCS`. A pool of 8 workers on `GOMAXPROCS=2` will have only 2 running at any time. The pool *size* and the *parallelism* are not the same.

For CPU-bound work, choose pool size ≤ `GOMAXPROCS`. Anything more is gratuitous goroutines.

### Cgo

A cgo call temporarily increases the thread count. If many workers do cgo calls simultaneously, the OS thread count grows. Tunny doesn't help or hinder this; it is just a side effect of cgo + many goroutines.

---

## Extending tunny in Your Own Code

Tunny is small. Most extensions are easier than you think.

### Extension 1 — instrumentation wrapper

```go
type instrumentedWorker struct {
    inner   tunny.Worker
    metrics MetricsClient
}

func (w *instrumentedWorker) Process(p any) any {
    timer := w.metrics.StartTimer("process")
    defer timer.Stop()
    return w.inner.Process(p)
}
func (w *instrumentedWorker) BlockUntilReady() {
    w.metrics.StartTimer("block").Stop() // ... not great but illustrative
    w.inner.BlockUntilReady()
}
func (w *instrumentedWorker) Interrupt()  { w.inner.Interrupt() }
func (w *instrumentedWorker) Terminate()  { w.inner.Terminate() }

pool := tunny.New(n, func() tunny.Worker {
    return &instrumentedWorker{inner: newRealWorker(), metrics: m}
})
```

A decorator that adds metrics without touching the inner type. Composes cleanly.

### Extension 2 — typed generic wrapper

We saw `Pool[In, Out]` in middle.md. That is the recommended core extension.

### Extension 3 — priority pool

Build two pools, route by priority. We saw this in middle.md.

### Extension 4 — custom dispatch policy

If you want anything other than "first available worker", you must build a layer in front of tunny. Tunny's dispatch is channel-based and offers no hooks.

E.g. "least-loaded worker first":

```go
type LeastLoadedPool struct {
    pools []*tunny.Pool
    loads []*atomic.Int64
}

func (p *LeastLoadedPool) Process(payload any) any {
    minIdx := 0
    minLoad := p.loads[0].Load()
    for i := 1; i < len(p.pools); i++ {
        if l := p.loads[i].Load(); l < minLoad {
            minIdx = i
            minLoad = l
        }
    }
    p.loads[minIdx].Add(1)
    defer p.loads[minIdx].Add(-1)
    return p.pools[minIdx].Process(payload)
}
```

Many tiny pools, one per worker, you dispatch yourself. Loses some of tunny's elegance but lets you implement custom policies.

### Extension 5 — replay journal

Persist payloads to disk before submission, so you can replay if the process crashes. This is a real production pattern for tasks that take minutes to hours.

```go
func (p *DurablePool) Process(payload any) any {
    p.journal.Append(payload)
    defer p.journal.Mark(payload, "done")
    return p.inner.Process(payload)
}
```

The journal is *outside* tunny — tunny does not know about durability. Build it yourself.

---

## Patterns the Internals Suggest

A few patterns become obvious once you understand the internals.

### Pattern: leverage `BlockUntilReady` for fair queues

If different workers represent different priorities, give the high-priority workers a quicker `BlockUntilReady` so they win the race to `reqChan`. Crude but effective.

### Pattern: many small pools instead of one big

Because dispatch is "first-ready-wins", having distinct pools per resource class avoids head-of-line blocking. A slow worker in pool A does not affect callers in pool B.

### Pattern: instrument at the workerWrapper level, not the inner Worker

If you wrap `Worker`, you intercept exactly what tunny calls. You see real `Process` durations, real `BlockUntilReady` waits, real `Interrupt` events. The inner type is unaware.

### Pattern: design `Process` to be short and pure

Long `Process` blocks the worker. Pure `Process` makes testing easy. Side-effectful `Process` complicates observability. Where possible, push side effects (logging, metrics) to the wrapper layer.

---

## Best Practices Implied by the Source

Some practices fall out naturally once you understand the internals:

1. **Always `defer Close`.** You leak goroutines otherwise — confirmed by the source: workers run until `closeChan` is closed.
2. **Make `Interrupt` idempotent.** The source may call it after `Process` returns; idempotency is required for correctness.
3. **Do not capture the `*tunny.Pool` inside the worker.** The worker should be self-contained. Capturing the pool risks recursive calls and deadlock.
4. **Keep `BlockUntilReady` predictable.** Long, irregular `BlockUntilReady` distorts your effective pool size.
5. **Treat `workerWrapper.run` as the authoritative state machine.** Any extension that claims to control worker lifecycle must respect this loop's order.

---

## Tricky Points

### Tricky 1 — `Close` does not interrupt in-flight `Process`

`Close` waits for in-flight `Process` to finish. It does *not* interrupt them. If your worker is mid-`Process` doing a 10-minute compute, `Close` will block for 10 minutes.

If you need fast shutdown, send interrupts to all workers before calling `Close`:

```go
for _, w := range p.workers {
    w.worker.Interrupt() // but the source doesn't expose this directly
}
```

You cannot do this through tunny's API — `workers` is not exposed. Workaround: store a slice of your own workers and interrupt them yourself before `Close`.

### Tricky 2 — `ProcessTimed` and `BlockUntilReady` interaction

A worker that is in `BlockUntilReady` is not registered to receive a payload. If a `ProcessTimed` caller's timer fires while no worker is ready, the caller exits cleanly with `ErrJobTimedOut`. No worker is interrupted because none was assigned. Your `Interrupt` method is not called. This is correct behaviour, but it can be confusing: a metric for "Interrupts" will show fewer than "timeouts" because many timeouts never reach a worker.

### Tricky 3 — `interruptFunc` racing with `Process` returning

If `Process` is about to return at the same moment `interruptFunc` is called, you have a race window. The caller will get the timeout error; the worker's return value is discarded.

What about the worker's state? If `Process` set `w.cancel = nil` *before* `interruptFunc` reads it, `Interrupt` is a no-op. If `Process` is reading from `w.cancel` while `interruptFunc` writes, that is a race — protect with mutex.

In production, treat `Interrupt` as fire-and-forget. Do not rely on it doing anything observable.

### Tricky 4 — `SetSize` does not affect in-flight calls

If you have 8 workers, 4 are processing, you call `SetSize(2)` to shrink. Tunny stops 6 workers — but workers 1 through 4 are currently busy. Tunny waits for them to finish *current Process*, *then* terminates them. So `SetSize(2)` is asynchronous in this sense. From the caller perspective the size is 2 immediately; from the dispatch perspective the effective concurrency catches up later.

### Tricky 5 — closed `reqChan` panic

If you call `Process` after `Close`, you panic. The exact panic message depends on Go version but it is one of:

```
panic: send on closed channel
panic: receive from closed channel (... actually returns false ...)
```

Real tunny: receive from closed `reqChan` returns `(zero, false)`. The library detects this and panics with `ErrPoolNotRunning`. So the panic message is `ErrPoolNotRunning`, not the raw channel-closed message. Verify with:

```go
defer func() {
    fmt.Println(recover())
}()
pool.Close()
pool.Process(nil)
```

Output approximately: `tunny pool is not running`.

---

## Tricky Questions

**Q1.** Two callers call `Process` simultaneously. The pool has 1 worker. What is the order of dispatch?

**A1.** Whichever caller's `<-reqChan` is selected first by the runtime. The order is *not* arrival order — Go does not promise FIFO on channel receives. It is approximately fair under typical workloads, but not strictly so.

**Q2.** A `ProcessCtx` deadline fires. `Interrupt` is called. The worker's `Process` ignores the interrupt and runs for another minute. What is the state of the pool during that minute?

**A2.** The worker is unavailable. The pool's effective size has dropped by 1. After the minute, the worker returns, the result is discarded, the worker re-enters `BlockUntilReady` and becomes available again.

**Q3.** `Close` runs concurrently with `Process` on the same pool. Possible outcomes?

**A3.** Race. Possible outcomes:

- `Process` completes before `Close` reaches it — fine.
- `Process` is mid-channel-op when `Close` closes channels — panic.
- `Process` reads from `reqChan` after `Close` — returns `(zero, false)` → panic with `ErrPoolNotRunning`.

Always coordinate `Close` with the lifecycle of `Process`-calling goroutines.

**Q4.** Why does `Process` not return an `error`?

**A4.** Design choice — `Process` is the simplest API. Errors are encoded in the result. `ProcessTimed`/`ProcessCtx` return errors because timeouts/cancellations are distinct from "the work failed".

**Q5.** Could tunny implement `Process` with `error` return as `(any, error)` always? What would change?

**A5.** It could, but the simple case becomes more verbose. The library chose to keep `Process` simple. The cost is the awkward distinction between `Process` (no error) and `ProcessTimed`/`ProcessCtx` (error).

**Q6.** What is the lifecycle of `req.jobChan` — is it reused across calls?

**A6.** In current tunny, `jobChan` and `retChan` are owned by the workerWrapper and are channels created with size 1, persisting across calls. Each cycle of the worker loop sends a fresh `workRequest` containing these channels (closed over from the workerWrapper) to `reqChan`. The caller reads, sends payload, reads result.

**Q7.** What happens if the worker panics in `Process` — does the worker goroutine die?

**A7.** A panic in `Process` propagates up to `workerWrapper.run`. If the panic is unrecovered, the whole program crashes (panics in goroutines kill the process). Tunny does not insert a recover, so always handle panics inside your worker.

If you want defensive behaviour, write a wrapper:

```go
type panicSafeWorker struct {
    inner tunny.Worker
}

func (w *panicSafeWorker) Process(p any) (out any) {
    defer func() {
        if r := recover(); r != nil {
            out = fmt.Errorf("panic in worker: %v", r)
        }
    }()
    return w.inner.Process(p)
}
// other methods delegate to inner
```

This catches the panic before tunny would have crashed.

**Q8.** Is the worker's `Process` re-entrant? Can it call `pool.Process` on the same pool?

**A8.** Re-entrant in the sense that Go allows it — but you can deadlock. If all other workers are also busy and call back into the pool, no one is available to serve. Forbidden in practice.

**Q9.** Why does tunny use buffered vs unbuffered channels?

**A9.** Mostly unbuffered. The dispatch is rendezvous-style. The exception is the small buffers on `jobChan`/`retChan` so that the worker can send-then-receive in the natural order without blocking on the channel itself. The channel buffer is small because the protocol is strictly sequential.

**Q10.** Could you build tunny on top of `sync.Cond` instead of channels?

**A10.** In principle, yes. The result would be uglier — `sync.Cond` requires explicit signal/broadcast and explicit mutex. Channels give you select for free, which is what `ProcessTimed` and `ProcessCtx` need.

---

## Cheat Sheet

```text
Types:
  Pool                 - the public type
  workerWrapper        - internal, one per worker
  workRequest          - internal, one per call

Channels per workerWrapper:
  closeChan            - "stop now"
  closedChan           - "I have stopped"
  interruptChan        - "stop your current Process"
  reqChan              - "I am ready" (write here for dispatch)

Per-call channels (via workRequest):
  jobChan              - payload from caller to worker
  retChan              - result from worker to caller

Worker loop:
  loop {
    BlockUntilReady()
    select { closeChan -> exit; reqChan <- request -> serve; interruptChan -> ignore }
    on serve:
      jobChan -> payload
      Process(payload)
      retChan <- result
  }

Process flow:
  <-reqChan (get worker)
  jobChan <- payload
  retChan -> result

ProcessTimed/ProcessCtx flow:
  three select blocks, one per phase, each with deadline branch
  on timeout: interruptFunc() called

Close:
  close each workerWrapper.closeChan
  wait for each workerWrapper.closedChan
  close pool.reqChan
```

---

## Self-Assessment Checklist

- [ ] Can draw the `Pool` and `workerWrapper` data structures.
- [ ] Can recite the dispatcher loop pseudocode.
- [ ] Can explain why dispatch is via worker-writes-to-channel, not pool-writes-to-channel.
- [ ] Can predict what `ProcessTimed` does in each of three phases.
- [ ] Can name three races you can introduce despite tunny being race-free.
- [ ] Can describe the lifecycle of a worker from `ctor` to `Terminate`.
- [ ] Can compare tunny's design with `ants` and `workerpool`.
- [ ] Can write a wrapper Worker that adds metrics around `Process` and `BlockUntilReady`.

---

## Summary

- Tunny is a small library. Its core is `workerWrapper.run`, a goroutine loop with one `select` block.
- Dispatch is inverted: workers write to `reqChan` saying "I am ready"; callers read from it to discover an available worker.
- Per-call payload and result flow through small per-call channels.
- `ProcessTimed` and `ProcessCtx` wrap each phase in a `select` with a deadline branch.
- `Interrupt` is sent from the caller's goroutine to the worker; the worker must synchronize internally if it reads shared state.
- `Close` is a two-phase shutdown: stop all, then join all.
- Allocations are mostly per-call interface boxing and `time.Timer` (for `ProcessTimed`).
- Tunny does not catch worker panics — wrap your worker if you cannot trust it.
- The library composes well with `rate.Limiter`, `context.Context`, `errgroup`, `sync.Pool`, and `slog`.

---

## Further Reading

- The tunny source. Read it twice: once after junior level, once after senior level. Different things stand out.
- The Go memory model document.
- "Channels Reading" — explanations of `select` semantics in detail.
- The source of `panjf2000/ants` and `gammazero/workerpool` for contrast.
- Articles on "worker pool patterns in Go" — there are many; tunny's is one of several valid shapes.

---

## Related Topics

- **Junior tunny** and **middle tunny** — the API levels this file builds on.
- **Professional tunny** ([professional.md](professional.md)) — production deployment patterns informed by what you know now.
- **Channels deep dive** ([../../02-channels/](../../02-channels/)) — the foundation.
- **`sync.WaitGroup`** ([../../03-sync-package/](../../03-sync-package/)) — used inside `Close`.
- **GMP scheduler** ([../../01-goroutines/](../../01-goroutines/professional/)) — what runs the workers.

---

## Diagrams

### Diagram 1 — Pool data structure

```
+---------------------------------------+
|              Pool                      |
|  queuedJobs    int64                   |
|  ctor          func() Worker            |
|  workers       []*workerWrapper        |
|  reqChan       chan workRequest        |
|  workerMut     sync.Mutex              |
+---------------------------------------+
              │
              ├─> []*workerWrapper of length n
              │       │
              │       ├─ workerWrapper #0 (goroutine)
              │       ├─ workerWrapper #1 (goroutine)
              │       └─ ...
              │
              └─> reqChan: shared by all workerWrappers
                  workers WRITE to it ("I am ready")
                  callers READ from it ("give me a worker")
```

### Diagram 2 — workerWrapper.run loop

```
┌─────────────────────────────────┐
│         workerWrapper.run        │
└───────────┬─────────────────────┘
            │
            ▼
   ┌─────────────────────┐
   │ BlockUntilReady()    │
   └─────────┬───────────┘
             │
             ▼
   ┌──────────────────────────────┐
   │ select {                      │
   │   case <-closeChan: exit      │
   │   case reqChan <- req:        │
   │       <-jobChan -> payload    │
   │       Process(payload)        │
   │       retChan <- result       │
   │   case <-interruptChan: ignore│
   │ }                              │
   └─────────┬───────────┬─────────┘
             │           │
             │       (other)
             ▼
       (back to top)
```

### Diagram 3 — Process call timing

```
time ─────────────────────────────────────▶

Caller A:        |--wait--|--send--|--wait--|--ret--|
Worker W:        |--ready|--get--|---Process---|--push--|
                          ^      ^             ^      ^
                       reqChan jobChan      Process retChan

Caller B (later):                              |--wait--|...
```

### Diagram 4 — ProcessTimed phases

```
phase 1: wait for a worker (queue)
   start ───────────────── timer ────────────── deadline
   waiting on reqChan...
   either: get worker, proceed to phase 2
       or: deadline fires, return ErrJobTimedOut

phase 2: send the payload (handoff)
   waiting on req.jobChan <- payload
   either: send succeeds, proceed to phase 3
       or: deadline fires, call interruptFunc, return ErrJobTimedOut

phase 3: wait for the result (work)
   waiting on <-req.retChan
   either: result arrives, return (result, nil)
       or: deadline fires, call interruptFunc, return ErrJobTimedOut
```

### Diagram 5 — Comparison of dispatch models

```
tunny model (worker-pull):

       reqChan: <─ W1 (writes "I am ready")
                  <─ W2 (writes "I am ready")
                  <─ W3 (writes "I am ready")
       caller:  ── reads, picks one


closure-on-submit model (e.g. ants):

       taskChan: <── caller submits closure
                  <── caller submits closure
       worker:   ── reads, executes


tunny inverts the usual flow. Callers don't push tasks
into a shared queue; workers offer themselves. Same channel,
different semantics.
```

These five diagrams cover every internal aspect of tunny worth understanding. Keep them in mind when reading the source.

---

## Extended Internal Investigation — Stepping Through With a Debugger

To really cement understanding, run the following minimal program under `dlv`:

```go
package main

import (
    "fmt"

    "github.com/Jeffail/tunny"
)

func main() {
    pool := tunny.NewFunc(2, func(p any) any {
        return p.(int) * 2
    })
    defer pool.Close()
    fmt.Println(pool.Process(7))
}
```

Set breakpoints in `tunny.go` at:

- The top of `New` (constructor).
- The top of `Pool.Process`.
- The top of `workerWrapper.run`.
- The top of `Pool.Close`.

Step through. Observe:

1. `New` runs `ctor` twice. Two `workerWrapper` instances exist.
2. Each `workerWrapper` is started with `go w.run()`. Two goroutines now exist (plus main).
3. Each `run` reaches the `select`. Both are blocking on `reqChan`'s send.
4. `Process(7)` enters. The caller reads from `reqChan`. One of the two waiting workers wins and is now "in-flight".
5. The caller writes 7 to `req.jobChan`. The worker reads.
6. The worker calls `Process` (which doubles 7 to 14). The result is written to `retChan`.
7. The caller reads 14 from `retChan` and returns.
8. The winning worker's `run` loops back to `BlockUntilReady` and the `select`.
9. `defer pool.Close()` fires. Both workers' `closeChan` is closed. Both `run` loops exit. Both `Terminate` runs.

Doing this once with a debugger crystallises the model.

---

## Final Note on the Senior Level

You now understand tunny at the level of the maintainer. You can:

- Read the source and predict every behavior.
- Spot edge cases in production logs by translating symptoms to internal mechanisms.
- Extend tunny without forking it — via wrappers and adapter types.
- Compare tunny to alternatives with depth, not surface impressions.

The professional file builds on this with production deployment patterns — observability, graceful shutdown, integration with HTTP frameworks, case studies. The technical knowledge is established. The professional level is about *operating* tunny under real production conditions: capacity planning, monitoring, incident response.

Take a break, write a small experiment that touches the internals, then read on.

---

## Deep Dive — Channel Semantics Used by Tunny

To understand tunny's source, you must understand Go channel semantics at a level beyond "send and receive". Some of these are subtle and used in clever ways.

### Send on a closed channel

A send on a closed channel panics. Tunny relies on this to detect double-close:

```go
close(p.reqChan)
close(p.reqChan) // panic: close of closed channel
```

It also affects callers: a `Process` call running concurrently with `Close` may panic with "send on closed channel" if the timing is wrong. Tunny detects this in the receive direction (closed channel returns `(zero, false)`) and reports `ErrPoolNotRunning`.

### Receive from a closed channel

Receive from a closed channel returns the zero value of the channel's element type and `false` for the two-value receive form. Tunny's `Process` uses this:

```go
req, open := <-p.reqChan
if !open {
    panic(ErrPoolNotRunning)
}
```

The `open` flag is `true` if the channel is still open and an actual value was received, `false` if the channel was closed and the zero value was returned.

### Select with multiple ready channels

`select` chooses pseudo-randomly among multiple ready channels. Tunny relies on this for fairness: when multiple workers are ready and a caller arrives, no worker is privileged.

If you need FIFO, you must implement it yourself — `select` does not give you that.

### Select with `nil` channels

A `nil` channel in a `select` case is never selected. This is used in some libraries to dynamically disable a branch:

```go
var ch chan int = nil
select {
case <-ch: // never fires
case <-other: // always candidate
}
```

Tunny does not use this trick, but it is good to know when reading other channel-heavy code.

### Buffered vs unbuffered for the dispatcher

Tunny's `reqChan` is unbuffered. This means a worker's send blocks until a caller receives. The rendezvous semantics ensure that:

- A worker is not "lost" — there is exactly one caller paired with each worker.
- A caller is not "lost" — there is exactly one worker paired with each request.

If `reqChan` were buffered, a worker could write to it and immediately loop back to `BlockUntilReady`. Then if no caller arrived, the worker would write again. The buffer would grow unboundedly. So unbuffered is correct.

### Per-call channel ownership

The `jobChan` and `retChan` are owned by the worker. They are created during worker construction and reused across calls. The worker's send to `reqChan` includes pointers to its `jobChan` and `retChan`, so the caller knows where to send the payload and where to listen for the result.

This is a subtle but important detail: the worker is the "active" party. The pool does not own the per-call channels; the workers do.

---

## Deep Dive — Why Tunny Doesn't Use sync.Mutex Much

Read the tunny source and you will see `sync.Mutex` used sparingly. Mostly only `workerMut` in `Pool` for mutating `workers`. Why?

Because tunny is built around channels, and channels are the synchronization primitive. A send-and-receive pair on a channel provides a happens-before relation in the Go memory model — equivalent to releasing and acquiring a mutex, but cheaper in some cases and more expressive (you can `select`).

When you read the tunny source, treat each channel send/receive as a synchronization point. The "lock" is the channel; the "guarded data" is whatever was written before the send.

Compare to a hand-rolled pool using mutexes — you would have a `sync.Mutex` around a slice of available workers, with `Lock` / `Unlock` calls. More verbose, less expressive, similar performance.

---

## Deep Dive — How the Three Constructor Functions Relate

`tunny.NewFunc`, `tunny.NewCallback`, and `tunny.New` are not separate code paths — they are layered.

`tunny.NewFunc` is implemented as:

```go
func NewFunc(n int, f func(interface{}) interface{}) *Pool {
    return New(n, func() Worker {
        return &closureWorker{processor: f}
    })
}

type closureWorker struct {
    processor func(interface{}) interface{}
}

func (w *closureWorker) Process(payload interface{}) interface{} {
    return w.processor(payload)
}
func (w *closureWorker) BlockUntilReady() {}
func (w *closureWorker) Interrupt()       {}
func (w *closureWorker) Terminate()       {}
```

Same for `NewCallback`:

```go
func NewCallback(n int) *Pool {
    return New(n, func() Worker {
        return &callbackWorker{}
    })
}

type callbackWorker struct{}

func (w *callbackWorker) Process(payload interface{}) interface{} {
    f, ok := payload.(func())
    if !ok {
        return nil
    }
    f()
    return nil
}
func (w *callbackWorker) BlockUntilReady() {}
func (w *callbackWorker) Interrupt()       {}
func (w *callbackWorker) Terminate()       {}
```

So:

- `NewFunc` = `New` + an adapter that wraps a closure.
- `NewCallback` = `New` + an adapter that treats the payload as a closure.
- `New` is the only "real" constructor.

This confirms our advice: when you need anything more than the bare adapter, use `New`. The other two are conveniences.

---

## Deep Dive — Worker Goroutine Stacks

When tunny starts `n` worker goroutines, each one gets its own stack. Goroutine stacks in Go start at ~2 KB and grow as needed. A worker that just loops on the dispatcher uses a tiny stack — single-digit KB.

But: a worker that calls a deep recursive function inside `Process` can grow its stack to whatever size it needs. The stack does not shrink between calls (in current Go). So if your worker once called a function that recursed 1000 frames, the worker holds that stack memory forever.

Implication: if your `Process` has wildly varying stack depth, your workers may end up with much larger stacks than typical. To estimate worst-case memory, multiply `n_workers * max_stack_depth`.

For most workloads this is negligible. For workers that occasionally do deep recursion (image processing libraries with recursive algorithms, JSON decoders with very nested objects), it can matter.

---

## Deep Dive — `time.Timer` Semantics in `ProcessTimed`

`ProcessTimed` uses `time.NewTimer` to enforce the deadline. The timer fires once at the specified time. The implementation:

```go
timer := time.NewTimer(timeout)
defer timer.Stop()
```

`timer.Stop()` is important: it cancels the timer and ensures the timer's goroutine is reclaimed. If you do not `Stop` a timer, it may still fire and consume resources (though Go's runtime handles this gracefully).

The `<-timer.C` channel is the fire signal. The timer's goroutine writes to `timer.C` when the duration elapses.

A subtle point: if the timer has already fired and `timer.C` has a value pending, `Stop` returns `false` (it could not stop because it was already fired). In that case you may want to drain `timer.C`:

```go
if !timer.Stop() {
    <-timer.C
}
```

Tunny does not drain. That is fine because the timer's value is small and gets GC'd; the channel is per-call.

---

## Deep Dive — Context Cancellation Propagation

`context.Context`'s `Done()` channel is closed when the context is cancelled. Receiving from a closed channel returns immediately with the zero value. `ctx.Err()` returns either `context.Canceled` or `context.DeadlineExceeded`.

In `ProcessCtx`, the select branches on `<-ctx.Done()`:

```go
select {
case ...:
case <-ctx.Done():
    req.interruptFunc()
    return nil, ctx.Err()
}
```

`req.interruptFunc()` is the closure tunny built. It does the work of sending the interrupt signal to the worker.

`ctx.Err()` is returned so the caller can distinguish:

- `context.DeadlineExceeded` — the context's deadline elapsed.
- `context.Canceled` — the context was explicitly cancelled.

If you set a deadline shorter than your `time.Now()` (i.e. already expired), `ctx.Done()` is closed immediately. `ProcessCtx` would return error without ever submitting work. This is correct behaviour.

---

## Deep Dive — Worker Replacement Semantics

What if you build a new pool with the same `ctor` after closing an old one? Are the workers reused?

No. Tunny does not pool the `Worker` instances across pools. Each `tunny.New` call constructs fresh workers. The `closeChan` and `closedChan` are also fresh per worker.

This is "clean state" at the cost of repeated construction. If your factory is expensive, do not create and destroy pools — keep them around.

If you need to reset state on existing workers (e.g. flush caches), you must expose a method on your `Worker` type and call it manually. Tunny does not have a `Reset` hook on the interface.

---

## Deep Dive — How `QueueLength` Compares to Other Metrics

`Pool.QueueLength` returns `atomic.LoadInt64(&p.queuedJobs)`. This is the number of callers currently in `Process` (or `ProcessTimed`/`ProcessCtx`), regardless of phase.

This is *not* the same as:

- The number of pending payloads in a queue (there is no queue per se).
- The number of running `Process` invocations (some callers may still be in queue).

What `QueueLength` actually measures: how many concurrent callers are currently using the pool. If your pool size is `n` and `QueueLength` is `m`:

- If `m <= n`: every caller has a worker.
- If `m > n`: `n` callers have workers, `m - n` callers are queued.

So `QueueLength - PoolSize` is the actual queue depth, when positive. Below zero means there is slack.

For monitoring, you often want both:

```go
inflight := min(QueueLength, PoolSize)
queued := max(0, QueueLength - PoolSize)
```

Export both as separate metrics.

---

## Deep Dive — What `runtime.NumGoroutine` Shows

`runtime.NumGoroutine()` reports the total goroutine count. A tunny pool of size `n` contributes `n` goroutines, plus the main / caller goroutines.

You can use this to detect leaks:

```go
g0 := runtime.NumGoroutine()
pool := tunny.NewFunc(8, work)
g1 := runtime.NumGoroutine()
// g1 - g0 should be 8
pool.Close()
time.Sleep(10 * time.Millisecond) // allow goroutines to exit
g2 := runtime.NumGoroutine()
// g2 should be ~g0
```

If `g2` is much larger than `g0`, you have leaked goroutines from somewhere (not necessarily tunny).

---

## Deep Dive — Trace Output During a Tunny Run

If you compile with `runtime/trace` and run a small tunny program, you can see exactly when each goroutine is created and scheduled. The output looks roughly like:

```
goroutine 1 (main): created at t=0
goroutine 2 (workerWrapper.run #0): created at t=0.0001
goroutine 3 (workerWrapper.run #1): created at t=0.0001
...
goroutine 10 (caller): Process(x) at t=0.001
goroutine 2: wakes up, reads payload, runs Process at t=0.001
goroutine 10: waits at t=0.001
goroutine 2: finishes Process, sends result at t=0.002
goroutine 10: wakes up, returns at t=0.002
```

This trace confirms the model. Run it once on your own machine. Tools like `go tool trace` give you an interactive viewer.

---

## Deep Dive — Goroutine Profile Stacks

If you take a goroutine profile of a process running tunny:

```bash
curl -s http://localhost:6060/debug/pprof/goroutine?debug=1
```

You will see stacks like:

```
goroutine 42 [chan receive]:
github.com/Jeffail/tunny.(*workerWrapper).run(0xc000020000)
    /path/to/tunny/workerwrapper.go:25 +0x80
created by github.com/Jeffail/tunny.New
    /path/to/tunny/tunny.go:75 +0xc0
```

Many such stacks indicate many idle workers. That is normal — workers sit on a channel receive while idle.

If you see different stacks, e.g.:

```
goroutine 42 [select]:
github.com/Jeffail/tunny.(*Pool).ProcessTimed.func1()
    ...
```

…you have callers in flight in `ProcessTimed`.

Profile your service in production. The shapes of stacks tell you what tunny is doing.

---

## Deep Dive — Edge: A Worker That Returns Early

If your worker's `Process` returns very quickly — say, hits an error and returns in 1 microsecond — what happens?

The worker:

1. Returns the result.
2. Loops back to `BlockUntilReady`.
3. If `BlockUntilReady` is a no-op, immediately writes to `reqChan` again.

So the worker becomes available again in microseconds. Tunny does not slow this down or introduce minimum cycles. The pool's throughput for trivial work is limited by channel operation cost (which is fast — single-digit nanoseconds in Go).

This is why tunny does not benchmark well for nanosecond workloads: the channel overhead dominates. Use tunny for microsecond-or-larger workloads.

---

## Deep Dive — Why Tunny Doesn't Use Lock-Free Data Structures

Channels are essentially lock-free for the common case. The runtime implementation of channels uses atomic operations and a small spinlock; for uncontended cases, it is very fast.

Could tunny use a custom lock-free queue? In principle yes. In practice, channels are fast enough and the resulting code is much simpler. The maintainer chose simplicity.

If you find tunny too slow for your workload, the answer is unlikely to be "swap channels for a lock-free queue." It is more likely "use a different design entirely — submit-and-forget, or a custom dispatcher."

---

## Deep Dive — The `interface{}` Tax

Every `Process` call boxes the payload into `interface{}` (`any`). Boxing means:

- If the payload is a pointer, no allocation — the interface contains the pointer directly.
- If the payload is a small value (int, bool), Go may inline it into the interface header — no allocation.
- If the payload is a larger value (struct), Go allocates space on the heap and stores a pointer in the interface.

Similarly for the return value.

For most workloads, this is invisible. For very hot paths, allocate-bound performance, this can matter. Workarounds:

1. **Pre-allocate payload structs and pass pointers.** A `*Job` does not allocate; a `Job` does.
2. **Use a payload type that fits in a register.** An `int` or `uintptr` does not allocate.
3. **Batch many tasks per `Process` call.** Amortize the box cost.

If you need zero-allocation per task, tunny is the wrong tool — you want a custom hand-rolled pool. But that is a niche concern.

---

## Deep Dive — Compaction of the Workers Slice

When `SetSize` shrinks the pool, the `workers` slice is sliced:

```go
p.workers = p.workers[:n]
```

This does *not* free the underlying array. The capacity is unchanged. If you frequently grow and shrink, the slice retains the largest allocation.

For long-lived pools this is fine. For pools that go through many resizes, you may want:

```go
p.workers = append([]*workerWrapper(nil), p.workers[:n]...)
```

…which makes a fresh underlying array. But this is rarely needed in practice.

---

## Deep Dive — `defer` Ordering in `workerWrapper.run`

The run function has:

```go
defer func() { close(w.closedChan) }()
defer w.worker.Terminate()
```

Defers run in reverse order. So `Terminate` runs first, then `closedChan` is closed. The `closedChan` close is the signal "this worker has fully exited including Terminate." The pool's `Close` waits on `closedChan`, so after `Close` returns, you know `Terminate` has run on every worker.

This ordering is important. If you reverse it:

```go
defer w.worker.Terminate()             // runs last
defer func() { close(w.closedChan) }() // runs first
```

…then `closedChan` is closed before `Terminate` runs. The pool's `Close` would return before `Terminate` had finished. Resource leaks could ensue if `Close`-returns triggers something that needs `Terminate` to have completed.

Always think about defer order in lifecycle code.

---

## Deep Dive — Async vs Sync Panic Behavior

A panic in a goroutine kills the whole process. Tunny's `workerWrapper.run` does not have a `recover`. So a panic in:

- `BlockUntilReady` — process crashes.
- `Process` — process crashes.
- `Interrupt` — process crashes (running in caller's goroutine).
- `Terminate` — process crashes.

If you cannot trust your worker, wrap it:

```go
func (w *safeWorker) Process(p any) (out any) {
    defer func() {
        if r := recover(); r != nil {
            out = fmt.Errorf("panic in worker: %v", r)
        }
    }()
    return w.inner.Process(p)
}
```

Similarly for the other three methods if needed. Most workers do not need `recover` in `BlockUntilReady` or `Terminate`, but you might.

A philosophical question: should the library do the `recover` for you? The maintainer's choice is no — explicit is better than implicit. You decide whether to silence panics.

---

## Deep Dive — Goroutine Identity

Each worker is a single goroutine. You cannot identify it from outside (Go does not expose goroutine IDs reliably). If you need to log "which worker handled this request", you must give workers explicit IDs:

```go
type identifiedWorker struct {
    id int
    // ...
}

var nextID atomic.Int64
pool := tunny.New(n, func() tunny.Worker {
    return &identifiedWorker{id: int(nextID.Add(1))}
})
```

Then log `w.id` inside `Process`. This is useful for tracing which worker is slow, which one has stale state, etc.

---

## Deep Dive — `for select{}` vs `for { select{} }`

In `workerWrapper.run`, the loop is:

```go
for {
    w.worker.BlockUntilReady()
    select {
        // ...
    }
}
```

Not:

```go
for {
    select {
        // ...
    }
}
```

The difference: `BlockUntilReady` is called *every iteration before* the select. If the iteration exits with no work (interrupt branch taken), `BlockUntilReady` is called again on the next iteration. So `BlockUntilReady` may be called many times between actual `Process` calls.

This means: your `BlockUntilReady` should be cheap if no work has actually flowed. If you do a heavy operation in `BlockUntilReady` (e.g. log "ready"), you will see many such logs even if no `Process` is happening — because of the interrupt-noop branch.

---

## Comparison Study — Tunny vs Java's `ThreadPoolExecutor`

The closest familiar analogy outside Go is Java's `ThreadPoolExecutor`.

| Aspect                    | tunny                          | ThreadPoolExecutor              |
|---------------------------|--------------------------------|---------------------------------|
| Pool sizing               | Fixed at construction          | Core / Max with idle reaping    |
| Submission                | Synchronous (Process blocks)   | Submit returns Future           |
| Task type                 | Callable from a fixed function | Any Runnable / Callable         |
| Cancellation              | Interrupt method               | Future.cancel(mayInterrupt)     |
| Backpressure              | Caller blocks on Process       | Configurable queue (bounded/unbounded) |
| Per-worker state          | First-class                    | Possible via ThreadLocal        |
| Idle reaping              | None                           | Yes                             |

Differences:

- Tunny is much smaller. It does not aspire to `ThreadPoolExecutor`'s flexibility.
- Tunny's "synchronous Process" forces backpressure on callers. Java's "submit returns Future" allows callers to fire and forget, but then they must manage the futures themselves.
- Java's Future supports cancellation that interrupts the running thread (via `Thread.interrupt()`). Tunny's `Interrupt` is similar in spirit.

If you are coming from Java, the closest mental shift is "Process is `submit(callable).get()` in one call". Less flexible, but the simplicity is its own value.

---

## Comparison Study — Tunny vs Tokio's `JoinSet`

In Rust async, the closest cousin is something like `JoinSet`:

```rust
let mut set = JoinSet::new();
for x in inputs {
    set.spawn(async move { work(x).await });
}
while let Some(r) = set.join_next().await {
    // ...
}
```

Differences:

- Rust async is *implicit* concurrency on a single executor; Go's goroutines are *explicit*. The pool concept is more pronounced in Go.
- Tokio's `JoinSet` is fire-and-forget plus aggregation. Tunny's `Process` is synchronous per call.
- Tokio's runtime manages worker threads. Tunny does not — it manages goroutines, leaving threads to the runtime.

If you are coming from Rust, the closest mental model is "tunny is a typed channel with N consumers that you can address synchronously."

---

## Engineering Trade-offs in Tunny's Design

Looking at the source as a whole, the tunny maintainer made these choices:

1. **Synchronous API over asynchronous.** Returns from `Process` carry the result directly. Cost: no fire-and-forget. Benefit: simple call sites.
2. **`interface{}` over generics.** Pre-generics-era code. Cost: type assertions everywhere. Benefit: works on any Go version.
3. **Fixed-size pool over dynamic.** Cost: no auto-scaling. Benefit: predictable resource use, simpler code.
4. **`Worker` interface over closure.** Cost: more boilerplate for trivial cases. Benefit: per-worker state, lifecycle hooks.
5. **Channels over locks.** Cost: harder to debug. Benefit: select-based cancellation is easy.

Each choice is defensible. Some lean against modern Go idioms (generics, especially), but the API is stable and the code is small.

If tunny were rewritten from scratch today, I would expect:

- Generic types: `Pool[In, Out]` natively.
- `ProcessCtx` as the primary `Process`.
- A configurable `Sizing` policy (fixed, dynamic with bounds).

But the existing API is good enough that a rewrite would be net negative — the cost of breaking everyone's code would exceed the benefit of marginally cleaner internals.

---

## Hands-On Exercise — Read and Annotate the Source

Find tunny's source on your machine:

```bash
go env GOMODCACHE
find $(go env GOMODCACHE) -name 'tunny.go' -path '*/Jeffail/tunny*'
```

Open it. Find these methods:

- `New`
- `NewFunc`
- `NewCallback`
- `Process`
- `ProcessTimed`
- `ProcessCtx`
- `Close`
- `SetSize`
- `QueueLength`

For each, write one sentence explaining what it does in terms of the channels. If you can do this for all of them, you understand tunny.

Find `workerwrapper.go` and identify:

- The `workerWrapper` struct fields and their roles.
- The `run` method's loop.
- The `interrupt` helper.

If you can recite the run loop from memory, you have absorbed everything in this file.

---

## Hands-On Exercise — Fork Tunny and Add a `BeforeProcess` Hook

This is a meaningful but small extension. Add a hook to the `Worker` interface (or as an optional interface):

```go
type Hookable interface {
    BeforeProcess(payload any)
    AfterProcess(payload any, result any)
}
```

Inside `workerWrapper.run`, before and after calling `Process`, check if the worker implements `Hookable` and call the hook.

This exercise:

- Forces you to navigate the source.
- Shows you how to extend tunny without breaking back-compat (optional interface).
- Demonstrates that the library is *small* and *modifiable*.

You will not actually merge this upstream — it is just for understanding. After doing it, revert. You will know tunny better than before.

---

## Hands-On Exercise — Implement Tunny From Scratch

The ultimate test: implement tunny yourself, from memory, in one sitting. Goal: ~200 lines. You need:

- A `Pool` struct.
- A `workerWrapper` per worker, with goroutine.
- `Process`, `Close`, and the `Worker` interface.

Skip the conveniences (`NewFunc`, `NewCallback`, `ProcessTimed`, `ProcessCtx`). Just the core.

If you can do this, you understand tunny at the level of the maintainer.

---

## Final Architecture Reflection

Tunny is a tiny library that fully embraces "channels are for communication, not just synchronization." Its design teaches a few lessons that apply broadly:

1. **Workers can offer themselves rather than being offered work.** The inverted dispatch is small, elegant, and naturally fair.
2. **Channels carry not just data but ownership.** A `workRequest` containing pointers to `jobChan` and `retChan` hands the worker's mailbox to the caller temporarily.
3. **A small interface with lifecycle hooks beats a big closure.** The four-method `Worker` interface is just enough.
4. **Errors should live at the API boundary, not the worker boundary.** `Process` returns `any`; only the timeout/context variants return errors.
5. **Tiny library is feature.** Tunny does not aspire to be a framework; it is a library you can read on a screen.

These principles, learned through reading tunny, will improve your Go concurrency code for years.

---

## Onward

You have now seen tunny from API to source. The professional file applies this knowledge to production operations: deployment, observability, graceful shutdown, capacity planning, incident response. Less code, more ops mindset.

After professional, the specification file is a quick reference; the interview, tasks, find-bug, and optimize files are sharpening exercises. Pick what is useful for your situation.

Whatever your path, you are no longer using tunny — you are *operating* it. That is the senior level achievement.

---

## Appendix — Reference Snippets

### Snippet 1 — minimal Pool reimplementation skeleton

```go
package mypool

import (
    "sync"
)

type Pool struct {
    workers []*workerWrapper
    reqChan chan workRequest
    mu      sync.Mutex
}

type Worker interface {
    Process(any) any
    BlockUntilReady()
    Interrupt()
    Terminate()
}

type workRequest struct {
    payload   any
    result    chan any
    interrupt func()
}

type workerWrapper struct {
    w        Worker
    reqChan  chan workRequest
    closeCh  chan struct{}
    doneCh   chan struct{}
}

func New(n int, ctor func() Worker) *Pool {
    p := &Pool{reqChan: make(chan workRequest)}
    for i := 0; i < n; i++ {
        ww := &workerWrapper{
            w:        ctor(),
            reqChan:  p.reqChan,
            closeCh:  make(chan struct{}),
            doneCh:   make(chan struct{}),
        }
        p.workers = append(p.workers, ww)
        go ww.run()
    }
    return p
}

func (w *workerWrapper) run() {
    defer close(w.doneCh)
    defer w.w.Terminate()
    for {
        w.w.BlockUntilReady()
        req := workRequest{
            result:    make(chan any, 1),
            interrupt: w.w.Interrupt,
        }
        select {
        case <-w.closeCh:
            return
        case <-w.handoff(req):
        }
        // process
        out := w.w.Process(req.payload)
        req.result <- out
    }
}

func (w *workerWrapper) handoff(req workRequest) chan struct{} {
    ready := make(chan struct{}, 1)
    go func() {
        select {
        case <-w.closeCh:
        case w.reqChan <- req:
            ready <- struct{}{}
        }
    }()
    return ready
}

func (p *Pool) Process(payload any) any {
    req := <-p.reqChan
    // ... too sketchy for production, but conveys shape
    req.payload = payload // bug: req is value type, this is local
    return <-req.result
}

func (p *Pool) Close() {
    p.mu.Lock()
    defer p.mu.Unlock()
    for _, w := range p.workers {
        close(w.closeCh)
    }
    for _, w := range p.workers {
        <-w.doneCh
    }
    close(p.reqChan)
}
```

This is illustrative, not production code. The real tunny is more careful — particularly around the `payload` mutation. But this captures the shape.

### Snippet 2 — observability wrapper

```go
type observedWorker struct {
    inner   tunny.Worker
    name    string
}

func (w *observedWorker) Process(p any) (out any) {
    timer := prometheus.NewTimer(processDuration.WithLabelValues(w.name))
    defer timer.ObserveDuration()
    defer func() {
        if r := recover(); r != nil {
            panicCounter.WithLabelValues(w.name).Inc()
            out = errPanic
        }
    }()
    return w.inner.Process(p)
}

func (w *observedWorker) BlockUntilReady() {
    timer := prometheus.NewTimer(blockDuration.WithLabelValues(w.name))
    defer timer.ObserveDuration()
    w.inner.BlockUntilReady()
}

func (w *observedWorker) Interrupt() {
    interruptCounter.WithLabelValues(w.name).Inc()
    w.inner.Interrupt()
}

func (w *observedWorker) Terminate() {
    terminateCounter.WithLabelValues(w.name).Inc()
    w.inner.Terminate()
}
```

This is the wrapper you would use in production to get metrics without modifying the inner Worker.

### Snippet 3 — health probe

```go
func (s *Service) HealthCheck() error {
    if s.pool.QueueLength() > 1000 {
        return fmt.Errorf("queue too long: %d", s.pool.QueueLength())
    }
    if s.pool.GetSize() == 0 {
        return errors.New("pool has zero workers")
    }
    return nil
}
```

Integrate into your service's `/health` endpoint. Trip degradation when the pool is overloaded.

### Snippet 4 — graceful shutdown

```go
func (s *Service) Shutdown(ctx context.Context) error {
    // Stop accepting new requests at the HTTP layer first.
    s.server.Shutdown(ctx)

    // Drain in-flight pool work.
    done := make(chan struct{})
    go func() {
        for s.pool.QueueLength() > 0 {
            select {
            case <-ctx.Done():
                return
            case <-time.After(100 * time.Millisecond):
            }
        }
        close(done)
    }()
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-done:
    }

    // Now safe to close the pool.
    s.pool.Close()
    return nil
}
```

Three phases: stop accepting, drain in-flight, close. Each is bounded by the context.

### Snippet 5 — testing aid

```go
type testWorker struct {
    called atomic.Int64
    fn     func(any) any
}

func (w *testWorker) Process(p any) any {
    w.called.Add(1)
    return w.fn(p)
}

func (w *testWorker) BlockUntilReady() {}
func (w *testWorker) Interrupt()       {}
func (w *testWorker) Terminate()       {}

func TestPoolDispatches(t *testing.T) {
    w := &testWorker{fn: func(p any) any { return p }}
    pool := tunny.New(2, func() tunny.Worker { return w })
    t.Cleanup(pool.Close)

    for i := 0; i < 10; i++ {
        if got := pool.Process(i); got != i {
            t.Errorf("Process(%d) = %v", i, got)
        }
    }
    if w.called.Load() != 10 {
        t.Errorf("called %d times, want 10", w.called.Load())
    }
}
```

Workers can carry test instrumentation directly. Use this pattern to verify dispatch behaviour in your tests.

---

## Closing the Senior Chapter

The senior level is about *seeing through* the abstraction. You know what tunny does, you know how it does it, you know why those design choices were made, and you can extend or replace tunny as your workload demands.

The professional level is about *operating* the abstraction. Same code; different concerns. Production deployment, monitoring, incident response, capacity planning.

Recommended next step: read [professional.md](professional.md) when you have at least one tunny-based service in production (or about to deploy). The material there is concrete and addresses real ops problems.

---

## Extended Internals — Walking Through the workerWrapper Annotated

Here is an annotated version of `workerWrapper.run`. Numbers point to interesting lines.

```go
func (w *workerWrapper) run() {
    defer close(w.closedChan)              // (1)
    defer w.worker.Terminate()             // (2)

    for {                                   // (3)
        w.worker.BlockUntilReady()         // (4)

        select {                            // (5)
        case <-w.closeChan:                // (6)
            return
        case w.reqChan <- workRequest{      // (7)
            jobChan:       w.jobChan,
            retChan:       w.retChan,
            interruptFunc: w.interrupt,
        }:
            payload := <-w.jobChan         // (8)
            result := w.worker.Process(payload) // (9)
            w.retChan <- result            // (10)
        case <-w.interruptChan:            // (11)
        }
    }
}
```

(1) `closedChan` is closed when this goroutine exits — including after a panic. Combined with the `defer` order, the pool's `Close` can wait on `closedChan` to know that all of `Terminate` has run.

(2) `Terminate` is the first `defer` registered, so it runs LAST. Reverse the order of defers and you change visible behavior — `Close` would return before `Terminate` finished, opening race windows.

(3) The infinite loop. The only way out is `return`, which happens only on `closeChan` close.

(4) `BlockUntilReady` is called *every* iteration. This means it is called many times if many cycles complete. Make it fast for the no-work case.

(5) The select is the heart of dispatch. Three branches.

(6) Close branch. If `closeChan` is closed, this case is always ready. The function returns, triggering deferreds.

(7) Send-on-reqChan branch. Tunny writes a `workRequest` to the SHARED `reqChan`. Whichever caller is reading wakes up. The send is the "I am ready" handshake.

(8) Once the request is handed off, the caller writes the payload on `jobChan`. The worker reads it. This is a per-worker channel, unique to this workerWrapper.

(9) The worker calls the user's `Process`. This is where user code runs. Any panic here propagates up, kills the goroutine, fires the deferreds (`Terminate` and `close(closedChan)`).

(10) The result is sent on `retChan`. The caller is waiting; the send unblocks them.

(11) Interrupt branch. If `interruptChan` has a value, the case is selected, the value consumed, the loop iterates again. This is the "stale interrupt" case: the interrupt arrived after `Process` returned but before the worker started a new cycle. Safely ignored.

The whole loop is 15 lines of Go. Every operation is a channel op or a method call. There is no shared memory between the worker and other code beyond what flows on channels.

---

## Extended Internals — The interruptFunc Closure

Here is the `interrupt` method on `workerWrapper`:

```go
func (w *workerWrapper) interrupt() {
    select {
    case w.interruptChan <- struct{}{}:
    default:
    }
    w.worker.Interrupt()
}
```

Two things happen:

1. A non-blocking send on `interruptChan`. Non-blocking because the worker might not be in a state to consume it; we do not want to block the caller's goroutine.
2. A synchronous call to the user's `Interrupt`. This runs in the caller's goroutine.

The first part wakes the worker up if it is in the outer `select` (e.g. just returned from `Process` but not yet looped back to `BlockUntilReady`). The second part is the user-level notification.

`interruptFunc` (the closure inside `workRequest`) is just `w.interrupt`. By passing it in the `workRequest`, the caller (or rather, the `ProcessTimed`/`ProcessCtx` machinery) can invoke it without needing a reference to the workerWrapper directly.

This is a typical Go pattern: closures-as-callbacks bound to private state. The user only sees `req.interruptFunc()`; the implementation knows how to find the worker.

---

## Extended Internals — Lifecycle From Construction to Termination

A play-by-play of a single worker's life.

1. `tunny.New(n, ctor)` is called. The pool's constructor:
   - Allocates `reqChan`.
   - Loops `n` times. Each iteration:
     - Calls `ctor()` to get a `Worker`.
     - Constructs a `workerWrapper` wrapping that worker.
     - Calls `go w.run()` to start the goroutine.
   - Returns the `*Pool`.

2. The goroutine starts executing `run`. It immediately calls `BlockUntilReady`.

3. `BlockUntilReady` returns (instantly for default empty implementation, or after some wait).

4. The goroutine enters the `select`. It is offering itself via `reqChan <- workRequest{...}`.

5. Nothing happens for a while. Idle.

6. A caller calls `pool.Process(x)`. The caller's `<-reqChan` succeeds. The worker's send-on-reqChan completes.

7. The caller sends `x` on `req.jobChan`. The worker reads.

8. The worker calls `Process(x)`. User code runs.

9. The worker sends the result on `req.retChan`. The caller reads.

10. The worker loops back to `BlockUntilReady`. The cycle repeats.

11. Many cycles happen. The worker serves many requests.

12. Eventually, `pool.Close()` is called.

13. The pool closes each worker's `closeChan`.

14. The worker, on its next iteration of the select, takes the `<-closeChan` branch.

15. The function returns. Deferreds run in reverse: `Terminate()` first, then `close(closedChan)`.

16. The pool's `Close` was waiting on `<-closedChan`. The receive unblocks. `Close` proceeds to the next worker.

17. After all workers, `reqChan` is closed.

18. The pool's `Close` returns.

The entire lifecycle is encoded in a handful of channels and a few method calls. No state machine flags, no condition variables, no explicit thread management.

---

## Extended Internals — Why `closedChan` Is Used Instead of a `sync.WaitGroup`

You might think tunny would use `sync.WaitGroup` to coordinate `Close`:

```go
var wg sync.WaitGroup
for i := 0; i < n; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        // run loop
    }()
}
// Close:
// signal stop somehow
wg.Wait()
```

Why does tunny use per-worker `closedChan` instead?

- **Symmetry.** Each `workerWrapper` is independently observable. You can wait on one worker's `closedChan` without waiting on others.
- **Composability.** A `chan struct{}` plays well with `select`. A `WaitGroup` does not — there is no `select`-able wait on a `WaitGroup`. (You can simulate one by launching a goroutine that closes a channel after `Wait`, but it is ugly.)
- **Cancellation in select.** `closedChan` lets the pool's `Close` use `select` to enforce timeouts on individual worker shutdowns, if desired.

For a pool-of-pools or richer manager, you would want the per-worker `closedChan` rather than a single `WaitGroup`. Tunny chose the more flexible primitive.

---

## Extended Internals — How `Pool.Close` Avoids Deadlocks

`Pool.Close` could deadlock in one scenario: a worker is blocked in `BlockUntilReady` waiting for an external event that will never happen. The pool's `Close` cannot proceed until the worker's `Terminate` runs, which requires the worker's `run` to exit, which requires it to see `closeChan` closed.

But the worker is blocked in `BlockUntilReady`, not in the select. It will not see `closeChan` until `BlockUntilReady` returns.

So if your `BlockUntilReady` can block forever, `Close` can block forever.

Tunny does not solve this for you. Solutions:

1. Make `BlockUntilReady` cancellable. Plumb the worker's `closeChan` into it:

```go
type w struct {
    closeCh chan struct{}
}

func (w *w) BlockUntilReady() {
    select {
    case <-time.After(100 * time.Millisecond):
    case <-w.closeCh:
        // bail out
    }
}
```

But: tunny does not give you the workerWrapper's `closeChan`. You need to manage your own.

2. Time-bound your `BlockUntilReady`:

```go
func (w *w) BlockUntilReady() {
    select {
    case <-w.lim.Wait(...):
    case <-time.After(time.Second):
    }
}
```

This guarantees `BlockUntilReady` returns within a second, no matter what.

3. Avoid blocking in `BlockUntilReady` indefinitely. If you find yourself doing it, reconsider whether `BlockUntilReady` is the right hook.

---

## Extended Internals — Behavior Under `SetSize(0)`

What if you call `pool.SetSize(0)`? The pool stops all workers. The pool is still "open" — `reqChan` is not closed. But no worker is reading from `reqChan`. Any caller calling `Process` will block forever, because there is no one to respond.

This is essentially a "paused" pool. Useful?

- Rare. Most use cases are "size matches current load."
- One valid use: a test where you want to verify backpressure. Set size to 0, observe callers blocking.

After `SetSize(0)`, calling `SetSize(n)` brings the pool back to life.

Beware: while size is 0, `QueueLength` may report a non-zero number of waiting callers. They are all waiting indefinitely.

---

## Extended Internals — Memory Visibility Across Workers

Two workers do not share memory unless you arrange for them to. Suppose worker A holds a buffer `bufA` and worker B holds `bufB`. They write to their own buffers concurrently. No race, because no shared variable.

But suppose both workers share a `*Counter` via the factory:

```go
shared := &Counter{}
pool := tunny.New(8, func() tunny.Worker {
    return &w{ctr: shared}
})
```

Now all 8 workers can write to `shared` concurrently. You must protect it (mutex or atomic).

The Go race detector catches this if any goroutine writes the variable and any other reads or writes it without synchronization. Always run tests with `-race`.

---

## Extended Internals — The `interface{}` Channel Bottleneck

Tunny's `reqChan` is `chan workRequest`. `workRequest` is a small struct (3 pointers/channels worth of data). Sending and receiving on it is cheap.

But the payloads themselves are `interface{}` (`any`). The `jobChan` and `retChan` are `chan interface{}`. Sending an `interface{}` through a channel involves the boxing/unboxing we discussed.

For very small workloads (the function returns in nanoseconds), the channel overhead dominates total time. Tunny is NOT free.

A back-of-envelope figure: a `chan interface{}` send-receive cycle is on the order of 100-300 nanoseconds. If your `Process` takes 1 microsecond, channel overhead is ~20% of runtime. If `Process` takes 1 millisecond, channel overhead is ~0.02%. So the larger the work, the more negligible the overhead.

Plan accordingly. Use tunny for workloads where `Process` takes microseconds to milliseconds. For nanosecond-scale workloads, inline the work or use a different pattern.

---

## Extended Internals — Comparison With Channel-of-Tasks

Many Go developers write a "channel of tasks" pattern:

```go
type Task func()
tasks := make(chan Task, 100)
for i := 0; i < n; i++ {
    go func() {
        for t := range tasks {
            t()
        }
    }()
}
tasks <- func() { ... }
close(tasks)
```

How does this compare to tunny?

- **Dispatch.** Same shape — workers read from a shared channel.
- **Return values.** None in the simple version. Tunny gives you a result.
- **Cancellation.** None. Tunny has `Interrupt`.
- **Per-worker state.** None. Tunny has the `Worker` interface.
- **Backpressure.** The channel has a buffer of 100. Sending the 101st blocks. Tunny's `Process` always blocks if the pool is full.
- **Lifecycle.** Manual. Tunny manages `Terminate` for you.

For very simple use cases, the channel-of-tasks pattern is fine. As soon as you need any of the things tunny does — return values, cancellation, state, lifecycle — using tunny saves you from accidentally reimplementing those features poorly.

---

## Extended Internals — Profiling a Real Tunny Application

In production, you might want to profile tunny's contribution to your application's behavior. Tools:

### `pprof` goroutine profile

```bash
curl -s 'http://localhost:6060/debug/pprof/goroutine?debug=2' | grep -A 5 tunny
```

You will see stacks parked in `workerWrapper.run` or in user `Process` code.

### `pprof` CPU profile

```bash
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
(pprof) top --cum
```

CPU time inside `Process` should dominate. CPU time in tunny's dispatch should be tiny (channels are fast).

### `pprof` block profile

```bash
go tool pprof http://localhost:6060/debug/pprof/block
```

The block profile shows where goroutines were waiting on synchronization. Tunny callers will appear as "blocked on `chan receive` in `tunny.Pool.Process`." This is *expected* if the pool is saturated.

If callers are blocked for unusually long times, you may be under-sized.

### `pprof` mutex profile

```bash
go tool pprof http://localhost:6060/debug/pprof/mutex
```

The mutex profile shows contention on mutexes. Tunny's `workerMut` should not appear except during `Close` or `SetSize`. If it does, you are resizing too often.

---

## Extended Internals — Garbage Collection Interactions

Each `Process` call allocates (at least):

- The boxed `interface{}` for the payload (if payload is a non-trivial value).
- The boxed `interface{}` for the result.
- A `time.Timer` for `ProcessTimed`.

These are short-lived allocations. They become garbage quickly. The GC handles them in stride.

For 100k `Process` calls per second, you generate hundreds of thousands of short-lived heap objects. This is well within Go's GC capabilities, but it does keep the GC busy.

To reduce GC pressure:

- Use pointer payloads (`*Job` instead of `Job`). A pointer is already a "boxed" form; the interface holds the pointer directly with no extra allocation.
- Use a `sync.Pool` for result structs.
- Pre-allocate any per-call data structures the worker uses, holding them on the `Worker` struct.

The senior file's advice on hoisting allocations to worker fields applies double here. Every allocation hoisted is one less GC operation.

---

## Extended Internals — Optimisation: Pointer Payloads

Compare:

```go
// Allocates per call: the Job value is boxed.
type Job struct{ A, B int }
pool.Process(Job{1, 2})
```

vs:

```go
// Less allocation: only the pointer is boxed.
type Job struct{ A, B int }
pool.Process(&Job{1, 2})
```

The second form allocates a `Job` on the heap once (the escape analysis may keep it on the stack — check with `-gcflags="-m"`). Compared to boxing a 16-byte struct into an interface (which is essentially the same work), the difference is small.

Where it does matter: structs much larger than a few words. A 1 KB struct boxed into `interface{}` allocates 1 KB on the heap. A `*1KB` boxed allocates only 8 bytes (the pointer).

For large payloads, always pass pointers.

---

## Extended Internals — Optimisation: Pre-Allocated Result Buffers

If your `Process` returns a slice or other allocated thing, you can sometimes amortise the allocation:

```go
type w struct {
    out []byte
}

func (w *w) Process(p any) any {
    w.out = w.out[:0] // reset, keep capacity
    w.out = append(w.out, doSomething(p)...)
    return w.out // CAREFUL: caller now holds a slice into w.out
}
```

Sharing `w.out` across calls is dangerous: if the caller does not consume it before the worker's next `Process`, the slice is overwritten. Copy or use a `sync.Pool`:

```go
func (w *w) Process(p any) any {
    buf := bufPool.Get().([]byte)[:0]
    buf = append(buf, doSomething(p)...)
    return buf // caller must Put it back
}
```

This requires the caller to participate in the allocation lifecycle. Common pattern but error-prone. Document it clearly.

---

## Extended Internals — Compile-Time Verification of `Worker`

Add a compile-time assertion that your type satisfies `tunny.Worker`:

```go
var _ tunny.Worker = (*myWorker)(nil)
```

This line compiles to nothing at runtime but fails the build if `*myWorker` does not satisfy the interface. Put it near the type definition.

A small habit that prevents "I forgot to implement Terminate" bugs.

---

## Extended Internals — Behaviour Under Test

A subtle test gotcha: `t.Cleanup(pool.Close)` is correct, but it does NOT prevent a `Process` from outliving the test. If you have spawned goroutines that call `Process`, they continue after the test function returns. The cleanup closes the pool, which may panic those goroutines.

To avoid this, ensure all `Process`-calling goroutines exit before the test ends. Use `sync.WaitGroup`:

```go
func TestX(t *testing.T) {
    pool := tunny.NewFunc(2, work)
    t.Cleanup(pool.Close)

    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            pool.Process(i)
        }()
    }
    wg.Wait()
    // Now t.Cleanup runs safely.
}
```

`wg.Wait` ensures the goroutines have exited before the test returns. `t.Cleanup` runs after. The order is correct.

---

## Extended Internals — Stack Pinning and Worker Identity

Goroutines in Go are M:N scheduled — they can move between OS threads. A tunny worker is just a goroutine; the scheduler can move it.

But: if the worker calls `runtime.LockOSThread`, it pins to a thread. This is useful for:

- Cgo calls that depend on thread-local state.
- Direct system calls that need a stable thread (rare).
- Code that interacts with thread-affinity-aware libraries.

You can `Lock` in `Process` and `Unlock` in `defer`. The pin is for the duration of `Process` only. Or you can lock for the worker's lifetime:

```go
func newWorker() tunny.Worker {
    w := &worker{}
    go func() {
        // ??? cannot do this here ...
    }()
    return w
}
```

There is no clean hook for "pin this worker's thread permanently" because tunny's worker goroutine is the one running `run`. Best you can do: lock at the start of `Process` and accept the cost.

For most workloads, do not bother. Goroutines moving between threads is a feature, not a problem.

---

## Extended Internals — Reading the Tunny Test Suite

The tunny repo has tests. They are short. Read them. They are:

- Examples of correct usage.
- Stress tests for concurrent behavior.
- Documentation of edge cases.

Particularly useful tests:

- `TestPoolStop` — verifies `Close` works correctly.
- `TestPoolSizing` — verifies `SetSize` behavior.
- `TestPoolProcess` — basic synchronous behavior.

Read each test once. The library's test suite is a hidden teaching tool.

---

## Extended Internals — Stress Testing Your Own Pool

To stress-test a tunny-backed service, write a benchmark like:

```go
func BenchmarkPoolUnderLoad(b *testing.B) {
    pool := tunny.New(runtime.NumCPU(), func() tunny.Worker {
        return &myWorker{}
    })
    b.Cleanup(pool.Close)

    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = pool.Process(payload).(Result)
        }
    })
}
```

`b.RunParallel` saturates all `GOMAXPROCS` cores. The benchmark measures pool throughput.

Run with various `GOMAXPROCS`:

```bash
GOMAXPROCS=1 go test -bench=. -benchtime=10s
GOMAXPROCS=2 go test -bench=. -benchtime=10s
GOMAXPROCS=8 go test -bench=. -benchtime=10s
```

Compare. Tunny should scale roughly linearly until `pool size = GOMAXPROCS`, then plateau.

If you see non-linear scaling, look for shared mutable state (locks contended across workers).

---

## Extended Internals — Building a Tunny-Compatible Mock

For tests where the pool is not under test but is a dependency, you may want a synchronous mock:

```go
type SyncPool struct {
    fn func(any) any
}

func (p *SyncPool) Process(payload any) any {
    return p.fn(payload)
}

func (p *SyncPool) Close() {}
```

This implements the same surface as `*tunny.Pool` for the basics. Substitute it in tests where you do not want real goroutines.

Define an interface to make this swap easy:

```go
type Poolish interface {
    Process(any) any
    Close()
}
```

Code against `Poolish`, not `*tunny.Pool`. Tests inject the mock; production injects the real pool.

---

## Extended Internals — Final Wisdom

A handful of meta-points worth carrying forward.

1. **Reading library source is the highest-leverage learning activity.** You learn idioms, patterns, and design choices you cannot learn from docs.
2. **Small libraries are gifts.** They are readable, understandable, modifiable. Treat the small ones with respect.
3. **Channels-as-synchronization is a deep pattern.** Tunny is a primer in it. Once you internalise it, you will see opportunities to use channels in places where you might have used mutexes.
4. **Interfaces with lifecycle methods compose well.** The `Worker` interface is four methods; each has a clear role. Compare to interfaces with one method or with twenty — both are awkward.
5. **The Go scheduler is your friend.** You do not need to micromanage goroutine scheduling. Trust it. Measure when in doubt.

This concludes the senior file. You have the technical depth. The remaining files (`professional`, `specification`, `interview`, `tasks`, `find-bug`, `optimize`) build on this depth in specific directions. Use them as needed.

Good engineering with tunny is not a deeper knowledge of the library — that you now have. It is good *judgement* about when to reach for tunny, how large to make the pool, what to put on the `Worker` struct, and how to monitor the pool in production. That judgement comes from experience, not reading. Build something with tunny, watch it under load, iterate.

---

## Appendix — Quick Reference for Field Types

Just for quick scanning, the types of all the tunny fields you will encounter:

```go
type Pool struct {
    queuedJobs int64                    // accessed with atomic
    ctor       func() Worker
    workers    []*workerWrapper
    reqChan    chan workRequest
    workerMut  sync.Mutex
}

type workerWrapper struct {
    worker        Worker                 // the user's worker
    reqChan       chan workRequest       // shared (== Pool.reqChan)
    interruptChan chan struct{}          // buffered size 1
    closeChan    chan struct{}          // signal to stop
    closedChan   chan struct{}          // closed when stopped
    jobChan      chan interface{}       // payload from caller
    retChan      chan interface{}       // result to caller
}

type workRequest struct {
    jobChan       chan<- interface{}    // points to workerWrapper.jobChan
    retChan       <-chan interface{}    // points to workerWrapper.retChan
    interruptFunc func()                // closure over workerWrapper.interrupt
}
```

Notice that `jobChan` in `workerWrapper` is bidirectional but in `workRequest` it appears as send-only (`chan<-`). Same channel, different views. Tunny gives the caller the send-only view so it cannot accidentally read from `jobChan`.

Similarly, `retChan` is exposed as receive-only to the caller (`<-chan`). Type safety even within the package.

---

## Appendix — `interface{}` vs `any`

Go 1.18 introduced `any` as an alias for `interface{}`. They are identical. Tunny's exported types use `interface{}` (for compatibility with pre-generics Go) but in your own code you can use `any`. The compiler treats them the same.

Some recent commits to tunny may have switched to `any`. Either spelling is fine.

---

## Appendix — Long-form Reflection

After everything in this file, the question worth sitting with: **why does tunny exist?**

Go gives you goroutines and channels. Why a third-party library for something that is "just" goroutines plus channels?

Three reasons:

1. **Encoding a pattern as a library.** The "worker pool" pattern is correct and common but easy to get wrong. A library encodes the correct version.
2. **Bounded concurrency by default.** Naive Go code spawns goroutines freely. Production code needs bounds. A library makes bounds the path of least resistance.
3. **Cancellation that respects the worker.** `ProcessCtx` propagates the caller's context to a worker that may still be running. Hand-rolled code rarely gets this right.

Tunny is not a feature library — it does not give you new powers. It gives you a *correctness ceiling*. Code that uses tunny is harder to write incorrectly than code that uses bare goroutines and channels. That is the value proposition.

If you take only one thing from this entire file: **prefer libraries that raise the correctness ceiling** of your domain. Goroutine pools are one domain; concurrency bounded by SLOs is another; structured concurrency is another. Find the libraries that elevate correctness, learn them deeply, and use them.

Now go build something. The professional file awaits when you have production miles.

---

## Appendix — A Walk Through Channel Receives and Sends in Process

Let us trace once more, with extreme precision, what happens during a single `pool.Process(payload)` call. Assume the pool has 4 workers, all idle.

Step 1: All 4 workerWrapper goroutines have finished `BlockUntilReady` and entered the `select` statement. Each one is offering to send a `workRequest` on the shared `reqChan`. The select blocks (the channel is unbuffered, no receivers).

Step 2: The caller's goroutine enters `pool.Process(payload)`. The first thing it does is `<-p.reqChan` — receive from `reqChan`. The runtime now has 4 pending sends and 1 pending receive on `reqChan`.

Step 3: The Go runtime pairs one of the pending sends with the receive. Whichever it picks, that workerWrapper unblocks (its select case is selected). The caller unblocks (its receive returns a value).

Step 4: The caller has a `workRequest`. It sends the payload on `req.jobChan`. The matching workerWrapper is already executing the code after the select, which is `payload := <-w.jobChan`. The send and the receive pair up. Both proceed.

Step 5: The caller now does `payload = <-req.retChan`. It blocks.

Step 6: The workerWrapper executes `result := w.worker.Process(payload)`. This may take a while.

Step 7: The workerWrapper executes `w.retChan <- result`. The caller's receive is waiting; both proceed.

Step 8: The caller increments/decrements `queuedJobs` and returns. The workerWrapper loops back to `BlockUntilReady`.

If you trace this with `go tool trace` and capture a few microseconds, you should see exactly this pattern. The clarity of the pattern is what makes tunny easy to reason about.

If you make a tiny tweak — say, you replace `<-p.reqChan` with a non-blocking receive — you can build different policies (e.g. "reject if no worker is immediately ready"). Tunny does not expose hooks for this, but with a fork or a manual reimplementation, the design is simple enough to modify.

---

## Appendix — Channel Operation Costs

For curiosity, here are approximate costs for channel operations in modern Go (1.22 on x86):

- Send/receive on an unbuffered channel with a waiting receiver: ~150-200 ns per pair.
- Send/receive on a buffered channel with available space: ~50-100 ns per operation.
- Select with one ready case: ~150-200 ns.
- Select with multiple cases (some ready, some not): ~300-500 ns.

Tunny's per-call cost is roughly: receive on `reqChan` + send on `jobChan` + receive on `retChan` ≈ 500 ns. For a `Process` taking 1 millisecond, this is 0.05% overhead. For a `Process` taking 1 microsecond, this is 50% overhead.

These numbers are approximate and vary by CPU, contention level, and Go version. Benchmark your own setup if it matters.

---

## Appendix — Worker Goroutine in pprof

If you take a `goroutine` profile during normal operation, you typically see the worker goroutines parked in one of two places:

1. **`chan receive`** in `runtime.chanrecv` — they are blocked on the outer select waiting for either `closeChan` or a successful send to `reqChan`.
2. **`select`** in `workerWrapper.run` — they are in the select itself.

You will not normally see workers in `runtime.gopark` for other reasons unless they are mid-`Process` doing IO (e.g. `chan receive` inside user code, `net.Read`, etc).

If you see workers in odd places, investigate. They are probably mid-`Process` doing something interesting.

---

## Appendix — Reading the Tunny Repository

Beyond `tunny.go` and `workerwrapper.go`, the repo contains:

- `go.mod` — module declaration.
- `README.md` — short usage examples.
- `LICENSE` — MIT.
- `tunny_test.go` — the test suite.

Read the README once. Read the tests once. The whole repo can be ingested in 30 minutes. That investment pays back forever.

---

## Appendix — Extending With a Worker Pool Manager

In a large service you may have many pools — one per workload kind. Manage them collectively:

```go
type PoolRegistry struct {
    pools map[string]*tunny.Pool
    mu    sync.RWMutex
}

func (r *PoolRegistry) Register(name string, p *tunny.Pool) {
    r.mu.Lock()
    defer r.mu.Unlock()
    if r.pools == nil {
        r.pools = make(map[string]*tunny.Pool)
    }
    r.pools[name] = p
}

func (r *PoolRegistry) Get(name string) (*tunny.Pool, bool) {
    r.mu.RLock()
    defer r.mu.RUnlock()
    p, ok := r.pools[name]
    return p, ok
}

func (r *PoolRegistry) CloseAll() {
    r.mu.Lock()
    defer r.mu.Unlock()
    for _, p := range r.pools {
        p.Close()
    }
    r.pools = nil
}

func (r *PoolRegistry) Stats() map[string]int64 {
    r.mu.RLock()
    defer r.mu.RUnlock()
    out := make(map[string]int64, len(r.pools))
    for name, p := range r.pools {
        out[name] = p.QueueLength()
    }
    return out
}
```

A small registry makes monitoring uniform. Every pool reports queue length under its name. Aggregate dashboards become trivial.

---

## Appendix — Extending With a Builder Pattern

Constructing a tunny pool with all the wrappers can get verbose. A builder helps:

```go
type Builder struct {
    size       int
    factory    func() tunny.Worker
    metrics    bool
    panicSafe  bool
    name       string
}

func NewBuilder() *Builder {
    return &Builder{size: runtime.NumCPU()}
}

func (b *Builder) Size(n int) *Builder        { b.size = n; return b }
func (b *Builder) Factory(f func() tunny.Worker) *Builder { b.factory = f; return b }
func (b *Builder) Metrics() *Builder          { b.metrics = true; return b }
func (b *Builder) PanicSafe() *Builder        { b.panicSafe = true; return b }
func (b *Builder) Name(s string) *Builder     { b.name = s; return b }

func (b *Builder) Build() *tunny.Pool {
    factory := b.factory
    if b.panicSafe {
        inner := factory
        factory = func() tunny.Worker {
            return &panicSafeWorker{inner: inner()}
        }
    }
    if b.metrics {
        inner := factory
        factory = func() tunny.Worker {
            return &observedWorker{inner: inner(), name: b.name}
        }
    }
    return tunny.New(b.size, factory)
}
```

Usage:

```go
pool := NewBuilder().
    Size(16).
    Name("image-resize").
    Factory(func() tunny.Worker { return &imageWorker{} }).
    Metrics().
    PanicSafe().
    Build()
```

The decorators are applied in a specific order: panic-safe is innermost, metrics outermost. This is a typical decorator-composition pattern.

---

## Appendix — Extending With Middleware

Similar to HTTP middleware, you can chain Worker decorators:

```go
type Middleware func(tunny.Worker) tunny.Worker

func Compose(mws ...Middleware) Middleware {
    return func(w tunny.Worker) tunny.Worker {
        for i := len(mws) - 1; i >= 0; i-- {
            w = mws[i](w)
        }
        return w
    }
}

var WithMetrics Middleware = func(w tunny.Worker) tunny.Worker {
    return &observedWorker{inner: w}
}

var WithPanicRecovery Middleware = func(w tunny.Worker) tunny.Worker {
    return &panicSafeWorker{inner: w}
}

var WithLogging Middleware = func(w tunny.Worker) tunny.Worker {
    return &logWorker{inner: w}
}

func MakePool(n int) *tunny.Pool {
    mw := Compose(WithLogging, WithMetrics, WithPanicRecovery)
    return tunny.New(n, func() tunny.Worker {
        return mw(&realWorker{})
    })
}
```

If you want, you can model this as a slice of middlewares applied in order. The shape mirrors `http.Handler` middleware. Many engineers are already fluent in it.

---

## Appendix — Coordinating Multiple Pools

A common production shape: a service has 3-5 pools. They need to be coordinated on startup, shutdown, and health.

```go
type Service struct {
    pools []*tunny.Pool
    names []string
}

func (s *Service) Add(name string, p *tunny.Pool) {
    s.pools = append(s.pools, p)
    s.names = append(s.names, name)
}

func (s *Service) Health() error {
    for i, p := range s.pools {
        if p.QueueLength() > 1000 {
            return fmt.Errorf("%s queue too long", s.names[i])
        }
    }
    return nil
}

func (s *Service) Shutdown(ctx context.Context) error {
    var g errgroup.Group
    for _, p := range s.pools {
        p := p
        g.Go(func() error {
            done := make(chan struct{})
            go func() { p.Close(); close(done) }()
            select {
            case <-done:
                return nil
            case <-ctx.Done():
                return ctx.Err()
            }
        })
    }
    return g.Wait()
}
```

Parallel shutdown is faster than serial. Each pool independently waits its in-flight calls.

---

## Appendix — Inside `runtime/trace`

If you compile your tunny application with `runtime/trace` and view in `go tool trace`:

- Each worker goroutine appears as a separate timeline.
- `Process` calls show as solid blocks of execution.
- `BlockUntilReady` (if it blocks) shows as gaps.
- Channel operations appear as small synchronization markers.

For a load test of 100k calls, the trace is large but illuminating. You can see exactly when workers are saturated, when they are idle, when the dispatcher is bottlenecked.

Spend 30 minutes with a real trace. The understanding gain is worth it.

---

## Appendix — A Note on Process Reproducibility

If you run the same program twice — same payloads, same pool size — you get different distributions of work across workers. The Go runtime's pseudo-random selection in `select` and the scheduler's decisions mean the order of dispatch is non-deterministic.

This is by design. If your tests depend on dispatch order, your tests are wrong. Test outcomes (results are correct), not paths (which worker did which).

For reproducibility, use a pool of size 1. Then dispatch is strictly serial. This is occasionally useful in tests.

---

## Appendix — Final Code Quiz

Without scrolling up, answer these. Write your answers down. Then compare.

1. What is the order of `defer` statements in `workerWrapper.run` and why?
2. Which channel does the worker write to and which does the caller write to?
3. What happens to `req.retChan` when `ProcessTimed` times out in phase 3?
4. Why is `reqChan` unbuffered?
5. What is the difference between `interruptChan` and `closeChan`?
6. Why does `Close` call `stop()` on all workers before `join()`-ing them?
7. What is `queuedJobs` an `int64` not an `int32`?
8. Why does tunny not catch worker panics?
9. What is the relationship between `pool.GetSize()` and `pool.QueueLength()`?
10. What is the simplest scenario where `Interrupt` is called but the worker is not in `Process`?

Answers:

1. `close(closedChan)` is deferred first, then `Terminate()`. Defers run in reverse. So `Terminate` runs first, then `closedChan` is closed. This ensures `Close` callers (waiting on `closedChan`) observe `Terminate` has finished.
2. Worker writes the `workRequest` to `reqChan`. Caller writes the payload to `jobChan`. Worker writes the result to `retChan`.
3. The result is sent to `retChan` by the worker (eventually, when `Process` returns). The caller is no longer listening (it returned with an error). The send blocks on `retChan` forever, unless `retChan` is buffered (which it typically is, with size 1) — in which case the send completes but the value is discarded by GC.
4. So that the rendezvous is atomic — a worker offering itself succeeds only when a caller is ready, and vice versa. No queue grows behind the scenes.
5. `interruptChan` is per-call cancellation (the worker should stop the current `Process`). `closeChan` is lifetime termination (the worker should exit altogether).
6. So shutdown is parallel, not serial. Telling all workers to stop simultaneously lets them all complete their current `Process` in parallel rather than serially.
7. To match `atomic.Int64` semantics. The atomic package handles 64-bit operations more uniformly across platforms.
8. Design choice: explicit over implicit. Users decide whether to silence panics.
9. `QueueLength` is total in-flight + queued. `GetSize` is configured worker count. Effective in-flight is `min(QueueLength, GetSize)`; effective queue is `max(0, QueueLength - GetSize)`.
10. The worker is in `BlockUntilReady` (not yet in `Process`) when `ProcessTimed` times out during phase 1. But in that case, no `interruptFunc` is called because no `req` was paired with the worker. The only case where `Interrupt` is called but the worker is not in `Process` is the race window where `Process` just returned but the worker has not yet looped back. The `interruptChan` send catches this; the outer select consumes it harmlessly.

If you got most of these, you have fully absorbed the senior material.

---

## Truly Final Words

You started this file knowing how to use tunny. You finish it knowing how tunny works. The next file — `professional.md` — is about deploying tunny to production and operating it under real conditions. Less code-reading, more operations thinking.

The library is small. The depth is real. Carry both: the appreciation that tunny does very little, and the understanding that what it does, it does precisely. That combination — minimal mechanism, exact semantics — is the hallmark of good systems code.

End of senior.

---

## Bonus Appendix — Engineering Case: Diagnosing a Real Pool Issue

Here is a realistic scenario you might encounter in production, walked through with the senior-level toolkit.

### The symptom

A service that uses tunny for thumbnail generation starts reporting elevated 95th percentile latencies after a deploy. The pool size has not changed, the input distribution has not changed (from what you can see).

### Step 1 — gather data

Pull metrics for the last 24 hours:

- p50, p95, p99 latency for `pool.Process` (which you should be exporting).
- `QueueLength` over time.
- CPU utilization.
- Goroutine count.

You observe:

- p95 latency has roughly doubled.
- `QueueLength` is occasionally spiking to 200+.
- CPU is at 80% (was 60% before).
- Goroutine count is stable around (n_workers + handler_count).

The CPU jump suggests *something* is doing more work. The queue spikes suggest *something* is taking longer. The goroutine count stable means no leak.

### Step 2 — pprof

Pull a CPU profile:

```bash
go tool pprof http://prod-host:6060/debug/pprof/profile?seconds=30
(pprof) top --cum
(pprof) list myWorker.Process
```

You find that 70% of CPU is spent in `image.Decode`. Before the deploy, it was 50%. The work itself is slower per call.

### Step 3 — investigate

Diff the deployed changes. You find that someone introduced an extra `image/png` decode path for a new file format. The new path is slower per call than the old JPEG-only path.

### Step 4 — confirm

Look at logs: are images of the new format actually arriving? Yes — 15% of traffic is now the new format.

So: 15% of traffic now takes 2x longer. Average work-time went up by ~15%. The pool, being fixed size, has effectively the same dispatch rate but each work item takes longer. Queue grows when arrivals temporarily exceed the slower service rate.

### Step 5 — decide

Options:

1. **Increase pool size.** From 8 to 12. Costs more CPU at peak, but reduces queue.
2. **Optimize the new path.** Switch from `image/png` to a faster library, or pre-resize before re-encoding.
3. **Separate pools.** One for JPEG, one for PNG. Different sizes if different costs.

Option 3 is cleanest if the two paths have markedly different latencies and you want fairness — JPEG users should not pay the cost of PNG users' work. Option 1 is the cheapest deploy.

### Step 6 — implement

Let us go with option 3. Refactor:

```go
type Service struct {
    jpegPool *tunny.Pool
    pngPool  *tunny.Pool
}

func (s *Service) Resize(ctx context.Context, j Job) (Result, error) {
    var pool *tunny.Pool
    if strings.HasSuffix(j.InPath, ".png") {
        pool = s.pngPool
    } else {
        pool = s.jpegPool
    }
    r, err := pool.ProcessCtx(ctx, j)
    // ...
}
```

Deploy. Watch metrics. Verify the queue spikes are gone and p95 returns to baseline.

### Step 7 — postmortem

Write up what happened. Add monitoring: per-format latency, per-pool queue length. Set alerts. Done.

---

This kind of debugging is what senior-level tunny knowledge enables. You did not need to read tunny's source for this — but understanding that the pool is fixed-size, that queue length means "callers waiting", and that pool size choice matters — that came from this file.

---

## Bonus Appendix — Production Lessons From Tunny

A miscellany of operational lessons learned over years of running tunny in production:

1. **Pool size is more art than science.** Start with `NumCPU`. Adjust based on real traffic.
2. **Per-format / per-kind pools beat one giant pool.** Easier to reason about, easier to alert on.
3. **Always log when queue spikes.** A queue spike is the early indicator of cap problems.
4. **Always export `QueueLength` as a metric.** It is your primary saturation signal.
5. **`Close` must run cleanly.** Test it. Make sure shutdown does not leak.
6. **Always recover panics in `Process`.** A bad payload should not crash the service.
7. **Wrap pool with a typed adapter** at module boundary. The `any`s are noise.
8. **Test under realistic concurrency in CI.** A pool that works with 4 callers may not with 4000.
9. **Profile in production** with `pprof` enabled and rate-limited.
10. **Document why your pool is sized the way it is.** Future-you will thank you.

These ten points are the operational result of reading this file in anger.

---

## Bonus Appendix — Where Senior Material Ends and Professional Begins

The senior file covered:

- The internals.
- Comparisons with alternatives.
- Memory model and scheduler interactions.
- Race conditions.
- Extension patterns.

The professional file will cover:

- Production deployment (binaries, configs, environments).
- Observability (metrics, traces, logs).
- Graceful shutdown integration with HTTP servers and signal handlers.
- Capacity planning and load testing.
- Real case studies from production services.

You need both to operate tunny well. Senior teaches you why; professional teaches you how to keep it healthy.

---

## Bonus Appendix — Reading List

Books and articles that pair well with the senior material:

- *The Go Programming Language* by Donovan & Kernighan — Chapter 8 on Goroutines and Channels.
- Dave Cheney's blog — many posts on channels and concurrency idioms.
- Russ Cox's articles on the Go scheduler.
- The Go runtime source — `runtime/proc.go` and `runtime/chan.go`.
- Tunny's GitHub issue tracker — read the closed issues for design discussions.

None of these are required. All of them are rewarding.

---

## Bonus Appendix — Reflections on Library Size

Tunny is small. About 400 lines. This is a feature.

The opposite extreme — a 100,000-line "concurrency framework" — has trade-offs:

- It probably does everything you want, but in a specific way.
- It is hard to read end-to-end.
- It is hard to modify.
- Bugs in it are bugs you cannot fix without engaging the maintainer.

Small libraries like tunny have the opposite trade-offs:

- They do little, but very precisely.
- You can read the entire library in an hour.
- You can fork and modify with confidence.
- Bugs you find, you can usually fix yourself.

Lean toward small libraries when you have a choice. The fact that you spent a week reading this file is not a counter-example — it is a one-time investment that pays back forever.

---

## Bonus Appendix — When to Replace Tunny

Eventually you may grow beyond tunny. Signs:

1. **You need dynamic resizing.** Tunny's `SetSize` works but is clunky.
2. **You need priority queues.** Build it on top, or use a custom library.
3. **You need backpressure that does not block callers.** `ProcessTimed` is a coarse approximation.
4. **You need overflow buffering.** Tunny has no overflow.
5. **You need different worker types in one pool.** Cleaner to multiplex with a dispatcher.

When you reach any of these, evaluate:

- Is the answer "wrap tunny with a layer that adds this"?
- Or is the answer "use a different library"?
- Or "build from scratch"?

The right answer depends on cost. Wrapping adds a small layer. A different library means relearning APIs. Building from scratch is the most flexible but most work.

For most teams, wrapping tunny suffices for a long time. Build the wrapper that fits your needs.

---

## Bonus Appendix — A Closing Statement

You finish this file knowing tunny as well as anyone who is not its maintainer. The library has no hidden mysteries. The patterns are clear. The performance characteristics are predictable.

This level of mastery is rare. Most engineers know the API of the libraries they use. Few know the internals. Fewer still can predict edge case behavior.

You now have that ability. Use it well — not to write clever code (cleverness is rarely the right move) but to write *confident* code. You know what tunny will do in any scenario. You can write code that exploits that knowledge without surprises.

The next time someone on your team asks "should we use tunny for this?", you have an answer. Not from a half-remembered blog post — from real understanding. That is the value of reading this file all the way through.

Now go build. The professional file is waiting when your build hits production.

---

## Bonus Appendix — Architectural Patterns Worth Knowing

Below are several architectural shapes for systems that include tunny. None of them are unique to tunny, but tunny tends to fit each cleanly.

### Pattern: Pipes-and-filters with pools at each filter

The image pipeline from middle.md is an instance of this. Each filter is a pool. Data flows from filter to filter. Each filter can be sized independently. Backpressure propagates by the slowest filter setting the pace.

```
[input queue] -> [decode pool] -> [resize pool] -> [encode pool] -> [output sink]
```

Pros: each stage independently scalable, monitorable, restartable.
Cons: many goroutines, additional latency from intermediate queues.

### Pattern: Single pool fronting many caller types

A single tunny pool fronts a hot operation that many callers need. The pool is the "service".

```
[handler A] ─┐
[handler B] ─┼─► [tunny pool] ─► [shared expensive operation]
[handler C] ─┘
```

Pros: simple. All callers share the same backpressure surface.
Cons: a slow caller's work blocks fast callers' work (head-of-line blocking).

### Pattern: Bulkheads via per-tenant pools

For multi-tenant services, each tenant gets its own pool. A noisy tenant cannot affect others.

```
tenant A: [pool A]
tenant B: [pool B]
...
```

Pros: isolation. Pros: per-tenant tuning.
Cons: many pools. Memory overhead. Operational complexity.

Use when SLA isolation between tenants matters.

### Pattern: Pool as a circuit-breakable resource

Wrap a pool with a circuit breaker. When the pool's queue is too long, the breaker opens — callers get immediate errors instead of queueing.

```go
func (s *Service) Do(ctx context.Context, in In) (Out, error) {
    if s.breaker.Open() {
        return zero, ErrCircuitOpen
    }
    if s.pool.QueueLength() > s.queueLimit {
        s.breaker.RecordFailure()
        return zero, ErrBusy
    }
    out, err := s.pool.ProcessCtx(ctx, in)
    if err != nil {
        s.breaker.RecordFailure()
    } else {
        s.breaker.RecordSuccess()
    }
    return out.(Result[Out]).Unwrap()
}
```

Pros: degrades gracefully under load. Pros: avoids cascading failures.
Cons: callers must handle the rejection.

### Pattern: Pool driven by Kafka or similar queue

The pool's callers are workers reading from a message queue. Each message becomes a `Process` call.

```
[kafka] ─► [consumer goroutines] ─► [tunny pool] ─► [downstream]
```

The number of consumers can be larger than the pool size — they queue on the pool.

Pros: durable input (kafka holds the messages). Cons: more moving parts.

This is a very common shape for offline processing services.

---

## Bonus Appendix — Anti-Patterns

A few designs that look reasonable but cause problems.

### Anti-pattern: pool inside a request handler

```go
func handler(w http.ResponseWriter, r *http.Request) {
    pool := tunny.NewFunc(4, work)
    defer pool.Close()
    // ... use pool
}
```

Pool per request. Goroutines created and destroyed every request. Slower than just calling `work` directly. Plus the per-request goroutines pile up under load.

**Fix:** create the pool once, pass it to handlers.

### Anti-pattern: oversized pool

```go
pool := tunny.NewFunc(1000, work)
```

For CPU-bound work, this gives no extra throughput and adds context switch overhead. Pool size should match the relevant constraint, not be "as large as possible".

**Fix:** start at `NumCPU` and tune.

### Anti-pattern: catching all results in a slice without sizing

```go
results := []Result{}
var mu sync.Mutex
for _, j := range jobs {
    j := j
    go func() {
        r := pool.Process(j).(Result)
        mu.Lock()
        results = append(results, r) // expensive resizing
        mu.Unlock()
    }()
}
```

Each `append` may resize the slice. With many concurrent appends, the mutex is contended.

**Fix:** pre-allocate the slice (`results := make([]Result, 0, len(jobs))` or `results := make([]Result, len(jobs))` with index-based writes).

### Anti-pattern: pool size driven by request rate

If you size your pool to "handle 1000 RPS", you have probably oversized it. CPU-bound pools should be sized to cores. If you have 1000 RPS but each call takes 1 ms on one core, you can handle 1000 calls/sec with 1 worker.

**Fix:** size pools to capacity (cores or downstream limits), not throughput.

### Anti-pattern: silent error swallowing

```go
out, _ := pool.ProcessCtx(ctx, x)
// use out without checking err
```

If `out` is nil because of an error, the next line crashes. Always check `err`.

**Fix:** handle the error. Map to appropriate response.

---

## Bonus Appendix — Tunny in a Microservice Architecture

In a microservice, tunny typically lives in a service that does "the work":

- Image processing service.
- ML inference service.
- Report rendering service.
- PDF generation service.

The service exposes an HTTP or gRPC API. Inside, the work is dispatched through a pool. Other services call the API; they do not see tunny.

This separation is healthy:

- The pool's size is tuned to the pod's resources.
- The pool's existence is hidden from callers — they just see a slow API.
- Multiple replicas of the service can each have their own pool, and load balancing spreads requests across replicas.

The combined system gives you horizontal scaling (more replicas) and vertical scaling (larger pools on bigger pods). Both work together.

For a stateless service, replicas can be added freely. For stateful workers (cached models), replicas are heavier — each must load the model.

---

## Bonus Appendix — Tunny in a Serverless Function

What if your service is a serverless function (AWS Lambda, GCP Cloud Functions)? Tunny can still work:

- Each invocation creates a fresh process.
- The pool is created at cold-start, used during the invocation, closed (or left to be GC'd) at end.
- For frequent invocations with execution context reuse, the pool persists across invocations within the same container.

But: serverless typically has a *single* request per process. Bounding concurrency within one process is less useful. Tunny's value is highest when you have many concurrent callers within one process.

For pure serverless, consider whether you need tunny at all. Simple `go work(x)` may suffice.

---

## Bonus Appendix — Tunny With a Service Mesh

In a service mesh (Istio, Linkerd), inbound traffic is mediated by a sidecar. The sidecar can rate-limit, do circuit breaking, etc.

Tunny lives inside your service. It does not know about the sidecar. The sidecar does not know about tunny.

They cooperate naturally:

- Sidecar drops requests above its rate limit. Tunny never sees them.
- Tunny processes whatever the sidecar lets through. Bounded by pool size.
- If tunny's queue is full, your service returns 503 to the sidecar, which retries or fails-over.

Two layers of bounded concurrency. Each is independent.

The lesson: tunny is one layer in a larger system. Tune each layer for its concern.

---

## Bonus Appendix — Final Pieces

A grab-bag of senior-level points that did not fit elsewhere.

- **Avoid global pools.** They make testing hard and create implicit dependencies. Pass pools explicitly.
- **Pool the right thing.** Pool the *workers*, not the *callers*. Tunny does this correctly.
- **Tunny is not a thread pool.** It is a goroutine pool. The OS thread count is determined by `GOMAXPROCS` and cgo activity, not by your pool size.
- **Tunny is not a queue.** It does not buffer items. The "queue length" is the number of waiting callers, not stored items.
- **Tunny does not retry.** A failed `Process` call is failed. Retry at the caller if appropriate.

These are points that newcomers to tunny often get wrong. Now you do not.

---

The senior file is a thick read. You should not need to come back to it often after the first time. Bookmark the diagrams and the "tricky questions" section — those are the things you may want to reference under stress.

Onward.

---

## Bonus Appendix — Twenty Internal Behaviors Worth Remembering

A condensed list of internal behaviors that distinguish "I read the source" from "I just used the API":

1. The pool's `reqChan` is unbuffered.
2. The dispatcher is inverted — workers offer, callers consume.
3. `BlockUntilReady` is called every iteration, even if no work flowed.
4. `Interrupt` runs in the caller's goroutine.
5. `Terminate` runs as a `defer` in the worker's goroutine.
6. `Process` panics are not caught by tunny.
7. `Close` waits for in-flight `Process` calls to finish naturally.
8. `Close` calls `stop` on all workers before joining any of them.
9. `SetSize(n)` for shrinking blocks until excess workers finish current calls.
10. `ProcessTimed` uses a single timer covering all three phases.
11. `ProcessCtx` cancellation closes `ctx.Done()`, which fires the select branch.
12. `QueueLength` counts callers in flight + waiting, not separate queue items.
13. `interruptChan` is consumed by the outer select to handle stale interrupts.
14. The `workRequest` is sent worker→pool→caller, not caller→pool→worker.
15. `jobChan` and `retChan` are per-worker, reused across calls.
16. Tunny does not pool the `workRequest` itself.
17. `runtime.NumGoroutine()` reflects `n` worker goroutines plus your callers.
18. Tunny does not call `runtime.LockOSThread`.
19. Tunny does not influence GC.
20. Tunny's source is ~400 lines.

If any of these are unfamiliar, scroll back. They are the essence of the senior level.

---

## Bonus Appendix — Comparative Table: Pool Libraries

```
                    | tunny                  | ants                   | workerpool
--------------------|------------------------|------------------------|--------------------
Submission API      | Process (sync)         | Submit closure (async) | Submit closure (async)
Pool size           | Fixed, can SetSize     | Dynamic, min/max       | Fixed
Backpressure        | Caller blocks          | Configurable           | Bounded queue
Cancellation        | ProcessCtx, Interrupt  | Context per task       | None
Per-worker state    | First-class (Worker)   | Awkward                | Awkward
Idle reaping        | No                     | Configurable           | Yes
Source size         | ~400 LOC               | ~2000 LOC              | ~300 LOC
Best for            | Stateful CPU-bound     | High-volume IO/CPU     | Simple submit-forget
```

For more depth, see the [when-to-use](../04-when-to-use/) page.

---

## Bonus Appendix — The Larger Lesson

Reading tunny in depth teaches you a meta-skill: how to read concurrency libraries in general. The skills you used here apply to:

- Reading the Go standard library's `sync` package.
- Reading `errgroup`, `semaphore`, `singleflight`.
- Reading `ants`, `workerpool`, and other third-party pools.
- Reading concurrency primitives in other languages.

The pattern: identify the channels (or locks), identify the lifecycle, identify the synchronization points, identify the unhappy paths.

This pattern works for any concurrency code you encounter. Tunny is a small enough specimen that you can practice on it without spending weeks. Use it as a training ground for reading larger concurrency code.

---

## Bonus Appendix — Operational Cheatsheet

When you are on-call and a tunny-based service is misbehaving, here is what to check:

1. **Pool size vs CPU usage.** If CPU is high and queue is growing, you may need more workers.
2. **Pool size vs downstream limits.** If queue is growing but CPU is low, your workers are waiting on something downstream.
3. **`QueueLength` trend.** A sustained climb is the early indicator of cap problems.
4. **`Process` latency.** If latencies grow without queue growth, individual work is slower. Profile.
5. **Goroutine count.** Sudden growth suggests a leak — maybe pool creation in a hot path.
6. **Panic logs.** If you see worker panics, recover them.
7. **Shutdown logs.** If you see "Close" not returning, check for stuck `BlockUntilReady` or stuck `Process`.

Print this list, tape it next to your monitor. It will save your shift.

---

End of senior. Onwards to professional.

---

## Bonus Appendix — Frequently Misunderstood Internals (FMI)

A short collection of points that even experienced Go engineers get wrong about tunny on the first read. If you understand all of these, you have truly absorbed the file.

### FMI 1 — The dispatcher does not have a separate goroutine

Many people assume "the pool" is a goroutine that does dispatch. It is not. The dispatcher is the cumulative effect of `n` worker goroutines all reading from / writing to channels. There is no central manager.

This explains why scaling tunny is so cheap: no coordinator becomes the bottleneck.

### FMI 2 — Worker fairness is best-effort

`select` chooses pseudo-randomly. Over many calls, all workers see roughly equal load. Over a few calls, distribution may be skewed. Do not rely on "every worker gets exactly N/k calls" — they will get approximately that, not exactly.

### FMI 3 — `Process` is goroutine-safe even with re-entrancy

You can call `pool.Process` from inside the worker's `Process`. It is goroutine-safe. The only risk is deadlock if you saturate the pool. The library does not detect this; it is your responsibility to avoid recursive saturation.

### FMI 4 — `Interrupt` is not guaranteed to fire exactly once

Tunny calls `Interrupt` once per deadline event. But race conditions in your code can cause it to fire when you do not expect — e.g. just as `Process` is returning. Implement `Interrupt` idempotently.

### FMI 5 — The pool does not measure `Process` duration

If you want histograms of `Process` latency, you must wrap and measure yourself. Tunny does not give you durations.

### FMI 6 — Pool size cannot be queried atomically with use

`GetSize` returns the current size. But by the time you act on it, another goroutine may have called `SetSize`. There is no compound "if size > N do X" operation. If you need that, hold an external lock.

### FMI 7 — Closing twice is a panic, not an error

Some people expect `Close` to return an `error` on second call. It does not. It panics. Be careful.

### FMI 8 — The "worker pool" abstraction is not unique

Many libraries call themselves "worker pools" and have different semantics. Always check whether the library is submit-forget (most) or synchronous-process (tunny).

### FMI 9 — `BlockUntilReady` is not for graceful shutdown

It is for backpressure. If you want to drain the pool gracefully, monitor `QueueLength` and wait. `BlockUntilReady` cannot help with draining.

### FMI 10 — Tunny does not adapt to load

Pool size is set by you, not by tunny. If load doubles, your pool size does not. You must monitor and `SetSize`, or accept higher latency.

These ten FMIs are the most common surprises. If you internalize them, you avoid the most common production issues.

---

## Bonus Appendix — Mapping Mental Models

If you come to tunny from a different background, here are mappings:

- From Java's `ExecutorService`: tunny is like a `FixedThreadPool` where `submit(callable).get()` is your only API.
- From Python's `concurrent.futures`: tunny is like `ThreadPoolExecutor` with `submit().result()` always called immediately.
- From Rust's `tokio::spawn`: tunny is more like `tokio::task::JoinHandle` with bounded parallelism, plus the worker holds state.
- From Erlang/OTP: tunny is like a pool of `gen_server` workers, each accepting messages and replying synchronously.
- From C# `Task.Run`: tunny is like a custom `TaskScheduler` with fixed worker count.
- From a raw `thread::spawn` model: tunny is the "managed equivalent" with bounded concurrency.

Each comparison loses something. Use them as starting points, not definitions.

---

## Bonus Appendix — Mental Recap

If you have read this file to the end, here is a 60-second recap to lock things in.

- Tunny is a fixed-size pool of long-lived worker goroutines.
- The `Worker` interface has four methods: `Process`, `BlockUntilReady`, `Interrupt`, `Terminate`.
- Dispatch is inverted: workers offer themselves on `reqChan`; callers consume offers.
- `Process` is synchronous: caller blocks until worker has a result.
- `ProcessTimed` and `ProcessCtx` add deadlines via select on `time.Timer.C` or `ctx.Done()`.
- `Close` is two-phase: stop, then join. It is not idempotent.
- The source is short. Read it.

That is the entire senior file in 100 words.

---

## Truly Final Note

Tunny is a tool. This file gave you the tool's specification, history, and operating manual. Whether you use tunny in production is your decision; whether you can use it correctly is now beyond question.

The professional file builds on this with deployment, observability, and case studies. The remaining files are exercises and reference. Pick what you need.

Above all: build something with tunny, watch it run, observe its behavior. Reading alone will not solidify what you have read. Code alone will not give you the depth this file offered. Both together produce true expertise.

Good luck. Use the library well. Build interesting things.

---

## Bonus Appendix — Worked Internal Scenarios

To consolidate, here are five complete scenarios traced through tunny's internals at the same level of detail used throughout this file.

### Scenario 1 — Empty pool receives a Process

Setup: pool size 2, both workers idle in their dispatcher select.

1. Worker W1 calls `BlockUntilReady` (returns immediately). Enters select with case `reqChan <- workRequest{...}`.
2. Worker W2 does the same.
3. Both workers are pending sends on the unbuffered `reqChan`.
4. Caller calls `Process(payload)`. Caller does `<-reqChan` — receive on the channel.
5. Runtime picks one pending send. Say it picks W1's. W1's case is selected; it executes the body (reads from its `jobChan`).
6. Caller has the `workRequest`. Caller sends `payload` on `req.jobChan`. W1 has been waiting on that channel; receives.
7. Caller now does `<-req.retChan`. W1 calls `worker.Process(payload)`.
8. After `Process` returns, W1 sends result on `retChan`. Caller receives.
9. W1 loops back to `BlockUntilReady`. W2 is still pending its earlier `reqChan` send.
10. W1 re-enters select. Now there are two pending sends on `reqChan` again. The cycle repeats.

Key insight: W2 was patient. Its send on `reqChan` never canceled or completed during this whole scenario. It was just waiting. When the next caller arrives, W2 might serve them.

### Scenario 2 — Caller times out during phase 1

Setup: pool size 1, single worker is mid-`Process` doing a 10-second computation. Caller A calls `ProcessTimed(payload, 1 * time.Second)`.

1. Caller A creates a 1-second timer. Enters phase 1 select: `<-reqChan` or `<-timer.C`.
2. The worker is busy in `Process`; it has not yet looped back to write to `reqChan`. So `<-reqChan` blocks.
3. 1 second passes. Timer fires. `<-timer.C` is selected.
4. Caller A returns `(nil, ErrJobTimedOut)`. Caller A is gone.
5. The worker, after another 9 seconds, finishes `Process`. It returns. It tries `retChan <- result`. The retChan is buffered (size 1) in standard tunny — so the send completes; the value is discarded.
6. Worker loops back to `BlockUntilReady`. Available again.

Key insight: a phase-1 timeout never reaches the worker. The worker has no idea anything happened. From the worker's view, it just finishes its work and is available again.

### Scenario 3 — Caller times out during phase 3 (work in progress)

Setup: pool size 1, idle. Caller A calls `ProcessTimed(payload, 1 * time.Second)`. Work takes 10 seconds.

1. Caller A enters phase 1. Worker is idle, has written to `reqChan`. Caller A reads. Worker's send completes.
2. Caller A enters phase 2: send payload. Worker is waiting on `jobChan`. Send completes immediately.
3. Caller A enters phase 3: `<-retChan` or `<-timer.C`. Timer has been ticking the whole time.
4. Worker is computing. 1 second passes. Timer fires.
5. Caller A's `<-timer.C` is selected. Caller A calls `req.interruptFunc()`.
6. `interruptFunc` sends on `interruptChan` (non-blocking) and calls `worker.Interrupt()`.
7. The worker's `Interrupt` method runs in the caller's goroutine. It signals the worker's running `Process` to stop. If `Process` is honoring the signal (e.g. via a cancelled context), it returns early.
8. Caller A returns `(nil, ErrJobTimedOut)`. 
9. The worker eventually finishes `Process` (early or late). The result is sent on retChan but discarded.
10. Worker loops back.

Key insight: the worker's `Interrupt` is the integration point. If you implement it, cancellation is fast; if you do not, the worker keeps running but the caller has already given up.

### Scenario 4 — Pool is closed while a caller is waiting

Setup: pool size 1, worker mid-`Process`. Caller A is in phase 1 (waiting on `reqChan`).

1. Caller B (a goroutine somewhere) calls `pool.Close()`.
2. `Close` acquires `workerMut`.
3. `Close` calls `stop` on the worker (close `closeChan`).
4. `Close` calls `join` on the worker (wait on `closedChan`).
5. The worker, mid-`Process`, does not see `closeChan` until it loops back. It must finish its current work.
6. Eventually `Process` returns. Worker sends result on `retChan` (no caller waiting, buffered, discarded).
7. Worker loops back to `BlockUntilReady`, then enters select. `<-closeChan` is selected. Worker returns.
8. Deferred `Terminate()` runs. Deferred `close(closedChan)` runs.
9. `Close` was waiting on `closedChan`; now proceeds.
10. `Close` closes `p.reqChan`.
11. Caller A's `<-reqChan` returns `(zero, false)`. Caller A's `Process` panics with `ErrPoolNotRunning`.

Key insight: callers stranded by `Close` get a panic, not an error. To survive this, callers must coordinate (e.g. `sync.WaitGroup` to ensure no callers are mid-Process when `Close` runs).

### Scenario 5 — Worker panics in Process

Setup: pool size 2, both workers idle. Caller A calls `Process(badPayload)`.

1. Dispatch happens normally. Worker W1 receives the payload.
2. W1 calls `worker.Process(badPayload)`. Inside, `Process` does `n := badPayload.(int)`. The payload is actually a string. Panic.
3. The panic propagates up the stack. It exits W1's `workerWrapper.run`.
4. Deferreds run: `worker.Terminate()` (might itself panic if not implemented carefully), then `close(closedChan)`.
5. The panic is NOT caught. The whole process crashes.

Key insight: tunny does not protect you from panics. Always `recover` in your `Process` if you cannot trust the payload.

If we add a recover wrapper:

```go
func (w *safeWorker) Process(p any) (out any) {
    defer func() {
        if r := recover(); r != nil {
            out = fmt.Errorf("panic: %v", r)
        }
    }()
    return w.inner.Process(p)
}
```

The panic is caught. `Process` returns an error wrapper. `workerWrapper.run` does not panic. The worker is reusable. The process does not crash.

---

These five scenarios cover almost every interesting interaction between tunny and your code. Walking through them with the source open is the single most valuable thing you can do after reading this file.

---

## Truly Final Words

End of senior. You know tunny. You know channels. You know goroutines. You know the trade-offs. You know the edge cases.

Now go and use this knowledge to write code that is better than the average. Code that is correct under load. Code that fails gracefully. Code that is observable. Code that future-you can read.

Tunny is just a library. The principles you learned reading it are universal. Apply them everywhere.

---

## Appendix — One More Hands-On Exercise

Build a small program that demonstrates each of the following, one at a time:

1. A pool of size 4 that processes 100 integer payloads in parallel.
2. The same, but with a `Worker` interface and per-worker counter.
3. The same, but with `ProcessTimed` and half the calls timing out.
4. The same, but with `ProcessCtx` and context cancellation from main.
5. The same, but with `BlockUntilReady` enforcing a 100 ms rate limit.
6. The same, but with `Interrupt` cancelling mid-work.
7. The same, but with `Terminate` releasing a fake resource.
8. The same, but using `SetSize` to grow during execution.
9. The same, but with `QueueLength` monitored every 100 ms.
10. The same, but with all of the above combined.

Each of these is 30-50 lines. Doing all ten in one sitting (about 1-2 hours) cements the senior material in muscle memory. Highly recommended.

---

## Appendix — Closing Image

Imagine you stand at the front of a small library. The shelves are short — only 400 lines of Go. You have read every shelf. You know where every book is. You know how the books interrelate, what they reference, what they leave out.

That is what you have just achieved with tunny. Few engineers achieve this level of intimacy with any third-party library. Carry it with pride, and replicate the experience for every other library you depend on heavily.

The senior file ends here. The professional file is next, but on a different time scale — read it when you have weeks of production tunny experience to compare against. Until then, build. Run. Observe. Measure. Tune.

---

## Appendix — Where to Go From Here

Next files:

- [professional.md](professional.md) — production deployment and operations.
- [specification.md](specification.md) — concise API reference.
- [interview.md](interview.md) — practice for technical interviews and design discussions.
- [tasks.md](tasks.md) — exercises with graded difficulty.
- [find-bug.md](find-bug.md) — buggy snippets, sharpen your eye.
- [optimize.md](optimize.md) — performance scenarios and tuning.

You do not need to read them all. Pick what is useful right now. The depth in this file should carry you through most of them quickly — the senior level is the bedrock; the others are applications and exercises.

Welcome to true tunny competence. The library is one of many small, sharp tools in the Go ecosystem. Carry it well.

---

## Final Reflection — Why This File Was Long

You may have noticed this file is unusually long. There is a reason.

Concurrency is one of the few topics in Go where surface-level reading is dangerous. You can use channels for years and still misunderstand `select` semantics in subtle cases. You can use goroutines daily and still leak them. You can use a pool library and still write deadlock-prone code.

To prevent that, this file went deep enough that you have no surface left. Every internal mechanism is laid bare. Every edge case is examined. Every comparison to similar tools is grounded.

The depth is not gratuitous. It is the minimum necessary to operate tunny in production with confidence. Concurrency without confidence becomes paranoia — and paranoid code is bloated, slow, and still wrong.

Read this file in chunks if it was too much for one sitting. Come back when you have questions. The material is dense; it is also stable. Tunny does not change quickly, and the principles here will outlast many library versions.

Onward.

---

## Acknowledgement

This file owes its depth to two sources: the tunny library's elegant simplicity, which rewards close reading; and the broader Go ecosystem's preference for small, sharp tools over large frameworks. Engineers who write Go in this spirit make libraries like tunny possible.

Read more such libraries. Write more such libraries. Carry the discipline forward.

End of senior file.

---

A final tip before you close this page: bookmark it. The first time through, you absorb the structure. The second time, the details snap into place. The third time, you spot patterns you missed. Tunny is small enough to revisit — and worth revisiting.

You are now equipped to debug and extend tunny. That capability transfers to many other Go libraries. Most are not larger; few are written with as much care. The bar is now set.

Read on.

Done.


