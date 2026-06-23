---
layout: default
title: Junior
parent: Ticker
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/01-ticker/junior/
---

# time.Ticker — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros and Cons](#pros-and-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use](#product-use)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
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
29. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction

> Focus: "How do I run a piece of code every N milliseconds and stop cleanly when I am done?"

A `time.Ticker` is the Go standard-library tool for doing the same thing again and again on a steady beat. It exposes a single channel, named `C`, on which the runtime sends the current time at the requested interval. You read from that channel inside a loop. When you no longer need the ticker, you call `Stop`. That is the entire surface area of the type.

```go
t := time.NewTicker(500 * time.Millisecond)
defer t.Stop()
for now := range t.C {
    fmt.Println("tick at", now)
}
```

Five lines, three responsibilities: construct, consume, dispose. Almost every misuse of `time.Ticker` is a violation of one of those three responsibilities.

After this file you will be able to:

- Construct a `time.Ticker` with the duration you want.
- Read tick values from its `C` channel correctly.
- Stop a ticker so it does not leak goroutines or memory.
- Combine `t.C` with `ctx.Done()` in a `select` to make the loop cancellable.
- Recognise the most common first-time bugs: forgotten `Stop`, zero or negative duration, reading from `C` inside a range that never breaks, ticker started before the consumer.

You do not yet need to know about `Reset`, monotonic-clock guarantees, the runtime timer heap, or jittered scheduling. Those belong to the middle and senior files. This file is everything you need to type `time.NewTicker` into your editor and not regret it five minutes later.

> A note on terminology. In conversation Go programmers use "tick", "fire", and "wake-up" interchangeably. They all mean: the runtime sends a value on the ticker's channel. The receiver may or may not observe it — that part matters and is covered carefully below.

---

## Prerequisites

- **Required:** a working Go toolchain, version 1.18 or newer. Run `go version` to check. Examples here compile on 1.20 and above without modification; a couple of footnotes mention 1.23-specific behaviour.
- **Required:** comfort writing and running a `main` function, importing packages, and starting a goroutine with the `go` keyword.
- **Required:** an understanding of channel receive on a `<-chan` and the syntax `for x := range ch`.
- **Recommended:** familiarity with `select` statements, even at a sketchy level. The canonical ticker loop is built around `select`.
- **Recommended:** awareness that `context.Context` is the standard cancellation primitive. We use it lightly in this file.

If you can write a goroutine that prints "hello" inside an infinite loop and stops when a `done` channel is closed, you have every prerequisite covered.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`time.Ticker`** | A struct in the standard library holding a receive-only channel `C` on which the runtime sends ticks at a fixed interval. |
| **Tick** | A single value sent on `t.C`. The value is a `time.Time` representing the moment the tick was queued. |
| **Interval** | The `time.Duration` between consecutive ticks. Set at construction with `NewTicker` and changeable later with `Reset`. |
| **`NewTicker(d)`** | The constructor. Returns a `*time.Ticker`. Panics if `d <= 0`. |
| **`Stop`** | The method that releases the runtime resources associated with a ticker. Required for cleanup. Does *not* close the channel. |
| **`Reset(d)`** | The method that changes the ticker's interval, added in Go 1.15. Does not flush any tick already queued on the channel. |
| **`C`** | The `<-chan time.Time` field on the `Ticker` value. The only way to observe ticks. Buffered with capacity 1 prior to Go 1.23; in 1.23+ the buffer remains 1 but GC interactions changed. |
| **Drift** | Cumulative timing error: after N ticks the actual elapsed wall time may be slightly more or less than `N * interval`. For `time.Ticker` the runtime corrects most drift internally. |
| **Jitter** | The per-tick variance around the requested interval. A ticker set to 100 ms will not deliver at *exactly* 100 ms; it may deliver at 100.4 ms, 99.8 ms, and so on. |
| **Slow consumer** | A receiver that does not call `<-t.C` fast enough to keep up. Because `t.C` has a buffer of one, additional ticks are *dropped*, not queued. |
| **Goroutine leak** | A goroutine that lives forever because the loop it sits in never exits. A ticker without a cancellation branch is a textbook source. |
| **Monotonic clock** | A clock that always moves forward, immune to wall-clock adjustments (NTP, daylight-saving, manual changes). `time.Now()` includes a monotonic reading and so does the value the ticker sends. |
| **`time.Tick(d)`** | A package-level helper that returns just the `<-chan time.Time`, with no way to stop. Convenient but **leaks** if you ever need to release the ticker. Avoid in long-running code. |

Keep this table beside you while reading the code examples; we use these terms with precision.

---

## Core Concepts

### A ticker is a goroutine you do not see

The mental shortcut: when you call `time.NewTicker(d)`, the runtime schedules an internal task that wakes up every `d` and writes the current time to a channel. You do not start the goroutine; the runtime manages it. You do not stop the goroutine directly; you stop it indirectly by calling `t.Stop()`.

Concretely, every running ticker holds a slot in the runtime's timer heap (covered in the senior file). The slot is what costs memory and CPU. `Stop` releases the slot. Forgetting `Stop` means the slot stays, the wake-ups keep firing, and the channel keeps being written to.

### The channel `C` is buffered with capacity 1

`Ticker.C` is declared roughly as `C <-chan time.Time` and constructed with `make(chan time.Time, 1)`. The buffer of one matters: if a tick arrives while the previous tick is still sitting unread in the channel, the runtime *drops* the new tick. It does not block, it does not queue. The receiver simply observes ticks more slowly than it asked for.

This is a feature, not a bug. A ticker is supposed to express "I want a regular heartbeat" — not "I want guaranteed delivery of every single tick." If you absolutely cannot miss a tick you are using the wrong primitive (consider a counter and a worker that increments per tick, with backpressure outside the channel).

### `NewTicker` panics on zero or negative duration

```go
t := time.NewTicker(0) // panics
t := time.NewTicker(-1 * time.Second) // panics
```

The runtime cannot construct a ticker that fires "every zero seconds" or "every negative second" — both are nonsensical. The panic is intentional and shipped as `"non-positive interval for NewTicker"`. Validate user-supplied durations before passing them in.

### `Stop` does not close `C`

This is the single most surprising behaviour for newcomers. `t.Stop()` halts further ticks but the channel remains open. A subsequent `<-t.C` will block forever.

```go
t := time.NewTicker(time.Second)
t.Stop()
<-t.C // may receive one queued tick, or block forever
```

The rule: after `Stop`, do not read from `t.C` unless you are draining a leftover value, and even then do so non-blockingly (`select` with a `default`). The reason for this design is so that calling `Stop` is safe from any goroutine without coordinating with the consumer.

### Ticks carry a `time.Time` value

Every tick is a `time.Time`, the moment the tick was *queued* by the runtime, not the moment your receive happened. If your handler runs for 200 ms after a 100 ms ticker fires, the next received tick may carry a timestamp from 100 ms ago, not "now." Always use `time.Now()` if you want "the time my handler started," and use the tick value if you want "the time the runtime intended to fire."

```go
for now := range t.C {
    log.Printf("scheduled at %v, handler started at %v\n", now, time.Now())
}
```

### `time.Tick` is the convenience function. It cannot be stopped.

`time.Tick(d)` returns the channel directly without giving you a `*Ticker`. The runtime allocates a hidden ticker that lives forever — there is no way to release it.

```go
ch := time.Tick(time.Second)
for range ch {
    fmt.Println("tick")
}
```

For one-off command-line tools that run forever this is fine. For anything that should ever clean up — a request handler, a long-running daemon, a unit test — this is a guaranteed leak. Use `NewTicker` + `Stop`.

> The runtime documentation specifically warns about this: "The underlying Ticker cannot be recovered by the garbage collector; it 'leaks'." Until Go 1.23 the leak was unconditional; from 1.23 onwards an unreferenced `Ticker` *can* be reclaimed even if `Stop` was not called, because the runtime no longer pins it. We cover this carefully in the senior file. For now, treat `time.Tick` as a smell unless the use is genuinely program-lifetime.

### The canonical loop has three branches

The canonical ticker loop:

```go
func loop(ctx context.Context, t *time.Ticker) {
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            handle(now)
        }
    }
}
```

Three things to notice:

1. The `for { select { ... } }` structure with no break clause and no labels.
2. `ctx.Done()` is listed *first* in the `select`. The order of cases in `select` does not affect priority — Go's `select` picks randomly among ready cases — but listing cancellation first is the convention and the right one to follow for readability and consistency with the rest of the standard library.
3. The handler `handle(now)` is called from inside the `select` body. The interval between handler returns is not strictly equal to the interval the ticker was constructed with: if the handler takes 80 ms and the ticker is set to 100 ms, the next iteration starts 100 ms after the *tick fired*, which may be only 20 ms after the handler returned.

### One `*Ticker` per goroutine

A `*time.Ticker` is not safe to share across goroutines for concurrent reads in any useful way. Two goroutines both receiving from `t.C` would split the ticks unpredictably between them — each tick is consumed by exactly one receiver. If you want N parallel workers triggered on a beat, fan out: one goroutine receives from `t.C` and sends to a worker channel.

```go
ticks := make(chan time.Time)
go func() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for now := range t.C {
        ticks <- now
    }
}()
for i := 0; i < 4; i++ {
    go worker(ticks)
}
```

---

## Real-World Analogies

### A ticker is a metronome

A metronome on a piano stand clicks at a steady tempo. The pianist plays in time with the click. If the pianist falls behind and misses a click, the next click still arrives on schedule — the metronome does not pause to wait. If the pianist closes the lid (`Stop`), the metronome stops clicking.

The buffer of one is the only place where the analogy strains: a metronome does not "drop" beats; the room hears every click whether or not the pianist plays. The channel buffer of one is closer to "the pianist's brain only remembers the last click she heard."

### A ticker is a kitchen timer that auto-resets

You set a kitchen timer for five minutes. It rings, you check the oven, the timer resets itself, five minutes later it rings again, you check the oven. You did not set it manually each time. When you take the chicken out, you press the off button (`Stop`).

This analogy captures `NewTicker` exactly: a self-resetting alarm. Compare with `time.Timer` (covered in the timer subsection), which is a one-shot timer.

### A ticker is a payroll cycle

A company runs payroll every other Friday. The bookkeeper does not have to remember; the calendar fires the event. If the bookkeeper is on vacation when a payroll Friday arrives, the payroll still happens (the runtime still sends the tick). What does not happen is *two* payrolls in one Friday because she missed last time — the ticker has buffer one.

### A ticker is the school bell

A school bell rings at fixed intervals. Students sometimes are mid-thought when it rings; the bell does not wait. When summer break begins, the principal disables the bell schedule (`Stop`). Forgetting to disable it (e.g., the school is closed but the bell still rings on summer Saturdays) annoys the neighbours — analogous to a leaked ticker continuing to fire in a program that has "logically" moved on.

---

## Mental Models

### Mental model 1: "the runtime is a separate program writing to your channel"

When you call `NewTicker(100 * time.Millisecond)`, imagine you spawned an invisible goroutine that does:

