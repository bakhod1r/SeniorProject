---
layout: default
title: False Sharing — Optimize
parent: False Sharing
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/05-false-sharing/optimize/
---

# False Sharing — Optimization

> Each entry states the problem, shows a "before" snippet, an "after" snippet, and the realistic gain. Numbers are illustrative — always measure in your own code on your own hardware.

---

## Optimization 1 — Pad adjacent counters

**Problem.** Multiple goroutines incrementing different counters in a tight array cause cache-line bouncing. Throughput collapses to single-core speed.

**Before:**
```go
type Stats struct {
    counters [8]int64 // 64 bytes, one cache line
}

func (s *Stats) Inc(id int) {
    atomic.AddInt64(&s.counters[id], 1)
}
```
Throughput on 8 cores: ~5 M ops/sec total (essentially single-core).

**After:**
```go
type Stats struct {
    counters [8]struct {
        v int64
        _ [56]byte
    }
}

func (s *Stats) Inc(id int) {
    atomic.AddInt64(&s.counters[id].v, 1)
}
```
Throughput on 8 cores: ~1.6 B ops/sec total. **~320x speedup.**

**Memory cost.** From 64 bytes to 512 bytes. Acceptable for hot per-CPU counters.

---

## Optimization 2 — Shard a global counter

**Problem.** A single global `atomic.Int64` updated by all goroutines becomes a bottleneck under high contention.

**Before:**
```go
var totalRequests atomic.Int64

func handleRequest() {
    // ... handle ...
    totalRequests.Add(1)
}
```
At 1 M req/s with 16 cores: cache line bounces continuously; updates serialise at ~30 ns each = ~33 M ops/sec ceiling.

**After:**
```go
type Counter struct {
    shards []paddedInt64
}

type paddedInt64 struct {
    v atomic.Int64
    _ [56]byte
}

func New() *Counter {
    return &Counter{shards: make([]paddedInt64, runtime.GOMAXPROCS(0))}
}

func (c *Counter) Inc(shardID int) {
    c.shards[shardID%len(c.shards)].v.Add(1)
}

func (c *Counter) Value() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].v.Load()
    }
    return s
}
```
At 1 M req/s with 16 cores: each core updates its own shard at ~5 ns/op. Throughput ceiling: ~3 B ops/sec. **~100x improvement for write-heavy paths.**

**Read cost.** O(N) atomic loads where N = shard count. For 16 shards: ~80 ns per `Value()` call. Trivial for non-hot-path reads.

---

## Optimization 3 — Pad producer/consumer indexes in SPSC queues

**Problem.** A single-producer, single-consumer ring buffer with adjacent `head` and `tail` indices. Producer writes head; consumer writes tail. Every message bounces the line.

**Before:**
```go
type Ring struct {
    head, tail uint64
    buf        []byte
}
```
Throughput: ~50 M messages/sec.

**After:**
```go
type Ring struct {
    head atomic.Uint64
    _    [56]byte
    tail atomic.Uint64
    _    [56]byte
    buf  []byte
}
```
Throughput: ~150 M messages/sec. **3x improvement.**

The improvement is "only" 3x (not 20x) because the producer also reads tail occasionally (for the full check), and vice versa — some line touches are unavoidable. But the bulk of the writes no longer bounce.

---

## Optimization 4 — Batched increments

**Problem.** Per-event atomic increments are expensive under contention. If the read latency requirements are loose, batching reduces the atomic op count.

**Before:**
```go
for _, item := range items {
    process(item)
    counter.Add(1)
}
```
Cost: one atomic per item. For 1 M items: ~5 ns × 1 M = 5 ms baseline + contention.

**After:**
```go
var local int64
for _, item := range items {
    process(item)
    local++
}
counter.Add(local)
```
Cost: one atomic per *batch*. For the same 1M items: ~5 ns baseline + contention (single bounce instead of 1M).

