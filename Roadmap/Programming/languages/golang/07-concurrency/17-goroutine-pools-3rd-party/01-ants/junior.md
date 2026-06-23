---
layout: default
title: Junior
parent: ants
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/01-ants/junior/
---

# ants — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Why a Goroutine Pool At All](#why-a-goroutine-pool-at-all)
5. [Installing ants](#installing-ants)
6. [Your First Pool](#your-first-pool)
7. [Core Concepts](#core-concepts)
8. [Real-World Analogies](#real-world-analogies)
9. [Mental Models](#mental-models)
10. [Pros & Cons](#pros--cons)
11. [Use Cases](#use-cases)
12. [Code Examples](#code-examples)
13. [The Lifecycle of a Pool](#the-lifecycle-of-a-pool)
14. [Submit, Capacity, and Backpressure](#submit-capacity-and-backpressure)
15. [Waiting for Tasks](#waiting-for-tasks)
16. [Clean Code](#clean-code)
17. [Error Handling](#error-handling)
18. [Performance Tips](#performance-tips)
19. [Best Practices](#best-practices)
20. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
21. [Common Mistakes](#common-mistakes)
22. [Common Misconceptions](#common-misconceptions)
23. [Tricky Points](#tricky-points)
24. [Test](#test)
25. [Tricky Questions](#tricky-questions)
26. [Cheat Sheet](#cheat-sheet)
27. [Self-Assessment Checklist](#self-assessment-checklist)
28. [Summary](#summary)
29. [What You Can Build](#what-you-can-build)
30. [Further Reading](#further-reading)
31. [Related Topics](#related-topics)
32. [Diagrams](#diagrams)

---

## Introduction

> Focus: "Why would I ever use a pool of goroutines? Aren't goroutines already cheap? How do I create one with `ants` and submit work to it?"

In Go, the textbook answer to "how do I run this function concurrently?" is one line:

```go
go doWork()
```

That line is so cheap — a goroutine starts at ~2 KB of stack and is scheduled by the Go runtime, not the OS — that for most programs you can keep going forever. A web server spins up a goroutine per request, a batch job spins up a goroutine per file, and the runtime cleans up after itself.

But "cheap" is not "free." If your program has to run **millions** of tasks per second, or if it has to keep a long-running fan-out under control, or if it has to enforce a strict ceiling like "we will never have more than 200 outbound HTTP requests in flight," then unbounded `go f()` starts to bite. The stack still has to be allocated. The `g` struct still has to be created. The GC still has to scan it. The scheduler still has to look at it. Memory still has to be charged against your container limit. Eventually you OOM under burst, or you hit your file-descriptor ceiling because every goroutine was holding an open connection.

A **goroutine pool** is the solution: a fixed (or dynamically tuned) set of long-lived worker goroutines that pull tasks from a shared queue. Instead of `go f()`, you call `pool.Submit(f)`. The pool, not Go's runtime, decides where and when `f` runs.

`ants` (pronounced like the insect, but the GitHub user is `panjf2000`) is the most widely used goroutine pool library in the Go ecosystem. It is fast, well-maintained, idiomatic, and small enough that you can read the whole thing in an afternoon. This file is your first look at it. By the end you will:

- Understand the *problem* a pool solves and the cost it pays.
- Know how to import `github.com/panjf2000/ants/v2` and call `NewPool`.
- Know what `Submit` does, what `Release` does, and what happens to a submitted task.
- Be able to coordinate "wait for all tasks" using `sync.WaitGroup`.
- Recognise the most common first-time mistakes — forgetting `Release`, capturing loop variables, ignoring the `error` return from `Submit`.
- Have an intuition for "what is the right capacity?" — not yet a formula, but a feel.

You do **not** need to understand the internals (worker stack, lock-free path, `MultiPool`, options like `WithExpiryDuration`). All of that comes later. This file is the first 80% of what most users ever need.

---

## Prerequisites

- **Required:** Working Go installation, version 1.18 or newer (the v2 API uses generics in some helpers; pre-generics Go technically works for the non-generic types). Check with `go version`.
- **Required:** Comfort writing `go doWork()` and waiting for it with `sync.WaitGroup`. If "wait for ten goroutines to finish" is not yet automatic, read the `01-goroutines` subsection first.
- **Required:** Familiarity with closures: `func() { doSomething(x) }` and what variables it captures. This bites every beginner who uses pools.
- **Required:** `go mod init` and `go get` — you need a Go module to import the library.
- **Helpful:** Awareness of channels and `select`, since `ants` internally uses a channel-based handoff between caller and worker.
- **Helpful:** Any prior experience with thread pools (Java's `ExecutorService`, Python's `ThreadPoolExecutor`, .NET's `ThreadPool`) — the mental model carries over.

If you can write a small program that spawns 100 goroutines, prints their index, and waits for all of them with `sync.WaitGroup`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Goroutine pool** | A reusable set of long-lived goroutines (workers) that pull tasks from a queue. The number of workers is bounded, so the concurrency level of your program is bounded. |
| **Worker** | A single long-lived goroutine inside the pool. It loops: receive task, run task, return self to the pool. Internally `ants` calls these `goWorker`. |
| **Task** | A `func()` (or, for `PoolWithFunc`, an `interface{}` argument bound to a fixed function). It is what `Submit`/`Invoke` schedules. |
| **Capacity** | The maximum number of workers a pool will ever have at the same time. Passed to `NewPool(size)`. The literal upper bound on concurrent task execution. |
| **Running** | The current number of workers that are actively executing a task. Always `<= Cap()`. |
| **Free** | `Cap() - Running()`. The number of additional tasks the pool could pick up *right now* without queueing. |
| **`Submit(task)`** | Hand a `func()` to the pool. Returns `nil` on success or `ErrPoolOverload` / `ErrPoolClosed`. The default behaviour is *blocking* — `Submit` waits until a worker is free. |
| **`Release()`** | Signal that no more tasks will be submitted and tear down the pool. Workers exit, internal goroutines stop, memory is released. Idempotent in v2. |
| **`Tune(size)`** | Change the pool capacity at runtime. Safe to call concurrently with `Submit`. |
| **`PoolWithFunc`** | A specialised pool that runs the *same function* with different arguments. Slightly faster than `Pool` because the function pointer is stored once. Submitted with `Invoke(arg)`. |
| **`MultiPool`** | A sharded `Pool` of `Pool`s. Used when a single pool's lock becomes the bottleneck. Covered in `senior.md`. |
| **`Option`** | A functional-options value (`ants.Option`) that configures a pool. Passed as variadic to `NewPool(size, opts...)`. |
| **`ErrPoolOverload`** | Returned by `Submit` when the pool is full *and* configured `WithNonblocking(true)`. With default blocking mode, `Submit` waits instead of returning this error. |
| **`ErrPoolClosed`** | Returned by `Submit` after `Release` has been called. |
| **Expiry / cleanup** | Idle workers (workers that have been waiting for a task longer than `WithExpiryDuration`) are killed by a background janitor. Default: 1 second. |

Keep this table next to you for the rest of the file.

---

## Why a Goroutine Pool At All

Before the API, the motivation. Two reasons people reach for `ants`:

### Reason 1 — Bound the concurrency

Imagine a service that scans S3 for files and downloads each one. Naive code:

```go
for _, key := range keys {
	key := key
	go download(key)
}
```

If `keys` has a million entries, you have spawned a million goroutines. Each one opens a TCP connection. Each one allocates ~2 KB of stack which grows on first read into ~8 KB. That is at least 8 GB of stack memory before any download data is buffered. You will be killed by the OOM killer or rate-limited by S3 before you even reach the first 100k.

A pool with capacity 200 caps this at "200 goroutines, 200 sockets, ~1.6 MB of stack." The 999_800 other tasks wait their turn. The program may be slower in wall-clock terms (depending on bandwidth), but it survives.

### Reason 2 — Recycle the goroutine

Even if you only ever have ~10k goroutines alive, *creating and destroying them* every few microseconds is not free. The runtime allocates a `g` struct, a stack, and registers the goroutine with the scheduler. Then GC has to scan it. Under millions of short tasks per second, this becomes measurable. A pool keeps the same `g` alive forever and lets the worker function loop, so no per-task allocation happens.

`ants` benchmarks at the time of writing show ~2-6× lower memory and modestly higher throughput vs unbounded `go f()` for sustained short-task workloads. That is the second pitch.

### When you should *not* reach for a pool

- Your program spawns at most a few hundred goroutines total — pool is pure overhead.
- Your tasks are long-running (seconds, minutes) — the goroutine creation cost is irrelevant; you should think about cancellation and observability instead.
- You actually want **structured cancellation** more than concurrency limits — `errgroup` or `golang.org/x/sync/semaphore` may be a better fit.

A pool is a tool for **high-throughput, short-task, bounded-concurrency** workloads. If you do not have all three properties, you may not need a pool at all.

---

## Installing ants

`ants` is a normal Go module. In a project with a `go.mod` file:

```bash
go get github.com/panjf2000/ants/v2
```

Then in your code:

```go
import "github.com/panjf2000/ants/v2"
```

Two notes that catch beginners:

1. The module path **must** end in `/v2`. If you write `import "github.com/panjf2000/ants"` you will pull the v1 API, which is missing functional options and is not what the rest of this subsection covers.
2. The package name inside Go code is `ants`, not `antsv2`. So `ants.NewPool`, `ants.Submit`, `ants.WithNonblocking`, regardless of which version you imported.

Verify your install:

```go
package main

import (
	"fmt"

	"github.com/panjf2000/ants/v2"
)

func main() {
	p, err := ants.NewPool(10)
	if err != nil {
		panic(err)
	}
	defer p.Release()
	fmt.Println("pool capacity:", p.Cap())
}
```

Running this should print:

```
pool capacity: 10
```

If you instead get `cannot find package`, your `go.mod` is wrong — run `go mod tidy` and try again.

---

## Your First Pool

The simplest useful program:

```go
package main

import (
	"fmt"
	"sync"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, err := ants.NewPool(5)
	if err != nil {
		panic(err)
	}
	defer pool.Release()

	var wg sync.WaitGroup
	for i := 1; i <= 20; i++ {
		wg.Add(1)
		i := i
		_ = pool.Submit(func() {
			defer wg.Done()
			fmt.Printf("task %d running\n", i)
			time.Sleep(100 * time.Millisecond)
		})
	}
	wg.Wait()
	fmt.Println("done")
}
```

Run it. Twenty tasks, capacity 5 — so 5 tasks run in parallel, the rest wait. After ~400 ms the program prints `done`.

Let's break it down carefully because every line is a teachable moment.

### Line by line

```go
pool, err := ants.NewPool(5)
```

`NewPool` takes a positive integer (the capacity) and returns `(*Pool, error)`. The pool is created in a "ready" state — its background janitor goroutine starts immediately, but no worker goroutines exist yet. Workers are spawned lazily on first `Submit`. Capacity 5 means the pool will *never* exceed 5 concurrent workers.

Why does `NewPool` return an error? Because the size must be positive. `ants.NewPool(0)` returns `nil, ants.ErrInvalidPoolSize`. (Negative sizes are also rejected.) There is a special function `ants.NewPool(-1)` — yes, negative one specifically — which creates an *unlimited* pool (covered in `middle.md`). We will ignore that for now.

```go
defer pool.Release()
```

This is the most important line in the program. `Release` shuts down the pool. If you forget it, the workers, the janitor, and any goroutines blocked in `Submit` all leak. Even though the pool will be garbage collected eventually if nothing references it, the workers themselves are referenced by internal slices and will not be cleaned up by the GC. **Always defer `Release`.**

```go
_ = pool.Submit(func() {
	defer wg.Done()
	...
})
```

`Submit` takes a `func()` and queues it for execution by a worker. It returns `error`:

- `nil` — the task was accepted. It may or may not have started running yet.
- `ants.ErrPoolOverload` — the pool is full *and* you configured non-blocking mode. With the default options, `Submit` blocks instead of returning this error.
- `ants.ErrPoolClosed` — `Release` has already been called.

For a junior program, ignoring the error is acceptable. For production, never ignore it — covered later.

```go
i := i
```

The classic shadow. We re-declare `i` inside the loop body so that the closure captures a *fresh* variable on each iteration, not the shared loop variable. Without this, `task 20 running` would print twenty times (in Go ≤ 1.21). In Go 1.22+ the language was changed so the loop variable is per-iteration by default, but the explicit `i := i` is still recommended for clarity and for code that must compile under older versions.

```go
wg.Wait()
```

`Submit` returns *before* the task finishes. `Submit` returning nil only means "a worker has been assigned." If we did not wait, `main` might exit before any task got to print. The `WaitGroup` is the standard cross-goroutine "wait for them all" primitive. We covered it in the goroutines section.

### What does the output look like?

```
task 1 running
task 2 running
task 3 running
task 4 running
task 5 running
task 6 running
...
task 20 running
done
```

Order will vary — the Go scheduler can run any of the five workers in any order, and `Submit` to a busy pool will queue them in whatever order workers happen to become free. The only guarantees are:

- Exactly 20 lines print.
- No more than 5 are "running" at any instant.
- `done` is last.

Don't trust the order of printed lines. Ever. Treat goroutine output as a set, not a sequence.

---

## Core Concepts

### Concept 1 — The pool is a *bounded* concurrency primitive

`Cap()` is a contract. The pool will *not* exceed it. If you `Submit` more tasks than the pool can currently service, the rest are either:

- (default) **Blocked** — `Submit` does not return until a worker is free.
- (with `WithNonblocking(true)`) **Rejected** — `Submit` returns `ErrPoolOverload`.
- (with `WithMaxBlockingTasks(N)`) **Blocked, up to N callers** — caller N+1 is rejected.

That's it. There is no internal "queue of pending tasks" in v2 by default. The queue, conceptually, *is* the goroutines that are calling `Submit` and waiting. This is different from Java's `ExecutorService`, where a separate `BlockingQueue` decouples submission from execution. In `ants`, *callers* are the queue.

### Concept 2 — Workers live longer than tasks

A worker is a long-lived goroutine. When a task finishes, the worker does **not** exit. It returns itself to the pool's stack and waits for the next task. Only one of two things ever kills a worker:

1. **Idle expiry** — the worker has been waiting for a task longer than `WithExpiryDuration` (default 1 second). The janitor goroutine wakes it with a `nil` task, and the worker breaks its loop.
2. **`Release`** — the entire pool is torn down. All workers receive a "stop" signal.

A worker is *not* killed simply because a task panicked. The panic handler catches it (covered in `middle.md`), the worker logs the panic, and then keeps going. That is intentional — if a single bad task could kill a worker, every panic would shrink the pool by one.

### Concept 3 — `Submit` is not always immediate

If you call `Submit` and the pool is full, the calling goroutine blocks until a worker is free. This is your back-pressure. Your producer cannot outrun your consumer — at most, your producer can have one task per Goroutine waiting in `Submit`. If you do not want this, use `WithNonblocking(true)` and handle `ErrPoolOverload`.

This is a profound difference from `go f()`. `go f()` *always* returns immediately. `pool.Submit(f)` is conditional.

### Concept 4 — The pool is goroutine-safe

You can call `Submit` from many goroutines at once. You can call `Tune` from one goroutine while other goroutines are calling `Submit`. You can call `Running()` and `Free()` at any time. The only operation that requires care is `Release`: after `Release` returns, calling any other method on the pool either returns `ErrPoolClosed` or panics in older versions. Do not race `Release` against `Submit` — once you decide to release, your producers should already have stopped.

### Concept 5 — Workers run on the same OS threads as everything else

A pool is not a thread pool. It is a goroutine pool. The workers are still scheduled by Go's GMP scheduler onto the same `GOMAXPROCS` OS threads as every other goroutine in your program. You are not getting CPU affinity. You are not getting kernel-level isolation. What you *are* getting is:

- A predictable upper bound on goroutine count for this work.
- A `sync.Pool` cache of `goWorker` structs, so the per-task allocation cost is near zero.
- Bounded scheduler queue depth — far fewer `g`s in the run queues at any moment.

---

## Real-World Analogies

### The barber shop

Imagine a barbershop with five chairs and five barbers. Customers arrive and either:

- Sit down immediately if a chair is free (worker is idle).
- Wait in line if all chairs are taken (caller blocks in `Submit`).

When a customer leaves, the next person in line takes the chair. The barbers don't go home between customers — they wait in the chair. That's the worker. The chair is the slot. The line is the queue of blocked submitters.

When the shop closes (Release), the barbers go home, the line is told there's no more service, and the lights go out.

This is exactly the model `ants` implements, minus the haircut.

### The conveyor belt

Items arrive on a conveyor belt one by one. There are a fixed number of operators (workers). Each operator picks up one item, processes it, puts it down, and reaches for the next. If items arrive faster than they can be processed, the belt fills up behind them — that's the queue of blocked submitters.

You can speed up the line in two ways:

- Add more operators (`Tune` the pool up).
- Make each item faster to process (optimise the task).

You cannot make items appear faster than the operators can handle them without the belt overflowing. That's `ErrPoolOverload` in non-blocking mode.

### The thread pool you already know

If you've used Java's `ExecutorService.newFixedThreadPool(5)` or Python's `concurrent.futures.ThreadPoolExecutor(max_workers=5)`, the mental model is identical — minus the threads. Replace "thread" with "goroutine" and you're done. The main API differences:

- Java has explicit `Future` return values. `ants` does not — you bring your own (channel, `WaitGroup`, etc.).
- Java has a separate `BlockingQueue` for tasks. `ants` has the submitters themselves as the queue.
- Java's `shutdownNow()` interrupts in-flight tasks. `ants.Release` does not — running tasks complete normally; only the workers' *next* loop iteration sees the signal.

---

## Mental Models

### Model 1 — Pool = capped semaphore + recyclable executor

Conceptually, `Submit` is:

```
acquire(slot)   // wait if pool is full
runOnWorker(task)
release(slot)   // when task is done
```

This is *literally* what a counting semaphore + worker would do. `ants` is a more efficient implementation of that abstract pattern.

### Model 2 — Pool = LIFO stack of idle workers

Internally `ants.Pool` is a stack (LIFO) of idle workers plus a counter of "running" workers. `Submit`:

1. Increment running counter (or block if at capacity).
2. Pop a worker from the idle stack. If the stack is empty, allocate a new one (up to capacity).
3. Send the task to the worker via its private channel.

When the task finishes:

1. The worker puts itself back on the idle stack.
2. Decrement running counter.
3. If a blocked caller is waiting, wake them.

We will see the actual code in `senior.md`. For now, the picture is enough.

### Model 3 — The pool *is* the rate limiter

If your pool capacity is N, your effective task-execution rate is `min(N / avg_task_duration, producer_rate)`. The pool *forces* this. You do not have to add a rate limiter on top. Conversely, if you need a different rate (e.g. "10 ops/sec, but with N workers"), the pool is not your rate limiter — you need `golang.org/x/time/rate`.

---

## Pros & Cons

### Pros

- **Cap on concurrency.** No more "infinite goroutines" surprises. Easy to reason about peak memory.
- **Recycled workers.** Per-task overhead drops to "send on channel + run closure." No `g` struct allocation, no scheduler enqueue/dequeue churn.
- **Built-in back-pressure.** `Submit` blocks, so a slow consumer naturally slows down a fast producer. No bespoke channel plumbing needed.
- **Mature.** 13k+ stars, used in production, fuzzed, benchmarked, released regularly.
- **Small.** The entire library is ~1500 lines of Go. You can read it.

### Cons

- **It is not free.** You add a dependency and ~1.5 KB of stack per idle worker.
- **It introduces a fairness consideration.** If your tasks vary wildly in cost, a long task blocks a worker indefinitely.
- **`Submit` is *not* cancellation-aware.** There is no `ctx context.Context` parameter. If you want cancellation, you bring your own `select { case <-ctx.Done(): }` inside the task.
- **It is not a queue.** Tasks do not "stack up" anywhere visible. If you need a queue with introspection ("how many tasks pending?"), you must build one in front of the pool.
- **It is not a scheduler.** Tasks run in arbitrary order. No priorities, no deadlines.

---

## Use Cases

A pool shines when:

- **Web/RPC server fan-out.** One request triggers N parallel downstream calls. Without a pool, a slow client can DoS your server. With a pool of, say, 1000 downstream workers, you are guaranteed never to exceed 1000 in-flight outbound calls regardless of request rate.
- **Batch processing.** Crawling files, transforming images, scanning logs. The total work is huge; you want a bounded sliding window.
- **Connection pooling for non-pooled libraries.** If you talk to a service that doesn't have its own connection pool, you can wrap each call in a `Submit` and use the pool as your concurrency cap.
- **Event bus consumers.** A pool per topic, sized to that topic's tolerable concurrency, gives you topic-level isolation.

A pool is overkill when:

- You have a fixed, small number of long-running tasks. Use plain goroutines.
- Your concurrency is naturally bounded by something else (e.g. a `sync.Mutex` already serialises the work).
- You need *unordered* but *prioritised* execution. Pools don't prioritise — they FIFO over the worker stack with no notion of cost.

---

## Code Examples

### Example 1 — Bounded fan-out

Run 1000 jobs, but only 50 at a time.

```go
package main

import (
	"fmt"
	"sync"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(50)
	defer pool.Release()

	var wg sync.WaitGroup
	start := time.Now()
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		i := i
		_ = pool.Submit(func() {
			defer wg.Done()
			time.Sleep(10 * time.Millisecond)
			_ = i
		})
	}
	wg.Wait()
	fmt.Println("elapsed:", time.Since(start))
}
```

Each task sleeps 10 ms. With 50 workers and 1000 tasks, total time should be roughly `1000/50 * 10ms = 200 ms`. Add a little overhead and you'll see ~210–220 ms. If you remove the pool and just `go func()`, total time will be closer to 10 ms — but you'll have 1000 simultaneous goroutines, which is fine for this trivial example but disastrous at scale.

### Example 2 — Pool stats

You can ask the pool how it's doing.

```go
package main

import (
	"fmt"
	"sync"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(10)
	defer pool.Release()

	go func() {
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			fmt.Printf("running=%d free=%d cap=%d\n",
				pool.Running(), pool.Free(), pool.Cap())
		}
	}()

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			time.Sleep(200 * time.Millisecond)
		})
	}
	wg.Wait()
}
```

Output rhythms like:

```
running=10 free=0 cap=10
running=10 free=0 cap=10
running=10 free=0 cap=10
running=10 free=0 cap=10
running=10 free=0 cap=10
running=0  free=10 cap=10
```

For ~1 second you see 10 of 10 running, then the last batch drains and `running` drops. This is the simplest observability you get for free.

### Example 3 — Submitting from many producers

`Submit` is goroutine-safe. You can have many producers.

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(100)
	defer pool.Release()

	var done int64
	var wg sync.WaitGroup

	// 8 producers, each submitting 1000 tasks
	for p := 0; p < 8; p++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				_ = pool.Submit(func() {
					atomic.AddInt64(&done, 1)
				})
			}
		}()
	}
	wg.Wait()

	// All submits returned; some tasks may still be running.
	// Drain by polling Running.
	for pool.Running() > 0 {
	}
	fmt.Println("done:", atomic.LoadInt64(&done))
}
```

Output:

```
done: 8000
```

A few notes:

- We use `atomic.AddInt64` because `done` is touched from many workers. Reaching for `sync.Mutex` is also fine. Reaching for naked `done++` is a data race.
- `wg.Wait()` only waits for *producers*, not for *tasks*. After it returns, tasks are still draining. Adding the producer's `wg.Done` to the task itself would couple producer and consumer; the cleaner pattern is a second `WaitGroup` for tasks (shown in Example 1).
- The busy-loop `for pool.Running() > 0 {}` is a code smell. It works for a demo. In real code, count tasks with a `WaitGroup` instead.

### Example 4 — Forgetting `Release` and what happens

Here is the bug we will see ten times in our lives:

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	for i := 0; i < 5; i++ {
		pool, _ := ants.NewPool(100)
		// no defer pool.Release()
		var wg sync.WaitGroup
		for j := 0; j < 100; j++ {
			wg.Add(1)
			_ = pool.Submit(func() {
				defer wg.Done()
				time.Sleep(time.Millisecond)
			})
		}
		wg.Wait()
	}

	time.Sleep(2 * time.Second)
	fmt.Println("goroutines after 5 unreleased pools:", runtime.NumGoroutine())
}
```

Each pool spawned ~100 workers plus a janitor. None of them were released. After 5 iterations you have `5 * (100 + 1) + main + 1 (for runtime) ≈ 510` goroutines lingering. They will idle for `WithExpiryDuration` (default 1 second), at which point workers exit themselves — *but the janitor is still there*. And in some older versions of `ants`, the workers also stay because the janitor needs to be released first.

The takeaway is unambiguous: **`defer pool.Release()` immediately after `NewPool`. No exceptions.**

### Example 5 — A small worker farm with results

So far our tasks have only had side effects. To get *results* back, you need a channel:

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

type job struct {
	in  int
	out int
}

func main() {
	pool, _ := ants.NewPool(8)
	defer pool.Release()

	jobs := make([]*job, 100)
	for i := range jobs {
		jobs[i] = &job{in: i}
	}

	var wg sync.WaitGroup
	for _, j := range jobs {
		j := j
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			j.out = j.in * j.in
		})
	}
	wg.Wait()

	sum := 0
	for _, j := range jobs {
		sum += j.out
	}
	fmt.Println("sum of squares 0..99:", sum)
}
```

Output:

```
sum of squares 0..99: 328350
```

Each task mutates a private field on a private struct. No locks needed because each worker has exclusive ownership of its `*job`. After `wg.Wait()` the main goroutine has the data race-free view (the `WaitGroup` provides the happens-before).

### Example 6 — Returning errors from tasks

A task is `func()` — no error return. The convention is to capture errors into a slice (per-index), or into a channel, or into an `errgroup`-like wrapper (shown in `professional.md`).

```go
package main

import (
	"errors"
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(4)
	defer pool.Release()

	type result struct {
		i   int
		err error
	}
	results := make([]result, 10)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		i := i
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			if i%3 == 0 {
				results[i] = result{i, errors.New("divisible by 3")}
				return
			}
			results[i] = result{i, nil}
		})
	}
	wg.Wait()

	for _, r := range results {
		fmt.Printf("i=%d err=%v\n", r.i, r.err)
	}
}
```

Each task writes to a unique slot. No locking required, no race. This is the simplest pattern that produces per-task errors.

### Example 7 — Submitting the same closure many times

A subtle gotcha. This:

```go
for i := 0; i < 10; i++ {
	_ = pool.Submit(func() {
		fmt.Println(i)
	})
}
```

…prints `10` ten times in Go ≤ 1.21 because all closures share the same `i` variable. In Go 1.22+ it prints `0..9` in some order. Either way, *be explicit*:

```go
for i := 0; i < 10; i++ {
	i := i
	_ = pool.Submit(func() {
		fmt.Println(i)
	})
}
```

This is exactly the captured-loop-variable bug from `01-goroutines/junior.md`. It does not go away with pools — the closure is still the closure.

---

## The Lifecycle of a Pool

The mental movie:

```
                  +-----------+
NewPool(n) -----> | created   |
                  +-----------+
                       |
                       | first Submit
                       v
                  +-----------+         Submit (room available)
                  |   active  |<-------------------------------+
                  +-----------+                                |
                       |                                       |
                       | Submit (room full, blocking mode)     |
                       v                                       |
                  +-----------+   worker frees up              |
                  |  caller   |-------------------------------->
                  |  blocked  |
                  +-----------+
                       |
                       | Release()
                       v
                  +-----------+
                  |  closed   |  Submit -> ErrPoolClosed
                  +-----------+         Release is no-op (idempotent in v2)
```

Three states: `created`, `active`, `closed`. There is no "draining" state — `Release` does *not* wait for in-flight tasks. If you need that, use a `WaitGroup`.

### What `Release` actually does

In v2, `Release` performs roughly the following:

1. Set an internal `closed` flag with `atomic.CompareAndSwap`. If the flag was already set, return immediately (idempotency).
2. Iterate the idle worker stack. For each worker, send a `nil` task. The worker's loop interprets `nil` as "stop."
3. Wake any callers blocked in `Submit`. They observe the closed flag and return `ErrPoolClosed`.
4. Signal the janitor goroutine to stop and `<-` its exit channel.

Note what it does **not** do:

- It does not wait for running tasks to finish. A worker that is mid-task will complete its task, then check the closed flag on its next loop iteration, then exit. Your task is *not* interrupted.
- It does not cancel a `context.Context` passed to the task — there is no such context.
- It does not nil out the pool variable. You should not call `Submit` after `Release`, but the pool object stays valid until the GC collects it.

### `ReleaseTimeout` (v2.7+)

Some versions of `ants` expose `ReleaseTimeout(d time.Duration) error`. This is `Release` plus a wait for in-flight tasks, with a timeout. Useful for graceful shutdown. Covered in `middle.md` and `professional.md`.

---

## Submit, Capacity, and Backpressure

### What capacity actually means

`NewPool(N)` says "no more than N workers will ever exist at the same time." It does **not** say:

- "I will pre-allocate N workers." Workers are spawned on demand, up to N.
- "I will queue at most N pending tasks." There is no internal task queue. Pending tasks are the *callers blocked in Submit*.
- "I will use N OS threads." OS threads come from Go's `GOMAXPROCS`, unrelated.

### What happens at the boundary

Suppose `Cap=5`. Five tasks come in, all `Submit` return immediately, five workers start. A sixth task arrives:

- **Default (blocking).** `Submit(sixth)` blocks. The caller's goroutine sleeps inside `Submit` until one of the five workers finishes its current task. Then `Submit` returns nil.
- **`WithNonblocking(true)`.** `Submit(sixth)` returns `ErrPoolOverload`. The caller decides what to do — drop, retry, log.
- **`WithMaxBlockingTasks(M)`.** Up to M callers may block. Caller M+1 gets `ErrPoolOverload`. Default M is 0, which means unlimited blocking callers in blocking mode.

This is the entire surface of pool backpressure. There are no priority queues, no work-stealing across pools, no dropping policies. If you need something more elaborate, you build it on top.

### What is `Free`?

`Free() == Cap() - Running()`. It is the number of additional tasks the pool could pick up right now without anybody blocking. It is *not* "how much room in the queue" — there is no queue.

### When does `Submit` return?

`Submit` returns when:

- A worker has accepted the task and the task's `func()` has been sent to the worker's input channel. The task may or may not have *started running* yet — the worker might still be finishing its previous task, with this one queued in its (one-deep) channel.
- The pool is closed (returns `ErrPoolClosed`).
- The pool is full and the caller is configured to be rejected (returns `ErrPoolOverload`).

In particular, `Submit` does **not** wait for the task to *finish*. That is the caller's job.

---

## Waiting for Tasks

The canonical pattern is `sync.WaitGroup`:

```go
var wg sync.WaitGroup
for _, task := range tasks {
	wg.Add(1)
	task := task
	_ = pool.Submit(func() {
		defer wg.Done()
		runTask(task)
	})
}
wg.Wait()
```

Things to remember:

- `wg.Add` must happen **before** `Submit`, not inside the closure. If `Add` is inside the closure, `wg.Wait` may run before any `Add` happens and return immediately.
- `wg.Done` should be `defer`-red. Even if the task panics, the panic handler will recover, but `Done` would not run without `defer`, and you would deadlock.
- Do not call `wg.Wait` from inside a task. That would deadlock if the pool is full of tasks all waiting for each other.

### Alternative: channel of results

If you also need to collect results, replace the `WaitGroup` with a channel:

```go
results := make(chan int, len(tasks))
for _, t := range tasks {
	t := t
	_ = pool.Submit(func() {
		results <- compute(t)
	})
}
for i := 0; i < len(tasks); i++ {
	r := <-results
	_ = r
}
close(results)
```

You don't need a `WaitGroup` here because counting the receives is equivalent to counting the sends.

### Alternative: `errgroup`

`golang.org/x/sync/errgroup` does both — it counts tasks and propagates the first error. Combining it with `ants` is shown in `professional.md`.

---

## Clean Code

### Always defer Release

```go
pool, err := ants.NewPool(N)
if err != nil {
	return err
}
defer pool.Release()
```

If you need a pool that outlives a function (e.g. attached to a `Server`), `Release` belongs in the `Server.Close()` method, not in `New`. Either way, *somebody* defers it.

### Always check NewPool's error

`NewPool` only fails when you pass an invalid size. If your size is a compile-time positive constant, the error is impossible — but checking it costs nothing and protects you when the size becomes a variable.

```go
pool, err := ants.NewPool(cfg.PoolSize)
if err != nil {
	return fmt.Errorf("invalid pool size %d: %w", cfg.PoolSize, err)
}
```

### Always handle Submit's error

The two errors `Submit` can return are real:

- `ErrPoolOverload` — only in non-blocking mode, but if you forget to handle it, your task silently never runs.
- `ErrPoolClosed` — happens during shutdown. Forgetting to handle it means tasks silently disappear during shutdown.

Pattern:

```go
if err := pool.Submit(task); err != nil {
	// Decide: log, retry, fall back to inline execution
	log.Printf("submit failed: %v", err)
}
```

### Name your pools

If you have more than one pool in a program, give them context. A struct field or a package-level variable with a clear name is better than `globalPool`.

```go
type ImageService struct {
	resizePool   *ants.Pool
	uploadPool   *ants.Pool
}
```

That way error messages and logs are self-explaining.

### Don't expose the pool

The pool is an implementation detail. Wrap it.

```go
type Worker struct {
	pool *ants.Pool
}

func (w *Worker) Submit(task func()) error {
	return w.pool.Submit(task)
}
```

This lets you swap `ants` for a different implementation, or add observability, without rewriting callers.

---

## Error Handling

`ants` errors are simple sentinel values, exported from the package:

- `ants.ErrInvalidPoolSize` — returned by `NewPool(0)` or negative size other than `-1`.
- `ants.ErrInvalidPoolExpiry` — returned by `NewPool(N, WithExpiryDuration(0))`.
- `ants.ErrPoolOverload` — returned by `Submit`/`Invoke` when full and non-blocking or when `MaxBlockingTasks` is hit.
- `ants.ErrPoolClosed` — returned by `Submit`/`Invoke` after `Release`.

Compare with `errors.Is` for safety in newer versions:

```go
if err := pool.Submit(task); err != nil {
	if errors.Is(err, ants.ErrPoolClosed) {
		return // shutting down
	}
	if errors.Is(err, ants.ErrPoolOverload) {
		// fall back: run inline, drop, retry
	}
}
```

In v2 they are all `error`-typed package-level vars, so `==` comparison also works.

### Panics inside tasks

By default, a panic inside a task is caught by the worker, logged with `log.Printf` to stderr, and the worker continues running. This is good news for stability but bad news for visibility — your panic is buried in stderr. The `WithPanicHandler` option lets you install a callback. Covered in `middle.md`.

```go
pool, _ := ants.NewPool(10, ants.WithPanicHandler(func(p any) {
	log.Printf("task panic: %v", p)
}))
```

For now, the only thing to remember: **a panic in a task does not crash your program.** That is different from `go f()`, which crashes on panic.

---

## Performance Tips

These are juniors' tips. Senior performance is covered later.

### Tip 1 — Size the pool for the bottleneck

If your task is "make an HTTP call to a backend that can handle 100 concurrent requests," size your pool at ~100. Beyond that, you'll just see more queueing time and no extra throughput. Sometimes 1.2× is healthy to absorb jitter.

### Tip 2 — Don't size by CPU count for I/O work

CPU count is the right answer for CPU-bound tasks. For I/O-bound tasks, it's irrelevant. You want enough goroutines to keep the I/O channel saturated. That can mean hundreds or thousands.

### Tip 3 — One pool per workload, not one giant pool

If you have two workloads — say "image resize" (CPU-bound) and "S3 upload" (I/O-bound) — they have very different correct sizes. Two pools is fine. Sharing one pool means the slow workload starves the fast one.

### Tip 4 — Don't measure throughput with `time.Sleep`

It's tempting to write:

```go
for ... {
	_ = pool.Submit(func() { time.Sleep(1 * time.Millisecond) })
}
```

…and call that "1000 tasks/sec." It isn't a benchmark. `time.Sleep` doesn't measure pool overhead — it measures the OS timer. Use `time.Now`/`time.Since` around real work to learn anything useful.

### Tip 5 — Pre-warm if you know you'll burst

If you expect a sudden burst, you can pre-fill the pool by submitting trivial tasks until `Running()` reaches `Cap()`. The workers stay alive (within the expiry window) and the burst doesn't pay the worker-creation cost. This is rarely needed but worth knowing.

---

## Best Practices

A short, opinionated list:

1. **Defer `Release` next to `NewPool`.** Not in some other file. Not in some other function. Right there.
2. **Always check `Submit`'s error**, even if you think you're in blocking mode.
3. **Don't share a pool across unrelated workloads.** One pool per logical concern.
4. **Don't put your pool in package-level globals unless it really is global.** Tests get harder.
5. **Don't block inside a task** on a channel that nobody else will write to. You'll deadlock the worker.
6. **Don't call `Submit` from inside a task** if the pool might be full — you can deadlock.
7. **Don't expect order.** Tasks run in whatever order workers happen to pick them up.
8. **Log panics.** Install a `WithPanicHandler`. The default silent log is not enough in production.
9. **Document your pool's size in comments.** "Why 200?" should have an answer in the code.
10. **Re-tune for production.** The size that's perfect on your laptop is almost never right in production.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Capacity of 0

`ants.NewPool(0)` returns `nil, ErrInvalidPoolSize`. Always check the error.

### Pitfall 2 — Capacity of -1 = unlimited

`ants.NewPool(-1)` is a *valid* call and creates a pool with no upper bound. It will spawn as many workers as you submit tasks. This is rarely what you want — it's effectively `go f()` with a slight overhead. Use a real positive size.

### Pitfall 3 — Tasks submitted after Release silently disappear, *only* if you ignore the error

```go
defer pool.Release()
go pool.Submit(longRunningWork) // racing Release
```

If `Release` runs first, `Submit` returns `ErrPoolClosed`. If you ignore the error, your task vanishes. *Always* check.

### Pitfall 4 — A task panic does not propagate

The pool catches the panic. The caller of `Submit` does not see it. The `WaitGroup`'s `Done` will not run unless you `defer` it. If you forgot the `defer`, your `wg.Wait` will hang forever. **Always `defer wg.Done()`**.

### Pitfall 5 — Capacity of 1 makes the pool a serializer

`NewPool(1)` is a valid construct — every task runs strictly after the previous one. It's a glorified `sync.Mutex`. Don't write it by accident; if you really want a serializer, use a `sync.Mutex` or a single-buffer channel.

### Pitfall 6 — Holding a reference to the pool keeps it alive

Even after `Release`, if some other goroutine still has a reference and tries `Submit`, you get `ErrPoolClosed` — but the pool struct itself stays in memory until everyone drops the reference. Don't leak references in long-running structs.

### Pitfall 7 — Submit's blocking is *unbounded* by default

If your producers run forever and your consumer is slow, you can have arbitrarily many goroutines blocked in `Submit`. Each one is a goroutine. If you really need to cap "callers blocked in submit," use `WithMaxBlockingTasks(N)`.

### Pitfall 8 — The pool is not safe to copy

`*ants.Pool` is a pointer. Pass it, don't copy `*pool` by value. The internal mutex and slices break.

### Pitfall 9 — `runtime.GOMAXPROCS` still bounds you

Even with a pool of 10000, if `GOMAXPROCS=2`, only 2 CPU-bound goroutines run at once. The other 9998 will be scheduled in. For CPU-bound work, sizing past `GOMAXPROCS * k` (with `k` around 1–2) is wasted memory.

### Pitfall 10 — Pool capacity != throughput

A pool of 100 doesn't mean "100 tasks/sec." It means "up to 100 concurrent in-flight tasks." Throughput is `capacity / avg_duration`. If you don't know `avg_duration`, you don't know throughput. Measure.

---

## Common Mistakes

These are the most common errors in junior `ants` code reviews.

### Mistake 1 — No defer Release

```go
pool, _ := ants.NewPool(10)
// ... use pool ...
// missing pool.Release()
```

Fix: `defer pool.Release()` directly after `NewPool`.

### Mistake 2 — Captured loop variable

```go
for i := 0; i < 10; i++ {
	_ = pool.Submit(func() { fmt.Println(i) })
}
```

Fix: `i := i` inside the loop, or upgrade to Go 1.22+.

### Mistake 3 — wg.Done not deferred

```go
_ = pool.Submit(func() {
	doWork()
	wg.Done()
})
```

If `doWork` panics, `Done` does not run, and `Wait` hangs forever. Use `defer wg.Done()`.

### Mistake 4 — wg.Add inside the goroutine

```go
for ... {
	_ = pool.Submit(func() {
		wg.Add(1)
		defer wg.Done()
		...
	})
}
wg.Wait() // may return immediately
```

`Add` happens *after* the calling goroutine returns to the loop, so `Wait` might see zero and exit. Always `wg.Add(1)` **before** `Submit`.

### Mistake 5 — Ignoring Submit's error

```go
pool.Submit(task) // no err check
```

If the pool is closed during shutdown, your task is silently dropped. Always check.

### Mistake 6 — Calling Release inside the task

```go
_ = pool.Submit(func() {
	defer pool.Release() // deadlock
	...
})
```

`Release` signals all workers and waits. The worker calling `Release` is one of the workers waiting to be signalled. Deadlock.

### Mistake 7 — Using `time.Sleep` for synchronisation

```go
_ = pool.Submit(taskA)
time.Sleep(1 * time.Second) // "wait for A"
_ = pool.Submit(taskB)
```

Use a channel or a `WaitGroup`. Time-based synchronisation is wrong even when it appears to work.

### Mistake 8 — Submitting non-closures

```go
_ = pool.Submit(doWork) // works only if doWork's signature is func()
_ = pool.Submit(doWork(1, 2)) // wrong — this is calling doWork right now
```

`Submit` takes `func()`. Bind your arguments via a closure: `_ = pool.Submit(func() { doWork(1, 2) })`.

### Mistake 9 — Treating Submit as fire-and-forget

`Submit` returning means "accepted." It doesn't mean "started" or "finished." If you `main()` exits right after, the task may never run.

### Mistake 10 — One huge pool for everything

A single global pool for HTTP requests, file I/O, and CPU work means each workload can starve the others. Three smaller pools, sized per workload, are almost always better.

---

## Common Misconceptions

### Misconception 1 — "It's faster than `go f()` for everything."

It is faster for **sustained, high-rate, short-duration** tasks. For a single one-off task, plain `go f()` is faster and simpler. Benchmark before you adopt.

### Misconception 2 — "It guarantees task order."

No. Submitted tasks are picked up by whichever worker is free, in whatever order Go's scheduler decides.

### Misconception 3 — "It pre-allocates workers."

No. Workers are created on demand. A freshly created `NewPool(1000)` has zero workers, one janitor goroutine, and no allocated stacks for tasks.

### Misconception 4 — "It cancels tasks on `Release`."

No. `Release` only signals **idle** workers to exit. In-flight tasks complete normally. If you need cancellation, plumb a `context.Context` into each task yourself.

### Misconception 5 — "`Submit` always returns immediately."

Only in non-blocking mode. In default blocking mode, `Submit` waits until a worker is free.

### Misconception 6 — "A panic kills the pool."

It does not. The default `goWorker` has a `recover()` and continues. Only the panic's task dies.

### Misconception 7 — "The pool gives me a `Future`."

It does not. `Submit` returns `error`, not a result. You bring your own result-collection mechanism (channel, slice, WaitGroup).

### Misconception 8 — "I should make the pool as big as possible."

A pool the size of a billion is identical to no pool at all. The point is the bound. Bigger pool == weaker bound. Choose a bound that protects what you care about (memory, sockets, downstream rate).

---

## Tricky Points

### Tricky 1 — Capacity changes are immediate but tasks aren't

`Tune(N)` updates the capacity *now*, but already-running tasks don't stop. If you shrink the pool from 100 to 10, you still have 100 running tasks until they each finish. New submits block until `Running <= 10`.

### Tricky 2 — `Free` can be negative briefly

In some older versions there's a tiny race window where `Running > Cap` (immediately after `Tune` down). The bug has been fixed; just don't rely on `Free >= 0` strictly. Use `if pool.Free() > 0` carefully.

### Tricky 3 — A goroutine blocked in `Submit` is real

It is a real `g` struct, with stack, scheduled by the runtime. Many blocked submitters consume memory. If your worry was "I want to bound goroutines," and you blocked-submit a million tasks, you have a million goroutines blocked in `Submit` plus N workers. That's not what you wanted.

### Tricky 4 — Pool inside pool

You can `Submit` a task that itself `Submit`s another task to the same pool. This is *fine* if the inner submit eventually succeeds without blocking. But if the outer task fills the pool with outer tasks first, every inner `Submit` blocks behind itself — classic deadlock. **Inner submits to the same pool are dangerous.** Use a different pool, or `Submit` to the same pool only from outside any of its tasks.

### Tricky 5 — Workers can run on any OS thread

A worker is a goroutine, not a thread. The scheduler may move it between threads. If your task uses OS-specific TLS (thread-local storage), you can't rely on it staying on one OS thread. Use `runtime.LockOSThread` inside the task if needed — covered in `senior.md`.

---

## Test

### Q1
What does `ants.NewPool(0)` return?

**A.** It returns `nil, ants.ErrInvalidPoolSize`. The error explains that the size must be positive (or exactly `-1` for unlimited).

### Q2
What happens if you `Submit` to a full pool in default (blocking) mode?

**A.** The calling goroutine blocks inside `Submit` until a worker becomes free. `Submit` does not return until then.

### Q3
What does `defer pool.Release()` actually do?

**A.** It schedules `Release` to be called when the enclosing function returns. `Release` signals all idle workers to stop, sets the closed flag, and stops the janitor goroutine. In-flight tasks are *not* interrupted.

### Q4
You write `for i := 0; i < 10; i++ { _ = pool.Submit(func() { fmt.Println(i) }) }` in Go 1.20. What might it print?

**A.** Up to ten copies of `10`. In Go 1.20 the loop variable `i` is shared by all closures, and by the time any worker runs the closure, `i` has reached `10`. Fix with `i := i` inside the loop.

### Q5
What is the difference between `Cap`, `Running`, and `Free`?

**A.** `Cap` is the upper limit. `Running` is how many workers are currently executing tasks. `Free` is `Cap - Running`, the count of workers that could pick up a task right now without blocking. Pending blocked submitters do *not* show up in `Running`.

### Q6
Is `Submit` thread-safe?

**A.** Yes. You can call `Submit` from many goroutines concurrently. The pool's internal data is protected by mutex / atomic operations.

### Q7
What happens if a task panics?

**A.** The pool's `goWorker` has a `recover()` in its loop. The panic is caught, the worker continues. By default the panic is logged with `log.Printf`. You can install a custom handler with `WithPanicHandler`.

### Q8
What is `ants.PoolWithFunc`?

**A.** A specialised pool that runs the *same function* with different arguments. You provide the function once at creation time and submit only the arguments via `Invoke(arg)`. Covered in `middle.md`.

### Q9
After `pool.Release()`, what does `pool.Submit(t)` return?

**A.** `ants.ErrPoolClosed`. Always check the error from `Submit`.

### Q10
How do you wait for all submitted tasks to finish?

**A.** Use a `sync.WaitGroup`: `Add(1)` before `Submit`, `defer wg.Done()` inside the task closure, `wg.Wait()` after submitting all.

### Q11
Why is `wg.Add(1)` outside the closure, not inside?

**A.** `Submit` returns before the closure runs. If `wg.Add(1)` were inside the closure, `wg.Wait()` could run before any `Add` completed and observe a counter of zero, returning immediately.

### Q12
What is the right pool size for HTTP downloads to a server that allows at most 50 concurrent requests?

**A.** Around 50. A little less is safer (40); more does not help and may exceed the server's limit.

### Q13
Does `Submit` block forever if the pool is closed mid-block?

**A.** No. `Release` wakes all blocked submitters, and they return `ErrPoolClosed`.

### Q14
What is `runtime.NumGoroutine` likely to show right after `NewPool(100)` and before any `Submit`?

**A.** A small number — your `main`, the runtime, plus the pool's janitor goroutine (one). The 100 workers are not pre-allocated.

### Q15
Is the pool safe to use after `defer pool.Release()` in `main()`?

**A.** Yes, until `main` returns. The defer fires only on return. While the function is alive, the pool is fully usable.

---

## Tricky Questions

### TQ1
**Q.** I have `ants.NewPool(10)`. I `Submit` 100 tasks in a tight loop. How many of my goroutines are alive at the peak?

**A.** It depends. If each task is instant, you may never have all 10 workers busy at once and `Submit` never blocks; you have 10 + the goroutine running the loop + janitor = ~12. If each task is slow, you have 10 workers + N blocked submitters + janitor + main, possibly ~100. The exact peak depends on task duration vs submit speed.

### TQ2
**Q.** I created two pools: `poolA` of cap 5, `poolB` of cap 5. Each task in `poolA` does `poolB.Submit`. Each task in `poolB` does `poolA.Submit`. What happens?

**A.** Possible deadlock. If `poolA` fills up with tasks that are all trying to submit to `poolB`, and `poolB` fills up with tasks that are all trying to submit to `poolA`, no worker can finish and no worker can take new work. The general rule: do not have cyclic submit dependencies between pools.

### TQ3
**Q.** Why does my pool of capacity 100 use barely any CPU even though I'm submitting 100 CPU-bound tasks per second?

**A.** Almost certainly `GOMAXPROCS` is small (e.g. 1 or 2 in a constrained container). Your tasks compete for the OS threads, not for pool slots. Check `runtime.GOMAXPROCS(0)`.

### TQ4
**Q.** Why does `pool.Free()` sometimes show a value greater than the number of tasks I'm sure are queued?

**A.** Because pending tasks are not queued *inside* the pool — they are queued as *blocked Submit callers*. `Free` measures only the workers, not the queue.

### TQ5
**Q.** I expected `Submit` to be lock-free. Why does `runtime/pprof` show contention on it?

**A.** In v2 there is a lock-free fast path (when a worker is available on the idle stack), but the slow path (pool is full, allocate a new worker, or wait) uses a mutex. Under contention you'll see the mutex in profiles. Covered in `senior.md`.

### TQ6
**Q.** Can I `Submit` from inside a task to the same pool, never deadlocking?

**A.** Only if you can guarantee the pool will not be full at the time of the inner submit. In general, do not do this. Use a different pool or a different mechanism.

### TQ7
**Q.** Why does my program leak goroutines after I `Release` the pool?

**A.** Likely you have callers blocked in `Submit` that *raced* `Release`. Or you forgot that `Release` does not interrupt running tasks, and one task is itself blocked forever (on a closed channel without a default, on a nil channel, etc.). Inspect goroutine dumps.

### TQ8
**Q.** Should I be using `ants.NewPool(-1)` for max throughput?

**A.** Almost never. `-1` means unlimited workers — at that point you've thrown away the pool's main benefit (bounded concurrency). If you want unlimited, use `go f()` directly.

### TQ9
**Q.** I call `Tune(5)` on a pool with 50 running tasks. What happens immediately?

**A.** The cap is updated to 5. Running tasks continue to completion. Once they finish, no new workers are spawned beyond 5. New submits block until `Running <= 5`. If a new submit arrives while `Running > 5`, it queues up (blocks). This is intentional — the cap is a *future* bound, not a *retroactive* cancellation.

### TQ10
**Q.** Is `defer pool.Release()` enough to prevent leaks?

**A.** It prevents *pool* leaks. It does not prevent *task* leaks — if your tasks block forever on something other than the pool, they will hang. `Release` does not interrupt them. You also need to ensure your tasks themselves are cancellable, usually with a `context.Context`.

---

## Cheat Sheet

```go
// Create a pool of size N.
pool, err := ants.NewPool(N)
if err != nil { /* size invalid */ }
defer pool.Release()

// Submit work. Blocks if the pool is full (default behaviour).
err = pool.Submit(func() {
	// do something
})

// Inspect.
pool.Cap()       // upper bound on workers
pool.Running()   // active workers
pool.Free()      // Cap - Running
pool.IsClosed()  // true after Release

// Resize.
pool.Tune(newSize)

// Wait for all submitted tasks (you bring this).
var wg sync.WaitGroup
wg.Add(1)
_ = pool.Submit(func() { defer wg.Done(); doIt() })
wg.Wait()

// Errors.
errors.Is(err, ants.ErrPoolClosed)
errors.Is(err, ants.ErrPoolOverload)
errors.Is(err, ants.ErrInvalidPoolSize)
```

---

## Self-Assessment Checklist

You are done with this file when you can:

- [ ] Explain why a goroutine pool exists, in two sentences, without reading.
- [ ] Write a program that creates a pool of size 10, submits 100 tasks, waits for all of them, and prints `Done`.
- [ ] Explain what happens when you `Submit` to a full pool (both blocking and non-blocking modes).
- [ ] Identify the captured-loop-variable bug in a 5-line snippet.
- [ ] Decide whether a given workload should use a pool or plain goroutines, and defend the choice.
- [ ] Read the source of `Pool.Submit` and `goWorker.run` without panicking. (Skim only — internals are in `senior.md`.)
- [ ] Distinguish between `Cap`, `Running`, and `Free`.
- [ ] State the difference between `Release` and "wait for in-flight tasks."
- [ ] List five common mistakes from this file from memory.

---

## Summary

`ants` is a goroutine pool — a fixed-size set of long-lived worker goroutines that you submit work to. The API surface for junior usage is tiny:

- `ants.NewPool(N)` to create.
- `pool.Submit(func())` to enqueue.
- `defer pool.Release()` to clean up.
- `pool.Running()`, `pool.Free()`, `pool.Cap()` to introspect.

Use a pool when you have many short tasks and you need to cap concurrency. Don't use a pool when you have a handful of long tasks or when the bound doesn't matter — plain goroutines are simpler and sometimes faster. Always `defer Release`. Always check `Submit`'s error. Always shadow the loop variable.

The internals — worker stack, lock-free path, expiry janitor, `MultiPool` sharding — are covered in `senior.md`. The richer API — `PoolWithFunc`, functional options, panic handler — is in `middle.md`. Production patterns are in `professional.md`.

---

## What You Can Build

After this file, you should be able to build:

- A bounded URL fetcher: submit one task per URL, pool of size 50, store results in a slice.
- A directory scanner: walk a tree, submit one task per file (e.g. compute MD5), aggregate results.
- A bulk inserter: read CSV rows, submit one task per row with rate-limited DB inserts.
- A simple worker farm with a stats endpoint exposing `Running`/`Free`/`Cap` over HTTP.

Production-grade versions (with cancellation, error propagation, and observability) are in `professional.md`.

---

## Further Reading

- The README and Go-Doc of [`github.com/panjf2000/ants`](https://github.com/panjf2000/ants).
- Andy Pan's original blog post introducing the design (linked from the GitHub README).
- The `ants_test.go` file in the repo — many small examples, including benchmarks.
- The Go blog post "Pipelines and cancellation" — for the broader picture of bounded concurrency in Go.
- `golang.org/x/sync/semaphore` — a lighter alternative when all you need is "cap N concurrent operations."

---

## Related Topics

- `01-goroutines` — the `go` keyword, the foundation. Reading the section's `junior.md` is a prerequisite.
- `02-sync-primitives` — `sync.WaitGroup`, `sync.Pool`, the building blocks `ants` itself uses.
- `15-concurrency-anti-patterns` — including "unbounded goroutines," the failure mode `ants` directly addresses.
- `16-goroutine-pools-stdlib` — building a small pool from `chan func()` and a few `WaitGroup`s. Read it; you'll appreciate `ants` more.
- `18-errgroup` — `errgroup.Group` provides "wait for all, propagate first error." It composes well with `ants`.
- `19-semaphore` — `golang.org/x/sync/semaphore` provides "N concurrent operations" without a pool of workers.

---

## Diagrams

### Diagram 1 — Submit on a non-full pool

```
caller                 pool                      worker
  |                     |                          |
  | Submit(f) --------->|                          |
  |                     | pop idle worker ------>  | (woken)
  |                     |                          |
  | <----- nil err -----|                          | run f()
  |                     |                          |
  | ...                 |                          | f() done
  |                     | <- push self idle -------|
  |                     |                          |
```

### Diagram 2 — Submit on a full pool (blocking)

```
caller                 pool                      worker_5
  |                     |                          | running task X
  | Submit(g) --------->|                          |
  |                     | no idle worker           |
  |        <----------- |  (waiting for one)       |
  | (blocked)           |                          |
  |                     |                          | task X done
  |                     | <- push self idle -------|
  |                     | pop worker ----------->  |
  | <---- nil err ------|                          | run g()
```

### Diagram 3 — Lifecycle

```
            +--------+   Submit (room)   +--------+
NewPool --> | active |------------------>| active |
            +--------+   Submit (full)   +--------+
                |          (blocked)         |
                | Release()                  | Release()
                v                            v
            +--------+                   +--------+
            | closed |                   | closed |
            +--------+                   +--------+
              Submit                       Submit
                 \                          /
                  +--> ErrPoolClosed <-----+
```

### Diagram 4 — Worker stack

```
top of stack ->  [worker_3]
                 [worker_7]
                 [worker_2]
                 [worker_5]
bot of stack ->  [worker_1]

Submit pops top; finishing worker pushes onto top.
LIFO chosen so that the most recently active worker is reused first —
its cache lines are still hot.
```

### Diagram 5 — Pool sized vs unsized

```
go f() naive       :  goroutines = O(submitted tasks)
ants.NewPool(N)    :  goroutines <= N + blocked_submitters + janitor
ants.NewPool(-1)   :  goroutines = O(submitted tasks) (same as naive)
```

Pick `N` to be the smallest number that gives you acceptable throughput. Anything bigger is wasted bound.

---

## Coding Patterns

This section gathers the patterns that come up most often when you start building real things with `ants`. Each one is intentionally small. Combine them as needed.

### Pattern 1 — Bounded worker farm with results

The most common shape. A producer enqueues, a fixed-size pool processes, results land in a channel that the main goroutine drains.

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

type input struct{ id, value int }
type output struct{ id, square int }

func main() {
	pool, _ := ants.NewPool(8)
	defer pool.Release()

	inputs := make([]input, 1000)
	for i := range inputs {
		inputs[i] = input{id: i, value: i}
	}

	out := make(chan output, len(inputs))
	var wg sync.WaitGroup

	for _, in := range inputs {
		in := in
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			out <- output{id: in.id, square: in.value * in.value}
		})
	}

	go func() {
		wg.Wait()
		close(out)
	}()

	sum := 0
	for o := range out {
		sum += o.square
	}
	fmt.Println("sum:", sum)
}
```

Three rules:

- Buffered `out` channel sized to the number of inputs — guarantees no worker blocks on send.
- `close(out)` happens in a separate goroutine that waits for the `WaitGroup`. Doing it inline would deadlock because the main goroutine is the drainer.
- Inputs are by value so the closure captures a copy. Pointers would also work — but then the producer must not mutate them after `Submit`.

### Pattern 2 — Per-task error bag

You want one error per task, not one global error.

```go
type task struct {
	id  int
	err error
}

tasks := make([]task, len(work))
for i, w := range work {
	tasks[i].id = i
	i, w := i, w
	wg.Add(1)
	_ = pool.Submit(func() {
		defer wg.Done()
		tasks[i].err = doWork(w)
	})
}
wg.Wait()

for _, t := range tasks {
	if t.err != nil {
		log.Printf("task %d failed: %v", t.id, t.err)
	}
}
```

Each task writes to a unique slot. No locks needed; the `WaitGroup` provides happens-before for the final read.

### Pattern 3 — First-error short-circuit

You want to stop as soon as one task errors. This is what `errgroup` exists for; here is the manual version.

```go
var (
	firstErr error
	once     sync.Once
	cancel   = make(chan struct{})
)

setErr := func(err error) {
	once.Do(func() {
		firstErr = err
		close(cancel)
	})
}

var wg sync.WaitGroup
for _, w := range work {
	w := w
	wg.Add(1)
	_ = pool.Submit(func() {
		defer wg.Done()
		select {
		case <-cancel:
			return
		default:
		}
		if err := doWork(w); err != nil {
			setErr(err)
		}
	})
}
wg.Wait()
if firstErr != nil {
	log.Fatal(firstErr)
}
```

`sync.Once` ensures only the *first* error is captured. The `cancel` channel lets later tasks short-circuit. This pattern is fine for ~10 tasks but ugly at scale — `errgroup` (see `professional.md`) is the right answer in production.

### Pattern 4 — Fan-out from a stream

Your inputs come from a channel, not a slice. The pool is a sink.

```go
package main

import (
	"sync"

	"github.com/panjf2000/ants/v2"
)

func consume(in <-chan int, pool *ants.Pool) {
	var wg sync.WaitGroup
	for x := range in {
		x := x
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			process(x)
		})
	}
	wg.Wait()
}

func process(x int) { _ = x }
```

This is the worker farm in stream form. Note how the producer (whatever is feeding `in`) naturally back-pressures on the consumer's pool: if the pool is full, `Submit` blocks, the `for x := range in` loop pauses, the upstream channel fills up, the upstream sender blocks. The whole pipeline self-throttles.

### Pattern 5 — Sequential per-key concurrency

Sometimes you want concurrent across keys but serial within a key. Trivial with a `sync.Map` of pools:

```go
type Sharder struct {
	pools sync.Map // map[string]*ants.Pool
}

func (s *Sharder) Submit(key string, task func()) error {
	p, _ := s.pools.LoadOrStore(key, mustPool(1)) // cap 1 ⇒ serial
	return p.(*ants.Pool).Submit(task)
}

func mustPool(cap int) *ants.Pool {
	p, _ := ants.NewPool(cap)
	return p
}
```

Each key gets a pool of capacity 1, so within-key order is preserved. Across keys, you have full concurrency. The downside: many tiny pools, and you need a janitor to release pools for stale keys. This is a sketch — for real production use, `MultiPool` (see `senior.md`) is the right primitive.

### Pattern 6 — Pre-warming

If you know a burst is coming, pre-spawn workers:

```go
pool, _ := ants.NewPool(200)

var wg sync.WaitGroup
for i := 0; i < 200; i++ {
	wg.Add(1)
	_ = pool.Submit(func() { defer wg.Done() })
}
wg.Wait()
// Now Running()==0 but the pool has 200 cached goWorkers in its sync.Pool.

// Burst:
for i := 0; i < 200; i++ {
	_ = pool.Submit(realWork)
}
```

Each pre-warm task is a no-op; afterward, the pool's `sync.Pool` cache is populated with reusable `goWorker` structs. The burst pays only the channel-send cost, not the allocation cost.

Rarely necessary, but useful at startup of a service that anticipates a known spike (e.g., a job scheduler fires at midnight).

### Pattern 7 — Timeout on Submit

Wrap `Submit` in a `select` with `time.After`:

```go
func submitWithTimeout(p *ants.Pool, task func(), d time.Duration) error {
	done := make(chan error, 1)
	go func() { done <- p.Submit(task) }()
	select {
	case err := <-done:
		return err
	case <-time.After(d):
		return errors.New("submit timeout")
	}
}
```

This is genuinely useful when you want a guarantee like "if my pool is full for more than 100 ms, return an error rather than block." Note the wrapper itself spawns a goroutine per call — if you call it a lot, this is wasteful. The cleaner alternative is `WithNonblocking(true) + WithMaxBlockingTasks(N)` from `middle.md`, plus a retry loop.

### Pattern 8 — Submit a typed argument cheaply

The `Submit(func())` signature forces you to wrap your argument in a closure. Each `Submit` is an allocation. If you have a tight loop, this matters. Two options:

- Use `PoolWithFunc` (next file). The argument is `interface{}` and there is no per-call closure allocation.
- Use a pre-allocated struct pool to recycle the closure:

```go
type ctx struct {
	x int
}
var ctxPool = sync.Pool{New: func() any { return new(ctx) }}

for i := 0; i < 1_000_000; i++ {
	c := ctxPool.Get().(*ctx)
	c.x = i
	_ = pool.Submit(func() {
		defer ctxPool.Put(c)
		work(c.x)
	})
}
```

Either approach drops the allocation cost. `PoolWithFunc` is simpler; the `sync.Pool` approach also works on regular `Pool`.

---

## Product Use / Feature

A few sketches of where you might use `ants` in real product code at junior level.

### Use case A — URL prefetcher

A web crawler wants to fetch a list of URLs as fast as possible without overwhelming the target server.

```go
type Crawler struct {
	pool   *ants.Pool
	client *http.Client
}

func NewCrawler(concurrency int) *Crawler {
	p, _ := ants.NewPool(concurrency)
	return &Crawler{pool: p, client: &http.Client{Timeout: 10 * time.Second}}
}

func (c *Crawler) Close() { c.pool.Release() }

func (c *Crawler) FetchAll(urls []string) []*http.Response {
	out := make([]*http.Response, len(urls))
	var wg sync.WaitGroup
	for i, u := range urls {
		i, u := i, u
		wg.Add(1)
		_ = c.pool.Submit(func() {
			defer wg.Done()
			resp, err := c.client.Get(u)
			if err != nil {
				return
			}
			out[i] = resp
		})
	}
	wg.Wait()
	return out
}
```

Production version would handle errors, rate limit, and respect `robots.txt`, but the shape is the same.

### Use case B — Bulk file hasher

Given a directory tree, compute MD5 of every file. Naive code spawns one goroutine per file, which OOMs at scale.

```go
type Hasher struct {
	pool *ants.Pool
}

func (h *Hasher) HashAll(paths []string) map[string]string {
	hashes := make(map[string]string)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, p := range paths {
		p := p
		wg.Add(1)
		_ = h.pool.Submit(func() {
			defer wg.Done()
			sum := md5sum(p)
			mu.Lock()
			hashes[p] = sum
			mu.Unlock()
		})
	}
	wg.Wait()
	return hashes
}
```

A pool of 32 workers is typically enough to saturate disk on an SSD. Plain `go f()` would queue thousands of file descriptors and quickly OOM or hit the FD limit.

### Use case C — Background notification dispatcher

An HTTP server wants to send notifications asynchronously without blocking the request thread.

```go
type Dispatcher struct {
	pool *ants.Pool
}

func (d *Dispatcher) Notify(user string, msg string) {
	_ = d.pool.Submit(func() {
		_ = sendPushNotification(user, msg)
	})
}
```

The request handler returns instantly; the actual send happens later on a pool worker. If the pool is full, `Submit` blocks (back-pressure on the API), or — better — use non-blocking mode and either drop or enqueue to a real queue (Redis, Kafka).

### Use case D — Connection-bounded scraping

A scraper that uses a third-party API with a hard 100-concurrent-request limit.

```go
pool, _ := ants.NewPool(100)
defer pool.Release()

for _, q := range queries {
	q := q
	_ = pool.Submit(func() { scrape(q) })
}
```

This *is* the rate limiter. As long as nobody else hits the API from this process, you cannot exceed 100 concurrent requests.

---

## Security Considerations

A junior section is the wrong place to go deep on security, but a few notes:

### S1 — A panicking task does not crash your program

This is mostly good. But it also means a panic-as-side-channel cannot be used to abort the program intentionally — if you *want* the program to crash on certain conditions, do not rely on `panic` inside a pooled task. Use `os.Exit` or log + return.

### S2 — Untrusted task functions are a bad idea

If you allow callers to submit *arbitrary* `func()` values to your pool (think: scripting, plugin systems), they can mutate any package-level state, leak goroutines, or block forever. `ants` does not sandbox tasks. Either trust your callers or wrap them in a watchdog.

### S3 — Resource exhaustion via Submit

If your pool is in blocking mode and your tasks come from an untrusted source (e.g., an HTTP handler), an attacker can fill the pool with slow tasks to deny service to other callers. Mitigations:

- Use `WithNonblocking(true)` and reject overload.
- Set per-task timeouts so no task can hold a worker forever.
- Run a separate pool per tenant / per source.

### S4 — Logging panic content

The default panic handler logs the panic value via `log.Printf`. If your tasks can panic with attacker-controlled data, that data ends up in logs. This is the standard logging hygiene issue, not unique to `ants` — sanitise.

---

## Tricky Points (extended)

### Tricky 6 — `Running` immediately after `Submit` may be 0

`Submit` returns after handing the task off, but the worker has not necessarily entered its function body yet. `pool.Running()` includes the worker only after it has begun executing. There is a tiny window in which `Submit` returned but `Running` did not yet increment.

In practice this is irrelevant for any reasonable program — by the time you read `Running` for monitoring, dozens of these races have averaged out — but it is worth knowing if you write a test like "after one Submit, Running must be 1." It might not be, instantaneously.

### Tricky 7 — `Tune` does not preempt

`Tune(N)` changes the cap. It does not interrupt running workers. If `Running > N`, you have to wait for tasks to finish before the cap is effective. There is no `Tune(N, killExcess=true)` flag.

### Tricky 8 — A nil `Submit` argument crashes the worker

`pool.Submit(nil)` passes `nil` as the task. The worker tries to call `nil()` and panics. The pool's recover catches it, so your program survives, but the task is silently dropped. There is no input validation in `Submit`. Don't pass nil.

### Tricky 9 — Submission rate is bound by `GOMAXPROCS`, not capacity

Your submission loop is itself a goroutine. If `GOMAXPROCS=1` and your workers are all running tight CPU-bound loops, your submitter never gets scheduled. Symptom: throughput is much lower than `capacity / avg_task_duration` would predict. Fix: increase `GOMAXPROCS`, or break long CPU tasks with `runtime.Gosched`.

### Tricky 10 — The "magic" `-1` size and `MultiPool`

`NewPool(-1)` exists for backwards compatibility and for code that wants an unbounded pool while still calling `Submit` (rather than `go`). It is semantically equivalent to `go f()`. The `MultiPool` (covered in `senior.md`) does *not* accept `-1` — its per-shard size must be positive.

---

## Test (extended)

### Q16
What does `defer pool.Release()` do if `Release` has already been called once?

**A.** In v2 it is a no-op — `Release` is idempotent. The second call returns nil and does nothing. In v1 the behaviour was less defensive.

### Q17
What is the difference between `Submit` and `Invoke`?

**A.** `Submit(func())` is on `Pool`. `Invoke(arg interface{})` is on `PoolWithFunc` — the function is set at pool creation, only the argument varies. `Invoke` avoids the per-call closure allocation that `Submit` requires.

### Q18
You have a pool of cap 100 and you call `Tune(10)`. There are 80 running workers. What does `Cap` return immediately after, and what does `Running` return?

**A.** `Cap` returns 10 (the new cap). `Running` returns 80 (the actual count). Over time, as the 80 tasks finish, `Running` will drop to 10 (or wherever new submits land).

### Q19
What happens if you `Submit` to a closed pool?

**A.** `Submit` returns `ants.ErrPoolClosed`. The task is not enqueued.

### Q20
Does `ants` use any global state?

**A.** Yes — `ants.Submit` (note: package-level function) and `ants.Default()` use a default global pool. For most apps you should create your own `*Pool` rather than using the global one. The default pool has `math.MaxInt32` capacity, which is effectively unlimited.

### Q21
How many goroutines does an unused fresh pool consume?

**A.** One — the janitor (also called the "purge" goroutine). Workers are not pre-allocated.

### Q22
If I want my submitter to *never* block, what should I do?

**A.** `ants.NewPool(N, ants.WithNonblocking(true))`. Then `Submit` either succeeds immediately or returns `ErrPoolOverload`. Always check the error.

### Q23
What is `WithMaxBlockingTasks` for?

**A.** In default (blocking) mode, it caps how many goroutines can be simultaneously blocked inside `Submit`. Caller `N+1` gets `ErrPoolOverload`. Default is 0 (unlimited blocked callers).

### Q24
Why might `Free()` return 0 even though I just released a worker?

**A.** Because between "task finished" and "worker returned to idle stack" there is a microscopic window. Or because another `Submit` already grabbed it. `Free` is best-effort, not transactionally precise.

### Q25
Does the pool serialise tasks if I set cap=1?

**A.** Yes. With cap=1 there is exactly one worker, so tasks run strictly one at a time, in submission order (within one submitter). It is a glorified mutex.

---

## More Code Examples

### Example 8 — Latency profile of Submit

How long does `Submit` take? Tiny program to find out:

```go
package main

import (
	"fmt"
	"sort"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(100)
	defer pool.Release()

	const N = 10000
	durs := make([]time.Duration, N)
	for i := 0; i < N; i++ {
		start := time.Now()
		_ = pool.Submit(func() {})
		durs[i] = time.Since(start)
	}

	sort.Slice(durs, func(i, j int) bool { return durs[i] < durs[j] })
	fmt.Printf("median: %v p99: %v max: %v\n",
		durs[N/2], durs[N*99/100], durs[N-1])
}
```

On a modern laptop you'll see medians under 1 µs with occasional p99 spikes when the worker stack is empty and a new goroutine has to be spawned. That overhead is what you're paying. For non-trivial tasks (anything taking > 100 µs), it's negligible.

### Example 9 — Hammered submit

What happens when 1000 producers hammer one pool with capacity 100?

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(100)
	defer pool.Release()

	var done int64
	var producers sync.WaitGroup

	start := time.Now()
	for p := 0; p < 1000; p++ {
		producers.Add(1)
		go func() {
			defer producers.Done()
			for i := 0; i < 100; i++ {
				_ = pool.Submit(func() {
					time.Sleep(1 * time.Millisecond)
					atomic.AddInt64(&done, 1)
				})
			}
		}()
	}
	producers.Wait()

	for atomic.LoadInt64(&done) < 100000 {
		time.Sleep(10 * time.Millisecond)
	}
	fmt.Println("elapsed:", time.Since(start))
}
```

1000 producers × 100 submits = 100k tasks, each 1 ms, on a pool of 100. Lower bound is `100000/100 * 1ms = 1s`. Real time will be ~1.1 s plus overhead. Notice that you have 1000 *blocked submitters* at any moment, which is 1000 goroutines on top of your 100 workers. That's fine — they're cheap — but if you started 10 million producers you'd want a queue instead.

### Example 10 — Mixed workloads in one program

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

func main() {
	cpuPool, _ := ants.NewPool(8) // = GOMAXPROCS
	ioPool, _ := ants.NewPool(200)
	defer cpuPool.Release()
	defer ioPool.Release()

	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(2)
		_ = cpuPool.Submit(func() { defer wg.Done(); cpuWork() })
		_ = ioPool.Submit(func() { defer wg.Done(); ioWork() })
	}
	wg.Wait()
	fmt.Println("done")
}

func cpuWork() { _ = 1 << 20 }
func ioWork()  { _ = 1 << 20 }
```

Two pools sized for their work. Same `WaitGroup`. Same goroutine-safe pattern. This is the most realistic shape of a real service.

### Example 11 — Submit with retry

If you use non-blocking mode and get overloaded, retry:

```go
package main

import (
	"time"

	"github.com/panjf2000/ants/v2"
)

func submitOrRetry(p *ants.Pool, task func()) error {
	for {
		err := p.Submit(task)
		if err == nil {
			return nil
		}
		if err == ants.ErrPoolClosed {
			return err
		}
		// err == ErrPoolOverload
		time.Sleep(time.Millisecond)
	}
}
```

In real code use exponential backoff, a max retry count, and a context for cancellation. The sketch shows the idea.

### Example 12 — Submit + select on context

A common need: "submit this task, but if my context is cancelled before it runs, give up."

```go
package main

import (
	"context"
	"errors"

	"github.com/panjf2000/ants/v2"
)

func submitCtx(ctx context.Context, p *ants.Pool, task func()) error {
	done := make(chan error, 1)
	go func() {
		done <- p.Submit(func() {
			select {
			case <-ctx.Done():
				return
			default:
			}
			task()
		})
	}()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return errors.New("submit cancelled")
	}
}
```

Two layers of `select`-on-context: one outside `Submit` so a long-block on `Submit` is cancellable, one inside the task so a task that hasn't started yet can short-circuit. Real code would push the spawn-a-goroutine-per-submit cost down, but the pattern is clear.

### Example 13 — Counting in-flight tasks externally

Sometimes you want to know how many submitted-but-not-finished tasks there are (which is *not* `Running` — that's the worker count, not the task count).

```go
package main

import (
	"fmt"
	"sync/atomic"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(50)
	defer pool.Release()

	var inflight int64

	for i := 0; i < 1000; i++ {
		atomic.AddInt64(&inflight, 1)
		_ = pool.Submit(func() {
			defer atomic.AddInt64(&inflight, -1)
			time.Sleep(time.Millisecond)
		})
	}

	for atomic.LoadInt64(&inflight) > 0 {
		fmt.Println("inflight:", atomic.LoadInt64(&inflight))
		time.Sleep(50 * time.Millisecond)
	}
}
```

This counter is *yours*, not the pool's. It includes tasks that are blocked in `Submit` waiting for a worker. Useful for "drain me before shutdown" logic.

### Example 14 — Submitting a method value

A common stumble: trying to submit a method directly.

```go
type Worker struct{ id int }

func (w *Worker) Process() { fmt.Println(w.id) }

func main() {
	pool, _ := ants.NewPool(4)
	defer pool.Release()

	w := &Worker{id: 1}
	_ = pool.Submit(w.Process) // legal: method value matches func()
}
```

`w.Process` is a method value with signature `func()`, so `Submit` accepts it. If your method takes arguments, you need a closure.

### Example 15 — Submitting many similar tasks via a slice

A frequent pattern. We've seen pieces of this, but here it is end-to-end.

```go
type batch struct {
	rows []row
	err  error
}

func processBatches(pool *ants.Pool, batches []*batch) {
	var wg sync.WaitGroup
	for _, b := range batches {
		b := b
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			b.err = processBatch(b.rows)
		})
	}
	wg.Wait()
	for i, b := range batches {
		if b.err != nil {
			log.Printf("batch %d failed: %v", i, b.err)
		}
	}
}

func processBatch(rows []row) error { _ = rows; return nil }

type row struct{}
```

Each batch is its own struct; closures capture pointers to it. After `wg.Wait()` you have per-batch errors. This is one of the most production-ready patterns for "process N independent units."

---

## Performance Tips (extended)

### Tip 6 — Use `PoolWithFunc` for hot loops

If you're submitting the same function with different arguments at high rate, `PoolWithFunc` (next file) skips the closure allocation. For low-throughput code (a few thousand submits per second), `Pool` is simpler and fine.

### Tip 7 — Watch GC under sustained submit

Each `Submit` of a closure allocates the closure on the heap. Sustained millions per second can move the GC pressure noticeably. If you see GC overhead in `pprof`, switch to `PoolWithFunc` or reuse closures via `sync.Pool`.

### Tip 8 — `GOMAXPROCS` matters for CPU-bound pools

If your pool serves CPU-bound tasks, sizing it past `GOMAXPROCS` is wasted. The extra workers will just contend for the same set of OS threads. For CPU work, `runtime.GOMAXPROCS(0)` is the right starting point.

### Tip 9 — One pool is rarely a bottleneck for the pool itself

Most of the time, the pool's own throughput is not your limit — your tasks are. If `pprof` shows `ants.Submit` as a hotspot under your workload, you have a *lot* of submission going on, and you should consider `MultiPool` or `PoolWithFunc`.

### Tip 10 — Don't mix metrics across pools

If you `Running()` two pools and add the numbers, the sum is meaningful but not what you'd think. The two pools may be sized differently; the right thing is to report each pool's `Running/Cap` ratio and treat them as separate signals.

---

## Edge Cases (extended)

### Edge 11 — `Tune(0)` is invalid

You cannot tune to 0. The library rejects it (returns silently or errors depending on version). To "stop accepting work" you `Release` the pool, not `Tune(0)`.

### Edge 12 — `Tune` to a size *equal* to current cap is a no-op

Trivial, but worth knowing: `Tune` is cheap and safe to call even if it does nothing.

### Edge 13 — Janitor wake-up frequency = `ExpiryDuration / 10` in some versions

By default the janitor wakes every ~100 ms (`ExpiryDuration / 10`, default 1 second). If your tasks are sub-microsecond and the pool is constantly busy, the janitor doesn't help much — workers are always reused. If your pool has long idle stretches, the janitor frees memory.

### Edge 14 — `nil` PanicHandler resets to default

If you call `WithPanicHandler(nil)`, you fall back to the default `log.Printf` behaviour. Some teams use this as a feature flag — "in tests, set panic handler to `t.Fatalf`; in prod, leave default."

### Edge 15 — Submitting `func()` with named arguments via reflection

Pointless trivia: you cannot submit a `reflect.Value` directly. Wrap it in a closure that calls `value.Call(args)`. The pool sees only the closure.

---

## Common Mistakes (extended)

### Mistake 11 — Submitting tasks that block on an unrelated lock

If a task waits on a lock held by another task in the same pool, and the pool is full, you can deadlock. Example: pool cap=1, task A holds lock L and submits task B which needs L. A is blocked waiting for B, B is blocked waiting for A's worker slot. Deadlock.

Rule of thumb: tasks should not hold locks across `Submit` boundaries.

### Mistake 12 — Treating `pool.Running()` as task count

`Running` is workers, not tasks. A submitted but not-yet-running task does not show up in `Running`. A submitted task being received by a worker also doesn't show until it starts. Use your own counter for "in-flight tasks" if you need that precision.

### Mistake 13 — Comparing `Submit` to `go f()` performance for one-off calls

For *one* task, `Submit` is slower than `go`. The pool's advantage shows up with many tasks where worker reuse amortises the setup. Benchmark with realistic batch sizes.

### Mistake 14 — Forgetting that `Release` does not wait

```go
pool, _ := ants.NewPool(10)
for ... { pool.Submit(...) }
pool.Release()
// Surprise: some tasks may still be running.
```

`Release` is synchronous on cleanup of idle workers, asynchronous w.r.t. in-flight tasks. To wait for tasks: use a `WaitGroup`, or call `ReleaseTimeout(d)` (v2.7+).

### Mistake 15 — Calling Tune from inside a task

```go
_ = pool.Submit(func() {
	pool.Tune(20) // legal but suspicious
	work()
})
```

`Tune` is goroutine-safe, so this won't crash. But it's almost always a code smell — you're letting your tasks change their own concurrency limit. Tune from a control plane (a goroutine watching metrics), not from work goroutines.

---

## Common Misconceptions (extended)

### Misconception 9 — "Pools make programs faster."

Pools make programs *more predictable* and sometimes *more efficient*. They rarely make programs faster in raw wall-clock terms — `go f()` is usually as fast or faster for everything except sustained high-rate workloads. The win is in resource control, not speed.

### Misconception 10 — "Cap should equal `GOMAXPROCS`."

Only for CPU-bound work. For I/O-bound work, cap is set by your downstream tolerance (max connections, rate limits, etc.), often much larger than `GOMAXPROCS`.

### Misconception 11 — "Submit is a queue operation."

It is not. There is no queue. Submit either (a) immediately assigns a worker, (b) immediately rejects, or (c) blocks the caller. The caller is the queue.

### Misconception 12 — "Pools provide fairness."

They don't. There is no priority, no fairness guarantee, and certainly no first-come-first-served between independent submitter goroutines. Submitters compete via the Go scheduler.

### Misconception 13 — "If I `Release`, the pool is safe to GC immediately."

The pool *struct* is GC-eligible when no references remain. But the internal goroutines have all received their stop signal in `Release`, so by the time `Release` returns, they're gone. The struct itself goes when the last user drops the reference.

---

## Best Practices (extended)

### BP 11 — Use the pool that fits the workload

CPU work: `cap = GOMAXPROCS`. I/O work: `cap = upstream concurrency budget`. Mixed work: split into two pools.

### BP 12 — Treat the pool as a dependency

If your `Service` struct uses a pool, accept it as a constructor argument, not a package-level global. This makes tests trivial and lets you swap implementations.

### BP 13 — Always include `pool.IsClosed()` checks in long-lived loops

If your producer runs forever, periodically check `pool.IsClosed()` (v2 helper) to break out gracefully during shutdown.

### BP 14 — Log when the pool reaches saturation

Once `Running == Cap` for too long, you know your pool is your bottleneck. Emit a metric: `if pool.Free() == 0 { metrics.PoolSaturated.Inc() }`. This is your earliest warning.

### BP 15 — Don't size pools by guess

Measure. Either record `Free()` over time and plot it (it should hover above zero), or load-test with a known input rate and find the cap that gives 95th percentile latency under your SLO.

---

## What You Can Build (extended)

After understanding everything above, you can build:

- **Bounded HTTP client.** A wrapper that holds a pool of N workers, each making outbound requests. Acts as a hard concurrency cap.
- **Parallel CSV processor.** Read a 10 GB CSV row by row, dispatch to workers, write results back to another CSV.
- **Image thumbnailer service.** REST endpoint takes a directory path, returns thumbnails. Pool sized by CPU count.
- **Bulk email sender.** Read mailing list, dispatch to a pool, respect provider's concurrent-send limit.
- **Web scraper.** Crawl with bounded concurrency, exact behaviour of the URL prefetcher in the use cases above.
- **Background indexer.** Subscribe to a stream of events, submit each to a worker that updates a search index.
- **Periodic poller.** A ticker submits a check to the pool every N seconds; the pool ensures no more than M checks run concurrently.

Each is ~50–200 lines once you wire up the pool, the `WaitGroup`, and the actual work.

---

## More Cheat Sheet

### Quick reference of common code shapes

```go
// Fan-out with results
out := make(chan R, N)
var wg sync.WaitGroup
for _, in := range inputs {
	in := in
	wg.Add(1)
	_ = pool.Submit(func() { defer wg.Done(); out <- process(in) })
}
go func() { wg.Wait(); close(out) }()
for r := range out { use(r) }

// Per-task error bag
errs := make([]error, len(inputs))
for i, in := range inputs {
	i, in := i, in
	wg.Add(1)
	_ = pool.Submit(func() { defer wg.Done(); errs[i] = process(in) })
}
wg.Wait()

// Single-error short-circuit (manual; use errgroup in prod)
var once sync.Once
var firstErr error
for _, in := range inputs {
	in := in
	wg.Add(1)
	_ = pool.Submit(func() {
		defer wg.Done()
		if err := process(in); err != nil {
			once.Do(func() { firstErr = err })
		}
	})
}
wg.Wait()
```

### Quick error-handling reference

```go
switch err := pool.Submit(task); {
case err == nil:
	// accepted
case errors.Is(err, ants.ErrPoolClosed):
	// shutting down, propagate
case errors.Is(err, ants.ErrPoolOverload):
	// drop, retry, or fall back to inline
default:
	// unexpected; log
}
```

---

## Self-Assessment Checklist (extended)

You should also be able to:

- [ ] Explain the difference between `Submit` and `Invoke`.
- [ ] Know when to choose `Pool` vs `PoolWithFunc` (`middle.md`).
- [ ] Draw the worker LIFO stack on paper and explain why it is LIFO.
- [ ] List the four sentinel errors of `ants` and what triggers each.
- [ ] Convert a naive `go f()` loop to a pooled version, including correct closure capture.
- [ ] Diagnose a hang where a task is blocked on a lock held by another task in the same pool.
- [ ] Estimate, given a task duration and a pool cap, the steady-state throughput.

---

## Summary (extended)

You learned:

- **What `ants` is** — a goroutine pool library, the most popular one in Go.
- **Why you'd use it** — to bound concurrency or to recycle workers under high task rate.
- **The smallest workflow** — `NewPool`, `Submit`, `Release`, with a `WaitGroup` to coordinate.
- **The lifecycle** — created, active, closed; `Release` is asynchronous w.r.t. in-flight tasks.
- **Common patterns** — fan-out with results, per-task errors, short-circuit, mixed pools.
- **Common mistakes** — leaking `Release`, captured loop variables, ignoring `Submit`'s error.
- **Common pitfalls** — `Submit` can block forever, panic does not propagate, nil tasks are silently dropped.
- **The mental model** — pool = bounded executor + LIFO worker stack + callers-as-queue.

In `middle.md` you'll meet `PoolWithFunc`, the functional-options API (`WithExpiryDuration`, `WithPanicHandler`, `WithNonblocking`, `WithMaxBlockingTasks`), and the operational tools (`Tune`, `ReleaseTimeout`). In `senior.md` you'll meet the internals — worker stack, lock-free fast path, locker fallback, `MultiPool`, MGRR strategies. In `professional.md` you'll meet production patterns: observability, multi-tenant pools, graceful shutdown, `errgroup` integration.

---

## A Walk-through Project — Bounded Web Crawler

To consolidate everything, let's build a small but realistic project: a bounded web crawler.

### Requirements

- Read a list of URLs from a text file.
- Fetch each URL, capping concurrency at 50.
- Save the body of each successful response to `out/<sanitised-url>`.
- Print a summary at the end: total, success, failure.

### Step 1 — Skeleton

```go
package main

import (
	"flag"
	"log"

	"github.com/panjf2000/ants/v2"
)

func main() {
	in := flag.String("in", "urls.txt", "input file")
	out := flag.String("out", "out", "output directory")
	concurrency := flag.Int("c", 50, "concurrency")
	flag.Parse()

	pool, err := ants.NewPool(*concurrency)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Release()

	_ = in
	_ = out
}
```

The pool is created, defer-released, and parameterised. Nothing exciting yet.

### Step 2 — Read URLs

```go
func readURLs(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var urls []string
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line != "" {
			urls = append(urls, line)
		}
	}
	return urls, s.Err()
}
```

Standard. Errors are propagated to `main`.

### Step 3 — Fetch one URL

```go
func fetch(client *http.Client, url, dst string) error {
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("%s: %s", url, resp.Status)
	}
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}
```

Simple HTTP-GET-and-save. Real production would handle redirects, retries, timeouts more carefully.

### Step 4 — Wire the pool

```go
func crawl(pool *ants.Pool, urls []string, outDir string) (success, fail int) {
	client := &http.Client{Timeout: 30 * time.Second}
	var wg sync.WaitGroup
	var s, f int64
	for _, u := range urls {
		u := u
		dst := filepath.Join(outDir, sanitise(u))
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			if err := fetch(client, u, dst); err != nil {
				atomic.AddInt64(&f, 1)
				return
			}
			atomic.AddInt64(&s, 1)
		})
	}
	wg.Wait()
	return int(s), int(f)
}

func sanitise(u string) string {
	return strings.NewReplacer("/", "_", ":", "_", "?", "_", "&", "_").Replace(u)
}
```

The pool caps concurrency. `WaitGroup` waits for all tasks. Atomic counters tally success/failure.

### Step 5 — Put it all together

```go
package main

import (
	"bufio"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	in := flag.String("in", "urls.txt", "input file")
	out := flag.String("out", "out", "output directory")
	concurrency := flag.Int("c", 50, "concurrency")
	flag.Parse()

	urls, err := readURLs(*in)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		log.Fatal(err)
	}

	pool, err := ants.NewPool(*concurrency)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Release()

	start := time.Now()
	s, f := crawl(pool, urls, *out)
	fmt.Printf("total=%d ok=%d fail=%d elapsed=%v\n",
		len(urls), s, f, time.Since(start))
}

// (readURLs, fetch, crawl, sanitise as above)
```

This entire program is ~80 lines and demonstrates every junior concept: pool creation, defer release, fan-out, captured loop variable (via `u := u`), `WaitGroup`, error counting, parameterised capacity. You can extend it (retries, robots.txt, rate limiting) without restructuring.

### Step 6 — Try misuse

Now try removing `defer pool.Release()`. Run the program. Then add `time.Sleep(10 * time.Second)` at the end and `runtime.NumGoroutine()` before each sleep. You will see the worker goroutines persist until the janitor cleans them up — visible evidence of why `Release` matters.

Try removing the `u := u`. With Go 1.21, you'll get a thousand fetches of the *last* URL only. With Go 1.22+, you might not see the bug at all. Either way, learn to spot the missing shadow.

Try setting `concurrency` to `1`. You will run sequentially, ~50× slower for a list of 50 URLs. This demonstrates why the cap matters.

Try setting `concurrency` to `10000`. The program runs fast initially, then your machine hits its file-descriptor limit (`ulimit -n`) and connections start failing. The pool is doing its job — it would have prevented this if you had picked a sane size.

### Step 7 — Add Observability

Add a goroutine that prints pool stats every second:

```go
go func() {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for range t.C {
		log.Printf("pool running=%d free=%d cap=%d", pool.Running(), pool.Free(), pool.Cap())
	}
}()
```

You will see `running=50 free=0` for most of the run, then `running=0 free=50` near the end as the queue drains. That's healthy saturation. If you see `running` stuck well below `cap`, your bottleneck is upstream (input file too small? slow disk?) not the pool. If you see `free=0` constantly, you might want to bump the cap (assuming downstream allows).

### Step 8 — Add Graceful Shutdown

```go
sigs := make(chan os.Signal, 1)
signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
go func() {
	<-sigs
	log.Println("shutdown received, releasing pool")
	pool.Release()
}()
```

When you hit Ctrl-C, the pool releases. In-flight fetches finish; queued submitters get `ErrPoolClosed`. Your tally at the end won't include the cancelled URLs. For a stronger guarantee, plumb a `context.Context` into each `fetch` and cancel it on signal.

This walkthrough is everything a junior should aim for. The next file teaches you how to make the same crawler more robust — non-blocking submit, panic handler, dynamic tuning — by introducing the functional options API.

---

## Closing Notes

You have made it through 3000+ lines of "junior" content. That seems like a lot for an apparently simple library, but the depth is intentional: most beginners *think* they understand `ants` after reading the README, and then they make four of the ten mistakes listed above in their first production pool. The goal of this file is for you not to be one of them.

A few habits to internalise:

1. **`defer pool.Release()` is the first line after `NewPool`.** Always.
2. **Closures capture by reference. Shadow your loop variable.** Always.
3. **`Submit` returns `error`. Handle it.** Always.
4. **A panic in a task does not crash your program.** Install a panic handler, especially in production.
5. **The pool is not a queue. Callers are.** If you want a real queue, build one in front.
6. **One pool per logical workload.** Don't share between CPU and I/O.
7. **Size by measurement, not by guess.** Add a metric, run a load test.
8. **The pool does not interrupt running tasks.** Plumb a context if you need cancellation.

The next file (`middle.md`) is where the API becomes powerful and you graduate from "use the pool" to "configure the pool correctly for production."

---

## Appendix A — Comparing Five Concurrency Idioms

To put `ants` in context, here are the five most common ways to do bounded concurrency in Go. Reading this side by side helps you decide when `ants` is the right tool.

### Idiom 1 — Plain `go f()`

```go
for _, x := range items {
	x := x
	go work(x)
}
```

Pros: simplest, zero dependencies. Cons: unbounded, no waiting, no error propagation. Suitable when items is small and bounded.

### Idiom 2 — Worker channel

```go
jobs := make(chan T)
var wg sync.WaitGroup
for i := 0; i < N; i++ {
	wg.Add(1)
	go func() {
		defer wg.Done()
		for j := range jobs {
			work(j)
		}
	}()
}
for _, x := range items {
	jobs <- x
}
close(jobs)
wg.Wait()
```

Pros: no dependencies, explicit, very flexible. Cons: more boilerplate, you handle errors and tuning manually. Suitable for medium-complexity in-process workers.

### Idiom 3 — `golang.org/x/sync/semaphore`

```go
sem := semaphore.NewWeighted(int64(N))
var wg sync.WaitGroup
for _, x := range items {
	if err := sem.Acquire(ctx, 1); err != nil { break }
	x := x
	wg.Add(1)
	go func() {
		defer sem.Release(1)
		defer wg.Done()
		work(x)
	}()
}
wg.Wait()
```

Pros: works with `context`, lightweight. Cons: still spawns goroutines per item — the semaphore caps concurrency but doesn't reuse goroutines. Suitable when you need context-aware acquisition.

### Idiom 4 — `errgroup` with limit

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(N)
for _, x := range items {
	x := x
	g.Go(func() error { return work(ctx, x) })
}
return g.Wait()
```

Pros: first-error short-circuit, context propagation, idiomatic. Cons: still spawns goroutines per task. Suitable for one-off batch operations.

### Idiom 5 — `ants` pool

```go
pool, _ := ants.NewPool(N)
defer pool.Release()
var wg sync.WaitGroup
for _, x := range items {
	x := x
	wg.Add(1)
	_ = pool.Submit(func() { defer wg.Done(); work(x) })
}
wg.Wait()
```

Pros: worker reuse, low per-task overhead, observability. Cons: separate dependency, no built-in error/context support. Suitable for sustained high-throughput workloads.

### When to pick each

| If you have... | Use |
|----------------|-----|
| A handful of tasks (<100 items) | Plain `go f()` |
| Need first-error short-circuit | `errgroup` |
| Need context-aware acquisition | `semaphore` |
| Need both context and a real pool | `errgroup` *over* `ants` (see `professional.md`) |
| Need a long-lived worker farm, sustained high rate | `ants` |
| Need millions of tasks/sec, allocations matter | `ants.PoolWithFunc` |
| Need multi-tenant isolation | `ants.MultiPool` |

Most real services end up combining: `errgroup` for the request-level fan-out, `ants` underneath for the actual worker recycling.

## Appendix B — A short script to demonstrate the cost of unbounded goroutines

Run this. Notice peak memory.

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"time"
)

func main() {
	var wg sync.WaitGroup
	const N = 500_000
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			time.Sleep(2 * time.Second)
		}()
	}
	time.Sleep(500 * time.Millisecond)
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	fmt.Printf("alloc=%d MB goroutines=%d\n",
		m.HeapAlloc/1024/1024, runtime.NumGoroutine())
	wg.Wait()
}
```

On a typical laptop you'll see something like:

```
alloc=900 MB goroutines=500001
```

Now do the same with `ants`:

```go
pool, _ := ants.NewPool(1000)
defer pool.Release()
for i := 0; i < N; i++ {
	wg.Add(1)
	_ = pool.Submit(func() {
		defer wg.Done()
		time.Sleep(2 * time.Second)
	})
}
```

Peak memory drops to ~20 MB. Goroutine count peaks around 1000 + blocked submitters (which are very cheap, mostly idle). That's the whole pitch in one experiment.

## Appendix C — Common reading errors of the source

When you do read the source in `senior.md`, beware:

- `goWorker.task` is a `chan func()` of size 1, not a buffer.
- The "idle stack" is actually a slice with `pop`/`push` semantics from the end (LIFO).
- `purgeStaleWorkers` is the janitor — not "purge all workers."
- `Pool.lock` is a `sync.Locker`, but in some build tags it is `internal.Spinlock`.

Even the names are sometimes misleading. The diagrams and walkthroughs in `senior.md` will help.

---



