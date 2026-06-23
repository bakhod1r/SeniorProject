---
layout: default
title: Mutex vs Atomic — Optimize
parent: Mutex vs Atomic
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/02-mutex-vs-atomic/optimize/
---

# Mutex vs Atomic — Optimize

[← Back](../)

How to decide whether to replace a mutex with an atomic, how to measure the difference, and how to deal with the surprises (cache lines, false sharing, contention shape) that come with going lock-free.

---

## When to switch — the checklist

Apply in order. Stop at the first NO.

1. **Does the invariant fit in one machine word?** A word is 4 or 8 bytes — `int32`, `int64`, `bool`, one pointer. If it spans multiple fields, keep the mutex. (A `(int64, int64)` pair does NOT count; that is two words.)
2. **Is the operation a single read-modify-write?** Increment, compare-and-set, store, swap. If you need "read field A, compute, write field A and field B together," keep the mutex.
3. **Is this a hot path?** Profile first. If `pprof` does not show the mutex in the top 10, replacing it with an atomic is premature optimisation. The atomic still has costs (mental, debugging, false-sharing), and they outweigh nanoseconds you do not save.
4. **Is contention high?** If the mutex is uncontended, the difference is roughly 1 CAS vs 2 CAS plus bookkeeping — about 2x. Worth it for high-traffic counters; not for a sleepy mutex. Use `pprof.Lookup("mutex")` to find contention.
5. **Will you remember the rules?** Future readers must understand the atomic-or-protected rule, alignment, ABA, and false sharing. If the team is junior, a mutex is more legible.

Pass all five? Switch.

---

## Measuring the gain

Always benchmark in the same shape as production. Two metrics matter: latency under no contention, and throughput under contention.

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
```

Run with `-cpu=1,2,4,8,16` to see the shape of contention:

```
go test -bench=. -cpu=1,2,4,8,16 -benchtime=2s
```

Typical numbers on an 8-core amd64 box:

```
BenchmarkCounterMutex-1     50000000   30 ns/op
BenchmarkCounterMutex-8     30000000   45 ns/op    (mild contention)
BenchmarkCounterMutex-16    10000000  180 ns/op    (heavy contention, futex)
BenchmarkCounterAtomic-1   200000000    7 ns/op
BenchmarkCounterAtomic-8   200000000    8 ns/op
BenchmarkCounterAtomic-16  150000000   12 ns/op    (cache-line bouncing)
```

The atomic wins at every level, but the gap widens dramatically under contention.

---

## False sharing — the gotcha that erases your gain

Two atomics on the same 64-byte cache line will ping-pong between cores. The atomic operation itself is cheap, but the cache-line invalidation is not.

### Reproducing the problem

```go
type Counters struct {
    A atomic.Int64
    B atomic.Int64
    C atomic.Int64
    D atomic.Int64
}

func BenchmarkFalseSharing(b *testing.B) {
    var c Counters
    var wg sync.WaitGroup
    wg.Add(4)
    for i, p := range []*atomic.Int64{&c.A, &c.B, &c.C, &c.D} {
        _ = i
        go func(p *atomic.Int64) {
            defer wg.Done()
            for i := 0; i < b.N; i++ {
                p.Add(1)
            }
        }(p)
    }
    wg.Wait()
}
```

### Fixing it with padding

```go
type padded struct {
    v atomic.Int64
    _ [56]byte
}

type Counters struct {
    A padded
    B padded
    C padded
    D padded
}
```

Each `padded` is 64 bytes — `atomic.Int64` is 8, padding is 56. Each counter lives on its own cache line.

### Measured impact

On 4 goroutines each incrementing one of four counters:

```
without padding: 80 ns/op (per increment, averaged)
with padding:   8 ns/op
```

A 10x speedup from a free change. The Go runtime itself uses `pad` in many places (see `runtime/runtime2.go`'s `mcache`, `mcentral`, `pollDesc`).

### When NOT to pad

- Read-mostly atomics: if the counter is rarely written, false sharing is rare. Padding wastes memory.
- Small numbers of atomics: padding 4 counters costs 256 bytes. Padding 100,000 counters costs 6.4MB. Decide per-instance.
- When the atomics ARE meant to be read together (e.g., a snapshot pair) — putting them adjacent helps the prefetcher.

---

## Sharding — the next step up

When even a single contended atomic is the bottleneck, shard.

```go
type ShardedCounter struct {
    shards [16]padded
}

