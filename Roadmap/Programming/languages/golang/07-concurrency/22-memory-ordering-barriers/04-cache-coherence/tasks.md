---
layout: default
title: Cache Coherence — Tasks
parent: Cache Coherence
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/04-cache-coherence/tasks/
---

# Cache Coherence — Hands-On Tasks

A progressive set of practical exercises. Each builds on the previous.

---

## Task 1: Reproduce False Sharing

**Goal:** Observe false sharing with your own eyes.

Write a benchmark with two `int64` fields in one struct, two goroutines each updating one field. Run with `-cpu=2`. Note ns/op.

```go
package falseshare

import (
    "sync"
    "sync/atomic"
    "testing"
)

type Pair struct{ a, b int64 }

func BenchmarkPacked(b *testing.B) {
    var p Pair
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        wg.Add(2)
        go func() { defer wg.Done(); for j := 0; j < 1_000_000; j++ { atomic.AddInt64(&p.a, 1) } }()
        go func() { defer wg.Done(); for j := 0; j < 1_000_000; j++ { atomic.AddInt64(&p.b, 1) } }()
        wg.Wait()
    }
}
```

Run: `go test -bench=BenchmarkPacked -cpu=2 -benchtime=3s`.

**Expected:** ns/op should be significantly higher than a single-goroutine benchmark for one variable.

---

## Task 2: Fix False Sharing with Padding

**Goal:** Apply the simplest fix and measure the improvement.

Add 56 bytes of padding between `a` and `b`:

```go
type PaddedPair struct {
    a int64
    _ [56]byte
    b int64
    _ [56]byte
}
```

Write `BenchmarkPadded` mirroring `BenchmarkPacked`. Run with the same settings.

**Expected:** ns/op for padded version is 2-5× faster than packed.

Compare with `benchstat`:

```
go test -bench=. -count=10 -cpu=2 -benchtime=3s > out.txt
benchstat -filter "/cpu:2" out.txt
```

---

## Task 3: Sweep the Cache Line Boundary

**Goal:** Find the exact cache line size empirically.

Write a benchmark generator that varies the padding between two `int64` fields from 0 to 128 bytes in 8-byte steps. For each, measure ns/op.

```go
import "unsafe"

func runWithPad(b *testing.B, pad int) {
    buf := make([]byte, 8 + pad + 8)
    a := (*int64)(unsafe.Pointer(&buf[0]))
    bb := (*int64)(unsafe.Pointer(&buf[8+pad]))
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        wg.Add(2)
        go func() { defer wg.Done(); for j := 0; j < 100_000; j++ { atomic.AddInt64(a, 1) } }()
        go func() { defer wg.Done(); for j := 0; j < 100_000; j++ { atomic.AddInt64(bb, 1) } }()
        wg.Wait()
    }
}

func BenchmarkPad0(b *testing.B)   { runWithPad(b, 0) }
func BenchmarkPad8(b *testing.B)   { runWithPad(b, 8) }
// ... up to pad=128
```

**Expected:** A step change around pad=56 (when the second int64 crosses to a new cache line on x86) or pad=120 (Apple silicon).

---

## Task 4: Per-CPU Sharded Counter

**Goal:** Build a counter that scales linearly with cores.

Implement:

```go
type ShardedCounter struct {
    shards []paddedInt64
}

type paddedInt64 struct {
    v atomic.Int64
    _ [56]byte
}

func New() *ShardedCounter {
    return &ShardedCounter{shards: make([]paddedInt64, runtime.NumCPU())}
}

func (c *ShardedCounter) Add(hint uint64, d int64) {
    c.shards[hint%uint64(len(c.shards))].v.Add(d)
}

func (c *ShardedCounter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].v.Load()
    }
    return s
}
```

Benchmark with `-cpu=1,2,4,8`. Compare ns/op against a shared `atomic.Int64`.

**Expected:** Sharded counter ns/op stays roughly flat (or improves) as cores increase; shared counter degrades.

---

## Task 5: Snapshot Pointer Config Store

**Goal:** Implement a read-mostly config store with atomic.Pointer.

```go
type Config struct {
    Timeout time.Duration
    MaxConcurrent int
}

type Store struct {
    snap atomic.Pointer[Config]
}

func New() *Store { return &Store{} }

func (s *Store) Set(c *Config) { s.snap.Store(c) }

func (s *Store) Get() *Config { return s.snap.Load() }
```

Benchmark: one writer updating config every second, N readers polling continuously. Vary N (1, 4, 16). Measure read ns/op.

**Expected:** Read ns/op stays flat as N increases. Writer impact on readers is brief.

---

## Task 6: Layout Verification

**Goal:** Verify your struct layout at runtime.

