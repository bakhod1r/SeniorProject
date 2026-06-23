---
layout: default
title: Hardware Barriers — Optimize
parent: Hardware Barriers
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/01-hardware-barriers/optimize/
---

# Hardware Memory Barriers — Optimize

> Scenarios where replacing a strong barrier with a weaker one, restructuring access patterns, or eliminating contention yields measurable speedup.

---

## Scenario 1 — Padding a hot counter to prevent false sharing

**Before:**
```go
type Counters struct {
    a atomic.Int64
    b atomic.Int64
    c atomic.Int64
    d atomic.Int64
}
```

All four counters live on a single 64-byte cache line. Goroutines updating different counters cause RFO ping-pong.

**After:**
```go
type Counters struct {
    a atomic.Int64
    _ [56]byte
    b atomic.Int64
    _ [56]byte
    c atomic.Int64
    _ [56]byte
    d atomic.Int64
    _ [56]byte
}
```

Each counter on its own line.

**Expected gain.** 5-20x throughput improvement under contention, depending on core count and update rate.

**Verification.** Run a benchmark with multiple goroutines, each pinned to a counter. Compare ops/sec.

---

## Scenario 2 — Per-CPU sharding instead of a single atomic

**Before:** Single global counter `atomic.Int64`. All goroutines `Add(1)` to it.

```go
var counter atomic.Int64

func bump() { counter.Add(1) }
```

Under heavy contention, every Add suffers TSO replays and cache-coherence overhead.

**After:** Per-P sharding. Each P (processor) has its own counter; sum on read.

```go
type ShardedCounter struct {
    shards []paddedInt64
}

type paddedInt64 struct {
    n atomic.Int64
    _ [56]byte
}

func New() *ShardedCounter {
    return &ShardedCounter{shards: make([]paddedInt64, runtime.GOMAXPROCS(0))}
}

func (c *ShardedCounter) Add(d int64) {
    pid := runtime_procPin()
    c.shards[pid].n.Add(d)
    runtime_procUnpin()
}

func (c *ShardedCounter) Sum() int64 {
    var total int64
    for i := range c.shards {
        total += c.shards[i].n.Load()
    }
    return total
}
```

**Expected gain.** Near-linear scaling with cores. At 16 cores under heavy contention, single atomic.Add may hit ~5M ops/sec; sharded version hits ~150M+.

**Tradeoff.** Reads are O(N_cores). For mostly-write workloads, this is fine.

---

## Scenario 3 — `atomic.Pointer[T]` snapshot instead of `sync.RWMutex`

**Before:**
```go
type Cache struct {
    mu sync.RWMutex
    data map[string]string
}

func (c *Cache) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.data[k]
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data[k] = v
}
```

Each read takes a read-lock and unlock — atomic operations with full barriers.

**After (for read-mostly):**
```go
type Cache struct {
    data atomic.Pointer[map[string]string]
}

func (c *Cache) Get(k string) string {
    return (*c.data.Load())[k]
}

func (c *Cache) Set(k, v string) {
    for {
        oldMap := c.data.Load()
        newMap := make(map[string]string, len(*oldMap)+1)
        for kk, vv := range *oldMap { newMap[kk] = vv }
        newMap[k] = v
        if c.data.CompareAndSwap(oldMap, &newMap) {
            return
        }
    }
}
```

**Expected gain.** Reads become a single atomic.Pointer.Load — extremely cheap. 5-10x improvement on read throughput for read-heavy workloads.

**Tradeoff.** Writes are now O(N) due to map copy. Only worth it for read-mostly.

---

## Scenario 4 — Batch atomic Add inside a loop

**Before:**
```go
for i := 0; i < n; i++ {
    counter.Add(1)
}
```

Each iteration: 20+ cycle atomic Add.

**After:**
```go
counter.Add(int64(n))
```

Single atomic Add at the end.

**Expected gain.** Up to N× speedup for the loop's atomic cost. If `n = 1000`, you save ~20,000 cycles (5 µs on a 4 GHz CPU).

---

