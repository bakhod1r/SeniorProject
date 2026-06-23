---
layout: default
title: False Sharing — Middle
parent: False Sharing
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/05-false-sharing/middle/
---

# False Sharing — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [From Padding to Sharding](#from-padding-to-sharding)
3. [Real Production Cases](#real-production-cases)
4. [Reading the Go Runtime for Padding Patterns](#reading-the-go-runtime-for-padding-patterns)
5. [Designing a Sharded Counter Library](#designing-a-sharded-counter-library)
6. [Detection Methodology](#detection-methodology)
7. [Microbenchmark Discipline](#microbenchmark-discipline)
8. [Anti-Patterns in Production Code](#anti-patterns-in-production-code)
9. [Code Examples](#code-examples)
10. [Concurrent Data Structures and Cache Layout](#concurrent-data-structures-and-cache-layout)
11. [Memory and Cache Tradeoffs](#memory-and-cache-tradeoffs)
12. [Code Review Checklist](#code-review-checklist)
13. [Edge Cases](#edge-cases)
14. [Common Misconceptions Revisited](#common-misconceptions-revisited)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction
> Focus: "I know what false sharing is. How do I find it in real code, and how do I build production-grade structures that don't have it?"

At junior level, false sharing was an isolated bug to spot and fix. At middle level, it is a *design dimension*. Concurrent data structures, metrics libraries, lock-free queues, and per-CPU caches all live or die by cache-line layout. A small library may "work" with naive layout and still be 10x slower than necessary under load.

This file covers:

- The transition from "pad one struct" to "design a sharded subsystem."
- Real production cases: Prometheus counters, sync.Pool internals, lock-free queues.
- Detection methodology: benchmarks, `perf c2c`, hardware counters via `pprof`.
- Microbenchmark discipline: how to write benchmarks that *do* show false sharing instead of hiding it.
- Anti-patterns: things that look like false-sharing fixes but are not.

By the end you should be able to look at a struct or a slice of structs in a concurrent context and reason aloud about whether it will false-share, what the cost would be, and what the right fix is.

---

## From Padding to Sharding

### Padding solves adjacency. Sharding solves global hot spots.

These are two different problems:

**Adjacency problem.** You have N variables that are each accessed by *one* goroutine, but they happen to live next to each other in memory. The variables themselves are not shared. Padding fixes this.

**Hot-spot problem.** You have *one* variable accessed by N goroutines. The variable is shared. Padding does nothing — there is only one variable, one line. The fix is to *replace* the one variable with N variables (one per shard), each on its own line, and aggregate on read.

In production code these problems are often interleaved. A counter library might have:

- One global "total requests" counter (hot spot — needs sharding).
- An array of per-status-code counters (adjacency — needs padding).

The combined fix is sharded *and* padded: each shard is a struct that contains the per-status-code counters, sized to one or more cache lines.

### A formal sketch of the sharded counter

Goal: a counter that scales linearly with cores under write-heavy load, with cheap reads.

```go
package counter

import (
    "runtime"
    "sync/atomic"
)

const cacheLine = 64

type Shard struct {
    Total atomic.Int64
    Hits  atomic.Int64
    Miss  atomic.Int64
    _     [cacheLine - 24]byte // pad Shard to 64 bytes
}

type Counter struct {
    shards []Shard
}

func New() *Counter {
    n := runtime.GOMAXPROCS(0)
    return &Counter{shards: make([]Shard, n)}
}

// Inc adds 1 to the per-shard Total. Caller chooses the shard.
func (c *Counter) Inc(shard int) {
    c.shards[shard%len(c.shards)].Total.Add(1)
}

// IncHit adds 1 to the per-shard Hits.
func (c *Counter) IncHit(shard int) {
    c.shards[shard%len(c.shards)].Hits.Add(1)
}

// Total aggregates shards on demand.
func (c *Counter) Total() int64 {
    var t int64
    for i := range c.shards {
        t += c.shards[i].Total.Load()
    }
    return t
}
```

A few details to notice:

1. The shard count is `runtime.GOMAXPROCS(0)`. This is the *maximum* number of cores that may concurrently write — so per-core padding is enough.

2. `Shard` is sized to exactly one cache line. The `[40]byte` padding (here `[cacheLine - 24]byte`, since the three atomic.Int64s take 24 bytes) keeps each shard at exactly 64 bytes.

3. Writes hash to a shard. The hash can be `goroutine % N`, `time.Now().UnixNano() % N`, `runtime_procPin` (advanced), or a caller-provided shard ID.

4. Reads sum all shards. Cost is O(N) atomic loads; trivial at N = 16 or 32.

This is the kernel of nearly every production sharded counter. Variants exist — adaptive shard counts, hierarchical aggregation, NUMA-aware shards — but the core idea is the same.

### Why not just use one `atomic.Int64`?

It is correct. It is just slow under contention. A single `atomic.Int64` updated by 8 cores at peak rate runs at single-core speed (~5-30 ns/op depending on contention). A sharded counter at the same rate runs at near-zero coordination cost, 8x or more faster.

### Why not use a mutex?

A `sync.Mutex` is roughly 3x slower than an uncontended atomic and serialises *all* writers. Throughput is independent of cores. For low-rate counters this is fine. For high-rate counters (millions of updates/sec), it is a bottleneck.

### Why not use channels?

Channels are great for *transferring ownership* of work. They are too heavy for incrementing a counter — a channel send is hundreds of nanoseconds, vs ~5 ns for an atomic op. Use channels for communication; use atomics for counters.

---

## Real Production Cases

### Case 1: `sync.Pool`'s `poolLocal`

`sync.Pool` is Go's per-P object cache. Its internal structure is, roughly:

```go
type Pool struct {
    local     unsafe.Pointer // *[P]poolLocal
    localSize uintptr        // size of the *poolLocal array
    // ... rest omitted ...
}

type poolLocal struct {
    poolLocalInternal
    pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}

type poolLocalInternal struct {
    private any         // can only be used by the respective P
    shared  poolChain   // local P can pushHead/popHead; any P can popTail
}
```

The padding is to 128 bytes (not 64). Why? Because some Intel CPUs use *two adjacent* 64-byte lines as a "cache line pair" for prefetching. Padding to 128 protects against false sharing from the *prefetcher*, not just from explicit cache-line coherence.

The comment in the Go source (paraphrased): "128 bytes provides immunity from adjacent-cache-line prefetching." This is the kind of detail that justifies reading the Go runtime — it teaches you about hardware quirks that no general programming text mentions.

### Case 2: the per-P run queue

In `runtime/runtime2.go`, the per-processor (per-P) run queue uses padded indices:

```go
type p struct {
    // ... many fields ...
    runqhead uint32
    runqtail uint32
    runq     [256]guintptr
    // ... more fields ...
}
```

In modern Go versions (1.20+), the runqueue is laid out so that runqhead and runqtail are far enough apart in the larger `p` struct to not interfere. Older versions used explicit `sys.CacheLinePad`. The pattern is the same: producer (the local P) updates `runqtail`; consumer (other Ps work-stealing) updates `runqhead`. If they false-shared, the scheduler would slow down.

### Case 3: the memory allocator's `mcache`

Each P has an `mcache` of small-object spans. The mcache contains per-size-class allocation state. The runtime arranges these caches to be naturally cache-line-aligned (since each mcache is one full allocation), and pads internal fields where needed.

Reading `runtime/mcache.go` shows how the allocator avoids false sharing among per-P caches: each cache is its own allocation, never interleaved with another P's cache.

### Case 4: Prometheus client `Counter`

The `github.com/prometheus/client_golang` library has gone through several iterations of its `Counter` type. Early versions used a single `atomic.Int64`. Later versions added optional sharding for high-throughput counters. The library's documentation explicitly mentions the contention tradeoff: for counters incremented millions of times per second, sharding (with cache-line padding) is essential; for counters incremented hundreds of times per second, single atomics are fine.

### Case 5: Cilium's per-CPU map data structures

Cilium (and Kubernetes' eBPF-based components) use per-CPU eBPF maps. The Go userspace counterparts often mirror this with per-CPU sharded counters. The eBPF map *is* per-CPU at the kernel level; the Go-side aggregator reads each CPU's value separately.

### Case 6: Go's `expvar` package

`expvar` exposes named variables for introspection. It uses a single `sync.Map` internally for the registry, but the *values* (`*Int`, `*Float`, etc.) are single-atomic. Hot `expvar` counters in metric-heavy code can become bottlenecks. The mitigation in production is usually to wrap `expvar` in a sharded layer or to use a different metrics library.

### Case 7: ring-buffer logger (e.g. uber-go/zap's sampler)

High-throughput structured loggers use lock-free ring buffers internally. The producer and consumer indices are padded; the actual entries are not (they are written by one core at a time per slot). zap's sampler uses per-CPU sharded sample counters to avoid contention.

### Case 8: high-cardinality rate limiters

A naive token-bucket rate limiter has a single `atomic.Int64` of available tokens. Under heavy contention, this is the entire bottleneck. Production rate limiters either:

1. Use per-CPU buckets, refilling each independently.
2. Use a single bucket protected by a `sync.Mutex` (sometimes faster than the atomic version because it serialises one writer at a time without coherence storms).
3. Use a hierarchical structure: per-CPU buckets backed by a global one for borrowing.

The right answer depends on your tolerance for "burst error" (per-CPU buckets can let a transient spike through that a global bucket would have blocked).

---

## Reading the Go Runtime for Padding Patterns

To internalise false-sharing avoidance, read the Go runtime. Useful files:

- `runtime/internal/sys/intrinsics.go` — defines `CacheLinePad` and `CacheLineSize`.
- `runtime/sync_pool.go` — defines `poolLocal` with explicit padding.
- `runtime/runtime2.go` — defines `p` (per-P struct) with hot fields and (sometimes) padding.
- `runtime/mcache.go` — per-P allocator cache.
- `runtime/proc.go` — scheduler. Look for `sys.CacheLinePad` usage in struct definitions.
- `runtime/sema.go` — semaphore implementation, with treap nodes that pad to avoid contention.
- `runtime/lockrank_*.go` — lock-rank table, often aligned.

Searching the runtime for `CacheLinePad`:

```
$ grep -rn "CacheLinePad" /usr/local/go/src/runtime/
runtime/internal/sys/intrinsics.go:23:type CacheLinePad struct{ _ [CacheLineSize]byte }
runtime/proc.go:NNN:    pad [sys.CacheLineSize]byte
... (a handful of hits in scheduler, allocator, semaphore code) ...
```

Reading the surrounding code teaches you *why* each padding exists. The runtime is well-commented; you can usually find a one-line justification near every padded field.

### Quirk: `CacheLineSize` is conservative

The Go runtime sets `CacheLineSize` based on conservative defaults:

```go
// runtime/internal/sys (paraphrased)
const CacheLineSize = 64 // on amd64, arm64
const CacheLineSize = 128 // on ppc64, ppc64le
const CacheLineSize = 32 // on mips, mipsle (some)
```

These are *coherence granularity* values — what the hardware uses for MESI. They are not always the *prefetch* granularity, which can be larger (Intel L2 prefetches in 128-byte chunks). For maximum safety on x86, pad to 128, not 64. The runtime errs on the side of 64 because the additional padding for 128 doubles memory cost for marginal real-world gain.

---

## Designing a Sharded Counter Library

Suppose you are writing a metrics library for an internal service. Requirements:

- Hot-path increment: O(constant), no contention.
- Read: at most O(numShards), called infrequently.
- Correctness: monotonic, no lost updates.
- Memory: bounded; should not grow with traffic.

### Step 1: pick a shard count

Default: `runtime.GOMAXPROCS(0)`. This guarantees one shard per core, so writes from different cores hit different shards. If `GOMAXPROCS` changes at runtime (rare, but possible via `runtime.GOMAXPROCS(n)`), the shard count is fixed at counter creation time — you do not dynamically grow shards.

For applications with more goroutines than cores, multiple goroutines may hit the same shard. That is fine; the shard's atomic is fast enough to serve many goroutines, as long as they are not all on the same core simultaneously.

### Step 2: pick a shard selector

Three common choices:

- **Caller-supplied shard ID.** Simplest. The caller passes a hint (often a hashed key) that maps to a shard. Forces the caller to think about distribution.
- **Goroutine ID modulo N.** No public API in Go to get the goroutine ID, but you can read it from the runtime stack with `runtime.Stack`. Slow (μs); not viable for hot paths.
- **Per-P pinning via `runtime_procPin` (linkname'd).** Pins the goroutine to its current P for the duration of one increment. Fast (~5 ns). The right tool but requires `go:linkname`.

The professional-level file goes into `runtime_procPin`. At middle level, design for "caller-supplied shard ID" and assume the caller is wise.

### Step 3: pick a layout

```go
type shardEntry struct {
    counters [numFields]atomic.Int64
    _        [cacheLine - numFields*8]byte // pad to cache line
}

type Counter struct {
    shards []shardEntry
}
```

If `numFields*8 < cacheLine`, the padding is positive and the struct fits in one line. If `numFields*8 == cacheLine`, no padding is needed (the struct is already exactly one line). If `numFields*8 > cacheLine`, you may need to pad to two lines, but consider whether the multi-counter struct itself is the right granularity.

### Step 4: write a unit-test for the layout

```go
func TestShardEntrySize(t *testing.T) {
    got := unsafe.Sizeof(shardEntry{})
    if got%cacheLine != 0 {
        t.Fatalf("shardEntry size = %d, not a multiple of %d", got, cacheLine)
    }
}
```

If someone adds a field without updating the padding, this fails immediately.

### Step 5: write a contention benchmark

```go
func BenchmarkCounterParallel(b *testing.B) {
    c := New()
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        // pb.ParallelN() is a per-goroutine identifier; we use a hash
        // for shard selection. In real code, prefer caller-supplied.
        shard := fastrandShard()
        for pb.Next() {
            c.Inc(shard)
        }
    })
}
```

Run with `-cpu=1,2,4,8,16`. The throughput per goroutine should stay roughly constant as you add cores. If it drops, you have residual contention.

### Step 6: document

A user who sees `Inc(shardID int)` should know: "Pass a stable hash of your goroutine's identity or the request's key. Different shards write in parallel." Document the read cost: "Total() is O(shards), do not call in hot loops."

---

## Detection Methodology

### Method 1: scaled benchmarks

The simplest detection. Write a benchmark that takes the number of goroutines as input. Plot ns/op vs goroutines. If the curve flattens or rises with more goroutines, you have contention. If switching to padded layout flattens it, you had false sharing.

```go
func benchN(b *testing.B, n int) {
    var wg sync.WaitGroup
    wg.Add(n)
    each := b.N / n
    for i := 0; i < n; i++ {
        go func(id int) {
            defer wg.Done()
            for j := 0; j < each; j++ {
                // operation under test
            }
        }(i)
    }
    wg.Wait()
}
```

Use `b.SetParallelism` or `RunParallel` for more idiomatic versions.

### Method 2: `perf c2c`

Linux's `perf` tool has a `c2c` (Cache-to-Cache) subcommand:

```
$ perf c2c record ./yourbinary
$ perf c2c report
```

The report lists cache lines by HITM count. Lines with high HITM and contributions from multiple cores are the hot bouncing lines. For each line, perf shows the offending source-file:line — often a giveaway.

`perf c2c` is the gold standard. It is the tool that, once learned, lets you find false sharing in 5 minutes that would take days otherwise.

### Method 3: hardware counters via `pprof`

Linux's `perf_event_open` and Go's PMU support let you sample hardware counters. The Go ecosystem has:

- `github.com/google/pprof` with custom samplers.
- `github.com/dgryski/go-perf` for low-level access.

Counter events to sample:

- `cycles` — total CPU cycles.
- `instructions` — IPC. Low IPC under load suggests stalls (cache misses or coherence).
- `cache-references`, `cache-misses` — L3 cache miss rate.
- `mem_load_l3_miss_retired.local_dram` — load misses served from DRAM (slow).
- `mem_inst_retired.lock_loads` — atomic operation count.
- `mem_inst_retired.l3_hit` — loads hitting L3 (often from another core's cache).

A "stalled on cache" profile that highlights specific source lines is a strong false-sharing signal.

### Method 4: synthetic stress test

Run your program under artificially high concurrency. If the throughput collapses, suspect contention. False sharing in particular shows a "throughput inversion" — *more* goroutines → *less* throughput. True contention typically just plateaus.

### Method 5: A/B comparison

Implement two versions: padded and unpadded. Run both under the same load. The padded one should be faster under contention; if it is not, your hot spot is somewhere else.

---

## Microbenchmark Discipline

Writing a benchmark that *demonstrates* false sharing requires care. Common pitfalls:

### Pitfall 1: the compiler optimises away the write

```go
func BenchmarkInc(b *testing.B) {
    var x int64
    for i := 0; i < b.N; i++ {
        x++
    }
    _ = x
}
```

This may compile to a single `mov x, b.N` instruction. The compiler sees the writes do not escape and folds the loop. Use `atomic.AddInt64` (which has side effects the compiler must respect), or assign through an `unsafe.Pointer`, or write to a global variable (which the compiler cannot prove dead).

### Pitfall 2: closure capture forces heap allocation

```go
b.RunParallel(func(pb *testing.PB) {
    var x int64
    for pb.Next() {
        x++ // x escapes to heap
    }
})
```

`x` may escape, costing extra time per iteration unrelated to your benchmark. Use a pre-allocated structure.

### Pitfall 3: shared map / slice that isn't the bottleneck

A benchmark that measures a per-goroutine increment but accidentally uses a shared map for storage is mostly measuring the map's contention. Keep the benchmark focused: one tight loop on the variable under test.

### Pitfall 4: testing on a hyperthreaded machine

Hyperthreads on the same physical core share L1. False sharing between two hyperthreads is mostly invisible. Use physical cores: `taskset -c 0,2,4,6 go test` to pin to even cores (often the four physical cores on an 8-thread chip).

### Pitfall 5: low iteration count

Go's `testing.B` chooses `b.N` automatically. If your benchmark function does just one operation per `b.N`, the entire benchmark may run for microseconds — too short to see false sharing's steady-state cost. Use a fixed large `b.N` (`-benchtime=10s` or `-benchtime=1000000000x`) for steady-state measurements.

### Pitfall 6: noisy environment

Background processes affect microbenchmarks. Best practice for serious measurements:

```
$ sudo nice -n -20 taskset -c 0-7 go test -bench .
```

Or use `perf stat -r 5 ./benchmark` to get repeatability statistics.

### Pitfall 7: ignoring `b.ReportAllocs()`

Allocations during the benchmark can mask the actual cost. Use `b.ReportAllocs()` and look for "0 allocs/op" in steady-state benchmarks. If you see allocations, find them and remove them.

### Pitfall 8: trusting one run

Run benchmarks at least 3-5 times. Variance is real. Use `benchstat` (`golang.org/x/perf/cmd/benchstat`) to compare results statistically.

---

## Anti-Patterns in Production Code

### Anti-Pattern 1: padding without contention

```go
type Config struct {
    timeout int64
    _       [56]byte
    retries int64
    _       [56]byte
}
```

`Config` is read-only after construction. Padding does nothing useful and wastes 112 bytes per `Config`. Remove.

### Anti-Pattern 2: padding with the wrong size

```go
type C struct {
    v int64
    _ [54]byte // should be 56!
}
```

54-byte padding makes the struct 62 bytes — neighbours in an array land at offsets 0, 62, 124. Each is mid-line, defeating the purpose. Always pad to a cache-line multiple.

### Anti-Pattern 3: padding only the leading field

```go
type Q struct {
    head uint64
    _    [56]byte
    tail uint64
    // no padding after tail
}
```

`tail` shares a line with whatever follows the struct. If the next allocation is also hot, you have false sharing on `tail`'s line. Pad both sides.

### Anti-Pattern 4: padding inside a slice header

```go
type S struct {
    data []byte
    _    [56]byte // misguided: data is just a slice header (24 bytes)
}
```

The slice header is 24 bytes; padding here does not protect from false sharing on the *underlying* array. To protect the data, pad inside the array's element type (if you control allocation), or use a sharded array.

### Anti-Pattern 5: arrays of `*sync.Mutex`

```go
locks := make([]*sync.Mutex, N)
for i := range locks {
    locks[i] = &sync.Mutex{}
}
```

Each `*sync.Mutex` is 8 bytes; eight pointers fit in one line. Worse, each mutex is a separately allocated 8-byte struct — and the allocator may pack them close together. Use `make([]paddedMutex, N)` instead, where `paddedMutex` is 64 bytes.

### Anti-Pattern 6: copying padded structs

```go
type Padded struct {
    v int64
    _ [56]byte
}

func Receive(p Padded) { /* uses p.v */ }
```

Calling `Receive` copies 64 bytes by value, instead of 8. If `Padded` is used in this way (passed by value frequently), the padding is a perf regression for the *use*. Padding is for layout-in-collections, not for individual passing. Pass by pointer:

```go
func Receive(p *Padded) { /* uses p.v */ }
```

### Anti-Pattern 7: padding pointer fields

```go
type Big struct {
    cache *Cache
    _     [56]byte
    cfg   *Config
    _     [56]byte
}
```

Pointers are 8 bytes; the *pointed-to* objects can be far apart in memory. Padding the pointers does not pad the data. To protect the cache, pad inside `Cache` itself.

### Anti-Pattern 8: relying on compiler alignment

```go
type S struct {
    a int8
    b int64
    c int32
}
```

The compiler inserts 7 bytes of padding between `a` and `b` (for alignment). The total size might be 24 bytes. But this is alignment padding, not false-sharing padding — the compiler does not understand cache lines. If `a`, `b`, `c` are all hot, you still need cache-line padding *between* them.

### Anti-Pattern 9: assuming `sync.Pool` solves all contention

`sync.Pool` reduces *allocation* contention for short-lived objects. It does not reduce contention on user-defined hot counters. Reaching for `sync.Pool` because "I read it's fast" is not a substitute for understanding what you are trying to avoid.

### Anti-Pattern 10: too many shards

If your shard count is 1024 but you only have 8 cores, most shards are dead weight — they consume memory and slow read aggregation. Tune shard count to physical cores; do not just "max it out."

---

## Code Examples

### Example 1: a padded SPMC queue head/tail

```go
package spmc

import (
    "sync/atomic"
)

type Queue struct {
    buf  []interface{}
    mask uint64

    // Producer-side (single producer)
    head uint64
    _    [56]byte

    // Consumer-side (multiple consumers via atomic CAS on tail)
    tail uint64
    _    [56]byte
}

func New(size int) *Queue {
    // size must be a power of two
    return &Queue{
        buf:  make([]interface{}, size),
        mask: uint64(size - 1),
    }
}

func (q *Queue) Enqueue(v interface{}) bool {
    h := q.head
    t := atomic.LoadUint64(&q.tail)
    if h-t >= uint64(len(q.buf)) {
        return false // full
    }
    q.buf[h&q.mask] = v
    atomic.StoreUint64(&q.head, h+1)
    return true
}

func (q *Queue) Dequeue() (interface{}, bool) {
    for {
        t := atomic.LoadUint64(&q.tail)
        h := atomic.LoadUint64(&q.head)
        if t == h {
            return nil, false // empty
        }
        v := q.buf[t&q.mask]
        if atomic.CompareAndSwapUint64(&q.tail, t, t+1) {
            return v, true
        }
        // retry on CAS failure
    }
}
```

Producers only touch `head` (and read `tail` for full-check). Consumers only touch `tail` (and read `head` for empty-check). Padding ensures the producer's write to `head` does not bounce the consumer's `tail` line and vice versa.

### Example 2: per-CPU sharded set

```go
package sharded

import (
    "runtime"
    "sync"
)

type Shard struct {
    sync.Mutex
    m map[string]struct{}
    _ [40]byte // pad to 64 (mutex 8 + map header 8 + map pointer 8)
}

type Set struct {
    shards []Shard
}

func New() *Set {
    s := &Set{shards: make([]Shard, runtime.GOMAXPROCS(0))}
    for i := range s.shards {
        s.shards[i].m = make(map[string]struct{})
    }
    return s
}

func (s *Set) hash(key string) int {
    var h uint32 = 2166136261
    for i := 0; i < len(key); i++ {
        h ^= uint32(key[i])
        h *= 16777619
    }
    return int(h) % len(s.shards)
}

func (s *Set) Add(key string) {
    i := s.hash(key)
    s.shards[i].Lock()
    s.shards[i].m[key] = struct{}{}
    s.shards[i].Unlock()
}

func (s *Set) Has(key string) bool {
    i := s.hash(key)
    s.shards[i].Lock()
    _, ok := s.shards[i].m[key]
    s.shards[i].Unlock()
    return ok
}
```

A simple sharded set. Hashing distributes keys across shards; each shard has its own lock; padding ensures the mutex states of adjacent shards do not false-share.

A variant uses `sync.RWMutex` for read-heavy workloads — but be careful: `sync.RWMutex` is much larger (24+ bytes) and the padding numbers change.

### Example 3: padded fan-out counter

```go
package fanout

import (
    "runtime"
    "sync/atomic"
)

type Counter struct {
    arr []atomicCell
}

type atomicCell struct {
    v atomic.Int64
    _ [56]byte
}

func New() *Counter {
    return &Counter{arr: make([]atomicCell, runtime.GOMAXPROCS(0))}
}

func (c *Counter) Inc(shard int) int64 {
    return c.arr[shard%len(c.arr)].v.Add(1)
}

func (c *Counter) Value() int64 {
    var s int64
    for i := range c.arr {
        s += c.arr[i].v.Load()
    }
    return s
}
```

A clean, idiomatic sharded counter. ~10 lines of meaningful code.

### Example 4: dual padded ring (SPSC)

```go
package ring

import "sync/atomic"

type Ring[T any] struct {
    mask uint64
    buf  []T

    // producer state
    head atomic.Uint64
    _    [56]byte

    // consumer state
    tail atomic.Uint64
    _    [56]byte
}

func New[T any](size int) *Ring[T] {
    if size&(size-1) != 0 {
        panic("size must be power of two")
    }
    return &Ring[T]{mask: uint64(size - 1), buf: make([]T, size)}
}

func (r *Ring[T]) Push(v T) bool {
    h := r.head.Load()
    t := r.tail.Load()
    if h-t >= uint64(len(r.buf)) {
        return false
    }
    r.buf[h&r.mask] = v
    r.head.Store(h + 1)
    return true
}

func (r *Ring[T]) Pop() (T, bool) {
    t := r.tail.Load()
    h := r.head.Load()
    var zero T
    if t == h {
        return zero, false
    }
    v := r.buf[t&r.mask]
    r.tail.Store(t + 1)
    return v, true
}
```

A generic SPSC ring with padded indices. The buffer slots themselves are not padded — by design, only one producer and one consumer touch each slot at a time, and they hand off ownership through the head/tail counters.

### Example 5: aligning with `unsafe.Sizeof` and `unsafe.Alignof`

```go
package main

import (
    "fmt"
    "unsafe"
)

type Pad struct {
    v int64
    _ [56]byte
}

func main() {
    var p Pad
    fmt.Println("sizeof:",  unsafe.Sizeof(p))
    fmt.Println("alignof:", unsafe.Alignof(p))
}
```

Output:

```
sizeof:  64
alignof: 8
```

Size is 64 (good). Alignment is 8 (the alignment of `int64`). The struct *contents* are 8-aligned, not 64-aligned. The Go allocator will not place a 64-byte struct on a 64-byte boundary in general — but successive elements of an array of `Pad` *are* separated by exactly 64 bytes. So internal adjacency is solved; first-element boundary alignment is not. This is usually acceptable.

To get true 64-byte alignment of the first byte, you need to over-allocate and slice into the aligned offset:

```go
func aligned64() *Pad {
    buf := make([]byte, 64+64)
    addr := uintptr(unsafe.Pointer(&buf[0]))
    off := (64 - addr%64) % 64
    return (*Pad)(unsafe.Pointer(&buf[off]))
}
```

This trades a small allocation overhead for guaranteed alignment. Most code does not need it.

---

## Concurrent Data Structures and Cache Layout

When designing a concurrent data structure, ask:

1. **What is the unit of contention?** Is it a single global variable (true contention), a per-shard variable (need sharding), or adjacent independent variables (need padding)?

2. **What is the read/write ratio?** Read-mostly structures benefit from layouts that keep the writer-local data isolated. Write-mostly structures benefit from sharding.

3. **What is the access pattern by core?** A per-CPU pinned access (e.g., the same core always writes shard 0) needs maximum isolation. A random-shard access pattern (each goroutine hits a random shard) needs less per-shard isolation but more overall capacity.

4. **What is the size of the "hot" working set?** If the hot data fits in one L2 cache, false sharing dominates. If it spills out of L2 into L3 or DRAM, capacity misses dominate and false sharing is secondary.

5. **What is the latency budget?** A 100-ns false-sharing tax is invisible in a request-response handler that takes 10 ms. It is catastrophic in a tight parser loop with ns-per-byte budget.

### Layout patterns

- **One line per shard, with multiple fields per shard.** Best when each shard has a small set of related counters.
- **One line per field, with shard index inside the field.** Best when fields are accessed independently (different goroutines for different fields).
- **Two lines per shard, with read fields on line 1 and write fields on line 2.** Best when reads and writes happen on different goroutines.

### Example: a hybrid layout

```go
type Stats struct {
    // Hot writes: producer fields
    Produced  atomic.Uint64
    LastPushNs atomic.Int64
    _         [48]byte // pad to 64

    // Hot writes: consumer fields  (different goroutines)
    Consumed  atomic.Uint64
    LastPopNs atomic.Int64
    _         [48]byte // pad to 64

    // Cold metadata, rarely accessed
    Name      string
    Version   int
}
```

Producer goroutines touch `Produced` and `LastPushNs`. Consumer goroutines touch `Consumed` and `LastPopNs`. The two groups are on separate cache lines; the cold metadata is wherever the compiler puts it (doesn't matter).

This is a real-world layout from a high-throughput event bus library.

---

## Memory and Cache Tradeoffs

Padding is a *memory tax* in exchange for a *throughput dividend*. The math:

- Without padding: 8 int64 counters = 64 bytes. Throughput on 8 cores: ~5 M ops/sec total.
- With padding: 8 int64 counters in 8 cache lines = 512 bytes. Throughput on 8 cores: ~1600 M ops/sec total.

Memory cost: 8x. Throughput gain: 320x. Excellent tradeoff.

But:

- 1000 padded counters = 64 KB. Still fits in L2.
- 100 000 padded counters = 6.4 MB. Spills out of L2 (usually 1 MB), into L3 (often 32 MB). Each cold access is now L3-latency, not L1.
- 1 000 000 padded counters = 64 MB. Spills out of L3, into DRAM. Each access is ~100 ns instead of ~1 ns.

The break-even depends on access pattern. If you access each counter once per request and you have a hot working set of "all counters per second," then crossing L1 (~32 KB), L2 (~1 MB), or L3 (~32 MB) capacity changes the per-access cost dramatically.

The lesson: do not pad everywhere. Pad only the truly hot structures. For sparse counter collections (e.g., per-key-hash counters with millions of keys), use a tighter layout and rely on the natural locality of accesses to the same key.

---

## Code Review Checklist

When reviewing concurrent Go code, watch for:

1. **Hot struct with multiple int64/uint64/atomic fields.** If multiple goroutines write different fields, suspect false sharing. Suggest padding or splitting.

2. **Slice of small structs with concurrent writes.** A `[]struct{a, b int}` with concurrent writes is a smoking gun. Suggest wrapping in a per-line padded element.

3. **`sync.Mutex` in an array without padding.** Multiple cores contending different mutexes that share a line is contention you did not bargain for. Suggest padding the container.

4. **Hardcoded `[56]byte` without a comment.** Demand a comment explaining why.

5. **Hardcoded `64` as a magic number.** Suggest a named constant (`const cacheLine = 64`) or `runtime/internal/sys.CacheLineSize` (if accessible).

6. **Padded struct passed by value.** Passing by value copies the padding too — wasted work. Suggest pointer.

7. **Padding without a corresponding `unsafe.Sizeof` test.** Padding silently drifts as struct fields are added. Suggest the test.

8. **A single `atomic.Int64` as a "global counter."** Suspect contention. Suggest sharding if the counter is on a hot path.

9. **Shard counts hardcoded to a number unrelated to `GOMAXPROCS`.** Suggest dynamic sizing.

10. **Padding that doesn't divide evenly into cache line size.** Math error. Compute padding from `cacheLine - sizeof(usedFields)`.

A checklist applied during code review catches these patterns before they ship.

---

## Edge Cases

### Edge case 1: zero-allocation API for the user, but allocations internally

A library that exposes `Counter.Inc()` may internally allocate per-shard storage at construction time. That is fine — the *per-call* path is allocation-free, which is what matters for hot-path users. Watch out for incidentally exposing the allocation (e.g., a `Counter` that grows shards lazily).

### Edge case 2: GC interaction

Padding fields in a struct increase its size. The Go GC's mark phase visits each field's pointer. Padded structs (with byte arrays, not pointers) add no pointer-tracing work, so GC cost is unchanged. This is one reason `[N]byte` is the canonical padding — never use a pointer field as padding.

### Edge case 3: structs embedded in interfaces

```go
type Counter interface { Inc() }
type myImpl struct{ v atomic.Int64; _ [56]byte }
var c Counter = &myImpl{}
c.Inc()
```

The interface value holds a pointer to the impl. Two interface values can be on the same cache line, but they point to (possibly) different impls. No false sharing on the interface header level (writes don't change it after construction); false sharing might happen on the *impls* if they are placed adjacently in memory. Allocate impls separately to ensure isolation.

### Edge case 4: array-of-pointers vs. array-of-structs

```go
// Pattern A: array of pointers; impls allocated separately
arr := make([]*Impl, N)
for i := range arr {
    arr[i] = &Impl{}
}

// Pattern B: array of structs; all in one allocation
arr := make([]Impl, N)
```

Pattern B's adjacency is *guaranteed*: element i and i+1 are exactly `sizeof(Impl)` bytes apart. Pad inside `Impl`.

Pattern A's adjacency is *probable but not guaranteed*: the allocator often returns successive small objects from the same `mcache` span, packing them within one or two cache lines. Padding inside `Impl` still protects against false sharing on the *impl fields*; the *pointers* (in `arr`) are only ever read after construction, so they do not false-share.

For maximum control over layout, prefer Pattern B with padded struct.

### Edge case 5: false sharing across goroutine stacks

Each goroutine has its own stack. Stacks are at least 2 KB and grown as needed. False sharing across stacks requires:

- Two stacks to be in adjacent cache lines.
- Two goroutines to write hot local variables in those same regions.
- Same physical cores executing them concurrently.

In practice this is exceptionally rare; the Go runtime spaces stacks far apart, and most stack-local variables are not hot. We will not waste worry on it.

### Edge case 6: false sharing in the Go map

`map[K]V` is internally a hash table with buckets. Buckets are arrays of (key, value) pairs. Concurrent writes to a map are *not* allowed (it crashes); concurrent reads are allowed. So map-internal false sharing is moot — there is no concurrent write pattern to demonstrate it.

`sync.Map` *does* allow concurrent writes and is internally sharded. Its hot paths use atomics on shard-private data; reads are mostly lock-free. False sharing on `sync.Map`'s internals is theoretically possible but the standard library cares.

### Edge case 7: false sharing across processes

Multiple processes on the same machine sharing a mmap'd region can false-share. The same hardware mechanism applies. The fix is the same: pad to cache lines.

### Edge case 8: scheduler-induced "moving" false sharing

A goroutine can migrate between cores. If goroutine A is "supposed" to own shard 0 and goroutine B "supposed" to own shard 1, but they both migrate to core 0 (with core 1 idle), they now both write from core 0 — no inter-core traffic, no false sharing at that moment. The benchmark you measure shows false sharing only when goroutines actually run on different cores. To make benchmarks reliable, pin goroutines to cores with `runtime.LockOSThread` *and* OS-level `taskset` or `sched_setaffinity`.

---

## Common Misconceptions Revisited

### Misconception revisited: "padding is portable."

Cache line size is platform-dependent. A `[56]byte` pad designed for 64-byte lines (amd64, arm64) is wrong on a 128-byte machine (ppc64). For portability, define `CacheLineSize` per platform via build tags:

```go
//go:build amd64 || arm64
const CacheLineSize = 64

//go:build ppc64 || ppc64le
const CacheLineSize = 128
```

And compute padding from it:

```go
type Padded struct {
    v int64
    _ [CacheLineSize - 8]byte
}
```

### Misconception revisited: "padding always wastes memory."

Padding only wastes memory if the padded fields are *spread out*. If your padded struct is co-allocated with other data (e.g., another instance of the same struct in an array), the "wasted" bytes are just used as filler between hot values. The total memory cost is `N × cacheLine` for N padded items, which is exactly the price of false-sharing-free layout.

In contrast, padding inside an isolated single-instance struct does waste memory — but you usually only pad collections, not singletons.

### Misconception revisited: "the compiler will figure it out."

The Go compiler optimises code, not layout. It does not introspect "this struct is in a hot concurrent context, let me add padding." Padding is a *manual* optimisation. Some other languages (Rust with `#[repr(align(64))]`, C with `alignas(64)`, Java with `@Contended`) make it more declarative, but Go does not have native syntax. The community convention is hand-padding.

### Misconception revisited: "sync.Mutex blocks false sharing."

A mutex serialises *critical sections* but does nothing about cache layout. If two mutexes share a cache line and are contended by different goroutines, the *lock state words* themselves false-share. The fix is to pad the *containers* of the mutexes, not the mutex internals.

---

## Self-Assessment

- [ ] I can design a sharded counter with cache-line-padded shards.
- [ ] I can read Go runtime source and identify all padding patterns in `sync.Pool`.
- [ ] I can write a benchmark that demonstrates false sharing reliably.
- [ ] I know how to use `perf c2c` to find false sharing.
- [ ] I can review code and spot false-sharing-prone patterns.
- [ ] I know the memory/throughput tradeoff and when *not* to pad.
- [ ] I can distinguish adjacency contention from hot-spot contention and choose the right fix.
- [ ] I can write a unit test that catches accidental padding drift via `unsafe.Sizeof`.
- [ ] I know that `[56]byte` is wrong on ppc64 and how to fix that.
- [ ] I can design a padded SPSC and SPMC ring buffer.

---

## Summary

False sharing at the middle level is a *design constraint*, not just a bug. Concurrent data structures are designed around it from the start:

- Per-shard structures align each shard to a cache line.
- Producer/consumer indexes are padded apart.
- Sharded counters use `runtime.GOMAXPROCS(0)` shards.
- Padding is documented, sized to architectural constants, and protected by `unsafe.Sizeof` tests.

The Go runtime itself follows these patterns in `sync.Pool`, the scheduler, the allocator, and the semaphore. Reading runtime source is the best way to internalise the conventions.

Detection methodology is benchmark-driven: scaled benchmarks reveal contention, `perf c2c` localises it, hardware counters confirm the cause. Microbenchmarks need discipline — closure captures, compiler optimisations, and hyperthread artifacts all conspire to hide false sharing.

The senior file goes further: NUMA, MESI in depth, custom cache-aware data structures, and the tradeoffs at the system-architecture level.

---

## Appendix A: A Deep Dive into `perf c2c`

At middle level, knowing the tool exists is not enough — you need a working mental model of what each column means and how to interpret the report. Here is a walkthrough using a synthetic example.

### Setup

We compile a tiny Go program that deliberately false-shares two counters in adjacent slots.

```go
// fs.go
package main

import (
    "sync"
    "sync/atomic"
    "time"
)

var data [2]atomic.Int64

func main() {
    var wg sync.WaitGroup
    deadline := time.Now().Add(10 * time.Second)
    for i := 0; i < 2; i++ {
        wg.Add(1)
        go func(idx int) {
            defer wg.Done()
            for time.Now().Before(deadline) {
                data[idx].Add(1)
            }
        }(i)
    }
    wg.Wait()
}
```

Build and record:

```
go build -o fs fs.go
sudo perf c2c record -o fs.data ./fs
sudo perf c2c report -i fs.data --stdio > c2c.txt
```

### Reading the report

The output has several sections. The most important is the *Shared Data Cache Line Table*:

```
=================================================
        Shared Data Cache Line Table
=================================================
#  CacheLine   Total  Total  LLC  Loc Clean  HITM   Avg
   Address     records HITM  loads HITM  HITM Total  Cycles
0  0x55b8...c0 482931  287512 14213 273299  287512 412
```

Columns demystified:

- **CacheLine Address** — virtual address of the contended line, masked to 64-byte boundary.
- **Total records** — total memory access samples that hit this line.
- **Total HITM** — total *Hit Modified* events on this line. This is the smoking gun. A HITM means: core A asked for the line; core B had it modified; core B had to flush and transfer to core A. Every HITM is one bounce.
- **LLC HITM** — HITMs satisfied via the Last-Level Cache (cross-core but same socket).
- **Local Clean** — clean loads from local socket.
- **HITM Avg Cycles** — average latency cost per HITM (often 80-200 cycles on modern Intel).

A line with HITM > 10,000 in a 10-second run is suspicious. > 100,000 is screaming.

### Drilling into the offending line

```
=================================================
        Shared Cache Line Distribution Pareto
=================================================
#  Num  Cacheline   Tot  HITM  Off Code Address     Symbol
0  482K 0x55b8...c0 100% 287K   0   0x4a5012        main.main.func1
                                  16  0x4a5012        main.main.func1
```

The "Off" column is the byte offset within the cache line where the access occurred. Here we see offsets 0 and 16 are hot. That matches our `[2]atomic.Int64` layout: index 0 at byte 0, index 1 at byte 8. (Why 16 and not 8? Because the compiler may have aligned `atomic.Int64` to 16-byte boundaries for SIMD or because `data` has alignment padding. Either way, both offsets are within the same 64-byte line.)

The Symbol column points at the function holding the contended code. In real binaries this is the most useful column — it tells you exactly which Go function is hammering the line.

### Interpreting node info

```
        Source:Line     Node{cpus %hitms}
        fs.go:13         0{0  31.4%  1  29.8%  2  20.1%  3  18.7%}
```

This means the HITMs on this source line were spread across NUMA node 0, CPUs 1, 2, 3, with roughly even distribution. If you see one CPU with >50% you have a single-writer bottleneck (likely not pure false sharing; a hot variable). If CPUs span multiple NUMA nodes you have cross-socket bouncing (much more expensive).

### What "good" looks like

After padding to 64-byte slots, re-run `perf c2c`. You should see:

- Total HITM drops by 10-100x.
- The previously-hot cache-line address either vanishes or shows much lower counts.
- HITM Avg Cycles per remaining event may stay similar; the *number* is what matters.

### Common pitfalls

- **Sampling rate.** `perf c2c` uses statistical sampling. Short benchmarks may miss the bouncing. Run for ≥10 seconds.
- **Kernel mode.** Some kernels need `kernel.perf_event_paranoid=-1` to capture HITMs.
- **Hypervisors.** Inside VMs HITMs may not be reported because the hypervisor abstracts the PMU. Test on bare metal or use a VM with PMU passthrough.
- **AMD vs Intel.** Intel reports HITMs natively; AMD requires `IBS` (Instruction-Based Sampling) and the column names differ slightly. The interpretation is the same.

---

## Appendix B: Architecture-Specific Cache Line Sizes

You will write Go that runs on more than one CPU architecture. The padding constants change.

| Architecture | L1 line | L2 line | L3 line | Adjacent prefetch? | Notes |
|--------------|---------|---------|---------|--------------------|-------|
| amd64 (Intel Xeon, Core) | 64 | 64 | 64 | Yes, adjacent line | Pad to 128 to defend against L2 spatial prefetcher. |
| amd64 (AMD EPYC) | 64 | 64 | 64 | No (varies by gen) | 64 usually suffices; Zen 3+ sometimes prefetches 128. |
| arm64 (server, Graviton, Ampere) | 64 | 64 | 64 | No (typically) | 64 suffices. |
| arm64 (Apple M1/M2/M3 P-cores) | 128 | 128 | 128 | Yes | Pad to 128. Apple's E-cores often have 64-byte lines; mixed-mode caches make 128 the safe choice. |
| ppc64le | 128 | 128 | 128 | No | Always 128. |
| s390x (mainframe) | 256 | 256 | 256 | No | Rarely encountered; pad large. |
| riscv64 | 64 | 64 | 64 | Implementation-defined | 64 is common; check your specific SoC. |
| mips64 | 32 or 64 | varies | varies | No | Old hardware; 64 is safe. |

### Programmatic discovery

You cannot reliably query line size at runtime from pure Go. Options:

1. Compile-time `GOARCH` switch (constant.go with build tags).
2. Read `/sys/devices/system/cpu/cpu0/cache/index0/coherency_line_size` on Linux at startup (this is for L1 — index1 is L2, index2 is L3).
3. Use `cpuid` instruction via `golang.org/x/sys/cpu` for x86.

Pattern used by Go itself (`runtime/internal/sys/intrinsics.go`):

```go
// CacheLinePadSize is used to prevent false sharing.
const CacheLinePadSize = 64 // 128 on ppc64{,le}
```

It hard-codes per `GOARCH`. That is the pragmatic choice for a runtime that must compile cleanly without runtime CPU detection.

### Recommendation

For production code:

- If you target only x86-64 servers, use 128.
- If you target ARM Linux servers (AWS Graviton), use 64.
- If you target Apple Silicon (devs running Macs), 128 is safer.
- If you target ppc64 (rare; some IBM/OpenPOWER deployments), 128.
- If you must portable, define a `cachelinePad` constant in a build-tagged file per arch.

```go
//go:build amd64 || arm64
package internal
const CachePadSize = 64

//go:build ppc64 || ppc64le
package internal
const CachePadSize = 128
```

The padded struct then references `CachePadSize`. Total size per slot is `unsafe.Sizeof(hot)+pad`, sized to a constant.

---

## Appendix C: A Sharded Counter Library Walkthrough

Here is a complete sharded counter implementation suitable for production use. Read it as a worked example of all the patterns at this level.

```go
// counter.go
package counter

import (
    "runtime"
    "sync/atomic"
    "unsafe"
)

const cacheLine = 64

type shard struct {
    v    atomic.Int64
    _pad [cacheLine - unsafe.Sizeof(atomic.Int64{})]byte
}

type Counter struct {
    shards []shard
    mask   uint64
}

// New creates a counter with at least n shards, rounded up to a power of two.
// Power-of-two enables bitmask indexing instead of modulo.
func New(n int) *Counter {
    if n <= 0 {
        n = runtime.GOMAXPROCS(0)
    }
    // round up to power of two
    sz := 1
    for sz < n {
        sz <<= 1
    }
    return &Counter{
        shards: make([]shard, sz),
        mask:   uint64(sz - 1),
    }
}

// Add increments the counter by delta. The shard is chosen by goroutine ID
// hash (cheap, no locks).
func (c *Counter) Add(delta int64) {
    // Use a per-call-site hash. Simple xorshift seeded by stack pointer.
    var s int
    _ = s
    sp := uintptr(unsafe.Pointer(&s))
    idx := uint64(sp>>6) & c.mask
    c.shards[idx].v.Add(delta)
}

// Load returns the sum of all shards. Not strictly atomic across shards;
// readers see a snapshot consistent within each shard.
func (c *Counter) Load() int64 {
    var sum int64
    for i := range c.shards {
        sum += c.shards[i].v.Load()
    }
    return sum
}
```

Notes on the design:

- **Shard count is power of two**, so `idx & mask` replaces `idx % n`. Modulo is much slower for non-constant n.
- **`unsafe.Sizeof(atomic.Int64{})` is 8**, so padding is `64 - 8 = 56`. The constant expression compiles at build time.
- **Indexing via stack pointer hash** is the cheap way without `runtime_procPin`. The hash is biased: goroutines tend to map to the same shard across calls within a stack frame. This is fine — what matters is *spread* across goroutines, which the OS scheduler provides naturally.
- **`Load` is not linearizable** — there is no global snapshot. For counters where eventual consistency is acceptable (metrics, request counts), this is the right tradeoff. For exact accounting (banking), use a single atomic.

### Benchmark vs naive

```go
func BenchmarkNaive(b *testing.B) {
    var c atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Add(1)
        }
    })
}

func BenchmarkSharded(b *testing.B) {
    c := New(runtime.GOMAXPROCS(0))
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Add(1)
        }
    })
}
```

Typical result on a 16-core box:

```
BenchmarkNaive-16         32M     35.4 ns/op
BenchmarkSharded-16      980M      1.2 ns/op
```

A 30x speedup. The cost: `O(shards)` for `Load`. For a 16-shard counter, Load is ~16 atomic loads = ~30ns. Fine for a metrics flush every second.

### When this design fails

- When shards still false-share. Test with `unsafe.Sizeof(shard{}) == 64`. Add a regression test.
- When the workload has bursts on a single shard (e.g., one goroutine doing 99% of work). Sharding does not help; per-goroutine state does.
- When Load is on the hot path. Then `O(shards)` adds up. Use occasional "checkpoint" aggregation: a background goroutine sums shards into a single read-mostly atomic, readers read the checkpoint.

This last pattern is the LongAdder design from Java's `java.util.concurrent.atomic`. We will see the Go equivalent at senior level.

---

## Appendix D: The Vyukov MPMC Queue (Padded Slots Walkthrough)

Dmitry Vyukov's bounded MPMC queue is a textbook lock-free design. Its correctness depends on cache-line padding at multiple points. Here is the full implementation with annotations.

```go
package mpmc

import (
    "sync/atomic"
    "unsafe"
)

const cacheLine = 64

type cell struct {
    seq atomic.Uint64
    val unsafe.Pointer
    _pad [cacheLine - unsafe.Sizeof(atomic.Uint64{}) - unsafe.Sizeof(unsafe.Pointer(nil))]byte
}

type Queue struct {
    _pad0    [cacheLine]byte
    buffer   []cell
    mask     uint64
    _pad1    [cacheLine - 2*8]byte
    enqueuePos atomic.Uint64
    _pad2    [cacheLine - 8]byte
    dequeuePos atomic.Uint64
    _pad3    [cacheLine - 8]byte
}

func NewQueue(size uint64) *Queue {
    // size must be power of two
    if size&(size-1) != 0 {
        panic("size must be power of two")
    }
    q := &Queue{
        buffer: make([]cell, size),
        mask:   size - 1,
    }
    for i := range q.buffer {
        q.buffer[i].seq.Store(uint64(i))
    }
    return q
}

func (q *Queue) Enqueue(v unsafe.Pointer) bool {
    pos := q.enqueuePos.Load()
    for {
        c := &q.buffer[pos&q.mask]
        seq := c.seq.Load()
        diff := int64(seq) - int64(pos)
        switch {
        case diff == 0:
            if q.enqueuePos.CompareAndSwap(pos, pos+1) {
                c.val = v
                c.seq.Store(pos + 1)
                return true
            }
        case diff < 0:
            return false // full
        default:
            pos = q.enqueuePos.Load()
        }
    }
}

func (q *Queue) Dequeue() (unsafe.Pointer, bool) {
    pos := q.dequeuePos.Load()
    for {
        c := &q.buffer[pos&q.mask]
        seq := c.seq.Load()
        diff := int64(seq) - int64(pos+1)
        switch {
        case diff == 0:
            if q.dequeuePos.CompareAndSwap(pos, pos+1) {
                v := c.val
                c.seq.Store(pos + q.mask + 1)
                return v, true
            }
        case diff < 0:
            return nil, false // empty
        default:
            pos = q.dequeuePos.Load()
        }
    }
}
```

Annotations on padding:

- **`_pad0`** isolates the struct from whatever precedes it in memory (often heap allocator metadata).
- **`_pad1`** isolates the `buffer` slice header (24 bytes on 64-bit) and `mask` (8 bytes) from `enqueuePos`.
- **`_pad2`** isolates `enqueuePos` from `dequeuePos`. This is the *critical* padding. Producers write `enqueuePos`; consumers write `dequeuePos`. Without this, a producer's CAS bounces the consumer's line on every operation. With this padding, producer and consumer touch independent lines.
- **`_pad3`** isolates the struct's end from whatever follows it in memory.
- **Per-cell `_pad`** isolates adjacent cells. Each cell is 64 bytes. This means index 0 and index 1 are on separate lines. Without this, two enqueuers operating on adjacent indices would false-share.

The result is that the queue scales linearly to about 8-16 concurrent producers and consumers on typical hardware. Without the padding, it would scale to about 2-4 before false sharing dominates.

### Measurement

Run a benchmark with N=2,4,8,16,32 goroutines and chart throughput. The padded version's curve is roughly linear up to GOMAXPROCS. The unpadded version peaks early.

---

## Appendix E: When the Bottleneck Is Not False Sharing

Engineers who have just learned about false sharing tend to see it everywhere. A middle-level skill is knowing when to *not* blame false sharing.

### Symptom 1: Single-writer hot path

If only one goroutine writes a variable and many goroutines read it, you have a *true* sharing problem, not a false one. Padding does not help. Fix is either to make readers cache the value locally (with periodic refresh) or to use a read-mostly synchronisation primitive (RCU, sync.Map, atomic.Pointer for whole-snapshot publication).

### Symptom 2: Cache-line saturation due to working set size

If the working set exceeds L1 (typically 32KB per core), every access is an L2/L3 miss regardless of contention. Padding adds to the working set and makes this worse. Fix is to compact data or use a different access pattern (e.g., blocked iteration over a matrix).

### Symptom 3: Lock contention

If goroutines wait on a `sync.Mutex` for a long critical section, the bottleneck is the *lock hold time*, not cache-line bouncing. Padding the mutex does not shorten the critical section. Fix is to reduce hold time, switch to a finer-grained lock, or use lock-free data structures.

### Symptom 4: Channel contention

A `chan T` with one sender and one receiver under heavy load is bottlenecked by the channel's internal lock. Padding the channel does nothing. Fix is to use multiple channels or a lock-free queue.

### Symptom 5: Allocator pressure

If the hot path allocates, the allocator's `mcache.tinyOffset` and freelist pointers become contended. The Go runtime already pads the allocator's per-P state; user code cannot easily fix runtime contention. Fix is to use `sync.Pool` or avoid allocation entirely.

### How to distinguish

- Run with `GOMAXPROCS=1`. If throughput is similar or only modestly higher with more cores, the bottleneck is *not* false sharing. False sharing typically *worsens* with cores; serial bottlenecks stay roughly constant.
- Use `pprof -mutex` and `pprof -block`. Mutex/block contention is visible there; false sharing is not.
- Use `perf c2c`. If HITMs are low on your hot lines, false sharing is not the issue.
- Compare to a padded version. If padding does not improve throughput, the bug is elsewhere.

Diagnostic discipline at middle level: measure first, then apply the right fix. Padding everything wastes memory and can make L1 misses worse.

---

## Appendix F: Cross-Language Comparison

How do other languages and ecosystems handle false sharing? Understanding this puts Go's approach in context.

### Java: `@Contended`

Java 8 added a `@sun.misc.Contended` annotation (renamed `@jdk.internal.vm.annotation.Contended` in Java 9+). It tells the JVM to pad annotated fields to cache-line boundaries.

```java
class Counter {
    @Contended public volatile long count;
}
```

The JVM inserts padding automatically. Two practical caveats: the annotation only works in jdk-internal packages by default (you need `-XX:-RestrictContended`), and the padding size is JVM-controlled (typically 128 bytes for modern Intel).

`LongAdder` in `java.util.concurrent.atomic` uses `@Contended` to pad cells. Each cell is on its own line; concurrent `add` calls go to different cells (chosen by thread hash). `sum()` walks all cells.

### Rust: `crossbeam_utils::CachePadded`

The `crossbeam-utils` crate provides:

```rust
pub struct CachePadded<T> {
    value: T,
    _pad: [u8; PADDING],
}
```

The padding size is platform-specific (computed at compile time based on `cfg(target_arch)`). It uses `#[repr(align(N))]` for alignment guarantees in addition to size padding. Idiomatic Rust:

```rust
use crossbeam_utils::CachePadded;
let counter: CachePadded<AtomicU64> = CachePadded::new(AtomicU64::new(0));
```

### C++: `alignas(std::hardware_destructive_interference_size)`

C++17 introduced two constants in `<new>`:

- `std::hardware_destructive_interference_size` — minimum offset to avoid false sharing.
- `std::hardware_constructive_interference_size` — maximum offset where two values might share a line beneficially.

```cpp
struct alignas(std::hardware_destructive_interference_size) Counter {
    std::atomic<int64_t> count;
};
```

The compiler aligns and pads automatically. Reality: most compilers report 64 even on Intel where adjacent-line prefetch suggests 128. The standard wording is "minimum"; vendors are conservative.

### Go: hand-padded

Go has no `@Contended`, no `alignas`, no `CachePadded` in the standard library. The runtime uses `runtime/internal/sys.CacheLinePadSize` (internal). User code rolls its own:

```go
type padded struct {
    v    atomic.Int64
    _pad [56]byte
}
```

This is more verbose but more explicit. The Go community prefers explicit layout — you see the bytes; nothing is magic. The downside: easy to get wrong, especially across architectures. Hence the `unsafe.Sizeof` regression test idiom.

### Why does Go not have `@Contended`?

Three reasons:
1. Go's struct layout is part of the language semantics (memory model talks about fields, not aligned blocks). Adding a `@Contended` annotation would require either changing layout semantics or having the runtime do magic.
2. Go favours explicit over implicit. The padding bytes are visible in `unsafe.Sizeof`.
3. The Go community has not converged on a need strong enough to motivate a language change. Hand-padding is well-known and works.

A 2022 proposal (rsc) suggested a `runtime.CacheLinePad` exported type. It has not been accepted. The internal type `runtime/internal/sys.CacheLinePad` exists but is not part of the public API.

For now, hand-pad. Define a `cachePad` constant per architecture, use `[cachePad - unsafe.Sizeof(hot)]byte`, write a `unsafe.Sizeof` test.

---

## Appendix G: A Middle-Level Code Review Checklist

When reviewing code that touches concurrent state, walk through this checklist. Catching false sharing in review is much cheaper than catching it in production.

### Layout review

1. Does any struct have multiple `atomic.*` fields adjacent? Flag for analysis.
2. Does any struct end with an `atomic.*` field? Flag: the next field in memory (often a sibling slice element) may share its line.
3. Does the code use `[]T` where `T` contains `atomic.*`? Flag: array siblings are by definition adjacent.
4. Does the code use `sync.Mutex` arrays for lock striping? Flag: mutex state words are 8 bytes each; 8 mutexes share a 64-byte line.
5. Are there package-level globals that look like counters? Flag: package-level variables sit next to whatever the linker placed beside them; layout is not stable across builds. Sharding is safer than padding for package-level state.

### Pattern review

6. Does the code follow a producer/consumer pattern with `head` and `tail` indices? Confirm they are on separate lines.
7. Does the code implement a custom sharded data structure? Confirm shards are padded.
8. Does the code use `sync.Map` or similar? Check whether the internal layout has known false-sharing issues (it does, in older Go versions).
9. Is there a worker pool with per-worker stats? Confirm stats are padded or are written from only one goroutine each.

### Test review

10. Are there `unsafe.Sizeof` assertions on padded structs? Required.
11. Are there scaling benchmarks (`-cpu=1,2,4,8,16`)? If not, ask for them.
12. Is there a `-benchmem` allocations check? Padding should not cause heap growth.

### Documentation review

13. Are padding bytes commented? Required.
14. Is the architecture target documented (amd64, arm64, ppc64)? Required, especially for `[N]byte` literals.
15. Is there a regression note in the package's README or design doc? Required for hot-path code.

A "no" on items 10 or 14 should block merge. The others are softer flags — discuss with the author.

---

## Appendix H: Going Deeper — Recommended Source Reading

At middle level, you should be reading runtime source actively. Here are five files to study, with what to look for in each.

1. `src/sync/pool.go` — `poolLocal` and `poolLocalInternal` padding. Find the comment about "size of poolLocal % CacheLineSize == 0."
2. `src/runtime/mgcsweep.go` — `sweepdata` struct with padding around `centralIndex` and `sweepdone`.
3. `src/runtime/proc.go` — `p` struct (per-processor state). Look for `_ [56]uintptr` style padding around `runqhead` and `runqtail`.
4. `src/runtime/sema.go` — `semaRoot` and `semTable`. The semaphore table has 251 entries, each padded to a cache line: `_ [sys.CacheLinePadSize - unsafe.Sizeof(semaRoot{})%sys.CacheLinePadSize]byte`.
5. `src/runtime/mheap.go` — `mheap` struct padding. The heap struct has padding before/after hot fields like `pages`.

Pick one per week. Read the file end-to-end. Search for "pad" and "cacheline." Note every padding decision and ask: *why padded here?* Cross-reference with git blame to find the commit that added the padding. Often the commit message explains the production bug that motivated it.

This is professional development. Senior engineers read these files routinely.

---

## Appendix I: A Realistic Production Incident

Below is a sanitised version of an incident I encountered in 2023 at a payments company.

**Symptom:** A new feature shipped that added a per-account rate limiter. The service's p99 latency went from 4ms to 22ms under the same load. CPU was at 70% (same as before). Throughput dropped 30%.

**Investigation:**

1. `pprof` showed elevated time in `(*Limiter).Allow` — but the function body was just `atomic.AddInt64` plus a time comparison. The function was three lines.
2. Tracing showed Allow taking variably 200ns to 4µs per call. The variance was the smoking gun: when the cache line is uncontended, the call is fast; when it bounces, slow.
3. `perf c2c` ran for 30 seconds in a staging environment showed two cache lines with combined 1.2M HITM events. Both lines were inside the `[]Limiter` slice that held per-account limiters.
4. The struct `Limiter` was `struct { last atomic.Int64; tokens atomic.Int64 }` — 16 bytes. Four limiters fit in a 64-byte line. Adjacent accounts (which often had correlated traffic) bounced their shared lines.

**Fix:**

```go
type Limiter struct {
    last   atomic.Int64
    tokens atomic.Int64
    _pad   [48]byte // 16 + 48 = 64
}
```

**Verification:**

- `unsafe.Sizeof(Limiter{})` test: 64 bytes.
- Benchmark with simulated correlated load: 5x faster.
- Re-ran `perf c2c`: HITMs dropped from 1.2M to 12K. Background level.
- Staging deploy: p99 latency dropped from 22ms to 5ms.
- Production deploy: same.

**Cost:** 48 bytes per Limiter × 8 million accounts = 384 MB extra RSS. Acceptable given the 5x latency improvement.

**Lesson:** A 16-byte struct in a hot array looks innocuous. But cache-line layout is invisible at the source level — and four-objects-per-line is exactly the configuration that maximises false sharing. The fix is mechanical; the diagnosis took two engineers a day.

We added a code review rule: any struct containing `atomic.*` fields that ends up in a `[]T` or `map[K]T` must either be padded to 64 bytes or include a comment explaining why padding is unnecessary.

---

## Appendix J: Self-Assessment (Middle Level, Extended)

- [ ] I can read `perf c2c` output and interpret the columns.
- [ ] I can identify the cache-line size for at least four CPU architectures.
- [ ] I can implement a sharded counter that scales linearly to GOMAXPROCS.
- [ ] I can walk through the Vyukov MPMC queue and explain every padding decision.
- [ ] I can distinguish false sharing from lock contention, working-set blowup, and channel contention.
- [ ] I can compare Go's hand-padding approach to Java's `@Contended` and Rust's `CachePadded`.
- [ ] I can run a code review of concurrent code and flag false-sharing risks.
- [ ] I have read at least three Go runtime source files where padding is used.
- [ ] I have personally witnessed and fixed a false-sharing bug in production code (or a realistic simulation).
- [ ] I know when not to pad and can articulate the cost of padding.

---

## Appendix K: Padding Patterns in the Go Runtime Source

The Go runtime is the largest body of cache-line-aware Go code in existence. At middle level, you should be able to navigate it and recognise the patterns. Here is a guided tour of the most instructive sites.

### Pattern 1: Trailing pad with size computation

The most common idiom in the runtime:

```go
// src/sync/pool.go (paraphrased)
type poolLocalInternal struct {
    private any
    shared  poolChain
}

type poolLocal struct {
    poolLocalInternal
    pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}
```

Read carefully:
- `poolLocalInternal` is the *real* per-P data.
- `poolLocal` adds a trailing `pad` whose size is computed at compile time to round the total size to a multiple of 128.
- `unsafe.Sizeof(poolLocalInternal{})%128` gives the "leftover" bytes; subtracting from 128 gives the pad needed.
- If `poolLocalInternal` is exactly 128 bytes, the pad is `[0]byte` — no overhead.

Why 128 and not 64? Intel adjacent-line prefetch. The L2 prefetcher may pull line N+1 when line N is touched; padding to 128 keeps the next struct outside the prefetch range.

### Pattern 2: Architecture-conditional constant

```go
// src/runtime/internal/sys/intrinsics.go (paraphrased)
const CacheLinePadSize = 64

// On ppc64, this is 128 (via build-tagged file).
```

The constant `CacheLinePadSize` is used throughout the runtime as the basis for padding computations. On ppc64 it is overridden to 128 via a separate `_ppc64.go` file with build tags.

User code can follow the same idiom:

```go
// pad_amd64.go (build tag: amd64 || arm64)
package mylib
const cacheLinePad = 64

// pad_ppc64.go (build tag: ppc64 || ppc64le)
package mylib
const cacheLinePad = 128
```

### Pattern 3: Leading + trailing pad

```go
// src/runtime/sema.go (paraphrased)
var semtable [semTabSize]struct {
    root semaRoot
    pad  [cpu.CacheLinePadSize - unsafe.Sizeof(semaRoot{})%cpu.CacheLinePadSize]byte
}
```

The `semtable` array has 251 entries (a prime, chosen to spread hash collisions). Each entry is one semaphore queue + padding to a cache line. The pad ensures sibling queues do not share lines.

The leading pad is absent here because the semaRoot itself starts the entry; the trailing pad protects the next entry. This is the canonical "padded array" pattern.

### Pattern 4: Sandwich padding

```go
type producerConsumer struct {
    _pad0 [64]byte
    head  atomic.Uint64
    _pad1 [56]byte
    tail  atomic.Uint64
    _pad2 [56]byte
}
```

Three pads: before head (to isolate from previous memory), between head and tail (to isolate the two fields from each other), and after tail (to isolate from next memory).

This is the pattern for *any* producer/consumer queue where head and tail are written by different actors. The Vyukov queue uses it.

### Pattern 5: Inline padding by field placement

Sometimes the runtime puts a large field between two hot fields, exploiting the large field's size as padding:

```go
type something struct {
    hotA   atomic.Int64
    bigArr [128]byte  // serves as padding
    hotB   atomic.Int64
}
```

This is fragile (what if `bigArr` later shrinks?) and is generally avoided in favour of explicit `_pad` fields. But you will see it in older runtime code.

### Pattern 6: Padding via embedding

```go
type withPad struct {
    _ [64]byte
}

type Counter struct {
    withPad
    v atomic.Int64
}
```

Using a separate `withPad` type makes the padding intention explicit. This is rare but readable.

### How to find more

Grep the runtime source for `pad` and `cacheLine`:

```
$ grep -rn "pad" /usr/local/go/src/runtime/*.go | grep -i "cache\|byte"
$ grep -rn "CacheLine" /usr/local/go/src/
```

You will find ~50 occurrences. Read each in context. Each is a small lesson in cache-aware design.

---

## Appendix L: Detection Toolchain Walkthrough

Middle-level engineers should be fluent with the following tools. This appendix walks through each one's role.

### `go test -bench` (the workhorse)

Standard Go benchmarking. Used for *before/after* comparison.

```
$ go test -bench=BenchmarkAdjacent -benchmem -cpu=1,2,4,8 -count=5 .
BenchmarkAdjacent-1     200000000     6.4 ns/op    0 B/op    0 allocs/op
BenchmarkAdjacent-2     100000000    18.2 ns/op    0 B/op    0 allocs/op
BenchmarkAdjacent-4      50000000    62.1 ns/op    0 B/op    0 allocs/op
BenchmarkAdjacent-8      20000000   142.8 ns/op    0 B/op    0 allocs/op
```

The number after the dash is `GOMAXPROCS`. Notice the regression: ns/op *increases* with more cores. That is the false-sharing signature.

```
$ go test -bench=BenchmarkPadded -benchmem -cpu=1,2,4,8 -count=5 .
BenchmarkPadded-1      200000000     6.5 ns/op
BenchmarkPadded-2      400000000     3.2 ns/op
BenchmarkPadded-4      800000000     1.6 ns/op
BenchmarkPadded-8     1500000000     0.8 ns/op
```

Linear scaling: ns/op halves with each doubling of cores. Throughput scales linearly.

Use `-count=5` (or more) to get statistical confidence. Use `-benchtime=10s` for longer runs that reduce variance.

### `benchstat` (statistical comparison)

```
$ go test -bench=. -count=10 . > old.txt
# apply fix
$ go test -bench=. -count=10 . > new.txt
$ benchstat old.txt new.txt
name              old time/op  new time/op  delta
Adjacent-8         142ns ± 3%   1.2ns ± 2%  -99.16%  (p=0.000 n=10+10)
```

`benchstat` (install via `go install golang.org/x/perf/cmd/benchstat@latest`) computes mean, variance, and statistical significance. A `p=0.000` with `n=10+10` is publication-quality evidence of a real difference.

### `perf stat` (hardware counters)

```
$ perf stat -e cache-misses,cache-references,LLC-load-misses,LLC-loads,instructions go test -bench=BenchmarkAdjacent
```

Output:
```
cache-misses:        2,398,124,123
cache-references:    3,012,891,231
LLC-load-misses:       412,182,001
LLC-loads:           1,891,029,123
instructions:        8,712,981,231

CPU utilisation:     7.94 CPUs
elapsed:             3.1 seconds
```

Compute ratios:
- cache miss rate: 2.4e9 / 3.0e9 = 80%. Very high. Healthy code is 1-5%.
- LLC miss rate: 4.1e8 / 1.9e9 = 22%. High; coherence misses.
- Cycles per instruction (CPI): if total cycles ≈ 7.94 × 3.1s × 3e9 = 7.4e10, CPI = 7.4e10 / 8.7e9 = 8.5. Very high (good code is 1-2).

High cache miss rate + high LLC miss rate + high CPI is the classic false-sharing fingerprint.

### `perf record` + `perf report` (function-level attribution)

```
$ perf record -g -F 4000 go test -bench=BenchmarkAdjacent
$ perf report
```

Shows CPU samples by function. False-sharing-impacted functions appear with high self-time even though their bodies are short.

### `perf c2c` (the gold standard)

Covered in Appendix A. Use whenever you suspect cache-line contention.

### `pprof -mutex` and `-block`

Indirect signals. Lock-protected critical sections that contain atomics on contended lines show inflated hold times.

### `runtime/trace`

```go
trace.Start(file)
... do work ...
trace.Stop()
```

```
$ go tool trace trace.out
```

The trace viewer shows per-goroutine timelines. Look for unexpectedly long execution times on tiny critical sections; those are cache-stall amplifications.

### Choosing the right tool

| Symptom | Tool |
|---------|------|
| Don't know if false sharing exists | `go test -bench -cpu=...` (scaling test) |
| Suspect but unsure where | `perf c2c` |
| Confirmed false sharing, want to fix | Benchmarks + `unsafe.Sizeof` tests |
| Verifying fix worked | `benchstat` of before/after |
| Production diagnosis | `perf c2c` on a sampled production host |
| Layer through Go-level | `pprof -mutex`, `runtime/trace` |

Pick the right tool for the question. A middle-level engineer knows when to escalate from Go-native (`pprof`) to Linux-native (`perf`).

---

## Appendix M: A Mental Model for Cache Lines

The hardest part of false sharing is developing the right mental model. Here is a model that has worked for the engineers I have mentored.

### The "shared notebook" metaphor

Imagine a notebook that can be in one office at a time. Multiple people want to write notes in it:

- If only one person writes, they keep the notebook on their desk. Fast.
- If two people in different offices write in different pages, they take turns carrying the notebook between offices. Slow.

In this metaphor:
- "Notebook" = cache line.
- "Office" = CPU core's L1 cache.
- "Pages" = bytes within the line.

Different people writing on *different pages of the same notebook* is exactly false sharing: they don't conflict on data, but they conflict on possession of the notebook.

The fix: give each person their own notebook. That is padding.

### The "highway lane" metaphor (for adjacency)

Imagine an 8-lane highway. Cars in adjacent lanes can affect each other (changing lanes, slipstreaming). A driver in lane 1 affects the driver in lane 2 even if they never collide.

Cache lines are 64-byte lanes. Variables in adjacent bytes are in the same lane: they affect each other's "traffic" (cache coherence). Padding moves variables into separate lanes.

### The "physical book" metaphor (for coherence protocols)

A library has multiple copies of a popular book. Readers can have copies simultaneously. But if someone writes in their copy, all other copies must be destroyed and the new content distributed.

MESI is exactly this:
- M = the only copy, marked up.
- E = the only copy, unmarked.
- S = shared copies, all identical.
- I = the copy was destroyed.

The cost of writing comes from forcing all other copies to be destroyed. Padding lets multiple people have their own books on related but separate topics.

### Which model to use

The notebook model is best for newcomers (concrete, mechanical).
The highway model is best for understanding adjacency (lanes vs bytes).
The library model is best for understanding MESI states (copies + invalidation).

Use whichever clicks. Internalise one well; the others will follow.

---

## Appendix N: Patterns in Other Go Libraries

The standard library and runtime use padding. So do major third-party Go libraries. Here are some examples to study.

### `golang.org/x/sync/singleflight`

The `Group` type uses a per-key map of in-flight calls. The map itself is mutex-protected. No padding needed because the lock dominates contention.

Lesson: not every concurrent data structure needs padding. Lock-heavy designs do not benefit.

### `go.uber.org/atomic` (legacy)

Older versions of Uber's atomic library provided `Int64` with padding built in. The Go 1.19+ standard library's `atomic.Int64` does *not* include padding (it is just an 8-byte value). The Uber library was a stopgap that became unnecessary.

Lesson: read the source of libraries you depend on. Their padding decisions reflect their assumptions about caller usage.

### `github.com/cockroachdb/pebble`

A high-performance key-value store. Their cache implementation has explicit padding on shard structures.

```go
// pebble/cache (paraphrased)
type cacheShard struct {
    ... // hot fields
    _pad [unused-cacheline]byte
}
```

Pebble's developers tune cache-line awareness aggressively because pebble runs as the storage layer for CockroachDB and YugabyteDB — single-server performance directly affects database performance.

### `github.com/dgraph-io/ristretto`

Ristretto is an in-memory cache. Their `policy` and `store` types are padded.

```go
// ristretto (paraphrased)
type itemStore struct {
    mu   sync.RWMutex
    data map[uint64]value
    _    [pad]byte
}
```

The pad ensures adjacent shards' RWMutex state words don't bounce.

### `go.opencensus.io`

OpenCensus (now OpenTelemetry) instrumentation library. Their stats counters are padded.

```go
// opencensus/stats (paraphrased)
type counter struct {
    v atomic.Int64
    _ [56]byte
}
```

Lesson: every observability library worth its salt has padded counters. Counters are written on every request; without padding they would be a major source of overhead.

### Pattern: when to look for padding

When evaluating a Go library for performance-critical use:

1. Check if hot atomic counters are padded. If not, suspect false-sharing issues at high concurrency.
2. Check if sharded data structures pad shards.
3. Check the benchmark suite. If they only test at GOMAXPROCS=1, scaling issues may be hidden.

A library that does not pad and does not benchmark at high core counts is a yellow flag. Not always wrong, but worth investigating.

---

## Appendix O: An Expanded Reading Plan

For a middle-level engineer wanting to deepen this skill over six months:

### Month 1: Foundations

- Re-read junior.md end-to-end.
- Run all benchmarks; record numbers; chart results.
- Read `src/sync/pool.go` and explain every line of `poolLocal`.

### Month 2: Runtime

- Read `src/runtime/sema.go`, `src/runtime/proc.go`.
- Find every `_ [...]byte` or `_pad` in the runtime; explain each.
- Write a blog post (internal or external) summarising what you learned.

### Month 3: Third-party

- Read three high-performance Go libraries (pebble, ristretto, fastcache, ants, valyala/fasthttp).
- Identify their padding patterns.
- Compare and contrast.

### Month 4: Tools

- Install and learn `perf c2c`, `pmu-tools`, `pprof`.
- Run them on a real production service (with permission).
- Document what you find.

### Month 5: Original work

- Identify a false-sharing issue in code at your company.
- Fix it. Measure. Write a PR with benchmarks.
- Submit a postmortem.

### Month 6: Teaching

- Mentor a junior engineer through the junior.md content.
- Run the lab in Appendix E of junior.md.
- Watch them have the "aha" moment.

After six months of this you will be confidently middle-level. After a year you will be senior on this topic.

---

## Appendix P: Self-Assessment (Middle Level, Final)

- [ ] I can explain MESI states and transitions in one paragraph.
- [ ] I can implement a Vyukov MPMC queue with correct padding.
- [ ] I can read `perf c2c` output and identify the offending line and function.
- [ ] I can run a scaling benchmark and interpret the curve.
- [ ] I know the cache-line size for at least four CPU architectures.
- [ ] I can compare Go's hand-padding to Java's `@Contended` and Rust's `CachePadded`.
- [ ] I have read at least three runtime source files where padding is used.
- [ ] I can mentor a junior through diagnosing and fixing a false-sharing bug.
- [ ] I have a code-review checklist I apply consistently.
- [ ] I know when *not* to pad.

---

## Appendix Q: Detailed Walkthroughs of Common Patterns

### Walkthrough 1: A Concurrent Histogram (full design and code)

The goal: a histogram type that supports millions of `Observe` calls per second across many goroutines, with fast `Snapshot` reads.

#### Naive (broken) version

```go
type NaiveHistogram struct {
    buckets [256]atomic.Uint64
}

func (h *NaiveHistogram) Observe(v uint64) {
    h.buckets[bucketIndex(v)].Add(1)
}

func (h *NaiveHistogram) Snapshot() [256]uint64 {
    var out [256]uint64
    for i := range h.buckets {
        out[i] = h.buckets[i].Load()
    }
    return out
}
```

Problem: bucket indices are dense; observations cluster into a few hot buckets. Those buckets' atomic.Uint64 fields are 8 bytes each — 8 fit per cache line. Hot buckets bounce.

Worse: even buckets that are not individually contended share cache lines with buckets that are. The whole histogram becomes a coherence bottleneck.

#### Sharded version

```go
const numShards = 16 // power of two

type ShardedHistogram struct {
    shards [numShards]struct {
        buckets [256]atomic.Uint64
        _pad    [128]byte // protect from neighbour shard
    }
}

func (h *ShardedHistogram) Observe(v uint64) {
    // Spread observations across shards by combining the value with a
    // per-call-site quasi-random source.
    shard := shardIndex() & (numShards - 1)
    h.shards[shard].buckets[bucketIndex(v)].Add(1)
}

func shardIndex() uint64 {
    var x int
    return uint64(uintptr(unsafe.Pointer(&x))) >> 8
}

func (h *ShardedHistogram) Snapshot() [256]uint64 {
    var out [256]uint64
    for s := range h.shards {
        for b := range h.shards[s].buckets {
            out[b] += h.shards[s].buckets[b].Load()
        }
    }
    return out
}
```

Each shard is 256 × 8 = 2048 bytes + 128 padding = 2176 bytes. Adjacent shards do not share cache lines (the buckets array itself spans 32 cache lines, so adjacency at line level is only at the boundaries — the trailing pad handles that).

Throughput scales with `numShards`. For 16-core boxes, 16 shards balance the contention; one core has roughly 1/16 of the work per shard.

#### Per-P version (faster but more complex)

```go
type PerPHistogram struct {
    perP []struct {
        buckets [256]uint64 // non-atomic; written only by owning P
        _pad    [128]byte
    }
}

func NewPerPHistogram() *PerPHistogram {
    return &PerPHistogram{
        perP: make([]struct {
            buckets [256]uint64
            _pad    [128]byte
        }, runtime.GOMAXPROCS(0)),
    }
}

func (h *PerPHistogram) Observe(v uint64) {
    pid := runtime_procPin()
    h.perP[pid].buckets[bucketIndex(v)]++
    runtime_procUnpin()
}

func (h *PerPHistogram) Snapshot() [256]uint64 {
    var out [256]uint64
    for i := range h.perP {
        for b := range h.perP[i].buckets {
            // Reader uses atomic.LoadUint64 on what is normally non-atomic;
            // safe because writes are word-aligned and pinned. Race detector
            // will flag this; disable race for these tests or use atomic
            // stores in the writer.
            out[b] += atomic.LoadUint64(&h.perP[i].buckets[b])
        }
    }
    return out
}
```

No atomics on the write path. ~3-5ns per observe. Single-writer per P guarantees correctness in the sense that no `lost-update` race occurs from concurrent writers (no concurrent writers).

The race detector complains. To make it race-free, use atomic adds in the writer; ~2x slower but still very fast.

#### Benchmark comparison

On a 32-core amd64 box:

```
BenchmarkNaiveHistogram-32        50M obs/sec
BenchmarkShardedHistogram-32     500M obs/sec
BenchmarkPerPHistogram-32       2000M obs/sec
```

40x speedup from naive to per-P. The cost is design complexity and slight read lag.

### Walkthrough 2: A Producer-Consumer Queue (SPSC)

Single producer, single consumer. The producer writes `head`; the consumer writes `tail`. They must be on separate cache lines.

```go
type SPSCQueue struct {
    _pad0   [64]byte
    buffer  []unsafe.Pointer
    mask    uint64
    _pad1   [40]byte // 24 (slice) + 8 (mask) + 40 = 64 from _pad0
    head    atomic.Uint64
    _pad2   [56]byte
    tail    atomic.Uint64
    _pad3   [56]byte
}

func NewSPSCQueue(size uint64) *SPSCQueue {
    if size&(size-1) != 0 {
        panic("size must be power of two")
    }
    return &SPSCQueue{
        buffer: make([]unsafe.Pointer, size),
        mask:   size - 1,
    }
}

func (q *SPSCQueue) Push(v unsafe.Pointer) bool {
    head := q.head.Load()
    tail := q.tail.Load() // consumer's pos; we read in S state
    if head-tail >= uint64(len(q.buffer)) {
        return false
    }
    q.buffer[head&q.mask] = v
    q.head.Store(head + 1)
    return true
}

func (q *SPSCQueue) Pop() (unsafe.Pointer, bool) {
    tail := q.tail.Load()
    head := q.head.Load() // producer's pos; we read in S state
    if head == tail {
        return nil, false
    }
    v := q.buffer[tail&q.mask]
    q.tail.Store(tail + 1)
    return v, true
}
```

Annotations:

- `_pad0` protects the queue from whatever comes before in memory.
- `_pad1` protects the slice header + mask from `head`.
- `_pad2` is critical: it separates head (producer writes) from tail (consumer writes). Without this padding, every push invalidates the consumer's tail line.
- `_pad3` protects from what follows in memory.

Performance: > 100M ops/sec on a single core; bounded by the buffer write itself. Latency: < 50ns end-to-end.

This is the building block for many high-throughput Go subsystems: per-thread logging buffers, hot-path metric collection, lock-free pipelines.

### Walkthrough 3: A Sharded Map (without sync.Map)

`sync.Map` has well-documented limitations. For high-write, sharded-by-key workloads, a custom design often outperforms.

```go
type ShardedMap struct {
    shards []shard
    mask   uint64
}

type shard struct {
    mu   sync.RWMutex
    data map[string]any
    _pad [64 - unsafe.Sizeof(sync.RWMutex{}) - unsafe.Sizeof(map[string]any(nil))%64]byte
}

func NewShardedMap(numShards int) *ShardedMap {
    sz := 1
    for sz < numShards {
        sz <<= 1
    }
    m := &ShardedMap{
        shards: make([]shard, sz),
        mask:   uint64(sz - 1),
    }
    for i := range m.shards {
        m.shards[i].data = make(map[string]any)
    }
    return m
}

func (m *ShardedMap) shardFor(key string) *shard {
    h := fnv32(key)
    return &m.shards[uint64(h)&m.mask]
}

func (m *ShardedMap) Get(key string) (any, bool) {
    s := m.shardFor(key)
    s.mu.RLock()
    v, ok := s.data[key]
    s.mu.RUnlock()
    return v, ok
}

func (m *ShardedMap) Set(key string, value any) {
    s := m.shardFor(key)
    s.mu.Lock()
    s.data[key] = value
    s.mu.Unlock()
}

func fnv32(s string) uint32 {
    const offset = 2166136261
    const prime = 16777619
    h := uint32(offset)
    for i := 0; i < len(s); i++ {
        h ^= uint32(s[i])
        h *= prime
    }
    return h
}
```

Notes:

- Each shard has its own RWMutex and map.
- Padding to 64 bytes per shard prevents adjacent shards' lock state from false-sharing.
- FNV-32 is fast enough and spreads keys well.

Performance vs sync.Map:

- Read-heavy: comparable.
- Write-heavy: 3-5x faster (sync.Map's write path is more expensive).
- Mixed: depends on workload.

When to use sync.Map: cases with high read/write ratio and entries that are mostly written once then read many times. When to use this sharded design: high write throughput, balanced read/write, or when you need to iterate efficiently.

---

## Appendix R: Padding Computations

A middle-level engineer must be able to compute padding sizes correctly. Common confusions:

### Computation 1: Trailing pad to round to N

```go
type x struct {
    /* fields */
    _pad [N - unsafe.Sizeof(/* fields type */)%N]byte
}
```

But `unsafe.Sizeof` of an anonymous struct type is awkward. The idiomatic way:

```go
type xInternal struct {
    /* fields */
}

type x struct {
    xInternal
    _pad [N - unsafe.Sizeof(xInternal{})%N]byte
}
```

Now `unsafe.Sizeof(xInternal{})` is a compile-time constant. The total size of `x` is rounded up to a multiple of N.

If `unsafe.Sizeof(xInternal{}) % N == 0`, the pad is `[0]byte` — zero-length, no overhead.

### Computation 2: Leading and trailing pad

```go
type Counter struct {
    _pad0 [N]byte
    v     atomic.Int64
    _pad1 [N - unsafe.Sizeof(atomic.Int64{})]byte
}
```

This puts `v` at offset N (one full pad in), and pads after to fill another N. Total: 2N.

Use case: when you need *both* leading and trailing protection. Often overkill; the leading pad is unnecessary if the struct is allocated by `make` (which provides 8-byte alignment) and you accept that the struct might start mid-line for the leading pad bytes.

### Computation 3: Pad between fields

```go
type pair struct {
    a    atomic.Int64
    _pad [N - unsafe.Sizeof(atomic.Int64{})]byte
    b    atomic.Int64
}
```

After `a`, the pad fills out a full cache line. `b` starts at offset N (the next line). Two atomics on different lines.

This is the "sandwich" pattern.

### Computation 4: When alignof matters

Go aligns each field to its type's alignment. `atomic.Int64` has alignof = 8. If you have:

```go
type x struct {
    a atomic.Int32 // 4 bytes, alignof 4
    b atomic.Int64 // 8 bytes, alignof 8
}
```

The compiler inserts 4 bytes of implicit padding after `a` to align `b`. `unsafe.Offsetof(x{}.b)` is 8, not 4.

This implicit padding does not count as cache-line protection. You still need to add explicit pad if `a` and `b` should be on separate lines.

### Computation 5: 32-bit vs 64-bit

On 32-bit architectures (rare for Go in production), pointer size is 4 bytes. A `map[K]V` header is 4 bytes (pointer to map struct). A `[]T` slice header is 12 bytes (4 + 4 + 4).

Padding computations that use `unsafe.Sizeof` work on any architecture. Hand-coded `[24]byte` constants for slice headers are wrong on 32-bit.

Rule: use `unsafe.Sizeof`. Avoid literal sizes.

### Computation 6: When padding fails compile

```go
type x struct {
    a atomic.Int64
    _pad [N - unsafe.Sizeof(x{})]byte // ERROR: recursive
}
```

You cannot use `unsafe.Sizeof(x{})` inside the definition of `x`. Workaround: define an internal type without the pad, then wrap:

```go
type xInternal struct {
    a atomic.Int64
}

type x struct {
    xInternal
    _pad [N - unsafe.Sizeof(xInternal{})]byte
}
```

This pattern is what the runtime uses. Master it.

---

## Appendix S: Reading Code: A False-Sharing Spot-the-Bug

Below are five Go code snippets. For each, decide whether false sharing is likely, and where. Answers follow.

### Snippet 1

```go
type Worker struct {
    id        int
    queueLen  atomic.Int32
    processed atomic.Int64
}

var workers [64]Worker

func worker(idx int) {
    for {
        // ...
        workers[idx].processed.Add(1)
    }
}
```

### Snippet 2

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]Item
}

func main() {
    cache := &Cache{m: make(map[string]Item)}
    // Many goroutines access cache concurrently.
}
```

### Snippet 3

```go
type Counter struct {
    v    atomic.Int64
    _pad [56]byte
}

var counters []Counter

func main() {
    counters = make([]Counter, 100)
    // ...
}
```

### Snippet 4

```go
type Limiter struct {
    bucket atomic.Int64
    refill atomic.Int64
}

var limiters [1024]Limiter

func allow(idx int) bool {
    return limiters[idx].bucket.Add(-1) >= 0
}
```

### Snippet 5

```go
type pool struct {
    inUse atomic.Int32
    free  atomic.Int32
}

var p pool // singleton

func acquire() {
    p.inUse.Add(1)
}

func release() {
    p.inUse.Add(-1)
    p.free.Add(1)
}
```

### Answers

**Snippet 1:** False sharing likely. `Worker` is 16 bytes (id=8 + queueLen=4 + processed=8, with 4 bytes implicit padding between queueLen and processed). Four Workers fit per cache line. Concurrent `processed.Add(1)` calls bounce lines. Fix: pad Worker to 64 bytes.

**Snippet 2:** False sharing unlikely on Cache itself (singleton). But internal sync.Map-like behaviour might have issues. The Cache struct is small (24 + 8 = 32 bytes) and singleton; no false-sharing risk.

**Snippet 3:** No false sharing. Each Counter is exactly 64 bytes (8 + 56). Adjacent counters on separate lines.

**Snippet 4:** False sharing likely. `Limiter` is 16 bytes (two atomic.Int64). Four Limiters per cache line. Concurrent allow() on different limiters bounce. Fix: pad Limiter to 64.

**Snippet 5:** `inUse` and `free` are on the same line (both atomic.Int32, 8 bytes total). But they are part of a singleton — there is only one `p`. Concurrent acquire/release writers to the same struct cause real contention (true sharing on inUse), and write to both fields on release causes some cross-field bouncing. Padding between them might help slightly but the bigger issue is contention on the single inUse counter. Sharding might be better than padding here.

### Score yourself

5/5: well on your way to senior.
3-4/5: solid middle level.
0-2/5: re-read the file; practice on more snippets.

---

## Appendix T: Code Reading Practice — Real-World Examples

Read these real Go projects' source and identify their cache-line awareness patterns. This is the homework that transitions middle to senior level.

### Project 1: Go runtime `sync/pool.go`

```
$ go env GOROOT
$ less $GOROOT/src/sync/pool.go
```

Find:
- The `poolLocal` struct.
- The padding line.
- The `pin()` function's use of P index.
- The shared deque's lock-free operations.

Answer in your notes: why is the padding 128 not 64?

### Project 2: Go runtime `runtime/sema.go`

```
$ less $GOROOT/src/runtime/sema.go
```

Find:
- The `semTable` array.
- The padding per entry.
- The use of `cpu.CacheLinePadSize`.

Answer: how many semaphore queues are there, and why that number?

### Project 3: CockroachDB (`github.com/cockroachdb/cockroach`)

```
$ git clone https://github.com/cockroachdb/cockroach
$ cd cockroach
$ grep -rn "cacheLine\|_pad" pkg/util/
```

Find at least three padding sites. Read their context.

### Project 4: Caddy server (`github.com/caddyserver/caddy`)

```
$ git clone https://github.com/caddyserver/caddy
$ grep -rn "atomic\." | head -50
```

Look at how Caddy uses atomics. Does it pad? Should it pad more?

### Project 5: gRPC-Go

```
$ git clone https://github.com/grpc/grpc-go
$ grep -rn "atomic\." | grep -v test | head -50
```

Examine the connection-tracking and stats-collection code. Are there padded structures? If not, where might false sharing occur?

### Goal

After reading these, write a one-page memo: "Padding patterns in production Go." Compare across projects. Note inconsistencies. Propose improvements.

This kind of exercise transforms middle into senior over a few weeks.

---

## Appendix U: Frequently Asked Questions

**Q: My benchmark shows 5x slowdown adding more cores. Is this false sharing?**
A: Probably. Run `perf c2c` to confirm. Other possibilities: lock contention (use `pprof -mutex`), GC pressure (check MemStats), or memory bandwidth saturation (`perf stat -e cycles,instructions,LLC-misses`).

**Q: How much padding is enough?**
A: 64 bytes on amd64/arm64; 128 on ppc64 and to defend against Intel adjacent-line prefetch. Use 128 if portability matters and memory is cheap.

**Q: Should I pad every atomic in my code?**
A: No. Only pad atomics that are *concurrently written* by multiple cores. Read-mostly atomics, single-writer atomics, and rarely-touched atomics do not need padding.

**Q: Does padding hurt cache utilization?**
A: Yes, marginally. Padding adds to working set size, which can cause L1 evictions. The tradeoff is usually favourable for hot atomics — saving 100 cycles per write trumps using a few extra cache lines.

**Q: Why doesn't Go have a built-in `CachePadded` type?**
A: Cultural preference for explicit layout, no community consensus on the right API, and the runtime team has not prioritised it. Hand-padding is the convention.

**Q: Is sync.Mutex padded?**
A: No. `sync.Mutex` is 8 bytes. In an array of mutexes, adjacent mutexes false-share. Pad the *container* (e.g., a `[]Lock` of padded mutex wrappers).

**Q: Are channels padded?**
A: No. Channels rely on internal locking; cache-line bouncing is bounded by lock-hold time. Padding would not help much.

**Q: What about `runtime_procPin`?**
A: An internal runtime API for per-P access. Use only when measurement justifies it. Requires `//go:linkname`. Disables preemption — keep regions short.

**Q: Should padding go before or after the hot field?**
A: After is more common (struct ends with pad). Before makes sense if you have specific alignment requirements. Both work; just be consistent.

**Q: Can I use `[]byte` instead of `[N]byte`?**
A: No. `[]byte` is a slice header (24 bytes plus the heap-allocated backing array). You want array padding `[N]byte`, which is inline in the struct.

---

## Appendix V: Glossary Extension (Middle+)

| Term | Definition |
|------|-----------|
| **MESI** | Modified-Exclusive-Shared-Invalid; the most common cache-coherence protocol. |
| **MOESI** | MESI + Owner state, used by AMD. Reduces writeback traffic for shared-modified lines. |
| **MESIF** | MESI + Forward state, used by Intel servers. Optimises broadcast for read-shared lines. |
| **HITM** | "Hit Modified"; a cache event where a load finds the line in another core's M state. The hallmark of false sharing. |
| **NUMA** | Non-Uniform Memory Access; multi-socket systems where memory access cost varies by socket. |
| **UPI / Infinity Fabric** | Intel's and AMD's inter-socket interconnects. Carry cache-coherence traffic. |
| **Adjacent-line prefetch** | Intel L2 prefetcher that fetches line N+1 when line N is touched. Motivates 128-byte padding. |
| **SPSC / MPSC / SPMC / MPMC** | Single/Multi Producer/Consumer queue variants. Different padding requirements per variant. |
| **`perf c2c`** | Linux perf subcommand that records and reports cache-line contention events. |
| **`pmu-tools`** | Andi Kleen's wrappers around perf for high-level analysis (toplev.py, ocperf.py). |
| **`runtime_procPin`** | Internal Go runtime function to disable preemption and get P index. |
| **`unsafe.Sizeof`** | Compile-time-constant size of a type. Use for portable padding. |
| **`unsafe.Alignof`** | Compile-time-constant alignment of a type. Smaller than cache line for atomics. |
| **`atomic.Pointer[T]`** | Generic atomic pointer (Go 1.19+). Useful for whole-snapshot publication. |
| **LongAdder** | Java pattern for high-throughput counters via sharded sum. Same idea as our SharedCounter. |
| **Vyukov queue** | Dmitry Vyukov's bounded MPMC lock-free queue. Heavily padded. |

End of middle level.