```go
go func() {
    for {
        time.Sleep(100 * time.Millisecond)
        select {
        case t.C <- time.Now(): // try to send; drop if full
        default:
        }
    }
}()
```

That is not literally how the runtime implements it (the real implementation uses a timer heap, not a sleeping goroutine — see senior file). But the *observable behaviour* matches this model. If you internalise it, you correctly predict that a slow consumer drops ticks and that `Stop` "kills the goroutine."

### Mental model 2: "the channel is a mailbox of capacity one"

`t.C` is a mailbox slot. Every interval the runtime tries to drop a postcard in. If the slot is empty, the postcard goes in. If the slot has yesterday's postcard, the new postcard is discarded. The receiver pulls postcards out at their own pace. You get the most recent dropped postcard but you can never get two postcards in a row without consuming.

### Mental model 3: "Stop releases a resource"

A `*Ticker` is closer to a file handle than to a goroutine. You acquire it with `NewTicker`, you release it with `Stop`. Forgetting `Stop` is forgetting `Close`. The runtime cleans up timer heap entries when `Stop` runs and (since Go 1.23) when the `*Ticker` becomes unreferenced — but relying on garbage collection for resource cleanup is poor practice.

### Mental model 4: "ticks are pulses, not events"

A pulse is information about time, not about content. The body of the tick is just `time.Now()` at the moment it fired; the ticker does not carry any payload of its own. If you find yourself wanting "a ticker that delivers structured events," what you actually want is a goroutine that converts ticks into events on a domain channel.

---

## Pros and Cons

### Pros

- **Simple API.** `NewTicker`, `Stop`, `C`. Three lines of mental load.
- **Standard library.** Zero dependencies, ships with Go.
- **Cheap.** A ticker costs roughly one entry in the runtime timer heap (a few hundred bytes) plus the buffered channel (a slot for one `time.Time`, sixteen bytes). Spawning a few thousand simultaneously is reasonable.
- **Monotonic.** The interval is measured against the monotonic clock, so wall-clock adjustments do not break the schedule. If your system clock jumps backwards by an hour, your one-second ticker does not pause for an hour; it keeps firing once per second.
- **Composable with `select`.** Because `t.C` is a channel, it slots cleanly into the standard `select` pattern with cancellation and other inputs.

### Cons

- **No backpressure.** A slow consumer silently loses ticks. There is no signal that you missed one.
- **No guarantee on exact timing.** Ticks may fire late under scheduler pressure or when the GC is busy. Do not use for hard-real-time work.
- **Stop is mandatory.** Forgetting it leaks runtime resources. The compiler does not warn you.
- **No structured cancellation.** You wire cancellation in yourself with `context.Context` or a `done` channel. Tickers are not context-aware out of the box.
- **`Reset` has subtle semantics.** Before Go 1.15 it did not exist; from 1.15 on it does not drain the channel; in some edge cases an old tick may sneak through after a `Reset`. Junior code should generally just `Stop` and `NewTicker` again.
- **`time.Tick` leaks.** The package-level helper is convenient but resource-hostile.

---

## Use Cases

| Scenario | Suitable? | Notes |
|---|---|---|
| Heartbeat in a long-running service | Yes | Combine with `ctx.Done()`. |
| Polling an external API every minute | Yes | Add jitter for distributed callers. |
| Flushing in-memory metrics every five seconds | Yes | Slow consumers may drop ticks; this is fine for flush logic since the next flush catches up. |
| Animating UI at 60 fps | Maybe | Real animation systems use `display vsync`, not generic tickers. For a Go terminal app, `time.Ticker` is acceptable. |
| One-shot delay of two seconds before retrying | No | Use `time.AfterFunc` or `time.NewTimer`. |
| Hard-real-time control (motor PID, audio) | No | Go's GC and scheduler do not give the timing guarantees you need. Use a real-time OS and a different language. |
| Periodic GC of an in-memory cache | Yes | Standard use. |
| Triggering an event after N seconds of inactivity | No | That is debounce, not periodic. See [`05-debounce-throttle`](../05-debounce-throttle/). |
| Implementing exponential backoff | No | Variable intervals demand `time.Timer.Reset`, not a fixed-interval ticker. See [`04-exponential-backoff`](../04-exponential-backoff/). |
| Counting elapsed seconds in a stopwatch | Maybe | Works, but `time.Since(start)` is simpler. |

The pattern: tickers are for *uniform repetition*. Anything one-shot, variable, or driven by an external event uses a different primitive.

---

## Code Examples

### Example 1: the canonical heartbeat

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func heartbeat(ctx context.Context, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            fmt.Printf("alive at %s\n", now.Format("15:04:05.000"))
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()
    heartbeat(ctx, 500*time.Millisecond)
}
```

Output, approximate:

```
alive at 12:00:00.500
alive at 12:00:01.000
alive at 12:00:01.500
alive at 12:00:02.000
alive at 12:00:02.500
alive at 12:00:03.000
```

Things to notice:

- `defer t.Stop()` is on the line immediately after construction. Pair these like `Open`/`Close`.
- The select reads `ctx.Done()` first and ticks second.
- Six ticks in three seconds is exactly right for a 500 ms interval — the first tick fires at 500 ms after the `NewTicker` call, not at 0 ms. The first tick is *not* immediate.

### Example 2: the first tick is delayed

If you want one tick immediately and then every interval, you must do it yourself:

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(time.Second)
    defer t.Stop()

    // immediate first tick
    fmt.Println("tick", time.Now().Format("15:04:05"))

    for i := 0; i < 3; i++ {
        <-t.C
        fmt.Println("tick", time.Now().Format("15:04:05"))
    }
}
```

This is a very common requirement — "do the thing now, then again every interval" — and forgetting it leads to the bug "my service is slow to start its first health-check."

### Example 3: stopping correctly from another goroutine

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    t := time.NewTicker(200 * time.Millisecond)
    done := make(chan struct{})

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for {
            select {
            case <-done:
                return
            case now := <-t.C:
                fmt.Println("tick", now.Format("15:04:05.000"))
            }
        }
    }()

    time.Sleep(time.Second)
    close(done)
    t.Stop()
    wg.Wait()
}
```

Order matters: the consumer goroutine exits on `done`, then we `Stop`, then we `Wait`. If we `Stop` before `close(done)`, the consumer might race to read a leftover value from `t.C`. The pattern is safe but the order is worth memorising.

### Example 4: a ticker with cancellation via context

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func poll(ctx context.Context, url string, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            fmt.Println("poll stopped:", ctx.Err())
            return
        case <-t.C:
            fmt.Println("would fetch", url)
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    poll(ctx, "http://example.com/health", 400*time.Millisecond)
}
```

`context.WithTimeout` produces a `Done` channel that closes after two seconds. The poll loop sees `ctx.Done()` and returns. The `defer t.Stop()` then runs and releases the timer.

### Example 5: handling a slow consumer

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()

    end := time.After(time.Second)
    received := 0
    for {
        select {
        case <-end:
            fmt.Println("received", received, "ticks in 1 second")
            return
        case <-t.C:
            received++
            time.Sleep(150 * time.Millisecond) // simulate slow handler
        }
    }
}
```

With a 100 ms ticker and a 150 ms handler the consumer cannot keep up. The runtime drops the extra ticks. You will see something like `received 7 ticks in 1 second`, not ten. This is the *correct* behaviour of `time.Ticker`. If you needed all ten you would not use a buffered channel of capacity one.

### Example 6: counting ticks for a known duration

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()

    after := time.NewTimer(550 * time.Millisecond)
    defer after.Stop()

    n := 0
    for {
        select {
        case <-after.C:
            fmt.Println("got", n, "ticks")
            return
        case <-t.C:
            n++
        }
    }
}
```

This pattern shows both `time.Ticker` and `time.Timer` cohabiting in a `select`. `Timer` is one-shot, `Ticker` repeats. Their roles complement each other.

### Example 7: stopping a ticker also stops queued goroutines (or does it?)

A common confusion. `Stop` only stops the runtime from sending more ticks. It does *not* stop a goroutine that is blocked on `<-t.C`. Watch:

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(time.Second)

    go func() {
        for now := range t.C {
            fmt.Println("got", now)
        }
        fmt.Println("range exited")
    }()

    time.Sleep(2500 * time.Millisecond)
    t.Stop()
    fmt.Println("stopped at", time.Now().Format("15:04:05"))

    time.Sleep(2 * time.Second)
    fmt.Println("exit main")
}
```

Output approximate:

```
got 12:00:01...
got 12:00:02...
stopped at 12:00:02
exit main
```

Note "range exited" never prints. The for-range loop on `t.C` blocks forever because `Stop` does not close the channel. The goroutine is leaked. To exit, you must either close the channel manually (don't — you do not own it) or use a `select` with a `done` branch.

This is the leak you write a thousand times before learning. The cure is the canonical `for { select { case <-done: return ...} }` pattern, never `for range t.C`.

### Example 8: using `time.Tick` for short scripts only

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    for now := range time.Tick(time.Second) {
        fmt.Println(now)
    }
}
```

This works as a heartbeat script that runs until killed. It leaks the underlying ticker but the leak is bounded by the lifetime of the program. For a real service this is not acceptable; use `NewTicker`.

### Example 9: a ticker that prints elapsed seconds

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(time.Second)
    defer t.Stop()

    start := time.Now()
    for range 5 {
        <-t.C
        fmt.Printf("%.1f s elapsed\n", time.Since(start).Seconds())
    }
}
```

(`for range 5` uses Go 1.22+ integer range. On older versions write `for i := 0; i < 5; i++`.)

Notice we use `time.Since(start)` rather than the tick value to format elapsed time. The tick value is when the runtime *intended* to fire, which may be milliseconds before our handler observes the receive. `time.Since(start)` is the observed elapsed wall time. Pick whichever serves your intent.

### Example 10: multiple tickers in one select

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    fast := time.NewTicker(300 * time.Millisecond)
    defer fast.Stop()
    slow := time.NewTicker(900 * time.Millisecond)
    defer slow.Stop()

    end := time.After(2 * time.Second)
    for {
        select {
        case <-end:
            return
        case now := <-fast.C:
            fmt.Println("fast at", now.Format("15:04:05.000"))
        case now := <-slow.C:
            fmt.Println("slow at", now.Format("15:04:05.000"))
        }
    }
}
```

Two tickers, one select. `select` chooses randomly among ready cases, but because the fast one fires three times more often, the fast prints dominate. There is no priority mechanism; if you need one, peek at the slow first via a non-blocking receive before falling back to a full `select`.

### Example 11: a "do once and start ticker" helper

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func every(ctx context.Context, interval time.Duration, fn func()) {
    fn() // immediate
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            fn()
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    every(ctx, 700*time.Millisecond, func() {
        fmt.Println("ping at", time.Now().Format("15:04:05.000"))
    })
}
```

This wraps the "do once and then on the interval" idiom. Common enough in production utility libraries that many teams have their own version.

### Example 12: testing a ticker without waiting in real time

Real-time tests are flaky. The standard trick is to take an interface or function for "now":

```go
package mytimer

