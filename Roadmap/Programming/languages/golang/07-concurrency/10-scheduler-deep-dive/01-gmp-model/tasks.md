# The G-M-P Model — Tasks

[← Back to index](index.md)

## How to Use This Page

Each task is a self-contained exercise that pushes you to observe, reproduce, or reason about a piece of the G-M-P model. Hints and starting code are provided. Reference solutions are not — solving the tasks is the point.

Estimated times are listed. Work in order; later tasks build on earlier ones.

---

## Task 1 — Print the Number of Ps, Ms, and Gs (15 min)

Write a small program that prints the current count of Ps, Gs, and an approximation of Ms over time.

```go
package main

import (
    "fmt"
    "runtime"
    "runtime/metrics"
    "time"
)

func main() {
    samples := []metrics.Sample{
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/sched/gomaxprocs:threads"},
    }

    for i := 0; i < 10; i++ {
        metrics.Read(samples)
        fmt.Printf("Gs: %d   Ps: %d (GOMAXPROCS)\n",
            samples[0].Value.Uint64(),
            samples[1].Value.Uint64(),
        )
        time.Sleep(100 * time.Millisecond)
    }

    _ = runtime.GOMAXPROCS
}
```

Note: there is no public `NumThread`; `runtime/metrics` exposes related metrics by Go version. Check what is available with `metrics.All()`.

Validation: spawn 1000 goroutines, observe Gs increase, then exit, observe Gs decrease.

---

## Task 2 — Build a Mini Worker Pool Sized to `GOMAXPROCS` (20 min)

Build a worker pool that uses exactly `GOMAXPROCS` workers for CPU-bound work.

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

type Job struct {
    N int
}

type Result struct {
    JobN int
    Sum  int64
}

func main() {
    n := runtime.GOMAXPROCS(0)
    jobs := make(chan Job, n*2)
    results := make(chan Result, n*2)

    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                var sum int64
                for k := 0; k < j.N; k++ {
                    sum += int64(k)
                }
                results <- Result{j.N, sum}
            }
        }()
    }

    go func() {
        for i := 1; i <= 100; i++ {
            jobs <- Job{N: i * 100000}
        }
        close(jobs)
    }()

    go func() {
        wg.Wait()
        close(results)
    }()

    for r := range results {
        fmt.Printf("Job N=%d: sum=%d\n", r.JobN, r.Sum)
    }
}
```

Try varying the worker count to `n/2`, `n`, `2n`, `4n`. For CPU-bound work, throughput plateaus at `n` and *decreases* above due to context-switch overhead. Plot or tabulate the timings.

---

## Task 3 — Observe the LRQ Overflow (25 min)

Force a P's local runqueue to overflow into the global runqueue, and observe the effect with `GODEBUG=schedtrace=...`.

```go
package main

import (
    "runtime"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(1)
    var wg sync.WaitGroup
    var x int

    // Spawn many goroutines from inside one goroutine.
    // On a single-P system, all newproc calls happen on the same P.
    // The LRQ holds 256 entries; the rest spill to GRQ.
    go func() {
        for i := 0; i < 1000; i++ {
            wg.Add(1)
            go func() {
                defer wg.Done()
                x++ // intentional race for now; the point is volume
            }()
        }
    }()

    wg.Wait()
}
```

Run with:
```
GODEBUG=schedtrace=10 ./prog
```

Watch for the `runqueue=...` field for P0 and the `lrunq=...` field for the global queue. You should see GRQ growing as LRQ saturates.

Hint: at runtime, only the `schedtrace` lines tell you what is on the GRQ vs LRQ. Add `scheddetail=1` for per-P details.

---

## Task 4 — Visualise the Scheduler with `go tool trace` (30 min)

Capture a `runtime/trace` of a concurrent workload and view it.

```go
package main

import (
    "fmt"
    "os"
    "runtime/trace"
    "sync"
)

