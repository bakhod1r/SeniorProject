# Goroutine Lifecycle — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
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
> Focus: "What does a goroutine do between `go f()` and disappearing? What state is it in right now, and what will end it?"

Every goroutine you start has a life. It is born when the runtime allocates a small struct for it, it spends time *runnable* in a queue, *running* on a CPU, or *waiting* for a channel, a mutex, or I/O. Eventually it dies — either because its function returned, because it called `runtime.Goexit`, or because the whole program shut down. That sequence is what we call the **goroutine lifecycle**.

Why care? Because most concurrency bugs in Go are lifecycle bugs:

- A goroutine that is *born but never dies* is a leak.
- A goroutine *waiting forever* is a leak that also pins memory.
- A goroutine that *dies too early* drops work on the floor.
- A goroutine *born inside a request* but *not joined to the request's lifetime* is the classic source of "phantom" traffic, double sends, and resource exhaustion.

The Go runtime tracks every goroutine in a small struct called `g` (see `runtime/runtime2.go` if you are curious). It walks each `g` through states like *runnable*, *running*, *waiting*, *syscall*, and finally *dead*. You will see the names of those states again — `_Grunnable`, `_Grunning`, `_Gwaiting`, `_Gsyscall`, `_Gdead` — at higher levels of this section.

After reading this file you will:

- Know the five main states a goroutine can be in, and what causes each transition
- Understand the three ways a goroutine can die (return, `Goexit`, panic)
- Know what the runtime does with a dead goroutine (it does not "free" it immediately)
- Be able to answer "when will this goroutine end?" for code you write
- Recognize the smell of a leak when you read code
- Use `runtime.NumGoroutine`, `pprof goroutine`, and `runtime/trace` to see lifecycle in action
- Distinguish "the goroutine is paused" (waiting) from "the goroutine is done" (dead)

You do not need to read runtime source code, understand the scheduler, or know what `gopark` does — those come at middle, senior, and professional levels.

---

## Prerequisites

- **Required:** Comfort with starting a goroutine using `go f()`. If `go` still feels new, read [`01-goroutines/01-overview`](../../01-goroutines/01-overview/) first.
- **Required:** Familiarity with `sync.WaitGroup` and basic channel send/receive (`ch <- x`, `<-ch`).
- **Required:** Ability to read a stack trace. A goroutine leak shows itself as a list of stack traces in `pprof` or in panic output.
- **Helpful:** Understanding of `defer`. Lifecycle and `defer` are tightly linked — a deferred function runs when the goroutine is exiting.
- **Helpful:** Awareness that `context.Context` exists. Lifecycle control is the main reason it does.

If you can write `go func() { ch <- compute() }()`, read the result, and understand what `defer` does, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Lifecycle** | The sequence of states a goroutine passes through from creation to death. |
| **`go f()`** | The Go statement that creates a new goroutine. It returns immediately; `f` runs separately. |
| **Goroutine birth** | The moment the runtime allocates (or reuses) a `g` struct and places it on a run queue. Triggered by `go f()`. |
| **Goroutine death** | The moment the runtime marks the `g` as `_Gdead` and recycles it for future use. |
| **Runnable** | A goroutine that *could* run if a CPU were available. It is sitting in a queue. |
| **Running** | A goroutine that is currently executing instructions on an OS thread. |
| **Waiting / Blocked** | A goroutine that is parked on a channel, mutex, system call, network read, sleep, or other event. It is not consuming CPU. |
| **Dead** | A goroutine whose function has returned. The runtime keeps the `g` struct around for reuse. |
| **`runtime.Goexit`** | Function that causes the current goroutine to exit cleanly, running all `defer`-ed functions on the way out. |
| **Goroutine leak** | A goroutine that should have ended but is still alive (usually stuck waiting forever). |
| **`pprof` goroutine profile** | A snapshot of every live goroutine in the process, with stack trace. The first tool for diagnosing leaks. |
| **Creator stack** | Where the `go f()` statement was written. `pprof` records this for every live goroutine. |
| **`g` struct** | The runtime's per-goroutine bookkeeping. Holds stack pointers, state, defer chain, channel wait info. |
| **`runtime/trace`** | Built-in tracing tool that records every state transition with timestamps. |

---

## Core Concepts

### A goroutine is always in exactly one state

At any single moment, every live goroutine in your program is in exactly one of a handful of states. The most common ones, in plain English:

- **Runnable** — ready, waiting for a CPU.
- **Running** — currently executing on an OS thread.
- **Waiting** — parked on something: a channel send/receive, a mutex, a `time.Sleep`, a network read, a `select`, a `WaitGroup`, or a system call.
- **Dead** — its function has returned and there is nothing more to do.

There are a few additional states only visible from inside the runtime (`_Gidle`, `_Gsyscall`, `_Gcopystack`, `_Gpreempted`), but those four are enough to reason about every Go program you will ever write.

