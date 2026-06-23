# The G-M-P Model — Find the Bug

[← Back to index](index.md)

## How to Use This Page

Each section presents a Go program or scenario and a question. Read the code carefully, predict the behavior, and only then read the explanation. The bugs here manifest because of the underlying G-M-P mechanics — they only become obvious once you can think in those terms.

---

## Bug 1 — "My CPU-Bound Loop Hogs Everything" (Pre-1.14)

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1)

    go func() {
        for {
            // No function calls, no channel ops.
            // Just a tight loop.
        }
    }()

    time.Sleep(100 * time.Millisecond)

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        fmt.Println("second goroutine ran")
    }()
    wg.Wait()
}
```

**Pre-1.14**: this program hangs. With `GOMAXPROCS=1`, only one P. The empty `for {}` loop occupies that P. There is no function call, so no cooperative preemption point. The second goroutine is `_Grunnable` but cannot get scheduled.

**Post-1.14 (Go 1.14+)**: sysmon notices the loop has been running for >10 ms without yielding. It sends SIGURG to the M; the runtime preempts the burner, marks it `_Gpreempted`, runs `schedule()`, which picks the second G. The program prints and exits.

**Why the internals matter**: knowing that `runtime.Gosched` was the only escape hatch in old Go explains why old code is sprinkled with `runtime.Gosched()` calls in hot loops. Modern code rarely needs it.

---

## Bug 2 — "Adding More Workers Made It Slower"

```go
package main

import (
    "runtime"
    "sync"
    "time"
)

func main() {
    workers := runtime.NumCPU() * 4 // "More is better, right?"
    work := make(chan int, 1000)
    var wg sync.WaitGroup

    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for n := range work {
                // CPU-bound computation
                x := n
                for j := 0; j < 1_000_000; j++ {
                    x = (x*1103515245 + 12345) & 0x7fffffff
                }
                _ = x
            }
        }()
    }

    start := time.Now()
    for i := 0; i < 10000; i++ {
        work <- i
    }
    close(work)
    wg.Wait()
    elapsed := time.Since(start)
    _ = elapsed
}
```

**Question**: why is this slower than using `runtime.NumCPU()` workers?

**Answer**: only `GOMAXPROCS` workers can run *simultaneously* — the rest are time-sliced. With `NumCPU()*4` workers on a 4-core box, 16 goroutines fight over 4 Ps. The scheduler context-switches between them constantly. Each switch costs cache-line invalidations, runqueue ops, and possibly a steal. Total throughput drops 10-30% vs `NumCPU()` workers.

**Why the internals matter**: P count is the parallelism cap. For CPU-bound work, more goroutines than Ps is pure overhead. (For I/O-bound work, more goroutines is fine because they spend most time parked.)

---

## Bug 3 — "Why Does My Goroutine Count Keep Growing?"

```go
package main

import (
    "fmt"
    "net/http"
    "runtime"
    "time"
)

func handler(w http.ResponseWriter, r *http.Request) {
    go logRequest(r) // fire-and-forget
    w.Write([]byte("OK"))
}

func logRequest(r *http.Request) {
    // The "log server" is unreliable; this sometimes hangs forever.
    resp, err := http.Get("http://log-server/log?path=" + r.URL.Path)
    if err != nil {
        return
    }
    resp.Body.Close()
}

func main() {
    go func() {
        for {
            fmt.Println("goroutines:", runtime.NumGoroutine())
            time.Sleep(time.Second)
        }
    }()
    http.HandleFunc("/", handler)
    http.ListenAndServe(":8080", nil)
}
```

**Symptom**: goroutine count climbs monotonically over hours. Eventually the process is killed by OOM or the runtime hits the M cap.

**Diagnosis**: `logRequest` may hang forever waiting for a slow/unresponsive log server. Each hang leaves one goroutine parked. The runtime sees them as `_Gwaiting` on netpoll. There is no leak detector for this kind of slow drift.

**Fix**: every `http.Get` that may hang needs a timeout via `http.Client{Timeout: ...}` or a `context.WithTimeout`. Without that, the goroutine accumulates.

**Why the internals matter**: parked Gs cost ~3-5 KiB each (G struct + initial stack). A million parked Gs is gigabytes. Plus, every parked G is in some primitive's wait queue, holding a sudog. The Go runtime does not garbage-collect "stuck" goroutines.

---

## Bug 4 — "Why Does Container Throttling Kill My App?"

```go
// In a Kubernetes pod with resources.requests.cpu = "500m" and limits.cpu = "1"
// running on a 32-core machine.

