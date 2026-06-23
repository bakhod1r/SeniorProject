---
layout: default
title: Mutex vs Atomic — Tasks
parent: Mutex vs Atomic
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/02-mutex-vs-atomic/tasks/
---

# Mutex vs Atomic — Tasks

[← Back](../)

Six exercises. Solve each on your own first; the reference solution is at the end. All code must pass `go test -race`.

---

## Task 1 — Lock-Free Counter

Write a counter that supports `Inc`, `Dec`, `Get`, and `Set`, callable from any number of goroutines concurrently, using only `sync/atomic` (no `sync.Mutex`).

```go
type Counter struct {
    // your fields
}

func (c *Counter) Inc()
func (c *Counter) Dec()
func (c *Counter) Get() int64
func (c *Counter) Set(v int64)
```

Acceptance:
- `go test -race` passes when 100 goroutines each call `Inc` 10000 times and the final value is 1000000.
- `Set` and `Get` are race-free.
- Zero allocations per operation.

---

## Task 2 — Lock-Free Flag

Write a one-shot boolean: `Set` may be called many times; only the first caller returns `true` (the "winner"). Subsequent calls return `false`. `IsSet` returns the current state.

```go
type Once struct {
    // your fields
}

func (o *Once) Set() (won bool)
func (o *Once) IsSet() bool
```

Acceptance:
- Spawn 1000 goroutines all calling `Set()` simultaneously. Exactly one returns true.
- No mutex. Use a single `atomic.Bool` or `atomic.Int32`.

---

## Task 3 — Treiber Stack (CAS-based)

Implement a lock-free LIFO stack using a CAS loop on the head pointer.

```go
type node[T any] struct {
    val  T
    next *node[T]
}

type Stack[T any] struct {
    head atomic.Pointer[node[T]]
}

func (s *Stack[T]) Push(v T)
func (s *Stack[T]) Pop() (T, bool)
```

Acceptance:
- 8 goroutines each push 10000 values; another 8 pop concurrently. After all done, total popped == total pushed. No values lost.
- `go test -race` clean.

Note: this implementation has the classic ABA risk in C/C++ because of memory reclamation. In Go, the garbage collector keeps popped nodes alive until no goroutine holds a reference, so ABA cannot occur (the same `*node` cannot be re-used by a concurrent push while another goroutine still holds it). Document this in a comment.

---

## Task 4 — Atomic vs Mutex Counter Benchmark

Write a benchmark comparing three implementations of an increment-heavy counter:

1. `sync.Mutex` around an `int64`.
2. `atomic.Int64.Add`.
3. Sharded counter: 8 padded atomic counters, each goroutine writes to `counters[goid % 8]`.

```go
func BenchmarkCounterMutex(b *testing.B)
func BenchmarkCounterAtomic(b *testing.B)
func BenchmarkCounterSharded(b *testing.B)
```

Use `b.RunParallel`. Report results on your machine. The expected ordering on a modern multi-core box: sharded > atomic > mutex, with sharded being 5-10x atomic under heavy contention.

---

## Task 5 — RCU-Style Config Reload

Implement a configuration container where:
- Many goroutines read the config very frequently (every request).
- One goroutine reloads it occasionally (every minute, on SIGHUP).
- Readers must never block.
- Readers always see a fully consistent config (no half-updated state).

```go
type Config struct {
    Endpoints []string
    Timeout   time.Duration
    MaxRetry  int
}

type ConfigStore struct {
    // your fields
}

func (cs *ConfigStore) Get() *Config           // hot path
func (cs *ConfigStore) Reload(c *Config)       // cold path
```

Acceptance:
- `Get` does no locking, no allocation.
- `Reload` is safe to call concurrently with itself and with `Get`.
- The returned `*Config` must be treated as immutable by callers (document this).

---

## Task 6 — Bounded Atomic Counter

Write a counter capped at a maximum: `Inc` returns true if the counter was incremented, false if already at the cap. No mutex.

```go
type Bounded struct {
    max int64
    v   atomic.Int64
}

func NewBounded(max int64) *Bounded
func (b *Bounded) Inc() bool
func (b *Bounded) Get() int64
```