### Birth: `go f()` is more than syntax

When you write `go f()`, the compiler turns it into a call to `runtime.newproc`. That call:

1. Captures the arguments to `f` (copying them so they cannot be changed underneath the new goroutine).
2. Asks the runtime for a fresh `g` struct — either a recycled one from the free list or a newly allocated one.
3. Allocates a small stack for it (around 2 KB initially).
4. Marks the `g` as `_Grunnable` and pushes it onto a run queue.
5. Returns to the caller immediately. The new goroutine has not necessarily started yet.

There is no thread creation here. The `g` is just data. It might run microseconds later on a different OS thread than its creator, or it might wait in the queue for a while.

### Death: three doors out

A goroutine can leave the world in exactly three ways. There is no fourth.

1. **The function returns.** This is the normal case. `f` finishes, `goexit` is called implicitly, and the runtime marks the `g` as dead.
2. **`runtime.Goexit` is called.** This unwinds the stack, runs every deferred function, and exits — like a return, but from anywhere, not just the top frame. It does *not* panic.
3. **An unrecovered panic propagates out.** The goroutine prints a stack trace and — if it is *any* goroutine, not just main — terminates the entire process. There is no per-goroutine "die with error" path.

Note that "the program exits" is not really a fourth way. When `main` returns, the whole process disappears, and every goroutine evaporates along with it. From the OS's perspective they are killed without ceremony. From the runtime's perspective they were never given a chance to clean up.

### Waiting is not dying

A goroutine that is blocked on a channel, a mutex, or a network read is still alive. Its `g` struct exists, its stack exists, its closures and local variables are pinned. The garbage collector cannot reclaim anything it points to.

This is the crucial distinction between "paused" and "finished," and it is where leaks live. A goroutine waiting on a channel that will *never* receive a value is alive forever — but is doing nothing useful. The runtime cannot know that the channel will never receive. From its point of view, the goroutine is in the same state as any other waiter, indistinguishable from a healthy one.

### The `g` struct is recycled

When a goroutine dies, the runtime does *not* immediately free the `g` struct. Instead, it places it on a per-P (per-processor) free list called `gFree`. The next call to `go f()` may grab a `g` from that list rather than allocating a new one. This is why your `runtime.NumGoroutine()` may not drop to 1 immediately after all your workers finish — the live count drops, but the struct itself sticks around until it is reused (or, eventually, freed by a sweep).

### "When will this goroutine end?" must have an answer

The single most useful question to ask, every time you write `go ...`, is: *what makes this goroutine return?* If you cannot answer in one sentence, your code has a latent leak. Examples of good answers:

- "When `ch` is closed."
- "When `ctx` is canceled."
- "After the `for range` over `jobs` ends, which is when the caller closes `jobs`."
- "After `body()` returns, which is bounded by an HTTP request timeout."

Examples of bad answers:

- "Eventually."
- "When the program shuts down."
- "Whenever the work is done." (without saying who decides the work is done)

The middle and senior levels formalize this into ownership and structured concurrency.

---

## Real-World Analogies

### A goroutine is a hired courier

You hire a courier (`go fetch(url)`). The courier is *born* the moment you sign the contract, and they go *runnable* — standing in the dispatcher's queue. When their number comes up, they go *running* — riding to the address. If the door is locked, they wait — that is the *waiting* state. Eventually they return, hand you the package, and the contract is over: *dead*. If you never read the receipt they hand you, they are still considered fulfilled — but if you never *accept the delivery* (a buffered receive), they wait forever on your doorstep. That is the leak.

### A goroutine is a long-distance phone call

Dialing the number = `go f()`. The call is *running* while you're talking. If you put it on hold, it is *waiting*. Hanging up = the function returns. A leaked goroutine is the call you left on hold and never came back to — your phone bill keeps running and the other party is still on the line.

### A goroutine is a thread of music

A note plays (running), then rests (waiting on a channel), then plays again, then ends (dead). The whole song is the lifecycle. A leak is the note that never resolved — you never get to silence.

### The `g` free list is a parking lot

When a goroutine dies, its `g` struct does not go to the junkyard. It goes to a parking lot near the P (the per-CPU scheduler unit). The next `go f()` looks in the parking lot first. Reuse, not free. This is why "create one million goroutines, kill them, create another million" is much cheaper than "create one million from scratch."

---

## Mental Models

### Model 1: Two ledger entries — birth and death

For every `go f()` you write, picture two ledger lines: one *birth* and one *death*. If you cannot point at the line of code that causes the death, your program does not balance.

### Model 2: A state machine, not a control flow

The goroutine's lifecycle is a state machine controlled by the runtime, not by your code. Your code triggers transitions (`<-ch` triggers Running → Waiting; the value arriving triggers Waiting → Runnable), but the runtime does the actual bookkeeping. Reading `pprof` output is reading the state machine's current state for every goroutine.

