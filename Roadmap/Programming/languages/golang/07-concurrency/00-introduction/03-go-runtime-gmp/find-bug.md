# Go Runtime GMP — Find the Bug

> Scheduler-aware bug-finding exercises. Each snippet has a problem related to how the Go scheduler behaves. Diagnose, then read the explanation.

---

## Bug 1 — `GOMAXPROCS` set inside a library

```go
package mylib

import "runtime"

func init() {
    runtime.GOMAXPROCS(1)
}
```

**What is wrong?**

A library's `init` function changes a process-wide setting without the caller's consent. Every program that imports `mylib` runs single-threaded, regardless of the caller's wishes.

**Fix.**

Never change `GOMAXPROCS` in a library. Document the recommended setting in your README, or expose a function callers can call explicitly.

---

## Bug 2 — `LockOSThread` without unlock

```go
func handler(w http.ResponseWriter, r *http.Request) {
    runtime.LockOSThread()
    // ... process request ...
}
```

**What is wrong?**

Every request locks its OS thread. The lock persists until the goroutine exits (or `UnlockOSThread` is called). For a long-running handler, this is wasteful. Each request consumes an M; at 1000 concurrent requests, you have 1000 M's. Eventually you hit `ulimit`.

**Fix.**

If you do need `LockOSThread` (you probably don't), pair it with `defer UnlockOSThread()`:

```go
runtime.LockOSThread()
defer runtime.UnlockOSThread()
```

Or, better, avoid locking unless required by Cgo or specific syscalls.

---

## Bug 3 — Tight loop pre-1.14

```go
go func() {
    for {
        x++
    }
}()
```

**What is wrong?**

Before Go 1.14, this loop is uninterruptible — no function calls means no cooperative preemption point. Other goroutines may starve if `GOMAXPROCS == 1`.

In Go 1.14+, async preemption fires every ~10 ms via signals, mitigating this. But the issue remains in very-old Go.

**Fix.**

Upgrade Go. Or add a `runtime.Gosched()` in the loop:

```go
go func() {
    for {
        x++
        if x%1000 == 0 {
            runtime.Gosched()
        }
    }
}()
```

The modern fix is "use Go 1.14+."

---

## Bug 4 — Cgo in a hot loop

```go
for i := 0; i < 1_000_000; i++ {
    C.some_simple_function()
}
```

**What is wrong?**

Each Cgo call has ~300 ns overhead (Go-to-C-to-Go transition). One million calls = 300 ms just in transitions. For a simple function, this destroys performance.

**Fix.**

Batch the work in a single Cgo call:

```go
C.do_simple_in_loop(C.int(1_000_000))
```

Let C iterate; Go pays one transition cost.

---

## Bug 5 — Container GOMAXPROCS mismatch

```go
package main

func main() {
    cores := runtime.GOMAXPROCS(0)
    workers := cores * 2 // tune to "twice cores"
    pool := NewWorkerPool(workers)
    // ...
}
```

**What is wrong?**

In a Docker container with `--cpus=2` on a 64-core host, `runtime.GOMAXPROCS(0)` may return 64 (pre-Go-1.21). The pool spawns 128 workers. The container is throttled at 2 cores; the pool thrashes.

**Fix.**

Use Go 1.21+, or use `github.com/uber-go/automaxprocs`:

```go
import _ "go.uber.org/automaxprocs"
```

(The blank import sets `GOMAXPROCS` based on cgroup info at startup.)

---

## Bug 6 — Goroutine doing syscall in a loop

```go
for _, path := range paths {
    go func(path string) {
        data, _ := os.ReadFile(path)
        process(data)
    }(path)
}
```

**What is wrong?**

For each path, a goroutine is spawned and does a blocking file read. If there are 10 000 paths, you have 10 000 goroutines simultaneously doing syscalls. Each syscall holds an M (OS thread). The runtime creates M's to keep `GOMAXPROCS` P's busy; you end up with thousands of OS threads.

**Fix.**

Bound concurrency:

```go
sem := make(chan struct{}, 16)
for _, path := range paths {
    sem <- struct{}{}
    go func(path string) {
        defer func() { <-sem }()
        data, _ := os.ReadFile(path)
        process(data)
    }(path)
}
```

16 simultaneous file reads; rest queue. Far fewer M's needed.

---

## Bug 7 — Pinned goroutine in a worker pool

```go
for i := 0; i < workers; i++ {
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        for j := range jobs {
            process(j)
        }
    }()
}
```

**What is wrong?**

Each worker pins itself to an OS thread. With 16 workers, 16 M's are reserved. The scheduler cannot move workers between M's. If one worker is doing CPU-bound work and another is idle, the scheduler cannot rebalance.

Also, pinned goroutines do not get the benefit of work stealing.

**Fix.**

Don't `LockOSThread` unless needed. The default scheduler is more flexible.

---

## Bug 8 — Heavy use of `runtime.Gosched`

```go
for i := 0; i < 1_000_000_000; i++ {
    runtime.Gosched()
    work()
}
```

**What is wrong?**

`Gosched` yields to the scheduler. Doing it every iteration creates 1 billion scheduling events, each costing tens of ns. Massive overhead.

In Go 1.14+, async preemption handles long loops automatically. Manual `Gosched` is rarely needed.

**Fix.**

Remove the `Gosched()` call.

---

## Bug 9 — Long syscall holding a P

```go
go func() {
    for {
        cmd := exec.Command("slow-script.sh")
        cmd.Run() // takes 30 seconds
    }
}()
```

**What is wrong?**

`exec.Command.Run` is a blocking call into a child process. While waiting, the goroutine's M is blocked. Sysmon notices and detaches the P, giving it to another M. But if you have many such goroutines, you grow many M's.

This is not really a bug — it is expected. But if you have hundreds of such goroutines, you may exhaust thread limits.

**Fix.**

Bound concurrency for subprocess spawning. Use a worker pool with a small number of workers.

---

## Bug 10 — `runtime.NumGoroutine` for "load detection"

```go
if runtime.NumGoroutine() > 1000 {
    return errors.New("overloaded")
}
```

**What is wrong?**

`NumGoroutine` counts all goroutines, including parked ones blocked on network I/O. A web server with 10 000 idle WebSocket connections has 10 000 goroutines, none of them consuming CPU.

Using this as "load" gives false positives.

**Fix.**

Track active load with explicit counters (atomic ints incremented on request entry, decremented on exit). `NumGoroutine` is useful for *leak detection*, not load.

---

## Bug 11 — Mistaking syscalls for I/O

```go
go func() {
    for _, url := range urls {
        resp, _ := http.Get(url)
        ...
    }
}()
```

**What is wrong?**

This is fine, but conceptually: `http.Get` involves network I/O, not file syscalls. The runtime handles network I/O via netpoll — no M is held during the wait. The goroutine is parked; the M runs other goroutines.

The bug is *believing* HTTP calls behave like file reads. They don't. You can have 10 000 concurrent HTTP requests without 10 000 OS threads. (Unless you're using Cgo-based HTTP client, in which case all bets are off.)

