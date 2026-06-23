---
layout: default
title: Junior
parent: Timer Leaks
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/03-timer-leaks/junior/
---

# Timer Leaks — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [The `time.After` Leak in Detail](#the-timeafter-leak-in-detail)
8. [Why It Leaks](#why-it-leaks)
9. [Pros and Cons of `time.After`](#pros-and-cons-of-timeafter)
10. [Use Cases](#use-cases)
11. [Code Examples](#code-examples)
12. [The Basic Fix: `NewTimer` + `Stop`](#the-basic-fix-newtimer--stop)
13. [Coding Patterns](#coding-patterns)
14. [Clean Code](#clean-code)
15. [Product Use / Feature](#product-use--feature)
16. [Error Handling](#error-handling)
17. [Security Considerations](#security-considerations)
18. [Performance Tips](#performance-tips)
19. [Best Practices](#best-practices)
20. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
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
32. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction

> Focus: "What is the `time.After` leak? Why does my program use more and more memory? How do I fix it the easy way?"

A **timer leak** in Go is the situation where a `*time.Timer`, a `*time.Ticker`, or a callback registered with `time.AfterFunc` keeps memory and runtime resources alive longer than your program needs. Most of the time the leak is silent. The program runs, requests succeed, no panic occurs — but the resident set size of the process climbs steadily, hour after hour, until somebody pages the on-call engineer.

This file is the gentle introduction. You will learn:

- What the very first form of timer leak looks like — `time.After` inside a `for` or `select` loop.
- Why that pattern leaks, in plain words, without going into the runtime internals.
- How to fix it with `time.NewTimer` and a careful `defer t.Stop()`.
- How to recognise the leak on your own machine using `go test -run` and a simple counter.
- A short list of related bugs you will read about in `middle.md` and `senior.md`.

If you have written even a small amount of Go you have probably written `time.After` already. It is so easy to type that it appears everywhere — in tutorials, in Stack Overflow answers, in production code. The good news is that for most one-shot uses (a single timeout at the top of `main`, a one-time delay before a retry) `time.After` is completely fine. The bad news is that the moment you put it inside a loop, the moment it sits in a `select` that runs many times, the moment the timeout is long compared to the loop iteration time, you have planted the seed of a leak.

We will not yet talk about the runtime timer heap or the Go 1.23 garbage collector changes. Those belong in the senior file. Here we will keep one image in our heads:

> A `time.After(d)` call allocates a new `*time.Timer` behind a `chan time.Time`. That timer is alive — held by the Go runtime — until either (a) it fires after `d` elapses, or (b) you call `Stop()` on it. There is no third option that frees it earlier.

That single sentence is enough to understand 80% of timer leaks at the junior level. The rest of this file makes the sentence concrete.

---

## Prerequisites

- **Required:** Go 1.18 or newer (`go version`). Some demonstrations need Go 1.21+; behaviour-only fixes work back to 1.18. Go 1.23 changed how the GC treats unreferenced timers — we will mention this but not depend on it for the junior fix.
- **Required:** Comfort with `go run main.go` and writing a `func main`.
- **Required:** Some experience with `select { case ... }`. If you have never written a `select`, read the previous chapter "Select Statement" first.
- **Required:** Some idea of what a goroutine is (the chapter on Goroutines is enough).
- **Helpful:** A vague feel for the heap, garbage collection, and `pprof`. You do not need to know any of these in detail.
- **Helpful:** A loop you wrote with `time.After` in your day job. If you have one open, even better.

You do not need to know:

- The internal timer heap data structure.
- How the runtime garbage collects timers in Go 1.23.
- `runtime/trace` or flame graphs.
- The `goleak` library.

All of those come later. Today, we keep it simple.

---

## Glossary

| Term | Definition |
|---|---|
| `time.Timer` | A struct holding a channel `C chan time.Time` that fires exactly once. Created with `time.NewTimer(d)` or implicitly by `time.After(d)`. |
| `time.After(d)` | A helper that returns a receive-only channel which fires after `d`. Equivalent to `time.NewTimer(d).C`. The timer is allocated, the channel is returned, and the `*Timer` itself is unreachable to you — so you cannot stop it. |
| `time.NewTimer(d)` | Constructor returning `*time.Timer`. You keep the pointer, so you can call `t.Stop()`. |
| `t.Stop()` | Cancels the timer if it has not yet fired. Returns `true` if the timer was stopped before firing, `false` if it had already fired (or was already stopped). |
| `t.Reset(d)` | Resets the timer to fire after `d`. Only safe to call on a stopped or expired timer that has been drained. |
| `time.Ticker` | A repeating timer. Fires on `C` every `d` until `Stop()` is called. |
| `time.AfterFunc(d, f)` | Schedules `f` to run in a new goroutine after `d`. Returns `*time.Timer` so the caller can `Stop()` before fire. |
| Timer heap | An internal runtime data structure (a four-ary min-heap, one per `P`) that holds all live timers in order of their fire time. The Go runtime walks this heap to fire timers. |
| `runtime.NumGoroutine()` | Returns the current number of goroutines. Useful as a smoke test for some leak shapes — not all. |
| `runtime.MemStats` | A snapshot of heap statistics. Used to confirm a memory leak. |
| `goleak` | A library that fails a test if extra goroutines remain at the end. Useful for catching some timer leaks (those whose goroutines block on a channel). |
| Heap allocation | A piece of memory allocated on the Go heap, kept alive by some reachable reference path or by the runtime. |

---

## Core Concepts

### What `time.After` actually does

Open the source of the `time` package and look at `After`:

```go
// After waits for the duration to elapse and then sends the current time
// on the returned channel.
func After(d Duration) <-chan Time {
    return NewTimer(d).C
}
```

That is the entire body. Three things matter here:

1. `NewTimer(d)` allocates a fresh `*Timer`.
2. Only the `C` field of that timer is returned to the caller.
3. The `*Timer` pointer itself is discarded — your code never sees it.

Because the `*Timer` is not visible to you, you cannot call `Stop()` on it. The only way it leaves the runtime is to fire. Firing only happens after `d` has elapsed.

### What "a timer is alive" means

When `NewTimer(d)` is called, the runtime inserts a `runtimeTimer` into the per-P timer heap. The runtime walks this heap periodically (via `runtime.checkTimers`) and fires any timer whose deadline has passed. Until then, the timer is referenced from the runtime — not from your user code — and so the garbage collector cannot reclaim it on classical reachability rules.

This is the key insight. The leak is not "I forgot to free something". The leak is "the runtime is holding a reference I cannot reach". The only escape is `Stop()` (when you have a pointer) or firing (when you do not).

### What "leaks" means here

In Go, "leak" usually means one of:

- **Goroutine leak**: a goroutine that runs forever, blocked on a channel or condition that will never wake.
- **Memory leak**: a heap allocation that lives forever because something keeps pointing to it.
- **Timer leak**: a timer kept alive in the runtime timer heap longer than your program needs.

The third one is a subset of the second one. Each `time.After` allocates a `runtimeTimer` (around 100–200 bytes on a 64-bit machine) plus a `chan time.Time` (about 100 bytes). For one timer this is irrelevant. For 10 million timers leaked over a week, this is 2 GB of heap — and the runtime spends increasing time walking the timer heap to find which ones to fire.

---

## Real-World Analogies

### The hotel front desk

Imagine you are at a hotel and you ask the front desk to call you in 30 minutes. They write a sticky note "Call room 412 at 18:00" and put it on the desk. You leave the lobby. Five minutes later you change your mind and decide to stay in your room all evening — but you do not tell the front desk. At 18:00 they still make the call. Until 18:00, the sticky note sat there occupying space.

`time.After(30*time.Minute)` is exactly that sticky note. You can drop your end of the conversation, but the desk (the runtime) keeps the note until it has run its course.

### The library reservation

You reserve a book at the library for next Tuesday. You then forget about it and never pick it up. The library holds the book for you for the full reservation period — it cannot return the book to the shelf earlier because you did not cancel. Multiply that by every patron, multiply by every day, and the librarian eventually runs out of reservation slots.

`time.After` reservations the runtime holds for you. Without `Stop()`, they hold for the full duration.

### The alarm clock

You set an alarm clock for 7:00 AM, then change your mind and decide to sleep in. If you do not switch the alarm off, it rings at 7:00 anyway. The alarm clock is "live" until 7:00. The runtime timer is "live" until its deadline. The only off-switch is to physically flip the alarm — `Stop()`.

---

## Mental Models

### Model 1: every `time.After` is a hidden allocation

Treat every `time.After(d)` you write the same way you would treat `make([]byte, 1024)`. It is a heap allocation. Inside a hot loop, you should be uneasy about it.

```go
for {
    select {
    case <-ch:
        // ...
    case <-time.After(5 * time.Second):  // <-- a fresh allocation every iteration
        return
    }
}
```

Imagine that line as `_ = make([]byte, 200)` with the extra property that the byte slice cannot be freed for 5 seconds. Would you write a loop that allocates a 200-byte slice that can only be freed in 5 seconds? Probably not. But this is exactly what the `time.After` line does.

### Model 2: `time.After` is fine for one-shots

`time.After` is not evil. It is precisely correct for code like this:

```go
func waitForReady() error {
    select {
    case <-ready:
        return nil
    case <-time.After(30 * time.Second):
        return errors.New("timeout")
    }
}
```

Called once. Allocates one timer. Either fires after 30s and is collected, or `<-ready` wins and the timer fires alone in 30s and is collected. Either way the leak window is bounded by 30 seconds and you do this once.

The problem is exclusively when this code lives in a loop that runs many times during the leak window.

### Model 3: `NewTimer` is `After` with the receipt

`time.After` is `NewTimer` that throws away the receipt. If you keep the receipt — the `*Timer` — you can cancel.

```go
t := time.NewTimer(5 * time.Second)
defer t.Stop()  // <-- the cancel button you can press
select {
case <-ch:
case <-t.C:
}
```

That is the entire mental upgrade from "leaks" to "fine" at the junior level.

---

## The `time.After` Leak in Detail

### A leaking program

Here is a tiny program that demonstrates the leak. It runs a `for-select` loop that receives messages on a channel. Each iteration sets a 5-second timeout via `time.After`. The messages arrive every 10 milliseconds, so the timeout never wins — but every iteration still allocates a fresh timer.

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func consume(in <-chan int, done <-chan struct{}) {
    for {
        select {
        case <-in:
            // process
        case <-time.After(5 * time.Second):
            return
        case <-done:
            return
        }
    }
}

func main() {
    in := make(chan int)
    done := make(chan struct{})
    go consume(in, done)

    // Produce a message every 10ms for 1 second.
    go func() {
        ticker := time.NewTicker(10 * time.Millisecond)
        defer ticker.Stop()
        for range ticker.C {
            in <- 1
        }
    }()

    for i := 0; i < 5; i++ {
        time.Sleep(time.Second)
        var m runtime.MemStats
        runtime.ReadMemStats(&m)
        fmt.Printf("t=%ds  HeapAlloc=%d KiB  Goroutines=%d\n",
            i+1, m.HeapAlloc/1024, runtime.NumGoroutine())
    }
    close(done)
}
```

Run it. Even on Go 1.23 you will see the heap grow as the loop allocates timers faster than the runtime expires them. On older Go versions the leak is even more pronounced. Each timer is held by the runtime for the full 5 seconds after it was created.

### What the runtime is doing

Behind the scenes, for each `time.After(5*time.Second)` the runtime:

1. Allocates a `runtimeTimer` struct on the heap.
2. Allocates a `chan time.Time` of capacity 1.
3. Inserts the `runtimeTimer` into the heap belonging to the current `P` (processor).
4. Returns the channel.

When the `<-in` case wins, your goroutine continues, loses the only reference to the channel, and continues. But the runtime still holds the `runtimeTimer`. It will not remove the entry from the heap until either the deadline arrives or `Stop()` is called — and `Stop()` requires a `*Timer`, which you do not have.

### Visualising the buildup

Picture the runtime timer heap as a list of `(deadline, channel)` pairs:

```
t=0.00s   heap: empty
t=0.01s   heap: [(t=5.01s, ch1)]
t=0.02s   heap: [(t=5.01s, ch1), (t=5.02s, ch2)]
t=0.03s   heap: [(t=5.01s, ch1), (t=5.02s, ch2), (t=5.03s, ch3)]
...
t=1.00s   heap: 100 entries
t=2.00s   heap: 200 entries
t=5.00s   heap: 500 entries, oldest about to fire
t=5.01s   ch1 fires (but nobody is reading) — entry removed
t=5.02s   ch2 fires — entry removed
...
```

Steady state: ~500 entries in the heap at any one time once equilibrium is reached, given the 10ms loop and 5s timeout. Production loops are often hotter than this, and timeouts often longer.

---

## Why It Leaks

### The runtime owns the timer

In Go, the garbage collector frees memory that no goroutine and no other live object references. A `*Timer` returned by `NewTimer` is referenced by **the runtime timer heap**. The user-facing `*Timer` pointer can be dropped (set to `nil`, go out of scope) and the runtime entry will still be there.

On Go versions before 1.23, this was even stronger: the `*Timer` you held was a thin handle, and the underlying `runtimeTimer` was kept alive by the heap entry, even if no user goroutine could reach it. The garbage collector did not know how to remove timer-heap entries.

On Go 1.23 the runtime was changed so that *unreferenced* timers can be removed from the heap during GC. This helps `time.After` somewhat — but only when the goroutine that called `time.After` has actually exited so that the channel reference is dropped. If you are inside a `for-select` loop, the channel is still alive on the stack for the duration of the `select`, and only released when that `case` ceases to be a possibility. We will go into 1.23 in detail in the senior file. For now, treat `time.After` as something that pins memory.

### `time.After` returns a channel, not a timer

Read the signature one more time:

```go
func After(d Duration) <-chan Time
```

A channel. A read-only channel. You cannot call `Stop()` on a channel. The compiler will not let you. The only way to reach the underlying `*Timer` from a channel is to use unsafe pointer tricks — and even then you would be touching a runtime-internal structure. In normal code, the answer is clear: you cannot cancel `time.After`. Period.

So if you create one and then no longer need it, the only path to its release is for the deadline to elapse. That is the leak window.

### The fix is structural, not local

There is no compiler flag, no `go vet` rule, no library that retroactively fixes a `time.After` you wrote in a loop. The only fix is to rewrite the call site to use `time.NewTimer` and to manage the lifecycle yourself. The `middle.md` file goes deep into the `Reset` / `Stop` rules. For now, the rule of thumb is:

> If `time.After` is inside `for { select { ... } }` and the loop runs more than a handful of times, replace it.

---

## Pros and Cons of `time.After`

### Pros

- One line. No setup. No `defer`. Reads almost like English: "after 5 seconds, fire".
- Returns a channel that fits directly into a `select`. No intermediate variable needed.
- Correct for one-shot timeouts where the cost of one leaked timer for one duration is negligible.
- Idiomatic in Go talks and tutorials, so people recognise it.
- Cleanly composes with `context.Context` for code that is not yet context-aware.

### Cons

- Cannot be cancelled. Once you call it, the timer fires no matter what.
- Allocates fresh memory every call. Not amortised, not pooled.
- Inside loops or hot paths, the allocation cost dominates real work.
- Holds memory in the runtime timer heap for the full duration after the channel is no longer wanted.
- Leak grows linearly with call rate. A 100 RPS service that uses `time.After(30s)` in its request path holds 3,000 dead timers at steady state.
- Before Go 1.23, even after the goroutine exits the timer was retained until fired.
- Encourages a habit ("just use time.After") that survives into senior code where it really matters.

### When to prefer which

| Situation | `time.After` | `NewTimer` |
|---|---|---|
| Single timeout at program startup | Fine | Overkill |
| Single timeout in a one-shot RPC handler | Fine for small timeouts | Better — you can cancel |
| Timeout inside a long-lived `for-select` loop | Avoid | Use this |
| Timeout for a high-RPS HTTP handler | Avoid | Use this |
| Repeated timeouts inside `select` over the same channel | Avoid | Use this with `Reset` |
| Test fixture where you wait once and exit | Fine | Fine |

---

## Use Cases

The use cases for **fixing** timer leaks are the same as the use cases for the leaky pattern. They include:

- A worker goroutine that pulls jobs from a channel and gives up if no job arrives within some idle timeout.
- A polling client that hits an HTTP API every N seconds.
- A heartbeat sender that emits a packet every 1s.
- A batch flusher that flushes every 5s or when the buffer is full.
- A retry loop that backs off between attempts.
- A "warmup" handler that waits up to 30s for a service to become ready.
- A test that asserts an event happens within a deadline.
- A cron-like ticker that runs an in-process job once an hour.

Almost any code that mixes channels and time falls here. The next file (`middle.md`) covers each of these in detail; for now we focus on the first two.

---

## Code Examples

### Example 1: the most basic leak

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int)
    go func() {
        // produce one value per millisecond
        t := time.NewTicker(time.Millisecond)
        defer t.Stop()
        for range t.C {
            ch <- 1
        }
    }()

    // For one second, drain ch, with a 1s "give up" timeout we never reach.
    deadline := time.After(time.Second)
    for {
        select {
        case <-ch:
            // do nothing
        case <-deadline:
            fmt.Println("done")
            return
        case <-time.After(500 * time.Millisecond):
            // <-- LEAK SITE: new timer every iteration of the select
        }
    }
}
```

Two `time.After` calls. The first (outside the loop) is fine — it is a one-shot timeout. The second is the leak. Each time the loop iterates and we hit the `time.After(500*time.Millisecond)` case alternative, we allocate a fresh timer. We never read from it because `<-ch` keeps winning. By the time the outer deadline arrives, hundreds of timers sit in the heap.

### Example 2: minimal observable leak

The first example is too short to leak meaningfully. Let me give one that actually changes `HeapAlloc` measurably.

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    ch := make(chan int, 1)
    go func() {
        for {
            ch <- 1
        }
    }()

    var before, after runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&before)

    for i := 0; i < 100000; i++ {
        select {
        case <-ch:
        case <-time.After(time.Hour):
        }
    }

    runtime.GC()
    runtime.ReadMemStats(&after)

    fmt.Printf("HeapAlloc before: %d KiB\n", before.HeapAlloc/1024)
    fmt.Printf("HeapAlloc after:  %d KiB\n", after.HeapAlloc/1024)
    fmt.Printf("Delta:            %d KiB\n", (after.HeapAlloc-before.HeapAlloc)/1024)
}
```

100,000 iterations. 100,000 `time.After(1h)` calls. None of them fires (the channel always wins, and an hour is too long to wait). Each timer sits in the runtime timer heap for the next hour. On Go 1.22 you will see the delta climb into the megabytes. On Go 1.23 the GC can reclaim some of them, but the runtime timer heap itself still has all the entries until they expire.

### Example 3: the same code, fixed

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    ch := make(chan int, 1)
    go func() {
        for {
            ch <- 1
        }
    }()

    var before, after runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&before)

    t := time.NewTimer(time.Hour)
    defer t.Stop()
    for i := 0; i < 100000; i++ {
        select {
        case <-ch:
        case <-t.C:
            return
        }
        if !t.Stop() {
            select {
            case <-t.C:
            default:
            }
        }
        t.Reset(time.Hour)
    }

    runtime.GC()
    runtime.ReadMemStats(&after)

    fmt.Printf("HeapAlloc before: %d KiB\n", before.HeapAlloc/1024)
    fmt.Printf("HeapAlloc after:  %d KiB\n", after.HeapAlloc/1024)
    fmt.Printf("Delta:            %d KiB\n", (after.HeapAlloc-before.HeapAlloc)/1024)
}
```

One timer, reused across all 100,000 iterations. Delta close to zero. The middle file explains the `Stop`/`Reset`/drain dance in depth; for the junior level just memorise the pattern.

### Example 4: the easiest fix when you do not need to cancel

If you only need a one-shot timeout that fires before the goroutine exits, you do not need to manage the timer at all. Use `context.WithTimeout`:

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func fetch(ctx context.Context) (string, error) {
    select {
    case <-time.After(time.Hour):  // pretend "the work"
        return "ok", nil
    case <-ctx.Done():
        return "", ctx.Err()
    }
}

func main() {
    for i := 0; i < 5; i++ {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
        _, err := fetch(ctx)
        cancel()  // <-- THIS is the equivalent of t.Stop()
        fmt.Println(i, err)
    }
}
```

Now, this code still uses `time.After` inside `fetch`. Look carefully — the leak risk has moved. Each call to `fetch` allocates a 1-hour timer that will sit there for an hour after `fetch` returns. The `ctx.Done()` win does not free the timer. This is a classic anti-pattern at the junior level. Replace `time.After(time.Hour)` with a real piece of work or a `*time.Timer` you manage.

### Example 5: a real-world idiom — periodic heartbeat

```go
package main

import (
    "fmt"
    "time"
)

func heartbeat(done <-chan struct{}) {
    for {
        select {
        case <-done:
            return
        case <-time.After(time.Second):
            fmt.Println("heartbeat")
        }
    }
}

func main() {
    done := make(chan struct{})
    go heartbeat(done)
    time.Sleep(5500 * time.Millisecond)
    close(done)
    time.Sleep(100 * time.Millisecond)
}
```

This is the canonical "looks fine, leaks anyway" pattern. The leak rate is small (one timer per second) and the timer fires before the next iteration so the heap stays small. But — and this matters — when `done` fires the in-flight `time.After(time.Second)` is still held until it expires. If you call `close(done)` and immediately spawn another `heartbeat`, you have multiple stale timers piling up. Multiply across 10,000 connection-scoped heartbeats over a day, and you start to feel it.

The fix:

```go
func heartbeat(done <-chan struct{}) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-done:
            return
        case <-t.C:
            fmt.Println("heartbeat")
        }
    }
}
```

A `Ticker` instead of repeated `time.After`. Single allocation, explicit `Stop`, no leak. We cover tickers fully in the next sibling chapter.

### Example 6: passing `time.After` to a function

```go
func waitWithTimeout(ready <-chan struct{}, timeout time.Duration) bool {
    select {
    case <-ready:
        return true
    case <-time.After(timeout):
        return false
    }
}
```

This function is called from many places. Each call leaks one timer for `timeout` duration if `ready` wins first. If callers pass `timeout=5*time.Minute` and the function is called from a hot HTTP handler, you get a leak proportional to RPS. Refactor as:

```go
func waitWithTimeout(ready <-chan struct{}, timeout time.Duration) bool {
    t := time.NewTimer(timeout)
    defer t.Stop()
    select {
    case <-ready:
        return true
    case <-t.C:
        return false
    }
}
```

`defer t.Stop()` is the single most important line in this whole file. Burn it into your fingers.

### Example 7: showing the runtime heap with `runtime.MemStats`

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func dump(label string) {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("%-10s HeapAlloc=%6d KiB  Goroutines=%d  Mallocs=%d\n",
        label, m.HeapAlloc/1024, runtime.NumGoroutine(), m.Mallocs)
}

func main() {
    dump("start")

    for i := 0; i < 50000; i++ {
        _ = time.After(time.Hour)
    }
    dump("after-leak")

    runtime.GC()
    dump("post-GC")

    time.Sleep(100 * time.Millisecond)
    dump("settled")
}
```

Run this on different Go versions and compare. On Go 1.22 you will see `HeapAlloc` stay high after GC because the timer heap pins memory. On Go 1.23 you will see the heap drop substantially because unreferenced timers can be GC'd. Either way, the lesson is the same: do not write the leaky pattern.

### Example 8: the fix template

For 95% of cases in your day job, the leak fix is exactly this:

```go
t := time.NewTimer(timeout)
defer t.Stop()
select {
case <-something:
    // ...
case <-t.C:
    // timed out
}
```

Memorise it. Type it from memory. When you see `case <-time.After(...)` in a loop, mentally rewrite it to this template.

### Example 9: AfterFunc leak

`time.AfterFunc` is a sibling. It schedules a function to run after a duration. It also returns a `*Timer`, so you can stop it.

```go
package main

import (
    "fmt"
    "time"
)

func leakyAfterFunc() {
    for i := 0; i < 5; i++ {
        time.AfterFunc(time.Hour, func() {
            fmt.Println("never runs because the program exits")
        })
    }
}
```

Each call allocates a `*Timer` plus the closure. The timer is held in the runtime heap for an hour. The closure captures references; whatever it captures is also held. In a junior context the fix is identical: keep the returned `*Timer` and `Stop()` it.

```go
timers := make([]*time.Timer, 0, 5)
for i := 0; i < 5; i++ {
    timers = append(timers, time.AfterFunc(time.Hour, func() { /* ... */ }))
}
// later, perhaps in defer
for _, t := range timers {
    t.Stop()
}
```

We will revisit this in `middle.md`. For now, remember: every `AfterFunc` returns a `*Timer`. Throwing it away is the same mistake as `time.After`.

### Example 10: the leak that hides in a library

Sometimes the leak is two layers deep — your code calls into a helper, the helper uses `time.After`, the helper is called from a loop. Example:

```go
// pkg/util/wait.go
package util

import "time"

func WaitFor(ch <-chan int, d time.Duration) (int, bool) {
    select {
    case v := <-ch:
        return v, true
    case <-time.After(d):
        return 0, false
    }
}

// pkg/worker/loop.go
package worker

import (
    "yourproject/pkg/util"
)

func Run(in <-chan int) {
    for {
        v, ok := util.WaitFor(in, 5*time.Minute)
        if !ok {
            return
        }
        _ = v
    }
}
```

`Run` looks innocuous. `WaitFor` looks innocuous. Together they leak one 5-minute timer per iteration. The fix is to rewrite `WaitFor` with `NewTimer` + `Stop`. The junior-level habit is to *also look one level deep* when you see a `time.Duration` argument crossing a function boundary.

---

## The Basic Fix: `NewTimer` + `Stop`

### Anatomy of the fix

Three pieces:

```go
t := time.NewTimer(timeout)   // 1. allocate
defer t.Stop()                // 2. ensure cancellation no matter how we exit
select {                      // 3. wait on t.C alongside other channels
case <-t.C:
case <-something:
}
```

`defer t.Stop()` is the heart. It says: "no matter how this function returns — normally, via panic, via early return — the timer will be stopped." If the timer has already fired, `Stop()` returns `false` and that is fine: there is nothing to cancel.

### When to reuse vs allocate

For a function that uses a timer exactly once before returning, the above is enough. Allocate, defer, return. The timer either fires (allocated for one duration, then collected) or is stopped (collected immediately).

For a loop that uses the timer many times — like the `for-select` loops — you want to reuse it via `Reset`. That is a middle-level pattern; we will cover it next. The junior-level rule is:

> Loops: use `NewTicker`, not `time.After`. Single calls: use `NewTimer` with `defer t.Stop()`.

That covers nearly every case you will see at the junior level.

### A more complete fix template

```go
func DoWithTimeout(do func() error, timeout time.Duration) error {
    done := make(chan error, 1)
    go func() { done <- do() }()

    t := time.NewTimer(timeout)
    defer t.Stop()

    select {
    case err := <-done:
        return err
    case <-t.C:
        return errors.New("timeout")
    }
}
```

Note `done` has buffer 1 so that even if the worker finishes after the timeout, the send does not block forever and the goroutine can exit. This is one of the few canonical timeout patterns that gets it right. We will refine it in later chapters.

### Don't forget the `Stop()` return value

When you eventually graduate to `Reset()`-based reuse (middle level), you need to know what `Stop()` returns:

- `true` if the timer was active and we stopped it before firing.
- `false` if the timer had already fired (and the value is on `t.C`) or was already stopped.

If `false`, there may be a pending value on `t.C` you need to drain before `Reset()`. This is the famous "drain channel before reset" gotcha. We will spend the entire middle file on it; for now just remember it exists.

### Should you always reach for `NewTimer`?

No. For one-shot toplevel timeouts, `time.After` is fine. Two examples that do not leak even though they use `time.After`:

```go
// Example A: program-level startup timeout
func main() {
    select {
    case <-ready:
    case <-time.After(30 * time.Second):
        log.Fatal("startup timeout")
    }
    // continue
}
```

```go
// Example B: single timeout in a one-shot test
func TestX(t *testing.T) {
    select {
    case got := <-out:
        // assert
    case <-time.After(time.Second):
        t.Fatal("timed out")
    }
}
```

Both call `time.After` once. Both let the timer fire and be collected. Neither leaks.

The rule is not "never use `time.After`". The rule is "never use `time.After` in a loop or hot path".

---

## Coding Patterns

### Pattern: timeout for a single operation

```go
func callWithTimeout(ctx context.Context, d time.Duration, f func() error) error {
    t := time.NewTimer(d)
    defer t.Stop()
    done := make(chan error, 1)
    go func() { done <- f() }()
    select {
    case err := <-done:
        return err
    case <-t.C:
        return errors.New("timeout")
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

### Pattern: bounded retry with backoff

```go
func retry(attempts int, base time.Duration, fn func() error) error {
    for i := 0; i < attempts; i++ {
        if err := fn(); err == nil {
            return nil
        }
        if i == attempts-1 {
            break
        }
        d := base << i
        t := time.NewTimer(d)
        <-t.C
        // No Stop here — we already received from t.C, so the timer fired and is done.
    }
    return errors.New("attempts exhausted")
}
```

When you only read from `t.C` and you know the timer fired, `Stop` is unnecessary. The runtime has already cleared it. The `defer t.Stop()` habit is fine — it returns `false` harmlessly in this case — but if you want maximum clarity, just receive.

### Pattern: shared timer for many select branches

```go
func wait3(a, b, c <-chan struct{}, d time.Duration) (int, bool) {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-a:
        return 0, true
    case <-b:
        return 1, true
    case <-c:
        return 2, true
    case <-t.C:
        return -1, false
    }
}
```

A single timer for an N-way `select`. No leak, no allocation per branch.

---

## Clean Code

- Name your timer variable `t` when it is the only timer in scope, otherwise give it a descriptive name like `idleTimer`, `pollTimer`, `gracePeriod`.
- Put `defer t.Stop()` immediately after `time.NewTimer(...)`. Do not let any other line sneak between them. If something panics, the defer must still cancel the timer.
- Do not nest `time.After` inside complex expressions. `select { case <-time.After(time.Duration(x*1000) * time.Millisecond): ... }` should be split into a named timer.
- When passing a timeout into a function, prefer passing a `*time.Timer` if the function will use it more than once. Even better, prefer passing a `context.Context` and let the caller decide how to bound time.
- For one-line tests, `time.After` is acceptable. For production loops, it is not.
- Group timer setup with the resource it bounds. If the timer guards a network call, allocate the timer next to the network call site, not at the top of a function that may not even use it.

---

## Product Use / Feature

Common product features that lean on timers:

- **HTTP server idle connection cleanup**: every connection has a `time.Timer` for its read deadline. If `time.After` is used per request rather than `SetReadDeadline`, you leak proportional to RPS.
- **Job scheduler**: a queue of jobs each with a scheduled fire time. If implemented with `time.AfterFunc` and the callbacks are not unregistered when jobs are cancelled, you leak per cancel.
- **Distributed lock with TTL**: a goroutine renews a lock every N seconds. A leaked `time.After` inside the renewal loop becomes a leak proportional to lock hold time.
- **Long-polling**: a server holds a request open up to a maximum duration. `time.After(maxWait)` inside the handler leaks for `maxWait` after the client disconnects.
- **Rate limiter**: a token bucket replenishes via a ticker. Leaking the ticker leaks one runtime entry per limiter instance.
- **Cron in-process**: implementations that schedule each future tick via `time.AfterFunc` need careful cleanup on shutdown.

Every one of these is a real bug pattern we will see in `find-bug.md`.

---

## Error Handling

There are no errors to handle from `time.After`, `NewTimer`, or `Stop`. They do not return errors. They cannot fail at the API level.

But timer leaks **become** errors when:

- The process runs out of memory and is OOM-killed.
- The runtime spends so much time walking the timer heap that latency spikes.
- The runtime's per-P timer locks become contended.
- Goroutines wedged on leaked channels cause cascading deadlocks.

Mitigation strategies for the error case:

- Have a memory-usage alert on the process. RSS should be roughly flat in steady state.
- Have `runtime.NumGoroutine()` exported as a metric. A monotonic rise is suspicious.
- Wire `goleak` into the test suite. A test that leaks one goroutine via `time.After` will be caught at CI time, long before production.

The actionable rule at the junior level: do not treat the absence of an error from `time.After` as proof that the call is harmless. The leak is silent. Looking at `MemStats` is your error report.

---

## Security Considerations

Timer leaks are usually performance/availability bugs, not security bugs, but a few scenarios cross over:

- **Denial of service**: a public endpoint that uses `time.After(timeout)` per request lets an attacker amplify memory usage. If the attacker sends N requests/sec and the handler holds the timer for `timeout` seconds, the attacker can pin `N * timeout` timers in your runtime. With `timeout=5min` and `N=10k req/s` that is 3 million timers — likely OOM-killing the process.
- **Memory exhaustion under load**: even without an attacker, a sudden traffic burst combined with leaky timers can push the process over its memory limit and cause it to be killed by the container orchestrator.
- **Slowloris-style amplification**: an attacker who holds many requests open just below your timeout amplifies the leak — every request gets its own pinned timer.
- **Information leakage via timing**: if a leak makes GC pauses unpredictable, side-channel timing attacks become easier. This is exotic but worth knowing.

Fix posture:

- Always use cancellable timers in request handlers.
- Cap concurrency on public endpoints — a `Semaphore` or a fixed worker pool.
- Set reasonable per-handler memory budgets where possible.

---

## Performance Tips

- Allocate `*time.Timer` once and `Reset` it. The allocation cost of `time.After` per call is small (low hundreds of nanoseconds) but at high RPS it adds up.
- For tickers, `time.NewTicker` and `defer t.Stop()`. Never use `time.Tick` (no `Stop` exists for it).
- For short, predictable timeouts inside hot loops (sub-millisecond), prefer batching: check the deadline yourself with `time.Now()` rather than allocating a timer.
- For polling, the runtime cost is dominated by the timer heap operations. Fewer, longer-lived timers beat many short-lived ones.
- If you really need a per-request timeout and cannot avoid allocation, prefer `context.WithTimeout` plus a single `<-ctx.Done()`. The context handles the timer internally and stops it on `cancel`.

---

## Best Practices

- **Default to `NewTimer`**: when you write `time.After`, pause and ask "is this in a loop?". If yes, switch.
- **Always `defer t.Stop()`**: even if you think the timer will always fire, `Stop()` on an already-expired timer is harmless and the defer is your safety net.
- **Never store a `*Timer` long-term**: timers are best as scoped variables. If you find yourself putting a `*Timer` in a struct, ask if a context-based design is cleaner.
- **Prefer `context.WithTimeout` for cross-API timeouts**: the context's `Done()` channel composes naturally and the cancel function takes care of cleanup.
- **Audit your dependencies**: do not assume third-party libraries handle their timers correctly. Many do not.

---

## Edge Cases and Pitfalls

### Receiving from `t.C` after `Stop()`

If `Stop()` returns `false`, the timer either already fired (a value is on `t.C`) or was already stopped (no value, but `t.C` is empty). Reading from `t.C` blocks. The well-known drain:

```go
if !t.Stop() {
    select {
    case <-t.C:
    default:
    }
}
```

works in both cases. We treat this in depth in `middle.md`. Junior-level rule: only worry about draining if you plan to `Reset`.

### `time.Tick`

`time.Tick(d)` returns a `<-chan Time` that fires every `d`. There is **no way to stop it**. This is documented as "leaks the underlying Ticker". Use `time.NewTicker` instead, always.

```go
// BAD
for t := range time.Tick(time.Second) { /* ... */ }

// GOOD
tk := time.NewTicker(time.Second)
defer tk.Stop()
for t := range tk.C { /* ... */ }
```

### `time.After(0)`

A timer with duration 0 fires "soon" but not immediately. The runtime still allocates a `*Timer`. Do not use it as a way to yield — use `runtime.Gosched()`.

### Negative duration

`time.NewTimer(-1)` and `time.After(-1)` fire immediately (i.e., the timer's deadline is in the past, so the runtime fires it at the next opportunity). No leak, but also no useful waiting.

### Captured closures in `AfterFunc`

`time.AfterFunc(d, func() { use(largeObject) })` keeps `largeObject` alive for `d`. If `d` is long and `largeObject` is big, this is a memory hold even without "leaking" in the strict sense. Watch your closures.

### Multiple `time.After` in one `select`

```go
select {
case <-time.After(5 * time.Second):
case <-time.After(10 * time.Second):
}
```

This allocates two timers. The first will fire first. The second is held until 10 seconds elapses or you explicitly stop it — but you cannot, you do not have the pointer. Avoid.

---

## Common Mistakes

1. **`time.After` in a `for-select`** — the canonical leak.
2. **Forgetting `defer t.Stop()`** — works most of the time, betrays you on early return paths.
3. **Calling `Reset` without draining `t.C`** — the next read may see a stale value.
4. **Using `time.Tick`** — no way to stop it.
5. **Not stopping the `Ticker` when the goroutine exits** — `Stop()` on a `*Ticker` is required; the GC will not collect the underlying timer.
6. **Heavy closures in `AfterFunc`** — captured values pin memory.
7. **Treating `Stop()` returning `false` as an error** — it just means the timer already fired.
8. **Putting `time.After` behind a function call** — the leak hides one level deep.
9. **Using `time.After` for very long timeouts** (hours/days) — even a single one is a meaningful memory hold.
10. **Trusting CI to find leaks** — most CI suites do not measure heap growth.

---

## Common Misconceptions

- **"Setting the variable to `nil` releases the timer."** No. The runtime still holds it.
- **"The GC will free it."** Only after Go 1.23 *and* only when no reference remains in user code *and* the runtime heap entry is no longer needed. In a loop, the channel is still in scope.
- **"`time.After` is just a convenience for `NewTimer`."** Almost — but the missing `Stop` makes it a different tool.
- **"It is fine because the timer fires eventually."** Yes, it fires. Until it fires, it occupies memory.
- **"I do not see any leak in `go test`."** A 100ms test will not surface a 5-second leak. Run for minutes, not milliseconds.
- **"Memory leaks are caused by goroutine leaks."** Not always. A `time.After` leak holds memory without leaking a goroutine.
- **"`pprof goroutine` will show the leak."** It will not. Pprof goroutine lists goroutines, not runtime timers.

---

## Tricky Points

### Tricky 1: where the channel "lives"

When you write `case <-time.After(d):` inside a `select`, the Go compiler generates code that evaluates `time.After(d)` first, then enters the `select`. So the timer is created *every iteration* even if the case is never chosen.

### Tricky 2: timer fires once

A `*Timer` fires exactly once. After it fires, the channel has at most one value buffered. If you do not receive that value before `Reset`, you have a stale value.

### Tricky 3: `Stop()` versus draining

`Stop()` returns `false` if the timer already fired. If it fired, there might be a value on `t.C`. If you do not drain, the next `Reset` plus read sees the stale value.

### Tricky 4: Go 1.23 changed the rules

In Go 1.23, the runtime now removes unreferenced timers from the heap during GC. This means *some* `time.After` leaks vanish. But:

- The leak still exists during the GC cycle window.
- Inside a `for-select`, the channel may be referenced by the select frame even if your code does not name it.
- `AfterFunc` callbacks always retain the function and its closure until they fire.

Do not rely on 1.23 to fix your code. The fix is structural, not version-dependent.

### Tricky 5: zero-duration timers

`time.After(0)` fires "as soon as possible". The runtime still allocates. Do not use it as a yield primitive.

### Tricky 6: `time.AfterFunc` runs the function in its own goroutine

Each fired `AfterFunc` spawns a new goroutine to run the callback. This is important when the callback is short — the goroutine overhead can dominate.

### Tricky 7: in tests

Tests often use `time.After` in their own assertion timeouts. This is acceptable for the same reason a one-shot timeout in `main` is acceptable: the leak is bounded by the duration and is reclaimed when the test process exits.

### Tricky 8: large object captures

`time.AfterFunc(time.Hour, func() { log.Println(req) })` keeps `req` (and the whole HTTP request, body, etc.) alive for an hour. Not technically a "leak" — but practically the same as one.

### Tricky 9: composite leaks

Sometimes the timer leak is half of a worse bug. The other half is the goroutine leak that owns the channel reading from `t.C`. Both must be fixed.

---

## Test

### Test 1: spot the leak

```go
func processMsgs(in <-chan int) {
    for {
        select {
        case m := <-in:
            process(m)
        case <-time.After(10 * time.Second):
            log.Println("idle")
        }
    }
}
```

Leaks? Yes. Every iteration, a fresh 10-second timer that fires only if no message arrives within 10 seconds.

### Test 2: fix it

```go
func processMsgs(in <-chan int) {
    t := time.NewTimer(10 * time.Second)
    defer t.Stop()
    for {
        select {
        case m := <-in:
            process(m)
            if !t.Stop() {
                select {
                case <-t.C:
                default:
                }
            }
            t.Reset(10 * time.Second)
        case <-t.C:
            log.Println("idle")
            t.Reset(10 * time.Second)
        }
    }
}
```

This is the full middle-level pattern. We will dissect every line in `middle.md`.

### Test 3: spot the leak

```go
func wait(ready <-chan struct{}) bool {
    select {
    case <-ready:
        return true
    case <-time.After(time.Minute):
        return false
    }
}
```

Leaks? Yes — but only if `wait` is called many times and `ready` keeps winning. Otherwise it is fine. The right call here is: if `wait` is called from a hot path, refactor; if it is called once at startup, leave it.

### Test 4: spot the leak

```go
func produce() <-chan int {
    out := make(chan int)
    go func() {
        for i := 0; ; i++ {
            time.AfterFunc(time.Second, func() { out <- i })
        }
    }()
    return out
}
```

Leaks? Yes — and worse. The loop spawns a `time.AfterFunc` per iteration with no stop reference. The runtime accumulates one timer per microsecond. RAM will exhaust within minutes.

### Test 5: spot the leak

```go
func main() {
    for {
        time.Sleep(time.Second)
    }
}
```

Leaks? No. `time.Sleep` does not allocate a `*Timer` you can leak. It blocks the current goroutine on a runtime-managed sleep that is released when fired. The goroutine itself is "live forever" but no timer is leaked.

---

## Tricky Questions

1. **Why can't I call `Stop()` on the return value of `time.After`?**
   Because it returns a `<-chan Time`, not a `*Timer`. The `*Timer` is allocated and held by the runtime; you never see it.

2. **What is the smallest leak I should worry about?**
   A few timers in a one-shot path: ignore. Anything in a `for-select` that runs more than a few times: fix.

3. **Does Go 1.23 fix my leaks?**
   It helps. It does not eliminate them. The fix is to write the code correctly.

4. **What about a timer with `duration=1ms`?**
   Tiny. It fires fast. The leak window is 1ms. Not a problem.

5. **What about `duration=1h`?**
   Fires after 1 hour. If you do this in a hot loop, accumulate 1 hour's worth of timers in the runtime heap. Definitely a problem.

6. **Is `time.Tick` ever safe?**
   For program-lifetime tickers in tiny scripts, yes. For anything else, no — use `NewTicker`.

7. **Does `time.After` allocate when the duration is zero?**
   Yes. Still a `*Timer` and a channel. Use `runtime.Gosched()` if you want to yield.

8. **Can `defer t.Stop()` be wrong?**
   Almost never. If `Stop` returns `false` because the timer fired, no harm. The defer pattern is the safe default.

9. **What about timer leaks in `context.WithTimeout`?**
   `context.WithTimeout` allocates one timer internally and stops it on `cancel()`. If you always call `cancel()`, no leak. If you forget to call `cancel()`, you leak the timer until the timeout elapses.

10. **Does a leaked timer block process shutdown?**
    No. When the process exits, all runtime state is freed by the OS. Leaks matter only for long-running processes.

---

## Cheat Sheet

```
RULE 1: time.After in for-select → leak. Replace with NewTimer.
RULE 2: NewTimer t → defer t.Stop()
RULE 3: time.Tick → never use. Use NewTicker + Stop.
RULE 4: AfterFunc → keep the *Timer; Stop it on cleanup.
RULE 5: Loops want one shared timer with Reset, not many one-shot timers.
RULE 6: context.WithTimeout → always call cancel().
```

Cheat code:

```go
// One-shot timeout: safe and simple.
t := time.NewTimer(d)
defer t.Stop()
select {
case <-ch:
case <-t.C:
}
```

---

## Self-Assessment Checklist

- [ ] I can explain why `time.After` in a loop leaks.
- [ ] I can rewrite `case <-time.After(d):` to use `*time.Timer`.
- [ ] I know the difference between `time.Tick` and `time.NewTicker`.
- [ ] I know what `defer t.Stop()` does and why it is safe.
- [ ] I know that `Stop()` returns `false` when the timer already fired.
- [ ] I have read at least once that Go 1.23 changed timer GC.
- [ ] I have caused a leak intentionally and measured `runtime.MemStats`.
- [ ] I have replaced a leaky `for-select { case <-time.After }` in real code.

---

## Summary

A `time.After(d)` call allocates a `*time.Timer` that the runtime holds until the timer fires. If you call `time.After` inside a `for-select` loop, you allocate one timer per iteration, and each leaks for up to `d` after the loop drops it. The fix is `time.NewTimer`, which returns the `*Timer` so you can `Stop()` it; the canonical pattern is

```go
t := time.NewTimer(d)
defer t.Stop()
select {
case <-ch:
case <-t.C:
}
```

For repeating workloads use `time.NewTicker` + `defer t.Stop()`. Never use `time.Tick`. Go 1.23 improved GC for unreferenced timers, but the fix is structural and version-independent.

---

## What You Can Build

- A polling client that respects an idle timeout without leaking.
- An HTTP handler with per-request timeout that does not amplify under load.
- A heartbeat sender for a long-lived connection.
- A batch flusher that triggers on size or interval.
- A retry helper with backoff.
- An in-process job queue with cancellable scheduled jobs.

We will revisit all of these in `tasks.md`.

---

## Further Reading

- Go source: `src/time/sleep.go` — definitions of `Timer`, `After`, `NewTimer`, `Stop`, `Reset`.
- Go source: `src/runtime/time.go` — the runtime timer heap.
- Go 1.23 release notes — "Changes to the implementation of timers".
- Dave Cheney, "Never start a goroutine without knowing how it will stop".
- Uber `goleak` README.
- The next file: `middle.md`.

---

## Related Topics

- Goroutine leaks
- `select` statement and the random ordering of cases
- `context.Context` and `context.WithTimeout`
- The `runtime` package: `MemStats`, `NumGoroutine`, `GC`.
- `pprof heap` and how to read it.
- Ticker leaks (chapter 01-ticker).
- AfterFunc leaks (chapter 02-afterfunc).
- Exponential backoff (chapter 04).

---

## Diagrams and Visual Aids

### Diagram 1: the `time.After` allocation flow

```
              your code                          runtime
              ---------                          -------
              time.After(d)
                  |
                  v
              NewTimer(d) ----->     allocate runtimeTimer
                  |                  push onto P.timer heap
                  |                  return *Timer
                  |
                  | discard *Timer
                  | keep t.C
                  v
              case <-t.C:
                  |
                  | (the runtime walks the heap)
                  | (deadline expires)
                  v
              t.C receives ----- runtime sends Time on t.C
                                  remove from heap, free
```

If your code never receives from `t.C` (because the other `select` case wins), the runtime still holds the entry until the deadline, then fires it and discards the value (nobody is reading).

### Diagram 2: leak buildup

```
time →
  |
  | iter 0: alloc t0 (deadline t0+d)
  | iter 1: alloc t1 (deadline t1+d)
  | iter 2: alloc t2 (deadline t2+d)
  | ...
  | iter k: alloc tk (deadline tk+d)
  |
  | steady state: heap holds ~d/iter_interval timers
  v
```

If your loop iterates every 10ms and the timer duration is 5s, the heap holds 500 timers at any time.

### Diagram 3: fixed pattern

```
time →
  |
  | alloc t (deadline t+d)
  | defer t.Stop()
  |
  | iter 0: <-ch wins; (no allocation, no leak)
  | iter 1: <-ch wins; (no allocation, no leak)
  | ...
  | iter k: <-t.C wins; timeout
  | exit
  | defer runs: t.Stop() — true if not fired, false if fired. Either is fine.
  v
```

One allocation. One stop. Zero leaks. This is the entire junior-level moral of the story.

---

That is the junior level. The next file, `middle.md`, takes you into the patterns: `Reset` correctly, drain `t.C` before `Reset`, the false leak with `default`, and the nuances of `select { case <-time.After(d): }` over time.

---

## Appendix A: Step-by-Step Walkthrough of the Canonical Leak

This appendix walks through one full second of a leaky program, instruction by instruction, so you can see exactly what the runtime is doing when you write the bad pattern.

### Setup

We will trace this code:

```go
package main

import "time"

func main() {
    ch := make(chan int, 1)
    go func() {
        for {
            ch <- 1
        }
    }()
    for {
        select {
        case <-ch:
        case <-time.After(time.Hour):
        }
    }
}
```

The producer is so fast that `<-ch` will always win. The `time.After(time.Hour)` case never fires inside any reasonable runtime of the program.

### Iteration 0 — t = 0ns

1. Enter the `for` loop body.
2. Evaluate the case expressions of `select`. This is done before the actual selection.
3. The first case expression is `<-ch`: nothing to evaluate, just record the channel pointer.
4. The second case expression is `<-time.After(time.Hour)`: this CALLS `time.After`, which CALLS `time.NewTimer(time.Hour)`, which:
   - Allocates a `runtime.runtimeTimer` struct.
   - Allocates a `chan time.Time` of cap 1.
   - Computes the absolute deadline: `now + 1h`.
   - Pushes the timer onto the current P's timer heap.
   - Returns a `*time.Timer` that exposes the channel as `t.C`.
   - The temporary `*time.Timer` is unreferenced after `t.C` is extracted by the `<-` operator.
5. The `select` runs. `<-ch` is ready immediately, so it is taken. The other case is not.
6. The `select` exits. The receive on `time.After(time.Hour)` is abandoned.

But the runtime timer heap still has the entry. The channel `ch` from `time.After` is referenced by the runtime timer heap entry (the runtime needs it to send the time when the timer fires). It is NOT referenced by any user code after the select completes. On Go 1.22 and earlier, the runtime entry alone keeps both the timer and channel alive. On Go 1.23 the GC can reclaim them, but only at the next GC cycle.

### Iteration 1 — t = ~50ns

Same dance. Another `runtimeTimer`, another channel, both pushed onto the heap. Now the heap holds two entries for our loop.

### Iterations 2 through 1,000,000 — t = 50µs

If our hot loop runs at 50 ns per iteration, after 50µs we have a million entries in the runtime timer heap. All deadlined for ~1h from creation. All unreachable from user code (the user goroutine is in the next iteration).

### One hour later — t = 1h

The runtime walks the timer heap. The first entry's deadline has expired. The runtime sends `time.Now()` on the channel. Nobody is reading. The send fits in the channel's buffer of 1. Then it tries the second entry, same thing. The runtime starts firing them one at a time.

A million timer fires takes nontrivial time. Worse, on a busy server with multiple goroutines doing the same leak pattern, this firing burst can stall the runtime.

### Memory accounting

Each timer + channel pair costs roughly:

- `runtime.runtimeTimer`: ~88 bytes on 64-bit (varies by Go version).
- `hchan` with one slot of `time.Time` (24 bytes): ~120 bytes.
- Some heap header overhead: ~16 bytes total.

Total: ~224 bytes per leaked timer-and-channel pair.

A million leaks = ~224 MB of heap.

Service running for a day at 50 ns/iter = 1.7 × 10^15 iterations. We never actually accumulate that many because timers fire at the 1h mark and are reclaimed. Steady state at this loop rate is roughly `1h / 50ns = 7.2 × 10^10` entries — which would be 16 TB of heap. Of course, the process dies long before that.

In real production loops the iteration time is microseconds to milliseconds, and the timer durations are tens of seconds to minutes. So the steady-state heap entries are in the millions, not trillions, and we see "only" gigabytes of leak.

### Reality check

This is an extreme example. Real loops have real work — typically taking microseconds per iteration — and timeouts are typically tens of seconds. Realistic steady-state numbers:

- Loop iteration: 100 µs.
- Timer duration: 30 s.
- Steady state: 300,000 entries.
- Memory cost: ~70 MB.

70 MB sitting in your process for no reason. Plus the runtime cost of walking a heap with 300,000 entries every scheduling tick. Plus the firing storm when all 300,000 timers fire as the loop slowly exits.

---

## Appendix B: Visualising With `pprof`

We are still at the junior level, so let us look at the simplest possible pprof workflow.

### Step 1: instrument the program

```go
package main

import (
    "log"
    "net/http"
    _ "net/http/pprof"
    "time"
)

func main() {
    go func() {
        log.Println(http.ListenAndServe("localhost:6060", nil))
    }()

    ch := make(chan int, 1)
    go func() {
        for {
            ch <- 1
        }
    }()
    for {
        select {
        case <-ch:
        case <-time.After(time.Minute):
        }
    }
}
```

The blank import of `net/http/pprof` registers the pprof endpoints on the default HTTP mux. The goroutine on port 6060 serves them.

### Step 2: run for a while

```
$ go run main.go &
$ sleep 60
```

### Step 3: capture a heap profile

```
$ curl -s http://localhost:6060/debug/pprof/heap > heap.pprof
```

### Step 4: explore

```
$ go tool pprof -top heap.pprof
Showing nodes accounting for 95MB, 100% of 95MB total
      flat  flat%   sum%        cum   cum%
      52MB  54.7%  54.7%       52MB  54.7%  time.NewTimer
      43MB  45.3%   100%       43MB  45.3%  runtime.makechan
```

You will see `time.NewTimer` and `runtime.makechan` at the top of the in-use heap. That is the signature of a `time.After` leak.

### Step 5: confirm with `goroutine` and `allocs`

```
$ curl -s http://localhost:6060/debug/pprof/goroutine > g.pprof
$ go tool pprof -top g.pprof
```

A `time.After` leak does NOT show many goroutines. The leaks are pure memory, not blocked goroutines. If you see thousands of goroutines stuck in `chan receive`, you have a different leak (we cover that in the goroutine-leak chapter).

### Step 6: fix the program, re-run, re-capture

After the fix, the heap profile should not show `time.NewTimer` or `runtime.makechan` at the top.

---

## Appendix C: Why `time.After` Exists at All

Reasonable question: if `time.After` leaks so easily, why is it in the standard library at all?

The answer is twofold:

1. **For one-shot timeouts at the top level, it is the most ergonomic API in the language.** You cannot beat the readability of `case <-time.After(d):`.
2. **Historically, the assumption was that timer leaks were not serious.** When Go was new, server processes were short-lived, GC was less aggressive, and the runtime timer heap was a per-P resource that was assumed to scale. As Go services grew to run for months and timer heaps grew to hundreds of thousands of entries, the assumption broke.

The Go team has been gradually improving the situation. Go 1.23 is the biggest single change. Future Go releases may further reduce the cost of `time.After`. But the structural fix — use `NewTimer` + `Stop` — will always be correct.

---

## Appendix D: Frequently Asked Questions

### Q1: I have `time.After` in production code. How urgent is the fix?

It depends on:
- How long is the timeout? (Long timeouts = more leaked-timer-seconds.)
- How fast is the loop? (Fast loops = more leaks per second.)
- How long does the service run? (Restart frequency hides leaks.)

A simple test: capture `runtime.MemStats.HeapAlloc` at process start and after 1 hour of warmup. If it has grown by more than ~10 MB without explanation, treat it as urgent.

### Q2: Will `go vet` warn me about this?

Not by default. There is no built-in linter rule for `time.After` in loops. Some third-party linters (`govet`, `staticcheck`) have nascent checks, but none are reliable.

### Q3: I am on Go 1.23. Do I still need to fix?

Yes. The 1.23 GC improvements help, but they do not eliminate the leak inside `for-select` because the channel reference is still in scope during the select. They help when the goroutine has exited.

### Q4: My timer leak is in vendored code I cannot change.

Three options:
1. Pin a version of the dependency that does not have the leak.
2. Fork the dependency and fix it.
3. Wrap the leaky function so it is called less often (e.g., debounce calls).

Option 2 is usually the cleanest. File an upstream issue at the same time.

### Q5: Are timer leaks common in real code?

Very. Cloud services running at scale routinely discover them. The Go community has many published postmortems describing exactly this pattern.

### Q6: How can I prevent introducing new leaks?

- Code review: when reviewing PRs, search for `time.After` and ask "is this in a loop?".
- Linters: configure `staticcheck` with the appropriate rules.
- Tests: add `goleak` to your test suite.
- Patterns: standardise a helper like `NewBoundedTimer` in your codebase and use it consistently.

---

## Appendix E: A Day in the Life of a Leaked Timer

Let us anthropomorphise a single leaked timer to drive the lesson home.

### 09:00 — birth

You are a `runtimeTimer`. You were just allocated in the heap. Your deadline is set to 09:30. The runtime has placed you in the timer heap of `P3`. You have a sibling channel `*hchan` of capacity 1. A `*time.Timer` was returned to a goroutine in some user code.

### 09:00:00.000001 — abandonment

The goroutine that created you read the channel reference and entered a `select`. The `<-ch` case won. The select frame is unwound. The `*time.Timer` pointer your code had is gone — local variable out of scope, register reused. You are now anonymous.

### 09:00:00.0001 — second wave

Your creator goroutine is back in the same `for-select` body. It calls `time.After` again — allocating a new `runtimeTimer` (your sibling `t1`). Then again, `t2`. Then `t3`. Then `t4`. Soon there are hundreds of you.

### 09:00:00.01 — heap walk

The Go scheduler ticks. It walks `P3.timers` and checks deadlines. None expired yet — you are not due until 09:30. The walk has slight cost: it has to compare deadlines and check ownership. With 500 entries the walk is fast; with 500,000 it is not.

### 09:15 — heap pressure

The runtime allocator is doing a GC cycle. It scans roots, finds reachable objects, sweeps the unreachable. On Go 1.22 the GC does not know how to mark you for collection if your only "reference" is the runtime timer heap. So you survive. On Go 1.23, the GC has new code that can mark unreferenced timers for collection. If no goroutine has a reference to your channel, you can be removed from the heap mid-life.

In our example, the channel is referenced because the `select` frame is on a goroutine stack. Even though the goroutine has moved past your specific iteration, the runtime cannot easily prove your particular channel is unreachable. Practical effect: you live.

### 09:30 — fire

The deadline arrives. The runtime walks the heap, finds you at the front, fires:
1. Pop you from the heap.
2. Send `time.Now()` on your channel.
3. Mark your record as expired.

Nobody is reading from your channel. The send succeeds because the buffer is 1. Your channel now holds a value forever — until it is also GC'd.

Your `runtimeTimer` struct is now unreachable (the heap no longer references it; the user code never had a reference). The next GC collects you.

### 09:30:00.00001 — sibling fires

Your sibling `t1` is next. Same fate. The fire-storm continues for hundreds of microseconds as the runtime drains the backlog. During this time, the scheduler is busy and other goroutines run more slowly.

### 09:30:30 — finally clean

All siblings have fired. The heap is empty (until the next iteration of the leaky loop). Memory is reclaimed. Latency is back to normal.

### Lesson

Your existence was 30 minutes long. You did nothing useful. You held ~224 bytes. You contributed to scheduler latency for the 30 minutes of your life. Multiply by every leaked sibling, multiply by every leaky `select`, multiply by your service's uptime. That is the cost.

---

## Appendix F: Common Conversation Patterns When Diagnosing

The dialogue that often plays out when a leak is discovered:

**Engineer A (operator)**: "RSS climbed 200 MB overnight."

**Engineer B (developer)**: "Goroutine count?"

**A**: "Flat."

**B**: "Heap profile?"

**A**: pastes pprof top output

**B**: scans, sees `time.NewTimer` near top — "you have a `time.After` leak somewhere."

**A**: "Where?"

**B**: `grep -rn 'time.After' .`

**A**: shows 47 occurrences

**B**: filters — "show me the ones inside a `for`."

**A**: 3 occurrences.

**B**: "That is your leak. Replace with `NewTimer`."

**A**: fixes, deploys, watches memory.

**A**, 1 hour later: "Stable."

This is the script you want to run when you find a leak. It almost always works. The hardest part is matching the symptom (rising RSS) to the cause (`time.After` in a loop). Once you have made that mental link a few times, you spot it immediately.

---

## Appendix G: A Short Glossary of `pprof` Terms

When you start using `pprof` to find timer leaks, the output uses jargon. Quick reference:

- **`inuse_space`**: bytes currently allocated and not yet freed. The default `heap` profile.
- **`inuse_objects`**: count of allocations currently live.
- **`alloc_space`**: cumulative bytes allocated since the process started.
- **`alloc_objects`**: cumulative count of allocations.
- **flat**: bytes/objects allocated directly by this function.
- **cum**: bytes/objects allocated by this function or anything it called.

For a `time.After` leak, look at `inuse_space` and find `time.NewTimer` near the top. `flat` will be near zero (the function itself does not allocate much directly), but `cum` will be high.

---

## Appendix H: Connection to Other Concurrency Topics

Timer leaks rarely happen alone. They are usually one symptom in a broader concurrency design problem. The skill of fixing a timer leak is intertwined with the skill of designing the broader system:

- **Goroutine lifecycle**: if your goroutine has no clear exit path, your timers cannot be stopped cleanly.
- **Context propagation**: if you do not pass `context.Context`, you have nowhere to attach cancellation.
- **`select` design**: many timer leaks are byproducts of `select { case <-time.After(d): }` being the easiest way to add a timeout.
- **Resource ownership**: who owns the timer? A clear answer makes cleanup obvious.
- **Shutdown**: a clean shutdown drains all timers explicitly.

We will revisit each of these in `senior.md` and `professional.md`.

---

## Appendix I: Self-Quiz

1. Why does `time.After` leak in a `for-select` loop?
2. What is the type of the return value of `time.After`?
3. What is the return value of `time.NewTimer`?
4. What does `t.Stop()` return when the timer has already fired?
5. When is it safe to call `Reset(d)` on a `*time.Timer`?
6. Why is `time.Tick` considered an anti-pattern?
7. How do you detect a timer leak with `runtime.MemStats`?
8. What is the canonical `defer` line that pairs with `time.NewTimer`?
9. Does Go 1.23 fix every timer leak automatically?
10. When is `time.After` perfectly fine to use?

Answers:

1. Each iteration allocates a fresh `*Timer` whose underlying record is held by the runtime timer heap until the deadline expires; you cannot stop it because you do not have the pointer.
2. `<-chan Time`.
3. `*time.Timer`.
4. `false`.
5. After it has been stopped (or it has fired) and its channel has been drained.
6. There is no way to stop it; the ticker is held forever.
7. Run the suspect code in a loop, sample `HeapAlloc` and compare.
8. `defer t.Stop()`.
9. No. It helps unreferenced timers but does not free timers whose channel is still scoped.
10. One-shot timeouts at program/test/function entry where the leak window is bounded by a small duration and one allocation.

---

## Appendix J: Anti-Pattern Catalogue

A short catalogue you can carry into code reviews. Recognise these from a hundred feet away.

### Anti-pattern 1: `time.After` in `for-select`

```go
for {
    select {
    case x := <-in:
        _ = x
    case <-time.After(d):
        return
    }
}
```

### Anti-pattern 2: `time.Tick` anywhere

```go
for t := range time.Tick(d) {
    _ = t
}
```

### Anti-pattern 3: orphaned `AfterFunc`

```go
time.AfterFunc(d, func() { /* ... */ })  // return value ignored
```

### Anti-pattern 4: `Ticker` without `Stop`

```go
t := time.NewTicker(d)
for v := range t.C {
    // ...
}
// t.Stop() forgotten
```

### Anti-pattern 5: Reset without drain

```go
t := time.NewTimer(d)
// ... timer might have fired ...
t.Reset(d2)  // unsafe; old value may still be on t.C
```

### Anti-pattern 6: `time.After` for very long duration

```go
case <-time.After(24 * time.Hour):
```

### Anti-pattern 7: `time.After` in HTTP handlers

```go
func handler(w http.ResponseWriter, r *http.Request) {
    select {
    case <-r.Context().Done():
    case <-time.After(maxWait):
    }
}
```

### Anti-pattern 8: `time.After` for retries

```go
for i := 0; i < n; i++ {
    if try() == nil { return }
    <-time.After(backoff(i))
}
```

This last one looks innocent but creates `n` timers, each leaking until they fire. Use `NewTimer` to be safe:

```go
for i := 0; i < n; i++ {
    if try() == nil { return }
    t := time.NewTimer(backoff(i))
    <-t.C  // t.Stop not needed; we received from t.C, so timer expired naturally
}
```

If `backoff(i)` is short, the leak is small. If it grows to minutes, each leaked iteration is a problem.

---

## Appendix K: Beyond Junior

When you graduate to `middle.md` you will learn:

- How to safely call `Reset` (including the `Stop`+drain dance).
- The myth of the `default` clause "fixing" the leak.
- `select { case <-time.After(d): }` inside loops vs. outside.
- `time.AfterFunc` patterns in detail.

When you reach `senior.md` you will learn:

- The runtime timer heap data structure.
- Pre-1.23 pinning behaviour and exactly why it pinned.
- The 1.23 timer GC fix in detail.
- Reading `runtime/trace` output for timer activity.

When you reach `professional.md` you will learn:

- Production detection: pprof heap, custom telemetry, `goleak` integration.
- Real-world incident postmortems.
- Designing services that are leak-proof by construction.

Take your time at this level. Make sure the basic mental model is rock solid before moving on.

---

## Appendix L: Twenty Small Programs to Practice On

Each of the following programs either leaks timers or fixes a previous leak. Type them, run them, modify them. Active practice beats passive reading.

### Program 1

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

    select {
    case v := <-ch:
        fmt.Println("got", v)
    case <-time.After(time.Second):
        fmt.Println("timeout")
    }
}
```

Verdict: safe. One-shot timeout, no loop.

### Program 2

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    for i := 0; i < 100; i++ {
        select {
        case <-time.After(time.Hour):
        default:
            fmt.Println(i)
        }
    }
}
```

Verdict: leaks 100 timers, each held until the hour elapses. The `default` clause causes the select to be non-blocking, and each iteration evaluates `time.After(time.Hour)` even though we never read from it.

### Program 3

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    for i := 0; i < 100; i++ {
        t := time.NewTimer(time.Hour)
        select {
        case <-t.C:
        default:
            fmt.Println(i)
        }
        t.Stop()
    }
}
```

Verdict: still allocates 100 timers, but each is `Stop`ped immediately on the next line, so the runtime heap entry is released. No leak.

### Program 4

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    done := make(chan struct{})
    go func() {
        time.Sleep(2 * time.Second)
        close(done)
    }()
    ticker := time.NewTicker(500 * time.Millisecond)
    for {
        select {
        case t := <-ticker.C:
            fmt.Println("tick", t)
        case <-done:
            return
        }
    }
}
```

Verdict: leaks the ticker. `Stop()` is missing. The runtime keeps firing on a channel nobody reads, which on a long-lived program is a real leak. Fix: add `defer ticker.Stop()` after `time.NewTicker`.

### Program 5

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    done := make(chan struct{})
    go func() {
        time.Sleep(2 * time.Second)
        close(done)
    }()
    ticker := time.NewTicker(500 * time.Millisecond)
    defer ticker.Stop()
    for {
        select {
        case t := <-ticker.C:
            fmt.Println("tick", t)
        case <-done:
            return
        }
    }
}
```

Verdict: fixed. `defer ticker.Stop()` runs when the function returns.

### Program 6

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    for i := 0; i < 5; i++ {
        time.AfterFunc(time.Hour, func() {
            fmt.Println("late")
        })
    }
    time.Sleep(100 * time.Millisecond)
}
```

Verdict: leaks five timers and the closures they hold. The program exits 100ms later, so the OS cleans up — but if this pattern were inside a long-lived server, we would accumulate.

### Program 7

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    timers := make([]*time.Timer, 5)
    for i := 0; i < 5; i++ {
        timers[i] = time.AfterFunc(time.Hour, func() {
            fmt.Println("late")
        })
    }
    for _, t := range timers {
        t.Stop()
    }
}
```

Verdict: fixed. Each `*Timer` returned is captured and stopped.

### Program 8

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    msgs := make(chan int)
    go func() {
        for i := 0; ; i++ {
            msgs <- i
            time.Sleep(time.Millisecond)
        }
    }()

    timeout := 10 * time.Second
    for {
        select {
        case m := <-msgs:
            if m > 100 {
                return
            }
            fmt.Println(m)
        case <-time.After(timeout):
            return
        }
    }
}
```

Verdict: leaks ~101 timers (one per iteration where `<-msgs` won). Each holds for 10 seconds.

### Program 9

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    msgs := make(chan int)
    go func() {
        for i := 0; ; i++ {
            msgs <- i
            time.Sleep(time.Millisecond)
        }
    }()

    timeout := 10 * time.Second
    t := time.NewTimer(timeout)
    defer t.Stop()

    for {
        select {
        case m := <-msgs:
            if m > 100 {
                return
            }
            fmt.Println(m)
            if !t.Stop() {
                select {
                case <-t.C:
                default:
                }
            }
            t.Reset(timeout)
        case <-t.C:
            return
        }
    }
}
```

Verdict: fixed. Single timer, drained-and-reset on every message.

### Program 10

```go
package main

import (
    "fmt"
    "time"
)

func waitFor(ch <-chan int, d time.Duration) (int, bool) {
    select {
    case v := <-ch:
        return v, true
    case <-time.After(d):
        return 0, false
    }
}

func main() {
    ch := make(chan int)
    go func() {
        time.Sleep(10 * time.Millisecond)
        ch <- 1
    }()
    v, ok := waitFor(ch, time.Hour)
    fmt.Println(v, ok)
}
```

Verdict: `waitFor` is called once, but the timer is held until `time.Hour` elapses after the function returns. For a single one-off call this is acceptable. For a hot caller it is not.

### Program 11

```go
package main

import (
    "fmt"
    "time"
)

func waitFor(ch <-chan int, d time.Duration) (int, bool) {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case v := <-ch:
        return v, true
    case <-t.C:
        return 0, false
    }
}

func main() {
    ch := make(chan int)
    go func() {
        time.Sleep(10 * time.Millisecond)
        ch <- 1
    }()
    v, ok := waitFor(ch, time.Hour)
    fmt.Println(v, ok)
}
```

Verdict: fixed.

### Program 12

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()

    select {
    case <-ctx.Done():
        fmt.Println("done", ctx.Err())
    case <-time.After(time.Hour):
        fmt.Println("never")
    }
}
```

Verdict: the `time.After(time.Hour)` leaks for an hour after the function returns. `defer cancel()` cleans up the context's internal timer but not this `time.After`.

### Program 13

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()

    t := time.NewTimer(time.Hour)
    defer t.Stop()

    select {
    case <-ctx.Done():
        fmt.Println("done", ctx.Err())
    case <-t.C:
        fmt.Println("never")
    }
}
```

Verdict: fixed.

### Program 14

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    pending := make(map[int]*time.Timer)
    for i := 0; i < 1000; i++ {
        id := i
        pending[id] = time.AfterFunc(time.Hour, func() {
            fmt.Println("late", id)
        })
    }
    for id := 0; id < 500; id++ {
        if t, ok := pending[id]; ok {
            t.Stop()
            delete(pending, id)
        }
    }
    fmt.Println("kept", len(pending))
}
```

Verdict: half the timers are cancelled, half remain pending. The remaining 500 are intentional, so not a leak — but if `main` returned without stopping them, the process would exit and free them. In a long-lived service, you would stop all of them on shutdown.

### Program 15

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    for range time.Tick(time.Second) {
        fmt.Println("tick")
        if time.Now().Second()%10 == 0 {
            break
        }
    }
}
```