### Model 3: Dead does not mean garbage-collected

A dead goroutine's `g` struct is alive in the runtime free list. The stack memory may also be retained for reuse. "Dead" is a runtime label, not a memory-management one. Memory pressure comes from *live* goroutines, especially waiting ones, because their stacks and closures are pinned.

### Model 4: Waiting goroutines are silent debt

Every goroutine in `_Gwaiting` is silent debt: it consumes memory and pins references, but it does no work. A healthy program has a *small, bounded, predictable* set of waiting goroutines. A leaking program has waiting goroutines that grow without bound.

### Model 5: The `go` statement is a *promise* to spawn, not a guarantee to run

When you write `go f()`, you have *promised* to start `f` eventually. You have not *guaranteed* that `f` will start before the next line of your code runs. The runtime may schedule it now, in a microsecond, or never (if the program exits first).

---

## Pros & Cons

### Pros of having an explicit lifecycle model

- **Bugs become visible.** If every goroutine has an answer to "when does this end?", you can audit your code in code review.
- **`pprof` reads naturally.** When a goroutine state is "waiting on chan receive", you can immediately ask, "what was supposed to send?"
- **Concurrency tests become writable.** You can assert "after `Stop()` returns, `runtime.NumGoroutine` equals the baseline" instead of using `time.Sleep`.
- **Resource accounting becomes possible.** Each goroutine pins a fixed cost; tracking goroutine count is a proxy for resource use.

### Cons / Costs

- **You have to think about it.** Most other concurrent runtimes do not require this; you can spawn a thread and let it die. In Go, you must plan exit.
- **No first-class "kill" primitive.** Once a goroutine is alive, you cannot stop it from outside — you must cooperate via channels or `context.Context`.
- **The "no goroutine ID" rule is awkward.** Tracking a specific goroutine for logging or correlation is non-trivial.
- **Error reporting is per-goroutine.** A return value from `f` evaporates with the goroutine. You must explicitly funnel results out.

---

## Use Cases

| Scenario | Lifecycle question to answer |
|---|---|
| Background worker in a long-running daemon | "How does this goroutine learn the daemon is shutting down?" — answer: `ctx.Done()` |
| Per-request goroutine inside an HTTP handler | "When the request returns, does the goroutine return too?" — answer: tie it to the request `context.Context` |
| Pipeline stage between two channels | "When does the input channel close, and does the goroutine return on close?" — answer: `for v := range in { ... }` |
| Worker pool consuming a job channel | "What closes the job channel, and how do workers know they are done?" — answer: producer closes; workers exit on drain |
| Periodic ticker | "How is the ticker stopped, and who calls `Stop()`?" — answer: an explicit owner with a `done` channel |
| Fan-out fan-in | "If one branch errors, how do the others learn to stop?" — answer: `errgroup` cancels the shared context |

---

## Code Examples

### Example 1: The simplest lifecycle

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        fmt.Println("running")
        // function returns here — goroutine becomes _Gdead
    }()
    wg.Wait()
    fmt.Println("main done")
}
```

Lifecycle: born when `go func() {...}()` is reached; runnable for nanoseconds; running while printing; dead when the function returns.

### Example 2: Watching `runtime.NumGoroutine` over a lifecycle

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    fmt.Println("start:", runtime.NumGoroutine())

    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            time.Sleep(100 * time.Millisecond)
            fmt.Printf("worker %d done\n", id)
        }(i)
    }

    fmt.Println("during:", runtime.NumGoroutine())
    wg.Wait()
    fmt.Println("after:", runtime.NumGoroutine())
}
```

Typical output:

```
start: 1
during: 6
worker 0 done
worker 3 done
...
after: 1
```

The count drops back to 1 because all five workers reached the *dead* state.

### Example 3: A waiting goroutine is alive

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    ch := make(chan int)
    go func() {
        <-ch // wait forever
    }()
    time.Sleep(10 * time.Millisecond)
    fmt.Println("goroutines:", runtime.NumGoroutine()) // 2
    // we leak intentionally
}
```

The spawned goroutine is in the *waiting* state, blocked on a receive. It is alive. It will never return. This is a leak.

### Example 4: Closing the channel ends the wait

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int)
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        v, ok := <-ch
        fmt.Println("received:", v, "ok:", ok)
    }()
    close(ch)
    wg.Wait()
}
```

Closing the channel makes the receive return immediately with the zero value and `ok=false`. The goroutine goes Waiting → Runnable → Running → Dead.

