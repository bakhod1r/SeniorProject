# Go Runtime GMP — Hands-on Tasks

> Practical exercises that build intuition for the Go scheduler. Each task says what to build, what success looks like, and a hint. Solutions or sketches at the end.

---

## Easy

### Task 1 — Inspect runtime constants

Write a small program that prints `runtime.NumCPU()`, `runtime.GOMAXPROCS(0)`, and `runtime.NumGoroutine()`.

- Run it as `go run main.go`.
- Run it with `GOMAXPROCS=2 go run main.go` and observe.
- Run it inside a Docker container with `--cpus=1` and observe (depending on Go version).

**Goal.** Get familiar with runtime introspection.

---

### Task 2 — Schedule trace

Run any Go program (yours, or one that has some I/O) with `GODEBUG=schedtrace=500 go run main.go`. Observe the output. Note `gomaxprocs`, `runqueue`, per-P queues.

**Goal.** Read scheduler trace output.

---

### Task 3 — Force preemption visibility

Write a program with one goroutine doing tight CPU work and another printing a heartbeat every 100 ms. With Go 1.14+, the heartbeat should keep firing despite the busy loop. Confirm.

```go
go func() {
    for {
        time.Sleep(100 * time.Millisecond)
        fmt.Println("heartbeat:", time.Now())
    }
}()
go func() {
    for { _ = math.Sqrt(rand.Float64()) }
}()
select {}
```

**Goal.** Observe async preemption in action.

---

### Task 4 — Disable async preemption

Run Task 3 with `GODEBUG=asyncpreemptoff=1`. Observe whether the heartbeat still fires. (On modern multi-core systems it may still work because the heartbeat runs on a different P.) Try `GOMAXPROCS=1 GODEBUG=asyncpreemptoff=1` to single-thread it and see the heartbeat starve.

**Goal.** Understand the role of async preemption.

---

### Task 5 — Goroutine count under load

Write a program that spawns 100 goroutines, each sleeping for 1 second. Before, during, and after spawning, print `runtime.NumGoroutine()`.

**Goal.** See goroutine counts change over time.

---

### Task 6 — `GOMAXPROCS` and CPU-bound parallelism

Write a CPU-bound benchmark: sum integers from 1 to 1 billion, split across `N` goroutines. Measure with `N = 1, 2, 4, 8, 16`. Run with default `GOMAXPROCS` and with `GOMAXPROCS=1`. Compare timings.

**Goal.** See `GOMAXPROCS` effect on parallel speedup.

---

## Medium

### Task 7 — Detect goroutine leak

Write a function that spawns a goroutine blocked on a `chan int` send with no receiver. Call it 100 times. Then print `runtime.NumGoroutine()`. Observe ~100+ leaked goroutines.

Use `pprof` to view their stacks:

```go
import _ "net/http/pprof"
go func() { http.ListenAndServe(":6060", nil) }()
```

Then `curl http://localhost:6060/debug/pprof/goroutine?debug=1 > leaks.txt` and inspect.

**Goal.** Practice detecting goroutine leaks.

---

### Task 8 — `LockOSThread` demonstration

Write a goroutine that calls `runtime.LockOSThread`, prints the current OS thread ID (use `syscall.Gettid` on Linux), does some work, then unlocks. Verify it stays on the same thread.

Compare to a goroutine without `LockOSThread`: log the thread ID at various points and observe it changing.

**Goal.** See thread pinning in action.

---

### Task 9 — Scheduler under syscall load

Write a program that spawns 100 goroutines, each doing a sequence of file reads (`os.ReadFile`) on different files. Print `runtime.NumGoroutine()` and the M count (you cannot read M count directly; use `GODEBUG=schedtrace=500 scheddetail=1` and grep for "threads=").

Observe that the M count rises beyond `GOMAXPROCS` during syscall storms.

**Goal.** See M-pool growth under blocking syscalls.

---

### Task 10 — `go tool trace`

Run any Go program with tracing:

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()

// ... your concurrent code ...
```

Then `go tool trace trace.out`. Open the web view. Look at goroutine timelines, scheduler events, GC events.

**Goal.** Become comfortable with `go tool trace`.

---

### Task 11 — `runtime/metrics`

Use the `runtime/metrics` package to read scheduler metrics:

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/sched/goroutines:goroutines"},
    {Name: "/sched/latencies:seconds"},
}
metrics.Read(samples)
for _, s := range samples {
    fmt.Printf("%s: %v\n", s.Name, s.Value)
}
```

Read every second; observe values change as your program runs.

**Goal.** Use the stable runtime metrics API.

---

### Task 12 — `automaxprocs` in a container

Set up a small Docker container running a Go program with `--cpus=2`. Run it without `automaxprocs` and check `runtime.GOMAXPROCS(0)`. Then add `automaxprocs` and re-run; verify it now reports 2.

(If you are on Go 1.21+, native cgroup detection may already do this. Test both behaviours.)

**Goal.** Understand container `GOMAXPROCS` problems.

