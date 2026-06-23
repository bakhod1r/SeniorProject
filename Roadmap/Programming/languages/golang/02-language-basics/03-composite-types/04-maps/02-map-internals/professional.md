# Map Internals — Professional

> Author: Bakhodir Yashin Mansur

## 1. Production concerns this file addresses

1. Sizing maps correctly with `make(map[K]V, hint)`.
2. Choosing between `sync.RWMutex`-wrapped maps, `sync.Map`, and sharded maps.
3. Memory that does not come back after `delete`.
4. GC scan cost on big pointer-heavy maps.
5. Sharded maps as a near-mandatory pattern above 1M entries with high write churn.
6. Migration planning for the Swiss-table backend.
7. Observability: how to *see* map cost in pprof, runtime metrics, and traces.
8. Production failure modes — what each "fatal error: concurrent map writes" actually looked like before the postmortem.

Prior reading: [middle.md](middle.md) for grow mechanics, [senior.md](senior.md) for the source walk.

---

## 2. Capacity hints — `make(map[K]V, hint)`

`hint` is advisory. The runtime sizes `B` so that `2^B * 6.5 >= hint`, picking the smallest `B` that satisfies that. The hint is not a hard cap; the map grows past it normally.

### 2.1 Why it matters in production

A 1M-entry map grown from `B=0` traverses every doubling: `B=0,1,2,...,17`. Each doubling triggers an incremental evacuation. The total work is `O(n)` either way, but two costs are amplified:

- **Allocation churn**: 18 bucket arrays allocated, 17 garbage-collected.
- **Cache thrash**: each grow reshuffles cache lines; the working set of the map walks across many cache colors before settling.

With `make(map[K]V, 1_000_000)`, the initial allocation jumps straight to `B=18` (since `2^17 * 6.5 = 851_968` is too small, `2^18 * 6.5 = 1_703_936` is enough). One allocation, zero evacuations, zero garbage.

### 2.2 Benchmark

```go
func BenchmarkNoHint(b *testing.B) {
    for i := 0; i < b.N; i++ {
        m := map[int]int{}
        for j := 0; j < 1_000_000; j++ { m[j] = j }
    }
}

func BenchmarkWithHint(b *testing.B) {
    for i := 0; i < b.N; i++ {
        m := make(map[int]int, 1_000_000)
        for j := 0; j < 1_000_000; j++ { m[j] = j }
    }
}
```

Typical result on Go 1.22, amd64:

```
BenchmarkNoHint-12        20    52 ms/op    48 MB/op   17 allocs/op (bucket arrays)
BenchmarkWithHint-12      35    29 ms/op    40 MB/op    1 alloc/op
```

40 % faster, half the allocations.

### 2.3 When the hint hurts

Hinting too high is wasteful. A `make(map[int]int, 1_000_000)` that fills with 10 entries allocates the full bucket array immediately and never frees it. If your code creates many such maps (per-request caches, for instance), the per-request memory cost is dominated by the hint, not the data.

Rule of thumb: hint within a factor of 2 of the expected size.

---

## 3. Concurrency: RWMutex vs sync.Map vs sharded maps

Three patterns, each with a sweet spot.

### 3.1 RWMutex + map

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]Value
}

func (c *Cache) Get(k string) (Value, bool) {
    c.mu.RLock()
    v, ok := c.m[k]
    c.mu.RUnlock()
    return v, ok
}

func (c *Cache) Set(k string, v Value) {
    c.mu.Lock()
    c.m[k] = v
    c.mu.Unlock()
}
```

Cost model:

| Operation | Cost |
|-----------|------|
| Single-goroutine read | ~5 ns |
| RLock + read | ~15 ns under no contention |
| RLock contention | RWMutex blocks all readers when a writer is queued |
| Lock + write | ~25 ns under no contention |

**Best for**: maps with moderate concurrency and a clear read-heavy or write-heavy mix. Up to a few hundred QPS per map this is fastest by far.

### 3.2 sync.Map

```go
var m sync.Map
m.Store(k, v)
v, ok := m.Load(k)
m.Delete(k)
m.Range(func(k, v any) bool { ... })
```

`sync.Map` internally keeps two maps: a *read* map (atomically swapped, lock-free reads) and a *dirty* map (mutex-protected writes). When a key is read often and rarely written, the read map serves it without a lock. When a key is written, the entry migrates between the two maps.

**Best for two access patterns**:

1. **Write-once, read-many for distinct keys**: configuration entries, type registries, plugin tables.
2. **Disjoint key sets per goroutine**: when goroutine A only touches keys 1..N and goroutine B only touches keys N+1..2N — `sync.Map` avoids the false sharing of a single mutex.

**Worst for**:

- Hot-write, hot-read on the same keys — the migration between read and dirty maps is expensive.
- Iteration-heavy workloads — `Range` is far slower than `for k, v := range m`.

The Go team's own benchmark on `sync.Map` (in the source) says it's worth using only when one of those two patterns applies. Default to `RWMutex`.

### 3.3 Sharded maps

```go
const shards = 256