### Example 5: `runtime.Goexit`

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer fmt.Println("deferred runs even on Goexit")
        fmt.Println("before Goexit")
        runtime.Goexit()
        fmt.Println("never reached")
    }()
    wg.Wait()
}
```

`runtime.Goexit` exits the goroutine immediately while running every deferred function on the way out. Unlike `panic`, it does not bubble or terminate the program. Unlike `return`, it can be called from any depth of nested function call.

### Example 6: Panic kills the process

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    go func() {
        panic("boom")
    }()
    time.Sleep(100 * time.Millisecond)
    fmt.Println("never printed")
}
```

The unrecovered panic ends the entire program. The lifecycle of the panicking goroutine ends *with the process*, not on a per-goroutine basis.

### Example 7: Recover scopes the panic to one goroutine

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer func() {
            if r := recover(); r != nil {
                fmt.Println("recovered:", r)
            }
        }()
        panic("boom")
    }()
    wg.Wait()
    fmt.Println("main continues")
}
```

The deferred recover lets the goroutine reach its `wg.Done()`. The lifecycle ends cleanly: Running → Dead (via the recovered panic path).

### Example 8: Lifecycle with `context.Context`

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        ticker := time.NewTicker(50 * time.Millisecond)
        defer ticker.Stop()
        for {
            select {
            case <-ctx.Done():
                fmt.Println("worker exiting:", ctx.Err())
                return
            case t := <-ticker.C:
                fmt.Println("tick at", t.Format("15:04:05.000"))
            }
        }
    }()

    time.Sleep(220 * time.Millisecond)
    cancel()
    wg.Wait()
}
```

The goroutine has a clear, named exit condition: `ctx.Done()` closes when `cancel()` is called. Lifecycle is bounded by the context.

### Example 9: Death by channel close

```go
package main

import (
    "fmt"
    "sync"
)

func worker(id int, jobs <-chan int, wg *sync.WaitGroup) {
    defer wg.Done()
    for j := range jobs {
        fmt.Printf("worker %d got %d\n", id, j)
    }
    fmt.Printf("worker %d exiting\n", id)
}

func main() {
    jobs := make(chan int)
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go worker(i, jobs, &wg)
    }
    for j := 0; j < 5; j++ {
        jobs <- j
    }
    close(jobs)
    wg.Wait()
}
```

Each worker's lifecycle ends exactly when `jobs` is drained after `close(jobs)`. This is the canonical "death by close" pattern.

### Example 10: Inspecting state with `runtime/trace`

```go
package main

import (
    "context"
    "os"
    "runtime/trace"
    "sync"
    "time"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    ctx, task := trace.NewTask(context.Background(), "demo")
    defer task.End()

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        region := trace.StartRegion(ctx, "work")
        defer region.End()
        time.Sleep(10 * time.Millisecond)
    }()
    wg.Wait()
}
```

Run, then `go tool trace trace.out`. You will see the goroutine's lifecycle as colored bars: Runnable, Running, blocked-in-sleep, Dead.

---

## Coding Patterns

### Pattern 1: Spawn-with-exit-condition

Always pair `go f(...)` with a documented exit condition.

```go
// worker exits when ctx is canceled or when jobs is closed and drained.
go worker(ctx, jobs)
```

The comment is part of the pattern. If you cannot write it, do not write the `go`.

### Pattern 2: Close the input channel to end the goroutine

```go
jobs := make(chan int)
done := make(chan struct{})
go func() {
    defer close(done)
    for j := range jobs {
        process(j)
    }
}()
// ... produce ...
close(jobs)
<-done // wait for worker to finish
```

### Pattern 3: `WaitGroup` for fan-out lifecycle

```go
var wg sync.WaitGroup
for _, x := range items {
    wg.Add(1)
    go func(x Item) {
        defer wg.Done()
        process(x)
    }(x)
}
wg.Wait()
```

Birth count and death count are equal because `Add(1)` is in the parent and `Done()` is deferred.

### Pattern 4: `context.Context` for cooperative exit

```go
go func() {
    for {
        select {
        case <-ctx.Done():
            return
        case msg := <-in:
            handle(msg)
        }
    }
}()
```

### Pattern 5: Drain on return

A goroutine that received resources (e.g., open connections from a channel) should drain or close them on its way out, so that no resource outlives the goroutine.

```go
go func() {
    defer close(connections)
    for conn := range conns {
        defer conn.Close()
        handle(conn)
    }
}()
```

---

## Clean Code

- **Comment the exit condition.** A one-line comment above `go ...` saying "exits when ctx is canceled" is worth more than 100 lines of unit tests.
- **`defer wg.Done()` at the top.** Not at the bottom, not after some work — at the top. It guarantees the lifecycle end is registered even on panic.
- **One goroutine per function**, ideally. Multiple `go` statements in a single function make ownership murky.
- **Name the goroutine** by extracting it to a named function. `go fetchURL(ctx, url)` reads better than a 30-line `go func() { ... }()`.
- **Match birth and death in the same scope.** If `f()` spawns goroutines, `f()` should also wait for them. Caller code should not have to think about workers that escape.

