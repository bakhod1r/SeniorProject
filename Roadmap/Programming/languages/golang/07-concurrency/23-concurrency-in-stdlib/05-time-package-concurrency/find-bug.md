---
layout: default
title: time Package Concurrency — Find the Bug
parent: time Package Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/05-time-package-concurrency/find-bug/
---

# time Package Concurrency — Find the Bug

[← Back](../)

> Each snippet contains a real bug related to `time` package concurrency. Find it, explain it, fix it. All examples reflect actual mistakes seen in production Go code.

---

## Bug 1 — `time.Tick` in a function that returns

```go
package main

import (
    "fmt"
    "time"
)

func collect(ctx context.Context) int {
    sum := 0
    for {
        select {
        case <-ctx.Done():
            return sum
        case <-time.Tick(time.Second):
            sum++
        }
    }
}
```

**Bug.** `time.Tick(time.Second)` is called **on every iteration** of the select! Each call creates a *new* `*Ticker` that is never stopped. Two compound bugs: (1) the ticker count grows unboundedly; (2) the select almost always immediately fires the newest ticker's channel because each fresh ticker hasn't sent yet — actually it never fires from the *new* one, so the loop blocks forever waiting for a one-second fire that goes to an orphaned ticker.

**Fix.**
```go
t := time.NewTicker(time.Second)
defer t.Stop()
for {
    select {
    case <-ctx.Done(): return sum
    case <-t.C: sum++
    }
}
```

---

## Bug 2 — `time.After` allocation churn in a hot loop

```go
func consume(ch <-chan Job, ctx context.Context) {
    for {
        select {
        case j := <-ch:
            handle(j)
        case <-time.After(50 * time.Millisecond):
            // periodic flush
        case <-ctx.Done():
            return
        }
    }
}
```

**Bug.** Every iteration allocates a new `*Timer` for the `time.After`. If `ch` is busy, the Timer is never received from — it sits on the timer heap until its 50 ms expires. Under heavy load, the timer heap fills with thousands of pending Timers; `pprof` shows `time.NewTimer` as a top allocator.

**Fix.** Hoist a single Timer:
```go
t := time.NewTimer(50 * time.Millisecond)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(50 * time.Millisecond)
    select {
    case j := <-ch: handle(j)
    case <-t.C: /* flush */
    case <-ctx.Done(): return
    }
}
```
On Go 1.23+, the Stop-and-drain dance is no longer required:
```go
t.Reset(50 * time.Millisecond)
```

---

## Bug 3 — Forgotten `Ticker.Stop`

```go
func startMetrics() {
    t := time.NewTicker(10 * time.Second)
    go func() {
        for range t.C {
            sendMetrics()
        }
    }()
}
```

**Bug.** `Stop` is never called. The goroutine and the ticker live forever — fine for the lifetime of the process but a leak if `startMetrics` is called per-request, per-test, or per-instance creation.

**Fix.** Accept a context, defer Stop:
```go
func startMetrics(ctx context.Context) {
    t := time.NewTicker(10 * time.Second)
    go func() {
        defer t.Stop()
        for {
            select {
            case <-t.C: sendMetrics()
            case <-ctx.Done(): return
            }
        }
    }()
}
```

---

## Bug 4 — Reset race (Go 1.22 and earlier)

```go
t := time.NewTimer(time.Second)
time.Sleep(2 * time.Second) // timer has fired; t.C has a value
t.Reset(time.Second)
v := <-t.C
fmt.Println("after", time.Since(start), v)
```

**Bug.** Pre-1.23: the receive on `t.C` returns the *old* stale fire's timestamp (from the original 1-second timer) immediately, not after the Reset's 1 second. The user expected a 1-second wait; they got 0 ms.

**Fix (pre-1.23).** Stop and drain before Reset:
```go
if !t.Stop() {
    select { case <-t.C: default: }
}
t.Reset(time.Second)
```

**Fix (1.23+).** Just call Reset. The runtime drops the stale value.

---

## Bug 5 — Ignored Stop return value

```go
t := time.NewTimer(d)
defer t.Stop() // ignores the boolean
```