type Sharded[V any] struct {
    s [shards]shard[V]
}

type shard[V any] struct {
    mu sync.RWMutex
    m  map[string]V
}

func (s *Sharded[V]) shardFor(k string) *shard[V] {
    return &s.s[fnv32(k)&(shards-1)]
}

func (s *Sharded[V]) Get(k string) (V, bool) {
    sh := s.shardFor(k)
    sh.mu.RLock()
    v, ok := sh.m[k]
    sh.mu.RUnlock()
    return v, ok
}

func (s *Sharded[V]) Set(k string, v V) {
    sh := s.shardFor(k)
    sh.mu.Lock()
    sh.m[k] = v
    sh.mu.Unlock()
}
```

`fnv32` is a cheap hash. The shard count must be a power of two so the mask is one instruction.

Cost model:

| Workload | RWMutex | sync.Map | Sharded(256) |
|----------|---------|----------|--------------|
| Single-writer reads | 1×      | 2–3×     | 1.1×          |
| 4-writer mixed     | 4–8× slower | 1.5× slower | **1×**       |
| Iteration-heavy    | 1×      | 5× slower | 1.2× (per-shard iter) |
| Memory             | 1×      | 1.5× (two maps) | ~1.05× (per-shard overhead) |

**Use sharded maps when**:

- More than ~4 writers contend.
- Throughput exceeds ~1M ops/sec on a single map.
- Keys distribute uniformly enough that no shard becomes a hot spot.

256 is a common shard count: enough parallelism for 32-core machines, low enough memory overhead. Avoid choosing the shard count as `runtime.NumCPU()` — you want headroom for many goroutines per core.

### 3.4 Decision tree

```
Is this map written by exactly one goroutine?
  → Plain map. No lock.

Is it read-mostly with occasional writes, < 1k QPS?
  → RWMutex + map.

Is the access pattern "write-once-read-many on disjoint keys"?
  → sync.Map.

Is throughput > 100k QPS with multiple writers?
  → Sharded map (256 shards). Tune from there.

Anything more exotic?
  → Per-CPU caches (runtime.GOMAXPROCS slots), copy-on-write,
     or kick the problem out of the map and into a real key-value store.
```

---

## 4. Memory that does not come back after delete

`delete(m, k)` clears the slot and decrements `count`. It does **not** shrink the bucket array. A map that was 10M entries and is now 100 entries still occupies the bucket array for 10M.

### 4.1 The diagnostic

```go
import (
    "runtime"
    "runtime/debug"
)

func memSnapshot() uint64 {
    var s runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&s)
    return s.HeapAlloc
}

big := make(map[int]int, 10_000_000)
for i := 0; i < 10_000_000; i++ { big[i] = i }
fmt.Println("filled:", memSnapshot()/1e6, "MB")

for k := range big { delete(big, k) }
fmt.Println("drained:", memSnapshot()/1e6, "MB")

big = nil
debug.FreeOSMemory()
fmt.Println("nilled:", memSnapshot()/1e6, "MB")
```

You'll see roughly 320 MB (filled), 320 MB (drained — bucket array still alive), small (nilled — GC reclaimed).

### 4.2 The production-grade pattern: periodic shrink

```go
type Map[K comparable, V any] struct {
    mu sync.RWMutex
    m  map[K]V
    n  int     // peak count seen
}