Verdict: leaks the underlying ticker. `time.Tick` returns a channel but no `*Ticker`, so no `Stop` is callable. The runtime keeps firing forever (until process exit). Fix: switch to `time.NewTicker` + `defer t.Stop()`.

### Program 16

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    deadline := time.Now().Add(5 * time.Second)
    for time.Now().Before(deadline) {
        select {
        case <-time.After(time.Hour):
        case <-time.After(time.Minute):
        case <-time.After(time.Second):
            fmt.Println("tick")
        }
    }
}
```

Verdict: three `time.After` calls per iteration, of which only the shortest will be received. The other two are abandoned and held for their respective durations.

### Program 17

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    deadline := time.Now().Add(5 * time.Second)
    one := time.NewTimer(time.Hour)
    two := time.NewTimer(time.Minute)
    three := time.NewTimer(time.Second)
    defer one.Stop()
    defer two.Stop()
    defer three.Stop()
    for time.Now().Before(deadline) {
        select {
        case <-one.C:
        case <-two.C:
        case <-three.C:
            fmt.Println("tick")
            three.Reset(time.Second)
        }
    }
}
```

Verdict: closer. Each timer is allocated once and reset only when fired. The `one` and `two` timers never fire and are stopped on defer. No leak across iterations.

### Program 18