import "time"

type Clock interface {
    Now() time.Time
    NewTicker(time.Duration) Ticker
}

type Ticker interface {
    C() <-chan time.Time
    Stop()
    Reset(time.Duration)
}

// realClock is the production implementation.
type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

type realTicker struct{ t *time.Ticker }

func (r realTicker) C() <-chan time.Time     { return r.t.C }
func (r realTicker) Stop()                   { r.t.Stop() }
func (r realTicker) Reset(d time.Duration)   { r.t.Reset(d) }

func (realClock) NewTicker(d time.Duration) Ticker {
    return realTicker{time.NewTicker(d)}
}
```

You then mock `Clock` in tests so you can fire ticks deterministically. We expand on this in the middle file and present it more fully in [`unit-testing-patterns`](../../../../../../../skills/unit-testing-patterns/). For now, just be aware that production code should consider this seam before it grows roots.

---

## Coding Patterns

### Pattern: construct, defer-Stop, loop

```go
t := time.NewTicker(d)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        // work
    }
}
```

Memorise the shape. Variants — multiple cases, different cancellation source — are still built on this skeleton.

### Pattern: ticker as a periodic flusher

```go
type Buffer struct {
    mu    sync.Mutex
    items []Item
}

func (b *Buffer) Add(it Item) {
    b.mu.Lock()
    b.items = append(b.items, it)
    b.mu.Unlock()
}

func (b *Buffer) Flush(ctx context.Context, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            b.flushOnce()
            return
        case <-t.C:
            b.flushOnce()
        }
    }
}

func (b *Buffer) flushOnce() {
    b.mu.Lock()
    batch := b.items
    b.items = nil
    b.mu.Unlock()
    // send batch
    _ = batch
}
```

Notice the final flush on cancellation — without it, anything added in the last sub-interval is lost. This is a common requirement: "flush periodically but also drain on shutdown."

### Pattern: rate-controlled producer

```go
func Producer(ctx context.Context, out chan<- int, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    n := 0
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            select {
            case out <- n:
                n++
            case <-ctx.Done():
                return
            }
        }
    }
}
```

The inner `select` handles a slow consumer of `out`. If `out` blocks longer than `ctx`'s lifetime we still exit promptly.

### Pattern: ticker plus deadline

```go
func PollUntil(ctx context.Context, interval time.Duration, deadline time.Time, fn func() bool) bool {
    t := time.NewTicker(interval)
    defer t.Stop()
    after := time.NewTimer(time.Until(deadline))
    defer after.Stop()
    for {
        if fn() {
            return true
        }
        select {
        case <-ctx.Done():
            return false
        case <-after.C:
            return false
        case <-t.C:
        }
    }
}
```

`fn` is checked before the wait, so we never sleep if the condition is already true. `Timer.Stop` is paired alongside `Ticker.Stop`.

### Pattern: heartbeat with body inside

```go
func Service(ctx context.Context) error {
    t := time.NewTicker(time.Minute)
    defer t.Stop()
    for {
        if err := doWork(ctx); err != nil {
            return err
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
        }
    }
}
```

Work first, then wait. Suitable for a job that needs to run immediately on startup and then once per minute. The "work first" placement means a short-lived `ctx` exits after one execution, not after waiting a full minute.

### Pattern: starting a ticker, then ticking it manually for the first beat

```go
func StartImmediate(ctx context.Context, interval time.Duration, fn func()) {
    t := time.NewTicker(interval)
    defer t.Stop()
    fire := make(chan struct{}, 1)
    fire <- struct{}{}

    for {
        select {
        case <-ctx.Done():
            return
        case <-fire:
            fn()
        case <-t.C:
            fn()
        }
    }
}
```

A pre-loaded buffered channel triggers the first call. The ticker then takes over. This is a cleaner alternative to a separate `fn()` call before the loop when you have many places that need the "fire immediately" behaviour.

---

## Clean Code

### Always pair `NewTicker` with `defer Stop`

The two statements should sit on adjacent lines. Reviewers should be able to find `Stop` by looking at the line below `NewTicker`. Do not move `Stop` into a separate helper unless that helper *also* makes `NewTicker` invisible.

### Name the ticker variable `t` when local

A ticker named `t` is shorthand most Go readers accept. If you have multiple in scope, distinguish them: `pollT`, `flushT`, `heartbeatT`. Avoid `ticker` as a name; it adds noise without information.

### Do not store a `*time.Ticker` in a long-lived struct without a documented lifecycle

If a `*time.Ticker` is a field on a struct, the struct must own a `Close` or `Stop` method that calls `t.Stop()`, and a comment must say so.

```go
// Poller polls an endpoint at a fixed interval.
// Call Stop when finished to release the underlying ticker.
type Poller struct {
    t   *time.Ticker
    url string
}

func (p *Poller) Stop() { p.t.Stop() }
```

### Prefer `context.Context` over a `done` channel

In modern Go, cancellation is `context.Context`. A custom `done chan struct{}` is fine for small examples but does not compose. If your ticker loop is inside a service that already takes a `ctx`, use it.

### Do not use `time.Tick` outside of `main` or short scripts

`time.Tick` cannot be stopped. Reach for it only when the program will run until killed.

### Keep tick handlers short

If the handler blocks for longer than the interval, ticks are dropped. Even if dropping is acceptable, a long handler makes the rest of the `select` unresponsive — `ctx.Done()` cannot fire during the handler. Push slow work into another goroutine and let the ticker loop only enqueue.

```go
case <-t.C:
    select {
    case work <- struct{}{}:
    default:
        // worker is busy; this beat is skipped
    }
```

### Name the interval

```go
const heartbeatInterval = 5 * time.Second

t := time.NewTicker(heartbeatInterval)
```

Inline numerical durations are fine for trivial scripts. Production code names them.

---

## Product Use

A ticker shows up in almost every Go service. Examples from real codebases:

- **Health-check endpoint dispatcher.** Every 30 s the service performs a self-check; if it fails for three consecutive checks, the service marks itself unhealthy. Implementation: a ticker plus a counter.
- **Metrics flush.** A buffered metrics accumulator drains to StatsD every 10 s. Implementation: ticker + flush function.
- **Cache eviction sweep.** Every minute the cache iterates over entries and removes expired ones. Implementation: ticker.
- **Heartbeat to a leader-election service.** Every two seconds the local node tells the cluster "I am still here." Implementation: ticker.
- **Rate-limited dispatcher.** Tasks pulled from a queue at no more than one every 100 ms. Implementation: ticker + send.
- **Visual progress in CLI tools.** A spinner advances every 80 ms. Implementation: ticker.
- **Background log rotation.** Every hour the logger closes the current file and opens a new one. Implementation: ticker (though `AfterFunc` per-target also works).

In none of these does the ticker carry data. It is purely a beat. The interval determines responsiveness, freshness, and load. Tuning the interval is one of the more underrated operational levers.

---

## Error Handling

### Panics from `NewTicker`

```go
t := time.NewTicker(d)
```

If `d <= 0` this panics with `panic: non-positive interval for NewTicker`. There is no way to handle the panic except via `recover`, which is the wrong tool — validate `d` instead.

```go
if interval <= 0 {
    return errors.New("interval must be positive")
}
t := time.NewTicker(interval)
```

### Errors from the handler

The ticker itself never returns an error. Your handler may. The canonical pattern:

```go
case <-t.C:
    if err := fn(); err != nil {
        log.Printf("handler error: %v", err)
        // decide whether to continue or return
    }
```

Whether you keep ticking after an error is a policy decision. Many services keep going (heartbeats, polls) and surface the error via metrics. A few stop on first error (especially configuration-loading tickers).

### Errors from `Reset` and `Stop`

Neither method returns an error. Both are best-effort. The only signal you get from `Stop` is the boolean return on `time.Timer.Stop`; tickers do not return a bool. This is a small loss of information; you cannot tell "I stopped a live ticker" from "I stopped one that was already stopped" without bookkeeping.

### Recovering from a handler panic

If the handler panics and you do not recover, the whole process dies. This is sometimes desirable for a top-level service. If not, install a recover:

```go
case <-t.C:
    func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("handler panic: %v", r)
            }
        }()
        fn()
    }()