func (m *Map[K, V]) maybeShrink() {
    cur := len(m.m)
    if m.n > 1024 && cur < m.n/4 {
        nm := make(map[K]V, cur*2)
        for k, v := range m.m {
            nm[k] = v
        }
        m.m = nm
        m.n = cur
    }
}

func (m *Map[K, V]) Delete(k K) {
    m.mu.Lock()
    defer m.mu.Unlock()
    delete(m.m, k)
    m.maybeShrink()
}
```

Trade-off: occasional `O(n)` rebuild cost vs steady memory. For long-lived caches whose size oscillates, this is essential. For short-lived caches, just let GC reclaim the whole map when the variable goes out of scope.

### 4.3 The `clear` built-in (Go 1.21+)

```go
clear(m) // resets count to 0, re-randomises hash0, but keeps bucket array
```

`clear` is faster than `for k := range m { delete(m, k) }` and does **not** shrink the array. Same memory footprint problem. For shrinking, allocate a new map.

---

## 5. GC scan cost on big maps

The garbage collector scans every pointer in every live bucket. For a map with `N` entries:

- If `K` and `V` are *pointer-free* (e.g., `map[int]int`), GC scans only the `hmap` header. Effectively free.
- If `K` or `V` contains pointers (e.g., `map[string]*Order`), GC scans every key and every value in every bucket — including the empty slots that contain stale-zero pointers, which is fine, and the overflow buckets, which is the real cost.

Empirical numbers from a real service (16-core, Go 1.22):

| Map kind | 1M entries | GC pause |
|----------|-----------|----------|
| `map[int]int` | 32 MB | < 0.1 ms |
| `map[string]int` | 80 MB | ~3 ms (strings are headers with a pointer) |
| `map[string]*Order` | 96 MB + N*sizeof(Order) | ~12 ms (string + pointer) |
| `map[int]string` | 64 MB | ~2 ms |
| `map[int][]byte` | 80 MB + slice data | ~8 ms |

The 12 ms pause on `map[string]*Order` was the actual incident that prompted the fix below.

### 5.1 The fix: index into a slice

```go
// Before — map with pointer-rich entries
var orders map[string]*Order

// After — keys map to slice indices; the slice holds the data
var (
    orderByID  map[string]int   // string -> int: no pointers in values
    orderTable []Order          // contiguous, scanned once linearly
)

func get(id string) (Order, bool) {
    i, ok := orderByID[id]
    if !ok { return Order{}, false }
    return orderTable[i], true
}

