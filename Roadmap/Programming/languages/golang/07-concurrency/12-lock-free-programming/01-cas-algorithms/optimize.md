# Compare-and-Swap (CAS) Algorithms — Optimization

## Table of Contents
1. [Introduction](#introduction)
2. [Measure Before You Optimise](#measure-before-you-optimise)
3. [Optimisation 1: Prefer `Add`/`Or`/`And` Over CAS Loops](#optimisation-1-prefer-addorand-over-cas-loops)
4. [Optimisation 2: Cache-Line Padding](#optimisation-2-cache-line-padding)
5. [Optimisation 3: Sharding](#optimisation-3-sharding)
6. [Optimisation 4: Batch Updates](#optimisation-4-batch-updates)
7. [Optimisation 5: Read Less, Recompute More](#optimisation-5-read-less-recompute-more)
8. [Optimisation 6: Early Exit](#optimisation-6-early-exit)
9. [Optimisation 7: Backoff Under Contention](#optimisation-7-backoff-under-contention)
10. [Optimisation 8: Lazy Publication](#optimisation-8-lazy-publication)
11. [Optimisation 9: Avoid CAS in the Read Path](#optimisation-9-avoid-cas-in-the-read-path)
12. [Optimisation 10: Layout for Locality](#optimisation-10-layout-for-locality)
13. [Anti-Patterns](#anti-patterns)
14. [Profiling Tools](#profiling-tools)
15. [Summary](#summary)

---

## Introduction

This file is about making CAS-using code faster — under contention, under load, in real systems. Two principles run through every optimisation:

1. **The instruction is not the bottleneck.** A single uncontended CAS costs 5-15 ns. If you are doing 100M CAS per second, you spend 1 second per second. The cost is elsewhere — usually cache-coherence traffic.

2. **Reduce contention, not the CAS.** Most "CAS is slow" complaints reduce to "many cores fight for the same cache line." The fix is structural (shard, batch, layout) not micro-optimisational.

---

## Measure Before You Optimise

The most important advice: profile first. Common CAS performance complaints are misattributed. The real cost may be:

- Cache misses on unrelated data.
- Allocation pressure from `atomic.Pointer` swaps.
- Scheduler overhead from too many goroutines.
- Mutex behind a wrapping function you assumed was CAS-based.

Tools:

- `go test -bench` to establish baselines.
- `go tool pprof` for CPU profiling.
- `perf stat` (Linux) for cache-miss counters, branch mispredicts, etc.
- `runtime/trace` for scheduler behaviour.

A 10-minute profile saves hours of misguided optimisation.

### Baseline benchmark template

```go
func BenchmarkCAS(b *testing.B) {
    var v atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            for {
                old := v.Load()
                if v.CompareAndSwap(old, old+1) {
                    break
                }
            }
        }
    })
}
```

Run with `-cpu=1,2,4,8` to see scaling:

```bash
go test -bench=BenchmarkCAS -cpu=1,2,4,8 -benchtime=3s
```

If single-thread is 10 ns/op and 8-thread is 200 ns/op, you have contention scaling badly. Time to consider sharding.

---

## Optimisation 1: Prefer `Add`/`Or`/`And` Over CAS Loops

If the operation maps directly to a hardware atomic instruction, use the dedicated function. No loop, no retry.

```go
// before: CAS loop
for {
    old := c.v.Load()
    if c.v.CompareAndSwap(old, old+1) {
        break
    }
}

// after: single atomic instruction
c.v.Add(1)
```

`Add` compiles to `LOCK XADDQ` on x86 — one instruction. CAS loop is at least three plus the conditional.

Similarly for bit ops on Go 1.23+:

```go
// before: CAS loop for OR
for {
    old := f.bits.Load()
    if f.bits.CompareAndSwap(old, old|mask) {
        break
    }
}

// after: single instruction
f.bits.Or(mask)
```

The hardware has `LOCK OR` for atomic bitwise OR. The Go compiler emits it.

**When CAS still wins.** When the operation is conditional in a way that `Add`/`Or`/`And` cannot express: set-if-greater, increment-if-positive, compare-versions-then-update. The conditional logic forces CAS.

---

## Optimisation 2: Cache-Line Padding

False sharing destroys atomic-operation performance. Two unrelated variables on the same cache line cause cache-line transfers on every write, even though the writes are logically independent.

### Symptom

A microbenchmark that scales well at low core counts collapses at higher counts, and `perf stat` shows high `cache-misses` or `mem_load_l3_miss_retired.remote_hitm`.

### Fix

Pad each hot atomic to its own cache line:

```go
const cacheLineSize = 64

type Counter struct {
    v atomic.Int64
    _ [cacheLineSize - 8]byte
}
```

For an array of counters:

```go
type ShardedCounter struct {
    shards [16]struct {
        v atomic.Int64
        _ [cacheLineSize - 8]byte
    }
}
```

Each shard is on its own line; writes to different shards don't bounce lines.

### Cost

64 bytes per padded counter instead of 8. For 16 shards, 1 KB instead of 128 bytes. For a few atomics this is trivial; for thousands, it matters. Decide based on whether the variables are truly hot.

### Don't pad cold data

```go
type Stats struct {
    coldCount int64  // updated once per minute
    _ [56]byte       // pointless padding
    hotCount atomic.Int64
}
```

If `coldCount` is rarely touched, false sharing with it is rare. Padding wastes memory for no gain.

### Detecting false sharing

Linux `perf` with the right counters:

```bash
perf stat -e cache-misses,cache-references ./mybin
perf stat -e mem_load_l3_miss_retired.remote_hitm ./mybin
```

A high HITM rate on a hot loop indicates inter-core cache-line traffic.

---

## Optimisation 3: Sharding

When N cores all CAS the same variable, throughput is bounded by cache-coherence traffic. Splitting the variable into N shards (one per core, ideally) cuts the cost.

```go
type ShardedCounter struct {
    shards [N]struct {
        v atomic.Int64
        _ [56]byte // cache-line padding
    }
}

func (c *ShardedCounter) Inc() {
    shard := pickShard() // hash by goroutine ID, processor, etc.
    c.shards[shard].v.Add(1)
}

func (c *ShardedCounter) Value() int64 {
    var sum int64
    for i := range c.shards {
        sum += c.shards[i].v.Load()
    }
    return sum
}
```

Writers contend within their shard. With N = number of cores, contention drops to (workload / N) per shard.

### Picking the shard

- **By goroutine ID**: hash a unique goroutine identifier. Cheap, fair.
- **By P (processor)**: pin to a P, write to that P's shard. Requires `runtime_procPin` (not exported in the standard library; the `sync.Pool` does it via the runtime).
- **By round-robin**: keep a goroutine-local counter, mod N. Simple but writes still bounce as goroutines migrate.

The Go runtime's `sync.Pool` uses per-P shards via internal hooks. User code typically settles for goroutine-ID-based hashing.

### Cost on the read side

Reading the total is O(N) — sum across shards. For read-heavy workloads, this can erase the writer gains. Sharding is a write-optimisation; if you read often, profile both sides.

### Sharding is not a free lunch

- Order is lost: a sharded counter has no global "Nth call" answer.
- Some operations don't shard naturally (max, min, set-membership).
- Memory grows by N×.

---

## Optimisation 4: Batch Updates

If a goroutine performs many small updates, batch them locally and publish in fewer CAS operations.

```go
// Before: one CAS per increment
for i := 0; i < 1000; i++ {
    c.Inc() // 1000 CAS
}

// After: local sum, one CAS to publish
var local int64
for i := 0; i < 1000; i++ {
    local++
}
c.v.Add(local) // 1 CAS
```

The trade-off: the count is invisible until the batch lands. If readers need fresh totals, batching breaks freshness.

### Batched producers

```go
type BatchProducer struct {
    queue   chan int
    batch   []int
    flushAt int
}

func (b *BatchProducer) Submit(v int) {
    b.batch = append(b.batch, v)
    if len(b.batch) >= b.flushAt {
        b.flush()
    }
}

func (b *BatchProducer) flush() {
    for _, v := range b.batch {
        b.queue <- v
    }
    b.batch = b.batch[:0]
}
```

Each `Submit` is a local append (no atomic op). The `flush` does N channel sends, but channel ops on a buffered channel batch nicely too.

Batching trades latency for throughput. Pick the trade-off based on your workload.

---

## Optimisation 5: Read Less, Recompute More

In a CAS loop, every iteration loads from memory. If the surrounding code re-reads the same atomic outside the loop, those reads are redundant.

```go
// Before: extra read outside the loop
func (c *Counter) Inc() int64 {
    var result int64
    for {
        old := c.v.Load()
        if c.v.CompareAndSwap(old, old+1) {
            result = old + 1
            break
        }
    }
    return c.v.Load() // redundant
}

// After: use the value you already have
func (c *Counter) Inc() int64 {
    for {
        old := c.v.Load()
        if c.v.CompareAndSwap(old, old+1) {
            return old + 1
        }
    }
}
```

The `Load` at the end re-reads from memory. The value `old + 1` we just published is in our register; use it.

### Avoid unnecessary atomic loads

```go
// Before
if c.v.Load() > 0 {
    if c.v.Load() < c.max {
        // ...
    }
}

// After
v := c.v.Load()
if v > 0 && v < c.max {
    // ...
}
```

Even though `Load` is cheap on x86, the read can move to a stale cache line. One Load is one cache transaction; two are two.

---

## Optimisation 6: Early Exit

In a conditional CAS loop, check the condition before the CAS. If the condition fails, return without touching the atomic.

```go
// Before: always CAS
func (m *Max) Observe(x int64) {
    for {
        old := m.v.Load()
        new := max(old, x)
        if m.v.CompareAndSwap(old, new) {
            return
        }
    }
}

// After: early-return when no update needed
func (m *Max) Observe(x int64) {
    for {
        old := m.v.Load()
        if x <= old {
            return // no update, no CAS
        }
        if m.v.CompareAndSwap(old, x) {
            return
        }
    }
}
```

Most calls to `Observe` with `x <= current max` exit without any CAS — saving the contention cost entirely. For a watermark that climbs early and plateaus, the steady-state CAS count is near zero.

---

## Optimisation 7: Backoff Under Contention

Under heavy contention, fast retries make things worse — they multiply the cache-line bouncing. Backoff reduces the rate of failed CAS attempts.

### Fixed backoff

```go
for {
    old := c.v.Load()
    if c.v.CompareAndSwap(old, old+1) {
        return
    }
    runtime.Gosched() // yield once per failure
}
```

`Gosched` yields the goroutine to the scheduler. Other goroutines run. By the time we resume, the contended line may have been written by them and the cache state has changed.

### Exponential backoff

```go
delay := time.Nanosecond
for {
    old := c.v.Load()
    if c.v.CompareAndSwap(old, old+1) {
        return
    }
    time.Sleep(delay)
    if delay < time.Microsecond {
        delay *= 2
    }
}
```

Doubles the wait on each failure. Reduces contention but increases worst-case latency.

### When backoff helps

- Many goroutines (more than GOMAXPROCS) contending the same line.
- Each successful operation does measurable work that needs to land.

### When backoff hurts

- Few goroutines, light contention. Backoff just adds latency.
- Real-time-sensitive code. Backoff makes worst-case latency unpredictable.

Profile both with and without backoff. Don't add backoff speculatively.

---

## Optimisation 8: Lazy Publication

Instead of CAS-publishing every change, accumulate changes locally and publish periodically.

```go
type LazyMax struct {
    global atomic.Int64
}

type Local struct {
    global  *LazyMax
    pending int64
}

func (l *Local) Observe(x int64) {
    if x > l.pending {
        l.pending = x
    }
}

func (l *Local) Flush() {
    for {
        old := l.global.global.Load()
        if l.pending <= old {
            return
        }
        if l.global.global.CompareAndSwap(old, l.pending) {
            return
        }
    }
}
```

Each goroutine tracks its local max. Periodically (every N observations, or every M ms), it CAS-flushes the local max to the global.

Trade-off: the global is stale by up to one flush-interval. Acceptable for metrics and watermarks; not for monotonic ID generation.

---

## Optimisation 9: Avoid CAS in the Read Path

Reads via `atomic.Load` are essentially free on x86 (single MOV). Writes via `Store` or CAS are expensive (LOCK prefix, cache-line ownership). Design so reads dominate over CAS.

### Publish-by-pointer for read-mostly state

```go
type Config struct { /* fields */ }

var current atomic.Pointer[Config]

// Hot read path: one Load
func Read() *Config { return current.Load() }

// Cold write path: occasional Store
func Update(c *Config) { current.Store(c) }
```

Readers do one `Load` per access (no CAS, no allocation, no contention). Writers do one `Store` per update (or CAS if computing from old). For a workload with 1M reads per write, the writer cost is irrelevant.

### Avoid CAS-then-Load patterns

```go
// Bad: CAS then Load
ok := c.v.CompareAndSwap(old, new)
v := c.v.Load() // extra read

// Better: CAS, use the value you swapped to
ok := c.v.CompareAndSwap(old, new)
if ok {
    use(new)
}
```

---

## Optimisation 10: Layout for Locality

Co-locate fields that are accessed together. Separate fields that are accessed by different goroutines.

```go
// Bad: hot and cold fields mixed
type Server struct {
    name         string                // cold
    requestCount atomic.Int64           // hot
    startTime    time.Time              // cold
    responseTime atomic.Int64           // hot
    address      string                 // cold
}

// Better: hot fields in their own cache line
type Server struct {
    // cold metadata
    name      string
    startTime time.Time
    address   string

    // hot atomic counters, cache-aligned
    _            [0]byte // alignment marker
    requestCount atomic.Int64
    responseTime atomic.Int64
    _            [40]byte // pad to 64 bytes for the two counters
}
```

The hot counters are on their own cache line; metadata reads don't pull the counters' line, and counter updates don't dirty the metadata.

This optimisation is per-struct and per-workload. Profile to confirm.

---

## Anti-Patterns

### "Optimising" by adding CAS

A common mistake: replacing a `sync.Mutex` with a CAS-loop "for performance" without measuring.

For very short critical sections (single-word updates), CAS wins. For everything else, mutex is competitive or better, and far easier to maintain. Switch only with benchmarks.

### Padding everything

```go
type Stats struct {
    a atomic.Int64
    _ [56]byte
    b atomic.Int64
    _ [56]byte
    c atomic.Int64
    _ [56]byte
}
```

If `a`, `b`, `c` are not concurrently hot, the padding wastes 168 bytes for no gain. Pad only the fields you have measured as hot and contended.

### Sharding low-contention counters

Sharding adds:

- O(shards) read cost.
- O(shards) memory.
- Code complexity (shard-picking, padding).

For a counter incremented once per second, all this is overhead. Sharding helps at 1M+ ops/s. Below that, don't bother.

### Spinning forever

```go
for {
    if x.CompareAndSwap(old, new) {
        return
    }
}
```

In a Go program with more goroutines than GOMAXPROCS, a pure spin can starve other goroutines on the same OS thread. The Go scheduler is preemptive (1.14+), so this is less catastrophic than it used to be, but `runtime.Gosched()` after failure remains a good citizen.

### Optimising the CAS instead of the workload

If your CAS-loop retries 100x per success, the fix is not "make the CAS faster." It is "reduce the contention" — shard, batch, redesign.

---

## Profiling Tools

### `go test -bench`

The baseline. Always start here.

```bash
go test -bench=. -cpu=1,2,4,8,16 -benchtime=3s -count=5
```

`-cpu` shows scaling. `-count=5` reduces benchmark noise.

### `go tool pprof`

CPU profiling:

```bash
go test -bench=. -cpuprofile=cpu.prof
go tool pprof cpu.prof
(pprof) top
(pprof) list <func>
```

Look for time in `runtime/internal/atomic` — that is CAS itself. Lots of time there suggests contention or wrong primitive choice.

### `perf stat` (Linux only)

Hardware counters:

```bash
perf stat -e cycles,instructions,cache-misses,cache-references \
    ./bench
```

For CAS-specific contention:

```bash
perf stat -e mem_load_l3_miss_retired.remote_hitm,L1-dcache-loads \
    ./bench
```

`remote_hitm` counts cache-line bounces between cores. High and growing with core count means contention.

### `runtime/trace`

Scheduler behaviour:

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()
// ... workload ...
```

View with `go tool trace trace.out`. Shows when goroutines block, how long, and on what. Contended CAS-loops show up as goroutines spending lots of time in user code (no blocking) — distinct from mutex contention which shows as syscalls.

### `runtime.SetMutexProfileFraction` and `SetBlockProfileFraction`

Useful for mutex contention, less for CAS. CAS contention does not show up as blocking — it shows as CPU time.

---

## Summary

Optimising CAS-using code follows a predictable hierarchy:

1. **Measure first.** Without numbers, you are guessing.
2. **Pick the right primitive.** `Add`/`Or`/`And` over CAS when possible.
3. **Reduce contention before reducing per-op cost.** Shard, batch, lazy-publish.
4. **Pad hot fields to cache-line size.** Eliminate false sharing.
5. **Lay out structs so hot and cold fields are separated.** Hot fields together, cold fields together.
6. **Early-exit conditional CAS loops.** Avoid CAS when no update is needed.
7. **Use backoff only when measured to help.** Default to no backoff.
8. **Prefer read-mostly designs with `atomic.Pointer`.** Wait-free reads, occasional CAS writes.

The single instruction `LOCK CMPXCHG` takes ~10 ns. Anything significantly slower than that, per CAS, is contention or design. Optimise the design, not the instruction.

---

## Further Reading

- Ulrich Drepper, "What Every Programmer Should Know About Memory," 2007. Section 6 on cache effects.
- Dmitry Vyukov, "Lock-free algorithms," <https://www.1024cores.net/>.
- Brendan Gregg, "Systems Performance," 2nd ed. Chapter on CPU and cache profiling.
- Linux `perf` tutorial: <https://www.brendangregg.com/perf.html>.
- Go's `sync.Pool` source: `src/sync/pool.go`. Reference implementation of per-P sharding.
- `golang.org/x/sync/singleflight`: a CAS-adjacent pattern for deduplication.
- The Go runtime's `runtime/internal/atomic`: see how the runtime itself uses these primitives.