package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    fmt.Println("GOMAXPROCS:", runtime.GOMAXPROCS(0))

    var wg sync.WaitGroup
    for i := 0; i < 32; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            spin(1_000_000_000)
        }()
    }
    wg.Wait()
}

func spin(n int) {
    x := 0
    for i := 0; i < n; i++ {
        x += i
    }
    _ = x
}
```

**Symptom**: on Go ≤ 1.24, this prints `GOMAXPROCS: 32`. The program creates 32 goroutines, each on its own P, all spinning. The cgroup CPU quota is 1 core. The kernel throttles the cgroup every period, badly degrading latency for everything in the pod.

**Cause**: pre-Go 1.25, `runtime.GOMAXPROCS` defaults to `NumCPU()` of the *machine*, not the cgroup's effective CPU quota. On a 32-core host with a 1-core cgroup limit, Go thinks it has 32 cores.

**Fix**:
- Go 1.25+: the default is now cgroup-aware.
- Pre-1.25: use `go.uber.org/automaxprocs` package, which reads `/sys/fs/cgroup/cpu.max` and calls `runtime.GOMAXPROCS(n)` accordingly.
- Or: set `GOMAXPROCS` explicitly via environment variable to match the cgroup limit.

**Why the internals matter**: P count is parallelism cap. Setting it too high creates contention for kernel-throttled CPU time; setting it too low underutilises.

---

## Bug 5 — "My LockOSThread Goroutine Won't Stop"

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        runtime.LockOSThread()
        // forgot UnlockOSThread
        fmt.Println("doing thread-local work")
    }()
    wg.Wait()

    fmt.Println("done")
    // Process exits — but how many extra OS threads were left behind?
}
```

**Symptom**: harmless here (the process exits), but if you imagine this pattern in a long-running server that spawns thousands of LockOSThread workers and forgets to unlock, the M pool balloons.

**Why**: when a G is locked to an M and that G exits, the runtime kills the M (since it cannot be reused). However, a G that is *locked* but still alive holds its M permanently. Other Gs cannot share the M; the runtime must create extras to keep Ps busy.

**Worse**: if the locked G calls `goexit` normally, the M is destroyed. If the locked G is alive and blocked, the M is unavailable for other work.

**Fix**: always `defer runtime.UnlockOSThread()` immediately after `runtime.LockOSThread()`.

**Why the internals matter**: M count can grow without bound. The runtime caps at 10000 by default (`debug.SetMaxThreads`); hitting the cap kills the program with `runtime: program exceeds 10000-thread limit`.

---

## Bug 6 — "Channel Send Sometimes Takes Microseconds"

```go
package main

import (
    "sync"
    "time"
)

func main() {
    runtime.GOMAXPROCS(8)
    ch := make(chan int, 100)
    var wg sync.WaitGroup

    // 1000 producers, one consumer.
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < 100; j++ {
                ch <- id*1000 + j
            }
        }(i)
    }

    // One consumer.
    wg.Add(1)
    go func() {
        defer wg.Done()
        count := 0
        for range ch {
            count++
            if count == 100_000 {
                return
            }
        }
    }()

    wg.Wait()
    time.Sleep(time.Second)
}
```

**Symptom**: in a mutex profile, `runtime.lock2` is the top hotspot. The 1000 producers all contend on the channel's internal mutex.

**Why**: a single channel has a single `hchan.lock`. Every send and receive takes that lock. With 1000 producers on 8 Ps, the lock is contended every nanosecond. The runtime's spin-mutex falls through to futex sleeps; producers wait microseconds for a slot.

**Fix**: shard the channel. Use `N` channels, each producer sends to `channels[id%N]`. A consumer goroutine per channel (or one consumer doing a fan-in `select`) drains them.

```go
const N = 8
channels := make([]chan int, N)
for i := range channels {
    channels[i] = make(chan int, 100)
}

// Producer:
channels[id%N] <- value
```

**Why the internals matter**: P-local data is contention-free; cross-P data is contended. A single channel is cross-P state. The runtime cannot magically scale a single hchan.

---

