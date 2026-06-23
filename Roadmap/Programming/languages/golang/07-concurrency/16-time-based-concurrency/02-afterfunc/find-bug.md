---
layout: default
title: Find Bug
parent: AfterFunc
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/02-afterfunc/find-bug/
---

# time.AfterFunc — Find the Bug

Eleven snippets. Each has a real, plausible bug. Find it before reading the answer.

---

## Bug 1: Stop-vs-fire race

```go
type Doer struct {
    t     *time.Timer
    fired bool
}

func New() *Doer {
    d := &Doer{}
    d.t = time.AfterFunc(100*time.Millisecond, func() {
        d.fired = true
        sendNotification()
    })
    return d
}

func (d *Doer) Cancel() {
    d.t.Stop()
}
```

**What's the bug?**

After reading, scroll down.

---

### Bug 1: answer

`Cancel` may return `false` (callback in flight). If so, the callback runs, sets `fired = true`, and sends a notification — even though we wanted to cancel.

Also: `fired` is written from the callback goroutine and not synchronised. Data race.

Fix:

```go
type Doer struct {
    t     *time.Timer
    fired atomic.Bool
}

func New() *Doer {
    d := &Doer{}
    d.t = time.AfterFunc(100*time.Millisecond, func() {
        if !d.fired.CompareAndSwap(false, true) {
            return
        }
        sendNotification()
    })
    return d
}

func (d *Doer) Cancel() {
    d.fired.Store(true)
    d.t.Stop()
}
```

Now the callback checks `fired` before doing work, and `Cancel` sets it to true before stopping. Even if Cancel loses the race, the callback aborts.

---

## Bug 2: Closure captures wrong variable

```go
func scheduleAll(items []string) {
    for i := 0; i < len(items); i++ {
        time.AfterFunc(time.Duration(i+1)*time.Second, func() {
            fmt.Println(items[i])
        })
    }
}
```

**What's the bug?**

---

### Bug 2: answer

Pre-Go 1.22: all closures capture the same `i`. When they fire, `i == len(items)`, which is out-of-bounds — panic with "index out of range."

Fix (any Go version):

```go
func scheduleAll(items []string) {
    for i := 0; i < len(items); i++ {
        i := i // shadow
        time.AfterFunc(time.Duration(i+1)*time.Second, func() {
            fmt.Println(items[i])
        })
    }
}
```

Go 1.22+: the loop already does this for you.

---

## Bug 3: Reset on nil timer

```go
type Watchdog struct {
    timer   *time.Timer
    timeout time.Duration
}

func (w *Watchdog) Touch() {
    w.timer.Reset(w.timeout)
}
```

**What's the bug?**

---

### Bug 3: answer

If `Touch` is called before the timer is initialised (e.g., before some `Start` method), `w.timer` is nil — `Reset` panics with nil pointer deref.

Fix: initialise in constructor, or guard.

```go
func (w *Watchdog) Touch() {
    if w.timer == nil {
        return
    }
    w.timer.Reset(w.timeout)
}
```

Or better: ensure construction is always complete:

```go
func NewWatchdog(timeout time.Duration, onFire func()) *Watchdog {
    w := &Watchdog{timeout: timeout}
    w.timer = time.AfterFunc(timeout, onFire)
    return w
}
```

---

## Bug 4: Panic in callback crashes the program

```go
time.AfterFunc(time.Second, func() {
    result := mightFail()
    process(result.Data) // result may be nil
})
```

**What's the bug?**

---

### Bug 4: answer

If `result` is nil, `result.Data` panics. The panic is unrecovered. Program crashes.

Fix: defensive coding plus panic recovery.

```go
time.AfterFunc(time.Second, func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("callback panic: %v", r)
        }
    }()
    result := mightFail()
    if result == nil {
        log.Println("got nil result; skipping")
        return
    }
    process(result.Data)
})
```

---

## Bug 5: Captured *Request pinned forever

```go
type Server struct {
    timers map[string]*time.Timer
}

func (s *Server) Handle(r *http.Request) {
    s.timers[r.URL.Path] = time.AfterFunc(time.Hour, func() {
        log.Printf("late request from %s: %s", r.RemoteAddr, r.URL.Path)
    })
}
```

