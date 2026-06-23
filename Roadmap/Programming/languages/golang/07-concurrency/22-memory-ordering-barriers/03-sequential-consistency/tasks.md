---
layout: default
title: Sequential Consistency — Tasks
parent: Sequential Consistency
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/03-sequential-consistency/tasks/
---

# Sequential Consistency — Hands-On Tasks

Practical exercises to build hands-on familiarity with SC and `sync/atomic` in Go. Each task includes a skeleton, requirements, and acceptance criteria.

---

## Task 1: Atomic Counter (Beginner)

**Goal:** Replace a racy plain `int64` counter with an atomic counter.

**Skeleton:**

```go
package main

import (
    "fmt"
    "sync"
)

var counter int64

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++ // RACE
        }()
    }
    wg.Wait()
    fmt.Println(counter)
}
```

**Requirements:**
- Replace `counter` with `atomic.Int64`.
- Each goroutine increments via atomic.
- Final printed value must be 1000.
- Run with `go run -race` and verify no race output.

**Acceptance:** Output is always 1000. `-race` reports no race.

---

## Task 2: Publication Pattern (Beginner)

**Goal:** Implement a writer/reader using `atomic.Pointer[T]` publication.

**Skeleton:**

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Config struct {
    URL     string
    Timeout int
}

func main() {
    var cfg atomic.Pointer[Config]
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        c := &Config{URL: "https://example.com", Timeout: 5}
        cfg.Store(c)
    }()
    wg.Wait()
    c := cfg.Load()
    if c == nil {
        fmt.Println("no config")
        return
    }
    fmt.Println(c.URL, c.Timeout)
}
```

**Requirements:**
- Verify the printed output is consistent.
- Add a second goroutine that reads the config and prints.
- Use `WaitGroup` to ensure proper synchronisation.

**Acceptance:** Output is `https://example.com 5`. No race.

---

## Task 3: Stop Flag (Beginner)

**Goal:** Implement a graceful shutdown signal using `atomic.Bool`.

**Skeleton:**

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

func main() {
    var stop atomic.Bool
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for !stop.Load() {
            // do work
        }
        fmt.Println("worker exiting")
    }()
    time.Sleep(100 * time.Millisecond)
    stop.Store(true)
    wg.Wait()
}
```

**Requirements:**
- Verify the worker exits within 100ms of the stop signal.
- Add multiple workers; all should exit.
- Measure latency from `Store` to "worker exiting" using `time.Now()`.

**Acceptance:** All workers exit within 1ms of stop. No race.

---

## Task 4: Sharded Counter (Intermediate)

**Goal:** Build a sharded counter to scale across many cores.

**Skeleton:**

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type ShardedCounter struct {
    // TODO: declare shards with padding
}

func (c *ShardedCounter) Inc(g int) {
    // TODO: increment the shard
}

func (c *ShardedCounter) Sum() int64 {
    // TODO: sum all shards
    return 0
}

func main() {
    var c ShardedCounter
    var wg sync.WaitGroup
    for i := 0; i < 16; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 100000; j++ {
                c.Inc(i)
            }
        }()
    }
    wg.Wait()
    fmt.Println(c.Sum())
}
```

**Requirements:**
- Use 64 shards.
- Pad each shard to 64 bytes (avoid false sharing).
- Final sum must be 1,600,000.
- Benchmark vs single-atomic counter.

**Acceptance:** Output is 1600000. Benchmark shows scaling.

---

## Task 5: Copy-on-Write Map (Intermediate)

**Goal:** Build a read-mostly map with lock-free reads.

**Skeleton:**

```go
package main

import "sync/atomic"

type Map[K comparable, V any] struct {
    m atomic.Pointer[map[K]V]
}

func New[K comparable, V any]() *Map[K, V] {
    // TODO: init with empty map
    return nil
}

func (m *Map[K, V]) Get(k K) (V, bool) {
    // TODO
    var zero V
    return zero, false
}

func (m *Map[K, V]) Set(k K, v V) {
    // TODO: copy-on-write update
}
```

**Requirements:**
- Reads must be lock-free.
- Writes must use CAS loop with copy.
- Tests: concurrent Sets and Gets; final map has all keys.
- Compare performance with `sync.RWMutex` map.

**Acceptance:** No race. Reads outperform RWMutex.

---

## Task 6: Lock-Free SPSC Queue (Intermediate)

**Goal:** Implement a single-producer single-consumer ring buffer.

**Skeleton:**

```go
package main

import "sync/atomic"

type SPSC struct {
    buf  []int64
    head atomic.Int64
    tail atomic.Int64
}

func New(cap int) *SPSC {
    return &SPSC{buf: make([]int64, cap)}
}

func (q *SPSC) Push(v int64) bool {
    // TODO
    return false
}

func (q *SPSC) Pop() (int64, bool) {
    // TODO
    return 0, false
}
```

**Requirements:**
- Producer goroutine pushes 1M values.
- Consumer goroutine pops them.
- Order preserved.
- Add cache-line padding between head and tail.
- Benchmark vs `chan int64` (buffered, same capacity).