func (c *ShardedCounter) Inc() {
    // Choose a shard based on goroutine id (approximated).
    // The runtime exposes no goroutine id; use a per-P approach.
    s := &c.shards[fastrand()&15]
    s.v.Add(1)
}

func (c *ShardedCounter) Sum() int64 {
    var total int64
    for i := range c.shards {
        total += c.shards[i].v.Load()
    }
    return total
}
```

Tradeoff: `Inc` is now lock-free and scales linearly with cores. `Sum` costs O(shards). Use when you write much more often than you read — Prometheus client_golang uses this pattern in `Counter`.

`fastrand` is in `runtime` and not exported. In production code, use `runtime_procPin` via `//go:linkname` or use a per-P cache. For benchmarks, `math/rand/v2.Uint32` is good enough.

---

## Profiling for atomic candidates

### Find the hot mutex

```bash
go test -bench=. -mutexprofile=mu.prof
go tool pprof -top mu.prof
```

If `(*Mutex).Lock` is in the top 5, you have a candidate. Look at the call sites: is the critical section a single increment? Replace with atomic.

### Find false sharing

False sharing does not show up in `pprof` directly — the atomic itself is fast. You see it as elevated CPU on the instruction, with linear-rather-than-flat throughput as cores increase. Symptoms:

```
GOMAXPROCS=1  100M ops/sec
GOMAXPROCS=2   80M ops/sec  (negative scaling!)
GOMAXPROCS=4   40M ops/sec
GOMAXPROCS=8   15M ops/sec
```

If throughput goes DOWN as cores go UP, suspect false sharing. Pad and re-measure.

### Find ABA risk

Not detectable by tools. Read the code. If you have a CAS loop on a pointer that points to something with state (not a counter), and the pointer can be re-used (manual pooling), you may have ABA. The fix is structural: do not pool.

---

## Anti-patterns to retire

### "I made it atomic so I removed the mutex" — but kept slices

```go
type Cache struct {
    count atomic.Int64
    items []Item // <-- still needs synchronisation
}
```

The atomic only protects `count`. `items` is unprotected. The race detector will flag any append on `items` from multiple goroutines.

### "I made it atomic so I removed the mutex" — but read both fields

```go
func (c *Cache) Snapshot() (int64, []Item) {
    return c.count.Load(), c.items // <-- still races on items
}
```

Same problem.

### "I padded so cache lines do not bounce" — but used `int64`, not `atomic.Int64`

```go
type padded struct {
    v int64 // <-- plain field, unsynchronised access from goroutines
    _ [56]byte
}
```

Padding does not help if you do not use atomic operations. The compiler may reorder, hoist, or merge accesses.

### Atomic spinlocks

```go
var spinlock atomic.Int32

func lock() {
    for !spinlock.CompareAndSwap(0, 1) {
        // busy-wait
    }
}
```

Almost always wrong in Go. The runtime cannot park the spinning goroutine; it consumes a full CPU. Use `sync.Mutex` (which spins for a few iterations and then parks via futex).

---

## A worked example — Prometheus-style counter

Prometheus's `client_golang.Counter` is the canonical "atomic in production" pattern. Its hot path uses `atomic.AddUint64` on a single counter field, with no mutex. Reads (during `/metrics` scrape) use `atomic.LoadUint64`.

But the counter is more interesting: it actually stores a float as a `uint64` via `math.Float64bits`, using `CompareAndSwap` in a loop:

```go
func (c *Counter) Add(v float64) {
    if v == 0 {
        return
    }
    if v < 0 {
        panic("counter cannot decrease")
    }
    ival := uint64(v)
    if float64(ival) == v {
        atomic.AddUint64(&c.valInt, ival) // fast integer path
        return
    }
    for {
        oldBits := atomic.LoadUint64(&c.valBits)
        newBits := math.Float64bits(math.Float64frombits(oldBits) + v)
        if atomic.CompareAndSwapUint64(&c.valBits, oldBits, newBits) {
            return
        }
    }
}
```

