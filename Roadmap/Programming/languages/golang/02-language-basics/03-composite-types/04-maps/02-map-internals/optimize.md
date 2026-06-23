# Map Internals — Optimize

> Author: Bakhodir Yashin Mansur

## 1. Where the wins are

In a Go program where maps dominate CPU or memory, the levers — ordered by impact for a typical workload:

1. **Capacity hint** at `make` time to skip doubling grows.
2. **Key-type fast paths**: use `int32`/`int64`/`string` keys to land on `mapaccess1_fastNN`.
3. **Shard** to reduce mutex contention and false sharing.
4. **Skip pointer-rich values** to cut GC scan time on big maps.
5. **Avoid `m[k]++` style updates** in hot loops where a slice would do (see §8).
6. **Defer-free locking** for sub-µs operations.
7. **Right-size shard count** to actual concurrency.
8. **Migrate to the Swiss-table backend** when it becomes default.

Realistic total wins on a hot map: 2–4× throughput, 50–90 % memory reduction (if values were pointer-rich), 5–10× tail-latency improvement (GC-driven).

---

## 2. Measure first

A repeatable harness:

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func bench(name string, fn func()) {
    var s runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&s); before := s.HeapAlloc
    t := time.Now()
    fn()
    elapsed := time.Since(t)
    runtime.GC()
    runtime.ReadMemStats(&s); after := s.HeapAlloc
    fmt.Printf("%-30s %6.1f ms  alloc %5d KB\n",
        name, float64(elapsed.Milliseconds()), (after-before)/1024)
}
```

Always run each variant 5× and report the median. Use `runtime.GC()` between variants to compare from the same baseline. Compare alloc deltas, not just wall time — many map optimisations trade time for memory or vice versa.

For per-operation cost in a benchmark loop, prefer `testing.B`:

```go
func BenchmarkMapGet(b *testing.B) {
    m := make(map[int]int, 1024)
    for i := 0; i < 1024; i++ { m[i] = i }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = m[i&1023]
    }
}
```

`go test -bench=. -benchmem -count=5 ./...`.

---

## 3. Capacity hint

`make(map[K]V, hint)` sets `hmap.B` to the smallest value such that `2^B * 6.5 >= hint`. Each subsequent grow is avoided.

### 3.1 Numerical impact

Filling 1M entries:

| Variant | ns/op | B/op | allocs/op |
|---------|-------|------|-----------|
| `map[int]int{}` (no hint) | 51 ms | 51 MB | 17 |
| `make(map[int]int, 1_000_000)` | 28 ms | 42 MB | 1 |

For 10M entries the gap widens: 600 ms vs 280 ms, 480 MB vs 420 MB.

### 3.2 Calculating the right hint

If you know the exact final count, hint that count. If you have only a rough upper bound, hint it. Going over hint causes one or two grows (cheap); under-hinting causes many grows (expensive).

If hint is unknown but you can build a fixed-size source (a slice, a file with N lines), use `len(source)`:

```go
hint := len(records)
counts := make(map[string]int, hint)
for _, r := range records { counts[r.key]++ }
```

The `hint > expected` rule of thumb: ≤ 2× wastes some memory but no time; > 10× over-allocates significantly. Be tight when you can, loose when you can't.

### 3.3 What hint does *not* do

- Does not pre-allocate value memory (only the bucket array).
- Does not prevent same-size grows from overflow churn.
- Does not affect the cost of lookups, only of the inserts that grew the map.

---

## 4. Key-type fast paths

The compiler picks specialised functions when the key type is exactly `int32` (4-byte int kinds), `int64` (8-byte int kinds), `string`, or a pointer-sized type. The fast paths skip the type-erased equal-function call, dispatch directly on the byte representation, and inline more aggressively.

### 4.1 Benchmark

```go
type ID uint64

var keys64 = make([]uint64, 1000)
var keysID = make([]ID,     1000)
var keysS  = make([]string, 1000)
var keysStruct = make([]struct{ a, b uint32 }, 1000)

