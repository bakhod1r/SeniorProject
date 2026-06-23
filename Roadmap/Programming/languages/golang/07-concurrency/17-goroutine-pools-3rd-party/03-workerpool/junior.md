---
layout: default
title: Junior
parent: workerpool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/03-workerpool/junior/
---

# gammazero/workerpool — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Why a Pool at All?](#why-a-pool-at-all)
5. [Installing workerpool](#installing-workerpool)
6. [Your First Pool](#your-first-pool)
7. [The Two Things You Will Use 95% of the Time](#the-two-things-you-will-use-95-of-the-time)
8. [Submit](#submit)
9. [Stop](#stop)
10. [A Complete First Program](#a-complete-first-program)
11. [Real-World Analogies](#real-world-analogies)
12. [Mental Models](#mental-models)
13. [Pros and Cons](#pros-and-cons)
14. [Use Cases](#use-cases)
15. [Code Examples](#code-examples)
16. [Coding Patterns](#coding-patterns)
17. [Clean Code](#clean-code)
18. [Product Use](#product-use)
19. [Error Handling](#error-handling)
20. [Security Considerations](#security-considerations)
21. [Performance Tips](#performance-tips)
22. [Best Practices](#best-practices)
23. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
24. [Common Mistakes](#common-mistakes)
25. [Common Misconceptions](#common-misconceptions)
26. [Tricky Points](#tricky-points)
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

> Focus: "I have N things to do, I want at most K of them running at the same time, and I do not want to write a worker pool from scratch. What is the smallest possible Go code that does that?"

The library `github.com/gammazero/workerpool` answers exactly that question. You import it, you create a pool with `workerpool.New(maxWorkers)`, you call `pool.Submit(f)` for every task, and you call `pool.StopWait()` at the end. That is the entire learning curve at the junior level.

This file walks through the four things you must know first:

1. How to install and import the library.
2. How `workerpool.New` actually behaves — what arguments it takes, and what it returns.
3. How `Submit` schedules work, and why it (almost) never blocks the caller.
4. How to shut the pool down cleanly with `Stop` and `StopWait`.

We will not yet talk about `SubmitWait`, `Stopped`, the dispatcher goroutine, the idle-worker timeout, or panic recovery. Those belong in the middle and senior files. Here we are after the *muscle memory* of the basic API — the version you would type without thinking five minutes after waking up.

Two ideas frame everything that follows. First, **`workerpool` is not magic**. Under the hood it is a fixed-size set of goroutines listening on a `chan func()`, with one extra dispatcher goroutine that mediates between user submits and worker reads. That is roughly what you would build yourself; the library just saves you the trouble. Second, **`workerpool` is not the only choice**. Two other libraries — `panjf2000/ants` and `Jeffail/tunny` — solve nearby problems differently. By the end of this chapter you will know exactly when `workerpool` is the right tool and when it is not.

After reading this junior file you will be able to:

- Install the library and write a "hello pool" program that compiles
- Pick a sensible value for `maxWorkers`
- Submit closures and named functions
- Avoid the captured loop-variable bug that catches every beginner
- Shut a pool down without leaking goroutines
- Print "all done" only when the last task has actually finished

You will not yet know how to wait for a single task's result, how to handle a panicking task, or how to integrate the pool with `context.Context`. Those come next.

---

## Prerequisites

- **Required:** A Go installation, version 1.18 or newer (1.21+ recommended). Check with `go version`. The library itself currently supports Go 1.20+, but most examples in this file compile on anything from 1.18 up.
- **Required:** Comfort with goroutines and the `go` keyword. You should already know what `sync.WaitGroup` does and have written at least one program that uses `go func() { ... }()`.
- **Required:** Knowledge of Go modules. You should be able to run `go mod init`, `go get`, and `go run .`.
- **Helpful:** Awareness that not everything in a Go program should be a goroutine. If you have not yet had a goroutine leak or a too-many-goroutines incident, the value of a pool may feel abstract.
- **Helpful:** Familiarity with `chan T`. The library uses channels internally, and a few of the more subtle behaviours only make sense once you can read a `select` block.

If you can write the following code without looking anything up, you are ready:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            fmt.Println(n)
        }(i)
    }
    wg.Wait()
}
```

If the inner `go func(n int) { ... }(i)` versus the buggy `go func() { fmt.Println(i) }()` distinction is unclear, revisit the **Goroutines — Junior** file before continuing. The pool will not save you from captured-variable bugs.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Worker pool** | A fixed-size group of goroutines that pull tasks from a shared queue. Decouples the *number of tasks* from the *number of goroutines that execute them simultaneously*. |
| **Pool** | The `*workerpool.WorkerPool` value returned by `workerpool.New`. Holds the worker set, the task queue, and the dispatcher state. |
| **Worker** | A goroutine started by the pool that loops reading tasks from a channel and executing them. |
| **Dispatcher** | An extra goroutine inside the pool that forwards user submissions to ready workers and handles idle-worker reaping. You never see it directly; it is an implementation detail. |
| **Task** | A `func()` with no arguments and no return value. The unit of work the pool executes. |
| **`maxWorkers`** | The cap on how many tasks can run concurrently. Set when you call `workerpool.New(n)`. |
| **`Submit`** | Hands a task to the pool. Returns almost immediately. The task runs at some point in the future on some pool worker. |
| **`SubmitWait`** | Like `Submit`, but blocks until the task has finished. Useful when you want backpressure or a "barrier". |
| **`Stop`** | Tells the pool to shut down. Discards any tasks not yet started, but lets running tasks finish. |
| **`StopWait`** | Tells the pool to shut down, but waits for all queued tasks (started and unstarted) to finish first. The "drain then close" variant. |
| **`Stopped`** | Returns `true` once `Stop` or `StopWait` has been called. Useful guard before submitting more work. |
| **Idle-worker timeout** | A fixed internal duration (2 seconds in current versions) after which a worker that has had no task to run exits. Lets the pool shrink to zero when idle. |
| **Unbounded queue** | The library's submit pipeline buffers any number of pending tasks in memory. Fast tasks get absorbed quickly; slow tasks can pile up unbounded if you keep submitting. |

---

## Why a Pool at All?

Before diving into the API, it is worth spelling out *why* you would ever use a worker pool in Go instead of just writing `go work(i)` in a loop. New Go developers often hear "goroutines are cheap, just spawn one per task" and then learn the hard way that "cheap" is not "free".

Consider this naive code that fetches 10,000 URLs:

```go
func fetchAll(urls []string) {
    var wg sync.WaitGroup
    for _, u := range urls {
        wg.Add(1)
        go func(u string) {
            defer wg.Done()
            _, _ = http.Get(u)
        }(u)
    }
    wg.Wait()
}
```

This *works* for 10 URLs. For 10,000 URLs it will:

- Open up to 10,000 simultaneous outbound TCP connections, exhausting your local port range on a busy machine.
- Trigger 10,000 simultaneous DNS lookups.
- Get rate-limited or banned by every target host.
- Open 10,000 simultaneous file descriptors (each TCP connection is one).
- Allocate ~2 KB stacks for 10,000 goroutines plus net/http internals — measured 80–200 MB of heap depending on TLS, headers, etc.

What you want is "fetch at most 50 URLs at a time, total 10,000". That is the use case a worker pool exists for. You decouple the number of tasks (10,000) from the concurrency level (50).

You can write the pool yourself in 20 lines:

```go
jobs := make(chan string)
var wg sync.WaitGroup
for i := 0; i < 50; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for u := range jobs {
            _, _ = http.Get(u)
        }
    }()
}
for _, u := range urls {
    jobs <- u
}
close(jobs)
wg.Wait()
```

That is a perfectly reasonable solution. So why use a library? Three reasons:

1. **The hand-rolled version blocks the submit loop** if all workers are busy. That is fine sometimes — it gives you backpressure — but sometimes you want submission itself to never block, with a buffer in front. `workerpool` handles that for you.
2. **The hand-rolled version does not free up its workers when idle.** If your work comes in bursts, you keep 50 idle goroutines around between bursts. `workerpool`'s idle reaper exits workers after 2 seconds.
3. **The hand-rolled version is one more thing to read, test, and maintain.** If your codebase has 12 places that need a pool, you either copy the 20 lines 12 times or you write a wrapper. The wrapper *is* the library.

`workerpool` is the library version of those 20 lines, plus the dispatcher, plus the idle reaper, plus a stable API to lean on. That is the entire design philosophy.

---

## Installing workerpool

Inside any Go module, run:

```bash
go get github.com/gammazero/workerpool
```

The library has zero dependencies outside the standard library. Your `go.mod` picks up a line like:

```
require github.com/gammazero/workerpool v1.1.3
```

(The exact version number drifts; this guide is written against v1.x.) Import in code:

```go
import "github.com/gammazero/workerpool"
```

If you do not yet have a module, create one first:

```bash
mkdir wp-demo && cd wp-demo
go mod init example.com/wp-demo
go get github.com/gammazero/workerpool
```

Then create `main.go` and start writing code. From this point on every example assumes the import is in place; we will not repeat it.

---

## Your First Pool

Here is the smallest meaningful `workerpool` program. Read it once, then we will dissect every line.

```go
package main

import (
    "fmt"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(3)
    defer pool.StopWait()

    for i := 0; i < 10; i++ {
        i := i // shadow to avoid loop-capture bug
        pool.Submit(func() {
            fmt.Printf("task %d on worker\n", i)
        })
    }
}
```

What this does, step by step:

1. `workerpool.New(3)` creates a pool with a maximum of 3 concurrent workers. Importantly, it does **not** spawn 3 worker goroutines right away. It spawns the dispatcher and waits for work.
2. The `defer pool.StopWait()` arranges for clean shutdown: when `main` returns, all 10 submitted tasks are guaranteed to have run.
3. The loop submits 10 closures. Each closure prints its index. The `i := i` line is essential. Without it, every closure would see the *same* `i`, captured by reference, and the program would print `task 10 on worker` (or whatever the loop's final value is) ten times. Since Go 1.22, the `for` loop variable is scoped per-iteration and you can omit this shadow; for older code, keep it.
4. Behind the scenes the dispatcher hands tasks to workers. Workers run them. With `maxWorkers = 3`, at most 3 tasks run at the same time, even though 10 are submitted.
5. When `main` returns, `defer pool.StopWait()` fires. It signals the dispatcher to stop accepting new work, drains the queue (the remaining tasks all finish), and blocks until every worker goroutine has exited.

If you run this program multiple times you will see the output order vary — task 0 might appear after task 7, for instance — but you will always see all 10 tasks print. That is the contract: every submitted task runs unless the pool was hard-stopped with `Stop()` (not `StopWait()`).

Things to notice that are *not* obvious from the code:

- There is no `wg.Add(1)` / `wg.Done()` boilerplate. The pool itself tracks pending tasks.
- There is no explicit queue size. The internal queue grows as needed.
- There is no channel anywhere in user code. The library hides them.
- The pool object is safe to use from a single goroutine; you do not need a mutex around your loop.

This is the program you will write 80% of the time. The remaining 20% are variations: waiting on a single task with `SubmitWait`, polling `Stopped`, capturing return values via closures, etc. We will cover those next.

---

## The Two Things You Will Use 95% of the Time

If you remember only two methods from this chapter, remember:

1. `pool.Submit(func() { ... })` — schedule a task; do not wait.
2. `pool.StopWait()` — drain everything and clean up before the program (or function) exits.

Everything else in the API is a variation on these. The library is intentionally small.

The other methods, in rough order of how often you will reach for them at junior level:

- `pool.SubmitWait(func() { ... })` — schedule and block until it finishes. Used for "one final task before shutdown" or "I want to apply backpressure on this submit call".
- `pool.Stop()` — abandon any unstarted tasks but let running tasks finish.
- `pool.Stopped() bool` — check whether the pool has been told to stop.
- `pool.WaitingQueueSize() int` — how many tasks are queued but not yet started.
- `pool.Pause(ctx) / pool.Pause(ctx)` — pause the pool until a context is cancelled (newer API; not always present).

We will not use `Pause` at the junior level; it is uncommon enough that it lives in the middle file.

---

## Submit

The full signature is:

```go
func (p *WorkerPool) Submit(task func())
```

Three things to note:

1. **It takes a `func()` with no arguments and no return value.** If you need arguments, capture them in a closure. If you need a result, write the result somewhere your other code can read it.
2. **It never blocks for long.** Internally the dispatcher forwards the task to a worker through a channel; if no worker is ready, the task goes onto an unbounded queue inside the dispatcher. The user-facing `Submit` returns almost immediately.
3. **It does not return an error.** If the pool is stopped, `Submit` is a no-op. (This is a surprise the first time you hit it; we will revisit it under *Common Mistakes*.)

A typical pattern is "submit in a tight loop":

```go
for _, job := range jobs {
    job := job
    pool.Submit(func() {
        process(job)
    })
}
pool.StopWait()
```

The loop runs as fast as `pool.Submit` can hand off, which is microseconds per call. With 100,000 jobs and a tiny `process` function, the loop finishes in milliseconds — but the *work itself* still takes whatever it takes. That is the point of decoupling submission from execution.

### Capturing values

The closure pattern is the only way to pass arguments. Three correct styles:

```go
// Style 1: shadow the variable inside the loop body
for i := 0; i < 10; i++ {
    i := i
    pool.Submit(func() { fmt.Println(i) })
}

// Style 2: pass through a parameterised helper
for i := 0; i < 10; i++ {
    pool.Submit(makePrint(i))
}
func makePrint(i int) func() { return func() { fmt.Println(i) } }

// Style 3: rely on Go 1.22+ per-iteration scoping
// (only on go1.22 and toolchain directive in go.mod)
for i := 0; i < 10; i++ {
    pool.Submit(func() { fmt.Println(i) })
}
```

The wrong style — and the one you will write at least once — is:

```go
// BUG: every closure shares the same i. On pre-1.22 Go this prints 10 ten times.
for i := 0; i < 10; i++ {
    pool.Submit(func() { fmt.Println(i) })
}
```

If you are on Go 1.22 or newer, the wrong style is the right style; the language fixed it. If you target older Go (or anything compiled with `go1.21` and earlier in `go.mod`), you must shadow.

### Submit does not return anything

A common new-user reflex:

```go
// Does not compile. Submit has no return value.
result, err := pool.Submit(doWork)
```

`Submit` is fire-and-forget. To get a result, write the result inside the closure to a channel, a slice, or a shared variable protected by a lock. Examples appear under [Coding Patterns](#coding-patterns).

### Submit and the dispatcher

A point that confuses people who have written their own pools: with `workerpool`, `Submit` does *not* send directly to a worker channel. It sends to a small input channel read by the dispatcher goroutine, which then forwards to an idle worker (or queues for later). This indirection is invisible at junior level but matters for performance — see the senior file.

---

## Stop

`Stop` and `StopWait` both shut the pool down, but they differ in what they do with pending work.

```go
func (p *WorkerPool) Stop()
func (p *WorkerPool) StopWait()
```

The contract:

| Method | Already-running tasks | Queued, not-started tasks | Returns when |
|--------|------------------------|--------------------------|--------------|
| `Stop` | Allowed to finish | Discarded | All running tasks finish |
| `StopWait` | Allowed to finish | All run to completion | The queue is empty and all workers exit |

In other words:

- `StopWait` is "graceful shutdown". Use it when you want every submitted task to run.
- `Stop` is "drain in flight, drop the rest". Use it when you no longer care about queued work — e.g. a server caught a SIGTERM and you want to exit fast.

Both methods are **idempotent**: calling either one twice does nothing the second time. After `Stop` or `StopWait`, the pool is permanently dead. You cannot revive it. Create a new one if you need it.

Calling `Submit` after `Stop` is silently ignored. The task is dropped. This is sometimes a feature (no panic, no error to propagate) and sometimes a bug source (you assume the task ran). At junior level, the rule is: never `Submit` after you have `Stop`-ed.

### Why `defer pool.StopWait()` is the safe default

When you are starting out, prefer:

```go
pool := workerpool.New(N)
defer pool.StopWait()
// ... submit tasks ...
```

This pattern guarantees:

1. Every submitted task runs (no silent dropping).
2. The function returning does not leak the dispatcher or worker goroutines.
3. You do not have to remember to call `StopWait` on every code path.

The only time to deviate is when you have an explicit reason to drop unstarted work — typically inside a signal handler.

---

## A Complete First Program

Let us put everything together and write a small but complete program. Goal: download 20 URLs with at most 4 concurrent fetches, then print which finished fastest.

```go
package main

import (
    "fmt"
    "io"
    "net/http"
    "sync"
    "time"

    "github.com/gammazero/workerpool"
)

type result struct {
    url     string
    bytes   int
    elapsed time.Duration
    err     error
}

func main() {
    urls := []string{
        "https://example.com",
        "https://example.org",
        "https://golang.org",
        "https://pkg.go.dev",
        "https://www.google.com",
        // ... imagine 20 of these
    }

    pool := workerpool.New(4)
    defer pool.StopWait()

    var mu sync.Mutex
    var results []result

    for _, u := range urls {
        u := u
        pool.Submit(func() {
            r := fetch(u)
            mu.Lock()
            results = append(results, r)
            mu.Unlock()
        })
    }

    pool.StopWait() // drain explicitly so we can read results below

    for _, r := range results {
        if r.err != nil {
            fmt.Printf("%-30s ERROR %v\n", r.url, r.err)
            continue
        }
        fmt.Printf("%-30s %6d bytes in %s\n", r.url, r.bytes, r.elapsed)
    }
}

func fetch(url string) result {
    start := time.Now()
    resp, err := http.Get(url)
    if err != nil {
        return result{url: url, err: err}
    }
    defer resp.Body.Close()
    body, err := io.ReadAll(resp.Body)
    return result{
        url:     url,
        bytes:   len(body),
        elapsed: time.Since(start),
        err:     err,
    }
}
```

Important details:

- We call `pool.StopWait()` **twice**: once explicitly (so we know all tasks have finished before reading `results`), and once via `defer` (a no-op the second time, but it does not hurt). If you find that pattern awkward, drop the `defer` and rely on the explicit call.
- The shared `results` slice is protected by a `sync.Mutex`. The pool does *not* serialise tasks for you; multiple workers run truly concurrently, and any state they touch must be guarded.
- `u := u` is the loop-shadow line you must not forget on pre-1.22 Go.
- No tasks ever block on a channel here, so we did not need `SubmitWait`. With `Submit`, the loop fills the queue at memory speed and the dispatcher feeds workers as they become free.

Run this and you will see 4 fetches happen in parallel, with new fetches starting as old ones complete, until all 20 are done. The total wall-clock time will be roughly `total_work / 4` — exactly what a pool is supposed to give you.

---

## Real-World Analogies

### A library check-out desk

A library has 3 staff members at the check-out counter. Anyone can drop a request in the "Please Process" tray; the tray itself is huge, with effectively unlimited slots. As soon as a staff member finishes one request, they grab the next from the tray. When the library closes, you can either: (a) let everyone currently being served finish but turn the tray away (`Stop`), or (b) process every last item in the tray before locking the doors (`StopWait`).

Mapping to the library:

- Staff = workers (capped at `maxWorkers`)
- Tray = internal task queue (unbounded)
- Dropping a request = `Submit`
- "Closing time, let people finish" = `Stop`
- "Closing time, process every form already in the tray" = `StopWait`

### A toll booth

A highway entrance has 6 toll booths. Cars arrive at random; they queue in a single line and are routed to the first free booth. The number of booths is fixed; the queue grows or shrinks. When traffic dies down at 3 a.m. and no car has arrived for 2 seconds, some booths close (the idle reaper). When the first car of the morning arrives, a booth opens again.

This analogy is closer than the library one because it captures the *idle reaping* behaviour. `workerpool` does not keep `maxWorkers` goroutines alive forever — only as many as are needed right now, capped at `maxWorkers`.

### A restaurant kitchen

The maximum number of dishes that can be cooking simultaneously is the number of cooks. New orders pile up on the order spike. Each cook grabs the next slip when they finish the current dish. The order spike has effectively unlimited capacity (paper is cheap); the cooks are the bottleneck. If the kitchen closes mid-shift:

- "Soft close" (`Stop`) — finish what is on the stove, throw away the order spike.
- "Full close" (`StopWait`) — cook every order on the spike, then lock the doors.

---

## Mental Models

### Model 1: A single channel with `maxWorkers` readers

The simplest mental model — and one that gets you 80% of the way — is a `chan func()` with `maxWorkers` goroutines each running `for task := range ch { task() }`. The actual library is slightly more elaborate because of the dispatcher, but the *behaviour* you see from outside is indistinguishable from this model.

```
                        ┌─ worker 1 ─┐
Submit(f) ─→ chan f ─→ │   worker 2  │ → f()
                        └─ worker 3 ─┘
                              ...
                              max
```

This model gets two things wrong:

1. There is no buffered channel large enough to hold "millions of pending tasks". The dispatcher uses a linked list of small slices for that.
2. Workers do not live forever; they exit after 2 seconds of idleness.

But for understanding `Submit` and `Stop`, the model is fine.

### Model 2: A semaphore around `go f()`

Another way to think about it: you have a semaphore of capacity `maxWorkers`. Every time you submit, you acquire a slot, run the task, and release the slot. If no slot is available, the task queues. This model is close to how `tunny` works — and it explains why `tunny`'s submit blocks. With `workerpool`, the queue is in front of the semaphore, not in your caller, so submission does not block. Same logical result, different ergonomics.

### Model 3: A traffic shaper

You have a firehose of work and a small pipe at the end. The pool is a shock absorber: it accepts everything you throw at it (bounded only by RAM) and meters it out to the actual workers at a controlled rate. The depth of the queue tells you how far behind you are. If the queue keeps growing, the producers are outrunning the consumers and you have a capacity problem.

This is the most useful model in production: it focuses your attention on queue depth, which is the leading indicator of trouble. `pool.WaitingQueueSize()` exposes this exact number.

### Model 4: A function that *eventually* runs your code

Treat `pool.Submit(f)` as "f runs at some point in the next few milliseconds, on some goroutine I cannot name, possibly after several other tasks I just submitted". You make no assumptions about *when* or *where*. The only guarantee is: it runs at most `maxWorkers` at a time, and it definitely runs before `StopWait` returns.

This minimal mental model is the one you should leave with after the junior file.

---

## Pros and Cons

### Pros

- **Tiny API.** Five core methods you can memorise in 10 minutes: `New`, `Submit`, `SubmitWait`, `Stop`, `StopWait`.
- **Zero configuration to get started.** No buffer sizes, no idle timeouts to tune. The defaults are sane.
- **Submit (almost) never blocks.** Your producer loops run at memory speed, decoupled from work speed.
- **Workers reap themselves when idle.** A pool that has done no work for 2 seconds shrinks to zero, returning memory to the runtime.
- **Drop-in replacement for hand-rolled `chan func() + N goroutines`.** Reading code that uses it is instantly obvious to any Go developer.
- **No CGo, no unsafe, no reflection.** The library is pure Go and easy to audit (< 400 lines including tests).
- **Stable.** The API has barely changed in five years; v1.x is essentially frozen in feature scope.

### Cons

- **Unbounded internal queue.** If your producer outruns the workers, the queue grows. There is no way to set a hard cap on queued tasks; you must enforce it yourself.
- **`func()` only.** No generics, no result types, no input arguments without closures. Every task allocates a closure (cheap but not free).
- **One channel send per task.** The dispatcher forwards every `Submit` through a channel, costing ~100–300 ns per task. At one million tasks per second this becomes the bottleneck. `ants` is faster.
- **No per-task error handling.** If your task panics, the pool recovers it silently (in recent versions) but does not give you the panic value.
- **No backpressure on submit.** If you want submission to block when the queue is full, you have to wrap the pool yourself.
- **No metrics out of the box.** `WaitingQueueSize` is the only observable; everything else you instrument by hand.
- **No context support.** Tasks cannot natively check "should I cancel?" — you have to thread a `context.Context` through the closure yourself.

These limitations are not bugs; they are the price of the small API. When the cons start to bite, you migrate to `ants` (for speed and configurability) or roll your own (for tight integration with metrics, contexts, and lifecycle).

---

## Use Cases

### Good fits

- **HTTP fan-out.** "I need to call 200 backend services and aggregate the results, max 30 in flight." Classic worker-pool use case.
- **Batch image / file processing.** "Resize 5,000 images, max 8 at a time (because I have 8 cores)."
- **Log line transformation.** "Parse and enrich each log line; 4 cores worth of CPU; producer reads from a file faster than consumers process."
- **Webhook delivery.** "Deliver N pending webhooks, max 20 simultaneous outbound POSTs."
- **Database row enrichment.** "For each row from the query, call out to an enrichment service. Max 50 concurrent calls."
- **Test harness.** "Run 1,000 test cases against a service, max 10 concurrent."

### Poor fits

- **Tasks that need a result synchronously.** Use `SubmitWait` if you must, but a single-task pool is overkill. Consider just calling the function directly.
- **Stateful workers.** If each worker needs to hold a connection, a cached compiled regex, a CGo handle, etc., use `tunny`. `workerpool` does not let you initialise workers with per-worker state.
- **Latency-critical hot paths.** A per-task channel send is fine for milliseconds-scale work but visible if your task is sub-microsecond. Use `ants` or inline the work.
- **Producers that vastly outrun consumers without backpressure.** The unbounded queue will eventually OOM. Use a bounded `chan` or a semaphore-style pool.
- **Million-task-per-second pipelines.** Use `ants` or a custom design.
- **Anything where you need cancellation.** Wrap with `context.Context` or use a library with built-in support.

The honest summary: `workerpool` is the right answer for "I want a pool" 70% of the time. The other 30% you should know about the alternatives.

---

## Code Examples

### Example 1: Hello, pool

```go
package main

import (
    "fmt"
    "time"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(2)
    defer pool.StopWait()

    for i := 1; i <= 5; i++ {
        i := i
        pool.Submit(func() {
            time.Sleep(100 * time.Millisecond)
            fmt.Printf("done: %d\n", i)
        })
    }
}
```

Expected behaviour: at any instant at most 2 tasks are sleeping. Total wall-clock time ~300ms (5 tasks / 2 workers, rounded up).

### Example 2: Different task durations

```go
package main

import (
    "fmt"
    "math/rand"
    "time"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(3)
    defer pool.StopWait()

    for i := 0; i < 10; i++ {
        i := i
        d := time.Duration(rand.Intn(500)) * time.Millisecond
        pool.Submit(func() {
            time.Sleep(d)
            fmt.Printf("task %d took ~%s\n", i, d)
        })
    }
}
```

This makes obvious that workers do not stay paired with the tasks they started; a fast task lets its worker pick up another job while slow tasks are still running.

### Example 3: Accumulating results safely

```go
package main

import (
    "fmt"
    "sync"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(4)

    var mu sync.Mutex
    sum := 0

    for i := 1; i <= 100; i++ {
        i := i
        pool.Submit(func() {
            mu.Lock()
            sum += i
            mu.Unlock()
        })
    }

    pool.StopWait()
    fmt.Println("sum =", sum) // 5050
}
```

Two takeaways:

1. The pool does *not* serialise tasks; you must lock shared state.
2. `pool.StopWait()` is called **before** reading `sum`, so we know every task has run.

### Example 4: Accumulating with a channel instead of a mutex

```go
package main

import (
    "fmt"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(4)
    results := make(chan int, 100)

    for i := 1; i <= 100; i++ {
        i := i
        pool.Submit(func() {
            results <- i
        })
    }

    pool.StopWait()
    close(results)

    sum := 0
    for v := range results {
        sum += v
    }
    fmt.Println("sum =", sum) // 5050
}
```

The channel is buffered with capacity equal to the task count, so no `Submit`-closure ever blocks. If the channel were unbuffered, `Submit` would still return quickly but each worker would block on the send until something drained it.

### Example 5: Error collection with closures

```go
package main

import (
    "errors"
    "fmt"
    "sync"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(2)

    var mu sync.Mutex
    var errs []error

    for i := 1; i <= 5; i++ {
        i := i
        pool.Submit(func() {
            if err := work(i); err != nil {
                mu.Lock()
                errs = append(errs, err)
                mu.Unlock()
            }
        })
    }

    pool.StopWait()

    fmt.Println("errors:", errs)
}

func work(i int) error {
    if i%2 == 0 {
        return fmt.Errorf("task %d failed: %w", i, errors.New("simulated"))
    }
    return nil
}
```

### Example 6: A pool with a long-lived program

```go
package main

import (
    "fmt"
    "time"

    "github.com/gammazero/workerpool"
)

var pool = workerpool.New(8)

func main() {
    go produce()
    time.Sleep(5 * time.Second)
    pool.StopWait()
    fmt.Println("shutdown complete")
}

func produce() {
    i := 0
    for {
        if pool.Stopped() {
            return
        }
        i := i
        pool.Submit(func() {
            time.Sleep(10 * time.Millisecond)
            _ = i
        })
        i++
        time.Sleep(time.Millisecond)
    }
}
```

The producer checks `pool.Stopped()` before each submit. Without that check, `produce` would loop forever after `StopWait`, since `Submit` is silently dropped post-shutdown.

### Example 7: Computing a count of submitted tasks

```go
package main

import (
    "fmt"
    "sync/atomic"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(4)

    var done int64
    for i := 0; i < 1000; i++ {
        pool.Submit(func() {
            atomic.AddInt64(&done, 1)
        })
    }

    pool.StopWait()
    fmt.Println("ran", atomic.LoadInt64(&done), "tasks") // 1000
}
```

`atomic.AddInt64` is the right tool here. A mutex would also work but is heavier.

### Example 8: Submitting from inside a task (allowed)

```go
package main

import (
    "fmt"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(2)

    pool.Submit(func() {
        fmt.Println("outer task")
        pool.Submit(func() {
            fmt.Println("inner task")
        })
    })

    pool.StopWait()
}
```

It is legal to submit from inside a running task. Be careful, though: if the inner task blocks waiting for the outer task to do something, you can deadlock (the outer task is occupying a worker slot that the inner task might be waiting on).

### Example 9: Working through a slice in chunks

```go
package main

import (
    "fmt"
    "sync/atomic"

    "github.com/gammazero/workerpool"
)

func main() {
    data := make([]int, 1000)
    for i := range data {
        data[i] = i
    }

    pool := workerpool.New(4)

    const chunk = 100
    var sum int64

    for start := 0; start < len(data); start += chunk {
        start := start
        end := start + chunk
        if end > len(data) {
            end = len(data)
        }
        pool.Submit(func() {
            local := int64(0)
            for _, v := range data[start:end] {
                local += int64(v)
            }
            atomic.AddInt64(&sum, local)
        })
    }

    pool.StopWait()
    fmt.Println("sum =", sum) // 499500
}
```

Chunking gives you control over per-task cost. Each task here processes 100 ints; with 1000 ints total and 4 workers you get 10 tasks running at most 4 at a time. The atomic-add fold avoids contention.

### Example 10: Pool inside a function

```go
package main

import (
    "fmt"

    "github.com/gammazero/workerpool"
)

func processAll(items []int) {
    pool := workerpool.New(3)
    defer pool.StopWait()

    for _, item := range items {
        item := item
        pool.Submit(func() {
            fmt.Println("processing", item)
        })
    }
}

func main() {
    processAll([]int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10})
}
```

Per-function pools are perfectly fine for batch jobs. Just remember that `New` does have a tiny setup cost (spawning the dispatcher); for tasks under, say, 1µs, the setup might dominate.

---

## Coding Patterns

### Pattern 1: Producer-consumer with backpressure-by-submitwait

When you want submission to *slow down* if workers fall behind, replace `Submit` with `SubmitWait`. We will cover this in detail in the middle file, but the shape is:

```go
for _, x := range hugeStream {
    pool.SubmitWait(func() { process(x) })
}
```

This serialises submission: the loop only iterates as fast as workers can drain. You lose the unbounded buffer, gain backpressure.

### Pattern 2: Fan-out / fan-in

```go
out := make(chan Result, len(input))
for _, x := range input {
    x := x
    pool.Submit(func() {
        out <- compute(x)
    })
}
pool.StopWait()
close(out)
for r := range out {
    // consume
}
```

The "fan-out" is the pool; "fan-in" is the channel and the final loop.

### Pattern 3: Error-on-first-fail

```go
var firstErr error
var once sync.Once
for _, item := range items {
    item := item
    pool.Submit(func() {
        if err := work(item); err != nil {
            once.Do(func() { firstErr = err })
        }
    })
}
pool.StopWait()
if firstErr != nil {
    return firstErr
}
```

Note: `sync.Once.Do` ensures only the first error is captured. All tasks still run; we do not have a "stop everything" channel here. If you want early cancellation, use a `context.Context` (middle file).

### Pattern 4: Bounded queue via semaphore

```go
sem := make(chan struct{}, 100) // cap of 100 pending
for _, item := range items {
    sem <- struct{}{} // blocks if queue is "full"
    item := item
    pool.Submit(func() {
        defer func() { <-sem }()
        work(item)
    })
}
pool.StopWait()
```

This wraps `workerpool` with a hand-rolled bound on pending tasks. The producer blocks when the queue fills, which is the backpressure you wanted. We will cover variants of this in the senior file.

### Pattern 5: One-shot fire on a long-running pool

If the same pool serves many short jobs over the program lifetime, do not create a new pool per job:

```go
// at package init
var pool = workerpool.New(runtime.NumCPU())

// per request
func handle(req Request) {
    pool.Submit(func() { process(req) })
}

// at program shutdown
func shutdown() {
    pool.StopWait()
}
```

This amortises the dispatcher and worker creation cost over every request. The idle-worker reaper still kicks in during quiet periods, so the pool does not hold a thread per worker forever.

### Pattern 6: Two pools for two workload classes

If you have CPU-bound and I/O-bound work mixed together, split into two pools:

```go
var cpuPool = workerpool.New(runtime.NumCPU())
var ioPool  = workerpool.New(64)
```

CPU work uses `cpuPool` (where it cannot starve I/O work because they share no workers). I/O work uses `ioPool` with a higher cap. This is a more general principle that applies to every pool library; we revisit it in the professional file.

---

## Clean Code

A few naming and structural conventions make `workerpool` code easy to read.

### Name pools by their role

Not `pool`. Not `wp`. Use:

```go
var imageResizePool = workerpool.New(8)
var webhookDeliveryPool = workerpool.New(32)
var dbEnrichPool = workerpool.New(50)
```

The name appears in stack traces (when you `runtime.Goroutine()`-dump in debug) and in metrics labels. A descriptive name pays back many times.

### Wrap the pool in a domain type

For non-trivial code, hide the pool behind a struct so callers do not see `workerpool.WorkerPool` everywhere:

```go
type Resizer struct {
    pool *workerpool.WorkerPool
}

func NewResizer(max int) *Resizer {
    return &Resizer{pool: workerpool.New(max)}
}

func (r *Resizer) Submit(img Image) {
    r.pool.Submit(func() { r.resize(img) })
}

func (r *Resizer) Close() {
    r.pool.StopWait()
}
```

This gives you a single place to add metrics, logging, or migrate away from `workerpool` later.

### Always pair `New` and `StopWait`

Just like `os.Open` and `Close`, `bufio.NewWriter` and `Flush`, `*workerpool.WorkerPool` has a lifecycle. The pattern is:

```go
pool := workerpool.New(N)
defer pool.StopWait()
```

If you write `workerpool.New` and you do not also write either `StopWait`, `Stop`, or a `defer`, it is almost certainly a bug.

### Do not declare a global pool unless you need one

A pool at package level outlives any single function. That is sometimes what you want (long-running service); often it is over-engineering. Prefer a function-local pool when the work has a clear start and end.

### Keep tasks short

A task that runs for hours is a *job* that should live as its own goroutine outside the pool. Pools are best for many small to medium tasks. Long tasks hold a worker slot and starve everything else; if you have 8 workers and submit 8 hour-long tasks, the next task waits an hour.

### Do not modify the task closure after Submit

Once you have called `pool.Submit(f)`, the closure `f` belongs to the pool. Do not mutate any variables `f` captures from the outside; you are racing the workers. This is the same rule as any goroutine, just easy to forget when the goroutine is hidden inside a library.

---

## Product Use

A small tour of where `workerpool` shows up in real codebases.

### CLI tools

Tools like file transcoders, bulk uploaders, or "fix every file in this repo" scripts use a pool to parallelise without overwhelming the disk or the API. The pattern is identical to Example 10: per-`main` pool, defer `StopWait`, submit in a loop.

### HTTP servers (sparingly)

Some HTTP handlers spawn helpers — sending a webhook, indexing a document, transcoding an upload. Wrapping these in a pool keeps the server from spawning unbounded goroutines under load. The pool here is typically a package-level singleton.

A caution: do not put *the handler itself* in a pool unless you really know what you are doing. The standard `net/http` server already manages goroutines per connection. Pooling them creates a second scheduler layer that fights with `net/http`'s. The pool is for **secondary work** kicked off from inside the handler.

### Pipelines

ETL-style code reads from one source, transforms, writes to another. Pools are great for the middle stage. Example: read CSV rows → enrich each row by calling a service (pooled) → write to a database. The pool bounds concurrent service calls.

### Test helpers

`go test` benchmarks and integration tests sometimes need "do X concurrently". `workerpool` is great here because the setup is trivial and you do not need to keep a long-running pool around between tests.

---

## Error Handling

`workerpool` does not return errors from `Submit`. It does not capture errors from your task. There are two reasons:

1. The library is built on `func()` with no return type, so an error has nowhere to go.
2. The pool has no general policy on what to do with an error (retry? log? abort?). Forcing one on you would limit usefulness.

So error handling is your job. The patterns:

### Capture error in a closure

```go
var firstErr error
var mu sync.Mutex
for _, item := range items {
    item := item
    pool.Submit(func() {
        if err := process(item); err != nil {
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
```

### Send errors on a channel

```go
errs := make(chan error, len(items))
for _, item := range items {
    item := item
    pool.Submit(func() {
        if err := process(item); err != nil {
            errs <- err
        }
    })
}
pool.StopWait()
close(errs)

for err := range errs {
    // log, return, aggregate...
}
```

### Collect into a slice

```go
var mu sync.Mutex
var errs []error
for _, item := range items {
    item := item
    pool.Submit(func() {
        if err := process(item); err != nil {
            mu.Lock()
            errs = append(errs, err)
            mu.Unlock()
        }
    })
}
pool.StopWait()
```

Pair with `errors.Join` (Go 1.20+) to return them as one:

```go
return errors.Join(errs...)
```

### What about panics?

The current `workerpool` versions recover panics inside the dispatcher loop so a panicking task does not kill the whole pool. **But** they do not give you the panic value back; it is lost. If you care, wrap your task:

```go
pool.Submit(func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("task panic: %v", r)
        }
    }()
    risky()
})
```

We will dig deeper into panic recovery in the middle file.

---

## Security Considerations

`workerpool` is a concurrency primitive, not an authentication or authorisation layer. There are two security-adjacent concerns worth knowing about.

### Resource exhaustion via unbounded queue

Because the internal queue has no size limit, an attacker (or a buggy producer) can submit faster than workers drain. The queue grows in memory until you OOM. If the pool sits behind a network endpoint that accepts untrusted input, you **must** add a bound. Patterns:

- Rate limit the producer.
- Wrap `Submit` in a semaphore (see Pattern 4 above).
- Drop tasks if `pool.WaitingQueueSize()` exceeds a threshold.
- Use a bounded library like `ants.NewPool(N, ants.WithNonblocking(true))` which fails fast on backpressure.

### Information leak via task closures

A task closure captures variables from the surrounding scope. If you `Submit` a task that captures a secret (token, password) and the task panics, in some setups the recover may print the closure's captured state to a log. Audit what your tasks capture. Prefer to pass scrubbed copies of structs into the closure.

### Goroutine fingerprinting

`runtime.Stack` (used by some debug endpoints) prints every goroutine including the captured function for each worker. The pool's workers show up as anonymous closures inside `workerpool`. This is harmless but worth knowing if you turn on `net/http/pprof` on a public endpoint: do not, full stop.

### Denial of service via slow tasks

A single slow task holds a worker slot for as long as it runs. With small `maxWorkers`, eight slow tasks block the pool entirely. If a slow task hits a remote service that hangs, you must give your tasks **timeouts** — use `context.WithTimeout` and respect it inside the task body. The pool will not time them out for you.

---

## Performance Tips

We will go much deeper in the senior and professional files; here are starter rules:

### Pick `maxWorkers` based on workload kind

- **CPU-bound:** `runtime.NumCPU()` (or `GOMAXPROCS`). More workers than cores wastes context switches.
- **I/O-bound (network, disk):** Much larger — typically 10–100× `NumCPU`. The bottleneck is the I/O, not the CPU.
- **Mixed:** Either split into two pools, or pick the I/O number. Pure-CPU tasks will rarely fully utilise more cores than they can.

### Avoid per-task allocation if possible

Each `pool.Submit(func() { ... })` allocates the closure on the heap. That is a couple of dozen bytes. For most workloads, irrelevant. For micro-tasks at millions per second, it shows up in pprof. If you find yourself measuring closure allocation cost, look at `sync.Pool` for the inputs or switch to `ants.NewPoolWithFunc` which lets you submit `interface{}` arguments to a pre-bound function (no closure per task).

### Do not over-pool

If your task takes 50µs and you submit 10 of them, just `go func() { task(); wg.Done() }()` is fine. A pool is for *many* tasks, where worker reuse pays off.

### Watch `WaitingQueueSize`

If the queue keeps growing, either your producer is too fast or your worker count is too small. Both call for capacity changes. Track this metric in prod.

### Reuse a single pool across requests

In a server, do not create `workerpool.New(N)` inside each request handler. Initialise once at startup, share across handlers. Pool creation is cheap but not free, and the dispatcher goroutine is per-pool.

---

## Best Practices

A compressed checklist:

1. **Always `defer pool.StopWait()` (or call it explicitly).** Never leak a pool.
2. **Always shadow loop variables on pre-Go-1.22.** `i := i`.
3. **Pick `maxWorkers` deliberately.** No magic numbers without a comment.
4. **Treat the queue as state.** Monitor `WaitingQueueSize` if the pool lives long.
5. **Bound the queue if accepting untrusted input.**
6. **Give tasks timeouts.** Pools do not time out tasks for you.
7. **Recover panics inside the task** if you need the panic value.
8. **Wrap the pool in a domain type** for non-trivial code.
9. **Do not assume task ordering.** Tasks finish in the order they finish, not the order you submitted them.
10. **Test shutdown paths.** Most pool bugs hide in the "shutdown while submitting" code path. Write a test for it.

---

## Edge Cases and Pitfalls

### Submitting after Stop

```go
pool := workerpool.New(2)
pool.Stop()
pool.Submit(func() { fmt.Println("never runs") }) // silently dropped
```

No panic, no error. The task is dropped. If you need to know whether the submission "took", check `pool.Stopped()` first.

### Stop before any task ran

```go
pool := workerpool.New(2)
pool.Stop()
// pool was never used. No goroutines leak; the dispatcher exits.
```

`workerpool` is safe to create and immediately stop.

### Stop versus StopWait when the queue is long

```go
pool := workerpool.New(2)
for i := 0; i < 1_000_000; i++ {
    i := i
    pool.Submit(func() { time.Sleep(time.Millisecond); _ = i })
}
pool.Stop() // drops 999_998 unstarted tasks; quick
// vs.
pool.StopWait() // takes ~500 seconds
```

This is the most important behavioural difference.

### Capture-by-reference loop variable (pre-Go 1.22)

```go
for i := 0; i < 5; i++ {
    pool.Submit(func() { fmt.Println(i) }) // prints "5" five times
}
```

Same bug as with any goroutine. Shadow `i`.

### Pool created in a function, not shut down

```go
func badProcess(items []int) {
    pool := workerpool.New(4)
    for _, item := range items {
        item := item
        pool.Submit(func() { process(item) })
    }
    // missing StopWait. Worker goroutines + dispatcher leak.
}
```

This leaks the dispatcher and any active workers. Always `defer pool.StopWait()`.

### Closing the result channel from inside a task

```go
results := make(chan int)
for i := 0; i < 10; i++ {
    i := i
    pool.Submit(func() {
        results <- i
        if i == 9 { close(results) } // RACE — close while others still send
    })
}
```

Wrong. Close the channel **after** `pool.StopWait()`, not from inside a task. Otherwise other workers may still be writing.

### Mixing pools and explicit wg.Wait

```go
var wg sync.WaitGroup
for _, item := range items {
    wg.Add(1)
    item := item
    pool.Submit(func() {
        defer wg.Done()
        work(item)
    })
}
wg.Wait()
pool.StopWait()
```

This is *correct* — and sometimes useful when you want to know "all my tasks done" before draining the pool. But many newcomers add `wg` thinking it is required. It is not; `pool.StopWait()` alone is enough to know all currently-submitted tasks have finished.

### Reusing a stopped pool

```go
pool := workerpool.New(4)
pool.StopWait()
pool.Submit(...) // silently dropped, no error
```

A stopped pool is dead. `New` again if you need more.

### `Submit` with a `nil` func

```go
pool.Submit(nil)
```

The dispatcher will try to call `nil()` on a worker, which panics. Recent versions recover, but the task is "lost". Do not submit nil.

### Pool sized 0

```go
pool := workerpool.New(0)
```

The library normalises this to 1 (or sometimes 1 depending on version; check the spec file). It is undefined behaviour for production use; do not rely on it.

---

## Common Mistakes

### 1. Forgetting StopWait

Symptom: tests pass, production leaks goroutines slowly over time.

Fix: `defer pool.StopWait()` immediately after `pool := workerpool.New(N)`.

### 2. Reading results before StopWait

```go
pool := workerpool.New(4)
var results []int
for _, x := range xs {
    x := x
    pool.Submit(func() { results = append(results, work(x)) })
}
fmt.Println(results) // empty!
pool.StopWait()
```

Fix: read results after `StopWait`. Or use channels and read them in a loop.

### 3. Mutating shared state without a lock

```go
var count int
for i := 0; i < 100; i++ {
    pool.Submit(func() { count++ }) // race
}
```

Run with `go run -race .` and you will see the race. Fix: use `atomic.AddInt64` or a mutex.

### 4. Captured loop variable (pre-1.22)

Already covered.

### 5. Calling Stop instead of StopWait when you wanted "drain"

```go
pool.Stop() // throws away unstarted tasks
```

Symptom: random missing results. Fix: use `StopWait` unless you genuinely want to discard.

### 6. Pool per request

Creating a fresh pool inside every HTTP handler defeats the point. The pool's worker goroutines are created once and reused; that benefit goes away if you create and stop one per request.

Fix: shared pool at package init.

### 7. Submitting from many goroutines, expecting no race

```go
pool := workerpool.New(4)
for w := 0; w < 10; w++ {
    go func() {
        for _, x := range data {
            x := x
            pool.Submit(func() { work(x) })
        }
    }()
}
```

This is *legal* — `Submit` is goroutine-safe. The mistake is the shared `data` if it is being mutated. Audit the closures.

### 8. Returning an error from Submit (it cannot)

```go
err := pool.Submit(func() { ... }) // compile error
```

Fix: read the docs.

### 9. Pool size of 1

```go
pool := workerpool.New(1)
```

A pool of size 1 is just a serialised queue. Sometimes that is what you want. More often it is a left-over from a debug experiment.

### 10. Forgetting that Submit is unbounded

Producing into the pool faster than workers consume grows memory forever. If you have ever had a memory leak that "started slow but eventually OOM-ed", a `workerpool` with an unbounded queue is a candidate.

---

## Common Misconceptions

### "Submit is synchronous"

No. `Submit` returns as soon as the task is queued, not when it is finished. Use `SubmitWait` for synchronous behaviour.

### "Stop waits for tasks to finish"

No. `Stop` discards unstarted tasks. `StopWait` is the "wait" variant.

### "The pool tracks errors for me"

No. `func()` has no error return. You collect errors yourself.

### "Tasks run in submission order"

No. Tasks are scheduled to whichever worker is free first. Even with `maxWorkers = 1`, the order is *roughly* preserved but not guaranteed across all versions; for strict ordering, use a single goroutine reading from a channel.

### "I can use the pool after Stop"

No. After `Stop` or `StopWait`, the pool is permanently dead.

### "The library limits the queue"

No. The queue is unbounded by design.

### "Workers stay alive until I call Stop"

No. Workers exit after 2 seconds of idleness. A pool that has been quiet for a while shows zero worker goroutines (just the dispatcher).

### "Goroutines inside tasks count toward maxWorkers"

No. `maxWorkers` is the cap on *worker goroutines that pull from the queue*. A task can `go func() { ... }()` to its heart's content; those goroutines are outside the pool's accounting.

### "The pool is a drop-in replacement for sync.WaitGroup"

Partially. The pool tracks pending tasks internally and `StopWait` waits for them. But you cannot ask "have all my tasks finished?" mid-flight. For that, use a `WaitGroup` *in addition* to the pool, or count atomically.

---

## Tricky Points

### Submit-from-task does not deadlock (but can starve)

A running task can call `pool.Submit`. If all worker slots are taken by tasks that each submit a new task and wait for it, you deadlock. With purely fire-and-forget recursion, you do not.

### Idle timeout is hard-coded

The `idleTimeout` is internal (2 seconds in current versions). You cannot configure it. If your workload has bursts spaced 10 seconds apart, every burst pays the cost of spawning fresh workers.

### `Stopped` returns true at the moment of stopping

`pool.Stopped()` returns `true` as soon as `Stop()` is called, even while workers are still finishing tasks. It is not "all tasks complete"; it is "shutdown initiated".

### `WaitingQueueSize` is a snapshot

It is the queue depth at the moment of the call; no guarantee about the next moment. Useful for metrics, not for synchronisation.

### Two pools do not share workers

If you create `p1 := workerpool.New(4)` and `p2 := workerpool.New(4)`, you have 8 worker slots total. Pools are independent.

### `New(n)` for `n <= 0` is normalised

Depending on version, the library either panics, defaults to 1, or accepts the value. Always pass a positive number.

### `SubmitWait` from inside a task can deadlock

If you `pool.SubmitWait` from inside a task occupying a worker slot, and `maxWorkers == 1`, you wait forever. Even at higher caps, if all workers are busy with tasks that all `SubmitWait` more work, you deadlock. Be careful.

---

## Test

A starter sanity test:

```go
package main

import (
    "sync/atomic"
    "testing"

    "github.com/gammazero/workerpool"
)

func TestPoolRunsAll(t *testing.T) {
    pool := workerpool.New(4)
    var counter int64

    for i := 0; i < 100; i++ {
        pool.Submit(func() { atomic.AddInt64(&counter, 1) })
    }
    pool.StopWait()

    if got := atomic.LoadInt64(&counter); got != 100 {
        t.Fatalf("expected 100, got %d", got)
    }
}

func TestStopDiscardsUnstarted(t *testing.T) {
    pool := workerpool.New(1)
    var counter int64

    for i := 0; i < 1000; i++ {
        pool.Submit(func() {
            atomic.AddInt64(&counter, 1)
        })
    }
    pool.Stop()

    if got := atomic.LoadInt64(&counter); got == 1000 {
        // very unlikely with 1000 tasks and Stop on a 1-worker pool
        // but not impossible if the test is slow
        t.Logf("hit edge case: all 1000 finished before Stop took effect")
    }
}

func TestSubmitAfterStopIsNoop(t *testing.T) {
    pool := workerpool.New(2)
    pool.StopWait()

    var ran int64
    pool.Submit(func() { atomic.AddInt64(&ran, 1) })

    if ran != 0 {
        t.Fatalf("task ran after StopWait, got ran=%d", ran)
    }
    if !pool.Stopped() {
        t.Fatal("Stopped should report true after StopWait")
    }
}
```

Run with `go test -race ./...` to also catch any race conditions you might have introduced in your task closures.

---

## Tricky Questions

These are short, almost flash-card style. The full interview file goes deeper.

### Q1: What happens if you call `Submit` after `Stop`?

The task is silently dropped. No panic, no error.

### Q2: What is the default queue size?

There is no fixed size; the queue is unbounded.

### Q3: How many goroutines does `workerpool.New(8)` start immediately?

One — the dispatcher. Workers spin up lazily as tasks arrive.

### Q4: How many goroutines run after the pool has been idle for an hour?

One — only the dispatcher. All workers have been reaped (after 2 seconds of idle each).

### Q5: Difference between `Stop` and `StopWait`?

`Stop` discards unstarted tasks; `StopWait` runs them.

### Q6: Can you create a new pool after stopping one?

Yes. They are independent objects.

### Q7: Is `Submit` thread-safe?

Yes. You can call it from any number of goroutines concurrently.

### Q8: What is `WaitingQueueSize` for?

Telemetry — how many tasks are queued but not yet started.

### Q9: Does the pool give you any built-in metric or tracing?

No. You instrument by hand.

### Q10: Can a task `Submit` more work?

Yes, but watch for deadlocks if you also `SubmitWait`.

---

## Cheat Sheet

```go
// create
pool := workerpool.New(maxWorkers)

// schedule a task (returns immediately)
pool.Submit(func() { ... })

// schedule and wait (blocks until task finishes)
pool.SubmitWait(func() { ... })

// shut down, run everything in the queue
pool.StopWait()

// shut down, discard queued (unstarted) tasks
pool.Stop()

// check shutdown state
if pool.Stopped() {
    // pool is closed
}

// queue depth
n := pool.WaitingQueueSize()
```

Idiomatic skeleton:

```go
pool := workerpool.New(runtime.NumCPU())
defer pool.StopWait()

for _, item := range items {
    item := item
    pool.Submit(func() {
        process(item)
    })
}
```

---

## Self-Assessment Checklist

After reading this file you should be able to answer "yes" to:

- [ ] I can install `workerpool` in a fresh module.
- [ ] I know what `workerpool.New(N)` actually does immediately (spawns the dispatcher only).
- [ ] I can submit a closure with a captured loop variable correctly (shadow on <1.22).
- [ ] I know `Submit` returns immediately and does not block.
- [ ] I know `Stop` discards, `StopWait` drains.
- [ ] I would pick `runtime.NumCPU()` for CPU-bound and ~10× for I/O-bound.
- [ ] I would protect shared state with a mutex or atomic.
- [ ] I would write `defer pool.StopWait()` reflexively.
- [ ] I know `Submit` after `Stop` is a silent no-op.
- [ ] I can explain to a junior teammate why a pool exists.

If any item is shaky, re-read the corresponding section.

---

## Summary

`workerpool.New(N)` gives you a fixed-size worker pool with an unbounded task queue. `Submit` schedules work without blocking. `StopWait` drains the queue and exits cleanly. Workers reap themselves after 2 seconds of idleness. The library has no generics, no error returns, no context support, no built-in metrics — just the essentials. For 70% of pool needs in Go, that is enough.

The two things you must remember:

1. Pair `New` with `StopWait`. Always.
2. The queue is unbounded; if you do not trust your producer, wrap submission in a semaphore or move to a different library.

---

## What You Can Build

With only what is in this file you can already build:

- **A parallel URL fetcher.** Bounded concurrency, error collection.
- **A batch file processor.** Resize, compress, transcode.
- **A test runner.** N tests at a time, aggregate results.
- **A log enrichment pipeline.** Read lines, decorate, write back.
- **A small CLI for parallel "do X" tasks.**

The middle file adds `SubmitWait`, panic recovery, idle-timeout behaviour, and queueing patterns — useful when your workload gets less predictable.

---

## Further Reading

- The library's own README — https://github.com/gammazero/workerpool
- The middle file — `SubmitWait`, `Stopped`, panic recovery, queue depth
- The senior file — internals, dispatcher loop, idle reaper, comparisons
- The professional file — production sizing, observability, real-world incidents
- The specification file — full API reference and version history
- `panjf2000/ants` README — a faster, more configurable alternative
- `Jeffail/tunny` README — a per-worker-state alternative
- "Concurrency in Go" by Katherine Cox-Buday — chapters on pipelines and the bounded-worker pattern

---

## Related Topics

- **Goroutines** (`01-goroutines/01-overview`) — the underlying primitive
- **Channels** (`02-channels`) — what the pool is built on internally
- **`sync.WaitGroup`** — a complement, not a replacement, of the pool
- **`context.Context`** — for cancellation; covered in the middle file
- **`sync.Pool`** — unrelated to `workerpool`, despite the name; reuses *objects*, not goroutines
- **Rate limiting** — a different kind of bound (per second, not per concurrent)

---

## Diagrams and Visual Aids

### Lifecycle

```
                ┌──────────────────────┐
   New(n)  ──→  │ pool with dispatcher │
                │  0 workers running   │
                └──────────────────────┘
                          │
                  Submit(f)
                          │
                          ▼
                ┌──────────────────────┐
                │ dispatcher routes f  │
                │ workers spin up      │
                └──────────────────────┘
                          │
                  more Submit calls
                          │
                          ▼
                ┌──────────────────────┐
                │ steady-state         │
                │ up to maxWorkers     │
                └──────────────────────┘
                          │
                  Stop / StopWait
                          │
                          ▼
                ┌──────────────────────┐
                │  shutdown complete   │
                │  no goroutines       │
                └──────────────────────┘
```

### Submit path

```
caller goroutine                dispatcher goroutine                 worker goroutines
─────────────────                ────────────────────                 ────────────────────
pool.Submit(f) ──→ taskQueue ──→ select:
                                   case worker ready:  ──→ readyChan ──→ run f()
                                   case else:           ──→ append to waitingQueue
                                   case Stop:           ──→ drain or discard
```

### Concurrency cap

```
maxWorkers = 3

time →
0ms      ─[task A]─[task B]─[task C]
50ms     ───[A]────[B]────[C]
                        ↑ all three slots in use, task D queued
60ms     ── A done ─── B running ── C running ── D starts
```

### Stop vs StopWait

```
queue:  [a][b][c][d][e]   workers running: [x][y]

Stop():
  workers finish [x] and [y]
  [a][b][c][d][e] DROPPED
  result: only [x] and [y] ran

StopWait():
  workers finish [x] and [y]
  workers pick up [a], [b], ..., [e] in turn
  result: ALL of [x][y][a][b][c][d][e] ran
```

These visual aids may not display perfectly in every Markdown renderer, but they communicate the essential shape: a pool is workers + queue + lifecycle, nothing more.

---

## Extended Examples Walk-through

The remainder of this file walks through ten extended, fully annotated examples. Each one is something you can paste into a `main.go`, run, and observe. The goal is to build muscle memory by seeing the same primitives — `New`, `Submit`, `StopWait` — applied to ten realistic micro-projects.

### Example A: Word count over a directory

```go
package main

import (
    "bufio"
    "fmt"
    "os"
    "path/filepath"
    "strings"
    "sync"
    "sync/atomic"

    "github.com/gammazero/workerpool"
)

func main() {
    if len(os.Args) < 2 {
        fmt.Fprintln(os.Stderr, "usage: wc <dir>")
        os.Exit(1)
    }
    root := os.Args[1]

    files := make([]string, 0, 1024)
    err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
        if err != nil {
            return nil // skip files we cannot list
        }
        if d.IsDir() {
            return nil
        }
        files = append(files, p)
        return nil
    })
    if err != nil {
        fmt.Fprintln(os.Stderr, "walk error:", err)
        os.Exit(1)
    }

    pool := workerpool.New(8)
    defer pool.StopWait()

    var totalWords int64
    var mu sync.Mutex
    perFile := make(map[string]int)

    for _, f := range files {
        f := f
        pool.Submit(func() {
            n := countWords(f)
            atomic.AddInt64(&totalWords, int64(n))
            mu.Lock()
            perFile[f] = n
            mu.Unlock()
        })
    }
    pool.StopWait()

    fmt.Printf("scanned %d files, total %d words\n", len(files), totalWords)
}

func countWords(path string) int {
    f, err := os.Open(path)
    if err != nil {
        return 0
    }
    defer f.Close()

    scanner := bufio.NewScanner(f)
    scanner.Buffer(make([]byte, 64*1024), 1024*1024)
    n := 0
    for scanner.Scan() {
        n += len(strings.Fields(scanner.Text()))
    }
    return n
}
```

Notice how `atomic.AddInt64` handles the global count without a lock, while the per-file map needs a mutex because slice/map operations are not atomic. The pool gives us bounded parallelism (8 files at a time) and the producer loop is trivial.

### Example B: Sequential pipeline with two pools

```go
package main

import (
    "fmt"

    "github.com/gammazero/workerpool"
)

type stage1Out struct{ value int }
type stage2Out struct{ value int }

func main() {
    in := make([]int, 1000)
    for i := range in {
        in[i] = i
    }

    s1Pool := workerpool.New(4)
    s2Pool := workerpool.New(2)

    stage2Inputs := make(chan stage1Out, 100)
    results := make(chan stage2Out, 100)

    // Feed stage 1
    go func() {
        defer close(stage2Inputs)
        for _, v := range in {
            v := v
            s1Pool.Submit(func() {
                stage2Inputs <- stage1Out{value: v * 2}
            })
        }
        s1Pool.StopWait()
    }()

    // Feed stage 2
    go func() {
        defer close(results)
        for in := range stage2Inputs {
            in := in
            s2Pool.Submit(func() {
                results <- stage2Out{value: in.value + 1}
            })
        }
        s2Pool.StopWait()
    }()

    // Drain
    sum := 0
    for r := range results {
        sum += r.value
    }
    fmt.Println("pipeline sum =", sum)
}
```

Two pools, two stages, two channels. Each stage has its own concurrency level. The pattern scales to N stages.

### Example C: Parallel quicksort buckets

```go
package main

import (
    "fmt"
    "sort"
    "sync"

    "github.com/gammazero/workerpool"
)

func main() {
    data := make([]int, 1_000_000)
    for i := range data {
        data[i] = (i * 31) % 997
    }

    const buckets = 16
    chunks := make([][]int, buckets)
    chunkSize := (len(data) + buckets - 1) / buckets
    for i := 0; i < buckets; i++ {
        end := (i + 1) * chunkSize
        if end > len(data) {
            end = len(data)
        }
        chunks[i] = append([]int(nil), data[i*chunkSize:end]...)
    }

    pool := workerpool.New(8)
    var wg sync.WaitGroup

    for i := range chunks {
        i := i
        wg.Add(1)
        pool.Submit(func() {
            defer wg.Done()
            sort.Ints(chunks[i])
        })
    }
    wg.Wait()
    pool.StopWait()

    // (k-way merge omitted)
    fmt.Println("sorted 16 buckets of total", len(data), "ints")
}
```

Why use `sync.WaitGroup` here when we have `pool.StopWait()`? Because we want to *continue using* the pool after we know these tasks are done — for example, to launch the k-way merge phase. `StopWait` would force a fresh pool. Combining `wg.Wait` for milestones with one shared pool is a common production pattern.

### Example D: Bounded outgoing webhook delivery

```go
package main

import (
    "bytes"
    "context"
    "fmt"
    "net/http"
    "sync/atomic"
    "time"

    "github.com/gammazero/workerpool"
)

type Webhook struct {
    URL  string
    Body []byte
}

var deliveryPool = workerpool.New(20)

var (
    success int64
    failure int64
)

func DeliverAll(hooks []Webhook) {
    for _, h := range hooks {
        h := h
        deliveryPool.Submit(func() { deliverOne(h) })
    }
}

func deliverOne(h Webhook) {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    req, err := http.NewRequestWithContext(ctx, "POST", h.URL, bytes.NewReader(h.Body))
    if err != nil {
        atomic.AddInt64(&failure, 1)
        return
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        atomic.AddInt64(&failure, 1)
        return
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 400 {
        atomic.AddInt64(&failure, 1)
        return
    }
    atomic.AddInt64(&success, 1)
}

func main() {
    hooks := make([]Webhook, 200)
    for i := range hooks {
        hooks[i] = Webhook{URL: "https://httpbin.org/status/200", Body: []byte("{}")}
    }
    DeliverAll(hooks)
    deliveryPool.StopWait()
    fmt.Println("success =", success, "failure =", failure)
}
```

`context.WithTimeout` is per-task: the pool does not time tasks out, the HTTP client does. This is the right separation of concerns.

### Example E: A "bee swarm" load tester

```go
package main

import (
    "fmt"
    "net/http"
    "sync/atomic"
    "time"

    "github.com/gammazero/workerpool"
)

func main() {
    url := "http://localhost:8080/"
    duration := 10 * time.Second
    concurrency := 50

    pool := workerpool.New(concurrency)
    deadline := time.Now().Add(duration)

    var sent int64
    var ok int64
    for time.Now().Before(deadline) {
        pool.Submit(func() {
            resp, err := http.Get(url)
            if err == nil {
                atomic.AddInt64(&ok, 1)
                resp.Body.Close()
            }
            atomic.AddInt64(&sent, 1)
        })
    }
    pool.StopWait()

    fmt.Printf("sent %d requests, %d ok over %s\n", sent, ok, duration)
}
```

The loop is a *deadline-driven* producer rather than a fixed-count producer. The pool's queue absorbs the bursts.

### Example F: Per-shard aggregation

```go
package main

import (
    "fmt"
    "hash/fnv"
    "sync"

    "github.com/gammazero/workerpool"
)

const shards = 16

type ShardMap struct {
    m  [shards]map[string]int
    mu [shards]sync.Mutex
}

func NewShardMap() *ShardMap {
    sm := &ShardMap{}
    for i := range sm.m {
        sm.m[i] = make(map[string]int)
    }
    return sm
}

func (sm *ShardMap) hash(k string) int {
    h := fnv.New32a()
    _, _ = h.Write([]byte(k))
    return int(h.Sum32()) % shards
}

func (sm *ShardMap) Inc(k string) {
    s := sm.hash(k)
    sm.mu[s].Lock()
    sm.m[s][k]++
    sm.mu[s].Unlock()
}

func (sm *ShardMap) Total() int {
    n := 0
    for i := range sm.m {
        sm.mu[i].Lock()
        for _, v := range sm.m[i] {
            n += v
        }
        sm.mu[i].Unlock()
    }
    return n
}

func main() {
    keys := []string{"apple", "banana", "cherry", "date", "elderberry"}
    pool := workerpool.New(8)
    sm := NewShardMap()

    for i := 0; i < 1_000_000; i++ {
        k := keys[i%len(keys)]
        k = k // shadow not needed here because k is computed inside the loop, but harmless
        pool.Submit(func() { sm.Inc(k) })
    }
    pool.StopWait()
    fmt.Println("total counts =", sm.Total())
}
```

Sharded maps are a classic recipe for reducing mutex contention. The pool tasks distribute writes across all 16 shards via FNV hashing.

### Example G: Producer-consumer with a separate producer goroutine

```go
package main

import (
    "fmt"
    "sync/atomic"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(4)
    inputs := make(chan int, 100)

    go func() {
        for i := 0; i < 1000; i++ {
            inputs <- i
        }
        close(inputs)
    }()

    var processed int64
    for v := range inputs {
        v := v
        pool.Submit(func() {
            atomic.AddInt64(&processed, int64(v))
        })
    }
    pool.StopWait()

    fmt.Println("sum =", processed) // 499500
}
```

A common shape: an upstream source streams into a channel, the main loop reads it and submits tasks. The pool is invisible to the source.

### Example H: A graceful program shutdown

```go
package main

import (
    "fmt"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/gammazero/workerpool"
)

var pool = workerpool.New(8)

func main() {
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)

    go produceForever()

    sig := <-sigs
    fmt.Println("got signal:", sig)
    fmt.Println("draining pool (this may take a few seconds)...")
    pool.StopWait()
    fmt.Println("clean exit")
}

func produceForever() {
    for {
        if pool.Stopped() {
            return
        }
        pool.Submit(func() {
            time.Sleep(100 * time.Millisecond)
        })
        time.Sleep(time.Millisecond)
    }
}
```

This is a tiny example of a real shutdown story: a signal arrives, the producer notices the pool is stopped, and the program exits after draining. Production servers do the same thing with a few more layers (an `errgroup`, a context, a deadline on the drain).

### Example I: Aggregating logs concurrently

```go
package main

import (
    "bufio"
    "fmt"
    "os"
    "regexp"
    "sync"

    "github.com/gammazero/workerpool"
)

var errPat = regexp.MustCompile(`(?i)error`)

func main() {
    pool := workerpool.New(4)
    var mu sync.Mutex
    var lines []string

    in := bufio.NewScanner(os.Stdin)
    for in.Scan() {
        line := in.Text()
        pool.Submit(func() {
            if errPat.MatchString(line) {
                mu.Lock()
                lines = append(lines, line)
                mu.Unlock()
            }
        })
    }
    pool.StopWait()

    for _, l := range lines {
        fmt.Println(l)
    }
}
```

For very small per-line work, a pool is overkill (the per-task overhead dominates). For heavier per-line processing — parsing JSON, querying a database — it pays off.

### Example J: Bounded fan-out with backpressure

```go
package main

import (
    "fmt"
    "sync"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(8)
    const bound = 32
    sem := make(chan struct{}, bound)

    var wg sync.WaitGroup
    for i := 0; i < 100_000; i++ {
        i := i
        sem <- struct{}{} // backpressure: blocks if 32 tasks already in flight
        wg.Add(1)
        pool.Submit(func() {
            defer func() {
                wg.Done()
                <-sem
            }()
            _ = i
        })
    }
    wg.Wait()
    pool.StopWait()
    fmt.Println("done")
}
```

If the producer outruns the workers, the channel fills, the next `sem <- struct{}{}` blocks, and the producer waits. This converts an unbounded queue into a bounded one without leaving the library.

---

## Anti-Pattern Gallery

A short photo album of code you should not write.

### Anti-pattern 1: The leak

```go
func handle(r *http.Request) {
    pool := workerpool.New(2)
    pool.Submit(func() { logHit(r) })
    // no StopWait; pool dispatcher and worker leak per request
}
```

Fix: shared pool at package init, or `defer pool.StopWait()` if you really need a per-call pool.

### Anti-pattern 2: The mutate-while-iterating

```go
var items []Item
for _, x := range source {
    x := x
    pool.Submit(func() {
        items = append(items, transform(x)) // RACE
    })
}
pool.StopWait()
```

Fix: lock around `append`, or use a channel.

### Anti-pattern 3: The Stop-when-StopWait-was-meant

```go
for _, x := range importantItems {
    x := x
    pool.Submit(func() { saveToDB(x) })
}
pool.Stop() // bug: drops everything not yet processed
```

Fix: `pool.StopWait()`.

### Anti-pattern 4: The single-shot pool

```go
func init() {
    pool := workerpool.New(8)
    pool.Submit(...)
    pool.StopWait()
}
```

If the pool is only used for one batch and then thrown away, you do not need it. Just `go work()` with a `WaitGroup`.

### Anti-pattern 5: The forever-pool

```go
var pool = workerpool.New(1000) // "in case we get a lot of traffic"
```

A pool sized 1000 with no idle workload still keeps the dispatcher up and *can* spawn 1000 workers. If your traffic does not justify 1000 concurrent workers, your `maxWorkers` is fantasy. Size to your actual load plus headroom.

### Anti-pattern 6: The closure that captures everything

```go
for _, item := range items {
    pool.Submit(func() {
        // Captures `items` as well as `item` (depends on Go version).
        // Even worse: captures the whole enclosing function's state.
        process(item, items)
    })
}
```

Closures are great, but they pin variables to the heap. If the captured set is large, you pay GC cost. Pass scalars explicitly via a helper function.

### Anti-pattern 7: Nesting pools needlessly

```go
outer := workerpool.New(8)
for _, group := range groups {
    group := group
    outer.Submit(func() {
        inner := workerpool.New(8)
        for _, item := range group {
            item := item
            inner.Submit(func() { work(item) })
        }
        inner.StopWait()
    })
}
outer.StopWait()
```

Two pools nested with the same size add complexity without parallelism. One pool with size 64 would do the same work without the nesting. If the two stages have *different* parallelism caps, then two pools make sense.

---

## A Note on Versions

The library is on v1.x and has been stable for years. As of this writing the latest tagged version is 1.1.3. The methods listed here — `New`, `Submit`, `SubmitWait`, `Stop`, `StopWait`, `Stopped`, `WaitingQueueSize` — have not changed signature since v1.0. A newer `Pause(ctx)` method exists in some versions; we cover it in the middle file.

If you target Go 1.20 or older, double-check your version constraints. The library generally requires a relatively modern Go (1.18+) because of testing and module conventions, not because of language features used.

---

## A Tiny Benchmark You Can Run Locally

A microbenchmark to convince yourself the pool is not free but also not expensive:

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "testing"
    "time"

    "github.com/gammazero/workerpool"
)

func BenchmarkSubmit(b *testing.B) {
    pool := workerpool.New(4)
    defer pool.StopWait()
    var x int64

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        pool.Submit(func() { atomic.AddInt64(&x, 1) })
    }
}

func BenchmarkRawGoroutine(b *testing.B) {
    var x int64
    var wg sync.WaitGroup
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        wg.Add(1)
        go func() {
            atomic.AddInt64(&x, 1)
            wg.Done()
        }()
    }
    wg.Wait()
}

func main() {
    // run as `go test -bench .` rather than `go run`
    _ = fmt.Sprint(time.Now())
}
```

Typical numbers on a recent laptop:

- `BenchmarkSubmit` — ~150 ns/op
- `BenchmarkRawGoroutine` — ~250 ns/op

The pool is actually *faster* than raw goroutines for trivial tasks because it reuses workers. The overhead per submit is the channel send, ~100–150 ns. For tasks that take any meaningful work (microseconds and up) this is rounding error; for sub-microsecond tasks it dominates.

---

## A Word on Code Reviews

When you review a colleague's PR that uses `workerpool`, check:

1. Is there a `StopWait` (or `Stop` for a good reason) on every code path?
2. Is `maxWorkers` a named constant, not a magic number?
3. Are loop variables shadowed (or is the project on Go 1.22+)?
4. Is shared state protected?
5. Is the queue depth bounded if input is untrusted?
6. Are panics in tasks handled (or known to be impossible)?
7. Are task lifetimes bounded by `context.WithTimeout`?

These seven items catch most pool-related bugs at review time. Make them muscle memory.

---

## Migrating From a Hand-Rolled Pool

If you have an existing chunk of code like:

```go
jobs := make(chan func(), 100)
var wg sync.WaitGroup
for i := 0; i < 8; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for f := range jobs {
            f()
        }
    }()
}
for _, x := range items {
    x := x
    jobs <- func() { work(x) }
}
close(jobs)
wg.Wait()
```

The `workerpool` version is:

```go
pool := workerpool.New(8)
for _, x := range items {
    x := x
    pool.Submit(func() { work(x) })
}
pool.StopWait()
```

Two visible differences:

1. No buffered channel size to pick. `workerpool` buffers internally as much as needed.
2. No `wg`. The pool tracks pending work.

Behavioural differences to note:

- The hand-rolled version with `cap(jobs) = 100` will **block** the producer when 100 tasks are queued. `workerpool` will never block; it will absorb whatever you send.
- The hand-rolled version keeps 8 goroutines alive forever (until `close(jobs)`). `workerpool` reaps idle ones.
- The hand-rolled version is one file of code you must read to understand. `workerpool` is a name everyone can Google.

For most production code, the migration is a net win. For tight inner loops on a hot path, benchmark first; the hand-rolled channel may be a few nanoseconds faster.

---

## When Not To Use Workerpool At All

There is no shame in skipping a library. Consider not using `workerpool` if:

- **You spawn N tasks once at startup and never again.** Just `go f()` with a `WaitGroup`. The pool's whole point is reuse over time.
- **Your tasks are heterogeneous.** A pool implies "do many of the same kind of thing". If each task is unique (different argument types, different lifetimes, different concerns) you might as well spawn them directly.
- **You need per-task results synchronously.** A function call returning a result is simpler than a pool with a result channel.
- **You are inside a tight algorithmic loop.** Sorting, hashing, matrix multiplication — the cost of a `Submit` channel send is significant compared to the work. Inline.

The pool is a tool for *bursts of similar work, repeated over time, with a bounded concurrency cap*. When that shoe fits, `workerpool` is the right one to put on.

---

## A Final Junior Story

Imagine you join a team. There is a 600-line file called `worker_pool.go` with a hand-rolled implementation. It has bugs the team has worked around in 12 places. Tests pass on the third re-run. There is a slack channel called `#pool-questions`.

You file a PR replacing the file with:

```go
import "github.com/gammazero/workerpool"
```

The file goes from 600 lines to 100. Every call site shrinks by 30%. The `#pool-questions` channel goes quiet. Three months later, nobody remembers there was ever a custom pool.

This is the typical arc of adopting a small, well-scoped library. `workerpool` is small enough to read in one sitting and stable enough to bet a service on. That combination is rare. Use it when the shoe fits, know when it does not, and you will rarely regret either choice.

---

## Frequently Asked Junior Questions

A grab-bag of the questions that come up most often when developers meet `workerpool` for the first time.

### "How do I block the producer if the pool is overloaded?"

Out of the box you cannot. `Submit` is non-blocking by design. The workaround is to use a counting semaphore in front of `Submit`:

```go
const inflightCap = 1000
sem := make(chan struct{}, inflightCap)

for _, item := range items {
    sem <- struct{}{} // blocks when 1000 tasks are in flight
    item := item
    pool.Submit(func() {
        defer func() { <-sem }()
        process(item)
    })
}
```

Now your producer cannot get more than 1000 tasks ahead of the workers. The pool itself never blocks; the semaphore does.

### "How do I cancel all pending tasks immediately?"

Call `pool.Stop()`. It discards any unstarted task in the queue. Running tasks complete normally. If you also need to cancel running tasks, you must build that into each task with a `context.Context` (see the middle file).

### "Is there a way to know when all my tasks have finished without stopping the pool?"

Yes — use a `sync.WaitGroup`:

```go
var wg sync.WaitGroup
for _, x := range batch {
    x := x
    wg.Add(1)
    pool.Submit(func() {
        defer wg.Done()
        work(x)
    })
}
wg.Wait() // pool is still alive
```

`pool.StopWait()` waits for *all* submitted tasks plus permanently closes the pool. `wg.Wait` is the right pick when you want to know about a specific batch and keep the pool around.

### "Can I see what each worker is doing?"

No, not from the public API. The internal state is private. You can instrument *yourself* by wrapping the closure:

```go
func instrumented(name string, f func()) func() {
    return func() {
        start := time.Now()
        f()
        log.Printf("task %s took %s", name, time.Since(start))
    }
}

pool.Submit(instrumented("resize:image123", func() { resize("image123") }))
```

This is the standard pattern for tracing, metrics, and logging individual tasks.

### "Does workerpool work on Windows / macOS / ARM / etc.?"

Yes. It is pure Go, no CGo, no syscall surprises. Works anywhere Go does.

### "Can I use it in a library I publish?"

You can, but consider the cost: every consumer of your library now depends on `gammazero/workerpool` transitively. For small library code, prefer to take a worker-pool *interface* and let the caller provide the implementation:

```go
type TaskPool interface {
    Submit(func())
}

func (s *Service) Process(items []Item, pool TaskPool) { ... }
```

The caller then plugs in `workerpool`, `ants`, or a hand-rolled pool. Library users with strong opinions on dependencies will thank you.

### "Why isn't there a `Resize(N)` method?"

There is no way to grow or shrink `maxWorkers` after creation. If your concurrency cap should change at runtime (autoscaling, dynamic load), `workerpool` is the wrong library. `ants` supports `Tune(n)`.

### "Can I submit a method on a struct?"

Yes. A method value is a function value, so `pool.Submit(myStruct.DoWork)` is fine if `DoWork()` has no args and no return. With args, use a closure: `pool.Submit(func() { myStruct.DoWork(arg) })`.

### "Is `workerpool` safe to use from multiple processes?"

The pool lives inside one process. There is no cross-process coordination. For distributed work queues, you want a different tool entirely — Redis lists, NATS, Kafka, RabbitMQ.

### "What if I want only a *minimum* number of workers, not a maximum?"

You cannot configure a floor. The pool always has between 0 and `maxWorkers` workers, never more, with 0 being the steady state when idle. If you genuinely need pre-warmed workers — for example, to amortise a slow worker-side initialisation — you must:

1. Submit `maxWorkers` no-op tasks at startup to spin them up; **and**
2. Submit at least one task every ~1.9 seconds to keep them from being reaped.

Workarounds are clunky. Consider rolling your own pool if pre-warming matters.

### "Does the pool work with `errgroup`?"

You can combine them, but they overlap. `errgroup.Group.Go` already spawns goroutines for you; if you pass those goroutines a closure that calls `pool.Submit`, you have two levels of concurrency control fighting each other. The simpler pattern is: pick one. If you need error propagation and cancellation, use `errgroup`. If you need a bounded pool that decouples submit from execution, use `workerpool`.

### "Can I attach metadata to a task?"

Not directly. Closures can capture whatever they want, including a struct with metadata fields, but the pool itself does not know or care. If you need typed inputs and structured tracking, look at `ants.PoolWithFunc` or write a thin wrapper around `workerpool` that takes `(meta, func())`.

### "What is the cost of a panic in a task?"

The panic does not crash the pool. The dispatcher recovers it and the worker survives. But the panic value is lost; the library does not surface it. If your task can panic and the panic matters, wrap with `defer recover()` inside the task closure and log/handle the value yourself.

---

## A Tiny Decision Tree

Pasted as the last thing in this file because it answers "should I use workerpool today?":

```
Do you need to limit concurrency for a batch of similar tasks?
  └─ No → just use go f() or errgroup, no pool needed
  └─ Yes:
       Do you have generics-typed args you want to avoid closures for?
         └─ Yes → consider ants.PoolWithFunc
         └─ No:
              Do you need per-worker state (DB conn, ML model)?
                └─ Yes → consider Jeffail/tunny
                └─ No:
                     Do you need million-tasks-per-second throughput?
                       └─ Yes → consider ants
                       └─ No → workerpool is fine
```

Most projects land on the rightmost path. That is why `workerpool` is the right default — it is the one that fits the average case with the smallest API.

---

## Closing Thoughts

You have now seen the library three or four times in this file, with progressively more depth. The take-aways:

- `workerpool.New(N)` + `Submit(func())` + `StopWait()` is the entire happy path.
- The queue is unbounded; you must add your own bound for untrusted input.
- Errors and panics are your problem to handle; the library will not.
- Pick `maxWorkers` based on workload kind (CPU-bound vs I/O-bound).
- Always pair creation with shutdown.

The middle file picks up here, introducing `SubmitWait` for backpressure, `Stopped` for graceful patterns, the idle-worker timeout in more detail, and panic recovery internals. The senior file goes into the dispatcher loop itself — actual Go code from the library — so you can answer "why" questions, not just "how" questions. The professional file is where production wisdom lives: sizing, observability, draining, and the four real-world incidents that have made this library a household name in Go.

Until then, write a small pool. Submit some tasks. Make them race. Fix the races. The muscle memory you build now will outlast any specific library.

---

## Appendix: Hand-on Walkthroughs

To wrap up the junior file, two long-form walkthroughs that you can follow keystroke by keystroke. Each takes 15 to 30 minutes to type out and run; together they cement everything covered above.

### Walkthrough 1: Building "go-batch-fetch"

A minimal CLI that takes a file of URLs (one per line) and downloads them in parallel.

Step 1 — create the module:

```bash
mkdir go-batch-fetch && cd go-batch-fetch
go mod init example.com/go-batch-fetch
go get github.com/gammazero/workerpool
```

Step 2 — create `main.go`:

```go
package main

import (
    "bufio"
    "context"
    "flag"
    "fmt"
    "io"
    "net/http"
    "os"
    "path/filepath"
    "strings"
    "sync/atomic"
    "time"

    "github.com/gammazero/workerpool"
)

var (
    flagConcurrency = flag.Int("c", 8, "max concurrent downloads")
    flagTimeout     = flag.Duration("t", 30*time.Second, "per-request timeout")
    flagOutDir      = flag.String("o", "downloads", "output directory")
)

func main() {
    flag.Parse()
    if flag.NArg() != 1 {
        fmt.Fprintln(os.Stderr, "usage: go-batch-fetch [-c N] [-t D] [-o DIR] urls.txt")
        os.Exit(1)
    }

    if err := os.MkdirAll(*flagOutDir, 0o755); err != nil {
        fail("mkdir: ", err)
    }

    urls, err := readLines(flag.Arg(0))
    if err != nil {
        fail("read urls: ", err)
    }
    fmt.Printf("queued %d urls, concurrency=%d\n", len(urls), *flagConcurrency)

    pool := workerpool.New(*flagConcurrency)
    defer pool.StopWait()

    var ok, fail int64
    for _, u := range urls {
        u := u
        pool.Submit(func() {
            if err := downloadOne(u); err != nil {
                fmt.Fprintf(os.Stderr, "FAIL %s: %v\n", u, err)
                atomic.AddInt64(&failCount, 1)
                return
            }
            atomic.AddInt64(&okCount, 1)
        })
    }
    pool.StopWait()

    fmt.Printf("ok=%d fail=%d\n", atomic.LoadInt64(&okCount), atomic.LoadInt64(&failCount))
}

var (
    okCount   int64
    failCount int64
)

func downloadOne(url string) error {
    ctx, cancel := context.WithTimeout(context.Background(), *flagTimeout)
    defer cancel()

    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return err
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 400 {
        return fmt.Errorf("HTTP %d", resp.StatusCode)
    }

    name := filepath.Join(*flagOutDir, strings.ReplaceAll(strings.TrimPrefix(strings.TrimPrefix(url, "https://"), "http://"), "/", "_"))
    f, err := os.Create(name)
    if err != nil {
        return err
    }
    defer f.Close()

    _, err = io.Copy(f, resp.Body)
    return err
}

func readLines(path string) ([]string, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()

    var lines []string
    sc := bufio.NewScanner(f)
    sc.Buffer(make([]byte, 1<<16), 1<<20)
    for sc.Scan() {
        line := strings.TrimSpace(sc.Text())
        if line == "" || strings.HasPrefix(line, "#") {
            continue
        }
        lines = append(lines, line)
    }
    return lines, sc.Err()
}

func fail(msg string, err error) {
    fmt.Fprintln(os.Stderr, msg, err)
    os.Exit(1)
}
```

Step 3 — make a sample URL list, `urls.txt`:

```
https://example.com
https://example.org
https://golang.org
https://pkg.go.dev
https://httpbin.org/get
# this line is a comment, will be skipped
https://www.google.com
```

Step 4 — run:

```bash
go run . urls.txt
```

You should see something like:

```
queued 6 urls, concurrency=8
ok=6 fail=0
```

And the `downloads/` directory now contains files named after the URLs. Try `-c 1` to force sequential, `-c 100` to over-parallelise, and watch the timing.

What you have built:

- A real CLI tool with flags, timeouts, and error handling.
- A clean shutdown via `defer pool.StopWait()`.
- Per-task timeouts using `context.WithTimeout`.
- Concurrent counting via `sync/atomic`.

Every line is junior-level material. None of it is unique to `workerpool`. The pool is the place where you bound concurrency without writing a single channel.

### Walkthrough 2: Building "lint-everything"

A toy CLI that runs a fake "lint" function on every `.go` file in a directory tree, with bounded parallelism.

```go
package main

import (
    "fmt"
    "io/fs"
    "os"
    "path/filepath"
    "strings"
    "sync"
    "sync/atomic"
    "time"

    "github.com/gammazero/workerpool"
)

func main() {
    if len(os.Args) < 2 {
        fmt.Fprintln(os.Stderr, "usage: lint-everything <dir>")
        os.Exit(1)
    }

    pool := workerpool.New(4)
    defer pool.StopWait()

    var nFiles, nIssues int64
    var mu sync.Mutex
    issuesByFile := map[string][]string{}

    err := filepath.WalkDir(os.Args[1], func(p string, d fs.DirEntry, err error) error {
        if err != nil {
            return nil
        }
        if d.IsDir() {
            return nil
        }
        if !strings.HasSuffix(p, ".go") {
            return nil
        }
        atomic.AddInt64(&nFiles, 1)
        p := p
        pool.Submit(func() {
            issues := fakeLint(p)
            atomic.AddInt64(&nIssues, int64(len(issues)))
            if len(issues) > 0 {
                mu.Lock()
                issuesByFile[p] = issues
                mu.Unlock()
            }
        })
        return nil
    })
    if err != nil {
        fmt.Fprintln(os.Stderr, "walk:", err)
        os.Exit(1)
    }

    pool.StopWait()

    fmt.Printf("lint complete: %d files, %d issues\n", nFiles, nIssues)
    for f, ii := range issuesByFile {
        for _, msg := range ii {
            fmt.Printf("%s: %s\n", f, msg)
        }
    }
}

func fakeLint(path string) []string {
    // Pretend to do work.
    time.Sleep(50 * time.Millisecond)
    if strings.Contains(path, "deprecated") {
        return []string{"contains the word 'deprecated' in filename"}
    }
    return nil
}
```

The interesting thing about this walkthrough is the *interaction between `filepath.WalkDir` and the pool*. Walk is synchronous; each call to `pool.Submit` returns immediately (because the queue is unbounded), so the walk does not slow down. The walk finishes quickly even on a giant tree; the pool then takes whatever time it needs to drain.

If you swapped `pool.Submit` for `pool.SubmitWait`, the walk would slow to the pace of the slowest worker — a useful backpressure pattern when the tree is enormous and you do not want to queue every file in memory.

Try both styles and watch your memory:

```bash
go run . /usr/local/go/src
```

Notice how `Submit` gives near-instant completion of the walk and then drains, while `SubmitWait` paces the walk to the workers.

---

## Glossary of Idioms

A consolidation of the patterns this file uses repeatedly:

- **`defer pool.StopWait()`** — the lifecycle bookend.
- **`item := item`** — the loop-variable shadow.
- **`atomic.AddInt64`** — the lock-free counter.
- **`var mu sync.Mutex; mu.Lock()` ...** — the simplest shared-state guard.
- **`sem := make(chan struct{}, N)`** — the semaphore for bounded queueing.
- **`context.WithTimeout`** — per-task cancellation handed into the closure.
- **`errors.Join(errs...)`** — collected-error aggregation.
- **`go produce()` then `<-sigs`** — the signal-driven shutdown shape.

Memorise these and 90% of your `workerpool` code will write itself.

---

That is the full junior tour. Move on to the middle file when you are comfortable typing the cheat-sheet skeleton from memory and have written at least one program that uses the library end to end.