func put(id string, o Order) int {
    orderTable = append(orderTable, o)
    i := len(orderTable) - 1
    orderByID[id] = i
    return i
}
```

GC now scans:

- The `orderByID` map's keys (strings — one pointer each) and values (ints, no pointers).
- The `orderTable` slice once linearly, much cheaper than scanning a bucket array with random access.

The map's value type is `int`, so the bucket scan is free — only the keys carry pointers.

This pattern is the basis of [`bigcache`](https://github.com/allegro/bigcache) and [`freecache`](https://github.com/coocood/freecache), which take it further by storing serialised values in a single byte buffer and indexing by integer offset — zero pointers in the map.

### 5.2 When to bother

If GC pause time on your service shows pmu/pmap-induced peaks and your service has a multi-million-entry map with pointer-rich values, this is a 10× win. If you have a 10k-entry map, don't bother.

The diagnostic is `GOGC=off` plus `runtime.GC()` and a trace — if `gcAssist` time correlates with map size, you have this problem.

---

## 6. Sharded maps in depth

256 shards is a starting point. Pick based on:

- **Concurrency**: shard count ≥ peak concurrent writers × 2 to keep collision probability under 0.5.
- **Memory**: each shard is a separate `hmap` (48 bytes) plus a bucket array minimum (~256 bytes empty). 256 shards = ~78 KB overhead before any entries.
- **Iteration**: a full iteration acquires every shard's lock in turn — for read-heavy stable workloads this is OK; for write-heavy iteration is a stop-the-world per-shard event.

### 6.1 Shard-key choice

The shard key must be a fast hash of the map key:

```go
func fnv32(s string) uint32 {
    h := uint32(2166136261)
    for i := 0; i < len(s); i++ {
        h ^= uint32(s[i])
        h *= 16777619
    }
    return h
}
```

Or for integer keys:

```go
func splitmix(x uint64) uint64 {
    x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9
    x = (x ^ (x >> 27)) * 0x94d049bb133111eb
    return x ^ (x >> 31)
}
```

Do **not** use the map's own hash — `hmap.hash0` is internal and you would re-hash inside the shard anyway.

### 6.2 Avoiding the hotspot trap

A workload that 50 %-targets a single key concentrates 50 % of writes on one shard. The shard math doesn't fix that. Diagnostics:

- Per-shard size histogram once per minute.
- Lock contention via `go tool pprof -mutex`.

Mitigations: pre-shard hot keys (sharded by a request-derived suffix), or move to a copy-on-write cache for the hot subset.

### 6.3 Implementation pitfall: false sharing

Two adjacent shards' mutexes may share a 64-byte cache line. Writes to shard 0 ping-pong with writes to shard 1. Pad shards:

```go
type shard[V any] struct {
    mu sync.RWMutex
    m  map[string]V
    _  [56]byte // pad to 64 bytes after mu (8 bytes RWMutex header on 64-bit)
}
```

Measure with `perf stat -e cache-misses,cache-references` or Go's `runtime.metrics` `cpu/classes/gc/total:cpu-seconds`. False sharing is a 2–5× regression when present.

---

## 7. The Swiss-table backend (Go 1.24+)

The new backend uses Swiss tables (open addressing with SIMD probing), proposed in [#54766](https://github.com/golang/go/issues/54766). User-visible API is unchanged. Performance characteristics:

| Metric | Old | Swiss |
|--------|-----|-------|
| Lookup hit (cached) | 1× | ~0.8× (faster) |
| Lookup miss | 1× | ~0.7× (SIMD probes 16 slots at once) |
| Insert | 1× | ~0.9× |
| Memory | 1× | ~1.1× (control bytes overhead) |
| GC scan (pointer-free) | 1× | ~1× |
| Iteration order | randomized | randomized |
| Concurrent write detection | yes | yes |

The migration is a build-time toggle initially, default-on in a later release. No code changes are required.

The one observable change worth flagging: **the precise iteration order will differ** between backends. Code that accidentally relies on a particular randomization will break in a different way. The fix is the same — never rely on iteration order.

---

## 8. Observability

### 8.1 Spotting a hot map in pprof

```
go tool pprof -http=:9000 cpu.prof
```

Search the flame graph for:

- `runtime.mapaccess1` / `mapaccess2` — read-heavy hot map.
- `runtime.mapassign` — write-heavy hot map.
- `runtime.evacuate_*` — a map mid-grow on a hot path.
- `runtime.hashGrow` — repeated grows (probably a hint miss).
- `runtime.growWork_*` — also grow-related.

If `mapassign` is dominated by `growWork`, the map is grow-thrashing — add a capacity hint or pre-fill in bulk.

### 8.2 Memory profile

```
go tool pprof -http=:9000 -inuse_space mem.prof
```

A peak in `runtime.makeBucketArray` means many maps were created and not freed. A peak in `runtime.newobject` from `mapassign_fastXX` means many overflow buckets — same-size grow may be appropriate but is platform-controlled.

### 8.3 Mutex profile

For `RWMutex`-protected maps:

```bash
go tool pprof -http=:9000 -alloc_objects -mutex mutex.prof
```

Contention dominated by your map's `RUnlock`/`Unlock` is a signal to shard. If the same mutex shows up at the top of both block and mutex profiles, you have a hot-path bottleneck.

### 8.4 `runtime/metrics`

The standard library exposes (Go 1.21+):

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/gc/heap/objects:objects"},
    {Name: "/sched/goroutines:goroutines"},
}
metrics.Read(samples)
```

There is no map-specific metric. The closest signal is `/memory/classes/heap/objects:bytes` rising while you delete keys (no shrink). Build a per-map counter manually for visibility.

---

## 9. Real-incident summaries

These are anonymised from production postmortems — exact patterns you will meet.

### 9.1 Concurrent map writes in a request handler

**Symptom**: `fatal error: concurrent map writes` from a `metrics.RecordRequest` call.

**Cause**: a package-level `metricsByRoute map[string]*Counter` was written by every request without a lock. The pattern had been "safe" for years because traffic was sequential under load. A burst from a deploy doubled QPS and tripped the race.