## Scenario 5 — Avoid `runtime.GOMAXPROCS` calls in hot paths

**Before:**
```go
func work() {
    for i := 0; i < runtime.GOMAXPROCS(0); i++ {
        ...
    }
}
```

`GOMAXPROCS(0)` is a function call that includes atomic operations.

**After:**
```go
var nProc = runtime.GOMAXPROCS(0)

func work() {
    for i := 0; i < nProc; i++ {
        ...
    }
}
```

Cache the result; recompute only on `GOMAXPROCS` change.

**Expected gain.** Modest, but in a tight loop it adds up.

---

## Scenario 6 — `Store` followed by full-barrier is redundant

If you're writing CGo / assembly that explicitly emits an MFENCE after an atomic Store:

**Before:** `XCHGL` + `MFENCE`. Two full barriers.

**After:** Just `XCHGL`. The XCHGL already drains the store buffer.

**Expected gain.** ~30 cycles saved per such sequence.

---

## Scenario 7 — Replace `sync.Mutex` lock/unlock with `atomic` when lock is uncontended

**Before:** A `sync.Mutex` Lock+Unlock around a single integer update.

```go
mu.Lock()
counter++
mu.Unlock()
```

Mutex Lock/Unlock pair: 2 atomic ops (uncontended case) plus function-call overhead, even for the fast path.

**After:**
```go
atomic.AddInt64(&counter, 1)
```

Single atomic op.

**Expected gain.** 2-3x for the operation; more if the mutex was contended (since AddInt64 doesn't park).

---

## Scenario 8 — `sync.Pool` instead of `sync.Mutex`-protected pool

**Before:**
```go
var (
    pool []Buffer
    mu   sync.Mutex
)

func get() Buffer {
    mu.Lock()
    defer mu.Unlock()
    if len(pool) == 0 {
        return newBuffer()
    }
    b := pool[len(pool)-1]
    pool = pool[:len(pool)-1]
    return b
}
```

Single global lock = bottleneck under contention.

**After:**
```go
var pool = sync.Pool{
    New: func() interface{} { return newBuffer() },
}
```

`sync.Pool` uses per-P local pools internally. Padded to avoid false sharing.

**Expected gain.** Near-linear scaling with cores.

---

## Scenario 9 — Hot-loop: avoid `LDADDAL` if relaxed `LDADD` suffices

**Before (Go-level):** `atomic.AddInt64(&n, 1)` for a counter where you don't care about ordering with other operations — purely "increment me."

`atomic.AddInt64` is full SC: emits `LDADDAL` on arm64 LSE.

**After:** *You can't, in pure Go.* `sync/atomic` is always SC.

To get relaxed semantics, you'd need to drop into a `.s` file using `LDADD` (without `.AL`). For most workloads, the difference is small.

**Expected gain.** 10-20% on arm64 for very hot, fence-saturated loops. Not portable; not idiomatic.

---

## Scenario 10 — Reduce barrier density by reordering

Sometimes you have several atomic operations close together; you can reorder to fold barriers.

**Before:**
```go
a.Store(v1)
b.Store(v2)
c.Store(v3)
```

Three full-barrier stores; three XCHGs.

**After (only if the order doesn't matter):** Make two of them `runtime/internal/atomic.StoreRel` (release only). On x86, plain MOV; on arm64, STLR. Only the *last* one needs SC.

(Again, user code can't use `StoreRel`; you'd need to drop into assembly. This is for advanced runtime work.)

**Expected gain.** Two stores become free MOVs on x86. ~40 cycles saved.

---

That is ten scenarios with measurable optimizations. The pattern across them: identify the contention or the unnecessary fence, restructure the data or code to eliminate it, measure. The biggest wins are false-sharing fixes and per-CPU sharding; the smallest are micro-optimisations only worth doing in profiled hot paths.

Optimisation maxim for barriers: **don't avoid barriers, avoid contention.** A fence in isolation costs ~20-40 cycles; cache-line ping-pong costs 100-1000 cycles per migration. Shape your data to avoid sharing in the first place.