func BenchmarkGet_uint64(b *testing.B)       { m := make(map[uint64]int, 1024); for i, k := range keys64 { m[k] = i }; b.ResetTimer(); for i := 0; i < b.N; i++ { _ = m[keys64[i&1023]] } }
func BenchmarkGet_ID(b *testing.B)           { m := make(map[ID]int, 1024);     for i, k := range keysID { m[k] = i }; b.ResetTimer(); for i := 0; i < b.N; i++ { _ = m[keysID[i&1023]] } }
func BenchmarkGet_string(b *testing.B)       { m := make(map[string]int, 1024); for i, k := range keysS  { m[k] = i }; b.ResetTimer(); for i := 0; i < b.N; i++ { _ = m[keysS[i&1023]] } }
func BenchmarkGet_struct(b *testing.B)       { m := make(map[struct{a,b uint32}]int, 1024); for i, k := range keysStruct { m[k] = i }; b.ResetTimer(); for i := 0; i < b.N; i++ { _ = m[keysStruct[i&1023]] } }
```

Typical results on amd64, Go 1.22:

```
BenchmarkGet_uint64-12   100000000   12 ns/op
BenchmarkGet_ID-12       100000000   12 ns/op   (same — fast path)
BenchmarkGet_string-12    60000000   20 ns/op
BenchmarkGet_struct-12    30000000   34 ns/op   (generic path)
```

The struct key is ~3× slower because:

- No fast path; generic `mapaccess1` is called.
- `t.key.equal` is `memequal(8 bytes)` — fast but a function call.
- Slightly more branching.

### 4.2 Practical conversion

If your hot map keys on a struct, hash the struct yourself and use a `uint64` key:

```go
type key struct { user, item uint32 }

func keyHash(k key) uint64 { return uint64(k.user)<<32 | uint64(k.item) }

m := map[uint64]Value{}
m[keyHash(k)] = v
```

This works when the key fields collectively fit in 64 bits and you can prove uniqueness. For arbitrary struct keys, consider `xxhash` or `cityhash` to produce a 64-bit hash; collisions become possible and require a fallback (a slice of values per hash). The cost-benefit:

- ~2.5× faster lookup.
- Collision handling adds complexity and a small probability of false matches.

### 4.3 Pointer keys

Pointer-sized keys (`*T`) use `mapaccess1_fast64ptr`. As fast as `int64`. If your "key" is a pointer to a globally-unique object (an interned string, for example), this is the fastest possible map.

---

## 5. Avoid the generic write path on hot loops

`mapassign` does more work than `mapaccess1` even on the fast paths. Two common patterns:

### 5.1 Histogram-style increments

```go
// slow on a 1B-iteration loop
for _, x := range data {
    counts[x]++
}
```

Each increment is a `mapaccess` + `mapassign`. If keys are dense integers in `[0, N)`, replace with a slice:

```go
counts := make([]int, N)
for _, x := range data { counts[x]++ }
```

10–20× faster for the same workload.

### 5.2 Coalesced writes

If you can buffer writes and apply them in a single pass:

```go
type op struct { k string; delta int }
var ops []op
// ... build ops ...
for _, o := range ops { counts[o.k] += o.delta }
```

Sorting `ops` by key first makes the writes touch buckets in order, improving cache locality. Empirically a 1.5–2× speedup on multi-million-entry batches.

---

## 6. Sharding for concurrency

[professional.md](professional.md) §6 has the design. Here we focus on tuning the shard count.

### 6.1 Shard count vs concurrency

Rule: `shards ≈ 2 × peak_concurrent_writers`. Power-of-two for fast masking.

| Peak writers | Shard count |
|--------------|-------------|
| 1–4 | 16 |
| 4–16 | 64 |
| 16–64 | 256 |
| 64–256 | 1024 |
| > 256 | rethink design |

### 6.2 Avoid false sharing

Padding:

```go
type shard[V any] struct {
    mu sync.RWMutex     // ~24 bytes
    m  map[string]V     // 8 bytes (pointer)
    _  [32]byte         // pad to 64 bytes
}
```

A `[64]struct{}` array of shards then sits on its own cache lines. Without padding, two shards' mutexes share a line and writes thrash the cache.

### 6.3 Iteration of a sharded map

Iteration is the worst case for sharding: you must lock each shard in turn, copy its keys (or yield under lock), and proceed. For a 256-shard map this is 256 lock acquisitions. If iteration is hot, sharding is the wrong structure — go back to one map plus `RWMutex`, or use a CoW snapshot.

### 6.4 Bonus: per-CPU sharding

For extreme concurrency, shard on `runtime_procPin()` (the current P's ID). Each P writes only to its own shard. Aggregating across shards happens at read time, lazily.

```go
type CPUSharded[V any] struct {
    shards []shard[V]
}