func main() {
    f, err := os.Create("trace.out")
    if err != nil {
        fmt.Println(err)
        return
    }
    defer f.Close()

    if err := trace.Start(f); err != nil {
        fmt.Println(err)
        return
    }
    defer trace.Stop()

    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            ch := make(chan int)
            go func() {
                for j := 0; j < 1000; j++ {
                    ch <- j
                }
                close(ch)
            }()
            sum := 0
            for v := range ch {
                sum += v
            }
            _ = sum
        }(i)
    }
    wg.Wait()
}
```

Run `go tool trace trace.out`. Open the "Procs" view. Identify:
- How many P lanes (should equal `GOMAXPROCS`).
- Goroutines migrating between Ps.
- Time goroutines spend in `_Gwaiting` (channel blocks).
- Whether any P is idle while others have work.

If any P is idle while another has a long single-G run, you have parallelism left on the table.

---

## Task 5 — Reproduce a `runqsteal` (35 min)

Set up a scenario where one P's queue is full and another's is empty, and verify (via trace) that work-stealing happens.

```go
package main

import (
    "os"
    "runtime"
    "runtime/trace"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(2)
    f, _ := os.Create("steal.trace")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    // Pin a goroutine to P0 via LockOSThread.
    // It spawns 500 children locally, then exits.
    var wg sync.WaitGroup
    wg.Add(500)
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        for i := 0; i < 500; i++ {
            go func() {
                defer wg.Done()
                spin(1_000_000)
            }()
        }
    }()

    wg.Wait()
}

func spin(n int) {
    s := 0
    for i := 0; i < n; i++ {
        s += i
    }
    _ = s
}
```

In the trace, observe goroutines created on P0 but executed on P1 — those are stolen Gs.

Note: `LockOSThread` is used here to keep the spawner on one P during the burst. Without it, the runtime may migrate the spawner mid-spawn and your reproduction is less reliable.

---

## Task 6 — Implement a Toy Per-P Counter (40 min)

Implement a counter that uses per-P state to avoid contention, then aggregates on read. The goal is to mimic the runtime's per-P caching pattern.

```go
package counter

import (
    "runtime"
    "sync/atomic"
)

type Counter struct {
    shards []atomic.Int64
}

func New() *Counter {
    return &Counter{
        shards: make([]atomic.Int64, runtime.GOMAXPROCS(0)),
    }
}

func (c *Counter) Inc() {
    // Pick a shard. Ideally: by current P id.
    // The runtime does not expose this; approximate with goid hash or random.
    // For demo: use a thread-local-ish trick or fastrand.
    idx := shardIndex(len(c.shards))
    c.shards[idx].Add(1)
}

func (c *Counter) Read() int64 {
    var total int64
    for i := range c.shards {
        total += c.shards[i].Load()
    }
    return total
}

func shardIndex(n int) int {
    // Approximation. Replace with current-P-id if you find a way.
    return int(fastrand()) % n
}

func fastrand() uint32 {
    // implement with a goroutine-local rng (not provided by stdlib)
    return 0
}
```

Compare throughput vs `sync/atomic.Int64.Add` alone under 100 producers. The sharded version should be faster.

Hint: you cannot reliably get the current P id from user Go code. Approximations: hash the goroutine id (`runtime.Stack` parse, slow), use a `runtime.LockOSThread`-tagged routine, or call into `runtime/internal` (forbidden). For real per-P caches, the runtime relies on the M's P pointer in TLS, which only the runtime can read.

---

## Task 7 — Measure `runnext` Latency Benefit (45 min)

Construct a microbenchmark that shows `runnext` reducing latency in channel ping-pong.

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1)
    ping := make(chan struct{})
    pong := make(chan struct{})

    go func() {
        for {
            <-ping
            pong <- struct{}{}
        }
    }()

    const iters = 1_000_000
    start := time.Now()
    for i := 0; i < iters; i++ {
        ping <- struct{}{}
        <-pong
    }
    elapsed := time.Since(start)
    fmt.Printf("ping-pong on GOMAXPROCS=1: %v per iter\n", elapsed/iters)
}
```

Then run on `GOMAXPROCS=2`, `GOMAXPROCS=4`. Observe:
- On `GOMAXPROCS=1`, both goroutines share one P; `runnext` keeps them ping-ponging without going through the runqueue.
- On `GOMAXPROCS=2`, the runtime may place them on different Ps, increasing per-iteration latency (cache misses, runqueue ops).

The result counterintuitively shows lower latency at `GOMAXPROCS=1` for this two-goroutine workload. This is the `runnext` effect in action.

---

## Task 8 — Build a Toy Scheduler (90 min)

