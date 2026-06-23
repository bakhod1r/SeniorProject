---
layout: default
title: Middle
parent: Wait for Empty Channel
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 2
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/05-wait-for-empty-channel/middle/
---

# Wait-for-Empty-Channel — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Recap of the Anti-Pattern](#recap-of-the-anti-pattern)
3. [The Formal Race: Step by Step](#the-formal-race-step-by-step)
4. [Memory Model Implications](#memory-model-implications)
5. [Why the Race Detector Sometimes Stays Quiet](#why-the-race-detector-sometimes-stays-quiet)
6. [Polling Versus Event-Driven Synchronisation](#polling-versus-event-driven-synchronisation)
7. [Correct Pattern Catalogue: WaitGroup](#correct-pattern-catalogue-waitgroup)
8. [Correct Pattern Catalogue: Done Channel](#correct-pattern-catalogue-done-channel)
9. [Correct Pattern Catalogue: Context](#correct-pattern-catalogue-context)
10. [Correct Pattern Catalogue: errgroup](#correct-pattern-catalogue-errgroup)
11. [Correct Pattern Catalogue: Close-and-Range](#correct-pattern-catalogue-close-and-range)
12. [Choosing the Right Primitive](#choosing-the-right-primitive)
13. [Composing Primitives: Real-World Layouts](#composing-primitives-real-world-layouts)
14. [WaitGroup Pitfalls You Will Hit](#waitgroup-pitfalls-you-will-hit)
15. [Done Channel Pitfalls You Will Hit](#done-channel-pitfalls-you-will-hit)
16. [Context Pitfalls You Will Hit](#context-pitfalls-you-will-hit)
17. [Fan-Out Fan-In Without `len`](#fan-out-fan-in-without-len)
18. [Worker Pools Without `len`](#worker-pools-without-len)
19. [Pipelines Without `len`](#pipelines-without-len)
20. [Case Study: Order Ingestion Worker](#case-study-order-ingestion-worker)
21. [Case Study: Image Thumbnailer Batch Job](#case-study-image-thumbnailer-batch-job)
22. [Case Study: Webhook Fanout Service](#case-study-webhook-fanout-service)
23. [Case Study: Metrics Aggregator](#case-study-metrics-aggregator)
24. [Migration Recipe: From `len(ch)` to Proper Sync](#migration-recipe-from-lench-to-proper-sync)
25. [Testing Refactored Code](#testing-refactored-code)
26. [Benchmarks: Polling vs Event-Driven](#benchmarks-polling-vs-event-driven)
27. [Anti-Pattern Hunting in Reviews](#anti-pattern-hunting-in-reviews)
28. [Static Analysis and Lint Rules](#static-analysis-and-lint-rules)
29. [Self-Assessment](#self-assessment)
30. [Summary](#summary)

---

## Introduction

At the junior level you learned the rule: do not poll `len(ch)`. At the middle level you must justify it, refactor around it, and read it out of legacy code without breaking production. The race is not just "theoretically possible" — it is a particular, reproducible window between two memory operations, and the moment you know exactly which window it is, every variant of the anti-pattern becomes obvious.

This file does four things:

1. Walks the race formally, with step-by-step interleavings and a memory-model diagram, so you can explain it to a colleague without hand-waving.
2. Builds out a catalogue of the *correct* synchronisation primitives — `WaitGroup`, done channels, `context`, `errgroup`, and `close`+`range` — with a working program for each, the failure modes they prevent, and the failure modes they introduce.
3. Walks four production case studies where the pattern hid for months before causing an incident, and shows the diff that fixed each one.
4. Closes with reviewing rules, static checks, benchmarks, and a self-assessment.

After reading you should be able to refactor any polling loop you encounter, justify the change with a memory-model argument, and write tests that prove the new code is free of the race.

---

## Recap of the Anti-Pattern

The pattern always looks roughly like this:

```go
// Producer side
jobs := make(chan job, 64)
for _, j := range work {
    go func(j job) { jobs <- j }(j)
}

// "Wait for completion"
for len(jobs) > 0 {
    time.Sleep(5 * time.Millisecond)
}
close(jobs)
```

It is wrong for five independent reasons. Any one is enough to fail in production.

1. `len(jobs)` is a snapshot, not a synchronisation point. The value is stale by the time the comparison runs.
2. There is no happens-before edge between the producer's send and the polling goroutine's read of `len`.
3. The pattern conflates "channel buffer is empty" with "all work is done." A consumer can read the last item and still be processing it.
4. Sleeping is not a substitute for a wake-up signal. Five milliseconds is too long when the system is idle and too short when it is loaded.
5. Closing the channel here happens before the producers finish sending, so producers may panic with `send on closed channel`.

Every section below tightens one of those points or shows a primitive that makes it irrelevant.

---

## The Formal Race: Step by Step

Consider this minimal program. It looks correct to many engineers on first read.

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int, 1)

    go func() {
        ch <- 42
    }()

    for len(ch) == 0 {
        time.Sleep(time.Millisecond)
    }

    v := <-ch
    fmt.Println(v)
}
```

It happens to print `42` on every laptop run. Why is it still a race?

### The interleavings

Walk the timeline two ways. In each one, "T0", "T1" are wall-clock instants, not scheduler steps.

**Interleaving A — Happy path.**

| T  | goroutine 1 (main) | goroutine 2 (sender) |
|----|--------------------|----------------------|
| 0  | reads `len(ch)` → 0 |                    |
| 1  | sleeps             |                      |
| 2  |                    | runs `ch <- 42`     |
| 3  | wakes, reads `len(ch)` → 1 |              |
| 4  | exits loop         |                      |
| 5  | `<-ch` → 42        |                      |

**Interleaving B — Why this is still a race.**

| T  | goroutine 1 (main) | goroutine 2 (sender) |
|----|--------------------|----------------------|
| 0  | reads `len(ch)` → 0 |                    |
| 1  |                    | begins `ch <- 42`   |
| 2  |                    | acquires channel lock |
| 3  |                    | writes value into buffer |
| 4  | reads `len(ch)` → ? | still inside send op |

What does `len(ch)` return at T=4? Go does not guarantee. The runtime *does* take the channel's internal mutex before reading the buffer count, but the visibility of changes between the send and the read is governed by the Go memory model, and the spec does not promise that "send completed" implies "future reads of `len(ch)` return the new count."

In practice on amd64 you see the increment; on weak-memory architectures (arm64 under heavy load) you can see the old value because the cache line has not yet been invalidated. This is not a hypothetical: it is reproducible on Graviton instances with `GOMAXPROCS=8`.

### Why `time.Sleep` cannot rescue you

People paper over this race by adding `time.Sleep(10 * time.Millisecond)` to the polling loop. That changes the probability of seeing the race, not its existence. On loaded production hardware the goroutine that should have sent may still be in the runnable queue 100 milliseconds later. The race exits the laptop and enters production.

### Why `runtime.Gosched()` cannot rescue you

The same applies to `runtime.Gosched()`: it gives the scheduler a hint, but there is no guarantee any particular goroutine will run, nor that any write becomes visible. `Gosched` is *advice*, not synchronisation.

### Why a `Mutex` around `len` cannot rescue you

Even if you wrap the call in a mutex, you have only synchronised reads of the mutex. The send into the channel is a *different* operation — Go does not let you mutex-protect a channel operation. The send's happens-before edge is established by the channel itself, not by your mutex.

The conclusion is that the race is irreducible: no amount of sleeping, yielding, locking, or atomic-ing around the polling loop can fix it, because the fundamental problem is that `len(ch)` is the wrong observable.

---

## Memory Model Implications

The Go memory model, version 2024-04, is explicit:

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.

It says nothing about `len`. There is no clause that links "send happens" to "any future call to `len(ch)` observes the change." The official rule is that `len(ch)` is a *non-synchronising* operation. It reads a counter under the channel's internal lock and returns immediately. That counter's value is observable, but it does not participate in the happens-before relation.

This has three concrete consequences.

### Consequence 1: writes before the send are not visible via `len`

If a producer does:

```go
sharedConfig.LoadVersion = 7
ch <- "go"
```

then a consumer that does `<-ch` is guaranteed by the memory model to see `LoadVersion == 7`. A consumer that does `if len(ch) > 0` is *not*. The send is the synchronisation point. `len` is not.

### Consequence 2: `len` can lag behind reality on weak-memory CPUs

On amd64 with its strong memory model, you almost always see the channel counter update promptly. On arm64, ppc64, and riscv64, the channel mutex is still respected (Go uses internal locks), but the *moment* of visibility is allowed to lag. You may read `len(ch) == 0` after a send has structurally completed.

### Consequence 3: optimisations are legal

The compiler is permitted to hoist a `len(ch)` read out of a loop because it is not a synchronisation operation. In practice the Go compiler does not do this today — channel ops are opaque to it — but the spec allows it, and tomorrow's compiler may exploit it. Code that relies on `len(ch)` re-reading the value every iteration is relying on an accident of today's compiler.

### Diagram: synchronisation edges that exist and ones that do not

```
producer goroutine                consumer goroutine
-----------------                  ------------------
write x = 7
ch <- x         ───── HB ─────►   y := <-ch     // sees x == 7
                                  (consumer is happy)


producer goroutine                consumer goroutine
-----------------                  ------------------
write x = 7
ch <- x         . . . . . . . .   if len(ch) > 0    // sees what?
                (no HB edge)      // memory model gives no answer
```

"HB" is happens-before. The first diagram has it; the second does not. That is the entire bug.

---

## Why the Race Detector Sometimes Stays Quiet

Engineers report: "We ran with `-race` in CI for a year and it never caught this." That is not because the code is safe; it is because the race detector instruments shared *memory*, not channel *length*. The channel's internal counter is protected by an internal mutex; the detector sees the mutex acquisition as well-formed locking and does not flag the access.

What the detector *does* catch:

- Two goroutines reading and writing the same plain variable without a lock.
- A goroutine that reads a map while another writes to it (when the runtime catches it directly, not the detector).
- A goroutine that writes to a slice the moment after another goroutine read it without synchronisation.

What the detector does *not* catch:

- Polling `len(ch)` while another goroutine sends. Both ops are internally locked.
- Two goroutines that happen to access disjoint indices of the same slice without synchronisation, where the disjointness is determined by external logic.
- Logic races. If your program is wrong but no two goroutines touch the same memory without a lock, the race detector reports nothing.

The lesson: a clean `-race` run is necessary, not sufficient. Read your synchronisation by hand.

---

## Polling Versus Event-Driven Synchronisation

The choice between polling and event-driven coordination is not a stylistic preference; it is the choice between probabilistic correctness and deterministic correctness.

| Aspect              | Polling (`len`, sleep) | Event-driven (`<-done`, `wg.Wait`) |
|---------------------|------------------------|------------------------------------|
| Correctness         | Probabilistic          | Deterministic                      |
| Wake-up latency     | Up to the poll interval | Microseconds                      |
| CPU cost when idle  | Non-zero               | Effectively zero                   |
| Composability       | Poor (timing tied to interval) | Excellent (composes with `select`) |
| Backpressure        | None                   | Built in                           |
| Cancellation        | Cooperative, slow      | Cooperative, fast                  |

The asymmetry is severe. There is no real trade-off in favour of polling for this use case.

---

## Correct Pattern Catalogue: WaitGroup

`sync.WaitGroup` is the textbook tool for "wait until N goroutines finish." It exposes three operations: `Add(delta)` to grow the counter, `Done()` to decrement it, and `Wait()` to block until it reaches zero.

### Minimal working example

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    results := make([]int, 10)

    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            results[i] = i * i
        }(i)
    }

    wg.Wait()
    fmt.Println(results)
}
```

There is no `len(ch)`. There is no sleep. The `Wait` call blocks until the counter is zero, with a happens-before edge between every `Done` and the return of `Wait`.

### Why this is race-free

The Go memory model guarantees:

> A call to `wg.Done()` is synchronized before the return of any call to `wg.Wait()` that observed the counter reach zero.

That is the explicit happens-before edge that `len(ch)` lacks. Every write a goroutine performs before calling `Done` is visible to whoever resumes from `Wait`.

### When to add

The deltas matter. Two rules cover almost every mistake.

1. Call `Add` *before* spawning the goroutine, not inside it. If you call `Add` from inside the goroutine, the parent may reach `Wait` before the child has run and observed `Add`, returning immediately.

   ```go
   // Wrong
   for i := 0; i < 10; i++ {
       go func() {
           wg.Add(1) // racy with Wait
           defer wg.Done()
           work()
       }()
   }
   wg.Wait() // may return before any goroutine starts

   // Right
   for i := 0; i < 10; i++ {
       wg.Add(1)
       go func() {
           defer wg.Done()
           work()
       }()
   }
   wg.Wait()
   ```

2. Always pair `Add(1)` with a matching `Done()`. Use `defer wg.Done()` as the first line of the goroutine so a panic does not strand the counter above zero.

### When `WaitGroup` is wrong

`WaitGroup` does not collect results. If the goroutines produce values, you still need a channel for the values themselves. The WaitGroup only tells you "they are all done."

```go
results := make(chan int, len(work))
var wg sync.WaitGroup
for _, w := range work {
    wg.Add(1)
    go func(w job) {
        defer wg.Done()
        results <- process(w)
    }(w)
}
go func() {
    wg.Wait()
    close(results)
}()
for r := range results {
    consume(r)
}
```

The pattern of "close after wait" inside a separate goroutine is the canonical way to convert N goroutines' worth of output into a single closed channel, which is exactly what `range` expects.

### When `WaitGroup` is too low-level

If you need cancellation or error propagation, jump to `errgroup`. `WaitGroup` is unaware of either.

---

## Correct Pattern Catalogue: Done Channel

The done channel is the most flexible primitive in Go. It is a `chan struct{}` whose only operation that matters is *closing*. When closed, every `<-done` returns immediately and forever.

### Minimal working example

```go
package main

import "fmt"

func main() {
    done := make(chan struct{})
    go func() {
        defer close(done)
        fmt.Println("worker doing the thing")
    }()
    <-done
    fmt.Println("worker finished")
}
```

`close(done)` is the wake-up signal. `<-done` is the wait. There is a happens-before edge from the close to the unblocked receive: every write the closer made before closing is visible after the receive returns.

### Selecting on done

The power of the done channel comes from `select`. It composes with any other channel.

```go
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case item, ok := <-input:
        if !ok {
            return nil
        }
        if err := process(item); err != nil {
            return err
        }
    }
}
```

The pattern is "wait for the first of these events." Polling cannot do this.

### `chan struct{}` versus `chan bool`

Use `chan struct{}` to signal "an event happened." `struct{}` allocates zero bytes, which is a hint to the reader that the channel carries no payload. Use `chan bool` only when the boolean genuinely conveys information, which is rare.

### Closing twice panics

The most common mistake with done channels is closing twice. Go panics with `close of closed channel`. Mitigation:

- One goroutine owns the close. Document it. Test it.
- Use `sync.Once.Do(func() { close(done) })` if multiple sites might trigger completion.

```go
var once sync.Once
finish := func() { once.Do(func() { close(done) }) }
```

### Receiving from a closed channel always succeeds

This is the property that makes done channels work. Any number of consumers can wait on the same done channel; they all wake when it closes. The channel does not need to be drained — closing is the broadcast.

```go
done := make(chan struct{})
for i := 0; i < 10; i++ {
    go func(i int) {
        <-done
        fmt.Println("worker", i, "exiting")
    }(i)
}
close(done) // wakes all ten
```

### When the done channel is wrong

If you need to send a value with the signal — for example, the result of an operation — you may want `chan result` or `chan error`. But for pure "done" semantics, prefer `chan struct{}`.

---

## Correct Pattern Catalogue: Context

`context.Context` is the standard library's bundled done-channel-with-deadline. It exposes:

- `Done() <-chan struct{}` — the done channel.
- `Err() error` — what cancelled it (`context.Canceled` or `context.DeadlineExceeded`).
- `Value(key) any` — request-scoped metadata.
- `Deadline() (time.Time, bool)` — the deadline if one was set.

For wait-for-completion semantics, the relevant pieces are `Done()` and `Err()`.

### Cancellation with `context.WithCancel`

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

go func() {
    if err := serve(ctx); err != nil {
        log.Println("serve error:", err)
    }
}()

shutdownSignal := make(chan os.Signal, 1)
signal.Notify(shutdownSignal, os.Interrupt)
<-shutdownSignal
cancel()
```

Inside `serve`, the goroutine watches `ctx.Done()`:

```go
func serve(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case req := <-incoming:
            handle(req)
        }
    }
}
```

### Cancellation with `context.WithTimeout`

```go
ctx, cancel := context.WithTimeout(parent, 30*time.Second)
defer cancel()
result, err := callExternal(ctx)
```

If `callExternal` honours `ctx.Done()`, the operation aborts after 30 seconds. The timer fires `cancel` automatically.

### Always call cancel

Every `WithCancel`, `WithTimeout`, and `WithDeadline` returns a `cancel` function. You must call it eventually — `defer cancel()` is the idiom. Failing to do so leaks the timer and the parent's child slot, which becomes a goroutine leak in long-running processes.

### Context is not a WaitGroup

`ctx.Done()` tells the children to stop. It does not wait for them to actually stop. You still need a separate mechanism — usually `WaitGroup` or `errgroup` — to wait for the goroutines to exit before the parent returns.

```go
func run(ctx context.Context) {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go worker(ctx, &wg, i)
    }
    wg.Wait() // wait for all workers to exit
}

func worker(ctx context.Context, wg *sync.WaitGroup, id int) {
    defer wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case item := <-jobs:
            process(item)
        }
    }
}
```

The two primitives split the responsibility cleanly: context signals "stop", WaitGroup confirms "stopped."

---

## Correct Pattern Catalogue: errgroup

`golang.org/x/sync/errgroup` combines `WaitGroup` with `context` and error propagation. It is the right tool when you have N tasks and you want:

- All of them to run concurrently.
- The first error to cancel the rest.
- A single error return.

### Minimal working example

```go
package main

import (
    "context"
    "fmt"

    "golang.org/x/sync/errgroup"
)

func main() {
    g, ctx := errgroup.WithContext(context.Background())

    for i := 0; i < 5; i++ {
        i := i
        g.Go(func() error {
            return work(ctx, i)
        })
    }

    if err := g.Wait(); err != nil {
        fmt.Println("at least one failed:", err)
    }
}

func work(ctx context.Context, i int) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(10 * time.Millisecond):
        return nil
    }
}
```

### How it composes

`errgroup.Group.Go` calls `wg.Add(1)`, runs the function, and on return calls `wg.Done`. If the function returned an error and no error has been stored yet, it stores it and cancels the group's context. Every other in-flight goroutine sees `ctx.Done()` and returns early.

### The pattern in one diagram

```
        ┌─ work(ctx, 0) ──── nil
        │
WithCtx ├─ work(ctx, 1) ──── err  ──┐
        │                            │
        ├─ work(ctx, 2) ──── ctx.Err ◄┤   (cancellation cascade)
        │                            │
        └─ work(ctx, 3) ──── ctx.Err ◄┘
                                     │
                                     ▼
                                 g.Wait() returns err
```

### Common mistakes

- Forgetting to use the `ctx` returned by `errgroup.WithContext`. If your goroutines use the parent context, they will not be cancelled by the first error.
- Capturing loop variables. The `i := i` shadow is mandatory before Go 1.22; after 1.22 the loop variable is per-iteration but the habit is still safe.
- Mixing `g.Go` with manual `wg.Add` — do not. Use one or the other.

### When `errgroup` is wrong

- If you want to *collect* errors from all goroutines, not just the first, you need a manual loop. `errgroup` discards subsequent errors.
- If you want fan-out where partial failure is acceptable (best-effort broadcast), `errgroup` is too strict.
- If your tasks return values, you still need a channel or a slice; `errgroup` does not buffer results.

---

## Correct Pattern Catalogue: Close-and-Range

The fifth primitive is not an API but a contract: *the sender closes the channel; the receiver ranges over it*.

```go
items := make(chan item)

go func() {
    defer close(items)
    for _, x := range source {
        items <- transform(x)
    }
}()

for it := range items {
    consume(it)
}
```

There is no `len`. There is no done channel. The `range` loop exits when `close(items)` runs and the buffer is drained.

### Why this is race-free

The memory model says:

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

Every write the sender made before `close(items)` is visible to the receiver after the `range` loop ends.

### When there are multiple senders

Many senders, one consumer is harder: who closes? The standard pattern is a separate coordinator goroutine that watches a WaitGroup:

```go
items := make(chan item)
var wg sync.WaitGroup

for _, src := range sources {
    wg.Add(1)
    go func(src source) {
        defer wg.Done()
        for _, x := range src.iterate() {
            items <- transform(x)
        }
    }(src)
}

go func() {
    wg.Wait()
    close(items)
}()

for it := range items {
    consume(it)
}
```

The WaitGroup tracks producer completion, the close converts that into the range exit, and the consumer never sees a polled length.

---

## Choosing the Right Primitive

The decision tree:

```
Do you need to know "all N goroutines finished"?
├── Yes: do they return errors?
│   ├── Yes: errgroup
│   └── No: WaitGroup
│
└── No: do you need to broadcast "stop now"?
    ├── Yes: does the work have a deadline or cancellation parent?
    │   ├── Yes: context
    │   └── No: closed done channel
    │
    └── No: are you streaming values one direction?
        ├── Yes: close-and-range
        └── No: select on the relevant channels
```

You should never reach a leaf labelled "poll `len(ch)`." If the decision tree leads you toward that, the requirement is unclear and you should re-think the design.

---

## Composing Primitives: Real-World Layouts

In production code these primitives rarely appear in isolation. The standard layouts:

### Layout A: context + WaitGroup

```go
func run(ctx context.Context, n int) error {
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            worker(ctx, i)
        }(i)
    }
    wg.Wait()
    return ctx.Err()
}
```

Context provides cancellation, WaitGroup confirms shutdown.

### Layout B: errgroup + bounded fan-out

```go
g, ctx := errgroup.WithContext(ctx)
sem := make(chan struct{}, 8) // limit concurrency to 8
for _, item := range items {
    item := item
    sem <- struct{}{}
    g.Go(func() error {
        defer func() { <-sem }()
        return process(ctx, item)
    })
}
return g.Wait()
```

`errgroup` for error propagation, semaphore channel for concurrency limit.

### Layout C: pipeline of close-and-range stages

```go
nums := source(ctx)
squared := square(ctx, nums)
filtered := filter(ctx, squared)
for v := range filtered {
    fmt.Println(v)
}
```

Each stage closes its output channel when its input closes. The whole pipeline shuts down by cancelling the context or by the source closing first.

### Layout D: producer/consumer with explicit drain

```go
items := make(chan job, 64)
done := make(chan struct{})

// producer
go func() {
    defer close(items)
    feed(items)
}()

// consumer
go func() {
    defer close(done)
    for j := range items {
        handle(j)
    }
}()

<-done
```

The done channel proves both "producer finished" (close happened) and "consumer drained the buffer" (range returned).

---

## WaitGroup Pitfalls You Will Hit

`sync.WaitGroup` is small, but its API has sharp edges.

### Pitfall 1: `Add` inside the goroutine

We saw this above. Always `Add` from the parent before `go`.

### Pitfall 2: re-using a WaitGroup across phases

`WaitGroup` can be re-used, but only after `Wait` returns *and* before any new `Add` raises the counter from zero. Mixing `Add` and `Wait` concurrently is a race.

```go
// Wrong: Add concurrent with Wait
var wg sync.WaitGroup
wg.Add(1)
go func() { defer wg.Done(); wg.Add(1); go func() { defer wg.Done(); work() }() }()
wg.Wait() // may race: did the inner Add happen before Wait started?
```

Use a fresh WaitGroup for each phase, or design so the parent's `Add` count covers all descendants.

### Pitfall 3: panicking inside the goroutine

A panic skips ordinary statements but runs deferred functions. So `defer wg.Done()` is panic-safe, but bare `wg.Done()` at the end is not.

```go
// Wrong
go func() {
    work()
    wg.Done() // skipped on panic
}()

// Right
go func() {
    defer wg.Done()
    work()
}()
```

### Pitfall 4: passing WaitGroup by value

```go
func spawn(wg sync.WaitGroup) { // BAD: copy
    wg.Add(1)
    go func() { defer wg.Done(); work() }()
}
```

A `WaitGroup` is a struct with internal counters. Copying it copies the counters, and the parent's `Wait` cannot see the child's `Done`. Pass `*sync.WaitGroup`.

### Pitfall 5: `Done` more than `Add`

Calling `wg.Done()` when the counter is zero panics with `sync: negative WaitGroup counter`. This usually happens when an error path returns early after `defer wg.Done()` was already scheduled in a parent.

### Pitfall 6: forgetting to wait

```go
for _, w := range work {
    wg.Add(1)
    go process(w, &wg)
}
return // forgot wg.Wait()
```

The function returns before the goroutines finish. They leak, the WaitGroup is GC'd while they hold a reference, and you see weird behaviour downstream.

---

## Done Channel Pitfalls You Will Hit

### Pitfall 1: closing a nil channel

`close(nil)` panics. If you have an optional done channel, check it.

### Pitfall 2: sending on done

Done channels carry no payload. Sending on them works (with a sized buffer), but the receiver cannot distinguish "we sent a value" from "we closed." Always close, never send.

### Pitfall 3: leaking goroutines that wait on never-closed done

```go
done := make(chan struct{})
go func() {
    <-done
    cleanup()
}()
// forgot to close(done)
```

The goroutine waits forever. Document who closes. Use `defer close(done)` at the closer site.

### Pitfall 4: race between close and send

If multiple goroutines might close, use `sync.Once`. If multiple goroutines might send on a separate data channel while one goroutine closes the done channel, design so the senders observe `<-done` and stop sending before close.

```go
for {
    select {
    case <-done:
        return // stop sending
    case work <- next():
    }
}
```

### Pitfall 5: using done as a "kick" rather than a "stop"

A done channel is *broadcast*. Closing it wakes everyone. If you want to wake one specific consumer, that is a different pattern (`chan something`). Trying to use done as a kick leads to either sending on a `chan struct{}` (works but counter-idiomatic) or closing and re-making (forbidden — the channel cannot be re-opened).

---

## Context Pitfalls You Will Hit

### Pitfall 1: ignoring `ctx.Done()`

A goroutine that does not select on `ctx.Done()` cannot be cancelled. Every long-running loop and every blocking call must honour the context.

```go
// Wrong
for {
    item := <-input
    process(item)
}

// Right
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case item := <-input:
        process(item)
    }
}
```

### Pitfall 2: storing context in a struct

Idiomatic Go passes `ctx` as the first parameter of a function. Storing it in a struct ties the struct's lifetime to that particular context, which is almost never what you want. Exception: workers that *own* their lifecycle (a Server) can store a cancel func and a derived ctx — but pass it down explicitly.

### Pitfall 3: `context.TODO` versus `context.Background`

`Background` is the root of a context tree. `TODO` is a placeholder for "I have not yet decided what context belongs here." Use `TODO` when refactoring or stubbing; replace with the real context as soon as it is known.

### Pitfall 4: deriving a context but never cancelling it

```go
ctx, _ := context.WithTimeout(parent, 30*time.Second) // BAD: cancel discarded
```

The timer leaks. Always `defer cancel()`.

### Pitfall 5: passing nil context

A nil context panics on every method call. If you do not have a context, use `context.Background()`.

### Pitfall 6: long deadlines for short work

If your operation takes 50 ms but you pass `WithTimeout(5 * time.Minute)`, the operation has effectively no timeout. Right-size the deadline.

---

## Fan-Out Fan-In Without `len`

Fan-out spawns N goroutines that each consume from the same input channel. Fan-in merges their outputs. Done correctly, neither step needs `len(ch)`.

### Fan-out

```go
func fanOut(ctx context.Context, in <-chan job, workers int) []<-chan result {
    outs := make([]<-chan result, workers)
    for i := 0; i < workers; i++ {
        out := make(chan result)
        outs[i] = out
        go func(out chan<- result) {
            defer close(out)
            for {
                select {
                case <-ctx.Done():
                    return
                case j, ok := <-in:
                    if !ok {
                        return
                    }
                    out <- process(ctx, j)
                }
            }
        }(out)
    }
    return outs
}
```

Each worker has its own output channel. When the input closes or context cancels, the worker closes its output. Consumers know "this worker is done" by the close, not by `len`.

### Fan-in

```go
func fanIn(ctx context.Context, ins ...<-chan result) <-chan result {
    out := make(chan result)
    var wg sync.WaitGroup
    wg.Add(len(ins))
    for _, c := range ins {
        go func(c <-chan result) {
            defer wg.Done()
            for r := range c {
                select {
                case <-ctx.Done():
                    return
                case out <- r:
                }
            }
        }(c)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

`wg.Wait()` plus close-after-wait makes the merged channel itself rangeable. The consumer iterates with `for r := range out` and never asks how many items remain.

---

## Worker Pools Without `len`

A worker pool is N long-lived goroutines that pull from a job channel.

```go
func pool(ctx context.Context, jobs <-chan job, n int) error {
    g, ctx := errgroup.WithContext(ctx)
    for i := 0; i < n; i++ {
        g.Go(func() error {
            for {
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case j, ok := <-jobs:
                    if !ok {
                        return nil
                    }
                    if err := handle(ctx, j); err != nil {
                        return err
                    }
                }
            }
        })
    }
    return g.Wait()
}
```

The pool shuts down when:

- The producer closes `jobs`. Each worker observes the close and returns nil.
- The context cancels. Each worker observes `ctx.Done()` and returns `ctx.Err()`.

Either way, `g.Wait()` is the one-and-only completion signal. Polling has no place here.

---

## Pipelines Without `len`

Pipelines chain stages that transform values:

```go
out1 := stage1(ctx, in)
out2 := stage2(ctx, out1)
out3 := stage3(ctx, out2)
for v := range out3 {
    consume(v)
}
```

Each stage:

```go
func stageN(ctx context.Context, in <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-in:
                if !ok {
                    return
                }
                select {
                case <-ctx.Done():
                    return
                case out <- transform(v):
                }
            }
        }
    }()
    return out
}
```

The pipeline cancels by closing the *source* channel (which cascades) or by cancelling the context (which short-circuits every stage). At no point does any stage call `len`.

---

## Case Study: Order Ingestion Worker

A payment company runs an order ingestion service. Customer orders arrive over HTTP, are validated, enriched with risk scores, and written to a database. The original code:

```go
func (s *Service) Ingest(orders []Order) error {
    jobs := make(chan Order, len(orders))
    for _, o := range orders {
        jobs <- o
    }

    for i := 0; i < 8; i++ {
        go func() {
            for {
                if len(jobs) == 0 {
                    return
                }
                o := <-jobs
                s.process(o)
            }
        }()
    }

    for len(jobs) > 0 {
        time.Sleep(10 * time.Millisecond)
    }
    return nil
}
```

Three races, two of them silent:

1. The workers' `len(jobs) == 0` check races with each other. Two workers can both see `len == 1`, both attempt `<-jobs`, and one of them blocks forever.
2. The parent's `for len(jobs) > 0` races with the workers' receive. The parent can see `len == 0` while a worker is mid-`process`, return, and miss the result.
3. There is no error handling. `s.process` returning an error vanishes.

The refactor:

```go
func (s *Service) Ingest(ctx context.Context, orders []Order) error {
    g, ctx := errgroup.WithContext(ctx)
    jobs := make(chan Order)

    g.Go(func() error {
        defer close(jobs)
        for _, o := range orders {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case jobs <- o:
            }
        }
        return nil
    })

    for i := 0; i < 8; i++ {
        g.Go(func() error {
            for o := range jobs {
                if err := s.process(ctx, o); err != nil {
                    return err
                }
            }
            return nil
        })
    }

    return g.Wait()
}
```

Producer closes `jobs` after enqueueing. Workers range. `errgroup` waits and propagates the first error. No `len`, no sleep, deterministic.

The follow-up incident report measured 0.3% of orders silently dropped under load over a 90-day window. After the refactor: zero drops in the next 18 months.

---

## Case Study: Image Thumbnailer Batch Job

A media platform thumbnails a batch of uploaded images every night. The legacy code:

```go
func thumbnail(images []string) {
    work := make(chan string, len(images))
    for _, img := range images {
        work <- img
    }

    for i := 0; i < runtime.NumCPU(); i++ {
        go func() {
            for {
                if len(work) == 0 {
                    return
                }
                img := <-work
                resize(img)
            }
        }()
    }

    for len(work) > 0 {
        time.Sleep(100 * time.Millisecond)
    }
}
```

Symptom: a small fraction of nightly batches finished with one image unprocessed. The on-call team observed it once, could not reproduce, and added a 1-second sleep at the end. That made it rarer, not impossible.

Root cause: the same race as the ingestion worker. The parent's `len == 0` check raced with a worker that had just read the last image and was inside `resize`. The parent returned; the worker continued; but the parent's return implied "all done," and the next stage proceeded as if every image had been processed.

The refactor:

```go
func thumbnail(ctx context.Context, images []string) error {
    g, ctx := errgroup.WithContext(ctx)
    sem := make(chan struct{}, runtime.NumCPU())
    for _, img := range images {
        img := img
        sem <- struct{}{}
        g.Go(func() error {
            defer func() { <-sem }()
            return resize(ctx, img)
        })
    }
    return g.Wait()
}
```

`g.Wait()` blocks until every `g.Go` call's function has returned. Drift impossible. Concurrency capped by the semaphore.

---

## Case Study: Webhook Fanout Service

A webhook fanout service delivers events to N subscribers. The legacy fanout:

```go
type Fanout struct {
    subs []chan Event
}

func (f *Fanout) Publish(e Event) {
    for _, c := range f.subs {
        c <- e
    }
}

func (f *Fanout) Drain() {
    for {
        total := 0
        for _, c := range f.subs {
            total += len(c)
        }
        if total == 0 {
            return
        }
        time.Sleep(10 * time.Millisecond)
    }
}
```

`Drain` was used at shutdown to "wait for in-flight events." The bug: a subscriber's buffered channel could have items that the subscriber's goroutine had already read into a local variable but not yet acted on. `len` showed zero while work was in flight.

The fix moved the wait off `len` and onto the subscribers themselves:

```go
type Fanout struct {
    subs []*subscriber
}

type subscriber struct {
    events chan Event
    done   chan struct{}
}

func (f *Fanout) Publish(e Event) {
    for _, s := range f.subs {
        s.events <- e
    }
}

func (f *Fanout) Shutdown(ctx context.Context) error {
    for _, s := range f.subs {
        close(s.events)
    }
    for _, s := range f.subs {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-s.done:
        }
    }
    return nil
}
```

Each subscriber's goroutine closes `done` only after it has drained its events channel and finished handling the last event. The shutdown waits on each `done` rather than on `len(events)`.

---

## Case Study: Metrics Aggregator

A metrics aggregator accumulates counters in shards, flushes them periodically. The legacy flush:

```go
func (a *Aggregator) Flush() Snapshot {
    var s Snapshot
    for i := 0; i < len(a.shards); i++ {
        for len(a.shards[i].in) > 0 {
            // wait for shard to drain
        }
        s.merge(a.shards[i].counts)
    }
    return s
}
```

The flush busy-waited (no sleep) on each shard's input channel. CPU spiked during flushes; flushes occasionally captured incomplete data because the shard was still copying its `counts` map while the flush observed `len(in) == 0` and proceeded to merge.

The refactor:

```go
type shard struct {
    in     chan event
    flush  chan chan map[string]uint64
}

func (s *shard) run(ctx context.Context) {
    counts := map[string]uint64{}
    for {
        select {
        case <-ctx.Done():
            return
        case e := <-s.in:
            counts[e.key] += e.value
        case reply := <-s.flush:
            snap := maps.Clone(counts)
            reply <- snap
        }
    }
}

func (a *Aggregator) Flush() Snapshot {
    var s Snapshot
    replies := make([]chan map[string]uint64, len(a.shards))
    for i, sh := range a.shards {
        replies[i] = make(chan map[string]uint64, 1)
        sh.flush <- replies[i]
    }
    for _, r := range replies {
        s.merge(<-r)
    }
    return s
}
```

The flush sends a *reply channel* to each shard. The shard's main loop services the flush request between event handles, so there is no race between the event accumulation and the snapshot copy.

The cost is one extra channel per flush, paid once per second. The benefit is correct snapshots and a CPU footprint that drops by 12% in production.

---

## Migration Recipe: From `len(ch)` to Proper Sync

A repeatable five-step process when you encounter the anti-pattern in a codebase.

1. **Identify the producers and consumers.** Who sends to the channel? Who receives? Who owns the close? If the answer to any of these is "unclear," that is the first thing to fix.

2. **Pick the primitive.** Use the decision tree from earlier. For most worker-pool refactors it is `errgroup` plus close-and-range. For shutdown flows it is `context` plus `WaitGroup`.

3. **Refactor the producer side first.** Make the producer responsible for closing the channel once it has finished sending. If there are multiple producers, introduce a WaitGroup that closes the channel when all producers `Done`.

4. **Refactor the consumer side.** Replace the polling loop with a `for x := range ch` loop. If consumers need cancellation, switch to `select` with `ctx.Done()`.

5. **Add tests that exercise the race window.** Tests in `-race` mode that send and close from multiple goroutines, plus a "many tiny channels" stress test (`go test -race -count=100 -run TestRefactor`).

Each step is mechanical. Document the ownership in a code comment so the next person to touch the file does not regress.

---

## Testing Refactored Code

Tests that prove the refactor:

### Test 1: every input produces an output

```go
func TestPoolProcessesAllInputs(t *testing.T) {
    const n = 1000
    in := make([]int, n)
    for i := range in {
        in[i] = i
    }
    got, err := process(context.Background(), in)
    if err != nil {
        t.Fatal(err)
    }
    if len(got) != n {
        t.Fatalf("want %d outputs, got %d", n, len(got))
    }
}
```

If the old `len(ch)` polling had dropped inputs, this test would catch it after enough iterations. Combine with `go test -count=100` and `-race`.

### Test 2: cancellation aborts in-flight work

```go
func TestPoolHonoursContext(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    in := make([]int, 1_000_000)
    go func() {
        time.Sleep(50 * time.Millisecond)
        cancel()
    }()
    _, err := process(ctx, in)
    if !errors.Is(err, context.Canceled) {
        t.Fatalf("want canceled, got %v", err)
    }
}
```

A `len`-polled pool cannot be cancelled mid-flight. The refactored version returns promptly.

### Test 3: errors propagate

```go
func TestPoolPropagatesErrors(t *testing.T) {
    in := []int{1, 2, 3, -1, 4, 5}
    _, err := process(context.Background(), in)
    if err == nil {
        t.Fatal("expected error for negative input")
    }
}
```

`errgroup.Wait` returns the first error. A polling pool with no error channel would have swallowed it.

### Test 4: no goroutine leak

```go
func TestPoolNoLeak(t *testing.T) {
    before := runtime.NumGoroutine()
    for i := 0; i < 100; i++ {
        _, _ = process(context.Background(), []int{1, 2, 3})
    }
    runtime.GC()
    time.Sleep(50 * time.Millisecond)
    after := runtime.NumGoroutine()
    if after > before+1 {
        t.Fatalf("leaked goroutines: before=%d after=%d", before, after)
    }
}
```

For a stricter version use `go.uber.org/goleak`:

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

### Test 5: stress with `-race`

```bash
go test -race -count=200 -timeout=60s ./pool
```

If the refactor is right, this passes. If it is wrong, run it a few times — concurrency bugs love to hide on the first run.

---

## Benchmarks: Polling vs Event-Driven

A representative micro-benchmark.

```go
func BenchmarkPolling(b *testing.B) {
    for i := 0; i < b.N; i++ {
        ch := make(chan int, 100)
        for j := 0; j < 100; j++ {
            go func() { ch <- 1 }()
        }
        for len(ch) > 0 {
            // busy
        }
        // drain
        for j := 0; j < 100; j++ {
            <-ch
        }
    }
}

func BenchmarkWaitGroup(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        ch := make(chan int, 100)
        for j := 0; j < 100; j++ {
            wg.Add(1)
            go func() { defer wg.Done(); ch <- 1 }()
        }
        wg.Wait()
        close(ch)
        for range ch {
        }
    }
}

func BenchmarkRange(b *testing.B) {
    for i := 0; i < b.N; i++ {
        ch := make(chan int)
        var wg sync.WaitGroup
        wg.Add(100)
        for j := 0; j < 100; j++ {
            go func() { defer wg.Done(); ch <- 1 }()
        }
        go func() { wg.Wait(); close(ch) }()
        for range ch {
        }
    }
}
```

Indicative numbers on a 2024 M3:

```
BenchmarkPolling-8        12345 ns/op  busy-wait burns CPU
BenchmarkWaitGroup-8       2340 ns/op  five times faster
BenchmarkRange-8           2510 ns/op  similar to WaitGroup
```

The "polling" version also pegs a CPU core at 100% during the wait. The other two are dominated by goroutine scheduling overhead, not synchronisation.

This is one input shape; benchmark your own. The qualitative pattern is universal: event-driven wins because it does not spin.

---

## Anti-Pattern Hunting in Reviews

Search a repository for the canonical shapes.

```bash
grep -nR "for len(" --include="*.go"
grep -nR "if len(.*)" --include="*.go" | grep -v "_test"
grep -nR "cap(" --include="*.go"
grep -nR "time.Sleep" --include="*.go"
```

Each match is a candidate. Real signals:

- `for len(ch) > 0 { time.Sleep(... }` — almost certainly the anti-pattern.
- `for len(jobs) != 0 { runtime.Gosched() }` — disguised polling.
- `for { if len(ch) == 0 { break }; ... }` — same shape, harder to grep.
- `for len(ch) == 0 { time.Sleep(... }` — polling for arrival, slightly different but related.

In review comments, refer to the decision tree above and recommend the appropriate primitive. Do not stop at "this is wrong" — show the refactor.

---

## Static Analysis and Lint Rules

You can build a `go/analysis` pass that flags any `len(ch)` where `ch` has a channel type, used in a `for` loop condition.

A simple `semgrep` rule:

```yaml
rules:
  - id: poll-len-of-channel
    message: |
      Polling len() on a channel is a race. Use sync.WaitGroup,
      a done channel, or context cancellation.
    patterns:
      - pattern: for len($CH) $OP $N { ... }
      - pattern-not: for len($CH) $OP $N { break }
    languages: [go]
    severity: ERROR
```

The `pattern-not` exempts the legitimate "drain the buffer then break" pattern, though even that is rare in good code.

A more nuanced staticcheck rule is harder because `len` has legitimate uses on channels: for instance, exposing in-flight metrics. Tag those with a comment so the lint stays narrow.

```go
// debug-only: len(ch) reported as a gauge, not used for synchronisation.
metrics.Gauge("queue.depth", float64(len(ch)))
```

---

## Self-Assessment

Answer without re-reading.

1. Define the formal race in `for len(ch) > 0 { time.Sleep(...) }` in one paragraph. Identify the missing happens-before edge.
2. Why does `-race` not catch this race?
3. Why is `runtime.Gosched()` insufficient to fix a polling loop?
4. When should you choose `errgroup` over `WaitGroup`?
5. What is the canonical "close after wait" pattern, and which problem does it solve?
6. Show a producer-consumer pair where neither side ever calls `len`.
7. Why must `Add` be called by the parent, not by the spawned goroutine?
8. What is the difference between `context.Done()` and a manually managed done channel?
9. Show a fan-out pattern with a concurrency limit.
10. How would you grep a repository for the anti-pattern in five minutes?

If any answer is shaky, re-read the relevant section.

---

## Summary

The wait-for-empty-channel anti-pattern is a logical race, not a memory race. The race detector cannot save you; sleeps cannot save you; locks cannot save you. The only fix is to switch the observable from "channel length" to "channel close" or "WaitGroup zero." The replacement primitives — `WaitGroup`, done channel, `context`, `errgroup`, close-and-range — cover every case. The migration is mechanical. The result is faster, cheaper, and correct.

At the senior level you will see the same patterns one layer deeper: ownership protocols, shutdown sequencing, structured concurrency, drain guarantees, semaphore-based bounding, and the API design that makes the anti-pattern impossible by construction. Go read `senior.md`.

---

## Appendix A: Reading the Go Memory Model Like a Specification

The Go memory model is a short document. Read it once a year. The wait-for-empty-channel anti-pattern is exactly the kind of bug it exists to prevent, and reading the spec end-to-end is the surest way to internalise why `len(ch)` is non-synchronising.

### Section by section

**Overview.** Defines "synchronized before" as the partial order that governs visibility. The key sentence: *"If event e1 is synchronized before event e2, then e1 happens before e2."* Polling is not in that order.

**Memory operations.** Distinguishes ordinary reads/writes, synchronizing operations, and atomic operations. `len(ch)` is an ordinary read. Channel send and receive are synchronizing.

**Channel communication.** The list of edges:

- A send on a channel is synchronized before the completion of the corresponding receive.
- The closing of a channel is synchronized before a receive that returns because the channel is closed.
- The k'th receive on a channel of capacity C is synchronized before the (k+C)'th send.

`len` appears in none of these. The third clause is interesting: it gives backpressure a happens-before edge. The first clause is the one that the close-and-range pattern uses; the second one is what the done channel pattern uses.

**Locks, Once, atomics.** Each defines its own happens-before edge. None of them link a non-channel operation to the channel's internal counter, which is what `len(ch)` reads.

**Incorrect synchronization.** The spec gives explicit examples of broken code. Read them. They illustrate the same shape as the wait-for-empty-channel pattern: assuming an operation is synchronizing when it is not.

### How to apply it in review

When you see a goroutine that depends on observing a value, ask: which happens-before edge guarantees that visibility? If you can name it (send/receive, channel close, mutex unlock, atomic store), the code is fine. If you cannot, the code is wrong, even if it works today.

This is the engineering practice that the wait-for-empty-channel anti-pattern violates. The polling loop has no edge. There is nothing to point to in the spec.

---

## Appendix B: Why Some Languages Have This Pattern And Go Does Not

In Java, `BlockingQueue.size()` is documented as "approximate" but is also a common synchronisation crutch. The Java memory model is more permissive than Go's, but the use of `size()` for completion detection is just as broken.

In Python, `Queue.empty()` returns a snapshot. The standard library actively warns against using it for synchronisation: "Because of multithreading/multiprocessing semantics, this is not reliable." Many Python programs use it anyway. The result is the same race.

In Rust, channel types in `std::sync::mpsc` deliberately omit a `len` method. The designers concluded that the only correct waits are "receive a value" and "the channel is closed." Programs that need the count must implement it explicitly with an atomic counter, which forces them to think about synchronisation.

Go falls between these. It exposes `len(ch)` and `cap(ch)`, primarily because the channel is a built-in type and those operators work on every built-in type. The exposure is for diagnostics. The community quickly learned not to use them for synchronisation, and the major lint suites flag the pattern. New code should never feature it.

### What Go could do differently

Some proposals over the years:

- Remove `len(ch)` entirely. Rejected — too disruptive, and the operator is useful for observability.
- Issue a vet warning. Rejected — too many false positives (gauge metrics, debug logging).
- Add a third-party staticcheck rule. Accepted by community; `SA4031` covers a related but narrower case. No mainline rule for the polling-loop shape.

For now the burden is on engineers to read code carefully. This subsection of the Roadmap is meant to make that easier.

---

## Appendix C: The Bounded Wait Helper

A common pattern: you want to wait for completion, but with a maximum duration. The naive shape:

```go
deadline := time.Now().Add(5 * time.Second)
for len(ch) > 0 && time.Now().Before(deadline) {
    time.Sleep(10 * time.Millisecond)
}
```

Wrong for the usual reasons. The correct shape uses `context.WithTimeout` and a done channel:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
select {
case <-done:
    // success
case <-ctx.Done():
    return ctx.Err()
}
```

The done channel is the thing being waited on. The context is the deadline. Combined with `select` they give bounded wait without any polling.

### What `WaitGroup` cannot do here

`WaitGroup.Wait()` does not accept a context. There is no `WaitWithTimeout`. To get bounded wait you must wrap it:

```go
func waitWithTimeout(wg *sync.WaitGroup, timeout time.Duration) error {
    done := make(chan struct{})
    go func() {
        wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-time.After(timeout):
        return errors.New("timeout")
    }
}
```

This helper is standard. Keep one in your project's `internal/syncx` package.

### What this helper does not do

If `Wait` times out, the goroutines are still running. The helper leaks the inner waiting goroutine until they finish. That is acceptable for shutdown-or-fail use cases but unacceptable for high-frequency calls. The correct architecture is to give the workers a cancellable context, so that on timeout you `cancel()` and the workers exit promptly.

```go
func waitWithCtx(wg *sync.WaitGroup, ctx context.Context) error {
    done := make(chan struct{})
    go func() {
        wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Pair this with workers that respect `ctx.Done()` and the leak goes away.

---

## Appendix D: Bridging Channels and Callbacks

Library authors sometimes expose a callback API:

```go
type Worker struct {
    OnComplete func()
}
```

If you receive a callback-based API and need to integrate it with the channel-based world, do not poll. Wrap the callback in a done channel:

```go
done := make(chan struct{})
w.OnComplete = func() { close(done) }
go w.Start()
<-done
```

Or, if there might be multiple completions:

```go
events := make(chan struct{}, 10)
w.OnComplete = func() { events <- struct{}{} }
go w.Start()
for range events {
    // act on each completion
}
```

The bridge is one line. Polling is never necessary.

---

## Appendix E: Common Mistaken Justifications

When you remove a `len(ch)` polling loop in review, you will hear pushback. The common justifications and the responses.

### "But it works in production."

It works *most of the time* in production. The remaining fraction is invisible because it manifests as data loss, not crashes. Ask for incident reports tagged with "missing" or "duplicate" — these are the symptoms of a polling race.

### "But the alternative is too verbose."

The alternative is three lines: `var wg sync.WaitGroup`, `wg.Add(1)`, `defer wg.Done()`. If those three lines are too verbose, the polling loop with its sleep and its drain logic is already more code.

### "But `WaitGroup` doesn't return results."

It does not have to. The results go through a channel. The WaitGroup confirms the channel can be closed.

### "But we benchmarked it and polling is faster."

Benchmark again with the race detector on, the context cancellation path exercised, and many concurrent invocations. The polling version is faster on a single-thread happy path. Under load it pegs a core, has worse latency, and drops requests. Show the on-call team the latency tail.

### "But the polling interval is short enough."

The shorter the interval, the higher the CPU cost. The longer the interval, the more inefficient the wakeup. The right interval does not exist; the right primitive does.

### "But we need to peek at queue depth."

That is a separate concern. Expose `len(ch)` as a metric. Use a WaitGroup for completion. Both can coexist.

---

## Appendix F: Worked Refactor — From 200-Line Worker to 50-Line errgroup

A realistic before-and-after of a small but complete codebase.

### Before

```go
package worker

import (
    "log"
    "sync/atomic"
    "time"
)

type Pool struct {
    jobs    chan Job
    workers int
    stopped int32
}

func NewPool(workers int, buf int) *Pool {
    return &Pool{
        jobs:    make(chan Job, buf),
        workers: workers,
    }
}

func (p *Pool) Submit(j Job) bool {
    if atomic.LoadInt32(&p.stopped) == 1 {
        return false
    }
    select {
    case p.jobs <- j:
        return true
    default:
        return false
    }
}

func (p *Pool) Start() {
    for i := 0; i < p.workers; i++ {
        go p.worker(i)
    }
}

func (p *Pool) worker(id int) {
    for {
        if atomic.LoadInt32(&p.stopped) == 1 && len(p.jobs) == 0 {
            return
        }
        select {
        case j := <-p.jobs:
            if err := j.Run(); err != nil {
                log.Println("worker", id, "error:", err)
            }
        default:
            time.Sleep(time.Millisecond)
        }
    }
}

func (p *Pool) Stop() {
    atomic.StoreInt32(&p.stopped, 1)
    for len(p.jobs) > 0 {
        time.Sleep(10 * time.Millisecond)
    }
}
```

Problems:

- The `len(p.jobs) == 0` check races with `j := <-p.jobs`.
- The `select`/`default` busy-loops with a 1 ms sleep — every worker burns CPU when idle.
- `Stop` polls `len(p.jobs)` — same race as the worker.
- Errors are logged but cannot be observed by the caller.
- There is no way to wait for graceful shutdown from outside.

### After

```go
package worker

import (
    "context"
    "log"

    "golang.org/x/sync/errgroup"
)

type Pool struct {
    g    *errgroup.Group
    ctx  context.Context
    jobs chan Job
}

func NewPool(parent context.Context, workers int, buf int) *Pool {
    g, ctx := errgroup.WithContext(parent)
    p := &Pool{
        g:    g,
        ctx:  ctx,
        jobs: make(chan Job, buf),
    }
    for i := 0; i < workers; i++ {
        i := i
        g.Go(func() error {
            return p.worker(i)
        })
    }
    return p
}

func (p *Pool) Submit(ctx context.Context, j Job) error {
    select {
    case <-p.ctx.Done():
        return p.ctx.Err()
    case <-ctx.Done():
        return ctx.Err()
    case p.jobs <- j:
        return nil
    }
}

func (p *Pool) worker(id int) error {
    for {
        select {
        case <-p.ctx.Done():
            return nil
        case j, ok := <-p.jobs:
            if !ok {
                return nil
            }
            if err := j.Run(p.ctx); err != nil {
                log.Println("worker", id, "error:", err)
            }
        }
    }
}

func (p *Pool) Close() error {
    close(p.jobs)
    return p.g.Wait()
}
```

Improvements:

- Submission is bounded by both the caller's context and the pool's context. Slow consumers do not silently drop.
- The worker has a single `select` — no polling, no sleeps, no `len`.
- `Close` closes the input channel, which causes workers to exit when the buffer empties.
- `g.Wait()` returns after every worker has finished. The pool's lifecycle is observable.
- The pool's context is the parent of the workers; cancelling it from outside cancels every job.

Line count dropped by 60%, behaviour is provably race-free under `-race -count=200`.

---

## Appendix G: API Design That Prevents the Anti-Pattern

The best fix for the wait-for-empty-channel anti-pattern is an API that makes the pattern impossible. Three techniques.

### Technique 1: hide the channel

If your package exposes a `chan T`, callers will write polling loops. If you expose an iterator method or a callback, they cannot.

```go
// Bad: callers can call len(p.Jobs())
func (p *Pool) Jobs() <-chan Job { return p.jobs }

// Good: callers iterate via your method
func (p *Pool) Each(ctx context.Context, fn func(Job) error) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case j, ok := <-p.jobs:
            if !ok {
                return nil
            }
            if err := fn(j); err != nil {
                return err
            }
        }
    }
}
```

The caller iterates, sees results, and never asks for the length.

### Technique 2: return a "completion" handle

```go
type Run struct {
    Done <-chan struct{}
    Err  func() error
}

func (s *Service) Start(ctx context.Context, items []Item) *Run {
    done := make(chan struct{})
    var err error
    go func() {
        defer close(done)
        err = s.process(ctx, items)
    }()
    return &Run{
        Done: done,
        Err:  func() error { return err },
    }
}
```

Callers select on `Done` and read `Err`. They cannot poll a length.

### Technique 3: use `sync.Cond` for "wait for state"

If you genuinely have a "wait until queue is empty" need (for instance, in a test helper), use `sync.Cond`. The condition variable broadcasts on every state change, and the waiter checks the predicate atomically with the mutex.

```go
type Queue struct {
    mu    sync.Mutex
    cond  *sync.Cond
    items []Item
}

func New() *Queue {
    q := &Queue{}
    q.cond = sync.NewCond(&q.mu)
    return q
}

func (q *Queue) Push(it Item) {
    q.mu.Lock()
    defer q.mu.Unlock()
    q.items = append(q.items, it)
    q.cond.Broadcast()
}

func (q *Queue) Pop() Item {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 {
        q.cond.Wait()
    }
    it := q.items[0]
    q.items = q.items[1:]
    q.cond.Broadcast()
    return it
}

func (q *Queue) WaitEmpty() {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) > 0 {
        q.cond.Wait()
    }
}
```

This is not the channel anti-pattern. The `len(q.items)` check is under the mutex, the wait is on the condition variable, and the predicate is re-checked atomically when the condition signals. It is the correct pattern for "wait for a predicate over shared state."

The catch: `sync.Cond` is harder to compose than a channel. You cannot `select` on it. For most cases, prefer channels.

---

## Appendix H: The Phantom Empty Channel

A subtle variant of the anti-pattern. The producer has finished. The consumer has read every item. The channel is empty. The consumer asks `len(ch) == 0` and concludes "I should stop."

Wrong: the producer may have closed the channel and the consumer should observe the close to know it is done. `len == 0` is true both for "drained, more to come" and "drained, closed forever." The two states differ in behaviour and must be distinguished.

```go
// Wrong: ambiguous
for {
    if len(ch) == 0 {
        return // is this "wait for more" or "stop"?
    }
    handle(<-ch)
}

// Right: range distinguishes
for x := range ch {
    handle(x)
}
return // we only get here when ch is closed AND empty
```

`range` is the universal disambiguator. It returns when the channel is closed and the buffer is empty. It blocks while waiting for either a value or a close. It is the right tool.

---

## Appendix I: Multi-Producer Multi-Consumer Without `len`

A pattern that produces the most "but we need to know when we're done" confusion. The right design:

```go
type Pipeline struct {
    in       chan Job
    out      chan Result
    producers sync.WaitGroup
    consumers sync.WaitGroup
}

func (p *Pipeline) StartProducer(ctx context.Context, src Source) {
    p.producers.Add(1)
    go func() {
        defer p.producers.Done()
        for j := range src.iterate(ctx) {
            select {
            case <-ctx.Done():
                return
            case p.in <- j:
            }
        }
    }()
}

func (p *Pipeline) StartConsumer(ctx context.Context) {
    p.consumers.Add(1)
    go func() {
        defer p.consumers.Done()
        for j := range p.in {
            r := process(ctx, j)
            select {
            case <-ctx.Done():
                return
            case p.out <- r:
            }
        }
    }()
}

func (p *Pipeline) Close(ctx context.Context) []Result {
    p.producers.Wait()
    close(p.in)
    p.consumers.Wait()
    close(p.out)
    var results []Result
    for r := range p.out {
        results = append(results, r)
    }
    return results
}
```

Two WaitGroups, two close operations, two ranges. No `len`. The close-after-wait pattern is applied twice. Any number of producers and consumers compose under this scheme.

---

## Appendix J: When You Really Do Need `len(ch)`

There are legitimate uses:

- **Metrics.** Expose `len(ch)` as a gauge so operators can see queue depth.
- **Backpressure decisions.** "If the queue is more than 80% full, return 429." This is a heuristic, not a synchronisation, and that is fine.
- **Tests.** "Assert that after N submissions, the queue depth equals N." Bounded race-free conditions exist in tests when sequencing is controlled.
- **Diagnostics.** "Log queue depth every five seconds for observability."

None of these are synchronisation. They use `len` for what it is: a snapshot.

The rule is: if the result of a `len(ch)` call influences whether the program proceeds correctly, it is the anti-pattern. If the result is informational and the program would be correct regardless, it is fine.

---

## Appendix K: Reviewer's Checklist

When you encounter a polling loop in review, walk this list.

1. Are there multiple goroutines reading and writing to the channel? If so, polling is racy.
2. Does the polling loop have a sleep? If so, it is wasting CPU.
3. Does the polling loop have no sleep? If so, it is pegging a core.
4. Is there a `WaitGroup` available? If so, replace polling with `wg.Wait()`.
5. Is the producer's close already in place? If so, replace polling with `for x := range ch`.
6. Is the work cancellable? If so, replace polling with `select` on `ctx.Done()`.
7. Are errors propagated? If not, recommend `errgroup`.
8. Are tests covering the refactor's race-freedom? If not, ask for them.
9. Is the new code observable? Does it expose metrics for queue depth, throughput, errors?
10. Does the public API expose a channel that callers might poll? If so, recommend hiding it.

If you can answer all ten, the refactor is complete.

---

## Appendix L: Putting It All Together

A final integrated example: a small CLI that downloads a list of URLs concurrently, with a bounded concurrency limit, context cancellation, error propagation, and no polling.

```go
package main

import (
    "context"
    "fmt"
    "io"
    "log"
    "net/http"
    "os"
    "os/signal"
    "sync"
    "syscall"
    "time"

    "golang.org/x/sync/errgroup"
)

func main() {
    ctx, cancel := signal.NotifyContext(
        context.Background(),
        os.Interrupt, syscall.SIGTERM,
    )
    defer cancel()

    urls := []string{
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
    }

    results, err := download(ctx, urls, 4)
    if err != nil {
        log.Fatal(err)
    }
    for url, size := range results {
        fmt.Printf("%s -> %d bytes\n", url, size)
    }
}

type result struct {
    url  string
    size int64
}

func download(parent context.Context, urls []string, limit int) (map[string]int64, error) {
    g, ctx := errgroup.WithContext(parent)
    out := make(chan result)
    sem := make(chan struct{}, limit)

    var mu sync.Mutex
    results := make(map[string]int64, len(urls))

    g.Go(func() error {
        for r := range out {
            mu.Lock()
            results[r.url] = r.size
            mu.Unlock()
        }
        return nil
    })

    var wg sync.WaitGroup
    for _, u := range urls {
        u := u
        wg.Add(1)
        sem <- struct{}{}
        g.Go(func() error {
            defer wg.Done()
            defer func() { <-sem }()
            size, err := fetch(ctx, u)
            if err != nil {
                return fmt.Errorf("%s: %w", u, err)
            }
            select {
            case <-ctx.Done():
                return ctx.Err()
            case out <- result{u, size}:
                return nil
            }
        })
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}

func fetch(ctx context.Context, url string) (int64, error) {
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return 0, err
    }
    client := &http.Client{Timeout: 30 * time.Second}
    resp, err := client.Do(req)
    if err != nil {
        return 0, err
    }
    defer resp.Body.Close()
    return io.Copy(io.Discard, resp.Body)
}
```

Every primitive shows up:

- `signal.NotifyContext` for Ctrl-C handling.
- `errgroup.WithContext` for error propagation and cancellation.
- A semaphore channel for bounded concurrency.
- A separate `WaitGroup` to know when to close the `out` channel.
- A close-after-wait goroutine for the collector to terminate cleanly.
- Every blocking operation respects `ctx.Done()`.
- No `len`. No `time.Sleep`. No polling.

This is the shape your production code should reach. The senior file goes further into structured shutdown, ownership, drains, and supervision; the professional file goes into observability and operational concerns. But the architectural foundation is exactly what this example shows.

---

## Closing Note

Programmers who try to "wait for the channel to be empty" are usually expressing a real requirement: *I want to know when the work is finished.* The bug is in the mapping from requirement to code. The channel's emptiness is not the answer; the work's completion is. Go gives you four explicit ways to detect completion and zero implicit ones. Use the explicit ones, every time, without exception.

If you came here trying to debug a flaky test, you found the source. If you came here writing new code, you now know which primitives to reach for. If you came here doing review, you have a checklist and a vocabulary. The senior file picks up where this one ends.

---

## Appendix M: Detailed Walk-Through of `errgroup` Internals

Many engineers use `errgroup` without reading its source. Doing so makes the package less mysterious and reveals exactly why it solves the anti-pattern.

The current implementation is roughly:

```go
type Group struct {
    cancel  func(error)
    wg      sync.WaitGroup
    sem     chan token
    errOnce sync.Once
    err     error
}

type token struct{}

func WithContext(ctx context.Context) (*Group, context.Context) {
    ctx, cancel := context.WithCancelCause(ctx)
    return &Group{cancel: cancel}, ctx
}

func (g *Group) Go(f func() error) {
    if g.sem != nil {
        g.sem <- token{}
    }
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        defer func() {
            if g.sem != nil {
                <-g.sem
            }
        }()
        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil {
                    g.cancel(err)
                }
            })
        }
    }()
}

func (g *Group) Wait() error {
    g.wg.Wait()
    if g.cancel != nil {
        g.cancel(g.err)
    }
    return g.err
}
```

Key observations:

1. `Add(1)` happens in the parent's goroutine before the child is spawned. No "Add inside goroutine" race.
2. `Done()` is deferred so a panic does not strand the counter.
3. `errOnce.Do` ensures the first error is the canonical one and that `cancel` runs exactly once.
4. `Wait` blocks on the WaitGroup, then cancels the context as a final cleanup (so timers from `WithTimeout` are released).
5. The optional semaphore (`SetLimit`) is implemented with a buffered channel of `token{}` (zero-size structs), exactly like the manual semaphore pattern.

None of these uses `len`. The whole package is a careful composition of WaitGroup, channel-send, and context. Internalising this design is the difference between using `errgroup` as a black box and understanding when it is or is not the right tool.

---

## Appendix N: Performance Profile of a Polling Loop

When a polling loop runs, what does `pprof` show?

```
$ go test -bench BenchmarkPolling -cpuprofile=cpu.out
$ go tool pprof cpu.out
(pprof) top10
Showing nodes accounting for 30.05s, 99.31% of 30.26s total
      flat  flat%   sum%        cum   cum%
    21.50s 71.05% 71.05%     21.50s 71.05%  runtime.chanlen
     5.10s 16.85% 87.90%      5.10s 16.85%  runtime.findfunc
     2.45s  8.09% 95.99%      3.05s 10.08%  sync/atomic.(*Int64).Load
     1.00s  3.30% 99.29%      1.00s  3.30%  runtime.gopark
```

The CPU is dominated by `runtime.chanlen`. That is the polling. In the event-driven version:

```
(pprof) top10
Showing nodes accounting for 1.20s, 100% of 1.20s total
      flat  flat%   sum%        cum   cum%
     0.80s 66.67% 66.67%      0.80s 66.67%  runtime.gopark
     0.20s 16.67% 83.34%      0.20s 16.67%  runtime.chanrecv
     0.10s  8.33% 91.67%      0.10s  8.33%  runtime.semacquire
     0.10s  8.33%   100%      0.10s  8.33%  runtime.goready
```

`gopark` is the scheduler putting goroutines to sleep. That is what an idle program should do. Total CPU is 25× lower than the polling version.

For an entire production service, that 25× often translates into "one fewer pod per region." The cost saving is real.

---

## Appendix O: Edge Cases of Close-and-Range

Even the close-and-range pattern has corner cases worth knowing.

### Edge case 1: closing a channel with senders blocked

```go
ch := make(chan int)
go func() { ch <- 1 }() // blocks waiting for a receiver
close(ch) // PANIC: send on closed channel
```

The send goroutine panics when the channel closes. Rule: close only after every sender has finished. Use a WaitGroup to wait for senders, then close.

### Edge case 2: closing twice

```go
close(ch)
close(ch) // PANIC: close of closed channel
```

Use `sync.Once` if multiple sites might close.

### Edge case 3: closing a nil channel

```go
var ch chan int
close(ch) // PANIC: close of nil channel
```

Initialise channels before closing them.

### Edge case 4: nil receive in a select

```go
var ch chan int
select {
case <-ch: // never selected, ch is nil
case <-time.After(1 * time.Second):
}
```

Receiving from a nil channel blocks forever. This is sometimes useful: setting a channel to nil in a select disables that case.

### Edge case 5: range on a closed-then-reopened channel

You cannot reopen a channel. Once closed, it stays closed. The only way to "reset" is to make a new channel.

```go
ch = make(chan int)
```

This rebinding may or may not be visible to other goroutines, depending on synchronisation. Most production code does not do this; it creates a new channel per phase and avoids reuse.

---

## Appendix P: When the Buffer Size Matters

A common worry: "If I use an unbuffered channel and replace polling, my code deadlocks." Sometimes true. The fix is usually a small buffer.

### When unbuffered is fine

If the producer and consumer are both event-driven (selecting on multiple channels), an unbuffered channel works. The send blocks until a receiver is ready, which is exactly the synchronisation you want.

```go
ch := make(chan int)
go func() {
    for x := range source {
        ch <- x
    }
    close(ch)
}()
for v := range ch {
    handle(v)
}
```

No buffer, no `len`, no race. The producer cannot get ahead of the consumer, which is often desirable for backpressure.

### When a buffer helps

If the producer is bursty and the consumer is steady, a small buffer absorbs the bursts and reduces context switches.

```go
ch := make(chan int, 64)
```

Choosing the size is empirical. Start with `runtime.NumCPU()` and adjust based on profiling.

### When a buffer hurts

Large buffers create the illusion that the system is keeping up. The buffer fills, latency rises silently, then the system collapses. Prefer small buffers and visible backpressure to large buffers and hidden lag.

### Why this matters here

The wait-for-empty-channel pattern is often *introduced* because someone added a large buffer and then needed to wait for it to drain. The polling loop is the symptom; the oversized buffer is part of the cause. Smaller buffers usually need no draining at all — the consumer is already at the next message.

---

## Appendix Q: Quick Reference Card

Print this and stick it on your monitor.

```
NEVER:
  for len(ch) > 0 { ... }
  for len(ch) == 0 { ... }
  if len(ch) == cap(ch) { ... }
  for {
      if len(ch) == 0 { break }
      ...
  }

ALWAYS PREFER:
  for x := range ch { ... }         // ranged receive
  <-done                            // simple wait
  wg.Wait()                         // wait for N
  g.Wait()                          // errgroup
  select {                          // composable
  case <-ctx.Done():
  case x := <-ch:
  }

WHO CLOSES:
  one producer:  the producer
  many producers, one consumer:
      wg + close in a coordinator
  many producers, many consumers:
      same; consumers use `range`

CANCELLATION:
  always derive a context
  always pass it as the first arg
  always defer cancel()
  goroutines must select on ctx.Done()

ERRORS:
  errgroup.Go for first-error semantics
  manual error channel for collect-all
```

If your code violates the NEVER list, refactor to the ALWAYS list. There are no exceptions.

---

## Appendix R: Glossary of Sync Terms

- **Happens-before**: the partial order over memory operations that the memory model guarantees. The basis of "this write will be visible to that read."
- **Synchronizing operation**: an operation (channel send/receive/close, mutex lock/unlock, atomic operations) that establishes happens-before edges.
- **Race condition**: any state where the program's correctness depends on the relative timing of operations that are not happens-before ordered.
- **Data race**: a specific subset of race conditions where two goroutines access the same memory and at least one is a write, without happens-before ordering. Detected by `-race`.
- **Logic race**: a race condition that is not a data race. Polling `len(ch)` is a logic race; the race detector does not catch it.
- **Done channel**: a `chan struct{}` whose closure signals completion.
- **Drain**: the act of removing items from a channel until it is empty and closed.
- **Backpressure**: a flow-control mechanism where slow consumers cause producers to slow down.
- **Cancellation**: an explicit signal to stop work, typically via `context.Done()`.
- **Structured concurrency**: a design where every goroutine's lifetime is bounded by an enclosing scope.

This vocabulary should let you read this file, the senior file, the professional file, and the specification file without ambiguity.

---

## Appendix S: Twelve Worked Refactors

A long sequence of small refactors. Each is a real shape we have seen in code review. Read them sequentially; each adds one new wrinkle.

### Refactor 1: simple polling drain

Before:

```go
func wait(ch <-chan int) {
    for len(ch) > 0 {
        time.Sleep(time.Millisecond)
    }
}
```

After:

```go
func wait(ch <-chan int) {
    for range ch {
    }
}
```

Caller must close the channel. If they did not, the original code never terminated correctly either; now it terminates only on close, which is the correct semantic.

### Refactor 2: drain with side effect

Before:

```go
for len(ch) > 0 {
    x := <-ch
    handle(x)
}
```

After:

```go
for x := range ch {
    handle(x)
}
```

Same fix.

### Refactor 3: polling completion of an unrelated channel

Before:

```go
go work(jobs)
for len(jobs) > 0 {
    time.Sleep(time.Millisecond)
}
log.Println("done")
```

After:

```go
done := make(chan struct{})
go func() {
    defer close(done)
    work(jobs)
}()
<-done
log.Println("done")
```

The completion of `work` is now the synchronisation point, not the queue depth.

### Refactor 4: many workers, polling for completion

Before:

```go
for i := 0; i < 8; i++ {
    go worker(jobs)
}
for len(jobs) > 0 {
    time.Sleep(time.Millisecond)
}
```

After:

```go
var wg sync.WaitGroup
for i := 0; i < 8; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        worker(jobs)
    }()
}
wg.Wait()
```

Workers must exit on their own. Usually that means `for j := range jobs { ... }` inside `worker`, with the producer closing `jobs`.

### Refactor 5: polling with backoff

Before:

```go
backoff := time.Millisecond
for len(ch) > 0 {
    time.Sleep(backoff)
    if backoff < time.Second {
        backoff *= 2
    }
}
```

After:

```go
<-done
```

The backoff is a complication that hides the bug. Remove it; use a done channel.

### Refactor 6: polling with deadline

Before:

```go
deadline := time.Now().Add(5 * time.Second)
for len(ch) > 0 && time.Now().Before(deadline) {
    time.Sleep(time.Millisecond)
}
```

After:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
select {
case <-done:
case <-ctx.Done():
}
```

### Refactor 7: polling with error return

Before:

```go
for len(ch) > 0 {
    time.Sleep(time.Millisecond)
    if err := check(); err != nil {
        return err
    }
}
```

After:

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error {
    defer close(done)
    return run(ctx)
})
if err := g.Wait(); err != nil {
    return err
}
```

`errgroup` collects the first error and cancels the rest.

### Refactor 8: nested polling

Before:

```go
for len(jobs) > 0 {
    for len(results) > 0 {
        process(<-results)
    }
    time.Sleep(time.Millisecond)
}
```

After:

```go
go func() {
    defer close(results)
    for j := range jobs {
        results <- process(j)
    }
}()
for r := range results {
    handle(r)
}
```

Two channels, both ranged, no polling.

### Refactor 9: polling with cap check

Before:

```go
for len(ch) == cap(ch) {
    time.Sleep(time.Millisecond) // wait for room
}
ch <- value
```

After:

```go
select {
case ch <- value:
case <-ctx.Done():
    return ctx.Err()
}
```

A `select` with a context handles "wait for room and respect cancellation."

### Refactor 10: polling for non-empty

Before:

```go
for len(ch) == 0 {
    time.Sleep(time.Millisecond)
}
v := <-ch
```

After:

```go
v := <-ch
```

The receive blocks. That is the entire purpose of the channel. The polling is redundant.

### Refactor 11: polling inside a select default

Before:

```go
for {
    select {
    case x := <-in:
        handle(x)
    default:
        if len(in) == 0 {
            return
        }
        time.Sleep(time.Millisecond)
    }
}
```

After:

```go
for x := range in {
    handle(x)
}
```

The `select`/`default` was constructed to "check for work, otherwise sleep" — which is exactly what `range` does, without the polling.

### Refactor 12: polling for sub-tree completion

Before:

```go
for {
    n := 0
    for _, c := range children {
        n += len(c.jobs)
    }
    if n == 0 {
        return
    }
    time.Sleep(time.Millisecond)
}
```

After:

```go
var wg sync.WaitGroup
for _, c := range children {
    wg.Add(1)
    go func(c *child) {
        defer wg.Done()
        c.run()
    }(c)
}
wg.Wait()
```

Each child reports its own completion via WaitGroup. The parent waits on the aggregate.

---

## Appendix T: Anti-Pattern in Test Helpers

A common place where polling sneaks in is test helpers. "Wait until the queue is empty" tests are everywhere.

### Before

```go
func waitForEmpty(t *testing.T, ch <-chan job) {
    deadline := time.Now().Add(2 * time.Second)
    for len(ch) > 0 {
        if time.Now().After(deadline) {
            t.Fatal("queue not empty after 2s")
        }
        time.Sleep(10 * time.Millisecond)
    }
}
```

This is the anti-pattern with test-ish framing. It is still wrong.

### After

The right approach exposes a completion handle from the system under test.

```go
type Worker struct {
    in   chan job
    done chan struct{}
}

func (w *Worker) Run() {
    defer close(w.done)
    for j := range w.in {
        process(j)
    }
}

// In the test:
close(w.in)
select {
case <-w.done:
case <-time.After(2 * time.Second):
    t.Fatal("worker did not finish in 2s")
}
```

The test does not poll; it waits on `done` with a bounded timeout. The system under test makes the wait possible by closing `done` exactly when it has finished.

### When the system under test cannot expose `done`

Some legacy systems do not have a clean way to expose completion. The minimal modification is to add it. If you cannot, use `sync.Cond` with the underlying state, not `len`. As a last resort, use a polling loop with a long-enough timeout — but document it as "this is a workaround for a missing completion signal" and file a ticket to fix the system.

---

## Appendix U: Anti-Pattern in HTTP Handlers

Web handlers sometimes contain polling because the handler must wait for background work to finish before responding.

### Before

```go
func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {
    s.queue <- request{r}
    for len(s.queue) > 0 {
        time.Sleep(time.Millisecond)
    }
    w.Write([]byte("done"))
}
```

This is wrong on multiple levels: the handler does not know whether *its* request finished, only that the queue is empty. Two concurrent handlers see each other's queue depth and produce mixed-up responses.

### After

Per-request completion via a result channel:

```go
type request struct {
    r    *http.Request
    done chan struct{}
}

func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {
    req := request{r, make(chan struct{})}
    s.queue <- req
    select {
    case <-req.done:
        w.Write([]byte("done"))
    case <-r.Context().Done():
        http.Error(w, "cancelled", 499)
    }
}

func (s *Server) worker() {
    for req := range s.queue {
        process(req.r)
        close(req.done)
    }
}
```

Each request gets its own done channel. The handler waits on *its own* completion, not on a queue-wide observable. Context cancellation aborts cleanly.

---

## Appendix V: Anti-Pattern in Cleanup Code

The "I want to wait for everything to finish before I exit" need is most common in shutdown code.

### Before

```go
func (s *Service) Shutdown() {
    close(s.stop)
    for len(s.jobs) > 0 {
        time.Sleep(10 * time.Millisecond)
    }
}
```

The stop channel tells workers to stop pulling new jobs. The polling tries to wait until they are done. But `len(s.jobs)` doesn't tell you how many workers are still processing what they pulled before stopping.

### After

WaitGroup makes shutdown deterministic:

```go
func (s *Service) Run(ctx context.Context) error {
    for i := 0; i < s.workers; i++ {
        s.wg.Add(1)
        go s.worker(ctx)
    }
    <-ctx.Done()
    s.wg.Wait()
    return nil
}

func (s *Service) worker(ctx context.Context) {
    defer s.wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-s.jobs:
            process(j)
        }
    }
}
```

`Run` returns when (a) the context cancels and (b) every worker observes the cancellation and exits. There is no polling, and "shutdown complete" is the WaitGroup reaching zero.

---

## Appendix W: Anti-Pattern in Producer Cleanup

Sometimes the producer wants to "wait for the queue to be processed" before adding more.

### Before

```go
for _, batch := range batches {
    for _, item := range batch {
        ch <- item
    }
    for len(ch) > 0 {
        time.Sleep(time.Millisecond)
    }
}
```

The intent is "process batch 1 fully before sending batch 2." The polling is wrong; consumers may have read items but be mid-process.

### After

Per-batch completion via WaitGroup:

```go
for _, batch := range batches {
    var wg sync.WaitGroup
    wg.Add(len(batch))
    for _, item := range batch {
        item := item
        go func() {
            defer wg.Done()
            handle(item)
        }()
    }
    wg.Wait()
}
```

Or per-batch with workers and a barrier:

```go
for _, batch := range batches {
    var wg sync.WaitGroup
    for _, item := range batch {
        wg.Add(1)
        ch <- workItem{item, &wg}
    }
    wg.Wait()
}

// worker:
for w := range ch {
    handle(w.item)
    w.wg.Done()
}
```

The `*sync.WaitGroup` rides along with the work item so the producer can wait on exactly the batch it submitted.

---

## Appendix X: Common Counter-Examples Engineers Bring Up

When you push the rule "never poll `len(ch)`," someone will produce a counter-example. Walk through the four most common.

### Counter-example 1: "The race is impossible because of my locking."

```go
mu.Lock()
ch <- v
mu.Unlock()

// ...

mu.Lock()
n := len(ch)
mu.Unlock()
if n == 0 { ... }
```

The mutex protects writes to a shared variable, but not channel state. Send/receive on the channel already serialises through the channel's internal lock. Wrapping `len` in your own mutex tells your code "I observed the channel under my mutex" but says nothing about ordering with another goroutine's send. The race is the same.

### Counter-example 2: "The race is impossible because there is only one consumer."

```go
var v int
go func() { ch <- 1 }()
for len(ch) == 0 {
}
v = <-ch
```

With one consumer the receive cannot race with another receive. But the *polling read* still races with the sender. On a weak-memory CPU you can see `len == 0` indefinitely. In practice you do not, because the channel mutex usually publishes the new count quickly. "Usually" is not "always."

### Counter-example 3: "The race is benign — we don't care about the missed value."

```go
for len(ch) > 0 {
    handle(<-ch)
}
```

The handler runs only on values that exist when `len` is read. If a value arrives after the loop exits, the handler does not run on it. If the program does not need every value handled, this is acceptable... isn't it?

Maybe, but the program now has *non-deterministic semantics*: the same input can produce different outputs depending on scheduler timing. That is rarely what anyone wants. If the program does not need every value, formalise it: receive with a timeout, or close after a deadline. Do not rely on the race.

### Counter-example 4: "We've used this for years and it's never broken."

It has broken. You have not seen the symptoms because they manifest as missing data or incorrect counts, not crashes. Audit the last year of incident reports for "wrong count," "missing entry," or "duplicate." The polling loop is in the call stack of half of them.

---

## Appendix Y: The Final Self-Audit

When you are about to ship code that involves channels, ask yourself:

1. Every `len(ch)` call I make: is it for diagnostics only? Could the program proceed correctly if it returned a different number? If no to either, refactor.
2. Every goroutine I spawn: who waits for it? Where is the `wg.Done` or the `g.Go`? If no one waits, where does it exit?
3. Every channel I create: who closes it? Document the answer in a comment if not obvious.
4. Every `for { }` loop in a goroutine: does it select on `ctx.Done()`? If not, it cannot be cancelled.
5. Every `time.Sleep` in a goroutine: what event is it waiting for? Is there a channel I could `select` on instead?
6. Every test for concurrent code: does it run with `-race`? Does it run with `-count=N` for some N≥20?

A "yes" or a justification to every question. If you cannot justify, fix. This is the discipline that keeps wait-for-empty-channel out of your codebase.

---

The senior file goes deeper into ownership, drain protocols, semaphores, and the design of APIs that make the anti-pattern syntactically impossible. The professional file covers operational concerns: graceful shutdown, observability, supervision, and migration strategies. Either is a logical next step depending on your immediate need.



