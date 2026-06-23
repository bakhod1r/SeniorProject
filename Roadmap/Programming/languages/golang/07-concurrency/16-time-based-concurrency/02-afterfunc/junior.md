---
layout: default
title: Junior
parent: AfterFunc
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/02-afterfunc/junior/
---

# time.AfterFunc — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [The Signature, Word by Word](#the-signature-word-by-word)
6. [Real-World Analogies](#real-world-analogies)
7. [Mental Models](#mental-models)
8. [Pros and Cons](#pros-and-cons)
9. [Use Cases](#use-cases)
10. [Code Examples](#code-examples)
11. [Coding Patterns](#coding-patterns)
12. [Clean Code](#clean-code)
13. [Product Use](#product-use)
14. [Error Handling](#error-handling)
15. [Security Considerations](#security-considerations)
16. [Performance Tips](#performance-tips)
17. [Best Practices](#best-practices)
18. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
19. [Common Mistakes](#common-mistakes)
20. [Common Misconceptions](#common-misconceptions)
21. [Tricky Points](#tricky-points)
22. [Test](#test)
23. [Tricky Questions](#tricky-questions)
24. [Cheat Sheet](#cheat-sheet)
25. [Self-Assessment Checklist](#self-assessment-checklist)
26. [Summary](#summary)
27. [What You Can Build](#what-you-can-build)
28. [Further Reading](#further-reading)
29. [Related Topics](#related-topics)
30. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction

> Focus: "I want to run a function after some time has passed, and I do not want to start a goroutine and a channel and a select to do it."

The `time` package gives Go programmers three primary ways to do something after a delay:

1. `time.Sleep(d)` — block the current goroutine for `d`, then continue.
2. `<-time.After(d)` — block until a value arrives on a channel that the runtime fires after `d`.
3. `time.AfterFunc(d, f)` — schedule `f` to run, *in a new goroutine*, after `d`.

The third one is the subject of this entire subsection. It is the **fire-and-forget timer**: the call returns immediately, and somewhere in the future (give or take a few microseconds of scheduler lag) the runtime will call your function `f` for you. You do not have to write `go`. You do not have to write `select`. You do not have to write a channel receive. The runtime does all of that.

That sounds wonderful and it is, for a while. But because the callback runs in **its own goroutine**, on a clock that is independent of your code, `AfterFunc` carries a small number of foot-guns that grow into very large foot-guns in production. The rest of this file teaches you the safe, beginner-level use of the primitive: what it does, how to start one, how to stop one, when to use it, and how to avoid the first wave of mistakes.

After reading this file you will:

- Know the signature `time.AfterFunc(d time.Duration, f func()) *time.Timer` cold.
- Be able to schedule a callback, stop it before it fires, and check whether your `Stop` actually stopped it.
- Understand that the callback runs in a *new* goroutine, not the goroutine that called `AfterFunc`.
- Recognise the danger of `time.After` versus `AfterFunc` in long-running loops.
- Write the most common patterns: timeout watchdog, delayed retry, one-shot cleanup.
- Know which mistakes will cost you the most when you reach a real production environment.

You do **not** need to know about the internals of the timer heap, the cost of `Reset`, the behaviour of `context.AfterFunc`, or how to write a self-rescheduling timer yet. Those are for `middle.md` and beyond.

---

## Prerequisites

- A Go installation, version 1.21 or newer recommended (1.18+ works for everything except `context.AfterFunc`).
- Comfort with `time.Duration` literals: `time.Second`, `500*time.Millisecond`, `2*time.Minute`.
- Familiarity with goroutines: the keyword `go`, the fact that they run concurrently, and the fact that the main goroutine returning ends the program.
- Familiarity with closures: you should be able to read `func() { fmt.Println(x) }` and understand that `x` is captured from the enclosing scope.
- Awareness of `sync.WaitGroup` or some way to wait for background work to finish — handy for examples.

You do not need to know about channels in any detail, the timer heap, the runtime scheduler, or `context.Context`. A single `main()` and a `fmt.Println` are enough.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`time.AfterFunc(d, f)`** | The standard library function that schedules `f` to run in a new goroutine after the duration `d` elapses. Returns a `*time.Timer`. |
| **`*time.Timer`** | A pointer to a runtime timer object. You use it to `Stop` or `Reset` the scheduled callback. |
| **Callback** | The function `f` that you pass to `AfterFunc`. It runs in a freshly spawned goroutine when the timer expires. |
| **Fire / expire** | The moment when the runtime decides "time is up" and schedules the callback to run. |
| **`Stop()`** | Method on `*time.Timer` that prevents the callback from running, **if** it has not started yet. Returns `true` if it stopped the timer, `false` if the timer had already fired or been stopped. |
| **`Reset(d)`** | Method on `*time.Timer` that reschedules the timer to fire after `d` from now. Has subtle semantics (covered at middle level). |
| **One-shot timer** | A timer that fires once and is then done. `AfterFunc` always produces a one-shot timer (it does not auto-rearm). |
| **`time.Sleep(d)`** | Blocks the current goroutine for `d`. The simplest delay; no cancellation. |
| **`time.After(d)`** | Returns a `<-chan time.Time` that receives one value after `d`. Useful in `select`. |
| **Goroutine leak** | A goroutine that is started but never returns. `AfterFunc` callbacks rarely leak by themselves, but the goroutines they spawn inside the callback can. |
| **Monotonic clock** | A clock that only goes forward, used internally by Go timers so they do not jump when the wall clock is adjusted (NTP, daylight savings). |
| **Closure capture** | When a function literal references variables from its surrounding scope. The captured variables stay alive as long as the closure does — which, for an `AfterFunc` callback, is at least until the timer fires. |

---

## Core Concepts

### `AfterFunc` is "spawn a goroutine, but later"

The single most useful mental model for `time.AfterFunc(d, f)` is:

> "Start a goroutine that runs `f`, except the goroutine doesn't *exist yet* — it will be created `d` from now."

That is a near-perfect description. The runtime maintains an internal heap of pending timers. Periodically (and aggressively, as part of the scheduler's normal work) the runtime checks the heap for any timers whose `when` has passed. For each one, it pulls the entry off the heap and, if the entry has an `f` to run, it **goes on to start a goroutine** with that `f`.

So `time.AfterFunc(d, f)` is shorthand for:

```go
// Pseudo-Go — not real code.
go func() {
    time.Sleep(d)
    f()
}()
```

That model is *almost* right and good enough for the junior level. The differences (no goroutine is parked sleeping; the runtime never wastes a goroutine on a pending timer) are explored in `senior.md`.

### The call returns immediately

```go
t := time.AfterFunc(5*time.Second, func() {
    fmt.Println("five seconds passed")
})
fmt.Println("scheduled")
```

The output is:

```
scheduled
... (five seconds pass) ...
five seconds passed
```

Note that the line `fmt.Println("scheduled")` runs *before* the callback. `AfterFunc` is non-blocking. It does not wait for the timer to fire. It registers the timer with the runtime and returns.

### The callback runs in **its own** goroutine

This is the single most important thing about `AfterFunc`. The callback does **not** run on the goroutine that called `AfterFunc`. It runs on a freshly created goroutine that the runtime spawns at fire time.

That has three immediate consequences:

1. **Synchronisation matters.** If the callback touches data that the caller also touches, you need a mutex, an atomic, or a channel. There is no automatic memory ordering between "calling code at time `t`" and "callback at time `t+d`."
2. **Panics inside the callback are not recovered by the caller.** A panic in the callback's goroutine, like a panic in any goroutine, kills the program if nothing inside the callback recovers it.
3. **The callback can run while the rest of your program is doing other things.** It can run while you are inside `Stop`. It can run while you are reading the timer's fields. It can run after your `main()` is about to return.

We will see all three of these later.

### `Stop` is the brake — but it does not always brake

`Stop()` returns a `bool`:

- `true` — the timer was still pending; `Stop` prevented the callback from running.
- `false` — the timer had already fired (callback is running or has run) OR had already been stopped.

```go
t := time.AfterFunc(100*time.Millisecond, func() {
    fmt.Println("fired")
})

if t.Stop() {
    fmt.Println("stopped before firing")
} else {
    fmt.Println("too late or already stopped")
}
```

For a callback-style timer, the `false` case means **the callback is either already running or has already completed**. `Stop` does not "wait" for the callback. It does not "cancel" a callback that has already started executing. It just removes the timer from the runtime's heap if it is still there.

The implication: if your callback does something irreversible (sends a message, deletes a file, closes a channel), `Stop` returning `false` is *not* the same as "nothing happened." You may be racing against your own callback.

### The timer is one-shot

Unlike `time.Ticker`, which fires repeatedly, `time.Timer` created by `AfterFunc` fires once. After it fires, it is "expired." You can call `Reset` on an expired timer to rearm it, but you should be aware that this has subtle rules (covered at middle level).

If you want repeating behaviour, either:

- Use `time.Ticker` (the right answer most of the time), or
- Have the callback itself call `time.AfterFunc` again (a self-rescheduling timer — covered at senior level).

### `AfterFunc` keeps the timer alive

You do not need to keep a reference to the returned `*time.Timer` for the callback to fire. The runtime holds a reference. Even if you write:

```go
time.AfterFunc(5*time.Second, doWork)
// no variable assignment
```

`doWork` will still run in five seconds. The only reason to capture the return value is if you want to `Stop` or `Reset` the timer.

### Garbage collection of the callback's closure

The closure passed to `AfterFunc` is held alive by the runtime timer until **after** the callback has finished running. This is a frequent source of memory pressure in pathological cases:

```go
func handle(req *HugeRequest) {
    time.AfterFunc(10*time.Minute, func() {
        log.Println("late log for", req.ID)
    })
}
```

That closure captures `req` (because it references `req.ID`), and so the entire `HugeRequest` is pinned in memory for 10 minutes. We will revisit this in the leak hazards section.

---

## The Signature, Word by Word

```go
func AfterFunc(d Duration, f func()) *Timer
```

Let's unpack every piece.

### `func AfterFunc`

A package-level function. You call it as `time.AfterFunc(...)`. There is no `Timer` constructor you have to instantiate first.

### `(d Duration, ...)`

The first argument is a `time.Duration`. That is just a typed `int64` representing nanoseconds. Idiomatic usage:

```go
time.AfterFunc(500*time.Millisecond, ...)
time.AfterFunc(2*time.Second, ...)
time.AfterFunc(time.Minute, ...)
```

**Pitfall:** `Duration` is signed. A negative duration is legal and is treated as "expire immediately." The callback is fired as soon as the runtime gets around to it.

```go
time.AfterFunc(-1*time.Second, func() {
    fmt.Println("fires almost immediately")
})
```

This is sometimes useful (you can compute a deadline as `time.Until(deadline)`, and if the deadline is in the past, the result is negative — the callback will fire promptly). It is sometimes a bug (you intended a positive duration but a subtraction went the wrong way).

### `(..., f func())`

The second argument is a function value with **no parameters and no return value**. This is the *callback*. If you need to pass data to the callback, use a closure:

```go
userID := 42
time.AfterFunc(time.Second, func() {
    log.Println("expired for user", userID)
})
```

If you need the callback to return something, you cannot — but you can have the closure write to a shared variable (synchronised), send on a channel, or call another function that records the result.

### `*Timer`

The return type is `*time.Timer`. This is a pointer to a timer object:

```go
type Timer struct {
    C <-chan Time
    // unexported fields
}
```

For a timer created by `AfterFunc`, the field `C` is **nil**. The runtime fires the callback directly; it does not also send on a channel. That is an important point: `AfterFunc` timers do *not* deliver to `C`. If you try `<-t.C` on an `AfterFunc` timer, you will block forever.

You use the returned pointer for two purposes:

- `t.Stop()` — try to cancel the callback before it fires.
- `t.Reset(d)` — reschedule the timer to fire after a new duration.

Everything else on the struct is unexported. There is no public field to inspect whether the timer has fired.

---

## Real-World Analogies

### The kitchen timer

Setting `time.AfterFunc(10*time.Minute, takeOutCake)` is like winding a kitchen timer and walking away. The timer is sitting on the counter, counting down. When it dings, the kitchen helper (a goroutine the runtime spawns for you) takes the cake out of the oven. You did not have to stand in the kitchen waiting.

`Stop()` is reaching back to the counter and turning the timer off before it dings. If you get there before it dings, great — no one disturbs the kitchen. If you get there after it dings, the helper is already taking the cake out, and your "turning off" is too late to prevent that.

### The alarm clock with a snooze button

`Reset(d)` is the snooze button. You wind the timer to a new duration. But — and this is the subtle bit — pressing snooze on an alarm clock that is currently ringing has different semantics depending on the clock. On some clocks it cancels and restarts (clean); on others it ignores the press. Go's `Reset` historically had subtle behaviour around expired-but-not-yet-drained timers; Go 1.23 cleaned this up significantly. We will revisit at middle level.

### The dead-man's switch

Watchdog usage is conceptually a "dead-man's switch." You set a 30-second timer to "panic / kill connection / log error." Every time the system shows signs of life, you `Reset` the timer for another 30 seconds. If the system goes dark for 30 seconds, the timer fires and the recovery action runs. We will see this pattern in detail.

### The pizza delivery promise

Some pizza chains advertise "30 minutes or free." You start the timer at order time. You `Reset` if the delivery driver calls to say "five more minutes." You `Stop` when the pizza arrives. If the timer fires before the pizza arrives, the callback runs (refund customer). This is essentially a deadline pattern.

---

## Mental Models

### Model 1: AfterFunc = scheduled goroutine

> "AfterFunc(d, f) is `go f()` shifted into the future by `d`."

Excellent first model. It's accurate to within a few microseconds of scheduling jitter, and it captures the most important fact — that the callback runs in its own goroutine. Use this model until you start working with millions of timers.

### Model 2: The runtime is a giant priority queue of timers

> "The runtime maintains a min-heap of `(when, f)` pairs. The scheduler periodically pops everything whose `when` has passed and spawns goroutines for each `f`."

This is closer to the implementation. It correctly explains:

- Why creating a million timers is *not* equivalent to spawning a million goroutines (the timers sit in a heap; goroutines are only spawned at fire time).
- Why `Stop` is fast (it removes an entry from a heap).
- Why timers with the same `when` may not fire in the order they were created.

This model becomes the dominant one at the senior level.

### Model 3: Timers as state machines

A `time.Timer` is in one of three logical states:

1. **Active** — the runtime has a pending entry on the heap. `Stop` will succeed.
2. **Fired** — the runtime has already pulled the entry off the heap and either run or scheduled the callback. `Stop` will return `false`. The callback may or may not have finished.
3. **Stopped** — `Stop` was called while the timer was Active. The entry is gone. The callback will not run.

You can `Reset` from any state, but the semantics differ. We will cover all six transitions explicitly in `middle.md`.

### Model 4: The closure is held alive

> "The closure you pass to `AfterFunc` is reachable from the timer entry until the callback finishes."

This explains the memory pinning problem. If you pass a closure that captures a 50 MB buffer, that buffer stays alive for the full duration plus the callback's runtime. For a five-minute timer, that is five minutes of pinned memory. For a five-hour timer over a million requests, that is a memory disaster.

---

## Pros and Cons

### Pros

- **No manual goroutine.** The runtime spawns the goroutine for you. No `go func() { time.Sleep(d); f() }()` boilerplate.
- **No idle goroutine.** Unlike the `time.Sleep` pattern, the runtime does not park a goroutine waiting for the timer. The timer sits in a heap; a goroutine is created only at fire time.
- **Cancellable.** `Stop` lets you abort the timer if it has not fired yet.
- **Reusable.** `Reset` lets you push the deadline out without creating a new timer.
- **Cheap.** Each timer is one heap entry. Even at scale (tens of thousands of pending timers per process), the cost is manageable.
- **Simple API.** Two functions, one method, one constructor.

### Cons

- **Callback runs on a new goroutine.** Synchronisation is your problem. Panics are your problem. Memory ordering is your problem.
- **`Stop` is not synchronous.** A `false` return from `Stop` does *not* mean the callback is done. It might be in flight on another goroutine.
- **No built-in panic recovery.** If your callback panics, the program dies. You must `defer recover()` inside the callback if you care.
- **The closure pins memory.** Captured variables live until the timer fires.
- **`Reset` has historical gotchas.** Subtle rules about expired timers; covered at middle level.
- **No native context integration before Go 1.21.** You have to wire `Stop` to cancellation manually.

---

## Use Cases

### 1. Delayed retry

Retry a failed operation after a backoff:

```go
func retryLater(op func() error, after time.Duration) {
    time.AfterFunc(after, func() {
        if err := op(); err != nil {
            log.Printf("retry failed: %v", err)
        }
    })
}
```

### 2. Deadline / timeout watchdog

If the system does not respond within `d`, take action:

```go
func startWatchdog(d time.Duration, action func()) *time.Timer {
    return time.AfterFunc(d, action)
}

t := startWatchdog(30*time.Second, func() {
    log.Println("system frozen, restarting")
    os.Exit(1)
})
defer t.Stop()
```

### 3. One-shot cleanup

Clean up a resource after a delay:

```go
func showTooltip(msg string) {
    display(msg)
    time.AfterFunc(3*time.Second, func() {
        hide(msg)
    })
}
```

### 4. Throttled event flush

After the first event, wait `d` then flush all queued events. This is the classic "debounce" pattern:

```go
type Debouncer struct {
    mu    sync.Mutex
    timer *time.Timer
    delay time.Duration
    fn    func()
}

func (d *Debouncer) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.timer != nil {
        d.timer.Stop()
    }
    d.timer = time.AfterFunc(d.delay, d.fn)
}
```

(The full safe version is shown later — there is a race here.)

### 5. Delayed garbage collection

Free a cached entry after a TTL:

```go
cache.Set(key, value)
time.AfterFunc(ttl, func() {
    cache.Delete(key)
})
```

(Real caches do not use one timer per entry — too many timers. But for small caches it is fine.)

### 6. Tests

In tests, schedule cancellations or simulated events:

```go
func TestServerShutsDown(t *testing.T) {
    s := NewServer()
    go s.Run()
    time.AfterFunc(50*time.Millisecond, s.Shutdown)
    select {
    case <-s.Done():
    case <-time.After(time.Second):
        t.Fatal("server did not shut down")
    }
}
```

---

## Code Examples

### Example 1: Hello, AfterFunc

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    fmt.Println("scheduling")
    time.AfterFunc(time.Second, func() {
        fmt.Println("one second passed")
    })
    fmt.Println("scheduled, sleeping main")
    time.Sleep(2 * time.Second)
    fmt.Println("done")
}
```

Output:

```
scheduling
scheduled, sleeping main
one second passed
done
```

Note: we have to `time.Sleep` in `main` because `main` returning would kill the program before the callback fires. In real code you would use `sync.WaitGroup`, a channel, or `context.Context` to wait properly.

### Example 2: Stopping before fire

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.AfterFunc(time.Second, func() {
        fmt.Println("should not see this")
    })

    time.Sleep(100 * time.Millisecond)
    if t.Stop() {
        fmt.Println("stopped in time")
    } else {
        fmt.Println("too late")
    }
    time.Sleep(2 * time.Second)
}
```

Output:

```
stopped in time
```

### Example 3: Stopping too late

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.AfterFunc(100*time.Millisecond, func() {
        fmt.Println("fired")
    })

    time.Sleep(500 * time.Millisecond) // long enough for it to fire
    if t.Stop() {
        fmt.Println("stopped in time (will not see this)")
    } else {
        fmt.Println("too late, callback already fired or stopped")
    }
}
```

Output:

```
fired
too late, callback already fired or stopped
```

### Example 4: Sharing data via a channel

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    done := make(chan struct{})
    time.AfterFunc(500*time.Millisecond, func() {
        fmt.Println("callback ran")
        close(done)
    })
    <-done
    fmt.Println("main observed")
}
```

This avoids the `time.Sleep` workaround and waits cleanly for the callback.

### Example 5: Waiting with a WaitGroup

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    time.AfterFunc(200*time.Millisecond, func() {
        defer wg.Done()
        fmt.Println("callback")
    })
    wg.Wait()
    fmt.Println("main saw done")
}
```

### Example 6: Cancellation via a Stop wrapper

```go
package main

import (
    "fmt"
    "time"
)

type Cancellable struct {
    t *time.Timer
}

func DoLater(d time.Duration, f func()) *Cancellable {
    return &Cancellable{t: time.AfterFunc(d, f)}
}

func (c *Cancellable) Cancel() bool {
    return c.t.Stop()
}

func main() {
    c := DoLater(time.Second, func() { fmt.Println("ran") })
    if c.Cancel() {
        fmt.Println("cancelled")
    }
}
```

### Example 7: A captured loop variable, the classic foot-gun

Before Go 1.22, this prints "3 3 3" instead of "0 1 2":

```go
for i := 0; i < 3; i++ {
    time.AfterFunc(time.Duration(i)*100*time.Millisecond, func() {
        fmt.Println(i) // captures i by reference
    })
}
time.Sleep(time.Second)
```

Fix (pre-1.22): shadow `i`:

```go
for i := 0; i < 3; i++ {
    i := i
    time.AfterFunc(time.Duration(i)*100*time.Millisecond, func() {
        fmt.Println(i)
    })
}
```

Go 1.22+: the loop already gives each iteration its own `i`, and the bug is fixed.

### Example 8: Multiple timers

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    var wg sync.WaitGroup
    for _, name := range []string{"a", "b", "c"} {
        name := name
        wg.Add(1)
        time.AfterFunc(100*time.Millisecond, func() {
            defer wg.Done()
            fmt.Println("hello", name)
        })
    }
    wg.Wait()
}
```

### Example 9: Backed off retry

```go
package main

import (
    "errors"
    "fmt"
    "math/rand"
    "time"
)

func tryOnce() error {
    if rand.Intn(3) == 0 {
        return nil
    }
    return errors.New("transient")
}

func retry(attempt int, done chan<- error) {
    if err := tryOnce(); err == nil {
        done <- nil
        return
    }
    if attempt >= 5 {
        done <- fmt.Errorf("gave up after %d", attempt)
        return
    }
    backoff := time.Duration(1<<attempt) * 50 * time.Millisecond
    fmt.Println("retry in", backoff)
    time.AfterFunc(backoff, func() {
        retry(attempt+1, done)
    })
}

func main() {
    done := make(chan error)
    retry(0, done)
    fmt.Println(<-done)
}
```

### Example 10: Deadline pattern

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

func main() {
    var done atomic.Bool
    t := time.AfterFunc(200*time.Millisecond, func() {
        if !done.Load() {
            fmt.Println("deadline exceeded")
        }
    })

    // Do some work
    time.Sleep(100 * time.Millisecond)
    done.Store(true)
    t.Stop()
    fmt.Println("work done in time")
}
```

### Example 11: Demonstrating the callback is in its own goroutine

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    fmt.Println("main goroutine pre-schedule:", runtime.NumGoroutine())
    done := make(chan struct{})
    time.AfterFunc(100*time.Millisecond, func() {
        fmt.Println("inside callback:", runtime.NumGoroutine())
        close(done)
    })
    fmt.Println("main goroutine post-schedule:", runtime.NumGoroutine())
    <-done
    time.Sleep(50 * time.Millisecond)
    fmt.Println("main goroutine after callback:", runtime.NumGoroutine())
}
```

The number of goroutines bumps up by one *during* the callback, then back down.

### Example 12: Panics in the callback

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    time.AfterFunc(100*time.Millisecond, func() {
        panic("oops")
    })
    time.Sleep(time.Second)
    fmt.Println("never seen")
}
```

The program exits with a panic. The `fmt.Println("never seen")` is never reached. Always recover inside the callback if you care:

```go
time.AfterFunc(100*time.Millisecond, func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("callback panic: %v", r)
        }
    }()
    riskyOp()
})
```

### Example 13: Avoid time.After in long loops

This is a footgun, not technically `AfterFunc`-related but the same family:

```go
// BAD — creates a new timer every iteration, even when ctx cancels.
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(time.Second):
        doWork()
    }
}
```

`time.After` does **not** garbage-collect the channel if the surrounding select picks another branch. Every loop iteration creates a new timer. Use a `time.NewTimer` and `Reset`, or `time.AfterFunc` for a one-shot, or `time.Ticker` for repeating.

### Example 14: Replace time.After with AfterFunc for "do work in N seconds"

```go
// Instead of:
go func() {
    select {
    case <-time.After(d):
        doWork()
    case <-ctx.Done():
    }
}()

// You can write:
t := time.AfterFunc(d, doWork)
go func() {
    <-ctx.Done()
    t.Stop()
}()
```

The second form uses one goroutine (the cancel listener) instead of two (the sleeper and possibly the worker). The runtime does not park a goroutine waiting on the timer.

### Example 15: An idle-connection timeout

```go
type Conn struct {
    mu   sync.Mutex
    idle *time.Timer
}

func NewConn() *Conn {
    c := &Conn{}
    c.idle = time.AfterFunc(30*time.Second, c.closeIdle)
    return c
}

func (c *Conn) Use() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.idle.Reset(30 * time.Second) // refresh deadline on every use
}

func (c *Conn) closeIdle() {
    fmt.Println("closing idle connection")
}
```

This works for the simple case. The `Stop` + `Reset` race is covered at middle level.

---

## Coding Patterns

### Pattern A: Schedule-and-forget

When the callback's side effect is idempotent and there is no reason to cancel:

```go
time.AfterFunc(d, func() {
    cleanup()
})
```

You discard the return value. The runtime keeps the timer alive.

### Pattern B: Schedule-with-cancel

When you may need to cancel later:

```go
t := time.AfterFunc(d, func() {
    cleanup()
})
defer t.Stop()
```

`Stop` returning `false` when `cleanup` is already running is acceptable here — the cleanup is what we wanted anyway.

### Pattern C: Schedule-with-guard

When the callback's side effect is dangerous if it races with the rest of the function:

```go
var done atomic.Bool
t := time.AfterFunc(d, func() {
    if done.Load() {
        return
    }
    cleanup()
})

doWork()
done.Store(true)
t.Stop()
```

The guard ensures that even if `Stop` returns `false` (because the callback already started), the callback does nothing.

### Pattern D: Schedule-and-await

When you want to wait for the callback in a `select`:

```go
fired := make(chan struct{})
time.AfterFunc(d, func() { close(fired) })

select {
case <-fired:
    fmt.Println("timer fired")
case <-ctx.Done():
    fmt.Println("cancelled")
}
```

This blurs the line between `AfterFunc` and `time.After`. If all you want is "fire after d into a channel," prefer `time.After` or a `time.NewTimer`. Reach for `AfterFunc` when the callback does more than just signal.

### Pattern E: Self-rescheduling timer

```go
var run func()
run = func() {
    work()
    time.AfterFunc(time.Second, run)
}
time.AfterFunc(time.Second, run)
```

This *looks* like a ticker but is not — there is jitter, and there is no way to drop ticks if work is slow. Use `time.NewTicker` for periodic work unless you specifically want "1 second after the last finish, not 1 second after the last start."

### Pattern F: Timeout wrapper

```go
func WithTimeout(d time.Duration, op func() error) error {
    done := make(chan error, 1)
    t := time.AfterFunc(d, func() {
        done <- errors.New("timeout")
    })
    go func() {
        done <- op()
    }()
    err := <-done
    t.Stop()
    return err
}
```

The capacity-1 channel avoids leaking the goroutine that loses the race.

---

## Clean Code

- Name the timer variable for what it represents, not "t": `idleTimeout`, `retryTimer`, `watchdog`.
- Keep the callback short. Long callbacks make the goroutine spawn cost more visible.
- Always handle the `Stop` return if the callback has any non-idempotent side effect.
- Use closures for context, not globals: prefer `time.AfterFunc(d, func() { f(userID) })` to a global `currentUserID`.
- Recover panics in callbacks that you don't fully trust, or in any callback in a production binary.
- For one-shot delays, use `AfterFunc`. For periodic work, use `Ticker`. Do not stack self-rescheduling AfterFuncs to fake a ticker.
- For deadlines tied to a request, prefer `context.AfterFunc` (Go 1.21+) — see `middle.md`.

---

## Product Use

`AfterFunc` shows up in product code in roles like:

- **Session expiration.** "If the user hasn't done anything in 30 minutes, log them out."
- **Order timeout.** "If the merchant hasn't confirmed in 90 seconds, refund and notify."
- **Cache TTL.** "Drop this entry from the in-memory cache in 5 minutes."
- **Connection idle.** "Close this DB connection if it sits unused for 10 minutes."
- **Notification scheduler.** "Send the reminder push notification in 24 hours unless cancelled."
- **Circuit breaker reset.** "After the breaker opens, attempt half-open in 60 seconds."

A subtle product question is "what does the user feel when the timer fires?" — sometimes the callback is invisible (cleanup), and sometimes it is highly visible (logout). For high-visibility callbacks, robust panic handling and a guard against double-fire are critical.

---

## Error Handling

There is no error return from `AfterFunc`. There cannot be — the timer might fire successfully, even if it fires "late." Errors in the callback are your problem.

Three rules for error handling in callbacks:

### Rule 1: Recover panics

```go
time.AfterFunc(d, func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("timer panic: %v\n%s", r, debug.Stack())
        }
    }()
    work()
})
```

In production, *all* timer callbacks should `recover`. A single unrecovered panic in a callback crashes the process.

### Rule 2: Log errors, don't swallow them

```go
time.AfterFunc(d, func() {
    if err := work(); err != nil {
        log.Printf("scheduled work failed: %v", err)
        metrics.IncCounter("scheduled_work_errors")
    }
})
```

Because the callback runs in its own goroutine, an error has nowhere to go unless you actively route it somewhere (a channel, a log, a metric).

### Rule 3: Don't block forever

A callback that blocks on a channel send/receive can pin a goroutine forever, defeating the cheap-ness of timers:

```go
time.AfterFunc(d, func() {
    results <- compute() // BAD: if no one reads, this leaks
})
```

Use buffered channels or `select` with a `default` or a cancellation channel.

---

## Security Considerations

`AfterFunc` is not a security feature, but it can become one if you misuse it.

### Time of check, time of use (TOCTOU)

If your callback checks "is the user still authorised?" and then performs an action, between the check and the action the user could be deauthorised. The callback runs in a separate goroutine and may run a long time after the check that scheduled it.

```go
// BAD
func deleteAfter(d time.Duration, userID int) {
    time.AfterFunc(d, func() {
        // user may have been deauthorised, role may have changed
        deleteUser(userID)
    })
}
```

Reload state and reauthorise inside the callback:

```go
time.AfterFunc(d, func() {
    if !isStillAuthorised(userID) {
        return
    }
    deleteUser(userID)
})
```

### Resource exhaustion

One timer per request is fine. One timer per request × 100 ms granularity for one million live sessions is 10 million timers. The runtime can handle a lot, but this can become a vector if attacker-controlled input creates timers without bound. Cap creation, batch deadlines, or use a single sweeper instead.

### Sensitive data in closures

If a callback captures sensitive data (a password, a token, a session key), that data sits in memory for the whole duration. For long-lived timers, clear sensitive data after the operation that needs it completes.

---

## Performance Tips

### Tip 1: Prefer AfterFunc over `go func() { time.Sleep(d); f() }()`

The latter holds a goroutine parked the entire duration. `AfterFunc` does not — the runtime spawns a goroutine only at fire time. For short-lived tests this is a non-issue; for long-running services with many delays, it matters.

### Tip 2: Prefer AfterFunc over `time.After` inside long-running loops

`time.After` does not garbage-collect on the non-fire branch of a select before the timer expires. In a tight loop this can create memory pressure. Use a `*time.Timer` you keep around, or move the work into an `AfterFunc` callback.

### Tip 3: Don't create a new timer if you can reset an existing one

```go
// BAD
func (s *Session) Touch() {
    if s.timer != nil {
        s.timer.Stop()
    }
    s.timer = time.AfterFunc(d, s.expire)
}
```

```go
// BETTER — assumes s.timer is already created
func (s *Session) Touch() {
    s.timer.Reset(d)
}
```

`Reset` is cheaper than `Stop` + `AfterFunc`. (At middle level we will show why this is *almost* safe and what to do for the edge cases.)

### Tip 4: Watch closure allocation

```go
// Allocates a closure capturing userID every time
time.AfterFunc(d, func() { expire(userID) })
```

If you call this millions of times per second, the closure allocation is real. Often the right answer is to batch: one timer for many entries, scanning a data structure.

### Tip 5: Use context.AfterFunc (Go 1.21) for context-tied callbacks

If your callback should run *when* a context is cancelled (not after a fixed duration), use `context.AfterFunc(ctx, f)`. It is purpose-built for that pattern and is cleaner than a goroutine waiting on `ctx.Done`.

---

## Best Practices

1. **Always handle the return of `Stop` if the callback's side effect is non-idempotent.**
2. **Recover panics inside the callback in production code.**
3. **Avoid capturing large objects in the callback closure.**
4. **Use `Reset` instead of `Stop` + new `AfterFunc` when possible.**
5. **Use `context.AfterFunc` (Go 1.21+) for context-driven cancellation callbacks.**
6. **Prefer `Ticker` for periodic work.**
7. **Cap the total number of live timers in your service — instrument with a metric.**
8. **Make callbacks short. If you have heavy work, dispatch from the callback to a worker.**
9. **Never `<-t.C` on an `AfterFunc` timer — its `C` is nil and you will block forever.**
10. **Document the lifetime of each timer in your code; "this timer outlives the request" is the kind of comment that saves debugging hours.**

---

## Edge Cases and Pitfalls

### Edge case 1: Negative duration fires immediately

```go
time.AfterFunc(-time.Second, func() {
    fmt.Println("fires asap")
})
```

This can be a feature (computed `time.Until` in the past) or a bug (subtraction went wrong). Bound durations with `max(d, 0)` if you are unsure.

### Edge case 2: Zero duration is *almost* immediate

```go
time.AfterFunc(0, func() { fmt.Println("now") })
```

Still goes through the timer machinery. There is a small but nonzero delay. If you want "right now in a goroutine," `go f()` is more honest.

### Edge case 3: Reading `t.C` on an AfterFunc timer blocks forever

```go
t := time.AfterFunc(d, f)
<-t.C // BAD: t.C is nil; this blocks forever
```

The `*time.Timer` for an `AfterFunc` has a nil `C`. Use `Stop`/`Reset` and synchronise via your own channel.

### Edge case 4: Stop after Stop

```go
t := time.AfterFunc(d, f)
t.Stop() // returns true (we caught it)
t.Stop() // returns false (already stopped)
```

The second `Stop` is harmless but returns `false`. If your logic depends on the boolean meaning "the callback ran," that interpretation is wrong — it means "we did not stop a still-pending timer."

### Edge case 5: Stop during fire

A real race: the runtime has decided to fire the timer, has spawned the goroutine, and the callback is starting — at exactly the moment you call `Stop`. `Stop` returns `false`. The callback runs. You may have a race that you have to handle (Pattern C above).

### Edge case 6: Reset after fire

```go
t := time.AfterFunc(d, f)
time.Sleep(2 * d) // wait for it to fire
t.Reset(d) // schedules a new firing
```

This is legal and (with modern Go) clean. The callback will run again after `d`. For an `AfterFunc` timer this is straightforward; for a channel-style timer there is an "is the channel drained?" wrinkle that doesn't apply here.

### Edge case 7: Reset after Stop

```go
t := time.AfterFunc(d, f)
t.Stop()
t.Reset(d) // reschedules
```

Legal and works. Useful for reusing a timer.

### Edge case 8: AfterFunc inside the callback

```go
var run func()
run = func() {
    work()
    time.AfterFunc(time.Second, run)
}
time.AfterFunc(time.Second, run)
```

Recursive self-scheduling. It works, but you cannot easily `Stop` the chain without an external guard (a flag, a context).

### Edge case 9: AfterFunc that schedules another goroutine that uses the timer

```go
t := time.AfterFunc(d, func() {
    go cleanup()
})
```

Now the cleanup goroutine outlives the timer. Make sure `cleanup` itself has a way to terminate.

---

## Common Mistakes

### Mistake 1: Treating Stop as synchronous

> "I called `Stop`, so the callback won't run." — wrong if `Stop` returned `false`.

### Mistake 2: Discarding the return of AfterFunc when cancellation matters

```go
time.AfterFunc(d, doIt) // can't cancel
```

If you might need to cancel, capture the timer.

### Mistake 3: Not recovering panics in callbacks

A single panic in a callback kills the process. In production, always recover.

### Mistake 4: Using `<-t.C` on an AfterFunc timer

The `C` is nil. You will deadlock.

### Mistake 5: Capturing large objects in the closure

A 50 MB request held alive for 10 minutes. Pin a small ID instead, look up the request in a store, or copy the field you need.

### Mistake 6: Using `time.After` in a loop instead of AfterFunc / Timer

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(time.Second):
        doWork()
    }
}
```

Each iteration creates a new timer. Memory pressure under load. Use a reused `*time.Timer` or call `doWork` from an `AfterFunc` callback that reschedules itself.

### Mistake 7: Spinning your own goroutine for the delay

```go
go func() {
    time.Sleep(d)
    doIt()
}()
```

Works, but it parks a goroutine waiting on `Sleep`. `time.AfterFunc(d, doIt)` is strictly better when you want one-shot.

### Mistake 8: Forgetting that the callback runs in a new goroutine

```go
var x int
time.AfterFunc(d, func() {
    x = 1 // races with main
})
fmt.Println(x) // data race
```

The runtime spawns a goroutine. You need synchronisation just as you would for any other goroutine.

### Mistake 9: Stopping a timer that is `nil`

```go
var t *time.Timer
t.Stop() // panics: nil pointer dereference
```

Guard with `if t != nil { t.Stop() }`.

### Mistake 10: Believing AfterFunc has any retry behaviour

It does not. If the callback panics or returns an error, the timer does not refire. If you want retries, write them yourself.

---

## Common Misconceptions

### "AfterFunc runs the callback on the calling goroutine"

No. It runs on a freshly created goroutine.

### "Stop is synchronous; after it returns, the callback is done"

No. `Stop` does not wait for the callback. If it returns `false`, the callback may be in flight on another goroutine. There is no built-in "wait until callback finished" primitive.

### "Stop returning true means the timer hadn't fired yet"

True for the *first* `Stop`. Subsequent `Stop` calls also return `false`, even though the callback never ran. The boolean is "did this call to Stop prevent a firing," not "has the callback run."

### "Reset is a synchronisation primitive"

No. `Reset` reschedules the timer. It does not synchronise with the running callback. If the callback is currently running, `Reset` does not wait for it to finish.

### "AfterFunc is cheaper than NewTimer"

No. Both create essentially the same runtime timer object. `AfterFunc` is a convenience for "fire as a callback" instead of "fire as a channel send."

### "AfterFunc is slower than NewTimer for short durations"

No measurable difference. Both go through the same heap.

### "A timer has a goroutine sleeping inside it"

No. The timer is a heap entry. No goroutine is parked for it. A goroutine is spawned only at fire time, and only for `AfterFunc` timers (channel-style timers just send on the channel).

### "AfterFunc returns when the callback finishes"

No. It returns immediately, before the callback even starts.

### "A timer fires exactly at d"

No. It fires *no earlier than* `d`. It may fire later due to scheduler lag, especially under heavy load.

---

## Tricky Points

### Tricky 1: The timer holds the closure, and the closure holds your data

If you write:

```go
big := make([]byte, 50*1024*1024)
time.AfterFunc(time.Hour, func() {
    fmt.Println(len(big))
})
```

`big` is alive for an hour, regardless of whether anything else still references it. The timer keeps it alive.

### Tricky 2: The callback can outlive main if main does not wait

```go
func main() {
    time.AfterFunc(100*time.Millisecond, func() {
        fmt.Println("never seen")
    })
} // main returns; program exits; callback never fires
```

The main goroutine returning kills the program. The runtime does not wait for pending timers.

### Tricky 3: Stop's return value is about *this* call, not history

`Stop()` returns `true` iff *this* call removed the timer from the heap. Once it's been removed (by a previous `Stop` or by firing), all subsequent `Stop` calls return `false`.

### Tricky 4: A callback can be running when you call Stop

The runtime takes the timer off the heap *before* spawning the callback goroutine. So between "off heap" and "goroutine started" there is a window where `Stop` returns `false` and the callback has not yet started. You cannot tell from `Stop`'s return whether the callback has started, is about to start, or has finished.

### Tricky 5: Reset() returns a bool. What does it mean?

For an `AfterFunc` timer, `Reset` always restarts the timer to fire after `d` from the moment of the call. The return value mirrors what `Stop` would have returned for the *prior* state — `true` if the timer was active and is now rescheduled to a new time, `false` if it had already fired or been stopped (and is now scheduled fresh). For `AfterFunc` callers this return value is rarely useful. We'll explore the channel-style case at middle level.

### Tricky 6: Closures share the captured variable

Two timers can capture the same variable and both observe its mutations:

```go
x := 0
time.AfterFunc(100*time.Millisecond, func() { fmt.Println(x) })
time.AfterFunc(200*time.Millisecond, func() { fmt.Println(x) })
x = 42
```

Both will print `42` (assuming the assignment happens before the first fire). To pin a value, copy into the closure: `x := x; time.AfterFunc(...)`.

### Tricky 7: AfterFunc inside a tight loop creates many timers fast

```go
for i := 0; i < 1_000_000; i++ {
    time.AfterFunc(time.Second, func() {})
}
```

This creates a million heap entries in a fraction of a second, then a million goroutines a second later, all running and exiting promptly. The runtime handles it, but the goroutine spike is visible in profiles.

---

## Test

Try these short questions before moving on. Answers below.

1. What does `time.AfterFunc` return?
2. Does the callback run on the goroutine that called `AfterFunc`?
3. What does `Stop()` return if the timer has already fired?
4. What happens if the callback panics?
5. What happens if you receive on `t.C` for a timer created by `AfterFunc`?
6. What happens if you pass a negative duration?
7. Does the runtime park a goroutine waiting for the timer?
8. How do you wait for the callback to finish?
9. What is the captured-loop-variable bug, and how do you fix it (pre Go 1.22)?
10. Does `time.After` and `time.AfterFunc` have the same internal cost?

Answers:

1. `*time.Timer`.
2. No — a new goroutine spawned by the runtime.
3. `false`.
4. The process crashes unless the callback `recover`s.
5. You block forever; `C` is nil.
6. The callback fires almost immediately.
7. No. Timers sit in a heap; a goroutine is spawned at fire time.
8. Use a channel, `sync.WaitGroup`, or `sync.Once` written by the callback. There is no built-in "wait for callback" call.
9. The bug: every closure captures the same loop variable, observing its final value. Fix: shadow with `i := i` before creating the closure. Go 1.22+ already gives each iteration a fresh variable.
10. Essentially yes — both create a runtime timer entry. `time.After` adds an unbuffered channel send; `AfterFunc` adds a goroutine spawn at fire time.

---

## Tricky Questions

These are interview-style questions calibrated to junior level.

**Q1.** I have

```go
t := time.AfterFunc(time.Second, func() { fmt.Println("a") })
t.Stop()
fmt.Println("b")
```

What gets printed?

**A.** `b`. The timer is stopped before it fires.

**Q2.** What about

```go
t := time.AfterFunc(time.Millisecond, func() { fmt.Println("a") })
time.Sleep(time.Second)
t.Stop()
fmt.Println("b")
```

**A.** `a` then `b`. The `Stop` is far too late; the callback has long since fired.

**Q3.** And

```go
ch := make(chan struct{})
time.AfterFunc(100*time.Millisecond, func() {
    close(ch)
})
<-ch
fmt.Println("done")
```

What gets printed and when?

**A.** `done` after roughly 100 ms. The main goroutine receives the close signal.

**Q4.** What is wrong with

```go
for i := 0; i < 3; i++ {
    time.AfterFunc(time.Duration(i)*100*time.Millisecond, func() {
        fmt.Println(i)
    })
}
time.Sleep(time.Second)
```

on Go 1.20?

**A.** All three closures capture the same `i`. They all print `3`. Fix by `i := i` inside the loop body. On Go 1.22+ the loop already does that for you.

**Q5.** What is the value of `t.C` after `t := time.AfterFunc(d, f)`?

**A.** Nil.

**Q6.** I want to schedule a function in 10 seconds, but also be able to cancel it. Which API?

**A.** `time.AfterFunc`. Capture the return; call `Stop` to cancel.

**Q7.** I want to read a value from a channel after 10 seconds, possibly racing with another channel. Which API?

**A.** `time.After` (in a select). Or `time.NewTimer` plus `<-t.C` if you need to cancel.

**Q8.** What does this print?

```go
t := time.AfterFunc(100*time.Millisecond, func() {
    fmt.Println("a")
})
time.Sleep(50 * time.Millisecond)
fmt.Println(t.Stop())
time.Sleep(100 * time.Millisecond)
```

**A.** `true` (only). The timer is stopped before it fires.

**Q9.** Same code, but with `Sleep(150 * time.Millisecond)` instead of `50`?

**A.** `a` then `false`. The callback fires; `Stop` returns false.

**Q10.** If a callback runs `panic("x")`, what happens to the rest of the program?

**A.** The program crashes unless the callback recovers.

---

## Cheat Sheet

```go
// Schedule
t := time.AfterFunc(d, f)

// Cancel (returns true if it was still pending)
ok := t.Stop()

// Reset to a new duration
t.Reset(d)

// Read t.C? Never for AfterFunc — it's nil.

// Recover panics inside callbacks
time.AfterFunc(d, func() {
    defer func() { _ = recover() }()
    work()
})

// Wait for the callback to finish
done := make(chan struct{})
time.AfterFunc(d, func() {
    defer close(done)
    work()
})
<-done

// Guard against Stop-vs-fire races
var fired atomic.Bool
t := time.AfterFunc(d, func() {
    if !fired.CompareAndSwap(false, true) { return }
    work()
})
if t.Stop() {
    fired.Store(true) // optional, defensive
}
```

---

## Self-Assessment Checklist

You are ready for the middle level when you can answer "yes" to all of these:

- [ ] I can explain the signature of `time.AfterFunc` from memory.
- [ ] I know `*time.Timer` and its two methods (`Stop`, `Reset`).
- [ ] I know `t.C` is nil for AfterFunc timers and why.
- [ ] I can explain why the callback runs in its own goroutine.
- [ ] I can explain what `Stop` returning `false` means in two flavours (already-stopped vs already-fired).
- [ ] I know how to wait for the callback to finish, with a channel.
- [ ] I can write a debounce, a watchdog, and a deadline using `AfterFunc`.
- [ ] I know that panics inside the callback crash the program and that I should `defer recover()` in production callbacks.
- [ ] I know not to use `<-t.C` for an AfterFunc timer.
- [ ] I can identify the captured-loop-variable bug in a snippet.

---

## Summary

`time.AfterFunc(d, f)` is the Go standard library's most ergonomic "do this thing later" primitive. It schedules a callback to run in a freshly spawned goroutine after at least `d` has passed. It returns a `*time.Timer` that lets you cancel (`Stop`) or reschedule (`Reset`).

The key facts to internalise at this level:

- Callback runs in **its own goroutine**.
- `Stop()` returns `true` iff this call prevented the firing; otherwise `false`. A `false` return does **not** mean the callback has run — it might be in flight.
- `t.C` is nil for `AfterFunc` timers; don't try to receive on it.
- Panics inside the callback crash the program; recover defensively in production.
- Captured variables in the closure are held alive until the callback finishes.

Once these are second nature, the middle level adds `Reset` semantics, `Stop` vs fire races in detail, and the Go 1.21 `context.AfterFunc`. The senior level dives into the runtime timer heap. The professional level covers production patterns: watchdogs, idle timeouts, rate limiters, postmortems.

---

## What You Can Build

With only the junior-level knowledge of `AfterFunc` you can already build:

- A simple TTL cache (one timer per entry).
- A debouncer for keystrokes or events.
- A request timeout wrapper.
- A delayed-retry helper for transient errors.
- A "show toast for N seconds, then hide" UI helper.
- A simple watchdog: panic if no heartbeat in 30 seconds.
- A polite shutdown: log "shutting down in 5s" then call `os.Exit`.

These are not toys — many production services have exactly these patterns at this level of sophistication.

---

## Further Reading

- [`time` package documentation](https://pkg.go.dev/time)
- [`time.AfterFunc` reference](https://pkg.go.dev/time#AfterFunc)
- [`time.Timer` reference](https://pkg.go.dev/time#Timer)
- [Go blog: Concurrency is not Parallelism](https://go.dev/blog/waza-talk)
- Russ Cox's notes on monotonic time

---

## Related Topics

- `07-concurrency/16-time-based-concurrency/01-timers-and-tickers` — Timers and tickers overview
- `07-concurrency/16-time-based-concurrency/03-tickers` — `time.Ticker` for repeating work
- `07-concurrency/16-time-based-concurrency/04-context-with-deadline` — `context.WithDeadline`
- `07-concurrency/01-goroutines/01-overview` — Goroutines
- `07-concurrency/02-channels/01-overview` — Channels and `time.After`

---

## Diagrams and Visual Aids

### Timeline

```
caller goroutine:  --> AfterFunc(d, f) --> ... --> Stop?    ...
                                          \                  \
runtime heap:        [+entry at +d]        \                 [-entry if active]
                                            \
callback goroutine:                          (spawned at fire) f() (exits)
```

### State machine

```
                +-------+    Stop()=true     +---------+
                | Active| -----------------> | Stopped |
                +---+---+                    +----+----+
                    | timer expires               | Reset(d)
                    v                             v
                +-------+    Reset(d)        +---------+
                | Fired | <----------------- |  ...    |
                +---+---+                    +---------+
                    |
                    v
            callback goroutine
```

### Heap entries

```
heap:  [t1@+50ms, t2@+200ms, t3@+1s]
                  ^ runtime pops as their `when` passes,
                    spawning a callback goroutine for each.
```

### Callback ownership

```
runtime timer struct
     |
     +---> closure ----> captured variables
     ^
     |    (kept alive until callback finishes)
```

Coming up in `middle.md`: `Reset` semantics, callback goroutine details, racing `Stop` against fire, `context.AfterFunc` (Go 1.21).

---

## Appendix A: Step-by-Step Walkthroughs

This appendix repeats the most common scenarios in slow motion. If a topic in the main body felt rushed, find it here in detail.

### Walkthrough 1: The lifetime of a single AfterFunc call

Take the simplest possible program:

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    fmt.Println("step 1: about to schedule")
    t := time.AfterFunc(500*time.Millisecond, func() {
        fmt.Println("step 3: callback running on a new goroutine")
    })
    fmt.Println("step 2: AfterFunc returned; t =", t)
    time.Sleep(time.Second)
    fmt.Println("step 4: main slept; about to return")
}
```

What does the runtime actually do, moment by moment?

**Moment 0 (T=0 ns).** `main` is the only user goroutine. It prints `step 1`.

**Moment 1 (T~1 µs).** `main` calls `time.AfterFunc`. Internally, this:

1. Allocates a `runtimeTimer` struct (or reuses one from a pool, in newer Go).
2. Computes the firing time: `now + 500 ms` on the monotonic clock.
3. Sets the timer's `f` field to your closure, and `arg` to `nil`.
4. Inserts the timer into the local P's timer heap.
5. Returns a `*time.Timer` whose `r` field points at the runtime entry and whose `C` field is `nil`.

`time.AfterFunc` is now done. The whole call is a handful of microseconds, all of which is normal user-mode Go code — no system call, no kernel interaction.

**Moment 2 (T~2 µs).** `main` prints `step 2` and the address of `t`.

**Moment 3 (T~3 µs).** `main` calls `time.Sleep(time.Second)`. The runtime parks the main goroutine on a different runtime timer that will wake it in 1 second.

**Moment 4 (T~500 ms).** A worker P (a logical processor in the GMP model) is running some scheduling code. As part of its normal duties it checks its local timer heap. The top entry is our timer, with `when=500ms` — and 500 ms has now elapsed. The P pops it.

Because the timer is an `AfterFunc` timer (the runtime distinguishes by the `f` field being non-nil and `C` being nil), the runtime calls `go f()` — that is, it spawns a new goroutine, which runs the closure.

**Moment 5 (T~500.05 ms).** The new goroutine executes the closure. It prints `step 3` and returns. The goroutine exits.

**Moment 6 (T~1 s).** `main`'s sleep timer fires. `main` resumes, prints `step 4`, and returns. The program exits.

There is no point at which a goroutine was parked waiting for our `AfterFunc` timer. The runtime detected expiry as part of its normal scheduling loop, and spawned a fresh goroutine only at fire time.

### Walkthrough 2: Stop succeeds

```go
t := time.AfterFunc(time.Second, func() {
    fmt.Println("never seen")
})
time.Sleep(100 * time.Millisecond)
ok := t.Stop()
fmt.Println("stop returned:", ok)
time.Sleep(2 * time.Second)
```

Step by step:

1. `AfterFunc` is called. Timer enters heap with `when = T0 + 1 s`.
2. `time.Sleep(100ms)` runs. Heap unchanged.
3. `t.Stop()` is called. The runtime looks at our timer:
   - Status is "waiting" (still in heap, not yet fired).
   - The runtime marks it removed (status becomes "deleted" or directly remove-from-heap depending on Go version) and returns `true`.
4. `fmt.Println` prints `stop returned: true`.
5. `time.Sleep(2 s)` runs. The timer would have fired at `T0 + 1 s` but it is no longer on the heap. Nothing fires. No goroutine is spawned. No "never seen" is printed.

### Walkthrough 3: Stop fails because the timer already fired

```go
t := time.AfterFunc(100*time.Millisecond, func() {
    fmt.Println("fired")
})
time.Sleep(500 * time.Millisecond)
ok := t.Stop()
fmt.Println("stop returned:", ok)
```

1. Timer entered heap with `when = T0 + 100 ms`.
2. `time.Sleep(500 ms)` parks main.
3. At T0 + 100 ms a worker P pops the timer and spawns a goroutine to run the callback. The goroutine prints "fired" and exits.
4. At T0 + 500 ms main wakes up. It calls `t.Stop()`. The runtime looks at the timer: status is "fired" (or "deleted" or just not in the heap anymore). It returns `false`.
5. Main prints `stop returned: false`.

Note: "fired" prints **before** `stop returned: false`. The order:

```
fired
stop returned: false
```

### Walkthrough 4: Stop fails because the callback is *just* about to start

This is the rare but real race we keep mentioning. Imagine:

```go
t := time.AfterFunc(100*time.Millisecond, func() {
    fmt.Println("fired")
})
time.Sleep(100 * time.Millisecond) // exactly the duration
ok := t.Stop()
fmt.Println("stop returned:", ok)
time.Sleep(time.Second)
```

The sleep is exactly the same duration as the timer. What happens depends on scheduler ordering:

- If `Stop` runs first, before the runtime pops the timer: returns `true`, callback never runs.
- If the runtime pops the timer first, spawns the goroutine, and the goroutine has not yet started: returns `false`, callback runs.
- If the callback has already finished by the time `Stop` is called: returns `false`, callback already ran.

You cannot distinguish these from the return value alone. That is the central insight to internalise.

### Walkthrough 5: Reset reschedules

```go
t := time.AfterFunc(time.Second, func() {
    fmt.Println("fired at", time.Now())
})
time.Sleep(500 * time.Millisecond)
t.Reset(time.Second)
time.Sleep(2 * time.Second)
```

1. Timer enters heap with `when = T0 + 1 s`.
2. Main sleeps 500 ms. At T0 + 500 ms it calls `Reset(1s)`.
3. `Reset` looks at the timer:
   - If status is "waiting" (still in heap, not yet fired): it removes the entry and re-inserts with `when = now + 1s = T0 + 1.5s`. Returns `true`.
4. Main sleeps 2 more seconds. At T0 + 1.5 s the timer fires; the callback prints "fired at …".

If you had slept 1.5 s before calling `Reset`, the timer would already have fired, and `Reset` would have rescheduled a *new* firing at `T0 + 2.5s` — the callback runs twice.

### Walkthrough 6: A goroutine count snapshot during fire

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
    wg.Add(1)

    fmt.Println("before:", runtime.NumGoroutine())

    time.AfterFunc(100*time.Millisecond, func() {
        fmt.Println("during:", runtime.NumGoroutine())
        time.Sleep(200 * time.Millisecond)
        wg.Done()
    })

    fmt.Println("scheduled:", runtime.NumGoroutine())
    wg.Wait()
    time.Sleep(50 * time.Millisecond)
    fmt.Println("after:", runtime.NumGoroutine())
}
```

Typical output:

```
before: 1
scheduled: 1
during: 2
after: 1
```

The goroutine count is the same before and after scheduling. It bumps to 2 while the callback is running. It returns to 1 after the callback exits.

The key takeaway: between scheduling and firing, *no goroutine is parked waiting for the timer*. The timer lives in a heap that the runtime checks during its normal scheduling work.

---

## Appendix B: Choosing Between Sleep, After, AfterFunc, Timer, Ticker

A quick decision matrix.

| You want to... | Use |
|---|---|
| Pause this goroutine for `d` | `time.Sleep(d)` |
| Receive on a channel after `d`, in a select | `time.After(d)` (for one-shot, simple cases) |
| Same, but cancellable / resettable | `time.NewTimer(d)` and `<-t.C` |
| Run a callback in a fresh goroutine after `d` | `time.AfterFunc(d, f)` |
| Fire repeatedly every `d` | `time.NewTicker(d)` |
| Fire periodically, no overlap with previous fire | self-rescheduling `AfterFunc` |
| Cancel a tree of work when a context cancels | `context.WithCancel` / `WithTimeout` / `WithDeadline` |
| Run a callback when a context cancels | `context.AfterFunc(ctx, f)` (Go 1.21+) |

### Why is `time.After` "bad" in long-running loops?

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(time.Second):
        doWork()
    }
}
```

Each iteration of the loop calls `time.After`, which creates a new `time.Timer` (heap allocation, runtime timer entry). When the `select` picks the timer branch the entry is removed; when it picks the `ctx.Done` branch, the unused timer entry stays in the heap until it fires. Over many iterations, this is allocation + heap pressure.

In Go 1.23, `time.After` was reworked so that abandoned timers can be GC'd promptly — but reusing a `*time.Timer` is still the more efficient pattern in tight loops.

### Why `AfterFunc` vs spawning a goroutine yourself

```go
go func() {
    time.Sleep(d)
    f()
}()
```

This works but:

- Holds a goroutine parked for `d`.
- Cannot easily be cancelled (you have to set up a separate signal).
- Allocates a goroutine immediately, not at fire time.

`time.AfterFunc(d, f)` is strictly better when `f` is short and you may need to cancel.

---

## Appendix C: Common Code Smells

### Smell 1: AfterFunc inside a hot path with no Stop

```go
func handle(req *Request) {
    time.AfterFunc(time.Hour, func() {
        log.Println("late:", req.ID)
    })
    // ...
}
```

Every request creates a timer that lives an hour. At 1,000 RPS that is 3.6 million live timers. Always know how long your timers live and how many can be alive at once.

### Smell 2: Mutating the captured variable after scheduling

```go
i := 0
time.AfterFunc(time.Second, func() { fmt.Println(i) })
i = 42
```

The callback sees `42`. If you wanted `0`, copy: `i := i; time.AfterFunc(...)`.

### Smell 3: Discarding the return value when you might Stop

```go
time.AfterFunc(d, cleanup)
// ...later...
// no way to cancel cleanup
```

If you might want to cancel, capture the `*Timer`.

### Smell 4: AfterFunc as a substitute for a Ticker

```go
var run func()
run = func() {
    work()
    time.AfterFunc(time.Second, run)
}
run()
```

If you want exact period, use `time.NewTicker`. If you want "1 s after the last finish, drift allowed," self-rescheduling AfterFunc is fine — but document the choice.

### Smell 5: Naked time.Sleep in a callback

```go
time.AfterFunc(d, func() {
    work()
    time.Sleep(30 * time.Second)
    moreWork()
})
```

The callback goroutine is parked for 30 s. If you wanted "later," schedule another `AfterFunc`.

---

## Appendix D: Quick Reference Card

```go
// === Schedule ===
t := time.AfterFunc(d, f)

// === Cancel ===
ok := t.Stop()      // returns true iff this call removed the timer

// === Reset ===
ok := t.Reset(d)    // reschedule; returns prior-state info

// === Wait for fire ===
done := make(chan struct{})
time.AfterFunc(d, func() {
    defer close(done)
    f()
})
<-done

// === Recover panic in callback ===
time.AfterFunc(d, func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("timer panic: %v", r)
        }
    }()
    f()
})

// === Guard against Stop-vs-fire race ===
var fired atomic.Bool
t := time.AfterFunc(d, func() {
    if !fired.CompareAndSwap(false, true) {
        return
    }
    f()
})
if t.Stop() {
    fired.Store(true)
}

// === Idiomatic deadline ===
deadline := time.Now().Add(d)
t := time.AfterFunc(time.Until(deadline), onDeadline)
defer t.Stop()
```

---

## Appendix E: Twelve Tiny Snippets to Type Out

Type each of these into a file, run it, and predict the output before running. This is the fastest way to fix the concepts in muscle memory.

### Snippet 1
```go
package main
import ("fmt"; "time")
func main() {
    time.AfterFunc(0, func(){ fmt.Println("a") })
    time.Sleep(50*time.Millisecond)
}
```

### Snippet 2
```go
package main
import ("fmt"; "time")
func main() {
    t := time.AfterFunc(time.Second, func(){ fmt.Println("a") })
    fmt.Println(t.Stop())
}
```

### Snippet 3
```go
package main
import ("fmt"; "time")
func main() {
    t := time.AfterFunc(time.Millisecond, func(){ fmt.Println("a") })
    time.Sleep(100*time.Millisecond)
    fmt.Println(t.Stop())
}
```

### Snippet 4
```go
package main
import ("fmt"; "time")
func main() {
    ch := make(chan struct{})
    time.AfterFunc(50*time.Millisecond, func(){ close(ch) })
    <-ch
    fmt.Println("seen")
}
```

### Snippet 5
```go
package main
import ("fmt"; "time")
func main() {
    for i := 0; i < 3; i++ {
        i := i
        time.AfterFunc(time.Duration(i+1)*30*time.Millisecond, func(){
            fmt.Println(i)
        })
    }
    time.Sleep(200*time.Millisecond)
}
```

### Snippet 6
```go
package main
import ("fmt"; "time")
func main() {
    t := time.AfterFunc(time.Second, func(){ fmt.Println("first") })
    time.Sleep(100*time.Millisecond)
    t.Reset(50*time.Millisecond)
    time.Sleep(200*time.Millisecond)
}
```

### Snippet 7
```go
package main
import ("fmt"; "time")
func main() {
    var run func()
    run = func() {
        fmt.Println(time.Now())
        time.AfterFunc(200*time.Millisecond, run)
    }
    run()
    time.Sleep(time.Second)
}
```

### Snippet 8
```go
package main
import ("fmt"; "sync/atomic"; "time")
func main() {
    var n atomic.Int64
    for i := 0; i < 10; i++ {
        time.AfterFunc(10*time.Millisecond, func(){ n.Add(1) })
    }
    time.Sleep(100*time.Millisecond)
    fmt.Println(n.Load())
}
```

### Snippet 9
```go
package main
import ("fmt"; "time")
func main() {
    t := time.AfterFunc(time.Hour, func(){})
    fmt.Println(t.C == nil)
}
```

### Snippet 10
```go
package main
import ("fmt"; "time")
func main() {
    defer fmt.Println("main exit")
    time.AfterFunc(100*time.Millisecond, func(){
        fmt.Println("callback")
    })
}
```

### Snippet 11
```go
package main
import ("log"; "time")
func main() {
    time.AfterFunc(50*time.Millisecond, func(){
        defer func(){
            if r := recover(); r != nil {
                log.Println("recovered:", r)
            }
        }()
        panic("boom")
    })
    time.Sleep(200*time.Millisecond)
}
```

### Snippet 12
```go
package main
import ("fmt"; "time")
func main() {
    t := time.AfterFunc(100*time.Millisecond, func(){
        fmt.Println("ran")
    })
    t.Stop()
    t.Reset(50*time.Millisecond)
    time.Sleep(200*time.Millisecond)
}
```

### Expected outputs

1. `a`
2. `true` and the callback never runs.
3. `a` then `false`.
4. `seen`
5. `0`, `1`, `2` in order.
6. `first` after ~150 ms (50 ms after Reset).
7. Five lines of timestamps, ~200 ms apart.
8. `10`
9. `true`
10. `main exit` (the callback never runs — main returns first).
11. `recovered: boom`.
12. `ran` after ~50 ms (Reset on a stopped timer reschedules it).

---

## Appendix F: Tiny FAQ

**Q.** Is `AfterFunc` safe to call concurrently?

**A.** Yes. You can call `AfterFunc` from many goroutines without locking. Each call creates an independent timer.

**Q.** Is calling `Stop` and `Reset` on the same timer from different goroutines safe?

**A.** Yes. The methods are internally synchronised. But you have to be prepared for the boolean return to be unhelpful in some interleavings (covered at middle level).

**Q.** Can the callback call `Stop` on its own timer?

**A.** Yes, and it returns `false` (the timer has already fired). Pointless but harmless.

**Q.** Can the callback call `Reset` on its own timer?

**A.** Yes. This is one way to implement a self-rescheduling timer cleanly.

**Q.** What if the callback creates more `AfterFunc`s?

**A.** Fine. Each becomes an independent runtime timer. Watch the count.

**Q.** Does `AfterFunc` work in `init()`?

**A.** Technically yes, but the runtime is still warming up, and the callback may run before or after `main()` starts. Don't rely on it.

**Q.** Does the callback hold the lock that the caller held?

**A.** No. The callback runs in a new goroutine with no inherited locks. If the callback needs a mutex, it must acquire it itself.

**Q.** Does `recover()` inside the callback recover from a panic that the runtime caused?

**A.** Only panics inside the callback's own goroutine. The runtime's scheduling code does not panic in user-visible ways.

**Q.** Can I pass parameters to the callback?

**A.** Through a closure. There is no `args ...interface{}` overload.

**Q.** Will the runtime garbage-collect a stopped timer?

**A.** Yes. Once `Stop` has been called and you do not retain the `*Timer`, both the runtime entry and the closure become garbage.

---

## Appendix G: A Slow Tour Through 20 Hand-Written Examples

These examples gradually move from one-liners to small applications. Each one introduces a single new idea on top of the previous. Type them in order; if one surprises you, re-read the explanation.

### G.1 — Print one line after one second

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    done := make(chan struct{})
    time.AfterFunc(time.Second, func() {
        fmt.Println("one second later")
        close(done)
    })
    <-done
}
```

We close a channel from the callback so `main` can wait without polling. Notice we do not use `sync.WaitGroup` — closing a channel is the right primitive when the signal happens exactly once.

### G.2 — Same, but cancellable

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    done := make(chan struct{})
    t := time.AfterFunc(time.Second, func() {
        fmt.Println("ran")
        close(done)
    })

    time.Sleep(200 * time.Millisecond)
    if t.Stop() {
        fmt.Println("cancelled")
        close(done) // because the callback will not run
    }
    <-done
}
```

There is a subtle issue here: if `Stop` returns `false` we do not close `done`, which is correct (the callback will). If `Stop` returns `true` we close `done` ourselves. We never close it twice — that would panic. As an exercise, think about what would happen if a second goroutine raced our `Stop` call.

### G.3 — Cancellation via context

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func runWithDeadline(ctx context.Context, d time.Duration) {
    ctx, cancel := context.WithTimeout(ctx, d)
    defer cancel()

    done := make(chan struct{})
    time.AfterFunc(50*time.Millisecond, func() {
        fmt.Println("scheduled work")
        close(done)
    })

    select {
    case <-done:
        fmt.Println("done in time")
    case <-ctx.Done():
        fmt.Println("ctx cancelled")
    }
}

func main() {
    runWithDeadline(context.Background(), 30*time.Millisecond)
    runWithDeadline(context.Background(), 200*time.Millisecond)
}
```

Output:

```
ctx cancelled
scheduled work
done in time
```

The first call cancels before the 50 ms callback fires; the second call lets the callback run.

### G.4 — Wait for the callback with a context

We can improve `G.3` so that we also `Stop` the timer when the context cancels. Otherwise the callback runs after we return — leak.

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func runWithDeadline(ctx context.Context, d time.Duration) {
    ctx, cancel := context.WithTimeout(ctx, d)
    defer cancel()

    done := make(chan struct{})
    t := time.AfterFunc(50*time.Millisecond, func() {
        fmt.Println("scheduled work")
        close(done)
    })
    defer t.Stop()

    select {
    case <-done:
        fmt.Println("done in time")
    case <-ctx.Done():
        fmt.Println("ctx cancelled")
    }
}

func main() {
    runWithDeadline(context.Background(), 30*time.Millisecond)
}
```

Now if the context cancels, the deferred `t.Stop()` removes the timer from the heap, and the callback never runs. Note that if the callback *was already in flight*, `Stop` returns false and the callback continues to run independently. We will revisit at middle level.

### G.5 — Use context.AfterFunc (Go 1.21+)

The previous example reads cleanly with `context.AfterFunc`:

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func runWithDeadline(ctx context.Context, d time.Duration) {
    ctx, cancel := context.WithTimeout(ctx, d)
    defer cancel()

    cleanup := context.AfterFunc(ctx, func() {
        fmt.Println("context fired; running cleanup")
    })
    defer cleanup()

    // do work
    time.Sleep(10 * time.Millisecond)
    fmt.Println("work done")
}

func main() {
    runWithDeadline(context.Background(), 100*time.Millisecond)
}
```

`context.AfterFunc(ctx, f)` schedules `f` to run when `ctx` cancels (and runs it on its own goroutine, just like `time.AfterFunc`). The returned function lets us "unsubscribe" cleanly — calling `cleanup()` removes the registration if the context has not cancelled yet. This is the modern, well-behaved idiom.

### G.6 — A toy debouncer

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Debouncer struct {
    mu    sync.Mutex
    timer *time.Timer
    delay time.Duration
    fn    func()
}

func NewDebouncer(d time.Duration, fn func()) *Debouncer {
    return &Debouncer{delay: d, fn: fn}
}

func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.timer != nil {
        db.timer.Stop()
    }
    db.timer = time.AfterFunc(db.delay, db.fn)
}

func main() {
    db := NewDebouncer(100*time.Millisecond, func() {
        fmt.Println("fire")
    })

    for i := 0; i < 5; i++ {
        db.Trigger()
        time.Sleep(50 * time.Millisecond)
    }
    time.Sleep(200 * time.Millisecond)
}
```

We trigger every 50 ms with a 100 ms debounce. Result: only one "fire" prints, ~200 ms after the last trigger.

This is *almost* right — there is a subtle race when `Stop` returns false and the callback is in flight while we are setting a new timer. That race is fixed at middle level. The version here is good enough for the simple uses.

### G.7 — A toy rate limiter (token-bucket trigger)

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Limiter struct {
    mu       sync.Mutex
    capacity int
    tokens   int
    refill   time.Duration
}

func NewLimiter(cap int, refill time.Duration) *Limiter {
    l := &Limiter{capacity: cap, tokens: cap, refill: refill}
    var tick func()
    tick = func() {
        l.mu.Lock()
        if l.tokens < l.capacity {
            l.tokens++
        }
        l.mu.Unlock()
        time.AfterFunc(refill, tick)
    }
    time.AfterFunc(refill, tick)
    return l
}

func (l *Limiter) Allow() bool {
    l.mu.Lock()
    defer l.mu.Unlock()
    if l.tokens == 0 {
        return false
    }
    l.tokens--
    return true
}

func main() {
    l := NewLimiter(3, 100*time.Millisecond)
    for i := 0; i < 10; i++ {
        fmt.Println(i, l.Allow())
        time.Sleep(30 * time.Millisecond)
    }
}
```

Here the refill is implemented with a self-rescheduling `AfterFunc`. A real rate limiter would use a `Ticker` or computed-on-demand tokens — but this shows a working pattern.

### G.8 — A toy TTL cache

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Cache struct {
    mu      sync.Mutex
    entries map[string]string
    timers  map[string]*time.Timer
    ttl     time.Duration
}

func NewCache(ttl time.Duration) *Cache {
    return &Cache{
        entries: map[string]string{},
        timers:  map[string]*time.Timer{},
        ttl:     ttl,
    }
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if t, ok := c.timers[k]; ok {
        t.Stop()
    }
    c.entries[k] = v
    c.timers[k] = time.AfterFunc(c.ttl, func() {
        c.mu.Lock()
        defer c.mu.Unlock()
        delete(c.entries, k)
        delete(c.timers, k)
    })
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    v, ok := c.entries[k]
    return v, ok
}

func main() {
    c := NewCache(100 * time.Millisecond)
    c.Set("foo", "bar")
    fmt.Println(c.Get("foo")) // bar, true
    time.Sleep(200 * time.Millisecond)
    fmt.Println(c.Get("foo")) // "", false
}
```

One timer per entry. Fine for tens of thousands of entries. For millions, batch with a single periodic sweeper.

### G.9 — Refusing to run a callback after the work is done

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

func main() {
    var done atomic.Bool

    t := time.AfterFunc(200*time.Millisecond, func() {
        if done.Load() {
            fmt.Println("too late; skipping")
            return
        }
        fmt.Println("timeout")
    })

    // do work
    time.Sleep(100 * time.Millisecond)
    done.Store(true)
    t.Stop()
    fmt.Println("work finished")
    time.Sleep(300 * time.Millisecond)
}
```

If the callback fires between `done.Store(true)` and `t.Stop()` (a real race window), the guard inside the callback prevents the timeout action.

### G.10 — Re-arming on every input

A "keep-alive" watchdog: every input pushes the deadline.

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Watchdog struct {
    mu      sync.Mutex
    timer   *time.Timer
    timeout time.Duration
    onFire  func()
}

func NewWatchdog(timeout time.Duration, onFire func()) *Watchdog {
    w := &Watchdog{timeout: timeout, onFire: onFire}
    w.timer = time.AfterFunc(timeout, onFire)
    return w
}

func (w *Watchdog) Touch() {
    w.mu.Lock()
    defer w.mu.Unlock()
    w.timer.Reset(w.timeout)
}

func (w *Watchdog) Stop() {
    w.mu.Lock()
    defer w.mu.Unlock()
    w.timer.Stop()
}

func main() {
    w := NewWatchdog(200*time.Millisecond, func() {
        fmt.Println("WATCHDOG FIRED")
    })

    for i := 0; i < 5; i++ {
        fmt.Println("heartbeat", i)
        w.Touch()
        time.Sleep(100 * time.Millisecond)
    }

    fmt.Println("no more heartbeats; waiting")
    time.Sleep(400 * time.Millisecond)
    w.Stop()
}
```

Output:

```
heartbeat 0
heartbeat 1
heartbeat 2
heartbeat 3
heartbeat 4
no more heartbeats; waiting
WATCHDOG FIRED
```

This is the classic dead-man's-switch pattern. We will harden it at middle and senior levels.

### G.11 — Avoiding closure capture of a request

```go
type Request struct {
    ID   string
    Body [1 << 20]byte // 1 MiB
}

func bad(r *Request) {
    // Captures r; entire 1 MiB pinned until callback fires.
    time.AfterFunc(time.Hour, func() {
        log.Println("late:", r.ID)
    })
}

func good(r *Request) {
    id := r.ID // copy small field out
    time.AfterFunc(time.Hour, func() {
        log.Println("late:", id)
    })
}
```

In `good` only the small `id` string is captured. The 1 MiB body can be GC'd as soon as the rest of the request handler finishes.

### G.12 — Capturing only an index

```go
type Pool struct {
    items []Item
}

func (p *Pool) ScheduleExpire(idx int, d time.Duration) {
    time.AfterFunc(d, func() {
        p.expire(idx)
    })
}
```

We capture `p` (small) and `idx` (an int). We do **not** capture `p.items[idx]` directly. The pool can grow / shrink and the callback works against the live state.

### G.13 — Order is not guaranteed

```go
for i := 0; i < 5; i++ {
    i := i
    time.AfterFunc(10*time.Millisecond, func() {
        fmt.Println(i)
    })
}
time.Sleep(time.Second)
```

You might think this prints `0 1 2 3 4`. In practice, all five fire near simultaneously and the printing order depends on goroutine scheduling. You may see `2 0 4 1 3` or any permutation.

If order matters, write code that enforces order — for example, have each callback wait on a channel that the previous one closes. Or just use a single goroutine that iterates.

### G.14 — A small "future" type

```go
package main

import (
    "fmt"
    "time"
)

type Future struct {
    done chan struct{}
    val  string
    err  error
}

func Schedule(d time.Duration, f func() (string, error)) *Future {
    fut := &Future{done: make(chan struct{})}
    time.AfterFunc(d, func() {
        v, e := f()
        fut.val, fut.err = v, e
        close(fut.done)
    })
    return fut
}

func (f *Future) Get() (string, error) {
    <-f.done
    return f.val, f.err
}

func main() {
    fut := Schedule(100*time.Millisecond, func() (string, error) {
        return "hello", nil
    })
    fmt.Println(fut.Get())
}
```

A minimal "promise / future" built on `AfterFunc`. Production versions add cancellation, timeouts, and error handling.

### G.15 — Many timers, one channel

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    out := make(chan int, 10)
    for i := 0; i < 5; i++ {
        i := i
        time.AfterFunc(time.Duration(i+1)*20*time.Millisecond, func() {
            out <- i
        })
    }
    for i := 0; i < 5; i++ {
        fmt.Println(<-out)
    }
}
```

Five callbacks fan in to one channel. We can read them in fire order (the duration is strictly increasing) but in general would have to sort.

### G.16 — A small server with shutdown timeout

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Server struct {
    wg   sync.WaitGroup
    quit chan struct{}
}

func (s *Server) Start() {
    s.quit = make(chan struct{})
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        for {
            select {
            case <-s.quit:
                return
            case <-time.After(50 * time.Millisecond):
                // do work
            }
        }
    }()
}

func (s *Server) Stop(timeout time.Duration) bool {
    close(s.quit)
    done := make(chan struct{})
    go func() {
        s.wg.Wait()
        close(done)
    }()
    t := time.AfterFunc(timeout, func() {
        fmt.Println("hard timeout; killing")
    })
    defer t.Stop()

    select {
    case <-done:
        return true
    case <-time.After(timeout):
        return false
    }
}

func main() {
    s := &Server{}
    s.Start()
    time.Sleep(150 * time.Millisecond)
    fmt.Println("clean shutdown:", s.Stop(200*time.Millisecond))
}
```

We use `AfterFunc` for a "log only" side-effect on hard timeout, and `time.After` for the actual decision channel. A real shutdown would force-close connections.

### G.17 — Sequencing with channels of channels

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    prev := make(chan struct{})
    close(prev)
    for i := 0; i < 5; i++ {
        next := make(chan struct{})
        i := i
        prev := prev
        time.AfterFunc(time.Duration(i+1)*30*time.Millisecond, func() {
            <-prev
            fmt.Println(i)
            close(next)
        })
        prev = next
    }
    <-prev
}
```

Each callback waits for the previous one to finish, ensuring strict ordering. This is uncommon — usually you would use a single sequential goroutine — but it illustrates the model.

### G.18 — Stopping all timers at once

```go
package main

import (
    "fmt"
    "time"
)

type Group struct {
    timers []*time.Timer
}

func (g *Group) After(d time.Duration, f func()) {
    g.timers = append(g.timers, time.AfterFunc(d, f))
}

func (g *Group) StopAll() {
    for _, t := range g.timers {
        t.Stop()
    }
    g.timers = g.timers[:0]
}

func main() {
    g := &Group{}
    g.After(100*time.Millisecond, func() { fmt.Println("a") })
    g.After(200*time.Millisecond, func() { fmt.Println("b") })
    g.After(300*time.Millisecond, func() { fmt.Println("c") })

    time.Sleep(150 * time.Millisecond)
    g.StopAll() // stops b and c; a already fired
    time.Sleep(500 * time.Millisecond)
}
```

Output is just `a`. The group is a simple but useful pattern for "cancel all background work when this thing ends."

### G.19 — A timer that races against a result

```go
package main

import (
    "errors"
    "fmt"
    "time"
)

func tryWithTimeout(timeout time.Duration, op func() string) (string, error) {
    type result struct {
        v   string
        err error
    }
    out := make(chan result, 1)

    t := time.AfterFunc(timeout, func() {
        out <- result{err: errors.New("timeout")}
    })
    defer t.Stop()

    go func() {
        out <- result{v: op()}
    }()

    r := <-out
    return r.v, r.err
}

func main() {
    v, err := tryWithTimeout(50*time.Millisecond, func() string {
        time.Sleep(20 * time.Millisecond)
        return "fast"
    })
    fmt.Println(v, err)

    v, err = tryWithTimeout(20*time.Millisecond, func() string {
        time.Sleep(50 * time.Millisecond)
        return "slow"
    })
    fmt.Println(v, err)
}
```

The buffered channel of capacity 1 means the loser of the race does not block forever. (If both wrote and the channel had capacity 0, one of them would deadlock.)

### G.20 — Don't use a Sleep in the callback to defer further work

```go
// BAD
time.AfterFunc(d1, func() {
    time.Sleep(d2)
    work()
})

// GOOD
time.AfterFunc(d1+d2, work)

// or, if work depends on something
time.AfterFunc(d1, func() {
    if cond() {
        time.AfterFunc(d2, work)
    }
})
```

A `Sleep` inside a callback parks the callback goroutine. For "fire later, conditionally", schedule another `AfterFunc`.

---

## Appendix H: Comparison Table — AfterFunc vs Alternatives

| Property | `time.Sleep` | `time.After` | `time.NewTimer` | `time.AfterFunc` | `time.NewTicker` | `context.AfterFunc` |
|---|---|---|---|---|---|---|
| Blocks the caller? | Yes | No (returns chan) | No | No | No | No |
| Returns a channel? | No | Yes | Yes (`t.C`) | No (`t.C` is nil) | Yes (`t.C`) | No |
| Cancellable? | No | Hard | Yes (`Stop`) | Yes (`Stop`) | Yes (`Stop`) | Yes (returned func) |
| Resettable? | No | No | Yes (`Reset`) | Yes (`Reset`) | Yes (`Reset`) | No |
| One-shot / repeating | One-shot | One-shot | One-shot | One-shot | Repeating | One-shot (on cancel) |
| Allocates a goroutine? | The caller is the goroutine | No | No | At fire time only | No (caller reads channel) | At cancel time only |
| Runs callback in own goroutine? | n/a | n/a | n/a | Yes | n/a | Yes |
| Idiomatic for "do later" | Trivial cases | One-shot in select | Cancellable wait | Yes | Periodic | Context-driven |

---

## Appendix I: Recognising AfterFunc in production

When reading other people's code, watch for these patterns:

- `defer t.Stop()` after `t := time.AfterFunc(...)` — usually a deadline or watchdog.
- `time.AfterFunc(0, f)` — "run f on a goroutine soon" — sometimes used to break out of locks; usually `go f()` is cleaner.
- `t := time.AfterFunc(d, func() { /* set flag */ })` followed by `t.Stop()` in a deferred section — guarded one-shot.
- `time.AfterFunc(d, c.someMethod)` — using a method value as the callback; the receiver is captured.
- Self-rescheduling AfterFunc inside the callback — a slow ticker; check if a `Ticker` would be better.

When writing code, you should be able to recognise which pattern you are reaching for and document it.

---

## Appendix J: How AfterFunc Interacts With Tests

In tests, `time.AfterFunc` can produce flaky behaviour if you depend on exact timing. Two rules:

1. **Don't assert on wall-clock duration.** Assert that an event happened, not that it happened within X milliseconds (unless you really mean "no more than X ms").
2. **Be patient with goroutines.** A common bug is asserting a side-effect immediately after `Stop`; the callback may have started before `Stop`.

A test-friendly idiom:

```go
func TestExpire(t *testing.T) {
    done := make(chan struct{})
    time.AfterFunc(10*time.Millisecond, func() {
        close(done)
    })
    select {
    case <-done:
    case <-time.After(time.Second): // generous timeout
        t.Fatal("did not fire")
    }
}
```

For unit-testing logic that uses `AfterFunc`, consider injecting a clock interface so you can advance time synchronously. Libraries like `github.com/benbjohnson/clock` or `github.com/jonboulle/clockwork` are common choices. We will discuss test doubles for time at middle and professional levels.

---

End of junior-level material. See `middle.md` for `Reset` deep dive, `Stop`-vs-fire races, and `context.AfterFunc`.


