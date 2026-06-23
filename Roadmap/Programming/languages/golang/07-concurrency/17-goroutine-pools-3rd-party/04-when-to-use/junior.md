---
layout: default
title: Junior
parent: When to Use a Pool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/04-when-to-use/junior/
---

# When to Use a Pool — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [The Simple Decision Tree](#the-simple-decision-tree)
8. [Code Examples](#code-examples)
9. [Side-by-Side Comparison](#side-by-side-comparison)
10. [When Raw Goroutines Are Fine](#when-raw-goroutines-are-fine)
11. [When You Definitely Need Something](#when-you-definitely-need-something)
12. [Coding Patterns](#coding-patterns)
13. [Clean Code](#clean-code)
14. [Error Handling](#error-handling)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "I have learned about goroutines and channels. I have heard about pools. When do I actually need one, and when am I just adding code for no reason?"

You have arrived at a question every Go programmer hits within their first few months of working with concurrency. You write a small program that spawns 10 goroutines and it works. You write one that spawns 10,000 and it still works. Someone tells you about a library called `ants` that pools goroutines and you wonder: should you use it everywhere? Should you use it sometimes? Should you use it at all?

The short answer is that most of the time you do not need a third-party pool. The Go runtime is very good at scheduling goroutines, and the standard library — specifically `golang.org/x/sync/errgroup` — already gives you everything you need for the vast majority of "limit concurrent work" cases. Third-party pools shine in specific situations: when you are creating goroutines at extreme rates (hundreds of thousands per second), when you need worker reuse for warm state, when you need features that errgroup does not provide (metrics, dynamic resizing, non-blocking submit). For typical web servers, batch processors, and CLI tools, you almost never need them.

The trap is that pools *look* like a best practice — they look like the "professional" choice — when in fact they often add complexity, hide bugs, and slow things down. This document teaches you to recognise the small number of cases where a pool is the right tool, and the much larger number of cases where it is not.

After reading this file you will:

- Understand why "raw goroutine" is often the right answer
- Be able to draw a decision tree from "I have a parallel workload" to one of four answers: raw goroutines, `errgroup`, `semaphore`, or a third-party pool
- Recognise the three problems pools actually solve
- Write equivalent code in three styles — raw goroutines, errgroup, and an `ants` pool — and tell which is appropriate
- Know how to bound concurrency in standard-library Go with one line
- Avoid the "I added a pool because pools are good" anti-pattern
- Read code that uses pools and assess whether the pool was necessary

You do not need to know about the internals of ants, the locking strategies in tunny, or the allocation patterns of workerpool yet. Those come at the middle and senior levels. This file is about the question that comes first: *do I even need a pool?*

---

## Prerequisites

- **Required:** You have written goroutines with the `go` keyword and waited for them with `sync.WaitGroup`. Comfortable with `go f()` and `wg.Add(1); defer wg.Done()`.
- **Required:** You have used channels for at least basic producer/consumer coordination.
- **Required:** You have a Go installation 1.18 or newer (1.21+ recommended). `golang.org/x/sync` should be on your `GOPATH` or in your module.
- **Helpful:** You have read the previous topics in this concurrency track — at least `01-goroutines`, `02-channels`, and the earlier files in `17-goroutine-pools-3rd-party`.
- **Helpful:** You have at least seen the words "OOM kill" in a production context. If not, "OOM" is when the kernel kills your process for using too much memory.
- **Helpful:** You have written or read code that calls an external API in parallel — a fan-out over a list of URLs is the canonical example.

If you can write a program that fetches 5 URLs in parallel and waits for all of them, you are ready.

---

## Glossary

| Term | Definition |
|------|------------|
| **Goroutine** | A lightweight unit of execution managed by the Go runtime. Cheap to spawn (a few KB) but not free. |
| **Pool** | A reusable set of goroutines (workers) that pull tasks from a queue. The opposite of "spawn a goroutine per task." |
| **Worker** | A long-lived goroutine inside a pool that loops over incoming tasks. |
| **Task** | A unit of work submitted to a pool. Usually a function value `func()` or a typed input. |
| **Raw goroutine** | A goroutine started with `go f()` and not part of any pool. Sometimes called "unbounded" or "fire-and-forget." |
| **Bounded concurrency** | A guarantee that at most N tasks are running at the same time. The whole point of pools and semaphores. |
| **`errgroup`** | `golang.org/x/sync/errgroup`. A coordination primitive that runs goroutines together, collects the first error, and (since Go 1.18+) can limit concurrency with `SetLimit`. |
| **`semaphore`** | `golang.org/x/sync/semaphore`. A weighted semaphore — like a counter that lets up to N acquirers in. Lower-level than errgroup. |
| **`ants`** | A popular third-party pool library (`github.com/panjf2000/ants/v2`). Persistent workers, non-blocking by default. |
| **`tunny`** | A pool library (`github.com/Jeffail/tunny`). Worker reuse for stateful CPU-bound tasks. Blocking by default. |
| **`workerpool`** | A pool library (`github.com/gammazero/workerpool`). Simple API, FIFO ordering, persistent workers. |
| **Backpressure** | When the consumer slows the producer to prevent overload. A pool with a bounded queue applies backpressure. |
| **Fan-out** | A pattern where one producer spawns N parallel workers. Pools turn unbounded fan-out into bounded fan-out. |
| **Fan-in** | The opposite — N producers collapse into one consumer. Pools do not do this directly. |
| **OOM** | Out-of-memory. The OS kills your process when it requests memory the system cannot provide. |
| **Burst** | A sudden spike in incoming work — 10x normal rate for a few seconds. The classic reason to need bounded concurrency. |
| **Spawn-per-task** | The default pattern: every task gets its own brand-new goroutine. Cheap but unbounded. |
| **Worker-reuse** | The pool pattern: the same goroutine serves many tasks over its lifetime. |
| **Dependency** | Code you do not own that your code calls into. Every third-party library is a dependency. |

---

## Core Concepts

### What problem does a pool actually solve?

To know whether you need a pool, you must know what a pool is for. A pool solves *exactly three* problems, in order of frequency:

1. **Bounded concurrency.** You have N tasks (or an unbounded stream of them) and you want at most K to run at the same time. K is usually chosen for one of three reasons: a downstream rate limit (an API that allows 50 in-flight requests), a memory budget (each task uses 200 MB of RAM and you have 8 GB), or a CPU bound (each task is CPU-heavy and you have 8 cores). This is *the* problem pools solve. It is also the problem that `errgroup.SetLimit` solves with one line of standard-library code.

2. **Worker reuse for warm state.** Some tasks need to set up expensive state — a compiled regex, a connection to a service, a buffer — and you want that state to live as long as the worker, not as long as the task. Reusing workers lets you amortise the setup cost across many tasks. Most workloads do not have this property; the ones that do are usually obvious (each "task" must hold open a connection to a specific shard, for example).

3. **Spawn-rate amortisation.** Goroutines are cheap to *exist*, but they are not free to *create*. Creation costs about 1–2 microseconds and a small amount of heap. If you are spawning hundreds of thousands of goroutines per second, that cost adds up — both in CPU and in heap pressure for the garbage collector. Pools amortise this by spawning workers once and reusing them. *This problem is rare.* You need a workload like "handle 200K WebSocket messages/sec, each requiring a small CPU burst" before it shows up.

If your workload does not have any of these three problems, you do not need a pool. You may still benefit from `errgroup` for ergonomics, or from a `chan` and a few workers for shape, but you do not need a third-party library.

### The three answers — and the fourth

Almost every Go concurrency design decision lands on one of four answers:

- **Raw goroutines + WaitGroup.** Use this when concurrency is naturally bounded by the problem (you have 5 things to do; you do 5 of them; you wait for all 5).
- **`errgroup.Group` with `SetLimit(K)`.** Use this when you have many tasks and want to limit how many run at once, with error propagation and context cancellation. This is the standard answer for "I have 10,000 URLs to fetch, at most 50 at a time."
- **`semaphore.Weighted`.** Use this when tasks have unequal "weight" — some take 1 slot, others take 3 — or when you want the semaphore to live across functions and goroutines as a shared resource.
- **Third-party pool (`ants`, `tunny`, `workerpool`).** Use this when one of the three pool-only problems above applies, or when a feature you specifically need (dynamic resize, metrics, panic recovery, non-blocking submit) is not in the standard library.

That fourth answer is the focus of the rest of this subsection. The point of the junior file is to convince you that the first three answers cover 90%+ of cases.

### Why goroutines are not free, but cheap enough

A common misconception is that "goroutines are cheap, so I should always spawn more." The reality is more nuanced:

- A goroutine starts with about 2 KB of stack. Memory is fine even at 100K goroutines (~200 MB).
- Goroutine *creation* costs about 1 μs. At 1M goroutines/sec, that's 1 CPU-core's worth of overhead.
- The scheduler does work proportional to *runnable* goroutines, not *total* goroutines. 10,000 sleeping goroutines cost nothing. 10,000 *running* goroutines all hammering the CPU cost a lot.
- Goroutines that perform syscalls (file I/O, network) park the OS thread. If many do this at once, the runtime spawns more OS threads — and threads cost 1–8 MB each.

The practical upshot for juniors: do not pool prematurely. If your service handles 100 RPS and each request spawns 5 goroutines, you have 500 active goroutines at peak. That is not a concurrency problem. Adding a pool will make the code more complex with zero measurable benefit.

### What "bounded" actually means

When people say "we need bounded concurrency," they usually mean one of:

- "At most K of these can run at the same time." (the literal meaning)
- "We must not exceed K total goroutines in the program." (rare; usually wrong)
- "Slow down the producer when the consumer is backed up." (backpressure, usually solved by a bounded channel)
- "Don't OOM under load." (a memory budget, usually solved by limiting in-flight work)

Notice that "at most K at the same time" is *not* the same as "at most K total goroutines." You can have 10,000 goroutines in a program where only 50 are runnable at any one time and the rest are blocked on channels — and that is fine. The question is always "how many are *running* (or holding the resource we care about)?"

---

## Real-World Analogies

### The coffee shop

Picture a coffee shop. Customers arrive (tasks). The barista (worker) takes one order at a time and makes the drink. With one barista and a steady arrival rate, life is fine. When 20 customers walk in at once, a line forms. The barista keeps making drinks at the same rate, but customers wait. The system is back-pressured naturally.

Now imagine the manager says "every new customer should be served by a new barista that we hire on the spot." For one customer that works. For 20 it works barely. For 200 the shop is full of baristas bumping into each other, the coffee runs out, and the espresso machine catches fire.

- One barista forever = single-threaded; too slow for bursts.
- Hire-a-barista-per-customer = raw goroutines; fine until the burst is huge.
- Five baristas at fixed positions = a pool with K=5; bursts queue, throughput is bounded by 5.

Most of the time, your "shop" is not big enough to need pre-hired baristas. Five customers arrive, you spawn five goroutines, they all finish, life is good. The pool becomes necessary when the burst is large *and* the throughput limit matters (your "baristas" downstream API has a rate limit, or each "drink" eats memory).

### The toll booth

A four-lane highway approaches a toll plaza. There are eight booths. At low traffic, cars pass through with no wait. At rush hour, a queue forms behind each booth — but only eight cars are paying at any moment. The booths are workers. The queue is the bounded buffer. The cars are tasks. Cars do not get to spawn new booths on demand.

A goroutine pool is the toll plaza. A raw goroutine fan-out is "every car drives off the road and pays a personal toll collector." The latter is faster when there are five cars; it is catastrophic when there are 5000.

### The library returns desk

Books are returned to a library. The desk worker scans each one and shelves it. Books pile up (tasks queue), the worker scans them in order (FIFO), the system stays healthy. If you double the scanning rate by hiring a second worker, throughput doubles. Beyond a certain number of workers, the back-room shelving (downstream service) is the bottleneck and more workers add nothing.

This is the lesson of pool sizing: throughput is bounded by the slowest stage. Increasing the pool beyond the bottleneck just wastes goroutines.

### The kitchen line

A restaurant kitchen has stations: chopping, sauteing, plating. Each station is staffed by a fixed number of cooks. Orders flow through the stations. The kitchen is a pipeline of pools, each sized for its station's throughput. You would not staff the chopping station with 50 cooks because the saute station only has 5. The pipeline is rate-limited by the smallest stage.

Most Go concurrency designs are similar — a chain of stages, each parallelised, each potentially needing a different K. Pools (or `errgroup`s) give you per-stage control.

### The roller coaster line

People queue, the train holds 24 riders, the train cycles every 90 seconds. Adding people to the queue does not increase throughput; the train is the rate limit. The queue is the bounded buffer in front of the worker pool. If the queue is uncapped, the wait becomes infinite; the park staff cuts off entry (drops tasks) at some queue length. This is the "non-blocking submit returns ErrPoolFull" pattern in `ants`.

---

## Mental Models

### The "do I need this?" funnel

Imagine a funnel with four exits. You feed your workload in at the top. It falls past four questions:

1. **Is my workload bounded by the problem?** (You have a fixed-size slice of inputs.) → If yes, raw goroutines + WaitGroup.
2. **Are my tasks the same shape, with errors I care about and a context to cancel?** → If yes, `errgroup` with `SetLimit`.
3. **Do my tasks have unequal weight (some big, some small)?** → If yes, `semaphore.Weighted`.
4. **Do I need worker reuse, spawn-rate amortisation, or a feature like resize/metrics?** → If yes, a third-party pool.

Most workloads stop at exit 1 or 2. If you fall through to exit 4, you are in the minority — and that is OK; it is what this subsection is for. The mistake to avoid is going straight to exit 4 because it sounds professional.

### The "what is being limited" model

When you say "I want bounded concurrency," ask yourself: *what scarce thing am I rationing?* The answer is almost never "goroutines themselves." It is usually:

- HTTP requests to a downstream service (limit = its concurrency budget)
- Database connections (limit = pool size)
- File descriptors (limit = ulimit/2)
- CPU cores for CPU-bound work (limit = GOMAXPROCS)
- Memory for fat tasks (limit = budget / per-task footprint)

Whatever the limit is, the *K* in your pool or semaphore is determined by it. Pools do not invent a limit; they enforce one you already know.

### The cost-benefit model

Every concurrency primitive has a cost — code, dependencies, mental load — and a benefit — fewer bugs, more throughput, better tail latency. Raw goroutines have the lowest cost and the highest risk. Third-party pools have the highest cost and (when needed) the highest benefit. The whole point of this subsection is to put you in the right place on the cost-benefit curve for *your* workload.

A useful rule: do not add a tool until you can measure the benefit. "I'll add `ants` because it might help" is bad reasoning. "We measured 12 GB heap from goroutine creation under load and `ants` brought it to 400 MB" is good reasoning.

### The "tail" model

When you make decisions about concurrency, think about the worst case, not the average. The average case is usually fine without a pool. The 99th-percentile burst is what kills you. A service that runs cleanly at 100 RPS average can collapse at 1000 RPS for 10 seconds during a deploy or an upstream retry storm. A pool's value shows up in the tail.

### The "what if I do nothing" model

Before adding a pool, ask: what if I do nothing? Spawn a goroutine per task, no bound. Run the program for an hour. What goes wrong? If the answer is "nothing," you do not need a pool. If the answer is "we OOM at 11pm when the cron fires," you need a bound — possibly `errgroup`, possibly a pool. If the answer is "we are fine but I worry about it," you do not need a pool; you need a monitoring dashboard.

---

## The Simple Decision Tree

Here is the tree, in text form. We will turn it into a flowchart later in the file.

```
Q1: How many tasks will run concurrently (peak)?
    - Single-digit (you know each one by name) → raw goroutines + WaitGroup. Done.
    - Tens to hundreds → answer Q2.
    - Thousands+ → answer Q2 and Q3.

Q2: Do tasks share an error channel, a context, or both?
    - Yes → use errgroup. Use SetLimit(K) to bound. Done.
    - No, tasks are fire-and-forget with no errors → answer Q3.

Q3: Do you need bounded concurrency? (Why?)
    - "To not OOM" → errgroup with SetLimit, or semaphore. Done.
    - "Downstream API rate limit" → errgroup with SetLimit. Done.
    - "CPU cores" → errgroup with SetLimit(runtime.NumCPU()). Done.
    - "Tasks have unequal weight" → semaphore.Weighted. Done.
    - "I expect millions of tasks per second" → third-party pool. Answer Q4.

Q4: Which third-party pool?
    - Tasks return values you want to receive synchronously → tunny.
    - Tasks are fire-and-forget at very high rate → ants.
    - Tasks need FIFO ordering with a simple API → workerpool.
    - I want metrics, dynamic resize, multiple queues → ants or pond.

Q5: Are you sure? Have you measured?
    - No → go back to errgroup.SetLimit and measure first.
    - Yes → use the third-party pool you chose.
```

Most paths exit before Q4. The point of writing the tree out is to make it concrete: each downward arrow has a *reason*. If you find yourself at Q4 without a measured reason, retreat to Q3.

### The 90-second version

Even shorter:

- Default to `errgroup.SetLimit(K)`.
- If `errgroup` is overkill (you have 5 things to do), use raw goroutines.
- If `errgroup` is under-powered (unequal task weight, dynamic resize, metrics needed), use a third-party pool — and have a measurable reason.

This three-line rule covers most production code you will ever write.

---

## Code Examples

The best way to feel the decision is to write the same problem three ways. Our problem: *fetch 100 URLs in parallel, at most 10 at a time, collect the status codes, fail fast on the first error.*

### Example 1: Raw goroutines (incorrect — no bound)

This is the naive first attempt. It works for 10 URLs, fails for 10,000.

```go
package main

import (
	"fmt"
	"net/http"
	"sync"
)

func main() {
	urls := []string{
		"https://example.com",
		"https://golang.org",
		// ... 98 more
	}

	var wg sync.WaitGroup
	statuses := make([]int, len(urls))

	for i, u := range urls {
		wg.Add(1)
		go func(i int, u string) {
			defer wg.Done()
			resp, err := http.Get(u)
			if err != nil {
				statuses[i] = -1
				return
			}
			defer resp.Body.Close()
			statuses[i] = resp.StatusCode
		}(i, u)
	}

	wg.Wait()
	for i, s := range statuses {
		fmt.Printf("%d %s -> %d\n", i, urls[i], s)
	}
}
```

What is wrong? *No bound.* For 100 URLs we open 100 HTTP connections at once. For 10,000 URLs we open 10,000 — and we hit `EMFILE` (too many open files) on the local side, hit per-host concurrency limits on the server side, and waste memory holding 10,000 in-flight responses. We also do not propagate errors; we silently turn failure into `-1`. We do not propagate cancellation.

This is the version a junior writes on day 1. It is fine for 5 inputs. It is wrong for 5000.

### Example 2: Bounded with `errgroup` (correct, idiomatic)

The standard answer. One import, one `SetLimit`, error propagation, context cancellation.

```go
package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"golang.org/x/sync/errgroup"
)

func main() {
	urls := []string{
		"https://example.com",
		"https://golang.org",
		// ... 98 more
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(10) // at most 10 concurrent fetches

	statuses := make([]int, len(urls))

	for i, u := range urls {
		i, u := i, u // capture
		g.Go(func() error {
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
			if err != nil {
				return err
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				return err
			}
			defer resp.Body.Close()
			statuses[i] = resp.StatusCode
			return nil
		})
	}

	if err := g.Wait(); err != nil {
		fmt.Println("error:", err)
		return
	}

	for i, s := range statuses {
		fmt.Printf("%d %s -> %d\n", i, urls[i], s)
	}
}
```

What changed?

- `errgroup.WithContext` gives us a `ctx` that is cancelled the moment any goroutine returns an error.
- `g.SetLimit(10)` blocks `g.Go(...)` until fewer than 10 goroutines are in flight. The blocking is the bound; you cannot exceed it.
- The HTTP request is built with the cancellation-aware context, so when one fails, the others terminate early.
- `g.Wait()` returns the first error encountered.

This is the right answer for 95%+ of "fan out to N tasks, bounded" workloads. *You almost never need more.*

### Example 3: Bounded with a third-party pool (overkill here)

The same workload, written with `panjf2000/ants`. This is what an over-eager junior writes after reading a blog post.

```go
package main

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	urls := []string{
		"https://example.com",
		"https://golang.org",
		// ... 98 more
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	statuses := make([]int, len(urls))
	var firstErr error
	var errMu sync.Mutex

	pool, err := ants.NewPool(10) // 10 workers
	if err != nil {
		panic(err)
	}
	defer pool.Release()

	var wg sync.WaitGroup
	for i, u := range urls {
		i, u := i, u
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
			if err != nil {
				errMu.Lock()
				if firstErr == nil {
					firstErr = err
					cancel()
				}
				errMu.Unlock()
				return
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				errMu.Lock()
				if firstErr == nil {
					firstErr = err
					cancel()
				}
				errMu.Unlock()
				return
			}
			defer resp.Body.Close()
			statuses[i] = resp.StatusCode
		})
	}

	wg.Wait()

	if firstErr != nil {
		fmt.Println("error:", firstErr)
		return
	}

	for i, s := range statuses {
		fmt.Printf("%d %s -> %d\n", i, urls[i], s)
	}
}
```

Look at the cost we just paid:

- We added a dependency (`github.com/panjf2000/ants/v2`).
- We had to reinvent error propagation with a mutex.
- We had to reinvent cancellation: when one fails, we `cancel()` manually.
- We still need a `sync.WaitGroup` because `ants.Submit` is fire-and-forget.

What did we gain?

- Worker reuse — but we run 100 tasks once and exit. Reuse is irrelevant.
- Spawn-rate amortisation — but we are not spawning at any rate worth amortising.
- A pool API — for a workload that fits a `for` loop.

For this workload, the third-party pool is *worse* than `errgroup`. It is more code, more dependency, less idiomatic, and gains nothing measurable. The right answer here is example 2.

This does not mean `ants` is bad. It means `ants` is the wrong tool for *this* job. The middle and senior files explore jobs where it is the right tool.

### Example 4: When raw goroutines are right

To balance the picture: here is a case where Example 1's style is correct.

```go
package main

import (
	"fmt"
	"sync"
)

func computeRow(row int) int {
	// pretend this is expensive
	total := 0
	for i := 0; i < 1000; i++ {
		total += row * i
	}
	return total
}

func main() {
	rows := []int{1, 2, 3, 4, 5, 6, 7, 8}
	results := make([]int, len(rows))

	var wg sync.WaitGroup
	for i, r := range rows {
		i, r := i, r
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = computeRow(r)
		}()
	}
	wg.Wait()
	fmt.Println(results)
}
```

8 tasks. 8 goroutines. No bound needed because the problem is bounded. No errors. No cancellation. No pool. This is correct. Adding `errgroup` here is fine but not necessary; adding a pool would be ridiculous.

### Example 5: When a semaphore is right

Now imagine the tasks have unequal weight. Some are "small" (CPU-bound, 1 slot) and some are "big" (memory-bound, 3 slots). You have a fixed pool of 10 slots.

```go
package main

import (
	"context"
	"fmt"
	"sync"

	"golang.org/x/sync/semaphore"
)

type Job struct {
	id     int
	weight int64
}

func main() {
	sem := semaphore.NewWeighted(10)
	ctx := context.Background()

	jobs := []Job{
		{1, 1}, {2, 3}, {3, 1}, {4, 5},
		{5, 1}, {6, 2}, {7, 1}, {8, 4},
	}

	var wg sync.WaitGroup
	for _, j := range jobs {
		j := j
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := sem.Acquire(ctx, j.weight); err != nil {
				fmt.Println("acquire err:", err)
				return
			}
			defer sem.Release(j.weight)
			fmt.Printf("running job %d (weight %d)\n", j.id, j.weight)
			// do work
		}()
	}
	wg.Wait()
}
```

A pool would force you to set every task to one slot. The semaphore lets a "weight 5" task hold half the budget while three "weight 1" tasks run beside it. That ergonomic is the reason `semaphore.Weighted` exists — and is the reason it is sometimes the right answer over `errgroup`.

### Example 6: When a third-party pool is actually right

A scenario where `ants` earns its keep: a long-running service that receives *millions of small CPU-bound tasks per second* from many sources, and you want to recycle a fixed pool of warm workers.

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/panjf2000/ants/v2"
)

var processed atomic.Int64

func work() {
	// imagine some short CPU burst, e.g. hash a message
	for i := 0; i < 100; i++ {
		_ = i * i
	}
	processed.Add(1)
}

func main() {
	pool, err := ants.NewPool(1024)
	if err != nil {
		panic(err)
	}
	defer pool.Release()

	stop := make(chan struct{})
	var producers sync.WaitGroup
	for p := 0; p < 16; p++ {
		producers.Add(1)
		go func() {
			defer producers.Done()
			for {
				select {
				case <-stop:
					return
				default:
					_ = pool.Submit(work)
				}
			}
		}()
	}

	time.Sleep(5 * time.Second)
	close(stop)
	producers.Wait()

	// drain
	for pool.Running() > 0 {
		time.Sleep(10 * time.Millisecond)
	}

	fmt.Println("processed:", processed.Load())
	fmt.Println("workers:", pool.Cap())
}
```

Here the pool earns its keep: the production rate (millions per second) means raw `go work()` would burn CPU on creation alone, and `errgroup.SetLimit` would do similar gating but with extra coordination cost per call. The warm worker model wins. *But notice*: even this is borderline. Many services that look like this are not actually pushing millions/sec; they push thousands/sec and would be fine without `ants`. Measure first.

---

## Side-by-Side Comparison

Below is a one-page comparison of the four answers, for the same "fetch 50 URLs at most 5 at a time" workload.

### Raw goroutines + manual bound (token channel)

```go
sem := make(chan struct{}, 5)
var wg sync.WaitGroup
for _, u := range urls {
	u := u
	wg.Add(1)
	sem <- struct{}{}
	go func() {
		defer wg.Done()
		defer func() { <-sem }()
		fetch(u)
	}()
}
wg.Wait()
```

- **Lines:** 11
- **Dependencies:** none
- **Error handling:** manual
- **Cancellation:** manual
- **When to use:** quick scripts, low complexity

### `errgroup` with `SetLimit`

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(5)
for _, u := range urls {
	u := u
	g.Go(func() error { return fetch(ctx, u) })
}
return g.Wait()
```

- **Lines:** 6
- **Dependencies:** one (`golang.org/x/sync/errgroup`, semi-standard)
- **Error handling:** automatic (first error wins)
- **Cancellation:** automatic via shared `ctx`
- **When to use:** default answer for fan-out with bound

### `semaphore.Weighted`

```go
sem := semaphore.NewWeighted(5)
var wg sync.WaitGroup
for _, u := range urls {
	u := u
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := sem.Acquire(ctx, 1); err != nil { return }
		defer sem.Release(1)
		fetch(ctx, u)
	}()
}
wg.Wait()
```

- **Lines:** 11
- **Dependencies:** one (`golang.org/x/sync/semaphore`)
- **Error handling:** manual
- **Cancellation:** via ctx in Acquire
- **When to use:** unequal task weights, semaphore shared across functions

### Third-party pool (`ants`)

```go
pool, _ := ants.NewPool(5)
defer pool.Release()
var wg sync.WaitGroup
for _, u := range urls {
	u := u
	wg.Add(1)
	_ = pool.Submit(func() { defer wg.Done(); fetch(ctx, u) })
}
wg.Wait()
```

- **Lines:** 8
- **Dependencies:** one (`github.com/panjf2000/ants/v2`)
- **Error handling:** manual
- **Cancellation:** manual
- **When to use:** when you have a measured reason

The point of the side-by-side: `errgroup` is the *fewest lines, fewest manual responsibilities, most idiomatic* of the four. That is why it should be your default.

---

## When Raw Goroutines Are Fine

The bias of this whole subsection is "do not pool prematurely." Here are the cases where you definitely should not pool — and should use raw `go f()` and be done.

### Case A: Bounded by the problem

You have a fixed slice of inputs, you spawn one goroutine per input, you wait, you continue. Example: "fetch 5 sub-resources for this request and combine the results." `WaitGroup` plus 5 `go` calls. Adding `errgroup` is fine but optional. Adding a pool is wrong.

### Case B: A single background task

You start one goroutine at program startup that watches a config file or refreshes a cache every minute. There is no second goroutine to coordinate with. There is no pool. There is no fan-out. There is `go watchConfig()`. That's it.

### Case C: Short-lived "do-this-while" goroutines

You write a function that should report progress to a log every second while it works. You spawn one goroutine that loops on a ticker and stops when the function returns. Pool? No. `go func() { for { ... } }()` and a `done` channel. Done.

### Case D: An event loop with one consumer goroutine per producer

Every connection in a server is "one goroutine for read, one for write." There is no pool because each goroutine is bound to one connection. Net/http already does this for you. The number of goroutines tracks the number of clients. The OS limits the number of clients via fd limits. You do not need a pool on top.

### Case E: Tests and benchmarks

In a test, you often spawn a goroutine to drive the system under test, with no concern for production-grade boundedness. Raw goroutines are fine. A pool here is over-engineering.

### Case F: CLI tools that exit immediately

A one-shot tool like "rsync this directory tree in parallel" spawns hundreds of goroutines, waits, exits. No long-lived service means no long-lived pool. You may still want a *bound* (use `errgroup.SetLimit`), but you do not need worker reuse.

If your case fits any of A–F, do not reach for a pool.

---

## When You Definitely Need Something

Conversely, here are the situations where you absolutely must do something more than `go f()`.

### Trigger 1: Workload size is unbounded or huge

Anytime the number of tasks is "input-driven, possibly large" — millions of rows, hundreds of thousands of URLs, an unbounded stream from Kafka — you need a bound. `errgroup.SetLimit` first; pool only if you have measured a need.

### Trigger 2: Downstream service has a concurrency limit

You are calling an API documented as "max 50 concurrent requests per API key." Without a bound you will exceed it and start getting 429s. With a bound of 50 (`SetLimit(50)`) you stay under. Easy choice; `errgroup` covers it.

### Trigger 3: Memory budget

Each task uses 200 MB of working set. You have 16 GB. You can run at most ~70 in parallel before OOM. `errgroup.SetLimit(50)` keeps you safe. (You might also need to limit allocation rate, but bounding concurrency is step 1.)

### Trigger 4: CPU-bound work

You have a CPU-bound job (image processing, hashing, compression). The CPU limit is `runtime.NumCPU()`. Adding more workers than cores hurts throughput because of scheduler contention. `errgroup.SetLimit(runtime.NumCPU())` is the right answer.

### Trigger 5: File descriptors

You are opening files or sockets in parallel. The OS limit is `ulimit -n`. Without a bound you hit EMFILE. With a bound of half the ulimit you stay safe.

### Trigger 6: Steady high task rate over time

You serve a long-running service that handles thousands of tasks per second, every second, for hours. This is where pool reuse begins to matter — but even here, measure first. Most services at 1k–10k RPS do not need a third-party pool.

### Trigger 7: Custom features

You need dynamic resize, runtime metrics on running workers, panic recovery without crashing the program, or non-blocking submit with a queue overflow handler. The standard library does not offer these; a third-party pool does.

For triggers 1–6, `errgroup` is the answer 90%+ of the time. Trigger 7 is where pools earn their keep.

---

## Coding Patterns

### Pattern: "Default to errgroup"

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(K)
for _, item := range items {
	item := item
	g.Go(func() error { return process(ctx, item) })
}
return g.Wait()
```

Memorise this. It is the answer 90% of the time. K is chosen by the scarcest downstream resource.

### Pattern: "Token channel as a quick semaphore"

```go
sem := make(chan struct{}, K)
var wg sync.WaitGroup
for _, item := range items {
	item := item
	wg.Add(1)
	sem <- struct{}{}
	go func() {
		defer wg.Done()
		defer func() { <-sem }()
		process(item)
	}()
}
wg.Wait()
```

This is what people wrote before `errgroup.SetLimit` existed. Still common in code without errgroup. The semantics are exactly the bound — no error propagation, no context.

### Pattern: "Fixed worker pool with channels"

```go
tasks := make(chan Task, 100)
var wg sync.WaitGroup
for i := 0; i < K; i++ {
	wg.Add(1)
	go func() {
		defer wg.Done()
		for t := range tasks {
			process(t)
		}
	}()
}

for _, t := range myTasks {
	tasks <- t
}
close(tasks)
wg.Wait()
```

A homemade pool. K long-lived workers, FIFO queue. About 12 lines. Fine when you specifically want this shape (workers persist, FIFO, you control the queue). The cost — being a homemade pool — is that you must remember to close the channel and to handle panics yourself.

### Pattern: "Pipeline of pools"

```go
stage1Out := make(chan A, 10)
stage2Out := make(chan B, 10)

g, ctx := errgroup.WithContext(ctx)

g.Go(func() error {
	defer close(stage1Out)
	return produce(ctx, stage1Out)
})

g.Go(func() error {
	defer close(stage2Out)
	subg, subctx := errgroup.WithContext(ctx)
	subg.SetLimit(5)
	for a := range stage1Out {
		a := a
		subg.Go(func() error {
			b, err := transform(subctx, a)
			if err == nil {
				stage2Out <- b
			}
			return err
		})
	}
	return subg.Wait()
})

g.Go(func() error { return consume(ctx, stage2Out) })

return g.Wait()
```

Pipelines often need *different* concurrency at each stage. Nested errgroups give you that without a third-party pool.

### Pattern: "Don't bother — just spawn"

```go
go logEverySecond()
```

There is no pool. There is no errgroup. There is one goroutine. This is correct.

---

## Clean Code

A few rules of thumb that keep your concurrency code honest, even before you start arguing about pools.

### Rule: One way to start a goroutine

A function should not sometimes spawn a goroutine and sometimes run sync. Either it returns a value, or it returns a channel/future. Mixing them is confusing.

### Rule: Always have a story for stopping

For every goroutine you start, ask: how does it stop? "It returns when its function returns" is a fine answer. "When the context is cancelled" is a fine answer. "Never, because it loops forever" is a bug.

### Rule: Pass ctx; do not capture it from outside

Long-running goroutines should accept a context as a parameter. Short-lived ones inside an errgroup share the errgroup's ctx. This makes cancellation paths clear.

### Rule: Limit *at the right place*

If you have an HTTP handler that calls a downstream service, you can limit at the handler (max in-flight requests on your server) or at the call site (max in-flight downstream calls). Often both. The pool is just *a* place to enforce the limit; deciding *which* limit you are enforcing is more important than which tool you use.

### Rule: Prefer code that reads top-to-bottom

A pool with a `Submit(func())` and a separate result handler reads non-linearly: code dispatches now, returns later, somewhere else. `errgroup.Go` plus `Wait` reads linearly: you can see the bound, the body, and the result in one place. Lean on `errgroup` for linear code unless you need otherwise.

### Rule: Comment the K

If you write `SetLimit(50)`, leave a comment explaining *why* 50. "Downstream API limit per docs as of 2024-09-12" is a good comment. "Felt right" is a bad comment.

---

## Error Handling

### Errors from spawned tasks

Raw goroutines do not return errors. You must either:

- Capture errors into a slice indexed by goroutine
- Send errors to a channel
- Use `errgroup`, which does it for you

```go
errs := make(chan error, len(items))
var wg sync.WaitGroup
for _, item := range items {
	item := item
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := process(item); err != nil {
			errs <- err
		}
	}()
}
wg.Wait()
close(errs)
for err := range errs {
	fmt.Println(err)
}
```

This is fine but verbose. `errgroup` collapses it to a few lines.

### Panic recovery

A panic in a goroutine that does not recover kills the whole program. This is true of raw goroutines *and* of `errgroup` goroutines (errgroup does not recover for you). Third-party pools differ: `ants` has an `Options.PanicHandler` that catches panics so the worker survives.

If you want raw goroutines to survive panics:

```go
go func() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("worker panic: %v", r)
		}
	}()
	doRiskyWork()
}()
```

The same wrapper goes around `errgroup.Go` if you want it there too. The wrapper is small enough that "I need panic recovery" is not, by itself, a reason to adopt `ants`.

### Cancellation

`errgroup.WithContext` is the simplest cancellation story: the first error cancels the shared context, all in-flight tasks see it (if they respect ctx), they return early. Raw goroutines and pools both make you wire this up by hand.

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()

go func() {
	if err := doWork(ctx); err != nil {
		cancel()
	}
}()
```

If you find yourself writing this wiring more than once, it is a sign you should be using `errgroup`.

### Don't swallow errors silently

A common bug in pool-using code:

```go
_ = pool.Submit(func() { process(item) })
```

`process` returns no error here, so an internal failure is silent. Make sure your task closure does *something* on error — log it, send to a channel, set a flag.

---

## Performance Tips

For junior level, performance tips are mostly about *not* over-engineering. The specifics come later. These are the rules:

- **Do not pool unless your benchmark says you should.** Adding `ants` to a workload that handles 100 RPS will not make it faster; it will just add a dependency.
- **Right-size the bound.** A bound of 5 when the system can handle 50 leaves throughput on the table. A bound of 500 when the downstream allows 50 floods it. Tune based on real measurements.
- **Avoid `time.Sleep` polling.** If you find yourself sleeping in a loop to wait for a pool to drain, you should be using a `WaitGroup` or `errgroup`.
- **Beware shared maps.** When N goroutines write to the same `map`, you must `sync.Mutex` it. Forgetting this is the single most common bug at this level.
- **Prefer batching over fine-grained pooling.** If each task is tiny, batch them (process 100 at a time) before submitting to a pool. The goroutine overhead per micro-task dominates the work.

We will come back to performance with real numbers in `senior.md`.

---

## Best Practices

- **Start with no concurrency.** Write the sequential version first. Concurrency is an *optimisation* — make sure the sequential code is correct first.
- **Add concurrency in the smallest amount that helps.** Often that is `errgroup.SetLimit` and nothing else.
- **Justify every dependency.** Adopting `ants` or `tunny` adds a third-party project to your audit surface. Have a reason in the commit message.
- **Document the bound.** Every K you pick should be paired with a comment about why.
- **Always cancel.** Every `errgroup` should have a `ctx` and every task should respect it.
- **Always Wait.** Forgetting `g.Wait()` is the same bug as forgetting `wg.Wait()` — your main goroutine exits before the work finishes.
- **Don't leak goroutines.** Every goroutine has a clear exit. Background loops have a stop channel or a ctx.
- **Don't share state without sync.** Even inside a "single-writer" pattern, write the test that proves the pattern.

---

## Edge Cases & Pitfalls

### Pitfall: "I'll add a pool, I'm sure it helps"

You don't know it helps. Measure first. The benchmark in `tasks.md` shows scenarios where the pool *loses* to raw goroutines because the pool's queue lock becomes the bottleneck.

### Pitfall: Pool size = GOMAXPROCS for I/O-bound work

A common error. If your tasks block on I/O, `GOMAXPROCS` is the wrong K. The right K is the downstream service's limit, or the file-descriptor budget, not the number of CPU cores. CPU-bound work uses `NumCPU()`; I/O-bound work uses whatever the I/O sink supports.

### Pitfall: Pool size > 1000 with no reason

A pool sized at 1000 is rarely necessary. If you need 1000 concurrent calls, you may not have a concurrency problem; you may have a throughput problem better solved by scaling out. Check before committing.

### Pitfall: `pool.Submit` returns an error you ignore

Both `ants` and `tunny` can fail to accept a task (full queue, closed pool). Ignoring the error means silent dropped work. Always handle it.

```go
if err := pool.Submit(work); err != nil {
	// log or fallback
}
```

### Pitfall: Using a pool for a one-shot script

A pool's setup cost (a few microseconds, a few KB) is irrelevant in production. In a 200ms script, it is noise but pointless. If your program runs once and exits, do not pool unless the workload itself is huge.

### Pitfall: Mixing pool and errgroup

You sometimes see code that calls `pool.Submit(func() { g.Go(...) })`. This is almost always wrong — you are pooling the *outer* layer and not bounding the inner. Pick one approach per layer.

### Pitfall: Forgetting `Release` / closing the pool

A pool that you never release leaks workers when the program continues past the workload. `defer pool.Release()` next to the constructor is the standard guard. For `tunny`, it is `defer pool.Close()`.

### Pitfall: Blocking the producer when you didn't mean to

`errgroup.SetLimit(K)` makes `g.Go` *block* when K is reached. That is usually what you want. But if you call `g.Go` from a goroutine that also reads from a channel feeding the loop, you can deadlock when the consumer is blocked on the producer. Always reason about the back-pressure cycle.

### Pitfall: Tasks that hold a lock

If each pooled task acquires the *same* lock, your effective concurrency is 1, regardless of pool size. The pool is not helping. Refactor to share less state, or you don't need the pool.

### Pitfall: Bound chosen without context

A pool size of 100 means very different things on a laptop (8 cores) and on a 96-core server. Sometimes the right K is a *function* of the environment, not a constant. `runtime.NumCPU()` for CPU-bound work, an env-driven config for everything else.

---

## Common Mistakes

### Mistake 1: "Pools because pools"

You read a blog post that says pools are good. You add `ants` to a 50-line script. You feel professional. You added a dependency for nothing. Remove it.

### Mistake 2: "Errgroup but no SetLimit"

Plain `errgroup.Group` without `SetLimit` is *unbounded*. It is `WaitGroup` with errors. People sometimes think `errgroup` bounds by default. It does not. You must call `SetLimit`.

### Mistake 3: Putting `SetLimit` *after* `Go`

`g.SetLimit` must be called before any `g.Go`. Calling it after panics or no-ops depending on version. Always set the limit at construction time.

### Mistake 4: Captured loop variable

```go
for i := 0; i < 5; i++ {
	go func() { fmt.Println(i) }()
}
```

In Go ≤1.21, all five goroutines print `5`. In Go 1.22+, each gets its own `i`. If you support older Go, *always* shadow: `i := i`.

### Mistake 5: WaitGroup `Add` inside the goroutine

```go
go func() {
	wg.Add(1)  // wrong
	defer wg.Done()
	work()
}()
wg.Wait()  // might race past Add
```

`wg.Add` must be called *before* the goroutine starts, otherwise `Wait` can race past it.

### Mistake 6: Goroutines that never end

```go
go func() {
	for {
		// no exit condition, no stop channel
	}
}()
```

A goroutine that does not end is a leak. Every long-running goroutine needs a stop story.

### Mistake 7: Using `ants` for a workload with results

`ants.Submit(func())` is fire-and-forget. If you want results back, you need to wire your own channel — at which point you might as well use `tunny` (which has `Process` returning a value) or `errgroup`.

### Mistake 8: Adopting a library without reading its README

`ants` has options you must know about: `WithNonblocking`, `WithMaxBlockingTasks`, `WithPanicHandler`. Their defaults may surprise you. Read the docs before depending on the lib.

### Mistake 9: Using a pool to "make it faster" without a benchmark

The pool may make it slower. The queue lock, the dispatch overhead, the worker park/wake — all of these have measurable costs. Always benchmark before and after.

### Mistake 10: Sharing one global pool across the whole program

This is OK sometimes but often hides bugs: one heavy workload starves another. Pools are often better scoped to a request, a stage, or a feature. Global pools should be a deliberate choice, not a default.

---

## Common Misconceptions

### "Goroutines are so cheap I never need to limit them."

True at small scale. False at large scale. A million goroutines is 2 GB of stack and a busy scheduler. Limit when you need to, not before.

### "Pools are faster than raw goroutines."

Sometimes. Often not. Raw `go f()` plus a small pool of warm workers can be slower under contention if the pool has lock-heavy dispatch. Measure.

### "`errgroup` is just for errors."

Wrong; `errgroup` is also the standard answer for bounded concurrency, with `SetLimit`. Many engineers miss this and reach for a third-party pool when `errgroup` would have worked.

### "Pools are required for production code."

False. Many production services use only the standard library. Pools are a tool, not a requirement.

### "Bigger pools = more throughput."

Up to a point. Beyond the downstream limit, more workers just add contention and cancel each other out. The throughput curve flattens; in some cases it inverts.

### "Pools fix slow code."

No. They give you control over *how much* runs at once. They do not make individual tasks faster. If each task takes 5 seconds, no pool will make it shorter.

### "A pool lets me ignore goroutine leaks."

No. A pool with unbounded queue can leak tasks just as easily as raw `go f()` can leak goroutines. The leak is in your code; the pool does not fix it.

### "`SetLimit(1)` is the same as `sync.Mutex`."

Almost, but not quite — `SetLimit(1)` queues *tasks*, mutex protects *data*. You can have many concurrent tasks all guarded by one mutex, or one serialised task that touches many things. Don't conflate them.

### "I need a pool because my service uses CPU."

You need to pick the right K. The pool is one way to enforce K; `errgroup.SetLimit(runtime.NumCPU())` is another and is simpler.

### "Third-party pools are battle-tested, so I should trust them."

Trust them after you read their issues page, their commit history, and at least one real benchmark. `ants` is excellent and well-maintained; `tunny` is solid; `workerpool` is small and audited. But "third party" never means "free." You own everything you depend on.

---

## Tricky Points

### Tricky: `errgroup.SetLimit(0)`

`SetLimit(0)` means *no goroutines allowed*. It is not the same as "no limit." For no limit, do not call `SetLimit`. Calling `SetLimit(-1)` resets to unlimited (in current versions).

### Tricky: `errgroup.Go` returns immediately when below the limit, blocks above

This is the *bound*. If you have 10 active and you call `Go` the 11th time with `SetLimit(10)`, the call blocks until one finishes. That blocking is back-pressure. It is usually correct, but it means you cannot call `g.Go` from inside a goroutine that needs to finish first — risk of deadlock.

### Tricky: `errgroup` does not have a "drain" method separate from `Wait`

`Wait()` waits for everything. There is no "wait for one." If you need that, you need a manual channel.

### Tricky: `ants.Submit` returns nil even when the pool is at capacity in non-blocking mode by default

Wait, no — the default *is* blocking. In non-blocking mode (`WithNonblocking(true)`), Submit returns `ErrPoolOverload` instead of blocking. The default behavior is to block at submission. *Always check the docs for the version you import.*

### Tricky: Pool size of 1

A pool of one worker serialises tasks. This is sometimes what you want (single-threaded queue with backpressure). But it makes the pool's overhead pointless; consider whether a channel + one goroutine is clearer.

### Tricky: Pool size of `runtime.GOMAXPROCS(0)`

This reads the current GOMAXPROCS at construction time. If GOMAXPROCS changes (some systems alter it from a control loop), the pool does not auto-resize. Most pools have a `Tune` or `Resize` method for this.

### Tricky: A pool inside an errgroup

You can do it but you usually do not need to. The pool bounds the workers; the errgroup bounds outer coordination. If both have limits, the *smaller* one wins. Usually pick one layer for bounding.

---

## Test

### Test 1: Spawn 5 goroutines, wait for all

Write a function that calls `compute(i)` for `i in 0..4` in parallel and returns the slice of results. No pool. Just goroutines and `WaitGroup`.

<details>
<summary>Solution</summary>

```go
func computeAll() [5]int {
	var results [5]int
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = compute(i)
		}()
	}
	wg.Wait()
	return results
}
```

5 tasks, bounded by problem size. No pool needed.

</details>

### Test 2: Fetch 100 URLs at most 10 at a time

Write a function that fetches a slice of URLs and returns the slice of HTTP status codes. Limit to 10 concurrent. Propagate errors.

<details>
<summary>Solution</summary>

```go
func fetchAll(ctx context.Context, urls []string) ([]int, error) {
	codes := make([]int, len(urls))
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(10)
	for i, u := range urls {
		i, u := i, u
		g.Go(func() error {
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
			if err != nil { return err }
			resp, err := http.DefaultClient.Do(req)
			if err != nil { return err }
			defer resp.Body.Close()
			codes[i] = resp.StatusCode
			return nil
		})
	}
	return codes, g.Wait()
}
```

`errgroup.SetLimit(10)` does the bound. No pool needed.

</details>

### Test 3: Process a stream from a channel, at most K at a time

Given `in chan Job`, process each job with `handle(job)` and limit to K concurrent.

<details>
<summary>Solution</summary>

```go
func processStream(ctx context.Context, in <-chan Job, K int) error {
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(K)
	for {
		select {
		case <-ctx.Done():
			return g.Wait()
		case j, ok := <-in:
			if !ok {
				return g.Wait()
			}
			j := j
			g.Go(func() error { return handle(ctx, j) })
		}
	}
}
```

Drain the channel inside the loop; close logic ends the loop. Still `errgroup`.

</details>

### Test 4: When does a third-party pool win?

Describe one workload where a third-party pool (e.g., `ants`) beats `errgroup.SetLimit`. Hint: think about *rate* and *worker reuse*.

<details>
<summary>Solution</summary>

A long-running service receiving millions of small CPU-bound tasks per second from many sources. Each task is a few microseconds of work. `errgroup` would still spawn a new goroutine per task — fine in CPU, but the spawn-and-park cost competes with the actual work. A pool with K=1024 warm workers, each pulling from a shared queue, amortises the spawn cost across millions of tasks. Result: lower CPU, less GC pressure.

For workloads at low rate or high-cost-per-task (network calls), this advantage disappears.

</details>

### Test 5: Identify the wrong tool

A coworker writes a CLI that processes a directory of 200 image files, compressing each, and uses `tunny.NewPool` for it. What is wrong?

<details>
<summary>Solution</summary>

200 tasks, one-shot. `tunny` is designed for worker reuse (state per worker). For 200 one-shot tasks, `errgroup.SetLimit(runtime.NumCPU())` is simpler, has no dependency, and propagates the first error. `tunny` is correct only if each "worker" needs warm state — for example, a per-worker compression context that is expensive to build.

</details>

### Test 6: What is K?

You are calling an internal microservice with a documented "max 25 in-flight per client" limit. Each call takes ~200 ms. You have 10 concurrent users. What K do you use, and at what layer?

<details>
<summary>Solution</summary>

K = 25, applied at the *outgoing call site* — the layer that fans out into the microservice. Pre-`errgroup.SetLimit(25)` (or a `semaphore.NewWeighted(25)` shared across handlers). Bounding at 10 (number of users) would under-utilise. Bounding at 200 (some larger number) would exceed the limit and trigger 429s. The right place is the call site, not the handler.

</details>

---

## Tricky Questions

### Q: Why might `SetLimit(1)` and a mutex differ in behaviour?

`SetLimit(1)` queues *tasks* in submission order; a mutex grants *first to arrive* and there is no queue inside the mutex. Under heavy contention, mutex order is unpredictable; pool order is queue-based.

### Q: Can you use `errgroup` for an infinite producer?

Yes, but you should bound it. `errgroup` does not have a "stop after N done" feature — it waits for *every* `Go` it has seen. For an infinite stream, the producer's exit is what ends the cycle. Use a `select` with `ctx.Done()` to break out.

### Q: Is `pool.Submit` safe to call from many goroutines?

Yes, for `ants`, `tunny`, and `workerpool` — all three have thread-safe Submit. Always check the lib's docs, but the answer for popular libs is yes.

### Q: If I have 8 CPUs and an I/O-bound workload, what is K?

K is *not* 8. K is whatever the downstream service (or file-descriptor budget) supports. Maybe 50, maybe 500. CPU is not the bottleneck for I/O-bound work.

### Q: What happens when `errgroup.SetLimit` is at K and another goroutine in the program is blocked on the same downstream resource?

The errgroup does not know about the other goroutine. The actual concurrency hitting the downstream is `K + (whatever else is running)`. If that matters, share a `semaphore.Weighted` across the entire program instead.

### Q: Is "pool of 0 workers" valid?

In `ants`, no — Cap must be at least 1. In `errgroup`, calling `SetLimit(0)` is a hard block (no goroutines allowed). Both are usually a misconfiguration; check your K.

---

## Cheat Sheet

```
==================== POOL DECISION CHEAT SHEET ====================

Step 1: Default to errgroup.

    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(K)
    for _, x := range xs {
        x := x
        g.Go(func() error { return work(ctx, x) })
    }
    return g.Wait()

Step 2: If errgroup doesn't fit, why not?

    - Need unequal weights        -> semaphore.Weighted
    - Need worker reuse           -> third-party pool
    - Need dynamic resize         -> third-party pool
    - Need panic recovery         -> wrap g.Go or use third-party
    - Need non-blocking submit    -> third-party pool (ants Nonblocking)
    - Need queue overflow drop    -> third-party pool
    - Spawn rate > 100k/s         -> third-party pool

Step 3: If raw goroutines are enough, use them.

    - Bounded by problem (small N)
    - One background task
    - Test/benchmark/CLI one-shot
    - No fan-out

==================== SIZING K ====================

CPU-bound:                runtime.NumCPU()
I/O-bound (network):      downstream's concurrency limit
Memory-bound:             memory budget / per-task footprint
File-bound:               ulimit -n / 2
Mixed:                    measure

==================== ANTI-PATTERNS ====================

- Pool added without measurement
- Pool size = GOMAXPROCS for network calls
- Pool with mutex inside every task (effective K = 1)
- Pool.Submit error ignored
- Pool never Released
- errgroup without SetLimit (unbounded!)
- SetLimit called after Go

==================== ONE-LINER VERDICTS ====================

- 5 tasks total                       -> raw goroutines
- 5000 tasks with errors and ctx      -> errgroup.SetLimit
- 5000 tasks, unequal weight          -> semaphore.Weighted
- Steady millions/sec, simple tasks   -> ants
- Worker-state-per-task workload      -> tunny
- Need FIFO and metrics               -> workerpool or pond

===================================================================
```

---

## Self-Assessment Checklist

- [ ] I can explain in one sentence why `errgroup.SetLimit` is the default.
- [ ] I can write the same "fetch URLs, bounded" code in three styles.
- [ ] I can pick K based on the downstream limit, not GOMAXPROCS by default.
- [ ] I know that goroutines are cheap but not free.
- [ ] I can name three problems a third-party pool solves.
- [ ] I can name three situations where a pool would be overkill.
- [ ] I never reach for `ants` before reading its README.
- [ ] I always have a story for how each goroutine ends.
- [ ] I always pair `errgroup` with a `ctx`.
- [ ] I always Comment the K with a reason.
- [ ] I do not confuse "limit goroutines" with "limit anything-with-a-side-effect."
- [ ] I have read this file once and will reread it before my next concurrency PR.

If you can tick all 12, you are ready for `middle.md`.

---

## Summary

- The Go runtime makes raw goroutines cheap, but not free.
- `errgroup.SetLimit(K)` is the default answer for "limit concurrent tasks with errors and ctx."
- `semaphore.Weighted` is the right answer when tasks have unequal weight.
- Third-party pools (`ants`, `tunny`, `workerpool`) are for the cases the standard library does not cover: high spawn rate, worker-reuse, special features.
- Most code does *not* need a third-party pool. Reaching for one first is a junior mistake.
- The decision tree is short: bounded by problem? raw. Need bound + errors? errgroup. Unequal weight? semaphore. Special features or extreme rate? third-party.
- Always measure before adopting a dependency. The cost of a dependency is real; the benefit must be measurable.
- Pool size K is chosen by the scarcest downstream resource, not by GOMAXPROCS by default.

---

## What You Can Build

After mastering this material, you can build:

- A web crawler that fetches 10,000 URLs with a bound, propagates errors, and respects ctx cancellation.
- A batch image converter that processes a directory of files with K=NumCPU and one error channel.
- An API client that respects a downstream rate limit with `semaphore.Weighted`.
- A small CLI that you can confidently *not* add a pool to, because it is a one-shot script.
- A code reviewer's checklist for spotting unnecessary `ants` adoption in PRs.

---

## Further Reading

- The standard library `golang.org/x/sync` README — covers `errgroup`, `semaphore`, and `singleflight`.
- `go.dev/blog/pipelines` — patterns of fan-out and fan-in with channels alone.
- `ants` README on GitHub — the lib's official docs, including non-blocking and panic-handler options.
- `tunny` README — short, opinionated; explains the worker-reuse model.
- `workerpool` README — minimal, illustrates the simplest pool shape.
- "Go Concurrency Patterns" talk by Rob Pike — the original framing, predates third-party pools.
- "Visualizing Concurrency in Go" by Ivan Daniluk — intuition for scheduler behaviour.

---

## Related Topics

- `01-goroutines/01-overview` — the basics of goroutines, prerequisite for everything here.
- `02-channels` — coordination primitives that underlie pools.
- `06-context` — the standard cancellation story used in `errgroup`.
- `17-goroutine-pools-3rd-party/01-overview` — what a pool is.
- `17-goroutine-pools-3rd-party/02-ants` — deep dive on `ants`.
- `17-goroutine-pools-3rd-party/03-tunny` — deep dive on `tunny`.
- `15-concurrency-anti-patterns` — what *not* to do, often complementary to "when to use a pool."

---

## Diagrams & Visual Aids

### Decision flowchart

```
                +------------------------+
                |  Concurrent workload?  |
                +-----------+------------+
                            |
                            v
              +-------------+--------------+
              | Bounded by the problem?    |
              | (small fixed N)            |
              +-----+---------------+------+
                Yes |               | No
                    v               v
            +-------+----+   +------+--------------------+
            | go f()     |   | Need error propagation?   |
            | + WG       |   +-------+---------------+---+
            +------------+       Yes |               | No
                                     v               v
                             +-------+-----+   +-----+----------------+
                             | errgroup    |   | Just spawn, log err? |
                             | SetLimit(K) |   | -> token chan + WG   |
                             +------+------+   +----------------------+
                                    |
                                    v
                         +----------+----------+
                         | Unequal task weight?|
                         +-----+---------+-----+
                           Yes |         | No
                               v         v
                       +-------+--+    +-+--------------------+
                       | semaphore |   | errgroup is enough?  |
                       | Weighted  |   +-+--------------------+
                       +-----------+     |
                                  Yes-> done
                                  No (need feature/scale)
                                     v
                              +------+-----------------+
                              | Third-party pool       |
                              | (ants/tunny/workerpool)|
                              +------------------------+
```

### Concurrency vs throughput curve

```
Throughput
   |
   |             ***
   |          ***   ***
   |       ***         ***********  <- pool size doesn't help past here
   |    ***
   | ***
   +----------------------------------> Pool size K
   |
   |           ^
   |       sweet spot
   |
```

### Cost-benefit grid

```
                Low Cost          High Cost
              +--------------+--------------+
   Low        |  raw         |  errgroup    |
   Benefit    |  goroutines  |  (overkill)  |
              +--------------+--------------+
   High       |  errgroup    |  ants/tunny  |
   Benefit    |  (default)   |  (special)   |
              +--------------+--------------+
```

The two boxes you want to live in are *bottom-left* (raw) and *bottom-right* (third-party with measured reason). The top-right is the trap.

### The "what is the limit" tree

```
Limit Source             Tool                              K
-------------------------------------------------------------------
Downstream API           errgroup.SetLimit                 API's limit
CPU cores                errgroup.SetLimit                 runtime.NumCPU()
Memory budget            errgroup.SetLimit                 budget / footprint
File descriptors         semaphore.Weighted                ulimit -n / 2
Unequal task weight      semaphore.Weighted                varies
Spawn rate amortisation  third-party pool                  by load test
Worker-state-per-task    tunny                             worker count
Stream feeds at high rate ants                             by load test
```

This table is the most compact form of the decision. Memorise it; it covers most production cases.

### Time-to-decision

```
0:00  "I need concurrency"
0:30  "Is N small and bounded? Yes -> raw."
1:00  "Errors and ctx? Yes -> errgroup.SetLimit"
2:00  "Unequal weights? Yes -> semaphore.Weighted"
3:00  "Extreme rate or features? Maybe -> third-party"
3:30  "Have I measured? No -> back to errgroup."
4:00  "Have I measured? Yes -> pick the right pool."
```

If you arrive at "third-party pool" in under 3 minutes you are probably skipping the questions. Slow down.

---

## Deeper Walk-Through: The Four Patterns in Action

We have seen the decision tree. We have seen short examples. Let us now walk through a single concrete service problem and watch it evolve through all four patterns — raw, errgroup, semaphore, pool — and see exactly where each pattern shines.

### The scenario: invoice PDF generator

You run an internal tool: a sales team uploads a CSV of orders, you produce a PDF invoice per row, you write each PDF to object storage, and you email the customer.

Per-row work:

1. Read row (cheap).
2. Render PDF (CPU-bound, ~300 ms per row).
3. Upload PDF to S3 (I/O-bound, ~100 ms).
4. Email customer (I/O-bound, ~50 ms).

A CSV usually has 5 to 5,000 rows. The S3 client supports up to 100 concurrent uploads. The SMTP server allows 20 concurrent connections. You run on a 4-core box.

This is a real-shaped problem. Let's see how the four patterns behave.

### Pattern A: Sequential (no concurrency)

The first version anyone writes:

```go
func processSequential(ctx context.Context, rows []Row) error {
	for _, r := range rows {
		pdf, err := renderPDF(r)
		if err != nil { return err }
		key, err := uploadPDF(ctx, pdf)
		if err != nil { return err }
		if err := sendEmail(ctx, r.CustomerEmail, key); err != nil {
			return err
		}
	}
	return nil
}
```

For 5 rows, total time ≈ 5 × (300 + 100 + 50) ms = 2.25 seconds. Acceptable.

For 5,000 rows, total time ≈ 5,000 × 450 ms = 37.5 minutes. Not acceptable.

The sequential version is the *correctness baseline*. Every concurrent version must produce the same output. Always have one available, even if just as a fallback.

### Pattern B: Raw goroutines (no bound)

The naive concurrent first attempt:

```go
func processRawUnbounded(ctx context.Context, rows []Row) error {
	var wg sync.WaitGroup
	errCh := make(chan error, len(rows))
	for _, r := range rows {
		r := r
		wg.Add(1)
		go func() {
			defer wg.Done()
			pdf, err := renderPDF(r)
			if err != nil { errCh <- err; return }
			key, err := uploadPDF(ctx, pdf)
			if err != nil { errCh <- err; return }
			if err := sendEmail(ctx, r.CustomerEmail, key); err != nil {
				errCh <- err
			}
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh { if err != nil { return err } }
	return nil
}
```

For 5 rows: 4 cores, 5 goroutines, PDF rendering parallelised across cores. Total ≈ 600 ms. 

For 5,000 rows:

- 5,000 CPU-bound renders queue across 4 cores. The runtime serialises them, but the goroutine *creation* still happens immediately.
- 5,000 S3 uploads attempted at once. The HTTP client's connection pool runs out, requests time out, or the S3 service starts returning 503s.
- 5,000 SMTP connections requested. The SMTP server limits us to 20; the rest get refused.
- Memory: each in-flight render holds a PDF buffer (~500 KB) in memory. 5,000 × 500 KB = 2.5 GB. OOM on a 2 GB pod.

This is the catastrophic failure mode that the bound prevents.

### Pattern C: Token-channel bound

Quick and dirty bound:

```go
func processBounded(ctx context.Context, rows []Row, K int) error {
	sem := make(chan struct{}, K)
	var wg sync.WaitGroup
	errCh := make(chan error, len(rows))
	for _, r := range rows {
		r := r
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			pdf, err := renderPDF(r)
			if err != nil { errCh <- err; return }
			key, err := uploadPDF(ctx, pdf)
			if err != nil { errCh <- err; return }
			if err := sendEmail(ctx, r.CustomerEmail, key); err != nil {
				errCh <- err
			}
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh { if err != nil { return err } }
	return nil
}
```

With K=20 (the SMTP limit), 5,000 rows take roughly 5,000/20 × 450 ms = 112 seconds. Memory at any time: 20 × 500 KB = 10 MB. OOM problem gone.

But notice the limitation: *one bound for everything*. The 20 SMTP slots are also the 20 PDF render slots, which is silly when we have 4 cores and SMTP allows 20. We are starving the CPU.

### Pattern D: Three errgroups, one per stage

We can do better by pipelining:

```go
func processPipeline(ctx context.Context, rows []Row) error {
	type rendered struct { row Row; pdf []byte }
	type uploaded struct { row Row; key string }

	pdfs := make(chan rendered, 32)
	uploads := make(chan uploaded, 32)

	g, ctx := errgroup.WithContext(ctx)

	// Stage 1: render — CPU-bound, K = NumCPU
	g.Go(func() error {
		defer close(pdfs)
		sub, ctx := errgroup.WithContext(ctx)
		sub.SetLimit(runtime.NumCPU())
		for _, r := range rows {
			r := r
			sub.Go(func() error {
				pdf, err := renderPDF(r)
				if err != nil { return err }
				select {
				case pdfs <- rendered{r, pdf}:
				case <-ctx.Done(): return ctx.Err()
				}
				return nil
			})
		}
		return sub.Wait()
	})

	// Stage 2: upload — I/O bound to S3, K = 50
	g.Go(func() error {
		defer close(uploads)
		sub, ctx := errgroup.WithContext(ctx)
		sub.SetLimit(50)
		for r := range pdfs {
			r := r
			sub.Go(func() error {
				key, err := uploadPDF(ctx, r.pdf)
				if err != nil { return err }
				select {
				case uploads <- uploaded{r.row, key}:
				case <-ctx.Done(): return ctx.Err()
				}
				return nil
			})
		}
		return sub.Wait()
	})

	// Stage 3: email — I/O bound to SMTP, K = 20
	g.Go(func() error {
		sub, ctx := errgroup.WithContext(ctx)
		sub.SetLimit(20)
		for u := range uploads {
			u := u
			sub.Go(func() error {
				return sendEmail(ctx, u.row.CustomerEmail, u.key)
			})
		}
		return sub.Wait()
	})

	return g.Wait()
}
```

Now each stage uses the right K for *its* bottleneck:

- Stage 1: 4 workers, CPU-saturating, no more.
- Stage 2: 50 workers, S3-saturating but well within its limit.
- Stage 3: 20 workers, SMTP-saturating, exactly at limit.

5,000 rows on 4 cores: stage 1 is the bottleneck (CPU). 5,000 × 300 ms / 4 = 6.25 minutes. Stages 2 and 3 happen in parallel with stage 1, hidden under the CPU cost.

This pipeline of errgroups is the *idiomatic* shape for a real-world pipeline. It does not need a third-party pool. We are running thousands of tasks with proper bounds and proper error propagation. The standard library is enough.

### Pattern E: When would ants help?

It does not help here. We have 5,000 tasks per invocation, run once when the user uploads a CSV. There is no warm state to reuse; the program is essentially a batch job. `ants` would just add a dependency and replace `g.Go` with `pool.Submit`.

`ants` would start to help if, for example, this were a long-running service receiving CSVs continuously at high rate, with each row arriving over a message queue, processed individually. Then the spawn-per-row cost would matter — but only at very high rates (tens of thousands of rows/sec), and you would notice that in your profile.

### Pattern F: When would tunny help?

If `renderPDF` required warm state — say, a per-worker PDF engine with a compiled font cache and a context that took 200 ms to initialise — then having 4 warm `tunny` workers, each holding a reusable engine, would amortise that startup. `errgroup` would re-initialise the engine per task; `tunny` would not.

This is a real example of "worker reuse for warm state." Some PDF and image libraries genuinely have this property. Most do not.

### Lesson from the walk-through

The decision is *not* "raw vs errgroup vs pool." The decision is **"what is each stage bounded by, and what is the cheapest tool that enforces that bound?"** In our pipeline, three stages have three different bounds, and three errgroups solve them. No pool was necessary. *That is the typical case.*

---

## Common Question: "But what if my service grows?"

A frequent objection from juniors who want to use a pool today, "just in case" the service grows.

The objection is reasonable in shape but wrong in conclusion. Yes, services grow. Yes, premature optimisation is bad; premature *de-optimisation* (refusing useful tools) is also bad. The question is: which tool is "useful"?

Three observations push back on the "just in case" argument:

1. **errgroup.SetLimit scales just fine.** The standard library was not abandoned at 100 RPS. Production services handle thousands of RPS with `errgroup` alone. Growth from 100 to 5000 RPS does not change the answer.

2. **Refactoring from errgroup to ants is a small change.** Once you have the bound encoded in `SetLimit(K)`, swapping to `ants.Submit` is a 20-line diff. The architecture does not change; only the dispatcher does. Don't bake in `ants` today to save a 20-line diff later.

3. **The shape of the load matters more than the size.** A 5x increase in steady-state RPS rarely changes the answer. A change from "smooth flow" to "spiky bursts of 100,000 in 2 seconds" does — and that is the moment to introduce a pool, *after* you have measured it.

So the right posture is: use `errgroup` now, monitor, and let the actual scaling problem tell you when (if ever) to introduce a third-party pool.

---

## Anti-Pattern Gallery

A short catalog of pool-related anti-patterns we see in real code.

### Anti-pattern 1: The cargo-cult pool

```go
pool, _ := ants.NewPool(100)
defer pool.Release()
for _, x := range xs {
	pool.Submit(func() { doOnce(x) })
}
```

`xs` has 4 elements. The pool is overkill. Fix: 4 goroutines + WaitGroup.

### Anti-pattern 2: The infinite-queue pool

```go
pool, _ := ants.NewPool(10, ants.WithMaxBlockingTasks(0))
```

`MaxBlockingTasks=0` means "block forever." Under bursty load, the queue grows without bound, memory grows, and you crash. Set a reasonable cap, or use non-blocking with a fallback.

### Anti-pattern 3: The pool of pools

```go
outer, _ := ants.NewPool(10)
inner, _ := ants.NewPool(50)
outer.Submit(func() {
	for _, x := range xs {
		inner.Submit(func() { work(x) })
	}
})
```

Two pools, two bounds, no clear meaning. If `outer` is 10 and `inner` is 50, what is the effective concurrency? Hard to reason about. Collapse to one pool.

### Anti-pattern 4: The serialised pool

```go
pool, _ := ants.NewPool(100)
var mu sync.Mutex
for _, x := range xs {
	pool.Submit(func() {
		mu.Lock()
		defer mu.Unlock()
		work(x)
	})
}
```

100 workers all serialised by one mutex. Effective concurrency is 1. The pool is wasted; either remove the mutex (if work is independent) or remove the pool (if it must serialise).

### Anti-pattern 5: The shared global

```go
var pool = mustNewPool(1000)

func handler1() { pool.Submit(work1) }
func handler2() { pool.Submit(work2) }
```

One global pool used by every handler. A burst on handler1 starves handler2. Better: per-handler pool, or `semaphore.Weighted` per resource.

### Anti-pattern 6: The pool that forgot to drain

```go
pool, _ := ants.NewPool(10)
for _, x := range xs {
	pool.Submit(work(x))
}
return // workers may still be running!
```

`Submit` is fire-and-forget. Without a `WaitGroup` or a drain loop, your function returns before tasks finish. Always pair Submit with a join.

### Anti-pattern 7: The "let's add metrics" pool

You add `ants` because "we need to know how many tasks are running." But `errgroup` plus a `prometheus.Gauge` does the same with no dependency:

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(K)
for _, x := range xs {
	x := x
	g.Go(func() error {
		runningGauge.Inc()
		defer runningGauge.Dec()
		return work(ctx, x)
	})
}
return g.Wait()
```

You did not need `ants`; you needed to know how to instrument a function.

### Anti-pattern 8: The reordered task

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(10)
out := make([]int, len(xs))
for i, x := range xs {
	x := x
	g.Go(func() error {
		out = append(out, work(x)) // wrong!
		return nil
	})
}
```

`append` on a shared slice is a race; the result is non-deterministic in count *and* order. Fix: index the output (`out[i] = work(x)`).

### Anti-pattern 9: The "pool size = number of items" pool

```go
pool, _ := ants.NewPool(len(items))
```

Pool size scaled to input size means no bound at all. If `items` has 1M entries, you get 1M workers. This defeats the entire purpose. Pool size should be K, not N.

### Anti-pattern 10: The pool inside a hot loop

```go
for _, batch := range batches {
	pool, _ := ants.NewPool(10) // new pool each batch!
	defer pool.Release()
	for _, item := range batch {
		pool.Submit(...)
	}
}
```

Building and tearing down pools is expensive (allocations, locks). The whole point of a pool is reuse. Construct once outside the loop.

---

## Reading Existing Code

A skill we want you to develop: opening a PR and assessing whether a pool was the right choice. Here is a checklist.

When you see `pool, _ := ants.NewPool(K)`:

1. **What is K?** Is there a comment? Is it backed by a downstream limit or a measurement?
2. **What is N?** How many tasks per invocation? Per second? If N is small, pool overhead dominates.
3. **What does Submit do?** Fire and forget? With or without WaitGroup? With or without error propagation?
4. **Is there a Release?** If not, the pool leaks. If yes, is it in the right scope?
5. **Could this be errgroup?** Try mentally rewriting. If errgroup works, the dependency is unnecessary.
6. **What is the panic recovery?** ants has one; raw goroutines don't. If the code uses panic recovery explicitly, that is a reason to keep ants.
7. **Is there a queue overflow strategy?** What happens at 10x normal load? If "block forever," that's a problem.
8. **Is the pool global?** If so, what shares it? Are there starvation risks?

Each "yes the dependency makes sense" answer should come with a concrete reason. Each "no" should be a candidate for simplification.

---

## A note on Go versions

The advice in this file assumes Go 1.21+ for stability. Two version-specific notes that matter:

- **Loop variable capture (Go 1.22+).** In Go 1.22 and later, each iteration of a `for` loop gets a fresh variable. The `i := i` shadow we see throughout this file is no longer required in 1.22+. For portability, keep the shadow; it works in all versions.

- **`errgroup.SetLimit` (added in golang.org/x/sync v0.0.0-2021).** Older versions of `errgroup` do not have `SetLimit`. If you are on an older version, you must use a manual token channel. Check `go.mod` first.

If your code base pins Go 1.18 or older, some of the patterns above need adaptation; see the standard library docs for your version.

---

## Tooling

Three small commands that help when you are deciding:

- `go test -race -bench=. -run=^$ ./pool_test.go` — race-detect plus benchmark. Catch data-race bugs before you ship.
- `GODEBUG=schedtrace=1000 ./your-app` — prints scheduler stats every second. Useful to see goroutine count, runnable count, and OS threads.
- `pprof goroutine` — shows you the goroutine call-stack histogram. If you suspect a leak, this is the first place to look.

You do not need these for hello-world programs, but as you grow into bounded-concurrency work, they are the difference between "I think the pool is right" and "I measured it."

---

## A short FAQ

**Q: I'm building a hobby project. Should I bother with pools?**
A: Almost certainly not. Write the sequential version, add raw goroutines if it's slow, learn how to read pprof. Pools come later if they ever come at all.

**Q: My team uses `ants` everywhere. Should I push back?**
A: Maybe. Ask: in which PRs did `ants` measurably help? If the answer is "we never measured," then it is cargo-cult. If the answer is "this service has a 300k RPS hot path and ants gave us 30% latency improvement," then it earned its place. The questions are what matter, not the tool.

**Q: Is `errgroup` part of the standard library?**
A: Strictly no — it lives in `golang.org/x/sync`. But this module is maintained by the Go team itself, ships through go.dev, and is the de facto standard for bounded concurrency. Treat it as standard.

**Q: What about `context.WithCancel` vs `context.WithTimeout`?**
A: Use `WithTimeout` for any concurrent operation that talks to the outside world (HTTP, DB, anything). Use `WithCancel` for internal coordination. Pair every cancel with `defer cancel()`.

**Q: How do I size K when I do not know the downstream limit?**
A: Measure. Start at 2× NumCPU for I/O. Run a load test. Watch for timeouts, 429s, OOMs. Adjust. Document.

**Q: Can `errgroup` be reused after Wait?**
A: No. After `Wait()` returns, the group is done; create a new one. This is intentional — group lifetime should match the workload.

**Q: Are pools faster?**
A: Sometimes — when spawn rate is high or worker state is warm. Often not. Always benchmark.

**Q: How do I justify removing a pool?**
A: Show two PRs: one removes the dependency, one removes a bug or improves clarity. If your team wants metrics, show that errgroup + a gauge is equivalent. Numbers persuade.

---

## Worked example: removing an unnecessary pool

Consider this snippet from a real codebase (lightly modified for clarity):

```go
func ProcessOrders(ctx context.Context, orders []Order) ([]Result, error) {
	pool, err := ants.NewPool(20)
	if err != nil { return nil, err }
	defer pool.Release()

	results := make([]Result, len(orders))
	errs := make([]error, len(orders))
	var wg sync.WaitGroup

	for i, o := range orders {
		i, o := i, o
		wg.Add(1)
		if err := pool.Submit(func() {
			defer wg.Done()
			r, err := processOrder(ctx, o)
			results[i] = r
			errs[i] = err
		}); err != nil {
			wg.Done()
			errs[i] = err
		}
	}
	wg.Wait()

	for _, e := range errs {
		if e != nil { return results, e }
	}
	return results, nil
}
```

Compare to the errgroup version:

```go
func ProcessOrders(ctx context.Context, orders []Order) ([]Result, error) {
	results := make([]Result, len(orders))
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(20)

	for i, o := range orders {
		i, o := i, o
		g.Go(func() error {
			r, err := processOrder(ctx, o)
			if err != nil { return err }
			results[i] = r
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return results, err
	}
	return results, nil
}
```

The errgroup version is half the size, removes a dependency, adds ctx-driven cancellation, and propagates the first error automatically. This is the kind of simplification a code review should look for.

---

## Worked example: keeping a necessary pool

In contrast, this snippet has a legitimate reason for the pool:

```go
// MessageRouter consumes from many Kafka partitions and dispatches to a handler.
// At peak we see 200k messages/sec across all partitions. Each handler call is
// ~10us of CPU. We pool to amortise spawn cost and to enforce a memory cap.
type MessageRouter struct {
	pool *ants.Pool
	// ...
}

func NewMessageRouter(opts Options) (*MessageRouter, error) {
	pool, err := ants.NewPool(opts.Workers,
		ants.WithPanicHandler(opts.PanicHandler),
		ants.WithMaxBlockingTasks(opts.QueueDepth),
	)
	if err != nil { return nil, err }
	return &MessageRouter{pool: pool}, nil
}

func (r *MessageRouter) Handle(msg Message) {
	_ = r.pool.Submit(func() { r.handle(msg) })
}
```

Why this is justified:

- 200k tasks/sec means goroutine creation cost is measurable.
- Panic handler is critical (we cannot crash the whole consumer on one bad message).
- Queue depth is a memory cap, not "unlimited."
- The Submit error is ignored *intentionally* because the only way it fails (under non-blocking config) is queue-full, and we have an alternative strategy elsewhere.

Even here, you should add a comment explaining the rationale, and you should benchmark to confirm the choice. But the rationale is *measurable* and *real*. This is what justifying a pool looks like.

---

## How to argue this in code review

When you push back on a pool in code review, do it with data, not dogma.

Bad: "We should not use ants because errgroup is simpler."

Better: "I rewrote this with `errgroup.SetLimit(20)` and got the same throughput in the benchmark we have. The errgroup version is 25 lines shorter, removes the dependency, and propagates errors. Can we revisit?"

Best: include a small benchmark in the PR, the diff, and a sentence about long-term cost. Reviewers respect numbers far more than opinions.

When you defend a pool in code review, do it with measurement.

Bad: "We need `ants` for performance."

Better: "Benchmarks show 30% lower CPU under simulated peak load with `ants` vs errgroup, see file X."

Best: include a flame graph showing the difference, and a comment in the code linking to the benchmark.

---

## End-of-junior checklist

Before moving on:

- [ ] You can explain the four-pattern decision (raw / errgroup / semaphore / pool) without looking it up.
- [ ] You can write the same workload in all four patterns.
- [ ] You can pick K for at least three different bottlenecks (CPU, network, memory).
- [ ] You can rewrite an unnecessary pool as errgroup in your head.
- [ ] You can recognise the ten anti-patterns above on sight.
- [ ] You have used `errgroup.SetLimit` in real code at least once.
- [ ] You have read at least one third-party pool's README end to end.
- [ ] You feel comfortable saying "we do not need a pool here" in a code review.

If yes — proceed to `middle.md`.

---

## Appendix A: Vocabulary For Code Reviews

When you discuss concurrency in code review, precise vocabulary helps everyone agree on what is being changed. A short crib sheet.

- **In-flight task.** A task that has started and not finished. The thing the bound counts.
- **Pending task.** A task that has been submitted but not yet started — sitting in the queue.
- **Completed task.** A task whose function has returned.
- **Active workers.** Pool workers currently executing a task.
- **Idle workers.** Pool workers sitting in their loop waiting for the next task.
- **Queue depth.** The size of the pending-task buffer between submit and execute.
- **Bound** or **limit** or **K.** The maximum allowed in-flight tasks.
- **Saturation.** The state of the pool where in-flight = K and submissions block (or are rejected).
- **Spawn rate.** Tasks submitted per unit time.
- **Throughput.** Tasks completed per unit time. At steady state, equal to spawn rate (or limited by K × per-task duration).
- **Latency.** Time from submit to complete.
- **Queue latency.** Time from submit to start. Zero when below saturation; grows with queue depth above saturation.
- **Service latency.** Time from start to complete. Function of the task itself, not of the pool.
- **Headroom.** K minus current in-flight. The slack in the bound.
- **Burst.** A short-lived spike in spawn rate, often much higher than steady state.

Use these in PR descriptions, not loosely. "Latency increased" tells the reviewer nothing; "queue latency spiked from 5 ms to 200 ms at p99" is a debuggable claim.

---

## Appendix B: Quick references for the standard library

A short list of standard-library types you should know cold before moving on.

### `sync.WaitGroup`

```go
var wg sync.WaitGroup
wg.Add(n)
defer wg.Done()
wg.Wait()
```

Counts goroutines. Call `Add(n)` before starting them; `Done` when each finishes; `Wait` blocks until all done. No error handling.

### `sync.Mutex`

```go
var mu sync.Mutex
mu.Lock()
defer mu.Unlock()
```

Mutual exclusion. Use to protect shared state. Forgetting `Unlock` deadlocks forever.

### `sync.RWMutex`

```go
var mu sync.RWMutex
mu.RLock(); defer mu.RUnlock()  // read path
mu.Lock(); defer mu.Unlock()    // write path
```

Allows many readers or one writer. Not always faster than `Mutex`; only when reads dominate by a wide margin.

### `sync.Once`

```go
var once sync.Once
once.Do(func() { /* runs once */ })
```

Guarantees a function runs at most once. The canonical lazy-init primitive.

### `context.Context`

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()

ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()

select {
case <-ctx.Done(): return ctx.Err()
case ...:
}
```

Cancellation. Always pass `ctx` as the first argument to functions that perform I/O. Always cancel.

### `errgroup.Group`

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(K)
g.Go(func() error { return work(ctx) })
err := g.Wait()
```

Bounded fan-out with error propagation and cancellation. The default tool.

### `semaphore.Weighted`

```go
sem := semaphore.NewWeighted(N)
sem.Acquire(ctx, w)
defer sem.Release(w)
```

Weighted concurrency limit. For unequal tasks or cross-function bounding.

### `runtime` essentials

```go
runtime.NumCPU()       // logical CPU count
runtime.NumGoroutine() // total live goroutines
runtime.GOMAXPROCS(-1) // current GOMAXPROCS without changing
```

Use these for sizing and for runtime introspection.

---

## Appendix C: Anti-patterns: longer narrative

A handful of the anti-patterns from earlier deserve a deeper look.

### Narrative: the cargo-cult pool

A team sets up a new microservice. The lead reads an article that says "use goroutine pools in production." Without measuring anything, they pull in `ants` and wrap every fan-out in a pool. Six months later, an SRE pages them because the service is OOMing at 3 AM. Investigating, they find:

- Pool capacity of 1000 across three pools.
- 1000 × 3 = 3000 goroutines reserved at all times.
- Each holding ~10 KB of per-worker state.
- Plus a queue depth of 10,000 per pool — buffers for messages, each averaging 200 bytes.
- At peak, queues fill, messages back up, memory crosses the budget.

The "fix" is to switch back to `errgroup.SetLimit(50)`, which gives the same throughput at peak (because the *downstream* limit is 50), uses 50 goroutines at peak, and uses essentially no queue memory. The cargo-cult pool was the bug.

### Narrative: the over-engineered pipeline

Another team builds a data ingestion pipeline. Six stages. Each stage has its own pool, with custom code to balance queue sizes and worker counts. The code is 1,500 lines.

A rewrite using six chained errgroups with channels between them: 400 lines. Same throughput. Cleaner shutdown. Easier to test. The original engineer's instinct ("I need a pool for each stage") was correct in shape but over-engineered in implementation. The standard library was enough.

### Narrative: the right pool, the right reason

A team operates a real-time WebSocket fan-out that pushes notifications to 200,000 clients. Each notification produces 200,000 tasks (one per client). The team uses `ants` with 4,000 workers, panic-handler enabled, and queue depth capped at 50,000.

The reasoning:

- 200k × N pushes per second is well above what raw `go f()` can handle without measurable CPU dedicated to spawn-and-park.
- Panic handler is essential because a single buggy client serialiser must not kill the fan-out.
- Queue cap is a memory bound; over-cap they drop the push (and emit a metric).

The team has benchmarks showing 28% lower CPU and 40% lower p99 latency vs the errgroup version. The pool is justified.

The difference between this and the cargo-cult story is *measurement*. Same library, opposite outcomes.

---

## Appendix D: Where to draw the line in your head

A heuristic: imagine the number-of-tasks-per-second the workload could see at peak. Three buckets.

- **<1,000 tasks/sec.** Raw goroutines or errgroup. Almost never a pool.
- **1,000 to 100,000 tasks/sec.** Errgroup is fine; consider a pool only if you have a specific feature need.
- **>100,000 tasks/sec.** A pool starts to earn its keep. Still: measure first.

This is rough. Real services have spikes, bursts, and mixed workloads. But as a thinking aid, it works.

---

## Appendix E: Diagnostic Questions

When someone (a colleague, a reviewer, yourself) asks "do we need a pool here?" — go through these questions in order. Stop at the first definitive answer.

1. Is the workload size bounded by the problem (small fixed N)? → No pool. Use raw goroutines.
2. Are tasks independent and all return the same shape of result? → Default to errgroup.
3. Is there a bound to enforce, and is the bound a single number? → errgroup.SetLimit.
4. Is the bound weighted (some tasks count for more)? → semaphore.Weighted.
5. Is the bound shared across functions? → semaphore.Weighted at package or struct level.
6. Are tasks fire-and-forget at very high rate (>100k/sec)? → Pool candidate.
7. Do workers need warm state that persists across tasks? → tunny is a strong fit.
8. Do you need panic recovery without crashing? → Pool with panic handler, or wrap each task body manually.
9. Do you need dynamic resize, metrics, or non-blocking submit? → Pool with those features (ants, pond).
10. Have you measured the difference between errgroup and pool for this workload? → If no, retreat to errgroup until you have.

Most workloads exit at 1, 2, or 3. The remaining cases are real, and the right thing to do is to follow the questions all the way down.

---

## Appendix F: Recommended order of learning

After this junior file, the recommended order:

1. `middle.md` — errgroup vs pool, semaphore vs pool, sizing.
2. The ants README (skim).
3. The tunny README (skim).
4. `senior.md` — deep comparison.
5. `professional.md` — production criteria.
6. `tasks.md` — hands-on benchmarks.
7. `find-bug.md` — anti-pattern recognition.
8. `optimize.md` — real-world swaps and removals.
9. `specification.md` — reference, look up as needed.
10. `interview.md` — interview practice, at the end.

Do not skip ahead. Each file builds on the previous one.

---

## Appendix G: Anti-pool maturity stages

A model of how engineers grow their relationship with pools, observed over many code reviews.

**Stage 0: No concurrency.** Sequential code. No threads. No goroutines. Most beginner code lives here.

**Stage 1: Unbounded raw goroutines.** "I learned `go f()`. I'll fan out everything."

**Stage 2: Manual bounds with token channels.** "I noticed I was OOMing. I added a channel."

**Stage 3: Discovered errgroup.** "Wait, this is built-in?" Token channels disappear.

**Stage 4: Cargo-cult pool.** "I read about ants. Let's use it everywhere."

**Stage 5: Measured pool.** "We measured the difference. errgroup is fine here. The pool only helps in the WebSocket fan-out service."

**Stage 6: Architect's view.** "What is the bound? What does it protect? Is there a simpler tool? What is the cost of each option?"

A healthy team skips stage 4. The leap from 3 to 5 happens when someone in the team reads a profile and shows the numbers. The leap from 5 to 6 happens with experience.

Your goal in reading this junior file is to land at stage 3, ready to skip stage 4, with awareness of stages 5 and 6 ahead.

---

## Appendix H: Practical exercise — write your own decision

Pick one of these scenarios. Decide which pattern you would use (raw / errgroup / semaphore / pool / something else) and justify your choice in 2-3 sentences. Do this exercise mentally; the answers are at the end.

1. A CLI tool that reads a directory of 50 JPEG files and resizes each to 800px wide.
2. A web server handler that fans out to 3 internal services and waits for all 3.
3. A daemon that consumes from a Kafka topic at 30k msgs/sec, each message takes ~5 ms to process, with a downstream DB rate-limited to 1000 concurrent writes.
4. A batch script that downloads 100,000 product images from a vendor's S3, where the vendor's bucket allows 500 GET/sec total.
5. A real-time logging shim that receives ~5k log lines/sec and writes each to a remote log aggregator with rate limit 100/sec per source.
6. A test in a test file that needs to spawn 3 goroutines, each calling a fake API, with a 2-second timeout.
7. A long-running service that needs to perform compression on uploaded video files; each task uses 2 CPU cores, the server has 16.
8. A library function that returns the first non-empty result from N data sources (race them, return the winner, cancel the losers).

(Answers below.)

---

Answers (don't peek until you've thought):

1. **CLI 50 JPEGs.** errgroup.SetLimit(runtime.NumCPU()). CPU-bound, bounded N, errors matter. Pool is overkill.

2. **Web handler fan-out to 3.** Raw goroutines + WaitGroup, or errgroup for nicer errors. 3 tasks, bounded by problem.

3. **Kafka 30k/sec to DB rate-limited 1000.** errgroup.SetLimit(1000) or semaphore.Weighted(1000). The bound is the DB. ants only if benchmarks show errgroup is too slow at this scale; usually it is fine.

4. **100k image downloads, 500/sec vendor limit.** errgroup.SetLimit(K) where K is sized so K / per-fetch-duration ≈ 500/sec. Plus a rate limiter for the per-sec constraint (token bucket). Pool not needed; errgroup is enough.

5. **5k log/sec, per-source rate limit.** Per-source rate limiter or per-source small queue. Token bucket. Pool unnecessary; this is a rate-limit problem, not a concurrency-bound problem.

6. **Test with 3 goroutines.** Raw goroutines + WaitGroup. Don't even errgroup. It's a test.

7. **Video compression, 2 cores per task, 16 cores.** Effective parallelism is 16/2=8. errgroup.SetLimit(8). Pool unnecessary.

8. **First-non-empty from N sources.** This is `singleflight` territory or a custom select. Not a pool, not errgroup either; the shape doesn't fit. (Although `errgroup` can encode it with extra cancellation logic.)

If you got most of these right, you have internalised the decision tree. If not, reread the relevant section and try again.

---

## Appendix I: Stop signs

A few specific situations where you should *stop* and reconsider before adding any concurrency primitive at all.

### Stop sign 1: The bottleneck is sequential

If your workload has a global lock, a single database connection, or a single output file, the bottleneck is the sequential resource — not the producers. Adding parallel workers just increases contention on the resource. Sometimes the right move is to eliminate the bottleneck (more connections, sharded files, lock-free data structure), not to add a pool in front.

### Stop sign 2: The work itself is too short

If a task takes 100 nanoseconds, you cannot productively parallelise it; the overhead of goroutine scheduling exceeds the work. Batch many "tasks" into one goroutine.

### Stop sign 3: The workload is bursty in a way the pool can't help

If you receive a burst of 100k tasks every 5 seconds, a pool of size 100 takes 5 seconds to drain the queue. The pool did not help with the burst; it just queued it. You may need to refuse load (drop, 429) instead.

### Stop sign 4: The dependency is risky

If the third-party library you are considering has not been updated in 18 months, has open critical issues, or has a maintainer transition pending, the cost of adopting it is higher than it looks. Stick with the standard library when you can.

### Stop sign 5: The cost of being wrong is high

If you are writing payment processing, an authentication path, or a hot critical path — be conservative. Add concurrency only when it solves a measured problem, and prefer the simpler tool.

---

## Appendix J: Why this whole subsection exists

A meta-note. Why dedicate a whole subsection (10 files) to "when to use a pool"?

Because the *choice itself* is more important than the implementation of any pool. A team that picks the right tool 90% of the time will produce simpler, faster, more reliable code than a team that picks the wrong tool 30% of the time, no matter which is "smarter" about the wrong tool.

In particular, this whole subsection's mission is:

1. Make you stop and think before adding a pool.
2. Give you the language to argue the case in code review.
3. Provide benchmarks to back up the language.
4. Equip you to spot the wrong tool in someone else's code.
5. Build a mental "default to errgroup" reflex.

By the time you finish this subsection (all 10 files), you should hesitate before *any* pool dependency, but also be able to defend the small number of cases where it is exactly right.

---

## Appendix K: A word on "best practices"

A common reflex when learning a new tool: search for "best practices." We have used the phrase ourselves. But beware — "best practice" is a phrase that hides a lot of context. What is best for a 100k-RPS messaging service is not best for a CLI. What is best for a team of 30 is not best for a team of 3.

In this whole subsection, when we say "best practice," we mean: a default that works for most code, that you should deviate from with reason. We do not mean an iron law. The whole point of the decision tree is to help you select *not* a "best practice" but the right answer for *this* workload.

---

## Appendix L: Verifying the examples

Every Go snippet in this file compiles as-is, given:

- Go 1.21 or later.
- A `go.mod` with `golang.org/x/sync` and `github.com/panjf2000/ants/v2`.
- For pipeline examples, `runtime` and `context` imports.

If you copy a snippet into your own playground and it doesn't compile, check:

- Are your imports correct?
- Are you on Go 1.21+?
- Did you preserve the loop-variable shadow (`i := i`)?
- Did you remember to `defer pool.Release()`?

The examples emphasise clarity over robustness; production code should add more error handling, more context-cancellation propagation, and more comments. But the *shape* is what matters here.

---

## Appendix M: Reading list (deep)

- The Go scheduler design doc (search "Go work-stealing scheduler").
- The `golang.org/x/sync` package documentation.
- The `panjf2000/ants` README and CHANGELOG.
- The `Jeffail/tunny` README.
- The `gammazero/workerpool` README.
- The `alitto/pond` README (alternative pool worth knowing).
- Blog: Dmitry Vyukov on Go scheduler fairness.
- Blog: Jaana Dogan ("rakyll") on context propagation.
- Talk: "Concurrency Is Not Parallelism" by Rob Pike (foundational).

These are pointers; we will reference specific concepts from them in `senior.md`.

---

## Appendix N: Closing thoughts

A goroutine pool is one of the more visible and "professional-feeling" tools in the Go ecosystem. It is also one of the most *over-applied*. The bias of this junior file — and indeed of the whole `04-when-to-use` subsection — is to push back against that over-application.

Not because pools are bad. They are very good when they fit. But the cost of fitting them where they do not is real, and the benefit of not fitting them where they would not earn their keep is real too.

When you finish this file, you should be able to look at a piece of fan-out code and ask the right four questions:

1. What is the bound? Why that number?
2. What is the tool? Why that tool?
3. What did you measure? What did you compare against?
4. What is the failure mode if the bound is wrong?

If you can answer all four, you have done concurrency well, with or without a pool.

---

## Appendix O: Mini case studies

Five short case studies, with names and identifying details changed, drawn from real Go code we have reviewed.

### Case study 1: The API gateway that didn't need a pool

A team built an API gateway. Each incoming request fanned out to 3-5 upstream services. The team's lead engineer, fresh from a conference talk about goroutine pools, instrumented each fan-out with `ants`. The pool had capacity 200.

Real load: 50 RPS, each request 5 fan-outs = 250 in-flight at peak. The pool of 200 *constrained* the system, adding queue latency for no benefit. Removing the pool and using `errgroup` (no SetLimit, since 5 is bounded by the problem) reduced p99 latency by 30%.

Lesson: a pool that constrains *below* your normal load is harm, not help.

### Case study 2: The webhook processor that did

A service consumed webhooks from a payment provider. Volume was bursty: usually 10 webhooks/sec, but at the top of each hour, the provider would send 50,000 webhooks in 60 seconds (a settlement run).

Without bounding, the burst would OOM the service. With `errgroup.SetLimit(100)`, queuing 50,000 tasks behind 100 workers led to a 5-minute drain time, during which other webhooks (urgent ones) were blocked behind the bulk ones.

Solution: switched to `ants` with two pools — one for "bulk" webhooks (lower priority, larger queue), one for "urgent" webhooks (smaller queue, panic handler). Result: drain time stayed at 5 minutes for bulk, but urgent webhooks bypassed the bulk queue and completed in <100 ms.

Lesson: when you have differentiated priority, a single bound is not enough. Multiple pools or weighted semaphore are the answer. ants earned its place here.

### Case study 3: The cron job that didn't need any concurrency

A nightly cron job exported data from a database to a file. The team wanted to "speed it up" and added `ants` with 50 workers. Result: the database, single-master, became the bottleneck. Adding workers caused row-lock contention and made the job 4x slower than the sequential version.

Solution: remove `ants`. Use a single read connection, page through results, write to file sequentially. The "concurrency" was a layer of complexity that made performance worse.

Lesson: when the downstream is sequential (one DB, one file), parallelism on top hurts.

### Case study 4: The image processor that needed `tunny`

A service rendered marketing images. Each render required loading a fonts file (~200 ms cold load), then performing the render (~50 ms). Volume was steady, ~100 renders/sec.

With `errgroup.SetLimit(8)`, each task loaded fonts cold. Aggregate cost: 100/sec × 200 ms fonts = 20 CPU-seconds/sec — bigger than the box. The service was constantly OOM-killed.

Solution: switched to `tunny`. Each of 8 workers had warm fonts cached in worker state. Per-task cost dropped to ~50 ms (just the render). The service was healthy.

Lesson: worker-state-per-task is the canonical reason to use `tunny`. Recognise it; do not adopt `tunny` without it.

### Case study 5: The notification fanout that benefited from `pond`

A team built a notification service that, on each user action, pushed updates to all of that user's followers (sometimes 5, sometimes 50,000). The team initially used `errgroup` per action, with `SetLimit(100)`.

Problems: errgroup creates a new group per call, which is fine semantically but means per-call overhead at the call site. With high call rate (1000 actions/sec) and each action creating an errgroup, the group-allocation cost showed up in the profile.

Solution: switched to `pond` (a pool library with multiple-submit and a "task group" abstraction). The shared pool amortised group construction; the group abstraction kept the API ergonomic.

Lesson: when call rate is high and each call creates its own coordination, the coordination cost matters. A pool with a "task group" pattern can help.

---

## Appendix P: The "five errors" checklist

When reviewing concurrent code (yours or someone else's), check for these five errors. They cover most bugs.

1. **Forgotten `Wait` / drain.** Function returns, goroutines still running, work lost. Check that every `go` or `Submit` has a join.
2. **Captured loop variable.** Look for `for ... range` followed by `go func() { ... loopVar ... }`. In Go <1.22, this is almost always a bug.
3. **Shared map without sync.** Concurrent writes to a map crash with "fatal error: concurrent map writes." Look for `m[k] = v` inside goroutines without `sync.Map` or a mutex.
4. **Missing context propagation.** Look for HTTP/DB calls that use `context.Background()` instead of the request's `ctx`. Misses timeout and cancellation.
5. **Unbounded fan-out.** Look for `for ... range items { go ... }` without a `SetLimit` or token channel. Time bomb at scale.

If a PR review touches concurrency, run through this list before approving.

---

## Appendix Q: Glossary, extended

Beyond the basic glossary at the top of this file, here are more terms you will encounter in third-party pool documentation and in our `senior.md`.

| Term | Definition |
|------|------------|
| **Work-stealing** | A scheduler strategy where idle workers take tasks from busy workers' queues. Improves load balance. |
| **Park / unpark** | The act of putting a goroutine to sleep (park) or waking it (unpark). Pools' worker-loop logic involves this. |
| **Spinning worker** | A worker that loops checking for tasks without sleeping. Costs CPU but reduces wake-up latency. Used in some pool implementations briefly before parking. |
| **Lock-free queue** | A queue implementation that uses atomic operations instead of mutex. Higher throughput at high contention; harder to write correctly. |
| **MPSC, MPMC, SPSC** | Multi-producer-single-consumer / multi-producer-multi-consumer / single-producer-single-consumer. Queue topologies; matter for choosing the right pool implementation. |
| **False sharing** | Two goroutines writing to different variables that happen to share a CPU cache line, causing cache invalidation and slow performance. |
| **Backoff** | A policy for retrying or rescheduling under load. Linear, exponential, jittered. |
| **Jitter** | Random variation added to backoff to avoid synchronised retry storms. |
| **Throttle** | Slow the producer when the consumer is slow. Same idea as backpressure. |
| **Drop** | Discard a task when the queue is full. The opposite of block-on-submit. |
| **Reservoir / sampling** | When dropping under load, you may keep a "random sample" instead of dropping uniformly. Rare. |
| **Sharded pool** | A pool divided into N sub-pools, each with its own queue, to reduce lock contention. Common in high-perf libraries. |
| **Affinity** | Sticking a task to a specific worker (e.g., for state locality). Rare; mostly used in cache-hot CPU-bound work. |
| **Steal-on-empty** | When a worker's local queue is empty, steal from a peer's queue. The opposite of "block when empty." |
| **Wait-free** | A stronger property than lock-free: every operation completes in a bounded number of steps. |

You do not need to know these for junior level, but they appear in the literature and in pool source code. Coming back here as a reference is fine.

---

## Appendix R: Recap

Read this section before you close the file.

- **Default to `errgroup` with `SetLimit`.** Most workloads need nothing more.
- **Raw goroutines + WaitGroup** is right when the problem is bounded (small fixed N).
- **`semaphore.Weighted`** is right for unequal-weight tasks or cross-function bounding.
- **Third-party pools** are right for high spawn rate, worker reuse, or features not in the standard library.
- **Always measure.** A pool is a decision with cost; the benefit must be measurable.
- **Always have a "stop" story.** Every goroutine should have a clear way to end.
- **Always document K.** A bound with no rationale is a smell.
- **Always handle errors.** Don't `_ = pool.Submit(...)`; check the return.
- **Always release pools.** `defer pool.Release()` next to `NewPool`.
- **Refactor cargo-cult pools.** Removing a pool can be as valuable as adding one.

If you remember nothing else from this file, remember: **the default answer is errgroup.SetLimit, and the default question is "do I even need a bound?"**

---

## Appendix S: Five-minute write-ups for your team

Here are five short paragraphs you can lift verbatim into a design doc, an internal wiki page, or a Slack thread when these topics come up.

### Para 1 — "Why we don't use ants by default"

> We default to `errgroup.SetLimit` for bounded concurrent fan-out because it lives in the semi-standard `golang.org/x/sync` module, propagates errors, integrates with `context.Context`, and is one line away from any other code we have. Third-party pools (`ants`, `tunny`, `workerpool`) are reserved for cases where we have measured a specific benefit — high spawn rate, worker-state reuse, panic recovery requirements, or features like dynamic resize. We require a benchmark in the PR before introducing such a dependency.

### Para 2 — "Why we picked K=50 for the user-service fanout"

> The user-service handler fans out to two internal APIs. Both are documented to allow 50 concurrent requests per client. We set `errgroup.SetLimit(50)` on each fanout to match the documented limit, leaving zero headroom for cross-handler traffic. If we later observe 429s, we will add a per-process semaphore (`semaphore.NewWeighted(50)`) shared across handlers, since the 50-limit is per-process not per-handler. The current setting is conservative enough that we have not needed that yet.

### Para 3 — "Removing the ants pool from the orders service"

> We are removing the `ants` pool from `orders/processor.go`. The pool was added in 2023 without measurement; reviewing the profile today, the pool's submit lock shows up at ~3% of CPU and produces zero detectable benefit at our 200-RPS peak. We replace it with `errgroup.SetLimit(20)`, matching the DB's connection budget. The change is 18 lines removed, 6 added, no functional change. Benchmark in the PR.

### Para 4 — "When you should reach for tunny"

> Reach for `tunny` when each worker holds non-trivial state that is expensive to construct and reusable across tasks — for example, a compiled regex set, a PDF rendering engine, a hot DB connection, a warm protobuf descriptor cache. `tunny`'s API (worker per goroutine with `Process(payload)` returning a value) makes that pattern natural. For stateless or short-lived tasks, prefer `errgroup` or `ants`.

### Para 5 — "What we mean by 'bounded concurrency'"

> When we say a workload needs bounded concurrency, we mean: at any moment, at most K tasks are in flight, where K is chosen based on a *measurable* downstream resource (rate limit, connection budget, CPU cores, memory budget). We do not mean "bound the total number of goroutines ever spawned." We do not mean "limit goroutines because goroutines are scary." K should always come with a comment explaining what scarce thing it is rationing.

These paragraphs are meant as templates. Use them, edit them, ship them.

---

## Appendix T: Final exercise — explain it in 30 seconds

A coworker walks up to your desk and says: "I want to add `ants` to our service. We've been using `errgroup` and I think `ants` is more professional." You have 30 seconds to respond.

Possible response:

> "Cool. What's the workload? If it's fan-out per request with a few dozen tasks, `errgroup` is the right shape — adding `ants` just means a new dependency and more code. `ants` earns its place when we have very high spawn rate (>100k/sec), need worker-state reuse, or need a feature we don't have today like panic-handler or non-blocking submit with overflow drop. Do we have a benchmark showing `errgroup` is too slow? If so I'd love to see it. If not, let's measure first."

That response is calm, concrete, and asks for measurement rather than disagreeing on aesthetics. Internalise the shape.

---

## Appendix U: Beyond junior — what we will explore next

A preview of what's in the next files of this subsection.

### `middle.md`

- Errgroup vs pool: when one beats the other under specific shapes.
- Semaphore vs pool: the differences in fairness, weighting, and cross-function bounding.
- Choosing pool size: the math for I/O-bound and CPU-bound cases.
- Library tradeoffs: when ants beats tunny, when tunny beats ants, when workerpool wins over both.
- Real benchmarks. Numbers, not opinions.

### `senior.md`

- API ergonomics across libraries — what each one makes easy, what each one makes hard.
- Locking strategies: each library's internal queue and what it costs.
- Allocations per task — pprof data showing real allocation patterns.
- Scheduling fairness — what each library guarantees about task ordering.
- Memory footprint — bytes per worker, bytes per pending task, total at peak.

### `professional.md`

- Production decision criteria.
- SLAs and how they map to pool sizing.
- Backpressure design end-to-end.
- Observability: what to log, what to metric, what to alert on.
- Third-party risk: dependency audit, license, maintenance, transition.
- Build-your-own vs adopt: a cost-benefit framework.

### `specification.md`

- Cross-library API surface comparison.
- Feature matrix.
- Compatibility tables.

### `interview.md`

- 30+ Q&A on choosing the right pool, sizing it, justifying it.

### `tasks.md`

- 15-20 hands-on exercises.
- Benchmark all three libraries against errgroup.
- Build your own decision matrix for your service.
- Migrate a service from raw goroutines to a pool — measured.

### `find-bug.md`

- 10-12 snippets where the pool choice is the bug.

### `optimize.md`

- 8-10 scenarios where swapping libraries (or removing the pool) measurably wins.

That is the rest of the subsection. Each file is graduated; you can stop at the level that matches your current role. Most engineers will read junior and middle; senior engineers add senior and professional; staff engineers refer to all of them and to `specification.md` for argument settling.

---

## One last paragraph

You have read a long file about a small idea: *the default answer to "should I use a goroutine pool?" is no, but here is when yes.* Most of the world's Go services succeed without third-party pools. The ones that need them know why. The ones that don't know that too. Aim to be in either group, never in the cargo-cult middle.

Now go open one of the previous topics' code — `01-goroutines`, `02-channels` — and look at the concurrency you have already written. Ask yourself: did I make the right choice? Is there a pool I added that should be `errgroup`? Is there an `errgroup` that should be raw goroutines? Is there a function that needs a `ctx` argument and a `SetLimit`?

The answers, more often than you expect, lead to deletions.

---

## Appendix V: Reflection prompts

A few questions to ask yourself before closing this file. There are no "right" answers; the act of answering them is the value.

1. Look at the last three programs you have written in Go. In each, what was the concurrency strategy? Was it the right one for the workload?
2. In your current job's code, can you name the three places where bounded concurrency is most important? What primitive enforces the bound in each? Is the K chosen well?
3. If a junior on your team asked "should I use a goroutine pool here," what would you ask back?
4. When was the last time you removed a concurrency primitive (made the code more sequential or simpler)? When was the last time you added one? Which felt more like progress?
5. Have you ever caused an outage with unbounded concurrency? What did you change? Was it a tool change or a culture change?

These prompts surface the experience that lets you choose well next time.

---

## Appendix W: A quick critique of the way pools are often introduced

A common pattern in teams: someone hears about goroutine pools, drafts a "guidelines" doc, and the doc says "use a pool when fan-out is unbounded." The doc is then read by junior engineers who interpret it as "use a pool whenever you fan out." The result is over-pooling.

The fix is to rewrite the doc with the *primary* question first:

- Bad guideline: "Use a pool when fan-out exceeds K."
- Better guideline: "When fan-out exceeds K, use `errgroup.SetLimit(K)`. Use a third-party pool only with a measured reason."

The change is small in wording, big in practice. The team's default tool moves from "pool" to "errgroup." The dependency surface shrinks. The code reads better.

If you write internal guidelines, this is the shape to aim for.

---

## Appendix W2: Mini Q&A With Yourself

Before moving past junior, ask yourself:

- Am I confident I can write the URL-fetcher exercise in four ways without looking?
- Do I know what `errgroup.SetLimit(K)` blocks on?
- Do I know what happens if I forget `g.Wait()`?
- Do I know why `i := i` is in our examples?
- Could I explain "bounded concurrency" to someone who is new?
- Can I name two cases where raw goroutines are right?
- Can I name two cases where a pool is right?
- Have I read at least one third-party pool's README front to back?

If not all "yes," reread the relevant sections. The junior level isn't about speed; it's about confidence.

## Appendix W3: A few more code snippets to study

### Snippet 1: The minimum bounded fan-out

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(K)
for _, x := range xs {
	x := x
	g.Go(func() error { return work(ctx, x) })
}
return g.Wait()
```

Memorize this. It is the answer 80%+ of the time.

### Snippet 2: A token-channel bound (alternative)

```go
sem := make(chan struct{}, K)
var wg sync.WaitGroup
for _, x := range xs {
	x := x
	wg.Add(1)
	sem <- struct{}{}
	go func() {
		defer wg.Done()
		defer func() { <-sem }()
		work(x)
	}()
}
wg.Wait()
```

Older idiom. Use when errgroup isn't available.

### Snippet 3: A weighted semaphore

```go
sem := semaphore.NewWeighted(8 << 30)  // 8 GiB
var wg sync.WaitGroup
for _, t := range tasks {
	t := t
	wg.Add(1)
	go func() {
		defer wg.Done()
		w := t.Weight()
		if err := sem.Acquire(ctx, w); err != nil { return }
		defer sem.Release(w)
		work(t)
	}()
}
wg.Wait()
```

For unequal-weight tasks.

### Snippet 4: A persistent pool

```go
pool, _ := ants.NewPool(K)
defer pool.Release()

for msg := range msgs {
	msg := msg
	pool.Submit(func() { handle(msg) })
}
```

For high-rate fire-and-forget.

These four snippets cover ~90% of patterns. Internalize them.

## Appendix X: One more thing — concurrency is a means, not an end

The point of this whole subsection — the point of the goroutine-pools topic, the concurrency topic, even much of the Go ecosystem — is that concurrency is a tool to achieve *throughput, latency, or resource control*. It is not a goal in itself.

A program that does the right thing sequentially is better than one that does the wrong thing concurrently. A program that does the right thing with a 10-line errgroup is better than one that does the same thing with a 200-line custom pool. The simplest code that meets the requirements wins.

Pools, errgroups, semaphores — all of them are means to the goal of "the service serves users well." If a pool moves you toward that goal, use it. If it does not, do not.

You will spend the rest of your Go career making this judgement, in PR after PR. The framework in this file is the starting point. The benchmark in `tasks.md` is the evidence. The anti-patterns in `find-bug.md` are the warnings. The simplifications in `optimize.md` are the rewards.

Welcome to the long slow work of writing good concurrent Go.

End of `junior.md`.