**What's the bug?**

---

### Bug 5: answer

Two bugs:

1. The closure captures `r` (the entire `*http.Request`). For an hour, `r` is pinned in memory.
2. The map `s.timers` is unsynchronised — concurrent requests cause a data race.
3. Also: `s.timers[r.URL.Path]` accumulates; old timers' closures are pinned even after fire.

Fix:

```go
func (s *Server) Handle(r *http.Request) {
    addr := r.RemoteAddr
    path := r.URL.Path
    s.mu.Lock()
    if old, ok := s.timers[path]; ok {
        old.Stop()
    }
    s.timers[path] = time.AfterFunc(time.Hour, func() {
        s.mu.Lock()
        delete(s.timers, path)
        s.mu.Unlock()
        log.Printf("late request from %s: %s", addr, path)
    })
    s.mu.Unlock()
}
```

Also: an hour-long timer per request is suspicious. Audit whether this is really needed.

---

## Bug 6: Polling for fire

```go
fired := false
time.AfterFunc(100*time.Millisecond, func() {
    fired = true
})
for !fired {
    time.Sleep(time.Millisecond)
}
fmt.Println("done")
```

**What's the bug?**

---

### Bug 6: answer

Two:

1. `fired` is written and read without synchronisation. Data race.
2. The polling defeats the point of the callback; just block on a channel.

Fix:

```go
done := make(chan struct{})
time.AfterFunc(100*time.Millisecond, func() {
    close(done)
})
<-done
fmt.Println("done")
```

---

## Bug 7: Reading t.C for an AfterFunc

```go
t := time.AfterFunc(100*time.Millisecond, work)
<-t.C
fmt.Println("done")
```

**What's the bug?**

---

### Bug 7: answer

`t.C` is nil for AfterFunc timers. Reading from a nil channel blocks forever. Deadlock.

Fix: don't read t.C. Use a `done` channel that the callback closes, or use `time.NewTimer` if you want channel semantics.

```go
done := make(chan struct{})
time.AfterFunc(100*time.Millisecond, func() {
    work()
    close(done)
})
<-done
```

---

## Bug 8: defer inside a loop

```go
for _, item := range items {
    t := time.AfterFunc(time.Second, func() { cleanup(item) })
    defer t.Stop()
    process(item)
}
```

**What's the bug?**

---

### Bug 8: answer

Two:

1. The `defer` accumulates. All `Stop`s run at function exit, after the loop. By then, all timers have fired — and `cleanup(item)` has run for each. The `Stop`s are no-ops.
2. The closure captures `item` (pre Go 1.22 — same loop variable across iterations).

Fix:

```go
for _, it := range items {
    it := it // pre 1.22
    t := time.AfterFunc(time.Second, func() { cleanup(it) })
    process(it)
    t.Stop() // explicit, not deferred
}
```

Or restructure so `Stop`s aren't needed.

---

## Bug 9: Reset on a stopped timer's return value misinterpreted

```go
t := time.AfterFunc(time.Second, fn)
t.Stop()
// later:
if t.Reset(time.Second) {
    fmt.Println("was active")
} else {
    fmt.Println("was not active")
}
```

**What's the bug?**

---

### Bug 9: answer

The print is technically correct (the timer was stopped, so "was not active") but misleading: many readers think `Reset` returning true means "the new timer will fire" and false means "it won't." Both fire.

The boolean only reflects prior state. For AfterFunc, this is rarely useful info. Many bugs come from misinterpreting it.

Fix: ignore the return value, or document what you're using it for.

```go
t.Reset(time.Second) // ignoring return; the callback will fire
```

---

## Bug 10: Concurrent Stop/Reset without coordination

```go
type Job struct {
    timer *time.Timer
}

func (j *Job) Reschedule(d time.Duration) {
    j.timer.Reset(d)
}

func (j *Job) Cancel() {
    j.timer.Stop()
}
```

**What's the bug?**

---

### Bug 10: answer

If `Reschedule` and `Cancel` are called concurrently, the outcome is non-deterministic. One may run first, and the result depends on which.

Worse: if `timer` is reassigned in some other path (e.g., a `Reset` that creates a new timer), concurrent access to `j.timer` itself is a race.

