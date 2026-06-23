---
layout: default
title: False Sharing — Tasks
parent: False Sharing
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/05-false-sharing/tasks/
---

# False Sharing — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions or solution sketches are at the end.

---

## Easy

### Task 1 — Reproduce false sharing

Write a benchmark that demonstrates false sharing. Use two struct types: `Adjacent` (a `[8]int64` of counters) and `Padded` (a `[8]struct{v int64; _ [56]byte}`). Run 8 goroutines, each incrementing one index in a tight `atomic.AddInt64` loop. Measure ns/op.

- Run at `-cpu=1` and `-cpu=8`.
- At `-cpu=1`: padded and adjacent should be roughly equal.
- At `-cpu=8`: padded should be 10-20x faster than adjacent.

**Goal.** See the bug first-hand. Confirm the speedup matches expectations.

---

### Task 2 — Verify struct layout

Using `unsafe.Sizeof` and `unsafe.Offsetof`, print the memory layout of:

1. `struct { a, b int64 }`
2. `struct { a int64; _ [56]byte; b int64 }`
3. `[8]int64`
4. `[8]struct { v int64; _ [56]byte }`

For each, print sizeof and the offset of each field (or element). Compute `offset / 64` for each (the cache line number) and verify which fields share a line.

**Goal.** Build intuition for memory layout.

---

### Task 3 — Cache-line-padded counter

Implement a `Counter` type with one method: `Inc()`. Use a single padded `atomic.Int64`. Write a benchmark with 8 goroutines calling `Inc()` in a tight loop. Compare against an unpadded version.

Note: padding a *single* counter does not help if all goroutines hit the same counter (true sharing). The padded version should be the same speed as the unpadded — both are slow. This is a teaching exercise: padding alone does not fix true contention.

**Goal.** Distinguish false sharing from true sharing.

---

### Task 4 — Sharded counter

Extend Task 3: replace the single counter with a sharded array of padded counters. The shard count is `runtime.GOMAXPROCS(0)`. Each `Inc(shardID)` updates a specific shard. The benchmark passes `id % numShards` as the shard ID.

- With 8 goroutines and 8 shards: throughput should scale linearly.
- With 8 goroutines and 1 shard: throughput collapses (true sharing).
- With 8 goroutines and 2 shards: throughput is roughly 2x of 1 shard.

Plot the curve: shards vs throughput.

**Goal.** See the relationship between shard count and contention.

---

### Task 5 — Cache line size on your machine

Write a Go program that determines the cache line size empirically. Strategy: allocate a large slice, write to indexes 0 and `stride` from two goroutines for various values of `stride`. Measure throughput. The smallest `stride` at which throughput is "fast" indicates the cache line size.

Hint: try strides of 1, 2, 4, 8, 16, 32, 64, 128, 256 bytes. The transition typically happens at 64 (or 128 on some architectures).

**Goal.** Confirm the cache line size of your hardware.

---

### Task 6 — Read `sync.Pool` source

Open `$GOROOT/src/sync/pool.go`. Find the `poolLocal` struct. Identify the padding field. Explain in writing:

- What `unsafe.Sizeof(poolLocalInternal{})%128` computes.
- Why the padding is to 128 bytes, not 64.
- What `poolLocalInternal` contains and why it is hot.

**Goal.** Read real Go runtime code for cache-aware design.

---

## Medium

### Task 7 — Padded ring buffer

Implement a single-producer, single-consumer ring buffer of bytes. The producer writes a head index; the consumer writes a tail index. Pad `head` and `tail` so they live on separate cache lines.

```go
type Ring struct {
    head atomic.Uint64
    _    [56]byte
    tail atomic.Uint64
    _    [56]byte
    buf  []byte
}
```

Write a benchmark with one producer goroutine and one consumer goroutine. Compare against a non-padded version. Measure messages per second.

Expected: padded version is 2-3x faster on dual-core or higher.

**Goal.** Apply padding to producer/consumer patterns.