**Fix**: `sync.Map` was the wrong fit (hot writes, same key). The team moved to a sharded counter map and added a lint rule banning package-level mutable maps without a documented sync strategy.

### 9.2 OOM from a never-shrinking session map

**Symptom**: process OOM after 6 days of uptime. Heap profile showed `runtime.makeBucketArray` at 8 GB.

**Cause**: a `map[sessionID]*Session` held active sessions. Sessions were deleted after logout, but a daily peak left the map at 5M entries. The map never shrank.

**Fix**: periodic rebuild — once per hour, swap in a fresh map containing only the live entries.

### 9.3 Mysterious p99 latency on a Cloud Run service

**Symptom**: occasional 200 ms spikes on a 10 ms-baseline endpoint.

**Cause**: a `map[string][]byte` cache grew to 2M entries. GC scans took ~80 ms each, and GC ran every 3 s. Spikes correlated with GC.

**Fix**: moved to a single `[]byte` blob indexed by a separate `map[string]int` of offsets. GC scan time dropped to 5 ms.

### 9.4 Goroutine leak via a map iteration

**Symptom**: goroutine count grew slowly; `for k, v := range m` showed up in goroutine dumps.

**Cause**: a handler iterated a hot map without holding the read lock, computed work per-entry, and triggered a `mapaccess` race. The race did *not* crash but corrupted an internal iterator state, leaving the goroutine spinning.

**Fix**: hold the RLock across the entire iteration, or copy keys into a slice first.

---

## 10. Migration checklist for a hot map

When promoting a map from "works" to "production-grade":

- [ ] Capacity hint matches expected size (within 2×).
- [ ] Concurrency strategy is documented (`// guarded by mu` or `// sharded` or `// single-writer goroutine X`).
- [ ] If shared, the lock is in the same file as the map.
- [ ] Iteration is over a snapshot, or holds the lock from start to finish.
- [ ] Long-lived map with churn has a shrink strategy.
- [ ] If values contain pointers, considered the slice-and-index pattern.
- [ ] Profile shows < 5 % of CPU in `runtime.mapaccess*` (otherwise sharded or other structure).
- [ ] No deferred unlocks inside hot loops (defer adds a few ns per call; in a 100M-op/s loop it dominates).
- [ ] If the Go 1.24+ Swiss-table backend is in use, regression-tested under the new backend.

---

## 11. Anti-patterns to actively remove

| Anti-pattern | Why it's bad |
|--------------|--------------|
| `m := map[string]int{}` for a 1M-entry map | 17 doubling grows. |
| `sync.Map` for a small mutex-protected map | Slower in every common case. |
| `var Cache map[K]V` at package level without lock | Eventual concurrent-write panic. |
| Iterating a map then modifying it inside the loop | Undefined results per spec. |
| Custom hash by `unsafe.Pointer` on a struct with pointers | Hash isn't stable across GC. |
| `m[k].field = v` workaround that re-assigns a 1KB struct in a loop | Excess copies; use pointer-valued map. |
| Storing huge values directly | Better to store a pointer and free the data explicitly. |
| Using `clear(m)` and expecting memory back | It doesn't shrink. |

---

## 12. Summary

Production map work is mostly about three concerns: **right-size**, **right-synchronize**, and **don't pin memory you don't need**. Hints, shrinks, and the slice-and-index pattern handle the first and third. RWMutex/sharded/`sync.Map` choice handles the second. Every other refinement — false-sharing padding, GC scan reduction, Swiss-table preparation — is incremental on top of these three.

Skip to [optimize.md](optimize.md) for capacity hint micro-benchmarks and key-type fast-path measurements.

---

## 13. Further reading

- `sync.Map` source: https://github.com/golang/go/blob/master/src/sync/map.go
- `runtime/metrics`: https://pkg.go.dev/runtime/metrics
- Bryan Mills, "Rethinking Classical Concurrency Patterns" (GopherCon 2018)
- `bigcache` README: https://github.com/allegro/bigcache#how-it-works
- Go 1.21 `clear` built-in: https://go.dev/ref/spec#Clear
- Swiss-table proposal: https://github.com/golang/go/issues/54766