**Acceptance:** All 1M values popped in order. Benchmark shows performance.

---

## Task 7: Litmus Test Harness (Intermediate)

**Goal:** Implement the store-buffer litmus test and verify SC.

**Skeleton:**

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var sc_violations int
    for i := 0; i < 100000; i++ {
        var x, y atomic.Int32
        var r1, r2 int32
        var wg sync.WaitGroup
        wg.Add(2)
        go func() {
            defer wg.Done()
            x.Store(1)
            r1 = y.Load()
        }()
        go func() {
            defer wg.Done()
            y.Store(1)
            r2 = x.Load()
        }()
        wg.Wait()
        if r1 == 0 && r2 == 0 {
            sc_violations++
        }
    }
    fmt.Printf("SC violations: %d (should be 0)\n", sc_violations)
}
```

**Requirements:**
- Run 100,000 iterations.
- Verify `sc_violations == 0`.
- Repeat on multiple architectures if available.

**Acceptance:** Always 0 violations on any supported architecture.

---

## Task 8: Double-Checked Locking (Intermediate)

**Goal:** Implement a thread-safe lazy singleton.

**Skeleton:**

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Singleton struct{ Name string }

var instance atomic.Pointer[Singleton]
var mu sync.Mutex

func Get() *Singleton {
    // TODO: DCL with atomic.Pointer + mutex
    return nil
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(Get().Name)
        }()
    }
    wg.Wait()
}
```

**Requirements:**
- Initialise the singleton exactly once.
- Fast path: lock-free check.
- Slow path: mutex-protected init.
- Verify with a counter (increment inside init; expect 1).

**Acceptance:** Init runs exactly once. No race.

---

## Task 9: Atomic Versioned State (Intermediate)

**Goal:** Build a state container with monotonic versioning.

**Skeleton:**

```go
package main

import "sync/atomic"

type Versioned[T any] struct {
    cur atomic.Pointer[versioned[T]]
}

type versioned[T any] struct {
    version int64
    value   T
}

func (v *Versioned[T]) Read() (T, int64) {
    // TODO
    var zero T
    return zero, 0
}

func (v *Versioned[T]) Write(t T) int64 {
    // TODO: CAS loop, increment version
    return 0
}
```

**Requirements:**
- Versions monotonically increase.
- Concurrent Writes don't lose updates.
- Reads return a consistent (value, version) pair.

**Acceptance:** Version count matches write count. No race.

---

## Task 10: Hand-Rolled `sync.Once` (Intermediate)

**Goal:** Implement `sync.Once` from scratch using atomics.

**Skeleton:**

```go
package main

import (
    "sync"
    "sync/atomic"
)

type Once struct {
    done atomic.Uint32
    m    sync.Mutex
}

func (o *Once) Do(f func()) {
    // TODO: fast path + slow path
}
```

**Requirements:**
- `f` runs exactly once even with concurrent Do calls.
- Fast path: atomic check.
- Slow path: mutex-protected init.
- Test with 100 concurrent calls; verify f ran once.

**Acceptance:** Exactly one f execution. No race.

---

## Task 11: Lock-Free Treiber Stack (Advanced)

**Goal:** Implement a lock-free stack using CAS.

**Skeleton:**

```go
package main

import "sync/atomic"

type node[T any] struct {
    val  T
    next *node[T]
}

type Stack[T any] struct {
    head atomic.Pointer[node[T]]
}

func (s *Stack[T]) Push(v T) {
    // TODO
}

func (s *Stack[T]) Pop() (T, bool) {
    // TODO
    var zero T
    return zero, false
}
```

**Requirements:**
- Push and Pop use CAS loops.
- Concurrent push/pop preserves LIFO order per producer/consumer pair.
- Test with 16 goroutines pushing/popping; final stack matches expected.

**Acceptance:** No race. ABA hazard discussed in comments.

---

## Task 12: Lock-Free MPMC Queue (Advanced)

**Goal:** Implement a multi-producer multi-consumer bounded queue.

**Skeleton:**

```go
package main

import "sync/atomic"

type slot[T any] struct {
    seq atomic.Uint64
    val T
}

type Queue[T any] struct {
    buf  []slot[T]
    mask uint64
    enq  atomic.Uint64
    deq  atomic.Uint64
}

func New[T any](cap int) *Queue[T] {
    // TODO: ensure cap is power of 2, init seq numbers
    return nil
}

func (q *Queue[T]) Enqueue(v T) bool {
    // TODO
    return false
}

func (q *Queue[T]) Dequeue() (T, bool) {
    // TODO
    var zero T
    return zero, false
}
```

**Requirements:**
- Vyukov-style bounded MPMC queue.
- Multiple producers and consumers.
- Lock-free.
- Test with 8 producers, 8 consumers, 1M items; verify count.

**Acceptance:** All items processed. No race.

---

## Task 13: Hazard Pointer Sketch (Advanced)

**Goal:** Implement basic hazard pointers for lock-free memory reclamation.

**Skeleton:**