```

The `func() { ... }()` wrapper scopes the `defer` so that subsequent iterations are not pinned by deferred cleanup.

---

## Security Considerations

Tickers are not a security primitive but they touch security in three places.

### Denial of service via tiny intervals

If your service accepts a user-supplied duration and calls `NewTicker(d)` directly, an attacker passing `d = 1 * time.Nanosecond` floods your goroutine with wakeups. Always enforce a minimum:

```go
const minInterval = 100 * time.Millisecond
if d < minInterval { d = minInterval }
```

### Timing leaks

Periodic operations on secret material — for example "encrypt this with the current key, where the key rotates on a ticker" — should not assume the ticker timing is unobservable. If an attacker can correlate observable behaviour with tick boundaries, they may learn when the key rotated. This is exotic but real in side-channel attacks against high-value services.

### Resource exhaustion from leaked tickers

Each leaked ticker holds a timer-heap entry. Thousands of leaks slow down the entire runtime: every `addtimer` and `deltimer` call walks a heap whose size has grown. The fix is the same as for any leak — `Stop` properly.

---

## Performance Tips

- **Avoid sub-millisecond intervals.** The Go scheduler's resolution is finer than a millisecond, but tickers below ~100 µs spend more time waking up than doing work. Batch instead.
- **Use one shared ticker for related jobs.** If three jobs need to fire every second, fan out a single ticker rather than constructing three. Saves heap entries and reduces wakeup overhead.
- **Stop tickers proactively when their work is done.** A ticker that runs forever in a request handler outlives the request.
- **Do not run heavy work inside the tick case.** Push the work to a goroutine and let the tick case only signal.
- **Avoid `time.After` inside a loop.** Each iteration allocates a new timer; under load this is significant garbage. `time.Ticker` is the right replacement.

---

## Best Practices

- Always `defer t.Stop()` immediately after `time.NewTicker(...)`.
- Always put `ctx.Done()` (or a `done` channel) in the `select`.
- Never use `for range t.C` for anything that needs to exit.
- Validate the interval before construction; reject zero and negative values explicitly.
- Test the loop with a fast interval (10 ms) and short context (50 ms) to confirm it cancels.
- Document the interval as a constant.
- Keep tick handlers fast or defer the heavy work to another goroutine.
- Use `time.NewTimer` for one-shot delays; do not bend a ticker into a one-shot.
- Prefer `context.WithTimeout` or `context.WithCancel` over manual `done` channels.
- Place a ticker inside a function with a clear lifecycle; do not let it dangle as a package-level variable.

---

## Edge Cases and Pitfalls

### Pitfall: the first tick is not immediate

```go
t := time.NewTicker(time.Second)
<-t.C // waits one second
```

Newcomers expect zero delay; the runtime gives you a full interval before the first tick. If you want "now and then every interval," fire once manually first.

### Pitfall: `Stop` does not close `C`

A `for range t.C` after `Stop` blocks forever. Use `select` with cancellation.

### Pitfall: forgetting `Stop`

Each leaked ticker stays in the timer heap and continues to fire. The runtime sends to the buffered channel, drops because no one reads, and re-arms. Over hours this is invisible; over days it is a 200 MB heap and a noticeable CPU baseline.

### Pitfall: slow consumer silently drops ticks

If you wanted N executions over time T, do not assume the ticker gave you exactly N. Always check timestamps or use a counter inside the handler.

### Pitfall: ticker started before consumer is ready

```go
t := time.NewTicker(d)
defer t.Stop()
// ... 200 ms of setup ...
for { ... } // first observed tick might be very stale
```

The first tick fires while you were setting up; by the time you read from `t.C`, the buffered value is from the past. Either set up first, or drain the channel before entering the loop.

### Pitfall: ticker inside a struct field

A `*time.Ticker` in a struct lives as long as the struct does. If the struct outlives its useful life — sits in a map for a request that completed — the ticker keeps firing.

### Pitfall: nested `select` with `t.C` in inner block

Avoid this. The outer `select` cannot observe a tick that arrives while you are blocked on an inner receive. Flatten the loop instead.

### Pitfall: `Reset` after `Stop`

Calling `Reset` on a stopped ticker re-arms it, but the channel state is now ambiguous (there may be a leftover value buffered). Either `Stop` and construct anew, or `Reset` without `Stop`. Do not mix.

### Pitfall: ticker around a non-monotonic operation

If your handler depends on wall-clock time and the wall clock jumps backwards (NTP correction), the *handler* may misbehave even though the ticker itself is fine. Use the tick value (which carries the monotonic reading) or `time.Now()` defensively.

### Pitfall: shared ticker across many goroutines

Two goroutines reading from `t.C` split ticks unpredictably. Use a fan-out goroutine.

---

## Common Mistakes

### Mistake 1: no `Stop`

```go
func handler(w http.ResponseWriter, r *http.Request) {
    t := time.NewTicker(time.Second)
    for {
        select {
        case <-r.Context().Done():
            return // ticker leaked!
        case <-t.C:
            // ...
        }
    }
}
```

Every request leaks a ticker. After a few hours the process is unhappy.

**Fix.** `defer t.Stop()` after `NewTicker`.

### Mistake 2: `for range t.C` with no exit

```go
t := time.NewTicker(time.Second)
for range t.C {
    if shouldStop() { break }
}
t.Stop()
```

`shouldStop` may be true, but we are inside the body when it becomes true — the loop has to wait for *the next tick* to re-check. Worse, after `Stop` the range loop sits waiting forever because the channel never closes.

**Fix.** Use a `select` with cancellation, not `for range`.

### Mistake 3: `time.Tick` in a service

```go
for range time.Tick(time.Second) {
    flushMetrics()
}
```

This leaks the ticker if the loop ever exits via `break` or `return`, *and* prevents the underlying ticker from being garbage-collected on older Go versions.

**Fix.** Use `NewTicker` and `Stop`.

### Mistake 4: assuming `Stop` is synchronous with respect to the consumer

```go
t.Stop()
close(done) // consumer was already blocked on t.C
```

`Stop` does not unblock a goroutine that is blocked on receive. Closing `done` does (assuming `done` is in the `select`).

**Fix.** Signal exit via cancellation, not via `Stop`.

### Mistake 5: tick handler longer than interval

```go
t := time.NewTicker(100 * time.Millisecond)
for range t.C {
    time.Sleep(500 * time.Millisecond) // intent: 10 fps, actual: 2 fps with drops
}
```

The runtime sends ticks every 100 ms but you consume one every 500 ms. You get four out of every five ticks dropped.

**Fix.** Either shorten the handler, increase the interval, or move work to a worker goroutine.

### Mistake 6: starting a ticker without storing the pointer

```go
go func() {
    <-time.NewTicker(time.Second).C
    // ...
}()
```

This works once but `Stop` is impossible. Always store the pointer.

**Fix.** `t := time.NewTicker(time.Second); defer t.Stop()`.

### Mistake 7: passing `0` as the interval

```go
t := time.NewTicker(timeout) // timeout might be 0
```

Panics. Validate.

**Fix.**

```go
if timeout <= 0 {
    return errors.New("invalid")
}
t := time.NewTicker(timeout)
```

### Mistake 8: re-creating tickers per request

```go
func handler(w http.ResponseWriter, r *http.Request) {
    t := time.NewTicker(time.Millisecond)
    defer t.Stop()
    // ...
}
```

A high-traffic endpoint constructs thousands of tickers per second. The overhead is real, even though the runtime is efficient. Reuse a package-level ticker and fan out.

**Fix.** Decide whether the ticker is per-request or shared.

### Mistake 9: confusing ticker value with handler time

```go
case t := <-tick.C:
    log.Println("tick:", t) // surprise: t is wall time, may be older than now
```

If your handler took 80 ms in the previous iteration, the value `t` is from when the tick fired, not now. Sometimes that is what you want; sometimes it is a bug.

**Fix.** Use `time.Now()` if you mean "now."

### Mistake 10: assuming `Reset(d)` resets the schedule from now

It does not always. Pre-1.15 there was no `Reset`. Post-1.15 the behaviour around a tick currently buffered in `C` is subtle (see middle and senior files). Junior code should usually `Stop` and `NewTicker` instead.

---

## Common Misconceptions

### "The first tick fires immediately."

No. The first tick fires *one interval after* `NewTicker` returns. To get an immediate first call, invoke the handler manually before the loop.

### "`Stop` closes the channel."

No. `Stop` halts further sends but leaves the channel open. A subsequent receive blocks forever.

### "Ticks are queued — if I am slow I will catch up."

No. The buffer is one. Slow consumers drop ticks. There is no catch-up.

### "Tickers are exact."

No. Ticks fire approximately on schedule. Jitter of a few hundred microseconds to a few milliseconds is normal. Under GC pressure or scheduler contention it can be much worse.

### "`time.Tick` and `NewTicker` are the same."

They have the same channel semantics, but `time.Tick` returns only the channel and cannot be stopped. `NewTicker` gives you the `*Ticker`. Always prefer `NewTicker` in long-running code.

### "Tickers run in their own goroutine."

The runtime does not allocate a goroutine per ticker. All tickers share the runtime's timer heap and a small pool of worker goroutines.

### "A ticker holds the channel buffer indefinitely."

The channel buffer is fixed at one. The "indefinite" hold is the runtime timer entry; that costs roughly a hundred bytes plus the buffered slot.

### "Forgetting `Stop` causes a memory leak only."

It also causes a CPU leak — the runtime keeps firing wakeups for the dead ticker. CPU usage grows linearly with the number of leaked tickers.

### "`Reset` is safe to call concurrently with the consumer."

In Go 1.20 and earlier there were races. Modern Go (1.23+) tightened the semantics but mixing `Reset` with concurrent receive is still subtle. Junior code should use a mutex or single-owner discipline.

### "Ticks are guaranteed monotonic."

The runtime measures intervals against the monotonic clock, so the *interval* is monotonic. The *value* sent on `t.C` is a `time.Time` that includes both wall and monotonic readings. Comparisons via `Sub` use the monotonic reading.

---

## Tricky Points

### Tricky point: what does `t.C` look like at construction?

It is constructed empty. The first tick is sent one interval later. So a fresh `*Ticker` has zero values in `C` until the first interval elapses. If you `select` with a default immediately you will fall through.

### Tricky point: `Stop` is safe to call multiple times

Calling `Stop` twice on the same ticker is a no-op the second time. This is intentional so that `defer t.Stop()` plus an explicit `t.Stop()` in an error path do not blow up.

### Tricky point: a stopped ticker can be `Reset`

After `Stop`, calling `Reset(d)` re-arms the ticker with interval `d`. This is the official supported behaviour as of Go 1.15 (improved in 1.23). The channel is not drained.

### Tricky point: a ticker created with `NewTicker` runs immediately

The internal timer is armed inside `NewTicker`. There is no separate `Start` method. The clock is running by the time the constructor returns.

### Tricky point: receiving from `t.C` and `ctx.Done()` is unbiased

If both are ready at the moment of the `select`, Go picks one at random. There is no priority. If you need "always check cancellation first," you have to test it manually before the `select`:

```go
if ctx.Err() != nil { return }
select { ... }
```

### Tricky point: the timer-heap is shared process-wide

All tickers and timers in the process live in one heap (or four heaps, post-1.20, but conceptually one resource pool). A thousand tickers compete with one another for runtime attention. This rarely matters but is worth knowing for debugging.

### Tricky point: `time.NewTicker` returns a value, but you almost always treat it as a pointer

The function signature is `func NewTicker(d Duration) *Ticker`. The pointer is necessary because `Stop` mutates the runtime state. Copying a `Ticker` value does not copy its underlying timer.

### Tricky point: long sleeps suspend the OS thread, not the ticker

If a consumer is calling `time.Sleep(5 * time.Second)` between ticks, the consumer is parked; the ticker is still firing into the channel and dropping. The consumer's clock is decoupled from the ticker's clock.

---

## Test

A small test you can copy into a `_test.go` file and run.

```go
package main

import (
    "context"
    "sync/atomic"
    "testing"
    "time"
)

func TestHeartbeatCounts(t *testing.T) {
    var count int32
    ctx, cancel := context.WithTimeout(context.Background(), 350*time.Millisecond)
    defer cancel()

    tk := time.NewTicker(100 * time.Millisecond)
    defer tk.Stop()

    done := make(chan struct{})
    go func() {
        defer close(done)
        for {
            select {
            case <-ctx.Done():
                return
            case <-tk.C:
                atomic.AddInt32(&count, 1)
            }
        }
    }()

    <-done
    n := atomic.LoadInt32(&count)
    if n < 2 || n > 4 {
        t.Fatalf("expected 2-4 ticks in 350ms, got %d", n)
    }
}
```

Run with `go test ./...`. The test passes if the count is in the loose range 2–4. We pick a range because exact counts are flaky.

Tighter test, using a mocked clock interface, will appear in the middle file.

---

## Tricky Questions

### Q1. What does `time.NewTicker(0)` do?

It panics with `"non-positive interval for NewTicker"`. Validate the duration before passing it in.

### Q2. After `t.Stop()`, can `<-t.C` produce a value?

Maybe one — if a tick was buffered and not yet consumed. After that, the receive blocks forever. Use a non-blocking drain (`select` with `default`) if you need to be safe.

### Q3. What is the buffer capacity of `t.C`?

One. New ticks that arrive while the slot is full are dropped silently.

### Q4. If I call `NewTicker(100ms)` at t=0 and consume slowly, how many ticks do I see in one second?

In the worst case (handler longer than 100 ms each iteration), as few as one or two. The ticker still tries to send every 100 ms but drops because the buffer is full.

### Q5. Is `Ticker.Reset` safe to call from a different goroutine than the consumer?

In Go 1.23+, yes; the runtime provides the synchronisation needed. In older versions it is racy. Junior code should keep all ticker control in one goroutine.

### Q6. Does `time.Tick` leak in modern Go?

In Go 1.23 the runtime no longer pins unreferenced tickers, so the leak is bounded — once the ticker has no references, it can be GC'd. Before 1.23 the leak was unbounded. Either way, prefer `NewTicker`.

### Q7. What does `t.Stop()` return?

Nothing. `Stop()` has no return value. `time.Timer.Stop` returns a bool; tickers do not.

### Q8. Why does the first tick fire after one interval rather than at time zero?

By design. If you want an immediate first call, do it manually before the loop. The runtime cannot infer your intent.

### Q9. Two goroutines both read from the same `t.C`. What happens?

Each tick is consumed by exactly one of the two goroutines, chosen by the runtime scheduler. The split is approximately even over many ticks but not exact. Avoid sharing `t.C` directly; fan out via your own channel.

### Q10. Can I receive from `t.C` and also call `t.Reset` from the same goroutine?

Yes, that is the safest pattern. Single-owner discipline avoids races even on older Go.

---

## Cheat Sheet

```go
// Construct
t := time.NewTicker(interval)

