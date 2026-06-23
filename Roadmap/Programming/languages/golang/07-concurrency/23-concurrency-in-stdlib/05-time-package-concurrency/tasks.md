---
layout: default
title: time Package Concurrency — Tasks
parent: time Package Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/05-time-package-concurrency/tasks/
---

# time Package Concurrency — Tasks

[← Back](../)

> Hands-on exercises. Each task has a goal, starter snippet, success criteria, and hints. Solutions are deliberately omitted — the point is the discovery.

---

## Task 1 — Disassemble `time.Sleep` (junior)

**Goal.** See what `time.Sleep(time.Second)` compiles into.

**Steps:**
1. Write a one-liner: `func main() { time.Sleep(time.Second) }`.
2. Build: `go build -o sleep main.go`.
3. Disassemble: `go tool objdump -s 'main\.main' ./sleep`.
4. Locate the call to `time.Sleep` and follow it into `runtime.timeSleep`.

**Success.** You can name the runtime function and the call sequence (`runtime.timeSleep -> runtime.resettimer -> runtime.gopark`).

---

## Task 2 — Build a leaking ticker (junior)

**Goal.** Demonstrate the classic `time.Tick` leak.

**Starter:**
```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func tickN(n int) int {
    count := 0
    for range time.Tick(time.Millisecond) {
        count++
        if count >= n {
            return count
        }
    }
    return count
}

func main() {
    for i := 0; i < 1000; i++ {
        _ = tickN(10)
    }
    runtime.GC()
    fmt.Println("goroutines:", runtime.NumGoroutine())
}
```

**Steps:**
1. Run, observe goroutine count climbing (or use `runtime.MemStats` to see heap growth).
2. Replace `time.Tick` with `time.NewTicker` + `defer t.Stop()`.
3. Re-run; verify the leak is gone.

**Success.** You can articulate why `time.Tick` leaks and why `NewTicker+Stop` does not.

---

## Task 3 — Measure timer precision (junior)

**Goal.** Measure how accurate `time.Sleep` actually is.

**Steps:**
1. Write a benchmark that calls `time.Sleep(d)` for various `d` (1µs, 10µs, 100µs, 1ms, 10ms, 100ms).
2. Record the actual elapsed time via `time.Now()` before and after.
3. Compute the error and jitter.

**Success.** You have a table of `d` vs measured elapsed. You can explain why short sleeps over-sleep (scheduler latency floor).

---

## Task 4 — Leak-free select-with-timeout (junior)

**Goal.** Rewrite a naive `select { case <-ch: case <-time.After(d): }` loop to not leak Timer objects.

**Starter:**
```go
for {
    select {
    case v := <-ch:
        process(v)
    case <-time.After(100 * time.Millisecond):
        // timeout
    }
}
```

**Steps:**
1. Run a benchmark; observe `time.NewTimer` allocations in `pprof` heap.
2. Refactor: hoist a `*Timer` outside, Reset it, drain on Reset.
3. Verify allocations drop to ~0 per iteration.

**Success.** You can show pre/post `pprof` allocation profiles.

---

## Task 5 — Write a Clock interface (middle)

**Goal.** Build a `Clock` abstraction for testable time.

**Requirements:**
- `Now() time.Time`, `Sleep(d Duration)`, `After(d Duration) <-chan time.Time`, `NewTicker(d Duration) Ticker`.
- Two implementations: `realClock` (delegates to `time` package) and `fakeClock` (advances on `Advance(d)` call, fires pending timers in order).
- Write tests for both.

**Success.** A function `func DoWork(c Clock) error` can be unit-tested deterministically using `fakeClock`.