Hint: you need a CAS loop. Plain `Add` cannot enforce the cap (it always increments).

Acceptance:
- 100 goroutines, each calling `Inc()` 10000 times, on a `Bounded` with cap 50000. Total true returns == 50000.
- `go test -race` clean.

---

## Reference Solutions

### Task 1

```go
type Counter struct {
    v atomic.Int64
}

func (c *Counter) Inc()         { c.v.Add(1) }
func (c *Counter) Dec()         { c.v.Add(-1) }
func (c *Counter) Get() int64   { return c.v.Load() }
func (c *Counter) Set(v int64)  { c.v.Store(v) }
```

### Task 2

```go
type Once struct {
    done atomic.Bool
}

func (o *Once) Set() bool   { return o.done.CompareAndSwap(false, true) }
func (o *Once) IsSet() bool { return o.done.Load() }
```

`CompareAndSwap(false, true)` returns true only for the goroutine that flipped the bit — the rest see it is already true and CAS fails.

### Task 3

```go
type node[T any] struct {
    val  T
    next *node[T]
}

type Stack[T any] struct {
    head atomic.Pointer[node[T]]
}

func (s *Stack[T]) Push(v T) {
    n := &node[T]{val: v}
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}

func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    for {
        old := s.head.Load()
        if old == nil {
            return zero, false
        }
        // ABA-safe in Go: GC keeps `old` alive until no goroutine references it,
        // so the same *node[T] address cannot be observed in two distinct
        // states by the same goroutine.
        if s.head.CompareAndSwap(old, old.next) {
            return old.val, true
        }
    }
}
```

### Task 4

```go
func BenchmarkCounterMutex(b *testing.B) {
    var mu sync.Mutex
    var n int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.Lock()
            n++
            mu.Unlock()
        }
    })
}

func BenchmarkCounterAtomic(b *testing.B) {
    var n atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            n.Add(1)
        }
    })
}

type padded struct {
    v atomic.Int64
    _ [56]byte
}

func BenchmarkCounterSharded(b *testing.B) {
    shards := make([]padded, 8)
    var idx atomic.Uint32
    b.RunParallel(func(pb *testing.PB) {
        i := idx.Add(1) - 1
        s := &shards[i&7]
        for pb.Next() {
            s.v.Add(1)
        }
    })
}
```

Typical results on an 8-core x86_64 box at GOMAXPROCS=8:

```
BenchmarkCounterMutex-8     30000000   45 ns/op
BenchmarkCounterAtomic-8   200000000    8 ns/op
BenchmarkCounterSharded-8 1000000000    1.5 ns/op
```

### Task 5

```go
type ConfigStore struct {
    p atomic.Pointer[Config]
}

func NewConfigStore(initial *Config) *ConfigStore {
    cs := &ConfigStore{}
    cs.p.Store(initial)
    return cs
}

func (cs *ConfigStore) Get() *Config       { return cs.p.Load() }
func (cs *ConfigStore) Reload(c *Config)   { cs.p.Store(c) }
```

The discipline: every `*Config` ever stored must be treated as immutable. Mutating a field after `Store` would race with readers who have already loaded the pointer.

### Task 6

```go
func (b *Bounded) Inc() bool {
    for {
        cur := b.v.Load()
        if cur >= b.max {
            return false
        }
        if b.v.CompareAndSwap(cur, cur+1) {
            return true
        }
        // Lost the CAS race; another goroutine got there first.
        // Loop and re-check the cap.
    }
}
```

If you naively used `b.v.Add(1)` and then checked `if b.v.Load() > b.max { b.v.Add(-1) }`, you would briefly exceed the cap, and worse, two threads racing past the cap could each see "we are over, decrement" and both decrement, going under.

---

## Task 7 — Lock-Free Free List

Implement a free list (a stack of reusable buffers) that producers push spare buffers onto and consumers pop from. Use a Treiber stack on top of `atomic.Pointer`.

```go
type Buffer struct {
    Data []byte
    next *Buffer
}

type FreeList struct {
    head atomic.Pointer[Buffer]
}

func (f *FreeList) Get() *Buffer    // pop one, or nil if empty
func (f *FreeList) Put(b *Buffer)    // push one back
```

