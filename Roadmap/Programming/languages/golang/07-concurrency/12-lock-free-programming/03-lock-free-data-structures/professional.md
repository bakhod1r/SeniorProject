# Lock-Free Data Structures — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production Reclamation: Choosing a Scheme](#production-reclamation-choosing-a-scheme)
3. [The LMAX Disruptor Heritage](#the-lmax-disruptor-heritage)
4. [False Sharing and Cache-Line Engineering](#false-sharing-and-cache-line-engineering)
5. [NUMA Effects](#numa-effects)
6. [Real-World Libraries](#real-world-libraries)
7. [Benchmarks That Reflect Reality](#benchmarks-that-reflect-reality)
8. [Operational Concerns](#operational-concerns)
9. [Migration Stories](#migration-stories)
10. [Summary](#summary)

---

## Introduction

Professional-level lock-free engineering is less about new algorithms and more about the unglamorous work that makes lock-free designs survive production: choosing the right reclamation scheme, eliminating false sharing, surviving NUMA, picking the right library off the shelf, and writing benchmarks that reflect production load. The textbook designs are unchanged; what changes is the engineering discipline around them.

This file assumes you have written Treiber, MS-Queue, Harris, SPSC, MPSC, and Vyukov from senior level. Now we make them work in a service that runs for months.

---

## Production Reclamation: Choosing a Scheme

In Go, the garbage collector is the default reclamation scheme and it works for most lock-free code. Senior-level material covered hazard pointers and epoch-based reclamation as the alternatives. Production demands a clearer decision.

### Pure GC reclamation

When it works:

- The lock-free structure stores `*T` for heap-allocated `T`.
- The structure does not store `unsafe.Pointer` to memory outside Go's allocator.
- The structure does not pin nodes for long periods (no readers blocked in syscalls while holding a node pointer).

When the GC dominates cost:

- The lock-free queue churns >10M nodes per second. The GC scan time becomes a real fraction of CPU.
- The structure is the hot path of a low-latency service (P99 latency budget below 1 ms).
- The application is otherwise GC-free and lock-free is the only allocator.

Mitigations before changing reclamation scheme: object pooling (`sync.Pool`), batching pushes/pops, and reducing per-op allocation. Most Go lock-free code never needs more than this.

### Epoch-based reclamation (EBR)

Choose EBR when:

- Critical sections are short and bounded (no syscalls, no blocking).
- Throughput matters more than worst-case latency.
- You can pin goroutines to Ps for the critical section.

EBR in Go typically uses `runtime_procPin`/`runtime_procUnpin` via linkname. The `puzpuzpuz/xsync` library does this and exposes the technique cleanly. The pattern:

```go
//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

type ebrGuard struct {
    p   int
    reg *ebrRegistry
}

func (r *ebrRegistry) Pin() ebrGuard {
    p := runtime_procPin()
    epoch := r.global.Load()
    r.perP[p].pinned.Store(epoch)
    return ebrGuard{p: p, reg: r}
}

func (g ebrGuard) Unpin() {
    g.reg.perP[g.p].pinned.Store(0)
    runtime_procUnpin()
}
```

`linkname` is unstable. Every Go upgrade requires verifying the linkname targets still exist. Build a CI check.

### Hazard pointers

Choose hazard pointers when:

- Critical sections may block (syscalls, channel ops, mutex acquisitions inside the lock-free op).
- Memory growth must be bounded even with a misbehaving thread.
- You are interoperating with C/Rust lock-free code that already uses hazard pointers.

Hazard pointers are heavier per op (one publish + one re-read per protected pointer) but bound memory regardless of thread behaviour.

### Reference counting

A third scheme. Each node carries an atomic refcount. Readers increment before dereferencing, decrement after. Writers free when refcount drops to zero.

This works for simple structures (Treiber stack with refcounted nodes) but does not scale well: the refcount becomes a hot atomic per node, defeating the lock-free design's contention-avoidance. Useful for low-throughput cases where simplicity wins.

### Decision matrix

| Need                                  | Scheme                    |
|---------------------------------------|---------------------------|
| Standard Go service, GC acceptable    | Pure GC                   |
| Low-latency hot path, throughput-bound| EBR with `procPin`        |
| Long or blocking critical sections    | Hazard pointers           |
| Interop with C lock-free libraries    | Hazard pointers (match)   |
| Simple structure, low throughput      | Refcounting               |

Most Go services should use pure GC. Reach further only when profiling demands it.

---

## The LMAX Disruptor Heritage

The LMAX Disruptor (Martin Thompson et al., 2010) is the most influential ring-buffer design of the last two decades. The original Java implementation processed 6 million orders per second on a single thread. The architecture lessons translate directly to Go.

### Core ideas the Disruptor formalised

1. **Single writer principle.** Per-slot writes have one writer. Producers claim non-overlapping ranges of the ring. This eliminates write contention on slot content; only the claim counters contend.
2. **Mechanical sympathy.** The data structure layout reflects the cache hierarchy. Cache lines are sized for the target CPU. Counters that producers write are on different cache lines from counters that consumers write.
3. **Wait strategies are pluggable.** The consumer's "what to do when there is no work" is a strategy: spin, yield, sleep, park. Each has different latency-vs-CPU trade-offs.
4. **Dependency graphs.** Multiple consumers can form a DAG of dependencies: consumer B reads what consumer A has finished processing. Each consumer has its own sequence; the structure tracks all of them.

### Disruptor in Go

Several Go ports exist; `github.com/smartystreets/go-disruptor` is the most-maintained. The core API:

```go
type Sequencer interface {
    Next(n int64) int64           // claim n slots
    Publish(low, high int64)      // mark them published
}

type Consumer interface {
    Consume(low, high int64) error
}
```

A typical usage:

```go
ringSize := 1024 * 1024
ring := make([]Event, ringSize)
seqr := disruptor.NewMultiProducerSequencer(int64(ringSize), strategy)

go func() {
    for {
        lo := seqr.Next(1)
        ring[lo&int64(ringSize-1)] = makeEvent()
        seqr.Publish(lo, lo)
    }
}()
```

### When it earns its keep

The Disruptor outperforms a channel by 5-20x in throughput when the workload is event-streaming, batched, and bounded. Trading systems, log shippers, packet processors. Outside that niche, a buffered channel is simpler and sufficient.

The fixed-size ring is the right shape for backpressure: the producer cannot outrun the consumer indefinitely, because claims fail when the consumer has not caught up. A channel can grow unboundedly if the consumer stalls; the Disruptor forces a decision.

### The "single writer principle" beyond ring buffers

The principle generalises: if you can structure your data so that each cache line has exactly one writer, your throughput scales linearly with cores. Per-P caches (`sync.Pool`'s design), per-thread allocators (TCMalloc, jemalloc per-thread caches), per-shard counters. All apply the same idea.

In Go, the closest expression is per-P sharding via `runtime.GOMAXPROCS` and `procPin`. The same Disruptor mechanical-sympathy mindset applies.

---

## False Sharing and Cache-Line Engineering

False sharing is when two atomic variables that are conceptually independent share a cache line. A write to one invalidates the cache line for all cores reading the other. The performance penalty is real: 5-10x slowdowns are common.

### How big is a cache line?

On Intel and AMD x86: 64 bytes. On Apple M-series ARM: 128 bytes. On older ARM: 64. Some Intel CPUs prefetch pairs of lines, effectively making the unit 128 bytes for some workloads.

The safe default in Go: pad to 128 bytes between independently-written atomic words.

### Detecting false sharing

The symptom: throughput collapses at N cores in a way that does not match the structure's algorithmic complexity. Two cores hit a known-uncontended structure, and yet they slow each other down.

The tool: `perf c2c` on Linux, which directly measures cache-line bouncing.

```bash
perf c2c record -F 999 ./your_binary
perf c2c report
```

The report shows which cache lines are bouncing and which functions are touching them. A line that bounces millions of times in a benchmark with no algorithmic contention is a false-sharing victim.

### Padding patterns

Three idioms:

```go
// Pattern 1: explicit byte padding (Go 1.x compatible)
type SPSC struct {
    head atomic.Uint64
    _    [56]byte
    tail atomic.Uint64
    _    [56]byte
}

// Pattern 2: padded type
type padInt64 struct {
    v atomic.Int64
    _ [56]byte
}

// Pattern 3: hoist via struct embedding
type alignedHead struct {
    head atomic.Uint64
}
type alignedTail struct {
    tail atomic.Uint64
}
type SPSC2 struct {
    a alignedHead
    _ [56]byte
    b alignedTail
}
```

Pattern 1 is the most common. Pattern 3 is the most readable. Pattern 2 is the most reusable.

For 128-byte cache lines, increase the pad to `[120]byte` (or pad until offset of the next field is 128 bytes aligned).

### What the Go runtime does

Look at `runtime/sema.go`: the semaphore root table has explicit padding between roots. `runtime/mheap.go` aligns `mheap` fields by hand. The Go authors have learned the same lessons; their padding choices are good reference material.

### Verification

The `unsafe.Offsetof` function lets you assert layout in tests:

```go
func TestSPSCLayout(t *testing.T) {
    var q SPSC
    if unsafe.Offsetof(q.tail)-unsafe.Offsetof(q.head) < 64 {
        t.Fatalf("head and tail share a cache line")
    }
}
```

This catches regressions when a field is added in the middle of the struct.

---

## NUMA Effects

A NUMA (non-uniform memory access) machine has multiple memory controllers, each closer to some cores than others. A core accessing memory attached to its local controller pays maybe 80 ns; a core accessing remote memory pays 200+ ns. Lock-free structures shared across NUMA nodes pay the remote-access cost on every cache-line bounce.

### Symptoms

- Single-socket benchmarks scale well; dual-socket benchmarks plateau at 60-70% of single-socket peak per socket.
- `perf c2c` shows cache lines bouncing between sockets, not within.
- The data structure's algorithmic complexity does not predict the slowdown.

### Mitigations

1. **Pin goroutines to NUMA nodes.** Not directly possible in Go without external tooling (`numactl`, taskset). For latency-critical services, run one process per NUMA node and shard work at the network layer.
2. **Per-socket sharding.** Sharded structures that align shard boundaries with NUMA topology. `github.com/intel-go/cpuid` exposes topology info.
3. **NUMA-aware allocators.** Go's allocator is NUMA-naive. Memory is allocated wherever the runtime placed the mcache. For very-latency-sensitive paths, pre-allocate slabs in a known NUMA-local region (requires CGO + `libnuma`).

### When NUMA matters

- Database engines on bare metal.
- Trading systems on dedicated hardware.
- Cloud VMs that span sockets (uncommon; most cloud instance shapes fit one socket).

Most Go services run on single-socket VMs and never see NUMA effects. Verify the topology (`lscpu`, `numactl --hardware`) before assuming you have a NUMA problem.

---

## Real-World Libraries

A non-exhaustive tour of Go libraries that implement lock-free data structures in production-grade form.

### `sync.Map` (standard library)

A read-mostly lock-free-ish map. Internally uses a read-only "read" map and a mutex-protected "dirty" map. Reads on hot keys are lock-free. Reads on cold keys promote them and become contention sources until the dirty map is promoted.

Use when: you have a map with keys that are written once and read many times, or keys with disjoint sets per goroutine. Avoid when: writes are frequent and well-distributed (a plain `sync.RWMutex + map` does better).

### `sync.Pool` (standard library)

Per-P caches with steal-from-victim semantics. Used inside the standard library for buffer reuse (`fmt`, `encoding/json`, `net/http`). The lock-free path is the per-P fast path; the steal path takes a brief lock.

Use when: you allocate-then-discard objects on hot paths. Avoid when: you need objects to live longer than a GC cycle (the pool is cleared on GC).

### `github.com/puzpuzpuz/xsync`

A library of concurrent maps and counters using EBR-like schemes. The `Map` is a Click-style hash map. The `Counter` is per-P sharded with linkname tricks. Well-benchmarked, well-tested.

Use when: profiling shows `sync.Map` failing under your workload. Caveat: linkname dependencies.

### `github.com/cornelk/hashmap`

A more direct Click-style port. Reads are wait-free, writes use CAS. Less batteries-included than xsync but more transparent in implementation.

### `github.com/dgraph-io/ristretto`

A high-throughput cache. Uses a TinyLFU admission policy and `sync.Pool`-backed buffers internally. Not purely lock-free but a good example of how careful concurrent design beats naive lock-free.

### `github.com/lotusdblabs/lotusdb` and friends

Embedded databases that use lock-free skip lists for memtables. The implementations are educational because the use case justifies the complexity (sustained millions of writes per second on a single process).

### Go's runtime

Worth re-mentioning: the runtime itself is the largest body of production-grade lock-free Go code. `runtime/proc.go`, `runtime/sema.go`, `runtime/lockrank.go`, `runtime/mgcwork.go`. Reading the runtime is the best apprenticeship for lock-free Go.

---

## Benchmarks That Reflect Reality

A microbenchmark of `Push` and `Pop` does not predict production behaviour. Real benchmarks need:

### Multi-dimensional sweeps

```go
func BenchmarkQueue(b *testing.B) {
    for _, prod := range []int{1, 2, 4, 8, 16} {
        for _, cons := range []int{1, 2, 4, 8, 16} {
            for _, payload := range []int{8, 64, 512} {
                name := fmt.Sprintf("p%d_c%d_pay%d", prod, cons, payload)
                b.Run(name, func(b *testing.B) {
                    runWorkload(b, prod, cons, payload)
                })
            }
        }
    }
}
```

This generates 75 benchmarks. Each takes seconds. You get the full picture of where the structure shines and where it falls over.

### Burst vs steady-state

Real workloads burst. Steady-state benchmarks hide latency spikes that happen on transitions from idle to active.

```go
func runBursty(b *testing.B, q *Queue) {
    for i := 0; i < b.N; i++ {
        // Idle for 100us
        time.Sleep(100 * time.Microsecond)
        // Burst of 1000 ops
        for j := 0; j < 1000; j++ {
            q.Enqueue(i)
        }
    }
}
```

### Latency distributions, not just averages

`testing.B` reports ns/op as an average. Production cares about P50, P99, P999.

```go
func BenchmarkLatencyDistribution(b *testing.B) {
    samples := make([]time.Duration, b.N)
    for i := 0; i < b.N; i++ {
        start := time.Now()
        q.Enqueue(i)
        samples[i] = time.Since(start)
    }
    sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
    b.ReportMetric(float64(samples[len(samples)/2]), "ns/op-p50")
    b.ReportMetric(float64(samples[len(samples)*99/100]), "ns/op-p99")
    b.ReportMetric(float64(samples[len(samples)*999/1000]), "ns/op-p999")
}
```

A structure with great P50 and bad P99 may be unacceptable for an SLA-bound service.

### GC interaction

Lock-free structures that allocate per-op produce GC pressure. Benchmark with `-benchmem` and watch `allocs/op`. Then benchmark with `GOGC=off` to see the structure isolated from GC overhead. The difference tells you how much your throughput depends on the GC keeping up.

### Comparison baselines

Always compare against:

- A `sync.Mutex` + standard collection.
- A `sync.RWMutex` + standard collection (if read-heavy).
- A buffered channel (if queue-like).

If your lock-free structure is not at least 2x faster than the best baseline at your target core count, the complexity is not justified. Ship the simpler design.

---

## Operational Concerns

A lock-free structure in production is a piece of code your team must operate. Some practical disciplines.

### Code review

Lock-free patches need at least two reviewers, one of whom should not have written lock-free code in the last week. The second reviewer catches sloppy abstractions; the fresh reviewer catches over-cleverness.

Standard checklist:

- Every CAS has documented invariants.
- Every load that participates in a CAS is annotated with what state it must be observing.
- Every retry loop has a bounded backoff or a documented argument for none.
- Every freed node has a reclamation argument.
- Padding is asserted in tests.

### Observability

Add metrics that distinguish lock-free issues from other slowness:

- CAS attempt count vs CAS success count. The ratio tells you contention.
- Retire-list size (for hazard pointers / EBR).
- Per-P shard distribution (for sharded structures).
- Per-bucket occupancy (for hash maps).

Without these, a misbehaving lock-free structure is a black box.

### Stress testing

`go test -race -count=10000 -timeout=30m` catches more bugs than any review. Make it a CI gate.

Above and beyond `-race`: a long-running fuzz test that runs the structure under random workloads for hours, with invariant checks at quiescence. Lock-free bugs hide at low probability.

### Documentation

Every lock-free file in your codebase should have a block comment at the top citing the paper, naming the algorithm, and stating the invariants. Six months later you will have forgotten; the comment is for the maintainer who is not you.

### When to deprecate

A lock-free structure that survives a year of production has earned trust. A lock-free structure that has had two bugs in six months is a maintenance liability. Move back to a mutex + collection unless you have airtight reasons not to.

---

## Migration Stories

### Story 1: Replace `chan` with MPSC, win 30%

A logging library was bottlenecked on a single buffered channel that aggregated log lines from 200 goroutines. The channel's enqueue path took ~150 ns under contention. Replacing with Vyukov's MPSC dropped that to ~50 ns, freeing CPU for the application.

Cost: ~200 lines of new code, two weeks of stress testing, one race-detector bug found in the first week, fixed by tightening a memory barrier (in the original, conceptual barrier; in Go, no source change because Go atomics are seq-cst).

Lesson: the win was real and proportional. The structure was a clean fit for the workload (multi-producer, single-consumer, high throughput).

### Story 2: Replace mutex map with `sync.Map`, lose

A team replaced `sync.RWMutex + map[string]*Entry` with `sync.Map` in a configuration cache. The workload was write-heavy (config reloads every 30 seconds touched all keys). `sync.Map` hates write-heavy: each promotion to the dirty map is slow, and frequent writes keep promotions cycling.

Throughput dropped 20%. P99 latency doubled. The team rolled back.

Lesson: read the documentation of the structure you are adopting. `sync.Map`'s docs are explicit that it is for read-mostly workloads.

### Story 3: Treiber stack, lock-free, then back to mutex

A team built a Treiber stack for free-list management in a custom allocator. Worked great in microbenchmarks. In production, contention was lower than expected (free-list ops were infrequent), and the Treiber stack's CAS-loop overhead in the no-contention case was higher than a mutex's uncontended fast path. Net: 5% slower.

The team reverted to a mutex-protected slice. The lock-free code was removed.

Lesson: profile your actual workload before choosing lock-free. "Theoretically scalable" loses to "actually fast at your contention level."

---

## Summary

Professional lock-free engineering is operational, not algorithmic. The algorithms are settled. What is not settled is which one fits your workload, how to keep it from regressing under maintenance, and how to know when to walk back from lock-free entirely.

The key disciplines:

1. **Reclamation matches workload.** Pure GC for typical Go; EBR for hot paths; hazard pointers when blocking is possible.
2. **False sharing kills more lock-free designs than algorithmic bugs.** Pad aggressively, assert layout in tests, run `perf c2c`.
3. **Benchmarks must reflect production.** Multi-dimensional, burst-and-steady, latency distributions, comparison baselines.
4. **Real libraries beat home-grown ones.** `sync.Map`, `sync.Pool`, `puzpuzpuz/xsync`, the Go runtime itself.
5. **Observability is mandatory.** Without CAS-retry metrics and shard distributions, you cannot diagnose problems in production.

The recurring honest verdict: lock-free wins narrowly, loses broadly, and earns its place only when the profile demands it. Use a mutex unless you have to.

---

## Related Topics

- [03-sync-package/06-map](../../03-sync-package/06-map/) — `sync.Map` internals
- [03-sync-package/05-pool](../../03-sync-package/05-pool/) — `sync.Pool` per-P caches
- [04-memory-fences](../04-memory-fences/) — Ordering reasoning the Disruptor exploits
- [01-cas-algorithms](../01-cas-algorithms/) — CAS, the universal primitive
- [02-aba-problem](../02-aba-problem/) — ABA and Go's GC mitigation
