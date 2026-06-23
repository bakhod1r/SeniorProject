# Work Stealing — Tasks

## Table of Contents
1. [Task 1: Observe stealing with `trace`](#task-1-observe-stealing-with-trace)
2. [Task 2: Build a miniature work-stealing queue](#task-2-build-a-miniature-work-stealing-queue)
3. [Task 3: Build a full work-stealing scheduler](#task-3-build-a-full-work-stealing-scheduler)
4. [Task 4: Measure steal cost](#task-4-measure-steal-cost)
5. [Task 5: Reproduce LRQ overflow](#task-5-reproduce-lrq-overflow)
6. [Task 6: Reproduce `runnext` behaviour](#task-6-reproduce-runnext-behaviour)
7. [Task 7: Implement Cilk-style LIFO/FIFO deque](#task-7-implement-cilk-style-lifofifo-deque)
8. [Task 8: Compare half-steal vs other fractions](#task-8-compare-half-steal-vs-other-fractions)
9. [Task 9: Visualise the steal distribution](#task-9-visualise-the-steal-distribution)
10. [Task 10: Build a benchmark harness](#task-10-build-a-benchmark-harness)

---

## Task 1: Observe stealing with `trace`

### Goal

Run a program that creates many goroutines on one P; use `go tool trace` to visualise how they spread.

### Code

```go
package main

import (
    "os"
    "runtime"
    "runtime/trace"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(4)
    f, _ := os.Create("steal-trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    var wg sync.WaitGroup
    // Spawn 100 long-ish Gs from the main goroutine.
    // They all start on the same P.
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            x := 0
            for j := 0; j < 1_000_000; j++ {
                x += j
            }
            _ = x
        }(i)
    }
    wg.Wait()
}
```

### Steps

1. Run: `go run main.go`
2. Open the trace: `go tool trace steal-trace.out`
3. In the browser, click "View trace".
4. In the Procs view, observe how the 100 Gs spread across P0–P3 within microseconds.
5. Note the GoCreate events on one P followed by GoStart events on different Ps — that's stealing.

### Acceptance

- All 4 Ps reach ~25% CPU utilisation by the end.
- Visible "stealing" handoffs in the trace.

---

## Task 2: Build a miniature work-stealing queue

### Goal

Implement a single-producer-multi-consumer queue analogous to the LRQ. The owner pushes; thieves use CAS to take half.

### Skeleton

```go
package wsq

import (
    "sync/atomic"
)

const Capacity = 256

type Queue struct {
    head atomic.Uint32
    tail atomic.Uint32
    buf  [Capacity]any
}

// Push by the owner. Returns false if full.
func (q *Queue) Push(x any) bool {
    t := q.tail.Load()
    h := q.head.Load()
    if t-h >= Capacity {
        return false
    }
    q.buf[t%Capacity] = x
    q.tail.Store(t + 1)
    return true
}

// Pop by the owner. Returns nil, false if empty.
func (q *Queue) Pop() (any, bool) {
    t := q.tail.Load()
    h := q.head.Load()
    if t == h {
        return nil, false
    }
    x := q.buf[(t-1)%Capacity]
    q.tail.Store(t - 1)
    return x, true
}

// Steal by a thief. Returns the number of items moved.
// Up to half of available.
func (q *Queue) Steal(out *Queue) int {
    for {
        h := q.head.Load()
        t := q.tail.Load()
        n := t - h
        n = n - n/2 // ceil(n/2)
        if n == 0 {
            return 0
        }
        if n > Capacity/2 {
            continue
        }
        // Stage into out (the thief's queue).
        outTail := out.tail.Load()
        for i := uint32(0); i < n; i++ {
            out.buf[(outTail+i)%Capacity] = q.buf[(h+i)%Capacity]
        }
        if q.head.CompareAndSwap(h, h+n) {
            out.tail.Store(outTail + n)
            return int(n)
        }
        // Retry on CAS fail.
    }
}
```

### Tests

Write tests that:

1. Push and pop in single-threaded order — should be FIFO.
2. Push 100, steal from a thief goroutine, verify thief gets 50.
3. Two thieves steal simultaneously; both get a share.

### Acceptance

- Tests pass.
- No data race (`go test -race`).
- The queue does not lose any items.

---

## Task 3: Build a full work-stealing scheduler

### Goal

Build a runtime that manages N workers, each with an LRQ. Tasks are functions. Implement: spawn task, run loop, steal logic.

### Skeleton

```go
package sched

import (
    "math/rand"
    "runtime"
    "sync"
    "sync/atomic"
)

type Task func()

type Worker struct {
    id    int
    queue *Queue // from Task 2
    wg    *sync.WaitGroup
}

type Pool struct {
    workers []*Worker
    done    atomic.Bool
}

func NewPool(n int, wg *sync.WaitGroup) *Pool {
    p := &Pool{workers: make([]*Worker, n)}
    for i := 0; i < n; i++ {
        p.workers[i] = &Worker{id: i, queue: &Queue{}, wg: wg}
    }
    return p
}

func (p *Pool) Start() {
    for _, w := range p.workers {
        go w.run(p)
    }
}

func (w *Worker) run(p *Pool) {
    rng := rand.New(rand.NewSource(int64(w.id)))
    for !p.done.Load() {
        if t, ok := w.queue.Pop(); ok {
            t.(Task)()
            w.wg.Done()
            continue
        }
        // Try to steal
        stolen := false
        for i := 0; i < 4 && !stolen; i++ {
            for offset := 0; offset < len(p.workers); offset++ {
                vid := (rng.Intn(len(p.workers)) + offset) % len(p.workers)
                if vid == w.id { continue }
                victim := p.workers[vid]
                if n := victim.queue.Steal(w.queue); n > 0 {
                    stolen = true
                    break
                }
            }
        }
        if !stolen {
            runtime.Gosched()
        }
    }
}

func (p *Pool) Submit(t Task) {
    // Round-robin or random submission for simplicity.
    p.workers[0].queue.Push(t)
}
```

### Drive

```go
func main() {
    var wg sync.WaitGroup
    pool := sched.NewPool(8, &wg)
    pool.Start()

    for i := 0; i < 10000; i++ {
        wg.Add(1)
        pool.Submit(func() {
            // do some work
        })
    }
    wg.Wait()
}
```

### Acceptance

- All 10000 tasks complete.
- Distribution across workers is roughly uniform (within 20%).
- `go test -race` passes.

---

## Task 4: Measure steal cost

### Goal

Benchmark how long one steal takes.

### Setup

```go
func BenchmarkSteal(b *testing.B) {
    var victim, thief Queue
    // Fill victim
    for i := 0; i < 200; i++ {
        victim.Push(i)
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        n := victim.Steal(&thief)
        // Refill victim for next iter
        for j := 0; j < n; j++ {
            // pop from thief to keep it bounded
            thief.Pop()
            victim.Push(j)
        }
    }
}
```

### Steps

1. Run: `go test -bench=Steal -benchmem`
2. Record ns/op.
3. Vary victim queue size (50, 100, 200). Observe how steal cost scales.

### Expected

- Steal cost: ~30-50 ns regardless of size.
- Per-item cost: minimal because the copy is fast.

---

## Task 5: Reproduce LRQ overflow

### Goal

Force the runtime's LRQ to overflow to GRQ. Observe via trace.

### Code

```go
package main

import (
    "os"
    "runtime"
    "runtime/trace"
    "sync"
    "time"
)

func main() {
    runtime.GOMAXPROCS(2)
    f, _ := os.Create("overflow-trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    var wg sync.WaitGroup
    // Block all other Ps with a busy goroutine.
    go func() {
        for {
            // Busy loop. With GOMAXPROCS=2, this hogs one P.
        }
    }()
    time.Sleep(10 * time.Millisecond)

    // Now spawn 1000 Gs from the main P; they go to its LRQ.
    // LRQ caps at 256; the rest overflow to GRQ.
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(time.Microsecond)
        }()
    }
    wg.Wait()
}
```

### Observe

- `GODEBUG=schedtrace=100 go run main.go`
- Output shows `runqueue=N` growing as overflow happens.
- Goroutines eventually drain via the spinning busy goroutine's preemption + 1-in-61 rule.

### Acceptance

- Visible GRQ growth in `schedtrace` output.
- Visible "GoStart" events on the second P drawing from GRQ.

---

## Task 6: Reproduce `runnext` behaviour

### Goal

Show that a newly-created G runs before the LRQ tail.

### Code

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(1)
    var order []int
    var mu sync.Mutex
    var wg sync.WaitGroup

    // Push three Gs onto LRQ tail
    for i := 1; i <= 3; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            order = append(order, i)
            mu.Unlock()
        }()
    }

    // Now spawn a G that should go to runnext
    wg.Add(1)
    go func() {
        defer wg.Done()
        mu.Lock()
        order = append(order, 99)
        mu.Unlock()
    }()

    wg.Wait()
    fmt.Println(order)
    // Output should usually show 99 early because it went to runnext.
}
```

### Observe

- The 99 frequently appears before 3 (the last G pushed to LRQ).
- Not always — depends on the M's path. But statistically biased.

### Discuss

- Why runnext exists (cache locality).
- Why thieves don't steal it on the first attempt.

---

## Task 7: Implement Cilk-style LIFO/FIFO deque

### Goal

Modify Task 2's queue to use Cilk's protocol: owner pops from the bottom (LIFO), thieves take from the top (FIFO).

### Skeleton

```go
// Owner Pop: pop from tail (LIFO).
func (q *Queue) PopLIFO() (any, bool) {
    t := q.tail.Load()
    h := q.head.Load()
    if t == h {
        return nil, false
    }
    t--
    q.tail.Store(t)
    x := q.buf[t%Capacity]
    // Subtle: re-check after the tail decrement; thief may have stolen the slot.
    if h := q.head.Load(); t < h {
        // Race: thief stole our last item.
        // Restore and signal empty (or retry).
        q.tail.Store(t + 1)
        return nil, false
    }
    return x, true
}
```

### Compare

- LIFO order vs FIFO order in test output.
- Cache behaviour: LIFO tends to reuse hot data; FIFO tends to use cooler.

### Acceptance

- Both implementations work and pass tests.
- A benchmark shows ~10% better throughput for LIFO on cache-sensitive workloads.

---

## Task 8: Compare half-steal vs other fractions

### Goal

Empirically verify that half-steal is near-optimal.

### Setup

```go
func runWith(fraction float64) time.Duration {
    // Use Task 3's pool but vary the steal fraction.
    // Run a fixed workload; measure total time.
}

func main() {
    for _, f := range []float64{0.25, 0.5, 0.75, 1.0} {
        d := runWith(f)
        fmt.Printf("fraction=%.2f time=%v\n", f, d)
    }
}
```

### Expected

- fraction=0.25: slower (too few stolen, frequent re-steals)
- fraction=0.5: fastest
- fraction=0.75: slightly slower (victim runs dry too soon)
- fraction=1.0: much slower (victim becomes thief immediately)

### Acceptance

- Numbers consistent with Cilk's theory.
- Difference is measurable (5-20%) in a heavy workload.

---

## Task 9: Visualise the steal distribution

### Goal

Track which P runs each G. Plot the distribution as a histogram.

### Hack

Use `runtime.LockOSThread` + reading `/proc/self/task` to identify the OS thread, then map to a P via `runtime.NumCPU()`. (Fragile, but instructive.)

Easier: use `goroutine.id` (not officially exposed; via `runtime.Stack` parsing).

### Visualisation

Output a CSV; load into a notebook; bar chart of Gs-per-P.

### Acceptance

- For a balanced workload (Task 1), distribution is roughly uniform.
- For an unbalanced workload (one G spawning 1000 children), distribution shows P0 dominant but others well-represented after stealing.

---

## Task 10: Build a benchmark harness

### Goal

A reusable harness that compares scheduler behaviour across different parameters.

### Features

- Vary `GOMAXPROCS`.
- Vary task size (CPU time per task).
- Vary task count.
- Measure: throughput (tasks/sec), latency p50/p99/p99.9.

### Skeleton

```go
type Config struct {
    GOMAXPROCS int
    TaskCount  int
    TaskNs     int
}

func Run(cfg Config) Result {
    runtime.GOMAXPROCS(cfg.GOMAXPROCS)
    var wg sync.WaitGroup
    latencies := make([]time.Duration, cfg.TaskCount)
    start := time.Now()
    for i := 0; i < cfg.TaskCount; i++ {
        i := i
        wg.Add(1)
        spawnedAt := time.Now()
        go func() {
            defer wg.Done()
            ranAt := time.Now()
            latencies[i] = ranAt.Sub(spawnedAt)
            // Burn TaskNs nanoseconds
            for j := 0; j < cfg.TaskNs/2; j++ {
                _ = j * j
            }
        }()
    }
    wg.Wait()
    total := time.Since(start)
    return Result{
        Throughput: float64(cfg.TaskCount) / total.Seconds(),
        Latencies:  latencies,
    }
}
```

### Use

```go
for _, mp := range []int{1, 2, 4, 8} {
    r := Run(Config{GOMAXPROCS: mp, TaskCount: 100000, TaskNs: 1000})
    fmt.Printf("GOMAXPROCS=%d throughput=%.0f p99=%v\n",
        mp, r.Throughput, percentile(r.Latencies, 99))
}
```

### Acceptance

- Throughput scales near-linearly with GOMAXPROCS (up to physical cores).
- p99 latency stays bounded (a few μs typical) until heavy overload.

---

## Reflection Questions

After completing the tasks:

1. How much code does the scheduler save you from writing? (A lot.)
2. What are the failure modes that user-space stealing can hit that the runtime avoids?
3. Could you replicate the runtime's `nmspinning` invariant in user code? With what cost?
4. Why is half-steal observably better than other fractions?
5. What workload would be worst for a work-stealing scheduler?

End of tasks. For real bugs to hunt, see `find-bug.md`.