Build a tiny scheduler in plain Go that demonstrates the M:N pattern (no runtime hacking). Run it as a sandbox to understand the data flow.

```go
package toysched

import "sync"

type G struct {
    fn   func()
    next *G
}

type P struct {
    runq []*G
    cap  int
    mu   sync.Mutex
}

type M struct {
    p *P
}

type Sched struct {
    ps      []*P
    pidle   chan *P
    workers int
}

func New(workers, runqCap int) *Sched {
    s := &Sched{workers: workers, pidle: make(chan *P, workers)}
    for i := 0; i < workers; i++ {
        p := &P{cap: runqCap}
        s.ps = append(s.ps, p)
        s.pidle <- p
    }
    return s
}

func (s *Sched) Go(fn func()) {
    g := &G{fn: fn}
    // Submit to a random P or to the least loaded.
    s.ps[0].push(g) // simplified
    select {
    case p := <-s.pidle:
        go s.run(p)
    default:
    }
}

func (s *Sched) run(p *P) {
    for {
        g := p.pop()
        if g == nil {
            // try to steal
            g = s.steal(p)
            if g == nil {
                s.pidle <- p
                return
            }
        }
        g.fn()
    }
}

func (s *Sched) steal(self *P) *G { return nil } // TODO

func (p *P) push(g *G) {
    p.mu.Lock()
    p.runq = append(p.runq, g)
    p.mu.Unlock()
}

func (p *P) pop() *G {
    p.mu.Lock()
    defer p.mu.Unlock()
    if len(p.runq) == 0 {
        return nil
    }
    g := p.runq[len(p.runq)-1]
    p.runq = p.runq[:len(p.runq)-1]
    return g
}
```

Extend it: implement `steal` to take half of a random other P's queue. Compare throughput against a single-channel work queue. Notice that the data structures and protocol mirror Go's real scheduler — even with mutexes (we don't have access to the runtime's lock-free atomics).

---

## Task 9 — Decode a `schedtrace` Line (30 min)

Run a Go program with `GODEBUG=schedtrace=1000,scheddetail=1`. Take one printed line and annotate every field.

Sample line:
```
SCHED 0ms: gomaxprocs=4 idleprocs=2 threads=8 spinningthreads=0 needspinning=0 idlethreads=4 runqueue=0 gcwaiting=false nmidlelocked=0 stopwait=0 sysmonwait=false
```

Translate each token:
- `gomaxprocs=4` — number of Ps.
- `idleprocs=2` — Ps currently on `sched.pidle`.
- `threads=8` — total Ms created (alive plus dead-pending-free).
- `spinningthreads=0` — `sched.nmspinning`.
- `needspinning=0` — flag set by `wakep` to request a new spinner.
- `idlethreads=4` — Ms parked on `m.park`.
- `runqueue=0` — GRQ size.
- `gcwaiting=false` — GC is not currently waiting for STW.
- `nmidlelocked=0` — Ms locked to specific Gs that are not runnable.
- `stopwait=0` — count of Ps yet to acknowledge STW.
- `sysmonwait=false` — sysmon is not currently waiting on a note.

With `scheddetail=1`, per-P and per-M lines follow, each with their own fields. Decode each.

---

## Task 10 — Show That Async Preemption Works (40 min)

Pre-Go 1.14, the following program would hang forever on `GOMAXPROCS=1`. On Go 1.14+, it completes.

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(1)
    var wg sync.WaitGroup
    wg.Add(1)

    go func() {
        defer wg.Done()
        var x int
        for i := 0; i < 1_000_000_000; i++ {
            x += i
        }
        fmt.Println("burner done")
    }()

    // Give the burner a head start.
    runtime.Gosched()

    // This goroutine should eventually run thanks to async preemption.
    fmt.Println("main waiting")
    wg.Wait()
    fmt.Println("main done")
}
```

Without async preemption (Go ≤ 1.13), `main waiting` never prints because the burner never yields and `GOMAXPROCS=1` means main can't run in parallel. With async preemption (1.14+), sysmon notices the burner has run for >10 ms and sends SIGURG, the burner is preempted, main runs, prints "main waiting", calls `wg.Wait`, which parks main, allowing the burner to resume.

Run on Go 1.13 (if accessible) vs Go 1.22 to see the difference. Or just appreciate that on modern Go, the program completes — the preemption is invisible but essential.

---

## Task 11 — Build a `GOMAXPROCS` Stress Test (30 min)

Write a test that exercises `runtime.GOMAXPROCS(n)` changes under load. Goal: convince yourself the procresize-driven STW does not cause data loss.

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

func main() {
    var done atomic.Bool
    var counter atomic.Int64
    var wg sync.WaitGroup

    for i := 0; i < 16; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for !done.Load() {
                counter.Add(1)
            }
        }()
    }

    // Resizer goroutine.
    for n := 1; n <= 8 && !done.Load(); n++ {
        runtime.GOMAXPROCS(n)
        time.Sleep(100 * time.Millisecond)
    }

    done.Store(true)
    wg.Wait()
    fmt.Println("counter:", counter.Load())
}
```

