---
layout: default
title: Senior
parent: workerpool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/03-workerpool/senior/
---

# gammazero/workerpool — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Library Layout](#library-layout)
3. [The WorkerPool Struct](#the-workerpool-struct)
4. [New: Construction Walkthrough](#new-construction-walkthrough)
5. [The Dispatcher Loop](#the-dispatcher-loop)
6. [Submit: From User to Worker](#submit-from-user-to-worker)
7. [SubmitWait: The Done-Channel Trick](#submitwait-the-done-channel-trick)
8. [The Worker Goroutine](#the-worker-goroutine)
9. [Idle-Worker Reaping in Detail](#idle-worker-reaping-in-detail)
10. [The Internal Queue Structure](#the-internal-queue-structure)
11. [Stop and StopWait Implementation](#stop-and-stopwait-implementation)
12. [Pause Semantics](#pause-semantics)
13. [Synchronisation Primitives Used](#synchronisation-primitives-used)
14. [The Cost of Each Operation](#the-cost-of-each-operation)
15. [Comparison with a Hand-Rolled chan func() Pool](#comparison-with-a-hand-rolled-chan-func-pool)
16. [Comparison with ants](#comparison-with-ants)
17. [Comparison with tunny](#comparison-with-tunny)
18. [Dynamic Scaling Considerations](#dynamic-scaling-considerations)
19. [Custom Pool Patterns](#custom-pool-patterns)
20. [Adapting the Library for Your Needs](#adapting-the-library-for-your-needs)
21. [Memory Layout and Allocations](#memory-layout-and-allocations)
22. [Race Conditions That Could Exist](#race-conditions-that-could-exist)
23. [Tricky Internals](#tricky-internals)
24. [Edge Cases at the Library Level](#edge-cases-at-the-library-level)
25. [Debugging Pool Internals](#debugging-pool-internals)
26. [Common Senior-Level Mistakes](#common-senior-level-mistakes)
27. [Test](#test)
28. [Tricky Questions](#tricky-questions)
29. [Cheat Sheet](#cheat-sheet)
30. [Self-Assessment Checklist](#self-assessment-checklist)
31. [Summary](#summary)
32. [What You Can Build](#what-you-can-build)
33. [Further Reading](#further-reading)
34. [Related Topics](#related-topics)
35. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction

The junior file taught the API. The middle file taught the operations. The senior file teaches **the code**.

`gammazero/workerpool` is roughly 300 lines. By the end of this file you should be able to:

- Sketch the pool struct from memory.
- Explain the dispatcher loop's `select` block.
- Trace a `Submit` from the caller's goroutine to the worker's goroutine.
- Explain how idle workers are reaped, including the timer mechanism.
- Compare the design against `ants`, `tunny`, and a hand-rolled pool.
- Identify which design decisions are intentional and which are accidental.
- Decide whether to fork the library, wrap it, or replace it for a given need.

This is not about API mastery anymore. It is about understanding *why* the API behaves the way it does, with enough source-level knowledge that you can answer "what would happen if I changed X" with confidence.

This file uses an approximation of the library's code where helpful. Versions of `workerpool` differ in small ways; we describe the v1.x design. Read the actual source alongside if precision matters. The code we present is faithful to the public behaviour but may simplify naming or layout.

---

## Library Layout

The repository has, in essence, two source files:

```
workerpool.go              # the library
workerpool_test.go         # tests
```

No subpackages. No internal directories. The public type is `WorkerPool`. The constructor is `New`. Methods are `Submit`, `SubmitWait`, `Stop`, `StopWait`, `Stopped`, `WaitingQueueSize`, and (in newer versions) `Pause`.

This is intentionally small. The author has resisted feature creep for years. Open issues that request "metrics support" or "context-aware submit" tend to be closed with "wrap it yourself" — and they're right.

---

## The WorkerPool Struct

The struct, simplified:

```go
type WorkerPool struct {
    maxWorkers   int
    taskQueue    chan func()
    workerQueue  chan func()
    stoppedChan  chan struct{}
    stopSignal   chan struct{}
    waitingQueue deque.Deque[func()]
    stopLock     sync.Mutex
    waiting      int32
    stopped      bool
    wait         bool
}
```

Let us walk each field:

- `maxWorkers` — the cap on concurrent workers. Set at construction; read-only.
- `taskQueue` — an unbuffered channel of `func()`. This is what `Submit` writes to.
- `workerQueue` — an unbuffered channel of `func()`. This is what workers read from.
- `stoppedChan` — closed when shutdown completes. Used by `Stop` and `StopWait` to know "we're done".
- `stopSignal` — closed when shutdown begins. The dispatcher and workers watch this.
- `waitingQueue` — the deque (double-ended queue) of tasks waiting for a free worker.
- `stopLock` — protects `stopped` and `wait` (and the act of closing `stopSignal`).
- `waiting` — an atomic counter of tasks currently in `waitingQueue`. Exposed as `WaitingQueueSize`.
- `stopped` — bool, true after `Stop` or `StopWait` is called.
- `wait` — bool, true if `StopWait` (drain queue) vs `Stop` (discard).

The exact field names and types vary by version, but the *shape* is constant: two channels (input + output of dispatcher), a deque for queued tasks, a lock, and shutdown bookkeeping.

The two-channel design (`taskQueue` and `workerQueue`) is the key insight. Why two channels? Because the dispatcher needs to *choose* between feeding workers and accepting new submissions. With one channel, the choice is fixed by who reaches the channel first. With two channels and a `select`, the dispatcher has full control.

---

## New: Construction Walkthrough

`New(maxWorkers int)` does roughly:

```go
func New(maxWorkers int) *WorkerPool {
    if maxWorkers < 1 {
        maxWorkers = 1
    }
    pool := &WorkerPool{
        maxWorkers:  maxWorkers,
        taskQueue:   make(chan func()),
        workerQueue: make(chan func()),
        stoppedChan: make(chan struct{}),
        stopSignal:  make(chan struct{}),
    }
    go pool.dispatch()
    return pool
}
```

Things to note:

1. `maxWorkers < 1` is silently clamped to 1. This is friendly but ambiguous; some users would prefer a panic. The library's choice prevents `New(0)` from creating a pool that never runs anything.
2. Both channels are unbuffered. That is deliberate — buffered channels would let the dispatcher get "ahead" of itself, complicating the back-and-forth between submitter, dispatcher, and worker.
3. The dispatcher goroutine starts immediately. So `New` always leaks at least one goroutine until `Stop`/`StopWait`.
4. No worker goroutines are created here. Workers spin up lazily inside `dispatch` when there is work to do.

The constructor is intentionally synchronous and very short. There is no error to return — the only failure mode would be running out of goroutines, which would manifest as a runtime panic on `go pool.dispatch()`.

---

## The Dispatcher Loop

The heart of the library. Simplified:

```go
func (p *WorkerPool) dispatch() {
    defer close(p.stoppedChan)

    timeout := time.NewTimer(idleTimeout)
    var workerCount int
    var idle bool

Loop:
    for {
        if p.waitingQueue.Len() != 0 {
            if !p.processWaitingQueue() {
                break Loop
            }
            continue
        }

        select {
        case task, ok := <-p.taskQueue:
            if !ok {
                break Loop
            }
            select {
            case p.workerQueue <- task:
            default:
                if workerCount < p.maxWorkers {
                    go worker(task, p.workerQueue)
                    workerCount++
                } else {
                    p.waitingQueue.PushBack(task)
                    atomic.StoreInt32(&p.waiting, int32(p.waitingQueue.Len()))
                }
            }
            idle = false
        case <-timeout.C:
            if idle && workerCount > 0 {
                if p.killIdleWorker() {
                    workerCount--
                }
            }
            idle = true
            timeout.Reset(idleTimeout)
        }
    }

    // shutdown
    if p.wait {
        p.runQueuedTasks()
    }
    for workerCount > 0 {
        p.workerQueue <- nil // poison pill
        workerCount--
    }
    timeout.Stop()
}
```

This is the most important block of code in the library. Let us read it carefully.

**Outer loop structure.** The dispatcher loops until told to stop. Each iteration does one of two things: process a queued task (if any), or `select` on incoming work and idle timeout.

**The queued-task fast path.** If `waitingQueue` is non-empty, the dispatcher tries to forward its head to a worker before considering new submissions. This gives queued tasks priority over new ones — first-come-first-served behaviour.

**The select block.**
- `case task, ok := <-p.taskQueue:` — a `Submit` arrived. The dispatcher then tries to hand it directly to an idle worker via `case p.workerQueue <- task:`. If no worker is ready (the inner select hits `default`), the dispatcher either spawns a new worker (if `workerCount < maxWorkers`) or queues the task.
- `case <-timeout.C:` — the idle timer fired. If the pool has been idle since the last timeout and has workers, reap one. The timer resets and `idle` is set to true.

**The `idle` flag.** A subtle bookkeeping variable. It is `false` whenever a task arrives. It becomes `true` only after a timeout fires with no work. So two consecutive timer fires with no submits in between trigger reaping. This makes the reaping window roughly 2-4 seconds, not exactly 2.

**Shutdown.** When `taskQueue` closes (`ok = false`), the loop breaks. Then:
- If `wait` is true (i.e., `StopWait` was called), run the remaining queued tasks.
- Send `nil` to each worker as a poison pill — workers exit on `nil`.
- Stop the timer.
- The deferred `close(p.stoppedChan)` signals "all done" to anyone waiting.

This dispatcher design is clean and small. Notice what it does *not* do:
- No mutex around the queue (it is goroutine-local to the dispatcher).
- No worker goroutine bookkeeping beyond a count.
- No retries, no priorities, no rate limiting.

The simplicity is the point.

---

## Submit: From User to Worker

A trace of one `Submit`:

```go
func (p *WorkerPool) Submit(task func()) {
    if task != nil {
        p.taskQueue <- task
    }
}
```

That is the entire method. (Some versions check `Stopped` first; we'll see how shutdown coordination works below.)

So `Submit` simply blocks on a channel send to `taskQueue`. The dispatcher is the receiver. If the dispatcher is in the middle of doing other work (e.g., flushing queued tasks), the submitter waits — but only for microseconds, because the dispatcher loops back to the `select` quickly.

Steps:

1. Caller calls `Submit(myFunc)`.
2. Send `myFunc` on `taskQueue`. Block here until dispatcher reads.
3. Dispatcher's `case task := <-p.taskQueue` fires.
4. Dispatcher decides: hand to worker, spawn worker, or queue.
5. `Submit` returns to caller.

The whole round trip is ~100-300 nanoseconds for a non-contended dispatcher.

**Why an unbuffered taskQueue?** Because the dispatcher must make decisions about each incoming task immediately. A buffer would let many submissions pile up before the dispatcher saw them, which is exactly what `waitingQueue` is for — but `waitingQueue` is *inside* the dispatcher, not a buffer between submitter and dispatcher. The unbuffered design forces tight coordination.

**Why Submit "never blocks" then?** Because the dispatcher's `select` loop is fast. The dispatcher reads `taskQueue` in a tight loop; the submitter's send completes as soon as the dispatcher's next iteration. Unless the dispatcher is in shutdown or paused, the send completes in nanoseconds.

This is also why `Submit` is *not* truly non-blocking in the sense of `select { default: ... }`. It will block if the dispatcher is busy. But the dispatcher is rarely busy for long, so practically the block is invisible.

---

## SubmitWait: The Done-Channel Trick

```go
func (p *WorkerPool) SubmitWait(task func()) {
    if task == nil {
        return
    }
    doneChan := make(chan struct{})
    p.Submit(func() {
        defer close(doneChan)
        task()
    })
    <-doneChan
}
```

This is the entire implementation. Three observations:

1. `SubmitWait` is built on `Submit`, not the other way around. The library exposes both because users want both, but conceptually `SubmitWait` is sugar.
2. The done channel is unbuffered, size 0. The wrapper closes it after the task runs.
3. The wrapper uses `defer close(doneChan)`, which means even if `task()` panics, the close fires and `SubmitWait` returns. The library's outer recover then catches the panic.

The cost of `SubmitWait` over `Submit` is:
- One channel allocation (`make(chan struct{})`).
- One closure allocation (the wrapper).
- One `<-doneChan` wait.

For a synchronous-style API on top of an async primitive, this is essentially free. The major *cost* is conceptual: a `SubmitWait` from inside a busy task can deadlock, as we saw.

---

## The Worker Goroutine

```go
func worker(task func(), workerQueue chan func()) {
    for task != nil {
        task()
        task = <-workerQueue
    }
}
```

A worker is one of the smallest non-trivial Go functions you will read. It:

1. Runs its initial task.
2. Waits for the next task on `workerQueue`.
3. If the next task is `nil`, exit.
4. Otherwise, run it and repeat.

That is it. The worker has no state. It does not know about `maxWorkers`, `waitingQueue`, or `stopSignal`. It just pumps from a channel.

This minimalism makes worker reaping clean. To reap a worker, the dispatcher just sends `nil` once on `workerQueue`. The worker exits. The dispatcher updates its `workerCount`. Done.

**Where is the panic recovery?** In some versions, it is wrapped around `task()` inside the worker. Pseudocode:

```go
func worker(task func(), workerQueue chan func()) {
    for task != nil {
        runWithRecover(task)
        task = <-workerQueue
    }
}

func runWithRecover(task func()) {
    defer func() {
        if r := recover(); r != nil {
            // log or ignore
        }
    }()
    task()
}
```

The recover lives outside the user's view but inside the worker. So a panicking task does not kill the worker; the worker proceeds to fetch the next task. This is why a single panic does not destroy the pool.

(Earlier versions of the library did not have this recover. If you depend on a very old version, check; you might be one panic away from a crashed program.)

---

## Idle-Worker Reaping in Detail

The reaping mechanism uses a single `time.Timer` shared across all workers. The dispatcher creates one timer in its initialisation and resets it on each iteration of the `select` block.

The logic:

```
on each select iteration:
  if dispatched a new task:
    idle = false
  elif timer fired:
    if idle and workerCount > 0:
      reap one worker
      workerCount--
    idle = true
    timer.Reset(idleTimeout)
```

The two-state machine means *one reaping per double-timeout window*. The first timeout sets `idle = true`. If no task arrives before the second timeout, one worker is reaped. If a task arrives between, `idle` flips back to false and the cycle restarts.

So the effective reaping interval is between `idleTimeout` and `2 * idleTimeout`, depending on phase. With `idleTimeout = 2s`, that is 2 to 4 seconds.

**Why reap only one worker per timeout?** Because aggressive reaping would mean: if you have 100 idle workers and a 2-second pause, you would lose all 100 at once and pay the spawn cost for the next 100 on the next burst. Reaping one at a time is gentler — the pool shrinks gradually, and a single late-arriving task only re-spawns one worker.

This is a subtle design choice. A different library might reap differently:
- `ants` reaps all workers older than the expiry duration in one sweep.
- A custom pool might keep a "minimum residency" floor that never reaps below.

`workerpool`'s gradual one-at-a-time approach is a reasonable middle ground for unpredictable workloads.

---

## The Internal Queue Structure

`waitingQueue` is a `deque.Deque[func()]` from `github.com/gammazero/deque` (same author). A deque is a double-ended queue, implemented as a ring buffer that grows as needed.

Why a deque and not a slice or a linked list?

- **Slice:** appending is fast, but removing from the front (`q = q[1:]`) holds the original backing array hostage. With many tasks, you would accumulate garbage. The library wants FIFO with cheap pop-front.
- **Linked list:** allocates per node. Cache-unfriendly. Each Push is an allocation.
- **Deque (ring buffer):** amortised O(1) push and pop on both ends; reuses memory; cache-friendly.

The deque from `gammazero/deque` doubles its capacity when full (like a slice) and halves when nearly empty (unlike a slice). So queue memory does not stick around forever after a burst.

**Push** appends to the back. **Pop** removes from the front. The dispatcher uses both: it pushes new tasks that could not find an idle worker, and it pops from the front when ready to dispatch a queued task.

`WaitingQueueSize` reads `p.waiting`, an atomic counter that mirrors `waitingQueue.Len()`. It is updated atomically inside the dispatcher whenever the deque size changes. So reading from outside is cheap.

---

## Stop and StopWait Implementation

```go
func (p *WorkerPool) Stop() {
    p.stop(false)
}

func (p *WorkerPool) StopWait() {
    p.stop(true)
}

func (p *WorkerPool) stop(wait bool) {
    p.stopLock.Lock()
    if p.stopped {
        p.stopLock.Unlock()
        <-p.stoppedChan
        return
    }
    p.stopped = true
    p.wait = wait
    close(p.taskQueue) // signal dispatcher
    p.stopLock.Unlock()

    <-p.stoppedChan
}
```

Things to notice:

1. **Lock-protected idempotency.** Both `Stop` and `StopWait` go through `stop(bool)`. The lock ensures only the first caller actually triggers shutdown; later callers see `stopped == true` and just wait on `stoppedChan`.
2. **Closing `taskQueue` is the shutdown signal.** Once the dispatcher reads from a closed channel with `ok = false`, it breaks out of its loop.
3. **`wait` flag carries intent.** The dispatcher reads `p.wait` after the loop break to decide whether to drain queued tasks or skip them.
4. **`<-p.stoppedChan` is the synchronisation.** Both methods block until the dispatcher's deferred `close(p.stoppedChan)` runs. So when `Stop` or `StopWait` returns, the pool is provably done.

**Why close `taskQueue` instead of a separate channel?** Because the dispatcher already has `taskQueue` in its select. Closing it gives the dispatcher a clean signal in the existing code path: `case task, ok := <-p.taskQueue: if !ok { break Loop }`. No extra channel needed.

**The subtle ordering for `Submit` after `Stop`.** Imagine:

```
Goroutine A: pool.Submit(f) — blocked on p.taskQueue <- f
Goroutine B: pool.Stop() — about to close(p.taskQueue)
```

If `B` closes `taskQueue` while `A` is mid-send, Go panics with "send on closed channel". The library handles this by:

1. Setting `stopped = true` while holding `stopLock`.
2. Having `Submit` check `stopped` before sending (in some versions).
3. Or accepting the rare panic and recovering in the dispatcher.

The exact handling varies. In any case, the visible behaviour is "submits after Stop are dropped". The library makes this safe under concurrent access.

(Side note: this is one of the subtle areas where reading the actual source pays off, because the safety story is not obvious from the API contract alone.)

---

## Pause Semantics

`Pause(ctx)` is the newest addition to the API. Simplified:

```go
func (p *WorkerPool) Pause(ctx context.Context) {
    p.Submit(func() {
        <-ctx.Done()
    })
    for i := 0; i < p.maxWorkers-1; i++ {
        p.Submit(func() {
            <-ctx.Done()
        })
    }
}
```

Yes — the implementation is "submit `maxWorkers` blocking tasks that wait for the context". This consumes every worker slot. New submissions queue up behind them. When `ctx` cancels, all workers return, the queue drains.

This is a beautifully elegant hack. No new internal state, no new fields, no API explosion. The pause is implemented entirely with what was already there.

The downside: `Pause` consumes worker slots. If your `maxWorkers` is 4 and you call `Pause`, you have 4 tasks running (each waiting on the ctx). Other queued tasks cannot dispatch until those 4 unblock. The "pause" is really "saturate the pool with blocking sentinels".

This has implications:

- If you `Pause(ctx)` and then `Stop()`, the dispatcher needs to deliver poison pills, but workers are stuck waiting on `ctx.Done()`. Workers do not run the next iteration of their `for task := <-workerQueue` loop because they are inside the sentinel function. The library typically handles this by canceling the context internally on shutdown.
- `WaitingQueueSize` during a pause includes the sentinel tasks if they haven't been dispatched yet — confusing for observability.

These rough edges are why `Pause` is sometimes considered "use sparingly". For most use cases it works fine; for high-stakes coordinated shutdowns, you might prefer to manage pause-equivalents at the application layer.

---

## Synchronisation Primitives Used

A list of all sync primitives in the library:

1. **Channels (`taskQueue`, `workerQueue`, `stoppedChan`, `stopSignal`).** The dominant coordination mechanism.
2. **`sync.Mutex` (`stopLock`).** Protects the shutdown flags.
3. **`atomic.Int32` (or `int32` with `sync/atomic`) for `waiting`.** Exposed via `WaitingQueueSize`.

That is it. No `sync.WaitGroup`, no `sync.Cond`, no `sync.Once`. The whole design is channel-first, with a tiny lock and a tiny atomic.

This is consistent with the idiom "share memory by communicating, not communicate by sharing memory". The pool's shared state lives in channels; the only truly shared variable is the atomic counter, which is read-only from outside.

Compare to `ants`, which uses a lot more locking — `sync.Mutex` around worker allocation, condition variables for blocking pool waits. `workerpool`'s channel-centric design is cleaner but limits some kinds of optimisation.

---

## The Cost of Each Operation

A breakdown of the runtime cost of each public method, in nanoseconds, on a modern x86 machine.

| Operation | Time | Allocations |
|-----------|------|------------|
| `New(N)` | ~1-2 µs (goroutine spawn) | 1 (pool struct) + 1 (dispatcher goroutine) |
| `Submit(f)` | ~150-300 ns | 0 (the closure is the caller's allocation) |
| `SubmitWait(f)` | ~250-500 ns + task time | 1 (done channel) + 1 (wrapper closure) |
| `Stopped()` | ~3 ns | 0 |
| `WaitingQueueSize()` | ~3 ns (atomic load) | 0 |
| `Stop()` | ~1 µs + (running tasks finish) | 0 |
| `StopWait()` | ~1 µs + (all queued + running finish) | 0 |
| `Pause(ctx)` | ~maxWorkers × Submit time | maxWorkers (each pause sentinel closure) |

These numbers are rough but realistic. The dominant per-task cost is in `Submit`; everything else is either constant (instant) or proportional to work.

A pool can sustain roughly 5-10 million `Submit`s per second from a single goroutine before the dispatcher becomes a bottleneck. Beyond that, you would batch or use a different library.

---

## Comparison with a Hand-Rolled chan func() Pool

The minimal hand-rolled pool:

```go
func RunPool(maxW int, tasks []func()) {
    ch := make(chan func())
    var wg sync.WaitGroup
    for i := 0; i < maxW; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for f := range ch {
                f()
            }
        }()
    }
    for _, t := range tasks {
        ch <- t
    }
    close(ch)
    wg.Wait()
}
```

This is 12 lines, all goroutine-creation and a channel. Pros:

- Zero dependencies.
- Easy to read.
- One less channel hop (no dispatcher).

Cons compared to `workerpool`:

- **Producer blocks when workers busy.** If you submit faster than workers drain, you block. That can be a feature (backpressure) or a bug (deadlock with self-submitting tasks).
- **Workers live forever.** All `maxW` workers stay around until `close(ch)`. With no idle reaping, the pool holds `maxW * stackSize` bytes of memory permanently.
- **No `SubmitWait` for free.** You write the done-channel pattern yourself.
- **No shutdown drain vs discard distinction.** Closing `ch` always drains.
- **No queue depth observability.** You would have to add an external counter.
- **No panic recovery.** A panicking task kills its worker; you have one fewer worker for the rest of the run.

`workerpool` makes all of these work out of the box. The price is one extra channel hop per submit (~50ns) and one extra dispatcher goroutine.

**Use the hand-rolled pool when:** you need zero dependencies, your workload is bounded and predictable, you don't need idle reaping, and you're comfortable rewriting it as needs evolve.

**Use `workerpool` when:** you want the standard behaviour without writing it; you want `SubmitWait` for free; you value the stable API.

---

## Comparison with ants

`panjf2000/ants` is the other popular pool library. It is more configurable and (often) faster. The differences:

| Feature | `workerpool` | `ants` |
|---------|------------|------|
| API simplicity | Minimal | Larger, configurable |
| Idle worker reap | 2s, hard-coded | Configurable (`WithExpiryDuration`) |
| Pool resize at runtime | No | Yes (`Tune(N)`) |
| Generic typed args | No (only `func()`) | Yes (`PoolWithFunc`, generics) |
| Submission backpressure | None (unbounded queue) | `WithNonblocking(true)` returns error when full |
| Pre-allocated workers | No | Yes (`WithPreAlloc(true)`) |
| Tasks-per-second | ~5M | ~10M (claimed, varies) |
| Memory per pool | ~1-2 MB | Similar (depends on config) |
| API stability | Years | Active development |

Both libraries are battle-tested. The choice is mostly about what features you need.

**Choose `ants` when:** you need runtime resize, typed task args, faster throughput, or per-pool tuning of the idle reaper.

**Choose `workerpool` when:** you want minimal code, stable API, and the configurability is irrelevant.

A common migration path: start with `workerpool` for its simplicity, switch to `ants` when you start writing too many work-arounds.

---

## Comparison with tunny

`Jeffail/tunny` solves a different problem: request-response with stateful workers.

```go
pool := tunny.NewFunc(4, func(payload interface{}) interface{} {
    // process payload, return result
    return result(payload)
})

result := pool.Process(input)
```

Tunny's submit *returns* a result. Workers can have per-worker state via `tunny.NewCallback`. Workers block on input — there is no internal queue; the pool blocks the caller until a worker is free.

| Feature | `workerpool` | `tunny` |
|---------|------------|------|
| Submission style | Fire-and-forget | Synchronous request-response |
| Per-worker state | No | Yes |
| Internal queue | Unbounded | None (caller blocks) |
| Async | Native | Wrap with goroutine |
| Result return | Via closure | Via return value |

**Choose `tunny`** when:
- Each worker needs initialised state (compiled regex, DB connection, ML model).
- You want request-response semantics and a bounded synchronous interface.

**Choose `workerpool`** when:
- Tasks are stateless `func()` calls.
- You want async submission with an unbounded queue.

Many services use both: `tunny` for stateful CPU-bound work (image encoding, video transcoding) and `workerpool` for stateless I/O fan-out.

---

## Dynamic Scaling Considerations

`workerpool` does not support changing `maxWorkers` after construction. This is a limitation; we'll list the trade-offs.

### Why not allow resize?

The dispatcher logic depends on `maxWorkers`. Changing it mid-flight would require:
- Adding a lock around `workerCount < maxWorkers` (currently lock-free).
- Handling the case where the new max is lower than current workers (drain them gracefully?).
- API surface area for the resize operation (timing, blocking vs non-blocking).

The library's author chose simplicity over flexibility. If you need dynamic resize, you use `ants` or build a wrapper.

### A simple wrapper for dynamic resize

```go
type ResizablePool struct {
    mu      sync.Mutex
    current *workerpool.WorkerPool
    maxW    int
}

func NewResizablePool(max int) *ResizablePool {
    return &ResizablePool{
        current: workerpool.New(max),
        maxW:    max,
    }
}

func (rp *ResizablePool) Resize(newMax int) {
    rp.mu.Lock()
    defer rp.mu.Unlock()
    old := rp.current
    rp.current = workerpool.New(newMax)
    rp.maxW = newMax
    go old.StopWait() // drain the old pool in the background
}

func (rp *ResizablePool) Submit(f func()) {
    rp.mu.Lock()
    p := rp.current
    rp.mu.Unlock()
    p.Submit(f)
}
```

This creates a new pool on resize, drains the old one in the background, and switches `Submit` to use the new pool. Caveats:

- Tasks already queued on the old pool keep running on the old pool's workers until it drains.
- The lock around `current` adds tiny overhead to every `Submit`.
- Two pools exist transiently during resize.

For occasional resize (every few minutes), this works fine. For high-frequency resize (every second), the cost adds up.

### Adaptive sizing

For services that want pool size to track load, an outer controller adjusts `maxWorkers` periodically:

```go
ticker := time.NewTicker(30 * time.Second)
for range ticker.C {
    target := computeTarget()
    if abs(target - rp.maxW) > threshold {
        rp.Resize(target)
    }
}
```

Where `computeTarget` looks at queue depth, downstream latency, CPU utilisation, etc. We will detail this in the professional file.

---

## Custom Pool Patterns

When `workerpool` is not enough, here are five patterns for rolling your own.

### Pattern 1: Bounded queue with explicit backpressure

```go
type BoundedPool struct {
    sem chan struct{}
    pool *workerpool.WorkerPool
}

func NewBoundedPool(maxW, queueCap int) *BoundedPool {
    return &BoundedPool{
        sem: make(chan struct{}, queueCap),
        pool: workerpool.New(maxW),
    }
}

func (bp *BoundedPool) Submit(ctx context.Context, f func()) error {
    select {
    case bp.sem <- struct{}{}:
        bp.pool.Submit(func() {
            defer func() { <-bp.sem }()
            f()
        })
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

This wraps `workerpool` with a hard cap on queued tasks. Submitters block (or context-cancel) when the cap is reached.

### Pattern 2: Priority pool

Two underlying pools, one for high-priority tasks, one for low.

```go
type PriorityPool struct {
    high, low *workerpool.WorkerPool
}

func (pp *PriorityPool) SubmitHigh(f func()) {
    pp.high.Submit(f)
}

func (pp *PriorityPool) SubmitLow(f func()) {
    pp.low.Submit(f)
}
```

The high pool has, say, 16 workers; the low pool has 4. High-priority work cannot be starved. The trade-off: total worker count is the sum, not shared.

For *real* priority (single queue with priority order), you would need a heap-based queue and a custom dispatcher.

### Pattern 3: Per-key serialisation

Some workloads need "all tasks for the same key run sequentially". Example: per-user actions where two writes for the same user must not race.

```go
type KeyedPool struct {
    pool *workerpool.WorkerPool
    mu   sync.Mutex
    locks map[string]*sync.Mutex
}

func (kp *KeyedPool) Submit(key string, f func()) {
    kp.pool.Submit(func() {
        kp.mu.Lock()
        m, ok := kp.locks[key]
        if !ok {
            m = &sync.Mutex{}
            kp.locks[key] = m
        }
        kp.mu.Unlock()
        m.Lock()
        defer m.Unlock()
        f()
    })
}
```

A task acquires a key-specific mutex before running. Tasks with different keys run in parallel; same-key tasks serialise. Memory leak warning: the `locks` map grows without bound; you'd want a periodic cleanup or sharded design.

### Pattern 4: Result-bearing tasks

```go
type Result struct {
    Value interface{}
    Err   error
}

type ResultPool struct {
    pool *workerpool.WorkerPool
}

func (rp *ResultPool) Submit(f func() (interface{}, error)) <-chan Result {
    ch := make(chan Result, 1)
    rp.pool.Submit(func() {
        v, err := f()
        ch <- Result{Value: v, Err: err}
    })
    return ch
}
```

The caller gets a channel back; reading from it gives the task's result. Pattern: `result := <-pool.Submit(myFunc)`. This is mid-way between fire-and-forget and `SubmitWait`.

### Pattern 5: Pool with metrics

```go
type MetricsPool struct {
    pool    *workerpool.WorkerPool
    submits prometheus.Counter
    runs    prometheus.Counter
    panics  prometheus.Counter
    dur     prometheus.Histogram
}

func (mp *MetricsPool) Submit(f func()) {
    mp.submits.Inc()
    mp.pool.Submit(func() {
        start := time.Now()
        defer func() {
            mp.runs.Inc()
            mp.dur.Observe(time.Since(start).Seconds())
            if r := recover(); r != nil {
                mp.panics.Inc()
                log.Printf("task panic: %v", r)
            }
        }()
        f()
    })
}
```

This is the foundation of every production wrapper. Every submit gets counted, every run gets timed, every panic gets logged and counted.

---

## Adapting the Library for Your Needs

Three levels of adaptation:

### 1. Wrap

Build a struct that *contains* a `*workerpool.WorkerPool` and adds methods. All the patterns above are wraps. This is the right approach 95% of the time.

### 2. Fork

Copy the library into your repo and edit. Useful if you need to change the idle timeout, add prometheus hooks directly, or remove panic recovery.

When forking, mark the file clearly:

```go
// Forked from github.com/gammazero/workerpool v1.1.3
// Modifications:
// - idle timeout changed from 2s to 10s for our bursty workload
// - panic recovery removed (we handle panics at the call site)
```

Diff your fork against the upstream periodically to pick up bug fixes.

### 3. Replace

Write your own from scratch. Cost: 200-500 lines of well-tested Go and a 1-2 week project. Benefit: total control. Worth it for libraries that ship to many users (e.g., a database driver bundling its own pool), or for performance-critical paths where every cycle matters.

---

## Memory Layout and Allocations

A breakdown of what allocates and where.

**Pool creation:**
- One `WorkerPool` struct (~100 bytes).
- Two unbuffered `chan func()` (~96 bytes each).
- One `chan struct{}` (`stoppedChan`, ~96 bytes).
- One `deque.Deque[func()]` (lazy: ~0 bytes initially).
- One `time.Timer` (~96 bytes).
- One dispatcher goroutine (~2 KB stack).

Total at creation: roughly 2.5 KB.

**Per-task:**
- The user's closure (varies; ~50-200 bytes depending on captures).
- For `SubmitWait`, a wrapper closure (~50 bytes) and a done channel (~96 bytes).

**Per-worker (active):**
- A worker goroutine (~2 KB stack, can grow).

**Queue growth:**
- Deque starts at a small capacity (typically 16) and doubles as needed.
- Memory is reclaimed when the queue shrinks past a threshold.

For a pool with `maxWorkers = 100` and a steady-state queue of 1,000 tasks: roughly 2.5 KB (pool) + 100 × 2 KB (workers) + 16 KB (deque slots) + 1,000 × 100 bytes (closures) = ~310 KB. Trivial for a single pool; nontrivial for hundreds of pools.

**Allocation rate:** each `Submit` allocates one closure (the user's `func()`) and possibly bumps the deque. The closure allocation is on the user side; the library itself does not allocate per Submit (after dispatcher startup). So the GC pressure of using `workerpool` is dominated by *your* closures, not the library's overhead.

This is why you sometimes see advice like "use `ants.PoolWithFunc`" for high-throughput pools: it avoids the closure allocation by binding the function once and accepting an `interface{}` per task.

---

## Race Conditions That Could Exist

The library is well-tested. Running `go test -race ./...` on the repo passes cleanly. But here are the *kinds* of races a worker pool design must guard against, and how `workerpool` does it:

### Race 1: Submit during Stop

A goroutine calls `Submit(f)` while another calls `Stop`. Possible outcomes:
- The submitter's send completes before Stop closes `taskQueue`: task runs (or queues then runs / discards based on Stop/StopWait).
- The submitter's send happens during close: would panic "send on closed channel" in naive code.

`workerpool` handles this by: (a) the `stopLock` ensures only one shutdown closes the channel; (b) some versions check `Stopped` inside `Submit` before sending. In the worst case, a race could lead to a panic that the library's recover or `defer` cleanup catches.

In practice, you mitigate by stopping producers before stopping the pool — the application-level lifecycle ordering.

### Race 2: Multiple Stop callers

Goroutines A and B both call `Stop` at the same time. Without `stopLock`, both would try to close `taskQueue`, causing a "close of closed channel" panic.

The library protects with `if p.stopped { ... return }` inside `stop`.

### Race 3: `WaitingQueueSize` returns stale value

The atomic counter is updated by the dispatcher when it pushes/pops the deque. An external reader sees a snapshot. If a Submit and a dispatcher iteration happen between read and use, the value is stale.

This is not a race in the strict sense — there is no data race — but it is a *logical* race: the value cannot be used for synchronisation. The library docs (implicitly) acknowledge this; treat it as telemetry only.

### Race 4: Pause and Stop concurrently

A goroutine calls `Pause(ctx)`; another calls `Stop`. The pause submits sentinel tasks; Stop closes the task queue. If Stop wins, the sentinel tasks may or may not have made it onto the queue. The visible behaviour is: pause is irrelevant because the pool is shutting down anyway.

The library handles this gracefully by virtue of `Stop` overriding everything.

### Race 5: Reading the pool through a stale pointer

If you swap pool references (as in the `ResizablePool` example), readers may have the old pointer cached. Lock-free reads must use atomic loads. If you use `sync.Mutex` around the pointer, lock around every access. Mixing styles is dangerous.

This is not a `workerpool` issue per se; it is a general Go concurrency issue when you wrap mutable state.

---

## Tricky Internals

### The dispatcher prioritises the queue

Look at the loop:

```go
if p.waitingQueue.Len() != 0 {
    if !p.processWaitingQueue() {
        break Loop
    }
    continue
}
select {
    case task := <-p.taskQueue: ...
    case <-timeout.C: ...
}
```

The queue check is *outside* the select. So if there are tasks queued, the dispatcher does not even consider new submissions — it drains the queue first, one at a time per iteration.

Practical effect: under heavy load, the queue grows and *new submits are blocked* (they cannot reach the dispatcher because it is processing queue). That sounds like backpressure, but it is not — the submitter is blocked on `chan` send, not by a queue cap.

Once the queue clears, new submits flow again.

### Idle timer fires even with work

The timer fires regardless of whether the dispatcher has work to do. The `case <-timeout.C` branch is reached only when the select chooses it — typically when the dispatcher is in the select block (idle). If the dispatcher is busy processing queued tasks, the timer is still running but not consulted. When the queue clears and the dispatcher hits the select, the timer may already have fired and the channel has a buffered value.

The `idle` flag mechanism handles this: it gets set to `false` whenever a task arrives, so a timer-fire after recent activity does not trigger reaping.

### Worker count can briefly exceed maxWorkers

There is no atomic check on `workerCount`. The dispatcher is single-threaded (it is the only goroutine writing `workerCount`), so this is safe. But if you fork the library and add multi-threaded dispatcher work, you must guard `workerCount`.

### Poison pills are nil

The dispatcher signals worker exit by sending `nil` on `workerQueue`. The worker's `for task != nil` loop exits. No special "stop" signal needed.

This is clever, but it means *you must never `Submit(nil)`* — the worker would exit unexpectedly. Modern versions check for nil in `Submit` and return early. Older versions might let it through, causing a worker to vanish.

### Stop with running tasks waits for them

When you call `Stop`, the dispatcher closes `taskQueue` and breaks the loop. It then sends poison pills to workers. But workers may be in the middle of running a task; they do not poll `workerQueue` until the current task returns. So `Stop` effectively waits for all running tasks.

There is no way to interrupt a running task from outside. You must use a `context.Context` inside the task.

---

## Edge Cases at the Library Level

### `New(0)` and `New(-1)`

Both are normalised to `New(1)`. No error, no panic. Friendly but ambiguous; some users would prefer strictness.

### `Submit(nil)`

Modern versions: silently dropped (early return in `Submit`).
Older versions: queued; worker tries `nil()`; library's `recover` catches the panic; worker survives.

Either way, do not submit nil.

### `SubmitWait(nil)`

Modern versions: early return; the done channel never closes. But since you never `<-done`, you do not block.
Older versions: same as Submit(nil) — wrapped, queued, panics, recovered. The wrapper still closes `done`, so `SubmitWait` returns.

Either way: do not submit nil.

### `Stop` followed by `New` on the same pool

`Stop` does not magically transform the pool back into a fresh one. A stopped pool is dead. You need a new `workerpool.New(N)` to get a fresh one.

### Pool sized larger than goroutine limit

Go's default goroutine limit is effectively unlimited (constrained only by memory). But `runtime.SetMaxThreads` and similar could limit you in pathological setups. A pool with `maxWorkers = 1_000_000` would happily try to create a million worker goroutines if needed. You would OOM or hit thread limits long before any "pool limit".

The library does not warn you. Pick reasonable values.

### Calling `Stop` while paused

Already covered. Stop overrides pause.

### `StopWait` with an empty queue

Fast — workers (if any) finish their current task, exit, and `StopWait` returns. Effectively the same as `Stop` in this case.

### Goroutine leak from forgotten pool

If you `pool := workerpool.New(N)` and never call `Stop`/`StopWait`, the dispatcher goroutine lives forever. With idle reaping, worker goroutines come and go, but the dispatcher persists.

For long-running processes, a forgotten pool is a steady drip of goroutines (1 per forgotten pool). With pools per request, this accumulates dangerously.

Lint rules: some linters can catch missing `StopWait`. Consider one.

---

## Debugging Pool Internals

Several techniques for inspecting a pool in trouble.

### Goroutine dump

```go
buf := make([]byte, 1<<20)
n := runtime.Stack(buf, true)
fmt.Println(string(buf[:n]))
```

You will see something like:

```
goroutine 1 [running]:
main.main()
    /path/to/main.go:42

goroutine 17 [select]:
github.com/gammazero/workerpool.(*WorkerPool).dispatch(0xc000010100)
    /path/to/workerpool.go:120
created by github.com/gammazero/workerpool.New
    /path/to/workerpool.go:38

goroutine 18 [chan receive]:
github.com/gammazero/workerpool.worker(0x0, 0xc000018180)
    /path/to/workerpool.go:200
created by github.com/gammazero/workerpool.(*WorkerPool).dispatch
    /path/to/workerpool.go:160
```

The dispatcher is in `[select]` state — waiting in its main loop. Workers are in `[chan receive]` — waiting for the next task. A pool with no work shows exactly this pattern.

If you see workers in `[running]` or any other state, that is a task currently executing. If the program is hung, the workers' stack traces tell you exactly where each task is stuck.

### `pprof` goroutine profile

In a service with `net/http/pprof` enabled:

```
curl http://localhost:6060/debug/pprof/goroutine?debug=2
```

Same data as `runtime.Stack` but accessible remotely. Aggregate counts in the `debug=0` mode for big services.

### Custom `pool.Stats()` wrapper

```go
type Pool struct {
    p *workerpool.WorkerPool
    submitted int64
    completed int64
}

func (p *Pool) Stats() string {
    return fmt.Sprintf("queue=%d submitted=%d completed=%d stopped=%v",
        p.p.WaitingQueueSize(),
        atomic.LoadInt64(&p.submitted),
        atomic.LoadInt64(&p.completed),
        p.p.Stopped(),
    )
}
```

Expose this on an admin endpoint or log it periodically.

### Stuck `StopWait`

If `StopWait` hangs forever:
1. Dump goroutines.
2. Find the workers. Look at where they are running.
3. If they are stuck on I/O, a missing context cancellation is the culprit.
4. If they are stuck on a channel or mutex, you have a deadlock in user code.

The library itself does not deadlock unless user tasks misbehave.

### Reproducing pool behaviour locally

A standalone tool:

```go
func main() {
    pool := workerpool.New(*flag.Int("c", 4, "concurrency"))
    defer pool.StopWait()

    for i := 0; i < 10; i++ {
        i := i
        pool.Submit(func() {
            time.Sleep(time.Second)
            fmt.Println(i)
        })
        fmt.Println("after submit", i, "queue:", pool.WaitingQueueSize())
    }
}
```

Run with `-c 2`, `-c 4`, `-c 10`. Observe queue size right after each submit. You will see the queue grow as workers cannot keep up, then drain.

---

## Common Senior-Level Mistakes

### 1. Trusting `WaitingQueueSize` for synchronisation

It is a counter, not a barrier. Use it for metrics; for "all done" semantics, use `StopWait` or a `WaitGroup`.

### 2. Forking without diffing

Forking the library is fine. Failing to track upstream changes is not. Periodically diff and merge bug fixes.

### 3. Reusing closures across submissions

```go
f := func() { use(state) }
for _, s := range states {
    state = s   // RACE — modify captured var while previous task runs
    pool.Submit(f)
}
```

Each submission's `f` reads `state` at execution time, by which point `state` may have changed. Always create the closure per iteration with a captured value.

### 4. Forgetting that nil submissions reach workers

In old versions of `workerpool`, `Submit(nil)` is queued. The worker runs `nil()`, panics, library recovers. The user's intent is lost. Validate inputs.

### 5. Misusing `Pause`

Pause consumes worker slots with sentinel tasks. If you `Pause` and then submit a task expecting "queued tasks dispatch when I resume", you are right — but you also tied up `maxWorkers` slots in pause sentinels. The pool is fully utilised during pause; new submits queue.

### 6. Building intricate two-pool dependencies

Two pools where one's tasks submit to the other are easy to deadlock. Always ensure that one pool's queue cannot block on the other's.

### 7. Tuning `maxWorkers` based on aspirational thinking

Setting `maxWorkers = 1000` "in case we need it" is a code smell. It implies you do not know the actual concurrency requirement. Measure, then set.

### 8. Treating the library as feature-rich

Looking for "how do I do X with workerpool" where X is "retry / priorities / cancel a task". The answer is usually "wrap it" or "use a different library". Stop fighting the library's minimalism.

### 9. Holding the pool reference past program lifetime

In tests, a static pool that lives across test cases is a footgun: state leaks between tests. Prefer per-test pools.

### 10. Believing `Submit` is wait-free

It is fast, but it sends on an unbuffered channel. If the dispatcher is in a tight loop processing queue, `Submit` blocks until the next iteration. Microseconds at worst, but not "wait-free".

---

## Test

A senior-level test suite exercises internals:

```go
package main

import (
    "context"
    "sync"
    "sync/atomic"
    "testing"
    "time"

    "github.com/gammazero/workerpool"
)

func TestIdleWorkerReaping(t *testing.T) {
    pool := workerpool.New(10)
    defer pool.StopWait()

    // Saturate the pool.
    for i := 0; i < 10; i++ {
        pool.Submit(func() { time.Sleep(50 * time.Millisecond) })
    }

    n0 := runtime.NumGoroutine()
    t.Logf("during work: %d goroutines", n0)

    // Wait longer than idle timeout.
    time.Sleep(3 * time.Second)

    n1 := runtime.NumGoroutine()
    t.Logf("after idle: %d goroutines", n1)

    if n1 >= n0 {
        t.Errorf("expected workers to be reaped, got %d -> %d", n0, n1)
    }
}

func TestSubmitDoesNotBlockUnboundedly(t *testing.T) {
    pool := workerpool.New(1)
    defer pool.StopWait()

    // Block the worker forever.
    pool.Submit(func() { time.Sleep(time.Hour) })

    // Try to submit 1000 more in 1 second.
    done := make(chan struct{})
    go func() {
        for i := 0; i < 1000; i++ {
            pool.Submit(func() {})
        }
        close(done)
    }()

    select {
    case <-done:
        t.Log("all 1000 submits completed despite worker blocked")
    case <-time.After(time.Second):
        t.Fatal("submits did not complete within 1s")
    }
}

func TestStopDiscardsQueuedTasks(t *testing.T) {
    pool := workerpool.New(1)
    var done int64

    // Queue 100 tasks; only some will run.
    pool.Submit(func() { time.Sleep(100 * time.Millisecond) }) // saturate
    for i := 0; i < 100; i++ {
        pool.Submit(func() { atomic.AddInt64(&done, 1) })
    }

    pool.Stop()

    final := atomic.LoadInt64(&done)
    if final == 100 {
        t.Log("edge case: all tasks finished before Stop")
    } else if final > 0 {
        t.Logf("%d/100 tasks ran before Stop discarded the rest", final)
    } else {
        t.Log("Stop discarded all queued tasks")
    }
}

func TestStopWaitWaitsForAllTasks(t *testing.T) {
    pool := workerpool.New(2)
    var done int64
    for i := 0; i < 100; i++ {
        pool.Submit(func() {
            time.Sleep(10 * time.Millisecond)
            atomic.AddInt64(&done, 1)
        })
    }
    pool.StopWait()
    if got := atomic.LoadInt64(&done); got != 100 {
        t.Fatalf("StopWait did not drain: %d/100", got)
    }
}

func TestPauseAndResume(t *testing.T) {
    pool := workerpool.New(4)
    defer pool.StopWait()

    ctx, cancel := context.WithCancel(context.Background())
    pool.Pause(ctx)

    var done int64
    for i := 0; i < 4; i++ {
        pool.Submit(func() {
            atomic.AddInt64(&done, 1)
        })
    }

    time.Sleep(50 * time.Millisecond)
    if atomic.LoadInt64(&done) > 0 {
        t.Fatal("task ran during pause")
    }

    cancel()
    time.Sleep(100 * time.Millisecond)
    if atomic.LoadInt64(&done) != 4 {
        t.Fatalf("tasks did not run after resume: %d/4", atomic.LoadInt64(&done))
    }
}

func TestConcurrentSubmits(t *testing.T) {
    pool := workerpool.New(8)
    defer pool.StopWait()

    var done int64
    const submitters = 100
    const perSubmitter = 1000

    var wg sync.WaitGroup
    for s := 0; s < submitters; s++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < perSubmitter; i++ {
                pool.Submit(func() { atomic.AddInt64(&done, 1) })
            }
        }()
    }
    wg.Wait()
    pool.StopWait()

    if got := atomic.LoadInt64(&done); got != submitters*perSubmitter {
        t.Fatalf("expected %d, got %d", submitters*perSubmitter, got)
    }
}

func TestSubmitAfterStop(t *testing.T) {
    pool := workerpool.New(2)
    pool.StopWait()

    var ran int64
    pool.Submit(func() { atomic.AddInt64(&ran, 1) })
    if ran != 0 {
        t.Fatal("task ran after StopWait")
    }
}
```

Run with `go test -race -timeout 30s ./...`.

---

## Tricky Questions

### Q: What does the dispatcher do during a `Submit` from a closed pool?

If the user calls `Submit` after `Stop`, the library typically checks `Stopped()` first and returns. If somehow a Submit reaches the closed `taskQueue`, the send would panic. The library's defer (in some versions) catches this.

### Q: How is `workerCount` updated?

Only inside the dispatcher loop. The dispatcher increments on spawn and decrements on reap. There is no lock — the dispatcher is the only goroutine writing.

### Q: What if a worker panics and the dispatcher does not know?

In modern versions, a panic in `task()` is recovered inside the worker's wrapper. The worker stays alive. The dispatcher does not need to know.

In hypothetical older versions without that recover, a panic would kill the worker without notifying the dispatcher. The dispatcher would try to send the next task on `workerQueue`, but the worker is gone. The send would block (no receiver). Deadlock.

The library's recover is therefore not just a niceness — it is critical for correctness.

### Q: Why an unbuffered `workerQueue`?

So the dispatcher gets immediate feedback whether a worker is ready. With `select { case workerQueue <- task: default: }`, the dispatcher knows in one nanosecond whether a worker is waiting. With a buffer, the dispatcher would just enqueue regardless of worker state.

### Q: Could you replace `waitingQueue` with a channel?

Conceptually yes — a buffered channel of arbitrary size could serve as the queue. But Go channels do not auto-grow; you must pick a fixed buffer size. An unbounded deque is more memory-efficient over time (shrinking when sparse).

### Q: What's the GC impact of long-lived pools?

The pool itself is small. The queue's deque keeps growing then shrinking; each growth allocates a larger backing array, each shrink frees it. So there is some GC churn under varying loads.

For pools with very stable load, GC impact is minimal — once the deque has reached its working size, it stays there.

### Q: Could `workerCount` go negative on aggressive reaping?

No. The dispatcher decrements only after confirming a reap, and `killIdleWorker` is a synchronous send of `nil` to a worker that is waiting on `workerQueue`. The worker reads the nil and exits; the dispatcher knows the worker is gone.

### Q: What if the timer fires during shutdown?

The shutdown path breaks out of the loop and ignores further timer fires. The deferred `timeout.Stop()` cleans up.

### Q: How would you add per-pool metrics without forking?

Wrap. Every `Submit` increments a counter before calling `pool.Submit(wrapped)`. The wrapped closure decrements (or increments a "completed" counter) on exit. The pool itself is unaware.

### Q: How would you add priority?

You cannot, without forking or replacing. The library's deque is FIFO. To support priority, you would need a heap-based queue inside the dispatcher.

---

## Cheat Sheet

```
WorkerPool struct (essentials):
  maxWorkers    int
  taskQueue     chan func()       // submitters write here
  workerQueue   chan func()       // workers read here
  waitingQueue  Deque[func()]     // overflow when no worker ready
  stoppedChan   chan struct{}     // closed at end of dispatcher
  stopped       bool              // shutdown initiated?
  wait          bool              // drain (true) or discard (false)?

Dispatcher loop:
  if queue non-empty: forward head to a worker, repeat
  else select:
    case task := <-taskQueue:
      try workerQueue <- task else spawn or enqueue
    case <-timer.C:
      if idle and workers>0: reap one
      reset timer; idle = true

Worker loop:
  for task != nil:
    runWithRecover(task)
    task = <-workerQueue

Shutdown:
  close(taskQueue) — dispatcher exits its loop
  if wait: drain queue
  send nil to each worker — they exit
  close(stoppedChan) — Stop/StopWait return
```

Memorising this picture is the goal of the senior file.

---

## Self-Assessment Checklist

- [ ] I can sketch the `WorkerPool` struct fields from memory.
- [ ] I can trace a `Submit` from caller to worker, step by step.
- [ ] I can explain why there are two channels (`taskQueue` and `workerQueue`).
- [ ] I know how the dispatcher prioritises the waiting queue over new submits.
- [ ] I understand the two-state `idle` flag mechanism for reaping.
- [ ] I can compare `workerpool` to `ants` and `tunny` with specific feature differences.
- [ ] I can implement a `BoundedPool` wrapper.
- [ ] I can implement a `PriorityPool` with two underlying pools.
- [ ] I can debug a stuck pool via `runtime.Stack`.
- [ ] I can explain why `Pause` consumes worker slots.
- [ ] I can decide whether to fork, wrap, or replace for a given need.

If all are yes, you are ready for the professional file.

---

## Summary

The senior file is the source code tour. The library is small enough that you can hold it all in your head: one dispatcher goroutine, N worker goroutines, a deque for overflow, and channels for coordination. The dispatcher's `select` loop is the only really intricate piece, and even that is just three cases.

Three things to internalise from this level:

1. **Two channels, one dispatcher.** The design's whole personality is here. The dispatcher mediates between submitters and workers; the two channels give it the `select` choice it needs.
2. **Workers are stateless.** This makes reaping cheap and panic recovery clean.
3. **The simplicity is intentional.** Every feature you wish were here was deliberately omitted to keep the API minimal.

When the simplicity becomes a constraint, you wrap, fork, or replace. All three are senior-level skills. The professional file picks up here to talk about *when* to do each, and what production wisdom looks like in real services.

---

## What You Can Build

At senior level you can build:

- A custom pool from scratch in a few hundred lines that matches `workerpool`'s contract.
- A wrapped pool with metrics, priorities, per-key serialisation, or bounded queues.
- A forked variant tuned for a specific workload (different idle timeout, different recover strategy).
- A multi-pool architecture for complex pipelines.

You can also read other Go libraries with the same level of comprehension — every networking library, every cache, every queue eventually uses similar patterns.

---

## Further Reading

- The library's source: clone and read `workerpool.go`.
- The `ants` source for comparison: `panjf2000/ants` is a great study.
- The `tunny` source for a different architecture.
- "Concurrency in Go" by Katherine Cox-Buday — the chapters on patterns are foundational.
- The Go runtime's source for `chan` operations (`runtime/chan.go`).

---

## Related Topics

- **Goroutine schedulers** — the GMP model that makes `workerpool` viable.
- **Channels in depth** — buffered vs unbuffered semantics.
- **`sync.Mutex` vs atomics** — when the library uses which.
- **`time.Timer`** — the reaper's backbone.

---

## Diagrams and Visual Aids

### Two-channel dispatcher

```
            +---------+         +-----------+         +----------+
  Submit -> taskQueue +--------->+ dispatch +--------->+ worker(s)|
            +---------+         | select   |         +----------+
                                | block    |              ^
                                +-----+----+              |
                                      |                   |
                                      v                   |
                                +-----+----+              |
                                | spawn or |              |
                                | enqueue  +--------------+
                                | workerQ  |  workerQueue
                                +----------+
```

### Dispatcher state machine

```
                     +-------+
                     | start |
                     +---+---+
                         |
                         v
                  +------+-------+
                  | check waiting |
                  +--+---------+--+
                non-empty|       |empty
                         v       v
                +--------+--+ +--+----------------+
                | dispatch  | | select:           |
                | queued    | |   taskQueue ->    |
                | -> worker | |     route        |
                +--+--------+ |   timer -> reap   |
                   |          +--+----------------+
                   |             |
                   +------+------+
                          |
                          v
                       repeat
                          |
                          | (taskQueue closed)
                          v
                  +-------+-------+
                  | shutdown      |
                  | drain or skip |
                  | poison        |
                  | close stopChan|
                  +---------------+
```

### Worker exit via nil

```
worker: for task != nil:
          runWithRecover(task)
          task = <-workerQueue   // dispatcher sends nil here at shutdown
        return  // goroutine exits
```

### Memory shape at steady state

```
WorkerPool
├── maxWorkers (int)
├── taskQueue (chan func())
├── workerQueue (chan func())
├── waitingQueue [Deque ring buffer]
│       size grows/shrinks dynamically
├── stoppedChan (chan struct{})
├── stopLock (sync.Mutex)
├── stopped (bool)
└── wait (bool)

dispatcher goroutine ── 1 always alive
worker goroutines ── 0..maxWorkers, reaped after ~2s idle
```

These pictures are what to keep in your head when reading or writing senior-level pool code.

---

## Appendix A: Line-by-Line Walkthrough of dispatch

Let us read the dispatcher in detail, line by line. The actual library may differ slightly; we present a faithful approximation.

```go
func (p *WorkerPool) dispatch() {
    defer close(p.stoppedChan)
```

The deferred close happens when the dispatcher exits, signalling completion to whoever called `Stop` or `StopWait`. This is the only way the outside world learns shutdown is done.

```go
    timeout := time.NewTimer(idleTimeout)
```

Create the idle timer once at startup. It will be reset on every iteration to ensure exactly one tick fires per `idleTimeout` (~2s) of dispatcher inactivity.

```go
    var workerCount int
    var idle bool
```

Two local variables. `workerCount` is the current number of worker goroutines alive. `idle` tracks whether we've been idle since the last timer tick.

```go
Loop:
    for {
```

Label `Loop` is for `break Loop` later. Go does not have multi-level break by index; named labels are the idiom.

```go
        if p.waitingQueue.Len() != 0 {
            if !p.processWaitingQueue() {
                break Loop
            }
            continue
        }
```

If there are queued tasks, process one. `processWaitingQueue` returns false if shutdown is in progress (the task queue is closed and we should exit). Otherwise it pops the front, hands it to a worker, decrements the atomic counter, and returns true. `continue` restarts the loop — which re-checks the queue. This effectively gives queued tasks priority over new submissions.

```go
        select {
        case task, ok := <-p.taskQueue:
            if !ok {
                break Loop
            }
```

Read from `taskQueue`. The `ok` is `false` when the channel is closed (by `Stop` or `StopWait`). On close, break out and head to shutdown.

```go
            select {
            case p.workerQueue <- task:
            default:
                if workerCount < p.maxWorkers {
                    go worker(task, p.workerQueue)
                    workerCount++
                } else {
                    p.waitingQueue.PushBack(task)
                    atomic.StoreInt32(&p.waiting, int32(p.waitingQueue.Len()))
                }
            }
```

The inner select is the heart of dispatching:
1. Try to send the task to a waiting worker. If a worker is currently waiting on `workerQueue` (i.e., its `task = <-workerQueue` is blocked), this succeeds and the worker runs the task.
2. If no worker is waiting (`default`):
   - If we can spawn more workers, do so. The new worker starts with this task.
   - Otherwise, queue the task in `waitingQueue` and update the atomic counter.

The `default` case is the magic. It lets the dispatcher decide *immediately* whether a worker is available. No timeout, no polling.

```go
            idle = false
```

A task arrived; we are not idle. This resets the reaping cycle.

```go
        case <-timeout.C:
            if idle && workerCount > 0 {
                if p.killIdleWorker() {
                    workerCount--
                }
            }
            idle = true
            timeout.Reset(idleTimeout)
        }
```

The timer fired. If we have been idle since the last fire (two consecutive timer ticks with no task), and we have workers, reap one. Then set `idle = true` (until a task arrives) and reset the timer.

`killIdleWorker` sends `nil` to `workerQueue`. If a worker is waiting, it reads the nil and exits. The send is *non-blocking* with `select { case ... <- nil: default: return false }` semantics — if no worker is waiting, do nothing.

```go
    }
```

End of for loop. We exit here after `break Loop`.

```go
    // shutdown sequence
    if p.wait {
        p.runQueuedTasks()
    }
```

If `wait` was set (i.e., `StopWait`), drain the remaining queued tasks before tearing down workers. Otherwise (`Stop`), skip — those tasks are dropped.

`runQueuedTasks` is a loop over the waiting queue, sending each to a worker (waiting for one to be ready, or spawning one if under cap).

```go
    for workerCount > 0 {
        p.workerQueue <- nil
        workerCount--
    }
```

Send a `nil` poison pill to each worker. Workers exit on nil, decrementing the count.

```go
    timeout.Stop()
}
```

Stop the timer to avoid a goroutine leak from the timer's internal goroutine.

That's the entire dispatcher. About 40 lines. Read it three times.

---

## Appendix B: Line-by-Line Walkthrough of worker

```go
func worker(initialTask func(), workerQueue chan func()) {
    for task := initialTask; task != nil; task = <-workerQueue {
        runTask(task)
    }
}
```

If you want the recovery inside:

```go
func worker(initialTask func(), workerQueue chan func()) {
    for task := initialTask; task != nil; task = <-workerQueue {
        runTask(task)
    }
}

func runTask(task func()) {
    defer func() {
        if r := recover(); r != nil {
            log.Println("worker recovered:", r)
        }
    }()
    task()
}
```

The worker is barely a function. Its loop:

1. Start with `initialTask`. Run it (with recovery).
2. Block on `workerQueue`.
3. If the received value is `nil`, the loop condition fails and the function returns. Goroutine exits.
4. Otherwise, run the task and repeat.

That is all. Workers do not know about `maxWorkers`, `waitingQueue`, `stoppedChan`, the timer, or even the pool. They just pump from a channel.

This minimalism is the secret to clean teardown: to stop a worker, send `nil`. To stop all workers, send `nil` `workerCount` times.

---

## Appendix C: The processWaitingQueue Helper

A simplified version:

```go
func (p *WorkerPool) processWaitingQueue() bool {
    select {
    case task, ok := <-p.taskQueue:
        if !ok {
            return false
        }
        p.waitingQueue.PushBack(task)
    case p.workerQueue <- p.waitingQueue.Front():
        p.waitingQueue.PopFront()
    }
    atomic.StoreInt32(&p.waiting, int32(p.waitingQueue.Len()))
    return true
}
```

What this does: while waiting tasks exist, the dispatcher hopes to send the front of the queue to a worker. Two outcomes:

- A worker accepts: pop the front, update counter, return true.
- A new task arrives on `taskQueue`: push it to the back of the queue. (Or close: return false to break out.)

This is the "drain the queue while accepting more" inner loop. It maintains FIFO ordering: the front task always gets dispatched first, but if new tasks arrive while waiting for a worker, they go to the back.

The `select` blocks until *either* a worker is ready *or* a new task arrives. So the dispatcher does not busy-wait; it parks on the channels.

A subtle point: `p.waitingQueue.Front()` is evaluated to obtain the value to send. The send operation is `p.workerQueue <- task`. If the send is selected, only then do we pop. If the other case is selected (a new submit), we leave the queue's front intact for the next iteration.

This is one of the trickier patterns in Go. The select with one side being a *send* of a *peeked value* works because Go evaluates the case expressions before selecting.

---

## Appendix D: Building a Pool From First Principles

To really understand `workerpool`, build one yourself. We'll do it step by step.

### Step 1: The simplest possible pool

```go
type Pool struct {
    ch chan func()
}

func NewPool(n int) *Pool {
    p := &Pool{ch: make(chan func())}
    for i := 0; i < n; i++ {
        go func() {
            for f := range p.ch {
                f()
            }
        }()
    }
    return p
}

func (p *Pool) Submit(f func()) {
    p.ch <- f
}

func (p *Pool) Stop() {
    close(p.ch)
}
```

12 lines. Works. Differences from `workerpool`:

- All workers spawn immediately (no lazy startup).
- Workers live forever until `Stop` (no idle reaping).
- `Submit` blocks when all workers are busy (no queue).
- `Stop` does not wait for in-flight tasks to finish.
- No `SubmitWait`, no `Stopped`, no `WaitingQueueSize`.

Each of these gaps motivates a feature `workerpool` provides.

### Step 2: Add a queue

```go
type Pool struct {
    in    chan func()
    out   chan func()
    queue []func()
    done  chan struct{}
}

func NewPool(n int) *Pool {
    p := &Pool{
        in:   make(chan func()),
        out:  make(chan func()),
        done: make(chan struct{}),
    }
    go p.dispatch()
    for i := 0; i < n; i++ {
        go p.worker()
    }
    return p
}

func (p *Pool) dispatch() {
    for {
        var sendCh chan func()
        var next func()
        if len(p.queue) > 0 {
            sendCh = p.out
            next = p.queue[0]
        }
        select {
        case f, ok := <-p.in:
            if !ok {
                close(p.done)
                return
            }
            p.queue = append(p.queue, f)
        case sendCh <- next:
            p.queue = p.queue[1:]
        }
    }
}

func (p *Pool) worker() {
    for f := range p.out {
        f()
    }
}

func (p *Pool) Submit(f func()) { p.in <- f }
func (p *Pool) Stop()           { close(p.in); <-p.done }
```

Now we have a queue (via the slice `queue`) and a dispatcher. `Submit` never blocks for long — even if all workers are busy, the dispatcher just appends to the queue.

The `select` trick here is identical to what `workerpool` does: when the queue is empty, `sendCh` is `nil`, and a select on a nil channel blocks forever — so the dispatcher only tries to send when there is something to send.

### Step 3: Add lazy workers and idle reaping

```go
// (skipping for brevity, but the pattern is: track worker count, spawn lazily,
//  send nil to a worker after N seconds of pool inactivity)
```

This is roughly 50 more lines. At this point you have re-built `workerpool`.

### Step 4: Add panic recovery

```go
func (p *Pool) worker() {
    for f := range p.out {
        func() {
            defer func() { _ = recover() }()
            f()
        }()
    }
}
```

A few more lines. Now your pool survives a panicking task.

### Step 5: Add SubmitWait

```go
func (p *Pool) SubmitWait(f func()) {
    done := make(chan struct{})
    p.Submit(func() {
        defer close(done)
        f()
    })
    <-done
}
```

10 more lines.

Total: about 100-150 lines of code to roughly reproduce `workerpool`'s feature set. The library itself is denser because it handles edge cases, but the core algorithm is the same.

This exercise is worth doing in a notepad even if you do not run it. Building it once gives you a mental model that no amount of reading can replace.

---

## Appendix E: When the Library's Choices Bite

A list of specific decisions in `workerpool` that cause problems in certain workloads.

### Choice 1: Hard-coded 2-second idle timeout

Bursty workloads with 2.5-second gaps reap workers between bursts and respawn on each one. Workaround: keep-alive heartbeat tasks.

### Choice 2: Unbounded queue

Under load spike, memory grows. Workaround: semaphore in front of `Submit`.

### Choice 3: No per-task error

Errors must be captured by closure. Workaround: build a typed wrapper that returns `(value, error)` via channels.

### Choice 4: `func()` only

No typed arguments. Workaround: closures capture them. Cost: closure allocation per submit.

### Choice 5: No resize

`maxWorkers` is fixed for the pool's lifetime. Workaround: create new pool, drain old. Cost: complexity.

### Choice 6: No priority

FIFO only. Workaround: two pools, or a priority queue + dispatcher of your own.

### Choice 7: Single dispatcher

If submissions are dominated by a single goroutine, the dispatcher hops fine. At extreme rates (millions of submits per second from many goroutines), the dispatcher's `select` could become a bottleneck. Workaround: shard into multiple pools.

### Choice 8: No introspection of running tasks

You cannot ask "what are my workers running right now?". Workaround: per-task instrumentation.

Each workaround adds code. When the workarounds outweigh the library's value, switch.

---

## Appendix F: Performance Microbenchmarks

A few representative benchmarks. Numbers from a recent x86 laptop with Go 1.22; your mileage will vary.

```go
func BenchmarkSubmitNoop(b *testing.B) {
    pool := workerpool.New(8)
    defer pool.StopWait()

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        pool.Submit(func() {})
    }
}

func BenchmarkSubmitWaitNoop(b *testing.B) {
    pool := workerpool.New(8)
    defer pool.StopWait()

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        pool.SubmitWait(func() {})
    }
}

func BenchmarkRawGoroutineNoop(b *testing.B) {
    var wg sync.WaitGroup
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        wg.Add(1)
        go func() {
            wg.Done()
        }()
    }
    wg.Wait()
}

func BenchmarkBufferedChannelNoop(b *testing.B) {
    ch := make(chan func(), 1024)
    var wg sync.WaitGroup
    for w := 0; w < 8; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for f := range ch {
                f()
            }
        }()
    }

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        ch <- func() {}
    }
    close(ch)
    wg.Wait()
}
```

Typical results (single submit thread):

```
BenchmarkSubmitNoop-8             8000000  180 ns/op  16 B/op  1 allocs/op
BenchmarkSubmitWaitNoop-8         3000000  450 ns/op 112 B/op  3 allocs/op
BenchmarkRawGoroutineNoop-8       3000000  430 ns/op  16 B/op  1 allocs/op
BenchmarkBufferedChannelNoop-8    9000000  150 ns/op  16 B/op  1 allocs/op
```

Observations:

- `Submit` is comparable to raw goroutine creation (slightly faster due to worker reuse) and slightly slower than buffered channel (due to dispatcher hop).
- `SubmitWait` is ~3x slower than `Submit` due to extra closure + done-channel.
- Allocations: each submit allocates the user closure (16 bytes for an empty closure). `SubmitWait` adds 2 more (wrapper + done channel).

For tasks that take any meaningful work (say 1 microsecond), the submit overhead is negligible. For tasks at nanosecond scale, it dominates — but nanosecond tasks should never be in a pool.

---

## Appendix G: Profiling a Pool in Production

A short cookbook.

### CPU profile

```go
import _ "net/http/pprof"

go func() {
    log.Println(http.ListenAndServe("localhost:6060", nil))
}()
```

Then:

```bash
curl -o cpu.prof http://localhost:6060/debug/pprof/profile?seconds=30
go tool pprof -http :8080 cpu.prof
```

Look for:

- `workerpool.dispatch` — if it dominates, the dispatcher is the bottleneck. Consider sharding.
- `runtime.chansend` / `runtime.chanrecv` — channel overhead. Expected.
- User code — usually 99% of the time. Optimise *that*.

### Goroutine profile

```bash
curl -o goroutine.prof http://localhost:6060/debug/pprof/goroutine
go tool pprof -http :8080 goroutine.prof
```

In the profile:

- `workerpool.dispatch` should appear once per pool.
- `workerpool.worker` should appear `numActiveWorkers` times per pool.
- If you see far more workers than `maxWorkers`, you have a forgotten pool somewhere.

### Heap profile

```bash
curl -o heap.prof http://localhost:6060/debug/pprof/heap
go tool pprof -http :8080 heap.prof
```

Look for:

- Allocations from `gammazero/deque` — your queue is growing.
- Allocations from your closures.
- Allocations from `make(chan struct{})` (for `SubmitWait`).

### Trace

```bash
curl -o trace.out http://localhost:6060/debug/pprof/trace?seconds=5
go tool trace trace.out
```

The trace UI lets you see *exactly* when each goroutine ran, blocked, and exited. You can see your workers servicing tasks in real time. Indispensable for diagnosing pool scheduling issues.

---

## Appendix H: A Side-by-Side: workerpool vs ants Source

A snippet from `ants` showing how it differs:

```go
// from panjf2000/ants (simplified)
type Pool struct {
    capacity   int32
    running    int32
    lock       sync.Locker
    workers    workerQueue
    state      int32
    cond       *sync.Cond
    workerCache sync.Pool
    waiting     int32
}
```

Compare to `workerpool`'s struct: `ants` has more fields, a `sync.Cond`, a `sync.Pool` for worker reuse, an atomic state. It does more per submit but achieves higher throughput because it does not have a separate dispatcher goroutine — submits acquire a worker directly via the lock and condition variable.

The `submit` path in `ants`:

```go
func (p *Pool) Submit(task func()) error {
    if p.IsClosed() {
        return ErrPoolClosed
    }
    w, err := p.retrieveWorker()
    if err != nil {
        return err
    }
    w.task <- task
    return nil
}
```

No dispatcher channel hop. Just lock, get a worker, send task. Faster — but the locking is heavier than channel ops in the uncontended case.

`workerpool`'s design favours simplicity; `ants`'s favours throughput. Both are correct choices for their target use case.

---

## Appendix I: Forking workerpool

When and how.

### When to fork

- You need to change the idle timeout.
- You want to add per-pool prometheus metrics directly.
- You need a specific panic-handling policy.
- You want to remove a feature you do not use (e.g., `Pause`).

### How to fork cleanly

1. Copy the `.go` file into your repo. Keep the original copyright header.
2. Add a comment block at the top explaining your fork's purpose and divergence.
3. Note the upstream version you forked from.
4. Periodically `diff` against upstream to pick up bug fixes.

Example header:

```go
// Package internalpool is a fork of github.com/gammazero/workerpool v1.1.3.
//
// Modifications:
//   - idle timeout configurable via NewWithIdleTimeout(maxWorkers, idleTimeout)
//   - panic recovery now invokes a configurable callback for observability
//   - Pause method removed; we do not use it
//
// Last synced with upstream: 2024-03-15.
//
// Original Copyright (c) 2020 Andrew J. Gillis. License: MIT.
```

### Maintaining a fork

A simple Makefile target:

```
upstream-diff:
	git diff workerpool-upstream/main -- workerpool.go
```

Run this before every release. If upstream had a security fix, merge it.

If your fork diverges too much, you eventually own a new library. That is fine — but be honest about it. Rename the package to your repo's namespace so users know they are not getting upstream.

---

## Appendix J: Sharded Pools for Scale

If a single `workerpool` dispatcher becomes a bottleneck (millions of submits per second), shard.

```go
type ShardedPool struct {
    shards []*workerpool.WorkerPool
}

func NewShardedPool(shards, workersPerShard int) *ShardedPool {
    sp := &ShardedPool{shards: make([]*workerpool.WorkerPool, shards)}
    for i := range sp.shards {
        sp.shards[i] = workerpool.New(workersPerShard)
    }
    return sp
}

func (sp *ShardedPool) Submit(key uint64, f func()) {
    sp.shards[key%uint64(len(sp.shards))].Submit(f)
}

func (sp *ShardedPool) StopAll() {
    var wg sync.WaitGroup
    for _, p := range sp.shards {
        wg.Add(1)
        go func(p *workerpool.WorkerPool) {
            defer wg.Done()
            p.StopWait()
        }(p)
    }
    wg.Wait()
}
```

N independent pools. Each has its own dispatcher, queue, and workers. Total capacity = `shards * workersPerShard`. A key (e.g., user ID, request hash) maps tasks to shards.

Benefits:

- Dispatcher load is divided.
- Per-shard queue is smaller.
- No contention between shards.

Caveats:

- Per-key serialisation: same key always goes to the same shard. If the load is skewed, one shard saturates.
- Total memory: N times one pool.
- Operational complexity: N pools to monitor.

Used in: high-throughput services, per-tenant request routing, sharded queue processing.

---

## Appendix K: Pools and the Go Runtime Scheduler

A note on how Go's GMP scheduler interacts with `workerpool`.

The Go runtime has:

- **G (goroutines):** Each pool task and each worker is a G.
- **M (machine threads):** OS threads. Capped roughly at `GOMAXPROCS` for runnable goroutines.
- **P (processors):** Scheduling contexts, one per `GOMAXPROCS`.

A worker pool with `maxWorkers = N`:

- Has 1 dispatcher G + up to N worker Gs at peak.
- Each running task is a runnable G on some M/P.
- If `N > GOMAXPROCS`, more workers than cores, the runtime time-slices.

For CPU-bound work, the right `maxWorkers` is `GOMAXPROCS`. More workers means more context switches for no gain.

For I/O-bound work, the right `maxWorkers` is much higher — workers spend most of their time blocked on I/O (which yields the G to the runtime, so the M is free to run other Gs). 64-128 workers on 8 cores is normal.

For mixed work, you typically size for the I/O side and accept some over-subscription for the CPU work.

The library does not know about your workload type. It is up to you to pick.

### What about `LockOSThread`?

If your task calls `runtime.LockOSThread()`, the M cannot run other Gs while the task runs. That eats a thread per `LockOSThread` task. With many such tasks in a pool, you accumulate locked threads.

`LockOSThread` is rare (cgo with thread-local state, ImageMagick bindings, etc.). If your tasks use it, account for it explicitly.

---

## Appendix L: Reading the Test Suite

The library's `workerpool_test.go` is worth reading for two reasons:

1. It documents the library's behaviour at the contract level.
2. It is a model for how to test concurrency primitives.

Notable tests:

- `TestExample` — the README example, used as a sanity check.
- `TestMaxWorkers` — verifies the cap holds.
- `TestStopWait` — verifies drain semantics.
- `TestStopRace` — concurrent Stop calls.
- `TestPaused` — pause/resume semantics.
- `TestOverflow` — many tasks queued.
- `TestStopBeforeStart` — pool stopped before any submit.

Read each in the source. Note patterns like:

- Tight loops with `runtime.Gosched()` to yield scheduling.
- `time.Sleep` for ordering observations (necessary for some race tests).
- `runtime.NumGoroutine` for leak checks.

These patterns are reusable in your own concurrency tests.

---

## Appendix M: Real-World Library Comparison Table

Synthesised from real usage in open-source projects.

| Aspect | `workerpool` | `ants` | `tunny` | Hand-rolled |
|--------|------------|------|------|------------|
| Lines of source | ~300 | ~3000 | ~700 | ~50-200 |
| API surface | Tiny | Medium | Small | Custom |
| Compile time impact | Negligible | Small | Small | Zero |
| Run-time overhead per submit | ~200 ns | ~150 ns | ~500 ns (sync) | ~100-300 ns |
| Memory per pool | ~5-50 KB | ~10-100 KB | ~5-50 KB | varies |
| Configurability | Low | High | Medium | Yours |
| Documentation | OK | Good | OK | Yours |
| Maintenance burden | None | None | None | Yours |
| Stability | Very high | High | High | Depends |
| Community usage | High | Highest | Medium | N/A |

For "I just need a pool" choose `workerpool`. For "I need a pool with knobs" choose `ants`. For "I need request-response with state" choose `tunny`. For "I need exactly *my* pool" hand-roll.

---

## Appendix N: Pool Patterns in Other Languages

Knowing how other languages do pools helps you appreciate Go's approach.

### Java: ExecutorService

```java
ExecutorService pool = Executors.newFixedThreadPool(10);
pool.submit(() -> doWork());
pool.shutdown();
pool.awaitTermination(30, TimeUnit.SECONDS);
```

Similarities: bounded pool, submit-style API, awaitTermination is like `StopWait`.

Differences: Future return value for results, more elaborate shutdown semantics (`shutdownNow` cancels via `Thread.interrupt`).

### Python: concurrent.futures.ThreadPoolExecutor

```python
with ThreadPoolExecutor(max_workers=10) as pool:
    futures = [pool.submit(work, arg) for arg in args]
    for f in concurrent.futures.as_completed(futures):
        print(f.result())
```

Similarities: bounded pool, submit returns a future.

Differences: explicit Future objects, context-manager-driven shutdown.

### Rust: rayon

```rust
let pool = rayon::ThreadPoolBuilder::new().num_threads(10).build().unwrap();
pool.install(|| {
    // parallel work here
});
```

Different model entirely — rayon is data-parallel, with work-stealing across all threads. Closer to Go's runtime scheduler than to `workerpool`.

### Erlang: spawned processes

Erlang does not have a pool primitive because processes are so cheap. You spawn one per task. `workerpool` exists in Go because while goroutines are cheap, they are not *infinitely* cheap, and a pool gives you bounded concurrency.

Go sits closer to Erlang than Java in spawn cost, which is why pool libraries in Go are smaller and simpler than Java's.

---

## Appendix O: The Decision to Use a Pool At All

A senior engineer's checklist before adding a worker pool to a service.

1. **Is there a concurrency bound to enforce?** If not (you control the producer and the work matches the cores), maybe you do not need a pool. `go work()` with a `WaitGroup` suffices.

2. **Is the producer untrusted?** If yes, you absolutely need a bound, but the bound should include queue depth — `workerpool`'s unbounded queue does not save you from a DoS.

3. **Is the workload short-lived or long-running?** Short batches do not need pools. Long-running services with many small tasks benefit from pool reuse.

4. **Are workers stateful?** If yes, `workerpool` is not the right tool (use `tunny`).

5. **Is per-task latency critical?** If yes, measure the dispatcher overhead vs your task duration.

6. **Is there an existing pool elsewhere in the codebase?** If yes, can you share it? Avoid pool sprawl.

7. **Will the pool be tuned over time?** If yes, you may want resize (use `ants`).

If you answer "yes" to enough of these, a pool — and specifically `workerpool` — is the right call.

---

## Appendix P: Reading workerpool With a Friend

A suggested 60-minute exercise.

Two people, one laptop, one screen. Open `workerpool.go` from the library source. Read it together, line by line. Take turns reading and explaining.

Stops to discuss:

1. The struct fields — what does each represent?
2. `New` — why does it spawn the dispatcher immediately?
3. `Submit` — why an unbuffered channel?
4. The dispatcher's outer `for` loop — what is the invariant on each iteration?
5. The dispatcher's `select` — why two cases? Why a default on the inner select?
6. `worker` — what is the role of the nil sentinel?
7. The idle timer — why two timer ticks before reaping?
8. `Stop` / `StopWait` — why the `stopLock`?
9. The deque — why use the gammazero/deque, not a slice?

After 60 minutes, both people should be able to explain the dispatcher to a third person from memory.

This exercise has produced more "aha" moments in code reviews than any documentation. The library is small enough to absorb fully; few libraries are.

---

## Appendix Q: A Comparison Table of Pool Memory and Throughput

Numbers from a small benchmark, single producer goroutine, empty task. Take with a grain of salt; vary by machine and Go version.

| Pool design | ns/op | B/op | allocs/op | Workers idle? |
|-------------|-------|------|-----------|---------------|
| `workerpool.Submit` | 180 | 16 | 1 | reaped after 2s |
| `workerpool.SubmitWait` | 450 | 112 | 3 | reaped after 2s |
| `ants.Submit` (default config) | 150 | 0 | 0 | reaped after 1s |
| `ants.PoolWithFunc.Invoke` | 100 | 0 | 0 | reaped after 1s |
| `tunny.Process` | 480 | 24 | 1 | always alive |
| Hand-rolled chan+goroutine | 130 | 16 | 1 | always alive |

Observations:

- `ants.PoolWithFunc` is the throughput winner because it avoids closure allocation.
- `workerpool.Submit` is competitive with hand-rolled and slightly slower than `ants`.
- `SubmitWait` and `tunny.Process` cost roughly the same (they are both synchronous).
- The hand-rolled variant keeps all workers alive forever, which trades memory for setup speed.

For most production workloads, none of these differences matter. The work itself dominates by orders of magnitude.

---

## Appendix R: Pool as Part of a Larger System

A simple service architecture that uses `workerpool`:

```
            HTTP Server
                │
                ▼
        handler (per-request goroutine)
                │
                ├── validate
                ├── auth check
                ├── DB call
                │
                ▼
        spawn background work via pool ──→ workerpool
                │                              │
                ▼                              ▼
        respond to client                   process tasks asynchronously
                                               │
                                               ├── send metrics
                                               ├── enqueue webhook
                                               ├── invalidate cache
```

The pool is a "side channel" for non-critical work. The request hot path returns to the client before background work completes. If the pool is overloaded, the client still gets a response — but the background work may be delayed or dropped.

This pattern keeps tail latencies low. The pool's unbounded queue is mitigated by:

- A semaphore in front (drop on overload).
- Monitoring queue depth.
- A SIGTERM-driven drain at shutdown.

Many production services look exactly like this. `workerpool` is the right tool for the "background work" box.

---

## Appendix S: Common Production Knobs

Things you should be able to control about a pool in production, even if `workerpool` does not expose them directly.

1. **maxWorkers.** Configurable via env var or config file. Not changeable at runtime without restart (or use a wrapper).

2. **Idle timeout.** Forked if you really care; otherwise use the 2s default and add a heartbeat task if needed.

3. **Queue cap.** Implemented via semaphore. Configurable.

4. **Drop policy.** When the queue cap is hit: log, drop, drop-newest, drop-oldest, return error. Pick one and document.

5. **Drain timeout.** How long `StopWait` is allowed to take during shutdown. Default 30s on Kubernetes.

6. **Panic policy.** Recover, log, optionally re-raise (rare). Wrapped in your closure.

7. **Metrics.** Submitted, completed, panicked, queue depth, task duration. Prometheus or your choice.

8. **Tracing.** OpenTelemetry span from submit to complete.

A production-ready wrapper exposes all eight as configurable parameters.

---

## Appendix T: Closing Thoughts on the Library's Design Philosophy

`gammazero/workerpool` is a study in restraint. The author had every opportunity to add features (and many PRs requesting them); he said no. The result is a library you can understand fully in a couple of hours.

This is a rare quality. Most libraries grow features over time, accumulating complexity. `workerpool` has stayed roughly the same size for years. The API surface is small enough that no one needs a long reference card.

When you write your own libraries, consider this model. What is the *minimum* API that solves the user's problem? Can you say no to good-but-not-essential features? The Go ecosystem is full of small, focused libraries (Mat Ryer's `is` for testing, `gorilla/mux` for routing, etc.) and they are better-loved than larger ones.

`workerpool` is the canonical example for worker pools. Learn it deeply, and you will think about every other API differently.

---

That's the senior file. The professional file picks up here to talk about production realities: sizing, observability, real incidents, and the judgement calls that separate a working pool from a robust one.

---

## Appendix U: Writing a Pool With Generics

Go 1.18 added generics. The library has not adopted them because changing `func()` to `func[T any](T)` would break every caller. But you can build a generic wrapper:

```go
type TypedPool[T any] struct {
    inner *workerpool.WorkerPool
    fn    func(T)
}

func NewTypedPool[T any](max int, fn func(T)) *TypedPool[T] {
    return &TypedPool[T]{
        inner: workerpool.New(max),
        fn:    fn,
    }
}

func (tp *TypedPool[T]) Submit(arg T) {
    tp.inner.Submit(func() { tp.fn(arg) })
}

func (tp *TypedPool[T]) StopWait() {
    tp.inner.StopWait()
}
```

Usage:

```go
pool := NewTypedPool[int](4, func(x int) {
    fmt.Println("processing", x)
})
for i := 0; i < 10; i++ {
    pool.Submit(i)
}
pool.StopWait()
```

The wrapper saves you from writing closures at every call site. The function `fn` is bound at pool creation; the argument is typed `T`. Internally each `Submit` still allocates a closure (capturing `arg` and `tp.fn`), so there is no allocation reduction — just ergonomic improvement.

For allocation reduction with generics, you would need `ants.NewPoolWithFunc`'s style, where the function is bound once and arguments flow through an interface channel.

---

## Appendix V: Coordination With `errgroup`

A common combination: `errgroup.Group` for error propagation and cancellation, `workerpool` for bounded execution. The shapes interact subtly.

### Mistake: using both for the same task

```go
g, ctx := errgroup.WithContext(context.Background())
pool := workerpool.New(4)

for _, item := range items {
    item := item
    g.Go(func() error {           // errgroup goroutine
        pool.Submit(func() {       // pool task
            process(ctx, item)
        })
        return nil
    })
}
g.Wait()
```

This is wrong-ish: `errgroup.Go` returns immediately after `pool.Submit`, so `g.Wait()` returns before tasks actually run. The pool is left with tasks in flight; the program might exit before they finish.

### Correct: pool with errgroup-style aggregation

Write your own. Use the pool for execution, an `errgroup`-like wrapper for errors:

```go
type ErrorPool struct {
    pool *workerpool.WorkerPool
    once sync.Once
    err  error
}

func (ep *ErrorPool) Submit(f func() error) {
    ep.pool.Submit(func() {
        if err := f(); err != nil {
            ep.once.Do(func() { ep.err = err })
        }
    })
}

func (ep *ErrorPool) WaitErr() error {
    ep.pool.StopWait()
    return ep.err
}
```

Or use `errgroup` for the wait, but submit through the pool:

```go
g, ctx := errgroup.WithContext(context.Background())
pool := workerpool.New(4)

for _, item := range items {
    item := item
    g.Go(func() error {
        done := make(chan error, 1)
        pool.Submit(func() {
            done <- process(ctx, item)
        })
        select {
        case err := <-done:
            return err
        case <-ctx.Done():
            return ctx.Err()
        }
    })
}
err := g.Wait()
pool.StopWait()
```

This is functional but baroque. If you find yourself writing this, consider whether you want `errgroup` at all (use a `sync.Map` or `errors.Join` for errors) or whether you want `workerpool` (use raw goroutines bounded by `errgroup.SetLimit(N)`).

`errgroup.SetLimit(N)` was added in Go 1.20 and gives errgroup its own pool semantics. For many use cases, it makes `workerpool` redundant:

```go
g := new(errgroup.Group)
g.SetLimit(4)
for _, item := range items {
    item := item
    g.Go(func() error {
        return process(item)
    })
}
err := g.Wait()
```

Simpler, error-aware, bounded. The only thing `workerpool` adds is the unbounded queue (errgroup blocks when over the limit). For most cases, that's a feature you do not need.

---

## Appendix W: A Worked Migration From workerpool to ants

Suppose your service has grown and `workerpool`'s unbounded queue is a liability. You want to switch to `ants`, which has `WithNonblocking(true)` for fail-fast submission.

Step 1 — change the import:

```go
import "github.com/panjf2000/ants/v2"
```

Step 2 — change the constructor:

```go
// before
pool := workerpool.New(maxWorkers)

// after
pool, _ := ants.NewPool(maxWorkers, ants.WithNonblocking(true))
```

Step 3 — change submissions:

```go
// before
pool.Submit(func() { process(item) })

// after
if err := pool.Submit(func() { process(item) }); err != nil {
    // pool full, handle drop
    metrics.Drops.Inc()
}
```

The `Submit` now returns an error when the pool is at capacity (with non-blocking mode). Handle it.

Step 4 — change shutdown:

```go
// before
pool.StopWait()

// after
pool.Release() // ants.Release waits for tasks to finish
```

Step 5 — `SubmitWait` does not exist on `ants`. Replace with a manual done channel:

```go
// before
pool.SubmitWait(func() { ... })

// after
done := make(chan struct{})
_ = pool.Submit(func() {
    defer close(done)
    ...
})
<-done
```

This is more verbose. Consider whether you actually needed `SubmitWait` or were using it out of habit.

Step 6 — update tests, benchmarks, and documentation.

Total migration effort for a medium service: a day or two. The gain: configurable idle timeout, fail-fast submission, runtime resize, slightly higher throughput, generic typed-args variant.

When the migration is *not* worth it: small services with predictable load. The simpler `workerpool` API is its own benefit.

---

## Appendix X: Building Confidence

If you have made it this far, you should be able to:

- Read `workerpool.go` straight through without confusion.
- Predict the output of any small program using the library.
- Explain to a colleague why X happens (where X is anything from "Submit doesn't block" to "Pause consumes workers").
- Decide between `workerpool`, `ants`, `tunny`, and hand-rolled for any given problem.
- Build your own pool from scratch that matches `workerpool`'s contract.

Test your confidence by:

1. Pick a feature `workerpool` does not have (priority, results, retry).
2. Sketch how you would add it, either by wrapping or forking.
3. Estimate the lines of code and the test surface.
4. Compare your design against `ants`'s implementation of the same feature.

If you can do step 4 with no surprises, you have senior-level fluency.

---

## Appendix Y: Reading List

Beyond the library itself, a curated reading list for the next level:

1. **Go runtime source: `runtime/chan.go`.** Channels are the substrate. Knowing their implementation deepens your pool intuition.
2. **Go runtime source: `runtime/proc.go`.** The scheduler. Understanding GMP makes pool sizing decisions principled.
3. **`golang.org/x/sync/errgroup`.** Read the source. It is short and beautiful.
4. **`golang.org/x/sync/semaphore`.** A weighted semaphore for sophisticated bound-checking.
5. **`panjf2000/ants` source.** A different design for the same problem.
6. **`Jeffail/tunny` source.** A third design for a related problem.
7. **`tylertreat/BoomFilters`.** Tangential, but learn how high-throughput Go libraries are structured.
8. **Sameer Ajmani, "Go Concurrency Patterns" (2012 GopherCon talk).** Foundational.
9. **Katherine Cox-Buday, "Concurrency in Go" (book).** Comprehensive.
10. **Dave Cheney's blog.** Lots of Go-internals goodness.

---

## Appendix Z: The Last Word

A senior engineer evaluating `workerpool` does not start with "is this fast enough?". They start with "is this *right* for my problem?" Speed comes second; correctness, observability, and operational simplicity come first.

`workerpool` excels at operational simplicity. It does fewer things than alternatives, but it does them clearly. The trade-off — "I write the wrappers I need" — is acceptable for most production code because the wrappers are short and well-understood.

When you switch away from `workerpool`, it should be because of a specific need: dynamic resize, sub-microsecond latency, generics, per-worker state. Switching because "the cool kids use `ants`" is not a senior-level reason.

This file has been about understanding the library deeply. The professional file will be about *operating* it well. Together they should give you everything you need to ship pool-based code with confidence.

---

## Appendix AA: A Production Bug Story

A small service used `workerpool` for sending email notifications. Pool size: 20. Mostly fine for years.

One day, the SMTP server started intermittently hanging. Connections would not time out; they would just sit. A task that hit one of these hangs would block forever. The pool gradually filled with hung tasks. With 20 workers and 20 hung tasks, no new emails were processed.

The service kept accepting work via `Submit` (queue grew unbounded). The queue hit hundreds of thousands. Memory went to 4 GB. The pod restarted (OOM). The new pod inherited the same SMTP server's hang. Loop.

Three lessons:

1. **Always time-bound network calls.** The task should have had `http.Client{Timeout: 30 * time.Second}` or equivalent. A hung connection should fail after 30 seconds, freeing the worker.

2. **Always bound the queue if production is uncertain.** A semaphore in front of `Submit` would have rejected new emails (returning HTTP 503) once 1,000 were queued, signalling distress.

3. **Monitor queue depth.** A graph of `WaitingQueueSize` over time would have shown growth in real time. The on-call would have had warning before the OOM.

The fix took a day:

```go
// in handler
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()

if pool.WaitingQueueSize() > 1000 {
    http.Error(w, "overload", 503)
    return
}

pool.Submit(func() {
    sendEmail(ctx, msg)
})
```

Two lines of guard, one context propagation. The pool's behaviour stopped being a problem. The SMTP server's intermittent hang was a separate issue, but at least the pool no longer made it catastrophic.

This is what senior judgement looks like in practice: not "use the perfect library" but "wrap the imperfect library with the right guards".

---

## Appendix BB: A Synthesis

If we boil down the senior file to one paragraph:

`gammazero/workerpool` is a small, channel-centric Go library implementing a worker pool with an unbounded queue and a 2-second idle reaper. Its dispatcher is a single goroutine running a `select` over `taskQueue` and a timer, forwarding tasks to one of N stateless worker goroutines (or queueing them in a deque). Submission is fast and non-blocking in practice; shutdown is graceful via `StopWait` (drain) or `Stop` (discard). The library trades configurability for simplicity, which is the right trade for most production use cases. When the trade is wrong — high throughput, runtime resize, per-worker state, generic args — switch to `ants`, `tunny`, or a hand-rolled pool. To use the library well, wrap it with metrics, bound its queue, give tasks context-based timeouts, recover panics with attribution, and pair every `New` with a `StopWait`. The library is small enough to read in 30 minutes; do that, and the rest is judgement.

That single paragraph is the senior-level summary. The next file — professional — turns judgement into wisdom through production stories and operational deep dives.

---

## Appendix CC: Self-Test for Senior Level

Five short questions. Answer them out loud without re-reading the file. If you stumble, re-read.

1. Why does `workerpool` use two channels (`taskQueue` and `workerQueue`) instead of one?
2. What does `idle = true` mean in the dispatcher's local state? When does it flip?
3. If `maxWorkers = 4` and you call `Pause(ctx)`, how many tasks need to run before subsequent submits dispatch normally after `cancel(ctx)`?
4. If a task panics and the library's recover catches it, but the task held a mutex when it panicked, what is the state of the mutex?
5. What is the relationship between `pool.WaitingQueueSize()` and the dispatcher's `waitingQueue.Len()`?

Answers:

1. To give the dispatcher a `select` choice between accepting new work and feeding workers. With one channel, this choice would be lost.

2. `idle = true` means "the dispatcher's last timer tick fired without a task arriving since the previous tick". It flips to `false` when a task arrives.

3. Four — one sentinel task per worker. Each is blocked on `<-ctx.Done()` until cancel. After cancel, all four return, freeing the workers. Then queued submits dispatch.

4. The mutex is still locked. Recover swallows the panic but does not unwind held locks. Always `defer mu.Unlock()`.

5. `WaitingQueueSize()` reads the atomic counter, which the dispatcher updates from `waitingQueue.Len()` whenever the queue changes. They are eventually consistent; the atomic may be slightly stale.

Score 5/5: you are ready for the professional file. Score 3-4: re-read the relevant sections. Score below 3: re-read the dispatcher walkthrough.

---

## Appendix DD: One More Look at the Big Picture

Here is the entire library, conceptually, in one page:

```
Construction:
  New(N) → pool struct, dispatcher goroutine starts, workers lazy

Submit:
  Submit(f) → sends f on taskQueue → dispatcher receives → routes to worker
              (spawn new, hand to existing idle, or enqueue)

SubmitWait:
  SubmitWait(f) → wraps f with done close → Submit wrapper → block on done

Dispatch:
  for { check queue; select { task: route, timer: maybe reap } }

Worker:
  for task := initial; task != nil; task = <-workerQueue { run(task) }

Stop:
  close(taskQueue) → dispatcher exits loop → if wait: drain queue → poison workers → close stoppedChan

Pause:
  submit maxWorkers blocking sentinels → resume by canceling ctx

Observability:
  WaitingQueueSize: atomic counter
  Stopped: bool flag
```

That is the whole library. Eight verbs and one state machine. Internalise this and you can answer any question about `workerpool` behaviour without looking at code.

---

## Appendix EE: Goodbye, Senior

You started this file thinking of `workerpool` as a magic box. You finish it knowing every line of the dispatcher. That is a meaningful transition.

The professional file picks up where this leaves off — but it is a different kind of knowledge. Senior is about understanding code; professional is about operating systems. Senior reads source; professional reads incidents. Both are essential. Both are different.

Take a break. Drink water. Then onward.

---

## Appendix FF: Channel Send-Side Considerations

A deeper dive into what `pool.Submit` does at the channel level.

`taskQueue` is unbuffered. The send is `p.taskQueue <- task`. Go's channel semantics for unbuffered channels:

1. If a receiver is ready (the dispatcher is blocked in `case task := <-p.taskQueue`), the send completes synchronously. The sender's goroutine continues immediately.
2. If no receiver is ready, the sender's goroutine is parked. Go records this on the channel's send queue. When the dispatcher reaches the select case, the runtime hands the value across and unparks the sender.

In the steady state, the dispatcher is almost always parked in the select, so submissions complete in nanoseconds. When the dispatcher is busy (e.g., flushing the waiting queue), submissions briefly park.

This is one of the reasons "Submit never blocks for long" is true: the dispatcher's busy work is short (microseconds to drain one queue entry).

### What about multiple submitters racing?

If 100 goroutines call `Submit` simultaneously, only one can be served by the dispatcher at a time (the channel is single-receiver). The other 99 park on the channel's send queue. The runtime hands them over one by one as the dispatcher loops.

The visible effect: the submitter throughput is bounded by the dispatcher's loop speed. In practice, this is millions of submits per second, so for most workloads it's not the bottleneck.

If submission contention is actually the bottleneck, sharded pools (Appendix J) are the fix. Each shard has its own dispatcher.

### What about send on closed channel?

If `Stop` closes `taskQueue` while a submitter is parked on the send, Go panics with "send on closed channel". The library tries to prevent this by checking `Stopped` before sending — but a race remains. Modern versions wrap the send in `defer recover` to swallow the panic.

In your own code: order matters. Stop the producers before stopping the pool. This is the standard graceful shutdown pattern.

---

## Appendix GG: Why the Pool Does Not Use sync.WaitGroup

A common question: why does `workerpool` not use `sync.WaitGroup` for the worker count and shutdown coordination?

Reasons:

1. **WaitGroup does not have a "wait until decremented past N" semantic.** It can only wait for zero. The pool needs more nuanced coordination.

2. **WaitGroup's `Add` after `Wait` is racy.** If you `Add(1)` while another goroutine is in `Wait`, it can panic. The pool dynamically spawns workers, which would need careful coordination.

3. **Channels are sufficient.** The dispatcher already tracks `workerCount`; it doesn't need a WaitGroup duplicating the count. The `stoppedChan` close signals completion to outside waiters.

A pool that uses WaitGroup would look like:

```go
type Pool struct {
    workersWg sync.WaitGroup
    // ...
}

func (p *Pool) spawnWorker() {
    p.workersWg.Add(1)
    go func() {
        defer p.workersWg.Done()
        // worker loop
    }()
}

func (p *Pool) Stop() {
    // signal workers
    p.workersWg.Wait()
}
```

This works but is no simpler than what `workerpool` does. The library's approach (a `workerCount` int in the dispatcher and a `stoppedChan`) is more direct.

This is a style choice. WaitGroup-based pools are common; channel-based pools are also common. Either is fine.

---

## Appendix HH: The Cost of `Submit(nil)`

A small exploration. Some versions of the library check for nil; others don't.

If you `Submit(nil)`:

- The send goes through to `taskQueue`.
- The dispatcher receives `nil`.
- The dispatcher tries to forward `nil` to a worker.
- The worker reads `nil` and exits.

So `Submit(nil)` *reaps a worker*. The pool now has one fewer worker. The next non-nil submit will spawn a fresh worker, paying ~1 µs of overhead.

If you submit a million nils, you reap workers as fast as the dispatcher can dispatch. Each task does nothing; each one shrinks the pool. After many nils, only the dispatcher and a few workers (spawned just before idle reaper kicks in) remain.

This is not catastrophic but is wasteful. Modern versions check for nil in `Submit`:

```go
func (p *WorkerPool) Submit(task func()) {
    if task == nil {
        return
    }
    p.taskQueue <- task
}
```

Early return; no send. Safer.

The lesson: the library protects against the most common foot-gun but does not protect against all of them. Validate inputs at the call site.

---

## Appendix II: Race-Detector-Catchable Patterns

The race detector catches data races, not all concurrency bugs. Things it catches in pool code:

```go
var sum int
for i := 0; i < 100; i++ {
    i := i
    pool.Submit(func() { sum += i })  // RACE: unsynchronised write
}
pool.StopWait()
```

Run with `go test -race`; the detector flags this. Fix with atomic or mutex.

Things it does *not* catch:

```go
results := make(chan int)
for i := 0; i < 10; i++ {
    pool.Submit(func() { results <- i })
}
pool.StopWait()
close(results)
// somewhere in the middle, another goroutine reads results
```

If `close` is followed by reads from a stale reader, no race — but the reader sees a closed channel. The library's correctness is fine; your code is buggy.

The race detector is necessary but not sufficient. Logical races, deadlocks, and lifecycle bugs need other tools (manual review, fuzz testing, integration tests).

---

## Appendix JJ: Fuzz Testing the Library

Go 1.18+ has built-in fuzzing. You can fuzz the library by:

```go
func FuzzPoolSize(f *testing.F) {
    f.Add(int8(4), int8(100))
    f.Fuzz(func(t *testing.T, maxW int8, n int8) {
        if maxW < 1 || n < 1 {
            return
        }
        pool := workerpool.New(int(maxW))
        defer pool.StopWait()

        var done int64
        for i := int8(0); i < n; i++ {
            pool.Submit(func() {
                atomic.AddInt64(&done, 1)
            })
        }
        pool.StopWait()
        if atomic.LoadInt64(&done) != int64(n) {
            t.Errorf("expected %d, got %d", n, done)
        }
    })
}
```

The fuzzer explores `(maxW, n)` combinations. Run with:

```bash
go test -fuzz=FuzzPoolSize -fuzztime=30s
```

For libraries this small, fuzzing usually finds nothing (they have been exercised heavily). But for *your* code on top of the library, fuzzing can find race conditions and panic conditions you missed.

---

## Appendix KK: Code Review Heuristics for Pools

When you review a teammate's PR using `workerpool` (or any pool), look for:

### Pool lifecycle

- Is the pool created? Where?
- Is the pool stopped? On every code path?
- Is the pool reused across requests or created per call?

### Submission

- Are loop variables captured correctly (shadowing on pre-1.22)?
- Are closures small (no large captured state)?
- Is the rate of submission bounded? By what?

### Shared state

- Does any task touch shared state?
- Is that state behind a mutex, atomic, or channel?
- Are reads after `StopWait` guaranteed to see writes?

### Error handling

- Are errors collected from tasks?
- Is the first error sufficient, or do you need all?
- Are panics recovered? Are panic values logged?

### Observability

- Is queue depth monitored?
- Are submissions and completions counted?
- Is task duration recorded?

### Shutdown

- Is shutdown graceful?
- Is there a deadline on `StopWait`?
- Are producers stopped before consumers?

If a PR passes all six checklists, it is probably correct. If it fails any, request changes.

---

## Appendix LL: The Future of workerpool

The library is mature and stable. Don't expect major changes. Expected (and welcome) future additions:

- Configurable idle timeout (long-requested; trivial to add).
- Optional context-aware `SubmitCtx`.
- Optional metrics callbacks.
- A `Resize` method.

Unexpected (would break the design philosophy):

- Generics-typed `Submit[T]`.
- Result-bearing `SubmitR[T]`.
- Priority queues.

If you want any of the unexpected items, switch to `ants` or build your own. The library author has been clear that `workerpool` is "done" in feature scope.

---

## Appendix MM: Reading workerpool's Git History

The repo's history is short and educational. Notable commits to study:

- Initial commit: see how the dispatcher was first conceived.
- v1.0 tag: the first stable release. API freezing point.
- Panic recovery addition: when and why.
- Pause method: the elegant sentinel-based implementation.

Reading library history teaches you how libraries evolve under pressure. Most changes are small; the API surface is preserved. The author's discipline is visible in the diffs.

---

## Appendix NN: A Comprehensive Code Walkthrough Exercise

Take 90 minutes and do this exercise. It will solidify everything in this file.

1. Clone `gammazero/workerpool`. Open `workerpool.go` in your editor.
2. Read it top to bottom. Mark anything you don't understand.
3. For each marked spot, look it up — Go docs, stdlib source, blog posts.
4. Write a small program that exercises each method.
5. Run it under `go run -race`. Verify no races.
6. Add a `runtime.NumGoroutine()` print at key points. Verify counts match your mental model.
7. Step through with `delve`:
   ```
   dlv debug
   (dlv) break workerpool.go:120  # dispatcher select
   (dlv) continue
   ```
   Watch the dispatcher loop with each task.
8. Write a one-page summary of the library, in your own words. Pretend you're explaining it to a junior teammate.

The summary is the deliverable. If you can write a coherent one-page explanation, you have mastered the library at senior level.

---

## Appendix OO: One Final Aside On `time.Timer`

The library uses `time.Timer` for the idle reaper. A subtle thing to know:

`time.Timer`'s channel `C` has *one* buffered slot. When the timer fires, the runtime sends on `C`. If `C` is already full (you didn't drain it), the next fire is dropped.

This matters because the dispatcher's select might miss the timer firing if it has just dispatched a task and reset the timer:

```go
select {
case task := <-taskQueue: ...
case <-timeout.C: ...  // might be a stale fire
}
timeout.Reset(idleTimeout)
```

After `Reset`, if the old fire is still in `C`, the next select call sees it immediately — and `idle` may be wrong. The library handles this by checking `idle` before reaping; if `idle` is false (recent task), no reap happens even if the timer case fires.

This is exactly the kind of subtle thing reading source teaches you.

In your own timer-based code, remember: timers are not "real-time". They fire shortly after the deadline, possibly with stale state. Always validate intent before acting on a timer fire.

---

## Appendix PP: Senior Wrap-Up

The senior file has been long. To leave you with manageable take-aways:

1. **The dispatcher is the brain.** A single goroutine in a `select` loop, mediating between submitters and workers.

2. **Workers are bodies.** Stateless, exit on nil, recover panics in modern versions.

3. **The queue is a deque.** Unbounded, grows and shrinks dynamically.

4. **Shutdown closes the input.** That's the only "kill switch". Everything else flows from it.

5. **Pause is sentinels.** No new state — just consume worker slots.

6. **The design is minimal by choice.** Features are not added casually.

7. **Wrap, fork, or replace.** Three escalating responses to library limitations.

8. **Observability is yours to build.** The library exposes only what's essential.

9. **Performance is competitive but not best-in-class.** For most workloads, irrelevant.

10. **Stability is the killer feature.** Five years and the API still works.

Take these forward. The professional file is one click away.

---

## Appendix QQ: Senior-Level Bibliography

Citations and pointers, formal-style:

- Gillis, Andrew J. "workerpool: A simple and efficient worker pool for Go." github.com/gammazero/workerpool, MIT License.
- Cox-Buday, Katherine. *Concurrency in Go*. O'Reilly Media, 2017.
- Donovan, Alan A. A.; Kernighan, Brian W. *The Go Programming Language*. Addison-Wesley, 2015.
- Pike, Rob. "Concurrency Is Not Parallelism." Heroku Waza talk, 2012.
- Donovan, Alan A. A.; Kernighan, Brian W. Chapter 9, "Concurrency with Shared Variables."
- Various Go runtime source files: `runtime/proc.go`, `runtime/chan.go`, `runtime/select.go`.
- Go Memory Model: https://go.dev/ref/mem.

---

## Appendix RR: A Note for Authors of Pool-Like Libraries

If you are inspired to write your own pool library, three pieces of advice:

1. **Keep it small.** The Go ecosystem is full of large concurrency libraries that nobody uses. Small, focused libraries get adopted.

2. **Choose a single design philosophy.** `workerpool` is "fire-and-forget with idle reaping". `ants` is "fast and configurable". `tunny` is "request-response with state". Pick one; do not try to be all three.

3. **Document the trade-offs explicitly.** The README should say "this library is good for X, bad for Y, see Z for Y." Users appreciate honesty.

If your library is small, focused, and honest, you might end up writing the next `workerpool`. The Go community will thank you.

---

That's truly the end. Read, code, repeat, ship.

---

## Appendix SS: A Deep Dive on the Deque

`workerpool` uses `gammazero/deque` for its waiting queue. Why a deque and not something else?

### Deque vs slice

A slice grows when appended; that's cheap (amortised O(1)). But removing the front (`q = q[1:]`) keeps a reference to the original backing array. Garbage cannot be collected. Over time, you accumulate "head waste" — slots at the start of the backing array that are no longer reachable.

To reclaim, you would need to occasionally `copy` the live elements to a new slice. That is an O(n) operation.

A deque (ring buffer) avoids both issues:

- Push and pop on both ends are O(1).
- Memory is reused — no head waste.
- When the deque shrinks below a threshold, it shrinks its backing array.

For a queue that grows and shrinks dramatically (a typical pool's waiting queue under bursty load), a deque is much more memory-efficient.

### Deque vs linked list

A linked list also has O(1) push/pop, but each node is a separate allocation. For 100,000 queued tasks, that's 100,000 mini-allocations — heavy GC pressure.

A deque's backing array is one allocation per growth event. Many fewer GC pressure points.

### Deque vs channel

A buffered channel could serve as the queue. Buffer of `maxQueueSize`. But:

- Buffer size is fixed at creation. No growth/shrink.
- Channel ops are slightly more expensive than slice ops (mutex inside).
- The library wants the dispatcher to inspect the queue (peek the front). Channels do not allow peeking.

So channels are inappropriate. Deque wins.

### Deque vs heap

If you needed priority, a heap would replace the deque. But `workerpool` is FIFO only, so a heap would be slower and pointless.

### Reading `gammazero/deque` Source

The deque library is also small (a few hundred lines). It uses a ring buffer with two indices (`head` and `tail`) and resizes when full. Worth a 30-minute read if you are curious.

The key insight: the indices wrap around the backing array modulo capacity. To grow, allocate a new larger array, copy elements in linear order (rotating the ring), and update indices. To shrink, similar but smaller.

This is a textbook data structure. Implementing it correctly involves careful index arithmetic — easy to get wrong by one. The library handles it for us.

---

## Appendix TT: A Comparison of Channel-Centric vs Lock-Centric Pools

Two design philosophies; both are common.

### Channel-centric (workerpool)

- All coordination via channels.
- Few or no explicit locks.
- Reads "Go-idiomatic" (CSP).
- Easier to reason about (fewer racy paths).
- Slightly slower for high-contention scenarios.

### Lock-centric (ants)

- Mutexes around worker collection.
- Condition variables for blocking.
- Locks let you make multiple decisions atomically.
- Slightly faster under contention.
- More implementation complexity.

Neither is "better". The choice depends on:

- How much coordination is needed per operation.
- Whether you need atomic multi-step operations.
- Author preference and team familiarity.

`workerpool`'s channel-centric design is small enough to fit in one file. `ants`'s lock-centric design is larger but supports more features. Both are correct designs.

If you write your own pool, consider the language idiom (Go encourages channels) and your performance requirements (locks scale slightly better in hot paths). Either way, *consistency* within your library is more important than the choice.

---

## Appendix UU: Failure Modes of a Worker Pool

A list of every way a pool can go wrong.

1. **Forgotten StopWait** — dispatcher + workers leak.
2. **Tasks panic without recovery** — pool functions but loses information.
3. **Tasks panic with held mutex** — mutex stays locked, subsequent task tries to lock, deadlock.
4. **Tasks hang on I/O without timeout** — workers occupied forever, queue grows.
5. **Submitter outpaces consumer** — queue grows unbounded, OOM.
6. **Workers exhaust file descriptors** — each task opens a file, no close, FD limit hit.
7. **Tasks recurse via `Submit`** — fine if non-blocking, deadlock if `SubmitWait` and small pool.
8. **Two pools deadlock cross-feeding** — pool A's task submits to pool B, B's task submits to A, both queues fill.
9. **Pool size set without consideration** — too few workers, jobs queue forever; too many, contention.
10. **Misuse of `Stop` instead of `StopWait`** — silent data loss.
11. **Submit-after-Stop** — task lost.
12. **Pause without cancel** — pool permanently paused, queue grows.
13. **Pause + Stop race** — usually harmless but version-specific.
14. **Workers spawn goroutines without recover** — child goroutine panic crashes program.

Each of these has a defence in the patterns covered earlier. A robust production system has *defence in depth*: bounded queue, task timeouts, panic recovery, monitoring, shutdown deadlines. Any one defence will probably hold; together they certainly will.

---

## Appendix VV: A Deep Dive on Worker Lifetime

We've talked about workers being spawned lazily and reaped idle. Let's trace one worker's lifetime in detail.

### Birth

The dispatcher receives a task. No worker is currently waiting on `workerQueue`. The dispatcher checks `workerCount < maxWorkers`. If so, it calls `go worker(task, p.workerQueue)`. A new goroutine starts.

Cost of birth: ~1-2 microseconds for `go` + initial stack allocation.

### Active

The worker runs `task`. After the task completes (or panics + recovers), the worker enters `task = <-p.workerQueue`, blocking until the dispatcher hands it another task.

While the worker is in this blocked state, it consumes a goroutine slot but no CPU. The runtime parks it.

### Hand-off

The dispatcher receives another task. It tries `select { case p.workerQueue <- task: default: ... }`. The worker is waiting in `case ... <- p.workerQueue`. The runtime hands the task across. The worker unparks and runs the task.

Cost of hand-off: ~50-200 nanoseconds (channel send/receive).

### Death

The dispatcher's idle reaper fires. It sends `nil` on `workerQueue`. A waiting worker reads `nil`. The worker's `for task != nil` loop exits. The goroutine returns. The goroutine's stack is freed.

Cost of death: ~1 microsecond.

### Statistics

Over a long-running pool, the population of workers fluctuates between 0 (idle) and `maxWorkers` (saturated). The mean is roughly `(load / capacity) * maxWorkers`, where load is the task arrival rate and capacity is the per-worker throughput.

Resident memory for workers: `mean_count * stack_size`. With 50 workers averaging 4 KB stacks, that's 200 KB. Small.

### Worker reuse efficiency

If your tasks have any per-task setup cost (e.g., allocating a buffer), and you compute "per-task" naively, the worker pool's reuse benefit is in keeping that setup amortised. But `workerpool` itself does not let you bind state to workers — every task is independent. If you want worker-resident state, that's `tunny`'s domain.

You can fake it with goroutine-local-ish state, but it's clunky. Best to either:
- Use `tunny`.
- Pre-allocate the state in the task closure (allocated per task, GC'd after).
- Use a `sync.Pool` for objects.

`sync.Pool` is a great companion to `workerpool` for object reuse:

```go
var bufPool = &sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

pool.Submit(func() {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    // ... use buf ...
})
```

The pool gives task-level parallelism; `sync.Pool` gives object reuse. They compose well.

---

## Appendix WW: A Closing Code Reading

One last code-reading exercise. Read this user code carefully and predict its behaviour:

```go
func main() {
    pool := workerpool.New(3)

    for i := 0; i < 5; i++ {
        i := i
        pool.Submit(func() {
            time.Sleep(100 * time.Millisecond)
            fmt.Println(i)
            if i == 2 {
                pool.SubmitWait(func() {
                    fmt.Println("inner")
                })
            }
        })
    }

    pool.StopWait()
}
```

Predict the output and timing.

Analysis:

- Pool size 3. Tasks 0, 1, 2 dispatch immediately to workers. Task 3 and 4 queue.
- All tasks sleep 100ms.
- After ~100ms, tasks 0, 1, 2 wake. They print their index.
- Task 0 finishes. Worker free. Task 3 dispatches.
- Task 2's closure now calls `pool.SubmitWait(func() { fmt.Println("inner") })`. This wraps the inner func, submits, and waits.
- Task 2 is still occupying a worker. Workers 0, 2 are now running (task 0 just finished but worker still alive briefly).
- The inner func queues. It needs a free worker.
- Worker 0 (just freed) picks up... wait, has task 3 already grabbed it? Depending on timing, the inner func might queue behind task 3 or grab the worker first.
- Eventually the inner func runs. "inner" prints. SubmitWait returns. Task 2 returns. That worker is free.
- Task 4 eventually runs.

Predicted output (one possible interleaving):

```
0
1
2
3
inner
4
```

But order of 0, 1, 2 (and 3, 4) is not guaranteed. Could be:

```
1
2
0
inner
3
4
```

Run it; observe.

Now the trickier question: what if `maxWorkers = 1`?

```go
pool := workerpool.New(1) // only one worker!
```

Now:

- Task 0 dispatches; only worker is occupied. Tasks 1-4 queue.
- After 100ms, task 0 prints 0, returns. Worker free.
- Task 1 dispatches. Prints 1. Returns.
- Task 2 dispatches. Prints 2. Calls `SubmitWait` for inner. Inner queues *behind* tasks 3 and 4!
- Wait — no. The dispatcher dispatches the queue front. The current queue is [task 3, task 4]. The inner submission appends to the *back*: [task 3, task 4, inner].
- The inner func waits for completion via SubmitWait. Task 2 is blocked waiting.
- But task 2 is currently running on the only worker. The dispatcher has no free worker to dispatch task 3. Task 3 is queued.
- Inner is queued. But the dispatcher cannot dispatch anything because the only worker is busy (running task 2).
- Task 2 is waiting on inner. Inner needs the worker. Worker is task 2.
- DEADLOCK.

This is the small-pool `SubmitWait` deadlock from the middle file. With `maxWorkers = 1`, the program hangs forever.

This exercise crystallises why `SubmitWait` is risky in tasks. Senior-level engineers spot this immediately.

---

## Appendix XX: An End-of-File Mantra

To carry forward into the professional file and into your work:

> The pool is a contract: bounded concurrency, unbounded queue, graceful shutdown. It does what it says, no more, no less. To use it well, you bring your own guards — context, semaphore, recovery, observability. The library is small so you can trust it. Trust comes from understanding.

Repeat as needed.

---

## Appendix YY: One More Bit of Code

A small, complete, *senior-quality* wrapper that combines everything you have learned:

```go
package srpool

import (
    "context"
    "fmt"
    "log/slog"
    "runtime/debug"
    "sync"
    "sync/atomic"
    "time"

    "github.com/gammazero/workerpool"
)

// SRPool ("Safe Robust Pool") wraps gammazero/workerpool with production safety.
type SRPool struct {
    name     string
    pool     *workerpool.WorkerPool
    sem      chan struct{}
    log      *slog.Logger

    submitted atomic.Int64
    completed atomic.Int64
    panicked  atomic.Int64
    dropped   atomic.Int64

    stopOnce sync.Once
}

func New(name string, maxWorkers, queueCap int, log *slog.Logger) *SRPool {
    return &SRPool{
        name: name,
        pool: workerpool.New(maxWorkers),
        sem:  make(chan struct{}, queueCap),
        log:  log,
    }
}

// Submit schedules f for execution. Returns an error if the pool is full or stopped.
func (p *SRPool) Submit(ctx context.Context, taskName string, f func(context.Context)) error {
    select {
    case p.sem <- struct{}{}:
    case <-ctx.Done():
        p.dropped.Add(1)
        return ctx.Err()
    default:
        p.dropped.Add(1)
        return fmt.Errorf("pool %q full", p.name)
    }

    if p.pool.Stopped() {
        <-p.sem
        p.dropped.Add(1)
        return fmt.Errorf("pool %q stopped", p.name)
    }

    p.submitted.Add(1)
    p.pool.Submit(func() {
        defer func() {
            <-p.sem
            if r := recover(); r != nil {
                p.panicked.Add(1)
                p.log.Error("task panic",
                    "pool", p.name,
                    "task", taskName,
                    "panic", r,
                    "stack", string(debug.Stack()))
                return
            }
            p.completed.Add(1)
        }()
        f(ctx)
    })
    return nil
}

// Stats returns a snapshot of the pool's state.
func (p *SRPool) Stats() Stats {
    return Stats{
        Name:      p.name,
        Submitted: p.submitted.Load(),
        Completed: p.completed.Load(),
        Panicked:  p.panicked.Load(),
        Dropped:   p.dropped.Load(),
        Queued:    p.pool.WaitingQueueSize(),
        Stopped:   p.pool.Stopped(),
    }
}

type Stats struct {
    Name              string
    Submitted         int64
    Completed         int64
    Panicked          int64
    Dropped           int64
    Queued            int
    Stopped           bool
}

// Stop gracefully drains the pool, with a deadline. After deadline, hard-stops.
func (p *SRPool) Stop(deadline time.Duration) {
    p.stopOnce.Do(func() {
        done := make(chan struct{})
        go func() { p.pool.StopWait(); close(done) }()
        select {
        case <-done:
            p.log.Info("pool drained cleanly", "pool", p.name)
        case <-time.After(deadline):
            p.log.Warn("pool drain deadline; hard stop", "pool", p.name)
            p.pool.Stop()
            <-done
        }
    })
}
```

This is roughly 100 lines and incorporates:

- Bounded queue via semaphore.
- Context-aware submission (cancellable).
- Drop accounting.
- Panic recovery with structured logging.
- Submission and completion counting.
- Graceful shutdown with deadline.
- `sync.Once` to make stop idempotent.

This is what a senior engineer's production pool wrapper looks like. The library is at the core; the wrapper adds everything ops cares about.

You should be able to read this code, understand every line, and write a version of your own. Try it before moving on.

---

## Appendix ZZ: Truly The End

That is the senior file. You now know `workerpool` better than 99% of Go developers who use it. That is a meaningful accomplishment.

The professional file is next. It is shorter on theory and longer on stories — incidents, sizing decisions, post-mortems. After that come the practical files: specification (the formal API), interview questions, tasks, find-bug, optimize.

You have done a lot. Go build something with what you have learned. That is the real test.




