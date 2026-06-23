---
layout: default
title: Optimize
parent: Copy-on-Write
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/05-copy-on-write/optimize/
---

# Copy-on-Write — Optimization

> COW is already one of the fastest concurrent patterns. There is little to optimize in `atomic.Pointer.Load` itself — it's ~1.5 ns. What's worth optimizing is the *system* of COW: how often you rebuild, how big the snapshot is, how readers interact with snapshots, and how the GC keeps up.
>
> Each entry states the problem, shows a "before" snippet, an "after" snippet, and the realistic gain. Numbers are illustrative — measure in your own code.

---

## Optimization 1 — Cache the Load in a local variable

**Problem.** Multiple `Load` calls in tight code path cost time and may produce inconsistent snapshots.

**Before:**
```go
for i := 0; i < 1000000; i++ {
    if cfg.Load().Enabled {
        process(cfg.Load().Param)
    }
}
```
2 M Loads. ~3 ms total. Also, snapshots may differ between Loads.

**After:**
```go
c := cfg.Load()
for i := 0; i < 1000000; i++ {
    if c.Enabled {
        process(c.Param)
    }
}
```
1 Load. Consistent throughout.

**Gain.** ~3 ms saved on this loop. Also, semantically simpler.

---

## Optimization 2 — Batch writes

**Problem.** N individual writes produce N snapshot rebuilds. Each rebuild allocates and pressures the GC.

**Before:**
```go
for _, item := range batch {
    cfg.Set(item.Key, item.Value)  // 1 rebuild per item
}
```
For 100 items and a 10 K-entry map: 100 rebuilds × ~1 ms = 100 ms. 100 × 500 KB allocations.

**After:**
```go
cfg.UpdateBatch(func(m *Config) {
    for _, item := range batch {
        m.Data[item.Key] = item.Value
    }
})
```
1 rebuild. ~1 ms. 1 × 500 KB allocation.

**Gain.** 100× fewer allocations, 100× less GC pressure.

---

## Optimization 3 — Use atomic.Pointer[T] instead of atomic.Value

**Problem.** `atomic.Value` boxes the value in an interface, adding overhead.

**Before:**
```go
var v atomic.Value
v.Store(&Config{})
c := v.Load().(*Config) // type assertion every read
```

Load: ~5 ns. Store: ~25 ns.

**After:**
```go
var v atomic.Pointer[Config]
v.Store(&Config{})
c := v.Load() // type-safe, no assertion
```

Load: ~1.5 ns. Store: ~10 ns.

**Gain.** 3-4× faster Load and Store. No type panic risk.

Requires Go 1.19+.

---

## Optimization 4 — Pre-size maps and slices in writers

**Problem.** Rebuilding via `make(map[K]V)` then inserting causes rehashes.

**Before:**
```go
next := make(map[string]string) // grows during inserts
for k, v := range old.Endpoints {
    next[k] = v
}
next["new"] = "value"
```

Multiple rehashes during the loop. ~2× slower than necessary.

**After:**
```go
next := make(map[string]string, len(old.Endpoints)+1)
for k, v := range old.Endpoints {
    next[k] = v
}
next["new"] = "value"
```

Pre-sized; no rehashes.

**Gain.** ~2× faster for the map rebuild step.

Same for slices:

```go
// Before
var next []string
for _, h := range old.Hosts { next = append(next, h) }

// After
next := make([]string, 0, len(old.Hosts)+1)
for _, h := range old.Hosts { next = append(next, h) }
```

---

## Optimization 5 — Shard the COW store

**Problem.** All writers serialize on one mutex. Under high write contention, writers queue.

**Before:**
```go
type Store struct {
    cur atomic.Pointer[map[K]V]
    mu  sync.Mutex
}
// 1000 writers/sec all serialize through one mutex
```

Single mutex; throughput capped at 1 writer at a time.

**After:**
```go
const N = 32
type ShardedStore struct {
    shards [N]struct {
        cur atomic.Pointer[map[K]V]
        mu  sync.Mutex
    }
}
```

32 shards; 32× write parallelism (for keys spread across shards).

**Gain.** Up to 32× write throughput for parallel writes. Reads also avoid contention on the writer mutex.

Trade-off: no cross-shard atomic operations (e.g., consistent Range across all keys).

---

## Optimization 6 — Pad atomic.Pointer to its own cache line

**Problem.** The atomic pointer shares a cache line with other fields. Writes to those fields invalidate the line for readers.

**Before:**
```go
type Store struct {
    cur  atomic.Pointer[T]
    mu   sync.Mutex          // writes to mu invalidate cache line
    metrics atomic.Int64     // metrics increments invalidate cache line
}
```