The lesson: when `Add` cannot express the operation (because float arithmetic is not addition of bit patterns), the CAS loop is the right pattern. And note the two-field split: `valInt` for integer adds, `valBits` for float — a deliberate optimisation because `LOCK XADD` is one instruction whereas the float CAS-loop is several.

---

## Choosing the right shard count

For sharded counters, the question is "how many shards?" Three factors:

1. **Number of cores.** Each shard ideally lives on its own cache line and has its own writer. `runtime.GOMAXPROCS(0)` is a natural choice.
2. **Number of writers.** If 16 goroutines write but you only have 8 cores, more shards than cores helps reduce per-shard contention.
3. **Memory cost.** Each padded shard is 64 bytes. 1000 sharded counters × 16 shards × 64 bytes = 1MB per counter group. Negligible. 1M sharded counters × 16 shards × 64 bytes = 1GB. Not negligible.

Common defaults:

```go
const numShards = 16 // power of 2 for fast modulo
// or:
numShards := runtime.GOMAXPROCS(0)
```

Power of 2 lets you use `idx & (numShards-1)` instead of `idx % numShards`, saving a few cycles in the hot path.

---

## The atomic-vs-mutex micro-benchmark

A complete benchmark suite for production decisions:

```go
package counter_bench

import (
    "sync"
    "sync/atomic"
    "testing"
)

const incrementsPerGoroutine = 1_000_000

func BenchmarkMutex(b *testing.B) {
    var mu sync.Mutex
    var n int64
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.Lock()
            n++
            mu.Unlock()
        }
    })
}

func BenchmarkRWMutex_AllWrites(b *testing.B) {
    var mu sync.RWMutex
    var n int64
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.Lock()
            n++
            mu.Unlock()
        }
    })
}

func BenchmarkAtomic(b *testing.B) {
    var n atomic.Int64
    b.ResetTimer()
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

func BenchmarkAtomicPadded(b *testing.B) {
    var shards [16]padded
    var idx atomic.Uint32
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        i := idx.Add(1) - 1
        s := &shards[i&15]
        for pb.Next() {
            s.v.Add(1)
        }
    })
}
```

Run with:

```bash
go test -bench=. -cpu=1,2,4,8,16 -benchtime=5s -benchmem
```

Read the curves: throughput vs core count. Atomic should scale roughly linearly until contention kicks in (at high core counts). Mutex collapses at high contention. Sharded atomic continues scaling.

---

## Real-world example — gRPC stream counter

gRPC's Go implementation tracks active streams per connection. Each stream creation increments, each closure decrements. At 10000 streams/sec on a busy server, this is hot.

Old code (paraphrased):

```go
type Server struct {
    mu              sync.Mutex
    activeStreams   int64
}

func (s *Server) registerStream() {
    s.mu.Lock()
    s.activeStreams++
    s.mu.Unlock()
}
```

New code:

```go
type Server struct {
    activeStreams atomic.Int64
}

func (s *Server) registerStream() {
    s.activeStreams.Add(1)
}
```

Mutex contention dropped to zero on this path. The change was a 5-line PR with zero behavioural change. The atomic-or-protected discipline was easy to argue for a single counter.

---

## The wider engineering principle

Atomics are an optimisation. They are not free. Every atomic still costs ~20-30 cycles (one `LOCK`-prefixed instruction on amd64). The reason they are faster than a mutex is not that the operation itself is cheap, but that:

- Uncontended mutex = 2 atomics (Lock + Unlock).
- Contended mutex = atomic + futex syscall + park/unpark + atomic.
- Atomic operation = 1 atomic.

So mutex < atomic only when contention is high enough to push the mutex into the kernel path. Below that, the gap is 2x. Above that, the gap can be 100x.

The corollary: if your mutex is rarely contended, replacing it with an atomic gains ~25 ns per operation. At 1M ops/sec that is 25ms/sec of saved CPU — meaningful on a busy core, irrelevant on a sleepy one.

Premature lock-free is the root of more bugs than premature optimisation in general. Measure before, after, and a year later.

---

## Closing rule of thumb

- **Counter, flag, single pointer?** Atomic.
- **Two or more fields, or compound operation?** Mutex.
- **Hot enough to care?** Profile, replace, profile again.
- **Cache-line bouncing?** Pad.
- **Still too slow?** Shard.

Premature lock-free is the root of more bugs than premature optimisation in general. Measure before, after, and a year later.