```go
package main

import (
    "fmt"
    "time"
)

type request struct {
    id     int
    result chan int
}

func handler(r request) {
    select {
    case r.result <- r.id * 2:
    case <-time.After(10 * time.Second):
        // give up
    }
}

func main() {
    for i := 0; i < 1000; i++ {
        r := request{id: i, result: make(chan int, 1)}
        go handler(r)
        v := <-r.result
        fmt.Println(v)
    }
}
```

Verdict: leaks 1000 `time.After(10s)` calls because the result channel is buffered and always succeeds; the timer arm is never chosen. Each leaks for 10 seconds.

### Program 19

```go
package main

import (
    "fmt"
    "time"
)

type request struct {
    id     int
    result chan int
}

func handler(r request) {
    t := time.NewTimer(10 * time.Second)
    defer t.Stop()
    select {
    case r.result <- r.id * 2:
    case <-t.C:
    }
}

func main() {
    for i := 0; i < 1000; i++ {
        r := request{id: i, result: make(chan int, 1)}
        go handler(r)
        v := <-r.result
        fmt.Println(v)
    }
}
```

Verdict: fixed.

### Program 20

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    for i := 0; i < 100000; i++ {
        _ = time.After(time.Hour)
    }
    runtime.GC()
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("HeapAlloc: %d KiB\n", m.HeapAlloc/1024)
}
```

Verdict: stress test. Run on Go 1.22 vs Go 1.23 and compare. The numbers tell the story.

---

## Appendix M: Wrap-Up Mental Checklist

When you write or review code, run through this mental checklist:

1. **Is there a `time.After` here?** If yes, continue.
2. **Is it inside a loop, or inside a function called many times?** If no, leave it; if yes, fix.
3. **Is there a `time.Tick` here?** If yes, replace with `NewTicker` + `Stop`.
4. **Is there a `time.NewTicker` here?** If yes, find the matching `Stop()`. If absent, fix.
5. **Is there a `time.AfterFunc` here?** If yes, find the matching `Stop()`. If the timer should be allowed to fire, ensure the closure does not capture large objects.
6. **Is there a `time.NewTimer` here?** If yes, look for `defer t.Stop()` and `Reset` correctness.
7. **Is there a `context.WithTimeout` here?** If yes, find the matching `cancel()` call (usually `defer cancel()`).

Run that checklist on a 1000-line file and you will find every timer leak in it. With practice it takes ten seconds per file.

---

## Appendix N: Ten Real Code Reviews

Below are ten code snippets taken from typical Go projects. Each is followed by a junior-level review. Read the code, form your own opinion, then read the review.

### Review 1

```go
func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    select {
    case res := <-s.work(r):
        json.NewEncoder(w).Encode(res)
    case <-time.After(30 * time.Second):
        http.Error(w, "timeout", http.StatusGatewayTimeout)
    }
}
```

Review: this is an HTTP handler. It runs on every request. At 100 RPS, you leak 100 timers per second, each held for up to 30 seconds — so a steady state of 3,000 timers. At 1000 RPS, 30,000 timers. Fix:

```go
func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    t := time.NewTimer(30 * time.Second)
    defer t.Stop()
    select {
    case res := <-s.work(r):
        json.NewEncoder(w).Encode(res)
    case <-t.C:
        http.Error(w, "timeout", http.StatusGatewayTimeout)
    }
}
```

Even better: use `context.WithTimeout` from `r.Context()` to propagate cancellation.

### Review 2

```go
func (b *Buffer) Flush(ctx context.Context) error {
    for len(b.queue) > 0 {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(b.flushInterval):
            if err := b.flushOnce(); err != nil {
                return err
            }
        }
    }
    return nil
}
```

Review: `time.After` inside `for-select`. The leak is bounded by the loop length, but on a buffer that takes many iterations to drain it can add up. Also `<-ctx.Done()` may never win until the timer fires once. Fix with `NewTimer` and a `Reset` cycle, or rethink the design — do you really want to wait `flushInterval` between flushes when the buffer is already full?

### Review 3

```go
func (c *Client) Ping() error {
    res := make(chan error, 1)
    go func() {
        res <- c.do("ping")
    }()
    select {
    case err := <-res:
        return err
    case <-time.After(c.pingTimeout):
        return errors.New("ping timeout")
    }
}
```

Review: this looks fine for occasional calls. If `Ping` is called once per minute, no leak worth worrying about. If it is called once per second from a hot health-check loop, fix with `NewTimer` + `defer Stop`. Also note the goroutine leak risk: if `c.do` never returns, the goroutine leaks. That is outside our chapter but worth mentioning.

### Review 4

```go
func backoff(attempt int, base time.Duration) {
    <-time.After(base << attempt)
}