Observe: counter is consistent (no atomic reads disappeared). The STW briefly halts workers but does not corrupt their work.

Watch CPU usage in a separate window while it runs — it should ramp up as `GOMAXPROCS` increases.

---

## Task 12 — Compute the "Steal Ratio" (45 min)

Approximate the fraction of dispatches that were stolen vs locally dequeued.

Approach: use `runtime/trace` to get `GoStart` events (which include the P id and the G id). Track which P originally ran a G previously vs which P picked it up next. Migrations = steals.

```go
package main

import (
    "fmt"
    "os"
    "runtime/trace"
    "sync"
)

func main() {
    f, _ := os.Create("steal_ratio.trace")
    defer f.Close()
    trace.Start(f)

    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 10000; j++ {
                _ = j * j
            }
        }()
    }
    wg.Wait()
    trace.Stop()

    fmt.Println("Now analyze with: go tool trace steal_ratio.trace")
}
```

In `go tool trace`'s "Goroutines" or scheduler latency profile, count migrations vs total `Gostart` events. A heavily-stealing run shows >30% migrations; a well-balanced run shows <5%.

You can also parse the trace programmatically with `golang.org/x/exp/trace` (or `internal/trace`).

---

## Task 13 — Reason About the LockOSThread Cost (20 min)

Write two versions of a "compute pi via Monte Carlo" benchmark: one that calls `runtime.LockOSThread` in each worker, one that does not. Run with `GOMAXPROCS=4`. Compare:

- Wall time.
- Thread count (via `top` or `ps`).
- Trace view.

Expected: the locked version creates more OS threads (because the runtime needs replacement Ms for the locked ones) and shows similar throughput (compute-bound, not lock-bound) but higher kernel-side overhead.

---

## Task 14 — Find a `gopark` in a Stack Trace (20 min)

Take any Go program that uses `time.Sleep` or channels. Send it a SIGQUIT (`kill -QUIT pid`) to dump all goroutine stacks. Look for `runtime.gopark` in the parked goroutines' traces. For each one, identify the wait reason from the line above (e.g., `[chan receive]`, `[sleep]`, `[select]`).

```
goroutine 7 [chan receive]:
runtime.gopark(0x...)
    /usr/local/go/src/runtime/proc.go:381 +0xd6
runtime.chanrecv(0xc000064060, 0xc000087f88, 0x1)
    /usr/local/go/src/runtime/chan.go:583 +0x4f5
runtime.chanrecv1(0xc000064060, 0xc000087f88)
    /usr/local/go/src/runtime/chan.go:442 +0x18
main.worker(...)
```

You are reading the result of the scheduler's `gopark` call — the G was parked on the channel's `recvq`, and you see it preserved with full stack and PC ready for resumption.

---

## Task 15 — Build a Capstone Benchmark (90 min)

Combine everything: build a small program that performs a mixed workload (CPU + channels + I/O) and produce:

1. A `go tool trace` capture.
2. A `pprof` CPU profile.
3. A schedtrace log.
4. A measured throughput at `GOMAXPROCS` values 1, 2, 4, 8.

Write a short markdown report (for yourself; do not commit) that explains:
- How does throughput scale with `GOMAXPROCS`?
- Where do you see steals in the trace?
- Where do you see global-queue fairness sips?
- Are there idle Ps while work is queued? Why?
- How many Ms exist at peak? Why?

This task is the integration of every concept in this section. Once you can answer these questions about your own program, you have internalised the G-M-P model at the level of practical engineering.