```go
package main

import "sync/atomic"

const maxThreads = 64

type HazardSet struct {
    pointers [maxThreads]atomic.Pointer[any]
}

func (h *HazardSet) Set(threadID int, p any) {
    // TODO
}

func (h *HazardSet) Clear(threadID int) {
    // TODO
}

func (h *HazardSet) IsHazarded(p any) bool {
    // TODO
    return false
}
```

**Requirements:**
- Each thread declares pointers it's accessing.
- `IsHazarded` checks if any thread hazards a pointer.
- Combine with a lock-free queue for full reclamation.

**Acceptance:** Memory not freed while hazarded. Race-free.

---

## Task 14: Epoch-Based Reclamation (Advanced)

**Goal:** Implement epoch-based reclamation.

**Skeleton:**

```go
package main

import "sync/atomic"

type Epoch struct {
    global atomic.Int64
    local  [maxThreads]atomic.Int64
}

func (e *Epoch) Enter(threadID int) {
    // TODO: set local to current global
}

func (e *Epoch) Exit(threadID int) {
    // TODO: clear local
}

func (e *Epoch) Advance() {
    // TODO: bump global
}

func (e *Epoch) CanReclaim(epoch int64) bool {
    // TODO: check no thread is in or before the epoch
    return false
}
```

**Requirements:**
- Threads enter/exit epochs.
- Reclamation waits for all threads to advance past the epoch.
- Test with a lock-free structure.

**Acceptance:** Correct under concurrent access.

---

## Task 15: Benchmark Suite (Advanced)

**Goal:** Build a benchmark suite for atomic operations.

**Skeleton:**

```go
package atomicbench_test

import (
    "sync/atomic"
    "testing"
)

func BenchmarkPlainLoad(b *testing.B) { /* TODO */ }
func BenchmarkAtomicLoad(b *testing.B) { /* TODO */ }
func BenchmarkAtomicStore(b *testing.B) { /* TODO */ }
func BenchmarkAtomicAdd(b *testing.B) { /* TODO */ }
func BenchmarkAtomicCAS(b *testing.B) { /* TODO */ }
func BenchmarkAtomicContended(b *testing.B) { /* TODO */ }
func BenchmarkAtomicSharded(b *testing.B) { /* TODO */ }
```

**Requirements:**
- Run each benchmark.
- Compare costs on your hardware.
- Document the results.

**Acceptance:** Benchmarks complete. Document submitted.

---

## Task 16: Real-World Refactor (Advanced)

**Goal:** Refactor an existing piece of code from `sync.RWMutex` to `atomic.Pointer[T]`.

**Steps:**
- Find or write a code snippet using RWMutex for a read-mostly config.
- Identify the contract (publication, immutability).
- Refactor to atomic.Pointer with copy-on-write writes.
- Benchmark before and after.
- Document the improvement.

**Acceptance:** Refactored code passes -race. Benchmark shows improvement.

---

## Task 17: Litmus Test Variant (Advanced)

**Goal:** Implement the IRIW litmus test and verify SC.

**Skeleton:**

```go
// 4 goroutines:
// A: x = 1
// B: y = 1
// C: r1 = x; r2 = y
// D: r3 = y; r4 = x
// Forbidden under SC: r1=1, r2=0, r3=1, r4=0
```

**Requirements:**
- Implement using `atomic.Int32`.
- Run 1M iterations.
- Verify no forbidden outcome.

**Acceptance:** No SC violation.

---

## Task 18: Cache-Line Probe (Advanced)

**Goal:** Demonstrate false sharing impact.

**Skeleton:**

```go
// Benchmark two atomics on the same cache line
// vs two atomics on different cache lines.
// Show the throughput difference.
```

**Requirements:**
- Implement both variants.
- Benchmark with `b.RunParallel`.
- Document the throughput ratio.

**Acceptance:** Demonstrable difference (typically 3-10x).

---

## Task 19: Memory Order Comparison (Advanced)

**Goal:** Write the same algorithm in Go and C++ (with relaxed atomics).

**Steps:**
- Choose a counter or simple flag.
- Implement in Go with atomic.Int64.
- Implement in C++ with std::atomic<int64_t> and memory_order_relaxed.
- Benchmark both on the same hardware.
- Document the performance difference.

**Acceptance:** Working code in both languages. Performance numbers documented.

---

## Task 20: Spec Verification (Advanced)

**Goal:** Verify Go's memory model with a small TLA+ specification.

**Steps:**
- Choose a simple pattern (publication, mutex).
- Write a TLA+ spec.
- Run TLC model checker.
- Verify SC-DRF holds.

**Acceptance:** Successful model check. Spec documented.

---

## Bonus Task: Read the Source

Read 1000 lines of Go's `runtime/internal/atomic` for any architecture. Take notes. Discuss with a colleague.

This is not a coding task but a learning exercise. Highly recommended.

---

## Closing

These tasks build practical SC skills incrementally. Start with Task 1 and progress.

For each task: complete the code, verify with `-race`, benchmark when relevant, document what you learned.

End.
