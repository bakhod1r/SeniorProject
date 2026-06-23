# Starvation — Tasks

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Task 1: Reproduce Mutex Starvation](#task-1-reproduce-mutex-starvation)
3. [Task 2: Measure RWMutex Writer Starvation](#task-2-measure-rwmutex-writer-starvation)
4. [Task 3: Build a Priority Two-Stage Select](#task-3-build-a-priority-two-stage-select)
5. [Task 4: Implement an Aging Priority Queue](#task-4-implement-an-aging-priority-queue)
6. [Task 5: Implement Multi-Level Feedback Queues](#task-5-implement-multi-level-feedback-queues)
7. [Task 6: Build a Cancellable FIFO Mutex](#task-6-build-a-cancellable-fifo-mutex)
8. [Task 7: Deficit Round Robin Rate Limiter](#task-7-deficit-round-robin-rate-limiter)
9. [Task 8: Async Preemption Demonstration](#task-8-async-preemption-demonstration)
10. [Task 9: Instrumented RWMutex with Metrics](#task-9-instrumented-rwmutex-with-metrics)
11. [Task 10: Tail Latency Soak Test Harness](#task-10-tail-latency-soak-test-harness)

---

## How to Use This File

Each task has a prompt, acceptance criteria, hints, and a reference solution. Try the task before reading the solution. Run all code with `go run .` and target Go 1.18 or newer.

The tasks are independent. Pick whichever appeals; difficulty roughly increases through the list.

---

## Task 1: Reproduce Mutex Starvation

### Prompt

Write a program that creates contention on a `sync.Mutex` between many "greedy" goroutines and one "victim". Show that on Go 1.9+ the victim still gets a share of acquisitions thanks to starvation mode.

### Acceptance criteria

- Print acquisition counts per goroutine.
- The ratio between max and min counts should be at most 5x (a much tighter bound than the 100x+ you would see without starvation mode).
- Document what would change on Go pre-1.9 (analytical answer, not by switching versions).

### Hints

- Use `time.Now().Before(deadline)` to run for a fixed duration.
- Use `atomic.AddInt64` if you increment from multiple goroutines.
- Tune the critical section length to ensure contention: about 1-10 µs of computation.

### Reference solution

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
    runtime.GOMAXPROCS(4)
    var mu sync.Mutex
    const numGreedy = 10
    var greedyHits [numGreedy]int64
    var victimHits int64
    var wg sync.WaitGroup
    deadline := time.Now().Add(500 * time.Millisecond)

    for i := 0; i < numGreedy; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            for time.Now().Before(deadline) {
                mu.Lock()
                spin()
                mu.Unlock()
                atomic.AddInt64(&greedyHits[i], 1)
            }
        }()
    }

    wg.Add(1)
    go func() {
        defer wg.Done()
        for time.Now().Before(deadline) {
            mu.Lock()
            spin()
            mu.Unlock()
            atomic.AddInt64(&victimHits, 1)
        }
    }()

    wg.Wait()
    for i, h := range greedyHits {
        fmt.Printf("greedy %d: %d\n", i, h)
    }
    fmt.Printf("victim   : %d\n", victimHits)
}

func spin() {
    for i := 0; i < 1000; i++ {
        _ = i * i
    }
}
```

Note: pre-1.9 the victim would be passed over far more often because the fast-path CAS would let fresh arrivers steal the lock from waking waiters. Starvation mode introduced in 1.9 corrects this within ~1 ms of a waiter being parked.

---

## Task 2: Measure RWMutex Writer Starvation

### Prompt

Build a `Cache` struct fronted by `sync.RWMutex`. Run 100 readers and 1 writer concurrently. Measure and print the writer's per-acquisition wait time (time spent in `Lock()` before holding it).

Vary the reader critical section length: 1 µs, 100 µs, 1 ms. Plot how the writer's wait time changes.

### Acceptance criteria

- Print per-iteration writer wait time.
- Identify the read critical section length at which writer wait exceeds 10 ms.
- Comment on why writer starvation gets worse as read critical sections lengthen.

### Hints

- Wrap `RWMutex.Lock` with a timing wrapper.
- Use `time.Sleep` inside the read critical section to simulate work.
- The writer should not run continuously; pause between iterations to let the system breathe.

### Reference solution

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Cache struct {
    mu      sync.RWMutex
    data    map[string]string
    readDur time.Duration
}

func (c *Cache) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    time.Sleep(c.readDur)
    return c.data[k]
}

func (c *Cache) Set(k, v string) time.Duration {
    start := time.Now()
    c.mu.Lock()
    wait := time.Since(start)
    c.data[k] = v
    c.mu.Unlock()
    return wait
}

func run(readDur time.Duration) {
    c := &Cache{data: map[string]string{"k": "v"}, readDur: readDur}
    stop := time.After(2 * time.Second)
    var wg sync.WaitGroup

    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-stop:
                    return
                default:
                    c.Get("k")
                }
            }
        }()
    }

    wg.Add(1)
    go func() {
        defer wg.Done()
        var max, total time.Duration
        var n int
        for {
            select {
            case <-stop:
                fmt.Printf("readDur=%v: writer iterations=%d max wait=%v avg=%v\n",
                    readDur, n, max, total/time.Duration(n))
                return
            default:
                wait := c.Set("k", "v2")
                if wait > max {
                    max = wait
                }
                total += wait
                n++
                time.Sleep(10 * time.Millisecond)
            }
        }
    }()

    wg.Wait()
}

func main() {
    for _, d := range []time.Duration{1 * time.Microsecond, 100 * time.Microsecond, 1 * time.Millisecond} {
        run(d)
    }
}
```

Expected: with 1 µs reads, writer wait is short (microseconds). With 1 ms reads and 100 overlapping readers, writer wait reaches tens of milliseconds. The writer must wait for *all currently active* readers to release before proceeding.

---

## Task 3: Build a Priority Two-Stage Select

### Prompt

Implement a worker loop that consumes from `urgent` and `normal` channels. `urgent` must be served before `normal` when both are ready, but `normal` should not be starved entirely.

### Acceptance criteria

- When only `urgent` items arrive, all of them are served before any `normal`.
- When only `normal` items arrive, they are served.
- When both arrive concurrently, urgent gets at least 3x the throughput of normal but normal still gets served (no starvation).

### Hints

- Use a two-stage `select`: first non-blocking poll of `urgent`, then a blocking `select` with both.
- Add a counter or random tie-break to give normal a chance even when urgent is always ready.

### Reference solution

```go
package main

import (
    "context"
    "fmt"
    "math/rand"
    "sync/atomic"
    "time"
)

func worker(ctx context.Context, urgent, normal <-chan int, urgentCount, normalCount *atomic.Int64) {
    for {
        // Phase 1: drain urgent without blocking.
        select {
        case <-urgent:
            urgentCount.Add(1)
            continue
        default:
        }
        // Phase 2: weighted blocking select.
        if rand.Intn(4) < 3 {
            select {
            case <-urgent:
                urgentCount.Add(1)
            case <-normal:
                normalCount.Add(1)
            case <-ctx.Done():
                return
            }
        } else {
            select {
            case <-normal:
                normalCount.Add(1)
            case <-urgent:
                urgentCount.Add(1)
            case <-ctx.Done():
                return
            }
        }
    }
}

func main() {
    urgent := make(chan int, 100)
    normal := make(chan int, 100)
    ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
    defer cancel()

    var u, n atomic.Int64
    go worker(ctx, urgent, normal, &u, &n)

    go func() {
        for {
            select {
            case <-ctx.Done():
                return
            case urgent <- 1:
            }
        }
    }()
    go func() {
        for {
            select {
            case <-ctx.Done():
                return
            case normal <- 1:
            }
        }
    }()

    <-ctx.Done()
    fmt.Printf("urgent=%d normal=%d ratio=%.2f\n", u.Load(), n.Load(), float64(u.Load())/float64(n.Load()))
}
```

Expected ratio: roughly 3-5x more urgent than normal. Normal is not starved.

---

## Task 4: Implement an Aging Priority Queue

### Prompt

Implement a priority queue where each item's effective priority improves with wait time. Specifically, an item with static priority `P` waiting for time `T` competes as if priority `P - T/100ms`.

Push items at varying priorities and ages; verify the dequeue order matches the aging policy.

### Acceptance criteria

- Items with high static priority dequeue first when fresh.
- Items with low static priority eventually dequeue ahead of newer high-priority items if they wait long enough.
- No item waits more than `K * 100 ms` where `K` is the highest priority value (assuming continuous flow of higher-priority items).

### Hints

- Use a simple slice with O(N) scan-and-extract. For a small queue this is fine.
- For a larger queue, periodically rebuild a heap, or use a structure that supports updating keys.

### Reference solution

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Item struct {
    Payload   string
    Priority  int
    EnqueueAt time.Time
}

type AgingQueue struct {
    mu       sync.Mutex
    items    []*Item
    nonEmpty *sync.Cond
}

func NewAgingQueue() *AgingQueue {
    q := &AgingQueue{}
    q.nonEmpty = sync.NewCond(&q.mu)
    return q
}

func (q *AgingQueue) effective(it *Item) int {
    age := time.Since(it.EnqueueAt)
    bonus := int(age / (100 * time.Millisecond))
    if bonus > it.Priority {
        bonus = it.Priority
    }
    return it.Priority - bonus
}

func (q *AgingQueue) Push(it *Item) {
    q.mu.Lock()
    it.EnqueueAt = time.Now()
    q.items = append(q.items, it)
    q.mu.Unlock()
    q.nonEmpty.Signal()
}

func (q *AgingQueue) Pop() *Item {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 {
        q.nonEmpty.Wait()
    }
    best := 0
    for i := 1; i < len(q.items); i++ {
        if q.effective(q.items[i]) < q.effective(q.items[best]) {
            best = i
        }
    }
    it := q.items[best]
    q.items[best] = q.items[len(q.items)-1]
    q.items = q.items[:len(q.items)-1]
    return it
}

func main() {
    q := NewAgingQueue()
    q.Push(&Item{Payload: "low-1", Priority: 5})
    time.Sleep(50 * time.Millisecond)
    q.Push(&Item{Payload: "high-1", Priority: 0})
    fmt.Printf("first: %s\n", q.Pop().Payload) // high-1, freshly enqueued at priority 0

    q.Push(&Item{Payload: "low-2", Priority: 5})
    time.Sleep(600 * time.Millisecond) // ages low-2 by 6 levels, effective priority 0
    q.Push(&Item{Payload: "high-2", Priority: 1})
    fmt.Printf("second: %s\n", q.Pop().Payload) // low-2 due to aging
}
```

The second pop shows low-2 winning over high-2 because aging has lifted its effective priority below high-2's static priority.

---

## Task 5: Implement Multi-Level Feedback Queues

### Prompt

Implement MLFQ with 3 levels and quotas `[4, 2, 1]`. A dispatcher loops over levels and dispatches up to the quota per round per level. If a level is empty, it skips. If a level overflows, items wait until the next round.

### Acceptance criteria

- Steady-state share: level 0 gets ~4/7, level 1 gets ~2/7, level 2 gets ~1/7 of throughput when all levels have continuous traffic.
- Idle levels do not block others.

### Hints

- Each level is a buffered `chan Item`.
- The dispatcher pulls non-blockingly within a level (`select { case: ; default: break }`).
- A single output channel feeds the workers.

### Reference solution

```go
package main

import (
    "context"
    "fmt"
    "sync/atomic"
    "time"
)

type Item struct {
    Level int
    ID    int
}

type MLFQ struct {
    queues []chan Item
    quotas []int
}

func NewMLFQ(quotas []int, capacity int) *MLFQ {
    q := &MLFQ{quotas: quotas, queues: make([]chan Item, len(quotas))}
    for i := range q.queues {
        q.queues[i] = make(chan Item, capacity)
    }
    return q
}

func (q *MLFQ) Submit(it Item) error {
    select {
    case q.queues[it.Level] <- it:
        return nil
    default:
        return fmt.Errorf("queue %d full", it.Level)
    }
}

func (q *MLFQ) Dispatch(ctx context.Context, out chan<- Item) {
    for {
        progress := false
        for i, ch := range q.queues {
            for n := 0; n < q.quotas[i]; n++ {
                select {
                case it := <-ch:
                    select {
                    case out <- it:
                        progress = true
                    case <-ctx.Done():
                        return
                    }
                default:
                    n = q.quotas[i] // break inner loop
                }
            }
        }
        if !progress {
            select {
            case <-time.After(1 * time.Millisecond):
            case <-ctx.Done():
                return
            }
        }
    }
}

func main() {
    q := NewMLFQ([]int{4, 2, 1}, 100)
    out := make(chan Item, 10)
    ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
    defer cancel()

    go q.Dispatch(ctx, out)

    // Producers for all three levels.
    for level := 0; level < 3; level++ {
        level := level
        go func() {
            id := 0
            for {
                select {
                case <-ctx.Done():
                    return
                default:
                    q.Submit(Item{Level: level, ID: id})
                    id++
                }
            }
        }()
    }

    // Consumer.
    var counts [3]atomic.Int64
    go func() {
        for {
            select {
            case it := <-out:
                counts[it.Level].Add(1)
            case <-ctx.Done():
                return
            }
        }
    }()

    <-ctx.Done()
    time.Sleep(100 * time.Millisecond) // drain
    total := counts[0].Load() + counts[1].Load() + counts[2].Load()
    fmt.Printf("L0=%d (%.1f%%) L1=%d (%.1f%%) L2=%d (%.1f%%)\n",
        counts[0].Load(), 100*float64(counts[0].Load())/float64(total),
        counts[1].Load(), 100*float64(counts[1].Load())/float64(total),
        counts[2].Load(), 100*float64(counts[2].Load())/float64(total))
}
```

Expected: L0 ≈ 57%, L1 ≈ 29%, L2 ≈ 14% (4/7, 2/7, 1/7).

---

## Task 6: Build a Cancellable FIFO Mutex

### Prompt

Implement a mutex that:

- Honours `context.Context` cancellation (`Lock(ctx)` returns `ctx.Err()` if cancelled).
- Serves waiters in strict FIFO order.

### Acceptance criteria

- `Lock(ctx)` with cancelled `ctx` returns immediately with an error.
- Acquisitions happen in the order of `Lock` calls when there is contention.
- No deadlock under concurrent cancel and unlock.

### Hints

- Per-waiter channel for signalling.
- On cancel, remove yourself from the waiter list. If you were already signalled, hand off to the next waiter.

### Reference solution

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type FIFOMutex struct {
    mu      sync.Mutex
    held    bool
    waiters []chan struct{}
}

func (m *FIFOMutex) Lock(ctx context.Context) error {
    m.mu.Lock()
    if !m.held {
        m.held = true
        m.mu.Unlock()
        return nil
    }
    ch := make(chan struct{})
    m.waiters = append(m.waiters, ch)
    m.mu.Unlock()

    select {
    case <-ch:
        return nil
    case <-ctx.Done():
        m.mu.Lock()
        for i, w := range m.waiters {
            if w == ch {
                m.waiters = append(m.waiters[:i], m.waiters[i+1:]...)
                m.mu.Unlock()
                return ctx.Err()
            }
        }
        // Already removed -> we were signalled, mid-race with cancel.
        m.mu.Unlock()
        m.Unlock()
        return ctx.Err()
    }
}

func (m *FIFOMutex) Unlock() {
    m.mu.Lock()
    if len(m.waiters) == 0 {
        m.held = false
        m.mu.Unlock()
        return
    }
    next := m.waiters[0]
    m.waiters = m.waiters[1:]
    m.mu.Unlock()
    close(next)
}

func main() {
    m := &FIFOMutex{}
    var wg sync.WaitGroup
    m.Lock(context.Background())
    for i := 0; i < 3; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
            defer cancel()
            err := m.Lock(ctx)
            if err != nil {
                fmt.Printf("goroutine %d: %v\n", i, err)
                return
            }
            fmt.Printf("goroutine %d acquired\n", i)
            m.Unlock()
        }()
        time.Sleep(10 * time.Millisecond)
    }
    time.Sleep(50 * time.Millisecond)
    m.Unlock() // release initial; first waiter acquires
    wg.Wait()
}
```

---

## Task 7: Deficit Round Robin Rate Limiter

### Prompt

Implement DRR for three tenants with quanta `[100, 50, 10]`. Items have variable cost. Show that no tenant starves the others.

### Acceptance criteria

- Tenants get throughput shares roughly proportional to quanta.
- A tenant with continuous traffic does not lock out tenants with bursts.

### Hints

- Each tenant has a queue, deficit counter, and quantum.
- Dispatcher loops over tenants, adds quantum to deficit, drains items whose cost fits.

### Reference solution

```go
package main

import (
    "context"
    "fmt"
    "sync/atomic"
    "time"
)

type Item struct {
    Tenant int
    Cost   int
}

type Tenant struct {
    queue   chan Item
    deficit int
    quantum int
}

func DRR(ctx context.Context, tenants []*Tenant, out chan<- Item) {
    for {
        for _, t := range tenants {
            t.deficit += t.quantum
        L:
            for {
                select {
                case it := <-t.queue:
                    if it.Cost > t.deficit {
                        // Cannot serve; put back at front of channel buffer.
                        // Simple approach: hold for next round.
                        t.queue <- it
                        break L
                    }
                    t.deficit -= it.Cost
                    select {
                    case out <- it:
                    case <-ctx.Done():
                        return
                    }
                default:
                    break L
                }
            }
        }
        select {
        case <-ctx.Done():
            return
        default:
        }
    }
}

func main() {
    tenants := []*Tenant{
        {queue: make(chan Item, 100), quantum: 100},
        {queue: make(chan Item, 100), quantum: 50},
        {queue: make(chan Item, 100), quantum: 10},
    }
    out := make(chan Item, 10)
    ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
    defer cancel()

    go DRR(ctx, tenants, out)

    for i, t := range tenants {
        i, t := i, t
        go func() {
            for {
                select {
                case <-ctx.Done():
                    return
                case t.queue <- Item{Tenant: i, Cost: 10}:
                }
            }
        }()
    }

    var counts [3]atomic.Int64
    go func() {
        for {
            select {
            case it := <-out:
                counts[it.Tenant].Add(1)
            case <-ctx.Done():
                return
            }
        }
    }()

    <-ctx.Done()
    time.Sleep(50 * time.Millisecond)
    fmt.Printf("T0=%d T1=%d T2=%d\n", counts[0].Load(), counts[1].Load(), counts[2].Load())
}
```

Expected ratio: ~10:5:1 (matching quanta).

---

## Task 8: Async Preemption Demonstration

### Prompt

Write a program that spawns a tight CPU loop on a goroutine and verifies that other goroutines on the same P still get CPU time. Document the difference between Go 1.13 and Go 1.14+ behaviour.

### Acceptance criteria

- On Go 1.14+ with GOMAXPROCS=1, both goroutines make progress.
- Print counters from both goroutines to demonstrate.
- Explain why the pre-1.14 behaviour would hang.

### Reference solution

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
    runtime.GOMAXPROCS(1)
    var tightCount, otherCount atomic.Int64
    var wg sync.WaitGroup
    deadline := time.Now().Add(200 * time.Millisecond)

    wg.Add(1)
    go func() {
        defer wg.Done()
        for time.Now().Before(deadline) {
            for i := 0; i < 1_000_000; i++ {
                tightCount.Add(1)
                _ = i
            }
        }
    }()

    wg.Add(1)
    go func() {
        defer wg.Done()
        for time.Now().Before(deadline) {
            otherCount.Add(1)
            time.Sleep(1 * time.Millisecond)
        }
    }()

    wg.Wait()
    fmt.Printf("tight=%d other=%d\n", tightCount.Load(), otherCount.Load())
    if otherCount.Load() == 0 {
        fmt.Println("OTHER GOROUTINE STARVED (pre-1.14 behaviour)")
    } else {
        fmt.Println("OTHER GOROUTINE PROGRESSED (1.14+ async preempt working)")
    }
}
```

On Go 1.14+ both counts are non-zero. On 1.13, the second goroutine would not even start until the tight goroutine voluntarily yielded.

---

## Task 9: Instrumented RWMutex with Metrics

### Prompt

Wrap `sync.RWMutex` with a struct that tracks:

- Total reader wait time.
- Total writer wait time.
- Maximum waiters at any moment.

Expose these as gauges. Run under load and verify the metrics reflect the workload.

### Reference solution

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type InstrumentedRWMutex struct {
    inner       sync.RWMutex
    readerWait  atomic.Int64 // total ns
    writerWait  atomic.Int64 // total ns
    waiters     atomic.Int64
    maxWaiters  atomic.Int64
}

func (m *InstrumentedRWMutex) trackWaiter() func() {
    n := m.waiters.Add(1)
    for {
        cur := m.maxWaiters.Load()
        if n <= cur || m.maxWaiters.CompareAndSwap(cur, n) {
            break
        }
    }
    return func() { m.waiters.Add(-1) }
}

func (m *InstrumentedRWMutex) RLock() {
    defer m.trackWaiter()()
    start := time.Now()
    m.inner.RLock()
    m.readerWait.Add(int64(time.Since(start)))
}

func (m *InstrumentedRWMutex) RUnlock() { m.inner.RUnlock() }

func (m *InstrumentedRWMutex) Lock() {
    defer m.trackWaiter()()
    start := time.Now()
    m.inner.Lock()
    m.writerWait.Add(int64(time.Since(start)))
}

func (m *InstrumentedRWMutex) Unlock() { m.inner.Unlock() }

func main() {
    var m InstrumentedRWMutex
    var wg sync.WaitGroup
    stop := time.After(500 * time.Millisecond)

    for i := 0; i < 50; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-stop:
                    return
                default:
                    m.RLock()
                    time.Sleep(100 * time.Microsecond)
                    m.RUnlock()
                }
            }
        }()
    }

    wg.Add(1)
    go func() {
        defer wg.Done()
        for {
            select {
            case <-stop:
                return
            default:
                m.Lock()
                m.Unlock()
                time.Sleep(50 * time.Millisecond)
            }
        }
    }()

    wg.Wait()
    fmt.Printf("reader total wait: %v\n", time.Duration(m.readerWait.Load()))
    fmt.Printf("writer total wait: %v\n", time.Duration(m.writerWait.Load()))
    fmt.Printf("max waiters:        %d\n", m.maxWaiters.Load())
}
```

---

## Task 10: Tail Latency Soak Test Harness

### Prompt

Build a harness that:

- Drives load against a function under test.
- Records per-operation latency.
- Reports p50, p90, p99, p99.9 at the end.

Use it to compare `sync.Mutex` and `sync.RWMutex` under read-mostly load.

### Reference solution

```go
package main

import (
    "fmt"
    "math/rand"
    "sort"
    "sync"
    "sync/atomic"
    "time"
)

type LatencyRecorder struct {
    mu      sync.Mutex
    samples []time.Duration
}

func (r *LatencyRecorder) Record(d time.Duration) {
    r.mu.Lock()
    r.samples = append(r.samples, d)
    r.mu.Unlock()
}

func (r *LatencyRecorder) Report(name string) {
    sort.Slice(r.samples, func(i, j int) bool { return r.samples[i] < r.samples[j] })
    if len(r.samples) == 0 {
        return
    }
    p := func(q float64) time.Duration { return r.samples[int(float64(len(r.samples)-1)*q)] }
    fmt.Printf("%s: n=%d p50=%v p90=%v p99=%v p99.9=%v max=%v\n",
        name, len(r.samples), p(0.50), p(0.90), p(0.99), p(0.999), p(1.0))
}

type Locker interface {
    Read(k string) string
    Write(k, v string)
}

type MutexLock struct {
    mu sync.Mutex
    m  map[string]string
}

func (l *MutexLock) Read(k string) string {
    l.mu.Lock()
    v := l.m[k]
    l.mu.Unlock()
    return v
}

func (l *MutexLock) Write(k, v string) {
    l.mu.Lock()
    l.m[k] = v
    l.mu.Unlock()
}

type RWMutexLock struct {
    mu sync.RWMutex
    m  map[string]string
}

func (l *RWMutexLock) Read(k string) string {
    l.mu.RLock()
    v := l.m[k]
    l.mu.RUnlock()
    return v
}

func (l *RWMutexLock) Write(k, v string) {
    l.mu.Lock()
    l.m[k] = v
    l.mu.Unlock()
}

func run(name string, l Locker) {
    var ops atomic.Int64
    reader := &LatencyRecorder{}
    writer := &LatencyRecorder{}
    var wg sync.WaitGroup
    deadline := time.Now().Add(1 * time.Second)

    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for time.Now().Before(deadline) {
                t := time.Now()
                l.Read("k")
                reader.Record(time.Since(t))
                ops.Add(1)
            }
        }()
    }
    wg.Add(1)
    go func() {
        defer wg.Done()
        for time.Now().Before(deadline) {
            t := time.Now()
            l.Write("k", fmt.Sprintf("v%d", rand.Int()))
            writer.Record(time.Since(t))
            time.Sleep(5 * time.Millisecond)
        }
    }()
    wg.Wait()
    fmt.Printf("=== %s (ops=%d) ===\n", name, ops.Load())
    reader.Report("read")
    writer.Report("write")
}

func main() {
    run("Mutex", &MutexLock{m: map[string]string{}})
    run("RWMutex", &RWMutexLock{m: map[string]string{}})
}
```

Expected: for a tiny read critical section, plain `Mutex` may be competitive on read latency but `RWMutex` has worse writer p99. Adjust read durations to find the cross-over.