**Bug.** Not directly a bug here (defer doesn't care), but in code that does `t.Stop()` mid-flow:
```go
t.Stop()
t.Reset(newD)
```
If `Stop` returned `false`, the timer already fired and `t.C` may hold a value. On pre-1.23, the next `<-t.C` will receive the stale value before the new fire.

**Fix.**
```go
if !t.Stop() {
    select { case <-t.C: default: }
}
t.Reset(newD)
```

---

## Bug 6 — `time.Tick` in a `for range`

```go
go func() {
    for now := range time.Tick(time.Second) {
        log.Println("tick at", now)
        if done() {
            return  // BUG: ticker leaked!
        }
    }
}()
```

**Bug.** The `for range time.Tick(d)` returns from the goroutine without ever stopping the ticker. The ticker continues to send to its unreferenced channel; the channel is GC-collectable post-1.23 but on earlier versions it was pinned. Worse: if `done()` returns true, the runtime keeps trying to deliver ticks to a channel nobody reads from.

**Fix.**
```go
t := time.NewTicker(time.Second)
defer t.Stop()
for {
    select {
    case now := <-t.C:
        log.Println("tick at", now)
        if done() { return }
    }
}
```

---

## Bug 7 — Comparing `time.Time` with `==`

```go
t1 := time.Now()
data, _ := t1.MarshalJSON()
var t2 time.Time
t2.UnmarshalJSON(data)
if t1 == t2 {
    fmt.Println("equal")
} else {
    fmt.Println("not equal")  // BUG: prints this!
}
```

**Bug.** `time.Time` carries a monotonic reading. JSON marshalling strips it. After unmarshalling, `t2` has only the wall component; `t1` has both. `==` compares all fields, including the monotonic, and reports unequal.

**Fix.** Use `.Equal`:
```go
if t1.Equal(t2) { ... }
```
Or strip the monotonic before storing: `t1 = t1.Round(0)`.

---

## Bug 8 — `time.Now()` for measurement across a wall-clock change

```go
start := time.Now()
doWork()
elapsed := time.Now().Sub(start) // OK with monotonic
// vs:
startUnix := time.Now().Unix()
doWork()
endUnix := time.Now().Unix()
elapsed := endUnix - startUnix // BUG: Unix() drops monotonic
```

**Bug.** Calling `.Unix()` (or `.UnixNano()`) drops the monotonic part. If the wall clock jumps backward (NTP, manual set) during `doWork`, `elapsed` can be negative.

**Fix.** Use the monotonic-aware path:
```go
elapsed := time.Since(start)
```

---

## Bug 9 — Drifting periodic work

```go
for {
    do()
    time.Sleep(time.Second)
}
```

**Bug.** Each iteration's sleep starts *after* `do()` completes. If `do()` takes 200 ms, the period is 1.2 s, not 1.0 s. Cumulative drift over hours becomes large.

**Fix.** Use a Ticker:
```go
t := time.NewTicker(time.Second)
defer t.Stop()
for range t.C {
    do()
}
```
The Ticker fires on a steady cadence; if `do()` overruns, ticks are coalesced.

---

## Bug 10 — `time.AfterFunc` capture race

```go
for i := 0; i < 10; i++ {
    time.AfterFunc(time.Second, func() {
        fmt.Println(i)  // BUG: prints 10 ten times
    })
}
```

**Bug.** Classic loop-variable capture. Each callback closes over the same `i`; by the time the callbacks fire, `i == 10`.

**Fix (Go 1.22+).** Per-iteration loop variable scoping is now automatic. Bug only manifests in Go 1.21 and earlier.

**Fix (any version).**
```go
for i := 0; i < 10; i++ {
    i := i // shadow
    time.AfterFunc(time.Second, func() { fmt.Println(i) })
}
```

---

## Bug 11 — `time.AfterFunc` callback runs concurrently with caller

```go
var mu sync.Mutex
var state int

func schedule() {
    mu.Lock()
    state = 1
    time.AfterFunc(time.Millisecond, func() {
        state = 2  // BUG: no lock
    })
    mu.Unlock()
}
```

**Bug.** The AfterFunc callback runs in a brand-new goroutine. It writes `state` without holding `mu`. Race detector flags it.

**Fix.**
```go
time.AfterFunc(time.Millisecond, func() {
    mu.Lock()
    state = 2
    mu.Unlock()
})
```

---

## Bug 12 — Trying to "cancel" a `time.After`

```go
ch := time.After(time.Hour)
if shouldCancel() {
    ch = nil  // BUG: doesn't cancel the timer
}
```

**Bug.** Assigning `nil` to `ch` doesn't stop the underlying Timer. The Timer remains in the heap for one hour, holding memory. `time.After` does not return a way to stop the timer.

**Fix.** Use `time.NewTimer` explicitly:
```go
t := time.NewTimer(time.Hour)
defer t.Stop()
// to "cancel": t.Stop()
```

---

## Bug 13 — Stale ticker channel after `Stop`

```go
t := time.NewTicker(time.Second)
time.Sleep(time.Second)  // tick fired
t.Stop()
v := <-t.C  // BUG: receives the buffered tick value
```

**Bug.** `Ticker.Stop` does not drain the 1-buffered channel. A leftover tick value can be received after Stop. In a `for select` loop, this manifests as "I called Stop but I still got one more tick."

**Fix.** Treat the post-Stop receive as a possibility; or use a state flag in the loop:
```go
t.Stop()
select { case <-t.C: default: }
```

---

## Bug 14 — `for range time.NewTicker(d).C` with no cleanup

```go
go func() {
    for now := range time.NewTicker(time.Second).C {
        process(now)
    }
}()
```

**Bug.** The `*Ticker` is anonymous; no reference is kept. There is no way to call `Stop`. The ticker leaks. Pre-1.23 also pinned the channel; post-1.23 the runtime can GC the timer but the goroutine still blocks on the receive.

**Fix.**
```go
t := time.NewTicker(time.Second)
defer t.Stop()
for now := range t.C {
    process(now)
}
```

---

These fourteen bugs cover the bread-and-butter time-package mistakes seen across thousands of real Go services: leaks, races, drifts, allocation churn, and the subtle monotonic-clock pitfall. Use them as code-review checklist material.