func (c *CPUSharded[V]) Add(k string, v V) {
    pid := runtime_procPin()
    c.shards[pid].m[k] = v
    runtime_procUnpin()
}
```

Cost: aggregating reads is slow (touches every shard); pid pinning prevents the goroutine from migrating during the critical section. Use only when single-write throughput dominates everything else.

---

## 7. Reduce GC cost on pointer-rich maps

Recap from [professional.md](professional.md) §5: pointer-bearing values force GC to walk every bucket. Switching to a slice + integer-index map drops GC time dramatically.

### 7.1 The arena pattern

```go
type Arena struct {
    mu    sync.RWMutex
    index map[string]int        // key -> offset
    lens  map[string]uint32     // key -> length
    data  []byte                // contiguous storage
}

func (a *Arena) Put(k string, v []byte) {
    a.mu.Lock(); defer a.mu.Unlock()
    off := len(a.data)
    a.data = append(a.data, v...)
    a.index[k] = off
    a.lens[k]  = uint32(len(v))
}

func (a *Arena) Get(k string) []byte {
    a.mu.RLock(); defer a.mu.RUnlock()
    off, ok := a.index[k]
    if !ok { return nil }
    return a.data[off : off+int(a.lens[k])]
}
```

GC scans:
- `index` — string keys (pointer) + int values (no pointer).
- `lens` — string keys + uint32 values.
- `data` — one `[]byte`, no pointers inside.

The arena never frees individual entries (a deletion leaves a hole). For long-lived caches with stable populations, this is fine. For aggressive churn, periodically compact:

```go
func (a *Arena) Compact() {
    a.mu.Lock(); defer a.mu.Unlock()
    newData := make([]byte, 0, len(a.data))
    newIndex := make(map[string]int, len(a.index))
    for k, off := range a.index {
        ln := int(a.lens[k])
        newIndex[k] = len(newData)
        newData = append(newData, a.data[off:off+ln]...)
    }
    a.data = newData
    a.index = newIndex
}
```

Or use one of the existing libraries: [bigcache](https://github.com/allegro/bigcache), [freecache](https://github.com/coocood/freecache), [ristretto](https://github.com/dgraph-io/ristretto).

### 7.2 When not to bother

If your map has < 100k entries, GC scan cost is negligible. Save the complexity for big maps where you can measure the gain.

---

## 8. Avoid `defer` in microsecond-scale operations

```go
func (c *Cache) Get(k string) (V, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    v, ok := c.m[k]
    return v, ok
}
```

`defer` costs ~5 ns on Go 1.22 (much less than earlier versions, but still measurable). For a `Get` that itself takes ~12 ns on a fast path, the defer adds ~40 % overhead.

Tight version:

```go
func (c *Cache) Get(k string) (V, bool) {
    c.mu.RLock()
    v, ok := c.m[k]
    c.mu.RUnlock()
    return v, ok
}
```

Trade-off: if the body panics, the lock is not released. In a hot read path you control entirely, accepting that risk is reasonable. In a path that may panic (calls into user code), keep the defer.

A benchmark confirms the difference for sub-µs operations; for anything > 1 µs, `defer` is negligible.

---

## 9. Watch for unintended boxing

```go
var any interface{} = "key"
m := map[interface{}]int{}
m[any] = 1
```

Interface-typed keys force the runtime through the generic `mapaccess1` path *and* incur an `eface` allocation on each insert (sometimes; see [interface internals](../../../03-methods-and-interfaces/10-interface-internals/) §7 on `convT*` boxing).

If you can constrain the key to a concrete type, do it. `map[any]V` is the slowest possible map.

---

## 10. PGO and inlining

Go 1.20+ supports Profile-Guided Optimization (PGO). For a hot map-driven function:

```bash
# Capture a CPU profile
go test -bench=. -cpuprofile=cpu.pprof

# Build with PGO
go build -pgo=cpu.pprof ./...
```

PGO can devirtualize and inline `mapaccess1_fastNN` calls into the caller, eliminating a function-call overhead per access. Measured wins: 5–15 % on map-heavy workloads.

PGO does not help maps with generic keys (no fast path to inline).

---

## 11. The Swiss-table backend (Go 1.24+)

The new backend, behind a build experiment in Go 1.24, improves lookups by ~20 % and misses by more (SIMD probing scans 8 control bytes at once). No code changes needed; just rebuild.

Migration checklist:

- Run your hot-map benchmarks under both backends.
- Re-tune capacity hints — the new backend has slightly different memory characteristics (group size, control bytes overhead).
- Re-confirm that no test relies on a specific iteration order (the new backend shuffles differently).
- Re-profile GC: pointer-bearing maps' scan cost is similar but layout differs.

Until the experiment becomes default, treat it as a forward bet: build for it, but tune for both.

---

## 12. Decision flowchart

```
Is this map hot in CPU or memory profile?
  no → skip optimization, accept defaults.
  yes:

  Is filling cost > 10 ms?
    yes → add capacity hint.

  Is the key type not int32/int64/string/pointer?
    yes → convert to an integer hash if collisions are manageable.

  Are there multiple writers?
    yes → mutex → measure contention → if hot, shard.

  Are values pointer-rich and map > 100k entries?
    yes → arena pattern.

  Are increments the hot operation?
    yes → if keys are dense ints, use a slice.

  Is iteration hot?
    yes → snapshot once and iterate the snapshot.

  Still slow?
    Profile mutex/CPU/alloc separately. Address the dominant cost.