Fix: serialise via a mutex.

```go
type Job struct {
    mu    sync.Mutex
    timer *time.Timer
}

func (j *Job) Reschedule(d time.Duration) {
    j.mu.Lock()
    defer j.mu.Unlock()
    j.timer.Reset(d)
}

func (j *Job) Cancel() {
    j.mu.Lock()
    defer j.mu.Unlock()
    j.timer.Stop()
}
```

---

## Bug 11: Self-rescheduling without termination

```go
var tick func()
tick = func() {
    work()
    time.AfterFunc(time.Second, tick)
}
time.AfterFunc(time.Second, tick)
```

**What's the bug?**

---

### Bug 11: answer

The timer reschedules forever. There is no termination condition. The application cannot stop this loop without crashing.

Fix: pass a context or a stop channel.

```go
var tick func()
tick = func() {
    select {
    case <-stop:
        return
    default:
    }
    work()
    time.AfterFunc(time.Second, tick)
}
time.AfterFunc(time.Second, tick)
```

Or use `time.NewTicker` with an explicit `Stop`.

Also: the `tick` function is reachable from the timer's closure, which is reachable from the runtime's heap. Even if the main goroutine "loses interest," the chain keeps it alive. The timer cannot be GC'd; the closure cannot; `work`'s captured state cannot.

---

## Bonus bug: t.C != nil for ticker mixed with AfterFunc

```go
t := time.AfterFunc(time.Second, work)
go func() {
    for range t.C { // BUG
        work()
    }
}()
```

**What's the bug?**

---

### Bonus answer

`t.C` is nil. `range` on a nil channel blocks forever — no iterations. The goroutine is parked indefinitely.

Likely intent: use a `time.Ticker`, or call `work` from inside the `AfterFunc` callback.

---

## How to use this file

1. Read each snippet.
2. Predict the bug before scrolling.
3. Compare your answer to the official one.
4. Note the patterns: closure capture, race, panic, polling, t.C, defer in loop, return value misuse.

After working through this file, these patterns become recognisable on sight. In code review, you'll spot them before they ship.

---

## Patterns recap

The 11 bugs cover:

1. Stop-vs-fire race.
2. Captured loop variable (pre-1.22).
3. Nil timer.
4. Unrecovered panic.
5. Large closure capture + map leak.
6. Polling for fire.
7. Reading t.C for AfterFunc.
8. Defer in loop.
9. Reset return value misinterpretation.
10. Concurrent Stop/Reset.
11. Self-rescheduling without termination.

These represent the bulk of timer-related bugs in real Go services. Recognising them saves hours.

---

## A graduate-level challenge

Write 5 more snippets, each with a non-obvious bug, and explain. Pair-program with a teammate: they hunt your bugs; you hunt theirs.

The act of constructing bugs sharpens your eye more than just spotting them.

---

## Comment patterns

If you spot one of these in code review, leave a comment like:

- (Bug 1) "Stop may return false; the callback can still run. Add a guard inside it."
- (Bug 2) "Captured loop variable. Shadow `i := i` (or upgrade Go to 1.22+)."
- (Bug 3) "Possible nil deref. Ensure timer is initialised."
- (Bug 4) "Add defer recover() — panics in callbacks crash the process."
- (Bug 5) "Closure captures the entire request. Capture just the ID."
- (Bug 6) "Don't poll; use a channel."
- (Bug 7) "t.C is nil for AfterFunc. Use your own channel."
- (Bug 8) "Defer in loop accumulates. Move Stop into the loop body."
- (Bug 9) "Reset's return is misleading for AfterFunc; ignore it."
- (Bug 10) "Concurrent Stop/Reset without serialisation. Add a mutex."
- (Bug 11) "Self-rescheduling without a stop condition. Pass a context."

These short comments educate the author while flagging the issue.

---

## A final exercise

Take a small Go service you maintain. Search for every `time.AfterFunc`. For each, check:

- Capture size?
- Stop on cleanup?
- Panic recovery?
- Metric?

If you find issues, file tickets. If your colleagues are willing, do a "code review sprint" focused on timer hygiene.

End of find-bug.