---

### Task 8 — Microbenchmark a sharded map

Implement a sharded `map[string]int` (with `sync.Mutex` per shard). Pad each shard's mutex+map so adjacent shards do not false-share.

Benchmark with 8 goroutines doing `Set(randomKey, value)` and `Get(randomKey)`. Compare padded vs unpadded.

The padded version should be slightly faster (a few percent) under high contention, due to less cache-line interference between shards.

**Goal.** See padding's role in shard-based structures.

---

### Task 9 — Visualise cache line numbers

Write a program that prints the cache line number (`addr / 64`) of each field in a struct:

```go
type S struct {
    a int64
    b int64
    c int64
    d int64
    _ [32]byte
    e int64
}
```

For each field, print its address, offset, and line number. Identify which fields share a line.

**Goal.** Develop spatial reasoning about struct layout.

---

### Task 10 — Detect false sharing via benchmark scaling

Write a benchmark that takes a `-numgoroutines=N` flag (via `os.Args` or environment variable) and runs N goroutines incrementing an unpadded counter array. Run for N = 1, 2, 4, 8, 16. Plot the throughput.

A *linear* curve indicates no false sharing. A *flat* or *declining* curve indicates false sharing.

**Goal.** Recognise the signature of false sharing in scaling data.

---

### Task 11 — Counter with caller-supplied shard

Implement a counter where the caller supplies a shard ID. Write three usage patterns:

1. Caller passes a random shard ID per call.
2. Caller passes the same shard ID every time (worst case for the structure).
3. Caller passes a stable hash of a per-goroutine identifier.

Compare throughputs. The third should be fastest (best distribution, best cache locality per goroutine).

**Goal.** Understand the role of shard selection in real applications.

---

### Task 12 — Padding test

For your padded struct (from any earlier task), write a unit test that asserts `unsafe.Sizeof` equals `cacheLineSize` (64). If someone adds a field without updating the padding, the test fires.

**Goal.** Build defensive tests against silent layout drift.

---

### Task 13 — Compare `atomic.Int64` wrapper vs raw `int64`

Write two padded counter types: one using `atomic.Int64` (Go 1.19+ wrapper) and one using raw `int64` with `atomic.AddInt64`. Benchmark them.

Expected: identical performance. The wrapper compiles to the same `LOCK XADDQ` instruction.

**Goal.** Confirm typed atomics are zero-cost abstractions for layout purposes.

---

### Task 14 — Detect adjacent-line prefetch

On Intel hardware, write a benchmark comparing:

- 64-byte padded counters
- 128-byte padded counters
- 256-byte padded counters

Expected: 64-byte is fastest (least memory). 128-byte may be slightly faster *under contention* due to defeating the prefetcher. 256-byte should not gain anything more.

If your hardware is AMD or non-Intel, you may see no difference between 64 and 128. Document.

**Goal.** See the prefetcher's effect (or non-effect) on your hardware.

---

## Hard

### Task 15 — Lock-free MPMC queue with padded slots

Implement a multi-producer, multi-consumer bounded queue using sequence-counter slots (the Vyukov design). Pad each slot to a cache line if expected high contention.

Benchmark with 4 producers and 4 consumers on 8 cores. Compare against a `chan interface{}` baseline.

Expected: padded MPMC queue is 2-5x faster than the channel for bounded fan-out work.

**Goal.** Build a real lock-free data structure with proper cache layout.

---

### Task 16 — Per-CPU sharded counter via `runtime_procPin`

Implement a sharded counter that uses `runtime_procPin` (via `go:linkname`) to select the current P's shard. Increment without atomics (since pinned).

```go
//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int
//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()
```

Benchmark against the atomic version. The `procPin` version should be ~2-3x faster (no `LOCK` prefix).

**Goal.** Understand the tradeoff between atomicity and pinning.

---

### Task 17 — NUMA-aware counter