---

## Product Use / Feature

| Feature | Lifecycle plan |
|---|---|
| HTTP request handler spawns a background goroutine to log analytics | Tie the goroutine's `context.Context` to the request, or use a global worker pool. Otherwise the log goroutine outlives the request. |
| WebSocket connection has a writer goroutine | The writer ends when the connection closes; the close path must be wired explicitly. |
| ETL job spawns N stages | Each stage exits when its input channel closes; the final stage closes a `done` channel for the orchestrator. |
| Cache refresh goroutine | Exits when `Close()` is called on the cache; `Close()` cancels the cache's context. |
| Graceful HTTP shutdown | `srv.Shutdown(ctx)` waits for handler goroutines to finish; the context times out the wait. |
| CLI tool with progress bar | Progress goroutine ends when the main task ends and closes the progress channel. |

---

## Error Handling

A goroutine's lifecycle is intertwined with how it handles errors:

### Return-value errors

A function spawned with `go` cannot return values. Use a channel or `errgroup`:

```go
errCh := make(chan error, 1) // buffer 1 prevents send-side leak
go func() {
    errCh <- doWork()
}()
if err := <-errCh; err != nil { ... }
```

Lifecycle: the goroutine ends right after sending. The buffer ensures the send completes even if the receiver disappears.

### Panic during lifecycle