## Bug 7 — "My CPU Profile Shows `runtime.findRunnable`"

```
(pprof) top
Showing nodes accounting for 12.34s, 67.89% of 18.18s total
      flat  flat%   sum%        cum   cum%
     6.50s 35.76% 35.76%      8.10s 44.55%  runtime.findRunnable
     1.20s  6.60% 42.36%      1.20s  6.60%  runtime.lock2
     ...
```

**Symptom**: a significant fraction of CPU time is in `runtime.findRunnable`.

**Diagnosis**: too many Ms are spinning relative to the available work. The runtime's spinning Ms scan other Ps, then the global queue, then netpoll — burning CPU. If there is genuinely no work, they park.

**Common causes**:
1. **Workload is bursty**: many spikes of work followed by long idle. Spinning Ms always look briefly before parking; in bursty workloads they spin frequently.
2. **GOMAXPROCS is too high for the workload**. With 32 Ps and only enough work for 4, 28 Ps are constantly idle and 14 of them may be spinning.
3. **Network poller wake-up rate is high**. Each network event wakes a spinning M which scans.

**Fix**:
- Reduce `GOMAXPROCS` to match steady-state parallelism needs.
- Batch work to reduce wake events.
- Increase per-event work so each `findRunnable` returns work rather than parks.

**Why the internals matter**: spinning is a *deliberate* CPU cost the runtime accepts to reduce wake latency. If the trade-off is wrong for your workload, lowering `GOMAXPROCS` helps.

---

## Bug 8 — "Goroutine Leak Despite Context Cancellation"

```go
func fetch(ctx context.Context, url string) ([]byte, error) {
    ch := make(chan []byte, 1)
    go func() {
        resp, err := http.Get(url)
        if err != nil {
            return
        }
        defer resp.Body.Close()
        b, _ := io.ReadAll(resp.Body)
        ch <- b
    }()

    select {
    case b := <-ch:
        return b, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

**Bug**: when `ctx` is cancelled, `fetch` returns. But the inner goroutine continues. It eventually does `ch <- b`. The channel has capacity 1, so the send succeeds and the goroutine exits — okay so far.

**But**: if the channel had capacity 0, the inner goroutine would block forever in `ch <- b` because no receiver is left. Goroutine leak.

**Even with capacity 1**: the underlying `http.Get` does not honor the context. It may block for the OS-level timeout (could be minutes), during which the inner goroutine is parked. Many parallel calls accumulate parked goroutines.

**Fix**:
- Use `http.NewRequestWithContext(ctx, ...)` so the HTTP transport cancels.
- Always size the channel for at least one buffered value, so a late send does not block.

**Why the internals matter**: parked goroutines hold G structs, stacks, sudogs. They are invisible in CPU profiles but visible in `runtime.NumGoroutine()`. Leak detection is by trend, not by alarm.

---

## Bug 9 — "Why Doesn't `runtime.Gosched()` Help Here?"

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(2)
    var wg sync.WaitGroup
    wg.Add(2)

    work := false
    go func() {
        defer wg.Done()
        for !work {
            runtime.Gosched()
        }
        fmt.Println("worker woke")
    }()

    go func() {
        defer wg.Done()
        work = true // race!
    }()

    wg.Wait()
}
```

**Bug**: the worker spins on a non-atomic boolean read. `runtime.Gosched()` makes the spin polite (it yields the P), but does not flush the worker's CPU cache or insert a memory barrier. The compiler may also hoist `work` into a register.

The program works "most of the time" because the goroutine scheduler eventually moves the worker to a different M which sees a stale-but-correct cache line. Without that, the loop could spin forever.

**Fix**: use `atomic.Bool` or a channel:

```go
var work atomic.Bool
for !work.Load() {
    runtime.Gosched()
}
```

Or:

```go
done := make(chan struct{})
go func() { <-done; ... }()
go func() { close(done) }()
```

**Why the internals matter**: `Gosched` is a scheduler operation, not a memory barrier. The Go Memory Model only synchronises on channel ops, mutex ops, atomics. The scheduler does not synchronise reads on behalf of your code.

---