```

---

## 13. A complete worked example

A counter service that aggregates per-user request counts:

```go
// Before
type Counter struct {
    mu sync.Mutex
    m  map[string]int
}

func (c *Counter) Inc(user string) {
    c.mu.Lock()
    c.m[user]++
    c.mu.Unlock()
}

func (c *Counter) Snapshot() map[string]int {
    c.mu.Lock(); defer c.mu.Unlock()
    out := make(map[string]int, len(c.m))
    for k, v := range c.m { out[k] = v }
    return out
}
```

Profile: 80 % of CPU in `Counter.Inc`, of which 60 % is lock contention under 200k QPS across 16 goroutines.

Optimized:

```go
const shards = 64

type Counter struct {
    s [shards]struct {
        mu sync.Mutex
        m  map[string]int
        _  [32]byte // pad to 64 bytes
    }
}

func New() *Counter {
    c := &Counter{}
    for i := range c.s { c.s[i].m = make(map[string]int, 1024) }
    return c
}

func (c *Counter) Inc(user string) {
    sh := &c.s[fnv32(user)&(shards-1)]
    sh.mu.Lock()
    sh.m[user]++
    sh.mu.Unlock()
}

func (c *Counter) Snapshot() map[string]int {
    out := make(map[string]int, 64*1024)
    for i := range c.s {
        c.s[i].mu.Lock()
        for k, v := range c.s[i].m { out[k] = v }
        c.s[i].mu.Unlock()
    }
    return out
}

func fnv32(s string) uint32 {
    h := uint32(2166136261)
    for i := 0; i < len(s); i++ { h ^= uint32(s[i]); h *= 16777619 }
    return h
}
```

Results: throughput 4.5×, CPU per operation 2.8× lower, p99 from 8 ms to 0.7 ms.

Further optimisations possible:

- Replace `map[string]int` with a slice indexed by an interned user ID (if user IDs are dense).
- Replace `int` with `int64` and use `atomic.AddInt64` per slot (lock-free).
- Per-CPU sharding via `runtime_procPin()`.

Each step trades more code complexity for more throughput. Stop when the profile says map work is no longer the bottleneck.

---

## 14. Anti-optimizations to avoid

| Idea | Why it doesn't work |
|------|---------------------|
| Increase load factor to "save memory" | Not configurable; compile-time constant. |
| Replace map with a binary tree | Slower for almost every workload. |
| Use `sync.Map` to "be safe" | Slower than RWMutex outside its sweet spot. |
| Pre-touch every bucket to "warm cache" | Useless once allocator zeroes pages anyway. |
| Run `runtime.GC()` periodically to "keep heap small" | Adds latency spikes; let GC self-tune. |
| Set GOMAXPROCS=1 to avoid map contention | Cripples the rest of the program. |

---

## 15. Summary

The right order to optimise a hot map: **measure, hint, fast-path the key, shard, escape GC**. Each step has a clear measurable signal. The Swiss-table backend will eventually give you a free 20 % on top of everything else, but plan the migration once it stabilises.

Sibling files: [professional.md](professional.md) for design patterns, [find-bug.md](find-bug.md) for the failure modes to avoid.

---

## 16. Further reading

- `runtime/map.go`: https://github.com/golang/go/blob/master/src/runtime/map.go
- `runtime/map_fast{32,64,str}.go`: same directory.
- Go PGO docs: https://go.dev/doc/pgo
- `pprof`: https://go.dev/blog/pprof
- `bigcache`: https://github.com/allegro/bigcache
- `freecache`: https://github.com/coocood/freecache
- `ristretto`: https://github.com/dgraph-io/ristretto
- Swiss-table proposal: https://github.com/golang/go/issues/54766