**Gain.** Up to 1000x reduction in atomic-op count. Limited by how often you flush (every N items or every M nanoseconds).

**Tradeoff.** Reads see lag up to one batch interval. For latency-sensitive readings (e.g., a rate limiter), batching is unacceptable.

---

## Optimization 5 — Per-goroutine local cache, periodic flush

**Problem.** Many goroutines all updating a shared counter, even sharded, can saturate.

**Before:**
```go
func handler(c *Counter) {
    for /* event in stream */ {
        c.Inc(currentShardID())
    }
}
```
Cost: per-event atomic. Even with sharding, contention possible if goroutines on the same shard.

**After:**
```go
type Local struct {
    n int64
}

func (l *Local) Add(n int64) { l.n += n }

func (l *Local) Flush(c *Counter) {
    c.Add(currentShardID(), l.n)
    l.n = 0
}

func handler(c *Counter) {
    var local Local
    defer local.Flush(c)
    for /* event in stream */ {
        local.Add(1)
        if local.n >= 1000 {
            local.Flush(c)
        }
    }
}
```
Each goroutine accumulates locally, flushes in batches of 1000. Atomic operations reduced by 1000x.

**Gain.** Effectively eliminates per-event contention for batch-friendly workloads.

---

## Optimization 6 — Per-P pinning via `runtime_procPin`

**Problem.** Even sharded counters use atomic operations, which have a base cost (~5 ns) per write. For ultra-hot paths, even this is too much.

**Before:**
```go
type Stats struct {
    shards []paddedInt64
}

func (s *Stats) Inc(shardID int) {
    s.shards[shardID].v.Add(1)
}
```
Cost: ~5 ns per increment, even uncontended.

**After:**
```go
//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int
//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

type Stats struct {
    shards []shard
}

type shard struct {
    n int64
    _ [56]byte
}

func (s *Stats) Inc() {
    p := runtime_procPin()
    s.shards[p].n++  // no atomic; pinned to P
    runtime_procUnpin()
}
```
Cost: ~2 ns per increment. **~2-3x improvement** over atomic.

**Tradeoff.** Pinning disables preemption; long pins disrupt scheduling. Pin only for very short critical sections.

---

## Optimization 7 — Read-mostly publishing pattern

**Problem.** A configuration value is read by all goroutines on the hot path and occasionally updated. Even an atomic read costs more than an unsynchronised one.

**Before:**
```go
var cfg atomic.Pointer[Config]

func hotPath() {
    c := cfg.Load() // atomic load
    use(c)
}
```
Cost: atomic load on every access (~5 ns).

**After:**
```go
// Use an immutable Config and a pointer that's written rarely.
// Readers cache the pointer in a local variable.
var cfg atomic.Pointer[Config]

func hotPath() {
    c := cfg.Load()
    // ...many uses of c without re-loading...
    use(c)
    use2(c)
    use3(c)
}
```
The first load is ~5 ns; subsequent uses of `c` are register/L1 reads (~1 ns).

**Gain.** Amortises the atomic load over many uses.

**Pattern.** "Read once, use many." Captures the immutable snapshot in a local variable.

---

## Optimization 8 — Hierarchical aggregation

**Problem.** A sharded counter with 1024 shards (per-CPU on a many-core system). Read aggregation costs O(1024) atomic loads ≈ 5 microseconds. Too slow for hot-path reads.

**Before:**
```go
func (c *Counter) Total() int64 {
    var t int64
    for i := range c.shards {
        t += c.shards[i].v.Load()
    }
    return t
}
```
Read cost: ~5 μs for 1024 shards.