Acceptance:
- 16 goroutines do 100000 (Get, do work, Put) cycles. No buffer is lost or duplicated.
- `go test -race` clean.
- Document why ABA is not a problem in Go.

Reference solution:

```go
func (f *FreeList) Put(b *Buffer) {
    for {
        old := f.head.Load()
        b.next = old
        if f.head.CompareAndSwap(old, b) {
            return
        }
    }
}

func (f *FreeList) Get() *Buffer {
    for {
        old := f.head.Load()
        if old == nil {
            return nil
        }
        next := old.next
        if f.head.CompareAndSwap(old, next) {
            old.next = nil // help GC
            return old
        }
    }
}
```

ABA safety: in Go, a `*Buffer` cannot be re-used while another goroutine still references it (the GC keeps it alive). So `old` and `old.next` are stable for the duration of the CAS, and the same `*Buffer` cannot appear in two distinct positions in the stack history visible to the same goroutine.

---

## Task 8 — Atomic Min Tracker

Track the minimum value ever observed across many goroutines. Lock-free.

```go
type MinTracker struct {
    min atomic.Int64
}

func NewMinTracker() *MinTracker  // initial min: math.MaxInt64
func (m *MinTracker) Observe(v int64)
func (m *MinTracker) Min() int64
```

Acceptance:
- 100 goroutines, each observing 10000 random int64 values. Final `Min()` equals the smallest value across all goroutines.

Reference solution:

```go
func NewMinTracker() *MinTracker {
    m := &MinTracker{}
    m.min.Store(math.MaxInt64)
    return m
}

func (m *MinTracker) Observe(v int64) {
    for {
        old := m.min.Load()
        if v >= old {
            return // v is not smaller; no update needed
        }
        if m.min.CompareAndSwap(old, v) {
            return
        }
        // Lost the CAS; loop and re-check (the new value might be smaller still).
    }
}

func (m *MinTracker) Min() int64 {
    return m.min.Load()
}
```

This is the canonical "non-Add" atomic operation: `min` is not expressible as `Add`, so we CAS-loop.

---

## Task 9 — Atomic vs RWMutex Read-Heavy Workload

Benchmark three implementations of a read-mostly config:

1. `sync.RWMutex` around `*Config`.
2. `sync.Mutex` around `*Config`.
3. `atomic.Pointer[Config]`.

```go
func BenchmarkConfig{RWMutex,Mutex,Atomic}_Read(b *testing.B)
```

Use `b.RunParallel`. Compare at `GOMAXPROCS=1,4,16`.

Expected results: atomic wins at every level. RWMutex beats Mutex by 1.5-3x under heavy read load. Atomic beats RWMutex by 5-50x under heavy read load.

Reference solution sketch:

```go
func BenchmarkConfigAtomic_Read(b *testing.B) {
    var p atomic.Pointer[Config]
    p.Store(&Config{...})
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = p.Load().Timeout
        }
    })
}

func BenchmarkConfigRWMutex_Read(b *testing.B) {
    var mu sync.RWMutex
    cfg := &Config{...}
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.RLock()
            _ = cfg.Timeout
            mu.RUnlock()
        }
    })
}
```

Report the numbers on your hardware. Add a few percentages of writes (1%, 5%, 25%) and see how the gap changes. Atomic dominates because it does no atomic operations on reads beyond the load itself.

---

## Task 10 — Find the Cache-Line Hot Spot

You are given:

```go
type Metrics struct {
    Requests  atomic.Int64
    Errors    atomic.Int64
    Bytes     atomic.Int64
    Latencies atomic.Int64
}
```

Four goroutines each increment one of the four fields in a tight loop. Measure throughput. Then add padding so each field is on its own cache line. Re-measure. Quantify the improvement.

Reference solution:

```go
type padded struct {
    v atomic.Int64
    _ [56]byte
}

type Metrics struct {
    Requests  padded
    Errors    padded
    Bytes     padded
    Latencies padded
}
```

On a 4-core amd64 machine, expect 5-10x throughput improvement from padding. Document the measurement and explain the cache-line invalidation cascade in a comment.

