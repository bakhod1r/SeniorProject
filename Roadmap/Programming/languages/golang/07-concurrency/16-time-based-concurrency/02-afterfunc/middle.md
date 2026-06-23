---
layout: default
title: Middle
parent: AfterFunc
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/02-afterfunc/middle/
---

# time.AfterFunc — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [What You Should Already Know](#what-you-should-already-know)
3. [Recap of the Junior Surface](#recap-of-the-junior-surface)
4. [Reset, In Full](#reset-in-full)
5. [Stop vs Fire: The Real Race](#stop-vs-fire-the-real-race)
6. [The Callback's Goroutine, Closely Examined](#the-callbacks-goroutine-closely-examined)
7. [context.AfterFunc (Go 1.21)](#contextafterfunc-go-121)
8. [Hardened Patterns](#hardened-patterns)
9. [Common Misuses at This Level](#common-misuses-at-this-level)
10. [Memory and the Captured Closure](#memory-and-the-captured-closure)
11. [Testing Timer-Based Code](#testing-timer-based-code)
12. [Interaction with Mutexes](#interaction-with-mutexes)
13. [Interaction with Channels](#interaction-with-channels)
14. [Mid-Level Exercises](#mid-level-exercises)
15. [Mid-Level Tricky Questions](#mid-level-tricky-questions)
16. [Cheat Sheet](#cheat-sheet)
17. [Self-Assessment](#self-assessment)
18. [Summary](#summary)
19. [What You Can Build](#what-you-can-build)
20. [Further Reading](#further-reading)
21. [Related Topics](#related-topics)
22. [Diagrams](#diagrams)

---

## Introduction

The junior file teaches `AfterFunc` as a primitive: schedule a callback, optionally stop it, optionally reset it. This file is about *what the primitive does when it interacts with the rest of your program* — particularly with goroutines you do not own, contexts you do not own, and the runtime scheduler you definitely do not own.

By the end of this file you will:

- Understand `Reset` thoroughly, including the boolean return, what happens for an expired timer, and why the post-Go-1.23 cleanups matter.
- Know exactly what kinds of `Stop` vs fire races exist, and have at least three idiomatic patterns to handle each.
- Understand `context.AfterFunc` (Go 1.21+) end-to-end and when to prefer it over `time.AfterFunc`.
- Be able to write small, correct components around `AfterFunc` — debouncers, watchdogs, deadline gates, idle timers — with proper synchronisation.
- Recognise the closure-pinning bug and refactor real code to avoid it.
- Test time-dependent code without making test runs slow or flaky.

This is the level at which most production usage of `AfterFunc` lives. The senior file digs into the runtime; the professional file moves to observability and postmortems.

---

## What You Should Already Know

Coming into this file you should be comfortable with everything in `junior.md`:

- Signature `time.AfterFunc(d, f) *time.Timer`.
- `Stop()` returns `true` iff this call removed the timer from the heap.
- The callback runs in its own goroutine.
- `t.C` is nil for AfterFunc timers.
- Panics in the callback kill the program unless recovered.
- Captured variables are held alive until the callback finishes.

You should also have some general Go background: mutexes, channels, contexts, the difference between value and pointer receivers, closures, and `sync.WaitGroup`.

---

## Recap of the Junior Surface

In 60 seconds:

```go
t := time.AfterFunc(d, f)   // schedule f in a new goroutine after d
ok := t.Stop()              // returns true iff we caught it before fire
ok = t.Reset(d)             // reschedule; return mirrors prior state
```

The pitfalls are mostly about the callback running on a different goroutine: synchronisation, panic safety, and the fact that `Stop` returning `false` does not mean the callback is done.

Now we go deeper.

---

## Reset, In Full

### What Reset does

`t.Reset(d)` re-arms the timer to fire after `d` from now. The runtime:

1. Takes the timer's lock.
2. If the timer is currently in the heap, removes it.
3. Updates `when = now + d`.
4. Inserts the timer back into the heap.
5. Returns a boolean — `true` if the timer was active before the call, `false` if it was not.

For an `AfterFunc` timer the boolean is rarely useful in user code. For a channel-style `*time.Timer` it tells you whether you need to drain `t.C` before relying on the next fire. Since `C` is nil for AfterFunc, that concern does not apply.

### Reset on an active (not yet fired) timer

```go
t := time.AfterFunc(time.Second, fire)
time.Sleep(500 * time.Millisecond)
t.Reset(time.Second) // returns true
```

This is the common case. The timer is on the heap. `Reset` moves its `when` to `now + 1s`, i.e., `T0 + 1.5s`. The callback fires once, at `T0 + 1.5s`.

### Reset on a fired timer

```go
t := time.AfterFunc(100*time.Millisecond, fire)
time.Sleep(500 * time.Millisecond) // fire has already happened
t.Reset(time.Second) // returns false; schedules a new fire
```

The boolean is `false` ("the timer was not active"). The Reset still puts an entry back in the heap, and the callback runs again at `T0 + 1.5s`. So `Reset` on an expired AfterFunc timer is fine — it just refires.

### Reset on a stopped timer

```go
t := time.AfterFunc(time.Second, fire)
t.Stop() // returns true
t.Reset(time.Second) // returns false; schedules a fresh fire
```

Same story. Reset adds a heap entry. Returns `false` because the timer was already stopped.

### When the boolean matters: channel-style timers

For a `time.NewTimer(d)` timer, `Reset`'s historical caveat was:

> If the timer has fired and you have not yet drained `t.C`, calling `Reset` may leave a stale value on `t.C` from the previous fire.

The canonical idiom (Go < 1.23) was:

```go
if !t.Stop() {
    <-t.C // drain
}
t.Reset(d)
```

For Go 1.23+ this is no longer required — the standard library was reworked so that `Reset` is safe to call without the drain dance. But you will see the old pattern in millions of lines of production code.

For `AfterFunc` timers, `C` is nil and there is nothing to drain. The pattern simplifies to `t.Reset(d)`.

### Reset and the callback in flight

What if the callback is **currently running** (was just fired) and you call `Reset`? The runtime allows this. The timer is rearmed for `now + d`. The current callback continues running (the goroutine has it; the runtime cannot revoke it). When `now + d` elapses, the runtime spawns a *new* goroutine to run the callback again.

This means two callback goroutines can be alive simultaneously: the previous one still finishing, and the new one starting. Your callback must be reentrant — or you must serialise externally (lock, channel, sync.Once for a one-time effect).

```go
var mu sync.Mutex
work := func() {
    mu.Lock()
    defer mu.Unlock()
    doStuff()
}
t := time.AfterFunc(d, work)
t.Reset(d) // could result in two queued executions
```

If `work` runs longer than `d`, the lock serialises them, but each one still has to wait. If you want "at most one in flight," use `sync.Once`-flavoured guards or a state flag.

### Reset versus Stop+AfterFunc

```go
// Pattern A: Stop + new AfterFunc (creates a new runtime timer)
t.Stop()
t = time.AfterFunc(d, f)

// Pattern B: Reset on the existing timer
t.Reset(d)
```

Pattern B is strictly cheaper:

- No allocation of a new `Timer` struct.
- No new closure created (you reuse the same `f`).
- One lock acquisition and heap operation instead of two.

When the callback is identical, prefer Reset. When the callback changes (different captured data), you must create a new timer — but consider redesigning to capture only an index or ID and look up state in a shared structure.

### Reset before first Stop is a no-op?

No. `Reset` works on any timer, whether or not you have called `Stop`. It does not require a prior `Stop`.

### Reset thread safety

`Reset` is safe to call from any goroutine. But you cannot rely on the return value if other goroutines are also touching the timer. For example, in the following code:

```go
go t.Stop()
go t.Reset(d)
```

Both calls succeed (no race in the strict sense — the runtime serialises) but the *outcome* depends on which ran first. If `Stop` ran first, `Reset` rearms a stopped timer (callback will run). If `Reset` ran first, `Stop` cancels the rearmed timer.

The safe rule: serialise `Stop` and `Reset` for the same timer through a mutex you own, or use atomic flags to coordinate the outer logic.

---

## Stop vs Fire: The Real Race

The single most subtle issue with `AfterFunc` is the moment when a `Stop` call and a fire-and-callback coincide.

### The races, enumerated

Let `S` = caller's call to `Stop`, `F` = runtime's pop-from-heap-and-spawn, `C` = callback running, `E` = callback done.

| Ordering | Stop returns | Callback runs? |
|---|---|---|
| `S` then `F` | true | No (F finds nothing) |
| `S` after callback already done (`E < S`) | false | Already done |
| `S` between `F` and `C` start | false | Yes (already scheduled) |
| `S` during `C` | false | Yes (in progress) |
| `S` never called, runtime expires | n/a | Yes |
| Two concurrent `S` calls, first wins | first true, second false | No |
| Two concurrent `S` and `Reset` | one wins | depends |

The interesting cases are 3 and 4: `Stop` returns `false`, but the callback either has not started yet or is in the middle of running.

For the caller, the only thing distinguishable from outside is the return value of `Stop`. From `false` alone you cannot tell whether the callback:

- has finished long ago,
- is running right now,
- is about to start in microseconds,
- has been queued but not yet picked up by a P.

### Why this matters

If your callback is idempotent and has no side effects you care about, you don't care. The vast majority of timers in vast majority of code fall into this category. `Stop` returning `false` is just information for logging.

If your callback has side effects — sending a message, deleting a file, closing a channel — you need to engineer your code so that `Stop` + callback can both happen safely. There are several patterns:

### Pattern P1: Idempotent callback

Make the callback safe to call multiple times and safe to "miss." Logging, sweepers, metric flushes are usually fine.

```go
time.AfterFunc(d, func() {
    log.Println("late event")
})
```

Even if you `Stop` after fire, you just get one extra log line. Not a bug.

### Pattern P2: Guard flag inside the callback

```go
var fired atomic.Bool

t := time.AfterFunc(d, func() {
    if !fired.CompareAndSwap(false, true) {
        return
    }
    expensiveAction()
})

if t.Stop() {
    fired.Store(true) // defensive: prevent any racing fire from also running
}
```

The CAS in the callback ensures it runs at most once. The `Stop`-side `Store(true)` prevents a callback that already scheduled but not yet started from running.

This is the most useful pattern for "do something exactly once, but maybe never."

### Pattern P3: Wait for the callback to finish

If you need to know "after Stop returned, can I be sure the callback is done?", you must wait.

```go
done := make(chan struct{})
t := time.AfterFunc(d, func() {
    defer close(done)
    f()
})

if t.Stop() {
    // The callback will not run; done is never closed
    return
}
<-done // wait for the in-flight callback to finish
```

But you have to be careful — if `Stop` returns `true`, `done` is never closed. The combined idiom:

```go
done := make(chan struct{})
t := time.AfterFunc(d, func() {
    defer close(done)
    f()
})

if t.Stop() {
    return // stopped before fire; done is never closed; we don't care
}
<-done // callback was already scheduled or in flight; wait
```

`context.AfterFunc` (next section) gives you a one-line version of this idiom.

### Pattern P4: Channel-coordinated "winner-takes-all"

Sometimes the deadline timer races against a worker. The winner's value goes on the channel:

```go
out := make(chan result, 1)

t := time.AfterFunc(d, func() {
    select {
    case out <- result{err: errors.New("timeout")}:
    default:
    }
})
defer t.Stop()

go func() {
    select {
    case out <- doWork():
    default:
    }
}()

r := <-out
```

The buffered channel of size 1 plus `select { default }` ensures the loser does not block. Even if the timer fires after work succeeds, the timer's `<-` is the loser, takes the `default` branch, and exits.

### Pattern P5: Use context.AfterFunc

The 1.21 API has all of this engineered in. See below.

---

## The Callback's Goroutine, Closely Examined

### Spawn semantics

The runtime, when it pops an AfterFunc timer from the heap, executes the equivalent of `go f()`. This spawn:

- Allocates a fresh goroutine (or grabs one from the runtime's pool).
- Starts the goroutine on the currently running P, or assigns it elsewhere if the P is busy.
- The new goroutine begins executing `f`.

The spawn is cheap (a few hundred nanoseconds), but it is not free. For very high-frequency timers, the goroutine churn shows up in profiles.

### Identity

The new goroutine has no parent-child relationship with the caller. There is no "thread-local" state preserved. Anything you want the callback to know must be in the closure.

### Stack

The callback goroutine starts with a small stack (~2 KB) like any other goroutine, growing as needed.

### Panic propagation

A panic in the callback's goroutine propagates only through that goroutine. It does not reach the caller. If nothing in the callback recovers, the runtime's default panic handler runs, which prints the stack and terminates the program.

This is the same rule as for any goroutine: unrecovered panic = program crash. The runtime does **not** provide an implicit recover around your callback. You must `defer recover()` if you want to survive.

### Multiple callbacks in parallel

Two timers expiring at the same time spawn two goroutines, which run in parallel (subject to GOMAXPROCS). If their callbacks touch shared state, you need a mutex or atomics.

### Self-restart via Reset

A callback can `Reset` its own timer:

```go
var f func()
var t *time.Timer
f = func() {
    work()
    t.Reset(time.Second)
}
t = time.AfterFunc(time.Second, f)
```

This is a clean self-rescheduling pattern. Each `Reset` schedules the *next* firing in 1 s after the *current callback called Reset*, which gives "1 s after the work finished" semantics (not "every 1 s on a strict schedule"). If you want strict periodicity, use `Ticker`.

### Callback time vs scheduled time

The runtime guarantees that the callback fires *no earlier than* `d` after the `AfterFunc` call. It does **not** guarantee it fires *exactly* at `d`. Under load, the callback may run hundreds of milliseconds late. If you need wall-clock precision better than ~10 ms under load, timers in user-space Go are not the right tool.

---

## context.AfterFunc (Go 1.21)

Go 1.21 introduced `context.AfterFunc`:

```go
func AfterFunc(ctx context.Context, f func()) (stop func() bool)
```

It registers `f` to run *when ctx is cancelled* — either explicitly via the cancel function returned by `WithCancel` etc., or implicitly via the deadline of a `WithTimeout` / `WithDeadline`.

This is **the** modern primitive for "do this when the context goes away."

### The basic example

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

stop := context.AfterFunc(ctx, func() {
    log.Println("ctx cancelled; cleanup")
})
defer stop()

doWork(ctx)
```

If `ctx` is cancelled (deadline reached or explicit cancel) before `doWork` returns, the callback runs (in its own goroutine). If `doWork` finishes first, the deferred `stop()` unregisters the callback so it never runs.

### Comparison: time.AfterFunc vs context.AfterFunc

| Aspect | `time.AfterFunc` | `context.AfterFunc` |
|---|---|---|
| Triggered by | Duration elapsing | Context cancellation |
| Runs callback | In a new goroutine | In a new goroutine |
| Return | `*time.Timer` | `func() bool` |
| Cancellable | `t.Stop()` | `stop()` |
| Returns "was callback prevented" | `Stop()` boolean | `stop()` boolean |
| Synchronises with callback | No | `stop()` returns true iff prevented; if false, callback is running/done |
| Reset | Yes | No (one-shot) |

### `stop` semantics

`stop()` returns:

- `true` — the callback has not started and now will not. (You "stopped" it.)
- `false` — the callback has already started or completed (or the context never cancelled, in which case `stop` is also `false`).

Critically, when `stop()` returns `false` because the callback has fired, `stop` does **not** wait for it to finish. Like `time.Timer.Stop()`, it is non-blocking.

### Why this is the modern idiom

Before Go 1.21 you wrote:

```go
go func() {
    select {
    case <-ctx.Done():
        cleanup()
    case <-doneCh:
    }
}()
```

This spawns a parked goroutine that just waits. Multiply by every request in a high-traffic server and the goroutine count balloons.

`context.AfterFunc` does the same thing without parking a goroutine. The runtime registers a callback on the context and spawns a goroutine only at cancellation.

### Common usage patterns

#### Pattern: cleanup when a request is cancelled

```go
func Handle(ctx context.Context, r *Request) {
    stop := context.AfterFunc(ctx, func() {
        r.Close()
    })
    defer stop()
    // do work, possibly long-running
}
```

#### Pattern: cleanup when an outer context cancels

```go
func backgroundJob(ctx context.Context) {
    work := newWorker()
    stop := context.AfterFunc(ctx, work.Shutdown)
    defer stop()
    work.Run()
}
```

#### Pattern: race a deadline against work, with cleanup

```go
func race(ctx context.Context, work func() result) (result, error) {
    out := make(chan result, 1)
    stop := context.AfterFunc(ctx, func() {
        // ctx cancelled; nothing here, the select handles it
    })
    defer stop()

    go func() {
        out <- work()
    }()

    select {
    case r := <-out:
        return r, nil
    case <-ctx.Done():
        return result{}, ctx.Err()
    }
}
```

(In this case the `context.AfterFunc` is actually unnecessary — the `select { case <-ctx.Done() }` handles it. But it shows the API surface.)

#### Pattern: short-lived in-process subscriber

```go
type Bus struct {
    mu   sync.Mutex
    subs map[*sub]struct{}
}

func (b *Bus) Subscribe(ctx context.Context, fn func(Event)) {
    s := &sub{fn: fn}
    b.mu.Lock()
    b.subs[s] = struct{}{}
    b.mu.Unlock()

    context.AfterFunc(ctx, func() {
        b.mu.Lock()
        delete(b.subs, s)
        b.mu.Unlock()
    })
}
```

When the caller's context cancels, the subscription is automatically removed. Compare with: spawning a goroutine that waits on `ctx.Done` — much worse at scale.

### When to prefer time.AfterFunc

Use `time.AfterFunc` when:

- The trigger is purely a duration (no context).
- You need `Reset` semantics.
- You need to fire repeatedly via self-rescheduling.

Use `context.AfterFunc` when:

- The trigger is context cancellation.
- You want clean "cancel on context done" without a parked goroutine.
- You want the cleanest possible code for context-driven lifecycle.

In modern Go services, the bulk of timer-like cleanup logic should be `context.AfterFunc`. `time.AfterFunc` remains the right primitive for "fire after this specific duration" where there is no context.

### Misconception: context.AfterFunc replaces time.AfterFunc

It does not. They have different triggers. A context-driven service often uses both — `context.AfterFunc` to clean up on cancel, `time.AfterFunc` to schedule retries.

### Implementation note

Internally, `context.AfterFunc` is implemented in terms of a goroutine in early prototypes, and in the final version using a callback-style registration on the context's cancellation. The user-visible behaviour is "fires on cancel in a new goroutine." For our purposes we treat it as black-box correct.

---

## Hardened Patterns

These are versions of the junior-level patterns that survive contact with production.

### Hardened debouncer

```go
type Debouncer struct {
    mu      sync.Mutex
    timer   *time.Timer
    delay   time.Duration
    fn      func()
    gen     uint64
}

func NewDebouncer(d time.Duration, fn func()) *Debouncer {
    return &Debouncer{delay: d, fn: fn}
}

func (db *Debouncer) Trigger() {
    db.mu.Lock()
    db.gen++
    g := db.gen
    if db.timer != nil {
        db.timer.Stop()
    }
    db.timer = time.AfterFunc(db.delay, func() {
        db.mu.Lock()
        if db.gen != g {
            db.mu.Unlock()
            return // a newer trigger superseded us
        }
        db.mu.Unlock()
        db.fn()
    })
    db.mu.Unlock()
}

func (db *Debouncer) Cancel() {
    db.mu.Lock()
    db.gen++
    if db.timer != nil {
        db.timer.Stop()
    }
    db.mu.Unlock()
}
```

The `gen` (generation) counter is the key. Each `Trigger` increments it. The callback captures the generation at scheduling time and refuses to fire if it has been superseded. This handles the `Stop`-returned-false-but-callback-is-running race cleanly.

### Hardened watchdog

```go
type Watchdog struct {
    mu      sync.Mutex
    timer   *time.Timer
    timeout time.Duration
    fired   atomic.Bool
    onFire  func()
}

func NewWatchdog(timeout time.Duration, onFire func()) *Watchdog {
    w := &Watchdog{timeout: timeout, onFire: onFire}
    w.start()
    return w
}

func (w *Watchdog) start() {
    w.mu.Lock()
    defer w.mu.Unlock()
    w.timer = time.AfterFunc(w.timeout, w.fire)
}

func (w *Watchdog) fire() {
    if !w.fired.CompareAndSwap(false, true) {
        return
    }
    w.onFire()
}

func (w *Watchdog) Touch() bool {
    w.mu.Lock()
    defer w.mu.Unlock()
    if w.fired.Load() {
        return false
    }
    w.timer.Reset(w.timeout)
    return true
}

func (w *Watchdog) Stop() {
    w.mu.Lock()
    defer w.mu.Unlock()
    w.fired.Store(true)
    w.timer.Stop()
}
```

The `fired` flag is the single source of truth. `fire` uses CAS to ensure the action runs at most once. `Touch` returns whether the watchdog is still alive. `Stop` marks fired and stops the timer — even if `Stop` loses the race, the CAS in `fire` prevents the action.

### Hardened idle-timeout connection

```go
type IdleConn struct {
    mu      sync.Mutex
    timer   *time.Timer
    timeout time.Duration
    closed  bool
    onClose func()
}

func NewIdleConn(timeout time.Duration, onClose func()) *IdleConn {
    c := &IdleConn{timeout: timeout, onClose: onClose}
    c.timer = time.AfterFunc(timeout, c.close)
    return c
}

func (c *IdleConn) Touch() {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.closed {
        return
    }
    c.timer.Reset(c.timeout)
}

func (c *IdleConn) Close() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.timer.Stop()
    if !c.closed {
        c.closed = true
        c.onClose()
    }
}

func (c *IdleConn) close() {
    c.mu.Lock()
    if c.closed {
        c.mu.Unlock()
        return
    }
    c.closed = true
    c.mu.Unlock()
    c.onClose()
}
```

Two `Close` paths — explicit and timer-fired — both protected by the `closed` flag.

### Hardened "do once after delay, but also support immediate cancel"

```go
type Deferred struct {
    once sync.Once
    t    *time.Timer
    fn   func()
}

func After(d time.Duration, fn func()) *Deferred {
    df := &Deferred{fn: fn}
    df.t = time.AfterFunc(d, df.run)
    return df
}

func (d *Deferred) run() {
    d.once.Do(d.fn)
}

func (d *Deferred) Cancel() {
    d.once.Do(func() {}) // claim the "once" without running fn
    d.t.Stop()
}
```

`sync.Once` makes "run at most once" easy. `Cancel` claims the Once with a no-op, then stops the timer for cleanliness.

If the timer was already in flight when `Cancel` runs, the callback will reach the `Once.Do` first and the cancel will see Once-already-done, doing nothing. That is fine — the work has already happened.

Wait, that's not what we want. We want `Cancel` to *prevent* the work. The fix: have `Cancel` claim Once *first*, then call `Stop`. The Once-once-claimed callback's run becomes a no-op. Let me rewrite:

```go
type Deferred struct {
    mu        sync.Mutex
    t         *time.Timer
    fn        func()
    cancelled bool
    done      bool
}

func After(d time.Duration, fn func()) *Deferred {
    df := &Deferred{fn: fn}
    df.t = time.AfterFunc(d, df.run)
    return df
}

func (d *Deferred) run() {
    d.mu.Lock()
    if d.cancelled || d.done {
        d.mu.Unlock()
        return
    }
    d.done = true
    fn := d.fn
    d.mu.Unlock()
    fn()
}

func (d *Deferred) Cancel() bool {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.done {
        return false
    }
    d.cancelled = true
    d.t.Stop()
    return true
}
```

`Cancel` returns `true` iff it stopped the work from running. If `Cancel` runs while the callback is sitting at the lock, it acquires first, sets cancelled, releases — then the callback runs, sees cancelled, returns. Clean.

### Hardened single-flight retry

```go
type Retry struct {
    mu      sync.Mutex
    timer   *time.Timer
    attempt int
    op      func() error
}

func (r *Retry) start() {
    r.mu.Lock()
    defer r.mu.Unlock()
    backoff := time.Duration(1<<r.attempt) * 50 * time.Millisecond
    if backoff > 10*time.Second {
        backoff = 10 * time.Second
    }
    r.timer = time.AfterFunc(backoff, r.tryOnce)
}

func (r *Retry) tryOnce() {
    err := r.op()
    if err == nil {
        return
    }
    r.mu.Lock()
    r.attempt++
    r.mu.Unlock()
    r.start()
}

func (r *Retry) Cancel() {
    r.mu.Lock()
    defer r.mu.Unlock()
    if r.timer != nil {
        r.timer.Stop()
    }
}
```

This retries with exponential backoff up to 10 s. `Cancel` stops the next attempt; an in-flight attempt continues. If you need to abort in-flight work too, pass a context to `r.op`.

### Hardened deadline gate

A deadline gate races a result against a timeout. The first one wins; the loser is harmless.

```go
type DeadlineGate struct {
    out chan result
    t   *time.Timer
}

func NewDeadlineGate(d time.Duration) *DeadlineGate {
    g := &DeadlineGate{out: make(chan result, 1)}
    g.t = time.AfterFunc(d, func() {
        select {
        case g.out <- result{err: errDeadline}:
        default:
        }
    })
    return g
}

func (g *DeadlineGate) Set(v interface{}, err error) {
    g.t.Stop()
    select {
    case g.out <- result{v: v, err: err}:
    default:
    }
}

func (g *DeadlineGate) Wait() (interface{}, error) {
    r := <-g.out
    return r.v, r.err
}
```

`Set` and the timer race for the single-slot buffered channel. Whoever lost takes the default branch and exits without blocking. `Stop` is best-effort.

---

## Common Misuses at This Level

### Misuse 1: Calling Reset on a `nil` timer

```go
var t *time.Timer
t.Reset(d) // nil deref panic
```

Initialise the timer first.

### Misuse 2: Drain dance on AfterFunc timer

```go
if !t.Stop() {
    <-t.C // BAD: t.C is nil; deadlocks
}
t.Reset(d)
```

The drain dance applies only to channel-style timers. Never drain `t.C` for an `AfterFunc` timer.

### Misuse 3: Believing Reset's return tells you about the callback

`Reset` returning `true` means "the timer was active before this call." It does **not** mean "the callback ran" or "the callback did not run." Forget about the boolean for AfterFunc.

### Misuse 4: Mixing channel-style and callback-style on one timer

```go
t := time.AfterFunc(d, f)
go func() { <-t.C }() // wait forever on nil channel
```

An AfterFunc timer's `C` is nil. If you wanted a channel, use `NewTimer`.

### Misuse 5: Treating callbacks as cheap when there are millions

A million AfterFuncs creates a million heap entries and, at fire time, a million goroutine spawns. The runtime handles it but the spawn burst is visible. For high-cardinality timers, consider:

- Batching: one timer for many entries, sweeping a data structure.
- Coalescing: fire every minute, process all entries due in that minute.
- Pre-aggregating: sort by deadline, use a single timer for the next deadline.

We'll see real implementations of these at senior and professional levels.

### Misuse 6: Recursive Reset that triggers itself

```go
var t *time.Timer
t = time.AfterFunc(d, func() {
    t.Reset(d) // infinite loop, fine but unbounded
})
```

This is fine if you mean it (a self-resetting timer that never stops). It is a bug if you forget to add a stop condition.

### Misuse 7: Using AfterFunc to communicate

```go
// BAD
var result string
time.AfterFunc(d, func() {
    result = "done"
})
time.Sleep(d + time.Second)
fmt.Println(result)
```

The shared variable `result` is read by main and written by the callback. Data race. Use a channel or `sync/atomic`.

---

## Memory and the Captured Closure

### How the closure is held

When you call `time.AfterFunc(d, f)`, the runtime stores `f` in the timer entry. As long as the timer entry exists (in the heap or being executed), `f` is reachable from the GC's perspective. `f` reaches anything it closes over.

After the callback exits, the timer entry is removed and `f` becomes unreachable (assuming no other references).

### Leak scenario 1: long timer captures large struct

```go
func process(r *BigRequest) {
    time.AfterFunc(time.Hour, func() {
        log.Println("late:", r.ID)
    })
}
```

`r` (potentially MBs) is pinned for an hour. Fix: capture only `r.ID`.

### Leak scenario 2: timer in a map, map outlives timer

```go
type Cache struct {
    timers map[string]*time.Timer
}
```

If you store the timer pointer in a map and never delete it, the timer keeps its closure alive even after fire. Fix: delete map entries when timers fire.

### Leak scenario 3: timer never stops

```go
func (s *Session) StartTimeout() {
    time.AfterFunc(time.Hour, s.timeoutCallback)
}
```

The session's `timeoutCallback` is captured (along with `s`). The timer fires after an hour regardless of whether the session is still alive. If sessions are created and discarded faster than they expire, every discarded session has a pending timer pinning its memory.

Fix: capture the return value and stop the timer when the session ends.

### Detection: heap profile

`pprof` will show a high count of `runtime.timer` allocations and a long retention chain back to `time.AfterFunc`. The fix is one of:

- Stop timers explicitly.
- Capture less in the closure.
- Use `context.AfterFunc` and let the context cleanup handle it.

### Rule of thumb

For every `time.AfterFunc` in a long-running service, you should be able to answer:

- How long can this timer be pending?
- How many can be pending simultaneously?
- What does the closure capture?
- When does the timer get stopped or fire?

If you cannot answer all four, audit the call site.

---

## Testing Timer-Based Code

### Problem: real time makes tests slow and flaky

```go
func TestIdleClose(t *testing.T) {
    c := NewIdleConn(30*time.Second, mock.Close)
    time.Sleep(31 * time.Second) // tests take 31 seconds!
    require.True(t, mock.WasClosed)
}
```

Two options.

### Option 1: shorten durations in tests

Parameterise the timeout:

```go
func TestIdleClose(t *testing.T) {
    c := NewIdleConn(50*time.Millisecond, mock.Close)
    time.Sleep(100 * time.Millisecond)
    require.True(t, mock.WasClosed)
}
```

Works, but is slightly flaky on heavily loaded CI machines. Use a generous margin.

### Option 2: inject a clock

Define an interface:

```go
type Clock interface {
    Now() time.Time
    AfterFunc(d time.Duration, f func()) StoppableTimer
}

type StoppableTimer interface {
    Stop() bool
    Reset(d time.Duration) bool
}
```

In production, wire up a real-time implementation. In tests, wire up a fake clock that you advance manually:

```go
clk := newFakeClock()
c := NewIdleConn(30*time.Second, mock.Close, clk)
clk.Advance(31 * time.Second)
require.True(t, mock.WasClosed)
```

The fake clock's `Advance` triggers all registered timers whose `when` has passed, synchronously. Tests run instantly and are deterministic.

Libraries to consider:

- `github.com/benbjohnson/clock`
- `github.com/jonboulle/clockwork`
- standard library `testing/synctest` (Go 1.24+)

### Verifying callback synchronisation

Some tests assert "callback ran exactly once" or "callback did not run." Don't measure with `Sleep`; use a counter:

```go
var calls atomic.Int64
time.AfterFunc(d, func() { calls.Add(1) })
// wait for fire by polling counter, with a generous bound
deadline := time.Now().Add(2 * time.Second)
for time.Now().Before(deadline) {
    if calls.Load() == 1 {
        return
    }
    time.Sleep(time.Millisecond)
}
t.Fatal("callback did not run")
```

Or, better, use a channel:

```go
fired := make(chan struct{}, 1)
time.AfterFunc(d, func() { fired <- struct{}{} })
select {
case <-fired:
case <-time.After(time.Second):
    t.Fatal("did not fire")
}
```

### Race detector and AfterFunc

Always run timer-heavy tests with `-race`. The detector will catch any unsynchronised shared-state access between the callback goroutine and the test goroutine.

---

## Interaction with Mutexes

### Holding a lock while calling AfterFunc

Fine. `AfterFunc` does not call any user code synchronously; it just allocates a timer entry and returns.

```go
func (s *Service) Schedule(d time.Duration) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.timer = time.AfterFunc(d, s.fire)
}
```

The callback runs later on a fresh goroutine. By then `s.mu` is released. The callback can re-acquire `s.mu` if needed.

### Holding a lock inside a callback

Fine. The callback is just a goroutine.

```go
func (s *Service) fire() {
    s.mu.Lock()
    defer s.mu.Unlock()
    // do work
}
```

### Deadlock risk: locking order inversion

```go
func (a *A) M(b *B) {
    a.mu.Lock()
    defer a.mu.Unlock()
    time.AfterFunc(d, func() {
        b.mu.Lock()
        defer b.mu.Unlock()
        a.someMethod() // takes a.mu — DEADLOCK if a.mu still held
    })
}
```

The callback runs much later, after `a.mu` has been released. So this specific example is actually fine. The deadlock risk comes from synchronous calls inside the callback that need a lock the caller-thread holds — but the caller-thread has released by the time the callback runs. **Usually**, then, AfterFunc callbacks have lower deadlock risk than synchronous code.

Where deadlock *does* arise: if the callback's lock-acquisition order disagrees with another part of your program. Standard rule — always acquire locks in a consistent order — applies.

### Stopping a timer while holding the timer's "natural" lock

```go
type T struct {
    mu    sync.Mutex
    timer *time.Timer
}

func (t *T) Fire() {
    t.mu.Lock()
    defer t.mu.Unlock()
    // do work
}

func (t *T) Stop() {
    t.mu.Lock()
    defer t.mu.Unlock()
    t.timer.Stop()
}
```

If `Stop` is called while the callback is *inside* `Fire`, the callback holds `mu`, and `Stop` waits. Then `Stop` calls `t.timer.Stop()`, which returns `false`. Fine. The callback finishes; the lock is released; `Stop` resumes.

This works because `Stop` is non-blocking from the timer's perspective. The lock-wait is on `mu`, not on the timer.

---

## Interaction with Channels

### Sending from a callback

```go
ch := make(chan struct{}, 1)
time.AfterFunc(d, func() {
    select {
    case ch <- struct{}{}:
    default:
    }
})
```

Non-blocking send avoids leaking the callback goroutine if nobody reads.

### Receiving in the callback

```go
in := make(chan int, 1)
time.AfterFunc(d, func() {
    select {
    case v := <-in:
        process(v)
    case <-time.After(time.Second):
        // give up
    }
})
```

Be very careful with blocking receives. A callback that blocks forever holds its goroutine forever — a leak.

### Closing a channel from a callback

```go
done := make(chan struct{})
time.AfterFunc(d, func() {
    close(done)
})
```

Idiomatic for "signal fired." Be sure no one else closes `done` (double-close panics).

### Sending to a closed channel from a callback

Panic. Always guard:

```go
var once sync.Once
ch := make(chan struct{})
time.AfterFunc(d, func() {
    once.Do(func() { close(ch) })
})
```

---

## Mid-Level Exercises

### Exercise 1
Implement a `Once(d, f)` that schedules `f` to run after `d`, but guarantees it runs at most once even if you call `Stop` and `Reset` repeatedly. Provide a `Stop` that prevents `f` from running if it has not yet started.

### Exercise 2
Build a `Debouncer` that calls `fn` at most once per "quiet period" of `d`. Triggers within the quiet period reset the period. Use the generation-counter pattern.

### Exercise 3
Implement an `IdleConn` with `Touch`, `Close`, and a callback fired after `d` of inactivity. The callback must not race with explicit `Close`.

### Exercise 4
Write `WithTimeout(d, op)` that runs `op` and returns its result or `errors.New("timeout")` if `op` takes longer than `d`. Use a buffered channel of size 1.

### Exercise 5
Implement a `Watchdog` that fires `onTimeout` if no `Touch` arrives within `d`. After firing, the watchdog is "tripped" and additional `Touch`es do nothing. Verify with a test using a fake clock.

### Exercise 6
Build a TTL cache where entries expire individually after their TTLs. Then build the same cache using a single sweeper goroutine and a sorted list of deadlines. Benchmark them at 10k, 100k, 1M entries.

### Exercise 7
Write a `SelfRescheduler` that calls `fn` every `d`, but skips calls if `fn` is still running from the previous tick. Compare to a simple `time.NewTicker` loop.

### Exercise 8
Implement `BackoffRetry(op, max)` that retries `op` with exponential backoff, capped at `max` retries. Use `AfterFunc` for each retry. Make it cancellable.

### Exercise 9
Write a `BatchScheduler` that accepts events with deadlines; when the earliest deadline expires, it fires the callback with all events that have expired since the last fire. Use one `AfterFunc` and `Reset` instead of one timer per event.

### Exercise 10
Use `context.AfterFunc` to implement a "request cleanup" helper: registered cleanups run when the request context cancels, in reverse order of registration.

---

## Mid-Level Tricky Questions

**Q1.** What is the difference between `Stop` returning `false` because the timer fired, and `Stop` returning `false` because it was already stopped?

**A.** From the caller's perspective, none — both look the same. From the runtime's perspective, the first means the callback either ran or is about to run; the second means the callback never ran. If you need to distinguish, maintain your own state (a flag set by the callback).

**Q2.** Can two callback goroutines for the same timer be alive at the same time?

**A.** Yes, if you call `Reset` while the previous callback is still running. The runtime spawns a new goroutine for the new fire; the previous one is still running on its own goroutine.

**Q3.** What happens if you call `Reset` from inside the callback?

**A.** The timer is rearmed for `now + d` (where `now` is the time of the Reset call). When the callback exits, the timer is still pending. The next fire happens after `d` from the Reset call.

**Q4.** Why is `context.AfterFunc` better than `go func() { <-ctx.Done(); f() }()`?

**A.** No parked goroutine. At scale (thousands of contexts per second), the goroutine count is significantly lower. Also, `context.AfterFunc` returns a stop function that is non-blocking and cheap.

**Q5.** If you call `Stop` and `Reset` concurrently on the same timer, what happens?

**A.** The runtime serialises them. The outcome depends on which acquired the lock first. There is no data race, but the *logical* result is not deterministic. Coordinate at the application level.

**Q6.** Can you pass `nil` to `AfterFunc`'s second argument?

**A.** It compiles but panics at fire time (nil function call). Don't.

**Q7.** Why does `time.After` allocate more than `time.AfterFunc`?

**A.** `time.After` returns a `<-chan Time` plus the channel and a timer entry. `AfterFunc` returns a `*Timer` and a timer entry (no channel). For one-shot use, the difference is one channel; for tight loops, this adds up.

**Q8.** If a callback panics and `recover`s, does the timer keep working?

**A.** The timer was one-shot to begin with. The panic-and-recover doesn't affect future timers. If the panic was *not* recovered, the program crashes.

**Q9.** Can you `Stop` a timer multiple times?

**A.** Yes. After the first effective Stop (or fire), subsequent Stops return `false` and are no-ops.

**Q10.** What happens if you `Stop` after `Reset`?

**A.** Standard behaviour. `Reset` put the timer back on the heap; `Stop` tries to remove it. If still on the heap, it returns true; otherwise false.

**Q11.** Is the order in which two timers expiring at the same nanosecond deterministic?

**A.** No.

**Q12.** Why does the standard library not provide a "wait for callback to finish" function on `*time.Timer`?

**A.** Because it would require either blocking inside `Stop` (could deadlock if the callback tries to do anything that waits on the caller) or maintaining a "done" channel internally. The library leaves that to the caller. `context.AfterFunc` returns a `stop` that *also* doesn't wait, by the same reasoning.

**Q13.** Does `t.Stop()` allocate?

**A.** Should not, in practice. It only mutates an existing timer entry.

**Q14.** Does `time.AfterFunc(0, f)` differ from `go f()`?

**A.** `AfterFunc(0, f)` goes through the timer machinery — heap insertion, scheduler poll, then goroutine spawn. `go f()` is direct. Both end up running `f` on a new goroutine, but `go f()` is cheaper and clearer when you mean "right now."

**Q15.** Can you start a goroutine inside an `AfterFunc` callback?

**A.** Yes, but track that goroutine separately. The callback returning does not wait for goroutines it spawned.

---

## Cheat Sheet

```go
// Modern context-driven cleanup (Go 1.21+)
stop := context.AfterFunc(ctx, cleanup)
defer stop()

// One-shot delay with cancel
t := time.AfterFunc(d, f)
defer t.Stop()

// Idempotent fire-or-stop
var fired atomic.Bool
t := time.AfterFunc(d, func() {
    if fired.CompareAndSwap(false, true) {
        f()
    }
})
if t.Stop() {
    fired.Store(true)
}

// Wait for callback to finish (when it might be in flight)
done := make(chan struct{})
t := time.AfterFunc(d, func() {
    defer close(done)
    f()
})
if !t.Stop() {
    <-done
}

// Self-rescheduling with reentry guard
var running atomic.Bool
var tick func()
tick = func() {
    if !running.CompareAndSwap(false, true) {
        return
    }
    defer running.Store(false)
    work()
    time.AfterFunc(d, tick)
}
time.AfterFunc(d, tick)

// Debouncer with generation
type DB struct {
    mu  sync.Mutex
    g   uint64
    t   *time.Timer
    d   time.Duration
    fn  func()
}
func (db *DB) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    db.g++
    g := db.g
    if db.t != nil {
        db.t.Stop()
    }
    db.t = time.AfterFunc(db.d, func() {
        db.mu.Lock()
        if db.g != g { db.mu.Unlock(); return }
        db.mu.Unlock()
        db.fn()
    })
}
```

---

## Self-Assessment

You are ready for the senior level when:

- [ ] You can sketch `Reset`'s behaviour for active / fired / stopped timers, and you know the boolean's meaning for each.
- [ ] You can list at least three orderings of `Stop` and fire and predict the outcome.
- [ ] You can write a debouncer, a watchdog, and an idle timer with correct synchronisation.
- [ ] You can explain when to use `context.AfterFunc` vs `time.AfterFunc`.
- [ ] You can refactor a closure-pinning callback to capture only the small data it needs.
- [ ] You can test timer-driven code without sleeping for real seconds.

---

## Summary

The middle level of `AfterFunc` is about engineering. The primitive is small, but its interactions with goroutines, locks, channels, and contexts produce a wide design space.

Key takeaways:

- `Reset` rearms; the boolean is rarely useful for `AfterFunc` timers.
- `Stop` and fire can interleave; design for the worst-case interleaving.
- Use guard flags, generation counters, or buffered channels to handle the race.
- `context.AfterFunc` (Go 1.21+) is the modern primitive for context-driven cleanup. Use it.
- Closure capture pins memory; capture small IDs, not large structs.
- Test with injected clocks for determinism.

The senior file dives below the API surface: the runtime timer heap, the cost model, how the runtime decides when to wake a P to fire a timer.

---

## What You Can Build

With middle-level knowledge you can build:

- A robust idle-connection sweeper for a TCP or HTTP/2 server.
- A rate limiter with both bucket refill and burst detection.
- A debouncer for user input that survives high event rates.
- A deadline gate for downstream RPC calls.
- A self-rescheduling cleanup loop with no-overlap semantics.
- A test harness that simulates time deterministically.

---

## Further Reading

- Go 1.21 release notes — `context.AfterFunc`
- Go 1.23 release notes — timer cleanup behaviour
- Russ Cox, "Go runtime: 4 years later"
- The `runtime/time.go` source file in the Go standard library

---

## Related Topics

- `07-concurrency/02-channels` — receive patterns, especially the buffered-channel-of-size-1 idiom
- `07-concurrency/04-mutexes-and-rwmutex` — the mutex patterns used in the hardened examples
- `07-concurrency/06-sync-once` — `sync.Once` as a guard for one-shot side effects
- `07-concurrency/12-context` — `context.WithTimeout`, `WithDeadline`, `AfterFunc`

---

## Diagrams

### Stop-vs-fire interleavings

```
Heap pop time --- (F) ---
Stop call time --- (S) ---

S < F        : Stop wins, callback never runs, Stop=true
S = F        : Race; outcome depends on runtime
F < S < C    : Stop loses; callback scheduled but not yet started; Stop=false
F < C < S    : Stop loses; callback running or done; Stop=false
```

### context.AfterFunc lifecycle

```
ctx [active] -- AfterFunc(ctx, f) --> registration
                                          |
        [ctx cancels]                     |
                  \                       |
                   +--- spawn goroutine -- runs f
                                              \
                                               exits
```

### Generation counter debouncer

```
trigger() -> gen=1, schedule(d, capture gen=1)
trigger() -> gen=2, stop prev, schedule(d, capture gen=2)
[d elapses for first schedule]
callback for gen=1: db.gen != 1, return
[d elapses for second schedule]
callback for gen=2: db.gen == 2, fire
```

---

## Appendix A: Detailed walkthrough of context.AfterFunc

This appendix supplements the main body with a step-by-step inspection of `context.AfterFunc` behaviour.

### The signature

```go
func AfterFunc(ctx Context, f func()) (stop func() bool)
```

- `ctx` — the context whose cancellation triggers `f`.
- `f` — the callback. Runs in a freshly spawned goroutine.
- Returns `stop` — call it to prevent `f` from being invoked, **if** the context has not cancelled yet.

### Behaviour matrix

| State at `stop()` call | `stop()` returns | Callback runs? |
|---|---|---|
| Ctx not cancelled; callback not registered for fire | true | No |
| Ctx already cancelled; callback already started or finished | false | Yes (cannot revoke) |
| Ctx already cancelled; callback hasn't been scheduled yet (rare edge) | false | Possibly |
| Stop has already been called | false | No |

### A minimal example

```go
ctx, cancel := context.WithCancel(context.Background())
stop := context.AfterFunc(ctx, func() {
    fmt.Println("cleanup")
})
cancel()
time.Sleep(50 * time.Millisecond)
fmt.Println(stop()) // false — already fired
```

Output:

```
cleanup
false
```

### Cancellation timing

The exact moment `f` fires after a cancel is not specified. Empirically it is within microseconds on an unloaded machine. Don't assert wall-clock bounds in tests.

### Composition with multiple AfterFuncs

You can register many callbacks on one context:

```go
ctx, cancel := context.WithCancel(context.Background())
context.AfterFunc(ctx, func() { fmt.Println("a") })
context.AfterFunc(ctx, func() { fmt.Println("b") })
context.AfterFunc(ctx, func() { fmt.Println("c") })
cancel()
time.Sleep(50 * time.Millisecond)
```

All three callbacks run when the context cancels. Order is not guaranteed.

### Memory implications

Each registered callback holds a reference to the closure (and what it captures) for as long as the context is alive. If you accumulate many `AfterFunc`s on a long-lived context, you accumulate closures.

`stop()` unregisters and releases the reference promptly. Always call `stop` (typically deferred) when the work is done so the registration is cleaned up.

### Nested contexts

```go
parent, cancelP := context.WithCancel(context.Background())
child, cancelC := context.WithCancel(parent)

context.AfterFunc(child, func() { fmt.Println("on child cancel") })
cancelP() // cancels parent, which cancels child
```

The callback runs because child cancels. The standard cancellation propagation works as you expect.

### Race against the context

There is a race between "user calls cancel" and "user calls stop." Both can complete before the callback is even scheduled. The library handles it: if cancel happens first, the callback is scheduled. If stop happens first, it returns true. If they race, one wins, the other returns the appropriate false.

### Performance

`context.AfterFunc` is implemented to avoid spawning a parked goroutine per registration. Internally it uses a callback list on the context. At cancellation, one goroutine iterates the list, scheduling each callback.

This is fundamentally cheaper than the pre-1.21 `go func() { <-ctx.Done(); f() }()` pattern, especially at high registration rates.

---

## Appendix B: Detailed walkthrough of Reset

### The (post-1.23) story

For Go 1.23+, `Reset` semantics are simplified:

1. Lock the timer.
2. If the timer is in the heap, remove it. (This is "the timer was active.")
3. Set `when = now + d`.
4. Insert into the heap.
5. Return whether the timer had been active.

There is no need to drain `t.C` before `Reset`. The runtime handles the channel cleanly.

### The pre-1.23 story

Before Go 1.23, the canonical idiom for resetting a channel-style timer was:

```go
if !t.Stop() {
    <-t.C // drain in case the timer fired between our check and now
}
t.Reset(d)
```

The reason: a value could already be in `t.C` from a previous fire. `Reset` would not drain it; the next receive could pick up the stale value.

For `AfterFunc` timers, this dance was always unnecessary — `C` is nil.

### Reset on an expired AfterFunc timer

```go
t := time.AfterFunc(50*time.Millisecond, fire)
time.Sleep(200*time.Millisecond) // expires
t.Reset(50*time.Millisecond) // fires again at t0+250ms
```

Legal. `fire` runs twice — once at t0+50ms, once at t0+250ms.

### Reset on a stopped AfterFunc timer

```go
t := time.AfterFunc(50*time.Millisecond, fire)
t.Stop() // before fire
t.Reset(100*time.Millisecond) // fires at now+100ms
```

Legal. `fire` runs once, at the reset time.

### Reset from inside the callback

A common pattern:

```go
var t *time.Timer
t = time.AfterFunc(d, func() {
    if shouldContinue() {
        t.Reset(d)
    }
})
```

This is a self-rescheduling timer with a stop condition. Note: the `t` variable must be declared before the `AfterFunc` call so the closure can capture it. (You can't reference a variable in its own initialiser.)

### Reset when another goroutine has the lock

If your callback holds a lock that the goroutine calling `Reset` also wants, the `Reset` call may block. But `Reset` does not itself take any user-defined lock — only the runtime's timer lock. So `Reset` is non-blocking from the user's lock perspective.

### Reset versus newer time.NewTimer

For a non-AfterFunc timer (one created with `NewTimer`), reset semantics in Go 1.23+ are cleaner: no drain dance. For `AfterFunc` timers, there was never a drain dance.

---

## Appendix C: Closure Patterns Reference

### Capture by value

```go
x := 42
time.AfterFunc(d, func() {
    fmt.Println(x) // captures x by reference
})
x = 100
// callback prints 100
```

To capture by value, shadow:

```go
x := 42
x2 := x
time.AfterFunc(d, func() {
    fmt.Println(x2) // x2 is fresh; not affected by x=100
})
x = 100
```

### Capture a pointer

```go
type T struct { Value int }
t := &T{Value: 1}
time.AfterFunc(d, func() {
    fmt.Println(t.Value) // captures pointer
})
t.Value = 99
// callback prints 99
```

### Capture a slice header

Slices are tricky:

```go
s := []int{1, 2, 3}
time.AfterFunc(d, func() {
    fmt.Println(s) // captures slice header
})
s = append(s, 4) // may or may not affect underlying array
```

If `append` reallocates, the callback sees the original. If not, both share. To pin:

```go
s := []int{1, 2, 3}
sCopy := append([]int(nil), s...)
time.AfterFunc(d, func() {
    fmt.Println(sCopy)
})
```

### Capture a map

```go
m := map[string]int{"a": 1}
time.AfterFunc(d, func() {
    fmt.Println(m["a"]) // captures map header
})
m["a"] = 99
// callback prints 99
```

Maps are reference types; capture sees mutations.

### Capture a method

```go
type C struct { name string }
func (c *C) hello() { fmt.Println("hi from", c.name) }

c := &C{name: "x"}
time.AfterFunc(d, c.hello)
// at fire time, calls c.hello() — uses the c pointer captured in the method value
```

`c.hello` is a method value. It captures `c` by pointer. Changing `c.name` before fire will be visible:

```go
c.name = "y"
// callback prints "hi from y"
```

### Capture nothing

```go
time.AfterFunc(d, doGlobalCleanup)
```

No captures. The callback is just a plain function value. Cheapest.

---

## Appendix D: Cookbook of "do this once when X happens"

A common pattern is "do this exactly once when something fires." Here are five flavours.

### When a duration elapses, but cancellable

```go
type Once struct {
    once  sync.Once
    t     *time.Timer
    fn    func()
}

func DoOnceAfter(d time.Duration, fn func()) *Once {
    o := &Once{fn: fn}
    o.t = time.AfterFunc(d, func() {
        o.once.Do(o.fn)
    })
    return o
}

func (o *Once) Cancel() bool {
    didStop := o.t.Stop()
    // Try to claim Once before any callback can
    claimed := false
    o.once.Do(func() {
        claimed = true
    })
    return didStop || claimed
}
```

### When a context cancels

```go
stop := context.AfterFunc(ctx, fn) // already exactly-once
defer stop()
```

### When either of two contexts cancels

```go
fired := atomic.Bool{}
runOnce := func() {
    if fired.CompareAndSwap(false, true) {
        fn()
    }
}
s1 := context.AfterFunc(ctx1, runOnce)
s2 := context.AfterFunc(ctx2, runOnce)
defer s1()
defer s2()
```

### When a channel closes

```go
go func() {
    <-ch
    fn()
}()
```

A goroutine waits on the channel. Simple. Costs a parked goroutine; for a few subscribers this is fine.

### When all of several goroutines finish

```go
var wg sync.WaitGroup
wg.Add(n)
// ... start goroutines, each calling wg.Done() ...
go func() {
    wg.Wait()
    fn()
}()
```

---

## Appendix E: Mid-level FAQ

**Q.** Should I always use `context.AfterFunc` instead of `time.AfterFunc`?

**A.** No. Use `context.AfterFunc` for context-driven cleanup; `time.AfterFunc` for duration-driven scheduling.

**Q.** Is `Reset` atomic?

**A.** Yes from the runtime's perspective; the timer's lock is held during the operation.

**Q.** Can I use `AfterFunc` for sub-millisecond timing?

**A.** It works, but precision is not guaranteed. Under load you may see 100s of microseconds of jitter. For sub-millisecond accuracy use OS-level timers or busy-wait — both have their own problems.

**Q.** What is the maximum number of timers I can have?

**A.** No hard limit. Production services routinely run with hundreds of thousands. At millions, profiling and tuning are needed; consider batching strategies.

**Q.** Does `AfterFunc` work after the main goroutine has called `os.Exit`?

**A.** No. `os.Exit` exits the process immediately; no deferred cleanup, no timer firing.

**Q.** What about after `runtime.Goexit` in main?

**A.** `runtime.Goexit` from main causes the program to crash with "no goroutines (main called runtime.Goexit)". Don't do that.

**Q.** Can timers be persisted across restarts?

**A.** No. Timers are in-memory only. If you need durable schedules, write them to a database and reload on startup.

**Q.** Why does `time.AfterFunc(0, ...)` exist?

**A.** Useful when a duration is computed and might be 0 or negative. Edge cases — the result is "fire as soon as possible."

**Q.** Can I check whether a timer has fired without trying to Stop it?

**A.** Not from the standard library. Maintain your own flag.

**Q.** Why doesn't `t.Stop()` accept a "drain" boolean?

**A.** It's a minimal API. The drain dance was an idiom, not a feature.

---

## Appendix F: Detailed Stop and Reset State Diagram

Below is a thorough state machine for an `AfterFunc` timer. Each transition is annotated with the operation that triggers it and the boolean returned (if applicable).

```
State definitions:
- ARMED       : timer entry is in the runtime heap, awaiting fire
- POPPED      : runtime has removed the entry; spawning callback goroutine
- RUNNING     : callback goroutine is currently executing f()
- DONE        : callback has finished; no further state changes unless Reset
- STOPPED     : Stop has removed the entry from heap; callback never ran
```

```
[ARMED] --(fire)--> [POPPED] --(spawn)--> [RUNNING] --(f returns)--> [DONE]
   |
   +--(Stop)--> [STOPPED]
   |   ^
   |   |
   |   +--(Stop)--> [STOPPED] (returns false; was already stopped)
   |
   +--(Reset(d))--> [ARMED, new when]
                      (returns true; was active)

[POPPED] / [RUNNING]:
   Stop returns false; cannot revoke; callback runs or finishes.
   Reset(d) re-arms; second callback goroutine may run concurrently.

[DONE]:
   Stop returns false (was not active).
   Reset(d) re-arms; callback runs again.

[STOPPED]:
   Stop returns false (already stopped).
   Reset(d) re-arms; callback runs.
```

The crucial insight: there are five logical states, but `Stop`'s boolean only distinguishes "was ARMED" from "not ARMED." The caller cannot tell DONE from POPPED from RUNNING from STOPPED from the boolean.

---

## Appendix G: Twenty Mid-Level Snippets

### G.1 — A nested AfterFunc inside the callback

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    done := make(chan struct{})
    time.AfterFunc(50*time.Millisecond, func() {
        fmt.Println("outer fired")
        time.AfterFunc(50*time.Millisecond, func() {
            fmt.Println("inner fired")
            close(done)
        })
    })
    <-done
}
```

Output:

```
outer fired
inner fired
```

Two timers, two goroutines, one channel signal. The outer goroutine has returned by the time the inner one runs.

### G.2 — Reset from inside the callback

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

func main() {
    var t *time.Timer
    var count atomic.Int64

    t = time.AfterFunc(50*time.Millisecond, func() {
        n := count.Add(1)
        fmt.Println("tick", n)
        if n < 5 {
            t.Reset(50 * time.Millisecond)
        }
    })

    time.Sleep(500 * time.Millisecond)
    fmt.Println("done")
}
```

Output:

```
tick 1
tick 2
tick 3
tick 4
tick 5
done
```

A bounded self-rescheduling timer.

### G.3 — Stop returns false but callback already running

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

    t := time.AfterFunc(0, func() { // fires almost immediately
        time.Sleep(100 * time.Millisecond) // do "work"
        fmt.Println("done work")
        wg.Done()
    })

    // By now the callback is mid-Sleep
    time.Sleep(50 * time.Millisecond)
    fmt.Println("stop returned:", t.Stop())

    wg.Wait()
}
```

Output (approximate):

```
stop returned: false
done work
```

`Stop` returned `false` because the timer had already fired and the callback was inside `Sleep`. The callback continues running to completion.

### G.4 — Generation counter debouncer in action

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Debouncer struct {
    mu    sync.Mutex
    g     uint64
    timer *time.Timer
    d     time.Duration
    fn    func(uint64)
}

func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    db.g++
    g := db.g
    if db.timer != nil {
        db.timer.Stop()
    }
    db.timer = time.AfterFunc(db.d, func() {
        db.mu.Lock()
        if db.g != g {
            db.mu.Unlock()
            return
        }
        db.mu.Unlock()
        db.fn(g)
    })
}

func main() {
    db := &Debouncer{d: 50 * time.Millisecond, fn: func(g uint64) {
        fmt.Println("fire gen", g)
    }}

    for i := 0; i < 5; i++ {
        db.Trigger()
        time.Sleep(20 * time.Millisecond)
    }
    time.Sleep(200 * time.Millisecond)
}
```

Output:

```
fire gen 5
```

Only the final generation fires. The earlier four are superseded.

### G.5 — context.AfterFunc cleanup

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()

    stop := context.AfterFunc(ctx, func() {
        fmt.Println("cleanup ran")
    })
    defer stop()

    time.Sleep(200 * time.Millisecond)
    fmt.Println("main saw timeout")
}
```

Output:

```
cleanup ran
main saw timeout
```

`stop()` returns false because the cleanup already ran. The defer is harmless.

### G.6 — context.AfterFunc with manual cancel

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())

    stop := context.AfterFunc(ctx, func() {
        fmt.Println("cleanup ran")
    })

    fmt.Println("doing work")
    time.Sleep(50 * time.Millisecond)
    fmt.Println("work done; calling stop:", stop())
    cancel()
    time.Sleep(50 * time.Millisecond)
    fmt.Println("end")
}
```

Output:

```
doing work
work done; calling stop: true
end
```

`stop()` returns `true` because the callback hadn't run yet. Subsequent `cancel()` is now harmless from the AfterFunc's perspective.

### G.7 — Stop-then-Reset race shielded by Once

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    var once sync.Once
    fire := func() {
        once.Do(func() {
            fmt.Println("fired once")
        })
    }

    t := time.AfterFunc(50*time.Millisecond, fire)
    time.Sleep(20 * time.Millisecond)
    t.Stop()
    t.Reset(20 * time.Millisecond)

    time.Sleep(200 * time.Millisecond)
}
```

Output:

```
fired once
```

Whether or not multiple fires race, `sync.Once` guarantees at most one effect.

### G.8 — Watchdog stops itself

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

type Watchdog struct {
    timer   *time.Timer
    timeout time.Duration
    fired   atomic.Bool
}

func New(timeout time.Duration, onFire func()) *Watchdog {
    w := &Watchdog{timeout: timeout}
    w.timer = time.AfterFunc(timeout, func() {
        if w.fired.CompareAndSwap(false, true) {
            onFire()
        }
    })
    return w
}

func (w *Watchdog) Touch() bool {
    if w.fired.Load() {
        return false
    }
    return w.timer.Reset(w.timeout)
}

func (w *Watchdog) Stop() {
    w.fired.Store(true)
    w.timer.Stop()
}

func main() {
    w := New(100*time.Millisecond, func() {
        fmt.Println("BARK")
    })

    for i := 0; i < 3; i++ {
        time.Sleep(50 * time.Millisecond)
        w.Touch()
    }
    fmt.Println("stopping touches")
    time.Sleep(200 * time.Millisecond)
    w.Stop()
    fmt.Println("end")
}
```

Output:

```
stopping touches
BARK
end
```

### G.9 — Idle conn with race-safe Close

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type IdleConn struct {
    mu      sync.Mutex
    timer   *time.Timer
    timeout time.Duration
    closed  bool
}

func New(timeout time.Duration) *IdleConn {
    c := &IdleConn{timeout: timeout}
    c.timer = time.AfterFunc(timeout, c.close)
    return c
}

func (c *IdleConn) close() {
    c.mu.Lock()
    if c.closed {
        c.mu.Unlock()
        return
    }
    c.closed = true
    c.mu.Unlock()
    fmt.Println("closed")
}

func (c *IdleConn) Use() {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.closed {
        return
    }
    c.timer.Reset(c.timeout)
}

func (c *IdleConn) Close() {
    c.timer.Stop()
    c.close()
}

func main() {
    c := New(100 * time.Millisecond)
    c.Use()
    time.Sleep(50 * time.Millisecond)
    c.Use()
    time.Sleep(200 * time.Millisecond)
    c.Close() // idempotent
}
```

Output:

```
closed
```

Despite the explicit close and the timer fire, only one "closed" prints.

### G.10 — Buffered single-result channel

```go
package main

import (
    "errors"
    "fmt"
    "time"
)

type result struct {
    v   string
    err error
}

func withTimeout(d time.Duration, op func() string) (string, error) {
    out := make(chan result, 1)
    t := time.AfterFunc(d, func() {
        select {
        case out <- result{err: errors.New("timeout")}:
        default:
        }
    })
    defer t.Stop()

    go func() {
        v := op()
        select {
        case out <- result{v: v}:
        default:
        }
    }()

    r := <-out
    return r.v, r.err
}

func main() {
    v, err := withTimeout(50*time.Millisecond, func() string {
        time.Sleep(20 * time.Millisecond)
        return "fast"
    })
    fmt.Println(v, err)

    v, err = withTimeout(20*time.Millisecond, func() string {
        time.Sleep(50 * time.Millisecond)
        return "slow"
    })
    fmt.Println(v, err)
}
```

Output:

```
fast <nil>
 timeout
```

### G.11 — Self-rescheduling with reentry guard

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

func main() {
    var running atomic.Bool
    var tick func()
    tick = func() {
        if !running.CompareAndSwap(false, true) {
            fmt.Println("skip; previous still running")
            return
        }
        defer running.Store(false)

        fmt.Println("work start")
        time.Sleep(150 * time.Millisecond) // longer than period
        fmt.Println("work end")
        time.AfterFunc(50*time.Millisecond, tick)
    }
    time.AfterFunc(50*time.Millisecond, tick)
    time.Sleep(time.Second)
}
```

Output (approximate):

```
work start
work end
work start
work end
work start
work end
```

The reentry guard prevents overlap; the work serialises.

### G.12 — Subscribe with context.AfterFunc cleanup

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Bus struct {
    mu   sync.Mutex
    subs map[int]chan string
    next int
}

func NewBus() *Bus {
    return &Bus{subs: map[int]chan string{}}
}

func (b *Bus) Subscribe(ctx context.Context) <-chan string {
    b.mu.Lock()
    id := b.next
    b.next++
    ch := make(chan string, 16)
    b.subs[id] = ch
    b.mu.Unlock()

    context.AfterFunc(ctx, func() {
        b.mu.Lock()
        delete(b.subs, id)
        close(ch)
        b.mu.Unlock()
    })

    return ch
}

func (b *Bus) Pub(msg string) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for _, ch := range b.subs {
        select {
        case ch <- msg:
        default:
        }
    }
}

func main() {
    bus := NewBus()
    ctx, cancel := context.WithCancel(context.Background())
    ch := bus.Subscribe(ctx)

    bus.Pub("hello")
    fmt.Println(<-ch)

    cancel()
    time.Sleep(50 * time.Millisecond)
    msg, ok := <-ch
    fmt.Println(msg, ok)
}
```

Output:

```
hello
 false
```

After cancel the channel is closed; subsequent receives return the zero value with `ok=false`.

### G.13 — Capturing only an ID

```go
package main

import (
    "fmt"
    "time"
)

type BigRequest struct {
    ID   string
    Data [1024]byte
}

func (r *BigRequest) StartIdleTimer(d time.Duration) *time.Timer {
    id := r.ID
    return time.AfterFunc(d, func() {
        fmt.Println("late:", id)
    })
}

func main() {
    r := &BigRequest{ID: "abc-123"}
    t := r.StartIdleTimer(50 * time.Millisecond)
    _ = t
    time.Sleep(100 * time.Millisecond)
}
```

Capturing `id` instead of `r` means the `Data` array can be GC'd as soon as `r` goes out of scope (or `r` itself can be freed if main returns).

### G.14 — Discovering Stop's race interleaving

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

func main() {
    var wg sync.WaitGroup
    var trueCount, falseCount atomic.Int64

    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            t := time.AfterFunc(time.Microsecond, func() {})
            time.Sleep(time.Microsecond)
            if t.Stop() {
                trueCount.Add(1)
            } else {
                falseCount.Add(1)
            }
        }()
    }
    wg.Wait()
    fmt.Println("Stop=true:", trueCount.Load())
    fmt.Println("Stop=false:", falseCount.Load())
}
```

A statistical demonstration that `Stop` returns sometimes true and sometimes false when called at approximately the fire moment.

### G.15 — TTL cache with one sweeper instead of per-entry timers

```go
package main

import (
    "fmt"
    "sort"
    "sync"
    "time"
)

type entry struct {
    key     string
    expires time.Time
}

type Cache struct {
    mu      sync.Mutex
    items   map[string]string
    expiry  map[string]time.Time
    timer   *time.Timer
}

func (c *Cache) Set(k, v string, ttl time.Duration) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.items == nil {
        c.items = map[string]string{}
        c.expiry = map[string]time.Time{}
    }
    c.items[k] = v
    c.expiry[k] = time.Now().Add(ttl)
    c.scheduleSweepLocked()
}

func (c *Cache) scheduleSweepLocked() {
    earliest := time.Time{}
    for _, e := range c.expiry {
        if earliest.IsZero() || e.Before(earliest) {
            earliest = e
        }
    }
    if earliest.IsZero() {
        return
    }
    d := time.Until(earliest)
    if d < 0 {
        d = 0
    }
    if c.timer != nil {
        c.timer.Stop()
    }
    c.timer = time.AfterFunc(d, c.sweep)
}

func (c *Cache) sweep() {
    c.mu.Lock()
    defer c.mu.Unlock()
    now := time.Now()
    type expired struct {
        k string
    }
    var toDel []expired
    for k, e := range c.expiry {
        if !now.Before(e) {
            toDel = append(toDel, expired{k})
        }
    }
    for _, x := range toDel {
        delete(c.items, x.k)
        delete(c.expiry, x.k)
    }
    c.scheduleSweepLocked()
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    v, ok := c.items[k]
    return v, ok
}

func main() {
    c := &Cache{}
    c.Set("a", "1", 100*time.Millisecond)
    c.Set("b", "2", 200*time.Millisecond)
    c.Set("c", "3", 300*time.Millisecond)

    for _, d := range []time.Duration{50, 150, 250, 350} {
        time.Sleep(d*time.Millisecond - time.Now().Sub(time.Now()))
        _ = sort.Slice
        for _, k := range []string{"a", "b", "c"} {
            v, ok := c.Get(k)
            fmt.Printf("%dms %s=%q,%v ", d, k, v, ok)
        }
        fmt.Println()
    }
}
```

A single timer is reused across all entries, fired at the next deadline. This pattern scales much better than one-timer-per-entry.

### G.16 — A "do at" wrapper

```go
package main

import (
    "fmt"
    "time"
)

func DoAt(at time.Time, fn func()) *time.Timer {
    d := time.Until(at)
    if d < 0 {
        d = 0
    }
    return time.AfterFunc(d, fn)
}

func main() {
    DoAt(time.Now().Add(50*time.Millisecond), func() {
        fmt.Println("on time")
    })
    DoAt(time.Now().Add(-time.Second), func() {
        fmt.Println("past")
    })
    time.Sleep(200 * time.Millisecond)
}
```

Output:

```
past
on time
```

The past-due timer fires almost immediately because `time.AfterFunc(0, ...)`.

### G.17 — Hooking AfterFunc into a context

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func After(ctx context.Context, d time.Duration, fn func()) {
    t := time.AfterFunc(d, fn)
    context.AfterFunc(ctx, func() {
        t.Stop()
    })
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    After(ctx, 50*time.Millisecond, func() {
        fmt.Println("ran")
    })

    cancel()
    time.Sleep(100 * time.Millisecond)
    fmt.Println("end")
}
```

Output:

```
end
```

The context cancellation stops the timer before fire. Useful when you have lots of duration-based timers tied to a request lifetime.

### G.18 — A barrier of N AfterFuncs

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

func After(n int, d time.Duration, fn func()) {
    var fired atomic.Int64
    f := func() {
        if fired.Add(1) == int64(n) {
            fn()
        }
    }
    for i := 0; i < n; i++ {
        time.AfterFunc(d, f)
    }
}

func main() {
    After(3, 50*time.Millisecond, func() {
        fmt.Println("all three fired")
    })
    time.Sleep(200 * time.Millisecond)
}
```

Output:

```
all three fired
```

A barrier: the final callback to fire triggers the action.

### G.19 — AfterFunc with retry on failure

```go
package main

import (
    "errors"
    "fmt"
    "math/rand"
    "sync"
    "time"
)

type Job struct {
    mu      sync.Mutex
    attempt int
    op      func() error
    timer   *time.Timer
    onDone  func(error)
}

func (j *Job) run() {
    err := j.op()
    if err == nil {
        j.onDone(nil)
        return
    }
    j.mu.Lock()
    j.attempt++
    if j.attempt > 5 {
        j.mu.Unlock()
        j.onDone(fmt.Errorf("gave up: %w", err))
        return
    }
    backoff := time.Duration(1<<j.attempt) * 10 * time.Millisecond
    j.timer = time.AfterFunc(backoff, j.run)
    j.mu.Unlock()
}

func (j *Job) Cancel() {
    j.mu.Lock()
    defer j.mu.Unlock()
    if j.timer != nil {
        j.timer.Stop()
    }
}

func main() {
    j := &Job{
        op: func() error {
            if rand.Intn(3) == 0 {
                return nil
            }
            return errors.New("transient")
        },
        onDone: func(err error) {
            fmt.Println("done:", err)
        },
    }
    go j.run()
    time.Sleep(time.Second)
}
```

A self-retrying job with backoff and a manual cancel.

### G.20 — Coalescing many events into one flush

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Flusher struct {
    mu     sync.Mutex
    buffer []string
    timer  *time.Timer
    delay  time.Duration
    fn     func([]string)
}

func New(delay time.Duration, fn func([]string)) *Flusher {
    return &Flusher{delay: delay, fn: fn}
}

func (f *Flusher) Add(s string) {
    f.mu.Lock()
    defer f.mu.Unlock()
    f.buffer = append(f.buffer, s)
    if f.timer == nil {
        f.timer = time.AfterFunc(f.delay, f.flush)
    }
}

func (f *Flusher) flush() {
    f.mu.Lock()
    items := f.buffer
    f.buffer = nil
    f.timer = nil
    f.mu.Unlock()
    f.fn(items)
}

func main() {
    f := New(50*time.Millisecond, func(items []string) {
        fmt.Println("flush:", items)
    })

    for i := 0; i < 10; i++ {
        f.Add(fmt.Sprintf("item-%d", i))
        time.Sleep(10 * time.Millisecond)
    }
    time.Sleep(100 * time.Millisecond)
}
```

The flusher coalesces additions within a 50 ms window into a single call. Common in metric exporters, log shippers, and write-batching layers.

---

## Appendix H: Reading List for the Curious

If you want to go deeper before tackling `senior.md`:

- **The runtime/time.go source.** Reading the actual Go source for timer scheduling is by far the fastest way to internalise the model.
- **The Go 1.23 release notes section on timers.** The recent simplification of `Reset` semantics is documented there.
- **Russ Cox's "Go's timing precision" blog post** — historical discussion of why Go timers are not super-precise.
- **The `context` package design** — how Go 1.21 added `AfterFunc` and what problem it solves.
- **"The Go Programming Language" by Donovan & Kernighan** — the timer chapter remains a solid foundation.
- **`testing/synctest` (Go 1.24+)** — synthetic time for deterministic concurrency tests.

---

## Appendix I: What changed across Go versions

A short version-history of `AfterFunc`-relevant changes.

- **Go 1.0 (2012)**: `time.AfterFunc`, `Stop`, `Reset` released.
- **Go 1.1**: minor optimisations in the timer heap.
- **Go 1.10**: `time.Now` and timers integrated with the monotonic clock; timers are not affected by wall-clock adjustments.
- **Go 1.14**: async preemption; long-running callbacks can be preempted by the runtime.
- **Go 1.21**: `context.AfterFunc` added.
- **Go 1.23**: timer cleanup overhaul — abandoned timers can be GC'd promptly; `Reset` no longer requires the drain dance on `NewTimer` timers.
- **Go 1.24**: `testing/synctest` for time-deterministic tests.

If you are on Go 1.20 or older, plan to upgrade. The 1.21+ APIs (`context.AfterFunc`) and the 1.23+ Reset cleanup are significant quality-of-life improvements.

---

## Appendix J: A quick test for your understanding

Predict the output of each, then run.

**T1.**
```go
t := time.AfterFunc(100*time.Millisecond, func(){
    fmt.Println("a")
})
fmt.Println(t.Stop())
time.Sleep(200*time.Millisecond)
```

**T2.**
```go
t := time.AfterFunc(100*time.Millisecond, func(){
    fmt.Println("a")
})
time.Sleep(200*time.Millisecond)
fmt.Println(t.Stop())
```

**T3.**
```go
t := time.AfterFunc(100*time.Millisecond, func(){
    fmt.Println("a")
})
t.Stop()
fmt.Println(t.Reset(100*time.Millisecond))
time.Sleep(200*time.Millisecond)
```

**T4.**
```go
ctx, cancel := context.WithCancel(context.Background())
stop := context.AfterFunc(ctx, func(){ fmt.Println("a") })
fmt.Println(stop())
cancel()
time.Sleep(50*time.Millisecond)
```

**T5.**
```go
ctx, cancel := context.WithCancel(context.Background())
stop := context.AfterFunc(ctx, func(){ fmt.Println("a") })
cancel()
time.Sleep(50*time.Millisecond)
fmt.Println(stop())
```

**Answers**:

- T1: `true`, then nothing (callback prevented).
- T2: `a`, then `false`.
- T3: `false` (Reset on stopped → was not active), then `a` ~100 ms later.
- T4: `true`, callback never runs.
- T5: `a`, then `false`.

---

End of middle-level material. See `senior.md` for runtime internals, the timer heap, and `Stop`/`Reset` return value semantics in depth.

