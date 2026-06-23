# Goroutines vs OS Threads — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions or solution sketches are at the end.

---

## Easy

### Task 1 — Print the GMP knobs at startup

Write a program that, at startup, prints:

- Go version (`runtime.Version()`).
- `runtime.NumCPU()`.
- `runtime.GOMAXPROCS(0)`.
- `runtime.NumGoroutine()`.

Run it. Then run with `GOMAXPROCS=1 ./your-program` and `GOMAXPROCS=8 ./your-program`. Observe the change.

**Goal.** Learn the standard runtime knobs and how environment variables override them.

---

### Task 2 — Spawn 100 000 goroutines and measure spawn cost

Time how long it takes to:

1. Spawn 100 000 goroutines, each calling `wg.Done()`.
2. Wait for them all.

Print the average per-goroutine cost.

```go
const N = 100_000
var wg sync.WaitGroup
wg.Add(N)
start := time.Now()
for i := 0; i < N; i++ {
    go func() { wg.Done() }()
}
wg.Wait()
elapsed := time.Since(start)
fmt.Printf("avg %v / goroutine\n", elapsed/N)
```

Expected: 0.5–2 µs per goroutine on a modern laptop.

**Goal.** See the order-of-magnitude cost of goroutine creation.

---

### Task 3 — Compare to thread spawn cost (via cgo)

Using `cgo` and `pthread_create`, spawn 1 000 OS threads in a loop and measure. Compare to 1 000 goroutines.

```go
/*
#include <pthread.h>
void *worker(void *arg) { return NULL; }
*/
import "C"
import (
    "fmt"
    "time"
    "unsafe"
)

func main() {
    const N = 1000
    start := time.Now()
    for i := 0; i < N; i++ {
        var tid C.pthread_t
        C.pthread_create(&tid, nil, (*[0]byte)(C.worker), nil)
        C.pthread_join(tid, nil)
    }
    fmt.Println("threads:", time.Since(start))
}
```

Compare timing to Task 2. Threads should be ~30–100× slower per unit.

**Goal.** Internalise that threads are much heavier than goroutines.

---

### Task 4 — `time.Sleep` does not consume a thread

Spawn 10 000 goroutines, each calling `time.Sleep(30 * time.Second)`. While they sleep, read `/proc/self/status` (Linux) and inspect the `Threads:` line.

```go
package main

import (
    "fmt"
    "os"
    "strings"
    "sync"
    "time"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10_000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(30 * time.Second)
        }()
    }

    // Read after a moment to let goroutines spawn
    time.Sleep(1 * time.Second)
    data, _ := os.ReadFile("/proc/self/status")
    for _, line := range strings.Split(string(data), "\n") {
        if strings.HasPrefix(line, "Threads:") {
            fmt.Println(line)
        }
    }
    wg.Wait()
}
```

Expected: `Threads:` is a small single digit (4–10) even with 10 000 sleeping goroutines.

**Goal.** Empirically confirm that goroutines parked on the timer/netpoller do not consume threads.

---

### Task 5 — Find the thread count of an external Go process

Take any running Go program (a web server, a tool). Find its PID with `pgrep`, then:

```bash
cat /proc/$(pgrep <prog>)/status | grep Threads
```

Note the count. Compare to `runtime.NumGoroutine()` reported by the program (if it has a debug endpoint).

**Goal.** Get comfortable inspecting Go process internals from outside.

---

### Task 6 — Demonstrate `GOMAXPROCS` affecting parallelism

Spawn 4 goroutines that each loop incrementing a local counter for 1 second. Run with `GOMAXPROCS=1`, `GOMAXPROCS=2`, `GOMAXPROCS=4`. Measure total throughput (sum of counts).

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func runWith(procs int) int64 {
    runtime.GOMAXPROCS(procs)
    var wg sync.WaitGroup
    counts := make([]int64, 4)
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            end := time.Now().Add(1 * time.Second)
            for time.Now().Before(end) {
                counts[i]++
            }
        }(i)
    }
    wg.Wait()
    var total int64
    for _, c := range counts {
        total += c
    }
    return total
}

func main() {
    for _, p := range []int{1, 2, 4} {
        fmt.Printf("GOMAXPROCS=%d total=%d\n", p, runWith(p))
    }
}
```

Expected: throughput scales roughly linearly with `GOMAXPROCS` (up to the core count).

**Goal.** See parallelism in action and confirm `GOMAXPROCS` is the right knob.

---

## Medium

### Task 7 — Measure context-switch cost

Two goroutines ping-pong an integer through a channel for a fixed duration. Count exchanges. Compute per-exchange time.

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    a := make(chan int, 1)
    b := make(chan int, 1)
    done := make(chan struct{})

    go func() {
        for {
            select {
            case v := <-a:
                b <- v + 1
            case <-done:
                return
            }
        }
    }()

    go func() {
        for {
            select {
            case v := <-b:
                a <- v + 1
            case <-done:
                return
            }
        }
    }()

    a <- 0
    time.Sleep(1 * time.Second)
    close(done)

    // Drain a few
    // (For a real measurement, instrument with atomics or counters.)
    _ = a
    _ = b
    var wg sync.WaitGroup
    _ = wg
    fmt.Println("done")
}
```

