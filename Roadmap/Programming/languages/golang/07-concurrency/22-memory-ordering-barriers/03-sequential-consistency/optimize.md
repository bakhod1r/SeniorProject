---
layout: default
title: Sequential Consistency — Optimize
parent: Sequential Consistency
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/03-sequential-consistency/optimize/
---

# Sequential Consistency — Optimization Exercises

Performance-focused exercises to reduce SC overhead in real workloads. Each exercise shows a baseline implementation and asks you to optimise.

---

## Exercise 1: Reduce False Sharing

**Baseline:**

```go
type Stats struct {
    A atomic.Int64
    B atomic.Int64
    C atomic.Int64
}
```

Multiple goroutines update different fields. Profile shows poor scaling.

**Optimise:** Add cache-line padding.

```go
type Stats struct {
    A atomic.Int64
    _ [56]byte
    B atomic.Int64
    _ [56]byte
    C atomic.Int64
    _ [56]byte
}
```

**Benchmark target:** 3-5x improvement on 8-core machines.

**Verification:** `perf stat -e cache-misses` shows reduction.

---

## Exercise 2: Shard a Hot Counter

**Baseline:**

```go
var counter atomic.Int64

func inc() { counter.Add(1) }
```

Profiles show `runtime/internal/atomic.Xadd64` as a hot spot under high contention.

**Optimise:** Per-CPU sharding.

```go
type ShardedCounter struct {
    shards [64]struct {
        v atomic.Int64
        _ [56]byte
    }
}

func (c *ShardedCounter) Inc(g int) {
    c.shards[g%64].v.Add(1)
}

func (c *ShardedCounter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].v.Load()
    }
    return s
}
```

**Benchmark target:** 10-50x improvement on 16+ cores.

---

## Exercise 3: Batch Updates

**Baseline:**

```go
// Each event increments shared counter
func handleEvent() {
    counter.Add(1)
}
```

Counter is hot. Sharding helps but the cost is still per-event.

**Optimise:** Per-goroutine local accumulation, periodic flush.

```go
type LocalCounter struct {
    local   int64
    counter *atomic.Int64
}

func (l *LocalCounter) Inc() {
    l.local++
    if l.local >= 100 {
        l.counter.Add(l.local)
        l.local = 0
    }
}
```

**Benchmark target:** 50-100x reduction in atomic operations.

**Trade-off:** Counter reads see slightly stale values until flush.

---

## Exercise 4: Replace RWMutex with COW

**Baseline:**

```go
type Config struct{ /* fields */ }

type Store struct {
    mu  sync.RWMutex
    cfg Config
}

func (s *Store) Read() Config {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.cfg
}
```

Reads are frequent. RLock adds overhead.

**Optimise:** Copy-on-write with atomic.Pointer.

```go
type Store struct {
    cfg atomic.Pointer[Config]
}

func (s *Store) Read() *Config { return s.cfg.Load() }

func (s *Store) Update(c *Config) { s.cfg.Store(c) }
```

**Benchmark target:** 100-800x improvement on reads.

---

## Exercise 5: Eliminate Unnecessary Atomics

**Baseline:**

```go
type Server struct {
    requests atomic.Int64
    errors   atomic.Int64
}

func (s *Server) handle() {
    s.requests.Add(1) // every request increments
    // ...
}
```

Profile shows atomic.Add as significant overhead.

**Optimise:** Aggregate per-handler stats locally, flush at handler exit.

```go
type LocalStats struct {
    requests int64
    errors   int64
}

func (s *Server) handle() {
    var local LocalStats
    local.requests++
    // do work, possibly local.errors++
    s.requests.Add(local.requests)
    s.errors.Add(local.errors)
}
```

**Benchmark target:** Reduce atomic ops by 50%.

**Trade-off:** Stats only accurate after handler exit.

---

## Exercise 6: Optimise Spin Loops

**Baseline:**

```go
for !ready.Load() {
}
```

Tight spin burns CPU.

**Optimise:** Backoff strategy.

```go
spins := 0
for !ready.Load() {
    if spins < 100 {
        spins++
    } else if spins < 1000 {
        runtime.Gosched()
        spins++
    } else {
        time.Sleep(time.Microsecond)
    }
}
```

