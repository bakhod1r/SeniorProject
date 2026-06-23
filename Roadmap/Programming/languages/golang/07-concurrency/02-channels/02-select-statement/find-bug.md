# Select Statement — Find the Bug

Twelve broken Go snippets. For each one, identify the bug, explain why it happens, and propose a fix. The bugs cover the most common `select` mistakes seen in real production code.

## Table of Contents
1. [Bug 1 — `time.After` leak in tight loop](#bug-1-timeafter-leak-in-tight-loop)
2. [Bug 2 — Goroutine leak from missing cancellation](#bug-2-goroutine-leak-from-missing-cancellation)
3. [Bug 3 — `default` in the wrong place causing busy-wait](#bug-3-default-in-the-wrong-place-causing-busy-wait)
4. [Bug 4 — Send on closed channel inside select](#bug-4-send-on-closed-channel-inside-select)
5. [Bug 5 — Closed-receive spin in for-select](#bug-5-closed-receive-spin-in-for-select)
6. [Bug 6 — Strict-priority starvation](#bug-6-strict-priority-starvation)
7. [Bug 7 — Producer leak after timeout](#bug-7-producer-leak-after-timeout)
8. [Bug 8 — Missing nil-channel handling in fan-in](#bug-8-missing-nil-channel-handling-in-fan-in)
9. [Bug 9 — `ctx.Done` not selected](#bug-9-ctxdone-not-selected)
10. [Bug 10 — `time.Tick` leak across subscriptions](#bug-10-timetick-leak-across-subscriptions)
11. [Bug 11 — Closing channel from receiver side](#bug-11-closing-channel-from-receiver-side)
12. [Bug 12 — Incorrect `Stop`/`Reset` dance](#bug-12-incorrect-stopreset-dance)
13. [How to Use This File](#how-to-use-this-file)

---

## Bug 1 — `time.After` leak in tight loop

```go
func consume(in <-chan Msg) {
    for {
        select {
        case m := <-in:
            handle(m)
        case <-time.After(time.Minute):
            log.Println("idle")
        }
    }
}
```

### Symptom
After running under heavy load for a few hours, memory grows steadily. `pprof heap` shows millions of `*time.Timer` objects. RSS is 2 GB and climbing.

### Root cause
Every iteration of the loop calls `time.After(time.Minute)`. Each call allocates a new `*Timer`. The timer is not eligible for garbage collection until it fires, one minute later. If `in` delivers thousands of messages per second, you accumulate millions of pending timers, each waiting to fire. Every one of them holds a goroutine reference and a heap entry. By the time the first ones fire, the heap is huge.

### Fix
Hoist a single `*Timer` outside the loop and `Reset` it every iteration:

```go
func consume(ctx context.Context, in <-chan Msg) {
    t := time.NewTimer(time.Minute)
    defer t.Stop()
    for {
        // Stop and drain before Reset (Go ≤1.22)
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(time.Minute)

        select {
        case m := <-in:
            handle(m)
        case <-t.C:
            log.Println("idle")
        case <-ctx.Done():
            return
        }
    }
}
```

For Go 1.23+ the drain-before-reset is unnecessary. Either way, this fix replaces "one timer per iteration" with "one timer for the lifetime of the loop." Memory stays flat.

While we are here, the original also lacks a `<-ctx.Done()` exit; the fix adds one.

---

## Bug 2 — Goroutine leak from missing cancellation

```go
func subscribe(events chan Event) {
    go func() {
        for {
            select {
            case e := <-events:
                handle(e)
            }
        }
    }()
}
```

### Symptom
Goroutine count grows monotonically across the service's lifetime. Each call to `subscribe` adds a goroutine that never goes away.

### Root cause
The for-select has only one case. There is no way out. The goroutine lives until either `events` is closed (which the code never does) or the process exits.

### Fix
Pass a `context.Context` and add a cancellation case:

```go
func subscribe(ctx context.Context, events <-chan Event) {
    go func() {
        for {
            select {
            case e := <-events:
                handle(e)
            case <-ctx.Done():
                return
            }
        }
    }()
}
```

Or, if the convention is "close `events` to stop":

```go
func subscribe(events <-chan Event) {
    go func() {
        for e := range events {
            handle(e)
        }
    }()
}
```

The `range` form is the cleanest when there is exactly one input and no other event sources. Use the for-select shape only when you need multiple cases.

---

## Bug 3 — `default` in the wrong place causing busy-wait

```go
func dispatcher(jobs <-chan Job) {
    for {
        select {
        case j := <-jobs:
            process(j)
        default:
            // poll
        }
    }
}
```

### Symptom
A profile shows 100% CPU usage on one core, with `runtime.selectgo` and the dispatcher's main loop dominant. No work is being processed faster than usual.

### Root cause
`default` makes the `select` non-blocking. When `jobs` is empty, the loop runs the `default` body and immediately reiterates. The dispatcher is now a busy loop polling `jobs` as fast as the CPU allows.

### Fix
Remove `default` so the `select` blocks until a case is ready:

```go
func dispatcher(ctx context.Context, jobs <-chan Job) {
    for {
        select {
        case j := <-jobs:
            process(j)
        case <-ctx.Done():
            return
        }
    }
}
```

If you genuinely need to do something while idle, use a timer:

```go
case <-ticker.C:
    sweep()
```

Never use `default` plus an unbounded loop unless you actually want to spin.

---

## Bug 4 — Send on closed channel inside select

```go
func emit(out chan<- Event, e Event, done <-chan struct{}) {
    select {
    case out <- e:
    case <-done:
    }
}

// later, called concurrently with this:
close(out)
```

### Symptom
Sporadic `panic: send on closed channel`. Stack trace points at the `case out <- e:` line. The panic happens once every few hours under load.

### Root cause
The code closes `out` from somewhere else while a goroutine may still be inside `emit` waiting to send. If the runtime selects the send case after `close(out)` runs, the send panics. There is no recovery for this; `recover` would have to be inside `emit`, which is fragile.

### Fix
Two options. The simpler one: never close `out`. Use a separate `done` channel and stop sending after `done` is closed.

The other option, when you must close: ensure only one writer ever sends, and that writer also closes — and only after it has stopped sending.

```go
// Producer goroutine, sole writer:
defer close(out)
for {
    select {
    case <-done:
        return
    case out <- nextEvent():
    }
}
```

If you have multiple writers, do not close `out`. Use `done` to coordinate shutdown and let the channel be garbage-collected when nothing references it.

---

## Bug 5 — Closed-receive spin in for-select

```go
func consume(jobs <-chan Job, ticker *time.Ticker) {
    for {
        select {
        case j := <-jobs:
            process(j)
        case <-ticker.C:
            flush()
        }
    }
}
```

After the producer finishes and calls `close(jobs)`:

### Symptom
After shutdown signal, CPU spikes to 100%. The consumer is still running but processing nothing. `pprof` shows the loop hot.

### Root cause
A receive on a closed channel returns immediately with the zero value. Inside a `select`, that case is **always ready**. The loop keeps selecting `case j := <-jobs:`, calling `process(Job{})` on a zero-value job (which probably does nothing useful), and looping again at maximum CPU rate.

### Fix
Detect closure with `v, ok := <-jobs` and break out:

```go
for {
    select {
    case j, ok := <-jobs:
        if !ok {
            return
        }
        process(j)
    case <-ticker.C:
        flush()
    }
}
```

Or, equivalently, set the variable to nil so the case is disabled:

```go
for {
    select {
    case j, ok := <-jobs:
        if !ok {
            jobs = nil // disable this case
            continue
        }
        process(j)
    case <-ticker.C:
        flush()
    }
    if jobs == nil { /* maybe also break depending on logic */ }
}
```

The first form is simpler and more common.

---

## Bug 6 — Strict-priority starvation

```go
for {
    select {
    case <-urgent:
        handleUrgent()
    default:
        select {
        case <-urgent:
            handleUrgent()
        case <-normal:
            handleNormal()
        }
    }
}
```

The intent is "prefer urgent over normal." Over time, `normal`'s throughput drops to zero while `urgent` is sustained.

### Symptom
Under load, `handleNormal` is called maybe a hundred times per minute despite `normal` having a steady supply. Customers notice degraded "low-priority" service.

### Root cause
The outer `select` is non-blocking and prefers `urgent`. When `urgent` has *any* item ready, it runs. The inner `select` runs only when `urgent` is empty. But under sustained urgent load there is rarely a moment when `urgent` is empty, so the inner select almost never executes — and that is where `normal` is chosen.

The original is "preferred priority that *can* starve normal." That is fine for some semantics, but rarely what people actually want.

### Fix
Use a budget — handle at most N urgent in a row, then yield to normal:

```go
const burst = 8
urgentRun := 0
for {
    if urgentRun < burst {
        select {
        case <-urgent:
            handleUrgent()
            urgentRun++
            continue
        default:
        }
    }
    urgentRun = 0
    select {
    case <-urgent:
        handleUrgent()
    case <-normal:
        handleNormal()
    case <-ctx.Done():
        return
    }
}
```

Or use the cleaner architectural fix: separate goroutines per priority with bounded queues. Let the OS scheduler do the prioritising.

---

## Bug 7 — Producer leak after timeout

```go
func fetch(url string) (Body, error) {
    out := make(chan Body)
    go func() {
        b, _ := httpGet(url)
        out <- b
    }()
    select {
    case b := <-out:
        return b, nil
    case <-time.After(2 * time.Second):
        return Body{}, errors.New("timeout")
    }
}
```

### Symptom
Calling `fetch` repeatedly under load grows the goroutine count. `pprof goroutine` shows hundreds of goroutines blocked on `out <- b`.

### Root cause
`out` is unbuffered. When the timeout case wins, `fetch` returns. The producer goroutine, when its HTTP call finally completes, tries to send on `out` — but no one is receiving. The send blocks forever, leaking the goroutine.

### Fix
Buffer `out` with capacity 1 so the producer can always send and exit:

```go
out := make(chan Body, 1)
```

Now even if the consumer chose the timeout, the producer's send completes and its goroutine exits cleanly. The unread value is garbage-collected with the channel.

The general rule: any result channel in a "first-finished-wins" pattern should be buffered with capacity 1 (or the number of producers, if there are several).

---

## Bug 8 — Missing nil-channel handling in fan-in

```go
func merge(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for {
            select {
            case v := <-a:
                out <- v
            case v := <-b:
                out <- v
            }
        }
    }()
    return out
}
```

After `close(a)`:

### Symptom
The merge goroutine spins. CPU goes to 100%. The output sees `0` values being emitted in rapid succession.

### Root cause
After `close(a)`, `case v := <-a` always returns immediately with `v=0` (because closed channels return zero values). The for-select rapidly picks that case, sends `0` to `out`, and loops again. Random selection helps a tiny bit but not enough — even half of an infinite loop is still infinite.

### Fix
Detect closure with `v, ok` and disable the case by setting the variable to nil. Loop ends when both are nil:

```go
func merge(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for a != nil || b != nil {
            select {
            case v, ok := <-a:
                if !ok {
                    a = nil
                    continue
                }
                out <- v
            case v, ok := <-b:
                if !ok {
                    b = nil
                    continue
                }
                out <- v
            }
        }
    }()
    return out
}
```

Now once `a` closes, it becomes nil, its case is disabled, and the goroutine waits only on `b`. When both are nil the loop exits and `out` is closed.

---

## Bug 9 — `ctx.Done` not selected

```go
func worker(ctx context.Context, jobs <-chan Job, results chan<- Result) {
    for {
        select {
        case j := <-jobs:
            r := process(ctx, j)
            results <- r
        }
    }
}
```

### Symptom
A `context.WithTimeout(parent, 5*time.Second)` is supposed to cancel this worker. Five seconds pass, the parent cancels — but the worker keeps running. Test assertion `goroutines after = goroutines before` fails by one.

### Root cause
The for-select has only the `<-jobs` case. There is no path that observes the cancelled context and exits. `process(ctx, j)` may or may not respect the context — but even if it does, the next iteration's `<-jobs` blocks forever (or until another job arrives) regardless of cancellation.

### Fix
Add a `<-ctx.Done()` case, and also cover the send on `results`:

```go
func worker(ctx context.Context, jobs <-chan Job, results chan<- Result) {
    for {
        select {
        case j := <-jobs:
            r := process(ctx, j)
            select {
            case results <- r:
            case <-ctx.Done():
                return
            }
        case <-ctx.Done():
            return
        }
    }
}
```

The inner `select` on `results` also honours cancellation; otherwise a slow downstream consumer could keep us blocked past cancellation. Three exits, all leak-free.

---

## Bug 10 — `time.Tick` leak across subscriptions

```go
func subscribe() (<-chan Heartbeat, func()) {
    ch := make(chan Heartbeat)
    cancel := make(chan struct{})

    go func() {
        for {
            select {
            case <-time.Tick(5 * time.Second):
                ch <- Heartbeat{Time: time.Now()}
            case <-cancel:
                return
            }
        }
    }()

    return ch, func() { close(cancel) }
}
```

### Symptom
Subscribers come and go (call `subscribe`, then call `cancel()`). After a week of operation, `pprof goroutine` shows tens of thousands of goroutines parked on tickers, even though only a handful of subscriptions are currently active.

### Root cause
`time.Tick(5 * time.Second)` is called inside the for-select, on every iteration. Each call spins up a new internal ticker goroutine. The old ones are never collected because `time.Tick` provides no `Stop`. Even after the subscriber cancels, the ticker goroutines keep ticking into a now-orphaned channel that is referenced by no one and yet, because the runtime holds an internal reference, lives forever.

### Fix
Use `time.NewTicker` once, outside the loop, with `defer ticker.Stop()`:

```go
func subscribe(ctx context.Context) (<-chan Heartbeat, func()) {
    ch := make(chan Heartbeat, 1)
    ctx, cancel := context.WithCancel(ctx)

    go func() {
        defer close(ch)
        ticker := time.NewTicker(5 * time.Second)
        defer ticker.Stop()
        for {
            select {
            case <-ticker.C:
                select {
                case ch <- Heartbeat{Time: time.Now()}:
                case <-ctx.Done():
                    return
                }
            case <-ctx.Done():
                return
            }
        }
    }()

    return ch, cancel
}
```

`time.Tick` is essentially deprecated; use it only for fire-and-forget tools.

---

## Bug 11 — Closing channel from receiver side

```go
func main() {
    ch := make(chan int)

    go producer(ch)
    go consumer(ch)

    time.Sleep(time.Second)
    close(ch) // shut down
}

func producer(ch chan<- int) {
    for i := 0; ; i++ {
        ch <- i
    }
}
```

### Symptom
`panic: send on closed channel` thrown by `producer`.

### Root cause
The receiver-side code (here, `main`) closes the channel while `producer` is still sending. Even if you remove this `main`-level close and have `consumer` close, the same panic happens — `producer` does not know `ch` closed and sends into it.

### Fix
**Only the writer closes.** Coordinate shutdown with a `done` channel that the producer respects:

```go
func main() {
    ch := make(chan int)
    done := make(chan struct{})

    go producer(ch, done)
    go consumer(ch, done)

    time.Sleep(time.Second)
    close(done) // signal shutdown
    // Optionally wait for consumer to drain.
}

func producer(ch chan<- int, done <-chan struct{}) {
    defer close(ch) // we are the writer; close on exit
    for i := 0; ; i++ {
        select {
        case ch <- i:
        case <-done:
            return
        }
    }
}
```

Now the writer detects `done`, stops sending, and closes the channel safely. The consumer sees the close as `range` exit or `v, ok := <-ch; !ok` and exits in turn.

---

## Bug 12 — Incorrect `Stop`/`Reset` dance

```go
t := time.NewTimer(time.Second)
for {
    select {
    case <-in:
        t.Reset(time.Second) // bug
        process()
    case <-t.C:
        idle()
    }
}
```

### Symptom
On Go 1.22 and earlier: occasional missed `idle` calls, occasional too-fast firings. Behaviour seems flaky.

### Root cause
On Go 1.22 and earlier, `Reset` on a timer that has already fired (and whose value is still in `t.C`) is unsafe: the next `<-t.C` may consume the leftover value immediately, so your case fires "right away" rather than after the new duration. The fix is to `Stop` and drain before `Reset`.

### Fix
The canonical drain-before-reset:

```go
t := time.NewTimer(time.Second)
defer t.Stop()
for {
    select {
    case <-in:
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(time.Second)
        process()
    case <-t.C:
        idle()
    }
}
```

`Stop()` returns `true` if the timer was running, `false` if it had already fired (in which case its value may still be sitting in `t.C`). The non-blocking inner select drains it. After that, `Reset` schedules a fresh duration safely.

On Go 1.23+, the underlying `Timer` semantics changed: `Stop` and `Reset` now coordinate with the channel atomically and you can call `Reset` directly without the drain dance:

```go
// Go 1.23+
t := time.NewTimer(time.Second)
defer t.Stop()
for {
    select {
    case <-in:
        t.Reset(time.Second)
        process()
    case <-t.C:
        idle()
    }
}
```

If your code targets multiple Go versions, the safe fallback is the explicit drain.

---

## How to Use This File

1. Read the broken snippet and the symptom only.
2. Try to identify the bug yourself before reading the root cause.
3. Sketch a fix on paper or in an editor.
4. Compare to the proposed fix.
5. Move on.

Doing this for all twelve trains your eye to spot leaks, panics, and busy loops in a code review at a glance. After a hundred reviews, these patterns become reflexes.

---

## Related Files

- [junior.md](junior.md) — Why these bugs are so easy to write in the first place.
- [middle.md](middle.md) — The patterns that prevent each one.
- [optimize.md](optimize.md) — Beyond fixing bugs, making correct code fast.