// Always defer Stop
defer t.Stop()

// Canonical loop
for {
    select {
    case <-ctx.Done():
        return
    case now := <-t.C:
        // work
    }
}

// First tick immediate
fn()
for {
    select {
    case <-ctx.Done(): return
    case <-t.C: fn()
    }
}

// Multiple tickers
fast := time.NewTicker(100 * time.Millisecond); defer fast.Stop()
slow := time.NewTicker(time.Second);            defer slow.Stop()
for {
    select {
    case <-ctx.Done(): return
    case <-fast.C: handleFast()
    case <-slow.C: handleSlow()
    }
}

// Avoid
ch := time.Tick(d)              // leaks in <1.23, smell in >=1.23
for range t.C { ... }            // cannot cancel cleanly
t := time.NewTicker(0)           // panics
```

Memorise the canonical loop. The rest is decoration.

---

## Self-Assessment Checklist

You are ready to graduate to the middle file when you can:

- [ ] Explain what `time.Ticker` is in one sentence.
- [ ] Write a heartbeat loop from memory with `select`, `ctx.Done()`, and `defer Stop()`.
- [ ] Describe what happens when the consumer is slower than the interval (ticks drop, buffer is one).
- [ ] State why `Stop` is required and what leaks if you forget it.
- [ ] Explain why `Stop` does *not* close `t.C`.
- [ ] Name three reasons not to use `time.Tick`.
- [ ] Predict the output of a five-line program that uses `NewTicker` and `time.Sleep`.
- [ ] Identify the bug in `t := time.NewTicker(0)`.
- [ ] Sketch the canonical loop on a whiteboard without looking.
- [ ] Distinguish a ticker (periodic) from a timer (one-shot).

If you can do all ten, move on. If not, re-read the [Core Concepts](#core-concepts) and [Common Mistakes](#common-mistakes) sections.

---

## Summary

`time.Ticker` is the Go answer to "do this every N seconds." Construct it with `NewTicker`, consume its channel `C` inside a `select` against `ctx.Done()`, and release it with `Stop`. The buffer of one means slow consumers drop ticks rather than block. The first tick is delayed by one interval. `time.Tick` is a leaky convenience; reach for `NewTicker` in any code that lives longer than a one-off script.

The single most valuable habit: type `defer t.Stop()` on the line immediately after `t := time.NewTicker(...)`. Make it muscle memory. Half the production incidents involving tickers come from skipping that line.

You now know how to use a ticker safely. The middle file teaches you how to change its interval, why drift differs from jitter, and how to test ticker code without waiting in real time.

---

## What You Can Build

With only what is in this file, you can confidently build:

- A health-check loop that pings an endpoint every N seconds.
- A heartbeat that prints "alive" until the context cancels.
- A periodic flusher that drains an in-memory buffer to disk.
- A CLI tool that prints elapsed time once per second.
- A simple polling loop that retries a check at a fixed interval until it succeeds or times out.
- A multi-ticker dispatcher that runs three jobs on three intervals from one `select`.
- A test that asserts a heartbeat fires approximately N times in M milliseconds.
- A `Poller` struct with `Start` and `Stop` methods that wraps a `*time.Ticker`.

You cannot yet build:

- A ticker that changes its interval at runtime (covered in middle).
- A drift-corrected ticker (covered in middle).
- A jittered ticker for thundering-herd avoidance (covered in professional).
- A mocked clock for deterministic tests (covered in middle).

---

## Further Reading

- [`pkg.go.dev/time#Ticker`](https://pkg.go.dev/time#Ticker) — the official API documentation.
- [`pkg.go.dev/time#NewTicker`](https://pkg.go.dev/time#NewTicker) — constructor docs.
- [`pkg.go.dev/time#Tick`](https://pkg.go.dev/time#Tick) — leaky convenience helper.
- "Go concurrency patterns" (Rob Pike, Google I/O 2012) — historical talk where the canonical loop is first introduced publicly.
- [`runtime/time.go`](https://github.com/golang/go/blob/master/src/runtime/time.go) — the runtime implementation. Heavy reading; visit after the senior file.

For a wider tour of Go's time package, see the [`time` package overview](../../../09-stdlib/01-time/) in this Roadmap. For the runtime-level details of how the timer heap actually works, jump to the [senior.md](senior.md) file in this folder.

---

## Related Topics

- [`02-afterfunc`](../02-afterfunc/) — one-shot delayed function calls.
- [`03-timer-leaks`](../03-timer-leaks/) — detection and prevention of timer-related leaks.
- [`04-exponential-backoff`](../04-exponential-backoff/) — variable intervals on top of `time.Timer`.
- [`05-debounce-throttle`](../05-debounce-throttle/) — using tickers to throttle event streams.
- [`../../03-channels/`](../../03-channels/) — the channel primitive `t.C` is built on.
- [`../../11-context/`](../../11-context/) — `context.Context` cancellation, the standard companion.
- [`../../../09-stdlib/01-time/`](../../../09-stdlib/01-time/) — the broader `time` package.

---

## Diagrams and Visual Aids

### A ticker as boxes-and-arrows

```
+---------------+
| runtime timer | --(every interval)--> +--------+   +-------------+
+---------------+                       | t.C    |---| your code   |
                                        | buf=1  |   | <-t.C       |
                                        +--------+   +-------------+

Stop() removes the runtime timer; t.C remains open.
```

### The lifecycle

```
NewTicker(d) ---> [ active ] ---Stop()---> [ stopped ]
                       |                        ^
                       | Reset(d')              |
                       +------------------------+
```

### Slow consumer dropping ticks

```
runtime: |---tick---|---tick---|---tick---|---tick---|
                    drop      drop      drop
consumer:                       |---read---|
```

Three ticks fire while the consumer is busy. The buffer holds the most recent one; the older two are dropped.

### `select` with cancellation

```
select {
    +--- <-ctx.Done() ---> return         (cancel branch)
    |
    +--- <-t.C        ---> handle(now)    (work branch)
}
```

Two branches, one decision per iteration. If both are ready, the runtime picks randomly.

### `time.Tick` versus `NewTicker`

```
time.Tick(d) -> hidden ticker (cannot stop) -> channel
                  +-- before Go 1.23: leaks forever
                  +-- Go 1.23+: GC'd when channel unreferenced

NewTicker(d) -> *Ticker -> channel C
                  +-- Stop() releases resources explicitly
```

### Memory cost rough sketch

```
*Ticker (~64 B header) + timer-heap entry (~80 B) + channel buffer (16 B for one time.Time)
= roughly 150-200 bytes per active ticker.
```

A thousand tickers fit in less than half a megabyte. The cost scales with the number of *active* tickers, not the number of ticks fired.

These diagrams are sketches; they leave out details such as cache-line layout and platform-specific channel-buffer alignment. The senior file includes a more precise diagram of the runtime timer heap, including the four-bucket design introduced in Go 1.20.

---

## Walkthrough: Building a Heartbeat Service Step by Step

The best way to internalise the ticker is to build a small program incrementally and observe what each line does. We will build a heartbeat service in seven steps, starting from a single `fmt.Println` and ending with a production-ready loop.

### Step 1: print one line every second, naively

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    for {
        fmt.Println("alive at", time.Now().Format("15:04:05"))
        time.Sleep(time.Second)
    }
}
```

This works. It also has problems:

- The interval is "one second after the previous print returned." If `fmt.Println` takes ten milliseconds, the real interval is 1.01 seconds. Over an hour the drift accumulates.
- The loop cannot be cancelled. Only `Ctrl-C` (SIGINT) stops it.
- The program prints a line, sleeps, prints a line, sleeps. There is no abstraction.

### Step 2: replace `time.Sleep` with a ticker

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for range t.C {
        fmt.Println("alive at", time.Now().Format("15:04:05"))
    }
}
```

We now use the ticker. The interval is anchored to the runtime's monotonic clock, so the drift problem is solved. Two new problems:

- `for range t.C` cannot exit cleanly.
- `defer t.Stop()` exists but never runs, because the for loop blocks forever. The defer would only run when `main` returns, which it never does.

In a `main()` we are not too worried because the process will be killed externally. In a function called by other code this would be a leak.

### Step 3: introduce cancellation via a `done` channel

```go
package main

import (
    "fmt"
    "time"
)

func heartbeat(done <-chan struct{}) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-done:
            return
        case <-t.C:
            fmt.Println("alive at", time.Now().Format("15:04:05"))
        }
    }
}

func main() {
    done := make(chan struct{})
    go heartbeat(done)

    time.Sleep(3500 * time.Millisecond)
    close(done)
    fmt.Println("main returning")
}
```

Output approximate:

```
alive at 12:00:01
alive at 12:00:02
alive at 12:00:03
main returning
```

Three ticks fired (one at each second-boundary), then we closed `done` and the goroutine returned. The `defer t.Stop()` ran inside the goroutine.

Notice the `done` channel is declared with `chan struct{}`. We use the empty struct because we only need the close signal, no data. `close(done)` causes `<-done` to return immediately for *all* receivers.

### Step 4: switch from a `done` channel to `context.Context`

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func heartbeat(ctx context.Context) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            fmt.Println("alive at", time.Now().Format("15:04:05"))
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 3500*time.Millisecond)
    defer cancel()
    heartbeat(ctx)
    fmt.Println("main returning")
}
```

The behaviour is identical to Step 3. We swapped a hand-rolled `done` channel for `context.Context`. This buys us:

- A standard idiom every Go developer recognises.
- The ability to compose with timeouts and deadlines (`WithTimeout`, `WithDeadline`, `WithCancel`).
- Integration with libraries that already take a `ctx` parameter — HTTP handlers, gRPC servers, database drivers.

### Step 5: parameterise the interval

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func heartbeat(ctx context.Context, interval time.Duration) {
    if interval <= 0 {
        return
    }
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            fmt.Println("alive at", time.Now().Format("15:04:05.000"))
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    heartbeat(ctx, 200*time.Millisecond)
}
```

Two changes:

- The interval is now a parameter, not a constant.
- We validate the interval. A zero or negative duration would panic; we return early instead.