Or replace with a channel:

```go
<-readyCh
```

**Benchmark target:** CPU usage drops significantly during waits.

---

## Exercise 7: Read-Only Snapshots

**Baseline:**

```go
type Map struct {
    mu sync.RWMutex
    m  map[string]int
}

func (m *Map) Get(k string) int {
    m.mu.RLock()
    defer m.mu.RUnlock()
    return m.m[k]
}
```

**Optimise:** Atomic snapshot.

```go
type Map struct {
    m atomic.Pointer[map[string]int]
}

func (m *Map) Get(k string) int {
    return (*m.m.Load())[k]
}
```

**Benchmark target:** Reads become near-free.

---

## Exercise 8: NUMA-Aware Sharding

**Baseline:** Sharded counter on a 4-NUMA-node machine. Throughput plateaus across NUMA boundaries.

**Optimise:** Pin shards to NUMA nodes.

```go
// Requires platform-specific code (Linux: sched_setaffinity).
// Each goroutine pinned to a CPU; uses the shard local to that NUMA node.
```

**Benchmark target:** Reduced cross-node traffic; improved throughput.

**Note:** NUMA-pinning in Go requires cgo or unsafe. Use carefully.

---

## Exercise 9: Avoid CAS Retry Loops Where Possible

**Baseline:**

```go
for {
    old := v.Load()
    if v.CompareAndSwap(old, old+1) {
        break
    }
}
```

CAS retries under contention.

**Optimise:** Use `Add` directly.

```go
v.Add(1)
```

`Add` is a single instruction; CAS may retry many times.

**Benchmark target:** Eliminate retry overhead.

---

## Exercise 10: Lock-Free Stack vs Channel

**Baseline:** Use a channel for inter-goroutine work queue.

```go
ch := make(chan Work, 100)
```

**Optimise:** For very high throughput, use lock-free queue.

```go
// Vyukov bounded MPMC queue (see senior.md)
```

**Benchmark target:** 3-5x throughput improvement under extreme load.

**Trade-off:** More complex code; less Go-idiomatic. Prefer channels unless measured benefit.

---

## Exercise 11: Reduce Atomic Pointer Allocations

**Baseline:**

```go
type State struct{ /* large */ }

var cur atomic.Pointer[State]

func update(s State) {
    cur.Store(&s) // allocates
}
```

Each update allocates a new State on the heap.

**Optimise:** Pool allocated States.

```go
var pool = sync.Pool{New: func() any { return new(State) }}

func update(s State) {
    n := pool.Get().(*State)
    *n = s
    cur.Store(n)
}
```

**Benchmark target:** Reduced GC pressure.

**Caveat:** Must not put old State back into pool while readers still hold pointer.

---

## Exercise 12: Cache-Aware Data Layout

**Baseline:**

```go
type Entry struct {
    Hot atomic.Int64
    Cold [60]byte // rarely accessed
}
```

Hot and cold data share cache lines.

**Optimise:** Separate hot and cold data.

```go
type Entry struct {
    Hot atomic.Int64
    _   [56]byte
}

type ColdData struct {
    Data [60]byte
}
```

**Benchmark target:** Less cache pollution; better hot-path performance.

---

## Exercise 13: Pre-Allocate Atomics

**Baseline:**

```go
counters := make(map[string]*atomic.Int64)
// counters added at runtime
```

Map lookup overhead per access.

**Optimise:** Pre-allocate known keys.

```go
const (
    CounterA = iota
    CounterB
    CounterC
    NumCounters
)

counters := [NumCounters]atomic.Int64{}
```

**Benchmark target:** Replace map lookup with array index.

---

## Exercise 14: Reduce Sharding Overhead

**Baseline:** 64-shard counter sums 64 atomic loads per read.

**Optimise:** Cache the sum periodically.

