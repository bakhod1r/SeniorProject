# The ABA Problem — Optimisation

## Table of Contents
1. [Introduction](#introduction)
2. [Cost Models for Each Mitigation](#cost-models-for-each-mitigation)
3. [Tagged-Wrapper Allocation Cost](#tagged-wrapper-allocation-cost)
4. [Hazard Pointer Per-Operation Cost](#hazard-pointer-per-operation-cost)
5. [EBR Reader Fast-Path Cost](#ebr-reader-fast-path-cost)
6. [Choosing Between Schemes](#choosing-between-schemes)
7. [Benchmarks on Real Hardware](#benchmarks-on-real-hardware)
8. [Cache-Line Considerations](#cache-line-considerations)
9. [Allocation-Free Variants](#allocation-free-variants)
10. [When to Stop Optimising](#when-to-stop-optimising)
11. [Production Settings](#production-settings)
12. [Summary](#summary)

---

## Introduction

ABA mitigations have non-trivial cost. The right one depends on workload (read-heavy vs write-heavy), latency requirements (p50 vs p99 vs p99.9), hardware (x86 TSO vs ARM relaxed, NUMA vs uniform), and engineering budget. This file is a practical guide to making the trade-off informed.

The headline numbers, drawn from middle.md's table and refined here:

| Mitigation | Reader cost | Writer cost | Memory cost | Throughput (typical) |
|------------|------------:|------------:|------------:|---------------------:|
| GC only | none | none | extra GC pressure | 1.5-3x mutex |
| Tagged wrapper | none | one 16B alloc | per-mod alloc | 1.2-2.5x mutex |
| Hazard pointers | one atomic store | scan overhead | bounded slab | 1.3-2x mutex |
| Epoch-based | one relaxed write | scan overhead | unbounded retire | 1.5-3x mutex |
| DWCAS via asm | none | none | none extra | 1.5-3x mutex |
| `sync.Mutex` | mutex acq/rel | mutex acq/rel | none | baseline |

Numbers are order-of-magnitude estimates for moderately contended workloads on modern x86 server hardware. Your mileage will vary. The point is the relative ordering and the cost categories, not exact values.

The advice that comes out of these numbers:

- For most Go code, the GC-only path is fine. Optimise only if you measured a problem.
- The tagged wrapper costs one allocation per modification, which Go's allocator handles efficiently. This is the default for lock-free in Go.
- Hazard pointers and EBR are for libraries and infrastructure where the GC's tail-latency contribution matters.
- DWCAS is rarely worth the engineering cost outside of specific hot paths.
- A mutex is sometimes faster than any lock-free option, especially under low contention or with short critical sections.

---

## Cost Models for Each Mitigation

### GC-only (no mitigation beyond `atomic.Pointer`)

Reader cost: one atomic load. Writer cost: one atomic CAS plus the allocation of a new node. Memory cost: the algorithm's working set plus GC overhead (write barriers, mark phase). The cost is dominated by what the GC does behind the scenes:

- Write barriers on `atomic.Pointer.Store` add ~10 ns overhead per store.
- Mark phase scans all reachable pointers; long-lived lock-free structures with many nodes increase mark time.
- Stack scans suspend goroutines briefly during scans.

For most applications, these costs are absorbed and invisible. For latency-sensitive code with tight p99 targets, they show up in tail latency.

### Tagged wrapper

Adds one allocation per modification (16 bytes for `versioned{head, gen}`). Go's allocator handles small allocations efficiently (~10 ns under low pressure). Under high pressure, the allocations contribute to GC frequency, which compounds:

- ~10 ns per modification for the alloc itself.
- ~1 ns per modification for the additional reference the GC must scan.
- Increased GC frequency as allocations accumulate.

In well-tuned services, total overhead is ~20-30 ns per modification compared to a fresh-node algorithm. For most workloads this is negligible compared to the CAS cost itself (~10-50 ns on x86, more on ARM).

### Hazard pointers

Per reader operation: one atomic store (publish), one atomic load (re-read), one atomic store (clear). Roughly 3 extra atomic ops compared to bare CAS. On x86: ~5-15 ns extra. On ARM: ~20-40 ns extra due to barrier cost.

Per writer operation: the CAS plus retirement bookkeeping. Retirement scans cost `O(P*H + R)` where P is threads, H is hazards per thread, R is retired list size. Amortised across retirements, ~50-200 ns per retire.

Memory: bounded by `O(P*H)` hazard slots plus the retired list (also bounded). For 32 threads with 2 hazards each, ~512 bytes of slot memory plus ~4 KB of retired list. Trivial.

### Epoch-based reclamation

Per reader operation: one relaxed write on enter (`local_epoch = global_epoch`), one on exit (`local_epoch = INACTIVE`). On x86: ~5 ns extra. On ARM: ~10 ns extra.

Per writer operation: retirement (append to per-thread retired list, no CAS), occasional scan. Scans cost `O(P + R)` and are typically run every Nth retirement. Amortised: ~10-50 ns per retire.

Memory: unbounded if a thread stalls. In normal operation: `O(R)` where R is retired list size at advance time. With well-behaved threads, R stays small.

### DWCAS

Per operation: a single `CMPXCHG16B` (x86) or `CASP` (ARM). Cost is roughly 2x a single-word CAS due to the wider memory access. No allocation, no scan, no retire. Ideal cost.

But: requires assembly stubs, careful alignment, architecture detection. Engineering cost is substantial.

### Mutex

Per operation: lock and unlock. Uncontended: ~20-30 ns on x86 (`xchg` + branch). Contended: futex syscall, ~1-10 us.

For very short critical sections (a single read or write), uncontended mutex is competitive with hazard pointers. For long critical sections, lock-free wins on throughput; mutex wins on simplicity.

---

## Tagged-Wrapper Allocation Cost

The dominant cost of the tagged-wrapper pattern is the wrapper allocation per modification. Let's profile it.

```go
func BenchmarkTaggedStack_Push(b *testing.B) {
    s := NewSafeStack()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        s.Push(i)
    }
}
```

Typical output on a modern x86 server:

```
BenchmarkTaggedStack_Push-8    50000000    35.2 ns/op    32 B/op    2 allocs/op
```

35 ns per push: ~10 ns for the wrapper alloc, ~10 ns for the node alloc, ~15 ns for the CAS and book-keeping. Two allocations per push: one `Node`, one `versioned`. Memory: 16 + 16 = 32 bytes per push (Node has value + pointer = 16 bytes, wrapper is 16 bytes).

Reducing the allocation cost:

### Allocate the wrapper inline

If you can avoid the wrapper allocation by using a packed 128-bit atomic via assembly, the allocation cost disappears. But DWCAS adds complexity. For most workloads, not worth it.

### Pool the wrappers

Tempting: keep a pool of `*versioned` and reuse. But this reintroduces ABA on the wrapper itself. The whole defence is that wrapper addresses are unique. Pooling breaks the defence. Do not pool the wrappers.

### Reduce wrapper size

`versioned` is 16 bytes; you cannot make it smaller without giving up either the head pointer or the generation. Could you eliminate the generation? In Go, yes (the GC handles pointer uniqueness). The wrapper becomes just `*Node`, which is what `atomic.Pointer[Node]` is. No wrapper allocation needed at all — but you also need fresh allocation per push for correctness.

The conclusion: in Go, the tagged wrapper is an engineering hedge against `sync.Pool` introduction. If you guarantee fresh allocation per push, you do not need it. If you might pool nodes later, the wrapper protects you.

---

## Hazard Pointer Per-Operation Cost

A microbenchmark of the senior.md hazard-pointer stack:

```go
func BenchmarkHazStack_Pop(b *testing.B) {
    s := newHazStack()
    for i := 0; i < b.N; i++ {
        s.Push(i)
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        s.Pop(0)
    }
}
```

Output:

```
BenchmarkHazStack_Pop-8        30000000    52.4 ns/op
```

Compare to a bare-CAS pop (~25 ns/op): hazard pointers add ~25 ns. Of that:

- ~5 ns for the hazard publish (atomic store).
- ~5 ns for the re-read (atomic load).
- ~5 ns for the hazard clear.
- ~10 ns for retirement bookkeeping (under typical scan frequency).

The reader's extra cost is dominated by the atomic ops, which on x86 are LOCK-prefixed and cost more than plain memory ops. On ARM (LDR/STR with appropriate barriers) the relative cost is higher but absolute cost is comparable.

The retirement scan is amortised across many retirements. With `2*P*H` threshold, the scan runs every `2*P*H` retirements; each scan costs `O(P*H + R)`. For 32 threads with 2 hazards (P*H = 64), the scan runs every 128 retires and costs ~200 ns. Per-retire cost: ~1.5 ns of scan amortised.

### Optimising hazard pointer cost

- **Cache-line padding** on hazard slots. Without padding, multiple threads' slots share cache lines and contend. With padding (64 bytes per slot), each slot is independent. This is what the senior.md implementation does.
- **Per-thread retired lists**. Centralised retired list contends on the mutex. Per-thread lists avoid this; the scan merges them.
- **Hierarchical scans**. For large `P`, the scan time dominates. Use multiple levels of aggregation to reduce per-retire scan cost.

---

## EBR Reader Fast-Path Cost

EBR's reader fast path is two relaxed stores. In Go, even relaxed stores are sequentially consistent, so they emit barriers (`mov` + `mfence` on x86, store-release on ARM). The actual cost:

```go
func BenchmarkEBRRead(b *testing.B) {
    d := ebr.NewDomain(64)
    b.RunParallel(func(pb *testing.PB) {
        tid := getGoroutineID() // hand-rolled
        for pb.Next() {
            d.Enter(tid)
            // dummy read
            d.Exit(tid)
        }
    })
}
```

Output on x86:

```
BenchmarkEBRRead-8    300000000    4.2 ns/op
```

~4 ns per Enter/Exit pair. Compare to mutex acquire/release uncontended (~20 ns): EBR is ~5x cheaper. For a read-heavy workload with millions of reads per second, this matters.

On ARM, EBR's advantage shrinks because the barriers are more expensive. Still 2-3x cheaper than mutex.

### When EBR's cost falls apart

EBR's cost is fast-path only. The slow path (advance scan, retired list processing) is amortised. If a thread stalls and holds an old epoch:

- Other threads continue to retire objects, growing the retired list.
- No advance, no reclamation.
- Memory grows linearly with retirement rate.

In a 10-second stall under a 10^6 retire/sec workload, the retired list reaches 10^7 entries, ~160 MB of overhead. If the stall is longer, the system OOMs.

The mitigations:
- Detect stalled threads with watchdogs; force their exit.
- Use `hazard eras` or interval-based reclamation which bound memory under stalls.
- For Go specifically, ensure no goroutine holds an enter for longer than a few microseconds.

---

## Choosing Between Schemes

A decision matrix:

| Property | GC | Tagged wrapper | Hazard pointers | EBR | DWCAS |
|----------|----|----|------------------|-----|-------|
| Allocation per op | yes | yes (16B) | no | no | no |
| Reader overhead | none | none | atomic store | relaxed write | none |
| Memory bounded | depends | yes | yes | no | yes |
| Real-time friendly | no | partly | yes | no | yes |
| Engineering cost | low | low | high | medium | very high |
| Portable | yes | yes | yes | yes | no |

For application code: GC. For most lock-free libraries: tagged wrapper. For latency-critical libraries with bounded memory needs: hazard pointers. For read-heavy infrastructure: EBR. For extreme hot paths with stable hardware: DWCAS via assembly.

In Go specifically, the entries that involve `sync.Pool` or `unsafe` should be weighed against the simplicity loss. Many "I need hazard pointers" debates end with "no, you need a mutex." The lock-free win is sometimes smaller than expected, and the engineering cost is sometimes larger.

---

## Benchmarks on Real Hardware

Drawing from published benchmarks (Folly's HazPtr, perfbook ch. 9, junction maps) and our own measurements:

### x86 (AMD EPYC 7763, 64 cores, 8-socket NUMA)

| Workload | Mutex | Tagged | HP | EBR |
|----------|------:|-------:|---:|----:|
| Stack push, 1 thread | 28 ns | 35 ns | 60 ns | 52 ns |
| Stack push, 64 threads | 800 ns | 95 ns | 140 ns | 110 ns |
| Map lookup, 1 thread | 25 ns | n/a | 50 ns | 18 ns |
| Map lookup, 64 threads | 700 ns | n/a | 80 ns | 22 ns |

Observations:
- Mutex is fastest single-threaded for simple operations.
- Under contention, lock-free wins by 5-10x.
- EBR's read path is essentially free; HP is ~3x slower than EBR for reads.
- Tagged wrapper is competitive with EBR for writes; cheap and simple.

### ARM (AWS Graviton 3, 64 cores)

| Workload | Mutex | Tagged | HP | EBR |
|----------|------:|-------:|---:|----:|
| Stack push, 1 thread | 35 ns | 50 ns | 90 ns | 75 ns |
| Stack push, 64 threads | 1200 ns | 140 ns | 220 ns | 180 ns |

ARM's costs are uniformly ~30% higher due to relaxed memory model requiring more explicit barriers. The ordering is the same; the absolute values differ.

### Variability

Lock-free benchmarks are notoriously sensitive to scheduling, NUMA placement, and CPU frequency scaling. Two runs of the same benchmark can differ by 20%. For production decisions, run benchmarks on production hardware with production workloads, not microbenchmarks.

---

## Cache-Line Considerations

A subtle but important optimisation: lock-free structures interact heavily with the cache coherence protocol. Each CAS bounces the cache line between cores; contention scales superlinearly.

### False sharing

Two `atomic.Uint64` fields on the same cache line contend even if they are logically independent. The Go compiler does not automatically pad atomic fields. Padding is the programmer's responsibility:

```go
type Counter struct {
    v atomic.Uint64
    _ [56]byte // pad to a cache line
}
```

For a structure with multiple atomic fields, pad each one.

### Hazard slot padding

Hazard slots in particular should be cache-line padded. Otherwise multiple goroutines' slots share a line, and each Protect/Clear bounces the line:

```go
type slot struct {
    p atomic.Pointer[byte]
    _ [56]byte
}
```

### Sharding

For high-contention atomic counters, shard across multiple cache lines. Each thread updates its own shard; the total is computed by summing on read.

```go
type ShardedCounter struct {
    shards [64]Counter // 64 cache-line-padded counters
}

func (c *ShardedCounter) Add(delta int64) {
    c.shards[goroutineShard()].v.Add(uint64(delta))
}

func (c *ShardedCounter) Sum() (total int64) {
    for i := range c.shards {
        total += int64(c.shards[i].v.Load())
    }
    return
}
```

The cost is Sum is `O(shards)` instead of `O(1)`. For counters that are read rarely, this is a great trade.

`sync.PoolStat` and similar Go internals use this pattern.

---

## Allocation-Free Variants

For the highest-throughput hot paths, allocations are too expensive even at 10 ns. Allocation-free lock-free structures exist:

### Ring buffers

Vyukov MPMC queue (covered in middle.md and tasks.md) is allocation-free: a fixed-size array, no nodes. The cost is a fixed capacity.

### Pre-allocated node arenas

A slab of nodes, indices into the slab as "pointers." Free nodes are linked via a free-list. The free-list itself is lock-free with DWCAS or with tagged 32-bit indices.

Boost.Lockfree uses this pattern. In Go, the runtime's `mcache` is morally similar (per-P caches of small objects).

### Lock-free hash maps with linear probing

`junction` (Jeff Preshing) and similar use fixed-size tables with linear probing. No node allocation; slot reuse with per-slot epoch markers. ABA is handled by epoch markers (as in Vyukov MPMC).

### Disruptor pattern

LMAX Disruptor: single-writer ring buffer, multiple readers with independent cursors. Single-writer eliminates many CAS opportunities. The Disruptor is famous for ~6 ns per event, faster than any lock-based queue.

These designs trade flexibility (fixed capacity, specific access patterns) for raw throughput. For the right workload, they are 10x faster than tagged-wrapper lock-free structures. For the wrong workload, they do not apply.

---

## When to Stop Optimising

A pragmatic checklist:

1. **Have you measured?** If you have not benchmarked, you do not know if you have a problem.

2. **Is the structure on the hot path?** If profiling shows <1% CPU in the structure, optimisation is not justified.

3. **Have you tried a mutex?** A well-tuned mutex is often within 20% of lock-free for moderate contention.

4. **Have you reduced contention?** Sharding, batching, and per-thread queues reduce contention more effectively than algorithmic changes.

5. **Have you measured under production load?** Microbenchmarks lie. Production workloads have different access patterns, NUMA effects, and contention.

6. **Are tail latencies acceptable?** Sometimes p99 dominates p50 by 100x. Lock-free wins on tails; mutexes lose to scheduling delay.

Most Go codebases reach step 3 and stop. The lock-free path is justified for systems infrastructure (queues, caches, allocators) and rarely for application code.

---

## Production Settings

When you do ship lock-free Go code:

- **`GOMAXPROCS` matters.** Lock-free algorithms scale with available cores. Setting GOMAXPROCS lower than core count leaves performance on the table.
- **Avoid `runtime.LockOSThread` unless needed.** Pinning goroutines to OS threads complicates scheduling and can interact badly with the GC.
- **Tune GC.** `GOGC=off` is rarely the answer, but `GOGC=200` (less frequent GC) can help if your structure allocates heavily. Tune based on `gctrace`.
- **Monitor allocations.** `runtime/metrics` exposes per-second allocation rates. Track over time; a regression to higher allocation rate is a signal.
- **Avoid `runtime.Goexit` from lock-free critical sections.** If a goroutine exits with a hazard published, the slot leaks.
- **Test on production hardware.** ARM and x86 behave differently. NUMA effects vary by cloud provider.

---

## Summary

ABA mitigations span a wide cost range. The cheapest (DWCAS) requires the most engineering; the most expensive (mutex) requires the least. In between, the tagged wrapper is the workhorse for Go lock-free code, with hazard pointers and EBR as specialised tools.

The most common mistake is assuming lock-free is always faster. For moderate contention with short critical sections, a mutex is often comparable. The right way to choose is to measure on production-representative workloads, not microbenchmarks.

For Go specifically, the GC carries most of the weight. The tagged wrapper handles the rest. Hazard pointers and EBR are for libraries that opt out of the GC; in application code, they are rarely justified.

The one optimisation that always helps: cache-line padding atomic fields. False sharing kills lock-free performance and costs nothing to fix. Apply universally.

The decision hierarchy for senior engineers:

1. Start with a mutex. Measure.
2. If contention is high, shard or batch.
3. If still contended, try `sync.Map`, `sync.Once`, `atomic.Pointer[T]` and built-in primitives.
4. If still contended, build a tagged-wrapper lock-free structure.
5. If GC pauses are unacceptable, layer hazard pointers or EBR.
6. If extreme throughput is needed, DWCAS or workload-specific algorithm.

Most projects stop at step 2 or 3. The skill is knowing when to stop.