**Hint.** Look at `github.com/benbjohnson/clock` for prior art (don't copy; build your own).

---

## Task 6 — Replicate the `time.After` leak with pprof (middle)

**Goal.** Use `pprof` to visualise a timer-allocation problem.

**Starter:**
```go
package main

import (
    "context"
    "net/http"
    _ "net/http/pprof"
    "time"
)

func main() {
    go http.ListenAndServe("localhost:6060", nil)
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    for {
        select {
        case <-ctx.Done():
            return
        case <-time.After(time.Microsecond):
        }
    }
}
```

**Steps:**
1. Run.
2. In another terminal: `go tool pprof -alloc_space http://localhost:6060/debug/pprof/allocs`.
3. `top` shows `time.NewTimer` near the top.
4. Refactor to a hoisted Timer.
5. Re-profile; the Timer allocation should be gone.

**Success.** You have a before/after `pprof` showing the difference.

---

## Task 7 — Build a virtual scheduler (middle)

**Goal.** Implement a `fakeClock` that holds a heap of pending timers and advances time on explicit user calls.

**Requirements:**
- `Advance(d)` advances internal time by `d`, fires all pending timers up to the new "now" in order.
- Supports concurrent registration of timers from multiple goroutines.
- Provides `After`, `NewTimer`, `NewTicker`.

**Success.** A goroutine calling `c.After(time.Second)` returns immediately after `c.Advance(time.Second)`, and 100 such goroutines can be tested without sleeping.

---

## Task 8 — Reuse a Timer with Reset (middle)

**Goal.** Build the canonical pattern.

**Starter:**
```go
func process(ctx context.Context, work <-chan Job) {
    for {
        select {
        case j := <-work:
            handle(j)
        case <-time.After(5 * time.Second):
            log.Println("idle")
        case <-ctx.Done():
            return
        }
    }
}
```

**Steps:**
1. Refactor to use a single `*Timer` hoisted outside the loop.
2. Reset it at the start of each iteration.
3. After firing or after a work item arrives, decide whether to drain `t.C` (Go 1.22 and earlier).
4. On Go 1.23+, you can skip the drain.

**Success.** Allocation profile shows zero `time.NewTimer` per iteration.

---

## Task 9 — Implement `context.WithTimeout` from scratch (senior)

**Goal.** Build your own `WithTimeout` using `time.AfterFunc`.

**Starter:**
```go
type myCtx struct {
    parent context.Context
    done   chan struct{}
    err    atomic.Pointer[error]
    timer  *time.Timer
}
```

**Requirements:**
- `Deadline()` returns the deadline + true.
- `Done()` returns the channel.
- `Err()` returns the appropriate `context.Canceled` or `context.DeadlineExceeded`.
- Schedule a `time.AfterFunc(d, func() { cancel() })` to fire the deadline.

**Success.** Behaviour matches `context.WithTimeout` (compare via tests).

---

## Task 10 — Measure scheduler timer overhead (senior)

**Goal.** Determine the per-timer scheduler cost.

**Steps:**
1. Write a benchmark: schedule 1000, 10000, 100000 `time.AfterFunc` callbacks.
2. Measure the time to schedule them all (heap insertion cost).
3. Measure CPU usage during their firing (use `runtime/pprof`).
4. Plot scheduling cost vs N.

**Success.** You can articulate the O(log N) per insert cost and how `adjusttimers` scales.

---

## Task 11 — Build a hierarchical timing wheel (senior)

**Goal.** Implement a Varghese-Lauck timing wheel.

**Requirements:**
- A wheel of `N` slots, advancing one slot per `tickRes`.
- Insert: `Schedule(d, fn)`.
- A background goroutine advances the wheel.
- Bench against `time.AfterFunc` for 1M scheduled timeouts.

**Success.** You can measure when (number of timers) the timing wheel wins over the runtime heap.

**Hint.** The runtime heap is hard to beat; only at very large N (>100K simultaneous timers) does the wheel start to win.

---

## Task 12 — Debug a real timer leak (senior)

**Goal.** Find a timer leak in an open-source Go project (or invent one) using `pprof`.

**Steps:**
1. Pick a service, instrument it with pprof.
2. Run under load; periodically `curl /debug/pprof/heap` and `goroutine?debug=2`.
3. Look for growing `time.NewTimer` allocations or growing goroutine count with stacks containing `time.runtimeNano`.
4. Trace to source; propose a fix.

**Success.** You can write up the bug, the fix, and the before/after metrics.

---

## Task 13 — Monotonic-clock-aware comparison (middle)

**Goal.** Demonstrate why `time.Equal` is safer than `==` for `time.Time`.

**Starter:**
```go
t1 := time.Now()
t2 := t1
b, _ := json.Marshal(t1)
var t3 time.Time
json.Unmarshal(b, &t3)
fmt.Println(t1 == t2, t1 == t3, t1.Equal(t3))
```

**Steps:**
1. Predict the output.
2. Run.
3. Explain: `t1 == t2` is true, `t1 == t3` is false (monotonic stripped by JSON roundtrip), `t1.Equal(t3)` is true.

**Success.** You can articulate the rule: never `==` on `time.Time`; always `Equal`.

---

## Task 14 — Stress the per-P timer heap (senior)

**Goal.** Schedule millions of timers across many goroutines; measure scheduler behaviour.

**Steps:**
1. Spawn 1000 goroutines, each scheduling 10000 `time.AfterFunc(rand_duration, fn)`.
2. Use `runtime/trace` to capture the execution.
3. Open the trace in `go tool trace`; look for `adjusttimers` time and timer-fire events.

**Success.** You have a trace showing how timer work distributes across Ps.

---

## Task 15 — Race-test Timer.Reset / Stop (senior)

**Goal.** Construct a race between Reset and the timer's natural fire, on Go 1.22 vs Go 1.23.

**Starter:**
```go
t := time.NewTimer(time.Millisecond)
time.Sleep(time.Millisecond) // wait for it to fire
t.Reset(time.Second)
v := <-t.C
fmt.Println("got", v)
```

**Steps:**
1. Run on Go 1.22 and Go 1.23.
2. On 1.22, the channel may hold a stale value from the original fire.
3. On 1.23, the channel is reliably empty after Reset.

**Success.** You can demonstrate the behavioural change between versions.

---

## Task 16 — Build a deterministic test for time-based code (professional)

**Goal.** Write production code with `time.NewTicker` and unit-test it without `time.Sleep`.

**Steps:**
1. Inject a `Clock` interface (Task 5).
2. Use `fakeClock` in tests.
3. Drive the test by calling `clock.Advance(d)`; assert observable side effects.
4. Verify the test runs in <10 ms regardless of `d`.

**Success.** Tests are fast and deterministic.

---

## Task 17 — Measure Go 1.23 GC improvement (professional)

**Goal.** Measure the heap-pinning improvement from Go 1.23.

**Steps:**
1. Write a benchmark that leaks Tickers (deliberately) and measures heap size after GC.
2. Run on Go 1.22 (pinning) and Go 1.23 (no pinning).
3. Compare heap-after-GC sizes.

**Success.** You can quantify the GC win.

---

## Task 18 — Build a leak-free batched ticker (professional)

**Goal.** Implement a ticker that batches work and stops cleanly.

**Requirements:**
- Tick every `d`.
- On each tick, drain a work queue.
- Cleanly Stop via context cancel.
- No goroutine leak after Stop.
- Verify with goroutine counter before/after.

**Success.** Stress-test produces zero leaked goroutines.

---

## Task 19 — Trace `context.WithTimeout` (professional)

**Goal.** Use `runtime/trace` to see WithTimeout firing.

**Steps:**
1. Write a program that creates 1000 contexts with various timeouts.
2. Wrap in `trace.Start`.
3. Open the trace; identify the AfterFunc-driven cancel events.

**Success.** You can correlate timeout deadlines with the goroutines that woke as a result.

---

## Task 20 — Cross-platform timer precision study (professional)

**Goal.** Measure `time.Sleep` precision on Linux, macOS, and Windows.

**Steps:**
1. Run Task 3's benchmark on each platform.
2. Compare the precision floors.
3. Investigate `timeBeginPeriod` on Windows; rerun.

**Success.** You have a cross-platform precision table; you understand which OS knobs affect Go's timer behaviour.

---

These twenty exercises move from "see the leak" to "design a high-throughput timer system." Treat them as a learning ladder: complete in order, write down your findings, and revisit them when you next encounter a time-related concurrency bug in production.
