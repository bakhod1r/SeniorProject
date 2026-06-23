---
layout: default
title: Middle
parent: workerpool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/03-workerpool/middle/
---

# gammazero/workerpool — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [What Changes at Middle Level](#what-changes-at-middle-level)
3. [Prerequisites](#prerequisites)
4. [Glossary](#glossary)
5. [SubmitWait in Depth](#submitwait-in-depth)
6. [Stopped and the Shutdown Lifecycle](#stopped-and-the-shutdown-lifecycle)
7. [StopWait Internals From the Outside](#stopwait-internals-from-the-outside)
8. [The Idle-Worker Timeout](#the-idle-worker-timeout)
9. [Panic Recovery](#panic-recovery)
10. [Queueing Strategies](#queueing-strategies)
11. [Pause and Resume](#pause-and-resume)
12. [Context Integration](#context-integration)
13. [Coding Patterns](#coding-patterns)
14. [Real-World Scenarios](#real-world-scenarios)
15. [Pool Composition](#pool-composition)
16. [Backpressure Strategies](#backpressure-strategies)
17. [Drainage Patterns](#drainage-patterns)
18. [Observability Hooks](#observability-hooks)
19. [Testing Pools](#testing-pools)
20. [Pros and Cons Re-Examined](#pros-and-cons-re-examined)
21. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
22. [Common Mistakes](#common-mistakes)
23. [Common Misconceptions](#common-misconceptions)
24. [Tricky Points](#tricky-points)
25. [Test](#test)
26. [Tricky Questions](#tricky-questions)
27. [Cheat Sheet](#cheat-sheet)
28. [Self-Assessment Checklist](#self-assessment-checklist)
29. [Summary](#summary)
30. [What You Can Build](#what-you-can-build)
31. [Further Reading](#further-reading)
32. [Related Topics](#related-topics)
33. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction

The junior file gave you `Submit` and `StopWait`. That is enough for most batch-processing scripts. The middle file is about the *operational corners* — the situations where the basic API is not enough and you need to understand the next layer of the library.

Concretely, this file covers:

- `SubmitWait` — when you need a single task to finish before continuing, and what blocking on it implies for the pool's internals.
- `Stopped` and the full shutdown lifecycle, including the moment between "Stop called" and "all workers exited".
- The 2-second idle-worker timeout and what to do when your workload's burst cadence does not match it.
- Panic recovery — what the library does on your behalf and what it does not.
- Queue depth, queue inspection, and bounded variants of the queue.
- Pause/Resume (where available) for temporarily halting work without tearing down the pool.
- Context integration: getting cancellation into tasks even though `func()` cannot accept one.
- Backpressure patterns: how to slow down a producer that outruns the pool.

By the end of this file you will be able to:

- Pick between `Submit` and `SubmitWait` for any given producer pattern.
- Reason about what `Stop` does in the middle of a busy pool.
- Use `pool.WaitingQueueSize()` for telemetry without misinterpreting it.
- Handle panics from tasks without crashing the program.
- Add a context-aware cancellation layer on top of `workerpool`.
- Decide when to use one pool, two pools, or a custom pool altogether.

You will not yet read library internals (that is the senior file) or production sizing and incident stories (that is the professional file). The middle level is about *competent use*: knowing all the buttons on the dashboard and what each does.

---

## What Changes at Middle Level

In one sentence: at middle level you stop treating the pool as a black box.

The junior file used the pool as if it were a fancy `go f()`. You wrote `Submit`, you wrote `StopWait`, you trusted the library to do the right thing. At middle level, you start asking:

- "What does `SubmitWait` actually do to the pool's internal state?"
- "Can a task that I `SubmitWait` from another task deadlock?"
- "If I stop the pool while a slow task is running, when does `Stop` return?"
- "Where does the queue live? How do I see its size?"
- "What happens if my task panics inside a `select`?"

These questions all have answers. None of them require reading source code (yet). They require *understanding the public contract more deeply*, which is what this file is for.

---

## Prerequisites

- All junior material. You should be comfortable typing the basic submit-and-stop skeleton from memory.
- Familiarity with `context.Context`, `context.WithCancel`, `context.WithTimeout`. Without this, the context-integration section will make no sense.
- Comfort with `select` blocks on multiple channels.
- A basic understanding of how `recover()` works, including why it must run from a deferred function.
- Exposure to `runtime.Stack` for goroutine debugging — useful when you want to see "what is my pool doing?" in a stuck program.

If `select { case <-ctx.Done(): return case x := <-ch: process(x) }` is not yet idiomatic to you, write a few small programs first.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`SubmitWait`** | A submission that blocks until the task has finished executing. Functions like a synchronous "send through the pool". |
| **Backpressure** | Slowing producers down when consumers cannot keep up. `SubmitWait` is one form; semaphores are another. |
| **Idle reaper** | The internal mechanism that exits a worker goroutine when it has had no task to run for ~2 seconds. |
| **Dispatch loop** | The single goroutine running inside the pool that forwards user submits to ready workers. We treat it as a black box at this level. |
| **Drain** | The act of running every queued task to completion before shutting the pool down. `StopWait` does this; `Stop` does not. |
| **Pause** | A newer API that temporarily prevents the dispatcher from sending tasks to workers, without losing queued tasks. |
| **Sentinel task** | A task whose only purpose is to mark a milestone — for example, signal a channel when it runs. Useful for "wait until the queue ahead of this task has drained". |

---

## SubmitWait in Depth

`SubmitWait` is the synchronous sibling of `Submit`. Its signature:

```go
func (p *WorkerPool) SubmitWait(task func())
```

Like `Submit`, it returns nothing. Unlike `Submit`, it does not return until `task` has finished. Internally, the library wraps your task in a small helper that closes a "done" channel after the task runs, then blocks on that channel.

Pseudocode for what `SubmitWait` does:

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

This pseudocode is close enough to the real implementation that you can reason about behaviour with it.

### When to use SubmitWait

Four legitimate use cases:

1. **Backpressure on the producer.** A loop of `SubmitWait` calls runs at exactly the workers' pace. Submissions cannot pile up; the queue never grows. Useful when memory is precious.
2. **Ordering barriers.** "Run this one task and make sure it is done before I proceed." For example, a "warm up the cache" task before launching parallel work.
3. **Finalisers.** The last task before shutdown, where you need to know it ran before doing something else.
4. **Mixing pool with sequential logic.** "Five parallel tasks, then one task that summarises, then another five parallel tasks." The summary in the middle is a `SubmitWait`.

### When NOT to use SubmitWait

- Inside a busy loop submitting many tasks. The serialisation defeats the purpose of the pool.
- From inside another task on the same pool, especially if `maxWorkers` is small. You can deadlock.

### The deadlock you must avoid

```go
pool := workerpool.New(1) // pool of size 1!
pool.Submit(func() {
    fmt.Println("outer task started")
    pool.SubmitWait(func() {
        fmt.Println("inner task")
    })
    // never reached
})
pool.StopWait() // hangs forever
```

The outer task holds the only worker slot. The inner task is queued and will never start, because there is no free worker. The outer task is blocked on `<-done`. Classic deadlock.

This generalises: **never `SubmitWait` from inside a task on a pool when worker availability is in doubt.** If `maxWorkers` is large and your usage patterns guarantee at least one free slot, you may get away with it. But the safe rule is: do not.

Real-world variant — recursion:

```go
func walk(node *Node, pool *workerpool.WorkerPool) {
    pool.SubmitWait(func() {
        for _, child := range node.Children {
            walk(child, pool) // recursive SubmitWait through the same pool
        }
    })
}
```

If the tree depth exceeds `maxWorkers`, you deadlock. For tree traversal, use a different design: a `sync.WaitGroup` plus `Submit`, where each task spawns its children without waiting:

```go
func walk(node *Node, pool *workerpool.WorkerPool, wg *sync.WaitGroup) {
    wg.Add(1)
    pool.Submit(func() {
        defer wg.Done()
        for _, child := range node.Children {
            walk(child, pool, wg)
        }
    })
}
```

The pool will spawn children even when all `maxWorkers` are occupied — they go on the queue. Recursion stays correct, and you `wg.Wait()` at the end.

### Submit-then-wait versus SubmitWait

These look similar but mean different things:

```go
// Option A
done := make(chan struct{})
pool.Submit(func() {
    work()
    close(done)
})
<-done

// Option B
pool.SubmitWait(func() { work() })
```

Both block the caller until `work` is done. Option B is a touch more compact and avoids a hand-rolled channel. Behaviourally identical. Use B unless you want to give up on the wait via a select on `<-ctx.Done()` (in which case A wins, because B does not take a context).

### Returning a value from SubmitWait

`SubmitWait` returns nothing. To get a value out, use a captured variable or a channel:

```go
var result int
pool.SubmitWait(func() {
    result = compute()
})
fmt.Println(result)
```

This is *safe* because the wait guarantees the write happened before the read. But your linter will still scold you about a captured-by-reference variable; consider `*int`:

```go
result := new(int)
pool.SubmitWait(func() {
    *result = compute()
})
fmt.Println(*result)
```

Or a channel of size 1:

```go
ch := make(chan int, 1)
pool.SubmitWait(func() {
    ch <- compute()
})
fmt.Println(<-ch)
```

These are all equivalent. Pick whichever your team finds clearest.

---

## Stopped and the Shutdown Lifecycle

`Stopped()` is a one-line method:

```go
func (p *WorkerPool) Stopped() bool
```

It returns `true` once `Stop` or `StopWait` has been called. The flag becomes `true` at the *moment of the call*, before any workers have actually exited. So `Stopped() == true` does **not** mean "all tasks have run" or "all goroutines have exited". It means "shutdown has been initiated".

Why is this distinction important? Because a common loop checks `Stopped` before submitting:

```go
for !pool.Stopped() {
    pool.Submit(produceOne())
}
```

This is correct in the sense that no submission is wasted *after* `Stop`. But there is still a race: between the `Stopped()` check and the `Submit()` call, another goroutine could call `Stop`. In that case, the `Submit` is silently dropped. That is usually fine — the task will be lost, but no error or panic. If silent dropping is unacceptable, you need a heavier-weight pattern with explicit acknowledgements; see the senior file.

### Full shutdown timeline

A picture of what happens when you call `StopWait`:

1. Time T=0: `pool.StopWait()` is called. The internal `stopped` flag is set to `true`. From this moment, `Stopped()` returns `true` and `Submit` is a no-op.
2. T=0+: The dispatcher closes the input channel and starts draining its internal queue, forwarding remaining tasks to workers as they become free.
3. T=k: Some worker finishes the last task. Workers exit because the input channel is closed.
4. T=k+: The dispatcher itself exits.
5. T=k+: `StopWait` returns.

For `Stop` (not `StopWait`):

1. T=0: `pool.Stop()` is called. The internal `stopped` flag is set.
2. T=0+: The dispatcher *discards* any unstarted queued tasks. Workers currently running their task continue.
3. T=k: All currently-running tasks finish. Workers exit.
4. T=k+: The dispatcher exits.
5. T=k+: `Stop` returns.

The crucial point: both methods wait for *running* tasks to finish. There is no "kill running tasks" option in `workerpool`. If a task is stuck (deadlocked, blocked on I/O), `Stop` and `StopWait` hang waiting for it. You must build cancellation into the task itself with a context.

### Inspecting state during shutdown

```go
pool := workerpool.New(4)
// ... lots of submits ...

go func() {
    // run from another goroutine to watch shutdown progress
    for {
        time.Sleep(100 * time.Millisecond)
        fmt.Println("queue size:", pool.WaitingQueueSize(), "stopped:", pool.Stopped())
        if pool.Stopped() && pool.WaitingQueueSize() == 0 {
            // not a real "all done" signal, but close
            return
        }
    }
}()

pool.StopWait()
```

This is a debug-only pattern. For real telemetry, expose a `metrics.Gauge` on `WaitingQueueSize()` and your monitoring system will draw the curve for you.

### Idempotent shutdown

Both `Stop` and `StopWait` are idempotent — calling them twice is fine. So the pattern:

```go
defer pool.StopWait()
// ... 
pool.StopWait() // explicit
```

is safe; the deferred call is a no-op.

The other direction:

```go
pool.Stop()
pool.StopWait() // also a no-op (or close to it)
```

Calling `StopWait` after `Stop` does not somehow drain the queue (the queue was already cleared). It just waits for the running tasks if there are any.

---

## StopWait Internals From the Outside

Without yet reading the source, here is what you can deduce about `StopWait` from observed behaviour.

1. **It does not block on a fixed timeout.** It waits as long as needed.
2. **It waits for tasks to finish, not for goroutines to be reaped.** Workers may exit a moment after `StopWait` returns; the goroutine count drops to 1 (then 0 after the dispatcher).
3. **It is goroutine-safe.** Multiple goroutines can call `StopWait` concurrently; only one shutdown happens; all callers return at the same time.
4. **It does not call `runtime.Gosched()` or yield the CPU.** It is just a `<-doneChan` style wait.

What you cannot deduce without reading the source — and what we will spell out in the senior file:

- How the dispatcher signals shutdown to workers.
- How worker exit propagates back to `StopWait`.
- Whether the channel signalling shutdown is buffered.

For middle-level usage, the takeaway is: `StopWait` always returns eventually, unless a task is stuck. If your `StopWait` hangs forever, the culprit is a task that does not return — almost always a missing context cancellation or a deadlock on a channel.

---

## The Idle-Worker Timeout

Internally, `workerpool` runs a 2-second timer per worker. If a worker sits idle for 2 seconds with no new task, it exits. The next time a task arrives, the dispatcher spins up a fresh worker for it. This keeps the resident goroutine count low during quiet periods.

The 2-second value is hard-coded; you cannot change it via the public API.

### Why this matters

For a bursty workload — say, traffic arrives once every 30 seconds in small bursts — the pool effectively has zero workers most of the time. Every burst pays the cost of spawning fresh workers. That cost is small (a goroutine and a goroutine-stack ~2KB allocation) but measurable. For typical web workloads, you will not notice; for nanosecond-sensitive code, it could add up.

For a steady workload — tasks arriving every millisecond — workers never go idle long enough to be reaped. The pool stabilises with however many workers it needs (up to `maxWorkers`) and keeps them all busy.

For a workload that has gaps just above 2 seconds — say, 2.5 seconds between bursts — you get the worst of both worlds: workers exit just before the next burst, and you spend each burst spinning up new ones. If profiling shows this is a hot path, options:

1. Submit a no-op heartbeat task every 1.9 seconds. Crude but effective.
2. Switch to a different library that exposes the idle timeout (`ants.WithExpiryDuration`).
3. Roll your own pool with no idle reaping.

### Observing it

You can convince yourself the reaping is real:

```go
package main

import (
    "fmt"
    "runtime"
    "time"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(10)
    defer pool.StopWait()

    fmt.Println("immediately after New:", runtime.NumGoroutine())

    for i := 0; i < 10; i++ {
        pool.Submit(func() { time.Sleep(50 * time.Millisecond) })
    }
    time.Sleep(100 * time.Millisecond)
    fmt.Println("during work:", runtime.NumGoroutine())

    time.Sleep(3 * time.Second) // longer than idle timeout
    fmt.Println("after idle reap:", runtime.NumGoroutine())
}
```

Typical output:

```
immediately after New: 2
during work: 12
after idle reap: 2
```

`NumGoroutine` reports the main goroutine and the dispatcher (= 2) at idle, plus up to 10 workers while busy.

### A diagnostic: 2 seconds is just enough to confuse you

A user reports: "I see periodic CPU spikes every 2 seconds even when I am not doing anything!"

Possible explanation: somewhere, code submits a task every ~2.5 seconds. Every submit spawns a worker (because the previous one was just reaped). The fresh worker runs a fast task, then idles for 2 seconds, then exits. The cycle repeats.

The fix is either to consolidate the submission cadence to <2 seconds (no reaping happens) or to skip the pool for this workload entirely (just `go f()` for a one-off).

---

## Panic Recovery

Modern versions of `workerpool` install a `defer recover()` around each task. If your task panics, the worker survives and the pool keeps running. The panic value, however, is **not** propagated to you. It is logged via `log.Print` (or printed to stderr — check the exact version) and discarded.

This is sometimes good (a buggy task does not kill the program) and sometimes bad (the bug is silent).

### Catching panics yourself

```go
pool.Submit(func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("task %s panic: %v\n%s", taskName, r, debug.Stack())
            // ... your custom handling, e.g. Sentry, metrics, etc.
        }
    }()
    risky()
})
```

If you wrap every task this way, you get the panic value, the stack trace, and a place to send it to your monitoring stack. The library's outer recover then sees nothing to handle (because you already handled it).

A helper makes this less tedious:

```go
func instrumented(f func()) func() {
    return func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("panic: %v\n%s", r, debug.Stack())
            }
        }()
        f()
    }
}

pool.Submit(instrumented(func() { risky() }))
```

### Panics that the library's recover cannot catch

`recover()` only catches panics in the same goroutine. If your task spawns a child goroutine that panics, the library's defer does *not* catch it; the program crashes. Example:

```go
pool.Submit(func() {
    go func() {
        panic("child")  // crashes the whole program
    }()
})
```

Wrap children explicitly:

```go
pool.Submit(func() {
    go func() {
        defer func() { recover() }()
        risky()
    }()
})
```

This is a general Go gotcha, not specific to `workerpool`, but worth mentioning since pools sometimes hide the parent/child structure of goroutines.

### A panicking task that holds a mutex

If your panicking task holds a mutex when it panics, and `recover` swallows the panic, the mutex *stays locked*. Always release locks with `defer mu.Unlock()`:

```go
pool.Submit(func() {
    mu.Lock()
    defer mu.Unlock()
    risky() // even if it panics, mu is released
})
```

Without `defer`, a panic leaks the lock and the next caller of `mu.Lock()` blocks forever.

---

## Queueing Strategies

The internal queue inside `workerpool` is a linked list of slices (deque-like). You do not interact with it directly; you only see `WaitingQueueSize()`. But your *queueing strategy* — how producers push into the pool — is entirely your choice.

### Strategy 1: Naive `Submit` loop

```go
for _, item := range items {
    item := item
    pool.Submit(func() { process(item) })
}
```

Pros: simplest possible code. Producer never blocks.
Cons: if the producer is fast and workers are slow, the queue grows without bound. OOM risk.

When to use: bounded input, trusted producer.

### Strategy 2: `SubmitWait` loop

```go
for _, item := range items {
    item := item
    pool.SubmitWait(func() { process(item) })
}
```

Pros: serialised submission, no queue growth.
Cons: producer is now serialised. Throughput is limited by `min(workers, producer rate)`.

When to use: very large input, memory-bounded environment.

### Strategy 3: Semaphore-bounded submit

```go
sem := make(chan struct{}, 1000)
for _, item := range items {
    sem <- struct{}{}
    item := item
    pool.Submit(func() {
        defer func() { <-sem }()
        process(item)
    })
}
```

Pros: producer is concurrent with workers, but blocks if queue depth exceeds 1000.
Cons: extra goroutine state to manage. The `1000` is now a magic number.

When to use: untrusted producer or production code where you want a hard cap on queued work.

### Strategy 4: Conditional submit

```go
for _, item := range items {
    item := item
    if pool.WaitingQueueSize() > 1000 {
        // drop this item, or block, or log, or whatever your policy is
        droppedCount++
        continue
    }
    pool.Submit(func() { process(item) })
}
```

Pros: lets you implement custom backpressure policy.
Cons: `WaitingQueueSize` is a snapshot, so this is racy — the actual queue size at the moment of `Submit` may differ. Good for "approximate" throttling.

When to use: when dropping is acceptable.

### Strategy 5: Channel of items, single dispatcher goroutine

```go
ch := make(chan Item, 100)
go func() {
    for it := range ch {
        it := it
        pool.Submit(func() { process(it) })
    }
}()

for _, item := range items {
    ch <- item // blocks when channel is full
}
close(ch)
```

Pros: producer-side backpressure via the bounded channel.
Cons: extra moving part.

When to use: when the producer side is in a different goroutine entirely and you want a clean handoff point.

The right strategy depends on your tolerance for queue growth and your producer's behaviour. The library does not pick for you; that is the price of its minimal API.

---

## Pause and Resume

Some versions of `workerpool` expose a `Pause(ctx context.Context)` method. Its purpose: temporarily prevent the dispatcher from sending queued tasks to workers, without losing them. Resume happens when the context is cancelled.

```go
ctx, cancel := context.WithCancel(context.Background())
pool.Pause(ctx)
// queued tasks sit. New submissions queue too. Running tasks finish normally.

// ... some seconds later ...
cancel() // pool resumes
```

Use cases:

- A circuit breaker — pause the pool when a downstream service is failing.
- A scheduled maintenance window — quiet the pool during a deploy.
- Coordinated shutdown across multiple pools — pause all, then `StopWait` each.

Check the version of `workerpool` you depend on; the method may not exist in older releases. The specification file has the version history.

A simple pattern:

```go
func breaker(pool *workerpool.WorkerPool, downstreamHealthy func() bool) {
    var pauseCancel context.CancelFunc
    for {
        if !downstreamHealthy() && pauseCancel == nil {
            ctx, cancel := context.WithCancel(context.Background())
            pool.Pause(ctx)
            pauseCancel = cancel
            log.Println("pool paused, downstream is unhealthy")
        }
        if downstreamHealthy() && pauseCancel != nil {
            pauseCancel()
            pauseCancel = nil
            log.Println("pool resumed")
        }
        time.Sleep(5 * time.Second)
    }
}
```

A note on subtlety: `Pause` does not pause running tasks. Tasks already executing continue. Pause only prevents *new* tasks from leaving the queue and reaching workers. If a "task" is a long-running I/O call to a failing service, pausing the pool will not help you avoid that call — the task that already started will keep failing. You need either circuit-breaker logic inside the task itself, or a shorter task lifetime.

---

## Context Integration

`workerpool` predates the widespread use of `context.Context` in Go libraries, and its task type is `func()` with no arguments. This means there is no direct way to pass a context into a task. You have to do it yourself with a closure.

### Pattern: pass context via closure

```go
func process(ctx context.Context, item Item) {
    select {
    case <-ctx.Done():
        return
    default:
    }
    // ... do work, respecting ctx ...
}

ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()

for _, item := range items {
    item := item
    pool.Submit(func() {
        process(ctx, item)
    })
}
pool.StopWait()
```

The context is captured by reference, shared across all tasks. Cancelling it makes every task check `ctx.Done()` and bail early. The pool itself does not know about the context; it just keeps running tasks. The tasks are responsible for honouring cancellation.

### Pattern: context per task

```go
for _, item := range items {
    item := item
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    pool.Submit(func() {
        defer cancel()
        process(ctx, item)
    })
}
```

Each task has its own 5-second deadline. If a task is queued for 4 seconds and then runs for 4 seconds, the 5-second context will fire mid-execution. That is usually what you want.

A subtle issue: the context starts ticking the moment you create it, even before the task runs. If queue dwell time is significant, the context could be cancelled before the task starts. The task then runs and immediately returns. To avoid this, create the context *inside* the task:

```go
for _, item := range items {
    item := item
    pool.Submit(func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        process(ctx, item)
    })
}
```

Now the 5-second timer starts when the task starts running.

### Pattern: parent context cancels everything

```go
parentCtx, parentCancel := context.WithCancel(context.Background())
defer parentCancel()

for _, item := range items {
    item := item
    pool.Submit(func() {
        ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
        defer cancel()
        process(ctx, item)
    })
}

// elsewhere: parentCancel() will short-circuit every task
```

`context.WithTimeout(parentCtx, ...)` creates a child that respects both timeouts: the parent's cancellation and the 5-second limit. Cancelling the parent kills every child instantly.

### What happens to queued tasks when the context is cancelled?

They still run. The pool does not consult the context. They just run *fast*, because the first thing they do is check `ctx.Done()` and return.

That is a notable cost: if you queue 100,000 tasks and then cancel the context, the pool still has to process 100,000 returns from `ctx.Done()`. That is fast but not free. Better:

```go
pool.Stop() // discard all queued tasks
```

If your goal is "stop everything now", `Stop` is sometimes faster than relying on context to short-circuit each queued task.

### Hybrid: cancel via context plus Stop

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
defer pool.Stop() // discards what's left after context cancels

for _, item := range items {
    item := item
    pool.Submit(func() { process(ctx, item) })
}
```

The deferred order is `Stop` first (since it was deferred last), then `cancel`. Wait — that is backwards. Defers run LIFO, so `cancel` runs first, then `Stop`. The cancel signals tasks; the stop drains the rest (which return fast).

Honestly, mixing these patterns is enough complexity that you should write a comment explaining what you intended.

---

## Coding Patterns

### Pattern: WaitGroup + Pool

Already mentioned in junior; worth restating because it is the most common middle-level idiom.

```go
var wg sync.WaitGroup
for _, item := range items {
    item := item
    wg.Add(1)
    pool.Submit(func() {
        defer wg.Done()
        process(item)
    })
}
wg.Wait()
// pool still alive, can submit more
```

Use this when you need a "batch boundary" without killing the pool.

### Pattern: Channel-based result collection with bounded pool

```go
results := make(chan Result, 0)
go func() {
    var wg sync.WaitGroup
    for _, item := range items {
        item := item
        wg.Add(1)
        pool.Submit(func() {
            defer wg.Done()
            results <- compute(item)
        })
    }
    wg.Wait()
    close(results)
}()

for r := range results {
    // consume
}
```

Producers feed the pool, the pool feeds the channel, the consumer drains. `close(results)` happens only when `wg.Wait` returns, so no extra-send-after-close race.

### Pattern: Map-reduce

```go
type partial struct {
    sum, count int
}

partials := make(chan partial, 0)
var wg sync.WaitGroup

for _, chunk := range chunks {
    chunk := chunk
    wg.Add(1)
    pool.Submit(func() {
        defer wg.Done()
        s, c := 0, 0
        for _, v := range chunk {
            s += v
            c++
        }
        partials <- partial{sum: s, count: c}
    })
}

go func() {
    wg.Wait()
    close(partials)
}()

totalSum, totalCount := 0, 0
for p := range partials {
    totalSum += p.sum
    totalCount += p.count
}
```

Map and reduce phases use the same pool. The intermediate channel collects partial sums. Note the goroutine that closes the channel — without it, the reduce loop would never terminate.

### Pattern: Pipeline with multiple pools

```go
parse := workerpool.New(2)
enrich := workerpool.New(8)
write := workerpool.New(4)

go func() {
    defer parse.StopWait()
    for _, raw := range inputs {
        raw := raw
        parse.Submit(func() {
            p := parseOne(raw)
            enrich.Submit(func() {
                e := enrichOne(p)
                write.Submit(func() { writeOne(e) })
            })
        })
    }
}()

// wait somehow ... a wg counting writes is one option
```

Each stage has its own bound. A slow stage will accumulate work in front of it (the next pool's queue). Watch queue sizes; whichever queue is growing is your bottleneck.

### Pattern: Two-phase shutdown

```go
// phase 1: stop accepting new work
close(producerStopCh)
producerWg.Wait()

// phase 2: drain the pool
pool.StopWait()
```

This separates "stop the producers" from "drain the pool". In a complex service, this is the only sane way to ensure no work is dropped.

### Pattern: Per-task instrumentation wrapper

```go
type Pool struct {
    inner *workerpool.WorkerPool
    sub   prometheus.Counter
    done  prometheus.Counter
    dur   prometheus.Histogram
}

func (p *Pool) Submit(name string, f func()) {
    p.sub.Inc()
    start := time.Now()
    p.inner.Submit(func() {
        defer p.done.Inc()
        defer func() { p.dur.Observe(time.Since(start).Seconds()) }()
        f()
    })
}
```

This is the start of a proper instrumentation layer; we will expand it in the professional file.

---

## Real-World Scenarios

A walkthrough of three plausible middle-level uses.

### Scenario 1: Concurrent database upsert

You have 10,000 rows to write to a database. The database can comfortably handle 20 concurrent writes. Each write takes ~5ms.

```go
type Row struct {
    ID   int
    Data string
}

func UpsertAll(ctx context.Context, db *sql.DB, rows []Row) error {
    pool := workerpool.New(20)
    defer pool.StopWait()

    var firstErr error
    var mu sync.Mutex

    for _, r := range rows {
        if ctx.Err() != nil {
            break
        }
        r := r
        pool.Submit(func() {
            if ctx.Err() != nil {
                return
            }
            if err := upsert(ctx, db, r); err != nil {
                mu.Lock()
                if firstErr == nil {
                    firstErr = err
                }
                mu.Unlock()
            }
        })
    }
    pool.StopWait()
    return firstErr
}

func upsert(ctx context.Context, db *sql.DB, r Row) error {
    _, err := db.ExecContext(ctx, `INSERT INTO t (id, data) VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, r.ID, r.Data)
    return err
}
```

Things to notice:

- The pool's concurrency cap matches the DB's capacity.
- Each task respects the context; if the caller cancels, tasks bail.
- We capture the *first* error and keep going, rather than aborting on every error. Adjust to taste.
- The wall-clock time is `10000 * 5ms / 20 = 2.5 seconds` — vs. ~50 seconds serial.

### Scenario 2: Concurrent log-line enrichment

A log shipper reads lines from a file, enriches each line with a service lookup, then writes to another file.

```go
type LineWithMeta struct {
    Line string
    Meta map[string]string
}

func EnrichLog(ctx context.Context, in io.Reader, out io.Writer) error {
    pool := workerpool.New(50) // I/O bound, more workers ok
    defer pool.StopWait()

    results := make(chan LineWithMeta, 1000)
    var producerWg sync.WaitGroup

    scanner := bufio.NewScanner(in)
    for scanner.Scan() {
        if ctx.Err() != nil {
            break
        }
        line := scanner.Text()
        producerWg.Add(1)
        pool.Submit(func() {
            defer producerWg.Done()
            meta, _ := lookup(ctx, line)
            results <- LineWithMeta{Line: line, Meta: meta}
        })
    }

    go func() {
        producerWg.Wait()
        close(results)
    }()

    writer := bufio.NewWriter(out)
    defer writer.Flush()
    for r := range results {
        if _, err := fmt.Fprintf(writer, "%s\t%v\n", r.Line, r.Meta); err != nil {
            return err
        }
    }
    return scanner.Err()
}
```

Why 50 workers? Because the bottleneck is the `lookup` service call, which is network-bound, and that service can handle 50 concurrent requests. Pool size mirrors downstream capacity.

The pattern is the classic "producer → pool → channel → consumer". The pool decouples reading from writing.

### Scenario 3: Periodic batch job

A cron-style task that runs every 5 minutes, processes whatever pending work is in a queue, and exits. A small pool here avoids holding goroutines forever.

```go
func RunBatch() {
    pool := workerpool.New(8)
    defer pool.StopWait()

    rows, err := loadPending()
    if err != nil {
        log.Fatal(err)
    }

    log.Printf("processing %d rows", len(rows))
    for _, r := range rows {
        r := r
        pool.Submit(func() {
            if err := process(r); err != nil {
                log.Printf("row %d: %v", r.ID, err)
            }
        })
    }
}

func main() {
    ticker := time.NewTicker(5 * time.Minute)
    for range ticker.C {
        RunBatch()
    }
}
```

A new pool per batch is fine here because a batch run is a discrete unit. The pool exists during the run and is gone afterward. Goroutines do not leak. The next batch starts fresh.

---

## Pool Composition

Sometimes one pool is not enough. Composition strategies:

### Two pools, one process

```go
var cpuPool = workerpool.New(runtime.NumCPU())
var ioPool = workerpool.New(64)
```

Use `cpuPool` for tight number-crunching tasks, `ioPool` for network/disk. Why? Because mixing them in one pool means the I/O wait time of one task can starve the CPU work of another. Two pools, two queues, no cross-contention.

### Pool inside a worker

```go
mainPool := workerpool.New(4)
subPool := workerpool.New(8)

mainPool.Submit(func() {
    // do some prep
    for _, x := range subTasks {
        x := x
        subPool.Submit(func() { work(x) })
    }
})
```

The outer task submits to an inner pool. Watch for deadlocks — if you `subPool.SubmitWait` from inside `mainPool`, and the inner pool's capacity is small, you can starve.

### Pipeline of pools

Covered in Scenario 2 above. Each stage gets its own pool.

### Per-tenant pools (caution)

A common request: "I want a pool per tenant, so a noisy tenant cannot starve a quiet one." This works for a handful of tenants. For 10,000 tenants, you have 10,000 dispatchers, each holding a goroutine and some state. That is not great. Better:

- A single shared pool with priority queueing (the library does not support this; you would build it).
- A token bucket per tenant in front of one shared pool.
- A sharded design where N tenants map to one of K pools (`tenantID % K`).

`workerpool`'s minimal design is not the right tool for per-tenant isolation at scale. Recognise the limit.

---

## Backpressure Strategies

### Push-back from the pool: not built in

`workerpool.Submit` never blocks, never errors. So you must add backpressure yourself.

### Token bucket / leaky bucket

```go
limiter := rate.NewLimiter(rate.Every(time.Millisecond), 100) // 1000/s

for _, item := range items {
    if err := limiter.Wait(ctx); err != nil {
        return err
    }
    item := item
    pool.Submit(func() { process(item) })
}
```

This caps the *submission rate*, regardless of worker speed. Useful for rate-limited downstreams.

### Counting semaphore

Already shown above; the simplest and most common pattern.

### Drop-on-overload

```go
const overloadThreshold = 5000

for _, item := range items {
    if pool.WaitingQueueSize() > overloadThreshold {
        // drop and log
        metrics.Drops.Inc()
        continue
    }
    item := item
    pool.Submit(func() { process(item) })
}
```

Be careful: dropping may be unacceptable for your use case. Make sure the rest of the system tolerates lost work.

### Block-on-overload

```go
for pool.WaitingQueueSize() > overloadThreshold {
    time.Sleep(10 * time.Millisecond)
}
pool.Submit(func() { process(item) })
```

Crude but works. A semaphore is cleaner because it has no polling.

### Hybrid: warning, then drop

```go
qs := pool.WaitingQueueSize()
if qs > overloadThreshold {
    metrics.Drops.Inc()
    continue
}
if qs > warningThreshold {
    log.Printf("queue depth high: %d", qs)
}
pool.Submit(func() { process(item) })
```

Real production code looks like this. Logs flag impending overload; drops kick in at the breaking point.

---

## Drainage Patterns

"Drainage" = orderly shutdown without losing in-flight work.

### Pattern: defer StopWait

```go
pool := workerpool.New(8)
defer pool.StopWait()
// ... work ...
```

Already covered. The simplest drainage; safe for short-lived programs.

### Pattern: signal-driven drain

```go
sigs := make(chan os.Signal, 1)
signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT)
<-sigs
log.Println("draining pool...")
pool.StopWait()
log.Println("done")
os.Exit(0)
```

For long-running services. SIGTERM arrives, drain, exit. Kubernetes gives you `terminationGracePeriodSeconds` to do this; default is 30 seconds. If your drain might exceed that, configure a longer grace period or use a deadline:

### Pattern: deadline drain

```go
done := make(chan struct{})
go func() {
    pool.StopWait()
    close(done)
}()

select {
case <-done:
    log.Println("drained cleanly")
case <-time.After(25 * time.Second):
    log.Println("drain deadline exceeded, hard stop")
    pool.Stop()
    <-done
}
```

`StopWait` runs in a goroutine. We wait up to 25 seconds. If it does not finish, we call `Stop` to discard the remaining queue, and wait for `StopWait` to return (it will return quickly since the queue is now empty). This pattern bounds shutdown time at the cost of losing some work.

### Pattern: pause-then-drain

```go
ctx, cancel := context.WithCancel(context.Background())
pool.Pause(ctx) // pause new dispatches

// ... wait for in-flight tasks to drain naturally ...

cancel() // resume (so StopWait can finish remaining queued)
pool.StopWait()
```

For coordinated shutdowns across multiple pools. Pause all, wait for in-flight, then drain.

---

## Observability Hooks

The library exposes only `WaitingQueueSize()` and `Stopped()` for observability. The rest you bolt on.

### Metric 1: queue depth

```go
var (
    queueDepth = prometheus.NewGauge(prometheus.GaugeOpts{Name: "wp_queue_depth"})
)

go func() {
    ticker := time.NewTicker(5 * time.Second)
    for range ticker.C {
        queueDepth.Set(float64(pool.WaitingQueueSize()))
    }
}()
```

Track over time. Growing depth = capacity problem.

### Metric 2: submit rate, complete rate

```go
var (
    submits = prometheus.NewCounter(prometheus.CounterOpts{Name: "wp_submits_total"})
    done    = prometheus.NewCounter(prometheus.CounterOpts{Name: "wp_completions_total"})
)

wrap := func(f func()) func() {
    return func() {
        defer done.Inc()
        f()
    }
}

submits.Inc()
pool.Submit(wrap(func() { process(...) }))
```

The difference `submits - done` is "tasks in the pool right now" (queued + running).

### Metric 3: task duration histogram

```go
var taskDuration = prometheus.NewHistogram(prometheus.HistogramOpts{
    Name: "wp_task_duration_seconds",
})

pool.Submit(func() {
    start := time.Now()
    defer func() { taskDuration.Observe(time.Since(start).Seconds()) }()
    process(...)
})
```

P95 and P99 task duration tell you whether the bottleneck is "everything is slow" or "some tasks are pathological".

### Logging slow tasks

```go
pool.Submit(func() {
    start := time.Now()
    process(...)
    if d := time.Since(start); d > 500*time.Millisecond {
        log.Printf("slow task: %s", d)
    }
})
```

Cheap, effective. Pairs nicely with the duration histogram.

### Stack-dump on stuck pool

```go
sigs := make(chan os.Signal, 1)
signal.Notify(sigs, syscall.SIGUSR1)
go func() {
    for range sigs {
        buf := make([]byte, 1<<20)
        n := runtime.Stack(buf, true)
        log.Printf("goroutine dump:\n%s", buf[:n])
    }
}()
```

When `StopWait` hangs in production, sending SIGUSR1 dumps every goroutine's stack to logs. You can then see exactly which workers are stuck and where.

---

## Testing Pools

Pools are concurrency primitives; tests for them should focus on:

1. **All submitted tasks run.** Counter equals submission count after `StopWait`.
2. **No tasks run after `Stop`.** `Stop` before any execution, then assert counter is zero.
3. **The pool respects `maxWorkers`.** Track peak concurrent tasks.
4. **`SubmitWait` blocks.** A task that increments a counter, then `SubmitWait`, then check the counter.
5. **`StopWait` is idempotent.** Call it twice; should be a no-op.
6. **The race detector finds no races.** Always run `go test -race`.

A peak-concurrency test:

```go
func TestPeakConcurrency(t *testing.T) {
    const maxW = 4
    pool := workerpool.New(maxW)
    defer pool.StopWait()

    var inflight int64
    var peak int64

    for i := 0; i < 100; i++ {
        pool.Submit(func() {
            n := atomic.AddInt64(&inflight, 1)
            for {
                p := atomic.LoadInt64(&peak)
                if n <= p || atomic.CompareAndSwapInt64(&peak, p, n) {
                    break
                }
            }
            time.Sleep(10 * time.Millisecond)
            atomic.AddInt64(&inflight, -1)
        })
    }
    pool.StopWait()
    if peak > int64(maxW) {
        t.Fatalf("peak concurrent tasks = %d, want <= %d", peak, maxW)
    }
}
```

This test verifies the library's contract experimentally. It is also a nice baseline for any custom pool you build.

---

## Pros and Cons Re-Examined

The junior file gave a pros/cons list. At middle level the trade-offs sharpen.

### Pros (deeper)

- **Submission contention is minimal.** The dispatcher's input channel is unbuffered but the dispatcher is a single goroutine, so contention is between submitters and one reader. For most workloads this is fine.
- **Idle reaping is automatic.** You do not have to think about it. Most users do not even know it exists.
- **`SubmitWait` is a one-liner.** Synchronous calls are easy without any extra plumbing.
- **The API is stable.** Code written against v1.0 still compiles five years later.

### Cons (deeper)

- **No per-task timeout.** Built-in. You must wrap.
- **No per-task error.** Built-in. You must collect.
- **No context propagation.** Tasks are `func()`. You must capture.
- **No prioritisation.** Tasks run FIFO, period.
- **No "drain to a deadline".** You must build it.
- **No introspection beyond queue size.** No "how many workers active right now?".
- **Hard-coded idle timeout.** Bursty workloads with 2.5s gaps pay extra.
- **Per-task closure allocation.** Sub-microsecond overhead but not free.

At middle level you start *feeling* these cons in real services. The professional file is where you decide when they justify reaching for `ants` instead.

---

## Edge Cases and Pitfalls

### `SubmitWait` from inside `SubmitWait`

```go
pool := workerpool.New(2)
pool.SubmitWait(func() {
    pool.SubmitWait(func() {
        // ...
    })
})
```

With `maxWorkers = 2`, the outer occupies one slot. The inner takes another. Both finish. Works. With `maxWorkers = 1`, the outer occupies the only slot, the inner cannot start, the outer blocks on the inner's `done` channel. Deadlock.

### Task that hangs

```go
pool.Submit(func() {
    select{} // infinite block
})
pool.StopWait() // never returns
```

`StopWait` cannot kill a running task. If you want bounded shutdown time, give every task a context with a deadline.

### Forgetting `defer cancel()` on contexts

```go
for _, item := range items {
    item := item
    ctx, _ := context.WithTimeout(context.Background(), 5*time.Second) // missing cancel
    pool.Submit(func() {
        process(ctx, item)
    })
}
```

This leaks `context.cancelCtx` objects. Lint catches it (`govet contextcheck`). Always `defer cancel()` — but be careful where: outside the closure, the cancel fires immediately, cancelling the context before the task runs.

Correct:

```go
pool.Submit(func() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    process(ctx, item)
})
```

### `StopWait` while `Submit` is racing

If one goroutine is `Submit`-ing and another calls `StopWait`, the racing `Submit` is *probably* silently dropped if it arrives after `StopWait` started. But behaviour around the exact instant of the call is subtle. To be safe, ensure submitters are stopped before draining.

### Unbounded queue on a server endpoint

A pool that accepts requests via an HTTP handler with no rate limit is a DoS vector. We covered this in junior; the advice is the same here, more emphatic. Always bound the queue if input is untrusted.

### Idle workers and `runtime.NumGoroutine` reporting

A debugger that checks `runtime.NumGoroutine()` to assert "I should have 8 workers" will be confused. The pool has 0 to 8 workers depending on load. Use `pool.WaitingQueueSize()` and your own metrics for assertions.

### `Pause` does not affect running tasks

A paused pool still has its workers running whatever they were running. Pause only stops new dispatches. Do not assume "pool paused" = "system quiet".

### Closing a result channel from inside a task

```go
results := make(chan int)
for i := 0; i < 10; i++ {
    i := i
    pool.Submit(func() {
        results <- i
        if i == 9 {
            close(results)
        }
    })
}
```

Wrong. Workers may finish in any order. The task with `i == 9` may close while others still try to send. Close *after* `StopWait`:

```go
pool.StopWait()
close(results)
```

But then you cannot range over `results` in the same goroutine that calls `StopWait`. Use:

```go
go func() {
    pool.StopWait()
    close(results)
}()
for r := range results {
    // ...
}
```

Or use a `WaitGroup`.

---

## Common Mistakes

### 1. Forgetting that `SubmitWait` can deadlock

The classic small-pool self-deadlock. Audit any `SubmitWait` inside a task.

### 2. Misusing `Stopped` as "all done"

`Stopped() == true` means shutdown started, not finished. Use `StopWait` to know all tasks have run.

### 3. Per-task contexts shared across goroutines

```go
ctx, cancel := context.WithTimeout(...)
defer cancel()
for ... {
    pool.Submit(func() { use(ctx) })
}
```

This is *correct* — one shared context for the whole batch — but a mistake is to expect *per-task* timeouts. Each task shares the same deadline. If you want a fresh deadline per task, create the context inside the closure.

### 4. Submitting without checking `Stopped`

In long-running producers, missing the `if pool.Stopped() return` means the loop spins after shutdown, accomplishing nothing.

### 5. Trusting that panic recovery is enough

The library recovers panics in the worker goroutine. It does not recover panics in goroutines you spawn from inside a task. Audit your tasks; wrap child goroutines.

### 6. Believing `WaitingQueueSize` is precise

It is a snapshot. By the time you read it, it may have changed. For metrics: fine. For synchronisation: do not.

### 7. Mixing `Submit` and `SubmitWait` haphazardly

A loop that calls one or the other based on a condition can be hard to reason about. Pick one style per loop.

### 8. Calling `StopWait` from inside a task

```go
pool.Submit(func() {
    pool.StopWait() // wait for self to finish?
})
```

Deadlock. `StopWait` waits for all tasks, including this one. The task waits for `StopWait`. Forever.

### 9. Using `Pause` to handle errors

Pausing the pool is not error handling. It is suppression. If a downstream is failing, you eventually need to either retry, drop, or surface the error — not just sit on a paused queue forever.

### 10. Forgetting `runtime.GOMAXPROCS`

If you have set `GOMAXPROCS=1` (some test runners do, some embedded targets force it), a CPU-bound pool with `maxWorkers > 1` gains you nothing. The OS scheduler will serialise the goroutines anyway. Always know your `GOMAXPROCS`.

---

## Common Misconceptions

### "Pause stops running tasks"

No. Pause only prevents new dispatches.

### "SubmitWait is faster than Submit because it skips the queue"

No. `SubmitWait` still goes through the same dispatcher and queue. It just blocks the caller until the task finishes. It is *slower* per call, not faster.

### "The pool retries failed tasks"

No. Tasks run once. Retries are your responsibility.

### "If I create a pool with maxWorkers=1, my tasks run in order"

In practice, yes — there is only one worker, and the queue is FIFO. But the library does not guarantee FIFO across all versions and edge cases. If strict ordering matters, use a single goroutine reading from a channel.

### "Workers are reused so my init code runs once"

No. The pool does not let you initialise workers. Each task is independent. If you need per-worker state, use `tunny`.

### "StopWait kills running tasks after a timeout"

No. `StopWait` waits forever for running tasks. Add your own deadline.

### "Submitting nil is okay because the library handles it"

Some versions silently drop nil, some recover the resulting panic, some panic before recovery. Do not submit nil.

### "Pause is the same as Stop"

No. Pause is reversible. Stop is not.

---

## Tricky Points

### `SubmitWait` blocks even if you do not care about the result

If you only want backpressure, `SubmitWait` is fine. If you have nothing to wait for and just used it out of habit, you have made your submitter into a single-task-at-a-time loop. Consider `Submit` + semaphore for better throughput.

### The recover wraps your task in `defer`

This means a panic in a deferred function inside your task still gets caught by the library's outer recover. That can hide bugs in deferred cleanup.

### `Pause` semantics around in-flight tasks

When you call `pool.Pause(ctx)`, tasks already dispatched to workers continue. Tasks in the queue stay there. Until `ctx` is cancelled, new submits queue but never dispatch. After cancel, the dispatcher resumes from where it stopped.

### `Stop` with `WaitingQueueSize() == 0`

If the queue is empty and you call `Stop`, the only thing remaining is running tasks. Workers finish, exit, dispatcher exits, `Stop` returns. Same as `StopWait` would do in that case.

### Order of `Submit` and `Pause`

If you submit immediately after `Pause`, the task queues but does not run until resume. Useful for "queue work without doing it yet".

### Pool with all workers busy

When `maxWorkers` workers are all running tasks, the dispatcher queues more. Workers free up one by one and grab queued tasks. The `WaitingQueueSize` is exactly the queued count, not including the `maxWorkers` running.

### Submitting after `cancel()` of the pause context

If you cancel the pause context (resume), tasks queued during the pause dispatch as soon as workers are free. Then new submits flow normally.

### `Submit` from many goroutines

The library is fine with this. Internally, all submits funnel through a single channel into the dispatcher. The dispatcher serialises them. So submission contention is bounded by the channel, not by user code.

---

## Test

```go
package main

import (
    "errors"
    "fmt"
    "sync"
    "sync/atomic"
    "testing"
    "time"

    "github.com/gammazero/workerpool"
)

func TestSubmitWaitBlocks(t *testing.T) {
    pool := workerpool.New(2)
    defer pool.StopWait()

    var done int64
    pool.SubmitWait(func() {
        time.Sleep(50 * time.Millisecond)
        atomic.StoreInt64(&done, 1)
    })
    if atomic.LoadInt64(&done) != 1 {
        t.Fatal("SubmitWait did not wait for task")
    }
}

func TestSubmitAfterStopIsNoop(t *testing.T) {
    pool := workerpool.New(2)
    pool.StopWait()

    var ran int64
    pool.Submit(func() { atomic.AddInt64(&ran, 1) })

    time.Sleep(10 * time.Millisecond)
    if atomic.LoadInt64(&ran) != 0 {
        t.Fatal("submit after StopWait should be no-op")
    }
}

func TestStopWaitDrainsQueue(t *testing.T) {
    pool := workerpool.New(2)
    var done int64
    for i := 0; i < 100; i++ {
        pool.Submit(func() {
            time.Sleep(time.Millisecond)
            atomic.AddInt64(&done, 1)
        })
    }
    pool.StopWait()
    if atomic.LoadInt64(&done) != 100 {
        t.Fatalf("expected 100 done, got %d", done)
    }
}

func TestStopDiscardsUnstartedRoughly(t *testing.T) {
    pool := workerpool.New(1)
    var done int64
    for i := 0; i < 100; i++ {
        pool.Submit(func() {
            time.Sleep(10 * time.Millisecond)
            atomic.AddInt64(&done, 1)
        })
    }
    pool.Stop()
    // With 100 tasks sleeping 10ms each on 1 worker, Stop should drop most.
    if atomic.LoadInt64(&done) == 100 {
        t.Log("edge case: all tasks finished before Stop; test is racy by design")
    }
}

func TestPanicDoesNotCrashPool(t *testing.T) {
    pool := workerpool.New(2)
    defer pool.StopWait()

    pool.Submit(func() { panic("boom") })

    // After the panic, the pool should still process new tasks.
    var ran int64
    pool.Submit(func() { atomic.AddInt64(&ran, 1) })
    pool.StopWait()

    if atomic.LoadInt64(&ran) != 1 {
        t.Fatal("pool did not recover from task panic")
    }
}

func TestRecoverableErrorCollection(t *testing.T) {
    pool := workerpool.New(4)

    var mu sync.Mutex
    var errs []error
    for i := 0; i < 10; i++ {
        i := i
        pool.Submit(func() {
            if i%2 == 0 {
                mu.Lock()
                errs = append(errs, fmt.Errorf("err %d", i))
                mu.Unlock()
            }
        })
    }
    pool.StopWait()

    if len(errs) != 5 {
        t.Fatalf("expected 5 errors, got %d", len(errs))
    }
}

func TestContextCancellation(t *testing.T) {
    pool := workerpool.New(2)
    defer pool.StopWait()

    var ran int64
    ctx, cancel := context.WithCancel(context.Background())
    pool.Submit(func() {
        select {
        case <-ctx.Done():
            return
        case <-time.After(time.Hour):
            atomic.AddInt64(&ran, 1)
        }
    })
    time.Sleep(10 * time.Millisecond)
    cancel()
    pool.StopWait()
    if atomic.LoadInt64(&ran) != 0 {
        t.Fatal("task should have honoured context cancellation")
    }
}

var _ = errors.New // keep imports tidy
```

(In a real test file you would split these into multiple `_test.go` files; here we keep them together for readability.)

---

## Tricky Questions

### Q: What is the value of `pool.Stopped()` after the *first* `Submit` to a fresh pool?

`false`. `Stopped` becomes `true` only when `Stop` or `StopWait` is called.

### Q: Can two concurrent `StopWait` calls both return?

Yes. Both return at the same time when shutdown completes. The library handles concurrent shutdowns gracefully.

### Q: What happens if a task panics during a `SubmitWait`?

The library's outer `defer recover()` catches the panic. The `done` channel for `SubmitWait` is closed in `defer close(done)`, so `SubmitWait` returns. The caller observes nothing — no panic, no error.

### Q: Can `WaitingQueueSize` exceed any number?

In principle, yes — it is just an int counter. In practice, you OOM long before integer overflow.

### Q: Does the library lock during `Submit`?

Submissions go through a channel into the dispatcher. Channels are themselves mutex-protected internally, so there is effectively a lock — but you do not see it as a `sync.Mutex` in the API.

### Q: How many goroutines are in a freshly-created pool of size 8?

Two: the main goroutine and the dispatcher. Workers spin up on demand.

### Q: How long does a worker live without work?

About 2 seconds.

### Q: Does `Pause(ctx)` block?

No. `Pause` returns immediately; it just sets internal state. The dispatcher checks it on each iteration.

### Q: Can `Pause` be called twice?

The behaviour depends on the version. Typically, the new pause supersedes the old: the previous context is no longer the one that resumes the pool. Check the spec file.

### Q: Is there a way to know which worker ran a task?

No. Workers have no public identity.

---

## Cheat Sheet

```go
// Synchronous submit (blocks until done)
pool.SubmitWait(func() { ... })

// Check shutdown state
if pool.Stopped() { return }

// Monitor queue depth
n := pool.WaitingQueueSize()

// Hard shutdown (drops unstarted)
pool.Stop()

// Soft shutdown (drains)
pool.StopWait()

// Pause/resume
ctx, cancel := context.WithCancel(context.Background())
pool.Pause(ctx)
// ... later ...
cancel()
```

Patterns:

- **Backpressure:** semaphore in front of `Submit`.
- **Sequential within parallel:** `SubmitWait` for the barrier task.
- **Cancellation:** context captured in closure.
- **Panic safety:** `defer recover()` inside the task closure.
- **Shutdown with deadline:** `StopWait` in a goroutine + `select` with `time.After`.

---

## Self-Assessment Checklist

- [ ] I can explain why `SubmitWait` from inside a task on a small pool deadlocks.
- [ ] I know that `Stopped()` becomes `true` at the moment of `Stop`, not at completion.
- [ ] I can write a producer that respects `Stopped` and exits cleanly.
- [ ] I can attach a `context.Context` to a task and have it respect cancellation.
- [ ] I can collect errors from many tasks and return them as one.
- [ ] I can wrap a task in a panic-recovering closure that logs to my monitoring stack.
- [ ] I can measure queue depth as a metric.
- [ ] I can implement backpressure via a counting semaphore.
- [ ] I know the 2-second idle timeout is hard-coded and what that implies for bursty workloads.
- [ ] I can pick between one pool, two pools, and a pipeline of pools for a given workload.

---

## Summary

The middle level is about *competent operation*. The basic API (`Submit`, `StopWait`) suffices for batch scripts; the middle-level API (`SubmitWait`, `Stopped`, `Pause`, context plumbing, panic recovery) is what you need for long-running services with real shutdown stories and real error handling.

Three things to internalise:

1. **`SubmitWait` is a tool, not a default.** Use it for backpressure or barriers. Be wary of deadlocks in tasks that submit-and-wait.
2. **Shutdown is a process, not a moment.** `Stop` is fast; `StopWait` waits for the queue; both wait for running tasks. Add a deadline yourself if you need bounded shutdown time.
3. **The library is intentionally minimal.** Anything beyond "bounded worker count, unbounded queue, no per-task error" is your job to build on top.

The senior file digs into the library's actual code to explain *why* it behaves this way. The professional file uses that understanding to tell stories of production incidents.

---

## What You Can Build

With middle-level fluency you can build:

- A graceful HTTP server background worker (with signal-driven drain).
- A bounded async outbound webhook delivery system.
- A multi-stage ETL pipeline with separate pools per stage.
- A test harness that runs N test cases concurrently with timeouts.
- A circuit-breaker-protected pool that pauses when a downstream is unhealthy.

---

## Further Reading

- The library's source — only a few hundred lines, well worth reading after this file.
- The senior file in this chapter — internals walkthrough.
- "Concurrency in Go" by Katherine Cox-Buday — chapter on bounded parallelism.
- `golang.org/x/sync/errgroup` — for the cases where you want errors from tasks.
- `golang.org/x/sync/semaphore` — for backpressure semaphores with weighted resources.

---

## Related Topics

- **`context.Context`** — universal cancellation; required for any non-trivial pool work.
- **`sync.WaitGroup`** — batch boundaries within a long-lived pool.
- **`errgroup.Group`** — error-aware concurrent work; complementary to a bound pool.
- **`golang.org/x/sync/semaphore`** — weighted semaphore for capacity-based backpressure.
- **Rate limiters** (`golang.org/x/time/rate`) — submission-rate caps.

---

## Diagrams and Visual Aids

### SubmitWait flow

```
caller goroutine                  pool                          worker goroutine
─────────────────                  ────                          ────────────────
SubmitWait(task)
  ↓
  wrap(task) sent ──────────────→ dispatcher ─────→ workerChan ─→ worker runs:
                                                                   task()
                                                                   close(done)
  ↓
  <-done   ←──────────────────────────────────────────────────  done closed
  return
```

### Backpressure with semaphore

```
producer                     semaphore (cap N)             pool                   workers
────────                     ──────────────────             ────                   ───────
sem <- {} ─→ block if full ─→ slot taken      ─→ Submit ─→ enqueue ─→ run task
                                                                       ↓
                                                            <-sem (slot freed)
```

### Shutdown timeline

```
T=0       Stop() / StopWait() called
T=0+ε     Stopped() returns true; submits no-op
T=k       last running task finishes
T=k+ε     workers exit (idle channel close)
T=k+2ε    dispatcher exits
T=k+3ε    Stop / StopWait returns
```

Where `k` is the time of the longest-running task at `T=0`.

### Pause cycle

```
              Pause(ctx)             cancel(ctx)
                ↓                      ↓
[normal] ──→ [paused: queue grows, workers idle finish] ──→ [normal again]
```

These shapes are worth printing and keeping near your desk while you learn the API.

---

## Appendix A: Extended Worked Examples

What follows are six longer examples worked end-to-end, with running commentary.

### Example A: Backpressured database backfill

You have a billion rows in a source table, you want to back-fill them into a destination service, and the service can handle 50 RPS. You also want the back-fill to be resumable — if you crash midway, you should be able to start where you left off.

```go
package main

import (
    "context"
    "database/sql"
    "log"
    "sync/atomic"
    "time"

    "github.com/gammazero/workerpool"
    _ "github.com/lib/pq"
    "golang.org/x/time/rate"
)

type Row struct {
    ID   int64
    Data string
}

func backfill(ctx context.Context, db *sql.DB, dest Service) error {
    pool := workerpool.New(50)
    defer pool.StopWait()

    limiter := rate.NewLimiter(rate.Limit(50), 50) // 50 RPS, bucket size 50

    rows, err := db.QueryContext(ctx, "SELECT id, data FROM source WHERE id > $1 ORDER BY id", lastID())
    if err != nil {
        return err
    }
    defer rows.Close()

    var maxID int64
    for rows.Next() {
        if ctx.Err() != nil {
            break
        }
        var r Row
        if err := rows.Scan(&r.ID, &r.Data); err != nil {
            return err
        }
        if err := limiter.Wait(ctx); err != nil {
            return err
        }
        r := r
        pool.Submit(func() {
            if err := dest.Send(ctx, r); err != nil {
                log.Printf("send id=%d: %v", r.ID, err)
                return
            }
            atomic.StoreInt64(&maxID, r.ID)
            persistCheckpoint(r.ID)
        })
    }
    return rows.Err()
}
```

Several middle-level techniques in one place:

- The pool gives us bounded concurrency (50).
- The rate limiter gives us bounded RPS (also 50; they are different bounds).
- The context propagates cancellation if the program is asked to stop.
- The checkpoint inside each task makes the back-fill resumable.
- `defer pool.StopWait()` ensures clean shutdown even on error.

The interaction between the rate limiter and the pool is worth pondering. The limiter ensures we do not *submit* faster than 50/s. The pool ensures we do not have more than 50 in flight at a time. With a 1-second task duration, both bounds say the same thing (50 RPS, 50 concurrent). With longer tasks (say 5 seconds each), the pool's bound kicks in first — at most 50 in flight, so 10 RPS even though the limiter would allow 50.

### Example B: HTTP server with a background-task pool

```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/gammazero/workerpool"
)

var pool = workerpool.New(64)

func main() {
    http.HandleFunc("/work", handleWork)
    http.HandleFunc("/metrics", handleMetrics)

    srv := &http.Server{Addr: ":8080"}

    go func() {
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatal(err)
        }
    }()

    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT)
    sig := <-sigs
    log.Println("received signal:", sig)

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Println("server shutdown:", err)
    }

    // After the server is no longer accepting, drain the pool.
    drained := make(chan struct{})
    go func() {
        pool.StopWait()
        close(drained)
    }()

    select {
    case <-drained:
        log.Println("pool drained cleanly")
    case <-shutdownCtx.Done():
        log.Println("pool drain deadline, forcing stop")
        pool.Stop()
        <-drained
    }
    log.Println("clean exit")
}

func handleWork(w http.ResponseWriter, r *http.Request) {
    if pool.Stopped() {
        http.Error(w, "shutting down", http.StatusServiceUnavailable)
        return
    }
    pool.Submit(func() {
        // simulate background work
        time.Sleep(100 * time.Millisecond)
        log.Println("processed background task")
    })
    fmt.Fprintln(w, "accepted")
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "queue_depth %d\nstopped %v\n", pool.WaitingQueueSize(), pool.Stopped())
}
```

What this demonstrates:

- A single package-level pool shared across handlers.
- `Stopped()` checked in the handler to reject new work during shutdown.
- A deadline on pool drainage (30 seconds; if it exceeds, force stop).
- A simple `/metrics` endpoint exposing pool depth.

A common mistake here is to call `pool.StopWait()` *before* `srv.Shutdown()`. That would mean new requests still arrive and try to submit to a stopped pool, which is silently dropped. The order in the example — `srv.Shutdown` first, then drain pool — is correct.

### Example C: Per-tenant pools with quotas

```go
type TenantPool struct {
    pools map[string]*workerpool.WorkerPool
    mu    sync.RWMutex
}

func (tp *TenantPool) get(tenant string) *workerpool.WorkerPool {
    tp.mu.RLock()
    p, ok := tp.pools[tenant]
    tp.mu.RUnlock()
    if ok {
        return p
    }
    tp.mu.Lock()
    defer tp.mu.Unlock()
    p, ok = tp.pools[tenant]
    if ok {
        return p
    }
    p = workerpool.New(quotaFor(tenant))
    tp.pools[tenant] = p
    return p
}

func (tp *TenantPool) Submit(tenant string, f func()) {
    tp.get(tenant).Submit(f)
}

func (tp *TenantPool) StopAll() {
    tp.mu.Lock()
    defer tp.mu.Unlock()
    for _, p := range tp.pools {
        p.StopWait()
    }
}
```

The double-checked lock pattern is idiomatic Go. Each tenant gets its own pool sized to their quota. A noisy tenant cannot saturate the workers of a quiet tenant.

The cost: one dispatcher goroutine per tenant. For 10 tenants, fine. For 10,000, this design is wasteful and you would instead use a single pool with a per-tenant token bucket in front.

### Example D: Task with retries

```go
func submitWithRetry(pool *workerpool.WorkerPool, item Item) {
    pool.Submit(func() {
        backoff := 100 * time.Millisecond
        for attempt := 1; attempt <= 5; attempt++ {
            if err := tryOnce(item); err == nil {
                return
            }
            time.Sleep(backoff)
            backoff *= 2
        }
        log.Printf("item %v gave up after 5 attempts", item.ID)
    })
}
```

The retry lives inside the task. A worker is held for the entire retry chain — up to ~3 seconds for the example backoff. If your retries are long, this can starve the pool. Alternatives:

- Re-submit on failure rather than retry inside the task:

```go
func submitWithResubmit(pool *workerpool.WorkerPool, item Item, attempt int) {
    pool.Submit(func() {
        if err := tryOnce(item); err == nil {
            return
        }
        if attempt < 5 {
            time.AfterFunc(backoffFor(attempt), func() {
                submitWithResubmit(pool, item, attempt+1)
            })
        } else {
            log.Printf("item %v gave up", item.ID)
        }
    })
}
```

This releases the worker between attempts. The `time.AfterFunc` runs the resubmit on a timer goroutine, not on a pool worker.

### Example E: Coordinated shutdown across pools

A program with three pools — `parse`, `enrich`, `write` — must shut down in order: stop accepting input, drain parse, drain enrich, drain write.

```go
type Pipeline struct {
    parse, enrich, write *workerpool.WorkerPool
    enrichCh, writeCh    chan Item
    inputCh              chan Raw
    stopAccepting        chan struct{}
}

func (p *Pipeline) Run() {
    var inputWg sync.WaitGroup

    inputWg.Add(1)
    go func() {
        defer inputWg.Done()
        for {
            select {
            case <-p.stopAccepting:
                return
            case raw := <-p.inputCh:
                raw := raw
                p.parse.Submit(func() {
                    parsed := parseOne(raw)
                    p.enrichCh <- parsed
                })
            }
        }
    }()

    var enrichWg sync.WaitGroup
    enrichWg.Add(1)
    go func() {
        defer enrichWg.Done()
        for it := range p.enrichCh {
            it := it
            p.enrich.Submit(func() {
                enriched := enrichOne(it)
                p.writeCh <- enriched
            })
        }
    }()

    var writeWg sync.WaitGroup
    writeWg.Add(1)
    go func() {
        defer writeWg.Done()
        for it := range p.writeCh {
            it := it
            p.write.Submit(func() { writeOne(it) })
        }
    }()

    // Coordinated shutdown:
    <-p.stopAccepting // signal input loop to exit
    inputWg.Wait()
    p.parse.StopWait() // drain parse
    close(p.enrichCh)
    enrichWg.Wait()
    p.enrich.StopWait() // drain enrich
    close(p.writeCh)
    writeWg.Wait()
    p.write.StopWait() // drain write
}
```

The pattern is: at each stage, stop the upstream, drain the pool, then signal the next stage to drain. Channels are closed in the correct order so range loops terminate.

This is intricate. Real production code often uses `errgroup` or a similar abstraction to manage the lifecycle. But the underlying ideas are pool-agnostic.

### Example F: Pool with structured logging

```go
import "go.uber.org/zap"

type LoggingPool struct {
    inner  *workerpool.WorkerPool
    logger *zap.Logger
}

func NewLoggingPool(max int, logger *zap.Logger) *LoggingPool {
    return &LoggingPool{inner: workerpool.New(max), logger: logger}
}

func (lp *LoggingPool) Submit(name string, f func()) {
    submitted := time.Now()
    lp.inner.Submit(func() {
        ranAt := time.Now()
        queueWait := ranAt.Sub(submitted)

        defer func() {
            if r := recover(); r != nil {
                lp.logger.Error("task panic",
                    zap.String("name", name),
                    zap.Any("panic", r),
                    zap.Duration("queue_wait", queueWait),
                    zap.Stack("stack"),
                )
            }
        }()

        defer func(start time.Time) {
            lp.logger.Info("task complete",
                zap.String("name", name),
                zap.Duration("queue_wait", queueWait),
                zap.Duration("run_time", time.Since(start)),
            )
        }(ranAt)

        f()
    })
}
```

Logs include:

- The task name.
- How long it waited in the queue.
- How long it took to run.
- Any panic value and stack.

This is the start of "production-grade" wrapping. The professional file extends it with metrics, tracing, and adaptive sizing.

---

## Appendix B: A Mini Q&A on Edge Cases

A grab-bag of "what happens if?" questions.

### What if I submit while the pool is paused?

The task queues. It will dispatch as soon as the pool resumes. No data is lost.

### What if I pause and then immediately resume (`Pause(ctx)` then `cancel()`)?

The pool was paused for a tiny interval. Tasks that arrived during the interval are queued; they dispatch as soon as workers are free. No different from normal operation.

### What if I pause an already-paused pool?

Behaviour depends on the version. Typically, the new pause replaces the old: cancelling the old context no longer resumes the pool. Calling `cancel()` on the new context does. Treat pause as a single-context lock; do not stack them.

### What if the pause context never gets cancelled?

The pool stays paused forever. Queued tasks pile up. Producers keep adding (since `Submit` is non-blocking). Eventually you OOM. Always have a code path that cancels the pause context.

### What if `Stop` is called during a pause?

The pause is irrelevant — `Stop` overrides it. Queued tasks are discarded; running tasks finish; the pool exits.

### What if `StopWait` is called during a pause?

Some versions wait for resume before draining. Others may resume implicitly. Test with your specific version; do not rely on either behaviour.

### What if I submit nil?

The internal dispatch calls `nil()` which panics. The library's recover catches it. The worker survives. Subsequent tasks run normally. But your nil task is effectively lost. Do not submit nil; validate at the call site.

### What if I submit from a closed `init` function?

`init` runs once at program start. A pool created in `init` is fine, but `init` must return for the program to start. Submitting from `init` is legal but unusual. Better to submit from `main` or a constructor.

### What if I create two pools with the same `maxWorkers`?

They are independent. Worker counts are not shared. You have `2 * maxWorkers` total workers possible.

### What if I use the pool from a `goroutine` started inside a task?

Legal. The pool is concurrency-safe. Just remember the child goroutine is *outside* the pool's accounting and outside the panic recovery.

### What if I call `pool.Submit(pool.SubmitWait)`?

Type error — `SubmitWait` takes a `func()`, not a method value with arguments. The compiler stops you before runtime.

### What if I rely on `WaitingQueueSize() == 0` to mean "all done"?

Don't. Tasks may be running on workers but no longer queued. Queue size 0 with workers active means "no more queued tasks to dispatch", not "everything has finished".

---

## Appendix C: A Story From the Field

A startup once shipped a webhook delivery service using `workerpool` with `maxWorkers = 100`. Initial launch was smooth; throughput was good; latency was reasonable.

Six months in, a customer signed up that produced a sudden 100x spike in webhook traffic. The service's queue depth — which had hovered around 50 — shot up to 200,000 in three minutes. Memory rose from 200MB to 4GB. The Kubernetes liveness probe began failing because the metrics endpoint slowed to a crawl (GC pressure). The pod restarted. The new pod inherited the same customer's traffic, the queue grew again, the pod died again. Loop.

The fix had three parts:

1. **Bound the queue.** A semaphore in front of `Submit` capping in-flight + queued at 5,000. Excess deliveries were dropped to a dead-letter queue for re-processing later.
2. **Per-tenant fairness.** Each tenant got a max share of the queue. A spike from one tenant could not starve others.
3. **Adaptive `maxWorkers`.** Increased from 100 to 500 when traffic patterns showed the downstream could handle it.

The first fix was implementable in 20 lines using the patterns described in this file. The second required a small tenant-aware wrapper. The third required moving from `workerpool` (which does not let you change `maxWorkers`) to a custom pool.

The lesson: `workerpool` is great for moderate, bounded workloads. The unbounded queue is a liability for any service that accepts traffic from untrusted or unpredictable sources. *Always* bound the queue when you cannot trust the producer.

---

## Appendix D: When to Graduate Past Workerpool

If you find yourself reaching for `workerpool` features that do not exist, it is time to consider alternatives:

| Need | Library |
|------|---------|
| Per-task generics / typed args | `panjf2000/ants` (with `PoolWithFunc`) |
| Dynamic resizing (`Tune`) | `ants` |
| Per-worker state (DB conn, ML model) | `Jeffail/tunny` |
| Million tasks/sec throughput | `ants` or custom |
| Priority queueing | custom (no library does this well) |
| Hot reload / config changes | custom |
| First-class metrics, OpenTelemetry | custom wrapper or instrumented `ants` |
| Cross-process / distributed | Redis + workers, NATS, Kafka |

The advice "use the simplest tool that works" still applies. Stay on `workerpool` as long as its API is enough. Switch when you start writing too much ceremony around it.

---

## Appendix E: Quick Reference Card

Print this out, tape it next to your monitor.

```
workerpool.New(N)                — make pool, dispatcher starts immediately
pool.Submit(func())              — schedule; returns fast
pool.SubmitWait(func())          — schedule; blocks until done
pool.Stopped() bool              — has Stop/StopWait been called?
pool.WaitingQueueSize() int      — queued not-yet-started tasks
pool.Pause(ctx)                  — pause dispatching until ctx cancelled
pool.Stop()                      — discard queued, wait for running, done
pool.StopWait()                  — drain queued AND running, done

idle worker reaped after ~2s
panic in task: library recovers, value lost — wrap yourself if needed
nil task: do not submit
SubmitWait inside small pool: deadlock risk
Submit after Stop: silently dropped
```

Memorise the top half. Refer to the bottom half until it becomes automatic.

---

That covers the middle level. Take a break, then dive into the senior file for the library's actual internals — the dispatcher loop, the idle reaper, and the comparison with hand-rolled pool designs.

---

## Appendix F: Deep-Dive on Backpressure Theory

A short detour into why backpressure matters and how the patterns we discussed map to general theory.

In any pipeline of stages, three things matter:

- **Producer rate (λ_p).** How fast input arrives.
- **Consumer rate (λ_c).** How fast workers process.
- **Queue capacity (Q).** How many tasks fit between them.

If λ_p > λ_c indefinitely, no finite Q saves you — the queue grows unbounded. You need either:

1. **Reduce λ_p:** rate limiting, dropping requests, returning 429.
2. **Increase λ_c:** more workers, faster workers, parallel pools.
3. **Make Q finite and apply backpressure:** force producers to slow down when queue is full.

`workerpool` defaults to option 3 with `Q = ∞`, which is actually no backpressure at all. To get real backpressure you must:

- Build a finite Q in front (semaphore).
- Or use `SubmitWait` (Q = 0; producer blocks per task).
- Or sample/drop based on `WaitingQueueSize()`.

Little's Law (`L = λW`) tells us the steady-state queue length equals the arrival rate times the time spent in the system. If you have 1000 RPS arriving and tasks taking 2 seconds, you have ~2000 tasks in the system. With `maxWorkers = 100`, 100 are running and 1900 are queued at steady state. That number — 1900 — is the realistic queue depth, not a worst case.

If 1900 tasks each hold 10 KB of captured state, you have 19 MB of memory pinned. Multiply by traffic spikes and you see the OOM risk.

The middle-level designer's job is to make Little's Law explicit: model your λ and W, derive your expected L, and decide whether L is acceptable. If not, change λ (rate limit) or W (more workers, faster code) until L is comfortable.

This is why monitoring `WaitingQueueSize` matters. It is your *measured* L. If it differs from your *predicted* L, your model is wrong and you have learned something.

---

## Appendix G: Memory Footprint of a Pool

A common operational question: "How much memory does a `workerpool.New(N)` cost?"

Rough numbers:

- **Dispatcher goroutine:** one goroutine with ~2-8 KB stack.
- **Worker goroutines (active):** `numActiveWorkers * ~2-8 KB`.
- **Queue entries:** each pending task is a closure on the heap. Closure size depends on captures. Empty closure ~24 bytes plus pointer overhead. Typical with a few captures: ~100 bytes.
- **Internal channels:** a few small channels, total <1 KB.

For a pool with `maxWorkers = 100` and queue depth `10,000`:

- Goroutines: 1 (dispatcher) + up to 100 (workers) = 101 goroutines × 4 KB avg = ~400 KB.
- Queue: 10,000 closures × 100 bytes = ~1 MB.
- Total: ~1.5 MB.

For most services that is negligible. For a service with 1,000 pools (one per tenant in a multi-tenant system), it adds up: 1,000 × 1.5 MB = 1.5 GB. Now it matters.

Memory math for queue entries is the dominant cost when queues are large. If you keep `WaitingQueueSize()` under 1,000, even with heavy closure captures (1 KB each), you are at 1 MB. Easy.

The takeaway: dispatcher and workers are cheap; the queue can be expensive if you let it grow. Bound it.

---

## Appendix H: Comparing `Submit` Throughput

A short note on the channel-send cost. Each `pool.Submit` does roughly:

1. Allocate a closure (heap allocation, ~50-200 ns depending on captures).
2. Send the closure on a channel (~50-100 ns for an unbuffered chan).
3. Dispatcher receives, decides what to do (~50-100 ns).
4. If a worker is ready, forward via another channel (~50-100 ns).
5. Worker receives and runs the task.

Total submit-side overhead: roughly 200-500 nanoseconds per submit. That is the *floor* on per-task overhead for `workerpool`.

For comparison:

- **`go func() {}`:** ~250-500 ns. Comparable.
- **`ants.Submit`:** ~150-300 ns (faster channel usage in newer versions).
- **Hand-rolled `chan func()`:** ~100-200 ns (no dispatcher hop).

So `workerpool` is slightly slower than the hand-rolled equivalent, due to the dispatcher hop. For tasks of any meaningful size (microseconds and up), this is rounding error. For nanosecond-scale "tasks" — which should not be in a pool anyway — you would feel it.

If you need *really* high throughput, two recipes:

1. Batch many small tasks into one Submit. Instead of `for i := 0; i < N; i++ pool.Submit(func() { work(i) })`, do `pool.Submit(func() { for i := 0; i < N; i++ { work(i) } })`. The pool then dispatches just one task; the chunking happens inside.
2. Use `ants.PoolWithFunc`, which avoids closure allocation by binding the function once and accepting an `interface{}` argument per task.

These optimisations belong in the optimize file but are worth knowing exists at middle level.

---

## Appendix I: Pool Lifecycle Diagram (Detailed)

A more detailed lifecycle than the one in the main diagrams section:

```
                    ┌──────────────────┐
                    │      INITIAL     │
                    │ - no pool yet    │
                    └────────┬─────────┘
                             │ New(N)
                             ▼
                    ┌──────────────────┐
                    │      RUNNING     │
                    │ - dispatcher up  │
                    │ - 0..N workers   │
                    │ - queue ≥ 0      │
                    └────────┬─────────┘
                             │
                ┌────────────┼────────────┐
                │            │            │
            Submit(f)    Pause(ctx)    Stop()/StopWait()
                │            │            │
                ▼            ▼            ▼
        queue grows,    new ctx,    stopped=true,
        dispatcher    dispatcher    dispatcher
        dispatches    halts new     drains (StopWait)
        to worker     dispatches    or discards (Stop)
                │            │            │
                │     cancel(ctx)         │
                ▼            ▼            ▼
            stay in       back to      ┌──────────────────┐
             RUNNING      RUNNING      │     SHUTDOWN     │
                                       │ - drain or skip  │
                                       │ - workers exit   │
                                       │ - dispatcher exit│
                                       └────────┬─────────┘
                                                ▼
                                        ┌──────────────────┐
                                        │      DEAD        │
                                        │ - all goroutines │
                                        │   exited         │
                                        │ - Submit no-ops  │
                                        └──────────────────┘
```

The states are: INITIAL → RUNNING → SHUTDOWN → DEAD. Pause is a transient state inside RUNNING, not a separate top-level state. The DEAD state is terminal — you cannot get back to RUNNING.

This diagram is useful as a mental check when reasoning about race conditions. "Is this code safe if the pool is in SHUTDOWN state?" "What about DEAD?" Walk through the state transitions and the answer often becomes obvious.

---

## Appendix J: Twenty More Patterns

A rapid-fire list of small patterns. Each is one-paragraph; pick the ones relevant to your work and explore further.

1. **Per-task timeout via context inside closure.** Already covered.
2. **Per-batch timeout via shared context.** One ctx for all tasks of a batch; cancel ends them all.
3. **Map-reduce with channels.** Map tasks send partials on a channel; reducer reads and folds.
4. **Tree walk via fan-out submission.** Each task can submit children; use `WaitGroup` to know when done.
5. **Bounded queue via semaphore.** The canonical backpressure pattern.
6. **Priority via two pools.** High-priority pool with low `maxWorkers`, low-priority with higher; total cap is the sum.
7. **Coalescing tasks.** Producer batches small items; the closure processes a slice at once.
8. **Rate-limited submission.** `rate.Limiter` in front of `Submit`.
9. **Retry on failure inside task.** Loop + sleep inside the closure.
10. **Retry via re-submit.** `time.AfterFunc` re-submits on failure.
11. **Dead-letter queue.** Failed tasks go to a separate channel for inspection.
12. **Per-tenant pools.** Map of `tenantID -> pool`.
13. **Per-tenant token bucket.** One shared pool, one bucket per tenant.
14. **Pause-on-error.** Detect cascading failure, pause pool, return service unavailable.
15. **Per-task tracing.** Capture span in closure; finish in deferred.
16. **Worker-side logging.** Log inside each task; gives flame-graph-friendly traces.
17. **Pool of pools.** A meta-pool dispatches to leaf pools by hash of the task.
18. **Pool with sentinel "done" tasks.** A no-op task last in the queue, signals when the queue is drained.
19. **Pool drain on signal.** SIGUSR2 triggers drain without exit.
20. **Replay pool.** Capture every submitted task in a log; replay on crash recovery.

You will not implement all 20 in any one service. Knowing they exist saves you from reinventing them when the need arises.

---

## Appendix K: Pool Anti-Pattern Hall of Fame

Six anti-patterns we have seen in real code reviews. Each is a real bug pattern, given here as a cautionary tale.

### "The Singleton Boomerang"

A service uses a package-level `var pool = workerpool.New(100)`. A test imports the package, runs, finishes — but the pool is never stopped, because tests do not call the service's shutdown function. Hundreds of test binaries leak hundreds of dispatcher goroutines into the test runner. Eventually the test runner OOMs. Fix: have a test helper that calls `pool.StopWait()` in `TestMain`'s cleanup.

### "The Per-Request Pool"

An HTTP handler creates `pool := workerpool.New(8)` on every request, submits some tasks, then `defer pool.StopWait()`. Each request now incurs the cost of spinning up a dispatcher, spinning up workers, and tearing it all down. Latency p99 doubles. Fix: hoist the pool to package level.

### "The Forgotten Recover"

A task in production starts panicking once every 10,000 requests due to a corner case in input parsing. The library's recover swallows it; no error, no metric, no log. The bug goes undetected for six months until a customer complains that some requests "just don't get processed". Fix: wrap every task in `defer recover()` and log + metric the panic.

### "The Eternal Pause"

Code uses `pool.Pause(ctx)` during a maintenance window. The maintenance script crashes before it cancels `ctx`. Production traffic queues forever; nothing is processed. Fix: always have a finite-deadline pause and a watchdog.

### "The Naive SubmitWait Recursion"

A tree walker calls `pool.SubmitWait` for each child node. With a deep tree and a small pool, the recursion blocks every worker. Deadlock. Fix: use `Submit` + `WaitGroup`.

### "The Unbounded Queue OOM"

Already a recurring theme. Bound the queue.

---

## Appendix L: Reading the Pool's Source Yourself

The library is small enough that you can read it in 30 minutes:

```
github.com/gammazero/workerpool/
├── workerpool.go     # main implementation, ~300 lines
└── workerpool_test.go
```

To follow along, clone the repo and open `workerpool.go`. Key things to look for:

- The `WorkerPool` struct fields — what state does the pool hold?
- The `dispatch` method — the main loop of the dispatcher goroutine.
- The `worker` method — what a worker does in its `for` loop.
- The `Stop` and `StopWait` methods — how shutdown is signalled.
- The timer-based idle reaping.

After reading, return to this file and reread the middle-level material. Everything should make more sense. The senior file then walks the code line-by-line.

---

## Appendix M: A Closing Story From Operations

A senior engineer once asked me why their nightly batch job had grown from 30 minutes to 4 hours over six months, with no obvious change in workload. The job used `workerpool` to fan out per-record processing.

Investigation found:

- `maxWorkers` was set to 8 (originally chosen for an 8-core machine that no longer existed; they had moved to 32 cores).
- Each task included a DB call that took 1 second.
- The DB now had 10× the records to scan.

The pool size had not changed; the workload had. With 8 workers and 1-second tasks, the throughput was 8 tasks per second. 10× more records meant 10× more wall time — exactly the observed regression.

The fix was a one-line change: `workerpool.New(32)`. Wall time dropped back to 30 minutes.

The lesson: `maxWorkers` is not a fire-and-forget constant. As your hardware and workload evolve, the right number changes. Document the reasoning behind your choice — comments like `// 8 = NumCPU() on production hosts; revisit when hardware changes` are gold for future maintainers.

This is exactly the kind of operational wisdom the professional file builds on. The middle file gives you the API knowledge; the professional file gives you the judgement to use it well.

---

## Appendix N: Twenty Middle-Level Exercises (Self-Study)

Each takes 10-30 minutes. Do them in any order.

1. Write a program that submits 1,000 tasks each of which sleeps a random duration between 10 and 100 ms. Track and print the peak number of concurrent in-flight tasks. Verify it never exceeds `maxWorkers`.

2. Modify the above to use `SubmitWait`. Compare wall-clock time vs `Submit`.

3. Write a program that submits 100,000 tiny tasks. Time `Submit` vs raw `go func() {}` with a `WaitGroup`. Measure the difference.

4. Build a producer that submits indefinitely while a consumer goroutine watches `WaitingQueueSize()` and logs whenever it exceeds 1,000.

5. Implement a `BoundedPool` wrapper that drops tasks when the queue is above some threshold, returning a `bool` to indicate accept/drop.

6. Implement a `MeasuredPool` wrapper that exposes Prometheus counters for submissions, completions, and panics.

7. Write a fan-out tree walker that uses `Submit` + `WaitGroup` to traverse a tree concurrently. Verify with a tree of 1 million nodes that it does not deadlock.

8. Reproduce the small-pool `SubmitWait` deadlock. Then fix it by switching to `Submit` + `WaitGroup`. Document the difference in your README.

9. Build an HTTP service with a per-tenant pool. Test it by simulating one greedy tenant and one quiet tenant; verify isolation.

10. Write a context-aware pool wrapper: `func (p *Pool) SubmitCtx(ctx context.Context, f func(context.Context))`. The wrapper threads the context through.

11. Implement a graceful shutdown with a 10-second deadline. If the deadline is exceeded, `Stop()` the pool and log how many tasks were dropped.

12. Write a load-testing harness using `workerpool` that sustains 1,000 RPS for 60 seconds against a local HTTP server.

13. Build a retry-on-failure wrapper that re-submits failed tasks with exponential backoff, up to 5 attempts.

14. Build a dead-letter pattern: failed tasks (after retries) go to a channel that a different goroutine processes.

15. Wrap the pool in a circuit breaker: if 50% of recent tasks fail, pause the pool for 30 seconds.

16. Implement two pools — CPU-bound and I/O-bound — and a router that picks one based on a hint argument.

17. Write a benchmark comparing `workerpool` to a hand-rolled `chan func()` pool with the same `maxWorkers`. Note throughput, latency, memory.

18. Use `pprof` to profile a busy pool. Identify where allocations happen. Optimise away one.

19. Build a "supervisor" goroutine that monitors `WaitingQueueSize` and dynamically signals a producer to slow down when the queue grows.

20. Read the library source. Find the `dispatch` function. Write a 1-paragraph explanation of how `SubmitWait` differs from `Submit` in the dispatcher's eyes.

After exercise 20, you are ready for the senior file.

---

## Appendix O: A Final Mental Model

If you remember one thing from the middle file, let it be this picture:

```
producers ─→ queue (Q) ─→ workers ─→ results
                ↑              ↑
            grows if Q ↑   capped at maxWorkers

your tools:
  Submit         — push to Q, return fast
  SubmitWait     — push to Q, wait for one task to finish
  Pause/Resume   — block workers from pulling from Q
  Stop           — discard Q, let running finish
  StopWait       — drain Q, let running finish
  WaitingQSize   — observe Q
  Stopped        — observe shutdown initiated

your responsibilities:
  - bound Q if producers are untrusted
  - thread ctx into tasks for cancellation
  - recover panics if you want their values
  - instrument and monitor Q depth
  - shut down before exiting your program
```

Everything else flows from this picture. Submit, queue, workers, shutdown. The library does the wiring; you provide the policies. That is middle level.

---

## Appendix P: Glossary for Code Reviewers

When reviewing code that uses `workerpool`, this is the vocabulary you should expect to apply.

- **Lifecycle pairing:** Is every `New` paired with a `StopWait` (or `Stop`)?
- **Capture safety:** Are loop variables shadowed for pre-Go-1.22 code?
- **Concurrency model:** Is shared state behind a mutex/atomic? Are channels properly sized?
- **Backpressure model:** Is the queue bounded for untrusted input? Is the producer rate-limited?
- **Cancellation:** Do tasks honour a context for graceful shutdown?
- **Error path:** Are errors collected and surfaced, or silently lost?
- **Panic path:** Are tasks panic-safe? Is `recover` in the right place?
- **Observability:** Is queue depth monitored? Are submissions and completions counted?

A code review that asks these eight questions catches 90% of pool-related bugs. Make them muscle memory.

---

## Appendix Q: One More Worked Example

A "scrape and store" tool that demonstrates middle-level fluency end-to-end.

```go
package main

import (
    "context"
    "encoding/json"
    "errors"
    "flag"
    "fmt"
    "io"
    "log"
    "net/http"
    "os"
    "os/signal"
    "sync"
    "sync/atomic"
    "syscall"
    "time"

    "github.com/gammazero/workerpool"
    "golang.org/x/time/rate"
)

type Page struct {
    URL    string `json:"url"`
    Status int    `json:"status"`
    Bytes  int    `json:"bytes"`
}

func main() {
    var (
        concurrency = flag.Int("c", 16, "max concurrent fetches")
        rps         = flag.Int("rps", 32, "max requests per second")
        timeout     = flag.Duration("t", 10*time.Second, "per-request timeout")
        outFile     = flag.String("o", "results.jsonl", "output file")
    )
    flag.Parse()

    urls, err := readURLs(flag.Args())
    if err != nil {
        log.Fatal(err)
    }
    log.Printf("queued %d urls", len(urls))

    pool := workerpool.New(*concurrency)
    limiter := rate.NewLimiter(rate.Limit(*rps), *rps)

    out, err := os.Create(*outFile)
    if err != nil {
        log.Fatal(err)
    }
    defer out.Close()

    var writeMu sync.Mutex
    enc := json.NewEncoder(out)

    ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer cancel()

    var ok, fail int64
    for _, u := range urls {
        if ctx.Err() != nil {
            log.Println("cancelled; stopping submission")
            break
        }
        if err := limiter.Wait(ctx); err != nil {
            log.Println("limiter wait:", err)
            break
        }
        u := u
        pool.Submit(func() {
            page, err := fetch(ctx, u, *timeout)
            if err != nil {
                atomic.AddInt64(&fail, 1)
                return
            }
            atomic.AddInt64(&ok, 1)
            writeMu.Lock()
            _ = enc.Encode(page)
            writeMu.Unlock()
        })
    }

    log.Println("draining pool...")
    drain := make(chan struct{})
    go func() { pool.StopWait(); close(drain) }()
    select {
    case <-drain:
        log.Println("clean drain")
    case <-time.After(30 * time.Second):
        log.Println("drain deadline, hard stop")
        pool.Stop()
        <-drain
    }

    log.Printf("done. ok=%d fail=%d", atomic.LoadInt64(&ok), atomic.LoadInt64(&fail))
}

func fetch(ctx context.Context, url string, timeout time.Duration) (Page, error) {
    ctx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()

    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return Page{}, err
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return Page{}, err
    }
    defer resp.Body.Close()
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return Page{}, err
    }
    return Page{URL: url, Status: resp.StatusCode, Bytes: len(body)}, nil
}

func readURLs(args []string) ([]string, error) {
    if len(args) == 0 {
        return nil, errors.New("usage: scraper <urls-file>")
    }
    f, err := os.Open(args[0])
    if err != nil {
        return nil, err
    }
    defer f.Close()
    var out []string
    var b [1]byte
    var line []byte
    for {
        _, err := f.Read(b[:])
        if err == io.EOF {
            if len(line) > 0 {
                out = append(out, string(line))
            }
            break
        }
        if err != nil {
            return nil, err
        }
        if b[0] == '\n' {
            if len(line) > 0 {
                out = append(out, string(line))
                line = line[:0]
            }
            continue
        }
        line = append(line, b[0])
    }
    return out, nil
}

func init() {
    // Without this, the http client may pool too few or too many connections per host.
    http.DefaultTransport.(*http.Transport).MaxIdleConnsPerHost = 100
}

var _ = fmt.Sprintln // keep imports tidy
```

What this demonstrates, in middle-level terms:

- `signal.NotifyContext` for context-aware cancellation.
- A rate limiter in front of submission.
- A pool with bounded concurrency.
- A mutex around `json.Encoder.Encode` (because encoders are not goroutine-safe).
- A drain with a 30-second deadline and a hard stop fallback.
- Atomic counters for stats.

Type this out. Run it on a URL list. Watch the output. Twiddle the flags. The muscle memory you build doing this stays with you for years.

---

That really is the end of the middle file. Read carefully, do at least five of the exercises, then advance.

---

## Appendix R: Quick FAQ

A small grab-bag of questions that come up at middle level.

### "Can I send the result of one task as the input of another?"

Yes — through a channel between two closures. The pool itself does not know about the pipeline; you build it on top.

### "How do I avoid creating a closure per task?"

You can't with `workerpool`. Each `Submit` requires a `func()`. If closure allocation is your bottleneck (it rarely is), use `ants.PoolWithFunc`.

### "Can I limit memory used by the queue directly?"

Not directly — the queue is unbounded. You bound it indirectly via a semaphore or by counting via `WaitingQueueSize`.

### "What's the difference between Pause and Stop?"

Pause is reversible; Stop is not. Pause keeps queued tasks; Stop discards them.

### "Is SubmitWait the same as a synchronous function call?"

Functionally yes; semantically there's a queue + dispatcher + worker hop between you and the task. Costs a few hundred nanoseconds.

### "Can I cancel a single SubmitWait?"

Not directly. `SubmitWait` does not take a context. Wrap with `Submit` + a done channel + a select.

### "How do I know a specific task finished?"

`SubmitWait` is one way. Or close a done channel from inside the task and select on it from outside.

### "Is the dispatcher a bottleneck?"

For most workloads, no. The dispatcher does one channel send per submitted task. At sub-microsecond per send, that's millions per second.

### "Can two tasks be running at the exact same instant?"

Yes — that's the whole point of `maxWorkers > 1`. You will need locks/atomics on shared state.

### "Does workerpool affect GOMAXPROCS?"

No. `GOMAXPROCS` is a runtime setting. The pool just creates goroutines; the runtime schedules them onto OS threads as normal.

### "Can I use workerpool with WebAssembly?"

In principle yes — pure Go, no syscalls outside the runtime. In practice, single-threaded WASM doesn't parallelise, so `maxWorkers > 1` doesn't buy you concurrency. The pool still serialises but adds overhead.

### "Is workerpool a good fit for CPU-bound number crunching?"

Yes, set `maxWorkers = NumCPU()`. The bottleneck is the work, not the pool.

### "What about cgo calls?"

cgo calls block an OS thread, not just a goroutine. A pool of `maxWorkers = 100` doing all-cgo can consume 100 OS threads. Watch your thread count (`pprof goroutine` or `cat /proc/<pid>/status | grep Threads`).

### "Can workerpool replace errgroup?"

For some use cases. `errgroup` adds error propagation and group cancellation. Use `errgroup` when you want those; use `workerpool` when you want a bounded long-lived pool.

### "Can I use workerpool inside a goroutine I started with errgroup.Go?"

Yes, but think about what you want: errgroup is bounded by `WithCancel`/`WithContext`, workerpool is bounded by `maxWorkers`. They're complementary.

### "What is the cost of pool.WaitingQueueSize()?"

Cheap — an atomic load. Safe to call in hot loops, though using it for synchronisation is wrong.

### "Can I serialize the pool's state?"

No, there is no concept of a "saved pool". State is in-memory only. For durable queues, use Redis / NATS / SQS.

### "Are tasks executed in submit order?"

Roughly, for a small pool. Not guaranteed. Do not rely on it.

### "Can a task submit a task to a *different* pool?"

Yes. No restrictions on cross-pool submission.

### "Does the pool detect deadlocks?"

No. If a task hangs, the pool hangs. Use context deadlines.

---

## Appendix S: Final Mental-Model Recap

Here is the picture one more time, with everything we have learned bolted on.

```
producers
   │  ↑  ↑ (rate-limited)
   │  │  │
   ▼  │  │
[SubmitWait?]                      ← optional barrier
   │  │  │
   ▼  ▼  │
[semaphore] (optional bounded queue)
   │  │  │
   ▼  ▼  ▼
[workerpool dispatcher]            ← single goroutine
   │
   ├──→ workerChan ──→ workers (≤ maxWorkers)
   │                       │
   │                       ├──→ task() with recover
   │                       ├──→ ctx-aware cancellation
   │                       ├──→ panic logged + metric
   │                       └──→ result → channel / shared state
   │
[Pause(ctx)] [Stop] [StopWait]    ← lifecycle controls
   │
   ▼
observability:
   WaitingQueueSize, submit counter, complete counter,
   panic counter, task duration histogram, slow-task log
```

If your `workerpool` code at middle level has all of these moving parts (the relevant ones, anyway), you are in good shape. Most production-ready usage looks roughly like this picture, scaled up or down.

The senior file picks up from here, opens the library's source, and walks the actual dispatcher loop and idle reaper code. Until then, you should have enough fluency to ship middle-complexity services with confidence.