For a padded struct, verify the hot fields are on different cache lines:

```go
import "unsafe"

func init() {
    var c Counter
    a := uintptr(unsafe.Pointer(&c.a))
    b := uintptr(unsafe.Pointer(&c.b))
    if a/64 == b/64 {
        panic("Counter.a and Counter.b share a cache line")
    }
}
```

Add such checks for any struct where layout is load-bearing.

---

## Task 7: Detect Coherence in pprof

**Goal:** Learn to read pprof for coherence.

Take any benchmark from Task 1 or 4. Generate a CPU profile:

```
go test -bench=BenchmarkPacked -benchtime=10s -cpu=4 -cpuprofile=cpu.prof
go tool pprof cpu.prof
(pprof) top10
```

**Expected:** `runtime/internal/atomic.Xadd64` or similar should be near the top.

In pprof: `web` for a graph; `list <function>` to see source-level breakdown.

---

## Task 8: Use perf c2c (Linux)

**Goal:** Generate and read a `perf c2c` report.

Build a benchmark binary:

```
go test -c -o falseshare.test
```

Run with perf:

```
sudo perf c2c record -F 4000 -a -- ./falseshare.test -test.bench=BenchmarkPacked -test.benchtime=5s
sudo perf c2c report --stdio > c2c.txt
```

Examine `c2c.txt`. Find the hot cache lines. Verify they correspond to the contended struct fields.

---

## Task 9: Build a Sharded Mutex Map

**Goal:** Implement a concurrent map with sharded mutexes.

```go
type ShardedMap struct {
    shards []mapShard
}

type mapShard struct {
    mu sync.Mutex
    m  map[string]interface{}
    _  [40]byte // pad
}

func New(n int) *ShardedMap {
    shards := make([]mapShard, n)
    for i := range shards { shards[i].m = make(map[string]interface{}) }
    return &ShardedMap{shards: shards}
}

func (m *ShardedMap) Get(key string) (interface{}, bool) {
    s := &m.shards[hash(key)%uint64(len(m.shards))]
    s.mu.Lock()
    defer s.mu.Unlock()
    v, ok := s.m[key]
    return v, ok
}

func (m *ShardedMap) Set(key string, value interface{}) {
    s := &m.shards[hash(key)%uint64(len(m.shards))]
    s.mu.Lock()
    s.m[key] = value
    s.mu.Unlock()
}

func hash(s string) uint64 {
    var h uint64 = 14695981039346656037
    for i := 0; i < len(s); i++ {
        h ^= uint64(s[i])
        h *= 1099511628211
    }
    return h
}
```

Benchmark Get and Set under concurrent load. Compare against `sync.Map` and a single-mutex-protected map.

---

## Task 10: SPSC Lock-Free Ring Buffer

**Goal:** Implement a wait-free single-producer single-consumer ring.

```go
type Ring[T any] struct {
    write atomic.Uint64
    _     [56]byte
    read  atomic.Uint64
    _     [56]byte
    buf   []T
    mask  uint64
}

func New[T any](size int) *Ring[T] {
    size = nextPow2(size)
    return &Ring[T]{buf: make([]T, size), mask: uint64(size - 1)}
}

func (r *Ring[T]) Push(v T) bool {
    w := r.write.Load()
    rr := r.read.Load()
    if w-rr >= uint64(len(r.buf)) {
        return false
    }
    r.buf[w&r.mask] = v
    r.write.Store(w + 1)
    return true
}

func (r *Ring[T]) Pop() (T, bool) {
    var zero T
    rr := r.read.Load()
    w := r.write.Load()
    if rr == w {
        return zero, false
    }
    v := r.buf[rr&r.mask]
    r.read.Store(rr + 1)
    return v, true
}

func nextPow2(n int) int {
    p := 1; for p < n { p *= 2 }; return p
}
```

Benchmark with one producer goroutine pushing as fast as possible and one consumer goroutine popping. Measure throughput in items/sec.

**Expected:** ~200M items/sec on a fast x86.

---

## Task 11: Hot/Cold Struct Split

**Goal:** Restructure a real struct with mixed access patterns.

Take a struct from your own codebase that has both frequently-mutated fields and rarely-touched fields. Refactor to put hot fields first with padding, cold fields after.

```go
type Service struct {
    // hot
    requests atomic.Int64
    _        cpu.CacheLinePad
    errors   atomic.Int64
    _        cpu.CacheLinePad

    // cold
    name    string
    address string
    config  *Config
}
```

Benchmark before and after. If the struct is in a hot path, you should see throughput improvement.

---

## Task 12: Read-Mostly Map with Copy-on-Write

**Goal:** Implement a COW map.