The validation is a small but important detail. A library function that panics on bad input gives callers a poor experience. Early return with no error in this case mirrors the standard library's defensive style. If we wanted to be stricter we would return an error or panic with a clearer message.

### Step 6: do work, not just print

```go
package main

import (
    "context"
    "fmt"
    "net/http"
    "time"
)

func ping(ctx context.Context, url string) error {
    req, err := http.NewRequestWithContext(ctx, http.MethodHead, url, nil)
    if err != nil {
        return err
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 500 {
        return fmt.Errorf("status %d", resp.StatusCode)
    }
    return nil
}

func healthCheck(ctx context.Context, url string, interval time.Duration) {
    if interval <= 0 {
        return
    }
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            if err := ping(ctx, url); err != nil {
                fmt.Println("ping failed:", err)
            } else {
                fmt.Println("ping ok")
            }
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    healthCheck(ctx, "https://example.com", 1*time.Second)
}
```

We replaced `fmt.Println` with an HTTP HEAD request. Three things to notice:

- The request carries `ctx`. If the ticker loop exits, the request is cancelled mid-flight.
- The handler can take longer than the interval. If `ping` takes 1.2 s and the interval is 1 s, we miss a tick. With a 100 ms ticker we would miss many.
- Errors are logged but not returned. The loop continues.

### Step 7: make the first tick immediate, add structured logging

```go
package main

import (
    "context"
    "fmt"
    "log/slog"
    "net/http"
    "os"
    "time"
)

func ping(ctx context.Context, url string) error {
    req, err := http.NewRequestWithContext(ctx, http.MethodHead, url, nil)
    if err != nil { return err }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return err }
    defer resp.Body.Close()
    if resp.StatusCode >= 500 {
        return fmt.Errorf("status %d", resp.StatusCode)
    }
    return nil
}

func healthCheck(ctx context.Context, log *slog.Logger, url string, interval time.Duration) {
    if interval <= 0 {
        log.Error("invalid interval, exiting", "interval", interval)
        return
    }

    check := func() {
        if err := ping(ctx, url); err != nil {
            log.Error("ping failed", "url", url, "err", err)
            return
        }
        log.Info("ping ok", "url", url)
    }

    check() // immediate

    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            check()
        }
    }
}

func main() {
    log := slog.New(slog.NewTextHandler(os.Stderr, nil))
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    healthCheck(ctx, log, "https://example.com", 1*time.Second)
}
```

This is what a junior engineer can confidently merge into a production codebase:

- Parameterised interval, validated.
- Structured logging via `log/slog` (standard since Go 1.21).
- Immediate first call, then ticker-driven repeats.
- Context cancellation propagated to the HTTP request.
- Proper `defer t.Stop()`.

A senior reviewer would still flag two things:

1. The HTTP client has no per-request timeout. If `ping` hangs for 30 s, the next tick is missed. Use `http.Client{Timeout: 2 * time.Second}` or wrap with `context.WithTimeout` per call.
2. There is no jitter. Many instances pinging the same URL on the same second cause a thundering herd. Add a small random offset to the interval.

Those refinements are senior- and professional-level material. The junior achievement is a correctly structured loop with cancellation, validation, and observation.

---

## Comparison: Ticker vs. Other Time Primitives

Go's `time` package offers several primitives that look similar at first glance. Knowing when to reach for which is half the battle. Here is a comparison from a junior perspective.

### `time.NewTicker(d)` — periodic, repeating

```go
t := time.NewTicker(d)
defer t.Stop()
for {
    select {
    case <-ctx.Done(): return
    case <-t.C: ...
    }
}
```

Use when: you need work done at a fixed interval, indefinitely or until cancelled.

### `time.NewTimer(d)` — one-shot delay

```go
t := time.NewTimer(d)
defer t.Stop()
select {
case <-ctx.Done():
case <-t.C:
}
```

Use when: you want to wait for exactly one event after `d`. Examples: a retry after a delay, a timeout that fires once.

### `time.AfterFunc(d, fn)` — one-shot callback

```go
t := time.AfterFunc(d, func() {
    log.Println("fired")
})
defer t.Stop()
```

Use when: you want to schedule a callback without a goroutine of your own. The runtime calls `fn` from its own goroutine after `d` elapses.

### `time.After(d)` — convenience one-shot in a `select`

```go
select {
case <-time.After(d):
case <-ch:
}
```

Use when: a one-shot timeout in a single `select` outside a loop. Inside a loop, this allocates a new timer every iteration and is wasteful. Replace with `NewTimer` and `Reset`.

### `time.Sleep(d)` — block the current goroutine

```go
time.Sleep(d)
```

Use when: you genuinely want to pause the goroutine and have no need for cancellation. Rare in production code. Acceptable in scripts, tests, and main-init paths.

### `time.Tick(d)` — convenience but leaky

```go
for range time.Tick(d) { ... }
```

Use when: never, in production. Acceptable in 30-line CLI tools and demos. The ticker can't be stopped, although Go 1.23 made the leak GC-friendly.

### Decision table

| Need | Use |
|---|---|
| Heartbeat / poll / periodic flush | `time.NewTicker` |
| Single retry after delay | `time.NewTimer` or `time.AfterFunc` |
| Timeout in a `select` outside a loop | `time.After` (or `context.WithTimeout`) |
| Timeout in a `select` inside a loop | `time.NewTimer` + `Reset` |
| Block this goroutine | `time.Sleep` |
| Quick demo, no cleanup needed | `time.Tick` |
| Fire callback at a deadline | `time.AfterFunc` |

If your need has the word "every" in it, you want `Ticker`. If your need has the word "after", you want `Timer` or `After`. If your need has "and check later", you want context-aware code with neither — let the next operation drive the timing.

---

## Channel Semantics Recap

The ticker's channel `C` is just a `chan time.Time` with buffer one. Everything you know about channels applies. A few subtle points worth restating.

### Receive blocks until a value is available

```go
v := <-t.C // blocks until first tick
```

There is no non-blocking variant for "tick or no tick" except a `select` with default:

```go
select {
case v := <-t.C:
    fmt.Println("got tick:", v)
default:
    fmt.Println("no tick yet")
}
```

### A nil channel blocks forever

If you build a ticker abstraction and forget to construct the underlying ticker, `t.C` is the zero value `(<-chan time.Time)(nil)`. Receiving from a nil channel blocks indefinitely with no goroutine deadlock detection (it is *expected* by the runtime). Always confirm `NewTicker` was called.

### A closed channel always reads zero values