**After:**
```go
type Counter struct {
    shards []paddedInt64
    cached atomic.Int64
}

func New() *Counter {
    c := &Counter{shards: make([]paddedInt64, 1024)}
    go c.refresher()
    return c
}

func (c *Counter) refresher() {
    for {
        time.Sleep(time.Millisecond)
        var t int64
        for i := range c.shards {
            t += c.shards[i].v.Load()
        }
        c.cached.Store(t)
    }
}

func (c *Counter) Total() int64 {
    return c.cached.Load()  // ~5 ns
}
```
Read cost: ~5 ns. **~1000x improvement** for read-heavy access.

**Tradeoff.** Bounded staleness (1 ms in this example). Adjustable.

---

## Optimization 9 — Pad mutex containers

**Problem.** An array of `Bucket` structs each containing a `sync.Mutex`. Two adjacent buckets share a cache line. Even though they have different mutexes, the line bounces when both are locked.

**Before:**
```go
type Bucket struct {
    sync.Mutex
    data []byte
}

var buckets [16]Bucket
```
Throughput per bucket under contention: depends on contention level, but reduced.

**After:**
```go
type Bucket struct {
    sync.Mutex
    data []byte
    _    [32]byte // pad to 64
}
```
Adjacent buckets are now on separate cache lines.

**Gain.** 1.5-3x for high-contention workloads.

---

## Optimization 10 — `sync.Pool` for short-lived per-CPU state

**Problem.** Allocating per-request scratch buffers in handlers under high concurrency. Each allocation goes through the allocator's per-CPU mcache; under heavy use, allocations contend on the central span list.

**Before:**
```go
func handler() {
    buf := make([]byte, 4096)
    // ... use buf ...
}
```
Cost: ~50 ns per allocation, plus GC pressure.

**After:**
```go
var pool = sync.Pool{
    New: func() interface{} { return make([]byte, 4096) },
}

func handler() {
    buf := pool.Get().([]byte)
    defer pool.Put(buf)
    // ... use buf ...
}
```
Cost: ~5-10 ns per Get/Put pair (after warmup).

**Gain.** 5-10x reduction in allocation cost. Crucially, `sync.Pool` is internally per-P and padded, so it doesn't introduce its own false sharing.

---

## Optimization 11 — Avoid `runtime.LockOSThread` unless necessary

**Problem.** Some code uses `runtime.LockOSThread` to ensure cache locality. But Go's scheduler is good at keeping goroutines on the same M (and the OS at keeping the M on the same core); explicit locking has costs.

**Before:**
```go
func worker() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    for /* work */ {
        // ...
    }
}
```
The locked goroutine cannot be migrated; if the M parks (e.g., syscall), throughput drops.

**After:**
```go
func worker() {
    for /* work */ {
        // ... let the scheduler handle migration ...
    }
}
```
The scheduler can migrate the goroutine to a free M when needed.

**Gain.** Typically 10-20% throughput recovery for I/O-mixed workloads.

**When to use LockOSThread.** Only when:
- The work is CPU-bound (no syscalls / channel waits).
- The goroutine accesses thread-local state (OpenGL contexts, certain C libraries).
- You combine it with OS affinity (`taskset`) for true core pinning.

---

## Optimization 12 — Use `expvar`'s sharded counters or roll-your-own

**Problem.** `expvar`'s default `Int` is a single atomic — fine for low-rate, slow for hot paths.

**Before:**
```go
var requests = expvar.NewInt("requests")
func handler() {
    requests.Add(1)
}
```
At 1M req/s with 16 cores: cache-line bouncing.

**After:**
Either use a wrapping sharded counter that exposes its sum via `expvar.Func`:
```go
counter := metrics.NewSharded("requests")
expvar.Publish("requests", expvar.Func(func() interface{} { return counter.Value() }))

func handler() {
    counter.Inc(currentShardID())
}
```
At the same load: ~10x throughput improvement, no metrics-induced bottleneck.

---

## Optimization 13 — Replace channels with ring buffers for high-throughput fan-out

**Problem.** A single channel with many receivers. Internal channel mutex becomes a bottleneck.