```go
type COWMap[K comparable, V any] struct {
    m atomic.Pointer[map[K]V]
}

func New[K comparable, V any]() *COWMap[K, V] {
    m := make(map[K]V)
    c := &COWMap[K, V]{}
    c.m.Store(&m)
    return c
}

func (c *COWMap[K, V]) Get(k K) (V, bool) {
    m := c.m.Load()
    v, ok := (*m)[k]
    return v, ok
}

func (c *COWMap[K, V]) Set(k K, v V) {
    for {
        old := c.m.Load()
        next := make(map[K]V, len(*old)+1)
        for k2, v2 := range *old { next[k2] = v2 }
        next[k] = v
        if c.m.CompareAndSwap(old, &next) { return }
    }
}
```

Benchmark Get vs Set. Compare with `sync.Map` and a regular `map + Mutex`. Find the sweet-spot read:write ratio for each.

---

## Task 13: Histogram Aggregation

**Goal:** Build a per-CPU histogram.

```go
type Histogram struct {
    shards []histShard
    bounds []float64
}

type histShard struct {
    buckets []atomic.Int64
    _       cpu.CacheLinePad
}

func New(bounds []float64) *Histogram {
    n := runtime.NumCPU()
    shards := make([]histShard, n)
    for i := range shards {
        shards[i].buckets = make([]atomic.Int64, len(bounds)+1)
    }
    return &Histogram{shards: shards, bounds: bounds}
}

func (h *Histogram) Observe(hint uint64, value float64) {
    idx := h.bucketIndex(value)
    h.shards[hint%uint64(len(h.shards))].buckets[idx].Add(1)
}

func (h *Histogram) Snapshot() []int64 {
    out := make([]int64, len(h.bounds)+1)
    for i := range h.shards {
        for j := range h.shards[i].buckets {
            out[j] += h.shards[i].buckets[j].Load()
        }
    }
    return out
}

func (h *Histogram) bucketIndex(value float64) int {
    for i, b := range h.bounds {
        if value <= b { return i }
    }
    return len(h.bounds)
}
```

Benchmark with many concurrent Observers. Compare with a single shared `[]atomic.Int64`.

---

## Task 14: Set Up CI Benchmarks

**Goal:** Add CI that catches regressions.

Add a `.github/workflows/bench.yml`:

```yaml
name: bench
on: [pull_request]
jobs:
  bench:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
      - name: benchmark
        run: |
          go test -bench=. -count=5 -benchtime=3s -cpu=1,4 -timeout=15m ./... > new.txt
          cat new.txt
```

Add benchstat comparison logic. Fail on >10% regression.

---

## Task 15: Profile Production

**Goal:** Diagnose a real coherence problem.

Pick a service you operate. Run a CPU profile during load:

```
curl http://service:6060/debug/pprof/profile?seconds=60 > prof.out
go tool pprof -http=:8080 prof.out
```

Look at the top functions. If any atomic or mutex function is in the top 5, hypothesize a coherence issue. Confirm with the benchmark suite. Fix.

---

## Task 16: Read the Runtime

**Goal:** Internalise the patterns.

Read `src/sync/pool.go` end to end. Note every place padding appears. Note the `pin`/`unpin` pattern.

Read `src/runtime/proc.go` enough to understand `findrunnable`. Note how per-P data is accessed.

Read `src/runtime/mheap.go` to see `central` array padding.

Write a one-page summary for yourself.

---

## Task 17: Mentor

**Goal:** Teach a junior engineer.

Pair-program a coherence-related fix with a junior. Walk them through:

1. Identifying the suspect struct.
2. Measuring with a benchmark.
3. Applying the fix.
4. Confirming the improvement.

Mentoring solidifies your own understanding.

---

## Task 18: Contribute Upstream

**Goal:** Make the ecosystem better.

Pick a library you use. Profile it under load. If you find a coherence issue, fix it locally. Then:

1. Open an issue on the project's tracker.
2. Submit a PR with measurements.
3. Engage with maintainers.

Even small fixes (padding a field, sharding a counter) benefit many users.

---

## Task 19: Design Document

**Goal:** Plan a cache-aware design.

For a service or library you maintain, write a design doc covering:

- Hot data structures and their access patterns.
- Padding/sharding decisions.
- Benchmarks demonstrating scaling.
- CI guardrails.
- Operational monitoring.

Share with your team.

---

## Task 20: Reflect

**Goal:** Internalise the discipline.

After completing the previous tasks, reflect:

- What surprised you?
- Where in your own codebase is the next opportunity?
- How will you operationalise cache awareness on your team?

Write a journal entry. Revisit in three months.

---

## Closing

Twenty tasks. Each takes from minutes to days. Complete them in sequence; cache-coherence intuition will become reflex.

End of tasks.md.