If something closed `t.C` (don't — you do not own it), receive returns immediately with the zero `time.Time` and a `false` second return.

### Channel direction

`Ticker.C` is declared as `C <-chan time.Time` — receive-only. You cannot accidentally send on it. The runtime sends; you receive.

### `for range` on a channel exits when the channel is closed

Because `t.C` is never closed by the runtime, `for range t.C` does not exit. Use `select`.

---

## A Note on Goroutine Counts

A common worry: does each ticker spawn its own goroutine? No. The runtime manages all timers in a small shared pool. From a `runtime.NumGoroutine` perspective, constructing a thousand tickers does not increase the goroutine count.

What does increase is the timer-heap depth, which lives in the runtime's internal `Sched` state and is not exposed in `runtime.Stack` output. To diagnose timer-heap problems you need `runtime/pprof` and a heap profile.

```go
import (
    _ "net/http/pprof"
    "net/http"
)

func main() {
    go http.ListenAndServe(":6060", nil)
    // ... rest of program
}
```

Then visit `http://localhost:6060/debug/pprof/goroutine?debug=1` to see goroutine stacks. Leaked ticker loops show up as goroutines parked at `chan receive` on `time.Ticker`.

---

## An Aside on `runtime.GC`

You may wonder whether forcing garbage collection helps clean up leaked tickers. It does not. The leak is in the runtime timer heap, not in heap memory. `runtime.GC()` does not walk the timer heap.

In Go 1.23 the runtime *did* learn to discard unreferenced tickers without an explicit `Stop`. But "unreferenced" means no live pointer to the `*Ticker` anywhere — and in a typical leak, your loop is still holding it.

The cure remains the same: `defer t.Stop()`.

---

## Common Idioms Around Tickers

Below are a few small idioms you will encounter or want to write. They build on the canonical loop.

### Idiom 1: tick once and stop

You sometimes want "wait one interval, do the thing, return." This is `time.NewTimer`, not `Ticker`. Including here because beginners reach for `Ticker` first.

```go
// Wrong: ticker for a one-shot.
t := time.NewTicker(d)
defer t.Stop()
<-t.C
fn()
// Right: timer.
t := time.NewTimer(d)
defer t.Stop()
<-t.C
fn()
```

The ticker re-arms after firing, even if you stop it immediately. The timer does not. The cost is small but the intent is clearer.

### Idiom 2: tick with deadline

```go
func TickUntil(ctx context.Context, interval, total time.Duration, fn func()) {
    deadline := time.NewTimer(total)
    defer deadline.Stop()
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-deadline.C:
            return
        case <-t.C:
            fn()
        }
    }
}
```

A bounded ticker — fires every `interval` until `total` has elapsed.

### Idiom 3: tick with maximum count

```go
func TickN(ctx context.Context, interval time.Duration, n int, fn func()) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for i := 0; i < n; i++ {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            fn()
        }
    }
}
```

A fixed number of fires. Useful for tests and limited retry loops.

### Idiom 4: dispatch on tick

```go
func Dispatcher(ctx context.Context, interval time.Duration, out chan<- Job) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            select {
            case out <- Job{When: time.Now()}:
            case <-ctx.Done():
                return
            }
        }
    }
}
```

A ticker that feeds jobs into a downstream channel, with backpressure-aware cancellation.

### Idiom 5: tick or signal

```go
func WaitTickOrSignal(t *time.Ticker, sig <-chan struct{}) bool {
    select {
    case <-t.C:
        return true
    case <-sig:
        return false
    }
}
```

A helper that returns whether the wakeup came from the ticker or from an external signal. Useful for unifying interfaces.

---

## A Worked Example: Two-Process Load Balancer Heartbeat

Suppose you have a load balancer that needs to know which backends are alive. Each backend pings the load balancer every two seconds. The load balancer considers a backend dead if it has not pinged for ten seconds. This is a classic ticker-driven heartbeat.

### Backend side

```go
package main

import (
    "context"
    "fmt"
    "net/http"
    "os"
    "time"
)

func heartbeat(ctx context.Context, lbURL, backendID string, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    client := &http.Client{Timeout: 1 * time.Second}

    send := func() {
        req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
            lbURL+"/heartbeat?id="+backendID, nil)
        resp, err := client.Do(req)
        if err != nil {
            fmt.Println("heartbeat error:", err)
            return
        }
        resp.Body.Close()
    }

    send() // immediate
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            send()
        }
    }
}

func main() {
    if len(os.Args) < 3 {
        fmt.Println("usage: backend <lb-url> <id>")
        os.Exit(2)
    }
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    heartbeat(ctx, os.Args[1], os.Args[2], 2*time.Second)
}
```

### Load balancer side

```go
package main

import (
    "fmt"
    "net/http"
    "sync"
    "time"
)

type Tracker struct {
    mu      sync.Mutex
    lastSeen map[string]time.Time
}

func NewTracker() *Tracker {
    return &Tracker{lastSeen: make(map[string]time.Time)}
}

func (t *Tracker) Heartbeat(id string) {
    t.mu.Lock()
    t.lastSeen[id] = time.Now()
    t.mu.Unlock()
}

func (t *Tracker) Sweep(now time.Time, threshold time.Duration) []string {
    t.mu.Lock()
    defer t.mu.Unlock()
    var dead []string
    for id, last := range t.lastSeen {
        if now.Sub(last) > threshold {
            dead = append(dead, id)
            delete(t.lastSeen, id)
        }
    }
    return dead
}

func (t *Tracker) RunSweeper(interval, threshold time.Duration) {
    tk := time.NewTicker(interval)
    defer tk.Stop()
    for now := range tk.C {
        dead := t.Sweep(now, threshold)
        for _, id := range dead {
            fmt.Println("backend dead:", id)
        }
    }
}

func main() {
    tracker := NewTracker()
    go tracker.RunSweeper(time.Second, 10*time.Second)

    http.HandleFunc("/heartbeat", func(w http.ResponseWriter, r *http.Request) {
        id := r.URL.Query().Get("id")
        if id == "" {
            http.Error(w, "id required", http.StatusBadRequest)
            return
        }
        tracker.Heartbeat(id)
        w.WriteHeader(http.StatusOK)
    })
    http.ListenAndServe(":8080", nil)
}
```

Two tickers, two responsibilities. The backend pings every two seconds; the load balancer sweeps every second. Both follow the canonical pattern. The load-balancer sweeper uses `for range tk.C` without cancellation because its lifetime is the whole process — a deliberate simplification. In a real service you would want cancellation here too.

Things worth observing:

- The backend's heartbeat handles cancellation. The load balancer's sweeper does not. Both are correct in context; the choices are deliberate.
- The interval (two seconds) is much shorter than the threshold (ten seconds). This gives multiple chances to ping before being declared dead — robust to one or two missed beats.
- The sweeper uses `now := <-tk.C` — the value carried by the tick. This is the runtime's "fire time," which is what we want for the freshness comparison.
- The tracker is thread-safe via a single mutex. The mutex is held only briefly; tickers do not need any special locking themselves.

This is a small but realistic system. The whole thing fits in 80 lines. Tickers do most of the heavy lifting.

---

## Frequently Asked Detail: What `time.Time` Comes Out of `t.C`?

When the runtime fires a tick, it sends a `time.Time` constructed at the moment of the fire. The value carries both a wall-clock reading and a monotonic reading. The monotonic reading is what matters for interval calculations:

```go
v1 := <-t.C
// ... time passes ...
v2 := <-t.C
fmt.Println(v2.Sub(v1)) // uses monotonic clock; immune to wall-clock jumps
```

If you serialise the tick value with `time.Time.MarshalJSON` or print it with `%v`, only the wall-clock reading is included. The monotonic reading is internal. This is rarely a problem in practice; tickers' tick values are almost never serialised — you use them in-memory for interval reasoning and discard.

---

## Frequently Asked Detail: What If My Handler Modifies the Interval?

Junior code should not do this. Modifying the interval mid-loop is `Reset` territory, covered in the middle file. For now, treat the interval as fixed for the life of the ticker. If you need to change it, `Stop` and construct a new one:

```go
t := time.NewTicker(initial)
defer func() { t.Stop() }()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        // ...
        if needFaster {
            t.Stop()
            t = time.NewTicker(faster)
        }
    }
}
```

This is correct but inelegant. The middle file shows `Reset`, which is the idiomatic alternative.

---

## Frequently Asked Detail: Can I Pause a Ticker?

There is no "pause" primitive on `Ticker`. The supported operations are construct, `Stop`, and `Reset` (which changes the interval, not pauses). To pause:

- Stop the ticker.
- When ready to resume, construct a new one or `Reset` the existing one.

Pause semantics are usually a symptom of an unclear lifecycle. If you find yourself wanting to pause, ask whether the work that depends on the ticker should still be alive at all. Often it should not be.

---

## Why `time.Ticker` Is Designed The Way It Is

A few design choices look strange at first; they are deliberate.

### Why is the channel buffered?

If `t.C` were unbuffered, every tick would block until the consumer received. A slow consumer would cause the runtime's timer worker to block, which would delay every other timer in the program. Buffer one decouples the runtime from the consumer.

### Why doesn't `Stop` close `t.C`?

Closing a channel is unsafe from any goroutine other than the sole sender. The runtime, technically the sender, *could* close, but then a concurrent `Reset` would have to re-create the channel — a change that ripples through goroutines holding references. Easier to leave the channel open and require the consumer to use `select` with a cancellation branch.

### Why is the first tick delayed?

So that `time.NewTicker(0)` and `time.NewTicker(d)` are uniform in their semantics. If the first tick fired immediately, `NewTicker(0)` would be a degenerate "spin forever" loop. The chosen rule — "every tick takes at least one interval to arrive" — is simpler.

### Why does `time.Tick` exist if it leaks?

History. Before `Stop` existed (very early Go), `time.Tick` was the only API. It is kept for backwards compatibility and short scripts. Modern code should not use it in long-running services.

### Why is there no `time.TickerOnce`?

`time.Timer` is "tick once." The two types are deliberately separate. Conflating them would require a runtime flag on every timer and complicate the heap implementation.

These design choices are worth knowing because they answer questions you will be asked in interviews and code reviews.

---

## Extra Pitfalls Worth Memorising

A laundry list of small dangers, beyond those already covered.

### Pitfall: comparing tick values across machines

Two machines have their own monotonic clocks. A `time.Time` from machine A's ticker is not meaningfully comparable to one from machine B's ticker. Use wall-clock readings (which include time zone) for cross-machine comparisons, and accept that NTP drift may make the readings disagree by milliseconds.

### Pitfall: a ticker started in `init()`

```go
var t = time.NewTicker(time.Second)
```

This starts the ticker before `main` runs. The first tick may arrive while `init` is still finishing other packages. If your consumer is not yet built, ticks pile into the buffer (one slot), the rest drop, and you have wasted wakeups. Construct tickers inside functions that have a well-defined lifecycle, not at package level.

### Pitfall: re-armed ticker after `Stop` with a leftover value

```go
t := time.NewTicker(time.Second)
time.Sleep(1100 * time.Millisecond) // a tick is now buffered
t.Stop()
t.Reset(100 * time.Millisecond)
v := <-t.C
fmt.Println(time.Since(start)) // surprise: ~1.1s, not ~100ms
```

The leftover tick from before `Stop` is still in `t.C`. The receive consumes that, not a new tick. Drain explicitly:

```go
t.Stop()
select {
case <-t.C:
default:
}
t.Reset(100 * time.Millisecond)
```

This is so subtle that we cover it in detail in the middle and senior files. For junior code, prefer `Stop` and construct a new ticker.

### Pitfall: using `Ticker` for absolute deadlines

If you need "fire at 3:00 PM exactly," `Ticker` is wrong. Compute the duration until 3:00 PM and use `time.NewTimer`. Tickers are intervals, not deadlines.

### Pitfall: ticker in a test that takes forever

A test that uses `time.NewTicker(time.Hour)` and relies on the tick to drive the assertion will hang for an hour. Wrap with a fast clock interface or simulate the tick via a channel of your own.

### Pitfall: misreading the buffer-of-one as buffer-of-N

Newcomers occasionally guess that the buffer is "however many ticks fit in a second." It is one. Exactly one. The runtime drops everything else.

### Pitfall: assuming `Stop` returns immediately

It does, in practice. The runtime synchronously removes the timer-heap entry. But if another goroutine is concurrently calling `Reset` or about to send on the channel, there is a tiny window of overlap. Modern Go (1.23+) handles this cleanly; older versions had races. Test on the version you ship.

### Pitfall: nil ticker pointer

```go
var t *time.Ticker
defer t.Stop() // panics: nil pointer dereference
```

Construct before deferring `Stop`. Or check for nil.

### Pitfall: ticker used as a "trigger every iteration"

```go
for {
    select {
    case <-t.C:
        doWork()
    }
}
```

Without a cancellation case, this is a leak waiting to happen. Always add `ctx.Done()`.

---

## Stretching the Skill: Use the Ticker in a Real Project

You have the building blocks. Pick a real project, however small, and use a ticker in it. Suggested projects:

- **Disk-space monitor.** Every 30 seconds, check available disk space via `os.Statfs` (Linux) or `golang.org/x/sys`. If below a threshold, log a warning.
- **Pomodoro CLI.** Print "work" for 25 minutes, "break" for 5 minutes, alternate. Use one ticker for the per-minute count, one timer for the phase change.
- **Latency probe.** Every 5 seconds, time an HTTP request to a target URL and append to a CSV file.
- **Mock telemetry generator.** Every 100 ms, emit a fake metric (random number) to stdout.
- **Auto-reload config file.** Every minute, stat a config file; if its mtime changed, reload.

Pick one and write it. Run it under `go run`, then under `go build` and execute the binary. Watch the goroutine count with `runtime.NumGoroutine` and confirm it does not grow over time. Add `defer t.Stop()` and notice you cannot tell the difference in a 60-second run; remove `defer t.Stop()` and let it run for an hour, then check memory with `top` or `htop`.

You will internalise the rules faster from one small project than from a hundred pages of reading.

---

## Closing Thoughts

`time.Ticker` is small in API surface but large in everyday utility. Once you internalise the canonical loop — `NewTicker`, `defer Stop`, `select` with `ctx.Done()` — most ticker code writes itself. The traps that remain are quiet ones: forgotten `Stop`, slow consumers, the first-tick delay, the buffer of one.

Aim to write code where every ticker has a documented owner, a clear lifecycle, and a corresponding `Stop`. Tickers in your codebase should be findable: `grep -rn "time.NewTicker"` should show you a small, finite list, and each call site should pair with a `Stop` two lines below.

That habit alone is worth more than any deep dive into the runtime.

## Appendix A: Twenty Small Snippets

Twenty short, runnable snippets that together cover every junior-level use of `time.Ticker`. Type them by hand into a scratch directory; do not just read.

### A.1 — Print three ticks and exit

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(200 * time.Millisecond)
    defer t.Stop()
    for i := 0; i < 3; i++ {
        v := <-t.C
        fmt.Println("tick", i, "at", v.Format("15:04:05.000"))
    }
}
```

### A.2 — Tick until a deadline

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(150 * time.Millisecond)
    defer t.Stop()
    deadline := time.After(time.Second)
    for {
        select {
        case <-deadline:
            return
        case v := <-t.C:
            fmt.Println(v.Format("15:04:05.000"))
        }
    }
}
```