**Before:**
```go
ch := make(chan Job, 1000)
for i := 0; i < 8; i++ {
    go worker(ch)
}
```
Throughput ceiling: ~10 M ops/sec (channel mutex contention).

**After:**
A sharded SPSC ring buffer per worker, with the producer choosing a worker:
```go
type Pool struct {
    rings []*Ring
}

for i, r := range pool.rings {
    go func(r *Ring) {
        for {
            if v, ok := r.Pop(); ok {
                process(v)
            } else {
                runtime.Gosched()
            }
        }
    }(r)
}

// producer side:
i := pick()
for !pool.rings[i].Push(job) {
    runtime.Gosched()
}
```
Throughput: ~50-100 M ops/sec.

**Tradeoffs.** No back-pressure built in; you must handle it. No closing semantics. More complex than channels. Only worth it for very-high-throughput pipelines.

---

## Optimization 14 — Pad scheduler-touching structures

**Problem.** Per-goroutine state structs (e.g., job queue per worker) that are mutated frequently and accessed by the scheduler-adjacent code can false-share.

**Before:**
```go
type Worker struct {
    id      int
    pending int64
    done    int64
}

var workers [N]Worker
```

**After:**
```go
type Worker struct {
    id      int
    pending int64
    done    int64
    _       [44]byte // pad to 64 (4 + 8 + 8 = 20; add 44)
}
```

Gain: 1.5-3x throughput improvement under heavy contention.

---

## Optimization 15 — Profile-guided optimization

**Problem.** You don't know where false sharing is in your codebase.

**Before:** guess and pad randomly.

**After:** run `perf c2c` against a load test. Identify the top HITM cache lines. Pad only those.

```bash
sudo perf c2c record -F 5000 -p $(pidof service) sleep 30
sudo perf c2c report --stdio | head -100
```

For each hot line:
1. Find the struct it belongs to (from the source attribution).
2. Pad and re-test.

**Gain.** Measurable per-fix. Cumulative gain depends on number of hot spots.

---

## Optimization 16 — Switch to MPMC queue with sequence numbers

**Problem.** A naive concurrent queue uses a mutex and slice. Throughput is limited by mutex contention.

**Before:**
```go
type Queue struct {
    sync.Mutex
    buf []int
}
func (q *Queue) Push(v int) { q.Lock(); q.buf = append(q.buf, v); q.Unlock() }
func (q *Queue) Pop() (int, bool) {
    q.Lock(); defer q.Unlock()
    if len(q.buf) == 0 { return 0, false }
    v := q.buf[0]; q.buf = q.buf[1:]
    return v, true
}
```

Throughput: ~5 M ops/sec.

**After:** Vyukov MPMC queue with cache-line-padded indices and (optionally) padded slots.

Throughput: ~50-100 M ops/sec.

**Tradeoff.** Complexity. Fixed size. No blocking semantics (you must spin or sleep on full/empty).

---

## Optimization 17 — Cache CPU count

**Problem.** Calling `runtime.NumCPU()` or `runtime.GOMAXPROCS(0)` in a hot loop is fast but not free.

**Before:**
```go
func (c *Counter) Inc(shardID int) {
    c.shards[shardID%runtime.GOMAXPROCS(0)].v.Add(1)
}
```

**After:**
```go
type Counter struct {
    shards     []paddedInt64
    numShards  int
}

func New() *Counter {
    n := runtime.GOMAXPROCS(0)
    return &Counter{shards: make([]paddedInt64, n), numShards: n}
}

func (c *Counter) Inc(shardID int) {
    c.shards[shardID%c.numShards].v.Add(1)
}
```

Gain: ~5 ns per call (each `runtime.GOMAXPROCS(0)` call has overhead).

---

## Optimization 18 — Layout structs by access pattern

**Problem.** Fields written by one goroutine and fields written by another live mixed in a struct, causing false sharing within the struct.

**Before:**
```go
type Pipeline struct {
    producedCount int64
    consumedCount int64
    bytesIn       int64
    bytesOut      int64
}
```