Always wrap risky goroutine bodies in a deferred `recover` if you do not want the whole process to die. Recovery converts an abnormal termination into a normal one:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("panic in worker: %v", r)
        }
    }()
    doWork()
}()
```

Note: the recovered goroutine still ends. Recovery does not "resume" it — it just lets `defer` run and the goroutine die cleanly instead of crashing the program.

### `errgroup.Group`

Beautiful for fan-out lifecycle with error propagation:

```go
g, ctx := errgroup.WithContext(ctx)
for _, url := range urls {
    url := url
    g.Go(func() error { return fetch(ctx, url) })
}
if err := g.Wait(); err != nil { ... }
```

The first error cancels the context, signaling the rest to end early. Lifecycle is bounded.

---

## Security Considerations

- **Leaks pin sensitive data.** A waiting goroutine holds onto its closure, which may include request bodies, tokens, or session keys. A leak is a data-retention bug.
- **Panic = process exit.** Untrusted input that triggers a panic in *any* goroutine kills the whole service. Always recover at the boundary of code that handles attacker-controlled data.
- **Per-request lifecycles bound the blast radius.** If a goroutine outlives its request, an authenticated user can leave behind ghost work that runs under their privileges after they logged out.
- **DoS via unbounded spawn.** Spawning a goroutine per request is fine; spawning a goroutine per byte of request body is not. Always bound goroutine creation.
- **Finalizers in unexpected goroutines.** A `runtime.SetFinalizer` callback runs in its own goroutine; if it touches global state without locks, it is a security-relevant race.

---

## Performance Tips

- **Reuse over spawn.** Spawning 100 000 short-lived goroutines per second is wasteful even though each spawn is cheap. A pool of 10 goroutines doing 10 000 jobs each is much faster.
- **Avoid spawn-and-immediately-block patterns.** A goroutine that does `<-ch` as its first action wastes the scheduler's effort. If the data is already available, call the function directly.
- **Watch for waiting accumulation.** A program that ends each second with more waiting goroutines than it started with has a leak. Use `runtime.NumGoroutine` as a smoke test.
- **Prefer return over `runtime.Goexit`** for the normal path. `Goexit` runs a slightly more involved unwinding path; saving microseconds rarely matters, but it is the simpler choice anyway.

---

## Best Practices

1. Every `go f(...)` must have a documented termination condition.
2. Use `defer wg.Done()` (or `defer close(done)`) at the very top of the goroutine body.
3. Use `context.Context` for any goroutine that does I/O or runs longer than a handful of milliseconds.
4. Bound concurrency with worker pools when input is from an untrusted source.
5. Treat a rising `runtime.NumGoroutine()` over time as a production incident.
6. Add a `pprof goroutine` endpoint to every server. Always.
7. Test lifecycle by counting goroutines before and after; assert equality.
8. Never silence a goroutine panic; log and exit (or recover and report).
9. Match `go` with a `wg.Wait()` or `<-done` in the same function whenever possible.
10. Avoid goroutines as a substitute for function calls — use them for concurrency, not flow control.

---

## Edge Cases & Pitfalls

### A goroutine that calls `os.Exit`

`os.Exit` does not run `defer`s in any goroutine and kills the process. If you have lifecycle cleanup in deferred code, it does not run.

### `time.AfterFunc` runs in its own goroutine

```go
time.AfterFunc(1*time.Second, func() { ... })
```

The callback runs in a fresh goroutine. If it never returns, you leak.

### `http.Server` goroutines outlive your handler

The standard `net/http` server spawns one goroutine per connection. Your handler runs on it, but reading remaining request bodies, draining keep-alive connections, etc., happens on goroutines you do not see.

### A panic in `runtime.SetFinalizer` callback crashes the program

Finalizers run on their own goroutines and have the same panic rules. Wrap them with `defer recover` if they can panic.

### Long-running `cgo` calls hold the lifecycle in `_Gsyscall`

A goroutine in a cgo call is stuck in syscall state until the call returns. Cancellation does not interrupt it — the C code must return cooperatively.

### Receiving from a nil channel never returns

```go
var ch chan int
<-ch // blocks forever, goroutine permanently waiting
```

Always check that channels are initialized before using them in a goroutine.

### `defer` after panic still runs

If a goroutine panics and there is a `defer recover`, every other `defer` between the panic point and the recover also runs. Useful, but be aware: long deferred chains add to the visible lifecycle even after the panic.

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| Spawning a goroutine that reads from a channel no one closes | Document who closes the channel; or pass a `context.Context`. |
| Forgetting `defer wg.Done()` | Put `defer wg.Done()` as the first line. |
| Calling `wg.Add` *inside* the goroutine | Always `Add` in the parent before `go`. |
| Sending to an unbuffered channel that may have no receiver | Use a buffered channel of size 1 or `select` with `ctx.Done`. |
| Recovering panic at the wrong level | `recover` must be inside a `defer` *in the panicking goroutine*. |
| Letting a request-scoped goroutine outlive the request | Pass the request's `context.Context` and `select` on it. |
| Assuming "the program ending will clean up my goroutines" | True in the trivial sense, but no `defer`s run in any other goroutine when `main` returns. |

---

## Common Misconceptions

> *"Once a goroutine returns, its memory is freed."* — No, the `g` struct is recycled, the stack may be retained. Memory referenced by the goroutine's closure is GC-eligible only once no live goroutine references it.

> *"A goroutine in `_Gwaiting` consumes CPU."* — No, waiting goroutines consume zero CPU. They consume memory (stack, closure references) but not CPU cycles.

> *"`runtime.Goexit` is the same as `return`."* — Almost. `Goexit` exits even from deep nested calls, runs every deferred function, and terminates the goroutine. A plain `return` only exits the current function — if it is not the top frame, the goroutine continues.

> *"A panic kills only the panicking goroutine."* — No. An *unrecovered* panic kills the whole process. A recovered panic ends just that goroutine cleanly.

> *"There is a per-goroutine main-style cleanup."* — There is not. You must arrange cleanup with `defer`.

> *"Goroutines have IDs I can query."* — No public API. The runtime uses internal IDs (`g.goid`), but they are intentionally hidden.

> *"`runtime.NumGoroutine` counts only my goroutines."* — It counts every live goroutine, including runtime workers (GC, sysmon, finalizer, etc.). The baseline is rarely 1.

> *"Closing a channel kills all goroutines blocked on send."* — No. Closing a channel makes *receives* return immediately. Sends to a closed channel *panic*.

---

## Tricky Points

### `defer` and `runtime.Goexit`

`runtime.Goexit` runs every deferred function on the stack at the time of the call, just like the normal return path. If you defer cleanup at the top of your goroutine, it runs whether the goroutine ends by return or by `Goexit`.

### A goroutine cannot kill another goroutine

The only way to "stop" another goroutine is *cooperation*: you signal via a channel or `context.Context`, and the other goroutine voluntarily returns. There is no `goroutine.Kill()` and there will not be one — preemption only affects scheduling, not termination.

### The main goroutine and `runtime.Goexit`

If you call `runtime.Goexit` from `main`, the main goroutine ends. *Other* goroutines may then continue. The program ends when no goroutines remain, or with the runtime error "no goroutines, deadlock" if a goroutine is waiting forever. (In practice, calling `Goexit` from `main` is rare.)

### `select {}` is the canonical "park forever"

```go
select {} // blocks the goroutine forever
```

Useful as a placeholder in a `main` that should wait for background workers indefinitely, but the goroutine is `_Gwaiting` forever and stays alive until process exit.

### Async preemption affects scheduling, not lifecycle

A goroutine preempted between instructions stays Running → Runnable, not waiting. Its lifecycle is unchanged.

### `runtime.SetFinalizer` ties an object's lifecycle to a goroutine

A finalizer fires in its own goroutine, just before the GC reclaims an object. That callback goroutine is born at GC time, may run briefly, and ends like any other. You rarely see it, but it does count in `runtime.NumGoroutine`.

---

## Test

```go
package lifecycle_test

import (
    "runtime"
    "sync"
    "testing"
    "time"
)

