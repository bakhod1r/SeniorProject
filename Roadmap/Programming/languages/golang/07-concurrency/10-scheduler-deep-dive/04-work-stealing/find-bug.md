# Work Stealing — Find the Bug

## Table of Contents
1. [Bug 1: `LockOSThread` Starvation](#bug-1-lockosthread-starvation)
2. [Bug 2: GOMAXPROCS=1 Surprise](#bug-2-gomaxprocs1-surprise)
3. [Bug 3: Tight Loop, No Preemption](#bug-3-tight-loop-no-preemption)
4. [Bug 4: Hot-Producer Cold-Consumer](#bug-4-hot-producer-cold-consumer)
5. [Bug 5: User-Space LRQ Race](#bug-5-user-space-lrq-race)
6. [Bug 6: Stealing a Stale `runnext`](#bug-6-stealing-a-stale-runnext)
7. [Bug 7: `findRunnable` Loop Without Yield](#bug-7-findrunnable-loop-without-yield)
8. [Bug 8: Channel-Driven Spin](#bug-8-channel-driven-spin)
9. [Bug 9: cgo Blocking Hides Work](#bug-9-cgo-blocking-hides-work)
10. [Bug 10: Misuse of `GOMAXPROCS` in Containers](#bug-10-misuse-of-gomaxprocs-in-containers)

---

## Bug 1: `LockOSThread` Starvation

### Symptom

A worker pool serves requests slowly. CPU utilisation is only ~25% on a 4-core machine. Latency spikes.

### Code

```go
type Worker struct {
    id int
}

func (w *Worker) Run() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    for req := range w.requests {
        process(req)
    }
}

func main() {
    procs := runtime.NumCPU() // 4
    workers := make([]*Worker, procs)
    for i := range workers {
        workers[i] = &Worker{id: i}
        go workers[i].Run()
    }
    // ... distribute requests across workers ...
}
```

### What goes wrong

`LockOSThread` pins each worker to an OS thread. Worker A's M is dedicated to Worker A. If Worker A's request channel is empty but Worker B is overloaded, the runtime cannot run any of B's work on A's M.

Stealing is per-LRQ, not per-G in the abstract. The G `Worker.Run` is unstealable. Its M has nothing to do; sits idle.

### Diagnosis

`GODEBUG=schedtrace=1000`:

```
SCHED 1000ms: gomaxprocs=4 idleprocs=2 ... spinningthreads=0
  P0: lrq=0 ... (busy with Worker A's locked G doing nothing)
  P1: lrq=0 ... (busy with Worker C's locked G doing nothing)
  P2: lrq=15 ... (B has lots of work, M2 busy)
  P3: lrq=10 ... (D has lots of work, M3 busy)
```

The Ms are pinned; the LRQs don't help because each G's Run loop processes only its own channel.

### Fix

Remove `LockOSThread` unless you have a specific need (cgo state, OS-thread state). For a worker pool, just use:

```go
for i := 0; i < procs; i++ {
    go func() {
        for req := range requests { // shared channel
            process(req)
        }
    }()
}
```

Single channel, multiple consumers. The runtime balances naturally.

---

## Bug 2: GOMAXPROCS=1 Surprise

### Symptom

A program that scales linearly in benchmarks runs single-threaded in production.

### Code

```go
// init.go
func init() {
    runtime.GOMAXPROCS(1) // "for predictable behavior"
}
```

Or, more subtly, in containers without CPU quota detection:

```go
// nothing explicit; the runtime auto-detects CPUs.
// But the container's /proc/cpuinfo says 1 CPU.
```

### What goes wrong

With `GOMAXPROCS=1`, there is one P. No stealing is possible (no other P to steal from). All goroutines run on one M.

### Diagnosis

```go
fmt.Println(runtime.GOMAXPROCS(0))
```

Prints 1.

### Fix

For containers, use `automaxprocs`:

```go
import _ "go.uber.org/automaxprocs"
```

This reads cgroup CPU quota and sets `GOMAXPROCS` correctly.

For the explicit `init` call: just delete it. The default is correct in 99% of cases.

---

## Bug 3: Tight Loop, No Preemption

### Symptom

A goroutine "blocks" the scheduler. Other goroutines on the same M never run. In Go 1.13 and earlier, this was a hard bug; in Go 1.14+, async preemption recovers but with some latency.

### Code

```go
func main() {
    runtime.GOMAXPROCS(1)
    go func() {
        for {
            // Tight loop, no function calls, no channel ops.
            // No safepoint.
        }
    }()
    time.Sleep(time.Second)
    fmt.Println("hello") // never prints in Go ≤ 1.13
}
```

### What goes wrong

Before Go 1.14, the only preemption was cooperative: a G yields at function-call safepoints. A loop with no calls never yields. `time.Sleep`'s callback can't get scheduled.

In Go 1.14+, async preemption signals the M every ~10 ms. The loop is interrupted; the safe-stop point is computed; the G goes back to LRQ; `time.Sleep`'s callback runs.

### Diagnosis

On Go < 1.14: the program hangs at the print. `kill -3` shows the main goroutine in `time.Sleep` and the loop goroutine in `[running]` forever.

On Go ≥ 1.14: the program prints after ~1 second. But on Go 1.13 and earlier, it's a hard deadlock.

### Fix

Add a yield: `runtime.Gosched()` or `time.Sleep(0)` somewhere in the loop. Or upgrade Go.

Better: use a `select` with a `default` to allow yielding.

---

## Bug 4: Hot-Producer Cold-Consumer

### Symptom

Goroutine count grows unboundedly. Memory usage rises. Eventually OOM.

### Code

```go
func main() {
    for {
        ev := <-events
        go process(ev) // unbounded spawn
    }
}

func process(ev Event) {
    // Slow: 100 ms per event.
}
```

### What goes wrong

Events arrive at 10,000/s. Each spawns a goroutine. `process` takes 100 ms. Maximum concurrent Gs: 1,000,000. They overflow the LRQ to the GRQ, then to all LRQs. Memory blows up.

Work stealing helps but cannot do magic. The producer is too fast.

### Diagnosis

`GODEBUG=schedtrace=1000` shows `runqueue` growing into the millions. `runtime.NumGoroutine()` exceeds 1M. Memory grows linearly.

### Fix

Bounded worker pool:

```go
const N = 100
sem := make(chan struct{}, N)
for ev := range events {
    sem <- struct{}{}
    ev := ev
    go func() {
        defer func() { <-sem }()
        process(ev)
    }()
}
```

Or: a fixed pool reading from a channel:

```go
work := make(chan Event, 1000)
for i := 0; i < N; i++ {
    go func() {
        for ev := range work {
            process(ev)
        }
    }()
}
for ev := range events {
    work <- ev // backpressure
}
```

---

## Bug 5: User-Space LRQ Race

### Symptom

A user-space work-stealing scheduler intermittently runs the same task twice or loses tasks.

### Code

```go
type Queue struct {
    head, tail uint32
    buf        [256]Task
}

func (q *Queue) Push(t Task) {
    q.buf[q.tail%256] = t
    q.tail++
}

func (q *Queue) Steal(out *Queue) int {
    if q.tail == q.head { return 0 }
    n := (q.tail - q.head) / 2
    if n == 0 { n = 1 }
    for i := uint32(0); i < n; i++ {
        out.buf[(out.tail+i)%256] = q.buf[(q.head+i)%256]
    }
    out.tail += n
    q.head += n
    return int(n)
}
```

### What goes wrong

No atomics. Two thieves can both read `q.head=10`, both compute `n=4`, both increment to `q.head=14` — but actually only 4 of the 8 they think they took are real. Duplicates or losses result.

### Fix

Use `atomic.Uint32` for head and tail. The owner uses `StoreRel(tail, t+1)`. Thieves use `CAS(head, h, h+n)` to claim. On CAS failure, retry.

See Task 2 in `tasks.md` for the correct implementation.

---

## Bug 6: Stealing a Stale `runnext`

### Symptom

A profiler shows tail-latency spikes. Some operations complete in 1 ms; rare ones take 100 ms.

### Hypothesis

A child goroutine spawned via `go child()` ends up in the parent's `runnext` slot. The parent's M is about to consume `runnext`, but a thief races and CAS-succeeds. The child runs on the thief's P. The cache line for `child`'s data is now cold; cross-P access slows it.

### Real bug?

This is *not* really a bug in well-tuned code. The `usleep(3)` in `runqgrab` exists specifically to give the owner priority. The 100-ms latency in user code is more likely something else (GC pause, syscall blocking).

### Investigation

`go tool trace`. Look at the slow operations' goroutine timelines:

- Where did the G run?
- Was it stolen (cross-P migration visible)?
- How long did it wait between scheduling events?

If the slow op shows long `Goroutine wait` regions, it's not stealing — it's true blocking. If it shows short wait but slow execution, check GC (`GoBlockGC` events).

### Lesson

`runnext` stealing is rare and well-handled. Latency tails are usually elsewhere. Don't blame stealing without trace evidence.

---

## Bug 7: `findRunnable` Loop Without Yield

### Symptom (theoretical)

A custom scheduler keeps M-equivalents in a tight loop: pop, run, repeat. No yield point. Multi-thread interaction stalls.

### Why a problem

In the Go runtime, `findRunnable` calls into the runtime — it implicitly yields by checking timers, GC, sysmon. In user code, if you write your own scheduler-like loop, you must:

- Periodically allow GC to advance (cooperate on safepoints).
- Yield to other goroutines (`runtime.Gosched()`).
- Check for shutdown signals.

### Code

```go
func (w *Worker) run() {
    for {
        if t, ok := w.pop(); ok {
            t()
        } else if t, ok := w.steal(); ok {
            t()
        }
        // No yield, no Gosched.
    }
}
```

The runtime's preemption signal hits this and forces a yield. But if you've `LockOSThread`'d the worker, preemption can't help.

### Fix

```go
for {
    if t, ok := w.pop(); ok {
        t()
        continue
    }
    if t, ok := w.steal(); ok {
        t()
        continue
    }
    runtime.Gosched()
}
```

Or use a `select` with a `default` to allow channel-driven shutdown.

---

## Bug 8: Channel-Driven Spin

### Symptom

CPU usage at 100% on multiple cores; no progress.

### Code

```go
done := make(chan struct{})
go func() {
    for {
        select {
        case <-done:
            return
        default:
            // do nothing, just spin
        }
    }
}()
```

### What goes wrong

The `select` with `default` never blocks. It spins forever. The G holds its M; stealing redistributes other Gs, but this G monopolises its M.

Async preemption will preempt it every 10 ms, freeing the M for ~1 schedule cycle. But it bounces right back.

### Fix

```go
go func() {
    for {
        select {
        case <-done:
            return
        case <-time.After(100 * time.Millisecond):
            // do periodic check
        }
    }
}()
```

Now the G parks between checks; the M is free.

---

## Bug 9: cgo Blocking Hides Work

### Symptom

A program makes cgo calls. Other goroutines stall. Stealing seems to fail.

### Code

```go
func process(data []byte) {
    C.long_running_c_function(unsafe.Pointer(&data[0]), C.int(len(data)))
}

func main() {
    for ev := range events {
        go process(ev)
    }
}
```

### What goes wrong

Each cgo call holds an M (the M is detached from its P during the cgo). Many simultaneous cgo calls exhaust the M pool. The runtime spins up new Ms (clone(2)), each costing ~10 μs.

Worse: the P that was bound to the cgo'ing M is handed off after 10 μs by sysmon. Until then, its LRQ is unreachable to other Ms.

### Diagnosis

`GODEBUG=schedtrace=1000` shows growing `threads=` counts. Goroutine count is high. CPU is high but in `cgo` time.

### Fix

Limit cgo concurrency:

```go
sem := make(chan struct{}, 8)
for ev := range events {
    sem <- struct{}{}
    ev := ev
    go func() {
        defer func() { <-sem }()
        process(ev) // cgo inside
    }()
}
```

Caps simultaneous cgo calls. M count stabilises.

---

## Bug 10: Misuse of `GOMAXPROCS` in Containers

### Symptom

A service runs in a container with a 2-CPU quota but reports `GOMAXPROCS=64` (the host's count). Thread contention is high; tail latency is bad.

### What goes wrong

The runtime reads `/proc/cpuinfo` (or `runtime.NumCPU()`) which sees the host's CPUs. The Linux kernel CFS quota is *not* visible via that API. So Go thinks it has 64 cores; kernel only schedules it on 2.

Stealing happens across all 64 Ps. But only 2 can run at once; the others spin uselessly, then park, then spin again. Sysmon fires constantly. Async preemption fires constantly.

### Diagnosis

`runtime.GOMAXPROCS(0)` returns 64. `cat /sys/fs/cgroup/cpu.max` returns `200000 100000` (2 CPUs).

### Fix

Use `automaxprocs`:

```go
import _ "go.uber.org/automaxprocs"
```

It reads cgroup quota and sets `GOMAXPROCS=2`. Stealing now happens across 2 Ps; no wasted spinning.

In Go 1.22+, the runtime supports `GOMAXPROCS=auto` via env var or runtime call to read cgroups automatically (proposal landing).

---

## Reflection

Bugs in code that uses work stealing fall into categories:

1. **User code starves the scheduler**: tight loops, `LockOSThread`, unbounded spawning.
2. **Misconfiguration**: `GOMAXPROCS` set wrong, container quotas ignored.
3. **Custom schedulers that reinvent badly**: user-space queues without atomics, missing yields.

Real bugs *in* the runtime's stealing path are rare. Almost every "stealing doesn't work" report turns out to be one of the above categories.

When debugging, in order:

1. `GODEBUG=schedtrace=1000` — see queue state.
2. `kill -3` — see all goroutine stacks.
3. `go tool pprof` — see CPU time distribution.
4. `go tool trace` — see scheduler events.
5. Only then suspect the runtime.

End of `find-bug.md`. For performance optimisation, see `optimize.md`.
