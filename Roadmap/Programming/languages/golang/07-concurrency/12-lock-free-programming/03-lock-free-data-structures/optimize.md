# Lock-Free Data Structures — Optimisation

## Table of Contents
1. [Introduction](#introduction)
2. [Eliminate False Sharing First](#eliminate-false-sharing-first)
3. [Batching and Amortisation](#batching-and-amortisation)
4. [Sharding](#sharding)
5. [Backoff Strategies](#backoff-strategies)
6. [Reducing Allocations](#reducing-allocations)
7. [Cache-Conscious Layout](#cache-conscious-layout)
8. [When Lock-Free Is Not the Bottleneck](#when-lock-free-is-not-the-bottleneck)
9. [Concrete Case Studies](#concrete-case-studies)
10. [Summary](#summary)

---

## Introduction

Optimising a lock-free data structure is different from optimising a mutex-protected one. The mutex version has obvious knobs: reduce critical-section length, increase parallelism by sharding, use `RWMutex` for reads. The lock-free version has subtler knobs: cache-line layout, retry strategies, batching, allocation reduction. The wrong optimisation can erase the correctness argument or destroy the throughput gain that motivated the lock-free design.

This file lays out the optimisations that pay off, the ones that mislead, and the discipline of measuring before tuning. Every section assumes you have profiled and identified the lock-free structure as a real bottleneck.

---

## Eliminate False Sharing First

False sharing is the single highest-leverage optimisation for lock-free structures. It costs nothing in code complexity and routinely buys 3-10x throughput.

### How to find it

`perf c2c` on Linux:

```bash
perf c2c record -F 999 ./benchmark
perf c2c report --stdio
```

Look for the "Shared Data Cache Line Table." Cache lines with high `HitM` (hit-modified, i.e., remote cache invalidation) counts and many distinct accessing functions are false-sharing victims.

On macOS, `xctrace` or Instruments' "Counters" template provides similar signals. On Windows, `vtune` works.

### How to fix it

Pad between independently-written atomic fields. The pad size matches the cache line:

- x86 Intel/AMD: 64 bytes.
- Apple M-series: 128 bytes.
- Older ARM: 64.

Use the conservative 128-byte pad if your code may run on Apple silicon.

```go
const cacheLine = 64 // adjust for ARM

type Counters struct {
    a atomic.Int64
    _ [cacheLine - 8]byte
    b atomic.Int64
    _ [cacheLine - 8]byte
}
```

### Verify with `unsafe.Offsetof`

Padding bugs sneak in when fields are added. Assert layout in tests:

```go
func TestLayout(t *testing.T) {
    var c Counters
    if d := unsafe.Offsetof(c.b) - unsafe.Offsetof(c.a); d < cacheLine {
        t.Fatalf("a and b share a cache line: distance %d", d)
    }
}
```

### When padding does not help

If `head` and `tail` are written by the *same* goroutine (e.g. SPSC consumer popping at a head it just wrote), there is no inter-core invalidation, and padding is wasted. The pad still costs memory; for a small structure that is fine, for a million-element array it is not.

Profile first. Apply pads only between fields written by different cores.

---

## Batching and Amortisation

Lock-free per-op overhead has fixed costs: atomic load, atomic store, branch, memory ordering. Batching amortises these costs across multiple logical operations.

### Batch enqueue / dequeue

```go
func (q *Queue[V]) EnqueueBatch(vs []V) int {
    if len(vs) == 0 {
        return 0
    }
    // Build a linked chain locally.
    first := &qnode[V]{val: vs[0]}
    last := first
    for _, v := range vs[1:] {
        n := &qnode[V]{val: v}
        last.next.Store(n)
        last = n
    }
    // Splice in with a single tail.Swap (Vyukov MPSC) or two CASes (MS-queue).
    prev := q.tail.Swap(last)
    prev.next.Store(first)
    return len(vs)
}
```

For Vyukov MPSC, this turns N producer ops into one atomic Swap plus one atomic Store. Ten-fold throughput gains are common when callers can batch.

### Batch dequeue

```go
func (q *SPSC[V]) PopBatch(out []V) int {
    head := q.head.Load()
    tail := q.tail.Load()
    avail := tail - head
    if avail == 0 {
        return 0
    }
    n := uint64(len(out))
    if avail < n {
        n = avail
    }
    for i := uint64(0); i < n; i++ {
        out[i] = q.buf[(head+i)&q.mask]
    }
    q.head.Store(head + n)
    return int(n)
}
```

A consumer that drains in batches of 32-64 instead of singletons sees 3-5x throughput, because the loop body amortises the atomic op cost across the batch.

### Where batching backfires

Latency-sensitive workloads. If consumers must process each item within 1 microsecond of enqueue, batching delays the second-and-onwards items in a batch by the batch's processing time. Decide whether throughput or latency dominates your SLA.

---

## Sharding

The most reliable scalability optimisation is to remove the shared hot spot. Sharding turns a contended structure into N independent structures.

### Single counter to sharded counter

Already shown in middle.md and senior.md. The pattern:

- N shards, N = `GOMAXPROCS` or a power of two slightly larger.
- Each shard padded to its own cache line.
- Shard index from `procPin` (best) or a hash of stack address (cheap).

Scales linearly to dozens of cores. The trade-off: `Sum()` is O(N), and the snapshot is approximate.

### Single stack to sharded stack

```go
type ShardedStack[V any] struct {
    shards []padded[Stack[V]]
}

type padded[T any] struct {
    v T
    _ [128 - unsafe.Sizeof(*new(T))%128]byte
}

func (s *ShardedStack[V]) Push(v V) {
    i := shardIdx() & (len(s.shards) - 1)
    s.shards[i].v.Push(v)
}

func (s *ShardedStack[V]) Pop() (V, bool) {
    start := shardIdx() & (len(s.shards) - 1)
    for i := 0; i < len(s.shards); i++ {
        j := (start + i) & (len(s.shards) - 1)
        if v, ok := s.shards[j].v.Pop(); ok {
            return v, true
        }
    }
    var zero V
    return zero, false
}
```

The Pop walks all shards in order, starting from the caller's preferred shard. Strict LIFO is lost across shards; that is the price.

This is how `sync.Pool` works internally.

### Single queue to sharded queue

Harder to do without losing FIFO order. The pragmatic answer: shard by key (each shard has its own queue), accepting that order is preserved only within a shard. Many workloads (per-key event streams, per-connection messages) naturally fit.

For a true FIFO global queue, sharding does not apply. Use a single lock-free MPMC.

### Power-of-two shards

If shards are a power of two, you can use a bitmask instead of `%`:

```go
i := shardIdx() & (numShards - 1)
```

Bitmask is single-cycle; `%` is 20+ cycles. On a hot path this matters.

---

## Backoff Strategies

Under heavy contention, a CAS loop can burn CPU on retries. Backoff lets contending threads space out their attempts.

### Exponential backoff

```go
delay := 1
for {
    if s.head.CompareAndSwap(old, new) {
        return
    }
    for i := 0; i < delay; i++ {
        _ = i // tight spin
    }
    if delay < 1024 {
        delay *= 2
    }
}
```

This trades a few extra ns on the first retry for reduced cache traffic. Java's `j.u.c.atomic` uses something like this internally.

### When backoff is wrong

In Go, the cleanest backoff is `runtime.Gosched()` — but it yields to the scheduler, not the OS. On a single-P workload, it spins tighter. On a many-P workload, it spaces threads out.

A real sleep (`time.Sleep`) is too coarse: minimum granularity is microseconds, and waking up adds latency.

The practical default: no backoff. Add backoff only when profiling shows the CAS loop is spinning and the structure is genuinely contended.

### Backoff plus sharding

If you find yourself adding backoff, ask first whether sharding is feasible. Sharding removes contention; backoff just slows down contending threads. Removal beats mitigation.

---

## Reducing Allocations

Lock-free structures often allocate one node per push. At millions of ops/sec, this is significant GC pressure.

### Per-P object pool

```go
var nodePool = sync.Pool{
    New: func() any { return &node[int]{} },
}

func (s *Stack[V]) Push(v V) {
    n := nodePool.Get().(*node[V])
    n.val = v
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}

func (s *Stack[V]) Pop() (V, bool) {
    for {
        top := s.head.Load()
        if top == nil {
            var zero V
            return zero, false
        }
        if s.head.CompareAndSwap(top, top.next) {
            v := top.val
            top.next = nil
            var zero V
            top.val = zero
            nodePool.Put(top)
            return v, true
        }
    }
}
```

The pool eliminates per-op allocation in steady state. The cost: a small amount of bookkeeping and one extra cache touch per op.

**Caveat.** `sync.Pool` is cleared on every GC. Heavy reuse only works if your op frequency keeps the pool warm. Verify with `-benchmem`.

### Pre-allocated node arena

For very latency-sensitive paths, allocate a fixed array of nodes at startup and manage a free list:

```go
type Arena[V any] struct {
    nodes []node[V]
    free  atomic.Pointer[node[V]] // freelist head
}
```

This is a lock-free freelist (a Treiber stack of free nodes) feeding into another lock-free structure. The double indirection is real, but allocations are zero.

Used in trading systems and real-time embedded code. For typical Go services, `sync.Pool` is enough.

### Inline values

If your structure stores `V` directly and `V` is small (an int, a pointer, a small struct), the node itself is the only allocation. If `V` is large, consider storing `*V` and pooling separately.

If `V` is a pointer, the structure is already small per node; no further optimisation here.

---

## Cache-Conscious Layout

Beyond false sharing, several layout choices affect performance.

### Hot fields first

The first field of a struct is at offset 0, which is the most cache-friendly location. Put the most-frequently-accessed field first.

```go
type Queue[V any] struct {
    head atomic.Pointer[qnode[V]]   // hot
    _    [56]byte
    tail atomic.Pointer[qnode[V]]   // hot
    _    [56]byte
    // ... metadata, less hot
}
```

### Pack hot atomic fields by access pattern

If two fields are always accessed together (e.g. `(head, head.next)`), placing them on the same cache line is *good* — it is the opposite of false sharing. Co-access is positive; concurrent independent writes are negative.

The art of cache-conscious layout: co-locate co-accessed fields; separate independently-written fields.

### Prefetching

In a hot loop, prefetching the next cache line can hide memory latency:

```go
for n := list.head; n != nil; n = n.next {
    if n.next != nil {
        runtime.KeepAlive(n.next.val) // weak prefetch
    }
    process(n.val)
}
```

Go does not expose a true prefetch intrinsic. A workaround is to access the next node's field to bring it into cache, but the cost-benefit is rarely worth the code complexity.

For most Go code, skip prefetching. For high-frequency trading and packet processing, prefetching can buy 10-20% — measure first.

### Array-backed vs pointer-linked

An array-backed structure (Vyukov MPMC, SPSC ring) has better cache locality than a pointer-linked structure (Treiber stack, MS-queue, Harris list) because consecutive elements are adjacent in memory. Sequential traversal hits the prefetcher's sweet spot.

If your workload mostly traverses (e.g. drain-all on shutdown), prefer array-backed. If your workload is mostly random push/pop on a single element, pointer-linked may be fine.

---

## When Lock-Free Is Not the Bottleneck

The biggest optimisation is recognising that lock-free is not the right target.

### Profile first

Run `pprof` for CPU. If the lock-free structure's methods are less than 10% of total CPU, optimising them buys at most 10%. The win is bounded by what the bottleneck is.

```bash
go test -cpuprofile=cpu.prof -bench=.
go tool pprof cpu.prof
(pprof) top
```

If `*Queue.Enqueue` is at 30% of CPU, you have a real candidate. If it is at 3%, look elsewhere.

### Look outside the structure

Common surrounding bottlenecks:

- Serialisation (JSON, Protobuf) of values being enqueued. Often dwarfs queue overhead.
- Network or disk I/O at the consumer. The lock-free queue is fast; the consumer is the limit.
- GC pause times. The structure may allocate fine, but the GC is the wall.
- Lock contention elsewhere — a `sync.Mutex` two functions up the call stack.

A 5% improvement in the lock-free structure does not help if 95% of time is spent in JSON serialisation.

### Compare to a mutex

Always benchmark your lock-free structure against a mutex-protected equivalent at your real workload. If the mutex is within 30%, you may be optimising the wrong thing. The mutex is much easier to maintain, debug, and reason about.

The hardest discipline: when your lock-free structure is faster than a mutex by less than the complexity premium it demands, ship the mutex. "Complexity premium" is roughly two engineering-weeks per year of maintenance — that is, the expected debug cost.

---

## Concrete Case Studies

### Case 1. Vyukov MPMC tuning for low-latency trading.

Starting design: Vyukov MPMC with default 1024 cells, no padding except between position counters.

Step 1: `perf c2c` shows the cell array contended on the boundary between consumer-touched and producer-touched cells. Each cell is 16 bytes; multiple cells per cache line.

Step 2: Inflate cell size to 64 bytes (one cell per cache line). Memory cost: 4x. Throughput: 1.6x.

Step 3: Capacity 1024 -> 8192. Reduces wraparound contention. Throughput: 1.1x.

Step 4: Pin producer goroutines to one socket, consumer to another. NUMA-aware. Throughput: 1.3x.

Net: 2.3x improvement. Memory: 4x. Worth it for a system where every nanosecond is dollars.

### Case 2. Logging library — pure GC to per-P MPSC.

Starting design: log lines pushed via buffered channel.

Step 1: Profile shows channel send is 35% of producer CPU at 5M lines/sec.

Step 2: Replace with one Vyukov MPSC. Producer-side time drops from 200 ns/op to 80 ns/op. Total throughput: 1.5x.

Step 3: Per-P MPSCs (16 of them on a 16-core machine). Producer-side time drops to 25 ns/op. Throughput: 4x over channel baseline.

Step 4: `sync.Pool`-backed log buffers. Allocations per log line: 1 -> 0 in steady state. P99 latency drops by 60%.

Step 5: Tested rolling back. Concluded benefits worth the complexity.

### Case 3. Custom Treiber stack reverted to mutex.

Starting design: Treiber stack for free-list management in a custom allocator.

Step 1: Microbenchmarks show 30% improvement over mutex at 8 cores.

Step 2: Production profile shows the allocator is at 2% of CPU; lock-free wins 0.6% of total.

Step 3: Discovered an ABA-flavoured bug in the unsafe.Pointer manipulation. Took two weeks to find.

Step 4: Reverted to `sync.Mutex` + slice. Lost 0.6%; gained debuggability and a clean conscience.

Lesson: optimisation that does not address a real bottleneck is technical debt. Microbenchmarks lie about production.

### Case 4. SPSC ring buffer for audio.

Starting design: lock-free SPSC ring buffer, 4096 slots, padded.

Step 1: Audio thread has hard 5 ms deadline. Lock-free SPSC chosen because mutex acquisition could pause it past the deadline.

Step 2: `PopBatch` returns up to 64 frames per call. Reduces per-frame overhead by 30%.

Step 3: Producer thread also batched, prebuilds chunks of 64 frames before pushing.

Step 4: Padding to 128 bytes (target hardware includes M1).

Net: stable 0.5 ms latency under all load. Mutex version would not meet the deadline guarantee.

---

## Summary

Lock-free optimisation has a small set of high-leverage techniques:

1. **Eliminate false sharing.** Almost always the highest-impact fix. Pad to 128 bytes if uncertain about target hardware.
2. **Batch operations.** Amortises per-op overhead across many logical operations. 3-5x throughput is common.
3. **Shard.** Replace one contended structure with N independent ones. Linear scaling to many cores.
4. **Pool allocations.** `sync.Pool`-backed nodes eliminate per-op GC pressure.
5. **Cache-conscious layout.** Co-locate co-accessed fields; separate independently-written fields.
6. **Backoff sparingly.** Only when profiling demands it; sharding is usually a better answer.

The discipline that matters more than any technique: profile before optimising, and compare against a mutex baseline. Lock-free wins are narrow. The cost of getting it wrong is high. Optimise only when the data demands it, and roll back when the data does not justify the complexity.

The honest verdict from a decade of lock-free production code: the optimisations that pay off are mostly about cache lines, not algorithms. The papers are settled; the engineering is in the layout, the padding, the batching, and the relentless willingness to walk back from lock-free when a mutex is good enough.

---

## Related Topics

- [01-cas-algorithms](../01-cas-algorithms/) — CAS, the universal primitive
- [02-aba-problem](../02-aba-problem/) — ABA and the GC's role
- [04-memory-fences](../04-memory-fences/) — Memory ordering
- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Progress hierarchy
- [03-sync-package/05-pool](../../03-sync-package/05-pool/) — `sync.Pool` for allocation reduction