Reads pay cache-miss penalty under writer/metrics activity.

**After:**
```go
type Store struct {
    cur  atomic.Pointer[T]
    _    [56]byte           // padding to 64-byte cache line
    mu   sync.Mutex
    metrics atomic.Int64
}
```

`cur` lives alone in its cache line.

**Gain.** Significant for hot reads under contention; depends on workload.

Caveat: 56 bytes of wasted memory per Store. Worthwhile only for high-contention COW.

---

## Optimization 7 — Avoid defensive cloning in Get

**Problem.** A "safe" Get that clones on every read destroys COW's read advantage.

**Before:**
```go
func (s *Store) Get() *Config {
    return s.cur.Load().Clone() // expensive deep copy
}
```

For a 10 KB Config, each Get costs ~5 µs. At 100 K reads/sec, that's 500 ms/sec of pure cloning.

**After:**
```go
// Document the immutability contract; return raw pointer.
func (s *Store) Get() *Config {
    return s.cur.Load()
}
```

Get is now ~1.5 ns.

**Gain.** ~3000× faster Get.

Trust callers not to mutate. If they're untrusted (e.g., plugins), prefer accessor methods over Clone.

---

## Optimization 8 — Use persistent HAMT for large maps

**Problem.** Plain rebuild COW allocates the entire map on every write.

**Before:**
```go
// 1M-entry map, 100 writes/sec
old := cfg.Load()
next := make(map[K]V, len(old)+1)
for k, v := range old { next[k] = v }
next[k] = v
cfg.Store(&next)
```

Per write: 1M-entry copy. ~50 MB allocation. 100 writes/sec = 5 GB/sec. GC dies.

**After:**
```go
// 1M-entry HAMT, 100 writes/sec
old := cfg.Load()
next := old.Set(k, v) // copies ~6 nodes (structural sharing)
cfg.Store(&next)
```

Per write: ~6 node allocations. ~1 KB. 100 writes/sec = 100 KB/sec. GC fine.

**Gain.** ~50,000× less GC pressure.

Use `github.com/benbjohnson/immutable` or similar.

---

## Optimization 9 — Bounded snapshot age

**Problem.** Long-running goroutines pin snapshots indefinitely. Memory grows.

**Before:**
```go
go func() {
    snap := s.Get()
    for {
        process(snap) // snap pinned forever
        time.Sleep(time.Second)
    }
}()
```

After N updates, all N old snapshots are still alive.

**After:**
```go
go func() {
    for {
        snap := s.Get() // re-load each iteration
        process(snap)
        time.Sleep(time.Second)
    }
}()
```

Old snapshots become reclaimable on each iteration.

**Gain.** Bounded memory. Dramatically reduced pinning.

---

## Optimization 10 — Single-writer goroutine with batching

**Problem.** Many writers contend on the writer mutex, queue, and produce excessive GC.

**Before:**
```go
// 1000 writers calling Update concurrently
func (s *Store) Update(fn func(*Config)) {
    s.mu.Lock()
    defer s.mu.Unlock()
    // ... rebuild
}
```

Writer mutex contention; 1000 rebuilds per second.

**After:**
```go
// Channel-fed single-writer with batching
queue := make(chan func(*Config), 1024)
go func() {
    for req := range queue {
        batch := []func(*Config){req}
    drain:
        for {
            select {
            case r := <-queue:
                batch = append(batch, r)
            default:
                break drain
            }
        }
        s.mu.Lock()
        old := s.cur.Load()
        next := *old
        for _, fn := range batch {
            fn(&next)
        }
        s.cur.Store(&next)
        s.mu.Unlock()
    }
}()
```

One rebuild per batch.

**Gain.** Under burst load, batching can amortize 100 updates into 1 rebuild. ~100× less GC pressure.

---

## Optimization 11 — Reduce snapshot size

**Problem.** A bloated Config makes every rebuild expensive.

**Before:**
```go
type Config struct {
    Operational map[string]string  // tiny, frequently rebuilt
    StaticData  []HugeStruct       // 10 MB, rarely changed
}
```

Every rebuild allocates the 10 MB StaticData (or shares its slice header at minimum).

**After:**
```go
type Config struct {
    Operational map[string]string
}

// StaticData lives in a separate, infrequently-updated store
var staticData atomic.Pointer[[]HugeStruct]
```

Operational changes don't touch StaticData.

**Gain.** Per-write cost reduced to operational size only.

---

## Optimization 12 — Use builder + sync.Pool

**Problem.** Writers repeatedly allocate intermediate maps and slices.

