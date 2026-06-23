# `LockOSThread` Performance — Hands-On Tasks

> A progression of tasks for building intuition about pinning's cost and benefit. Each task is self-contained; do them in order or pick the level that matches your current understanding. Solutions in the next page (`find-bug.md` / `optimize.md`) draw on the same machinery.

## Table of Contents

1. [Setup](#setup)
2. [Task 1: Count Threads Under Pinning](#task-1-count-threads-under-pinning)
3. [Task 2: Pinned vs Unpinned Microbenchmark](#task-2-pinned-vs-unpinned-microbenchmark)
4. [Task 3: Build a Single-Owner Worker](#task-3-build-a-single-owner-worker)
5. [Task 4: Cgo Amortisation Benchmark](#task-4-cgo-amortisation-benchmark)
6. [Task 5: Pinned Pool with Round-Robin Dispatch](#task-5-pinned-pool-with-round-robin-dispatch)
7. [Task 6: Backpressure with Context](#task-6-backpressure-with-context)
8. [Task 7: Lifecycle — Start, Drain, Stop](#task-7-lifecycle--start-drain-stop)
9. [Task 8: Panic Recovery in a Pinned Worker](#task-8-panic-recovery-in-a-pinned-worker)
10. [Task 9: Measure Scheduler Latency Under Pinning](#task-9-measure-scheduler-latency-under-pinning)
11. [Task 10: pprof Labels for Pinned Workers](#task-10-pprof-labels-for-pinned-workers)
12. [Task 11: NUMA-Aware Pinning](#task-11-numa-aware-pinning)
13. [Task 12: Detect Accidental Pinning](#task-12-detect-accidental-pinning)
14. [Stretch: Build a Pinning Audit Lint Rule](#stretch-build-a-pinning-audit-lint-rule)

---

## Setup

Linux is the reference platform for these tasks. macOS works for most; Windows for the basics.

You will need:

- Go 1.21 or later (for `runtime/metrics /sched/threads:threads`).
- A C compiler for cgo tasks.
- Linux: `numactl`, `perf` (optional).

A scaffold for each task:

```go
package main

import (
    "fmt"
    "os"
    "runtime"
    "runtime/metrics"
    "strings"
    "time"
)

func threadCountLinux() int {
    data, err := os.ReadFile("/proc/self/status")
    if err != nil {
        return -1
    }
    for _, line := range strings.Split(string(data), "\n") {
        if strings.HasPrefix(line, "Threads:") {
            var n int
            fmt.Sscanf(line, "Threads: %d", &n)
            return n
        }
    }
    return -1
}

func runtimeThreads() uint64 {
    s := []metrics.Sample{{Name: "/sched/threads:threads"}}
    metrics.Read(s)
    return s[0].Value.Uint64()
}
```

---

## Task 1: Count Threads Under Pinning

**Goal.** Verify experimentally that each pinned goroutine adds exactly one M.

**Steps.**

1. Print the baseline thread count at startup.
2. Start 4 goroutines, each calling `LockOSThread` and blocking on a channel.
3. Print the thread count again.
4. Close the channel so the goroutines exit.
5. Print the thread count once more.

**Expected.**

- Baseline: ~6 threads (varies by Go version and platform).
- After 4 pins: baseline + 4.
- After release: stays at baseline + 4 (Ms are pooled, not destroyed immediately).

**Bonus.** Repeat with 16 pinned goroutines. Note the M count plateau.

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    fmt.Println("baseline:", threadCountLinux())
    done := make(chan struct{})
    for i := 0; i < 4; i++ {
        go func() {
            runtime.LockOSThread()
            defer runtime.UnlockOSThread()
            <-done
        }()
    }
    time.Sleep(200 * time.Millisecond)
    fmt.Println("after pin:", threadCountLinux())
    close(done)
    time.Sleep(200 * time.Millisecond)
    fmt.Println("after release:", threadCountLinux())
}
```

---

## Task 2: Pinned vs Unpinned Microbenchmark

**Goal.** Quantify the floor cost of pinning when there's no benefit (pure Go).

**Steps.**

1. Write a function that does a small unit of work (e.g., 1000-element loop sum).
2. Benchmark it called from a normal goroutine.
3. Benchmark it called from a goroutine that pins itself first.
4. Compare ns/op.

```go
package bench_test

import (
    "runtime"
    "sync"
    "testing"
)

func work() int {
    n := 0
    for i := 0; i < 1000; i++ {
        n += i
    }
    return n
}

func BenchmarkUnpinned(b *testing.B) {
    var wg sync.WaitGroup
    for i := 0; i < b.N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            _ = work()
        }()
    }
    wg.Wait()
}

func BenchmarkPinned(b *testing.B) {
    var wg sync.WaitGroup
    for i := 0; i < b.N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            runtime.LockOSThread()
            defer runtime.UnlockOSThread()
            _ = work()
        }()
    }
    wg.Wait()
}
```

**Expected.** Pinned is slower per op by a few hundred ns. The overhead is from M-pool churn (each pinned exit destroys an M) plus lost scheduler flexibility.

**Bonus.** Modify to use a long-lived pinned worker that processes many work items. Compare to per-iteration pinning.

---

## Task 3: Build a Single-Owner Worker

**Goal.** Implement the canonical single-owner pattern from scratch.

**Requirements.**

- Worker has a `Submit(job)` method that returns a result.
- Worker is pinned at start; pin lasts the worker's lifetime.
- Initialisation runs on the pinned thread (simulate with a `fmt.Println("initialised on TID...")`).
- `Close()` drains the worker and exits cleanly.

**Skeleton.**

```go
type Job struct {
    Input int
    Reply chan int
}

type Worker struct {
    in chan Job
    done chan struct{}
}

func New() *Worker { /* TODO */ }
func (w *Worker) Submit(in int) int { /* TODO */ }
func (w *Worker) Close() { /* TODO */ }
```

**Test.**

- Spawn 100 goroutines that each call `Submit` ten times.
- Verify all submissions complete.
- Verify only one M was retired (use `runtime/metrics`).

---

## Task 4: Cgo Amortisation Benchmark

**Goal.** Measure cgo's per-call cost with and without pinning.

**Steps.**

1. Create a trivial C function: `int add(int a, int b) { return a + b; }`.
2. Benchmark calling it 10^6 times from an unpinned goroutine.
3. Benchmark calling it 10^6 times from a pinned goroutine.
4. Compare ns/op.

```go
package cgo_test

/*
static int add(int a, int b) { return a + b; }
*/
import "C"

import (
    "runtime"
    "testing"
)

func BenchmarkCgoUnpinned(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = C.add(C.int(i), C.int(1))
    }
}

func BenchmarkCgoPinned(b *testing.B) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    for i := 0; i < b.N; i++ {
        _ = C.add(C.int(i), C.int(1))
    }
}
```

**Expected.** Pinned is faster by some percentage (5–50% depending on Go version and platform). The benefit is largest when `GOMAXPROCS > 1` because unpinned cgo may move Ms.

**Bonus.** Add a real C function that uses `errno` or a thread-local variable. See if the benefit grows.

---

## Task 5: Pinned Pool with Round-Robin Dispatch

**Goal.** Scale a single-owner worker to N replicable resources.

**Requirements.**

- Construct a pool of N pinned workers (N = 4 for the test).
- A `Submit(job)` method on the pool dispatches to one of the N workers via round-robin.
- Total M count under load should be exactly `baseline + N`.

**Skeleton.**

```go
type Pool struct {
    workers []*Worker
    next    atomic.Uint64
}

func NewPool(n int) *Pool { /* TODO */ }
func (p *Pool) Submit(in int) int { /* TODO */ }
func (p *Pool) Close() { /* TODO */ }
```

**Test.**

- Launch 50 concurrent goroutines, each submitting 100 jobs.
- Verify thread count stays at `baseline + 4`.
- Print per-worker job counts to confirm round-robin balance.

---

## Task 6: Backpressure with Context

**Goal.** Add context-aware submission so client cancellations propagate.

**Requirements.**

- `Submit(ctx, job)` returns `result, err`.
- If `ctx` is canceled before the job is queued, return `ctx.Err()`.
- If `ctx` is canceled before the reply arrives, return `ctx.Err()` (the worker continues processing but the caller bails).
- If the queue is full, the call blocks until space is available *or* ctx cancels.

```go
func (w *Worker) Submit(ctx context.Context, in int) (int, error) {
    reply := make(chan int, 1)
    select {
    case w.in <- Job{Input: in, Reply: reply}:
    case <-ctx.Done():
        return 0, ctx.Err()
    }
    select {
    case r := <-reply:
        return r, nil
    case <-ctx.Done():
        return 0, ctx.Err()
    }
}
```

**Test.**

- Saturate the worker with slow jobs.
- Submit with a 50 ms timeout.
- Verify the call returns `context.DeadlineExceeded` quickly.
- Verify the worker's queue eventually drains.

---

## Task 7: Lifecycle — Start, Drain, Stop

**Goal.** Add proper lifecycle management.

**Requirements.**

- `New()` returns `*Worker, error`. The error is set if initialisation fails.
- `Close(ctx)` closes the input channel and waits for the worker to drain. If `ctx` expires, return `ctx.Err()`.
- The worker handles a context-cancel mid-processing by returning ASAP.

**Skeleton.**

```go
func New(ctx context.Context) (*Worker, error) {
    w := &Worker{in: make(chan Job, 16), done: make(chan struct{})}
    errCh := make(chan error, 1)
    go w.loop(ctx, errCh)
    if err := <-errCh; err != nil {
        return nil, err
    }
    return w, nil
}

func (w *Worker) loop(ctx context.Context, errCh chan<- error) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    defer close(w.done)

    if err := initResource(); err != nil {
        errCh <- err
        return
    }
    defer cleanupResource()
    errCh <- nil

    for {
        select {
        case <-ctx.Done():
            return
        case j, ok := <-w.in:
            if !ok {
                return
            }
            j.Reply <- process(j.Input)
        }
    }
}

func (w *Worker) Close(ctx context.Context) error {
    close(w.in)
    select {
    case <-w.done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

**Test.**

- Simulate `initResource` failure; verify `New` returns the error and no goroutine leaks.
- Verify graceful shutdown.
- Verify shutdown timeout works.

---

## Task 8: Panic Recovery in a Pinned Worker

**Goal.** Make the worker resilient to panics in the per-job code.

**Requirements.**

- A panic during job processing must not kill the worker.
- The job's reply channel receives an error.
- A counter tracks panic events; if > 10 per minute, the worker self-terminates (calls "circuit-breaker").

**Skeleton.**

```go
for j := range w.in {
    func() {
        defer func() {
            if r := recover(); r != nil {
                j.Reply <- Result{Err: fmt.Errorf("panic: %v", r)}
                w.panicCount.Add(1)
            }
        }()
        result := process(j.Input)
        j.Reply <- Result{Output: result}
    }()
    if w.tooManyPanics() {
        return // exit, M dies (locked exit), supervisor will restart
    }
}
```

**Test.**

- Inject deterministic panics in some jobs (`if input == 42 { panic("...") }`).
- Verify the worker continues processing other jobs.
- Verify the circuit-breaker fires after enough panics.

---

## Task 9: Measure Scheduler Latency Under Pinning

**Goal.** Observe scheduler latency rising as pinning grows.

**Steps.**

1. Workload: 1000 concurrent goroutines, each doing 1 ms of CPU work in a loop.
2. Without any pinning, sample `/sched/latencies:seconds` p99.
3. Pin 2 goroutines (idle pins, blocked on a channel). Sample again.
4. Pin 4 idle goroutines. Sample again.
5. Pin 8 idle goroutines on a `GOMAXPROCS=4` machine. Sample again.

**Expected.** p99 rises noticeably between steps 3 and 4, and dramatically in step 5 because the runtime has to manage many Ms with fewer P slots.

```go
import "runtime/metrics"

func p99(name string) float64 {
    s := []metrics.Sample{{Name: name}}
    metrics.Read(s)
    h := s[0].Value.Float64Histogram()
    // walk buckets to find p99...
    total := uint64(0)
    for _, c := range h.Counts {
        total += c
    }
    target := uint64(float64(total) * 0.99)
    cum := uint64(0)
    for i, c := range h.Counts {
        cum += c
        if cum >= target {
            return h.Buckets[i]
        }
    }
    return 0
}
```

**Bonus.** Plot the p50, p99, p99.9 over time on a Prometheus dashboard.

---

## Task 10: pprof Labels for Pinned Workers

**Goal.** Tag pinned workers so they're identifiable in profiles.

**Steps.**

1. In each pinned worker's loop, call `pprof.SetGoroutineLabels(pprof.WithLabels(ctx, pprof.Labels("role", "worker", "id", strconv.Itoa(workerID))))`.
2. Run the workload.
3. Capture `go tool pprof http://localhost:6060/debug/pprof/goroutine`.
4. In pprof: `tags`, then `tag_focus role:worker`, then `top`.

**Expected.** Only pinned-worker goroutines appear in the focused profile. You can filter further by `id`.

```go
import (
    "runtime/pprof"
    "strconv"
)

func (w *Worker) loop(id int) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()

    labels := pprof.Labels("role", "pinned-worker", "id", strconv.Itoa(id))
    pprof.Do(context.Background(), labels, func(ctx context.Context) {
        for j := range w.in {
            j.Reply <- process(j.Input)
        }
    })
}
```

**Bonus.** Add per-job labels (e.g., `tenant`, `request_id`) inside `process`.

---

## Task 11: NUMA-Aware Pinning

**Goal.** Layer kernel CPU affinity on top of `LockOSThread` for NUMA-aware deployment.

**Steps (Linux).**

1. Determine which CPUs belong to NUMA node 0 (`numactl -H` or `/sys/devices/system/node/node0/cpulist`).
2. In a pinned worker, after `runtime.LockOSThread`, call `unix.SchedSetaffinity` with those CPUs.
3. Also start the process with `numactl --membind=0` so heap allocations stay on the same node.
4. Run a memory-bound workload. Compare throughput to the unpinned version.

```go
import "golang.org/x/sys/unix"

func (w *Worker) loop() {
    runtime.LockOSThread()
    // do NOT defer UnlockOSThread: see Linux Namespace Switcher pattern.

    var set unix.CPUSet
    for _, cpu := range w.cpus {
        set.Set(cpu)
    }
    if err := unix.SchedSetaffinity(0, &set); err != nil {
        log.Fatalf("setaffinity: %v", err)
    }

    for j := range w.in {
        j.Reply <- process(j.Input)
    }
}
```

**Expected.** On a multi-socket machine, NUMA-pinned throughput is 5–30% higher for memory-bound workloads. On a single-socket (or cloud VM), the effect is small.

---

## Task 12: Detect Accidental Pinning

**Goal.** Build a runtime detector that warns when pinning seems to be happening per request.

**Steps.**

1. Sample `runtime/metrics /sched/threads:threads` every second.
2. Track the moving average and standard deviation.
3. If the thread count rises by > 2σ over baseline for > 30 s, log a warning.
4. Optionally, snapshot `pprof goroutine?debug=2` at the time of detection.

```go
func detector() {
    var baseline float64
    var samples []float64
    for range time.Tick(1 * time.Second) {
        n := float64(runtimeThreads())
        samples = append(samples, n)
        if len(samples) > 60 {
            samples = samples[1:]
        }
        if len(samples) == 60 {
            baseline = mean(samples)
        }
        if n > baseline*1.5 {
            log.Printf("WARNING: thread count %v exceeds baseline %v", n, baseline)
            snapshotGoroutines()
        }
    }
}
```

**Bonus.** Wire the detector's output to a Prometheus gauge and an alert.

---

## Stretch: Build a Pinning Audit Lint Rule

**Goal.** Write a `go vet`-style analyser that flags `runtime.LockOSThread` calls in HTTP handler functions.

**Requirements.**

- Identify functions matching the HTTP handler signature: `func(http.ResponseWriter, *http.Request)`.
- Identify functions called by handlers, transitively (within the same package).
- Flag `runtime.LockOSThread` calls in those functions.
- Allow an `// lockosthread:allow` comment to suppress.

**Skeleton.**

```go
package handlerlint

import (
    "go/ast"
    "golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{
    Name: "handlerpin",
    Doc:  "flags LockOSThread in HTTP handlers",
    Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    for _, file := range pass.Files {
        ast.Inspect(file, func(n ast.Node) bool {
            fn, ok := n.(*ast.FuncDecl)
            if !ok || !isHandler(fn) {
                return true
            }
            ast.Inspect(fn.Body, func(n ast.Node) bool {
                if isLockOSThread(n) {
                    pass.Reportf(n.Pos(), "LockOSThread in HTTP handler is forbidden; refactor to single-owner pool")
                }
                return true
            })
            return true
        })
    }
    return nil, nil
}
```

**Use.** Wire as a `go vet` pass in CI; reject PRs that introduce per-request pinning.

This is the lint rule that catches the most production regressions. Worth investing the hour.

---

## Wrap-up

The tasks build the muscle memory the topic requires:

- Count threads, observe pinning's M cost directly.
- Benchmark pinned vs unpinned to internalise the cost model.
- Build the single-owner pattern, then scale it to a pool.
- Add lifecycle, backpressure, panic recovery — the engineering hygiene that separates demo code from production.
- Layer observability (pprof labels, metrics, NUMA awareness).
- Detect anti-patterns automatically (lint rule, runtime detector).

These artifacts together cover almost every real production use of `LockOSThread`. The find-bug page exercises diagnostic skills on broken versions of these; the optimize page sharpens the tuning judgement.