func retry(f func() error) error {
    for i := 0; i < 5; i++ {
        if err := f(); err == nil {
            return nil
        }
        backoff(i, time.Second)
    }
    return errors.New("exhausted")
}
```

Review: `backoff` always receives from the channel, so the timer fires and is collected. No leak. But if you want explicit `Stop`, prefer `NewTimer` + receive. Also, you might want a context to allow cancellation during long backoff.

### Review 5

```go
func watch(events <-chan Event, stale time.Duration) {
    for {
        select {
        case e := <-events:
            process(e)
        case <-time.After(stale):
            return
        }
    }
}
```

Review: classic leak. Every event resets nothing, every event allocates a new timer. Fix:

```go
func watch(events <-chan Event, stale time.Duration) {
    t := time.NewTimer(stale)
    defer t.Stop()
    for {
        select {
        case e := <-events:
            process(e)
            if !t.Stop() {
                select {
                case <-t.C:
                default:
                }
            }
            t.Reset(stale)
        case <-t.C:
            return
        }
    }
}
```

### Review 6

```go
type Worker struct {
    ticker *time.Ticker
    done   chan struct{}
}

func NewWorker() *Worker {
    return &Worker{
        ticker: time.NewTicker(time.Second),
        done:   make(chan struct{}),
    }
}