---

## Hard

### Task 13 — Spinlock vs channel benchmark

Write two implementations of a counter shared by 8 goroutines:

1. Atomic increment.
2. Channel-mediated owner goroutine.

Measure with `testing.B.RunParallel`. Compare ns/op. Atomics should win by 10–50x.

**Goal.** See the cost of CSP for simple shared state.

---

### Task 14 — Custom GOMAXPROCS adjustment

Write a function that monitors load (e.g., `runtime.NumGoroutine` or actual CPU usage) and dynamically adjusts `runtime.GOMAXPROCS`. Verify it adapts.

Caveat: do not deploy this to production. It is an exercise.

**Goal.** Understand `GOMAXPROCS` as a tunable.

---

### Task 15 — Simulated long syscall

Use `syscall.Syscall` to make a goroutine call into the kernel with a long-running operation (e.g., `syscall.Pause` or a deliberate slow read). Observe via `scheddetail` that the P is detached during the syscall and reattached after.

**Goal.** See the syscall handoff mechanism.

---

### Task 16 — Build a worker pool that scales with GOMAXPROCS

Write a worker pool whose worker count is `runtime.GOMAXPROCS(0)`. Process 10 000 CPU-bound jobs. Compare to a pool with 1 worker. Speedup should approach `GOMAXPROCS`.

Then change `GOMAXPROCS` at runtime and observe the pool adapting (or not — your design decides).

**Goal.** Design a pool that matches scheduler capacity.

---

### Task 17 — Diagnose a scheduling issue

Take any moderately-complex concurrent program. Add intentional bugs:

1. A long sleep in one goroutine.
2. A blocking send on an unbuffered channel.
3. A goroutine leak.

For each, use `pprof goroutine`, `GODEBUG=schedtrace`, or `go tool trace` to diagnose.

**Goal.** Develop diagnostic intuition.

---

### Task 18 — Implement a poor-man's scheduler trace

Write code that periodically (every 100 ms) prints:

- `runtime.NumGoroutine()`
- A summary of `runtime/metrics` samples for scheduler-related metrics.
- Memory stats from `runtime.ReadMemStats`.

Format as a one-line summary. This is your in-process schedule trace.

**Goal.** Build operational tooling.

---

### Task 19 — Reproduce the GOMAXPROCS-vs-container issue

Run a Go service in Docker with `--cpus=2` on a host with many cores. Measure throughput. Then add `automaxprocs` (or upgrade to Go 1.21+) and re-measure. Quantify the improvement.

**Goal.** Experience the container problem firsthand.

---

### Task 20 — Read the scheduler source

Open `src/runtime/proc.go`. Find:

- `schedule()` function.
- `findrunnable()` function.
- `runqsteal()` function.
- `sysmon()` function.

Read each and write a short summary (2–4 sentences) in your own words.

**Goal.** Build courage to read the runtime.

---

## Solutions and hints

### Task 7 sketch

```go
func leak() {
    ch := make(chan int)
    go func() {
        ch <- 42 // blocks forever
    }()
}

func main() {
    fmt.Println("before:", runtime.NumGoroutine())
    for i := 0; i < 100; i++ {
        leak()
    }
    time.Sleep(time.Second)
    fmt.Println("after:", runtime.NumGoroutine())
}
```

### Task 8 sketch

```go
package main

import (
    "fmt"
    "runtime"
    "syscall"
    "time"
)

func main() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    for i := 0; i < 5; i++ {
        fmt.Println("tid:", syscall.Gettid())
        time.Sleep(100 * time.Millisecond)
    }
}
```

The TID should be the same across all iterations.

### Task 13 atomic version

```go
var counter int64
b.RunParallel(func(pb *testing.PB) {
    for pb.Next() {
        atomic.AddInt64(&counter, 1)
    }
})
```

### Task 13 channel version

```go
inc := make(chan int, 100)
go func() {
    var n int
    for d := range inc {
        n += d
    }
}()
b.RunParallel(func(pb *testing.PB) {
    for pb.Next() {
        inc <- 1
    }
})
close(inc)
```

The channel version will be much slower under contention.

### Task 14 sketch

```go
go func() {
    t := time.NewTicker(5 * time.Second)
    for range t.C {
        if shouldScaleUp() {
            runtime.GOMAXPROCS(runtime.GOMAXPROCS(0) + 1)
        } else if shouldScaleDown() {
            runtime.GOMAXPROCS(runtime.GOMAXPROCS(0) - 1)
        }
    }
}()
```

---

## Wrap-up

After these tasks you should:

- Read scheduler traces and pprof goroutine profiles.
- Understand how `GOMAXPROCS` interacts with cores and containers.
- See the effect of `LockOSThread` and syscalls on the M count.
- Detect goroutine leaks systematically.
- Use `runtime/metrics` for production observability.
- Have read at least a few hundred lines of `runtime/proc.go`.

The next file (`find-bug.md`) tests your scheduler debugging skills.