### A.3 — Two tickers, alternating output

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    a := time.NewTicker(200 * time.Millisecond)
    defer a.Stop()
    b := time.NewTicker(300 * time.Millisecond)
    defer b.Stop()

    end := time.After(time.Second)
    for {
        select {
        case <-end:
            return
        case <-a.C:
            fmt.Println("A")
        case <-b.C:
            fmt.Println("B")
        }
    }
}
```

### A.4 — Tick and accumulate

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    sum := 0.0
    end := time.After(500 * time.Millisecond)
    for {
        select {
        case <-end:
            fmt.Printf("sum=%.2f\n", sum)
            return
        case <-t.C:
            sum += 0.1
        }
    }
}
```

### A.5 — Cancellation via context

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
    defer cancel()
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case v := <-t.C:
            fmt.Println(v.Format("15:04:05.000"))
        }
    }
}
```

### A.6 — Skip ticks that arrive while busy

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    end := time.After(time.Second)
    for {
        select {
        case <-end:
            return
        case <-t.C:
            fmt.Println("work")
            time.Sleep(250 * time.Millisecond)
        }
    }
}
```

You should see roughly four `"work"` lines, not ten.

### A.7 — Send ticks to a worker channel

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 700*time.Millisecond)
    defer cancel()
    work := make(chan time.Time)
    go func() {
        t := time.NewTicker(150 * time.Millisecond)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                close(work)
                return
            case v := <-t.C:
                work <- v
            }
        }
    }()
    for v := range work {
        fmt.Println("got", v.Format("15:04:05.000"))
    }
}
```

### A.8 — Run a function on each tick

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func every(ctx context.Context, d time.Duration, fn func()) {
    t := time.NewTicker(d)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            fn()
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
    defer cancel()
    every(ctx, 100*time.Millisecond, func() {
        fmt.Println("ping")
    })
}
```

### A.9 — Ticker plus signal channel

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(200 * time.Millisecond)
    defer t.Stop()
    sig := make(chan struct{})
    go func() {
        time.Sleep(500 * time.Millisecond)
        close(sig)
    }()
    for {
        select {
        case <-sig:
            return
        case v := <-t.C:
            fmt.Println(v.Format("15:04:05.000"))
        }
    }
}
```

### A.10 — Count ticks to fixed total

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(50 * time.Millisecond)
    defer t.Stop()
    for i := 0; i < 10; i++ {
        <-t.C
        fmt.Println(i)
    }
}
```

### A.11 — Goroutine count check

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    fmt.Println("before:", runtime.NumGoroutine())
    t := time.NewTicker(time.Second)
    defer t.Stop()
    fmt.Println("after:", runtime.NumGoroutine())
}
```

Notice the count does not increase. The runtime does not allocate a goroutine per ticker.

### A.12 — Verify Stop is idempotent

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(time.Second)
    t.Stop()
    t.Stop()
    fmt.Println("stopped twice without panic")
}
```

### A.13 — Drain a buffered tick after Stop

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(100 * time.Millisecond)
    time.Sleep(150 * time.Millisecond) // tick now in buffer
    t.Stop()
    select {
    case v := <-t.C:
        fmt.Println("drained:", v.Format("15:04:05.000"))
    default:
        fmt.Println("nothing to drain")
    }
}
```

### A.14 — Heartbeat with structured logging

```go
package main

import (
    "context"
    "log/slog"
    "os"
    "time"
)

func main() {
    log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    t := time.NewTicker(200 * time.Millisecond)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            log.Info("heartbeat")
        }
    }
}
```

### A.15 — Compute average interval observed

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    var prev time.Time
    var totalLag time.Duration
    const N = 10
    for i := 0; i < N; i++ {
        v := <-t.C
        if !prev.IsZero() {
            totalLag += v.Sub(prev)
        }
        prev = v
    }
    avg := totalLag / (N - 1)
    fmt.Println("avg interval:", avg)
}
```

### A.16 — Compare tick value to wall-clock now

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    for i := 0; i < 3; i++ {
        v := <-t.C
        now := time.Now()
        fmt.Println("scheduled:", v.Format("15:04:05.000"), "now:", now.Format("15:04:05.000"))
        time.Sleep(50 * time.Millisecond)
    }
}
```

The `now` value is consistently later than `v` because of scheduling delay and the `time.Sleep` in the previous iteration.

### A.17 — Ticker on a goroutine, stop from main

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(100 * time.Millisecond)
    done := make(chan struct{})
    go func() {
        for {
            select {
            case <-done:
                return
            case v := <-t.C:
                fmt.Println(v.Format("15:04:05.000"))
            }
        }
    }()
    time.Sleep(500 * time.Millisecond)
    close(done)
    t.Stop()
}
```

### A.18 — Aggregate ticks into batches

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(50 * time.Millisecond)
    defer t.Stop()
    end := time.After(time.Second)
    batch := make([]time.Time, 0, 4)
    for {
        select {
        case <-end:
            fmt.Println("final batch:", len(batch))
            return
        case v := <-t.C:
            batch = append(batch, v)
            if len(batch) == 4 {
                fmt.Println("batch of 4")
                batch = batch[:0]
            }
        }
    }
}
```

### A.19 — Use ticker to retry until success

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "math/rand"
    "time"
)

func attempt() error {
    if rand.Intn(5) == 0 {
        return nil
    }
    return errors.New("not yet")
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    t := time.NewTicker(150 * time.Millisecond)
    defer t.Stop()
    for {
        if err := attempt(); err == nil {
            fmt.Println("ok")
            return
        }
        select {
        case <-ctx.Done():
            fmt.Println("gave up:", ctx.Err())
            return
        case <-t.C:
        }
    }
}
```

(Note: `time.Ticker` is the simple choice here; exponential backoff is better in real retries — see [`04-exponential-backoff`](../04-exponential-backoff/).)

### A.20 — Demonstrate the leak (do not commit this)

```go
package main

import (
    "fmt"
    "time"
)

func leak() {
    time.NewTicker(time.Second) // no Stop, no reference held
}

func main() {
    for i := 0; i < 1000; i++ {
        leak()
    }
    fmt.Println("leaked 1000 tickers")
    time.Sleep(2 * time.Second)
}
```

On Go 1.23+ the runtime can GC the unreferenced tickers eventually, but on older versions they accumulate. Run with `GODEBUG=schedtrace=1000 go run leak.go` and observe.

---

## Appendix B: Reference Quick Look

A condensed reference you can keep open in a side panel while writing code.

```go
// Construct
t := time.NewTicker(d) // d must be > 0; panics otherwise

// The channel
t.C // <-chan time.Time, buffer = 1

// Stop (releases runtime resources, safe to call multiple times)
t.Stop()

// Reset (changes interval; do not call concurrently with the consumer in old Go)
t.Reset(newD)

// Convenience helpers
time.Tick(d)         // <-chan time.Time; cannot be stopped; leaks (smell on >=1.23)
time.Sleep(d)        // blocks the current goroutine

// Companion types
time.NewTimer(d)     // one-shot; .C, .Stop, .Reset
time.AfterFunc(d, fn)// one-shot callback; .Stop
time.After(d)        // <-chan time.Time; allocates a Timer; OK once, leaky in a loop
```

Common parameters and their consequences:

| Parameter | Value | Effect |
|---|---|---|
| `d` for `NewTicker` | `<= 0` | panic |
| `d` for `NewTicker` | very small (`< 1ms`) | high CPU baseline |
| `d` for `NewTicker` | very large (`> 1h`) | fine, no special handling |
| Buffer of `t.C` | always 1 | extra ticks drop |
| First tick | always after `d` | not immediate |
| `Stop` on already-stopped | no-op | safe |
| `Reset` on stopped | re-arms | leftover buffered tick may surprise |

---

## Appendix C: A Mini-Glossary of Runtime Words

You will hear these in code reviews and senior discussions. Quick definitions for now; the senior file gives the long versions.

- **Timer heap**: a sorted heap of pending timers maintained by the Go runtime. Each ticker holds one entry.
- **Monotonic clock**: a clock that never moves backwards. The runtime uses it for measuring intervals.
- **Wall clock**: the human-friendly clock you see in `date(1)`. Can jump on NTP correction.
- **`runtime.nanotime`**: the runtime's internal monotonic time source, in nanoseconds.
- **`startTimer` / `stopTimer`**: internal runtime functions called by `NewTicker` and `Stop`.
- **`when` field**: the absolute monotonic nanosecond at which the timer is scheduled to fire next.
- **`period` field**: the interval for periodic timers like tickers. Set to zero for one-shot timers.
- **`f` field**: the function to call when the timer fires. For tickers, it sends to the channel.

You will see these names in `runtime/time.go` if you go reading the source.

---

## Appendix D: Three Exercises With Answers

A small set of exercises to confirm understanding. Try each before reading the answer.

### Exercise D1

Write a function `Every` that runs `fn` every `d`, starting immediately, and stops when `ctx` is cancelled.

```go
func Every(ctx context.Context, d time.Duration, fn func()) {
    // ...
}
```

**Answer.**

```go
func Every(ctx context.Context, d time.Duration, fn func()) {
    if d <= 0 {
        return
    }
    fn()
    t := time.NewTicker(d)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            fn()
        }
    }
}
```

### Exercise D2

Write a function `TickN` that returns a slice of the first N tick values, or fewer if `ctx` is cancelled.

```go
func TickN(ctx context.Context, d time.Duration, n int) []time.Time {
    // ...
}
```

**Answer.**

```go
func TickN(ctx context.Context, d time.Duration, n int) []time.Time {
    if d <= 0 || n <= 0 {
        return nil
    }
    out := make([]time.Time, 0, n)
    t := time.NewTicker(d)
    defer t.Stop()
    for len(out) < n {
        select {
        case <-ctx.Done():
            return out
        case v := <-t.C:
            out = append(out, v)
        }
    }
    return out
}
```

### Exercise D3

Spot the bug.

```go
func Run(ctx context.Context) {
    t := time.NewTicker(time.Second)
    for {
        select {
        case <-ctx.Done():
            t.Stop()
            return
        case <-t.C:
            doWork()
        }
    }
}
```

**Answer.** No `defer t.Stop()`. The explicit `t.Stop()` inside the cancel case works, but if `doWork` panics the ticker leaks. Use `defer`.

```go
func Run(ctx context.Context) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            doWork()
        }
    }
}
```

---

## Appendix E: A Note on Concurrency Diagrams

Throughout this Roadmap we use boxes-and-arrows to show concurrent flows. A ticker drawn correctly:

```
+----+         +-----+
| go |--NewT-->|tick |  (runtime timer)
+----+         +-----+
                  |
                  | sends time.Time
                  v
              +------+
              | t.C  | (buffer = 1)
              +------+
                  |
                  | <-t.C
                  v
              +-------+
              | yourC |  (your goroutine)
              +-------+
```

The arrow from the timer to `t.C` is a non-blocking send. If `t.C` is full, the send is dropped. The arrow from `t.C` to your code is a blocking receive: your code waits until a value arrives.

When you draw your own concurrency systems, label each arrow with its blocking-or-not nature. This catches most bugs before you write the code.

---

End of junior file. Move to [`middle.md`](middle.md) when the [self-assessment checklist](#self-assessment-checklist) above is fully checked.