If you have a multi-socket server, implement a NUMA-aware counter. Use `getcpu(2)` (Linux) to find the current NUMA node. Maintain per-node arrays of per-CPU shards.

Benchmark with goroutines pinned to specific cores via OS affinity.

Expected: NUMA-aware version is significantly faster than NUMA-oblivious on cross-socket workloads.

**Goal.** Apply false-sharing avoidance at the NUMA level.

---

### Task 18 — `perf c2c` investigation

On Linux, run `perf c2c record -F 5000 -- ./yourbinary`. Generate the report. Identify the top three cache lines by HITM count. For each:

- Use the address and offset info to find the source line.
- Determine whether it is true sharing or false sharing.
- Propose a fix.

**Goal.** Master the `perf c2c` workflow.

---

### Task 19 — Hierarchical sharded counter

Build a three-level counter: per-core (hot, per-P), per-NUMA-node (warm, aggregated every 10ms), global (cold, updated every 100ms). Reads return the global value.

Properties to verify:
- Write throughput scales linearly with cores.
- Read cost is O(1) (just an atomic load).
- Staleness is bounded by the slowest-level flush interval.

**Goal.** Build a production-grade telemetry counter.

---

### Task 20 — False sharing in a real codebase

Pick an open-source Go project (e.g., `cockroachdb/pebble`, `dgraph-io/badger`, `cilium/cilium`). Find a `Counter`, `Stats`, or similar high-throughput structure. Identify cache-line padding choices. Write a 1-page analysis of why the padding is structured as it is.

**Goal.** Read production code with a false-sharing-aware lens.

---

## Solutions Sketch

### Task 1 sketch

```go
package falseshare_test

import (
    "sync"
    "sync/atomic"
    "testing"
)

type Adjacent struct{ counters [8]int64 }
type Padded struct {
    counters [8]struct {
        v int64
        _ [56]byte
    }
}

func benchmarkN(b *testing.B, w int, inc func(id int)) {
    var wg sync.WaitGroup
    wg.Add(w)
    each := b.N / w
    b.ResetTimer()
    for i := 0; i < w; i++ {
        go func(id int) {
            defer wg.Done()
            for j := 0; j < each; j++ {
                inc(id)
            }
        }(i)
    }
    wg.Wait()
}

func BenchmarkAdjacent(b *testing.B) {
    a := &Adjacent{}
    benchmarkN(b, 8, func(id int) {
        atomic.AddInt64(&a.counters[id], 1)
    })
}

func BenchmarkPadded(b *testing.B) {
    p := &Padded{}
    benchmarkN(b, 8, func(id int) {
        atomic.AddInt64(&p.counters[id].v, 1)
    })
}
```

Run: `go test -bench . -cpu=1,8 -benchtime=2s`.

---

### Task 2 sketch

```go
package main

import (
    "fmt"
    "unsafe"
)

type A struct{ a, b int64 }
type P struct {
    a int64
    _ [56]byte
    b int64
}

func main() {
    var a A
    var p P
    fmt.Printf("A: size=%d, &a.a=%p, &a.b=%p\n",
        unsafe.Sizeof(a), &a.a, &a.b)
    fmt.Printf("P: size=%d, &p.a=%p, &p.b=%p\n",
        unsafe.Sizeof(p), &p.a, &p.b)

    fmt.Printf("A: line(a.a)=%d line(a.b)=%d\n",
        uintptr(unsafe.Pointer(&a.a))/64,
        uintptr(unsafe.Pointer(&a.b))/64)
    fmt.Printf("P: line(p.a)=%d line(p.b)=%d\n",
        uintptr(unsafe.Pointer(&p.a))/64,
        uintptr(unsafe.Pointer(&p.b))/64)
}
```

Expected: A's fields on same line; P's on different lines.

---

### Task 4 sketch