**Before:**
```go
func (s *Store) Update(fn func(*Config)) {
    s.mu.Lock()
    defer s.mu.Unlock()
    old := s.cur.Load()
    next := make(map[K]V, len(old)+1) // new map per write
    for k, v := range old { next[k] = v }
    fn(&next)
    s.cur.Store(&next)
}
```

Each Update allocates a new map.

**After:**
```go
var mapPool = sync.Pool{
    New: func() any { return make(map[K]V) },
}

func (s *Store) Update(fn func(map[K]V)) {
    s.mu.Lock()
    defer s.mu.Unlock()
    builder := mapPool.Get().(map[K]V)
    defer mapPool.Put(builder)
    clear(builder) // Go 1.21+
    for k, v := range *s.cur.Load() {
        builder[k] = v
    }
    fn(builder)
    // Copy builder to a new map for publishing (must not share with future reusers)
    next := make(map[K]V, len(builder))
    for k, v := range builder {
        next[k] = v
    }
    s.cur.Store(&next)
}
```

Builder is reused, but the published snapshot is still fresh.

**Gain.** Modest — maybe 20-30% less GC. Only worthwhile for very high-rate writers. The complexity is real.

---

## Optimization 13 — Avoid Range Over Snapshot in Hot Paths

**Problem.** Iterating over a snapshot's collection on every read is slow.

**Before:**
```go
func HasRoute(path string) bool {
    for _, r := range cfg.Load().Routes {
        if matches(r.Pattern, path) {
            return true
        }
    }
    return false
}
```

Linear scan. For 10K routes, 10K comparisons per call.

**After:**
```go
type Config struct {
    Routes    []Route
    RouteSet  map[string]Route // pre-computed
}

func HasRoute(path string) bool {
    _, ok := cfg.Load().RouteSet[path]
    return ok
}
```

Map lookup is O(1). Pre-compute in the writer.

**Gain.** ~1000× faster for routes; only the writer pays the indexing cost (once per snapshot).

---

## Optimization 14 — Use Go 1.22+ for loop fix

**Problem.** Pre-Go-1.22 for-loop variable capture bugs in goroutine spawning around COW.

**Before (pre-1.22):**
```go
for _, host := range cfg.Load().Hosts {
    go func() {
        ping(host) // captures shared variable
    }()
}
```

All goroutines ping the same (last) host.

**After (1.22+):**
```go
for _, host := range cfg.Load().Hosts {
    go func() {
        ping(host) // each iteration has its own host
    }()
}
```

Or, for any version:
```go
for _, host := range cfg.Load().Hosts {
    host := host // explicit copy
    go func() {
        ping(host)
    }()
}
```

Or pass as parameter:
```go
for _, host := range cfg.Load().Hosts {
    go func(h string) {
        ping(h)
    }(host)
}
```

**Gain.** Correctness, not speed.

---

## Optimization 15 — Tune GOGC for write-heavy workloads

**Problem.** High allocation rate triggers frequent GC, hurting latency.

**Before:**
```go
// Default GOGC=100; GC every time heap doubles
```

With 200 MB live heap and 200 MB/sec allocation: GC every second.

**After:**
```go
import "runtime/debug"

func init() {
    debug.SetGCPercent(300) // GC at 3× heap growth
}
```

GC every 3 seconds; more memory used; less CPU on GC.

**Gain.** Up to 3× less GC overhead, at the cost of 3× more memory.

Tune based on your latency vs memory budget.

---

## Optimization 16 — Use GOMEMLIMIT for safety net

**Problem.** Under burst write load, heap could grow unboundedly.

**Before:**
```go
// No memory limit; OOM possible
```

**After:**
```go
debug.SetMemoryLimit(2 << 30) // 2 GiB soft cap
```

GC becomes more aggressive as heap approaches the limit, preventing OOM at the cost of more CPU.

**Gain.** OOM avoidance with predictable degradation.

---

## Optimization 17 — Inline accessors

**Problem.** Function call overhead on hot Get paths.

**Before:**
```go
func GetTimeout() time.Duration {
    return cfg.Load().Timeout
}
```

If not inlined, each call has function-call overhead (~5 ns).

**After (verify inlining):**
```bash
go build -gcflags '-m' ./... 2>&1 | grep 'GetTimeout'
```

If "can inline GetTimeout", the compiler will inline. If not, simplify the function (smaller bodies are more likely to inline).

Generally, simple Get/Set functions inline automatically.

**Gain.** Modest — a few ns per call, but multiplied across millions of calls.

---

## Optimization 18 — Avoid logging the full snapshot

**Problem.** Formatting a large snapshot for logs is expensive.

**Before:**
```go
log.Printf("config reloaded: %+v", cfg.Load())
```