**Fix.**

There's no bug to fix here; the misconception is the bug. The lesson: know your runtime.

---

## Bug 12 — Spawning goroutines in a tight loop

```go
for {
    go heartbeat()
    time.Sleep(time.Second)
}
```

**What is wrong?**

Every second, a new goroutine is spawned. Old `heartbeat` goroutines presumably finish; if not, you leak. Even if they do, you create gratuitous goroutines: scheduler churn.

**Fix.**

Spawn once with a ticker:

```go
go func() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for range t.C {
        heartbeat()
    }
}()
```

One goroutine for the lifetime of the program.

---

## Bug 13 — Forgetting that `time.Sleep` is preemptible

```go
go func() {
    runtime.LockOSThread()
    time.Sleep(time.Hour)
    // do work
}()
```

**What is wrong?**

The goroutine pins the OS thread, then sleeps for an hour. The thread is held but idle. The scheduler cannot move other goroutines onto this thread. Wasteful.

**Fix.**

Don't combine `LockOSThread` with long sleeps. Lock only when actively using the thread.

---

## Bug 14 — `select` on a channel that nobody fills

```go
done := make(chan struct{})
go func() {
    select {
    case <-done:
        return
    }
}()
// `done` is never closed
```

**What is wrong?**

The goroutine waits forever. Even though it is not consuming CPU (it is parked), it consumes memory (stack + goroutine struct). Leak.

