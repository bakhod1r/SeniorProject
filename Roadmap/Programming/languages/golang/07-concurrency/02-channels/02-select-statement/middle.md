# Select Statement — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Recap and Where We Pick Up](#recap-and-where-we-pick-up)
3. [The For-Select Loop in Production](#the-for-select-loop-in-production)
4. [Cancellation with `context`](#cancellation-with-context)
5. [The Nil-Channel Trick](#the-nil-channel-trick)
6. [Timers Done Right: `time.NewTimer` vs `time.After`](#timers-done-right-timenewtimer-vs-timeafter)
7. [Heartbeats and Tickers](#heartbeats-and-tickers)
8. [Fan-in and Fan-out with Select](#fan-in-and-fan-out-with-select)
9. [Bounded Queues and Drop-on-full](#bounded-queues-and-drop-on-full)
10. [Drain-and-shutdown Pattern](#drain-and-shutdown-pattern)
11. [Priority Select (Two-level)](#priority-select-two-level)
12. [Deadline Propagation](#deadline-propagation)
13. [Common Mistakes at this Level](#common-mistakes-at-this-level)
14. [Refactor Recipes](#refactor-recipes)
15. [Performance Notes](#performance-notes)
16. [Testing Patterns](#testing-patterns)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Self-Assessment Checklist](#self-assessment-checklist)
20. [Summary](#summary)

---

## Introduction

In the junior file you learned what `select` is, what `default` does, and how to wire a timeout and a done channel. This file is about the patterns that come up in real Go services: wiring `select` into a long-running goroutine, propagating cancellation, using nil channels to gate cases on or off, replacing `time.After` with reusable timers, building fan-in pipelines, and giving a `select` priorities without breaking its randomisation. By the end of it you will recognise — and be able to write — the standard shapes that appear in every production codebase.

---

## Recap and Where We Pick Up

A `select`:
- evaluates every case to find which channel ops are ready;
- if at least one is ready, runs one of them, choosing uniformly at random when several are ready;
- if none are ready and there is a `default`, runs `default`;
- otherwise blocks until a case becomes ready.

You know the shapes: timeout, cancellation, non-blocking, for-select. Now you will combine them.

---

## The For-Select Loop in Production

Almost every Go service contains some form of:

```go
for {
    select {
    case msg := <-input:
        handle(msg)
    case <-ticker.C:
        flush()
    case <-ctx.Done():
        return
    }
}
```

Three rules govern how this loop should look in production:

1. **Every loop has a way out.** A `case <-ctx.Done():` (or `<-done:`) is mandatory. Without it the goroutine cannot be stopped.
2. **Each case is small.** A long-running case starves the others. If a case wants to do more than ~1 ms of work, hand the work to another goroutine and only push to that goroutine from the case.
3. **State changes happen in cases, not between iterations.** All updates to local state come from a chosen case. There is no work that runs "every iteration regardless"; if you want that, it belongs in a tick case.

A loop that follows these three rules is testable, leak-free, and easy to reason about.

---

## Cancellation with `context`

The standard Go cancellation mechanism is `context.Context`. Its `Done()` method returns a channel that is closed when the context is cancelled (manually, by deadline, or by parent cancellation). Drop it into your `select` and the goroutine listens for cancellation along with everything else.

```go
func loop(ctx context.Context, jobs <-chan Job) error {
    for {
        select {
        case j, ok := <-jobs:
            if !ok {
                return nil // input drained
            }
            if err := process(ctx, j); err != nil {
                return err
            }
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}
```

Two things to notice:

- The function returns `ctx.Err()` so the caller can see `context.Canceled` or `context.DeadlineExceeded`.
- `process(ctx, j)` receives the same context — cancellation propagates downward.

Pair this with `errgroup`:

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return loop(ctx, jobs) })
g.Go(func() error { return producer(ctx, jobs) })
if err := g.Wait(); err != nil {
    log.Println(err)
}
```

If any goroutine returns a non-nil error, `errgroup` cancels the shared context and the others' `select`s see `<-ctx.Done()` and exit.

---

## The Nil-Channel Trick

A receive on a nil channel blocks forever. Inside a `select`, that means a nil-channel case **is never ready** and is therefore effectively disabled. Setting a channel variable to `nil` lets you turn a case off without restructuring the `select`.

### Example: drain-once

A worker that reads from `inA` and `inB` but only wants to read from each one until it sees the closing signal:

```go
for inA != nil || inB != nil {
    select {
    case v, ok := <-inA:
        if !ok {
            inA = nil // disable this case
            continue
        }
        handleA(v)
    case v, ok := <-inB:
        if !ok {
            inB = nil
            continue
        }
        handleB(v)
    }
}
```

Once `inA` closes, its variable becomes `nil` and the `select` simply waits on `inB`. When both close, the `for` condition fails and we exit cleanly. No flags, no booleans, no extra branches.

### Example: gated send

You want to send only when there is something to send:

```go
var out chan<- Result // nil while empty
buf := []Result{}

for {
    var head Result
    if len(buf) > 0 {
        head = buf[0]
        out = realOut
    } else {
        out = nil // disable send case
    }
    select {
    case in := <-inputs:
        buf = append(buf, compute(in))
    case out <- head:
        buf = buf[1:]
    case <-ctx.Done():
        return
    }
}
```

When the buffer is empty, the send case is disabled (its channel is nil) and the `select` waits only for new input or cancellation. When the buffer has work, the send case becomes live and competes with the input case. This is a classic in-process queue pattern.

---

## Timers Done Right: `time.NewTimer` vs `time.After`

`time.After(d)` is concise but allocates a fresh `*Timer` every call, and that timer is not eligible for garbage collection until it fires. Inside a tight loop this leaks until the duration elapses on every leaked timer.

The leaky shape:

```go
// BAD inside a tight loop
for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-time.After(time.Second): // a new *Timer every iteration
        log.Println("idle")
    }
}
```

If `ch` delivers a message every millisecond, you create a thousand timers every second; they live for a second each before firing, so you accumulate a thousand timer objects on the heap until the loop slows down.

The fix is to construct one timer, reset it, and stop it.

```go
t := time.NewTimer(time.Second)
defer t.Stop()

for {
    if !t.Stop() {
        select {
        case <-t.C:
        default:
        }
    }
    t.Reset(time.Second)

    select {
    case msg := <-ch:
        handle(msg)
    case <-t.C:
        log.Println("idle")
    }
}
```

Two things this dance does:

- `t.Stop()` returns `false` if the timer has already fired (so its channel may still hold the value); the inner non-blocking receive drains that potential leftover.
- `t.Reset(d)` schedules the timer for a fresh `d`.

Go 1.23 simplified the rules: `Stop` and `Reset` no longer require the drain dance, because the timer's channel is now buffered with capacity 1 and is cleaned up when the timer is stopped. If you target Go 1.23+, you can write:

```go
// Go 1.23+
t := time.NewTimer(time.Second)
defer t.Stop()
for {
    t.Reset(time.Second)
    select {
    case msg := <-ch:
        handle(msg)
    case <-t.C:
        log.Println("idle")
    }
}
```

For older Go versions, keep the explicit drain.

---

## Heartbeats and Tickers

A heartbeat is a periodic event you want to fire while the loop is otherwise blocked.

```go
ticker := time.NewTicker(5 * time.Second)
defer ticker.Stop()

for {
    select {
    case j := <-jobs:
        process(j)
    case <-ticker.C:
        emitHeartbeat()
    case <-ctx.Done():
        return
    }
}
```

`time.NewTicker` produces ticks on a channel. Always pair it with `defer ticker.Stop()` — without that, the runtime keeps sending ticks forever and the ticker is never collected.

Avoid `time.Tick(d)`: it has no `Stop`, so its goroutine and channel leak.

---

## Fan-in and Fan-out with Select

### Fan-in: many producers, one consumer

```go
func fanIn(ctx context.Context, sources ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, src := range sources {
        wg.Add(1)
        go func(c <-chan int) {
            defer wg.Done()
            for {
                select {
                case v, ok := <-c:
                    if !ok {
                        return
                    }
                    select {
                    case out <- v:
                    case <-ctx.Done():
                        return
                    }
                case <-ctx.Done():
                    return
                }
            }
        }(src)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

The outer `select` reads from one source. The inner `select` writes to the merged output but bails on cancellation. The closer goroutine waits for every reader and then closes `out`.

### Fan-out: one producer, many workers

Fan-out usually does not need an outer `select`: workers read from a shared channel.

```go
jobs := make(chan Job)
for i := 0; i < N; i++ {
    go func() {
        for j := range jobs {
            process(j)
        }
    }()
}
```

If you also want cancellation:

```go
for {
    select {
    case j, ok := <-jobs:
        if !ok {
            return
        }
        process(j)
    case <-ctx.Done():
        return
    }
}
```

---

## Bounded Queues and Drop-on-full

A `select` with a `default` on the send side gives you a non-blocking enqueue:

```go
func enqueue(ch chan<- Event, e Event) (accepted bool) {
    select {
    case ch <- e:
        return true
    default:
        // queue full — drop, log, sample, or count
        return false
    }
}
```

This is how you implement load shedding. Pair it with a metric so you can see when you are dropping.

A variation is "try-or-coerce": if the buffered channel is full, drop an old entry and re-try.

```go
func push(ch chan Event, e Event) {
    for {
        select {
        case ch <- e:
            return
        default:
            select {
            case <-ch: // remove oldest
            default:
            }
        }
    }
}
```

This shape is rarely the right answer outside of monitoring buffers — it has subtle ordering issues — but it is good to recognise.

---

## Drain-and-shutdown Pattern

When a service is shutting down it usually wants to:

1. Stop accepting new work.
2. Finish the work that is already in flight.
3. Exit.

Two channels make this clean:

```go
type Server struct {
    jobs chan Job
    done chan struct{}
}

func (s *Server) Run() {
    for {
        select {
        case j := <-s.jobs:
            process(j)
        case <-s.done:
            // drain remaining jobs
            for {
                select {
                case j := <-s.jobs:
                    process(j)
                default:
                    return
                }
            }
        }
    }
}

func (s *Server) Shutdown() {
    close(s.done)
}
```

The outer `select` chooses between accepting a new job and starting the drain. The inner `select` with `default` empties the queue without blocking, then returns.

If you can also stop new sends from outside (callers respect a "closed" boolean), you can safely close `jobs` and use `for j := range s.jobs { ... }` instead.

---

## Priority Select (Two-level)

`select` randomises among ready cases. There is no syntax for "this case wins if both are ready." But you can express priority with two stacked selects.

### Recipe: prefer `urgent` over `normal`

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
        case <-ctx.Done():
            return
        }
    }
}
```

The first `select` runs only if `urgent` is ready right now; otherwise it falls through to the inner `select` which waits on either channel. When `urgent` is hot, you always service it first; when only `normal` has work, you do not starve.

### Recipe: prefer cancellation

```go
for {
    select {
    case <-ctx.Done():
        return
    default:
    }
    select {
    case j := <-jobs:
        process(j)
    case <-ctx.Done():
        return
    }
}
```

The first non-blocking `select` exits immediately if the context is already cancelled. The second one is the normal blocking `select`. This is rarely necessary — the inner `<-ctx.Done()` will be selected the moment cancellation occurs — but it is useful when `process` is slow enough that you want to bail out before even starting.

Use priority sparingly. Most production code does not need it; it adds complexity and obscures the intent.

---

## Deadline Propagation

Combine `select` with `context.WithTimeout`:

```go
func fetchOrFail(ctx context.Context, url string) (Body, error) {
    ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()

    resCh := make(chan Body, 1)
    errCh := make(chan error, 1)
    go func() {
        b, err := httpGet(ctx, url)
        if err != nil {
            errCh <- err
            return
        }
        resCh <- b
    }()

    select {
    case b := <-resCh:
        return b, nil
    case err := <-errCh:
        return Body{}, err
    case <-ctx.Done():
        return Body{}, ctx.Err()
    }
}
```

Three exits, only one possible at a time. Note:

- The result and error channels are buffered with capacity 1 so the goroutine can write and exit even if the `select` already chose the cancellation path. Without the buffer the goroutine would leak.
- `ctx.Err()` distinguishes `context.Canceled` (caller cancelled) from `context.DeadlineExceeded` (timeout fired).

---

## Common Mistakes at this Level

| Mistake | Why it bites | Fix |
|---------|--------------|-----|
| Using `time.After` in for-select | Per-iteration timer allocation | `time.NewTimer` + `Reset` (or Go 1.23 simplification) |
| `time.Tick` instead of `time.NewTicker` | No way to `Stop`, leaks | `time.NewTicker` + `defer ticker.Stop()` |
| Forgetting the buffer on `resCh` in timeout patterns | Producer goroutine leaks if timeout wins | Buffer 1 |
| Not nil-ing exhausted channels in fan-in | `select` keeps firing the closed case (always ready) | Set the variable to `nil` after seeing `!ok` |
| Closing a channel from the receiver | Can panic any concurrent sender | Close only from the sender |
| Putting a heavy computation in a case body | Stalls all the other cases | Hand off to a worker goroutine |
| Polling with `default + sleep` instead of a timer | Burns CPU and wastes scheduler slots | Use a `time.Timer` case |

---

## Refactor Recipes

### Recipe: turn `time.After` into a reusable timer

Before:
```go
for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-time.After(d):
        idle()
    }
}
```

After (Go 1.22 and earlier):
```go
t := time.NewTimer(d)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(d)
    select {
    case msg := <-ch:
        handle(msg)
    case <-t.C:
        idle()
    }
}
```

After (Go 1.23+):
```go
t := time.NewTimer(d)
defer t.Stop()
for {
    t.Reset(d)
    select {
    case msg := <-ch:
        handle(msg)
    case <-t.C:
        idle()
    }
}
```

### Recipe: replace flag with nil-channel

Before:
```go
done := false
for !done {
    select {
    case v, ok := <-ch:
        if !ok { done = true; continue }
        handle(v)
    case <-other:
        ...
    }
}
```

After:
```go
for ch != nil || other != nil {
    select {
    case v, ok := <-ch:
        if !ok { ch = nil; continue }
        handle(v)
    case <-other:
        ...
    }
}
```

### Recipe: split error and value into result struct

Before:
```go
res := make(chan int, 1)
err := make(chan error, 1)
...
select {
case v := <-res: ...
case e := <-err: ...
case <-ctx.Done(): ...
}
```

After:
```go
type result struct {
    v   int
    err error
}
out := make(chan result, 1)
...
select {
case r := <-out:
    if r.err != nil { return r.err }
    use(r.v)
case <-ctx.Done():
    ...
}
```

Use whichever fits your code. The two-channel version separates "error" from "value" cleanly when they propagate differently.

---

## Performance Notes

- **Each case in `select` requires lock acquisition on the underlying channel.** A `select` with N cases acquires N locks (sorted to avoid deadlock). Twenty-case selects start to cost noticeable scheduler time.
- **Set unused cases to nil channels** so the runtime does not even consider them.
- **Reuse timers** — allocation is the second-biggest cost after lock acquisition.
- **Hot path: at most three cases** (work, tick, done). More than five and you should split goroutines.
- **`default` is free** — it costs no lock acquisition and no parking.
- **`select{}` is also free** — no cases, no parking churn, the goroutine just goes to sleep.

We will go deeper on the runtime in senior.md and professional.md.

---

## Testing Patterns

### Unit-test a for-select loop

Drive it with channels you control, plus a synchronisation point.

```go
func TestLoopProcessesAndExits(t *testing.T) {
    in := make(chan int)
    done := make(chan struct{})
    finished := make(chan struct{})

    go func() {
        for {
            select {
            case v := <-in:
                _ = v
            case <-done:
                close(finished)
                return
            }
        }
    }()

    in <- 1
    in <- 2
    close(done)

    select {
    case <-finished:
        // ok
    case <-time.After(time.Second):
        t.Fatal("loop did not exit")
    }
}
```

### Test fairness

Run many iterations and assert no channel was starved. Do not assert exactly 50/50 — that is randomness.

```go
if counts["a"] < total/4 || counts["b"] < total/4 {
    t.Fatal("looks starved")
}
```

### Test timeout precisely

Do not assert exact equality; allow a tolerance for scheduler jitter. `>= timeout - 1ms` is usually fine.

---

## Tricky Questions

1. Why is `time.After` problematic in a hot loop, and what is the canonical replacement?
2. What happens when you set a channel variable to `nil` in the middle of a `select`'s evaluation?
3. Why are the result channels in a timeout pattern almost always buffered with capacity 1?
4. How do you express "prefer the urgent channel but do not starve the normal one"?
5. What is the right way to detect that a channel inside a `select` has been closed?
6. Why does `for v := range ch` not need a `select`?
7. In what version did Go simplify `Timer.Stop`/`Reset` semantics?
8. Why is `time.Tick` discouraged?
9. What is the difference between `default` and `case <-ctx.Done():`?
10. How does `errgroup` interact with `select`?

(Answers in interview.md.)

---

## Cheat Sheet

```go
// Cancellation
case <-ctx.Done():
    return ctx.Err()

// Timeout (loop-friendly, Go 1.23+)
t := time.NewTimer(d); defer t.Stop()
for { t.Reset(d); select { case v := <-ch: ; case <-t.C: } }

// Disable a case
ch = nil

// Drop-on-full
select { case ch <- v: ; default: dropped++ }

// Two-level priority
select {
case <-urgent:
default:
    select {
    case <-urgent:
    case <-normal:
    case <-ctx.Done(): return
    }
}

// Heartbeat
tk := time.NewTicker(d); defer tk.Stop()
for {
    select {
    case <-tk.C: heartbeat()
    case j := <-jobs: process(j)
    case <-ctx.Done(): return
    }
}

// Fan-in (sketch)
out := make(chan T); var wg sync.WaitGroup
for _, c := range sources {
    wg.Add(1); go func(c <-chan T) {
        defer wg.Done()
        for v := range c { select { case out <- v: case <-ctx.Done(): return } }
    }(c)
}
go func() { wg.Wait(); close(out) }()
```

---

## Self-Assessment Checklist

- [ ] I can explain why `time.After` leaks in a tight loop and rewrite the loop with `time.NewTimer`.
- [ ] I always include a `<-ctx.Done()` case in a long-running for-select.
- [ ] I use `time.NewTicker` plus `defer ticker.Stop()` for periodic work.
- [ ] I can describe the nil-channel trick and use it to disable cases.
- [ ] I can write a fan-in that exits cleanly when context is cancelled.
- [ ] I buffer the result channel with capacity 1 in timeout patterns to avoid goroutine leaks.
- [ ] I close channels from the sending side only.
- [ ] I can express priority with a two-level `select`.
- [ ] I can write a graceful shutdown that drains the job queue.
- [ ] I do not depend on case ordering.

---

## Summary

At middle level you stop writing `select` blocks and start writing systems that happen to use `select` everywhere: workers with cancellation, timeouts that do not leak timers, fan-ins that drain cleanly, queues that drop instead of blocking, and priority loops that prefer urgent traffic without starving normal traffic. Three habits make the difference: every loop has a `<-ctx.Done()` exit; timers and tickers are constructed once and stopped; nil channels are used to disable cases dynamically. Once you internalise these, you will read other people's `select` code at a glance and write your own without fear of leaks. Senior.md is next: how the runtime actually evaluates a `select`, why randomisation works the way it does, and where the fairness story breaks down.