## Bug 10 — "GOMAXPROCS=1 Doesn't Mean Single-Threaded"

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(1)
    var counter int

    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++ // race?
        }()
    }
    wg.Wait()
    fmt.Println(counter)
}
```

**Question**: is there a data race? Doesn't `GOMAXPROCS=1` mean only one goroutine runs at a time?

**Answer**: yes, there is a race. `GOMAXPROCS=1` caps *user-Go* parallelism at 1, but:
1. Goroutines are still preempted (async preemption since 1.14, cooperative before).
2. Reads and writes may be interleaved across preemptions.
3. The race detector (`-race`) flags this.

Even on `GOMAXPROCS=1`, `counter++` is three operations (load, add, store) that may be split across preemptions.

**Fix**: `atomic.AddInt32(&counter, 1)` or a mutex.

**Why the internals matter**: parallelism cap ≠ atomicity. The race detector instruments all memory accesses; it does not assume `GOMAXPROCS=1` means "no races possible."

---

## Bug 11 — "My Profile Shows All Time in `runtime.netpoll`"

```
(pprof) top
      flat  flat%   sum%
     8.40s 50.00%  50.00%  runtime.netpoll
     ...
```

**Symptom**: half the CPU profile is in `runtime.netpoll`.

**Possible causes**:
1. **Misinterpretation**: a CPU profile shows on-CPU time. `runtime.netpoll(0)` is non-blocking; if it returns fast, it costs little. But if `netpoll(delay)` is called with a delay, the M is parked in epoll — that is *not* on-CPU. Check the profile type.
2. **Polling rate is high**: `findRunnable` calls `netpoll(0)` on every search. If your workload spawns many Ms in spinning mode, each one polls.
3. **Many fds with events**: a busy server with 100k+ active connections handles huge wake-up volumes.

**Diagnosis**: look at the trace for "Netpoll" timeline events; correlate with goroutine wake events. Use `runtime/metrics` `/sched/latencies:seconds`.

**Fix**:
- Reduce `GOMAXPROCS` if many spinning Ms are scanning.
- Batch connection processing so each wake yields more work.

**Why the internals matter**: `findRunnable` integrates netpoll. The scheduler weaves I/O event delivery into goroutine scheduling at this exact entry point.

---

## Bug 12 — "Two Goroutines Share a Stack?"

```go
type Worker struct {
    buf [4096]byte
}

func (w *Worker) Run() {
    // Use w.buf as a per-goroutine scratch buffer.
}

func main() {
    workers := make([]*Worker, runtime.GOMAXPROCS(0))
    for i := range workers {
        workers[i] = &Worker{}
    }

    for i, w := range workers {
        go w.Run()
        _ = i
    }
}
```

**Question**: does each goroutine have its own `buf`?

**Answer**: yes. `w` is a pointer to a different `Worker` per index. Each goroutine has its own heap-allocated `Worker` with its own `buf`. No sharing.

**Where it goes wrong** is a different but related pattern:

```go
var buf [4096]byte // package-level
for i := 0; i < 10; i++ {
    go func() {
        // Use buf as scratch?
    }()
}
```

Now `buf` is one shared array. Concurrent writes are a race.

**Why the internals matter**: each goroutine has its own *stack* (initial 2 KiB, grows). Locals are on the stack. Globals are heap. Sharing globals across goroutines requires explicit synchronisation.

---

## Bug 13 — "Increased `GOMAXPROCS` Made GC Worse"

**Scenario**: bumping `GOMAXPROCS` from 4 to 16 on a 16-core machine, the program goes from 5% GC time to 25% GC time.

**Diagnosis**:
- Each P has its own `mcache` plus per-P GC mark workers.
- 16 Ps → 16 mcaches, larger total in-use heap before centralisation.
- 16 Ps × per-P mark work = more total mark workers contending for GC work.
- If your allocation rate is high, mark-assist credit on each P deducts more frequently.

**Fix**: tune `GOGC` or `GOMEMLIMIT` to match the new heap pattern; consider whether `GOMAXPROCS=16` is actually beneficial for your workload (it may not be, depending on parallelism profile).

**Why the internals matter**: per-P caches multiply with `GOMAXPROCS`. GC interaction is non-linear. More Ps ≠ proportionally faster.

---

## Closing Notes

Every bug above is invisible to the user — the program "works" — until you can think in terms of G, M, P, and the per-P caches. The fix is rarely complex; the diagnosis is the hard part. Building intuition for "which struct holds the state that is going wrong?" is what this section trains.