If producer goroutine updates `producedCount` and `bytesIn`, and consumer updates `consumedCount` and `bytesOut`, all four share a cache line.

**After:**
```go
type Pipeline struct {
    // producer-side
    producedCount int64
    bytesIn       int64
    _             [48]byte

    // consumer-side
    consumedCount int64
    bytesOut      int64
    _             [48]byte
}
```

Producer-side fields on one cache line; consumer-side on another.

Gain: 2-5x throughput improvement on bidirectional pipelines.

---

## Optimization 19 — Adaptive shard count

**Problem.** Static shard count (e.g., `runtime.GOMAXPROCS(0)`) doesn't adapt to runtime changes.

**Before:**
```go
counter := NewSharded(runtime.GOMAXPROCS(0))
// ... later, GOMAXPROCS changes via runtime.GOMAXPROCS(n) ...
// counter still uses old shard count
```

**After:** detect changes and rebuild, or use a shard count high enough for all realistic scenarios.

```go
// Practical approach: use a safely-high shard count at startup.
counter := NewSharded(max(16, runtime.GOMAXPROCS(0)*2))
```

Slightly more memory, but resilient to GOMAXPROCS changes.

---

## Optimization 20 — Profile-driven shard layout

**Problem.** You have a fixed memory budget; you want to know which counters most need padding.

**After:** profile a representative load. Rank counters by HITM/cycle. Pad the top K.

```bash
sudo perf c2c record -F 5000 -- ./loadtest
sudo perf c2c report --stdio | python3 rank-fields.py > rankings.txt
```

Then pad the top entries; re-profile.

This is the "ROI on padding" view: spend memory only where it buys you significant throughput.

---

## Optimization Catalog Summary

| Technique | Best for | Typical gain |
|-----------|----------|--------------|
| Pad adjacent counters | Per-CPU counters, per-shard state | 10-300x |
| Shard global counters | True-contention bottlenecks | 5-100x |
| Pad producer/consumer indexes | SPSC / MPMC queues | 2-3x |
| Batch increments | Counter writes where lag is OK | 100-1000x op-count reduction |
| Per-P pinning (`procPin`) | Ultra-hot per-CPU updates | 2-3x over atomics |
| Cache snapshot via local var | Read-mostly config | 5x |
| Hierarchical aggregation | Many-shard counters with hot reads | 100-1000x read |
| Pad mutex containers | Sharded locked maps | 1.5-3x |
| `sync.Pool` for buffers | Per-request scratch | 5-10x |
| MPMC queue vs channel | High-throughput fan-out | 5-10x |
| Layout by access pattern | Bidirectional pipelines | 2-5x |
| Profile-guided padding | Unknown hot spots | Depends |

The combination, applied judiciously, can take a poorly-scaling Go service from 50 K req/s to 1 M+ req/s on the same hardware. The skill is knowing which technique to apply where; the discipline is measuring before and after each change.

---

## Closing Thoughts

False sharing is one of the highest-leverage optimisations in concurrent Go. A struct rearrangement of a few bytes can yield 10-20x speedups on multi-core workloads. The cost is memory (often acceptable) and complexity (manageable with good naming and tests).

The toolkit:

1. **Identify hot paths** via CPU and cache-miss profiling.
2. **Diagnose specific bouncing lines** via `perf c2c`.
3. **Apply the right fix**: padding for adjacency, sharding for global hot spots, batching for write reduction.
4. **Measure before and after**, with benchmarks at multiple `-cpu` values.
5. **Document and test** the fix to prevent regression.

After enough practice, the optimisations become reflexes. You will look at a hot concurrent struct and immediately see where the padding should go. The Go runtime team has done this for the standard library; the next layer of high-performance Go infrastructure (databases, message brokers, RPC frameworks) builds on the same patterns. You are joining a long tradition.