// TestNoLeak asserts goroutine count is restored after the work is done.
func TestNoLeak(t *testing.T) {
    before := runtime.NumGoroutine()

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(time.Microsecond)
        }()
    }
    wg.Wait()
    // give the runtime a moment to drop counters
    time.Sleep(10 * time.Millisecond)

    after := runtime.NumGoroutine()
    if after > before {
        t.Fatalf("leak: before=%d after=%d", before, after)
    }
}

// TestGoexitRunsDefers asserts runtime.Goexit honors deferred cleanup.
func TestGoexitRunsDefers(t *testing.T) {
    done := make(chan bool, 1)
    go func() {
        defer func() { done <- true }()
        runtime.Goexit()
    }()
    select {
    case <-done:
    case <-time.After(time.Second):
        t.Fatal("defer did not run after Goexit")
    }
}
```

---

## Tricky Questions

**Q.** What is the difference between "blocked" and "dead"?

**A.** Blocked (waiting) means the goroutine is alive, parked on something — channel, mutex, syscall, sleep — and consuming memory. Dead means the function has returned, the goroutine is finished, and the `g` struct is on a free list waiting to be reused. A leaked goroutine is blocked forever; a healthy goroutine eventually becomes dead.

---

**Q.** Does `runtime.NumGoroutine()` count dead goroutines?

**A.** No. It counts goroutines whose state is not `_Gdead`. Dead `g` structs on the free list are not counted, even though they exist in memory.

---

**Q.** Does `panic` in goroutine A let goroutine B keep running?

**A.** Only if A's panic is recovered. An *unrecovered* panic in any goroutine terminates the entire process — all other goroutines disappear with it.

---

**Q.** What happens if I call `runtime.Goexit` from `main`?

**A.** The main goroutine ends, running its `defer`s. The program continues until no goroutines remain (or until one of them deadlocks). This is rarely useful; ending `main` by returning is the normal path.

---

**Q.** Why might `runtime.NumGoroutine()` not drop immediately after `wg.Wait()`?

**A.** Because dead goroutines are recycled, not removed. The count drops as each goroutine reaches `_Gdead`, but small race windows and runtime workers can keep the count slightly higher than your expected baseline for a short time. Also, `Wait` returns when the counter is zero, but a goroutine may still be running its `defer`s for a few nanoseconds afterward.

---

**Q.** Can a goroutine end itself with `return` from deep in the call stack?

**A.** No. `return` exits the *current* function. If that function is not the top of the goroutine, the goroutine continues. Use `runtime.Goexit` to exit from any depth.

---

**Q.** What state is a goroutine in during `time.Sleep`?

**A.** `_Gwaiting`, with the wait reason "sleep" (visible in stack dumps as `[sleep]`). The runtime has parked it on a timer.

---

## Cheat Sheet

```go
// Birth
go f(args)                          // runtime.newproc -> _Grunnable
go func() { ... }()

// Healthy death (return)
go func() { defer wg.Done(); ... }()

// Forced death from any depth
runtime.Goexit()                    // runs defers, then dies

// Killing the program (NOT just one goroutine)
panic("unrecoverable")              // unless recovered

// Counting live goroutines
n := runtime.NumGoroutine()

// Snapshot every goroutine's stack
buf := make([]byte, 1<<20)
n := runtime.Stack(buf, true)       // true = all goroutines
fmt.Println(string(buf[:n]))

// Tracing state transitions
import "runtime/trace"
trace.Start(f); defer trace.Stop()