For a 10 KB Config, formatting takes ~50 µs.

**After:**
```go
log.Printf("config reloaded: version=%d hosts=%d", c.Version, len(c.Hosts))
```

Fast. Same information.

**Gain.** 100× faster log line. Less log volume.

---

## Optimization 19 — Profile-guided optimization

**Problem.** Optimizing without measuring leads to wrong-priority effort.

**Before:**
Hours spent on micro-optimizations that don't matter.

**After:**
```bash
go test -bench=. -cpuprofile=cpu.out
go tool pprof cpu.out
(pprof) top
(pprof) list HotFunc
```

Find the actual hot path. Optimize that.

**Gain.** Direct effort to the 5% of code that runs 95% of the time.

---

## Optimization 20 — Remove unnecessary atomic.Value migration

**Problem.** Legacy code using `atomic.Value` slows down everything.

**Before:**
```go
var v atomic.Value
// ... pre-Go-1.19 boxing overhead everywhere
```

**After:**
```go
var v atomic.Pointer[Config]
// ... typed, fast, idiomatic
```

**Gain.** 3-4× faster Load and Store. No type panic risk. Required: Go 1.19+.

---

## Bonus: A Comprehensive Benchmark Suite

To measure the impact of any optimization:

```go
package cowbench

import (
    "sync"
    "sync/atomic"
    "testing"
)

type Config struct {
    A, B, C int
}

// Baseline
type Store struct {
    cur atomic.Pointer[Config]
    mu  sync.Mutex
}

func NewStore() *Store {
    s := &Store{}
    s.cur.Store(&Config{})
    return s
}

func (s *Store) Get() *Config { return s.cur.Load() }

func (s *Store) Update(fn func(*Config)) {
    s.mu.Lock()
    defer s.mu.Unlock()
    old := s.cur.Load()
    next := *old
    fn(&next)
    s.cur.Store(&next)
}

func BenchmarkRead(b *testing.B) {
    s := NewStore()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = s.Get().A
        }
    })
}

func BenchmarkWrite(b *testing.B) {
    s := NewStore()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            s.Update(func(c *Config) { c.A++ })
        }
    })
}

func BenchmarkMixed90R10W(b *testing.B) {
    s := NewStore()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            i++
            if i%10 == 0 {
                s.Update(func(c *Config) { c.A++ })
            } else {
                _ = s.Get().A
            }
        }
    })
}
```

Run before and after each optimization. Compare with benchstat:

```bash
go test -bench=. -count=10 > old.txt
# apply optimization
go test -bench=. -count=10 > new.txt
benchstat old.txt new.txt
```

---

## Bonus: Real-World Numbers

Typical observations after applying these optimizations to a production COW system:

- Optimization 1 (cache Load): 30% reduction in CPU time for hot paths.
- Optimization 2 (batch writes): 80% reduction in GC pressure.
- Optimization 3 (atomic.Pointer over Value): 3-4× faster atomic ops.
- Optimization 5 (sharding): 16× write throughput (with 16 shards).
- Optimization 8 (persistent HAMT): 1000× less GC for large maps.
- Optimization 9 (bounded age): eliminated a memory-growth incident.
- Optimization 18 (skip full snapshot logs): freed 10% CPU time.

Stack them: a system that started at 50K req/sec can reach 500K req/sec with 1-2 GB memory savings.

---

## Decision Tree: Which Optimization to Try First

```
Memory growing unbounded?
  -> Optimization 9 (bounded age), 16 (GOMEMLIMIT)
GC pauses too long?
  -> Optimization 2 (batching), 8 (HAMT), 15 (GOGC), 11 (smaller snapshots)
Write throughput too low?
  -> Optimization 5 (sharding), 10 (single-writer), 2 (batching)
Read latency too high?
  -> Optimization 1 (cache Load), 6 (cache-line padding), 13 (pre-compute)
Spending too much on snapshot copies?
  -> Optimization 4 (pre-size), 7 (no clone), 8 (HAMT)
General slowness?
  -> Optimization 19 (profile first!)
```

Always profile before optimizing. The intuitive "this looks slow" is often wrong.

---

## Closing

COW is fast out of the box. These 20 optimizations cover the common scenarios where you might push it further. Most production COW systems benefit from only 3-5 of these — pick the ones that match your bottlenecks.

The most impactful optimizations are usually:
1. Switching from `atomic.Value` to `atomic.Pointer[T]`.
2. Batching writes.
3. Caching Load in local variables.
4. Bounding snapshot lifetimes.
5. Sharding when writes are contended.

Apply these first. Measure. Iterate.

Happy optimizing.