```go
package counter

import (
    "runtime"
    "sync/atomic"
)

type shard struct {
    v atomic.Int64
    _ [56]byte
}

type Counter struct {
    shards []shard
}

func New() *Counter {
    return &Counter{shards: make([]shard, runtime.GOMAXPROCS(0))}
}

func (c *Counter) Inc(shardID int) {
    c.shards[shardID%len(c.shards)].v.Add(1)
}

func (c *Counter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].v.Load()
    }
    return s
}
```

Benchmark with 1-shard case (set GOMAXPROCS=1 or hardcode 1 shard) vs N-shard case.

---

### Task 7 sketch

```go
package ring

import "sync/atomic"

type Ring struct {
    mask uint64
    buf  []byte

    head atomic.Uint64
    _    [56]byte

    tail atomic.Uint64
    _    [56]byte
}

func New(size int) *Ring {
    if size&(size-1) != 0 {
        panic("size must be power of 2")
    }
    return &Ring{mask: uint64(size - 1), buf: make([]byte, size)}
}

func (r *Ring) Push(b byte) bool {
    h := r.head.Load()
    t := r.tail.Load()
    if h-t >= uint64(len(r.buf)) {
        return false
    }
    r.buf[h&r.mask] = b
    r.head.Store(h + 1)
    return true
}

func (r *Ring) Pop() (byte, bool) {
    t := r.tail.Load()
    h := r.head.Load()
    if t == h {
        return 0, false
    }
    b := r.buf[t&r.mask]
    r.tail.Store(t + 1)
    return b, true
}
```

---

### Task 16 sketch

```go
package perp

import (
    _ "unsafe"
)

//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

type shard struct {
    n int64
    _ [56]byte
}

type Counter struct {
    shards []shard
}

func New(n int) *Counter {
    return &Counter{shards: make([]shard, n)}
}

func (c *Counter) Inc() {
    p := runtime_procPin()
    c.shards[p].n++ // no atomic; pinned to P
    runtime_procUnpin()
}

func (c *Counter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].n
    }
    return s
}
```

Caveats: `n` is not atomic; readers may see torn values during a writer's update. For exact reads, use atomic.LoadInt64.

---

### Task 19 sketch

```go
package hier

import (
    "runtime"
    "sync/atomic"
    "time"
)

type Counter struct {
    perCore []paddedInt64
    perNuma []paddedInt64
    global  atomic.Int64
}

type paddedInt64 struct {
    v atomic.Int64
    _ [56]byte
}

func New(numNuma int) *Counter {
    c := &Counter{
        perCore: make([]paddedInt64, runtime.GOMAXPROCS(0)),
        perNuma: make([]paddedInt64, numNuma),
    }
    go c.flusher()
    return c
}

func (c *Counter) Inc(coreID int) {
    c.perCore[coreID%len(c.perCore)].v.Add(1)
}

func (c *Counter) Value() int64 {
    return c.global.Load()
}

func (c *Counter) flusher() {
    for {
        time.Sleep(10 * time.Millisecond)
        for i := range c.perCore {
            v := c.perCore[i].v.Swap(0)
            // place numa mapping logic here
            c.perNuma[i%len(c.perNuma)].v.Add(v)
        }
        var total int64
        for i := range c.perNuma {
            total += c.perNuma[i].v.Swap(0)
        }
        c.global.Add(total)
    }
}
```

Each level halves the write-frequency by absorbing batches. Memory and lag are tunable.

---

## Discussion of solutions

These tasks cover the practical workflow: reproduce, measure, fix, verify, optimise. Working through them in order builds:

1. **Eye for layout**: recognising what fits on a cache line by inspection.
2. **Benchmark discipline**: writing tests that *show* contention rather than hide it.
3. **Tool fluency**: using `perf c2c`, `unsafe.Sizeof`, and pprof to diagnose.
4. **Data-structure intuition**: knowing when to pad, when to shard, when to do nothing.
5. **Production design**: hierarchical, NUMA-aware, with bounded read lag.

After completing all 20 tasks, you should be able to design a high-throughput Go service that scales linearly with cores and resist false-sharing regressions in code review.
