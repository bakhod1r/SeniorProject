---
layout: default
title: time Package Concurrency — Junior
parent: time Package Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/05-time-package-concurrency/junior/
---

# time Package Concurrency — Junior Level

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [What `time.Sleep` Actually Does](#what-timesleep-actually-does)
6. [Goroutines and Delayed Work](#goroutines-and-delayed-work)
7. [`time.After` — The Convenience Function](#timeafter--the-convenience-function)
8. [`time.NewTimer` — The Explicit Form](#timenewtimer--the-explicit-form)
9. [`time.AfterFunc` — Callback Timers](#timeafterfunc--callback-timers)
10. [`time.Tick` and `time.NewTicker`](#timetick-and-timenewticker)
11. [The Tick Leak Gotcha](#the-tick-leak-gotcha)
12. [Stopping Timers and Tickers](#stopping-timers-and-tickers)
13. [Mental Models](#mental-models)
14. [Common Patterns](#common-patterns)
15. [Code Examples](#code-examples)
16. [Coding Patterns](#coding-patterns)
17. [Clean Code](#clean-code)
18. [Error Handling](#error-handling)
19. [Security Considerations](#security-considerations)
20. [Performance Tips](#performance-tips)
21. [Best Practices](#best-practices)
22. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
23. [Common Mistakes](#common-mistakes)
24. [Common Misconceptions](#common-misconceptions)
25. [Tricky Points](#tricky-points)
26. [Test](#test)
27. [Tricky Questions](#tricky-questions)
28. [Cheat Sheet](#cheat-sheet)
29. [Self-Assessment Checklist](#self-assessment-checklist)
30. [Summary](#summary)
31. [What You Can Build](#what-you-can-build)
32. [Further Reading](#further-reading)
33. [Related Topics](#related-topics)

---

## Introduction
> Focus: "What does `time.Sleep` actually do? When do I use `time.After` vs `time.NewTimer`? Why does `time.Tick` leak?"

The `time` package looks innocent. You write `time.Sleep(time.Second)` and a second goes by; you write `<-time.After(time.Second)` and your select waits a second; you write `time.NewTicker(time.Second)` and you get a steady drumbeat. Each of these is built on top of a small but rich runtime machinery — a per-CPU timer heap, a state machine, channel sends from the runtime — but as a junior Go programmer you do not yet need to know all of that. What you do need to know is:

1. `time.Sleep` does **not** block an OS thread. It parks the goroutine. Other goroutines keep running.
2. `time.After` returns a channel. The runtime sends on it after a duration. Convenient — but it has a famous leak.
3. `time.NewTicker` is the right way to do periodic work; it requires `Stop()`.
4. `time.Tick` is the same as `NewTicker(d).C` but you cannot stop it — **never use it in a function that returns**.
5. Every concurrent timer in Go ultimately involves a goroutine waiting on a channel that the runtime sends to.

This file gives you the vocabulary and the patterns you need to use the time package in concurrent code without leaking memory, dropping ticks, or blocking the wrong way.

We are not yet going to look at the runtime source. That is the middle file. We will explain what each function does behaviourally, show the right idioms, and call out the well-known gotchas.

By the end you should be able to:
- Use `time.Sleep`, `time.After`, `time.NewTimer`, `time.AfterFunc`, `time.NewTicker` correctly.
- Avoid the `time.Tick` leak.
- Stop a ticker cleanly.
- Compose a timeout into a `select`.
- Recognise the common mistakes (forgotten `Stop`, `time.After` in a hot loop, drift).

---

## Prerequisites

- **Required:** Comfort with Go syntax, `go func()` goroutines, channels (`chan T`), `select`.
- **Required:** You have used `time.Sleep` and `time.Now()` somewhere.
- **Required:** Some idea of what "concurrent" means in Go (goroutines run independently; the runtime schedules them on OS threads).
- **Helpful:** Awareness of `context.Context` and `<-ctx.Done()` — we will use them in idioms here.
- **Helpful:** Having seen a `runtime.NumGoroutine()` debug line in real code.

You do *not* need to know:
- How the per-P timer heap is structured (middle file).
- What the Go 1.23 timer redesign changed (senior file).
- What `futex` is or how `time.Sleep` ultimately suspends the OS thread (senior file).

If you can write a goroutine that prints a message every second and stops cleanly when a context is cancelled, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Goroutine** | A lightweight thread managed by the Go runtime. Created with `go f()`. Cheap (8 KB initial stack); millions can coexist. |
| **Channel** | A typed conduit for communication between goroutines. Created with `make(chan T)`. |
| **Park** | A runtime operation that takes a goroutine off the run queue without releasing the OS thread. The thread runs other goroutines while parked goroutines wait. |
| **Wake** | A runtime operation that puts a parked goroutine back on a run queue. |
| **Timer heap** | A min-heap of pending timers, ordered by fire time. Maintained by the runtime per CPU/processor (per-P). |
| **`time.Sleep(d)`** | Parks the calling goroutine for at least `d`. Other goroutines keep running. |
| **`time.After(d)`** | Returns `<-chan time.Time` that will receive a value after `d`. Convenience wrapper around `time.NewTimer(d).C`. |
| **`time.NewTimer(d)`** | Returns `*time.Timer` with field `C` (a `<-chan time.Time`) and methods `Stop`/`Reset`. |
| **`time.AfterFunc(d, f)`** | After `d`, calls `f()` in a new goroutine. Returns a `*Timer` you can `Stop` to cancel. |
| **`time.NewTicker(d)`** | Returns `*time.Ticker` that delivers a tick on `C` every `d`. Must be `Stop`ped to release. |
| **`time.Tick(d)`** | Returns `time.NewTicker(d).C`. No way to stop. **Use only when the ticker should outlive everything**. |
| **`time.Sleep` precision** | At least `d`, but actual sleep can be longer due to OS scheduler / Go scheduler. |
| **`(*Timer).Stop()`** | Tries to prevent the timer from firing. Returns `bool`: `true` if it stopped a pending timer, `false` if it had already fired or been stopped. |
| **`(*Timer).Reset(d)`** | Restarts the timer with a new duration. Returns the same `bool` as `Stop`. |
| **Wall clock** | The clock the user sees; subject to NTP adjustment and manual setting. |
| **Monotonic clock** | A clock guaranteed never to go backward; meaningful only within a process lifetime. |
| **Leaked goroutine** | A goroutine that is no longer needed but keeps running, holding memory and (potentially) timer-heap entries. |
| **`context.WithTimeout(parent, d)`** | A context that automatically cancels after `d`. Implemented (since Go 1.21) on top of `time.AfterFunc`. |
| **Tick drift** | The accumulating error between intended and actual tick times when using `time.Sleep` for periodic work. `Ticker` avoids drift. |

---

## Core Concepts

### A timer is a runtime-managed callback

When you call `time.Sleep(d)`, you are not asking the OS to wake your thread in `d` seconds. You are asking the **Go runtime** to remember that, in `d` seconds, it should "wake" a particular goroutine (yours). The goroutine itself is suspended; its OS thread is free to run other goroutines.

Under the hood, the runtime maintains a heap of pending timers per CPU (technically per-P, where P is the runtime's "processor" abstraction). Periodically — at every scheduler tick, and on demand — the runtime checks: is the earliest timer due? If yes, fire it (which usually means: call `goready` on the parked goroutine so it can be scheduled again).

This means:
- `time.Sleep` is cheap. The OS thread is not blocked.
- You can have millions of goroutines all in `time.Sleep` simultaneously.
- The cost of a timer is roughly the cost of inserting into a min-heap: O(log N) where N is the number of pending timers on the current P.

### Channels are the user-facing API for timers

You almost never call the timer-heap directly. Instead, you receive from a channel:

```go
<-time.After(time.Second)
```

`time.After(d)` returns a `<-chan time.Time`. The runtime, after `d` elapses, sends the current time on that channel. The receive completes and your code continues.

The same pattern shows up everywhere:
- `time.NewTimer(d).C` — a channel that receives once.
- `time.NewTicker(d).C` — a channel that receives every `d`.
- `<-ctx.Done()` — a channel that closes when the context is cancelled (which can be a timeout).

Channel-based timers compose cleanly with `select`. This is the key reason Go's timer API is shaped this way.

### Callback timers via `time.AfterFunc`

For one-shot delayed work without composition, `time.AfterFunc` is the right tool:

```go
t := time.AfterFunc(time.Second, func() {
    log.Println("one second later")
})
defer t.Stop() // cancels if not yet fired
```

`AfterFunc` does not allocate a channel. The runtime, when the timer fires, spawns a fresh goroutine and calls the function in it. This is slightly cheaper than `time.After` + receive in a goroutine.

The two-stroke rhythm — *channel timers* for select composition, *callback timers* for fire-and-forget — covers nearly every use case.

### Periodic work needs a Ticker, not a Sleep loop

A naive periodic loop:

```go
for {
    do()
    time.Sleep(time.Second)
}
```

This *drifts*. If `do()` takes 200 ms, the period is 1.2 s, not 1.0 s. Over a day, the loop falls behind by ~17 % — about 3 hours less work than expected.

A `Ticker` fires on a steady cadence regardless of consumer speed:

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for range t.C {
    do()
}
```

If `do()` takes too long, ticks are silently coalesced (the channel is 1-buffered; sends that would block are dropped). The cadence stays correct.

### The Tick leak

```go
for range time.Tick(time.Second) {
    do()
}
```

`time.Tick` returns the ticker's channel but gives you no way to call `Stop`. If the goroutine running this loop ever wants to terminate, you cannot release the ticker. Pre-Go 1.23, this also pinned the channel and prevented GC of related memory. Go 1.23 made the channel GC-able, but the ticker still doesn't *stop* — the runtime keeps trying to deliver ticks to a channel nobody reads from.

**Rule:** never use `time.Tick` in any function that may return. The package docs make this explicit. Use `time.NewTicker` + `defer Stop` instead.

---

## What `time.Sleep` Actually Does

Let us trace what happens when you write `time.Sleep(time.Second)`.

### Step 1: User code

```go
time.Sleep(time.Second)
```

This calls `time.Sleep`, defined in `time/sleep.go`:

```go
// Sleep pauses the current goroutine for at least the duration d.
// A negative or zero duration causes Sleep to return immediately.
func Sleep(d Duration)
```

The function body is just `//go:linkname` — it is implemented in the runtime.

### Step 2: Runtime

The runtime implementation (`runtime/time.go`, `timeSleep`):

1. If `d <= 0`, return immediately.
2. Get the current goroutine (`gp`).
3. Park the goroutine via `gopark`, supplying a wake-up time of `now + d` and a callback (`goroutineReady`) that fires when the timer expires.
4. The scheduler takes the goroutine off the run queue.
5. The M (OS thread) running this goroutine continues to other work.

### Step 3: Timer heap

`gopark` registers a timer entry on the current P's heap. The entry holds:
- `when`: the absolute time at which to fire (in monotonic nanoseconds).
- `f`: the callback (`goroutineReady`).
- `arg`: the goroutine to wake.

### Step 4: The wait

The OS thread that was running our goroutine returns to the scheduler. It picks up another goroutine and runs it. Or, if no goroutines are runnable, it parks the M itself (via futex sleep on Linux, semaphore wait on Darwin, etc.) with a timeout set to the next-due timer on this P.

### Step 5: Timer fires

When `time.Now() >= when`, the runtime's scheduler (via `checkTimers` in `findRunnable`) notices and calls `f(arg)`. For Sleep, this is `goroutineReady` with our `gp` as argument, which puts the goroutine back on a run queue.

### Step 6: Resumption

Eventually a P picks up our goroutine from its run queue. The goroutine resumes from where it was parked. `time.Sleep` returns. User code continues.

### What this means in practice

- `time.Sleep` does not block the OS thread.
- Goroutines parked in `time.Sleep` are cheap.
- "At least `d`" is a real constraint — actual sleep can be longer due to: scheduler latency, GC pause, OS timer granularity. Expect tens of microseconds of jitter even on Linux.
- Sleep granularity is bounded by the OS clock resolution: Linux ~µs, Windows ~15 ms by default.

### Visualisation

```
Goroutine A:                  Runtime:                    Other goroutines:
time.Sleep(1s)
    │
    │ gopark
    ├─────────────►  Park gp, schedule timer (when = now+1s)
    │                     │
    │              [M now free; runs other Gs]
    │                                                     [run]
    │                                                     [run]
    │                                                     [run]
    │              ... 1 second later ...
    │              checkTimers: timer due
    │              goready(gp)
    │ ◄─────────── gp on run queue
    │ ... eventually scheduled ...
    │
    │ resume
    ▼
```

---

## Goroutines and Delayed Work

The simplest pattern for delayed work:

```go
go func() {
    time.Sleep(5 * time.Second)
    log.Println("five seconds later")
}()
```

The goroutine sleeps for 5 s, then logs and exits. Cheap (one goroutine, one timer-heap entry).

### Cancellable variant

```go
go func() {
    select {
    case <-time.After(5 * time.Second):
        log.Println("five seconds later")
    case <-ctx.Done():
        return
    }
}()
```

Now the work is cancellable via `ctx`. But: if `ctx.Done()` wins, the Timer behind `time.After` is **not stopped** — it stays in the heap for 5 s. Pre-1.23 it also pinned the channel.

### Better: AfterFunc + context.AfterFunc (Go 1.21+)

```go
t := time.AfterFunc(5*time.Second, func() {
    log.Println("five seconds later")
})
context.AfterFunc(ctx, func() { t.Stop() })
```

Now cancellation cleanly stops the timer. No leak.

### The two-line pattern

For one-off delayed work without context, `AfterFunc` is the simplest:

```go
time.AfterFunc(5*time.Second, doWork)
```

Returns a `*Timer` you can keep or discard. If you discard the Timer, the runtime still keeps it alive until firing (pre-1.23 even pinned it; 1.23+ it is GC-able if nothing references it).

---

## `time.After` — The Convenience Function

```go
func After(d Duration) <-chan Time {
    return NewTimer(d).C
}
```

That is literally the implementation (`time/sleep.go:155`). It is just sugar over `NewTimer`.

### Use case: timeout in a select

```go
select {
case v := <-ch:
    use(v)
case <-time.After(time.Second):
    log.Println("timeout")
}
```

Reads `v` if `ch` produces within a second; logs "timeout" otherwise.

### Why it has a leak

The Timer behind `time.After` is created on every call. If the `select` does not receive from it, the Timer sits in the timer heap until `d` expires. In a tight loop:

```go
for {
    select {
    case v := <-ch:
        use(v)
    case <-time.After(time.Second):
        log.Println("idle")
    }
}
```

Each iteration creates a fresh Timer. If `ch` is busy and iterations take less than a second, you accumulate thousands of pending Timers. The runtime processes them all when their deadlines come due, even though no goroutine is receiving.

### Pre-1.23 worse: pinned the channel

Pre-Go-1.23, the Timer's `*hchan` (the channel) was kept alive by the runtime's timer-heap reference. The channel could not be GC'd while the Timer was pending. This made the leak worse — not just one Timer struct (~80 bytes) but the channel and its buffer too.

### Fix: don't use it in hot loops

Hoist a single `*Timer` and Reset it. See the "Common Patterns" section.

### When `time.After` *is* fine

- One-shot calls outside loops:
  ```go
  select {
  case v := <-result:
      return v
  case <-time.After(deadline):
      return ErrTimeout
  }
  ```
- Tests where you do not care about resource usage.
- Code where the loop iteration period is *longer* than the After duration (so the Timer always fires in time).

---

## `time.NewTimer` — The Explicit Form

```go
t := time.NewTimer(time.Second)
<-t.C
log.Println("one second later")
```

`NewTimer` returns `*time.Timer`. The Timer has:
- `C`: a `<-chan time.Time` of buffer size 1. The runtime sends the fire time on it.
- `Stop()`: tries to prevent firing.
- `Reset(d)`: restarts with new duration.

### Why use `NewTimer` over `After`?

You can call `Stop()`:

```go
t := time.NewTimer(time.Hour)
select {
case <-t.C:
    log.Println("hour passed")
case <-ctx.Done():
    t.Stop()
    return
}
```

Now the cancellation path stops the timer, releasing the heap entry.

### Why use `NewTimer` for reuse?

In a hot loop, hoist a Timer and Reset it instead of allocating a new one each iteration:

```go
t := time.NewTimer(d)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(d)
    select {
    case v := <-ch: use(v)
    case <-t.C: log.Println("timeout")
    case <-ctx.Done(): return
    }
}
```

(Pre-Go 1.23. Go 1.23+ allows the simpler `t.Reset(d)` without the Stop+drain dance.)

### The Stop+drain dance

The reason for the dance: pre-1.23, after `Stop()` returns `false`, the channel may already contain a value (the timer fired before Stop could prevent it). If you skip the drain, the next `<-t.C` will receive that stale value immediately.

```go
if !t.Stop() {
    // Timer already fired or was stopped.
    // Drain the channel if there's a leftover value.
    select { case <-t.C: default: }
}
t.Reset(d) // safe now
```

Go 1.23 made this unnecessary. `t.Reset(d)` now atomically clears any pending value.

---

## `time.AfterFunc` — Callback Timers

```go
t := time.AfterFunc(time.Second, func() {
    log.Println("one second later")
})
```

`AfterFunc` schedules a function to run after `d`. Differences from `After`/`NewTimer`:
- No channel.
- The callback runs in a **fresh goroutine**, not on the runtime's timer thread.
- Returns a `*Timer` you can `Stop` or `Reset`.

### When to use AfterFunc

Use AfterFunc when:
- You do not need to compose the timer into a `select`.
- You want fire-and-forget delayed work.
- You want to be able to cancel before fire.

```go
// Schedule cleanup in 5 minutes, cancel on early shutdown.
t := time.AfterFunc(5*time.Minute, cleanup)
defer t.Stop()
```

### Goroutine spawn

Each fired `AfterFunc` callback runs in its own newly-created goroutine. If your callback is heavy, this can mean many goroutines firing simultaneously. If your callback shares state, it needs synchronization just like any other goroutine.

```go
var counter int
var mu sync.Mutex
time.AfterFunc(time.Second, func() {
    mu.Lock()
    counter++
    mu.Unlock()
})
```

Forgetting the mutex here is the kind of mistake the race detector catches.

---

## `time.Tick` and `time.NewTicker`

For periodic work:

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for range t.C {
    do()
}
```

The ticker sends the current time on `t.C` every second.

### Buffer size 1, lossy delivery

`t.C` has buffer size 1. If the consumer is slow, sends that would block are dropped. The runtime never lets the timer goroutine block — better to lose a tick than back up.

This means: under load, you may receive fewer ticks than the wall-clock interval suggests. For periodic *work*, this is usually fine. For "I need exactly N ticks in T seconds" counting, it is wrong.

### `Reset`

```go
t.Reset(2 * time.Second) // future ticks every 2s
```

Pre-1.20: not available; you had to Stop and create a new ticker. Go 1.15 added `Reset` to `*Timer`; Go 1.20 added it to `*Ticker`. Use it freely on modern Go.

### `Stop`

```go
t.Stop()
```

Releases the ticker's heap entry. Does **not** drain `t.C` — a stale tick may still be in the channel. If you `<-t.C` after `Stop`, you may receive once before blocking forever.

### `time.Tick(d)` — the convenience that leaks

```go
for now := range time.Tick(time.Second) {
    log.Println(now)
}
```

Equivalent to `time.NewTicker(time.Second).C` with no reference kept. You cannot Stop it. **Never use in a function that may return.** The docs are explicit:

> While Tick is useful for clients that have no need to shut down the Ticker, be aware that without a way to shut it down the underlying Ticker cannot be recovered by the garbage collector; it "leaks".

In Go 1.23, the underlying timer is GC-able if no goroutine references the channel. But you almost certainly *do* reference the channel (the `for range`), so the ticker still effectively leaks.

---

## The Tick Leak Gotcha

Real production bug example:

```go
func collect(ctx context.Context) []int {
    var results []int
    for {
        select {
        case <-ctx.Done():
            return results
        case t := <-time.Tick(time.Second):
            results = append(results, t.Second())
        }
    }
}
```

What is wrong: `time.Tick(time.Second)` is called **every iteration**. Each call creates a new ticker. Each is leaked. After 1000 iterations, 1000 tickers exist; after 1 million, 1 million tickers.

Additionally — and worse — the `select` will tend to choose whichever channel is ready. The fresh ticker's first send is one second away. The old tickers' next sends are scattered. The `select` may pick one of the *previous iteration's* tickers, returning a stale time and leaving the new ticker to leak entirely.

**Fix:**
```go
func collect(ctx context.Context) []int {
    var results []int
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return results
        case now := <-t.C:
            results = append(results, now.Second())
        }
    }
}
```

One ticker, hoisted outside the loop, stopped on return.

### How to spot the bug

A regex search: `time\.Tick\(` is almost always a bug in any function that has `return` statements. Add it to your linter / pre-commit hook.

---

## Stopping Timers and Tickers

### `(*Timer).Stop`

```go
fired := !t.Stop()
```

- Returns `true` if the call prevented firing.
- Returns `false` if the timer had already fired or been stopped.
- Does not drain the channel.

Idiom (pre-1.23):
```go
if !t.Stop() {
    select { case <-t.C: default: }
}
// safe to Reset now
```

Idiom (Go 1.23+):
```go
t.Stop() // ignore return value if you're just stopping
```

For Reset on 1.23+:
```go
t.Reset(d) // race-free; no need to drain
```

### `(*Ticker).Stop`

```go
t.Stop()
```

- No return value.
- Does not drain the channel.
- After Stop, the channel may still hold one buffered tick.

Idiom:
```go
defer t.Stop()
```

---

## Mental Models

### Mental model 1: Timers are goroutines waiting on channels

When you write `time.Sleep`, mentally picture: my goroutine is "parked", the runtime promises to wake it. There is no thread blocked; just a record in a heap.

When you write `<-time.After(d)`, picture: my goroutine is blocked on a receive; the runtime will send on the channel after `d`.

### Mental model 2: The timer heap is the runtime's appointment book

The runtime maintains, per CPU, an appointment book ordered by time. Each entry is a `(when, callback)`. The scheduler checks the book before deciding what to run next. If something is due, fire it; if not, the time-until-next-due informs how long the OS thread can sleep.

### Mental model 3: `select` consumes one event

`select` blocks until one of its cases is ready, then runs that case. It does not "wait for all". The case might be a timer firing, a channel receive, a context cancellation. Each timer involved in a select case is registered with the runtime; whoever fires first wins.

### Mental model 4: Tickers are like cron jobs

A Ticker is a "every N seconds, do something" cron job. Like cron, it does not catch up if you fall behind — missed ticks are lost. Like cron, it stops only when you tell it to.

---

## Common Patterns

### Pattern 1: Timeout in a select

```go
select {
case v := <-ch:
    use(v)
case <-time.After(time.Second):
    return ErrTimeout
}
```

One-off, outside a loop. Acceptable.

### Pattern 2: Timeout via context (preferred)

```go
ctx, cancel := context.WithTimeout(parent, time.Second)
defer cancel()
select {
case v := <-ch:
    use(v)
case <-ctx.Done():
    return ctx.Err()
}
```

The deadline lives in the context; no extra `time.After`.

### Pattern 3: Periodic work with cancellation

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for {
    select {
    case <-t.C:
        doWork()
    case <-ctx.Done():
        return
    }
}
```

Standard production idiom.

### Pattern 4: Delayed one-shot work, cancellable

```go
t := time.AfterFunc(time.Hour, cleanup)
defer t.Stop()
```

`AfterFunc` + `defer Stop`. Fire-and-forget with safety.

### Pattern 5: Reusable Timer in a hot loop

```go
t := time.NewTimer(d)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(d)
    select {
    case j := <-jobs: handle(j)
    case <-t.C: flush()
    case <-ctx.Done(): return
    }
}
```

For Go 1.23+ the Stop+drain can be skipped.

### Pattern 6: Debounce

```go
type debouncer struct {
    mu sync.Mutex
    t  *time.Timer
    f  func()
    d  time.Duration
}

func (db *debouncer) trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t != nil {
        db.t.Stop()
    }
    db.t = time.AfterFunc(db.d, db.f)
}
```

Last trigger wins; intermediates are cancelled.

### Pattern 7: Heartbeat + work

```go
heartbeat := time.NewTicker(30 * time.Second)
defer heartbeat.Stop()
work := time.NewTicker(100 * time.Millisecond)
defer work.Stop()

for {
    select {
    case <-heartbeat.C: sendHeartbeat()
    case <-work.C: doWork()
    case <-ctx.Done(): return
    }
}
```

Two tickers, one goroutine.

---

## Code Examples

### Example 1: Basic Sleep

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    fmt.Println("start")
    time.Sleep(time.Second)
    fmt.Println("one second later")
}
```

Output:
```
start
(1 second later)
one second later
```

### Example 2: Sleep does not block the OS thread

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1) // one OS thread
    for i := 0; i < 5; i++ {
        go func(n int) {
            time.Sleep(time.Second)
            fmt.Println("hello from", n)
        }(i)
    }
    time.Sleep(2 * time.Second)
}
```

Despite GOMAXPROCS=1, all five goroutines wake roughly simultaneously after 1 second. The runtime multiplexes them onto the single OS thread; each sleep parks the goroutine without blocking the thread.

### Example 3: time.After in a select

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int)
    go func() {
        time.Sleep(500 * time.Millisecond)
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

Output: `got 42` (the goroutine sends before the timeout).

### Example 4: time.Timer with Stop

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTimer(time.Second)
    go func() {
        time.Sleep(500 * time.Millisecond)
        if !t.Stop() {
            fmt.Println("timer already fired")
        } else {
            fmt.Println("timer stopped before firing")
        }
    }()
    select {
    case <-t.C:
        fmt.Println("timer fired")
    case <-time.After(2 * time.Second):
        fmt.Println("test timeout")
    }
}
```

Likely output: "timer stopped before firing" then "test timeout" — because `t.Stop()` returned true (it stopped the timer) and `t.C` never fires.

### Example 5: AfterFunc

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
    time.AfterFunc(time.Second, func() {
        fmt.Println("ran in its own goroutine")
        wg.Done()
    })
    wg.Wait()
}
```

After 1 second, the function runs in a freshly created goroutine.

### Example 6: Ticker

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(500 * time.Millisecond)
    defer t.Stop()
    count := 0
    for now := range t.C {
        fmt.Println(now)
        count++
        if count >= 5 {
            return
        }
    }
}
```

Prints 5 timestamps at ~500 ms intervals.

### Example 7: Leak demonstration

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func leakIt(n int) {
    for range time.Tick(time.Millisecond) {
        n--
        if n <= 0 {
            return
        }
    }
}

func main() {
    fmt.Println("before:", runtime.NumGoroutine())
    for i := 0; i < 100; i++ {
        leakIt(10)
    }
    runtime.GC()
    runtime.GC()
    fmt.Println("after:", runtime.NumGoroutine())
}
```

Pre-1.23: goroutine count climbs (the tickers' send goroutines are kept alive). Post-1.23: better, but `time.Tick` is still the wrong tool here.

### Example 8: The right way

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func noLeak(n int) {
    t := time.NewTicker(time.Millisecond)
    defer t.Stop()
    for range t.C {
        n--
        if n <= 0 {
            return
        }
    }
}

func main() {
    fmt.Println("before:", runtime.NumGoroutine())
    for i := 0; i < 100; i++ {
        noLeak(10)
    }
    runtime.GC()
    fmt.Println("after:", runtime.NumGoroutine())
}
```

Goroutine count stays flat. The ticker is stopped on each return.

### Example 9: Timeout via context

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

    ch := make(chan int)
    go func() {
        time.Sleep(2 * time.Second)
        ch <- 42
    }()

    select {
    case v := <-ch:
        fmt.Println("got", v)
    case <-ctx.Done():
        fmt.Println("timeout:", ctx.Err())
    }
}
```

Output: `timeout: context deadline exceeded` after 1 second.

### Example 10: Debounce

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Debouncer struct {
    mu sync.Mutex
    t  *time.Timer
    d  time.Duration
    f  func()
}

func NewDebouncer(d time.Duration, f func()) *Debouncer {
    return &Debouncer{d: d, f: f}
}

func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t != nil {
        db.t.Stop()
    }
    db.t = time.AfterFunc(db.d, db.f)
}

func main() {
    db := NewDebouncer(100*time.Millisecond, func() {
        fmt.Println("debounced!")
    })
    for i := 0; i < 5; i++ {
        db.Trigger()
        time.Sleep(50 * time.Millisecond)
    }
    time.Sleep(200 * time.Millisecond)
}
```

Output: only one "debounced!" — the rapid triggers cancel each other.

### Example 11: Periodic with two cadences

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()

    slow := time.NewTicker(time.Second)
    defer slow.Stop()
    fast := time.NewTicker(200 * time.Millisecond)
    defer fast.Stop()

    for {
        select {
        case <-slow.C:
            fmt.Println("slow tick")
        case <-fast.C:
            fmt.Println("fast tick")
        case <-ctx.Done():
            return
        }
    }
}
```

### Example 12: Sleep precision

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    for _, d := range []time.Duration{
        time.Microsecond,
        10 * time.Microsecond,
        100 * time.Microsecond,
        time.Millisecond,
        10 * time.Millisecond,
        100 * time.Millisecond,
    } {
        start := time.Now()
        time.Sleep(d)
        actual := time.Since(start)
        fmt.Printf("requested %v, actual %v, overhead %v\n", d, actual, actual-d)
    }
}
```

On Linux, `1µs` requested often takes ~50–100 µs actual. Sleep precision is bounded by scheduler latency and OS timer resolution.

### Example 13: Forgotten Stop leak

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func startWorker() {
    t := time.NewTicker(time.Second)
    go func() {
        for range t.C {
            // work
        }
    }()
}

func main() {
    for i := 0; i < 100; i++ {
        startWorker()
    }
    time.Sleep(2 * time.Second)
    fmt.Println("goroutines:", runtime.NumGoroutine())
}
```

100 worker goroutines spawned; none stopped. Each holds a ticker. Effectively a leak.

### Example 14: Correct version

```go
func startWorker(ctx context.Context) {
    t := time.NewTicker(time.Second)
    go func() {
        defer t.Stop()
        for {
            select {
            case <-t.C:
                // work
            case <-ctx.Done():
                return
            }
        }
    }()
}
```

Worker stops when context is cancelled; ticker stopped via defer.

### Example 15: Reusing a Timer (Go 1.22)

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func process(ctx context.Context, jobs <-chan int) {
    t := time.NewTimer(time.Second)
    defer t.Stop()
    for {
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(time.Second)
        select {
        case j := <-jobs:
            fmt.Println("got job", j)
        case <-t.C:
            fmt.Println("idle")
        case <-ctx.Done():
            return
        }
    }
}
```

### Example 16: Same on Go 1.23+

```go
func process(ctx context.Context, jobs <-chan int) {
    t := time.NewTimer(time.Second)
    defer t.Stop()
    for {
        t.Reset(time.Second)
        select {
        case j := <-jobs:
            fmt.Println("got job", j)
        case <-t.C:
            fmt.Println("idle")
        case <-ctx.Done():
            return
        }
    }
}
```

No drain needed; cleaner.

### Example 17: Multiple AfterFunc cleanup

```go
func main() {
    timers := make([]*time.Timer, 5)
    for i := range timers {
        i := i
        timers[i] = time.AfterFunc(time.Duration(i+1)*time.Second, func() {
            fmt.Println("fire", i)
        })
    }
    // Cancel everything after 3 seconds
    time.Sleep(3 * time.Second)
    for _, t := range timers {
        t.Stop()
    }
    time.Sleep(time.Second)
}
```

Three timers fire (i=0,1,2); two are cancelled by Stop.

### Example 18: Bench: time.After vs reused Timer

```go
package main

import (
    "testing"
    "time"
)

func BenchmarkAfter(b *testing.B) {
    for i := 0; i < b.N; i++ {
        select {
        case <-time.After(time.Nanosecond):
        }
    }
}

func BenchmarkTimer(b *testing.B) {
    t := time.NewTimer(time.Nanosecond)
    defer t.Stop()
    for i := 0; i < b.N; i++ {
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(time.Nanosecond)
        select { case <-t.C: }
    }
}
```

`BenchmarkAfter` allocates a Timer per iteration; `BenchmarkTimer` reuses. The latter is significantly faster and has zero allocations.

### Example 19: Drift demonstration

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    start := time.Now()
    for i := 0; i < 10; i++ {
        work := 50 * time.Millisecond
        time.Sleep(work) // simulate
        time.Sleep(100 * time.Millisecond)
        fmt.Println(i, "elapsed:", time.Since(start))
    }
}
```

After 10 iterations, elapsed is ~1.5 s (10 × 150 ms), not 1 s. Sleep loops drift.

### Example 20: Ticker doesn't drift

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    start := time.Now()
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    for i := 0; i < 10; i++ {
        <-t.C
        time.Sleep(50 * time.Millisecond) // work overhead
    }
    fmt.Println("elapsed:", time.Since(start))
}
```

Elapsed: ~1 s. The Ticker's cadence stays correct.

---

## Coding Patterns

### Pattern: defer-Stop after every NewTicker

```go
t := time.NewTicker(d)
defer t.Stop()
```

Make this muscle memory. It is the most common omission in production code.

### Pattern: Hoist Timer outside hot loops

If you find yourself writing `<-time.After(d)` inside a `for` loop, hoist a Timer.

### Pattern: Use `ctx.Done()` for timeouts

If the function takes a context, use `<-ctx.Done()` in selects instead of `time.After`.

### Pattern: Use `time.Since` for elapsed

Never compute elapsed by subtracting wall-clock UnixNanos. Always `time.Since`.

### Pattern: Compare Times with `.Equal()`

Never `t1 == t2`. Always `t1.Equal(t2)`. The monotonic clock confuses `==`.

---

## Clean Code

### Read like prose

```go
// Bad: cryptic
go func() { time.Sleep(5e9); cleanup() }()

// Good: explicit
const cleanupDelay = 5 * time.Second
go func() {
    time.Sleep(cleanupDelay)
    cleanup()
}()
```

### Named durations

```go
const (
    heartbeatInterval = 30 * time.Second
    requestTimeout    = 5 * time.Second
    retryBackoff      = 100 * time.Millisecond
)
```

Magic numbers (`5 * time.Second`) inline are okay if local; named constants are better for code that is read in isolation.

### Wrap in named functions

```go
func waitForDeadline(ctx context.Context, d time.Duration) error {
    select {
    case <-time.After(d):
        return ErrTimeout
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

If the same select-with-timeout pattern appears in many places, give it a name.

---

## Error Handling

### Timeouts are not always errors

A `<-ctx.Done()` case often indicates a timeout — but in some designs (e.g., periodic polling with bounded wait), reaching it is normal.

### Distinguish timeout from cancellation

```go
switch ctx.Err() {
case context.DeadlineExceeded:
    // timed out
case context.Canceled:
    // cancelled by user / parent
default:
    // shouldn't happen if ctx.Done() fired
}
```

### Don't ignore Stop's return value when it matters

Pre-1.23, ignoring `Stop`'s bool can lead to stale receives. On 1.23+, ignoring is usually fine.

### Don't conflate "timer fired" with "work completed"

```go
select {
case <-t.C:
    // The TIMER fired. Not the work. Don't assume.
case <-work:
}
```

---

## Security Considerations

### Timing attacks

`time.Since` of cryptographic operations leaks information. Use `crypto/subtle.ConstantTimeCompare` for comparisons of secrets; never branch on or measure operations involving keys/passwords/tokens.

### Resource exhaustion via timer flood

If your service exposes an endpoint that creates a Timer per request, a malicious client can flood you. Always cap the number of in-flight timers (e.g., via a semaphore).

### Clock manipulation

If your security model depends on time (e.g., token expiration), be aware that the wall clock can be manipulated. Use monotonic time within a single process; trust a secured time source (NTP authenticated) for cross-process or cross-machine reasoning.

---

## Performance Tips

1. **Hoist `time.After` out of hot loops.** Single biggest perf win.
2. **Use `time.AfterFunc` for fire-and-forget delayed work.** Cheaper than `<-time.After` in a goroutine.
3. **Use `ctx.Done()` instead of `time.After` when a context with deadline already exists.**
4. **Avoid sub-millisecond `time.Sleep`.** Bounded by scheduler latency; use spin-wait or batching instead.
5. **Stop Tickers you no longer use.** Forgotten Stop = leak.

---

## Best Practices

1. Every `NewTimer` / `NewTicker` has a `defer Stop`.
2. Never `time.Tick` in functions that return.
3. Hoist `time.After` out of hot loops.
4. Use `time.Since` for elapsed; `.Equal()` for compare.
5. Use `context.WithTimeout` over manual `time.After` for deadlines.

---

## Edge Cases and Pitfalls

### Zero or negative duration

`time.Sleep(0)` returns immediately but still cycles through the scheduler — effectively a yield. `time.NewTimer(0)` fires immediately. `time.NewTicker(0)` *panics*.

### Very large durations

`time.NewTimer(time.Hour * 24 * 365 * 100)` — 100-year timer — is fine. The timer heap stores integers; no overflow until 292 years.

### Timer.Reset return value

Reset returns the same `bool` as Stop — whether the timer was active before.

### Channel-leftover after Stop (pre-1.23)

After `t.Stop()`, `t.C` may still hold one value. The next receive will get it.

### Tickers under load coalesce

If your consumer of `t.C` is slow, you do not get N ticks per second — you get fewer. The runtime silently drops ticks. Code that counts ticks for billing is wrong.

---

## Common Mistakes

1. `time.Tick` in a function that returns.
2. `<-time.After(d)` in a hot select loop.
3. Forgetting `defer t.Stop()`.
4. `==` comparison of `time.Time`.
5. Sleep loops with cumulative drift.
6. Computing elapsed via wall-clock arithmetic (loses monotonic).
7. Ignoring Stop's return value (pre-1.23).
8. `time.AfterFunc` callback that accesses shared state without sync.
9. Loop-variable capture in `time.AfterFunc` callbacks (Go ≤ 1.21).
10. `time.Sleep(0)` instead of `runtime.Gosched`.

---

## Common Misconceptions

### "`time.Sleep` blocks the thread"

No. It parks the goroutine. The thread runs other goroutines.

### "`time.After` and `time.NewTimer` are equally fine"

No. `time.After` allocates per call. Use `NewTimer` in hot loops.

### "The runtime starts a thread per Timer"

No. All timers share the per-P heap. The scheduler checks the heap; no per-timer thread.

### "`time.Tick` is fine in tests"

Maybe — but if your test ever exits early (failure, parallel runs), the leaked tickers can interfere with other tests. Use `time.NewTicker` + cleanup.

### "Wall clock and monotonic clock are the same"

No. Wall can jump; monotonic cannot. `time.Now()` records both; arithmetic uses monotonic when available.

### "`time.Sleep(d)` sleeps exactly `d`"

No. "At least `d`". Real sleep is `d + jitter`.

---

## Tricky Points

### `select` with a fired timer

A `select` will pick a ready case. If `time.After`'s channel has a value (timer fired), that case is ready. If multiple cases are ready, `select` picks pseudo-randomly.

### Closure capture in AfterFunc

```go
for i := 0; i < 10; i++ {
    time.AfterFunc(time.Second, func() { fmt.Println(i) })
}
```

In Go ≤1.21, all callbacks print 10. In Go 1.22+, each prints its own `i` (per-iteration scope).

### Reset after timer has already fired and value consumed

```go
t := time.NewTimer(time.Millisecond)
<-t.C // timer fired; value consumed
t.Reset(time.Second) // safe; channel is empty
```

No drain needed because we already drained.

---

## Test

Verify your understanding:

1. What does `time.Sleep(time.Second)` do at the goroutine level?
2. Why does `time.Tick(time.Second)` leak?
3. What is the difference between `time.After` and `time.NewTimer`?
4. When would you use `time.AfterFunc` instead of `time.NewTimer`?
5. Why is `<-time.After(d)` in a `for` loop a bug?
6. What does `Timer.Stop()` return, and when should you check it?
7. What changed about timer behaviour in Go 1.23?
8. Why is `time.Time{} == time.Time{}` true but `time.Now() == time.Now()` flaky?
9. Why does a periodic `for { do(); time.Sleep(d) }` drift?
10. How do you cancel a `time.AfterFunc` before it fires?

---

## Tricky Questions

### Q1. What does `time.Sleep(0)` do?
Yields to the scheduler. Returns immediately but cycles through gopark.

### Q2. Can two goroutines safely receive from the same `t.C`?
Yes — channel receives are safe under concurrency. But only one will get the value.

### Q3. What happens if `t.Reset(d)` is called while the timer is firing?
Pre-1.23: race; may or may not receive the old value. Post-1.23: race-free.

### Q4. Is `<-time.After(d)` cancellable?
No — you cannot stop the underlying Timer from `time.After`. Use `time.NewTimer` if cancellation matters.

### Q5. Does `time.NewTicker(0)` work?
No — panics with "non-positive interval for NewTicker".

### Q6. After `t.Stop()`, is `t.C` empty?
Maybe. Stop does not drain. There may be one stale value.

### Q7. Can I reuse a `*Timer` across goroutines?
Yes — `Stop`, `Reset`, and receives on `t.C` are concurrency-safe.

### Q8. Does `time.AfterFunc(d, f)` start a goroutine immediately?
No — it schedules the timer. When the timer fires, the runtime starts a new goroutine to call `f`.

---

## Cheat Sheet

| Want | Use | Notes |
|------|-----|-------|
| Sleep current goroutine | `time.Sleep(d)` | Yields the M; other Gs run. |
| Timeout in select | `<-ctx.Done()` if available, else `<-time.After(d)` | After in loops = leak. |
| Reusable timer | `time.NewTimer` + `Reset` | Pre-1.23: Stop+drain first. |
| Fire callback after d | `time.AfterFunc(d, f)` | Cancel with `Stop`. |
| Periodic work | `time.NewTicker` + `defer Stop` | Don't use `time.Tick`. |
| Cancel everything | `ctx.Cancel()` + select on `ctx.Done()` | Idiomatic. |
| Elapsed time | `time.Since(start)` | Monotonic-safe. |
| Compare times | `t1.Equal(t2)` | Never `==`. |

---

## Self-Assessment Checklist

- [ ] I can explain what `time.Sleep` does to a goroutine vs an OS thread.
- [ ] I never use `time.Tick` in a function that returns.
- [ ] I always `defer t.Stop()` after `time.NewTicker`.
- [ ] I hoist `time.After` out of hot loops.
- [ ] I use `time.Since` for elapsed time.
- [ ] I use `t.Equal()` for comparing `time.Time`.
- [ ] I know `time.AfterFunc` runs the callback in a fresh goroutine.
- [ ] I can write a leak-free ticker loop with context cancellation.
- [ ] I understand why `<-time.After` in a select loop is a leak.
- [ ] I have read at least one production codebase's timer-related code with these concepts in mind.

---

## Summary

The time package is the gateway between concurrent Go code and the passage of time. At the junior level the lessons are:

1. **`time.Sleep` parks the goroutine; it does not block the thread.**
2. **`time.After` is convenient but leaks in hot loops.**
3. **`time.NewTimer` is the explicit form; reuse it via `Reset`.**
4. **`time.AfterFunc` schedules a callback; cheap and composable.**
5. **`time.NewTicker` + `defer Stop` is the right way to do periodic work.**
6. **`time.Tick` is a footgun; never use it in functions that return.**
7. **Compare `time.Time` via `.Equal()`, not `==`.**
8. **Use `time.Since` for elapsed.**

The middle and senior files go deeper: into the runtime's per-P heap, into the timer state machine, into Go 1.23's redesign, into syscall-level sleep precision. But these eight lessons cover 90% of what most Go programmers will ever need.

---

## What You Can Build

With this knowledge you can build:
- A periodic background worker (ticker + context cancellation).
- A debouncer for input events.
- A rate-limited API client.
- A retry-with-backoff loop.
- A heartbeat sender for a long-lived connection.
- A simple cron-like scheduler (in-process).
- Tests that use timeouts to avoid hanging.

You are not yet ready to build:
- A high-throughput timer wheel (senior).
- A fake clock for deterministic time-based tests (professional).
- A scheduler that integrates with the runtime's timer heap directly (specification-level deep dive).

---

## Further Reading

- `time` package godoc: https://pkg.go.dev/time
- `context` package godoc: https://pkg.go.dev/context
- Go 1.23 release notes (timer changes): https://go.dev/doc/go1.23
- Dave Cheney, "Visualising the Go runtime." (blog posts; explains scheduler basics).
- Brad Fitzpatrick, "GopherCon 2016: Go for Network Programmers." (explains time package idioms).

---

## Related Topics

- **Channels and select** — the user-facing API for timer composition.
- **Context** — `context.WithTimeout` is the modern preferred way to deadline a call.
- **Goroutines and scheduler** — what `time.Sleep` actually parks.
- **Memory model and concurrency** — channel sends-receives establish happens-before edges; timer channels participate in this.
- **sync package** — `sync.Once`, `sync.Mutex` interact with timers in patterns like rate-limited stand-by code.

The next file, `middle.md`, walks the runtime source line by line: `runtime/time.go`, the timer struct, the status state machine, the per-P heap operations, and how `runtime.timeSleep` and `runtime.modtimer` work in detail.

---

## Diagrams and Visual Aids

### The lifecycle of a `time.Sleep` call

```
+-------------------+
|  User code        |
|  time.Sleep(1s)   |
+--------+----------+
         |
         v
+--------+----------+        +--------------------+
|  runtime.timeSleep|        |  P's timer heap    |
|  - park goroutine | -----> |  insert(when=now+1s|
|  - register timer |        |          fn=ready) |
+--------+----------+        +--------------------+
         |
         v
+--------+----------+
|  Goroutine PARKED |
|  (M is free)      |
+--------+----------+
         |
         v (other goroutines run on this M)
         .
         .
         . (1 second passes)
         .
         v
+--------+----------+        +--------------------+
|  Scheduler checks |  <---  |  Timer expires     |
|  timers, sees due |        |  Calls fn(arg)     |
+--------+----------+        +--------------------+
         |
         v
+--------+----------+
|  goready(gp)      |
|  G back on runq   |
+--------+----------+
         |
         v
+--------+----------+
|  Eventually P     |
|  picks up G       |
|  Sleep returns    |
+-------------------+
```

### `time.After` in a select

```
   +------------+         +--------------------+
   | User code  |         | runtime            |
   | select {   |         |                    |
   |  case c<-: |         | After(d):          |
   |  case t<-: | <-----  |   t := NewTimer(d) |
   | }          |         |   schedule t       |
   +------------+         |                    |
                          | when t fires:      |
                          |   send time on t.C |
                          +--------------------+
```

If `c` arrives first, the Timer is *not* stopped — it lives on the heap until `d` expires. This is the leak.

### Per-P timer heap (conceptual)

```
P0:                     P1:                    P2:
+--------------+        +--------------+       +--------------+
| heap (min)   |        | heap (min)   |       | heap (min)   |
|  +--+        |        |  +--+        |       |  +--+        |
|  |  | when=5 |        |  |  | when=3 |       |  |  | when=7 |
|  +--+        |        |  +--+        |       |  +--+        |
|   +-+   +-+  |        |   +-+        |       |   +-+        |
|   | |   | |  |        |   | |  when=8|       |   | |  when=9|
|   +-+   +-+  |        |   +-+        |       |   +-+        |
+--------------+        +--------------+       +--------------+
```

Each P has its own heap. Timers added on a P stay on that P (unless the goroutine that created them migrates). No global lock; each P's heap is independent.

### The Tick leak

```
Function call 1: time.Tick(d) ---+
Function call 2: time.Tick(d) ---+--- all leak; no Stop
Function call 3: time.Tick(d) ---+
                                  
Each ticker:
  +-----------+
  | *Ticker   |
  | +-------+ | --- sends to C forever
  | |  C    | |
  | +-------+ |
  +-----------+
  
Never goes away. Each adds to timer heap.
```

### Channel buffer of size 1 on Ticker

```
                Channel buffer (size 1)
                +--------+
                |  tick  |
                +--------+
                    ^
                    | runtime tries to send
                    |
                    | if buffer full, send is dropped
                    |
        +-----------+-----------+
        |                       |
   slow consumer:          fast consumer:
   misses ticks            keeps up
```

### Stop+drain dance (pre-1.23)

```
Step 1: t.Stop()
  - if returns true: timer was pending, now stopped, C is empty
  - if returns false: timer may have fired; C may hold a value

Step 2 (if Stop returned false):
  select { case <-t.C: default: }   // drain any stale value

Step 3:
  t.Reset(d)   // safe; C is empty, timer is fresh

Go 1.23+: Step 2 is unnecessary. Reset alone is enough.
```

### Wall vs monotonic in time.Time

```
time.Time:
  +------------------+
  | wall  (uint64)   |  <- changes with NTP, settable
  +------------------+
  | ext   (int64)    |  <- monotonic reading (or zero after roundtrip)
  +------------------+
  | loc   (*Location)|
  +------------------+

time.Now()   -> sets both wall and ext
time.Unix(s,ns) -> sets only wall (ext=0)
JSON Unmarshal  -> sets only wall (ext=0)

t1.Sub(t2): if both have ext, use ext (monotonic).
            else, use wall.
t1.Equal(t2): compares wall, ignoring ext.
t1 == t2:    compares all fields, including ext. DANGEROUS.
```

### context.WithTimeout under the hood (Go 1.21+)

```
ctx, cancel := context.WithTimeout(parent, d)

  Internally:
    ctx := newCancelCtx(parent)
    timer := time.AfterFunc(d, func() {
        ctx.cancel(true, DeadlineExceeded)
    })

  When ctx.Done() is observed:
    - either parent was cancelled
    - or cancel() was called by user
    - or timer fired (DeadlineExceeded)

  Always: defer cancel()
    -> releases the timer if not yet fired
    -> propagates cancellation to children
```

---

## Extended Code Examples

### Example 21: Retry with exponential backoff

```go
func retryWithBackoff(ctx context.Context, op func() error) error {
    backoff := 100 * time.Millisecond
    maxBackoff := 10 * time.Second
    for {
        err := op()
        if err == nil {
            return nil
        }
        select {
        case <-time.After(backoff):
            backoff *= 2
            if backoff > maxBackoff {
                backoff = maxBackoff
            }
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}
```

Note: `time.After` here is acceptable because each iteration's backoff is bounded and the loop is not tight.

### Example 22: Rate limiter

```go
type RateLimiter struct {
    interval time.Duration
    next     time.Time
    mu       sync.Mutex
}

func (r *RateLimiter) Wait(ctx context.Context) error {
    r.mu.Lock()
    now := time.Now()
    if now.Before(r.next) {
        wait := r.next.Sub(now)
        r.next = r.next.Add(r.interval)
        r.mu.Unlock()
        select {
        case <-time.After(wait):
            return nil
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    r.next = now.Add(r.interval)
    r.mu.Unlock()
    return nil
}
```

### Example 23: Cleanup after delay with cancellation

```go
type Item struct {
    Key       string
    expiry    *time.Timer
}

type Cache struct {
    mu    sync.Mutex
    items map[string]*Item
}

func (c *Cache) Set(key string, ttl time.Duration) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if old, ok := c.items[key]; ok {
        old.expiry.Stop()
    }
    item := &Item{Key: key}
    item.expiry = time.AfterFunc(ttl, func() {
        c.mu.Lock()
        delete(c.items, key)
        c.mu.Unlock()
    })
    c.items[key] = item
}
```

### Example 24: Periodic cleanup with batching

```go
func runCleanup(ctx context.Context, cache *Cache, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            cache.CleanExpired()
        case <-ctx.Done():
            return
        }
    }
}
```

A single goroutine cleans the cache every `interval` instead of one timer per item.

### Example 25: Heartbeat with stale detection

```go
type Heartbeat struct {
    interval time.Duration
    last     atomic.Int64 // unix nano
}

func (h *Heartbeat) IsAlive(grace time.Duration) bool {
    return time.Now().UnixNano()-h.last.Load() < int64(grace)
}

func (h *Heartbeat) Run(ctx context.Context) {
    t := time.NewTicker(h.interval)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            h.last.Store(time.Now().UnixNano())
        case <-ctx.Done():
            return
        }
    }
}
```

Note: this example *does* compute elapsed via UnixNano — it is acceptable here only because the grace window is large (seconds, not microseconds) and wall-clock jumps would be a recognised event anyway. Production code might still want monotonic.

### Example 26: Timeout for a chain of operations

```go
func processRequest(ctx context.Context, req Request) (Response, error) {
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    
    user, err := lookupUser(ctx, req.UserID)
    if err != nil { return nil, err }
    
    perms, err := loadPerms(ctx, user.ID)
    if err != nil { return nil, err }
    
    return executeOp(ctx, user, perms, req.Op)
}
```

A single deadline propagates through all sub-operations. Each can observe `<-ctx.Done()`.

### Example 27: Aggregating events with timeout

```go
func aggregate(ctx context.Context, events <-chan Event) [][]Event {
    var result [][]Event
    var batch []Event
    flush := time.NewTimer(500 * time.Millisecond)
    defer flush.Stop()
    
    for {
        select {
        case e, ok := <-events:
            if !ok {
                if len(batch) > 0 {
                    result = append(result, batch)
                }
                return result
            }
            batch = append(batch, e)
            if !flush.Stop() {
                select { case <-flush.C: default: }
            }
            flush.Reset(500 * time.Millisecond)
        case <-flush.C:
            if len(batch) > 0 {
                result = append(result, batch)
                batch = nil
            }
            flush.Reset(500 * time.Millisecond)
        case <-ctx.Done():
            return result
        }
    }
}
```

Each new event resets the flush timer; the batch is flushed after 500 ms of silence.

### Example 28: Cancel a long-running computation

```go
func compute(ctx context.Context, work func() Result) (Result, error) {
    done := make(chan Result, 1)
    go func() {
        done <- work()
    }()
    select {
    case r := <-done:
        return r, nil
    case <-ctx.Done():
        // we can't actually kill the goroutine; it leaks
        return Result{}, ctx.Err()
    }
}
```

The goroutine running `work` continues even after timeout. To truly cancel, `work` must observe `ctx` itself. This is a Go idiom: cancellation requires cooperation.

### Example 29: Implementing a stopwatch

```go
type Stopwatch struct {
    start    time.Time
    elapsed  time.Duration
    running  bool
}

func (s *Stopwatch) Start() {
    if !s.running {
        s.start = time.Now()
        s.running = true
    }
}

func (s *Stopwatch) Stop() time.Duration {
    if s.running {
        s.elapsed += time.Since(s.start)
        s.running = false
    }
    return s.elapsed
}

func (s *Stopwatch) Reset() {
    s.elapsed = 0
    s.running = false
}
```

`time.Since` uses monotonic; the stopwatch is correct across wall-clock jumps.

### Example 30: Polling with backoff

```go
func waitForCondition(ctx context.Context, check func() bool, maxBackoff time.Duration) error {
    backoff := 10 * time.Millisecond
    for {
        if check() {
            return nil
        }
        select {
        case <-time.After(backoff):
            backoff *= 2
            if backoff > maxBackoff {
                backoff = maxBackoff
            }
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}
```

`time.After` is acceptable here because (a) backoff grows quickly so the loop is not tight, and (b) the function exits cleanly on success.

---

## More Common Patterns Walked Through

### Pattern: Forced timeout for a goroutine

```go
done := make(chan struct{})
go func() {
    defer close(done)
    longOperation()
}()
select {
case <-done:
    // completed
case <-time.After(timeout):
    // operation took too long; goroutine continues to run
    return ErrTimeout
}
```

Limitation: cannot kill the goroutine. Use context instead.

### Pattern: Cancellable Sleep

```go
func sleepWithCancel(ctx context.Context, d time.Duration) error {
    select {
    case <-time.After(d):
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Wrap `time.After` for code that needs cancellable sleep. Acceptable if not called in a hot loop.

### Pattern: Future / promise

```go
type Future[T any] struct {
    done chan struct{}
    val  T
    err  error
}

func NewFuture[T any](f func() (T, error)) *Future[T] {
    fu := &Future[T]{done: make(chan struct{})}
    go func() {
        fu.val, fu.err = f()
        close(fu.done)
    }()
    return fu
}

func (f *Future[T]) Get(ctx context.Context) (T, error) {
    select {
    case <-f.done:
        return f.val, f.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

A future with timeout via context.

### Pattern: Periodic work with adaptive rate

```go
func adaptiveWorker(ctx context.Context) {
    minInterval := 100 * time.Millisecond
    maxInterval := 10 * time.Second
    interval := minInterval
    
    t := time.NewTimer(interval)
    defer t.Stop()
    
    for {
        select {
        case <-t.C:
            didWork := doMaybe()
            if didWork {
                interval = minInterval
            } else {
                interval = min(2*interval, maxInterval)
            }
            t.Reset(interval)
        case <-ctx.Done():
            return
        }
    }
}
```

Idle work backs off; active work tightens up.

### Pattern: Two-phase shutdown

```go
func server(ctx context.Context) {
    shutdownStarted := make(chan struct{})
    go func() {
        <-ctx.Done()
        close(shutdownStarted)
    }()
    
    // Phase 1: accept new requests
    for {
        select {
        case req := <-incoming:
            go handle(req)
        case <-shutdownStarted:
            goto drain
        }
    }
drain:
    // Phase 2: drain in-flight, with timeout
    drainDeadline := time.AfterFunc(30*time.Second, func() {
        log.Println("drain timed out; forcing shutdown")
    })
    defer drainDeadline.Stop()
    waitForInflightToFinish()
}
```

`time.AfterFunc` schedules a forced shutdown; `Stop()` cancels if drain completes first.

---

## Final Best-Practice Recap

### Do

- `defer t.Stop()` after every `NewTicker` and `NewTimer`.
- Hoist `time.After` out of hot loops.
- Use `context.WithTimeout` for deadlines.
- Use `time.Since` for elapsed.
- Use `.Equal()` for comparing `time.Time`.
- Strip monotonic (`Round(0)`) before storage.
- Profile with `pprof` to catch timer-related allocation.

### Don't

- Use `time.Tick` in functions that may return.
- Use `<-time.After` in a tight `for select` loop.
- Compare `time.Time` with `==`.
- Compute elapsed via wall-clock arithmetic.
- Ignore `Stop`'s return value pre-1.23.
- Rely on `time.Sleep` for sub-millisecond precision.
- Forget to `Stop` a `*Timer` you no longer need.

With these dos and don'ts internalised, you have a strong junior-level command of the `time` package. The middle file is where the runtime internals come into focus.
