---
layout: default
title: Middle
parent: Timer Leaks
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/03-timer-leaks/middle/
---

# Timer Leaks — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Five Timer APIs in One Picture](#the-five-timer-apis-in-one-picture)
3. [`NewTimer` and the `Stop` Pattern](#newtimer-and-the-stop-pattern)
4. [The `Reset` Gotcha](#the-reset-gotcha)
5. [Re-Use vs Re-Allocate: Building a Hot-Path Timer](#re-use-vs-re-allocate-building-a-hot-path-timer)
6. [The `select { case <-time.After(d) }` Loop Leak](#the-select--case--timeafterd--loop-leak)
7. [The Phantom "default Saved Me" Myth](#the-phantom-default-saved-me-myth)
8. [`AfterFunc` and Stop Race Conditions](#afterfunc-and-stop-race-conditions)
9. [`Ticker` Leaks and Misuse of `time.Tick`](#ticker-leaks-and-misuse-of-timetick)
10. [Per-Connection Deadlines vs Timers](#per-connection-deadlines-vs-timers)
11. [Testing Timer-Heavy Code](#testing-timer-heavy-code)
12. [Detection Cheatsheet](#detection-cheatsheet)
13. [Refactor Walkthroughs](#refactor-walkthroughs)
14. [Self-Assessment](#self-assessment)
15. [Summary](#summary)

---

## Introduction

At the junior level you learned the headline: `time.After` allocates a `*time.Timer` every call, drops the reference, and the runtime keeps the timer body alive until it fires. Inside a hot loop where the timer rarely wins, that is a textbook leak. The fix is a single reusable `*time.Timer` whose `Stop` and `Reset` you manage by hand.

That is the slogan. The middle-level question is how to actually live with that slogan in a real codebase. Real services do not look like the textbook example. They have:

- A `select` with three or four channels, only one of which is the timeout.
- A timer reused across iterations but only sometimes — there is a fast path that takes a `case <-ch` and exits before the timer would ever start.
- A `Reset` called on a timer that may or may not have fired, depending on a race the author never thought about.
- A `time.AfterFunc` callback that holds a pointer to a request that the caller already returned.
- A goroutine that subscribes to a `time.Tick` and then crashes — the `Ticker` keeps firing into nothing for the lifetime of the process.

This page walks through each of those situations, shows the code you will inherit, the bug as it actually appears in pprof, and the rewrite. We close with detection commands you can run today on a service you already operate.

After reading this you will:

- Read and write `NewTimer` + `Stop` + `Reset` patterns confidently, including the drain step.
- Know exactly when `Reset` is safe and when it requires a `Stop` first.
- Spot a `time.After` inside a `for { select { ... } }` loop in code review without reading the surrounding code.
- Understand why adding `default:` to a `select` does **not** save you from the `time.After` leak.
- Make `Ticker` cleanup as reliable as `defer file.Close()`.
- Use `pprof` heap snapshots, `runtime.MemStats`, and `goleak` to confirm a timer leak is fixed.

---

## The Five Timer APIs in One Picture

The `time` package exposes five timer-related entry points that all share the same underlying runtime timer machinery. Knowing which one you are using — and which channel you are reading from — is half the battle.

| API | Returns | Channel | Stoppable | Common bug |
|---|---|---|---|---|
| `time.Sleep(d)` | nothing | none | no (it is synchronous) | blocks the caller forever if `d` is misconfigured |
| `time.After(d)` | `<-chan Time` | yes | no, allocates a fresh timer each call | allocation churn in loops, pre-1.23 retention |
| `time.NewTimer(d)` | `*Timer` | `t.C` | yes, `t.Stop()` | misuse of `Reset` without `Stop` and drain |
| `time.AfterFunc(d, f)` | `*Timer` | none | yes, `t.Stop()` | `f` captures state that should already be GC-eligible |
| `time.NewTicker(d)` | `*Ticker` | `t.C` | yes, `t.Stop()` | forgotten `Stop`, subscriber dies, ticker keeps firing |
| `time.Tick(d)` | `<-chan Time` | yes | **no, ever** | "convenient" but completely un-stoppable |

Three things to note up front:

1. `time.After(d)` is essentially `time.NewTimer(d).C`. The `*Timer` itself is dropped on the floor. You cannot stop it.
2. `time.Tick(d)` is similarly `time.NewTicker(d).C`. The `*Ticker` is dropped. You cannot stop it. The runtime keeps it alive for the lifetime of the process. The standard library godoc literally says "Tick is a convenience wrapper for NewTicker providing access to the ticking channel only. Unlike NewTicker, Tick will return nil if d <= 0. While Tick is useful for clients that have no need to shut down the Ticker, be aware that without a way to shut it down the underlying Ticker cannot be recovered by the garbage collector; it 'leaks'." That last sentence is in the docs.
3. `time.AfterFunc` does **not** use a channel. The callback `f` runs on its own goroutine. This means stopping it is not the same as draining a channel.

If you remember nothing else, remember: `time.After` and `time.Tick` are "leaky by default, fine in throwaway code, dangerous in long-running code." The other three are stoppable, but stopping them correctly requires understanding the `Stop`/`Reset` rules below.

### The runtime-level picture

All five APIs end up in the runtime's internal timer machinery. Every `*time.Timer` (and every internal timer behind `time.Tick`, `time.After`, `time.AfterFunc`) corresponds to a `runtime.timer` struct that lives inside a per-P timer heap. When you call `Stop`, the runtime removes the entry from that heap. When you do **not** call `Stop`, the entry stays in the heap until the timer fires.

This is the core of "timer leak": every active entry in the runtime timer heap pins memory.

- Pre-Go 1.23, that memory was the entire `*time.Timer` value, including any associated channel buffer.
- In Go 1.23+, the runtime was reworked so an unreferenced timer can be collected by the garbage collector even before its fire time. This dramatically reduces the cost of `time.After` in loops — but it does not eliminate it, and you should still not rely on it.

The senior-level page goes into this internals topic in detail. At middle level, treat the heap as a black box that *fills up with whatever you forget to stop*.

---

## `NewTimer` and the `Stop` Pattern

`time.NewTimer(d)` returns a `*time.Timer`. You receive on `t.C`. You stop it with `t.Stop()`. That is the entire surface — but each step has rules.

### The minimum viable usage

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTimer(100 * time.Millisecond)
    defer t.Stop()

    select {
    case fired := <-t.C:
        fmt.Println("fired at:", fired)
    }
}
```

This program compiles, runs, prints, and exits. The `defer t.Stop()` is harmless if the timer already fired (it returns `false`) and useful if we exit the function before the timer would have fired.

### The `Stop` return value

```go
stopped := t.Stop()
```

- `stopped == true` means the timer was active at the moment of the call, the runtime took it out of the heap, and the channel **has not** received its value (and will not, unless you `Reset`).
- `stopped == false` means one of two things:
  - The timer already fired (its value is now sitting in `t.C`, waiting for a reader).
  - The timer was already stopped earlier.

That second meaning of `false` is the one that trips people up. It is **not** an error condition. It is information you need before you decide whether to drain the channel.

### When you must drain the channel

If you intend to call `Reset` and `Stop` returned `false`, the channel might still have a value queued. If you `Reset` without draining, the next read on `t.C` will fire immediately with the *old* value. That is almost never what you want.

The textbook drain-before-reset:

```go
if !t.Stop() {
    // The timer fired before Stop could remove it.
    // There might be a value waiting in t.C.
    select {
    case <-t.C:
    default:
    }
}
t.Reset(newDuration)
```

The `select` with `default` is the standard non-blocking drain. It reads one value if present, returns immediately if not.

> Note: this is the **drain-then-reset** idiom and it is unrelated to the false `default` myth in [the section below](#the-phantom-default-saved-me-myth). Here `default` is correct because we genuinely want a non-blocking peek at a value-or-nothing channel.

### Common shape: timeout in a worker

```go
func work(in <-chan Job, timeout time.Duration) error {
    t := time.NewTimer(timeout)
    defer t.Stop()

    for {
        if !t.Stop() {
            select {
            case <-t.C:
            default:
            }
        }
        t.Reset(timeout)

        select {
        case j, ok := <-in:
            if !ok {
                return nil
            }
            if err := process(j); err != nil {
                return err
            }
        case <-t.C:
            return errTimeout
        }
    }
}
```

This is correct, but somewhat noisy. Every iteration is:

1. Stop the timer, possibly drain its channel.
2. Reset the timer.
3. Wait on either a job or the timer.

If you find yourself writing this pattern more than twice, extract it into a helper.

### A helper for resetting

```go
// resetTimer cancels t and resets it to d, draining the channel if necessary.
// It is safe to call regardless of the timer's current state, as long as
// no other goroutine is racing on the same timer.
func resetTimer(t *time.Timer, d time.Duration) {
    if !t.Stop() {
        select {
        case <-t.C:
        default:
        }
    }
    t.Reset(d)
}
```

Now the worker is:

```go
func work(in <-chan Job, timeout time.Duration) error {
    t := time.NewTimer(timeout)
    defer t.Stop()

    for {
        resetTimer(t, timeout)
        select {
        case j, ok := <-in:
            if !ok {
                return nil
            }
            if err := process(j); err != nil {
                return err
            }
        case <-t.C:
            return errTimeout
        }
    }
}
```

### The deferred `Stop`

Every `NewTimer` should have a `defer t.Stop()`. Even if you `Stop` inside the loop, the `defer` catches the early-exit cases:

```go
t := time.NewTimer(d)
defer t.Stop()

select {
case <-ctx.Done():
    return ctx.Err() // defer t.Stop() prevents the timer from outliving us.
case v := <-t.C:
    return v, nil
}
```

If you forget the `defer`, the `ctx.Done()` path leaves the timer alive in the runtime heap until it fires. Pre-Go 1.23, that pinned the timer body for `d` milliseconds. Multiply by a hot path and you have measurable leak.

### Side note: `NewTimer` does *not* leak when `t.C` is read

If the timer fires and you read its channel, the runtime is done with it — `Stop` is unnecessary. The `Stop` matters when **the timer is still pending**.

```go
t := time.NewTimer(d)
<-t.C
// No Stop needed here. The timer already fired and was removed from the heap.
```

But it costs nothing to add `defer t.Stop()` at the top, and it future-proofs the function against later changes that introduce an early return.

---

## The `Reset` Gotcha

`Reset` is the most miswritten timer call in Go. The function signature looks innocuous:

```go
func (t *Timer) Reset(d time.Duration) bool
```

The return value is the same as `Stop`: `true` if the timer was active, `false` if it had expired or been stopped. But the documentation on the safe usage of `Reset` is one of the most carefully worded paragraphs in the entire standard library.

### The rule, as the docs state it

> Reset should always be invoked on stopped or expired timers with drained channels. If a program has already received a value from `t.C`, the timer is known to have expired and the channel drained, so `t.Reset` can be used directly. If a program has not yet received a value from `t.C`, however, the timer must be stopped and—if `Stop` reports that the timer expired before being stopped—the channel explicitly drained.

In plain English, before you call `Reset` you must be in one of two states:

1. **You already read from `t.C`.** The channel is drained. `Reset` is safe.
2. **You called `Stop()` and drained the channel if `Stop` returned false.** The channel is drained. `Reset` is safe.

If you call `Reset` while the timer might still fire, you have created a race: the *old* fire and the *new* fire can both end up queued in `t.C`, and your `select` will see two firings instead of one.

### A wrong `Reset` (race scenario)

```go
t := time.NewTimer(10 * time.Millisecond)

for i := 0; i < 5; i++ {
    select {
    case <-t.C:
        // Got a tick.
    case <-doSomething():
        // doSomething finished first.
    }
    t.Reset(10 * time.Millisecond) // WRONG: did not drain t.C if doSomething won.
}
```

If `doSomething` wins, `t.C` may still have a queued value. `Reset` does not remove that value. On the next iteration you might see the *previous* expiration immediately, even though the new 10ms have not elapsed.

### A correct `Reset`

```go
t := time.NewTimer(10 * time.Millisecond)
defer t.Stop()

for i := 0; i < 5; i++ {
    select {
    case <-t.C:
        // Got a tick. Channel is drained. Safe to Reset.
    case <-doSomething():
        // doSomething won. Channel might have a value or might not.
        if !t.Stop() {
            select {
            case <-t.C:
            default:
            }
        }
    }
    t.Reset(10 * time.Millisecond)
}
```

Now every path into `Reset` has a drained channel.

### Why the original `Reset` was even more dangerous

In versions of Go before 1.23, `Reset` was specified to be unsafe in the presence of any concurrent goroutine. Two goroutines were allowed to call `Reset` and `Stop` on the same `*Timer` only if the caller could prove that the channel was drained. The runtime did its best to handle racing calls, but the *user-visible* state of `t.C` could end up with phantom values.

Go 1.23 made `Reset` and `Stop` atomic with respect to the internal channel state, so the *runtime* no longer races. But your *user code* still has to drain `t.C` if you do not know whether the timer fired. That is a behavior of the channel, not the timer.

### A live example: connection write deadline as a timer

Suppose you are reimplementing a network deadline using `NewTimer`:

```go
func writeWithDeadline(c net.Conn, p []byte, d time.Duration) error {
    t := time.NewTimer(d)
    defer t.Stop()

    done := make(chan error, 1)
    go func() {
        _, err := c.Write(p)
        done <- err
    }()

    select {
    case err := <-done:
        return err
    case <-t.C:
        c.Close() // Abort the write.
        return errWriteTimeout
    }
}
```

If `done` wins (write finished in time), we leave the timer pending. The `defer t.Stop()` cleans it up. Good.

If we *also* wanted to retry after the deadline, naively we might write:

```go
for retries := 3; retries > 0; retries-- {
    select {
    case err := <-done:
        return err
    case <-t.C:
        // retry
    }
    t.Reset(d) // BUG: we did not drain if 'done' won.
}
```

Again, drain the channel only if necessary. The cleanest version sets the timer fresh each iteration:

```go
for retries := 3; retries > 0; retries-- {
    t := time.NewTimer(d)
    select {
    case err := <-done:
        t.Stop()
        return err
    case <-t.C:
        // retry
    }
}
```

This trades one allocation per retry for clarity. For three retries that is two extra allocations. Fine.

### The "always allocate" anti-pattern

You will see this in code reviews:

```go
for {
    t := time.NewTimer(d)
    select {
    case <-ch:
        t.Stop()
    case <-t.C:
    }
}
```

This is fine if the loop runs once per second. It is a bug if the loop runs ten thousand times per second and `<-ch` always wins, because every iteration allocates a `*time.Timer` and (pre-1.23) keeps it in the heap until `d` elapses. The next section explores that scenario.

---

## Re-Use vs Re-Allocate: Building a Hot-Path Timer

A reusable timer trades complexity (Stop + drain + Reset) for the avoidance of allocation per iteration. The trade-off matters when:

- The loop iterates fast (microsecond scale).
- The timer rarely wins (so allocating one per iteration is pure waste).
- Memory pressure is part of the SLO (latency-sensitive servers, large fanout systems).

### Benchmark: per-iteration allocation vs reuse

```go
package timerbench

import (
    "testing"
    "time"
)

func BenchmarkPerIterAllocate(b *testing.B) {
    ch := make(chan struct{}, 1)
    ch <- struct{}{} // pre-fill so the case wins
    for i := 0; i < b.N; i++ {
        ch <- struct{}{}
        t := time.NewTimer(time.Second)
        select {
        case <-ch:
            t.Stop()
        case <-t.C:
        }
    }
}

func BenchmarkReused(b *testing.B) {
    ch := make(chan struct{}, 1)
    t := time.NewTimer(time.Second)
    defer t.Stop()
    for i := 0; i < b.N; i++ {
        ch <- struct{}{}
        if !t.Stop() {
            select {
            case <-t.C:
            default:
            }
        }
        t.Reset(time.Second)
        select {
        case <-ch:
        case <-t.C:
        }
    }
}
```

On Go 1.22, the per-iteration version allocates roughly one `*time.Timer` per iteration plus accessory heap traffic. The reused version allocates zero per iteration after warmup. The exact numbers vary by hardware, but the gap is large enough that it shows up in production memory profiles.

### What "fast path wins" means in code

Most timer-driven loops are timeouts: the timer is meant to fire only when something else has gone wrong. So 99.9% of iterations take the non-timer branch.

```go
for {
    select {
    case msg := <-incoming:
        handle(msg)
    case <-time.After(idleTimeout): // bad
        cleanupAndExit()
        return
    }
}
```

If `incoming` is hot, this loop allocates a new `*time.Timer` for every message, even though the timer almost never fires. That is exactly the `time.After`-in-loop leak you read about at junior level.

The reused version:

```go
t := time.NewTimer(idleTimeout)
defer t.Stop()

for {
    if !t.Stop() {
        select {
        case <-t.C:
        default:
        }
    }
    t.Reset(idleTimeout)
    select {
    case msg := <-incoming:
        handle(msg)
    case <-t.C:
        cleanupAndExit()
        return
    }
}
```

Now there is exactly one `*time.Timer` for the lifetime of the loop.

### When **not** to optimise

If the loop runs once per second, or once per HTTP request, do not bother with the reusable pattern. The clarity of one `NewTimer` per iteration is worth the cheap allocation. Save the optimisation for hot paths that profile traces actually flag.

A rule of thumb: if `time.After` shows up in your `pprof -alloc_space` top list, it is time to refactor. If it does not, leave it alone.

---

## The `select { case <-time.After(d) }` Loop Leak

This is the canonical timer leak. We covered it at junior level. At middle level we want to recognise its *non-obvious* variants.

### Variant 1: explicit `time.After`

```go
for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-time.After(5 * time.Second):
        log.Println("idle")
    }
}
```

Recognisable. Fixable by replacing `time.After` with a reusable `NewTimer`.

### Variant 2: a helper that returns a channel

Sometimes the `time.After` is hidden inside a helper:

```go
func idleAfter(d time.Duration) <-chan time.Time {
    return time.After(d)
}

for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-idleAfter(5 * time.Second):
        log.Println("idle")
    }
}
```

Same leak. The `time.After` call still happens once per iteration and the timer is still unreferenced.

### Variant 3: chained selects

```go
for {
    msg, ok := receive(ch)
    if !ok {
        return
    }
    select {
    case out <- transform(msg):
    case <-time.After(writeTimeout):
        return errWriteTimeout
    }
}
```

The timer is fresh each iteration even though the loop is hot. The fix uses the same Stop/Reset pattern around the inner select.

### Variant 4: per-request RPC timeouts

```go
func Call(ctx context.Context, req *Request) (*Response, error) {
    resp := make(chan *Response, 1)
    go func() { resp <- doRPC(req) }()

    select {
    case r := <-resp:
        return r, nil
    case <-time.After(req.Timeout):
        return nil, errTimeout
    }
}
```

Looks fine — `Call` returns after one timer. But if your service handles 50 000 RPCs per second and most return within microseconds, you allocate 50 000 timers per second and let them sit in the heap for `req.Timeout`. At a 30-second timeout, that is 1.5 million pending timers in the heap. Pre-1.23, that is meaningful memory.

The fix is either:

- Use `context.WithTimeout`, which is what `context` was built for. The deadline is enforced by the runtime via a single internal timer per context, not per `select` arm.
- Or, if you really want a manual timer, use `NewTimer` + `Stop`.

```go
func Call(ctx context.Context, req *Request) (*Response, error) {
    ctx, cancel := context.WithTimeout(ctx, req.Timeout)
    defer cancel()

    resp := make(chan *Response, 1)
    go func() { resp <- doRPC(ctx, req) }()

    select {
    case r := <-resp:
        return r, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

`context.WithTimeout` internally calls `time.AfterFunc` once and `t.Stop()` in `cancel`. You get the same behaviour, but the `defer cancel()` guarantees cleanup whether or not the RPC finished.

### Variant 5: a "rate-limited" log

```go
var lastLog time.Time

func warn(msg string) {
    if time.Since(lastLog) < time.Second {
        return
    }
    lastLog = time.Now()
    log.Println(msg)
}

// ... called from a hot path ...
select {
case <-ch:
    warn("got value")
case <-time.After(timeout): // bug — fresh timer every call
    warn("idle")
}
```

The `warn` function is fine. The `time.After` is the leak. Same pattern, same fix.

### Recognising the leak in pprof

Run `pprof -alloc_space` on a service that has been up for a while:

```
$ go tool pprof -alloc_space http://localhost:6060/debug/pprof/heap
(pprof) top10
Showing nodes accounting for 4.21GB, 92.45% of 4.55GB total
Dropped 154 nodes (cum <= 22.74MB)
      flat  flat%   sum%        cum   cum%
    2.31GB 50.78% 50.78%     2.31GB 50.78%  time.NewTimer
    1.45GB 31.87% 82.65%     3.76GB 82.65%  time.After
   ...
```

`time.NewTimer` and `time.After` at the top of `-alloc_space` is the unambiguous fingerprint. Drill down with `list time.After` to see exactly which call sites contributed.

In `-inuse_space` the numbers depend heavily on the Go version. Pre-1.23, the same call sites also dominate inuse. In 1.23+ the inuse shows much less because the GC can reclaim un-stopped timers. But `-alloc_space` always tells the truth about how many timers you constructed.

### The `goleak`-style detection

`goleak` cannot directly tell you "you are leaking timers" — it tracks goroutines, not timers. But timer leaks often come with goroutine leaks (the goroutine waiting on `time.After` is still in the runtime's `Gwaiting` state). A growing `runtime.NumGoroutine` over time is a clue.

For unit tests, the simplest detector is:

```go
func TestNoTimerLeak(t *testing.T) {
    base := runtime.NumGoroutine()
    // Run code under test.
    runUnderTest()
    runtime.GC()
    runtime.GC() // twice, to ensure finalizers run
    time.Sleep(50 * time.Millisecond)
    if got := runtime.NumGoroutine(); got > base+1 {
        t.Fatalf("goroutine leak: started=%d, ended=%d", base, got)
    }
}
```

This will catch the most common timer-related leak: a goroutine parked on `<-time.After`. It will not catch a leaked `*time.Timer` whose channel nobody is reading, but those are rare in practice.

---

## The Phantom "default Saved Me" Myth

There is a folk wisdom in Go that adding `default:` to a `select` "fixes" the `time.After` leak. It does not. The myth comes from mixing up two different patterns.

### The myth

```go
for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-time.After(5 * time.Second):
        log.Println("idle")
    default:
        // The default saves us from leaking the timer.
        runtime.Gosched()
    }
}
```

The claim: because the `select` has a `default`, the `case <-time.After(...)` will not block, and therefore the timer "is not used" and "does not leak."

This is **wrong** for two reasons.

### Reason 1: `time.After(...)` is evaluated regardless

The expression `time.After(5 * time.Second)` is evaluated as part of building the select's case list. The runtime calls `time.After`, which allocates a `*time.Timer`, **before** the select decides which case wins. Adding `default` does not skip the evaluation of the other case expressions; it changes only which case is chosen if all of them would block.

In other words, the `time.After` allocation happens every iteration, default or no default. The timer is queued in the runtime heap. The timer fires 5 seconds later. The only thing `default` did was make the select return immediately, without reading from `t.C` or stopping the timer.

### Reason 2: with `default`, the timer is **more** orphaned, not less

In the non-`default` version, at least the eventual `<-time.After` read drains the channel and the runtime cleans up.

In the `default` version, the timer goes into the heap, fires after 5 seconds, sends one value into its buffered channel (`time.After`'s underlying channel has capacity 1), nobody reads from it ever, and the timer body sits in the heap until garbage collection picks it up.

Pre-Go 1.23, the GC could not pick it up until it had fired and been observed to be done. The body stayed alive for the full 5 seconds.

Go 1.23+ made unreferenced timers GC-collectible, so the body might be reclaimed sooner — but you still pay for the heap entry, the allocation, and the channel buffer until the runtime notices.

### Demonstration

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    for i := 0; i < 100_000; i++ {
        select {
        case <-time.After(5 * time.Minute):
        default:
        }
    }
    runtime.GC()

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("alloc: %d KiB\n", m.Alloc/1024)
    fmt.Printf("total alloc: %d KiB\n", m.TotalAlloc/1024)
}
```

`TotalAlloc` will be in the hundreds of megabytes range. That is the proof: even with `default`, every iteration allocated a `*time.Timer`. The `default` did not save anything.

### Why the myth exists

There is a *real* pattern where `default` is correct: the non-blocking drain we use after `Stop`:

```go
if !t.Stop() {
    select {
    case <-t.C:
    default:
    }
}
```

Here `default` is exactly right. It says "read a value if there is one, otherwise carry on." But this is *after* the timer has been stopped and there is no fresh allocation happening. It is a different situation from the loop case.

The folk wisdom probably grew from someone seeing the drain pattern and generalising it to "`default` makes timers safe." It does not.

### The correct fix is still a reusable timer

```go
t := time.NewTimer(5 * time.Second)
defer t.Stop()

for {
    if !t.Stop() {
        select {
        case <-t.C:
        default:
        }
    }
    t.Reset(5 * time.Second)

    select {
    case msg := <-ch:
        handle(msg)
    case <-t.C:
        log.Println("idle")
    }
}
```

If you actually wanted "do work if available, otherwise yield" with no timeout, drop the timer entirely:

```go
for {
    select {
    case msg := <-ch:
        handle(msg)
    default:
        runtime.Gosched()
    }
}
```

A `select` with `default` and no time-based case is fine. It is the combination of `time.After` *and* `default` that betrays misunderstanding.

---

## `AfterFunc` and Stop Race Conditions

`time.AfterFunc(d, f)` schedules `f` to run on its own goroutine after `d`. It returns a `*time.Timer`, so you can call `Stop()` to cancel. The catch is that `Stop` does not synchronise with `f` itself.

### The basic shape

```go
t := time.AfterFunc(d, func() {
    cleanup()
})

// ... later ...
if !t.Stop() {
    // The callback already started (or finished). cleanup() may or may not have completed.
}
```

`Stop` returns `false` if the callback has *already started running*. It does not wait for the callback to finish. That is the subtle bug: you might think `Stop` returning `false` means the callback is done, but it may still be in flight.

### A real race

```go
type Conn struct {
    mu       sync.Mutex
    closed   bool
    timer    *time.Timer
}

func (c *Conn) Close() {
    c.mu.Lock()
    c.closed = true
    c.mu.Unlock()
    if c.timer != nil {
        c.timer.Stop()
    }
}

func (c *Conn) StartHeartbeat() {
    c.timer = time.AfterFunc(30*time.Second, func() {
        c.mu.Lock()
        defer c.mu.Unlock()
        if c.closed {
            return
        }
        c.sendPing()
    })
}
```

Even though `Close` calls `Stop`, the callback may already be in `sendPing` by the time `Close` returns. The `closed` check inside the callback is the only thing that saves you — and it is correct here because the callback re-acquires `c.mu`.

If you skip the `closed` check inside the callback, you get a use-after-close. Tests will sometimes fail, sometimes pass. Race detector finds it if you are lucky.

### The synchronisation rule for `AfterFunc`

If your callback touches shared state, the callback *must* protect itself with the same lock that the outer code uses. `Stop` is best-effort. It tells you "the callback will not start *from here onwards*", not "the callback has finished."

If you need "definitely not running anymore", the canonical pattern is:

```go
type SafeTimer struct {
    timer *time.Timer
    wg    sync.WaitGroup
}

func NewSafeTimer(d time.Duration, f func()) *SafeTimer {
    st := &SafeTimer{}
    st.wg.Add(1)
    st.timer = time.AfterFunc(d, func() {
        defer st.wg.Done()
        f()
    })
    return st
}

func (st *SafeTimer) Stop() {
    if !st.timer.Stop() {
        // Callback already started; wait for it to finish.
        st.wg.Wait()
    } else {
        // Callback never ran; mark wg done.
        st.wg.Done()
    }
}
```

Now `Stop` waits for the callback if it had started. Note: this only works if `Stop` is called at most once.

### Leaks caused by callbacks holding state

`AfterFunc`'s callback is a closure. Anything captured by that closure is kept alive until the timer fires or is stopped. If your callback captures a `*Request` that the caller already finished with, that request lives for an extra `d` duration.

Multiply by a hot RPC server and you have a leak that does not show up as goroutines but does show up as `inuse_space` in pprof.

The fix is usually to capture only the bits you need:

```go
// Bad: captures the whole request.
time.AfterFunc(d, func() {
    if req.IsCancelled() {
        cleanup(req)
    }
})

// Better: capture just the cancellation signal.
done := req.Done()
id := req.ID
time.AfterFunc(d, func() {
    select {
    case <-done:
        cleanup(id)
    default:
    }
})
```

This is a tiny change, but at high volume it shrinks the live set noticeably.

### `AfterFunc` is rarely the right tool

In review, ask: would `context.WithTimeout` or a single goroutine with a `select` do the job? `AfterFunc` is appealing because it does not need a goroutine of its own to read a channel — but it makes synchronisation strictly harder. Use it for fire-and-forget cleanups that do not interact with anything else. For anything coordinated, use `NewTimer` and a `select`.

---

## `Ticker` Leaks and Misuse of `time.Tick`

A `*time.Ticker` is a recurring timer. It sends on `t.C` every `d`. You stop it with `t.Stop()`. If you do not, it ticks forever, and the runtime cannot reclaim the underlying timer until process exit.

### The forgotten `Stop`

```go
func runHeartbeat(server *Server) {
    t := time.NewTicker(time.Second)
    for {
        select {
        case <-t.C:
            server.Ping()
        case <-server.Done():
            return // BUG: forgot t.Stop()
        }
    }
}
```

The `return` exits the goroutine but leaves the ticker running. Every second, the runtime tries to deliver into `t.C`, which is buffered (capacity 1). Once the buffer fills, subsequent ticks are dropped — but the *ticker* keeps trying. The internal timer entry stays in the heap. Memory is pinned until process exit.

The fix is one line:

```go
func runHeartbeat(server *Server) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            server.Ping()
        case <-server.Done():
            return
        }
    }
}
```

`defer t.Stop()` is the same pattern as `defer f.Close()` for an open file. Make it muscle memory.

### Multiple exit points

If you have several places that can exit the loop, the `defer` covers all of them:

```go
func runHeartbeat(ctx context.Context, server *Server) error {
    t := time.NewTicker(time.Second)
    defer t.Stop()

    for {
        select {
        case <-t.C:
            if err := server.Ping(); err != nil {
                return err
            }
        case <-ctx.Done():
            return ctx.Err()
        case <-server.Done():
            return nil
        }
    }
}
```

One `defer`, three exits. The ticker stops in all cases.

### `time.Tick` is unstoppable

```go
for now := range time.Tick(time.Second) {
    log.Println("tick", now)
}
```

This is the textbook form. The `for range` loop reads from the channel `time.Tick` returns. Looks clean. But the *ticker* itself is never accessible, never stoppable, and never collectible. If the function returns, the ticker still fires every second for the rest of the process's life.

The godoc warning is explicit: `time.Tick` should be used only when you know the program will never need to stop the ticker. In practice, that means: **never use `time.Tick` outside `main` or top-level setup code.**

Bad:

```go
func (s *Service) Run() {
    for t := range time.Tick(time.Second) {
        s.process(t)
    }
}
```

If `s` is destroyed, `time.Tick` keeps firing forever.

Good:

```go
func (s *Service) Run(ctx context.Context) {
    tk := time.NewTicker(time.Second)
    defer tk.Stop()
    for {
        select {
        case t := <-tk.C:
            s.process(t)
        case <-ctx.Done():
            return
        }
    }
}
```

### Tickers with a subscriber that exits

A common architecture: one goroutine creates a `Ticker`, another goroutine reads from `t.C`. If the reader dies and the creator does not notice, the ticker still fires. The buffered channel fills up, ticks are dropped, but the ticker entry stays in the timer heap.

To survive this, *the goroutine that created the ticker should also be the goroutine that stops it*. Co-locate creation and cleanup.

### Diagnosing leaked tickers

`pprof -inuse_space` shows persistent allocations from `time.NewTicker`. The stack trace points at the line that created the leak. The fix is always the same: add a `Stop`.

A defensive habit: when you `grep -r "time.NewTicker" .` in your codebase, every result should have a `Stop` somewhere within ten lines below it. If it does not, you have a candidate leak.

---

## Per-Connection Deadlines vs Timers

In network code, timeouts come in two flavours:

1. **Deadlines** on the connection: `c.SetReadDeadline`, `c.SetWriteDeadline`.
2. **External timers** that race against the I/O via `select`.

Beginners often write the second when the first would do the job. The second tends to leak.

### Deadlines: in-kernel timeouts

```go
c.SetReadDeadline(time.Now().Add(5 * time.Second))
n, err := c.Read(p)
// err includes a deadline-exceeded indicator if the deadline elapsed.
```

Internally, the runtime arranges for the read to return `os.ErrDeadlineExceeded` (or `*net.OpError` containing it) after the deadline. There is no external timer goroutine. There is one runtime timer entry per connection, replaced each time you call `SetReadDeadline`.

When you `Close` the connection, the deadline timer is cancelled. No leak.

### External timers: goroutine + select

```go
done := make(chan error, 1)
go func() {
    _, err := c.Read(p)
    done <- err
}()

select {
case err := <-done:
    return err
case <-time.After(5 * time.Second):
    return errReadTimeout
}
```

Two problems:

- The goroutine continues to block in `c.Read` even after the timeout. If `c.Read` never returns (because the peer never sends and there is no deadline on the conn), that goroutine leaks forever.
- The `time.After` allocates a fresh timer per call.

Use deadlines:

```go
c.SetReadDeadline(time.Now().Add(5 * time.Second))
n, err := c.Read(p)
if err != nil {
    if errors.Is(err, os.ErrDeadlineExceeded) {
        return errReadTimeout
    }
    return err
}
```

No goroutine, no timer churn, no leak. The trade-off is that deadlines work only for I/O operations that respect them — `c.Read`, `c.Write`, the `net.Conn` interface. They do not help with arbitrary blocking operations (e.g., a `sync.Mutex.Lock` you would like to timeout).

### The lock-with-timeout antipattern

```go
done := make(chan struct{})
go func() {
    mu.Lock()
    close(done)
}()

select {
case <-done:
    defer mu.Unlock()
    // ... use the protected resource ...
case <-time.After(time.Second):
    // Timeout. But the goroutine is still trying to acquire the lock.
    // When it eventually does, nobody will Unlock.
}
```

Here both the goroutine and the timer leak. Once the lock is acquired by the orphan goroutine, the resource is permanently inaccessible. This is one of the most insidious bugs in concurrent Go.

The fix: do not put a timeout on a `sync.Mutex.Lock`. If you must timeout, use a channel-based mutex (a `chan struct{}` of capacity 1), where `Lock` is `<-ch` and `Unlock` is `ch <- struct{}{}`. Then `select { case <-ch: ; case <-timeout: }` gives you a real timeout without an orphaned goroutine.

```go
type lock chan struct{}

func newLock() lock {
    l := make(lock, 1)
    l <- struct{}{}
    return l
}

func (l lock) Lock()   { <-l }
func (l lock) Unlock() { l <- struct{}{} }

// Lock with timeout:
func (l lock) TryLockFor(d time.Duration) bool {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-l:
        return true
    case <-t.C:
        return false
    }
}
```

No leak. The select either acquires the lock or times out. If the timer wins, the lock channel was simply not read. The other goroutine holding the lock will eventually release it, and a future caller can acquire.

### A connection pool example

In a connection pool you often want "get me a conn within 100ms or fail." The channel-based pool is a natural fit:

```go
type Pool struct {
    free chan *Conn
}

func (p *Pool) Get(d time.Duration) (*Conn, error) {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case c := <-p.free:
        return c, nil
    case <-t.C:
        return nil, errPoolTimeout
    }
}
```

One reusable timer per call, stopped at return. The timer body is in the heap for the duration of the wait — at most `d` — which is fine because that is what `d` is for.

If `Get` is called in a hot loop:

```go
for {
    c, err := pool.Get(100 * time.Millisecond)
    if err != nil {
        return err
    }
    ...
}
```

The per-call `NewTimer` is one allocation per call. On Go 1.23 this is fast. On older Go, in a tight loop, you might reuse the timer:

```go
func (p *Pool) GetWithTimer(t *time.Timer, d time.Duration) (*Conn, error) {
    resetTimer(t, d)
    select {
    case c := <-p.free:
        // We have a connection. Stop the timer.
        if !t.Stop() {
            select {
            case <-t.C:
            default:
            }
        }
        return c, nil
    case <-t.C:
        return nil, errPoolTimeout
    }
}
```

Callers reuse a single `*time.Timer` across many `GetWithTimer` calls. Allocations drop to zero. Worth it only if the profile shows `NewTimer` in the top contributors.

---

## Testing Timer-Heavy Code

Code that depends on real time is hard to test deterministically. Two common approaches:

1. **Inject a `Clock` interface.** The production clock returns `time.Now()` and `time.NewTimer`. The test clock returns a manually advanced now and a fake timer.
2. **Run with very short durations** (microseconds) so wall-clock variance is irrelevant.

### Clock interface

```go
type Clock interface {
    Now() time.Time
    NewTimer(d time.Duration) Timer
}

type Timer interface {
    Chan() <-chan time.Time
    Stop() bool
    Reset(d time.Duration) bool
}

type realClock struct{}

func (realClock) Now() time.Time            { return time.Now() }
func (realClock) NewTimer(d time.Duration) Timer { return realTimer{time.NewTimer(d)} }

type realTimer struct{ *time.Timer }

func (r realTimer) Chan() <-chan time.Time { return r.C }
```

Production code accepts a `Clock`. Tests pass a fake clock whose `NewTimer` returns a fake timer with a manually controlled channel.

### Fake clock

```go
type fakeClock struct {
    mu  sync.Mutex
    now time.Time
    timers []*fakeTimer
}

func (c *fakeClock) Now() time.Time {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.now
}

func (c *fakeClock) NewTimer(d time.Duration) Timer {
    c.mu.Lock()
    defer c.mu.Unlock()
    t := &fakeTimer{
        ch:    make(chan time.Time, 1),
        fires: c.now.Add(d),
    }
    c.timers = append(c.timers, t)
    return t
}

func (c *fakeClock) Advance(d time.Duration) {
    c.mu.Lock()
    c.now = c.now.Add(d)
    fires := c.now
    var toFire []*fakeTimer
    var keep []*fakeTimer
    for _, t := range c.timers {
        if !t.stopped && !fires.Before(t.fires) {
            toFire = append(toFire, t)
        } else {
            keep = append(keep, t)
        }
    }
    c.timers = keep
    c.mu.Unlock()
    for _, t := range toFire {
        select {
        case t.ch <- fires:
        default:
        }
    }
}

type fakeTimer struct {
    ch      chan time.Time
    fires   time.Time
    stopped bool
}

func (t *fakeTimer) Chan() <-chan time.Time { return t.ch }
func (t *fakeTimer) Stop() bool {
    if t.stopped {
        return false
    }
    t.stopped = true
    return true
}
func (t *fakeTimer) Reset(d time.Duration) bool { /* ... */ return false }
```

Now a test can:

```go
func TestIdleTimeout(t *testing.T) {
    clock := &fakeClock{now: time.Unix(0, 0)}
    s := NewServer(clock)
    go s.Run()

    clock.Advance(5 * time.Second)
    if !s.WasMarkedIdle() {
        t.Fatal("expected idle after 5s")
    }
}
```

No real sleeping. No flakiness.

### Short real durations

For simple cases:

```go
func TestIdleTimeoutFast(t *testing.T) {
    s := NewServer()
    s.idleTimeout = 10 * time.Millisecond
    go s.Run()

    time.Sleep(50 * time.Millisecond)
    if !s.WasMarkedIdle() {
        t.Fatal("expected idle after 10ms")
    }
}
```

Simpler but slower and flakier under CI load. Good for smoke tests, not for tight assertions.

### `goleak` for goroutine leaks

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

This catches goroutines that did not exit by the end of the test. If your timer code leaks a goroutine (the most common symptom of a timer leak), goleak will fail the test.

For finer control:

```go
func TestRun(t *testing.T) {
    defer goleak.VerifyNone(t)
    s := NewServer()
    s.Run(time.Millisecond)
    s.Close()
}
```

If `Close` does not stop the ticker, goleak reports the goroutine that is parked on the ticker channel.

---

## Detection Cheatsheet

A printable checklist for production:

### Symptoms

- `RSS` of the process grows monotonically over hours.
- `runtime.MemStats.HeapAlloc` grows but does not free between GCs.
- `runtime.NumGoroutine()` grows over time.
- pprof `/debug/pprof/goroutine?debug=2` shows many goroutines parked in `time.Tick`, `time.After`, `time.NewTimer`.

### Commands

```bash
# Goroutine stack dump
curl -s localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt
grep -c "time.After\|time.Tick\|time.NewTimer" goroutines.txt

# Heap profile, by allocation count (catches "made too many")
go tool pprof -alloc_space http://localhost:6060/debug/pprof/heap
(pprof) top time
(pprof) list time.After

# Heap profile, by in-use bytes
go tool pprof -inuse_space http://localhost:6060/debug/pprof/heap
(pprof) top time
```

### Runtime tracepoints

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
defer f.Close()
trace.Start(f)
defer trace.Stop()

// run service under load
```

Then `go tool trace trace.out` and look at the "Goroutines" and "Syscall" panes. Timer-related goroutines show up as long parked spans.

### `runtime.MemStats` watchpoints

```go
go func() {
    t := time.NewTicker(time.Minute)
    defer t.Stop()
    for range t.C {
        var m runtime.MemStats
        runtime.ReadMemStats(&m)
        log.Printf("alloc=%dMB sys=%dMB goroutines=%d",
            m.HeapAlloc>>20, m.Sys>>20, runtime.NumGoroutine())
    }
}()
```

Plot `alloc` and `goroutines` over time. Trend up means leak.

### Quick triage decision tree

1. Is `runtime.NumGoroutine` rising?
   - Yes → look for parked goroutines on `time.After` / `Tick` / `NewTimer`.
   - No → look at pprof `-alloc_space`.
2. Is `time.After` or `time.NewTimer` in pprof top?
   - Yes → find the call site in a loop. Replace with reusable timer.
   - No → not a timer leak. Look elsewhere.
3. Is `time.NewTicker` in pprof inuse?
   - Yes → find the `NewTicker` call. Check `defer t.Stop()` exists on every code path.
   - No → check `time.Tick`. If used outside `main`, replace with `NewTicker`.

---

## Refactor Walkthroughs

Three before/after refactors at increasing scale.

### Refactor 1: a chat server's read loop

#### Before

```go
func (c *Client) readLoop() {
    for {
        select {
        case <-c.done:
            return
        case msg := <-c.in:
            c.handle(msg)
        case <-time.After(c.idleTimeout):
            c.markIdle()
            return
        }
    }
}
```

Allocation per iteration. In a busy chat server with 10 000 concurrent clients each receiving messages at 5 per second, that is 50 000 timers per second.

#### After

```go
func (c *Client) readLoop() {
    t := time.NewTimer(c.idleTimeout)
    defer t.Stop()
    for {
        if !t.Stop() {
            select {
            case <-t.C:
            default:
            }
        }
        t.Reset(c.idleTimeout)
        select {
        case <-c.done:
            return
        case msg := <-c.in:
            c.handle(msg)
        case <-t.C:
            c.markIdle()
            return
        }
    }
}
```

One timer per client for the lifetime of the connection.

#### Result (synthetic numbers)

| Metric | Before | After |
|---|---|---|
| Allocs/sec (`pprof -alloc_space`) | 50 000/s | 0/s steady state |
| Active runtime timers | ~5 000 | 10 000 (one per client, stable) |
| HeapAlloc trend over 1h | +200 MB | flat |

The "active timers" number actually went up — because every client now keeps a single timer permanently. That is correct and desired. What changed is the *allocation rate* and the *retention time of completed timers*.

### Refactor 2: a sweeper goroutine

#### Before

```go
func (s *Store) sweep(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-time.Tick(s.sweepInterval): // bug: time.Tick
            s.removeExpired()
        }
    }
}
```

The `time.Tick` creates a *new* ticker each iteration of the `select`. Worse than `time.After`, because every leaked ticker keeps firing forever.

Wait, does it actually? Let us be precise. `time.Tick` returns a `<-chan Time` that ticks forever. The `select` evaluates `time.Tick(s.sweepInterval)` each time the select is reached — every iteration of the `for` loop. Each evaluation creates a fresh `*time.Ticker` whose channel is wired to the `select` arm. The previous ticker is unreferenced — but unlike `*Timer`, a `*Ticker` keeps trying to fire forever, holding the channel reference until process exit.

So: yes, this leak grows without bound. Every loop iteration creates a new leaked ticker.

#### After

```go
func (s *Store) sweep(ctx context.Context) {
    t := time.NewTicker(s.sweepInterval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            s.removeExpired()
        }
    }
}
```

One `*Ticker`, stopped on exit.

### Refactor 3: per-request timeout in an HTTP handler

#### Before

```go
func (h *Handler) HandleRequest(w http.ResponseWriter, r *http.Request) {
    done := make(chan *Response, 1)
    go func() {
        done <- h.backend.Call(r.Context(), r)
    }()
    select {
    case resp := <-done:
        respond(w, resp)
    case <-time.After(2 * time.Second):
        http.Error(w, "timeout", http.StatusGatewayTimeout)
    }
}
```

`time.After` fires a fresh timer per request. If the handler is hit at 10 000 req/s with most requests completing in under 100ms, you have 10 000 unfinished `*time.Timer` objects in the heap with `2 - elapsed` seconds to live. Pre-1.23 that is a measurable retention.

Also: when the timeout fires, the goroutine spawned for the backend call may still be running. It will eventually deliver into `done`, which is buffered (capacity 1), so it does not block — but it does consume a goroutine for the duration of the backend call.

#### After

```go
func (h *Handler) HandleRequest(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
    defer cancel()

    resp, err := h.backend.Call(ctx, r)
    if err != nil {
        if errors.Is(err, context.DeadlineExceeded) {
            http.Error(w, "timeout", http.StatusGatewayTimeout)
            return
        }
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    respond(w, resp)
}
```

`context.WithTimeout` schedules a single `AfterFunc`-style timer per call, stopped by `defer cancel()`. The backend respects the context (it should), so when the timeout fires, the call is cancelled in place — no orphaned goroutine.

The win:

- One timer per request, but stopped immediately on success.
- No orphan goroutine.
- Cancellation propagates through to downstream calls.

---

## Self-Assessment

Answer these without looking back at the text. If you cannot, re-read the relevant section.

1. What does `Timer.Stop()` return when the timer has already fired?
2. After `Stop()` returns `false`, what must you do before `Reset`?
3. Why does adding `default:` to a `select` containing `<-time.After(d)` not prevent a leak?
4. What is the difference between `time.After(d)` and `time.NewTimer(d).C`?
5. Why is `time.Tick(d)` unsafe in long-running code?
6. What is the typical fingerprint of a `time.After`-in-loop leak in `pprof -alloc_space`?
7. Why is `defer t.Stop()` recommended even when the timer is expected to fire?
8. When `time.AfterFunc(d, f)` returns and you later call `t.Stop()` that returns `false`, what does that mean about `f`?
9. How does `context.WithTimeout` avoid the per-call timer allocation cost compared to `<-time.After(d)` in a select?
10. In a fake-clock test harness, what is the role of the `Advance` method?

Bonus thinking exercise: a colleague proposes "let us put `time.After(time.Hour)` in our worker `select` as a `keepalive` — it does nothing 99.99% of the time, what is the harm?" What do you say?

Answer hint: it is one timer per worker per iteration, allocated and dropped. If the worker iterates 1 000 times per second, that is 1 000 timers per second allocated, sitting in the heap for an hour each. That is 3.6 million live timers. Replace with a single `NewTicker` of one hour, or a single reusable `NewTimer` reset each iteration.

---

## Summary

You should now be able to:

- Choose between `Sleep`, `After`, `NewTimer`, `AfterFunc`, `NewTicker`, and `Tick` based on the situation.
- Write the `Stop` + drain + `Reset` pattern from memory.
- Spot a `time.After` in a loop in code review and propose the reusable-timer rewrite.
- Refute the `default`-saves-me myth with a specific demonstration.
- Replace `time.Tick` with `time.NewTicker` everywhere outside `main`.
- Diagnose timer leaks using pprof, `runtime.MemStats`, and goroutine dumps.

The senior page goes one level deeper: how the runtime timer heap pinned memory before Go 1.23, what changed in 1.23, how to read a timer-heavy heap profile, and what the runtime trace shows during a timer storm.

---

## Further Reading

- Standard library docs: [`time.Timer`](https://pkg.go.dev/time#Timer), [`time.Ticker`](https://pkg.go.dev/time#Ticker).
- Runtime trace tutorial: [`runtime/trace`](https://pkg.go.dev/runtime/trace).
- pprof tutorial: [`net/http/pprof`](https://pkg.go.dev/net/http/pprof).
- Go 1.23 release notes section on timers.

---

## Appendix A: Full Cheat Sheet

| Situation | Right tool |
|---|---|
| One-off timeout, called rarely | `time.After` or `context.WithTimeout` |
| One-off timeout in a hot loop | `time.NewTimer` + Stop/drain/Reset, or `context.WithTimeout` |
| Recurring periodic task | `time.NewTicker` + `defer t.Stop()` |
| Recurring periodic task in `main` only | `time.Tick` is acceptable but `NewTicker` is clearer |
| Fire-and-forget callback | `time.AfterFunc`, with synchronisation discipline |
| Per-connection I/O timeout | `c.SetReadDeadline` / `c.SetWriteDeadline` |
| Lock with timeout | channel-based mutex + `select` |
| Per-request RPC timeout | `context.WithTimeout` |

---

## Appendix B: Common `pprof` Snippets

```bash
# How many timers exist right now?
curl -s localhost:6060/debug/pprof/goroutine?debug=2 \
  | grep -c '^goroutine .* \[chan receive\]:$\|^goroutine .* \[select\]:$'

# How many goroutines are parked on time.After?
curl -s localhost:6060/debug/pprof/goroutine?debug=2 \
  | grep -A 5 '^goroutine ' \
  | grep -c 'time.After'

# Live allocation by call site:
go tool pprof -alloc_objects -focus=time \
  http://localhost:6060/debug/pprof/heap
```

---

## Appendix C: A Reusable-Timer Mini Library

For services that have many timer-heavy loops, factor the discipline into a small helper:

```go
package safetimer

import "time"

// Timer is a wrapper that hides the Stop/drain/Reset dance.
type Timer struct {
    t *time.Timer
}

// New creates a Timer that will fire after d.
func New(d time.Duration) *Timer {
    return &Timer{t: time.NewTimer(d)}
}

// C returns the channel that fires when the timer expires.
func (s *Timer) C() <-chan time.Time { return s.t.C }

// ResetSafely cancels the underlying timer, drains the channel if necessary,
// and resets it to the new duration.
func (s *Timer) ResetSafely(d time.Duration) {
    if !s.t.Stop() {
        select {
        case <-s.t.C:
        default:
        }
    }
    s.t.Reset(d)
}

// Stop cancels the timer. Safe to call multiple times.
func (s *Timer) Stop() {
    s.t.Stop()
}
```

Usage:

```go
t := safetimer.New(timeout)
defer t.Stop()

for {
    t.ResetSafely(timeout)
    select {
    case msg := <-in:
        handle(msg)
    case <-t.C():
        return errTimeout
    }
}
```

The library is tiny but the discipline it imposes is what catches reviewer mistakes.

---

## Appendix D: Anti-Pattern Catalogue

A bestiary of patterns to recognise in code review.

### 1. `time.After` in a hot select

```go
select {
case msg := <-ch:
case <-time.After(d):
}
```

Fix: reusable `NewTimer`.

### 2. `time.Tick` outside `main`

```go
for now := range time.Tick(d) { ... }
```

Fix: `NewTicker` + `defer Stop`.

### 3. `Reset` without drain

```go
select { case <-ch: case <-t.C: }
t.Reset(d) // bug
```

Fix: drain `t.C` if `<-ch` won.

### 4. `Stop` without `defer`

```go
t := time.NewTimer(d)
// ... long function ...
t.Stop() // BUG: never reached on early return
```

Fix: `defer t.Stop()` immediately after creation.

### 5. `AfterFunc` that captures the world

```go
time.AfterFunc(d, func() { cleanup(req) }) // req kept alive for d
```

Fix: capture only the minimum needed.

### 6. Lock with `time.After` timeout

```go
go func() { mu.Lock(); close(done) }()
select { case <-done: case <-time.After(d): }
```

Fix: channel-based mutex.

### 7. Background ticker tied to a long-lived goroutine that exits

```go
go func() {
    t := time.NewTicker(d)
    for {
        select {
        case <-t.C: work()
        case <-done: return // bug: forgot t.Stop()
        }
    }
}()
```

Fix: `defer t.Stop()` inside the goroutine.

### 8. `time.After` with `default:` "for safety"

```go
select {
case msg := <-ch:
case <-time.After(d):
default:
}
```

Fix: remove `time.After` or remove `default`. They do not belong together.

### 9. Per-request `time.After` instead of `context.WithTimeout`

```go
select {
case resp := <-done:
case <-time.After(req.Timeout):
}
```

Fix: `context.WithTimeout` + check `ctx.Err()`.

### 10. Reusing a timer across goroutines without synchronisation

```go
t := time.NewTimer(d)
go func() { t.Reset(d2) }() // race
go func() { <-t.C }()
```

Fix: each goroutine owns its own timer, or coordinate via channel-of-deadlines.

---

## Appendix E: Tying It Back to `context.Context`

A frequent question: "Why does `context.WithTimeout` not have the same problems?"

`context.WithTimeout` internally uses `time.AfterFunc`. The callback marks the context done and closes its `Done()` channel. The crucial detail: **`cancel()` always calls `t.Stop()` on the internal timer.** And the canonical usage pattern is `defer cancel()`.

So when you write:

```go
ctx, cancel := context.WithTimeout(parent, d)
defer cancel()
```

You are guaranteed that:

- Exactly one runtime timer is allocated.
- If the work finishes before `d`, `cancel()` stops the timer immediately.
- If `d` elapses first, the timer fires, then `cancel()` runs but is a no-op for the timer (the callback has already completed).

In neither case does the timer leak.

That is why `context.WithTimeout` is the recommended pattern for per-call timeouts: the discipline is baked into the API. You only need to remember `defer cancel()`. The compiler will not enforce it, but `go vet` and several lint rules will.

If you are tempted to write `select { case <-ch: case <-time.After(d): }` and `ch` is something that can be cancelled, the cleaner version is almost always:

```go
ctx, cancel := context.WithTimeout(ctx, d)
defer cancel()
select {
case v := <-ch:
case <-ctx.Done():
}
```

This works because `ctx.Done()` is itself a channel that closes when the timer fires. From the caller's point of view, you read a channel, just like `time.After`. From the runtime's point of view, the timer is owned by the context and lives only as long as `cancel` says.

---

## Appendix F: Worked Example — Idle Connection Sweeper

Putting many of the techniques together, here is a complete sweeper that:

- Maintains a map of `connID → lastActivity`.
- Sweeps idle connections every minute.
- Tears down a connection that has been idle for more than `idleTimeout`.
- Stops cleanly when context is cancelled.
- Allocates one timer for the lifetime of the sweeper.

```go
package server

import (
    "context"
    "sync"
    "time"
)

type Conn struct {
    ID           string
    LastActivity time.Time
    closer       func() error
}

type Sweeper struct {
    mu          sync.Mutex
    conns       map[string]*Conn
    idleTimeout time.Duration
    sweepEvery  time.Duration
}

func NewSweeper(idleTimeout, sweepEvery time.Duration) *Sweeper {
    return &Sweeper{
        conns:       make(map[string]*Conn),
        idleTimeout: idleTimeout,
        sweepEvery:  sweepEvery,
    }
}

func (s *Sweeper) Register(c *Conn) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.conns[c.ID] = c
}

func (s *Sweeper) Unregister(id string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    delete(s.conns, id)
}

func (s *Sweeper) Touch(id string, now time.Time) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if c, ok := s.conns[id]; ok {
        c.LastActivity = now
    }
}

func (s *Sweeper) Run(ctx context.Context) error {
    t := time.NewTicker(s.sweepEvery)
    defer t.Stop()

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            s.sweep(now)
        }
    }
}

func (s *Sweeper) sweep(now time.Time) {
    cutoff := now.Add(-s.idleTimeout)
    s.mu.Lock()
    var toClose []*Conn
    for _, c := range s.conns {
        if c.LastActivity.Before(cutoff) {
            toClose = append(toClose, c)
            delete(s.conns, c.ID)
        }
    }
    s.mu.Unlock()
    for _, c := range toClose {
        _ = c.closer()
    }
}
```

Observations:

- One `*Ticker` for the sweeper's lifetime. `defer t.Stop()` covers all exits.
- The sweep loop is fully cancellable via `ctx`.
- We do not call `time.After` anywhere.
- We do not call `time.Tick` anywhere.
- We hold no `AfterFunc` callbacks.

This is the shape of leak-free time-driven code.

---

## Appendix G: Reading List Across the Track

If you reached the bottom of this page, you are ready for:

- **The senior page on this topic**: the runtime timer heap, the pre-1.23 retention rules, what changed in 1.23, and how to read the relevant pprof / trace data.
- **`07-concurrency/16-time-based-concurrency/02-tickers`**: ticker-specific corner cases.
- **`07-concurrency/16-time-based-concurrency/04-context-deadlines`**: how context cancellations layer on top of timers.

The pattern is the same throughout: time is a resource, the runtime tracks it in a finite heap, and your discipline is to keep that heap from filling up with forgotten work.

---

## Appendix H: A 60-Second Code Review Routine

When you review a PR that touches time-related code, run through this in order:

1. **Search for `time.After`.** Each occurrence in a loop is a candidate leak. Each occurrence outside a loop is probably fine.
2. **Search for `time.Tick`.** Anything outside `main` is a candidate leak.
3. **Search for `time.NewTimer`.** Check for `defer t.Stop()` within ten lines of each.
4. **Search for `time.NewTicker`.** Same check.
5. **Search for `Reset(`.** Confirm the drain pattern precedes each call.
6. **Search for `AfterFunc`.** Confirm the callback's captures are minimal and synchronised.

This takes about a minute on a normal PR. It catches the overwhelming majority of timer issues you would otherwise discover in production.

---

## Appendix I: Frequently Asked Questions

**Q: Is `time.After` ever fine?**

Yes. In top-level code that runs once or in tests, `time.After` is idiomatic. It is only a leak when used in loops or hot paths.

**Q: I have read that Go 1.23 fixed the timer leak. Can I stop worrying?**

Partially. Go 1.23 allows unreferenced timers to be garbage collected before they fire, which removes the worst form of retention. But:

- You still allocate a `*time.Timer` per call. Allocation pressure is still real.
- Your code may run on older Go versions in some environments.
- The Go 1.23 change does not help with `*Ticker` — those still need `Stop`.
- Goroutines parked on `<-time.After` still exist until the timer fires, leak or no.

So: the leak is *less expensive* on 1.23+, but the pattern is still bad.

**Q: How do I find the call site that is leaking timers?**

`go tool pprof -alloc_space` → `top time.After`/`time.NewTimer` → `list <function>`. The `list` view shows you exact lines with allocation counts.

**Q: Can I write `t := time.NewTimer(0); <-t.C` to "yield"?**

Technically yes, but `runtime.Gosched()` is the idiomatic yield. The timer version allocates and runs the runtime timer machinery; `Gosched` just rescheduled. No timer, no leak risk.

**Q: Does `select { case <-time.After(0): }` block?**

No. The timer fires immediately. But you still allocated one.

**Q: Why not use a `sync.Pool` of `*time.Timer`s?**

You can, but the API is awkward (you have to Stop before returning to the pool, drain on retrieval, etc.). For hot paths, a single per-goroutine timer is usually simpler and faster than a pool.

**Q: Does `context.WithDeadline` differ from `context.WithTimeout`?**

`WithTimeout(parent, d)` is `WithDeadline(parent, time.Now().Add(d))`. Same internals.

**Q: Is `time.NewTimer` thread-safe?**

The `Stop` and `Reset` methods are documented to be safe for use only by a single goroutine. Cross-goroutine `Reset` calls without external synchronisation are racy.

**Q: Are tickers thread-safe?**

`Ticker.Stop` is documented as safe to call concurrently. Reading from `t.C` is fan-out friendly: any number of goroutines can read, the channel delivers to one of them per tick.

**Q: Should I worry about timer leaks in tests?**

Yes — they slow CI down and pollute coverage. Use `goleak` to catch them. Tests that leak goroutines on `time.After` or `time.Tick` will fail with goleak enabled.

**Q: Can a leaked timer crash my process?**

Indirectly. A million leaked timers consume memory and CPU (the runtime walks the timer heap on every scheduling decision). If you leak enough, you OOM. Modern Go with the 1.23 changes makes this harder, but not impossible.

---

## Appendix J: Glossary

- **Timer heap**: a per-P runtime data structure that orders pending timers by fire time. The runtime checks the heap when scheduling goroutines.
- **`*time.Timer`**: a user-visible handle for a single one-shot timer.
- **`*time.Ticker`**: a user-visible handle for a recurring timer.
- **Drain**: read all queued values from a channel until it is empty (typically using `select` with `default`).
- **Stop**: ask the runtime to remove a pending timer from the heap.
- **Reset**: change a timer's fire time. Safe only if the channel is drained.
- **Pinned memory**: memory that the GC cannot reclaim because some live reference holds it. The pre-1.23 timer heap held implicit references to timer bodies, pinning them.
- **`AfterFunc` callback**: the function passed to `time.AfterFunc`, run on its own goroutine after the duration elapses.

---

## Appendix K: One-Slide Takeaways

If you read nothing else:

1. `time.After` in a loop is a leak. Use a reusable `NewTimer`.
2. `time.Tick` outside `main` is a leak. Use `NewTicker` + `defer Stop`.
3. `Stop` + drain + `Reset` is the correct shape for reusing a timer.
4. `default:` does not fix a `time.After` leak.
5. For per-call timeouts, prefer `context.WithTimeout`.
6. `AfterFunc` callbacks need synchronisation — `Stop` is best-effort.
7. Network I/O has its own deadlines — use them instead of external timers.
8. pprof `-alloc_space` and `runtime.NumGoroutine` are your detection tools.

That is the entire middle-level mental model. The next page goes inside the runtime.

---

## Appendix L: Extended Case Studies

The earlier refactor walkthroughs were stylised. Here we work through three more realistic scenarios drawn from common production architectures: an outbound HTTP client with retries, a queue consumer that batches by time-or-count, and a session-store that expires idle sessions. Each case starts from a working but leaky implementation and ends at a leak-free version, with notes about what would show up in observability data along the way.

### Case Study 1: HTTP client with exponential backoff and retry

A common helper in microservice code calls a downstream service with exponential backoff. Each retry sleeps for a slightly longer duration. The original implementation tends to look like this:

```go
func CallWithRetry(ctx context.Context, do func(context.Context) error) error {
    backoff := 100 * time.Millisecond
    for attempt := 0; attempt < 5; attempt++ {
        err := do(ctx)
        if err == nil {
            return nil
        }
        if !isRetryable(err) {
            return err
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(backoff):
        }
        backoff *= 2
    }
    return errMaxRetries
}
```

This is *almost* fine because the loop only runs at most five times. The `time.After` allocates five timers worst case. Five extra timers in the heap is not a leak.

The bug appears when this function is called from a hot loop, or when the retry helper is wrapped in a fan-out:

```go
for _, item := range items {
    go func(item Item) {
        _ = CallWithRetry(ctx, func(ctx context.Context) error {
            return doRequest(ctx, item)
        })
    }(item)
}
```

If `items` has 10 000 entries and most of them fail twice before succeeding, you allocate roughly 20 000 `*time.Timer` instances over a short period. Many of them will fire before they would have been collected. Pre-1.23 that is a measurable retention. Post-1.23 it is allocation pressure that the GC has to absorb.

A cleaner version uses `context.WithTimeout` for the sleep:

```go
func CallWithRetry(ctx context.Context, do func(context.Context) error) error {
    backoff := 100 * time.Millisecond
    for attempt := 0; attempt < 5; attempt++ {
        err := do(ctx)
        if err == nil {
            return nil
        }
        if !isRetryable(err) {
            return err
        }
        if err := sleep(ctx, backoff); err != nil {
            return err
        }
        backoff *= 2
    }
    return errMaxRetries
}

func sleep(ctx context.Context, d time.Duration) error {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-t.C:
        return nil
    }
}
```

Now each `sleep` allocates exactly one timer, stops it on cancel, and the helper is reusable across the codebase. The allocation count is the same in steady state (five per call), but every timer has a `defer Stop` to ensure it leaves the runtime heap as soon as possible.

Compare to using `context.WithTimeout`:

```go
func sleep(ctx context.Context, d time.Duration) error {
    ctx, cancel := context.WithTimeout(ctx, d)
    defer cancel()
    <-ctx.Done()
    if ctx.Err() == context.DeadlineExceeded {
        return nil // we slept full duration
    }
    return ctx.Err() // cancelled
}
```

This is also correct, but slightly more confusing because we are using "deadline reached" to mean "slept successfully." The `NewTimer` version is more readable for the `sleep` use case.

#### What you would see in observability

Before the fix, in a benchmark that hammers `CallWithRetry`:

```
go test -bench=. -benchmem
BenchmarkCallWithRetry-8   500000   2410 ns/op   312 B/op   8 allocs/op
```

After the fix:

```
BenchmarkCallWithRetry-8   500000   2350 ns/op   240 B/op   5 allocs/op
```

Small reduction per call, but at high QPS it adds up: 3 allocations per call times 50 000 QPS is 150 000 fewer allocations per second.

### Case Study 2: Queue consumer with time-or-count batching

A common pattern: read messages from a channel, batch them, flush either when the batch reaches a size threshold or after a maximum age. The naive implementation:

```go
func consumer(in <-chan Msg, flush func([]Msg)) {
    var batch []Msg
    maxAge := 100 * time.Millisecond
    maxSize := 1000
    for {
        select {
        case m := <-in:
            batch = append(batch, m)
            if len(batch) >= maxSize {
                flush(batch)
                batch = nil
            }
        case <-time.After(maxAge):
            if len(batch) > 0 {
                flush(batch)
                batch = nil
            }
        }
    }
}
```

Two problems:

1. The `time.After` allocates per iteration. Every time we receive a message, we drop the previous timer and create a new one.
2. The semantics are wrong: `time.After(maxAge)` restarts on every `select`, so the *age of the oldest message in the batch* is not what is being measured. If messages arrive every 50ms forever, the timer never fires and the batch never flushes by time.

The correct semantics use a timer that starts when the batch becomes non-empty and is stopped when the batch is flushed:

```go
func consumer(in <-chan Msg, flush func([]Msg)) {
    var batch []Msg
    maxAge := 100 * time.Millisecond
    maxSize := 1000

    t := time.NewTimer(time.Hour) // dummy, immediately stopped
    if !t.Stop() {
        <-t.C
    }
    defer t.Stop()
    timerActive := false

    doFlush := func() {
        if len(batch) > 0 {
            flush(batch)
            batch = nil
        }
        if timerActive {
            if !t.Stop() {
                select {
                case <-t.C:
                default:
                }
            }
            timerActive = false
        }
    }

    for {
        select {
        case m, ok := <-in:
            if !ok {
                doFlush()
                return
            }
            batch = append(batch, m)
            if !timerActive {
                t.Reset(maxAge)
                timerActive = true
            }
            if len(batch) >= maxSize {
                doFlush()
            }
        case <-t.C:
            timerActive = false
            doFlush()
        }
    }
}
```

Now:

- One `*Timer` for the lifetime of the consumer.
- The timer is only running when the batch is non-empty. When it fires, the batch is flushed.
- When a flush is triggered by size, the timer is stopped properly.
- No `time.After`.

The `timerActive` boolean is a clarity feature, not a correctness one — without it, the Stop+drain dance would still work, but the code would be harder to read.

### Case Study 3: Session store with idle expiry

Web frameworks often expire sessions after a period of inactivity. A common naive implementation uses `AfterFunc` per session:

```go
type Session struct {
    ID    string
    Data  map[string]any
    timer *time.Timer
}

func (s *Store) CreateSession() *Session {
    sess := &Session{ID: newID(), Data: map[string]any{}}
    sess.timer = time.AfterFunc(s.idleTimeout, func() {
        s.expire(sess.ID)
    })
    return sess
}

func (s *Store) Touch(id string) {
    s.mu.RLock()
    sess, ok := s.sessions[id]
    s.mu.RUnlock()
    if !ok {
        return
    }
    if !sess.timer.Stop() {
        select {
        case <-sess.timer.C:
        default:
        }
    }
    sess.timer.Reset(s.idleTimeout)
}
```

Wait — `time.AfterFunc` returns a `*Timer` but its channel `C` is `nil` (callbacks do not use a channel). The `Touch` code that drains `sess.timer.C` reading from a `nil` channel will block forever in the `select` if there is no `default`. With `default` it is a no-op. So the drain is unnecessary for `AfterFunc` timers, but it does not hurt.

The real issue is different: per-session timers scale poorly. If you have a million sessions, you have a million entries in the runtime timer heap. Each `Touch` does a heap operation. The runtime is good at this, but at very high cardinality it becomes a hotspot.

A common alternative is a single sweeper that periodically scans for expired sessions:

```go
type Store struct {
    mu          sync.Mutex
    sessions    map[string]*Session
    idleTimeout time.Duration
    sweepEvery  time.Duration
}

type Session struct {
    ID           string
    Data         map[string]any
    LastTouched  time.Time
}

func (s *Store) Touch(id string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if sess, ok := s.sessions[id]; ok {
        sess.LastTouched = time.Now()
    }
}

func (s *Store) Run(ctx context.Context) {
    t := time.NewTicker(s.sweepEvery)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            s.sweepExpired(now)
        }
    }
}

func (s *Store) sweepExpired(now time.Time) {
    cutoff := now.Add(-s.idleTimeout)
    s.mu.Lock()
    defer s.mu.Unlock()
    for id, sess := range s.sessions {
        if sess.LastTouched.Before(cutoff) {
            delete(s.sessions, id)
        }
    }
}
```

Trade-offs:

- One ticker for the whole store. No per-session timers.
- Sweep frequency `sweepEvery` is independent of `idleTimeout`. A session may stay alive up to `idleTimeout + sweepEvery` after its last touch.
- Memory: sessions stay in the map until the next sweep.

For most session stores, sweeping every minute with an idle timeout of fifteen minutes is fine. The accuracy loss is negligible. The simplification of timer machinery is significant.

#### What you would see in pprof

With per-session `AfterFunc`:

```
go tool pprof -inuse_space ...
(pprof) top
      flat  flat%   sum%
   120MB  44.0%  44.0%  time.NewTimer
    78MB  28.6%  72.6%  time.AfterFunc
```

Most of `inuse_space` is timer machinery. After switching to a sweeper:

```
(pprof) top
      flat  flat%   sum%
   2.1MB   1.5%   1.5%  time.NewTicker
```

A 50x reduction in timer-related memory. The application memory is unchanged; only the timer overhead has gone away.

---

## Appendix M: Numeric Intuition for the Timer Heap

How many active timers does a typical service have? It depends on the architecture, but rough numbers help calibrate expectations.

| Service | Typical active timers |
|---|---|
| HTTP server with 1 000 in-flight requests, each with a 30s context timeout | ~1 000 |
| WebSocket server with 50 000 long-lived connections, idle timer per conn | ~50 000 |
| Distributed cache with TTL on every key, naive implementation | one per key (millions, bad) |
| Distributed cache with sweeper-based TTL | one (the sweeper) |
| Crontab-style scheduler with 100 jobs | ~100 |
| Logging pipeline with per-message timeout, 10 000 msg/sec | ~10 000 transient (rotating fast) |

The runtime can handle hundreds of thousands of timers comfortably. Above a million, you start paying noticeable CPU on heap maintenance. Above ten million, you have a problem.

If your service has more active timers than HTTP requests in flight, that is a signal to audit.

### What the timer heap costs per timer

A rough order of magnitude on Go 1.23:

- Memory per timer: ~96 bytes for the `runtime.timer` struct, plus the user-level `*time.Timer` (~16 bytes).
- Heap operations are O(log N) but with a small constant.

For 1 million timers:

- ~110 MB of runtime memory for the timer heap.
- ~20 ns per Stop/Reset on average.

Doable, but not free. The sweeper pattern avoids paying it.

---

## Appendix N: Reading a Goroutine Dump for Timer Leaks

Here is a real-world goroutine dump excerpt from a service that was leaking. We trimmed the duplicates.

```
goroutine 23847 [select, 132 minutes]:
main.(*Worker).run(0xc000123080)
    /app/worker.go:45 +0x1e0
created by main.(*Server).Start
    /app/server.go:88 +0x123

goroutine 23848 [select, 132 minutes]:
main.(*Worker).run(0xc000123100)
    /app/worker.go:45 +0x1e0
created by main.(*Server).Start
    /app/server.go:88 +0x123

... (50 000 nearly-identical goroutines) ...
```

The line `/app/worker.go:45` is:

```go
44:    for {
45:        select {
46:        case msg := <-w.in:
47:            w.handle(msg)
48:        case <-time.After(w.idleTimeout):
49:            return
50:        }
51:    }
```

The dump tells us 50 000 workers are parked in this select, each holding a freshly allocated timer. If `w.in` has been quiet for less than `w.idleTimeout`, the workers are still alive. If they will *never* receive anything (e.g., the producer crashed), they will all eventually exit via the `time.After` branch — but each fires a 30-minute timer and waits.

The fix:

```go
44:    t := time.NewTimer(w.idleTimeout)
45:    defer t.Stop()
46:    for {
47:        if !t.Stop() {
48:            select {
49:            case <-t.C:
50:            default:
51:            }
52:        }
53:        t.Reset(w.idleTimeout)
54:        select {
55:        case msg := <-w.in:
56:            w.handle(msg)
57:        case <-t.C:
58:            return
59:        }
60:    }
```

After deployment:

- The dump still shows 50 000 goroutines (one per worker, expected).
- pprof `-alloc_space` drops `time.NewTimer` from the top 10.
- `HeapAlloc` is flat instead of sawtoothed.

---

## Appendix O: The Mental Checklist

When you sit down to write or review code that uses time, run through this checklist:

1. Is this a loop?
   - If yes, do not use `time.After`. Use a reusable `NewTimer`.
2. Is this a periodic task?
   - If yes, use `NewTicker` + `defer Stop`. Do not use `time.Tick` unless inside `main`.
3. Is this a per-call timeout?
   - Use `context.WithTimeout` + `defer cancel`.
4. Is this an idle timer that resets on every message?
   - Use a single reusable `NewTimer` with `Stop`+drain+`Reset` between iterations.
5. Is this a fire-and-forget callback?
   - `AfterFunc` is okay. Capture minimally. Remember `Stop` is best-effort.
6. Is this a network I/O timeout?
   - `SetReadDeadline` / `SetWriteDeadline` on the connection. Not an external timer.
7. Is this a "lock with timeout"?
   - Channel-based mutex. Never put `time.After` on a `sync.Mutex.Lock`.

If a piece of code does not fit any of these patterns, stop and think — that is usually where leaks hide.

---

## Appendix P: What to Tell a Junior Reviewer

If you are mentoring someone new to Go and they ask "what is the deal with timer leaks," here is the elevator pitch:

> Go's `time.After` and `time.Tick` are convenient one-liners that return a channel. But behind that channel is a runtime timer the GC cannot reclaim until the timer fires or is stopped — and you cannot stop them, because the timer object is not returned to you. So if you put them in a loop or a high-frequency callsite, you accumulate timers that the runtime has to track until they all eventually fire. That is the leak. The fix is to use `time.NewTimer` and `time.NewTicker` instead, which return handles you can stop. Always `defer t.Stop()` on creation, and follow the Stop+drain+Reset dance if you reuse the timer.

That is the whole story. Everything in this page is detail and proof. The slogan above is the muscle memory.

---

## Appendix Q: Common Code-Review Comments

Save these as templated review comments:

**"time.After in a loop"**:
> This allocates a `*time.Timer` per iteration and (depending on Go version) keeps it in the runtime heap until it fires. In a hot loop this is a leak. Please replace with a reusable `time.NewTimer` outside the loop, using Stop+drain+Reset between iterations.

**"time.Tick outside main"**:
> `time.Tick` returns a ticker that can never be stopped. The runtime cannot reclaim it until process exit. Please use `time.NewTicker` + `defer t.Stop()`.

**"missing defer t.Stop()"**:
> Without `defer t.Stop()`, an early return from this function would leave the timer pending in the runtime heap. Please add `defer t.Stop()` immediately after creating the timer.

**"Reset without drain"**:
> Calling `Reset` on a timer whose channel may still have a queued value can cause the next read to fire immediately with the stale value. Please drain `t.C` (non-blocking) after `t.Stop()` returns false.

**"AfterFunc captures heavy state"**:
> The closure passed to `AfterFunc` captures the entire `req` value, which will keep it alive for the duration of the timer. Please capture only the specific fields the callback uses.

These canned comments speed up review and teach the patterns by repetition.

---

## Appendix R: Microbenchmarks for Timer Patterns

For curiosity, here are benchmarks measuring the cost of various patterns on a single machine. Numbers are illustrative, not authoritative.

```go
package timer_bench

import (
    "testing"
    "time"
)

// Pattern A: time.After in a select, fast path always wins.
func BenchmarkAfterFastPath(b *testing.B) {
    ch := make(chan struct{}, 1)
    for i := 0; i < b.N; i++ {
        ch <- struct{}{}
        select {
        case <-ch:
        case <-time.After(time.Second):
        }
    }
}

// Pattern B: reused NewTimer.
func BenchmarkReusedTimer(b *testing.B) {
    ch := make(chan struct{}, 1)
    t := time.NewTimer(time.Second)
    defer t.Stop()
    for i := 0; i < b.N; i++ {
        ch <- struct{}{}
        if !t.Stop() {
            select {
            case <-t.C:
            default:
            }
        }
        t.Reset(time.Second)
        select {
        case <-ch:
        case <-t.C:
        }
    }
}

// Pattern C: per-iter NewTimer with explicit Stop.
func BenchmarkPerIterTimer(b *testing.B) {
    ch := make(chan struct{}, 1)
    for i := 0; i < b.N; i++ {
        ch <- struct{}{}
        t := time.NewTimer(time.Second)
        select {
        case <-ch:
            t.Stop()
        case <-t.C:
        }
    }
}

// Pattern D: context.WithTimeout per iter.
func BenchmarkContextPerIter(b *testing.B) {
    ch := make(chan struct{}, 1)
    bg := context.Background()
    for i := 0; i < b.N; i++ {
        ch <- struct{}{}
        ctx, cancel := context.WithTimeout(bg, time.Second)
        select {
        case <-ch:
        case <-ctx.Done():
        }
        cancel()
    }
}
```

Indicative results on Go 1.22, M1 Mac:

| Pattern | ns/op | B/op | allocs/op |
|---|---|---|---|
| A: time.After | 290 | 184 | 4 |
| B: reused timer | 75 | 0 | 0 |
| C: per-iter NewTimer | 280 | 168 | 3 |
| D: context.WithTimeout | 410 | 256 | 5 |

Reused timer is fastest. `context.WithTimeout` is most allocation-heavy but enforces stronger discipline (always cancellable, always propagates). The right choice depends on your situation.

On Go 1.23 the allocation cost drops further because the timer struct layout was simplified. The relative ranking stays the same.

---

## Appendix S: Integration With `errgroup`

`errgroup.Group` is the workhorse for parallel goroutine coordination. It is common to want a *group-wide timeout* — every goroutine in the group should give up if the deadline passes. The wrong way:

```go
g, ctx := errgroup.WithContext(parent)
for _, item := range items {
    item := item
    g.Go(func() error {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(5 * time.Second):
            return errTimeout
        case result := <-process(item):
            return handle(result)
        }
    })
}
```

This allocates one timer per goroutine in the group. If `items` has 10 000 entries, you have 10 000 timers. Pre-1.23 they all sit in the runtime heap until they fire.

The right way: derive a single timeout context up front.

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()

g, ctx := errgroup.WithContext(ctx)
for _, item := range items {
    item := item
    g.Go(func() error {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case result := <-process(item):
            return handle(result)
        }
    })
}
return g.Wait()
```

One timer total. Every goroutine sees the same `ctx.Done()`. If one goroutine errors, `errgroup` cancels the group, and all others see `ctx.Done()` close immediately.

---

## Appendix T: Final Words

The principle behind all of this is straightforward: **the runtime is willing to track as many timers as you give it, but it will not free them until they fire or you stop them.** Every shortcut that hides the timer from your code (`time.After`, `time.Tick`) also hides it from your ability to stop it. The disciplined pattern is to keep the timer in scope, stop it explicitly, and treat its channel like any other resource that needs draining.

Most timer leaks come from authors who reach for the shortest one-line idiom in a context that needed two more lines. The cost of those missing lines compounds over the lifetime of a long-running service.

That is the entire message.

If you want to know *how* the runtime tracks timers, why pre-1.23 retention was so painful, and what changed in 1.23, the senior page is next.

---

## Appendix U: A Deeper Look at `Reset` Return Semantics

Several questions about `Reset` come up repeatedly in code review and on community forums. Let us pin down each one.

### Question: "Does `Reset` ever drain the channel?"

No. `Reset` only changes the fire time. It does not interact with the channel buffer. If the channel has a queued value when you call `Reset`, that value remains queued. The next read from `t.C` returns that stale value.

### Question: "Does `Stop` drain the channel?"

No. `Stop` only removes the timer from the runtime heap (if it has not yet fired) or signals that the timer has already fired (in which case the value may already be sitting in the channel buffer). It does not drain. You drain manually with a non-blocking select.

### Question: "If `Stop` returns true, do I need to drain?"

No. `Stop` returning true means the timer was removed from the heap before it had a chance to fire. No value has been queued to the channel. You can `Reset` directly.

### Question: "If `Stop` returns false, do I always need to drain?"

It depends on whether anyone has read from `t.C` since the last fire. If the timer fired and someone (you or another goroutine) already read the value, the channel is empty and you do not need to drain. If nobody read, the value is queued and you must drain.

In practice, the safe default is to *always* drain after `Stop` returns false, using a non-blocking select. The drain is cheap and harmless when the channel is empty.

### Question: "What if I have multiple readers on `t.C`?"

You should not. `*time.Timer` is designed for single-reader use. Multiple readers create a race over who gets the fire value. If you need fan-out, use a separate channel that you write to from a single reader on `t.C`.

### Question: "What happens if I `Reset` to a duration of 0?"

The timer fires immediately. The channel receives a `time.Time` value representing the current time. This is occasionally useful in tests or for "yield with a value" semantics, but it is unusual in production code.

### Question: "Can `Reset` change a stopped timer back to active?"

Yes. After `Stop`, the timer is inactive. After `Reset`, the timer is active again with the new duration.

### Question: "Can I `Reset` a timer that has never fired and never been stopped?"

Technically the documentation says no. In practice, the runtime handles it on 1.23+ — but on older Go, there is a subtle race where the timer might fire concurrently with the `Reset`. The safe pattern is always Stop+drain+Reset.

---

## Appendix V: A Sketch of the Runtime's Timer Machinery

The senior page goes deep here, but a sketch helps middle-level readers understand why the rules are what they are.

The runtime maintains a per-P (processor) min-heap of pending timers. Each entry is a `runtime.timer` struct containing:

- Fire time (`when`).
- Period (`period`, used for tickers).
- Callback (`f`) and argument (`arg`).
- Channel for `*time.Timer` and `*time.Ticker` (in older versions).
- State flags.

When the scheduler picks a P to run goroutines, it first checks the top of the timer heap. If the top entry has fired (current time ≥ when), the runtime executes the callback. For `*time.Timer` and `*time.Ticker`, the callback writes the current time to the channel.

`Stop` traverses the heap to find the entry (or sets a flag for lazy removal, depending on Go version) and marks it inactive.

`Reset` similarly modifies the heap entry's `when` field and re-establishes its heap position.

For tickers, after firing, the runtime re-inserts the entry with `when += period`, so the heap stays populated with the next tick.

This is why a "leaked" ticker stays in the heap forever: nothing removes its entry, and after every fire it is re-inserted with a new fire time.

### Why `time.After` is "leaky"

`time.After(d)` constructs an internal timer and returns its channel. The timer entry goes into the heap. The runtime fires it at time `now + d`. After firing, the entry is removed from the heap. The channel value is sent. If nobody reads the channel, the buffered value sits in the buffer.

The "leak" is the duration between *now* and *fire time*. During that window:

- The timer entry occupies a heap slot.
- The timer struct occupies memory.
- (Pre-1.23) the GC cannot reclaim the timer even if the channel is unreferenced, because the runtime holds an internal reference.

For `d = 5 minutes` and an allocation rate of 1 000 timers per second, that is 300 000 entries in the heap at steady state. Not catastrophic but not free.

### Why Go 1.23 helped

The 1.23 timer rework changed two things:

1. The internal timer struct now lives "inside" the user-visible `*time.Timer` (or the unnamed timer for `time.After`), rather than being a separately allocated piece of runtime state.
2. The runtime tracks timers using weak-reference-like semantics: when the GC can prove that nothing user-visible references the timer (and the timer is on the heap rather than being held by the runtime), it can reclaim the timer body.

The senior page covers the exact mechanism. For middle-level work, the takeaway is: 1.23+ makes `time.After` cheaper, but the pattern is still a smell because it allocates per call.

---

## Appendix W: Cookbook of Idiomatic Patterns

### Idiom 1: Timeout a single operation

```go
ctx, cancel := context.WithTimeout(parent, d)
defer cancel()
result, err := op(ctx)
```

### Idiom 2: Retry with backoff

```go
backoff := 100 * time.Millisecond
for attempt := 0; attempt < maxAttempts; attempt++ {
    err := op(ctx)
    if err == nil || !retryable(err) {
        return err
    }
    if err := sleep(ctx, backoff); err != nil {
        return err
    }
    backoff *= 2
}

func sleep(ctx context.Context, d time.Duration) error {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-t.C:
        return nil
    }
}
```

### Idiom 3: Periodic background task

```go
go func() {
    t := time.NewTicker(d)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            doPeriodicWork()
        }
    }
}()
```

### Idiom 4: Idle timeout on a goroutine

```go
t := time.NewTimer(idleTimeout)
defer t.Stop()
for {
    if !t.Stop() {
        select {
        case <-t.C:
        default:
        }
    }
    t.Reset(idleTimeout)
    select {
    case msg := <-in:
        handle(msg)
    case <-t.C:
        return
    }
}
```

### Idiom 5: Debounce

```go
type Debouncer struct {
    delay time.Duration
    timer *time.Timer
    f     func()
}

func NewDebouncer(delay time.Duration, f func()) *Debouncer {
    return &Debouncer{delay: delay, f: f}
}

func (d *Debouncer) Trigger() {
    if d.timer != nil {
        d.timer.Stop()
    }
    d.timer = time.AfterFunc(d.delay, d.f)
}

func (d *Debouncer) Stop() {
    if d.timer != nil {
        d.timer.Stop()
        d.timer = nil
    }
}
```

Note: this Debouncer is not goroutine-safe. Add a mutex if `Trigger` may be called concurrently.

### Idiom 6: Throttle

```go
type Throttle struct {
    every time.Duration
    last  time.Time
    mu    sync.Mutex
}

func (t *Throttle) Allow() bool {
    t.mu.Lock()
    defer t.mu.Unlock()
    now := time.Now()
    if now.Sub(t.last) < t.every {
        return false
    }
    t.last = now
    return true
}
```

No timers needed — just `time.Now()`. This is often the right shape.

### Idiom 7: Timeout a channel send

```go
t := time.NewTimer(d)
defer t.Stop()
select {
case ch <- value:
    return nil
case <-t.C:
    return errSendTimeout
}
```

If the channel is full and you cannot send, the timer fires and you give up. The timer is stopped on success.

### Idiom 8: Wait for a condition with timeout

```go
deadline := time.Now().Add(d)
for !cond() {
    if time.Now().After(deadline) {
        return errTimeout
    }
    time.Sleep(10 * time.Millisecond)
}
return nil
```

Crude polling, but allocates no timers. Use only when `cond` is cheap and you do not need precise timing. For precise waits, use a `sync.Cond` or a channel-based barrier.

---

## Appendix X: Anti-Pattern: The "Helpful" Wrapper

Beware functions that hide timer allocation inside a helpful API:

```go
func TimeoutChan(d time.Duration) <-chan struct{} {
    out := make(chan struct{})
    go func() {
        <-time.After(d)
        close(out)
    }()
    return out
}
```

This looks tidy. But every call:

- Spawns a goroutine.
- Allocates a `*time.Timer` via `time.After`.
- Allocates a channel.

In a hot loop, that is three allocations and a goroutine per call. The goroutine lives for `d`. If `d` is large and the caller does not consume the result, you have a goroutine leak.

Replace with `context.WithTimeout` whose caller-managed `cancel` cleans up properly.

Another flavor:

```go
func After(d time.Duration) <-chan struct{} {
    done := make(chan struct{})
    time.AfterFunc(d, func() { close(done) })
    return done
}
```

This avoids the goroutine but still allocates a timer per call, and the caller cannot cancel it. Same issue. Use `context.WithCancel` + `context.WithTimeout`.

The rule: if your library returns a channel-based timeout, expose a cancellation mechanism alongside it. Otherwise you are forcing leaks on callers.

---

## Appendix Y: Compiler-Assisted Checks

`go vet` does not currently flag `time.After` in a loop. There are external linters that do:

- `staticcheck` rule `SA4030` flags some misuse but not the specific loop case.
- `gocritic`'s `timeAfterLoop` checker flags `time.After` in `for` loops.

Adding `gocritic` to your CI catches the common cases:

```yaml
# .golangci.yml
linters:
  enable:
    - gocritic
linters-settings:
  gocritic:
    enabled-checks:
      - timeAfterLoop
```

If you maintain a large Go codebase, this is a low-friction way to catch regressions.

---

## Appendix Z: Wrap-up Quiz

Test your understanding before moving on:

1. A coworker writes `for { select { case <-ch: ; case <-time.After(d): } }` and asks "why does this leak?" Explain in two sentences.
2. The same coworker proposes adding `default: continue` to "fix" the leak. Explain why this is wrong.
3. The same coworker proposes wrapping `time.After` in a helper that returns the channel. Explain why this does not help.
4. Show the four-line refactor that actually fixes the leak.
5. The fix introduces `t.Stop()` followed by a `select { case <-t.C: default: }`. Explain in two sentences what this dance is doing and why it is necessary.
6. Where in the codebase would you also expect to find this anti-pattern? Name three plausible locations.
7. What would you see in `go tool pprof -alloc_space` before and after the fix?
8. What would you see in `runtime.NumGoroutine()` over time, before and after?
9. Bonus: if you deploy your fix only on Go 1.23+, will the leak still show in `inuse_space`? Explain.

Once you can answer all nine, you have internalised the middle-level material. Move on to the senior page.

---


