---
layout: default
title: Steady-State — Junior
parent: Steady-State
grand_parent: Production Patterns
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/06-steady-state/junior/
---

# Steady-State — Junior

[← Back](../)

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [What is steady-state?](#what-is-steady-state)
5. [The two graphs that explain everything](#the-two-graphs-that-explain-everything)
6. [Real-world analogies](#real-world-analogies)
7. [Mental models](#mental-models)
8. [The simplest steady-state example](#the-simplest-steady-state-example)
9. [Bounded versus unbounded channels](#bounded-versus-unbounded-channels)
10. [`GOMEMLIMIT` — your first runtime knob](#gomemlimit--your-first-runtime-knob)
11. [Reading goroutine and memory in pprof](#reading-goroutine-and-memory-in-pprof)
12. [Goroutine count as a health signal](#goroutine-count-as-a-health-signal)
13. [File descriptors — the resource you forget about](#file-descriptors--the-resource-you-forget-about)
14. [A first checklist](#a-first-checklist)
15. [Common mistakes](#common-mistakes)
16. [Common misconceptions](#common-misconceptions)
17. [Self-assessment](#self-assessment)
18. [Cheat sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What you can build](#what-you-can-build)
21. [Further reading](#further-reading)

---

## Introduction

> Focus: "What does it mean for a service to be 'in steady-state'? How is that different from 'it works'?"

Imagine you write a Go program that handles HTTP requests. You run it on your laptop, fire a thousand requests at it, and it answers them correctly. The unit tests pass. The load test you ran for sixty seconds passes. You ship it to production.

Three days later, somebody on the on-call rotation gets a page: the service has been killed by the operating system for using too much memory. You re-read your code. You can't see the bug. The code that runs in a minute on your laptop is the same code that crashed after three days in production.

This is the most common, most expensive, and least understood failure mode of long-running Go services: a **slow leak**. The code works. It serves requests. It passes every short-duration test. But over hours or days, something inside it grows — memory, goroutines, file descriptors, queue depth — until the operating system or the runtime gives up.

The cure is to engineer for **steady-state**: the property that, after the service has been running for a while, the size of its internal state does not change. Not "stays small" — it might be a megabyte or a gigabyte, depending on the service. But it stops growing. The graph of memory over time goes flat. The graph of goroutine count over time goes flat. The graph of open file descriptors goes flat. You can leave the service running for a week and come back to find it looking the same as it did an hour after startup.

After reading this file you will:

- Be able to define steady-state in concrete terms.
- See the difference between a service in steady-state and a service that is slowly drifting.
- Write your first bounded worker pool with a fixed goroutine count.
- Set `GOMEMLIMIT` and understand what it does.
- Read a heap snapshot and a goroutine list.
- Know which numbers to watch on a dashboard.

You do not need to know about `runtime/metrics`, multi-tenant isolation, or chaos engineering yet. Those live on the middle, senior, and professional pages. This file is the foundation.

---

## Prerequisites

- **Required:** Go 1.19 or newer. Run `go version` to check. (Why 1.19? It is the first version with `GOMEMLIMIT`, which we use below.)
- **Required:** Comfort with goroutines and channels at the basic level. You should know what `go f()` does and how to send and receive on a channel.
- **Required:** Awareness of `context.Context`. You do not have to know every method; knowing that a context can be cancelled is enough.
- **Helpful:** Familiarity with `sync.WaitGroup`. We will use it in a few examples.
- **Helpful:** Some basic exposure to `net/http`. The examples will run as small HTTP servers.

If you can write a program that spawns three goroutines and waits for them with a `WaitGroup`, you are ready to go.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Steady-state** | The condition of a long-running service where its internal resources (memory, goroutines, FDs, queue depth) are bounded and do not grow over time. |
| **Leak** | Any resource that is allocated but never released, causing monotonic growth. |
| **Slow leak** | A leak whose rate is small enough to go undetected in short tests but compounding enough to cause failure in production. |
| **Bounded channel** | A channel created with `make(chan T, n)` for a fixed `n`. The buffer has a hard cap. |
| **Unbounded channel** | A channel with a buffer so large it is effectively unlimited; or a buffer that the application code does not control. |
| **Shed-on-full** | A policy where new work is dropped (returning an error) when a queue is full. |
| **Block-on-full** | A policy where the producer blocks when a queue is full, exerting back-pressure on the upstream. |
| **`GOMEMLIMIT`** | A soft memory cap (Go 1.19+). The runtime tries to keep memory at or below this value by triggering GC more often. |
| **`GOGC`** | The GC trigger ratio. `100` means GC runs when the heap has doubled since the last cycle. |
| **`runtime.NumGoroutine`** | A function that returns the current number of goroutines in the process. |
| **pprof** | The Go profiling tool. Lets you inspect heap, goroutines, allocations, and more. |
| **File descriptor (FD)** | An integer handle the OS uses to track an open file, socket, or pipe. Each process has a limit. |
| **`RLIMIT_NOFILE`** | The Linux per-process file-descriptor limit. Default is usually 1024 or 4096. |
| **Resident set size (RSS)** | The amount of physical memory the OS has assigned to your process. |
| **Drift** | A slow, monotonic change in a metric — the early sign of a steady-state violation. |
| **Leak budget** | A small, deliberate, bounded growth rate that the team accepts (e.g., 10 MB/day) because deploys happen often enough to reset it. |

---

## What is steady-state?

Let's be concrete. A Go service has many internal resources:

- Memory the runtime has allocated for the heap.
- Stacks for each goroutine.
- Open files and sockets.
- Items sitting in channels waiting to be processed.
- Entries in maps.
- Connections in a database pool.

For each of these, you can plot a graph over time. The x-axis is wall-clock time; the y-axis is the size of the resource. Examples:

- "Heap size at the end of each GC cycle."
- "Number of goroutines."
- "Number of open file descriptors."
- "Number of items waiting in the channel `jobs`."

A service is in **steady-state** when, after an initial warm-up period (a few seconds to a few minutes), each of these graphs is *flat*. There is daily variation, hourly variation, even per-second variation. But over any window of one hour or more, the trend is zero.

A service is **drifting** when one or more of these graphs has a positive slope. The slope might be small — a megabyte per hour, one goroutine per minute — but the slope is not zero. Eventually some limit is reached, and the service fails.

The reason steady-state matters is **time**. A short test, even one that runs at full load for a minute, cannot tell you whether your service is in steady-state. A megabyte per hour of drift is invisible in a one-minute test. It is fatal over three days.

---

## The two graphs that explain everything

Picture two graphs side by side.

**Left: a service in steady-state.**

```
heap size
   ^
   |    /\        /\         /\          /\
   |   /  \  /\  /  \  /\   /  \   /\  /  \
   |  /    \/  \/    \/ \  /    \ /  \/    \
   | /                   \/      V          \
   +---------------------------------------> time
```

The heap rises and falls between GC cycles. Each peak is roughly the same height. Each valley is roughly the same height. The *average* over a long window is constant.

**Right: a service drifting.**

```
heap size
   ^                              /\
   |                       /\    /  \
   |                /\    /  \  /    \
   |          /\   /  \  /    \/      \
   |    /\   /  \ /    \/
   | /\/  \ /    V
   +---------------------------------------> time
```

Each peak is a little higher than the last. Each valley is a little higher than the last. Over a long window, the *average* is climbing.

The right graph is the silent killer. Looking at any one-hour window, you might mistake it for noise. Only by zooming out — looking at twenty-four hours, or a week — do you see the trend.

This is why dashboards in production always show multiple time scales: one hour, twenty-four hours, seven days. The shape of the curve on the seven-day chart is what tells you whether the service is in steady-state.

---

## Real-world analogies

### The bathtub

Water comes into a bathtub through the tap; water leaves through the drain. The bathtub is in steady-state when the inflow rate equals the outflow rate. If the drain is partially blocked, the water level rises slowly. At first it's just centimeters of difference, then it's overflowing.

A Go service is the bathtub. Requests are the inflow. Completed work is the outflow. The water level is queue depth (and, indirectly, memory).

### The car battery

A car's battery is charged by the alternator and discharged by the electronics. Driving the car is steady-state: alternator output equals electronic load, the battery stays at twelve and a half volts. Leaving a light on while the engine is off is drift: the battery discharges at a slow rate, and after several hours it is dead.

A Go service that leaks memory while idle is the car with a light left on. Nothing exciting is happening, but a slow process is using up a finite resource.

### The room with the open window

A heated room is in steady-state when the heater output equals the heat loss through the walls and the window. Open the window wider, and the room cools. Close it, and the room warms.

A Go service is the room. Goroutines opening connections that they don't close is the open window. Even a small amount of heat loss, over many hours, requires either more heat (more CPU) or accepts a cooler room (more latency).

---

## Mental models

### "Per-request resources must die with the request"

The single most important mental model. Every goroutine, channel, slice, map entry, file handle, and connection that a request creates must be freed before the request returns. If it isn't, the resource is now a leak.

The mechanism is not magical: `defer`, `context.WithCancel`, `sync.WaitGroup`, and pool semantics give you the tools. The discipline is: at every `go func`, ask "who closes this?" At every `Open`, ask "who closes this?" At every `Acquire`, ask "who Releases?"

### "Long-lived resources have explicit lifetimes"

The exception to the previous rule. Some resources are not per-request: a connection pool, a cache, a metrics exporter goroutine. These have lifetimes tied to the process, not the request. For these, the discipline is: name the lifetime, and document who controls it.

A pool that lives for the lifetime of the process is fine, as long as the process eventually exits. A "cache" that lives for the lifetime of the process and grows without bound is a leak in disguise.

### "Steady-state is a discipline, not an outcome"

You do not arrive at steady-state by accident. You engineer it: by bounding queues, capping goroutines, expiring cache entries, releasing connections. A service that "happens to" be in steady-state is a service whose author was lucky. A service that is *designed* to be in steady-state is a service that will still be in steady-state next month.

---

## The simplest steady-state example

A worker that consumes from a channel, with a fixed number of workers and a bounded queue.

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

// Pool is a small worker pool with a bounded queue.
// It is the simplest example of a steady-state component.
type Pool struct {
    jobs chan func()
    wg   sync.WaitGroup
}

// NewPool spawns `workers` goroutines that read from a queue of
// capacity `queueSize`. Both numbers are fixed for the lifetime
// of the pool, which is the foundation of steady-state.
func NewPool(workers, queueSize int) *Pool {
    p := &Pool{
        jobs: make(chan func(), queueSize),
    }
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go p.worker()
    }
    return p
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for job := range p.jobs {
        job()
    }
}

// Submit tries to enqueue a job. If the queue is full, the call
// blocks until a worker pulls a job (or the context expires).
func (p *Pool) Submit(ctx context.Context, job func()) error {
    select {
    case p.jobs <- job:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

// Stop closes the queue and waits for in-flight jobs to finish.
func (p *Pool) Stop() {
    close(p.jobs)
    p.wg.Wait()
}

func main() {
    p := NewPool(4, 8)
    defer p.Stop()

    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    for i := 0; i < 20; i++ {
        i := i
        if err := p.Submit(ctx, func() {
            time.Sleep(100 * time.Millisecond)
            fmt.Printf("job %d done\n", i)
        }); err != nil {
            fmt.Println("submit failed:", err)
        }
    }
}
```

### Why this is in steady-state

- **Bounded goroutine count.** Exactly four workers, no matter how many jobs are submitted. The number of goroutines is fixed.
- **Bounded queue.** Eight slots, no more. If we submit faster than the workers can drain, the Submit call blocks; we cannot push memory into an unbounded buffer.
- **Bounded memory per job.** Each job holds a `func()` closure. The closures are released as soon as the job completes.

### What would break steady-state

- Changing `make(chan func(), 8)` to `make(chan func(), 1<<20)`. Now a burst could push a million closures into the buffer.
- Calling `go worker()` from inside `Submit`. Now goroutine count grows with traffic.
- Storing each job's result in a global slice that never shrinks.

We will explore each of these failure modes in middle and senior. For now, internalise the recipe: a fixed pool of workers reading from a bounded queue.

---

## Bounded versus unbounded channels

In Go, `make(chan T)` creates an unbuffered channel; `make(chan T, n)` creates a buffered channel with capacity `n`. The choice of `n` is one of the most important decisions you make.

### Unbuffered

The sender blocks until a receiver is ready. The receiver blocks until a sender is ready. No item ever sits in the channel — they are handed off directly. This is the strictest form of bounding.

```go
ch := make(chan Job) // capacity 0
```

Use when you want producer and consumer to run in lockstep, or when you cannot tolerate any in-flight queueing.

### Buffered with small capacity

```go
ch := make(chan Job, 8) // capacity 8
```

The buffer absorbs short bursts. As long as the consumer's average rate is greater than the producer's average rate, the buffer fluctuates around a small steady-state value.

This is the right choice for most worker pools. Set the capacity to a small multiple of the number of workers (often `2 * workers` or `4 * workers`).

### Buffered with large capacity

```go
ch := make(chan Job, 1000000) // capacity 1 million
```

This is almost always a bug. The capacity is large enough to mask a producer-consumer rate mismatch. Under sustained overload, the buffer fills with a million items, each holding references to whatever the job carries. The heap grows linearly with the queue depth.

If you find yourself reaching for a million-element buffer, the right answer is usually:

- Make the capacity smaller, and add a shedding policy.
- Add a real, persistent queue (Kafka, NATS, RabbitMQ) outside the process.
- Re-examine the workload — do you really need to absorb a million items?

### Shed-on-full

When the queue is full and the producer should not wait, use a `select` with a `default`:

```go
select {
case ch <- job:
    // accepted
default:
    // rejected, return an error or increment a "dropped" counter
}
```

This implements shed-on-full in two lines. The producer is never blocked, and the queue is never overfilled.

### Block-on-full with context

When the queue is full and the producer can wait — but only up to the context's deadline — use a `select` with `ctx.Done()`:

```go
select {
case ch <- job:
    return nil
case <-ctx.Done():
    return ctx.Err()
}
```

The producer waits for a slot, but if the deadline expires first, the request fails fast. This is the right pattern for synchronous RPC handlers.

---

## `GOMEMLIMIT` — your first runtime knob

`GOMEMLIMIT` is the most important environment variable in production Go. It tells the runtime: "try to keep total memory usage at or below this limit. Run GC more often as you get closer to it." It was introduced in Go 1.19.

### Setting it

Two ways:

```bash
# As an environment variable
GOMEMLIMIT=2GiB ./myservice
```

```go
// In code
import "runtime/debug"
debug.SetMemoryLimit(2 * 1024 * 1024 * 1024) // 2 GiB
```

### What it does

When the runtime estimates that total memory usage is approaching the limit, it does three things:

1. Triggers GC more frequently.
2. Returns memory to the operating system more aggressively.
3. Continues to allow allocations — the limit is **soft**.

The third point is critical. `GOMEMLIMIT` does *not* return an error from `make([]byte, N)`. It does not block. It just makes GC try harder. If your application allocates faster than GC can free, the limit is exceeded, and (eventually) the operating system will OOM-kill the process.

### Why "soft"

A hard cap would be very fragile. Imagine a Go program that just barely exceeds a hard cap on a transient allocation — the runtime would have to either panic or refuse the allocation, both of which are catastrophic. The soft limit is a target. The runtime trades CPU for memory as it approaches the target, and only if the application's allocation rate exceeds GC's ability to keep up does memory actually grow past the target.

### How to choose a value

A simple rule: set `GOMEMLIMIT` to about ninety percent of your container's hard memory limit. If your container has 4 GiB, set `GOMEMLIMIT=3.6GiB`. The ten-percent headroom absorbs goroutine stacks, cgo allocations, and the runtime's bookkeeping that aren't counted in the limit.

```bash
GOMEMLIMIT=3686MiB ./myservice
```

If you don't run in a container, set it to about eighty percent of the system's free memory. (Or, more conservatively, set it to the largest value you have ever observed your service using during a normal day.)

### What happens without it

Without `GOMEMLIMIT`, the runtime only uses `GOGC` (the heap-doubling ratio, default 100) to decide when to GC. Under a memory-tight workload, this can let the heap grow until the OS OOM-kills the process — before the runtime's GC has a chance to reclaim memory. `GOMEMLIMIT` is the safety net that catches this case.

### When to set `GOMEMLIMIT` to off

In a batch job that intentionally uses all available memory. In a unit test. Never in a long-running service.

---

## Reading goroutine and memory in pprof

The `net/http/pprof` package exposes profiles via HTTP. Add this to your service:

```go
import (
    "net/http"
    _ "net/http/pprof"
)

func init() {
    go func() {
        // Localhost-only, never expose to the internet.
        http.ListenAndServe("127.0.0.1:6060", nil)
    }()
}
```

Now you can browse:

- `http://127.0.0.1:6060/debug/pprof/heap` — heap snapshot.
- `http://127.0.0.1:6060/debug/pprof/goroutine?debug=2` — full goroutine stacks.
- `http://127.0.0.1:6060/debug/pprof/allocs` — cumulative allocations.

### Inspecting goroutines

```bash
curl 'http://127.0.0.1:6060/debug/pprof/goroutine?debug=1'
```

You get a count by stack:

```
goroutine profile: total 47
20 @ 0x42c3a5 0x42c44e ...
   #   0x123ab    main.(*Pool).worker+0x123    /app/pool.go:42
10 @ 0x42c3a5 0x42c44e ...
   #   0x456cd    net/http.(*conn).serve+0x456 ...
```

This is the most useful diagnostic for a goroutine leak. If you see "10000 @ ... main.handler" you know that ten thousand goroutines are stuck in `main.handler`. They should not be there.

### Inspecting the heap

```bash
go tool pprof http://127.0.0.1:6060/debug/pprof/heap
(pprof) top
(pprof) list YourFunctionName
```

You see, in descending order, the functions that have allocated the most live memory. The top consumer in a healthy service is usually a buffer pool or a cache; in a leaking service, it is whatever is leaking.

To detect a leak, take two snapshots thirty minutes apart:

```bash
curl -s http://127.0.0.1:6060/debug/pprof/heap > snap1.pb.gz
sleep 1800
curl -s http://127.0.0.1:6060/debug/pprof/heap > snap2.pb.gz
go tool pprof -base snap1.pb.gz snap2.pb.gz
(pprof) top
```

The diff shows what *grew* between the two snapshots. Anything growing is suspicious.

---

## Goroutine count as a health signal

`runtime.NumGoroutine()` returns the current number of goroutines. Track it.

```go
func emitGoroutineCount(ctx context.Context) {
    t := time.NewTicker(15 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            fmt.Println("goroutines:", runtime.NumGoroutine())
        }
    }
}
```

In a healthy service, the count rises during traffic spikes and returns to a baseline. In an unhealthy service, the count rises and stays high. The slope, not the absolute number, is the signal.

A typical service has:

- 1 main goroutine.
- 1 or 2 runtime goroutines (GC sweep, finalizer).
- N goroutines per `http.Server` (one per connection).
- N goroutines per worker pool.
- 1 or 2 per metrics emitter, log writer, pprof server.

A service that is "supposed to have around fifty goroutines" but has ten thousand has a leak. The next step is the goroutine profile.

---

## File descriptors — the resource you forget about

Every open file, socket, and pipe consumes one file descriptor. Linux limits the number per process; the default is often 1024 or 4096. When you hit the limit, you get `too many open files` errors that look unrelated to the actual cause.

Check the limit:

```bash
cat /proc/$(pidof myservice)/limits | grep "Max open files"
```

Check the current count:

```bash
ls /proc/$(pidof myservice)/fd | wc -l
```

In a healthy service this number plateaus. In an unhealthy service it rises monotonically.

### Common FD leaks

- HTTP response bodies that are not `Close()`d.
- File handles that are not `defer f.Close()`d on every path.
- Subprocesses whose pipes are not drained.
- Database connections that are not returned to the pool (i.e., `rows.Close()` not called).
- Tickers and timers that are not `Stop()`ped.

The pattern: every `Open`/`Acquire` paired with a `defer Close()`/`Release()`.

```go
f, err := os.Open(path)
if err != nil {
    return err
}
defer f.Close()
```

```go
resp, err := http.Get(url)
if err != nil {
    return err
}
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()
```

```go
rows, err := db.Query(...)
if err != nil {
    return err
}
defer rows.Close()
```

The `io.Copy(io.Discard, resp.Body)` may look strange. It is *required*. If you do not drain the body, the underlying connection cannot return to the keep-alive pool; the next request opens a new TCP connection, and the FD count rises.

---

## A first checklist

When you write a Go service that needs to run for more than a few hours, run through this list before deploying:

1. Every channel has a fixed capacity, and the producer either sheds or blocks on full.
2. Every goroutine has a clear exit condition (a context, a closed channel, a `WaitGroup`).
3. Every `Open`, `Acquire`, `Connect` is followed by a `defer Close`/`Release`.
4. `GOMEMLIMIT` is set, either as an environment variable or via `debug.SetMemoryLimit`.
5. `net/http/pprof` is enabled on a localhost-only port.
6. The service exports its goroutine count to a dashboard.
7. The service exports its open FD count to a dashboard.
8. There is no `go func()` that runs without bound — every goroutine is part of a fixed pool, or attached to a finite scope.
9. No `make(chan T, N)` where `N` is greater than a few hundred — if you need more, use an external queue.
10. No map is used as a cache without expiry or size bound.

If any item on this checklist is unchecked, your service has a candidate steady-state bug. Each item maps to a real failure mode that we will explore in middle and senior.

---

## Common mistakes

### Spawning a goroutine per request

```go
func handle(w http.ResponseWriter, r *http.Request) {
    go publishEvent(r.Body)  // BUG
    w.WriteHeader(202)
}
```

Goroutine count grows with traffic. Under burst, you have ten thousand goroutines, each holding a request body. Replace with a worker pool.

### Unbounded channel buffer

```go
events := make(chan Event, 1 << 30)  // BUG
```

Effectively unbounded. The buffer fills under sustained overload and the heap explodes. Use a small capacity and a shedding policy.

### Forgetting to close the response body

```go
resp, _ := http.Get(url)
defer resp.Body.Close()  // not enough!
io.ReadAll(resp.Body)
```

If you do not also drain the body when you do not care about it, the connection cannot return to the pool. Use:

```go
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()
```

### `time.After` in a loop

```go
for {
    select {
    case e := <-events:
        handle(e)
    case <-time.After(5 * time.Second):
        // heartbeat
    }
}
```

Each iteration creates a new timer that lives until either it fires or the runtime collects it. Under high `events` traffic, hundreds of unfired timers per second accumulate. Hoist the timer outside the loop.

### Map as cache, no expiry

```go
var cache = make(map[string][]byte)

func set(k string, v []byte) {
    cache[k] = v
}
```

Memory grows monotonically with the number of distinct keys. Use a bounded LRU.

---

## Common misconceptions

### "I run the GC manually, so I don't leak memory."

`runtime.GC()` collects unreferenced memory. If your code is still referencing the memory (in a map, a slice, a goroutine), the GC cannot free it. A leak is a referencing bug, not a GC bug.

### "Goroutines are cheap, so spawning lots of them is fine."

Goroutines are cheap to create (a few kilobytes of stack each). But they are not free, and the goroutine scheduler's quality degrades at very high counts. More importantly, each goroutine usually holds *other* state — closures, channels, locks — that is not free.

### "I don't need `GOMEMLIMIT`; my service doesn't use much memory."

`GOMEMLIMIT` is cheap insurance. Setting it costs nothing in steady-state. It only does anything when you are near the limit, in which case its behaviour is what you wanted anyway.

### "If my unit tests pass, the service is correct."

Unit tests run for milliseconds. Steady-state bugs surface after hours or days. The two have almost nothing in common.

### "Steady-state is something you only worry about at scale."

A single-pod service that runs for a month is also a long-running service. The clock does not care how many instances you have.

---

## Self-assessment

If you can answer these, you have absorbed the junior material:

1. What is steady-state? Give two examples of resources whose graph should be flat over time.
2. Why is a buffer of one million dangerous?
3. What does `GOMEMLIMIT=2GiB` do, in plain English?
4. How do you take two heap snapshots thirty minutes apart and diff them?
5. Which command counts open file descriptors for a running process?
6. What is the canonical "drain the body" pattern, and why is it required?
7. Name three things that need a paired `Close` or `Release`.
8. What does `runtime.NumGoroutine()` tell you, and what does a positive slope on its graph mean?

---

## Cheat sheet

```go
// Bounded worker pool
jobs := make(chan func(), 8)         // small capacity
for i := 0; i < 4; i++ {              // fixed workers
    go func() {
        for j := range jobs {
            j()
        }
    }()
}

// Shed-on-full
select {
case jobs <- job:
default:
    // dropped
}

// Block-on-full with deadline
select {
case jobs <- job:
case <-ctx.Done():
    return ctx.Err()
}

// GOMEMLIMIT at startup
debug.SetMemoryLimit(int64(0.9 * float64(cgroupLimit)))

// pprof, localhost-only
go http.ListenAndServe("127.0.0.1:6060", nil)

// Drain HTTP body
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()

// Goroutine count
fmt.Println("goroutines:", runtime.NumGoroutine())

// FD count (Linux)
files, _ := os.ReadDir("/proc/self/fd")
fmt.Println("FDs:", len(files))
```

---

## Summary

Steady-state is the property of a long-running service whose internal resources are bounded over time. It is engineered, not assumed, through three habits:

1. **Bound every queue.** Pick a capacity. Shed or block on full.
2. **Cap every goroutine.** A fixed worker pool, not per-request `go func()`.
3. **Pair every `Open` with a `Close`.** Files, sockets, response bodies, rows.

Set `GOMEMLIMIT` as a safety net. Watch goroutine count and FD count on a dashboard. Take heap snapshots if you suspect a leak. Diff them.

If you do these four things, you will avoid almost every junior-level steady-state failure. The middle, senior, and professional pages take you deeper — per-tenant isolation, GC tuning, chaos harnesses, war stories — but the foundation is here.

---

## What you can build

After reading this page, you should be able to:

- Write a bounded worker pool that processes a stream of jobs without growing.
- Add `GOMEMLIMIT` and pprof to any service you write.
- Read a heap snapshot and identify the top allocator.
- Identify a goroutine leak from a single profile.
- Pair every resource acquire with a release.

These are the skills that prevent ninety percent of production steady-state incidents. The other ten percent, more subtle, are for the middle and senior pages.

---

## Further reading

- The `runtime/debug` package documentation, especially `SetMemoryLimit` and `SetGCPercent`.
- The Go blog post "Go runtime: 4 years later" for the rationale behind `GOMEMLIMIT`.
- `pprof` interactive guide: `go tool pprof -help`.
- The middle page of this section, which builds on these foundations with bounded queues, per-tenant semaphores, and connection-pool tuning.
- The "Find the Bug" page in this section — a great way to test what you just learned.

---

## Walkthrough — a leak you can reproduce locally

Reading about leaks is not the same as fixing one. Let's create a minimal leak, observe it, diagnose it, and fix it. This walkthrough takes about twenty minutes.

### The leaking program

```go
package main

import (
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "runtime"
    "time"
)

var stash [][]byte

func handler(w http.ResponseWriter, r *http.Request) {
    // BUG: we keep a reference to every request body forever.
    b := make([]byte, 100*1024) // 100 KB per request
    stash = append(stash, b)
    fmt.Fprintln(w, "ok")
}

func main() {
    go func() {
        http.ListenAndServe("127.0.0.1:6060", nil)
    }()
    http.HandleFunc("/", handler)
    go reporter()
    http.ListenAndServe(":8080", nil)
}

func reporter() {
    t := time.NewTicker(5 * time.Second)
    defer t.Stop()
    var m runtime.MemStats
    for range t.C {
        runtime.ReadMemStats(&m)
        fmt.Printf("goroutines=%d heap=%d KiB\n",
            runtime.NumGoroutine(), m.HeapInuse/1024)
    }
}
```

Run it:

```bash
go run leak.go
```

In another terminal, send traffic:

```bash
while true; do curl -s http://localhost:8080/ > /dev/null; done
```

### Observing the leak

In the original terminal, the reporter prints:

```
goroutines=8 heap=4096 KiB
goroutines=8 heap=12288 KiB
goroutines=8 heap=20480 KiB
goroutines=8 heap=28672 KiB
...
```

Heap is climbing about eight megabytes every five seconds. Goroutines are stable. That fingerprint says: not a goroutine leak, a heap leak.

### Diagnosing with pprof

Take a heap snapshot:

```bash
curl -s http://localhost:6060/debug/pprof/heap > snap1.pb.gz
```

Wait thirty seconds. Take another:

```bash
sleep 30
curl -s http://localhost:6060/debug/pprof/heap > snap2.pb.gz
```

Compare:

```bash
go tool pprof -base snap1.pb.gz snap2.pb.gz
(pprof) top
```

The output names `main.handler` as the top growing function:

```
Showing nodes accounting for 25.32MB, 100% of 25.32MB total
      flat  flat%   sum%        cum   cum%
   25.32MB   100%   100%    25.32MB   100%  main.handler
```

```bash
(pprof) list handler
```

```
Total: 25.32MB
ROUTINE ======================== main.handler in /tmp/leak.go
      ...
         .          .     14:    b := make([]byte, 100*1024)
         .   25.32MB     15:    stash = append(stash, b)
```

The leak is on line 15. The `append` to the global slice. Each request adds 100 KB; nothing ever removes it.

### Fixing the leak

```go
// Remove the global stash. Each request's allocation is now
// freed when the request returns.
func handler(w http.ResponseWriter, r *http.Request) {
    b := make([]byte, 100*1024)
    _ = b
    fmt.Fprintln(w, "ok")
}
```

Re-run the program. The reporter now prints:

```
goroutines=8 heap=4096 KiB
goroutines=8 heap=4352 KiB
goroutines=8 heap=4280 KiB
goroutines=8 heap=4416 KiB
...
```

Heap is bouncing in a narrow range; not climbing. Steady-state restored.

### Lessons from the walkthrough

- The signal of a leak is the slope of the heap graph, not the absolute size.
- Two snapshots plus `-base` localises the leak to a function and a line.
- The fix is almost always "stop accumulating something." Find the accumulation, remove it.

---

## Pros and cons of steady-state engineering

### Pros

- Production stability. Services run for weeks without incident.
- Lower on-call burden. Steady-state alerts are rare and meaningful.
- Smaller blast radius. Per-shard isolation means one tenant's pathology does not consume the whole service.
- Cheaper hosting. A service that uses bounded resources can run on smaller instances.
- Easier debugging. When something goes wrong, the dashboards point at the deviation.

### Cons

- More upfront design effort. Every queue, pool, and cache needs a bound; every bound needs a metric; every metric needs an alert.
- More boilerplate per service. The "first hundred lines" of a steady-state service include `GOMEMLIMIT`, pool sizing, pprof, and graceful shutdown.
- Harder to debug behaviour at the edges. Shedding under overload is correct, but a request that was shed leaves no trace.

### When the cost is wrong

Not every service needs full steady-state engineering. A batch job that runs for ten minutes once a day does not. A side-project demo does not. The cost-benefit only pays off for services that:

- Run for at least an hour at a time.
- Handle requests from anyone other than yourself.
- Have an SLO that matters to a stakeholder.

If a service does not meet these, the cost of bounding everything is wasted. Engineer for the audience.

---

## Use cases

Steady-state engineering shows up in every long-running Go service:

- **API servers.** Bounded request queues, capped goroutines, sized connection pools.
- **Message-queue consumers.** Worker pools with backpressure, leak-budgeted memory.
- **Background workers.** Tickers with stop, bounded scheduling, idle-time-aware work.
- **Caches and lookup services.** Bounded LRUs, TTL eviction, sized backing connections.
- **Streaming pipelines.** Per-stage queue depth, bounded buffer reuse, deterministic shutdown.
- **Gateways and proxies.** Per-tenant isolation, bounded retry buffers, connection-pool tuning.

The principles are the same; the application differs. The middle page covers each of these in more concrete detail.

---

## Coding patterns

### Pattern: drain on return

```go
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()
```

Pair every body read with a drain-and-close. This is the idiom that prevents the most common FD leak.

### Pattern: bounded queue with shed

```go
func submit(ch chan<- Job, j Job) error {
    select {
    case ch <- j:
        return nil
    default:
        return ErrShed
    }
}
```

A two-line shed-on-full. The producer never blocks; an error is returned and counted.

### Pattern: worker pool with WaitGroup

```go
type Pool struct {
    jobs chan func()
    wg   sync.WaitGroup
}

func NewPool(n int) *Pool {
    p := &Pool{jobs: make(chan func(), n*2)}
    for i := 0; i < n; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for j := range p.jobs {
                j()
            }
        }()
    }
    return p
}

func (p *Pool) Stop() {
    close(p.jobs)
    p.wg.Wait()
}
```

Fixed N workers, queue twice as deep as worker count. Close on stop, WaitGroup waits for in-flight.

### Pattern: ticker with stop

```go
t := time.NewTicker(d)
defer t.Stop()
for {
    select {
    case <-t.C: do()
    case <-ctx.Done(): return
    }
}
```

Always `defer t.Stop()`. Always pair with a `ctx.Done` branch.

### Pattern: deferred close on multi-step open

```go
func openAll(paths []string) (files []*os.File, err error) {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            for _, prev := range files {
                prev.Close()
            }
            return nil, err
        }
        files = append(files, f)
    }
    return files, nil
}
```

If you open multiple files and one fails, close the ones you opened. Otherwise an error path leaks FDs.

---

## Clean code

A few habits that make steady-state code easier to maintain:

- Name your bounded resources. `requestQueue`, not `ch`. `dbPool`, not `db`.
- Group resource initialisation in one place. The first hundred lines of `main` should configure pools, queues, semaphores. Anything else is harder to audit.
- Wrap third-party clients. A custom struct with explicit Close and metrics makes resource lifecycle obvious. Bare third-party clients hide it.
- Document each pool's size, with a comment explaining the reasoning. Future engineers need to know whether to raise or lower it.

```go
// dbPool is sized at 25 connections per pod. Database max_connections
// is 200, fleet maximum is 8 pods; 25*8 = 200 leaves zero margin for
// other clients, so we size at 80% of the fair share: 20 per pod.
db.SetMaxOpenConns(20)
```

---

## Product use / feature

Steady-state is invisible to users when working correctly. The product-level features it enables:

- **Reliable deploys.** Rolling deploys do not introduce latency spikes (because new pods reach steady-state quickly).
- **Predictable on-call.** The product team can plan releases without fearing the 3 a.m. page.
- **Honest SLOs.** A service whose steady-state is real can promise an SLO and meet it; a service that drifts always misses the SLO on the day the drift catches up.

These are quiet wins. The product manager rarely thanks anyone for steady-state engineering; they thank teams for "stable platform." Same thing, different framing.

---

## Error handling

Steady-state failures often look like normal errors at first. The signs:

- Errors are *correlated with time-since-deploy*, not with input.
- Errors are *correlated with each other*: connection pool errors and FD-exhaustion errors come in pairs.
- Errors fade after a restart but return.

If you see this pattern, suspect steady-state drift, not a logic bug. The fix is not in the error path; it is in the resource lifecycle.

When designing error handling, always include:

- A counter for each error type, by category (timeout, dial-failed, pool-exhausted, queue-full).
- A log that includes the queue depth, goroutine count, or pool stats at the time of the error.
- A correlation ID so multiple errors from the same request can be linked.

Without these, debugging a steady-state failure is guessing.

---

## Security considerations

Resource budgets are part of your security posture. An attacker who can:

- Open more connections than your `MaxOpenConns` allows can deny service to other clients.
- Submit requests faster than your queue drains can fill the buffer.
- Hold connections open by sending slowly (slowloris) can saturate `MaxConnsPerHost`.
- Send oversized payloads can blow your memory budget.

Every resource bound is also a defence. Implementing rate limiting, body size limits, and per-tenant semaphores is steady-state work *and* security work. The two are not separate.

Specifically:

- Set `http.Server.ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`. Without these, a slowloris attack consumes goroutines until your pool is exhausted.
- Set `MaxHeaderBytes` and validate body sizes.
- Use a per-IP or per-tenant rate limiter at the gateway. Internal services should trust their callers.
- Keep `GOMEMLIMIT` set even when not strictly necessary. It is a defence against unintentional or hostile memory pressure.

---

## Performance tips

A few targeted performance habits that pay off in steady-state contexts:

- **Pre-allocate slices when the size is known.** `make([]T, 0, N)` avoids reallocations as the slice grows.
- **Reuse buffers with `sync.Pool`** for objects allocated and freed in tight loops.
- **Avoid `fmt.Sprintf` in hot paths.** Use `strconv.AppendInt`, `bytes.Buffer`, or a pre-rendered template.
- **Use streaming parsers** (`json.Decoder`, `xml.Decoder`) over `json.Unmarshal` for large payloads. The peak memory drops from O(N) to O(1).
- **Drop unused fields in protobuf and JSON.** Decoding still allocates; smaller schemas allocate less.

Most of these become noticeable only at scale. For a service handling ten requests per second, they are noise. For one handling ten thousand, they are the difference between "comfortable" and "swap thrashing."

---

## Edge cases and pitfalls

### Edge case: zero-traffic steady-state

A service receiving no traffic should also be in steady-state: idle resources released, idle goroutines parked, idle connections eventually closed. If memory climbs at zero RPS, the leak is in background tasks (heartbeats, metric reporters, log shippers).

### Edge case: warm-up

The first thirty seconds after startup are *not* steady-state. Caches are filling, connection pools are warming, allocators are mapping arenas. Distinguish "warming up" from "drifting" — both have positive slope, but warm-up is bounded.

### Edge case: deploy boundary

Each deploy resets state. A "leak budget" relies on this. If a deploy is skipped (a long incident, a holiday freeze), the budget may be exceeded by the unforced extension.

### Pitfall: counting only the heap

The heap is the most visible resource, but it is not the only one. Counting only the heap misses goroutine leaks (which show up in stacks), FD leaks (which show up in `/proc/self/fd`), and channel-buffer leaks (which show up as memory pressure but with no specific allocation site).

A complete steady-state dashboard tracks all four resource axes.

---

## Common misconceptions, continued

### "Setting `GOMEMLIMIT` low keeps memory low."

It tries. But if your application allocates faster than GC can free, the soft limit is exceeded. `GOMEMLIMIT` is not a hard cap on allocations; it is a trigger for more aggressive GC.

### "Bounded queues lose data."

Only if the policy is shed-on-full. With block-on-full plus a deadline, the producer is signalled to slow down (back-pressure), and no data is lost unless the deadline expires.

### "Goroutines clean up automatically."

A goroutine exits when its function returns. If the function is in an infinite loop with no exit condition, the goroutine leaks. Always provide an exit (context, channel close, done flag).

### "My service has been fine for a year, so it must be in steady-state."

It might be in slow drift that hasn't crossed an alarm yet. Run a leak detector for a day; check the actual slope.

### "Channels are free."

A channel is a small heap allocation, but the items it buffers are not. A buffer of a million strings is a million strings of heap pressure.

---

## Tricky questions

### Q: Can a goroutine leak without a memory leak?

Yes, briefly: a goroutine on an empty stack consumes only a few kilobytes. Ten thousand of them is twenty megabytes — measurable but small. The actual cost shows up in the *state they hold*: closures, channels, references. A "pure" goroutine leak is rare and shallow.

### Q: Can a memory leak survive after `runtime.GC()`?

Absolutely. GC frees only unreferenced memory. If your code holds a reference (in a map, a slice, a global), GC sees it as live. A "leak" is almost always a referencing bug.

### Q: Does `defer` run on `os.Exit`?

No. `os.Exit` terminates immediately. Deferred functions, finalisers, and the GC do not run. This is part of why graceful shutdown matters: `os.Exit(1)` from a panic leaves resources in whatever state they were in.

---

## More cheat sheet

```go
// Bounded LRU
import lru "github.com/hashicorp/golang-lru/v2"
cache, _ := lru.New[string, []byte](10000)

// Per-tenant semaphore
sem := semaphore.NewWeighted(10)
sem.Acquire(ctx, 1)
defer sem.Release(1)

// `sql.DB` baseline
db.SetMaxOpenConns(25)
db.SetMaxIdleConns(25)
db.SetConnMaxLifetime(30 * time.Minute)

// `http.Transport` baseline
tr := &http.Transport{
    MaxIdleConnsPerHost: 50,
    MaxConnsPerHost:     100,
    IdleConnTimeout:     90 * time.Second,
}

// Reader/writer timeouts on a server
srv := &http.Server{
    ReadHeaderTimeout: 10 * time.Second,
    ReadTimeout:       30 * time.Second,
    WriteTimeout:      30 * time.Second,
    MaxHeaderBytes:    1 << 16,
}
```

---

## What's next

After absorbing this page, the next step is the middle page. It picks up where this one leaves off: bounded queues become per-tenant semaphores, basic pool tuning becomes saturation-aware tuning, "watch the heap" becomes "build a saturation dashboard." Read the middle page when you are ready to apply these principles to a real service.

---

## A second walkthrough — the goroutine leak

The first walkthrough was a heap leak. Now let's do the same exercise for a goroutine leak.

### The leaking program

```go
package main

import (
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "runtime"
    "time"
)

func handler(w http.ResponseWriter, r *http.Request) {
    ch := make(chan int)
    go func() {
        // BUG: this goroutine receives from ch, but no one sends.
        // It blocks forever.
        <-ch
    }()
    fmt.Fprintln(w, "ok")
}

func main() {
    go func() {
        http.ListenAndServe("127.0.0.1:6060", nil)
    }()
    http.HandleFunc("/", handler)
    go reporter()
    http.ListenAndServe(":8080", nil)
}

func reporter() {
    t := time.NewTicker(5 * time.Second)
    defer t.Stop()
    for range t.C {
        fmt.Printf("goroutines=%d\n", runtime.NumGoroutine())
    }
}
```

### Observing the leak

Send traffic:

```bash
while true; do curl -s http://localhost:8080/ > /dev/null; done
```

The reporter prints:

```
goroutines=8
goroutines=1024
goroutines=2103
goroutines=3247
goroutines=4392
```

Goroutine count is climbing about a thousand every five seconds. Each request leaks one goroutine, parked on the channel receive.

### Diagnosing

```bash
curl -s 'http://localhost:6060/debug/pprof/goroutine?debug=1'
```

Output (excerpted):

```
goroutine profile: total 4392
4385 @ 0x42c3a5 0x42c44e ...
   #   0x4567a    main.handler.func1+0x4567a    /tmp/leak.go:13
```

Four thousand three hundred eighty-five goroutines parked on line 13 of `handler.func1`. That is the receive `<-ch`. The bug is clear: the channel has no sender.

### Fixing

Either send a value to the channel, or close it, or remove the goroutine entirely. Here the goroutine has no purpose at all, so:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "ok")
}
```

Or, more realistically, if the goroutine was meant to wait for *some* event with a deadline:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ch := make(chan int, 1)
    go func() {
        select {
        case <-ch:
        case <-r.Context().Done():
        }
    }()
    fmt.Fprintln(w, "ok")
}
```

Now the goroutine exits when the request context is cancelled.

### Lessons

- The fingerprint of a goroutine leak is a rising `NumGoroutine` with stable memory.
- The goroutine profile names the exact line where the goroutines are parked.
- Every `go func()` must have an exit condition. The most common is `<-ctx.Done()`.

---

## A third walkthrough — the FD leak

The third common type. Take a deep breath; this one is sneaky.

### The leaking program

```go
package main

import (
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "os"
    "time"
)

func handler(w http.ResponseWriter, r *http.Request) {
    resp, err := http.Get("https://httpbin.org/get")
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    // BUG: never closing the body.
    _ = resp
    fmt.Fprintln(w, "ok")
}

func main() {
    go func() {
        http.ListenAndServe("127.0.0.1:6060", nil)
    }()
    http.HandleFunc("/", handler)
    go reporter()
    http.ListenAndServe(":8080", nil)
}

func reporter() {
    t := time.NewTicker(5 * time.Second)
    defer t.Stop()
    for range t.C {
        files, _ := os.ReadDir(fmt.Sprintf("/proc/%d/fd", os.Getpid()))
        fmt.Printf("fds=%d\n", len(files))
    }
}
```

### Observing the leak

Send traffic at moderate rate (one per second):

```bash
while true; do curl -s http://localhost:8080/ > /dev/null; sleep 1; done
```

The reporter prints:

```
fds=12
fds=28
fds=44
fds=60
...
```

FDs climb by roughly one per request. Each request opens a TCP connection to the upstream, and because the body is never closed, the connection cannot return to the keep-alive pool.

### Diagnosing

On Linux:

```bash
ls -l /proc/$(pidof leak)/fd | awk '{print $11}' | sort | uniq -c | sort -nr | head
```

Output (excerpted):

```
   85 socket:[1234567]
   85 socket:[1234568]
    3 /dev/null
    1 pipe:[890]
```

Eighty-five sockets, all to similar endpoints. The leak is clearly socket-based.

### Fixing

```go
func handler(w http.ResponseWriter, r *http.Request) {
    resp, err := http.Get("https://httpbin.org/get")
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    defer func() {
        io.Copy(io.Discard, resp.Body)
        resp.Body.Close()
    }()
    fmt.Fprintln(w, "ok")
}
```

The drain (`io.Copy(io.Discard, resp.Body)`) is required even if we don't read the body. Without it, the connection stays "in use" forever from the transport's perspective.

### Lessons

- FD count is a separate signal from memory; check both.
- Every HTTP response body must be drained and closed.
- The fingerprint is FDs climbing while memory and goroutines look fine.

---

## Diagrams and visual aids

### Steady-state vs drift, in text

```
Healthy service:        Drifting service:

heap                    heap
 ^                       ^
 |  /\  /\  /\           |        /\
 | /  \/  \/  \          |    /\ /  \
 |/                      |   /  V    \
 +---------> time        |  /         \
                         | /
                         +---------> time
```

The healthy graph oscillates around a baseline. The drifting graph rises monotonically.

### The three-phase load curve

```
throughput
 ^
 | ........ saturation
 |       /
 |      /
 |     / Phase 3
 |    /
 |   /
 |  /  Phase 2
 | /
 |/    Phase 1
 +---------> load
```

Phase 1 is linear scaling. Phase 2 is sub-linear. Phase 3 is saturation. Engineering aims for Phase 1 with bursts into Phase 2; Phase 3 is degraded-mode operation.

### The bounded queue

```
producer ---> [ . . . . . . . . ] ---> consumer
                  bounded queue (capacity 8)
```

When the queue is full:

- Shed-on-full: producer drops new items, returns error.
- Block-on-full: producer waits.
- Load-shed: producer probabilistically drops.

### The worker pool

```
                  +-------+
                  | W1    | --+
                  +-------+   |
producer --> Q -> | W2    | --+--> downstream
                  +-------+   |
                  | W3    | --+
                  +-------+
                  | W4    | --+
                  +-------+
```

Fixed N workers, bounded queue Q. The producer pushes to Q; workers consume from Q.

---

## Related topics

### Drain pattern

[See 05-drain-pattern](../05-drain-pattern/) — the sibling section. Drain is "wind down on shutdown"; steady-state is "stay in equilibrium during normal operation." They share machinery: bounded queues, deadlines, graceful shutdown.

### Backpressure

[See 04-backpressure](../04-backpressure/) — the previous section. Backpressure is the mechanism by which a slow consumer slows down a fast producer. In steady-state, backpressure prevents queues from growing.

### Goroutine lifecycle

[See goroutine basics](../../02-goroutines/) — the building block. Every goroutine has a lifetime; steady-state requires that lifetime to be bounded.

### Channels

[See channels](../../03-channels/) — the synchronisation primitive. Bounded channels are the most important steady-state primitive in Go.

### Context

[See context patterns](../../05-context/) — the cancellation primitive. Steady-state depends on contexts being plumbed everywhere external calls happen.

---

## Twenty habits

A compressed checklist for self-review. If you can answer "yes" to every one, your code is well on the way to steady-state.

1. Every channel I create has a fixed, small capacity.
2. Every `go func` I write has a clear exit condition.
3. Every `os.Open`, `os.Create`, `os.OpenFile` is followed by `defer Close()`.
4. Every `http.Get`, `http.Do`, `client.Do` has `defer body drain + close`.
5. Every `db.Query`, `db.QueryContext` has `defer rows.Close()`.
6. Every `time.NewTicker` has `defer t.Stop()`.
7. Every `time.NewTimer` has `defer t.Stop()`.
8. Every map used as a cache has eviction (TTL, LRU, or both).
9. Every slice I append to in a loop has a known upper bound or a truncation.
10. Every connection pool I create has an explicit size.
11. Every `MaxOpenConns` value is justified by a calculation.
12. Every `MaxIdleConnsPerHost` is greater than 2.
13. `GOMEMLIMIT` is set, either via env var or `debug.SetMemoryLimit`.
14. `net/http/pprof` is enabled on a localhost listener.
15. Goroutine count is exported as a metric.
16. Open FD count is exported as a metric.
17. Every external call has a context deadline.
18. Every panic in a goroutine is recovered.
19. Every shutdown path calls Close on owned resources.
20. The service has been tested under load for at least one hour.

If any of these is "no", you have a candidate steady-state weakness. Each "yes" is a small win; twenty "yes"es is a service that does not surprise you.

---

## Final thoughts

Steady-state engineering is the discipline that makes the difference between a service that runs for a day and one that runs for a year. The mechanics are not exotic: bounded queues, capped goroutines, sized pools, paired lifecycles. The discipline is consistent application of these mechanics across every line of production code.

The reward is not visible to anyone but the on-call engineer. The reward is the absence of pages. The reward is the deploy that ships without incident. The reward is the dashboard that stays boring for months.

Boring is the goal. Aim for boring.

---

## Practice exercises (junior level)

Quick exercises to consolidate the junior material. Each should take fifteen to thirty minutes.

### Exercise 1 — write the smallest worker pool

Write `Pool`, `Submit`, `Stop`. Goroutine count fixed. Submit returns `ErrFull` when the queue is full.

### Exercise 2 — add the drain pattern

Take an existing HTTP client call. Add `io.Copy(io.Discard, resp.Body)` and `resp.Body.Close()` inside a defer.

### Exercise 3 — instrument a leak

Write a function that intentionally leaks a goroutine per request. Run it with traffic; observe `runtime.NumGoroutine()` rising. Then fix the leak.

### Exercise 4 — set `GOMEMLIMIT` from a file

Read a file containing a memory limit in bytes. Call `debug.SetMemoryLimit` with that value times 0.9.

### Exercise 5 — find the bug in your own code

Take a project you have written. Search for `make(chan` with no second argument or a large second argument. For each, decide: should this be bounded?

### Exercise 6 — pprof tour

Install Graphviz, start a service with `net/http/pprof`, send some traffic. Use `go tool pprof` to inspect heap, goroutines, and allocations. Get comfortable with the `top`, `list`, `web` commands.

### Exercise 7 — measure FDs

For a running Go program of yours, count open FDs using `/proc/$PID/fd`. Try to make the number drop by adding `defer Close` somewhere.

### Exercise 8 — read a heap diff

Take two snapshots of a service thirty minutes apart. Run `go tool pprof -base T0 T1`. Identify the top growing function.

These exercises build muscle. The mistake junior engineers make is reading about steady-state without ever practising. The pattern recognition only comes from doing.

---

## Mental model for the next page

The middle page builds on this one. Specifically:

- The simple worker pool gets a per-tenant semaphore wrapped around it.
- The bounded queue gets a backpressure mechanism.
- `defer Close` gets generalised to connection pool lifecycle.
- `GOMEMLIMIT` gets integrated with cgroup detection.

If you have absorbed the junior material — bounded queues, capped goroutines, paired lifecycles, `GOMEMLIMIT` — you are ready for the middle layer.

---

## One last cheat sheet

A combined cheat sheet of the most important snippets:

```go
// Set GOMEMLIMIT at startup
debug.SetMemoryLimit(int64(0.9 * float64(cgroupBytes)))

// Bounded worker pool
jobs := make(chan func(), workers*2)
for i := 0; i < workers; i++ {
    go func() {
        for j := range jobs {
            j()
        }
    }()
}

// Shed-on-full submit
select {
case jobs <- job:
default:
    return ErrShed
}

// Block-on-full submit with deadline
select {
case jobs <- job:
    return nil
case <-ctx.Done():
    return ctx.Err()
}

// HTTP body drain
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()

// Database rows
defer rows.Close()

// File handle
defer f.Close()

// Ticker
t := time.NewTicker(d)
defer t.Stop()

// pprof endpoint (localhost only)
go http.ListenAndServe("127.0.0.1:6060", nil)

// Goroutine count
fmt.Println(runtime.NumGoroutine())

// FD count on Linux
files, _ := os.ReadDir(fmt.Sprintf("/proc/%d/fd", os.Getpid()))
fmt.Println(len(files))
```

Print this. Pin it to your monitor. These ten patterns are the foundation. Every senior service uses them; every steady-state service depends on them.