(Add a proper counter via atomic to get real numbers; expected: ~200–500 ns per round-trip on a modern laptop.)

**Goal.** Estimate goroutine context-switch cost.

---

### Task 8 — Compare blocking vs non-blocking syscall behaviour

Write a program that:

1. Spawns 100 goroutines, each opens a file, reads 1 byte, closes. The reads are blocking syscalls (regular file).
2. Reports `runtime.NumGoroutine()` and the OS thread count during the work.

Run the same with 100 goroutines doing `http.Get` (network → netpoller).

**Expected**: file-read version shows thread count climbing (~10–50); network version stays at 5–10 threads.

**Goal.** See the difference between blocking-syscall and netpoller paths in real time.

---

### Task 9 — Trigger a cgo M-creation storm

```go
package main

/*
#include <unistd.h>
void slow(void) { sleep(2); }
*/
import "C"
import (
    "fmt"
    "os"
    "strings"
    "sync"
    "time"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            C.slow()
        }()
    }

    // Sample thread count during the storm
    for i := 0; i < 5; i++ {
        time.Sleep(400 * time.Millisecond)
        data, _ := os.ReadFile("/proc/self/status")
        for _, l := range strings.Split(string(data), "\n") {
            if strings.HasPrefix(l, "Threads:") {
                fmt.Println(l)
            }
        }
    }
    wg.Wait()
}
```

Expected: `Threads:` climbs from ~10 to ~100, then drops back as cgo calls return.

**Goal.** Witness a cgo M-creation storm; understand why bounding cgo concurrency matters.

---

### Task 10 — Mitigate the storm with a semaphore

Take Task 9. Add a semaphore that limits cgo calls to 8 concurrent. Verify thread count stays bounded.

```go
import "golang.org/x/sync/semaphore"
import "context"

sem := semaphore.NewWeighted(8)
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        sem.Acquire(context.Background(), 1)
        defer sem.Release(1)
        C.slow()
    }()
}
```

Expected: `Threads:` stays at ~15, even with 100 goroutines waiting.

**Goal.** Apply the standard mitigation for cgo storms.

---

### Task 11 — `LockOSThread` and `syscall.Gettid`

Write a goroutine that:

1. Calls `runtime.LockOSThread`.
2. Reads `syscall.Gettid()` and stores it.
3. Yields 100 times.
4. After each yield, asserts `syscall.Gettid()` still equals the stored value.

```go
import (
    "runtime"
    "syscall"
)

func main() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    tid := syscall.Gettid()
    for i := 0; i < 100; i++ {
        runtime.Gosched()
        if syscall.Gettid() != tid {
            panic("drifted!")
        }
    }
}
```

Then remove `LockOSThread` and run a similar test under a load with many goroutines. You may not always see a drift, but the assertion is no longer guaranteed.

**Goal.** Confirm that `LockOSThread` truly pins.

---

### Task 12 — Measure `errgroup.SetLimit` vs unbounded `errgroup`

```go
import "golang.org/x/sync/errgroup"

const N = 10000

unboundedTime := func() time.Duration {
    g, _ := errgroup.WithContext(context.Background())
    start := time.Now()
    for i := 0; i < N; i++ {
        g.Go(func() error {
            time.Sleep(1 * time.Millisecond)
            return nil
        })
    }
    g.Wait()
    return time.Since(start)
}

boundedTime := func(limit int) time.Duration {
    g, _ := errgroup.WithContext(context.Background())
    g.SetLimit(limit)
    start := time.Now()
    for i := 0; i < N; i++ {
        g.Go(func() error {
            time.Sleep(1 * time.Millisecond)
            return nil
        })
    }
    g.Wait()
    return time.Since(start)
}
```

Compare `unboundedTime` (huge concurrency, all done in ~1 ms) to `boundedTime(100)` (~100 ms = N×sleep/limit).

**Goal.** Understand the trade-off between concurrency level and resource use.

---

### Task 13 — Implement `GOMAXPROCS` warning sidecar

Write a sidecar function called from `main` that, after a brief delay, compares `runtime.GOMAXPROCS(0)` to the cgroup limit (read `/sys/fs/cgroup/cpu.max` for cgroup v2). If `GOMAXPROCS` is 2× or more than the cgroup limit, log a loud warning.

**Goal.** Defensive coding for container misconfiguration.

---

### Task 14 — Read scheduler trace

Run any Go program with:

```bash
GODEBUG=schedtrace=1000,scheddetail=1 ./your-program
```

Identify in the output:

- `gomaxprocs`
- `threads`
- `idlethreads`
- `runqueue` (global)
- per-P runqueue sizes
- per-M and per-G states (with `scheddetail=1`)

Find a moment when a syscall handoff happens (an M in syscall, a P in `_Psyscall`).

**Goal.** Read the runtime's own diagnostic output.

---

## Hard

### Task 15 — Build a thread-pinned worker for a thread-affine task

Imagine a fictional C library that requires the same thread for `init`, `do`, `done`. Wrap it in Go:

- One goroutine per "session," pinned via `LockOSThread`.
- A channel of work items.
- Initialise the C library in the goroutine; tear down before exit.

Test by spawning 4 sessions and submitting 100 work items each. Verify each goroutine stays on its thread (via `syscall.Gettid`).

**Goal.** Production-quality thread pinning pattern.

---

### Task 16 — Measure scheduler latency under load

Use `runtime/trace`:

```go
import "runtime/trace"
import "os"

func main() {
    f, _ := os.Create("trace.out")
    trace.Start(f)
    defer trace.Stop()

    // ... your workload ...
}
```

Then `go tool trace trace.out` and explore the visualisation. Find:

- An M that is parked in a syscall.
- A P that is idle while Ms are spinning.
- GC stop-the-world.
- Goroutine creator-stack relationships.

**Goal.** Be fluent in the runtime trace UI.

---

### Task 17 — Build a NUMA-aware deployment plan

For a Go service that runs on a 64-core, 4-socket box:

- Plan how many replicas, each with which `GOMAXPROCS`.
- Use `numactl` to pin each replica to one NUMA node.
- Verify with `lscpu` and `numactl --hardware`.

Compare throughput / latency to a single-process `GOMAXPROCS=64`. Report your findings.

**Goal.** Hands-on NUMA tuning.

---

### Task 18 — Implement a goroutine ID extractor (for fun, not for production)

Parse the output of `runtime.Stack` to extract the current goroutine's ID. Write a test that confirms the ID is unique per goroutine. Note: this is hacky and slow. Do not use it in production code.

```go
import (
    "bytes"
    "runtime"
    "strconv"
)

func goid() uint64 {
    var buf [64]byte
    n := runtime.Stack(buf[:], false)
    line := buf[:n]
    // "goroutine N [..."
    i := bytes.IndexByte(line, ' ')
    j := bytes.IndexByte(line[i+1:], ' ')
    id, _ := strconv.ParseUint(string(line[i+1:i+1+j]), 10, 64)
    return id
}
```

**Goal.** Understand why Go intentionally does not expose goroutine ID.

---

### Task 19 — Compare goroutine vs thread for a per-request server

Implement two web servers:

- **A**: pure Go, one goroutine per request, no cgo.
- **B**: Go + cgo for some hot-path operation (e.g., calls a C function that takes 1 ms).

Load-test both with `wrk` or `vegeta` at 1 000 RPS.

Measure:

- Throughput.
- p99 latency.
- Thread count (`/proc/<pid>/status:Threads`).
- Goroutine count.

Compare results. Explain the gap.

**Goal.** End-to-end measurement of the goroutine-vs-thread cost in a realistic workload.

---

### Task 20 — Implement a "thread-watcher" service

Build a small Go service that, in the background, polls `/proc/self/status:Threads` every second and exposes it as a Prometheus metric. Add an alert rule: thread count > 50 for 30 s.

```go
import (
    "os"
    "strconv"
    "strings"
    "time"
    "github.com/prometheus/client_golang/prometheus"
)

var threadGauge = prometheus.NewGauge(prometheus.GaugeOpts{
    Name: "process_threads_total",
})

func watchThreads() {
    for range time.Tick(1 * time.Second) {
        data, _ := os.ReadFile("/proc/self/status")
        for _, line := range strings.Split(string(data), "\n") {
            if strings.HasPrefix(line, "Threads:") {
                n, _ := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, "Threads:")))
                threadGauge.Set(float64(n))
            }
        }
    }
}
```

**Goal.** Production-ready thread observability.

---

## Solution Sketches

### Task 1

Pure runtime calls; no surprises. Test value of `GOMAXPROCS` env var.

### Task 2 / Task 3

Compare absolute numbers. The C version is 30–100× slower per spawn.

### Task 4

Confirms parking. `Threads:` stays small.

### Task 6

Linear scaling visible.

### Task 9 / Task 10

Storm → mitigation. Thread count drops from ~100 to ~15.

### Task 15 sketch

```go
type Session struct {
    in   chan Work
    quit chan struct{}
}

func NewSession() *Session {
    s := &Session{in: make(chan Work, 16), quit: make(chan struct{})}
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        C.session_init()
        defer C.session_done()
        for {
            select {
            case w := <-s.in:
                C.session_do(w.cdata)
            case <-s.quit:
                return
            }
        }
    }()
    return s
}
```

### Task 20

Use `prometheus/client_golang`. Expose `/metrics`. Alert in Prometheus YAML:

```yaml
- alert: HighThreadCount
  expr: process_threads_total > 50
  for: 30s
```

---

## Wrap-up

After working through these tasks you should be able to:

- Quantify the cost of goroutines and threads on your hardware.
- Detect a cgo storm in seconds via thread count.
- Confirm `LockOSThread` pinning works as advertised.
- Use `runtime/trace` to inspect scheduler behaviour.
- Build observability that distinguishes goroutine-level from thread-level issues.

Next: [find-bug.md](find-bug.md) for bug-finding exercises around thread affinity, signal handling, and OS-resource leaks.
