# Starvation — Optimisation

## Table of Contents
1. [Goal of This File](#goal-of-this-file)
2. [Optimisation 1: Shorten the RWMutex Critical Section](#optimisation-1-shorten-the-rwmutex-critical-section)
3. [Optimisation 2: Replace RWMutex with atomic.Pointer](#optimisation-2-replace-rwmutex-with-atomicpointer)
4. [Optimisation 3: Shard the Lock](#optimisation-3-shard-the-lock)
5. [Optimisation 4: Bounded Queues with Adaptive Capacity](#optimisation-4-bounded-queues-with-adaptive-capacity)
6. [Optimisation 5: Aging Priority Queue with Heap](#optimisation-5-aging-priority-queue-with-heap)
7. [Optimisation 6: Per-CPU Local Counters](#optimisation-6-per-cpu-local-counters)
8. [Optimisation 7: Hot Path / Cold Path Split](#optimisation-7-hot-path--cold-path-split)
9. [Measurement and Validation](#measurement-and-validation)
10. [Summary](#summary)

---

## Goal of This File

You have identified starvation in a Go service. You have shortened the critical sections, added back-pressure, and the system is stable. Now you want to make it *faster* while preserving fairness. This file is about the second-order improvements: how to reduce p99 latency further once the obvious bugs are gone.

Each section presents a before/after with measurement guidance. Every optimisation has a trade-off; we name it explicitly.

---

## Optimisation 1: Shorten the RWMutex Critical Section

### Before

```go
type Cache struct {
    mu sync.RWMutex
    data map[string]*Entry
}

func (c *Cache) Lookup(k string) *Result {
    c.mu.RLock()
    defer c.mu.RUnlock()
    entry, ok := c.data[k]
    if !ok {
        return nil
    }
    return entry.Compute() // expensive
}
```

### Problem

`Compute()` is slow (e.g., 1 ms). It runs under the read lock. Writers wait for every active `Compute()` to finish.

### After

```go
func (c *Cache) Lookup(k string) *Result {
    c.mu.RLock()
    entry, ok := c.data[k]
    c.mu.RUnlock()
    if !ok {
        return nil
    }
    return entry.Compute()
}
```

### Trade-off

The entry pointer could be invalidated between unlock and use. Two options:

- If `Entry.Compute()` is safe on a snapshot (entry is immutable after publication), this is fine. Set the field via atomic pointer swap on update.
- If not, hold a per-entry lock or refcount inside `Entry`.

### Measurement

- Before: writer p99 = read critical section duration × (number of readers / cores). With 100 readers and 1 ms reads, ~100 ms p99.
- After: writer p99 = map lookup time ≈ microseconds.

---

## Optimisation 2: Replace RWMutex with atomic.Pointer

### Before

```go
type Config struct {
    mu sync.RWMutex
    v  *ConfigData
}

func (c *Config) Get() *ConfigData {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.v
}

func (c *Config) Set(v *ConfigData) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.v = v
}
```

### Problem

`Get` is called millions of times per second; it pays for two atomic operations on every call (RLock/RUnlock increments and decrements of `readerCount`). For a pointer load, this is overkill.

### After

```go
import "sync/atomic"

type Config struct {
    v atomic.Pointer[ConfigData]
}

func (c *Config) Get() *ConfigData {
    return c.v.Load()
}

func (c *Config) Set(v *ConfigData) {
    c.v.Store(v)
}
```

### Trade-off

- Requires `ConfigData` to be effectively immutable after publication. Mutating the struct after `Store` is a data race.
- No way to atomically update multiple fields. Bundle related state in a struct and store a new pointer.

### Measurement

`Get` goes from ~20 ns to ~2 ns. At millions of QPS this is a measurable CPU saving and removes the source of `RWMutex` contention entirely.

---

## Optimisation 3: Shard the Lock

### Before

```go
type Counter struct {
    mu    sync.Mutex
    count int64
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.count++
    c.mu.Unlock()
}

func (c *Counter) Get() int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.count
}
```

### Problem

Under high concurrency, the single lock is contended. The lock itself becomes a starvation source for waiters.

### After

```go
const shards = 64

type Counter struct {
    counts [shards]struct {
        mu    sync.Mutex
        value int64
        _     [40]byte // pad to cache line
    }
}

func (c *Counter) Inc() {
    s := &c.counts[shardIndex()]
    s.mu.Lock()
    s.value++
    s.mu.Unlock()
}

func (c *Counter) Get() int64 {
    var sum int64
    for i := range c.counts {
        c.counts[i].mu.Lock()
        sum += c.counts[i].value
        c.counts[i].mu.Unlock()
    }
    return sum
}

func shardIndex() int {
    // some fast per-goroutine or per-CPU dispersal
    return int(uintptr(unsafe.Pointer(new(int)))) % shards
}
```

### Trade-off

- `Get` is now O(shards). Still fast, but not O(1).
- Reading is no longer point-in-time consistent across shards (different shards observed at different moments).
- More memory: each shard has its own cache line.

For pure counters, prefer `atomic.Int64` or `atomic.AddInt64`. Sharding is more interesting for *complex* state where atomics do not apply.

### Measurement

For high-contention counters, sharded versions achieve nearly linear scaling with cores. The unsharded version saturates at 30-50 M ops/sec depending on hardware; the sharded version scales to hundreds of millions.

---

## Optimisation 4: Bounded Queues with Adaptive Capacity

### Before

```go
jobs := make(chan Job, 100)
```

### Problem

Fixed capacity. If the workload is bursty, you either:

- Set capacity high enough for the burst (wasting memory and latency in normal load).
- Set it low (rejecting work during bursts).

### After

Implement a queue with adaptive capacity. Start at low capacity; grow when fullness exceeds 80% sustained; shrink when below 20% sustained.

```go
type AdaptiveQueue struct {
    mu       sync.Mutex
    items    []Job
    cap      int
    minCap   int
    maxCap   int
    fullness atomic.Int64 // EWMA in percent
}

// Resize logic runs periodically in a background goroutine.
```

Full implementation is involved; pattern is:

- Track utilisation as an exponentially weighted moving average.
- Resize at most once per N seconds.
- Use `sync.Cond` to signal `Pop` after resize.

### Trade-off

- Complexity. Adaptive systems are harder to reason about.
- Hysteresis tuning. Grow/shrink thresholds need testing.
- Per-resize allocation. Each grow copies items to a new slice.

For most services, fixed capacity tuned to peak observed load + headroom is simpler and good enough.

### Measurement

Compare p99 latency under bursty load (10x base rate for 1 second every 10 seconds). Adaptive should keep latency stable; fixed-small drops work; fixed-large keeps stale items longer.

---

## Optimisation 5: Aging Priority Queue with Heap

### Before

```go
// O(N) scan-and-extract aging queue from tasks.md Task 4.
```

### Problem

For large queues (>1000 items), the O(N) scan per pop dominates.

### After

Use a min-heap keyed by `effective(it)`. Periodically rebuild the heap because aging shifts the keys.

```go
import "container/heap"

type AgingQueue struct {
    mu        sync.Mutex
    h         heap
    nonEmpty  *sync.Cond
    lastBuilt time.Time
}

// h is a heap.Interface implementation with effective(it) as key.

func (q *AgingQueue) Push(it *Item) {
    q.mu.Lock()
    heap.Push(&q.h, it)
    q.mu.Unlock()
    q.nonEmpty.Signal()
}

func (q *AgingQueue) Pop() *Item {
    q.mu.Lock()
    defer q.mu.Unlock()
    for q.h.Len() == 0 {
        q.nonEmpty.Wait()
    }
    if time.Since(q.lastBuilt) > 100*time.Millisecond {
        heap.Init(&q.h)
        q.lastBuilt = time.Now()
    }
    return heap.Pop(&q.h).(*Item)
}
```

### Trade-off

- Heap operations are O(log N) but heap keys change over time as items age. Periodic rebuilds keep order approximately correct.
- The rebuild is O(N). Frequency tuned to balance correctness vs. cost.
- Strict aging guarantees are weaker; items can be pop'd slightly out of "true" effective-priority order between rebuilds.

For most workloads, 100 ms rebuild interval is invisible.

---

## Optimisation 6: Per-CPU Local Counters

### Before

```go
var counter atomic.Int64

func inc() {
    counter.Add(1)
}
```

### Problem

Atomic operations on a single cache line. Under high contention from many cores, the cache line bounces between cores. Each `Add` takes 50-200 ns instead of the 2-5 ns it would take if uncontended.

### After

Per-P counters with periodic aggregation. Go does not expose a stable "current P", but `runtime.NumCPU()` plus an XOR-shifted index is a reasonable approximation:

```go
import "runtime"

var counters []atomic.Int64

func init() {
    counters = make([]atomic.Int64, runtime.NumCPU())
}

func inc() {
    idx := dispersedIdx() // any cheap dispersal
    counters[idx&(len(counters)-1)].Add(1)
}

func total() int64 {
    var sum int64
    for i := range counters {
        sum += counters[i].Load()
    }
    return sum
}
```

Pad each `atomic.Int64` to a cache line to avoid false sharing:

```go
type paddedCounter struct {
    v atomic.Int64
    _ [56]byte
}
```

### Trade-off

- `total` is O(N).
- Sums are eventually-consistent across counters.
- Extra memory: one cache line per CPU.

For pure increment counters this scales to billions of operations per second on commodity hardware.

---

## Optimisation 7: Hot Path / Cold Path Split

### Before

```go
func (s *Service) Handle(r Request) Response {
    s.mu.Lock()
    defer s.mu.Unlock()
    if r.Type == Common {
        return s.handleCommon(r)
    }
    return s.handleRare(r) // slow
}
```

### Problem

The rare path is slow but the lock is shared with the common path. Common requests wait behind rare ones.

### After

Split the lock; let common requests use a fast lock and rare requests use a different lock.

```go
type Service struct {
    commonMu sync.Mutex
    common   CommonState
    rareMu   sync.Mutex
    rare     RareState
}

func (s *Service) Handle(r Request) Response {
    if r.Type == Common {
        s.commonMu.Lock()
        defer s.commonMu.Unlock()
        return s.handleCommon(r)
    }
    s.rareMu.Lock()
    defer s.rareMu.Unlock()
    return s.handleRare(r)
}
```

If the rare path needs to read common state, snapshot it under the common lock first:

```go
func (s *Service) handleRare(r Request) Response {
    s.commonMu.Lock()
    snapshot := s.common.Snapshot()
    s.commonMu.Unlock()
    // Now do slow work without holding commonMu.
    ...
}
```

### Trade-off

- More locks = more bookkeeping.
- Cross-lock invariants become harder. If `common` and `rare` must be updated atomically together, you need a coordination lock anyway.

The pattern works best when common and rare are *independent* enough that the only interaction is reads.

### Measurement

Common-path p99 should drop dramatically. Rare-path p99 stays the same.

---

## Measurement and Validation

Every optimisation needs three numbers:

1. **p50 / p99 / p99.9 latency** of the affected operation, before and after.
2. **Throughput** (ops/sec), before and after.
3. **CPU and memory** profile, before and after, to confirm the optimisation paid off in the budget you expected.

Use `go test -bench` with `-benchtime=10s` to get stable measurements. For percentiles, use the harness from `tasks.md` Task 10.

Run with `GOMAXPROCS=runtime.NumCPU()` and a realistic concurrency level. Single-threaded benchmarks rarely show contention effects.

Validate fairness explicitly: under high load, no single goroutine should have starved. Plot per-goroutine completion counts; verify they are within a factor of 2-3.

---

## Summary

Once obvious starvation bugs are fixed (long critical sections, biased selects, unbounded queues, single-tenant queues), the remaining optimisations are:

1. Shrink critical sections by snapshotting.
2. Replace `RWMutex` with `atomic.Pointer` where data is immutable.
3. Shard locks to reduce contention.
4. Use adaptive queue sizing for bursty workloads.
5. Upgrade aging queues to heaps for large queue sizes.
6. Use per-P counters to eliminate atomic contention.
7. Split hot-path and cold-path locks.

Each is a trade-off. Measure before and after. Keep the fairness guarantee — a faster system that starves some workload is a regression, not an improvement.

Continue to [tasks.md](tasks.md) for hands-on exercises or [find-bug.md](find-bug.md) for diagnosis practice.