func (w *Worker) Run() {
    for {
        select {
        case <-w.ticker.C:
            doWork()
        case <-w.done:
            return
        }
    }
}

func (w *Worker) Stop() {
    close(w.done)
}
```

Review: ticker is created in `NewWorker` but never stopped. `Stop` only closes `done`. The ticker keeps firing forever (or until GC, which may never happen since `w` holds the ticker). Fix:

```go
func (w *Worker) Stop() {
    close(w.done)
    w.ticker.Stop()
}
```

Or use `defer w.ticker.Stop()` at the top of `Run`.

### Review 7

```go
func (s *Scheduler) Schedule(d time.Duration, f func()) {
    time.AfterFunc(d, f)
}
```

Review: API returns no handle. Caller cannot cancel the scheduled job. If `Schedule` is called many times with cancellation in mind, this is a leak. Fix:

```go
func (s *Scheduler) Schedule(d time.Duration, f func()) *time.Timer {
    return time.AfterFunc(d, f)
}
```

Now callers can `Stop()` the returned timer.

### Review 8

```go
func longPoll(ctx context.Context, ch <-chan Msg) (Msg, error) {
    select {
    case m := <-ch:
        return m, nil
    case <-ctx.Done():
        return Msg{}, ctx.Err()
    case <-time.After(30 * time.Second):
        return Msg{}, errors.New("server timeout")
    }
}
```

Review: this is in a long-poll handler. Called once per long-poll request. If long-polls last on average 15 seconds, half the time the `time.After` is held for the other 15 seconds. At 1000 concurrent long-polls, 7,500 leaked timer-seconds at any given moment. Fix with `NewTimer` + `defer Stop`.

### Review 9

```go
func (q *Queue) Push(item Item) {
    select {
    case q.ch <- item:
    case <-time.After(time.Millisecond):
        q.dropCount++
    }
}
```

Review: a millisecond timer per push. Tiny duration, fires fast. The leak window is 1ms. At 100k pushes/s, you have 100 timers in the heap at any moment — manageable. But still, the `time.After` allocation cost dominates the cheap channel send. Fix with `NewTimer` + `Reset`, or use a non-blocking send with `default`:

```go
func (q *Queue) Push(item Item) {
    select {
    case q.ch <- item:
    default:
        q.dropCount++
    }
}
```

`default` is cheaper. Only choose the timer pattern if you need to block for a tiny moment to absorb bursts.

### Review 10

```go
func (s *Service) periodicDump() {
    for range time.Tick(time.Hour) {
        s.dump()
    }
}
```

Review: `time.Tick` cannot be stopped. If `periodicDump` is launched once at program start and runs forever, this is acceptable — the OS will reclaim the process state on exit. If `periodicDump` is launched per-instance and instances can be torn down, this is a leak. Replace with `time.NewTicker` and `Stop` on shutdown.

---

## Appendix O: Anti-Pattern Detection With grep

You will find most leaks with three grep commands. Memorise these.

### Search 1: `time.After` inside any `for` block

```
grep -B1 -A5 -n 'time.After' yourpkg/*.go | grep -B5 -A1 'for '
```

This is a rough filter. Manual inspection is required to confirm the `time.After` is inside the `for` block, not just nearby.

### Search 2: `time.Tick` usage

```
grep -rn 'time.Tick(' .
```

Almost every match is a bug. The only acceptable use is in toy code or short scripts.

### Search 3: `time.NewTicker` without `Stop`

```
grep -A20 -rn 'time.NewTicker' . | grep -B20 'Stop()'
```

This is harder to automate; the `Stop()` may live far from the `NewTicker`. Visual inspection of each `NewTicker` call site to confirm Stop.

### Search 4: `time.AfterFunc` with discarded return

```
grep -rn 'time.AfterFunc(' . | grep -v '='
```

Lines that call `AfterFunc` but do not assign the result are very likely leaks-in-the-making.

### Search 5: `context.WithTimeout` without `cancel()`

```
grep -A1 -rn 'context.WithTimeout' . | grep -v 'cancel'
```

Every `context.WithTimeout` should be paired with a `defer cancel()` within a few lines.

---

## Appendix P: A Mini-Library You Will Write Repeatedly

Most large Go codebases end up with a small helper file that wraps the leak-prone idioms. Here is a starter version. Copy it into your project, tweak it to taste.

```go
// pkg/timeoututil/timeoututil.go
package timeoututil

import (
    "context"
    "errors"
    "time"
)

// ErrTimeout is returned when an operation exceeds its budget.
var ErrTimeout = errors.New("operation timed out")

// Run runs f under a timeout. The timer is always Stopped, so this function
// does not leak timers under any path.
func Run(d time.Duration, f func() error) error {
    done := make(chan error, 1)
    go func() { done <- f() }()
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case err := <-done:
        return err
    case <-t.C:
        return ErrTimeout
    }
}

// RunCtx is like Run but respects an external context as well.
func RunCtx(ctx context.Context, d time.Duration, f func() error) error {
    done := make(chan error, 1)
    go func() { done <- f() }()
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case err := <-done:
        return err
    case <-t.C:
        return ErrTimeout
    case <-ctx.Done():
        return ctx.Err()
    }
}

// LoopWithIdle runs body() in a loop and exits when idle exceeds d. The
// timer is reused across iterations to avoid the time.After leak.
func LoopWithIdle(d time.Duration, ready <-chan struct{}, body func()) {
    t := time.NewTimer(d)
    defer t.Stop()
    for {
        select {
        case <-ready:
            body()
            if !t.Stop() {
                select {
                case <-t.C:
                default:
                }
            }
            t.Reset(d)
        case <-t.C:
            return
        }
    }
}
```

Once this file is in your project, the lazy-but-correct path becomes:

```go
import "yourorg/pkg/timeoututil"

if err := timeoututil.Run(5*time.Second, doIt); err != nil {
    return err
}
```

Reviewers can spot the helper at a glance. The leaky pattern stops creeping back in.

---

## Appendix Q: Five Things That Are NOT Timer Leaks

To balance the catalogue of leaks, here are five patterns that look suspicious but are fine.

### Not-a-leak 1: `time.Sleep`

```go
time.Sleep(d)
```

Does not allocate a user-visible `*Timer`. Internally the runtime sleeps the goroutine on a per-G data structure. When the duration elapses, the goroutine resumes. Single per-goroutine cost, no leak.

### Not-a-leak 2: `time.After` once, in `main`

```go
func main() {
    <-time.After(10 * time.Second)
    fmt.Println("done")
}
```

One allocation, deterministically fires, then GC'd. Fine.

### Not-a-leak 3: `time.Now`

```go
n := time.Now()
```

Returns a `time.Time` value. No allocation in the runtime timer heap. Cannot leak.

### Not-a-leak 4: `time.Since` and `time.Until`

```go
elapsed := time.Since(start)
```

Pure arithmetic. No timers involved. Cannot leak.

### Not-a-leak 5: a `*time.Timer` that always fires before the loop iterates again

```go
t := time.NewTimer(time.Millisecond)
for i := 0; i < 100; i++ {
    <-t.C
    t.Reset(time.Millisecond)
}
```

Each iteration: receive (timer fired), reset. The receive guarantees the channel is drained before reset. No leak — but only because we are sure the timer fires before each iteration. The middle file explains why this assumption can break.

---

## Appendix R: Glossary Round Two

| Term | Definition |
|---|---|
| Pinned | Held alive by some reference. A "pinned timer" is one the GC cannot collect. |
| Heap entry | A row in the runtime's timer heap. Each `*time.Timer` corresponds to one entry until it fires or is stopped. |
| Steady state | The equilibrium count of leaked timers in your heap, given a constant leak rate and timer duration. |
| Drain | To receive any pending value from `t.C`, typically before `Reset`. |
| Reset | `t.Reset(d)`: schedule the timer to fire at `now+d`. Safe only on a stopped or expired+drained timer. |
| One-shot | A timer that fires exactly once and is then discarded. The common case. |
| Hot path | Code that runs at high frequency in production. Allocations in hot paths multiply quickly. |
| Idle timeout | A timeout that resets on each new event. The classic `for-select { case <-event: case <-t.C: }` shape. |
| Backoff | An increasing delay between retry attempts, e.g., 1s, 2s, 4s, 8s. |

---

## Appendix S: Eight Phrases to Remember

1. "`time.After` allocates."
2. "Loops want reused timers."
3. "`defer t.Stop()` is free insurance."
4. "`time.Tick` is the trap."
5. "Closures in `AfterFunc` pin memory."
6. "Stop returns false when it already fired."
7. "1.23 helps but does not save you."
8. "Memory rising is the smoking gun."

Drill these. They are the junior-level mantra.

---

End of junior level.