```go
type Counter struct {
    shards [64]struct{ v atomic.Int64; _ [56]byte }
    cached atomic.Int64
    last   atomic.Int64 // unix nano
}

func (c *Counter) Sum() int64 {
    last := c.last.Load()
    now := time.Now().UnixNano()
    if now-last < int64(time.Second) {
        return c.cached.Load()
    }
    var s int64
    for i := range c.shards {
        s += c.shards[i].v.Load()
    }
    c.cached.Store(s)
    c.last.Store(now)
    return s
}
```

**Benchmark target:** Sum is amortised O(1) on most calls.

---

## Exercise 15: Use Faster CAS on ARM

**Baseline:** Standard atomic.CompareAndSwap.

**Optimise:** Ensure Go is targeting ARMv8.1+ for native CAS instructions (CASAL).

Set `GOARM64=v8.1` or compile with `-ldflags "-X main.armVer=8.1"`.

**Benchmark target:** Reduced CAS overhead on modern ARM.

---

## Exercise 16: Combine Atomic Reads

**Baseline:**

```go
a := atomicA.Load()
b := atomicB.Load()
// use a and b
```

Two atomic loads.

**Optimise:** Pack into one atomic if possible.

```go
var combined atomic.Uint64 // high 32 bits = a, low 32 bits = b

v := combined.Load()
a := uint32(v >> 32)
b := uint32(v)
```

**Benchmark target:** One atomic load instead of two; consistent snapshot.

**Trade-off:** Type packing complicates code.

---

## Exercise 17: Reduce GC Pressure from atomic.Pointer

**Baseline:** COW pattern allocates a new map on every write.

**Optimise:** Use mutable map with mutex if writes are frequent.

Or: amortise allocations with a "dirty" buffer:

```go
type Cache struct {
    m         atomic.Pointer[map[string]string]
    pending   sync.Mutex
    dirty     map[string]string
}

func (c *Cache) Set(k, v string) {
    c.pending.Lock()
    c.dirty[k] = v
    c.pending.Unlock()
    // periodic flush merges dirty into m
}
```

**Benchmark target:** Reduced allocations.

---

## Exercise 18: Use sync.Pool for Temporary Atomics

**Baseline:** Temporary atomic objects allocated per request.

**Optimise:** Pool them.

```go
var statsPool = sync.Pool{New: func() any { return &Stats{} }}

func handle() {
    s := statsPool.Get().(*Stats)
    defer statsPool.Put(s)
    // use s
}
```

**Benchmark target:** Reduced allocations.

---

## Exercise 19: Compile-Time vs Runtime Atomics

**Baseline:** Atomic on a known-immutable value:

```go
var once atomic.Bool
func init() { once.Store(true) }
func check() bool { return once.Load() }
```

The atomic is unnecessary because the value never changes after init.

**Optimise:** Plain variable, set once at init:

```go
var initialized = true // race-free because init runs before any other goroutine
```

**Benchmark target:** Eliminate the atomic load.

---

## Exercise 20: Profile-Driven Optimisation

**Process:**

1. Run with pprof:
   ```bash
   go test -cpuprofile cpu.prof -bench=.
   go tool pprof -top cpu.prof
   ```

2. Identify atomic-heavy paths.

3. Apply mitigations from exercises 1-19.

4. Re-profile to confirm.

5. Measure throughput improvement.

**Acceptance:** Documented before/after numbers.

---

## General Optimization Principles

1. **Measure first.** Don't optimise blind.
2. **Profile hot paths.** Focus where time is spent.
3. **Sharding scales.** Padding prevents false sharing.
4. **Atomics are cheap when uncontended.** They scale poorly under contention.
5. **Channels are slower per-op than atomics.** But richer semantics.
6. **Less synchronisation is better synchronisation.** Avoid sharing if possible.
7. **Trade staleness for performance.** Cached sums, batched updates.
8. **Architecture matters.** x86 ≠ ARM ≠ RISC-V. Test on target.
9. **Watch GC pressure.** Atomic.Pointer COW allocates.
10. **Stay correct.** Optimisations must preserve race-freedom.

---

## Closing

These exercises build the practical optimisation skills of a senior Go engineer.

For each:
- Implement both baseline and optimised versions.
- Benchmark with `go test -bench`.
- Profile with pprof if needed.
- Document the improvement.

Mastering optimisation is the difference between "works" and "scales."

End.