**Fix.**

Ensure `done` is closed (or another case in the select fires) on every program exit path.

---

## Bug 15 — Throttled container, no observability

```go
// No GOMEMLIMIT, no GOMAXPROCS tuning
// Just runs in a container with kubernetes limits
```

**What is wrong?**

Subtle but real: the container may be CPU-throttled or memory-pressured. The Go scheduler is unaware. Latency spikes appear; root cause is invisible from Go-side metrics.

**Fix.**

Set `GOMEMLIMIT` to ~80% of the container's memory limit. Use `automaxprocs` or Go 1.21+. Monitor `container_cpu_cfs_throttled_periods_total` and `container_memory_working_set_bytes`.

---

## Bug 16 — Many timers per goroutine

```go
for _, conn := range connections {
    go func(c Conn) {
        for {
            select {
            case msg := <-c.Read():
                handle(msg)
            case <-time.After(30 * time.Second):
                c.Close()
                return
            }
        }
    }(conn)
}
```

**What is wrong?**

Each iteration creates a new `time.After` timer. With 10 000 connections each looping every message, you create thousands of timers per second. Each timer lives until its expiry; many accumulate in memory.

**Fix.**

Use `time.NewTimer` with `Reset`:

```go
t := time.NewTimer(30 * time.Second)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(30 * time.Second)
    select {
    case msg := <-c.Read():
        handle(msg)
    case <-t.C:
        c.Close()
        return
    }
}
```

---

## Bug 17 — `runtime.GC()` in a hot path

```go
http.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
    processRequest(r)
    runtime.GC() // "make sure memory is freed"
})
```

**What is wrong?**

Manually triggering GC on every request. GC is expensive (a brief STW phase plus background work). Per-request GC kills throughput.

**Fix.**

Trust the GC's heuristics. Tune with `GOGC` or `GOMEMLIMIT` if needed. Don't call `runtime.GC()` from application code (except in tests or one-shot scripts).

---

## Bug 18 — Misinterpreting `findrunnable` time in CPU profile

A profile shows 30% of CPU time in `runtime.findrunnable`.

**What is wrong?**

Misinterpreting: "Goroutines are searching for work, scheduler is busy." But `findrunnable` time means M's spin looking for work and finding little. The application has *too few* runnable goroutines, not too many. Or `GOMAXPROCS` is too high for actual concurrency.

**Fix.**

Lower `GOMAXPROCS` to match actual concurrency, or investigate whether the goroutines are stuck on something.

---

## Bug 19 — Pre-emptive `time.Sleep` for "fairness"

```go
for _, item := range items {
    process(item)
    time.Sleep(time.Millisecond) // let other goroutines run
}
```

**What is wrong?**

Inserting sleeps to "yield" assumes the scheduler is unfair. With Go 1.14+ async preemption, this is unnecessary. The 1 ms sleep also dramatically slows the loop.

**Fix.**

Remove the sleep. Trust the scheduler.

---

## Bug 20 — Long-running goroutine with no cancellation

```go
go func() {
    for {
        v := <-jobs
        process(v)
    }
}()
```

**What is wrong?**

The goroutine has no exit. When the program tries to shut down, the goroutine waits forever for `jobs` to send. The runtime detects all-goroutines-asleep at program end, but cleanup may be incomplete.