// Common exit signals
<-ctx.Done()                        // context-based
<-done                              // channel-based
for v := range ch                   // exits on close(ch)
```

---

## Self-Assessment Checklist

- [ ] I can name the four major lifecycle states a goroutine can be in.
- [ ] I can describe what `go f()` does inside the runtime (create `g`, schedule, return immediately).
- [ ] I can list the three ways a goroutine can die.
- [ ] I know the difference between "blocked" and "dead."
- [ ] I can use `runtime.NumGoroutine` to detect a leak in a unit test.
- [ ] I can use `runtime.Stack(buf, true)` to dump all goroutines.
- [ ] I can wire `context.Context` cancellation into a worker goroutine.
- [ ] I understand `runtime.Goexit` and how it differs from `return` and `panic`.
- [ ] I always pair `go` with an answer to "when does this end?"
- [ ] I can read a goroutine `pprof` profile and identify "stuck in chan receive."

---

## Summary

A goroutine has a life: it is *born* when `go f()` triggers `runtime.newproc`, it spends time *runnable* in a queue, *running* on a CPU, or *waiting* for events, and it dies when its function returns, `runtime.Goexit` is called, or an unrecovered panic propagates out. The runtime tracks every transition in the `g` struct, recycles dead `g`s onto a free list, and lets you observe the full picture with `runtime.NumGoroutine`, `runtime/trace`, and `pprof`.

The single most important habit to develop is to answer "when does this goroutine end?" for every `go` statement you write. Most concurrency bugs in Go are lifecycle bugs: a goroutine that should have ended is still alive (a leak), or one that should have continued ended too early. Wiring `context.Context` cancellation, closing input channels at the right time, and using `sync.WaitGroup` (or `errgroup`) to join children to their parents are the techniques you will use every day.

The next sub-sections, `02-detecting-leaks` and `03-preventing-leaks`, build on this lifecycle vocabulary to produce reliable techniques for both finding and avoiding the most common Go concurrency bugs.

---

## What You Can Build

After mastering this material:

- A test helper that asserts no goroutine leak occurred during a test.
- A small daemon with a graceful-shutdown path that cancels every worker.
- A worker pool whose lifecycle is bounded by `Close()`.
- A wrapper around `http.Server` that tracks per-request goroutine count.
- A simple instrumented "background job" library with documented lifecycle.
- A `runtime/trace`-based visualization of a pipeline's lifecycle.

---

## Further Reading

- The Go Programming Language Specification — *Go statements*: <https://go.dev/ref/spec#Go_statements>
- `runtime` package — `Goexit`, `NumGoroutine`, `Stack`, `SetFinalizer`: <https://pkg.go.dev/runtime>
- Dave Cheney — *Never start a goroutine without knowing how it will stop*: <https://dave.cheney.net/2016/12/22/never-start-a-goroutine-without-knowing-how-it-will-stop>
- The Go Blog — *Profiling Go Programs*: <https://go.dev/blog/pprof>
- `runtime/trace` documentation: <https://pkg.go.dev/runtime/trace>
- Uber's *goleak* library: <https://github.com/uber-go/goleak>

---

## Related Topics

- [02-detecting-leaks](../02-detecting-leaks/) — how to *find* goroutines that overstayed their welcome
- [03-preventing-leaks](../03-preventing-leaks/) — patterns that make leaks structurally impossible
- [04-pprof-tools](../04-pprof-tools/) — diagnosing live programs through goroutine profiles
- [../../05-context-package](../../05-context-package/) — the canonical lifecycle-control primitive
- [../../06-sync-package](../../06-sync-package/) — `WaitGroup`, `Once`, `Cond` for lifecycle coordination
- [../../10-scheduler-deep-dive](../../10-scheduler-deep-dive/) — what the scheduler does *during* the lifecycle

---

## Diagrams & Visual Aids

### High-level lifecycle

```
        go f()
          |
          v
     +----------+
     | Runnable |  <----+----- wakeup (channel, mutex, timer)
     +----------+       |
          |             |
          v             |
     +----------+       |
     | Running  |-------+----> park (Waiting, Syscall)
     +----------+       ^
          |             |
          v             |
     +----------+       |
     | Waiting  |-------+
     +----------+
          |
          | (function returns / Goexit / panic)
          v
     +----------+
     |   Dead   | -----> recycled on g free list
     +----------+
```

### Full state machine with runtime names

```
   _Gidle  --(new)-->  _Grunnable
                            |
                            v
                       _Grunning  <---->  _Gsyscall
                            |
                            v
                       _Gwaiting
                            |
                            v
                         _Gdead
```

`_Gcopystack` and `_Gpreempted` are transient runtime states encountered during stack growth and async preemption respectively, and are explained at the professional level.

### Birth in pseudo-runtime

```
go f(x, y, z)
     |
     v
runtime.newproc(siz, fn)
     |  copy arguments
     |  obtain g from gFree (or allocate)
     |  set status to _Grunnable
     v
runqput(p, g)            <- push onto local P run queue
     |
     v
schedule() picks it up later
     |
     v
g.fn(x, y, z)            <- the real work
     |
     v
goexit()                 <- internal, runs after fn returns
     |
     v
status = _Gdead; place on gFree
```

### Death paths

```
            (normal)               (Goexit)             (panic, unrecovered)
              return              runtime.Goexit              panic()
                 |                       |                       |
                 v                       v                       v
        function frames pop       runs all defers          unwinds; if
        until top of stack;       on the stack;            recover not found
        runtime.goexit()          terminates the           runtime.fatalpanic
                 |                  goroutine                     |
                 v                       |                        v
            _Gdead                   _Gdead              process terminates
```

### `runtime/trace` output (conceptual)

```
G42  | run | wait(chan) | run | wait(syscall) | run | dead
G43  |        run        | wait(mu) | run | dead
G44  | wait(io) | run | dead
```

Each cell is a state interval; total width is wall-clock time. `go tool trace` renders this graphically.

### Number of goroutines over time (healthy vs leaking)

```
Healthy:  count ~~~~~~~~~~~ (roughly constant around baseline + N workers)

Leaking:  count        /
                      /
                    /
                  /
                /
              /
            /
          /
        /         (grows without bound)
```

`pprof goroutine` periodically captured shows the difference clearly.