**Fix.**

Add cancellation:

```go
go func() {
    for {
        select {
        case v := <-jobs:
            process(v)
        case <-ctx.Done():
            return
        }
    }
}()
```

---

## Bug 21 — Sysmon starvation

```go
// On a 1-core container with one CPU-bound goroutine:
go func() {
    for { /* CPU-bound */ }
}()
```

**What is wrong?**

With `GOMAXPROCS=1`, the one M is busy with the CPU loop. Sysmon runs on its own M without a P, but on a 1-core container, sysmon may not get CPU time. Result: no preemption signals fired, the loop runs uninterrupted.

In practice, the kernel does interleave threads; sysmon will get CPU eventually. But on tight 1-core deployments, you can see latency spikes.

**Fix.**

Avoid `GOMAXPROCS=1` for production services. Even 2 cores gives the scheduler room to breathe.

---

## Bug 22 — `select` with default in a tight loop

```go
for {
    select {
    case v := <-ch:
        process(v)
    default:
    }
}
```

**What is wrong?**

This is a busy-spin polling `ch`. It pegs a core and prevents other goroutines from running (or, in Go 1.14+, gets preempted but still wastes 90% of its quantum). If `ch` is empty most of the time, this is pure waste.

**Fix.**

Use a blocking receive:

```go
for v := range ch {
    process(v)
}
```

Or `select` without `default`:

```go
for {
    select {
    case v := <-ch:
        process(v)
    case <-ctx.Done():
        return
    }
}
```

---

## Bug 23 — Thinking goroutines are "free"

```go
http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    for i := 0; i < 1000; i++ {
        go subProcess()
    }
})
```

**What is wrong?**

Each request spawns 1000 goroutines. Under load (1000 req/sec), you create 1M goroutines/sec. Even cheap, that is scheduler churn. Memory footprint balloons.

**Fix.**

Bound parallelism with a worker pool or `errgroup.SetLimit`. Or question whether you need that much parallelism at all.

---

## Bug 24 — Misreading `runtime.NumGoroutine`

```go
log.Printf("active workers: %d", runtime.NumGoroutine())
```

**What is wrong?**

`NumGoroutine` returns *total* goroutines, including system goroutines (GC, sysmon, pprof handlers). It is not "active workers." For tests on a typical Go program, the baseline is 5–10 goroutines from the runtime itself.

**Fix.**

If you want to count your own workers, increment an atomic counter on entry and decrement on exit:

```go
var activeWorkers atomic.Int64

go func() {
    activeWorkers.Add(1)
    defer activeWorkers.Add(-1)
    work()
}()
```

---

## Bug 25 — Spawning goroutines during shutdown

```go
func (s *Server) Close() error {
    s.cancel()
    // ... cleanup ...
    go s.flushMetrics() // BUG
    return nil
}
```

**What is wrong?**

During shutdown, spawning new goroutines creates work that may not complete before the program exits. The `flushMetrics` goroutine may be orphaned.

**Fix.**

Either complete the work synchronously, or join the spawned goroutine:

```go
done := make(chan struct{})
go func() {
    s.flushMetrics()
    close(done)
}()
select {
case <-done:
case <-time.After(5 * time.Second):
    log.Warn("flush metrics timed out")
}
```

---

## Closing

Scheduler-aware bugs cluster around:

- Misusing `GOMAXPROCS` (especially in containers).
- Misusing `LockOSThread` (pinning when not needed).
- Misunderstanding which operations hold M's vs which use netpoll.
- Spawning too many goroutines, especially in hot paths.
- Trusting `NumGoroutine` as load or activity signal.
- Premature manual yield (`Gosched`) or manual GC (`runtime.GC`).
- No cancellation = leaks = scheduler bloat over time.

The runtime is well-engineered. Most of the time, leaving it alone and using default settings is correct. When you do tune, measure first, change one thing, measure again.
